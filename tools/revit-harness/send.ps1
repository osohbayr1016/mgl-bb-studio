# Queue a probe command and wait for its result.
param(
  [Parameter(Mandatory = $true)][string]$Run,
  [Parameter(Mandatory = $true)][string]$Id,
  [string]$Dll = '',
  [string]$Op = '',
  [string]$File = '',
  [string]$ProbeArgs = '',
  [int]$TimeoutSec = 900
)
$cmd = @("id=$Id")
if ($Op) { $cmd += "op=$Op" }
if ($File) { $cmd += "file=$File" }
if ($Dll) { $cmd += "dll=$Dll"; $cmd += 'type=Probe.Entry'; $cmd += 'method=Run' }
if ($ProbeArgs) { $cmd += "args=$ProbeArgs" }
$res = Join-Path $Run "out\$Id.result.txt"
if (Test-Path $res) { Remove-Item $res }
$tmp = Join-Path $Run "cmd\$Id.tmp"
[IO.File]::WriteAllLines($tmp, $cmd, (New-Object Text.UTF8Encoding($false)))
Move-Item $tmp (Join-Path $Run "cmd\$Id.cmd") -Force
$deadline = (Get-Date).AddSeconds($TimeoutSec)
while ((Get-Date) -lt $deadline) {
  Start-Sleep -Milliseconds 800
  if (Test-Path $res) { Start-Sleep -Milliseconds 300; Get-Content $res -Encoding UTF8; exit 0 }
}
Write-Host "TIMEOUT waiting for $Id"
if (Test-Path (Join-Path $Run 'dialogs.log')) { Get-Content (Join-Path $Run 'dialogs.log') -Tail 10 }
exit 1
