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
const variantPreview=(p,overrides=[],quantity=1)=>scalar('SELECT product_material_variant_preview($1,$2::jsonb,$3)',[p,JSON.stringify(overrides),quantity]);
const override=(p,item,plate=null,base=material)=>({product_id:p,plate_id:plate,base_item_id:base,item_id:item});
const newColor=(name,color,hex,cost,code='PLA',unit='kg',tenantId=tenant)=>owner(()=>scalar('INSERT INTO inventory_items(tenant_id,name,unit,avg_cost,current_stock,material_code,color,color_code,color_hex) VALUES($1,$2,$3,$4,100,$5,$6,$7,$8) RETURNING id',[tenantId,name,unit,cost,code,color,color.toUpperCase(),hex]));
const plateRecipe=(p,plate,grams,other=1)=>scalar("SELECT save_product_material_recipe($1,$2,'per_print',$3::jsonb,NULL,$4,$5)",[p,plate,JSON.stringify([{item_id:material,grams}]),next(),other]);
const plate=(p,index,units,grams)=>scalar('SELECT save_product_print_plate(NULL,$1,NULL,$2::jsonb)',[p,JSON.stringify({plate_index:index,label:'Part '+index,units_per_plate:units,est_grams:grams,est_time_seconds:600,printer_id:printer})]);
const quoteWith=(p,overrides,quantity=3)=>scalar('SELECT save_sales_quote(NULL,$1::jsonb,$2::jsonb,$3)',[JSON.stringify({customer_id:customer,valid_until:future,payment_due_date:future,due_date:future,discount:0,shipping:0,total:quantity*20}),JSON.stringify([{product_id:p,description:'Chosen color',quantity,unit_price:20,total:quantity*20,material_overrides:overrides}]),next()]);
async function cloudTask(p,{color='FF0000FF',type='PLA',status='2',weight=100,profile=null}={}){
  const task=next();const raw={modelId:'variant-model-'+p,profileId:profile??'variant-profile-'+p,plateIndex:1,designId:'0',instanceId:'0',weight,endTime:'2026-09-13T12:02:20Z',skipObjects:[],amsDetailMapping:[{filamentId:'PLA',filamentType:'PLA',targetFilamentType:type,sourceColor:'000000FF',targetColor:color,amsId:0,slotId:0,weight}]};
  await owner(()=>db.query("INSERT INTO bambu_tasks(id,tenant_id,bambu_device_id,bambu_task_id,status,start_time,end_time,weight_grams,cost_time_seconds,raw_data) VALUES($1,$2,$3,$4,$5,'2026-09-13T12:00:00Z','2026-09-13T12:02:20Z',$6,600,$7::jsonb)",[task,tenant,device,String(sequence),status,weight,JSON.stringify(raw)]));return task;
}
const context=(task,p,allocations=[],overrides=[],plate=null)=>scalar('SELECT bambu_material_selection_preview($1,$2,$3,$4::jsonb,$5::jsonb)',[task,p,plate,JSON.stringify(allocations),JSON.stringify(overrides)]);
async function configure(task,p,item,overrides=[],allocations=[],{auto=false,slicer=true,units=2}={}){
  const ctx=await context(task,p,allocations,overrides),materials=ctx.filaments.map(f=>({source_key:f.source_key,item_id:item}));
  await scalar("SELECT configure_bambu_production($1,$2,$3,$4::jsonb,$5,$6,0,0,0,$7::jsonb,NULL,$8::jsonb)",[task,p,units,JSON.stringify(materials),auto,slicer,JSON.stringify(allocations),JSON.stringify(overrides)]);return materials;
}
const account=(task,materials=null,reason=null)=>scalar('SELECT account_bambu_production($1,$2::jsonb,NULL,NULL,NULL,NULL,NULL,$3,$4)',[task,materials===null?null:JSON.stringify(materials),reason,next()]);
let red,purple,white,petg,foreign;
try{
red=await newColor('Red PLA','Red','#FF0000',80);purple=await newColor('Purple PLA','Purple','#800080',40);white=await newColor('White PLA','White','#FFFFFF',.12,'PLA','g');petg=await newColor('Red PETG','Red','#FF0000',80,'PETG');foreign=await newColor('Foreign PLA','Other','#FF0000',80,'PLA','kg',otherTenant);
await test('A color changes only this selection and prices complete physical batches, including excess capacity',async()=>{
  const p=await product();await makeRecipe(p);const original=await scalar('SELECT product_material_recipe_preview($1)',[p]);const v=await variantPreview(p,[override(p,red)],3);
  assert.equal(Number(v.cost_per_unit),6);assert.equal(Number(v.estimated_total_cost),24);assert.equal(Number(v.estimated_unit_cost),8);assert.equal(v.snapshot.requirements[0].item_id,red);assert.equal(v.snapshot.requirements[0].base_item_id,material);
  assert.deepEqual(await scalar('SELECT product_material_recipe_preview($1)',[p]),original);assert.ok(v.material_options[0].product_name);assert.ok(!v.material_options[0].options.some(o=>o.id===petg||o.id===foreign));
});
await test('Plate scope allows purple base and white lid without modifying the other plate or recipe',async()=>{
  const p=await product(),a=await plate(p,1,2,100),b=await plate(p,2,1,40);await plateRecipe(p,a,100);await plateRecipe(p,b,40);
  const selection=[override(p,purple,a),override(p,white,b)],v=await variantPreview(p,selection,3);assert.equal(v.material_options.length,2);
  assert.equal(Number(v.cost_per_unit),8.8);assert.equal(Number(v.estimated_total_cost),29.4);assert.deepEqual(v.snapshot.plates.map(x=>x.recipe.lines[0].item_id),[purple,white]);
  assert.deepEqual((await scalar('SELECT product_material_recipe_preview($1)',[p])).plates.map(x=>x.recipe.lines[0].item_id),[material,material]);
});
await test('A reused kit component has one selection control per physical scope and conserves lot costs',async()=>{
  const p=await product();await makeRecipe(p);const kitA=await scalar('SELECT save_product_with_photos(NULL,$1::jsonb,\'[]\',$2)',[JSON.stringify({name:'Kit A',category:'kit',extras:[{_kit_product_id:p,_kit_qty:1}]}),next()]);
  const kitB=await scalar('SELECT save_product_with_photos(NULL,$1::jsonb,\'[]\',$2)',[JSON.stringify({name:'Kit B',category:'kit',extras:[{_kit_product_id:p,_kit_qty:2}]}),next()]);
  const kit=await scalar('SELECT save_product_with_photos(NULL,$1::jsonb,\'[]\',$2)',[JSON.stringify({name:'Nested kit',category:'kit',extras:[{_kit_product_id:kitA,_kit_qty:1},{_kit_product_id:kitB,_kit_qty:1},{name:'Assembly box',cost:.01}]}),next()]);
  const v=await variantPreview(kit,[override(p,red)],1);assert.equal(v.material_options.length,1);assert.equal(Number(v.cost_per_unit),18.01);assert.equal(Number(v.estimated_total_cost),24.01);
});
await test('Cross-tenant, polymer changes, duplicate scope and unknown acquisition costs cannot create a false complete estimate',async()=>{
  const p=await product();await makeRecipe(p);await assert.rejects(variantPreview(p,[override(p,petg)]),/mesmo material/);await assert.rejects(variantPreview(p,[override(p,foreign)]),/outra empresa/);
  await assert.rejects(variantPreview(p,[override(p,red),override(p,purple)]),/repetida/);await assert.rejects(variantPreview(p,[override(p,red,next())]),/fora/);
  const unknown=await newColor('Unknown cost','Green','#00FF00',0);const v=await variantPreview(p,[override(p,unknown)]);assert.equal(v.complete,false);assert.equal(v.estimated_total_cost,null);
});
await test('Quotation selection remains frozen through approval, conversion and production after later stock-price changes',async()=>{
  const p=await product();await makeRecipe(p);const selections=[override(p,red)],q=await quoteWith(p,selections);await issue(q);const quotedLine=await row('SELECT * FROM sales_quote_items WHERE quote_id=$1',[q]);assert.deepEqual(quotedLine.material_overrides,selections);assert.equal(Number(quotedLine.estimated_total_cost),24);
  await owner(()=>db.query('UPDATE inventory_items SET avg_cost=100 WHERE id=$1',[red]));await approve(q);const order=await convert(q);await scalar("SELECT transition_sales_order($1,'in_production')",[order]);
  const line=await row('SELECT material_overrides,product_snapshot FROM order_items WHERE order_id=$1',[order]);assert.deepEqual(line.material_overrides,selections);assert.deepEqual(line.product_snapshot,quotedLine.product_snapshot);
  const jobs=(await db.query('SELECT material_id,planned_quantity,est_total_cost,production_snapshot FROM jobs WHERE order_id=$1',[order])).rows;assert.equal(jobs.length,2);assert.ok(jobs.every(j=>j.material_id===red&&j.planned_quantity===2));assert.equal(jobs.reduce((sum,j)=>sum+Number(j.est_total_cost),0),24);
  await owner(()=>db.query('UPDATE inventory_items SET avg_cost=80 WHERE id=$1',[red]));
});
await test('A direct order saves its selected color and approval captures the chosen item cost exactly once',async()=>{
  const p=await product();await makeRecipe(p);const overrides=[override(p,purple)];const order=await scalar('SELECT save_sales_order(NULL,$1::jsonb,$2::jsonb,$3)',[JSON.stringify({customer_id:customer,payment_due_date:future,discount:0,shipping:0,total:40}),JSON.stringify([{product_id:p,description:'Purple sale',quantity:2,unit_price:20,total:40,material_overrides:overrides}]),next()]);
  assert.deepEqual(await scalar('SELECT material_overrides FROM order_items WHERE order_id=$1',[order]),overrides);await scalar("SELECT transition_sales_order($1,'approved')",[order]);assert.equal((await scalar('SELECT product_snapshot FROM order_items WHERE order_id=$1',[order])).requirements[0].item_id,purple);
  await db.query('UPDATE order_items SET material_overrides=\'[]\' WHERE order_id=$1',[order]);assert.deepEqual(await scalar('SELECT material_overrides FROM order_items WHERE order_id=$1',[order]),overrides);assert.equal(await scalar("SELECT count(*)::int FROM accounts_receivable WHERE origin_type='order' AND origin_id=$1",[order]),1);
});
await test('An externally started red print consumes the red stock at its own cost while the SKU stays black',async()=>{
  const p=await product();await makeRecipe(p);const task=await cloudTask(p),ctx=await context(task,p);assert.equal(ctx.material_policy,'execution_variant');assert.equal(ctx.filaments[0].suggested_item_id,red);assert.equal(ctx.filaments[0].base_item_id,material);
  await configure(task,p,red,[override(p,red)]);const before=Number(await scalar('SELECT current_stock FROM inventory_items WHERE id=$1',[red]));const result=await account(task);assert.equal(result.state,'posted');
  assert.equal(Number(await scalar('SELECT current_stock FROM inventory_items WHERE id=$1',[red])),before-.1);assert.equal(Number(await scalar('SELECT material_cost FROM bambu_production_records WHERE task_id=$1',[task])),8);
  const job=await row('SELECT production_snapshot,actual_material_usage FROM jobs WHERE id=$1',[result.job_ids[0]]);assert.equal(job.production_snapshot.requirements[0].item_id,red);assert.equal(job.actual_material_usage[0].item_id,red);assert.equal(job.actual_material_usage[0].cost,8);
  assert.equal((await scalar('SELECT product_material_recipe_preview($1)',[p])).requirements[0].item_id,material);await account(task);assert.equal(await scalar("SELECT count(*)::int FROM inventory_movements WHERE reference_type='bambu_task' AND reference_id=$1",[task]),1);
});
await test('A queued manual job accepts an execution color while keeping its original recipe snapshot immutable',async()=>{
  const p=await product();await makeRecipe(p);const job=(await scalar('SELECT create_jobs($1::jsonb,$2)',[JSON.stringify([{name:'Manual planned print',product_id:p,status:'queued'}]),next()]))[0];const original=await scalar('SELECT production_snapshot FROM jobs WHERE id=$1',[job]);
  const task=await cloudTask(p);await configure(task,p,red,[override(p,red)],[{job_id:job,quantity:2}]);assert.deepEqual(await scalar('SELECT production_snapshot FROM jobs WHERE id=$1',[job]),original);assert.equal((await scalar('SELECT material_selection_snapshot FROM jobs WHERE id=$1',[job])).requirements[0].item_id,red);
  assert.equal((await scalar('SELECT job_production_review($1)',[job])).requirements[0].item_id,red);
  await account(task);assert.equal(Number(await scalar('SELECT actual_material_cost FROM jobs WHERE id=$1',[job])),8);
  await scalar("SELECT transition_job($1,'failed',NULL,NULL,NULL,'Surface defect')",[job]);const reprint=await scalar("SELECT transition_job($1,'reprint')",[job]);assert.deepEqual(await scalar('SELECT production_snapshot FROM jobs WHERE id=$1',[reprint]),original);assert.equal((await scalar('SELECT job_production_review($1)',[reprint])).requirements[0].item_id,red);
});
await test('A sale with an approved white color rejects red execution without touching stock or its approved selection',async()=>{
  const p=await product();await makeRecipe(p);const q=await quoteWith(p,[override(p,white)],2);await issue(q);await approve(q);const order=await convert(q);await scalar("SELECT transition_sales_order($1,'in_production')",[order]);const job=await scalar('SELECT id FROM jobs WHERE order_id=$1',[order]);const task=await cloudTask(p);
  const ctx=await context(task,p,[{job_id:job,quantity:2}]);assert.equal(ctx.material_policy,'approved_order');assert.equal(ctx.expected_materials[0].selected_item_id,white);
  await assert.rejects(configure(task,p,red,[override(p,red)],[{job_id:job,quantity:2}]),/aprovadas/);assert.equal(await scalar("SELECT count(*)::int FROM inventory_movements WHERE reference_type='bambu_task' AND reference_id=$1",[task]),0);
  const whiteTask=await cloudTask(p,{color:'FFFFFFFF'});await configure(whiteTask,p,white,[],[{job_id:job,quantity:2}]);await account(whiteTask);assert.equal(Number(await scalar('SELECT actual_material_cost FROM jobs WHERE id=$1',[job])),12);
});
await test('Failed variants consume only measured grams of the chosen color and do not debit the full prediction',async()=>{
  const p=await product();await makeRecipe(p);const task=await cloudTask(p,{status:'3'}),mapping=await configure(task,p,red,[override(p,red)]);await assert.rejects(account(task,null,'Stopped'),/gramas efetivamente/);
  const r=await account(task,mapping.map(m=>({...m,grams:3})),'Adhesion loss');assert.equal(Number(await scalar('SELECT material_cost FROM bambu_production_records WHERE task_id=$1',[task])),.24);assert.equal(await scalar('SELECT status FROM jobs WHERE id=$1',[r.job_ids[0]]),'failed');
});
await test('A previously confirmed spool is suggested again after another color without silently changing auto-accounting configuration',async()=>{
  const orange=await newColor('Orange without measured hex','Orange',null,60),p=await product();await makeRecipe(p);
  const first=await cloudTask(p,{color:'FF8000FF'});await configure(first,p,orange,[override(p,orange)]);
  const other=await cloudTask(p,{color:'800080FF'});await configure(other,p,purple,[override(p,purple)]);
  const returning=await cloudTask(p,{color:'FF8000FF'}),v=await context(returning,p);assert.equal(v.filaments[0].suggested_item_id,null);assert.equal(v.filaments[0].item_id,orange);assert.equal(v.filaments[0].mapping_source,'saved_history');
  assert.equal((await scalar('SELECT materials FROM bambu_production_profiles WHERE product_id=$1',[p]))[0].item_id,purple);assert.ok((await scalar('SELECT bambu_production_preview($1)',[returning])).material_policy);
});
await test('Orders requiring different colors cannot share a physical attempt or silently select the first order color',async()=>{
  const p=await product();await makeRecipe(p);const jobs=[];
  for(const color of [red,white]){const q=await quoteWith(p,[override(p,color)],2);await issue(q);await approve(q);const order=await convert(q);await scalar("SELECT transition_sales_order($1,'in_production')",[order]);jobs.push(await scalar('SELECT id FROM jobs WHERE order_id=$1',[order]));}
  const task=await cloudTask(p),allocations=jobs.map(job_id=>({job_id,quantity:1})),v=await context(task,p,allocations);
  assert.equal(v.complete,false);assert.match(v.missing.join(' '),/cores ou materiais diferentes/);await assert.rejects(configure(task,p,red,[],allocations),/cores ou materiais diferentes/);
  assert.equal(await scalar("SELECT count(*)::int FROM inventory_movements WHERE reference_type='bambu_task' AND reference_id=$1",[task]),0);
});
await test('Automatic repeat copies the confirmed execution color and rejects a changed AMS identity without inventory movement',async()=>{
  const p=await product();await makeRecipe(p);const first=await cloudTask(p,{status:'1'});await configure(first,p,red,[override(p,red)],[],{auto:true});
  await owner(()=>db.query("UPDATE bambu_production_profiles SET auto_from='2026-09-13T07:00:00Z' WHERE product_id=$1",[p]));
  const before=Number(await scalar('SELECT current_stock FROM inventory_items WHERE id=$1',[red]));const repeated=await cloudTask(p);
  const record=await row('SELECT state,material_snapshot,material_overrides,material_cost FROM bambu_production_records WHERE task_id=$1',[repeated]);
  assert.equal(record.state,'posted');assert.equal(record.material_snapshot.requirements[0].item_id,red);assert.deepEqual(record.material_overrides,[override(p,red)]);assert.equal(Number(record.material_cost),8);
  assert.equal(Number(await scalar('SELECT current_stock FROM inventory_items WHERE id=$1',[red])),before-.1);
  const changed=await cloudTask(p,{color:'800080FF'});assert.notEqual(await scalar('SELECT state FROM bambu_production_records WHERE task_id=$1',[changed]),'posted');assert.equal(await scalar("SELECT count(*)::int FROM inventory_movements WHERE reference_type='bambu_task' AND reference_id=$1",[changed]),0);
});
console.log(`Validated ${passed} material variant scenarios.`);
}finally{await db.close();}
