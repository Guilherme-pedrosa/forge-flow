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
for (const name of (await readdir(new URL('../supabase/migrations/', import.meta.url))).filter(n => n.endsWith('.sql')).sort()) {
  try { await db.exec((await readFile(new URL('../supabase/migrations/' + name, import.meta.url), 'utf8')).replace(/CREATE EXTENSION IF NOT EXISTS (pg_cron|pg_net);/g, '')); }
  catch (error) { console.error(`Migration ${name}: ${error.message}`, error.where ?? ''); throw error; }
}
const id = n => `60000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const owner = id(1), otherOwner = id(2), viewer = id(3), tenant = id(10), otherTenant = id(11), printer = id(20), material = id(30), otherMaterial = id(31);
const scalar = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0])[0];
const row = async (sql, args = []) => (await db.query(sql, args)).rows[0];
let sequence = 100, passed = 0;
const next = () => id(sequence++);
await db.query("INSERT INTO auth.users VALUES($1,'owner@qa.invalid'),($2,'other@qa.invalid'),($3,'viewer@qa.invalid')", [owner, otherOwner, viewer]);
await db.query("INSERT INTO tenants(id,name,slug,settings) VALUES($1,'Workspace QA','workspace-qa','{}'),($2,'Other QA','workspace-other','{}')", [tenant, otherTenant]);
await db.query("INSERT INTO profiles(user_id,tenant_id,display_name) VALUES($1,$4,'Owner'),($2,$5,'Other'),($3,$4,'Viewer')", [owner, otherOwner, viewer, tenant, otherTenant]);
await db.query("INSERT INTO user_roles(user_id,tenant_id,role) VALUES($1,$4,'owner'),($2,$5,'owner'),($3,$4,'viewer')", [owner, otherOwner, viewer, tenant, otherTenant]);
await db.query("INSERT INTO printers(id,tenant_id,name,model,status,power_watts,depreciation_per_hour,maintenance_cost_per_hour) VALUES($1,$2,'QA printer','A1','idle',100,2,1)", [printer, tenant]);
await db.query("INSERT INTO inventory_items(id,tenant_id,name,unit,current_stock,avg_cost) VALUES($1,$3,'PLA stock','kg',10,20),($2,$4,'Foreign PLA','kg',10,20)", [material, otherMaterial, tenant, otherTenant]);
await db.exec('SET ROLE authenticated');
const login = uid => db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [uid]);
await login(owner);
await db.query("UPDATE inventory_items SET material_code='PLA',color='Preto',color_code='BLACK',color_hex='#000000' WHERE id=$1", [material]);
const product = () => scalar("SELECT save_product_with_photos(NULL,$1::jsonb,'[]'::jsonb,$2)", [JSON.stringify({ name: 'Produto ' + sequence, category: 'printed_part', material_id: material, cost_estimate: 4, sale_price: 10 }), next()]);
const save = (p, b, data, request = next()) => scalar('SELECT save_product_subitem_details($1,$2,$3::jsonb,$4)', [p, b, JSON.stringify(data), request]);
const oldSave = (p, b, data, request = next()) => scalar('SELECT save_product_subitem($1,$2,$3::jsonb,$4)', [p, b, JSON.stringify(data), request]);
const membership = b => row('SELECT b.*,p.name,p.sku,p.photo_url,p.manual_cost_override,p.cost_estimate,p.stock_item_id,i.current_stock,i.avg_cost FROM product_subitems b JOIN products p ON p.id=b.component_product_id JOIN inventory_items i ON i.id=p.stock_item_id WHERE b.id=$1', [b]);
const spec = (grams = 5, extra = {}) => ({ materials: [{ item_id: material, grams }], print_seconds: 60, pieces_per_plate: 10, ...extra });
const count = table => scalar('SELECT count(*)::integer FROM ' + table);
async function test(name, fn) {
  try { await fn(); passed++; console.log('PASS ' + name); }
  catch (error) { console.error('FAIL ' + name + ': ' + error.message, error.where ?? ''); throw error; }
}

try {
  let parent, b, initial;
  await test('Basic piece creation needs no plate or technical sheet and is idempotent with initial stock', async () => {
    parent = await product();
    const data = { name: 'Folha', sku: 'FOLHA', quantity_per_product: 1, initial_stock: 8, unit_cost: 2 };
    const key = next(); b = await save(parent, null, data, key); initial = await membership(b);
    assert.equal(await save(parent, null, data, key), b);
    assert.equal(Number(initial.current_stock), 8); assert.equal(Number(initial.avg_cost), 2);
    assert.equal(initial.plate_id, null); assert.equal(initial.quantity_per_plate, null);
    assert.equal(await scalar('SELECT is_component FROM products WHERE id=$1', [initial.component_product_id]), true);
    assert.equal(await scalar('SELECT count(*)::integer FROM product_piece_specs WHERE product_id=$1', [initial.component_product_id]), 0);
    assert.equal(await scalar("SELECT count(*)::integer FROM inventory_movements WHERE reference_type='subitem_initial' AND reference_id=$1", [initial.component_product_id]), 1);
  });
  await test('Atomic edit changes catalogue identity, manual cost and technical data while preserving inventory valuation', async () => {
    const moves = await count('inventory_movements');
    await save(parent, b, { name: 'Folha verde', sku: 'FOLHA-VERDE', photo_url: 'https://images.example.invalid/folha.webp', unit_cost: 4, quantity_per_product: 2, technical: spec() });
    const current = await membership(b);
    assert.equal(current.component_product_id, initial.component_product_id); assert.equal(current.stock_item_id, initial.stock_item_id);
    assert.equal(current.name, 'Folha verde'); assert.equal(current.sku, 'FOLHA-VERDE'); assert.equal(current.photo_url, 'https://images.example.invalid/folha.webp');
    assert.equal(Number(current.manual_cost_override), 4); assert.equal(Number(current.current_stock), 8); assert.equal(Number(current.avg_cost), 2);
    assert.equal(current.quantity_per_product, 2); assert.equal(await count('inventory_movements'), moves);
    assert.equal(Number(await scalar("SELECT (spec->'materials'->0->>'grams')::numeric FROM product_piece_specs WHERE product_id=$1", [initial.component_product_id])), 5);
    assert.equal(await scalar('SELECT name FROM inventory_items WHERE id=$1', [initial.stock_item_id]), 'Folha verde');
    await save(parent, b, { unit_cost: null });
    const cleared = await membership(b); assert.equal(cleared.manual_cost_override, null); assert.equal(cleared.cost_estimate, null);
  });
  await test('Sharing an existing piece reuses identity, stock and technical sheet and preserves missing fields', async () => {
    const otherParent = await product(), before = await membership(b);
    const linked = await save(otherParent, null, { component_product_id: initial.component_product_id, quantity_per_product: 3 });
    const shared = await membership(linked);
    assert.equal(shared.stock_item_id, initial.stock_item_id); assert.equal(shared.name, before.name); assert.equal(shared.photo_url, before.photo_url);
    const same = await save(otherParent, null, { component_product_id: initial.component_product_id, quantity_per_product: 4 });
    assert.equal(same, linked); assert.equal((await membership(linked)).quantity_per_product, 4);
    await save(parent, b, { name: 'Folha compartilhada' }); assert.equal((await membership(linked)).name, 'Folha compartilhada');
    await assert.rejects(save(parent, b, { initial_stock: 5 }), /estoque inicial/);
    assert.equal(Number((await membership(b)).current_stock), 8);
  });
  await test('Legacy and new APIs reject silent conversion of sellable products into components', async () => {
    const sellable = await product();
    for (const fn of [save, oldSave]) await assert.rejects(fn(parent, null, { component_product_id: sellable, quantity_per_product: 1 }), /não são convertidos/);
    assert.equal(await scalar('SELECT is_component FROM products WHERE id=$1', [sellable]), false);
    assert.equal(await scalar('SELECT stock_item_id FROM products WHERE id=$1', [sellable]), null);
  });
  await test('An orphan component cannot become an invisible nested assembly', async () => {
    const p = await product(), key = await save(p, null, { name: 'Peça independente' });
    const piece = (await membership(key)).component_product_id;
    await scalar('SELECT remove_product_subitem($1)', [key]);
    for (const fn of [save, oldSave]) await assert.rejects(fn(piece, null, { name: 'Subpeça indevida' }), /peça de estoque não pode receber subitens/);
    assert.equal(await scalar('SELECT assembly_enabled FROM products WHERE id=$1', [piece]), false);
    assert.equal(await scalar('SELECT count(*)::integer FROM product_subitems WHERE product_id=$1', [piece]), 0);
  });
  await test('A membership yield remains independent of the shared technical sheet hint unless preparing a dedicated plate', async () => {
    const p = await product(), key = await save(p, null, { name: 'Peça de placa mista', quantity_per_plate: 5, technical: spec(5, { pieces_per_plate: 20 }) });
    await save(p, key, { name: 'Peça revisada', technical: spec(6, { pieces_per_plate: 20 }) });
    assert.equal((await membership(key)).quantity_per_plate, 5);
    await save(p, key, { quantity_per_plate: 5, technical: spec(7, { pieces_per_plate: 20 }) });
    assert.equal((await membership(key)).quantity_per_plate, 5);
    const piece = (await membership(key)).component_product_id;
    assert.equal(Number(await scalar("SELECT (spec->>'pieces_per_plate')::numeric FROM product_piece_specs WHERE product_id=$1", [piece])), 20);
    await assert.rejects(save(p, key, { prepare_print: true, non_material_cost_per_piece: 0 }), /quantidade de peças por placa/);
    assert.equal((await membership(key)).quantity_per_plate, 5);
  });
  await test('Technical CAS failure rolls back metadata, quantity and new request records', async () => {
    const before = await membership(b);
    const revision = await scalar('SELECT updated_at::text FROM product_piece_specs WHERE product_id=$1', [initial.component_product_id]);
    await save(parent, b, { technical: spec(6, { revision }) });
    const req = next();
    await assert.rejects(save(parent, b, { name: 'Must roll back', quantity_per_product: 9, technical: spec(7, { revision }) }, req), /outra tela/);
    const current = await membership(b); assert.equal(current.name, before.name); assert.equal(current.quantity_per_product, before.quantity_per_product);
    await db.exec('RESET ROLE');
    assert.equal(await scalar('SELECT count(*)::integer FROM erp_private.requests WHERE request_id=$1', [req]), 0);
    await db.exec('SET ROLE authenticated');
  });
  await test('Retries never overwrite later metadata or technical changes and payload reuse is rejected', async () => {
    const key = next(), data = { name: 'First edit', technical: spec(7) };
    await save(parent, b, data, key); await save(parent, b, { name: 'Latest edit', technical: spec(8) });
    assert.equal(await save(parent, b, data, key), b);
    assert.equal((await membership(b)).name, 'Latest edit');
    assert.equal(Number(await scalar("SELECT (spec->'materials'->0->>'grams')::numeric FROM product_piece_specs WHERE product_id=$1", [initial.component_product_id])), 8);
    await assert.rejects(save(parent, b, { name: 'Different payload' }, key), /outra operação/);
    const legacyKey = next(), legacyData = { name: 'Legacy', quantity_per_product: 1, initial_stock: 2, unit_cost: 1, technical: spec() };
    const legacy = await oldSave(parent, null, legacyData, legacyKey);
    await save(parent, legacy, { name: 'Later legacy', technical: spec(9) });
    assert.equal(await oldSave(parent, null, legacyData, legacyKey), legacy); assert.equal((await membership(legacy)).name, 'Later legacy');
  });
  await test('Foreign tenants, viewer and anonymous users cannot access the editor RPC', async () => {
    await login(otherOwner); await assert.rejects(save(parent, b, { name: 'Foreign' }), /não encontrado/);
    await login(viewer); await assert.rejects(save(parent, b, { name: 'Viewer' }), /permissão/);
    await db.exec('SET ROLE anon'); await login(null); await assert.rejects(save(parent, b, { name: 'Anonymous' }), /permission denied/);
    await db.exec('SET ROLE authenticated'); await login(owner);
    await assert.rejects(save(parent, b, { technical: spec(5, { materials: [{ item_id: otherMaterial, grams: 5 }] }) }), /desta empresa/);
  });
  await test('Invalid metadata and incomplete preparation leave no orphan pieces or membership changes', async () => {
    const tables = ['products', 'inventory_items', 'product_subitems', 'product_print_plates', 'product_material_recipe_versions'];
    const before = await Promise.all(tables.map(count));
    for (const data of [
      { name: 'Bad image', photo_url: 'javascript:alert(1)' },
      { name: 'Bad cost', unit_cost: -1 },
      { name: 'Bad count', quantity_per_product: 1.5 },
      { name: 'Incomplete', prepare_print: true, technical: { materials: [] } },
      { name: 'Unknown costs', prepare_print: true, quantity_per_plate: 10, technical: spec() },
      { name: 'Divergent yield', prepare_print: true, quantity_per_plate: 5, technical: spec(), non_material_cost_per_piece: 0 },
    ]) await assert.rejects(save(parent, null, data));
    assert.deepEqual(await Promise.all(tables.map(count)), before);
  });
  let printable, printableParent, dedicated, frozenJob, unrelatedPiece;
  await test('Preparing a piece creates its own parent plate and complete per-print material recipe', async () => {
    printableParent = await product();
    const imported = await scalar("SELECT save_product_print_plate(NULL,$1,NULL,$2::jsonb)", [printableParent, JSON.stringify({ plate_index: 1, label: 'Layout existente', units_per_plate: 1, material_id: material, printer_id: printer, est_grams: 100, est_time_seconds: 3600 })]);
    const importedBefore = await row('SELECT * FROM product_print_plates WHERE id=$1', [imported]);
    const first = await save(printableParent, null, { name: 'Caule', quantity_per_product: 1, plate_id: imported, quantity_per_plate: 4 });
    unrelatedPiece = first;
    printable = await save(printableParent, null, { name: 'Folha imprimível', quantity_per_product: 1, plate_id: imported, quantity_per_plate: 10,
      technical: spec(), prepare_print: true, printer_id: printer, non_material_cost_per_piece: 0 });
    dedicated = (await membership(printable)).plate_id; assert.notEqual(dedicated, imported);
    assert.equal((await membership(first)).plate_id, imported); assert.deepEqual(await row('SELECT * FROM product_print_plates WHERE id=$1', [imported]), importedBefore);
    const pl = await row('SELECT * FROM product_print_plates WHERE id=$1', [dedicated]);
    assert.equal(pl.source_id, null); assert.equal(pl.product_id, printableParent); assert.equal(pl.units_per_plate, 1);
    assert.equal(Number(pl.est_grams), 50); assert.equal(Number(pl.est_time_seconds), 600); assert.equal(pl.imported_plate_metadata.dedicated_subitem_id, printable);
    const recipe = await row('SELECT * FROM product_material_recipe_versions WHERE plate_id=$1 AND is_current', [dedicated]);
    assert.equal(recipe.basis, 'per_print'); assert.equal(recipe.units_per_print, 1); assert.equal(Number(recipe.non_material_cost_per_unit), 0);
    assert.equal(Number(await scalar('SELECT grams FROM product_material_recipe_lines WHERE recipe_version_id=$1', [recipe.id])), 50);
    await save(printableParent, printable, { quantity_per_product: 2 });
    assert.equal((await membership(printable)).plate_id, dedicated); assert.equal((await membership(printable)).quantity_per_plate, 10);
    await save(printableParent, printable, { prepare_print: true, non_material_cost_per_piece: 1, printer_id: printer });
    assert.equal((await membership(printable)).plate_id, dedicated);
  });
  await test('The prepared layout plans physical output with measured filament and time; pending layouts remain immutable', async () => {
    const jobs = await scalar('SELECT plan_subitem_batch($1,15,$2)', [printable, next()]);
    assert.equal(jobs.length, 2); frozenJob = jobs[0];
    const job = await row('SELECT * FROM jobs WHERE id=$1', [frozenJob]);
    assert.equal(job.print_plate_id, dedicated); assert.equal(job.planned_quantity, 10); assert.equal(Number(job.est_grams), 50); assert.equal(job.est_time_minutes, 10);
    assert.equal(Number(await scalar('SELECT sum(planned_quantity) FROM jobs WHERE id=ANY($1::uuid[])', [jobs])), 20);
    const snapshot = job.production_snapshot;
    assert.equal(snapshot.physical_outputs.length, 1); assert.equal(snapshot.physical_outputs[0].component_product_id, (await membership(printable)).component_product_id);
    await save(printableParent, printable, { name: 'Folha nova ficha', technical: spec(6), prepare_print: true, non_material_cost_per_piece: 1, printer_id: printer });
    assert.notEqual((await membership(printable)).plate_id, dedicated);
    assert.deepEqual(await scalar('SELECT production_snapshot FROM jobs WHERE id=$1', [frozenJob]), snapshot);
    assert.equal(Number(await scalar('SELECT est_grams FROM product_print_plates WHERE id=$1', [dedicated])), 50);
    await assert.rejects(scalar('SELECT remove_product_subitem($1)', [printable]), /produção em andamento/);
    assert.equal(await scalar('SELECT remove_product_subitem($1)', [unrelatedPiece]), unrelatedPiece);
  });
  await test('A released OP keeps its frozen membership available for replenishment until assembly finishes', async () => {
    const p = await product(), piece = await save(p, null, { name: 'Peça reservada', quantity_per_product: 1, initial_stock: 3, unit_cost: 2 });
    const op = await scalar('SELECT request_stock_production($1::jsonb,NULL,NULL,$2)', [JSON.stringify([{ product_id: p, quantity: 2 }]), next()]);
    const item = await scalar('SELECT id FROM production_order_items WHERE production_order_id=$1', [op]);
    await scalar('SELECT release_production_order($1)', [op]);
    await assert.rejects(scalar('SELECT remove_product_subitem($1)', [piece]), /produção em andamento/);
    await scalar("SELECT assemble_product($1,2,$2,0,'Montagem conferida',$3)", [p, item, next()]);
    assert.equal(await scalar('SELECT remove_product_subitem($1)', [piece]), piece);
  });
  await test('Unlinking a piece without open production retains catalogue, balance and inventory history', async () => {
    const p = await product(), key = await save(p, null, { name: 'Peça avulsa', quantity_per_product: 1, initial_stock: 3, unit_cost: 2 });
    const before = await membership(key), moves = await count('inventory_movements');
    assert.equal(await scalar('SELECT remove_product_subitem($1)', [key]), key);
    assert.equal(await scalar('SELECT count(*)::integer FROM product_subitems WHERE id=$1', [key]), 0);
    assert.equal(await scalar('SELECT stock_item_id FROM products WHERE id=$1', [before.component_product_id]), before.stock_item_id);
    assert.equal(Number(await scalar('SELECT current_stock FROM inventory_items WHERE id=$1', [before.stock_item_id])), 3);
    assert.equal(await count('inventory_movements'), moves);
  });
  console.log(`Product workspace: ${passed} scenarios passed.`);
} finally { await db.close(); }
