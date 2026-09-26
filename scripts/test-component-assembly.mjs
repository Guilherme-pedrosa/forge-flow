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

// Isolated production-component scenarios. Harness is shared with sales test setup.
async function apple(capacities=[10,100,100]) {
 const p=await product(), plates=[];
 for(const [index,label] of ['Corpo (par de metades)','Caule','Folha'].entries()) {
  const plate=await scalar('SELECT save_product_print_plate(NULL,$1,NULL,$2::jsonb)',[p,JSON.stringify({plate_index:index+1,label,units_per_plate:capacities[index],material_id:material,printer_id:printer,est_grams:100,est_time_seconds:3600})]);
  await scalar("SELECT save_product_material_recipe($1,$2,'per_print',$3::jsonb,NULL,$4,0)",[p,plate,JSON.stringify([{item_id:material,grams:100}]),next()]);plates.push(plate);
 }
 await scalar('SELECT configure_product_assembly($1,true)',[p]);return {p,plates};
}
const status=(p,qty=10,item=null)=>scalar('SELECT assembly_product_status($1,$2,$3)',[p,qty,item]);
const receive=(plate,qty,cost=1,request=next())=>scalar("SELECT receive_existing_components($1,$2,$3,'Contagem física inicial',$4)",[plate,qty,cost,request]);
const assemble=(p,qty,item=null,cost=0,request=next())=>scalar("SELECT assemble_product($1,$2,$3,$4,'Termoformagem e montagem conferidas',$5)",[p,qty,item,cost,request]);
async function opFor(p,qty=5){const {q}=await quoted({p,quantity:qty,ready:false,discount:0,shipping:0});await issue(q);await approve(q);const op=await scalar('SELECT request_production_order($1,NULL,$2)',[q,next()]);return {op,q,item:await scalar('SELECT id FROM production_order_items WHERE production_order_id=$1',[op])};}
async function quality(job,good,request=next()) {
 await owner(()=>db.query("UPDATE jobs SET status='quality_check',inventory_posted_at=now(),actual_total_cost=20,actual_grams=100,actual_time_minutes=60,produced_quantity=planned_quantity WHERE id=$1",[job]));
 return scalar("SELECT confirm_component_output($1,$2,'Peças deformadas',$3)",[job,good,request]);
}
try {
let a;
await test('Apple separates body, stem and leaf balances and assembly bottleneck',async()=>{
 a=await apple();for(const [i,qty] of [30,10,20].entries())await receive(a.plates[i],qty);
 const s=await status(a.p,20);assert.equal(s.ready_to_assemble,10);assert.deepEqual(s.components.map(c=>c.missing),[0,10,0]);assert.deepEqual(s.components.map(c=>c.units_per_print),[10,100,100]);
});
await test('Assembly consumes one set of each component, posts only finished stock and exact cost, and retries safely',async()=>{
 const before=Number(await scalar('SELECT current_stock FROM inventory_items WHERE id=$1',[material])),request=next();
 const assembly=await assemble(a.p,8,null,4,request);assert.equal(await assemble(a.p,8,null,4,request),assembly);
 const s=await status(a.p);assert.equal(s.ready_to_assemble,2);assert.equal(Number(s.finished_stock),8);assert.deepEqual(s.components.map(c=>c.balance),[22,2,12]);
 assert.equal(Number(await scalar('SELECT current_stock FROM inventory_items WHERE id=$1',[material])),before);
 assert.equal(Number(await scalar('SELECT component_cost+finishing_cost FROM product_assemblies WHERE id=$1',[assembly])),28);
 assert.equal(await scalar("SELECT count(*)::integer FROM inventory_movements WHERE reference_type='assembly' AND reference_id=$1",[assembly]),1);
 assert.equal(Number(await scalar('SELECT avg_cost FROM inventory_items WHERE id=(SELECT stock_item_id FROM products WHERE id=$1)',[a.p])),3.5);
 await assert.rejects(assemble(a.p,3),/Faltam componentes/);
});
await test('OP plans only missing component and reserves existing stock once',async()=>{
 const {op,item}=await opFor(a.p,5);const preview=await scalar('SELECT production_order_preflight($1)',[op]);assert.equal(preview.items[0].jobs,1);
 await scalar('SELECT release_production_order($1)',[op]);await scalar('SELECT release_production_order($1)',[op]);
 const jobs=(await db.query('SELECT id,print_plate_id,planned_quantity,component_stock_key FROM jobs WHERE production_order_id=$1',[op])).rows;
 assert.equal(jobs.length,1);assert.equal(jobs[0].print_plate_id,a.plates[1]);assert.equal(jobs[0].planned_quantity,100);assert.ok(jobs[0].component_stock_key);
 assert.deepEqual((await status(a.p,5,item)).components.map(c=>c.missing),[0,3,0]);assert.equal((await status(a.p)).components[1].available,0);
 await assert.rejects(scalar("SELECT transition_production_order($1,'completed')",[op]),/montagem/);
 await quality(jobs[0].id,97);assert.equal((await status(a.p,5,item)).ready_to_assemble,12);
 await assemble(a.p,5,item);await scalar("SELECT transition_production_order($1,'completed')",[op]);
 assert.equal(await scalar('SELECT status FROM production_orders WHERE id=$1',[op]),'completed');assert.equal(Number((await status(a.p)).finished_stock),8);
 assert.deepEqual((await status(a.p)).components.map(c=>c.balance),[17,94,7]);
});
await test('Independent stem batch does not print bodies or leaves and repeats idempotently',async()=>{
 const req=next(),ids=await scalar('SELECT plan_component_batch($1,150,$2)',[a.plates[1],req]);
 assert.equal(ids.length,2);assert.deepEqual(await scalar('SELECT plan_component_batch($1,150,$2)',[a.plates[1],req]),ids);
 assert.equal(await scalar('SELECT count(DISTINCT print_plate_id)::integer FROM jobs WHERE creation_request_id=$1',[req]),1);
 assert.equal(Number(await scalar('SELECT sum(planned_quantity) FROM jobs WHERE creation_request_id=$1',[req])),200);
 const reqQC=next();await quality(ids[0],90,reqQC);assert.equal(await scalar("SELECT confirm_component_output($1,90,'Peças deformadas',$2)",[ids[0],reqQC]),ids[0]);
 assert.equal(await scalar('SELECT quantity FROM component_stock_lots WHERE source_job_id=$1',[ids[0]]),90);
 await scalar("SELECT transition_job($1,'completed')",[ids[0]]);assert.equal(await scalar('SELECT count(*)::integer FROM component_stock_lots WHERE source_job_id=$1',[ids[0]]),1);
 await quality(ids[1],0);assert.equal(await scalar('SELECT count(*)::integer FROM component_stock_lots WHERE source_job_id=$1',[ids[1]]),0);
});
await test('Existing components satisfy an OP with zero print jobs and commercial completion works',async()=>{
 const {p,plates}=await apple();for(const pl of plates)await receive(pl,10);
 const {op,item,q}=await opFor(p,5),sale=await convert(q);await scalar('SELECT release_production_order($1)',[op]);
 assert.equal(await scalar('SELECT count(*)::integer FROM jobs WHERE production_order_id=$1',[op]),0);
 await assert.rejects(scalar("SELECT transition_production_order($1,'completed')",[op]),/montagem/);
 await assemble(p,5,item);await scalar("SELECT transition_production_order($1,'completed')",[op]);
 assert.equal(await scalar('SELECT status FROM orders WHERE id=$1',[sale]),'ready');
});
await test('Two released OPs use FIFO reservations and cannot assemble or plan the same components twice',async()=>{
 const {p,plates}=await apple();for(const pl of plates)await receive(pl,10);
 const first=await opFor(p,8),second=await opFor(p,8);
 await scalar('SELECT release_production_order($1)',[first.op]);await scalar('SELECT release_production_order($1)',[second.op]);
 assert.equal((await status(p,8,first.item)).ready_to_assemble,10);assert.equal((await status(p,8,second.item)).ready_to_assemble,2);
 assert.equal(await scalar('SELECT count(*)::integer FROM jobs WHERE production_order_id=$1',[second.op]),3);
 await assert.rejects(assemble(p,3,second.item),/Faltam componentes/);await assert.rejects(assemble(p,1),/Faltam componentes/);
 await assemble(p,8,first.item);assert.equal((await status(p,8,second.item)).ready_to_assemble,2);
 await assemble(p,2,second.item);await assert.rejects(assemble(p,1,first.item),/Quantidade/);
});
await test('Assembly rollback is atomic if finished stock cannot accept output',async()=>{
 const {p,plates}=await apple();for(const pl of plates)await receive(pl,2);
 const stock=await scalar("SELECT save_inventory_catalog(NULL,'{\"name\":\"Invalid units for assembled SKU\",\"unit\":\"kg\",\"avg_cost\":0}', $1)",[next()]);await owner(()=>db.query('UPDATE products SET stock_item_id=$1 WHERE id=$2',[stock,p]));
 await assert.rejects(assemble(p,1),/unidades/);assert.equal((await status(p)).ready_to_assemble,2);assert.equal(await scalar('SELECT count(*)::integer FROM product_assemblies WHERE product_id=$1',[p]),0);
});
await test('Tenant isolation, viewer permissions and raw writes cannot forge component inventory',async()=>{
 await reject('UPDATE component_stock_lots SET remaining=999',[],/permission denied/);
 await reject('UPDATE products SET assembly_enabled=false WHERE id=$1',[a.p],/Configure|Somente|permission/);
 await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[otherUid]);assert.equal(await scalar('SELECT count(*)::integer FROM component_stock_lots'),0);await assert.rejects(status(a.p),/não encontrado/);
 await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[viewer]);await assert.rejects(receive(a.plates[0],1),/permissão|Permissão|acesso|operação/);
 await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[uid]);
});
await test('Changing color never mixes old component balances into the new variant',async()=>{
 const {p,plates}=await apple();for(const pl of plates)await receive(pl,5);
 const green=await scalar("SELECT save_inventory_catalog(NULL,$1::jsonb,$2)",[JSON.stringify({name:'Green PLA',unit:'kg',material_code:'PLA',color_code:'GREEN',color:'Verde',color_hex:'#00ff00',avg_cost:20,current_stock:10}),next()]);
 await scalar("SELECT save_product_material_recipe($1,$2,'per_print',$3::jsonb,NULL,$4,0)",[p,plates[2],JSON.stringify([{item_id:green,grams:100}]),next()]);
 const s=await status(p);assert.equal(s.ready_to_assemble,0);assert.equal(s.components[2].balance,0);
 await assert.rejects(assemble(p,1),/Faltam componentes/);
});
await test('Bambu API accounting waits for quality, posts good components once, and partial rejects retain consumed material',async()=>{
 const {p,plates}=await apple(),[job]=await scalar('SELECT plan_component_batch($1,100,$2)',[plates[1],next()]);
 const task=next(),raw={id:task,modelId:'apple-test',profileId:100,plateIndex:2,status:2,weight:100,costTime:9000,startTime:'2026-09-13T08:00:00Z',endTime:'2026-09-13T08:02:20Z',amsDetailMapping:[{amsId:0,slotId:0,weight:100}]};
 await owner(()=>db.query('INSERT INTO bambu_tasks(id,tenant_id,bambu_device_id,bambu_task_id,status,weight_grams,cost_time_seconds,start_time,end_time,raw_data) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)',[task,tenant,device,String(raw.id),String(raw.status),raw.weight,raw.costTime,raw.startTime,raw.endTime,JSON.stringify(raw)]));
 const preview=await scalar('SELECT bambu_production_preview($1)',[task]);
 await scalar('SELECT configure_bambu_production($1,$2,100,$3::jsonb,false,true,0,0,0,$4::jsonb,$5)',[task,p,JSON.stringify(preview.filaments.map(f=>({source_key:f.source_key,item_id:material}))),JSON.stringify([{job_id:job,quantity:100}]),plates[1]]);
 const before=Number(await scalar('SELECT current_stock FROM inventory_items WHERE id=$1',[material])),req=next();
 await scalar('SELECT account_bambu_production($1,NULL,NULL,NULL,NULL,NULL,NULL,NULL,$2)',[task,req]);
 assert.equal((await status(p)).components[1].balance,0);assert.equal(await scalar('SELECT status FROM jobs WHERE id=$1',[job]),'quality_check');
 const posted=Number(await scalar('SELECT current_stock FROM inventory_items WHERE id=$1',[material]));assert.ok(Math.abs(before-posted-.1)<.000001);
 const qc=next();await scalar("SELECT confirm_component_output($1,95,'5 caules deformados',$2)",[job,qc]);
 assert.equal((await status(p)).components[1].balance,95);assert.equal(await scalar('SELECT quality_rejected_units FROM bambu_production_records WHERE task_id=$1',[task]),5);
 assert.equal(await scalar('SELECT quality_state FROM bambu_production_records WHERE task_id=$1',[task]),'partially_rejected');
 assert.equal(Number(await scalar('SELECT current_stock FROM inventory_items WHERE id=$1',[material])),posted);
 await scalar('SELECT account_bambu_production($1,NULL,NULL,NULL,NULL,NULL,NULL,NULL,$2)',[task,req]);await scalar("SELECT confirm_component_output($1,95,'5 caules deformados',$2)",[job,qc]);
 assert.equal((await status(p)).components[1].balance,95);
 const lot=await row('SELECT unit_cost,quantity FROM component_stock_lots WHERE source_job_id=$1',[job]);
 assert.ok(Math.abs(Number(lot.unit_cost)*lot.quantity-Number(await scalar('SELECT actual_total_cost FROM jobs WHERE id=$1',[job])))<.000001);
});
await test('In-flight component batches cover new OP demand without duplicate printing, but cannot be assembled before QC',async()=>{
 const {p,plates}=await apple();await receive(plates[0],30);await receive(plates[2],20);
 const [job]=await scalar('SELECT plan_component_batch($1,100,$2)',[plates[1],next()]);
 const {op,item,q}=await opFor(p,5),sale=await convert(q);await scalar('SELECT release_production_order($1)',[op]);
 assert.equal(await scalar('SELECT count(*)::integer FROM jobs WHERE production_order_id=$1',[op]),0);
 const before=await status(p,5,item);assert.equal(before.ready_to_assemble,0);assert.equal(before.components[1].to_print,0);assert.equal(before.components[1].pending,100);
 await assert.rejects(assemble(p,5,item),/Faltam componentes/);await quality(job,100);
 assert.equal(await scalar('SELECT status FROM orders WHERE id=$1',[sale]),'in_production');await assemble(p,5,item);await scalar("SELECT transition_production_order($1,'completed')",[op]);
 assert.equal(await scalar('SELECT status FROM orders WHERE id=$1',[sale]),'ready');
});
await test('Damage during thermoforming reduces components once, exposes replenishment, and never consumes filament twice',async()=>{
 const {p,plates}=await apple();for(const pl of plates)await receive(pl,5);const before=Number(await scalar('SELECT current_stock FROM inventory_items WHERE id=$1',[material]));
 const request=next(),loss=await scalar("SELECT write_off_components($1,2,'Dano na termoformagem',$2)",[plates[0],request]);
 assert.equal(await scalar("SELECT write_off_components($1,2,'Dano na termoformagem',$2)",[plates[0],request]),loss);assert.equal((await status(p,5)).ready_to_assemble,3);
 assert.equal((await status(p,5)).components[0].to_print,2);assert.equal(Number(await scalar('SELECT total_cost FROM component_stock_losses WHERE id=$1',[loss])),2);
 await assert.rejects(scalar("SELECT write_off_components($1,4,'Excesso',$2)",[plates[0],next()]),/superior ao saldo/);
 assert.equal(Number(await scalar('SELECT current_stock FROM inventory_items WHERE id=$1',[material])),before);
});
await test('Component registration accepts name alone and retries once without recipe, cost, printer or file',async()=>{
 const p=await product(),request=next();const part=await scalar("SELECT add_product_component($1,'Caule',NULL,$2)",[p,request]);
 assert.equal(await scalar("SELECT add_product_component($1,'Caule',NULL,$2)",[p,request]),part);
 assert.equal(await scalar('SELECT count(*)::integer FROM product_print_plates WHERE product_id=$1',[p]),1);assert.equal(await scalar('SELECT units_per_plate FROM product_print_plates WHERE id=$1',[part]),null);
 await scalar('SELECT configure_product_assembly($1,true)',[p]);assert.equal((await status(p)).components[0].prepared,false);
});
console.log(`Validated ${passed} component and assembly scenarios.`);
} finally { await db.close(); }
