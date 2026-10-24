// Run the real Edge handler against isolated database/provider doubles.
// No network request or payment is made by this test.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import ts from 'typescript';
import {createHmac} from 'node:crypto';
const compile=s=>'data:text/javascript;base64,'+Buffer.from(ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText).toString('base64');
const helper=compile(await fs.readFile(new URL('../supabase/functions/lorace-payments/mercadopago.ts',import.meta.url),'utf8'));
const requestId='74000000-0000-4000-8000-000000000099', internal='74000000-0000-4000-8000-000000000098';
const destination='https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=qa';
let handler,attempted=false,network=[],rpcCalls=[],failure=null,recovered=false,prior=false;
const credentials={access_token:'qa-only',webhook_secret:'qa-webhook-secret',verified_at:'2026-10-24',collector_id:'123',mode:'sandbox'};
const payment={id:456,collector_id:123,live_mode:false,currency_id:'BRL',transaction_amount:85,external_reference:internal};
const preference={id:'qa',external_reference:internal,init_point:destination,sandbox_init_point:destination};
const client={auth:{getUser:async()=>({data:{user:null},error:null})},
 rpc:async(name,args)=>{rpcCalls.push([name,args]);if(name==='begin_storefront_checkout')return {data:{internal_request_id:internal,order_id:'order',lock_id:'lock',expires_at:new Date(Date.now()+1800000).toISOString()}};return {data:{received:true,payment_status:'pending'}};},
 from(table){const query={op:'select',fields:'',filters:{},values:null,
  select(fields){this.fields=fields;return this;},update(values){this.op='update';this.values=values;return this;},eq(key,value){this.filters[key]=value;return this;},is(key,value){this.filters[key]=value;return this;},single(){return this;},maybeSingle(){return this;},
  then(resolve,reject){let data;
   if(table==='storefront_channels')data={id:'channel',tenant_id:'tenant',enabled:true};
   else if(table==='storefront_payment_credentials')data=credentials;
   else if(table==='orders')data={shipping:5,items:[{product_id:'product',description:'Maçã',quantity:2,unit_price:40}]};
   else if(table==='storefront_requests'){
    if(this.op==='update'){
     if('preference_attempted_at' in this.values){if(this.values.preference_attempted_at===null){attempted=false;data=[];}else {data=attempted?[]:[{id:internal}];attempted=true;}}
     else data=[];
    }else if(this.fields.includes('created_at'))data={id:internal,order_id:'order',created_at:new Date().toISOString()};
    else data=prior?{id:internal,payment_checked_at:new Date().toISOString()}:null;
   }
   return Promise.resolve({data,error:null}).then(resolve,reject);
  }};return query;}
};
const originalFetch=globalThis.fetch;
globalThis.__loraceTestClient=()=>client;
globalThis.Deno={env:{get:name=>name==='SUPABASE_URL'?'https://qa.invalid':'qa-key'},serve:callback=>{handler=callback;}};
globalThis.fetch=async(url,init)=>{
 network.push([String(url),init?.method??'GET']);
 if(String(url).includes('/checkout/preferences/search'))return Response.json({elements:recovered?[preference]:[]});
 if(String(url).includes('/checkout/preferences/qa'))return Response.json(preference);
 if(init?.method==='POST'){
  const body=JSON.parse(init.body);assert.equal(body.external_reference,internal);assert.equal(body.items[0].unit_price,40);assert.equal(body.items[1].unit_price,5);
  if(failure==='timeout')throw new Error('Connection lost');
  if(failure==='400')return new Response('{}',{status:400});
  return Response.json(preference);
 }
 if(String(url).includes('/v1/payments/456'))return Response.json(payment);
 throw new Error('Unexpected network destination: '+url);
};
try{
 let source=await fs.readFile(new URL('../supabase/functions/lorace-payments/index.ts',import.meta.url),'utf8');
 source=source.replace("import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.99.1';",'const createClient=globalThis.__loraceTestClient;').replace("'./mercadopago.ts'",JSON.stringify(helper));
 await import(compile(source));
 const call=(body,headers={},suffix='')=>handler(new Request('https://qa.invalid/functions/v1/lorace-payments'+suffix,{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(body)}));
 assert.equal((await call({action:'checkout'},{origin:'https://evil.invalid'})).status,403);
 assert.equal((await call({action:'connect'})).status,401);assert.equal(network.length,0);
 const webhook={type:'payment',data:{id:456}},suffix='?webhook=1&store=lorace&data.id=456';
 assert.equal((await call(webhook,{},suffix)).status,401);assert.equal(network.length,0);
 const stamp=String(Date.now()),signature=createHmac('sha256',credentials.webhook_secret).update(`id:456;request-id:qa;ts:${stamp};`).digest('hex');
 assert.equal((await call(webhook,{'x-signature':`ts=${stamp},v1=${signature}`,'x-request-id':'qa'},suffix)).status,200);
 assert.equal(rpcCalls.filter(c=>c[0]==='record_storefront_payment').length,1);
 const checkout={action:'checkout',store:'lorace',request_id:requestId,payload:{items:[{unit_price:.01}]}};
 network=[];rpcCalls=[];failure='timeout';
 assert.equal((await call(checkout)).status,400);assert.equal(attempted,true);
 failure=null;assert.equal((await call(checkout)).status,400);
 assert.equal(network.filter(c=>c[1]==='POST').length,1,'Lost response must never create a second preference');
 recovered=true;const recovery=await call(checkout);assert.equal(recovery.status,200);assert.equal((await recovery.json()).checkout_url,destination);
 assert.equal(network.filter(c=>c[1]==='POST').length,1);assert.equal(rpcCalls.filter(c=>c[0]==='finish_storefront_checkout').length,1);
 recovered=false;attempted=false;failure='400';await call(checkout);assert.equal(attempted,false,'Definitive provider rejection can retry safely');
 failure=null;assert.equal((await call(checkout)).status,200);
 console.log('PASS Edge HTTP: origin, admin auth, signed webhook with provider lookup, server prices, durable lost-response recovery, no duplicate POST, definitive-rejection retry.');
}finally{globalThis.fetch=originalFetch;delete globalThis.Deno;delete globalThis.__loraceTestClient;}
