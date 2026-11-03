import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ExternalLink, RefreshCw, Store } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { marketplaceDb as db, marketplaceRpc as rpc } from "@/lib/marketplace-orders";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ProductDimensionsFields } from "@/components/comercial/ProductDimensionsFields";
import { prepareProductPresentation, readProductDimensionsDraft, readProductDescriptionGeneration } from "@/lib/product-presentation";
import { buildCommercialProductDescription, refreshCommercialDescriptionDimensions } from "@/lib/commercial-product-description";
import { useToast } from "@/hooks/use-toast";
import { LoracePayments } from "@/components/marketplace/LoracePayments";
import { LoraceShipping } from "@/components/marketplace/LoraceShipping";
import { findStorefrontCategory, storefrontCategoryOptions, storefrontPackageError, storefrontPublicationError, type StorefrontCategoryOption } from "@/lib/storefront-listing";
import { prepareShippingPackage, readShippingPackageDraft, shippingPackageFields, type ShippingPackage } from "@/lib/product-shipping";
import { saveStorefrontPublication } from "@/lib/storefront-publication";
import { orderRequest } from "@/lib/sales-order";

type Listing = { product_id: string; published: boolean; category: string; price_override: number | null; made_to_order: boolean; lead_days: number; updated_at: string };
type Product = { id: string; name: string; sku: string | null; photo_url: string | null; sale_price: number | null; is_active: boolean; shipping_package?: ShippingPackage | null; description?: string|null; category?: string|null; commercial_presentation?: unknown; updated_at: string };
const money = (value: number | null) => value == null ? "Sem preço" : Number(value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const statuses: Record<string,string> = { draft: "Aguardando confirmação", approved: "Confirmado", in_production: "Em produção", ready: "Pronto", shipped: "Enviado", delivered: "Entregue", cancelled: "Cancelado" };
const payments: Record<string,string> = {approved:"Pagamento aprovado",pending:"Aguardando pagamento",not_started:"Checkout não iniciado",review:"Conferência necessária",rejected:"Recusado",cancelled:"Cancelado",in_process:"Em análise",authorized:"Autorizado",refunded:"Reembolsado",charged_back:"Contestado"};

function PaymentReview({requestId,saved}:{requestId:string;saved:()=>void}) {
 const [reason,setReason]=useState("");
 const review=useMutation({mutationFn:()=>rpc("review_storefront_payment",{p_request_id:requestId,p_reason:reason}),onSuccess:saved});
 return <form className="rounded-lg border border-amber-300 p-4 space-y-3" onSubmit={e=>{e.preventDefault();review.mutate();}}><p className="text-sm">Confira o pagamento no Mercado Pago e a disponibilidade dos itens. Duplicidades e contestações precisam ser resolvidas antes da liberação.</p><label className="block text-sm">Resultado da conferência<Input required minLength={5} maxLength={1000} value={reason} onChange={e=>setReason(e.target.value)} placeholder="Descreva o pagamento e o estoque conferidos"/></label>{review.error&&<p role="alert" className="text-sm text-destructive">{review.error.message}</p>}<Button type="submit" variant="outline" disabled={review.isPending}>{review.isPending?"Conferindo…":"Registrar conferência e liberar pedido"}</Button></form>;
}

function ListingCard({ product, listing, channelId, categories, categoriesLoading, categoriesError, saved }: { product: Product; listing?: Listing; channelId: string; categories: StorefrontCategoryOption[]; categoriesLoading: boolean; categoriesError: boolean; saved: () => void }) {
 const qc=useQueryClient();
 const [loaded,setLoaded]=useState(()=>({product:product.updated_at,listing:listing?.updated_at??null}));
 const request=useRef<ReturnType<typeof orderRequest>|null>(null);
 const [published,setPublished] = useState(listing?.published ?? false);
 const [category,setCategory] = useState(listing?.category ?? "");
 const [price,setPrice] = useState(listing?.price_override?.toString() ?? "");
 const [made,setMade] = useState(listing?.made_to_order ?? false);
 const [days,setDays] = useState(String(listing?.lead_days ?? 7));
 const [shippingPackage,setShippingPackage] = useState(() => readShippingPackageDraft(product.shipping_package));
 const [shippingOpen,setShippingOpen] = useState(() => !!storefrontPackageError(readShippingPackageDraft(product.shipping_package)));
 const savedPackage = useRef(JSON.stringify(prepareShippingPackage(readShippingPackageDraft(product.shipping_package))));
 const [dimensions,setDimensions] = useState(()=>readProductDimensionsDraft(product.commercial_presentation));
 const [description,setDescription] = useState(product.description||'');
 const [generation,setGeneration] = useState(()=>readProductDescriptionGeneration(product.commercial_presentation));
 const savedPresentation = useRef(JSON.stringify(prepareProductPresentation(readProductDimensionsDraft(product.commercial_presentation),readProductDescriptionGeneration(product.commercial_presentation))));
 const savedDescription = useRef(product.description||'');
 const alive = useRef(true);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 const { profile } = useAuth();
 const { toast } = useToast();
 const selectedCategory = findStorefrontCategory(category, categories);
 const packageError = storefrontPackageError(shippingPackage);
 let presentationError:string|null=null;
 try {prepareProductPresentation(dimensions,generation);}catch(error){presentationError=error instanceof Error?error.message:'Confira as medidas da peça.';}
 const publicationError = published ? storefrontPublicationError(product, price) || packageError || presentationError : presentationError;
 const stale=loaded.product!==product.updated_at||loaded.listing!==(listing?.updated_at??null);
 const mutation = useMutation({ mutationFn: async () => {
  if(!alive.current||!profile?.tenant_id||!loaded.product)throw new Error('Sua sessão ou a versão do produto mudou. Recarregue a publicação.');
  if (publicationError) throw new Error(publicationError);
  if (!selectedCategory && (published || !listing)) throw new Error("Selecione uma categoria da loja antes de salvar.");
  const packaging = prepareShippingPackage(shippingPackage);
  const packageSignature = JSON.stringify(packaging);
  const presentation=prepareProductPresentation(dimensions,generation);
  const presentationSignature=JSON.stringify(presentation);
  const changes:Record<string,unknown>={};
  if(packageSignature!==savedPackage.current)changes.shipping_package=packaging;
  if(presentationSignature!==savedPresentation.current)changes.commercial_presentation=presentation;
  if(description!==savedDescription.current)changes.description=description.trim()||null;
  const settings={published,category:selectedCategory?.slug??listing!.category,price_override:price.trim()===''?null:Number(price.replace(',','.')),made_to_order:made,lead_days:Number(days)};
  const payload={p_channel_id:channelId,p_product_id:product.id,p_product_changes:changes,p_settings:settings,p_expected_product_updated_at:loaded.product,p_expected_listing_updated_at:loaded.listing};
  const signature=JSON.stringify(payload);
  if(stale&&request.current?.signature!==signature)throw new Error('O produto ou a publicação mudou. Seu rascunho foi preservado; carregue a versão atual antes de salvar.');
  request.current=orderRequest(request.current,signature);
  const receipt=await saveStorefrontPublication({...payload,p_request_id:request.current.id});
  return{receipt,changes,settings,packageSignature,presentationSignature,description};
 }, onSuccess: result => {
  if(!alive.current)return;
  savedPackage.current=result.packageSignature;savedPresentation.current=result.presentationSignature;savedDescription.current=result.description;
  setLoaded({product:result.receipt.product_updated_at,listing:result.receipt.listing_updated_at});request.current=null;
  if(!result.receipt.replayed)qc.setQueryData<{products:Product[];listings:Listing[]}>(['lorace',profile?.tenant_id],current=>current?{...current,
   products:current.products.map(row=>row.id===product.id?{...row,...result.changes,updated_at:result.receipt.product_updated_at}:row),
   listings:current.listings.some(row=>row.product_id===product.id)?current.listings.map(row=>row.product_id===product.id?{...row,...result.settings,updated_at:result.receipt.listing_updated_at}:row):[...current.listings,{product_id:product.id,...result.settings,updated_at:result.receipt.listing_updated_at}]}:current);
  saved();toast({title:'Publicação salva',description:result.receipt.replayed?'Salvamento anterior confirmado. A versão atual será conferida sem regravar os dados.':'Descrição, medidas e publicação salvas juntas.'});
 } });
 async function reload(){
  await qc.invalidateQueries({queryKey:['lorace',profile?.tenant_id]});if(!alive.current)return;
  const current=qc.getQueryData<{products:Product[];listings:Listing[]}>(['lorace',profile?.tenant_id]),next=current?.products.find(row=>row.id===product.id),nextListing=current?.listings.find(row=>row.product_id===product.id);
  if(!next)return;
  const pack=readShippingPackageDraft(next.shipping_package),presentation=readProductDimensionsDraft(next.commercial_presentation),marker=readProductDescriptionGeneration(next.commercial_presentation);
  setShippingPackage(pack);setDimensions(presentation);setGeneration(marker);setDescription(next.description||'');
  setPublished(nextListing?.published??false);setCategory(nextListing?.category??'');setPrice(nextListing?.price_override?.toString()??'');setMade(nextListing?.made_to_order??false);setDays(String(nextListing?.lead_days??7));
  savedPackage.current=JSON.stringify(prepareShippingPackage(pack));savedPresentation.current=JSON.stringify(prepareProductPresentation(presentation,marker));savedDescription.current=next.description||'';
  setLoaded({product:next.updated_at,listing:nextListing?.updated_at??null});request.current=null;mutation.reset();
 }
 const descriptionFacts = () => {
  const presentation=prepareProductPresentation(dimensions,generation);
  return {title:product.name,category:product.category,manufacturedBy3dPrinting:product.category==='printed_part'||product.category==='kit',dimensions:presentation?{confirmed:true,lengthMm:presentation.dimensions.length_mm,widthMm:presentation.dimensions.width_mm,heightMm:presentation.dimensions.height_mm}:null};
 };
 return <form aria-label={`Publicação de ${product.name}`} onSubmit={e => { e.preventDefault(); mutation.mutate(); }} className="rounded-xl border bg-card p-4 space-y-4">
  <div className="flex gap-3"><img src={product.photo_url || "/placeholder.svg"} alt="" className="h-20 w-20 rounded-lg object-contain bg-muted" /><div className="min-w-0"><h3 className="font-semibold">{product.name}</h3><p className="text-xs text-muted-foreground">{product.sku || "Sem SKU"} · Preço no Forge: {money(product.sale_price)}</p><Link className="text-sm underline" to={`/comercial/produtos?produto=${encodeURIComponent(product.id)}&editar=1`}>Editar produto e fotos</Link></div></div>
  <div className="grid gap-3 sm:grid-cols-2"><label className="text-sm">Categoria na loja<select className="flex h-10 w-full min-w-0 rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50" value={selectedCategory?.slug ?? ""} onChange={e=>{setCategory(e.target.value);mutation.reset();}} disabled={mutation.isPending || categoriesLoading || categoriesError || !categories.length} required={published || !listing}>
   <option value="" disabled>{categoriesLoading ? "Carregando categorias…" : categoriesError ? "Não foi possível carregar" : !categories.length ? "Nenhuma categoria publicada" : "Selecione a categoria"}</option>
   {categories.map(option=><option key={option.slug} value={option.slug}>{option.name}</option>)}
  </select></label><label className="text-sm">Preço específico na loja (opcional)<Input disabled={mutation.isPending} inputMode="decimal" value={price} onChange={e=>{setPrice(e.target.value);mutation.reset();}} placeholder="Usar preço do Forge" /></label></div>
  {!categoriesLoading && !categoriesError && !categories.length && <p className="text-sm text-amber-700">Publique uma categoria no administrador da loja para selecioná-la aqui.</p>}
  {!categoriesLoading && !categoriesError && categories.length > 0 && category && !selectedCategory && <p className="text-sm text-amber-700">A categoria anterior “{category}” não está entre as categorias publicadas. Selecione outra para publicar.</p>}
  <details className="space-y-3 rounded-lg border p-3"><summary className="cursor-pointer text-sm font-medium">Descrição e medidas da peça</summary>
   <ProductDimensionsFields idPrefix={`listing-piece-${product.id}`} value={dimensions} disabled={mutation.isPending} onChange={value=>{
    setDimensions(value);mutation.reset();
    try{const p=prepareProductPresentation(value,generation);const refreshed=refreshCommercialDescriptionDimensions(description,generation,p?{confirmed:true,lengthMm:p.dimensions.length_mm,widthMm:p.dimensions.width_mm,heightMm:p.dimensions.height_mm}:null);if(refreshed.applied){setDescription(refreshed.value);setGeneration(refreshed.generation);}}catch{/* Keep incomplete input visible until corrected. */}
   }}/>
   <label className="block text-sm">Descrição para o cliente<Textarea aria-label={`Descrição comercial de ${product.name}`} value={description} disabled={mutation.isPending} rows={5} onChange={event=>{setDescription(event.target.value);setGeneration(null);mutation.reset();}}/></label>
   <Button type="button" variant="outline" disabled={mutation.isPending||!!presentationError} onClick={()=>{const suggestion=buildCommercialProductDescription(descriptionFacts());setDescription(suggestion.text);setGeneration(suggestion.generation);mutation.reset();}}>Reescrever descrição para a loja</Button>
   <p className="text-xs text-muted-foreground">Usa o nome e as medidas conhecidas. Confira o texto antes de salvar; descrições editadas à mão são preservadas ao alterar as medidas.</p>
  </details>
  <details open={shippingOpen} onToggle={event => setShippingOpen(event.currentTarget.open)} className="space-y-3 rounded-lg border p-3">
   <summary className="cursor-pointer text-sm font-medium">Embalagem para envio · {packageError ? "a completar" : "medidas preenchidas"}</summary>
   <p className="text-sm text-muted-foreground">Informe as medidas externas da embalagem e o peso de uma unidade pronta para despachar, incluindo caixa e proteção.</p>
   <div className="grid gap-3 sm:grid-cols-2">{shippingPackageFields.map(([key, label]) => <div key={key}>
    <Label htmlFor={`listing-${product.id}-${key}`}>{label}</Label>
    <Input id={`listing-${product.id}-${key}`} inputMode="decimal" value={shippingPackage[key]} disabled={mutation.isPending}
     onChange={event => { setShippingPackage(current => ({ ...current, [key]: event.target.value })); mutation.reset(); }}
     placeholder={key === "weight_grams" ? "Ex.: 350" : "Ex.: 20"} />
   </div>)}</div>
   <p className="text-xs text-muted-foreground">As medidas são salvas no cadastro do produto ao salvar a publicação. O peso de filamento e as dimensões do modelo 3D não substituem a embalagem.</p>
   <Link className="inline-block text-sm underline" to={`/comercial/produtos?produto=${encodeURIComponent(product.id)}&editar=1&aba=embalagem`}>Editar embalagem no cadastro</Link>
  </details>
  <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={made} disabled={mutation.isPending} onChange={e=>setMade(e.target.checked)} />Aceitar pedidos sob encomenda</label>
  {made && <label className="block text-sm">Prazo de produção (dias úteis)<Input type="number" min={1} max={180} value={days} onChange={e=>setDays(e.target.value)} required /></label>}
  <p className="text-xs text-muted-foreground">O saldo usa somente o estoque disponível do produto final. Peças, folhas, caules e demais componentes continuam controlados na produção.</p>
  <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={published} disabled={mutation.isPending} onChange={e=>{setPublished(e.target.checked);mutation.reset();}} />Exibir este produto na Elevare3D</label>
  {(publicationError || (!product.sale_price && !price)) && <p className="text-sm text-amber-700">{publicationError || "Informe o preço no Forge ou o preço específico acima para publicar."}</p>}
  {stale&&<div role="alert" className="space-y-2 text-sm text-amber-700"><p>O produto ou a publicação mudou em outra operação. Seu rascunho foi preservado.</p><Button type="button" variant="outline" disabled={mutation.isPending} onClick={()=>void reload()}>Descartar rascunho e carregar versão atual</Button></div>}
  {mutation.error && <p role="alert" className="text-sm text-destructive">{mutation.error.message}</p>}
  <Button disabled={mutation.isPending || !product.is_active || stale&&!mutation.isError || (published && (categoriesLoading || categoriesError || !selectedCategory || !!publicationError))} type="submit">{mutation.isPending ? "Salvando…" : mutation.isError?'Confirmar salvamento da publicação':'Salvar publicação'}</Button>
 </form>;
}

export default function Lorace() {
 const {profile,user}=useAuth();
 return <LoraceWorkspace key={`${profile?.tenant_id}:${user?.id}`}/>;
}

function LoraceWorkspace() {
 const { profile } = useAuth(); const qc = useQueryClient(); const [search,setSearch] = useState(""); const [tab,setTab] = useState("catalog");
 const categoryQuery = useQuery({ queryKey: ["storefront-categories",profile?.tenant_id], enabled: !!profile, refetchInterval: 30000, queryFn: async () => storefrontCategoryOptions(await rpc<{content?: {categories?: unknown}} | null>("storefront_site",{p_slug:"lorace"})) });
 const invalidate = () => { void qc.invalidateQueries({ queryKey: ["lorace",profile?.tenant_id] }); void qc.invalidateQueries({ queryKey: ["products"] }); };
 const query = useQuery({ queryKey: ["lorace",profile?.tenant_id], enabled: !!profile, refetchInterval: 30000, queryFn: async () => {
  const tenant = profile!.tenant_id;
  const [channels, listings, requests] = await Promise.all([
   db.from("storefront_channels").select("id,name,slug,enabled").eq("tenant_id",tenant).eq("slug","lorace").maybeSingle(),
   db.from("storefront_listings").select("*").eq("tenant_id",tenant),
   db.from("storefront_requests").select("id,channel_id,order_id,payload,created_at,payment_status,payment_review,order:orders(code,total,status)").eq("tenant_id",tenant).order("created_at",{ascending:false}).limit(100),
  ]);
  for (const result of [channels,listings,requests]) if(result.error) throw result.error;
  const products: Product[] = [];
  for(let start=0;;start+=1000){ const result=await db.from("products").select("id,name,sku,photo_url,sale_price,is_active,shipping_package,description,category,commercial_presentation,updated_at").eq("tenant_id",tenant).eq("is_component",false).order("name").order("id").range(start,start+999); if(result.error) throw result.error; products.push(...result.data); if(result.data.length<1000) break; }
  return { channel: channels.data as {id:string;name:string;slug:string;enabled:boolean}|null, listings: listings.data as Listing[], requests: requests.data as unknown as {id:string;channel_id:string;order_id:string;created_at:string;payment_status:string;payment_review:string|null;payload:{customer:{name:string;email:string;phone:string;address:Record<string,string>};notes?:string};order:{code:string;total:number;status:string}}[], products };
 }});
 const configure = useMutation({ mutationFn: (enabled:boolean)=>rpc("configure_storefront",{p_slug:"lorace",p_enabled:enabled}),onSuccess:invalidate });
 const data=query.data; const channel=data?.channel;
 const normalized=search.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase();
 const products=data?.products.filter(p=>`${p.name} ${p.sku??""}`.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().includes(normalized))??[];
 return <><PageHeader title="Loja Elevare3D" description="Escolha o que aparece na loja e acompanhe os pedidos recebidos. Produtos, fotos, preços e disponibilidade vêm do Forge." actions={<><Button variant="outline" onClick={()=>{void query.refetch();void categoryQuery.refetch();}}><RefreshCw className="mr-2 h-4 w-4"/>Atualizar</Button><Button asChild><a href="https://loja-elevare3d.lovable.app" target="_blank" rel="noreferrer"><ExternalLink className="mr-2 h-4 w-4"/>Abrir loja</a></Button></>} />
 {query.isPending && <p role="status">Carregando integração…</p>}
 {(query.error||configure.error) && <p role="alert" className="rounded-lg border border-destructive p-4">{(query.error||configure.error)?.message}</p>}
 {categoryQuery.error && <p role="alert" className="rounded-lg border border-destructive p-4">Não foi possível carregar as categorias da loja. Clique em Atualizar para tentar novamente.</p>}
 {data && !channel && <div className="rounded-xl border p-6 space-y-4"><Store/><h2 className="font-semibold">Conectar catálogo do Forge à Elevare3D</h2><p>Você escolhe os produtos publicados na próxima etapa. Pedidos entram no Forge vinculados ao pagamento no Mercado Pago.</p><Button onClick={()=>configure.mutate(true)} disabled={configure.isPending}>Ativar integração Elevare3D</Button></div>}
 {channel && <><LoraceShipping channelId={channel.id}/><LoracePayments channelId={channel.id}/><div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-4"><p className="text-sm">{channel.enabled?"Loja conectada":"Loja pausada"} · {data.listings.filter(l=>l.published).length} publicações · {data.requests.length} pedidos recentes</p><Button variant="outline" disabled={configure.isPending} onClick={()=>configure.mutate(!channel.enabled)}>{channel.enabled?"Pausar loja":"Reativar loja"}</Button></div>
 <div className="mb-5 flex gap-2"><Button variant={tab==="catalog"?"default":"outline"} onClick={()=>setTab("catalog")}>Catálogo e disponibilidade</Button><Button variant={tab==="orders"?"default":"outline"} onClick={()=>setTab("orders")}>Pedidos da loja</Button></div>
 {tab==="catalog" ? <><Input aria-label="Buscar produto por nome ou SKU" placeholder="Digite nome ou SKU para localizar o produto…" className="mb-5" value={search} onChange={e=>setSearch(e.target.value)}/><div className="grid gap-4 xl:grid-cols-2">{products.map(product=><ListingCard key={product.id} product={product} listing={data.listings.find(l=>l.product_id===product.id)} channelId={channel.id} categories={categoryQuery.data ?? []} categoriesLoading={categoryQuery.isPending} categoriesError={categoryQuery.isError} saved={invalidate}/>)}</div>{products.length===0&&<p>Nenhum produto final encontrado.</p>}</> : <div className="space-y-4">{data.requests.length===0&&<p className="rounded-xl border p-6 text-muted-foreground">Nenhum pedido recebido pela loja ainda.</p>}{data.requests.filter(r=>r.channel_id===channel.id).map(r=><article key={r.id} className="rounded-xl border p-5 space-y-3"><div className="flex flex-wrap justify-between gap-2"><h2 className="font-semibold">{r.order.code} · {r.payload.customer.name}</h2><span>{statuses[r.order.status]??r.order.status} · {money(r.order.total)}</span></div><p className="text-sm font-medium">Mercado Pago: {payments[r.payment_status]??r.payment_status}</p>{r.payment_review && <><p role="alert" className="text-sm text-amber-700">{r.payment_review}</p><PaymentReview requestId={r.id} saved={invalidate}/></>}<p className="text-sm">{r.payload.customer.email} · {r.payload.customer.phone}</p><p className="text-sm text-muted-foreground">Entrega informada: {Object.values(r.payload.customer.address).filter(Boolean).join(" · ")}</p>{r.payload.notes&&<p className="text-sm whitespace-pre-wrap">{r.payload.notes}</p>}<p className="text-xs text-muted-foreground">Recebido em {new Date(r.created_at).toLocaleString("pt-BR")}. Confira pagamento e prazo antes de organizar a venda.</p><Button asChild><Link to={`/comercial/pedidos?pedido=${r.order_id}`}>Abrir pedido no Forge</Link></Button></article>)}</div>}
 </>}
 </>;
}
