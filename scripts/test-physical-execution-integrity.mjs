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
for(const name of(await readdir(new URL('../supabase/migrations/',import.meta.url))).filter(n=>n.endsWith('.sql') && (!process.argv.includes('--baseline') || n !== '20261010010000_physical_execution_integrity.sql')).sort()){
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
let sequence=100,passed=0,failed=0;
const next=()=>id(sequence++);
async function product(){return scalar('SELECT save_product_with_photos(NULL,$1::jsonb,\'[]\'::jsonb,$2)',[JSON.stringify({name:'Printed product '+sequence,category:'printed_part',material_id:material,prints_per_plate:2,est_grams:100,est_time_minutes:120,cost_estimate:4,sale_price:10}),next()]);}


// Memory-only database. --baseline deliberately excludes the repair to reproduce the defects.
await db.query("UPDATE inventory_items SET material_code='PLA',color='Preto',color_code='BLACK',color_hex='#000000' WHERE id=$1",[material]);
const future=await scalar("SELECT (CURRENT_DATE+30)::text");
const red=await owner(()=>scalar("INSERT INTO inventory_items(tenant_id,name,unit,current_stock,avg_cost,material_code,color,color_code,color_hex) VALUES($1,'Red PLA','kg',10,30,'PLA','Vermelho','RED','#FF0000') RETURNING id",[tenant]));
async function test(name,fn){try{await fn();passed++;console.log('PASS '+name);}catch(error){failed++;console.error('FAIL '+name+': '+error.message+' '+(error.where??''));}}
const parts=p=>db.query('SELECT b.*,c.stock_item_id FROM product_subitems b JOIN products c ON c.id=b.component_product_id WHERE b.product_id=$1 ORDER BY b.sort_order,b.id',[p]).then(r=>r.rows);
const add=(p,data,b=null)=>scalar('SELECT save_product_subitem($1,$2,$3::jsonb,$4)',[p,b,JSON.stringify(data),next()]);
async function assembly({incomplete=false}={}){
 const p=await product();
 await add(p,{name:'Body '+p,quantity_per_product:2,sort_order:0});
 await add(p,{name:'Leaf '+p,quantity_per_product:1,sort_order:1});
 const pl=await scalar('SELECT save_product_print_plate(NULL,$1,NULL,$2::jsonb)',[p,JSON.stringify({plate_index:1,label:'Mixed physical parts',units_per_plate:5,material_id:material,printer_id:printer,est_grams:100,est_time_seconds:3600})]);
 await scalar("SELECT save_product_material_recipe($1,$2,'per_print',$3::jsonb,NULL,$4,0)",[p,pl,JSON.stringify([{item_id:material,grams:100}]),next()]);
 const ps=await parts(p);
 for(const [i,b] of ps.entries())await add(p,{quantity_per_product:b.quantity_per_product,plate_id:pl,...(!incomplete || i===0?{quantity_per_plate:i===0?10:5}:{})},b.id);
 return {p,pl,parts:await parts(p)};
}
async function task(p,{status='2',color='000000FF',skip=[],after=false}={}){
 const t=next();
 const raw={modelId:'integrity-model-'+p,profileId:'integrity-profile-'+p,plateIndex:1,weight:100,skipObjects:skip,amsDetailMapping:[{filamentId:'PLA',filamentType:'PLA',targetFilamentType:'PLA',sourceColor:'000000FF',targetColor:color,amsId:0,slotId:0,weight:100}]};
 await owner(()=>db.query("INSERT INTO bambu_tasks(id,tenant_id,bambu_device_id,bambu_task_id,status,start_time,end_time,weight_grams,cost_time_seconds,raw_data) VALUES($1,$2,$3,$4,$5,now()+$6::interval,now()+interval '2 hours',100,3600,$7::jsonb)",[t,tenant,device,String(sequence),status,after?'1 minute':'-1 hour',JSON.stringify(raw)]));
 return t;
}
const override=(a,item)=>({product_id:a.p,plate_id:a.pl,base_item_id:material,item_id:item});
const context=(t,a,allocations=[],overrides=[])=>scalar('SELECT bambu_material_selection_preview($1,$2,$3,$4::jsonb,$5::jsonb)',[t,a.p,a.pl,JSON.stringify(allocations),JSON.stringify(overrides)]);
async function configure(t,a,{units=15,item=material,overrides=[],allocations=[],auto=false,slicer=true}={}){
 const ctx=await context(t,a,allocations,overrides);
 const materials=ctx.filaments.map(f=>({source_key:f.source_key,item_id:item}));
 await scalar('SELECT configure_bambu_production($1,$2,$3,$4::jsonb,$5,$6,0,0,0,$7::jsonb,$8,$9::jsonb)',[t,a.p,units,JSON.stringify(materials),auto,slicer,JSON.stringify(allocations),a.pl,JSON.stringify(overrides)]);
 return materials;
}
const account=(t,{materials=null,units=null,reason=null,key=next()}={})=>scalar('SELECT account_bambu_production($1,$2::jsonb,NULL,$3,NULL,NULL,NULL,$4,$5)',[t,materials===null?null:JSON.stringify(materials),units,reason,key]);
const quality=(j,outputs,key=next())=>scalar("SELECT confirm_subitem_output($1,$2::jsonb,'Rejected physical pieces',$3)",[j,JSON.stringify(outputs),key]);
const movementCount=t=>scalar("SELECT count(*)::integer FROM inventory_movements WHERE reference_type='bambu_task' AND reference_id=$1",[t]);
const outputsOf=(j,counts)=>j.production_snapshot.physical_outputs.map((o,i)=>({component_product_id:o.component_product_id,good_quantity:counts[i]}));
async function stockOrder(a,quantity=6){
 const op=await scalar("SELECT request_stock_production($1::jsonb,$2,'Physical replacement test',$3)",[JSON.stringify([{product_id:a.p,quantity}]),future,next()]);
 const item=await scalar('SELECT id FROM production_order_items WHERE production_order_id=$1',[op]);
 await scalar('SELECT release_production_order($1)',[op]);return {op,item};
}
try{
await test('Unplanned Bambu mixed plate freezes distinct outputs and quality posts each SKU exactly once',async()=>{
 const a=await assembly(),t=await task(a.p);await configure(t,a);
 const result=await account(t),j=await row('SELECT * FROM jobs WHERE id=$1',[result.job_ids[0]]);
 assert.deepEqual(j.production_snapshot.physical_outputs.map(o=>o.quantity),[10,5]);assert.equal(j.planned_quantity,15);
 const key=next();await quality(j.id,outputsOf(j,[9,5]),key);await quality(j.id,outputsOf(j,[9,5]),key);await account(t);
 assert.equal(await movementCount(t),1);
 assert.deepEqual((await db.query('SELECT current_stock::float AS stock FROM inventory_items WHERE id=ANY($1::uuid[]) ORDER BY array_position($1::uuid[],id)',[a.parts.map(p=>p.stock_item_id)])).rows.map(r=>r.stock),[9,5]);
 assert.equal(Number(await scalar("SELECT sum(total_cost) FROM inventory_movements WHERE reference_type='print_subitem' AND reference_id=$1",[j.id])),Number(j.actual_total_cost));
 assert.equal(await scalar('SELECT count(*)::int FROM component_stock_lots WHERE source_job_id=$1',[j.id]),0);
});
await test('Automatic repeat keeps confirmed physical layout after catalog yield changes',async()=>{
 const a=await assembly(),first=await task(a.p,{status:'1'});await configure(first,a,{auto:true});
 await add(a.p,{quantity_per_plate:7},a.parts[1].id);
 const t=await task(a.p,{after:true});const r=await row('SELECT * FROM bambu_production_records WHERE task_id=$1',[t]);
 assert.equal(r.state,'posted',r.problem??'');const j=await row('SELECT * FROM jobs WHERE id=$1',[r.job_ids[0]]);
 assert.deepEqual(j.production_snapshot.physical_outputs.map(o=>o.quantity),[10,5]);await quality(j.id,outputsOf(j,[10,5]));assert.equal(await movementCount(t),1);
});
await test('Unallocated configuration rejects units inconsistent with confirmed physical plate yield',async()=>{
 const a=await assembly(),t=await task(a.p);await assert.rejects(configure(t,a,{units:1}),/peças físicas|quantidade.*placa/i);assert.equal(await movementCount(t),0);
});
await test('Different color cannot credit the original physical child SKU without an explicit SKU',async()=>{
 const a=await assembly(),t=await task(a.p,{color:'FF0000FF'});await assert.rejects(configure(t,a,{item:red,overrides:[override(a,red)]}),/SKU|subitem|variante/i);assert.equal(await movementCount(t),0);
});
await test('Material selection of an already planned physical job rejects another child SKU color atomically',async()=>{
 const a=await assembly(),ids=await scalar('SELECT plan_subitem_batch($1,4,$2,NULL)',[a.parts[0].id,next()]);
 const original=await scalar('SELECT production_snapshot FROM jobs WHERE id=$1',[ids[0]]),t=await task(a.p,{color:'FF0000FF'});
 await assert.rejects(configure(t,a,{item:red,overrides:[override(a,red)],allocations:[{job_id:ids[0],quantity:15}]}),/SKU|subitem|variante/i);
 assert.deepEqual(await scalar('SELECT production_snapshot FROM jobs WHERE id=$1',[ids[0]]),original);assert.equal(await scalar('SELECT material_selection_snapshot FROM jobs WHERE id=$1',[ids[0]]),null);assert.equal(await movementCount(t),0);
});
await test('Previously saved invalid physical material variant is blocked before any inventory consumption',async()=>{
 const a=await assembly(),t=await task(a.p,{status:'1'});await configure(t,a);
 await owner(()=>db.query("UPDATE bambu_tasks SET status='2',raw_data=jsonb_set(raw_data,'{amsDetailMapping,0,targetColor}','\"FF0000FF\"') WHERE id=$1",[t]));
 await owner(async()=>{
  const s=await scalar('SELECT material_snapshot FROM bambu_production_records WHERE task_id=$1',[t]);
  const variant=await scalar('SELECT erp_private.apply_material_variants($1::jsonb,$2::jsonb,$3)',[JSON.stringify(s),JSON.stringify([override(a,red)]),tenant]);
  const ctx=await context(t,a);const sourceKey=ctx.filaments[0].source_key;
  await db.query('UPDATE bambu_production_records SET material_snapshot=$1::jsonb,materials=$2::jsonb WHERE task_id=$3',[JSON.stringify(variant),JSON.stringify([{source_key:sourceKey,item_id:red}]),t]);
 });
 await assert.rejects(account(t),/SKU|subitem|variante/i);assert.equal(await movementCount(t),0);
});
await test('Subitem replenishment retains released stock OP, item, due date and retry identity',async()=>{
 const a=await assembly(),o=await stockOrder(a);const key=next(),ids=await scalar('SELECT plan_subitem_batch($1,2,$2,$3)',[a.parts[0].id,key,o.item]);
 assert.deepEqual(await scalar('SELECT plan_subitem_batch($1,2,$2,$3)',[a.parts[0].id,key,o.item]),ids);
 const j=await row('SELECT *,due_date::text AS due FROM jobs WHERE id=$1',[ids[0]]);
 assert.equal(j.production_order_id,o.op);assert.equal(j.production_order_item_id,o.item);assert.equal(j.due,future);assert.equal(j.production_snapshot_origin,'production_order');assert.equal(Number(j.sale_price),0);
});
await test('Subitem replenishment retains sale and order-item links without creating additional revenue',async()=>{
 const a=await assembly();const customer=await scalar("INSERT INTO customers(tenant_id,name) VALUES($1,'Physical order customer') RETURNING id",[tenant]);
 const order=await scalar('SELECT save_sales_order(NULL,$1::jsonb,$2::jsonb,$3)',[JSON.stringify({customer_id:customer,due_date:future,payment_due_date:future,discount:0,shipping:0,total:60}),JSON.stringify([{product_id:a.p,description:'Physical assembly',quantity:6,unit_price:10,total:60}]),next()]);
 await scalar("SELECT transition_sales_order($1,'approved')",[order]);
 const op=await scalar('SELECT request_production_order(NULL,$1,$2)',[order,next()]);await scalar('SELECT release_production_order($1)',[op]);
 const item=await row('SELECT * FROM production_order_items WHERE production_order_id=$1',[op]);
 const ids=await scalar('SELECT plan_subitem_batch($1,2,$2,$3)',[a.parts[0].id,next(),item.id]),j=await row('SELECT * FROM jobs WHERE id=$1',[ids[0]]);
 assert.equal(j.order_id,order);assert.equal(j.order_item_id,item.source_order_item_id);assert.equal(j.production_order_id,op);assert.equal(Number(j.sale_price),0);
 assert.equal(await scalar("SELECT count(*)::int FROM accounts_receivable WHERE origin_type='order' AND origin_id=$1",[order]),1);
});
await test('Cross-tenant and wrong-product OP items cannot attach replacement jobs',async()=>{
 const a=await assembly(),other=await assembly(),o=await stockOrder(other);
 await assert.rejects(scalar('SELECT plan_subitem_batch($1,2,$2,$3)',[a.parts[0].id,next(),o.item]),/montagem|produto|disponível/i);
 await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[otherUid]);
 try{await assert.rejects(scalar('SELECT plan_subitem_batch($1,2,$2,$3)',[a.parts[0].id,next(),o.item]),/subitem|peças/i);}finally{await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[uid]);}
});
await test('Partial execution preserves full plate capacity and quality approves only completed physical pieces',async()=>{
 const a=await assembly(),t=await task(a.p,{skip:[1]});const maps=await configure(t,a);
 const r=await account(t,{materials:maps.map(m=>({...m,grams:90})),units:12,reason:'Objects skipped'}),j=await row('SELECT * FROM jobs WHERE id=$1',[r.job_ids[0]]);
 assert.equal(j.planned_quantity,15);assert.equal(j.produced_quantity,12);await quality(j.id,outputsOf(j,[8,4]));
 assert.deepEqual((await db.query('SELECT good_quantity FROM job_subitem_outputs WHERE job_id=$1 ORDER BY planned_quantity DESC',[j.id])).rows.map(r=>r.good_quantity),[8,4]);
});
await test('Missing physical yield fails before configuring or consuming a mixed plate',async()=>{
 const a=await assembly({incomplete:true}),t=await task(a.p);await assert.rejects(configure(t,a),/peças|quantas|quantidade/i);assert.equal(await movementCount(t),0);
});
await test('Cloud telemetry preserves maintenance, while an authenticated operator can clear it',async()=>{
 await db.query("UPDATE printers SET status='maintenance' WHERE id=$1",[printer]);
 await owner(async()=>{await db.exec('ALTER ROLE service_role BYPASSRLS;GRANT SELECT,UPDATE ON public.printers TO service_role;SET ROLE service_role');try{await db.query("UPDATE printers SET status='idle' WHERE id=$1",[printer]);}finally{await db.exec('RESET ROLE');}});
 assert.equal(await scalar('SELECT status FROM printers WHERE id=$1',[printer]),'maintenance');
 await db.query("UPDATE printers SET status='idle' WHERE id=$1",[printer]);assert.equal(await scalar('SELECT status FROM printers WHERE id=$1',[printer]),'idle');
});
await test('A legacy valid physical snapshot freezes its original layout without using a newer catalog yield',async()=>{
 const a=await assembly(),t=await task(a.p,{status:'1'});await configure(t,a);
 await owner(()=>db.query("UPDATE bambu_production_records SET material_snapshot=material_snapshot-'physical_outputs' WHERE task_id=$1",[t]));
 await add(a.p,{quantity_per_plate:7},a.parts[1].id);await owner(()=>db.query("UPDATE bambu_tasks SET status='2' WHERE id=$1",[t]));
 const r=await account(t),j=await row('SELECT * FROM jobs WHERE id=$1',[r.job_ids[0]]);
 assert.deepEqual(j.production_snapshot.physical_outputs.map(o=>o.quantity),[10,5]);
});
await test('Legacy missing-output configuration with product-unit count requires review and consumes nothing',async()=>{
 const a=await assembly(),t=await task(a.p,{status:'1'});await configure(t,a);
 await owner(()=>db.query("UPDATE bambu_production_records SET material_snapshot=material_snapshot-'physical_outputs',units=1 WHERE task_id=$1",[t]));
 await owner(()=>db.query("UPDATE bambu_tasks SET status='2' WHERE id=$1",[t]));
 await assert.rejects(account(t),/Revise a configuração|peças físicas/i);assert.equal(await movementCount(t),0);
});
await test('One physical mixed-plate attempt cannot receive the complete outputs of two allocated jobs',async()=>{
 const a=await assembly();const ids=await scalar('SELECT plan_subitem_batch($1,12,$2,NULL)',[a.parts[0].id,next()]);assert.equal(ids.length,2);
 const t=await task(a.p);await assert.rejects(configure(t,a,{units:30,allocations:ids.map(job_id=>({job_id,quantity:15}))}),/uma.*ordem|uma.*OI|única/i);assert.equal(await movementCount(t),0);
});
await test('Link configuration preserves full physical capacity rather than a partial completed count',async()=>{
 const a=await assembly(),ids=await scalar('SELECT plan_subitem_batch($1,2,$2,NULL)',[a.parts[0].id,next()]),t=await task(a.p);
 await assert.rejects(configure(t,a,{units:5,allocations:[{job_id:ids[0],quantity:5}]}),/peças físicas|quantidade.*placa|capacidade/i);assert.equal(await movementCount(t),0);
});
await test('Partial physical execution of a linked sale job retains its OP and approves only completed pieces',async()=>{
 const a=await assembly();const customer=await scalar("INSERT INTO customers(tenant_id,name) VALUES($1,'Partial physical customer') RETURNING id",[tenant]);
 const order=await scalar('SELECT save_sales_order(NULL,$1::jsonb,$2::jsonb,$3)',[JSON.stringify({customer_id:customer,due_date:future,payment_due_date:future,discount:0,shipping:0,total:50}),JSON.stringify([{product_id:a.p,description:'Physical assembly',quantity:5,unit_price:10,total:50}]),next()]);
 await scalar("SELECT transition_sales_order($1,'approved')",[order]);const op=await scalar('SELECT request_production_order(NULL,$1,$2)',[order,next()]);await scalar('SELECT release_production_order($1)',[op]);
 const job=await scalar('SELECT id FROM jobs WHERE production_order_id=$1',[op]),t=await task(a.p,{skip:[1]});const maps=await configure(t,a,{allocations:[{job_id:job,quantity:15}]});
 const r=await account(t,{materials:maps.map(m=>({...m,grams:90})),units:12,reason:'Objects skipped'});assert.deepEqual(r.job_ids,[job]);
 const j=await row('SELECT * FROM jobs WHERE id=$1',[job]);assert.equal(j.planned_quantity,15);assert.equal(j.produced_quantity,12);assert.equal(j.production_order_id,op);
 await quality(j.id,outputsOf(j,[8,4]));assert.equal(await movementCount(t),1);
});
await test('Ordinary non-assembly color variants continue to consume their selected material',async()=>{
 const p=await product();await scalar("SELECT save_product_material_recipe($1,NULL,'per_unit',$2::jsonb,NULL,$3,0)",[p,JSON.stringify([{item_id:material,grams:50}]),next()]);
 const t=await task(p,{color:'FF0000FF'}),a={p,pl:null};await configure(t,a,{units:2,item:red,overrides:[{product_id:p,plate_id:null,base_item_id:material,item_id:red}]});
 const r=await account(t);assert.equal(r.state,'posted');assert.equal(await movementCount(t),1);
});
}finally{await db.close();}
console.log(`${passed} physical-execution integrity tests passed; ${failed} failed.`);
if(failed)process.exitCode=1;
