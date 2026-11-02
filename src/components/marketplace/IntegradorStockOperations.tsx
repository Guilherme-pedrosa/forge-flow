import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { SearchableItemSelect } from "@/components/shared/SearchableItemSelect";
import { allRows } from "@/lib/finance";
import { marketplaceDb } from "@/lib/marketplace-orders";
import { orderRequest } from "@/lib/sales-order";
import { integrationErrorMessage, readIntegradorStockPreview, syncIntegradorManual, takeoverIntegradorStock,
  type IntegradorBridgeBinding, type IntegradorManualPreview, type IntegradorManualReceipt } from "@/lib/mercado-livre-integration";

type ProductOption = { id: string; name: string; sku: string | null };
type Props = { binding: IntegradorBridgeBinding; tenantId: string; userId: string; accountId: string; sellerId: string;
  productOptions: ProductOption[]; accountNames?: { id: string; name: string }[]; catalogLoading?: boolean; catalogError?: string | null; onCatalogRetry?: () => void;
  initialProductId?: string | null; disabled?: boolean; onBusyChange?: (busy: boolean) => void; onOpenBindings?: () => void };
const issueLabels: Record<string, string> = {
  finished_availability_missing: "O saldo livre do produto no Forge ainda não foi confirmado.", finished_availability_stale: "Atualize a conferência do saldo livre no Forge.", finished_revision_missing: "A versão do saldo no Forge ainda não foi confirmada.",
  external_orders_incomplete: "A consulta dos pedidos externos ainda está incompleta.", paid_external_order_unbound: "Há pedido pago sem produto vinculado.", external_order_stock_coverage_unknown: "Confira quais unidades de pedidos pagos já estão reservadas ou baixadas no Forge.", external_order_stale: "Os pedidos externos precisam de nova consulta.", external_order_line_conflict: "Os dados de uma linha de pedido externo estão divergentes.", external_order_state_unknown: "A situação de um pedido externo precisa ser conferida.", unbound_external_order_conflict: "Há divergência em pedido externo sem produto vinculado.",
  remote_quantity_unknown_or_conflicting: "A quantidade informada pelo canal ainda precisa de conferência.", remote_snapshot_stale: "Atualize a consulta dos anúncios no canal.", remote_status_unknown: "A situação do anúncio ainda não foi confirmada.", warehouse_or_version_unconfirmed: "O local de estoque ou sua versão ainda não foi confirmado.", manual_or_moderation_pause_preserved: "Há anúncio pausado manualmente ou por moderação. Confira essa pausa antes de atualizar.", shared_stock_product_conflict: "Anúncios que compartilham estoque estão vinculados a produtos diferentes.",
  competing_owner_or_variation_requires_review: "Há outro responsável ou variação pendente nesses anúncios.", listing_binding_conflict: "O vínculo do anúncio com o produto precisa ser corrigido.", variations_require_complete_ownership: "Confira todas as variações antes de assumir o estoque do anúncio.", warehouse_owner_unconfirmed: "O responsável pelo local de estoque ainda não foi confirmado.", shared_user_product_has_unclaimed_listing: "O mesmo saldo é compartilhado com anúncio ainda não assumido pelo Forge.", legacy_physical_stock_group_has_other_owner: "Outro responsável controla anúncios ligados ao mesmo estoque anterior.",
  legacy_order_queue_requires_review: "Conclua ou revise a fila de processamento anterior do GC antes de assumir estes anúncios.", legacy_target_order_or_uncertain_sale_requires_review: "Há venda anterior ou processamento incerto no GC que precisa ser conferido.", remote_orders_changed_or_incomplete: "Os pedidos do canal mudaram ou estão incompletos. Faça uma nova conferência.", remote_orders_truncated: "Há pedidos externos além do limite desta consulta. A conferência precisa ser completada.",
  legacy_other_channel_stock_owner: "Este mesmo estoque ainda é anunciado na Amazon pelo Integrador. Resolva o responsável desse canal antes de assumir ou publicar pelo Forge.",
  accept_price_for_one_unit: "Confirme no Forge um preço de Mercado Livre para uma unidade deste produto.", currency_not_brl: "O anúncio usa outra moeda. Confira o preço antes de publicar.",
};
const integradorStockIssue = (issue: string) => issueLabels[issue] || issue;
const number = (value: number | null) => value == null ? "Pendente" : value.toLocaleString("pt-BR");
const money = (value: number | null) => value == null ? "Pendente" : value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function IntegradorStockOperations(props: Props) {
  return <StockAccountSession key={`${props.tenantId}:${props.userId}:${props.accountId}:${props.sellerId}:${props.binding.bridge_id}:${props.binding.revision}`} {...props} />;
}
function StockAccountSession({ binding, tenantId, userId, accountId, sellerId, productOptions, accountNames = [], catalogLoading = false, catalogError, onCatalogRetry, initialProductId, disabled = false, onBusyChange, onOpenBindings }: Props) {
  const alive = useRef(true), operation = useRef(0), controller = useRef<AbortController | null>(null), pending = useRef(false);
  const initialized = useRef(false), touched = useRef(false), takeoverRequest = useRef<{ signature: string; id: string } | null>(null);
  const [selected, setSelected] = useState<string[]>([]), [preview, setPreview] = useState<IntegradorManualPreview | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState("");
  const [uncertain, setUncertain] = useState(false), [takeoverRetry, setTakeoverRetry] = useState(false);
  const [acknowledge, setAcknowledge] = useState({ takeover: false, stock: false, price: false });
  const [receipt, setReceipt] = useState<IntegradorManualReceipt | null>(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; ++operation.current; controller.current?.abort(); }; }, []);
  useEffect(() => { onBusyChange?.(busy); return () => onBusyChange?.(false); }, [busy, onBusyChange]);
  const linked = useQuery({ queryKey: ["marketplace_sku_bindings", tenantId, accountId, "manual-operations-products"], enabled: !!tenantId && !!accountId,
    queryFn: async () => [...new Set((await allRows<{ product_id: string }>((from, to) => marketplaceDb.from("marketplace_sku_bindings").select("id,product_id").eq("tenant_id", tenantId).eq("account_id", accountId).order("id").range(from, to))).map(row => row.product_id))] });
  const options = productOptions.filter(product => linked.data?.includes(product.id));
  useEffect(() => {
    if (!linked.isSuccess || initialized.current || touched.current || catalogLoading || catalogError) return;
    const initial = initialProductId && options.some(product => product.id === initialProductId) ? initialProductId : options.length === 1 ? options[0].id : null;
    if (initial) { initialized.current = true; setSelected([initial]); }
  }, [linked.isSuccess, options, initialProductId, catalogLoading, catalogError]);
  const productName = (id: string) => productOptions.find(product => product.id === id)?.name || id;
  const accountName = (id: string) => accountNames.find(account => account.id === id)?.name || id;
  function selectProducts(ids: string[]) {
    touched.current = true; ++operation.current; controller.current?.abort(); setSelected(ids); setPreview(null); setReceipt(null); setError(""); setMessage(""); setTakeoverRetry(false); takeoverRequest.current = null; setAcknowledge({ takeover: false, stock: false, price: false });
  }
  const validSelection = selected.length > 0 && selected.every(id => options.some(product => product.id === id));
  const targetScopeConfirmed = !!preview?.targets.length && preview.targets.every(target => binding.approved_seller_ids.includes(target.seller_id) && binding.account_mappings.some(row => row.account_id === target.account_id && row.source_seller_id === target.seller_id && row.bridge_id === binding.bridge_id));
  const stockReady = !!preview && preview.complete && preview.preview.complete && targetScopeConfirmed && !preview.issues.length && !preview.preview.issues.length
    && preview.preview.products.length > 0 && preview.preview.buckets.length > 0 && preview.preview.products.every(product => product.complete && product.budget !== null) && preview.preview.buckets.every(bucket => !bucket.requiresReview && bucket.proposedQuantity !== null);
  const owns = !!preview?.claimed && preview.stock_owner === "forge";
  const missingPrices = preview?.targets.filter(target => !preview.prices.some(price => price.account_id === target.account_id && price.seller_id === target.seller_id && price.item_id === target.item_id && price.product_id === target.product_id)) ?? [];
  const priceReady = stockReady && missingPrices.length === 0 && !!preview?.prices.length && preview.prices.every(price => price.accepted_price != null && price.accepted_price > 0 && !!price.acceptance_id && !price.issue);
  const selection = { account_id: accountId, source_seller_id: sellerId, product_ids: [...selected].sort() };
  const active = (version: number) => alive.current && version === operation.current;
  async function run(kind: "preview" | "takeover" | "stock" | "price") {
    if (pending.current || disabled || !validSelection || linked.isFetching || linked.error || catalogLoading || catalogError) return;
    if (kind !== "preview" && (!preview || !stockReady || (kind === "stock" || kind === "price") && !owns || !acknowledge[kind] || kind === "price" && !priceReady)) return;
    pending.current = true; setBusy(true); setError(""); setMessage("");
    if (kind === "preview") { setPreview(null); setAcknowledge({ takeover: false, stock: false, price: false }); }
    if (kind === "stock" || kind === "price") setReceipt(null);
    const version = ++operation.current; controller.current?.abort(); controller.current = new AbortController();
    const context = { tenantId, userId, signal: controller.current.signal };
    try {
      if (kind === "preview") { const next = await readIntegradorStockPreview(binding, selection, context); if (!active(version)) return; setPreview(next); setTakeoverRetry(false); takeoverRequest.current = null; setAcknowledge({ takeover: false, stock: false, price: false }); return; }
      if (kind === "takeover") {
        takeoverRequest.current = orderRequest(takeoverRequest.current, JSON.stringify([selection, preview!.revision]));
        const next = await takeoverIntegradorStock(binding, selection, preview!.revision, takeoverRequest.current.id, context);
        if (!active(version)) return; setPreview(next); setTakeoverRetry(false); setAcknowledge({ takeover: false, stock: false, price: false }); setMessage("Controle do estoque confirmado no Forge. Confira os valores propostos antes de publicar no canal."); return;
      }
      // A new explicit confirmation is required for each marketplace write. An uncertain PUT is never retried here.
      const next = await syncIntegradorManual(binding, kind, selection, preview!.revision, crypto.randomUUID(), context);
      if (!active(version)) return;
      setReceipt(next); setPreview(null); setUncertain(false); setAcknowledge({ takeover: false, stock: false, price: false }); setMessage(kind === "stock" ? "Estoque confirmado no canal." : "Preços confirmados no canal.");
      try { const refreshed = await readIntegradorStockPreview(binding, selection, context); if (active(version)) setPreview(refreshed); }
      catch (failure) { if (active(version)) setError(`A atualização foi confirmada, mas a nova prévia precisa ser conferida. ${integrationErrorMessage(failure)}`); }
    } catch (failure) {
      if (!active(version)) return;
      setError(integrationErrorMessage(failure));
      if (kind === "stock" || kind === "price") { setUncertain(true); setPreview(null); setAcknowledge({ takeover: false, stock: false, price: false }); }
      if (kind === "takeover") setTakeoverRetry(true);
    } finally { pending.current = false; if (active(version)) setBusy(false); }
  }
  const locked = disabled || busy || linked.isFetching || !!linked.error || catalogLoading || !!catalogError, globalIssues = [...new Set([...(preview?.issues || []), ...(preview?.preview.issues || [])])];
  return <section aria-label="Operações manuais de estoque e preço" className="space-y-4 rounded-xl border bg-card p-4">
    <div><h2 className="font-semibold">Conferir estoque e preço no Mercado Livre</h2><p className="text-sm text-muted-foreground">Escolha produtos vinculados e confira todos os anúncios afetados. As quantidades vêm do saldo livre do Forge e os preços vêm dos aceites de Mercado Livre por unidade.</p><p className="text-xs text-muted-foreground">Prefira lotes pequenos para facilitar a conferência. Cada publicação exige sua confirmação.</p></div>
    {linked.error && <p role="alert" className="text-sm text-destructive">Não foi possível conferir os produtos vinculados. <Button type="button" variant="outline" onClick={() => void linked.refetch()}>Recarregar vínculos para conferência</Button></p>}
    {catalogError && <p role="alert" className="text-sm text-destructive">Não foi possível carregar o catálogo. {onCatalogRetry && <Button type="button" variant="outline" onClick={onCatalogRetry}>Recarregar catálogo</Button>}</p>}
    {!linked.isLoading && !linked.error && !catalogLoading && !options.length && <p className="text-sm">Vincule um anúncio a um produto do Forge para conferir o estoque e o preço.{onOpenBindings && <Button type="button" variant="link" onClick={onOpenBindings}>Abrir vínculos de anúncios</Button>}</p>}
    <SearchableItemSelect label="Produto vinculado para conferir" value="" emptyLabel="Escolher produto vinculado" disabled={locked || linked.isLoading || !!linked.error || catalogLoading || !!catalogError || selected.length >= 50} options={options.filter(product => !selected.includes(product.id)).map(product => ({ id: product.id, label: product.sku ? `${product.sku} · ${product.name}` : product.name }))} onChange={id => { if (id && !selected.includes(id)) selectProducts([...selected, id]); }} />
    {!!selected.length && <ul className="space-y-2 text-sm">{selected.map(id => <li key={id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2"><span>{productName(id)}</span><Button type="button" size="sm" variant="ghost" disabled={locked} onClick={() => selectProducts(selected.filter(product => product !== id))}>Remover {productName(id)}</Button></li>)}</ul>}
    <Button type="button" variant="outline" disabled={locked || !validSelection || linked.isFetching || catalogLoading || !!catalogError || !!linked.error} onClick={() => void run("preview")}>{busy ? "Conferindo operação…" : "Conferir prévia de estoque e preço"}</Button>
    {uncertain && <p role="alert" className="rounded-md border border-amber-400 p-3 text-sm">A última atualização tem resultado incerto. Confira os anúncios no canal e faça uma nova prévia antes de confirmar outra alteração. O envio anterior não será repetido automaticamente.</p>}
    {preview && <div className="space-y-4"><p className="text-sm font-medium">Responsável pelo estoque: {preview.stock_owner === "forge" ? "Forge" : "Integrador"} · {stockReady ? "Conferência completa" : "Conferência pendente"}</p>
      {!!globalIssues.length && <ul role="alert" className="list-disc space-y-1 pl-5 text-sm text-destructive">{globalIssues.map(issue => <li key={issue}>{integradorStockIssue(issue)}</li>)}</ul>}
      {!targetScopeConfirmed && <p role="alert" className="text-sm text-destructive">Confira a associação de todas as contas e anúncios envolvidos antes de publicar.</p>}
      {preview.preview.products.map(product => <article key={product.productId} aria-label={`Saldo de ${productName(product.productId)}`} className="space-y-2 rounded-lg border p-3"><h3 className="font-medium">{productName(product.productId)}</h3><dl className="grid gap-2 text-sm sm:grid-cols-2"><div><dt>Saldo livre no Forge</dt><dd>{number(product.available)}</dd></div><div><dt>Pedidos pagos ainda sem cobertura no Forge</dt><dd>{number(product.unaccountedPaidQuantity)}</dd></div><div><dt>Quantidade disponível para distribuir</dt><dd>{number(product.budget)}</dd></div><div><dt>Distribuição proposta</dt><dd>{number(product.allocatedQuantity)}</dd></div></dl>{product.issues.filter(issue => !globalIssues.includes(issue)).map(issue => <p key={issue} className="text-sm text-destructive">{integradorStockIssue(issue)}</p>)}</article>)}
      <div className="space-y-2"><h3 className="font-medium">Todos os anúncios afetados</h3>{preview.targets.map((target, index) => <p className="text-sm" key={`${target.account_id}:${target.item_id}:${index}`}>{productName(target.product_id)} · {accountName(target.account_id)} · vendedor {target.seller_id} · anúncio {target.item_id}</p>)}</div>
      {preview.preview.buckets.map(bucket => <article key={bucket.key} aria-label={`Proposta ${bucket.itemIds.join(", ")}`} className="space-y-2 rounded-lg border p-3 text-sm"><p className="font-medium">Anúncios {bucket.itemIds.join(", ")} · vendedor {bucket.sellerId}</p><p>Quantidade atual no canal: {number(bucket.currentQuantity)} · Proposta: {number(bucket.proposedQuantity)}</p>{bucket.itemIds.length > 1 && <p>Estes anúncios compartilham o mesmo saldo.</p>}{bucket.issues.filter(issue => !globalIssues.includes(issue)).map(issue => <p key={issue} className="text-destructive">{integradorStockIssue(issue)}</p>)}</article>)}
      <div className="space-y-2"><h3 className="font-medium">Preços aceitos por unidade no Forge</h3>{preview.prices.map((price, index) => <article className="rounded-lg border p-3 text-sm" key={`${price.account_id}:${price.item_id}:${index}`}><p>{productName(price.product_id)} · vendedor {price.seller_id} · anúncio {price.item_id}</p><p>Atual no canal: {money(price.current_price)} · Aceito no Forge: {money(price.accepted_price)}</p>{price.issue && <p className="text-destructive">{integradorStockIssue(price.issue)} <Link className="underline" to={`/comercial/produtos?produto=${encodeURIComponent(price.product_id)}&editar=1&aba=valores`}>Conferir preço no cadastro</Link></p>}</article>)}{missingPrices.map((price, index) => <p className="text-sm text-destructive" key={`missing:${price.account_id}:${price.item_id}:${index}`}>Preço pendente para {productName(price.product_id)} · anúncio {price.item_id}. <Link className="underline" to={`/comercial/produtos?produto=${encodeURIComponent(price.product_id)}&editar=1&aba=valores`}>Conferir preço no cadastro</Link></p>)}</div>
      {!owns ? <div className="space-y-2 rounded-lg border p-3"><label className="flex items-start gap-2 text-sm"><input type="checkbox" disabled={locked || !stockReady} checked={acknowledge.takeover} onChange={event => setAcknowledge(value => ({ ...value, takeover: event.target.checked }))} /><span>Quero que o Forge assuma o controle do estoque de todos os anúncios listados.</span></label><p className="text-xs text-muted-foreground">Esta etapa confirma o responsável e preserva o histórico. A publicação das quantidades acontece somente na próxima confirmação.</p><Button type="button" disabled={locked || !stockReady || !acknowledge.takeover} onClick={() => void run("takeover")}>{takeoverRetry ? "Confirmar controle destes anúncios" : "Assumir controle do estoque no Forge"}</Button></div>
        : <div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2 rounded-lg border p-3"><label className="flex items-start gap-2 text-sm"><input type="checkbox" disabled={locked || !stockReady} checked={acknowledge.stock} onChange={event => setAcknowledge(value => ({ ...value, stock: event.target.checked }))} /><span>Confirmo as quantidades propostas em todos os anúncios listados.</span></label><Button type="button" disabled={locked || !stockReady || !acknowledge.stock} onClick={() => void run("stock")}>Atualizar estoque no canal</Button></div><div className="space-y-2 rounded-lg border p-3"><label className="flex items-start gap-2 text-sm"><input type="checkbox" disabled={locked || !priceReady} checked={acknowledge.price} onChange={event => setAcknowledge(value => ({ ...value, price: event.target.checked }))} /><span>Confirmo a publicação dos preços aceitos no Forge para todos os anúncios listados.</span></label><Button type="button" disabled={locked || !priceReady || !acknowledge.price} onClick={() => void run("price")}>Atualizar preços no canal</Button></div></div>}
    </div>}
    {receipt && <section aria-label="Resultado confirmado no canal" className="space-y-2 rounded-lg border p-3 text-sm"><h3 className="font-medium">Última atualização confirmada</h3>{receipt.items.map((item, index) => <p key={`${item.seller_id}:${item.item_id}:${index}`}>Vendedor {item.seller_id} · anúncio {item.item_id} · {receipt.action === "stock" ? `quantidade ${number(item.quantity)}` : `preço ${money(item.price)}`} · {item.status === "confirmed" ? "confirmado" : item.status}</p>)}</section>}
    {message && <p role="status" className="text-sm">{message}</p>}{error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </section>;
}
