import { useState, useMemo } from "react";
import {
  Receipt,
  Plus,
  Search,
  Filter,
  ArrowUpDown,
  MoreHorizontal,
  Paperclip,
  Calendar,
  DollarSign,
  AlertTriangle,
  CheckCircle2,
  Clock,
  XCircle,
  ArrowRight,
  Download,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// ─── Types ────────────────────────────────────────────
type PayableStatus = "open" | "partial" | "paid" | "overdue" | "cancelled";

interface Payable {
  id: string;
  description: string;
  vendor: string;
  amount: number;
  amountPaid: number;
  dueDate: string;
  competenceDate: string;
  status: PayableStatus;
  account: string;
  costCenter: string;
  paymentMethod: string;
  installment: string;
  attachments: number;
  notes: string;
}

// ─── Status config ────────────────────────────────────
const statusConfig: Record<PayableStatus, { label: string; icon: React.ElementType; className: string }> = {
  open: { label: "Aberto", icon: Clock, className: "badge-warning" },
  partial: { label: "Parcial", icon: DollarSign, className: "badge-argus" },
  paid: { label: "Pago", icon: CheckCircle2, className: "badge-success" },
  overdue: { label: "Vencido", icon: AlertTriangle, className: "badge-destructive" },
  cancelled: { label: "Cancelado", icon: XCircle, className: "bg-muted-foreground/10 text-muted-foreground border border-muted-foreground/20" },
};

// ─── Mock data ────────────────────────────────────────
const mockPayables: Payable[] = [
  { id: "AP-0001", description: "Filamento PLA Preto 10kg", vendor: "Bambu Lab Store", amount: 3200.00, amountPaid: 0, dueDate: "2026-03-14", competenceDate: "2026-03-01", status: "overdue", account: "3.1.01 - Matéria Prima", costCenter: "CC01 - Produção", paymentMethod: "PIX", installment: "1/1", attachments: 1, notes: "" },
  { id: "AP-0002", description: "Energia Elétrica - Mar/2026", vendor: "CEMIG", amount: 890.50, amountPaid: 0, dueDate: "2026-03-20", competenceDate: "2026-03-01", status: "open", account: "3.1.04 - Energia", costCenter: "CC01 - Produção", paymentMethod: "Boleto", installment: "1/1", attachments: 0, notes: "" },
  { id: "AP-0003", description: "Filamento PETG Branco 5kg", vendor: "Filament Express", amount: 1240.00, amountPaid: 620.00, dueDate: "2026-03-17", competenceDate: "2026-02-15", status: "partial", account: "3.1.01 - Matéria Prima", costCenter: "CC01 - Produção", paymentMethod: "PIX", installment: "1/2", attachments: 2, notes: "Parcela 1 paga em 01/03" },
  { id: "AP-0004", description: "Manutenção Preventiva X1C-02", vendor: "TechPrint Serviços", amount: 450.00, amountPaid: 450.00, dueDate: "2026-03-10", competenceDate: "2026-03-10", status: "paid", account: "3.1.05 - Manutenção", costCenter: "CC02 - Manutenção", paymentMethod: "PIX", installment: "1/1", attachments: 1, notes: "NF 4521" },
  { id: "AP-0005", description: "Álcool Isopropílico 5L", vendor: "Quimisa", amount: 89.90, amountPaid: 89.90, dueDate: "2026-03-08", competenceDate: "2026-03-05", status: "paid", account: "3.1.02 - Insumos", costCenter: "CC01 - Produção", paymentMethod: "Cartão", installment: "1/1", attachments: 0, notes: "" },
  { id: "AP-0006", description: "Aluguel Galpão - Mar/2026", vendor: "Imobiliária Central", amount: 3500.00, amountPaid: 0, dueDate: "2026-03-05", competenceDate: "2026-03-01", status: "overdue", account: "3.2.01 - Aluguel", costCenter: "CC03 - Administrativo", paymentMethod: "Boleto", installment: "1/1", attachments: 1, notes: "" },
  { id: "AP-0007", description: "Nozzle 0.4mm Hardened (5x)", vendor: "Bambu Lab Store", amount: 275.00, amountPaid: 0, dueDate: "2026-03-25", competenceDate: "2026-03-15", status: "open", account: "3.1.03 - Peças", costCenter: "CC02 - Manutenção", paymentMethod: "PIX", installment: "1/1", attachments: 0, notes: "" },
  { id: "AP-0008", description: "Internet Fibra 500Mbps", vendor: "Vivo Empresas", amount: 249.90, amountPaid: 0, dueDate: "2026-03-22", competenceDate: "2026-03-01", status: "open", account: "3.2.02 - Telecom", costCenter: "CC03 - Administrativo", paymentMethod: "Débito Auto", installment: "1/1", attachments: 0, notes: "" },
  { id: "AP-0009", description: "Embalagens personalizadas (500un)", vendor: "PackPrint", amount: 1800.00, amountPaid: 0, dueDate: "2026-03-28", competenceDate: "2026-03-12", status: "open", account: "3.1.02 - Insumos", costCenter: "CC04 - Expedição", paymentMethod: "Boleto", installment: "1/3", attachments: 1, notes: "Primeira parcela de 3" },
  { id: "AP-0010", description: "Software CAD - Licença anual", vendor: "Autodesk", amount: 2400.00, amountPaid: 2400.00, dueDate: "2026-02-28", competenceDate: "2026-02-01", status: "paid", account: "3.2.03 - Software", costCenter: "CC03 - Administrativo", paymentMethod: "Cartão", installment: "1/1", attachments: 1, notes: "Renovação automática" },
];

// ─── Formatters ───────────────────────────────────────
const fmtCurrency = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const fmtDate = (d: string) => {
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y}`;
};

const isOverdue = (dueDate: string, status: PayableStatus) => {
  if (status === "paid" || status === "cancelled") return false;
  return new Date(dueDate) < new Date();
};

// ─── StatusBadge ──────────────────────────────────────
function APStatusBadge({ status }: { status: PayableStatus }) {
  const config = statusConfig[status];
  const Icon = config.icon;
  return (
    <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium font-mono", config.className)}>
      <Icon className="w-3 h-3" />
      {config.label}
    </span>
  );
}

// ─── Main Component ───────────────────────────────────
export default function ContasPagar() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<PayableStatus | "all">("all");
  const [sortField, setSortField] = useState<"dueDate" | "amount" | "vendor">("dueDate");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [createOpen, setCreateOpen] = useState(false);

  // Summary KPIs
  const summary = useMemo(() => {
    const total = mockPayables.reduce((s, p) => s + p.amount, 0);
    const paid = mockPayables.filter(p => p.status === "paid").reduce((s, p) => s + p.amountPaid, 0);
    const overdue = mockPayables.filter(p => p.status === "overdue").reduce((s, p) => s + (p.amount - p.amountPaid), 0);
    const open = mockPayables.filter(p => p.status === "open" || p.status === "partial").reduce((s, p) => s + (p.amount - p.amountPaid), 0);
    return { total, paid, overdue, open };
  }, []);

  // Filter + sort
  const filtered = useMemo(() => {
    let items = [...mockPayables];
    if (statusFilter !== "all") items = items.filter(p => p.status === statusFilter);
    if (search) {
      const q = search.toLowerCase();
      items = items.filter(p =>
        p.description.toLowerCase().includes(q) ||
        p.vendor.toLowerCase().includes(q) ||
        p.id.toLowerCase().includes(q)
      );
    }
    items.sort((a, b) => {
      let cmp = 0;
      if (sortField === "dueDate") cmp = a.dueDate.localeCompare(b.dueDate);
      else if (sortField === "amount") cmp = a.amount - b.amount;
      else cmp = a.vendor.localeCompare(b.vendor);
      return sortDir === "asc" ? cmp : -cmp;
    });
    return items;
  }, [search, statusFilter, sortField, sortDir]);

  const toggleSort = (field: typeof sortField) => {
    if (sortField === field) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortField(field); setSortDir("asc"); }
  };

  const SortIcon = ({ field }: { field: typeof sortField }) => (
    <ArrowUpDown className={cn("w-3 h-3 ml-1 inline-block", sortField === field ? "text-primary" : "text-muted-foreground/50")} />
  );

  return (
    <div className="p-6 space-y-5 max-w-[1600px]">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Contas a Pagar</h1>
          <p className="text-xs text-muted-foreground">Gerencie despesas, fornecedores e vencimentos</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="text-xs gap-1.5">
            <Download className="w-3.5 h-3.5" />
            Exportar
          </Button>
          <Button size="sm" className="text-xs gap-1.5" onClick={() => setCreateOpen(true)}>
            <Plus className="w-3.5 h-3.5" />
            Nova Conta
          </Button>
        </div>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiMini label="Total Período" value={fmtCurrency(summary.total)} icon={<DollarSign className="w-3.5 h-3.5" />} />
        <KpiMini label="Pago" value={fmtCurrency(summary.paid)} icon={<CheckCircle2 className="w-3.5 h-3.5" />} variant="success" />
        <KpiMini label="Em Aberto" value={fmtCurrency(summary.open)} icon={<Clock className="w-3.5 h-3.5" />} variant="warning" />
        <KpiMini label="Vencido" value={fmtCurrency(summary.overdue)} icon={<AlertTriangle className="w-3.5 h-3.5" />} variant="destructive" />
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            placeholder="Buscar por descrição, fornecedor ou ID..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-8 h-8 text-xs bg-secondary/50 border-border"
          />
        </div>
        <div className="flex items-center gap-1.5">
          <Filter className="w-3.5 h-3.5 text-muted-foreground" />
          {(["all", "open", "partial", "overdue", "paid", "cancelled"] as const).map(s => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={cn(
                "px-2.5 py-1 rounded text-[11px] font-medium transition-colors border",
                statusFilter === s
                  ? "bg-primary/15 text-primary border-primary/30"
                  : "text-muted-foreground border-transparent hover:bg-secondary hover:text-foreground"
              )}
            >
              {s === "all" ? "Todos" : statusConfig[s].label}
              {s !== "all" && (
                <span className="ml-1 text-[10px] opacity-60">
                  {mockPayables.filter(p => p.status === s).length}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="forge-card rounded-md overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border text-muted-foreground bg-secondary/30">
                <th className="text-left px-3 py-2.5 font-medium w-[72px]">ID</th>
                <th className="text-left px-3 py-2.5 font-medium">Descrição</th>
                <th className="text-left px-3 py-2.5 font-medium cursor-pointer select-none" onClick={() => toggleSort("vendor")}>
                  Fornecedor <SortIcon field="vendor" />
                </th>
                <th className="text-left px-3 py-2.5 font-medium">Conta / CC</th>
                <th className="text-right px-3 py-2.5 font-medium cursor-pointer select-none" onClick={() => toggleSort("amount")}>
                  Valor <SortIcon field="amount" />
                </th>
                <th className="text-right px-3 py-2.5 font-medium">Pago</th>
                <th className="text-center px-3 py-2.5 font-medium cursor-pointer select-none" onClick={() => toggleSort("dueDate")}>
                  Vencimento <SortIcon field="dueDate" />
                </th>
                <th className="text-center px-3 py-2.5 font-medium">Parcela</th>
                <th className="text-center px-3 py-2.5 font-medium">Status</th>
                <th className="text-center px-3 py-2.5 font-medium w-[40px]"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr
                  key={p.id}
                  className={cn(
                    "border-b border-border/50 hover:bg-secondary/40 transition-colors group",
                    p.status === "overdue" && "bg-destructive/[0.03]"
                  )}
                >
                  <td className="px-3 py-2.5 font-mono text-muted-foreground text-[11px]">{p.id}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className="text-foreground font-medium truncate max-w-[220px]">{p.description}</span>
                      {p.attachments > 0 && (
                        <span className="flex items-center gap-0.5 text-muted-foreground">
                          <Paperclip className="w-3 h-3" />
                          <span className="text-[10px]">{p.attachments}</span>
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-muted-foreground truncate max-w-[140px]">{p.vendor}</td>
                  <td className="px-3 py-2.5">
                    <div className="text-[11px]">
                      <span className="text-muted-foreground">{p.account.split(" - ")[0]}</span>
                      <span className="text-foreground/70 ml-1">{p.account.split(" - ")[1]}</span>
                    </div>
                    <div className="text-[10px] text-muted-foreground/60">{p.costCenter}</div>
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono text-foreground">{fmtCurrency(p.amount)}</td>
                  <td className="px-3 py-2.5 text-right font-mono">
                    {p.amountPaid > 0 ? (
                      <span className="text-success">{fmtCurrency(p.amountPaid)}</span>
                    ) : (
                      <span className="text-muted-foreground/40">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-center font-mono">
                    <span className={cn(
                      isOverdue(p.dueDate, p.status) ? "text-destructive" : "text-muted-foreground"
                    )}>
                      {fmtDate(p.dueDate)}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-center font-mono text-muted-foreground text-[11px]">{p.installment}</td>
                  <td className="px-3 py-2.5 text-center">
                    <APStatusBadge status={p.status} />
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button className="p-1 rounded hover:bg-secondary opacity-0 group-hover:opacity-100 transition-opacity">
                          <MoreHorizontal className="w-3.5 h-3.5 text-muted-foreground" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-44">
                        <DropdownMenuItem className="text-xs gap-2">
                          <Receipt className="w-3.5 h-3.5" /> Ver detalhes
                        </DropdownMenuItem>
                        <DropdownMenuItem className="text-xs gap-2">
                          <DollarSign className="w-3.5 h-3.5" /> Registrar pagamento
                        </DropdownMenuItem>
                        <DropdownMenuItem className="text-xs gap-2">
                          <Paperclip className="w-3.5 h-3.5" /> Anexar arquivo
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem className="text-xs gap-2 text-destructive">
                          <XCircle className="w-3.5 h-3.5" /> Cancelar
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-3 py-12 text-center text-muted-foreground">
                    <Search className="w-5 h-5 mx-auto mb-2 opacity-40" />
                    Nenhuma conta encontrada com os filtros aplicados.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination footer */}
        <div className="px-4 py-2.5 border-t border-border flex items-center justify-between text-xs text-muted-foreground">
          <span>{filtered.length} de {mockPayables.length} registros</span>
          <div className="flex items-center gap-1">
            <button className="p-1 rounded hover:bg-secondary transition-colors" disabled>
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <span className="px-2 font-mono">1 / 1</span>
            <button className="p-1 rounded hover:bg-secondary transition-colors" disabled>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Create Dialog */}
      <CreatePayableDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}

// ─── KPI Mini Card ────────────────────────────────────
function KpiMini({
  label,
  value,
  icon,
  variant = "default",
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  variant?: "default" | "success" | "warning" | "destructive";
}) {
  const variantClasses = {
    default: "text-foreground",
    success: "text-success",
    warning: "text-warning",
    destructive: "text-destructive",
  };

  return (
    <div className="forge-card rounded-md px-3 py-2.5 flex items-center gap-3">
      <div className={cn("p-1.5 rounded bg-secondary", variantClasses[variant])}>
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</p>
        <p className={cn("text-sm font-semibold font-mono truncate", variantClasses[variant])}>{value}</p>
      </div>
    </div>
  );
}

// ─── Create Payable Dialog ────────────────────────────
function CreatePayableDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] gap-0">
        <DialogHeader className="pb-4 border-b border-border">
          <DialogTitle className="text-sm font-semibold flex items-center gap-2">
            <Receipt className="w-4 h-4 text-primary" />
            Nova Conta a Pagar
          </DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          {/* Row 1 */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Descrição *</Label>
              <Input className="h-8 text-xs" placeholder="Ex: Filamento PLA Preto 10kg" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Fornecedor</Label>
              <Select>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Selecione..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="bambu">Bambu Lab Store</SelectItem>
                  <SelectItem value="filament">Filament Express</SelectItem>
                  <SelectItem value="cemig">CEMIG</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Row 2 */}
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Valor *</Label>
              <Input className="h-8 text-xs font-mono" placeholder="0,00" type="text" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Vencimento *</Label>
              <Input className="h-8 text-xs" type="date" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Competência</Label>
              <Input className="h-8 text-xs" type="date" />
            </div>
          </div>

          {/* Row 3 */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Conta Contábil</Label>
              <Select>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Selecione..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="mp">3.1.01 - Matéria Prima</SelectItem>
                  <SelectItem value="ins">3.1.02 - Insumos</SelectItem>
                  <SelectItem value="pec">3.1.03 - Peças</SelectItem>
                  <SelectItem value="ene">3.1.04 - Energia</SelectItem>
                  <SelectItem value="man">3.1.05 - Manutenção</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Centro de Custo</Label>
              <Select>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Selecione..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="prod">CC01 - Produção</SelectItem>
                  <SelectItem value="mnt">CC02 - Manutenção</SelectItem>
                  <SelectItem value="adm">CC03 - Administrativo</SelectItem>
                  <SelectItem value="exp">CC04 - Expedição</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Row 4 */}
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Forma de Pagamento</Label>
              <Select>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Selecione..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pix">PIX</SelectItem>
                  <SelectItem value="boleto">Boleto</SelectItem>
                  <SelectItem value="cartao">Cartão</SelectItem>
                  <SelectItem value="debito">Débito Auto</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Nº Parcelas</Label>
              <Input className="h-8 text-xs font-mono" type="number" defaultValue={1} min={1} max={48} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Conta Bancária</Label>
              <Select>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Selecione..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="bb">Banco do Brasil</SelectItem>
                  <SelectItem value="nubank">Nubank PJ</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Notes */}
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Observações</Label>
            <Textarea className="text-xs min-h-[60px] resize-none" placeholder="Notas, referências, NF..." />
          </div>

          {/* Attachment hint */}
          <div className="flex items-center gap-2 px-3 py-2 rounded bg-secondary/50 border border-border text-xs text-muted-foreground">
            <Paperclip className="w-3.5 h-3.5" />
            Anexos podem ser adicionados após salvar o registro.
          </div>
        </div>

        <DialogFooter className="pt-3 border-t border-border gap-2">
          <Button variant="outline" size="sm" className="text-xs" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button size="sm" className="text-xs gap-1.5" onClick={() => onOpenChange(false)}>
            <Plus className="w-3.5 h-3.5" />
            Criar Conta
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
