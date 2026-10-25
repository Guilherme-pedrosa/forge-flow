import { readFile, writeFile, mkdir, rm, realpath, open } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { inflateRawSync, deflateRawSync } from 'node:zlib';
import { StringDecoder } from 'node:string_decoder';
import { SaxesParser } from 'saxes';

export const PROFILE = 'bambu-a1-04-pla-020-v1';
export const ENGINE_VERSION = '02.08.02.61';
export const API_ORIGIN = 'https://gaomleftwxpzjivrnzjk.supabase.co';
export const CHUNK_BYTES = 393216; // Encoded request payload is at most 512 KiB.
export const MAX_FILE_BYTES = 64 * 1024 * 1024;
const MAX_EXPANDED = 512 * 1024 * 1024, MAX_MEMBER = 128 * 1024 * 1024;
const COMPATIBLE_NORMALIZATION = 'bambu_compatible_printers_xml_escape_v1';
const EXTRUDER_NORMALIZATION = 'bambu_print_extruder_variant_xml_escape_v1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = message => { throw new Error(message); };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
export function verificationCube() {
  const vertices = [[0,0,0],[20,0,0],[20,20,0],[0,20,0],[0,0,20],[20,0,20],[20,20,20],[0,20,20]];
  const faces = [[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[1,2,6],[1,6,5],[2,3,7],[2,7,6],[3,0,4],[3,4,7]];
  return Buffer.from(['solid forge_verification_cube', ...faces.flatMap(face => ['facet normal 0 0 0', 'outer loop', ...face.map(i => 'vertex ' + vertices[i].join(' ')), 'endloop', 'endfacet']), 'endsolid forge_verification_cube'].join('\n'));
}
const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n; for (let i = 0; i < 8; i++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0;
});
const crc32 = bytes => { let c = 0xffffffff; for (const b of bytes) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

// This deliberately supports only the ordinary bounded ZIP format emitted by Bambu Studio.
export function readZip(bytes) {
  if (bytes.length > MAX_FILE_BYTES || bytes.length < 22) fail('Arquivo 3MF fora do limite.');
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (bytes.readUInt32LE(i) === 0x06054b50 && i + 22 + bytes.readUInt16LE(i + 20) === bytes.length) { end = i; break; }
  }
  if (end < 0 || bytes.readUInt16LE(end + 4) || bytes.readUInt16LE(end + 6)) fail('ZIP multipartes não permitido.');
  const count = bytes.readUInt16LE(end + 10), offset = bytes.readUInt32LE(end + 16), size = bytes.readUInt32LE(end + 12);
  if (!count || count > 4096 || bytes.readUInt16LE(end + 8) !== count || offset + size !== end) fail('Estrutura ZIP inválida ou muito grande.');
  const entries = [], names = new Set(), ranges = []; let cursor = offset, expanded = 0;
  for (let n = 0; n < count; n++) {
    if (cursor + 46 > end || bytes.readUInt32LE(cursor) !== 0x02014b50) fail('Diretório ZIP inválido.');
    const flags = bytes.readUInt16LE(cursor + 8), method = bytes.readUInt16LE(cursor + 10);
    const crc = bytes.readUInt32LE(cursor + 16), packedSize = bytes.readUInt32LE(cursor + 20), plainSize = bytes.readUInt32LE(cursor + 24);
    const nameSize = bytes.readUInt16LE(cursor + 28), extra = bytes.readUInt16LE(cursor + 30), comment = bytes.readUInt16LE(cursor + 32);
    const local = bytes.readUInt32LE(cursor + 42), external = bytes.readUInt32LE(cursor + 38);
    if (cursor + 46 + nameSize + extra + comment > end || flags & ~0x808 || ![0, 8].includes(method)
      || plainSize > MAX_MEMBER || packedSize > MAX_FILE_BYTES || local === 0xffffffff || (external >>> 16 & 0xf000) === 0xa000) fail('Membro ZIP não suportado.');
    const nameBytes = bytes.subarray(cursor + 46, cursor + 46 + nameSize), name = nameBytes.toString('utf8');
    if (!name || !Buffer.from(name).equals(nameBytes) || /[\x00-\x1f\\:]/.test(name) || name.startsWith('/') || name.split('/').some(p => p === '..' || p === '.') || names.has(name.toLowerCase())) fail('Caminho ZIP inválido ou duplicado.');
    names.add(name.toLowerCase()); expanded += plainSize;
    if (expanded > MAX_EXPANDED || local + 30 > offset || bytes.readUInt32LE(local) !== 0x04034b50) fail('Expansão ZIP acima do limite.');
    const localName = bytes.readUInt16LE(local + 26), localExtra = bytes.readUInt16LE(local + 28), start = local + 30 + localName + localExtra;
    if (bytes.readUInt16LE(local + 6) !== flags || bytes.readUInt16LE(local + 8) !== method || start + packedSize > offset
      || !bytes.subarray(local + 30, local + 30 + localName).equals(nameBytes)) fail('Cabeçalho ZIP inconsistente.');
    ranges.push([local, start + packedSize]);
    const compressed = bytes.subarray(start, start + packedSize);
    let data;
    try { data = method === 0 ? compressed : inflateRawSync(compressed, { maxOutputLength: Math.min(MAX_MEMBER, plainSize + 1) }); }
    catch { fail('Conteúdo ZIP inválido ou acima do limite.'); }
    if (data.length !== plainSize || crc32(data) !== crc) fail('Integridade ZIP inválida.');
    entries.push({ name, data, compressed, method, crc });
    cursor += 46 + nameSize + extra + comment;
  }
  if (cursor !== end) fail('Diretório ZIP inconsistente.');
  ranges.sort((a, b) => a[0] - b[0]);
  if (ranges.some((r, i) => i && r[0] < ranges[i - 1][1])) fail('Membros ZIP sobrepostos.');
  return entries;
}

export function writeZip(entries) {
  const locals = [], directory = []; let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name), data = entry.data;
    const packed = entry.compressed ?? deflateRawSync(data), method = entry.compressed ? entry.method : 8;
    const crc = crc32(data), header = Buffer.alloc(30), central = Buffer.alloc(46);
    header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x800, 6); header.writeUInt16LE(method, 8);
    header.writeUInt32LE(crc, 14); header.writeUInt32LE(packed.length, 18); header.writeUInt32LE(data.length, 22); header.writeUInt16LE(name.length, 26);
    central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x800, 8); central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc, 16); central.writeUInt32LE(packed.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(name.length, 28); central.writeUInt32LE(offset, 42);
    locals.push(header, name, packed); directory.push(central, name); offset += header.length + name.length + packed.length;
  }
  const end = Buffer.alloc(22), dir = Buffer.concat(directory);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(dir.length, 12); end.writeUInt32LE(offset, 16);
  const result = Buffer.concat([...locals, dir, end]);
  if (result.length > MAX_FILE_BYTES) fail('Resultado 3MF acima de 64 MB.');
  return result;
}

export function parseXml(bytes, onOpen = () => {}, onClose = () => {}) {
  const parser = new SaxesParser({ xmlns: true });
  parser.on('error', () => fail('O 3MF contém XML inválido.'));
  parser.on('doctype', () => fail('Declarações DTD não são permitidas no 3MF.'));
  parser.on('opentag', tag => {
    // Inspect every namespaced attribute before making a convenience map: a
    // second namespace must not shadow p:path/href/Target during validation.
    for (const attribute of Object.values(tag.attributes)) {
      if (attribute.local === 'TargetMode' && attribute.value.toLowerCase() === 'external') fail('Referência externa não permitida no 3MF.');
      if (['path', 'href', 'src', 'Target'].includes(attribute.local)
        && /^(?:[a-z]+:|\\\\|\/\/)|(?:^|\/)\.\.(?:\/|$)/i.test(attribute.value)) fail('Referência externa não permitida no 3MF.');
    }
    const attrs = Object.fromEntries(Object.values(tag.attributes).map(a => [a.local, a.value]));
    if (attrs.TargetMode?.toLowerCase() === 'external' || (tag.local === 'Relationship' && /^(?:[a-z]+:|\/\/)/i.test(attrs.Target ?? ''))) fail('Referência externa não permitida no 3MF.');
    onOpen(tag.local, attrs);
  });
  parser.on('closetag', tag => onClose(tag.local));
  const decoder = new StringDecoder('utf8');
  for (let n = 0; n < bytes.length; n += 65536) parser.write(decoder.write(bytes.subarray(n, n + 65536)));
  parser.write(decoder.end()).close();
}

function unsafeSettings(node) {
  if (!node || typeof node !== 'object') return false;
  return Object.entries(node).some(([key, value]) => /post[_ -]?(?:process|processing)/i.test(key)
    ? Array.isArray(value) ? value.some(v => String(v).trim()) : value != null && String(value).trim() !== ''
    : unsafeSettings(value));
}

export function validateArchive(entries, source = false) {
  if (!entries.some(e => /^3D\/.+\.model$/i.test(e.name))) fail('O 3MF não contém geometria.');
  for (const entry of entries) {
    if (/\.(?:xml|model|rels)$/i.test(entry.name) || (/\.config$/i.test(entry.name) && entry.data.toString('utf8', 0, 100).trimStart().startsWith('<'))) parseXml(entry.data, (_tag, attrs) => {
      if (source && /post[_ -]?(?:process|processing)/i.test(attrs.key ?? '') && attrs.value?.trim()) fail('Script de pós-processamento não permitido.');
      for (const key of ['path', 'href', 'src']) if (/^(?:[a-z]+:|\\\\|\/\/)|(?:^|\/)\.\.(?:\/|$)/i.test(attrs[key] ?? '')) fail('Referência externa não permitida no 3MF.');
    });
    if (source && /(?:project_settings|print_config|Slic3r).*\.(?:config|ini)$/i.test(entry.name)) {
      if (entry.data.length > 8 * 1024 * 1024) fail('Configuração 3MF acima do limite.');
      const text = entry.data.toString('utf8').trim();
      if (text.startsWith('{')) {
        let settings; try { settings = JSON.parse(text); } catch { fail('Configuração 3MF inválida.'); }
        if (unsafeSettings(settings)) fail('Remova os scripts de pós-processamento do arquivo antes de simular.');
      } else if (/^\s*(?:;\s*)?post[_ -]?(?:process|processing)[^=\n]*=\s*[^\s\n]+/im.test(text)) fail('Script de pós-processamento não permitido.');
    }
  }
}

export function normalizeOutput(raw, compatiblePrinters, extruderVariant) {
  if (JSON.stringify(compatiblePrinters) !== '["Bambu Lab A1 0.4 nozzle"]' || JSON.stringify(extruderVariant) !== '["Direct Drive Standard"]') fail('O perfil oficial não corresponde à normalização autorizada.');
  const entries = readZip(raw), normalizations = [];
  const allowed = [
    ['compatible_printers', 'Bambu Lab A1 0.4 nozzle', COMPATIBLE_NORMALIZATION],
    ['print_extruder_variant', 'Direct Drive Standard', EXTRUDER_NORMALIZATION],
  ];
  const normalized = entries.map(entry => {
    if (entry.name !== 'Metadata/model_settings.config') return entry;
    let text = entry.data.toString('utf8');
    for (const [key, value, marker] of allowed) {
      const expected = '<metadata key="' + key + '" value=""' + value + '""/>';
      if (!text.includes(expected)) continue;
      // Multiple objects legitimately repeat the same official setting.
      text = text.replaceAll(expected, '<metadata key="' + key + '" value="&quot;' + value + '&quot;"/>');
      normalizations.push(marker);
    }
    return normalizations.length ? { name: entry.name, data: Buffer.from(text) } : entry;
  });
  if (normalizations.length) normalized.push({ name: 'Metadata/forge_slicer_normalization.json', data: Buffer.from(JSON.stringify({ raw_output_sha256: sha256(raw), normalizations, engine_version: ENGINE_VERSION })) });
  validateArchive(normalized);
  const output = normalizations.length ? writeZip(normalized) : raw;
  const verified = readZip(output); validateArchive(verified);
  for (const original of entries.filter(e => /\.(?:model|gcode)$/i.test(e.name))) {
    if (!verified.some(e => e.name === original.name && sha256(e.data) === sha256(original.data))) fail('A geometria ou o G-code foi alterado durante a normalização.');
  }
  return { output, entries: verified, normalizations };
}

export function readMetrics(entries, report) {
  if (report.return_code !== 0 || !Array.isArray(report.sliced_plates) || !report.sliced_plates.length) fail('O Bambu Studio não confirmou o fatiamento.');
  const info = entries.find(e => e.name === 'Metadata/slice_info.config');
  if (!info) fail('O fatiador não retornou tempos e consumo.');
  const plates = []; let plate = null, version = null;
  parseXml(info.data, (tag, a) => {
    if (tag === 'header' && a.key === 'X-BBL-Client-Version') version = a.value;
    if (tag === 'plate') { plate = { metadata: {}, filaments: [] }; plates.push(plate); }
    if (tag === 'metadata' && plate) plate.metadata[a.key] = a.value;
    if (tag === 'filament' && plate) plate.filaments.push(a);
  }, tag => { if (tag === 'plate') plate = null; });
  // Bambu's header may use header_item instead of header in different packaging builds.
  if (!version) parseXml(info.data, (tag, a) => { if (a.key === 'X-BBL-Client-Version') version = a.value; });
  if (version !== ENGINE_VERSION || plates.length !== report.sliced_plates.length) fail('Versão ou quantidade de placas inesperada.');
  const positive = (v, max) => { const n = Number(v); if (!Number.isFinite(n) || n <= 0 || n > max) fail('Métrica ausente ou inválida no fatiamento.'); return n; };
  const result = plates.map((p, index) => {
    const time = positive(p.metadata.prediction, 31536000), weight = positive(p.metadata.weight, 1000000);
    const jsonPlate = report.sliced_plates.find(j => j.id === Number(p.metadata.index)) ?? report.sliced_plates[index];
    const jsonWeight = jsonPlate.filaments?.reduce((sum, f) => sum + Number(f.total_used_g), 0);
    if (!Number.isFinite(jsonWeight) || Math.abs(jsonWeight - weight) > Math.max(0.1, weight * 0.01)
      || Math.abs(positive(jsonPlate.total_predication, 31536000) - time) > 2) fail('As métricas do JSON e do 3MF não conferem.');
    return { plate_index: Number(p.metadata.index), time_seconds: time, weight_grams: weight,
      printer_model_id: p.metadata.printer_model_id || 'Bambu Lab A1', nozzle_diameters: p.metadata.nozzle_diameters || '0.4',
      filaments: p.filaments.map(f => ({ id: Number(f.id), material_code: f.type, color_hex: f.color,
        weight_grams: positive(f.used_g, 1000000), length_meters: positive(f.used_m, 1000000) })) };
  });
  return { time_seconds: result.reduce((s, p) => s + p.time_seconds, 0), weight_grams: result.reduce((s, p) => s + p.weight_grams, 0), plates: result };
}

export async function resolveOfficialProfiles(enginePath, target) {
  const vendor = path.join(path.dirname(enginePath), 'resources', 'profiles', 'BBL');
  async function load(kind, name, seen = []) {
    if (seen.includes(name) || /[\\/]/.test(name)) fail('Herança de perfil inválida.');
    const node = JSON.parse((await readFile(path.join(vendor, kind, name + '.json'), 'utf8')).replace(/^\uFEFF/, ''));
    const parents = node.inherits ? await load(kind, node.inherits, [...seen, name]) : {};
    for (const include of node.include ?? []) Object.assign(parents, await load(kind, include, [...seen, name]));
    Object.assign(parents, node); delete parents.inherits; delete parents.include; return parents;
  }
  await mkdir(target, { recursive: true });
  const sources = { machine: ['machine', 'Bambu Lab A1 0.4 nozzle'], process: ['process', '0.20mm Standard @BBL A1'], filament: ['filament', 'Generic PLA @BBL A1'] };
  const profiles = {};
  for (const [kind, [folder, name]] of Object.entries(sources)) {
    const data = Buffer.from(JSON.stringify(await load(folder, name), null, 2));
    await writeFile(path.join(target, kind + '.json'), data, { mode: 0o600 }); profiles[kind] = sha256(data);
  }
  return profiles;
}

export async function safeRemoveJob(root, job) {
  if (!UUID.test(path.basename(job))) fail('Diretório de trabalho inválido.');
  const resolvedRoot = await realpath(root), resolved = await realpath(job).catch(() => null);
  if (!resolved) return;
  if (path.dirname(resolved).toLowerCase() !== resolvedRoot.toLowerCase() || path.resolve(job).toLowerCase() !== resolved.toLowerCase()) fail('Diretório de trabalho fora da área privada.');
  await rm(resolved, { recursive: true, force: true });
}

export async function runSimulation({ enginePath, profileDir, profileHashes, source, extension, workspace, timeoutMs = 600000, signal, onChild = () => {}, spawnProcess = spawn }) {
  if (!['stl', '3mf'].includes(extension) || !source.length || source.length > MAX_FILE_BYTES) fail('Arquivo de simulação inválido.');
  if (extension === '3mf') validateArchive(readZip(source), true);
  await mkdir(workspace, { recursive: false });
  const outputDir = path.join(workspace, 'output'), dataDir = path.join(workspace, 'isolated-data');
  await mkdir(outputDir); await mkdir(dataDir);
  const profiles = {};
  for (const kind of ['machine', 'process', 'filament']) {
    const bytes = await readFile(path.join(profileDir, kind + '.json'));
    if (sha256(bytes) !== profileHashes[kind]) fail('O perfil do fatiador foi alterado. Execute a configuração novamente.');
    profiles[kind] = JSON.parse(bytes); await writeFile(path.join(workspace, kind + '.json'), bytes, { mode: 0o600 });
  }
  const input = path.join(workspace, 'source.' + extension); await writeFile(input, source, { mode: 0o600 });
  const args = ['--datadir', dataDir, '--debug', '3', '--load-settings', path.join(workspace, 'machine.json') + ';' + path.join(workspace, 'process.json'),
    '--load-filaments', path.join(workspace, 'filament.json'), '--curr-bed-type', 'Textured PEI Plate', '--orient', '1', '--arrange', '1', '--slice', '0',
    '--export-slicedata', path.join(outputDir, 'slice-data'), '--export-3mf', 'simulation.3mf', '--outputdir', outputDir, input];
  const env = { ...process.env, APPDATA: dataDir, LOCALAPPDATA: dataDir, USERPROFILE: dataDir, HOME: dataDir };
  const started = Date.now();
  await new Promise((resolve, reject) => {
    const child = spawnProcess(enginePath, args, { cwd: workspace, env, windowsHide: true, shell: false, stdio: 'ignore', signal });
    onChild(child);
    const timer = setTimeout(() => { child.kill(); reject(new Error('A simulação ultrapassou dez minutos. Simplifique o arquivo e tente novamente.')); }, Math.min(timeoutMs, 600000));
    child.once('error', error => { clearTimeout(timer); reject(new Error(error.name === 'AbortError' ? 'Simulação interrompida.' : 'Não foi possível iniciar o Bambu Studio.')); });
    child.once('exit', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error('O Bambu Studio não conseguiu fatiar este arquivo (código ' + code + ').')); });
  });
  const raw = await readFile(path.join(outputDir, 'simulation.3mf'));
  const report = JSON.parse(await readFile(path.join(outputDir, 'result.json'), 'utf8'));
  const { output, entries, normalizations } = normalizeOutput(raw, profiles.process.compatible_printers, profiles.process.print_extruder_variant);
  const metrics = readMetrics(entries, report);
  await writeFile(path.join(outputDir, 'simulation-valid.3mf'), output, { mode: 0o600 });
  const stats = { engine: 'Bambu Studio', engine_version: ENGINE_VERSION, profile_id: PROFILE, ...metrics,
    input_sha256: sha256(source), raw_output_size: raw.length, raw_output_sha256: sha256(raw), output_sha256: sha256(output), normalizations,
    profile_hashes: profileHashes, elapsed_seconds: Math.round((Date.now() - started) / 10) / 100, estimates_only: true };
  await writeFile(path.join(outputDir, 'forge-result.json'), JSON.stringify(stats, null, 2), { mode: 0o600 });
  return { raw, output, stats };
}

export function createRpc(config, fetcher = fetch) {
  if (config.api_origin !== API_ORIGIN || !UUID.test(config.worker_id) || !/^[0-9a-f]{64}$/.test(config.worker_token)
    || typeof config.public_key !== 'string' || config.public_key.length < 20) fail('Arquivo de conexão inválido.');
  return async (name, body = {}) => {
    if (!/^(?:slicer_worker_|claim_slicer_job$|finish_slicer_job$|fail_slicer_job$|reset_slicer_result$)/.test(name)) fail('Operação não autorizada para o fatiador.');
    for (let attempt = 0; attempt < 3; attempt++) {
      let response;
      try {
        response = await fetcher(API_ORIGIN + '/rest/v1/rpc/' + name, { method: 'POST', signal: AbortSignal.timeout(20000),
          headers: { apikey: config.public_key, ...(config.public_key.startsWith('eyJ') ? { Authorization: 'Bearer ' + config.public_key } : {}), 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...body, p_worker: config.worker_id, p_token: config.worker_token }) });
      } catch { if (attempt < 2) { await sleep(1000 * (attempt + 1)); continue; } fail('Falha de conexão com o Forge.'); }
      if ((response.status === 429 || response.status >= 500) && attempt < 2) { await sleep(1000 * (attempt + 1)); continue; }
      if (!response.ok) { const error = new Error('O Forge recusou a operação do fatiador.'); error.status = response.status; throw error; }
      const text = await response.text(); return text ? JSON.parse(text) : null;
    }
  };
}

export async function processJob(config, rpc, job, { signal, onChild, simulate = runSimulation } = {}) {
  if (!UUID.test(job.id) || !UUID.test(job.lease_id) || job.profile_id !== PROFILE || !['stl', '3mf'].includes(job.extension)
    || !Number.isSafeInteger(job.source_size) || job.source_size < 1 || job.source_size > MAX_FILE_BYTES
    || job.source_chunks !== Math.ceil(job.source_size / CHUNK_BYTES)) fail('Metadados da tarefa inválidos.');
  const scope = { p_job: job.id, p_lease: job.lease_id }, root = path.resolve(config.jobs_dir), workspace = path.join(root, job.id);
  await mkdir(root, { recursive: true });
  const started = Date.now();
  const checkDeadline = () => { if (Date.now() - started >= 600000) fail('A simulação ultrapassou dez minutos.'); };
  let progress = 5, heartbeatBusy = false, lost = false;
  const beat = async () => { if (heartbeatBusy) return; heartbeatBusy = true; try {
    await rpc('slicer_worker_hello', { p_profiles: [PROFILE], p_engine_version: ENGINE_VERSION });
    await rpc('slicer_worker_heartbeat', { ...scope, p_progress: progress });
  } catch { lost = true; } finally { heartbeatBusy = false; } };
  const timer = setInterval(beat, 25000); timer.unref();
  try {
    await beat(); if (lost) fail('A conexão desta simulação foi interrompida.');
    if (job.result_sha256) {
      try { return await rpc('finish_slicer_job', scope); } catch (error) { if (error.status !== 400) throw error; }
      await rpc('reset_slicer_result', scope);
    }
    const chunks = [];
    for (let part = 0; part < job.source_chunks; part++) {
      checkDeadline();
      if (signal?.aborted || lost) fail('Simulação interrompida.');
      const encoded = await rpc('slicer_worker_source', { ...scope, p_part: part });
      if (typeof encoded !== 'string' || encoded.length > 524288 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) fail('Bloco de origem inválido.');
      chunks.push(Buffer.from(encoded, 'base64')); progress = 5 + Math.floor(15 * (part + 1) / job.source_chunks);
    }
    const source = Buffer.concat(chunks);
    if (source.length !== job.source_size || sha256(source) !== job.source_sha256) fail('O hash do arquivo recebido não confere.');
    await safeRemoveJob(root, workspace);
    progress = 25;
    const result = await simulate({ enginePath: config.engine_path, profileDir: config.profile_dir, profileHashes: config.profile_hashes,
      source, extension: job.extension, workspace, signal, onChild, timeoutMs: 600000 - (Date.now() - started) });
    if (lost || signal?.aborted) fail('Simulação interrompida.');
    progress = 80; await beat(); if (lost) fail('A conexão desta simulação foi interrompida.');
    await rpc('slicer_worker_result', { ...scope, p_size: result.output.length, p_sha256: result.stats.output_sha256, p_stats: result.stats });
    for (const [kind, bytes] of [['result', result.output], ...(result.stats.normalizations.length ? [['raw', result.raw]] : [])]) {
      const count = Math.ceil(bytes.length / CHUNK_BYTES);
      for (let part = 0; part < count; part++) {
        checkDeadline();
        if (lost || signal?.aborted) fail('Simulação interrompida.');
        await rpc('slicer_worker_' + kind + '_chunk', { ...scope, p_part: part, p_base64: bytes.subarray(part * CHUNK_BYTES, (part + 1) * CHUNK_BYTES).toString('base64') });
      }
    }
    return await rpc('finish_slicer_job', scope);
  } finally { clearInterval(timer); await safeRemoveJob(root, workspace); }
}

async function main() {
  const args = process.argv.slice(2), option = name => args[args.indexOf(name) + 1];
  const readConfig = async filename => {
    try { return JSON.parse(await readFile(filename, 'utf8')); } catch { fail('Não foi possível ler o arquivo privado de configuração.'); }
  };
  if (args.includes('--resolve-profiles')) {
    const hashes = await resolveOfficialProfiles(option('--engine'), option('--profiles'));
    console.log(JSON.stringify({ profile_id: PROFILE, profile_hashes: hashes })); return;
  }
  if (args.includes('--self-test') || args.includes('--verify-engine')) {
    const config = await readConfig(option('--config')), input = option('--self-test');
    try {
      const result = await runSimulation({ enginePath: config.engine_path, profileDir: config.profile_dir, profileHashes: config.profile_hashes,
        source: args.includes('--verify-engine') ? verificationCube() : await readFile(input), extension: args.includes('--verify-engine') ? 'stl' : path.extname(input).slice(1).toLowerCase(), workspace: option('--workspace') });
      console.log(JSON.stringify(result.stats, null, 2));
    } finally { if (args.includes('--verify-engine')) await safeRemoveJob(config.jobs_dir, option('--workspace')); }
    return;
  }
  if (!args.includes('--config')) fail('Informe --config com o arquivo privado de configuração.');
  const configPath = path.resolve(option('--config'));
  const config = await readConfig(configPath);
  const rpc = createRpc(config);
  if (sha256(await readFile(config.engine_path)) !== config.engine_sha256) fail('A instalação do Bambu Studio mudou. Execute a configuração novamente.');
  const lockPath = path.join(path.dirname(configPath), 'worker.lock'); let lock;
  try { lock = await open(lockPath, 'wx', 0o600); }
  catch {
    const previous = JSON.parse(await readFile(lockPath, 'utf8'));
    if (!Number.isInteger(previous.pid)) fail('Arquivo de trava inválido.');
    try { process.kill(previous.pid, 0); fail('Este fatiador já está em execução.'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    await rm(lockPath); lock = await open(lockPath, 'wx', 0o600);
  }
  await lock.writeFile(JSON.stringify({ pid: process.pid, started_at: new Date().toISOString() }));
  const controller = new AbortController(); let activeChild;
  const stop = () => { controller.abort(); activeChild?.kill(); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try {
    await rpc('slicer_worker_hello', { p_profiles: [PROFILE], p_engine_version: ENGINE_VERSION });
    console.log('Fatiador conectado. Perfil: Bambu A1 / PLA / 0,20 mm.');
    do {
      let job;
      try { job = await rpc('claim_slicer_job'); }
      catch (error) {
        if ([401, 403].includes(error.status) || args.includes('--once')) throw error;
        console.error('Forge indisponível. Nova tentativa em 30 segundos.'); await sleep(30000); continue;
      }
      if (job) {
        console.log('Simulando tarefa ' + job.id);
        try { await processJob(config, rpc, job, { signal: controller.signal, onChild: child => { activeChild = child; } }); console.log('Simulação concluída: ' + job.id); }
        catch (error) {
          if (!controller.signal.aborted) { await rpc('fail_slicer_job', { p_job: job.id, p_lease: job.lease_id, p_error: error.message }).catch(() => {}); console.error('Falha na simulação ' + job.id + ': ' + error.message); }
        } finally { activeChild = null; }
      }
      if (!args.includes('--once') && !controller.signal.aborted) await sleep(5000);
    } while (!args.includes('--once') && !controller.signal.aborted);
  } finally { activeChild?.kill(); await lock.close(); await rm(lockPath, { force: true }); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
