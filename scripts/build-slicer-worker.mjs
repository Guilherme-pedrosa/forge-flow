import { build } from 'esbuild';
import { copyFile, mkdir } from 'node:fs/promises';
await mkdir(new URL('../dist/worker/', import.meta.url), { recursive: true });
await build({ entryPoints: [new URL('./forge-slicer-worker.mjs', import.meta.url).pathname.replace(/^\/([A-Z]:)/i, '$1')],
  outfile: new URL('../dist/worker/forge-slicer-worker.mjs', import.meta.url).pathname.replace(/^\/([A-Z]:)/i, '$1'),
  bundle: true, platform: 'node', format: 'esm', target: 'node22', sourcemap: false,
  banner: { js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' } });
await copyFile(new URL('./setup-forge-slicer.ps1', import.meta.url), new URL('../dist/worker/setup-forge-slicer.ps1', import.meta.url));
await copyFile(new URL('./slicer-startup-command.ps1', import.meta.url), new URL('../dist/worker/slicer-startup-command.ps1', import.meta.url));
console.log('Fatiador local preparado em dist/worker.');
