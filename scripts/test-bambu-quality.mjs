import { PGlite } from '@electric-sql/pglite';
import { readdir,readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
process.on('uncaughtException',error=>{console.error(error.message,error.where??'');process.exit(1);});

const db=new PGlite();
await db.exec(`CREATE ROLE authenticated;CREATE ROLE anon;CREATE ROLE service_role;
CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY,email text);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
CREATE SCHEMA storage;CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean);
CREATE TABLE storage.objects(id uuid DEFAULT gen_random_uuid(),bucket_id text,name text,owner uuid);
CREATE FUNCTION storage.foldername(text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$ SELECT string_to_array($1,'/') $$;
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;CREATE PUBLICATION supabase_realtime;
GRANT USAGE ON SCHEMA public,auth,storage TO authenticated,anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO authenticated;`);
for(const name of(await readdir(new URL('../supabase/migrations/',import.meta.url))).filter(n=>n.endsWith('.sql')).sort()){
  try{await db.exec((await readFile(new URL('../supabase/migrations/'+name,import.meta.url),'utf8')).replace(/CREATE EXTENSION IF NOT EXISTS (pg_cron|pg_net);/g,''));}
  catch(error){throw new Error(`Migration ${name}: ${error.message}`);}
}
const id=n=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const uid=id(1),otherUid=id(2),viewer=id(3),tenant=id(10),otherTenant=id(11),printer=id(20),device=id(21),connection=id(22),material=id(30),otherMaterial=id(31);
const scalar=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0];
const row=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
await db.query("INSERT INTO auth.users VALUES($1,'owner@qa.invalid'),($2,'other@qa.invalid'),($3,'viewer@qa.invalid')",[uid,otherUid,viewer]);
await db.query(`INSERT INTO tenants(id,name,slug,settings) VALUES($1,'Bambu QA','bambu-qa','{"energy_cost_kwh":1}'),($2,'Other','bambu-other','{}')`,[tenant,otherTenant]);
await db.query("INSERT INTO profiles(user_id,tenant_id,display_name) VALUES($1,$4,'Owner'),($2,$5,'Other'),($3,$4,'Viewer')",[uid,otherUid,viewer,tenant,otherTenant]);
await db.query("INSERT INTO user_roles(user_id,tenant_id,role) VALUES($1,$4,'owner'),($2,$5,'owner'),($3,$4,'viewer')",[uid,otherUid,viewer,tenant,otherTenant]);
await db.query("INSERT INTO printers(id,tenant_id,name,model,status,power_watts,depreciation_per_hour,maintenance_cost_per_hour) VALUES($1,$2,'Bambu QA','A1','idle',100,2,1)",[printer,tenant]);
await db.query("INSERT INTO bambu_connections(id,tenant_id) VALUES($1,$2)",[connection,tenant]);
await db.query("INSERT INTO bambu_devices(id,tenant_id,connection_id,printer_id,dev_id,name) VALUES($1,$2,$3,$4,'DEVICE-QA','Printer QA')",[device,tenant,connection,printer]);
await db.query("INSERT INTO inventory_items(id,tenant_id,name,unit,current_stock,avg_cost) VALUES($1,$3,'PLA measured','kg',10,20),($2,$4,'Other material','g',1000,0.02)",[material,otherMaterial,tenant,otherTenant]);
await db.exec('SET ROLE authenticated');await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[uid]);
async function owner(fn){await db.exec('RESET ROLE');try{return await fn();}finally{await db.exec('SET ROLE authenticated');}}
const reject=(sql,args,re)=>assert.rejects(db.query(sql,args),re);
let sequence=100,passed=0;
const next=()=>id(sequence++);
async function product(){return scalar('SELECT save_product_with_photos(NULL,$1::jsonb,\'[]\'::jsonb,$2)',[JSON.stringify({name:'Printed product '+sequence,category:'printed_part',material_id:material,prints_per_plate:2,est_grams:100,est_time_minutes:120,cost_estimate:4,sale_price:10}),next()]);}
async function task(status='2',overrides={}){
  const taskId=next();const raw={id:taskId,modelId:'model-'+taskId,profileId:100,plateIndex:1,status:Number(status),weight:100,costTime:9000,startTime:'2026-09-13T08:00:00Z',endTime:'2026-09-13T08:02:20Z',amsDetailMapping:[{amsId:0,slotId:0,filamentType:'PLA',sourceColor:'FFFFFF',targetColor:'FFFFFF',weight:100}],...overrides};
  await owner(()=>db.query("INSERT INTO bambu_tasks(id,tenant_id,bambu_device_id,bambu_task_id,status,weight_grams,cost_time_seconds,start_time,end_time,raw_data) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)",[taskId,tenant,device,String(raw.id),String(raw.status),raw.weight,raw.costTime,raw.startTime,raw.endTime,JSON.stringify(raw)]));return taskId;
}
const preview=t=>scalar('SELECT bambu_production_preview($1)',[t]);
async function configure(t,p,{auto=false,slicer=true,units=2,allocations=[],plate=null}={}){
  const v=await preview(t);const mappings=v.filaments.map(f=>({source_key:f.source_key,item_id:material}));
  await scalar('SELECT configure_bambu_production($1,$2,$3,$4::jsonb,$5,$6,0,0,0,$7::jsonb,$8)',[t,p,units,JSON.stringify(mappings),auto,slicer,JSON.stringify(allocations),plate]);return mappings;
}
async function account(t,{grams=null,seconds=null,units=null,reason=null,request=next()}={}){
  const mappings=(await preview(t)).filaments.map((f,i)=>({source_key:f.source_key,item_id:material,grams:Array.isArray(grams)?grams[i]:grams}));
  return scalar('SELECT account_bambu_production($1,$2::jsonb,$3,$4,NULL,NULL,NULL,$5,$6)',[t,grams===null?null:JSON.stringify(mappings),seconds,units,reason,request]);
}
async function test(name,fn){try{await fn();passed++;console.log('PASS '+name);}catch(error){console.error('FAIL '+name+': '+error.message+' '+(error.where??''));throw error;}}

const qualityReject=(job,reason='Rejected at quality inspection')=>scalar("SELECT transition_job($1,'failed',NULL,NULL,NULL,$2)",[job,reason]);
const snapshot=()=>row('SELECT current_stock,(SELECT total_prints FROM printers WHERE id=$2) prints,(SELECT total_failures FROM printers WHERE id=$2) failures,(SELECT total_print_hours FROM printers WHERE id=$2) hours FROM inventory_items WHERE id=$1',[material,printer]);
async function completed({jobs=1,units=2,seconds=null,plate=null,p=null}={}){
  p??=await product();const t=await task('2',plate?{plateIndex:plate.index}:{});
  const planned=plate?await scalar('SELECT plan_product_plates($1,$2,$3)',[p,units,next()]):null;
  const ids=planned?(await db.query('SELECT id FROM jobs WHERE id=ANY($1::uuid[]) AND print_plate_id=$2 ORDER BY id',[planned,plate.id])).rows.map(j=>j.id):await scalar('SELECT create_jobs($1::jsonb,$2)',[JSON.stringify(Array.from({length:jobs},(_,n)=>({name:'Allocated '+n,product_id:p,printer_id:printer,material_id:material,status:'queued'}))),next()]);
  await configure(t,p,{units,allocations:ids.map((job_id,n)=>({job_id,quantity:n===jobs-1?units-jobs+1:1})),plate:plate?.id??null});
  return {p,t,r:await account(t,{seconds}),ids};
}
try{
await test('A quality rejection preserves physical completion and cost, with no second material debit',async()=>{
  const {p,t,r,ids}=await completed();const before=await snapshot();
  await qualityReject(ids[0]);const after=await snapshot();
  assert.equal(after.current_stock,before.current_stock);assert.equal(after.prints,before.prints);assert.equal(after.hours,before.hours);assert.equal(Number(after.failures),Number(before.failures)+1);
  const j=await row('SELECT status,produced_quantity,waste_grams,actual_grams,actual_total_cost FROM jobs WHERE id=$1',[ids[0]]);
  assert.equal(j.status,'failed');assert.equal(j.produced_quantity,0);assert.equal(j.waste_grams,j.actual_grams);assert.equal(Number(j.actual_total_cost),Number(r.total_cost));
  const q=await row('SELECT quantity,grams,elapsed_seconds,material_cost,total_cost,reason FROM bambu_quality_rejections WHERE job_id=$1',[ids[0]]);
  assert.equal(q.quantity,2);assert.equal(Number(q.grams),100);assert.equal(Number(q.elapsed_seconds),140);assert.equal(Number(q.material_cost),2);assert.equal(Number(q.total_cost),Number(r.total_cost));
  const v=await row('SELECT * FROM bambu_production_review WHERE task_id=$1',[t]);assert.equal(v.outcome,'completed');assert.equal(v.state,'posted');assert.equal(v.completed_units,0);assert.equal(v.quality_state,'rejected');
  const reference=await row('SELECT actual_print_sample_units,actual_print_cost_per_unit FROM products WHERE id=$1',[p]);assert.equal(reference.actual_print_sample_units,null);assert.equal(reference.actual_print_cost_per_unit,null);
  assert.equal(await scalar("SELECT count(*)::integer FROM inventory_movements WHERE reference_type='bambu_task' AND reference_id=$1",[t]),1);
});
await test('Partial quality loss removes only the allocated units and exact allocated cents from reference averages',async()=>{
  const {p,t,ids,r}=await completed({jobs:2,units:3});const before=await snapshot();
  const rejectJob=await row('SELECT actual_total_cost,actual_material_cost FROM jobs WHERE id=$1',[ids[0]]);
  await qualityReject(ids[0]);
  const v=await row('SELECT * FROM bambu_production_review WHERE task_id=$1',[t]);assert.equal(v.completed_units,2);assert.equal(v.quality_state,'partially_rejected');assert.equal(v.quality_rejected_units,1);
  const ref=await row('SELECT actual_print_sample_units,actual_print_grams_per_unit,actual_print_seconds_per_unit,actual_print_cost_per_unit FROM products WHERE id=$1',[p]);
  assert.equal(ref.actual_print_sample_units,2);assert.ok(Math.abs(Number(ref.actual_print_grams_per_unit)-100/3)<1e-10);assert.ok(Math.abs(Number(ref.actual_print_seconds_per_unit)-140/3)<1e-10);
  assert.ok(Math.abs(Number(ref.actual_print_cost_per_unit)-(Number(r.total_cost)-Number(rejectJob.actual_total_cost))/2)<1e-10);
  assert.equal((await snapshot()).current_stock,before.current_stock);
  const sibling=await row('SELECT status,produced_quantity FROM jobs WHERE id=$1',[ids[1]]);assert.equal(sibling.status,'quality_check');assert.equal(sibling.produced_quantity,2);
});
await test('Several rejected jobs in one physical task count one failure and repeated calls remain idempotent',async()=>{
  const {p,t,ids}=await completed({jobs:3,units:3});const before=await snapshot();
  for(const j of ids){await qualityReject(j);await qualityReject(j);}
  const after=await snapshot();assert.equal(Number(after.failures),Number(before.failures)+1);assert.equal(after.prints,before.prints);assert.equal(after.current_stock,before.current_stock);
  assert.equal(await scalar('SELECT count(*)::integer FROM bambu_quality_rejections WHERE task_id=$1',[t]),3);
  assert.equal(await scalar('SELECT completed_units FROM bambu_production_review WHERE task_id=$1',[t]),0);
  assert.equal(await scalar('SELECT actual_print_sample_units FROM products WHERE id=$1',[p]),null);
  const freshRequest=await account(t);assert.equal(freshRequest.state,'posted');assert.equal((await snapshot()).current_stock,after.current_stock);assert.equal((await snapshot()).failures,after.failures);
});
await test('A rejection keeps other completed runs in the reference with their own elapsed time',async()=>{
  const one=await completed();const two=await completed({p:one.p,seconds:20});
  await qualityReject(one.ids[0]);const ref=await row('SELECT actual_print_sample_units,actual_print_seconds_per_unit,actual_print_cost_per_unit FROM products WHERE id=$1',[one.p]);
  assert.equal(ref.actual_print_sample_units,2);assert.equal(Number(ref.actual_print_seconds_per_unit),10);assert.equal(Number(ref.actual_print_cost_per_unit),Number(two.r.total_cost)/2);
  assert.equal(Number(await scalar('SELECT elapsed_seconds FROM bambu_production_review WHERE task_id=$1',[two.t])),20);
});
await test('All active plates remain summed per product; rejecting one plate removes its observed sample only',async()=>{
  const p=await product();
  const savePlate=(index,label,cost)=>scalar('SELECT save_product_print_plate(NULL,$1,NULL,$2::jsonb)',[p,JSON.stringify({plate_index:index,label,units_per_plate:2,material_id:material,printer_id:printer,est_grams:100,est_time_seconds:140,est_cost_per_unit:cost})]);
  const base=await savePlate(1,'Base',5),lid=await savePlate(2,'Lid',7);
  const a=await completed({p,plate:{id:base,index:1}}),b=await completed({p,plate:{id:lid,index:2}});
  assert.equal(Number(await scalar('SELECT actual_print_cost_per_unit FROM products WHERE id=$1',[p])),(Number(a.r.total_cost)+Number(b.r.total_cost))/2);
  await qualityReject(a.ids[0]);
  const ref=await row('SELECT actual_print_cost_per_unit,cost_estimate FROM products WHERE id=$1',[p]);assert.equal(ref.actual_print_cost_per_unit,null);assert.ok(Math.abs(Number(ref.cost_estimate)-5-Number(b.r.total_cost)/2)<1e-10);
  assert.equal(await scalar('SELECT actual_sample_units FROM product_print_plates WHERE id=$1',[base]),null);assert.equal(await scalar('SELECT actual_sample_units FROM product_print_plates WHERE id=$1',[lid]),2);
});
await test('Historical posted samples without allocations are preserved',async()=>{
  const p=await product(),t=await task();
  await owner(()=>db.query("UPDATE bambu_production_records SET product_id=$3,units=2,state='posted',outcome='completed',total_grams=90,elapsed_seconds=60,total_cost=3,consumption_source='measured',posted_at=now() WHERE task_id=$1 AND tenant_id=$2",[t,tenant,p]));
  await owner(()=>db.query('SELECT erp_private.update_product_print_actuals($1)',[p]));
  const ref=await row('SELECT actual_print_sample_units,actual_print_cost_per_unit FROM products WHERE id=$1',[p]);assert.equal(ref.actual_print_sample_units,2);assert.equal(Number(ref.actual_print_cost_per_unit),1.5);
});
await test('Missing quality reason rolls back status, counters, references and rejection records',async()=>{
  const {p,t,ids}=await completed();const before=await snapshot();
  await assert.rejects(qualityReject(ids[0],''),/motivo/);assert.deepEqual(await snapshot(),before);assert.equal(await scalar('SELECT status FROM jobs WHERE id=$1',[ids[0]]),'quality_check');
  assert.equal(await scalar('SELECT count(*)::integer FROM bambu_quality_rejections WHERE task_id=$1',[t]),0);assert.equal(await scalar('SELECT actual_print_sample_units FROM products WHERE id=$1',[p]),2);
});
await test('A downstream rejection integrity error rolls back the legacy status and counter changes',async()=>{
  const {t,ids}=await completed();const before=await snapshot();
  await owner(()=>db.query('UPDATE jobs SET actual_total_cost=NULL WHERE id=$1',[ids[0]]));
  await assert.rejects(qualityReject(ids[0]),/null value|not-null/);assert.deepEqual(await snapshot(),before);assert.equal(await scalar('SELECT status FROM jobs WHERE id=$1',[ids[0]]),'quality_check');
  assert.equal(await scalar('SELECT count(*)::integer FROM bambu_quality_rejections WHERE task_id=$1',[t]),0);
});
await test('Other tenants and viewers cannot reject; clients cannot fabricate or erase quality history',async()=>{
  const {ids}=await completed();await qualityReject(ids[0]);
  await assert.rejects(db.query('DELETE FROM bambu_quality_rejections WHERE job_id=$1',[ids[0]]),/permission denied/);
  await assert.rejects(db.query('UPDATE bambu_quality_rejections SET quantity=999 WHERE job_id=$1',[ids[0]]),/permission denied/);
  await assert.rejects(db.query("SELECT erp_private.transition_job_before_bambu_quality($1,'failed')",[ids[0]]),/permission denied/);
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[otherUid]);
  assert.equal(await scalar('SELECT count(*)::integer FROM bambu_quality_rejections WHERE job_id=$1',[ids[0]]),0);
  await assert.rejects(qualityReject(ids[0]),/não encontrada/);
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[viewer]);await assert.rejects(qualityReject(ids[0]),/permissão/);
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[uid]);
});
await test('Physical failures keep their original loss and one failure counter without quality fabrication',async()=>{
  const p=await product(),t=await task('3');await configure(t,p);const r=await account(t,{grams:3,reason:'Bed adhesion'});const before=await snapshot();
  await qualityReject(r.job_ids[0]);assert.deepEqual(await snapshot(),before);assert.equal(await scalar('SELECT count(*)::integer FROM bambu_quality_rejections WHERE task_id=$1',[t]),0);
  const copy=await scalar("SELECT transition_job($1,'reprint')",[r.job_ids[0]]);assert.notEqual(copy,r.job_ids[0]);assert.equal(await scalar('SELECT status FROM jobs WHERE id=$1',[copy]),'reprint');
});
console.log(`Validated ${passed} Bambu quality scenarios.`);
}finally{await db.close();}
