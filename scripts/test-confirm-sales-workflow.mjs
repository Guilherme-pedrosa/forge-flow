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
for (const name of (await readdir(new URL('../supabase/migrations/', import.meta.url))).filter(name => name.endsWith('.sql')).sort()) {
  try { await db.exec((await readFile(new URL('../supabase/migrations/' + name, import.meta.url), 'utf8')).replace(/CREATE EXTENSION IF NOT EXISTS (pg_cron|pg_net);/g, '')); }
  catch (error) { throw new Error(`Migration ${name}: ${error.message}`); }
}
const id = n => `50000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const tenant = id(1), otherTenant = id(2), owner = id(3), other = id(4), viewer = id(5), material = id(6), printer = id(7);
let sequence = 100, passed = 0;
const next = () => id(sequence++);
const scalar = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0])[0];
const row = async (sql, args = []) => (await db.query(sql, args)).rows[0];
await db.query("INSERT INTO auth.users VALUES($1,'owner@qa.invalid'),($2,'other@qa.invalid'),($3,'viewer@qa.invalid')", [owner, other, viewer]);
await db.query("INSERT INTO tenants(id,name,slug) VALUES($1,'Sales QA','sales-qa'),($2,'Other QA','other-sales-qa')", [tenant, otherTenant]);
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
async function test(name, fn) { await fn(); passed++; console.log('PASS ' + name); }
try {
  await test('Prepared sale queues once and exact retry returns the same receipt', async () => {
    const p = await product(), values = payload(p), request = next();
    const result = await confirm(values, request);
    assert.equal(result.outcome, 'production_queued'); assert.ok(result.production_order_id);
    assert.deepEqual(await confirm(values, request), result);
    assert.deepEqual(await counts(result.order_id), { titles: 1, ops: 1, jobs: 1 });
    assert.equal(await scalar('SELECT status FROM orders WHERE id=$1', [result.order_id]), 'in_production');
    assert.deepEqual(await confirm(null, next(), result.order_id), { ...result, outcome: 'already_organized' });
    assert.deepEqual(await counts(result.order_id), { titles: 1, ops: 1, jobs: 1 });
    await assert.rejects(confirm(payload(p, { notes: 'Changed payload' }), request), /Identificador já utilizado/);
  });
  await test('Finished stock bypasses technical preparation and posts the installment schedule once', async () => {
    const p = await product({ ready: false, stock: 8 });
    const values = payload(p, { ship_by_at: '2026-11-10T14:00:00-03:00', internal_due_at: '2026-11-09T14:00:00-03:00', payment_schedule: [{ amount: 21, due_date: future }, { amount: 21, due_date: future }] });
    const request = next(), result = await confirm(values, request);
    assert.equal(result.outcome, 'stock_ready'); assert.deepEqual(await counts(result.order_id), { titles: 2, ops: 0, jobs: 0 });
    assert.equal(Number(await scalar('SELECT i.current_stock FROM products p JOIN inventory_items i ON i.id=p.stock_item_id WHERE p.id=$1', [p])), 6);
    await confirm(values, request);
    assert.equal(await scalar("SELECT count(*) FROM inventory_movements WHERE reference_type='sales_order_stock' AND reference_id=$1", [result.order_id]), 1);
    assert.equal(await scalar("SELECT (ship_by_at AT TIME ZONE 'UTC')::text FROM orders WHERE id=$1", [result.order_id]), '2026-11-10 17:00:00');
  });
  await test('Partial finished stock is separated and the OP produces only the residual quantity', async () => {
    const p = await product({ stock: 1 }), result = await confirm(payload(p));
    assert.equal(result.outcome, 'production_queued');
    assert.equal(Number(await scalar('SELECT i.current_stock FROM products p JOIN inventory_items i ON i.id=p.stock_item_id WHERE p.id=$1', [p])), 0);
    assert.equal(await scalar('SELECT count(*) FROM order_stock_allocations WHERE order_id=$1', [result.order_id]), 1);
    assert.equal(Number(await scalar('SELECT quantity FROM production_order_items WHERE production_order_id=$1', [result.production_order_id])), 1);
    assert.equal(Number(await scalar('SELECT quantity FROM order_items WHERE order_id=$1', [result.order_id])), 2);
  });
  await test('Incomplete production remains a draft without finance, OP or jobs; preparing then retrying uses that draft', async () => {
    const p = await product({ ready: false }), values = payload(p), request = next(), result = await confirm(values, request);
    assert.equal(result.outcome, 'needs_preparation'); assert.ok(result.issues.length);
    assert.equal(await scalar('SELECT status FROM orders WHERE id=$1', [result.order_id]), 'draft');
    assert.deepEqual(await counts(result.order_id), { titles: 0, ops: 0, jobs: 0 });
    assert.deepEqual(await confirm(values, request), result);
    await recipe(p);
    await db.exec('RESET ROLE'); await db.query('UPDATE products SET est_time_minutes=120 WHERE id=$1', [p]); await db.exec('SET ROLE authenticated');
    const organized = await confirm(null, next(), result.order_id);
    assert.equal(organized.order_id, result.order_id); assert.equal(organized.outcome, 'production_queued');
    assert.deepEqual(await counts(result.order_id), { titles: 1, ops: 1, jobs: 1 });
  });
  await test('Missing commercial data is actionable and never approves a saved draft', async () => {
    const p = await product(), result = await confirm(payload(p, { customer_id: null, payment_due_date: null, due_date: null }));
    assert.equal(result.outcome, 'needs_preparation'); assert.equal(result.issues.length, 3);
    assert.deepEqual(await counts(result.order_id), { titles: 0, ops: 0, jobs: 0 });
    assert.deepEqual(await scalar('SELECT workflow_issues FROM orders WHERE id=$1', [result.order_id]), result.issues);
  });
  await test('Shipping timestamps retain timezone and edit without timing fields preserves previous deadline', async () => {
    const p = await product(), values = payload(p, { ship_by_at: '2026-11-10T14:00:00-03:00', internal_due_at: '2026-11-09T14:00:00-03:00' }), orderId = await save(values);
    await scalar('SELECT save_sales_order($1,$2::jsonb,$3::jsonb,$4)', [orderId, JSON.stringify(payload(p).order), JSON.stringify(values.items), next()]);
    assert.equal(await scalar("SELECT (ship_by_at AT TIME ZONE 'UTC')::text FROM orders WHERE id=$1", [orderId]), '2026-11-10 17:00:00');
    await assert.rejects(confirm(payload(p, { ship_by_at: '2026-11-10T14:00:00' })), /horário e fuso/);
    await assert.rejects(confirm(payload(p, { ship_by_at: '2026-11-10Z' })), /horário e fuso/);
    await assert.rejects(confirm(payload(p, { ship_by_at: '2026-11-10T14:00:00Z', internal_due_at: '2026-11-11T14:00:00Z' })), /meta interna/);
  });
  await test('Accepted quote prices, snapshots and installments survive organization', async () => {
    const p = await product(), values = payload(p, { valid_until: future, payment_schedule: [{ amount: 21, due_date: future }, { amount: 21, due_date: future }] });
    const quote = await scalar('SELECT save_sales_quote(NULL,$1::jsonb,$2::jsonb,$3)', [JSON.stringify(values.order), JSON.stringify(values.items), next()]);
    await scalar("SELECT transition_sales_quote($1,'issued')", [quote]); await scalar("SELECT transition_sales_quote($1,'approved')", [quote]);
    const orderId = await scalar('SELECT convert_sales_quote($1,$2)', [quote, next()]);
    const before = await row('SELECT total,discount,shipping,notes,payment_schedule,source_quote_id FROM orders WHERE id=$1', [orderId]);
    const snapshot = await scalar('SELECT product_snapshot FROM order_items WHERE order_id=$1', [orderId]);
    const result = await confirm(null, next(), orderId); assert.equal(result.outcome, 'production_queued');
    assert.deepEqual(await row('SELECT total,discount,shipping,notes,payment_schedule,source_quote_id FROM orders WHERE id=$1', [orderId]), before);
    assert.deepEqual(await scalar('SELECT product_snapshot FROM order_items WHERE order_id=$1', [orderId]), snapshot);
    assert.deepEqual(await counts(orderId), { titles: 2, ops: 1, jobs: 1 });
  });
  await test('Cross-tenant references and existing orders cannot be confirmed', async () => {
    const p = await product(); await assert.rejects(confirm(payload(p, { customer_id: foreignCustomer })), /outra empresa/);
    const result = await confirm(payload(p));
    await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [other]);
    await assert.rejects(confirm(null, next(), result.order_id), /não encontrado/);
    await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [owner]);
  });
  await test('Viewer permission and canceled state remain protected', async () => {
    const p = await product(), orderId = await save(payload(p));
    await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [viewer]);
    await assert.rejects(confirm(null, next(), orderId), /permissão/);
    await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [owner]);
    await scalar("SELECT transition_sales_order($1,'cancelled')", [orderId]);
    await assert.rejects(confirm(null, next(), orderId), /cancelado/);
    assert.deepEqual(await counts(orderId), { titles: 0, ops: 0, jobs: 0 });
  });
  await test('Declared multi-plate assembly queues each component and cannot finish before assembling', async () => {
    const p = await product(), plates = [];
    for (const [index, label] of ['Corpo', 'Caule', 'Folha'].entries()) {
      const plate = await scalar('SELECT save_product_print_plate(NULL,$1,NULL,$2::jsonb)', [p, JSON.stringify({ plate_index: index + 1, label, units_per_plate: index ? 20 : 2, material_id: material, printer_id: printer, est_grams: 100, est_time_seconds: 3600 })]);
      await scalar("SELECT save_product_material_recipe($1,$2,'per_print',$3::jsonb,NULL,$4,0)", [p, plate, JSON.stringify([{ item_id: material, grams: 100 }]), next()]); plates.push(plate);
    }
    await scalar('SELECT configure_product_assembly($1,true)', [p]);
    const ready = await confirm(payload(p)); assert.equal(ready.outcome, 'production_queued');
    assert.deepEqual(await counts(ready.order_id), { titles: 1, ops: 1, jobs: 3 });
    await assert.rejects(scalar("SELECT transition_production_order($1,'completed')", [ready.production_order_id]), /montagem/);
  });
  await test('Canceling a stock fulfillment restores its quantity and reverses all installment titles', async () => {
    const p = await product({ stock: 5 }), result = await confirm(payload(p, { payment_schedule: [{ amount: 21, due_date: future }, { amount: 21, due_date: future }] }));
    await scalar("SELECT transition_sales_order($1,'cancelled')", [result.order_id]);
    assert.equal(Number(await scalar('SELECT i.current_stock FROM products p JOIN inventory_items i ON i.id=p.stock_item_id WHERE p.id=$1', [p])), 5);
    assert.equal(await scalar("SELECT count(*) FROM accounts_receivable WHERE origin_id=$1 AND status='reversed'", [result.order_id]), 2);
    assert.equal(await scalar('SELECT count(*) FROM order_stock_allocations WHERE order_id=$1 AND reversed_at IS NOT NULL', [result.order_id]), 1);
  });
  await test('Unexpected release failure rolls back the entire confirmation rather than leaving a title or partial queue', async () => {
    const p = await product(), before = await scalar('SELECT count(*) FROM orders');
    await db.exec(`RESET ROLE; CREATE FUNCTION qa_reject_workflow_job() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'QA blocked release'; END $$;
      CREATE TRIGGER qa_reject_workflow_job BEFORE INSERT ON jobs FOR EACH ROW EXECUTE FUNCTION qa_reject_workflow_job(); SET ROLE authenticated;`);
    await assert.rejects(confirm(payload(p)), /QA blocked release/);
    assert.equal(await scalar('SELECT count(*) FROM orders'), before);
    await db.exec('RESET ROLE; DROP TRIGGER qa_reject_workflow_job ON jobs; DROP FUNCTION qa_reject_workflow_job(); SET ROLE authenticated;');
  });
  await test('Operational deadline revision after approval preserves commercial snapshots, inventory and installments and retries once', async () => {
    const p = await product(), result = await confirm(payload(p, { payment_schedule: [{ amount: 21, due_date: future }, { amount: 21, due_date: future }] }));
    const before = await row('SELECT customer_id,total,discount,shipping,payment_due_date,payment_schedule,status FROM orders WHERE id=$1', [result.order_id]);
    const snapshots = await scalar('SELECT jsonb_agg(product_snapshot ORDER BY id) FROM order_items WHERE order_id=$1', [result.order_id]);
    const dates = JSON.stringify({ ship_by_at: future + 'T17:00:00-03:00', internal_due_at: future + 'T10:00:00-03:00' });
    const key = next(), args = [result.order_id, dates, 'Cutoff reviewed with the customer', key];
    const sql = 'SELECT update_sales_order_deadlines($1,$2::jsonb,$3,$4)';
    assert.equal(await scalar(sql, args), result.order_id); assert.equal(await scalar(sql, args), result.order_id);
    assert.deepEqual(await row('SELECT customer_id,total,discount,shipping,payment_due_date,payment_schedule,status FROM orders WHERE id=$1', [result.order_id]), before);
    assert.deepEqual(await scalar('SELECT jsonb_agg(product_snapshot ORDER BY id) FROM order_items WHERE order_id=$1', [result.order_id]), snapshots);
    assert.deepEqual(await counts(result.order_id), { titles: 2, ops: 1, jobs: 1 });
    assert.equal(await scalar("SELECT count(*)::int FROM audit_log WHERE record_id=$1 AND action='review_deadlines'", [result.order_id]), 1);
    for (const invalid of [null, [], 'not dates']) await assert.rejects(scalar(sql, [result.order_id, JSON.stringify(invalid), 'Invalid dates', next()]), /prazos operacionais/);
    await assert.rejects(scalar(sql, [result.order_id, JSON.stringify({ ship_by_at: future + 'T09:00:00Z', internal_due_at: future + 'T10:00:00Z' }), 'Invalid target', next()]), /meta interna/);
    await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [other]);
    await assert.rejects(scalar(sql, [result.order_id, dates, 'Foreign deadline edit', next()]), /pedido ativo/);
    await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [owner]);
  });
  await test('Marketplace cutoff recovery uses the official instant and preserves the pending sale during operational revision', async () => {
    const p = await product(), account = await scalar("SELECT save_marketplace_account('shopee','Deadline recovery QA',NULL)");
    await scalar("SELECT save_marketplace_sku_binding($1,'ABC','','DEADLINE-SKU',$2)", [account, p]);
    const external = { external_order_id: 'DEADLINE-RECOVERY', external_status: 'paid', normalized_state: 'paid', external_updated_at: future + 'T10:00:00-03:00', shipping_deadline_at: future + 'T18:00:00-03:00', deadline_source: 'Verified channel cutoff', reported_total: 20, items: [{ external_line_id: '1', external_item_id: 'ABC', external_sku: 'DEADLINE-SKU', description: 'Printed product', quantity: 1, unit_price: 20 }] };
    const imported = await scalar('SELECT import_marketplace_orders($1,$2::jsonb)', [account, JSON.stringify([external])]);
    const channelId = imported.order_ids[0], orderId = await scalar('SELECT create_sales_order_from_marketplace($1,$2,$3::date,$4)', [channelId, customer, future, next()]);
    const edit = dates => scalar('SELECT update_sales_order_deadlines($1,$2::jsonb,$3,$4)', [orderId, JSON.stringify(dates), 'Checked channel shipping deadline', next()]);
    await assert.rejects(edit({ ship_by_at: future + 'T19:00:00-03:00', internal_due_at: future + 'T17:00:00-03:00' }), /prazo oficial/);
    await edit({ ship_by_at: external.shipping_deadline_at, internal_due_at: future + 'T17:00:00-03:00' });
    const earlier = { ...external, external_updated_at: future + 'T11:00:00-03:00', shipping_deadline_at: future + 'T16:00:00-03:00' };
    await scalar('SELECT import_marketplace_orders($1,$2::jsonb)', [account, JSON.stringify([earlier])]);
    assert.equal(await scalar('SELECT needs_review FROM marketplace_orders WHERE id=$1', [channelId]), true);
    await edit({ ship_by_at: earlier.shipping_deadline_at, internal_due_at: future + 'T15:00:00-03:00' });
    await scalar('SELECT review_marketplace_order($1,$2)', [channelId, 'Checked the earlier official deadline and internal target']);
    assert.equal(await scalar('SELECT needs_review FROM marketplace_orders WHERE id=$1', [channelId]), false);
    assert.deepEqual(await counts(orderId), { titles: 0, ops: 0, jobs: 0 });
  });
  console.log(`${passed} isolated confirmation scenarios passed.`);
} finally { await db.close(); }
