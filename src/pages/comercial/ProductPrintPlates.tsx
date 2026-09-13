import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Archive, Layers3, Loader2, Pencil, Plus, Printer, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { allRows } from "@/lib/finance";
import { positiveInteger } from "@/lib/production";
import { formatProductionSeconds, productProductionReference } from "@/lib/product-production-reference";
import { optionalPlateNumber, sumProductPlateReferences, type ProductPrintPlateValues } from "@/lib/product-print-plate";

type Plate = ProductPrintPlateValues & {
  id: string; tenant_id: string; product_id: string; source_id: string; plate_index: number;
  label: string | null; material_id: string | null; printer_id: string | null;
  actual_source: string | null; actual_updated_at: string | null; model_id: string | null; profile_id: string | null;
};
type PlatesDatabase = { public: {
  Tables: { product_print_plates: { Row: Plate; Insert: Partial<Plate>; Update: Partial<Plate>; Relationships: [] } };
  Views: Record<string, never>; Functions: Record<string, never>; Enums: Record<string, never>; CompositeTypes: Record<string, never>;
} };
const db = supabase as unknown as SupabaseClient<PlatesDatabase>;
const rpc = supabase.rpc.bind(supabase) as unknown as (name: string, args: Record<string, unknown>) => PromiseLike<{ data: string | null; error: { message: string } | null }>;
const currency = (value: number | null) => value == null ? "Não informado" : value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const grams = (value: number | null) => value == null ? "Não informado" : `${value.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} g`;
const initialDraft = () => ({ plate_index: "1", label: "", units_per_plate: "1", material_id: "", printer_id: "", est_grams: "", est_time_minutes: "", est_cost_per_unit: "", model_id: "", profile_id: "" });

export default function ProductPrintPlates({ productId, tenantId, sourceId, showProductTotal = false, onBusyChange }: {
  productId: string; tenantId: string; sourceId: string; showProductTotal?: boolean;
  onBusyChange?: (sourceId: string, busy: boolean) => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Plate | null>(null);
  const [draft, setDraft] = useState(initialDraft);
  const [bindingPlate, setBindingPlate] = useState<string | null>(null);
  const [taskId, setTaskId] = useState("");
  const [taskSearch, setTaskSearch] = useState("");
  const key = ["product_print_plates", tenantId, productId, "reference"];
  const { data: allPlates = [], isLoading, error, refetch } = useQuery({
    queryKey: key,
    queryFn: () => allRows((from, to) => db.from("product_print_plates").select("*").eq("tenant_id", tenantId).eq("product_id", productId).eq("is_active", true).order("plate_index").order("id").range(from, to)),
  });
  const plates = allPlates.filter(plate => plate.source_id === sourceId);
  const total = sumProductPlateReferences(allPlates);
  const { data: materials = [], error: materialError } = useQuery({
    queryKey: ["print_plate_materials", tenantId],
    queryFn: () => allRows((from, to) => supabase.from("inventory_items").select("id,name,unit").eq("tenant_id", tenantId).eq("is_active", true).in("unit", ["g", "kg"]).order("name").order("id").range(from, to)),
  });
  const { data: printers = [], error: printerError } = useQuery({
    queryKey: ["print_plate_printers", tenantId],
    queryFn: () => allRows((from, to) => supabase.from("printers").select("id,name").eq("tenant_id", tenantId).eq("is_active", true).order("name").order("id").range(from, to)),
  });
  const { data: tasks = [], isLoading: tasksLoading, error: tasksError, refetch: refetchTasks } = useQuery({
    queryKey: ["product_print_source_tasks", tenantId],
    queryFn: () => allRows((from, to) => supabase.from("bambu_tasks").select("id,bambu_task_id,design_title,status,start_time,bambu_devices(name)").eq("tenant_id", tenantId).order("start_time", { ascending: false }).order("id").range(from, to)),
    enabled: !!bindingPlate,
  });
  const selectedTask = tasks.find(task => task.id === taskId);
  const filteredTasks = tasks.filter(task => !taskSearch.trim() || `${task.design_title || ""} ${task.bambu_task_id} ${task.bambu_devices?.name || ""}`.toLocaleLowerCase("pt-BR").includes(taskSearch.trim().toLocaleLowerCase("pt-BR")));
  const reset = () => { setFormOpen(false); setEditing(null); setDraft(initialDraft()); };
  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ["product_print_plates", tenantId, productId] });
    await qc.invalidateQueries({ queryKey: ["products"] });
  };
  const save = useMutation({
    mutationFn: async () => {
      const index = positiveInteger(draft.plate_index, "Número da placa", 10000);
      const units = positiveInteger(draft.units_per_plate, "Unidades atendidas por impressão", 10000);
      const minutes = optionalPlateNumber(draft.est_time_minutes, "Tempo estimado");
      if (draft.material_id && !materials.some(material => material.id === draft.material_id) && draft.material_id !== editing?.material_id) throw new Error("Selecione um material ativo em gramas ou quilogramas.");
      if (draft.printer_id && !printers.some(printer => printer.id === draft.printer_id) && draft.printer_id !== editing?.printer_id) throw new Error("Selecione uma impressora ativa.");
      const { data, error: saveError } = await rpc("save_product_print_plate", {
        p_plate_id: editing?.id || null, p_product_id: productId, p_source_id: sourceId,
        p_plate: {
          plate_index: index, label: draft.label.trim() || `Placa ${index}`, units_per_plate: units,
          material_id: draft.material_id || null, printer_id: draft.printer_id || null,
          est_grams: optionalPlateNumber(draft.est_grams, "Peso estimado"),
          est_time_seconds: minutes == null ? null : Math.round(minutes * 60),
          est_cost_per_unit: optionalPlateNumber(draft.est_cost_per_unit, "Custo estimado"),
        },
      });
      if (saveError) throw new Error(saveError.message);
      if (!data) throw new Error("A placa não foi confirmada. Atualize a lista antes de tentar novamente.");
      return data;
    },
    onSuccess: async id => { reset(); await refresh(); setBindingPlate(id); setTaskId(""); setTaskSearch(""); toast({ title: "Placa salva", description: "Vincule a impressão Bambu correspondente a esta placa." }); },
    onError: (err: Error) => toast({ title: "Não foi possível salvar a placa", description: err.message, variant: "destructive" }),
  });
  const archive = useMutation({
    mutationFn: async (id: string) => {
      const { error: archiveError } = await rpc("archive_product_print_plate", { p_plate_id: id });
      if (archiveError) throw new Error(archiveError.message);
    },
    onSuccess: async (_, id) => { if (bindingPlate === id) setBindingPlate(null); await refresh(); toast({ title: "Placa arquivada", description: "Ela deixa de compor novas produções. O histórico foi preservado." }); },
    onError: (err: Error) => toast({ title: "Não foi possível arquivar a placa", description: err.message, variant: "destructive" }),
  });
  const bind = useMutation({
    mutationFn: async () => {
      if (!bindingPlate || !selectedTask) throw new Error("Selecione a impressão Bambu desta placa.");
      const { data, error: bindError } = await rpc("bind_product_print_plate", { p_plate_id: bindingPlate, p_task_id: selectedTask.id });
      if (bindError) throw new Error(bindError.message);
      if (!data) throw new Error("O vínculo não foi confirmado. Atualize a lista antes de tentar novamente.");
    },
    onSuccess: async () => { await refresh(); setBindingPlate(null); setTaskId(""); toast({ title: "Impressão vinculada à placa" }); },
    onError: (err: Error) => toast({ title: "Não foi possível vincular esta placa", description: err.message, variant: "destructive" }),
  });
  const busy = save.isPending || archive.isPending || bind.isPending;
  useEffect(() => { onBusyChange?.(sourceId, busy); return () => onBusyChange?.(sourceId, false); }, [busy, onBusyChange, sourceId]);

  const field = (name: keyof ReturnType<typeof initialDraft>, label: string, props: { type?: string; min?: number; step?: string } = {}) => <div>
    <Label htmlFor={`plate-${sourceId}-${name}`}>{label}</Label>
    <Input id={`plate-${sourceId}-${name}`} value={draft[name]} onChange={event => setDraft({ ...draft, [name]: event.target.value })} disabled={busy} {...props} />
  </div>;
  return <section aria-label="Placas necessárias para o produto" className="border-t pt-3 space-y-3">
    <div className="flex flex-wrap justify-between items-center gap-2">
      <h4 className="flex items-center gap-1.5 text-sm font-semibold"><Layers3 className="h-4 w-4" /> Placas desta fonte</h4>
      {!formOpen && <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => { reset(); setDraft({ ...initialDraft(), plate_index: String(Math.max(0, ...plates.map(plate => plate.plate_index)) + 1) }); setFormOpen(true); }}><Plus className="mr-1 h-3.5 w-3.5" /> Adicionar placa</Button>}
    </div>
    <p className="text-xs leading-relaxed text-muted-foreground">Cadastre cada placa necessária para completar o produto. Exemplo: base e tampa são duas placas; os custos por unidade se somam. Uma impressão pode atender várias unidades do produto.</p>
    {error && <div role="alert" className="text-xs text-destructive">Não foi possível carregar as placas. <Button type="button" size="sm" variant="ghost" onClick={() => refetch()}>Tentar novamente</Button></div>}
    {isLoading ? <p className="text-xs text-muted-foreground">Carregando placas…</p> : !error && !plates.length && <p className="text-xs text-muted-foreground">Nenhuma placa definida nesta fonte. O arquivo associado não informa sozinho quais placas compõem este SKU.</p>}
    {showProductTotal && total.count > 0 && <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 space-y-2">
      <p className="text-xs font-semibold">Produto completo · {total.count} {total.count === 1 ? "placa ativa" : "placas ativas"}</p>
      <dl className="grid grid-cols-1 gap-2 sm:grid-cols-3 text-xs">
        <div><dt className="text-muted-foreground">Material por produto</dt><dd className="font-mono font-semibold">{grams(total.grams)}</dd></div>
        <div><dt className="text-muted-foreground">Tempo somado por produto</dt><dd className="font-mono font-semibold">{formatProductionSeconds(total.seconds)}</dd></div>
        <div><dt className="text-muted-foreground">Custo somado por produto</dt><dd className="font-mono font-semibold">{currency(total.cost)}</dd></div>
      </dl>
      <p className="text-[11px] leading-relaxed text-muted-foreground">Soma por unidade de todas as placas ativas do produto, inclusive de outras fontes. O tempo somado é esforço de impressão; placas em paralelo podem terminar antes.</p>
      {total.incomplete ? <p className="text-xs text-amber-800">Referência incompleta: preencha ou apure as placas sem dados. Valores ausentes não são tratados como zero.</p> : total.usesEstimate && <p className="text-xs text-muted-foreground">Inclui estimativas das placas ainda sem referência contabilizada.</p>}
    </div>}
    {plates.map(plate => {
      const actual = productProductionReference({ actual_print_sample_units: plate.actual_sample_units, actual_print_grams_per_unit: plate.actual_grams_per_unit, actual_print_seconds_per_unit: plate.actual_seconds_per_unit, actual_print_cost_per_unit: plate.actual_cost_per_unit, actual_print_source: plate.actual_source, actual_print_updated_at: plate.actual_updated_at });
      return <article key={plate.id} className="rounded-lg border bg-background p-3 space-y-2">
        <div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="text-sm font-medium break-words">Placa {plate.plate_index} · {plate.label || "Sem nome"}</p><p className="text-xs text-muted-foreground">Cada impressão atende {plate.units_per_plate} {plate.units_per_plate === 1 ? "unidade" : "unidades"} do produto.</p></div>
          <div className="flex shrink-0"><Button type="button" size="icon" variant="ghost" className="h-9 w-9" aria-label={`Editar placa ${plate.plate_index}`} disabled={busy} onClick={() => {
            setEditing(plate); setFormOpen(true); setDraft({ plate_index: String(plate.plate_index), label: plate.label || "", units_per_plate: String(plate.units_per_plate), material_id: plate.material_id || "", printer_id: plate.printer_id || "", est_grams: plate.est_grams == null ? "" : String(plate.est_grams), est_time_minutes: plate.est_time_seconds == null ? "" : String(plate.est_time_seconds / 60), est_cost_per_unit: plate.est_cost_per_unit == null ? "" : String(plate.est_cost_per_unit), model_id: plate.model_id || "", profile_id: plate.profile_id || "" });
          }}><Pencil className="h-3.5 w-3.5" /></Button><Button type="button" size="icon" variant="ghost" className="h-9 w-9" aria-label={`Arquivar placa ${plate.plate_index}`} disabled={busy} onClick={() => archive.mutate(plate.id)}><Archive className="h-3.5 w-3.5" /></Button></div>
        </div>
        <p className="text-xs text-muted-foreground">{materials.find(material => material.id === plate.material_id)?.name || (plate.material_id ? "Material arquivado" : "Material não definido")} · {printers.find(printer => printer.id === plate.printer_id)?.name || (plate.printer_id ? "Impressora arquivada" : "Impressora não definida")}</p>
        <dl className="grid grid-cols-1 gap-2 sm:grid-cols-3 text-xs">
          <div><dt className="text-muted-foreground">Peso estimado da impressão</dt><dd className="font-mono">{grams(plate.est_grams)}</dd></div>
          <div><dt className="text-muted-foreground">Tempo estimado da impressão</dt><dd className="font-mono">{formatProductionSeconds(plate.est_time_seconds)}</dd></div>
          <div><dt className="text-muted-foreground">Custo estimado por unidade</dt><dd className="font-mono">{currency(plate.est_cost_per_unit)}</dd></div>
        </dl>
        {actual && <div className="rounded-md bg-muted/40 p-2.5 text-xs space-y-1"><p className="font-medium">Referência da produção desta placa · {actual.sampleUnits.toLocaleString("pt-BR")} unidades contabilizadas</p><p>{actual.gramsLabel} · {actual.durationLabel} de tempo decorrido · {actual.costLabel} por unidade do produto</p><p className="text-muted-foreground">{actual.materialSource}</p>{actual.updatedLabel && <p className="text-muted-foreground">Atualizada em {actual.updatedLabel}</p>}</div>}
        <Button type="button" size="sm" variant="outline" className="h-auto min-h-9 max-w-full whitespace-normal py-2 text-left" disabled={busy} onClick={() => { setBindingPlate(plate.id); setTaskId(""); setTaskSearch(""); }}><Printer className="mr-1 h-3.5 w-3.5 shrink-0" /> Vincular impressão desta placa</Button>
        {bindingPlate === plate.id && <div className="border-t pt-3 space-y-2">
          <div className="flex items-center justify-between gap-2"><p className="text-xs font-medium">Escolha uma execução desta placa</p><Button type="button" size="icon" variant="ghost" className="h-8 w-8" aria-label="Fechar vínculo da placa" disabled={busy} onClick={() => setBindingPlate(null)}><X className="h-4 w-4" /></Button></div>
          <div><Label htmlFor={`plate-search-${plate.id}`}>Buscar impressão</Label><Input id={`plate-search-${plate.id}`} value={taskSearch} onChange={event => { setTaskSearch(event.target.value); setTaskId(""); }} disabled={busy} placeholder="Nome, impressora ou ID Bambu" /></div>
          {tasksError ? <p role="alert" className="text-xs text-destructive">Não foi possível carregar o histórico. <Button type="button" size="sm" variant="ghost" onClick={() => refetchTasks()}>Tentar novamente</Button></p> : <div><Label htmlFor={`plate-task-${plate.id}`}>Impressão Bambu da placa {plate.plate_index}</Label><select id={`plate-task-${plate.id}`} className="h-11 w-full min-w-0 rounded-md border bg-background px-3 text-sm" value={taskId} onChange={event => setTaskId(event.target.value)} disabled={busy || tasksLoading}><option value="">{tasksLoading ? "Carregando…" : "Selecione a impressão desta placa"}</option>{filteredTasks.map(task => <option key={task.id} value={task.id}>{task.design_title || "Sem título"} · {task.start_time ? new Date(task.start_time).toLocaleDateString("pt-BR") : "Sem data"} · {task.bambu_devices?.name || "Impressora"} · #{task.bambu_task_id}</option>)}</select></div>}
          {selectedTask && <p className="text-xs leading-relaxed text-muted-foreground">{selectedTask.design_title || "Sem título"} · #{selectedTask.bambu_task_id}. Confirme que esta execução corresponde à placa {plate.plate_index}. O vínculo identifica a placa; consumo e quantidade continuam sujeitos à apuração.</p>}
          <Button type="button" size="sm" className="h-auto min-h-9 max-w-full whitespace-normal py-2 text-left" disabled={busy || !selectedTask || !!tasksError} onClick={() => bind.mutate()}>{bind.isPending && <Loader2 className="mr-1 h-4 w-4 shrink-0 animate-spin" />} Confirmar vínculo desta placa</Button>
        </div>}
      </article>;
    })}
    {formOpen && <div className="border-t pt-3 space-y-3">
      <p className="text-sm font-medium">{editing ? "Editar placa" : "Nova placa do produto"}</p>
      {(materialError || printerError) && <p role="alert" className="text-xs text-destructive">Materiais ou impressoras indisponíveis. Reabra o produto antes de alterar essas referências.</p>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {field("plate_index", "Número da placa no arquivo", { type: "number", min: 1, step: "1" })}
        {field("label", "Nome da placa (ex.: base ou tampa)")}
        <div className="sm:col-span-2">{field("units_per_plate", "Unidades do produto atendidas por impressão desta placa", { type: "number", min: 1, step: "1" })}<p className="mt-1 text-xs text-muted-foreground">Se a placa imprime quatro bases para quatro produtos, informe 4. Base e tampa de um único produto, em placas diferentes, usam 1 em cada placa.</p></div>
        <div><Label htmlFor={`plate-material-${sourceId}`}>Material de referência</Label><select id={`plate-material-${sourceId}`} className="h-11 w-full rounded-md border bg-background px-3 text-sm" value={draft.material_id} onChange={event => setDraft({ ...draft, material_id: event.target.value })} disabled={busy || !!materialError}><option value="">Selecionar depois</option>{draft.material_id && !materials.some(material => material.id === draft.material_id) && <option value={draft.material_id}>Material atual arquivado</option>}{materials.map(material => <option key={material.id} value={material.id}>{material.name} ({material.unit})</option>)}</select></div>
        <div><Label htmlFor={`plate-printer-${sourceId}`}>Impressora de referência</Label><select id={`plate-printer-${sourceId}`} className="h-11 w-full rounded-md border bg-background px-3 text-sm" value={draft.printer_id} onChange={event => setDraft({ ...draft, printer_id: event.target.value })} disabled={busy || !!printerError}><option value="">Selecionar depois</option>{draft.printer_id && !printers.some(printer => printer.id === draft.printer_id) && <option value={draft.printer_id}>Impressora atual arquivada</option>}{printers.map(printer => <option key={printer.id} value={printer.id}>{printer.name}</option>)}</select></div>
        {field("est_grams", "Peso estimado por impressão (g)", { type: "number", min: 0, step: "0.01" })}
        {field("est_time_minutes", "Tempo estimado por impressão (min)", { type: "number", min: 0, step: "0.01" })}
        {field("est_cost_per_unit", "Custo estimado por unidade do produto (R$)", { type: "number", min: 0, step: "0.01" })}
      </div>
      <div className="rounded-lg border p-3 text-xs space-y-2"><p className="font-medium">Identificadores Bambu desta placa</p><p className="text-muted-foreground">Vincule uma impressão do histórico para registrar os IDs exatos.</p>{(draft.model_id || draft.profile_id) && <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2"><div><dt className="text-muted-foreground">Model ID da placa</dt><dd className="break-all font-mono">{draft.model_id || "Não vinculado"}</dd></div><div><dt className="text-muted-foreground">Profile ID da placa</dt><dd className="break-all font-mono">{draft.profile_id || "Não vinculado"}</dd></div></dl>}</div>
      <div className="flex flex-wrap justify-end gap-2"><Button type="button" size="sm" variant="outline" disabled={busy} onClick={reset}>Cancelar placa</Button><Button type="button" size="sm" disabled={busy} onClick={() => save.mutate()}>{save.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Salvar placa</Button></div>
    </div>}
  </section>;
}
