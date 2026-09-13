import { PGlite } from '@electric-sql/pglite';
import { readdir, readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
process.on('uncaughtException', error => { console.error(error.message, error.cause?.message ?? '', error.where ?? '', error.stack?.split('\n').slice(1,5).join('\n') ?? ''); process.exit(1); });

// An isolated real PostgreSQL engine: no production connection or tenant data.
const db = new PGlite();
await db.exec(`CREATE ROLE authenticated; CREATE ROLE anon;
  CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY,email text);
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
  CREATE SCHEMA storage; CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean);
  CREATE TABLE storage.objects(id uuid DEFAULT gen_random_uuid(),bucket_id text,name text,owner uuid);
  CREATE FUNCTION storage.foldername(text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$ SELECT string_to_array($1,'/') $$;
  ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
  CREATE PUBLICATION supabase_realtime;
  GRANT USAGE ON SCHEMA public,auth,storage TO authenticated,anon;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO authenticated;`);
for (const name of (await readdir(new URL('../supabase/migrations/',import.meta.url))).filter(n=>n.endsWith('.sql')).sort()) {
  const sql = (await readFile(new URL('../supabase/migrations/'+name,import.meta.url),'utf8'))
    .replace(/CREATE EXTENSION IF NOT EXISTS (pg_cron|pg_net);/g,''); // Supabase scheduling only, not business schema.
  try { await db.exec(sql); } catch(error) { throw new Error(`Migration ${name}: ${error.message}`,{cause:error}); }
}
// Never re-grant public SELECT after migrations: that would undo restricted token columns.
await db.exec('GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA storage TO authenticated;');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const uid=id(1), otherUid=id(2), viewerUid=id(3), tenant=id(10), otherTenant=id(11), bank=id(20), otherBank=id(21), material=id(30), otherMaterial=id(31), printer=id(40);
await db.query(`INSERT INTO auth.users VALUES($1,'owner@example.test'),($2,'other@example.test'),($3,'viewer@example.test')`,[uid,otherUid,viewerUid]);
await db.query(`INSERT INTO tenants(id,name,slug,settings) VALUES($1,'Test factory','test-factory','{"energy_cost_kwh":1}'),($2,'Other factory','other-factory','{}')`,[tenant,otherTenant]);
await db.query(`INSERT INTO profiles(user_id,tenant_id,display_name) VALUES($1,$4,'Owner'),($2,$5,'Other'),($3,$4,'Viewer')`,[uid,otherUid,viewerUid,tenant,otherTenant]);
await db.query(`INSERT INTO user_roles(user_id,tenant_id,role) VALUES($1,$4,'owner'),($2,$5,'owner'),($3,$4,'viewer')`,[uid,otherUid,viewerUid,tenant,otherTenant]);
await db.query(`INSERT INTO bank_accounts(id,tenant_id,name,initial_balance) VALUES($1,$3,'Main',1000),($2,$4,'Other',1000)`,[bank,otherBank,tenant,otherTenant]);
await db.query(`INSERT INTO inventory_items(id,tenant_id,name,unit,current_stock,avg_cost,loss_coefficient) VALUES($1,$3,'PLA kg','kg',1,100,0),($2,$4,'Other PLA','g',1000,0.1,0)`,[material,otherMaterial,tenant,otherTenant]);
await db.query(`INSERT INTO printers(id,tenant_id,name,model,status,power_watts,depreciation_per_hour,maintenance_cost_per_hour) VALUES($1,$2,'Test printer','A1','idle',200,2,1)`,[printer,tenant]);
await db.query("INSERT INTO auth.users VALUES($1,'operator@example.test')",[id(4)]);
await db.query("INSERT INTO profiles(user_id,tenant_id,display_name) VALUES($1,$2,'Operator')",[id(4),tenant]);
await db.query("INSERT INTO user_roles(user_id,tenant_id,role) VALUES($1,$2,'operator')",[id(4),tenant]);
// Preserve pre-recipe orders in this legacy plate regression suite.
// New sales and frozen recipes are covered by test-sales-quotes.mjs.
await db.exec('ALTER TABLE orders ALTER COLUMN requires_material_recipe SET DEFAULT false; SET ROLE authenticated;');
await db.query(`SELECT set_config('request.jwt.claim.sub',$1,false)`,[uid]);
let passed=0;
const failures=[];
async function test(name,fn) {
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[uid]);
  try { await fn(); passed++; console.log('PASS '+name); }
  catch(error) { failures.push({name,error}); console.error('FAIL '+name+': '+error.message+(error.where ? ' — '+error.where : '')); }
}
async function scalar(sql,args=[]) { return Object.values((await db.query(sql,args)).rows[0])[0]; }
async function rejects(sql,args,pattern) { await assert.rejects(db.query(sql,args),pattern); }
const money = value => Number(value);
let requestSequence = 1000;
const requestId = () => id(requestSequence++);
const today = await scalar('SELECT CURRENT_DATE::text');
const row = async (sql,args=[]) => (await db.query(sql,args)).rows[0];
async function saveProduct(product, photos=[], productId=null, request=requestId()) {
  return scalar('SELECT save_product_with_photos($1,$2::jsonb,$3::jsonb,$4)',[productId,JSON.stringify(product),JSON.stringify(photos),request]);
}
async function makeMaterial(name,unit='g') {
  return scalar('INSERT INTO inventory_items(tenant_id,name,unit,loss_coefficient) VALUES($1,$2,$3,0) RETURNING id',[tenant,name,unit]);
}
const postMovement=(movement,request=requestId())=>scalar('SELECT post_inventory_movement($1::jsonb,$2)',[JSON.stringify(movement),request]);
const createJobs=(jobs,request=requestId())=>scalar('SELECT create_jobs($1::jsonb,$2)',[JSON.stringify(jobs),request]);
const createJob=async job=>(await createJobs([job]))[0];
async function createOrder(product,quantity=1,unitPrice=20,options={}) {
  const customer=options.customer ?? await scalar("INSERT INTO customers(tenant_id,name) VALUES($1,'Order customer') RETURNING id",[tenant]);
  const items=options.items ?? [{product_id:product,description:'Printed part',quantity,unit_price:unitPrice,total:quantity*unitPrice}];
  const subtotal=items.reduce((sum,item)=>sum+item.total,0);
  const payload={customer_id:customer,payment_due_date:today,due_date:today,discount:0,shipping:0,total:subtotal,...options.order};
  const args=[null,JSON.stringify(payload),JSON.stringify(items),options.request ?? requestId()];
  return {id:await scalar('SELECT save_sales_order($1,$2::jsonb,$3::jsonb,$4)',args),args,payload,items};
}
async function makeConsignment(product,commission=20,quantity=10) {
  const location=await scalar('SELECT create_consignment_location($1::jsonb,$2::jsonb,$3)',[JSON.stringify({name:`Point ${requestSequence}`,commission_percent:commission}),JSON.stringify({name:'Consignment customer'}),requestId()]);
  if(quantity) await scalar("SELECT post_consignment_movement($1,'placement',$2::jsonb,'Initial stock',$3)",[location,JSON.stringify([{product_id:product,quantity,unit_price:0}]),requestId()]);
  return location;
}
async function owner(fn) { await db.exec('RESET ROLE'); try { return await fn(); } finally { await db.exec('SET ROLE authenticated'); } }
const savePlate=(product,data,plate=null,source=null)=>scalar('SELECT save_product_print_plate($1,$2,$3,$4::jsonb)',[plate,product,source,JSON.stringify(data)]);
const planPlates=(product,quantity,request=requestId())=>scalar('SELECT plan_product_plates($1,$2,$3)',[product,quantity,request]);
const basePlate={plate_index:1,label:'Base',units_per_plate:2,material_id:material,printer_id:printer,est_grams:100,est_time_seconds:3600,est_cost_per_unit:3};
const lidPlate={...basePlate,plate_index:2,label:'Tampa',units_per_plate:3,est_grams:60,est_time_seconds:1800,est_cost_per_unit:2};
async function twoPlates(name='Two-part product') {
  const p=await saveProduct({name,prints_per_plate:1,extras:[],cost_estimate:null,sale_price:20});
  return {p,base:await savePlate(p,basePlate),lid:await savePlate(p,lidPlate)};
}
const connection=id(50),device=id(51);
await owner(async()=>{
  await db.query('INSERT INTO bambu_connections(id,tenant_id) VALUES($1,$2)',[connection,tenant]);
  await db.query("INSERT INTO bambu_devices(id,tenant_id,connection_id,printer_id,dev_id,name) VALUES($1,$2,$3,$4,'PLATE-QA','Plate QA')",[device,tenant,connection,printer]);
});
async function task(overrides={}) {
  const taskId=requestId();
  const raw={id:taskId,modelId:'model-'+taskId,profileId:100,plateIndex:1,status:2,weight:100,costTime:9000,startTime:'2026-09-13T08:00:00Z',endTime:'2026-09-13T08:02:20Z',...overrides};
  await owner(()=>db.query('INSERT INTO bambu_tasks(id,tenant_id,bambu_device_id,bambu_task_id,status,weight_grams,cost_time_seconds,start_time,end_time,raw_data) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)',[taskId,tenant,device,String(raw.id),String(raw.status),raw.weight,raw.costTime,raw.startTime,raw.endTime,JSON.stringify(raw)]));
  return taskId;
}
async function sample(product,plate,{units,grams,seconds,cost,source='measured',outcome='completed'}) {
  const t=await task();
  await owner(()=>db.query(`INSERT INTO bambu_production_records(task_id,tenant_id,product_id,plate_id,units,total_grams,elapsed_seconds,total_cost,consumption_source,state,outcome,posted_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'posted',$10,now()) ON CONFLICT(task_id) DO UPDATE SET product_id=excluded.product_id,plate_id=excluded.plate_id,units=excluded.units,total_grams=excluded.total_grams,elapsed_seconds=excluded.elapsed_seconds,total_cost=excluded.total_cost,consumption_source=excluded.consumption_source,state=excluded.state,outcome=excluded.outcome,posted_at=excluded.posted_at`,[t,tenant,product,plate,units,grams,seconds,cost,source,outcome]));
  await owner(()=>scalar('SELECT erp_private.update_product_print_actuals($1)',[product]));return t;
}
await test('Plate writes validate bounds, payload and tenant; clients cannot forge metrics',async()=>{
  const p=await saveProduct({name:'Validation product',extras:[]});
  for(const bad of [{...basePlate,plate_index:1.5},{...basePlate,units_per_plate:1.5},{...basePlate,plate_index:0},{...basePlate,est_grams:-1},{...basePlate,actual_cost_per_unit:0}]) {
    await rejects('SELECT save_product_print_plate(NULL,$1,NULL,$2::jsonb)',[p,JSON.stringify(bad)],/inválid|não permitido/);
  }
  await rejects('SELECT save_product_print_plate(NULL,$1,NULL,$2::jsonb)',[p,JSON.stringify({...basePlate,material_id:otherMaterial})],/outra empresa/);
  await rejects('INSERT INTO product_print_plates(tenant_id,product_id,plate_index,label) VALUES($1,$2,1,\'Forged\')',[tenant,p],/permission denied/);
  const plate=await savePlate(p,basePlate);
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[otherUid]);
  assert.equal(await scalar('SELECT count(*)::int FROM product_print_plates WHERE id=$1',[plate]),0);
  await rejects('SELECT archive_product_print_plate($1)',[plate],/não encontrada/);
});
await test('Two plates sum SKU estimates and plan full physical batches with disclosed extra pieces',async()=>{
  const {p,base,lid}=await twoPlates();
  const estimate=await row('SELECT cost_estimate,est_grams,est_time_minutes,actual_print_cost_per_unit,actual_print_source FROM products WHERE id=$1',[p]);
  assert.equal(Number(estimate.cost_estimate),5);assert.equal(Number(estimate.est_grams),70);assert.equal(estimate.est_time_minutes,40);assert.equal(estimate.actual_print_cost_per_unit,null);assert.equal(estimate.actual_print_source,'partial');
  const request=requestId(),ids=await planPlates(p,5,request);assert.equal(ids.length,5);assert.deepEqual(await planPlates(p,5,request),ids);
  const jobs=(await db.query('SELECT print_plate_id,planned_quantity,est_grams,est_time_minutes,est_total_cost,sale_price,description FROM jobs WHERE id=ANY($1::uuid[])',[ids])).rows;
  assert.equal(jobs.filter(j=>j.print_plate_id===base).length,3);assert.equal(jobs.filter(j=>j.print_plate_id===lid).length,2);
  assert.equal(jobs.reduce((s,j)=>s+Number(j.est_grams),0),420);assert.equal(jobs.reduce((s,j)=>s+Number(j.est_total_cost),0),30);
  assert.equal(jobs.filter(j=>j.description.includes('1 peças extras previstas')).length,2);assert.ok(jobs.every(j=>j.sale_price===null));
  assert.equal(jobs.filter(j=>j.print_plate_id===base).reduce((s,j)=>s+j.planned_quantity,0),6);
  await rejects('SELECT plan_product_plates($1,6,$2)',[p,request],/outra operação/);
  await rejects('SELECT archive_product_print_plate($1)',[base],/pendente/);
  await rejects('SELECT save_product_print_plate($1,$2,NULL,$3::jsonb)',[base,p,JSON.stringify(basePlate)],/pendentes/);
});
await test('A source plate cannot duplicate costs and jobs; identical creation retries return its id',async()=>{
  const p=await saveProduct({name:'Source uniqueness',extras:[]});
  const source=await scalar('SELECT save_product_print_source(NULL,$1,$2::jsonb)',[p,JSON.stringify({label:'File version A',source_url:'https://example.test/file.3mf'})]);
  const plate=await savePlate(p,basePlate,null,source);assert.equal(await savePlate(p,basePlate,null,source),plate);
  assert.equal(await scalar('SELECT count(*)::int FROM product_print_plates WHERE source_id=$1',[source]),1);
  await rejects('SELECT save_product_print_plate(NULL,$1,$2,$3::jsonb)',[p,source,JSON.stringify({...basePlate,label:'Duplicate altered'})],/já possui essa placa/);
  const lid=await savePlate(p,lidPlate,null,source);
  await rejects('SELECT save_product_print_plate($1,$2,$3,$4::jsonb)',[lid,p,source,JSON.stringify({...lidPlate,plate_index:1})],/já possui essa placa/);
});
await test('Later incomplete plate rolls back all earlier jobs and request identity',async()=>{
  const p=await saveProduct({name:'Atomic plan',extras:[]});await savePlate(p,basePlate);const broken=await savePlate(p,{...lidPlate,est_time_seconds:0});
  const request=requestId();await rejects('SELECT plan_product_plates($1,2,$2)',[p,request],/peso e tempo/);
  assert.equal(await scalar('SELECT count(*)::int FROM jobs WHERE product_id=$1',[p]),0);
  await savePlate(p,lidPlate,broken);assert.equal((await planPlates(p,2,request)).length,2);
});
await test('Sales produce batches for all plates, preserve revenue cents and require every plate ready',async()=>{
  const {p,base,lid}=await twoPlates('Sales assembly');const order=await createOrder(p,5,20);
  await scalar("SELECT transition_sales_order($1,'approved')",[order.id]);await scalar("SELECT transition_sales_order($1,'in_production')",[order.id]);await scalar("SELECT transition_sales_order($1,'in_production')",[order.id]);
  assert.equal(await scalar('SELECT count(*)::int FROM jobs WHERE order_id=$1',[order.id]),5);
  const byPlate=(await db.query('SELECT print_plate_id,sum(sale_price) AS revenue,sum(est_total_cost) AS cost FROM jobs WHERE order_id=$1 GROUP BY print_plate_id',[order.id])).rows;
  assert.equal(Number(byPlate.find(r=>r.print_plate_id===base).revenue),60);assert.equal(Number(byPlate.find(r=>r.print_plate_id===lid).revenue),40);
  await rejects("SELECT transition_sales_order($1,'ready')",[order.id],/Conclua/);
  await owner(()=>db.query("UPDATE jobs SET status='completed' WHERE order_id=$1 AND print_plate_id=$2",[order.id,base]));
  await rejects("SELECT transition_sales_order($1,'ready')",[order.id],/Conclua/);
  await owner(()=>db.query("UPDATE jobs SET status='completed' WHERE order_id=$1",[order.id]));
  await scalar("SELECT transition_sales_order($1,'ready')",[order.id]);
});
await test('Mixed plated and legacy kit allocates assembly extras once, with no duplicated sale',async()=>{
  const {p}=await twoPlates('Kit plated part');const legacy=await saveProduct({name:'Legacy screw',prints_per_plate:3,est_grams:3,est_time_minutes:3,cost_estimate:1,extras:[]});
  const kit=await saveProduct({name:'Kit assembly',category:'kit',cost_estimate:9,extras:[{_kit_product_id:p,_kit_qty:1,cost:5},{_kit_product_id:legacy,_kit_qty:3,cost:3},{name:'Packaging',cost:1}]});
  const order=await createOrder(kit,2,20);await scalar("SELECT transition_sales_order($1,'approved')",[order.id]);await scalar("SELECT transition_sales_order($1,'in_production')",[order.id]);
  const values=await row('SELECT count(*)::int AS jobs,sum(sale_price) AS revenue,sum(est_total_cost) AS cost FROM jobs WHERE order_id=$1',[order.id]);
  assert.equal(values.jobs,8);assert.equal(Number(values.revenue),40);assert.equal(Number(values.cost),20);
});
await test('Tiny discounted mixed lines never produce negative cents or lose the final cent',async()=>{
  const {p}=await twoPlates('Cent assembly');const order=await createOrder(p,1,.01,{items:[{product_id:p,description:'Line A',quantity:1,unit_price:.01,total:.01},{product_id:p,description:'Line B',quantity:2,unit_price:.01,total:.02}],order:{discount:.02,total:.01}});
  await scalar("SELECT transition_sales_order($1,'approved')",[order.id]);await scalar("SELECT transition_sales_order($1,'in_production')",[order.id]);
  const values=await row('SELECT sum(sale_price) AS revenue,min(sale_price) AS lowest FROM jobs WHERE order_id=$1',[order.id]);assert.equal(Number(values.revenue),.01);assert.ok(Number(values.lowest)>=0);
});
await test('Incomplete plate costs remain unknown and use equal revenue allocation',async()=>{
  const {p,lid}=await twoPlates('Unknown cost');await savePlate(p,{...lidPlate,est_cost_per_unit:null},lid);
  assert.equal(await scalar('SELECT cost_estimate FROM products WHERE id=$1',[p]),null);
  const order=await createOrder(p,1,10);await scalar("SELECT transition_sales_order($1,'approved')",[order.id]);await scalar("SELECT transition_sales_order($1,'in_production')",[order.id]);
  const jobs=(await db.query('SELECT sale_price FROM jobs WHERE order_id=$1',[order.id])).rows;assert.deepEqual(jobs.map(j=>Number(j.sale_price)),[5,5]);
});
await test('Real SKU metrics sum weighted unit means per required plate and exclude failed attempts',async()=>{
  const {p,base,lid}=await twoPlates('Actual assembly');
  await sample(p,base,{units:3,grams:30,seconds:300,cost:6});await sample(p,base,{units:1,grams:20,seconds:200,cost:4});
  let actual=await row('SELECT actual_print_cost_per_unit,cost_estimate,actual_print_source FROM products WHERE id=$1',[p]);
  assert.equal(actual.actual_print_cost_per_unit,null);assert.equal(Number(actual.cost_estimate),4.5);assert.equal(actual.actual_print_source,'partial');
  await sample(p,lid,{units:2,grams:20,seconds:80,cost:6,source:'slicer_completed'});
  const failed=await sample(p,base,{units:0,grams:100,seconds:100,cost:100,outcome:'failed'});
  assert.deepEqual(await row('SELECT plate_id,plate_label,plate_index FROM bambu_production_review WHERE task_id=$1',[failed]),{plate_id:base,plate_label:'Base',plate_index:1});
  actual=await row('SELECT actual_print_cost_per_unit,actual_print_grams_per_unit,actual_print_seconds_per_unit,actual_print_sample_units,actual_print_source,cost_estimate FROM products WHERE id=$1',[p]);
  assert.equal(Number(actual.actual_print_cost_per_unit),5.5);assert.equal(Number(actual.actual_print_grams_per_unit),22.5);assert.equal(Number(actual.actual_print_seconds_per_unit),165);assert.equal(actual.actual_print_sample_units,2);assert.equal(actual.actual_print_source,'mixed');assert.equal(Number(actual.cost_estimate),5.5);
  const third=await savePlate(p,{...basePlate,plate_index:3,label:'Third part',est_cost_per_unit:null});assert.equal(await scalar('SELECT cost_estimate FROM products WHERE id=$1',[p]),null);
  await scalar('SELECT archive_product_print_plate($1)',[third]);assert.equal(Number(await scalar('SELECT actual_print_cost_per_unit FROM products WHERE id=$1',[p])),5.5);
});
await test('Source binding retains observed 1-based plate identity and rejects ambiguity',async()=>{
  const {p,base,lid}=await twoPlates('Bound assembly');const t=await task({modelId:'assembly',profileId:200,plateIndex:2});
  assert.equal(await scalar('SELECT bind_product_print_plate($1,$2)',[base,t]),base);
  const bound=await row('SELECT model_id,profile_id,plate_index,source_id FROM product_print_plates WHERE id=$1',[base]);assert.equal(bound.model_id,'assembly');assert.equal(bound.profile_id,'200');assert.equal(bound.plate_index,2);assert.ok(bound.source_id);
  await rejects('SELECT bind_product_print_plate($1,$2)',[lid,t],/ambígua|vinculados/);
  const zero=await task({plateIndex:0});await rejects('SELECT bind_product_print_plate($1,$2)',[lid,zero],/Índice remoto/);
  await rejects('SELECT archive_product_print_source($1)',[bound.source_id],/placas ativas|placas vinculadas|Arquive/);
});
await test('Binding sibling plates preserves the parent file and every prior plate identity',async()=>{
  const p=await saveProduct({name:'One file, two plates',extras:[]});
  const source=await scalar('SELECT save_product_print_source(NULL,$1,$2::jsonb)',[p,JSON.stringify({label:'Assembly source',source_url:'https://example.test/assembly.3mf',model_id:'shared-assembly',profile_id:'300'})]);
  const base=await savePlate(p,basePlate,null,source),lid=await savePlate(p,lidPlate,null,source);
  const before=await row('SELECT label,source_url,model_id,profile_id,plate_index,updated_at FROM product_print_sources WHERE id=$1',[source]);
  const baseTask=await task({modelId:'shared-assembly',profileId:300,plateIndex:1}),lidTask=await task({modelId:'shared-assembly',profileId:300,plateIndex:2});
  await scalar('SELECT bind_product_print_plate($1,$2)',[base,baseTask]);await scalar('SELECT bind_product_print_plate($1,$2)',[lid,lidTask]);
  assert.deepEqual(await row('SELECT label,source_url,model_id,profile_id,plate_index,updated_at FROM product_print_sources WHERE id=$1',[source]),before);
  assert.equal((await scalar('SELECT bambu_production_preview($1)',[baseTask])).candidate_plate_id,base);
  assert.equal((await scalar('SELECT bambu_production_preview($1)',[lidTask])).candidate_plate_id,lid);
  const other=await saveProduct({name:'Other SKU',extras:[]});const otherPlate=await savePlate(other,{...basePlate,plate_index:3});
  await rejects('SELECT bind_product_print_plate($1,$2)',[otherPlate,baseTask],/outro produto|ambígu/);
});
await test('An exact bound plate takes precedence over generic design sources shared by different SKUs',async()=>{
  const a=await saveProduct({name:'Exact plate SKU A',extras:[]});
  const sourceA=await scalar('SELECT save_product_print_source(NULL,$1,$2::jsonb)',[a,JSON.stringify({label:'Shared generic A',design_id:'generic-after-binding'})]);
  const plateA=await savePlate(a,basePlate,null,sourceA);
  const t=await task({designId:'generic-after-binding',modelId:'exact-before-generic',profileId:400,plateIndex:1});
  await scalar('SELECT bind_product_print_plate($1,$2)',[plateA,t]);
  const b=await saveProduct({name:'Exact plate SKU B',extras:[]});
  await scalar('SELECT save_product_print_source(NULL,$1,$2::jsonb)',[b,JSON.stringify({label:'Shared generic B',design_id:'generic-after-binding'})]);
  let v=await scalar('SELECT bambu_production_preview($1)',[t]);assert.equal(v.candidate_product_id,a);assert.equal(v.candidate_plate_id,plateA);assert.equal(v.candidate_source,'verified_identifiers');
  await scalar('SELECT configure_bambu_production($1,$2,2,$3::jsonb,false,true,0,0,0,\'[]\',$4)',[t,a,JSON.stringify([{source_key:'single',item_id:material}]),plateA]);
  v=await scalar('SELECT bambu_production_preview($1)',[t]);assert.equal(v.record.product_id,a);assert.equal(v.record.plate_id,plateA);
  await scalar('SELECT account_bambu_production($1,NULL,NULL,NULL,NULL,NULL,NULL,NULL,$2)',[t,requestId()]);
  assert.equal(await scalar('SELECT state FROM bambu_production_records WHERE task_id=$1',[t]),'posted');
});
await test('First explicit configuration resolves generic ambiguity but cannot steal another exact plate binding',async()=>{
  const a=await saveProduct({name:'First binding SKU A',extras:[]}),b=await saveProduct({name:'First binding SKU B',extras:[]});
  const sourceA=await scalar('SELECT save_product_print_source(NULL,$1,$2::jsonb)',[a,JSON.stringify({label:'First generic A',design_id:'generic-first-binding'})]);
  const sourceB=await scalar('SELECT save_product_print_source(NULL,$1,$2::jsonb)',[b,JSON.stringify({label:'First generic B',design_id:'generic-first-binding'})]);
  const plateA=await savePlate(a,basePlate,null,sourceA),plateB=await savePlate(b,basePlate,null,sourceB);
  const t=await task({designId:'generic-first-binding',modelId:'first-explicit-model',profileId:401,plateIndex:1});
  assert.equal((await scalar('SELECT bambu_production_preview($1)',[t])).candidate_source,'ambiguous');
  await scalar('SELECT configure_bambu_production($1,$2,2,$3::jsonb,false,true,0,0,0,\'[]\',$4)',[t,a,JSON.stringify([{source_key:'single',item_id:material}]),plateA]);
  const v=await scalar('SELECT bambu_production_preview($1)',[t]);assert.equal(v.candidate_product_id,a);assert.equal(v.candidate_plate_id,plateA);assert.equal(v.candidate_source,'verified_identifiers');
  const secondTask=await task({designId:'generic-first-binding',modelId:'first-explicit-model',profileId:401,plateIndex:1});
  await rejects('SELECT bind_product_print_plate($1,$2)',[plateB,secondTask],/vinculados|outro produto/);
  assert.equal(await scalar('SELECT model_id FROM product_print_plates WHERE id=$1',[plateB]),null);
});
await test('Editing a plated product preserves aggregated costs, references and atomic photo retries',async()=>{
  const {p,base,lid}=await twoPlates('Before edit');
  await sample(p,base,{units:2,grams:100,seconds:3600,cost:6});await sample(p,lid,{units:3,grams:60,seconds:1800,cost:6});
  const data={name:'After edit',prints_per_plate:1,cost_estimate:999,est_grams:999,est_time_minutes:999,sale_price:10,extras:[]};
  const request=requestId();assert.equal(await saveProduct(data,['https://example.test/edit.jpg'],p,request),p);
  assert.equal(await saveProduct(data,['https://example.test/edit.jpg'],p,request),p);
  const product=await row('SELECT name,cost_estimate,est_grams,est_time_minutes,actual_print_cost_per_unit,margin_percent FROM products WHERE id=$1',[p]);
  assert.equal(product.name,'After edit');assert.equal(Number(product.cost_estimate),5);assert.equal(Number(product.est_grams),70);assert.equal(product.est_time_minutes,40);assert.equal(Number(product.actual_print_cost_per_unit),5);assert.equal(Number(product.margin_percent),50);
  assert.equal(await scalar('SELECT count(*)::int FROM product_photos WHERE product_id=$1',[p]),1);
  await rejects('SELECT save_product_with_photos($1,$2::jsonb,$3::jsonb,$4)',[p,JSON.stringify({...data,name:'Failed edit'}),JSON.stringify(['invalid://photo']),requestId()],/foto inválida/);
  assert.equal(await scalar('SELECT name FROM products WHERE id=$1',[p]),'After edit');
  await savePlate(p,{...lidPlate,est_cost_per_unit:null},lid);
  const partial=await saveProduct({name:'Unknown aggregate',cost_estimate:999,extras:[]});
  await savePlate(partial,basePlate);await savePlate(partial,{...lidPlate,est_cost_per_unit:null});
  await saveProduct({name:'Unknown preserved',cost_estimate:999,sale_price:10,extras:[]},[],partial);
  assert.equal(await scalar('SELECT cost_estimate FROM products WHERE id=$1',[partial]),null);
  await rejects('SELECT erp_private.save_product_with_photos_legacy($1,$2::jsonb,\'[]\'::jsonb,$3)',[p,JSON.stringify(data),requestId()],/permission denied/);
});
await test('Reprint keeps physical plate and planned capacity without copying actual output',async()=>{
  const {p,base}=await twoPlates('Reprinted assembly');const jobs=await planPlates(p,1);const original=await scalar('SELECT id FROM jobs WHERE id=ANY($1::uuid[]) AND print_plate_id=$2',[jobs,base]);
  await owner(()=>db.query("UPDATE jobs SET status='failed',inventory_posted_at=now(),produced_quantity=0 WHERE id=$1",[original]));
  const reprint=await scalar("SELECT transition_job($1,'reprint')",[original]);const j=await row('SELECT print_plate_id,planned_quantity,produced_quantity,actual_total_cost FROM jobs WHERE id=$1',[reprint]);
  assert.equal(j.print_plate_id,base);assert.equal(j.planned_quantity,2);assert.ok(j.produced_quantity===null||j.produced_quantity===0);assert.equal(j.actual_total_cost,null);
});
await test('Bambu posting accounts one physical run per plate and completes the combined SKU reference only after both plates',async()=>{
  const {p,base,lid}=await twoPlates('Integrated physical assembly');const order=await createOrder(p,1,20);
  await scalar("SELECT transition_sales_order($1,'approved')",[order.id]);await scalar("SELECT transition_sales_order($1,'in_production')",[order.id]);
  const jobs=(await db.query('SELECT id,print_plate_id,planned_quantity FROM jobs WHERE order_id=$1 ORDER BY planned_quantity',[order.id])).rows;
  const before=Number(await scalar('SELECT total_prints FROM printers WHERE id=$1',[printer]));let totalCost=0;
  for(const j of jobs){
    const grams=j.print_plate_id===base?100:60;
    const t=await task({plateIndex:j.print_plate_id===base?1:2,weight:grams,amsDetailMapping:[{amsId:0,slotId:0,weight:grams}]});
    const preview=await scalar('SELECT bambu_production_preview($1)',[t]);const mappings=preview.filaments.map(f=>({source_key:f.source_key,item_id:material}));
    await scalar('SELECT configure_bambu_production($1,$2,$3,$4::jsonb,false,true,0,0,0,$5::jsonb,$6)',[t,p,j.planned_quantity,JSON.stringify(mappings),JSON.stringify([{job_id:j.id,quantity:j.planned_quantity}]),j.print_plate_id]);
    const result=await scalar('SELECT account_bambu_production($1,NULL,NULL,NULL,NULL,NULL,NULL,NULL,$2)',[t,requestId()]);
    const posted=await row('SELECT status,produced_quantity,actual_grams,actual_time_seconds FROM jobs WHERE id=$1',[j.id]);
    assert.equal(posted.status,'quality_check');assert.equal(posted.produced_quantity,j.planned_quantity);assert.equal(Number(posted.actual_grams),grams);assert.equal(Number(posted.actual_time_seconds),140);
    totalCost+=Number(result.total_cost)/j.planned_quantity;
    if(j.print_plate_id===base)assert.equal(await scalar('SELECT actual_print_cost_per_unit FROM products WHERE id=$1',[p]),null);
  }
  assert.equal(Number(await scalar('SELECT total_prints FROM printers WHERE id=$1',[printer])),before+2);
  assert.equal(Number(await scalar('SELECT actual_print_grams_per_unit FROM products WHERE id=$1',[p])),70);
  assert.ok(Math.abs(Number(await scalar('SELECT actual_print_cost_per_unit FROM products WHERE id=$1',[p]))-totalCost)<.000001);
  assert.equal(await scalar('SELECT count(*)::int FROM jobs WHERE order_id=$1',[order.id]),2);
});
console.log(`Validated ${passed} product plate scenarios${failures.length ? `; ${failures.length} failed` : ''}.`);
await db.close();
if(failures.length)process.exitCode=1;
