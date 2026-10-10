import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Loader2, RefreshCw, Store } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/shared/PageHeader";
import { WorkflowPolicy } from "@/components/marketplace/WorkflowPolicy";
import { MarketplaceBindings } from "@/components/marketplace/MarketplaceBindings";
import { useToast } from "@/hooks/use-toast";
import { orderRequest } from "@/lib/sales-order";
import { isMissingDatabaseStructure } from "@/lib/database-readiness";
import { marketplaceBindingKey, marketplaceDb, marketplaceImportExample, marketplaceLabels, marketplaceRpc, marketplaceStateLabels, parseMarketplaceImport, type CanonicalMarketplaceOrder, type MarketplaceAccount, type MarketplaceChannel, type MarketplaceInboxOrder } from "@/lib/marketplace-orders";

const selectClass = "h-10 w-full rounded-md border border-input bg-background px-3 text-sm";
const dateTime = (value: string | null) => value ? new Date(value).toLocaleString("pt-BR") : "Prazo não informado";
const currency = (value: number | string | null) => value == null ? "Não informado" : Number(value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const connectionLabels: Record<string, string> = { connected: "Autorização API registrada", pending_credentials: "Importação disponível · autorização API pendente", pending_access: "Importação disponível · acesso API por validar", import_only: "Importação disponível", reauthorization_required: "API precisa de nova autorização" };
const workflowSummary = (result: Record<string, unknown>) => {
  const workflow = result.workflow as { organized?: number; results?: { outcome?: string }[] } | undefined;
  const pending = workflow?.results?.filter(row => row.outcome === "needs_preparation" || row.outcome === "needs_review").length ?? 0;
  return `${workflow ? ` · ${Number(workflow.organized ?? 0)} organizados automaticamente` : ""}${pending ? ` · ${pending} pedidos para revisar` : ""}${typeof result.workflow_issue === "string" ? ` · Organização pendente: ${result.workflow_issue}` : ""}`;
};

export default function Marketplaces() {
  const { profile } = useAuth(); const { toast } = useToast(); const qc = useQueryClient();
  const [accountId, setAccountId] = useState(""); const [newChannel, setNewChannel] = useState<MarketplaceChannel>("mercado_livre");
  const [newName, setNewName] = useState(""); const [sellerId, setSellerId] = useState("");
  const [input, setInput] = useState(""); const [format, setFormat] = useState<"json" | "csv">("json");
  const [preview, setPreview] = useState<CanonicalMarketplaceOrder[] | null>(null); const [orderIds, setOrderIds] = useState("");
  const [recentFrom, setRecentFrom] = useState(() => new Date(Date.now() - 7 * 86400000).toISOString().slice(0,10));
  const [recentTo, setRecentTo] = useState(() => new Date().toISOString().slice(0,10));
  const [recentNext, setRecentNext] = useState<number | null>(null);
  const [recentCursor, setRecentCursor] = useState<string | null>(null);
  const [recentWindow, setRecentWindow] = useState<{ from: string; to: string } | null>(null);
  const [productSelections, setProductSelections] = useState<Record<string, string>>({});
  const [reviewReasons, setReviewReasons] = useState<Record<string, string>>({});
  const [customerId, setCustomerId] = useState(""); const [paymentDate, setPaymentDate] = useState("");
  const requests = useRef<Record<string, { signature: string; id: string }>>({});
  const requestId = (key: string, signature: string) => { const request = orderRequest(requests.current[key] ?? null, signature); requests.current[key] = request; return request.id; };
  const accounts = useQuery({ queryKey: ["marketplace_accounts"], enabled: !!profile, queryFn: async () => {
    const { data, error } = await marketplaceDb.from("marketplace_accounts").select("id,channel,name,external_seller_id,connection_state,last_sync_at").eq("tenant_id", profile!.tenant_id).order("name"); if (error) throw error; return data as MarketplaceAccount[];
  } });
  const effectiveAccountId = accountId || accounts.data?.[0]?.id || "";
  const account = accounts.data?.find(row => row.id === effectiveAccountId);
  const inbox = useQuery({ queryKey: ["marketplace_orders", effectiveAccountId], enabled: !!profile && !!effectiveAccountId, queryFn: async () => {
    const { data, error } = await marketplaceDb.from("marketplace_orders").select("*,items:marketplace_order_items(*)").eq("tenant_id", profile!.tenant_id).eq("account_id", effectiveAccountId).order("imported_at", { ascending: false }).limit(100); if (error) throw error; return data as MarketplaceInboxOrder[];
  } });
  const manualReviewBindings = useQuery({ queryKey: ["marketplace_review_bindings", profile?.tenant_id, effectiveAccountId], enabled: !!profile && !!effectiveAccountId, queryFn: async () => {
    const keys: string[] = [];
    for (let start = 0; ; start += 1000) {
      const { data, error } = await marketplaceDb.from("marketplace_sku_bindings").select("external_item_id,external_variant_id,external_sku")
        .eq("tenant_id", profile!.tenant_id).eq("account_id", effectiveAccountId).eq("requires_manual_review", true).order("id").range(start, start + 999);
      if (error) { if (isMissingDatabaseStructure(error)) return { available: false, keys: [] }; throw error; }
      const rows = (data ?? []) as unknown as Array<{ external_item_id: string; external_variant_id: string; external_sku: string }>;
      keys.push(...rows.map(marketplaceBindingKey));
      if (rows.length < 1000) return { available: true, keys };
    }
  } });
  const catalog = useQuery({ queryKey: ["marketplace_catalog"], enabled: !!profile, queryFn: async () => {
    const products: { id: string; name: string; sku: string | null }[] = [];
    for (let start = 0; ; start += 1000) { const { data, error } = await supabase.from("products").select("id,name,sku").eq("tenant_id", profile!.tenant_id).eq("is_active", true).order("name").order("id").range(start,start + 999); if (error) throw error; products.push(...data); if (data.length < 1000) break; }
    return products;
  } });
  const customers = useQuery({ queryKey: ["marketplace_customers"], enabled: !!profile, queryFn: async () => {
    const result: { id: string; name: string }[] = [];
    for (let start = 0; ; start += 1000) { const { data, error } = await supabase.from("customers").select("id,name").eq("tenant_id", profile!.tenant_id).order("name").order("id").range(start,start + 999); if (error) throw error; result.push(...data); if (data.length < 1000) break; }
    return result;
  } });
  const events = useQuery({ queryKey: ["marketplace_events", effectiveAccountId], enabled: !!profile && !!effectiveAccountId, queryFn: async () => {
    const { data, error } = await marketplaceDb.from("marketplace_events").select("id,status,attempts,last_error").eq("tenant_id", profile!.tenant_id).eq("account_id", effectiveAccountId).in("status", ["pending", "failed"]).order("received_at").limit(100); if (error) throw error; return data;
  } });
  const mutate = useMutation({ mutationFn: (fn: () => Promise<string>) => fn(), onSuccess: message => {
    ["marketplace_accounts", "marketplace_orders", "marketplace_sku_bindings", "marketplace_review_bindings", "marketplace_events", "orders", "order_items", "order_stock_allocations", "jobs", "fila_jobs", "inventory_items", "production_orders", "production_order_items", "filament_planning", "filament-planning", "capacity_data", "accounts_receivable", "dre_ar", "marketplace_receivable_positions", "hoje", "daily_operations", "daily-operations", "sales_workflow", "dashboard"].forEach(key => void qc.invalidateQueries({ queryKey: [key] }));
    toast({ title: message });
  }, onError: error => toast({ title: "Não foi possível concluir", description: (error as { message?: string }).message ?? "Confira os dados e tente novamente.", variant: "destructive" }) });
  async function edge(body: Record<string, unknown>, channel = account?.channel): Promise<Record<string, unknown>> {
    const { data, error } = await supabase.functions.invoke(channel === "shopee" ? "shopee-sync" : "marketplace-sync", { body });
    if (error) { let message = error.message; try { const detail = await error.context?.json(); if (detail?.error) message = detail.error; } catch { /* Keep invocation error. */ } throw new Error(message); }
    if (data?.error) throw new Error(data.error); return data;
  }
  const downloadExample = () => { const url = URL.createObjectURL(new Blob([marketplaceImportExample], { type: "application/json" })); const link = document.createElement("a"); link.href = url; link.download = "modelo-pedidos-marketplace.json"; link.click(); URL.revokeObjectURL(url); };
  const oauth = new URLSearchParams(window.location.search);
  const oauthCode = oauth.get("code"), oauthState = oauth.get("state");
  const oauthShopId = oauth.get("shop_id");
  const oauthMainAccount = oauth.get("main_account_id");
  const oauthLabel = oauthShopId ? "Shopee" : "Mercado Livre";
  function fetchRecent(offset: number, cursor: string | null = null) { mutate.mutate(async () => {
    const window = cursor && recentWindow ? recentWindow : { from: new Date(`${recentFrom}T00:00:00`).toISOString(), to: new Date(`${recentTo}T23:59:59.999`).toISOString() };
    const result = await edge({ action: "fetch_recent_orders", account_id: account!.id, ...window, ...(account!.channel === "shopee" ? { cursor } : { offset }) });
    setRecentNext(typeof result.next_offset === "number" ? result.next_offset : null);
    setRecentCursor(typeof result.next_cursor === "string" ? result.next_cursor : null);
    setRecentWindow(typeof result.effective_from === "string" && typeof result.effective_to === "string" ? { from: result.effective_from, to: result.effective_to } : null);
    return `${Number(result.fetched ?? 0)} consultados · ${Number(result.imported ?? 0)} atualizados · ${Number(result.unchanged ?? 0)} já importados${Number(result.missing_deadline ?? 0) ? ` · ${Number(result.missing_deadline)} prazos para conferir no canal` : ""}${Number(result.values_to_review ?? 0) ? ` · ${Number(result.values_to_review)} valores para conferir` : ""}${workflowSummary(result)}`;
  }); }
  if (accounts.error && isMissingDatabaseStructure(accounts.error)) return <div role="status" className="rounded-xl border bg-card p-6 space-y-3"><p>Importação dos canais ainda precisa ser ativada nesta empresa.</p><p className="text-sm text-muted-foreground">A estrutura de pedidos dos marketplaces precisa ser publicada no banco. As vendas já cadastradas continuam disponíveis em Pedidos.</p><Button asChild variant="outline"><Link to="/comercial/pedidos">Abrir pedidos</Link></Button><Button className="ml-2" variant="ghost" onClick={() => void accounts.refetch()}>Verificar ativação</Button></div>;
  if (accounts.error) return <div role="alert" className="rounded-xl border bg-card p-6">Não foi possível carregar as contas. {accounts.error.message}<Button className="mt-3" variant="outline" onClick={() => void accounts.refetch()}>Tentar novamente</Button></div>;

  return <div className="space-y-5">
    <PageHeader title="Vendas dos marketplaces" description="Traga os pedidos, vincule os produtos uma vez e confira o prazo para organizar a produção." breadcrumbs={[{ label: "Integrações" }, { label: "Marketplaces" }]} />
    {mutate.isPending && <p role="status" className="flex gap-2 text-sm"><Loader2 className="h-4 w-4 animate-spin" />Concluindo operação…</p>}
    {oauthCode && oauthMainAccount && !oauthShopId && <p role="alert" className="rounded-xl border bg-card p-4">A Shopee retornou uma autorização de conta principal. Nesta etapa, autorize uma loja individual para conectá-la ao ERP.</p>}
    {oauthCode && oauthState && (!oauthMainAccount || oauthShopId) && <div className="rounded-xl border bg-card p-4"><p>{oauthLabel} retornou a autorização. Conclua para validar a conta.</p><Button disabled={mutate.isPending} className="mt-2" onClick={() => mutate.mutate(async () => { const result = await edge({ action: "oauth_exchange", code: oauthCode, state: oauthState, ...(oauthShopId ? { shop_id: oauthShopId } : {}) }, oauthShopId ? "shopee" : "mercado_livre"); if (typeof result.account_id === "string") setAccountId(result.account_id); window.history.replaceState({}, "", window.location.pathname); return `Conta autorizada: ${oauthLabel}`; })}>Concluir autorização</Button></div>}
    {oauthCode && !oauthState && <p role="alert" className="rounded-xl border bg-card p-4">O retorno não trouxe o estado de segurança da autorização. Comece a autorização novamente; a conta ainda não foi conectada.</p>}
    <section className="rounded-xl border bg-card p-4 space-y-3" aria-label="Contas dos canais">
      <h2 className="font-semibold flex gap-2"><Store className="h-5 w-5" />Contas de venda</h2>
      {accounts.isLoading ? <p>Carregando contas…</p> : accounts.data?.length ? <div className="grid gap-3 sm:grid-cols-2">
        <div><Label htmlFor="marketplace-account">Conta</Label><select id="marketplace-account" className={selectClass} value={effectiveAccountId} onChange={e => { setAccountId(e.target.value); setPreview(null); setRecentNext(null); setRecentCursor(null); setRecentWindow(null); }}>{accounts.data.map(row => <option key={row.id} value={row.id}>{marketplaceLabels[row.channel]} · {row.name}</option>)}</select></div>
        <div className="text-sm pt-5"><p>{account && connectionLabels[account.connection_state]}</p><p className="text-muted-foreground">Última importação: {account?.last_sync_at ? dateTime(account.last_sync_at) : "Ainda sem importação"}</p></div>
      </div> : <p className="text-sm text-muted-foreground">Cadastre uma conta para começar a importar seus pedidos.</p>}
      <details><summary className="cursor-pointer text-sm font-medium">Cadastrar conta</summary><div className="grid gap-3 mt-3 sm:grid-cols-4">
        <select aria-label="Canal da nova conta" className={selectClass} value={newChannel} onChange={e => setNewChannel(e.target.value as MarketplaceChannel)}>{Object.entries(marketplaceLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
        <Input aria-label="Nome da conta" placeholder="Nome da loja" value={newName} onChange={e => setNewName(e.target.value)} />
        <Input aria-label="ID externo do vendedor" placeholder="ID do vendedor (opcional)" value={sellerId} onChange={e => setSellerId(e.target.value)} />
        <Button disabled={mutate.isPending || !newName.trim()} onClick={() => mutate.mutate(async () => { const id = await marketplaceRpc<string>("save_marketplace_account", { p_channel: newChannel, p_name: newName, p_external_seller_id: sellerId || null }); setAccountId(id); setNewName(""); setSellerId(""); return "Conta cadastrada para importação"; })}>Cadastrar conta</Button>
      </div><p className="text-xs text-muted-foreground mt-2">O cadastro não autoriza a API. Os arquivos continuam disponíveis enquanto o acesso do aplicativo é validado; TikTok usa a importação por arquivo nesta etapa.</p></details>
    </section>
    {!!account && <>
      <details className="rounded-xl border bg-card p-4"><summary className="cursor-pointer text-sm font-semibold">Vínculos de anúncios</summary><p className="my-3 text-sm text-muted-foreground">Cadastre antes da primeira venda ou corrija o produto associado a um anúncio desta conta.</p><MarketplaceBindings accountId={account.id} tenantId={profile?.tenant_id ?? ""} productOptions={catalog.data ?? []} catalogLoading={catalog.isLoading} catalogError={catalog.error?.message} onCatalogRetry={() => void catalog.refetch()} /></details>
      {(account.channel === "mercado_livre" || account.channel === "shopee") && <section className="rounded-xl border bg-card p-4 space-y-3" aria-label={`Consulta ${marketplaceLabels[account.channel]}`}>
        <h2 className="font-semibold">Consultar: {marketplaceLabels[account.channel]}</h2><p className="text-sm text-muted-foreground">A autorização acontece em {marketplaceLabels[account.channel]}. A consulta busca os pedidos e o prazo oficial de despacho; os pedidos entram para conferência.</p>
        <div className="flex flex-wrap items-end gap-2"><div><Label htmlFor="marketplace-from">{account.channel === "shopee" ? "Atualizados de" : "Vendas de"}</Label><Input id="marketplace-from" type="date" value={recentFrom} onChange={e => { setRecentFrom(e.target.value); setRecentNext(null); setRecentCursor(null); setRecentWindow(null); }} /></div><div><Label htmlFor="marketplace-to">Até</Label><Input id="marketplace-to" type="date" value={recentTo} onChange={e => { setRecentTo(e.target.value); setRecentNext(null); setRecentCursor(null); setRecentWindow(null); }} /></div>
          <Button disabled={mutate.isPending || !recentFrom || !recentTo || account.connection_state !== "connected"} onClick={() => fetchRecent(0)}>Buscar pedidos recentes</Button>
          {account.channel === "shopee" ? recentCursor !== null && <Button variant="outline" disabled={mutate.isPending} onClick={() => fetchRecent(0, recentCursor)}>Buscar próxima página</Button> : recentNext !== null && <Button variant="outline" disabled={mutate.isPending} onClick={() => fetchRecent(recentNext)}>Buscar próxima página</Button>}</div>
        <p className="text-xs text-muted-foreground">{account.channel === "shopee" ? "Busca atualizações em páginas de 20, em intervalos de até 15 dias, incluindo cancelamentos e mudanças de pagamento. Pedidos sem horário oficial ou com valores divergentes ficam para conferência." : "Busca pedidos pagos em páginas de 20, até 100 por intervalo de até 31 dias. Consulte outros estados por ID para revisar cancelamentos ou alterações."}</p>
        <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={mutate.isPending} onClick={() => mutate.mutate(async () => { const result = await edge({ action: "oauth_begin", account_id: account.id }); if (typeof result.authorization_url !== "string") throw new Error("Endereço de autorização não retornado."); window.location.assign(result.authorization_url); return `Abrindo autorização: ${marketplaceLabels[account.channel]}`; })}>{account.connection_state === "connected" ? "Autorizar novamente" : `Autorizar ${marketplaceLabels[account.channel]}`}</Button>
          <Input className="sm:max-w-md" aria-label={`IDs de pedidos ${marketplaceLabels[account.channel]}`} placeholder="Números de pedidos, separados por vírgula" value={orderIds} onChange={e => setOrderIds(e.target.value)} />
          <Button disabled={mutate.isPending || !orderIds.trim() || account.connection_state !== "connected"} onClick={() => mutate.mutate(async () => { const result = await edge({ action: "fetch_orders", account_id: account.id, order_ids: orderIds.split(/[\s,;]+/).filter(Boolean) }); return `Consulta concluída: ${Number(result.imported ?? 0)} pedidos atualizados${workflowSummary(result)}`; })}><RefreshCw className="mr-2 h-4 w-4" />Consultar pedidos</Button>
        </div><p className="text-xs text-muted-foreground">Sem credenciais do aplicativo no servidor, a autorização informa o acesso pendente. Sincronização automática e etiquetas ainda não estão ativadas.</p>
        {account.channel === "mercado_livre" && !!events.data?.length && <div className="rounded-md border p-3 text-sm"><p>{events.data.length} eventos pendentes ou com falha. A consulta revalida o pedido no Mercado Livre antes de atualizar a entrada.</p><Button variant="outline" className="mt-2" disabled={mutate.isPending || account.connection_state !== "connected"} onClick={() => mutate.mutate(async () => { const result = await edge({ action: "process_events", account_id: account.id }); return `${Number(result.processed ?? 0)} eventos conferidos · ${Number(result.failed ?? 0)} falhas para revisão`; })}>Conferir próximos eventos</Button>{events.data.some(event => event.attempts >= 5) && <p className="mt-2 text-destructive">Há eventos que atingiram cinco tentativas. Consulte o pedido por ID e revise a mensagem antes de reprocessar.</p>}</div>}
        {events.error && <p role="alert" className="text-sm text-destructive">Não foi possível carregar os eventos: {events.error.message}</p>}
      </section>}
      <section className="rounded-xl border bg-card p-4 space-y-3" aria-label="Importar pedidos">
        <div className="flex flex-wrap justify-between gap-2"><h2 className="font-semibold">Importar pedidos de {marketplaceLabels[account.channel]}</h2><Button variant="outline" size="sm" onClick={downloadExample}><Download className="mr-2 h-4 w-4" />Baixar modelo JSON</Button></div>
        <p className="text-sm text-muted-foreground">Use o modelo com os dados reais do canal. Datas precisam conter o fuso. Cada linha identifica anúncio, variação ou SKU, e a situação do pagamento deve ser conferida.</p>
        <div className="flex flex-wrap gap-3"><select aria-label="Formato do arquivo" className={`${selectClass} max-w-32`} value={format} onChange={e => { setFormat(e.target.value as "json" | "csv"); setPreview(null); }}><option value="json">JSON</option><option value="csv">CSV</option></select>
          <Input type="file" accept=".json,.csv,application/json,text/csv" aria-label="Arquivo de pedidos" className="max-w-md" onChange={e => { const file = e.target.files?.[0]; if (!file) return; if (file.size > 1024 * 1024) { toast({ title: "Arquivo acima de 1 MB", variant: "destructive" }); return; } void file.text().then(text => { setInput(text); setPreview(null); setFormat(file.name.toLowerCase().endsWith(".csv") ? "csv" : "json"); }).catch(() => toast({ title: "Não foi possível ler o arquivo", variant: "destructive" })); }} /></div>
        <textarea aria-label="Conteúdo dos pedidos" className="w-full min-h-36 rounded-md border bg-background p-3 font-mono text-xs" value={input} onChange={e => { setInput(e.target.value); setPreview(null); }} placeholder="Cole os pedidos ou selecione um arquivo" />
        <details className="text-xs"><summary className="cursor-pointer">Colunas do CSV</summary><p className="mt-2 break-words">Uma linha por item. Obrigatórias: external_order_id, external_status, normalized_state, external_updated_at, external_line_id, description, quantity, unit_price e external_sku ou external_item_id. Opcionais: external_variant_id, external_pack_id, external_shipment_id, shipping_deadline_at, deadline_source, currency (BRL), shipping_amount, discount_amount, reported_total, seller_fees. Use ponto nos valores decimais. Campos do pedido precisam ser iguais nas linhas do mesmo pedido.</p></details>
        <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={mutate.isPending} onClick={() => { try { setPreview(parseMarketplaceImport(input, format)); } catch (error) { toast({ title: "Confira o arquivo", description: (error as Error).message, variant: "destructive" }); } }}>Conferir arquivo</Button>
          <Button disabled={!preview || mutate.isPending} onClick={() => mutate.mutate(async () => { const result = await marketplaceRpc<{ imported: number; unchanged: number; ignored_older: number; workflow?: { organized: number }; workflow_issue?: string }>("import_marketplace_orders", { p_account_id: account.id, p_orders: preview }); setPreview(null); setInput(""); return `${result.imported} atualizados · ${result.unchanged} já importados · ${result.ignored_older} revisões antigas ignoradas${workflowSummary(result)}`; })}>Importar {preview?.length ?? ""} pedidos</Button></div>
        {preview && <p role="status" className="text-sm">{preview.length} pedidos · {preview.reduce((sum, order) => sum + order.items.reduce((qty, item) => qty + item.quantity, 0), 0)} unidades · {preview.filter(order => !order.shipping_deadline_at).length} sem prazo. A importação registra os pedidos para conferência.</p>}
      </section>
      <section className="rounded-xl border bg-card p-4 space-y-3" aria-label="Dados para vendas"><h2 className="font-semibold">Para criar a venda</h2><div className="grid sm:grid-cols-2 gap-3">
        <div><Label htmlFor="marketplace-customer">Cliente no ERP</Label><select id="marketplace-customer" className={selectClass} value={customerId} onChange={e => setCustomerId(e.target.value)}><option value="">Selecione o cliente</option>{customers.data?.map(customer => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</select></div>
        <div><Label htmlFor="marketplace-receivable">Recebível previsto para</Label><Input id="marketplace-receivable" type="date" value={paymentDate} onChange={e => setPaymentDate(e.target.value)} /><p className="text-xs text-muted-foreground mt-1">Informe a previsão de repasse; pagamento do comprador é diferente de recebimento no banco.</p></div>
      </div>{(customers.error || catalog.error) && <p role="alert">Não foi possível carregar clientes ou produtos. Atualize a página antes de criar a venda.</p>}</section>
      <WorkflowPolicy accountId={account.id} customerOptions={customers.data ?? []} />
      {manualReviewBindings.error && <p role="alert" className="text-sm text-destructive">Não foi possível conferir quais vínculos exigem revisão. {manualReviewBindings.error.message} <Button variant="outline" onClick={() => void manualReviewBindings.refetch()}>Tentar conferir novamente</Button></p>}
      {manualReviewBindings.data && !manualReviewBindings.data.available && <p role="status" className="text-sm text-muted-foreground">A exigência de conferência para anúncios personalizados ainda precisa ser ativada no banco.</p>}
      <section aria-label="Pedidos recebidos" className="space-y-3"><div className="flex justify-between"><h2 className="font-semibold">Pedidos recebidos</h2><Button variant="ghost" size="sm" onClick={() => void inbox.refetch()}>Atualizar</Button></div>
        {inbox.isLoading ? <p>Carregando pedidos…</p> : inbox.error ? <p role="alert">Não foi possível consultar os pedidos: {inbox.error.message}</p> : !inbox.data?.length ? <p className="text-sm text-muted-foreground">Nenhum pedido importado nesta conta.</p> : inbox.data.map(order => { const requiresManualReview = order.items.some(line => manualReviewBindings.data?.keys.includes(marketplaceBindingKey(line))); return <article key={order.id} className="rounded-xl border bg-card p-4 space-y-3">
          <div className="flex flex-wrap justify-between gap-2"><div><h3 className="font-semibold">{order.external_order_id} · {marketplaceStateLabels[order.normalized_state]}</h3><p className="text-sm">Despachar até {dateTime(order.shipping_deadline_at)}</p><p className="text-xs text-muted-foreground">{order.deadline_source || "Confira o prazo no canal"}{order.external_pack_id && ` · Carrinho ${order.external_pack_id}`}{order.external_shipment_id && ` · Envio ${order.external_shipment_id}`}</p></div><div className="text-sm"><p>Itens e frete: {currency(order.total)}</p><p>Taxas do canal: {currency(order.seller_fees)}</p></div></div>
          {order.needs_review && <p role="alert" className="rounded-md bg-amber-500/10 p-2 text-sm">{order.review_reason} Atualize apenas se a venda ainda estiver em rascunho; vendas já organizadas precisam de revisão em Pedidos.</p>}
          {requiresManualReview && <p role="status" className="rounded-md bg-amber-500/10 p-2 text-sm">Este anúncio exige conferência e está fora da organização automática e em lote. Confira a personalização ou o arquivo do comprador em Pedidos antes de confirmar manualmente; o vínculo não registra aprovação da arte.</p>}
          {order.needs_review && order.internal_order_id && order.normalized_state === "paid" && <div className="flex flex-wrap gap-2"><Input aria-label={`Motivo de revisão do pedido ${order.external_order_id}`} placeholder="O que foi conferido no canal e na venda?" value={reviewReasons[order.id] ?? ""} onChange={e => setReviewReasons(previous => ({ ...previous, [order.id]: e.target.value }))} /><Button variant="outline" disabled={mutate.isPending || (reviewReasons[order.id]?.trim().length ?? 0) < 10} onClick={() => mutate.mutate(async () => { await marketplaceRpc("review_marketplace_order", { p_marketplace_order_id: order.id, p_reason: reviewReasons[order.id] }); return "Revisão registrada. Itens e valores conferem; escolhas de materiais e histórico preservados."; })}>Conferir equivalência e liberar revisão</Button><p className="text-xs text-muted-foreground">A liberação exige pagamento confirmado e correspondência de todos os produtos, quantidades, preços, frete, desconto e total. Corrija divergências em Pedidos antes de tentar.</p></div>}
          {order.reported_total != null && Number(order.reported_total) !== Number(order.total) && <p role="alert" className="text-sm text-destructive">Valor do canal {currency(order.reported_total)} diferente dos itens/frete/desconto. Confira a origem antes de criar a venda.</p>}
          {order.items.map(line => <div key={line.id} className="rounded-md border p-3 grid sm:grid-cols-2 gap-2"><div className="text-sm"><p>{line.quantity} × {line.description} · {currency(line.unit_price)}</p><p className="text-xs text-muted-foreground">SKU: {line.external_sku || "—"} · Anúncio: {line.external_item_id || "—"} · Variação: {line.external_variant_id || "—"}</p>{line.product_id && <p className="text-xs text-emerald-600">Vinculado: {catalog.data?.find(product => product.id === line.product_id)?.name ?? "produto do catálogo"}</p>}</div>
            {(!line.product_id || (catalog.isSuccess && !catalog.data.some(product => product.id === line.product_id))) && <div className="flex gap-2"><select aria-label={`Produto para ${line.description}`} className={selectClass} value={productSelections[line.id] ?? ""} onChange={e => setProductSelections(previous => ({ ...previous, [line.id]: e.target.value }))}><option value="">Vincular produto</option>{catalog.data?.map(product => <option key={product.id} value={product.id}>{product.sku ? `${product.sku} · ` : ""}{product.name}</option>)}</select><Button variant="outline" disabled={mutate.isPending || !productSelections[line.id]} onClick={() => mutate.mutate(async () => { await marketplaceRpc("save_marketplace_sku_binding", { p_account_id: account.id, p_external_item_id: line.external_item_id, p_external_variant_id: line.external_variant_id, p_external_sku: line.external_sku, p_product_id: productSelections[line.id] }); return "Vínculo salvo para esta conta e variação"; })}>Vincular</Button></div>}
          </div>)}
          <div className="flex flex-wrap gap-2">
            {(!order.internal_order_id || order.needs_review) && <Button disabled={mutate.isPending || !customerId || !paymentDate || order.normalized_state !== "paid" || !order.shipping_deadline_at || order.items.some(item => !item.product_id || !catalog.data?.some(product => product.id === item.product_id)) || (order.reported_total != null && Number(order.reported_total) !== Number(order.total))} onClick={() => mutate.mutate(async () => { const args = { p_marketplace_order_id: order.id, p_customer_id: customerId, p_payment_due_date: paymentDate, p_request_id: requestId(`create:${order.id}`, JSON.stringify([order.external_updated_at, order.shipping_deadline_at, order.items.map(item => [item.external_line_id, item.product_id, item.quantity, item.unit_price]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))), customerId, paymentDate])) }; await marketplaceRpc("create_sales_order_from_marketplace", args); return "Pedido em rascunho. Confira e organize a produção quando estiver pronto."; })}>{order.internal_order_id ? "Atualizar rascunho" : "Criar pedido em rascunho"}</Button>}
            {order.internal_order_id && (requiresManualReview ? <Button asChild variant="outline"><Link to={`/comercial/pedidos?pedido=${encodeURIComponent(order.internal_order_id)}`}>Conferir em Pedidos</Link></Button> : <><Button variant="outline" disabled={mutate.isPending || order.needs_review || order.normalized_state !== "paid" || manualReviewBindings.isLoading || manualReviewBindings.isFetching || !!manualReviewBindings.error} onClick={() => mutate.mutate(async () => { const result = await marketplaceRpc<{ outcome: string; issues: string[] }>("confirm_sales_workflow", { p_order_id: order.internal_order_id, p_order: null, p_items: null, p_request_id: requestId(`confirm:${order.id}`, String(order.internal_order_id)) }); delete requests.current[`confirm:${order.id}`]; return result.issues?.length ? result.issues.join(" · ") : result.outcome === "stock_ready" ? "Estoque separado para atender a venda" : result.outcome === "production_queued" ? "Produção organizada para o pedido" : "Pedido conferido"; })}>Organizar pedido</Button><Button asChild variant="ghost"><Link to={`/comercial/pedidos?pedido=${encodeURIComponent(order.internal_order_id)}`}>Abrir pedido</Link></Button></>)}
          </div>
        </article>; })}
        {!!inbox.data?.length && inbox.data.length === 100 && <p className="text-xs text-muted-foreground">Mostrando as últimas 100 importações desta conta.</p>}
      </section>
    </>}
  </div>;
}
