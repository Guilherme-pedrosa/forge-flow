import { mkdir, readFile, writeFile, copyFile, realpath, lstat } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { PROTOCOL } from '../extensions/forge-slicer/protocol.js';
import { ENGINE_VERSION, PROFILE, sha256, resolveOfficialProfiles, runSimulation, verificationCube, safeRemoveJob } from './forge-slicer-worker.mjs';
import { acquireNativeLock, lowerPriority } from './forge-slicer-native-host.mjs';

const fail=message=>{throw new Error(message);};
const quote=value=>"'"+value.replaceAll("'","''")+"'";
const command=(executable,args)=>{const env=/powershell[.]exe$/i.test(executable)?{...process.env,PSModulePath:path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','Modules')}:process.env;
 const result=spawnSync(executable,args,{encoding:'utf8',windowsHide:true,shell:false,timeout:30000,env});if(result.error||result.status!==0)fail('Não foi possível configurar o conector local no Windows.');return result.stdout.trim();};
export function nativeInstallReview({baseDirectory=process.env.LOCALAPPDATA,enginePath='C:\\Program Files\\Bambu Studio\\bambu-studio.exe'}={}){
 return{mode:'review_only',install_directory:path.join(baseDirectory||'', 'Elevare3D','ForgeSlicerNative'),node_path:process.execPath,engine_path:enginePath,
  extension_id:PROTOCOL.extension_id,host_name:PROTOCOL.host_name,registry_keys:['Google\\Chrome','Microsoft\\Edge'].map(browser=>`HKCU\\Software\\${browser}\\NativeMessagingHosts\\${PROTOCOL.host_name}`),
  verifies_engine_offline:true,private_files:true,startup_task:false,background_service:false,network_listener:false};
}
export function nativeManifest(launcher){return{name:PROTOCOL.host_name,description:'Forge • Fatiador local sob demanda',path:launcher,type:'stdio',allowed_origins:[`chrome-extension://${PROTOCOL.extension_id}/`]};}
export function nativeLauncher(node,host,config){
 const safe=value=>{if(/["\r\n]/.test(value))fail('Caminho de instalação inválido.');return value.replaceAll('%','%%');};
 return`@echo off\r\nsetlocal DisableDelayedExpansion\r\n"${safe(node)}" "${safe(host)}" --config "${safe(config)}" "%~1"\r\nexit /b %errorlevel%\r\n`;
}
export async function protectNativePaths(paths){
 const powershell=path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
 const script=`$ErrorActionPreference='Stop';$sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User;$paths=@(${paths.map(quote).join(',')});foreach($p in $paths){$isDir=[System.IO.Directory]::Exists($p);if($isDir){$acl=New-Object System.Security.AccessControl.DirectorySecurity}else{$acl=New-Object System.Security.AccessControl.FileSecurity};$acl.SetAccessRuleProtection($true,$false);foreach($identity in @($sid,(New-Object System.Security.Principal.SecurityIdentifier('S-1-5-18')),(New-Object System.Security.Principal.SecurityIdentifier('S-1-5-32-544')))){if($isDir){$rule=New-Object System.Security.AccessControl.FileSystemAccessRule($identity,'FullControl','ContainerInherit,ObjectInherit','None','Allow')}else{$rule=New-Object System.Security.AccessControl.FileSystemAccessRule($identity,'FullControl','Allow')};$acl.AddAccessRule($rule)};Set-Acl -LiteralPath $p -AclObject $acl}`;
 command(powershell,['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')]);
}
export function registerNativeManifest(manifest){
 const reg=path.join(process.env.SystemRoot||'C:\\Windows','System32','reg.exe');
 for(const browser of ['Google\\Chrome','Microsoft\\Edge'])command(reg,['ADD',`HKCU\\Software\\${browser}\\NativeMessagingHosts\\${PROTOCOL.host_name}`,'/ve','/t','REG_SZ','/d',manifest,'/f']);
}
async function noLink(filename,directory=false){try{const info=await lstat(filename);if(info.isSymbolicLink()||(directory?!info.isDirectory():!info.isFile()))fail('A pasta de instalação contém um link ou arquivo inesperado.');}catch(error){if(error.code!=='ENOENT')throw error;}}

export async function installSlicerExtension({baseDirectory=process.env.LOCALAPPDATA,enginePath='C:\\Program Files\\Bambu Studio\\bambu-studio.exe',
 packageDirectory=path.dirname(fileURLToPath(import.meta.url)),register=true}={},
 {protect=protectNativePaths,verify=runSimulation,resolveProfiles=resolveOfficialProfiles,registerManifest=registerNativeManifest,priority=lowerPriority,platform=process.platform}={}){
 if(platform!=='win32')fail('Este conector requer Windows, Node.js 22+ e Bambu Studio oficial 2.8.2.61.');
 if(!baseDirectory||!path.isAbsolute(baseDirectory))fail('Não foi possível localizar a pasta local do usuário.');
 await mkdir(baseDirectory,{recursive:true});const base=realpathSync.native(baseDirectory),logical=path.join(baseDirectory,'Elevare3D','ForgeSlicerNative');
 await noLink(logical,true);await mkdir(logical,{recursive:true});const install=realpathSync.native(logical),relative=path.relative(base,install).replaceAll('\\','/');
 if(!/^(?:Packages\/[^/]+\/LocalCache\/Local\/)?Elevare3D\/ForgeSlicerNative$/.test(relative))fail('Pasta de instalação fora do destino local previsto.');
 await protect([install]);const release=await acquireNativeLock(install);
 try{
  const profileDir=path.join(install,'profiles'),jobsDir=path.join(install,'jobs');for(const folder of [profileDir,jobsDir]){await noLink(folder,true);await mkdir(folder,{recursive:true});if(realpathSync.native(folder)!==folder)fail('Pasta privada fora do destino previsto.');}
  await protect([profileDir,jobsDir]);const node=realpathSync.native(process.execPath),engine=realpathSync.native(enginePath);
  const engineInfo=await lstat(engine);if(!engineInfo.isFile()||engineInfo.isSymbolicLink())fail('Selecione a instalação oficial do Bambu Studio.');
  const engineHash=sha256(await readFile(engine));
  for(const kind of ['machine','process','filament'])await noLink(path.join(profileDir,kind+'.json'));
  const hashes=await resolveProfiles(engine,profileDir),workspace=path.join(jobsDir,randomUUID());let verification;
  try{verification=await verify({enginePath:engine,profileDir,profileHashes:hashes,source:verificationCube(),extension:'stl',workspace,
   onChild:child=>{if(child.pid)priority(child.pid);}});}finally{await safeRemoveJob(jobsDir,workspace);}
  if(verification.stats?.engine_version!==ENGINE_VERSION||verification.stats?.profile_id!==PROFILE)fail('Use o Bambu Studio oficial 2.8.2.61 com o perfil A1/PLA 0,20mm.');
  if(sha256(await readFile(engine))!==engineHash)fail('O Bambu Studio mudou durante a verificação. Execute a instalação novamente.');
  const host=path.join(install,'forge-slicer-native-host.mjs'),config=path.join(install,'native.private.json'),launcher=path.join(install,'forge-slicer-native.bat'),manifest=path.join(install,PROTOCOL.host_name+'.json');
  for(const file of [host,config,launcher,manifest,...['machine','process','filament'].map(k=>path.join(profileDir,k+'.json'))])await noLink(file);
  await copyFile(path.join(packageDirectory,'native','forge-slicer-native-host.mjs'),host);
  await writeFile(config,JSON.stringify({version:1,extension_id:PROTOCOL.extension_id,host_name:PROTOCOL.host_name,profile_id:PROFILE,engine_version:ENGINE_VERSION,
   engine_path:engine,engine_sha256:engineHash,profile_dir:profileDir,profile_hashes:hashes,jobs_dir:jobsDir},null,2),{mode:0o600});
  await writeFile(launcher,nativeLauncher(node,host,config),{mode:0o600});await writeFile(manifest,JSON.stringify(nativeManifest(launcher),null,2),{mode:0o600});
  await protect([host,config,launcher,manifest,...['machine','process','filament'].map(k=>path.join(profileDir,k+'.json'))]);
  if(register)registerManifest(manifest);
  return{install_directory:install,manifest,extension_id:PROTOCOL.extension_id,profile_id:PROFILE,engine_version:ENGINE_VERSION};
 }finally{await release();}
}
async function main(){
 if(Number(process.versions.node.split('.')[0])<22)fail('Instale o Node.js 22 ou mais recente.');
 const args=process.argv.slice(2);if(args.length===1&&args[0]==='--review'){console.log(JSON.stringify(nativeInstallReview(),null,2));return;}
 if(args.length&&!(args.length===2&&args[0]==='--engine'))fail('Use node install-slicer-extension.mjs [--review | --engine caminho-do-Bambu-Studio].');
 const result=await installSlicerExtension({...(args.length?{enginePath:args[1]}:{})});
 console.log('Conector local instalado para Chrome e Edge. Carregue em chrome://extensions a pasta extraída que contém manifest.json e abra o Forge. O fatiador inicia e encerra a cada solicitação.');
 console.log('Pasta privada: '+result.install_directory);
}
if(typeof FORGE_INSTALLER_LIBRARY==='undefined'&&process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(error.code?'Não foi possível acessar os arquivos locais. Confira o Bambu Studio e o pacote completo.':error.message);process.exitCode=1;});
