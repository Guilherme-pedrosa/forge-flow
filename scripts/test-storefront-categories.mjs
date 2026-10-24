import { PGlite } from '@electric-sql/pglite';
import { readdir, readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
process.on('uncaughtException', error => { console.error(error.message, error.where || ''); process.exit(1); });

const db = new PGlite();
const migration = '20261024150000_storefront_categories.sql';
await db.exec(`CREATE ROLE authenticated; CREATE ROLE anon; CREATE ROLE service_role;
 CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY,email text);
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 CREATE SCHEMA storage; CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean);
 CREATE TABLE storage.objects(id uuid DEFAULT gen_random_uuid(),bucket_id text,name text,owner uuid);
 CREATE FUNCTION storage.foldername(text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$ SELECT string_to_array($1,'/') $$;
 ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY; CREATE PUBLICATION supabase_realtime;
 GRANT USAGE ON SCHEMA public,auth,storage TO authenticated,anon;
 ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO authenticated;`);
for (const name of (await readdir(new URL('../supabase/migrations/', import.meta.url))).filter(name => name.endsWith('.sql') && name < migration).sort()) {
  try { await db.exec((await readFile(new URL('../supabase/migrations/' + name, import.meta.url), 'utf8')).replace(/CREATE EXTENSION IF NOT EXISTS (pg_cron|pg_net);/g, '')); }
  catch (error) { throw new Error(name + ': ' + error.message); }
}
const id = n => `77000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const tenant = id(1), otherTenant = id(2), owner = id(3), admin = id(4), operator = id(5), foreign = id(6), manager = id(7), channel = id(8), foreignChannel = id(9);
const scalar = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0])[0];
const as = async (role, user = null) => {
  await db.exec('RESET ROLE'); await db.exec('SET ROLE ' + role);
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [user || '']);
};
await db.query("INSERT INTO auth.users VALUES($1,'owner@qa.invalid'),($2,'admin@qa.invalid'),($3,'operator@qa.invalid'),($4,'foreign@qa.invalid'),($5,'manager@qa.invalid')", [owner, admin, operator, foreign, manager]);
await db.query("INSERT INTO tenants(id,name,slug) VALUES($1,'Categories QA','categories-qa'),($2,'Foreign QA','foreign-categories-qa')", [tenant, otherTenant]);
await db.query("INSERT INTO profiles(user_id,tenant_id,display_name) VALUES($1,$6,'Owner'),($2,$6,'Admin'),($3,$6,'Operator'),($4,$7,'Foreign'),($5,$6,'Manager')", [owner, admin, operator, foreign, manager, tenant, otherTenant]);
await db.query("INSERT INTO user_roles(user_id,tenant_id,role) VALUES($1,$6,'owner'),($2,$6,'admin'),($3,$6,'operator'),($4,$7,'owner'),($5,$6,'manager')", [owner, admin, operator, foreign, manager, tenant, otherTenant]);
await db.query("INSERT INTO storefront_channels(id,tenant_id,slug,name) VALUES($1,$3,'categories-qa','Categories QA'),($2,$4,'foreign-categories-qa','Foreign QA')", [channel, foreignChannel, tenant, otherTenant]);
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9YGJ7z4AAAAASUVORK5CYII=';
const get = () => scalar("SELECT storefront_cms_get('categories-qa')");
const site = () => scalar("SELECT storefront_site('categories-qa')");
const catalog = () => scalar("SELECT storefront_catalog('categories-qa')");
const save = (content, revision) => scalar("SELECT storefront_cms_save('categories-qa',$1,$2)", [JSON.stringify(content), revision]);
const publish = revision => scalar("SELECT storefront_cms_publish('categories-qa',$1)", [revision]);
const history = () => scalar("SELECT storefront_cms_history('categories-qa')");
const restore = (revisionId, revision) => scalar("SELECT storefront_cms_restore('categories-qa',$1,$2)", [revisionId, revision]);
const upload = () => scalar("SELECT storefront_cms_upload('categories-qa','image/png',$1)", [png]);
const image = (mediaId, slug = 'categories-qa') => scalar('SELECT storefront_media_get($1,$2)', [slug, mediaId]);
const forbidden = operation => assert.rejects(operation(), /permission denied|permissão/);
let passed = 0;
const test = async (name, fn) => { try { await fn(); passed++; console.log('PASS ' + name); } catch (error) { console.error('FAIL ' + name + ': ' + error.message, error.where || ''); throw error; } };
await as('authenticated', owner);
const oldMedia = await upload(), categoryMedia = await upload(), disabledMedia = await upload(), draftMedia = await upload();
const legacy = {
  schemaVersion: 1, values: { 'brand.name': 'Loja existente', 'logo.url': oldMedia.path }, sections: ['categories', 'hero', 'catalog'],
  banners: [{ id: 'legacy', title: 'Anterior', subtitle: '', image: '/branding/original.jpg', alt: 'Foto original', buttonLabel: 'Ver produtos', buttonHref: '/produtos', align: 'left', enabled: true }],
  highlights: [], navigation: [], footerLinks: [], pages: [],
};
await save(legacy, 0); await publish(1);
const oldHistory = (await history())[0];
const legacyDraft = structuredClone(legacy); legacyDraft.values['brand.name'] = 'Rascunho anterior'; await save(legacyDraft, 2);
const before = { record: await get(), public: await site(), history: await history(), catalog: await catalog() };
await db.exec('RESET ROLE');
await db.exec(await readFile(new URL('../supabase/migrations/' + migration, import.meta.url), 'utf8'));
await as('authenticated', owner);
const divisions = [
  ['natal-criativo', 'Natal Criativo'], ['colecionaveis', 'Colecionáveis'], ['para-pets', 'Para Pets'], ['decoracao', 'Decoração'],
  ['funcionais-para-o-dia-a-dia', 'Funcionais para o dia a dia'], ['brinquedos', 'Brinquedos'], ['chaveiros', 'Chaveiros'], ['jogos', 'Jogos'],
].map(([slug, name]) => ({ id: slug, slug, name, description: '', image: '', productIds: [], enabled: true }));
const document = { ...structuredClone(legacy), categories: divisions };
try {
  await test('Migration preserves existing drafts, publication, history, catalog and media access without creating category data', async () => {
    assert.deepEqual(await get(), before.record); assert.deepEqual(await site(), before.public); assert.deepEqual(await history(), before.history); assert.deepEqual(await catalog(), before.catalog);
    assert.equal('categories' in (await site()).content, false);
    await as('anon'); assert.equal((await image(oldMedia.id)).base64, png); assert.equal(await image(categoryMedia.id), null); await as('authenticated', owner);
  });
  await test('Eight enabled store divisions publish with an empty product catalog and no fabricated products', async () => {
    await save(document, 3); await as('anon'); assert.equal('categories' in (await site()).content, false);
    await as('authenticated', owner); await publish(4); await as('anon');
    assert.deepEqual((await site()).content.categories, divisions); assert.equal((await site()).content.categories.filter(category => category.enabled).length, 8);
    assert.deepEqual((await catalog()).products, []); await as('authenticated', owner);
  });
  let publishedProduct, privateProduct;
  await test('Category references never publish a product or replace Forge price and available stock', async () => {
    const makeProduct = (name, request) => scalar("SELECT save_product_with_photos(NULL,$1::jsonb,'[]'::jsonb,$2)", [JSON.stringify({ name, photo_url: 'https://images.example.invalid/product.jpg', sale_price: 40, stock: { current_stock: 3, unit: 'un', avg_cost: 5 } }), request]);
    publishedProduct = await makeProduct('Produto publicado', id(100)); privateProduct = await makeProduct('Produto interno', id(101));
    await scalar('SELECT save_storefront_listing($1,$2,$3::jsonb)', [channel, publishedProduct, JSON.stringify({ category: 'Natal Criativo', published: true, made_to_order: false, lead_days: 7, price_override: null })]);
    const forge = await catalog(); assert.equal(forge.products.length, 1); assert.equal(forge.products[0].id, publishedProduct); assert.equal(forge.products[0].price, 40); assert.equal(forge.products[0].stock, 3);
    document.categories[0].productIds = [publishedProduct, privateProduct, id(102)];
    await save(document, 5); await publish(6); assert.deepEqual(await catalog(), forge);
    await assert.rejects(save({ ...document, categories: [{ ...divisions[0], price: 1, stock: 500 }] }, 7), /Confira/);
    assert.deepEqual(await catalog(), forge);
  });
  await test('Only an exact enabled category image in the current publication is public', async () => {
    document.categories[0].image = categoryMedia.path; document.categories[1].image = disabledMedia.path; document.categories[1].enabled = false;
    await save(document, 7); await as('anon'); assert.equal(await image(categoryMedia.id), null);
    await as('authenticated', admin); await publish(8); await as('anon');
    assert.equal((await image(categoryMedia.id)).base64, png); assert.equal((await image(oldMedia.id)).base64, png); assert.equal(await image(disabledMedia.id), null); assert.equal(await image(draftMedia.id), null);
    assert.equal(await image(categoryMedia.id, 'foreign-categories-qa'), null); assert.equal(await image(categoryMedia.id, 'missing'), null);
    await assert.rejects(db.query('SELECT * FROM erp_private.storefront_media'), /permission denied/); await as('authenticated', owner);
  });
  await test('Private preview and later drafts do not leak unpublished category images or their references', async () => {
    const draft = structuredClone(document); draft.categories[0].image = draftMedia.path;
    await save(draft, 9); assert.equal((await image(draftMedia.id)).base64, png);
    await as('anon'); assert.equal(await image(draftMedia.id), null); assert.equal((await image(categoryMedia.id)).base64, png);
    for (const user of [operator, manager, foreign]) {
      await as('authenticated', user); assert.equal(await image(draftMedia.id), null); assert.equal((await image(categoryMedia.id)).base64, png);
      await forbidden(() => get()); await forbidden(() => save(draft, 10)); await forbidden(() => publish(10)); await forbidden(() => restore(oldHistory.id, 10));
    }
    await as('anon'); await forbidden(() => save(draft, 10)); await forbidden(() => publish(10)); await as('authenticated', owner);
    await assert.rejects(save(draft, 9), /outra sessão/); await assert.rejects(publish(9), /outra sessão/);
    assert.equal((await get()).revision, 10);
  });
  await test('Invalid taxonomy shapes, references and image URLs are rejected atomically', async () => {
    const one = divisions[0], changes = [
      null, {}, Array.from({ length: 25 }, (_, i) => ({ ...one, id: 'cat-' + i, slug: 'cat-' + i })),
      [one, { ...one, slug: 'another' }], [one, { ...one, id: 'another' }],
      ...[{ id: '' }, { slug: 'bad/slug' }, { slug: 'UPPER' }, { slug: 'a'.repeat(81) }, { name: ' ' }, { name: 'x'.repeat(121) }, { description: 'x'.repeat(20001) },
        { image: 'javascript:alert(1)' }, { image: '//evil.example/image.jpg' }, { image: 'https://user:pass@example.com/image.jpg' }, { enabled: 'true' },
        { productIds: null }, { productIds: ['not-a-uuid'] }, { productIds: [publishedProduct, publishedProduct.toUpperCase()] }, { productIds: [1] },
        { productIds: Array.from({ length: 501 }, (_, i) => id(1000 + i)) }, { unexpected: true }].map(patch => [{ ...one, ...patch }]),
    ];
    for (const categories of changes) await assert.rejects(save({ ...document, categories }, 10));
    assert.equal((await get()).revision, 10); assert.equal((await site()).revision, 9);
  });
  await test('Near-match and disabled category images do not expand public media access', async () => {
    const near = structuredClone(document); near.categories[0].image = categoryMedia.path + '?size=1';
    await save(near, 10); await publish(11); await as('anon'); assert.equal(await image(categoryMedia.id), null); assert.equal(await image(disabledMedia.id), null);
    await as('authenticated', owner); near.categories[0].image = categoryMedia.path; near.categories[0].enabled = false;
    await save(near, 12); await publish(13); await as('anon'); assert.equal(await image(categoryMedia.id), null); assert.equal((await image(oldMedia.id)).base64, png);
    await as('authenticated', owner);
  });
  await test('Legacy history without categories restores and publishes without resetting any catalog records', async () => {
    const forge = await catalog(), restored = await restore(oldHistory.id, 14);
    assert.equal(restored.revision, 15); assert.deepEqual(restored.draft, legacy); assert.equal('categories' in restored.draft, false);
    const result = await publish(15); assert.deepEqual(result.published, legacy); assert.deepEqual(await catalog(), forge);
    await as('anon'); assert.equal('categories' in (await site()).content, false); assert.equal(await image(categoryMedia.id), null); assert.equal((await image(oldMedia.id)).base64, png);
  });
  console.log(`Storefront categories: ${passed} scenarios passed.`);
} finally { await db.close(); }
