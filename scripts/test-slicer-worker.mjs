import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { API_ORIGIN, PROFILE, ENGINE_VERSION, CHUNK_BYTES, sha256, readZip, writeZip, parseXml, normalizeOutput, validateArchive, readMetrics, runSimulation, processJob, createRpc, safeRemoveJob } from './forge-slicer-worker.mjs';

const root = await mkdtemp(path.join(os.tmpdir(), 'forge-slicer-test-'));
let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log('PASS ' + name); }
const member = (name, text) => ({ name, data: Buffer.from(text) });
const geometry = '<model xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources/></model>';
const validConfig = '<config><object id="1"><metadata key="name" value="Part"/></object></config>';
const buggyConfig = '<config><object id="1"><metadata key="compatible_printers" value=""Bambu Lab A1 0.4 nozzle""/><metadata key="print_extruder_variant" value=""Direct Drive Standard""/></object></config>';
const info = '<config><header><header_item key="X-BBL-Client-Version" value="02.08.02.61"/></header><plate><metadata key="index" value="1"/><metadata key="prediction" value="100"/><metadata key="weight" value="2.1"/><metadata key="nozzle_diameters" value="0.4"/><filament id="1" type="PLA" color="#00AE42" used_g="2.1" used_m="0.7"/></plate></config>';
const archive = (config = buggyConfig, extra = []) => writeZip([member('3D/3dmodel.model', geometry), member('Metadata/model_settings.config', config), member('Metadata/slice_info.config', info), member('Metadata/plate_1.gcode', '; official toolpaths\nG1 X20 E0.02'), ...extra]);
const report = { return_code: 0, sliced_plates: [{ id: 1, total_predication: 100.25, filaments: [{ total_used_g: 2.1001 }] }] };
const officialArgs = [['Bambu Lab A1 0.4 nozzle'], ['Direct Drive Standard']];

try {
  await test('ZIP guards reject traversal, duplicate paths, corruption, symlinks and encrypted members', async () => {
    assert.equal(readZip(archive()).length, 4);
    for (const badName of ['../escape', 'C:/escape', '\\server\\escape', '/root', 'a/../escape']) assert.throws(() => readZip(writeZip([member(badName, 'x')])), /Caminho/);
    assert.throws(() => readZip(writeZip([member('a', 'x'), member('A', 'x')])), /duplicado/);
    const encrypted = Buffer.from(archive()); encrypted.writeUInt16LE(0x801, encrypted.indexOf(Buffer.from([0x50,0x4b,0x01,0x02])) + 8);
    assert.throws(() => readZip(encrypted), /suportado/);
    const link = Buffer.from(archive()); link.writeUInt32LE((0xa1ff << 16) >>> 0, link.indexOf(Buffer.from([0x50,0x4b,0x01,0x02])) + 38);
    assert.throws(() => readZip(link), /suportado/);
    const corrupt = Buffer.from(archive()); corrupt[60] ^= 128;
    assert.throws(() => readZip(corrupt), /inválid|Integridade/);
  });
  await test('Only the two exact official output attributes normalize; geometry and G-code retain byte hashes', async () => {
    const raw = archive(), before = sha256(raw), normalized = normalizeOutput(raw, ...officialArgs);
    assert.equal(sha256(raw), before); assert.notEqual(sha256(normalized.output), before);
    assert.deepEqual(normalized.normalizations, ['bambu_compatible_printers_xml_escape_v1', 'bambu_print_extruder_variant_xml_escape_v1']);
    for (const original of readZip(raw).filter(e => /\.(model|gcode)$/.test(e.name))) assert.equal(sha256(normalized.entries.find(e => e.name === original.name).data), sha256(original.data));
    assert.equal(JSON.parse(normalized.entries.find(e => e.name.endsWith('forge_slicer_normalization.json')).data).raw_output_sha256, before);
    assert.throws(() => normalizeOutput(raw, ['Other machine'], officialArgs[1]), /perfil oficial/);
    assert.throws(() => normalizeOutput(archive(buggyConfig.replace('Direct Drive Standard', 'Arbitrary')), ...officialArgs), /XML inválido/);
    const clean = archive(validConfig); assert.deepEqual(normalizeOutput(clean, ...officialArgs).normalizations, []);
    assert.equal(sha256(normalizeOutput(clean, ...officialArgs).output), sha256(clean));
  });
  await test('User imports are never repaired and cannot load DTDs, external relationships or post-processing scripts', async () => {
    assert.throws(() => validateArchive(readZip(archive()), true), /XML inválido/);
    assert.throws(() => parseXml(Buffer.from('<!DOCTYPE model [<!ENTITY x "boom">]><model>&x;</model>')), /DTD/);
    assert.throws(() => parseXml(Buffer.from('<component xmlns:p="urn:production" xmlns:other="urn:other" p:path="file:///private.model" other:path="/3D/safe.model"/>')), /externa/);
    const unsafe = [member('_rels/.rels', '<Relationships><Relationship TargetMode="External" Target="https://invalid.test/file"/></Relationships>'),
      member('Metadata/project_settings.config', '{"nested":{"post_process":["run.exe"]}}'),
      member('Metadata/Slic3r_PE.config', 'post_process = run.exe'), member('Metadata/x.config', '<config><metadata key="post_process" value="run.exe"/></config>')];
    for (const entry of unsafe) assert.throws(() => validateArchive(readZip(archive(validConfig, [entry])), true), /externa|Script|scripts/);
    validateArchive(readZip(archive(validConfig, [member('Metadata/project_settings.config', '{"post_process":[]}')])), true);
  });
  await test('Metrics require native slice_info and agreeing JSON results; no geometric weight fallback exists', async () => {
    const entries = normalizeOutput(archive(), ...officialArgs).entries, metrics = readMetrics(entries, report);
    assert.equal(metrics.time_seconds, 100); assert.equal(metrics.weight_grams, 2.1); assert.equal(metrics.plates[0].filaments[0].length_meters, 0.7);
    assert.throws(() => readMetrics(entries.filter(e => !e.name.includes('slice_info')), report), /tempos e consumo/);
    assert.throws(() => readMetrics(entries, { ...report, sliced_plates: [{ ...report.sliced_plates[0], total_predication: 900 }] }), /não conferem/);
  });
  const profileDir = path.join(root, 'profiles'); await mkdir(profileDir);
  const hashes = {};
  for (const kind of ['machine', 'process', 'filament']) {
    const bytes = Buffer.from(JSON.stringify(kind === 'process' ? { compatible_printers: officialArgs[0], print_extruder_variant: officialArgs[1] } : {}));
    await writeFile(path.join(profileDir, kind + '.json'), bytes); hashes[kind] = sha256(bytes);
  }
  await test('Native execution uses fixed arguments, isolated data, no shell, hidden window and verified official profiles', async () => {
    let invoked = false;
    const workspace = path.join(root, 'sandbox');
    const result = await runSimulation({ enginePath: '/official/bambu-studio.exe', profileDir, profileHashes: hashes, source: Buffer.from('solid test'), extension: 'stl', workspace,
      spawnProcess(exe, args, options) {
        invoked = true; assert.equal(exe, '/official/bambu-studio.exe'); assert.equal(options.shell, false); assert.equal(options.windowsHide, true);
        assert.equal(options.env.APPDATA, path.join(workspace, 'isolated-data')); assert.equal(options.cwd, workspace);
        assert.equal(args.at(-1), path.join(workspace, 'source.stl')); assert.deepEqual(args.slice(args.indexOf('--orient'), args.indexOf('--orient') + 2), ['--orient', '1']);
        assert.ok(!args.some(arg => /--(?:send|print|connect|upload)/.test(arg)));
        const child = new EventEmitter(); child.kill = () => {};
        void Promise.all([writeFile(path.join(workspace, 'output', 'simulation.3mf'), archive()), writeFile(path.join(workspace, 'output', 'result.json'), JSON.stringify(report))]).then(() => child.emit('exit', 0));
        return child;
      } });
    assert.equal(invoked, true); assert.equal(result.stats.input_sha256, sha256(Buffer.from('solid test'))); assert.equal(result.stats.estimates_only, true);
    await assert.rejects(runSimulation({ enginePath: '/official', profileDir, profileHashes: { ...hashes, machine: 'wrong' }, source: Buffer.from('x'), extension: 'stl', workspace: path.join(root, 'tamper') }), /perfil.*alterado/);
    let killed = false;
    await assert.rejects(runSimulation({ enginePath: '/official', profileDir, profileHashes: hashes, source: Buffer.from('x'), extension: 'stl', workspace: path.join(root, 'timeout'), timeoutMs: 15,
      spawnProcess() { const child = new EventEmitter(); child.kill = () => { killed = true; }; return child; } }), /dez minutos/);
    assert.equal(killed, true);
  });
  await test('Worker RPC has fixed origin, no ERP operations and sends the scoped secret only in the request body', async () => {
    const config = { api_origin: API_ORIGIN, worker_id: '83000000-0000-4000-8000-000000000001', worker_token: 'a'.repeat(64), public_key: 'public-test-key-not-secret' };
    assert.throws(() => createRpc({ ...config, api_origin: 'https://other.test' }), /conexão inválido/);
    const rpc = createRpc(config, async (url, options) => {
      assert.equal(url, API_ORIGIN + '/rest/v1/rpc/claim_slicer_job'); assert.ok(!url.includes(config.worker_token));
      const body = JSON.parse(options.body); assert.equal(body.p_token, config.worker_token); assert.equal(body.p_worker, config.worker_id);
      assert.equal(options.headers.Authorization, undefined); return new Response('null', { status: 200 });
    });
    assert.equal(await rpc('claim_slicer_job'), null); await assert.rejects(rpc('customers'), /não autorizada/);
  });
  await test('Worker verifies input SHA, uploads bounded result/raw chunks, finishes and removes only its own private directory', async () => {
    const jobs = path.join(root, 'jobs'); await mkdir(jobs);
    const id = '83000000-0000-4000-8000-000000000100', lease = '83000000-0000-4000-8000-000000000101';
    const source = Buffer.alloc(CHUNK_BYTES + 4, 42), output = archive(validConfig), raw = archive(), calls = [];
    const job = { id, lease_id: lease, profile_id: PROFILE, extension: 'stl', source_size: source.length, source_chunks: 2, source_sha256: sha256(source) };
    const config = { jobs_dir: jobs, engine_path: '/official', profile_dir: profileDir, profile_hashes: hashes };
    const rpc = async (name, body) => {
      calls.push(name); if (name === 'slicer_worker_hello') return;
      assert.equal(body.p_job, id); assert.equal(body.p_lease, lease);
      if (name === 'slicer_worker_source') return source.subarray(body.p_part * CHUNK_BYTES, (body.p_part + 1) * CHUNK_BYTES).toString('base64');
      if (body.p_base64) assert.ok(body.p_base64.length <= 524288);
      if (name === 'finish_slicer_job') return { status: 'done' };
    };
    const simulate = async args => { assert.equal(sha256(args.source), sha256(source)); await mkdir(args.workspace); return { raw, output, stats: { output_sha256: sha256(output), normalizations: ['test'] } }; };
    assert.equal((await processJob(config, rpc, job, { simulate })).status, 'done');
    assert.ok(calls.includes('slicer_worker_raw_chunk')); assert.ok(calls.includes('slicer_worker_result_chunk'));
    await assert.rejects(readFile(path.join(jobs, id, 'source.stl')), /ENOENT/);
    await assert.rejects(processJob(config, rpc, { ...job, source_sha256: '0'.repeat(64) }, { simulate }), /hash/);
    const outside = path.join(root, 'outside'); await mkdir(outside); await writeFile(path.join(outside, 'keep'), 'keep');
    await symlink(outside, path.join(jobs, id), process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(safeRemoveJob(jobs, path.join(jobs, id)), /fora da área/);
    assert.equal(await readFile(path.join(outside, 'keep'), 'utf8'), 'keep');
    await rm(path.join(jobs, id));
    const alias = path.join(root, 'trusted-root-alias');
    await symlink(jobs, alias, process.platform === 'win32' ? 'junction' : 'dir');
    await mkdir(path.join(jobs, id)); await writeFile(path.join(jobs, id, 'temporary'), 'simulation');
    await safeRemoveJob(alias, path.join(alias, id));
    await assert.rejects(readFile(path.join(jobs, id, 'temporary')), /ENOENT/);
    await rm(alias);
  });
  console.log(`Slicer worker: ${passed} sandbox/integrity/real-metrics scenarios passed.`);
} finally { await rm(root, { recursive: true, force: true }); }
