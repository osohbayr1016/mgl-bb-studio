# Run an MglBbStudio gate op in the private harness Revit (loads the freshly built plugin DLL from bytes).
param(
  [Parameter(Mandatory = $true)][string]$Run,
  [Parameter(Mandatory = $true)][string]$Id,
  [Parameter(Mandatory = $true)][string]$GateArgs,
  [string]$Dll = '',
  [int]$TimeoutSec = 1500
)
if (-not $Dll) { $Dll = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) '..\..\src\MglBbStudio\bin\x64\Release R24\MglBbStudio.dll' }
$Dll = [IO.Path]::GetFullPath($Dll)
$cmd = @("id=$Id", "dll=$Dll", 'type=MglBb.Gate.Entry', 'method=Run', "args=$GateArgs")
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
exit 1
