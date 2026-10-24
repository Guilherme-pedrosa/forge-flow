import { PGlite } from '@electric-sql/pglite';
import { readdir, readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const db = new PGlite();
const migration = '20261024140000_storefront_structure.sql';
await db.exec(`CREATE ROLE authenticated; CREATE ROLE anon; CREATE ROLE service_role;
 CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY,email text);
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 CREATE SCHEMA storage; CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean);
 CREATE TABLE storage.objects(id uuid DEFAULT gen_random_uuid(),bucket_id text,name text,owner uuid);
 CREATE FUNCTION storage.foldername(text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$ SELECT string_to_array($1,'/') $$;
 ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY; CREATE PUBLICATION supabase_realtime;
 GRANT USAGE ON SCHEMA public,auth,storage TO authenticated,anon;
 ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO authenticated;`);
for (const name of (await readdir(new URL('../supabase/migrations/', import.meta.url))).filter(name => name.endsWith('.sql') && name !== migration).sort()) {
  try { await db.exec((await readFile(new URL('../supabase/migrations/' + name, import.meta.url), 'utf8')).replace(/CREATE EXTENSION IF NOT EXISTS (pg_cron|pg_net);/g, '')); }
  catch (error) { throw new Error(name + ': ' + error.message); }
}
const id = n => `76000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const tenant = id(1), otherTenant = id(2), owner = id(3), admin = id(4), operator = id(5), foreign = id(6), manager = id(7), channel = id(8), foreignChannel = id(9);
const scalar = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0])[0];
const as = async (role, user = null) => {
  await db.exec('RESET ROLE'); await db.exec('SET ROLE ' + role);
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [user || '']);
};
await db.query("INSERT INTO auth.users VALUES($1,'owner@qa.invalid'),($2,'admin@qa.invalid'),($3,'operator@qa.invalid'),($4,'foreign@qa.invalid'),($5,'manager@qa.invalid')", [owner, admin, operator, foreign, manager]);
await db.query("INSERT INTO tenants(id,name,slug) VALUES($1,'Structure QA','structure-qa'),($2,'Foreign QA','foreign-structure-qa')", [tenant, otherTenant]);
await db.query("INSERT INTO profiles(user_id,tenant_id,display_name) VALUES($1,$6,'Owner'),($2,$6,'Admin'),($3,$6,'Operator'),($4,$7,'Foreign'),($5,$6,'Manager')", [owner, admin, operator, foreign, manager, tenant, otherTenant]);
await db.query("INSERT INTO user_roles(user_id,tenant_id,role) VALUES($1,$6,'owner'),($2,$6,'admin'),($3,$6,'operator'),($4,$7,'owner'),($5,$6,'manager')", [owner, admin, operator, foreign, manager, tenant, otherTenant]);
await db.query("INSERT INTO storefront_channels(id,tenant_id,slug,name) VALUES($1,$3,'structure-qa','Structure QA'),($2,$4,'foreign-structure-qa','Foreign QA')", [channel, foreignChannel, tenant, otherTenant]);
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9YGJ7z4AAAAASUVORK5CYII=';
const get = () => scalar("SELECT storefront_cms_get('structure-qa')");
const site = () => scalar("SELECT storefront_site('structure-qa')");
const save = (content, revision) => scalar("SELECT storefront_cms_save('structure-qa',$1,$2)", [JSON.stringify(content), revision]);
const publish = revision => scalar("SELECT storefront_cms_publish('structure-qa',$1)", [revision]);
const history = () => scalar("SELECT storefront_cms_history('structure-qa')");
const restore = (revisionId, revision) => scalar("SELECT storefront_cms_restore('structure-qa',$1,$2)", [revisionId, revision]);
const upload = () => scalar("SELECT storefront_cms_upload('structure-qa','image/png',$1)", [png]);
const image = (mediaId, slug = 'structure-qa') => scalar('SELECT storefront_media_get($1,$2)', [slug, mediaId]);
const forbidden = operation => assert.rejects(operation(), /permission denied|permissão/);
let passed = 0;
const test = async (name, fn) => { try { await fn(); passed++; console.log('PASS ' + name); } catch (error) { console.error('FAIL ' + name + ': ' + error.message, error.where || ''); throw error; } };
await as('authenticated', owner);
const publishedImage = await upload(), draftImage = await upload(), campaignImage = await upload();
const legacy = {
  schemaVersion: 1, values: { 'brand.name': 'Publicação anterior', 'story.image': publishedImage.path },
  sections: ['categories', 'hero', 'benefits', 'catalog', 'story'],
  banners: [{ id: 'legacy', title: 'Anterior', subtitle: 'Texto preservado', image: '/branding/original.jpg', alt: 'Foto original', buttonLabel: 'Ver produtos', buttonHref: '/produtos', align: 'left', enabled: true }],
  highlights: [], navigation: [{ id: 'catalog', label: 'Produtos', href: '/produtos' }], footerLinks: [], pages: [],
};
await save(legacy, 0); await publish(1);
const oldHistory = (await history())[0];
const legacyDraft = structuredClone(legacy); legacyDraft.values['brand.name'] = 'Rascunho anterior'; legacyDraft.values['story.image'] = draftImage.path;
await save(legacyDraft, 2);
const before = { record: await get(), public: await site(), history: await history() };
await db.exec('RESET ROLE');
await db.exec(await readFile(new URL('../supabase/migrations/' + migration, import.meta.url), 'utf8'));
await as('authenticated', owner);

try {
  await test('Applying the additive migration preserves legacy draft, publication, revisions and history byte for byte', async () => {
    assert.deepEqual(await get(), before.record); assert.deepEqual(await site(), before.public); assert.deepEqual(await history(), before.history);
    assert.equal((await get()).revision, 3); assert.equal((await site()).revision, 2);
    assert.equal('kind' in (await site()).content.banners[0], false);
  });
  const modern = structuredClone(legacy);
  modern.sections = ['hero', 'benefits', 'categories', 'catalog', 'campaigns', 'collection', 'spotlight', 'story'];
  modern.values['collection.category'] = 'presentes'; modern.values['collection.product_ids'] = id(100) + ',' + id(101); modern.values['spotlight.product_id'] = id(101);
  modern.banners[0].kind = 'hero';
  modern.banners.push({ ...modern.banners[0], id: 'campaign', title: 'Campanha', image: campaignImage.path, kind: 'campaign' });
  await test('All eight sections and optional hero/campaign kinds save as a draft without changing public content', async () => {
    const result = await save(modern, 3); assert.equal(result.revision, 4); assert.deepEqual(result.draft, modern);
    await as('anon'); assert.deepEqual(await site(), before.public); assert.equal(await image(campaignImage.id), null);
    await as('authenticated', owner); assert.equal((await image(campaignImage.id)).base64, png);
  });
  await test('New structure cannot bypass owner/admin, tenant boundaries or optimistic concurrency', async () => {
    await assert.rejects(save(modern, 3), /outra sessão/); await assert.rejects(publish(3), /outra sessão/);
    for (const user of [operator, manager, foreign]) {
      await as('authenticated', user); await forbidden(() => get()); await forbidden(() => save(modern, 4));
      await forbidden(() => publish(4)); await forbidden(() => restore(oldHistory.id, 4)); assert.equal(await image(campaignImage.id), null);
    }
    await as('anon'); await forbidden(() => get()); await forbidden(() => save(modern, 4)); await forbidden(() => publish(4));
    await as('authenticated', admin); assert.equal((await get()).revision, 4);
  });
  await test('Publishing a campaign uses only its existing banner image permission and exposes no arbitrary media references', async () => {
    const result = await publish(4); assert.equal(result.revision, 5); assert.deepEqual(result.published, modern);
    await as('anon'); assert.deepEqual((await site()).content, modern);
    assert.equal((await image(campaignImage.id)).base64, png); assert.equal((await image(publishedImage.id)).base64, png);
    assert.equal(await image(draftImage.id), null); assert.equal(await image(campaignImage.id, 'foreign-structure-qa'), null);
    await assert.rejects(db.query('SELECT * FROM erp_private.storefront_media'), /permission denied/);
  });
  await test('A later campaign draft never changes published sections, banner kind or media access', async () => {
    await as('authenticated', owner);
    const next = structuredClone(modern); next.banners[1].image = draftImage.path; next.values['collection.product_ids'] = draftImage.path; next.sections.reverse();
    await save(next, 5);
    await as('anon'); assert.deepEqual((await site()).content, modern); assert.equal(await image(draftImage.id), null); assert.equal((await image(campaignImage.id)).base64, png);
    await as('authenticated', owner);
  });
  await test('Legacy history without kinds restores as a draft and remains publishable after the extension', async () => {
    const restored = await restore(oldHistory.id, 6); assert.equal(restored.revision, 7); assert.deepEqual(restored.draft, legacy); assert.deepEqual(restored.published, modern);
  });
  await test('Invalid kinds, unknown/duplicate/oversized sections and extra banner properties roll back without a revision change', async () => {
    const changes = [
      doc => ({ ...doc, sections: [...doc.sections, 'hero'] }),
      doc => ({ ...doc, sections: ['campaigns', 'campaigns'] }),
      doc => ({ ...doc, sections: ['custom-html'] }),
      doc => ({ ...doc, sections: [null] }),
      doc => ({ ...doc, banners: [{ ...doc.banners[0], script: 'alert(1)' }] }),
      ...[null, '', 'other', 1, false, {}, []].map(kind => doc => ({ ...doc, banners: [{ ...doc.banners[0], kind }] })),
    ];
    for (const change of changes) await assert.rejects(save(change(structuredClone(modern)), 7), /Confira|devem/);
    assert.equal((await get()).revision, 7); assert.deepEqual((await site()).content, modern);
    assert.equal((await history()).length, 2);
  });
  await test('Old five-section documents with omitted banner kind still save and publish without conversion', async () => {
    await save(legacyDraft, 7); const result = await publish(8);
    assert.equal(result.published_revision, 9); assert.deepEqual(result.published, legacyDraft);
    await as('anon'); assert.equal((await image(draftImage.id)).base64, png); assert.equal(await image(campaignImage.id), null);
    assert.equal('kind' in (await site()).content.banners[0], false);
  });
  console.log(`Storefront structure: ${passed} scenarios passed.`);
} finally { await db.close(); }
