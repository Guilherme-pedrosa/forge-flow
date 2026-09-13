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
// These regression fixtures represent orders predating the material-recipe rollout.
// New-order recipe enforcement is exercised in test-sales-quotes.mjs.
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
await test('Partial settlement is atomic and retry does not duplicate balance',async()=>{
  const title=await scalar(`INSERT INTO accounts_payable(tenant_id,description,amount,due_date) VALUES($1,'Filament',100,CURRENT_DATE) RETURNING id`,[tenant]);
  const args=[title,40,bank,id(100)];
  const call=`SELECT settle_financial_title('payable',$1,$2,CURRENT_DATE,$3,$4)`;
  const tx=await scalar(call,args); assert.equal(await scalar(call,args),tx);
  assert.equal(await scalar('SELECT current_balance FROM bank_accounts WHERE id=$1',[bank]),'960.00');
  assert.equal(await scalar('SELECT status FROM accounts_payable WHERE id=$1',[title]),'partial');
  await rejects(call,[title,70,bank,id(101)],/saldo pendente/);
  await rejects(call,[title,40,otherBank,id(102)],/inválid|outra empresa/);
  await rejects(call,[title,41,bank,id(100)],/outra operação/);
  assert.equal(await scalar('SELECT amount_paid FROM accounts_payable WHERE id=$1',[title]),'40.00');
  await scalar(call,[title,60,bank,id(103)]);
  assert.equal(await scalar('SELECT status FROM accounts_payable WHERE id=$1',[title]),'paid');
  await rejects('DELETE FROM accounts_payable WHERE id=$1',[title],/não pode ser excluído/);
});
await test('Cross-tenant references and profile reassignment are rejected',async()=>{
  await rejects('SELECT post_inventory_movement($1::jsonb,$2)',[JSON.stringify({item_id:otherMaterial,movement_type:'purchase_in',quantity:10,unit_cost:1}),requestId()],/outra empresa/);
  await rejects('UPDATE profiles SET tenant_id=$1 WHERE user_id=$2',[otherTenant,uid],/não pode ser alterada/);
  await rejects('SELECT create_jobs($1::jsonb,$2)',[JSON.stringify([{name:'Cross tenant',material_id:otherMaterial}]),requestId()],/outra empresa/);
});
await test('Stock adjustment applies once and protects balance',async()=>{
  const movement={item_id:material,movement_type:'adjustment',quantity:-0.1,notes:'Physical count'};
  const request=requestId();
  const movementId=await postMovement(movement,request);
  assert.equal(await postMovement(movement,request),movementId);
  assert.equal(await scalar('SELECT current_stock FROM inventory_items WHERE id=$1',[material]),'0.900000');
  await rejects(`UPDATE inventory_items SET current_stock=50 WHERE id=$1`,[material],/movimentações/);
  await rejects('SELECT post_inventory_movement($1::jsonb,$2)',[JSON.stringify({item_id:material,movement_type:'loss',quantity:1,notes:'Too much'}),requestId()],/insuficiente/);
  await rejects(`UPDATE inventory_items SET unit='g' WHERE id=$1`,[material],/mudar de unidade/);
});
await test('Job completion converts 100g to 0.1kg, posts all cost components once',async()=>{
  const job=await createJob({name:'Measured job',status:'queued',material_id:material,printer_id:printer,sale_price:50});
  await scalar(`SELECT transition_job($1,'printing')`,[job]);
  const sql=`SELECT transition_job($1,'completed',100,60,10,NULL,NULL,NULL,5,2,0)`;
  await scalar(sql,[job]); await scalar(sql,[job]);
  assert.equal(await scalar('SELECT current_stock FROM inventory_items WHERE id=$1',[material]),'0.800000');
  const row=(await db.query('SELECT actual_material_cost,actual_total_cost FROM jobs WHERE id=$1',[job])).rows[0];
  assert.equal(row.actual_material_cost,'10.00'); assert.equal(row.actual_total_cost,'20.20');
  assert.equal(await scalar('SELECT count(*)::int FROM inventory_movements WHERE reference_id=$1',[job]),1);
});
await test('Viewer cannot mutate or invoke financial business operations',async()=>{
  await db.query(`SELECT set_config('request.jwt.claim.sub',$1,false)`,[viewerUid]);
  await rejects(`INSERT INTO inventory_items(tenant_id,name) VALUES($1,'Forbidden')`,[tenant],/row-level security/);
  await rejects(`SELECT register_bank_transaction($1,'credit',1,CURRENT_DATE,'Forbidden',$2)`,[bank,id(999)],/permissão/);
  await db.query(`SELECT set_config('request.jwt.claim.sub',$1,false)`,[uid]);
});
await test('Products preserve missing prices, clear photos and retry the same request',async()=>{
  const payload={name:'Unpriced product',cost_estimate:null,sale_price:null,extras:[]};
  const request=requestId();
  const product=await saveProduct(payload,['https://example.test/first.jpg'],null,request);
  assert.equal(await saveProduct(payload,['https://example.test/first.jpg'],null,request),product);
  assert.deepEqual(await row('SELECT cost_estimate,sale_price,margin_percent FROM products WHERE id=$1',[product]),{cost_estimate:null,sale_price:null,margin_percent:null});
  assert.equal(await scalar('SELECT count(*)::int FROM product_photos WHERE product_id=$1',[product]),1);
  await saveProduct({...payload,name:'Photo removed'},[],product);
  assert.equal(await scalar('SELECT count(*)::int FROM product_photos WHERE product_id=$1',[product]),0);
  await rejects('SELECT save_product_with_photos(NULL,$1::jsonb,$2::jsonb,$3)',[JSON.stringify({...payload,name:'Changed payload'}),JSON.stringify(['https://example.test/first.jpg']),request],/outra operação/);
});
await test('Product photo failure rolls back the product update and previous gallery',async()=>{
  const payload={name:'Original product',cost_estimate:10,sale_price:20,extras:[]};
  const product=await saveProduct(payload,['https://example.test/original.jpg']);
  await rejects('SELECT save_product_with_photos($1,$2::jsonb,$3::jsonb,$4)',[product,JSON.stringify({...payload,name:'Must rollback'}),JSON.stringify(['https://example.test/valid.jpg','javascript:invalid']),requestId()],/foto inválida/);
  assert.equal(await scalar('SELECT name FROM products WHERE id=$1',[product]),'Original product');
  assert.deepEqual((await db.query('SELECT url FROM product_photos WHERE product_id=$1',[product])).rows,[{url:'https://example.test/original.jpg'}]);
});
await test('Product composition rejects direct and indirect kit cycles and foreign material',async()=>{
  const a=await saveProduct({name:'Cycle A',extras:[]});
  const b=await saveProduct({name:'Cycle B',extras:[]});
  await saveProduct({name:'Cycle A',category:'kit',extras:[{_kit_product_id:b,_kit_qty:1,cost:0}]},[],a);
  await rejects('SELECT save_product_with_photos($1,$2::jsonb,\'[]\'::jsonb,$3)',[b,JSON.stringify({name:'Cycle B',extras:[{_kit_product_id:a,_kit_qty:1,cost:0}]}),requestId()],/ciclo|profundidade/);
  await rejects('SELECT save_product_with_photos($1,$2::jsonb,\'[]\'::jsonb,$3)',[a,JSON.stringify({name:'Cycle A',extras:[{_kit_product_id:a,_kit_qty:1,cost:0}]}),requestId()],/Componente/);
  await rejects('SELECT save_product_with_photos(NULL,$1::jsonb,\'[]\'::jsonb,$2)',[JSON.stringify({name:'Wrong tenant product',material_id:otherMaterial}),requestId()],/outra empresa/);
});
await test('Multi-item purchase rolls back receipt on a later missing conversion, then receives exactly once',async()=>{
  const materialA=await makeMaterial('Purchase kg','kg');
  const materialB=await makeMaterial('Purchase grams','g');
  // Receipt sorts by material id; keep the failure on the second item in that ordering.
  const [first,second]=[materialA,materialB].sort();
  const purchase={order_date:today,subtotal:200,discount:10,shipping:20,additional_costs:5,total:215,nfe_key:'test-multiple-items'};
  const items=[{inventory_item_id:first,description:'First converted item',quantity:1,unit_price:50,total:50,stock_quantity:1},{inventory_item_id:second,description:'Second unconverted item',quantity:3,unit_price:50,total:150,stock_quantity:null}];
  const installments=[{amount:107.5,due_date:today},{amount:107.5,due_date:today}];
  const args=[JSON.stringify(purchase),JSON.stringify(items),JSON.stringify(installments),requestId()];
  const purchaseId=await scalar('SELECT create_purchase_order($1::jsonb,$2::jsonb,$3::jsonb,$4)',args);
  assert.equal(await scalar('SELECT create_purchase_order($1::jsonb,$2::jsonb,$3::jsonb,$4)',args),purchaseId);
  assert.equal(money(await scalar('SELECT sum(amount) FROM accounts_payable WHERE origin_id=$1',[purchaseId])),215);
  await rejects('SELECT receive_purchase_order($1,CURRENT_DATE)',[purchaseId],/quantidade convertida/);
  assert.equal(money(await scalar('SELECT current_stock FROM inventory_items WHERE id=$1',[first])),0);
  assert.equal(await scalar('SELECT count(*)::int FROM inventory_movements WHERE reference_id=$1',[purchaseId]),0);
  assert.equal(await scalar('SELECT status FROM purchase_orders WHERE id=$1',[purchaseId]),'pending');
  await db.query('UPDATE purchase_order_items SET stock_quantity=1500 WHERE purchase_order_id=$1 AND inventory_item_id=$2',[purchaseId,second]);
  await scalar('SELECT receive_purchase_order($1,CURRENT_DATE)',[purchaseId]);
  await scalar('SELECT receive_purchase_order($1,CURRENT_DATE)',[purchaseId]);
  assert.equal(money(await scalar('SELECT current_stock FROM inventory_items WHERE id=$1',[first])),1);
  assert.equal(money(await scalar('SELECT avg_cost FROM inventory_items WHERE id=$1',[first])),53.75);
  assert.equal(money(await scalar('SELECT current_stock FROM inventory_items WHERE id=$1',[second])),1500);
  assert.equal(money(await scalar('SELECT avg_cost FROM inventory_items WHERE id=$1',[second])),0.1075);
  assert.equal(money(await scalar('SELECT sum(total_cost) FROM inventory_movements WHERE reference_id=$1',[purchaseId])),215);
  assert.equal(await scalar('SELECT count(*)::int FROM inventory_movements WHERE reference_id=$1',[purchaseId]),2);
  await rejects('UPDATE purchase_order_items SET stock_quantity=2000 WHERE purchase_order_id=$1',[purchaseId],/compras pendentes/);
  await rejects('SELECT cancel_purchase_order($1)',[purchaseId],/recebida exige/);
  const before=await scalar('SELECT count(*)::int FROM purchase_orders');
  await rejects('SELECT create_purchase_order($1::jsonb,$2::jsonb,$3::jsonb,$4)',[...args.slice(0,3),requestId()],/purchase_nfe_unique|duplicate key/);
  assert.equal(await scalar('SELECT count(*)::int FROM purchase_orders'),before);
});
await test('Purchase creation validates installment totals and rolls back every linked record',async()=>{
  const before=await scalar('SELECT count(*)::int FROM purchase_orders');
  await rejects('SELECT create_purchase_order($1::jsonb,$2::jsonb,$3::jsonb,$4)',[JSON.stringify({order_date:today,subtotal:100,total:100}),JSON.stringify([{description:'One item',quantity:1,unit_price:100,total:100}]),JSON.stringify([{amount:99,due_date:today}]),requestId()],/parcelas/);
  assert.equal(await scalar('SELECT count(*)::int FROM purchase_orders'),before);
});
await test('Purchase cancellation cancels linked unpaid titles but preserves paid commitments',async()=>{
  const create=async()=>scalar('SELECT create_purchase_order($1::jsonb,$2::jsonb,$3::jsonb,$4)',[JSON.stringify({order_date:today,subtotal:100,total:100}),JSON.stringify([{description:'Service',quantity:1,unit_price:100,total:100}]),JSON.stringify([{amount:100,due_date:today}]),requestId()]);
  const cancellable=await create();
  await scalar('SELECT cancel_purchase_order($1)',[cancellable]);
  await scalar('SELECT cancel_purchase_order($1)',[cancellable]);
  assert.equal(await scalar('SELECT status FROM accounts_payable WHERE origin_id=$1',[cancellable]),'cancelled');
  const paid=await create();
  const title=await scalar('SELECT id FROM accounts_payable WHERE origin_id=$1',[paid]);
  await scalar("SELECT settle_financial_title('payable',$1,20,CURRENT_DATE,$2,$3)",[title,bank,requestId()]);
  await rejects('SELECT cancel_purchase_order($1)',[paid],/pagamento/);
  assert.equal(await scalar('SELECT status FROM purchase_orders WHERE id=$1',[paid]),'pending');
});
await test('Sales approval creates one receivable and production splits plate estimates by unit',async()=>{
  const product=await saveProduct({name:'Plate of four',material_id:material,est_grams:200,est_time_minutes:120,prints_per_plate:4,cost_estimate:12,sale_price:25,extras:[]});
  const order=await createOrder(product,3,25);
  assert.equal(await scalar('SELECT save_sales_order($1,$2::jsonb,$3::jsonb,$4)',order.args),order.id);
  await scalar("SELECT transition_sales_order($1,'approved')",[order.id]);
  await scalar("SELECT transition_sales_order($1,'approved')",[order.id]);
  assert.equal(await scalar('SELECT count(*)::int FROM accounts_receivable WHERE origin_id=$1',[order.id]),1);
  assert.equal(money(await scalar('SELECT amount FROM accounts_receivable WHERE origin_id=$1',[order.id])),75);
  await scalar("SELECT transition_sales_order($1,'in_production')",[order.id]);
  await scalar("SELECT transition_sales_order($1,'in_production')",[order.id]);
  const jobs=(await db.query('SELECT est_grams,est_time_minutes,est_total_cost,sale_price FROM jobs WHERE order_id=$1',[order.id])).rows;
  assert.equal(jobs.length,3);
  for(const job of jobs){assert.equal(money(job.est_grams),50);assert.equal(job.est_time_minutes,30);assert.equal(money(job.est_total_cost),12);assert.equal(money(job.sale_price),25);}
  await rejects("SELECT transition_sales_order($1,'ready')",[order.id],/Conclua/);
});
await test('Kit sales explode physical components and conserve discounted revenue',async()=>{
  const a=await saveProduct({name:'Kit component A',material_id:material,est_grams:20,est_time_minutes:30,cost_estimate:5,sale_price:10,extras:[]});
  const b=await saveProduct({name:'Kit component B',material_id:material,est_grams:30,est_time_minutes:60,cost_estimate:10,sale_price:20,extras:[]});
  const kit=await saveProduct({name:'Kit ABC',category:'kit',cost_estimate:20,sale_price:40,extras:[{_kit_product_id:a,_kit_qty:2,cost:10},{_kit_product_id:b,_kit_qty:1,cost:10}]});
  const order=await createOrder(kit,2,40,{order:{discount:8,total:72}});
  await scalar("SELECT transition_sales_order($1,'approved')",[order.id]);
  await scalar("SELECT transition_sales_order($1,'in_production')",[order.id]);
  assert.equal(await scalar('SELECT count(*)::int FROM jobs WHERE order_id=$1',[order.id]),6);
  assert.equal(await scalar('SELECT count(*)::int FROM jobs WHERE order_id=$1 AND product_id=$2',[order.id,a]),4);
  assert.equal(await scalar('SELECT count(*)::int FROM jobs WHERE order_id=$1 AND product_id=$2',[order.id,b]),2);
  assert.equal(money(await scalar('SELECT sum(sale_price) FROM jobs WHERE order_id=$1',[order.id])),72);
});
await test('Twenty low-value jobs never receive negative revenue from rounding',async()=>{
  const product=await saveProduct({name:'Small part',cost_estimate:0.001,sale_price:0.01,extras:[]});
  const order=await createOrder(product,20,0.01,{order:{discount:0.1,total:0.1}});
  await scalar("SELECT transition_sales_order($1,'approved')",[order.id]);
  await scalar("SELECT transition_sales_order($1,'in_production')",[order.id]);
  assert.equal(await scalar('SELECT count(*)::int FROM jobs WHERE order_id=$1',[order.id]),20);
  assert.equal(money(await scalar('SELECT sum(sale_price) FROM jobs WHERE order_id=$1',[order.id])),0.1);
  assert.ok(money(await scalar('SELECT min(sale_price) FROM jobs WHERE order_id=$1',[order.id]))>=0);
});
await test('Freight-only sales do not divide by zero during production',async()=>{
  const product=await saveProduct({name:'Complimentary sample',cost_estimate:1,sale_price:0,extras:[]});
  const order=await createOrder(product,1,0,{order:{shipping:10,total:10}});
  await scalar("SELECT transition_sales_order($1,'approved')",[order.id]);
  await scalar("SELECT transition_sales_order($1,'in_production')",[order.id]);
  assert.equal(money(await scalar('SELECT sum(sale_price) FROM jobs WHERE order_id=$1',[order.id])),0);
});
await test('Paid order receivables cannot be reset by order edits, status retries or cancellation',async()=>{
  const product=await saveProduct({name:'Paid order product',cost_estimate:10,sale_price:50,extras:[]});
  const order=await createOrder(product,1,50);
  await scalar("SELECT transition_sales_order($1,'approved')",[order.id]);
  const title=await scalar('SELECT id FROM accounts_receivable WHERE origin_id=$1',[order.id]);
  await scalar("SELECT settle_financial_title('receivable',$1,20,CURRENT_DATE,$2,$3)",[title,bank,requestId()]);
  await scalar("SELECT transition_sales_order($1,'approved')",[order.id]);
  await rejects('SELECT save_sales_order($1,$2::jsonb,$3::jsonb,$4)',[order.id,...order.args.slice(1,3),requestId()],/Somente rascunhos/);
  await rejects("SELECT transition_sales_order($1,'cancelled')",[order.id],/recebimento/);
  await rejects('UPDATE accounts_receivable SET amount_received=0 WHERE id=$1',[title],/baixa|Histórico/);
  await rejects('UPDATE accounts_receivable SET origin_id=NULL WHERE id=$1',[title],/vinculado|origem/);
  assert.equal(money(await scalar('SELECT amount_received FROM accounts_receivable WHERE id=$1',[title])),20);
});
await test('Cancelling an unstarted order reverses the receivable and prevents starting its jobs',async()=>{
  const product=await saveProduct({name:'Cancellable',material_id:material,cost_estimate:5,sale_price:20,extras:[]});
  const order=await createOrder(product);
  await scalar("SELECT transition_sales_order($1,'approved')",[order.id]);
  await scalar("SELECT transition_sales_order($1,'in_production')",[order.id]);
  const job=await scalar('SELECT id FROM jobs WHERE order_id=$1 LIMIT 1',[order.id]);
  await scalar("SELECT transition_sales_order($1,'cancelled')",[order.id]);
  assert.equal(await scalar('SELECT status FROM accounts_receivable WHERE origin_id=$1',[order.id]),'reversed');
  await rejects("SELECT transition_job($1,'printing',NULL,NULL,NULL,NULL,$2)",[job,printer],/pedido foi cancelado/);
});
await test('Consignment sells at 20 percent commission exactly once and preserves gross history',async()=>{
  const product=await saveProduct({name:'Consigned piece',cost_estimate:5,sale_price:20,extras:[]});
  const location=await makeConsignment(product,20,10);
  const args=[location,JSON.stringify([{product_id:product,quantity:2,unit_price:20}]),requestId()];
  const sale=await scalar("SELECT post_consignment_movement($1,'sale',$2::jsonb,'Sale test',$3)",args);
  assert.equal(await scalar("SELECT post_consignment_movement($1,'sale',$2::jsonb,'Sale test',$3)",args),sale);
  assert.equal(money(await scalar('SELECT total FROM orders WHERE id=$1',[sale])),32);
  assert.equal(money(await scalar('SELECT discount FROM orders WHERE id=$1',[sale])),8);
  assert.equal(money(await scalar('SELECT amount FROM accounts_receivable WHERE origin_id=$1',[sale])),32);
  assert.equal(money(await scalar('SELECT current_qty FROM consignment_items WHERE location_id=$1 AND product_id=$2',[location,product])),8);
  assert.equal(await scalar("SELECT count(*)::int FROM consignment_movements WHERE location_id=$1 AND movement_type='sale'",[location]),1);
});
await test('Zero consignment commission stays zero and shortage does not create a sale',async()=>{
  const product=await saveProduct({name:'Commission-free piece',sale_price:10,cost_estimate:3,extras:[]});
  const location=await makeConsignment(product,0,3);
  const sale=await scalar("SELECT post_consignment_movement($1,'sale',$2::jsonb,NULL,$3)",[location,JSON.stringify([{product_id:product,quantity:1,unit_price:10}]),requestId()]);
  assert.equal(money(await scalar('SELECT total FROM orders WHERE id=$1',[sale])),10);
  assert.equal(money(await scalar('SELECT discount FROM orders WHERE id=$1',[sale])),0);
  const before=await scalar('SELECT count(*)::int FROM orders');
  await rejects("SELECT post_consignment_movement($1,'sale',$2::jsonb,NULL,$3)",[location,JSON.stringify([{product_id:product,quantity:3,unit_price:10}]),requestId()],/Saldo insuficiente/);
  assert.equal(await scalar('SELECT count(*)::int FROM orders'),before);
  assert.equal(money(await scalar('SELECT current_qty FROM consignment_items WHERE location_id=$1 AND product_id=$2',[location,product])),2);
});
await test('Multi-item consignment failure rolls back all quantities and financial records',async()=>{
  const a=await saveProduct({name:'Consignment A',sale_price:10,extras:[]});
  const b=await saveProduct({name:'Consignment B',sale_price:10,extras:[]});
  const location=await makeConsignment(a,20,3);
  const beforeOrders=await scalar('SELECT count(*)::int FROM orders');
  const beforeMovements=await scalar('SELECT count(*)::int FROM consignment_movements WHERE location_id=$1',[location]);
  await rejects("SELECT post_consignment_movement($1,'sale',$2::jsonb,'Rollback',$3)",[location,JSON.stringify([{product_id:a,quantity:1,unit_price:10},{product_id:b,quantity:1,unit_price:10}]),requestId()],/Saldo insuficiente/);
  assert.equal(money(await scalar('SELECT current_qty FROM consignment_items WHERE location_id=$1 AND product_id=$2',[location,a])),3);
  assert.equal(await scalar('SELECT count(*)::int FROM consignment_items WHERE location_id=$1 AND product_id=$2',[location,b]),0);
  assert.equal(await scalar('SELECT count(*)::int FROM orders'),beforeOrders);
  assert.equal(await scalar('SELECT count(*)::int FROM consignment_movements WHERE location_id=$1',[location]),beforeMovements);
});
await test('Consignment physical count rejects stale expected balances and retries safely',async()=>{
  const product=await saveProduct({name:'Counted piece',sale_price:10,extras:[]});
  const location=await makeConsignment(product,20,10);
  const item=await scalar('SELECT id FROM consignment_items WHERE location_id=$1 AND product_id=$2',[location,product]);
  const request=requestId();
  const adjustment=await scalar("SELECT adjust_consignment_stock($1,8,10,'Physical count',$2)",[item,request]);
  assert.equal(await scalar("SELECT adjust_consignment_stock($1,8,10,'Physical count',$2)",[item,request]),adjustment);
  await rejects("SELECT adjust_consignment_stock($1,9,10,'Stale screen',$2)",[item,requestId()],/saldo mudou/);
  assert.equal(money(await scalar('SELECT current_qty FROM consignment_items WHERE id=$1',[item])),8);
});
await test('Sensitive Bambu columns remain revoked after loading all migrations',async()=>{
  await rejects('SELECT access_token_encrypted FROM bambu_connections',[],/permission denied/);
  await db.query('SELECT id,bambu_email,is_active FROM bambu_connections');
  await rejects('SELECT * FROM erp_private.requests',[],/permission denied/);
});
await test('Storage writes and private attachment reads are scoped to tenant folders',async()=>{
  await db.query("INSERT INTO storage.objects(bucket_id,name) VALUES('product-photos',$1),('attachments',$2)",[`${tenant}/own.jpg`,`${tenant}/own.pdf`]);
  await rejects("INSERT INTO storage.objects(bucket_id,name) VALUES('product-photos',$1)",[`${otherTenant}/forbidden.jpg`],/row-level security/);
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[otherUid]);
  assert.equal(await scalar("SELECT count(*)::int FROM storage.objects WHERE bucket_id='attachments' AND name=$1",[`${tenant}/own.pdf`]),0);
  await db.query("DELETE FROM storage.objects WHERE bucket_id='product-photos' AND name=$1",[`${tenant}/own.jpg`]);
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[uid]);
  assert.equal(await scalar("SELECT count(*)::int FROM storage.objects WHERE name=$1",[`${tenant}/own.jpg`]),1);
});
await test('First production exit records measured costs and finishing transitions never consume again',async()=>{
  const item=await makeMaterial('Measured finishing stock','kg');
  await postMovement({item_id:item,movement_type:'purchase_in',quantity:1,unit_cost:100});
  const job=await createJob({name:'Finishing workflow',status:'queued',material_id:item,printer_id:printer,sale_price:50});
  await scalar("SELECT transition_job($1,'printing')",[job]);
  await scalar("SELECT transition_job($1,'post_processing',100,60,10,NULL,NULL,NULL,0,0,3)",[job]);
  await scalar("SELECT transition_job($1,'quality_check')",[job]);
  await scalar("SELECT transition_job($1,'ready')",[job]);
  await scalar("SELECT transition_job($1,'completed')",[job]);
  assert.equal(money(await scalar('SELECT current_stock FROM inventory_items WHERE id=$1',[item])),0.9);
  assert.equal(money(await scalar('SELECT actual_total_cost FROM jobs WHERE id=$1',[job])),16.2);
  assert.equal(money(await scalar('SELECT actual_extras_cost FROM jobs WHERE id=$1',[job])),3);
  assert.equal(await scalar('SELECT count(*)::int FROM inventory_movements WHERE reference_id=$1',[job]),1);
  await rejects('UPDATE jobs SET actual_labor_cost=999 WHERE id=$1',[job],/histórico/);
  await rejects('UPDATE jobs SET material_id=NULL WHERE id=$1',[job],/histórico/);
});
await test('A late production cost validation failure rolls back earlier material consumption',async()=>{
  const item=await makeMaterial('Rollback production material','g');
  await postMovement({item_id:item,movement_type:'purchase_in',quantity:1000,unit_cost:0.1});
  const job=await createJob({name:'Rollback production',status:'queued',material_id:item,printer_id:printer,est_total_cost:20,est_extras_cost:3});
  await scalar("SELECT transition_job($1,'printing')",[job]);
  await rejects("SELECT transition_job($1,'completed',100,60,0,NULL,NULL,NULL,0,0,-1)",[job],/custos reais válidos/);
  assert.equal(money(await scalar('SELECT current_stock FROM inventory_items WHERE id=$1',[item])),1000);
  assert.equal(await scalar('SELECT count(*)::int FROM inventory_movements WHERE reference_id=$1',[job]),0);
  assert.equal(await scalar('SELECT status FROM jobs WHERE id=$1',[job]),'printing');
  await scalar("SELECT transition_job($1,'failed',20,10,20,'Adhesion failure',NULL,NULL,0,0,0)",[job]);
  assert.equal(money(await scalar('SELECT current_stock FROM inventory_items WHERE id=$1',[item])),980);
  const reprint=await scalar("SELECT transition_job($1,'reprint')",[job]);
  assert.equal(await scalar("SELECT transition_job($1,'reprint')",[job]),reprint);
  assert.equal(await scalar('SELECT count(*)::int FROM jobs WHERE reprint_of=$1',[job]),1);
  assert.deepEqual(await row('SELECT est_total_cost,est_extras_cost FROM jobs WHERE id=$1',[reprint]),await row('SELECT est_total_cost,est_extras_cost FROM jobs WHERE id=$1',[job]));
});
await test('Operator can manage production but cannot post financial transactions',async()=>{
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[id(4)]);
  await saveProduct({name:'Operator catalog product',extras:[]});
  await rejects("SELECT register_bank_transaction($1,'debit',5,CURRENT_DATE,'Forbidden financial',$2)",[bank,requestId()],/permissão/);
  await rejects("INSERT INTO accounts_payable(tenant_id,description,amount,due_date) VALUES($1,'Forbidden',10,CURRENT_DATE)",[tenant],/row-level security/);
  await rejects("INSERT INTO user_roles(user_id,tenant_id,role) VALUES($1,$2,'owner')",[id(4),tenant],/row-level security/);
});
await test('Direct bank and purchase writes cannot bypass transactional operations',async()=>{
  await rejects("INSERT INTO bank_transactions(tenant_id,bank_account_id,type,amount,transaction_date,description) VALUES($1,$2,'credit',100,CURRENT_DATE,'Bypass')",[tenant,bank],/row-level security/);
  await rejects("INSERT INTO purchase_orders(tenant_id,code,status,total) VALUES($1,'BYPASS','received',100)",[tenant],/row-level security/);
  const title=await scalar("INSERT INTO accounts_receivable(tenant_id,description,amount,due_date) VALUES($1,'Open title',50,CURRENT_DATE) RETURNING id",[tenant]);
  await rejects("UPDATE accounts_receivable SET status='received' WHERE id=$1",[title],/baixa|liquid|Histórico/);
  assert.equal(money(await scalar('SELECT amount_received FROM accounts_receivable WHERE id=$1',[title])),0);
});
await test('Anonymous role cannot call ERP mutations or inspect private requests',async()=>{
  await db.exec('SET ROLE anon');
  try {
    await rejects("SELECT register_bank_transaction($1,'credit',1,CURRENT_DATE,'Anonymous',$2)",[bank,requestId()],/permission denied/);
    await rejects('SELECT * FROM erp_private.requests',[],/permission denied/);
  } finally { await db.exec('SET ROLE authenticated'); }
});
await test('Discounted revenue closes in cents across separate order lines, not only within one line',async()=>{
  const product=await saveProduct({name:'Multi-line rounding part',cost_estimate:0.01,sale_price:0.01,extras:[]});
  const items=Array.from({length:3},(_,index)=>({product_id:product,description:`Separate line ${index+1}`,quantity:1,unit_price:0.01,total:0.01}));
  const order=await createOrder(product,1,0.01,{items,order:{discount:0.01,total:0.02}});
  await scalar("SELECT transition_sales_order($1,'approved')",[order.id]);
  await scalar("SELECT transition_sales_order($1,'in_production')",[order.id]);
  assert.equal(await scalar('SELECT count(*)::int FROM jobs WHERE order_id=$1',[order.id]),3);
  assert.equal(money(await scalar('SELECT sum(sale_price) FROM jobs WHERE order_id=$1',[order.id])),0.02);
  assert.ok(money(await scalar('SELECT min(sale_price) FROM jobs WHERE order_id=$1',[order.id]))>=0);
});
await test('Quality rejection keeps the already posted physical consumption and costs unchanged',async()=>{
  const item=await makeMaterial('QC rejection material','g');
  await postMovement({item_id:item,movement_type:'purchase_in',quantity:1000,unit_cost:0.1});
  const job=await createJob({name:'QC rejection',status:'queued',material_id:item,printer_id:printer,sale_price:50});
  const failureCount=money(await scalar('SELECT total_failures FROM printers WHERE id=$1',[printer]));
  await scalar("SELECT transition_job($1,'printing')",[job]);
  await scalar("SELECT transition_job($1,'quality_check',100,60,0,NULL,NULL,NULL,0,0,2)",[job]);
  const posted=await row('SELECT actual_total_cost,inventory_posted_at,actual_grams FROM jobs WHERE id=$1',[job]);
  await scalar("SELECT transition_job($1,'failed',NULL,NULL,NULL,'Rejected dimensional check')",[job]);
  assert.deepEqual(await row('SELECT actual_total_cost,inventory_posted_at,actual_grams FROM jobs WHERE id=$1',[job]),posted);
  assert.equal(money(await scalar('SELECT current_stock FROM inventory_items WHERE id=$1',[item])),900);
  assert.equal(await scalar('SELECT count(*)::int FROM inventory_movements WHERE reference_id=$1',[job]),1);
  assert.equal(money(await scalar('SELECT total_failures FROM printers WHERE id=$1',[printer])),failureCount+1);
});
await test('Order production snapshots component and kit extras and preserves unknown total costs',async()=>{
  const component=await saveProduct({name:'Component with extras',cost_estimate:10,sale_price:20,extras:[{name:'Unit magnet',cost:2}]});
  const kit=await saveProduct({name:'Kit with packaging',category:'kit',cost_estimate:36,sale_price:60,extras:[{_kit_product_id:component,_kit_qty:3,cost:30},{name:'Kit package',cost:6}]});
  const order=await createOrder(kit,2,60);
  await scalar("SELECT transition_sales_order($1,'approved')",[order.id]);
  await scalar("SELECT transition_sales_order($1,'in_production')",[order.id]);
  const jobs=(await db.query('SELECT est_total_cost,est_extras_cost FROM jobs WHERE order_id=$1',[order.id])).rows;
  assert.equal(jobs.length,6);
  for(const job of jobs){assert.equal(money(job.est_total_cost),12);assert.equal(money(job.est_extras_cost),4);}
  await saveProduct({name:'Component changed later',cost_estimate:15,sale_price:20,extras:[{name:'New magnet price',cost:7}]},[],component);
  assert.deepEqual((await db.query('SELECT est_total_cost,est_extras_cost FROM jobs WHERE order_id=$1',[order.id])).rows,jobs);
  const unknown=await saveProduct({name:'Uncosted production product',cost_estimate:null,sale_price:20,extras:[]});
  const unknownOrder=await createOrder(unknown);
  await scalar("SELECT transition_sales_order($1,'approved')",[unknownOrder.id]);
  await scalar("SELECT transition_sales_order($1,'in_production')",[unknownOrder.id]);
  assert.equal(await scalar('SELECT est_total_cost FROM jobs WHERE order_id=$1',[unknownOrder.id]),null);
});
await test('Manual production batches retry once and preserve zero and missing estimates',async()=>{
  const payload=[{name:'First batch part',status:'queued',material_id:material,est_grams:0,est_time_minutes:0,est_total_cost:null,sale_price:0},{name:'Second batch part',est_total_cost:0,est_extras_cost:0}];
  const request=requestId();
  const jobs=await createJobs(payload,request);
  assert.equal(jobs.length,2);
  assert.deepEqual(await createJobs(payload,request),jobs);
  assert.equal(await scalar('SELECT count(*)::int FROM jobs WHERE creation_request_id=$1',[request]),2);
  const first=await row('SELECT tenant_id,created_by,status,est_total_cost,sale_price,est_grams FROM jobs WHERE creation_request_id=$1 AND name=$2',[request,'First batch part']);
  assert.equal(first.tenant_id,tenant);assert.equal(first.created_by,uid);assert.equal(first.status,'queued');
  assert.equal(first.est_total_cost,null);assert.equal(money(first.sale_price),0);assert.equal(money(first.est_grams),0);
  assert.equal(money(await scalar('SELECT est_total_cost FROM jobs WHERE creation_request_id=$1 AND name=$2',[request,'Second batch part'])),0);
  await rejects('SELECT create_jobs($1::jsonb,$2)',[JSON.stringify([{name:'Changed batch'}]),request],/outra operação/);
});
await test('Production batch rolls back its earlier jobs if a later reference belongs to another tenant',async()=>{
  const before=await scalar('SELECT count(*)::int FROM jobs');
  const request=requestId();
  const payload=[{name:'Must roll back',material_id:material},{name:'Invalid second job',material_id:otherMaterial}];
  await rejects('SELECT create_jobs($1::jsonb,$2)',[JSON.stringify(payload),request],/outra empresa/);
  assert.equal(await scalar('SELECT count(*)::int FROM jobs'),before);
  // A failed operation must not reserve its request id: the corrected retry can succeed.
  const corrected=payload.map(job=>({...job,material_id:material}));
  assert.equal((await createJobs(corrected,request)).length,2);
});
await test('Production creation rejects injected actuals, ownership, active states and invalid quantities',async()=>{
  const before=await scalar('SELECT count(*)::int FROM jobs');
  for(const field of [{actual_total_cost:100},{inventory_posted_at:new Date().toISOString()},{tenant_id:otherTenant},{order_id:id(9000)},{reprint_of:id(9001)}]){
    await rejects('SELECT create_jobs($1::jsonb,$2)',[JSON.stringify([{name:'Forbidden fields',...field}]),requestId()],/campos não permitidos/);
  }
  await rejects('SELECT create_jobs($1::jsonb,$2)',[JSON.stringify([{name:'Already complete',status:'completed'}]),requestId()],/rascunho ou na fila/);
  await rejects('SELECT create_jobs($1::jsonb,$2)',[JSON.stringify([{name:'Fractional minutes',est_time_minutes:1.5}]),requestId()],/inteiros/);
  await rejects('SELECT create_jobs($1::jsonb,$2)',[JSON.stringify([{name:'Invalid cost',est_total_cost:-1}]),requestId()],/não negativo/);
  await rejects('SELECT create_jobs($1::jsonb,$2)',[JSON.stringify([{name:'NaN cost',est_total_cost:'NaN'}]),requestId()],/número válido/);
  await rejects("INSERT INTO jobs(tenant_id,code,name) VALUES($1,'BYPASS-CREATE','Bypass creation')",[tenant],/row-level security/);
  assert.equal(await scalar('SELECT count(*)::int FROM jobs'),before);
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[viewerUid]);
  await rejects('SELECT create_jobs($1::jsonb,$2)',[JSON.stringify([{name:'Viewer forbidden'}]),requestId()],/permissão/);
});
await test('A printer with queued work cannot be archived and archived printers cannot receive new work',async()=>{
  const machine=await scalar("INSERT INTO printers(tenant_id,name,model,status) VALUES($1,'Archive printer','A1','idle') RETURNING id",[tenant]);
  const job=await createJob({name:'Allocated job',status:'queued',printer_id:machine});
  await rejects('UPDATE printers SET is_active=false WHERE id=$1',[machine],/ordens ativas/);
  assert.equal(await scalar('SELECT is_active FROM printers WHERE id=$1',[machine]),true);
  await db.query('DELETE FROM jobs WHERE id=$1',[job]);
  await db.query('UPDATE printers SET is_active=false WHERE id=$1',[machine]);
  await rejects('SELECT create_jobs($1::jsonb,$2)',[JSON.stringify([{name:'Archived allocation',printer_id:machine}]),requestId()],/impressora ativa/);
});
await test('A product with consignment stock can only be archived after returning the stock',async()=>{
  const payload={name:'Archive consigned product',cost_estimate:5,sale_price:20,extras:[]};
  const product=await saveProduct(payload);
  const location=await makeConsignment(product,20,2);
  await rejects('UPDATE products SET is_active=false WHERE id=$1',[product],/saldo consignado/);
  await rejects("SELECT save_product_with_photos($1,$2::jsonb,'[]'::jsonb,$3)",[product,JSON.stringify({...payload,is_active:false}),requestId()],/saldo consignado/);
  assert.equal(await scalar('SELECT is_active FROM products WHERE id=$1',[product]),true);
  await scalar("SELECT post_consignment_movement($1,'return',$2::jsonb,'Withdraw before archive',$3)",[location,JSON.stringify([{product_id:product,quantity:2,unit_price:0}]),requestId()]);
  await db.query('UPDATE products SET is_active=false WHERE id=$1',[product]);
  assert.equal(await scalar('SELECT is_active FROM products WHERE id=$1',[product]),false);
});
console.log(`Validated ${passed} PostgreSQL ERP scenarios.`);
await db.close();
if(failures.length) { console.error(`${failures.length} scenario(s) failed.`); for(const {name,error} of failures) console.error(name+'\n'+(error.stack?.split('\n').slice(0,5).join('\n') ?? error)); process.exitCode=1; }
