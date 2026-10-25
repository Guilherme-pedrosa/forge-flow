import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';

const installer = await readFile(new URL('./setup-forge-slicer.ps1', import.meta.url), 'utf8');
assert.ok(installer.includes('-Argument $startup.Arguments'));
assert.ok(!/Set-ExecutionPolicy/.test(installer));
if (process.platform !== 'win32') {
  console.log('PASS startup uses a command action without changing persistent execution policy (native Windows test runs on Windows).');
  process.exit(0);
}
const temp = await mkdtemp(path.join(os.tmpdir(), "forge slicer's startup-"));
const powershell = path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const quote = value => "'" + value.replaceAll("'", "''") + "'";
const encoded = command => Buffer.from(command, 'utf16le').toString('base64');
function run(command, policy, cleanModules = true) {
  // A parent PowerShell 7 exports its own incompatible modules; the scheduled
  // Windows PowerShell process normally starts with the Windows module roots.
  const env = cleanModules ? { ...process.env, PSModulePath: path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'Modules') } : process.env;
  const result = spawnSync(powershell, ['-NoProfile', '-NonInteractive', ...(policy ? ['-ExecutionPolicy', policy] : []), '-EncodedCommand', encoded(command)], { encoding: 'utf8', windowsHide: true, shell: false, timeout: 15000, env });
  if (result.status !== 0) throw new Error('PowerShell startup regression: ' + (result.stderr || result.error?.message || result.status));
  return result.stdout.trim();
}
try {
  const before = run('Get-ExecutionPolicy -List | ConvertTo-Json -Compress');
  const worker = path.join(temp, 'test worker.mjs'), config = path.join(temp, 'test config.private.json'), marker = path.join(temp, 'started.json');
  await writeFile(config, JSON.stringify({ marker, testOnly: true }));
  await writeFile(worker, `import{readFile,writeFile}from'node:fs/promises';const at=process.argv.indexOf('--config');const config=JSON.parse(await readFile(process.argv[at+1],'utf8'));await writeFile(config.marker,JSON.stringify({config_path:process.argv[at+1],pid:process.pid}));`);
  const helper = fileURLToPath(new URL('./slicer-startup-command.ps1', import.meta.url));
  const plan = JSON.parse(run('. ([scriptblock]::Create([System.IO.File]::ReadAllText(' + quote(helper) + '))); New-ForgeSlicerStartupCommand -NodePath ' + quote(process.execPath) + ' -WorkerScript ' + quote(worker) + ' -ConfigPath ' + quote(config) + ' -InstallDir ' + quote(temp) + ' | ConvertTo-Json -Compress', 'Restricted'));
  assert.ok(!plan.Arguments.includes('-File ')); assert.ok(!plan.Arguments.includes('Bypass'));
  const match = plan.Arguments.match(/-EncodedCommand ([A-Za-z0-9+/=]+)$/); assert.ok(match);
  assert.equal(Buffer.from(match[1], 'base64').toString('utf16le'), plan.Command);
  run(plan.Command, 'Restricted', false);
  let started;
  for (let n = 0; n < 40; n++) { try { started = JSON.parse(await readFile(marker, 'utf8')); break; } catch { await new Promise(resolve => setTimeout(resolve, 100)); } }
  assert.equal(started?.config_path, config);
  assert.ok(Number.isInteger(started.pid));
  assert.equal(run('Get-ExecutionPolicy -List | ConvertTo-Json -Compress'), before);
  console.log('PASS native Windows Restricted startup executes hidden Node, preserves quoted paths and leaves persistent policy unchanged.');
} finally {
  const checked = path.resolve(temp); assert.ok(checked.startsWith(path.resolve(os.tmpdir()) + path.sep));
  await rm(checked, { recursive: true, force: true });
}
