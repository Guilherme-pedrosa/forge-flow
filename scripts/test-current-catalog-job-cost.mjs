// Disposable PostgreSQL acceptance cases for one confirmed import plan shared
// by the commercial editor and production plates. Never connects to production.
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
for(const name of (await readdir(new URL('../supabase/migrations/',import.meta.url))).filter(x=>x.endsWith('.sql') && (x<='20261102230000_channel_pricing_policy.sql' || x==='20261102246500_current_catalog_job_cost.sql')).sort()) {
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
const preview=p=>scalar('SELECT product_pricing_preview($1,1,$2::jsonb)',[p,'{}']);
const plannedTargets=new Map(),plannedRequests=new Map();
const plan=(p,key=next())=>{let quantity=plannedRequests.get(key);if(quantity==null){quantity=(plannedTargets.get(p)??0)+1;plannedTargets.set(p,quantity);plannedRequests.set(key,quantity);}return scalar('SELECT plan_product_plates($1,$2,$3)',[p,quantity,key]);};
const jobs=ids=>rows('SELECT * FROM jobs WHERE id=ANY($1::uuid[]) ORDER BY code',[ids]);
const sum=j=>['est_material_cost','est_energy_cost','est_machine_cost','est_labor_cost','est_overhead','est_extras_cost'].reduce((v,k)=>v+Number(j[k]),0);
try {
 await test('New catalog prints use current machine and policy costs; existing jobs and recipes remain immutable',async()=>{
  const p=await save(local()),[plate]=await plates(p),oldRecipe=await recipe(plate.id),[old]=await jobs(await plan(p));near(old.est_total_cost,34.11);near(sum(old),34.11);
  await setPolicy({...policy,printer_hour_costs:[{printer_id:printer,hour_cost:14}]});
  const [fresh]=await jobs(await plan(p));near(fresh.est_total_cost,(await preview(p)).breakdown.unit_cost);near(fresh.est_total_cost,41.81);near(fresh.est_machine_cost,14);near(sum(fresh),41.81);
  assert.equal(fresh.production_snapshot.job_pricing.basis,'canonical_current');assert.equal(fresh.production_snapshot.job_pricing.complete,true);
  assert.deepEqual((await jobs([old.id]))[0],old);assert.deepEqual(await recipe(plate.id),oldRecipe);await setPolicy(policy);
 });
 await test('A received purchase changes the new print material and overhead through the same canonical formula',async()=>{
  const p=await save(local()),[old]=await jobs(await plan(p));
  await scalar('SELECT post_inventory_movement($1::jsonb,$2)',[JSON.stringify({item_id:white,movement_type:'purchase_in',quantity:1000,unit_cost:.3}),next()]);
  const [fresh]=await jobs(await plan(p));near(fresh.est_material_cost,20);near(fresh.est_total_cost,45.11);near(fresh.est_total_cost,(await preview(p)).breakdown.unit_cost);near(sum(fresh),45.11);assert.deepEqual((await jobs([old.id]))[0],old);
  await admin(()=>db.query('UPDATE inventory_items SET avg_cost=.1,current_stock=1000 WHERE id=$1',[white]));
 });
 await test('Changed energy, labor, overhead and a stored per-plate plan stay canonical',async()=>{
  const p=await save(local()),[plate]=await plates(p);
  await setPolicy({...policy,energy_cost_kwh:2,labor_cost_hour:45,overhead_percent:17});
  const current=await scalar('SELECT product_pricing_plan($1)',[p]);await scalar('SELECT save_product_pricing_plan($1,$2::jsonb,$3,$4)',[p,JSON.stringify({plates:[{plate_id:plate.id,machine_hour_cost:11,handling_minutes:9}]}),current.revision,next()]);
  const [fresh]=await jobs(await plan(p));near(fresh.est_total_cost,Math.round((await preview(p)).breakdown.unit_cost*100)/100);near(sum(fresh),fresh.est_total_cost);near(fresh.est_machine_cost,11);await setPolicy(policy);
 });
 await test('Incomplete current costs stay pending instead of retaining the old confirmed aggregate; replay is unchanged',async()=>{
  const p=await save(local());await setPolicy({...policy,energy_cost_kwh:null});const key=next(),ids=await plan(p),[pending]=await jobs(ids);
  assert.equal(pending.est_total_cost,null);assert.equal(pending.est_machine_cost,null);assert.equal(pending.est_material_cost,null);assert.equal(pending.production_snapshot.job_pricing.complete,false);assert.ok(pending.production_snapshot.job_pricing.missing.length);
  const retryKey=next(),retryIds=await plan(p,retryKey),[retryPending]=await jobs(retryIds);await setPolicy(policy);assert.deepEqual(await plan(p,retryKey),retryIds);assert.deepEqual((await jobs(retryIds))[0],retryPending);
 });
 await test('AMS slot grams already include tower and purge once, with unchanged physical consumption',async()=>{
  const source=slicedPlate(1,61.13,14645,[{id:1,material_code:'PLA',color_hex:'#FCECD6',weight_grams:25.99,length_meters:8.71},{id:2,material_code:'PLA',color_hex:'#00AE42',weight_grams:35.14,length_meters:11.78}]);
  const data=local([source]);data.import_pricing.plates[0].lines=[{item_id:white,grams:25.99},{item_id:green,grams:35.14}];data.import_pricing.materials.push({source_key:JSON.stringify([2,'PLA','#00AE42']),item_id:green,material_code:'PLA',color_hex:'#00AE42',slot_id:2});
  const p=await save(data),[j]=await jobs(await plan(p));near(j.est_grams,61.13);near(j.est_material_cost,9.63);near(j.est_total_cost,Math.round((await preview(p)).breakdown.unit_cost*100)/100);near(sum(j),j.est_total_cost);assert.equal(Number(j.purge_waste_grams??0),0);
  assert.deepEqual(j.production_snapshot.plates[0].recipe.lines.map(l=>l.grams_per_print).sort((a,b)=>a-b),[25.99,35.14]);
 });
 await test('Multiple physical plates allocate final costs once and preserve per-plate materials',async()=>{
  const p=await save(local([slicedPlate(1,100,3600),slicedPlate(2,50,1800)])),all=await jobs(await plan(p)),canonical=await preview(p);
  assert.equal(all.length,2);near(all.reduce((v,j)=>v+Number(j.est_total_cost),0),Math.round(canonical.breakdown.unit_cost*100)/100);
  assert.equal(all.filter(j=>j.production_snapshot.job_pricing.final_costs_in_this_print).length,1);
  for(const j of all){assert.equal(j.production_snapshot.job_pricing.allocation_policy,'print_costs_per_plate_final_costs_once_on_first_active_plate');near(sum(j),j.est_total_cost);}
  near(all.reduce((v,j)=>v+Number(j.est_grams),0),150);
 });
 await test('Partial replacement of a non-first plate exposes the separate final-cost allocation without adding it again',async()=>{
  const p=await save(local([slicedPlate(1,100,3600),slicedPlate(2,50,1800)])),all=await plates(p),sub=await scalar('SELECT id FROM product_subitems WHERE product_id=$1 AND plate_id=$2',[p,all[1].id]);
  const ids=await scalar('SELECT plan_subitem_batch($1,1,$2,NULL)',[sub,next()]),[j]=await jobs(ids),cost=j.production_snapshot.job_pricing;
  assert.equal(cost.complete,true);assert.equal(cost.final_costs_in_this_print,false);assert.equal(cost.final_costs_plate_id,all[0].id);assert.ok(Number(cost.final_costs_per_product.assembly)>0);near(j.est_extras_cost,0);near(j.est_labor_cost,6);near(sum(j),j.est_total_cost);
 });
 await test('A genuinely older selected recipe is explicitly historical and never repriced with the new recipe',async()=>{
  const p=await save(local()),[old]=await jobs(await plan(p)),[plate]=await plates(p);
  await scalar("SELECT save_product_material_recipe($1,$2,'per_print',$3::jsonb,NULL,$4,24.11)",[p,plate.id,JSON.stringify([{item_id:white,grams:110}]),next()]);
  const oldSnapshot=old.production_snapshot;
  const legacy=await admin(()=>scalar("INSERT INTO jobs(tenant_id,code,name,status,product_id,print_plate_id,planned_quantity,printer_id,production_snapshot,production_snapshot_origin,created_by) VALUES($1,'HIST','Historic chosen recipe','queued',$2,$3,1,$4,$5::jsonb,'catalog',$6) RETURNING to_jsonb(jobs)",[tenant,p,plate.id,printer,JSON.stringify(oldSnapshot),owner]));
  assert.equal(legacy.production_snapshot.job_pricing.basis,'frozen_recipe');near(legacy.est_total_cost,34.11);near(legacy.est_grams,100);
 });
 await test('Reprint snapshots and approved-order estimates retain their original costs after policy changes',async()=>{
  const p=await save(local()),[old]=await jobs(await plan(p));await setPolicy({...policy,printer_hour_costs:[{printer_id:printer,hour_cost:20}]});
  const reprint=await admin(()=>scalar("INSERT INTO jobs(tenant_id,code,name,status,product_id,print_plate_id,planned_quantity,printer_id,reprint_of,est_total_cost,created_by) VALUES($1,'REPRINT','Repeat historical','queued',$2,$3,1,$4,$5,$6,$7) RETURNING to_jsonb(jobs)",[tenant,p,old.print_plate_id,printer,old.id,old.est_total_cost,owner]));
  assert.deepEqual(reprint.production_snapshot,old.production_snapshot);near(reprint.est_total_cost,old.est_total_cost);
  const approved=await admin(()=>scalar("INSERT INTO jobs(tenant_id,code,name,status,product_id,print_plate_id,planned_quantity,printer_id,production_snapshot,production_snapshot_origin,est_total_cost,created_by) VALUES($1,'APPROVED','Approved historical','queued',$2,$3,1,$4,$5::jsonb,'approved_order',$6,$7) RETURNING to_jsonb(jobs)",[tenant,p,old.print_plate_id,printer,JSON.stringify(old.production_snapshot),old.est_total_cost,owner]));near(approved.est_total_cost,old.est_total_cost);assert.deepEqual(approved.production_snapshot,old.production_snapshot);await setPolicy(policy);
 });
 await test('Tenant and viewer authorization stay enforced before any new print or cost snapshot',async()=>{
  const p=await save(local());await login(otherOwner);await assert.rejects(plan(p),/ativo|produto|arquivado/i);await login(viewer);await assert.rejects(plan(p),/permiss|acesso|operador/i);await login(owner);
  await assert.rejects(scalar('SELECT erp_private.current_catalog_job_pricing($1,$2,NULL,1,$3,NULL)',[{},p,tenant]),/permission denied/i);
 });
 await test('A different physical printer cannot silently inherit the canonical plan machine costs',async()=>{
  const p=await save(local()),[plate]=await plates(p),snapshot=await admin(()=>scalar('SELECT erp_private.product_bom_snapshot($1,$2)',[p,tenant]));
  const result=await admin(()=>scalar('SELECT erp_private.current_catalog_job_pricing($1::jsonb,$2,$3,1,$4,$5)',[JSON.stringify(snapshot),p,plate.id,tenant,otherPrinter]));
  assert.equal(result.complete,false);assert.equal(result.total,null);assert.ok(result.missing.some(x=>x.includes('impressora da ordem')));
 });
 await test('Migration retry preserves the reviewed trigger/helper and rejects unreviewed function drift',async()=>{
  const migration=await readFile(new URL('../supabase/migrations/20261102246500_current_catalog_job_cost.sql',import.meta.url),'utf8');
  await admin(async()=>{
   const signature='public.erp_job_production_snapshot()',before=await scalar('SELECT pg_get_functiondef($1::regprocedure)',[signature]);await db.exec(migration);assert.equal(await scalar('SELECT pg_get_functiondef($1::regprocedure)',[signature]),before);
   await db.exec(before.replace('DECLARE parent jobs;','-- unreviewed change\nDECLARE parent jobs;'));await assert.rejects(db.exec(migration),/Review the production snapshot trigger/);await db.exec(before);
   const helper='erp_private.current_catalog_job_pricing(jsonb,uuid,uuid,integer,uuid,uuid)',original=await scalar('SELECT pg_get_functiondef($1::regprocedure)',[helper]);
   await db.exec(original.replace('DECLARE current_bom jsonb;','-- unreviewed change\nDECLARE current_bom jsonb;'));await assert.rejects(db.exec(migration),/Review the current catalog job pricing helper/);await db.exec(original);
  });
 });
 console.log(JSON.stringify(await admin(()=>rows("SELECT p.oid::regprocedure::text signature,md5(replace(prosrc,chr(13),'')) md5 FROM pg_proc p WHERE p.oid IN('public.erp_job_production_snapshot()'::regprocedure,'erp_private.current_catalog_job_pricing(jsonb,uuid,uuid,integer,uuid,uuid)'::regprocedure)"))));
 console.log('PASS '+passed+' current catalog job cost groups');
} finally {await db.close();}
