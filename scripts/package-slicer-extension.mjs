import { readdir, readFile, writeFile, mkdir, realpath, lstat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { zipSync } from 'fflate';
import { PROTOCOL } from '../extensions/forge-slicer/protocol.js';

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
for(const file of ['manifest.json','service-worker.js','protocol.js','protocol.json','popup.html','popup.js','popup.css','native/forge-slicer-native-host.mjs','install-slicer-extension.mjs','README.txt'])if(!files[file])throw new Error('Pacote incompleto: '+file);
const text=name=>Buffer.from(files[name][0]).toString('utf8');
const extensionFiles=Object.keys(files).filter(name=>!name.startsWith('chrome/')&&!name.startsWith('native/')&&!['install-slicer-extension.mjs','README.txt'].includes(name)).sort();
const compatibilityFiles=Object.keys(files).filter(name=>name.startsWith('chrome/')).map(name=>name.slice('chrome/'.length)).sort();
if(JSON.stringify(extensionFiles)!==JSON.stringify(compatibilityFiles))throw new Error('A cópia chrome precisa conter exatamente todos os arquivos da extensão principal.');
for(const name of extensionFiles)if(!Buffer.from(files[name][0]).equals(Buffer.from(files['chrome/'+name][0])))throw new Error('A cópia chrome está diferente da extensão principal: '+name);
const manifest=JSON.parse(text('manifest.json')),protocol=JSON.parse(text('protocol.json'));
const extensionId=[...createHash('sha256').update(Buffer.from(manifest.key,'base64')).digest().subarray(0,16)].flatMap(value=>[value>>4,value&15]).map(value=>String.fromCharCode(97+value)).join('');
if(extensionId!==PROTOCOL.extension_id||JSON.stringify(protocol)!==JSON.stringify(PROTOCOL))throw new Error('A identidade fixa da extensão mudou no pacote.');
for(const prefix of ['','chrome/']){
 const selectedManifest=JSON.parse(text(prefix+'manifest.json'));
 const referenced=[selectedManifest.background?.service_worker,selectedManifest.action?.default_popup,...Object.values(selectedManifest.icons||{})];
 for(const html of [selectedManifest.action?.default_popup].filter(Boolean))for(const match of text(prefix+html).matchAll(/(?:src|href)=["']([^"']+)["']/g))if(!/^(?:[a-z]+:|#)/i.test(match[1]))referenced.push(match[1]);
 for(const js of ['service-worker.js','popup.js'])for(const match of text(prefix+js).matchAll(/from\s+["']\.\/([^"']+)["']/g))referenced.push(match[1]);
 for(const name of referenced)if(typeof name!=='string'||name.startsWith('/')||name.includes('..')||!files[prefix+name])throw new Error('Arquivo referenciado pela extensão ausente: '+prefix+name);
}
const output=path.join(repo,'public','downloads');await mkdir(output,{recursive:true});
if(await realpath(output)!==output)throw new Error('Destino do pacote fora do repositório.');
const bytes=zipSync(files,{level:9}),filename=path.join(output,'forge-slicer-extension.zip');
await writeFile(filename,bytes);
const summary={file:'public/downloads/forge-slicer-extension.zip',bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),entries:Object.keys(files)};
await writeFile(path.join(output,'forge-slicer-extension.sha256'),summary.sha256+'  forge-slicer-extension.zip\n');
console.log(JSON.stringify(summary,null,2));
