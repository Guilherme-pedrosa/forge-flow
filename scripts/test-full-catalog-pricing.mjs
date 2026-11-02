// Disposable PostgreSQL acceptance of one full manufacturing cost across the
// catalog, detailed preview and commercial readers. No production connection.
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
// Prove this migration's retry guard before later wrappers supersede its RPC.
// Channel migration tests load this implementation and its later wrapper.
for(const name of (await readdir(new URL('../supabase/migrations/',import.meta.url))).filter(x=>x.endsWith('.sql')&&x<='20261102220000_full_catalog_cost.sql').sort()) {
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
const catalog=async p=>(await scalar('SELECT product_material_recipe_catalog()')).find(c=>c.id===p);
const preview=p=>scalar('SELECT product_pricing_preview($1,1,$2::jsonb)',[p,'{}']);
const snapshot=p=>admin(()=>scalar('SELECT erp_private.catalog_pricing_snapshot($1,$2)',[p,tenant]));
async function fullFixture({extra=2.5,zero=false}={}){
 const spool=next(),machine=next();await admin(async()=>{await db.query("INSERT INTO inventory_items(id,tenant_id,name,unit,avg_cost,current_stock,material_code,color,color_code,color_hex) VALUES($1,$2,$3,'g',0.1,1000,'PLA','Branco','WHITE','#FFFFFF')",[spool,tenant,'PLA cost '+sequence]);await db.query("INSERT INTO printers(id,tenant_id,name,model,power_watts,depreciation_per_hour,maintenance_cost_per_hour) VALUES($1,$2,'Cost A1','A1',100,2,1)",[machine,tenant]);});
 const settings=zero?{energy_cost_kwh:0,labor_cost_hour:0,overhead_percent:0,target_margin:0,machine_hour_cost:0,handling_minutes_per_plate:0,finishing_minutes_per_piece:0,assembly_minutes_per_product:0,extras_cost_per_product:0,printer_hour_costs:[]}:{...policy,printer_hour_costs:[{printer_id:machine,hour_cost:7}]};await setPolicy(settings);
 const data=local();data.material_id=spool;data.extras=extra===0?[]:[{name:'Ímã',cost:extra}];data.import_pricing.printer_id=machine;data.import_pricing.materials[0].item_id=spool;data.import_pricing.plates[0].lines[0].item_id=spool;
 const p=await save(data),[plate]=await plates(p);return{p,plate,spool,machine,settings};
}
async function form(p,changes={}){const a=await stored(p),c=await catalog(p),base=c.cost_per_unit;return{name:a.name,category:a.category,material_id:a.material_id,est_grams:a.est_grams??0,est_time_minutes:a.est_time_minutes??0,post_process_minutes:a.post_process_minutes??0,num_colors:a.num_colors,prints_per_plate:a.prints_per_plate,extras:a.extras,manual_cost:base==null?0:Math.round(base*10000)/10000,cost_estimate:base==null?0:Math.round(base*10000)/10000,sale_price:75,catalog_details:{base_cost:base,accessory_cost:0,other_cost:0},catalog_pricing:{cost_source:'composition',price_source:'manual',expected_composition_revision:c.revision},...changes};}
async function setPlan(p,plan){const current=await scalar('SELECT product_pricing_plan($1)',[p]);return scalar('SELECT save_product_pricing_plan($1,$2::jsonb,$3,$4)',[p,JSON.stringify(plan),current.revision,next()]);}
try{
 await test('The catalog and detailed preview use the same full cost including registered extras, not the recipe opaque total',async()=>{
  const {p}=await fullFixture(),c=await catalog(p),v=await preview(p),s=await snapshot(p);assert.equal(c.complete,true);assert.equal(c.configured,true);assert.equal(c.plate_count,1);near(c.cost_per_unit,36.61);near(v.breakdown.unit_cost,36.61);near(s.bom.cost_per_unit,34.11);assert.equal(c.revision,s.revision);assert.equal(c.cost_scope,'full_manufacturing');near((await stored(p)).manual_cost_override,42.1234);
 });
 await test('Company tariff changes update full catalog cost and reject the older revision before any catalog, photo or stock write',async()=>{
  const {p,machine,settings}=await fullFixture(),data=await form(p);await setPolicy({...settings,printer_hour_costs:[{printer_id:machine,hour_cost:9}]});near((await catalog(p)).cost_per_unit,38.81);near((await preview(p)).breakdown.unit_cost,38.81);
  await assert.rejects(save({...data,name:'Must roll back',stock:{unit:'un',avg_cost:1,current_stock:3}},p),/composição ou seus custos mudaram/);assert.notEqual((await stored(p)).name,'Must roll back');assert.equal((await stored(p)).stock_item_id,null);
 });
 await test('Same-price stock receipts still invalidate the exact catalog revision without changing the numeric cost',async()=>{
  const {p,spool}=await fullFixture(),old=await form(p),before=await catalog(p);await scalar('SELECT post_inventory_movement($1::jsonb,$2)',[JSON.stringify({item_id:spool,movement_type:'purchase_in',quantity:100,unit_cost:.1}),next()]);const after=await catalog(p);near(after.cost_per_unit,before.cost_per_unit);assert.notEqual(after.revision,before.revision);await assert.rejects(save(old,p),/composição ou seus custos mudaram/);
 });
 await test('Legacy unplated material dependencies invalidate on same-price receipts even when the detailed preview omits its material lines',async()=>{
  const {spool,machine}=await fullFixture({extra:0,zero:true});
  const p=await save({name:'Legacy material leaf',material_id:spool,est_grams:100,est_time_minutes:60,prints_per_plate:1,post_process_minutes:0});await setPlan(p,{printer_id:machine});
  const before=await catalog(p),details=await preview(p);assert.equal(before.complete,true);near(before.cost_per_unit,10);assert.deepEqual(details.plates,[]);
  const unrelated=next();await admin(()=>db.query("INSERT INTO inventory_items(id,tenant_id,name,category,unit,avg_cost,current_stock) VALUES($1,$2,'Unrelated consumable','consumable','un',2,5)",[unrelated,tenant]));
  assert.equal((await catalog(p)).revision,before.revision);
  await scalar('SELECT post_inventory_movement($1::jsonb,$2)',[JSON.stringify({item_id:spool,movement_type:'purchase_in',quantity:100,unit_cost:.1}),next()]);
  const after=await catalog(p);near(after.cost_per_unit,10);assert.notEqual(after.revision,before.revision);
 });
 await test('Changed stock acquisition costs flow through the full formula and equal-cost recipe replacements remain distinct',async()=>{
  const {p,spool,plate}=await fullFixture(),old=await form(p);await admin(()=>db.query('UPDATE inventory_items SET avg_cost=.2 WHERE id=$1',[spool]));near((await catalog(p)).cost_per_unit,47.61);await assert.rejects(save(old,p),/composição ou seus custos mudaram/);
  const nextForm=await form(p),version=await recipe(plate.id);await scalar("SELECT save_product_material_recipe($1,$2,'per_print',$3::jsonb,NULL,$4,$5)",[p,plate.id,JSON.stringify([{item_id:spool,grams:100}]),next(),version.non_material_cost_per_unit]);near((await catalog(p)).cost_per_unit,47.61);await assert.rejects(save(nextForm,p),/composição ou seus custos mudaram/);
 });
 await test('Stored consumables and per-plate plans use the existing detailed formula exactly once',async()=>{
  const {p,plate}=await fullFixture(),magnet=next();await admin(()=>db.query("INSERT INTO inventory_items(id,tenant_id,name,category,unit,avg_cost) VALUES($1,$2,'Ímã separado','consumable','un',2)",[magnet,tenant]));await setPlan(p,{consumables:[{item_id:magnet,quantity:3}],plates:[{plate_id:plate.id,machine_hour_cost:14}]});near((await catalog(p)).cost_per_unit,50.31);near((await preview(p)).breakdown.unit_cost,50.31);
  const old=await form(p);await setPlan(p,{consumables:[{item_id:magnet,quantity:3}],plates:[{plate_id:plate.id,machine_hour_cost:14}]});near((await catalog(p)).cost_per_unit,50.31);await assert.rejects(save(old,p),/composição ou seus custos mudaram/);
 });
 await test('Same-price company policy revisions invalidate a complete full-cost snapshot',async()=>{
  const {p,settings}=await fullFixture(),old=await form(p);await setPolicy(settings);near((await catalog(p)).cost_per_unit,36.61);await assert.rejects(save(old,p),/composição ou seus custos mudaram/);
 });
 await test('Name, SKU and category edits preserve strong production comparisons while allowing full-cost commercial saves',async()=>{
  const {p}=await fullFixture(),payload=await form(p,{name:'Nome comercial',sku:'CANONICAL-1',category:'seasonal'}),key=next();await save(payload,p,key);assert.equal(await save(payload,p,key),p);const saved=await stored(p);assert.equal(saved.name,'Nome comercial');assert.equal(saved.category,'seasonal');assert.equal(saved.sku,'CANONICAL-1');assert.equal(saved.manual_cost_override,null);near(saved.cost_estimate,36.61);
  const before=await stored(p);for(const changes of [{prints_per_plate:2},{material_id:green},{num_colors:2},{extras:[{name:'Changed',cost:9}]}]){await assert.rejects(save(await form(p,changes),p),/composição mudou neste cadastro/);assert.deepEqual(await stored(p),before);}
 });
 await test('Accepted retries do not reprice against later company changes and changed retry payloads stay rejected',async()=>{
  const {p,settings}=await fullFixture(),payload=await form(p),key=next();await save(payload,p,key);await setPolicy({...settings,energy_cost_kwh:2});const saved=await stored(p);assert.equal(await save(payload,p,key),p);assert.deepEqual(await stored(p),saved);await assert.rejects(save({...payload,name:'Changed retry'},p,key),/outra operação/);
 });
 await test('Commercial cost readers add catalog accessory and other expenses to the same full manufacturing cost once',async()=>{
  const {p}=await fullFixture(),data=await form(p);data.manual_cost=39.61;data.cost_estimate=39.61;data.catalog_details.accessory_cost=2;data.catalog_details.other_cost=1;await save(data,p);
  const state=await snapshot(p),commercial=await admin(()=>scalar('SELECT erp_private.commercial_cost_snapshot($1::jsonb,$2,$3)',[JSON.stringify(state.bom),p,tenant]));near(state.cost_per_unit,36.61);near(commercial.commercial_cost,39.61);assert.deepEqual(commercial.requirements,state.bom.requirements);assert.equal(commercial.complete,state.bom.complete);
  const customer=await scalar("INSERT INTO customers(tenant_id,name) VALUES($1,'Canonical quote') RETURNING id",[tenant]),quote=await scalar('SELECT save_sales_quote(NULL,$1::jsonb,$2::jsonb,$3)',[JSON.stringify({customer_id:customer,total:75,discount:0,shipping:0,payment_due_date:'2026-12-31'}),JSON.stringify([{product_id:p,description:'Peça',quantity:1,unit_price:75,total:75}]),next()]);near(await scalar('SELECT estimated_unit_cost FROM sales_quote_items WHERE quote_id=$1',[quote]),39.61);
 });
 await test('Manual accepted costs and historical pricing acceptances retain their explicit manual semantics',async()=>{
  const {p}=await fullFixture();await save({name:'Custo manual aceito',manual_cost:9,cost_estimate:9,sale_price:19.9,catalog_details:{base_cost:9,accessory_cost:0,other_cost:0},catalog_pricing:{cost_source:'manual',price_source:'manual'}},p);const saved=await stored(p);near(saved.manual_cost_override,9);near(saved.sale_price,19.9);
  const bom=(await snapshot(p)).bom,commercial=await admin(()=>scalar('SELECT erp_private.commercial_cost_snapshot($1::jsonb,$2,$3)',[JSON.stringify(bom),p,tenant]));near(commercial.commercial_cost,9);
 });
 await test('Explicit zero handling, finishing, assembly, extras and machine costs remain complete; missing costs stay pending',async()=>{
  const {p,settings}=await fullFixture({extra:0,zero:true});near((await catalog(p)).cost_per_unit,10);assert.equal((await catalog(p)).complete,true);
  for(const field of ['handling_minutes_per_plate','finishing_minutes_per_piece','assembly_minutes_per_product','extras_cost_per_product']){await setPolicy({...settings,[field]:null});const c=await catalog(p),v=await preview(p);assert.equal(c.complete,false,field);assert.equal(c.cost_per_unit,null);assert.ok(c.missing.length>0);assert.equal(v.complete,false);await assert.rejects(save(await form(p),p),/Complete a composição e os custos/);}
 });
 await test('Physical printer rate fallback matches import precedence and never invents an unknown component',async()=>{
  const {p,machine,settings}=await fullFixture({extra:0});await setPolicy({...settings,printer_hour_costs:[],machine_hour_cost:null});near((await catalog(p)).cost_per_unit,29.71);near((await preview(p)).plates[0].machine_hour_cost,3);
  await admin(()=>db.query('UPDATE printers SET depreciation_per_hour=NULL,acquisition_cost=1000,useful_life_hours=1000 WHERE id=$1',[machine]));near((await preview(p)).plates[0].machine_hour_cost,2);
  await admin(()=>db.query('UPDATE printers SET maintenance_cost_per_hour=NULL WHERE id=$1',[machine]));assert.equal((await catalog(p)).complete,false);await setPolicy({...settings,printer_hour_costs:[{printer_id:machine,hour_cost:0}],machine_hour_cost:9});assert.equal((await catalog(p)).complete,true);near((await preview(p)).plates[0].machine_hour_cost,0);
  const [plate]=await plates(p);await setPlan(p,{plates:[{plate_id:plate.id,machine_hour_cost:null}]});assert.equal((await catalog(p)).complete,false);
  await setPlan(p,{plates:[{plate_id:plate.id,machine_hour_cost:5}]});near((await preview(p)).plates[0].machine_hour_cost,5);
  await setPlan(p,{});await setPolicy({...settings,printer_hour_costs:[],machine_hour_cost:6});near((await preview(p)).plates[0].machine_hour_cost,6);
 });
 await test('Current commercial cost completeness remains separate from physical readiness and does not rewrite recipe history',async()=>{
  const {p,plate,spool}=await fullFixture();
  await scalar("SELECT save_product_material_recipe($1,$2,'per_print',$3::jsonb,NULL,$4,NULL)",[p,plate.id,JSON.stringify([{item_id:spool,grams:100}]),next()]);
  const state=await snapshot(p);assert.equal(state.bom.complete,false);assert.equal(state.complete,true);near(state.cost_per_unit,36.61);
  const commercial=await admin(()=>scalar('SELECT erp_private.commercial_cost_snapshot($1::jsonb,$2,$3)',[JSON.stringify(state.bom),p,tenant]));assert.equal(commercial.complete,false);assert.deepEqual(commercial.requirements,state.bom.requirements);
 });
 await test('The full catalog reader remains tenant-scoped and private helper calls and viewer writes are denied',async()=>{
  const {p}=await fullFixture();await login(otherOwner);assert.equal((await scalar('SELECT product_material_recipe_catalog()')).some(c=>c.id===p),false);await login(viewer);assert.ok((await scalar('SELECT product_material_recipe_catalog()')).some(c=>c.id===p));await assert.rejects(save(await form(p),p),/permissão/);await login(owner);await assert.rejects(scalar('SELECT erp_private.catalog_pricing_snapshot($1,$2)',[p,tenant]),/permission denied/);
 });
 await test('The canonical forward migration is retry-safe and refuses unreviewed public save drift',async()=>{
  const sql=await readFile(new URL('../supabase/migrations/20261102220000_full_catalog_cost.sql',import.meta.url),'utf8');await admin(async()=>{const signature='public.save_product_with_photos(uuid,jsonb,jsonb,uuid)',definition=await scalar('SELECT pg_get_functiondef($1::regprocedure)',[signature]);await db.exec(sql);assert.equal(await scalar('SELECT pg_get_functiondef($1::regprocedure)',[signature]),definition);try{await db.exec(definition.replace('DECLARE t uuid:=erp_private.actor();','-- Unreviewed save drift\nDECLARE t uuid:=erp_private.actor();'));await assert.rejects(db.exec(sql),/Review the full catalog pricing functions/);}finally{await db.exec(definition);}});
 });
 console.log('Validated '+passed+' canonical full catalog pricing scenarios.');
}finally{await db.close();}
