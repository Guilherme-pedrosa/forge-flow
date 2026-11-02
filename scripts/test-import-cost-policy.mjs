// Local PostgreSQL only: unknown company work/supply costs cannot become zero
// when an imported source is saved or repaired. No production connection.
import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
process.on('uncaughtException',error=>{console.error(error.message,error.where??'');process.exit(1);});
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
for (const name of (await readdir(new URL('../supabase/migrations/', import.meta.url))).filter(value => value.endsWith('.sql')).sort()) {
  try { await db.exec((await readFile(new URL('../supabase/migrations/' + name, import.meta.url), 'utf8')).replace(/CREATE EXTENSION IF NOT EXISTS (pg_cron|pg_net);/g, '')); }
  catch (error) { throw new Error(`Migration ${name}: ${error.message} ${error.where ?? ''}`); }
}
const id = n => `94000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const tenant=id(1), owner=id(2), filament=id(3), printer=id(4);
let request=100, passed=0;
const next=()=>id(request++);
const scalar=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0];
const policy={energy_cost_kwh:1.14,labor_cost_hour:25,overhead_percent:3,target_margin:50,machine_hour_cost:2,
 handling_minutes_per_plate:5,finishing_minutes_per_piece:0,assembly_minutes_per_product:0,extras_cost_per_product:0,printer_hour_costs:[{printer_id:printer,hour_cost:3}]};
const setPolicy=async value=>scalar('SELECT save_pricing_settings($1::jsonb,$2,$3)',[JSON.stringify(value),(await scalar('SELECT pricing_settings()')).revision,next()]);
const hash='b'.repeat(64), profile='local:'+hash;
const composition={profile_id:profile,file_sha256:hash,enabled:true,plates:[{index:1,label:'Placa 1',units_per_plate:null,weight_grams:100,time_seconds:3600,
 slicer_estimates:{source:'3mf_slice_info',slicer_version:'02.08.02.61',printer_model_id:null,nozzle_diameters:'0.4',filaments:[{id:1,material_code:'PLA',color_hex:'#FFFFFF',weight_grams:100,length_meters:33}]},
 parts:[{source_key:'file-object:1',name:'Peça',name_source:'file',quantity_per_plate:1,quantity_per_product:null}]}]};
const plan={version:1,printer_id:printer,quantity:1,source_profile_id:profile,source_file_sha256:hash,
 materials:[{source_key:JSON.stringify([1,'PLA','#FFFFFF']),item_id:filament,material_code:'PLA',color_hex:'#FFFFFF',slot_id:1}],
 plates:[{index:1,units_per_plate:1,lines:[{item_id:filament,grams:100}]}]};
const payload={name:'Fonte confirmada',manual_cost:42,cost_estimate:42,sale_price:75,catalog_details:{base_cost:42,accessory_cost:0,other_cost:0},
 catalog_pricing:{cost_source:'manual',price_source:'manual'},file_composition:composition,import_pricing:plan};
const save=()=>scalar("SELECT save_product_with_photos(NULL,$1::jsonb,'[]'::jsonb,$2)",[JSON.stringify(payload),next()]);
const repair=(product,key=next())=>scalar('SELECT save_product_import_pricing($1,$2::jsonb,$3)',[product,JSON.stringify(plan),key]);
const snapshot=async product=>{
 await db.exec('RESET ROLE');
 try { return await scalar('SELECT erp_private.product_bom_snapshot($1,$2)',[product,tenant]); }
 finally { await db.exec('SET ROLE authenticated'); }
};
async function test(name, run) { await run(); passed++; console.log('PASS '+name); }
try {
 await db.query("INSERT INTO auth.users VALUES($1,'policy@qa.invalid')",[owner]);
 await db.query("INSERT INTO tenants(id,name,slug) VALUES($1,'Import cost policy QA','import-cost-policy-qa')",[tenant]);
 await db.query("INSERT INTO profiles(user_id,tenant_id,display_name) VALUES($1,$2,'Owner')",[owner,tenant]);
 await db.query("INSERT INTO user_roles(user_id,tenant_id,role) VALUES($1,$2,'owner')",[owner,tenant]);
 await db.query("INSERT INTO inventory_items(id,tenant_id,name,unit,avg_cost,current_stock,material_code,color,color_code,color_hex,material_identified_at) VALUES($1,$2,'PLA branco','g',0.1,1000,'PLA','Branco','WHITE','#FFFFFF',now())",[filament,tenant]);
 await db.query("INSERT INTO printers(id,tenant_id,name,model,power_watts,depreciation_per_hour,maintenance_cost_per_hour) VALUES($1,$2,'A1','A1',150,2,1)",[printer,tenant]);
 await db.exec('SET ROLE authenticated'); await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[owner]); await setPolicy(policy);
 await test('the company confirmation migration is idempotent and refuses unrelated predecessor drift', async()=>{
  await db.exec('RESET ROLE');
  try {
   const migration=await readFile(new URL('../supabase/migrations/20261102212000_confirm_import_cost_policy.sql',import.meta.url),'utf8');
   const definition=await scalar("SELECT pg_get_functiondef('erp_private.apply_product_import_pricing(uuid,jsonb,uuid)'::regprocedure)");
   await db.exec(migration);
   assert.equal(await scalar("SELECT pg_get_functiondef('erp_private.apply_product_import_pricing(uuid,jsonb,uuid)'::regprocedure)"),definition);
   try { await db.exec(definition.replace('DECLARE t uuid:=erp_private.actor();','-- unreviewed drift\nDECLARE t uuid:=erp_private.actor();')); await assert.rejects(db.exec(migration),/Review the confirmed import pricing function/); }
   finally { await db.exec(definition); }
  } finally { await db.exec('SET ROLE authenticated'); }
 });
 const fields=['handling_minutes_per_plate','finishing_minutes_per_piece','assembly_minutes_per_product','extras_cost_per_product','labor_cost_hour'];
 for (const field of fields) await test(`unknown ${field} rejects source creation and rolls back the product`,async()=>{
  await setPolicy({...policy,[field]:null}); const before=await scalar('SELECT count(*) FROM products');
  await assert.rejects(save(),/Confirme preparação, acabamento, montagem/);
  assert.equal(await scalar('SELECT count(*) FROM products'),before);
 });
 await setPolicy(policy); const product=await save();
 for (const field of fields) await test(`unknown ${field} rejects repair while explicit zero is accepted`,async()=>{
  const before=await snapshot(product);
  await setPolicy({...policy,[field]:null}); await assert.rejects(repair(product),/Confirme preparação, acabamento, montagem/);
  assert.deepEqual(await snapshot(product),before);
  await setPolicy({...policy,[field]:0}); const key=next(); assert.equal(await repair(product,key),product); assert.equal(await repair(product,key),product);
  const commercial=await scalar('SELECT jsonb_build_array(manual_cost_override,sale_price) FROM products WHERE id=$1',[product]);
  assert.deepEqual(commercial,[42,75]);
 });
 console.log(`${passed} company import cost-policy checks passed.`);
} finally { await db.close(); }
