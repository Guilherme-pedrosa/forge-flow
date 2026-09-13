import { PGlite } from '@electric-sql/pglite';
import { readdir, readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
process.on('uncaughtException', error => { console.error(error.message, error.where ?? ''); process.exit(1); });

// Real PostgreSQL semantics, isolated fixtures, no network or physical printers.
const db = new PGlite();
await db.exec(`CREATE ROLE authenticated; CREATE ROLE anon; CREATE ROLE service_role;
  CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY,email text);
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
  CREATE SCHEMA storage; CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean);
  CREATE TABLE storage.objects(id uuid DEFAULT gen_random_uuid(),bucket_id text,name text,owner uuid);
  CREATE FUNCTION storage.foldername(text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$ SELECT string_to_array($1,'/') $$;
  ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY; CREATE PUBLICATION supabase_realtime;
  GRANT USAGE ON SCHEMA public,auth,storage TO authenticated,anon;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO authenticated;`);
for (const name of (await readdir(new URL('../supabase/migrations/', import.meta.url))).filter(n => n.endsWith('.sql')).sort()) {
  try { await db.exec((await readFile(new URL('../supabase/migrations/' + name, import.meta.url), 'utf8')).replace(/CREATE EXTENSION IF NOT EXISTS (pg_cron|pg_net);/g, '')); }
  catch (error) { throw new Error(`Migration ${name}: ${error.message}`); }
}
await db.exec('GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA storage TO authenticated;');
const id = n => `30000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const uid=id(1), otherUid=id(2), viewer=id(3), tenant=id(10), otherTenant=id(11), printer=id(20), otherModel=id(21), unavailable=id(22), red=id(30), blue=id(31), green=id(32), foreign=id(33);
const scalar = async (sql,args=[]) => Object.values((await db.query(sql,args)).rows[0])[0];
const row = async (sql,args=[]) => (await db.query(sql,args)).rows[0];
await db.query("INSERT INTO auth.users VALUES($1,'owner@qa.invalid'),($2,'other@qa.invalid'),($3,'viewer@qa.invalid')",[uid,otherUid,viewer]);
await db.query(`INSERT INTO tenants(id,name,slug,settings) VALUES($1,'Production QA','production-qa','{"energy_cost_kwh":1}'),($2,'Other','production-other','{}')`,[tenant,otherTenant]);
await db.query("INSERT INTO profiles(user_id,tenant_id,display_name) VALUES($1,$4,'Owner'),($2,$5,'Other'),($3,$4,'Viewer')",[uid,otherUid,viewer,tenant,otherTenant]);
await db.query("INSERT INTO user_roles(user_id,tenant_id,role) VALUES($1,$4,'owner'),($2,$5,'owner'),($3,$4,'viewer')",[uid,otherUid,viewer,tenant,otherTenant]);
await db.query("INSERT INTO printers(id,tenant_id,name,model,status,power_watts,depreciation_per_hour,maintenance_cost_per_hour) VALUES($1,$4,'A1 target','A1','idle',100,2,1),($2,$4,'P1S target','P1S','idle',100,2,1),($3,$4,'Offline A1','A1','offline',100,2,1)",[printer,otherModel,unavailable,tenant]);
await db.query("INSERT INTO inventory_items(id,tenant_id,name,unit,current_stock,avg_cost,material_code,color,color_code,color_hex) VALUES($1,$5,'Exact red PLA','kg',10,20,'PLA','Red','RED','#FF0000'),($2,$5,'Exact blue PLA','g',10000,0.03,'PLA','Blue','BLUE','#0000FF'),($3,$5,'Exact green PETG','g',10000,0.04,'PETG','Green','GREEN','#00FF00'),($4,$6,'Foreign red PLA','kg',10,20,'PLA','Red','RED','#FF0000')",[red,blue,green,foreign,tenant,otherTenant]);
await db.exec('SET ROLE authenticated'); await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[uid]);
let sequence=100,passed=0;
const next=()=>id(sequence++);
const reject=(sql,args,re)=>assert.rejects(db.query(sql,args),re);
async function owner(fn) { await db.exec('RESET ROLE'); try { return await fn(); } finally { await db.exec('SET ROLE authenticated'); } }
async function product(overrides={}) { return scalar("SELECT save_product_with_photos(NULL,$1::jsonb,'[]'::jsonb,$2)",[JSON.stringify({name:'File part '+sequence,category:'printed_part',material_id:red,prints_per_plate:2,est_grams:999,est_time_minutes:120,cost_estimate:999,sale_price:20,extras:[],...overrides}),next()]); }
const recipe=(p,lines=[{item_id:red,grams:20}],plate=null)=>scalar("SELECT save_product_material_recipe($1,$2,'per_unit',$3::jsonb,'Confirmed recipe',$4,2)",[p,plate,JSON.stringify(lines),next()]);
const createJob=async p=>(await scalar('SELECT create_jobs($1::jsonb,$2)',[JSON.stringify([{name:'Print batch',product_id:p,material_id:red,printer_id:printer,status:'queued',est_grams:999,est_total_cost:999,est_time_minutes:120}]),next()]))[0];
const review=j=>scalar('SELECT job_production_review($1)',[j]);
const prepare=(j,s,m=printer,reason='Checked plate and printer',request=next())=>scalar('SELECT prepare_job_print_file($1,$2,$3,$4,$5)',[j,s,m,reason,request]);
async function source(p,{sourceId=null,path=`${tenant}/${next()}/part.3mf`,name='part.3mf',plateIndex=null}={}) {
  await db.query("INSERT INTO storage.objects(bucket_id,name,owner) VALUES('attachments',$1,$2)",[path,uid]);
  const value=await scalar('SELECT save_product_print_source($1,$2,$3::jsonb)',[sourceId,p,JSON.stringify({file_path:path,file_name:name,file_sha256:'a'.repeat(64),label:name,plate_index:plateIndex})]);
  return {id:value,path};
}
const stock=()=>scalar('SELECT jsonb_object_agg(id,current_stock) FROM inventory_items WHERE tenant_id=$1',[tenant]);
const finish=(j,status='completed')=>scalar('SELECT transition_job($1,$2,30,60,0,$3,NULL,10,0,0,0)',[j,status,status==='failed'?'Measured failed attempt':null]);
async function test(name,fn) { try { await fn(); passed++; console.log('PASS '+name); } catch(error) { console.error('FAIL '+name+': '+error.message+' '+(error.where??'')); throw error; } }

try {
await test('Manual jobs preserve exact recipe, grams, cost and file hash rather than stale legacy estimates',async()=>{
  const p=await product(),version=await recipe(p,[{item_id:red,grams:20},{item_id:blue,grams:10}]),file=await source(p),j=await createJob(p),r=await review(j);
  assert.equal(r.origin,'catalog'); assert.equal(r.file.file_path,file.path); assert.equal(r.file.file_sha256,'a'.repeat(64));
  assert.equal(r.planned_quantity,2); assert.equal(Number(r.est_grams),60); assert.equal(Number(r.est_total_cost),5.4);
  assert.equal(r.requirements.find(x=>x.item_id===red).recipe_version_id,version);
  assert.equal(r.requirements.find(x=>x.item_id===red).required_grams,40); assert.equal(r.requirements.find(x=>x.item_id===red).current_stock_grams,10000);
  const frozen=await scalar('SELECT production_snapshot FROM jobs WHERE id=$1',[j]);
  await recipe(p,[{item_id:green,grams:100}]); await source(p,{sourceId:file.id});
  assert.deepEqual(await scalar('SELECT production_snapshot FROM jobs WHERE id=$1',[j]),frozen);
  assert.equal((await review(j)).file.file_path,file.path); assert.equal(Number((await review(j)).est_total_cost),5.4);
  await reject('UPDATE jobs SET material_id=$1 WHERE id=$2',[green,j],/materiais principal/);
});
await test('A missing file can be prepared later once, with audit and stable retry, without changing approved recipe',async()=>{
  const p=await product(); await recipe(p); const j=await createJob(p),before=await scalar('SELECT production_snapshot FROM jobs WHERE id=$1',[j]);
  assert.equal((await review(j)).file,null); const file=await source(p),request=next();
  await assert.rejects(prepare(j,file.id,printer,''),/justificativa/); assert.equal(await prepare(j,file.id,printer,'Prepared after quotation',request),j);
  assert.equal(await prepare(j,file.id,printer,'Prepared after quotation',request),j);
  assert.equal(await scalar("SELECT count(*)::int FROM audit_log WHERE record_id=$1 AND action='prepare_print_file'",[j]),1);
  const r=await review(j); assert.equal(r.file.origin,'file_added_after_recipe'); assert.equal(r.file.printer_model,'A1'); assert.equal(r.file.printer_profile_verified,false); assert.equal(r.dispatch_available,false);
  assert.deepEqual(await scalar('SELECT production_snapshot FROM jobs WHERE id=$1',[j]),before);
  await assert.rejects(prepare(j,file.id,printer,'Changed reason',request),/outra operação/);
  const replacement=await source(p); await assert.rejects(prepare(j,replacement.id),/arquivo congelado/);
});
await test('Wrong product, unavailable printer and model reassignment are rejected',async()=>{
  const p=await product(),q=await product(); await recipe(p);const j=await createJob(p),file=await source(p),wrong=await source(q);
  await assert.rejects(prepare(j,wrong.id),/permitida/); await assert.rejects(prepare(j,file.id,unavailable),/ativa e disponível/);
  await prepare(j,file.id); await reject("SELECT transition_job($1,'queued',NULL,NULL,NULL,NULL,$2)",[j,otherModel],/modelo/);
  await scalar("SELECT transition_job($1,'printing')",[j]); await assert.rejects(prepare(j,file.id),/antes de iniciar/);
  await scalar("SELECT transition_job($1,'failed',1,1,1,'Test pause end',NULL,NULL,0,0,0)",[j]);
});
await test('Storage prevents replacing or deleting a referenced file but permits removing an unused upload',async()=>{
  const p=await product(),file=await source(p);await recipe(p);const j=await createJob(p);
  assert.equal(await scalar('SELECT erp_print_file_is_referenced($1)',[file.path]),true);
  assert.equal((await db.query('DELETE FROM storage.objects WHERE name=$1 RETURNING id',[file.path])).rows.length,0);
  assert.equal((await db.query("UPDATE storage.objects SET name=name||'.replaced' WHERE name=$1 RETURNING id",[file.path])).rows.length,0);
  assert.equal((await review(j)).file.file_path,file.path);
  const unused=`${tenant}/${next()}/unused.stl`;await db.query("INSERT INTO storage.objects(bucket_id,name) VALUES('attachments',$1)",[unused]);
  assert.equal((await db.query('DELETE FROM storage.objects WHERE name=$1 RETURNING id',[unused])).rows.length,1);
});
await test('Preparing another tenant job is rejected and viewers can read without preparing',async()=>{
  const p=await product();await recipe(p);const file=await source(p),j=await createJob(p);
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[otherUid]);await assert.rejects(review(j),/não encontrada/);await assert.rejects(prepare(j,file.id),/antes de iniciar/);
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[viewer]);assert.equal((await review(j)).job_id,j);await assert.rejects(prepare(j,file.id),/permissão/);
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[uid]);
});
await test('Multi-plate queue freezes only the correct source and the material recipe of each plate',async()=>{
  const p=await product(),a=await source(p,{name:'base.3mf',plateIndex:1}),b=await source(p,{name:'lid.3mf',plateIndex:2});
  const makePlate=(file,index)=>scalar('SELECT save_product_print_plate(NULL,$1,$2,$3::jsonb)',[p,file.id,JSON.stringify({plate_index:index,label:index===1?'Base':'Lid',units_per_plate:2,material_id:red,printer_id:printer,est_grams:null,est_time_seconds:7200,est_cost_per_unit:null})]);
  const pa=await makePlate(a,1),pb=await makePlate(b,2);await recipe(p,[{item_id:red,grams:10}],pa);await recipe(p,[{item_id:blue,grams:20}],pb);
  const request=next(),ids=await scalar('SELECT plan_product_plates($1,3,$2)',[p,request]);assert.equal(ids.length,4);
  assert.deepEqual(await scalar('SELECT plan_product_plates($1,3,$2)',[p,request]),ids);
  await reject('SELECT plan_product_plates($1,4,$2)',[p,request],/outra operação/);
  for(const j of ids) {const r=await review(j);const base=r.plate.id===pa;assert.equal(r.file.file_path,base?a.path:b.path);assert.equal(r.requirements.length,1);assert.equal(r.requirements[0].item_id,base?red:blue);assert.equal(Number(r.est_grams),base?20:40);assert.equal(r.planned_quantity,2);await assert.rejects(prepare(j,base?b.id:a.id),/permitida/);}
});
await test('Three-material manual failure rolls back all debits; accounting must cover every exact material',async()=>{
  const p=await product();await recipe(p,[{item_id:red,grams:10},{item_id:blue,grams:10},{item_id:green,grams:10}]);const j=await createJob(p);assert.equal((await review(j)).manual_accounting_supported,false);
  await scalar("SELECT transition_job($1,'printing')",[j]);const before=await stock();await assert.rejects(finish(j,'failed'),/três ou mais materiais/);
  assert.deepEqual(await stock(),before);assert.equal(await scalar('SELECT inventory_posted_at FROM jobs WHERE id=$1',[j]),null);
  assert.equal(await scalar("SELECT count(*)::int FROM inventory_movements WHERE reference_type='job' AND reference_id=$1",[j]),0);
  await assert.rejects(owner(()=>db.query("UPDATE jobs SET inventory_posted_at=now(),actual_material_usage=$1::jsonb WHERE id=$2",[JSON.stringify([{item_id:red,grams:10},{item_id:blue,grams:10}]),j])),/todos e somente/);
  await owner(()=>db.query("UPDATE jobs SET inventory_posted_at=now(),actual_material_usage=$1::jsonb,status='failed' WHERE id=$2",[JSON.stringify([red,blue,green].map(item_id=>({item_id,grams:0}))),j]));
  // Privileged fixture exercises the trigger only; production RPC owns the ledger.
  assert.deepEqual(await stock(),before);
});
await test('Two exact materials account actual weights, then a reprint inherits recipe and file after catalogue revision',async()=>{
  const p=await product();await recipe(p,[{item_id:red,grams:20},{item_id:blue,grams:10}]);await source(p);const j=await createJob(p);
  const frozen=await row('SELECT production_snapshot,print_file_snapshot FROM jobs WHERE id=$1',[j]);
  await scalar("SELECT transition_job($1,'printing')",[j]);const before=await stock();await finish(j,'failed');const after=await stock();assert.equal(Number(after[red]).toFixed(6),(Number(before[red])-.02).toFixed(6));assert.equal(Number(after[blue]),Number(before[blue])-10);
  await recipe(p,[{item_id:green,grams:200}]);const reprint=await scalar("SELECT transition_job($1,'reprint')",[j]);
  const child=await row('SELECT production_snapshot,print_file_snapshot,production_snapshot_origin,planned_quantity FROM jobs WHERE id=$1',[reprint]);
  assert.deepEqual(child.production_snapshot,frozen.production_snapshot);assert.deepEqual(child.print_file_snapshot,frozen.print_file_snapshot);assert.equal(child.production_snapshot_origin,'reprint');assert.equal(child.planned_quantity,2);
});
await test('An issued quote preserves file version and recipe through conversion and production even after the catalogue changes',async()=>{
  const p=await product();await recipe(p);const file=await source(p),customer=await scalar("INSERT INTO customers(tenant_id,name) VALUES($1,'Quoted customer') RETURNING id",[tenant]);
  const date=await scalar("SELECT (CURRENT_DATE+30)::text");const q=await scalar('SELECT save_sales_quote(NULL,$1::jsonb,$2::jsonb,$3)',[JSON.stringify({customer_id:customer,valid_until:date,due_date:date,payment_due_date:date,discount:0,shipping:0,total:60}),JSON.stringify([{product_id:p,description:'Exact red part',quantity:3,unit_price:20,total:60}]),next()]);
  await scalar("SELECT transition_sales_quote($1,'issued')",[q]);await scalar("SELECT transition_sales_quote($1,'approved')",[q]);
  await recipe(p,[{item_id:blue,grams:100}]);await source(p,{sourceId:file.id});const order=await scalar('SELECT convert_sales_quote($1,$2)',[q,next()]);
  await scalar("SELECT transition_sales_order($1,'in_production')",[order]);const jobs=(await db.query('SELECT id FROM jobs WHERE order_id=$1',[order])).rows;assert.equal(jobs.length,2);
  for(const j of jobs) {const r=await review(j.id);assert.equal(r.origin,'approved_order');assert.equal(r.file.file_path,file.path);assert.equal(r.requirements[0].item_id,red);assert.equal(Number(r.est_grams),40);assert.equal(Number(r.est_total_cost),4.8);}
  assert.equal(await scalar('SELECT erp_print_file_is_referenced($1)',[file.path]),true);
});
console.log(`\n${passed} production file PostgreSQL scenarios passed.`);
} finally { await db.close(); }
