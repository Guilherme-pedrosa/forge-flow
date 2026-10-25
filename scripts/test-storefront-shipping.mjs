import { PGlite } from '@electric-sql/pglite';
import { readdir, readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

// Every HTTP exchange is recorded locally. No provider or production data is used.
const db = new PGlite();
await db.exec(`CREATE ROLE authenticated; CREATE ROLE anon; CREATE ROLE service_role;
 CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY,email text);
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 CREATE SCHEMA storage; CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean);
 CREATE TABLE storage.objects(id uuid DEFAULT gen_random_uuid(),bucket_id text,name text,owner uuid);
 CREATE FUNCTION storage.foldername(text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$ SELECT string_to_array($1,'/') $$;
 ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY; CREATE PUBLICATION supabase_realtime;
 GRANT USAGE ON SCHEMA public,auth,storage TO authenticated,anon;
 ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO authenticated;
 CREATE SCHEMA net;
 CREATE TABLE net.mock_requests(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,url text,body jsonb,headers jsonb,timeout_milliseconds integer);
 CREATE TABLE net._http_response(id bigint PRIMARY KEY,status_code integer,content text,timed_out boolean,error_msg text);
 CREATE FUNCTION net.http_post(url text,body jsonb DEFAULT '{}',headers jsonb DEFAULT '{}',timeout_milliseconds integer DEFAULT 1000) RETURNS bigint
 LANGUAGE plpgsql AS $$ DECLARE result bigint; BEGIN
   INSERT INTO net.mock_requests(url,body,headers,timeout_milliseconds) VALUES($1,$2,$3,$4) RETURNING id INTO result;
   RETURN result;
 END $$;`);
for (const name of (await readdir(new URL('../supabase/migrations/', import.meta.url))).filter(n => n.endsWith('.sql') && n <= '20261024180000_storefront_shipping.sql').sort()) {
  try { await db.exec((await readFile(new URL('../supabase/migrations/' + name, import.meta.url), 'utf8')).replace(/CREATE EXTENSION IF NOT EXISTS (pg_cron|pg_net);/g, '')); }
  catch (error) { throw new Error(`Migration ${name}: ${error.message}`, { cause: error }); }
}
const id = n => `72000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const owner=id(1), viewer=id(2), otherOwner=id(3), tenant=id(10), otherTenant=id(11);
const apple=id(20), leafKit=id(21), incomplete=id(22), unpublished=id(23), component=id(24), foreignProduct=id(25), stock=id(30), secondStock=id(31);
const scalar = async (sql,args=[]) => Object.values((await db.query(sql,args)).rows[0])[0];
const row = async (sql,args=[]) => (await db.query(sql,args)).rows[0];
const role = async (name='postgres',uid='') => { await db.exec('RESET ROLE'+(name==='postgres'?'':`; SET ROLE ${name}`)); await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[uid]); };
const admin = () => role('authenticated',owner);
const visitor = () => role('anon');
const root = () => role();
let passed=0, requestSequence=100, zipSequence=10;
const freshZip = () => '010010'+String(zipSequence++).padStart(2,'0');
const basePackage={length_cm:20,width_cm:15,height_cm:8,weight_grams:350};
const cartA=[{product_id:apple,quantity:2,expected_price:40}];
const cartMixed=[{product_id:apple,quantity:2,expected_price:40},{product_id:leafKit,quantity:3,expected_price:30}];
await db.query("INSERT INTO auth.users VALUES($1,'owner@qa.invalid'),($2,'viewer@qa.invalid'),($3,'other@qa.invalid')",[owner,viewer,otherOwner]);
await db.query("INSERT INTO tenants(id,name,slug) VALUES($1,'Shipping QA','shipping-qa'),($2,'Other Shipping','shipping-other')",[tenant,otherTenant]);
await db.query("INSERT INTO profiles(user_id,tenant_id,display_name) VALUES($1,$4,'Owner'),($2,$4,'Viewer'),($3,$5,'Other')",[owner,viewer,otherOwner,tenant,otherTenant]);
await db.query("INSERT INTO user_roles(user_id,tenant_id,role) VALUES($1,$4,'owner'),($2,$4,'viewer'),($3,$5,'owner')",[owner,viewer,otherOwner,tenant,otherTenant]);
await db.query("INSERT INTO inventory_items(id,tenant_id,name,unit,current_stock) VALUES($1,$3,'Ready apples','un',10000),($2,$3,'Ready kits','un',10000)",[stock,secondStock,tenant]);
await db.query("INSERT INTO products(id,tenant_id,name,sale_price,cost_estimate,photo_url,stock_item_id,shipping_package) VALUES($1,$3,'Apple',40,12345.67,'https://example.invalid/apple.jpg',$4,$5::jsonb),($2,$3,'Leaf kit',30,9999,'https://example.invalid/kit.jpg',$6,$7::jsonb)",[apple,leafKit,tenant,stock,JSON.stringify(basePackage),secondStock,JSON.stringify({length_cm:30,width_cm:10,height_cm:4,weight_grams:200})]);
await db.query("INSERT INTO products(id,tenant_id,name,sale_price,photo_url,shipping_package,is_component) VALUES($1,$5,'Incomplete',10,'https://example.invalid/missing.jpg',$6::jsonb,false),($2,$5,'Unpublished',10,'https://example.invalid/private.jpg',$6::jsonb,false),($3,$5,'Stem',1,'https://example.invalid/stem.jpg',$6::jsonb,true),($4,$7,'Foreign',10,'https://example.invalid/foreign.jpg',$6::jsonb,false)",[incomplete,unpublished,component,foreignProduct,tenant,JSON.stringify({length_cm:20}),otherTenant]);
await admin();
const channel=await scalar("SELECT configure_storefront('shipping-qa',true)");
const publish = (product,extra={}) => scalar('SELECT save_storefront_listing($1,$2,$3::jsonb)',[channel,product,JSON.stringify({published:true,category:'Presentes',price_override:null,made_to_order:true,lead_days:5,...extra})]);
await publish(apple,{made_to_order:false}); await publish(leafKit); await publish(incomplete); await publish(unpublished,{published:false});
await scalar("SELECT save_storefront_payment_settings($1,$2,$3,'sandbox',5,ARRAY['SP'])",[channel,'TEST-fake-shipping-token-for-qa-only','fake-shipping-webhook-secret-only']);
await scalar('SELECT save_storefront_shipping_settings($1,$2,$3,true)',[channel,'04547000',2]);
await root(); await db.query("UPDATE storefront_payment_credentials SET verified_at=now(),collector_id='12345' WHERE channel_id=$1",[channel]);
await role('authenticated',otherOwner); const otherChannel=await scalar("SELECT configure_storefront('shipping-other',true)");
await root();
// A component must remain private even if legacy data contains a listing.
await db.query("INSERT INTO storefront_listings(tenant_id,channel_id,product_id,published,made_to_order) VALUES($1,$2,$3,true,true)",[tenant,channel,component]);

const quote = async (items=cartA,zip=freshZip()) => { await visitor(); return scalar("SELECT storefront_shipping_quote('shipping-qa',$1,$2::jsonb)",[zip,JSON.stringify(items)]); };
const status = async q => { await visitor(); return scalar("SELECT storefront_shipping_quote_status('shipping-qa',$1)",[q.id??q]); };
const snapshot = async q => { await root(); return scalar('SELECT snapshot FROM erp_private.storefront_shipping_quotes WHERE id=$1',[q.id??q]); };
const configure = async (handling=2,enabled=true) => { await admin(); await scalar('SELECT save_storefront_shipping_settings($1,$2,$3,$4)',[channel,'04547000',handling,enabled]); };
const response = async (q,body={options:[{service:'PAC',price:19.9,delivery_days:4},{service:'SEDEX',price:39.9,delivery_days:2}],package_count:q.package_count,destination:{zip:q.destination_zip,state:'SP'}},meta={}) => {
  await root(); const requestId=await scalar('SELECT transport_request_id FROM erp_private.storefront_shipping_quotes WHERE id=$1',[q.id]);
  await db.query('INSERT INTO net._http_response(id,status_code,content,timed_out,error_msg) VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO UPDATE SET status_code=excluded.status_code,content=excluded.content,timed_out=excluded.timed_out,error_msg=excluded.error_msg',[requestId,Object.hasOwn(meta,'status')?meta.status:200,typeof body==='string'?body:JSON.stringify(body),meta.timeout??false,meta.error??null]);
  return status(q);
};
const ready = async (items=cartA,zip=freshZip()) => { const q=await quote(items,zip); return {...q,...await response(q)}; };
const customer = zip => ({name:'Cliente QA',email:'client@qa.invalid',phone:'11999999999',address:{zip,street:'Rua QA',number:'1',city:'São Paulo',state:'SP'}});
const checkoutPayload = (q,extra={}) => ({customer:customer(q.destination_zip),notes:'Teste isolado',items:cartA,expected_shipping:19.9,shipping_quote_id:q.id,shipping_service:'PAC',...extra});
const checkout = async (payload,request=id(requestSequence++)) => { await role('service_role'); return scalar("SELECT begin_storefront_checkout('shipping-qa',$1,$2::jsonb)",[request,JSON.stringify(payload)]); };
async function test(name,fn) { try { await root(); await fn(); passed++; console.log('PASS '+name); } catch(error) { console.error('FAIL '+name,error.message,error.where??''); throw error; } }

try {
  await test('configuração restrita a administradores da empresa, com CEP e prazo válidos',async()=>{
    await admin(); const cfg=await scalar('SELECT storefront_shipping_settings($1)',[channel]); assert.equal(cfg.origin_zip,'04547000'); assert.equal(cfg.handling_days,2); assert.equal(cfg.enabled,true);
    await assert.rejects(scalar('SELECT save_storefront_shipping_settings($1,$2,$3,true)',[channel,'04547-000',2]),/CEP/);
    await assert.rejects(scalar('SELECT save_storefront_shipping_settings($1,$2,$3,true)',[channel,'04547000',31]),/prazo/);
    await assert.rejects(scalar('SELECT storefront_shipping_settings($1)',[otherChannel]),/administrador/);
    await role('authenticated',viewer); await assert.rejects(scalar('SELECT save_storefront_shipping_settings($1,$2,$3,true)',[channel,'04547000',2]),/administrador/);
    await role('authenticated',otherOwner); await assert.rejects(scalar('SELECT save_storefront_shipping_settings($1,$2,$3,true)',[channel,'04547000',2]),/administrador/);
    await visitor(); await assert.rejects(scalar('SELECT storefront_shipping_settings($1)',[channel]),/permission denied/);
  });
  await test('catálogo público, embalagem completa, preço e quantidade conferidos no servidor',async()=>{
    await assert.rejects(quote([{product_id:incomplete,quantity:1}]),/Complete.*embalado/);
    for(const product of [unpublished,component,foreignProduct]) await assert.rejects(quote([{product_id:product,quantity:1}]),/saiu do catálogo/);
    for(const quantity of [0,-1,1.5,501,'2']) await assert.rejects(quote([{product_id:apple,quantity}]),/Quantidade/);
    await assert.rejects(quote([{product_id:apple,quantity:1,expected_price:0.01}]),/preço.*mudou/);
    await assert.rejects(quote([cartA[0],cartA[0]]),/carrinho/);
    await assert.rejects(quote(cartA,'01001-000'),/CEP/);
    await visitor(); await assert.rejects(scalar("SELECT storefront_shipping_quote('missing','01001000',$1::jsonb)",[JSON.stringify(cartA)]),/indisponível/);
  });
  let mixedQuote;
  await test('empacotamento determinístico soma alturas de SKUs diferentes, massa e valor declarado',async()=>{
    mixedQuote=await quote(cartMixed,'01001000'); const s=await snapshot(mixedQuote);
    assert.equal(mixedQuote.status,'pending'); assert.equal(mixedQuote.package_count,1);
    assert.deepEqual(s.packages,[{length_cm:30,width_cm:15,height_cm:28,weight_grams:1300,declared_value:170}]);
    assert.equal(s.dispatch_days,7);
    const same=await quote([...cartMixed].reverse(),'01001000'); assert.equal(same.id,mixedQuote.id);
  });
  await test('ponte recebe somente ID aleatório por HTTPS e manifesto público selado',async()=>{
    await root(); const outbound=await row('SELECT r.* FROM net.mock_requests r JOIN erp_private.storefront_shipping_quotes q ON q.transport_request_id=r.id WHERE q.id=$1',[mixedQuote.id]);
    assert.equal(outbound.url,'https://selovacembalagens.com.br/api/public/forge-frete'); assert.deepEqual(outbound.body,{quote_id:mixedQuote.id});
    assert.deepEqual(outbound.headers,{'Content-Type':'application/json'}); assert.equal(outbound.timeout_milliseconds,40000);
    await visitor(); const manifest=await scalar("SELECT storefront_shipping_manifest('shipping-qa',$1)",[mixedQuote.id]);
    assert.deepEqual(Object.keys(manifest).sort(),['destination_zip','dispatch_days','origin_zip','packages']);
    assert.equal(JSON.stringify(manifest).includes(apple),false); assert.equal(JSON.stringify(manifest).includes('12345.67'),false);
    assert.equal(await scalar("SELECT storefront_shipping_manifest('shipping-other',$1)",[mixedQuote.id]),null);
    assert.equal(await scalar("SELECT storefront_shipping_quote_status('shipping-other',$1)",[mixedQuote.id]),null);
    await assert.rejects(db.query('SELECT * FROM erp_private.storefront_shipping_config'),/permission denied/);
    await assert.rejects(db.query('SELECT * FROM erp_private.storefront_shipping_quotes'),/permission denied/);
    await assert.rejects(db.query('SELECT * FROM net.mock_requests'),/permission denied/);
  });
  await test('cotação confirma preço e separa prazo do transporte da preparação e produção',async()=>{
    const q=await response(mixedQuote); assert.equal(q.status,'ready');
    assert.deepEqual(q.options,[{service:'PAC',label:'Correios PAC',price:19.9,delivery_days:4,dispatch_days:7,total_days:11},{service:'SEDEX',label:'Correios SEDEX',price:39.9,delivery_days:2,dispatch_days:7,total_days:9}]);
    assert.equal('snapshot' in q,false); assert.equal('transport_request_id' in q,false);
    await visitor(); assert.equal(await scalar("SELECT storefront_shipping_manifest('shipping-qa',$1)",[q.id]),null);
  });
  await test('múltiplos volumes respeitam30kg, soma de dimensões e limite de30 volumes',async()=>{
    await root(); await db.query('UPDATE products SET shipping_package=$2::jsonb WHERE id=$1',[apple,JSON.stringify({...basePackage,weight_grams:16000})]);
    const byWeight=await quote(); assert.equal(byWeight.package_count,2); const sw=await snapshot(byWeight); assert.deepEqual(sw.packages.map(p=>p.weight_grams),[16000,16000]);
    await db.query('UPDATE products SET shipping_package=$2::jsonb WHERE id=$1',[apple,JSON.stringify({length_cm:100,width_cm:60,height_cm:40,weight_grams:350})]);
    const bySize=await quote(); assert.equal(bySize.package_count,2);
    await root(); await db.query('UPDATE products SET shipping_package=$2::jsonb WHERE id=$1',[apple,JSON.stringify({...basePackage,weight_grams:30000})]);
    await assert.rejects(quote([{product_id:apple,quantity:31}]),/30 volumes/);
    for(const pack of [{...basePackage,length_cm:101},{length_cm:100,width_cm:80,height_cm:30,weight_grams:350},{...basePackage,weight_grams:30001}]) {
      await root(); await db.query('UPDATE products SET shipping_package=$2::jsonb WHERE id=$1',[apple,JSON.stringify(pack)]); await assert.rejects(quote(),/limites/);
    }
    await root(); await db.query('UPDATE products SET shipping_package=$2::jsonb WHERE id=$1',[apple,JSON.stringify(basePackage)]);
  });
  await test('respostas inválidas e timeout não criam estimativa nem frete gratuito',async()=>{
    const valid=q=>({package_count:q.package_count,options:[{service:'PAC',price:19.9,delivery_days:4}],destination:{zip:q.destination_zip,state:'SP'}});
    const cases=[q=>["{"],q=>[valid(q),{status:500}],q=>[valid(q),{status:null}],q=>[valid(q),{timeout:true}],q=>[valid(q),{error:'network failure'}],
      q=>[{...valid(q),package_count:q.package_count+1}],q=>[{...valid(q),options:[{service:'PAC',price:0,delivery_days:4}]}],
      q=>[{...valid(q),options:[{service:'PAC',price:'19.90',delivery_days:4}]}],q=>[{...valid(q),options:[{service:'PAC',price:19.999,delivery_days:4}]}],
      q=>[{...valid(q),options:[{service:'PAC',price:19.9,delivery_days:1.5}]}],q=>[{...valid(q),options:[{service:'OTHER',price:19.9,delivery_days:4}]}],
      q=>[{...valid(q),options:[...valid(q).options,...valid(q).options]}],q=>[{...valid(q),destination:undefined}],
      q=>[{...valid(q),destination:{zip:q.destination_zip,state:'XX'}}],q=>[{...valid(q),destination:{zip:'20040002',state:'SP'}}]];
    for(const invalid of cases) { const q=await quote(); const result=await response(q,...invalid(q)); assert.equal(result.status,'error'); assert.deepEqual(result.options,[]); assert.match(result.error,/cotação válida/); }
    const slow=await quote(); await root(); await db.query("UPDATE erp_private.storefront_shipping_quotes SET created_at=now()-interval '51 seconds' WHERE id=$1",[slow.id]);
    const timed=await status(slow); assert.equal(timed.status,'error'); assert.match(timed.error,/demorou/); assert.deepEqual(timed.options,[]);
  });
  await test('cache expira e mudanças da configuração invalidam manifesto e resposta antigos',async()=>{
    const q=await ready(); const same=await quote(cartA,q.destination_zip); assert.equal(same.id,q.id);
    await root(); await db.query("UPDATE erp_private.storefront_shipping_quotes SET expires_at=now()-interval '1 second' WHERE id=$1",[q.id]);
    assert.equal((await status(q)).status,'error'); const fresh=await quote(cartA,q.destination_zip); assert.notEqual(fresh.id,q.id);
    const pending=await quote(); await configure(3); await visitor(); assert.equal(await scalar("SELECT storefront_shipping_manifest('shipping-qa',$1)",[pending.id]),null); assert.equal((await status(pending)).status,'error');
    const changed=await quote(cartA,pending.destination_zip); assert.notEqual(changed.id,pending.id);
    const oldReady=await response(changed); await configure(3,false); assert.equal((await status(oldReady)).status,'error');
    await assert.rejects(quote(),/não foi configurado/); await configure(2,true);
  });
  await test('checkout rejeita adulteração de frete, CEP, UF, carrinho, serviço e expiração',async()=>{
    const q=await ready(); const payload=checkoutPayload(q);
    await assert.rejects(checkout({...payload,expected_shipping:0}),/frete mudou/);
    await assert.rejects(checkout({...payload,customer:customer('20040002')}),/CEP mudou/);
    await assert.rejects(checkout({...payload,customer:{...payload.customer,address:{...payload.customer.address,state:'RJ'}}}),/UF/);
    await assert.rejects(checkout({...payload,items:[{...cartA[0],quantity:3}]}),/carrinho.*mudou/);
    await assert.rejects(checkout({...payload,items:[{...cartA[0],expected_price:0.01}]}),/preço.*mudou/);
    await assert.rejects(checkout({...payload,shipping_service:'OTHER'}),/Selecione/);
    await assert.rejects(checkout({...payload,shipping_service:'SEDEX'}),/frete mudou/);
    await assert.rejects(checkout({...payload,shipping_quote_id:id(9999)}),/frete válido/);
    await root(); await db.query("UPDATE erp_private.storefront_shipping_quotes SET expires_at=now()-interval '1 second' WHERE id=$1",[q.id]);
    await assert.rejects(checkout(payload),/frete válido/); await root(); assert.equal(await scalar('SELECT count(*)::integer FROM orders'),0);
  });
  await test('pedido usa frete exato do servidor e retry aceito recupera após expirar a cotação',async()=>{
    const q=await ready(); const payload=checkoutPayload(q); const request=id(requestSequence++); const start=await checkout(payload,request);
    await root(); const order=await row('SELECT shipping,total FROM orders WHERE id=$1',[start.order_id]); assert.equal(Number(order.shipping),19.9); assert.equal(Number(order.total),99.9);
    const stored=await row('SELECT shipping_quote_id,shipping_service,shipping_price,shipping_delivery_days FROM storefront_requests WHERE id=$1',[start.internal_request_id]);
    assert.equal(stored.shipping_quote_id,q.id); assert.equal(stored.shipping_service,'PAC'); assert.equal(Number(stored.shipping_price),19.9); assert.equal(stored.shipping_delivery_days,6);
    await db.query("UPDATE storefront_requests SET checkout_locked_until=NULL WHERE id=$1",[start.internal_request_id]);
    await db.query("UPDATE erp_private.storefront_shipping_quotes SET expires_at=now()-interval '1 second' WHERE id=$1",[q.id]);
    await configure(4,false); const recovered=await checkout(payload,request); assert.equal(recovered.internal_request_id,start.internal_request_id);
    await root(); assert.equal(await scalar('SELECT count(*)::integer FROM orders'),1); assert.equal(await scalar('SELECT count(*)::integer FROM customers'),1);
    assert.equal(await scalar('SELECT count(*)::integer FROM accounts_receivable'),0); assert.equal(await scalar('SELECT count(*)::integer FROM jobs'),0);
    await assert.rejects(checkout({...payload,expected_shipping:1},request),/outro conteúdo/);
  });
  console.log(`PASS ${passed} shipping database groups; HTTP transport remained mocked and no provider request was made.`);
} finally { await db.close(); }
