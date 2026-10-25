// Independent numeric acceptance cases: fixed monetary answers, not a second
// implementation of the pricing algorithm. Uses a disposable PostgreSQL only.
import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
process.on('uncaughtException',error=>{console.error(error.message,error.where??'');process.exit(1);});
const at = process.argv.indexOf('--migrations');
const migrations = at >= 0 ? pathToFileURL(path.resolve(process.argv[at + 1]) + path.sep) : new URL('../supabase/migrations/', import.meta.url);
const db = new PGlite();
await db.exec(`CREATE ROLE authenticated; CREATE ROLE anon; CREATE ROLE service_role;
 CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY,email text);
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 CREATE SCHEMA storage; CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean);
 CREATE TABLE storage.objects(id uuid DEFAULT gen_random_uuid(),bucket_id text,name text,owner uuid);
 CREATE FUNCTION storage.foldername(text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$ SELECT string_to_array($1,'/') $$;
 ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY; CREATE PUBLICATION supabase_realtime;
 GRANT USAGE ON SCHEMA public,auth,storage TO authenticated,anon;
 ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO authenticated;`);
for (const name of (await readdir(migrations)).filter(n => n.endsWith('.sql')).sort()) {
  try { await db.exec((await readFile(new URL(name,migrations),'utf8')).replace(/CREATE EXTENSION IF NOT EXISTS (pg_cron|pg_net);/g,'')); }
  catch (error) { throw new Error(`Migration ${name}: ${error.message}`); }
}
const id = n => `23100000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const tenant=id(1), owner=id(2), printer=id(3), material=id(4); let serial=100, passed=0;
const next = () => id(serial++);
const scalar = async (sql,args=[]) => Object.values((await db.query(sql,args)).rows[0])[0];
const rows = async (sql,args=[]) => (await db.query(sql,args)).rows;
const admin = async fn => { await db.exec('RESET ROLE'); try { return await fn(); } finally { await db.exec('SET ROLE authenticated'); } };
const near = (actual,expected,label) => assert.ok(typeof actual==='number' && Math.abs(actual-expected)<1e-7,`${label}: expected ${expected}, got ${actual}`);
const preview = (product,quantity=1,overrides={}) => scalar('SELECT product_pricing_preview($1,$2,$3::jsonb)',[product,quantity,JSON.stringify(overrides)]);
const save = data => scalar("SELECT save_product_with_photos(NULL,$1::jsonb,'[]'::jsonb,$2)",[JSON.stringify(data),next()]);
const settings = () => scalar('SELECT pricing_settings()');
const basePolicy={energy_cost_kwh:1,labor_cost_hour:60,overhead_percent:10,target_margin:30,machine_hour_cost:4,handling_minutes_per_plate:6,finishing_minutes_per_piece:2,assembly_minutes_per_product:5,extras_cost_per_product:1,printer_hour_costs:[]};
async function policy(values=basePolicy) { return scalar('SELECT save_pricing_settings($1::jsonb,$2,$3)',[JSON.stringify(values),(await settings()).revision,next()]); }
async function plan(product,values) { const p=await scalar('SELECT product_pricing_plan($1)',[product]);return scalar('SELECT save_product_pricing_plan($1,$2::jsonb,$3,$4)',[product,JSON.stringify(values),p.revision,next()]); }
function plate(index,grams,hours,parts) {
  return { index,label:'Acceptance plate '+index,units_per_plate:null,weight_grams:grams,time_seconds:hours*3600,
    slicer_estimates:{source:'3mf_slice_info',slicer_version:'02.08.02.61',printer_model_id:null,nozzle_diameters:'0.4',filaments:[{id:1,material_code:'PLA',color_hex:'#00AE42',weight_grams:grams,length_meters:grams/3}]},
    parts:parts.map(([name,yieldCount,perProduct],i)=>({source_key:`file-object:${index}-${i}`,name_source:'file',name,quantity_per_plate:yieldCount,quantity_per_product:perProduct})) };
}
async function product(name,hash,plates,compound) {
  const p=await save({name,extras:[],file_composition:{profile_id:'local:'+hash,file_sha256:hash,enabled:compound,plates}});
  await admin(()=>db.query('UPDATE product_print_plates SET printer_id=$2 WHERE product_id=$1',[p,printer])); return p;
}
function costs(result,expected,field='breakdown') {
  assert.equal(result.complete,true,JSON.stringify(result.missing));
  for(const [key,value] of Object.entries(expected))near(result[field][key],value,`${field}.${key}`);
}
async function test(name,fn) { try { await fn(); passed++; console.log('PASS '+name); } catch(error) { console.error('FAIL '+name+': '+error.message); throw error; } }
try {
  await db.query("INSERT INTO auth.users VALUES($1,'acceptance@qa.invalid')",[owner]);
  await db.query("INSERT INTO tenants(id,name,slug,settings) VALUES($1,'Independent pricing acceptance','independent-pricing-acceptance','{}')",[tenant]);
  await db.query("INSERT INTO profiles(user_id,tenant_id,display_name) VALUES($1,$2,'Acceptance owner')",[owner,tenant]);
  await db.query("INSERT INTO user_roles(user_id,tenant_id,role) VALUES($1,$2,'owner')",[owner,tenant]);
  await db.query("INSERT INTO printers(id,tenant_id,name,model,power_watts,depreciation_per_hour,maintenance_cost_per_hour) VALUES($1,$2,'Acceptance A1','A1',100,2,1)",[printer,tenant]);
  await db.query("INSERT INTO inventory_items(id,tenant_id,name,unit,avg_cost,current_stock,material_code,color,color_code,color_hex) VALUES($1,$2,'PLA acceptance','g',0.1,0,'PLA','Verde','GREEN','#00AE42')",[material,tenant]);
  await db.exec('SET ROLE authenticated'); await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[owner]); await policy();
  const simple=await product('Ten pieces per plate','c'.repeat(64),[plate(1,200,2,[['Single piece',10,null]])],false);
  await plan(simple,{assembly_minutes_per_product:0});
  const apple=await product('Apple independent cost oracle','d'.repeat(64),[
    plate(1,240,4,[['Half',12,2]]),plate(2,120,2,[['Stem',20,1],['Leaf',10,1]])],true);
  await test('Standard unit economics prorate a plate and apply one margin over sales revenue',async()=>{
    const result=await preview(simple,3);
    costs(result,{material:6,energy:.06,machine:2.4,handling:1.8,finishing:6,assembly:0,extras:3,overhead:1.626,total_lot:20.886,unit_cost:6.962});
    near(result.suggested_unit_price,9.95,'suggested price'); assert.equal(result.runs[0].full_runs,1);
    assert.ok((result.suggested_unit_price-result.breakdown.unit_cost)/result.suggested_unit_price>=.3);
  });
  await test('Exclusive lot rounds only physical runs; unused pieces are not finished or packaged',async()=>{
    const result=await preview(simple,3,{cost_basis:'exclusive_lot'});
    costs(result,{material:20,energy:.2,machine:8,handling:6,finishing:6,assembly:0,extras:3,overhead:4.02,total_lot:47.22,unit_cost:15.74});
    near(result.suggested_unit_price,22.49,'exclusive price'); assert.equal(result.runs[0].outputs[0].surplus_units,7);
    costs(await preview(simple,10,{cost_basis:'exclusive_lot'}),{total_lot:69.62,unit_cost:6.962});
    costs(await preview(simple,11,{cost_basis:'exclusive_lot'}),{total_lot:110.44,unit_cost:10.04});
  });
  await test('Apple halves plus a shared stem/leaf plate are charged once with the limiting yield',async()=>{
    const result=await preview(apple,7);
    costs(result,{material:36.4,energy:91/150,machine:364/15,handling:11.2,finishing:56,assembly:35,extras:7,overhead:122605/7500,total_lot:1401155/7500,unit_cost:200165/7500});
    near(result.suggested_unit_price,38.13,'apple unit price'); assert.equal(result.plates.length,2);
    const runs=result.runs.map(r=>r.required_runs).sort((a,b)=>a-b);near(runs[0],.7,'shared plate runs');near(runs[1],7/6,'half plate runs');
  });
  await test('Exclusive apple order charges 3 full runs and reports all component leftovers',async()=>{
    const result=await preview(apple,7,{cost_basis:'exclusive_lot'});
    costs(result,{material:60,energy:1,machine:40,handling:18,finishing:56,assembly:35,extras:7,overhead:21,total_lot:238,unit_cost:34});
    near(result.suggested_unit_price,48.58,'apple exclusive price');
    assert.deepEqual(result.runs.flatMap(r=>r.outputs).map(o=>o.surplus_units).sort((a,b)=>a-b),[3,10,13]);
    assert.equal(result.runs.reduce((sum,r)=>sum+r.full_runs,0),3);
  });
  await test('Cached component totals and selling prices are not charged on top of the same physical plates',async()=>{
    await admin(()=>db.query('UPDATE products SET cost_estimate=999,sale_price=1999 WHERE id IN(SELECT component_product_id FROM product_subitems WHERE product_id=$1)',[apple]));
    costs(await preview(apple,7,{cost_basis:'exclusive_lot'}),{total_lot:238,unit_cost:34});
  });
  await test('Stock balance zero keeps known material cost; consumption history cannot confirm a missing zero cost',async()=>{
    assert.equal(await scalar('SELECT current_stock::float FROM inventory_items WHERE id=$1',[material]),0);assert.equal((await preview(simple)).complete,true);
    await admin(()=>db.query('UPDATE inventory_items SET avg_cost=0 WHERE id=$1',[material])); assert.equal((await preview(simple)).complete,false);
    await admin(()=>db.query('UPDATE inventory_items SET current_stock=1 WHERE id=$1',[material]));
    await admin(()=>db.query("INSERT INTO inventory_movements(tenant_id,item_id,movement_type,quantity,unit_cost) VALUES($1,$2,'job_consumption',1,NULL)",[tenant,material]));
    assert.equal((await preview(simple)).complete,false,'uncosted consumption is not evidence of free material');
    await admin(()=>db.query("INSERT INTO inventory_movements(tenant_id,item_id,movement_type,quantity,unit_cost) VALUES($1,$2,'purchase_in',1,0)",[tenant,material]));
    const free=await preview(simple); assert.equal(free.complete,true,JSON.stringify(free.missing));near(free.breakdown.material,0,'explicit free material');
    await admin(()=>db.query('UPDATE inventory_items SET avg_cost=.1 WHERE id=$1',[material]));
  });
  await test('Explicit zero plate tariffs override defaults without modifying operational depreciation or balances',async()=>{
    const before=await rows('SELECT id,current_stock,avg_cost FROM inventory_items ORDER BY id'), count=await scalar('SELECT count(*)::integer FROM inventory_movements');
    const p=await preview(simple,3), plateId=p.plates[0].plate_id;
    const changed=await preview(simple,3,{plates:[{plate_id:plateId,machine_hour_cost:0,handling_minutes:0}]});
    costs(changed,{machine:0,handling:0}); near(await scalar('SELECT depreciation_per_hour::float FROM printers WHERE id=$1',[printer]),2,'depreciation unchanged');
    assert.deepEqual(await rows('SELECT id,current_stock,avg_cost FROM inventory_items ORDER BY id'),before);assert.equal(await scalar('SELECT count(*)::integer FROM inventory_movements'),count);
  });
  console.log(`Independent product pricing acceptance: ${passed} numeric scenario groups passed.`);
} finally { await db.close(); }
