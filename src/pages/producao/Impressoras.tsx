import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { PageHeader } from "@/components/shared/PageHeader";
import { ArgusBanner } from "@/components/shared/ArgusBanner";
import {
  Plus, Search, MoreHorizontal, Printer, WifiOff,
  AlertTriangle, Wrench, Pause, Play, Eye, Edit, Trash2,
  Power, Zap, Activity, Clock, Download, Loader2, Settings2,
  CloudDownload, Mail, KeyRound, RefreshCw, CheckCircle2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import type { Tables } from "@/integrations/supabase/types";

type PrinterRow = Tables<"printers">;
type PrinterStatus = PrinterRow["status"];
type StatusFilter = PrinterStatus | "all";

// ── Helpers ──
const fmtCurrency = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const fmtHours = (h: number) => `${h.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}h`;

const statusConfig: Record<PrinterStatus, { label: string; color: string; icon: React.ComponentType<{ className?: string }> }> = {
  printing: { label: "Imprimindo", color: "badge-success", icon: Play },
  idle: { label: "Ociosa", color: "badge-info", icon: Power },
  paused: { label: "Pausada", color: "badge-warning", icon: Pause },
  error: { label: "Erro", color: "badge-destructive", icon: AlertTriangle },
  offline: { label: "Offline", color: "bg-muted text-muted-foreground border border-border", icon: WifiOff },
  maintenance: { label: "Manutenção", color: "badge-warning", icon: Wrench },
};

function PrinterStatusBadge({ status }: { status: PrinterStatus }) {
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
export default function Impressoras() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [detailPrinter, setDetailPrinter] = useState<PrinterRow | null>(null);
  const [editPrinter, setEditPrinter] = useState<PrinterRow | null>(null);
  const [bambuCloudOpen, setBambuCloudOpen] = useState(false);

  // ── Fetch printers ──
  const { data: printers = [], isLoading } = useQuery({
    queryKey: ["printers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("printers")
        .select("*")
        .order("name");
      if (error) throw error;
      return data;
    },
    enabled: !!profile,
    refetchInterval: 15000, // Fallback polling every 15s
  });

  // ── Realtime subscription ──
  useEffect(() => {
    const channel = supabase
      .channel("printers-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "printers" },
        () => {
          queryClient.invalidateQueries({ queryKey: ["printers"] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);

  // ── Delete printer ──
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("printers").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["printers"] });
      toast({ title: "Impressora removida" });
    },
    onError: (err: Error) => {
      toast({ variant: "destructive", title: "Erro ao remover", description: err.message });
    },
  });

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: printers.length, printing: 0, idle: 0, error: 0, offline: 0, paused: 0, maintenance: 0 };
    printers.forEach((p) => c[p.status]++);
    return c;
  }, [printers]);

  const filtered = useMemo(() => {
    return printers
      .filter((p) => statusFilter === "all" || p.status === statusFilter)
      .filter((p) => {
        if (!search) return true;
        const q = search.toLowerCase();
        return (
          p.name.toLowerCase().includes(q) ||
          p.model.toLowerCase().includes(q) ||
          (p.serial_number?.toLowerCase().includes(q)) ||
          (p.ip_address?.includes(q))
        );
      });
  }, [printers, search, statusFilter]);

  const totalPrintHours = printers.reduce((sum, p) => sum + (p.total_print_hours ?? 0), 0);
  const totalPrints = printers.reduce((sum, p) => sum + (p.total_prints ?? 0), 0);
  const totalFailures = printers.reduce((sum, p) => sum + (p.total_failures ?? 0), 0);
  const failRate = totalPrints > 0 ? (totalFailures / totalPrints) * 100 : 0;

  return (
    <div className="space-y-6 page-enter">
      <PageHeader
        title="Impressoras"
        description="Cadastro, monitoramento e gestão do parque de impressoras 3D."
        breadcrumbs={[{ label: "Produção", href: "/producao/jobs" }, { label: "Impressoras" }]}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => setBambuCloudOpen(true)} className="gap-2">
              <CloudDownload className="h-4 w-4" />
              Bambu Cloud
            </Button>
            <Button onClick={() => setCreateOpen(true)} className="gap-2">
              <Plus className="h-4 w-4" />
              Nova Impressora
            </Button>
          </div>
        }
      />

      {printers.length > 0 && (
        <ArgusBanner
          message={`Parque com ${printers.length} impressora(s). Taxa de falha geral: ${failRate.toFixed(1)}%.`}
          type={failRate > 5 ? "warning" : "info"}
        />
      )}

      {/* KPI Strip */}
      <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
        {([
          { label: "Total", value: counts.all, filter: "all" as StatusFilter, tone: "status-card-total" },
          { label: "Imprimindo", value: counts.printing ?? 0, filter: "printing" as StatusFilter, tone: "status-card-paid" },
          { label: "Ociosas", value: counts.idle ?? 0, filter: "idle" as StatusFilter, tone: "status-card-upcoming" },
          { label: "Pausadas", value: counts.paused ?? 0, filter: "paused" as StatusFilter, tone: "status-card-today" },
          { label: "Erro", value: counts.error ?? 0, filter: "error" as StatusFilter, tone: "status-card-overdue" },
          { label: "Manutenção", value: counts.maintenance ?? 0, filter: "maintenance" as StatusFilter, tone: "status-card-today" },
        ]).map((card) => (
          <button
            key={card.filter}
            onClick={() => setStatusFilter(card.filter)}
            className={cn(
              "status-card text-left",
              statusFilter === card.filter && `status-card-active ${card.tone}`
            )}
          >
            <span className="status-card-count">{card.value}</span>
            <span className="status-card-label">{card.label}</span>
          </button>
        ))}
      </div>

      {/* Metrics bar */}
      {printers.length > 0 && (
        <div className="flex flex-wrap items-center gap-6 text-sm">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Clock className="h-4 w-4" />
            <span>Total impresso: <strong className="text-foreground">{fmtHours(totalPrintHours)}</strong></span>
          </div>
          <div className="flex items-center gap-2 text-muted-foreground">
            <Activity className="h-4 w-4" />
            <span>Taxa de falha: <strong className={cn("text-foreground", failRate > 5 && "text-destructive")}>{failRate.toFixed(1)}%</strong></span>
          </div>
          <div className="flex items-center gap-2 text-muted-foreground">
            <Zap className="h-4 w-4" />
            <span>Consumo total: <strong className="text-foreground">{printers.reduce((s, p) => s + (p.power_watts ?? 0), 0)}W</strong></span>
          </div>
        </div>
      )}

      {/* Search */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por nome, modelo, serial, IP..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-9 text-sm"
          />
        </div>
      </div>

      {/* Table */}
      <div className="card-enterprise !p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted hover:bg-muted">
                <TableHead className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Nome</TableHead>
                <TableHead className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Modelo</TableHead>
                <TableHead className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Status</TableHead>
                <TableHead className="text-xs font-semibold uppercase tracking-wide text-muted-foreground text-right">Prints</TableHead>
                <TableHead className="text-xs font-semibold uppercase tracking-wide text-muted-foreground text-right">Horas</TableHead>
                <TableHead className="text-xs font-semibold uppercase tracking-wide text-muted-foreground text-right">Potência</TableHead>
                <TableHead className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">IP</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-16">
                    <Loader2 className="h-6 w-6 mx-auto animate-spin text-muted-foreground" />
                  </TableCell>
                </TableRow>
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-16 text-muted-foreground">
                    <Printer className="h-8 w-8 mx-auto mb-2 opacity-40" />
                    <p className="text-sm">{printers.length === 0 ? "Nenhuma impressora cadastrada. Clique em 'Nova Impressora' para começar." : "Nenhuma impressora encontrada."}</p>
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((p) => (
                  <TableRow key={p.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setDetailPrinter(p)}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className={cn(
                          "h-2 w-2 rounded-full flex-shrink-0",
                          p.status === "printing" && "bg-emerald-500 animate-pulse",
                          p.status === "idle" && "bg-primary",
                          p.status === "paused" && "bg-amber-500",
                          p.status === "error" && "bg-destructive",
                          p.status === "offline" && "bg-muted-foreground/30",
                          p.status === "maintenance" && "bg-amber-500",
                        )} />
                        <span className="font-semibold text-foreground">{p.name}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">{p.brand} {p.model}</TableCell>
                    <TableCell><PrinterStatusBadge status={p.status} /></TableCell>
                    <TableCell className="text-right font-mono text-sm tabular-nums">{(p.total_prints ?? 0).toLocaleString("pt-BR")}</TableCell>
                    <TableCell className="text-right font-mono text-sm tabular-nums">{fmtHours(p.total_print_hours ?? 0)}</TableCell>
                    <TableCell className="text-right font-mono text-sm tabular-nums">{p.power_watts ?? 0}W</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{p.ip_address || "—"}</TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => setDetailPrinter(p)}>
                            <Eye className="h-4 w-4 mr-2" /> Ver detalhes
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-destructive"
                            onClick={() => deleteMutation.mutate(p.id)}
                          >
                            <Trash2 className="h-4 w-4 mr-2" /> Remover
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
      </div>

      <CreatePrinterDialog open={createOpen} onOpenChange={setCreateOpen} />
      <PrinterDetailDialog printer={detailPrinter} onClose={() => setDetailPrinter(null)} />
      <BambuCloudDialog open={bambuCloudOpen} onOpenChange={setBambuCloudOpen} />
    </div>
  );
}

// ── Create Dialog ──
function CreatePrinterDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { profile } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [loading, setLoading] = useState(false);

  const [form, setForm] = useState({
    name: "", brand: "Bambu Lab", model: "", serial_number: "",
    ip_address: "", power_watts: "350", acquisition_cost: "", useful_life_hours: "10000",
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile) return;
    setLoading(true);

    const powerWatts = Number(form.power_watts) || 150;
    const acquisitionCost = Number(form.acquisition_cost) || 0;
    const usefulLifeHours = Number(form.useful_life_hours) || 10000;
    const depreciationPerHour = acquisitionCost > 0 && usefulLifeHours > 0
      ? acquisitionCost / usefulLifeHours
      : 0;

    const { error } = await supabase.from("printers").insert({
      tenant_id: profile.tenant_id,
      name: form.name,
      brand: form.brand,
      model: form.model,
      serial_number: form.serial_number || null,
      ip_address: form.ip_address || null,
      power_watts: powerWatts,
      acquisition_cost: acquisitionCost,
      useful_life_hours: usefulLifeHours,
      depreciation_per_hour: depreciationPerHour,
    });

    setLoading(false);
    if (error) {
      toast({ variant: "destructive", title: "Erro ao cadastrar", description: error.message });
    } else {
      toast({ title: "Impressora cadastrada!" });
      queryClient.invalidateQueries({ queryKey: ["printers"] });
      onOpenChange(false);
      setForm({ name: "", brand: "Bambu Lab", model: "", serial_number: "", ip_address: "", power_watts: "350", acquisition_cost: "", useful_life_hours: "10000" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Nova Impressora</DialogTitle>
          <DialogDescription>Cadastre uma nova impressora 3D no parque de produção.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="grid gap-4 py-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Nome *</Label>
              <Input placeholder="X1C-01" value={form.name} onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))} required />
            </div>
            <div className="space-y-2">
              <Label>Marca</Label>
              <Input placeholder="Bambu Lab" value={form.brand} onChange={(e) => setForm(f => ({ ...f, brand: e.target.value }))} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Modelo *</Label>
              <Input placeholder="X1 Carbon" value={form.model} onChange={(e) => setForm(f => ({ ...f, model: e.target.value }))} required />
            </div>
            <div className="space-y-2">
              <Label>Nº Serial</Label>
              <Input placeholder="01S00C4B..." value={form.serial_number} onChange={(e) => setForm(f => ({ ...f, serial_number: e.target.value }))} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>IP</Label>
              <Input placeholder="192.168.1.101" value={form.ip_address} onChange={(e) => setForm(f => ({ ...f, ip_address: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Potência (W)</Label>
              <Input type="number" placeholder="350" value={form.power_watts} onChange={(e) => setForm(f => ({ ...f, power_watts: e.target.value }))} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Custo Aquisição (R$)</Label>
              <Input type="number" step="0.01" placeholder="7500" value={form.acquisition_cost} onChange={(e) => setForm(f => ({ ...f, acquisition_cost: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Vida Útil (h)</Label>
              <Input type="number" placeholder="10000" value={form.useful_life_hours} onChange={(e) => setForm(f => ({ ...f, useful_life_hours: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button type="submit" disabled={loading}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Cadastrar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Detail Dialog ──
function PrinterDetailDialog({ printer, onClose }: { printer: PrinterRow | null; onClose: () => void }) {
  if (!printer) return null;
  const lifePercent = printer.useful_life_hours
    ? Math.min(((printer.total_print_hours ?? 0) / printer.useful_life_hours) * 100, 100)
    : 0;

  return (
    <Dialog open={!!printer} onOpenChange={() => onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <Printer className="h-5 w-5" />
            {printer.name}
          </DialogTitle>
          <DialogDescription>{printer.brand} {printer.model} {printer.serial_number && `• ${printer.serial_number}`}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Status</span>
            <PrinterStatusBadge status={printer.status} />
          </div>

          <div className="grid grid-cols-2 gap-4 text-sm">
            <div><span className="text-muted-foreground">Total prints:</span> <strong>{(printer.total_prints ?? 0).toLocaleString("pt-BR")}</strong></div>
            <div><span className="text-muted-foreground">Horas:</span> <strong>{fmtHours(printer.total_print_hours ?? 0)}</strong></div>
            <div><span className="text-muted-foreground">Falhas:</span> <strong>{printer.total_failures ?? 0}</strong></div>
            <div><span className="text-muted-foreground">Potência:</span> <strong>{printer.power_watts ?? 0}W</strong></div>
            <div><span className="text-muted-foreground">IP:</span> <strong>{printer.ip_address || "—"}</strong></div>
            <div><span className="text-muted-foreground">Custo:</span> <strong>{fmtCurrency(printer.acquisition_cost ?? 0)}</strong></div>
          </div>

          {printer.useful_life_hours && printer.useful_life_hours > 0 && (
            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-muted-foreground">Vida útil consumida</span>
                <span className="font-mono">{lifePercent.toFixed(1)}%</span>
              </div>
              <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className={cn("h-full rounded-full transition-all", lifePercent > 80 ? "bg-destructive" : lifePercent > 50 ? "bg-amber-500" : "bg-primary")}
                  style={{ width: `${lifePercent}%` }}
                />
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Bambu Cloud Dialog ──
type BambuStep = "login" | "verify_code" | "syncing" | "done";

function BambuCloudDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [step, setStep] = useState<BambuStep>("login");
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [resultMessage, setResultMessage] = useState("");
  const [syncedDevices, setSyncedDevices] = useState<Array<{ dev_id: string; name: string; model: string; online: boolean }>>([]);

  const reset = () => {
    setStep("login");
    setEmail("");
    setPassword("");
    setCode("");
    setResultMessage("");
    setSyncedDevices([]);
  };

  const callEdgeFunction = async (body: Record<string, string>) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error("Not authenticated");

    const res = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/bambu-cloud-sync`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify(body),
      }
    );

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Request failed");
    return data;
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const data = await callEdgeFunction({ action: "login", email, password });

      if (data.step === "verify_code") {
        setStep("verify_code");
        toast({ title: "Código enviado", description: "Verifique seu e-mail Bambu Lab." });
      } else if (data.step === "done") {
        setStep("done");
        setResultMessage(data.message);
        setSyncedDevices(data.devices || []);
        queryClient.invalidateQueries({ queryKey: ["printers"] });
        toast({ title: "Conectado!", description: data.message });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Erro desconhecido";
      toast({ variant: "destructive", title: "Erro no login", description: msg });
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const data = await callEdgeFunction({ action: "verify_code", email, code });
      setStep("done");
      setResultMessage(data.message);
      setSyncedDevices(data.devices || []);
      queryClient.invalidateQueries({ queryKey: ["printers"] });
      toast({ title: "Conectado!", description: data.message });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Código inválido";
      toast({ variant: "destructive", title: "Erro na verificação", description: msg });
    } finally {
      setLoading(false);
    }
  };

  const handleSync = async () => {
    setLoading(true);
    try {
      const data = await callEdgeFunction({ action: "sync" });
      setStep("done");
      setResultMessage(data.message);
      setSyncedDevices(data.devices || []);
      queryClient.invalidateQueries({ queryKey: ["printers"] });
      toast({ title: "Sincronizado!", description: data.message });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Erro na sincronização";
      toast({ variant: "destructive", title: "Erro", description: msg });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) reset(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CloudDownload className="h-5 w-5" />
            Bambu Cloud Sync
          </DialogTitle>
          <DialogDescription>
            Conecte sua conta Bambu Lab para importar automaticamente todas as impressoras registradas.
          </DialogDescription>
        </DialogHeader>

        {step === "login" && (
          <form onSubmit={handleLogin} className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <Mail className="h-4 w-4" />
                E-mail da conta Bambu Lab
              </Label>
              <Input
                type="email"
                placeholder="seu@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <KeyRound className="h-4 w-4" />
                Senha
              </Label>
              <Input
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Suas credenciais são enviadas diretamente para a API da Bambu Lab. O token de acesso é armazenado para sincronizações futuras.
            </p>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
              <Button type="submit" disabled={loading}>
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Conectar
              </Button>
            </DialogFooter>
          </form>
        )}

        {step === "verify_code" && (
          <form onSubmit={handleVerifyCode} className="grid gap-4 py-4">
            <div className="rounded-lg border border-border bg-muted/50 p-3">
              <p className="text-sm text-muted-foreground">
                A Bambu Lab enviou um código de verificação para <strong className="text-foreground">{email}</strong>. Verifique seu e-mail e insira o código abaixo.
              </p>
            </div>
            <div className="space-y-2">
              <Label>Código de Verificação</Label>
              <Input
                placeholder="123456"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                required
                className="text-center text-lg tracking-widest font-mono"
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setStep("login")}>Voltar</Button>
              <Button type="submit" disabled={loading}>
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Verificar
              </Button>
            </DialogFooter>
          </form>
        )}

        {step === "done" && (
          <div className="grid gap-4 py-4">
            <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/50 p-4">
              <CheckCircle2 className="h-6 w-6 text-primary flex-shrink-0" />
              <div>
                <p className="font-semibold text-foreground">{resultMessage}</p>
                <p className="text-xs text-muted-foreground mt-1">Impressoras importadas para o cadastro.</p>
              </div>
            </div>

            {syncedDevices.length > 0 && (
              <div className="space-y-2">
                <Label className="text-xs uppercase tracking-wide text-muted-foreground">Dispositivos encontrados</Label>
                <div className="space-y-1.5">
                  {syncedDevices.map((d) => (
                    <div key={d.dev_id} className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm">
                      <div className="flex items-center gap-2">
                        <div className={cn("h-2 w-2 rounded-full", d.online ? "bg-primary" : "bg-muted-foreground/30")} />
                        <span className="font-medium">{d.name}</span>
                      </div>
                      <span className="text-muted-foreground text-xs">{d.model}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={() => handleSync()} disabled={loading} className="gap-2">
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                Re-sincronizar
              </Button>
              <Button onClick={() => { onOpenChange(false); reset(); }}>Fechar</Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
