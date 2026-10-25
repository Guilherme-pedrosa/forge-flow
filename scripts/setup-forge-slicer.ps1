param(
  [Parameter(Mandatory=$true)][string]$ConnectionFile,
  [string]$EnginePath = 'C:\Program Files\Bambu Studio\bambu-studio.exe',
  [string]$NodePath = (Get-Command node -ErrorAction Stop).Source,
  [string]$InstallDirectory = '',
  [switch]$Start,
  [switch]$RegisterStartup
)
$ErrorActionPreference = 'Stop'
# PowerShell 7 exports module paths incompatible with Windows PowerShell 5.
# Restrict only this installer process to the built-in Windows module directory.
if ($PSVersionTable.PSEdition -eq 'Desktop') { $env:PSModulePath = [System.IO.Path]::Combine($PSHOME, 'Modules') }
$workerOrigin = 'https://gaomleftwxpzjivrnzjk.supabase.co'
$installDir = if ($InstallDirectory) { $InstallDirectory } else { Join-Path $env:LOCALAPPDATA 'Elevare3D\ForgeSlicer' }
if (!(Test-Path -LiteralPath $EnginePath -PathType Leaf) -or !(Test-Path -LiteralPath $NodePath -PathType Leaf)) {
  throw 'Instale o Bambu Studio oficial 2.8.2.61 e o Node.js 22 ou mais recente.'
}

# Local ACLs are set before writing any token or transferred model to this folder.
New-Item -ItemType Directory -Path $installDir -Force | Out-Null
# Resolve MSIX/AppX filesystem redirection now: a logon task runs outside the
# installer host and must use physical paths rather than virtual LOCALAPPDATA.
$pathProbe = @'
const fs=require('node:fs'),path=require('node:path');
const canonical=fs.realpathSync.native;
const base=canonical(process.argv[1]),install=canonical(process.argv[2]);
const relative=path.relative(base,install).replaceAll('\\','/');
if(!/^(?:Packages\/[^/]+\/LocalCache\/Local\/)?Elevare3D\/ForgeSlicer$/.test(relative))throw new Error('Install directory outside the intended local application folder.');
console.log(JSON.stringify({install_dir:install,node_path:canonical(process.execPath),engine_path:canonical(process.argv[3])}));
'@
$physicalJson = & $NodePath -e $pathProbe $env:LOCALAPPDATA $installDir $EnginePath
if ($LASTEXITCODE -ne 0) { throw 'Não foi possível resolver a pasta física privada do fatiador.' }
$physical = $physicalJson | ConvertFrom-Json
$installDir = $physical.install_dir; $NodePath = $physical.node_path; $EnginePath = $physical.engine_path
$workerScript = Join-Path $installDir 'forge-slicer-worker.mjs'
$configPath = Join-Path $installDir 'connection.private.json'
$profileDir = Join-Path $installDir 'profiles'
$jobsDir = Join-Path $installDir 'jobs'
$currentSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
& icacls.exe $installDir '/inheritance:r' '/grant:r' "*${currentSid}:(OI)(CI)F" '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Não foi possível proteger a pasta privada do fatiador.' }

$connection = Get-Content -LiteralPath $ConnectionFile -Raw | ConvertFrom-Json
if ($connection.api_origin -cne $workerOrigin -or $connection.worker_id -notmatch '^[0-9a-f-]{36}$' -or
    $connection.worker_token -notmatch '^[0-9a-f]{64}$' -or $connection.public_key.Length -lt 20) {
  throw 'Arquivo de conexão inválido. Gere uma conexão nova dentro do Forge.'
}
$nodeVersion = & $NodePath --version
if ($LASTEXITCODE -ne 0 -or $nodeVersion -notmatch '^v(\d+)\.' -or [int]$Matches[1] -lt 22) { throw 'Use Node.js 22 ou mais recente.' }
if (Test-Path -LiteralPath (Join-Path $installDir 'worker.lock')) {
  $previous = Get-Content -LiteralPath (Join-Path $installDir 'worker.lock') -Raw | ConvertFrom-Json
  if (Get-Process -Id $previous.pid -ErrorAction SilentlyContinue) { throw 'Feche o fatiador anterior antes de atualizar a configuração.' }
}
$sourceScript = Join-Path $PSScriptRoot 'forge-slicer-worker.mjs'
if (!(Test-Path -LiteralPath $sourceScript)) { throw 'Baixe o pacote completo dist/worker gerado por build:worker.' }
Copy-Item -LiteralPath $sourceScript -Destination $workerScript -Force
New-Item -ItemType Directory -Path $profileDir,$jobsDir -Force | Out-Null
$profileOutput = & $NodePath $workerScript --resolve-profiles --engine $EnginePath --profiles $profileDir
if ($LASTEXITCODE -ne 0) { throw 'Não foi possível preparar os perfis oficiais do Bambu Studio.' }
$resolved = $profileOutput | ConvertFrom-Json
$privateConfig = @{
  api_origin=$workerOrigin; public_key=$connection.public_key; worker_id=$connection.worker_id; worker_token=$connection.worker_token;
  engine_path=(Resolve-Path -LiteralPath $EnginePath).Path; engine_sha256=(Get-FileHash -LiteralPath $EnginePath -Algorithm SHA256).Hash.ToLowerInvariant();
  profile_dir=$profileDir; profile_hashes=$resolved.profile_hashes; jobs_dir=$jobsDir
}
[System.IO.File]::WriteAllText($configPath, ($privateConfig | ConvertTo-Json -Depth 5), [System.Text.UTF8Encoding]::new($false))
$connection = $null; $privateConfig = $null
# The official Windows launcher has no version resource. Verify the actual engine
# by slicing a synthetic cube offline and checking its native slice_info version.
$verificationDir = Join-Path $jobsDir ([guid]::NewGuid().ToString())
$verification = & $NodePath $workerScript --verify-engine --config $configPath --workspace $verificationDir
if ($LASTEXITCODE -ne 0) {
  Remove-Item -LiteralPath $configPath -Force
  throw 'A verificação real do Bambu Studio falhou. Use a versão oficial 2.8.2.61 com os perfis A1.'
}
$verificationResult = $verification | ConvertFrom-Json
if ($verificationResult.engine_version -cne '02.08.02.61') { throw 'Versão inesperada do motor de fatiamento.' }

# The installer can use Bypass for this process only. Startup never loads a .ps1.
. (Join-Path $PSScriptRoot 'slicer-startup-command.ps1')
$startup = New-ForgeSlicerStartupCommand -NodePath $NodePath -WorkerScript $workerScript -ConfigPath $configPath -InstallDir $installDir
$launcherPath = Join-Path $installDir 'start-forge-slicer.ps1'
[System.IO.File]::WriteAllText($launcherPath, $startup.Command, [System.Text.UTF8Encoding]::new($false))
if ($RegisterStartup) {
  $action = New-ScheduledTaskAction -Execute (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe') -Argument $startup.Arguments
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name)
  $settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
  Register-ScheduledTask -TaskName 'Elevare3D Forge Slicer' -Action $action -Trigger $trigger -Settings $settings -RunLevel Limited -Force | Out-Null
}
if ($Start) {
  & ([scriptblock]::Create($startup.Command))
}
Write-Output 'Fatiador local configurado. A chave está somente no arquivo privado de conexão.'
Write-Output 'O arquivo de conexão baixado pode ser removido depois da instalação.'
