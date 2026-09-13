import { useState, useMemo, useRef } from "react";
import { ProductionTransitionDialog } from "@/components/production/ProductionTransitionDialog";
import { Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { estimateProductionCosts, productExtrasPerPiece, requiresProductionMeasurement, jobTransitions as nextStatuses, nonNegative } from "@/lib/production";
import { createJobs, transitionJob, productionQueryKeys, type CreateJobInput } from "@/lib/production-api";
import { orderRequest } from "@/lib/sales-order";
import { planProductPlates, readProductPlates } from "@/lib/production-plates";
import { ProductionPlatePlan } from "@/components/production/ProductionPlatePlan";
import { useAuth } from "@/contexts/AuthContext";
import { PageHeader } from "@/components/shared/PageHeader";
import {
  Plus, Search, MoreHorizontal, Play, Pause, AlertTriangle,
  CheckCircle2, Clock, Eye, Trash2, Loader2, FileText,
  Hammer, Package, Printer as PrinterIcon, Calendar,
  Timer, Weight, DollarSign, RotateCcw, ClipboardCheck,
  Truck, ArrowRight, XCircle, RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import type { Tables } from "@/integrations/supabase/types";

type JobRow = Tables<"jobs">;
type JobStatus = JobRow["status"];
type StatusFilter = JobStatus | "all";
type PrinterRow = Tables<"printers">;
type InventoryRow = Tables<"inventory_items">;
type ProductRow = Tables<"products">;

// ── Helpers ──
const fmtCurrency = (v: number | null) =>
  v != null ? v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "—";
const fmtGrams = (v: number | null) => (v != null ? `${v.toLocaleString("pt-BR")}g` : "—");
const fmtMinutes = (m: number | null) => {
  if (m == null || m === 0) return "—";
  const h = (m / 60).toFixed(1).replace(".", ",");
  return `${h}h`;
};
const fmtDate = (d: string | null) => {
  if (!d) return "—";
  return new Date(d.length === 10 ? `${d}T12:00:00` : d).toLocaleDateString("pt-BR");
};

const statusConfig: Record<JobStatus, { label: string; color: string; icon: React.ComponentType<{ className?: string }> }> = {
  draft: { label: "Rascunho", color: "bg-muted text-muted-foreground border border-border", icon: FileText },
  queued: { label: "Na fila", color: "badge-info", icon: Clock },
  printing: { label: "Imprimindo", color: "badge-success", icon: Play },
  paused: { label: "Pausado", color: "badge-warning", icon: Pause },
  failed: { label: "Falhou", color: "badge-destructive", icon: XCircle },
  reprint: { label: "Reimpressão", color: "badge-warning", icon: RotateCcw },
  post_processing: { label: "Pós-processo", color: "bg-accent text-accent-foreground border border-border", icon: Hammer },
  quality_check: { label: "QC", color: "badge-info", icon: ClipboardCheck },
  ready: { label: "Pronto", color: "badge-success", icon: CheckCircle2 },
  shipped: { label: "Enviado", color: "bg-muted text-muted-foreground border border-border", icon: Truck },
  completed: { label: "Concluído", color: "badge-success", icon: CheckCircle2 },
};

function JobStatusBadge({ status }: { status: JobStatus }) {
  const cfg = statusConfig[status];
  const Icon = cfg.icon;
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold", cfg.color)}>
      <Icon className="h-3 w-3" />
      {cfg.label}
    </span>
  );
}

// ── Main Component ──
export default function Jobs() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [detailJob, setDetailJob] = useState<JobRow | null>(null);
  const [transition, setTransition] = useState<{ job: JobRow; status: JobStatus } | null>(null);

  // ── Fetch jobs ──
  const { data: jobs = [], isLoading, error: loadError, refetch } = useQuery({
    queryKey: ["jobs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("jobs")
        .select("*, orders(code)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!profile,
  });

  // ── Fetch printers for selects ──
  const { data: printers = [] } = useQuery({
    queryKey: ["printers"],
    queryFn: async () => {
      const { data, error } = await supabase.from("printers").select("*").eq("is_active", true).order("name");
      if (error) throw error;
      return data;
    },
    enabled: !!profile,
  });

  // ── Fetch materials for selects ──
  const { data: materials = [] } = useQuery({
    queryKey: ["inventory_items"],
    queryFn: async () => {
      const { data, error } = await supabase.from("inventory_items").select("*").eq("is_active", true).order("name");
      if (error) throw error;
      return data;
    },
    enabled: !!profile,
  });

  // ── Fetch products for selects ──
  const { data: products = [] } = useQuery({
    queryKey: ["products"],
    queryFn: async () => {
      const { data, error } = await supabase.from("products").select("*").eq("is_active", true).order("name");
      if (error) throw error;
      return data as ProductRow[];
    },
    enabled: !!profile,
  });

  // ── Delete job ──
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("jobs").delete().eq("id", id).eq("status", "draft").is("started_at", null).select("id").single();
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      toast({ title: "OI removida" });
    },
    onError: (err: Error) => {
      toast({ variant: "destructive", title: "Erro ao remover", description: err.message });
    },
  });

  const statusMutation = useMutation({
    mutationFn: transitionJob,
    onSuccess: () => {
      productionQueryKeys.forEach(key => queryClient.invalidateQueries({ queryKey: [key] }));
      setTransition(null);
      setDetailJob(null);
      toast({ title: "Produção atualizada", description: "Status, custos e movimentações registrados juntos." });
    },
    onError: (err: Error) => toast({ variant: "destructive", title: "Não foi possível atualizar", description: err.message }),
  });

  const requestTransition = (job: JobRow, status: JobStatus) => {
    if (["failed", "printing"].includes(status) || requiresProductionMeasurement(status, (job as unknown as { inventory_posted_at?: string }).inventory_posted_at)) setTransition({ job, status });
    else statusMutation.mutate({ id: job.id, status });
  };

  // ── Computed ──
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: jobs.length };
    Object.keys(statusConfig).forEach(s => { c[s] = 0; });
    jobs.forEach(j => { c[j.status]++; });
    return c;
  }, [jobs]);

  const filtered = useMemo(() => {
    return jobs.filter((j) => {
      if (statusFilter !== "all" && j.status !== statusFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        return (
          j.code.toLowerCase().includes(q) ||
          j.name.toLowerCase().includes(q) ||
          (j.description || "").toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [jobs, statusFilter, search]);

  // ── Active KPIs ──
  const activeFilters: { status: StatusFilter; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { status: "all", label: "Todas", icon: FileText },
    { status: "queued", label: "Na fila", icon: Clock },
    { status: "printing", label: "Imprimindo", icon: Play },
    { status: "failed", label: "Falhou", icon: XCircle },
    { status: "completed", label: "Concluídas", icon: CheckCircle2 },
  ];

  const getPrinterName = (id: string | null) => {
    if (!id) return "Sem impressora";
    return printers.find(p => p.id === id)?.name ?? "—";
  };
  const getMaterialName = (id: string | null) => {
    if (!id) return "—";
    const m = materials.find(m => m.id === id);
    return m ? `${m.name}${m.color ? ` (${m.color})` : ""}` : "—";
  };

  if (loadError) return <div className="space-y-4 rounded-xl border bg-card p-6"><p role="alert" className="font-medium">Não foi possível carregar os dados.</p><p className="text-sm text-muted-foreground">{loadError.message}</p><Button variant="outline" onClick={() => refetch()}>Tentar novamente</Button></div>;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Ordens de Impressão"
        description="Gerencie a produção: crie, acompanhe e apure custos reais de cada OI."
        breadcrumbs={[{ label: "Produção" }, { label: "Jobs" }]}
      />

      {/* KPI Filter Strip */}
      <div className="flex flex-wrap gap-2">
        {activeFilters.map(({ status, label, icon: Icon }) => (
          <button
            key={status}
            onClick={() => setStatusFilter(status)}
            className={cn(
              "kpi-card cursor-pointer transition-all hover:shadow-md flex items-center gap-2 px-4 py-2.5 rounded-lg min-w-[100px]",
              statusFilter === status && "ring-2 ring-primary shadow-md"
            )}
          >
            <Icon className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">{label}</span>
            <span className="text-lg font-bold ml-auto">{counts[status] ?? 0}</span>
          </button>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar OI por código, nome..."
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4 mr-2" /> Nova OI
        </Button>
      </div>

      {/* Table */}
      <div className="rounded-lg border bg-card overflow-hidden">
        <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[100px]">Código</TableHead>
              <TableHead>Peça / Descrição</TableHead>
              <TableHead>Material</TableHead>
              <TableHead className="text-center">Qtd</TableHead>
              <TableHead>Impressora</TableHead>
              <TableHead>SLA</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">ETA</TableHead>
              <TableHead className="text-right">Custo Est.</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={10} className="text-center py-16">
                  <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
                </TableCell>
              </TableRow>
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={10} className="text-center py-16 text-muted-foreground">
                  Nenhuma OI encontrada
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((job) => (
                <TableRow key={job.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setDetailJob(job)}>
                  <TableCell className="font-mono text-xs font-semibold">
                    <div>{job.code}</div>
                    {(job as any).orders?.code && (
                      <span className="text-[10px] text-primary font-normal">{(job as any).orders.code}</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div>
                      <p className="font-medium text-sm">{job.name}</p>
                      {job.description && (
                        <p className="text-xs text-muted-foreground truncate max-w-[200px]">{job.description}</p>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm">{getMaterialName(job.material_id)}</TableCell>
                  <TableCell className="text-center text-sm">1 OI</TableCell>
                  <TableCell className="text-sm">{getPrinterName(job.printer_id)}</TableCell>
                  <TableCell className="text-sm">{fmtDate(job.due_date)}</TableCell>
                  <TableCell><JobStatusBadge status={job.status} /></TableCell>
                  <TableCell className="text-right text-sm">{fmtMinutes(job.est_time_minutes)}</TableCell>
                  <TableCell className="text-right text-sm font-medium">{fmtCurrency(job.est_total_cost)}</TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => setDetailJob(job)}>
                          <Eye className="h-4 w-4 mr-2" /> Ver detalhes
                        </DropdownMenuItem>
                        {nextStatuses[job.status].length > 0 && (
                          <>
                            <DropdownMenuSeparator />
                            {nextStatuses[job.status].map((ns) => (
                              <DropdownMenuItem
                                key={ns}
                                disabled={statusMutation.isPending} onClick={() => requestTransition(job, ns)}
                              >
                                <ArrowRight className="h-4 w-4 mr-2" /> {statusConfig[ns].label}
                              </DropdownMenuItem>
                            ))}
                          </>
                        )}
                        <DropdownMenuSeparator />
                        {job.status === "draft" && !job.started_at && <DropdownMenuItem
                          className="text-destructive" disabled={deleteMutation.isPending}
                          onClick={() => { if (window.confirm(`Excluir o rascunho ${job.code}?`)) deleteMutation.mutate(job.id); }}
                        >
                          <Trash2 className="h-4 w-4 mr-2" /> Excluir rascunho
                        </DropdownMenuItem>}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
        </div>
      </div>

      {transition && <ProductionTransitionDialog key={`${transition.job.id}-${transition.status}`} value={transition} printers={printers} pending={statusMutation.isPending} onClose={() => setTransition(null)} onSave={value => statusMutation.mutate(value)} />}
      {/* Dialogs */}
      <CreateJobDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        printers={printers}
        materials={materials}
        products={products}
      />
      {detailJob && (
        <JobDetailDialog
          job={detailJob}
          onClose={() => setDetailJob(null)}
          printers={printers}
          materials={materials}
          onStatusChange={(status) => requestTransition(detailJob, status)}
        />
      )}
    </div>
  );
}

// ── Create Job Dialog ──
function CreateJobDialog({
  open,
  onOpenChange,
  printers,
  materials,
  products,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  printers: PrinterRow[];
  materials: InventoryRow[];
  products: ProductRow[];
}) {
  const { profile } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [productId, setProductId] = useState("");
  const [setQuantity, setSetQuantity] = useState("1");
  const plateQuery = useQuery({ queryKey: ["product_print_plates", profile?.tenant_id, productId], enabled: !!profile && !!productId && open, queryFn: () => readProductPlates(productId) });
  const hasPlates = !!plateQuery.data?.length;
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [materialId, setMaterialId] = useState("");
  const [secondaryMaterialId, setSecondaryMaterialId] = useState("");
  const [printerId, setPrinterId] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [priority, setPriority] = useState("5");
  const [estTimeMinutes, setEstTimeMinutes] = useState("");
  const [estGrams, setEstGrams] = useState("");
  const [numColors, setNumColors] = useState("1");
  const [salePrice, setSalePrice] = useState("");
  const [purgeWasteGrams, setPurgeWasteGrams] = useState("");
  const [saving, setSaving] = useState(false);
  const creationRequest = useRef<ReturnType<typeof orderRequest> | null>(null);

  const PURGE_GRAMS_PER_COLOR_CHANGE = 20;

  const reset = () => {
    creationRequest.current = null;
    setSetQuantity("1");
    setProductId(""); setName(""); setDescription(""); setMaterialId(""); setSecondaryMaterialId("");
    setPrinterId(""); setDueDate(""); setPriority("5"); setEstTimeMinutes(""); setEstGrams("");
    setNumColors("1"); setPurgeWasteGrams(""); setSalePrice("");
  };

  const handleProductSelect = (id: string) => {
    setProductId(id);
    if (!id) return;
    const p = products.find(pr => pr.id === id);
    if (!p) return;
    setName(p.name);
    setSalePrice(p.sale_price == null ? "" : String(p.sale_price * Math.max(1, p.prints_per_plate ?? 1)));
    setDescription(p.description || "");
    if (p.material_id) setMaterialId(p.material_id);
    if (p.est_time_minutes) setEstTimeMinutes((p.est_time_minutes / 60).toFixed(2));
    if (p.est_grams) setEstGrams(String(p.est_grams));
    const colors = (p as any).num_colors || 1;
    setNumColors(String(colors));
    if (colors > 1) {
      setPurgeWasteGrams(String((colors - 1) * PURGE_GRAMS_PER_COLOR_CHANGE));
    } else {
      setPurgeWasteGrams(""); setSecondaryMaterialId("");
    }
  };

  const handleColorsChange = (v: string) => {
    setNumColors(v);
    const c = parseInt(v) || 1;
    if (c > 1) {
      setPurgeWasteGrams(String((c - 1) * PURGE_GRAMS_PER_COLOR_CHANGE));
    } else {
      setPurgeWasteGrams(""); setSecondaryMaterialId("");
    }
  };

  const handleSave = async () => {
    if (saving) return;
    if (!name.trim()) {
      toast({ variant: "destructive", title: "Nome da peça é obrigatório" });
      return;
    }
    if (!profile?.tenant_id) return;
    setSaving(true);
    try {
      if (productId && plateQuery.isFetching) throw new Error("Aguarde a consulta das placas do produto.");
      if (productId && plateQuery.error) throw plateQuery.error;
      if (hasPlates) {
        const quantity = Number(setQuantity);
        if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10000) throw new Error("Informe entre 1 e 10.000 conjuntos inteiros.");
        creationRequest.current = orderRequest(creationRequest.current, JSON.stringify({ product_id: productId, quantity, mode: "product_plates" }));
        const ids = await planProductPlates(productId, quantity, creationRequest.current.id);
        productionQueryKeys.forEach(key => queryClient.invalidateQueries({ queryKey: [key] }));
        toast({ title: "Conjunto planejado", description: `${ids.length} ordens criadas com as receitas de cada placa.` });
        reset(); onOpenChange(false); return;
      }
      const grams = estGrams === "" ? null : nonNegative(estGrams, "Peso estimado");
      const minutes = estTimeMinutes === "" ? null : Math.round(nonNegative(estTimeMinutes, "Tempo estimado") * 60);
      const colors = Number(numColors);
      const purge = nonNegative(purgeWasteGrams, "Purga");
      const { data: tenant, error: tenantError } = await supabase.from("tenants").select("settings").eq("id", profile.tenant_id).single();
      if (tenantError) throw tenantError;
      const settings = tenant.settings as Record<string, unknown> | null;
      const selectedProduct = products.find(product => product.id === productId);
      if (selectedProduct?.category === "kit") throw new Error("Crie um pedido para o kit. O planejamento do pedido separa os componentes para apurar cada impressão.");
      const costs = estimateProductionCosts({
        extras: productExtrasPerPiece(selectedProduct?.extras) * Math.max(1, selectedProduct?.prints_per_plate ?? 1),
        energyRate: nonNegative(settings?.energy_cost_kwh as number | undefined, "Tarifa de energia", 0.85),
        grams: grams ?? 0, minutes: minutes ?? 0, purgeGrams: purge,
        material: materials.find(m => m.id === materialId),
        purgeMaterial: materials.find(m => m.id === secondaryMaterialId),
        printer: printers.find(p => p.id === printerId),
      });
      const rows: CreateJobInput[] = [{
        name: name.trim(),
        description: description.trim() || null,
        product_id: productId || null,
        sale_price: salePrice === "" ? null : nonNegative(salePrice, "Receita atribuída"),
        material_id: materialId || null,
        secondary_material_id: secondaryMaterialId || null,
        printer_id: printerId || null,
        due_date: dueDate || null,
        priority: Number(priority),
        est_time_minutes: minutes,
        est_grams: grams,
        num_colors: colors,
        purge_waste_grams: purge,
        est_material_cost: costs.material,
        est_machine_cost: costs.machine,
        est_energy_cost: costs.energy,
        est_total_cost: costs.total,
        est_extras_cost: costs.extras,
        status: "draft",
      }];

      creationRequest.current = orderRequest(creationRequest.current, JSON.stringify(rows));
      await createJobs(rows, creationRequest.current.id);
      productionQueryKeys.forEach(key => queryClient.invalidateQueries({ queryKey: [key] }));
      toast({ title: "OI criada", description: "Ordem salva como rascunho." });
      reset();
      onOpenChange(false);
    } catch (err: any) {
      toast({ variant: "destructive", title: "Erro ao criar OI", description: err.message });
    } finally {
      setSaving(false);
    }
  };

  const isMultiColor = parseInt(numColors) > 1;

  return (
    <Dialog open={open} onOpenChange={next => { if (!saving) onOpenChange(next); }}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nova Ordem de Impressão</DialogTitle>
          <DialogDescription>{hasPlates ? "O conjunto cria ordens para todas as placas cadastradas no SKU, com material, impressora, tempo e custo próprios." : "Uma ordem representa uma placa de impressão. Peso e tempo são totais da placa. Os custos usam a tarifa da empresa; se não configurada, a referência é R$ 0,85/kWh."}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid gap-1.5">
            <Label htmlFor="job-product">Produto cadastrado</Label>
            <Select value={productId || "none"} onValueChange={(v) => handleProductSelect(v === "none" ? "" : v)}>
              <SelectTrigger id="job-product"><SelectValue placeholder="Selecionar produto..." /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">— Nenhum (manual) —</SelectItem>
                {products.map(p => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}{p.sku ? ` (${p.sku})` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {plateQuery.isFetching && <p className="text-sm text-muted-foreground">Consultando as placas do produto…</p>}
          {plateQuery.error && <p role="alert" className="text-sm text-destructive">Não foi possível consultar as placas. {plateQuery.error.message}</p>}
          {hasPlates ? <>
            <div className="grid gap-1.5"><Label htmlFor="job-set-quantity">Quantidade de conjuntos / SKUs</Label><Input id="job-set-quantity" type="number" min="1" max="10000" step="1" value={setQuantity} onChange={event => setSetQuantity(event.target.value)} /></div>
            <ProductionPlatePlan plates={plateQuery.data!} quantity={setQuantity} materials={materials} printers={printers} />
          </> : <>
          <div className="grid gap-1.5">
            <Label>Peça / Nome *</Label>
            <Input placeholder="Ex: Suporte GoPro v2" value={name} onChange={e => setName(e.target.value)} />
          </div>

          <div className="grid gap-1.5">
            <Label>Descrição</Label>
            <Textarea placeholder="Detalhes, observações do cliente..." value={description} onChange={e => setDescription(e.target.value)} rows={2} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>Nº de Cores</Label>
              <Select value={numColors} onValueChange={handleColorsChange}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">1 cor</SelectItem>
                  <SelectItem value="2">2 cores</SelectItem>
                  <SelectItem value="3">3 cores</SelectItem>
                  <SelectItem value="4">4 cores (AMS)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {isMultiColor && (
              <div className="grid gap-1.5">
                <Label>Perda purga/torre (g)</Label>
                <Input type="number" placeholder="20" value={purgeWasteGrams} onChange={e => setPurgeWasteGrams(e.target.value)} />
              </div>
            )}
          </div>

          <div className={cn("grid gap-3", isMultiColor ? "grid-cols-1" : "grid-cols-2")}>
            <div className="grid gap-1.5">
              <Label>{isMultiColor ? "Material principal (cor 1)" : "Material"}</Label>
              <Select value={materialId} onValueChange={setMaterialId}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  {materials.map(m => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.name}{m.color ? ` (${m.color})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {isMultiColor && (
              <div className="grid gap-1.5">
                <Label>Material secundário (cor 2+)</Label>
                <Select value={secondaryMaterialId || "same"} onValueChange={(v) => setSecondaryMaterialId(v === "same" ? "" : v)}>
                  <SelectTrigger><SelectValue placeholder="Mesmo que principal" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="same">Mesmo que principal</SelectItem>
                    {materials.map(m => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.name}{m.color ? ` (${m.color})` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {!isMultiColor && (
              <div className="grid gap-1.5">
                <Label>Impressora</Label>
                <Select value={printerId || "pool"} onValueChange={(v) => setPrinterId(v === "pool" ? "" : v)}>
                  <SelectTrigger><SelectValue placeholder="Sem impressora" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pool">Sem impressora</SelectItem>
                    {printers.map(p => (
                      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          {isMultiColor && (
            <>
              <div className="grid gap-1.5">
                <Label>Impressora</Label>
                <Select value={printerId || "pool"} onValueChange={(v) => setPrinterId(v === "pool" ? "" : v)}>
                  <SelectTrigger><SelectValue placeholder="Sem impressora" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pool">Sem impressora</SelectItem>
                    {printers.map(p => (
                      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  <AlertTriangle className="h-3 w-3 inline mr-1" />
                  Preencha a purga informada pelo fatiador. O valor sugerido é apenas uma previsão e deve ser conferido para cada placa.
                </p>
              </div>
            </>
          )}

          <div className="grid grid-cols-3 gap-3">
            <div className="grid gap-1.5">
              <Label>Tempo est. (h)</Label>
              <Input type="number" step="0.1" placeholder="2.5" value={estTimeMinutes} onChange={e => setEstTimeMinutes(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label>Gramas est.</Label>
              <Input type="number" placeholder="85" value={estGrams} onChange={e => setEstGrams(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label>Prioridade</Label>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">Urgente</SelectItem>
                  <SelectItem value="3">Alta</SelectItem>
                  <SelectItem value="5">Normal</SelectItem>
                  <SelectItem value="8">Baixa</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-1.5"><Label>Receita atribuída à placa (R$)</Label><Input type="number" min="0" step="0.01" value={salePrice} onChange={event => setSalePrice(event.target.value)} placeholder="Opcional para produção em estoque" /><p className="text-xs text-muted-foreground">Total das peças da placa. Deixe vazio quando ainda não há venda atribuída.</p></div>
          <div className="grid gap-1.5">
            <Label>Data prometida</Label>
            <Input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} />
          </div>
          </>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancelar</Button>
          <Button onClick={handleSave} disabled={saving || plateQuery.isFetching || !!plateQuery.error}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {hasPlates ? "Planejar conjunto completo" : "Criar OI"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Job Detail Dialog ──
function JobDetailDialog({
  job,
  onClose,
  printers,
  materials,
  onStatusChange,
}: {
  job: JobRow;
  onClose: () => void;
  printers: PrinterRow[];
  materials: InventoryRow[];
  onStatusChange: (status: JobStatus) => void;
}) {
  const getPrinterName = (id: string | null) => {
    if (!id) return "Sem impressora";
    return printers.find(p => p.id === id)?.name ?? "—";
  };
  const getMaterialName = (id: string | null) => {
    if (!id) return "—";
    const m = materials.find(m => m.id === id);
    return m ? `${m.name}${m.color ? ` (${m.color})` : ""}` : "—";
  };

  const priorityLabel = (p: number) => {
    if (p <= 1) return "🔴 Expedite";
    if (p <= 3) return "🟠 Alta";
    if (p <= 5) return "🟢 Normal";
    return "⚪ Baixa";
  };

  const available = nextStatuses[job.status];

  return (
    <Dialog open onOpenChange={() => onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <Hammer className="h-5 w-5 text-muted-foreground" />
            <div>
              <DialogTitle className="text-lg">{job.code} — {job.name}</DialogTitle>
              {job.description && (
                <DialogDescription className="mt-0.5">{job.description}</DialogDescription>
              )}
            </div>
          </div>
        </DialogHeader>

        <Tabs defaultValue="resumo" className="mt-2">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="resumo">Resumo</TabsTrigger>
            <TabsTrigger value="execucao">Execução</TabsTrigger>
            <TabsTrigger value="custo">Consumo & Custo</TabsTrigger>
          </TabsList>

          {/* ── Resumo ── */}
          <TabsContent value="resumo" className="space-y-4 pt-2">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Status</span>
              <JobStatusBadge status={job.status} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
              <InfoRow icon={PrinterIcon} label="Impressora" value={getPrinterName(job.printer_id)} />
              <InfoRow icon={Package} label="Material" value={getMaterialName(job.material_id)} />
              <InfoRow icon={Calendar} label="SLA" value={fmtDate(job.due_date)} />
              <InfoRow icon={AlertTriangle} label="Prioridade" value={priorityLabel(job.priority)} />
              <InfoRow icon={Timer} label="Tempo estimado" value={fmtMinutes(job.est_time_minutes)} />
              <InfoRow icon={Weight} label="Gramas est." value={fmtGrams(job.est_grams)} />
              {job.order_id && (
                <div className="flex items-center gap-2 col-span-2">
                  <FileText className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                  <span className="text-muted-foreground">Pedido:</span>
                  <Link
                    to="/comercial/pedidos"
                    className="ml-auto text-primary font-medium text-sm hover:underline flex items-center gap-1"
                    onClick={onClose}
                  >
                    {(job as any).orders?.code || "Vinculado"} <ArrowRight className="h-3 w-3" />
                  </Link>
                </div>
              )}
            </div>

            {available.length > 0 && (
              <div className="border-t pt-4">
                <p className="text-xs text-muted-foreground mb-2">Transições disponíveis:</p>
                <div className="flex flex-wrap gap-2">
                  {available.map((ns) => {
                    const cfg = statusConfig[ns];
                    return (
                      <Button
                        key={ns}
                        size="sm"
                        variant="outline"
                        onClick={() => onStatusChange(ns)}
                        className="text-xs"
                      >
                        <ArrowRight className="h-3 w-3 mr-1" />
                        {cfg.label}
                      </Button>
                    );
                  })}
                </div>
              </div>
            )}
          </TabsContent>

          {/* ── Execução ── */}
          <TabsContent value="execucao" className="space-y-4 pt-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
              <InfoRow icon={Clock} label="Criado em" value={new Date(job.created_at).toLocaleString("pt-BR")} />
              <InfoRow icon={Play} label="Iniciado em" value={job.started_at ? new Date(job.started_at).toLocaleString("pt-BR") : "—"} />
              <InfoRow icon={CheckCircle2} label="Concluído em" value={job.completed_at ? new Date(job.completed_at).toLocaleString("pt-BR") : "—"} />
              <InfoRow icon={Timer} label="Tempo real" value={fmtMinutes(job.actual_time_minutes)} />
              <InfoRow icon={Weight} label="Gramas reais" value={fmtGrams(job.actual_grams)} />
              <InfoRow icon={AlertTriangle} label="Perda medida" value={fmtGrams(job.waste_grams)} />
            </div>
            {job.failure_reason && (
              <div className="rounded-lg bg-destructive/10 border border-destructive/20 p-3">
                <p className="text-xs font-semibold text-destructive mb-1">Motivo da falha</p>
                <p className="text-sm">{job.failure_reason}</p>
              </div>
            )}
          </TabsContent>

          {/* ── Consumo & Custo ── */}
          <TabsContent value="custo" className="space-y-4 pt-2">
            <div className="rounded-lg border overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/50">
                    <th className="text-left p-2 font-medium">Item</th>
                    <th className="text-right p-2 font-medium">Estimado</th>
                    <th className="text-right p-2 font-medium">Real</th>
                  </tr>
                </thead>
                <tbody>
                  <CostRow label="Material" est={job.est_material_cost} actual={job.actual_material_cost} />
                  <CostRow label="Máquina" est={job.est_machine_cost} actual={job.actual_machine_cost} />
                  <CostRow label="Energia" est={job.est_energy_cost} actual={job.actual_energy_cost} />
                  <CostRow label="Mão de obra" est={job.est_labor_cost} actual={job.actual_labor_cost} />
                  <CostRow label="Custos indiretos" est={job.est_overhead} actual={job.actual_overhead} />
                  <CostRow label="Acessórios e embalagem" est={(job as unknown as { est_extras_cost?: number }).est_extras_cost ?? null} actual={(job as unknown as { actual_extras_cost?: number }).actual_extras_cost ?? null} />
                  <tr className="font-bold border-t">
                    <td className="p-2">Total</td>
                    <td className="text-right p-2">{fmtCurrency(job.est_total_cost)}</td>
                    <td className="text-right p-2">{fmtCurrency(job.actual_total_cost)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            {job.sale_price != null && job.sale_price > 0 && (
              <div className="flex items-center justify-between text-sm p-3 rounded-lg bg-muted/50">
                <span>Preço de venda</span>
                <span className="font-bold">{fmtCurrency(job.sale_price)}</span>
              </div>
            )}
            {job.margin_percent != null && (
              <div className="flex items-center justify-between text-sm p-3 rounded-lg bg-muted/50">
                <span>Margem</span>
                <span className={cn("font-bold", job.margin_percent >= 0 ? "text-success" : "text-destructive")}>
                  {job.margin_percent.toFixed(1)}%
                </span>
              </div>
            )}
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Small helpers ──
function InfoRow({ icon: Icon, label, value }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="h-4 w-4 text-muted-foreground flex-shrink-0" />
      <span className="text-muted-foreground">{label}:</span>
      <span className="font-medium ml-auto text-right">{value}</span>
    </div>
  );
}

function CostRow({ label, est, actual }: { label: string; est: number | null; actual: number | null }) {
  return (
    <tr className="border-t">
      <td className="p-2">{label}</td>
      <td className="text-right p-2">{fmtCurrency(est)}</td>
      <td className="text-right p-2">{fmtCurrency(actual)}</td>
    </tr>
  );
}
