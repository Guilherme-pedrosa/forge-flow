import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.99.1';
import { assertPayment,checkoutUrl,verifySignature } from './mercadopago.ts';

const base=Deno.env.get('SUPABASE_URL')!;
const service=createClient(base,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
const site='https://loja-elevare3d.lovable.app';
const origins=new Set([site,'https://lorace-clone-master.lovable.app','https://preview--loja-elevare3d.lovable.app','https://elevare3d.lovable.app','https://id-preview--ce308138-4158-41e3-accd-4d9759ba9cdd.lovable.app','https://preview--lorace-clone-master.lovable.app']);
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
class ProviderError extends Error { constructor(public status:number,message:string){super(message);} }
async function mp(path:string,token:string,init:RequestInit={}){
 const response=await fetch('https://api.mercadopago.com'+path,{...init,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',...init.headers},signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw new ProviderError(response.status,response.status===401?'Credencial do Mercado Pago inválida.':'Não foi possível consultar o Mercado Pago. Tente novamente.');
 return response.json();
}
async function channel(slug:string){
 const result=await service.from('storefront_channels').select('id,tenant_id,enabled').eq('slug',slug).maybeSingle();if(result.error||!result.data)throw new Error('Loja não encontrada.');return result.data;
}
async function credentials(id:string){const result=await service.from('storefront_payment_credentials').select('*').eq('channel_id',id).maybeSingle();if(result.error||!result.data)throw new Error('Configure a conta Mercado Pago no Forge.');return result.data;}
async function recordPayment(id:string,k:Awaited<ReturnType<typeof credentials>>,paymentId:string){
 const payment=await mp('/v1/payments/'+encodeURIComponent(paymentId),k.access_token);assertPayment(payment,k.collector_id,k.mode==='production');
 const result=await service.rpc('record_storefront_payment',{p_channel_id:id,p_payment:payment});if(result.error)throw new Error(result.error.message);
}
Deno.serve(async request=>{
 const url=new URL(request.url);const origin=request.headers.get('origin')??'';
 const headers={'Content-Type':'application/json','Vary':'Origin',...(origins.has(origin)?{'Access-Control-Allow-Origin':origin}:{}),'Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'POST,OPTIONS','Cache-Control':'no-store'};
 const reply=(status:number,data:unknown)=>new Response(JSON.stringify(data),{status,headers});
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
 if(request.method!=='POST')return reply(405,{error:'Use POST.'});
 try{
  const raw=await request.text();if(raw.length>65536)return reply(413,{error:'Requisição muito grande.'});
  const body=JSON.parse(raw);
  if(url.searchParams.get('webhook')==='1'){
   const slug=url.searchParams.get('store')??'';const dataId=url.searchParams.get('data.id')??'';
   if(body.type!=='payment')return reply(200,{ignored:true});
   const ch=await channel(slug);const k=await credentials(ch.id);
   if(String(body.data?.id)!==dataId||!await verifySignature(k.webhook_secret,request.headers.get('x-signature'),request.headers.get('x-request-id'),dataId))return reply(401,{error:'Assinatura inválida.'});
   await recordPayment(ch.id,k,dataId);return reply(200,{received:true});
  }
  if(origin&&!origins.has(origin))return reply(403,{error:'Origem não permitida.'});
  if(body.action==='health')return reply(200,{ready:true});
  if(body.action==='connect'){
   const authorization=request.headers.get('authorization')??'';
   const actor=createClient(base,Deno.env.get('SUPABASE_ANON_KEY')!,{global:{headers:{Authorization:authorization}},auth:{persistSession:false}});
   const {data:{user},error}=await actor.auth.getUser();if(error||!user)return reply(401,{error:'Entre no Forge para configurar pagamentos.'});
   const permission=await actor.rpc('erp_can_write',{financial:true});if(permission.error||!permission.data)return reply(403,{error:'Somente um administrador pode configurar a conta.'});
   const {data:own}=await actor.from('storefront_channels').select('id').eq('id',body.channel_id).maybeSingle();if(!own)return reply(403,{error:'Loja não encontrada nesta empresa.'});
   const token=String(body.access_token??'').trim();const secret=String(body.webhook_secret??'').trim();
   if(token.length<20||token.length>500||secret.length<16||secret.length>500)return reply(400,{error:'Confira as credenciais.'});
   const account=await mp('/users/me',token);if(!account.id||account.site_id!=='MLB')throw new Error('Use uma conta Mercado Pago brasileira.');
   const result=await actor.rpc('save_storefront_payment_settings',{p_channel_id:own.id,p_token:token,p_secret:secret,p_mode:body.mode,p_shipping_fee:body.shipping_fee,p_states:body.shipping_states});if(result.error)throw new Error(result.error.message);
   const update=await service.from('storefront_payment_credentials').update({collector_id:String(account.id),verified_at:new Date().toISOString()}).eq('channel_id',own.id).eq('access_token',token).eq('mode',body.mode).eq('webhook_secret',secret).select('channel_id');if(update.error||!update.data?.length)throw new Error('A configuração mudou. Confira a conta e conecte novamente.');
   return reply(200,{connected:true,account_id:String(account.id),mode:body.mode});
  }
  const slug=String(body.store??'');const requestId=String(body.request_id??'');if(!uuid.test(requestId))return reply(400,{error:'Identificação de pedido inválida.'});
  const ch=await channel(slug);const k=await credentials(ch.id);if(!k.verified_at)throw new Error('Pagamento online ainda não configurado pela loja.');
  if(body.action==='checkout'){
   if(!ch.enabled)throw new Error('Loja temporariamente indisponível.');
   const prior=await service.from('storefront_requests').select('id,checkout_expires_at').eq('channel_id',ch.id).eq('request_id',requestId).maybeSingle();if(prior.error)throw new Error('Não foi possível conferir o envio anterior.');
   const start=await service.rpc('begin_storefront_checkout',{p_slug:slug,p_request_id:requestId,p_payload:body.payload});if(start.error)return reply(400,{error:start.error.message,reset_allowed:!prior.data||!!prior.data.checkout_expires_at&&Date.parse(prior.data.checkout_expires_at)<=Date.now()});
   if(start.data.checkout_url)return reply(200,{received:true,checkout_url:checkoutUrl(start.data.checkout_url)});
   if(start.data.paid)return reply(200,{received:true,paid:true});
   const record=await service.from('storefront_requests').select('id,order_id,created_at').eq('id',start.data.internal_request_id).single();if(record.error)throw new Error('Pedido não encontrado.');
   const external=record.data.id;
   // Recover a lost response before considering a new preference. MP can take
   // time to index it: retries after the first attempt only search, never POST.
   const search=await mp('/checkout/preferences/search?external_reference='+external,k.access_token);
   let preference=(search.elements??search.results??[]).find((p:Record<string,unknown>)=>p.external_reference===external);
   if(preference?.id)preference=await mp('/checkout/preferences/'+encodeURIComponent(preference.id),k.access_token);
   if(!preference){
    const age=Date.now()-Date.parse(record.data.created_at);
    if(age>30*60*1000)throw new Error('Pedido expirado. Inicie um novo carrinho.');
    const order=await service.from('orders').select('shipping,items:order_items(product_id,description,quantity,unit_price)').eq('id',record.data.order_id).single();if(order.error)throw new Error('Não foi possível conferir os itens.');
    const items=order.data.items.map((i:{product_id:string;description:string;quantity:number;unit_price:number})=>({id:i.product_id,title:i.description.slice(0,250),quantity:i.quantity,unit_price:Number(i.unit_price),currency_id:'BRL'}));
    if(Number(order.data.shipping)>0)items.push({id:'frete',title:'Entrega',quantity:1,unit_price:Number(order.data.shipping),currency_id:'BRL'});
    const back=site+'/carrinho?pedido='+requestId;
    const claim=await service.from('storefront_requests').update({preference_attempted_at:new Date().toISOString()}).eq('id',external).is('preference_attempted_at',null).select('id');
    if(claim.error)throw new Error('Não foi possível preparar o pagamento.');
    if(!claim.data?.length)throw new Error('Estamos recuperando o checkout anterior. Tente novamente em instantes; o pedido não será duplicado.');
    try {
     preference=await mp('/checkout/preferences',k.access_token,{method:'POST',headers:{'X-Idempotency-Key':external},body:JSON.stringify({external_reference:external,items,back_urls:{success:back,pending:back,failure:back},auto_return:'approved',notification_url:base+'/functions/v1/lorace-payments?webhook=1&store='+encodeURIComponent(slug),expires:true,expiration_date_from:new Date().toISOString(),expiration_date_to:start.data.expires_at,payment_methods:{excluded_payment_types:[{id:'ticket'},{id:'atm'}]},statement_descriptor:'ELEVARE3D'})});
    } catch(error) {
     // Only a definitive rejection permits a new POST. Timeouts and 5xx keep
     // the durable claim, so the next request searches instead of charging twice.
     if(error instanceof ProviderError && [400,401,403,422].includes(error.status)) {
      await service.from('storefront_requests').update({preference_attempted_at:null,checkout_locked_until:null}).eq('id',external).eq('checkout_lock',start.data.lock_id);
     }
     throw error;
    }
   }
   const destination=checkoutUrl(k.mode==='sandbox'?preference.sandbox_init_point:preference.init_point);
   const done=await service.rpc('finish_storefront_checkout',{p_request_id:external,p_lock:start.data.lock_id,p_preference_id:String(preference.id),p_url:destination});if(done.error)throw new Error(done.error.message);
   return reply(200,{received:true,checkout_url:destination});
  }
  if(body.action==='status'){
   const found=await service.from('storefront_requests').select('id,payment_checked_at').eq('channel_id',ch.id).eq('request_id',requestId).maybeSingle();if(found.error||!found.data)return reply(404,{error:'Pedido não encontrado.'});
   if(!found.data.payment_checked_at||Date.now()-Date.parse(found.data.payment_checked_at)>60000){
    await service.from('storefront_requests').update({payment_checked_at:new Date().toISOString()}).eq('id',found.data.id);
    const search=await mp('/v1/payments/search?external_reference='+found.data.id+'&sort=date_created&criteria=desc&limit=20',k.access_token);
    for(const p of search.results??[])if(String(p.external_reference)===found.data.id)await recordPayment(ch.id,k,String(p.id));
   }
   const status=await service.rpc('storefront_request_status',{p_slug:slug,p_request_id:requestId});if(status.error)throw new Error('Não foi possível consultar o pedido.');return reply(200,status.data);
  }
  return reply(400,{error:'Operação inválida.'});
 }catch(error){return reply(url.searchParams.get('webhook')==='1'?500:400,{error:error instanceof Error?error.message:'Não foi possível concluir a operação.'});}
});
