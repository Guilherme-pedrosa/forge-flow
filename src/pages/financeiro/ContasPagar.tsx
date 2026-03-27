import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { PageHeader } from "@/components/shared/PageHeader";
import {
  Plus, Search, MoreHorizontal, Loader2, DollarSign, AlertTriangle,
  CheckCircle2, Clock, Trash2, Edit, Receipt, Calendar, Download, BookOpen,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import type { Enums } from "@/integrations/supabase/types";

type PayableStatus = Enums<"payable_status">;
type StatusFilter = PayableStatus | "all";

const fmtCurrency = (v: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);

const fmtDate = (d: string) => {
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y}`;
};

const statusConfig: Record<PayableStatus, { label: string; className: string }> = {
  open: { label: "Aberto", className: "bg-primary/10 text-primary" },
  partial: { label: "Parcial", className: "bg-amber-100 text-amber-700" },
  paid: { label: "Pago", className: "bg-emerald-100 text-emerald-700" },
  overdue: { label: "Vencido", className: "bg-destructive/10 text-destructive" },
  cancelled: { label: "Cancelado", className: "bg-muted text-muted-foreground" },
};

export default function ContasPagar() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [createOpen, setCreateOpen] = useState(false);

  // Form state
  const [description, setDescription] = useState("");
  const [vendorId, setVendorId] = useState("");
  const [amount, setAmount] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [competenceDate, setCompetenceDate] = useState("");
  const [accountId, setAccountId] = useState("");
  const [costCenterId, setCostCenterId] = useState("");
  const [paymentMethodId, setPaymentMethodId] = useState("");
  const [notes, setNotes] = useState("");

  // ─── Queries ──────────────────────────────────
  const { data: payables = [], isLoading } = useQuery({
    queryKey: ["accounts_payable"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("accounts_payable")
        .select("*, vendors(name), chart_of_accounts(code, name), cost_centers(code, name), payment_methods(name)")
        .order("due_date");
      if (error) throw error;
      return data;
    },
    enabled: !!profile,
  });

  const { data: vendors = [] } = useQuery({
    queryKey: ["vendors"],
    queryFn: async () => {
      const { data } = await supabase.from("vendors").select("id, name").eq("is_active", true).order("name");
      return data ?? [];
    },
    enabled: !!profile,
  });

  const { data: accounts = [] } = useQuery({
    queryKey: ["chart_of_accounts"],
    queryFn: async () => {
      const { data } = await supabase.from("chart_of_accounts").select("id, code, name").eq("is_active", true).eq("account_type", "expense").order("code");
      return data ?? [];
    },
    enabled: !!profile,
  });

  const { data: costCenters = [] } = useQuery({
    queryKey: ["cost_centers"],
    queryFn: async () => {
      const { data } = await supabase.from("cost_centers").select("id, code, name").eq("is_active", true).order("code");
      return data ?? [];
    },
    enabled: !!profile,
  });

  const { data: paymentMethods = [] } = useQuery({
    queryKey: ["payment_methods"],
    queryFn: async () => {
      const { data } = await supabase.from("payment_methods").select("id, name").eq("is_active", true).order("name");
      return data ?? [];
    },
    enabled: !!profile,
  });

  // ─── Computed ─────────────────────────────────
  const { counts, filteredPayables } = useMemo(() => {
    const today = new Date().toISOString().split("T")[0];
    const calc: Record<string, { count: number; amount: number }> = {
      all: { count: 0, amount: 0 },
      overdue: { count: 0, amount: 0 },
      open: { count: 0, amount: 0 },
      paid: { count: 0, amount: 0 },
    };

    payables.forEach((p: any) => {
      calc.all.count++;
      calc.all.amount += p.amount;
      if (p.status === "paid") { calc.paid.count++; calc.paid.amount += p.amount_paid; }
      else if (p.status === "overdue" || (p.due_date < today && !["paid", "cancelled"].includes(p.status))) {
        calc.overdue.count++; calc.overdue.amount += p.amount - p.amount_paid;
      } else { calc.open.count++; calc.open.amount += p.amount - p.amount_paid; }
    });

    let filtered = [...payables];
    if (statusFilter !== "all") {
      filtered = filtered.filter((p: any) => {
        if (statusFilter === "paid") return p.status === "paid";
        if (statusFilter === "overdue") return p.status === "overdue" || (p.due_date < today && !["paid", "cancelled"].includes(p.status));
        if (statusFilter === "open") return ["open", "partial"].includes(p.status);
        return p.status === statusFilter;
      });
    }
    if (search) {
      const q = search.toLowerCase();
      filtered = filtered.filter((p: any) =>
        p.description.toLowerCase().includes(q) || p.vendors?.name?.toLowerCase().includes(q)
      );
    }
    return { counts: calc, filteredPayables: filtered };
  }, [payables, search, statusFilter]);

  // ─── Mutations ────────────────────────────────
  const resetForm = () => {
    setDescription(""); setVendorId(""); setAmount(""); setDueDate("");
    setCompetenceDate(""); setAccountId(""); setCostCenterId("");
    setPaymentMethodId(""); setNotes("");
  };

  const createMut = useMutation({
    mutationFn: async () => {
      if (!profile) throw new Error("Sem perfil");
      const { error } = await supabase.from("accounts_payable").insert({
        tenant_id: profile.tenant_id,
        description,
        vendor_id: vendorId || null,
        amount: parseFloat(amount),
        due_date: dueDate,
        competence_date: competenceDate || null,
        account_id: accountId || null,
        cost_center_id: costCenterId || null,
        payment_method_id: paymentMethodId || null,
        notes: notes || null,
        created_by: profile.user_id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["accounts_payable"] });
      setCreateOpen(false); resetForm();
      toast({ title: "Conta criada" });
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const payMut = useMutation({
    mutationFn: async (id: string) => {
      const item = payables.find((p: any) => p.id === id);
      if (!item) return;
      const { error } = await supabase.from("accounts_payable").update({
        status: "paid" as PayableStatus,
        amount_paid: item.amount,
        payment_date: new Date().toISOString().slice(0, 10),
      }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["accounts_payable"] }); toast({ title: "Pagamento registrado" }); },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("accounts_payable").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["accounts_payable"] }); toast({ title: "Conta removida" }); },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const toggleSelect = (id: string) => {
    const s = new Set(selectedIds);
    s.has(id) ? s.delete(id) : s.add(id);
    setSelectedIds(s);
  };

  const statusCards: { key: StatusFilter; label: string; count: number; amount: number; countColor: string }[] = [
    { key: "overdue", label: "Vencidos", count: counts.overdue.count, amount: counts.overdue.amount, countColor: "text-destructive" },
    { key: "open", label: "A Vencer", count: counts.open.count, amount: counts.open.amount, countColor: "text-primary" },
    { key: "paid", label: "Pagos", count: counts.paid.count, amount: counts.paid.amount, countColor: "text-emerald-600" },
    { key: "all", label: "Total", count: counts.all.count, amount: counts.all.amount, countColor: "text-foreground" },
  ];

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <PageHeader
        title="Contas a Pagar"
        description="Gerencie lançamentos, vencimentos e pagamentos"
        breadcrumbs={[{ label: "Financeiro", href: "/financeiro/dre" }, { label: "Contas a Pagar" }]}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="gap-2 text-xs" asChild>
              <a href="/financeiro/dre"><BookOpen className="h-3.5 w-3.5" /> Ver DRE</a>
            </Button>
            <Button size="sm" className="gap-2 text-xs" onClick={() => setCreateOpen(true)}>
              <Plus className="h-3.5 w-3.5" /> Nova Conta
            </Button>
          </div>
        }
      />

      {/* Status Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {statusCards.map((card) => {
          const isActive = statusFilter === card.key;
          return (
            <button key={card.key} onClick={() => setStatusFilter(card.key)}
              className={cn("rounded-xl border bg-card p-4 text-left transition-all", isActive && "ring-2 ring-primary/50")}
            >
              <span className={cn("text-2xl font-bold", card.countColor)}>{card.count}</span>
              <p className="text-xs text-muted-foreground mt-1">{fmtCurrency(card.amount)}</p>
              <p className="text-xs text-muted-foreground">{card.label}</p>
            </button>
          );
        })}
      </div>

      {/* Search */}
      <div className="relative w-full sm:max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input placeholder="Buscar por descrição ou fornecedor..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
      </div>

      {/* Bulk */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 p-3 rounded-lg border bg-card">
          <span className="text-sm font-medium text-primary">{selectedIds.size} selecionado(s)</span>
          <Button size="sm" variant="outline" className="text-xs gap-1.5 ml-auto" onClick={() => {
            selectedIds.forEach((id) => payMut.mutate(id));
            setSelectedIds(new Set());
          }}>
            <DollarSign className="h-3.5 w-3.5" /> Pagar selecionados
          </Button>
          <Button size="sm" variant="ghost" className="text-xs" onClick={() => setSelectedIds(new Set())}>Limpar</Button>
        </div>
      )}

      {/* Table */}
      <div className="rounded-xl border bg-card overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : filteredPayables.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <Receipt className="h-10 w-10 mb-3 opacity-40" /><p className="font-medium">Nenhuma conta encontrada</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
          <Table>
            <TableHeader><TableRow>
              <TableHead className="w-10"><Checkbox /></TableHead>
              <TableHead>Descrição</TableHead>
              <TableHead>Fornecedor</TableHead>
              <TableHead>Vencimento</TableHead>
              <TableHead className="text-right">Valor</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-10" />
            </TableRow></TableHeader>
            <TableBody>
              {filteredPayables.map((p: any) => {
                const cfg = statusConfig[p.status as PayableStatus] || statusConfig.open;
                return (
                  <TableRow key={p.id} className={cn(selectedIds.has(p.id) && "bg-primary/5")}>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <Checkbox checked={selectedIds.has(p.id)} onCheckedChange={() => toggleSelect(p.id)} disabled={p.status === "paid"} />
                    </TableCell>
                    <TableCell>
                      <p className="font-medium text-sm">{p.description}</p>
                      {p.chart_of_accounts && <p className="text-[11px] text-muted-foreground">{p.chart_of_accounts.code} - {p.chart_of_accounts.name}</p>}
                    </TableCell>
                    <TableCell className="text-sm">{p.vendors?.name || "—"}</TableCell>
                    <TableCell className={cn("text-sm tabular-nums", p.status === "overdue" && "text-destructive font-medium")}>{fmtDate(p.due_date)}</TableCell>
                    <TableCell className="text-right">
                      <span className="font-semibold tabular-nums text-sm">{fmtCurrency(p.amount)}</span>
                      {p.amount_paid > 0 && p.amount_paid < p.amount && (
                        <p className="text-[11px] text-emerald-600">Pago: {fmtCurrency(p.amount_paid)}</p>
                      )}
                    </TableCell>
                    <TableCell>
                      <span className={cn("inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-semibold", cfg.className)}>{cfg.label}</span>
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-7 w-7"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {p.status !== "paid" && <DropdownMenuItem onClick={() => payMut.mutate(p.id)}><DollarSign className="h-3.5 w-3.5 mr-2" /> Pagar Total</DropdownMenuItem>}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem className="text-destructive" onClick={() => deleteMut.mutate(p.id)}><Trash2 className="h-3.5 w-3.5 mr-2" /> Excluir</DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          </div>
        )}
        <div className="px-6 py-3 border-t flex justify-between text-sm text-muted-foreground">
          <span>{filteredPayables.length} registros</span>
          <span className="font-medium tabular-nums">Total: {fmtCurrency(filteredPayables.reduce((s: number, p: any) => s + p.amount, 0))}</span>
        </div>
      </div>

      {/* Create Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-[550px] w-[95vw]">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Receipt className="h-5 w-5 text-primary" /> Nova Conta a Pagar</DialogTitle></DialogHeader>
          <div className="grid gap-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div><Label className="text-xs">Descrição *</Label><Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Filamento PLA" /></div>
              <div><Label className="text-xs">Fornecedor</Label>
                <Select value={vendorId || "none"} onValueChange={(v) => setVendorId(v === "none" ? "" : v)}>
                  <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent><SelectItem value="none">Nenhum</SelectItem>{vendors.map((v) => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div><Label className="text-xs">Valor *</Label><Input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
              <div><Label className="text-xs">Vencimento *</Label><Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></div>
              <div><Label className="text-xs">Competência</Label><Input type="date" value={competenceDate} onChange={(e) => setCompetenceDate(e.target.value)} /></div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div><Label className="text-xs">Plano de Contas</Label>
                <Select value={accountId || "none"} onValueChange={(v) => setAccountId(v === "none" ? "" : v)}>
                  <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent><SelectItem value="none">Nenhum</SelectItem>{accounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.code} - {a.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label className="text-xs">Centro de Custo</Label>
                <Select value={costCenterId || "none"} onValueChange={(v) => setCostCenterId(v === "none" ? "" : v)}>
                  <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent><SelectItem value="none">Nenhum</SelectItem>{costCenters.map((c) => <SelectItem key={c.id} value={c.id}>{c.code} - {c.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div><Label className="text-xs">Forma de Pagamento</Label>
              <Select value={paymentMethodId || "none"} onValueChange={(v) => setPaymentMethodId(v === "none" ? "" : v)}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent><SelectItem value="none">Nenhum</SelectItem>{paymentMethods.map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label className="text-xs">Observações</Label><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancelar</Button>
            <Button onClick={() => createMut.mutate()} disabled={!description || !amount || !dueDate || createMut.isPending}>
              {createMut.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Criar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
