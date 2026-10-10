import { PGlite } from '@electric-sql/pglite';
import { readdir, readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

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
for (const name of (await readdir(new URL('../supabase/migrations/', import.meta.url))).filter(name => name.endsWith('.sql') && !(process.argv.includes('--baseline') && name === '20261010110000_stock_identity_and_cancelled_supply.sql')).sort()) {
  try { await db.exec((await readFile(new URL('../supabase/migrations/' + name, import.meta.url), 'utf8')).replace(/CREATE EXTENSION IF NOT EXISTS (pg_cron|pg_net);/g, '')); }
  catch (error) { throw new Error(`Migration ${name}: ${error.message}`); }
}
const id = n => `61000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const tenant = id(1), otherTenant = id(2), owner = id(3), other = id(4), viewer = id(5), material = id(6), printer = id(7);
let sequence = 100, passed = 0;
const next = () => id(sequence++);
const scalar = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0])[0];
const row = async (sql, args = []) => (await db.query(sql, args)).rows[0];
await db.query("INSERT INTO auth.users VALUES($1,'owner@qa.invalid'),($2,'other@qa.invalid'),($3,'viewer@qa.invalid')", [owner, other, viewer]);
await db.query("INSERT INTO tenants(id,name,slug) VALUES($1,'Sales QA','sales-qa'),($2,'Other QA','other-sales-qa')", [tenant, otherTenant]);
await db.query('UPDATE tenants SET settings=$2::jsonb WHERE id=$1', [tenant, JSON.stringify({ energy_cost_kwh: 1 })]);
await db.query("INSERT INTO profiles(user_id,tenant_id,display_name) VALUES($1,$4,'Owner'),($2,$5,'Other'),($3,$4,'Viewer')", [owner, other, viewer, tenant, otherTenant]);
await db.query("INSERT INTO user_roles(user_id,tenant_id,role) VALUES($1,$4,'owner'),($2,$5,'owner'),($3,$4,'viewer')", [owner, other, viewer, tenant, otherTenant]);
await db.query("INSERT INTO printers(id,tenant_id,name,model,status) VALUES($1,$2,'Sales QA printer','A1','idle')", [printer, tenant]);
await db.query("INSERT INTO inventory_items(id,tenant_id,name,unit,current_stock,avg_cost,material_code,color,color_code,color_hex,material_identified_at) VALUES($1,$2,'PLA preto','g',10000,0.1,'PLA','Preto','BLACK','#000000',now())", [material, tenant]);
const customer = await scalar("INSERT INTO customers(tenant_id,name) VALUES($1,'Sales customer') RETURNING id", [tenant]);
const foreignCustomer = await scalar("INSERT INTO customers(tenant_id,name) VALUES($1,'Foreign customer') RETURNING id", [otherTenant]);
await db.exec('SET ROLE authenticated');
await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [owner]);
const future = await scalar("SELECT (CURRENT_DATE+30)::text");
async function product({ ready = true, stock = null } = {}) {
  const p = await scalar("SELECT save_product_with_photos(NULL,$1::jsonb,'[]'::jsonb,$2)", [JSON.stringify({ name: 'Workflow product ' + sequence, category: 'printed_part', material_id: material, prints_per_plate: 2, est_grams: 100, est_time_minutes: ready ? 120 : 0, cost_estimate: 5, sale_price: 20, ...(stock === null ? {} : { stock: { current_stock: stock, unit: 'un', avg_cost: 5 } }) }), next()]);
  if (ready) await recipe(p);
  return p;
}
const recipe = p => scalar("SELECT save_product_material_recipe($1,NULL,'per_unit',$2::jsonb,'Reviewed recipe',$3,1)", [p, JSON.stringify([{ item_id: material, grams: 50 }]), next()]);
const payload = (p, fields = {}, quantity = 2) => ({
  order: { customer_id: customer, due_date: future, payment_due_date: future, total: quantity * 20 + 3 - 1, discount: 1, shipping: 3, notes: 'Accepted price and delivery', ...fields },
  items: [{ product_id: p, description: 'Reviewed printed product', quantity, unit_price: 20, total: quantity * 20, notes: 'Customer choice', material_overrides: [] }],
});
const confirm = (p, request = next(), orderId = null) => scalar('SELECT confirm_sales_workflow($1,$2::jsonb,$3::jsonb,$4)', [orderId, p ? JSON.stringify(p.order) : null, p ? JSON.stringify(p.items) : null, request]);
const save = p => scalar('SELECT save_sales_order(NULL,$1::jsonb,$2::jsonb,$3)', [JSON.stringify(p.order), JSON.stringify(p.items), next()]);
const counts = orderId => row(`SELECT (SELECT count(*)::int FROM accounts_receivable WHERE origin_id=$1 AND origin_type='order') titles,
  (SELECT count(*)::int FROM production_orders WHERE source_order_id=$1) ops,
  (SELECT count(*)::int FROM jobs WHERE order_id=$1) jobs`, [orderId]);
let failed=0; async function test(name,fn){try{await fn();passed++;console.log('PASS '+name);}catch(error){failed++;console.error('FAIL '+name+': '+error.message+(error.where?'\n'+error.where:''));}}
const stock = p => scalar('SELECT i.current_stock FROM products p JOIN inventory_items i ON i.id=p.stock_item_id WHERE p.id=$1', [p]).then(Number);
const allocations = order => db.query('SELECT order_item_id,quantity,total_cost,sales_amount,reversed_at FROM order_stock_allocations WHERE order_id=$1 ORDER BY order_item_id', [order]).then(r => r.rows);
const asOwner = async fn => { await db.exec('RESET ROLE'); try { return await fn(); } finally { await db.exec('SET ROLE authenticated'); } };
function basket(products, fields = {}) {
  const items = products.map(([p, quantity]) => ({ product_id: p, description: 'Physical product ' + p, quantity, unit_price: 20, total: quantity * 20, material_overrides: [] }));
  const subtotal = items.reduce((sum, item) => sum + item.total, 0);
  return { order: { customer_id: customer, due_date: future, payment_due_date: future, total: subtotal + 3 - 1, discount: 1, shipping: 3, ...fields }, items };
}
const opQuantity = order => scalar('SELECT coalesce(sum(quantity),0)::int FROM production_order_items pi JOIN production_orders po ON po.id=pi.production_order_id WHERE po.source_order_id=$1', [order]);

const stockOrder=async(p,q=1,overrides=[])=>{const op=await scalar('SELECT request_stock_production($1::jsonb,NULL,NULL,$2)',[JSON.stringify([{product_id:p,quantity:q,material_overrides:overrides}]),next()]);return {op,item:await scalar('SELECT id FROM production_order_items WHERE production_order_id=$1',[op])};};
const makeKit=async(parts)=>scalar("SELECT save_product_with_photos(NULL,$1::jsonb,'[]'::jsonb,$2)",[JSON.stringify({name:'Kit de três peças',category:'kit',sale_price:60,extras:parts.map(([p,q])=>({_kit_product_id:p,_kit_qty:q}))}),next()]);
// Only the already-posted execution state is a fixture. QC, release, cancel and
// receiving below use the real public RPCs in an isolated database.
const qualityFixture=async(job,produced=null)=>asOwner(()=>db.query("UPDATE jobs SET status='quality_check',inventory_posted_at=now(),actual_total_cost=12,actual_grams=100,actual_time_minutes=60,produced_quantity=coalesce($2,planned_quantity) WHERE id=$1",[job,produced]));
const addPart=(p,data)=>scalar('SELECT save_product_subitem($1,NULL,$2::jsonb,$3)',[p,JSON.stringify(data),next()]);
const makePlate=async(p,index=1)=>{const pl=await scalar('SELECT save_product_print_plate(NULL,$1,NULL,$2::jsonb)',[p,JSON.stringify({plate_index:index,label:'Placa '+index,units_per_plate:1,printer_id:printer,material_id:material,est_grams:100,est_time_seconds:3600})]);await scalar("SELECT save_product_material_recipe($1,$2,'per_print',$3::jsonb,NULL,$4,0)",[p,pl,JSON.stringify([{item_id:material,grams:100}]),next()]);return pl;};
const red=next();await asOwner(()=>db.query("INSERT INTO inventory_items(id,tenant_id,name,unit,current_stock,avg_cost,material_code,color,color_code,color_hex,material_identified_at) VALUES($1,$2,'PLA Vermelho','g',10000,0.1,'PLA','Vermelho','RED','#ff0000',now())",[red,tenant]));
const variant=p=>[{product_id:p,plate_id:null,base_item_id:material,item_id:red}];
const jobs=op=>db.query('SELECT * FROM jobs WHERE production_order_id=$1 ORDER BY code',[op]).then(x=>x.rows);
const good=(j,n=j.planned_quantity,key=next())=>scalar('SELECT confirm_finished_output($1,$2,NULL,$3)',[j.id,n,key]);
let kit,kitOp;
await test('Stock kit preflight rejects piece counts as complete commercial kits before printing',async()=>{
 const leaf=await product();kit=await makeKit([[leaf,3]]);kitOp=await stockOrder(kit);
 const review=await scalar('SELECT production_order_preflight($1)',[kitOp.op]);assert.equal(review.ready,false);assert.match(review.items[0].issues.join(' '),/Kit comercial.*peças impressas/);
 await assert.rejects(scalar('SELECT release_production_order($1)',[kitOp.op]),/Kit comercial/);assert.equal((await jobs(kitOp.op)).length,0);assert.equal(await scalar('SELECT received_quantity FROM production_order_items WHERE id=$1',[kitOp.item]),0);
});
await test('Already released historical stock kit cannot receive four pieces as four kits',async()=>{
 const snapshot=(await scalar('SELECT product_material_variant_preview($1)',[kit])).snapshot;
 // Reproduce an OP released under the old schema, without calling an unsafe
 // old RPC from an authenticated client.
 await asOwner(async()=>{await db.query("UPDATE production_order_items SET production_snapshot=$2::jsonb WHERE id=$1",[kitOp.item,JSON.stringify(snapshot)]);await db.query("UPDATE production_orders SET status='released' WHERE id=$1",[kitOp.op]);await db.query(`INSERT INTO jobs(tenant_id,code,name,status,product_id,planned_quantity,material_id,printer_id,production_order_id,production_order_item_id,production_snapshot)
 SELECT $1,erp_private.next_code($1,'OI'),plan->>'name','queued',(plan->>'product_id')::uuid,(plan->>'quantity')::int,(plan->>'material_id')::uuid,$4,$2,$3,plan->'snapshot' FROM erp_private.frozen_job_plan($5::jsonb,1) plan`,[tenant,kitOp.op,kitOp.item,printer,JSON.stringify(snapshot)]);});
 for(const j of await jobs(kitOp.op)){await qualityFixture(j.id);await good(j);}
 const before=await scalar('SELECT count(*)::int FROM inventory_movements');await assert.rejects(scalar("SELECT transition_production_order($1,'completed')",[kitOp.op]),/Kit comercial/);
 assert.equal(await scalar('SELECT status FROM production_orders WHERE id=$1',[kitOp.op]),'released');assert.equal(await scalar('SELECT received_quantity FROM production_order_items WHERE id=$1',[kitOp.item]),0);assert.equal(await scalar('SELECT count(*)::int FROM inventory_movements'),before);
});
await test('Material-color variant OP cannot release into the base product stock',async()=>{
 const p=await product({stock:0}),x=await stockOrder(p,2,variant(p)),review=await scalar('SELECT production_order_preflight($1)',[x.op]);assert.equal(review.ready,false);assert.match(review.items[0].issues.join(' '),/SKU e estoque próprios/);
 await assert.rejects(scalar('SELECT release_production_order($1)',[x.op]),/SKU e estoque próprios/);assert.equal(await stock(p),0);assert.equal((await jobs(x.op)).length,0);
});
await test('Execution material changed after release cannot bypass the finished stock identity guard',async()=>{
 const p=await product({stock:0}),x=await stockOrder(p,2);await scalar('SELECT release_production_order($1)',[x.op]);const [j]=await jobs(x.op),snapshot=(await scalar('SELECT product_material_variant_preview($1,$2::jsonb)',[p,JSON.stringify(variant(p))])).snapshot;
 await asOwner(()=>db.query('UPDATE jobs SET material_selection_snapshot=$2::jsonb,material_id=$3 WHERE id=$1',[j.id,JSON.stringify(snapshot),red]));await qualityFixture(j.id);await good(j);
 await assert.rejects(scalar("SELECT transition_production_order($1,'completed')",[x.op]),/SKU e estoque próprios/);assert.equal(await stock(p),0);assert.equal(await scalar('SELECT received_quantity FROM production_order_items WHERE id=$1',[x.item]),0);assert.equal(await scalar('SELECT status FROM production_orders WHERE id=$1',[x.op]),'released');
});
await test('A separately registered red SKU receives its own approved quantity and cost exactly once',async()=>{
 const p=await product({stock:0});await scalar("SELECT save_product_material_recipe($1,NULL,'per_unit',$2::jsonb,'SKU vermelho',$3,1)",[p,JSON.stringify([{item_id:red,grams:50}]),next()]);const x=await stockOrder(p,2),review=await scalar('SELECT production_order_preflight($1)',[x.op]);assert.equal(review.ready,true);await scalar('SELECT release_production_order($1)',[x.op]);const [j]=await jobs(x.op);assert.equal(j.material_id,red);await qualityFixture(j.id);await good(j);await scalar("SELECT transition_production_order($1,'completed')",[x.op]);await scalar("SELECT transition_production_order($1,'completed')",[x.op]);assert.equal(await stock(p),2);assert.equal(await scalar("SELECT count(*)::int FROM inventory_movements WHERE reference_type='production_order_item' AND reference_id=$1",[x.item]),1);assert.equal(Number(await scalar('SELECT total_cost FROM inventory_movements WHERE reference_id=$1',[x.item])),12);
});
await test('Cancelling a sale excludes its queued mixed plate from pending supply and preserves history',async()=>{
 const p=await product(),pl=await makePlate(p);await addPart(p,{name:'Base',quantity_per_product:1,plate_id:pl,quantity_per_plate:5});const sale=await confirm(payload(p,{},5));assert.equal(sale.outcome,'production_queued');const [old]=await jobs(sale.production_order_id);
 await scalar("SELECT transition_sales_order($1,'cancelled')",[sale.order_id]);const status=await scalar('SELECT assembly_product_status($1,5,NULL)',[p]);assert.equal(status.components[0].pending,0);assert.equal(status.components[0].to_print,5);
 const x=await stockOrder(p,5),review=await scalar('SELECT production_order_preflight($1)',[x.op]);assert.equal(review.ready,true);assert.equal(review.items[0].jobs,1);await scalar('SELECT release_production_order($1)',[x.op]);assert.equal((await jobs(x.op)).length,1);
 assert.equal(await scalar('SELECT status FROM jobs WHERE id=$1',[old.id]),'queued');await assert.rejects(scalar("SELECT transition_job($1,'printing',NULL,NULL,NULL,NULL,$2)",[old.id,printer]),/cancelad/);
 const before=await scalar('SELECT count(*)::int FROM jobs');await scalar('SELECT release_production_order($1)',[x.op]);assert.equal(await scalar('SELECT count(*)::int FROM jobs'),before);
});
await test('Cancelled legacy plate sets no longer promise supply or suppress replacement planning',async()=>{
 const p=await product();await makePlate(p);await scalar('SELECT configure_product_assembly($1,true)',[p]);
 assert.equal(await scalar('SELECT component_inventory_mode FROM products WHERE id=$1',[p]),false);
 const sale=await confirm(payload(p,{},5));assert.equal(sale.outcome,'production_queued');assert.equal((await jobs(sale.production_order_id)).length,5);
 await scalar("SELECT transition_sales_order($1,'cancelled')",[sale.order_id]);const status=await scalar('SELECT assembly_product_status($1,5,NULL)',[p]);assert.equal(status.individual_stock,undefined);assert.equal(status.components[0].pending,0);assert.equal(status.components[0].to_print,5);
 const x=await stockOrder(p,5),review=await scalar('SELECT production_order_preflight($1)',[x.op]);assert.equal(review.ready,true);assert.equal(review.items[0].jobs,5);await scalar('SELECT release_production_order($1)',[x.op]);assert.equal((await jobs(x.op)).length,5);
});
await test('Active shared pending output continues to cover another OP without duplicate printing',async()=>{
 const p=await product(),pl=await makePlate(p);await addPart(p,{name:'Tampa',quantity_per_product:1,plate_id:pl,quantity_per_plate:5});const first=await stockOrder(p,3);await scalar('SELECT release_production_order($1)',[first.op]);const second=await stockOrder(p,2),review=await scalar('SELECT production_order_preflight($1)',[second.op]);assert.equal(review.ready,true);assert.equal(review.items[0].jobs,0);assert.equal((await scalar('SELECT assembly_product_status($1,2,NULL)',[p])).components[0].pending,5);
});
await test('Five approved of six required creates one replacement and prevents premature receiving',async()=>{
 const p=await product({stock:0}),x=await stockOrder(p,6);await scalar('SELECT release_production_order($1)',[x.op]);const initial=await jobs(x.op);
 for(const [index,j] of initial.entries()){const n=index===initial.length-1?1:j.planned_quantity;await qualityFixture(j.id,n);const key=next();await good(j,n,key);await good(j,n,key);}
 const all=await jobs(x.op),replacement=all.filter(j=>j.reprint_of);assert.equal(replacement.length,1);assert.equal(replacement[0].planned_quantity,2);assert.equal(Number(replacement[0].sale_price),0);assert.equal(await stock(p),0);await assert.rejects(scalar("SELECT transition_production_order($1,'completed')",[x.op]),/Conclua/);
 await asOwner(()=>db.query("UPDATE jobs SET status='queued' WHERE id=$1",[replacement[0].id]));await qualityFixture(replacement[0].id,1);await good(replacement[0],1);await scalar("SELECT transition_production_order($1,'completed')",[x.op]);assert.equal(await stock(p),6);assert.equal((await jobs(x.op)).filter(j=>j.reprint_of).length,1);
});
await test('Five approved cover five required even when physical plate capacity was six',async()=>{
 const p=await product({stock:0}),x=await stockOrder(p,5);await scalar('SELECT release_production_order($1)',[x.op]);const initial=await jobs(x.op);assert.equal(initial.reduce((s,j)=>s+j.planned_quantity,0),6);
 for(const [index,j] of initial.entries()){const n=index===initial.length-1?1:j.planned_quantity;await qualityFixture(j.id,n);await good(j,n);}
 assert.equal((await jobs(x.op)).filter(j=>j.reprint_of).length,0);await scalar("SELECT transition_production_order($1,'completed')",[x.op]);assert.equal(await stock(p),5);
});
await test('Quality retry with altered count and a late failure remain atomic',async()=>{
 const p=await product({stock:0}),x=await stockOrder(p,2);await scalar('SELECT release_production_order($1)',[x.op]);const [j]=await jobs(x.op);await qualityFixture(j.id);const key=next();await scalar("SELECT confirm_finished_output($1,1,'Quebra',$2)",[j.id,key]);await assert.rejects(scalar("SELECT confirm_finished_output($1,2,NULL,$2)",[j.id,key]),/Identificador já utilizado/);
 const before=await scalar('SELECT count(*)::int FROM inventory_movements');await assert.rejects(scalar("SELECT transition_production_order($1,'completed')",[x.op]),/Conclua/);assert.equal(await stock(p),0);assert.equal(await scalar('SELECT count(*)::int FROM inventory_movements'),before);
});
await test('Stock identity preflight and guard do not permit tenant, viewer or private helper bypass',async()=>{
 await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[other]);await assert.rejects(scalar('SELECT production_order_preflight($1)',[kitOp.op]),/não encontrada/);
 await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[viewer]);await assert.rejects(scalar("SELECT transition_production_order($1,'completed')",[kitOp.op]),/permissão/);
 await assert.rejects(scalar('SELECT erp_private.product_bom_snapshot($1,$2)',[kit,tenant]),/permission denied/);
 if(!process.argv.includes('--baseline')){await assert.rejects(scalar("SELECT erp_private.finished_stock_identity_issues('{}')"),/permission denied/);await assert.rejects(scalar('SELECT erp_private.job_has_active_source($1,NULL,NULL)',[tenant]),/permission denied/);await assert.rejects(scalar('SELECT erp_private.production_preflight_before_stock_identity($1)',[kitOp.op]),/permission denied/);}
 await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[owner]);
});
console.log(`${passed} passed; ${failed} failed${process.argv.includes('--baseline')?' against pre-1100 baseline':''}`);
await db.close();if(failed)process.exitCode=1;
