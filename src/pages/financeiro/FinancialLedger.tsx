import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Search, ArrowDownLeft, ArrowUpRight, Loader2, Receipt, Ban, History, Pencil } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { allRows, currency, displayDate, effectiveStatus, isCancelled, localDate, outstandingAmount, positiveMoney, settledAmount, validDate, validateSettlement } from "@/lib/finance";

const statusLabels = { all: "Todos", open: "A vencer", partial: "Parcial", overdue: "Vencido", settled: "Liquidado", cancelled: "Cancelado" };
const statusColors = { open: "bg-primary/10 text-primary", partial: "bg-amber-100 text-amber-800", overdue: "bg-destructive/10 text-destructive", settled: "bg-emerald-100 text-emerald-800", cancelled: "bg-muted text-muted-foreground" };
const newForm = () => ({ description: "", contact: "", amount: "", due_date: localDate(), competence_date: localDate(), account_id: "", cost_center_id: "", payment_method_id: "", notes: "" });

export default function FinancialLedger({ kind }: { kind: "payable" | "receivable" }) {
  const payable = kind === "payable";
  const table = payable ? "accounts_payable" : "accounts_receivable";
  const { profile } = useAuth();
  const tenant = profile?.tenant_id;
  const { toast } = useToast();
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const [search, setSearch] = useState(params.get("pedido") || "");
  const [filter, setFilter] = useState("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [editTitle, setEditTitle] = useState<any>(null);
  const classificationOnly = payable && editTitle?.origin_type === "purchase_order";
  const [form, setForm] = useState(newForm);
  const [settlement, setSettlement] = useState<{ title: any; amount: string; date: string; account: string; requestId: string } | null>(null);
  const [cancelTitle, setCancelTitle] = useState<any>(null);
  const [historyTitle, setHistoryTitle] = useState<any>(null);
  const set = (key: keyof ReturnType<typeof newForm>, value: string) => setForm(f => ({ ...f, [key]: value }));
  const fail = (error: any) => toast({ title: "Não foi possível concluir", description: error.message, variant: "destructive" });
  const refresh = () => { for (const key of [table, "bank_accounts", "bank_transactions", "financial_history", "dre_ar", "dre_ap", "dashboard"]) qc.invalidateQueries({ queryKey: [key] }); };

  const { data: titles = [], isLoading, error, refetch } = useQuery({
    queryKey: [table, tenant], enabled: !!tenant,
    queryFn: () => allRows<any>((from, to) => supabase.from(table).select(payable ? "*, vendors(name)" : "*, customers(name)").order("due_date").order("id").range(from, to) as any),
  });
  const { data: options, error: optionsError } = useQuery({
    queryKey: ["financial_options", tenant, kind], enabled: !!tenant,
    queryFn: async () => {
      const queries = await Promise.all([
        supabase.from(payable ? "vendors" : "customers").select("id,name").eq("is_active", true).order("name"),
        supabase.from("chart_of_accounts").select("id,code,name").eq("is_active", true).in("account_type", payable ? ["expense", "asset", "liability", "equity"] : ["revenue"]).order("code"),
        supabase.from("cost_centers").select("id,code,name").eq("is_active", true).order("code"),
        supabase.from("payment_methods").select("id,name").eq("is_active", true).order("name"),
        supabase.from("bank_accounts").select("id,name").eq("is_active", true).order("name"),
      ]);
      for (const q of queries) if (q.error) throw q.error;
      return { contacts: queries[0].data, accounts: queries[1].data, centers: queries[2].data, methods: queries[3].data, banks: queries[4].data };
    },
  });
  const { data: history = [], isLoading: historyLoading, error: historyError } = useQuery({
    queryKey: ["financial_history", tenant, historyTitle?.id], enabled: !!historyTitle && !!tenant,
    queryFn: () => allRows<any>((from, to) => supabase.from("bank_transactions").select("*,bank_accounts(name)").eq("reference_type", table).eq("reference_id", historyTitle.id).order("transaction_date", { ascending: false }).order("id").range(from, to)),
  });
  const filtered = titles.filter(t => {
    const status = effectiveStatus(t);
    const matchesFilter = filter === "all" || (filter === "open" ? ["open", "partial"].includes(status) : status === filter);
    return matchesFilter && `${t.description} ${t.vendors?.name ?? t.customers?.name ?? ""}`.toLocaleLowerCase("pt-BR").includes(search.toLocaleLowerCase("pt-BR"));
  });
  const active = titles.filter(t => !isCancelled(t));
  const outstanding = active.reduce((s, t) => s + outstandingAmount(t), 0);
  const overdue = active.filter(t => effectiveStatus(t) === "overdue").reduce((s, t) => s + outstandingAmount(t), 0);
  const settled = active.reduce((s, t) => s + settledAmount(t), 0);

  const create = useMutation({
    mutationFn: async () => {
      if (!profile) throw new Error("Sessão indisponível. Entre novamente.");
      if (!form.description.trim()) throw new Error("Informe a descrição.");
      if (!validDate(form.due_date) || !validDate(form.competence_date)) throw new Error("Informe vencimento e competência válidos.");
      const values = { tenant_id: tenant, created_by: profile.user_id, description: form.description.trim(),
        amount: positiveMoney(form.amount), due_date: form.due_date,
        competence_date: form.competence_date, account_id: form.account_id || null, cost_center_id: form.cost_center_id || null,
        payment_method_id: form.payment_method_id || null, notes: form.notes.trim() || null };
      if (classificationOnly) {
        const { data, error } = await supabase.from("accounts_payable").update({
          account_id: form.account_id || null, cost_center_id: form.cost_center_id || null,
          competence_date: form.competence_date, notes: form.notes.trim() || null,
        }).eq("id", editTitle.id).eq("updated_at", editTitle.updated_at).select("id");
        if (error) throw error;
        if (!data?.length) throw new Error("O título mudou. Reabra a classificação antes de salvar.");
      } else if (editTitle) {
        if (settledAmount(editTitle) > 0 || editTitle.origin_id) throw new Error("Este título deve ser alterado na sua operação de origem.");
        const { tenant_id, created_by, ...editableValues } = values;
        const { data, error } = payable
          ? await supabase.from("accounts_payable").update({ ...editableValues, vendor_id: form.contact || null }).eq("id", editTitle.id).eq("updated_at", editTitle.updated_at).eq("amount_paid", 0).select("id")
          : await supabase.from("accounts_receivable").update({ ...editableValues, customer_id: form.contact || null }).eq("id", editTitle.id).eq("updated_at", editTitle.updated_at).eq("amount_received", 0).select("id");
        if (error) throw error;
        if (!data?.length) throw new Error("O título mudou. Reabra-o antes de editar.");
      } else {
        const { error } = payable
          ? await supabase.from("accounts_payable").insert({ ...values, vendor_id: form.contact || null })
          : await supabase.from("accounts_receivable").insert({ ...values, customer_id: form.contact || null });
        if (error) throw error;
      }
    },
    onSuccess: () => { refresh(); setCreateOpen(false); setForm(newForm()); setEditTitle(null); toast({ title: classificationOnly ? "Classificação atualizada" : editTitle ? "Título atualizado" : "Título criado" }); }, onError: fail,
  });
  const settle = useMutation({
    mutationFn: async () => {
      if (!settlement) throw new Error("Selecione um título.");
      const amount = validateSettlement(settlement.title, settlement.amount, settlement.date);
      if (!settlement.account) throw new Error("Selecione a conta bancária da baixa.");
      const { error } = await (supabase.rpc as any)("settle_financial_title", { p_kind: kind, p_title_id: settlement.title.id, p_amount: amount,
        p_date: settlement.date, p_bank_account_id: settlement.account, p_request_id: settlement.requestId });
      if (error) throw error;
    },
    onSuccess: () => { refresh(); setSettlement(null); toast({ title: payable ? "Pagamento registrado" : "Recebimento registrado", description: "Saldo do título e conta bancária atualizados." }); }, onError: fail,
  });
  const cancel = useMutation({
    mutationFn: async () => {
      if (!cancelTitle || settledAmount(cancelTitle) > 0) throw new Error("Títulos com baixas não podem ser cancelados por esta ação.");
      const { data, error } = payable
        ? await supabase.from("accounts_payable").update({ status: "cancelled" }).eq("id", cancelTitle.id).eq("amount_paid", 0).in("status", ["open", "partial", "overdue"]).select("id")
        : await supabase.from("accounts_receivable").update({ status: "reversed" }).eq("id", cancelTitle.id).eq("amount_received", 0).in("status", ["open", "partial", "overdue"]).select("id");
      if (error) throw error;
      if (!data?.length) throw new Error("O título mudou. Atualize a lista antes de tentar novamente.");
    },
    onSuccess: () => { refresh(); setCancelTitle(null); toast({ title: "Título cancelado", description: "O registro foi preservado no histórico." }); }, onError: fail,
  });
  const beginSettlement = (title: any) => setSettlement({ title, amount: outstandingAmount(title).toFixed(2), date: localDate(), account: title.bank_account_id || "", requestId: crypto.randomUUID() });
  const beginEdit = (title: any) => {
    setEditTitle(title);
    setForm({ description: title.description, contact: title.vendor_id || title.customer_id || "", amount: String(title.amount), due_date: title.due_date, competence_date: title.competence_date || title.created_at.slice(0, 10), account_id: title.account_id || "", cost_center_id: title.cost_center_id || "", payment_method_id: title.payment_method_id || "", notes: title.notes || "" });
    setCreateOpen(true);
  };
  const actions = (title: any) => <div className="flex flex-wrap gap-1.5">
    {!isCancelled(title) && outstandingAmount(title) > 0 && <Button size="sm" onClick={() => beginSettlement(title)}>{payable ? <ArrowUpRight className="mr-1 h-4 w-4" /> : <ArrowDownLeft className="mr-1 h-4 w-4" />}{payable ? "Pagar" : "Receber"}</Button>}
    {settledAmount(title) > 0 && <Button aria-label={`Histórico de ${title.description}`} size="icon" variant="outline" onClick={() => setHistoryTitle(title)}><History className="h-4 w-4" /></Button>}
    {payable && title.origin_type === "purchase_order" && !isCancelled(title) && <Button size="sm" variant="outline" onClick={() => beginEdit(title)}><Pencil className="mr-1 h-4 w-4" />Classificar</Button>}
    {!isCancelled(title) && settledAmount(title) === 0 && !title.origin_id && <Button aria-label={`Editar ${title.description}`} size="icon" variant="outline" onClick={() => beginEdit(title)}><Pencil className="h-4 w-4" /></Button>}
    {!isCancelled(title) && settledAmount(title) === 0 && !title.origin_id && <Button aria-label={`Cancelar ${title.description}`} size="icon" variant="ghost" onClick={() => setCancelTitle(title)}><Ban className="h-4 w-4" /></Button>}
  </div>;
  const selectField = (label: string, key: keyof ReturnType<typeof newForm>, list: any[] = []) => <div className="space-y-1.5"><Label>{label}</Label><Select disabled={classificationOnly && ["contact", "payment_method_id"].includes(key)} value={form[key] || "none"} onValueChange={v => set(key, v === "none" ? "" : v)}><SelectTrigger aria-label={label}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">Não informado</SelectItem>{list.map(o => <SelectItem key={o.id} value={o.id}>{o.code ? `${o.code} · ` : ""}{o.name}</SelectItem>)}</SelectContent></Select></div>;

  return <div className="space-y-6">
    <PageHeader title={payable ? "Contas a pagar" : "Contas a receber"} description={payable ? "Compromissos, vencimentos e pagamentos em um só lugar." : "Acompanhe os valores em aberto e cada recebimento."}
      breadcrumbs={[{ label: "Financeiro", href: "/financeiro/dre" }, { label: payable ? "A pagar" : "A receber" }]}
      actions={<Button onClick={() => { setEditTitle(null); setForm(newForm()); setCreateOpen(true); }}><Plus className="mr-2 h-4 w-4" />Novo título</Button>} />
    {error ? <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-4">Não foi possível carregar os títulos. <Button variant="outline" onClick={() => refetch()}>Tentar novamente</Button></div> : <>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">{[
        { label: "Saldo em aberto", value: outstanding, sub: "Inclui parcelas vencidas", key: "all" },
        { label: "Em atraso", value: overdue, sub: "Saldo após pagamentos parciais", key: "overdue" },
        { label: payable ? "Total pago" : "Total recebido", value: settled, sub: "Inclui baixas parciais", key: "settled" },
      ].map(card => <button key={card.key} onClick={() => setFilter(card.key)} className="rounded-xl border bg-card p-5 text-left hover:border-primary/40"><p className="text-sm text-muted-foreground">{card.label}</p><p className={cn("mt-2 text-2xl font-semibold tracking-tight tabular-nums", card.key === "overdue" && card.value > 0 && "text-destructive")}>{isLoading ? "…" : currency(card.value)}</p><p className="mt-1 text-xs text-muted-foreground">{card.sub}</p></button>)}</div>
      <div className="flex flex-col gap-3 sm:flex-row"><div className="relative flex-1"><Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" /><Input aria-label="Buscar títulos" className="pl-9" placeholder={`Buscar descrição ou ${payable ? "fornecedor" : "cliente"}`} value={search} onChange={e => setSearch(e.target.value)} /></div><Select value={filter} onValueChange={setFilter}><SelectTrigger aria-label="Filtrar situação" className="sm:w-44"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(statusLabels).map(([key, label]) => <SelectItem key={key} value={key}>{label}</SelectItem>)}</SelectContent></Select></div>
      <div className="rounded-xl border bg-card overflow-hidden">{isLoading ? <div className="flex justify-center p-16"><Loader2 className="animate-spin" /></div> : filtered.length === 0 ? <div className="p-12 text-center"><Receipt className="mx-auto mb-3 h-9 w-9 text-muted-foreground" /><p className="font-medium">Nenhum título encontrado</p><p className="mt-1 text-sm text-muted-foreground">Ajuste os filtros ou crie um novo lançamento.</p></div> : <>
        <div className="hidden md:block"><Table><TableHeader><TableRow><TableHead>Descrição / contato</TableHead><TableHead>Vencimento</TableHead><TableHead>Situação</TableHead><TableHead className="text-right">Valor original</TableHead><TableHead className="text-right">Saldo</TableHead><TableHead>Ações</TableHead></TableRow></TableHeader><TableBody>{filtered.map(t => <TableRow key={t.id}><TableCell><p className="font-medium">{t.description}</p><p className="text-xs text-muted-foreground">{t.vendors?.name || t.customers?.name || "Sem contato"}</p></TableCell><TableCell className="whitespace-nowrap">{displayDate(t.due_date)}</TableCell><TableCell><span className={cn("whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium", statusColors[effectiveStatus(t)])}>{statusLabels[effectiveStatus(t)]}</span></TableCell><TableCell className="text-right tabular-nums">{currency(t.amount)}</TableCell><TableCell className="text-right font-semibold tabular-nums">{currency(isCancelled(t) ? 0 : outstandingAmount(t))}</TableCell><TableCell>{actions(t)}</TableCell></TableRow>)}</TableBody></Table></div>
        <div className="divide-y md:hidden">{filtered.map(t => <article key={t.id} className="space-y-3 p-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="break-words font-medium">{t.description}</p><p className="text-sm text-muted-foreground">{t.vendors?.name || t.customers?.name || "Sem contato"}</p></div><span className={cn("shrink-0 rounded-full px-2 py-1 text-xs", statusColors[effectiveStatus(t)])}>{statusLabels[effectiveStatus(t)]}</span></div><div className="flex justify-between text-sm"><span className="text-muted-foreground">Vence {displayDate(t.due_date)}</span><strong className="tabular-nums">{currency(isCancelled(t) ? 0 : outstandingAmount(t))}</strong></div>{actions(t)}</article>)}</div>
        <div className="flex flex-wrap justify-between gap-2 border-t px-4 py-3 text-xs text-muted-foreground"><span>{filtered.length} títulos</span><span>Saldo da seleção: {currency(filtered.filter(t => !isCancelled(t)).reduce((s, t) => s + outstandingAmount(t), 0))}</span></div>
      </>}</div>
    </>}
    <Dialog open={createOpen} onOpenChange={v => !create.isPending && setCreateOpen(v)}><DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl"><DialogHeader><DialogTitle>{classificationOnly ? "Classificar compra" : editTitle ? "Editar título" : `Novo título a ${payable ? "pagar" : "receber"}`}</DialogTitle><DialogDescription>{classificationOnly ? "Classifique os itens sem vínculo de estoque para a DRE. Use uma conta de despesa para serviços ou uma conta de ativo para aquisições patrimoniais. Esta edição atualiza somente classificação, competência e observações." : "Competência define o período do resultado; vencimento define o prazo de pagamento."}</DialogDescription></DialogHeader><div className="grid gap-4"><div className="space-y-1.5"><Label htmlFor="financial-description">Descrição *</Label><Input id="financial-description" readOnly={classificationOnly} value={form.description} onChange={e => set("description", e.target.value)} /></div>{selectField(payable ? "Fornecedor" : "Cliente", "contact", options?.contacts)}<div className="grid gap-3 sm:grid-cols-3"><div className="space-y-1.5"><Label htmlFor="financial-amount">Valor (R$) *</Label><Input id="financial-amount" readOnly={classificationOnly} inputMode="decimal" placeholder="0,00" value={form.amount} onChange={e => set("amount", e.target.value)} /></div><div className="space-y-1.5"><Label htmlFor="financial-due">Vencimento *</Label><Input id="financial-due" readOnly={classificationOnly} type="date" value={form.due_date} onChange={e => set("due_date", e.target.value)} /></div><div className="space-y-1.5"><Label htmlFor="financial-competence">Competência *</Label><Input id="financial-competence" type="date" value={form.competence_date} onChange={e => set("competence_date", e.target.value)} /></div></div><div className="grid gap-3 sm:grid-cols-2">{selectField("Plano de contas", "account_id", options?.accounts)}{selectField("Centro de custo", "cost_center_id", options?.centers)}</div>{selectField("Forma de pagamento", "payment_method_id", options?.methods)}<div><Label htmlFor="financial-notes">Observações</Label><Textarea id="financial-notes" value={form.notes} onChange={e => set("notes", e.target.value)} /></div>{optionsError && <p role="alert" className="text-sm text-destructive">Não foi possível carregar os cadastros auxiliares.</p>}</div><DialogFooter><Button variant="outline" disabled={create.isPending} onClick={() => setCreateOpen(false)}>Cancelar</Button><Button disabled={create.isPending || !form.description.trim() || !form.amount || !!optionsError} onClick={() => create.mutate()}>{create.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{classificationOnly ? "Salvar classificação" : editTitle ? "Salvar alterações" : "Criar título"}</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={!!settlement} onOpenChange={v => !v && !settle.isPending && setSettlement(null)}><DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md"><DialogHeader><DialogTitle>{payable ? "Registrar pagamento" : "Registrar recebimento"}</DialogTitle><DialogDescription>{settlement?.title.description}</DialogDescription></DialogHeader>{settlement && <div className="space-y-4"><div className="rounded-lg bg-muted p-4"><p className="text-xs text-muted-foreground">Saldo disponível para baixa</p><p className="text-2xl font-semibold tabular-nums">{currency(outstandingAmount(settlement.title))}</p></div><div><Label htmlFor="settle-amount">Valor desta baixa (R$)</Label><Input id="settle-amount" inputMode="decimal" value={settlement.amount} onChange={e => setSettlement({ ...settlement, amount: e.target.value, requestId: crypto.randomUUID() })} /><p className="mt-1 text-xs text-muted-foreground">Informe um valor menor para uma baixa parcial.</p></div><div><Label htmlFor="settle-date">Data</Label><Input id="settle-date" type="date" max={localDate()} value={settlement.date} onChange={e => setSettlement({ ...settlement, date: e.target.value, requestId: crypto.randomUUID() })} /></div><div><Label>Conta bancária *</Label><Select value={settlement.account} onValueChange={account => setSettlement({ ...settlement, account, requestId: crypto.randomUUID() })}><SelectTrigger aria-label="Conta bancária da baixa"><SelectValue placeholder="Selecione a conta" /></SelectTrigger><SelectContent>{options?.banks?.map(a => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent></Select>{!options?.banks?.length && <p className="mt-2 text-sm text-muted-foreground">Cadastre uma conta em <Link className="text-primary underline" to="/financeiro/caixa">Caixa e bancos</Link> para registrar a baixa.</p>}</div></div>}<DialogFooter><Button variant="outline" disabled={settle.isPending} onClick={() => setSettlement(null)}>Cancelar</Button><Button disabled={settle.isPending || !settlement?.account} onClick={() => settle.mutate()}>{settle.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Confirmar baixa</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={!!cancelTitle} onOpenChange={v => !v && !cancel.isPending && setCancelTitle(null)}><DialogContent><DialogHeader><DialogTitle>Cancelar título?</DialogTitle><DialogDescription>“{cancelTitle?.description}” será cancelado e preservado no histórico. Esta ação está disponível somente para títulos sem pagamentos.</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" onClick={() => setCancelTitle(null)}>Voltar</Button><Button variant="destructive" disabled={cancel.isPending} onClick={() => cancel.mutate()}>Cancelar título</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={!!historyTitle} onOpenChange={v => !v && setHistoryTitle(null)}><DialogContent className="max-h-[85dvh] overflow-y-auto"><DialogHeader><DialogTitle>Histórico de baixas</DialogTitle><DialogDescription>{historyTitle?.description}</DialogDescription></DialogHeader>{historyLoading ? <Loader2 className="animate-spin" /> : historyError ? <p role="alert" className="text-destructive">Não foi possível carregar as baixas.</p> : history.length ? <div className="divide-y">{history.map(t => <div key={t.id} className="flex justify-between gap-3 py-3"><div><p className="text-sm">{displayDate(t.transaction_date)} · {t.bank_accounts?.name}</p><p className="text-xs text-muted-foreground">{t.is_reconciled ? "Conferido no extrato" : "Conferência pendente"}</p></div><strong className="tabular-nums">{currency(t.amount)}</strong></div>)}</div> : <p className="text-sm text-muted-foreground">Esta baixa é anterior ao histórico bancário integrado. Valor acumulado: {currency(historyTitle ? settledAmount(historyTitle) : 0)}.</p>}</DialogContent></Dialog>
  </div>;
}
