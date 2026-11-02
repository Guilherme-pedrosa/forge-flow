// Disposable PostgreSQL regression cases for repeated source refresh, precise
// extras and catalog concurrency. Never connects to production.
import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
process.on('uncaughtException',error=>{console.error(error.message,error.where??'');process.exit(1);});
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
 if(process.argv.includes('--source-only')&&name>'20261102211000_idempotent_print_actual_timestamps.sql')continue;
 if(process.argv.includes('--baseline')&&name==='20261102210000_idempotent_native_source_refresh.sql')continue;
 if(process.argv.includes('--actuals-baseline')&&name==='20261102211000_idempotent_print_actual_timestamps.sql')continue;
 try { await db.exec((await readFile(new URL('../supabase/migrations/'+name,import.meta.url),'utf8')).replace(/CREATE EXTENSION IF NOT EXISTS (pg_cron|pg_net);/g,'')); }
 catch(error){throw new Error(`Migration ${name}: ${error.message} ${error.where??''}`);}
}
const id=n=>`72000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const tenant=id(1),otherTenant=id(2),owner=id(3),otherOwner=id(4),viewer=id(5),white=id(6),green=id(7),foreign=id(8),printer=id(9),otherPrinter=id(10);
let sequence=100,passed=0;
const next=()=>id(sequence++),scalar=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0],rows=async(sql,args=[])=>(await db.query(sql,args)).rows;
const login=uid=>db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[uid]);
const admin=async(fn)=>{await db.exec('RESET ROLE');try{return await fn();}finally{await db.exec('SET ROLE authenticated');}};
const save=(data,p=null,key=next())=>scalar("SELECT save_product_with_photos($1,$2::jsonb,'[]'::jsonb,$3)",[p,JSON.stringify(data),key]);
const repair=(p,plan,key=next())=>scalar('SELECT save_product_import_pricing($1,$2::jsonb,$3)',[p,JSON.stringify(plan),key]);
const plates=p=>rows('SELECT * FROM product_print_plates WHERE product_id=$1 AND is_active ORDER BY plate_index',[p]);
const stored=p=>scalar('SELECT to_jsonb(p) FROM products p WHERE id=$1',[p]);
const prep=plate=>scalar('SELECT product_print_plate_preparation($1)',[plate]);
const recipe=plate=>scalar('SELECT (SELECT to_jsonb(r) FROM product_material_recipe_versions r WHERE plate_id=$1 AND is_current)',[plate]);
const near=(actual,expected)=>assert.ok(Math.abs(Number(actual)-expected)<1e-7,`${actual} != ${expected}`);
const policy={energy_cost_kwh:1,labor_cost_hour:60,overhead_percent:10,target_margin:30,machine_hour_cost:4,handling_minutes_per_plate:6,finishing_minutes_per_piece:2,assembly_minutes_per_product:5,extras_cost_per_product:1,printer_hour_costs:[{printer_id:printer,hour_cost:7}]};
const setPolicy=async values=>scalar('SELECT save_pricing_settings($1::jsonb,$2,$3)',[JSON.stringify(values),(await scalar('SELECT pricing_settings()')).revision,next()]);
const hash='a'.repeat(64),profile='local:'+hash;
const slicedPlate=(index=1,grams=100,seconds=3600,filaments=[{id:1,material_code:'PLA',color_hex:'#FCECD6',weight_grams:grams,length_meters:grams/3}])=>({index,label:'Placa '+index,units_per_plate:null,weight_grams:grams,time_seconds:seconds,
 slicer_estimates:{source:'3mf_slice_info',slicer_version:'02.08.02.61',printer_model_id:null,nozzle_diameters:'0.4',filaments},
 parts:[{source_key:'file-object:'+index,name:'Peça '+index,name_source:'file',quantity_per_plate:1,quantity_per_product:null}]});
const planFor=(sourcePlates,quantity=1)=>({version:1,printer_id:printer,quantity,source_profile_id:profile,source_file_sha256:hash,
 materials:[{source_key:JSON.stringify([1,'PLA','#FCECD6']),item_id:white,material_code:'PLA',color_hex:'#FCECD6',slot_id:1}],
 plates:sourcePlates.map(p=>({index:p.index,units_per_plate:quantity,lines:[{item_id:white,grams:p.weight_grams}]}))});
const local=(sourcePlates=[slicedPlate()])=>({name:'Produto importado '+sequence,manual_cost:42.1234,cost_estimate:42.1234,sale_price:75,
 catalog_details:{base_cost:42.1234,accessory_cost:0,other_cost:0},catalog_pricing:{cost_source:'manual',price_source:'manual'},
 file_composition:{profile_id:profile,file_sha256:hash,enabled:true,plates:sourcePlates},import_pricing:planFor(sourcePlates)});
const variant=extra=>({profile_id:null,printer_model:null,printer_code:null,nozzle_diameter:null,weight_grams:null,time_seconds:null,plates:null,plate_details:[],filaments:[],images:[],warnings:[],...extra});
const external=()=>({schema_version:1,provider:'makerworld',id:'1169522',design_id:'1169522',model_id:'PUBLIC-MODEL',source_url:'https://makerworld.com/pt/models/1169522-project#profileId-1177581',title:'Presépio',description:'Description',description_html:'<p>Description</p>',images:[],gallery:[],tags:[],categories:[],files:[],accessories:[],documentation:[],warnings:[],
 profiles:[{...variant({profile_id:'241221531',weight_grams:119,time_seconds:16372,plates:1,plate_details:[{index:1,name:'Placa 1',weight_grams:119,time_seconds:16372,filaments:[{id:'1',type:'PLA',color:'#FCECD6',grams:null}],images:[],objects:[],warnings:[]}],filaments:[{id:'1',type:'PLA',color:'#FCECD6',grams:null}]}),instance_id:'1177581',name:'All parts',variants:[]}],selected_profile_id:'1177581',selected_variant_profile_id:'241221531',metadata_complete:true});
async function test(name,fn){try{await fn();passed++;console.log('PASS '+name);}catch(error){console.error('FAIL '+name+': '+error.message,error.where??'');throw error;}}
await db.query("INSERT INTO auth.users VALUES($1,'owner@qa.invalid'),($2,'other@qa.invalid'),($3,'viewer@qa.invalid')",[owner,otherOwner,viewer]);
await db.query("INSERT INTO tenants(id,name,slug) VALUES($1,'Imported pricing QA','imported-pricing-qa'),($2,'Other','imported-pricing-other')",[tenant,otherTenant]);
await db.query("INSERT INTO profiles(user_id,tenant_id,display_name) VALUES($1,$4,'Owner'),($2,$5,'Other'),($3,$4,'Viewer')",[owner,otherOwner,viewer,tenant,otherTenant]);
await db.query("INSERT INTO user_roles(user_id,tenant_id,role) VALUES($1,$4,'owner'),($2,$5,'owner'),($3,$4,'viewer')",[owner,otherOwner,viewer,tenant,otherTenant]);
await db.query("INSERT INTO inventory_items(id,tenant_id,name,unit,avg_cost,current_stock,material_code,color,color_code,color_hex,material_identified_at) VALUES($1,$4,'PLA branco','g',0.1,1000,'PLA','Branco','WHITE','#FFFFFF',now()),($2,$4,'PLA verde','kg',200,2,'PLA','Verde','GREEN','#00AE42',now()),($3,$5,'PLA outra empresa','g',0.1,1000,'PLA','Branco','WHITE','#FFFFFF',now())",[white,green,foreign,tenant,otherTenant]);
await db.query("INSERT INTO printers(id,tenant_id,name,model,power_watts,depreciation_per_hour,maintenance_cost_per_hour) VALUES($1,$3,'A1 confirmada','A1',100,2,1),($2,$4,'Outra A1','A1',100,2,1)",[printer,otherPrinter,tenant,otherTenant]);
await db.exec('SET ROLE authenticated');await login(owner);await setPolicy(policy);
const makeImported=async({mixed=false,extras=[]}={})=>{
 const source=slicedPlate(1,100,3600,mixed?[{id:1,material_code:'PLA',color_hex:'#FCECD6',weight_grams:30,length_meters:10},{id:2,material_code:'PLA',color_hex:'#00AE42',weight_grams:70,length_meters:23}]:undefined),data=local([source]),reference=external();
 data.extras=extras;data.material_id=mixed?null:white;data.external_import=reference;data.import_composition={...data.file_composition,profile_id:reference.selected_variant_profile_id};delete data.file_composition;
 data.import_pricing.source_profile_id=reference.selected_variant_profile_id;
 if(mixed){data.import_pricing.materials.push({source_key:JSON.stringify([2,'PLA','#00AE42']),item_id:green,material_code:'PLA',color_hex:'#00AE42',slot_id:2});data.import_pricing.plates[0].lines=[{item_id:white,grams:30},{item_id:green,grams:70}];}
 return{p:await save(data),reference};
};
const catalog=async p=>(await scalar('SELECT product_material_recipe_catalog()')).find(c=>c.id===p);
const commercial=async(p,changes={})=>{const a=await stored(p),c=await catalog(p);assert.equal(c.complete,true);return{name:a.name,category:a.category,material_id:a.material_id,est_grams:a.est_grams??0,est_time_minutes:a.est_time_minutes??0,post_process_minutes:a.post_process_minutes??0,num_colors:a.num_colors??1,prints_per_plate:a.prints_per_plate??1,extras:a.extras,cost_estimate:Math.round(c.cost_per_unit*10000)/10000,manual_cost:Math.round(c.cost_per_unit*10000)/10000,sale_price:75,catalog_details:{base_cost:c.cost_per_unit,accessory_cost:0,other_cost:0},catalog_pricing:{cost_source:'composition',price_source:'manual',expected_composition_revision:c.revision},...changes};};
// A historical posted run without allocations is explicitly retained by
// accepted_bambu_production. Seed that public-table history in this disposable
// database; ordinary source saves must never post another inventory movement.
async function postedSample(p,plate,{grams=100,seconds=3600,cost=25,units=1}={}){
 const task=next();await admin(async()=>{
  await db.query("INSERT INTO bambu_tasks(id,tenant_id,bambu_task_id,status,raw_data) VALUES($1,$2,$3,'2',$4::jsonb)",[task,tenant,'historical-'+task,JSON.stringify({id:'historical-'+task,status:2})]);
  await db.query("INSERT INTO bambu_production_records(task_id,tenant_id,product_id,plate_id,units,state,outcome,total_grams,elapsed_seconds,total_cost,consumption_source,posted_at) VALUES($1,$2,$3,$4,$5,'posted','completed',$6,$7,$8,'measured',now()) ON CONFLICT(task_id) DO UPDATE SET product_id=excluded.product_id,plate_id=excluded.plate_id,units=excluded.units,state=excluded.state,outcome=excluded.outcome,total_grams=excluded.total_grams,elapsed_seconds=excluded.elapsed_seconds,total_cost=excluded.total_cost,consumption_source=excluded.consumption_source,posted_at=excluded.posted_at",[task,tenant,p,plate,units,grams,seconds,cost]);
  await scalar('SELECT erp_private.update_product_print_actuals($1)',[p]);
 });return task;
}
try {
 await test('Unchanged MakerWorld and native AMS source data may be resent with a commercial edit without changing the plate revision',async()=>{
  const {p,reference}=await makeImported({mixed:true}),[before]=await plates(p),version=(await recipe(before.id)).id;
  assert.equal(before.imported_filaments.length,2);const data=await commercial(p,{name:'Nome comercial atualizado',external_import:reference});
  assert.equal(await save(data,p),p);const [after]=await plates(p);assert.deepEqual(after,before);assert.equal((await recipe(before.id)).id,version);
  assert.equal((await stored(p)).name,'Nome comercial atualizado');assert.equal((await stored(p)).manual_cost_override,null);assert.deepEqual((await prep(before.id)).missing,[]);
 });
 await test('Repeated unchanged source refreshes keep all saved native metadata and exact material quantities',async()=>{
  const {p,reference}=await makeImported(),[before]=await plates(p);
  for(let run=0;run<2;run++){await save(await commercial(p,{external_import:reference}),p);assert.deepEqual((await plates(p))[0],before);}
  assert.equal((await plates(p))[0].imported_plate_metadata.file_sha256,hash);assert.equal((await plates(p))[0].imported_plate_metadata.slicer_time_seconds,3600);
  assert.equal(await scalar('SELECT count(*)::integer FROM inventory_movements'),0);
 });
 await test('An actual external source change remains detectable and the full product save rolls back',async()=>{
  const {p,reference}=await makeImported(),before=await stored(p),[plate]=await plates(p),changed=structuredClone(reference);changed.profiles[0].plate_details[0].time_seconds+=1;
  await assert.rejects(save(await commercial(p,{name:'Must not commit',external_import:changed}),p),/composição mudou neste cadastro/);
  assert.deepEqual(await stored(p),before);assert.deepEqual((await plates(p))[0],plate);
 });
 await test('Real same-save yield and material changes cannot bypass the confirmed composition',async()=>{
  const {p,reference}=await makeImported();for(const change of [{prints_per_plate:2},{material_id:green}])await assert.rejects(save(await commercial(p,{external_import:reference,...change}),p),/composição mudou neste cadastro/);
 });
 await test('A concurrent exact recipe replacement or material cost change invalidates the old revision even at equal totals',async()=>{
  const {p,reference}=await makeImported(),[plate]=await plates(p),data=await commercial(p,{external_import:reference}),old=await recipe(plate.id);
  await scalar("SELECT save_product_material_recipe($1,$2,'per_print',$3::jsonb,NULL,$4,$5)",[p,plate.id,JSON.stringify([{item_id:white,grams:100}]),next(),old.non_material_cost_per_unit]);
  await assert.rejects(save(data,p),/composição ou seus custos mudaram/);
  const nextPayload=await commercial(p,{external_import:reference});await admin(()=>db.query('UPDATE inventory_items SET avg_cost=avg_cost+0.01 WHERE id=$1',[white]));await assert.rejects(save(nextPayload,p),/composição ou seus custos mudaram/);
 });
 await test('Untouched extras retain exact precision; an actual0.12345→0.12 rewrite stays blocked',async()=>{
  const extras=[{name:'Ímã personalizado',cost:0.12345}],{p,reference}=await makeImported({extras});
  await save(await commercial(p,{external_import:reference}),p);assert.deepEqual((await stored(p)).extras,extras);
  const before=await stored(p);await assert.rejects(save(await commercial(p,{name:'Rounded must roll back',external_import:reference,extras:[{name:'Ímã personalizado',cost:.12}]}),p),/composição mudou neste cadastro/);assert.deepEqual(await stored(p),before);
 });
 await test('An accepted source replay request remains inert even if the live material price subsequently changes',async()=>{
  const {p,reference}=await makeImported(),data=await commercial(p,{external_import:reference}),key=next();await save(data,p,key);const before=await stored(p),[plate]=await plates(p);
  await admin(()=>db.query('UPDATE inventory_items SET avg_cost=avg_cost+0.01 WHERE id=$1',[white]));assert.equal(await save(data,p,key),p);assert.deepEqual(await stored(p),before);assert.deepEqual((await plates(p))[0],plate);
 });
 await test('A full unchanged source save with a posted accepted run preserves actual measurement timestamps and historical rows',async()=>{
  const {p,reference}=await makeImported(),[initial]=await plates(p),task=await postedSample(p,initial.id),[before]=await plates(p),productBefore=await stored(p),record=await scalar('SELECT to_jsonb(r) FROM bambu_production_records r WHERE task_id=$1',[task]),movements=await scalar('SELECT count(*)::integer FROM inventory_movements');
  assert.ok(before.actual_updated_at);assert.equal(before.actual_sample_units,1);near(before.actual_grams_per_unit,100);
  await save(await commercial(p,{name:'Nome de venda com amostra real',external_import:reference}),p);
  assert.deepEqual((await plates(p))[0],before);assert.equal((await stored(p)).actual_print_updated_at,productBefore.actual_print_updated_at);
  assert.deepEqual(await scalar('SELECT to_jsonb(r) FROM bambu_production_records r WHERE task_id=$1',[task]),record);assert.equal(await scalar('SELECT count(*)::integer FROM inventory_movements'),movements);
 });
 await test('New accepted measurements advance timestamps and revisions; stale commercial snapshots remain rejected',async()=>{
  const {p,reference}=await makeImported(),[initial]=await plates(p);await postedSample(p,initial.id);const [before]=await plates(p),old=await commercial(p,{external_import:reference}),oldProduct=await stored(p);
  await postedSample(p,initial.id,{grams:140,seconds:4200,cost:35});const [changed]=await plates(p),product=await stored(p);
  near(changed.actual_grams_per_unit,120);near(changed.actual_seconds_per_unit,3900);near(changed.actual_cost_per_unit,30);assert.equal(changed.actual_sample_units,2);
  assert.ok(new Date(changed.actual_updated_at)>new Date(before.actual_updated_at));assert.ok(new Date(product.actual_print_updated_at)>new Date(oldProduct.actual_print_updated_at));
  assert.notEqual((await catalog(p)).revision,old.catalog_pricing.expected_composition_revision);await assert.rejects(save(old,p),/composição ou seus custos mudaram/);
  await save(await commercial(p,{external_import:reference}),p);assert.deepEqual((await plates(p))[0],changed);
 });
 await test('Unplated legacy measurements also retain their timestamp on replay and advance for a new sample count',async()=>{
  const p=await save({name:'Legacy measured product',prints_per_plate:2,manual_cost:12,sale_price:25});await postedSample(p,null,{grams:100,seconds:3600,cost:25,units:2});const before=await stored(p);
  await admin(()=>scalar('SELECT erp_private.update_product_print_actuals($1)',[p]));const unchanged=await stored(p);assert.equal(unchanged.actual_print_updated_at,before.actual_print_updated_at);near(unchanged.actual_print_sample_units,2);
  await postedSample(p,null,{grams:100,seconds:3600,cost:25,units:2});const after=await stored(p);near(after.actual_print_grams_per_unit,50);near(after.actual_print_sample_units,4);assert.ok(new Date(after.actual_print_updated_at)>new Date(before.actual_print_updated_at));
 });
 await test('The forward source migration is retry-safe and refuses unknown importer changes without modifying the catalog guard',async()=>{
  const migration=await readFile(new URL('../supabase/migrations/20261102210000_idempotent_native_source_refresh.sql',import.meta.url),'utf8');
  await admin(async()=>{const signature='erp_private.persist_source_before_sliced_file(uuid,jsonb,uuid)',definition=await scalar('SELECT pg_get_functiondef($1::regprocedure)',[signature]),catalogDefinition=await scalar("SELECT pg_get_functiondef('public.save_product_with_photos(uuid,jsonb,jsonb,uuid)'::regprocedure)");await db.exec(migration);assert.equal(await scalar('SELECT pg_get_functiondef($1::regprocedure)',[signature]),definition);assert.equal(await scalar("SELECT pg_get_functiondef('public.save_product_with_photos(uuid,jsonb,jsonb,uuid)'::regprocedure)"),catalogDefinition);try{await db.exec(definition.replace('DECLARE t uuid:=erp_private.actor();','-- Unknown drift\nDECLARE t uuid:=erp_private.actor();'));await assert.rejects(db.exec(migration),/Review the source plate importer/);}finally{await db.exec(definition);}});
 });
 await test('The actuals timestamp migration is retry-safe and refuses unknown aggregation changes',async()=>{
  const migration=await readFile(new URL('../supabase/migrations/20261102211000_idempotent_print_actual_timestamps.sql',import.meta.url),'utf8');await admin(async()=>{
   const signature='erp_private.update_product_print_actuals(uuid)',definition=await scalar('SELECT pg_get_functiondef($1::regprocedure)',[signature]);await db.exec(migration);assert.equal(await scalar('SELECT pg_get_functiondef($1::regprocedure)',[signature]),definition);
   try{await db.exec(definition.replace('DECLARE p products;','-- Unreviewed metric drift\nDECLARE p products;'));await assert.rejects(db.exec(migration),/Review the print actuals aggregation/);}finally{await db.exec(definition);}
  });
 });
 console.log('Validated '+passed+' source replay, exact precision and concurrency scenarios.');
}finally{await db.close();}
