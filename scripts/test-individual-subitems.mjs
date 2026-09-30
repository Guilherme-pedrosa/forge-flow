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

const today=await scalar('SELECT CURRENT_DATE::text');
const future=await scalar("SELECT (CURRENT_DATE+30)::text");
const customer=await scalar("INSERT INTO customers(tenant_id,name,email) VALUES($1,'Quoted customer','quoted@qa.invalid') RETURNING id",[tenant]);
await db.query("UPDATE inventory_items SET material_code='PLA',color='Preto',color_code='BLACK',color_hex='#000000' WHERE id=$1",[material]);
const makeRecipe=(p,grams=50,nonmaterial=2)=>scalar("SELECT save_product_material_recipe($1,NULL,'per_unit',$2::jsonb,'Confirmed recipe',$3,$4)",[p,JSON.stringify([{item_id:material,grams}]),next(),nonmaterial]);
async function quoted({p=null,price=10,quantity=2,discount=1,shipping=3,ready=true,fields={}}={}){
  p??=await product();if(ready)await makeRecipe(p);
  const payload={customer_id:customer,valid_until:future,due_date:future,payment_due_date:future,discount,shipping,total:price===null?null:price*quantity-discount+shipping,notes:'Accepted commercial terms',...fields};
  const items=[{product_id:p,description:'Product quoted',quantity,unit_price:price,total:price===null?null:price*quantity,notes:'Color chosen'}];
  const request=next();const args=[null,JSON.stringify(payload),JSON.stringify(items),request];
  const q=await scalar('SELECT save_sales_quote($1,$2::jsonb,$3::jsonb,$4)',args);return {q,p,args,payload,items};
}
const issue=q=>scalar("SELECT transition_sales_quote($1,'issued')",[q]);
const approve=q=>scalar("SELECT transition_sales_quote($1,'approved')",[q]);
const convert=(q,request=next())=>scalar('SELECT convert_sales_quote($1,$2)',[q,request]);
async function test(name,fn){try{await fn();passed++;console.log('PASS '+name);}catch(error){console.error('FAIL '+name+': '+error.message+' '+(error.where??''));throw error;}}

const status=(p,qty=10,item=null)=>scalar('SELECT assembly_product_status($1,$2,$3)',[p,qty,item]);
const subitems=p=>db.query('SELECT b.*,p.stock_item_id,p.sku FROM product_subitems b JOIN products p ON p.id=b.component_product_id WHERE b.product_id=$1 ORDER BY b.sort_order,b.id',[p]).then(r=>r.rows);
const add=(p,data,b=null,key=next())=>scalar('SELECT save_product_subitem($1,$2,$3::jsonb,$4)',[p,b,JSON.stringify(data),key]);
const move=(c,qty,kind='entry',cost=1,key=next())=>scalar("SELECT move_subitem_stock($1,$2,$3,$4,'Contagem física',$5)",[c,qty,kind,cost,key]);
const assemble=(p,qty,item=null,cost=0,key=next())=>scalar("SELECT assemble_product($1,$2,$3,$4,'Montagem conferida',$5)",[p,qty,item,cost,key]);
async function apple(){
 const p=await product();
 for(const [name,quantity_per_product,initial_stock] of [['Metade da maçã',2,20],['Caule',1,10],['Folha',1,6]]) await add(p,{name,quantity_per_product,initial_stock,unit_cost:1});
 return {p,parts:await subitems(p)};
}
async function stockOrder(p,quantity){
 const op=await scalar('SELECT request_stock_production($1::jsonb,NULL,NULL,$2)',[JSON.stringify([{product_id:p,quantity}]),next()]);
 const item=await scalar('SELECT id FROM production_order_items WHERE production_order_id=$1',[op]);return {op,item};
}
async function plate(p,parts){
 const pl=await scalar('SELECT save_product_print_plate(NULL,$1,NULL,$2::jsonb)',[p,JSON.stringify({plate_index:1,label:'Placa mista',units_per_plate:1,material_id:material,printer_id:printer,est_grams:100,est_time_seconds:3600})]);
 await scalar("SELECT save_product_material_recipe($1,$2,'per_print',$3::jsonb,NULL,$4,0)",[p,pl,JSON.stringify([{item_id:material,grams:100}]),next()]);
 for(const b of parts)await add(p,{quantity_per_product:b.quantity_per_product,plate_id:pl,quantity_per_plate:b.quantity_per_product*5},b.id);
 return pl;
}
const quality=(j,outputs,key=next())=>scalar("SELECT confirm_subitem_output($1,$2::jsonb,'Peças deformadas',$3)",[j,JSON.stringify(outputs),key]);
try {
let a;
await test('Every physical part has a real product, SKU and independent inventory, without a print recipe',async()=>{
 a=await apple();assert.equal(a.parts.length,3);assert.equal(new Set(a.parts.map(p=>p.stock_item_id)).size,3);assert.ok(a.parts.every(p=>p.sku));
 const s=await status(a.p);assert.equal(s.individual_stock,true);assert.equal(s.ready_to_assemble,6);
 assert.deepEqual(s.components.map(c=>Number(c.balance)),[20,10,6]);assert.deepEqual(s.components.map(c=>c.required),[20,10,10]);
});
await test('Assembling five apples consumes ten halves, five stems and five leaves, and retries once',async()=>{
 const key=next(),id=await assemble(a.p,5,null,2,key);assert.equal(await assemble(a.p,5,null,2,key),id);
 const s=await status(a.p);assert.deepEqual(s.components.map(c=>Number(c.balance)),[10,5,1]);assert.equal(Number(s.finished_stock),5);assert.equal(s.ready_to_assemble,1);
 assert.equal(Number(await scalar('SELECT component_cost+finishing_cost FROM product_assemblies WHERE id=$1',[id])),22);
 assert.equal(await scalar("SELECT count(*)::integer FROM inventory_movements WHERE reference_type='assembly_component' AND reference_id=$1",[id]),3);
 await assert.rejects(assemble(a.p,2),/Faltam subitens/);
});
await test('An extra half remains an individual half; entry/loss require no machine or filament',async()=>{
 const b=a.parts[0],key=next();await move(b.component_product_id,1,'entry',2,key);await move(b.component_product_id,1,'entry',2,key);
 assert.equal(Number((await status(a.p)).components[0].balance),11);
 await move(a.parts[2].component_product_id,1,'loss');assert.equal((await status(a.p)).ready_to_assemble,0);
 await assert.rejects(move(a.parts[2].component_product_id,1,'loss'),/insuficiente/);
});
await test('Imported files create catalogue subitems automatically and do not duplicate them on retry',async()=>{
 const comp={profile_id:'local:'+'c'.repeat(64),enabled:true,plates:[{index:1,label:'Mixed parts',units_per_plate:1,parts:[{source_key:'half',name:'Metade',quantity_per_product:2,quantity_per_plate:10,name_source:'file'},{source_key:'stem',name:'Caule',quantity_per_product:1,quantity_per_plate:5,name_source:'file'}]}]};
 const key=next(),payload=JSON.stringify({name:'Imported assembly',file_composition:comp});
 const p=await scalar("SELECT save_product_with_photos(NULL,$1::jsonb,'[]'::jsonb,$2)",[payload,key]);
 assert.equal(await scalar("SELECT save_product_with_photos(NULL,$1::jsonb,'[]'::jsonb,$2)",[payload,key]),p);
 assert.equal((await subitems(p)).length,2);assert.equal((await status(p)).ready_to_assemble,0);
});
await test('Unknown BOM quantities do not invent available finished goods, but parts can receive stock',async()=>{
 const p=await product();await add(p,{name:'Peça sem quantidade confirmada'});const [b]=await subitems(p);await move(b.component_product_id,10);
 assert.equal((await status(p)).ready_to_assemble,0);await assert.rejects(assemble(p,1),/Faltam subitens/);
 await add(p,{quantity_per_product:2},b.id);assert.equal((await status(p)).ready_to_assemble,5);
});
await test('Stock-only OP releases without printing preparation and reserves physical pieces FIFO',async()=>{
 const x=await apple(),one=await stockOrder(x.p,4),two=await stockOrder(x.p,2);
 assert.equal((await scalar('SELECT production_order_preflight($1)',[one.op])).ready,true);
 await scalar('SELECT release_production_order($1)',[one.op]);await scalar('SELECT release_production_order($1)',[one.op]);
 await scalar('SELECT release_production_order($1)',[two.op]);
 assert.equal((await status(x.p)).ready_to_assemble,0);assert.equal((await status(x.p,4,one.item)).ready_to_assemble,6);assert.equal((await status(x.p,2,two.item)).ready_to_assemble,2);
 await assert.rejects(assemble(x.p,1),/Faltam subitens/);await assemble(x.p,2,two.item);await assemble(x.p,4,one.item);
 await scalar("SELECT transition_production_order($1,'completed')",[one.op]);await scalar("SELECT transition_production_order($1,'completed')",[two.op]);
 assert.equal(Number((await status(x.p)).finished_stock),6);
});
let mixed,job,outputs;
await test('A mixed plate plans distinct physical outputs, not one stock balance for the plate',async()=>{
 mixed=await apple();await plate(mixed.p,mixed.parts);
 const ids=await scalar('SELECT plan_subitem_batch($1,7,$2,NULL)',[mixed.parts[0].id,next()]);assert.equal(ids.length,1);job=ids[0];
 const j=await row('SELECT * FROM jobs WHERE id=$1',[job]);outputs=j.production_snapshot.physical_outputs;
 assert.equal(Number(j.est_grams),100);assert.equal(Number(j.est_total_cost),2);assert.equal(j.production_snapshot.plates[0].recipe.units_per_print,20);
 assert.equal(j.planned_quantity,20);assert.deepEqual(outputs.map(x=>x.quantity),[10,5,5]);
 assert.deepEqual((await status(mixed.p)).components.map(c=>c.pending),[10,5,5]);
});
await test('Quality approves each piece separately, capitalizes cost once and never credits legacy plate stock',async()=>{
 await owner(()=>db.query("UPDATE jobs SET status='quality_check',inventory_posted_at=now(),actual_total_cost=18,actual_grams=100,actual_time_minutes=60,produced_quantity=planned_quantity WHERE id=$1",[job]));
 await assert.rejects(scalar("SELECT confirm_component_output($1,18,'Wrong aggregate',$2)",[job,next()]),/separadamente/);
 const counts=outputs.map((o,i)=>({component_product_id:o.component_product_id,good_quantity:[9,5,4][i]})),key=next();
 await quality(job,counts,key);await quality(job,counts,key);
 assert.deepEqual((await status(mixed.p)).components.map(c=>Number(c.balance)),[29,15,10]);
 assert.equal(await scalar('SELECT count(*)::integer FROM component_stock_lots WHERE source_job_id=$1',[job]),0);
 assert.equal(await scalar('SELECT count(*)::integer FROM job_subitem_outputs WHERE job_id=$1',[job]),3);
 assert.equal(Number(await scalar("SELECT sum(total_cost) FROM inventory_movements WHERE reference_type='print_subitem' AND reference_id=$1",[job])),18);
});
await test('Missing physical pieces generate only needed plates and pending output covers the next OP',async()=>{
 const x=await apple();await plate(x.p,x.parts);const one=await stockOrder(x.p,10);
 const review=await scalar('SELECT production_order_preflight($1)',[one.op]);assert.equal(review.ready,true);assert.equal(review.items[0].jobs,1);
 await scalar('SELECT release_production_order($1)',[one.op]);
 assert.equal(await scalar('SELECT count(*)::integer FROM production_subitem_demands WHERE item_id=$1',[one.item]),3);
 assert.equal(await scalar('SELECT count(*)::integer FROM jobs WHERE production_order_id=$1',[one.op]),1);
 const two=await stockOrder(x.p,1);const second=await scalar('SELECT production_order_preflight($1)',[two.op]);assert.equal(second.ready,true);assert.equal(second.items[0].jobs,0);
});
await test('Atomic rollback when final stock is inactive leaves every child unchanged',async()=>{
 const x=await apple();await assemble(x.p,1);const before=await status(x.p);
 await owner(()=>db.query('UPDATE inventory_items SET is_active=false WHERE id=(SELECT stock_item_id FROM products WHERE id=$1)',[x.p]));
 await assert.rejects(assemble(x.p,1),/estoque do produto final/);
 assert.deepEqual((await status(x.p)).components.map(c=>c.balance),before.components.map(c=>c.balance));
});
await test('Shared subitem product is reserved across two different finished products',async()=>{
 const x=await apple(),other=await product();await add(other,{component_product_id:x.parts[2].component_product_id,quantity_per_product:2});
 const one=await stockOrder(x.p,4);await scalar('SELECT release_production_order($1)',[one.op]);
 assert.equal((await status(other)).ready_to_assemble,1);await assemble(other,1);assert.equal((await status(x.p,4,one.item)).ready_to_assemble,4);
});
await test('Tenant isolation, roles, direct writes and wrong component IDs cannot change stock',async()=>{
 const x=await apple();await assert.rejects(db.query('UPDATE product_subitems SET quantity_per_product=99 WHERE product_id=$1',[x.p]),/permission denied/);
 await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[otherUid]);await assert.rejects(move(x.parts[0].component_product_id,1),/peça/);await assert.rejects(status(x.p),/não encontrado/);
 await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[viewer]);await assert.rejects(move(x.parts[0].component_product_id,1),/permissão/);
 await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[uid]);
});
await test('Regular print planning also emits physical subitems and retries without duplicate jobs',async()=>{
 const x=await apple();await plate(x.p,x.parts);const key=next();
 const jobs=await scalar('SELECT plan_product_plates($1,10,$2)',[x.p,key]);assert.equal(jobs.length,1);assert.deepEqual(await scalar('SELECT plan_product_plates($1,10,$2)',[x.p,key]),jobs);
 const j=await row('SELECT * FROM jobs WHERE id=$1',[jobs[0]]);assert.equal(j.planned_quantity,20);assert.equal(Number(j.est_grams),100);assert.equal(j.production_snapshot.physical_outputs.length,3);
});
await test('Released assembly keeps its original BOM after the catalogue quantity changes',async()=>{
 const x=await apple(),one=await stockOrder(x.p,5);await scalar('SELECT release_production_order($1)',[one.op]);
 await add(x.p,{quantity_per_product:3},x.parts[0].id);assert.equal((await status(x.p,5,one.item)).components[0].quantity_per_product,2);
 await assemble(x.p,5,one.item);assert.equal(Number((await status(x.p)).components[0].balance),10);
});
await test('Subitem losses appear once in the financial result',async()=>{
 const x=await apple(),before=await scalar('SELECT production_financial_result(CURRENT_DATE,CURRENT_DATE)');const key=next();
 await move(x.parts[0].component_product_id,2,'loss',0,key);await move(x.parts[0].component_product_id,2,'loss',0,key);
 const after=await scalar('SELECT production_financial_result(CURRENT_DATE,CURRENT_DATE)');assert.equal(Number(after.component_loss_cost)-Number(before.component_loss_cost),2);
});
console.log(`Validated ${passed} individual physical subitem scenarios.`);
} finally {await db.close();}


