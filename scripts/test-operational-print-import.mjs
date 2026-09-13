import { PGlite } from '@electric-sql/pglite';
import { readdir, readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

// Real PostgreSQL execution; pg_net is a local queue mock. No HTTP or real token.
const db = new PGlite();
await db.exec(`CREATE ROLE authenticated; CREATE ROLE anon;
  CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY,email text);
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
  CREATE SCHEMA storage; CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean);
  CREATE TABLE storage.objects(id uuid DEFAULT gen_random_uuid(),bucket_id text,name text,owner uuid);
  CREATE FUNCTION storage.foldername(text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$ SELECT string_to_array($1,'/') $$;
  ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY; CREATE PUBLICATION supabase_realtime;
  GRANT USAGE ON SCHEMA public,auth,storage TO authenticated,anon;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO authenticated;
  CREATE SCHEMA net; GRANT USAGE ON SCHEMA net TO PUBLIC;
  CREATE TABLE net.http_request_queue(id bigserial PRIMARY KEY,url text,params jsonb,headers jsonb,timeout_milliseconds integer);
  CREATE TABLE net._http_response(id bigint,status_code integer,content text,timed_out boolean,error_msg text,created timestamptz DEFAULT now());
  GRANT ALL ON ALL TABLES IN SCHEMA net TO PUBLIC;
  CREATE FUNCTION net.http_get(url text,params jsonb DEFAULT '{}',headers jsonb DEFAULT '{}',timeout_milliseconds integer DEFAULT 2000) RETURNS bigint
    LANGUAGE plpgsql SECURITY DEFINER AS $$ DECLARE request bigint; BEGIN
      INSERT INTO net.http_request_queue(url,params,headers,timeout_milliseconds) VALUES($1,$2,$3,$4) RETURNING id INTO request;
      RETURN request;
    END $$;`);
for (const name of (await readdir(new URL('../supabase/migrations/',import.meta.url))).filter(name=>name.endsWith('.sql')).sort()) {
  const sql=(await readFile(new URL('../supabase/migrations/'+name,import.meta.url),'utf8')).replace(/CREATE EXTENSION IF NOT EXISTS (pg_cron|pg_net);/g,'');
  try { await db.exec(sql); } catch(error) { throw new Error(`Migration ${name}: ${error.message}`); }
}

const id=n=>`90000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const tenant=id(1),otherTenant=id(2),uid=id(3),otherUid=id(4),viewer=id(5);
const scalar=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0];
const row=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
await db.query("INSERT INTO auth.users VALUES($1,'maker@test.invalid'),($2,'other@test.invalid'),($3,'viewer@test.invalid')",[uid,otherUid,viewer]);
await db.query("INSERT INTO tenants(id,name,slug) VALUES($1,'Makerworld QA','makerworld-qa'),($2,'Other','makerworld-other')",[tenant,otherTenant]);
await db.query("INSERT INTO profiles(user_id,tenant_id,display_name) VALUES($1,$4,'Owner'),($2,$5,'Other'),($3,$4,'Viewer')",[uid,otherUid,viewer,tenant,otherTenant]);
await db.query("INSERT INTO user_roles(user_id,tenant_id,role) VALUES($1,$4,'owner'),($2,$5,'owner'),($3,$4,'viewer')",[uid,otherUid,viewer,tenant,otherTenant]);
await db.exec('SET ROLE authenticated');await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[uid]);
async function owner(fn){await db.exec('RESET ROLE');try{return await fn();}finally{await db.exec('SET ROLE authenticated');}}
let sequence=100,passed=0;const next=()=>id(sequence++);
const get=request=>scalar('SELECT get_makerworld_import($1)',[request]);
const request=design=>scalar('SELECT request_makerworld_import($1)',[`https://makerworld.com/pt/models/${design}-project#profileId-${design}`]);
async function receive(requestId,content,status=200,extra={}){await owner(()=>db.query('INSERT INTO net._http_response(id,status_code,content,timed_out,error_msg) VALUES($1,$2,$3,$4,$5)',[requestId,status,typeof content==='string'?content:JSON.stringify(content),extra.timed_out??false,extra.error_msg??null]));return get(requestId);}
async function clearRequests(){await owner(()=>db.exec('DELETE FROM net._http_response;DELETE FROM net.http_request_queue;DELETE FROM makerworld_import_requests;'));}
const images=Array.from({length:35},(_,n)=>`https://cdn.example.invalid/project-photo-${n}.jpg`);
const variant=extra=>({profile_id:null,printer_model:null,printer_code:null,nozzle_diameter:null,weight_grams:null,time_seconds:null,plates:null,plate_details:[],filaments:[],images:[],warnings:[],...extra});
const reference=()=>({schema_version:1,provider:'makerworld',id:'1169522',design_id:'1169522',model_id:'PUBLIC-MODEL',source_url:'https://makerworld.com/pt/models/1169522-project#profileId-1177581',title:'Modular organizer',description:'Complete description',description_html:'<p>Complete description</p>',images,gallery:images,
  tags:['Organizer'],categories:[],files:[],accessories:[],documentation:[],warnings:[],
  profiles:[{...variant({profile_id:'241221531',weight_grams:100,time_seconds:6000,plates:3,plate_details:[{index:1,filaments:[],images:[],objects:[],warnings:[]}],filaments:[{type:'PLA',color:'Black'}]}),instance_id:'1177581',name:'All parts',variants:[variant({profile_id:'241221532',printer_model:'Other printer'})]},
    {...variant({profile_id:'241221540'}),instance_id:'1177582',name:'Second profile',variants:[]}],
  selected_profile_id:'1177581',selected_variant_profile_id:'241221532',metadata_complete:true});
const save=(product,photos=images,p=null,requestId=next())=>scalar('SELECT save_product_with_photos($1,$2::jsonb,$3::jsonb,$4)',[p,JSON.stringify(product),JSON.stringify(photos),requestId]);
const draft=()=>({name:'Imported product',material_id:null,est_grams:100,est_time_minutes:100,prints_per_plate:1,cost_estimate:null,sale_price:null,external_import:reference()});
async function test(name,fn){try{await fn();passed++;console.log('PASS '+name);}catch(error){console.error('FAIL '+name+': '+error.message+' '+(error.where??''));throw error;}}
process.on('uncaughtException',error=>{console.error(error.message,error.where??'');process.exit(1);});
const physicalReference=()=>{
  const r=reference();r.model_id='US43322ca98eb5f0';r.design_id=r.id='1403296';r.source_url='https://makerworld.com/models/1403296#profileId-1455750';r.selected_profile_id='1455750';r.selected_variant_profile_id='297891629';
  r.profiles=[{...variant({profile_id:'297891629',printer_model:'A1',plates:3,weight_grams:139,time_seconds:15526,
    plate_details:[[57,6370],[65,5796],[17,3360]].map(([weight_grams,time_seconds],i)=>({index:i+1,name:'Part '+(i+1),weight_grams,time_seconds,filaments:[{id:'1',type:'PLA',color:'#A7A9AA',grams:weight_grams,meters:null}],images:[],objects:[],warnings:[]}))}),instance_id:'1455750',name:'A1 gray',variants:[variant({profile_id:'OTHER-PRINTER',printer_model:'P1S',plates:1,plate_details:[{index:1,weight_grams:999,time_seconds:999,filaments:[],images:[],objects:[],warnings:[]}]})]},
    {...variant({profile_id:'OTHER-PROFILE',plates:5}),instance_id:'1455751',variants:[]}];return r;
};
const newProduct=async(ref=physicalReference())=>save({...draft(),external_import:ref},[]);
const plates=async p=>(await db.query('SELECT * FROM product_print_plates WHERE product_id=$1 AND is_active ORDER BY plate_index',[p])).rows;
const sourceFor=p=>scalar('SELECT id FROM product_print_sources WHERE product_id=$1 AND is_active ORDER BY created_at LIMIT 1',[p]);
const hydrate=(source,ref=physicalReference(),task=null)=>scalar('SELECT persist_source_plate_import($1,$2::jsonb,$3)',[source,JSON.stringify(ref),task]);
const preparation=p=>scalar('SELECT product_print_plate_preparation($1)',[p]);
const preview=p=>scalar('SELECT product_material_recipe_preview($1)',[p]);
const setPlate=(plate,overrides={})=>scalar('SELECT save_product_print_plate($1,$2,$3,$4::jsonb)',[plate.id,plate.product_id,plate.source_id,JSON.stringify({plate_index:plate.plate_index,label:plate.label,units_per_plate:plate.units_per_plate,material_id:plate.material_id,printer_id:plate.printer_id,est_grams:Number(plate.est_grams),est_time_seconds:Number(plate.est_time_seconds),est_cost_per_unit:plate.est_cost_per_unit,...overrides})]);
const material=async({color='#A7A9AA',name='Gray stock',unit='g',cost=.1,code='PLA',tenantId=tenant,identified=true}={})=>owner(()=>scalar('INSERT INTO inventory_items(tenant_id,name,unit,avg_cost,material_code,color,color_code,color_hex) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id',[tenantId,name,unit,cost,identified?code:null,identified?'Gray':null,identified?'GRAY':null,identified?color:null]));
const publish=(p,plate,item,grams=57,other=1)=>scalar("SELECT save_product_material_recipe($1,$2,'per_print',$3::jsonb,NULL,$4,$5)",[p,plate,JSON.stringify([{item_id:item,grams}]),next(),other]);
let printer,device,connection;
async function task({plate=3,color='FFFFFFFF',profile='297891629',design='1403296',instance='1455750',model='US43322ca98eb5f0',status='2'}={}){
  const taskId=next();const raw={modelId:model,profileId:profile,designId:design,instanceId:instance,plateIndex:plate,amsDetailMapping:[{filamentId:'1',filamentType:'PLA',targetFilamentType:'PLA',sourceColor:'A7A9AAFF',targetColor:color,weight:16.78,amsId:0,slotId:0}]};
  await owner(()=>db.query("INSERT INTO bambu_tasks(id,tenant_id,bambu_device_id,bambu_task_id,design_title,status,weight_grams,cost_time_seconds,start_time,end_time,raw_data) VALUES($1,$2,$3,$4,'History print',$5,16.78,3046,now()-interval '3422 seconds',now(),$6::jsonb)",[taskId,tenant,device,String(sequence),status,JSON.stringify(raw)]));return taskId;
}
try{
await owner(async()=>{
  await db.query("UPDATE tenants SET settings='{"+ '"energy_cost_kwh":1' +"}'::jsonb WHERE id=$1",[tenant]);
  printer=await scalar("INSERT INTO printers(tenant_id,name,model,power_watts,depreciation_per_hour,maintenance_cost_per_hour) VALUES($1,'A1 test','A1',200,2,1) RETURNING id",[tenant]);
  connection=await scalar("INSERT INTO bambu_connections(tenant_id,bambu_email,region) VALUES($1,'fixture@example.invalid','global') RETURNING id",[tenant]);
  device=await scalar("INSERT INTO bambu_devices(tenant_id,connection_id,dev_id,name,printer_id) VALUES($1,$2,'fixture-device','A1 test',$3) RETURNING id",[tenant,connection,printer]);
});
await test('Selected profile creates exactly three physical plates with unknown yield and original material colors',async()=>{
  const p=await newProduct(),rows=await plates(p);assert.equal(rows.length,3);
  assert.deepEqual(rows.map(r=>[Number(r.est_grams),Number(r.est_time_seconds)]),[[57,6370],[65,5796],[17,3360]]);
  assert.ok(rows.every(r=>r.units_per_plate===null&&r.imported_filaments[0].color==='#A7A9AA'&&r.material_id===null));
  assert.ok(rows.every(r=>r.profile_id===null&&r.model_id===null));assert.equal((await preview(p)).complete,false);
  assert.ok((await preview(p)).missing.some(m=>m.includes('unidades')));assert.equal(await scalar('SELECT count(*)::integer FROM product_material_recipe_versions WHERE product_id=$1',[p]),0);
});
await test('Unknown yield blocks a new quote-ready recipe, direct queue and plate planning without creating jobs',async()=>{
  const p=await newProduct(),[plate]=await plates(p);const item=await material();
  await assert.rejects(publish(p,plate.id,item),/unidades/);
  await assert.rejects(scalar('SELECT plan_product_plates($1,1,$2)',[p,next()]),/Complete|Confirme/);
  await assert.rejects(scalar('SELECT create_jobs($1::jsonb,$2)',[JSON.stringify([{product_id:p,name:'Do not assume one',status:'queued'}]),next()]),/Confirme/);
  assert.equal(await scalar('SELECT count(*)::integer FROM jobs WHERE product_id=$1',[p]),0);
});
await test('Exact stock matching respects tenant, color, controlled material code and ambiguity',async()=>{
  const p=await newProduct(),[plate]=await plates(p);let state=await preparation(plate.id);assert.equal(state.filaments[0].match_status,'matched');
  const first=state.filaments[0].item_id;await material({tenantId:otherTenant});assert.equal((await preparation(plate.id)).filaments[0].item_id,first);
  const duplicate=await material({name:'Same exact identity'});state=await preparation(plate.id);assert.equal(state.filaments[0].match_status,'ambiguous');assert.equal(state.filaments[0].item_id,null);
  await owner(()=>db.query('UPDATE inventory_items SET is_active=false WHERE id=$1',[duplicate]));
  const invalid=physicalReference();invalid.profiles[0].plate_details[0].filaments[0].type='PLA Basic';await hydrate(await sourceFor(p),invalid);state=await preparation(plate.id);assert.equal(state.filaments[0].item_id,null);
  const clear=physicalReference();clear.profiles[0].plate_details[0].filaments[0].color='A7A9AA80';await hydrate(await sourceFor(p),clear);assert.equal((await preparation(plate.id)).filaments[0].item_id,null);
  const opaque=physicalReference();opaque.profiles[0].plate_details[0].filaments[0].color='a7a9aaff';await hydrate(await sourceFor(p),opaque);assert.equal((await preparation(plate.id)).filaments[0].item_id,first);
});
await test('Physical-run costs are available before yield while per-unit costs remain unknown',async()=>{
  const p=await newProduct(),[plate]=await plates(p),state=await preparation(plate.id);
  assert.equal(Number(state.material_cost_per_print),5.7);assert.ok(Math.abs(Number(state.energy_cost_per_print)-6370/3600*.2)<1e-8);
  assert.ok(Math.abs(Number(state.machine_cost_per_print)-6370/3600*3)<1e-8);assert.equal(state.non_material_cost_per_unit_suggestion,null);
  await setPlate(plate,{units_per_plate:2});assert.ok(Number((await preparation(plate.id)).non_material_cost_per_unit_suggestion)>0);
});
await test('A bound historical task hydrates the same full profile and keeps used colors separate',async()=>{
  const p=await newProduct(),source=await sourceFor(p),taskId=await task();const result=await hydrate(source,physicalReference(),taskId);const rows=await plates(p);
  assert.equal(result.created,0);assert.equal(rows.length,3);assert.ok(rows.every(r=>r.model_id==='US43322ca98eb5f0'&&r.profile_id==='297891629'));
  assert.equal(rows[2].imported_filaments[0].color,'#A7A9AA');assert.equal(rows[2].imported_plate_metadata.observed.filaments[0].color,'FFFFFFFF');
  assert.equal(Number(rows[2].est_grams),17);assert.equal(Number(rows[2].est_time_seconds),3360);assert.equal(rows[2].units_per_plate,null);
  await hydrate(source,physicalReference(),taskId);assert.equal((await plates(p)).length,3);
  await owner(()=>db.query('UPDATE product_print_plates SET model_id=NULL,profile_id=NULL WHERE product_id=$1',[p]));await hydrate(source,physicalReference());assert.ok((await plates(p)).every(r=>r.model_id==='US43322ca98eb5f0'&&r.profile_id==='297891629'));
  // Prevent unrelated fixture SKUs from claiming these observed IDs in later tests.
  await owner(()=>db.query('UPDATE product_print_plates SET model_id=NULL,profile_id=NULL WHERE product_id=$1',[p]));await owner(()=>db.query('UPDATE product_print_sources SET model_id=NULL,profile_id=NULL,plate_index=NULL WHERE id=$1',[source]));
  await owner(()=>db.query('DELETE FROM bambu_production_records WHERE task_id=$1',[taskId]));await owner(()=>db.query('DELETE FROM bambu_tasks WHERE id=$1',[taskId]));
});
await test('Source, profile and task mismatch roll back both binding and new physical plates',async()=>{
  const p=await save({...draft(),external_import:null},[]),source=await scalar("SELECT save_product_print_source(NULL,$1,$2::jsonb)",[p,JSON.stringify({source_url:physicalReference().source_url,design_id:'1403296'})]);
  const wrong=await task({profile:'OTHER-PROFILE'});await assert.rejects(hydrate(source,physicalReference(),wrong),/não corresponde/);assert.equal((await plates(p)).length,0);assert.equal(await scalar('SELECT profile_id FROM product_print_sources WHERE id=$1',[source]),null);
  const bad=physicalReference();bad.profiles[0].plate_details[2].index=2;const validTask=await task({plate:1});await assert.rejects(hydrate(source,bad,validTask),/repetido/);
  assert.equal((await plates(p)).length,0);assert.equal(await scalar('SELECT profile_id FROM product_print_sources WHERE id=$1',[source]),null);
  await owner(()=>db.query('DELETE FROM bambu_production_records WHERE task_id=ANY($1::uuid[])',[[wrong,validTask]]));await owner(()=>db.query('DELETE FROM bambu_tasks WHERE id=ANY($1::uuid[])',[[wrong,validTask]]));
});
await test('Refresh preserves manual yield, printer estimates and the published recipe version',async()=>{
  const p=await newProduct(),[plate]=await plates(p);await setPlate(plate,{units_per_plate:3,est_grams:90,est_time_seconds:7000});const item=(await preparation(plate.id)).filaments[0].item_id;const version=await publish(p,plate.id,item,90);
  const changed=physicalReference();changed.profiles[0].plate_details[0].weight_grams=60;await hydrate(await sourceFor(p),changed);
  const [after]=await plates(p);assert.equal(after.units_per_plate,3);assert.equal(Number(after.est_grams),90);assert.equal(Number(after.est_time_seconds),7000);
  assert.equal(await scalar('SELECT id FROM product_material_recipe_versions WHERE plate_id=$1 AND is_current',[plate.id]),version);assert.equal(after.imported_plate_metadata.plate.weight_grams,60);
});
await test('Missing details remain pending even after the available plate receives a valid recipe',async()=>{
  const ref=physicalReference();ref.profiles[0].plate_details=ref.profiles[0].plate_details.slice(0,1);const p=await newProduct(ref),[plate]=await plates(p);await setPlate(plate,{units_per_plate:1});const item=(await preparation(plate.id)).filaments[0].item_id;await publish(p,plate.id,item);
  const state=await preview(p);assert.equal(state.complete,false);assert.equal(state.cost_per_unit,null);assert.ok(state.missing.some(m=>m.includes('todas as placas')));
});
await test('History-only binding materializes one pending plate without treating the observed color as the file recipe',async()=>{
  const p=await save({...draft(),external_import:null},[]),source=await scalar("SELECT save_product_print_source(NULL,$1,$2::jsonb)",[p,JSON.stringify({label:'Private file',model_id:'PRIVATE-MODEL',profile_id:'PRIVATE-PROFILE'})]);const taskId=await task({model:'PRIVATE-MODEL',profile:'PRIVATE-PROFILE',design:'0',instance:'0'});
  const hydrated=await hydrate(source,null,taskId);assert.equal(hydrated.created,1);const [plate]=await plates(p);assert.equal(plate.imported_plate_metadata.provider,'bambu_history');assert.equal(Number(plate.est_time_seconds),3046);assert.equal(Number(plate.est_grams),16.78);assert.equal(plate.units_per_plate,null);
  assert.deepEqual(plate.imported_filaments,[]);assert.equal(plate.imported_plate_metadata.observed.filaments[0].color,'FFFFFFFF');assert.equal(await scalar('SELECT external_import FROM products WHERE id=$1',[p]),null);
  await scalar('SELECT bind_product_print_source($1,$2)',[source,taskId]);assert.equal((await plates(p)).length,1);
});
await test('Yield and recipe can be confirmed together and a later invalid stock line rolls both back',async()=>{
  const p=await newProduct(),[plate]=await plates(p),item=(await preparation(plate.id)).filaments[0].item_id,key=next();
  const confirm=lines=>scalar("SELECT prepare_product_plate_recipe($1,$2,2,'per_print',$3::jsonb,NULL,$4,1)",[p,plate.id,JSON.stringify(lines),key]);
  await assert.rejects(confirm([{item_id:item,grams:57},{item_id:next(),grams:1}]),/ativo|Vínculo/);
  assert.equal((await plates(p))[0].units_per_plate,null);assert.equal(await scalar('SELECT count(*)::integer FROM product_material_recipe_versions WHERE plate_id=$1',[plate.id]),0);
  const version=await confirm([{item_id:item,grams:57}]);assert.equal(await confirm([{item_id:item,grams:57}]),version);assert.equal((await plates(p))[0].units_per_plate,2);
  assert.equal(await scalar('SELECT count(*)::integer FROM product_material_recipe_versions WHERE plate_id=$1',[plate.id]),1);assert.equal(Number(await scalar('SELECT units_per_print FROM product_material_recipe_versions WHERE id=$1',[version])),2);
});
await test('A new explicitly selected configuration without plates fails clearly but ordinary catalog editing remains possible',async()=>{
  const noDetails=physicalReference();noDetails.profiles[0].plate_details=[];await assert.rejects(newProduct(noDetails),/não informou as placas/);
  const p=await save({...draft(),external_import:null},[]);await save({...draft(),external_import:noDetails},[],p);assert.deepEqual(await scalar('SELECT external_import FROM products WHERE id=$1',[p]),noDetails);assert.equal((await plates(p)).length,0);
});
await test('An already approved sale and an existing job retain their original frozen recipe after plates are imported',async()=>{
  const p=await save({name:'Existing sellable part',est_grams:10,est_time_minutes:5,prints_per_plate:1,sale_price:20},[]);
  const item=await scalar("SELECT id FROM inventory_items WHERE tenant_id=$1 AND material_code='PLA' AND color_hex='#A7A9AA' AND is_active ORDER BY id LIMIT 1",[tenant]);await publish(p,null,item,10,1);
  const oldJob=(await scalar('SELECT create_jobs($1::jsonb,$2)',[JSON.stringify([{product_id:p,name:'Already planned',status:'queued'}]),next()]))[0];const oldSnapshot=await scalar('SELECT production_snapshot FROM jobs WHERE id=$1',[oldJob]);
  const customer=await scalar("INSERT INTO customers(tenant_id,name) VALUES($1,'Approved customer') RETURNING id",[tenant]);const date=await scalar('SELECT current_date::text');
  const order=await scalar('SELECT save_sales_order(NULL,$1::jsonb,$2::jsonb,$3)',[JSON.stringify({customer_id:customer,payment_due_date:date,due_date:date,discount:0,shipping:0,total:40}),JSON.stringify([{product_id:p,description:'Existing sellable part',quantity:2,unit_price:20,total:40}]),next()]);
  await scalar("SELECT transition_sales_order($1,'approved')",[order]);const frozen=await scalar('SELECT product_snapshot FROM order_items WHERE order_id=$1',[order]);
  await save({name:'Existing sellable part',external_import:physicalReference(),est_grams:10,est_time_minutes:5,prints_per_plate:1,sale_price:20},[],p);
  assert.equal((await plates(p)).length,3);assert.equal((await preview(p)).complete,false);assert.deepEqual(await scalar('SELECT production_snapshot FROM jobs WHERE id=$1',[oldJob]),oldSnapshot);
  await scalar("SELECT transition_sales_order($1,'in_production')",[order]);const jobs=(await db.query('SELECT production_snapshot,print_plate_id,planned_quantity,est_grams,est_time_minutes FROM jobs WHERE order_id=$1',[order])).rows;
  assert.equal(jobs.length,2);assert.ok(jobs.every(j=>j.print_plate_id===null&&j.planned_quantity===1&&Number(j.est_grams)===10&&j.est_time_minutes===5));assert.ok(jobs.every(j=>JSON.stringify(j.production_snapshot)===JSON.stringify(frozen)));
  assert.equal(await scalar("SELECT count(*)::integer FROM accounts_receivable WHERE origin_type='order' AND origin_id=$1",[order]),1);
});
await test('The atomic source form has one durable identity and tenant permissions remain enforced',async()=>{
  const p=await save({...draft(),external_import:null},[]),key=next(),args=[null,p,JSON.stringify({source_url:physicalReference().source_url,design_id:'1403296'}),JSON.stringify(physicalReference()),key,null];
  const run=()=>scalar('SELECT save_source_with_plate_import($1,$2,$3::jsonb,$4::jsonb,$5,$6)',args);const first=await run(),retry=await run();assert.equal(retry.source_id,first.source_id);assert.equal((await plates(p)).length,3);assert.equal(retry.created,0);assert.equal(retry.updated,3);assert.equal(retry.pending_yield,3);
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[otherUid]);await assert.rejects(hydrate(first.source_id),/não encontrada/);await assert.rejects(preparation(first.plate_ids[0]),/não encontrada/);
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[viewer]);await assert.rejects(hydrate(first.source_id),/permissão/);await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[uid]);
});
console.log(`Validated ${passed} operational print import scenarios.`);
}finally{await db.close();}
