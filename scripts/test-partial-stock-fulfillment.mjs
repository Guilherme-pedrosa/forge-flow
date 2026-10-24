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
for (const name of (await readdir(new URL('../supabase/migrations/', import.meta.url))).filter(name => name.endsWith('.sql') && !(process.argv.includes('--baseline') && name === '20261010090000_partial_stock_fulfillment.sql')).sort()) {
  try { await db.exec((await readFile(new URL('../supabase/migrations/' + name, import.meta.url), 'utf8')).replace(/CREATE EXTENSION IF NOT EXISTS (pg_cron|pg_net);/g, '')); }
  catch (error) { throw new Error(`Migration ${name}: ${error.message}`); }
}
const id = n => `59000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
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
async function test(name, fn) { try { await fn(); passed++; console.log('PASS ' + name); } catch (error) { throw new Error(`FAIL ${name}: ${error.message}${error.where ? '\n' + error.where : ''}`); } }
const stock = p => scalar('SELECT i.current_stock FROM products p JOIN inventory_items i ON i.id=p.stock_item_id WHERE p.id=$1', [p]).then(Number);
const allocations = order => db.query('SELECT order_item_id,quantity,total_cost,sales_amount,reversed_at FROM order_stock_allocations WHERE order_id=$1 ORDER BY order_item_id', [order]).then(r => r.rows);
const asOwner = async fn => { await db.exec('RESET ROLE'); try { return await fn(); } finally { await db.exec('SET ROLE authenticated'); } };
function basket(products, fields = {}) {
  const items = products.map(([p, quantity]) => ({ product_id: p, description: 'Physical product ' + p, quantity, unit_price: 20, total: quantity * 20, material_overrides: [] }));
  const subtotal = items.reduce((sum, item) => sum + item.total, 0);
  return { order: { customer_id: customer, due_date: future, payment_due_date: future, total: subtotal + 3 - 1, discount: 1, shipping: 3, ...fields }, items };
}
const opQuantity = order => scalar('SELECT coalesce(sum(quantity),0)::int FROM production_order_items pi JOIN production_orders po ON po.id=pi.production_order_id WHERE po.source_order_id=$1', [order]);
try {
  await test('A sale retains quantity and price while ready stock reduces only its physical OP', async () => {
    const p = await product({ stock: 1 }), values = payload(p, {}, 4), result = await confirm(values);
    assert.equal(result.outcome, 'production_queued'); assert.equal(await stock(p), 0);
    const line = await row('SELECT quantity,total,unit_price FROM order_items WHERE order_id=$1', [result.order_id]);
    assert.deepEqual({ ...line, total: Number(line.total), unit_price: Number(line.unit_price) }, { quantity: 4, total: 80, unit_price: 20 });
    assert.equal(await opQuantity(result.order_id), 3);
    assert.deepEqual(await counts(result.order_id), { titles: 1, ops: 1, jobs: 2 });
    const [allocation] = await allocations(result.order_id);
    assert.ok(allocation.order_item_id); assert.equal(Number(allocation.quantity), 1); assert.equal(Number(allocation.total_cost), 5);
    assert.equal(Number(await scalar('SELECT sum(amount) FROM accounts_receivable WHERE origin_id=$1', [result.order_id])), 82);
    assert.equal(await scalar('SELECT status FROM orders WHERE id=$1', [result.order_id]), 'in_production');
  });
  await test('A fully stocked incomplete product is omitted from the OP while a second line produces its shortage', async () => {
    const stocked = await product({ ready: false, stock: 6 }), partial = await product({ stock: 2 });
    const result = await confirm(basket([[stocked, 2], [partial, 5]], { payment_schedule: [{ amount: 71, due_date: future }, { amount: 71, due_date: future }] }));
    assert.equal(result.outcome, 'production_queued'); assert.equal(await stock(stocked), 4); assert.equal(await stock(partial), 0);
    const residual = await row('SELECT product_id,quantity FROM production_order_items WHERE production_order_id=$1', [result.production_order_id]);
    assert.deepEqual(residual, { product_id: partial, quantity: 3 });
    assert.deepEqual(await counts(result.order_id), { titles: 2, ops: 1, jobs: 2 });
    assert.equal((await allocations(result.order_id)).length, 2);
  });
  await test('Repeated commercial lines share one physical balance without collision or duplicated revenue', async () => {
    const p = await product({ stock: 4 }), result = await confirm(basket([[p, 3], [p, 3]], { discount: 1.01, total: 121.99 }));
    assert.equal(result.outcome, 'production_queued'); assert.equal(await stock(p), 0); assert.equal(await opQuantity(result.order_id), 2);
    const a = await allocations(result.order_id);
    assert.deepEqual(a.map(x => Number(x.quantity)).sort(), [1, 3]);
    assert.equal(a.reduce((sum, x) => sum + Number(x.total_cost), 0), 20);
    const printRevenue = Number(await scalar('SELECT sum(sale_price) FROM jobs WHERE order_id=$1', [result.order_id]));
    assert.equal(Math.round((printRevenue + a.reduce((sum, x) => sum + Number(x.sales_amount), 0)) * 100), 11899);
    assert.equal(Number(await scalar('SELECT sum(amount) FROM accounts_receivable WHERE origin_id=$1', [result.order_id])), 121.99);
  });
  await test('Exact confirmation retry and a new confirmation never separate stock or produce the shortage twice', async () => {
    const p = await product({ stock: 1 }), values = payload(p, {}, 4), key = next(), result = await confirm(values, key);
    const before = await allocations(result.order_id);
    assert.deepEqual(await confirm(values, key), result);
    assert.equal((await confirm(null, next(), result.order_id)).outcome, 'already_organized');
    assert.deepEqual(await allocations(result.order_id), before);
    assert.equal(await stock(p), 0); assert.equal(await opQuantity(result.order_id), 3);
    assert.equal(await scalar("SELECT count(*)::int FROM inventory_movements WHERE reference_type='sales_order_stock' AND reference_id=$1", [result.order_id]), 1);
    await assert.rejects(confirm(payload(p, {}, 5), key), /Identificador já utilizado/);
  });
  await test('Missing technical preparation rolls back separation, approval and titles while preserving the draft', async () => {
    const p = await product({ ready: false, stock: 1 }), values = payload(p, {}, 4), key = next(), result = await confirm(values, key);
    assert.equal(result.outcome, 'needs_preparation'); assert.ok(result.issues.length);
    assert.equal(await stock(p), 1); assert.deepEqual(await allocations(result.order_id), []);
    assert.deepEqual(await counts(result.order_id), { titles: 0, ops: 0, jobs: 0 });
    assert.equal(await scalar('SELECT status FROM orders WHERE id=$1', [result.order_id]), 'draft');
    assert.equal(Number(await scalar('SELECT quantity FROM order_items WHERE order_id=$1', [result.order_id])), 4);
    assert.deepEqual(await confirm(values, key), result);
    await recipe(p); await asOwner(() => db.query('UPDATE products SET est_time_minutes=120 WHERE id=$1', [p]));
    const prepared = await confirm(null, next(), result.order_id);
    assert.equal(prepared.outcome, 'production_queued'); assert.equal(await stock(p), 0); assert.equal(await opQuantity(result.order_id), 3);
  });
  await test('Unexpected release failure rolls back the physical debit and all commercial side effects', async () => {
    const p = await product({ stock: 2 }), before = await scalar('SELECT count(*) FROM orders');
    await asOwner(() => db.exec("CREATE FUNCTION qa_reject_partial_job() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'QA blocked partial release'; END $$; CREATE TRIGGER qa_reject_partial_job BEFORE INSERT ON jobs FOR EACH ROW EXECUTE FUNCTION qa_reject_partial_job();"));
    try { await assert.rejects(confirm(payload(p, {}, 5)), /QA blocked partial release/); }
    finally { await asOwner(() => db.exec('DROP TRIGGER qa_reject_partial_job ON jobs; DROP FUNCTION qa_reject_partial_job();')); }
    assert.equal(await stock(p), 2); assert.equal(await scalar('SELECT count(*) FROM orders'), before);
  });
  await test('The direct full-stock action respects agreed installments and per-item allocations', async () => {
    const p = await product({ ready: false, stock: 6 }), orderId = await save(payload(p, { payment_schedule: [{ amount: 21, due_date: future }, { amount: 21, due_date: future }] }));
    await scalar('SELECT fulfill_order_from_stock($1)', [orderId]); await scalar('SELECT fulfill_order_from_stock($1)', [orderId]);
    assert.equal(await stock(p), 4); assert.deepEqual(await counts(orderId), { titles: 2, ops: 0, jobs: 0 });
    assert.ok((await allocations(orderId))[0].order_item_id);
    assert.equal(await scalar('SELECT status FROM orders WHERE id=$1', [orderId]), 'ready');
  });
  await test('The explicit whole-stock action refuses shortage without leaving a partial debit or title', async () => {
    const p = await product({ stock: 1 }), orderId = await save(payload(p));
    await assert.rejects(scalar('SELECT fulfill_order_from_stock($1)', [orderId]), /Estoque insuficiente/);
    assert.equal(await stock(p), 1); assert.deepEqual(await allocations(orderId), []);
    assert.deepEqual(await counts(orderId), { titles: 0, ops: 0, jobs: 0 });
    assert.equal(await scalar('SELECT status FROM orders WHERE id=$1', [orderId]), 'draft');
  });
  await test('A chosen color never consumes the finished stock of the base SKU', async () => {
    const p = await product({ stock: 6 }), red = next();
    await asOwner(() => db.query("INSERT INTO inventory_items(id,tenant_id,name,unit,current_stock,avg_cost,material_code,color,color_code,color_hex,material_identified_at) VALUES($1,$2,'PLA vermelho','g',10000,0.1,'PLA','Vermelho','RED','#ff0000',now())", [red, tenant]));
    const values = payload(p);
    values.items[0].material_overrides = [{ product_id: p, plate_id: null, base_item_id: material, item_id: red }];
    const result = await confirm(values);
    assert.equal(result.outcome, 'production_queued'); assert.equal(await stock(p), 6); assert.deepEqual(await allocations(result.order_id), []);
    assert.equal(await opQuantity(result.order_id), 2);
    assert.equal(await scalar('SELECT material_id FROM jobs WHERE order_id=$1 LIMIT 1', [result.order_id]), red);
  });
  await test('Stock promised to a released assembly cannot be stolen by a new sale of that part', async () => {
    const parent = await product();
    // Create a physical component explicitly; a sellable catalogue item must
    // never be silently converted just because an assembly references it.
    const membership = await scalar('SELECT save_product_subitem($1,NULL,$2::jsonb,$3)', [parent,
      JSON.stringify({ name: 'Part also sold separately', quantity_per_product: 1, initial_stock: 5, unit_cost: 5 }), next()]);
    const child = await scalar('SELECT component_product_id FROM product_subitems WHERE id=$1', [membership]);
    await asOwner(() => db.query('UPDATE products SET material_id=$2,prints_per_plate=2,est_grams=100,est_time_minutes=120,sale_price=20 WHERE id=$1', [child, material]));
    await recipe(child);
    const op = await scalar('SELECT request_stock_production($1::jsonb,NULL,NULL,$2)', [JSON.stringify([{ product_id: parent, quantity: 4 }]), next()]);
    await scalar('SELECT release_production_order($1)', [op]);
    const result = await confirm(payload(child, {}, 3));
    assert.equal(result.outcome, 'production_queued'); assert.equal(await stock(child), 4); assert.equal(await opQuantity(result.order_id), 2);
    assert.equal(Number((await allocations(result.order_id))[0].quantity), 1);
  });
  await test('Canceling before print restores separated stock at frozen cost and reverses installments once', async () => {
    const p = await product({ stock: 1 }), result = await confirm(payload(p, { payment_schedule: [{ amount: 41, due_date: future }, { amount: 41, due_date: future }] }, 4));
    const before = (await allocations(result.order_id))[0];
    await scalar("SELECT transition_sales_order($1,'cancelled')", [result.order_id]);
    await scalar("SELECT transition_sales_order($1,'cancelled')", [result.order_id]);
    assert.equal(await stock(p), 1);
    assert.equal(Number((await allocations(result.order_id))[0].total_cost), Number(before.total_cost));
    assert.ok((await allocations(result.order_id))[0].reversed_at);
    assert.equal(await scalar("SELECT count(*)::int FROM accounts_receivable WHERE origin_id=$1 AND status='reversed'", [result.order_id]), 2);
    assert.equal(await scalar("SELECT count(*)::int FROM inventory_movements WHERE reference_type='sales_order_stock_reversal' AND reference_id=$1", [result.order_id]), 1);
    assert.equal(await scalar('SELECT status FROM production_orders WHERE id=$1', [result.production_order_id]), 'cancelled');
    const j = await scalar('SELECT id FROM jobs WHERE order_id=$1 LIMIT 1', [result.order_id]);
    await assert.rejects(scalar("SELECT transition_job($1,'printing',NULL,NULL,NULL,NULL,$2)", [j, printer]), /cancelad/);
  });
  await test('An already-started mixed order cannot reverse allocated stock as if no work occurred', async () => {
    const p = await product({ stock: 1 }), result = await confirm(payload(p, {}, 4));
    const j = await scalar('SELECT id FROM jobs WHERE order_id=$1 ORDER BY code LIMIT 1', [result.order_id]);
    await scalar("SELECT transition_job($1,'printing',NULL,NULL,NULL,NULL,$2)", [j, printer]);
    await assert.rejects(scalar("SELECT transition_sales_order($1,'cancelled')", [result.order_id]), /produção iniciada/);
    assert.equal(await stock(p), 0); assert.equal((await allocations(result.order_id))[0].reversed_at, null);
    assert.equal(await scalar('SELECT status FROM orders WHERE id=$1', [result.order_id]), 'in_production');
    await scalar("SELECT transition_job($1,'failed',100,60,0,'QA closes the started fixture',NULL,NULL,0,0,0)", [j]);
  });
  await test('A green print status with insufficient approved units does not mark a mixed order ready', async () => {
    const p = await product({ stock: 1 }), result = await confirm(payload(p, {}, 4));
    // Isolated fixture emulates QC data; it does not claim a physical printer measurement.
    await asOwner(() => db.query("UPDATE jobs SET status='ready',produced_quantity=1,inventory_posted_at=now(),actual_total_cost=10 WHERE order_id=$1", [result.order_id]));
    await assert.rejects(scalar("SELECT transition_sales_order($1,'ready')", [result.order_id]), /quantidade aprovada/);
    assert.equal(await scalar('SELECT status FROM orders WHERE id=$1', [result.order_id]), 'in_production');
    await asOwner(() => db.query('UPDATE jobs SET produced_quantity=2 WHERE order_id=$1', [result.order_id]));
    await scalar("SELECT transition_production_order($1,'completed')", [result.production_order_id]);
    assert.equal(await scalar('SELECT status FROM orders WHERE id=$1', [result.order_id]), 'ready');
    assert.equal(await stock(p), 0);
    assert.equal(Number(await scalar('SELECT sum(amount) FROM accounts_receivable WHERE origin_id=$1', [result.order_id])), 82);
  });
  await test('Accepted quote quantities, commercial snapshots and prices survive residual OP planning', async () => {
    const p = await product({ stock: 1 }), values = payload(p, { valid_until: future }, 4);
    const q = await scalar('SELECT save_sales_quote(NULL,$1::jsonb,$2::jsonb,$3)', [JSON.stringify(values.order), JSON.stringify(values.items), next()]);
    await scalar("SELECT transition_sales_quote($1,'issued')", [q]); await scalar("SELECT transition_sales_quote($1,'approved')", [q]);
    const orderId = await scalar('SELECT convert_sales_quote($1,$2)', [q, next()]);
    const before = await row('SELECT quantity,total,product_snapshot,source_quote_item_id FROM order_items WHERE order_id=$1', [orderId]);
    const result = await confirm(null, next(), orderId);
    assert.equal(result.outcome, 'production_queued'); assert.equal(await opQuantity(orderId), 3);
    assert.deepEqual(await row('SELECT quantity,total,product_snapshot,source_quote_item_id FROM order_items WHERE order_id=$1', [orderId]), before);
    assert.equal(Number(await scalar('SELECT quantity FROM sales_quote_items WHERE quote_id=$1', [q])), 4);
  });
  await test('Two sequential sales of the same stock cannot each allocate the original balance', async () => {
    const p = await product({ stock: 3 }), first = await confirm(payload(p, {}, 4)), second = await confirm(payload(p, {}, 4));
    assert.equal(Number((await allocations(first.order_id))[0].quantity), 3); assert.deepEqual(await allocations(second.order_id), []);
    assert.equal(await opQuantity(first.order_id), 1); assert.equal(await opQuantity(second.order_id), 4); assert.equal(await stock(p), 0);
  });
  await test('Cross-tenant references, viewer writes and direct private allocation access remain denied', async () => {
    const p = await product({ stock: 1 }), values = payload(p, {}, 4), orderId = await save(values);
    await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [other]);
    await assert.rejects(confirm(null, next(), orderId), /não encontrado/);
    await assert.rejects(scalar('SELECT fulfill_order_from_stock($1)', [orderId]), /não encontrado/);
    assert.equal(await scalar('SELECT count(*)::int FROM order_stock_allocations WHERE order_id=$1', [orderId]), 0);
    await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [viewer]);
    await assert.rejects(confirm(null, next(), orderId), /permissão/);
    await assert.rejects(scalar('SELECT fulfill_order_from_stock($1)', [orderId]), /permissão/);
    await assert.rejects(scalar('SELECT erp_private.allocate_sales_order_stock($1,$2)', [orderId, tenant]), /permission denied/);
    await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [owner]);
    assert.equal(await stock(p), 1); assert.deepEqual(await counts(orderId), { titles: 0, ops: 0, jobs: 0 });
  });
  await test('A mixed kit requires every approved component rather than enough unrelated green units', async () => {
    const large = await product(), small = await product();
    const kit = await scalar("SELECT save_product_with_photos(NULL,$1::jsonb,'[]'::jsonb,$2)", [JSON.stringify({ name: 'Partial-stock kit ' + sequence, category: 'kit', sale_price: 20, extras: [{ _kit_product_id: large, _kit_qty: 1, cost: 1 }, { _kit_product_id: small, _kit_qty: 2, cost: 1 }], stock: { current_stock: 1, unit: 'un', avg_cost: 5 } }), next()]);
    const result = await confirm(payload(kit, {}, 3));
    assert.equal(result.outcome, 'production_queued'); assert.equal(await opQuantity(result.order_id), 2);
    await asOwner(() => db.query("UPDATE jobs SET status='ready',produced_quantity=CASE WHEN product_id=$2 THEN 4 ELSE 1 END,inventory_posted_at=now(),actual_total_cost=10 WHERE order_id=$1", [result.order_id, large]));
    await assert.rejects(scalar("SELECT transition_sales_order($1,'ready')", [result.order_id]), /quantidade aprovada/);
    await asOwner(() => db.query('UPDATE jobs SET produced_quantity=2 WHERE order_id=$1 AND product_id=$2', [result.order_id, small]));
    await scalar("SELECT transition_production_order($1,'completed')", [result.production_order_id]);
    assert.equal(await scalar('SELECT status FROM orders WHERE id=$1', [result.order_id]), 'ready');
  });
  await test('A partially stocked assembled product reserves and assembles only the residual finished units', async () => {
    const parent = await product({ stock: 1 });
    const membership = await scalar('SELECT save_product_subitem($1,NULL,$2::jsonb,$3)', [parent,
      JSON.stringify({ name: 'Residual assembly part', quantity_per_product: 2, initial_stock: 5, unit_cost: 5 }), next()]);
    const child = await scalar('SELECT component_product_id FROM product_subitems WHERE id=$1', [membership]);
    const result = await confirm(payload(parent, {}, 3));
    assert.equal(result.outcome, 'production_queued'); assert.deepEqual(await counts(result.order_id), { titles: 1, ops: 1, jobs: 0 });
    const pi = await scalar('SELECT id FROM production_order_items WHERE production_order_id=$1', [result.production_order_id]);
    assert.equal(await opQuantity(result.order_id), 2);
    await assert.rejects(scalar("SELECT transition_production_order($1,'completed')", [result.production_order_id]), /montagem/);
    await scalar("SELECT assemble_product($1,2,$2,0,'Residual assembly confirmed',$3)", [parent, pi, next()]);
    await scalar("SELECT transition_production_order($1,'completed')", [result.production_order_id]);
    assert.equal(await scalar('SELECT status FROM orders WHERE id=$1', [result.order_id]), 'ready');
    assert.equal(await stock(parent), 0); assert.equal(await stock(child), 1);
    assert.equal(Number(await scalar('SELECT quantity FROM order_items WHERE order_id=$1', [result.order_id])), 3);
  });
  const apportion = async job => {
    await scalar("SELECT transition_job($1,'printing',NULL,NULL,NULL,NULL,$2)", [job, printer]);
    await scalar("SELECT transition_job($1,'quality_check',100,60,0,NULL,NULL,NULL,0,0,0)", [job]);
  };
  const quality = (job, quantity, reason = null, key = next()) => scalar('SELECT confirm_finished_output($1,$2,$3,$4)', [job, quantity, reason, key]);
  await test('Manual QC closes a mixed sale through public operations and never reposts filament or finance', async () => {
    const p = await product({ stock: 1 }), result = await confirm(payload(p, {}, 4));
    const jobs = (await db.query('SELECT id FROM jobs WHERE order_id=$1 ORDER BY code', [result.order_id])).rows;
    await apportion(jobs[0].id); await quality(jobs[0].id, 2);
    await apportion(jobs[1].id);
    const before = Number(await scalar('SELECT current_stock FROM inventory_items WHERE id=$1', [material]));
    const key = next(); await quality(jobs[1].id, 1, 'One piece rejected; existing good units cover the sale', key);
    await quality(jobs[1].id, 1, 'One piece rejected; existing good units cover the sale', key);
    assert.equal(Number(await scalar('SELECT current_stock FROM inventory_items WHERE id=$1', [material])), before);
    assert.equal(await scalar('SELECT status FROM orders WHERE id=$1', [result.order_id]), 'ready');
    assert.deepEqual(await counts(result.order_id), { titles: 1, ops: 1, jobs: 2 });
    assert.equal(await scalar("SELECT count(*)::int FROM audit_log WHERE record_id=$1 AND action='finished_quality'", [jobs[1].id]), 1);
  });
  await test('Partial QC schedules only an uncovered replacement from the frozen plate and retries once', async () => {
    const p = await product({ stock: 1 }), result = await confirm(payload(p, {}, 4));
    const jobs = (await db.query('SELECT id FROM jobs WHERE order_id=$1 ORDER BY code', [result.order_id])).rows;
    await apportion(jobs[0].id); await quality(jobs[0].id, 1, 'One dimensional rejection');
    assert.equal(await scalar('SELECT count(*)::int FROM jobs WHERE reprint_of=$1', [jobs[0].id]), 0);
    await apportion(jobs[1].id);
    const key = next(); await quality(jobs[1].id, 1, 'One dimensional rejection', key); await quality(jobs[1].id, 1, 'One dimensional rejection', key);
    assert.equal(await scalar('SELECT status FROM orders WHERE id=$1', [result.order_id]), 'in_production');
    const replacement = await row('SELECT id,planned_quantity,production_snapshot,production_order_item_id,sale_price,status FROM jobs WHERE reprint_of=$1', [jobs[1].id]);
    assert.equal(replacement.planned_quantity, 2); assert.equal(Number(replacement.sale_price), 0); assert.equal(replacement.status, 'reprint');
    assert.deepEqual(replacement.production_snapshot, await scalar('SELECT production_snapshot FROM jobs WHERE id=$1', [jobs[1].id]));
    assert.equal(await scalar('SELECT count(*)::int FROM jobs WHERE reprint_of=$1', [jobs[1].id]), 1);
    await scalar("SELECT transition_job($1,'queued')", [replacement.id]); await apportion(replacement.id); await quality(replacement.id, 2);
    assert.equal(await scalar('SELECT status FROM orders WHERE id=$1', [result.order_id]), 'ready');
    assert.equal(await opQuantity(result.order_id), 3); assert.equal(await stock(p), 0);
    await assert.rejects(quality(jobs[1].id, 2, 'Changed result', key), /Identificador já utilizado/);
  });
  await test('Manual quantity approval rejects unmeasured work, excessive units, missing reason and forbidden roles', async () => {
    const p = await product({ stock: 1 }), result = await confirm(payload(p, {}, 2));
    const j = await scalar('SELECT id FROM jobs WHERE order_id=$1', [result.order_id]);
    await assert.rejects(quality(j, 1), /execução e seus custos/);
    await apportion(j);
    await assert.rejects(quality(j, 3), /quantidade boa inteira/); await assert.rejects(quality(j, 0), /quantidade boa inteira/); await assert.rejects(quality(j, 1), /motivo/);
    assert.equal(await scalar('SELECT produced_quantity FROM jobs WHERE id=$1', [j]), null);
    await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [viewer]);
    await assert.rejects(quality(j, 2), /permissão/);
    await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [other]);
    await assert.rejects(quality(j, 2), /execução e seus custos/);
    await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [owner]);
    await quality(j, 2);
  });
  await test('A failed final quantity validation rolls QC back without rewriting the consumed ledger', async () => {
    const p = await product({ stock: 1 }), result = await confirm(payload(p, {}, 2));
    const j = await scalar('SELECT id FROM jobs WHERE order_id=$1', [result.order_id]); await apportion(j);
    const before = await row('SELECT actual_grams,actual_total_cost,inventory_posted_at,produced_quantity FROM jobs WHERE id=$1', [j]);
    await asOwner(() => db.exec("CREATE FUNCTION qa_reject_partial_ready() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.status='ready' THEN RAISE EXCEPTION 'QA rejects final readiness'; END IF; RETURN NEW; END $$; CREATE TRIGGER qa_reject_partial_ready BEFORE UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION qa_reject_partial_ready();"));
    try { await assert.rejects(quality(j, 2), /QA rejects final readiness/); }
    finally { await asOwner(() => db.exec('DROP TRIGGER qa_reject_partial_ready ON orders; DROP FUNCTION qa_reject_partial_ready();')); }
    assert.deepEqual(await row('SELECT actual_grams,actual_total_cost,inventory_posted_at,produced_quantity FROM jobs WHERE id=$1', [j]), before);
    assert.equal(await scalar('SELECT status FROM jobs WHERE id=$1', [j]), 'quality_check');
    await quality(j, 2);
  });
  console.log(`${passed} isolated partial-stock fulfillment scenarios passed.`);
} finally { await db.close(); }
