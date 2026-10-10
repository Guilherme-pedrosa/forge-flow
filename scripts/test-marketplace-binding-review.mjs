import { PGlite } from '@electric-sql/pglite';
import { readdir, readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

// --baseline reproduces the unsafe pre-migration behavior: a binding cannot store
// its manual-review requirement, so an otherwise eligible personalized sale runs.
const baseline = process.argv.includes('--baseline');
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
  if (baseline && name >= '20261010100000') continue;
  try { await db.exec((await readFile(new URL('../supabase/migrations/' + name, import.meta.url), 'utf8')).replace(/CREATE EXTENSION IF NOT EXISTS (pg_cron|pg_net);/g, '')); }
  catch (error) { throw new Error(`Migration ${name}: ${error.message}`); }
}
const id = n => `78000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const tenant=id(1), foreignTenant=id(2), owner=id(3), other=id(4), viewer=id(5), operator=id(6), product=id(7), alternate=id(8), foreignProduct=id(9), inactive=id(10), customer=id(11), stock=id(12);
let sequence=100, passed=0;
const next=()=>id(sequence++);
const scalar=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0];
const row=async(sql,args=[])=> (await db.query(sql,args)).rows[0];
await db.query("INSERT INTO auth.users VALUES($1,'owner@qa.invalid'),($2,'other@qa.invalid'),($3,'viewer@qa.invalid'),($4,'operator@qa.invalid')",[owner,other,viewer,operator]);
await db.query("INSERT INTO tenants(id,name,slug) VALUES($1,'Binding review QA','binding-review-qa'),($2,'Foreign QA','foreign-binding-review-qa')",[tenant,foreignTenant]);
await db.query("INSERT INTO profiles(user_id,tenant_id,display_name) VALUES($1,$5,'Owner'),($2,$6,'Other'),($3,$5,'Viewer'),($4,$5,'Operator')",[owner,other,viewer,operator,tenant,foreignTenant]);
await db.query("INSERT INTO user_roles(user_id,tenant_id,role) VALUES($1,$5,'owner'),($2,$6,'owner'),($3,$5,'viewer'),($4,$5,'operator')",[owner,other,viewer,operator,tenant,foreignTenant]);
await db.query("INSERT INTO customers(id,tenant_id,name) VALUES($1,$2,'Channel customer')",[customer,tenant]);
await db.query("INSERT INTO inventory_items(id,tenant_id,name,unit,current_stock,avg_cost) VALUES($1,$2,'Ready products','un',100,5)",[stock,tenant]);
await db.query("INSERT INTO products(id,tenant_id,name,category,sale_price,stock_item_id,is_active) VALUES($1,$5,'Ready product','printed_part',20,$7,true),($2,$5,'Alternate product','printed_part',20,NULL,true),($3,$6,'Foreign product','printed_part',20,NULL,true),($4,$5,'Inactive product','printed_part',20,NULL,false)",[product,alternate,foreignProduct,inactive,tenant,foreignTenant,stock]);
await db.exec('SET ROLE authenticated');
const actor = who => db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[who]);
await actor(owner);
const account=await scalar("SELECT save_marketplace_account('mercado_livre','Review ML',NULL)");
const secondAccount=await scalar("SELECT save_marketplace_account('shopee','Review Shopee',NULL)");
const savePolicy=acct=>scalar('SELECT save_marketplace_workflow_policy($1,$2::jsonb,$3)',[acct,JSON.stringify({default_customer_id:customer,receivable_due_days:15,safety_buffer_hours:24,auto_organize:true}),next()]);
await savePolicy(account); await savePolicy(secondAccount);
const identity=(sku,variant='BLUE',item='ANNOUNCEMENT')=>({external_item_id:item,external_variant_id:variant,external_sku:sku});
const bind=(key,review=false,p=product,acct=account)=>scalar(
  baseline ? 'SELECT save_marketplace_sku_binding($1,$2,$3,$4,$5)' : 'SELECT save_marketplace_sku_binding($1,$2,$3,$4,$5,$6)',
  baseline ? [acct,key.external_item_id,key.external_variant_id,key.external_sku,p] : [acct,key.external_item_id,key.external_variant_id,key.external_sku,p,review],
);
const legacyBind=(key,p=product,acct=account)=>scalar('SELECT save_marketplace_sku_binding($1,$2,$3,$4,$5)',[acct,key.external_item_id,key.external_variant_id,key.external_sku,p]);
const order=(external,key,fields={})=>({external_order_id:external,external_status:'paid',normalized_state:'paid',external_updated_at:'2026-10-10T12:00:00-03:00',shipping_deadline_at:'2026-10-13T17:00:00-03:00',deadline_source:'official order',currency:'BRL',shipping_amount:0,discount_amount:0,reported_total:40,items:[{external_line_id:'1',...key,description:'Ready item',quantity:2,unit_price:20}],...fields});
const ingest=(orders,acct=account)=>scalar('SELECT import_marketplace_orders($1,$2::jsonb)',[acct,JSON.stringify(orders)]);
const organize=(ids,request=next(),acct=account)=>scalar('SELECT organize_eligible_marketplace_orders($1,$2::uuid[],$3)',[acct,ids,request]);
const counts=()=>row(`SELECT (SELECT count(*)::int FROM orders WHERE tenant_id=$1) orders,
 (SELECT count(*)::int FROM accounts_receivable WHERE tenant_id=$1) titles,
 (SELECT count(*)::int FROM production_orders WHERE tenant_id=$1) ops,
 (SELECT count(*)::int FROM jobs WHERE tenant_id=$1) jobs,
 (SELECT count(*)::int FROM inventory_movements WHERE tenant_id=$1) movements,
 (SELECT current_stock FROM inventory_items WHERE id=$2) stock`,[tenant,stock]);
const requirement = /conferência manual.*Pedidos/;
async function test(name,fn) { await fn(); passed++; console.log('PASS '+name); }

try {
  let flagged, photoOrder;
  await test('An explicitly flagged photo listing stays in the inbox with no sale, stock, receivable or production effects',async()=>{
    flagged=identity('PHOTO'); await bind(flagged,true);
    const before=await counts(); const imported=await ingest([order('PHOTO-SALE',flagged)]); photoOrder=imported.order_ids[0];
    assert.equal(imported.workflow.organized,0,'Personalized sales must not be organized before manual conference');
    assert.equal(imported.workflow.results[0].outcome,'needs_review');
    assert.match(imported.workflow.results[0].issues[0],requirement);
    assert.equal(imported.workflow.results[0].order_id,null);
    assert.deepEqual(await counts(),before);
    assert.equal((await ingest([order('PHOTO-SALE',flagged)])).workflow.organized,0);
    assert.deepEqual(await counts(),before);
  });
  await test('The same requirement protects name-based personalization even when the upstream title has no clue',async()=>{
    const named=identity('NAME','PINK'); await bind(named,true);
    const before=await counts(); const imported=await ingest([order('NAME-SALE',named)]);
    assert.equal(imported.workflow.organized,0); assert.match(imported.workflow.results[0].issues[0],requirement);
    assert.deepEqual(await counts(),before);
  });
  await test('The public saver has one unambiguous signature; legacy calls and explicit NULL preserve the requirement',async()=>{
    assert.equal(await scalar("SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='save_marketplace_sku_binding'"),1);
    await legacyBind(flagged,alternate);
    assert.deepEqual(await row('SELECT product_id,requires_manual_review FROM marketplace_sku_bindings WHERE account_id=$1 AND external_sku=$2',[account,'PHOTO']),{product_id:alternate,requires_manual_review:true});
    await bind(flagged,null,product);
    assert.deepEqual(await row('SELECT product_id,requires_manual_review FROM marketplace_sku_bindings WHERE account_id=$1 AND external_sku=$2',[account,'PHOTO']),{product_id:product,requires_manual_review:true});
    const plain=identity('LEGACY-DEFAULT'); const binding=await legacyBind(plain);
    assert.equal(await scalar('SELECT requires_manual_review FROM marketplace_sku_bindings WHERE id=$1',[binding]),false);
    assert.equal(await scalar("SELECT is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='marketplace_sku_bindings' AND column_name='requires_manual_review'"),'NO');
  });
  await test('Invalid or foreign products cannot partially change either the destination or the review requirement',async()=>{
    const before=await row('SELECT product_id,requires_manual_review FROM marketplace_sku_bindings WHERE account_id=$1 AND external_sku=$2',[account,'PHOTO']);
    const audits=await scalar("SELECT count(*)::int FROM audit_log WHERE action='marketplace_binding_review_policy'");
    await assert.rejects(bind(flagged,false,foreignProduct),/outra empresa/);
    await assert.rejects(bind(flagged,false,inactive),/produto ativo/);
    await assert.rejects(bind(identity('PHOTO','BLUE','x'.repeat(161)),false,alternate),/identificação externa/);
    assert.deepEqual(await row('SELECT product_id,requires_manual_review FROM marketplace_sku_bindings WHERE account_id=$1 AND external_sku=$2',[account,'PHOTO']),before);
    assert.equal(await scalar("SELECT count(*)::int FROM audit_log WHERE action='marketplace_binding_review_policy'"),audits);
  });
  await test('Review-policy changes are audited with actor and before/after values while retries and failed saves leave no extra audit',async()=>{
    const key=identity('AUDITED'), binding=await bind(key,true);
    const entries=()=>db.query("SELECT tenant_id,user_id,record_id,metadata FROM audit_log WHERE action='marketplace_binding_review_policy' AND record_id=$1 ORDER BY created_at,id",[binding]);
    const first=(await entries()).rows; assert.equal(first.length,1);
    assert.equal(first[0].tenant_id,tenant); assert.equal(first[0].user_id,owner); assert.equal(first[0].record_id,binding);
    assert.equal(first[0].metadata.previous_requires_manual_review,false); assert.equal(first[0].metadata.requires_manual_review,true);
    await bind(key,true); await bind(key,null); await legacyBind(key); assert.equal((await entries()).rows.length,1);
    await assert.rejects(bind(key,false,foreignProduct),/outra empresa/); assert.equal((await entries()).rows.length,1);
    assert.equal(await scalar('SELECT requires_manual_review FROM marketplace_sku_bindings WHERE id=$1',[binding]),true);
    await bind(key,false); const changed=(await entries()).rows; assert.equal(changed.length,2);
    assert.ok(changed.some(entry=>entry.metadata.previous_requires_manual_review===true && entry.metadata.requires_manual_review===false));
    await db.exec('BEGIN'); await bind(key,true,alternate); await db.exec('ROLLBACK');
    assert.deepEqual(await row('SELECT product_id,requires_manual_review FROM marketplace_sku_bindings WHERE id=$1',[binding]),{product_id:product,requires_manual_review:false});
    assert.equal((await entries()).rows.length,2);
  });
  await test('Manual bulk organization protects flagged sales, organizes eligible peers, and retries exactly once',async()=>{
    const plain=identity('BULK-PLAIN'); await bind(plain,false);
    const policy={default_customer_id:customer,receivable_due_days:15,safety_buffer_hours:24,auto_organize:false};
    await scalar('SELECT save_marketplace_workflow_policy($1,$2::jsonb,$3)',[account,JSON.stringify(policy),next()]);
    const staged=await ingest([order('BULK-PHOTO',flagged),order('BULK-PLAIN',plain)]);
    const before=await counts(), request=next(); const result=await organize(staged.order_ids,request);
    assert.equal(result.organized,1);
    assert.match(result.results.find(x=>x.external_order_id==='BULK-PHOTO').issues[0],requirement);
    assert.equal(result.results.find(x=>x.external_order_id==='BULK-PLAIN').outcome,'stock_ready');
    const after=await counts(); assert.equal(after.orders,before.orders+1); assert.equal(after.titles,before.titles+1); assert.equal(Number(after.stock),Number(before.stock)-2);
    assert.deepEqual(await organize(staged.order_ids,request),result); assert.deepEqual(await counts(),after);
    await assert.rejects(organize([photoOrder],request),/já utilizado/);
    await savePolicy(account);
  });
  await test('A flagged sale can be made into a draft for manual conference but bulk organization still cannot confirm it',async()=>{
    const before=await counts(); const draft=await scalar('SELECT create_sales_order_from_marketplace($1,$2,CURRENT_DATE+15,$3)',[photoOrder,customer,next()]);
    assert.equal(await scalar('SELECT status FROM orders WHERE id=$1',[draft]),'draft');
    const afterDraft=await counts(); assert.equal(afterDraft.orders,before.orders+1); assert.equal(afterDraft.titles,before.titles); assert.equal(afterDraft.stock,before.stock);
    const guarded=await organize([photoOrder]); assert.equal(guarded.organized,0); assert.equal(guarded.results[0].order_id,draft); assert.match(guarded.results[0].issues[0],requirement);
    assert.deepEqual(await counts(),afterDraft);
    // This is a deliberate manual confirmation, not an artwork approval workflow.
    assert.equal((await scalar('SELECT confirm_sales_workflow($1,NULL,NULL,$2)',[draft,next()])).outcome,'stock_ready');
    const confirmed=await counts(); assert.equal(confirmed.titles,before.titles+1); assert.equal(Number(confirmed.stock),Number(before.stock)-2);
    assert.equal(await scalar('SELECT requires_manual_review FROM marketplace_sku_bindings WHERE account_id=$1 AND external_sku=$2',[account,'PHOTO']),true);
    const replay=await ingest([order('PHOTO-SALE',flagged)]); assert.equal(replay.workflow.results[0].outcome,'already_organized'); assert.equal(replay.workflow.organized,0);
    assert.deepEqual(await counts(),confirmed);
  });
  await test('Enabling the requirement preserves already organized sales and affects only new unorganized sales',async()=>{
    const key=identity('LATER-FLAG'); await bind(key,false);
    const first=await ingest([order('ALREADY-READY',key)]); assert.equal(first.workflow.organized,1);
    const sale=first.workflow.results[0].order_id, before=await counts(); await bind(key,true);
    const result=await ingest([order('ALREADY-READY',key),order('NEW-REVIEW',key)]);
    assert.equal(result.workflow.results.find(x=>x.external_order_id==='ALREADY-READY').outcome,'already_organized');
    assert.match(result.workflow.results.find(x=>x.external_order_id==='NEW-REVIEW').issues[0],requirement);
    assert.equal(result.workflow.organized,0); assert.equal(await scalar('SELECT status FROM orders WHERE id=$1',[sale]),'ready'); assert.deepEqual(await counts(),before);
  });
  await test('The requirement is scoped to exact account, listing, variant and SKU rather than product or title',async()=>{
    const original=identity('SCOPED'); await bind(original,true);
    const variants=[identity('SCOPED','RED'),identity('SCOPED','BLUE','OTHER-ANNOUNCEMENT'),identity('OTHER-SKU')];
    for (const key of variants) await bind(key,false);
    await bind(original,false,product,secondAccount);
    const first=await ingest([order('SCOPED-REVIEW',original),...variants.map((key,i)=>order('SCOPED-PLAIN-'+i,key,{items:[{...order('X',key).items[0],description:'Foto nome personalizado'}]}))]);
    assert.equal(first.workflow.organized,3); assert.match(first.workflow.results.find(x=>x.external_order_id==='SCOPED-REVIEW').issues[0],requirement);
    const second=await ingest([order('OTHER-ACCOUNT',original)],secondAccount); assert.equal(second.workflow.organized,1);
  });
  await test('A requirement enabled after draft creation blocks automation without deleting or rewriting the draft',async()=>{
    const key=identity('EXISTING-DRAFT'); await bind(key,false);
    const policy={default_customer_id:customer,receivable_due_days:15,safety_buffer_hours:24,auto_organize:false};
    await scalar('SELECT save_marketplace_workflow_policy($1,$2::jsonb,$3)',[account,JSON.stringify(policy),next()]);
    const imported=await ingest([order('EXISTING-DRAFT',key)]), source=imported.order_ids[0];
    const draft=await scalar('SELECT create_sales_order_from_marketplace($1,$2,CURRENT_DATE+15,$3)',[source,customer,next()]);
    const draftBefore=await row('SELECT status,total,notes FROM orders WHERE id=$1',[draft]), before=await counts();
    await bind(key,true); await savePolicy(account); const result=await ingest([order('EXISTING-DRAFT',key)]);
    assert.equal(result.workflow.organized,0); assert.match(result.workflow.results[0].issues[0],requirement);
    assert.deepEqual(await row('SELECT status,total,notes FROM orders WHERE id=$1',[draft]),draftBefore); assert.deepEqual(await counts(),before);
  });
  await test('A legacy approved sale is still unorganized and cannot bypass the requirement to allocate stock or production',async()=>{
    const key=identity('LEGACY-APPROVED'); await bind(key,false);
    const policy={default_customer_id:customer,receivable_due_days:15,safety_buffer_hours:24,auto_organize:false};
    await scalar('SELECT save_marketplace_workflow_policy($1,$2::jsonb,$3)',[account,JSON.stringify(policy),next()]);
    const imported=await ingest([order('LEGACY-APPROVED',key)]), source=imported.order_ids[0];
    const sale=await scalar('SELECT create_sales_order_from_marketplace($1,$2,CURRENT_DATE+15,$3)',[source,customer,next()]);
    await scalar("SELECT transition_sales_order($1,'approved')",[sale]);
    const before=await counts(); await bind(key,true); const result=await organize([source]);
    assert.equal(result.organized,0); assert.match(result.results[0].issues[0],requirement);
    assert.equal(await scalar('SELECT status FROM orders WHERE id=$1',[sale]),'approved'); assert.deepEqual(await counts(),before);
    await savePolicy(account);
  });
  await test('One flagged line protects the entire mixed sale; explicit disabling allows a future deliberate bulk run',async()=>{
    const key=identity('MIXED-FLAG'), plain=identity('MIXED-PLAIN'); await bind(key,true); await bind(plain,false);
    const payload=order('MIXED',key,{reported_total:80,items:[order('X',plain).items[0],{...order('X',key).items[0],external_line_id:'2'}]});
    const before=await counts(), result=await ingest([payload]); assert.equal(result.workflow.organized,0); assert.match(result.workflow.results[0].issues[0],requirement); assert.deepEqual(await counts(),before);
    await bind(key,false); const allowed=await organize(result.order_ids); assert.equal(allowed.organized,1);
    assert.equal(Number((await counts()).stock),Number(before.stock)-4);
  });
  await test('Tenant, role, direct-write and private-function protections remain intact',async()=>{
    await actor(other); await assert.rejects(bind(flagged,false),/outra empresa/); assert.equal(await scalar('SELECT count(*)::int FROM marketplace_sku_bindings'),0);
    await actor(viewer); await assert.rejects(bind(flagged,false),/permissão/); await assert.rejects(organize([photoOrder]),/permissão/);
    await actor(owner);
    await assert.rejects(db.query('UPDATE marketplace_sku_bindings SET requires_manual_review=false WHERE account_id=$1',[account]),/permission denied/);
    await assert.rejects(scalar('SELECT erp_private.save_marketplace_sku_binding($1,$2,$3,$4,$5)',[account,flagged.external_item_id,flagged.external_variant_id,flagged.external_sku,product]),/permission denied/);
    await db.exec('SET ROLE anon'); await assert.rejects(bind(flagged,false),/permission denied/); await db.exec('SET ROLE authenticated'); await actor(owner);
  });
  await test('Operators can ingest upstream facts but neither policy nor flagged/unflagged sales cause financial organization',async()=>{
    await actor(operator); const before=await counts(); const imported=await ingest([order('OPERATOR-REVIEW',flagged)]);
    assert.match(imported.workflow_issue,/gestor/); assert.deepEqual(await counts(),before);
    await assert.rejects(organize(imported.order_ids),/permissão/); await actor(owner);
  });
  console.log(`\n${passed} marketplace binding review contracts passed.`);
} finally { await db.close(); }
