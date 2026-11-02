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
for(const name of (await readdir(new URL('../supabase/migrations/',import.meta.url))).filter(x=>x.endsWith('.sql')).sort()) {
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
try {
 await test('The forward migration is retry-safe and rejects unreviewed changes to its private predecessor or preparation RPC',async()=>{
  const migration=await readFile(new URL('../supabase/migrations/20261102170000_persist_import_pricing_plan.sql',import.meta.url),'utf8');
  await admin(async()=>{
   const signature='erp_private.save_product_before_live_pricing(uuid,jsonb,jsonb,uuid)',before=await scalar('SELECT pg_get_functiondef($1::regprocedure)',[signature]);
   await db.exec(migration);assert.equal(await scalar('SELECT pg_get_functiondef($1::regprocedure)',[signature]),before);
   try {await db.exec(before.replace('DECLARE t uuid:=erp_private.actor();','-- Unreviewed source drift\nDECLARE t uuid:=erp_private.actor();'));await assert.rejects(db.exec(migration),/Review the saved source/);}
   finally {await db.exec(before);}
  });
 });
 await test('One atomic import saves confirmed white stock, printer, yield and canonical selections while preserving accepted commercial cost',async()=>{
  const data=local(),key=next(),p=await save(data,null,key),[plate]=await plates(p),saved=await stored(p),r=await recipe(plate.id),preparation=await prep(plate.id);
  assert.equal(plate.printer_id,printer);assert.equal(plate.material_id,white);assert.equal(plate.units_per_plate,1);
  assert.equal(plate.imported_filaments[0].color,'#FCECD6');assert.equal(preparation.filaments[0].item_id,white);assert.equal(preparation.filaments[0].color,'#FFFFFF');
  assert.deepEqual(preparation.missing,[]);assert.equal(preparation.has_confirmed_recipe,true);
  near(preparation.material_cost_per_print,10);near(preparation.energy_cost_per_print,.1);near(preparation.machine_cost_per_print,7);
  // 10 material + .1 energy + 7 machine + 13 labour; 10% overhead; 1 extra.
  near(r.non_material_cost_per_unit,24.11);near(saved.manual_cost_override,42.1234);near(saved.cost_estimate,42.1234);near(saved.sale_price,75);
  assert.equal(saved.catalog_details.import_pricing.printer_id,printer);assert.equal(saved.catalog_details.import_pricing.quantity,1);
  assert.deepEqual(saved.catalog_details.import_pricing.materials[0],data.import_pricing.materials[0]);
  const catalog=(await scalar('SELECT product_material_recipe_catalog()')).find(x=>x.id===p);
  assert.equal(catalog.complete,true);near(catalog.cost_per_unit,34.11);
  const production=await scalar('SELECT product_pricing_preview($1,1,$2::jsonb)',[p,'{}']);
  assert.equal(production.complete,true,JSON.stringify(production.missing));near(production.breakdown.material,10);near(production.breakdown.unit_cost,34.11);
  assert.equal(await save(data,null,key),p);assert.equal(await scalar('SELECT count(*)::integer FROM product_material_recipe_versions WHERE product_id=$1',[p]),1);
  assert.equal(await scalar('SELECT count(*)::integer FROM inventory_movements'),0);near(await scalar('SELECT current_stock FROM inventory_items WHERE id=$1',[white]),1000);
  await setPolicy({...policy,energy_cost_kwh:null,machine_hour_cost:null,printer_hour_costs:[]});
  assert.equal(await save(data,null,key),p);assert.equal(await scalar('SELECT count(*)::integer FROM product_material_recipe_versions WHERE product_id=$1',[p]),1);
  await setPolicy(policy);
 });
 await test('Every native plate retains its own exact mixed-material distribution and completes a shared profile',async()=>{
  const a=slicedPlate(1,100,3600,[{id:1,material_code:'PLA',color_hex:'#FCECD6',weight_grams:30,length_meters:10},{id:2,material_code:'PLA',color_hex:'#00AE42',weight_grams:70,length_meters:23}]);
  const b=slicedPlate(2,50,1800,[{id:1,material_code:'PLA',color_hex:'#FCECD6',weight_grams:40,length_meters:13},{id:2,material_code:'PLA',color_hex:'#00AE42',weight_grams:10,length_meters:3}]);
  a.parts[0].quantity_per_plate=2;b.parts[0].quantity_per_plate=2;
  const data=local([a,b]);data.import_pricing.quantity=2;data.import_pricing.plates=[{index:2,units_per_plate:2,lines:[{item_id:white,grams:40},{item_id:green,grams:10}]},{index:1,units_per_plate:2,lines:[{item_id:white,grams:30},{item_id:green,grams:70}]}];
  data.import_pricing.materials.push({source_key:JSON.stringify([2,'PLA','#00AE42']),item_id:green,material_code:'PLA',color_hex:'#00AE42',slot_id:2});
  const p=await save(data),all=await plates(p);assert.equal(all.length,2);
  for(const plate of all){assert.equal(plate.units_per_plate,2);assert.equal(plate.printer_id,printer);assert.equal(plate.material_id,null);assert.deepEqual((await prep(plate.id)).missing,[]);}
  assert.deepEqual((await prep(all[0].id)).recipe_lines.map(x=>[x.item_id,x.grams]).sort(),[[white,30],[green,70]].sort());
  assert.deepEqual((await prep(all[1].id)).recipe_lines.map(x=>[x.item_id,x.grams]).sort(),[[white,40],[green,10]].sort());
  // First plate non-material: (.1 + 7 + 20 + 4.41)/2 + 1 = 16.755.
  near((await recipe(all[0].id)).non_material_cost_per_unit,16.755);
  // Second: (.05 + 3.5 + 10 + 1.955)/2 = 7.7525.
  near((await recipe(all[1].id)).non_material_cost_per_unit,7.7525);
  assert.ok((await stored(p)).catalog_details.import_pricing.plates.every(x=>x.units_per_plate===2));
 });
 await test('Ordinary catalog edits retain the confirmed import snapshot without publishing another recipe',async()=>{
  const data=local(),p=await save(data),saved=(await stored(p)).catalog_details.import_pricing,version=(await recipe((await plates(p))[0].id)).id;
  delete data.file_composition;delete data.import_pricing;data.name='Novo nome comercial';await save(data,p);
  assert.deepEqual((await stored(p)).catalog_details.import_pricing,saved);assert.equal((await recipe((await plates(p))[0].id)).id,version);
 });
 await test('A confirmed two-parts-per-product BOM cannot be silently repriced as four products per plate',async()=>{
  const source=slicedPlate();source.parts[0].quantity_per_plate=4;source.parts[0].quantity_per_product=2;
  const data=local([source]);data.import_pricing.quantity=2;data.import_pricing.plates[0].units_per_plate=2;
  const p=await save(data),[plate]=await plates(p),saved=await stored(p),version=(await recipe(plate.id)).id,changed=structuredClone(saved.catalog_details.import_pricing);
  changed.quantity=4;changed.plates[0].units_per_plate=4;
  await assert.rejects(repair(p,changed),/quantidades já confirmadas na composição/);
  assert.equal((await plates(p))[0].units_per_plate,2);assert.equal((await recipe(plate.id)).id,version);assert.deepEqual(await stored(p),saved);
  assert.equal(await scalar('SELECT quantity_per_product FROM product_subitems WHERE product_id=$1',[p]),2);
 });
 await test('Manual plate estimate drift cannot replace the immutable native sliced seconds or grams',async()=>{
  const p=await save(local()),[plate]=await plates(p),plan=(await stored(p)).catalog_details.import_pricing;
  const revise=async(grams,seconds)=>scalar('SELECT save_product_print_plate($1,$2,$3,$4::jsonb)',[plate.id,p,plate.source_id,JSON.stringify({plate_index:1,label:plate.label,units_per_plate:1,printer_id:printer,material_id:white,est_grams:grams,est_time_seconds:seconds,est_cost_per_unit:null})]);
  await revise(100,1800);await assert.rejects(repair(p,plan),/alterado depois da importação/);
  await revise(90,3600);const altered=structuredClone(plan);altered.plates[0].lines[0].grams=90;await assert.rejects(repair(p,altered),/alterado depois da importação/);
  await revise(100,3600);await repair(p,plan);near((await prep(plate.id)).energy_cost_per_print,.1);
 });
 await test('Existing MakerWorld product with source profile NULL repairs from saved plate metadata and keeps its price',async()=>{
  const data=local();delete data.file_composition;delete data.import_pricing;data.external_import=external();const p=await save(data),[plate]=await plates(p);
  await admin(()=>db.query('UPDATE product_print_sources SET profile_id=NULL WHERE id=$1',[plate.source_id]));
  await setPolicy({...policy,finishing_minutes_per_piece:0});
  const plan={version:1,printer_id:printer,quantity:1,source_id:plate.source_id,source_profile_id:'241221531',materials:[{source_key:JSON.stringify(['makerworld','PLA','#FCECD6']),item_id:white,material_code:'PLA',color_hex:'#FCECD6',slot_id:null}],plates:[{index:1,units_per_plate:1,lines:[{item_id:white,grams:119}]}]},key=next();
  assert.equal(await repair(p,plan,key),p);assert.equal((await stored(p)).catalog_details.import_pricing.source_id,plate.source_id);assert.deepEqual((await prep(plate.id)).missing,[]);
  near((await stored(p)).manual_cost_override,42.1234);near((await stored(p)).sale_price,75);assert.equal(await repair(p,plan,key),p);
  assert.equal(await scalar('SELECT count(*)::integer FROM product_material_recipe_versions WHERE product_id=$1',[p]),1);
  await assert.rejects(repair(p,{...plan,quantity:2},key),/outra operação/);await setPolicy(policy);
 });
 await test('A homogeneous profile filament total uses each known plate weight; mixed profile totals never invent a plate allocation',async()=>{
  await setPolicy({...policy,finishing_minutes_per_piece:0});
  const reference=external(),variant=reference.profiles[0];variant.weight_grams=100;variant.time_seconds=5400;variant.plates=2;
  variant.plate_details=[{...variant.plate_details[0],weight_grams:40,time_seconds:1800,filaments:[]},{...variant.plate_details[0],index:2,name:'Placa 2',weight_grams:60,time_seconds:3600,filaments:[]}];
  variant.filaments=[{id:'1',type:'PLA',color:'#FCECD6',grams:100}];
  const data=local();delete data.file_composition;data.external_import=reference;
  data.import_pricing={version:1,printer_id:printer,quantity:1,source_profile_id:variant.profile_id,
   materials:[{source_key:JSON.stringify(['makerworld','PLA','#FCECD6']),item_id:white,material_code:'PLA',color_hex:'#FCECD6',slot_id:null}],
   plates:[{index:1,units_per_plate:1,lines:[{item_id:white,grams:40}]},{index:2,units_per_plate:1,lines:[{item_id:white,grams:60}]}]};
  const p=await save(data),all=await plates(p);assert.equal(all.length,2);
  near((await prep(all[0].id)).recipe_lines[0].grams,40);near((await prep(all[1].id)).recipe_lines[0].grams,60);
  near((await prep(all[0].id)).material_cost_per_print,4);near((await prep(all[1].id)).material_cost_per_print,6);
  const mixed=structuredClone(data);mixed.name='Mixed profile must remain pending';mixed.external_import.profiles[0].filaments=[{id:'1',type:'PLA',color:'#FCECD6',grams:60},{id:'2',type:'PLA',color:'#00AE42',grams:40}];
  mixed.import_pricing.materials.push({source_key:JSON.stringify(['makerworld','PLA','#00AE42']),item_id:green,material_code:'PLA',color_hex:'#00AE42',slot_id:null});
  mixed.import_pricing.plates=[{index:1,units_per_plate:1,lines:[{item_id:white,grams:24},{item_id:green,grams:16}]},{index:2,units_per_plate:1,lines:[{item_id:white,grams:36},{item_id:green,grams:24}]}];
  const before=await scalar('SELECT count(*)::integer FROM products');await assert.rejects(save(mixed),/gramas por filamento/);assert.equal(await scalar('SELECT count(*)::integer FROM products'),before);
  await setPolicy(policy);
 });
 await test('Tampered native grams, missing or repeated plates, wrong profile/hash and extra material roll the entire product save back',async()=>{
  const changes=[d=>d.import_pricing.plates[0].lines[0].grams=99,d=>d.import_pricing.plates=[],d=>d.import_pricing.plates.push(d.import_pricing.plates[0]),d=>d.import_pricing.source_profile_id='other',d=>d.import_pricing.source_file_sha256='b'.repeat(64),d=>delete d.import_pricing.source_file_sha256,d=>d.import_pricing.materials.push({source_key:JSON.stringify([9,'PLA','#FFFFFF']),item_id:white})];
  for(const change of changes){const before=await scalar('SELECT count(*)::integer FROM products'),data=local();change(data);await assert.rejects(save(data));assert.equal(await scalar('SELECT count(*)::integer FROM products'),before);}
 });
 await test('A source file changed after the preview cannot be hidden behind the older plate SHA',async()=>{
  const data=local(),reference=external();data.external_import=reference;data.import_composition={...data.file_composition,profile_id:reference.selected_variant_profile_id};delete data.file_composition;
  data.import_pricing.source_profile_id=reference.selected_variant_profile_id;
  const p=await save(data),[plate]=await plates(p),plan=(await stored(p)).catalog_details.import_pricing,before=await stored(p),version=(await recipe(plate.id)).id;
  assert.ok(plate.source_id);assert.equal(plate.imported_plate_metadata.file_sha256,hash);
  await admin(()=>db.query('UPDATE product_print_sources SET file_sha256=$2 WHERE id=$1',[plate.source_id,'b'.repeat(64)]));
  await assert.rejects(repair(p,plan),/arquivo da fonte e da placa mudou/);
  assert.equal((await recipe(plate.id)).id,version);assert.deepEqual(await stored(p),before);
 });
 await test('A failed edit cannot partially save its name, prices, plate preparation or request key',async()=>{
  const p=await save(local()),[plate]=await plates(p),before=await stored(p),versions=await scalar('SELECT count(*)::integer FROM product_material_recipe_versions WHERE product_id=$1',[p]),data=local(),key=next();
  delete data.file_composition;data.name='Must roll back';data.manual_cost=99;data.sale_price=199;data.catalog_details.base_cost=99;data.import_pricing.plates[0].lines[0].grams=101;
  await assert.rejects(save(data,p,key));assert.deepEqual(await stored(p),before);assert.equal(await scalar('SELECT count(*)::integer FROM product_material_recipe_versions WHERE product_id=$1',[p]),versions);
  data.import_pricing.plates[0].lines[0].grams=100;await save(data,p,key);assert.equal((await stored(p)).name,'Must roll back');assert.equal((await prep(plate.id)).filaments[0].item_id,white);
 });
 await test('Cross-tenant stock, printer and source cannot enter an import plan',async()=>{
  for(const mutate of [d=>d.import_pricing.printer_id=otherPrinter,d=>d.import_pricing.materials[0].item_id=foreign]){const data=local();mutate(data);await assert.rejects(save(data),/empresa/);}
  await login(otherOwner);const data=local();delete data.import_pricing;const foreignProduct=await save(data),[foreignPlate]=await plates(foreignProduct);await login(owner);
  const p=await save(local()),plan=(await stored(p)).catalog_details.import_pricing;await assert.rejects(repair(p,{...plan,source_id:foreignPlate.source_id??foreignProduct}),/empresa/);
  await assert.rejects(repair(foreignProduct,plan),/empresa/);
 });
 await test('Viewer, anonymous and direct private-helper calls cannot change confirmed preparation',async()=>{
  const p=await save(local()),plan=(await stored(p)).catalog_details.import_pricing;
  await login(viewer);await assert.rejects(repair(p,plan),/permiss|opera|acesso/i);await login(owner);
  await assert.rejects(scalar('SELECT erp_private.apply_product_import_pricing($1,$2::jsonb,$3)',[p,JSON.stringify(plan),next()]),/permission denied/);
  await db.exec('SET ROLE anon');await login(null);await assert.rejects(repair(p,plan),/permission denied/);await db.exec('SET ROLE authenticated');await login(owner);
 });
 await test('Unknown or negative stock valuation cannot become a confirmed imported material cost',async()=>{
  const unknown=next();await admin(()=>db.query("INSERT INTO inventory_items(id,tenant_id,name,unit,avg_cost,material_code,color,color_code,color_hex) VALUES($1,$2,'PLA sem custo','g',0,'PLA','Branco','WHITE','#FFFFFF')",[unknown,tenant]));
  const data=local();data.import_pricing.materials[0].item_id=unknown;data.import_pricing.plates[0].lines[0].item_id=unknown;
  await assert.rejects(save(data),/custo de entrada/);
  await admin(async()=>{await db.exec('ALTER TABLE inventory_items DISABLE TRIGGER erp_inventory_guard');try{await db.query('UPDATE inventory_items SET avg_cost=-1 WHERE id=$1',[unknown]);}finally{await db.exec('ALTER TABLE inventory_items ENABLE TRIGGER erp_inventory_guard');}});await assert.rejects(save(data),/custo de entrada/);
  assert.equal(await scalar('SELECT count(*)::integer FROM product_material_recipe_lines WHERE item_id=$1',[unknown]),0);
 });
 await test('Explicitly selected legacy PLA BRANCO gains only its existing stable color code, atomically and with audit',async()=>{
  const legacy=next();await admin(()=>db.query("INSERT INTO inventory_items(id,tenant_id,name,unit,avg_cost,current_stock,material_code,color,color_code,color_hex) VALUES($1,$2,'PLA BRANCO BAMBU','kg',89,5,'PLA','BRANCO',NULL,NULL)",[legacy,tenant]));
  const before=await scalar('SELECT to_jsonb(i) FROM inventory_items i WHERE id=$1',[legacy]);assert.equal(before.color_code,null);assert.equal(before.material_identified_at,null);
  const data=local();data.import_pricing.materials[0].item_id=legacy;data.import_pricing.plates[0].lines[0].item_id=legacy;
  data.import_pricing.plates[0].lines[0].grams=99;await assert.rejects(save(data),/gramas importados/);
  assert.deepEqual(await scalar('SELECT to_jsonb(i) FROM inventory_items i WHERE id=$1',[legacy]),before);
  assert.equal(await scalar("SELECT count(*)::integer FROM audit_log WHERE record_id=$1 AND action='complete_import_material_identity'",[legacy]),0);
  data.import_pricing.plates[0].lines[0].grams=100;const p=await save(data),after=await scalar('SELECT to_jsonb(i) FROM inventory_items i WHERE id=$1',[legacy]);
  assert.equal(after.color_code,'BRANCO');assert.ok(after.material_identified_at);assert.equal(after.material_identified_by,owner);assert.equal(after.color_hex,null);
  for(const key of ['name','unit','avg_cost','current_stock','material_code','color'])assert.equal(after[key],before[key]);
  assert.equal(await scalar("SELECT count(*)::integer FROM audit_log WHERE record_id=$1 AND action='complete_import_material_identity'",[legacy]),1);
  assert.deepEqual((await prep((await plates(p))[0].id)).missing,[]);
 });
 await test('Automatic legacy color completion never changes an item already referenced by recipe history',async()=>{
  const historical=next();await admin(()=>db.query("INSERT INTO inventory_items(id,tenant_id,name,unit,avg_cost,material_code,color,color_code) VALUES($1,$2,'PLA com histórico','kg',89,'PLA','BRANCO','BRANCO')",[historical,tenant]));
  const data=local();data.import_pricing.materials[0].item_id=historical;data.import_pricing.plates[0].lines[0].item_id=historical;
  const p=await save(data),plan=(await stored(p)).catalog_details.import_pricing,version=(await recipe((await plates(p))[0].id)).id;
  // Simulate an incomplete pre-existing legacy identity without rewriting any
  // recipe snapshot; the disposable database must keep that history immutable.
  await admin(async()=>{await db.exec('ALTER TABLE inventory_items DISABLE TRIGGER erp_material_identity');try{await db.query('UPDATE inventory_items SET color_code=NULL,material_identified_at=NULL,material_identified_by=NULL WHERE id=$1',[historical]);}finally{await db.exec('ALTER TABLE inventory_items ENABLE TRIGGER erp_material_identity');}});
  await assert.rejects(repair(p,plan),/identificação do filamento/);
  assert.equal(await scalar('SELECT color_code FROM inventory_items WHERE id=$1',[historical]),null);
  assert.equal((await recipe((await plates(p))[0].id)).id,version);
  assert.equal(await scalar("SELECT count(*)::integer FROM audit_log WHERE record_id=$1 AND action='complete_import_material_identity'",[historical]),0);
 });
 await test('An in-flight plate keeps its frozen printer/yield and rejects new recipes atomically',async()=>{
  const p=await save(local()),[plate]=await plates(p),plan=(await stored(p)).catalog_details.import_pricing,version=(await recipe(plate.id)).id;
  const subitem=await scalar('SELECT id FROM product_subitems WHERE product_id=$1 LIMIT 1',[p]);
  await scalar('SELECT plan_subitem_batch($1,1,$2,NULL)',[subitem,next()]);
  await assert.rejects(repair(p,plan),/pend|andamento|ordem|impress/i);assert.equal((await recipe(plate.id)).id,version);assert.equal((await plates(p))[0].units_per_plate,1);
 });
 await test('Ordinary older product payloads keep working without an import preparation plan',async()=>{
  const data=local();delete data.import_pricing;const p=await save(data),[plate]=await plates(p);assert.equal(plate.printer_id,null);assert.equal(plate.units_per_plate,null);assert.equal(await recipe(plate.id),null);near((await stored(p)).manual_cost_override,42.1234);
 });
 console.log(`Validated ${passed} import pricing persistence scenarios.`);
}finally{await db.close();}
