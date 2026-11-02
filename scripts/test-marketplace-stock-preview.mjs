import { PGlite } from '@electric-sql/pglite';
import { readdir, readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const db=new PGlite();
await db.exec(`CREATE ROLE authenticated;CREATE ROLE anon;CREATE ROLE service_role;CREATE SCHEMA auth;
CREATE TABLE auth.users(id uuid PRIMARY KEY,email text);CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
CREATE SCHEMA storage;CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean);CREATE TABLE storage.objects(id uuid DEFAULT gen_random_uuid(),bucket_id text,name text,owner uuid);
CREATE FUNCTION storage.foldername(text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$SELECT string_to_array($1,'/')$$;
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;CREATE PUBLICATION supabase_realtime;GRANT USAGE ON SCHEMA public,auth,storage TO authenticated,anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO authenticated;`);
for(const name of (await readdir(new URL('../supabase/migrations/',import.meta.url))).filter(name=>name.endsWith('.sql')&&name<='20261102235600_marketplace_stock_preview_snapshot.sql').sort()){
 try{await db.exec((await readFile(new URL('../supabase/migrations/'+name,import.meta.url),'utf8')).replace(/CREATE EXTENSION IF NOT EXISTS (pg_cron|pg_net);/g,''));}
 catch(error){throw new Error(`Migration ${name}: ${error.message}`);}
}
const id=n=>`77000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const tenant=id(1),otherTenant=id(2),owner=id(3),operator=id(4),viewer=id(5),otherOwner=id(6),stock=id(7),gramStock=id(8),zeroStock=id(9),product=id(10),gramsProduct=id(11),zeroProduct=id(12),unboundProduct=id(13),foreignProduct=id(14),customer=id(15),bridge=id(16);
let sequence=100,passed=0;const next=()=>id(sequence++);
const scalar=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0];
const login=async uid=>{await db.exec('SET ROLE authenticated');await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[uid]);};
const admin=async fn=>{await db.exec('RESET ROLE');try{return await fn();}finally{await db.exec('SET ROLE authenticated');}};
await db.query("INSERT INTO auth.users VALUES($1,'owner@qa.invalid'),($2,'operator@qa.invalid'),($3,'viewer@qa.invalid'),($4,'foreign@qa.invalid')",[owner,operator,viewer,otherOwner]);
await db.query("INSERT INTO tenants(id,name,slug) VALUES($1,'Stock QA','stock-qa'),($2,'Other QA','other-stock-qa')",[tenant,otherTenant]);
await db.query("INSERT INTO profiles(user_id,tenant_id,display_name) VALUES($1,$5,'Owner'),($2,$5,'Operator'),($3,$5,'Viewer'),($4,$6,'Other')",[owner,operator,viewer,otherOwner,tenant,otherTenant]);
await db.query("INSERT INTO user_roles(user_id,tenant_id,role) VALUES($1,$5,'owner'),($2,$5,'operator'),($3,$5,'viewer'),($4,$6,'owner')",[owner,operator,viewer,otherOwner,tenant,otherTenant]);
await db.query("INSERT INTO customers(id,tenant_id,name) VALUES($1,$2,'Customer QA')",[customer,tenant]);
await db.query("INSERT INTO inventory_items(id,tenant_id,name,unit,current_stock,avg_cost) VALUES($1,$4,'Ready stock','un',20,5),($2,$4,'Wrong unit','g',1000,.05),($3,$4,'Known zero','un',0,5)",[stock,gramStock,zeroStock,tenant]);
await db.query("INSERT INTO products(id,tenant_id,name,category,sale_price,stock_item_id) VALUES($1,$6,'Ready product','printed_part',25,$7),($2,$6,'Weight is not finished units','printed_part',20,$8),($3,$6,'Zero ready product','printed_part',15,$9),($4,$6,'Unbound product','printed_part',9,NULL),($5,$10,'Foreign product','printed_part',8,NULL)",[product,gramsProduct,zeroProduct,unboundProduct,foreignProduct,tenant,stock,gramStock,zeroStock,otherTenant]);
await db.query("INSERT INTO integrador_bridge_bindings(id,tenant_id,approved_seller_ids,approved_by,approval_note) VALUES($1,$2,ARRAY['381','382'],$3,'Explicit synthetic test approval only')",[bridge,tenant,owner]);
await login(owner);
const wrongAccount=await scalar("SELECT save_marketplace_account('mercado_livre','Existing seller 6','6')");
const account=await scalar("SELECT link_integrador_marketplace_account('381','Approved seller',NULL,$1)",[next()]);
const otherAccount=await scalar("SELECT save_marketplace_account('shopee','Other company channel','381')");
for(const [pid,item]of [[product,'ITEM'],[gramsProduct,'GRAMS'],[zeroProduct,'ZERO']])await scalar("SELECT save_marketplace_sku_binding($1,$2,'','SKU-'||$2,$3)",[account,item,pid]);
await scalar("SELECT save_marketplace_sku_binding($1,'ITEM','','SKU-ITEM',$2)",[otherAccount,product]);
const snapshot=(ids=[product],selectedAccount=account)=>scalar('SELECT marketplace_stock_preview_snapshot($1,$2::uuid[])',[selectedAccount,ids]);
const line=(external_line_id,quantity,external_item_id='ITEM')=>({external_line_id,external_item_id,external_variant_id:'',external_sku:'SKU-'+external_item_id,description:'Product '+external_line_id,quantity,unit_price:25});
const order=(external_order_id,items=[line('1',2)])=>({external_order_id,external_status:'paid',normalized_state:'paid',external_updated_at:'2026-11-02T12:00:00Z',shipping_deadline_at:'2026-11-05T18:00:00Z',deadline_source:'Synthetic SLA',currency:'BRL',shipping_amount:0,discount_amount:0,reported_total:items.reduce((sum,item)=>sum+item.quantity*25,0),items});
const ingest=async(data,selectedAccount=account)=>(await scalar('SELECT import_marketplace_orders($1,$2::jsonb)',[selectedAccount,JSON.stringify([data])])).order_ids[0];
const createSale=async mo=>scalar("SELECT create_sales_order_from_marketplace($1,$2,'2026-12-01',$3)",[mo,customer,next()]);
async function acceptPrice(unitPrice){await admin(async()=>{const acceptance=next();await db.query("INSERT INTO product_channel_pricing_acceptances(id,tenant_id,product_id,channel,quantity,unit_cost,unit_price,cost_revision,policy_revision,preview_revision,snapshot,created_by) VALUES($1,$2,$3,'mercado_livre',1,5,$4,'cost-r','policy-r','preview-r','{}',$5)",[acceptance,tenant,product,unitPrice,owner]);await db.query("INSERT INTO product_channel_prices(tenant_id,product_id,channel,acceptance_id,unit_price) VALUES($1,$2,'mercado_livre',$3,$4) ON CONFLICT(tenant_id,product_id,channel) DO UPDATE SET acceptance_id=excluded.acceptance_id,unit_price=excluded.unit_price,updated_at=clock_timestamp()",[tenant,product,acceptance,unitPrice]);});}
async function test(name,fn){await fn();passed++;console.log('PASS '+name);}
try{
 await test('Requires an explicit approved seller/account binding and validates every requested product',async()=>{
  await assert.rejects(snapshot([product],wrongAccount),/Vincule explicitamente/);
  await assert.rejects(scalar("SELECT link_integrador_marketplace_account('381','Wrong association',$1,$2)",[wrongAccount,next()]),/outro vendedor/);
  for(const ids of [[],[product,product],[unboundProduct],[foreignProduct]])await assert.rejects(snapshot(ids),/Selecione|fora dos vínculos/);
  const a=await snapshot([product,gramsProduct]),b=await snapshot([gramsProduct,product]);assert.equal(a.revision,b.revision);assert.equal(a.sellerId,'381');assert.equal(a.bridgeId,bridge);assert.equal(a.products.length,2);
  assert(a.competingBindings.some(row=>row.accountId===otherAccount&&row.channel==='shopee'&&row.sourceBound===false));assert(a.bindings.every(row=>row.accountId===account&&row.sourceBound===true&&row.bridgeId===bridge));
 });
 await test('Uses finished_stock_free holds once and keeps known zero separate from invalid finished-stock units',async()=>{
  await admin(async()=>{const sale=next(),channel=next(),request=next();await db.query("INSERT INTO orders(id,tenant_id,code,status) VALUES($1,$2,'HOLD-QA','draft')",[sale,tenant]);await db.query("INSERT INTO storefront_channels(id,tenant_id,slug,name) VALUES($1,$2,'stock-hold-qa','QA')",[channel,tenant]);await db.query("INSERT INTO storefront_requests(id,tenant_id,channel_id,request_id,order_id,payload,contact_key) VALUES($1,$2,$3,$4,$5,'{}','qa')",[request,tenant,channel,next(),sale]);await db.query("INSERT INTO erp_private.storefront_stock_holds(request_id,tenant_id,item_id,quantity,expires_at) VALUES($1,$2,$3,3,now()+interval '1 hour')",[request,tenant,stock]);});
  const result=await snapshot([product,gramsProduct,zeroProduct]);assert.equal(result.products.find(row=>row.productId===product).available,17);
  assert.deepEqual(result.products.find(row=>row.productId===zeroProduct).available,0);assert.equal(result.products.find(row=>row.productId===zeroProduct).stockComplete,true);
  assert.equal(result.products.find(row=>row.productId===gramsProduct).available,null);assert.equal(result.products.find(row=>row.productId===gramsProduct).unitConversion,null);
 });
 await test('Imported drafts remain uncovered; a confirmed ledger-backed allocation is not deducted twice',async()=>{
  const mo=await ingest(order('DRAFT')),sale=await createSale(mo);let result=await snapshot();assert.equal(result.externalPaidOrders.find(row=>row.externalOrderId==='DRAFT').quantityAlreadyAccounted,0);
  await scalar('SELECT fulfill_order_from_stock($1)',[sale]);result=await snapshot();assert.equal(result.products[0].available,15);assert.equal(result.externalPaidOrders.find(row=>row.externalOrderId==='DRAFT').quantityAlreadyAccounted,2);
  assert.equal(result.finishedAvailability[0].available-result.externalPaidOrders.reduce((sum,row)=>sum+row.quantity-(row.quantityAlreadyAccounted??0),0),15);
 });
 await test('Partial allocations are distributed once across repeated external product lines, with outgoing-ledger proof',async()=>{
  const mo=await ingest(order('PARTIAL',[line('1',2),line('2',3)])),sale=await createSale(mo);
  const items=(await db.query('SELECT id,quantity FROM order_items WHERE order_id=$1 ORDER BY quantity',[sale])).rows;
  await admin(async()=>{await db.query("INSERT INTO inventory_movements(tenant_id,item_id,movement_type,quantity,reference_type,reference_id,created_by,notes) VALUES($1,$2,'adjustment',-3,'sales_order_stock',$3,$4,'Synthetic ledger-backed partial allocation')",[tenant,stock,sale,owner]);for(const [index,qty]of [[0,2],[1,1]])await db.query('INSERT INTO order_stock_allocations(tenant_id,order_id,order_item_id,product_id,item_id,quantity,unit_cost,total_cost) VALUES($1,$2,$3,$4,$5,$6,5,$7)',[tenant,sale,items[index].id,product,stock,qty,qty*5]);});
  const result=await snapshot(),partial=result.externalPaidOrders.filter(row=>row.externalOrderId==='PARTIAL');assert.deepEqual(partial.map(row=>row.quantityAlreadyAccounted),[2,1]);assert.equal(result.products[0].available,12);assert.equal(partial.reduce((sum,row)=>sum+row.quantityAlreadyAccounted,0),3);
  await ingest(order('OTHER-CHANNEL',[line('1',1)]),otherAccount);const withOther=await snapshot();assert(withOther.externalPaidOrders.some(row=>row.channel==='shopee'&&row.quantityAlreadyAccounted===0));
  assert.equal(withOther.finishedAvailability[0].available-withOther.externalPaidOrders.reduce((sum,row)=>sum+row.quantity-row.quantityAlreadyAccounted,0),9);
 });
 await test('Keeps accepted ML price separate and invalidates revisions after stock, order or equal-valued acceptance changes',async()=>{
  await acceptPrice(33.33);let before=await snapshot();assert.equal(before.products[0].basePrice,25);assert.equal(before.products[0].acceptedMlPrice.unitPrice,33.33);
  await admin(()=>db.query('UPDATE inventory_items SET current_stock=current_stock+1 WHERE id=$1',[stock]));let after=await snapshot();assert.notEqual(after.revision,before.revision);before=after;
  await ingest(order('NEW-PAID',[line('1',1)]));after=await snapshot();assert.notEqual(after.revision,before.revision);before=after;
  await acceptPrice(33.33);after=await snapshot();assert.notEqual(after.revision,before.revision);assert.equal(after.products[0].basePrice,25);
 });
 await test('Completed order production is fulfillment evidence without inventing a finished-stock ledger debit',async()=>{
  const mo=await ingest(order('PRODUCED')),sale=await createSale(mo),sourceItem=await scalar('SELECT id FROM order_items WHERE order_id=$1',[sale]),production=next();const before=await snapshot();
  await admin(async()=>{await db.query("INSERT INTO production_orders(id,tenant_id,code,source_order_id,status,completed_at) VALUES($1,$2,'PROOF-OP',$3,'completed',now())",[production,tenant,sale]);await db.query("INSERT INTO production_order_items(tenant_id,production_order_id,source_order_item_id,product_id,description,quantity,line_index) VALUES($1,$2,$3,$4,'Completed made-to-order units',2,1)",[tenant,production,sourceItem,product]);await db.query("UPDATE orders SET status='ready' WHERE id=$1",[sale]);});
  const result=await snapshot(),paid=result.externalPaidOrders.find(row=>row.externalOrderId==='PRODUCED');assert.equal(result.products[0].available,before.products[0].available);assert.equal(paid.quantityAlreadyAccounted,2);assert.equal(paid.ledgerDebit,0);assert.equal(paid.completedProductionEvidence[0].productionOrderId,production);
 });
 await test('Flags unbound paid demand and advertises only local inbox evidence, not remote completeness',async()=>{
  await ingest(order('UNBOUND',[line('1',1,'UNKNOWN')]));const result=await snapshot();assert.equal(result.localInboxComplete,false);assert.equal(result.requiresRemoteOrderRead,true);assert.equal(result.writesEnabled,false);assert.equal(result.previewOnly,true);assert(result.externalPaidOrders.some(row=>row.productId===null));
 });
 await test('STABLE reads one SQL snapshot even when the outer statement updates stock and base price',async()=>{
  const before=await snapshot();const coherent=await admin(()=>scalar('WITH changed_stock AS(UPDATE inventory_items SET current_stock=current_stock+7 WHERE id=$1 RETURNING id),changed_price AS(UPDATE products SET sale_price=99 WHERE id=$2 RETURNING id) SELECT marketplace_stock_preview_snapshot($3,$4::uuid[]) FROM changed_stock,changed_price',[stock,product,account,[product]]));
  assert.equal(coherent.products[0].available,before.products[0].available);assert.equal(coherent.products[0].basePrice,before.products[0].basePrice);const after=await snapshot();assert.equal(after.products[0].available,before.products[0].available+7);assert.equal(after.products[0].basePrice,99);
 });
 await test('Reads do not create movements, requests or audit rows and financial/tenant permissions fail closed',async()=>{
  const counts=()=>admin(()=>scalar("SELECT jsonb_build_array((SELECT count(*) FROM inventory_movements),(SELECT count(*) FROM audit_log),(SELECT count(*) FROM erp_private.requests))"));const before=await counts();await snapshot();await snapshot();assert.deepEqual(await counts(),before);
  for(const uid of [operator,viewer,otherOwner]){await login(uid);await assert.rejects(snapshot(),/permissão|Vincule explicitamente/);}await login(owner);
  await db.exec('SET ROLE anon');await assert.rejects(snapshot(),/permission denied/);await login('');await assert.rejects(snapshot(),/permissão/);await login(owner);
 });
 console.log(`Validated ${passed} coherent marketplace stock/price snapshot scenarios without provider calls or production writes.`);
 console.log('Snapshot function MD5 '+await admin(()=>scalar("SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid='public.marketplace_stock_preview_snapshot(uuid,uuid[])'::regprocedure")));
}catch(error){throw new Error(error.message+(error.where?' · '+error.where:''));}finally{await db.close();}
