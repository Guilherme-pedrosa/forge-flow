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
try{
await test('Bambu 1 and 4 remain in progress even with end timestamp; planned time is never elapsed time',async()=>{
  for(const status of ['1','4']){const t=await task(status);const v=await preview(t);assert.equal(v.outcome,'printing');assert.equal(v.elapsed_seconds,null);await assert.rejects(account(t),/Associe/);}
});
await test('Full completed slicer consumption needs explicit opt-in and debits once by physical attempt',async()=>{
  const p=await product(),t=await task();await configure(t,p);const before=Number(await scalar('SELECT current_stock FROM inventory_items WHERE id=$1',[material]));
  const r=await account(t);assert.equal(r.state,'posted');assert.equal(Number(await scalar('SELECT current_stock FROM inventory_items WHERE id=$1',[material])),before-.1);
  const j=await row('SELECT actual_time_seconds,actual_time_minutes,actual_grams,status FROM jobs WHERE id=$1',[r.job_ids[0]]);assert.equal(Number(j.actual_time_seconds),140);assert.equal(j.actual_time_minutes,3);assert.equal(j.status,'quality_check');
  const again=await account(t);assert.deepEqual(again,r);assert.equal(await scalar("SELECT count(*)::integer FROM inventory_movements WHERE reference_type='bambu_task' AND reference_id=$1",[t]),1);
  assert.equal(Number(await scalar('SELECT actual_print_seconds_per_unit FROM products WHERE id=$1',[p])),70,JSON.stringify(await row('SELECT outcome,state,units,elapsed_seconds,total_cost,total_grams FROM bambu_production_records WHERE task_id=$1',[t])));
});
await test('A failed 140-second attempt never consumes the predicted 100 grams; measured 3 grams become loss',async()=>{
  const p=await product(),t=await task('3');await configure(t,p);await assert.rejects(account(t,{reason:'Stopped'}),/gramas efetivamente/);
  const before=Number(await scalar('SELECT current_stock FROM inventory_items WHERE id=$1',[material]));const r=await account(t,{grams:3,reason:'Adhesion failure'});
  const j=await row('SELECT status,actual_grams,waste_grams,produced_quantity,sale_price FROM jobs WHERE id=$1',[r.job_ids[0]]);assert.equal(j.status,'failed');assert.equal(Number(j.actual_grams),3);assert.equal(Number(j.waste_grams),3);assert.equal(j.produced_quantity,0);assert.equal(j.sale_price,null);
  assert.equal(Number(await scalar('SELECT current_stock FROM inventory_items WHERE id=$1',[material])),before-.003);assert.equal(await scalar('SELECT actual_print_cost_per_unit FROM products WHERE id=$1',[p]),null);
  assert.equal(await scalar("SELECT movement_type::text FROM inventory_movements WHERE reference_type='bambu_task' AND reference_id=$1",[t]),'loss');
});
await test('Skipped objects on a completed task require measured grams and cannot use full-file weight',async()=>{
  const p=await product(),t=await task('2',{skipObjects:[1]});await configure(t,p);await assert.rejects(account(t),/gramas efetivamente/);await account(t,{grams:20,units:1});
  assert.equal(Number(await scalar('SELECT actual_print_grams_per_unit FROM products WHERE id=$1',[p])),20);
});
await test('Multi-material posting rolls back every debit and job if a later material has insufficient stock',async()=>{
  const low=await owner(()=>scalar("INSERT INTO inventory_items(tenant_id,name,unit,current_stock,avg_cost) VALUES($1,'Empty PLA','g',0,0.02) RETURNING id",[tenant]));
  const t=await task('2',{weight:100,amsDetailMapping:[{amsId:0,slotId:0,weight:50},{amsId:0,slotId:1,weight:50}]});const p=await product();const v=await preview(t);
  const map=v.filaments.map((f,i)=>({source_key:f.source_key,item_id:i?low:material}));await scalar('SELECT configure_bambu_production($1,$2,1,$3::jsonb,false,true,0,0,0,\'[]\',NULL)',[t,p,JSON.stringify(map)]);
  const before=await scalar('SELECT current_stock FROM inventory_items WHERE id=$1',[material]);await assert.rejects(account(t),/Saldo|saldo|estoque/);
  assert.equal(await scalar('SELECT current_stock FROM inventory_items WHERE id=$1',[material]),before);assert.equal(await scalar('SELECT count(*)::integer FROM jobs WHERE bambu_task_id=$1',[t]),0);
});
await test('Two order jobs receive one physical execution with exact cents and one printer counter increment',async()=>{
  const p=await product(),t=await task();const ids=await scalar('SELECT create_jobs($1::jsonb,$2)',[JSON.stringify([1,2].map(n=>({name:'Unit '+n,product_id:p,printer_id:printer,material_id:material,status:'queued'}))),next()]);
  await configure(t,p,{allocations:ids.map(job_id=>({job_id,quantity:1}))});const before=Number(await scalar('SELECT total_prints FROM printers WHERE id=$1',[printer]));const r=await account(t);
  assert.equal(r.job_ids.length,2);assert.equal(Number(await scalar('SELECT total_prints FROM printers WHERE id=$1',[printer])),before+1);
  assert.equal(Number(await scalar('SELECT sum(actual_total_cost) FROM jobs WHERE id=ANY($1::uuid[])',[ids])),Number(r.total_cost));
  assert.equal(Number(await scalar('SELECT sum(actual_time_seconds) FROM jobs WHERE id=ANY($1::uuid[])',[ids])),140);
});
await test('Automatic tracking starts at configuration cutoff and updates a formerly running task once',async()=>{
  const p=await product(),t=await task('1');await configure(t,p,{auto:true});await owner(()=>db.query("UPDATE bambu_production_profiles SET auto_from='2026-09-13T07:00:00Z' WHERE product_id=$1",[p]));
  const before=Number(await scalar('SELECT current_stock FROM inventory_items WHERE id=$1',[material]));await owner(()=>db.query("UPDATE bambu_tasks SET status='2',raw_data=jsonb_set(raw_data,'{status}','2') WHERE id=$1",[t]));
  assert.equal((await preview(t)).record.state,'posted');assert.equal(Number(await scalar('SELECT current_stock FROM inventory_items WHERE id=$1',[material])),before-.1);
  await owner(()=>db.query("UPDATE bambu_tasks SET synced_at=now(),raw_data=raw_data WHERE id=$1",[t]));assert.equal(Number(await scalar('SELECT current_stock FROM inventory_items WHERE id=$1',[material])),before-.1);
});
await test('Historical tasks before activation and failed attempts never auto-debit',async()=>{
  const p=await product(),t=await task('2');await configure(t,p,{auto:true});const before=await scalar('SELECT current_stock FROM inventory_items WHERE id=$1',[material]);
  await owner(()=>db.query('UPDATE bambu_tasks SET raw_data=raw_data WHERE id=$1',[t]));assert.equal(await scalar('SELECT current_stock FROM inventory_items WHERE id=$1',[material]),before);assert.equal((await preview(t)).record.posted_at,null);
});
await test('Cross-tenant materials and client-forged cloud observations are rejected',async()=>{
  const p=await product(),t=await task();const v=await preview(t);
  await reject('SELECT configure_bambu_production($1,$2,1,$3::jsonb,false,false,0,0,0,\'[]\',NULL)',[t,p,JSON.stringify([{source_key:v.filaments[0].source_key,item_id:otherMaterial}])],/outra empresa|inválid/);
  await reject("UPDATE bambu_tasks SET status='2' WHERE id=$1",[t],/permission denied/);
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[viewer]);await reject('SELECT configure_bambu_production($1,$2,1,\'[]\',false,false,0,0,0,\'[]\',NULL)',[t,p],/permissão/);await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[uid]);
});
await test('Terminal tasks cannot regress to a stale running snapshot',async()=>{
  const t=await task('2');await owner(()=>db.query("UPDATE bambu_tasks SET status='4',weight_grams=999,raw_data='{}' WHERE id=$1",[t]));assert.equal((await preview(t)).outcome,'completed');assert.equal((await preview(t)).planned_grams,100);
});
await test('A missing remote status cannot post measured consumption or auto-account',async()=>{
  const p=await product(),t=await task('1');await configure(t,p,{auto:true});
  await owner(()=>db.query("UPDATE bambu_production_profiles SET auto_from='2026-09-13T07:00:00Z' WHERE product_id=$1",[p]));
  const before=await scalar('SELECT current_stock FROM inventory_items WHERE id=$1',[material]);
  await owner(()=>db.query("UPDATE bambu_tasks SET status=NULL,raw_data=jsonb_set(raw_data,'{status}','null') WHERE id=$1",[t]));
  await assert.rejects(account(t,{grams:2,seconds:20}),/confirmou o encerramento/);
  assert.equal((await preview(t)).record.posted_at,null);
  assert.equal(await scalar('SELECT current_stock FROM inventory_items WHERE id=$1',[material]),before);
});
console.log(`Validated ${passed} Bambu accounting scenarios.`);
}finally{await db.close();}
