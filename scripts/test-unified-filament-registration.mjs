import { PGlite } from '@electric-sql/pglite';
import { readdir, readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

// An isolated PostgreSQL instance only: no production credentials or requests.
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
for (const name of (await readdir(new URL('../supabase/migrations/', import.meta.url))).filter(n => n.endsWith('.sql')).sort()) {
 const sql = (await readFile(new URL('../supabase/migrations/' + name, import.meta.url), 'utf8')).replace(/CREATE EXTENSION IF NOT EXISTS (pg_cron|pg_net);/g, '');
 try { await db.exec(sql); } catch (error) { throw new Error(`Migration ${name}: ${error.message}`, { cause: error }); }
}
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const user=id(1), otherUser=id(2), viewer=id(3), operator=id(4), tenant=id(10), otherTenant=id(11);
const gramsItem=id(20), kgItem=id(21), foreignItem=id(22), nonFilament=id(23), inactive=id(24), printer=id(30), foreignPrinter=id(31), vendor=id(40);
await db.query(`INSERT INTO auth.users VALUES($1,'owner@example.test'),($2,'other@example.test'),($3,'viewer@example.test'),($4,'operator@example.test')`,[user,otherUser,viewer,operator]);
await db.query(`INSERT INTO tenants(id,name,slug) VALUES($1,'Unified filament test','unified-filament-test'),($2,'Other','unified-other')`,[tenant,otherTenant]);
await db.query(`INSERT INTO profiles(user_id,tenant_id,display_name) VALUES($1,$5,'Owner'),($2,$6,'Other'),($3,$5,'Viewer'),($4,$5,'Operator')`,[user,otherUser,viewer,operator,tenant,otherTenant]);
await db.query(`INSERT INTO user_roles(user_id,tenant_id,role) VALUES($1,$5,'owner'),($2,$6,'owner'),($3,$5,'viewer'),($4,$5,'operator')`,[user,otherUser,viewer,operator,tenant,otherTenant]);
await db.query(`INSERT INTO inventory_items(id,tenant_id,name,category,unit,current_stock,avg_cost,loss_coefficient) VALUES
 ($1,$6,'PLA Black g','filament','g',1000,0.1,0),($2,$6,'PLA Black kg','filament','kg',2,100,0),
 ($3,$7,'Foreign','filament','g',1000,0.1,0),($4,$6,'Carton','consumable','un',10,1,0),($5,$6,'Archived','filament','g',10,0.1,0)`,
 [gramsItem,kgItem,foreignItem,nonFilament,inactive,tenant,otherTenant]);
await db.query('UPDATE inventory_items SET is_active=false WHERE id=$1',[inactive]);
await db.query(`INSERT INTO printers(id,tenant_id,name,model,status) VALUES($1,$3,'Printer','A1','idle'),($2,$4,'Foreign printer','A1','idle')`,[printer,foreignPrinter,tenant,otherTenant]);
await db.query("INSERT INTO vendors(id,tenant_id,name) VALUES($1,$2,'Foreign supplier')",[vendor,otherTenant]);
await db.exec('SET ROLE authenticated');
const scalar=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0];
const row=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
const login=who=>db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[who]);
const owner=async fn=>{await db.exec('RESET ROLE');try{return await fn();}finally{await db.exec('SET ROLE authenticated');}};
let sequence=1000;const request=()=>id(sequence++);
const material=(changes={})=>({material_code:'PLA',color:'Branco',color_hex:'#FFFFFF',brand:'Bambu Lab',diameter:1.75,...changes});
const spool=(changes={})=>({label:'',tare_grams:200,initial_net_grams:1000,weight_source:'manual_weighing',measured_gross_grams:1100,
 location_kind:'storage',location_label:'Prateleira A',printer_id:null,ams_unit:null,ams_slot:null,is_active:true,...changes});
const register=(item=null,mat=material(),physical=spool(),mode='add_to_stock',cost=100,key=request())=>scalar(
 'SELECT register_filament_spool($1,$2::jsonb,$3::jsonb,$4,$5,$6)',[item,JSON.stringify(mat),JSON.stringify(physical),mode,cost,key]);
const counts=()=>row(`SELECT (SELECT count(*)::int FROM inventory_items) AS items,(SELECT count(*)::int FROM filament_spools) AS spools,
 (SELECT count(*)::int FROM inventory_movements) AS movements,(SELECT count(*)::int FROM filament_spool_events) AS events`);
let passed=0;const failures=[];
async function test(name,fn){await login(user);try{await fn();passed++;console.log('PASS '+name);}catch(error){failures.push({name,error});console.error('FAIL '+name+': '+error.message+(error.where?' — '+error.where:''));}}
let first,firstKey,firstMaterial,firstSpool;

await test('New filament, color and 900 net grams register together without a separate group or duplicate ledger entry',async()=>{
 const before=await counts();firstKey=request();firstMaterial=material();firstSpool=spool();
 first=await register(null,firstMaterial,firstSpool,'add_to_stock',100,firstKey);
 assert.deepEqual({created:first.item_created,grams:Number(first.net_grams),before:Number(first.stock_before),after:Number(first.stock_after),unit:first.stock_unit},
  {created:true,grams:900,before:0,after:900,unit:'g'});
 const item=await row('SELECT name,category,unit,current_stock,avg_cost,brand,color,color_code,parent_id,material_identified_at FROM inventory_items WHERE id=$1',[first.item_id]);
 assert.equal(item.name,'PLA Branco Bambu Lab');assert.equal(item.category,'filament');assert.equal(item.unit,'g');assert.equal(item.brand,'Bambu Lab');assert.equal(item.color,'Branco');
 assert.equal(item.color_code,'#FFFFFF');assert.equal(item.parent_id,null);assert.ok(item.material_identified_at);assert.equal(Number(item.avg_cost),0.1);
 const physical=await row('SELECT label,initial_net_grams,estimated_remaining_grams FROM filament_spools WHERE id=$1',[first.spool_id]);
 assert.equal(physical.label,'PLA Branco Bambu Lab · bobina 1');assert.equal(Number(physical.initial_net_grams),1000);assert.equal(Number(physical.estimated_remaining_grams),900);
 const movement=await row('SELECT movement_type,quantity,unit_cost,total_cost,reference_type,reference_id FROM inventory_movements WHERE item_id=$1',[first.item_id]);
 assert.equal(movement.movement_type,'purchase_in');assert.equal(Number(movement.quantity),900);assert.equal(Number(movement.unit_cost),0.1);assert.equal(Number(movement.total_cost),90);
 assert.equal(movement.reference_type,'filament_registration');assert.equal(movement.reference_id,first.spool_id);
 const after=await counts();assert.equal(after.items,before.items+1);assert.equal(after.spools,before.spools+1);assert.equal(after.movements,before.movements+1);assert.equal(after.events,before.events+1);
 assert.deepEqual(await register(null,firstMaterial,firstSpool,'add_to_stock',100,firstKey),first);assert.deepEqual(await counts(),after);
});
await test('Existing-stock association leaves quantity, acquisition cost and material metadata unchanged',async()=>{
 const before=await row('SELECT to_jsonb(i) AS item FROM inventory_items i WHERE id=$1',[gramsItem]);const ledger=await scalar('SELECT count(*)::int FROM inventory_movements');
 const r=await register(gramsItem,{},spool(),'already_in_stock',null);
 assert.equal(r.item_created,false);assert.equal(Number(r.stock_before),1000);assert.equal(Number(r.stock_after),1000);
 assert.deepEqual(await row('SELECT to_jsonb(i) AS item FROM inventory_items i WHERE id=$1',[gramsItem]),before);
 assert.equal(await scalar('SELECT count(*)::int FROM inventory_movements'),ledger);
});
await test('An existing gram item receives exactly its net mass and updates the weighted acquisition cost',async()=>{
 const r=await register(gramsItem,{},spool(),'add_to_stock',200);
 assert.equal(Number(r.stock_before),1000);assert.equal(Number(r.stock_after),1900);
 const movement=await row("SELECT quantity,unit_cost FROM inventory_movements WHERE reference_type='filament_registration' AND reference_id=$1",[r.spool_id]);
 assert.equal(Number(movement.quantity),900);assert.equal(Number(movement.unit_cost),0.2);
 assert.ok(Math.abs(Number(await scalar('SELECT avg_cost FROM inventory_items WHERE id=$1',[gramsItem]))-(100+180)/1900)<1e-8);
});
await test('An existing kilogram item converts net grams once and keeps acquisition rates in R$/kg',async()=>{
 const r=await register(kgItem,{},spool(),'add_to_stock',200);
 assert.equal(r.stock_unit,'kg');assert.equal(Number(r.stock_before),2);assert.equal(Number(r.stock_after),2.9);
 const movement=await row('SELECT quantity,unit_cost,total_cost FROM inventory_movements WHERE reference_id=$1',[r.spool_id]);
 assert.equal(Number(movement.quantity),0.9);assert.equal(Number(movement.unit_cost),200);assert.equal(Number(movement.total_cost),180);
 assert.ok(Math.abs(Number(await scalar('SELECT avg_cost FROM inventory_items WHERE id=$1',[kgItem]))-(200+180)/2.9)<1e-8);
});
await test('A retry returns the original JSON receipt even after later spool entries change the item balance',async()=>{
 await register(first.item_id,{},spool(),'add_to_stock',100);
 assert.equal(Number(await scalar('SELECT current_stock FROM inventory_items WHERE id=$1',[first.item_id])),1800);
 const before=await counts();assert.deepEqual(await register(null,firstMaterial,firstSpool,'add_to_stock',100,firstKey),first);assert.deepEqual(await counts(),before);
 await assert.rejects(register(null,firstMaterial,spool({measured_gross_grams:1000}),'add_to_stock',100,firstKey),/outra operação/);
});
await test('Explicit zero acquisition cost is allowed; blank, negative and nonfinite costs never create partial records',async()=>{
 let before=await counts();await assert.rejects(register(null,material(),spool(),'add_to_stock',null),/explicitamente/);assert.deepEqual(await counts(),before);
 await assert.rejects(register(gramsItem,{},spool(),'add_to_stock',-1),/explicitamente/);assert.deepEqual(await counts(),before);
 await assert.rejects(register(gramsItem,{},spool(),'add_to_stock','NaN'),/explicitamente/);assert.deepEqual(await counts(),before);
 const r=await register(null,material({name:'Free confirmed PLA'}),spool(),'add_to_stock',0);
 assert.equal(Number(await scalar('SELECT avg_cost FROM inventory_items WHERE id=$1',[r.item_id])),0);
 assert.equal(Number(await scalar('SELECT unit_cost FROM inventory_movements WHERE reference_id=$1',[r.spool_id])),0);
});
await test('Manual estimates use remaining material, not initial capacity; generated labels are stable and advance',async()=>{
 const physical=spool({weight_source:'manual_estimate',estimated_remaining_grams:725,measured_gross_grams:null});
 const key=request();const r=await register(gramsItem,{},physical,'already_in_stock',null,key);
 assert.equal(Number(r.net_grams),725);assert.equal(Number(r.stock_after),1900);
 const label=await scalar('SELECT label FROM filament_spools WHERE id=$1',[r.spool_id]);assert.match(label,/PLA Black g · bobina \d+$/);
 assert.deepEqual(await register(gramsItem,{},physical,'already_in_stock',null,key),r);
 const next=await register(gramsItem,{},physical,'already_in_stock',null);assert.notEqual(await scalar('SELECT label FROM filament_spools WHERE id=$1',[next.spool_id]),label);
});
await test('A manually supplied label is preserved; duplicate labels and occupied AMS slots roll back material and ledger writes',async()=>{
 const occupied=await register(gramsItem,{},spool({label:'Carretel azul',location_kind:'ams',printer_id:printer,ams_unit:1,ams_slot:1}),'already_in_stock',null);
 assert.equal(await scalar('SELECT label FROM filament_spools WHERE id=$1',[occupied.spool_id]),'Carretel azul');
 const before=await counts();
 await assert.rejects(register(null,material({name:'Rollback duplicate label'}),spool({label:'Carretel azul'})),/filament_spool_label/);assert.deepEqual(await counts(),before);
 await assert.rejects(register(null,material({name:'Rollback AMS'}),spool({label:'Another spool',location_kind:'ams',printer_id:printer,ams_unit:1,ams_slot:1})),/filament_spool_ams_position/);assert.deepEqual(await counts(),before);
 await assert.rejects(register(null,material(),spool({location_kind:'ams',printer_id:printer,ams_unit:1,ams_slot:5})),/check constraint/);assert.deepEqual(await counts(),before);
});
await test('Foreign items, printers, groups and suppliers are rejected before any partial registration survives',async()=>{
 const before=await counts();
 await assert.rejects(register(foreignItem,{},spool(),'already_in_stock',null),/filamento ativo/);
 await assert.rejects(register(null,material(),spool({location_kind:'printer',printer_id:foreignPrinter})),/outra empresa/);
 await assert.rejects(register(null,material({parent_id:foreignItem})),/outra empresa/);
 await assert.rejects(register(null,material({vendor_id:vendor})),/outra empresa/);
 await assert.rejects(register(nonFilament,{},spool(),'already_in_stock',null),/filamento ativo/);
 await assert.rejects(register(inactive,{},spool(),'already_in_stock',null),/filamento ativo/);
 assert.deepEqual(await counts(),before);
});
await test('Malformed payloads cannot change an existing material or smuggle stock quantities and foreign item identifiers',async()=>{
 const before=await counts();
 await assert.rejects(register(gramsItem,material(),spool(),'already_in_stock',null),/sem alterar/);
 await assert.rejects(register(null,material({current_stock:50000})),/Campo do filamento/);
 await assert.rejects(register(null,material(),spool({item_id:foreignItem})),/Campo da bobina/);
 await assert.rejects(register(null,material(),spool(),'already_in_stock',null),/primeira bobina/);
 await assert.rejects(register(null,material(),spool({measured_gross_grams:100})),/peso bruto/);
 await assert.rejects(register(null,material(),spool({measured_gross_grams:1300})),/capacidade/);
 await assert.rejects(register(null,material(),spool({measured_gross_grams:1100.0001})),/três casas/);
 await assert.rejects(register(null,{name:true},spool()),/Confira os textos/);
 await assert.rejects(register(null,material(),null),/dados do filamento/);
 assert.deepEqual(await counts(),before);
});
await test('Write permission and private receipts are protected, while an operator can register production materials',async()=>{
 const signature='register_filament_spool(uuid,jsonb,jsonb,text,numeric,uuid)';
 assert.equal(await scalar("SELECT has_function_privilege('anon',$1,'EXECUTE')",[signature]),false);
 assert.equal(await scalar("SELECT has_function_privilege('authenticated',$1,'EXECUTE')",[signature]),true);
 for(const privilege of ['SELECT','INSERT','UPDATE','DELETE']) assert.equal(await scalar("SELECT has_table_privilege('authenticated','erp_private.filament_registration_receipts',$1)",[privilege]),false);
 await login(viewer);await assert.rejects(register(gramsItem,{},spool(),'already_in_stock',null),/permissão/);
 await login(otherUser);await assert.rejects(register(gramsItem,{},spool(),'already_in_stock',null),/filamento ativo/);
 await login(operator);const r=await register(gramsItem,{},spool(),'already_in_stock',null);assert.equal(r.item_created,false);
});
await test('Stock and spool differences remain a warning rather than an artificial registration block',async()=>{
 const r=await register(gramsItem,{},spool({initial_net_grams:5000,measured_gross_grams:5200}),'already_in_stock',null);
 assert.equal(Number(r.net_grams),5000);assert.equal(Number(r.stock_after),1900);
});
await test('The unified transaction locks printer before inventory and delegates physical creation without changing old physical-only RPCs',async()=>{
 const definition=await scalar("SELECT pg_get_functiondef('register_filament_spool(uuid,jsonb,jsonb,text,numeric,uuid)'::regprocedure)");
 const printerLock=definition.indexOf('PERFORM 1 FROM printers WHERE');
 const labelLock=definition.indexOf("pg_advisory_xact_lock(hashtextextended('filament-auto-label-'||t::text,0))");
 const saveItem=definition.indexOf('public.save_inventory_catalog(');const inventoryLock=definition.indexOf('SELECT * INTO item FROM inventory_items');const saveSpool=definition.indexOf('public.save_filament_spool(');
 // PGlite uses one session. This verifies the lock contract without claiming
 // that the test simulates independently racing PostgreSQL connections.
 assert.ok(printerLock>0&&labelLock>printerLock&&saveItem>labelLock&&inventoryLock>saveItem&&saveSpool>inventoryLock);
 const before=await scalar('SELECT count(*)::int FROM inventory_movements');
 const data=spool({item_id:gramsItem,label:'Legacy physical-only'});delete data.reason;
 await scalar('SELECT save_filament_spool(NULL,$1::jsonb,$2,$3)',[JSON.stringify(data),'Existing operation',request()]);
 assert.equal(await scalar('SELECT count(*)::int FROM inventory_movements'),before);
});
await test('Automatic labels span different material rows with the same name and failed registrations leave no request or receipt',async()=>{
 const name='Same readable PLA';const first=await register(null,material({name}),spool());
 const second=await register(null,material({name}),spool());
 assert.notEqual(first.item_id,second.item_id);
 assert.equal(await scalar('SELECT label FROM filament_spools WHERE id=$1',[first.spool_id]),name+' · bobina 1');
 assert.equal(await scalar('SELECT label FROM filament_spools WHERE id=$1',[second.spool_id]),name+' · bobina 2');
 const key=request();const before=await counts();
 const occupied=spool({location_kind:'ams',printer_id:printer,ams_unit:1,ams_slot:1});
 await assert.rejects(register(null,material({name}),occupied,'add_to_stock',100,key),/filament_spool_ams_position/);
 assert.deepEqual(await counts(),before);
 assert.equal(await owner(()=>scalar('SELECT count(*)::int FROM erp_private.requests WHERE tenant_id=$1 AND request_id=$2',[tenant,key])),0);
 assert.equal(await owner(()=>scalar('SELECT count(*)::int FROM erp_private.filament_registration_receipts WHERE tenant_id=$1 AND request_id=$2',[tenant,key])),0);
 // The transaction-scoped lock was released with the failed statement; the
 // same operation identity can retry after the operator changes the position.
 const retried=await register(null,material({name}),spool(),'add_to_stock',100,key);
 assert.equal(await scalar('SELECT label FROM filament_spools WHERE id=$1',[retried.spool_id]),name+' · bobina 3');
});
await db.close();
if(failures.length)throw new Error(`${failures.length} unified filament cases failed`);
console.log(`Validated ${passed} unified filament registration scenarios.`);
