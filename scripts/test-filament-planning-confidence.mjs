import { PGlite } from '@electric-sql/pglite';
import { readdir, readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

// Focal, isolated contracts: physical confidence changes, never another debit.
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
for (const name of (await readdir(new URL('../supabase/migrations/', import.meta.url))).filter(name => name.endsWith('.sql')).sort()) {
 const sql = (await readFile(new URL('../supabase/migrations/' + name, import.meta.url), 'utf8')).replace(/CREATE EXTENSION IF NOT EXISTS (pg_cron|pg_net);/g, '');
 try { await db.exec(sql); } catch (error) { throw new Error(`Migration ${name}: ${error.message}`, { cause: error }); }
}
const id = number => `00000000-0000-4000-8000-${String(number).padStart(12,'0')}`;
const user=id(1),tenant=id(10),material=id(20),otherMaterial=id(21),printer=id(30);
await db.query(`INSERT INTO auth.users VALUES($1,'physical@example.test')`,[user]);
await db.query(`INSERT INTO tenants(id,name,slug,settings) VALUES($1,'Physical confidence','physical-confidence','{"energy_cost_kwh":1}')`,[tenant]);
await db.query(`INSERT INTO profiles(user_id,tenant_id,display_name) VALUES($1,$2,'Owner')`,[user,tenant]);
await db.query(`INSERT INTO user_roles(user_id,tenant_id,role) VALUES($1,$2,'owner')`,[user,tenant]);
await db.query(`INSERT INTO inventory_items(id,tenant_id,name,category,unit,current_stock,avg_cost,loss_coefficient) VALUES($1,$3,'PLA red','filament','kg',2,100,0),($2,$3,'PLA brown','filament','g',1000,0.1,0)`,[material,otherMaterial,tenant]);
await db.query(`INSERT INTO printers(id,tenant_id,name,model,status,power_watts,depreciation_per_hour,maintenance_cost_per_hour) VALUES($1,$2,'A1','A1','idle',200,2,1)`,[printer,tenant]);
await db.exec('SET ROLE authenticated');
await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[user]);
const scalar=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0];
const row=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
let sequence=1000;
const request=()=>id(sequence++);
const spoolData=(label,item=material,kind='printer')=>({item_id:item,label,tare_grams:200,initial_net_grams:1000,weight_source:'manual_weighing',measured_gross_grams:1200,location_kind:kind,location_label:'Depósito',printer_id:kind==='printer'?printer:null,ams_unit:null,ams_slot:null,is_active:true});
const save=(spool,data)=>scalar('SELECT save_filament_spool($1,$2::jsonb,$3,$4)',[spool,JSON.stringify(data),'Pesagem física',request()]);
const createJob=async()=> (await scalar('SELECT create_jobs($1::jsonb,$2)',[JSON.stringify([{name:'Physical confidence',status:'queued',material_id:material,printer_id:printer,est_grams:200}]),request()]))[0];
const reserve=(job,spool)=>scalar('SELECT reserve_job_filament($1,$2,$3,100,$4,$5)',[job,material,spool,'Placa seguinte',request()]);
const complete=async(job,grams)=>{
 await scalar("SELECT transition_job($1,'printing')",[job]);
 await scalar("SELECT transition_job($1,'completed',$2,60,0,NULL,NULL,NULL,0,0,0)",[job,grams]);
};
const mounted=await save(null,spoolData('Red mounted'));
const stored=await save(null,spoolData('Red storage',material,'storage'));
const unrelated=await save(null,spoolData('Brown mounted',otherMaterial));
const observed=async spool=>row('SELECT estimated_remaining_grams,needs_weighing FROM filament_spools WHERE id=$1',[spool]);

const unreserved=await createJob();
await complete(unreserved,200);
assert.deepEqual(await observed(mounted),{estimated_remaining_grams:'1000.000',needs_weighing:true});
assert.equal((await observed(stored)).needs_weighing,true);
assert.equal((await observed(unrelated)).needs_weighing,false);
assert.equal(Number(await scalar('SELECT current_stock FROM inventory_items WHERE id=$1',[material])),1.8);
assert.equal(await scalar("SELECT count(*)::int FROM filament_spool_events WHERE event_type='consumption_pending' AND after_data->>'job_id'=$1 AND after_data->>'spool_identified'='false'",[unreserved]),2);
await scalar("SELECT transition_job($1,'completed',200,60,0,NULL,NULL,NULL,0,0,0)",[unreserved]);
assert.equal(await scalar('SELECT count(*)::int FROM inventory_movements WHERE reference_id=$1',[unreserved]),1);
assert.equal(await scalar("SELECT count(*)::int FROM filament_spool_events WHERE event_type='consumption_pending' AND after_data->>'job_id'=$1",[unreserved]),2);
console.log('PASS unreserved debit marks candidate spools uncertain without guessing mass or double posting');

await save(mounted,spoolData('Red mounted')); await save(stored,spoolData('Red storage',material,'storage'));
const materialOnly=await createJob(); await reserve(materialOnly,null); await complete(materialOnly,100);
assert.equal((await observed(mounted)).needs_weighing,true);
assert.equal((await observed(stored)).needs_weighing,true);
assert.equal(await scalar('SELECT status FROM filament_reservations WHERE job_id=$1',[materialOnly]),'consumed');
console.log('PASS material-only reservations close while preserving uncertainty about physical origin');

await save(mounted,spoolData('Red mounted')); await save(stored,spoolData('Red storage',material,'storage'));
const identified=await createJob(); await reserve(identified,mounted); await complete(identified,100);
assert.equal((await observed(mounted)).needs_weighing,true);
assert.equal((await observed(stored)).needs_weighing,false);
assert.equal((await observed(unrelated)).needs_weighing,false);
assert.equal(await scalar("SELECT count(*)::int FROM filament_spool_events WHERE event_type='consumption_pending' AND after_data->>'job_id'=$1 AND after_data->>'spool_identified'='true'",[identified]),1);
assert.equal(Number(await scalar('SELECT current_stock FROM inventory_items WHERE id=$1',[material])),1.6);
assert.equal(await scalar('SELECT count(*)::int FROM inventory_movements WHERE item_id=$1',[material]),3);
assert.equal(await scalar("SELECT has_function_privilege('authenticated','erp_private.finish_filament_reservations()','EXECUTE')"),false);
console.log('PASS identified reservations retain their spool trace and a single aggregate debit');

// Exercise the real Bambu transaction: its ledger reference is a task, not a job.
await save(mounted,spoolData('Red mounted')); await save(stored,spoolData('Red storage',material,'storage'));
const connection=id(40),device=id(41),task=id(42);
await db.exec('RESET ROLE');
await db.query('INSERT INTO bambu_connections(id,tenant_id) VALUES($1,$2)',[connection,tenant]);
await db.query("INSERT INTO bambu_devices(id,tenant_id,connection_id,printer_id,dev_id,name) VALUES($1,$2,$3,$4,'CONFIDENCE-QA','A1')",[device,tenant,connection,printer]);
const raw={id:task,modelId:'confidence',profileId:100,plateIndex:1,status:2,weight:100,costTime:9000,startTime:'2026-10-10T08:00:00Z',endTime:'2026-10-10T08:02:20Z',amsDetailMapping:[{amsId:0,slotId:0,weight:100}]};
await db.query('INSERT INTO bambu_tasks(id,tenant_id,bambu_device_id,bambu_task_id,status,weight_grams,cost_time_seconds,start_time,end_time,raw_data) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)',[task,tenant,device,task,'2',100,9000,raw.startTime,raw.endTime,JSON.stringify(raw)]);
await db.exec('SET ROLE authenticated');
const product=await scalar("SELECT save_product_with_photos(NULL,$1::jsonb,'[]'::jsonb,$2)",[JSON.stringify({name:'Bambu confidence',category:'printed_part',material_id:material,prints_per_plate:1,est_grams:100,est_time_minutes:120,cost_estimate:10,sale_price:20}),request()]);
const bambuJob=(await scalar('SELECT create_jobs($1::jsonb,$2)',[JSON.stringify([{name:'Bambu physical confidence',product_id:product,material_id:material,printer_id:printer,status:'queued',est_grams:100}]),request()]))[0];
const preview=await scalar('SELECT bambu_production_preview($1)',[task]);
const mapping=preview.filaments.map(f=>({source_key:f.source_key,item_id:material}));
await scalar("SELECT configure_bambu_production($1,$2,1,$3::jsonb,false,true,0,0,0,$4::jsonb,NULL)",[task,product,JSON.stringify(mapping),JSON.stringify([{job_id:bambuJob,quantity:1}])]);
const key=request();
const account=()=>scalar('SELECT account_bambu_production($1,NULL,NULL,NULL,NULL,NULL,NULL,NULL,$2)',[task,key]);
assert.equal((await account()).state,'posted'); assert.equal((await account()).state,'posted');
assert.equal((await observed(mounted)).needs_weighing,true);
assert.equal((await observed(stored)).needs_weighing,true);
assert.equal((await observed(unrelated)).needs_weighing,false);
assert.equal(await scalar("SELECT count(*)::int FROM inventory_movements WHERE reference_type='bambu_task' AND reference_id=$1",[task]),1);
assert.equal(Number(await scalar('SELECT current_stock FROM inventory_items WHERE id=$1',[material])),1.5);
console.log('PASS Bambu actual material usage marks unassigned spools while keeping task accounting idempotent');
await db.close();
console.log('Filament planning confidence: 4 focal PostgreSQL contracts passed.');
