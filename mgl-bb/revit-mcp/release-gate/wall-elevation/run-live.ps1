# Wall Elevation release gate - LIVE Revit run (one Revit year per call).
#
#   powershell -ExecutionPolicy Bypass -File run-live.ps1 -Year 2024 -Phase models
#
# What it does (and only this):
#   1. Refuses to run if Revit <Year> is already running (that is the user's session - never touched).
#   2. Builds the LiveGate test add-in (against the INSTALLED Revit API) and the GUI driver.
#   3. Creates a fresh run folder %LOCALAPPDATA%\MGL\WeGate\<Year>\<stamp>\ (all test models live there).
#   4. Installs a TEMPORARY add-in manifest (MglWallElevationGate.addin) pointing at a copy of the test add-in
#      inside the run folder. The add-in is inert in any Revit process without MGL_WE_GATE_JOB.
#   5. Starts Revit <Year> with MGL_WE_GATE_JOB set (only for that child process) and the driver bound to its PID.
#   6. Waits for <run>\DONE (or the timeout), then kills ONLY the Revit/driver PIDs it started.
#   7. Always removes the temporary manifest.
#
# Never opens production files, never saves outside the run folder.  ASCII-only on purpose (PowerShell 5.1).

param(
  [Parameter(Mandatory = $true)][ValidateSet('2024', '2025', '2026', '2027')][string]$Year,
  [ValidateSet('models', 'scenarios', 'all')][string]$Phase = 'models',
  [string]$Scenarios = '*',
  [int]$TimeoutMin = 40,
  [switch]$NoBuild,
  [switch]$KeepRevit
)

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$repo = (Resolve-Path (Join-Path $here '..\..')).Path            # revit-mcp
$gateProj = Join-Path $repo 'tests\WallElevation.LiveGate\WallElevation.LiveGate.csproj'
$drvProj = Join-Path $repo 'tests\WallElevation.LiveGate.Driver\WallElevation.LiveGate.Driver.csproj'
$revitExe = "C:\Program Files\Autodesk\Revit $Year\Revit.exe"
$template = "C:\ProgramData\Autodesk\RVT $Year\Templates\Default_M_ENU.rte"
# Revit 2027 ships an almost empty local library - the 2024 library (metric families) is loaded and upgraded.
$library = 'C:\ProgramData\Autodesk\RVT 2024\Libraries\English\US'
$addinsDir = Join-Path $env:APPDATA "Autodesk\Revit\Addins\$Year"
$manifest = Join-Path $addinsDir 'MglWallElevationGate.addin'
$addinId = '6F2B4E0A-9C1D-4B8E-A7F3-2D5C8E1B9A40'

function Say($m) { Write-Host ("[run-live $Year] " + $m) }

if (-not (Test-Path $revitExe)) { Say "NOT RUN - Revit $Year is not installed ($revitExe)"; exit 3 }
if (-not (Test-Path $template)) { Say "NOT RUN - template missing: $template"; exit 3 }
$busy = @(Get-Process -Name Revit -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path -like "*Revit $Year*" })
if ($busy.Count -gt 0) { Say "NOT RUN - Revit $Year is already running (PID $($busy[0].Id)); close it first - the gate never touches a user session"; exit 3 }

if (-not $NoBuild) {
  Say 'building LiveGate add-in and driver'
  & dotnet build $gateProj -c Release "-p:RevitYear=$Year" -p:Platform=x64 -v q -nologo | Out-Host
  if ($LASTEXITCODE -ne 0) { Say 'FAIL - LiveGate build failed'; exit 2 }
  & dotnet build $drvProj -c Release -v q -nologo | Out-Host
  if ($LASTEXITCODE -ne 0) { Say 'FAIL - driver build failed'; exit 2 }
}
$gateBin = Join-Path $repo "tests\WallElevation.LiveGate\bin\$Year"
$drvExe = Join-Path $repo 'tests\WallElevation.LiveGate.Driver\bin\Release\net10.0-windows\MglWeGateDriver.exe'

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$run = Join-Path $env:LOCALAPPDATA "MGL\WeGate\$Year\$stamp"
New-Item -ItemType Directory -Force -Path (Join-Path $run 'gate') | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $run 'driver') | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $run 'models') | Out-Null
Copy-Item -Path (Join-Path $gateBin '*') -Destination (Join-Path $run 'gate') -Recurse -Force
$gateDll = Join-Path $run 'gate\MglWallElevationLiveGate.dll'

$job = @(
  "run_dir=$run",
  "year=$Year",
  "template=$template",
  "library=$library",
  "models_dir=$(Join-Path $run 'models')",
  "phase=$Phase",
  "scenarios=$Scenarios",
  "exit=$(if ($KeepRevit) { '0' } else { '1' })"
)
$jobFile = Join-Path $run 'job.ini'
[IO.File]::WriteAllLines($jobFile, $job, (New-Object Text.UTF8Encoding($false)))

$xml = @"
<?xml version="1.0" encoding="utf-8"?>
<RevitAddIns>
  <AddIn Type="Application">
    <Name>MGL Wall Elevation release gate (TEST ONLY)</Name>
    <Assembly>$gateDll</Assembly>
    <AddInId>$addinId</AddInId>
    <FullClassName>MglWeGate.GateApp</FullClassName>
    <VendorId>MGL</VendorId>
    <VendorDescription>MGL test harness - inert without MGL_WE_GATE_JOB</VendorDescription>
  </AddIn>
</RevitAddIns>
"@

$revit = $null; $driver = $null
# The production add-in remembers window positions in the user's OWN ui-prefs.json (one per Windows user, shared by every Revit
# year).  The test Revit must not leave its positions behind (2026-10-16: a result-window position saved by a gate run later sat
# in the middle of the drawing area).  Backed up here, restored only after the test Revit has exited (windows save on close).
$uiPrefs = Join-Path $env:APPDATA 'RevitMcpAddin\ui-prefs.json'
$uiBackup = Join-Path $run 'user-ui-prefs.json.bak'
$uiExisted = Test-Path $uiPrefs
if ($uiExisted) { Copy-Item -Force -Path $uiPrefs -Destination $uiBackup }
try {
  New-Item -ItemType Directory -Force -Path $addinsDir | Out-Null
  [IO.File]::WriteAllText($manifest, $xml, (New-Object Text.UTF8Encoding($false)))
  Say "run folder: $run"
  $env:MGL_WE_GATE_JOB = $jobFile
  $revit = Start-Process -FilePath $revitExe -PassThru
  Remove-Item Env:\MGL_WE_GATE_JOB
  Say "Revit $Year started, PID $($revit.Id)"
  $journalDir = Join-Path $env:LOCALAPPDATA "Autodesk\Revit\Autodesk Revit $Year\Journals"
  $driver = Start-Process -FilePath $drvExe -ArgumentList @('--pid', $revit.Id, '--dir', (Join-Path $run 'driver'), '--journal-dir', ('"' + $journalDir + '"')) -PassThru -WindowStyle Hidden
  Say "driver PID $($driver.Id)"

  $deadline = (Get-Date).AddMinutes($TimeoutMin)
  $doneAt = $null
  $escapedAt = $null
  $heartbeat = Join-Path $run 'heartbeat'
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 3
    $revit.Refresh()
    if ($revit.HasExited) { Say "Revit exited (code $($revit.ExitCode))"; break }
    # Stall guard: the gate writes 'heartbeat' every ~2 s from its ExternalEvent.  A Revit tool left active (e.g. a keyboard shortcut
    # typed by a person into the test Revit) blocks ExternalEvents and the production background job -> ask the driver for ESC x2 once,
    # then give up after a second long silence instead of hanging until the timeout.
    $busyFile = Join-Path $run 'driver\busy'
    $driverBusy = (Test-Path $busyFile) -and (((Get-Date) - (Get-Item $busyFile).LastWriteTime).TotalMinutes -lt 20)
    if ($driverBusy) { $escapedAt = $null }
    if (-not $driverBusy -and (Test-Path $heartbeat) -and -not (Test-Path (Join-Path $run 'DONE'))) {
      $age = ((Get-Date) - (Get-Item $heartbeat).LastWriteTime).TotalSeconds
      if ($age -gt 150 -and -not $escapedAt) { New-Item -ItemType File -Force -Path (Join-Path $run 'driver\ESCAPE') | Out-Null; $escapedAt = Get-Date; Say "gate silent for $([int]$age) s - asked driver to cancel any active Revit tool" }
      if ($escapedAt -and $age -gt 150 -and ((Get-Date) - $escapedAt).TotalSeconds -gt 300) { Say 'gate still silent 5 min after ESC - aborting run'; break }
      if ($age -lt 30) { $escapedAt = $null }
    }
    if (-not $doneAt -and (Test-Path (Join-Path $run 'DONE'))) { $doneAt = Get-Date; Say 'gate reported DONE' }
    if ($doneAt -and -not $KeepRevit -and ((Get-Date) - $doneAt).TotalSeconds -gt 90) { Say 'Revit did not exit 90 s after DONE - stopping our PID'; break }
  }
  if ((Get-Date) -ge $deadline) { Say "TIMEOUT after $TimeoutMin min" }
}
finally {
  if ($revit -and -not $revit.HasExited -and -not $KeepRevit) { try { Stop-Process -Id $revit.Id -Force; Say "stopped Revit PID $($revit.Id)" } catch { } }
  if ($driver -and -not $driver.HasExited) {
    New-Item -ItemType File -Force -Path (Join-Path $run 'driver\STOP') | Out-Null
    Start-Sleep -Seconds 1
    try { if (-not $driver.HasExited) { Stop-Process -Id $driver.Id -Force } } catch { }
  }
  if (Test-Path $manifest) { Remove-Item -Force $manifest; Say 'temporary manifest removed' }
  if ($revit -and -not $revit.HasExited) { try { [void]$revit.WaitForExit(20000) } catch { } }
  if ($revit -and $revit.HasExited) {
    if ($uiExisted -and (Test-Path $uiBackup)) { Copy-Item -Force -Path $uiBackup -Destination $uiPrefs; Say 'user ui-prefs.json restored' }
    elseif (-not $uiExisted -and (Test-Path $uiPrefs)) { Remove-Item -Force $uiPrefs; Say 'ui-prefs.json created by the test run removed' }
  } else { Say 'ui-prefs.json NOT restored (test Revit still running) - backup kept in the run folder' }
}

Say '--- steps ---'
$steps = Join-Path $run 'steps.jsonl'
if (Test-Path $steps) { Get-Content -Path $steps -Encoding UTF8 | ForEach-Object { Write-Host $_ } } else { Say 'no steps.jsonl (gate add-in did not run?)' }
Say "artifacts: $run"
if (-not (Test-Path (Join-Path $run 'DONE'))) { exit 1 }
exit 0
