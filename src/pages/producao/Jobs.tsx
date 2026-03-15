import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
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
  return new Date(d).toLocaleDateString("pt-BR");
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

// Status transitions
const nextStatuses: Record<JobStatus, JobStatus[]> = {
  draft: ["queued"],
  queued: ["printing", "draft"],
  printing: ["paused", "failed", "post_processing", "quality_check", "completed"],
  paused: ["printing", "failed"],
  failed: ["reprint", "draft"],
  reprint: ["queued"],
  post_processing: ["quality_check", "completed"],
  quality_check: ["ready", "failed"],
  ready: ["shipped", "completed"],
  shipped: ["completed"],
  completed: [],
};

// ── Main Component ──
export default function Jobs() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [detailJob, setDetailJob] = useState<JobRow | null>(null);

  // ── Fetch jobs ──
  const { data: jobs = [], isLoading } = useQuery({
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
      const { error } = await supabase.from("jobs").delete().eq("id", id);
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

  // ── Update status ──
  const statusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: JobStatus }) => {
      // Fetch current job data
      const { data: job, error: fetchErr } = await supabase.from("jobs").select("*").eq("id", id).single();
      if (fetchErr || !job) throw fetchErr || new Error("Job não encontrado");

      const updates: Record<string, unknown> = { status };
      if (status === "printing" || status === "reprint") {
        updates.started_at = new Date().toISOString();
      }
      if (status === "completed" || status === "shipped") {
        updates.completed_at = new Date().toISOString();
      }

      // ── Ao concluir: calcular custos reais + consumir estoque ──
      if (status === "completed" && profile) {
        const actualGrams = job.actual_grams || job.est_grams;
        const actualMinutes = job.actual_time_minutes || job.est_time_minutes;

        // Calculate actual costs
        let actualMaterialCost = 0;
        if (actualGrams && job.material_id) {
          const mat = materials.find(m => m.id === job.material_id);
          if (mat && mat.avg_cost > 0) {
            const costPerGram = mat.unit === "kg" ? mat.avg_cost / 1000 : mat.avg_cost;
            actualMaterialCost = actualGrams * (1 + (mat.loss_coefficient || 0.05)) * costPerGram;
          }
        }

        let actualMachineCost = 0;
        let actualEnergyCost = 0;
        if (actualMinutes && job.printer_id) {
          const printer = printers.find(p => p.id === job.printer_id);
          if (printer) {
            const hours = actualMinutes / 60;
            actualMachineCost = hours * (printer.depreciation_per_hour ?? 0) + hours * (printer.maintenance_cost_per_hour ?? 0);
            actualEnergyCost = ((printer.power_watts ?? 150) / 1000) * hours * 0.85;
          }
        }

        const actualTotalCost = actualMaterialCost + actualMachineCost + actualEnergyCost;
        updates.actual_material_cost = actualMaterialCost;
        updates.actual_machine_cost = actualMachineCost;
        updates.actual_energy_cost = actualEnergyCost;
        updates.actual_total_cost = actualTotalCost;
        if (!job.actual_grams) updates.actual_grams = actualGrams;
        if (!job.actual_time_minutes) updates.actual_time_minutes = actualMinutes;

        // Calculate margin
        if (job.sale_price && job.sale_price > 0) {
          updates.margin_percent = ((job.sale_price - actualTotalCost) / job.sale_price) * 100;
        }

        // ── Consumir estoque (inventory_movement) ──
        if (actualGrams && job.material_id && actualGrams > 0) {
          const lossCoeff = materials.find(m => m.id === job.material_id)?.loss_coefficient || 0.05;
          const totalConsumption = actualGrams * (1 + lossCoeff) + (job.purge_waste_grams || 0);

          await supabase.from("inventory_movements").insert({
            tenant_id: profile.tenant_id,
            item_id: job.material_id,
            movement_type: "job_consumption" as const,
            quantity: totalConsumption,
            unit_cost: materials.find(m => m.id === job.material_id)?.avg_cost || 0,
            reference_type: "job",
            reference_id: id,
            notes: `Consumo automático — ${job.code}`,
            created_by: profile.user_id,
          });
        }
      }

      const { error } = await supabase.from("jobs").update(updates).eq("id", id);
      if (error) throw error;

      // ── Sync: se todos os jobs do pedido estão concluídos, marcar pedido como "ready" ──
      if (status === "completed" && job.order_id) {
        const { data: siblingJobs } = await supabase
          .from("jobs")
          .select("id, status")
          .eq("order_id", job.order_id);

        const allDone = siblingJobs?.every(
          (j) => j.id === id ? true : j.status === "completed" || j.status === "shipped"
        );

        if (allDone) {
          await supabase.from("orders").update({ status: "ready" }).eq("id", job.order_id);
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      queryClient.invalidateQueries({ queryKey: ["inventory_items"] });
      setDetailJob(null);
      toast({ title: "Status atualizado" });
    },
    onError: (err: Error) => {
      toast({ variant: "destructive", title: "Erro", description: err.message });
    },
  });

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
    if (!id) return "Pool (auto)";
    return printers.find(p => p.id === id)?.name ?? "—";
  };
  const getMaterialName = (id: string | null) => {
    if (!id) return "—";
    const m = materials.find(m => m.id === id);
    return m ? `${m.name}${m.color ? ` (${m.color})` : ""}` : "—";
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Ordens de Impressão"
        description="Gerencie a produção: crie, acompanhe e apure custos reais de cada OI."
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
                  <TableCell className="text-center text-sm">—</TableCell>
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
                                onClick={() => statusMutation.mutate({ id: job.id, status: ns })}
                              >
                                <ArrowRight className="h-4 w-4 mr-2" /> {statusConfig[ns].label}
                              </DropdownMenuItem>
                            ))}
                          </>
                        )}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-destructive"
                          onClick={() => deleteMutation.mutate(job.id)}
                        >
                          <Trash2 className="h-4 w-4 mr-2" /> Excluir
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

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
          onStatusChange={(status) => statusMutation.mutate({ id: detailJob.id, status })}
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
  const [purgeWasteGrams, setPurgeWasteGrams] = useState("");
  const [saving, setSaving] = useState(false);

  const PURGE_GRAMS_PER_COLOR_CHANGE = 20;

  const reset = () => {
    setProductId(""); setName(""); setDescription(""); setMaterialId(""); setSecondaryMaterialId("");
    setPrinterId(""); setDueDate(""); setPriority("5"); setEstTimeMinutes(""); setEstGrams("");
    setNumColors("1"); setPurgeWasteGrams("");
  };

  const handleProductSelect = (id: string) => {
    setProductId(id);
    if (!id) return;
    const p = products.find(pr => pr.id === id);
    if (!p) return;
    setName(p.name);
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
    if (!name.trim()) {
      toast({ variant: "destructive", title: "Nome da peça é obrigatório" });
      return;
    }
    if (!profile?.tenant_id) return;
    setSaving(true);
    try {
      const now = new Date();
      const datePart = now.toISOString().slice(0, 10).replace(/-/g, "");
      const { count } = await supabase
        .from("jobs")
        .select("*", { count: "exact", head: true })
        .eq("tenant_id", profile.tenant_id);
      const seq = String((count ?? 0) + 1).padStart(3, "0");
      const code = `OI-${datePart}-${seq}`;

      const grams = estGrams ? Number(estGrams) : null;
      const minutes = estTimeMinutes ? Math.round(Number(estTimeMinutes) * 60) : null;
      const colors = parseInt(numColors) || 1;
      const purge = parseFloat(purgeWasteGrams) || 0;

      let estMaterialCost = 0;
      if (grams && materialId) {
        const mat = materials.find(m => m.id === materialId);
        if (mat && mat.avg_cost > 0) {
          const isKg = mat.unit === "kg";
          const costPerGram = isKg ? mat.avg_cost / 1000 : mat.avg_cost;
          const lossCoeff = (mat as any).loss_coefficient || 0.05;
          estMaterialCost = grams * (1 + lossCoeff) * costPerGram;
        }
      }
      if (colors > 1 && purge > 0) {
        const purgeMat = secondaryMaterialId
          ? materials.find(m => m.id === secondaryMaterialId)
          : materials.find(m => m.id === materialId);
        if (purgeMat && purgeMat.avg_cost > 0) {
          const isKg = purgeMat.unit === "kg";
          const costPerGram = isKg ? purgeMat.avg_cost / 1000 : purgeMat.avg_cost;
          estMaterialCost += purge * costPerGram;
        }
      }

      let estMachineCost = 0;
      if (minutes && printerId) {
        const printer = printers.find(p => p.id === printerId);
        if (printer) {
          const hours = minutes / 60;
          estMachineCost = hours * (printer.depreciation_per_hour ?? 0) + hours * (printer.maintenance_cost_per_hour ?? 0);
        }
      }
      let estEnergyCost = 0;
      if (minutes && printerId) {
        const printer = printers.find(p => p.id === printerId);
        if (printer) {
          const kwhRate = 0.85;
          estEnergyCost = ((printer.power_watts ?? 150) / 1000) * (minutes / 60) * kwhRate;
        }
      }
      const estTotalCost = estMaterialCost + estMachineCost + estEnergyCost;

      const { error } = await supabase.from("jobs").insert({
        tenant_id: profile.tenant_id,
        code,
        name: name.trim(),
        description: description.trim() || null,
        product_id: productId || null,
        material_id: materialId || null,
        secondary_material_id: secondaryMaterialId || null,
        printer_id: printerId || null,
        due_date: dueDate || null,
        priority: Number(priority),
        est_time_minutes: minutes,
        est_grams: grams,
        num_colors: colors,
        purge_waste_grams: purge,
        est_material_cost: estMaterialCost,
        est_machine_cost: estMachineCost,
        est_energy_cost: estEnergyCost,
        est_total_cost: estTotalCost,
        created_by: profile.user_id,
        status: "draft",
      } as any);

      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      toast({ title: "OI criada", description: code });
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nova Ordem de Impressão</DialogTitle>
          <DialogDescription>Selecione um produto ou preencha manualmente.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid gap-1.5">
            <Label>Produto cadastrado</Label>
            <Select value={productId || "none"} onValueChange={(v) => handleProductSelect(v === "none" ? "" : v)}>
              <SelectTrigger><SelectValue placeholder="Selecionar produto..." /></SelectTrigger>
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
                  <SelectTrigger><SelectValue placeholder="Pool (auto)" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pool">Pool (auto)</SelectItem>
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
                  <SelectTrigger><SelectValue placeholder="Pool (auto)" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pool">Pool (auto)</SelectItem>
                    {printers.map(p => (
                      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  <AlertTriangle className="h-3 w-3 inline mr-1" />
                  Impressão multicolor: torre de purga consome ~{purgeWasteGrams || PURGE_GRAMS_PER_COLOR_CHANGE}g extras.
                  {parseInt(numColors) >= 3 && " Com 3+ cores, considere ~25-40g de perda."}
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
                  <SelectItem value="1">Expedite</SelectItem>
                  <SelectItem value="3">Alta</SelectItem>
                  <SelectItem value="5">Normal</SelectItem>
                  <SelectItem value="8">Baixa</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label>SLA / Data prometida</Label>
            <Input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancelar</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Criar OI
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
    if (!id) return "Pool (auto)";
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
            <div className="grid grid-cols-2 gap-4 text-sm">
              <InfoRow icon={PrinterIcon} label="Impressora" value={getPrinterName(job.printer_id)} />
              <InfoRow icon={Package} label="Material" value={getMaterialName(job.material_id)} />
              <InfoRow icon={Calendar} label="SLA" value={fmtDate(job.due_date)} />
              <InfoRow icon={AlertTriangle} label="Prioridade" value={priorityLabel(job.priority)} />
              <InfoRow icon={Timer} label="Tempo estimado" value={fmtMinutes(job.est_time_minutes)} />
              <InfoRow icon={Weight} label="Gramas est." value={fmtGrams(job.est_grams)} />
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
            <div className="grid grid-cols-2 gap-4 text-sm">
              <InfoRow icon={Clock} label="Criado em" value={new Date(job.created_at).toLocaleString("pt-BR")} />
              <InfoRow icon={Play} label="Iniciado em" value={job.started_at ? new Date(job.started_at).toLocaleString("pt-BR") : "—"} />
              <InfoRow icon={CheckCircle2} label="Concluído em" value={job.completed_at ? new Date(job.completed_at).toLocaleString("pt-BR") : "—"} />
              <InfoRow icon={Timer} label="Tempo real" value={fmtMinutes(job.actual_time_minutes)} />
              <InfoRow icon={Weight} label="Gramas reais" value={fmtGrams(job.actual_grams)} />
              <InfoRow icon={AlertTriangle} label="Waste" value={fmtGrams(job.waste_grams)} />
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
                  <CostRow label="Overhead" est={job.est_overhead} actual={job.actual_overhead} />
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
