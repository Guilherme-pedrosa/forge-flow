import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { automationValues, automationValuesSchema, readMarketplaceAutomation, requestMarketplaceAutomation, reviewMarketplaceAutomation, saveMarketplaceAutomation, type MarketplaceAutomation, type MarketplaceAutomationValues } from "@/lib/marketplace-automation";
import { integrationErrorMessage } from "@/lib/mercado-livre-integration";
import { orderRequest } from "@/lib/sales-order";

const date = (value: string | null) => value ? new Date(value).toLocaleString("pt-BR") : "Ainda não executada";
export function MarketplaceAutomationSettings({ accountId, disabled = false }: { accountId: string; disabled?: boolean }) {
  const { profile, user } = useAuth();
  return <Settings key={`${profile?.tenant_id}:${user?.id}:${accountId}`} accountId={accountId} disabled={disabled} />;
}
function Settings({ accountId, disabled }: { accountId: string; disabled: boolean }) {
  const { profile, user } = useAuth(), qc = useQueryClient();
  const key = ["marketplace_automation", profile?.tenant_id, user?.id, accountId];
  const query = useQuery({ queryKey: key, queryFn: () => readMarketplaceAutomation(accountId), retry: false, refetchInterval: 30000 });
  const [draft, setDraft] = useState<MarketplaceAutomationValues | null>(null), [revision, setRevision] = useState("");
  const [message, setMessage] = useState("");
  const request = useRef<{ signature: string; id: string } | null>(null), runRequest = useRef<string | null>(null);
  const reviewRequests=useRef<Partial<Record<'orders'|'stock'|'price',string>>>({});
  const alive = useRef(true); useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { if (query.data && !draft) { setDraft(automationValues(query.data)); setRevision(query.data.policy.revision); } }, [query.data, draft]);
  const save = useMutation({ mutationFn: async () => {
    if (!draft || !revision) throw new Error("Atualize a configuração antes de salvar.");
    request.current = orderRequest(request.current, JSON.stringify([accountId, revision, draft]));
    return saveMarketplaceAutomation(accountId, draft, revision, request.current.id);
  }, onSuccess: value => { if (!alive.current) return; qc.setQueryData(key, value); setDraft(automationValues(value)); setRevision(value.policy.revision); setMessage("Funcionamento salvo para esta conta."); request.current = null; runRequest.current = null; } });
  const run = useMutation({ mutationFn: () => { runRequest.current ??= crypto.randomUUID(); return requestMarketplaceAutomation(accountId, runRequest.current); },
    onSuccess: result => { if (!alive.current) return; setMessage(`${result.queued} rotina(s) na fila.`); qc.setQueryData(key, (old: MarketplaceAutomation | undefined) => old ? { ...old, status: result.status } : old); runRequest.current = null; } });
  const review=useMutation({mutationFn:(action:'orders'|'stock'|'price')=>{reviewRequests.current[action]??=crypto.randomUUID();return reviewMarketplaceAutomation(accountId,action,reviewRequests.current[action]!,{userId:user?.id??''});},onSuccess:(result,action)=>{if(!alive.current)return;delete reviewRequests.current[action];qc.setQueryData(key,(old:MarketplaceAutomation|undefined)=>old?{...old,status:result.status}:old);setMessage(`Conferência registrada. ${result.queued} nova(s) rotina(s) para recalcular.`);}});
  const busy = disabled || save.isPending || run.isPending || review.isPending, stale = !!query.data && !!revision && query.data.policy.revision !== revision;
  const valid = !!draft && automationValuesSchema.safeParse(draft).success;
  const dirty = !!draft && !!query.data && JSON.stringify(draft) !== JSON.stringify(automationValues(query.data));
  const update = <K extends keyof MarketplaceAutomationValues>(field: K, value: MarketplaceAutomationValues[K]) => { if (draft) setDraft({ ...draft, [field]: value }); setMessage(""); };
  return <section aria-label="Funcionamento do Mercado Livre" className="space-y-4 rounded-xl border bg-card p-4">
    <div><h2 className="font-semibold">Estoque, preços e pedidos</h2><p className="text-sm text-muted-foreground">Defina o que o Forge mantém atualizado nesta conta, mesmo quando o navegador estiver fechado.</p></div>
    {query.isLoading && <p role="status">Carregando funcionamento…</p>}
    {query.error && <p role="alert">{integrationErrorMessage(query.error)} <Button variant="outline" onClick={() => void query.refetch()}>Tentar novamente</Button></p>}
    {draft && <>
      <div className="space-y-3">{([
        ["orders_auto", "Consultar e importar pedidos automaticamente", "Os pedidos entram no Forge e seguem a organização salva para esta conta."],
        ["stock_auto", "Atualizar o estoque dos anúncios", "Usa o saldo livre do Forge, os pedidos e os vínculos confirmados."],
        ["price_auto", "Atualizar os preços dos anúncios", "Usa o preço de Mercado Livre aceito na precificação do produto."],
      ] as const).map(([field, label, help]) => <label key={field} className="flex items-start gap-3 rounded-lg border p-3"><input className="mt-1" type="checkbox" checked={draft[field]} disabled={busy} onChange={event => update(field, event.target.checked)} /><span><span className="block text-sm font-medium">{label}</span><span className="block text-xs text-muted-foreground">{help}</span></span></label>)}</div>
      <div className="grid gap-4 sm:grid-cols-3"><div><Label htmlFor="ml-safety">Reserva de segurança (un.)</Label><Input id="ml-safety" type="number" min={0} max={1000} step={1} value={Number.isFinite(draft.safety_stock) ? draft.safety_stock : ""} disabled={busy} onChange={event => update("safety_stock", event.target.value === "" ? Number.NaN : Number(event.target.value))} /></div>
        <div><Label htmlFor="ml-default-type">Tipo de anúncio padrão</Label><select id="ml-default-type" className="h-11 w-full rounded-md border bg-background px-3 text-sm" value={draft.listing_type_default} disabled={busy} onChange={event => update("listing_type_default", event.target.value as MarketplaceAutomationValues["listing_type_default"])}><option value="gold_special">Clássico</option><option value="gold_pro">Premium</option></select></div>
        <div><Label htmlFor="ml-interval">Verificar a cada</Label><select id="ml-interval" className="h-11 w-full rounded-md border bg-background px-3 text-sm" value={draft.interval_minutes} disabled={busy} onChange={event => update("interval_minutes", Number(event.target.value) as MarketplaceAutomationValues["interval_minutes"])}>{[5, 15, 30, 60].map(value => <option key={value} value={value}>{value} minutos</option>)}</select></div></div>
      {stale && <p role="alert">A configuração mudou em outra sessão. Seus dados continuam aqui; recarregue a configuração antes de salvar.</p>}
      {!valid && <p role="alert">Informe uma reserva inteira entre 0 e 1000 e confira as opções da rotina. Digite 0 para confirmar que não há reserva.</p>}
      {dirty && <p className="text-sm text-muted-foreground">Salve o funcionamento antes de executar as rotinas com estas opções.</p>}
      <div className="flex flex-wrap gap-2"><Button disabled={busy || stale || !valid || !query.data} onClick={() => save.mutate()}>Salvar funcionamento</Button><Button variant="outline" disabled={busy || stale || dirty || !valid || !query.data || ![query.data.policy.orders_auto, query.data.policy.stock_auto, query.data.policy.price_auto].some(Boolean)} onClick={() => run.mutate()}>Executar rotinas ativas agora</Button><Button variant="ghost" disabled={busy} onClick={async () => { const result = await query.refetch(); if (alive.current && result.data) { setDraft(automationValues(result.data)); setRevision(result.data.policy.revision); } }}>Recarregar configuração</Button></div>
    </>}
    {query.data && <dl className="grid gap-2 rounded-lg bg-muted/40 p-3 text-sm sm:grid-cols-2"><div><dt className="text-muted-foreground">Última execução</dt><dd>{date(query.data.status.last_run_at)}</dd></div><div><dt className="text-muted-foreground">Último sucesso</dt><dd>{date(query.data.status.last_success_at)}</dd></div><div><dt className="text-muted-foreground">Próxima execução</dt><dd>{query.data.status.next_run_at ? date(query.data.status.next_run_at) : "Rotinas desativadas"}</dd></div><div><dt className="text-muted-foreground">Fila</dt><dd>{query.data.status.pending_jobs} pendentes · {query.data.status.running_jobs} executando · {query.data.status.failed_jobs} falhas</dd></div></dl>}
    {!!query.data?.status.needs_review_actions.length&&<div className="space-y-2 rounded-lg border p-3"><p className="text-sm">Confira o resultado diretamente no Mercado Livre antes de liberar uma nova execução. O envio anterior será encerrado; a próxima rotina lerá os dados novamente.</p>{query.data.status.needs_review_actions.map(action=><div key={action} className="flex flex-wrap items-center gap-3"><span className="text-sm">{action==='stock'?'Estoque':action==='price'?'Preços':'Pedidos'}</span><Button variant="outline" disabled={busy||dirty||stale} onClick={()=>review.mutate(action)}>Conferi no canal; recalcular próxima execução</Button></div>)}</div>}
    {(save.error || run.error || review.error) && <p role="alert" className="text-sm text-destructive">{integrationErrorMessage(save.error || run.error || review.error)}</p>}{query.data?.status.last_error && <p role="alert" className="text-sm text-destructive">{query.data.status.last_error}</p>}{message && <p role="status" className="text-sm">{message}</p>}
  </section>;
}
