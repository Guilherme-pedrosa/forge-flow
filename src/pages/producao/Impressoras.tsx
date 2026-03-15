import { useState, useMemo } from "react";
import { PageHeader } from "@/components/shared/PageHeader";
import { ArgusBanner } from "@/components/shared/ArgusBanner";
import {
  Plus,
  Search,
  MoreHorizontal,
  Printer,
  Wifi,
  WifiOff,
  Thermometer,
  Clock,
  AlertTriangle,
  Wrench,
  Pause,
  Play,
  Eye,
  Edit,
  Trash2,
  Power,
  Zap,
  Activity,
  Settings2,
  Download,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";

// ── Types ──
type PrinterStatus = "idle" | "printing" | "paused" | "error" | "offline" | "maintenance";
type StatusFilter = PrinterStatus | "all";

interface PrinterDevice {
  id: string;
  name: string;
  brand: string;
  model: string;
  serialNumber: string;
  status: PrinterStatus;
  ipAddress: string;
  powerWatts: number;
  acquisitionCost: number;
  usefulLifeHours: number;
  totalPrints: number;
  totalPrintHours: number;
  totalFailures: number;
  currentJob: string | null;
  progress: number | null;
  nozzleTemp: number | null;
  bedTemp: number | null;
  lastSeen: string;
}

// ── Mock Data ──
const mockPrinters: PrinterDevice[] = [
  {
    id: "1", name: "X1C-01", brand: "Bambu Lab", model: "X1 Carbon", serialNumber: "01S00C4B2100231",
    status: "printing", ipAddress: "192.168.1.101", powerWatts: 350, acquisitionCost: 7500,
    usefulLifeHours: 10000, totalPrints: 847, totalPrintHours: 2140.5, totalFailures: 23,
    currentJob: "Engrenagem Helicoidal v3", progress: 67, nozzleTemp: 220, bedTemp: 60,
    lastSeen: "2026-03-15T16:00:00",
  },
  {
    id: "2", name: "X1C-02", brand: "Bambu Lab", model: "X1 Carbon", serialNumber: "01S00C4B2100447",
    status: "idle", ipAddress: "192.168.1.102", powerWatts: 350, acquisitionCost: 7500,
    usefulLifeHours: 10000, totalPrints: 612, totalPrintHours: 1580.2, totalFailures: 15,
    currentJob: null, progress: null, nozzleTemp: 25, bedTemp: 25,
    lastSeen: "2026-03-15T15:45:00",
  },
  {
    id: "3", name: "P1S-01", brand: "Bambu Lab", model: "P1S", serialNumber: "01S00A1P1100098",
    status: "printing", ipAddress: "192.168.1.103", powerWatts: 350, acquisitionCost: 4200,
    usefulLifeHours: 8000, totalPrints: 394, totalPrintHours: 980.7, totalFailures: 8,
    currentJob: "Suporte ABS Reforçado", progress: 23, nozzleTemp: 255, bedTemp: 100,
    lastSeen: "2026-03-15T16:00:00",
  },
  {
    id: "4", name: "A1-01", brand: "Bambu Lab", model: "A1", serialNumber: "01S00A1A0100312",
    status: "offline", ipAddress: "192.168.1.104", powerWatts: 150, acquisitionCost: 1500,
    usefulLifeHours: 6000, totalPrints: 201, totalPrintHours: 420.3, totalFailures: 12,
    currentJob: null, progress: null, nozzleTemp: null, bedTemp: null,
    lastSeen: "2026-03-14T09:20:00",
  },
  {
    id: "5", name: "X1C-03", brand: "Bambu Lab", model: "X1 Carbon", serialNumber: "01S00C4B2100889",
    status: "error", ipAddress: "192.168.1.105", powerWatts: 350, acquisitionCost: 7500,
    usefulLifeHours: 10000, totalPrints: 156, totalPrintHours: 380.1, totalFailures: 5,
    currentJob: "Caixa Eletrônica v2", progress: 44, nozzleTemp: 0, bedTemp: 0,
    lastSeen: "2026-03-15T14:10:00",
  },
  {
    id: "6", name: "P1S-02", brand: "Bambu Lab", model: "P1S", serialNumber: "01S00A1P1100215",
    status: "maintenance", ipAddress: "192.168.1.106", powerWatts: 350, acquisitionCost: 4200,
    usefulLifeHours: 8000, totalPrints: 530, totalPrintHours: 1320.0, totalFailures: 19,
    currentJob: null, progress: null, nozzleTemp: null, bedTemp: null,
    lastSeen: "2026-03-15T10:00:00",
  },
  {
    id: "7", name: "A1M-01", brand: "Bambu Lab", model: "A1 Mini", serialNumber: "01S00A1M0100044",
    status: "paused", ipAddress: "192.168.1.107", powerWatts: 100, acquisitionCost: 1200,
    usefulLifeHours: 5000, totalPrints: 88, totalPrintHours: 190.6, totalFailures: 2,
    currentJob: "Peça teste flexível", progress: 51, nozzleTemp: 210, bedTemp: 55,
    lastSeen: "2026-03-15T15:30:00",
  },
];

// ── Helpers ──
const fmtCurrency = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const fmtHours = (h: number) => `${h.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}h`;
const fmtPercent = (p: number | null) => p !== null ? `${p}%` : "—";

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
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [detailPrinter, setDetailPrinter] = useState<PrinterDevice | null>(null);

  const counts = useMemo(() => {
    const c = { all: mockPrinters.length, printing: 0, idle: 0, error: 0, offline: 0, paused: 0, maintenance: 0 };
    mockPrinters.forEach((p) => c[p.status]++);
    return c;
  }, []);

  const filtered = useMemo(() => {
    return mockPrinters
      .filter((p) => statusFilter === "all" || p.status === statusFilter)
      .filter((p) => {
        if (!search) return true;
        const q = search.toLowerCase();
        return (
          p.name.toLowerCase().includes(q) ||
          p.model.toLowerCase().includes(q) ||
          p.serialNumber.toLowerCase().includes(q) ||
          p.ipAddress.includes(q)
        );
      });
  }, [search, statusFilter]);

  const totalPrintHours = mockPrinters.reduce((sum, p) => sum + p.totalPrintHours, 0);
  const failRate = mockPrinters.reduce((sum, p) => sum + p.totalFailures, 0) / Math.max(mockPrinters.reduce((sum, p) => sum + p.totalPrints, 0), 1) * 100;

  return (
    <div className="space-y-6 page-enter">
      <PageHeader
        title="Impressoras"
        description="Cadastro, monitoramento e gestão do parque de impressoras 3D."
        breadcrumbs={[{ label: "Produção", href: "/producao/jobs" }, { label: "Impressoras" }]}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" className="gap-2">
              <Download className="h-4 w-4" />
              Exportar
            </Button>
            <Button onClick={() => setCreateOpen(true)} className="gap-2">
              <Plus className="h-4 w-4" />
              Nova Impressora
            </Button>
          </div>
        }
      />

      <ArgusBanner
        message={`X1C-03 reportou erro há 2h. Taxa de falha geral está em ${failRate.toFixed(1)}% — considere agendar manutenção preventiva na P1S-02.`}
        actionLabel="Ver diagnóstico"
        type="warning"
      />

      {/* KPI Strip */}
      <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
        {[
          { label: "Total", value: counts.all, filter: "all" as StatusFilter, tone: "status-card-total" },
          { label: "Imprimindo", value: counts.printing, filter: "printing" as StatusFilter, tone: "status-card-paid" },
          { label: "Ociosas", value: counts.idle, filter: "idle" as StatusFilter, tone: "status-card-upcoming" },
          { label: "Pausadas", value: counts.paused, filter: "paused" as StatusFilter, tone: "status-card-today" },
          { label: "Erro", value: counts.error, filter: "error" as StatusFilter, tone: "status-card-overdue" },
          { label: "Manutenção", value: counts.maintenance, filter: "maintenance" as StatusFilter, tone: "status-card-today" },
        ].map((card) => (
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
          <span>Consumo total: <strong className="text-foreground">{mockPrinters.reduce((s, p) => s + p.powerWatts, 0)}W</strong></span>
        </div>
      </div>

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
                <TableHead className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Job Atual</TableHead>
                <TableHead className="text-xs font-semibold uppercase tracking-wide text-muted-foreground text-right">Progresso</TableHead>
                <TableHead className="text-xs font-semibold uppercase tracking-wide text-muted-foreground text-right">Nozzle</TableHead>
                <TableHead className="text-xs font-semibold uppercase tracking-wide text-muted-foreground text-right">Mesa</TableHead>
                <TableHead className="text-xs font-semibold uppercase tracking-wide text-muted-foreground text-right">Prints</TableHead>
                <TableHead className="text-xs font-semibold uppercase tracking-wide text-muted-foreground text-right">Horas</TableHead>
                <TableHead className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">IP</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={11} className="text-center py-16 text-muted-foreground">
                    <Printer className="h-8 w-8 mx-auto mb-2 opacity-40" />
                    <p className="text-sm">Nenhuma impressora encontrada.</p>
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
                    <TableCell className="max-w-[180px] truncate text-sm">
                      {p.currentJob || <span className="text-muted-foreground/50">—</span>}
                    </TableCell>
                    <TableCell className="text-right">
                      {p.progress !== null ? (
                        <div className="flex items-center justify-end gap-2">
                          <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
                            <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${p.progress}%` }} />
                          </div>
                          <span className="font-mono text-xs tabular-nums text-foreground">{p.progress}%</span>
                        </div>
                      ) : (
                        <span className="text-muted-foreground/50">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm tabular-nums">
                      {p.nozzleTemp !== null ? <span>{p.nozzleTemp}°C</span> : "—"}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm tabular-nums">
                      {p.bedTemp !== null ? <span>{p.bedTemp}°C</span> : "—"}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm tabular-nums">{p.totalPrints.toLocaleString("pt-BR")}</TableCell>
                    <TableCell className="text-right font-mono text-sm tabular-nums">{fmtHours(p.totalPrintHours)}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{p.ipAddress}</TableCell>
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
                          <DropdownMenuItem>
                            <Edit className="h-4 w-4 mr-2" /> Editar
                          </DropdownMenuItem>
                          <DropdownMenuItem>
                            <Settings2 className="h-4 w-4 mr-2" /> Configurar
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem className="text-destructive">
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

      {/* Create Dialog */}
      <CreatePrinterDialog open={createOpen} onOpenChange={setCreateOpen} />

      {/* Detail Dialog */}
      <PrinterDetailDialog printer={detailPrinter} onClose={() => setDetailPrinter(null)} />
    </div>
  );
}

// ── Create Dialog ──
function CreatePrinterDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Nova Impressora</DialogTitle>
          <DialogDescription>Cadastre uma nova impressora 3D no parque de produção.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="printer-name">Nome *</Label>
              <Input id="printer-name" placeholder="Ex: X1C-04" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="printer-brand">Marca</Label>
              <Select defaultValue="bambu">
                <SelectTrigger id="printer-brand"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="bambu">Bambu Lab</SelectItem>
                  <SelectItem value="creality">Creality</SelectItem>
                  <SelectItem value="prusa">Prusa</SelectItem>
                  <SelectItem value="voron">Voron</SelectItem>
                  <SelectItem value="outro">Outro</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="printer-model">Modelo *</Label>
              <Input id="printer-model" placeholder="Ex: X1 Carbon" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="printer-serial">Nº Série</Label>
              <Input id="printer-serial" placeholder="Ex: 01S00C4B2100231" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="printer-ip">Endereço IP</Label>
              <Input id="printer-ip" placeholder="Ex: 192.168.1.101" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="printer-power">Potência (W)</Label>
              <Input id="printer-power" type="number" placeholder="350" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="printer-cost">Custo de Aquisição</Label>
              <Input id="printer-cost" type="number" placeholder="7500.00" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="printer-life">Vida Útil (horas)</Label>
              <Input id="printer-life" type="number" placeholder="10000" />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="printer-notes">Observações</Label>
            <Input id="printer-notes" placeholder="Notas adicionais sobre a impressora..." />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={() => onOpenChange(false)}>Cadastrar Impressora</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Detail Dialog ──
function PrinterDetailDialog({ printer, onClose }: { printer: PrinterDevice | null; onClose: () => void }) {
  if (!printer) return null;

  const depreciationPerHour = printer.acquisitionCost / printer.usefulLifeHours;
  const usagePercent = (printer.totalPrintHours / printer.usefulLifeHours) * 100;

  return (
    <Dialog open={!!printer} onOpenChange={() => onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className={cn(
              "h-3 w-3 rounded-full flex-shrink-0",
              printer.status === "printing" && "bg-emerald-500 animate-pulse",
              printer.status === "idle" && "bg-primary",
              printer.status === "error" && "bg-destructive",
              printer.status === "offline" && "bg-muted-foreground/30",
              (printer.status === "paused" || printer.status === "maintenance") && "bg-amber-500",
            )} />
            <DialogTitle>{printer.name}</DialogTitle>
            <PrinterStatusBadge status={printer.status} />
          </div>
          <DialogDescription>{printer.brand} {printer.model} · SN: {printer.serialNumber}</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 py-4">
          {[
            { label: "Impressões", value: printer.totalPrints.toLocaleString("pt-BR"), icon: Printer },
            { label: "Horas de Uso", value: fmtHours(printer.totalPrintHours), icon: Clock },
            { label: "Falhas", value: printer.totalFailures.toString(), icon: AlertTriangle },
            { label: "Deprec./hora", value: fmtCurrency(depreciationPerHour), icon: Zap },
          ].map((item) => (
            <div key={item.label} className="card-enterprise !p-3 space-y-1">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <item.icon className="h-3.5 w-3.5" />
                {item.label}
              </div>
              <p className="text-lg font-bold tabular-nums text-foreground">{item.value}</p>
            </div>
          ))}
        </div>

        {/* Usage bar */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Vida útil consumida</span>
            <span className="font-mono font-semibold tabular-nums text-foreground">{usagePercent.toFixed(1)}%</span>
          </div>
          <div className="h-2 bg-muted rounded-full overflow-hidden">
            <div
              className={cn(
                "h-full rounded-full transition-all",
                usagePercent > 80 ? "bg-destructive" : usagePercent > 60 ? "bg-amber-500" : "bg-primary"
              )}
              style={{ width: `${Math.min(usagePercent, 100)}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            {fmtHours(printer.totalPrintHours)} de {fmtHours(printer.usefulLifeHours)} estimadas
          </p>
        </div>

        {printer.currentJob && (
          <div className="card-enterprise !p-4 space-y-2 bg-primary/5 border-primary/10">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Job em Andamento</h4>
            <p className="text-sm font-semibold text-foreground">{printer.currentJob}</p>
            <div className="flex items-center gap-3">
              <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                <div className="h-full bg-primary rounded-full" style={{ width: `${printer.progress}%` }} />
              </div>
              <span className="font-mono text-sm font-bold tabular-nums text-primary">{printer.progress}%</span>
            </div>
            <div className="flex gap-4 text-xs text-muted-foreground">
              <span className="flex items-center gap-1"><Thermometer className="h-3 w-3" /> Nozzle: {printer.nozzleTemp}°C</span>
              <span className="flex items-center gap-1"><Thermometer className="h-3 w-3" /> Mesa: {printer.bedTemp}°C</span>
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-4 text-sm">
          <div className="space-y-2">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Rede</span>
            <p className="font-mono text-foreground">{printer.ipAddress}</p>
          </div>
          <div className="space-y-2">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Potência</span>
            <p className="text-foreground">{printer.powerWatts}W</p>
          </div>
          <div className="space-y-2">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Custo Aquisição</span>
            <p className="text-foreground">{fmtCurrency(printer.acquisitionCost)}</p>
          </div>
          <div className="space-y-2">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Vida Útil</span>
            <p className="text-foreground">{printer.usefulLifeHours.toLocaleString("pt-BR")}h</p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Fechar</Button>
          <Button variant="outline" className="gap-2">
            <Edit className="h-4 w-4" /> Editar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
