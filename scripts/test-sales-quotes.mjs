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
try{
await test('Drafts keep missing price and incomplete BOM unknown and cannot be issued',async()=>{
  const {q}=await quoted({ready:false,price:null});const data=await row('SELECT total,subtotal FROM sales_quotes WHERE id=$1',[q]);assert.equal(data.total,null);assert.equal(data.subtotal,null);
  const i=await row('SELECT estimated_unit_cost,product_snapshot FROM sales_quote_items WHERE quote_id=$1',[q]);assert.equal(i.estimated_unit_cost,null);assert.equal(i.product_snapshot.complete,false);
  await assert.rejects(issue(q),/preços|total positivo/);assert.equal(await scalar('SELECT status FROM sales_quotes WHERE id=$1',[q]),'draft');
});
await test('Known sale price cannot hide missing material or unconfirmed nonmaterial cost',async()=>{
  const {q,p}=await quoted({ready:false});await assert.rejects(issue(q),/Complete material/);
  await makeRecipe(p,50,null);await assert.rejects(issue(q),/Complete material/);
  assert.equal(await scalar('SELECT count(*)::integer FROM accounts_receivable'),0);
});
await test('Saving and issuing a complete quote create neither order nor receivable',async()=>{
  const before=await scalar('SELECT count(*)::integer FROM orders');const {q,args}=await quoted();assert.equal(await scalar('SELECT save_sales_quote($1,$2::jsonb,$3::jsonb,$4)',args),q);
  await issue(q);await issue(q);await approve(q);await approve(q);
  assert.equal(await scalar('SELECT count(*)::integer FROM orders'),before);assert.equal(await scalar('SELECT count(*)::integer FROM accounts_receivable'),0);
  const i=await row('SELECT estimated_unit_cost,product_snapshot FROM sales_quote_items WHERE quote_id=$1',[q]);assert.equal(Number(i.estimated_unit_cost),3);assert.equal(i.product_snapshot.complete,true);assert.equal(i.product_snapshot.sources.length,0);
});
await test('Conversion creates one approved order and one receivable, even with a different retry key',async()=>{
  const {q}=await quoted();await issue(q);await approve(q);const request=next(),order=await convert(q,request);
  assert.equal(await convert(q,request),order);assert.equal(await convert(q),order);
  const o=await row('SELECT status,total,source_quote_id FROM orders WHERE id=$1',[order]);assert.equal(o.status,'approved');assert.equal(Number(o.total),22);assert.equal(o.source_quote_id,q);
  const receivables=(await db.query("SELECT amount,due_date::text FROM accounts_receivable WHERE origin_type='order' AND origin_id=$1",[order])).rows;assert.equal(receivables.length,1);assert.equal(Number(receivables[0].amount),22);assert.equal(receivables[0].due_date,future);
  const qi=await row('SELECT id,product_snapshot FROM sales_quote_items WHERE quote_id=$1',[q]);const oi=await row('SELECT source_quote_item_id,product_snapshot FROM order_items WHERE order_id=$1',[order]);assert.equal(oi.source_quote_item_id,qi.id);assert.deepEqual(oi.product_snapshot,qi.product_snapshot);
});
await test('Issued price, material/color and BOM stay frozen after catalog and recipe changes',async()=>{
  const {q,p,args}=await quoted();await issue(q);const frozen=await scalar('SELECT product_snapshot FROM sales_quote_items WHERE quote_id=$1',[q]);
  await makeRecipe(p,80,9);await owner(()=>db.query("UPDATE products SET name='New name',sale_price=99 WHERE id=$1",[p]));
  await approve(q);const order=await convert(q);const item=await row('SELECT unit_price,description,product_snapshot FROM order_items WHERE order_id=$1',[order]);assert.equal(Number(item.unit_price),10);assert.equal(item.description,'Product quoted');assert.deepEqual(item.product_snapshot,frozen);assert.equal(item.product_snapshot.requirements[0].color_code,'BLACK');assert.equal(Number(item.product_snapshot.cost_per_unit),3);
  await assert.rejects(db.query('SELECT save_sales_quote($1,$2::jsonb,$3::jsonb,$4)',[q,args[1],args[2],next()]),/Somente rascunhos/);
  await owner(async()=>{await assert.rejects(db.query("UPDATE orders SET total=1 WHERE id=$1",[order]),/congelados/);await assert.rejects(db.query("UPDATE order_items SET product_snapshot='{}' WHERE order_id=$1",[order]),/não podem ser alterados/);});
});
await test('A stale draft revision cannot overwrite a newer commercial edit',async()=>{
  const {q,payload,items}=await quoted();const edited={...payload,notes:'New revision',expected_revision:1};
  await scalar('SELECT save_sales_quote($1,$2::jsonb,$3::jsonb,$4)',[q,JSON.stringify(edited),JSON.stringify(items),next()]);
  await assert.rejects(db.query('SELECT save_sales_quote($1,$2::jsonb,$3::jsonb,$4)',[q,JSON.stringify({...edited,notes:'Stale overwrite'}),JSON.stringify(items),next()]),/foi alterado/);
  assert.equal(await scalar('SELECT notes FROM sales_quotes WHERE id=$1',[q]),'New revision');
});
await test('Expired quotes cannot be approved and rejection records a reason without creating finance',async()=>{
  const {q}=await quoted();await issue(q);await owner(()=>db.query('UPDATE sales_quotes SET valid_until=CURRENT_DATE-1 WHERE id=$1',[q]));
  await assert.rejects(approve(q),/validade vigente/);await assert.rejects(scalar("SELECT transition_sales_quote($1,'rejected','')",[q]),/motivo/);
  await scalar("SELECT transition_sales_quote($1,'rejected','Customer declined')",[q]);await assert.rejects(convert(q),/Aprove/);assert.equal(await scalar('SELECT rejection_reason FROM sales_quotes WHERE id=$1',[q]),'Customer declined');
});
await test('Missing payment date prevents any converted order or receivable',async()=>{
  const {q}=await quoted();await issue(q);await approve(q);await owner(()=>db.query('UPDATE sales_quotes SET payment_due_date=NULL WHERE id=$1',[q]));const before=await scalar('SELECT count(*)::integer FROM orders');
  await assert.rejects(convert(q),/vencimento/);assert.equal(await scalar('SELECT count(*)::integer FROM orders'),before);assert.equal(await scalar('SELECT order_id FROM sales_quotes WHERE id=$1',[q]),null);
});
await test('A downstream receivable error rolls back order, items, conversion link and request',async()=>{
  const {q}=await quoted();await issue(q);await approve(q);const before=await scalar('SELECT count(*)::integer FROM orders');
  await owner(()=>db.exec("CREATE FUNCTION public.qa_fail_receivable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'QA receivable failure'; END $$; CREATE TRIGGER qa_fail_receivable BEFORE INSERT ON accounts_receivable FOR EACH ROW EXECUTE FUNCTION qa_fail_receivable();"));
  const request=next();await assert.rejects(convert(q,request),/QA receivable failure/);assert.equal(await scalar('SELECT count(*)::integer FROM orders'),before);assert.equal(await scalar('SELECT order_id FROM sales_quotes WHERE id=$1',[q]),null);
  await owner(()=>db.exec('DROP TRIGGER qa_fail_receivable ON accounts_receivable;DROP FUNCTION qa_fail_receivable();'));const order=await convert(q,request);assert.ok(order);
});
await test('Cross-tenant access, forged snapshots, direct writes and viewer actions are rejected',async()=>{
  const {q,payload,items}=await quoted();
  await assert.rejects(db.query('SELECT save_sales_quote(NULL,$1::jsonb,$2::jsonb,$3)',[JSON.stringify(payload),JSON.stringify([{...items[0],product_snapshot:{complete:true,cost_per_unit:0}}]),next()]),/Campo do item não permitido/);
  await assert.rejects(db.query("UPDATE sales_quotes SET status='approved' WHERE id=$1",[q]),/permission denied/);await assert.rejects(db.query('DELETE FROM sales_quote_items WHERE quote_id=$1',[q]),/permission denied/);
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[otherUid]);assert.equal(await scalar('SELECT count(*)::integer FROM sales_quotes WHERE id=$1',[q]),0);await assert.rejects(issue(q),/não encontrado/);await assert.rejects(convert(q),/não encontrado/);
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[viewer]);await assert.rejects(issue(q),/permissão/);await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[uid]);
});

await test('Quote to queue keeps the approved file, recipe, price and full-batch cost after catalogue edits',async()=>{
  const p=await product();const path=`${tenant}/${next()}/base-v1.3mf`,updatedPath=`${tenant}/${next()}/base-v2.3mf`;
  await owner(()=>db.query("INSERT INTO storage.objects(bucket_id,name) VALUES('attachments',$1),('attachments',$2)",[path,updatedPath]));
  const source=await scalar('SELECT save_product_print_source(NULL,$1,$2::jsonb)',[p,JSON.stringify({label:'Original approved file',file_path:path,file_name:'base-v1.3mf'})]);
  const {q}=await quoted({p,quantity:3});await issue(q);const frozen=await scalar('SELECT product_snapshot FROM sales_quote_items WHERE quote_id=$1',[q]);
  await makeRecipe(p,80,9);await owner(()=>db.query("UPDATE products SET sale_price=99,est_time_minutes=5 WHERE id=$1",[p]));
  await scalar('SELECT save_product_print_source($1,$2,$3::jsonb)',[source,p,JSON.stringify({label:'Changed catalogue file',file_path:updatedPath,file_name:'base-v2.3mf'})]);
  await approve(q);const order=await convert(q);await scalar("SELECT transition_sales_order($1,'in_production')",[order]);await scalar("SELECT transition_sales_order($1,'in_production')",[order]);
  const jobs=(await db.query('SELECT planned_quantity,est_grams,est_time_minutes,est_total_cost,sale_price,production_snapshot,print_file_snapshot FROM jobs WHERE order_id=$1 ORDER BY order_unit_index',[order])).rows;
  assert.equal(jobs.length,2);for(const job of jobs){assert.equal(job.planned_quantity,2);assert.equal(Number(job.est_grams),100);assert.equal(job.est_time_minutes,120);assert.equal(Number(job.est_total_cost),6);assert.deepEqual(job.production_snapshot,frozen);assert.equal(job.print_file_snapshot.file_path,path);}
  assert.equal(jobs.reduce((sum,j)=>sum+Number(j.sale_price),0),29);
  const estimate=Number(await scalar('SELECT estimated_total_cost FROM sales_quote_items WHERE quote_id=$1',[q]));assert.equal(estimate,12);assert.equal(Number(await scalar('SELECT quoted_estimated_cost FROM order_items WHERE order_id=$1',[order])),12);
  assert.equal(Number(await scalar('SELECT sum(est_total_cost) FROM jobs WHERE order_id=$1',[order])),estimate);assert.equal(await scalar("SELECT count(*)::integer FROM accounts_receivable WHERE origin_type='order' AND origin_id=$1",[order]),1);
});
await test('Nested kit and multiple plates preserve full physical quantities, costs and every assembly-extra cent',async()=>{
  const a=await product(),b=await product();await makeRecipe(b,50,2);
  const plateData=(index,label,units,grams,time)=>({plate_index:index,label,units_per_plate:units,material_id:material,printer_id:printer,est_grams:grams,est_time_seconds:time,est_cost_per_unit:1});
  const base=await scalar('SELECT save_product_print_plate(NULL,$1,NULL,$2::jsonb)',[a,JSON.stringify(plateData(1,'Base',2,40,1200))]);
  const lid=await scalar('SELECT save_product_print_plate(NULL,$1,NULL,$2::jsonb)',[a,JSON.stringify(plateData(2,'Lid',3,30,900))]);
  await scalar("SELECT save_product_material_recipe($1,$2,'per_unit',$3::jsonb,NULL,$4,1)",[a,base,JSON.stringify([{item_id:material,grams:20}]),next()]);
  await scalar("SELECT save_product_material_recipe($1,$2,'per_unit',$3::jsonb,NULL,$4,0.5)",[a,lid,JSON.stringify([{item_id:material,grams:10}]),next()]);
  const kit=await scalar("SELECT save_product_with_photos(NULL,$1::jsonb,'[]',$2)",[JSON.stringify({name:'Assembly kit',prints_per_plate:1,extras:[{_kit_product_id:a,_kit_qty:2},{_kit_product_id:b,_kit_qty:1},{name:'Assembly package',cost:1.01}],sale_price:30,cost_estimate:null}),next()]);
  const {q}=await quoted({p:kit,ready:false,quantity:3,price:30,discount:1.01,shipping:0});await issue(q);await approve(q);const order=await convert(q);await scalar("SELECT transition_sales_order($1,'in_production')",[order]);
  const jobs=(await db.query('SELECT print_plate_id,product_id,planned_quantity,est_total_cost,est_extras_cost,sale_price,production_snapshot FROM jobs WHERE order_id=$1',[order])).rows;
  assert.equal(jobs.length,7);assert.equal(jobs.filter(j=>j.print_plate_id===base).length,3);assert.equal(jobs.filter(j=>j.print_plate_id===lid).length,2);assert.equal(jobs.filter(j=>j.product_id===b).length,2);
  const totals=await row('SELECT sum(est_total_cost) cost,sum(est_extras_cost) extras,sum(sale_price) revenue FROM jobs WHERE order_id=$1',[order]);
  assert.equal(Number(totals.extras),3.03);assert.equal(Number(totals.cost),27.63);assert.equal(Number(totals.revenue),88.99);
  assert.equal(Number(await scalar('SELECT estimated_total_cost FROM sales_quote_items WHERE quote_id=$1',[q])),27.63);
  assert.ok(jobs.every(j=>j.production_snapshot.product.id===j.product_id));assert.equal(await scalar("SELECT count(*)::integer FROM accounts_receivable WHERE origin_type='order' AND origin_id=$1",[order]),1);
});


await test('A newly created direct sale cannot bypass the complete material recipe requirement',async()=>{
  const p=await product();
  const order=await scalar('SELECT save_sales_order(NULL,$1::jsonb,$2::jsonb,$3)',[JSON.stringify({customer_id:customer,payment_due_date:future,total:20,discount:0,shipping:0}),JSON.stringify([{product_id:p,description:'Unconfigured new sale',quantity:2,unit_price:10,total:20}]),next()]);
  assert.equal(await scalar('SELECT requires_material_recipe FROM orders WHERE id=$1',[order]),true);
  await assert.rejects(scalar("SELECT transition_sales_order($1,'approved')",[order]),/composição|receita/);
  assert.equal(await scalar('SELECT status FROM orders WHERE id=$1',[order]),'draft');assert.equal(await scalar("SELECT count(*)::integer FROM accounts_receivable WHERE origin_type='order' AND origin_id=$1",[order]),0);
});

await test('Missing print duration preserves a draft and blocks emission without creating finance',async()=>{
  const {q,p}=await quoted();await owner(()=>db.query('UPDATE products SET est_time_minutes=0 WHERE id=$1',[p]));
  const before=await scalar('SELECT count(*)::integer FROM accounts_receivable');await assert.rejects(issue(q),/tempo por impressão/);
  assert.equal(await scalar('SELECT status FROM sales_quotes WHERE id=$1',[q]),'draft');assert.equal(await scalar('SELECT count(*)::integer FROM accounts_receivable'),before);
  await owner(()=>db.query('UPDATE products SET est_time_minutes=15 WHERE id=$1',[p]));await issue(q);
});
await test('A missing duration in a nested plate is rejected recursively',async()=>{
  const p=await product();const plate=await scalar('SELECT save_product_print_plate(NULL,$1,NULL,$2::jsonb)',[p,JSON.stringify({plate_index:1,label:'Untimed base',units_per_plate:2,material_id:material,est_grams:100,est_time_seconds:null,est_cost_per_unit:3})]);
  await scalar("SELECT save_product_material_recipe($1,$2,'per_unit',$3::jsonb,NULL,$4,2)",[p,plate,JSON.stringify([{item_id:material,grams:50}]),next()]);
  const kit=await scalar("SELECT save_product_with_photos(NULL,$1::jsonb,'[]',$2)",[JSON.stringify({name:'Untimed kit',prints_per_plate:1,extras:[{_kit_product_id:p,_kit_qty:2}],sale_price:30}),next()]);
  const {q}=await quoted({p:kit,ready:false});await assert.rejects(issue(q),/tempo por impressão da placa Untimed base/);assert.equal(await scalar('SELECT status FROM sales_quotes WHERE id=$1',[q]),'draft');
});

await test('A null order transition never generates production or changes the approved sale',async()=>{
  const {q}=await quoted();await issue(q);await approve(q);const order=await convert(q);
  await assert.rejects(scalar('SELECT transition_sales_order($1,NULL)',[order]),/Status|status/);
  assert.equal(await scalar('SELECT status FROM orders WHERE id=$1',[order]),'approved');assert.equal(await scalar('SELECT count(*)::integer FROM jobs WHERE order_id=$1',[order]),0);
  assert.equal(await scalar("SELECT count(*)::integer FROM accounts_receivable WHERE origin_type='order' AND origin_id=$1",[order]),1);
});
await test('A mixed legacy draft cannot approve one configured item while leaving another without a frozen recipe',async()=>{
  const a=await product(),b=await product();await makeRecipe(a);
  const order=await scalar('SELECT save_sales_order(NULL,$1::jsonb,$2::jsonb,$3)',[JSON.stringify({customer_id:customer,payment_due_date:future,total:20,discount:0,shipping:0}),JSON.stringify([{product_id:a,description:'Configured item',quantity:1,unit_price:10,total:10},{product_id:b,description:'Unconfigured legacy item',quantity:1,unit_price:10,total:10}]),next()]);
  await owner(()=>db.query('UPDATE orders SET requires_material_recipe=false WHERE id=$1',[order]));
  await assert.rejects(scalar("SELECT transition_sales_order($1,'approved')",[order]),/composição|receita/);
  assert.equal(await scalar('SELECT status FROM orders WHERE id=$1',[order]),'draft');assert.equal(await scalar('SELECT count(*)::integer FROM order_items WHERE order_id=$1 AND product_snapshot IS NOT NULL',[order]),0);
  assert.equal(await scalar("SELECT count(*)::integer FROM accounts_receivable WHERE origin_type='order' AND origin_id=$1",[order]),0);
});
console.log(`Validated ${passed} sales quotation scenarios.`);
}finally{await db.close();}
