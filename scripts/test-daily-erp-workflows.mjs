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
const catalog=(kind,values,record=null,request=next())=>scalar('SELECT save_financial_catalog($1,$2,$3::jsonb,$4)',[kind,record,JSON.stringify(values),request]);
const stockOp=(p,qty=5,request=next())=>scalar('SELECT request_stock_production($1::jsonb,NULL,NULL,$2)',[JSON.stringify([{product_id:p,quantity:qty}]),request]);
try {
await test('Financial catalogues: create, idempotent retry, edit and delete actually persist',async()=>{
 for(const [kind,table,values] of [['payment_method','payment_methods',{name:'Pix teste',type:'pix'}],['account','chart_of_accounts',{name:'Receita de impressão',type:'revenue'}],['cost_center','cost_centers',{name:'Fazenda 3D'}]]) {
  const request=next(),record=await catalog(kind,values,null,request); assert.equal(await catalog(kind,values,null,request),record);
  const old=await row(`SELECT * FROM ${table} WHERE id=$1`,[record]);
  await catalog(kind,{...values,code:old.code,name:values.name+' atualizado',expected:old},record);
  assert.equal(await scalar(`SELECT name FROM ${table} WHERE id=$1`,[record]),values.name+' atualizado');
  await reject('SELECT save_financial_catalog($1,$2,$3::jsonb,$4)',[kind,record,JSON.stringify({...values,expected:old}),next()],/alterado/);
  await db.query('SELECT delete_financial_catalog($1,$2)',[kind,record]); assert.equal(await scalar(`SELECT count(*) FROM ${table} WHERE id=$1`,[record]),0);
 }
});
await test('Used classifications retain nature and history, but can be deactivated',async()=>{
 const record=await catalog('account',{name:'Filamentos',type:'expense',code:'DESP.01'});
 await db.query("INSERT INTO accounts_payable(tenant_id,description,amount,due_date,account_id) VALUES($1,'Despesa histórica',50,CURRENT_DATE,$2)",[tenant,record]);
 await reject('SELECT save_financial_catalog($1,$2,$3::jsonb,$4)',['account',record,JSON.stringify({name:'Filamentos',type:'revenue'}),next()],/já usada/);
 await reject("SELECT delete_financial_catalog('account',$1)",[record],/já utilizado/);
 await catalog('account',{name:'Filamentos',type:'expense',is_active:false},record); assert.equal(await scalar('SELECT is_active FROM chart_of_accounts WHERE id=$1',[record]),false);
});
await test('Unused quote draft and rejected proposal delete items; linked and approved proposals are preserved',async()=>{
 const {q}=await quoted();await db.query("SELECT delete_unused_record('quote',$1)",[q]); assert.equal(await scalar('SELECT count(*) FROM sales_quote_items WHERE quote_id=$1',[q]),0);
 const rejected=await quoted();await scalar("SELECT transition_sales_quote($1,'rejected','Cliente desistiu')",[rejected.q]);await db.query("SELECT delete_unused_record('quote',$1)",[rejected.q]);
 const linked=await quoted();await issue(linked.q);await approve(linked.q);await convert(linked.q);
 await reject("SELECT delete_unused_record('quote',$1)",[linked.q],/rascunhos/);
 assert.equal(await scalar('SELECT count(*) FROM sales_quotes WHERE id=$1',[linked.q]),1);
});
await test('Stock OP creates no commercial record, tolerates incomplete setup, retries once',async()=>{
 const p=await product(); const ordersBefore=await scalar('SELECT count(*) FROM orders'),financeBefore=await scalar('SELECT count(*) FROM accounts_receivable');
 const request=next(),op=await stockOp(p,7,request);assert.equal(await stockOp(p,7,request),op);
 assert.deepEqual(await row('SELECT source_quote_id,source_order_id,customer_id,status FROM production_orders WHERE id=$1',[op]),{source_quote_id:null,source_order_id:null,customer_id:null,status:'preparing'});
 assert.equal((await scalar('SELECT production_order_preflight($1)',[op])).ready,false);
 assert.equal(await scalar('SELECT count(*) FROM orders'),ordersBefore);assert.equal(await scalar('SELECT count(*) FROM accounts_receivable'),financeBefore);
});
await test('Multi-plate stock OP requires assembly during preparation, never only at completion',async()=>{
 const a=await apple();await scalar('SELECT configure_product_assembly($1,false)',[a.p]);const op=await stockOp(a.p);
 const review=await scalar('SELECT production_order_preflight($1)',[op]); assert.equal(review.ready,false);assert.match(review.items[0].issues.join(' '),/montagem/);
 await reject('SELECT release_production_order($1)',[op],/montagem/);
});
await test('Apple stock production assembles all three parts and receives finished stock once with cost',async()=>{
 const a=await apple();for(const plate of a.plates)await receive(plate,10,2);
 const op=await stockOp(a.p,5),item=await scalar('SELECT id FROM production_order_items WHERE production_order_id=$1',[op]);await scalar('SELECT release_production_order($1)',[op]);
 await reject("SELECT transition_production_order($1,'completed')",[op],/montagem/);
 await assemble(a.p,5,item,5);await scalar("SELECT transition_production_order($1,'completed')",[op]);await scalar("SELECT transition_production_order($1,'completed')",[op]);
 const stock=await row('SELECT i.current_stock,i.avg_cost FROM products p JOIN inventory_items i ON i.id=p.stock_item_id WHERE p.id=$1',[a.p]);assert.equal(Number(stock.current_stock),5);assert.equal(Number(stock.avg_cost),7);
 assert.equal(await scalar("SELECT count(*) FROM inventory_movements WHERE reference_type='production_order_item' AND reference_id=$1",[item]),1);
 assert.equal(await scalar('SELECT received_quantity FROM production_order_items WHERE id=$1',[item]),5);
});
await test('Single-plate stock production receives actual good batch quantity and no receivable',async()=>{
 const p=await product();await makeRecipe(p);const op=await stockOp(p,3);await scalar('SELECT release_production_order($1)',[op]);
 await owner(()=>db.query("UPDATE jobs SET status='ready',produced_quantity=planned_quantity,actual_total_cost=8,actual_grams=100,actual_time_minutes=60,inventory_posted_at=now() WHERE production_order_id=$1",[op]));
 const expected=await scalar('SELECT sum(produced_quantity)::int FROM jobs WHERE production_order_id=$1',[op]);
 await scalar("SELECT transition_production_order($1,'completed')",[op]);assert.equal(Number(await scalar('SELECT i.current_stock FROM products p JOIN inventory_items i ON i.id=p.stock_item_id WHERE p.id=$1',[p])),expected);
});
await test('Stock receipt rolls back completion when physical stock cannot receive units',async()=>{
 const a=await apple();for(const plate of a.plates)await receive(plate,5,1);const op=await stockOp(a.p,5),item=await scalar('SELECT id FROM production_order_items WHERE production_order_id=$1',[op]);await scalar('SELECT release_production_order($1)',[op]);await assemble(a.p,5,item);
 const linked=await owner(()=>scalar("INSERT INTO inventory_items(tenant_id,name,unit,current_stock) VALUES($1,'Wrong unit','kg',0) RETURNING id",[tenant]));await owner(()=>db.query('UPDATE products SET stock_item_id=$1 WHERE id=$2',[linked,a.p]));
 await reject("SELECT transition_production_order($1,'completed')",[op],/unidades/);assert.equal(await scalar('SELECT status FROM production_orders WHERE id=$1',[op]),'released');
});
await test('Financial and stock commands enforce tenant ownership and role permissions',async()=>{
 const record=await catalog('payment_method',{name:'Transferência',type:'bank_transfer'}),p=await product(),op=await stockOp(p);
 await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[otherUid]);
 await reject('SELECT save_financial_catalog($1,$2,$3::jsonb,$4)',['payment_method',record,'{"name":"Intruso","type":"pix"}',next()],/não encontrado/);
 await reject("SELECT delete_unused_record('quote',$1)",[op],/não encontrado/);
 await reject('SELECT request_stock_production($1::jsonb,NULL,NULL,$2)',[JSON.stringify([{product_id:p,quantity:1}]),next()],/produto ativo/);
 await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[viewer]);await reject("SELECT delete_financial_catalog('payment_method',$1)",[record],/permissão/i);await reject("SELECT transition_production_order($1,'cancelled')",[op],/permissão/i);
 await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[uid]);
});
await test('DRE recognizes commercial assembly and losses without expensing stored components or stock production twice',async()=>{
 const summary=()=>scalar('SELECT production_financial_result(CURRENT_DATE,CURRENT_DATE)');
 let result=await summary();
 assert.equal(result.jobs.length,0);assert.equal(Number(result.assembly_cost),0);
 const a=await apple();for(const plate of a.plates)await receive(plate,10,2);
 const {op,item}=await opFor(a.p,5);await scalar('SELECT release_production_order($1)',[op]);
 await assemble(a.p,5,item,5);assert.equal(Number((await summary()).assembly_cost),0);
 await scalar("SELECT transition_production_order($1,'completed')",[op]);
 assert.equal(Number((await summary()).assembly_cost),35);
 await scalar("SELECT write_off_components($1,2,'Dano na montagem',$2)",[a.plates[0],next()]);
 assert.equal(Number((await summary()).component_loss_cost),4);
 const [goodJob]=await scalar('SELECT plan_component_batch($1,100,$2)',[a.plates[1],next()]);
 await quality(goodJob,90);await scalar("SELECT transition_job($1,'completed')",[goodJob]);
 assert.equal((await summary()).jobs.some(job=>job.id===goodJob),false);
 const [failedJob]=await scalar('SELECT plan_component_batch($1,100,$2)',[a.plates[2],next()]);await quality(failedJob,0);
 result=await summary();assert.equal(result.jobs.length,1);assert.equal(result.jobs[0].id,failedJob);assert.equal(Number(result.jobs[0].actual_total_cost),20);
 const past=await scalar("SELECT production_financial_result(CURRENT_DATE-10,CURRENT_DATE-1)");assert.deepEqual(past,{jobs:[],assembly_cost:0,component_loss_cost:0});
 await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[otherUid]);assert.deepEqual(await summary(),{jobs:[],assembly_cost:0,component_loss_cost:0});
 await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[uid]);
 await reject('SELECT production_financial_result(CURRENT_DATE,CURRENT_DATE-1)',[],/período válido/);
});
console.log(`Validated ${passed} daily ERP workflow scenarios.`);
} finally {await db.close();}
