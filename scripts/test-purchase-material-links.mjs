// Disposable PostgreSQL acceptance: new material links and unchanged legacy receipt.
// Never connects to production.
import { PGlite } from '@electric-sql/pglite';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { readFile, readdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
const repo=fileURLToPath(new URL('../',import.meta.url));
process.on('uncaughtException',error=>{console.error(error.message,error.where??'');process.exit(1);});
const db=new PGlite(), migrationName='20261102233500_purchase_material_links.sql';
const migration=await readFile(resolve(repo,'supabase/migrations',migrationName),'utf8');
await db.exec(`CREATE ROLE authenticated; CREATE ROLE anon; CREATE ROLE service_role;
 CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY,email text);
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 CREATE SCHEMA storage; CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean);
 CREATE TABLE storage.objects(id uuid DEFAULT gen_random_uuid(),bucket_id text,name text,owner uuid);
 CREATE FUNCTION storage.foldername(text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$ SELECT string_to_array($1,'/') $$;
 ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY; CREATE PUBLICATION supabase_realtime;
 GRANT USAGE ON SCHEMA public,auth,storage TO authenticated,anon;
 ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO authenticated;`);
for(const name of (await readdir(resolve(repo,'supabase/migrations'))).filter(n=>n.endsWith('.sql')&&n<migrationName).sort()){
 try{await db.exec((await readFile(resolve(repo,'supabase/migrations',name),'utf8')).replace(/CREATE EXTENSION IF NOT EXISTS (pg_cron|pg_net);/g,''));}
 catch(error){throw new Error(`Migration ${name}: ${error.message}`);}
}
const scalar=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0];
const rows=async(sql,args=[])=>(await db.query(sql,args)).rows;
const signatures=['public.create_purchase_order(jsonb,jsonb,jsonb,uuid)','public.receive_purchase_order(uuid,date)','public.save_quick_purchase(jsonb,jsonb,jsonb,uuid,boolean)','public.erp_guard_purchase_item()'];
const untouched=await Promise.all(signatures.map(sig=>scalar('SELECT pg_get_functiondef($1::regprocedure)',[sig])));
assert.equal(await scalar("SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid='public.create_purchase_order(jsonb,jsonb,jsonb,uuid)'::regprocedure"),'e43955469451409d7f8018f19c2e7253');

const id=n=>`95000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const tenant=id(1),otherTenant=id(2),owner=id(3),otherOwner=id(4),viewer=id(5),operator=id(6);
const expense=id(10),asset=id(11),center=id(12),otherCenter=id(13),inactiveAccount=id(14),inactiveCenter=id(15),foreignAccount=id(16),foreignCenter=id(17),foreignMethod=id(18),vendor=id(19),method=id(20),grams=id(21),kilograms=id(22);
let sequence=100,passed=0;const next=()=>id(sequence++),near=(actual,expected)=>assert.ok(Math.abs(Number(actual)-expected)<1e-6,`${actual} != ${expected}`);
await db.query("INSERT INTO auth.users VALUES($1,'owner@purchase.invalid'),($2,'other@purchase.invalid'),($3,'viewer@purchase.invalid'),($4,'operator@purchase.invalid')",[owner,otherOwner,viewer,operator]);
await db.query("INSERT INTO tenants(id,name,slug) VALUES($1,'Purchase review QA','purchase-review-qa'),($2,'Other purchase QA','purchase-review-other')",[tenant,otherTenant]);
await db.query("INSERT INTO profiles(user_id,tenant_id,display_name) VALUES($1,$5,'Owner'),($2,$6,'Other'),($3,$5,'Viewer'),($4,$5,'Operator')",[owner,otherOwner,viewer,operator,tenant,otherTenant]);
await db.query("INSERT INTO user_roles(user_id,tenant_id,role) VALUES($1,$5,'owner'),($2,$6,'owner'),($3,$5,'viewer'),($4,$5,'operator')",[owner,otherOwner,viewer,operator,tenant,otherTenant]);
await db.query("INSERT INTO chart_of_accounts(id,tenant_id,code,name,account_type,is_active) VALUES($1,$5,'EXP','Materials','expense',true),($2,$5,'AST','Assets','asset',true),($3,$5,'OFF','Inactive','expense',false),($4,$6,'FOREIGN','Foreign','expense',true)",[expense,asset,inactiveAccount,foreignAccount,tenant,otherTenant]);
await db.query("INSERT INTO cost_centers(id,tenant_id,code,name,is_active) VALUES($1,$5,'PROD','Production',true),($2,$5,'OTHER','Other area',true),($3,$5,'OFF','Inactive',false),($4,$6,'FOREIGN','Foreign',true)",[center,otherCenter,inactiveCenter,foreignCenter,tenant,otherTenant]);
await db.query("INSERT INTO vendors(id,tenant_id,name,document) VALUES($1,$2,'Fornecedor XML','12345678000195')",[vendor,tenant]);
await db.query("INSERT INTO payment_methods(id,tenant_id,name,type) VALUES($1,$3,'Boleto conferido','boleto'),($2,$4,'Foreign payment','pix')",[method,foreignMethod,tenant,otherTenant]);
await db.query("INSERT INTO inventory_items(id,tenant_id,name,category,unit,current_stock,avg_cost,material_code,color,color_code) VALUES($1,$3,'PLA Branco','filament','g',1000,.05,'PLA','Branco','BRANCO'),($2,$3,'PLA Azul','filament','kg',1.5,40,'PLA','Azul','AZUL')",[grams,kilograms,tenant]);
await db.exec('SET ROLE authenticated');
const login=user=>db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[user]);
await login(owner);const today=await scalar('SELECT CURRENT_DATE::text');
const future=days=>{const date=new Date(today+'T12:00:00Z');date.setUTCDate(date.getUTCDate()+days);return date.toISOString().slice(0,10);};
const admin=async(fn)=>{await db.exec('RESET ROLE');try{return await fn();}finally{await db.exec('SET ROLE authenticated');}};
const parts=(changes={})=>[{amount:70,due_date:future(7),payment_method_id:method,account_id:expense,cost_center_id:center,installment_number:1,installment_total:2,...changes},{amount:140,due_date:future(45),payment_method_id:method,account_id:asset,cost_center_id:otherCenter,installment_number:2,installment_total:2}];
function draft({items,installments,order={}}={}){
 const key=String(sequence++).padStart(44,'7');
 return {order:{vendor_id:vendor,order_date:today,subtotal:200,discount:0,shipping:10,additional_costs:0,total:210,nfe_number:'123',nfe_key:key,nfe_xml:'<NFe><infNFe><cobr><dup><dVenc>'+future(7)+'</dVenc><vDup>70.00</vDup></dup></cobr><pag><detPag><vPag>210.00</vPag></detPag></pag></infNFe></NFe>',...order},
 items:items??[{description:'DESCRIÇÃO ORIGINAL DA NOTA / MODELO 01',quantity:2,unit_price:100,total:200,inventory_item_id:null,stock_quantity:null}],installments:installments??parts()};
}
const create=(data,key=next())=>scalar('SELECT create_purchase_order($1::jsonb,$2::jsonb,$3::jsonb,$4)',[JSON.stringify(data.order),JSON.stringify(data.items),JSON.stringify(data.installments),key]);
const quick=(data,receive=true,key=next())=>scalar('SELECT save_quick_purchase($1::jsonb,$2::jsonb,$3::jsonb,$4,$5)',[JSON.stringify({...data.order,receive_now:receive}),JSON.stringify(data.items),JSON.stringify(data.installments),key,receive]);
const receive=p=>scalar('SELECT receive_purchase_order($1,$2::date)',[p,today]);
const payables=p=>rows('SELECT amount,due_date::text,payment_method_id,account_id,cost_center_id,installment_number,installment_total,status::text,amount_paid FROM accounts_payable WHERE origin_id=$1 ORDER BY installment_number',[p]);
const stock=()=>rows('SELECT id,current_stock,avg_cost FROM inventory_items ORDER BY id');
const writes=()=>admin(()=>scalar("SELECT jsonb_build_object('orders',(SELECT count(*) FROM purchase_orders),'items',(SELECT count(*) FROM purchase_order_items),'payables',(SELECT count(*) FROM accounts_payable),'movements',(SELECT count(*) FROM inventory_movements),'requests',(SELECT count(*) FROM erp_private.requests),'audit',(SELECT count(*) FROM audit_log),'stock',(SELECT jsonb_agg(jsonb_build_array(id,current_stock,avg_cost) ORDER BY id) FROM inventory_items))"));
async function rejectsWithoutWrites(fn,pattern){const before=await writes();await assert.rejects(fn(),pattern);assert.deepEqual(await writes(),before);}
async function test(name,fn){await login(owner);try{await fn();passed++;console.log('PASS '+name);}catch(error){console.error('FAIL '+name+': '+error.message,error.where??'');throw error;}}
const owned=next(),archivedOwned=next(),productCategory=next(),finishedCategory=next(),inactive=next(),foreign=next(),consumable=next(),part=next(),maintenance=next(),activeProduct=next(),archivedProduct=next();
await admin(async()=>{
 for(const [item,name,category,active,itemTenant] of [[owned,'Owned stock','consumable',true,tenant],[archivedOwned,'Archived product stock','part',true,tenant],[productCategory,'Unowned product category','product',true,tenant],[finishedCategory,'Unowned finished category','finished_product',true,tenant],[inactive,'Inactive supply','consumable',false,tenant],[foreign,'Foreign supply','consumable',true,otherTenant],[consumable,'Packing material','consumable',true,tenant],[part,'Purchased component','part',true,tenant],[maintenance,'Maintenance supply','maintenance',true,tenant]])await db.query('INSERT INTO inventory_items(id,tenant_id,name,category,unit,avg_cost,current_stock,is_active) VALUES($1,$2,$3,$4,\'un\',10,0,$5)',[item,itemTenant,name,category,active]);
 await db.query("INSERT INTO products(id,tenant_id,name,stock_item_id,is_active) VALUES($1,$3,'Active finished product',$4,true),($2,$3,'Archived finished product',$5,false)",[activeProduct,archivedProduct,tenant,owned,archivedOwned]);
});
const withItem=(item,stockQuantity=2)=>draft({items:[{description:'ORIGINAL FISCAL DESCRIPTION',quantity:2,unit_price:100,total:200,inventory_item_id:item,stock_quantity:stockQuantity}]});
// These links were accepted by the old writer before the new trigger exists.
const legacyPending=await quick(withItem(owned),false),legacyReceived=await quick(withItem(archivedOwned),true);
await admin(()=>db.exec(migration));
assert.deepEqual(await admin(()=>Promise.all(signatures.map(sig=>scalar('SELECT pg_get_functiondef($1::regprocedure)',[sig])))),untouched);
const itemRow=p=>scalar('SELECT to_jsonb(i) FROM purchase_order_items i WHERE purchase_order_id=$1',[p]);
const change=(p,item,quantity=2)=>db.query('UPDATE purchase_order_items SET inventory_item_id=$2,stock_quantity=$3 WHERE purchase_order_id=$1',[p,item,quantity]);
try{
 await test('New purchases still accept active filaments, consumables, purchased components and maintenance supplies',async()=>{
  for(const material of [grams,kilograms,consumable,part,maintenance]){const p=await create(withItem(material));assert.equal((await itemRow(p)).inventory_item_id,material);assert.equal((await itemRow(p)).description,'ORIGINAL FISCAL DESCRIPTION');}
 });
 await test('Category product and finished_product are rejected even when no product currently owns the stock',async()=>{
  for(const material of [productCategory,finishedCategory])await rejectsWithoutWrites(()=>quick(withItem(material),true),/somente insumos/);
 });
 await test('Stock owned by active or archived products is rejected regardless of its inventory category',async()=>{
  for(const material of [owned,archivedOwned])await rejectsWithoutWrites(()=>quick(withItem(material),true),/somente insumos/);
 });
 await test('New inactive and foreign links reject the entire order, installments and request identity',async()=>{
  await rejectsWithoutWrites(()=>create(withItem(inactive)),/insumo ativo/);await rejectsWithoutWrites(()=>create(withItem(foreign)),/outra empresa/);
 });
 await test('A pending expense line may select a real supply, change supplies or clear the stock link without changing fiscal text',async()=>{
  const p=await create(withItem(null,null));await change(p,consumable);assert.equal((await itemRow(p)).inventory_item_id,consumable);await change(p,part,3);assert.equal((await itemRow(p)).inventory_item_id,part);await change(p,null,null);assert.equal((await itemRow(p)).inventory_item_id,null);assert.equal((await itemRow(p)).description,'ORIGINAL FISCAL DESCRIPTION');
 });
 await test('Direct pending-line changes cannot bypass product, archive, category, activity or tenant exclusions',async()=>{
  const p=await create(withItem(consumable)),before=await itemRow(p);
  for(const material of [owned,archivedOwned,productCategory,finishedCategory,inactive,foreign]){await rejectsWithoutWrites(()=>change(p,material),/somente insumos|insumo ativo/);assert.deepEqual(await itemRow(p),before);}
 });
 await test('An old pending finished-product link can correct converted quantity and receive once without rewriting its classification',async()=>{
  const oldTitles=await payables(legacyPending);await change(legacyPending,owned,3);assert.equal(Number((await itemRow(legacyPending)).stock_quantity),3);await receive(legacyPending);const before=await writes();await receive(legacyPending);assert.deepEqual(await writes(),before);assert.deepEqual(await payables(legacyPending),oldTitles);assert.equal(await scalar('SELECT status FROM purchase_orders WHERE id=$1',[legacyPending]),'received');
 });
 await test('A posted legacy finished-product receipt remains unchanged, and the original guard still blocks edits',async()=>{
  const before=await writes(),old=await itemRow(legacyReceived);await receive(legacyReceived);assert.deepEqual(await writes(),before);await assert.rejects(change(legacyReceived,consumable),/compras pendentes/);await assert.rejects(db.query("UPDATE purchase_order_items SET description='Replacement' WHERE purchase_order_id=$1",[legacyReceived]),/compras pendentes/);assert.deepEqual(await itemRow(legacyReceived),old);assert.deepEqual(await writes(),before);
 });
 await test('An accepted purchase retry stays inert if its formerly raw stock is later linked to an archived product',async()=>{
  const data=withItem(consumable),key=next(),p=await quick(data,false,key);await admin(()=>db.query("INSERT INTO products(tenant_id,name,stock_item_id,is_active) VALUES($1,'Now archived product',$2,false)",[tenant,consumable]));const before=await writes();assert.equal(await quick(data,false,key),p);assert.deepEqual(await writes(),before);await rejectsWithoutWrites(()=>create(withItem(consumable)),/somente insumos/);
 });
 await test('The restriction is limited to purchase item links and does not block finished-stock inventory operations',async()=>{
  const before=Number(await scalar('SELECT current_stock FROM inventory_items WHERE id=$1',[owned]));await scalar('SELECT post_inventory_movement($1::jsonb,$2)',[JSON.stringify({item_id:owned,movement_type:'purchase_in',quantity:1,unit_cost:10}),next()]);assert.equal(Number(await scalar('SELECT current_stock FROM inventory_items WHERE id=$1',[owned])),before+1);assert.equal(await scalar('SELECT count(*)::int FROM pg_trigger WHERE tgfoid=\'erp_private.guard_purchase_material_link()\'::regprocedure AND tgrelid<>\'public.purchase_order_items\'::regclass'),0);
 });
 await test('Role protections and private-helper isolation remain in force',async()=>{
  await login(viewer);await rejectsWithoutWrites(()=>create(withItem(part)),/permissão/);await login(owner);await assert.rejects(scalar('SELECT erp_private.guard_purchase_material_link()'),/permission denied/);
 });
 await test('The forward migration retries safely, preserves all predecessor bodies and refuses unknown function or trigger changes',async()=>{
  await admin(async()=>{
   const signature='erp_private.guard_purchase_material_link()',definition=await scalar('SELECT pg_get_functiondef($1::regprocedure)',[signature]);await db.exec(migration);assert.equal(await scalar('SELECT pg_get_functiondef($1::regprocedure)',[signature]),definition);assert.deepEqual(await Promise.all(signatures.map(sig=>scalar('SELECT pg_get_functiondef($1::regprocedure)',[sig]))),untouched);
   try{await db.exec(definition.replace('DECLARE item inventory_items;','-- Unreviewed guard\nDECLARE item inventory_items;'));await assert.rejects(db.exec(migration),/Review the purchase material link guard/);}finally{await db.exec(definition);}
   try{await db.exec('ALTER TABLE purchase_order_items DISABLE TRIGGER erp_purchase_material_link_guard');await assert.rejects(db.exec(migration),/Review the purchase material link trigger/);}finally{await db.exec('ALTER TABLE purchase_order_items ENABLE TRIGGER erp_purchase_material_link_guard');}
  });
 });
 console.log(`Purchase material links: ${passed} creation, mapping, tenant and historical-receipt groups passed.`);
}finally{await db.close();}
