import { PGlite } from '@electric-sql/pglite';
import { readdir, readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

// Real PostgreSQL execution; pg_net is a local queue mock. No HTTP or real token.
const db = new PGlite();
await db.exec(`CREATE ROLE authenticated; CREATE ROLE anon;
  CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY,email text);
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
  CREATE SCHEMA storage; CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean);
  CREATE TABLE storage.objects(id uuid DEFAULT gen_random_uuid(),bucket_id text,name text,owner uuid);
  CREATE FUNCTION storage.foldername(text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$ SELECT string_to_array($1,'/') $$;
  ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY; CREATE PUBLICATION supabase_realtime;
  GRANT USAGE ON SCHEMA public,auth,storage TO authenticated,anon;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO authenticated;
  CREATE SCHEMA net; GRANT USAGE ON SCHEMA net TO PUBLIC;
  CREATE TABLE net.http_request_queue(id bigserial PRIMARY KEY,url text,params jsonb,headers jsonb,timeout_milliseconds integer);
  CREATE TABLE net._http_response(id bigint,status_code integer,content text,timed_out boolean,error_msg text,created timestamptz DEFAULT now());
  GRANT ALL ON ALL TABLES IN SCHEMA net TO PUBLIC;
  CREATE FUNCTION net.http_get(url text,params jsonb DEFAULT '{}',headers jsonb DEFAULT '{}',timeout_milliseconds integer DEFAULT 2000) RETURNS bigint
    LANGUAGE plpgsql SECURITY DEFINER AS $$ DECLARE request bigint; BEGIN
      INSERT INTO net.http_request_queue(url,params,headers,timeout_milliseconds) VALUES($1,$2,$3,$4) RETURNING id INTO request;
      RETURN request;
    END $$;`);
for (const name of (await readdir(new URL('../supabase/migrations/',import.meta.url))).filter(name=>name.endsWith('.sql')).sort()) {
  const sql=(await readFile(new URL('../supabase/migrations/'+name,import.meta.url),'utf8')).replace(/CREATE EXTENSION IF NOT EXISTS (pg_cron|pg_net);/g,'');
  try { await db.exec(sql); } catch(error) { throw new Error(`Migration ${name}: ${error.message}`); }
}

const id=n=>`90000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const tenant=id(1),otherTenant=id(2),uid=id(3),otherUid=id(4),viewer=id(5);
const scalar=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0];
const row=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
await db.query("INSERT INTO auth.users VALUES($1,'maker@test.invalid'),($2,'other@test.invalid'),($3,'viewer@test.invalid')",[uid,otherUid,viewer]);
await db.query("INSERT INTO tenants(id,name,slug) VALUES($1,'Makerworld QA','makerworld-qa'),($2,'Other','makerworld-other')",[tenant,otherTenant]);
await db.query("INSERT INTO profiles(user_id,tenant_id,display_name) VALUES($1,$4,'Owner'),($2,$5,'Other'),($3,$4,'Viewer')",[uid,otherUid,viewer,tenant,otherTenant]);
await db.query("INSERT INTO user_roles(user_id,tenant_id,role) VALUES($1,$4,'owner'),($2,$5,'owner'),($3,$4,'viewer')",[uid,otherUid,viewer,tenant,otherTenant]);
await db.exec('SET ROLE authenticated');await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[uid]);
async function owner(fn){await db.exec('RESET ROLE');try{return await fn();}finally{await db.exec('SET ROLE authenticated');}}
let sequence=100,passed=0;const next=()=>id(sequence++);
const get=request=>scalar('SELECT get_makerworld_import($1)',[request]);
const request=design=>scalar('SELECT request_makerworld_import($1)',[`https://makerworld.com/pt/models/${design}-project#profileId-${design}`]);
async function receive(requestId,content,status=200,extra={}){await owner(()=>db.query('INSERT INTO net._http_response(id,status_code,content,timed_out,error_msg) VALUES($1,$2,$3,$4,$5)',[requestId,status,typeof content==='string'?content:JSON.stringify(content),extra.timed_out??false,extra.error_msg??null]));return get(requestId);}
async function clearRequests(){await owner(()=>db.exec('DELETE FROM net._http_response;DELETE FROM net.http_request_queue;DELETE FROM makerworld_import_requests;'));}
const images=Array.from({length:35},(_,n)=>`https://cdn.example.invalid/project-photo-${n}.jpg`);
const variant=extra=>({profile_id:null,printer_model:null,printer_code:null,nozzle_diameter:null,weight_grams:null,time_seconds:null,plates:null,plate_details:[],filaments:[],images:[],warnings:[],...extra});
const reference=()=>({schema_version:1,provider:'makerworld',id:'1169522',design_id:'1169522',model_id:'PUBLIC-MODEL',source_url:'https://makerworld.com/pt/models/1169522-project#profileId-1177581',title:'Modular organizer',description:'Complete description',description_html:'<p>Complete description</p>',images,gallery:images,
  tags:['Organizer'],categories:[],files:[],accessories:[],documentation:[],warnings:[],
  profiles:[{...variant({profile_id:'241221531',weight_grams:100,time_seconds:6000,plates:3,plate_details:[{index:1,filaments:[],images:[],objects:[],warnings:[]}],filaments:[{type:'PLA',color:'Black'}]}),instance_id:'1177581',name:'All parts',variants:[variant({profile_id:'241221532',printer_model:'Other printer'})]},
    {...variant({profile_id:'241221540'}),instance_id:'1177582',name:'Second profile',variants:[]}],
  selected_profile_id:'1177581',selected_variant_profile_id:'241221532',metadata_complete:true});
const save=(product,photos=images,p=null,requestId=next())=>scalar('SELECT save_product_with_photos($1,$2::jsonb,$3::jsonb,$4)',[p,JSON.stringify(product),JSON.stringify(photos),requestId]);
const draft=()=>({name:'Imported product',material_id:null,est_grams:100,est_time_minutes:100,prints_per_plate:1,cost_estimate:null,sale_price:null,external_import:reference()});
async function test(name,fn){try{await fn();passed++;console.log('PASS '+name);}catch(error){console.error('FAIL '+name+': '+error.message+' '+(error.where??''));throw error;}}
try{
await test('Public import uses only the hardcoded Bambu design endpoint and no credentials',async()=>{
  const r=await request('1169522');const queued=await owner(()=>row('SELECT url,headers,params,timeout_milliseconds FROM net.http_request_queue WHERE id=$1',[r]));
  assert.equal(queued.url,'https://api.bambulab.com/v1/design-service/design/1169522');assert.deepEqual(queued.headers,{Accept:'application/json'});assert.deepEqual(queued.params,{});assert.equal(queued.timeout_milliseconds,10000);
  assert.equal((await get(r)).status,'pending');assert.equal(await request('1169522'),r);
  const payload={id:1169522,title:'Public design',instances:[{id:1177581,profiles:[{profile_id:241221531}]}]};const response=await receive(r,payload);assert.equal(response.status,'ready');assert.deepEqual(response.payload,payload);assert.deepEqual((await get(r)).payload,payload);
  assert.equal(await owner(()=>scalar('SELECT count(*)::integer FROM net._http_response WHERE id=$1',[r])),0);
  await assert.rejects(db.query('SELECT * FROM net.http_request_queue'),/permission denied/);await assert.rejects(db.query('SELECT * FROM net._http_response'),/permission denied/);
});
await test('Unsupported hosts, credentials and arbitrary paths cannot become outbound requests',async()=>{
  const before=await owner(()=>scalar('SELECT count(*)::integer FROM net.http_request_queue'));
  for(const url of ['http://makerworld.com/models/123','https://makerworld.com.evil.test/models/123','https://evil.test/models/123','https://user:pass@makerworld.com/models/123','https://makerworld.com/private/admin','https://makerworld.com/models/0'])await assert.rejects(scalar('SELECT request_makerworld_import($1)',[url]),/MakerWorld|modelo|Identificador/);
  assert.equal(await owner(()=>scalar('SELECT count(*)::integer FROM net.http_request_queue')),before);
});
await test('Other tenants and viewers cannot inspect or create imports; direct table writes are denied',async()=>{
  const r=await request('1169523');await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[otherUid]);await assert.rejects(get(r),/não encontrada/);assert.equal(await scalar('SELECT count(*)::integer FROM makerworld_import_requests WHERE request_id=$1',[r]),0);
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[viewer]);await assert.rejects(request('1169524'),/permissão/);
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[uid]);await assert.rejects(db.query("UPDATE makerworld_import_requests SET status='ready' WHERE request_id=$1",[r]),/permission denied/);
});
await test('Rate and pending limits apply without counting duplicate clicks as new requests',async()=>{
  await clearRequests();const first=await request('1001');await request('1002');await request('1003');assert.equal(await request('1001'),first);await assert.rejects(request('1004'),/três/);
  for(const design of ['1001','1002','1003']){const r=await scalar('SELECT request_id FROM makerworld_import_requests WHERE design_id=$1',[design]);await receive(r,{id:Number(design)});}
  const fourth=await request('1004');await receive(fourth,{id:1004});const fifth=await request('1005');await receive(fifth,{id:1005});await assert.rejects(request('1006'),/cinco/);
});
await test('Abandoned browser requests release pending slots without bypassing the minute quota',async()=>{
  await clearRequests();await request('3001');await request('3002');await request('3003');
  await owner(()=>db.exec("UPDATE makerworld_import_requests SET requested_at=now()-interval '46 seconds'"));
  await request('3004');await request('3005');await assert.rejects(request('3006'),/cinco/);
  assert.equal(await scalar("SELECT count(*)::integer FROM makerworld_import_requests WHERE status='error'"),3);
  assert.equal(await owner(()=>scalar('SELECT count(*)::integer FROM net.http_request_queue')),2);
});
await test('Timeouts, invalid IDs, HTML and oversized responses return only safe errors',async()=>{
  await clearRequests();let r=await request('2001');assert.equal((await receive(r,'internal token text',503,{error_msg:'Never reveal internal headers'})).status,'error');assert.ok(!JSON.stringify(await get(r)).includes('headers'));
  r=await request('2002');assert.equal((await receive(r,'<html>not a project</html>')).status,'error');
  r=await request('2003');assert.equal((await receive(r,{id:9999})).status,'error');
  r=await request('2004');assert.equal((await receive(r,'x'.repeat(2097153))).status,'error');
  r=await request('2005');await owner(()=>db.query("UPDATE makerworld_import_requests SET expires_at=now()-interval '1 second' WHERE request_id=$1",[r]));assert.equal((await get(r)).status,'error');assert.equal(await scalar('SELECT count(*)::integer FROM makerworld_import_requests WHERE request_id=$1',[r]),0);
});
await test('Product save preserves every gallery image and profile while creating only a design reference',async()=>{
  const payload=draft(),key=next(),p=await save(payload,images,null,key);assert.equal(await save(payload,images,null,key),p);
  const product=await row('SELECT material_id,external_import FROM products WHERE id=$1',[p]);assert.equal(product.material_id,null);assert.deepEqual(product.external_import,payload.external_import);
  assert.equal(await scalar('SELECT count(*)::integer FROM product_photos WHERE product_id=$1',[p]),35);
  const sources=(await db.query('SELECT source_url,design_id,instance_id,model_id,profile_id FROM product_print_sources WHERE product_id=$1',[p])).rows;
  assert.equal(sources.length,1);assert.deepEqual(sources[0],{source_url:'https://makerworld.com/models/1169522',design_id:'1169522',instance_id:null,model_id:null,profile_id:null});
  assert.equal(await scalar('SELECT count(*)::integer FROM product_print_plates WHERE product_id=$1',[p]),0);assert.equal(await scalar('SELECT count(*)::integer FROM product_material_recipe_versions WHERE product_id=$1',[p]),0);
});
await test('Ordinary edits preserve imported metadata and an old request cannot overwrite later edits',async()=>{
  const payload=draft(),key=next(),p=await save(payload,images,null,key);await save({name:'Later manual name',material_id:null,est_grams:10,est_time_minutes:5,prints_per_plate:1},[],p);
  assert.deepEqual(await scalar('SELECT external_import FROM products WHERE id=$1',[p]),payload.external_import);assert.equal(await save(payload,images,null,key),p);assert.equal(await scalar('SELECT name FROM products WHERE id=$1',[p]),'Later manual name');assert.equal(await scalar('SELECT count(*)::integer FROM product_photos WHERE product_id=$1',[p]),0);
  await save({...payload,name:'Reimported review'},images,p);assert.equal(await scalar('SELECT count(*)::integer FROM product_print_sources WHERE product_id=$1',[p]),1);
});
await test('An import preserves verified source IDs and null metadata cannot erase the stored reference',async()=>{
  const payload=draft(),p=await save(payload),source=await scalar('SELECT id FROM product_print_sources WHERE product_id=$1',[p]);
  await owner(()=>db.query("UPDATE product_print_sources SET instance_id='1177581',profile_id='verified-profile',model_id='verified-model' WHERE id=$1",[source]));
  await save({...payload,name:'New catalogue title'},images,p);
  assert.deepEqual(await row('SELECT instance_id,profile_id,model_id FROM product_print_sources WHERE id=$1',[source]),{instance_id:'1177581',profile_id:'verified-profile',model_id:'verified-model'});
  await save({...payload,external_import:null},[],p);assert.deepEqual(await scalar('SELECT external_import FROM products WHERE id=$1',[p]),payload.external_import);
  await db.query("UPDATE products SET external_import='{}'::jsonb WHERE id=$1",[p]);assert.deepEqual(await scalar('SELECT external_import FROM products WHERE id=$1',[p]),payload.external_import);
});
await test('The 100-photo boundary is retained exactly and a request key cannot change its payload',async()=>{
  const photos=Array.from({length:100},(_,i)=>`https://images.invalid/full-${i}.jpg`),payload=draft(),key=next(),p=await save(payload,photos,null,key);
  assert.equal(await scalar('SELECT count(*)::integer FROM product_photos WHERE product_id=$1',[p]),100);
  await assert.rejects(save({...payload,name:'Changed request'},photos,null,key),/outra|diferente|reutiliz/);
  assert.equal(await scalar('SELECT name FROM products WHERE id=$1',[p]),payload.name);
});
await test('A downstream source failure rolls back product, photos and request so retry is safe',async()=>{
  const key=next(),payload=draft();const before=await scalar('SELECT count(*)::integer FROM products');
  await owner(()=>db.exec("CREATE FUNCTION public.qa_source_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'QA source error';END $$;CREATE TRIGGER qa_source_failure BEFORE INSERT ON product_print_sources FOR EACH ROW EXECUTE FUNCTION qa_source_failure();"));
  await assert.rejects(save(payload,images,null,key),/QA source error/);assert.equal(await scalar('SELECT count(*)::integer FROM products'),before);
  await owner(()=>db.exec('DROP TRIGGER qa_source_failure ON product_print_sources;DROP FUNCTION qa_source_failure();'));const p=await save(payload,images,null,key);assert.ok(p);
});
await test('Metadata mismatch, invalid selection and gallery overflow fail explicitly without partial writes',async()=>{
  const before=await scalar('SELECT count(*)::integer FROM products');
  await assert.rejects(save({...draft(),external_import:{...reference(),design_id:'999'}}),/não corresponde/);
  await assert.rejects(save({...draft(),external_import:{...reference(),selected_profile_id:'241221531'}}),/perfil público/);
  await assert.rejects(save(draft(),Array.from({length:101},(_,i)=>`https://images.invalid/${i}.jpg`)),/100 fotos/);
  assert.equal(await scalar('SELECT count(*)::integer FROM products'),before);
});
await test('Missing schema or normalized arrays, null entries and nested incomplete plates cannot be persisted',async()=>{
  const before=await scalar('SELECT count(*)::integer FROM products');
  const malformed=[{provider:'makerworld',source_url:reference().source_url,design_id:'1169522'}, {...reference(),schema_version:2}];
  for(const field of ['profiles','images','gallery','tags','categories','files','accessories','documentation','warnings']){const r=reference();delete r[field];malformed.push(r);}
  for(const field of ['variants','plate_details','filaments','images','warnings']){const r=reference();delete r.profiles[0][field];malformed.push(r);}
  for(const field of ['plate_details','filaments','images','warnings']){const r=reference();delete r.profiles[0].variants[0][field];malformed.push(r);}
  for(const field of ['filaments','images','objects','warnings']){const r=reference();delete r.profiles[0].plate_details[0][field];malformed.push(r);}
  const nullFilament=reference();nullFilament.profiles[0].filaments=[null];malformed.push(nullFilament);
  const nullPlate=reference();nullPlate.profiles[0].plate_details=[null];malformed.push(nullPlate);
  const nullVariant=reference();nullVariant.profiles[0].variants=[null];malformed.push(nullVariant);
  malformed.push({...reference(),warnings:[{}]},{...reference(),files:[null]});
  for(const r of malformed)await assert.rejects(save({...draft(),external_import:r}),/MakerWorld/);
  assert.equal(await scalar('SELECT count(*)::integer FROM products'),before);
});
await test('A selected printer variant must belong to the selected public profile, including its base variant',async()=>{
  const before=await scalar('SELECT count(*)::integer FROM products');
  for(const selected_variant_profile_id of ['241221540','foreign-variant'])await assert.rejects(save({...draft(),external_import:{...reference(),selected_variant_profile_id}}),/não pertence/);
  await assert.rejects(save({...draft(),external_import:{...reference(),selected_profile_id:null,selected_instance_id:null}}),/não pertence/);
  assert.equal(await scalar('SELECT count(*)::integer FROM products'),before);
  const base={...reference(),selected_variant_profile_id:'241221531'};const p=await save({...draft(),external_import:base});assert.deepEqual(await scalar('SELECT external_import FROM products WHERE id=$1',[p]),base);
});
await test('Import edits cannot cross tenants and failed photos leave no product or source',async()=>{
  const p=await save(draft());await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[otherUid]);await assert.rejects(save(draft(),[],p),/não encontrado/);await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[uid]);
  const before=await scalar('SELECT count(*)::integer FROM products');await assert.rejects(save(draft(),['javascript:alert(1)']),/URL de foto/);assert.equal(await scalar('SELECT count(*)::integer FROM products'),before);
});
console.log(`Validated ${passed} MakerWorld import scenarios.`);
}finally{await db.close();}
