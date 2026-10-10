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
const id = n => `70000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const tenant=id(1), foreignTenant=id(2), owner=id(3), other=id(4), viewer=id(5), product=id(6), foreignProduct=id(7), customer=id(8);
let sequence=100, passed=0;
const next=()=>id(sequence++);
const scalar=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0];
const row=async(sql,args=[]) => (await db.query(sql,args)).rows[0];
await db.query("INSERT INTO auth.users VALUES($1,'owner@qa.invalid'),($2,'other@qa.invalid'),($3,'viewer@qa.invalid')",[owner,other,viewer]);
await db.query("INSERT INTO tenants(id,name,slug) VALUES($1,'Market QA','market-qa'),($2,'Foreign QA','foreign-market-qa')",[tenant,foreignTenant]);
await db.query("INSERT INTO profiles(user_id,tenant_id,display_name) VALUES($1,$4,'Owner'),($2,$5,'Other'),($3,$4,'Viewer')",[owner,other,viewer,tenant,foreignTenant]);
await db.query("INSERT INTO user_roles(user_id,tenant_id,role) VALUES($1,$4,'owner'),($2,$5,'owner'),($3,$4,'viewer')",[owner,other,viewer,tenant,foreignTenant]);
await db.query("INSERT INTO products(id,tenant_id,name,category,sale_price) VALUES($1,$3,'Printed SKU','printed_part',20),($2,$4,'Foreign SKU','printed_part',20)",[product,foreignProduct,tenant,foreignTenant]);
await db.query("INSERT INTO customers(id,tenant_id,name) VALUES($1,$2,'Marketplace customer')",[customer,tenant]);
await db.exec('SET ROLE authenticated');
await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[owner]);
const account=await scalar("SELECT save_marketplace_account('shopee','Shop QA',NULL)");
const account2=await scalar("SELECT save_marketplace_account('shopee','Other shop',NULL)");
const order=(fields={})=>({ external_order_id:'90071992547409931234',external_status:'paid',normalized_state:'paid',external_updated_at:'2026-10-10T12:00:00-03:00',shipping_deadline_at:'2026-10-13T17:00:00-03:00',deadline_source:'official order',currency:'BRL',shipping_amount:3,discount_amount:1,reported_total:42,seller_fees:2,items:[{external_line_id:'1',external_item_id:'MLB123',external_variant_id:'AZUL',external_sku:'SKU',description:'Suporte azul',quantity:2,unit_price:20}],...fields});
const ingest=(orders,acct=account)=>scalar('SELECT import_marketplace_orders($1,$2::jsonb)',[acct,JSON.stringify(orders)]);
const bind=(acct=account,p=product)=>scalar("SELECT save_marketplace_sku_binding($1,'MLB123','AZUL','SKU',$2)",[acct,p]);
const counts=()=>row(`SELECT (SELECT count(*)::int FROM orders WHERE tenant_id=$1) orders,
 (SELECT count(*)::int FROM jobs WHERE tenant_id=$1) jobs,(SELECT count(*)::int FROM production_orders WHERE tenant_id=$1) ops,
 (SELECT count(*)::int FROM accounts_receivable WHERE tenant_id=$1) titles,(SELECT count(*)::int FROM inventory_movements WHERE tenant_id=$1) movements`,[tenant]);
async function test(name,fn){await fn();passed++;console.log('PASS '+name);}
try {
  let canonical, internal;
  await test('Account is import-ready with API access honestly pending; direct writes and secrets are denied',async()=>{
    assert.equal(await scalar('SELECT connection_state FROM marketplace_accounts WHERE id=$1',[account]),'pending_access');
    await assert.rejects(db.query("INSERT INTO marketplace_accounts(tenant_id,channel,name) VALUES($1,'shopee','Bypass')",[tenant]),/permission denied/);
    await assert.rejects(db.query('SELECT * FROM marketplace_credentials'),/permission denied/);
    await assert.rejects(db.query('SELECT * FROM marketplace_oauth_states'),/permission denied/);
    await assert.rejects(scalar('SELECT claim_marketplace_sync($1)',[account]),/permission denied/);
  });
  await test('Import preserves textual identities and official timestamp and creates no operational or financial effects',async()=>{
    const result=await ingest([order()]);assert.equal(result.imported,1);canonical=result.order_ids[0];
    assert.equal(await scalar('SELECT external_order_id FROM marketplace_orders WHERE id=$1',[canonical]),'90071992547409931234');
    assert.equal(await scalar("SELECT (shipping_deadline_at AT TIME ZONE 'UTC')::text FROM marketplace_orders WHERE id=$1",[canonical]),'2026-10-13 20:00:00');
    assert.deepEqual(await counts(),{orders:0,jobs:0,ops:0,titles:0,movements:0});
    assert.equal(await scalar("SELECT count(*)::int FROM marketplace_events WHERE status='processed'"),1);
  });
  await test('Exact retry does not duplicate; old revision is ignored; ambiguous same revision is rejected',async()=>{
    assert.equal((await ingest([order()])).unchanged,1);
    assert.equal((await ingest([order({external_updated_at:'2026-10-10T11:00:00-03:00',external_status:'outdated'})])).ignored_older,1);
    await assert.rejects(ingest([order({external_status:'different'})]),/mesmo horário/);
    assert.equal(await scalar('SELECT count(*)::int FROM marketplace_order_items WHERE marketplace_order_id=$1',[canonical]),1);
  });
  await test('Malformed payloads, ambiguous identities, duplicate lines and incomplete money do not mutate the inbox',async()=>{
    await assert.rejects(scalar('SELECT import_marketplace_orders($1,NULL)',[account]),/lista/);
    await assert.rejects(ingest([{...order(),items:undefined}]),/itens/);
    await assert.rejects(ingest([order({external_order_id:123})]),/textos/);
    await assert.rejects(ingest([order({items:[{...order().items[0],unit_price:null}]})]),/inválidos/);
    await assert.rejects(ingest([order({items:[order().items[0],order().items[0]]})]),/Linha repetida/);
    await assert.rejects(ingest([order({shipping_deadline_at:'2026-10-13 17:00:00'})]),/prazo inválidos/);
    assert.equal(await scalar('SELECT count(*)::int FROM marketplace_orders'),1);
  });
  await test('Mappings are explicit and isolated by account and variation and product tenant',async()=>{
    await assert.rejects(bind(account,foreignProduct),/Vínculo inválido ou de outra empresa/);
    await bind();await ingest([order()],account2);
    assert.equal(await scalar('SELECT product_id FROM marketplace_order_items WHERE marketplace_order_id=$1',[canonical]),product);
    assert.equal(await scalar('SELECT product_id FROM marketplace_order_items WHERE marketplace_order_id=(SELECT id FROM marketplace_orders WHERE account_id=$1)',[account2]),null);
  });
  await test('Conversion creates only one draft; deadlines stay instants and payout stays separate from payment',async()=>{
    const request=next();internal=await scalar('SELECT create_sales_order_from_marketplace($1,$2,CURRENT_DATE+30,$3)',[canonical,customer,request]);
    assert.equal(await scalar('SELECT create_sales_order_from_marketplace($1,$2,CURRENT_DATE+30,$3)',[canonical,customer,request]),internal);
    assert.equal(await scalar('SELECT status FROM orders WHERE id=$1',[internal]),'draft');
    assert.equal(await scalar("SELECT (ship_by_at AT TIME ZONE 'UTC')::text FROM orders WHERE id=$1",[internal]),'2026-10-13 20:00:00');
    assert.equal(Number(await scalar('SELECT total FROM orders WHERE id=$1',[internal])),42);
    assert.deepEqual(await counts(),{orders:1,jobs:0,ops:0,titles:0,movements:0});
    assert.equal((await scalar('SELECT confirm_sales_workflow($1,NULL,NULL,$2)',[internal,next()])).outcome,'needs_preparation');
    assert.deepEqual(await counts(),{orders:1,jobs:0,ops:0,titles:0,movements:0});
  });
  await test('Upstream cancellation marks existing draft for review and every legacy approval route is blocked',async()=>{
    await ingest([order({external_status:'cancelled',normalized_state:'cancelled',external_updated_at:'2026-10-10T13:00:00-03:00'})]);
    assert.equal(await scalar('SELECT needs_review FROM marketplace_orders WHERE id=$1',[canonical]),true);
    await assert.rejects(scalar('SELECT create_sales_order_from_marketplace($1,$2,CURRENT_DATE+30,$3)',[canonical,customer,next()]),/pagos/);
    await assert.rejects(scalar("SELECT transition_sales_order($1,'approved')",[internal]),/marketplace exige revisão/);
    await db.exec('RESET ROLE');
    await assert.rejects(db.query("UPDATE orders SET status='approved' WHERE id=$1",[internal]),/marketplace exige revisão/);
    const stock=await scalar("INSERT INTO inventory_items(tenant_id,name,unit,current_stock,avg_cost) VALUES($1,'Finished QA','un',5,10) RETURNING id",[tenant]);
    await db.query('UPDATE products SET stock_item_id=$1 WHERE id=$2',[stock,product]);
    await db.exec('SET ROLE authenticated');
    await assert.rejects(scalar('SELECT confirm_sales_workflow($1,NULL,NULL,$2)',[internal,next()]),/marketplace exige revisão/);
    assert.equal(await scalar('SELECT status FROM orders WHERE id=$1',[internal]),'draft');
  });
  await test('Durable events are idempotent and never release manufacturing',async()=>{
    const payload=JSON.stringify({resource:'/orders/200',topic:'orders',user_id:'123'});
    const first=await scalar("SELECT record_marketplace_event($1,'evt-1',$2::jsonb)",[account,payload]);
    assert.equal(await scalar("SELECT record_marketplace_event($1,'evt-1',$2::jsonb)",[account,payload]),first);
    await assert.rejects(scalar("SELECT record_marketplace_event($1,'evt-1','{}')",[account]),/conteúdo diferente/);
    await assert.rejects(scalar("SELECT record_marketplace_event($1,'null',NULL)",[account]),/inválido/);
    assert.equal(await scalar('SELECT status FROM marketplace_events WHERE id=$1',[first]),'pending');
    assert.deepEqual(await counts(),{orders:1,jobs:0,ops:0,titles:0,movements:0});
  });
  await test('Cross-tenant ingestion, viewer writes and anonymous callbacks cannot bypass authorization',async()=>{
    await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[other]);
    assert.equal(await scalar('SELECT count(*)::int FROM marketplace_orders'),0);
    await assert.rejects(ingest([order()]),/Conta não encontrada/);
    await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[viewer]);
    await assert.rejects(scalar("SELECT record_marketplace_event($1,'viewer','{}')",[account]),/permissão/);
    await assert.rejects(scalar("SELECT save_marketplace_account('shopee','Viewer',NULL)"),/permissão/);
    await db.exec('SET ROLE anon');
    await assert.rejects(scalar("SELECT record_marketplace_event($1,'anon','{}')",[account]),/permission denied/);
  });
  await test('Refresh-token lease is service-only, single-owner, and old releases cannot unlock a newer run',async()=>{
    await db.exec('RESET ROLE');
    await db.query("INSERT INTO marketplace_credentials(account_id,access_token,refresh_token,expires_at) VALUES($1,'qa-access','qa-refresh',now()+interval '1 hour')",[account]);
    const first=await scalar('SELECT claim_marketplace_sync($1)',[account]);assert.ok(first);
    assert.equal(await scalar('SELECT claim_marketplace_sync($1)',[account]),null);
    await db.query("UPDATE marketplace_accounts SET sync_locked_until=now()-interval '1 second' WHERE id=$1",[account]);
    const second=await scalar('SELECT claim_marketplace_sync($1)',[account]);assert.ok(second);assert.notEqual(second,first);
    await scalar('SELECT release_marketplace_sync($1,$2)',[account,first]);
    assert.equal(await scalar('SELECT sync_lock_id FROM marketplace_accounts WHERE id=$1',[account]),second);
    await scalar('SELECT release_marketplace_sync($1,$2)',[account,second]);
    assert.equal(await scalar('SELECT sync_lock_id FROM marketplace_accounts WHERE id=$1',[account]),null);
  });
  await test('First OAuth authorization is leased before credentials exist and seller plus tokens persist atomically',async()=>{
    await db.exec('SET ROLE authenticated');await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[owner]);
    const ml=await scalar("SELECT save_marketplace_account('mercado_livre','OAuth QA',NULL)");
    await assert.rejects(scalar("SELECT persist_marketplace_credentials($1,$2,'123','qa-access','qa-refresh',now()+interval '1 hour')",[ml,next()]),/permission denied/);
    await db.exec('RESET ROLE');
    const lock=await scalar('SELECT claim_marketplace_sync($1)',[ml]);assert.ok(lock);
    assert.equal(await scalar('SELECT claim_marketplace_sync($1)',[ml]),null);
    await scalar("SELECT persist_marketplace_credentials($1,$2,'123','qa-first-access','qa-first-refresh',now()+interval '1 hour')",[ml,lock]);
    assert.deepEqual(await row('SELECT external_seller_id,connection_state FROM marketplace_accounts WHERE id=$1',[ml]),{external_seller_id:'123',connection_state:'connected'});
    await assert.rejects(scalar("SELECT persist_marketplace_credentials($1,$2,'456','qa-other-access','qa-other-refresh',now()+interval '1 hour')",[ml,lock]),/outro vendedor/);
    assert.equal(await scalar('SELECT access_token FROM marketplace_credentials WHERE account_id=$1',[ml]),'qa-first-access');
    await scalar('SELECT release_marketplace_sync($1,$2)',[ml,lock]);
    await assert.rejects(scalar("SELECT persist_marketplace_credentials($1,$2,'123','stale','stale',now()+interval '1 hour')",[ml,lock]),/reserva de execução/);
  });
  await test('Normal shipped and delivered updates do not trap an organized sale in perpetual review',async()=>{
    await db.exec('SET ROLE authenticated');await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[owner]);
    const result=await ingest([order({external_order_id:'LOGISTICS'})]), mo=result.order_ids[0];
    const sale=await scalar('SELECT create_sales_order_from_marketplace($1,$2,CURRENT_DATE+30,$3)',[mo,customer,next()]);
    assert.equal((await scalar('SELECT confirm_sales_workflow($1,NULL,NULL,$2)',[sale,next()])).outcome,'stock_ready');
    await ingest([order({external_order_id:'LOGISTICS',external_updated_at:'2026-10-10T14:00:00-03:00',external_status:'paid',normalized_state:'shipped',shipping_deadline_at:'2026-10-14T16:00:00-03:00'})]);
    assert.equal(await scalar('SELECT needs_review FROM marketplace_orders WHERE id=$1',[mo]),false);
    assert.equal(await scalar("SELECT (ship_by_at AT TIME ZONE 'UTC')::text FROM orders WHERE id=$1",[sale]),'2026-10-14 19:00:00');
    await scalar("SELECT transition_sales_order($1,'shipped')",[sale]);
    await ingest([order({external_order_id:'LOGISTICS',external_updated_at:'2026-10-10T15:00:00-03:00',normalized_state:'delivered',shipping_deadline_at:'2026-10-14T16:00:00-03:00'})]);
    await scalar("SELECT transition_sales_order($1,'delivered')",[sale]);
    assert.equal(await scalar('SELECT status FROM orders WHERE id=$1',[sale]),'delivered');
  });
  await test('Draft refresh cannot silently erase operator material choices or item instructions',async()=>{
    const result=await ingest([order({external_order_id:'CHOICES'})]), mo=result.order_ids[0];
    const sale=await scalar('SELECT create_sales_order_from_marketplace($1,$2,CURRENT_DATE+30,$3)',[mo,customer,next()]);
    await db.exec('RESET ROLE');await db.query("UPDATE order_items SET notes='PLA azul escolhido pela operadora' WHERE order_id=$1",[sale]);await db.exec('SET ROLE authenticated');
    const changed=order({external_order_id:'CHOICES',external_updated_at:'2026-10-10T16:00:00-03:00',reported_total:44,items:[{...order().items[0],unit_price:21}]});await ingest([changed]);
    await assert.rejects(scalar('SELECT create_sales_order_from_marketplace($1,$2,CURRENT_DATE+30,$3)',[mo,customer,next()]),/não pode apagar essas escolhas/);
    assert.equal(await scalar('SELECT notes FROM order_items WHERE order_id=$1',[sale]),'PLA azul escolhido pela operadora');
    assert.equal(Number(await scalar('SELECT total FROM orders WHERE id=$1',[sale])),42);
  });
  await test('Cancellation blocks new and resumed printing while allowing accounting stages on already-started work',async()=>{
    const result=await ingest([order({external_order_id:'JOB-GATE'})]), mo=result.order_ids[0];
    const sale=await scalar('SELECT create_sales_order_from_marketplace($1,$2,CURRENT_DATE+30,$3)',[mo,customer,next()]);
    await db.exec('RESET ROLE');
    const queued=await scalar("INSERT INTO jobs(tenant_id,code,name,status,order_id,product_id) VALUES($1,'QA-Q','Queued','queued',$2,$3) RETURNING id",[tenant,sale,product]);
    const active=await scalar("INSERT INTO jobs(tenant_id,code,name,status,order_id,product_id) VALUES($1,'QA-P','Paused','paused',$2,$3) RETURNING id",[tenant,sale,product]);
    await db.exec('SET ROLE authenticated');
    await ingest([order({external_order_id:'JOB-GATE',external_updated_at:'2026-10-10T17:00:00-03:00',external_status:'cancelled',normalized_state:'cancelled'})]);
    await db.exec('RESET ROLE');
    await assert.rejects(db.query("UPDATE jobs SET status='printing' WHERE id=$1",[queued]),/impressão não pode iniciar ou retomar/);
    await assert.rejects(db.query("UPDATE jobs SET status='printing' WHERE id=$1",[active]),/impressão não pode iniciar ou retomar/);
    await db.query("UPDATE jobs SET status='post_processing' WHERE id=$1",[active]);
    assert.equal(await scalar('SELECT status FROM jobs WHERE id=$1',[active]),'post_processing');
  });
  await test('Explicit review rejects changed totals and releases only reconciled paid sales without erasing choices',async()=>{
    await db.exec('SET ROLE authenticated');await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[owner]);
    const mo=await scalar("SELECT id FROM marketplace_orders WHERE external_order_id='CHOICES'");
    const sale=await scalar('SELECT internal_order_id FROM marketplace_orders WHERE id=$1',[mo]);
    await assert.rejects(scalar("SELECT review_marketplace_order($1,'Pedido conferido no canal')",[mo]),/Valores.*divergem/);
    await db.exec('RESET ROLE');await db.query('UPDATE orders SET total=44 WHERE id=$1',[sale]);
    await db.query('UPDATE order_items SET unit_price=21,total=42 WHERE order_id=$1',[sale]);await db.exec('SET ROLE authenticated');
    await scalar("SELECT review_marketplace_order($1,'Preços atualizados em Pedidos, materiais e observações conferidos')",[mo]);
    assert.equal(await scalar('SELECT needs_review FROM marketplace_orders WHERE id=$1',[mo]),false);
    assert.equal(await scalar('SELECT notes FROM order_items WHERE order_id=$1',[sale]),'PLA azul escolhido pela operadora');
    await scalar("SELECT review_marketplace_order($1,'Retry da mesma revisão')",[mo]);
    assert.equal(await scalar("SELECT count(*)::int FROM audit_log WHERE action='marketplace_review' AND record_id=$1",[mo]),1);
    await assert.rejects(scalar("SELECT review_marketplace_order($1,'Cancelamento ainda existente')",[canonical]),/confirmar pagamento/);
    await ingest([order({external_updated_at:'2026-10-10T18:00:00-03:00'})]);
    assert.equal(await scalar('SELECT needs_review FROM marketplace_orders WHERE id=$1',[canonical]),true);
    await scalar("SELECT review_marketplace_order($1,'Pagamento confirmado novamente e todos os valores conferidos no canal')",[canonical]);
    assert.equal(await scalar('SELECT needs_review FROM marketplace_orders WHERE id=$1',[canonical]),false);
    await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[viewer]);
    await assert.rejects(scalar("SELECT review_marketplace_order($1,'Tentativa viewer inválida')",[mo]),/permissão/);
  });
  await test('An earlier upstream cutoff is durably imported as urgent review when it conflicts with the local production target',async()=>{
    await db.exec('SET ROLE authenticated');await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[owner]);
    const result=await ingest([order({external_order_id:'SHORT-DEADLINE'})]),mo=result.order_ids[0];
    const sale=await scalar('SELECT create_sales_order_from_marketplace($1,$2,CURRENT_DATE+30,$3)',[mo,customer,next()]);
    await db.exec('RESET ROLE');await db.query("UPDATE orders SET internal_due_at='2026-10-13T16:00:00-03:00' WHERE id=$1",[sale]);await db.exec('SET ROLE authenticated');
    // SLA is fetched independently and may change while the Orders revision is unchanged.
    const tighter=order({external_order_id:'SHORT-DEADLINE',shipping_deadline_at:'2026-10-13T12:00:00-03:00'});
    await ingest([tighter]);assert.equal((await ingest([tighter])).unchanged,1);
    assert.equal(await scalar('SELECT needs_review FROM marketplace_orders WHERE id=$1',[mo]),true);
    assert.equal(await scalar("SELECT (shipping_deadline_at AT TIME ZONE 'UTC')::text FROM marketplace_orders WHERE id=$1",[mo]),'2026-10-13 15:00:00');
    assert.equal(await scalar("SELECT (ship_by_at AT TIME ZONE 'UTC')::text FROM orders WHERE id=$1",[sale]),'2026-10-13 20:00:00');
    await assert.rejects(scalar("SELECT review_marketplace_order($1,'Prazo antecipado conferido no canal')",[mo]),/Ajuste a meta interna/);
    await db.exec('RESET ROLE');await db.query("UPDATE orders SET internal_due_at='2026-10-13T10:00:00-03:00' WHERE id=$1",[sale]);await db.exec('SET ROLE authenticated');
    await scalar("SELECT review_marketplace_order($1,'Meta interna ajustada após conferir o novo prazo oficial')",[mo]);
    assert.equal(await scalar("SELECT (ship_by_at AT TIME ZONE 'UTC')::text FROM orders WHERE id=$1",[sale]),'2026-10-13 15:00:00');
  });
  console.log(`${passed} marketplace inbox scenarios passed.`);
} finally { await db.close(); }
