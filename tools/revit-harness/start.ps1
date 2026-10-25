# Start a PRIVATE Revit with the probe harness and (optionally) a model on the command line.
# Refuses if Revit <Year> is already running.  Removes the temporary manifest as soon as the harness has loaded.
param(
  [string]$Year = '2024',
  [Parameter(Mandatory = $true)][string]$Run,
  [string]$Model = '',
  # Start a second, separate Revit <Year> process next to the user's (never touches it; the harness add-in is inert in the user's
  # process because MGL_BB_HARNESS_DIR is set only for ours, and the user's process read its add-ins long ago).
  [switch]$Beside
)
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$revitExe = "C:\Program Files\Autodesk\Revit $Year\Revit.exe"
$busy = @(Get-Process -Name Revit -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path -like "*Revit $Year*" })
if ($busy.Count -gt 0 -and -not $Beside) { Write-Host "NOT RUN - Revit $Year already running (PID $($busy[0].Id))"; exit 3 }
New-Item -ItemType Directory -Force -Path (Join-Path $Run 'bin') | Out-Null
Copy-Item -Path (Join-Path $here "bin\$Year\*") -Destination (Join-Path $Run 'bin') -Force
$dll = Join-Path $Run 'bin\MglBbHarness.dll'
$addinsDir = Join-Path $env:APPDATA "Autodesk\Revit\Addins\$Year"
$manifest = Join-Path $addinsDir 'MglBbHarness.addin'
$xml = @"
<?xml version="1.0" encoding="utf-8"?>
<RevitAddIns>
  <AddIn Type="Application">
    <Name>MGL BB probe harness (TEST ONLY)</Name>
    <Assembly>$dll</Assembly>
    <AddInId>3C5A9E21-6D4B-4F7A-8E19-2B7D0C4A6F93</AddInId>
    <FullClassName>MglBbHarness.App</FullClassName>
    <VendorId>MGL</VendorId>
    <VendorDescription>MGL test harness - inert without MGL_BB_HARNESS_DIR</VendorDescription>
  </AddIn>
</RevitAddIns>
"@
[IO.File]::WriteAllText($manifest, $xml, (New-Object Text.UTF8Encoding($false)))
$env:MGL_BB_HARNESS_DIR = $Run
$args2 = @()
if ($Model) { $args2 += ('"' + $Model + '"') }
if ($args2.Count -gt 0) { $revit = Start-Process -FilePath $revitExe -ArgumentList $args2 -PassThru -WindowStyle Minimized }
else { $revit = Start-Process -FilePath $revitExe -PassThru -WindowStyle Minimized }
Remove-Item Env:\MGL_BB_HARNESS_DIR
Write-Host "Revit $Year PID $($revit.Id)"
$stop = Join-Path $Run 'watch.STOP'
if (Test-Path $stop) { Remove-Item $stop }
$watch = Start-Process -FilePath 'powershell.exe' -WindowStyle Hidden -PassThru -ArgumentList @(
  '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"' + (Join-Path $here 'dialog-watch.ps1') + '"'),
  '-RevitPid', $revit.Id, '-Log', ('"' + (Join-Path $Run 'dialogs.log') + '"'), '-Stop', ('"' + $stop + '"'))
Set-Content -Path (Join-Path $Run 'pids.txt') -Value "$($revit.Id) $($watch.Id)"
$deadline = (Get-Date).AddMinutes(6)
while ((Get-Date) -lt $deadline) {
  Start-Sleep -Seconds 2
  $log = Join-Path $Run 'harness.log'
  if ((Test-Path $log) -and ((Get-Content $log -Raw) -match 'OnStartup')) { break }
}
Remove-Item -Force $manifest -ErrorAction SilentlyContinue
Write-Host 'manifest removed'
if (Test-Path (Join-Path $Run 'harness.log')) { Get-Content (Join-Path $Run 'harness.log') }
