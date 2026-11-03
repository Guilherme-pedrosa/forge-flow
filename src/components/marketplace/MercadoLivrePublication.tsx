import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { marketplaceDb } from "@/lib/marketplace-orders";
import { integrationErrorMessage, publicListingUrl, type IntegradorBridgeBinding } from "@/lib/mercado-livre-integration";
import { prepareMercadoLivrePublication, publishMercadoLivreProduct, searchMercadoLivreCategories, type MercadoLivrePublication as Publication, type MercadoLivrePublicationDraft } from "@/lib/mercado-livre-workspace";
import { readMarketplaceAutomation } from "@/lib/marketplace-automation";
import { orderRequest } from "@/lib/sales-order";
import { MercadoLivrePublicationPricing, MercadoLivrePublicationProductFields } from "./MercadoLivrePublicationProductFields";

type Props = { binding: IntegradorBridgeBinding; accountId: string; sellerId: string; userId: string; tenantId: string };
type Category = { id: string; name: string; domain_name?: string | null };
const money = (value: number | null) => value == null ? "Pendente" : new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
const derived = (id: string) => ["SELLER_SKU", "MATERIAL"].includes(id) || id.startsWith("SELLER_PACKAGE_");
export function MercadoLivrePublication(props: Props) {
  return <PublicationForm key={`${props.tenantId}:${props.userId}:${props.accountId}:${props.sellerId}`} {...props} />;
}
function PublicationForm({ binding, accountId, sellerId, userId, tenantId }: Props) {
  const qc = useQueryClient();
  const catalog = useQuery({ queryKey: ["ml_publication_products", tenantId, userId], queryFn: async () => {
    const { data, error } = await marketplaceDb.from("products").select("id,name,sku").eq("tenant_id", tenantId).eq("is_active", true).eq("is_component", false).order("name").limit(1000);
    if (error) throw error; return data as { id: string; name: string; sku: string | null }[];
  }, retry: false });
  const policy = useQuery({ queryKey: ["ml_publication_defaults", tenantId, userId, accountId], queryFn: () => readMarketplaceAutomation(accountId), retry: false });
  const [productId, setProductId] = useState(""), [productSearch, setProductSearch] = useState("");
  const [draft, setDraft] = useState<MercadoLivrePublicationDraft>({ listing_type_id: "gold_special", attributes: [] });
  const [preview, setPreview] = useState<Publication | null>(null), [checkedSignature, setCheckedSignature] = useState("");
  const [categorySearch, setCategorySearch] = useState(""), [categories, setCategories] = useState<Category[]>([]);
  const [detailsDirty, setDetailsDirty] = useState(false), [detailsVersion, setDetailsVersion] = useState(0), [message, setMessage] = useState("");
  const currentProduct = useRef(productId); currentProduct.current = productId;
  const request = useRef<{ signature: string; id: string } | null>(null), alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const signature = JSON.stringify([productId, draft]);
  const prepare = useMutation({ mutationFn: (selection: { productId: string; draft: MercadoLivrePublicationDraft }) => prepareMercadoLivrePublication(binding, sellerId, accountId, selection.productId, selection.draft, { userId }),
    onSuccess: (result, selection) => { if (!alive.current || currentProduct.current !== selection.productId) return; setPreview(result); setCheckedSignature(JSON.stringify([selection.productId, selection.draft])); setCategories(previous => [...new Map<string, Category>([...previous, ...result.category_suggestions.map(item => ({ id: item.category_id!, name: item.category_name!, domain_name: item.domain_name })), ...(result.category ? [{ id: result.category.id!, name: result.category.name! }] : [])].map(item => [item.id, item] as const)).values()]); } });
  const search = useMutation({ mutationFn: () => searchMercadoLivreCategories(binding, sellerId, categorySearch.trim(), { userId }), onSuccess: result => { if (alive.current) setCategories(result.items.map(item => ({ id: item.id!, name: item.name!, domain_name: item.domain_name }))); } });
  const publish = useMutation({ mutationFn: async () => {
    if (!preview?.complete || checkedSignature !== signature || detailsDirty) throw new Error("Confira todos os dados da publicação antes de anunciar.");
    request.current = orderRequest(request.current, JSON.stringify([productId, draft, preview.revision]));
    return publishMercadoLivreProduct(binding, sellerId, accountId, productId, draft, preview.revision, request.current.id, { userId });
  }, onSuccess: async result => {
    if (!alive.current) return; request.current = null; setMessage(`Anúncio ${result.item_id} criado e vinculado ao produto do Forge.`);
    await qc.invalidateQueries({ queryKey: ["marketplace_sku_bindings", tenantId, accountId] });
  } });
  const busy = prepare.isPending || publish.isPending;
  const check = (next = draft, savedProduct = false) => { if (productId && !busy && (!detailsDirty || savedProduct)) prepare.mutate({ productId, draft: next }); };
  const selectProduct = (id: string) => {
    const next: MercadoLivrePublicationDraft = { listing_type_id: policy.data?.policy.listing_type_default || "gold_special", attributes: [] };
    setProductId(id); currentProduct.current = id; setDraft(next); setPreview(null); setCategories([]); setCheckedSignature(""); setDetailsDirty(false); setMessage(""); publish.reset(); prepare.reset();
    if (id) prepare.mutate({ productId: id, draft: next });
  };
  const updateAttribute = (id: string, value: string, official: boolean) => setDraft(previous => ({ ...previous, attributes: [...(previous.attributes || []).filter(attribute => attribute.id !== id), ...(value.trim() ? [{ id, [official ? "value_id" : "value_name"]: value }] : [])] }));
  const renderAttribute = (attribute: Publication["attributes"][number]) => {
    const selected = draft.attributes?.find(value => value.id === attribute.id), value = selected?.value_id || selected?.value_name || "";
    return <div key={attribute.id}><Label htmlFor={`ml-attribute-${attribute.id}`}>{attribute.name}{attribute.required ? " *" : ""}</Label>{attribute.values.length ? <select id={`ml-attribute-${attribute.id}`} className="h-11 w-full rounded-md border bg-background px-3 text-sm" disabled={busy} value={value} onChange={event => updateAttribute(attribute.id, event.target.value, true)}><option value="">Selecione</option>{attribute.values.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}</select> : <Input id={`ml-attribute-${attribute.id}`} maxLength={255} value={value} disabled={busy} onChange={event => updateAttribute(attribute.id, event.target.value, false)} />}</div>;
  };
  const officialFields = preview?.attributes.filter(attribute => !derived(attribute.id)) || [];
  const filteredProducts = catalog.data?.filter(product => `${product.name} ${product.sku || ""}`.toLocaleLowerCase().includes(productSearch.toLocaleLowerCase())) || [];
  const publishedLink = publish.data && publicListingUrl(publish.data.item.item.permalink);
  return <section aria-label="Publicar produto no Mercado Livre" className="space-y-5 rounded-xl border bg-card p-4"><div><h2 className="font-semibold">Anunciar um produto do Forge</h2><p className="text-sm text-muted-foreground">Escolha a peça, confira a categoria e complete aqui o que faltar para publicar.</p></div>
    <div className="grid gap-3 sm:grid-cols-2"><div><Label htmlFor="ml-product-search">Buscar produto</Label><Input id="ml-product-search" placeholder="Nome ou SKU" value={productSearch} disabled={busy || detailsDirty} onChange={event => setProductSearch(event.target.value)} /></div><div><Label htmlFor="ml-publication-product">Produto do catálogo</Label><select id="ml-publication-product" className="h-11 w-full rounded-md border bg-background px-3 text-sm" value={productId} disabled={busy || detailsDirty || catalog.isLoading} onChange={event => selectProduct(event.target.value)}><option value="">Selecione o produto</option>{filteredProducts.map(product => <option key={product.id} value={product.id}>{product.name}{product.sku ? ` · ${product.sku}` : ""}</option>)}</select></div></div>
    {catalog.error && <p role="alert">{integrationErrorMessage(catalog.error)}</p>}{prepare.isPending && <p role="status">Conferindo os dados da peça e as regras do Mercado Livre…</p>}
    {preview && <>
      <div className="grid gap-3 rounded-lg bg-muted/40 p-4 sm:grid-cols-3"><div><p className="text-xs text-muted-foreground">Produto</p><p className="font-medium">{preview.product.name}</p><p className="mt-1 break-all text-xs text-muted-foreground">SKU do anúncio: {preview.publication_sku}</p></div><div><p className="text-xs text-muted-foreground">Preço no Mercado Livre</p><p className="font-medium">{money(preview.price.unit_price)}</p></div><div><p className="text-xs text-muted-foreground">Estoque livre para publicar</p><p className="font-medium">{preview.stock.available ?? "Pendente"} unidade(s)</p></div></div>
      <details open={preview.missing.some(item => item.field.startsWith("product."))}><summary className="cursor-pointer text-sm font-medium">Descrição, fotos e medidas do produto</summary><div className="mt-3"><MercadoLivrePublicationProductFields key={`${preview.product_id}:${preview.forge_revision}:${detailsVersion}`} value={preview} accountId={accountId} disabled={busy} onDirtyChange={setDetailsDirty} onSaved={() => check(draft, true)} /></div></details>
      {detailsDirty && <div role="status" className="flex flex-wrap items-center gap-2 text-sm"><p>Salve os dados do produto antes de publicar ou trocar de peça.</p><Button variant="ghost" disabled={busy} onClick={() => { setDetailsVersion(previous => previous + 1); setDetailsDirty(false); }}>Descartar alterações do produto</Button></div>}
      <div className="space-y-3 rounded-lg border p-4"><h3 className="font-medium">Categoria e condições do anúncio</h3><div className="flex flex-wrap items-end gap-2"><div className="min-w-60 flex-1"><Label htmlFor="ml-category-search">Buscar categoria pelo nome da peça</Label><Input id="ml-category-search" value={categorySearch} disabled={busy || search.isPending} placeholder="Ex.: presépio decorativo" onChange={event => setCategorySearch(event.target.value)} /></div><Button variant="outline" disabled={busy || search.isPending || categorySearch.trim().length < 2} onClick={() => search.mutate()}>Buscar categoria</Button></div>
        <div><Label htmlFor="ml-publication-category">Categoria sugerida pelo Mercado Livre</Label><select id="ml-publication-category" className="h-11 w-full rounded-md border bg-background px-3 text-sm" value={draft.category_id || ""} disabled={busy || detailsDirty} onChange={event => { const next = { ...draft, category_id: event.target.value || undefined, category_confirmed: !!event.target.value, attributes: [] }; setDraft(next); check(next); }}><option value="">Escolha a categoria que descreve a peça</option>{categories.map(category => <option key={category.id} value={category.id}>{category.name}{category.domain_name ? ` · ${category.domain_name}` : ""}</option>)}</select></div>
        <div className="grid gap-3 sm:grid-cols-2"><div><Label htmlFor="ml-publication-type">Tipo de anúncio</Label><select id="ml-publication-type" className="h-11 w-full rounded-md border bg-background px-3 text-sm" disabled={busy} value={draft.listing_type_id || "gold_special"} onChange={event => setDraft({ ...draft, listing_type_id: event.target.value as "gold_special" | "gold_pro" })}><option value="gold_special">Clássico</option><option value="gold_pro">Premium</option></select></div><div><Label htmlFor="ml-publication-freight">Frete</Label><select id="ml-publication-freight" className="h-11 w-full rounded-md border bg-background px-3 text-sm" disabled={busy} value={draft.shipping ? draft.shipping.free_shipping ? "free" : "buyer" : ""} onChange={event => setDraft({ ...draft, shipping: event.target.value ? { mode: "me2", free_shipping: event.target.value === "free", local_pick_up: draft.shipping?.local_pick_up || false } : undefined })}><option value="">Confira quem paga o frete</option><option value="buyer">Mercado Envios · pago pelo comprador</option><option value="free">Mercado Envios · frete grátis ao comprador</option></select></div></div>
        {draft.shipping && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.shipping.local_pick_up} disabled={busy} onChange={event => setDraft({ ...draft, shipping: { ...draft.shipping!, local_pick_up: event.target.checked } })} />Permitir retirada no local</label>}
        {!!officialFields.length && <div className="space-y-3"><h4 className="text-sm font-medium">Ficha técnica exigida pelo canal</h4><div className="grid gap-3 sm:grid-cols-2">{officialFields.filter(attribute => attribute.required).map(renderAttribute)}</div>{officialFields.some(attribute => !attribute.required) && <details><summary className="cursor-pointer text-sm">Características opcionais</summary><div className="mt-3 grid gap-3 sm:grid-cols-2">{officialFields.filter(attribute => !attribute.required).map(renderAttribute)}</div></details>}</div>}
      </div>
      <details open={preview.missing.some(item => item.field === "price")}><summary className="cursor-pointer text-sm font-medium">Conferir custo, tarifas e preço de venda</summary><div className="mt-3"><MercadoLivrePublicationPricing key={preview.product_id} productId={preview.product_id} disabled={busy || detailsDirty} onSaved={() => check()} /></div></details>
      {(!!preview.missing.length || !!preview.issues.length) && <div className="space-y-2 rounded-lg border p-4"><h3 className="text-sm font-medium">Falta conferir</h3><ul className="list-disc space-y-1 pl-5 text-sm">{preview.missing.map((item, index) => <li key={`${item.field}:${index}`}>{item.message}</li>)}{preview.issues.map((issue, index) => <li key={index}>{issue}</li>)}</ul></div>}
      <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={busy || detailsDirty || !!publish.data} onClick={() => check()}>Conferir publicação</Button><Button disabled={busy || detailsDirty || !preview.complete || checkedSignature !== signature || !!publish.data} onClick={() => publish.mutate()}>{publish.isPending ? "Publicando…" : "Publicar anúncio no Mercado Livre"}</Button></div>
      {checkedSignature !== signature && <p className="text-sm text-muted-foreground">Confira a publicação para validar as alterações.</p>}
    </>}
    {(prepare.error || search.error || publish.error) && <p role="alert" className="text-sm text-destructive">{integrationErrorMessage(prepare.error || search.error || publish.error)}</p>}{message && <p role="status" className="text-sm font-medium">{message} {publishedLink && <a className="underline" href={publishedLink} target="_blank" rel="noreferrer">Abrir anúncio</a>}</p>}
  </section>;
}
