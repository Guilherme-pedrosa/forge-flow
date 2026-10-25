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
for (const name of (await readdir(new URL('../supabase/migrations/', import.meta.url))).filter(n => n.endsWith('.sql') && n <= '20261024170000_product_shipping_package.sql').sort()) {
  try { await db.exec((await readFile(new URL('../supabase/migrations/' + name, import.meta.url), 'utf8')).replace(/CREATE EXTENSION IF NOT EXISTS (pg_cron|pg_net);/g, '')); }
  catch (error) { throw new Error(`Migration ${name}: ${error.message}`, { cause: error }); }
}
const id = n => `71000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const owner = id(1), viewer = id(2), foreignOwner = id(3), tenant = id(10), foreignTenant = id(11);
const scalar = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0])[0];
let sequence = 100;
await db.query("INSERT INTO auth.users VALUES($1,'owner@shipping.invalid'),($2,'viewer@shipping.invalid'),($3,'foreign@shipping.invalid')", [owner, viewer, foreignOwner]);
await db.query("INSERT INTO tenants(id,name,slug) VALUES($1,'Packaging QA','packaging-qa'),($2,'Other QA','other-packaging-qa')", [tenant, foreignTenant]);
await db.query("INSERT INTO profiles(user_id,tenant_id,display_name) VALUES($1,$4,'Owner'),($2,$4,'Viewer'),($3,$5,'Foreign')", [owner, viewer, foreignOwner, tenant, foreignTenant]);
await db.query("INSERT INTO user_roles(user_id,tenant_id,role) VALUES($1,$4,'owner'),($2,$4,'viewer'),($3,$5,'owner')", [owner, viewer, foreignOwner, tenant, foreignTenant]);
await db.exec('SET ROLE authenticated');
const login = uid => db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [uid]);
await login(owner);
const complete = { length_cm: 20, width_cm: 15, height_cm: 8, weight_grams: 350 };
const save = (productId, extra = {}, request = id(sequence++)) => scalar("SELECT save_product_with_photos($1,$2::jsonb,'[]'::jsonb,$3)", [productId, JSON.stringify({ name: 'Maçã embalada', category: 'printed_part', cost_estimate: null, sale_price: 25, ...extra }), request]);
const read = productId => scalar('SELECT shipping_package FROM products WHERE id=$1', [productId]);

try {
  const firstRequest = id(sequence++);
  const product = await save(null, { shipping_package: complete }, firstRequest);
  assert.deepEqual(await read(product), complete);
  assert.equal(await save(null, { shipping_package: complete }, firstRequest), product);
  assert.equal(await scalar('SELECT count(*)::integer FROM products'), 1);
  await save(product, {});
  assert.deepEqual(await read(product), complete, 'Legacy clients must preserve the stored package');

  const updated = { ...complete, weight_grams: 420 };
  await save(product, { shipping_package: updated });
  await save(null, { shipping_package: complete }, firstRequest);
  assert.deepEqual(await read(product), updated, 'A retry must not revert a more recent package');
  await assert.rejects(save(product, { shipping_package: complete }, firstRequest), /Identificador/);

  const partial = { length_cm: 20, width_cm: null, height_cm: null, weight_grams: null };
  await save(product, { shipping_package: partial });
  assert.deepEqual(await read(product), partial);
  await save(product, { shipping_package: null });
  assert.equal(await read(product), null);

  for (const invalid of [[], '20x15', { ...complete, weight_grams: 0 }, { ...complete, length_cm: -1 }, { ...complete, length_cm: 1001 }, { ...complete, weight_grams: 1000001 }, { ...complete, height_cm: '8' }, { ...complete, weight_grams: 'NaN' }, { ...complete, insurance: 1 }]) {
    await assert.rejects(save(null, { shipping_package: invalid }), /medidas da embalagem/);
  }
  assert.equal(await scalar('SELECT count(*)::integer FROM products'), 1, 'Invalid packaging must roll back product creation');
  await assert.rejects(db.query('UPDATE products SET shipping_package=$2::jsonb WHERE id=$1', [product, JSON.stringify({ weight_grams: -1 })]), /products_shipping_package_valid/);

  await login(viewer);
  await assert.rejects(save(product, { shipping_package: complete }), /permissão/);
  await login(foreignOwner);
  await assert.rejects(save(product, { shipping_package: complete }), /Produto|produto|empresa/);
  await db.exec('RESET ROLE; SET ROLE anon');
  await assert.rejects(save(product, { shipping_package: complete }), /permission denied/);
  console.log('PASS product shipping package: atomic persistence, partial drafts, clear, legacy preservation, retry safety, bounds, tenant boundary and permissions.');
} finally { await db.close(); }
