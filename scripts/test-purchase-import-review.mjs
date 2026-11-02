// Disposable PostgreSQL acceptance: classification, installments and atomic receipt.
// Never connects to production.
import { PGlite } from '@electric-sql/pglite';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { readFile, readdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
const repo=fileURLToPath(new URL('../',import.meta.url));
process.on('uncaughtException',error=>{console.error(error.message,error.where??'');process.exit(1);});
const db=new PGlite(), migrationName='20261102233000_purchase_import_financial_classification.sql';
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
const signatures=['public.receive_purchase_order(uuid,date)','public.save_quick_purchase(jsonb,jsonb,jsonb,uuid,boolean)'];
const untouched=await Promise.all(signatures.map(sig=>scalar('SELECT pg_get_functiondef($1::regprocedure)',[sig])));
assert.equal(await scalar("SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid='public.create_purchase_order(jsonb,jsonb,jsonb,uuid)'::regprocedure"),'91fab98c6b56d138bd26da9ad27ddf51');
await db.exec(migration);
assert.deepEqual(await Promise.all(signatures.map(sig=>scalar('SELECT pg_get_functiondef($1::regprocedure)',[sig]))),untouched);
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
try{
 await test('Original NF description, XML and irregular actual installments preserve payment and distinct classifications',async()=>{
  const data=draft(),p=await create(data),titles=await payables(p);
  assert.deepEqual(titles.map(t=>[Number(t.amount),t.due_date,t.payment_method_id,t.account_id,t.cost_center_id,t.installment_number,t.installment_total]),[[70,future(7),method,expense,center,1,2],[140,future(45),method,asset,otherCenter,2,2]]);
  assert.ok(titles.every(t=>t.status==='open'&&Number(t.amount_paid)===0));
  assert.equal(await scalar('SELECT description FROM purchase_order_items WHERE purchase_order_id=$1',[p]),data.items[0].description);
  assert.equal(await scalar('SELECT nfe_xml FROM purchase_orders WHERE id=$1',[p]),data.order.nfe_xml);
 });
 await test('Legacy absent or explicitly null classifications stay optional without losing the payment method',async()=>{
  for(const fields of [{},{account_id:null,cost_center_id:null}]){const p=await create(draft({installments:[{amount:210,due_date:future(4),payment_method_id:method,...fields}]})),[title]=await payables(p);assert.equal(title.account_id,null);assert.equal(title.cost_center_id,null);assert.equal(title.payment_method_id,method);}
 });
 await test('Foreign classification, center and payment references roll back all purchase effects',async()=>{
  for(const fields of [{account_id:foreignAccount},{cost_center_id:foreignCenter},{payment_method_id:foreignMethod}])await rejectsWithoutWrites(()=>create(draft({installments:parts(fields)})),/outra empresa/);
 });
 await test('Inactive and nonexistent classifications or centers cannot be attached to new payables',async()=>{
  for(const fields of [{account_id:inactiveAccount},{cost_center_id:inactiveCenter},{account_id:next()},{cost_center_id:next()}])await rejectsWithoutWrites(()=>create(draft({installments:parts(fields)})),/ativa|ativo|outra empresa/);
 });
 await test('Malformed or unbalanced installment details fail atomically rather than dropping classifications',async()=>{
  for(const installments of [parts({account_id:'invalid'}),parts({amount:69.99}),parts({due_date:'invalid'}),parts({amount:-1})])await rejectsWithoutWrites(()=>create(draft({installments})),/uuid|soma das parcelas|date|Parcela/);
 });
 await test('Atomic XML receipt preserves g and kg conversions, weighted costs, landed total and payable classifications',async()=>{
  const data=draft({order:{subtotal:200,total:215,discount:10,shipping:20,additional_costs:5},items:[{description:'500G BRANCO ORIGINAL',quantity:1,unit_price:50,total:50,inventory_item_id:grams,stock_quantity:500},{description:'3 EMBALAGENS AZUL ORIGINAL',quantity:3,unit_price:50,total:150,inventory_item_id:kilograms,stock_quantity:1.5}],installments:[{amount:215,due_date:future(14),payment_method_id:method,account_id:expense,cost_center_id:center}]}),p=await quick(data),values=await stock();
  near(values.find(i=>i.id===grams).current_stock,1500);near(values.find(i=>i.id===grams).avg_cost,(50+53.75)/1500);near(values.find(i=>i.id===kilograms).current_stock,3);near(values.find(i=>i.id===kilograms).avg_cost,(60+161.25)/3);
  near(await scalar('SELECT sum(total_cost) FROM inventory_movements WHERE reference_id=$1',[p]),215);near(await scalar('SELECT sum(amount) FROM accounts_payable WHERE origin_id=$1',[p]),215);assert.equal((await payables(p))[0].account_id,expense);assert.equal(await scalar('SELECT status FROM purchase_orders WHERE id=$1',[p]),'received');
 });
 await test('A missing conversion rolls back XML creation, payables, stock, audit and request; corrected retry can reuse the failed ID',async()=>{
  const data=draft({items:[{description:'Valid first',quantity:1,unit_price:100,total:100,inventory_item_id:grams,stock_quantity:1000},{description:'Missing conversion second',quantity:1,unit_price:100,total:100,inventory_item_id:kilograms,stock_quantity:null}]}),key=next();
  await rejectsWithoutWrites(()=>quick(data,true,key),/quantidade convertida/);data.items[1].stock_quantity=1;const p=await quick(data,true,key);assert.equal(await scalar('SELECT status FROM purchase_orders WHERE id=$1',[p]),'received');
 });
 await test('Accepted atomic retries remain inert after later receipt costs change, even if classifications become inactive',async()=>{
  const data=draft({items:[{description:'Rolo',quantity:2,unit_price:100,total:200,inventory_item_id:grams,stock_quantity:2000}]}),key=next(),p=await quick(data,true,key);
  await scalar('SELECT post_inventory_movement($1::jsonb,$2)',[JSON.stringify({item_id:grams,movement_type:'purchase_in',quantity:500,unit_cost:.5}),next()]);
  await admin(()=>db.query('UPDATE chart_of_accounts SET is_active=false WHERE id=$1',[expense]));
  try{const before=await writes();assert.equal(await quick(data,true,key),p);assert.equal(await receive(p),p);assert.deepEqual(await writes(),before);}finally{await admin(()=>db.query('UPDATE chart_of_accounts SET is_active=true WHERE id=$1',[expense]));}
 });
 await test('An accepted request cannot be reused with another classification, due date or receive intent',async()=>{
  const data=draft(),key=next();await quick(data,false,key);
  for(const changed of [{...data,installments:parts({account_id:asset})},{...data,installments:parts({due_date:future(8)})}])await rejectsWithoutWrites(()=>quick(changed,false,key),/outra operação/);
  await rejectsWithoutWrites(()=>quick(data,true,key),/outra operação/);
 });
 await test('Pending XML saves no stock and later receipt uses the same financial titles exactly once',async()=>{
  const data=draft({items:[{description:'Entrega futura',quantity:2,unit_price:100,total:200,inventory_item_id:grams,stock_quantity:2000}]}),before=await stock(),p=await quick(data,false),titles=await payables(p);assert.deepEqual(await stock(),before);
  await receive(p);await receive(p);assert.deepEqual(await payables(p),titles);assert.equal(await scalar('SELECT count(*)::int FROM inventory_movements WHERE reference_id=$1',[p]),1);
 });
 await test('A duplicate NF key cannot create another order, receipt or payable schedule',async()=>{
  const data=draft();await quick(data,false);await rejectsWithoutWrites(()=>quick(data,false),/purchase_nfe_unique|duplicate key/);
 });
 await test('Received purchase descriptions and stock links remain immutable and linked amounts cannot be overwritten',async()=>{
  const p=await quick(draft(),true),before=await writes();
  await assert.rejects(db.query("UPDATE purchase_order_items SET inventory_item_id=$2,stock_quantity=1000 WHERE purchase_order_id=$1",[p,grams]),/compras pendentes/);
  await assert.rejects(db.query("UPDATE purchase_order_items SET description='Replacement' WHERE purchase_order_id=$1",[p]),/compras pendentes/);
  await assert.rejects(db.query('UPDATE accounts_payable SET amount=1 WHERE origin_id=$1',[p]),/Título vinculado/);assert.deepEqual(await writes(),before);
 });
 await test('Financial write roles and company boundaries remain enforced for purchase creation and receipt',async()=>{
  const data=draft();for(const user of [viewer,operator]){await login(user);await rejectsWithoutWrites(()=>quick(data,true),/permissão/);}await login(owner);const p=await quick(data,false);await login(otherOwner);await rejectsWithoutWrites(()=>receive(p),/Compra inválida/);await rejectsWithoutWrites(()=>create(draft()),/outra empresa/);
 });
 await test('The forward patch is retry-safe, preserves receipt/quick function bodies and rejects unreviewed writer drift',async()=>{
  await admin(async()=>{const signature='public.create_purchase_order(jsonb,jsonb,jsonb,uuid)',definition=await scalar('SELECT pg_get_functiondef($1::regprocedure)',[signature]);await db.exec(migration);assert.equal(await scalar('SELECT pg_get_functiondef($1::regprocedure)',[signature]),definition);assert.deepEqual(await Promise.all(signatures.map(sig=>scalar('SELECT pg_get_functiondef($1::regprocedure)',[sig]))),untouched);
   try{await db.exec(definition.replace('DECLARE t uuid:=erp_private.actor(true);','-- Unreviewed purchase writer\nDECLARE t uuid:=erp_private.actor(true);'));await assert.rejects(db.exec(migration),/Review the purchase installment writer/);}finally{await db.exec(definition);}
  });
 });
 console.log(`Purchase import review: ${passed} classification, payment, receipt and replay groups passed.`);
}finally{await db.close();}
