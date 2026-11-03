// Disposable database, synthetic tickets, and a captured pg_net queue only.
import {PGlite} from '@electric-sql/pglite';
import {readFile,readdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
const db=new PGlite(),migration='20261102243000_marketplace_price_freshness.sql';
await db.exec(`CREATE ROLE authenticated;CREATE ROLE anon;CREATE ROLE service_role;CREATE SCHEMA auth;
CREATE TABLE auth.users(id uuid PRIMARY KEY,email text);CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
CREATE SCHEMA storage;CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean);CREATE TABLE storage.objects(id uuid DEFAULT gen_random_uuid(),bucket_id text,name text,owner uuid);
CREATE FUNCTION storage.foldername(text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$SELECT string_to_array($1,'/')$$;
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;CREATE PUBLICATION supabase_realtime;GRANT USAGE ON SCHEMA public,auth,storage TO authenticated,anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO authenticated;`);
for(const name of (await readdir(new URL('../supabase/migrations/',import.meta.url))).filter(n=>n.endsWith('.sql')&&n<=migration).sort()){
 const sql=(await readFile(new URL('../supabase/migrations/'+name,import.meta.url),'utf8')).replace(/CREATE EXTENSION IF NOT EXISTS (pg_cron|pg_net);/g,'');
 try{await db.exec(sql);}catch(e){throw new Error(name+': '+e.message+' '+(e.where??'')+' '+sql.slice(Math.max(0,Number(e.position)-200),Number(e.position)+200));}
}
await db.exec(`CREATE SCHEMA net;CREATE TABLE net.captured(id bigserial PRIMARY KEY,url text,body jsonb,headers jsonb);
 CREATE FUNCTION net.http_post(url text,body jsonb DEFAULT '{}',params jsonb DEFAULT '{}',headers jsonb DEFAULT '{}',timeout_milliseconds integer DEFAULT 5000) RETURNS bigint LANGUAGE plpgsql AS $$DECLARE n bigint;BEGIN INSERT INTO net.captured(url,body,headers)VALUES(url,body,headers)RETURNING id INTO n;RETURN n;END$$;
 REVOKE ALL ON net.captured FROM PUBLIC,anon,authenticated;`);
const id=n=>`99000000-0000-4000-8000-${String(n).padStart(12,'0')}`;let seq=100,passed=0;const next=()=>id(seq++);
const tenant=id(1),foreignTenant=id(2),owner=id(3),viewer=id(4),operator=id(5),foreignOwner=id(6),bridge=id(7),stock=id(8),product=id(9),proof='b'.repeat(64);
const scalar=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0];
await db.query("INSERT INTO auth.users VALUES($1,'owner@automation.invalid'),($2,'viewer@automation.invalid'),($3,'operator@automation.invalid'),($4,'foreign@automation.invalid')",[owner,viewer,operator,foreignOwner]);
await db.query("INSERT INTO tenants(id,name,slug)VALUES($1,'Automation QA','automation-qa'),($2,'Foreign QA','foreign-auto-qa')",[tenant,foreignTenant]);
await db.query("INSERT INTO profiles(user_id,tenant_id,display_name)VALUES($1,$5,'Owner'),($2,$5,'Viewer'),($3,$5,'Operator'),($4,$6,'Foreign')",[owner,viewer,operator,foreignOwner,tenant,foreignTenant]);
await db.query("INSERT INTO user_roles(user_id,tenant_id,role)VALUES($1,$5,'owner'),($2,$5,'viewer'),($3,$5,'operator'),($4,$6,'owner')",[owner,viewer,operator,foreignOwner,tenant,foreignTenant]);
await db.query("INSERT INTO integrador_bridge_bindings(id,tenant_id,approved_seller_ids,allow_enrollment,approval_note)VALUES($1,$2,ARRAY['3694120570'],true,'Synthetic approved bridge, no remote requests')",[bridge,tenant]);
await db.query("INSERT INTO erp_private.integrador_enrollment_proofs(bridge_id,proof_sha256)VALUES($1,encode(sha256(convert_to($2,'UTF8')),'hex'))",[bridge,proof]);
await db.query("INSERT INTO inventory_items(id,tenant_id,name,unit,current_stock,avg_cost)VALUES($1,$2,'Finished QA','un',20,5)",[stock,tenant]);
await db.query("INSERT INTO products(id,tenant_id,name,category,sale_price,stock_item_id)VALUES($1,$2,'Product QA','printed_part',30,$3)",[product,tenant,stock]);
const login=async uid=>{await db.exec('SET ROLE authenticated');await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[uid]);};
const admin=async fn=>{await db.exec('RESET ROLE');try{return await fn();}finally{await db.exec('SET ROLE authenticated');}};
await login(owner);const account=await scalar("SELECT link_integrador_marketplace_account('3694120570','Elevare synthetic',NULL,$1)",[next()]);
await scalar("SELECT save_marketplace_sku_binding($1,'MLB123','','SKU',$2)",[account,product]);
const values=(change={})=>({orders_auto:false,stock_auto:false,price_auto:false,safety_stock:0,listing_type_default:'gold_special',interval_minutes:15,...change});
const read=()=>scalar('SELECT read_marketplace_automation($1)',[account]);
const save=async(v,key=next(),revision=null)=>scalar('SELECT save_marketplace_automation($1,$2,$3,$4)',[account,JSON.stringify(v),revision??(await read()).policy.revision,key]);
const sync=(key=next())=>scalar('SELECT request_marketplace_automation_sync($1,$2)',[account,key]);
const tick=()=>admin(()=>db.query('SELECT erp_private.marketplace_automation_tick()'));
const dispatch=()=>admin(async()=>{await db.query('SELECT erp_private.marketplace_automation_tick()');return (await db.query('SELECT body FROM net.captured ORDER BY id DESC LIMIT 1')).rows[0]?.body;});
const worker=async(job,operation,payload={},ticket=job.ticket,secret=proof)=>{await db.exec('SET ROLE anon');try{return await scalar('SELECT marketplace_automation_worker($1,$2,$3,$4,$5)',[job.job_id,ticket,secret,operation,JSON.stringify(payload)]);}finally{await db.exec('SET ROLE authenticated');}};
async function test(name,fn){await login(owner);await fn();passed++;console.log('PASS '+name);}
try{
 await test('Policies are isolated, explicitly off by default, and viewers can only read their company',async()=>{
  assert.deepEqual((await read()).policy,values({configured:false,revision:'not_configured'}));await tick();assert.equal(await admin(()=>scalar('SELECT count(*)::int FROM net.captured')),0);
  await login(viewer);assert.equal((await read()).status.pending_jobs,0);await assert.rejects(save(values()),/permissão/);await login(foreignOwner);await assert.rejects(read(),/não encontrada/);
 });
 await test('Financial save has strict input, optimistic concurrency and exact request replay',async()=>{
  await login(operator);await assert.rejects(save(values()),/permissão/);await login(owner);
  for(const bad of [{...values(),safety_stock:-1},{...values(),safety_stock:1.1},{...values(),interval_minutes:1},{...values(),orders_auto:null},{...values(),extra:true}])await assert.rejects(save(bad),/opções/);
  const key=next(),first=await save(values(),key,'not_configured');assert.equal(first.policy.configured,true);assert.equal(first.status.next_run_at,null);
  assert.deepEqual(await save(values(),key,'not_configured'),first);await assert.rejects(save(values({stock_auto:true}),key,'not_configured'),/outra operação|utilizado/);
  await assert.rejects(save(values(),next(),'not_configured'),/configuração mudou/);await assert.rejects(sync(),/Ative e salve/);
 });
 let job;
 await test('Only enabled actions are queued, bounded and dispatched with a private short-lived capability',async()=>{
  await save(values({stock_auto:true,safety_stock:3}));const key=next(),first=await sync(key);assert.equal(first.queued,1);assert.deepEqual(await sync(key),first);assert.equal((await sync()).queued,0);
  job=await dispatch();assert.match(job.ticket,/^[a-f0-9]{64}$/);assert.equal(job.bridge_id,bridge);assert.equal(Object.keys(job).length,3);
  await assert.rejects(db.query('SELECT * FROM erp_private.marketplace_automation_jobs'),/permission denied/);
  await assert.rejects(db.query('SELECT * FROM net.captured'),/permission denied/);
 });
 await test('A server proof alone or a ticket alone cannot authorize a job; delegation restores the original session',async()=>{
  await assert.rejects(worker(job,'context',{},'a'.repeat(64)),/expirou|autorizada/);await assert.rejects(worker(job,'context',{},job.ticket,'c'.repeat(64)),/não autorizado/);
  const before=await scalar("SELECT current_setting('request.jwt.claim.sub',true)");const context=await worker(job,'context');assert.equal(context.tenant_id,tenant);assert.equal(context.user_id,owner);assert.equal(context.action,'stock');assert.equal(await scalar("SELECT current_setting('request.jwt.claim.sub',true)"),before);
  const snapshot=await worker(job,'snapshot');assert.equal(snapshot.finishedAvailability[0].available,17);assert.equal(snapshot.products[0].available,20);assert.equal(snapshot.automationSafetyStock,3);
  await assert.rejects(worker(job,'orders',{orders:[]}),/inválidos/);
 });
 await test('Revoking the authorizing financial role stops a live job before any write',async()=>{
  await admin(()=>db.query("UPDATE user_roles SET role='viewer' WHERE user_id=$1 AND tenant_id=$2",[owner,tenant]));await assert.rejects(worker(job,'snapshot'),/permissão/);
  await admin(()=>db.query("UPDATE user_roles SET role='owner' WHERE user_id=$1 AND tenant_id=$2",[owner,tenant]));assert.equal((await worker(job,'snapshot')).tenantId,tenant);
 });
 await test('Confirmed receipts replay exactly and reject changed results without changing stock',async()=>{
  const receipt={confirmed:true,action:'stock',items:[{seller_id:'3694120570',item_id:'MLB123',quantity:17,status:'active'}],accepted_revision:'a'.repeat(64),replayed:false};
  assert.deepEqual(await worker(job,'complete',{result:receipt}),receipt);assert.deepEqual((await worker(job,'complete',{result:receipt})).result,receipt);
  await assert.rejects(worker(job,'complete',{result:{...receipt,items:[]}}),/outra confirmação/);assert.equal(await scalar('SELECT current_stock::float FROM inventory_items WHERE id=$1',[stock]),20);
 });
 await test('Automatic order ingestion is staging only unless the separately saved sales workflow enables organization',async()=>{
  await save(values({orders_auto:true}));await sync();job=await dispatch();assert.equal((await worker(job,'context')).action,'orders');
  const order={external_order_id:'900001',external_status:'paid',normalized_state:'paid',external_updated_at:'2026-11-02T12:00:00Z',shipping_deadline_at:'2026-11-05T18:00:00Z',deadline_source:'Synthetic SLA',currency:'BRL',shipping_amount:0,discount_amount:0,reported_total:30,items:[{external_line_id:'1',external_item_id:'MLB123',external_variant_id:'',external_sku:'SKU',description:'QA',quantity:1,unit_price:30}]};
  const payload={orders:[order]},first=await worker(job,'orders',payload);assert.equal(first.imported,1);assert.deepEqual((await worker(job,'orders',payload)).result,first);
  await assert.rejects(worker(job,'orders',{orders:[]}),/outra confirmação/);assert.equal(await scalar('SELECT count(*)::int FROM marketplace_orders WHERE account_id=$1',[account]),1);assert.equal(await scalar('SELECT count(*)::int FROM orders WHERE tenant_id=$1',[tenant]),0);assert.equal(await scalar('SELECT count(*)::int FROM accounts_receivable WHERE tenant_id=$1',[tenant]),0);
 });
 await test('Changing or disabling a policy invalidates old tickets and cancels queued transports',async()=>{
  await save(values({stock_auto:true}));await sync();job=await dispatch();await save(values());await assert.rejects(worker(job,'context'),/expirou|configuração/);assert.equal((await read()).status.next_run_at,null);
 });
 await test('An uncertain write is not requeued by cron or Sync now, even after another explicit policy save',async()=>{
  await save(values({stock_auto:true}));await sync();job=await dispatch();await worker(job,'context');await worker(job,'fail',{uncertain:true});assert.equal((await sync()).queued,0);await save(values({stock_auto:true}));assert.equal((await sync()).queued,0);assert.equal((await read()).status.failed_jobs,1);
 });
 await test('Review requires the Source lease proof and expired capability, revokes the old request and creates a fresh job',async()=>{
  const review=(secret=proof,key=next())=>scalar('SELECT review_marketplace_automation($1,$2,$3,$4)',[account,'stock',key,secret]);
  assert.deepEqual((await read()).status.needs_review_actions,['stock']);await assert.rejects(review(null),/servidor da integração/);await assert.rejects(review(),/ainda pode estar ativa/);
  await admin(()=>db.query("UPDATE erp_private.marketplace_automation_jobs SET ticket_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",[job.job_id]));
  const key=next(),result=await review(proof,key);assert.equal(result.queued,1);assert.deepEqual(result.status.needs_review_actions,[]);assert.deepEqual(await review(proof,key),result);
  await assert.rejects(worker(job,'complete',{result:{confirmed:true,action:'stock'}}),/expirou/);const nextJob=await dispatch();assert.notEqual(nextJob.job_id,job.job_id);assert.notEqual(nextJob.ticket,job.ticket);assert.equal((await worker(nextJob,'context')).action,'stock');
 });
 await test('Stock and automatic price snapshots require a current accepted cost and channel policy without changing physical stock',async()=>{
  const assumptions={commission_percent:0,tax_percent:0,fixed_fee_per_order:0,fixed_fee_per_item:0,seller_shipping_per_order:0,advertising_per_order:0,other_cost_per_order:0,target_margin:0};
  await admin(()=>db.query("UPDATE products SET manual_cost_override=5,cost_estimate=5,catalog_details='{}' WHERE id=$1",[product]));
  const policy=await scalar("SELECT channel_pricing_policy('mercado_livre')");await scalar("SELECT save_channel_pricing_policy('mercado_livre',$1,$2,$3)",[JSON.stringify(assumptions),policy.revision,next()]);
  const accept=async()=>{const preview=await scalar("SELECT product_channel_pricing_preview($1,'mercado_livre',1,'{}',30)",[product]);assert.equal(preview.complete,true);return scalar("SELECT apply_product_channel_pricing($1,'mercado_livre',1,'{}',$2,$3,$4,$5,30)",[product,preview.cost_revision,preview.policy_revision,preview.revision,next()]);};
  const price=()=>scalar('SELECT marketplace_stock_preview_snapshot($1,$2::uuid[])',[account,[product]]);
  await accept();let current=await price();assert.equal(current.products[0].acceptedMlPrice.complete,true);const previous=current.revision,available=current.products[0].available;
  await admin(()=>db.query('UPDATE products SET manual_cost_override=6 WHERE id=$1',[product]));current=await price();assert.equal(current.products[0].acceptedMlPrice.complete,false);assert.equal(current.products[0].priceComplete,false);assert.notEqual(current.revision,previous);assert.equal(current.products[0].available,available);
  await accept();assert.equal((await price()).products[0].acceptedMlPrice.complete,true);const latest=await scalar("SELECT channel_pricing_policy('mercado_livre')");await scalar("SELECT save_channel_pricing_policy('mercado_livre',$1,$2,$3)",[JSON.stringify({...assumptions,commission_percent:1}),latest.revision,next()]);assert.equal((await price()).products[0].acceptedMlPrice.complete,false);
  await accept();assert.equal((await price()).products[0].acceptedMlPrice.complete,true);
 });
 console.log(`PASS ${passed} marketplace automation database groups; no remote calls or marketplace writes`);
}finally{await db.close();}
