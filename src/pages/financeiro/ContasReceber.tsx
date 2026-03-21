import { useState, useMemo, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { PageHeader } from "@/components/shared/PageHeader";
import {
  Plus, Search, MoreHorizontal, Loader2, DollarSign, CheckCircle2, AlertTriangle, Clock, Trash2, Edit,
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
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import type { Tables, Enums } from "@/integrations/supabase/types";

type ARRow = Tables<"accounts_receivable">;
type ARStatus = Enums<"receivable_status">;

const fmtCurrency = (v: number | null) => v != null ? v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "—";

const statusConfig: Record<ARStatus, { label: string; color: string }> = {
  open: { label: "Aberto", color: "bg-primary/10 text-primary" },
  partial: { label: "Parcial", color: "bg-amber-100 text-amber-700" },
  received: { label: "Recebido", color: "bg-emerald-100 text-emerald-700" },
  overdue: { label: "Vencido", color: "bg-destructive/10 text-destructive" },
  reversed: { label: "Estornado", color: "bg-muted text-muted-foreground" },
};

export default function ContasReceber() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [searchParams] = useSearchParams();

  const [search, setSearch] = useState(searchParams.get("pedido") || "");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [createOpen, setCreateOpen] = useState(false);

  const [description, setDescription] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [amount, setAmount] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [notes, setNotes] = useState("");

  const { data: receivables = [], isLoading } = useQuery({
    queryKey: ["accounts_receivable"],
    queryFn: async () => {
      const { data, error } = await supabase.from("accounts_receivable").select("*, customers(name)").order("due_date");
      if (error) throw error;
      return data;
    },
    enabled: !!profile,
  });

  const { data: customers = [] } = useQuery({
    queryKey: ["customers"],
    queryFn: async () => {
      const { data, error } = await supabase.from("customers").select("id, name").eq("is_active", true).order("name");
      if (error) throw error;
      return data;
    },
    enabled: !!profile,
  });

  const filtered = useMemo(() => {
    let list = receivables;
    if (statusFilter !== "all") list = list.filter((r: any) => r.status === statusFilter);
    if (search) {
      const s = search.toLowerCase();
      list = list.filter((r: any) => r.description.toLowerCase().includes(s) || r.customers?.name?.toLowerCase().includes(s));
    }
    return list;
  }, [receivables, statusFilter, search]);

  const totalOpen = receivables.filter((r: any) => ["open", "partial"].includes(r.status)).reduce((s: number, r: any) => s + r.amount - r.amount_received, 0);
  const totalOverdue = receivables.filter((r: any) => r.status === "overdue").reduce((s: number, r: any) => s + r.amount - r.amount_received, 0);
  const totalReceived = receivables.filter((r: any) => r.status === "received").reduce((s: number, r: any) => s + r.amount_received, 0);

  const createMut = useMutation({
    mutationFn: async () => {
      if (!profile) throw new Error("Sem perfil");
      const { error } = await supabase.from("accounts_receivable").insert({
        tenant_id: profile.tenant_id, description, customer_id: customerId || null,
        amount: parseFloat(amount), due_date: dueDate, notes: notes || null, created_by: profile.user_id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["accounts_receivable"] }); setCreateOpen(false);
      setDescription(""); setCustomerId(""); setAmount(""); setDueDate(""); setNotes("");
      toast({ title: "Título criado" });
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const markReceivedMut = useMutation({
    mutationFn: async (id: string) => {
      const item = receivables.find((r: any) => r.id === id);
      if (!item) return;
      const { error } = await supabase.from("accounts_receivable").update({
        status: "received" as ARStatus, amount_received: item.amount, receipt_date: new Date().toISOString().slice(0, 10),
      }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["accounts_receivable"] }); toast({ title: "Recebimento registrado" }); },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("accounts_receivable").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["accounts_receivable"] }); toast({ title: "Título removido" }); },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <PageHeader title="Contas a Receber" description="Gestão de recebíveis"
        breadcrumbs={[{ label: "Financeiro", href: "/financeiro/dre" }, { label: "Contas a Receber" }]}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" asChild>
              <a href="/financeiro/dre">Ver DRE</a>
            </Button>
            <Button size="sm" onClick={() => setCreateOpen(true)}><Plus className="h-4 w-4 mr-1" /> Novo Título</Button>
          </div>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="rounded-xl border bg-card p-4"><p className="text-xs text-muted-foreground">A Receber</p><p className="text-2xl font-bold text-foreground">{fmtCurrency(totalOpen)}</p></div>
        <div className="rounded-xl border bg-card p-4"><p className="text-xs text-muted-foreground">Vencido</p><p className={cn("text-2xl font-bold", totalOverdue > 0 ? "text-destructive" : "text-foreground")}>{fmtCurrency(totalOverdue)}</p></div>
        <div className="rounded-xl border bg-card p-4"><p className="text-xs text-muted-foreground">Recebido (total)</p><p className="text-2xl font-bold text-foreground">{fmtCurrency(totalReceived)}</p></div>
      </div>

      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm"><Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" /><Input className="pl-9" placeholder="Buscar…" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
        <Select value={statusFilter} onValueChange={setStatusFilter}><SelectTrigger className="w-[160px]"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent><SelectItem value="all">Todos</SelectItem>{Object.entries(statusConfig).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}</SelectContent>
        </Select>
      </div>

      <div className="rounded-xl border bg-card overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground"><DollarSign className="h-10 w-10 mb-3 opacity-40" /><p className="font-medium">Nenhum título encontrado</p></div>
        ) : (
          <Table><TableHeader><TableRow>
            <TableHead>Descrição</TableHead><TableHead>Cliente</TableHead><TableHead>Vencimento</TableHead><TableHead>Status</TableHead>
            <TableHead className="text-right">Valor</TableHead><TableHead className="text-right">Recebido</TableHead><TableHead className="w-10" />
          </TableRow></TableHeader>
            <TableBody>{filtered.map((r: any) => {
              const cfg = statusConfig[r.status as ARStatus] || statusConfig.open;
              return (
                 <TableRow key={r.id}>
                   <TableCell>
                     <div>
                       <span className="text-sm font-medium">{r.description}</span>
                       {r.origin_type === "order" && r.origin_id && (
                         <a href={`/comercial/pedidos`} className="block text-[11px] text-primary hover:underline">
                           📦 Ver pedido
                         </a>
                       )}
                     </div>
                   </TableCell>
                  <TableCell className="text-sm">{r.customers?.name || "—"}</TableCell>
                  <TableCell className="text-sm">{new Date(r.due_date + "T00:00:00").toLocaleDateString("pt-BR")}</TableCell>
                  <TableCell><span className={cn("inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-semibold", cfg.color)}>{cfg.label}</span></TableCell>
                  <TableCell className="text-right font-mono text-sm">{fmtCurrency(r.amount)}</TableCell>
                  <TableCell className="text-right font-mono text-sm">{fmtCurrency(r.amount_received)}</TableCell>
                  <TableCell>
                    <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-7 w-7"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {r.status !== "received" && <DropdownMenuItem onClick={() => markReceivedMut.mutate(r.id)}><CheckCircle2 className="h-3.5 w-3.5 mr-2" /> Receber Total</DropdownMenuItem>}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem className="text-destructive" onClick={() => deleteMut.mutate(r.id)}><Trash2 className="h-3.5 w-3.5 mr-2" /> Excluir</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              );
            })}</TableBody>
          </Table>
        )}
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-md"><DialogHeader><DialogTitle>Novo Título a Receber</DialogTitle></DialogHeader>
          <div className="grid gap-4">
            <div><Label>Descrição *</Label><Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Pedido #123" /></div>
            <div><Label>Cliente</Label>
              <Select value={customerId || "none"} onValueChange={(v) => setCustomerId(v === "none" ? "" : v)}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent><SelectItem value="none">Sem cliente</SelectItem>{customers.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Valor *</Label><Input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="150.00" /></div>
              <div><Label>Vencimento *</Label><Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></div>
            </div>
            <div><Label>Observações</Label><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} /></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setCreateOpen(false)}>Cancelar</Button><Button onClick={() => createMut.mutate()} disabled={!description || !amount || !dueDate || createMut.isPending}>{createMut.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Criar</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
