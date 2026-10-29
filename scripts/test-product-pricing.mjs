import {PGlite} from '@electric-sql/pglite';
import {readFile,readdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
process.on('uncaughtException',e=>{console.error(e.message,e.where||'');process.exit(1);});
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
 catch(e){throw new Error(`Migration ${name}: ${e.message} ${e.where||''}`);}
}
const id=n=>`22000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const tenant=id(1),other=id(2),owner=id(3),viewer=id(4),otherOwner=id(5),printer=id(6),material=id(7),magnet=id(8),foreignPrinter=id(9),foreignItem=id(10);
let seq=100,passed=0;const next=()=>id(seq++);
const scalar=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0];
const rows=async(sql,args=[])=>(await db.query(sql,args)).rows;
const login=uid=>db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[uid]);
async function admin(fn){await db.exec('RESET ROLE');try{return await fn();}finally{await db.exec('SET ROLE authenticated');}}
async function test(name,fn){try{await fn();passed++;console.log('PASS '+name);}catch(e){console.error('FAIL '+name+': '+e.message,e.where||'');throw e;}}
await db.query("INSERT INTO auth.users VALUES($1,'owner@qa.invalid'),($2,'viewer@qa.invalid'),($3,'other@qa.invalid')",[owner,viewer,otherOwner]);
await db.query(`INSERT INTO tenants(id,name,slug,settings) VALUES($1,'Pricing QA','pricing-qa','{"energy_cost_kwh":1,"labor_cost_hour":30,"overhead_percent":10,"target_margin":40}'),($2,'Other','pricing-other','{}')`,[tenant,other]);
await db.query("INSERT INTO profiles(user_id,tenant_id,display_name) VALUES($1,$4,'Owner'),($2,$4,'Viewer'),($3,$5,'Other')",[owner,viewer,otherOwner,tenant,other]);
await db.query("INSERT INTO user_roles(user_id,tenant_id,role) VALUES($1,$4,'owner'),($2,$4,'viewer'),($3,$5,'owner')",[owner,viewer,otherOwner,tenant,other]);
await db.query("INSERT INTO printers(id,tenant_id,name,model,power_watts,depreciation_per_hour,maintenance_cost_per_hour) VALUES($1,$3,'A1 QA','A1',200,2,1),($2,$4,'Other','A1',100,9,1)",[printer,foreignPrinter,tenant,other]);
await db.query("INSERT INTO inventory_items(id,tenant_id,name,unit,avg_cost,current_stock,material_code,color,color_code,color_hex) VALUES($1,$2,'PLA verde','g',0.1,0,'PLA','Verde','GREEN','#00AE42')",[material,tenant]);
await db.query("INSERT INTO inventory_items(id,tenant_id,name,unit,avg_cost,current_stock) VALUES($1,$3,'Imã','un',0.3,0),($2,$4,'Other','un',8,3)",[magnet,foreignItem,tenant,other]);
await db.exec('SET ROLE authenticated');await login(owner);
const settings=()=>scalar('SELECT pricing_settings()');
const saveSettings=async(data,key=next(),revision=null)=>scalar('SELECT save_pricing_settings($1::jsonb,$2,$3)',[JSON.stringify(data),revision??(await settings()).revision,key]);
const policy={machine_hour_cost:4,handling_minutes_per_plate:6,finishing_minutes_per_piece:2,assembly_minutes_per_product:4,extras_cost_per_product:.5,printer_hour_costs:[]};
const preview=(p,q=1,o={})=>scalar('SELECT product_pricing_preview($1,$2,$3::jsonb)',[p,q,JSON.stringify(o)]);
const plan=p=>scalar('SELECT product_pricing_plan($1)',[p]);
const savePlan=async(p,data)=>scalar('SELECT save_product_pricing_plan($1,$2::jsonb,$3,$4)',[p,JSON.stringify(data),(await plan(p)).revision,next()]);
const save=data=>scalar("SELECT save_product_with_photos(NULL,$1::jsonb,'[]'::jsonb,$2)",[JSON.stringify(data),next()]);
const hash='b'.repeat(64);
const fileProduct=async(compound=false)=>{
 const p=await save({name:'Pricing product '+seq,extras:compound?[]:[{name:'Catalog accessory',cost:.25}],file_composition:{profile_id:'local:'+hash,file_sha256:hash,enabled:compound,plates:[{index:1,label:'Placa física',units_per_plate:null,weight_grams:100,time_seconds:3600,slicer_estimates:{source:'3mf_slice_info',slicer_version:'02.08.02.61',printer_model_id:null,nozzle_diameters:'0.4',filaments:[{id:1,material_code:'PLA',color_hex:'#00AE42',weight_grams:100,length_meters:33}]},parts:compound?[{source_key:'file-object:1',name_source:'file',name:'Parte A',quantity_per_plate:4,quantity_per_product:1},{source_key:'file-object:2',name_source:'file',name:'Parte B',quantity_per_plate:2,quantity_per_product:1}]:[{source_key:'file-object:1',name_source:'file',name:'Peça única',quantity_per_plate:4,quantity_per_product:null}]}]}});
 await admin(()=>db.query('UPDATE product_print_plates SET printer_id=$2 WHERE product_id=$1',[p,printer]));
 return p;
};
try{
 await test('Settings reuse old values only on read, preserve explicit zero/null and reject invalid/cross-tenant rates',async()=>{
  const s=await settings();assert.equal(s.energy_cost_kwh,1);assert.equal(s.machine_hour_cost,null);assert.equal(s.handling_minutes_per_plate,null);
  await saveSettings({...policy,energy_cost_kwh:0});assert.equal((await settings()).energy_cost_kwh,0);assert.equal(await scalar("SELECT (settings->>'energy_cost_kwh')::numeric FROM tenants WHERE id=$1",[tenant]),'0');
  await saveSettings({...policy,energy_cost_kwh:null});assert.equal((await settings()).energy_cost_kwh,null);assert.equal(await scalar("SELECT settings->>'energy_cost_kwh' FROM tenants WHERE id=$1",[tenant]),'0');
  for(const invalid of [{target_margin:100},{machine_hour_cost:-1},{labor_cost_hour:'30'},{printer_hour_costs:[{printer_id:foreignPrinter,hour_cost:1}]},{printer_hour_costs:[{printer_id:printer,hour_cost:true}]}])await assert.rejects(saveSettings(invalid));
  await saveSettings({...policy,energy_cost_kwh:1});await saveSettings(policy);assert.equal((await settings()).energy_cost_kwh,1);
  assert.equal(await scalar("SELECT settings->>'energy_cost_kwh' FROM tenants WHERE id=$1",[tenant]),'1');
  assert.equal(await scalar('SELECT depreciation_per_hour::float FROM printers WHERE id=$1',[printer]),2);
 });
 const simple=await fileProduct();await savePlan(simple,{consumables:[{item_id:magnet,quantity:2}]});
 await test('Current commercial labor tariff supersedes legacy zero sheet rates while keeping the sheet finishing time',async()=>{
  await scalar('SELECT save_product_piece_spec($1,$2::jsonb,$3)',[simple,JSON.stringify({materials:[],finishing_seconds:120,labor_hour_cost:0}),next()]);
  const result=await preview(simple);assert.equal(result.complete,true,JSON.stringify(result.missing));assert.equal(result.breakdown.finishing,1);
  assert.equal((await preview(simple,1,{labor_cost_hour:90})).breakdown.finishing,3);
  assert.equal(await scalar("SELECT spec->>'labor_hour_cost' FROM product_piece_specs WHERE product_id=$1",[simple]),'0');
 });
 await test('Unit pricing divides one plate once; handling, finishing, final assembly, extras and sales margin remain distinct',async()=>{
  const p=await preview(simple);assert.equal(p.complete,true,JSON.stringify(p.missing));assert.equal(p.cost_basis,'unit');
  assert.equal(p.breakdown.material,2.5);assert.equal(p.breakdown.energy,.05);assert.equal(p.breakdown.machine,1);assert.equal(p.breakdown.handling,.75);assert.equal(p.breakdown.finishing,1);assert.equal(p.breakdown.assembly,2);assert.equal(p.breakdown.extras,1.35);assert.equal(p.breakdown.overhead,.73);assert.equal(p.breakdown.unit_cost,9.38);assert.equal(p.suggested_unit_price,15.64);
  assert.equal(p.production_breakdown.total_lot,23.57);assert.equal(p.runs[0].required_runs,.25);assert.equal(p.runs[0].full_runs,1);assert.equal(p.runs[0].outputs[0].surplus_units,3);
 });
 await test('Exclusive lot charges complete physical runs, with finishing/assembly/packaging only on requested units',async()=>{
  const p=await preview(simple,2,{cost_basis:'exclusive_lot'});assert.equal(p.complete,true,JSON.stringify(p.missing));assert.equal(p.technical_breakdown.unit_cost,9.38);assert.equal(p.production_breakdown.total_lot,28.22);assert.equal(p.breakdown.unit_cost,14.11);assert.equal(p.breakdown.material,10);assert.equal(p.breakdown.finishing,2);assert.equal(p.breakdown.assembly,4);assert.equal(p.breakdown.extras,2.7);
 });
 await test('Mixed component plate is costed once using its limiting physical yield, never plate plus component sheets',async()=>{
  const p=await fileProduct(true);const result=await preview(p);assert.equal(result.complete,true,JSON.stringify(result.missing));assert.equal(result.components.length,2);assert.equal(result.plates.length,1);assert.equal(result.breakdown.material,5);assert.equal(result.breakdown.machine,2);assert.equal(result.breakdown.handling,1.5);assert.equal(result.breakdown.finishing,2);assert.equal(result.breakdown.assembly,2);assert.equal(result.breakdown.unit_cost,14.36);assert.equal(result.runs[0].required_runs,.5);
  assert.deepEqual(result.runs[0].outputs.map(x=>x.surplus_units).sort(),[1,3]);
  for(const component of result.components)await scalar('SELECT save_product_piece_spec($1,$2::jsonb,$3)',[component.component_product_id,JSON.stringify({materials:[],finishing_seconds:120,labor_hour_cost:0}),next()]);
  const legacy=await preview(p);assert.equal(legacy.complete,true,JSON.stringify(legacy.missing));assert.equal(legacy.breakdown.finishing,2);assert.equal(legacy.breakdown.unit_cost,14.36);
 });
 await test('Unknown costs stay incomplete, zero is accepted only when confirmed, and stock availability does not block pricing',async()=>{
  assert.equal((await preview(simple)).complete,true);assert.equal(await scalar('SELECT current_stock::float FROM inventory_items WHERE id=$1',[material]),0);
  await admin(()=>db.query('UPDATE inventory_items SET avg_cost=0 WHERE id=$1',[material]));assert.equal((await preview(simple)).complete,false);
  await admin(()=>db.query("INSERT INTO inventory_movements(tenant_id,item_id,movement_type,quantity,unit_cost,reference_type,reference_id) VALUES($1,$2,'purchase_in',1,0,'pricing_qa',$2)",[tenant,material]));assert.equal((await preview(simple)).complete,true);assert.equal((await preview(simple)).breakdown.material,0);
  await admin(()=>db.query('UPDATE inventory_items SET avg_cost=.1 WHERE id=$1',[material]));
  await saveSettings({...policy,machine_hour_cost:null});const p=await preview(simple);assert.equal(p.complete,false);assert.equal(p.breakdown.unit_cost,null);assert.equal(p.suggested_unit_price,null);await saveSettings(policy);
 });
 await test('Printer commercial overrides win without changing depreciation; preview overrides do not persist',async()=>{
  await saveSettings({...policy,printer_hour_costs:[{printer_id:printer,hour_cost:8}]});assert.equal((await preview(simple)).breakdown.machine,2);assert.equal((await preview(simple,1,{plates:[{plate_id:(await preview(simple)).plates[0].plate_id,machine_hour_cost:12,handling_minutes:0}]})).breakdown.machine,3);
  assert.equal((await preview(simple)).breakdown.machine,2);assert.equal(await scalar('SELECT depreciation_per_hour::float FROM printers WHERE id=$1',[printer]),2);await saveSettings(policy);
 });
 await test('Apply rejects stale/incomplete previews, records an immutable acceptance and updates commercial values without stock writes',async()=>{
  await admin(()=>db.query(`UPDATE products SET catalog_details=catalog_details||'{"cost_source":"composition","price_source":"markup","markup_percent":50}'::jsonb WHERE id=$1`,[simple]));
  const p=await preview(simple);const stockBefore=await rows('SELECT id,current_stock,avg_cost FROM inventory_items ORDER BY id');const count=await scalar('SELECT count(*)::int FROM inventory_movements');
  await assert.rejects(scalar('SELECT apply_product_pricing($1,1,$2::jsonb,$3,$4)',[simple,'{}','stale',next()]),/mudaram/);
  const key=next(),accepted=await scalar('SELECT apply_product_pricing($1,1,$2::jsonb,$3,$4)',[simple,'{}',p.revision,key]);assert.ok(accepted);
  const product=(await rows('SELECT manual_cost_override::float,cost_estimate::float,sale_price::float,catalog_details FROM products WHERE id=$1',[simple]))[0];assert.equal(product.cost_estimate,9.38);assert.equal(product.sale_price,15.64);assert.equal(product.catalog_details.base_cost,9.38);
  assert.equal(product.catalog_details.cost_source,'manual');assert.equal(product.catalog_details.price_source,'manual');assert.equal(product.catalog_details.markup_percent,null);
  assert.equal(await scalar('SELECT count(*)::int FROM inventory_movements'),count);assert.deepEqual(await rows('SELECT id,current_stock,avg_cost FROM inventory_items ORDER BY id'),stockBefore);
  assert.equal(await scalar('SELECT apply_product_pricing($1,1,$2::jsonb,$3,$4)',[simple,'{}',p.revision,key]),accepted);assert.equal(await scalar('SELECT count(*)::int FROM product_pricing_acceptances'),1);
  const newer=await preview(simple);await admin(()=>db.query('UPDATE inventory_items SET avg_cost=.2 WHERE id=$1',[material]));await assert.rejects(scalar('SELECT apply_product_pricing($1,1,$2::jsonb,$3,$4)',[simple,'{}',newer.revision,next()]),/mudaram/);
 });
 await test('Explicit company tariffs affect future previews, preserve prior snapshots and reject stale settings writes without partial changes',async()=>{
  const before=await scalar('SELECT snapshot FROM product_pricing_acceptances LIMIT 1'),old=await settings(),key=next();
  const saved=await saveSettings({...policy,energy_cost_kwh:2,labor_cost_hour:60},key,old.revision);
  assert.equal(await scalar("SELECT settings->>'energy_cost_kwh' FROM tenants WHERE id=$1",[tenant]),'2');
  assert.equal((await preview(simple)).breakdown.energy,.1);assert.equal((await preview(simple)).breakdown.handling,1.5);assert.equal((await preview(simple)).breakdown.finishing,2);
  assert.deepEqual(await scalar('SELECT snapshot FROM product_pricing_acceptances LIMIT 1'),before);assert.equal(before.breakdown.energy,.05);assert.equal(before.breakdown.finishing,1);
  assert.equal(await saveSettings({...policy,energy_cost_kwh:2,labor_cost_hour:60},key,old.revision),saved);
  await assert.rejects(saveSettings({...policy,energy_cost_kwh:9},next(),old.revision),/mudaram/);assert.equal(await scalar("SELECT settings->>'energy_cost_kwh' FROM tenants WHERE id=$1",[tenant]),'2');
  await saveSettings({...policy,energy_cost_kwh:null});assert.equal((await settings()).energy_cost_kwh,null);assert.equal(await scalar("SELECT settings->>'energy_cost_kwh' FROM tenants WHERE id=$1",[tenant]),'2');assert.equal((await preview(simple)).complete,false);
  await saveSettings({...policy,energy_cost_kwh:1,labor_cost_hour:30});
 });
 await test('Roles, tenant boundaries, private tables and child object references are enforced',async()=>{
  await assert.rejects(savePlan(simple,{consumables:[{item_id:foreignItem,quantity:1}]}));await assert.rejects(savePlan(simple,{printer_id:foreignPrinter}));
  await login(viewer);assert.equal((await preview(simple)).complete,true);await assert.rejects(saveSettings(policy),/permissão/);await assert.rejects(savePlan(simple,{}),/permissão/);await assert.rejects(scalar('SELECT * FROM erp_private.pricing_policies'),/permission denied/);
  await login(otherOwner);await assert.rejects(preview(simple),/encontrado/);assert.equal(await scalar('SELECT count(*)::int FROM product_pricing_acceptances'),0);await login(owner);
  await db.exec('SET ROLE anon');await assert.rejects(scalar('SELECT pricing_settings()'),/permission denied/);await db.exec('SET ROLE authenticated');
 });
 console.log(`Product pricing: ${passed} configuration, physical-cost and acceptance scenario groups passed.`);
}finally{await db.close();}
