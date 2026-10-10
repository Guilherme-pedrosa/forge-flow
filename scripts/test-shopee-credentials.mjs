import { PGlite } from '@electric-sql/pglite';
import { readdir, readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

// Schema and secret-rotation checks in an isolated PostgreSQL instance only.
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
const scalar = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0])[0];
const row = async (sql, args = []) => (await db.query(sql, args)).rows[0];
const id = n => `70000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const tenant = id(1), owner = id(2);
await db.query("INSERT INTO auth.users VALUES($1,'owner@qa.invalid')", [owner]);
await db.query("INSERT INTO tenants(id,name,slug) VALUES($1,'Shopee QA','shopee-qa')", [tenant]);
await db.query("INSERT INTO profiles(user_id,tenant_id,display_name) VALUES($1,$2,'Owner')", [owner, tenant]);
await db.query("INSERT INTO user_roles(user_id,tenant_id,role) VALUES($1,$2,'owner')", [owner, tenant]);
await db.exec('SET ROLE authenticated');
await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [owner]);
const account = await scalar("SELECT save_marketplace_account('shopee','Shopee QA',NULL)");
const ml = await scalar("SELECT save_marketplace_account('mercado_livre','ML QA',NULL)");
const persist = (accountId, lease, shop = '123', access = 'QA_ACCESS', refresh = 'QA_REFRESH', expiry = new Date(Date.now() + 3600000).toISOString()) => scalar('SELECT persist_shopee_credentials($1,$2,$3,$4,$5,$6::timestamptz)', [accountId, lease, shop, access, refresh, expiry]);
const claim = accountId => scalar('SELECT claim_marketplace_sync($1)', [accountId]);
let passed = 0, firstLease, newLease;
async function test(name, run) { await run(); passed++; console.log('PASS ' + name); }
try {
  await test('Authenticated and anonymous clients cannot read or persist Shopee credentials or invalidate a connection', async () => {
    await assert.rejects(db.query('SELECT * FROM marketplace_credentials'), /permission denied/);
    await assert.rejects(persist(account, id(3)), /permission denied/);
    await assert.rejects(scalar('SELECT mark_shopee_reauthorization_required($1,$2)', [account, id(3)]), /permission denied/);
    await db.exec('RESET ROLE; SET ROLE anon'); await assert.rejects(persist(account, id(3)), /permission denied/);
    await db.exec('RESET ROLE; SET ROLE service_role');
  });
  await test('First authorization leases the existing account before any credentials exist and preserves channel identity', async () => {
    firstLease = await claim(account); assert.ok(firstLease); assert.equal(await claim(account), null);
    await assert.rejects(persist(account, id(3)), /reserva de execução/);
    await persist(account, firstLease);
    await db.exec('RESET ROLE');
    assert.deepEqual(await row('SELECT external_seller_id,connection_state FROM marketplace_accounts WHERE id=$1', [account]), { external_seller_id: '123', connection_state: 'connected' });
    assert.deepEqual(await row('SELECT access_token,refresh_token FROM marketplace_credentials WHERE account_id=$1', [account]), { access_token: 'QA_ACCESS', refresh_token: 'QA_REFRESH' });
    await db.exec('SET ROLE service_role');
    const mlLease = await claim(ml); await assert.rejects(persist(ml, mlLease), /reserva de execução/);
    await assert.rejects(persist(account, firstLease, '456'), /outra loja/);
  });
  await test('Malformed shop identities, null tokens and infinite or expired durations never rewrite a valid pair', async () => {
    for (const shop of [null, '', 'NaN', '-1', '9007199254740992']) await assert.rejects(persist(account, firstLease, shop), /identifica|identificação|outra loja/);
    for (const [access, refresh, expiry] of [[null, 'REFRESH', new Date(Date.now() + 3600000).toISOString()], ['ACCESS', '', new Date(Date.now() + 3600000).toISOString()], ['ACCESS', 'REFRESH', null], ['ACCESS', 'REFRESH', 'infinity'], ['ACCESS', 'REFRESH', '2020-01-01T00:00:00Z']]) await assert.rejects(persist(account, firstLease, '123', access, refresh, expiry), /incompletas ou expiradas/);
    await db.exec('RESET ROLE'); assert.equal(await scalar('SELECT access_token FROM marketplace_credentials WHERE account_id=$1', [account]), 'QA_ACCESS'); await db.exec('SET ROLE service_role');
  });
  await test('Stale leases cannot invalidate or overwrite newer credentials and release cannot clear the newer lease', async () => {
    await scalar('SELECT release_marketplace_sync($1,$2)', [account, firstLease]);
    newLease = await claim(account); assert.notEqual(newLease, firstLease);
    await persist(account, newLease, '123', 'NEW_ACCESS', 'NEW_REFRESH');
    assert.equal(await scalar('SELECT mark_shopee_reauthorization_required($1,$2)', [account, firstLease]), false);
    await assert.rejects(persist(account, firstLease, '123', 'STALE', 'STALE'), /reserva de execução/);
    await scalar('SELECT release_marketplace_sync($1,$2)', [account, firstLease]);
    await db.exec('RESET ROLE');
    assert.equal(await scalar('SELECT sync_lock_id FROM marketplace_accounts WHERE id=$1', [account]), newLease);
    assert.equal(await scalar('SELECT refresh_token FROM marketplace_credentials WHERE account_id=$1', [account]), 'NEW_REFRESH');
    assert.equal(await scalar('SELECT connection_state FROM marketplace_accounts WHERE id=$1', [account]), 'connected');
    await db.exec('SET ROLE service_role');
    assert.equal(await scalar('SELECT mark_shopee_reauthorization_required($1,$2)', [account, newLease]), true);
  });
  await test('Expired leases fail closed and secret operations create no sales, production, inventory or finance', async () => {
    await db.exec('RESET ROLE');
    await db.query("UPDATE marketplace_accounts SET sync_locked_until=now()-interval '1 second' WHERE id=$1", [account]);
    await db.exec('SET ROLE service_role');
    assert.equal(await scalar('SELECT mark_shopee_reauthorization_required($1,$2)', [account, newLease]), false);
    await assert.rejects(persist(account, newLease), /reserva de execução/);
    await db.exec('RESET ROLE');
    const counts = await row('SELECT (SELECT count(*)::int FROM orders) orders,(SELECT count(*)::int FROM production_orders) ops,(SELECT count(*)::int FROM jobs) jobs,(SELECT count(*)::int FROM inventory_movements) movements,(SELECT count(*)::int FROM accounts_receivable) receivables');
    assert.deepEqual(counts, { orders: 0, ops: 0, jobs: 0, movements: 0, receivables: 0 });
  });
  console.log(`${passed} isolated Shopee credential and lease scenarios passed.`);
} finally { await db.close(); }
