import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { orderRequest } from "@/lib/sales-order";
import { IntegradorConfigurationEditor } from "./IntegradorConfigurationEditor";
import type { MarketplaceAccount } from "@/lib/marketplace-orders";
import { fetchIntegradorListings, integrationErrorMessage, linkIntegradorMarketplaceAccount, listingIdentity, publicListingUrl, readIntegradorBridgeBinding, readIntegradorReadiness, revalidateIntegradorAccount,
  type IntegradorBridgeBinding, type IntegradorSourceAccount, type MarketplaceListingIdentity, type MercadoLivreListings, type MercadoLivreReadiness } from "@/lib/mercado-livre-integration";

type Props = { accounts: MarketplaceAccount[]; activeAccount?: MarketplaceAccount; disabled?: boolean;
  onAccountLinked: (id: string) => void | Promise<void>; onSelectListing: (identity: MarketplaceListingIdentity, sellerId: string) => void; onBusyChange?: (busy: boolean) => void };
const selectClass = "h-11 w-full rounded-md border bg-background px-3 text-sm";
const dateTime = (value: string | null) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString("pt-BR") : "Não informada";
const money = (value: number | null, currency: string | null) => value == null ? "Não informado" : new Intl.NumberFormat("pt-BR", { style: "currency", currency: /^[A-Z]{3}$/.test(currency ?? "") ? currency! : "BRL" }).format(value);

export function MercadoLivreSettings(props: Props) {
  const { profile, user } = useAuth();
  return <IntegratorSettings key={`${profile?.tenant_id}:${user?.id ?? profile?.user_id}`} {...props} />;
}
function IntegratorSettings(props: Props) {
  const { profile, user } = useAuth();
  const qc = useQueryClient();
  const userId = user?.id ?? profile?.user_id ?? "", tenantId = profile?.tenant_id ?? "";
  const [sellerId, setSellerId] = useState("");
  const [sourceBusy, setSourceBusy] = useState(false), [settingsBusy, setSettingsBusy] = useState(false);
  const onBusyChange = props.onBusyChange;
  useEffect(() => { onBusyChange?.(sourceBusy || settingsBusy); return () => onBusyChange?.(false); }, [sourceBusy, settingsBusy, onBusyChange]);
  const binding = useQuery({ queryKey: ["integrador_bridge_binding", tenantId, userId], enabled: !!tenantId,
    queryFn: readIntegradorBridgeBinding, retry: false });
  const readiness = useQuery({ queryKey: ["integrador_readiness", tenantId, userId, binding.data?.bridge_id, binding.data?.revision],
    enabled: !!tenantId && !!binding.data?.configured && binding.data.enabled,
    queryFn: ({ signal }) => readIntegradorReadiness(binding.data!, { userId, signal }), retry: false });
  const selected = readiness.data?.source_accounts.find(account => account.seller_id === sellerId);
  return <section aria-label="Integração Mercado Livre" className="space-y-4 rounded-xl border bg-card p-4">
    <div><h2 className="font-semibold">Mercado Livre · Integrador</h2><p className="text-sm text-muted-foreground">Use as contas autorizadas no Integrador e vincule seus anúncios aos produtos do Forge.</p></div>
    {binding.isLoading && <p role="status">Conferindo a conexão desta empresa…</p>}
    {binding.error && <p role="alert" className="text-sm text-destructive">Não foi possível conferir a conexão. {integrationErrorMessage(binding.error)} <Button variant="outline" onClick={() => void binding.refetch()}>Conferir conexão novamente</Button></p>}
    {binding.data && (!binding.data.configured || !binding.data.enabled) && <div className="space-y-2 text-sm"><p role="status">A conexão desta empresa com o Integrador ainda precisa de associação autorizada.</p><p>As contas locais e os pedidos importados continuam disponíveis abaixo.</p><Button variant="outline" onClick={() => void binding.refetch()}>Recarregar conexão com o Integrador</Button></div>}
    {readiness.isFetching && binding.data?.enabled && <p role="status">Consultando a configuração e as contas autorizadas…</p>}
    {readiness.error && <div role="alert" className="space-y-2 text-sm text-destructive"><p>{integrationErrorMessage(readiness.error)}</p><Button variant="outline" onClick={() => void readiness.refetch()}>Tentar consultar o Integrador novamente</Button></div>}
    {readiness.data && <>
      <AppConfiguration value={readiness.data} binding={binding.data!} userId={userId} onRefresh={() => void readiness.refetch()} busy={readiness.isFetching || !!props.disabled || sourceBusy || settingsBusy} onBusyChange={setSettingsBusy}
        onConfirmed={latest => qc.setQueryData(["integrador_readiness", tenantId, userId, binding.data?.bridge_id, binding.data?.revision], latest)} />
      <div className="space-y-2"><Label htmlFor="integrador-seller">Vendedor do Integrador</Label><select id="integrador-seller" className={selectClass} value={sellerId} disabled={props.disabled || readiness.isFetching || settingsBusy} onChange={event => setSellerId(event.target.value)}><option value="">Escolha o vendedor desta empresa</option>{readiness.data.source_accounts.map(account => <option key={account.seller_id} value={account.seller_id}>{account.nickname || "Vendedor"} · {account.seller_id}{account.credentials_configured ? " · autorização armazenada" : " · autorização pendente"}</option>)}</select>
        {!readiness.data.source_accounts.length && <p className="text-sm text-muted-foreground">Nenhum vendedor foi aprovado nesta conexão. Confira a associação da empresa antes de consultar anúncios.</p>}</div>
      {selected && binding.data && <SourceAccountOperations key={`${tenantId}:${userId}:${selected.seller_id}`} {...props} disabled={props.disabled || settingsBusy} onBusyChange={setSourceBusy} binding={binding.data} sourceAccount={selected} settingsReady={readiness.data.settings.configured} userId={userId} tenantId={tenantId} />}
    </>}
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
function SourceAccountOperations({ binding, sourceAccount, settingsReady, userId, tenantId, accounts, activeAccount, disabled = false, onAccountLinked, onSelectListing, onBusyChange }: Props & {
  binding: IntegradorBridgeBinding; sourceAccount: IntegradorSourceAccount; settingsReady: boolean; userId: string; tenantId: string;
}) {
  const qc = useQueryClient(), alive = useRef(true), controller = useRef<AbortController | null>(null);
  const request = useRef<{ signature: string; id: string } | null>(null);
  const [verified, setVerified] = useState<{ account: IntegradorSourceAccount; checkedAt: string } | null>(null);
  const [listings, setListings] = useState<MercadoLivreListings | null>(null);
  const [target, setTarget] = useState(""), [name, setName] = useState(sourceAccount.nickname || "");
  const [linkMessage, setLinkMessage] = useState("");
  useEffect(() => { alive.current = true; return () => { alive.current = false; controller.current?.abort(); }; }, []);
  type Operation = { kind: "verify" } | { kind: "list"; offset: number } | { kind: "link" };
  const operation = useMutation({ mutationFn: async (action: Operation) => {
    if (!alive.current) throw new Error("A conta selecionada mudou. Confira a seleção antes de continuar.");
    controller.current?.abort(); controller.current = new AbortController();
    const context = { userId, signal: controller.current.signal };
    if (action.kind === "verify") return { kind: "verify" as const, account: await revalidateIntegradorAccount(binding, sourceAccount.seller_id, context) };
    if (action.kind === "list") return { kind: "list" as const, page: await fetchIntegradorListings(binding, sourceAccount.seller_id, action.offset, context) };
    const existing = accounts.find(account => account.id === target && account.channel === "mercado_livre" && (!account.external_seller_id || account.external_seller_id === sourceAccount.seller_id));
    if (target !== "new" && !existing) throw new Error("Selecione uma conta válida do Forge para esta associação.");
    if (!name.trim()) throw new Error("Informe o nome da conta no Forge.");
    request.current = orderRequest(request.current, JSON.stringify([tenantId, userId, binding.revision, sourceAccount.seller_id, target, name.trim()]));
    const id = await linkIntegradorMarketplaceAccount(sourceAccount.seller_id, name.trim(), existing?.id ?? null, request.current.id);
    return { kind: "link" as const, id };
  }, onSuccess: async result => {
    if (!alive.current) return;
    if (result.kind === "verify") setVerified({ account: result.account, checkedAt: new Date().toISOString() });
    if (result.kind === "list") setListings(result.page);
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
  return <section aria-label={`Conta do Integrador ${sourceAccount.seller_id}`} className="space-y-4 rounded-lg border p-3">
    <div className="space-y-1 text-sm"><h3 className="font-semibold">{current.nickname || "Vendedor"} · {current.seller_id}</h3><p>{verified ? "Acesso conferido no Mercado Livre nesta sessão" : current.credentials_configured ? "Autorização armazenada no Integrador · acesso remoto ainda não conferido nesta sessão" : "Cadastro no Integrador · autorização pendente"}</p><p className="text-muted-foreground">Validade do acesso armazenado: {dateTime(current.expires_at)}</p>{verified && <p>Conferido em {dateTime(verified.checkedAt)}</p>}</div>
    <Button type="button" variant="outline" disabled={busy || !current.credentials_configured || !settingsReady} onClick={() => operation.mutate({ kind: "verify" })}>Conferir acesso desta conta</Button>
    <form className="space-y-3 border-t pt-3" onSubmit={event => { event.preventDefault(); if (!busy) operation.mutate({ kind: "link" }); }}><h3 className="text-sm font-medium">Associar vendedor a uma conta do Forge</h3><p className="text-xs text-muted-foreground">Vendedor selecionado: {current.seller_id}. Confira a conta de destino antes de salvar a associação.</p><div className="grid gap-3 sm:grid-cols-2"><div><Label htmlFor="integrador-forge-account">Conta de destino no Forge</Label><select id="integrador-forge-account" className={selectClass} disabled={busy} value={target} onChange={event => { setTarget(event.target.value); setLinkMessage(""); }}><option value="">Selecione a conta de destino</option><option value="new">Criar nova conta no Forge</option>{accounts.filter(account => account.channel === "mercado_livre" && (!account.external_seller_id || account.external_seller_id === current.seller_id)).map(account => <option key={account.id} value={account.id}>{account.name}{account.external_seller_id ? ` · ${account.external_seller_id}` : " · cadastro pendente"}</option>)}</select></div><div><Label htmlFor="integrador-forge-name">Nome da conta no Forge</Label><Input id="integrador-forge-name" value={name} maxLength={120} disabled={busy} onChange={event => { setName(event.target.value); setLinkMessage(""); }} /></div></div><Button type="submit" disabled={busy || !target || !name.trim()}>{target === "new" ? "Criar conta com este vendedor" : "Salvar associação do vendedor"}</Button>{linkMessage && <p role="status" className="text-sm">{linkMessage}</p>}</form>
    <section aria-label="Anúncios do Integrador" className="space-y-3 border-t pt-3"><div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-semibold">Anúncios deste vendedor</h3><Button type="button" disabled={busy || !current.credentials_configured || !settingsReady} onClick={() => operation.mutate({ kind: "list", offset: 0 })}>Consultar anúncios</Button></div>
      {listings && <><p className="text-sm text-muted-foreground">{listings.total} anúncio(s) no canal · página com {listings.items.length} resultado(s).</p>{!linked && <p className="text-sm">Selecione a conta correspondente no Forge ou salve a associação deste vendedor para vincular os produtos.</p>}{listings.items.map(item => {
        const url = publicListingUrl(item.permalink);
        return <article key={item.id} aria-label={`Anúncio ${item.id}`} className="space-y-2 rounded-lg border p-3 text-sm"><div className="flex flex-wrap justify-between gap-2"><div><p className="font-medium">{item.title}</p><p>{item.id} · Situação: {item.status}</p></div>{url && <a className="underline" href={url} target="_blank" rel="noreferrer">Abrir anúncio no canal</a>}</div><p>Preço informado no canal: {money(item.price, item.currency_id)} · Quantidade no canal: {item.available_quantity ?? "Não informada"}</p>
          {item.variations.length ? item.variations.map(variant => <div key={variant.id} className="space-y-2 rounded-md bg-muted/30 p-2"><p>Variação {variant.id}{variant.sku ? ` · SKU ${variant.sku}` : ""}{variant.attributes.length ? ` · ${variant.attributes.map(attribute => [attribute.name, attribute.value_name].filter(Boolean).join(": ")).join(" · ")}` : ""}</p><Button type="button" variant="outline" disabled={busy || !linked} onClick={() => onSelectListing(listingIdentity(item, variant), current.seller_id)}>Vincular variação {variant.id} a produto</Button></div>) : <Button type="button" variant="outline" disabled={busy || !linked} onClick={() => onSelectListing(listingIdentity(item), current.seller_id)}>Vincular anúncio a produto</Button>}
        </article>;
      })}{!listings.items.length && <p>Nenhum anúncio retornado nesta página.</p>}<div className="flex gap-2"><Button type="button" variant="outline" disabled={busy || listings.offset === 0} onClick={() => operation.mutate({ kind: "list", offset: Math.max(0, listings.offset - listings.limit) })}>Página anterior de anúncios</Button><Button type="button" variant="outline" disabled={busy || listings.next_offset == null} onClick={() => operation.mutate({ kind: "list", offset: listings.next_offset! })}>Próxima página de anúncios</Button></div></>}
    </section>
    {operation.isPending && <p role="status" className="text-sm">Concluindo a operação desta conta…</p>}
    {operation.error && <p role="alert" className="text-sm text-destructive">{integrationErrorMessage(operation.error)}</p>}
  </section>;
}
