import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { PROTOCOL, allowedSender, validateRequest, makerLink } from '../extensions/forge-slicer/protocol.js';
import { attachClient } from '../extensions/forge-slicer/service-worker.js';

class Event { callbacks=[]; addListener(fn){this.callbacks.push(fn);} emit(value){for(const fn of this.callbacks)fn(value);} }
function port(sender={url:PROTOCOL.allowed_origins[0]+'/comercial/produtos',origin:PROTOCOL.allowed_origins[0],frameId:0}) {
  return {name:'forge-slicer-v1',sender,onMessage:new Event(),onDisconnect:new Event(),messages:[],closed:false,
    postMessage(value){this.messages.push(value);},disconnect(){if(this.closed)return;this.closed=true;this.onDisconnect.emit();}};
}
function fixture(sender,internal=false){const client=port(sender),native=port(),connections=[];const api={runtime:{connectNative(name){connections.push(name);return native;}}};attachClient(client,internal,api);return{client,native,connections};}
let passed=0;
async function test(name,run){await run();passed++;process.stdout.write('PASS '+name+'\n');}

await test('Manifest has a pinned public identity and the minimum scoped permissions',async()=>{
  const manifest=JSON.parse(await readFile(new URL('../extensions/forge-slicer/manifest.json',import.meta.url),'utf8'));
  const json=JSON.parse(await readFile(new URL('../extensions/forge-slicer/protocol.json',import.meta.url),'utf8'));
  assert.deepEqual(json,PROTOCOL);
  assert.deepEqual(PROTOCOL.allowed_origins,['https://elevare3d.lovable.app','https://id-preview--f4da8107-e6b0-434d-90a9-de1c21edf12f.lovable.app','https://elevare3d.com.br']);
  const id=[...createHash('sha256').update(Buffer.from(manifest.key,'base64')).digest().subarray(0,16)].flatMap(value=>[value>>4,value&15]).map(value=>String.fromCharCode(97+value)).join('');
  assert.equal(id,PROTOCOL.extension_id);assert.deepEqual(manifest.permissions,['nativeMessaging','activeTab']);
  assert.deepEqual(manifest.externally_connectable.matches,PROTOCOL.allowed_origins.map(origin=>origin+'/*'));
  assert.equal(manifest.manifest_version,3);assert.equal(manifest.version,'1.0.2');assert.equal(manifest.background.type,'module');assert.equal(manifest.content_scripts,undefined);assert.equal(manifest.host_permissions,undefined);
  for(const file of ['service-worker.js','protocol.js','popup.js','popup.html','popup.css'])await readFile(new URL('../extensions/forge-slicer/'+file,import.meta.url));
});
await test('Only the exact Forge origins and the pinned extension can invoke the native bridge',()=>{
  for(const origin of PROTOCOL.allowed_origins) {
    assert.equal(allowedSender({url:origin+'/comercial/produtos',origin,frameId:0}),true);
    for(const denied of [origin.replace('https:','http:'),origin+'.evil.invalid',origin.replace('https://','https://www.'),origin+':444'])
      assert.equal(allowedSender({url:denied+'/comercial/produtos',origin:denied,frameId:0}),false);
  }
  for(const sender of [{url:'https://elevare3d.lovable.app.evil.invalid/'},{url:PROTOCOL.allowed_origins[0],origin:'https://evil.invalid'},
    {url:PROTOCOL.allowed_origins[0],frameId:1},{url:PROTOCOL.allowed_origins[0],id:'untrusted-extension'}])assert.equal(allowedSender(sender),false);
  assert.equal(allowedSender({id:PROTOCOL.extension_id},true),true);assert.equal(allowedSender({id:'other'},true),false);
  const f=fixture({url:'https://evil.invalid'});assert.equal(f.client.closed,true);assert.equal(f.connections.length,0);
});
await test('The production custom origin reaches the same pinned native host without broader permissions',()=>{
  const origin='https://elevare3d.com.br',f=fixture({url:origin+'/comercial/produtos',origin,frameId:0});
  assert.equal(f.client.closed,false);assert.equal(f.connections.length,0);
  f.client.onMessage.emit({id:'production-hello',op:'hello'});assert.deepEqual(f.connections,[PROTOCOL.host_name]);
  f.native.onMessage.emit({id:'production-hello',ok:true,profile_id:PROTOCOL.profile_id});assert.equal(f.client.messages[0].ok,true);f.client.disconnect();
});
await test('Messages cannot carry commands, file paths, other profiles or oversized chunks',()=>{
  const base={id:'a',op:'begin',name:'peca.3mf',size:100,sha256:'a'.repeat(64),profile_id:PROTOCOL.profile_id};
  assert.deepEqual(validateRequest(base),base);
  for(const change of [{path:'C:/private.3mf'},{name:'../private.3mf'},{profile_id:'other'},{size:67108865},{sha256:'no'},{op:'shell'}])assert.throws(()=>validateRequest({...base,...change}));
  assert.throws(()=>validateRequest({id:'x',op:'chunk',part:0,base64:'A'.repeat(524292)}));
  assert.throws(()=>validateRequest({id:'x',op:'read',part:-1}));
});
await test('Opening a page port does not start a native process; hello starts one short session',()=>{
  const f=fixture();assert.equal(f.connections.length,0);f.client.onMessage.emit({id:'hello',op:'hello'});
  assert.deepEqual(f.connections,[PROTOCOL.host_name]);assert.deepEqual(f.native.messages,[{id:'hello',op:'hello'}]);
  f.native.onMessage.emit({id:'hello',ok:true,profile_id:PROTOCOL.profile_id});assert.equal(f.client.messages[0].ok,true);
  f.client.onMessage.emit({id:'finish',op:'finish'});f.native.onMessage.emit({id:'finish',ok:true,finished:true});
  assert.equal(f.client.closed,true);assert.equal(f.native.closed,true);
});
await test('A second source frame waits for the acknowledged previous frame',()=>{
  const f=fixture();f.client.onMessage.emit({id:'chunk1',op:'chunk',part:0,base64:'YQ=='});
  f.client.onMessage.emit({id:'chunk2',op:'chunk',part:1,base64:'Yg=='});
  assert.equal(f.native.messages.length,1);assert.match(f.client.messages[0].error,/bloco anterior/);
  f.native.onMessage.emit({id:'chunk1',ok:true,part:0});f.client.onMessage.emit({id:'chunk2',op:'chunk',part:1,base64:'Yg=='});
  assert.equal(f.native.messages.length,2);f.client.disconnect();assert.equal(f.native.closed,true);
});
await test('Cancellation is delivered during slicing and disconnects both sides',()=>{
  const f=fixture();f.client.onMessage.emit({id:'slice',op:'slice'});f.client.onMessage.emit({id:'cancel',op:'cancel'});
  assert.deepEqual(f.native.messages.map(value=>value.op),['slice','cancel']);
  f.native.onMessage.emit({id:'cancel',ok:true,cancelled:true});assert.equal(f.client.closed,true);assert.equal(f.native.closed,true);
});
await test('Only one native simulation session runs across Forge tabs',()=>{
  const first=fixture();first.client.onMessage.emit({id:'one',op:'hello'});
  const second=fixture();second.client.onMessage.emit({id:'two',op:'hello'});
  assert.equal(second.connections.length,0);assert.match(second.client.messages[0].error,/em uso/);first.client.disconnect();
  const third=fixture();third.client.onMessage.emit({id:'three',op:'hello'});assert.equal(third.connections.length,1);third.client.disconnect();
});
await test('Native failure returns an actionable error and releases the session',()=>{
  const f=fixture();f.client.onMessage.emit({id:'a',op:'hello'});f.native.disconnect();
  assert.equal(f.client.closed,true);assert.match(f.client.messages[0].error,/conector/);
});
await test('MakerWorld handoff discards tracking and unrelated browser URLs',()=>{
  assert.equal(makerLink('https://makerworld.com/models/744793?appSharePlatform=copy'),'https://makerworld.com/models/744793');
  assert.equal(makerLink('https://makerworld.com/pt/models/744793-design#profileId-677580'),'https://makerworld.com/models/744793?profileId=677580');
  for(const value of ['https://evil.invalid/?makerworld.com/models/1','file:///private','https://makerworld.com/account?token=private','https://makerworld.com.evil.invalid/models/1'])assert.equal(makerLink(value),'');
});
console.log(`Validated ${passed} extension relay and permission scenarios.`);
