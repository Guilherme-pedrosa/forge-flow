import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ExternalLink, RefreshCw, Store } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { marketplaceDb as db, marketplaceRpc as rpc } from "@/lib/marketplace-orders";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { LoracePayments } from "@/components/marketplace/LoracePayments";
import { findStorefrontCategory, storefrontCategoryOptions, storefrontPublicationError, type StorefrontCategoryOption } from "@/lib/storefront-listing";

type Listing = { product_id: string; published: boolean; category: string; price_override: number | null; made_to_order: boolean; lead_days: number };
type Product = { id: string; name: string; sku: string | null; photo_url: string | null; sale_price: number | null; is_active: boolean };
const money = (value: number | null) => value == null ? "Sem preço" : Number(value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const statuses: Record<string,string> = { draft: "Aguardando confirmação", approved: "Confirmado", in_production: "Em produção", ready: "Pronto", shipped: "Enviado", delivered: "Entregue", cancelled: "Cancelado" };
const payments: Record<string,string> = {approved:"Pagamento aprovado",pending:"Aguardando pagamento",not_started:"Checkout não iniciado",review:"Conferência necessária",rejected:"Recusado",cancelled:"Cancelado",in_process:"Em análise",authorized:"Autorizado",refunded:"Reembolsado",charged_back:"Contestado"};

function PaymentReview({requestId,saved}:{requestId:string;saved:()=>void}) {
 const [reason,setReason]=useState("");
 const review=useMutation({mutationFn:()=>rpc("review_storefront_payment",{p_request_id:requestId,p_reason:reason}),onSuccess:saved});
 return <form className="rounded-lg border border-amber-300 p-4 space-y-3" onSubmit={e=>{e.preventDefault();review.mutate();}}><p className="text-sm">Confira o pagamento no Mercado Pago e a disponibilidade dos itens. Duplicidades e contestações precisam ser resolvidas antes da liberação.</p><label className="block text-sm">Resultado da conferência<Input required minLength={5} maxLength={1000} value={reason} onChange={e=>setReason(e.target.value)} placeholder="Descreva o pagamento e o estoque conferidos"/></label>{review.error&&<p role="alert" className="text-sm text-destructive">{review.error.message}</p>}<Button type="submit" variant="outline" disabled={review.isPending}>{review.isPending?"Conferindo…":"Registrar conferência e liberar pedido"}</Button></form>;
}

function ListingCard({ product, listing, channelId, categories, categoriesLoading, categoriesError, saved }: { product: Product; listing?: Listing; channelId: string; categories: StorefrontCategoryOption[]; categoriesLoading: boolean; categoriesError: boolean; saved: () => void }) {
 const [published,setPublished] = useState(listing?.published ?? false);
 const [category,setCategory] = useState(listing?.category ?? "");
 const [price,setPrice] = useState(listing?.price_override?.toString() ?? "");
 const [made,setMade] = useState(listing?.made_to_order ?? false);
 const [days,setDays] = useState(String(listing?.lead_days ?? 7));
 const { toast } = useToast();
 const selectedCategory = findStorefrontCategory(category, categories);
 const publicationError = published ? storefrontPublicationError(product, price) : null;
 const mutation = useMutation({ mutationFn: () => {
  if (publicationError) throw new Error(publicationError);
  if (!selectedCategory && (published || !listing)) throw new Error("Selecione uma categoria da loja antes de salvar.");
  return rpc("save_storefront_listing", { p_channel_id: channelId, p_product_id: product.id, p_settings: { published, category: selectedCategory?.slug ?? listing!.category, price_override: price.trim() === "" ? null : Number(price.replace(",",".")), made_to_order: made, lead_days: Number(days) } });
 }, onSuccess: () => { saved(); toast({ title: "Publicação salva", description: "O catálogo da loja será atualizado automaticamente." }); } });
 return <form onSubmit={e => { e.preventDefault(); mutation.mutate(); }} className="rounded-xl border bg-card p-4 space-y-4">
  <div className="flex gap-3"><img src={product.photo_url || "/placeholder.svg"} alt="" className="h-20 w-20 rounded-lg object-contain bg-muted" /><div className="min-w-0"><h3 className="font-semibold">{product.name}</h3><p className="text-xs text-muted-foreground">{product.sku || "Sem SKU"} · Preço no Forge: {money(product.sale_price)}</p><Link className="text-sm underline" to="/comercial/produtos">Editar produto e fotos</Link></div></div>
  <div className="grid gap-3 sm:grid-cols-2"><label className="text-sm">Categoria na loja<select className="flex h-10 w-full min-w-0 rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50" value={selectedCategory?.slug ?? ""} onChange={e=>{setCategory(e.target.value);mutation.reset();}} disabled={categoriesLoading || categoriesError || !categories.length} required={published || !listing}>
   <option value="" disabled>{categoriesLoading ? "Carregando categorias…" : categoriesError ? "Não foi possível carregar" : !categories.length ? "Nenhuma categoria publicada" : "Selecione a categoria"}</option>
   {categories.map(option=><option key={option.slug} value={option.slug}>{option.name}</option>)}
  </select></label><label className="text-sm">Preço específico na loja (opcional)<Input inputMode="decimal" value={price} onChange={e=>{setPrice(e.target.value);mutation.reset();}} placeholder="Usar preço do Forge" /></label></div>
  {!categoriesLoading && !categoriesError && !categories.length && <p className="text-sm text-amber-700">Publique uma categoria no administrador da loja para selecioná-la aqui.</p>}
  {!categoriesLoading && !categoriesError && categories.length > 0 && category && !selectedCategory && <p className="text-sm text-amber-700">A categoria anterior “{category}” não está entre as categorias publicadas. Selecione outra para publicar.</p>}
  <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={made} onChange={e=>setMade(e.target.checked)} />Aceitar pedidos sob encomenda</label>
  {made && <label className="block text-sm">Prazo de produção (dias úteis)<Input type="number" min={1} max={180} value={days} onChange={e=>setDays(e.target.value)} required /></label>}
  <p className="text-xs text-muted-foreground">O saldo usa somente o estoque disponível do produto final. Peças, folhas, caules e demais componentes continuam controlados na produção.</p>
  <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={published} onChange={e=>{setPublished(e.target.checked);mutation.reset();}} />Exibir este produto na Elevare3D</label>
  {(publicationError || (!product.sale_price && !price)) && <p className="text-sm text-amber-700">{publicationError || "Informe o preço no Forge ou o preço específico acima para publicar."}</p>}
  {mutation.error && <p role="alert" className="text-sm text-destructive">{mutation.error.message}</p>}
  <Button disabled={mutation.isPending || !product.is_active || (published && (categoriesLoading || categoriesError || !selectedCategory || !!publicationError))} type="submit">{mutation.isPending ? "Salvando…" : "Salvar publicação"}</Button>
 </form>;
}

export default function Lorace() {
 const { profile } = useAuth(); const qc = useQueryClient(); const [search,setSearch] = useState(""); const [tab,setTab] = useState("catalog");
 const categoryQuery = useQuery({ queryKey: ["storefront-categories",profile?.tenant_id], enabled: !!profile, refetchInterval: 30000, queryFn: async () => storefrontCategoryOptions(await rpc<{content?: {categories?: unknown}} | null>("storefront_site",{p_slug:"lorace"})) });
 const invalidate = () => { void qc.invalidateQueries({ queryKey: ["lorace",profile?.tenant_id] }); };
 const query = useQuery({ queryKey: ["lorace",profile?.tenant_id], enabled: !!profile, refetchInterval: 30000, queryFn: async () => {
  const tenant = profile!.tenant_id;
  const [channels, listings, requests] = await Promise.all([
   db.from("storefront_channels").select("id,name,slug,enabled").eq("tenant_id",tenant).eq("slug","lorace").maybeSingle(),
   db.from("storefront_listings").select("*").eq("tenant_id",tenant),
   db.from("storefront_requests").select("id,channel_id,order_id,payload,created_at,payment_status,payment_review,order:orders(code,total,status)").eq("tenant_id",tenant).order("created_at",{ascending:false}).limit(100),
  ]);
  for (const result of [channels,listings,requests]) if(result.error) throw result.error;
  const products: Product[] = [];
  for(let start=0;;start+=1000){ const result=await db.from("products").select("id,name,sku,photo_url,sale_price,is_active").eq("tenant_id",tenant).eq("is_component",false).order("name").order("id").range(start,start+999); if(result.error) throw result.error; products.push(...result.data); if(result.data.length<1000) break; }
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
 {channel && <><LoracePayments channelId={channel.id}/><div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-4"><p className="text-sm">{channel.enabled?"Loja conectada":"Loja pausada"} · {data.listings.filter(l=>l.published).length} publicações · {data.requests.length} pedidos recentes</p><Button variant="outline" disabled={configure.isPending} onClick={()=>configure.mutate(!channel.enabled)}>{channel.enabled?"Pausar loja":"Reativar loja"}</Button></div>
 <div className="mb-5 flex gap-2"><Button variant={tab==="catalog"?"default":"outline"} onClick={()=>setTab("catalog")}>Catálogo e disponibilidade</Button><Button variant={tab==="orders"?"default":"outline"} onClick={()=>setTab("orders")}>Pedidos da loja</Button></div>
 {tab==="catalog" ? <><Input aria-label="Buscar produto por nome ou SKU" placeholder="Digite nome ou SKU para localizar o produto…" className="mb-5" value={search} onChange={e=>setSearch(e.target.value)}/><div className="grid gap-4 xl:grid-cols-2">{products.map(product=><ListingCard key={product.id} product={product} listing={data.listings.find(l=>l.product_id===product.id)} channelId={channel.id} categories={categoryQuery.data ?? []} categoriesLoading={categoryQuery.isPending} categoriesError={categoryQuery.isError} saved={invalidate}/>)}</div>{products.length===0&&<p>Nenhum produto final encontrado.</p>}</> : <div className="space-y-4">{data.requests.length===0&&<p className="rounded-xl border p-6 text-muted-foreground">Nenhum pedido recebido pela loja ainda.</p>}{data.requests.filter(r=>r.channel_id===channel.id).map(r=><article key={r.id} className="rounded-xl border p-5 space-y-3"><div className="flex flex-wrap justify-between gap-2"><h2 className="font-semibold">{r.order.code} · {r.payload.customer.name}</h2><span>{statuses[r.order.status]??r.order.status} · {money(r.order.total)}</span></div><p className="text-sm font-medium">Mercado Pago: {payments[r.payment_status]??r.payment_status}</p>{r.payment_review && <><p role="alert" className="text-sm text-amber-700">{r.payment_review}</p><PaymentReview requestId={r.id} saved={invalidate}/></>}<p className="text-sm">{r.payload.customer.email} · {r.payload.customer.phone}</p><p className="text-sm text-muted-foreground">Entrega informada: {Object.values(r.payload.customer.address).filter(Boolean).join(" · ")}</p>{r.payload.notes&&<p className="text-sm whitespace-pre-wrap">{r.payload.notes}</p>}<p className="text-xs text-muted-foreground">Recebido em {new Date(r.created_at).toLocaleString("pt-BR")}. Confira pagamento e prazo antes de organizar a venda.</p><Button asChild><Link to={`/comercial/pedidos?pedido=${r.order_id}`}>Abrir pedido no Forge</Link></Button></article>)}</div>}
 </>}
 </>;
}
