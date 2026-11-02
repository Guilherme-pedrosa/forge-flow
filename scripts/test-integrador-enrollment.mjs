// Disposable PostgreSQL only. No OAuth provider, deployed database or real proof.
import {PGlite} from '@electric-sql/pglite';
import {readFile,readdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
const root=fileURLToPath(new URL('../',import.meta.url)),migration='20261102237000_integrador_new_account_enrollment.sql',db=new PGlite();
process.on('uncaughtException',e=>{console.error(e.message,e.where??'');process.exit(1);});
const scalar=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0];
const id=n=>`96000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
let seq=100,passed=0;const next=()=>id(seq++),tenant=id(1),otherTenant=id(2),owner=id(3),viewer=id(4),operator=id(5),foreignOwner=id(6),bridge=id(7);
const proof='a'.repeat(64),seller='7770001';
await db.exec(`CREATE ROLE authenticated;CREATE ROLE anon;CREATE ROLE service_role;CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY,email text);
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 CREATE SCHEMA storage;CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean);CREATE TABLE storage.objects(id uuid DEFAULT gen_random_uuid(),bucket_id text,name text,owner uuid);
 CREATE FUNCTION storage.foldername(text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$ SELECT string_to_array($1,'/') $$;
 ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;CREATE PUBLICATION supabase_realtime;GRANT USAGE ON SCHEMA public,auth,storage TO authenticated,anon;
 ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO authenticated;`);
try{
 for(const name of (await readdir(path.join(root,'supabase/migrations'))).filter(n=>n.endsWith('.sql')&&n<=migration).sort()){
  try{await db.exec((await readFile(path.join(root,'supabase/migrations',name),'utf8')).replace(/CREATE EXTENSION IF NOT EXISTS (pg_cron|pg_net);/g,''));}
  catch(e){throw new Error(`Migration ${name}: ${e.message}`);}
 }
 await db.query("INSERT INTO auth.users VALUES($1,'owner@enroll.invalid'),($2,'viewer@enroll.invalid'),($3,'operator@enroll.invalid'),($4,'foreign@enroll.invalid')",[owner,viewer,operator,foreignOwner]);
 await db.query("INSERT INTO tenants(id,name,slug)VALUES($1,'Enrollment QA','enrollment-qa'),($2,'Other QA','other-enrollment-qa')",[tenant,otherTenant]);
 await db.query("INSERT INTO profiles(user_id,tenant_id,display_name)VALUES($1,$5,'Owner'),($2,$5,'Viewer'),($3,$5,'Operator'),($4,$6,'Foreign')",[owner,viewer,operator,foreignOwner,tenant,otherTenant]);
 await db.query("INSERT INTO user_roles(user_id,tenant_id,role)VALUES($1,$5,'owner'),($2,$5,'viewer'),($3,$5,'operator'),($4,$6,'owner')",[owner,viewer,operator,foreignOwner,tenant,otherTenant]);
 await db.query("INSERT INTO integrador_bridge_bindings(id,tenant_id,approved_seller_ids,allow_enrollment,approval_note)VALUES($1,$2,ARRAY[]::text[],true,'User requested a new account only')",[bridge,tenant]);
 await db.query("INSERT INTO erp_private.integrador_enrollment_proofs(bridge_id,proof_sha256)VALUES($1,encode(sha256(convert_to($2,'UTF8')),'hex'))",[bridge,proof]);
 await db.exec('SET ROLE authenticated');
 const login=user=>db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[user]);
 const admin=async fn=>{await db.exec('RESET ROLE');try{return await fn();}finally{await db.exec('SET ROLE authenticated');}};
 const complete=({sellerId=seller,name='ELEVARE3D',accountId=null,key=next(),sourceProof=proof,bridgeId=bridge}={})=>scalar('SELECT complete_integrador_marketplace_enrollment($1,$2,$3,$4,$5,$6)',[bridgeId,sellerId,name,accountId,key,sourceProof]);
 const state=()=>admin(()=>scalar("SELECT jsonb_build_object('bindings',(SELECT jsonb_agg(to_jsonb(b)ORDER BY id)FROM integrador_bridge_bindings b),'accounts',(SELECT jsonb_agg(to_jsonb(a)ORDER BY id)FROM marketplace_accounts a),'links',(SELECT jsonb_agg(to_jsonb(l)ORDER BY account_id)FROM integrador_marketplace_account_links l),'requests',(SELECT count(*)FROM erp_private.requests),'audit',(SELECT count(*)FROM audit_log),'credentials',(SELECT count(*)FROM marketplace_credentials),'oauth',(SELECT count(*)FROM marketplace_oauth_states))"));
 async function rejects(fn,pattern){const before=await state();await assert.rejects(fn(),pattern);assert.deepEqual(await state(),before);}
 async function check(name,fn){await login(owner);await fn();passed++;console.log('PASS '+name);}
 await check('A new-account bridge exposes no old sellers, proof or fabricated connection',async()=>{
  const b=await scalar('SELECT integrador_bridge_binding()');assert.equal(b.configured,true);assert.equal(b.allow_enrollment,true);assert.deepEqual(b.approved_seller_ids,[]);assert.deepEqual(b.account_mappings,[]);assert.equal(JSON.stringify(b).includes(proof),false);
  await assert.rejects(db.query('SELECT * FROM erp_private.integrador_enrollment_proofs'),/permission denied/);
 });
 await check('A financial user alone cannot approve an account without the Source secret',async()=>{
  for(const sourceProof of ['',null,'b'.repeat(64),'a'.repeat(63)])await rejects(()=>complete({sourceProof}),/precisa ser confirmada/);
 });
 let pending;
 await check('Verified Source authorization explicitly connects the empty local ELEVARE3D record',async()=>{
  pending=await scalar("SELECT save_marketplace_account('mercado_livre','ELEVARE3D',NULL)");
  const result=await complete({accountId:pending});assert.equal(result.account_id,pending);assert.equal(result.seller_id,seller);assert.equal(result.connected,true);assert.equal(result.replayed,false);
  const b=await scalar('SELECT integrador_bridge_binding()');assert.deepEqual(b.approved_seller_ids,[seller]);assert.equal(b.account_mappings[0].account_id,pending);
  assert.equal(await scalar('SELECT name FROM marketplace_accounts WHERE id=$1',[pending]),'ELEVARE3D');assert.equal(await admin(()=>scalar('SELECT count(*)::int FROM marketplace_credentials')),0);
 });
 await check('A stable authorization attempt replays without duplicate identity, audit or command',async()=>{
  const key=next(),first=await complete({sellerId:'7770002',name:'Nova conta',key}),before=await state(),retry=await complete({sellerId:'7770002',name:'Nova conta',key});
  assert.equal(retry.account_id,first.account_id);assert.equal(retry.replayed,true);assert.deepEqual(await state(),before);
  await rejects(()=>complete({sellerId:'7770003',name:'Nova conta',key}),/outra operação/);
 });
 await check('Tenant and financial-role boundaries remain required even with a valid Source proof',async()=>{
  for(const user of [viewer,operator,foreignOwner]){await login(user);await rejects(()=>complete({sellerId:'7770003',name:'Role blocked'}),/permissão|confirmada/);}
  await login(owner);
 });
 await check('Disabling the bridge or its private proof also blocks an already known seller',async()=>{
  await admin(()=>db.query('UPDATE erp_private.integrador_enrollment_proofs SET enabled=false WHERE bridge_id=$1',[bridge]));await rejects(()=>complete({accountId:pending}),/confirmada/);
  await admin(()=>db.query('UPDATE erp_private.integrador_enrollment_proofs SET enabled=true WHERE bridge_id=$1',[bridge]));
  await admin(()=>db.query('UPDATE integrador_bridge_bindings SET enabled=false WHERE id=$1',[bridge]));await rejects(()=>complete({accountId:pending}),/confirmada/);await admin(()=>db.query('UPDATE integrador_bridge_bindings SET enabled=true WHERE id=$1',[bridge]));
 });
 await check('Native credentials and an active native authorization cannot be overwritten',async()=>{
  const native=await scalar("SELECT save_marketplace_account('mercado_livre','Native preserved',NULL)");
  await admin(()=>db.query("INSERT INTO marketplace_credentials(account_id,access_token,refresh_token,expires_at)VALUES($1,'SYNTHETIC','SYNTHETIC',now()+interval '1 hour')",[native]));
  await rejects(()=>complete({sellerId:'7770004',name:'Native preserved',accountId:native}),/autorização própria/);
  const active=await scalar("SELECT save_marketplace_account('mercado_livre','Pending native',NULL)");await admin(()=>db.query('INSERT INTO marketplace_oauth_states(account_id,user_id)VALUES($1,$2)',[active,owner]));
  await rejects(()=>complete({sellerId:'7770005',name:'Pending native',accountId:active}),/outra autorização/);
  await admin(()=>db.query("UPDATE marketplace_oauth_states SET expires_at=now()-interval '1 minute'WHERE account_id=$1",[active]));
  assert.equal((await complete({sellerId:'7770005',name:'Pending native',accountId:active})).account_id,active);
  assert.equal(await admin(()=>scalar('SELECT count(*)::int FROM marketplace_oauth_states WHERE account_id=$1',[active])),0);
 });
 await check('Unknown-seller history and foreign targets cannot be silently reassigned',async()=>{
  const history=await scalar("SELECT save_marketplace_account('mercado_livre','History preserved',NULL)");
  await admin(()=>db.query("INSERT INTO marketplace_events(tenant_id,account_id,event_key,payload)VALUES($1,$2,'imported-before-identity','{}')",[tenant,history]));
  await rejects(()=>complete({sellerId:'7770006',name:'History preserved',accountId:history}),/histórico sem vendedor/);
  const foreign=await admin(()=>scalar("INSERT INTO marketplace_accounts(tenant_id,channel,name)VALUES($1,'mercado_livre','Foreign')RETURNING id",[otherTenant]));
  await rejects(()=>complete({sellerId:'7770007',name:'Foreign',accountId:foreign}),/nesta empresa/);
 });
 await check('An identity or naming failure rolls back approval, mapping and commands atomically',async()=>{
  for(const sellerId of ['0','001','bad','1 OR 1=1'])await rejects(()=>complete({sellerId}),/Identificação/);
  await rejects(()=>complete({sellerId:'7770008',name:'ELEVARE3D'}),/duplicate key/);
  assert.equal((await scalar('SELECT approved_seller_ids FROM integrador_bridge_bindings WHERE id=$1',[bridge])).includes('7770008'),false);
 });
 await check('Source-bound accounts still reject native token and OAuth persistence after enrollment',async()=>{
  await rejects(()=>admin(()=>db.query('INSERT INTO marketplace_oauth_states(account_id,user_id)VALUES($1,$2)',[pending,owner])),/proprietário único/);
  await rejects(()=>admin(()=>db.query("INSERT INTO marketplace_credentials(account_id,access_token,refresh_token,expires_at)VALUES($1,'SYNTHETIC','SYNTHETIC',now()+interval '1 hour')",[pending])),/proprietário único/);
 });
 console.log(`Integrador enrollment: ${passed} authorization, tenant and atomicity groups passed; no production or provider access.`);
}finally{await db.close();}
