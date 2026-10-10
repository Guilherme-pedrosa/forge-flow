import { PGlite } from '@electric-sql/pglite';
import { readdir, readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

// Isolated PostgreSQL only. No production connection or operational seed data.
const db = new PGlite();
await db.exec(`CREATE ROLE authenticated; CREATE ROLE anon; CREATE ROLE service_role;
 CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY,email text);
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 CREATE SCHEMA storage; CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean);
 CREATE TABLE storage.objects(id uuid DEFAULT gen_random_uuid(),bucket_id text,name text,owner uuid);
 CREATE FUNCTION storage.foldername(text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$ SELECT string_to_array($1,'/') $$;
 ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;CREATE PUBLICATION supabase_realtime;
 GRANT USAGE ON SCHEMA public,auth,storage TO authenticated,anon;
 ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO authenticated;`);
for (const name of (await readdir(new URL('../supabase/migrations/', import.meta.url))).filter(n => n.endsWith('.sql')).sort()) {
 const sql = (await readFile(new URL('../supabase/migrations/' + name, import.meta.url), 'utf8')).replace(/CREATE EXTENSION IF NOT EXISTS (pg_cron|pg_net);/g, '');
 try { await db.exec(sql); } catch (error) { throw new Error(`Migration ${name}: ${error.message}`, { cause: error }); }
}
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const user=id(1),otherUser=id(2),viewer=id(3),operator=id(4),tenant=id(10),otherTenant=id(11),material=id(20),otherMaterial=id(21),printer=id(30),otherPrinter=id(31);
await db.query(`INSERT INTO auth.users VALUES($1,'owner@example.test'),($2,'other@example.test'),($3,'viewer@example.test'),($4,'operator@example.test')`,[user,otherUser,viewer,operator]);
await db.query(`INSERT INTO tenants(id,name,slug,settings) VALUES($1,'Filament test','filament-test','{"energy_cost_kwh":1}'),($2,'Other test','other-filament-test','{}')`,[tenant,otherTenant]);
await db.query(`INSERT INTO profiles(user_id,tenant_id,display_name) VALUES($1,$5,'Owner'),($2,$6,'Other'),($3,$5,'Viewer'),($4,$5,'Operator')`,[user,otherUser,viewer,operator,tenant,otherTenant]);
await db.query(`INSERT INTO user_roles(user_id,tenant_id,role) VALUES($1,$5,'owner'),($2,$6,'owner'),($3,$5,'viewer'),($4,$5,'operator')`,[user,otherUser,viewer,operator,tenant,otherTenant]);
await db.query(`INSERT INTO inventory_items(id,tenant_id,name,category,unit,current_stock,avg_cost,loss_coefficient) VALUES($1,$3,'PLA white','filament','kg',2,100,0),($2,$4,'Other PLA','filament','g',1000,0.1,0)`,[material,otherMaterial,tenant,otherTenant]);
await db.query(`INSERT INTO printers(id,tenant_id,name,model,status,power_watts,depreciation_per_hour,maintenance_cost_per_hour) VALUES($1,$3,'Printer','A1','idle',200,2,1),($2,$4,'Other printer','A1','idle',200,2,1)`,[printer,otherPrinter,tenant,otherTenant]);
await db.exec('SET ROLE authenticated');
const scalar=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0];
const row=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
let sequence=1000;const request=()=>id(sequence++);
const login=who=>db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[who]);
const owner=async fn=>{await db.exec('RESET ROLE');try{return await fn();}finally{await db.exec('SET ROLE authenticated');}};
const errors=[];let passed=0;
async function test(name,fn){await login(user);try{await fn();passed++;console.log('PASS '+name);}catch(error){errors.push({name,error});console.error('FAIL '+name+': '+error.message+(error.where?' — '+error.where:''));}}
const spoolData=(label='Bobina 1',changes={})=>({item_id:material,label,tare_grams:200,initial_net_grams:1000,weight_source:'manual_weighing',measured_gross_grams:1200,location_kind:'storage',location_label:'Depósito',printer_id:null,ams_unit:null,ams_slot:null,is_active:true,...changes});
const save=(spool,data,key=request())=>scalar('SELECT save_filament_spool($1,$2::jsonb,$3,$4)',[spool,JSON.stringify(data),'Conferência física',key]);
const move=(spool,location,key=request())=>scalar('SELECT move_filament_spool($1,$2::jsonb,$3,$4)',[spool,JSON.stringify(location),'Carga da impressora',key]);
const createJob=async(name='Print',grams=600)=> (await scalar('SELECT create_jobs($1::jsonb,$2)',[JSON.stringify([{name,status:'queued',material_id:material,printer_id:printer,est_grams:grams}]),request()]))[0];
const reserve=(job,spool,grams,key=request())=>scalar('SELECT reserve_job_filament($1,$2,$3,$4,$5,$6)',[job,material,spool,grams,'Peso estimado da placa',key]);
let spool,job,reservation;
await test('Spool registration weighs net mass and retries without material entry or duplicate history',async()=>{
 const payload=spoolData();const key=request();spool=await save(null,payload,key);assert.equal(await save(null,payload,key),spool);
 assert.deepEqual(await row('SELECT estimated_remaining_grams,weight_source FROM filament_spools WHERE id=$1',[spool]),{estimated_remaining_grams:'1000.000',weight_source:'manual_weighing'});
 assert.equal(await scalar('SELECT count(*)::int FROM filament_spool_events WHERE spool_id=$1',[spool]),1);
 assert.equal(Number(await scalar('SELECT current_stock FROM inventory_items WHERE id=$1',[material])),2);
 assert.equal(await scalar('SELECT count(*)::int FROM inventory_movements WHERE item_id=$1',[material]),0);
 await assert.rejects(save(null,spoolData('Changed'),key),/outra operação/);
});
await test('Position changes preserve stock and weight, validate tenant and exclusive AMS slots',async()=>{
 const position={location_kind:'ams',location_label:'AMS',printer_id:printer,ams_unit:1,ams_slot:1};const key=request();
 assert.equal(await move(spool,position,key),spool);assert.equal(await move(spool,position,key),spool);
 assert.equal(Number(await scalar('SELECT current_stock FROM inventory_items WHERE id=$1',[material])),2);
 assert.equal(Number(await scalar('SELECT estimated_remaining_grams FROM filament_spools WHERE id=$1',[spool])),1000);
 const second=await save(null,spoolData('Bobina 2'));
 await assert.rejects(move(second,position),/filament_spool_ams_position/);
 await assert.rejects(move(second,{...position,printer_id:otherPrinter,ams_slot:2}),/outra empresa/);
 await assert.rejects(move(second,{...position,ams_slot:null}),/check constraint/);
});
await test('Null and malformed RPC payloads cannot mutate spool weights or reservations',async()=>{
 await assert.rejects(scalar('SELECT save_filament_spool(NULL,NULL,$1,$2)',['Peso',request()]),/Informe os dados/);
 await assert.rejects(scalar('SELECT save_filament_spool(NULL,$1::jsonb,$2,$3)',['[]','Peso',request()]),/Informe os dados/);
 await assert.rejects(scalar('SELECT move_filament_spool($1,NULL,$2,$3)',[spool,'Mover',request()]),/Informe posição/);
 await assert.rejects(scalar('SELECT reserve_job_filament(NULL,NULL,NULL,NULL,NULL,$1)',[request()]),/impressão/);
 assert.equal(Number(await scalar('SELECT current_stock FROM inventory_items WHERE id=$1',[material])),2);
});
await test('Reservations atomically protect aggregate grams and spool grams without posting consumption',async()=>{
 job=await createJob();const key=request();reservation=await reserve(job,spool,600,key);
 assert.equal(await reserve(job,spool,600,key),reservation);
 assert.equal(await scalar('SELECT count(*)::int FROM filament_active_reservations'),1);
 const second=await createJob('Second');await assert.rejects(reserve(second,null,1500),/livre insuficiente/);
 await assert.rejects(reserve(second,spool,500),/bobina não possui/);
 await assert.rejects(reserve(job,spool,601,key),/outra operação/);
 assert.equal(Number(await scalar('SELECT current_stock FROM inventory_items WHERE id=$1',[material])),2);
 assert.equal(await scalar('SELECT count(*)::int FROM inventory_movements WHERE item_id=$1',[material]),0);
 await assert.rejects(save(spool,spoolData('Bobina 1',{measured_gross_grams:700})),/menor que o reservado/);
 await assert.rejects(save(spool,spoolData('Bobina 1',{is_active:false})),/Libere as reservas/);
 await assert.rejects(scalar('SELECT post_inventory_movement($1::jsonb,$2)',[JSON.stringify({item_id:material,movement_type:'adjustment',quantity:-1.5,notes:'Conferência'}),request()]),/reservado para outra impressão/);
 assert.equal(Number(await scalar('SELECT current_stock FROM inventory_items WHERE id=$1',[material])),2);
});
await test('Authorized weight and tare corrections retain previous values in immutable history',async()=>{
 const key=request();await save(spool,spoolData('Bobina 1',{measured_gross_grams:1000}),key);
 assert.equal(await save(spool,spoolData('Bobina 1',{measured_gross_grams:1000}),key),spool);
 assert.equal(Number(await scalar('SELECT estimated_remaining_grams FROM filament_spools WHERE id=$1',[spool])),800);
 const correction=request();await save(spool,spoolData('Bobina 1',{tare_grams:100,initial_net_grams:1100,measured_gross_grams:900}),correction);
 assert.equal(Number(await scalar('SELECT tare_grams FROM filament_spools WHERE id=$1',[spool])),100);
 assert.equal(Number(await scalar("SELECT (before_data->>'tare_grams')::numeric FROM filament_spool_events WHERE request_id=$1",[correction])),200);
 assert.equal(Number(await scalar("SELECT (after_data->>'initial_net_grams')::numeric FROM filament_spool_events WHERE request_id=$1",[correction])),1100);
 await assert.rejects(save(null,spoolData('Bad',{measured_gross_grams:100})),/Peso restante inválido/);
 await assert.rejects(save(null,spoolData('Bad',{initial_net_grams:'NaN'})),/inválidos/);
 assert.equal(Number(await scalar('SELECT current_stock FROM inventory_items WHERE id=$1',[material])),2);
});
await test('Completion uses existing consumption once, closes reservation and asks for physical weighing',async()=>{
 await scalar("SELECT transition_job($1,'printing')",[job]);
 const complete="SELECT transition_job($1,'completed',500,60,0,NULL,NULL,NULL,0,0,0)";
 await scalar(complete,[job]);await scalar(complete,[job]);
 assert.equal(Number(await scalar('SELECT current_stock FROM inventory_items WHERE id=$1',[material])),1.5);
 assert.equal(await scalar('SELECT count(*)::int FROM inventory_movements WHERE reference_id=$1',[job]),1);
 assert.equal(await scalar('SELECT status FROM filament_reservations WHERE id=$1',[reservation]),'consumed');
 assert.equal(await scalar('SELECT count(*)::int FROM filament_active_reservations WHERE job_id=$1',[job]),0);
 assert.equal(await scalar('SELECT needs_weighing FROM filament_spools WHERE id=$1',[spool]),true);
 assert.equal(Number(await scalar('SELECT estimated_remaining_grams FROM filament_spools WHERE id=$1',[spool])),800);
 const next=await createJob('Next');await assert.rejects(reserve(next,spool,100),/saldo conferido/);
 await save(spool,spoolData('Bobina 1',{measured_gross_grams:500}));assert.equal(await scalar('SELECT needs_weighing FROM filament_spools WHERE id=$1',[spool]),false);
 const r=await reserve(next,spool,100);const key=request();const sql='SELECT release_job_filament($1,$2,$3)';
 assert.equal(await scalar(sql,[r,'Planejamento alterado',key]),r);assert.equal(await scalar(sql,[r,'Planejamento alterado',key]),r);
 assert.equal(await scalar('SELECT status FROM filament_reservations WHERE id=$1',[r]),'released');
});
await test('RLS, actor checks and revoked writes protect company scope and read-only users',async()=>{
 for(const table of ['filament_spools','filament_spool_events','filament_reservations','filament_replenishment_policies']){
  assert.equal(await scalar("SELECT has_table_privilege('authenticated',$1,'SELECT')",[table]),true);
  for(const privilege of ['INSERT','UPDATE','DELETE']) assert.equal(await scalar("SELECT has_table_privilege('authenticated',$1,$2)",[table,privilege]),false);
 }
 for(const signature of ['save_filament_spool(uuid,jsonb,text,uuid)','move_filament_spool(uuid,jsonb,text,uuid)','reserve_job_filament(uuid,uuid,uuid,numeric,text,uuid)','release_job_filament(uuid,text,uuid)','save_filament_replenishment_policy(uuid,uuid,numeric,integer,numeric,uuid)']){
  assert.equal(await scalar("SELECT has_function_privilege('authenticated',$1,'EXECUTE')",[signature]),true);
  assert.equal(await scalar("SELECT has_function_privilege('anon',$1,'EXECUTE')",[signature]),false);
 }
 for(const signature of ['erp_private.guard_reserved_filament()','erp_private.finish_filament_reservations()']) assert.equal(await scalar("SELECT has_function_privilege('authenticated',$1,'EXECUTE')",[signature]),false);
 await login(viewer);assert.equal(await scalar('SELECT count(*)::int FROM filament_spools'),2);
 await assert.rejects(save(null,spoolData('Viewer')),/permissão/);
 await assert.rejects(db.query('UPDATE filament_spools SET estimated_remaining_grams=999 WHERE id=$1',[spool]),/permission denied/);
 await login(otherUser);assert.equal(await scalar('SELECT count(*)::int FROM filament_spools'),0);
 await assert.rejects(save(spool,spoolData('Foreign')),/filamento ativo|Bobina não encontrada/);
});
await test('Purchase policies require financial role, validate references and remain free of purchases/payables',async()=>{
 const call='SELECT save_filament_replenishment_policy($1,$2,$3,$4,$5,$6)';const key=request();const args=[material,null,0.5,3,200,key];
 assert.equal(await scalar(call,args),material);assert.equal(await scalar(call,args),material);
 await assert.rejects(scalar(call,[material,null,0,3,0,request()]),/válidos/);
 await assert.rejects(scalar(call,[otherMaterial,null,1,3,0,request()]),/Selecione/);
 await login(operator);await assert.rejects(scalar(call,[material,null,1,3,0,request()]),/permissão/);
 await login(user);assert.equal(await scalar('SELECT count(*)::int FROM purchase_orders'),0);assert.equal(await scalar('SELECT count(*)::int FROM accounts_payable'),0);
});
await test('Bambu accounting consumes its allocated jobs reservations while protecting external reservations',async()=>{
 const bambuMaterial=id(25),bambuPrinter=id(32),connection=id(33),device=id(34),task=request();
 await owner(async()=>{
  await db.query("INSERT INTO inventory_items(id,tenant_id,name,category,unit,current_stock,avg_cost,loss_coefficient) VALUES($1,$2,'PLA Bambu reserved','filament','g',120,0.1,0)",[bambuMaterial,tenant]);
  await db.query("INSERT INTO printers(id,tenant_id,name,model,status,power_watts,depreciation_per_hour,maintenance_cost_per_hour) VALUES($1,$2,'Bambu reserved','A1','idle',200,2,1)",[bambuPrinter,tenant]);
  await db.query('INSERT INTO bambu_connections(id,tenant_id) VALUES($1,$2)',[connection,tenant]);
  await db.query("INSERT INTO bambu_devices(id,tenant_id,connection_id,printer_id,dev_id,name) VALUES($1,$2,$3,$4,'SPOOL-BAMBU-QA','Bambu reserved')",[device,tenant,connection,bambuPrinter]);
  const raw={id:task,modelId:'reserved-'+task,profileId:100,plateIndex:1,status:2,weight:100,costTime:9000,startTime:'2026-10-10T08:00:00Z',endTime:'2026-10-10T08:02:20Z',amsDetailMapping:[{amsId:0,slotId:0,weight:100}]};
  await db.query('INSERT INTO bambu_tasks(id,tenant_id,bambu_device_id,bambu_task_id,status,weight_grams,cost_time_seconds,start_time,end_time,raw_data) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)',[task,tenant,device,task,'2',100,9000,raw.startTime,raw.endTime,JSON.stringify(raw)]);
 });
 const product=await scalar("SELECT save_product_with_photos(NULL,$1::jsonb,'[]'::jsonb,$2)",[JSON.stringify({name:'Reserved Bambu product',category:'printed_part',material_id:bambuMaterial,prints_per_plate:2,est_grams:100,est_time_minutes:120,cost_estimate:10,sale_price:20}),request()]);
 const jobs=await scalar('SELECT create_jobs($1::jsonb,$2)',[JSON.stringify([1,2,3].map(n=>({name:'Bambu reservation '+n,product_id:product,material_id:bambuMaterial,printer_id:bambuPrinter,status:'queued',est_grams:n===3?20:50}))),request()]);
 const physical=await save(null,spoolData('Bambu bobina',{item_id:bambuMaterial,initial_net_grams:100,measured_gross_grams:300,location_kind:'printer',printer_id:bambuPrinter}));
 const reserveMaterial=(job,grams,spool=null)=>scalar('SELECT reserve_job_filament($1,$2,$3,$4,$5,$6)',[job,bambuMaterial,spool,grams,'Placa Bambu',request()]);
 await reserveMaterial(jobs[0],60,physical);await reserveMaterial(jobs[1],40,physical);await reserveMaterial(jobs[2],20);
 const preview=await scalar('SELECT bambu_production_preview($1)',[task]);
 const mapping=preview.filaments.map(f=>({source_key:f.source_key,item_id:bambuMaterial}));
 await scalar("SELECT configure_bambu_production($1,$2,2,$3::jsonb,false,true,0,0,0,$4::jsonb,NULL)",[task,product,JSON.stringify(mapping),JSON.stringify(jobs.slice(0,2).map(job_id=>({job_id,quantity:1})))]);
 const account=(grams,key=request())=>scalar('SELECT account_bambu_production($1,$2::jsonb,NULL,NULL,NULL,NULL,NULL,NULL,$3)',[task,grams===null?null:JSON.stringify(mapping.map(f=>({...f,grams}))),key]);
 await assert.rejects(account(105),/reservado para outra impressão/);
 assert.equal(Number(await scalar('SELECT current_stock FROM inventory_items WHERE id=$1',[bambuMaterial])),120);
 assert.equal(await scalar("SELECT count(*)::int FROM inventory_movements WHERE reference_type='bambu_task' AND reference_id=$1",[task]),0);
 assert.equal(await scalar('SELECT count(*)::int FROM filament_active_reservations WHERE item_id=$1',[bambuMaterial]),3);
 const key=request(),result=await account(null,key);assert.equal(result.state,'posted');assert.deepEqual(await account(null,key),result);
 assert.equal(Number(await scalar('SELECT current_stock FROM inventory_items WHERE id=$1',[bambuMaterial])),20);
 assert.equal(await scalar("SELECT count(*)::int FROM inventory_movements WHERE reference_type='bambu_task' AND reference_id=$1",[task]),1);
 assert.equal(await scalar("SELECT count(*)::int FROM filament_reservations WHERE job_id=ANY($1::uuid[]) AND status='consumed'",[jobs.slice(0,2)]),2);
 assert.equal(Number(await scalar('SELECT sum(grams) FROM filament_active_reservations WHERE item_id=$1',[bambuMaterial])),20);
 assert.equal(await scalar('SELECT needs_weighing FROM filament_spools WHERE id=$1',[physical]),true);
});
await test('Weighing and relocation acquire printer then inventory then spool locks with position rechecks',async()=>{
 // PGlite has one session. Assert the shared lock contract explicitly; this
 // check does not claim to simulate PostgreSQL sessions racing in production.
 for(const signature of ['save_filament_spool(uuid,jsonb,text,uuid)','move_filament_spool(uuid,jsonb,text,uuid)']){
  const definition=await scalar('SELECT pg_get_functiondef($1::regprocedure)',[signature]);
  const printerLock=definition.indexOf('PERFORM 1 FROM printers WHERE tenant_id=t');
  const inventoryLock=definition.indexOf('FROM inventory_items WHERE',printerLock);
  const spoolLock=definition.indexOf('SELECT * INTO s FROM filament_spools',inventoryLock);
  assert.ok(printerLock>0&&inventoryLock>printerLock&&spoolLock>inventoryLock,signature);
  assert.match(definition,/id IN\(machine,observed\.printer_id\) ORDER BY id FOR UPDATE/);
  assert.match(definition,/s\.printer_id IS DISTINCT FROM observed\.printer_id/);
  assert.match(definition,/s\.updated_at IS DISTINCT FROM observed\.updated_at/);
 }
});
await db.close();
if(errors.length){throw new Error(`${errors.length} of ${passed+errors.length} filament tests failed`);}
console.log(`Filament spools: ${passed} isolated PostgreSQL checks passed.`);
