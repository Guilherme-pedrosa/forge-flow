import { useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { positiveInteger, productExtrasPerPiece, requiresProductionMeasurement } from "@/lib/production";
import { createJobs, transitionJob, productionQueryKeys, type CreateJobInput } from "@/lib/production-api";
import { orderRequest } from "@/lib/sales-order";
import { planProductPlates, readProductPlates } from "@/lib/production-plates";
import { ProductionPlatePlan } from "@/components/production/ProductionPlatePlan";
import { ProductionTransitionDialog } from "@/components/production/ProductionTransitionDialog";
import { ProductionFileDialog } from "@/components/production/ProductionFileDialog";
import { ProductionRecipeSummary } from "@/components/production/ProductionRecipeSummary";
import { readProductionRecipe, platesWithRecipe, jobRecipeMaterialCount } from "@/lib/production-files";
import type { Tables } from "@/integrations/supabase/types";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import {
  Plus, Printer, Play, Pause, CheckCircle2, XCircle, MoreVertical,
  Link2, GripVertical, RefreshCw, Trash2, AlertCircle, Clock,
} from "lucide-react";
import { cn } from "@/lib/utils";

type JobStatus =
  | "draft" | "queued" | "printing" | "paused" | "failed" | "reprint"
  | "post_processing" | "quality_check" | "ready" | "shipped" | "completed";

const statusConfig: Record<JobStatus, { label: string; color: string; icon: any }> = {
  draft:           { label: "Rascunho",      color: "bg-muted text-muted-foreground",          icon: Clock },
  queued:          { label: "Na fila",       color: "bg-blue-100 text-blue-700 border-blue-200",     icon: Clock },
  printing:        { label: "Imprimindo",    color: "bg-amber-100 text-amber-700 border-amber-200",  icon: Play },
  paused:          { label: "Pausado",       color: "bg-orange-100 text-orange-700 border-orange-200", icon: Pause },
  failed:          { label: "Falhou",        color: "bg-red-100 text-red-700 border-red-200",        icon: XCircle },
  reprint:         { label: "Reimpressão",   color: "bg-purple-100 text-purple-700 border-purple-200", icon: RefreshCw },
  post_processing: { label: "Pós-processo",  color: "bg-cyan-100 text-cyan-700 border-cyan-200",     icon: CheckCircle2 },
  quality_check:   { label: "QC",            color: "bg-indigo-100 text-indigo-700 border-indigo-200", icon: CheckCircle2 },
  ready:           { label: "Pronto",        color: "bg-emerald-100 text-emerald-700 border-emerald-200", icon: CheckCircle2 },
  shipped:         { label: "Enviado",       color: "bg-emerald-100 text-emerald-700 border-emerald-200", icon: CheckCircle2 },
  completed:       { label: "Concluído",     color: "bg-emerald-100 text-emerald-700 border-emerald-200", icon: CheckCircle2 },
};

const QUEUE_STATUSES: JobStatus[] = ["queued", "printing", "paused", "post_processing", "quality_check", "failed", "reprint"];

export default function Fila() {
  const { profile } = useAuth();
  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [fileJobId, setFileJobId] = useState<string | null>(null);
  const [transition, setTransition] = useState<{ job: Tables<"jobs">; status: JobStatus } | null>(null);
  const [selProductId, setSelProductId] = useState<string>("");
  const [selPrinterId, setSelPrinterId] = useState<string>("");
  const [selQty, setSelQty] = useState<string>("1");
  const [selPriority, setSelPriority] = useState<string>("5");
  const creationRequest = useRef<ReturnType<typeof orderRequest> | null>(null);
  const plateQuery = useQuery({ queryKey: ["product_print_plates", profile?.tenant_id, selProductId], enabled: !!profile && !!selProductId && createOpen, queryFn: () => readProductPlates(selProductId) });
  const hasPlates = !!plateQuery.data?.length;
  const recipeQuery = useQuery({ queryKey: ["product_material_recipe", profile?.tenant_id, selProductId], enabled: !!profile && !!selProductId && createOpen, queryFn: () => readProductionRecipe(selProductId) });

  const { data: printers = [] } = useQuery({
    queryKey: ["fila_printers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("printers")
        .select("id, name, model, status, brand, bambu_device_id")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data;
    },
    enabled: !!profile,
  });

  const { data: products = [] } = useQuery({
    queryKey: ["fila_products"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("id, name, sku, est_grams, est_time_minutes, cost_estimate, sale_price, material_id, num_colors, prints_per_plate, extras, category")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data;
    },
    enabled: !!profile,
  });

  const { data: jobs = [], refetch: refetchJobs, isLoading: jobsLoading, error: jobsError } = useQuery({
    queryKey: ["fila_jobs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("jobs")
        .select("*, products(name, sku), printers(name)")
        .in("status", QUEUE_STATUSES)
        .order("priority", { ascending: true })
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data;
    },
    enabled: !!profile,
    refetchInterval: 15000,
  });

  const { data: bambuTasks = [] } = useQuery({
    queryKey: ["fila_bambu_tasks"],
    queryFn: async () => {
      const since = new Date(Date.now() - 1000 * 60 * 60 * 24 * 2).toISOString();
      const { data, error } = await supabase
        .from("bambu_tasks")
        .select("id, bambu_task_id, design_title, start_time, end_time, status, weight_grams, cost_time_seconds, bambu_device_id, job_id")
        .gte("start_time", since)
        .order("start_time", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!profile,
    refetchInterval: 30000,
  });

  const { data: bambuDevices = [] } = useQuery({
    queryKey: ["fila_bambu_devices"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bambu_devices")
        .select("id, dev_id, printer_id, name, online, print_status, progress, remaining_time");
      if (error) throw error;
      return data;
    },
    enabled: !!profile,
    refetchInterval: 15000,
  });

  const createJobsMut = useMutation({
    mutationFn: async () => {
      if (!profile?.tenant_id) throw new Error("Sem tenant");
      const product = products.find(p => p.id === selProductId);
      const printer = printers.find(p => p.id === selPrinterId);
        if (!product) throw new Error("Selecione um produto");
        if (recipeQuery.isFetching) throw new Error("Aguarde a consulta da composição.");
        if (recipeQuery.error) throw recipeQuery.error;
        if (recipeQuery.data?.recipe && !recipeQuery.data.recipe.complete) throw new Error("Complete a composição de materiais, cores e custos antes de criar a ordem.");
      if (product.category === "kit") throw new Error("Use Pedidos para planejar o kit; os componentes serão separados automaticamente.");
      if (plateQuery.isFetching) throw new Error("Aguarde a consulta das placas deste produto.");
      if (plateQuery.error) throw plateQuery.error;
      if (hasPlates) {
        const quantity = positiveInteger(selQty, "Quantidade de conjuntos", 10000);
        creationRequest.current = orderRequest(creationRequest.current, JSON.stringify({ product_id: product.id, quantity, mode: "product_plates" }));
        return planProductPlates(product.id, quantity, creationRequest.current.id);
      }
      if (!printer) throw new Error("Selecione uma impressora");
      const qty = positiveInteger(selQty, "Quantidade de placas", 100);
      const priority = positiveInteger(selPriority, "Prioridade", 10);
      if (["maintenance", "offline", "error"].includes(printer.status)) throw new Error("Selecione uma impressora disponível para planejar a produção.");

      const rows: CreateJobInput[] = Array.from({ length: qty }).map(() => ({
        name: product.name,
        product_id: product.id,
        printer_id: printer.id,
        material_id: recipeQuery.data?.recipe?.lines[0]?.item_id ?? product.material_id,
        secondary_material_id: recipeQuery.data?.recipe?.lines[1]?.item_id ?? null,
        status: "queued" as const,
        priority,
        num_colors: recipeQuery.data?.recipe?.lines.length || product.num_colors || 1,
        est_grams: product.est_grams || 0,
        est_time_minutes: product.est_time_minutes || 0,
        est_total_cost: product.cost_estimate == null ? null : product.cost_estimate * Math.max(1, product.prints_per_plate ?? 1),
        est_extras_cost: productExtrasPerPiece(product.extras) * Math.max(1, product.prints_per_plate ?? 1),
        sale_price: product.sale_price == null ? null : product.sale_price * Math.max(1, product.prints_per_plate ?? 1),
      }));

      creationRequest.current = orderRequest(creationRequest.current, JSON.stringify(rows));
      return createJobs(rows, creationRequest.current.id);
    },
    onSuccess: () => {
      creationRequest.current = null;
      toast.success("Jobs adicionados à fila");
      productionQueryKeys.forEach(key => qc.invalidateQueries({ queryKey: [key] }));
      setCreateOpen(false);
      setSelProductId("");
      setSelQty("1");
    },
    onError: (e: any) => toast.error(e.message || "Erro"),
  });

  const updateStatusMut = useMutation({
    mutationFn: transitionJob,
    onSuccess: () => {
      productionQueryKeys.forEach(key => qc.invalidateQueries({ queryKey: [key] }));
      setTransition(null);
      toast.success("Fila atualizada");
    },
    onError: (e: Error) => toast.error(e.message || "Não foi possível atualizar a produção"),
  });
  const showTransition = (job: Tables<"jobs">, status: JobStatus) => {
    if (requiresProductionMeasurement(status, job.inventory_posted_at) && jobRecipeMaterialCount(job) > 2) {
      toast.error("Esta receita tem três ou mais materiais. Use a apuração Bambu para registrar todos os consumos.");
      setFileJobId(job.id); return;
    }
    setTransition({ job, status });
  };

  const jobsByPrinter = useMemo(() => {
    const map = new Map<string | null, any[]>();
    for (const p of printers) map.set(p.id, []);
    map.set(null, []);
    for (const j of jobs) {
      const key = printers.some(p => p.id === j.printer_id) ? j.printer_id : null;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(j);
    }
    return map;
  }, [jobs, printers]);

  const printerLiveStatus = (printerId: string) => {
    const dev = bambuDevices.find(d => d.printer_id === printerId);
    if (!dev) return null;
    return dev;
  };

  const totals = useMemo(() => ({
    queued: jobs.filter(j => j.status === "queued").length,
    printing: jobs.filter(j => j.status === "printing").length,
    linked: jobs.filter(j => j.bambu_task_id).length,
  }), [jobs]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Fila de Impressão"
        description="Capacidade por impressora, prioridades e etapas de produção."
        breadcrumbs={[{ label: "Início", href: "/" }, { label: "Planejamento" }, { label: "Fila" }]}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => refetchJobs()}>
              <RefreshCw className="h-4 w-4 mr-2" /> Atualizar
            </Button>
            <Dialog open={createOpen} onOpenChange={open => { if (!createJobsMut.isPending) setCreateOpen(open); }}>
              <DialogTrigger asChild>
                <Button size="sm">
                  <Plus className="h-4 w-4 mr-2" /> Adicionar à fila
                </Button>
              </DialogTrigger>
              <DialogContent className="max-h-[92dvh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Adicionar produto à fila</DialogTitle>
                  <DialogDescription>Selecione o produto e a quantidade. Produtos com várias placas geram o conjunto completo.</DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                  <div>
                    <Label htmlFor="queue-product">Produto</Label>
                    <Select value={selProductId} onValueChange={setSelProductId}>
                      <SelectTrigger id="queue-product"><SelectValue placeholder="Selecione..." /></SelectTrigger>
                      <SelectContent>
                        {products.map(p => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.name} {p.sku ? `· ${p.sku}` : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {!hasPlates && <div>
                    <Label htmlFor="queue-printer">Impressora</Label>
                    <Select value={selPrinterId} onValueChange={setSelPrinterId}>
                      <SelectTrigger id="queue-printer"><SelectValue placeholder="Selecione..." /></SelectTrigger>
                      <SelectContent>
                        {printers.map(p => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.name} ({p.model})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>}
                  <div className={cn("grid gap-3", !hasPlates && "sm:grid-cols-2")}>
                    <div>
                      <Label htmlFor="queue-quantity">{hasPlates ? "Quantidade de conjuntos / SKUs" : "Quantidade (placas)"}</Label>
                      <Input id="queue-quantity" type="number" min={1} value={selQty} onChange={e => setSelQty(e.target.value)} />
                    </div>
                    {!hasPlates && <div>
                      <Label htmlFor="queue-priority">Prioridade (1=alta, 10=baixa)</Label>
                      <Input id="queue-priority" type="number" min={1} max={10} value={selPriority} onChange={e => setSelPriority(e.target.value)} />
                    </div>}
                  </div>
                  {plateQuery.isFetching && <p className="text-xs text-muted-foreground">Consultando as placas do produto…</p>}
                  {plateQuery.error && <p role="alert" className="text-sm text-destructive">Não foi possível consultar as placas. {plateQuery.error.message}</p>}
                  {recipeQuery.isFetching && <p className="text-sm text-muted-foreground">Consultando materiais, cores e custos…</p>}
                  {recipeQuery.error && <p role="alert" className="text-sm text-destructive">{recipeQuery.error.message}</p>}
                  {hasPlates && <ProductionPlatePlan plates={platesWithRecipe(plateQuery.data!, recipeQuery.data)} quantity={selQty} printers={printers} />}
                  {recipeQuery.data?.recipe && <ProductionRecipeSummary recipe={recipeQuery.data.recipe} />}
                  {selProductId && !hasPlates && !recipeQuery.data?.recipe && !recipeQuery.isFetching && !plateQuery.isFetching && !plateQuery.error && (
                    <div className="text-xs text-muted-foreground bg-muted rounded p-2">
                      {(() => {
                        const p = products.find(x => x.id === selProductId);
                        if (!p) return null;
                        return `Estimativa por placa: ${p.est_grams || 0}g · ${p.est_time_minutes || 0}min · R$ ${((p.cost_estimate ?? 0) * Math.max(1, p.prints_per_plate ?? 1)).toFixed(2)}`;
                      })()}
                    </div>
                  )}
                </div>
                <DialogFooter>
                  <Button variant="outline" disabled={createJobsMut.isPending} onClick={() => setCreateOpen(false)}>Cancelar</Button>
                  <Button onClick={() => createJobsMut.mutate()} disabled={createJobsMut.isPending || plateQuery.isFetching || !!plateQuery.error || recipeQuery.isFetching || !!recipeQuery.error || !!recipeQuery.data?.recipe && !recipeQuery.data.recipe.complete}>
                    {createJobsMut.isPending ? "Criando..." : hasPlates ? "Planejar conjunto completo" : "Adicionar à fila"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        }
      />

      {jobsError && <p role="alert" className="rounded-lg bg-destructive/10 p-4 text-sm text-destructive">Não foi possível atualizar a fila: {jobsError.message}</p>}
      {jobsLoading && <p role="status" className="text-sm text-muted-foreground">Carregando fila de produção...</p>}
      {transition && <ProductionTransitionDialog key={`${transition.job.id}-${transition.status}`} value={transition} printers={printers} pending={updateStatusMut.isPending} onClose={() => setTransition(null)} onSave={value => updateStatusMut.mutate(value)} />}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-4 text-sm">
        <div className="space-y-1"><p className="text-muted-foreground">A fila acompanha a produção. Confirme o controle de qualidade e os consumos reais antes de concluir cada ordem.</p><p className="text-xs text-muted-foreground"><Link to="/integracoes/bambu" className="text-primary underline-offset-4 hover:underline">Confira os vínculos e a apuração das tentativas Bambu</Link>. As execuções seguem as regras configuradas para cada produto e placa.</p></div>
        <Button variant="outline" asChild><Link to="/producao/jobs">Abrir ordens e apurar custos</Link></Button>
      </div>
      {/* KPI strip */}
      <div className="grid grid-cols-3 gap-3">
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">Aguardando</div>
          <div className="text-2xl font-bold">{totals.queued}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">Imprimindo</div>
          <div className="text-2xl font-bold text-amber-600">{totals.printing}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground flex items-center gap-1">
            <Link2 className="h-3 w-3" /> Vinculados ao Bambu
          </div>
          <div className="text-2xl font-bold text-blue-600">{totals.linked}</div>
        </Card>
      </div>

      {/* Kanban por impressora */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {printers.map(printer => {
          const printerJobs = jobsByPrinter.get(printer.id) || [];
          const live = printerLiveStatus(printer.id);
          return (
            <Card key={printer.id} className="flex flex-col">
              <div className="flex items-center justify-between p-3 border-b bg-muted/30">
                <div className="flex items-center gap-2 min-w-0">
                  <Printer className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                  <div className="min-w-0">
                    <div className="font-semibold text-sm truncate">{printer.name}</div>
                    <div className="text-xs text-muted-foreground truncate">{printer.model}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {live && (
                    <span className={cn(
                      "h-2 w-2 rounded-full",
                      live.online ? "bg-emerald-500 animate-pulse" : "bg-muted-foreground/30"
                    )} title={live.online ? "Online" : "Offline"} />
                  )}
                  <Badge variant="outline" className="text-xs">{printerJobs.length}</Badge>
                </div>
              </div>

              {live?.online && live.print_status && (
                <div className="px-3 py-2 text-xs bg-blue-50 border-b border-blue-100 text-blue-900">
                  Bambu: <strong>{live.print_status}</strong>
                  {live.progress != null && ` · ${live.progress}%`}
                  {live.remaining_time != null && ` · ${Math.round(live.remaining_time)}min`}
                </div>
              )}

              <div className="flex-1 p-2 space-y-2 min-h-[120px]">
                {printerJobs.length === 0 ? (
                  <div className="text-center py-6 text-xs text-muted-foreground">
                    Sem jobs na fila
                  </div>
                ) : printerJobs.map((j, idx) => {
                  const cfg = statusConfig[j.status as JobStatus];
                  const Icon = cfg.icon;
                  return (
                    <div
                      key={j.id}
                      className="border rounded-md p-2.5 hover:shadow-sm transition-shadow bg-card"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-start gap-2 min-w-0 flex-1">
                          <Clock className="h-3.5 w-3.5 text-muted-foreground/40 mt-0.5 flex-shrink-0" />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5 mb-0.5">
                              <span className="text-xs font-mono text-muted-foreground">#{idx + 1}</span>
                              <span className="text-xs font-semibold whitespace-normal">{j.name || j.products?.name}</span>
                            </div>
                            <div className="text-xs text-muted-foreground font-mono">{j.code}</div>
                            {j.description && <p className="mt-1 text-xs text-muted-foreground">{j.description}</p>}
                            <Button variant="link" size="sm" className="h-auto px-0 py-1 text-xs" onClick={() => setFileJobId(j.id)}>Arquivo e receita da placa</Button>
                            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                              <Badge variant="outline" className={cn("text-xs py-0 px-1.5 gap-1 border", cfg.color)}>
                                <Icon className="h-2.5 w-2.5" /> {cfg.label}
                              </Badge>
                              {j.bambu_task_id && (
                                <Badge variant="outline" className="text-xs py-0 px-1.5 gap-1 bg-blue-50 text-blue-700 border-blue-200">
                                  <Link2 className="h-2.5 w-2.5" /> Bambu
                                </Badge>
                              )}
                              <span className="text-xs text-muted-foreground">P{j.priority}</span>
                              {j.est_time_minutes ? (
                                <span className="text-xs text-muted-foreground">{j.est_time_minutes}min</span>
                              ) : null}
                            </div>
                          </div>
                        </div>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-10 w-10 flex-shrink-0" aria-label="Ações da ordem">
                              <MoreVertical className="h-3.5 w-3.5" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {j.status === "queued" && (
                              <DropdownMenuItem disabled={updateStatusMut.isPending} onClick={() => showTransition(j, "printing")}>
                                <Play className="h-3.5 w-3.5 mr-2" /> Iniciar manualmente
                              </DropdownMenuItem>
                            )}
                            {j.status === "printing" && (
                              <>
                                <DropdownMenuItem onClick={() => updateStatusMut.mutate({ id: j.id, status: "paused" })}>
                                  <Pause className="h-3.5 w-3.5 mr-2" /> Pausar
                                </DropdownMenuItem>
                                <DropdownMenuItem disabled={updateStatusMut.isPending} onClick={() => { if (requiresProductionMeasurement("quality_check", j.inventory_posted_at)) showTransition(j, "quality_check"); else updateStatusMut.mutate({ id: j.id, status: "quality_check" }); }}>
                                  <CheckCircle2 className="h-3.5 w-3.5 mr-2" /> Enviar para qualidade
                                </DropdownMenuItem>
                                <DropdownMenuItem disabled={updateStatusMut.isPending} onClick={() => showTransition(j, "failed")}>
                                  <XCircle className="h-3.5 w-3.5 mr-2" /> Marcar falha
                                </DropdownMenuItem>
                              </>
                            )}
                            {j.status === "paused" && (
                              <DropdownMenuItem onClick={() => updateStatusMut.mutate({ id: j.id, status: "printing" })}>
                                <Play className="h-3.5 w-3.5 mr-2" /> Retomar
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem asChild><Link to="/producao/jobs"><CheckCircle2 className="h-3.5 w-3.5 mr-2" /> Conferir ordem e custos</Link></DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          );
        })}

        {/* Coluna sem impressora */}
        {(jobsByPrinter.get(null)?.length ?? 0) > 0 && (
          <Card className="flex flex-col border-dashed">
            <div className="flex items-center justify-between p-3 border-b bg-amber-50">
              <div className="flex items-center gap-2">
                <AlertCircle className="h-4 w-4 text-amber-600" />
                <div className="font-semibold text-sm">Sem impressora atribuída</div>
              </div>
              <Badge variant="outline">{jobsByPrinter.get(null)!.length}</Badge>
            </div>
            <div className="p-2 space-y-2">
              {jobsByPrinter.get(null)!.map(j => (
                <div key={j.id} className="border rounded-md p-2.5">
                  <div className="text-xs font-semibold">{j.name || j.products?.name}</div>
                  <div className="text-xs text-muted-foreground font-mono mb-3">{j.code}</div>
                  {j.description && <p className="mb-3 text-xs text-muted-foreground">{j.description}</p>}
                  <Button variant="link" size="sm" className="mb-2 h-auto px-0 text-xs" onClick={() => setFileJobId(j.id)}>Arquivo e receita da placa</Button>
                  <Select onValueChange={printerId => updateStatusMut.mutate({ id: j.id, status: j.status, printerId })} disabled={updateStatusMut.isPending}>
                    <SelectTrigger aria-label={`Atribuir impressora para ${j.code}`}><SelectValue placeholder="Atribuir impressora" /></SelectTrigger>
                    <SelectContent>{printers.map(printer => <SelectItem key={printer.id} value={printer.id}>{printer.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              ))}
            </div>
          </Card>
        )}

        {printers.length === 0 && (
          <Card className="col-span-full p-8 text-center text-muted-foreground">
            <Printer className="h-8 w-8 mx-auto mb-2 opacity-50" />
            Nenhuma impressora cadastrada. Adicione em Produção → Impressoras.
          </Card>
        )}
      </div>
      {fileJobId && <ProductionFileDialog jobId={fileJobId} onClose={() => setFileJobId(null)} />}
    </div>
  );
}
