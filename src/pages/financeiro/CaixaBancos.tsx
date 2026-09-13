import { useState, useMemo, useRef } from "react";
import { allRows, localDate, money, positiveMoney, validDate } from "@/lib/finance";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { PageHeader } from "@/components/shared/PageHeader";
import {
  Plus, Search, Loader2, Landmark, ArrowUpCircle, ArrowDownCircle,
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
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";

const fmtCurrency = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export default function CaixaBancos() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [createAccountOpen, setCreateAccountOpen] = useState(false);
  const [createTxOpen, setCreateTxOpen] = useState(false);

  // Account form
  const [accName, setAccName] = useState("");
  const [bankName, setBankName] = useState("");
  const [initialBalance, setInitialBalance] = useState("");

  // Tx form
  const [txAccountId, setTxAccountId] = useState("");
  const [txType, setTxType] = useState("credit");
  const [txAmount, setTxAmount] = useState("");
  const [txDate, setTxDate] = useState(localDate());
  const [txDescription, setTxDescription] = useState("");
  const requestRef = useRef({ payload: "", id: crypto.randomUUID() });
  const [month, setMonth] = useState(localDate().slice(0, 7));

  const { data: accounts = [], isLoading: loadingAccounts, error: accountsError } = useQuery({
    queryKey: ["bank_accounts", profile?.tenant_id],
    queryFn: async () => {
      const { data, error } = await supabase.from("bank_accounts").select("*").order("name");
      if (error) throw error;
      return data;
    },
    enabled: !!profile,
  });

  const { data: transactions = [], isLoading: loadingTx, error: txError } = useQuery({
    queryKey: ["bank_transactions", "cash", profile?.tenant_id, month],
    queryFn: async () => {
      const end = localDate(new Date(Number(month.slice(0, 4)), Number(month.slice(5)), 0, 12));
      return allRows((from, to) => supabase.from("bank_transactions").select("*, bank_accounts(name)").gte("transaction_date", `${month}-01`).lte("transaction_date", end).order("transaction_date", { ascending: false }).order("id").range(from, to));
    },
    enabled: !!profile && /^\d{4}-\d{2}$/.test(month),
  });

  const totalBalance = accounts.reduce((s, a) => s + a.current_balance, 0);

  const createAccountMut = useMutation({
    mutationFn: async () => {
      if (!profile) throw new Error("Sem perfil");
      if (!accName.trim()) throw new Error("Informe o nome da conta.");
      const bal = initialBalance ? money(initialBalance) : 0;
      const { error } = await supabase.from("bank_accounts").insert({
        tenant_id: profile.tenant_id, name: accName.trim(), bank_name: bankName.trim() || null,
        initial_balance: bal, current_balance: bal,
      });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["bank_accounts"] }); setCreateAccountOpen(false); setAccName(""); setBankName(""); setInitialBalance(""); toast({ title: "Conta criada" }); },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const createTxMut = useMutation({
    mutationFn: async () => {
      if (!profile) throw new Error("Sem perfil");
      const amt = positiveMoney(txAmount);
      if (!validDate(txDate) || txDate > localDate()) throw new Error("Informe uma data válida, até hoje.");
      if (!accounts.some(a => a.id === txAccountId && a.is_active)) throw new Error("Selecione uma conta ativa.");
      if (!txDescription.trim()) throw new Error("Informe a descrição do lançamento.");
      const payload = JSON.stringify([txAccountId, txType, amt, txDate, txDescription.trim()]);
      if (requestRef.current.payload !== payload) requestRef.current = { payload, id: crypto.randomUUID() };
      const { error } = await (supabase.rpc as any)("register_bank_transaction", {
        p_bank_account_id: txAccountId, p_type: txType, p_amount: amt, p_date: txDate,
        p_description: txDescription.trim(), p_request_id: requestRef.current.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["bank_transactions"] });
      qc.invalidateQueries({ queryKey: ["bank_accounts"] });
      setCreateTxOpen(false); setTxAccountId(""); setTxAmount(""); setTxDescription("");
      requestRef.current = { payload: "", id: crypto.randomUUID() };
      toast({ title: "Lançamento registrado" });
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <PageHeader title="Caixa e Bancos" description="Contas bancárias e fluxo de caixa"
        breadcrumbs={[{ label: "Financeiro", href: "/financeiro/dre" }, { label: "Caixa e Bancos" }]}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => setCreateAccountOpen(true)}><Plus className="h-4 w-4 mr-1" /> Nova Conta</Button>
            <Button size="sm" onClick={() => setCreateTxOpen(true)}><Plus className="h-4 w-4 mr-1" /> Lançamento</Button>
          </div>
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-4"><p className="text-sm text-muted-foreground">Baixas de títulos já movimentam o caixa. Use lançamento manual para outras entradas e saídas.</p><div><Label htmlFor="cash-month">Mês dos lançamentos</Label><Input id="cash-month" type="month" value={month} onChange={e => e.target.value && setMonth(e.target.value)} /></div></div>
      {txError && <p role="alert" className="rounded-lg border border-destructive/30 p-3 text-sm text-destructive">Não foi possível carregar os lançamentos. Os totais do período estão indisponíveis.</p>}

      {accountsError && <p role="alert" className="rounded-lg border border-destructive/30 p-4 text-sm text-destructive">Não foi possível carregar as contas. O saldo está indisponível.</p>}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="rounded-xl border bg-card p-4"><p className="text-xs text-muted-foreground">Saldo Total</p><p className={cn("text-2xl font-bold", totalBalance >= 0 ? "text-foreground" : "text-destructive")}>{loadingAccounts || accountsError ? "—" : fmtCurrency(totalBalance)}</p></div>
        <div className="rounded-xl border bg-card p-4"><p className="text-xs text-muted-foreground">Contas Ativas</p><p className="text-2xl font-bold text-foreground">{loadingAccounts || accountsError ? "—" : accounts.filter(a => a.is_active).length}</p></div>
        <div className="rounded-xl border bg-card p-4"><p className="text-xs text-muted-foreground">Lançamentos no mês selecionado</p><p className="text-2xl font-bold text-foreground">{loadingTx || txError ? "—" : transactions.length}</p></div>
      </div>

      <Tabs defaultValue="accounts">
        <TabsList><TabsTrigger value="accounts">Contas</TabsTrigger><TabsTrigger value="transactions">Lançamentos</TabsTrigger></TabsList>

        <TabsContent value="accounts" className="mt-4">
          <div className="rounded-xl border bg-card overflow-hidden">
            {loadingAccounts ? <div className="flex items-center justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div> : accounts.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground"><Landmark className="h-10 w-10 mb-3 opacity-40" /><p className="font-medium">Nenhuma conta cadastrada</p></div>
            ) : (
              <Table><TableHeader><TableRow><TableHead>Conta</TableHead><TableHead>Banco</TableHead><TableHead className="text-right">Saldo Inicial</TableHead><TableHead className="text-right">Saldo Atual</TableHead></TableRow></TableHeader>
                <TableBody>{accounts.map(a => (
                  <TableRow key={a.id}>
                    <TableCell className="font-medium text-sm">{a.name}</TableCell>
                    <TableCell className="text-sm">{a.bank_name || "—"}</TableCell>
                    <TableCell className="text-right font-mono text-sm">{fmtCurrency(a.initial_balance)}</TableCell>
                    <TableCell className={cn("text-right font-mono text-sm font-semibold", a.current_balance >= 0 ? "text-foreground" : "text-destructive")}>{fmtCurrency(a.current_balance)}</TableCell>
                  </TableRow>
                ))}</TableBody>
              </Table>
            )}
          </div>
        </TabsContent>

        <TabsContent value="transactions" className="mt-4">
          <div className="rounded-xl border bg-card overflow-hidden">
            {loadingTx ? <div className="flex items-center justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div> : transactions.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground"><Landmark className="h-10 w-10 mb-3 opacity-40" /><p className="font-medium">Nenhum lançamento</p></div>
            ) : (
              <Table><TableHeader><TableRow><TableHead>Data</TableHead><TableHead>Tipo</TableHead><TableHead>Conta</TableHead><TableHead>Descrição</TableHead><TableHead className="text-right">Valor</TableHead></TableRow></TableHeader>
                <TableBody>{transactions.map((t: any) => (
                  <TableRow key={t.id}>
                    <TableCell className="text-sm">{new Date(t.transaction_date + "T00:00:00").toLocaleDateString("pt-BR")}</TableCell>
                    <TableCell>
                      <span className={cn("inline-flex items-center gap-1 text-xs font-medium", t.type === "credit" ? "text-emerald-600" : "text-destructive")}>
                        {t.type === "credit" ? <ArrowUpCircle className="h-3.5 w-3.5" /> : <ArrowDownCircle className="h-3.5 w-3.5" />}
                        {t.type === "credit" ? "Entrada" : "Saída"}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm">{t.bank_accounts?.name || "—"}</TableCell>
                    <TableCell className="text-sm">{t.description || "—"}</TableCell>
                    <TableCell className={cn("text-right font-mono text-sm", t.type === "credit" ? "text-emerald-600" : "text-destructive")}>{t.type === "debit" ? "-" : ""}{fmtCurrency(t.amount)}</TableCell>
                  </TableRow>
                ))}</TableBody>
              </Table>
            )}
          </div>
        </TabsContent>
      </Tabs>

      {/* New Account */}
      <Dialog open={createAccountOpen} onOpenChange={setCreateAccountOpen}>
        <DialogContent className="max-w-sm max-h-[90dvh] overflow-y-auto"><DialogHeader><DialogTitle>Nova Conta</DialogTitle></DialogHeader>
          <div className="grid gap-4">
            <div><Label>Nome *</Label><Input value={accName} onChange={(e) => setAccName(e.target.value)} placeholder="Conta Corrente" /></div>
            <div><Label>Banco</Label><Input value={bankName} onChange={(e) => setBankName(e.target.value)} placeholder="Nubank" /></div>
            <div><Label>Saldo Inicial (R$)</Label><Input type="number" step="0.01" value={initialBalance} onChange={(e) => setInitialBalance(e.target.value)} placeholder="0.00" /></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setCreateAccountOpen(false)}>Cancelar</Button><Button onClick={() => createAccountMut.mutate()} disabled={!accName || createAccountMut.isPending}>{createAccountMut.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Criar</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* New Transaction */}
      <Dialog open={createTxOpen} onOpenChange={v => !createTxMut.isPending && setCreateTxOpen(v)}>
        <DialogContent className="max-w-sm max-h-[90dvh] overflow-y-auto"><DialogHeader><DialogTitle>Novo Lançamento</DialogTitle></DialogHeader>
          <div className="grid gap-4">
            <div><Label>Conta *</Label>
              <Select value={txAccountId} onValueChange={setTxAccountId}><SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>{accounts.filter(a => a.is_active).map(a => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Tipo</Label>
              <Select value={txType} onValueChange={setTxType}><SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="credit">Entrada</SelectItem><SelectItem value="debit">Saída</SelectItem></SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Valor *</Label><Input type="number" step="0.01" value={txAmount} onChange={(e) => setTxAmount(e.target.value)} placeholder="100.00" /></div>
              <div><Label>Data *</Label><Input type="date" max={localDate()} value={txDate} onChange={(e) => setTxDate(e.target.value)} /></div>
            </div>
            <div><Label>Descrição *</Label><Input value={txDescription} onChange={(e) => setTxDescription(e.target.value)} placeholder="Identifique a origem do lançamento" /></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setCreateTxOpen(false)}>Cancelar</Button><Button onClick={() => createTxMut.mutate()} disabled={!txAccountId || !txAmount || !txDate || !txDescription.trim() || createTxMut.isPending}>{createTxMut.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Registrar</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
