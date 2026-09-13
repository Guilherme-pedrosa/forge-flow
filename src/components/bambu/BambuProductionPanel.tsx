import { useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, CheckCircle2, ChevronDown, Loader2, RefreshCw, Settings2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { bambuTaskStatus, formatBambuSeconds, requiredBambuNumber } from "@/lib/bambu-production";
import { bambuRpc, readBambuProductionReview, readBambuSyncState, type BambuJobAllocation, type BambuMaterialBinding, type BambuProductionPreview, type BambuProductionReview } from "@/lib/bambu-production-api";
import { productionQueryKeys } from "@/lib/production-api";
import { orderRequest } from "@/lib/sales-order";
import { readProductPlates, type ProductionPlate } from "@/lib/production-plates";

const money = (value: number | null) => value == null ? "Pendente" : value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dateTime = (value: string | null) => value ? new Date(value).toLocaleString("pt-BR") : "Não informado";
const grams = (value: number | null) => value == null ? "Não informado" : `${value.toLocaleString("pt-BR")} g`;
const states: Record<BambuProductionReview["state"], string> = {
  unlinked: "Configurar vínculo", watching: "Acompanhando", needs_measurement: "Medição pendente",
  ready: "Pronta para apurar", blocked: "Revisão necessária", posted: "Apurada", unknown: "Estado desconhecido",
};
const editable = new Set(["draft", "queued", "reprint", "printing", "paused"]);

export function BambuProductionPanel() {
  const { profile } = useAuth();
  const qc = useQueryClient();
  const [selected, setSelected] = useState<{ task: BambuProductionReview; mode: "configure" | "account" } | null>(null);
  const [filter, setFilter] = useState("pending");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const review = useQuery({ queryKey: ["bambu_production_review", profile?.tenant_id], enabled: !!profile, queryFn: readBambuProductionReview, refetchInterval: 15000 });
  const sync = useQuery({ queryKey: ["bambu_sync_state", profile?.tenant_id], enabled: !!profile, queryFn: readBambuSyncState, refetchInterval: query => query.state.data?.some(row => ["queued", "syncing"].includes(row.status)) ? 15000 : 60000 });
  const preview = useQuery({
    queryKey: ["bambu_production_preview", profile?.tenant_id, selected?.task.task_id], enabled: !!profile && !!selected,
    queryFn: () => bambuRpc<BambuProductionPreview>("bambu_production_preview", { p_task_id: selected!.task.task_id }),
    staleTime: 0,
  });
  const products = useQuery({ queryKey: ["bambu_production_products", profile?.tenant_id], enabled: !!profile && !!selected, queryFn: async () => {
    const { data, error } = await supabase.from("products").select("id,name,sku,category,is_active").eq("is_active", true).order("name");
    if (error) throw error; return data;
  } });
  const materials = useQuery({ queryKey: ["bambu_production_materials", profile?.tenant_id], enabled: !!profile && !!selected, queryFn: async () => {
    const { data, error } = await supabase.from("inventory_items").select("id,name,unit,current_stock,is_active").eq("is_active", true).order("name");
    if (error) throw error; return data.filter(item => ["g", "kg"].includes(item.unit.trim().toLowerCase()));
  } });
  const plates = useQuery({ queryKey: ["product_print_plates", profile?.tenant_id], enabled: !!profile && !!selected, queryFn: () => readProductPlates() });
  const jobs = useQuery({ queryKey: ["bambu_production_jobs", profile?.tenant_id], enabled: !!profile && selected?.mode === "configure", queryFn: async () => {
    const { data, error } = await supabase.from("jobs").select("id,code,name,status,product_id,print_plate_id,planned_quantity,order_item_id,inventory_posted_at").in("status", [...editable] as ("draft" | "queued" | "reprint" | "printing" | "paused")[]).is("inventory_posted_at", null).order("created_at");
    if (error) throw error; return data as unknown as Job[];
  } });
  const rows = useMemo(() => review.data ?? [], [review.data]);
  const filtered = useMemo(() => rows.filter(row => (filter === "all" || (filter === "posted" ? row.state === "posted" : row.state !== "posted")) && `${row.design_title ?? ""} ${row.bambu_task_id} ${row.product_name ?? ""}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())), [rows, filter, search]);
  const currentPage = Math.min(page, Math.max(0, Math.ceil(filtered.length / 12) - 1));
  const visible = filtered.slice(currentPage * 12, currentPage * 12 + 12);
  const lastSync = sync.data?.filter(row => row.last_success_at).map(row => row.last_success_at!).sort().at(-1) ?? null;
  const failures = sync.data?.filter(row => row.status === "error") ?? [];
  const processing = sync.data?.some(row => ["queued", "syncing"].includes(row.status));
  const changed = () => {
    [...productionQueryKeys, "bambu_production_review", "bambu_production_preview", "bambu_production_jobs", "bambu_production_materials", "bambu_tasks", "products", "products_list"].forEach(key => qc.invalidateQueries({ queryKey: [key] }));
    setSelected(null);
  };

  return <section className="space-y-4" aria-labelledby="bambu-production-title">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 id="bambu-production-title" className="text-lg font-semibold">Impressões e apuração</h2><p className="text-sm text-muted-foreground">Vincule cada execução ao produto e ao material do estoque para apurar custos e consumo uma única vez.</p></div>
      <Button variant="outline" size="sm" onClick={() => { review.refetch(); sync.refetch(); }} disabled={review.isFetching}><RefreshCw className="mr-2 h-4 w-4" />Atualizar painel</Button>
    </div>
    <div className="rounded-xl border bg-muted/30 p-4 text-sm">
      <p className="font-medium">{processing ? "Buscando atualizações na Bambu…" : `Última sincronização confirmada: ${dateTime(lastSync)}`}</p>
      {failures.map(row => <p key={row.bambu_device_id} role="alert" className="mt-2 text-destructive">{row.last_error_code === "auth_required" ? "Reconecte sua conta Bambu Lab para atualizar este dispositivo." : row.last_error || "Não foi possível atualizar um dos dispositivos."}{row.next_attempt_at ? ` Próxima tentativa: ${dateTime(row.next_attempt_at)}.` : ""}</p>)}
      {sync.data?.some(row => row.history_may_be_truncated) && <p className="mt-2 text-muted-foreground">A consulta cobre uma janela do histórico Bambu. Pode haver impressões anteriores ainda não importadas.</p>}
      {sync.error && <p role="alert" className="mt-2 text-destructive">Não foi possível consultar o estado da sincronização. {sync.error.message}</p>}
    </div>
    <div className="grid gap-3 sm:grid-cols-3">
      <Metric label="Execuções importadas" value={rows.length} />
      <Metric label="Apuração pendente" value={rows.filter(row => row.state !== "posted" && ["completed", "failed"].includes(row.outcome)).length} />
      <Metric label="Apuradas no ERP" value={rows.filter(row => row.state === "posted").length} />
    </div>
    <div className="flex flex-col gap-3 sm:flex-row">
      <Input aria-label="Buscar impressão" placeholder="Buscar impressão, tarefa ou produto…" value={search} onChange={event => { setSearch(event.target.value); setPage(0); }} />
      <Select value={filter} onValueChange={value => { setFilter(value); setPage(0); }}><SelectTrigger className="sm:w-56" aria-label="Filtrar apuração"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="pending">Pendentes</SelectItem><SelectItem value="posted">Apuradas</SelectItem><SelectItem value="all">Todas as execuções</SelectItem></SelectContent></Select>
    </div>
    {review.error ? <p role="alert" className="rounded-lg bg-destructive/10 p-4 text-sm text-destructive">Não foi possível carregar a apuração. {review.error.message}</p> : review.isLoading ? <div className="flex items-center gap-2 p-8"><Loader2 className="h-4 w-4 animate-spin" />Carregando impressões…</div> : !filtered.length ? <div className="rounded-xl border p-8 text-center text-muted-foreground">Nenhuma execução neste filtro.</div> : <>
      <div className="grid gap-3 md:hidden">{visible.map(row => <article key={row.task_id} className="space-y-3 rounded-xl border bg-card p-4">
        <div><h3 className="font-semibold">{row.design_title || "Impressão sem título"}</h3><p className="mt-1 text-xs text-muted-foreground">{row.device_name || "Impressora sem vínculo"} · tarefa {row.bambu_task_id}</p><p className="mt-1 text-sm">{row.product_name || "Produto não vinculado"}</p>{row.plate_id && <p className="mt-1 text-xs text-muted-foreground">Placa {row.plate_index ?? ""} · {row.plate_label || "Placa vinculada"}</p>}</div>
        <div className="flex items-center justify-between gap-3"><span className="text-sm font-medium">{bambuTaskStatus(row.raw_status).label}</span><span className="text-sm tabular-nums">{money(row.total_cost)}</span></div>
        <div className="rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground"><p>{dateTime(row.started_at)}</p><p className="mt-1">Decorrido: {formatBambuSeconds(row.elapsed_seconds)}</p><p className="mt-1">Plano do fatiador: {grams(row.planned_grams)}</p></div>
        <div><p className="text-sm font-medium">{states[row.state] ?? "Revisão necessária"}</p>{row.problem && <p className="mt-1 text-xs text-muted-foreground">{row.problem}</p>}<p className="mt-1 text-xs text-muted-foreground">{row.consumption_source === "measured" ? "Consumo por pesagem informada" : row.consumption_source === "slicer_completed" ? "Consumo de referência do fatiador" : "Consumo ainda não apurado"}</p>{row.outcome === "failed" && <p className="mt-1 text-xs text-muted-foreground">0 peças concluídas · {row.state === "posted" ? "perda apurada" : "pesagem pendente"}</p>}</div>
        <BambuQualitySummary row={row} />
        {row.state === "posted" ? <p className="flex items-center gap-2 text-xs text-emerald-600"><CheckCircle2 className="h-4 w-4" />{dateTime(row.posted_at)}</p> : <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => setSelected({ task: row, mode: "configure" })}>Configurar vínculo</Button>{["completed", "failed"].includes(row.outcome) && <Button size="sm" disabled={!row.product_id} onClick={() => setSelected({ task: row, mode: "account" })}>Apurar impressão</Button>}</div>}
      </article>)}</div>
      <div className="hidden overflow-hidden rounded-xl border md:block"><Table><TableHeader><TableRow><TableHead>Impressão</TableHead><TableHead>Execução</TableHead><TableHead>Apuração</TableHead><TableHead className="text-right">Custo</TableHead><TableHead>Ações</TableHead></TableRow></TableHeader><TableBody>{visible.map(row => <TableRow key={row.task_id}>
        <TableCell className="min-w-52 max-w-72"><p className="whitespace-normal font-medium">{row.design_title || "Impressão sem título"}</p><p className="mt-1 text-xs text-muted-foreground">{row.device_name || "Impressora sem vínculo"} · tarefa {row.bambu_task_id}</p><p className="mt-1 text-xs text-muted-foreground">{row.product_name || "Produto não vinculado"}{row.units ? ` · ${row.units} peça(s) na execução` : ""}</p>{row.plate_id && <p className="mt-1 text-xs text-muted-foreground">Placa {row.plate_index ?? ""} · {row.plate_label || "Placa vinculada"}</p>}</TableCell>
        <TableCell className="min-w-44"><p>{bambuTaskStatus(row.raw_status).label}</p><p className="mt-1 text-xs text-muted-foreground">{dateTime(row.started_at)}</p><p className="mt-1 text-xs text-muted-foreground">Decorrido: {formatBambuSeconds(row.elapsed_seconds)}</p><p className="mt-1 text-xs text-muted-foreground">Plano do fatiador: {grams(row.planned_grams)}</p></TableCell>
        <TableCell className="min-w-52 max-w-72"><p className={row.state === "posted" ? "font-medium text-emerald-600" : "font-medium"}>{states[row.state] ?? "Revisão necessária"}</p>{row.problem && <p className="mt-1 whitespace-normal text-xs text-muted-foreground">{row.problem}</p>}<p className="mt-1 text-xs text-muted-foreground">{row.consumption_source === "measured" ? "Consumo por pesagem informada" : row.consumption_source === "slicer_completed" ? "Consumo de referência do fatiador" : "Consumo ainda não apurado"}</p>{row.outcome === "failed" && <p className="mt-1 text-xs text-muted-foreground">0 peças concluídas · {row.state === "posted" ? "perda apurada" : "pesagem pendente"}</p>}</TableCell>
        <TableCell className="max-w-60 text-right tabular-nums">{money(row.total_cost)}<BambuQualitySummary row={row} /></TableCell>
        <TableCell><div className="flex flex-col gap-2">{row.state !== "posted" ? <><Button size="sm" variant="outline" onClick={() => setSelected({ task: row, mode: "configure" })}><Settings2 className="mr-1 h-4 w-4" />Configurar</Button>{["completed", "failed"].includes(row.outcome) && <Button size="sm" disabled={!row.product_id} onClick={() => setSelected({ task: row, mode: "account" })}>Apurar impressão</Button>}</> : <span className="flex items-center gap-1 text-xs text-emerald-600"><CheckCircle2 className="h-4 w-4" />{dateTime(row.posted_at)}</span>}</div></TableCell>
      </TableRow>)}</TableBody></Table></div>
      <div className="flex items-center justify-between gap-3 text-sm"><p className="text-muted-foreground">{filtered.length} execuções</p><div className="flex gap-2"><Button size="sm" variant="outline" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Anterior</Button><Button size="sm" variant="outline" disabled={(currentPage + 1) * 12 >= filtered.length} onClick={() => setPage(currentPage + 1)}>Próxima</Button></div></div>
    </>}
    {selected && <ProductionDialog task={selected.task} mode={selected.mode} preview={preview.data} loading={preview.isLoading || products.isLoading || materials.isLoading || plates.isLoading || (selected.mode === "configure" && jobs.isLoading)} error={preview.error?.message || products.error?.message || materials.error?.message || plates.error?.message || (selected.mode === "configure" ? jobs.error?.message : undefined)} products={products.data ?? []} materials={materials.data ?? []} jobs={jobs.data ?? []} plates={plates.data ?? []} onClose={() => setSelected(null)} onSaved={changed} />}
  </section>;
}

function Metric({ label, value }: { label: string; value: number }) { return <div className="rounded-xl border bg-card p-4"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p></div>; }
export function BambuQualitySummary({ row }: { row: BambuProductionReview }) {
  if (row.state !== "posted" || row.outcome !== "completed") return null;
  return <div className="mt-2 space-y-1 whitespace-normal text-xs text-muted-foreground">
    {row.completed_units != null && <p>{row.completed_units.toLocaleString("pt-BR")} peça(s) sem rejeição registrada.</p>}
    {(row.quality_rejected_units ?? 0) > 0 && <>
      <p className="text-amber-700">{row.quality_rejected_units!.toLocaleString("pt-BR")} peça(s) rejeitada(s) na qualidade · {grams(row.quality_loss_grams ?? null)} · {money(row.quality_loss_cost ?? null)}.</p>
      <p>Custo da rejeição já incluído nesta execução. Sem nova baixa de estoque.</p>
    </>}
  </div>;
}
type Product = { id: string; name: string; sku: string | null; category: string; is_active: boolean };
type Material = { id: string; name: string; unit: string; current_stock: number; is_active: boolean };
type Job = { id: string; code: string; name: string; status: string; product_id: string | null; print_plate_id: string | null; planned_quantity: number; order_item_id: string | null; inventory_posted_at: string | null };
type DialogProps = { task: BambuProductionReview; mode: "configure" | "account"; preview?: BambuProductionPreview; loading: boolean; error?: string; products: Product[]; materials: Material[]; jobs: Job[]; plates: ProductionPlate[]; onClose: () => void; onSaved: () => void };

function ProductionDialog(props: DialogProps) {
  const [busy, setBusy] = useState(false);
  return <Dialog open onOpenChange={open => { if (!open && !busy) props.onClose(); }}><DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle>{props.mode === "configure" ? "Vincular impressão ao ERP" : "Apurar impressão"}</DialogTitle><DialogDescription>{props.task.design_title || "Impressão sem título"} · tarefa {props.task.bambu_task_id}</DialogDescription></DialogHeader>
    {props.loading ? <div className="flex items-center gap-2 p-8"><Loader2 className="h-4 w-4 animate-spin" />Consultando vínculos…</div> : props.error ? <p role="alert" className="text-sm text-destructive">{props.error}</p> : props.preview ? props.mode === "configure" ? <BambuConfigurationForm key={props.task.task_id} {...props} preview={props.preview} onBusy={setBusy} /> : <BambuAccountingForm key={props.task.task_id} {...props} preview={props.preview} onBusy={setBusy} /> : <p role="alert">Não foi possível consultar esta impressão.</p>}
  </DialogContent></Dialog>;
}

type FormProps = DialogProps & { preview: BambuProductionPreview; onBusy: (value: boolean) => void };
export function BambuConfigurationForm({ task, preview, products, materials, jobs, plates, onClose, onSaved, onBusy }: FormProps) {
  const { toast } = useToast();
  const config = preview.record ?? preview.profile;
  const [productId, setProductId] = useState(config?.product_id ?? "");
  const [plateId, setPlateId] = useState(config?.plate_id ?? "");
  const [units, setUnits] = useState(String(config?.units ?? 1));
  const [bindings, setBindings] = useState<Record<string, string>>(() => Object.fromEntries(preview.filaments.map(f => [f.source_key, config?.materials?.find(m => m.source_key === f.source_key)?.item_id ?? f.item_id ?? ""])));
  const [automatic, setAutomatic] = useState(config?.auto_enabled ?? false);
  const [useSlicer, setUseSlicer] = useState(config?.use_slicer ?? false);
  const [labor, setLabor] = useState(String(config?.labor_cost ?? 0));
  const [overhead, setOverhead] = useState(String(config?.overhead ?? 0));
  const [extras, setExtras] = useState(String(config?.extras_cost ?? 0));
  const [allocations, setAllocations] = useState<Record<string, string>>(() => Object.fromEntries((config?.allocations ?? []).map(a => [a.job_id, String(a.quantity)])));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const productPlates = plates.filter(plate => plate.product_id === productId && plate.is_active);
  const availableJobs = jobs.filter(job => job.product_id === productId && (plateId ? job.print_plate_id === plateId : !productPlates.length && !job.print_plate_id));
  const candidate = products.find(product => product.id === preview.candidate_product_id);
  const save = async () => {
    if (busy) return; setError(""); setBusy(true); onBusy(true);
    try {
      if (!productId) throw new Error("Selecione o produto desta impressão.");
      if (productPlates.length && !productPlates.some(plate => plate.id === plateId)) throw new Error("Selecione a placa que foi impressa nesta execução.");
      if (!preview.filaments.length) throw new Error("A fonte ainda não identifica os filamentos desta impressão.");
      const selectedMaterials: BambuMaterialBinding[] = preview.filaments.map(f => {
        if (!bindings[f.source_key]) throw new Error(`Selecione o item de estoque para ${f.label}.`);
        return { source_key: f.source_key, item_id: bindings[f.source_key] };
      });
      const count = requiredBambuNumber(units, "a quantidade de peças", { positive: true, integer: true });
      const selectedJobs: BambuJobAllocation[] = Object.entries(allocations).map(([job_id, quantity]) => ({ job_id, quantity: requiredBambuNumber(quantity, "a quantidade da ordem", { positive: true, integer: true }) }));
      if (selectedJobs.some(a => !availableJobs.some(job => job.id === a.job_id))) throw new Error("As ordens selecionadas devem pertencer ao produto escolhido.");
      if (selectedJobs.length && selectedJobs.reduce((sum, a) => sum + a.quantity, 0) !== count) throw new Error("A soma das peças nas ordens deve ser igual à quantidade desta impressão.");
      await bambuRpc("configure_bambu_production", { p_task_id: task.task_id, p_product_id: productId, p_units: count, p_materials: selectedMaterials, p_auto: automatic, p_use_slicer: useSlicer,
        p_labor_cost: requiredBambuNumber(labor, "o custo de mão de obra"), p_overhead: requiredBambuNumber(overhead, "os custos indiretos"), p_extras_cost: requiredBambuNumber(extras, "o custo de acessórios e embalagem"), p_allocations: selectedJobs, p_plate_id: plateId || null });
      toast({ title: "Vínculo salvo", description: "Esta impressão pode ser apurada quando seus dados estiverem completos." }); onSaved();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível salvar o vínculo."); }
    finally { setBusy(false); onBusy(false); }
  };
  return <div className="space-y-5">
    <div className="space-y-2"><Label>Produto fabricado</Label><Select value={productId} onValueChange={value => { setProductId(value); setPlateId(""); setAllocations({}); }}><SelectTrigger aria-label="Produto fabricado"><SelectValue placeholder="Selecione o produto" /></SelectTrigger><SelectContent>{products.filter(p => p.category !== "kit").map(product => <SelectItem key={product.id} value={product.id}>{product.name}{product.sku ? ` · ${product.sku}` : ""}</SelectItem>)}</SelectContent></Select>
      {candidate && !productId && <div className="rounded-lg border bg-muted/30 p-3 text-sm"><p>{preview.candidate_source === "verified_identifiers" ? "Produto identificado pelo arquivo/perfil:" : "Sugestão encontrada na nota de importação:"} <strong>{candidate.name}</strong></p><Button variant="outline" size="sm" className="mt-2" onClick={() => { setProductId(candidate.id); setPlateId(preview.candidate_source === "verified_identifiers" ? preview.candidate_plate_id ?? "" : ""); }}>Usar este produto</Button></div>}
    </div>
    {productPlates.length > 0 && <div className="space-y-2"><Label>Placa executada</Label><Select value={plateId} onValueChange={value => { setPlateId(value); setAllocations({}); }}><SelectTrigger aria-label="Placa executada"><SelectValue placeholder="Selecione a placa desta impressão" /></SelectTrigger><SelectContent>{productPlates.map(plate => <SelectItem key={plate.id} value={plate.id}>Placa {plate.plate_index} · {plate.label}</SelectItem>)}</SelectContent></Select><p className="text-xs text-muted-foreground">Esta tentativa fabrica apenas a placa selecionada. O custo do produto completo reúne suas placas.</p></div>}
    <Field label="Peças nesta impressão" id="bambu-units" value={units} onChange={setUnits} min="1" integer />
    <div className="space-y-3"><h3 className="font-medium">Material de cada filamento</h3><p className="text-xs text-muted-foreground">Escolha o item físico do estoque. Tipo e cor exibidos servem como referência; nenhum vínculo é feito pelo nome.</p>{preview.filaments.map(f => <div key={f.source_key} className="space-y-2 rounded-lg border p-3"><Label>{f.label}</Label><p className="text-xs text-muted-foreground">Identificador: {f.source_key} · plano: {grams(f.planned_grams)}</p><Select value={bindings[f.source_key] || ""} onValueChange={value => setBindings(old => ({ ...old, [f.source_key]: value }))}><SelectTrigger aria-label={`Material de ${f.label}`}><SelectValue placeholder="Selecione o material do estoque" /></SelectTrigger><SelectContent>{materials.map(item => <SelectItem key={item.id} value={item.id}>{item.name} · {item.current_stock.toLocaleString("pt-BR")} {item.unit}</SelectItem>)}</SelectContent></Select></div>)}{!preview.filaments.length && <p role="alert" className="text-sm text-destructive">Filamentos não identificados na fonte. A impressão precisa de revisão.</p>}</div>
    <Costs labor={labor} setLabor={setLabor} overhead={overhead} setOverhead={setOverhead} extras={extras} setExtras={setExtras} />
    <div className="space-y-3 rounded-lg border p-4"><Check id="bambu-slicer" checked={useSlicer} setChecked={setUseSlicer} label="Usar consumo do fatiador após conclusão completa" /><p className="text-xs text-muted-foreground">Esse consumo é uma referência do fatiador, não uma pesagem. Falhas e impressão com objetos ignorados sempre exigem medição.</p><Check id="bambu-auto" checked={automatic} setChecked={setAutomatic} disabled={!preview.can_auto} label="Apurar automaticamente as próximas impressões deste perfil" /><p className="text-xs text-muted-foreground">Vale somente para execuções iniciadas após esta configuração, com os mesmos identificadores e materiais. As impressões antigas continuam pendentes de apuração. Sem a referência do fatiador habilitada, as novas execuções aguardam pesagem.</p>{!preview.can_auto && <p className="text-xs text-muted-foreground">A fonte não oferece identificação suficiente para automatizar este perfil.</p>}</div>
    <details className="rounded-lg border p-4"><summary className="flex cursor-pointer items-center justify-between font-medium">Vincular ordens existentes <ChevronDown className="h-4 w-4" /></summary><p className="my-3 text-xs text-muted-foreground">Opcional. Sem seleção, será criada uma ordem para esta impressão, sem receita de venda. Somente ordens do produto escolhido aparecem aqui.</p>{!availableJobs.length ? <p className="text-sm text-muted-foreground">Nenhuma ordem disponível para este produto.</p> : <div className="space-y-3">{availableJobs.map(job => <div key={job.id} className="flex flex-wrap items-center gap-3"><Check id={`bambu-job-${job.id}`} checked={job.id in allocations} setChecked={checked => setAllocations(old => { const next = { ...old }; if (checked) next[job.id] = String(job.print_plate_id ? job.planned_quantity : 1); else delete next[job.id]; return next; })} label={`${job.code} · ${job.name}`} />{job.id in allocations && <Input className="w-24" aria-label={`Peças na ordem ${job.code}`} type="number" min="1" step="1" disabled={!!job.order_item_id} value={allocations[job.id]} onChange={event => setAllocations(old => ({ ...old, [job.id]: event.target.value }))} />}</div>)}</div>}</details>
    {error && <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
    <DialogFooter><Button variant="outline" disabled={busy} onClick={onClose}>Cancelar</Button><Button disabled={busy} onClick={save}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Salvar vínculo</Button></DialogFooter>
  </div>;
}

export function BambuAccountingForm({ task, preview, materials, onClose, onSaved, onBusy }: FormProps) {
  const { toast } = useToast();
  const config = preview.record ?? preview.profile;
  const failed = preview.outcome === "failed";
  const skippedObjects = (preview.skipped_objects?.length ?? 0) > 0;
  const slicerAllowed = !!config?.use_slicer && preview.outcome === "completed" && !skippedObjects;
  const [measured, setMeasured] = useState(!slicerAllowed);
  const [weights, setWeights] = useState<Record<string, string>>({});
  const [seconds, setSeconds] = useState(preview.elapsed_seconds && preview.elapsed_seconds > 0 ? String(preview.elapsed_seconds) : "");
  const [units, setUnits] = useState(skippedObjects ? "" : String(config?.units ?? task.units ?? ""));
  const [labor, setLabor] = useState(String(config?.labor_cost ?? 0));
  const [overhead, setOverhead] = useState(String(config?.overhead ?? 0));
  const [extras, setExtras] = useState(String(config?.extras_cost ?? 0));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRef<ReturnType<typeof orderRequest> | null>(null);
  const save = async () => {
    if (busy) return; setError(""); setBusy(true); onBusy(true);
    try {
      if (!["completed", "failed"].includes(preview.outcome)) throw new Error("Somente execuções encerradas podem ser apuradas.");
      if (failed && !reason.trim()) throw new Error("Informe o motivo da interrupção ou falha.");
      if (measured && !preview.filaments.length) throw new Error("Identifique os filamentos antes de apurar a impressão.");
      const materialInputs = measured ? preview.filaments.map(f => {
        const item_id = config?.materials?.find(m => m.source_key === f.source_key)?.item_id ?? f.item_id;
        if (!item_id) throw new Error(`Configure o material de ${f.label} antes de apurar.`);
        return { source_key: f.source_key, item_id, grams: requiredBambuNumber(weights[f.source_key] ?? "", `o consumo de ${f.label}`) };
      }) : null;
      const payload = { p_task_id: task.task_id, p_materials: materialInputs, p_seconds: requiredBambuNumber(seconds, "o tempo decorrido em segundos", { positive: true }),
        p_units: failed ? null : requiredBambuNumber(units, "as peças concluídas", { positive: true, integer: true }),
        p_labor_cost: requiredBambuNumber(labor, "o custo de mão de obra"), p_overhead: requiredBambuNumber(overhead, "os custos indiretos"), p_extras_cost: requiredBambuNumber(extras, "o custo de acessórios e embalagem"), p_reason: reason.trim() || null };
      request.current = orderRequest(request.current, JSON.stringify(payload));
      const result = await bambuRpc<{ state: string; total_cost: number | null }>("account_bambu_production", { ...payload, p_request_id: request.current.id });
      if (result.state !== "posted") throw new Error("A impressão ainda requer revisão. Atualize os dados antes de apurar.");
      toast({ title: "Impressão apurada", description: `Consumo registrado uma única vez. Custo: ${money(result.total_cost)}.` }); onSaved();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível apurar esta impressão."); }
    finally { setBusy(false); onBusy(false); }
  };
  return <div className="space-y-5">
    <div className="rounded-lg border bg-muted/30 p-4 text-sm"><p className="font-medium">{task.product_name || "Produto vinculado"}</p><p className="mt-1">{failed ? "0 peças concluídas. O consumo desta tentativa será registrado como perda." : "Confirme as peças concluídas e o consumo desta execução."}</p><p className="mt-2 text-xs text-muted-foreground">Material valorizado pelo custo médio no lançamento. Custos de tentativas anteriores permanecem no histórico.</p></div>
    {slicerAllowed && <Check id="bambu-measured" checked={measured} setChecked={setMeasured} label="Informar consumo por pesagem" />}
    {!measured ? <div className="rounded-lg border border-amber-300 bg-amber-50/40 p-4 text-sm"><p className="font-medium">Fonte do consumo: referência do fatiador</p><p className="mt-1">{grams(preview.planned_grams)} planejados para a conclusão completa. Este valor não representa uma pesagem.</p></div> : <div className="space-y-3"><h3 className="font-medium">Consumo por pesagem (g)</h3><p className="text-xs text-muted-foreground">Informe tudo que saiu de cada filamento, incluindo purga, suporte e descarte. Zero é válido quando confirmado. Nenhum peso planejado será usado para preencher uma falha.</p>{preview.filaments.map(f => {
      const itemId = config?.materials?.find(m => m.source_key === f.source_key)?.item_id ?? f.item_id;
      return <div key={f.source_key} className="space-y-2 rounded-lg border p-3"><Field id={`bambu-weight-${f.source_key}`} label={`${f.label} · ${materials.find(m => m.id === itemId)?.name || "Material não configurado"}`} value={weights[f.source_key] ?? ""} onChange={value => setWeights(old => ({ ...old, [f.source_key]: value }))} /><p className="text-xs text-muted-foreground">Plano do fatiador, apenas para referência: {grams(f.planned_grams)}</p></div>;
    })}</div>}
    <div className="space-y-2"><Field id="bambu-seconds" label="Tempo decorrido (segundos)" value={seconds} onChange={setSeconds} min="0.001" /><p className="text-xs text-muted-foreground">Início ao fim: {formatBambuSeconds(preview.elapsed_seconds)}. O intervalo pode incluir pausas. O tempo previsto pelo fatiador não é usado como duração da tentativa.</p></div>
    {!failed && <Field id="bambu-completed-units" label="Peças efetivamente concluídas" value={units} onChange={setUnits} min="1" integer />}
    {skippedObjects && <p className="flex gap-2 rounded-lg bg-amber-50 p-3 text-sm"><AlertCircle className="h-4 w-4 shrink-0" />Houve objetos ignorados. Confirme a pesagem e a quantidade de peças boas.</p>}
    <Costs labor={labor} setLabor={setLabor} overhead={overhead} setOverhead={setOverhead} extras={extras} setExtras={setExtras} />
    <div className="space-y-2"><Label htmlFor="bambu-reason">{failed ? "Motivo da interrupção ou falha" : "Observação da apuração"}</Label><Textarea id="bambu-reason" value={reason} onChange={event => setReason(event.target.value)} /></div>
    <p className="text-xs text-muted-foreground">Ao apurar, os materiais serão baixados do estoque e o custo será associado às ordens vinculadas. A conclusão física ainda pode exigir acabamento e conferência.</p>
    {error && <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
    <DialogFooter><Button variant="outline" disabled={busy} onClick={onClose}>Cancelar</Button><Button disabled={busy} onClick={save}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Apurar e registrar consumo</Button></DialogFooter>
  </div>;
}

function Field({ id, label, value, onChange, min = "0", integer = false }: { id: string; label: string; value: string; onChange: (value: string) => void; min?: string; integer?: boolean }) { return <div className="space-y-2"><Label htmlFor={id}>{label}</Label><Input id={id} type="number" inputMode={integer ? "numeric" : "decimal"} min={min} step={integer ? "1" : "0.001"} value={value} onChange={event => onChange(event.target.value)} /></div>; }
function Check({ id, checked, setChecked, label, disabled }: { id: string; checked: boolean; setChecked: (value: boolean) => void; label: string; disabled?: boolean }) { return <div className="flex items-start gap-3"><Checkbox id={id} checked={checked} disabled={disabled} onCheckedChange={value => setChecked(value === true)} /><Label htmlFor={id} className="cursor-pointer text-sm font-normal leading-5">{label}</Label></div>; }
function Costs({ labor, setLabor, overhead, setOverhead, extras, setExtras }: { labor: string; setLabor: (v: string) => void; overhead: string; setOverhead: (v: string) => void; extras: string; setExtras: (v: string) => void }) { return <div className="space-y-3"><h3 className="font-medium">Outros custos desta execução</h3><div className="grid gap-3 sm:grid-cols-3"><Field id="bambu-labor" label="Mão de obra (R$)" value={labor} onChange={setLabor} /><Field id="bambu-overhead" label="Custos indiretos (R$)" value={overhead} onChange={setOverhead} /><Field id="bambu-extras" label="Acessórios e embalagem (R$)" value={extras} onChange={setExtras} /></div><p className="text-xs text-muted-foreground">Valores totais da execução; preencha zero quando não houver. Não inclua o filamento novamente em acessórios.</p></div>; }
