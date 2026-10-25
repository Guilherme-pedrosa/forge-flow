import { PGlite } from '@electric-sql/pglite';
import { readdir, readFile, mkdtemp, mkdir, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { processJob, resolveOfficialProfiles, readZip, validateArchive } from './forge-slicer-worker.mjs';
process.on('uncaughtException',error=>{console.error(error.message,error.where??'');process.exit(1);});

const db = new PGlite();
await db.exec(`CREATE ROLE authenticated; CREATE ROLE anon; CREATE ROLE service_role;
 CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY,email text);
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 CREATE SCHEMA storage; CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean);
 CREATE TABLE storage.objects(id uuid DEFAULT gen_random_uuid(),bucket_id text,name text,owner uuid);
 CREATE FUNCTION storage.foldername(text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$ SELECT string_to_array($1,'/') $$;
 ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY; CREATE PUBLICATION supabase_realtime;
 GRANT USAGE ON SCHEMA public,auth,storage TO authenticated,anon;
 ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO authenticated;`);
for (const name of (await readdir(new URL('../supabase/migrations/', import.meta.url))).filter(name => name.endsWith('.sql') && name <= '20261024200000_slicer_queue.sql').sort()) {
  try { await db.exec((await readFile(new URL('../supabase/migrations/' + name, import.meta.url),'utf8')).replace(/CREATE EXTENSION IF NOT EXISTS (pg_cron|pg_net);/g,'')); }
  catch (error) { throw new Error(`Migration ${name}: ${error.message}`,{cause:error}); }
}
const id = n => `83000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const owner=id(1),operator=id(2),viewer=id(3),other=id(4),tenant=id(10),foreign=id(11),profile='bambu-a1-04-pla-020-v1';
const chunkBytes=393216;
const source=Buffer.alloc(chunkBytes+10,42),hash=b=>createHash('sha256').update(b).digest('hex');
const scalar=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0];
const role=async(name='authenticated',uid=owner)=>{await db.exec('RESET ROLE'+(name==='postgres'?'':'; SET ROLE '+name)); await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[uid]);};
await db.query("INSERT INTO auth.users VALUES($1,'owner@qa.invalid'),($2,'operator@qa.invalid'),($3,'viewer@qa.invalid'),($4,'other@qa.invalid')",[owner,operator,viewer,other]);
await db.query("INSERT INTO tenants(id,name,slug) VALUES($1,'Slicer QA','slicer-qa'),($2,'Foreign','slicer-foreign')",[tenant,foreign]);
await db.query("INSERT INTO profiles(user_id,tenant_id,display_name) VALUES($1,$5,'Owner'),($2,$5,'Operator'),($3,$5,'Viewer'),($4,$6,'Other')",[owner,operator,viewer,other,tenant,foreign]);
await db.query("INSERT INTO user_roles(user_id,tenant_id,role) VALUES($1,$5,'owner'),($2,$5,'operator'),($3,$5,'viewer'),($4,$6,'owner')",[owner,operator,viewer,other,tenant,foreign]);
await role();
let nextId=100,passed=0;
const start=(bytes=source,request=id(nextId++),name='part.stl')=>scalar('SELECT start_slicer_upload($1,$2,$3,$4,$5)',[name,bytes.length,hash(bytes),profile,request]);
const upload=async(job,bytes=source)=>{for(let part=0;part<Math.ceil(bytes.length/chunkBytes);part++)await scalar('SELECT upload_slicer_chunk($1,$2,$3)',[job.id,part,bytes.subarray(part*chunkBytes,(part+1)*chunkBytes).toString('base64')]); return scalar('SELECT finish_slicer_upload($1)',[job.id]);};
const worker=await scalar("SELECT create_slicer_worker('A1 local')");
const args=[worker.worker_id,worker.worker_token];
const hello=()=>scalar('SELECT slicer_worker_hello($1,$2,$3,$4)',[...args,[profile],'02.08.02.61']);
const claim=()=>scalar('SELECT claim_slicer_job($1,$2)',args);
async function test(name,fn){await role();await fn();passed++;console.log('PASS '+name);}
await test('Worker credentials are returned once, stored only as hashes, and cannot expose ERP data',async()=>{
  assert.match(worker.worker_token,/^[0-9a-f]{64}$/);
  await assert.rejects(db.query('SELECT * FROM erp_private.slicer_workers'),/permission denied/);
  await role('postgres');
  assert.equal(await scalar('SELECT token_hash FROM erp_private.slicer_workers WHERE id=$1',[worker.worker_id]),hash(Buffer.from(worker.worker_token)));
  await role('anon','');
  await assert.rejects(db.query('SELECT * FROM customers'),/permission denied/);
  await assert.rejects(start(),/permission denied/);
  await assert.rejects(scalar('SELECT claim_slicer_job($1,$2)',[worker.worker_id,'0'.repeat(64)]),/inválida/);
  await role('authenticated',operator); await assert.rejects(scalar("SELECT create_slicer_worker('Not admin')"),/administrador/);
  await role('authenticated',viewer); await assert.rejects(start(),/permissão/);
});
let job;
await test('Bounded chunks retry exactly and SHA256 must verify before a worker can claim',async()=>{
  const request=id(nextId++);job=await start(source,request);
  assert.equal((await start(source,request)).id,job.id);
  await assert.rejects(start(Buffer.from('different'),request),/outro arquivo/);
  await hello(); assert.equal(await claim(),null);
  const first=source.subarray(0,chunkBytes).toString('base64');
  await scalar('SELECT upload_slicer_chunk($1,0,$2)',[job.id,first]);
  await scalar('SELECT upload_slicer_chunk($1,0,$2)',[job.id,first]);
  await assert.rejects(scalar('SELECT upload_slicer_chunk($1,0,$2)',[job.id,Buffer.alloc(chunkBytes,1).toString('base64')]),/outro conteúdo/);
  await assert.rejects(scalar('SELECT finish_slicer_upload($1)',[job.id]),/completo/);
  await assert.rejects(scalar('SELECT upload_slicer_chunk($1,1,$2)',[job.id,'AA==\n']),/inválido/);
  await assert.rejects(scalar('SELECT upload_slicer_chunk($1,171,$2)',[job.id,'AA==']),/inválido/);
  await upload(job);assert.equal((await scalar('SELECT slicer_job($1)',[job.id])).status,'queued');
  await role('postgres'); assert.equal(await scalar("SELECT count(*)::integer FROM erp_private.slicer_chunks WHERE job_id=$1 AND kind='source'",[job.id]),2);
});
let lease;
await test('Claims, heartbeats and file reads are isolated by worker tenant and lease',async()=>{
  await role('authenticated',other);const otherWorker=await scalar("SELECT create_slicer_worker('Foreign worker')");
  await role('anon','');await scalar('SELECT slicer_worker_hello($1,$2,$3,$4)',[otherWorker.worker_id,otherWorker.worker_token,[profile],'02.08.02.61']);
  assert.equal(await scalar('SELECT claim_slicer_job($1,$2)',[otherWorker.worker_id,otherWorker.worker_token]),null);
  lease=await claim();assert.equal(lease.id,job.id);assert.equal((await claim()).lease_id,lease.lease_id);
  await assert.rejects(scalar('SELECT slicer_worker_source($1,$2,$3,$4,0)',[otherWorker.worker_id,otherWorker.worker_token,job.id,lease.lease_id]),/atribuída/);
  assert.equal(await scalar('SELECT slicer_worker_source($1,$2,$3,$4,1)',[...args,job.id,lease.lease_id]),source.subarray(chunkBytes).toString('base64'));
  await scalar('SELECT slicer_worker_heartbeat($1,$2,$3,$4,25)',[...args,job.id,lease.lease_id]);
  await assert.rejects(scalar('SELECT finish_slicer_job($1,$2,$3,$4)',[...args,job.id,lease.lease_id]),/ainda não/);
  await role('authenticated',operator);await assert.rejects(scalar('SELECT slicer_job($1)',[job.id]),/usuário/);
  await role('authenticated',other);await assert.rejects(scalar('SELECT slicer_job($1)',[job.id]),/usuário/);
});
await test('Verified result is downloadable only by its uploader; completion retries and purges the source',async()=>{
  const result=Buffer.from('PK\x03\x04synthetic-result'),raw=Buffer.from('PK\x03\x04synthetic-raw-result');
  const stats={engine:'Bambu Studio',engine_version:'02.08.02.61',profile_id:profile,time_seconds:100,weight_grams:2.1,input_sha256:hash(source),output_sha256:hash(result),raw_output_size:raw.length,raw_output_sha256:hash(raw),normalizations:['bambu_compatible_printers_xml_escape_v1','bambu_print_extruder_variant_xml_escape_v1']};
  await role('anon','');
  await assert.rejects(scalar('SELECT slicer_worker_result($1,$2,$3,$4,$5,$6,$7)',[...args,job.id,lease.lease_id,result.length,hash(result),JSON.stringify({...stats,weight_grams:0})]),/inválido/);
  await scalar('SELECT slicer_worker_result($1,$2,$3,$4,$5,$6,$7)',[...args,job.id,lease.lease_id,result.length,hash(result),JSON.stringify(stats)]);
  await assert.rejects(scalar('SELECT slicer_worker_result($1,$2,$3,$4,$5,$6,$7)',[...args,job.id,lease.lease_id,result.length,hash(result),JSON.stringify({...stats,time_seconds:101})]),/outro conteúdo/);
  await scalar('SELECT reset_slicer_result($1,$2,$3,$4)',[...args,job.id,lease.lease_id]);
  await scalar('SELECT slicer_worker_result($1,$2,$3,$4,$5,$6,$7)',[...args,job.id,lease.lease_id,result.length,hash(result),JSON.stringify(stats)]);
  await scalar('SELECT slicer_worker_result_chunk($1,$2,$3,$4,0,$5)',[...args,job.id,lease.lease_id,result.toString('base64')]);
  await assert.rejects(scalar('SELECT finish_slicer_job($1,$2,$3,$4)',[...args,job.id,lease.lease_id]),/completo/);
  await scalar('SELECT slicer_worker_raw_chunk($1,$2,$3,$4,0,$5)',[...args,job.id,lease.lease_id,raw.toString('base64')]);
  const completed=await scalar('SELECT finish_slicer_job($1,$2,$3,$4)',[...args,job.id,lease.lease_id]);
  assert.equal(completed.status,'done');assert.equal(completed.result_available,true);
  assert.equal((await scalar('SELECT finish_slicer_job($1,$2,$3,$4)',[...args,job.id,lease.lease_id])).id,job.id);
  await role();assert.equal(await scalar('SELECT slicer_result_chunk($1,0)',[job.id]),result.toString('base64'));
  assert.equal(await scalar('SELECT slicer_result_chunk($1,0,true)',[job.id]),raw.toString('base64'));
  await assert.rejects(scalar('SELECT reset_slicer_result($1,$2,$3,$4)',[...args,job.id,lease.lease_id]),/atribuída/);
  await role('authenticated',viewer);await assert.rejects(scalar('SELECT slicer_result_chunk($1,0)',[job.id]),/usuário/);
  await role('postgres');assert.equal(await scalar("SELECT count(*)::integer FROM erp_private.slicer_chunks WHERE job_id=$1 AND kind='source'",[job.id]),0);
});
await test('A corrupted source never queues; three active jobs limit uploads and cancellation frees capacity',async()=>{
  const corrupt=await scalar('SELECT start_slicer_upload($1,$2,$3,$4,$5)',['bad.stl',3,hash(Buffer.from('abc')),profile,id(nextId++)]);
  await scalar('SELECT upload_slicer_chunk($1,0,$2)',[corrupt.id,Buffer.from('xyz').toString('base64')]);
  await assert.rejects(scalar('SELECT finish_slicer_upload($1)',[corrupt.id]),/hash/);
  const two=await start(Buffer.from('2'));await start(Buffer.from('3'));await assert.rejects(start(Buffer.from('4')),/três/);
  await scalar('SELECT cancel_slicer_job($1)',[corrupt.id]);await scalar('SELECT cancel_slicer_job($1)',[corrupt.id]);
  await start(Buffer.from('4'));
  await scalar('SELECT cancel_slicer_job($1)',[two.id]);
  await assert.rejects(scalar('SELECT start_slicer_upload($1,67108865,$2,$3,$4)',['big.stl','a'.repeat(64),profile,id(nextId++)]),/64 MB/);
  await assert.rejects(start(Buffer.from('x'),id(nextId++),'../bad.stl'),/64 MB/);
});
await test('Expired leases get one retry and stale workers cannot complete; payload expires after 48 hours',async()=>{
  await role('postgres');await db.exec("UPDATE erp_private.slicer_jobs SET status='cancelled' WHERE status IN ('uploading','queued')");
  await role();const retryBytes=Buffer.from('retry');const retry=await upload(await start(retryBytes),retryBytes);
  await role('anon','');const first=await claim();assert.equal(first.id,retry.id);
  await role('postgres');await db.query("UPDATE erp_private.slicer_jobs SET leased_until=now()-interval '1 second' WHERE id=$1",[retry.id]);
  await role('anon','');const second=await claim();assert.notEqual(first.lease_id,second.lease_id);
  await assert.rejects(scalar('SELECT slicer_worker_source($1,$2,$3,$4,0)',[...args,retry.id,first.lease_id]),/atribuída/);
  await role('postgres');await db.query("UPDATE erp_private.slicer_jobs SET leased_until=now()-interval '1 second' WHERE id=$1",[retry.id]);
  await role();assert.equal((await scalar('SELECT slicer_job($1)',[retry.id])).status,'failed');
  await role('postgres');await db.query("UPDATE erp_private.slicer_jobs SET created_at=now()-interval '49 hours' WHERE id=$1",[job.id]);
  await role();assert.equal((await scalar('SELECT slicer_job($1)',[job.id])).result_available,false);
  await role('postgres');assert.equal(await scalar('SELECT count(*)::integer FROM erp_private.slicer_chunks'),0);
  assert.equal(await scalar('SELECT source_sha256 FROM erp_private.slicer_jobs WHERE id=$1',[job.id]),hash(source));
  assert.equal(await scalar('SELECT count(*)::integer FROM orders'),0);assert.equal(await scalar('SELECT count(*)::integer FROM jobs'),0);
});
console.log(`Slicer queue: ${passed} private transfer/lease/integrity scenarios passed.`);
if(process.env.FORGE_TEST_BAMBU_ENGINE){
  await role('postgres');await db.exec("UPDATE erp_private.slicer_jobs SET status='cancelled' WHERE status IN ('uploading','queued','running')");
  const temp=await mkdtemp(path.join(os.tmpdir(),'forge-real-slicer-proof-')),profiles=path.join(temp,'profiles'),jobsDir=path.join(temp,'jobs');
  try{
    await mkdir(jobsDir);
    const profileHashes=await resolveOfficialProfiles(process.env.FORGE_TEST_BAMBU_ENGINE,profiles);
    const vertices=[[0,0,0],[20,0,0],[20,20,0],[0,20,0],[0,0,20],[20,0,20],[20,20,20],[0,20,20]],faces=[[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[1,2,6],[1,6,5],[2,3,7],[2,7,6],[3,0,4],[3,4,7]];
    const cube=Buffer.from(['solid synthetic_cube',...faces.flatMap(face=>['facet normal 0 0 0','outer loop',...face.map(i=>'vertex '+vertices[i].join(' ')),'endloop','endfacet']),'endsolid synthetic_cube'].join('\n'));
    await role();const uploaded=await upload(await start(cube,id(nextId++),'synthetic-cube.stl'),cube);
    await role('anon','');await hello();const task=await claim();assert.equal(task.id,uploaded.id);
    const signatures={slicer_worker_hello:['p_worker','p_token','p_profiles','p_engine_version'],slicer_worker_heartbeat:['p_worker','p_token','p_job','p_lease','p_progress'],slicer_worker_source:['p_worker','p_token','p_job','p_lease','p_part'],
      slicer_worker_result:['p_worker','p_token','p_job','p_lease','p_size','p_sha256','p_stats'],slicer_worker_result_chunk:['p_worker','p_token','p_job','p_lease','p_part','p_base64'],
      slicer_worker_raw_chunk:['p_worker','p_token','p_job','p_lease','p_part','p_base64'],finish_slicer_job:['p_worker','p_token','p_job','p_lease'],reset_slicer_result:['p_worker','p_token','p_job','p_lease']};
    const rpc=(name,body)=>{const keys=signatures[name];assert.ok(keys);const values={p_worker:worker.worker_id,p_token:worker.worker_token,...body};return scalar('SELECT '+name+'('+keys.map((_,i)=>'$'+(i+1)).join(',')+')',keys.map(k=>k==='p_stats'?JSON.stringify(values[k]):values[k]));};
    const completed=await processJob({jobs_dir:jobsDir,engine_path:process.env.FORGE_TEST_BAMBU_ENGINE,profile_dir:profiles,profile_hashes:profileHashes},rpc,task);
    assert.equal(completed.status,'done');assert.ok(completed.stats.weight_grams>0);assert.ok(completed.stats.time_seconds>0);
    await role();const output=Buffer.concat(await Promise.all(Array.from({length:completed.result_chunks},async(_,part)=>Buffer.from(await scalar('SELECT slicer_result_chunk($1,$2)',[task.id,part]),'base64'))));
    assert.equal(hash(output),completed.result_sha256);validateArchive(readZip(output));
    console.log('PASS REAL ENGINE → PRIVATE QUEUE → WORKER → VALIDATED 3MF DOWNLOAD: '+JSON.stringify({engine_version:completed.stats.engine_version,time_seconds:completed.stats.time_seconds,weight_grams:completed.stats.weight_grams,normalizations:completed.stats.normalizations,input_sha256:completed.source_sha256,output_sha256:completed.result_sha256}));
  }finally{await rm(temp,{recursive:true,force:true});}
}
await db.close();
