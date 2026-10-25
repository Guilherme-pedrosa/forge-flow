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


const sha='a'.repeat(64);
await owner(()=>db.query("UPDATE inventory_items SET material_code='PLA',color='Branco',color_code='WHITE',color_hex='#FFFFFF' WHERE id=$1",[material]));
async function filePlate({hash=sha,profile='local:'+sha,model='imported-model',index=1}={}){
 const p=await product();
 const source=await scalar('SELECT save_product_print_source(NULL,$1,$2::jsonb)',[p,JSON.stringify({label:'Imported file',file_sha256:hash,model_id:model,profile_id:profile})]);
 const plate=await scalar('SELECT save_product_print_plate(NULL,$1,$2,$3::jsonb)',[p,source,JSON.stringify({plate_index:index,label:'Homogeneous plate',units_per_plate:2,material_id:material,printer_id:printer,est_grams:100,est_time_seconds:7200})]);
 await scalar("SELECT save_product_material_recipe($1,$2,'per_print',$3::jsonb,NULL,$4,0)",[p,plate,JSON.stringify([{item_id:material,grams:100}]),next()]);
 return {p,source,plate};
}
const confirm=(x,t,hash=sha)=>scalar('SELECT bind_file_plate_execution($1,$2,$3)',[x.plate,t,hash]);
const learning=x=>scalar('SELECT product_plate_learning($1)',[x.plate]);
async function onePart(x,name='Part'){
 const id=await scalar('SELECT save_product_subitem($1,NULL,$2::jsonb,$3)',[x.p,JSON.stringify({name,quantity_per_product:1,plate_id:x.plate,quantity_per_plate:2}),next()]);
 return row('SELECT id,component_product_id FROM product_subitems WHERE id=$1',[id]);
}
async function approve(x,r,part,good=2){
 return scalar("SELECT confirm_subitem_output($1,$2::jsonb,'Confirmed physical quality',$3)",[r.job_ids[0],JSON.stringify([{component_product_id:part.component_product_id,good_quantity:good}]),next()]);
}
let fixture,printed,part;
await test('Explicit SHA confirmation preserves imported model/profile/plate and records remote identity separately',async()=>{
 fixture=await filePlate();const t=await task('2',{modelId:'cloud-model',profileId:999,plateIndex:2});
 const before=await row('SELECT model_id,profile_id,plate_index,source_id,updated_at FROM product_print_plates WHERE id=$1',[fixture.plate]);
 const sourceBefore=await row('SELECT * FROM product_print_sources WHERE id=$1',[fixture.source]);
 await reject('SELECT bind_product_print_plate($1,$2)',[fixture.plate,t],/Confirme explicitamente/);
 await confirm(fixture,t);await confirm(fixture,t);
 assert.deepEqual(await row('SELECT model_id,profile_id,plate_index,source_id,updated_at FROM product_print_plates WHERE id=$1',[fixture.plate]),before);
 assert.deepEqual(await row('SELECT * FROM product_print_sources WHERE id=$1',[fixture.source]),sourceBefore);
 const binding=await row('SELECT profile_id,remote_plate_index,confirmation,file_sha256 FROM product_print_execution_bindings WHERE plate_id=$1',[fixture.plate]);
 assert.equal(binding.profile_id,'999');assert.equal(binding.remote_plate_index,2);assert.equal(binding.confirmation,'file_confirmation');assert.equal(binding.file_sha256,sha);
 assert.equal((await preview(t)).candidate_plate_id,fixture.plate);assert.equal(await scalar('SELECT count(*)::int FROM product_print_execution_bindings WHERE plate_id=$1',[fixture.plate]),1);
 fixture.t=t;
});
await test('Wrong hash, cross-tenant tasks and viewers cannot confirm a file association',async()=>{
 const other=await filePlate();const t=await task();
 await assert.rejects(confirm(other,t,'b'.repeat(64)),/arquivo mudou|SHA256/);
 await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[viewer]);await assert.rejects(confirm(other,t),/permissão/);
 await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[otherUid]);await assert.rejects(confirm(other,t),/mesma empresa/);
 await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[uid]);
});
await test('A confirmation alone never posts history, creates a profile or debits material',async()=>{
 assert.equal((await preview(fixture.t)).record.state,'unlinked');
 assert.equal(await scalar('SELECT count(*)::int FROM bambu_production_profiles'),0);
 assert.equal(Number(await scalar('SELECT current_stock FROM inventory_items WHERE id=$1',[material])),10);
 assert.equal(await learning(fixture),null);
});
await test('A configured homogeneous execution learns only after accounting and explicit per-SKU quality',async()=>{
 part=await onePart(fixture);await configure(fixture.t,fixture.p,{plate:fixture.plate,units:2});
 printed=await account(fixture.t);
 assert.equal(await learning(fixture),null);
 await approve(fixture,printed,part);
 const learned=await learning(fixture);assert.equal(Number(learned.grams),50);assert.equal(Number(learned.print_seconds),70);assert.equal(Number(learned.sample_units),2);assert.equal(Number(learned.sample_runs),1);
 assert.equal(learned.consumption_source,'slicer_completed');assert.equal(learned.time_source,'elapsed_start_end');assert.equal(learned.materials[0].material,'PLA');assert.equal(learned.materials[0].color,'Branco');
 const sheet=await scalar('SELECT product_piece_spec($1)',[part.component_product_id]);assert.equal(sheet.source,'bambu');assert.equal(Number(sheet.grams),50);assert.equal(Number(sheet.print_seconds),70);
 assert.equal(sheet.learned_reference.file_sha256,sha);assert.equal(sheet.materials[0].item_id,material);
});
await test('A manual sheet remains authoritative instead of being overwritten by learned metrics',async()=>{
 const spec={materials:[{item_id:material,grams:7,material:null,color:null,cost_per_kg:null}],print_seconds:12,finishing_seconds:0,machine_hour_cost:0,labor_hour_cost:0,extra_cost:0,pieces_per_plate:2,notes:'Manual remains primary',revision:null};
 await scalar('SELECT save_product_piece_spec($1,$2::jsonb,$3)',[part.component_product_id,JSON.stringify(spec),next()]);
 const sheet=await scalar('SELECT product_piece_spec($1)',[part.component_product_id]);assert.equal(sheet.source,'manual');assert.equal(Number(sheet.grams),7);assert.equal(Number(sheet.print_seconds),12);
});
await test('A different active file revision invalidates old execution learning without rewriting posted records',async()=>{
 const before=await row('SELECT execution_binding_id,execution_binding_fingerprint,posted_at,total_grams FROM bambu_production_records WHERE task_id=$1',[fixture.t]);
 await scalar('SELECT save_product_print_source($1,$2,$3::jsonb)',[fixture.source,fixture.p,JSON.stringify({label:'Revised file',file_sha256:'c'.repeat(64),model_id:'imported-model',profile_id:'local:'+'c'.repeat(64)})]);
 assert.equal(await learning(fixture),null);
 assert.deepEqual(await row('SELECT execution_binding_id,execution_binding_fingerprint,posted_at,total_grams FROM bambu_production_records WHERE task_id=$1',[fixture.t]),before);
 const t=await task('2',{modelId:'cloud-model',profileId:999,plateIndex:2});await reject('SELECT bind_product_print_plate($1,$2)',[fixture.plate,t],/Confirme explicitamente/);
 await assert.rejects(confirm(fixture,t),/arquivo mudou|SHA256/);
});
await test('Mixed physical plates never invent a per-SKU or per-unit reference',async()=>{
 const x=await filePlate();const t=await task();await confirm(x,t);await onePart(x,'First');await onePart(x,'Second');
 assert.equal(await learning(x),null);
});
await test('Clients cannot modify bindings or forge frozen execution identity',async()=>{
 await reject('UPDATE product_print_execution_bindings SET source_fingerprint=\'fake\' WHERE plate_id=$1',[fixture.plate],/permission denied/);
 await reject('UPDATE bambu_production_records SET execution_binding_fingerprint=\'fake\' WHERE task_id=$1',[fixture.t],/permission denied/);
});
await test('Distinct explicitly confirmed Bambu profiles never pool their samples into one sheet',async()=>{
 const x=await filePlate();const b=await onePart(x);const first=await task('2',{modelId:'profile-isolation',profileId:700});
 await confirm(x,first);await configure(first,x.p,{plate:x.plate,units:2});const r1=await account(first);await approve(x,r1,b);
 assert.equal(Number((await learning(x)).sample_runs),1);
 const second=await task('2',{modelId:'profile-isolation',profileId:701});
 await confirm(x,second);await configure(second,x.p,{plate:x.plate,units:2});const r2=await account(second);await approve(x,r2,b);
 assert.equal(await learning(x),null);
 assert.notEqual((await scalar('SELECT product_piece_spec($1)',[b.component_product_id])).source,'bambu');
});
await test('Changing the cloud identity after configuration requires a new explicit review before accounting',async()=>{
 const x=await filePlate();const first=await task('2',{modelId:'first-layout',profileId:800});
 await confirm(x,first);await configure(first,x.p,{plate:x.plate,units:2});
 const other=await task('2',{modelId:'second-layout',profileId:801});await confirm(x,other);
 const before=await scalar('SELECT current_stock FROM inventory_items WHERE id=$1',[material]);
 await owner(()=>db.query("UPDATE bambu_tasks SET raw_data=jsonb_set(jsonb_set(raw_data,'{modelId}','\"second-layout\"'),'{profileId}','801') WHERE id=$1",[first]));
 await assert.rejects(account(first),/revisão|arquivo|configuração|Confirme|associação/i);
 assert.equal(await scalar('SELECT current_stock FROM inventory_items WHERE id=$1',[material]),before);
});
await test('Partial quality uses only approved units and never debits filament again',async()=>{
 const x=await filePlate();const b=await onePart(x);const t=await task();await confirm(x,t);await configure(t,x.p,{plate:x.plate,units:2});const r=await account(t);
 const stock=await scalar('SELECT current_stock FROM inventory_items WHERE id=$1',[material]);await approve(x,r,b,1);
 const learned=await learning(x);assert.equal(Number(learned.sample_units),1);assert.equal(Number(learned.grams),50);assert.equal(Number(learned.print_seconds),70);
 assert.equal(await scalar('SELECT current_stock FROM inventory_items WHERE id=$1',[material]),stock);
});
await test('A completely rejected physical run never promotes a learned piece specification',async()=>{
 const x=await filePlate();const b=await onePart(x);const t=await task();await confirm(x,t);await configure(t,x.p,{plate:x.plate,units:2});const r=await account(t);await approve(x,r,b,0);
 assert.equal(await learning(x),null);assert.notEqual((await scalar('SELECT product_piece_spec($1)',[b.component_product_id])).source,'bambu');
});
await test('A standalone file-linked SKU learns after quality without creating subitems or a BOM',async()=>{
 const x=await filePlate();
 const sourcePart=await owner(()=>scalar("INSERT INTO product_print_plate_parts(tenant_id,product_id,plate_id,source_key,name,quantity_per_product,quantity_per_plate,name_source) VALUES($1,$2,$3,'own-file-piece','Own SKU',1,2,'file') RETURNING id",[tenant,x.p,x.plate]));
 await owner(()=>db.query('INSERT INTO product_file_piece_links(product_id,tenant_id,plate_id,source_part_id,quantity_per_plate) VALUES($1,$2,$3,$4,2)',[x.p,tenant,x.plate,sourcePart]));
 const t=await task();await confirm(x,t);await configure(t,x.p,{plate:x.plate,units:2});const r=await account(t);
 assert.equal(await learning(x),null);await scalar("SELECT transition_job($1,'ready')",[r.job_ids[0]]);
 const sheet=await scalar('SELECT product_piece_spec($1)',[x.p]);assert.equal(sheet.source,'bambu');assert.equal(Number(sheet.grams),50);assert.equal(Number(sheet.print_seconds),70);assert.equal(sheet.pieces_per_plate,2);
 assert.equal(await scalar('SELECT count(*)::int FROM product_subitems WHERE product_id=$1',[x.p]),0);
});
console.log('Validated '+passed+' execution identity and learning scenarios.');
await db.close();
