// Both current root-folder and historical chrome-folder installations load the
// exact same complete extension. This test never installs or runs the engine.
import assert from 'node:assert/strict';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { PROTOCOL } from '../extensions/forge-slicer/protocol.js';

for(const script of ['build-slicer-extension.mjs','package-slicer-extension.mjs']){
 const result=spawnSync(process.execPath,[fileURLToPath(new URL(script,import.meta.url))],{encoding:'utf8',windowsHide:true,shell:false,timeout:30000});
 assert.equal(result.status,0,result.stderr||result.error?.message);
}
const root=new URL('../dist/extension-package/',import.meta.url),names=await readdir(root);
const read=name=>readFile(new URL(name,root)),text=async name=>(await read(name)).toString('utf8');
const manifest=JSON.parse(await text('manifest.json')),protocol=JSON.parse(await text('protocol.json'));
assert.equal(names.includes('manifest.json'),true);assert.equal(names.includes('chrome'),true);
assert.equal(names.includes('install-slicer-extension.mjs'),true);assert.equal(names.includes('native'),true);
console.log('PASS The extracted root remains directly loadable and the historical chrome folder is present for compatible updates.');

assert.deepEqual(protocol,PROTOCOL);
const extensionId=[...createHash('sha256').update(Buffer.from(manifest.key,'base64')).digest().subarray(0,16)].flatMap(value=>[value>>4,value&15]).map(value=>String.fromCharCode(97+value)).join('');
assert.equal(extensionId,'lkalcgppeejlaioplgipmmgdcpncofck');assert.equal(extensionId,protocol.extension_id);
console.log('PASS Packaging retains the exact public key and fixed native-messaging extension identity.');

const referenced=[manifest.background.service_worker,manifest.action.default_popup,...Object.values(manifest.icons||{})];
for(const match of (await text(manifest.action.default_popup)).matchAll(/(?:src|href)=["']([^"']+)["']/g))if(!/^(?:[a-z]+:|#)/i.test(match[1]))referenced.push(match[1]);
for(const js of ['service-worker.js','popup.js'])for(const match of (await text(js)).matchAll(/from\s+["']\.\/([^"']+)["']/g))referenced.push(match[1]);
for(const asset of referenced)assert.ok((await read(asset)).length,asset);
const assets=['manifest.json','protocol.json','protocol.js','service-worker.js','popup.html','popup.js','popup.css'];
for(const asset of assets){assert.deepEqual(await read(asset),await readFile(new URL('../extensions/forge-slicer/'+asset,import.meta.url)));assert.deepEqual(await read('chrome/'+asset),await read(asset));}
assert.deepEqual((await readdir(new URL('chrome/',root))).sort(),assets.toSorted());
assert.equal(JSON.parse(await text('chrome/manifest.json')).version,'1.0.2');assert.deepEqual(JSON.parse(await text('chrome/protocol.json')),PROTOCOL);
for(const asset of referenced)assert.ok((await read('chrome/'+asset)).length,asset);
console.log('PASS Both selected folders resolve every asset and share identical version, permissions, origins, A1/A2L profiles and pinned identity.');

const zipBytes=await readFile(new URL('../public/downloads/forge-slicer-extension.zip',import.meta.url)),entries=unzipSync(zipBytes),zipNames=Object.keys(entries);
assert.equal(zipNames.includes('manifest.json'),true);assert.equal(zipNames.includes('chrome/manifest.json'),true);assert.equal(zipNames.some(name=>name.startsWith('extension-package/')),false);
for(const asset of ['manifest.json','protocol.json','protocol.js','service-worker.js','popup.html','popup.js','popup.css','native/forge-slicer-native-host.mjs','install-slicer-extension.mjs','README.txt'])assert.deepEqual(Buffer.from(entries[asset]),await read(asset),asset);
const checksum=(await readFile(new URL('../public/downloads/forge-slicer-extension.sha256',import.meta.url),'utf8')).split(' ')[0];assert.equal(createHash('sha256').update(zipBytes).digest('hex'),checksum);
for(const asset of assets)assert.deepEqual(Buffer.from(entries['chrome/'+asset]),await read(asset),asset);
console.log('PASS The ZIP contains the current root and byte-identical chrome compatibility assets with a verified archive checksum.');

const compatibilityScript=new URL('chrome/protocol.js',root),originalScript=await readFile(compatibilityScript);
try{
 await writeFile(compatibilityScript,Buffer.concat([originalScript,Buffer.from('\n// stale compatibility script\n')]));
 const rejected=spawnSync(process.execPath,[fileURLToPath(new URL('package-slicer-extension.mjs',import.meta.url))],{encoding:'utf8',windowsHide:true,shell:false,timeout:10000});
 assert.notEqual(rejected.status,0);assert.match(rejected.stderr,/cópia chrome está diferente/);
}finally{await writeFile(compatibilityScript,originalScript);}
console.log('PASS Packaging refuses a stale compatibility script even when both manifests still advertise the same version.');

const readme=await text('README.txt');assert.match(readme,/selecione a pasta principal extraída.*manifest\.json/);assert.doesNotMatch(readme,/selecione a pasta chrome|A pasta chrome extraída/);
assert.match(readme,/subpasta chrome também contém todos os mesmos/);assert.match(readme,/devem ser feitas pelo usuário/);
const review=spawnSync(process.execPath,[fileURLToPath(new URL('install-slicer-extension.mjs',root)),'--review'],{encoding:'utf8',windowsHide:true,shell:false,timeout:10000});assert.equal(review.status,0,review.stderr);assert.equal(JSON.parse(review.stdout).mode,'review_only');
console.log('PASS Root-folder instructions and the sibling installer review work without installation or registry changes.');
console.log('Validated 6 package layout and identity regression groups without an engine run or registry change.');
