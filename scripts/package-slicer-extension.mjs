import { readdir, readFile, writeFile, mkdir, realpath, lstat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { zipSync } from 'fflate';

const repo=await realpath(fileURLToPath(new URL('../',import.meta.url)));
const source=await realpath(path.join(repo,'dist','extension-package'));
if(source!==path.join(repo,'dist','extension-package'))throw new Error('Pacote fora do diretório esperado.');
const files={};
async function visit(folder,prefix=''){
 for(const entry of (await readdir(folder,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
  const filename=path.join(folder,entry.name),name=prefix+entry.name,info=await lstat(filename);
  if(info.isSymbolicLink())throw new Error('O pacote não aceita links.');
  if(info.isDirectory())await visit(filename,name+'/');
  else if(info.isFile()){
   if(!/\.(?:js|mjs|json|html|css|txt|md)$/.test(name)||info.size>1024*1024)throw new Error('Arquivo inesperado no pacote: '+name);
   files[name]=[new Uint8Array(await readFile(filename)),{mtime:new Date('2026-11-02T00:00:00Z')}];
  }
 }
}
await visit(source);
for(const file of ['chrome/manifest.json','chrome/service-worker.js','chrome/protocol.js','chrome/popup.html','native/forge-slicer-native-host.mjs','install-slicer-extension.mjs','README.txt'])if(!files[file])throw new Error('Pacote incompleto: '+file);
const output=path.join(repo,'public','downloads');await mkdir(output,{recursive:true});
if(await realpath(output)!==output)throw new Error('Destino do pacote fora do repositório.');
const bytes=zipSync(files,{level:9}),filename=path.join(output,'forge-slicer-extension.zip');
await writeFile(filename,bytes);
const summary={file:'public/downloads/forge-slicer-extension.zip',bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),entries:Object.keys(files)};
await writeFile(path.join(output,'forge-slicer-extension.sha256'),summary.sha256+'  forge-slicer-extension.zip\n');
console.log(JSON.stringify(summary,null,2));
