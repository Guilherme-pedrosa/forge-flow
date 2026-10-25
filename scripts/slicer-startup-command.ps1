function New-ForgeSlicerStartupCommand {
  param(
    [Parameter(Mandatory=$true)][string]$NodePath,
    [Parameter(Mandatory=$true)][string]$WorkerScript,
    [Parameter(Mandatory=$true)][string]$ConfigPath,
    [Parameter(Mandatory=$true)][string]$InstallDir
  )
  if (($NodePath + $WorkerScript + $ConfigPath + $InstallDir) -match '["\r\n]') { throw 'Caminho de instalação inválido.' }
  $workerArgs = '"' + $WorkerScript + '" --config "' + $ConfigPath + '"'
  $command = '$ErrorActionPreference = ''Stop''; $env:PSModulePath = [System.IO.Path]::Combine($PSHOME, ''Modules''); try { ' + "Start-Process -FilePath '" + $NodePath.Replace("'", "''") + "' -ArgumentList '" + $workerArgs.Replace("'", "''") + "' -WindowStyle Hidden -WorkingDirectory '" + $InstallDir.Replace("'", "''") + "' -RedirectStandardOutput '" + (Join-Path $InstallDir 'worker.log').Replace("'", "''") + "' -RedirectStandardError '" + (Join-Path $InstallDir 'worker-error.log').Replace("'", "''") + "' | Out-Null } catch { [System.IO.File]::WriteAllText('" + (Join-Path $InstallDir 'startup-error.log').Replace("'", "''") + "', " + '$_.Exception.Message); exit 1 }'
  # Only executable/config paths enter this command, never the connection token.
  # Restricted permits individual commands, while -File would block our launcher.
  $encoded = [Convert]::ToBase64String([System.Text.Encoding]::Unicode.GetBytes($command))
  return @{ Command=$command; Arguments=('-NoProfile -NonInteractive -WindowStyle Hidden -EncodedCommand ' + $encoded) }
}
