import { useState, useMemo } from "react";
import { PageHeader } from "@/components/shared/PageHeader";
import { ArgusBanner } from "@/components/shared/ArgusBanner";
import {
  Plus,
  Search,
  MoreHorizontal,
  Paperclip,
  DollarSign,
  AlertTriangle,
  CheckCircle2,
  Clock,
  XCircle,
  Download,
  Receipt,
  Eye,
  Edit,
  Copy,
  Trash2,
  Calendar,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
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

// ─── Types ────────────────────────────────────
type PayableStatus = "open" | "partial" | "paid" | "overdue" | "cancelled";
type StatusFilter = PayableStatus | "all" | "today";

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
}

// ─── Mock Data ────────────────────────────────
const mockPayables: Payable[] = [
  { id: "AP-0001", description: "Filamento PLA Preto 10kg", vendor: "Bambu Lab Store", amount: 3200.00, amountPaid: 0, dueDate: "2026-03-14", competenceDate: "2026-03-01", status: "overdue", account: "3.1.01 - Matéria Prima", costCenter: "CC01 - Produção", paymentMethod: "PIX", installment: "1/1", attachments: 1 },
  { id: "AP-0002", description: "Energia Elétrica - Mar/2026", vendor: "CEMIG", amount: 890.50, amountPaid: 0, dueDate: "2026-03-20", competenceDate: "2026-03-01", status: "open", account: "3.1.04 - Energia", costCenter: "CC01 - Produção", paymentMethod: "Boleto", installment: "1/1", attachments: 0 },
  { id: "AP-0003", description: "Filamento PETG Branco 5kg", vendor: "Filament Express", amount: 1240.00, amountPaid: 620.00, dueDate: "2026-03-17", competenceDate: "2026-02-15", status: "partial", account: "3.1.01 - Matéria Prima", costCenter: "CC01 - Produção", paymentMethod: "PIX", installment: "1/2", attachments: 2 },
  { id: "AP-0004", description: "Manutenção Preventiva X1C-02", vendor: "TechPrint Serviços", amount: 450.00, amountPaid: 450.00, dueDate: "2026-03-10", competenceDate: "2026-03-10", status: "paid", account: "3.1.05 - Manutenção", costCenter: "CC02 - Manutenção", paymentMethod: "PIX", installment: "1/1", attachments: 1 },
  { id: "AP-0005", description: "Álcool Isopropílico 5L", vendor: "Quimisa", amount: 89.90, amountPaid: 89.90, dueDate: "2026-03-08", competenceDate: "2026-03-05", status: "paid", account: "3.1.02 - Insumos", costCenter: "CC01 - Produção", paymentMethod: "Cartão", installment: "1/1", attachments: 0 },
  { id: "AP-0006", description: "Aluguel Galpão - Mar/2026", vendor: "Imobiliária Central", amount: 3500.00, amountPaid: 0, dueDate: "2026-03-05", competenceDate: "2026-03-01", status: "overdue", account: "3.2.01 - Aluguel", costCenter: "CC03 - Administrativo", paymentMethod: "Boleto", installment: "1/1", attachments: 1 },
  { id: "AP-0007", description: "Nozzle 0.4mm Hardened (5x)", vendor: "Bambu Lab Store", amount: 275.00, amountPaid: 0, dueDate: "2026-03-25", competenceDate: "2026-03-15", status: "open", account: "3.1.03 - Peças", costCenter: "CC02 - Manutenção", paymentMethod: "PIX", installment: "1/1", attachments: 0 },
  { id: "AP-0008", description: "Internet Fibra 500Mbps", vendor: "Vivo Empresas", amount: 249.90, amountPaid: 0, dueDate: "2026-03-22", competenceDate: "2026-03-01", status: "open", account: "3.2.02 - Telecom", costCenter: "CC03 - Administrativo", paymentMethod: "Débito Auto", installment: "1/1", attachments: 0 },
  { id: "AP-0009", description: "Embalagens personalizadas (500un)", vendor: "PackPrint", amount: 1800.00, amountPaid: 0, dueDate: "2026-03-28", competenceDate: "2026-03-12", status: "open", account: "3.1.02 - Insumos", costCenter: "CC04 - Expedição", paymentMethod: "Boleto", installment: "1/3", attachments: 1 },
  { id: "AP-0010", description: "Software CAD - Licença anual", vendor: "Autodesk", amount: 2400.00, amountPaid: 2400.00, dueDate: "2026-02-28", competenceDate: "2026-02-01", status: "paid", account: "3.2.03 - Software", costCenter: "CC03 - Administrativo", paymentMethod: "Cartão", installment: "1/1", attachments: 1 },
];

// ─── Helpers ──────────────────────────────────
const fmtCurrency = (v: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);

const fmtDate = (d: string) => {
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y}`;
};

// ─── Main Component ───────────────────────────
export default function ContasPagar() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [createOpen, setCreateOpen] = useState(false);

  // Status card calculations
  const { counts, amounts, filteredPayables } = useMemo(() => {
    const today = new Date().toISOString().split("T")[0];
    const calc = {
      all: { count: 0, amount: 0 },
      overdue: { count: 0, amount: 0 },
      today: { count: 0, amount: 0 },
      open: { count: 0, amount: 0 },
      paid: { count: 0, amount: 0 },
    };

    mockPayables.forEach((p) => {
      calc.all.count++;
      calc.all.amount += p.amount;

      if (p.status === "paid") {
        calc.paid.count++;
        calc.paid.amount += p.amountPaid;
      } else if (p.dueDate === today) {
        calc.today.count++;
        calc.today.amount += p.amount - p.amountPaid;
      } else if (p.dueDate < today && p.status !== "cancelled") {
        calc.overdue.count++;
        calc.overdue.amount += p.amount - p.amountPaid;
      } else {
        calc.open.count++;
        calc.open.amount += p.amount - p.amountPaid;
      }
    });

    let filtered = [...mockPayables];
    if (statusFilter !== "all") {
      filtered = filtered.filter((p) => {
        if (statusFilter === "paid") return p.status === "paid";
        if (statusFilter === "overdue") return p.status === "overdue";
        if (statusFilter === "today") return p.dueDate === today;
        if (statusFilter === "open") return p.status === "open" || p.status === "partial";
        if (statusFilter === "cancelled") return p.status === "cancelled";
        return true;
      });
    }
    if (search) {
      const q = search.toLowerCase();
      filtered = filtered.filter((p) =>
        p.description.toLowerCase().includes(q) ||
        p.vendor.toLowerCase().includes(q) ||
        p.id.toLowerCase().includes(q)
      );
    }
    filtered.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    return { counts: calc, amounts: calc, filteredPayables: filtered };
  }, [search, statusFilter]);

  const statusCards: { key: StatusFilter; label: string; count: number; amount: number; colorClass: string; countColor: string }[] = [
    { key: "overdue", label: "Vencidos", count: counts.overdue.count, amount: amounts.overdue.amount, colorClass: "status-card-overdue", countColor: "text-destructive" },
    { key: "today", label: "Vence Hoje", count: counts.today.count, amount: amounts.today.amount, colorClass: "status-card-today", countColor: "text-amber-500" },
    { key: "open", label: "A Vencer", count: counts.open.count, amount: amounts.open.amount, colorClass: "status-card-upcoming", countColor: "text-primary" },
    { key: "paid", label: "Pagos", count: counts.paid.count, amount: amounts.paid.amount, colorClass: "status-card-paid", countColor: "text-emerald-600" },
    { key: "all", label: "Total", count: counts.all.count, amount: amounts.all.amount, colorClass: "status-card-total", countColor: "text-foreground" },
  ];

  const toggleSelect = (id: string) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(id)) newSet.delete(id); else newSet.add(id);
    setSelectedIds(newSet);
  };

  const toggleSelectAll = () => {
    const selectableIds = filteredPayables.filter(p => p.status !== "paid").map(p => p.id);
    if (selectableIds.every(id => selectedIds.has(id))) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(selectableIds));
    }
  };

  const allSelected = filteredPayables.filter(p => p.status !== "paid").length > 0 &&
    filteredPayables.filter(p => p.status !== "paid").every(p => selectedIds.has(p.id));

  const selectedTotal = Array.from(selectedIds).reduce((sum, id) => {
    const p = mockPayables.find(x => x.id === id);
    return sum + (p?.amount || 0);
  }, 0);

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Contas a Pagar"
        description="Gerencie lançamentos, vencimentos e pagamentos"
        breadcrumbs={[{ label: "Financeiro" }, { label: "Contas a Pagar" }]}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="gap-2 text-xs bg-card">
              <Download className="h-3.5 w-3.5" />
              Exportar
            </Button>
            <Button size="sm" className="gap-2 text-xs" onClick={() => setCreateOpen(true)}>
              <Plus className="h-3.5 w-3.5" />
              Nova Conta
            </Button>
          </div>
        }
      />

      {/* Argus AI Banner */}
      <ArgusBanner
        message="3 contas vencem esta semana totalizando R$ 5.330,50. Sugiro priorizar Bambu Lab Store (vencido há 1 dia)."
        actionLabel="Ver sugestão"
        type="warning"
      />

      {/* Status Cards (Filter) */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {statusCards.map((card) => {
          const isActive = statusFilter === card.key;
          return (
            <button
              key={card.key}
              onClick={() => setStatusFilter(card.key)}
              className={cn(
                "status-card text-left",
                isActive && "status-card-active",
                isActive && card.colorClass
              )}
            >
              <span className={cn("status-card-count", card.countColor)}>{card.count}</span>
              <span className="status-card-value">R$ {card.amount.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</span>
              <span className="status-card-label">{card.label}</span>
            </button>
          );
        })}
      </div>

      {/* Search */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por descrição, fornecedor ou ID..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-9 bg-card border-border text-sm"
          />
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Calendar className="h-4 w-4" />
          <span>Março 2026</span>
        </div>
      </div>

      {/* Bulk Actions Bar */}
      {selectedIds.size > 0 && (
        <div className="bulk-actions-bar animate-fade-in">
          <span className="text-sm font-medium text-primary">
            {selectedIds.size} selecionado(s) · {fmtCurrency(selectedTotal)}
          </span>
          <div className="flex items-center gap-2 ml-auto">
            <Button size="sm" variant="outline" className="text-xs gap-1.5">
              <DollarSign className="h-3.5 w-3.5" />
              Pagar selecionados
            </Button>
            <Button size="sm" variant="outline" className="text-xs gap-1.5 text-destructive border-destructive/30 hover:bg-destructive/5">
              <Trash2 className="h-3.5 w-3.5" />
              Excluir
            </Button>
            <Button size="sm" variant="ghost" className="text-xs" onClick={() => setSelectedIds(new Set())}>
              Limpar
            </Button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="card-enterprise !p-0 overflow-hidden">
        <div className="border rounded-lg overflow-hidden overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50 hover:bg-muted/50">
                <TableHead className="w-12">
                  <Checkbox checked={allSelected} onCheckedChange={toggleSelectAll} />
                </TableHead>
                <TableHead className="min-w-[200px] text-xs font-semibold text-muted-foreground uppercase">Descrição</TableHead>
                <TableHead className="text-xs font-semibold text-muted-foreground uppercase">Fornecedor</TableHead>
                <TableHead className="text-xs font-semibold text-muted-foreground uppercase">Vencimento</TableHead>
                <TableHead className="text-xs font-semibold text-muted-foreground uppercase">Plano de Contas</TableHead>
                <TableHead className="text-xs font-semibold text-muted-foreground uppercase">Centro de Custo</TableHead>
                <TableHead className="text-right text-xs font-semibold text-muted-foreground uppercase">Valor</TableHead>
                <TableHead className="text-xs font-semibold text-muted-foreground uppercase">Status</TableHead>
                <TableHead className="w-12"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredPayables.map((p) => {
                const isSelected = selectedIds.has(p.id);
                const canSelect = p.status !== "paid";

                return (
                  <TableRow
                    key={p.id}
                    className={cn(
                      "group transition-colors cursor-pointer hover:bg-muted/50",
                      isSelected && "bg-primary/5"
                    )}
                  >
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => toggleSelect(p.id)}
                        disabled={!canSelect}
                      />
                    </TableCell>
                    <TableCell>
                      <div className="space-y-0.5">
                        <span className="font-medium text-foreground line-clamp-1">{p.description}</span>
                        <div className="flex items-center gap-2">
                          {p.installment !== "1/1" && (
                            <code className="text-[11px] bg-muted px-1.5 py-0.5 rounded font-mono text-muted-foreground">{p.installment}</code>
                          )}
                          {p.attachments > 0 && (
                            <span className="flex items-center gap-0.5 text-muted-foreground">
                              <Paperclip className="w-3 h-3" />
                              <span className="text-[11px]">{p.attachments}</span>
                            </span>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm font-medium text-primary hover:underline cursor-pointer">{p.vendor}</span>
                    </TableCell>
                    <TableCell>
                      <span className={cn(
                        "text-sm tabular-nums",
                        p.status === "overdue" ? "text-destructive font-medium" : "text-foreground"
                      )}>
                        {fmtDate(p.dueDate)}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="text-xs text-muted-foreground">{p.account}</span>
                    </TableCell>
                    <TableCell>
                      <span className="text-xs text-muted-foreground">{p.costCenter}</span>
                    </TableCell>
                    <TableCell className="text-right">
                      <span className="font-semibold tabular-nums">{fmtCurrency(p.amount)}</span>
                      {p.amountPaid > 0 && p.amountPaid < p.amount && (
                        <p className="text-[11px] text-emerald-600">Pago: {fmtCurrency(p.amountPaid)}</p>
                      )}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={p.status} />
                    </TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-48">
                          <DropdownMenuItem className="gap-2"><Eye className="h-4 w-4" /> Ver detalhes</DropdownMenuItem>
                          <DropdownMenuItem className="gap-2"><Edit className="h-4 w-4" /> Editar</DropdownMenuItem>
                          {p.status !== "paid" && (
                            <DropdownMenuItem className="gap-2"><DollarSign className="h-4 w-4" /> Registrar pagamento</DropdownMenuItem>
                          )}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem className="gap-2"><Paperclip className="h-4 w-4" /> Anexar arquivo</DropdownMenuItem>
                          <DropdownMenuItem className="gap-2"><Copy className="h-4 w-4" /> Duplicar</DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem className="gap-2 text-destructive focus:text-destructive">
                            <Trash2 className="h-4 w-4" /> Excluir
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                );
              })}
              {filteredPayables.length === 0 && (
                <TableRow>
                  <TableCell colSpan={9} className="text-center py-16">
                    <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-muted flex items-center justify-center">
                      <Receipt className="h-8 w-8 text-muted-foreground" />
                    </div>
                    <h3 className="text-lg font-medium text-foreground">Nenhuma conta encontrada</h3>
                    <p className="mt-2 text-sm text-muted-foreground max-w-sm mx-auto">
                      Não há contas a pagar para os filtros selecionados.
                    </p>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-border flex items-center justify-between text-sm text-muted-foreground">
          <span>{filteredPayables.length} de {mockPayables.length} registros</span>
          <span className="font-medium tabular-nums">
            Total: {fmtCurrency(filteredPayables.reduce((s, p) => s + p.amount, 0))}
          </span>
        </div>
      </div>

      {/* Create Dialog */}
      <CreatePayableDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}

// ─── Status Badge ─────────────────────────────
function StatusBadge({ status }: { status: PayableStatus }) {
  const config: Record<PayableStatus, { label: string; className: string }> = {
    open: { label: "Aberto", className: "badge-warning" },
    partial: { label: "Parcial", className: "badge-info" },
    paid: { label: "Pago", className: "badge-success" },
    overdue: { label: "Vencido", className: "badge-destructive" },
    cancelled: { label: "Cancelado", className: "bg-muted text-muted-foreground border border-border" },
  };
  const c = config[status];
  return (
    <span className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium", c.className)}>
      {c.label}
    </span>
  );
}

// ─── Create Dialog ────────────────────────────
function CreatePayableDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] gap-0">
        <DialogHeader className="pb-4 border-b border-border">
          <DialogTitle className="text-base font-semibold flex items-center gap-2">
            <Receipt className="w-5 h-5 text-primary" />
            Nova Conta a Pagar
          </DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 py-5">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Descrição *</Label>
              <Input className="h-9 text-sm" placeholder="Ex: Filamento PLA Preto 10kg" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Fornecedor</Label>
              <Select>
                <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Selecione..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="bambu">Bambu Lab Store</SelectItem>
                  <SelectItem value="filament">Filament Express</SelectItem>
                  <SelectItem value="cemig">CEMIG</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Valor *</Label>
              <Input className="h-9 text-sm tabular-nums" placeholder="R$ 0,00" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Vencimento *</Label>
              <Input className="h-9 text-sm" type="date" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Competência</Label>
              <Input className="h-9 text-sm" type="date" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Plano de Contas</Label>
              <Select>
                <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Selecione..." /></SelectTrigger>
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
              <Label className="text-xs font-medium text-muted-foreground">Centro de Custo</Label>
              <Select>
                <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Selecione..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="prod">CC01 - Produção</SelectItem>
                  <SelectItem value="mnt">CC02 - Manutenção</SelectItem>
                  <SelectItem value="adm">CC03 - Administrativo</SelectItem>
                  <SelectItem value="exp">CC04 - Expedição</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Forma de Pagamento</Label>
              <Select>
                <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Selecione..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="pix">PIX</SelectItem>
                  <SelectItem value="boleto">Boleto</SelectItem>
                  <SelectItem value="cartao">Cartão</SelectItem>
                  <SelectItem value="debito">Débito Automático</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Nº Parcelas</Label>
              <Input className="h-9 text-sm tabular-nums" type="number" defaultValue={1} min={1} max={48} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Conta Bancária</Label>
              <Select>
                <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Selecione..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="bb">Banco do Brasil</SelectItem>
                  <SelectItem value="nubank">Nubank PJ</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">Observações</Label>
            <Textarea className="text-sm min-h-[60px] resize-none" placeholder="Notas, NF, referências..." />
          </div>

          <div className="flex items-center gap-2 p-3 rounded-lg bg-muted text-sm text-muted-foreground">
            <Paperclip className="w-4 h-4 flex-shrink-0" />
            Anexos podem ser adicionados após salvar o registro.
          </div>
        </div>

        <DialogFooter className="pt-3 border-t border-border gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button className="gap-2" onClick={() => onOpenChange(false)}>
            <Plus className="h-4 w-4" />
            Criar Conta
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
