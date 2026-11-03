import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { orderRequest } from "@/lib/sales-order";
import { IntegradorConfigurationEditor } from "./IntegradorConfigurationEditor";
import { IntegradorAccountConnection } from "./IntegradorAccountConnection";
import { MercadoLivreApiSetup } from "./MercadoLivreApiSetup";
import { MercadoLivreListingEditor } from "./MercadoLivreListingEditor";
import type { MarketplaceAccount } from "@/lib/marketplace-orders";
import { fetchIntegradorListings, integrationErrorMessage, linkIntegradorMarketplaceAccount, listingIdentity, publicListingUrl, readIntegradorBridgeBinding, readIntegradorReadiness, revalidateIntegradorAccount,
  type IntegradorBridgeBinding, type IntegradorSourceAccount, type MarketplaceListingIdentity, type MercadoLivreListings, type MercadoLivreReadiness } from "@/lib/mercado-livre-integration";

type Props = { accounts: MarketplaceAccount[]; activeAccount?: MarketplaceAccount; disabled?: boolean;
  onAccountLinked: (id: string) => void | Promise<void>; onSelectListing: (identity: MarketplaceListingIdentity, sellerId: string) => void; onBusyChange?: (busy: boolean) => void;
  enrollmentReceipt?: string | null; enrollmentError?: string | null; onEnrollmentReceiptConsumed?: () => void;
  workspaceView?: "anuncios" | "contas" | "hidden"; listingsFooter?: ReactNode; configurationFooter?: ReactNode; onOpenConfiguration?: () => void; onPublish?: () => void;
  listingPane?: "listings" | "stock"; onListingPaneChange?: (value: "listings" | "stock") => void; stockContent?: ReactNode };
const selectClass = "h-11 w-full rounded-md border bg-background px-3 text-sm";
const dateTime = (value: string | null) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString("pt-BR") : "Não informada";
const money = (value: number | null, currency: string | null) => value == null ? "Não informado" : new Intl.NumberFormat("pt-BR", { style: "currency", currency: /^[A-Z]{3}$/.test(currency ?? "") ? currency! : "BRL" }).format(value);
function SettingsPanel({ view, value, children }: { view: Props["workspaceView"]; value: "anuncios" | "contas"; children: ReactNode }) {
  return view ? <section hidden={view !== value} aria-label={value === "anuncios" ? "Anúncios do Mercado Livre" : "Contas do Mercado Livre"} className="space-y-4">{children}</section> : <>{children}</>;
}

export function MercadoLivreSettings(props: Props) {
  const { profile, user } = useAuth();
  return <IntegratorSettings key={`${profile?.tenant_id}:${user?.id ?? profile?.user_id}`} {...props} />;
}
function IntegratorSettings(props: Props) {
  const { profile, user } = useAuth();
  const qc = useQueryClient();
  const userId = user?.id ?? profile?.user_id ?? "", tenantId = profile?.tenant_id ?? "";
  const alive = useRef(true); useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const [sellerId, setSellerId] = useState("");
  const [accountTarget, setAccountTarget] = useState<HTMLDivElement | null>(null);
  const sellerTouched = useRef(false);
  const [sourceBusy, setSourceBusy] = useState(false), [settingsBusy, setSettingsBusy] = useState(false), [connectionBusy, setConnectionBusy] = useState(false), [appBusy, setAppBusy] = useState(false);
  const onBusyChange = props.onBusyChange;
  useEffect(() => { onBusyChange?.(sourceBusy || settingsBusy || connectionBusy || appBusy); return () => onBusyChange?.(false); }, [sourceBusy, settingsBusy, connectionBusy, appBusy, onBusyChange]);
  const binding = useQuery({ queryKey: ["integrador_bridge_binding", tenantId, userId], enabled: !!tenantId,
    queryFn: readIntegradorBridgeBinding, retry: false });
  const readiness = useQuery({ queryKey: ["integrador_readiness", tenantId, userId, binding.data?.bridge_id, binding.data?.revision],
    enabled: !!tenantId && !!binding.data?.configured && binding.data.enabled,
    queryFn: ({ signal }) => readIntegradorReadiness(binding.data!, { userId, signal }), retry: false });
  const selected = readiness.data?.source_accounts.find(account => account.seller_id === sellerId);
  const ownAppReady = readiness.data?.enrollment_app?.configured === true && readiness.data.enrollment?.configured === true;
  const activeMapping = binding.data?.configured && binding.data.enabled && props.activeAccount?.channel === "mercado_livre"
    ? binding.data.account_mappings.find(mapping => mapping.account_id === props.activeAccount.id && mapping.bridge_id === binding.data.bridge_id && mapping.source_seller_id === props.activeAccount.external_seller_id && binding.data.approved_seller_ids.includes(mapping.source_seller_id)) : null;
  const activeSourceAccount = readiness.data?.source_accounts.find(account => account.seller_id === activeMapping?.source_seller_id);
  const connectedAccount = ownAppReady && activeSourceAccount?.credentials_configured ? { seller_id: activeSourceAccount.seller_id, nickname: activeSourceAccount.nickname } : null;
  useEffect(() => {
    if (sellerTouched.current || !binding.data?.configured || !binding.data.enabled || !readiness.data) return;
    const approved = readiness.data.source_accounts.filter(account => binding.data.approved_seller_ids.includes(account.seller_id));
    const unique = approved.length === 1 && (!props.workspaceView || !props.activeAccount?.external_seller_id || props.activeAccount.external_seller_id === approved[0].seller_id) ? approved[0].seller_id : "";
    const next = activeSourceAccount?.seller_id || unique;
    if (next !== sellerId && (next || props.workspaceView)) setSellerId(next);
  }, [activeSourceAccount, binding.data, readiness.data, sellerId, props.workspaceView, props.activeAccount?.external_seller_id]);
  const sellerPicker = readiness.data && !!readiness.data.source_accounts.length && <div className="space-y-2"><Label htmlFor="integrador-seller">Vendedor do Integrador</Label><select id="integrador-seller" className={selectClass} value={sellerId} disabled={props.disabled || readiness.isFetching || settingsBusy || connectionBusy || appBusy} onChange={event => { sellerTouched.current = true; setSellerId(event.target.value); }}><option value="">Escolha o vendedor desta empresa</option>{readiness.data.source_accounts.map(account => <option key={account.seller_id} value={account.seller_id}>{account.nickname || "Vendedor"} · {account.seller_id}{account.credentials_configured ? " · autorização armazenada" : " · autorização pendente"}</option>)}</select></div>;
  return <section aria-label="Integração Mercado Livre" className={props.workspaceView ? "contents" : "space-y-4 rounded-xl border bg-card p-4"}>
    <SettingsPanel view={props.workspaceView} value="contas">
    <div><h2 className="font-semibold">Mercado Livre</h2><p className="text-sm text-muted-foreground">Conecte a conta da Elevare3D para conferir seus anúncios, produtos e pedidos no Forge.</p></div>
    {binding.isLoading && <p role="status">Conferindo a conexão desta empresa…</p>}
    {binding.error && <p role="alert" className="text-sm text-destructive">Não foi possível conferir a conexão. {integrationErrorMessage(binding.error)} <Button variant="outline" onClick={() => void binding.refetch()}>Conferir conexão novamente</Button></p>}
    {binding.data && (!binding.data.configured || !binding.data.enabled) && <div className="space-y-2 text-sm"><p role="status">A conexão desta empresa com o Integrador ainda precisa de associação autorizada.</p><p>As contas locais e os pedidos importados continuam disponíveis abaixo.</p><Button variant="outline" onClick={() => void binding.refetch()}>Recarregar conexão com o Integrador</Button></div>}
    {readiness.isFetching && binding.data?.enabled && <p role="status">Consultando a configuração e as contas autorizadas…</p>}
    {readiness.error && <div role="alert" className="space-y-2 text-sm text-destructive"><p>{integrationErrorMessage(readiness.error)}</p><Button variant="outline" onClick={() => void readiness.refetch()}>Tentar consultar o Integrador novamente</Button></div>}
    {binding.data?.configured && binding.data.enabled && binding.data.allow_enrollment && <>
      <MercadoLivreApiSetup key={`api:${tenantId}:${userId}:${binding.data.bridge_id}`} binding={binding.data} tenantId={tenantId} userId={userId} value={readiness.data?.enrollment_app ?? null}
        disabled={props.disabled || sourceBusy || settingsBusy || connectionBusy || readiness.isFetching} onBusyChange={setAppBusy}
        onConfirmed={latest => { if (alive.current) qc.setQueryData(["integrador_readiness", tenantId, userId, binding.data?.bridge_id, binding.data?.revision], latest); }} />
      <IntegradorAccountConnection key={`${tenantId}:${userId}:${binding.data.bridge_id}`} binding={binding.data} tenantId={tenantId} userId={userId} accounts={props.accounts}
        connectedAccount={connectedAccount}
        allowed={readiness.data?.enrollment?.allowed ?? null} configured={ownAppReady} expectedClientId={readiness.data?.enrollment_app?.client_id ?? null} callbackReceipt={props.enrollmentReceipt} callbackError={props.enrollmentError} onReceiptConsumed={props.onEnrollmentReceiptConsumed}
        disabled={props.disabled || sourceBusy || settingsBusy || appBusy || readiness.isFetching} onBusyChange={setConnectionBusy}
        onConnected={async result => {
          if (!alive.current) return; await qc.invalidateQueries({ queryKey: ["marketplace_accounts", tenantId] });
          if (!alive.current) return; await qc.invalidateQueries({ queryKey: ["integrador_bridge_binding", tenantId, userId] });
          if (!alive.current) return; setSellerId(result.seller_id); await props.onAccountLinked(result.account_id);
        }} /></>}
    {readiness.data && !binding.data?.allow_enrollment && <AppConfiguration value={readiness.data} binding={binding.data!} userId={userId} onRefresh={() => void readiness.refetch()} busy={readiness.isFetching || !!props.disabled || sourceBusy || settingsBusy || connectionBusy || appBusy} onBusyChange={setSettingsBusy}
        onConfirmed={latest => qc.setQueryData(["integrador_readiness", tenantId, userId, binding.data?.bridge_id, binding.data?.revision], latest)} />}
    {props.workspaceView && !activeMapping && (readiness.data?.source_accounts.length ?? 0) > 1 && sellerPicker}
    {props.workspaceView && <div ref={setAccountTarget} />}
    {props.configurationFooter}
    </SettingsPanel>
    <SettingsPanel view={props.workspaceView} value="anuncios">
      {props.workspaceView && <div className="flex flex-wrap gap-2"><Button type="button" variant={props.listingPane !== "stock" ? "default" : "outline"} onClick={() => props.onListingPaneChange?.("listings")}>Gerenciar anúncios</Button><Button type="button" variant={props.listingPane === "stock" ? "default" : "outline"} onClick={() => props.onListingPaneChange?.("stock")}>Estoque e preços</Button></div>}
      <div hidden={props.listingPane === "stock"} className="space-y-4">
      {!props.workspaceView && sellerPicker}
      {props.workspaceView && readiness.isFetching && <p role="status">Carregando sua conta Mercado Livre…</p>}
      {props.workspaceView && readiness.error && <p role="alert">{integrationErrorMessage(readiness.error)} <Button type="button" variant="outline" onClick={() => void readiness.refetch()}>Conferir acesso novamente</Button></p>}
      {readiness.data && <>
      {!readiness.data.source_accounts.length && <p className="text-sm text-muted-foreground">Nenhuma conta Mercado Livre foi conectada a esta empresa. As contas de outros vendedores não são associadas automaticamente.</p>}
      {selected && binding.data && <SourceAccountOperations key={`${tenantId}:${userId}:${selected.seller_id}`} {...props} accountTarget={props.workspaceView ? accountTarget : null} disabled={props.disabled || settingsBusy || connectionBusy || appBusy} onBusyChange={setSourceBusy} binding={binding.data} sourceAccount={selected} settingsReady={binding.data.allow_enrollment ? ownAppReady : readiness.data.settings.configured} userId={userId} tenantId={tenantId} />}
    </>}
    {props.workspaceView && !selected && !readiness.isFetching && <Button type="button" variant="outline" onClick={props.onOpenConfiguration}>Configurar conexão do Mercado Livre</Button>}
    {props.listingsFooter}
      </div>
      {props.workspaceView && <div hidden={props.listingPane !== "stock"}>{props.stockContent}</div>}
    </SettingsPanel>
  </section>;
}
function AppConfiguration({ value, binding, userId, onRefresh, busy, onConfirmed, onBusyChange }: { value: MercadoLivreReadiness; binding: IntegradorBridgeBinding; userId: string; onRefresh: () => void; busy: boolean; onConfirmed: (value: MercadoLivreReadiness) => void; onBusyChange: (busy: boolean) => void }) {
  return <details className="rounded-lg border p-3"><summary className="cursor-pointer text-sm font-medium">Configuração do aplicativo · {value.settings.configured ? "disponível no Integrador" : "a conferir"}</summary><div className="mt-3 space-y-3 text-sm">
    <dl className="grid gap-x-3 gap-y-2 sm:grid-cols-[12rem_minmax(0,1fr)]"><dt>Client ID</dt><dd className="break-all">{value.settings.client_id || "Não informado"}</dd><dt>Segredo do aplicativo</dt><dd>{value.settings.client_secret_configured ? "Configurado no servidor" : "Não configurado"}</dd><dt>Endereço de retorno</dt><dd className="break-all">{value.settings.redirect_uri || "Não informado"}</dd></dl>
    <p className="text-xs text-muted-foreground">As credenciais e a renovação das contas são gerenciadas pelo Integrador conectado.</p>
    <dl className="grid gap-x-3 gap-y-2 sm:grid-cols-[12rem_minmax(0,1fr)]"><dt>Rotinas existentes</dt><dd>{value.settings.enabled == null ? "Não informado" : value.settings.enabled ? "Habilitadas" : "Desabilitadas"}</dd><dt>Acréscimo do Integrador</dt><dd>{value.settings.markup_percent == null ? "Não informado" : `${value.settings.markup_percent}%`}</dd><dt>Reserva de estoque</dt><dd>{value.settings.stock_safety ?? "Não informada"}</dd><dt>Tipo padrão de anúncio</dt><dd>{value.settings.listing_type_default === "gold_pro" ? "Premium" : value.settings.listing_type_default === "gold_special" ? "Clássico" : "Não informado"}</dd><dt>Tabela de preços</dt><dd>{value.settings.tipo_valor_venda || "Não informada"}</dd></dl>
    {value.settings.full_scope && !value.settings.read_only && (value.settings.can_manage_settings || value.settings.can_manage_app)
      ? <IntegradorConfigurationEditor binding={binding} value={value.settings} userId={userId} hasConnectedAccounts={value.source_accounts.some(account => account.credentials_configured)} disabled={busy} onConfirmed={onConfirmed} onBusyChange={onBusyChange} />
      : <p className="text-xs text-muted-foreground">Esta conexão permite consultar a configuração. A edição depende do escopo completo e da permissão de responsável.</p>}
    {value.source_jobs?.pending_stock_jobs != null && <p>Tarefas de estoque pendentes no Integrador: {value.source_jobs.pending_stock_jobs}</p>}
    {value.source_jobs?.running_stock_jobs != null && <p>Tarefas de estoque em execução: {value.source_jobs.running_stock_jobs}</p>}
    <Button type="button" variant="outline" disabled={busy} onClick={onRefresh}>Conferir configuração</Button>
  </div></details>;
}
function SourceAccountOperations({ binding, sourceAccount, settingsReady, userId, tenantId, accounts, activeAccount, disabled = false, onAccountLinked, onSelectListing, onBusyChange, workspaceView, accountTarget, onPublish }: Props & {
  binding: IntegradorBridgeBinding; sourceAccount: IntegradorSourceAccount; settingsReady: boolean; userId: string; tenantId: string; accountTarget?: HTMLDivElement | null;
}) {
  const qc = useQueryClient(), alive = useRef(true), controller = useRef<AbortController | null>(null);
  const request = useRef<{ signature: string; id: string } | null>(null);
  const [verified, setVerified] = useState<{ account: IntegradorSourceAccount; checkedAt: string } | null>(null);
  const [listings, setListings] = useState<MercadoLivreListings | null>(null);
  const [query, setQuery] = useState(""), [status, setStatus] = useState("");
  const [applied, setApplied] = useState<{ q?: string; status?: string }>({}), [editingItem, setEditingItem] = useState<string | null>(null);
  const [target, setTarget] = useState(""), [name, setName] = useState(sourceAccount.nickname || "");
  const [linkMessage, setLinkMessage] = useState("");
  useEffect(() => { alive.current = true; return () => { alive.current = false; controller.current?.abort(); }; }, []);
  type Operation = { kind: "verify" } | { kind: "list"; offset: number; filters?: { q?: string; status?: string } } | { kind: "link" };
  const operation = useMutation({ mutationFn: async (action: Operation) => {
    if (!alive.current) throw new Error("A conta selecionada mudou. Confira a seleção antes de continuar.");
    controller.current?.abort(); controller.current = new AbortController();
    const context = { userId, signal: controller.current.signal };
    if (action.kind === "verify") return { kind: "verify" as const, account: await revalidateIntegradorAccount(binding, sourceAccount.seller_id, context) };
    if (action.kind === "list") { const filters = action.filters ?? applied; return { kind: "list" as const, page: await fetchIntegradorListings(binding, sourceAccount.seller_id, action.offset, context, filters), filters }; }
    const existing = accounts.find(account => account.id === target && account.channel === "mercado_livre" && (!account.external_seller_id || account.external_seller_id === sourceAccount.seller_id));
    if (target !== "new" && !existing) throw new Error("Selecione uma conta válida do Forge para esta associação.");
    if (!name.trim()) throw new Error("Informe o nome da conta no Forge.");
    request.current = orderRequest(request.current, JSON.stringify([tenantId, userId, binding.revision, sourceAccount.seller_id, target, name.trim()]));
    const id = await linkIntegradorMarketplaceAccount(sourceAccount.seller_id, name.trim(), existing?.id ?? null, request.current.id);
    return { kind: "link" as const, id };
  }, onSuccess: async result => {
    if (!alive.current) return;
    if (result.kind === "verify") setVerified({ account: result.account, checkedAt: new Date().toISOString() });
    if (result.kind === "list") { setListings(result.page); setApplied(result.filters); }
    if (result.kind === "link") {
      await qc.invalidateQueries({ queryKey: ["marketplace_accounts", tenantId] });
      if (!alive.current) return;
      await qc.invalidateQueries({ queryKey: ["integrador_bridge_binding", tenantId, userId] });
      if (!alive.current) return;
      await onAccountLinked(result.id);
      if (alive.current) setLinkMessage("Conta associada ao vendedor do Integrador. Escolha os anúncios para vincular aos produtos.");
    }
  } });
  useEffect(() => { onBusyChange?.(operation.isPending); return () => onBusyChange?.(false); }, [operation.isPending, onBusyChange]);
  const busy = disabled || operation.isPending;
  const linked = activeAccount?.channel === "mercado_livre" && activeAccount.external_seller_id === sourceAccount.seller_id
    && binding.account_mappings.some(mapping => mapping.account_id === activeAccount.id && mapping.source_seller_id === sourceAccount.seller_id && mapping.bridge_id === binding.bridge_id);
  const current = verified?.account ?? sourceAccount;
  const filters = { ...(query.trim() ? { q: query.trim() } : {}), ...(status ? { status } : {}) };
  const filtersChanged = JSON.stringify(filters) !== JSON.stringify(applied);
  const startOperation = operation.mutate, listPending = operation.isPending, listFailed = operation.isError;
  useEffect(() => {
    if (workspaceView === "anuncios" && !disabled && !listings && !listPending && !listFailed && current.credentials_configured && settingsReady) startOperation({ kind: "list", offset: 0 });
  }, [workspaceView, disabled, listings, listPending, listFailed, startOperation, current.credentials_configured, settingsReady]);
  const accountPanel = <div className="space-y-4 rounded-lg border p-3">
    <div className="space-y-1 text-sm"><h3 className="font-semibold">{current.nickname || "Vendedor"} · {current.seller_id}</h3><p>{verified ? "Acesso conferido no Mercado Livre nesta sessão" : current.credentials_configured ? "Autorização armazenada no Integrador · acesso remoto ainda não conferido nesta sessão" : "Cadastro no Integrador · autorização pendente"}</p><p className="text-muted-foreground">Validade do acesso armazenado: {dateTime(current.expires_at)}</p>{verified && <p>Conferido em {dateTime(verified.checkedAt)}</p>}</div>
    <Button type="button" variant="outline" disabled={busy || !current.credentials_configured || !settingsReady} onClick={() => operation.mutate({ kind: "verify" })}>Conferir acesso desta conta</Button>
    {!linked && <form className="space-y-3 border-t pt-3" onSubmit={event => { event.preventDefault(); if (!busy) operation.mutate({ kind: "link" }); }}><h3 className="text-sm font-medium">Associar vendedor a uma conta do Forge</h3><p className="text-xs text-muted-foreground">Vendedor selecionado: {current.seller_id}. Confira a conta de destino antes de salvar a associação.</p><div className="grid gap-3 sm:grid-cols-2"><div><Label htmlFor="integrador-forge-account">Conta de destino no Forge</Label><select id="integrador-forge-account" className={selectClass} disabled={busy} value={target} onChange={event => { setTarget(event.target.value); setLinkMessage(""); }}><option value="">Selecione a conta de destino</option><option value="new">Criar nova conta no Forge</option>{accounts.filter(account => account.channel === "mercado_livre" && (!account.external_seller_id || account.external_seller_id === current.seller_id)).map(account => <option key={account.id} value={account.id}>{account.name}{account.external_seller_id ? ` · ${account.external_seller_id}` : " · cadastro pendente"}</option>)}</select></div><div><Label htmlFor="integrador-forge-name">Nome da conta no Forge</Label><Input id="integrador-forge-name" value={name} maxLength={120} disabled={busy} onChange={event => { setName(event.target.value); setLinkMessage(""); }} /></div></div><Button type="submit" disabled={busy || !target || !name.trim()}>{target === "new" ? "Criar conta com este vendedor" : "Salvar associação do vendedor"}</Button>{linkMessage && <p role="status" className="text-sm">{linkMessage}</p>}</form>}

    {operation.variables?.kind !== "list" && operation.error && <p role="alert" className="text-sm text-destructive">{integrationErrorMessage(operation.error)}</p>}
  </div>;
  const statusLabel: Record<string, string> = { active: "Ativo", paused: "Pausado", under_review: "Em análise", closed: "Encerrado" };
  return <section aria-label={`Conta do Integrador ${sourceAccount.seller_id}`} className="space-y-4">
    {workspaceView && accountTarget ? createPortal(accountPanel, accountTarget) : accountPanel}
    <section aria-label="Anúncios do Integrador" className="space-y-4 rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold">Anúncios</h2><p className="text-sm text-muted-foreground">Consulte, edite e vincule os anúncios desta conta aos produtos do Forge.</p></div><div className="flex flex-wrap gap-2">{onPublish && <Button type="button" disabled={busy || !current.credentials_configured || !settingsReady} onClick={onPublish}>Publicar novo anúncio</Button>}<Button type="button" variant="outline" disabled={busy || !current.credentials_configured || !settingsReady} onClick={() => operation.mutate({ kind: "list", offset: 0, filters })}>Consultar anúncios</Button></div></div>
      <form className="flex flex-wrap items-end gap-3" aria-label="Pesquisar anúncios no Mercado Livre" onSubmit={event => { event.preventDefault(); if (!busy) operation.mutate({ kind: "list", offset: 0, filters }); }}>
        <div className="min-w-48 flex-1"><Label htmlFor="marketplace-listing-query">Pesquisar anúncios</Label><Input id="marketplace-listing-query" value={query} maxLength={120} disabled={busy} placeholder="Nome ou termo do anúncio" onChange={event => setQuery(event.target.value)} /></div>
        <div><Label htmlFor="marketplace-listing-status">Situação do anúncio</Label><select id="marketplace-listing-status" className={selectClass} value={status} disabled={busy} onChange={event => setStatus(event.target.value)}><option value="">Todas</option>{Object.entries(statusLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
        <Button type="submit" disabled={busy || !current.credentials_configured || !settingsReady}>Buscar anúncios</Button>
      </form>
      {operation.isPending && operation.variables?.kind === "list" && <p role="status" className="text-sm">Consultando anúncios no Mercado Livre…</p>}
      {operation.variables?.kind === "list" && operation.error && <p role="alert" className="text-sm text-destructive">{integrationErrorMessage(operation.error)}</p>}
      {listings ? <>
        <p className="text-sm text-muted-foreground">{listings.total} anúncio(s) encontrados · {listings.items.length} nesta página.</p>
        {!linked && <p className="text-sm">Associe esta conta do Forge ao vendedor em Contas ML para vincular os anúncios aos produtos.</p>}
        <div className="overflow-x-auto"><table className="w-full text-left text-sm" aria-label="Anúncios do Mercado Livre"><thead><tr className="border-b"><th className="px-2 py-3 font-medium">Anúncio</th><th className="px-2 py-3 font-medium">Situação</th><th className="px-2 py-3 font-medium">Preço no canal</th><th className="px-2 py-3 font-medium">Estoque no canal</th><th className="px-2 py-3 font-medium">Ações</th></tr></thead><tbody>{listings.items.map(item => {
          const url = publicListingUrl(item.permalink);
          return <tr key={item.id} aria-label={`Anúncio ${item.id}`} className="border-b align-top"><td className="min-w-52 px-2 py-3"><p className="font-medium">{item.title}</p><p className="text-xs text-muted-foreground">{item.id}</p>{url && <a className="text-xs underline" href={url} target="_blank" rel="noreferrer">Abrir no Mercado Livre</a>}</td><td className="px-2 py-3">{statusLabel[item.status] || item.status}</td><td className="whitespace-nowrap px-2 py-3">{money(item.price, item.currency_id)}</td><td className="px-2 py-3">{item.available_quantity ?? "Não informado"}</td><td className="min-w-48 space-y-2 px-2 py-3"><Button type="button" size="sm" variant="outline" aria-label={`Editar anúncio ${item.id}`} disabled={busy} onClick={() => setEditingItem(item.id)}>Editar anúncio</Button>
            {item.variations.length ? <details><summary className="cursor-pointer text-xs font-medium">Vincular variações ({item.variations.length})</summary><div className="mt-2 space-y-2">{item.variations.map(variant => <div key={variant.id}><p className="text-xs">Variação {variant.id}{variant.sku ? ` · SKU ${variant.sku}` : ""}{variant.attributes.length ? ` · ${variant.attributes.map(attribute => [attribute.name, attribute.value_name].filter(Boolean).join(": ")).join(" · ")}` : ""}</p><Button type="button" size="sm" variant="outline" disabled={busy || !linked} onClick={() => onSelectListing(listingIdentity(item, variant), current.seller_id)}>Vincular variação {variant.id} a produto</Button></div>)}</div></details> : <Button type="button" size="sm" variant="outline" disabled={busy || !linked} onClick={() => onSelectListing(listingIdentity(item), current.seller_id)}>Vincular anúncio a produto</Button>}
          </td></tr>;
        })}</tbody></table></div>
        {!listings.items.length && <p className="text-sm">Nenhum anúncio encontrado para esta consulta.</p>}
        {filtersChanged && <p className="text-xs text-muted-foreground">Clique em Buscar anúncios para aplicar os filtros alterados.</p>}
        <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" disabled={busy || filtersChanged || listings.offset === 0} onClick={() => operation.mutate({ kind: "list", offset: Math.max(0, listings.offset - listings.limit) })}>Página anterior de anúncios</Button><Button type="button" variant="outline" disabled={busy || filtersChanged || listings.next_offset == null} onClick={() => operation.mutate({ kind: "list", offset: listings.next_offset! })}>Próxima página de anúncios</Button></div>
      </> : !operation.isPending && <p className="text-sm text-muted-foreground">Os anúncios serão carregados para conferência nesta área.</p>}
    </section>
    {editingItem && <MercadoLivreListingEditor binding={binding} sellerId={current.seller_id} itemId={editingItem} userId={userId} onClose={() => setEditingItem(null)} onChanged={() => operation.mutateAsync({ kind: "list", offset: listings?.offset ?? 0 }).then(() => undefined)} />}
  </section>;
}
