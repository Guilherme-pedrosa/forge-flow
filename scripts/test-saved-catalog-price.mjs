import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
process.on('uncaughtException',error=>{console.error(error.message,error.where??'');process.exit(1);});
const db=new PGlite();
await db.exec(`CREATE ROLE authenticated; CREATE ROLE anon; CREATE ROLE service_role;
 CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY,email text);
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 CREATE SCHEMA storage; CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean);
 CREATE TABLE storage.objects(id uuid DEFAULT gen_random_uuid(),bucket_id text,name text,owner uuid);
 CREATE FUNCTION storage.foldername(text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$ SELECT string_to_array($1,'/') $$;
 ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY; CREATE PUBLICATION supabase_realtime;
 GRANT USAGE ON SCHEMA public,auth,storage TO authenticated,anon;
 ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO authenticated;`);
for(const name of (await readdir(new URL('../supabase/migrations/',import.meta.url))).filter(x=>x.endsWith('.sql')).sort()) {
 try { await db.exec((await readFile(new URL('../supabase/migrations/'+name,import.meta.url),'utf8')).replace(/CREATE EXTENSION IF NOT EXISTS (pg_cron|pg_net);/g,'')); }
 catch(error){throw new Error(`Migration ${name}: ${error.message} ${error.where??''}`);}
}

const id=n=>'76100000-0000-4000-8000-'+String(n).padStart(12,'0'),tenant=id(1),owner=id(2),other=id(3),viewer=id(4),peer=id(5),product=id(6);let seq=100,passed=0;const next=()=>id(seq++);
const scalar=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0];
const login=user=>db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[user]);
const admin=async(fn)=>{await db.exec('RESET ROLE');try{return await fn();}finally{await db.exec('SET ROLE authenticated');}};
const read=()=>scalar('SELECT product_catalog_cost($1)',[product]);
const apply=(revision,price=49.9,key=next(),quantity=3)=>scalar('SELECT apply_saved_catalog_price($1,$2,$3,$4,$5)',[product,quantity,revision,price,key]);
const stored=()=>scalar('SELECT to_jsonb(p) FROM products p WHERE id=$1',[product]);
const test=async(name,fn)=>{await login(owner);await fn();passed++;console.log('PASS '+name);};
await db.query("INSERT INTO auth.users VALUES($1,'saved@qa.invalid'),($2,'other@qa.invalid'),($3,'viewer@qa.invalid'),($4,'peer@qa.invalid')",[owner,other,viewer,peer]);
await db.query("INSERT INTO tenants(id,name,slug)VALUES($1,'Saved cost','saved-cost'),($2,'Other','saved-cost-other')",[tenant,other]);
await db.query("INSERT INTO profiles(user_id,tenant_id,display_name)VALUES($1,$5,'Owner'),($2,$2,'Other'),($3,$5,'Viewer'),($4,$5,'Peer')",[owner,other,viewer,peer,tenant]);
await db.query("INSERT INTO user_roles(user_id,tenant_id,role)VALUES($1,$5,'owner'),($2,$2,'owner'),($3,$5,'viewer'),($4,$5,'admin')",[owner,other,viewer,peer,tenant]);
await db.query("INSERT INTO products(id,tenant_id,name,manual_cost_override,cost_estimate,sale_price,catalog_details)VALUES($1,$2,'Legacy imported presépio',20.51,20.51,60,'{\"cost_source\":\"manual\",\"base_cost\":20.51,\"accessory_cost\":0,\"other_cost\":0}')",[product,tenant]);
await db.exec('SET ROLE authenticated');
try{
 await test('Saved product, pricing and marketplace readers share the same accepted cost despite an incomplete physical recipe',async()=>{
  const cost=await read();assert.equal(cost.complete,true);assert.equal(cost.source,'manual');assert.equal(cost.unit_cost,20.51);
  const physical=await scalar("SELECT product_pricing_preview($1,1,'{}')",[product]);assert.equal(physical.complete,false);
  const market=await scalar("SELECT product_channel_pricing_preview($1,'mercado_livre',1,'{}',NULL,NULL)",[product]);assert.equal(market.unit_cost,20.51);assert.equal(market.cost_source,'manual');
 });
 let firstKey,firstReceipt;
 await test('Accepting a new sale price preserves exact accepted costs, technical fields, stock and photos',async()=>{
  const before=await stored(),cost=await read();firstKey=next();firstReceipt=await apply(cost.revision,49.9,firstKey);
  const after=await stored();assert.equal(after.sale_price,49.9);
  for(const key of Object.keys(before).filter(k=>!['sale_price','updated_at','margin_percent','catalog_details'].includes(k)))assert.deepEqual(after[key],before[key],key);
  assert.equal(after.margin_percent,58.9);assert.deepEqual(after.catalog_details,{...before.catalog_details,price_source:'manual',markup_percent:null});
  const accepted=await scalar('SELECT to_jsonb(a) FROM product_pricing_acceptances a WHERE id=$1',[firstReceipt]);assert.equal(accepted.unit_cost,20.51);assert.equal(accepted.quantity,3);assert.equal(accepted.snapshot.production_readiness_confirmed,false);
  assert.equal(await scalar('SELECT count(*)::integer FROM inventory_movements'),0);
 });
 await test('Lost-response replay returns the immutable receipt and never overwrites a later accepted price',async()=>{
  const receipt=await scalar('SELECT snapshot FROM product_pricing_acceptances WHERE id=$1',[firstReceipt]);
  await admin(()=>db.query('UPDATE products SET sale_price=55 WHERE id=$1',[product]));
  assert.equal(await apply(receipt.cost_snapshot.revision,49.9,firstKey),firstReceipt);assert.equal((await stored()).sale_price,55);
  await assert.rejects(apply(receipt.cost_snapshot.revision,50,firstKey),/solicita|chave|reutiliz|mesma|Identificador/i);
 });
 await test('A changed cost or product version rejects the whole price write and does not consume the request id',async()=>{
  const old=await read(),key=next();await admin(()=>db.query('UPDATE products SET manual_cost_override=21 WHERE id=$1',[product]));
  await assert.rejects(apply(old.revision,50,key),/custo ou sua origem mudou/);assert.equal((await stored()).sale_price,55);
  await apply((await read()).revision,50,key);assert.equal((await stored()).sale_price,50);
 });
 await test('Composition origin cannot be converted into a manual-cost price through this RPC',async()=>{
  await admin(()=>db.query("UPDATE products SET catalog_details=catalog_details||'{\"cost_source\":\"composition\"}'::jsonb WHERE id=$1",[product]));
  const cost=await read();assert.equal(cost.source,'composition');await assert.rejects(apply(cost.revision),/custo ou sua origem mudou/);
  await admin(()=>db.query("UPDATE products SET catalog_details=catalog_details||'{\"cost_source\":\"manual\"}'::jsonb WHERE id=$1",[product]));
 });
 await test('Unknown costs stay pending, explicit zero is allowed, and money/quantity bounds remain enforced',async()=>{
  await admin(()=>db.query("UPDATE products SET manual_cost_override=NULL,cost_estimate=NULL,catalog_details='{\"cost_source\":\"manual\"}' WHERE id=$1",[product]));
  assert.equal((await read()).complete,false);await assert.rejects(apply((await read()).revision),/custo ou sua origem mudou/);
  await admin(()=>db.query('UPDATE products SET manual_cost_override=0 WHERE id=$1',[product]));const cost=await read();assert.equal(cost.unit_cost,0);assert.equal(cost.complete,true);
  for(const price of [0,-1,1.001,1000000001])await assert.rejects(apply(cost.revision,price),/preço de venda/);
  await assert.rejects(apply(cost.revision,1,next(),0),/quantidade/);await apply(cost.revision,.01);assert.equal((await stored()).manual_cost_override,0);
 });
 await test('Tenant, viewer and anonymous boundaries hold and an accepted request belongs to its original operator',async()=>{
  await login(other);await assert.rejects(read(),/não encontrado|arquivado/);await login(viewer);await assert.rejects(apply('unknown'),/permiss|acesso/i);
  await login(peer);const original=await scalar('SELECT snapshot FROM product_pricing_acceptances WHERE id=$1',[firstReceipt]);await assert.rejects(apply(original.cost_snapshot.revision,49.9,firstKey),/outro operador/);
  await db.exec('SET ROLE anon');await assert.rejects(read(),/permission denied/);await db.exec('SET ROLE authenticated');
 });
 console.log('Passed '+passed+' saved catalog cost and price scenarios.');
}finally{await db.close();}
