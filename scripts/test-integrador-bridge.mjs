// Disposable PostgreSQL acceptance: tenant-approved Integrador bindings and single credential ownership.
// Never connects to production.
import { PGlite } from '@electric-sql/pglite';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { readFile, readdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
const repo=fileURLToPath(new URL('../',import.meta.url));
process.on('uncaughtException',error=>{console.error(error.message,error.where??'');process.exit(1);});
const db=new PGlite(), migrationName='20261102235500_integrador_bridge.sql';
const migration=await readFile(resolve(repo,'supabase/migrations',migrationName),'utf8');
await db.exec(`CREATE ROLE authenticated; CREATE ROLE anon; CREATE ROLE service_role;
 CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY,email text);
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 CREATE SCHEMA storage; CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean);
 CREATE TABLE storage.objects(id uuid DEFAULT gen_random_uuid(),bucket_id text,name text,owner uuid);
 CREATE FUNCTION storage.foldername(text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$ SELECT string_to_array($1,'/') $$;
 ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY; CREATE PUBLICATION supabase_realtime;
 GRANT USAGE ON SCHEMA public,auth,storage TO authenticated,anon;
 ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO authenticated;`);
for(const name of (await readdir(resolve(repo,'supabase/migrations'))).filter(n=>n.endsWith('.sql')&&n<migrationName).sort()){
 try{await db.exec((await readFile(resolve(repo,'supabase/migrations',name),'utf8')).replace(/CREATE EXTENSION IF NOT EXISTS (pg_cron|pg_net);/g,''));}
 catch(error){throw new Error(`Migration ${name}: ${error.message}`);}
}
const scalar=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0];
const rows=async(sql,args=[])=>(await db.query(sql,args)).rows;
const signatures=['public.receive_purchase_order(uuid,date)','public.save_quick_purchase(jsonb,jsonb,jsonb,uuid,boolean)'];
const untouched=await Promise.all(signatures.map(sig=>scalar('SELECT pg_get_functiondef($1::regprocedure)',[sig])));

await db.exec(migration);
assert.deepEqual(await Promise.all(signatures.map(sig=>scalar('SELECT pg_get_functiondef($1::regprocedure)',[sig]))),untouched);
const id=n=>`95000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const tenant=id(1),otherTenant=id(2),owner=id(3),otherOwner=id(4),viewer=id(5),operator=id(6);
const expense=id(10),asset=id(11),center=id(12),otherCenter=id(13),inactiveAccount=id(14),inactiveCenter=id(15),foreignAccount=id(16),foreignCenter=id(17),foreignMethod=id(18),vendor=id(19),method=id(20),grams=id(21),kilograms=id(22);
let sequence=100,passed=0;const next=()=>id(sequence++),near=(actual,expected)=>assert.ok(Math.abs(Number(actual)-expected)<1e-6,`${actual} != ${expected}`);
await db.query("INSERT INTO auth.users VALUES($1,'owner@purchase.invalid'),($2,'other@purchase.invalid'),($3,'viewer@purchase.invalid'),($4,'operator@purchase.invalid')",[owner,otherOwner,viewer,operator]);
await db.query("INSERT INTO tenants(id,name,slug) VALUES($1,'Purchase review QA','purchase-review-qa'),($2,'Other purchase QA','purchase-review-other')",[tenant,otherTenant]);
await db.query("INSERT INTO profiles(user_id,tenant_id,display_name) VALUES($1,$5,'Owner'),($2,$6,'Other'),($3,$5,'Viewer'),($4,$5,'Operator')",[owner,otherOwner,viewer,operator,tenant,otherTenant]);
await db.query("INSERT INTO user_roles(user_id,tenant_id,role) VALUES($1,$5,'owner'),($2,$6,'owner'),($3,$5,'viewer'),($4,$5,'operator')",[owner,otherOwner,viewer,operator,tenant,otherTenant]);
await db.query("INSERT INTO chart_of_accounts(id,tenant_id,code,name,account_type,is_active) VALUES($1,$5,'EXP','Materials','expense',true),($2,$5,'AST','Assets','asset',true),($3,$5,'OFF','Inactive','expense',false),($4,$6,'FOREIGN','Foreign','expense',true)",[expense,asset,inactiveAccount,foreignAccount,tenant,otherTenant]);
await db.query("INSERT INTO cost_centers(id,tenant_id,code,name,is_active) VALUES($1,$5,'PROD','Production',true),($2,$5,'OTHER','Other area',true),($3,$5,'OFF','Inactive',false),($4,$6,'FOREIGN','Foreign',true)",[center,otherCenter,inactiveCenter,foreignCenter,tenant,otherTenant]);
await db.query("INSERT INTO vendors(id,tenant_id,name,document) VALUES($1,$2,'Fornecedor XML','12345678000195')",[vendor,tenant]);
await db.query("INSERT INTO payment_methods(id,tenant_id,name,type) VALUES($1,$3,'Boleto conferido','boleto'),($2,$4,'Foreign payment','pix')",[method,foreignMethod,tenant,otherTenant]);
await db.query("INSERT INTO inventory_items(id,tenant_id,name,category,unit,current_stock,avg_cost,material_code,color,color_code) VALUES($1,$3,'PLA Branco','filament','g',1000,.05,'PLA','Branco','BRANCO'),($2,$3,'PLA Azul','filament','kg',1.5,40,'PLA','Azul','AZUL')",[grams,kilograms,tenant]);
await db.exec('SET ROLE authenticated');
const login=user=>db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[user]);
await login(owner);const today=await scalar('SELECT CURRENT_DATE::text');
const future=days=>{const date=new Date(today+'T12:00:00Z');date.setUTCDate(date.getUTCDate()+days);return date.toISOString().slice(0,10);};
const admin=async(fn)=>{await db.exec('RESET ROLE');try{return await fn();}finally{await db.exec('SET ROLE authenticated');}};
const parts=(changes={})=>[{amount:70,due_date:future(7),payment_method_id:method,account_id:expense,cost_center_id:center,installment_number:1,installment_total:2,...changes},{amount:140,due_date:future(45),payment_method_id:method,account_id:asset,cost_center_id:otherCenter,installment_number:2,installment_total:2}];
function draft({items,installments,order={}}={}){
 const key=String(sequence++).padStart(44,'7');
 return {order:{vendor_id:vendor,order_date:today,subtotal:200,discount:0,shipping:10,additional_costs:0,total:210,nfe_number:'123',nfe_key:key,nfe_xml:'<NFe><infNFe><cobr><dup><dVenc>'+future(7)+'</dVenc><vDup>70.00</vDup></dup></cobr><pag><detPag><vPag>210.00</vPag></detPag></pag></infNFe></NFe>',...order},
 items:items??[{description:'DESCRIÇÃO ORIGINAL DA NOTA / MODELO 01',quantity:2,unit_price:100,total:200,inventory_item_id:null,stock_quantity:null}],installments:installments??parts()};
}
const create=(data,key=next())=>scalar('SELECT create_purchase_order($1::jsonb,$2::jsonb,$3::jsonb,$4)',[JSON.stringify(data.order),JSON.stringify(data.items),JSON.stringify(data.installments),key]);
const quick=(data,receive=true,key=next())=>scalar('SELECT save_quick_purchase($1::jsonb,$2::jsonb,$3::jsonb,$4,$5)',[JSON.stringify({...data.order,receive_now:receive}),JSON.stringify(data.items),JSON.stringify(data.installments),key,receive]);
const receive=p=>scalar('SELECT receive_purchase_order($1,$2::date)',[p,today]);
const payables=p=>rows('SELECT amount,due_date::text,payment_method_id,account_id,cost_center_id,installment_number,installment_total,status::text,amount_paid FROM accounts_payable WHERE origin_id=$1 ORDER BY installment_number',[p]);
const stock=()=>rows('SELECT id,current_stock,avg_cost FROM inventory_items ORDER BY id');
const writes=()=>admin(()=>scalar("SELECT jsonb_build_object('orders',(SELECT count(*) FROM purchase_orders),'items',(SELECT count(*) FROM purchase_order_items),'payables',(SELECT count(*) FROM accounts_payable),'movements',(SELECT count(*) FROM inventory_movements),'requests',(SELECT count(*) FROM erp_private.requests),'audit',(SELECT count(*) FROM audit_log),'stock',(SELECT jsonb_agg(jsonb_build_array(id,current_stock,avg_cost) ORDER BY id) FROM inventory_items))"));
async function rejectsWithoutWrites(fn,pattern){const before=await writes();await assert.rejects(fn(),pattern);assert.deepEqual(await writes(),before);}
async function test(name,fn){await login(owner);try{await fn();passed++;console.log('PASS '+name);}catch(error){console.error('FAIL '+name+': '+error.message,error.where??'');throw error;}}
const bridge=next(),otherBridge=next(),seller='1088021376',secondSeller='1081358772';
const binding=()=>scalar('SELECT integrador_bridge_binding()');
const link=(sellerId=seller,account=null,key=next(),name='Conta selecionada')=>scalar('SELECT link_integrador_marketplace_account($1,$2,$3,$4)',[sellerId,name,account,key]);
const account=target=>scalar('SELECT to_jsonb(a) FROM marketplace_accounts a WHERE id=$1',[target]);
const state=()=>admin(()=>scalar("SELECT jsonb_build_object('accounts',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM marketplace_accounts a),'links',(SELECT jsonb_agg(to_jsonb(l) ORDER BY account_id) FROM integrador_marketplace_account_links l),'credentials',(SELECT count(*) FROM marketplace_credentials),'states',(SELECT count(*) FROM marketplace_oauth_states),'requests',(SELECT count(*) FROM erp_private.requests),'audit',(SELECT count(*) FROM audit_log))"));
try{
 await test('An unconfigured tenant gets safe empty metadata without fabricating a connected source',async()=>{
  assert.deepEqual(await binding(),{configured:false,bridge_id:null,source_url:'https://integradorwedo.lovable.app',revision:'unconfigured',enabled:false,approved_seller_ids:[],account_mappings:[]});await assert.rejects(link(),/fora do vínculo/);
 });
 await admin(async()=>{await db.query("INSERT INTO integrador_bridge_bindings(id,tenant_id,approved_seller_ids,approved_by,approval_note) VALUES($1,$3,$5,$6,'Explicit source seller approval'),($2,$4,ARRAY['999'],$7,'Other company source approval')",[bridge,otherBridge,tenant,otherTenant,[seller,secondSeller],owner,otherOwner]);});
 await test('Only an explicitly approved seller creates a local import account and a scoped mapping, without credentials',async()=>{
  const p=await link(),a=await account(p);assert.equal(a.external_seller_id,seller);assert.equal(a.connection_state,'import_only');assert.equal(await admin(()=>scalar('SELECT count(*)::int FROM marketplace_credentials')),0);const b=await binding();assert.equal(b.bridge_id,bridge);assert.deepEqual(b.approved_seller_ids,[seller,secondSeller]);assert.deepEqual(b.account_mappings,[{account_id:p,source_seller_id:seller,bridge_id:bridge}]);
 });
 await test('Unknown, malformed or foreign sellers cannot be attached and rejected requests have no partial effects',async()=>{
  for(const value of ['999','unknown','','1 OR 1=1']){const before=await state();await assert.rejects(link(value),/fora do vínculo/);assert.deepEqual(await state(),before);}
 });
 await test('A pending account can be explicitly selected without renaming it or keeping an older native OAuth attempt',async()=>{
  const p=await scalar("SELECT save_marketplace_account('mercado_livre','ELEVARE3D',NULL)");await admin(()=>db.query('INSERT INTO marketplace_oauth_states(account_id,user_id) VALUES($1,$2)',[p,owner]));assert.equal(await link(secondSeller,p),p);const a=await account(p);assert.equal(a.name,'ELEVARE3D');assert.equal(a.external_seller_id,secondSeller);assert.equal(await admin(()=>scalar('SELECT count(*)::int FROM marketplace_oauth_states WHERE account_id=$1',[p])),0);
 });
 await test('An accepted link retry returns its original result without another account, audit or credential',async()=>{
  const key=next(),p=await link(seller,null,key),before=await state();assert.equal(await link(seller,null,key),p);assert.deepEqual(await state(),before);await assert.rejects(link(secondSeller,null,key),/outra operação/);
 });
 await test('The same seller reuses its already linked local identity instead of duplicating the account',async()=>{
  const a=await link(),b=await link();assert.equal(a,b);assert.equal(await scalar('SELECT count(*)::int FROM marketplace_accounts WHERE external_seller_id=$1',[seller]),1);
 });
 await test('Native OAuth and direct credential inserts are rejected on source-bound accounts',async()=>{
  const p=await link(),before=await state();await assert.rejects(admin(()=>db.query('INSERT INTO marketplace_oauth_states(account_id,user_id) VALUES($1,$2)',[p,owner])),/proprietário único/);
  await assert.rejects(admin(()=>db.query("INSERT INTO marketplace_credentials(account_id,access_token,refresh_token,expires_at) VALUES($1,'SYNTHETIC_ACCESS','SYNTHETIC_REFRESH',now()+interval '1 hour')",[p])),/proprietário único/);assert.deepEqual(await state(),before);
 });
 await test('The deployed native persist RPC cannot bypass the single credential owner guard',async()=>{
  const p=await link();await admin(async()=>{const lease=await scalar('SELECT claim_marketplace_sync($1)',[p]);try{await assert.rejects(scalar('SELECT persist_marketplace_credentials($1,$2,$3,$4,$5,now()+interval \'1 hour\')',[p,lease,seller,'SYNTHETIC_ACCESS','SYNTHETIC_REFRESH']),/proprietário único/);}finally{await scalar('SELECT release_marketplace_sync($1,$2)',[p,lease]);}});assert.equal(await admin(()=>scalar('SELECT count(*)::int FROM marketplace_credentials WHERE account_id=$1',[p])),0);
 });
 await test('A native credential owner and a wrong-seller account remain intact instead of being silently transferred',async()=>{
  const native=await scalar("SELECT save_marketplace_account('mercado_livre','Native owner','555')");await admin(()=>db.query("INSERT INTO marketplace_credentials(account_id,access_token,refresh_token,expires_at) VALUES($1,'SYNTHETIC_NATIVE','SYNTHETIC_NATIVE_REFRESH',now()+interval '1 hour')",[native]));let before=await state();await assert.rejects(link(seller,native),/outro vendedor/);assert.deepEqual(await state(),before);
  await admin(()=>db.query('UPDATE marketplace_accounts SET external_seller_id=NULL WHERE id=$1',[native]));before=await state();await assert.rejects(link(seller,native),/autorização própria/);assert.deepEqual(await state(),before);
 });
 await test('Tenant and financial-role boundaries protect reads, linking and direct mapping writes',async()=>{
  const own=await link();await login(otherOwner);const b=await binding();assert.equal(b.bridge_id,otherBridge);assert.equal(b.account_mappings.length,0);await assert.rejects(link('999',own),/outro vendedor ou empresa/);for(const user of [viewer,operator]){await login(user);await assert.rejects(link(),/permissão/);await assert.rejects(db.query('INSERT INTO integrador_marketplace_account_links(account_id,tenant_id,bridge_id,source_seller_id,created_by) VALUES($1,$2,$3,$4,$5)',[own,tenant,bridge,seller,user]),/permission denied/);}await login(owner);
 });
 await test('Disabling approval stops new links while retaining every historical mapping and native order workflow',async()=>{
  const p=await link();await admin(()=>db.query('UPDATE integrador_bridge_bindings SET enabled=false WHERE id=$1',[bridge]));const b=await binding();assert.equal(b.configured,false);assert.ok(b.account_mappings.some(m=>m.account_id===p));await assert.rejects(link(),/fora do vínculo/);await admin(()=>db.query('UPDATE integrador_bridge_bindings SET enabled=true WHERE id=$1',[bridge]));assert.deepEqual(await admin(()=>Promise.all(signatures.map(sig=>scalar('SELECT pg_get_functiondef($1::regprocedure)',[sig])))),untouched);
 });
 console.log(`Integrador bridge: ${passed} tenant, explicit-link and credential-owner groups passed.`);
}finally{await db.close();}
