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
GRANT SELECT,INSERT,UPDATE,DELETE ON storage.objects TO authenticated;
GRANT SELECT ON storage.objects TO anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO authenticated;`);
for (const name of (await readdir(new URL('../supabase/migrations/', import.meta.url))).filter(name => name.endsWith('.sql')).sort()) {
  try { await db.exec((await readFile(new URL('../supabase/migrations/' + name, import.meta.url), 'utf8')).replace(/CREATE EXTENSION IF NOT EXISTS (pg_cron|pg_net);/g, '')); }
  catch (error) { console.error({position:error.position,internalPosition:error.internalPosition,where:error.where,internalQuery:error.internalQuery}); throw new Error(name + ': ' + error.message); }
}
const id = number => `75000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const tenant = id(1), otherTenant = id(2), owner = id(3), admin = id(4), operator = id(5), foreignOwner = id(6), manager = id(7), channel = id(8), foreignChannel = id(9);
const scalar = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0])[0];
const as = async (role, user = null) => {
  await db.exec('RESET ROLE; SET ROLE ' + role);
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [user || '']);
};
await db.query("INSERT INTO auth.users VALUES($1,'owner@qa.invalid'),($2,'admin@qa.invalid'),($3,'operator@qa.invalid'),($4,'foreign@qa.invalid'),($5,'manager@qa.invalid')", [owner, admin, operator, foreignOwner, manager]);
await db.query("INSERT INTO tenants(id,name,slug) VALUES($1,'CMS QA','cms-qa'),($2,'Other CMS QA','other-cms-qa')", [tenant, otherTenant]);
await db.query("INSERT INTO profiles(user_id,tenant_id,display_name) VALUES($1,$6,'Owner QA'),($2,$6,'Admin QA'),($3,$6,'Operator QA'),($4,$7,'Foreign QA'),($5,$6,'Manager QA')", [owner, admin, operator, foreignOwner, manager, tenant, otherTenant]);
await db.query("INSERT INTO user_roles(user_id,tenant_id,role) VALUES($1,$6,'owner'),($2,$6,'admin'),($3,$6,'operator'),($4,$7,'owner'),($5,$6,'manager')", [owner, admin, operator, foreignOwner, manager, tenant, otherTenant]);
await db.query("INSERT INTO storefront_channels(id,tenant_id,slug,name) VALUES($1,$3,'cms-qa','CMS QA'),($2,$4,'foreign-cms-qa','Foreign CMS QA')", [channel, foreignChannel, tenant, otherTenant]);
const makeContent = title => ({
  schemaVersion: 1,
  values: { 'brand.name': title, 'story.image': '/branding/apple.jpg', 'logo.url': 'https://example.com/logo.png', 'theme.primary.color': '#Ab12EF', 'theme.heading_font': 'cormorant', 'theme.body_font': 'inter', 'story.button_href': '/produtos', 'footer.instagram.url': 'https://instagram.com/elevare' },
  sections: ['categories', 'hero', 'benefits', 'catalog', 'story'],
  banners: [{ id: 'hero-1', title, subtitle: 'Um carinho em cada detalhe.', image: '/branding/banner.jpg', alt: 'Imagem de teste', buttonLabel: 'Ver peças', buttonHref: '/produtos', align: 'left', enabled: true }],
  highlights: [{ id: 'benefit-1', title: 'Impressão 3D', text: 'Peças para presentear.', icon: 'gift' }],
  navigation: [{ id: 'link-1', label: 'Catálogo', href: '/produtos' }],
  footerLinks: [{ id: 'footer-1', label: 'Contato', href: 'mailto:contato@example.invalid' }],
  pages: [{ id: 'page-1', slug: 'sobre-a-elevare', title: 'Sobre a Elevare', body: 'Texto simples da marca.', enabled: true }],
});
const get = (slug = 'cms-qa') => scalar('SELECT storefront_cms_get($1)', [slug]);
const save = (content, revision, slug = 'cms-qa') => scalar('SELECT storefront_cms_save($1,$2,$3)', [slug, JSON.stringify(content), revision]);
const publish = (revision, slug = 'cms-qa') => scalar('SELECT storefront_cms_publish($1,$2)', [slug, revision]);
const site = (slug = 'cms-qa') => scalar('SELECT storefront_site($1)', [slug]);
const history = (slug = 'cms-qa') => scalar('SELECT storefront_cms_history($1)', [slug]);
const restore = (historyId, revision, slug = 'cms-qa') => scalar('SELECT storefront_cms_restore($1,$2,$3)', [slug, historyId, revision]);
const forbidden = async operation => assert.rejects(operation(), /permission denied|permissão/);

await as('anon');
assert.deepEqual(await site(), { content: {}, revision: 0, published_at: null });
assert.deepEqual(await site('missing'), { content: {}, revision: 0, published_at: null });
await forbidden(() => get()); await forbidden(() => save(makeContent('A'), 0)); await forbidden(() => publish(0));
await forbidden(() => history()); await forbidden(() => restore(id(99), 0));
await assert.rejects(db.query('SELECT * FROM erp_private.storefront_content'), /permission denied/);
await assert.rejects(db.query('SELECT * FROM erp_private.storefront_content_history'), /permission denied/);

for (const user of [operator, manager, foreignOwner]) {
  await as('authenticated', user);
  await forbidden(() => get()); await forbidden(() => save(makeContent('Forbidden'), 0));
  await forbidden(() => publish(0)); await forbidden(() => history()); await forbidden(() => restore(id(99), 0));
  assert.equal(await scalar('SELECT storefront_cms_can_manage($1)', [channel]), false);
}
await as('authenticated', foreignOwner);
assert.equal((await get('foreign-cms-qa')).tenant_id, otherTenant);
await as('authenticated', owner);
assert.equal(await scalar('SELECT storefront_cms_can_manage($1)', [channel]), true);
const blank = await get();
assert.equal(blank.revision, 0); assert.deepEqual(blank.draft, {}); assert.equal(blank.channel_id, channel);
await assert.rejects(publish(0), /rascunho/);
const first = await save(makeContent('Primeiro rascunho'), 0);
assert.equal(first.revision, 1); assert.equal(first.published_revision, 0); assert.deepEqual(first.published, {});
await as('anon'); assert.deepEqual((await site()).content, {});
await as('authenticated', admin);
const second = await save(makeContent('Publicação aprovada'), 1);
assert.equal(second.revision, 2);
await assert.rejects(save(makeContent('Sobrescrita antiga'), 1), /outra sessão/);
const published = await publish(2);
assert.equal(published.revision, 3); assert.equal(published.published_revision, 3);
assert.deepEqual(published.published, makeContent('Publicação aprovada'));
const firstHistory = await history();
assert.equal(firstHistory.length, 1); assert.equal(firstHistory[0].revision, 3); assert.equal(firstHistory[0].actor_name, 'Admin QA');
assert.equal('content' in firstHistory[0], false); assert.equal('email' in firstHistory[0], false);
await as('anon');
assert.deepEqual((await site()).content, makeContent('Publicação aprovada'));
assert.equal('draft' in await site(), false); assert.equal('tenant_id' in await site(), false);
await as('authenticated', owner);
const unpublished = await save(makeContent('Rascunho confidencial'), 3);
assert.equal(unpublished.revision, 4);
await as('anon'); assert.equal((await site()).content.values['brand.name'], 'Publicação aprovada');
await as('authenticated', owner);
await assert.rejects(publish(3), /outra sessão/);
const restored = await restore(firstHistory[0].id, 4);
assert.equal(restored.revision, 5); assert.equal(restored.published_revision, 3); assert.equal(restored.draft.values['brand.name'], 'Publicação aprovada');
await save(makeContent('Segunda publicação'), 5); await publish(6);
const restoredAgain = await restore(firstHistory[0].id, 7);
assert.equal(restoredAgain.revision, 8); assert.equal(restoredAgain.published.values['brand.name'], 'Segunda publicação');
await assert.rejects(restore(firstHistory[0].id, 7), /outra sessão/);
await assert.rejects(restore(id(987), 8), /não encontrada/);
await forbidden(() => get('foreign-cms-qa'));

const invalidCases = [
  content => ({ ...content, script: 'alert(1)' }),
  content => ({ ...content, schemaVersion: '1' }),
  content => ({ ...content, values: { 'theme.primary.color': 'red;display:none' } }),
  content => ({ ...content, values: { 'theme.primary.color': '#FFF' } }),
  content => ({ ...content, values: { 'theme.heading_font': 'url(evil)' } }),
  content => ({ ...content, values: { 'story.button_href': 'javascript:alert(1)' } }),
  content => ({ ...content, values: { 'footer.instagram.url': 'https://user:password@example.com/path' } }),
  content => ({ ...content, values: { 'logo.url': 'data:image/svg+xml,<svg />' } }),
  content => ({ ...content, values: { 'story.image': '//example.com/image.jpg' } }),
  content => ({ ...content, values: { 'story.image': 'https://example.com/a\\b.jpg' } }),
  content => ({ ...content, values: { 'story.image': 'https://example.com/a"b.jpg' } }),
  content => ({ ...content, values: { 'brand.name': 'x'.repeat(20001) } }),
  content => ({ ...content, sections: ['hero', 'hero'] }),
  content => ({ ...content, sections: ['custom-code'] }),
  content => ({ ...content, banners: [{ ...content.banners[0], image: 'javascript:alert(1)' }] }),
  content => ({ ...content, banners: [{ ...content.banners[0], buttonHref: '//evil.example' }] }),
  content => ({ ...content, banners: [{ ...content.banners[0], enabled: 'true' }] }),
  content => ({ ...content, highlights: [{ ...content.highlights[0], icon: '<svg>' }] }),
  content => ({ ...content, navigation: [{ id: 'link', label: 'Danger', href: 'javascript:alert(1)' }] }),
  content => ({ ...content, navigation: [{ id: 'link', label: 'Danger', href: 'mailto:test@example.com?subject=injection' }] }),
  content => ({ ...content, pages: [{ ...content.pages[0], slug: '../admin' }] }),
  content => ({ ...content, pages: [content.pages[0], { ...content.pages[0], id: 'another-id' }] }),
  content => ({ ...content, values: Object.fromEntries(Array.from({ length: 251 }, (_, index) => ['field' + index, 'value'])) }),
  content => ({ ...content, values: Object.fromEntries(Array.from({ length: 20 }, (_, index) => ['field' + index, 'x'.repeat(19000)])) }),
];
for (const change of invalidCases) await assert.rejects(save(change(makeContent('Inválido')), 8), /inválido|Confira|Informe|Selecione|devem|precisa|diferente|Use/);
assert.equal((await get()).revision, 8);
const allowed = makeContent('Links válidos');
allowed.footerLinks = [{ id: 'tel', label: 'Telefone', href: 'tel:+5511999999999' }, { id: 'hash', label: 'Vitrine', href: '#vitrine' }, { id: 'root', label: 'Início', href: '/' }];
assert.equal((await save(allowed, 8)).revision, 9);

// The image bytes are private; public access is bound to the current publication.
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9YGJ7z4AAAAASUVORK5CYII=';
const upload = (mime = 'image/png', base64 = png, slug = 'cms-qa') => scalar('SELECT storefront_cms_upload($1,$2,$3)', [slug, mime, base64]);
const image = (mediaId, slug = 'cms-qa') => scalar('SELECT storefront_media_get($1,$2)', [slug, mediaId]);
const firstImage = await upload();
assert.equal(firstImage.path, '/cms-media/' + firstImage.id); assert.equal(firstImage.mime, 'image/png');
assert.equal(firstImage.bytes, Buffer.from(png, 'base64').length);
assert.deepEqual(Object.keys(firstImage).sort(), ['bytes', 'id', 'mime', 'path']);
assert.equal((await image(firstImage.id)).base64, png);
const secondImage = await upload(); assert.notEqual(secondImage.id, firstImage.id);
await forbidden(() => upload('image/png', png, 'foreign-cms-qa'));
for (const user of [operator, manager, foreignOwner]) {
  await as('authenticated', user);
  await forbidden(() => upload());
  assert.equal(await image(firstImage.id), null);
}
await as('anon');
await forbidden(() => upload()); assert.equal(await image(firstImage.id), null);
assert.equal(await image(firstImage.id, 'foreign-cms-qa'), null);
assert.equal(await image(firstImage.id, 'missing'), null);
await assert.rejects(db.query('SELECT * FROM erp_private.storefront_media'), /permission denied/);
await as('authenticated', owner);
const html = Buffer.from('<html><script>alert(1)</script></html>').toString('base64');
for (const mime of ['image/png', 'image/jpeg', 'image/webp', 'image/avif', 'image/gif']) {
  await assert.rejects(upload(mime, html), /conteúdo.*formato/);
}
await assert.rejects(upload('image/svg+xml', png), /PNG, JPG/);
await assert.rejects(upload('text/html', png), /PNG, JPG/);
await assert.rejects(upload('image/jpeg', png), /conteúdo.*formato/);
for (const encoded of ['not base64!', png + '\n', 'AAAA=', 'A===', '', null]) await assert.rejects(upload('image/png', encoded), /inválido/);
await assert.rejects(upload('image/png', 'A'.repeat(7000004)), /limite de 5 MB/);
const tooLarge = Buffer.alloc(5242881); Buffer.from('89504e470d0a1a0a', 'hex').copy(tooLarge);
await assert.rejects(upload('image/png', tooLarge.toString('base64')), /limite de 5 MB/);
assert.equal((await get()).revision, 9);

const withStoryImage = structuredClone(allowed); withStoryImage.values['story.image'] = firstImage.path;
await save(withStoryImage, 9);
await as('anon'); assert.equal(await image(firstImage.id), null);
await as('authenticated', owner); await publish(10);
await as('anon');
const publicImage = await image(firstImage.id);
assert.deepEqual(publicImage, { id: firstImage.id, mime: 'image/png', base64: png, bytes: firstImage.bytes });
assert.equal(await image(secondImage.id), null);
assert.equal(await image(firstImage.id, 'foreign-cms-qa'), null);
for (const user of [operator, manager, foreignOwner]) {
  await as('authenticated', user);
  assert.equal((await image(firstImage.id)).base64, png); // A published image is public for every visitor.
  assert.equal(await image(secondImage.id), null);
}
await as('authenticated', admin);
assert.equal((await image(secondImage.id)).base64, png);
const secondDraft = structuredClone(withStoryImage); secondDraft.values['story.image'] = secondImage.path;
await save(secondDraft, 11);
await as('anon');
assert.equal(await image(secondImage.id), null); assert.equal((await image(firstImage.id)).base64, png);
await as('authenticated', owner);
const nearMatch = structuredClone(secondDraft); nearMatch.values['story.image'] = secondImage.path + '?size=1';
await save(nearMatch, 12); await publish(13);
await as('anon'); assert.equal(await image(secondImage.id), null); assert.equal(await image(firstImage.id), null);
await as('authenticated', owner);
const allPublishedFields = structuredClone(allowed);
allPublishedFields.values['logo.url'] = secondImage.path;
allPublishedFields.values['favicon.url'] = secondImage.path;
allPublishedFields.banners[0].image = firstImage.path;
await save(allPublishedFields, 14); await publish(15);
await as('anon'); assert.equal((await image(firstImage.id)).base64, png); assert.equal((await image(secondImage.id)).base64, png);
await as('authenticated', foreignOwner);
const foreignImage = await upload('image/png', png, 'foreign-cms-qa');
assert.equal(await image(foreignImage.id, 'cms-qa'), null);
await as('anon'); assert.equal(await image(foreignImage.id, 'foreign-cms-qa'), null);
await as('authenticated', owner);
// Validate recognition of each permitted format's signature without accepting HTML.
const signatureFixtures = [
  ['image/jpeg', Buffer.from('ffd8ffe00000', 'hex')],
  ['image/gif', Buffer.from('GIF89a123456', 'ascii')],
  ['image/webp', Buffer.from('RIFF0000WEBPVP8 ', 'ascii')],
  ['image/avif', Buffer.from('00000018667479706176696600000000617669666d696631', 'hex')],
  ['image/avif', Buffer.from('00000018667479706d69663100000000617669666d696631', 'hex')],
];
for (const [mime, bytes] of signatureFixtures) assert.equal((await upload(mime, bytes.toString('base64'))).mime, mime);
await as('anon');
await assert.rejects(db.query('SELECT * FROM erp_private.storefront_media'), /permission denied/);
await db.exec('RESET ROLE');
assert.equal(await scalar("SELECT count(*)::int FROM storage.buckets WHERE id='storefront-media'"), 0);
await db.close();
console.log('PASS storefront CMS: owner/admin authorization, tenant boundaries, private drafts, publication/history/restore, concurrency, document/link validation, and private media RPCs.');
