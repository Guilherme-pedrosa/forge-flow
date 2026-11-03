// Disposable Forge database only. No deployed services, OAuth or provider writes.
import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
const db = new PGlite(), scalar = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0])[0];
process.on('uncaughtException', error => { console.error(error.message, error.where ?? ''); process.exit(1); });
const id = n => `99010000-0000-4000-8000-${String(n).padStart(12, '0')}`, tenant = id(1), otherTenant = id(2), owner = id(3), operator = id(4), viewer = id(5), foreignOwner = id(6), bridge = id(7), stock = id(8), material = id(9);
const seller = '90000001', proof = 'f'.repeat(64); let sequence = 100, passed = 0; const next = () => id(sequence++);
await db.exec(`CREATE ROLE authenticated;CREATE ROLE anon;CREATE ROLE service_role;CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY,email text);
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 CREATE SCHEMA storage;CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean);CREATE TABLE storage.objects(id uuid DEFAULT gen_random_uuid(),bucket_id text,name text,owner uuid);
 CREATE FUNCTION storage.foldername(text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$ SELECT string_to_array($1,'/') $$;
 ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;CREATE PUBLICATION supabase_realtime;GRANT USAGE ON SCHEMA public,auth,storage TO authenticated,anon;
 ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO authenticated;`);
const login = async user => { await db.exec('SET ROLE authenticated'); await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [user]); };
const admin = async work => { await db.exec('RESET ROLE'); try { return await work(); } finally { await db.exec('SET ROLE authenticated'); } };
async function test(name, work) { await login(owner); await work(); passed++; console.log('PASS ' + name); }
try {
 for (const name of (await readdir(new URL('../supabase/migrations/', import.meta.url))).filter(name => name.endsWith('.sql') && name <= '20261102237000_integrador_new_account_enrollment.sql').sort()) {
  try { await db.exec((await readFile(new URL('../supabase/migrations/' + name, import.meta.url), 'utf8')).replace(/CREATE EXTENSION IF NOT EXISTS (pg_cron|pg_net);/g, '')); } catch (error) { throw Error(`Migration ${name}: ${error.message}`); }
 }
 const predecessor = await scalar("SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid='public.marketplace_stock_preview_snapshot(uuid,uuid[])'::regprocedure");
 assert.equal(predecessor, '88ec26cfafa2cf7a5c509dd61463cbca');
 await db.exec(await readFile(new URL('../supabase/migrations/20261102241000_marketplace_publication.sql', import.meta.url), 'utf8'));
 await db.exec(await readFile(new URL('../supabase/migrations/20261102242000_marketplace_publication_details.sql', import.meta.url), 'utf8'));
 await db.exec(await readFile(new URL('../supabase/migrations/20261102244500_marketplace_publication_quote_context.sql', import.meta.url), 'utf8'));
 await db.exec(await readFile(new URL('../supabase/migrations/20261102245000_marketplace_official_publication_quote.sql', import.meta.url), 'utf8'));
 await db.query("INSERT INTO auth.users VALUES($1,'owner@publication.invalid'),($2,'operator@publication.invalid'),($3,'viewer@publication.invalid'),($4,'foreign@publication.invalid')", [owner, operator, viewer, foreignOwner]);
 await db.query("INSERT INTO tenants(id,name,slug)VALUES($1,'Publication QA','publication-qa'),($2,'Other QA','publication-other')", [tenant, otherTenant]);
 await db.query("INSERT INTO profiles(user_id,tenant_id,display_name)VALUES($1,$5,'Owner'),($2,$5,'Operator'),($3,$5,'Viewer'),($4,$6,'Foreign')", [owner, operator, viewer, foreignOwner, tenant, otherTenant]);
 await db.query("INSERT INTO user_roles(user_id,tenant_id,role)VALUES($1,$5,'owner'),($2,$5,'operator'),($3,$5,'viewer'),($4,$6,'owner')", [owner, operator, viewer, foreignOwner, tenant, otherTenant]);
 await db.query("INSERT INTO integrador_bridge_bindings(id,tenant_id,approved_seller_ids,allow_enrollment,approval_note)VALUES($1,$2,ARRAY[]::text[],true,'Synthetic new Elevare publication only')", [bridge, tenant]);
 await db.query("INSERT INTO erp_private.integrador_enrollment_proofs(bridge_id,proof_sha256)VALUES($1,encode(sha256(convert_to($2,'UTF8')),'hex'))", [bridge, proof]);
 await db.query("INSERT INTO inventory_items(id,tenant_id,name,unit,current_stock,avg_cost)VALUES($1,$2,'Finished pieces','un',20,10)", [stock, tenant]);
 await db.query("INSERT INTO inventory_items(id,tenant_id,name,unit,current_stock,avg_cost,material_code,color_code,color)VALUES($1,$2,'PLA branco de estoque','kg',5,80,'PLA','BRANCO','Branco')", [material, tenant]);
 await login(owner);
 const enrolled = await scalar('SELECT complete_integrador_marketplace_enrollment($1,$2,$3,NULL,$4,$5)', [bridge, seller, 'ELEVARE3D', next(), proof]), account = enrolled.account_id;
 const productData = { name: 'Presépio Família Sagrada', category: 'printed_part', sku: 'PRES-TEST', description: 'Presépio decorativo da Família Sagrada em PLA.', material_id: material, prints_per_plate: 1, manual_cost: 10, cost_estimate: 10, sale_price: 25,
  catalog_details: { base_cost: 10, accessory_cost: 0, other_cost: 0 }, catalog_pricing: { cost_source: 'manual', price_source: 'manual' }, commercial_presentation: { dimensions: { length_mm: 80, width_mm: 50, height_mm: 100 }, description_generation: null }, shipping_package: { length_cm: 12, width_cm: 8, height_cm: 15, weight_grams: 180 } };
 const product = await scalar('SELECT save_product_with_photos(NULL,$1::jsonb,$2::jsonb,$3)', [JSON.stringify(productData), JSON.stringify(['https://images.example.test/forge-photo.jpg']), next()]);
 await admin(() => db.query('UPDATE products SET stock_item_id=$1 WHERE id=$2', [stock, product]));
 const assumptions = { commission_percent: 10, tax_percent: 0, fixed_fee_per_order: 0, fixed_fee_per_item: 0, seller_shipping_per_order: 0, advertising_per_order: 0, other_cost_per_order: 0, target_margin: 20 };
 const policy = () => scalar("SELECT channel_pricing_policy('mercado_livre')");
 const savePolicy = async values => scalar("SELECT save_channel_pricing_policy('mercado_livre',$1::jsonb,$2,$3)", [JSON.stringify(values), (await policy()).revision, next()]);
 await savePolicy(assumptions);
 const accept = async (quantity = 1) => { const p = await scalar("SELECT product_channel_pricing_preview($1,'mercado_livre',$2,'{}'::jsonb,25,NULL)", [product, quantity]); assert.equal(p.complete, true); return scalar("SELECT apply_product_channel_pricing($1,'mercado_livre',$2,'{}'::jsonb,$3,$4,$5,$6,25,NULL)", [product, quantity, p.cost_revision, p.policy_revision, p.revision, next()]); };
 const snapshot = (pid = product, aid = account) => scalar('SELECT integrador_publication_snapshot($1,$2)', [aid, pid]);
 const link = ({ key = next(), sourceProof = proof, pid = product, aid = account, item = 'MLB900001', sellerId = seller } = {}) => scalar('SELECT confirm_integrador_publication_link($1,$2,$3,$4,$5,$6,$7)', [bridge, aid, pid, item, sellerId, sourceProof, key]);
 await accept();
 const officialQuote = async () => { const s = await snapshot(); return { revision: 'a'.repeat(64), forge_revision: s.revision, quoted_at: new Date().toISOString(), account_id: account, product_id: product, seller_id: seller,
  category_id: 'MLB123', unit_price: 25, unit_cost: s.manufacturing.unit_cost, cost_revision: s.manufacturing.cost_revision, policy_revision: s.pricing_policy.revision,
  quotes: [{ listing_type_id: 'gold_special', official_revision: 'b'.repeat(64), complete: true, commission_amount: 3.5, commission_percent: 10, fixed_fee: 1, shipping_cost: 2, shipping_coverage: 'self_service', receives: 19.5, profit: 9.5, margin_percent: 38, tax_provision: 0, issues: [] }],
  assumptions: { tax_provision_percent: 0, minimum_margin_percent: 20 } }; };
 const confirmQuote = (q, key = next(), sourceProof = proof) => scalar('SELECT confirm_integrador_publication_quote($1,$2,$3,$4,$5,$6::jsonb,$7,$8)', [bridge, account, product, seller, sourceProof, JSON.stringify(q), 'gold_special', key]);
 const lookupQuote = (q, key, sourceProof = proof, price = q.unit_price) => scalar('SELECT lookup_integrador_publication_quote($1,$2,$3,$4,$5,$6,$7,$8,$9)', [bridge, account, product, seller, sourceProof, q.revision, 'gold_special', price, key]);
 const commercialWrites = () => admin(() => scalar("SELECT jsonb_build_array((SELECT count(*) FROM product_channel_pricing_acceptances),(SELECT count(*) FROM erp_private.requests),(SELECT count(*) FROM audit_log),(SELECT jsonb_agg(to_jsonb(p)) FROM product_channel_prices p))"));
 await admin(async()=>db.exec(await readFile(new URL('../supabase/migrations/20261102246000_storefront_product_details.sql',import.meta.url),'utf8')));
 const channel=await scalar("SELECT configure_storefront('storefront-cas-qa',true)");
 await admin(()=>db.query('UPDATE products SET photo_url=$2 WHERE id=$1',[product,'https://images.example.test/forge-photo.jpg']));
 const settings={published:true,category:'Personalizados',price_override:null,made_to_order:false,lead_days:7};
 const stamps=(pid=product)=>scalar("SELECT jsonb_build_object('product',p.updated_at,'listing',(SELECT l.updated_at FROM storefront_listings l WHERE l.channel_id=$2 AND l.product_id=p.id))FROM products p WHERE p.id=$1",[pid,channel]);
 const saveStore=(changes,stamp,key=next(),chosen=settings,pid=product)=>scalar('SELECT save_storefront_product_details($1,$2,$3::jsonb,$4::jsonb,$5::timestamptz,$6::timestamptz,$7)',[channel,pid,JSON.stringify(changes),JSON.stringify(chosen),stamp.product,stamp.listing,key]);
 const state=()=>admin(()=>scalar("SELECT jsonb_build_object('products',(SELECT jsonb_agg(to_jsonb(p)ORDER BY id)FROM products p),'listings',(SELECT jsonb_agg(to_jsonb(l)ORDER BY id)FROM storefront_listings l),'prices',(SELECT jsonb_agg(to_jsonb(p)ORDER BY product_id,channel)FROM product_channel_prices p),'acceptances',(SELECT jsonb_agg(to_jsonb(a)ORDER BY id)FROM product_channel_pricing_acceptances a),'requests',(SELECT count(*)FROM erp_private.requests),'receipts',(SELECT count(*)FROM erp_private.storefront_product_detail_receipts),'audit',(SELECT count(*)FROM audit_log),'movements',(SELECT count(*)FROM inventory_movements))"));
 await test('Atomic publication saves product and listing together without production or stock edits',async()=>{
  const before=await snapshot(),stamp=await stamps(),result=await saveStore({description:'Descrição comercial conferida'},stamp);
  assert.equal(result.saved,true);assert.equal(result.replayed,false);assert.ok(result.listing_id);assert.equal(await scalar('SELECT description FROM products WHERE id=$1',[product]),'Descrição comercial conferida');
  assert.equal(await scalar('SELECT published FROM storefront_listings WHERE id=$1',[result.listing_id]),true);const after=await snapshot();assert.equal(after.manufacturing.unit_cost,before.manufacturing.unit_cost);assert.equal(after.stock.available,before.stock.available);assert.equal(after.product.shipping_package.weight_grams,productData.shipping_package.weight_grams);
 });
 await test('A listing validation failure rolls back product, price renewal, receipts, audit and request',async()=>{
  const before=await state();await assert.rejects(saveStore({description:'Must roll back'},await stamps(),next(),{...settings,lead_days:0}),/prazo|publicação|Confira/);assert.deepEqual(await state(),before);
  await assert.rejects(saveStore({description:'Forbidden field',cost_estimate:0},await stamps()),/dados comerciais/);assert.deepEqual(await state(),before);
 });
 await test('Concurrent product and initially absent listing changes reject atomically',async()=>{
  const stamp=await stamps();await admin(()=>db.query("UPDATE products SET description='Edição em outra aba',updated_at=clock_timestamp() WHERE id=$1",[product]));const before=await state();await assert.rejects(saveStore({description:'Stale overwrite'},stamp),/mudou/);assert.deepEqual(await state(),before);
  const second=await scalar('SELECT save_product_with_photos(NULL,$1::jsonb,$2::jsonb,$3)',[JSON.stringify({...productData,name:'Second CAS product',sku:'CAS-SECOND'}),JSON.stringify(['https://images.example.test/second.jpg']),next()]);const empty=await stamps(second);assert.equal(empty.listing,null);
  await scalar('SELECT save_storefront_listing($1,$2,$3::jsonb)',[channel,second,JSON.stringify({...settings,published:false})]);const created=await state();await assert.rejects(saveStore({description:'Must not overwrite concurrent create'},empty,next(),{...settings,published:false},second),/mudou/);assert.deepEqual(await state(),created);
 });
 await test('Partial piece measurements retain the other measurements and generation metadata',async()=>{
  const marker={schema_version:1,generator:'facts-pt-BR-v1',generated_text:'Descrição revisada',input_signature:'confirmed-facts',title_mode:'portuguese'};
  await saveStore({commercial_presentation:{description_generation:marker}},await stamps());const before=await scalar('SELECT commercial_presentation FROM products WHERE id=$1',[product]);
  await saveStore({commercial_presentation:{dimensions:{height_mm:123}}},await stamps());const after=await scalar('SELECT commercial_presentation FROM products WHERE id=$1',[product]);assert.equal(after.dimensions.height_mm,123);assert.equal(after.dimensions.length_mm,before.dimensions.length_mm);assert.equal(after.dimensions.width_mm,before.dimensions.width_mm);assert.deepEqual(after.description_generation,marker);
 });
 await test('A current official channel price renews immutably after marketing-only edits with its exact tariff proof',async()=>{
  await accept();const q=await officialQuote();await confirmQuote(q);const before=await snapshot(),old=await admin(()=>scalar('SELECT to_jsonb(a)FROM product_channel_pricing_acceptances a WHERE id=$1',[before.price.acceptance_id]));assert.equal(before.price.complete,true);
  await saveStore({description:'Descrição comercial atualizada sem alterar custo'},await stamps());const after=await snapshot();assert.equal(after.price.complete,true);assert.equal(after.price.unit_price,before.price.unit_price);assert.notEqual(after.price.acceptance_id,before.price.acceptance_id);
  const renewed=await admin(()=>scalar('SELECT snapshot FROM product_channel_pricing_acceptances WHERE id=$1',[after.price.acceptance_id]));assert.deepEqual(renewed.official_quote,q);assert.equal(renewed.listing_type_id,'gold_special');assert.deepEqual(await admin(()=>scalar('SELECT to_jsonb(a)FROM product_channel_pricing_acceptances a WHERE id=$1',[before.price.acceptance_id])),old);
 });
 await test('A changed package or stale company policy never restores an old channel quotation',async()=>{
  await accept();let before=await snapshot();await saveStore({shipping_package:{...productData.shipping_package,height_cm:18}},await stamps());let after=await snapshot();assert.equal(after.price.acceptance_id,before.price.acceptance_id);assert.equal(after.price.complete,false);
  await accept();before=await snapshot();await savePolicy({...assumptions,advertising_per_order:1});await saveStore({description:'Marketing with stale economic policy'},await stamps());after=await snapshot();assert.equal(after.price.acceptance_id,before.price.acceptance_id);assert.equal(after.price.complete,false);await savePolicy(assumptions);await accept();
 });
 await test('Replaying a lost receipt never overwrites a later edit and returns the original loaded versions',async()=>{
  const stamp=await stamps(),key=next(),changes={description:'First confirmed description'},first=await saveStore(changes,stamp,key);await saveStore({description:'Later operator description'},await stamps());const before=await state(),second=await saveStore(changes,stamp,key);assert.equal(second.replayed,true);assert.equal(second.product_updated_at,first.product_updated_at);assert.equal(second.listing_updated_at,first.listing_updated_at);assert.deepEqual(await state(),before);assert.equal(await scalar('SELECT description FROM products WHERE id=$1',[product]),'Later operator description');
  await assert.rejects(saveStore({description:'Changed intent'},stamp,key),/outra operação/);assert.deepEqual(await state(),before);
 });
 await test('Financial membership, tenant isolation and package confirmation cannot be bypassed',async()=>{
  const stamp=await stamps(),before=await state();for(const actor of [operator,viewer,foreignOwner]){await login(actor);await assert.rejects(saveStore({},stamp),/permissão|empresa|encontrad/);}await login(owner);assert.deepEqual(await state(),before);
  await assert.rejects(saveStore({shipping_package:{height_cm:10}},await stamps()),/Complete comprimento/);assert.deepEqual(await state(),before);await db.exec('SET ROLE anon');await assert.rejects(saveStore({},stamp),/permission denied/);await login(owner);
 });
 console.log(`Passed ${passed} storefront atomic publication scenarios.`);
}finally{await db.close();}
