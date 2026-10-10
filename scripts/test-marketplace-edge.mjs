import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import ts from 'typescript';

// Exercise the actual Edge handlers with an isolated session/database boundary.
// No upstream call, seller authorization, token exchange or external write occurs.
async function handler(name, state) {
  const source=await readFile(new URL(`../supabase/functions/${name}/index.ts`,import.meta.url),'utf8');
  const code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText.replace(/^import .*;\s*$/gm,'');
  let serve;
  const query = table => {
    const chain={};
    for (const method of ['select','eq','gt','order','limit','in','lt','delete','insert','update','upsert']) chain[method]=()=>chain;
    chain.single=async()=>({data:{id:'70000000-0000-4000-8000-000000000001',tenant_id:'tenant-qa',channel:state.channel??'mercado_livre',external_seller_id:'123',connection_state:'pending_credentials'},error:null});
    chain.then=(resolve,reject)=>Promise.resolve({data:table==='marketplace_oauth_states'?[]:null,error:null}).then(resolve,reject);
    return chain;
  };
  const createClient=()=>{state.clients++;return {
    auth:{getUser:async()=>({data:{user:state.invalidSession?null:{id:'user-qa'}},error:state.invalidSession?{message:'invalid session'}:null})},
    from:query,
    rpc:async(name,args)=>{state.calls.push({name,args});if(name==='get_user_tenant_id')return{data:'tenant-qa',error:null};if(name==='erp_can_write')return{data:!state.viewer,error:null};if(name==='record_marketplace_event')return state.viewer?{data:null,error:{message:'Seu perfil não tem permissão.'}}:{data:'durable-event-qa',error:null};throw new Error('Unexpected RPC in authenticated boundary test: '+name);}
  };};
  vm.runInNewContext(code,{Deno:{env:{get:key=>({SUPABASE_URL:'https://database.qa.invalid',SUPABASE_ANON_KEY:'qa-public',SUPABASE_SERVICE_ROLE_KEY:'qa-service'}[key])},serve:fn=>{serve=fn;}},createClient,Request,Response,URL,URLSearchParams,TextEncoder,Uint8Array,crypto,AbortSignal,fetch:async()=>{state.upstreamCalls++;throw new Error('Network forbidden in this test');},externalId:()=>{throw new Error('Normalization should not run at this boundary');},normalizeMercadoLivreOrder:()=>{throw new Error('Normalization should not run at this boundary');}},{filename:`${name}/index.ts`});
  return serve;
}
const state=extra=>({clients:0,calls:[],upstreamCalls:0,...extra});
const request=(body,auth=true)=>new Request('https://edge.qa.invalid',{method:'POST',headers:{'Content-Type':'application/json',...(auth?{Authorization:'Bearer QA_SESSION'}:{})},body:JSON.stringify(body)});
const notification={account_id:'70000000-0000-4000-8000-000000000001',notification:{resource:'/orders/200000000001',topic:'orders',user_id:123,sent:'2026-10-10T12:00:00Z'}};
let passed=0;
async function test(name,run){await run();passed++;console.log('PASS '+name);}
await test('Sync and webhook reject anonymous ingress before any session, secret or database access',async()=>{
  for(const name of ['marketplace-sync','marketplace-webhook']){const s=state(),fn=await handler(name,s);assert.equal((await fn(request({},false))).status,401);assert.equal(s.clients,0);assert.equal(s.calls.length,0);assert.equal(s.upstreamCalls,0);}
});
await test('Invalid sessions and viewer sync roles cannot create server connections or fetch seller data',async()=>{
  for(const extra of [{invalidSession:true},{viewer:true}]){const s=state(extra),fn=await handler('marketplace-sync',s);assert.ok([401,403].includes((await fn(request({action:'fetch_recent_orders',account_id:notification.account_id}))).status));assert.equal(s.clients,1);assert.equal(s.upstreamCalls,0);}
});
await test('Missing ML app configuration is explicit pending access without a simulated connection',async()=>{
  const s=state(),fn=await handler('marketplace-sync',s),response=await fn(request({action:'oauth_begin',account_id:notification.account_id}));assert.equal(response.status,409);
  assert.match((await response.json()).error,/ML_CLIENT_ID/);assert.equal(s.upstreamCalls,0);assert.ok(!s.calls.some(call=>call.name==='persist_marketplace_credentials'));
});
await test('Shopee API contract cannot be impersonated by the ML connector',async()=>{
  const s=state({channel:'shopee'}),fn=await handler('marketplace-sync',s),response=await fn(request({action:'fetch_recent_orders',account_id:notification.account_id}));assert.equal(response.status,409);assert.match((await response.json()).error,/contrato validados/);assert.equal(s.upstreamCalls,0);
});
await test('Webhook validates seller identity and supported resource before durable ingress',async()=>{
  for(const bad of [{...notification,notification:{...notification.notification,user_id:456}},{...notification,notification:{...notification.notification,resource:'https://attacker.qa.invalid/orders/2'}}]){const s=state(),fn=await handler('marketplace-webhook',s);assert.ok([400,403].includes((await fn(request(bad))).status));assert.equal(s.calls.length,0);assert.equal(s.upstreamCalls,0);}
});
await test('Authenticated ingress records only a durable, retry-stable event without sale or production effects',async()=>{
  const s=state(),fn=await handler('marketplace-webhook',s);
  assert.equal((await fn(request(notification))).status,202);assert.equal((await fn(request({...notification,notification:{...notification.notification,attempts:9}}))).status,202);
  assert.equal(s.calls.length,2);assert.equal(s.calls[0].name,'record_marketplace_event');assert.deepEqual(s.calls[0].args,s.calls[1].args);assert.equal(s.upstreamCalls,0);
});
await test('Webhook viewer role is enforced by the RPC, and payloads above 64 KB are rejected',async()=>{
  const s=state({viewer:true}),fn=await handler('marketplace-webhook',s);assert.equal((await fn(request(notification))).status,403);
  const big=state(),fn2=await handler('marketplace-webhook',big);assert.equal((await fn2(request({...notification,padding:'x'.repeat(65537)}))).status,413);assert.equal(big.calls.length,0);
});
const config=await readFile(new URL('../supabase/config.toml',import.meta.url),'utf8');
for(const fn of ['marketplace-sync','marketplace-webhook']) assert.match(config,new RegExp(`\\[functions\\.${fn}\\][\\s\\S]*?verify_jwt\\s*=\\s*true`));
console.log(`${passed} marketplace Edge authorization scenarios passed; both deployed JWT flags are enabled.`);
