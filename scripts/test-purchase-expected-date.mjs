import { PGlite } from '@electric-sql/pglite';
import { readdir, readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

// An isolated PostgreSQL contract test; never connects to a tenant database.
const db = new PGlite();
// CURRENT_DATE in fixtures must use the same calendar as the test companies.
await db.exec("SET TIME ZONE 'America/Sao_Paulo'");
await db.exec(`CREATE ROLE authenticated; CREATE ROLE anon; CREATE ROLE service_role;
 CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY,email text);
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 CREATE SCHEMA storage; CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean);
 CREATE TABLE storage.objects(id uuid DEFAULT gen_random_uuid(),bucket_id text,name text,owner uuid);
 CREATE FUNCTION storage.foldername(text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$ SELECT string_to_array($1,'/') $$;
 ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;CREATE PUBLICATION supabase_realtime;
 GRANT USAGE ON SCHEMA public,auth,storage TO authenticated,anon;
 ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO authenticated;`);
for (const name of (await readdir(new URL('../supabase/migrations/', import.meta.url))).filter(n => n.endsWith('.sql') && !(process.argv.includes('--baseline') && n === '20261010130000_purchase_expected_date_review.sql')).sort()) {
 const sql = (await readFile(new URL('../supabase/migrations/' + name, import.meta.url), 'utf8')).replace(/CREATE EXTENSION IF NOT EXISTS (pg_cron|pg_net);/g, '');
 try { await db.exec(sql); } catch (error) { throw new Error(`Migration ${name}: ${error.message}`, { cause: error }); }
}
const id = n => `73000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const user=id(1), otherUser=id(2), viewer=id(3), operator=id(4), tenant=id(10), otherTenant=id(11), material=id(20), bank=id(30);
await db.query("INSERT INTO auth.users VALUES($1,'owner@qa.invalid'),($2,'other@qa.invalid'),($3,'viewer@qa.invalid'),($4,'operator@qa.invalid')",[user,otherUser,viewer,operator]);
await db.query("INSERT INTO tenants(id,name,slug) VALUES($1,'Purchase QA','purchase-qa'),($2,'Other QA','other-purchase-qa')",[tenant,otherTenant]);
await db.query("INSERT INTO profiles(user_id,tenant_id,display_name) VALUES($1,$5,'Owner'),($2,$6,'Other'),($3,$5,'Viewer'),($4,$5,'Operator')",[user,otherUser,viewer,operator,tenant,otherTenant]);
await db.query("INSERT INTO user_roles(user_id,tenant_id,role) VALUES($1,$5,'owner'),($2,$6,'owner'),($3,$5,'viewer'),($4,$5,'operator')",[user,otherUser,viewer,operator,tenant,otherTenant]);
await db.query("INSERT INTO inventory_items(id,tenant_id,name,category,unit,current_stock,avg_cost,loss_coefficient) VALUES($1,$2,'PLA vermelho','filament','g',300,0.1,0)",[material,tenant]);
await db.query("INSERT INTO bank_accounts(id,tenant_id,name,initial_balance) VALUES($1,$2,'Main',1000)",[bank,tenant]);
await db.query("INSERT INTO accounts_receivable(tenant_id,description,amount,due_date) VALUES($1,'Unrelated receipt',50,CURRENT_DATE)",[tenant]);
const scalar=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0];
const row=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
let sequence=1000; const request=()=>id(sequence++);
const login=who=>db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[who]);
const asOwner=async fn=>{await db.exec('RESET ROLE');try{return await fn();}finally{await db.exec('SET ROLE authenticated');}};
await db.exec('SET ROLE authenticated'); await login(user);
const today=await scalar('SELECT CURRENT_DATE::text');
const nextDate=await scalar("SELECT (CURRENT_DATE+7)::text");
const laterDate=await scalar("SELECT (CURRENT_DATE+14)::text");
const create=async({expectedDate=null,xml=false}={})=>scalar('SELECT create_purchase_order($1::jsonb,$2::jsonb,$3::jsonb,$4)',[
 JSON.stringify({order_date:today,expected_date:expectedDate,subtotal:100,shipping:10,discount:0,total:110,nfe_number:xml?'123':null,nfe_key:xml?request():null,nfe_xml:xml?'<NFe><infNFe/></NFe>':null,notes:'Confirmed grouped delivery'}),
 JSON.stringify([{description:'1 rolo PLA vermelho',quantity:1,unit_price:100,total:100,inventory_item_id:material,stock_quantity:1000}]),
 JSON.stringify([{description:'Compra parcela 1',amount:55,due_date:today,installment_number:1,installment_total:2},{description:'Compra parcela 2',amount:55,due_date:laterDate,installment_number:2,installment_total:2}]),request()]);
const setDate=(purchase,date,key=request())=>scalar('SELECT set_purchase_expected_date($1,$2::text,$3)',[purchase,date,key]);
const audit=purchase=>db.query("SELECT user_id,tenant_id,old_data,new_data,metadata FROM audit_log WHERE record_id=$1 AND action='purchase_expected_date_review' ORDER BY created_at,id",[purchase]).then(r=>r.rows);
const requestCount=key=>asOwner(()=>scalar('SELECT count(*)::int FROM erp_private.requests WHERE tenant_id=$1 AND request_id=$2',[tenant,key]));
const protectedSnapshot=purchase=>row(`SELECT
 (SELECT to_jsonb(po)-ARRAY['expected_date','updated_at'] FROM purchase_orders po WHERE id=$1) purchase,
 (SELECT jsonb_agg(to_jsonb(i) ORDER BY i.id) FROM purchase_order_items i WHERE purchase_order_id=$1) items,
 (SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) FROM accounts_payable p) payables,
 (SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM accounts_receivable r) receivables,
 (SELECT jsonb_agg(to_jsonb(i) ORDER BY i.id) FROM inventory_items i) stock,
 (SELECT jsonb_agg(to_jsonb(m) ORDER BY m.id) FROM inventory_movements m) movements,
 (SELECT jsonb_agg(to_jsonb(b) ORDER BY b.id) FROM bank_accounts b) banks`,[purchase]);
let passed=0;const errors=[];
async function test(name,fn){await login(user);try{await fn();passed++;console.log('PASS '+name);}catch(error){errors.push({name,error});console.error('FAIL '+name+': '+error.message+(error.where?' — '+error.where:''));}}
await test('Saved XML purchase gains ETA without changing commercial lines, installments, balances or XML',async()=>{
 const purchase=await create({xml:true}), before=await protectedSnapshot(purchase), key=request();
 assert.equal(await scalar('SELECT purchase_expected_date_review_available()'),true);
 assert.equal(await setDate(purchase,nextDate,key),purchase);
 assert.equal(await scalar('SELECT expected_date::text FROM purchase_orders WHERE id=$1',[purchase]),nextDate);
 assert.deepEqual(await protectedSnapshot(purchase),before);
 assert.deepEqual(await audit(purchase),[{user_id:user,tenant_id:tenant,old_data:{expected_date:null},new_data:{expected_date:nextDate},metadata:{request_id:key}}]);
});
await test('Retries and no-op revisions preserve one audit; request identity cannot be reused for a changed forecast',async()=>{
 const purchase=await create(), key=request();
 assert.deepEqual(await Promise.all([setDate(purchase,nextDate,key),setDate(purchase,nextDate,key)]),[purchase,purchase]);
 assert.equal((await audit(purchase)).length,1);assert.equal(await requestCount(key),1);
 await assert.rejects(setDate(purchase,laterDate,key),/Identificador já utilizado/);
 assert.equal(await scalar('SELECT expected_date::text FROM purchase_orders WHERE id=$1',[purchase]),nextDate);
 await setDate(purchase,nextDate);assert.equal((await audit(purchase)).length,1);
 await setDate(purchase,laterDate);assert.equal((await audit(purchase)).length,2);
});
await test('Explicit NULL clears ETA and invalid ISO/calendar dates leave no request or audit behind',async()=>{
 const purchase=await create({expectedDate:nextDate}), before=await protectedSnapshot(purchase), key=request();
 await setDate(purchase,null,key);await setDate(purchase,null,key);
 assert.equal(await scalar('SELECT expected_date FROM purchase_orders WHERE id=$1',[purchase]),null);
 assert.deepEqual((await audit(purchase))[0].new_data,{expected_date:null});
 for(const date of ['', 'today', 'infinity', '2026-2-03', '2026-02-30', '2026-13-01', '2026-00-10', '0000-01-01', '2026-10-10T00:00:00Z']){
   const badKey=request();await assert.rejects(setDate(purchase,date,badKey),/previsão válida/);assert.equal(await requestCount(badKey),0);
 }
 assert.equal((await audit(purchase)).length,1);assert.deepEqual(await protectedSnapshot(purchase),before);
 await assert.rejects(setDate(purchase,nextDate,null),/Identificador/);
});
await test('Received, cancelled and draft purchases reject a new ETA without stock or finance effects',async()=>{
 for(const status of ['received','cancelled','draft']){
   const purchase=await create();
   if(status==='received') await scalar('SELECT receive_purchase_order($1,$2::date)',[purchase,today]);
   else if(status==='cancelled') await scalar("SELECT cancel_purchase_order($1)",[purchase]);
   else await asOwner(()=>db.query("UPDATE purchase_orders SET status='draft' WHERE id=$1",[purchase]));
   const before=await protectedSnapshot(purchase),key=request();
   await assert.rejects(setDate(purchase,nextDate,key),/somente em compras pendentes/);
   assert.equal(await requestCount(key),0);assert.equal((await audit(purchase)).length,0);
   assert.deepEqual(await protectedSnapshot(purchase),before);
 }
});
await test('Tenant boundary, viewer, operator and anonymous cannot revise ETA or bypass the RPC',async()=>{
 const purchase=await create(),key=request();
 await login(otherUser);await assert.rejects(setDate(purchase,nextDate,key),/não encontrada nesta empresa/);
 for(const who of [viewer,operator]){
   await login(who);assert.equal(await scalar('SELECT purchase_expected_date_review_available()'),false);
   await assert.rejects(setDate(purchase,nextDate,key),/permissão/);
 }
 await login(user);assert.equal(await requestCount(key),0);
 assert.equal((await db.query('UPDATE purchase_orders SET expected_date=$2::date WHERE id=$1 RETURNING id',[purchase,nextDate])).rows.length,0);
 await db.exec('SET ROLE anon');await login(null);
 await assert.rejects(setDate(purchase,nextDate,key),/permission denied/);
 await assert.rejects(scalar('SELECT purchase_expected_date_review_available()'),/permission denied/);
 await db.exec('SET ROLE authenticated');await login(user);
 assert.equal(await scalar('SELECT expected_date FROM purchase_orders WHERE id=$1',[purchase]),null);assert.equal((await audit(purchase)).length,0);
});
await test('An audit write failure rolls ETA and request back; the same retry can then commit exactly once',async()=>{
 const purchase=await create(), key=request(), before=await protectedSnapshot(purchase);
 await asOwner(()=>db.exec(`CREATE FUNCTION public.test_fail_expected_date_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='purchase_expected_date_review' THEN RAISE EXCEPTION 'Injected audit failure'; END IF; RETURN NEW; END $$;
 CREATE TRIGGER test_fail_expected_date_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION public.test_fail_expected_date_audit();`));
 try { await assert.rejects(setDate(purchase,nextDate,key),/Injected audit failure/); }
 finally { await asOwner(()=>db.exec('DROP TRIGGER test_fail_expected_date_audit ON audit_log; DROP FUNCTION public.test_fail_expected_date_audit();')); }
 assert.equal(await scalar('SELECT expected_date FROM purchase_orders WHERE id=$1',[purchase]),null);
 assert.equal(await requestCount(key),0);assert.equal((await audit(purchase)).length,0);assert.deepEqual(await protectedSnapshot(purchase),before);
 await setDate(purchase,nextDate,key);await setDate(purchase,nextDate,key);assert.equal((await audit(purchase)).length,1);
});
console.log(`${passed} passed; ${errors.length} failed${process.argv.includes('--baseline')?' against pre-1300 baseline':''}`);
await db.close();if(errors.length)process.exitCode=1;
