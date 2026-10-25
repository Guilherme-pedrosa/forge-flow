// Optional local proof. Only bundled synthetic fixtures and an explicitly chosen
// official engine are used; this script does not connect to the ERP or printers.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { readZip, writeZip, nativeProjectLayout, normalizeOutput, resolveOfficialProfiles, runSimulation } from './forge-slicer-worker.mjs';
const args = process.argv.slice(2), option = name => args[args.indexOf(name) + 1];
if (!args.includes('--engine') || !args.includes('--outputdir')) throw new Error('Informe --engine e --outputdir para uma prova local com geometria sintética.');
const root = path.resolve(option('--outputdir')); await mkdir(root, { recursive: true });
const profileDir = path.join(root, 'profiles'), hashes = await resolveOfficialProfiles(option('--engine'), profileDir);
const source = await readFile(new URL('./fixtures/slicer/two-plate-native-color.3mf', import.meta.url));
const sourceLayout = nativeProjectLayout(readZip(source));
const ids = new Map(sourceLayout.objects.map((object, index) => [object.id, String(101 + index * 608)]));
const nonSequential = writeZip(readZip(source).map(entry => {
  let text;
  if (entry.name === '3D/3dmodel.model') {
    text = entry.data.toString().replace(/<object id="(\d+)"/g, (all, id) => ids.has(id) ? '<object id="' + ids.get(id) + '"' : all)
      .replace(/<item objectid="(\d+)"/g, (all, id) => ids.has(id) ? '<item objectid="' + ids.get(id) + '"' : all);
  } else if (entry.name === 'Metadata/model_settings.config') {
    text = entry.data.toString().replace(/<object id="(\d+)"/g, (all, id) => ids.has(id) ? '<object id="' + ids.get(id) + '"' : all)
      .replace(/<metadata key="object_id" value="(\d+)"/g, (all, id) => ids.has(id) ? '<metadata key="object_id" value="' + ids.get(id) + '"' : all);
  }
  return text ? { name: entry.name, data: Buffer.from(text) } : entry;
}));
await writeFile(path.join(root, 'nonsequential-ids-source.3mf'), nonSequential);
const reports = [];
const three = await readFile(new URL('./fixtures/slicer/three-plate-two-color.3mf', import.meta.url));
for (const [label, bytes] of [['two_plate_two_color', source], ['nonsequential_ids', nonSequential], ['three_plate_two_color', three]]) {
  if (args.includes('--case') && label !== option('--case')) continue;
  const workspace = path.join(root, label + '-' + randomUUID());
  try {
    const result = await runSimulation({ enginePath: option('--engine'), profileDir, profileHashes: hashes, source: bytes, extension: '3mf', workspace, timeoutMs: 60000 });
    reports.push({ label, source: nativeProjectLayout(readZip(bytes)), output: nativeProjectLayout(readZip(result.output)), stats: result.stats });
  } catch (error) {
    const report = { label, error: error.message, source: nativeProjectLayout(readZip(bytes)) };
    try {
      const processProfile = JSON.parse(await readFile(path.join(profileDir, 'process.json'), 'utf8'));
      const normalized = normalizeOutput(await readFile(path.join(workspace, 'output', 'simulation.3mf')), processProfile.compatible_printers, processProfile.print_extruder_variant);
      report.output = nativeProjectLayout(normalized.entries);
    } catch { /* The first failure remains authoritative. */ }
    reports.push(report); process.exitCode = 1;
  }
}
await writeFile(path.join(root, 'composition-proof.json'), JSON.stringify(reports, null, 2));
console.log(JSON.stringify(reports.map(r => ({ label: r.label, error: r.error, source_copy_counts: r.source.plates.map(p => p.instances.length),
  output_copy_counts: r.output?.plates.map(p => p.instances.length), metrics: r.stats?.plates, preservation: r.stats?.preservation })), null, 2));
