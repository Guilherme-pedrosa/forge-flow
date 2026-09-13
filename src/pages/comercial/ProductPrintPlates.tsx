import { useCallback, useEffect, useState } from "react";
import ProductMaterialRecipe, { fetchProductMaterialRecipe, fetchProductPlatePreparation } from "./ProductMaterialRecipe";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
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
import { importedColorHex, importedFilamentLabel, importedPlateFilaments, observedPlateFilaments } from "@/lib/imported-plate-materials";

type Plate = ProductPrintPlateValues & {
  id: string; tenant_id: string; product_id: string; source_id: string; plate_index: number;
  label: string | null; material_id: string | null; printer_id: string | null;
  actual_source: string | null; actual_updated_at: string | null; model_id: string | null; profile_id: string | null;
  imported_plate_metadata?: unknown; imported_filaments?: unknown;
};
type PlatesDatabase = { public: {
  Tables: { product_print_plates: { Row: Plate; Insert: Partial<Plate>; Update: Partial<Plate>; Relationships: [] } };
  Views: Record<string, never>; Functions: Record<string, never>; Enums: Record<string, never>; CompositeTypes: Record<string, never>;
} };
const db = supabase as unknown as SupabaseClient<PlatesDatabase>;
const rpc = supabase.rpc.bind(supabase) as unknown as (name: string, args: Record<string, unknown>) => PromiseLike<{ data: string | null; error: { message: string } | null }>;
const currency = (value: number | null) => value == null ? "Não informado" : value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const grams = (value: number | null) => value == null ? "Não informado" : `${value.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} g`;
const initialDraft = () => ({ plate_index: "1", label: "", units_per_plate: "", material_id: "", printer_id: "", est_grams: "", est_time_minutes: "", est_cost_per_unit: "", model_id: "", profile_id: "" });

function PlatePreparationCosts({ tenantId, plateId }: { tenantId: string; plateId: string }) {
  const query = useQuery({ queryKey: ["product_print_plate_preparation", tenantId, plateId], queryFn: () => fetchProductPlatePreparation(plateId) });
  if (query.isLoading) return <p className="text-xs text-muted-foreground">Calculando materiais, energia e máquina por impressão…</p>;
  if (query.error) return <p role="alert" className="text-xs text-destructive">Não foi possível calcular a preparação. <button type="button" className="underline" onClick={() => query.refetch()}>Tentar novamente</button></p>;
  const value = query.data;
  const cost = (number: number | null | undefined) => number != null && Number.isFinite(number) ? currency(number) : "Pendente";
  return <div className="space-y-2 rounded-md bg-muted/30 p-3 text-xs"><p className="font-medium">Custos conhecidos por impressão · previsão parcial</p><dl className="grid grid-cols-1 gap-2 sm:grid-cols-3"><div><dt className="text-muted-foreground">Materiais</dt><dd>{cost(value?.material_cost_per_print)}</dd></div><div><dt className="text-muted-foreground">Energia</dt><dd>{cost(value?.energy_cost_per_print)}</dd></div><div><dt className="text-muted-foreground">Máquina</dt><dd>{cost(value?.machine_cost_per_print)}</dd></div></dl><p>Subtotal conhecido: <strong>{cost(value?.known_cost_per_print)}</strong></p><p className="text-muted-foreground">A previsão usa os filamentos importados, o estoque e a impressora. Trabalho, acabamento e adicionais exigem confirmação na composição.</p>{!!value?.missing?.length && <ul className="space-y-1 text-amber-800 dark:text-amber-300">{value.missing.map((message, index) => <li key={index}>{message}</li>)}</ul>}</div>;
}

function PlateRecipe({ productId, tenantId, plateId, importedFilaments, importedPlateMetadata, onBusy, onDraft }: { productId: string; tenantId: string; plateId: string; importedFilaments?: unknown; importedPlateMetadata?: unknown; onBusy: (id: string, busy: boolean) => void; onDraft: (id: string, editing: boolean) => void }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  useEffect(() => { onBusy(plateId, saving); return () => onBusy(plateId, false); }, [onBusy, plateId, saving]);
  useEffect(() => { onDraft(plateId, open && editing); return () => onDraft(plateId, false); }, [onDraft, plateId, open, editing]);
  return <>
    <Button type="button" className="h-auto min-h-11 w-full whitespace-normal text-left" onClick={() => setOpen(true)}>Preparar materiais e rendimento</Button>
    <Dialog open={open} onOpenChange={next => { if (!saving) setOpen(next); }}>
      <DialogContent className="max-w-2xl max-sm:p-3" closeDisabled={saving} aria-busy={saving} onEscapeKeyDown={event => { if (saving) event.preventDefault(); }} onInteractOutside={event => { if (saving) event.preventDefault(); }}>
        <DialogHeader className="pr-10"><DialogTitle>Receita da placa</DialogTitle><DialogDescription>Confira a composição e salve uma nova versão quando necessário.</DialogDescription></DialogHeader>
        {open && <ProductMaterialRecipe productId={productId} tenantId={tenantId} plateId={plateId} importedFilaments={importedFilaments} importedPlateMetadata={importedPlateMetadata} startEditing={!!importedPlateMetadata || importedPlateFilaments(importedFilaments).length > 0} onBusyChange={setSaving} onDraftChange={setEditing} />}
        <DialogFooter><Button type="button" className="min-h-11" variant="outline" disabled={saving} onClick={() => setOpen(false)}>Fechar composição</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}

export default function ProductPrintPlates({ productId, tenantId, sourceId, showProductTotal = false, onBusyChange, onDraftChange }: {
  productId: string; tenantId: string; sourceId: string; showProductTotal?: boolean;
  onBusyChange?: (sourceId: string, busy: boolean) => void;
  onDraftChange?: (sourceId: string, editing: boolean) => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Plate | null>(null);
  const [draft, setDraft] = useState(initialDraft);
  const [bindingPlate, setBindingPlate] = useState<string | null>(null);
  const [taskId, setTaskId] = useState("");
  const [taskSearch, setTaskSearch] = useState("");
  const [recipeBusy, setRecipeBusy] = useState<Record<string, boolean>>({});
  const reportRecipeBusy = useCallback((id: string, busy: boolean) => setRecipeBusy(previous => previous[id] === busy ? previous : { ...previous, [id]: busy }), []);
  const [recipeDraft, setRecipeDraft] = useState<Record<string, boolean>>({});
  const reportRecipeDraft = useCallback((id: string, editing: boolean) => setRecipeDraft(previous => previous[id] === editing ? previous : { ...previous, [id]: editing }), []);
  const key = ["product_print_plates", tenantId, productId, "reference"];
  const { data: allPlates = [], isLoading, error, refetch } = useQuery({
    queryKey: key,
    queryFn: () => allRows((from, to) => db.from("product_print_plates").select("*").eq("tenant_id", tenantId).eq("product_id", productId).eq("is_active", true).order("plate_index").order("id").range(from, to)),
  });
  const plates = allPlates.filter(plate => plate.source_id === sourceId);
  const total = sumProductPlateReferences(allPlates);
  const recipePreview = useQuery({ queryKey: ["product_material_recipe", tenantId, productId], queryFn: () => fetchProductMaterialRecipe(productId) });
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
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["product_print_plates", tenantId, productId] }),
      qc.invalidateQueries({ queryKey: ["product_material_recipe"] }),
      qc.invalidateQueries({ queryKey: ["product_print_plate_preparation", tenantId] }),
      qc.invalidateQueries({ queryKey: ["products"] }),
    ]);
  };
  const save = useMutation({
    mutationFn: async () => {
      const index = positiveInteger(draft.plate_index, "Número da placa", 10000);
      const units = draft.units_per_plate.trim() ? positiveInteger(draft.units_per_plate, "Unidades atendidas por impressão", 10000) : null;
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
    onSuccess: id => {
      const alreadyBound = !!editing?.model_id && !!editing?.profile_id;
      reset(); void refresh(); setBindingPlate(alreadyBound ? null : id); setTaskId(""); setTaskSearch("");
      toast({ title: "Placa salva", description: alreadyBound ? "Dados atualizados. O vínculo com a impressão foi preservado." : "Vincule a impressão Bambu correspondente a esta placa." });
    },
    onError: (err: Error) => toast({ title: "Não foi possível salvar a placa", description: err.message, variant: "destructive" }),
  });
  const archive = useMutation({
    mutationFn: async (id: string) => {
      const { error: archiveError } = await rpc("archive_product_print_plate", { p_plate_id: id });
      if (archiveError) throw new Error(archiveError.message);
    },
    onSuccess: (_, id) => { if (bindingPlate === id) setBindingPlate(null); void refresh(); toast({ title: "Placa arquivada", description: "Ela deixa de compor novas produções. O histórico foi preservado." }); },
    onError: (err: Error) => toast({ title: "Não foi possível arquivar a placa", description: err.message, variant: "destructive" }),
  });
  const bind = useMutation({
    mutationFn: async () => {
      if (!bindingPlate || !selectedTask) throw new Error("Selecione a impressão Bambu desta placa.");
      const { data, error: bindError } = await rpc("bind_product_print_plate", { p_plate_id: bindingPlate, p_task_id: selectedTask.id });
      if (bindError) throw new Error(bindError.message);
      if (!data) throw new Error("O vínculo não foi confirmado. Atualize a lista antes de tentar novamente.");
    },
    onSuccess: () => { void refresh(); setBindingPlate(null); setTaskId(""); toast({ title: "Impressão vinculada à placa" }); },
    onError: (err: Error) => toast({ title: "Não foi possível vincular esta placa", description: err.message, variant: "destructive" }),
  });
  const busy = save.isPending || archive.isPending || bind.isPending || Object.values(recipeBusy).some(Boolean);
  useEffect(() => { onBusyChange?.(sourceId, busy); return () => onBusyChange?.(sourceId, false); }, [busy, onBusyChange, sourceId]);
  const hasDraft = formOpen || (!!bindingPlate && !!taskId) || Object.values(recipeDraft).some(Boolean);
  useEffect(() => { onDraftChange?.(sourceId, hasDraft); return () => onDraftChange?.(sourceId, false); }, [hasDraft, onDraftChange, sourceId]);
  const editPlate = (plate: Plate) => {
    setEditing(plate); setFormOpen(true); setDraft({ plate_index: String(plate.plate_index), label: plate.label || "", units_per_plate: plate.units_per_plate == null ? "" : String(plate.units_per_plate), material_id: plate.material_id || "", printer_id: plate.printer_id || "", est_grams: plate.est_grams == null ? "" : String(plate.est_grams), est_time_minutes: plate.est_time_seconds == null ? "" : String(plate.est_time_seconds / 60), est_cost_per_unit: plate.est_cost_per_unit == null ? "" : String(plate.est_cost_per_unit), model_id: plate.model_id || "", profile_id: plate.profile_id || "" });
  };

  const field = (name: keyof ReturnType<typeof initialDraft>, label: string, props: { type?: string; min?: number; step?: string } = {}) => <div>
    <Label htmlFor={`plate-${sourceId}-${name}`}>{label}</Label>
    <Input id={`plate-${sourceId}-${name}`} value={draft[name]} onChange={event => setDraft({ ...draft, [name]: event.target.value })} disabled={busy} {...props} />
  </div>;
  return <section aria-label="Placas necessárias para o produto" className="border-t pt-3 space-y-3">
    <div className="flex flex-wrap justify-between items-center gap-2">
      <h4 className="flex items-center gap-1.5 text-sm font-semibold"><Layers3 className="h-4 w-4" /> Placas desta fonte</h4>
      {!formOpen && <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => { reset(); setDraft({ ...initialDraft(), plate_index: String(Math.max(0, ...plates.map(plate => plate.plate_index)) + 1) }); setFormOpen(true); }}><Plus className="mr-1 h-3.5 w-3.5" /> Adicionar placa</Button>}
    </div>
    {error && <div role="alert" className="text-xs text-destructive">Não foi possível carregar as placas. <Button type="button" size="sm" variant="ghost" onClick={() => refetch()}>Tentar novamente</Button></div>}
    {isLoading ? <p className="text-xs text-muted-foreground">Carregando placas…</p> : !error && !plates.length && <p className="text-xs text-muted-foreground">Nenhuma placa definida nesta fonte. O arquivo associado não informa sozinho quais placas compõem este SKU.</p>}
    {showProductTotal && total.count > 0 && <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 space-y-2">
      <p className="text-sm font-semibold">{total.count} {total.count === 1 ? "placa" : "placas"} · {grams(total.printGrams)} por conjunto de impressões · {formatProductionSeconds(total.printSeconds)}</p>
      {total.unconfirmedUnits > 0 && <p role="status" className="text-xs text-amber-800 dark:text-amber-300">Quantas unidades do produto saem de cada impressão? Confirme o rendimento ao preparar os materiais de cada placa.</p>}
      <details className="text-xs"><summary className="cursor-pointer text-muted-foreground">Consumo e custo por produto</summary><dl className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3 text-xs">
        <div><dt className="text-muted-foreground">Material por produto</dt><dd className="font-mono font-semibold">{grams(total.grams)}</dd></div>
        <div><dt className="text-muted-foreground">Tempo somado por produto</dt><dd className="font-mono font-semibold">{formatProductionSeconds(total.seconds)}</dd></div>
        <div><dt className="text-muted-foreground">Custo atual da composição por produto</dt><dd className="font-mono font-semibold">{currency(recipePreview.error ? null : recipePreview.data?.cost_per_unit ?? null)}</dd></div>
      </dl>
      <p className="mt-2 text-muted-foreground">Referência anterior de custo: <span className="font-mono">{currency(total.cost)}</span> por produto completo.</p>
      {!recipePreview.data?.complete && <p className="mt-2 text-muted-foreground">O custo por produto fica disponível após confirmar rendimento e composição de todas as placas.</p>}
      {recipePreview.error && <p role="alert" className="text-destructive">Não foi possível carregar o custo. <button type="button" className="underline" onClick={() => recipePreview.refetch()}>Tentar novamente</button></p>}</details>
    </div>}
    {plates.map(plate => {
      const actual = productProductionReference({ actual_print_sample_units: plate.actual_sample_units, actual_print_grams_per_unit: plate.actual_grams_per_unit, actual_print_seconds_per_unit: plate.actual_seconds_per_unit, actual_print_cost_per_unit: plate.actual_cost_per_unit, actual_print_source: plate.actual_source, actual_print_updated_at: plate.actual_updated_at });
      const recipe = recipePreview.data?.plates.find(value => value.id === plate.id)?.recipe;
      const filaments = importedPlateFilaments(plate.imported_filaments);
      const observed = observedPlateFilaments(plate.imported_plate_metadata);
      return <article key={plate.id} className="rounded-lg border bg-background p-3 space-y-2">
        <div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="text-sm font-medium break-words">Placa {plate.plate_index} · {plate.label || "Sem nome"}</p>{plate.units_per_plate == null ? <p className="text-xs text-amber-800 dark:text-amber-300">Em preparação · rendimento por impressão pendente</p> : <p className="text-xs text-muted-foreground">Cada impressão atende {plate.units_per_plate} {plate.units_per_plate === 1 ? "unidade" : "unidades"} do produto.</p>}</div>
          <div className="flex shrink-0"><Button type="button" size="icon" variant="ghost" className="h-11 w-11" aria-label={`Editar placa ${plate.plate_index}`} disabled={busy} onClick={() => editPlate(plate)}><Pencil className="h-3.5 w-3.5" /></Button><Button type="button" size="icon" variant="ghost" className="h-11 w-11" aria-label={`Arquivar placa ${plate.plate_index}`} disabled={busy} onClick={() => archive.mutate(plate.id)}><Archive className="h-3.5 w-3.5" /></Button></div>
        </div>
        <p className="flex flex-wrap gap-x-3 gap-y-1 text-sm font-medium"><span>{grams(plate.est_grams)}</span><span>{formatProductionSeconds(plate.est_time_seconds)}</span><span className="text-xs font-normal text-muted-foreground">por impressão</span></p>
        {[{ label: "Material do arquivo", rows: filaments }, { label: "Material usado nesta impressão", rows: observed }].filter(group => group.rows.length > 0).map(group => <div key={group.label} className="space-y-1"><p className="text-xs text-muted-foreground">{group.label}</p><div className="flex flex-wrap gap-1.5">{group.rows.map((filament, index) => <span key={index} className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-md bg-muted/50 px-2 py-1 text-xs"><span aria-hidden="true" className="h-3 w-3 shrink-0 rounded-full border" style={{ backgroundColor: importedColorHex(filament.color) || "transparent" }} /><span className="break-words">{importedFilamentLabel(filament)}</span><span className="shrink-0 tabular-nums">{filament.grams == null ? "— g" : grams(filament.grams)}</span></span>)}</div></div>)}
        <PlateRecipe productId={productId} tenantId={tenantId} plateId={plate.id} importedFilaments={plate.imported_filaments} importedPlateMetadata={plate.imported_plate_metadata} onBusy={reportRecipeBusy} onDraft={reportRecipeDraft} />
        <details className="text-xs"><summary className="cursor-pointer py-1 text-muted-foreground">Custos, impressora e histórico</summary><div className="mt-2 space-y-3">
        <p className="text-muted-foreground">{printers.find(printer => printer.id === plate.printer_id)?.name || (plate.printer_id ? "Impressora arquivada" : "Impressora a definir")}</p>
        <p>{recipe ? "Custo atual da composição / unidade" : "Estimativa anterior / unidade"}: <strong>{currency(recipe ? (recipePreview.error ? null : recipe.cost_per_unit) : plate.est_cost_per_unit)}</strong></p>
        {(filaments.length > 0 || !!plate.imported_plate_metadata) && <PlatePreparationCosts tenantId={tenantId} plateId={plate.id} />}
        {actual && <div className="rounded-md bg-muted/40 p-2.5 text-xs space-y-1"><p className="font-medium">Referência da produção desta placa · {actual.sampleUnits.toLocaleString("pt-BR")} unidades contabilizadas</p><p>{actual.gramsLabel} · {actual.durationLabel} de tempo decorrido · {actual.costLabel} por unidade do produto</p><p className="text-muted-foreground">{actual.materialSource}</p>{actual.updatedLabel && <p className="text-muted-foreground">Atualizada em {actual.updatedLabel}</p>}</div>}
        <Button type="button" size="sm" variant="outline" className="h-auto min-h-9 max-w-full whitespace-normal py-2 text-left" disabled={busy} onClick={() => { setBindingPlate(plate.id); setTaskId(""); setTaskSearch(""); }}><Printer className="mr-1 h-3.5 w-3.5 shrink-0" /> Vincular impressão desta placa</Button>
        {bindingPlate === plate.id && <div className="border-t pt-3 space-y-2">
          <div className="flex items-center justify-between gap-2"><p className="text-xs font-medium">Escolha uma execução desta placa</p><Button type="button" size="icon" variant="ghost" className="h-11 w-11" aria-label="Fechar vínculo da placa" disabled={bind.isPending} onClick={() => { setBindingPlate(null); setTaskId(""); setTaskSearch(""); }}><X className="h-4 w-4" /></Button></div>
          <div><Label htmlFor={`plate-search-${plate.id}`}>Buscar impressão</Label><Input id={`plate-search-${plate.id}`} value={taskSearch} onChange={event => { setTaskSearch(event.target.value); setTaskId(""); }} disabled={busy} placeholder="Nome, impressora ou ID Bambu" /></div>
          {tasksError ? <p role="alert" className="text-xs text-destructive">Não foi possível carregar o histórico. <Button type="button" size="sm" variant="ghost" onClick={() => refetchTasks()}>Tentar novamente</Button></p> : <div><Label htmlFor={`plate-task-${plate.id}`}>Impressão Bambu da placa {plate.plate_index}</Label><select id={`plate-task-${plate.id}`} className="h-11 w-full min-w-0 rounded-md border bg-background px-3 text-sm" value={taskId} onChange={event => setTaskId(event.target.value)} disabled={busy || tasksLoading}><option value="">{tasksLoading ? "Carregando…" : "Selecione a impressão desta placa"}</option>{filteredTasks.map(task => <option key={task.id} value={task.id}>{task.design_title || "Sem título"} · {task.start_time ? new Date(task.start_time).toLocaleDateString("pt-BR") : "Sem data"} · {task.bambu_devices?.name || "Impressora"} · #{task.bambu_task_id}</option>)}</select></div>}
          {selectedTask && <p className="text-xs leading-relaxed text-muted-foreground">{selectedTask.design_title || "Sem título"} · #{selectedTask.bambu_task_id}. Confirme que esta execução corresponde à placa {plate.plate_index}. O vínculo identifica a placa; consumo e quantidade continuam sujeitos à apuração.</p>}
          <Button type="button" size="sm" className="h-auto min-h-9 max-w-full whitespace-normal py-2 text-left" disabled={busy || !selectedTask || !!tasksError} onClick={() => bind.mutate()}>{bind.isPending && <Loader2 className="mr-1 h-4 w-4 shrink-0 animate-spin" />} Confirmar vínculo desta placa</Button>
        </div>}
        <p className="text-muted-foreground">Gramas e tempos importados são previsões do fatiamento. A apuração registra o consumo e a duração da execução.</p></div></details>
      </article>;
    })}
    {formOpen && <div className="border-t pt-3 space-y-3">
      <p className="text-sm font-medium">{editing ? "Editar placa" : "Nova placa do produto"}</p>
      {(materialError || printerError) && <p role="alert" className="text-xs text-destructive">Materiais ou impressoras indisponíveis. Reabra o produto antes de alterar essas referências.</p>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {field("plate_index", "Número da placa no arquivo", { type: "number", min: 1, step: "1" })}
        {field("label", "Nome da placa (ex.: base ou tampa)")}
        <div className="sm:col-span-2">{field("units_per_plate", "Unidades do produto atendidas por impressão desta placa", { type: "number", min: 1, step: "1" })}<p className="mt-1 text-xs text-muted-foreground">Se a placa imprime quatro bases para quatro produtos, informe 4. Base e tampa de um único produto, em placas diferentes, usam 1 em cada placa. Deixe vazio se ainda não souber: a placa fica em preparação, sem liberar produção.</p></div>
        <div><Label htmlFor={`plate-material-${sourceId}`}>Material de referência</Label><select id={`plate-material-${sourceId}`} className="h-11 w-full rounded-md border bg-background px-3 text-sm" value={draft.material_id} onChange={event => setDraft({ ...draft, material_id: event.target.value })} disabled={busy || !!materialError}><option value="">Selecionar depois</option>{draft.material_id && !materials.some(material => material.id === draft.material_id) && <option value={draft.material_id}>Material atual arquivado</option>}{materials.map(material => <option key={material.id} value={material.id}>{material.name} ({material.unit})</option>)}</select></div>
        <div><Label htmlFor={`plate-printer-${sourceId}`}>Impressora de referência</Label><select id={`plate-printer-${sourceId}`} className="h-11 w-full rounded-md border bg-background px-3 text-sm" value={draft.printer_id} onChange={event => setDraft({ ...draft, printer_id: event.target.value })} disabled={busy || !!printerError}><option value="">Selecionar depois</option>{draft.printer_id && !printers.some(printer => printer.id === draft.printer_id) && <option value={draft.printer_id}>Impressora atual arquivada</option>}{printers.map(printer => <option key={printer.id} value={printer.id}>{printer.name}</option>)}</select></div>
        {field("est_grams", "Peso estimado por impressão (g)", { type: "number", min: 0, step: "0.01" })}
        {field("est_time_minutes", "Tempo estimado por impressão (min)", { type: "number", min: 0, step: "0.01" })}
        {field("est_cost_per_unit", "Custo estimado por unidade do produto (R$)", { type: "number", min: 0, step: "0.01" })}
      </div>
      <details className="rounded-lg border p-3 text-xs space-y-2"><summary className="cursor-pointer font-medium">Detalhes técnicos do vínculo Bambu</summary><p className="text-muted-foreground">Preenchidos a partir da impressão vinculada.</p>{(draft.model_id || draft.profile_id) && <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2"><div><dt className="text-muted-foreground">Model ID da placa</dt><dd className="break-all font-mono">{draft.model_id || "Não vinculado"}</dd></div><div><dt className="text-muted-foreground">Profile ID da placa</dt><dd className="break-all font-mono">{draft.profile_id || "Não vinculado"}</dd></div></dl>}</details>
      <div className="flex flex-wrap justify-end gap-2"><Button type="button" size="sm" className="min-h-11" variant="outline" disabled={save.isPending} onClick={reset}>Cancelar placa</Button><Button type="button" size="sm" className="min-h-11" disabled={busy} onClick={() => save.mutate()}>{save.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Salvar placa</Button></div>
    </div>}
  </section>;
}
