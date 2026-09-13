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
  if(name==='20260913035000_product_material_recipe.sql') await db.exec(`
    INSERT INTO tenants(id,name,slug) VALUES('00000000-0000-4000-8000-000000000999','Legacy test only','legacy-structured-test');
    INSERT INTO inventory_items(id,tenant_id,name,unit,material_type,color) VALUES
      ('00000000-0000-4000-8000-000000000991','00000000-0000-4000-8000-000000000999','Opaque stock name','kg',' petg ',' Azul '),
      ('00000000-0000-4000-8000-000000000992','00000000-0000-4000-8000-000000000999','PLA Vermelho','kg',NULL,NULL),
      ('00000000-0000-4000-8000-000000000993','00000000-0000-4000-8000-000000000999','Premium','kg','PLA PREMIUM',NULL),
      ('00000000-0000-4000-8000-000000000994','00000000-0000-4000-8000-000000000999','Invalid structured color','kg','PLA','azul;verde');
  `);
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
await db.exec('SET ROLE authenticated;');
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
const recipe=(product,lines,{plate=null,basis='per_unit',notes=null,other=0,request=requestId()}={})=>scalar('SELECT save_product_material_recipe($1,$2,$3,$4::jsonb,$5,$6,$7)',[product,plate,basis,JSON.stringify(lines),notes,request,other]);
const preview=p=>scalar('SELECT product_material_recipe_preview($1)',[p]);
const identify=(item,color='Vermelho',code='RED',hex='#FF0000',materialCode='PLA')=>db.query('UPDATE inventory_items SET material_code=$1,color=$2,color_code=$3,color_hex=$4 WHERE id=$5',[materialCode,color,code,hex,item]);
await test('Migration preserves exact structured material and color with an audit, without inferring legacy names',async()=>owner(async()=>{
  const rows=(await db.query('SELECT id,material_code,color,color_code,color_hex,material_identified_at,material_identified_by FROM inventory_items WHERE tenant_id=$1 ORDER BY id',[id(999)])).rows;
  assert.equal(rows[0].material_code,'PETG');assert.equal(rows[0].color_code,'AZUL');assert.ok(rows[0].material_identified_at);assert.equal(rows[0].material_identified_by,null);assert.equal(rows[0].color_hex,null);
  assert.equal(rows[0].color,'Azul');
  for(const row of rows.slice(1)) {assert.equal(row.material_code,null);assert.equal(row.color_code,null);assert.equal(row.material_identified_at,null);}
  const audits=(await db.query("SELECT user_id,metadata FROM audit_log WHERE action='material_identity_migration' AND tenant_id=$1",[id(999)])).rows;
  assert.equal(audits.length,1);assert.equal(audits[0].user_id,null);assert.equal(audits[0].metadata.original_material_type,' petg ');assert.equal(audits[0].metadata.original_color,' Azul ');
  assert.equal(await scalar('SELECT count(*)::int FROM product_material_recipe_versions WHERE tenant_id=$1',[id(999)]),0);
}));
await test('Legacy names never classify themselves and unknown material/cor cannot enter a recipe',async()=>{
  const p=await saveProduct({name:'Recipe product',prints_per_plate:4,cost_estimate:999,extras:[]});
  assert.equal(await scalar('SELECT material_code FROM inventory_items WHERE id=$1',[material]),null);
  await assert.rejects(recipe(p,[{item_id:material,grams:100}]),/Identifique material/);
  await identify(material);assert.equal(await scalar('SELECT material_code FROM inventory_items WHERE id=$1',[material]),'PLA');
  await rejects("UPDATE inventory_items SET material_code='OTHER',material_description=NULL WHERE id=$1",[material],/Descreva/);
  await rejects("UPDATE inventory_items SET color_hex='red' WHERE id=$1",[material],/#RRGGBB/);
  await rejects("UPDATE inventory_items SET material_code='FAKE' WHERE id=$1",[material],/catálogo/);
});
const blue=await makeMaterial('Exact blue PLA');
await identify(blue,'Azul','BLUE','#0000FF');
await postMovement({item_id:blue,movement_type:'purchase_in',quantity:500,unit_cost:.2,notes:'Blue test receipt'});
await test('Multi-material grams convert g/kg once and fresh recipe cost ignores old product estimate',async()=>{
  const p=await saveProduct({name:'Red and blue part',prints_per_plate:4,cost_estimate:999,extras:[]});
  const id=await recipe(p,[{item_id:material,grams:100},{item_id:blue,grams:50}],{basis:'per_print',other:2});
  const v=await preview(p);assert.equal(v.complete,true);assert.equal(Number(v.material_cost_per_unit),5);assert.equal(Number(v.cost_per_unit),7);
  assert.equal(v.recipe.version_id,id);assert.equal(v.recipe.units_per_print,4);assert.equal(v.recipe.lines.find(l=>l.item_id===material).grams_per_unit,25);
  assert.equal(v.recipe.lines.find(l=>l.item_id===blue).color_code,'BLUE');assert.equal(v.product.cost_estimate,999);assert.equal(v.sources.length,0);
});
await test('Recipe revisions retry once, preserve old snapshots and protect currently referenced material identity',async()=>{
  const p=await saveProduct({name:'Versioned recipe',extras:[]});const request=requestId();const lines=[{item_id:material,grams:10}];
  const first=await recipe(p,lines,{request});assert.equal(await recipe(p,lines,{request}),first);
  await assert.rejects(recipe(p,[{item_id:material,grams:11}],{request}),/outra operação/);
  await rejects("UPDATE inventory_items SET color='Azul',color_code='BLUE',color_hex='#0000FF' WHERE id=$1",[material],/histórico de uma composição/);
  const second=await recipe(p,[{item_id:blue,grams:12}],{notes:'Changed exact item'});assert.notEqual(second,first);
  assert.equal(await scalar('SELECT count(*)::int FROM product_material_recipe_versions WHERE product_id=$1',[p]),2);
  assert.equal(await scalar('SELECT is_current FROM product_material_recipe_versions WHERE id=$1',[first]),false);
  assert.equal(await scalar("SELECT item_snapshot->>'color_code' FROM product_material_recipe_lines WHERE recipe_version_id=$1",[first]),'RED');
  await rejects("UPDATE inventory_items SET color_code='DIFFERENT' WHERE id=$1",[material],/histórico de uma composição/);
  await rejects('UPDATE product_material_recipe_lines SET grams=999 WHERE recipe_version_id=$1',[first],/permission denied/);
});
await test('A bad later recipe line rolls back its new revision and keeps the current recipe intact',async()=>{
  const p=await saveProduct({name:'Atomic material recipe',extras:[]});const first=await recipe(p,[{item_id:material,grams:10}]);
  await assert.rejects(recipe(p,[{item_id:blue,grams:12},{item_id:otherMaterial,grams:10}]),/empresa/);
  assert.equal((await preview(p)).recipe.version_id,first);assert.equal(await scalar('SELECT count(*)::int FROM product_material_recipe_versions WHERE product_id=$1',[p]),1);
  await assert.rejects(recipe(p,[{item_id:blue,grams:12},{item_id:blue,grams:10}]),/mais de uma vez/);
  const volume=await makeMaterial('Resin volume','ml');await identify(volume,'Transparente','CLEAR',null,'RESIN');
  await assert.rejects(recipe(p,[{item_id:volume,grams:5}]),/g ou kg/);
});
await test('Missing acquisition cost or unconfirmed other costs keep the draft estimate incomplete',async()=>{
  const empty=await makeMaterial('Unpriced green');await identify(empty,'Verde','GREEN','#00FF00');
  const p=await saveProduct({name:'Incomplete costs',extras:[],cost_estimate:99});
  await recipe(p,[{item_id:empty,grams:10}],{other:null});let v=await preview(p);assert.equal(v.complete,false);assert.equal(v.cost_per_unit,null);assert.ok(v.missing.length>=2);
  await rejects("UPDATE inventory_items SET unit='kg' WHERE id=$1",[empty],/histórico de uma composição/);
  await postMovement({item_id:empty,movement_type:'purchase_in',quantity:10,unit_cost:0,notes:'Confirmed free sample'});
  await recipe(p,[{item_id:empty,grams:10}],{other:0});v=await preview(p);assert.equal(v.complete,true);assert.equal(v.cost_per_unit,0);
});
await test('Every physical plate needs its own recipe and a yield change requires a new version',async()=>{
  const p=await saveProduct({name:'Plate BOM assembly',extras:[],prints_per_plate:1});
  const makePlate=(n,units)=>scalar('SELECT save_product_print_plate(NULL,$1,NULL,$2::jsonb)',[p,JSON.stringify({plate_index:n,label:'Plate '+n,units_per_plate:units,est_grams:100,est_time_seconds:60,est_cost_per_unit:999})]);
  const base=await makePlate(1,2),lid=await makePlate(2,4);
  await assert.rejects(recipe(p,[{item_id:material,grams:10}]),/possui placas/);
  await recipe(p,[{item_id:material,grams:100}],{plate:base,basis:'per_print',other:1});assert.equal((await preview(p)).complete,false);
  await recipe(p,[{item_id:blue,grams:20}],{plate:lid,basis:'per_unit',other:2});let v=await preview(p);assert.equal(v.complete,true);assert.equal(v.cost_per_unit,12);assert.equal(v.plates.length,2);
  await scalar('SELECT save_product_print_plate($1,$2,NULL,$3::jsonb)',[lid,p,JSON.stringify({plate_index:2,label:'Plate 2',units_per_plate:5,est_grams:100,est_time_seconds:60,est_cost_per_unit:999})]);
  v=await preview(p);assert.equal(v.complete,false);assert.ok(v.missing.some(m=>m.includes('Capacidade')));
});
await test('Kit snapshots recurse, multiply exact materials and add only the kit own extras once',async()=>{
  const a=await saveProduct({name:'Recipe kit child',extras:[{name:'Leaf included',cost:5}],cost_estimate:999});await recipe(a,[{item_id:blue,grams:10}],{other:3});
  const kit=await saveProduct({name:'Recipe kit',category:'kit',extras:[{_kit_product_id:a,_kit_qty:2,cost:999},{name:'Kit box',cost:1}]});
  const v=await preview(kit);assert.equal(v.complete,true);assert.equal(v.cost_per_unit,11);assert.equal(v.material_cost_per_unit,4);assert.equal(v.requirements[0].grams_per_unit,20);assert.equal(v.components[0].snapshot.cost_per_unit,5);
});
await test('Recipes and preview remain tenant-scoped and viewers cannot publish a recipe',async()=>{
  const p=await saveProduct({name:'Private BOM',extras:[]});await recipe(p,[{item_id:material,grams:10}]);
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[otherUid]);await assert.rejects(preview(p),/não encontrado/);assert.equal(await scalar('SELECT count(*)::int FROM product_material_recipe_versions WHERE product_id=$1',[p]),0);
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[viewerUid]);await assert.rejects(recipe(p,[{item_id:material,grams:10}]),/permissão/);
});
console.log(`Validated ${passed} material recipe scenarios${failures.length?`; ${failures.length} failed`:''}.`);
await db.close();if(failures.length)process.exitCode=1;
