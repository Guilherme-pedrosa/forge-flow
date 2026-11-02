import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
process.on('uncaughtException', error => { console.error(error.message, error.where ?? ''); process.exit(1); });

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
  // Diagnostic baseline: exercise the same public call before the fix.
  if (process.argv.includes('--baseline') && ['20261029220000_catalog_live_pricing.sql', '20261102150000_catalog_category_pricing.sql'].includes(name)) continue;
  try { await db.exec((await readFile(new URL('../supabase/migrations/' + name, import.meta.url), 'utf8')).replace(/CREATE EXTENSION IF NOT EXISTS (pg_cron|pg_net);/g, '')); }
  catch (error) { throw new Error(`Migration ${name}: ${error.message}`); }
}
const id = n => `71000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const tenant = id(1), owner = id(2), otherTenant = id(3), otherOwner = id(4), material = id(5), printer = id(6), secondMaterial = id(7);
let sequence = 100;
const next = () => id(sequence++);
const scalar = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0])[0];
const row = async (sql, args = []) => (await db.query(sql, args)).rows[0];
await db.query("INSERT INTO auth.users VALUES($1,'owner@qa.invalid'),($2,'other@qa.invalid')", [owner, otherOwner]);
await db.query("INSERT INTO tenants(id,name,slug) VALUES($1,'Catalog QA','catalog-qa'),($2,'Other QA','catalog-other')", [tenant, otherTenant]);
await db.query("INSERT INTO profiles(user_id,tenant_id,display_name) VALUES($1,$3,'Owner'),($2,$4,'Other')", [owner, otherOwner, tenant, otherTenant]);
await db.query("INSERT INTO user_roles(user_id,tenant_id,role) VALUES($1,$3,'owner'),($2,$4,'owner')", [owner, otherOwner, tenant, otherTenant]);
await db.query("INSERT INTO inventory_items(id,tenant_id,name,unit,current_stock,avg_cost,material_code,color_code,color_hex,color) VALUES($1,$2,'PLA preto','kg',10,20,'PLA','BLACK','#000000','Preto')", [material, tenant]);
await db.query("INSERT INTO inventory_items(id,tenant_id,name,unit,current_stock,avg_cost,material_code,color_code,color_hex,color) VALUES($1,$2,'PLA branco','kg',10,20,'PLA','WHITE','#FFFFFF','Branco')", [secondMaterial, tenant]);
await db.query("INSERT INTO printers(id,tenant_id,name,model,power_watts) VALUES($1,$2,'A1 confirmada','A1',100)", [printer,tenant]);
await db.exec('SET ROLE authenticated');
const login = uid => db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [uid]);
await login(owner);
const save = (p, data, key = next(), photos = []) => scalar('SELECT save_product_with_photos($1,$2::jsonb,$3::jsonb,$4)', [p, JSON.stringify(data), JSON.stringify(photos), key]);
const catalog = async p => (await scalar('SELECT product_material_recipe_catalog()')).find(x => x.id === p);
const policy = {energy_cost_kwh:0,labor_cost_hour:0,overhead_percent:0,target_margin:0,machine_hour_cost:4,handling_minutes_per_plate:0,finishing_minutes_per_piece:0,assembly_minutes_per_product:0,extras_cost_per_product:0};
const setPolicy = async values => scalar('SELECT save_pricing_settings($1::jsonb,$2,$3)',[JSON.stringify(values),(await scalar('SELECT pricing_settings()')).revision,next()]);
await setPolicy(policy);
const p = await save(null, { name: 'Vaso', category: 'printed_part', prints_per_plate: 2, material_id:material,est_grams:100,est_time_minutes:60,post_process_minutes:0,extras:[] });
await scalar('SELECT save_product_pricing_plan($1,$2::jsonb,$3,$4)',[p,JSON.stringify({printer_id:printer}),(await scalar('SELECT product_pricing_plan($1)',[p])).revision,next()]);
const recipe = async (grams = 100, nonMaterial = 2) => {
  // Legacy no-plate detailed pricing consumes these production inputs, while
  // the recipe independently supplies the BOM and its concurrency revision.
  await db.exec('RESET ROLE');
  try { await db.query("UPDATE products SET material_id=$2,est_grams=$3,est_time_minutes=60,prints_per_plate=2,post_process_minutes=0,extras='[]' WHERE id=$1",[p,material,grams]); }
  finally { await db.exec('SET ROLE authenticated'); }
  return scalar('SELECT save_product_material_recipe($1,NULL,$2,$3::jsonb,NULL,$4,$5)', [p, 'per_print', JSON.stringify([{ item_id: material, grams }]), next(), nonMaterial]);
};
await recipe();
const payload = async (changes = {}) => {
  const c = await catalog(p), a = await row('SELECT * FROM products WHERE id=$1',[p]);
  return { name: 'Vaso', category: 'printed_part', prints_per_plate: 2, material_id:a.material_id,est_grams:a.est_grams,est_time_minutes:a.est_time_minutes,post_process_minutes:a.post_process_minutes,num_colors:a.num_colors,extras:a.extras,cost_estimate: c.cost_per_unit, manual_cost: c.cost_per_unit, sale_price: c.cost_per_unit * 1.5,
    catalog_details: { base_cost: c.cost_per_unit, accessory_cost: 0, other_cost: 0 },
    catalog_pricing: { cost_source: 'composition', price_source: 'markup', markup_percent: 50, expected_composition_revision: c.revision }, ...changes };
};
let passed = 0;
async function test(name, fn) { await fn(); console.log('PASS ' + name); passed++; }
try {
  await test('The historical category migration refuses to downgrade newer catalog save wrappers', async () => {
    const correction = await readFile(new URL('../supabase/migrations/20261102150000_catalog_category_pricing.sql', import.meta.url), 'utf8');
    await db.exec('RESET ROLE');
    const definition = await scalar("SELECT pg_get_functiondef('public.save_product_with_photos(uuid,jsonb,jsonb,uuid)'::regprocedure)");
    try {
      await assert.rejects(db.exec(correction), /Review the live catalog pricing save function/);
      assert.equal(await scalar("SELECT pg_get_functiondef('public.save_product_with_photos(uuid,jsonb,jsonb,uuid)'::regprocedure)"), definition);
    } finally {
      await db.exec(definition);
      await db.exec('SET ROLE authenticated');
    }
  });
  await test('Composition cost + markup persist without creating a manual override; retry is inert', async () => {
    const data = await payload(), key = next();
    assert.equal(data.cost_estimate, 3); // 100g / 2 * R$20/kg + 1h / 2 * R$4/h; other company costs explicitly zero.
    assert.equal(await save(p, data, key), p);
    const saved = await row('SELECT * FROM products WHERE id=$1', [p]);
    assert.equal(saved.manual_cost_override, null);
    assert.equal(Number(saved.cost_estimate), 3); assert.equal(Number(saved.sale_price), 4.5);
    assert.equal(saved.catalog_details.cost_source, 'composition'); assert.equal(saved.catalog_details.markup_percent, 50);
    await recipe(200); // A retry must return the previous result, not reprice against this new recipe.
    assert.equal(await save(p, data, key), p);
    assert.equal(Number(await scalar('SELECT sale_price FROM products WHERE id=$1', [p])), 4.5);
    await assert.rejects(save(p, { ...data, name: 'Changed retry' }, key), /outra operação/);
  });
  await test('Stale composition rejects the entire save including stock/photos/name', async () => {
    const data = await payload();
    await recipe(300);
    await assert.rejects(save(p, { ...data, name: 'STALE', stock: { unit: 'un', avg_cost: 4, current_stock: 5 } }, next(), ['https://qa.invalid/photo.png']), /composição ou seus custos mudaram/);
    const saved = await row('SELECT name,stock_item_id FROM products WHERE id=$1', [p]);
    assert.equal(saved.name, 'Vaso'); assert.equal(saved.stock_item_id, null);
    assert.equal(await scalar('SELECT count(*)::integer FROM product_photos WHERE product_id=$1', [p]), 0);
  });
  await test('Category changes preserve automatic composition pricing without introducing a manual override', async () => {
    const data = await payload();
    await save(p, data);
    const before = await catalog(p), key = next();
    const categoryChange = { ...(await payload()), category: 'seasonal' };
    assert.equal(await save(p, categoryChange, key), p);
    assert.equal(await save(p, categoryChange, key), p);
    const saved = await row('SELECT category,cost_estimate,sale_price,manual_cost_override,catalog_details FROM products WHERE id=$1', [p]);
    assert.equal(saved.category, 'seasonal');
    assert.equal(Number(saved.cost_estimate), data.cost_estimate);
    assert.equal(Number(saved.sale_price), data.sale_price);
    assert.equal(saved.manual_cost_override, null);
    assert.equal(saved.catalog_details.cost_source, 'composition');
    assert.equal(saved.catalog_details.price_source, 'markup');
    assert.equal((await catalog(p)).cost_per_unit, before.cost_per_unit);
    assert.notEqual((await catalog(p)).revision, before.revision);
    // The category exclusion is local to this save's post-check. Another
    // session holding the old complete snapshot must still refresh first.
    await assert.rejects(save(p, { ...data, name: 'STALE CATEGORY', stock: { unit: 'un', avg_cost: 4, current_stock: 5 } }, next(), ['https://qa.invalid/stale-category.png']), /composição ou seus custos mudaram/);
    assert.equal(await scalar('SELECT name FROM products WHERE id=$1', [p]), 'Vaso');
    assert.equal(await scalar('SELECT stock_item_id FROM products WHERE id=$1', [p]), null);
    assert.equal(await scalar('SELECT count(*)::integer FROM product_photos WHERE product_id=$1', [p]), 0);
    await save(p, await payload()); // Return to the original classification.
    assert.equal(await scalar('SELECT category FROM products WHERE id=$1', [p]), 'printed_part');
  });
  await test('Commercial category correction does not allow same-save production changes', async () => {
    const changes = [
      { prints_per_plate: 3 }, { material_id: secondMaterial }, { est_grams: 101 },
      { est_time_minutes: 151 }, { post_process_minutes: 7 }, { num_colors: 2 },
      { extras: [{ name: 'Extra de produção novo', cost: 2 }] },
    ];
    const before = await row('SELECT * FROM products WHERE id=$1', [p]);
    for (const change of changes) {
      await assert.rejects(save(p, { ...(await payload()), category: 'seasonal', ...change }, next(), ['https://qa.invalid/production-change.png']), /composição mudou neste cadastro/);
      assert.deepEqual(await row('SELECT * FROM products WHERE id=$1', [p]), before);
      assert.equal(await scalar('SELECT count(*)::integer FROM product_photos WHERE product_id=$1', [p]), 0);
    }
  });
  await test('Changing yield in the same save cannot invalidate the recipe behind the price', async () => {
    const data = await payload();
    await assert.rejects(save(p, { ...data, prints_per_plate: 3 }), /composição mudou neste cadastro/);
    assert.equal(await scalar('SELECT prints_per_plate FROM products WHERE id=$1', [p]), 2);
  });
  await test('Material cost changes and equal-cost recipe replacements both invalidate the snapshot', async () => {
    const data = await payload();
    await recipe(300); // Same numeric cost, different approved recipe version.
    await assert.rejects(save(p, data), /composição ou seus custos mudaram/);
    const fresh = await payload();
    await scalar('SELECT post_inventory_movement($1::jsonb,$2)', [JSON.stringify({ item_id: material, movement_type: 'purchase_in', quantity: 10, unit_cost: 40 }), next()]);
    await assert.rejects(save(p, fresh), /composição ou seus custos mudaram/);
  });
  await test('Manual cost and manual price remain explicit choices; forged markup is rejected', async () => {
    const manual = { name: 'Manual', prints_per_plate: 2, manual_cost: 10, cost_estimate: 10, sale_price: 19.9,
      catalog_details: { base_cost: 10, accessory_cost: 0, other_cost: 0 }, catalog_pricing: { cost_source: 'manual', price_source: 'manual' } };
    await save(p, manual);
    assert.equal(Number(await scalar('SELECT manual_cost_override FROM products WHERE id=$1', [p])), 10);
    await assert.rejects(save(p, { ...manual, catalog_pricing: { cost_source: 'manual', price_source: 'markup', markup_percent: 50 } }), /percentual informado/);
    assert.equal(Number(await scalar('SELECT sale_price FROM products WHERE id=$1', [p])), 19.9);
  });
  await test('Unknown current company costs cannot become a final price; explicit zero markup is allowed', async () => {
    await recipe(300, null); // Opaque legacy references do not substitute for the full current formula.
    await setPolicy({...policy,handling_minutes_per_plate:null});
    const c = await catalog(p);
    await assert.rejects(save(p, { ...(await payload()), manual_cost: 0, cost_estimate: 0, sale_price: 0, catalog_details: { base_cost: 0, accessory_cost: 0, other_cost: 0 } }), /Complete a composição/);
    assert.equal(c.complete, false);
    await save(p, { name: 'Markup zero', prints_per_plate: 2, manual_cost: 10, cost_estimate: 10, sale_price: 10,
      catalog_details: { base_cost: 10, accessory_cost: 0, other_cost: 0 }, catalog_pricing: { cost_source: 'manual', price_source: 'markup', markup_percent: 0 } });
    assert.equal(Number(await scalar('SELECT sale_price FROM products WHERE id=$1', [p])), 10);
    await setPolicy(policy);
  });
  await test('Half-cent markup uses decimal rounding compatible with the editor', async () => {
    await save(p, { name: 'Half cent', prints_per_plate: 2, manual_cost: 6.67, cost_estimate: 6.67, sale_price: 10.01,
      catalog_details: { base_cost: 6.67, accessory_cost: 0, other_cost: 0 }, catalog_pricing: { cost_source: 'manual', price_source: 'markup', markup_percent: 50 } });
    assert.equal(Number(await scalar('SELECT sale_price FROM products WHERE id=$1', [p])), 10.01);
  });
  await test('Quote includes per-unit expenses on automatic composition without revaluing physical stock', async () => {
    await recipe(100);
    const c = await catalog(p), cost = c.cost_per_unit + 3;
    await save(p, { ...(await payload()), manual_cost: cost, cost_estimate: cost, sale_price: cost * 1.5,
      catalog_details: { base_cost: c.cost_per_unit, accessory_cost: 2, other_cost: 1 } });
    const customer = await scalar("INSERT INTO customers(tenant_id,name) VALUES($1,'Quote QA') RETURNING id", [tenant]);
    const quote = await scalar('SELECT save_sales_quote(NULL,$1::jsonb,$2::jsonb,$3)', [
      JSON.stringify({ customer_id: customer, total: cost * 1.5, discount: 0, shipping: 0, payment_due_date: '2026-12-31' }),
      JSON.stringify([{ product_id: p, description: 'Vaso', quantity: 1, unit_price: cost * 1.5, total: cost * 1.5 }]), next()]);
    const item = await row('SELECT estimated_unit_cost,estimated_total_cost FROM sales_quote_items WHERE quote_id=$1', [quote]);
    assert.equal(Number(item.estimated_unit_cost), cost); assert.equal(Number(item.estimated_total_cost), cost);
    assert.equal(await scalar('SELECT manual_cost_override FROM products WHERE id=$1', [p]), null);
  });
  await test('Another tenant cannot save this workflow or access the private predecessor', async () => {
    await login(otherOwner);
    await assert.rejects(save(p, { name: 'Cross', catalog_pricing: { cost_source: 'manual', price_source: 'manual' } }), /não encontrado|outra empresa/);
    await assert.rejects(db.query("SELECT erp_private.save_product_before_live_pricing($1,'{}','[]',$2)", [p, next()]), /permission denied/);
    await login(owner);
  });
  console.log(`PASS ${passed} catalog pricing scenario groups`);
} finally { await db.close(); }
