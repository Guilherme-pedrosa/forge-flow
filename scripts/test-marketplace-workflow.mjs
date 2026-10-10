import { PGlite } from '@electric-sql/pglite';
import { readdir, readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const db=new PGlite();
await db.exec(`CREATE ROLE authenticated; CREATE ROLE anon; CREATE ROLE service_role;
CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY,email text);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
CREATE SCHEMA storage; CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean);
CREATE TABLE storage.objects(id uuid DEFAULT gen_random_uuid(),bucket_id text,name text,owner uuid);
CREATE FUNCTION storage.foldername(text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$ SELECT string_to_array($1,'/') $$;
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY; CREATE PUBLICATION supabase_realtime;
GRANT USAGE ON SCHEMA public,auth,storage TO authenticated,anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO authenticated;`);
for(const name of (await readdir(new URL('../supabase/migrations/',import.meta.url))).filter(x=>x.endsWith('.sql')).sort()) {
 try {await db.exec((await readFile(new URL('../supabase/migrations/'+name,import.meta.url),'utf8')).replace(/CREATE EXTENSION IF NOT EXISTS (pg_cron|pg_net);/g,''));}
 catch(error){throw new Error(`Migration ${name}: ${error.message}`);}
}
const id=n=>`71000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const tenant=id(1),foreign=id(2),owner=id(3),operator=id(4),other=id(5),customer=id(6),foreignCustomer=id(7),product=id(8),stock=id(9);
let sequence=100,passed=0; const next=()=>id(sequence++);
const scalar=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0];
const row=async(sql,args=[])=> (await db.query(sql,args)).rows[0];
await db.query("INSERT INTO auth.users VALUES($1,'owner@qa.invalid'),($2,'operator@qa.invalid'),($3,'other@qa.invalid')",[owner,operator,other]);
await db.query("INSERT INTO tenants(id,name,slug) VALUES($1,'Workflow QA','workflow-qa'),($2,'Foreign QA','foreign-workflow-qa')",[tenant,foreign]);
await db.query("INSERT INTO profiles(user_id,tenant_id,display_name) VALUES($1,$4,'Owner'),($2,$4,'Operator'),($3,$5,'Other')",[owner,operator,other,tenant,foreign]);
await db.query("INSERT INTO user_roles(user_id,tenant_id,role) VALUES($1,$4,'owner'),($2,$4,'operator'),($3,$5,'owner')",[owner,operator,other,tenant,foreign]);
await db.query("INSERT INTO customers(id,tenant_id,name) VALUES($1,$3,'Channel customer'),($2,$4,'Foreign customer')",[customer,foreignCustomer,tenant,foreign]);
await db.query("INSERT INTO inventory_items(id,tenant_id,name,unit,current_stock,avg_cost) VALUES($1,$2,'Ready pieces','un',20,5)",[stock,tenant]);
await db.query("INSERT INTO products(id,tenant_id,name,category,sale_price,stock_item_id) VALUES($1,$2,'Ready product','printed_part',20,$3)",[product,tenant,stock]);
await db.exec('SET ROLE authenticated'); await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[owner]);
const account=await scalar("SELECT save_marketplace_account('shopee','Workflow shop',NULL)");
const policy=(fields={})=>({default_customer_id:customer,receivable_due_days:15,safety_buffer_hours:24,auto_organize:true,...fields});
const save=(values=policy(),request=next())=>scalar('SELECT save_marketplace_workflow_policy($1,$2::jsonb,$3)',[account,JSON.stringify(values),request]);
const order=(external,fields={})=>({external_order_id:external,external_status:'paid',normalized_state:'paid',external_updated_at:'2026-10-10T12:00:00-03:00',shipping_deadline_at:'2026-10-13T17:00:00-03:00',deadline_source:'official order',currency:'BRL',shipping_amount:0,discount_amount:0,reported_total:40,items:[{external_line_id:'1',external_item_id:'SKU-ID',external_variant_id:'BLUE',external_sku:'SKU',description:'Ready item',quantity:2,unit_price:20}],...fields});
const ingest=orders=>scalar('SELECT import_marketplace_orders($1,$2::jsonb)',[account,JSON.stringify(orders)]);
const counts=()=>row(`SELECT (SELECT count(*)::int FROM orders) orders,(SELECT count(*)::int FROM accounts_receivable) titles,(SELECT count(*)::int FROM jobs) jobs,(SELECT count(*)::int FROM bank_transactions) bank`);
const organize=(ids,request=next())=>scalar('SELECT organize_eligible_marketplace_orders($1,$2::uuid[],$3)',[account,ids,request]);
async function test(name,fn){await fn();passed++;console.log('PASS '+name);}
try {
 let staged;
 await test('Default import is inert and automatic policy requires explicit tenant-safe customer',async()=>{
  staged=(await ingest([order('STAGED')])).order_ids[0]; assert.deepEqual(await counts(),{orders:0,titles:0,jobs:0,bank:0});
  await assert.rejects(save(policy({default_customer_id:null})),/cliente ativo/);
  await assert.rejects(save(policy({default_customer_id:foreignCustomer})),/outra empresa/);
  await assert.rejects(save(policy({receivable_due_days:1.5})),/dias inteiros/);
  await assert.rejects(save(policy({safety_buffer_hours:24.001})),/168 horas/);
  await assert.rejects(db.query('INSERT INTO marketplace_workflow_policies(account_id,tenant_id) VALUES($1,$2)',[account,tenant]),/permission denied/);
 });
 await test('Policy retry is exact, audited once, and does not organize historical orders when enabled',async()=>{
  const request=next();await save(policy(),request);await save(policy(),request);
  await assert.rejects(save(policy({receivable_due_days:10}),request),/já utilizado/);
  assert.equal(await scalar("SELECT count(*)::int FROM audit_log WHERE action='marketplace_workflow_policy'"),1);
  assert.deepEqual(await counts(),{orders:0,titles:0,jobs:0,bank:0});
 });
 await test('Eligible mapped import uses ready stock once, creates pending gross receivable, and never books bank receipt',async()=>{
  await scalar("SELECT save_marketplace_sku_binding($1,'SKU-ID','BLUE','SKU',$2)",[account,product]);
  const imported=await ingest([order('AUTO')]);assert.equal(imported.workflow.organized,1);
  const sale=imported.workflow.results[0].order_id; assert.equal(imported.workflow.results[0].outcome,'stock_ready');
  assert.equal(await scalar('SELECT status FROM orders WHERE id=$1',[sale]),'ready');
  assert.equal(Number(await scalar('SELECT current_stock FROM inventory_items WHERE id=$1',[stock])),18);
  assert.equal(Number(await scalar('SELECT sum(amount_received) FROM accounts_receivable WHERE origin_id=$1',[sale])),0);
  assert.equal(Number(await scalar('SELECT sum(amount) FROM accounts_receivable WHERE origin_id=$1',[sale])),40);
  assert.equal(await scalar('SELECT o.payment_due_date=(o.created_at AT TIME ZONE t.timezone)::date+15 FROM orders o JOIN tenants t ON t.id=o.tenant_id WHERE o.id=$1',[sale]),true);
  assert.equal(await scalar("SELECT ship_by_at-internal_due_at=interval '24 hours' FROM orders WHERE id=$1",[sale]),true);
  assert.deepEqual(await counts(),{orders:1,titles:1,jobs:0,bank:0});
  assert.equal((await ingest([order('AUTO')])).workflow.results[0].outcome,'already_organized');
  assert.deepEqual(await counts(),{orders:1,titles:1,jobs:0,bank:0});
 });
 await test('Missing binding, cancellation, missing cutoff and mismatched totals are retained for review without stock or finance',async()=>{
  const before=await counts();const stockBefore=await scalar('SELECT current_stock FROM inventory_items WHERE id=$1',[stock]);
  const result=await ingest([order('UNMAPPED',{items:[{...order('X').items[0],external_sku:'UNKNOWN'}]}),order('CANCELLED',{normalized_state:'cancelled'}),order('NO-SLA',{shipping_deadline_at:null}),order('MONEY',{reported_total:41})]);
  assert.equal(result.workflow.organized,0);assert.equal(result.workflow.results.length,4);assert.ok(result.workflow.results.every(x=>x.outcome==='needs_review'));
  assert.deepEqual(await counts(),before);assert.equal(await scalar('SELECT current_stock FROM inventory_items WHERE id=$1',[stock]),stockBefore);
 });
 await test('Manual bulk organization has exact retry and rejects account mismatch atomically',async()=>{
  const request=next();const result=await organize([staged],request);assert.equal(result.organized,1);assert.deepEqual(await organize([staged],request),result);
  await assert.rejects(organize([staged,next()],request),/já utilizado/);
  await assert.rejects(organize([next()]),/Pedido não encontrado/);
  await assert.rejects(organize([staged,staged]),/distintos/);
 });
 await test('Incomplete technical product keeps a draft with issues and rolls back approval, receivable, OP, and allocations',async()=>{
  const incomplete=next();await db.exec('RESET ROLE');await db.query("INSERT INTO products(id,tenant_id,name,category,sale_price) VALUES($1,$2,'Incomplete','printed_part',20)",[incomplete,tenant]);await db.exec('SET ROLE authenticated');
  await scalar("SELECT save_marketplace_sku_binding($1,'SKU-ID','BLUE','INCOMPLETE',$2)",[account,incomplete]);
  const before=await counts();const result=await ingest([order('TECH',{items:[{...order('X').items[0],external_sku:'INCOMPLETE'}]})]);
  assert.equal(result.workflow.results[0].outcome,'needs_preparation');assert.ok(result.workflow.results[0].issues.length>0);
  const sale=result.workflow.results[0].order_id; assert.equal(await scalar('SELECT status FROM orders WHERE id=$1',[sale]),'draft');
  const after=await counts();assert.equal(after.orders,before.orders+1);assert.equal(after.titles,before.titles);assert.equal(after.jobs,before.jobs);
  assert.equal(await scalar('SELECT count(*)::int FROM production_orders WHERE source_order_id=$1',[sale]),0);
 });
 await test('Operator imports upstream facts but cannot enable policy or cause financial organization; other tenants cannot access policy',async()=>{
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[operator]);
  const before=await counts();const result=await ingest([order('OPERATOR')]);assert.match(result.workflow_issue,/gestor/);assert.deepEqual(await counts(),before);
  await assert.rejects(save(),/permissão/);await assert.rejects(organize([result.order_ids[0]]),/permissão/);
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[other]);assert.equal(await scalar('SELECT count(*)::int FROM marketplace_workflow_policies'),0);await assert.rejects(save(),/outra empresa/);
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[owner]);
 });
 await test('Turning off automation keeps mapped new imports staged and preserves existing organized work',async()=>{
  const before=await counts();await save(policy({auto_organize:false}));const result=await ingest([order('OFF')]);assert.equal(result.workflow,undefined);assert.deepEqual(await counts(),before);
 });
 console.log(`\n${passed} marketplace workflow contracts passed.`);
} finally {await db.close();}
