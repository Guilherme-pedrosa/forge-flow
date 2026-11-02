import { readFile, open, rm, realpath, lstat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { PROTOCOL, validateRequest } from '../extensions/forge-slicer/protocol.js';
import { PROFILE, ENGINE_VERSION, CHUNK_BYTES, MAX_FILE_BYTES, sha256, runSimulation, safeRemoveJob } from './forge-slicer-worker.mjs';

export const FRAME_BYTES=1024*1024;
const HASH=/^[a-f0-9]{64}$/;
const fail=message=>{throw new Error(message);};
const samePath=(a,b)=>process.platform==='win32'?a.toLowerCase()===b.toLowerCase():a===b;
export function lowerPriority(pid=process.pid){try{os.setPriority(pid,os.constants.priority.PRIORITY_BELOW_NORMAL);}catch{fail('Não foi possível executar o fatiador em prioridade reduzida.');}}
export function publicError(error){return error?.code || /(?:[A-Z]:[\\/]|ENOENT|EACCES|EPERM|node:|\/Users\/|\/home\/)/i.test(error?.message||'')
 ? 'Não foi possível concluir a operação local. Confira a instalação do conector e tente novamente.'
 : String(error?.message||'Falha na operação local.').replace(/[\x00-\x1f]/g,' ').slice(0,500);}

async function regular(filename){const info=await lstat(filename);if(!info.isFile()||info.isSymbolicLink())fail('Arquivo local de configuração inválido.');return realpath(filename);}
async function privateChild(root,filename,relative,directory=false){
 const resolved=await realpath(filename),expected=path.join(root,relative),info=await lstat(filename);
 if(!samePath(path.resolve(filename),expected)||!samePath(resolved,expected)||info.isSymbolicLink()||(directory?!info.isDirectory():!info.isFile()))fail('Arquivo fora da pasta privada do conector.');
 return resolved;
}
export async function loadNativeConfig(filename){
 const canonical=await regular(filename),root=path.dirname(canonical);
 let config;try{config=JSON.parse(await readFile(canonical,'utf8'));}catch{fail('Configuração local inválida. Reinstale o conector.');}
 const keys=['version','extension_id','host_name','profile_id','engine_version','engine_path','engine_sha256','profile_dir','profile_hashes','jobs_dir'];
 if(!config||typeof config!=='object'||Array.isArray(config)||Object.keys(config).some(k=>!keys.includes(k))
  ||config.version!==1||config.extension_id!==PROTOCOL.extension_id||config.host_name!==PROTOCOL.host_name||config.profile_id!==PROFILE
  ||config.engine_version!==ENGINE_VERSION||!path.isAbsolute(config.engine_path||'')||!HASH.test(config.engine_sha256||'')
  ||!config.profile_hashes||Object.keys(config.profile_hashes).sort().join(',')!=='filament,machine,process')fail('Configuração local incompatível. Reinstale o conector.');
 config.engine_path=await regular(config.engine_path);
 if(sha256(await readFile(config.engine_path))!==config.engine_sha256)fail('O Bambu Studio foi atualizado. Reinstale o conector para conferir os perfis.');
 config.profile_dir=await privateChild(root,config.profile_dir,'profiles',true);config.jobs_dir=await privateChild(root,config.jobs_dir,'jobs',true);
 for(const kind of ['machine','process','filament']){
  const file=await privateChild(root,path.join(config.profile_dir,kind+'.json'),path.join('profiles',kind+'.json'));
  if(!HASH.test(config.profile_hashes[kind]||'')||sha256(await readFile(file))!==config.profile_hashes[kind])fail('O perfil local mudou. Reinstale o conector.');
 }
 return Object.freeze({...config,root,profile_hashes:Object.freeze({...config.profile_hashes})});
}

// A short exclusive guard serializes stale-PID recovery too. If recovery itself
// crashes, refuse the job until the installer checks it; never steal a live lock.
export async function acquireNativeLock(root){
 const guardPath=path.join(root,'native-lock.guard'),lockPath=path.join(root,'native-job.lock');let guard,lock;
 try{guard=await open(guardPath,'wx',0o600);}catch(error){if(error.code==='EEXIST')fail('Outra operação do fatiador está iniciando. Aguarde e tente novamente.');throw error;}
 try{
  await guard.writeFile(JSON.stringify({pid:process.pid}));
  try{lock=await open(lockPath,'wx',0o600);}catch(error){
   if(error.code!=='EEXIST')throw error;
   const info=await lstat(lockPath);if(!info.isFile()||info.isSymbolicLink()||info.size>4096)fail('A trava local precisa ser conferida. Reinstale o conector.');
   let previous;try{previous=JSON.parse(await readFile(lockPath,'utf8'));}catch{fail('A trava local precisa ser conferida. Reinstale o conector.');}
   if(!Number.isSafeInteger(previous.pid)||previous.pid<=0)fail('A trava local precisa ser conferida. Reinstale o conector.');
   try{process.kill(previous.pid,0);fail('O fatiador está em uso em outra janela. Aguarde a simulação atual.');}catch(error){if(error.code!=='ESRCH')throw error;}
   await rm(lockPath);lock=await open(lockPath,'wx',0o600);
  }
  const token=randomUUID();await lock.writeFile(JSON.stringify({pid:process.pid,token,started_at:new Date().toISOString()}));let released=false;
  return async()=>{if(released)return;released=true;await lock.close();const current=JSON.parse(await readFile(lockPath,'utf8').catch(()=>'{}'));if(current.token===token)await rm(lockPath,{force:true});};
 }finally{await guard.close();await rm(guardPath,{force:true});}
}

export function encodeNativeMessage(value){const body=Buffer.from(JSON.stringify(value));if(!body.length||body.length>FRAME_BYTES)fail('Resposta local acima do limite.');const header=Buffer.alloc(4);header.writeUInt32LE(body.length);return Buffer.concat([header,body]);}
export class NativeFrames{
 constructor(){this.pending=Buffer.alloc(0);}
 push(chunk){this.pending=Buffer.concat([this.pending,chunk]);const messages=[];
  while(this.pending.length>=4){const size=this.pending.readUInt32LE();if(!size||size>FRAME_BYTES)fail('Mensagem local acima do limite.');if(this.pending.length<4+size)break;
   const body=this.pending.subarray(4,4+size);if(!Buffer.from(body.toString('utf8')).equals(body))fail('Mensagem local inválida.');
   try{messages.push(JSON.parse(body.toString('utf8')));}catch{fail('Mensagem local inválida.');}this.pending=this.pending.subarray(4+size);
  }return messages;
 }
 end(){if(this.pending.length)fail('Mensagem local incompleta.');}
}

export class NativeSession{
 constructor(config,{simulate=runSimulation,timeoutMs=600000,onStop=()=>{},priority=lowerPriority}={}){
  this.config=config;this.simulate=simulate;this.timeoutMs=Math.min(timeoutMs,600000);this.onStop=onStop;this.priority=priority;this.state='idle';this.controller=new AbortController();this.parts=[];this.received=0;this.used=false;
  this.timer=setTimeout(()=>{this.close().finally(()=>this.onStop());},Math.min(30000,this.timeoutMs));this.timer.unref?.();
 }
 async handle(message){const request=validateRequest(message);if(this.state==='closed'&&request.op!=='cancel')fail('Esta operação local já foi encerrada. Abra uma nova conexão.');switch(request.op){
  case 'hello':return{name:'Forge • Fatiador local',profile_id:PROFILE,engine_version:ENGINE_VERSION,version:1,chunk_bytes:CHUNK_BYTES,max_file_bytes:MAX_FILE_BYTES};
  case 'begin':return this.begin(request);
  case 'chunk':return this.chunk(request);
  case 'slice':return this.slice();
  case 'read':return this.read(request);
  case 'finish':if(this.state!=='ready'&&!(this.state==='idle'&&!this.used))fail('Conclua a leitura do 3MF antes de encerrar.');await this.close();return{finished:true};
  case 'cancel':await this.close();return{cancelled:true};
  default:fail('Operação não permitida.');
 }}
 async begin(request){
  if(this.state!=='idle'||this.used)fail('Este conector aceita somente uma simulação por vez.');
  if(request.name.includes(':'))fail('Informe somente o nome do arquivo STL ou 3MF.');
  this.state='opening';
  try{this.release=await acquireNativeLock(this.config.root);}catch(error){this.state='idle';throw error;}
  if(this.controller.signal.aborted){await this.release();fail('Simulação interrompida.');}
  clearTimeout(this.timer);this.used=true;this.input=request;this.workspace=path.join(this.config.jobs_dir,randomUUID());this.deadline=Date.now()+this.timeoutMs;
  this.timer=setTimeout(()=>{this.close().finally(()=>this.onStop());},this.timeoutMs);this.timer.unref?.();this.state='uploading';
  return{accepted:true,chunk_bytes:CHUNK_BYTES,chunks:Math.ceil(request.size/CHUNK_BYTES)};
 }
 chunk(request){
  if(this.state!=='uploading')fail('Inicie o envio do arquivo antes dos blocos.');
  if(request.part!==this.parts.length||this.received>=this.input.size)fail('Envie os blocos na sequência confirmada pelo conector.');
  const expected=Math.min(CHUNK_BYTES,this.input.size-this.received),bytes=Buffer.from(request.base64,'base64');
  if(bytes.length!==expected||bytes.toString('base64')!==request.base64)fail('O tamanho do bloco enviado não confere com o arquivo.');
  this.parts.push(bytes);this.received+=bytes.length;return{part:request.part,received:this.received};
 }
 async slice(){
  if(this.state!=='uploading'||this.received!==this.input.size)fail('Envie todos os blocos do arquivo antes de fatiar.');
  const source=Buffer.concat(this.parts,this.received);this.parts=[];
  if(sha256(source)!==this.input.sha256){await this.close();fail('O SHA-256 do arquivo enviado não confere. Envie o arquivo novamente.');}
  this.state='slicing';
  try{
   if(sha256(await readFile(this.config.engine_path))!==this.config.engine_sha256)fail('O Bambu Studio mudou desde a instalação. Reinstale o conector.');
   this.running=this.simulate({enginePath:this.config.engine_path,profileDir:this.config.profile_dir,profileHashes:this.config.profile_hashes,source,
    extension:path.extname(this.input.name).slice(1).toLowerCase(),workspace:this.workspace,timeoutMs:Math.max(1,this.deadline-Date.now()),signal:this.controller.signal,
    onChild:child=>{this.child=child;if(child.pid){try{this.priority(child.pid);}catch(error){child.kill();throw error;}}}});
   const result=await this.running;
   if(this.controller.signal.aborted)fail('Simulação interrompida.');
   if(!Buffer.isBuffer(result.output)||!result.output.length||result.output.length>MAX_FILE_BYTES||result.stats?.profile_id!==PROFILE||result.stats?.engine_version!==ENGINE_VERSION
    ||result.stats.input_sha256!==this.input.sha256||result.stats.output_sha256!==sha256(result.output))fail('O motor local não confirmou a integridade do resultado.');
   this.output=result.output;this.stats=result.stats;this.state='ready';
   return{file_name:path.basename(this.input.name,path.extname(this.input.name))+'-fatiado.3mf',size:this.output.length,sha256:sha256(this.output),chunks:Math.ceil(this.output.length/CHUNK_BYTES),stats:this.stats};
  }catch(error){this.running=null;await this.close();throw error;}finally{this.running=null;this.child=null;}
 }
 read(request){if(this.state!=='ready')fail('Aguarde o resultado do fatiamento.');const start=request.part*CHUNK_BYTES;if(start>=this.output.length)fail('Bloco de resultado inexistente.');return{part:request.part,base64:this.output.subarray(start,start+CHUNK_BYTES).toString('base64')};}
 async close(){
  if(this.closing)return this.closing;
  this.state='closed';clearTimeout(this.timer);this.controller.abort();this.child?.kill();
  this.closing=(async()=>{await this.running?.catch(()=>{});this.parts=[];this.output=null;try{if(this.workspace)await safeRemoveJob(this.config.jobs_dir,this.workspace);}finally{await this.release?.();}})();
  return this.closing;
 }
}

export function serveNative(config,{input=process.stdin,output=process.stdout,simulate,timeoutMs,priority=lowerPriority}={}){
 const frames=new NativeFrames();let chain=Promise.resolve(),writes=Promise.resolve(),stopping=false,pending=false;
 const write=value=>{writes=writes.then(()=>new Promise((resolve,reject)=>output.write(encodeNativeMessage(value),error=>error?reject(error):resolve())));return writes;};
 const stop=async()=>{if(stopping)return;stopping=true;input.pause();await session.close();await writes.catch(()=>{});input.destroy();};
 const session=new NativeSession(config,{simulate,timeoutMs,priority,onStop:()=>void stop()});
 const dispatch=async request=>{try{const result=await session.handle(request);await write({id:request.id,ok:true,...result});}catch(error){await write({id:typeof request?.id==='string'?request.id:'invalid',ok:false,error:publicError(error)});}
  if(['finish','cancel'].includes(request?.op)||session.state==='closed')await stop();};
 input.on('data',chunk=>{try{for(const request of frames.push(chunk)){if(stopping)return;if(request?.op==='cancel')void dispatch(request).catch(()=>stop());else{if(pending){void stop();return;}pending=true;chain=chain.then(()=>dispatch(request)).catch(()=>stop()).finally(()=>{pending=false;});}}}catch{void stop();}});
 input.once('end',()=>{try{frames.end();}catch{}void stop();});input.once('error',()=>void stop());output.once('error',()=>void stop());
 return{session,close:stop,settled:()=>Promise.all([chain,writes])};
}

async function main(){
 const args=process.argv.slice(2),index=args.indexOf('--config'),origin=args[index+2];
 if(index!==0||args.length!==3||origin!==`chrome-extension://${PROTOCOL.extension_id}/`)fail('O conector deve ser aberto pela extensão oficial do Forge.');
 lowerPriority();const config=await loadNativeConfig(args[1]);const host=serveNative(config);
 process.once('SIGTERM',()=>void host.close());process.once('SIGINT',()=>void host.close());
}
if(typeof FORGE_NATIVE_LIBRARY==='undefined'&&process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{process.stderr.write(publicError(error)+'\n');process.exitCode=1;});
