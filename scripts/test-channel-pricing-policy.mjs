// Disposable database and synthetic assumptions only. No official marketplace
// tariff, production database or external provider is queried by this suite.
import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const { build } = createRequire(createRequire(import.meta.url).resolve('vite/package.json'))('esbuild');
const compiled = await build({ entryPoints: [new URL('../src/lib/channel-pricing.ts', import.meta.url).pathname.replace(/^\/(?=[A-Z]:)/i,'')], bundle: true, write: false, format: 'esm', platform: 'node' });
const { priceChannel } = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const db = new PGlite();
process.on('uncaughtException', error => { console.error(error.message, error.where ?? ''); process.exit(1); });
await db.exec(`CREATE ROLE authenticated; CREATE ROLE anon; CREATE ROLE service_role;
 CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY,email text);
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 CREATE SCHEMA storage; CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean);
 CREATE TABLE storage.objects(id uuid DEFAULT gen_random_uuid(),bucket_id text,name text,owner uuid);
 CREATE FUNCTION storage.foldername(text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$ SELECT string_to_array($1,'/') $$;
 ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY; CREATE PUBLICATION supabase_realtime;
 GRANT USAGE ON SCHEMA public,auth,storage TO authenticated,anon;
 ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO authenticated;`);
for (const name of (await readdir(new URL('../supabase/migrations/', import.meta.url))).filter(name => name.endsWith('.sql') && name <= '20261102230000_channel_pricing_policy.sql').sort()) {
 try { await db.exec((await readFile(new URL('../supabase/migrations/' + name, import.meta.url), 'utf8')).replace(/CREATE EXTENSION IF NOT EXISTS (pg_cron|pg_net);/g,'')); }
 catch(error) { throw new Error(`Migration ${name}: ${error.message}`); }
}
const id = number => `75000000-0000-4000-8000-${String(number).padStart(12,'0')}`;
const tenant=id(1),owner=id(2),otherTenant=id(3),otherOwner=id(4),operator=id(5),viewer=id(6),material=id(7),printer=id(8);
let sequence=100;
const next=()=>id(sequence++), scalar=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0];
const row=async(sql,args=[]) => (await db.query(sql,args)).rows[0];
await db.query("INSERT INTO auth.users VALUES($1,'channel-owner@qa.invalid'),($2,'other-owner@qa.invalid'),($3,'operator@qa.invalid'),($4,'viewer@qa.invalid')",[owner,otherOwner,operator,viewer]);
await db.query("INSERT INTO tenants(id,name,slug) VALUES($1,'Channel QA','channel-qa'),($2,'Other channel QA','other-channel-qa')",[tenant,otherTenant]);
await db.query("INSERT INTO profiles(user_id,tenant_id,display_name) VALUES($1,$5,'Owner'),($2,$6,'Other'),($3,$5,'Operator'),($4,$5,'Viewer')",[owner,otherOwner,operator,viewer,tenant,otherTenant]);
await db.query("INSERT INTO user_roles(user_id,tenant_id,role) VALUES($1,$5,'owner'),($2,$6,'owner'),($3,$5,'operator'),($4,$5,'viewer')",[owner,otherOwner,operator,viewer,tenant,otherTenant]);
await db.query("INSERT INTO inventory_items(id,tenant_id,name,unit,current_stock,avg_cost,material_code,color_code,color_hex,color) VALUES($1,$2,'PLA test','kg',10,20,'PLA','RED','#FF0000','Vermelho')",[material,tenant]);
await db.query("INSERT INTO printers(id,tenant_id,name,brand,model,power_watts,depreciation_per_hour,maintenance_cost_per_hour) VALUES($1,$2,'A1 QA','Bambu Lab','A1',100,0,0)",[printer,tenant]);
await db.exec('SET ROLE authenticated');
const login=uid=>db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[uid]);
await login(owner);
const admin=async fn=>{await db.exec('RESET ROLE');try{return await fn();}finally{await db.exec('SET ROLE authenticated');}};
const policy=channel=>scalar('SELECT channel_pricing_policy($1)',[channel]);
const conditions={commission_percent:10,tax_percent:5,fixed_fee_per_order:4,fixed_fee_per_item:0,seller_shipping_per_order:12,advertising_per_order:2,other_cost_per_order:0,target_margin:20};
const savePolicy=async(channel,values=conditions,key=next(),revision=null)=>scalar('SELECT save_channel_pricing_policy($1,$2::jsonb,$3,$4)',[channel,JSON.stringify(values),revision??(await policy(channel)).revision,key]);
const saveProduct=(product,data,key=next(),photos=[])=>scalar('SELECT save_product_with_photos($1,$2::jsonb,$3::jsonb,$4)',[product,JSON.stringify(data),JSON.stringify(photos),key]);
const baseProduct=(name='Produto de canal')=>({name,category:'printed_part',cost_estimate:10,manual_cost:10,sale_price:77,prints_per_plate:1,
 catalog_details:{base_cost:8,accessory_cost:1,other_cost:1},catalog_pricing:{cost_source:'manual',price_source:'manual'}});
const preview=(product,channel='mercado_livre',quantity=3,overrides={},price=30,context=null)=>scalar('SELECT product_channel_pricing_preview($1,$2,$3,$4::jsonb,$5,$6::jsonb)',[product,channel,quantity,JSON.stringify(overrides),price,context==null?null:JSON.stringify(context)]);
const apply=(product,p,key=next(),overrides={},price=30,context=null)=>scalar('SELECT apply_product_channel_pricing($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9,$10::jsonb)',[product,p.channel,p.quantity,JSON.stringify(overrides),p.cost_revision,p.policy_revision,p.revision,key,price,context==null?null:JSON.stringify(context)]);
const channelEntry=async(quote=10,changes={})=>({channel:'mercado_livre',quantity:3,assumptions:conditions,expected_policy_revision:(await policy('mercado_livre')).revision,quoted_unit_cost:quote,unit_price:30,...changes});
const close=(actual,expected)=>assert(Math.abs(actual-expected)<1e-8,`${actual} != ${expected}`);
let passed=0, product, compositionProduct;
async function test(name,fn){await fn();passed++;console.log('PASS '+name);}
try {
 await test('Absent and partially configured policy preserve unknown nulls and explicit zero',async()=>{
  const missing=await policy('direct');assert.equal(missing.configured,false);assert(Object.values(missing.assumptions).every(value=>value===null));
  assert.notEqual(missing.revision,(await policy('shopee')).revision);
  await savePolicy('direct',{commission_percent:0});const saved=await policy('direct');
  assert.equal(saved.configured,true);assert.equal(saved.assumptions.commission_percent,0);assert.equal(saved.assumptions.tax_percent,null);
  assert.equal(await scalar('SELECT count(*)::integer FROM channel_pricing_policy_versions WHERE channel=$1',['direct']),1);
 });
 await test('Policy writes require financial roles, keep audit versions, replay once and reject changed payload',async()=>{
  const before=await policy('mercado_livre'),key=next();const saved=await savePolicy('mercado_livre',conditions,key,before.revision);
  assert.equal(await savePolicy('mercado_livre',conditions,key,before.revision),saved);
  await assert.rejects(savePolicy('mercado_livre',{...conditions,tax_percent:6},key,before.revision),/outra operação/);
  assert.equal(await scalar('SELECT count(*)::integer FROM channel_pricing_policy_versions WHERE channel=$1',['mercado_livre']),1);
  for(const uid of [operator,viewer]){await login(uid);await assert.rejects(savePolicy('shopee'),/permissão/);}await login(owner);
  assert.equal(await scalar("SELECT count(*)::integer FROM audit_log WHERE action='save_channel_pricing_policy' AND record_id=$1",[saved]),1);
 });
 await test('Manual accepted total ignores production incompleteness and does not add catalog expenses twice',async()=>{
  product=await saveProduct(null,baseProduct());
  const p=await preview(product);assert.equal(p.complete,true);assert.equal(p.cost_source,'manual');assert.equal(p.unit_cost,10);
  assert.equal(p.result.suggested,24.62);assert.equal(p.result.breakEven,18.83);assert.equal(p.result.includedResult,28.5);
  assert.equal(p.result.manufacturingCost,30);assert.equal(p.result.commission,9);assert.equal(p.result.tax,4.5);assert.equal(p.result.orderExpenses,18);
 });
 await test('Server formula agrees with the real TS oracle including per-item fees and decimal edge cases',async()=>{
  for(const [unit,qty,changes,target] of [[10,3,{fixed_fee_per_item:2},30],[10.01,1,{commission_percent:0,tax_percent:0,target_margin:30,fixed_fee_per_order:0,seller_shipping_per_order:0,advertising_per_order:0},null],[0,1,{commission_percent:0,tax_percent:0,target_margin:0,fixed_fee_per_order:0,seller_shipping_per_order:0,advertising_per_order:0},0.01]]){
   const assumptions={...conditions,...changes};const p=await saveProduct(null,{...baseProduct(),manual_cost:unit,cost_estimate:unit,catalog_details:{base_cost:unit,accessory_cost:0,other_cost:0}});
   const actual=(await preview(p,'mercado_livre',qty,assumptions,target)).result;
   const expected=priceChannel({unitCost:unit,orderQuantity:qty,commissionPercent:assumptions.commission_percent,taxPercent:assumptions.tax_percent,
    fixedFeePerOrder:assumptions.fixed_fee_per_order,fixedFeePerItem:assumptions.fixed_fee_per_item,sellerShippingPerOrder:assumptions.seller_shipping_per_order,
    advertisingPerOrder:assumptions.advertising_per_order,otherCostPerOrder:assumptions.other_cost_per_order,marginPercent:assumptions.target_margin,targetUnitPrice:target??''});
   for(const [key,value]of Object.entries(expected)){if(value===null)assert.equal(actual[key],null);else close(actual[key],value);}
  }
 });
 await test('Applying a channel price leaves factory price untouched and stores immutable assumptions and cost',async()=>{
  const p=await preview(product),key=next(),accepted=await apply(product,p,key);
  assert.equal(Number(await scalar('SELECT sale_price FROM products WHERE id=$1',[product])),77);
  assert.equal(Number(await scalar('SELECT unit_price FROM product_channel_prices WHERE product_id=$1 AND channel=$2',[product,'mercado_livre'])),30);
  const snapshot=await scalar('SELECT snapshot FROM product_channel_pricing_acceptances WHERE id=$1',[accepted]);
  assert.equal(snapshot.cost_snapshot.cost_per_unit,10);assert.deepEqual(snapshot.assumptions,conditions);
  const prices=await scalar('SELECT product_channel_price_catalog($1)',[product]);assert.equal(prices[0].acceptance_id,accepted);assert.equal(prices[0].quantity,3);assert.equal(prices[0].unit_price,30);
  await savePolicy('mercado_livre',conditions);
  await admin(()=>db.query("UPDATE products SET updated_at=updated_at+interval '1 second' WHERE id=$1",[product]));
  assert.equal(await apply(product,p,key),accepted);
  await assert.rejects(apply(product,p,key,{},31),/outra operação/);
  assert.equal(await scalar('SELECT count(*)::integer FROM product_channel_pricing_acceptances WHERE product_id=$1',[product]),1);
  await assert.rejects(admin(()=>db.query('UPDATE product_channel_pricing_acceptances SET unit_price=31 WHERE id=$1',[accepted])),/imutável/);
 });
 await test('Equal-cost catalog edits and equal-valued policy revisions invalidate a fresh apply',async()=>{
  let old=await preview(product);await admin(()=>db.query("UPDATE products SET updated_at=updated_at+interval '1 second' WHERE id=$1",[product]));
  await assert.rejects(apply(product,old),/mudaram/);
  old=await preview(product);await savePolicy('mercado_livre',conditions);await assert.rejects(apply(product,old),/mudaram/);
  old=await preview(product);await assert.rejects(apply(product,{...old,quantity:4}),/mudaram/);await assert.rejects(apply(product,old,next(),{},31),/mudaram/);
 });
 await test('Per-product condition overrides are snapshotted without changing company defaults',async()=>{
  const overrides={commission_percent:12};const p=await preview(product,'mercado_livre',3,overrides,0.01);assert.equal(p.complete,true);assert(p.result.includedResult<0);
  const accepted=await apply(product,p,next(),overrides,0.01);assert.equal((await scalar('SELECT snapshot FROM product_channel_pricing_acceptances WHERE id=$1',[accepted])).assumptions.commission_percent,12);
  assert.equal((await policy('mercado_livre')).assumptions.commission_percent,10);
  const prices=await scalar('SELECT product_channel_price_catalog($1)',[product]);assert.equal(prices[0].assumptions.commission_percent,12);assert.equal(prices[0].unit_price,0.01);
 });
 await test('Missing costs and blank assumptions remain pending, never artificial free complete prices',async()=>{
  const incomplete=await saveProduct(null,{name:'Custo desconhecido',category:'printed_part',manual_cost:null,cost_estimate:null,catalog_details:{base_cost:null,accessory_cost:0,other_cost:0}});
  const noCost=await preview(incomplete);assert.equal(noCost.complete,false);assert.equal(noCost.unit_cost,null);assert.equal(noCost.result,null);
  const noPolicy=await preview(product,'other');assert.equal(noPolicy.complete,false);assert.equal(noPolicy.assumptions.fixed_fee_per_item,null);
  await assert.rejects(apply(product,noPolicy),/Complete/);
  const filled=await preview(product,'other',3,conditions,30);assert.equal(filled.complete,true);assert.equal(filled.policy.configured,false);
 });
 await test('Same-form channel acceptance saves the new product and stock/photos atomically without changing factory price',async()=>{
  const data={...baseProduct('Cadastro único'),stock:{unit:'un',avg_cost:10,current_stock:2},channel_pricing:[await channelEntry()]};
  const key=next(),id=await saveProduct(null,data,key,['https://qa.invalid/photo.png']);
  assert.equal(Number(await scalar('SELECT sale_price FROM products WHERE id=$1',[id])),77);
  assert.equal(Number(await scalar('SELECT current_stock FROM inventory_items WHERE id=(SELECT stock_item_id FROM products WHERE id=$1)',[id])),2);
  assert.equal(await scalar('SELECT count(*)::integer FROM product_photos WHERE product_id=$1',[id]),1);
  assert.equal(await scalar('SELECT count(*)::integer FROM product_channel_pricing_acceptances WHERE product_id=$1',[id]),1);
  await savePolicy('mercado_livre',conditions);assert.equal(await saveProduct(null,data,key,['https://qa.invalid/photo.png']),id);
  assert.equal(await scalar('SELECT count(*)::integer FROM product_channel_pricing_acceptances WHERE product_id=$1',[id]),1);
  await assert.rejects(saveProduct(null,{...data,name:'Replay alterado'},key,['https://qa.invalid/photo.png']),/outra operação/);
 });
 await test('Bad channel cost or policy rolls back product, stock, photos, acceptances and request identity together',async()=>{
  const before=await admin(()=>scalar('SELECT jsonb_build_array((SELECT count(*) FROM products),(SELECT count(*) FROM inventory_items),(SELECT count(*) FROM product_photos),(SELECT count(*) FROM product_channel_pricing_acceptances),(SELECT count(*) FROM erp_private.requests))'));
  for(const entry of [await channelEntry(11),await channelEntry(10,{expected_policy_revision:'stale'})]){
   await assert.rejects(saveProduct(null,{...baseProduct('Falha atômica'),stock:{unit:'un',avg_cost:10,current_stock:3},channel_pricing:[entry]},next(),['https://qa.invalid/must-rollback.png']),/custo final|condições do canal/);
   assert.deepEqual(await admin(()=>scalar('SELECT jsonb_build_array((SELECT count(*) FROM products),(SELECT count(*) FROM inventory_items),(SELECT count(*) FROM product_photos),(SELECT count(*) FROM product_channel_pricing_acceptances),(SELECT count(*) FROM erp_private.requests))')),before);
  }
 });
 await test('Tenant RLS and financial roles protect reads, applies and inline channel saves',async()=>{
  const p=await preview(product);await login(operator);await assert.rejects(apply(product,p),/permissão/);
  await assert.rejects(saveProduct(null,{...baseProduct(),channel_pricing:[await channelEntry()]}),/permissão/);
  await assert.rejects(db.query("INSERT INTO channel_pricing_policies(tenant_id,channel,assumptions,updated_by) VALUES($1,'shopee','{}',$2)",[tenant,operator]),/permission denied/);
  await login(otherOwner);assert.equal(await scalar('SELECT count(*)::integer FROM product_channel_prices'),0);assert.equal(await scalar('SELECT count(*)::integer FROM channel_pricing_policy_versions'),0);
  await assert.rejects(preview(product),/não encontrado/);assert.equal((await policy('mercado_livre')).configured,false);await login(owner);
  await login(otherOwner);await assert.rejects(scalar('SELECT product_channel_price_catalog($1)',[product]),/não encontrado/);await login(owner);
 });
 await test('Anonymous and sessionless callers cannot read channel costs or execute private helpers',async()=>{
  await db.exec('SET ROLE anon');await assert.rejects(policy('direct'),/permission denied/);await db.exec('SET ROLE authenticated');
  await login('');await assert.rejects(policy('direct'),/Entre/);await login(owner);
  await assert.rejects(scalar('SELECT erp_private.read_channel_policy($1,$2)',[tenant,'direct']),/permission denied/);
 });
 await test('Malformed, unknown, impossible and implicit assumptions cannot become channel prices',async()=>{
  for(const bad of [{...conditions,orderQuantity:100},{...conditions,variableUnitCost:0},{...conditions,tax_percent:'5'},{...conditions,tax_percent:-1},{...conditions,commission_percent:80,target_margin:20}])await assert.rejects(savePolicy('shopee',bad),/inválid|número|limite|menos de 100/);
  for(const price of [0,-1,0.001,1e10])await assert.rejects(preview(product,'mercado_livre',3,{},price),/preço alvo/);
  await assert.rejects(preview(product,'unknown'),/canal/);await assert.rejects(preview(product,'direct',0),/Unidades/);
  const duplicate=await channelEntry();await assert.rejects(saveProduct(null,{...baseProduct(),channel_pricing:[duplicate,duplicate]}),/uma única vez/);
 });
 await test('Composition channel cost uses the full canonical cost plus catalog expenses once and tracks same-price receipts',async()=>{
  const settings={machine_hour_cost:0,energy_cost_kwh:0,labor_cost_hour:0,overhead_percent:0,target_margin:0,handling_minutes_per_plate:0,finishing_minutes_per_piece:0,assembly_minutes_per_product:0,extras_cost_per_product:0,printer_hour_costs:[]};
  const revision=(await scalar('SELECT pricing_settings()')).revision;await scalar('SELECT save_pricing_settings($1::jsonb,$2,$3)',[JSON.stringify(settings),revision,next()]);
  const comp=await saveProduct(null,{name:'Composição',category:'printed_part',material_id:material,est_grams:100,est_time_minutes:60,prints_per_plate:1});
  await scalar('SELECT save_product_material_recipe($1,NULL,$2,$3::jsonb,NULL,$4,$5)',[comp,'per_unit',JSON.stringify([{item_id:material,grams:100}]),next(),0]);
  const plan=await scalar('SELECT product_pricing_plan($1)',[comp]);await scalar('SELECT save_product_pricing_plan($1,$2::jsonb,$3,$4)',[comp,JSON.stringify({printer_id:printer}),plan.revision,next()]);
  await admin(()=>db.query("UPDATE products SET manual_cost_override=NULL,catalog_details='{"+'"cost_source":"composition","accessory_cost":1,"other_cost":2'+"}' WHERE id=$1",[comp]));
  const old=await preview(comp);assert.equal(old.complete,true);assert.equal(old.cost_source,'composition');assert.equal(old.unit_cost,5);
  await scalar('SELECT post_inventory_movement($1::jsonb,$2)',[JSON.stringify({item_id:material,movement_type:'purchase_in',quantity:1,unit_cost:20,notes:'Same-price synthetic receipt'}),next()]);
  const fresh=await preview(comp);assert.equal(fresh.unit_cost,5);
  assert.notEqual(fresh.cost_revision,old.cost_revision);await assert.rejects(apply(comp,old),/mudaram/);
  compositionProduct=comp;
 });
 await test('Factory exclusive lot quantity and cost context stay separate from order/package quantity',async()=>{
  const comp=compositionProduct,overrides={cost_basis:'exclusive_lot'};
  await admin(()=>db.query('UPDATE products SET prints_per_plate=3,est_grams=300 WHERE id=$1',[comp]));
  await scalar('SELECT save_product_material_recipe($1,NULL,$2,$3::jsonb,NULL,$4,$5)',[comp,'per_print',JSON.stringify([{item_id:material,grams:300}]),next(),0]);
  const manufacturing=await scalar('SELECT product_pricing_preview($1,$2,$3::jsonb)',[comp,100,JSON.stringify(overrides)]);
  assert.equal(manufacturing.complete,true);
  close(manufacturing.breakdown.unit_cost,2.04);assert.equal(manufacturing.runs[0].full_runs,34);assert.equal(manufacturing.runs[0].surplus_units,2);
  const context={quantity:100,overrides,expected_revision:manufacturing.revision};
  const p=await preview(comp,'mercado_livre',1,{},30,context);
  assert.equal(p.cost_source,'simulation');assert.equal(p.quantity,1);assert.equal(p.result.orderExpenses,18);
  close(p.unit_cost,manufacturing.breakdown.unit_cost);assert.notEqual(p.unit_cost,5);
  const accepted=await apply(comp,p,next(),{},30,context);assert.equal((await scalar('SELECT snapshot FROM product_channel_pricing_acceptances WHERE id=$1',[accepted])).cost_snapshot.preview.quantity,100);
  await assert.rejects(preview(comp,'mercado_livre',1,{},30,{...context,expected_revision:'stale'}),/simulação de produção mudou/);
  await assert.rejects(apply(comp,p,next(),{},30,{...context,quantity:99,expected_revision:null}),/mudaram/);
 });
 console.log(`Channel pricing: ${passed} policy, oracle, scope, replay and atomic-save groups passed.`);
} finally {await db.close();}
