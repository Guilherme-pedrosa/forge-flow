// Acceptance of the simple filament catalogue: stock and acquisition value are
// independent of physical spools. This script uses disposable PostgreSQL only.
import { PGlite } from '@electric-sql/pglite';
import { readdir, readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
process.on('uncaughtException',error=>{console.error(error.message,error.where??'');process.exit(1);});
const db=new PGlite();
await db.exec(`CREATE ROLE authenticated; CREATE ROLE anon; CREATE ROLE service_role;
 CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY,email text);
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 CREATE SCHEMA storage; CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean);
 CREATE TABLE storage.objects(id uuid DEFAULT gen_random_uuid(),bucket_id text,name text,owner uuid);
 CREATE FUNCTION storage.foldername(text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$ SELECT string_to_array($1,'/') $$;
 ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY; CREATE PUBLICATION supabase_realtime;
 GRANT USAGE ON SCHEMA public,auth,storage TO authenticated,anon;
 ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO authenticated;`);
for(const name of (await readdir(new URL('../supabase/migrations/',import.meta.url))).filter(n=>n.endsWith('.sql')).sort()) {
 try {await db.exec((await readFile(new URL('../supabase/migrations/'+name,import.meta.url),'utf8')).replace(/CREATE EXTENSION IF NOT EXISTS (pg_cron|pg_net);/g,''));}
 catch(error){throw new Error(`Migration ${name}: ${error.message} ${error.where??''}`);}
}
const id=n=>`73000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const tenant=id(1),otherTenant=id(2),owner=id(3),otherOwner=id(4),viewer=id(5);let sequence=100,passed=0;
const next=()=>id(sequence++),scalar=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0];
const rows=async(sql,args=[])=>(await db.query(sql,args)).rows;
const login=user=>db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[user]);
const save=(data,item=null,key=next())=>scalar('SELECT save_inventory_catalog($1,$2::jsonb,$3)',[item,JSON.stringify(data),key]);
const stock=item=>scalar('SELECT to_jsonb(i) FROM inventory_items i WHERE id=$1',[item]);
const ledger=item=>rows('SELECT * FROM inventory_movements WHERE item_id=$1 ORDER BY created_at,id',[item]);
const close=(actual,expected)=>assert.ok(Math.abs(Number(actual)-expected)<1e-7,`${actual} != ${expected}`);
const counts=()=>scalar("SELECT jsonb_build_object('items',(SELECT count(*) FROM inventory_items),'movements',(SELECT count(*) FROM inventory_movements),'spools',(SELECT count(*) FROM filament_spools),'events',(SELECT count(*) FROM filament_spool_events))");
const material=(changes={})=>({name:'PLA Branco '+sequence,category:'filament',unit:'g',material_code:'PLA',color:'Branco',color_code:'BRANCO',color_hex:null,brand:'Bambu Lab',avg_cost:0,current_stock:0,...changes});
const create=(changes={})=>save(material(changes));
let today;
const purchase=async(items,{shipping=0,discount=0,additional_costs=0,key=next()}={})=>{
 const subtotal=items.reduce((sum,item)=>sum+item.total,0),total=Math.round((subtotal+shipping-discount+additional_costs)*100)/100;
 const args=[JSON.stringify({order_date:today,subtotal,total,shipping,discount,additional_costs}),JSON.stringify(items),JSON.stringify([{amount:total,due_date:today}]),key];
 return {id:await scalar('SELECT create_purchase_order($1::jsonb,$2::jsonb,$3::jsonb,$4)',args),args};
};
const buy=async(item,quantity,unitPrice,stockQuantity,extra={})=>purchase([{inventory_item_id:item,description:'Filamento para produção',quantity,unit_price:unitPrice,total:quantity*unitPrice,stock_quantity:stockQuantity}],extra);
const receive=p=>scalar('SELECT receive_purchase_order($1,$2::date)',[p,today]);
const count=(items,key=next())=>scalar('SELECT post_inventory_count($1::jsonb,$2)',[JSON.stringify(items),key]);
async function test(name,fn){await login(owner);try{await fn();assert.equal(await scalar('SELECT count(*)::integer FROM filament_spools'),0);assert.equal(await scalar('SELECT count(*)::integer FROM filament_spool_events'),0);passed++;console.log('PASS '+name);}catch(error){console.error('FAIL '+name+': '+error.message,error.where??'');throw error;}}
await db.query("INSERT INTO auth.users VALUES($1,'owner@simple.invalid'),($2,'other@simple.invalid'),($3,'viewer@simple.invalid')",[owner,otherOwner,viewer]);
await db.query("INSERT INTO tenants(id,name,slug) VALUES($1,'Simple filament QA','simple-filament-qa'),($2,'Other','simple-filament-other')",[tenant,otherTenant]);
await db.query("INSERT INTO profiles(user_id,tenant_id,display_name) VALUES($1,$4,'Owner'),($2,$5,'Other'),($3,$4,'Viewer')",[owner,otherOwner,viewer,tenant,otherTenant]);
await db.query("INSERT INTO user_roles(user_id,tenant_id,role) VALUES($1,$4,'owner'),($2,$5,'owner'),($3,$4,'viewer')",[owner,otherOwner,viewer,tenant,otherTenant]);
await db.exec('SET ROLE authenticated');await login(owner);today=await scalar('SELECT CURRENT_DATE::text');
try {
 await test('A material and color can be registered with zero stock without spool, capacity, tare or location',async()=>{
  const item=await create(),saved=await stock(item);assert.equal(saved.category,'filament');assert.equal(saved.unit,'g');assert.equal(saved.color_code,'BRANCO');assert.ok(saved.material_identified_at);
  close(saved.current_stock,0);close(saved.avg_cost,0);assert.equal((await ledger(item)).length,0);
 });
 await test('A known acquisition price can support pricing before the first physical stock entry',async()=>{
  const item=await create({avg_cost:.089}),printer=next();
  await db.query("INSERT INTO printers(id,tenant_id,name,model,power_watts) VALUES($1,$2,'Impressora confirmada','A1',100)",[printer,tenant]);
  await scalar('SELECT save_pricing_settings($1::jsonb,$2,$3)',[JSON.stringify({energy_cost_kwh:0,labor_cost_hour:0,overhead_percent:0,target_margin:0,machine_hour_cost:0,handling_minutes_per_plate:0,finishing_minutes_per_piece:0,assembly_minutes_per_product:0,extras_cost_per_product:0}),(await scalar('SELECT pricing_settings()')).revision,next()]);
  const product=await scalar("SELECT save_product_with_photos(NULL,$1::jsonb,'[]'::jsonb,$2)",[JSON.stringify({name:'Peça sem estoque comprado ainda',material_id:item,est_grams:100,est_time_minutes:60,prints_per_plate:1}),next()]);
  await scalar("SELECT save_product_material_recipe($1,NULL,'per_print',$2::jsonb,NULL,$3,0)",[product,JSON.stringify([{item_id:item,grams:100}]),next()]);
  await scalar('SELECT save_product_pricing_plan($1,$2::jsonb,$3,$4)',[product,JSON.stringify({printer_id:printer}),(await scalar('SELECT product_pricing_plan($1)',[product])).revision,next()]);
  const catalog=(await scalar('SELECT product_material_recipe_catalog()')).find(p=>p.id===product);assert.equal(catalog.complete,true);close(catalog.cost_per_unit,8.9);close((await stock(item)).current_stock,0);
 });
 await test('Manual 2.5 kg at R$89/kg becomes exactly2500g at R$0.089/g with one initial ledger entry',async()=>{
  const item=await create({current_stock:2500,avg_cost:.089}),saved=await stock(item),[movement]=await ledger(item);
  close(saved.current_stock,2500);close(saved.avg_cost,.089);close(movement.quantity,2500);close(movement.unit_cost,.089);close(movement.total_cost,222.5);assert.equal(movement.movement_type,'purchase_in');assert.equal(movement.reference_type,'catalog_stock');
 });
 await test('Existing kilogram catalogue semantics retain their quantity and R$/kg valuation',async()=>{
  const item=await create({unit:'kg',current_stock:2.5,avg_cost:89}),saved=await stock(item),[movement]=await ledger(item);
  assert.equal(saved.unit,'kg');close(saved.current_stock,2.5);close(saved.avg_cost,89);close(movement.quantity,2.5);close(movement.total_cost,222.5);
 });
 await test('An explicit free initial acquisition posts its quantity once at zero cost',async()=>{
  const item=await create({current_stock:1000,avg_cost:0}),[movement]=await ledger(item);close((await stock(item)).current_stock,1000);close(movement.unit_cost,0);close(movement.total_cost,0);
 });
 await test('A retry after a later purchase cannot reset the stock or weighted cost to the original form values',async()=>{
  const data=material({current_stock:1000,avg_cost:.08}),key=next(),item=await save(data,null,key),order=await buy(item,1,100,1000);await receive(order.id);
  const before=await stock(item),oldCounts=await counts();assert.equal(await save(data,null,key),item);assert.deepEqual(await stock(item),before);assert.deepEqual(await counts(),oldCounts);close(before.avg_cost,.09);close(before.current_stock,2000);
 });
 await test('The same accepted request cannot be reused with another stock or price',async()=>{
  const data=material({current_stock:1000,avg_cost:.08}),key=next(),item=await save(data,null,key),before=await stock(item),oldCounts=await counts();
  await assert.rejects(save({...data,current_stock:2000,avg_cost:.2},null,key),/outra operação/);assert.deepEqual(await stock(item),before);assert.deepEqual(await counts(),oldCounts);
 });
 await test('A manual physical count uses expected stock, records only the difference and preserves acquisition cost',async()=>{
  const item=await create({current_stock:2500,avg_cost:.089});await save({current_stock:2300,expected_stock:2500},item);
  const saved=await stock(item),movements=await ledger(item);close(saved.current_stock,2300);close(saved.avg_cost,.089);assert.equal(movements.length,2);const movement=movements.find(m=>m.movement_type==='adjustment');close(movement.quantity,-200);close(movement.unit_cost,.089);
 });
 await test('A purchase received after opening a stock count rejects the stale count without partial metadata changes',async()=>{
  const item=await create({current_stock:1000,avg_cost:.08}),order=await buy(item,1,100,1000);await receive(order.id);const before=await stock(item),oldCounts=await counts();
  await assert.rejects(save({name:'Must roll back',current_stock:900,expected_stock:1000},item),/saldo mudou/);assert.deepEqual(await stock(item),before);assert.deepEqual(await counts(),oldCounts);
 });
 await test('A purchase of two kilograms updates a gram item by2000g with weighted average acquisition value',async()=>{
  const item=await create({current_stock:1000,avg_cost:.08}),order=await buy(item,2,100,2000);await receive(order.id);const saved=await stock(item),movement=(await ledger(item)).find(m=>m.reference_id===order.id);
  close(saved.current_stock,3000);close(saved.avg_cost,280/3000);close(saved.last_cost,.1);close(movement.quantity,2000);close(movement.unit_cost,.1);close(movement.total_cost,200);
 });
 await test('The same purchase into a kilogram item updates by2kg and retains R$/kg cost units',async()=>{
  const item=await create({unit:'kg',current_stock:1,avg_cost:80}),order=await buy(item,2,100,2);await receive(order.id);const saved=await stock(item),movement=(await ledger(item)).find(m=>m.reference_id===order.id);
  close(saved.current_stock,3);close(saved.avg_cost,280/3);close(saved.last_cost,100);close(movement.quantity,2);close(movement.unit_cost,100);close(movement.total_cost,200);
 });
 await test('Freight, discount and accessory costs are allocated once across mixed g/kg purchase conversions',async()=>{
  const a=await create(),b=await create({unit:'kg'}),order=await purchase([{inventory_item_id:a,description:'500g branco',quantity:1,unit_price:50,total:50,stock_quantity:500},{inventory_item_id:b,description:'1.5kg verde',quantity:3,unit_price:50,total:150,stock_quantity:1.5}],{shipping:20,discount:10,additional_costs:5});
  await receive(order.id);close((await stock(a)).current_stock,500);close((await stock(a)).avg_cost,.1075);close((await stock(b)).current_stock,1.5);close((await stock(b)).avg_cost,107.5);
  close(await scalar('SELECT sum(total_cost) FROM inventory_movements WHERE reference_id=$1',[order.id]),215);close(await scalar('SELECT sum(amount) FROM accounts_payable WHERE origin_id=$1',[order.id]),215);
 });
 await test('Repeated purchase creation and receipt do not double stock, cost or payable titles',async()=>{
  const item=await create({current_stock:1000,avg_cost:.08}),order=await buy(item,1,100,1000);await receive(order.id);const before=await stock(item),oldCounts=await counts();
  assert.equal(await scalar('SELECT create_purchase_order($1::jsonb,$2::jsonb,$3::jsonb,$4)',order.args),order.id);assert.equal(await receive(order.id),order.id);assert.equal(await receive(order.id),order.id);
  assert.deepEqual(await stock(item),before);assert.deepEqual(await counts(),oldCounts);assert.equal(await scalar('SELECT count(*)::integer FROM accounts_payable WHERE origin_id=$1',[order.id]),1);
 });
 await test('An ordinary identity edit omits stock and price and preserves the latest purchase valuation',async()=>{
  const item=await create({current_stock:1000,avg_cost:.08}),opened=await stock(item),order=await buy(item,1,120,1000);await receive(order.id);
  await save({name:opened.name,brand:'Marca atualizada',notes:'Cor cadastrada para a loja'},item);const saved=await stock(item);
  assert.equal(saved.brand,'Marca atualizada');close(saved.current_stock,2000);close(saved.avg_cost,.1);close(saved.last_cost,.12);assert.equal((await ledger(item)).length,2);
 });
 await test('An explicit manual price correction preserves stock and creates no fake physical entry',async()=>{
  const item=await create({unit:'kg',current_stock:2,avg_cost:89}),before=(await ledger(item)).length;await save({avg_cost:95},item);close((await stock(item)).current_stock,2);close((await stock(item)).avg_cost,95);assert.equal((await ledger(item)).length,before);
 });
 await test('Invalid counts, prices and unconverted purchase lines roll back every affected item',async()=>{
  const before=await counts();for(const changes of [{current_stock:-1},{avg_cost:-1},{material_code:'INVALID'},{color_code:'inválido!'}])await assert.rejects(create(changes));assert.deepEqual(await counts(),before);
  const a=await create(),b=await create(),[first,second]=[a,b].sort(),order=await purchase([{inventory_item_id:first,description:'Valid first',quantity:1,unit_price:50,total:50,stock_quantity:500},{inventory_item_id:second,description:'Missing conversion second',quantity:1,unit_price:50,total:50,stock_quantity:null}]);
  await assert.rejects(receive(order.id),/quantidade convertida/);close((await stock(first)).current_stock,0);close((await stock(second)).current_stock,0);assert.equal(await scalar('SELECT count(*)::integer FROM inventory_movements WHERE reference_id=$1',[order.id]),0);
  await db.query('UPDATE purchase_order_items SET stock_quantity=500 WHERE purchase_order_id=$1 AND inventory_item_id=$2',[order.id,second]);await receive(order.id);close((await stock(second)).current_stock,500);
 });
 await test('Tenant boundaries and read-only roles protect simple registration, manual stock and purchases',async()=>{
  await login(otherOwner);const foreign=await create({current_stock:1000,avg_cost:.08});await login(owner);
  await assert.rejects(save({brand:'Foreign edit'},foreign),/não encontrado/);await assert.rejects(buy(foreign,1,100,1000),/outra empresa/);
  await login(viewer);await assert.rejects(create(),/permissão/);await login(owner);await db.exec('SET ROLE anon');await login(null);await assert.rejects(create(),/permission denied/);await db.exec('SET ROLE authenticated');
 });
 await test('An item with stock history cannot switch g/kg and silently reinterpret its saved quantity',async()=>{
  const item=await create({current_stock:1000,avg_cost:.089}),before=await stock(item);await assert.rejects(save({unit:'kg'},item),/histórico não pode mudar de unidade/);assert.deepEqual(await stock(item),before);
 });
 await test('One stale row in an absolute stock-count batch rolls back all other counts, costs and audits',async()=>{
  const a=await create({current_stock:1000,avg_cost:.08}),b=await create({current_stock:2000,avg_cost:.09}),order=await buy(b,1,100,1000);await receive(order.id);
  const beforeA=await stock(a),beforeB=await stock(b),oldCounts=await counts(),audits=await scalar("SELECT count(*)::integer FROM audit_log WHERE action='confirm_stock_count'");
  await assert.rejects(count([{item_id:a,current_stock:900,expected_stock:1000},{item_id:b,current_stock:1800,expected_stock:2000}]),/saldo mudou/);
  assert.deepEqual(await stock(a),beforeA);assert.deepEqual(await stock(b),beforeB);assert.deepEqual(await counts(),oldCounts);assert.equal(await scalar("SELECT count(*)::integer FROM audit_log WHERE action='confirm_stock_count'"),audits);
 });
 await test('A corrected batch may reuse a failed request and its accepted retry stays inert after a purchase',async()=>{
  const a=await create({current_stock:1000,avg_cost:.08}),b=await create({current_stock:2000,avg_cost:.09}),key=next(),items=[{item_id:a,current_stock:900,expected_stock:1000},{item_id:b,current_stock:1800,expected_stock:1999}];
  await assert.rejects(count(items,key),/saldo mudou/);items[1].expected_stock=2000;assert.equal(await count(items,key),a);close((await stock(a)).current_stock,900);close((await stock(b)).current_stock,1800);
  const order=await buy(a,1,100,1000);await receive(order.id);const after=await stock(a),oldCounts=await counts();assert.equal(await count(items,key),a);assert.deepEqual(await stock(a),after);assert.deepEqual(await counts(),oldCounts);
  await assert.rejects(count([{...items[0],current_stock:899},items[1]],key),/outra operação/);
 });
 await test('Zero and unchanged absolute counts are valid and never create a fake zero movement',async()=>{
  const a=await create({current_stock:1000,avg_cost:.08}),b=await create({current_stock:2000,avg_cost:.09}),oldA=(await ledger(a)).length,oldB=(await ledger(b)).length;
  await count([{item_id:b,current_stock:2000,expected_stock:2000},{item_id:a,current_stock:0,expected_stock:1000}]);close((await stock(a)).current_stock,0);close((await stock(a)).avg_cost,.08);close((await stock(b)).current_stock,2000);close((await stock(b)).avg_cost,.09);
  assert.equal((await ledger(a)).length,oldA+1);assert.equal((await ledger(b)).length,oldB);
 });
 await test('Absolute stock counts reject duplicate, foreign, archived, malformed and read-only requests',async()=>{
  const a=await create({current_stock:1000,avg_cost:.08}),entry={item_id:a,current_stock:900,expected_stock:1000},before=await stock(a);
  for(const items of [[],[entry,entry],[{...entry,current_stock:-1}],[{...entry,current_stock:'900'}],[{...entry,current_stock:.0000001}],[{...entry,avg_cost:.2}],[{item_id:a,current_stock:900}]])await assert.rejects(count(items));
  await login(otherOwner);const foreign=await create();await login(owner);await assert.rejects(count([entry,{item_id:foreign,current_stock:0,expected_stock:0}]),/empresa/);assert.deepEqual(await stock(a),before);
  const archived=await create();await db.exec('RESET ROLE');await db.query('UPDATE inventory_items SET is_active=false WHERE id=$1',[archived]);await db.exec('SET ROLE authenticated');await assert.rejects(count([{item_id:archived,current_stock:0,expected_stock:0}]),/ativos/);
  await login(viewer);await assert.rejects(count([entry]),/permissão/);await db.exec('SET ROLE anon');await login(null);await assert.rejects(count([entry]),/permission denied/);await db.exec('SET ROLE authenticated');
 });
 await test('Absolute manual counts also support finished stock owned by a product without changing its identity or commercial values',async()=>{
  const product=await scalar("SELECT save_product_with_photos(NULL,$1::jsonb,'[]'::jsonb,$2)",[JSON.stringify({name:'Peça pronta',sku:'FINISHED-QA',manual_cost:12,cost_estimate:12,sale_price:25,stock:{avg_cost:12,current_stock:5}}),next()]);
  const before=await scalar('SELECT to_jsonb(p) FROM products p WHERE id=$1',[product]),item=before.stock_item_id,inventory=await stock(item);assert.ok(item);assert.equal(inventory.unit,'un');close(inventory.current_stock,5);
  assert.equal(await count([{item_id:item,current_stock:3,expected_stock:5}]),item);const after=await stock(item);
  close(after.current_stock,3);close(after.avg_cost,12);assert.equal(after.name,inventory.name);assert.equal(after.sku,inventory.sku);assert.deepEqual(await scalar('SELECT to_jsonb(p) FROM products p WHERE id=$1',[product]),before);
 });
 await test('The count snapshot supports the full six-decimal precision stored by inventory_items',async()=>{
  assert.equal(await scalar("SELECT numeric_scale FROM information_schema.columns WHERE table_schema='public' AND table_name='inventory_items' AND column_name='current_stock'"),6);
  const item=await create({current_stock:1234.567891,avg_cost:.089});await count([{item_id:item,current_stock:1234.56,expected_stock:1234.567891}]);close((await stock(item)).current_stock,1234.56);close((await stock(item)).avg_cost,.089);
 });
 console.log(`Validated ${passed} simple filament registration scenarios; no physical spools or spool events were created.`);
}finally{await db.close();}
