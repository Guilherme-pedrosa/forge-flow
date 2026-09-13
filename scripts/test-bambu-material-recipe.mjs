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
const recipe=(p,items)=>scalar('SELECT save_product_material_recipe($1,NULL,\'per_print\',$2::jsonb,NULL,$3,1)',[p,JSON.stringify(items),next()]);
const identify=(item,code)=>db.query('UPDATE inventory_items SET material_code=\'PLA\',color=$1,color_code=$1 WHERE id=$2',[code,item]);
try {
await identify(material,'WHITE');
const red=await owner(()=>scalar("INSERT INTO inventory_items(tenant_id,name,unit,current_stock,avg_cost) VALUES($1,'PLA red','g',1000,.03) RETURNING id",[tenant]));
await identify(red,'RED');
await test('Exact color is required at configuration, before any inventory write',async()=>{
  const p=await product(),t=await task(); await recipe(p,[{item_id:red,grams:100}]);
  const before=await scalar('SELECT count(*)::int FROM inventory_movements');
  await assert.rejects(configure(t,p),/materiais e cores/);
  assert.equal(await scalar('SELECT count(*)::int FROM inventory_movements'),before);
});
await test('A frozen production job keeps its original material after catalogue recipe revision',async()=>{
  const p=await product();await recipe(p,[{item_id:material,grams:100}]);
  const jobs=await scalar('SELECT create_jobs($1::jsonb,$2)',[JSON.stringify([{name:'Frozen white batch',product_id:p,printer_id:printer,status:'queued'}]),next()]);
  const frozen=await scalar('SELECT production_snapshot FROM jobs WHERE id=$1',[jobs[0]]);
  assert.equal(frozen.requirements[0].item_id,material);
  await recipe(p,[{item_id:red,grams:120}]);const t=await task();await configure(t,p,{allocations:[{job_id:jobs[0],quantity:2}]});
  const r=await account(t,{grams:95});assert.deepEqual(r.job_ids,jobs);
  assert.equal(await scalar('SELECT item_id FROM inventory_movements WHERE reference_id=$1',[t]),material);
});
await test('Measured consumption cannot silently override the material configured for the recipe',async()=>{
  const p=await product(),t=await task();await recipe(p,[{item_id:material,grams:100}]);await configure(t,p);
  const source=(await preview(t)).filaments[0].source_key;
  await assert.rejects(scalar('SELECT account_bambu_production($1,$2::jsonb,140,2,NULL,NULL,NULL,NULL,$3)',[t,JSON.stringify([{source_key:source,item_id:red,grams:95}]),next()]),/materiais e cores/);
  assert.equal(await scalar('SELECT count(*)::int FROM inventory_movements WHERE reference_id=$1',[t]),0);
  assert.equal((await preview(t)).record.posted_at,null);
});
await test('Every material in a multicolor failed attempt is debited once as loss using measured grams',async()=>{
  const p=await product();await recipe(p,[{item_id:material,grams:60},{item_id:red,grams:40}]);
  const t=await task('3',{amsDetailMapping:[{amsId:0,slotId:0,weight:60},{amsId:0,slotId:1,weight:40}]});
  const maps=(await preview(t)).filaments.map((f,i)=>({source_key:f.source_key,item_id:i?red:material}));
  await scalar('SELECT configure_bambu_production($1,$2,2,$3::jsonb,false,false,0,0,0,\'[]\',NULL)',[t,p,JSON.stringify(maps)]);
  const before=Number(await scalar('SELECT current_stock FROM inventory_items WHERE id=$1',[red]));
  const request=next(),args=[t,JSON.stringify(maps.map((m,i)=>({...m,grams:i?2:3}))),request];
  const sql="SELECT account_bambu_production($1,$2::jsonb,140,2,NULL,NULL,NULL,'Adhesion failure',$3)";
  const r=await scalar(sql,args);assert.equal(r.state,'posted');assert.deepEqual(await scalar(sql,args),r);
  assert.equal(Number(await scalar('SELECT current_stock FROM inventory_items WHERE id=$1',[red])),before-2);
  const movements=(await db.query('SELECT movement_type,quantity FROM inventory_movements WHERE reference_id=$1',[t])).rows;
  assert.equal(movements.length,2);assert.ok(movements.every(m=>m.movement_type==='loss'));
  assert.equal(await scalar('SELECT produced_quantity FROM jobs WHERE id=$1',[r.job_ids[0]]),0);
});
await test('A previously automatic profile is blocked when its mapped material conflicts with the revised recipe',async()=>{
  const p=await product(),t=await task('1');await recipe(p,[{item_id:material,grams:100}]);await configure(t,p,{auto:true});
  await owner(()=>db.query("UPDATE bambu_production_profiles SET auto_from='2026-09-13T07:00:00Z' WHERE product_id=$1",[p]));
  await recipe(p,[{item_id:red,grams:100}]);
  await owner(()=>db.query("UPDATE bambu_tasks SET status='2',raw_data=jsonb_set(raw_data,'{status}','2') WHERE id=$1",[t]));
  const v=await preview(t);assert.equal(v.record.posted_at,null);assert.match(v.record.problem,/materiais e cores/);
  assert.equal(await scalar('SELECT count(*)::int FROM inventory_movements WHERE reference_id=$1',[t]),0);
});
await test('A sale-derived unplated batch accepts its full two-piece Bambu allocation',async()=>{
  const p=await product();await recipe(p,[{item_id:material,grams:100}]);
  const customer=await scalar("INSERT INTO customers(tenant_id,name) VALUES($1,'Recipe buyer') RETURNING id",[tenant]);
  const due=await scalar('SELECT CURRENT_DATE::text');
  const order=await scalar('SELECT save_sales_order(NULL,$1::jsonb,$2::jsonb,$3)',[JSON.stringify({customer_id:customer,payment_due_date:due,due_date:due,total:30,shipping:0,discount:0}),JSON.stringify([{product_id:p,description:'Two-piece batch',quantity:3,unit_price:10,total:30}]),next()]);
  await scalar("SELECT transition_sales_order($1,'approved')",[order]);await scalar("SELECT transition_sales_order($1,'in_production')",[order]);
  const jobs=(await db.query('SELECT id,planned_quantity FROM jobs WHERE order_id=$1 ORDER BY id',[order])).rows;
  assert.equal(jobs.length,2);assert.ok(jobs.every(j=>j.planned_quantity===2));
  const t=await task();await configure(t,p,{allocations:[{job_id:jobs[0].id,quantity:2}]});const r=await account(t,{grams:99});
  assert.deepEqual(r.job_ids,[jobs[0].id]);assert.equal(await scalar('SELECT produced_quantity FROM jobs WHERE id=$1',[jobs[0].id]),2);
});
console.log(`Validated ${passed} Bambu material recipe scenarios.`);
} finally { await db.close(); }
