import { mkdirSync, realpathSync, openSync, closeSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'win32') throw new Error('Este instalador requer Windows.');
const args = process.argv.slice(2), at = args.indexOf('--connection');
if (at < 0 || !args[at + 1]) throw new Error('Informe --connection com o arquivo privado gerado pelo Forge.');
// Resolve before opening Windows PowerShell: child processes can see a different
// AppX filesystem view. Only physical paths cross that boundary.
const logical = path.join(process.env.LOCALAPPDATA, 'Elevare3D', 'ForgeSlicer');
mkdirSync(logical, { recursive: true });
const canonical = realpathSync.native; // GetFinalPathNameByHandle exposes AppX redirection.
const install = canonical(logical), connection = canonical(args[at + 1]);
const base = canonical(process.env.LOCALAPPDATA), relative = path.relative(base, install).replaceAll('\\', '/');
if (!/^(?:Packages\/[^/]+\/LocalCache\/Local\/)?Elevare3D\/ForgeSlicer$/.test(relative)) throw new Error('Pasta de instalação fora do destino autorizado.');
const setup = fileURLToPath(new URL('./setup-forge-slicer.ps1', import.meta.url));
const powershell = path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const log = openSync(path.join(install, 'install.log'), 'w', 0o600), errors = openSync(path.join(install, 'install-error.log'), 'w', 0o600);
try {
  const result = spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', setup,
    '-ConnectionFile', connection, '-NodePath', canonical(process.execPath), '-InstallDirectory', install,
    ...(args.includes('--register-startup') ? ['-RegisterStartup'] : []), ...(args.includes('--start') ? ['-Start'] : [])],
  { windowsHide: true, shell: false, stdio: ['ignore', log, errors], timeout: 120000 });
  if (result.status !== 0) { console.error('Não foi possível instalar o fatiador. Diagnóstico salvo na pasta privada, sem exibir a conexão.'); process.exitCode = 1; }
  else console.log('Fatiador instalado com caminhos físicos. Conexão mantida somente no arquivo privado.');
} finally { closeSync(log); closeSync(errors); }
