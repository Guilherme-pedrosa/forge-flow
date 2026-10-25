import { PGlite } from '@electric-sql/pglite';
import { readdir, readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const db = new PGlite();
// CURRENT_DATE in fixtures must use the same calendar as the test companies.
await db.exec("SET TIME ZONE 'America/Sao_Paulo'");
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
const id = n => `72000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const tenant=id(1), foreignTenant=id(2), owner=id(3), other=id(4), viewer=id(5), operator=id(6), customer=id(7), product=id(8), stock=id(9), bank=id(10), foreignBank=id(11), inactiveBank=id(12);
let sequence=100, passed=0;
const next=()=>id(sequence++);
const scalar=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0];
const number=async(sql,args=[])=>Number(await scalar(sql,args));
const row=async(sql,args=[]) => (await db.query(sql,args)).rows[0];
await db.query("INSERT INTO auth.users VALUES($1,'owner@qa.invalid'),($2,'other@qa.invalid'),($3,'viewer@qa.invalid'),($4,'operator@qa.invalid')",[owner,other,viewer,operator]);
await db.query("INSERT INTO tenants(id,name,slug) VALUES($1,'Payout QA','payout-qa'),($2,'Foreign QA','foreign-payout-qa')",[tenant,foreignTenant]);
await db.query("INSERT INTO profiles(user_id,tenant_id,display_name) VALUES($1,$5,'Owner'),($2,$6,'Other'),($3,$5,'Viewer'),($4,$5,'Operator')",[owner,other,viewer,operator,tenant,foreignTenant]);
await db.query("INSERT INTO user_roles(user_id,tenant_id,role) VALUES($1,$5,'owner'),($2,$6,'owner'),($3,$5,'viewer'),($4,$5,'operator')",[owner,other,viewer,operator,tenant,foreignTenant]);
await db.query("INSERT INTO customers(id,tenant_id,name) VALUES($1,$2,'Payout customer')",[customer,tenant]);
await db.query("INSERT INTO inventory_items(id,tenant_id,name,unit,current_stock,avg_cost) VALUES($1,$2,'Ready pieces','un',50,30)",[stock,tenant]);
await db.query("INSERT INTO products(id,tenant_id,name,category,sale_price,stock_item_id) VALUES($1,$2,'Ready SKU','printed_part',100,$3)",[product,tenant,stock]);
await db.query("INSERT INTO bank_accounts(id,tenant_id,name,current_balance,is_active) VALUES($1,$4,'Actual cash',0,true),($2,$5,'Foreign cash',0,true),($3,$4,'Archived cash',0,false)",[bank,foreignBank,inactiveBank,tenant,foreignTenant]);
const login=async(user=owner)=>{ await db.exec('SET ROLE authenticated'); await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[user]); };
await login();
const today=await scalar("SELECT (now() AT TIME ZONE timezone)::date::text FROM tenants WHERE id=$1",[tenant]);
const account=await scalar("SELECT save_marketplace_account('shopee','Payout shop',NULL)");
await scalar("SELECT save_marketplace_sku_binding($1,'SKU-ID','BLUE','SKU',$2)",[account,product]);
async function sale(external) {
 const payload={external_order_id:external,external_status:'paid',normalized_state:'paid',external_updated_at:'2026-10-10T12:00:00-03:00',shipping_deadline_at:'2026-10-13T17:00:00-03:00',deadline_source:'official order',currency:'BRL',shipping_amount:0,discount_amount:0,reported_total:100,items:[{external_line_id:'1',external_item_id:'SKU-ID',external_variant_id:'BLUE',external_sku:'SKU',description:'Ready item',quantity:1,unit_price:100}]};
 const canonical=(await scalar('SELECT import_marketplace_orders($1,$2::jsonb)',[account,JSON.stringify([payload])])).order_ids[0];
 const order=await scalar('SELECT create_sales_order_from_marketplace($1,$2,CURRENT_DATE+30,$3)',[canonical,customer,next()]);
 assert.equal((await scalar('SELECT confirm_sales_workflow($1,NULL,NULL,$2)',[order,next()])).outcome,'stock_ready');
 return {order,canonical,title:await scalar('SELECT id FROM accounts_receivable WHERE origin_id=$1',[order])};
}
const values=(fields={})=>({external_reference:next(),transaction_date:today,competence_date:today,gross_amount:100,fees:0,freight:0,other_debit:0,retained_amount:0,fee_credit:0,freight_credit:0,other_credit:0,net_amount:100,bank_account_id:bank,related_settlement_id:null,notes:'Extrato conferido pelo operador',...fields});
const post=(title,kind,payload,request=next())=>scalar('SELECT record_marketplace_settlement($1,$2,$3::jsonb,$4)',[title,kind,JSON.stringify(payload),request]);
const positions=title=>row('SELECT * FROM marketplace_receivable_positions WHERE receivable_id=$1',[title]);
const counts=()=>row(`SELECT (SELECT count(*)::int FROM marketplace_settlements) settlements,(SELECT count(*)::int FROM bank_transactions) bank,(SELECT count(*)::int FROM accounts_payable) costs`);
async function test(name,fn){await fn();passed++;console.log('PASS '+name);}
try {
 const original=await sale('SETTLEMENT-1'); let payout,release;
 const first=values({external_reference:'PAYOUT-1',fees:10,freight:5,retained_amount:20,net_amount:65}), request=next();
 await test('Gross sale and title stay 100; only net 65 enters cash, with costs 15 compensated and retention 20 outstanding',async()=>{
  payout=await post(original.title,'payout',first,request);
  assert.equal(await number('SELECT current_balance FROM bank_accounts WHERE id=$1',[bank]),65);
  assert.equal(await number('SELECT sum(amount) FROM bank_transactions WHERE reference_id=$1',[original.title]),65);
  assert.equal(await scalar('SELECT type FROM bank_transactions WHERE reference_id=$1',[original.title]),'credit');
  assert.equal(await number('SELECT sum(amount) FROM accounts_payable WHERE origin_id=$1',[payout]),15);
  assert.equal(await number("SELECT count(*) FROM accounts_payable WHERE origin_id=$1 AND status='paid' AND amount_paid=amount AND bank_account_id IS NULL",[payout]),2);
  assert.equal(await number('SELECT total FROM orders WHERE id=$1',[original.order]),100);
  assert.equal(await number('SELECT discount FROM orders WHERE id=$1',[original.order]),0);
  const position=await positions(original.title);
  for(const [key,value] of Object.entries({gross_title_amount:100,liquidated_gross:80,outstanding_gross:20,retained_open:20,available_gross:0,net_bank:65})) assert.equal(Number(position[key]),value,key);
  assert.equal(position.status,'partial');
 });
 await test('Same request and same external reference with new request return the original event without extra cash or expenses',async()=>{
  assert.equal(await post(original.title,'payout',first,request),payout);
  assert.equal(await post(original.title,'payout',first),payout);
  assert.deepEqual(await counts(),{settlements:1,bank:1,costs:2});
  await assert.rejects(post(original.title,'payout',{...first,notes:'Changed evidence'},request),/outra operação|já utilizado/);
  await assert.rejects(post(original.title,'payout',{...first,notes:'Changed evidence'}),/dados diferentes/);
  assert.deepEqual(await counts(),{settlements:1,bank:1,costs:2});
 });
 await test('Ordinary gross-cash settlement cannot consume marketplace principal or double pay compensated expense',async()=>{
  await assert.rejects(scalar("SELECT settle_financial_title('receivable',$1,10,CURRENT_DATE,$2,$3)",[original.title,bank,next()]),/Repasses/);
  const cost=await scalar('SELECT id FROM accounts_payable WHERE origin_id=$1 LIMIT 1',[payout]);
  await assert.rejects(scalar("SELECT settle_financial_title('payable',$1,1,CURRENT_DATE,$2,$3)",[cost,bank,next()]),/compensada/);
  await assert.rejects(db.query('DELETE FROM accounts_payable WHERE id=$1',[cost]),/histórico/);
  await assert.rejects(db.query('UPDATE accounts_payable SET amount=11 WHERE id=$1',[cost]),/histórico/);
 });
 await test('Retention must be released from its exact origin and is liquidated once without recording new revenue',async()=>{
  await assert.rejects(post(original.title,'payout',values({gross_amount:20,net_amount:20})),/retenções/);
  await assert.rejects(post(original.title,'release',values({gross_amount:21,net_amount:21,related_settlement_id:payout})),/supera/);
  release=await post(original.title,'release',values({external_reference:'RELEASE-1',gross_amount:20,net_amount:20,related_settlement_id:payout}));
  const position=await positions(original.title);
  assert.equal(Number(position.liquidated_gross),100); assert.equal(position.status,'received');
  assert.equal(Number(position.outstanding_gross),0);assert.equal(Number(position.retained_open),0);
  assert.equal(await number('SELECT current_balance FROM bank_accounts WHERE id=$1',[bank]),85);
  await assert.rejects(post(original.title,'release',values({gross_amount:1,net_amount:1,related_settlement_id:payout})),/supera/);
 });
 await test('Partial refund preserves the original gross and cost history; signed adjustments reconcile net 67 with result 37 after stock cost 30',async()=>{
  await post(original.title,'refund',values({external_reference:'REFUND-1',gross_amount:20,net_amount:-18,fee_credit:2,related_settlement_id:payout}));
  assert.equal(await number('SELECT amount FROM accounts_receivable WHERE id=$1',[original.title]),100);
  assert.equal(await number('SELECT amount_received FROM accounts_receivable WHERE id=$1',[original.title]),100);
  assert.equal(await number('SELECT total FROM orders WHERE id=$1',[original.order]),100);
  assert.equal(await number('SELECT current_balance FROM bank_accounts WHERE id=$1',[bank]),67);
  assert.equal(await number('SELECT sum(amount) FROM accounts_payable WHERE origin_id=$1',[payout]),15);
  const result=await row(`SELECT r.amount + coalesce((SELECT sum(amount_signed) FROM marketplace_settlement_components c JOIN marketplace_settlements s ON s.id=c.settlement_id WHERE s.receivable_id=r.id AND c.kind='refund'),0) AS revenue,
  (SELECT sum(p.amount) FROM accounts_payable p JOIN marketplace_settlements s ON s.id=p.origin_id WHERE s.receivable_id=r.id) + coalesce((SELECT sum(amount_signed) FROM marketplace_settlement_components c JOIN marketplace_settlements s ON s.id=c.settlement_id WHERE s.receivable_id=r.id AND c.kind IN('fee_credit','freight_credit','other_credit')),0) AS expenses,
  (SELECT sum(total_cost) FROM order_stock_allocations WHERE order_id=r.origin_id AND reversed_at IS NULL) AS stock_cost FROM accounts_receivable r WHERE r.id=$1`,[original.title]);
  assert.equal(Number(result.revenue),80);assert.equal(Number(result.expenses),13);assert.equal(Number(result.stock_cost),30);
  assert.equal(Number(result.revenue)-Number(result.expenses)-Number(result.stock_cost),37);
  assert.equal(await number('SELECT current_stock FROM inventory_items WHERE id=$1',[stock]),49);
 });
 await test('Post-payout cost credits use zero gross, increase only actual cash and cannot exceed original recorded costs',async()=>{
  await post(original.title,'adjustment',values({external_reference:'COST-CREDIT',gross_amount:0,fee_credit:8,net_amount:8,related_settlement_id:payout}));
  assert.equal(await number('SELECT current_balance FROM bank_accounts WHERE id=$1',[bank]),75);
  assert.equal(await number('SELECT amount_received FROM accounts_receivable WHERE id=$1',[original.title]),100);
  await assert.rejects(post(original.title,'adjustment',values({gross_amount:0,fee_credit:0.01,net_amount:0.01,related_settlement_id:payout})),/supera a despesa/);
  await assert.rejects(post(original.title,'adjustment',values({gross_amount:0,fees:2,fee_credit:2,net_amount:0,related_settlement_id:payout})),/supera a despesa/);
 });
 await test('Full refund credits only remaining freight cost and reconciles cash zero, revenue zero, expenses zero and real stock loss 30',async()=>{
  await post(original.title,'refund',values({external_reference:'REFUND-REST',gross_amount:60,freight_credit:5,net_amount:-55,related_settlement_id:payout}));
  await post(original.title,'refund',values({external_reference:'REFUND-RELEASE',gross_amount:20,net_amount:-20,related_settlement_id:release}));
  const position=await positions(original.title);
  assert.equal(Number(position.refunded_gross),100);assert.equal(Number(position.net_bank),0);
  assert.equal(Number(position.fees)+Number(position.freight)-Number(position.fee_credit)-Number(position.freight_credit),0);
  assert.equal(await number('SELECT current_balance FROM bank_accounts WHERE id=$1',[bank]),0);
  assert.equal(await number('SELECT current_stock FROM inventory_items WHERE id=$1',[stock]),49);
  await assert.rejects(post(original.title,'refund',values({gross_amount:1,net_amount:-1,related_settlement_id:payout})),/supera/);
 });
 let heldSale,hold;
 await test('Full retention with no bank entry remains an open forecast; even zero-liquidation history cannot be erased by cancellation',async()=>{
  heldSale=await sale('FULL-HOLD');const before=await counts();
  hold=await post(heldSale.title,'payout',values({external_reference:'HOLD-ALL',retained_amount:100,net_amount:0,bank_account_id:null}));
  assert.equal((await counts()).bank,before.bank);
  const position=await positions(heldSale.title);
  assert.equal(Number(position.liquidated_gross),0);assert.equal(Number(position.outstanding_gross),100);assert.equal(Number(position.retained_open),100);
  await assert.rejects(scalar("SELECT transition_sales_order($1,'cancelled')",[heldSale.order]),/preservar o bruto/);
  assert.equal(await scalar('SELECT status FROM orders WHERE id=$1',[heldSale.order]),'ready');
  await assert.rejects(db.query("UPDATE accounts_receivable SET status='reversed' WHERE id=$1",[heldSale.title]),/preservar o bruto/);
 });
 await test('Partial release leaves exact held forecast and rejects future consumption, missing or wrong source',async()=>{
  await post(heldSale.title,'release',values({gross_amount:40,net_amount:40,related_settlement_id:hold}));
  const position=await positions(heldSale.title);
  assert.equal(Number(position.outstanding_gross),60);assert.equal(Number(position.retained_open),60);assert.equal(Number(position.available_gross),0);
  await assert.rejects(post(heldSale.title,'payout',values({gross_amount:1,net_amount:1})),/retenções/);
  await assert.rejects(post(heldSale.title,'release',values({gross_amount:1,net_amount:1})),/origem/);
  await assert.rejects(post(heldSale.title,'release',values({gross_amount:1,net_amount:1,related_settlement_id:payout})),/mesmo recebível/);
 });
 await test('Full retained-principal reversal closes forecast without cash, cleared principal or deleting original gross',async()=>{
  const saleHeld=await sale('HELD-CANCELLED');
  const source=await post(saleHeld.title,'payout',values({retained_amount:100,net_amount:0,bank_account_id:null}));
  const before=await counts(), cash=await number('SELECT current_balance FROM bank_accounts WHERE id=$1',[bank]);
  const reversal=values({external_reference:'HELD-REVERSED',gross_amount:100,net_amount:0,bank_account_id:null,related_settlement_id:source}), request=next();
  const event=await post(saleHeld.title,'hold_reversal',reversal,request);
  assert.equal(await post(saleHeld.title,'hold_reversal',reversal,request),event);
  assert.equal(await post(saleHeld.title,'hold_reversal',reversal),event);
  const position=await positions(saleHeld.title);
  for(const key of ['liquidated_gross','outstanding_gross','available_gross','retained_open','net_bank']) assert.equal(Number(position[key]),0,key);
  assert.equal(Number(position.gross_title_amount),100);assert.equal(Number(position.cancelled_gross),100);assert.equal(position.status,'reversed');
  assert.equal(await number('SELECT amount_received FROM accounts_receivable WHERE id=$1',[saleHeld.title]),0);
  assert.equal((await counts()).bank,before.bank);assert.equal(await number('SELECT current_balance FROM bank_accounts WHERE id=$1',[bank]),cash);
  assert.equal(await number("SELECT sum(amount_signed) FROM marketplace_settlement_components WHERE settlement_id=$1 AND kind='refund'",[event]),-100);
  assert.equal(await number('SELECT amount+ (SELECT sum(amount_signed) FROM marketplace_settlement_components WHERE settlement_id=$2) FROM accounts_receivable WHERE id=$1',[saleHeld.title,event]),0);
  await assert.rejects(post(saleHeld.title,'hold_reversal',values({gross_amount:1,net_amount:0,related_settlement_id:source})),/encerrado/);
 });
 await test('Partial payout 80 plus reversal of held 20 closes forecast while cash stays 65 and received stays 80',async()=>{
  const mixed=await sale('PARTIAL-HELD-CANCELLED');
  const source=await post(mixed.title,'payout',values({fees:10,freight:5,retained_amount:20,net_amount:65}));
  const before=await counts(), cash=await number('SELECT current_balance FROM bank_accounts WHERE id=$1',[bank]);
  await assert.rejects(post(mixed.title,'hold_reversal',values({gross_amount:21,net_amount:0,bank_account_id:null,related_settlement_id:source})),/supera/);
  const event=await post(mixed.title,'hold_reversal',values({gross_amount:20,net_amount:0,bank_account_id:null,related_settlement_id:source}));
  const position=await positions(mixed.title);
  assert.equal(Number(position.liquidated_gross),80);assert.equal(Number(position.cancelled_gross),20);
  assert.equal(Number(position.outstanding_gross),0);assert.equal(Number(position.retained_open),0);assert.equal(Number(position.available_gross),0);assert.equal(Number(position.net_bank),65);
  assert.equal(await number('SELECT amount_received FROM accounts_receivable WHERE id=$1',[mixed.title]),80);
  await db.query("UPDATE accounts_receivable SET notes='Classificação conferida sem reescrever a baixa' WHERE id=$1",[mixed.title]);
  await assert.rejects(db.query('UPDATE accounts_receivable SET amount_received=100 WHERE id=$1',[mixed.title]),/bruto liquidado|Histórico financeiro/);
  assert.equal((await counts()).bank,before.bank);assert.equal(await number('SELECT current_balance FROM bank_accounts WHERE id=$1',[bank]),cash);
  await assert.rejects(post(mixed.title,'release',values({gross_amount:1,net_amount:1,related_settlement_id:source})),/supera/);
  await assert.rejects(post(mixed.title,'refund',values({gross_amount:81,net_amount:-81,related_settlement_id:source})),/supera/);
  assert.equal(await number('SELECT gross_amount FROM marketplace_settlements WHERE id=$1',[event]),20);
 });
 await test('Retained cancellation is derived exclusively from events and cannot be forged by editing a title',async()=>{
  await assert.rejects(db.query('UPDATE accounts_receivable SET marketplace_cancelled_gross=1 WHERE id=$1',[original.title]),/principal retido estornado/);
  await assert.rejects(db.query("INSERT INTO accounts_receivable(tenant_id,description,amount,due_date,marketplace_cancelled_gross) VALUES($1,'Fake hold',100,CURRENT_DATE,100)",[tenant]),/estorno do principal retido/);
 });
 await test('Invalid totals, fractions, dates, references, banks and unrelated credit sources roll back all ledger effects',async()=>{
  const candidate=await sale('INVALID-INPUT'), before=await counts(), balance=await number('SELECT current_balance FROM bank_accounts WHERE id=$1',[bank]);
  await assert.rejects(post(candidate.title,'payout',first),/outro recebível/);
  for(const [fields,pattern] of [
   [{net_amount:99.99},/líquido/], [{fees:0.001,net_amount:100},/centavos/], [{fees:-1,net_amount:101},/não negativos/],
   [{gross_amount:'NaN',net_amount:100},/finitos/], [{net_amount:'Infinity'},/finitos/],
   [{transaction_date:'2099-01-01'},/datas/], [{competence_date:'infinity'},/datas/], [{external_reference:' '},/referência/],
   [{bank_account_id:null},/bancária/], [{bank_account_id:foreignBank},/outra empresa/], [{bank_account_id:inactiveBank},/ativa/],
   [{fee_credit:1,net_amount:101,related_settlement_id:payout},/mesmo recebível/],
  ]) await assert.rejects(post(candidate.title,'payout',values(fields)),pattern);
  assert.deepEqual(await counts(),before);assert.equal(await number('SELECT current_balance FROM bank_accounts WHERE id=$1',[bank]),balance);
  assert.equal(await number('SELECT amount_received FROM accounts_receivable WHERE id=$1',[candidate.title]),0);
 });
 await test('Later debit and its exact cost credit generate signed actual cash and preserve fully settled principal',async()=>{
  const balance=await number('SELECT current_balance FROM bank_accounts WHERE id=$1',[bank]);
  const debit=await post(original.title,'adjustment',values({external_reference:'LATER-DEBIT',gross_amount:0,other_debit:3,net_amount:-3,related_settlement_id:payout}));
  assert.equal(await number('SELECT current_balance FROM bank_accounts WHERE id=$1',[bank]),balance-3);
  assert.equal(await number('SELECT sum(amount) FROM accounts_payable WHERE origin_id=$1',[debit]),3);
  await post(original.title,'adjustment',values({external_reference:'LATER-DEBIT-REVERSED',gross_amount:0,other_credit:3,net_amount:3,related_settlement_id:debit}));
  assert.equal(await number('SELECT current_balance FROM bank_accounts WHERE id=$1',[bank]),balance);
  assert.equal(await number('SELECT amount_received FROM accounts_receivable WHERE id=$1',[original.title]),100);
  await assert.rejects(post(original.title,'adjustment',values({gross_amount:0,other_credit:0.01,net_amount:0.01,related_settlement_id:debit})),/supera a despesa/);
 });
 await test('Cross-tenant, viewer, operator and anonymous actors cannot post or inspect another company',async()=>{
  const before=await counts();
  await login(other);assert.equal(await number('SELECT count(*) FROM marketplace_receivable_positions'),0);assert.equal(await number('SELECT count(*) FROM marketplace_settlements'),0);
  await assert.rejects(post(original.title,'adjustment',values({gross_amount:0,other_debit:1,net_amount:-1,related_settlement_id:payout})),/recebível ativo/);
  for(const user of [viewer,operator]) {await login(user);await assert.rejects(post(original.title,'adjustment',values({gross_amount:0,other_debit:1,net_amount:-1,related_settlement_id:payout})),/permissão/);}
  await db.exec('SET ROLE anon');await assert.rejects(post(original.title,'payout',first),/permission denied/);
  await login();assert.deepEqual(await counts(),before);
 });
 await test('Raw writes cannot bypass reconciliation and immutable snapshots remain protected even for database owner',async()=>{
  await assert.rejects(db.query('INSERT INTO marketplace_settlements(tenant_id) VALUES($1)',[tenant]),/permission denied/);
  await assert.rejects(db.query('UPDATE marketplace_settlements SET net_amount=99 WHERE id=$1',[payout]),/permission denied/);
  const cost=await scalar('SELECT id FROM accounts_payable WHERE origin_id=$1 LIMIT 1',[payout]);
  await assert.rejects(db.query("INSERT INTO accounts_payable(tenant_id,description,amount,due_date,origin_type,origin_id) VALUES($1,'Injected',1,CURRENT_DATE,'marketplace_settlement',$2)",[tenant,payout]),/Use a conciliação/);
  await db.exec('RESET ROLE');
  await assert.rejects(db.query('UPDATE marketplace_settlements SET notes=notes WHERE id=$1',[payout]),/históricas/);
  await assert.rejects(db.query('DELETE FROM marketplace_settlement_components WHERE settlement_id=$1',[payout]),/históricas/);
  await assert.rejects(db.query('UPDATE accounts_payable SET amount=amount+1 WHERE id=$1',[cost]),/histórico/);
  await assert.rejects(db.query('UPDATE accounts_receivable SET amount=110 WHERE id=$1',[original.title]),/preservar o bruto/);
  await login();
 });
 await test('Ordinary manual settlements and deletion retain their previous contracts',async()=>{
  const payable=await scalar("INSERT INTO accounts_payable(tenant_id,description,amount,due_date) VALUES($1,'Unrelated payable',10,CURRENT_DATE) RETURNING id",[tenant]);
  await scalar("SELECT settle_financial_title('payable',$1,4,CURRENT_DATE,$2,$3)",[payable,bank,next()]);
  await assert.rejects(scalar("SELECT settle_financial_title('payable',$1,7,CURRENT_DATE,$2,$3)",[payable,bank,next()]),/saldo pendente/);
  await assert.rejects(db.query('DELETE FROM accounts_payable WHERE id=$1',[payable]),/não pode ser excluído/);
  const mistake=await scalar("INSERT INTO accounts_payable(tenant_id,description,amount,due_date) VALUES($1,'Unused mistake',10,CURRENT_DATE) RETURNING id",[tenant]);
  await scalar("SELECT delete_unused_record('payable',$1)",[mistake]);assert.equal(await number('SELECT count(*) FROM accounts_payable WHERE id=$1',[mistake]),0);
  const title=await scalar("INSERT INTO accounts_receivable(tenant_id,description,amount,due_date) VALUES($1,'Unrelated manual income',10,CURRENT_DATE) RETURNING id",[tenant]);
  const balance=await number('SELECT current_balance FROM bank_accounts WHERE id=$1',[bank]);
  const request=next();const tx=await scalar("SELECT settle_financial_title('receivable',$1,10,CURRENT_DATE,$2,$3)",[title,bank,request]);
  assert.equal(await scalar("SELECT settle_financial_title('receivable',$1,10,CURRENT_DATE,$2,$3)",[title,bank,request]),tx);
  assert.equal(await number('SELECT current_balance FROM bank_accounts WHERE id=$1',[bank]),balance+10);
 });
 console.log(`Validated ${passed} PostgreSQL marketplace settlement scenarios.`);
} finally {await db.close();}
