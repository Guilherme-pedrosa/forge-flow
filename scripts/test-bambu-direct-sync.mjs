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
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const uid=id(1),otherUid=id(2),viewerUid=id(3),tenant=id(10),otherTenant=id(11),connection=id(30),otherConnection=id(31),device=id(40),otherDevice=id(41),job=id(50);
const fakeToken='TEST-ONLY-DO-NOT-EXPOSE';
await db.query("INSERT INTO auth.users VALUES($1,'owner@test.invalid'),($2,'other@test.invalid'),($3,'viewer@test.invalid')",[uid,otherUid,viewerUid]);
await db.query("INSERT INTO tenants(id,name,slug) VALUES($1,'Sync tenant','sync-tenant'),($2,'Other tenant','other-sync-tenant')",[tenant,otherTenant]);
await db.query("INSERT INTO profiles(user_id,tenant_id,display_name) VALUES($1,$4,'Owner'),($2,$5,'Other'),($3,$4,'Viewer')",[uid,otherUid,viewerUid,tenant,otherTenant]);
await db.query("INSERT INTO user_roles(user_id,tenant_id,role) VALUES($1,$4,'owner'),($2,$5,'owner'),($3,$4,'viewer')",[uid,otherUid,viewerUid,tenant,otherTenant]);
await db.query("INSERT INTO bambu_connections(id,tenant_id,access_token_encrypted) VALUES($1,$3,$5),($2,$4,$5)",[connection,otherConnection,tenant,otherTenant,fakeToken]);
await db.query("INSERT INTO bambu_devices(id,tenant_id,connection_id,dev_id) VALUES($1,$3,$5,'DEVICE-LOCAL'),($2,$4,$6,'DEVICE-OTHER')",[device,otherDevice,tenant,otherTenant,connection,otherConnection]);
await db.query("INSERT INTO jobs(id,tenant_id,code,name) VALUES($1,$2,'SYNC-TEST','Protected ERP job')",[job,tenant]);
await db.exec('SET ROLE authenticated');
await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[uid]);
const scalar=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0];
const row=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
const rejects=(sql,args,regex)=>assert.rejects(db.query(sql,args),regex);
async function owner(fn){await db.exec('RESET ROLE');try{return await fn();}finally{await db.exec('SET ROLE authenticated');}}
const sync=()=>scalar('SELECT request_bambu_sync()');
const state=()=>row('SELECT * FROM bambu_sync_state WHERE bambu_device_id=$1',[device]);
const makeDue=()=>owner(()=>db.query("UPDATE erp_private.bambu_sync_queue SET last_attempt_at=now()-interval '6 minutes',next_attempt_at=now() WHERE bambu_device_id=$1",[device]));
async function response(body,status=200){
  return owner(async()=>{
    const request=await scalar('SELECT request_id FROM erp_private.bambu_sync_queue WHERE bambu_device_id=$1',[device]);
    assert.ok(request);
    await db.query('INSERT INTO net._http_response(id,status_code,content) VALUES($1,$2,$3)',[request,status,typeof body==='string'?body:JSON.stringify(body)]);
    return scalar('SELECT erp_private.bambu_sync_process($1)',[tenant]);
  });
}
let passed=0;
async function test(name,fn){await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[uid]);await fn();passed++;console.log('PASS '+name);}

try {
  await test('Enqueue is tenant-scoped, uses constant origin and never exposes token or queue headers',async()=>{
    const result=await sync();
    assert.equal(result.status,'queued');assert.equal(result.queued,1);assert.equal(result.devices,1);
    const safe=await state(); assert.equal(safe.status,'syncing');assert.ok(!JSON.stringify(safe).includes(fakeToken));
    await rejects('SELECT * FROM net.http_request_queue',[],/permission denied/);
    await rejects('SELECT * FROM net._http_response',[],/permission denied/);
    await rejects('SELECT * FROM erp_private.bambu_sync_queue',[],/permission denied/);
    await rejects("UPDATE bambu_sync_state SET status='success' WHERE bambu_device_id=$1",[device],/permission denied/);
    await owner(async()=>{
      const request=await row('SELECT url,params,timeout_milliseconds FROM net.http_request_queue');
      assert.equal(request.url,'https://api.bambulab.com/v1/user-service/my/tasks');
      assert.deepEqual(request.params,{deviceId:'DEVICE-LOCAL',limit:500});assert.equal(request.timeout_milliseconds,15000);
      assert.equal(await scalar('SELECT count(*)::integer FROM erp_private.bambu_sync_queue'),1);
    });
  });
  await test('Repeated manual sync does not add an in-flight request or bypass cooldown',async()=>{
    assert.equal((await sync()).status,'syncing');
    assert.equal(await owner(()=>scalar('SELECT count(*)::integer FROM net.http_request_queue')),1);
    assert.equal(await response({hits:[{id:123,status:0,title:'Original title',startTime:'2026-09-13T10:00:00Z'}]}),1);
    assert.equal((await sync()).status,'cooldown');
    assert.equal(await owner(()=>scalar('SELECT count(*)::integer FROM net.http_request_queue')),0);
  });
  await test('Existing history updates to final measured values while preserving the ERP job link',async()=>{
    await owner(()=>db.query("UPDATE bambu_tasks SET job_id=$1 WHERE tenant_id=$2 AND bambu_task_id='123'",[job,tenant]));
    await makeDue();await sync();
    await response({hits:[{id:123,status:2,title:'Completed title',weight:23.5,costTime:7200,startTime:'2026-09-13T10:00:00Z',endTime:'2026-09-13T12:00:00Z'}]});
    const task=await row("SELECT job_id,status,weight_grams,cost_time_seconds,end_time FROM bambu_tasks WHERE tenant_id=$1 AND bambu_task_id='123'",[tenant]);
    assert.equal(task.job_id,job);assert.equal(task.status,'2');assert.equal(Number(task.weight_grams),23.5);assert.equal(task.cost_time_seconds,7200);assert.ok(task.end_time);
    assert.equal(await scalar("SELECT count(*)::integer FROM bambu_tasks WHERE tenant_id=$1 AND bambu_task_id='123'",[tenant]),1);
    assert.equal((await state()).status,'success');
  });
  await test('A malformed later task rolls back every upsert and exposes only a sanitized error',async()=>{
    await makeDue();await sync();
    await response({hits:[{id:123,title:'Must roll back',status:3},{title:fakeToken}]});
    assert.equal(await scalar("SELECT design_title FROM bambu_tasks WHERE tenant_id=$1 AND bambu_task_id='123'",[tenant]),'Completed title');
    const safe=await state();assert.equal(safe.status,'error');assert.equal(safe.last_error_code,'invalid_data');assert.ok(!JSON.stringify(safe).includes(fakeToken));assert.ok(safe.last_success_at);
    assert.equal((await sync()).status,'cooldown');
  });
  await test('Authorization and HTTP errors retain last success and discard remote response text',async()=>{
    await makeDue();await sync();await response({error:fakeToken},401);
    let safe=await state();assert.equal(safe.last_error_code,'auth_required');assert.equal(safe.http_status,401);assert.ok(safe.last_success_at);assert.ok(!JSON.stringify(safe).includes(fakeToken));
    await makeDue();await sync();await response(fakeToken,429);
    safe=await state();assert.equal(safe.last_error_code,'rate_limited');assert.equal(safe.http_status,429);assert.ok(!JSON.stringify(safe).includes(fakeToken));
  });
  await test('Reconnection clears auth backoff but cannot bypass the five-minute minimum',async()=>{
    await makeDue();await sync();await response({error:'Expired test token'},401);
    assert.equal((await state()).last_error_code,'auth_required');
    const queuedBefore=await owner(()=>scalar('SELECT count(*)::integer FROM net.http_request_queue'));
    await owner(()=>db.query('UPDATE bambu_connections SET access_token_encrypted=$1 WHERE id=$2',[fakeToken+'-renewed',connection]));
    let result=await sync();
    assert.equal(result.status,'cooldown');assert.equal(result.queued,0);
    assert.equal(await owner(()=>scalar('SELECT count(*)::integer FROM net.http_request_queue')),queuedBefore);
    assert.equal((await state()).last_error_code,null);
    await makeDue();await sync();await response({error:'Second expired test token'},401);
    // Do not force next_attempt_at: the seed itself must release the old hour.
    await owner(()=>db.query("UPDATE erp_private.bambu_sync_queue SET last_attempt_at=now()-interval '6 minutes' WHERE bambu_device_id=$1",[device]));
    await owner(()=>db.query('UPDATE bambu_connections SET access_token_encrypted=$1 WHERE id=$2',[fakeToken+'-renewed-again',connection]));
    result=await sync();assert.equal(result.status,'queued');assert.equal(result.queued,1);
    await response({hits:[]});assert.equal((await state()).status,'success');
  });
  await test('Missing pg_net response expires and retries without creating duplicate in-flight work',async()=>{
    await makeDue();await sync();
    await owner(async()=>{
      await db.query("UPDATE erp_private.bambu_sync_queue SET dispatched_at=now()-interval '3 minutes' WHERE bambu_device_id=$1",[device]);
      await scalar('SELECT erp_private.bambu_sync_process($1)',[tenant]);
      assert.equal(await scalar('SELECT request_id FROM erp_private.bambu_sync_queue WHERE bambu_device_id=$1',[device]),null);
      assert.equal(await scalar('SELECT count(*)::integer FROM net.http_request_queue'),0);
    });
    assert.equal((await state()).last_error_code,'network_error');
    await makeDue();assert.equal((await sync()).queued,1);assert.equal((await sync()).queued,0);
    await response({hits:[]});
  });
  await test('A full 500-task response is imported and explicitly flags possible history truncation',async()=>{
    await makeDue();await sync();
    const hits=Array.from({length:500},(_,index)=>({id:`batch-${index}`,status:2,weight:1,costTime:60}));
    await response({hits});
    const safe=await state();assert.equal(safe.status,'success');assert.equal(safe.tasks_received,500);assert.equal(safe.history_may_be_truncated,true);
    assert.equal(await scalar("SELECT count(*)::integer FROM bambu_tasks WHERE tenant_id=$1 AND bambu_task_id LIKE 'batch-%'",[tenant]),500);
  });
  const windowHits=Array.from({length:20},(_,index)=>({id:`window-${index}`,status:2,weight:1,costTime:60}));
  await test('Twenty returned tasks with total 120 explicitly indicate a partial history window',async()=>{
    await makeDue();await sync();await response({hits:windowHits,total:120});
    const safe=await state();assert.equal(safe.status,'success');assert.equal(safe.tasks_received,20);assert.equal(safe.history_may_be_truncated,true);
  });
  await test('Twenty returned tasks with total 20 clear the partial-window indication',async()=>{
    await makeDue();await sync();await response({hits:windowHits,total:20});
    const safe=await state();assert.equal(safe.status,'success');assert.equal(safe.tasks_received,20);assert.equal(safe.history_may_be_truncated,false);
  });
  await test('Missing or invalid totals remain indeterminate even for an empty response',async()=>{
    for(const body of [{hits:windowHits},{hits:windowHits,total:'20'},{hits:windowHits,total:20.5},{hits:windowHits,total:10},{hits:[]}]) {
      await makeDue();await sync();await response(body);
      const safe=await state();assert.equal(safe.status,'success');assert.equal(safe.history_may_be_truncated,true);
    }
    await makeDue();await sync();await response({hits:[],total:0});assert.equal((await state()).history_may_be_truncated,false);
    await rejects('SELECT erp_private.bambu_history_may_be_truncated(\'{"total":20}\'::jsonb,20)',[],/permission denied/);
  });
  await test('Disconnect discards pending response and other tenants/viewers cannot mutate this queue',async()=>{
    await makeDue();await sync();
    await owner(()=>db.query('UPDATE bambu_connections SET is_active=false WHERE id=$1',[connection]));
    await response({hits:[{id:'must-not-import',status:2}]});
    assert.equal((await state()).status,'disabled');assert.equal((await sync()).status,'unavailable');
    assert.equal(await scalar("SELECT count(*)::integer FROM bambu_tasks WHERE bambu_task_id='must-not-import'"),0);
    await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[otherUid]);
    assert.equal(await scalar('SELECT count(*)::integer FROM bambu_sync_state'),0);
    assert.equal((await sync()).devices,1);
    assert.equal(await scalar('SELECT count(*)::integer FROM bambu_sync_state WHERE bambu_device_id=$1',[device]),0);
    await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[viewerUid]);
    await rejects('SELECT request_bambu_sync()',[],/permissão/);
    await db.exec('SET ROLE anon');
    await rejects('SELECT request_bambu_sync()',[],/permission denied/);
    await db.exec('SET ROLE authenticated');
  });
  console.log(`Validated ${passed} isolated Bambu direct-sync scenarios; no network calls.`);
} finally { await db.close(); }
