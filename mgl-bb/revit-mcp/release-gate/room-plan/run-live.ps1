# Room Plan (Python multi-unit) - LIVE Revit gate.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File run-live.ps1                 # Revit 2027, Revit stays open with the result
#   powershell -NoProfile -ExecutionPolicy Bypass -File run-live.ps1 -ExitWhenDone   # unattended: Revit closes after the run
#   powershell -NoProfile -ExecutionPolicy Bypass -File run-live.ps1 -Mode floor     # Floor Plate: empty 40x18 m storey -> corridor, core, apartments
#   powershell -NoProfile -ExecutionPolicy Bypass -File run-live.ps1 -Mode studio    # one click: hundreds of whole-floor options -> top 20 -> apply, furnish, replace, undo
#
# What it does (and only this):
#   1. Refuses to run if Revit <Year> is already running (that is the user's session - never touched).
#   2. Builds tests\RoomPlan.LiveGate against the INSTALLED Revit API. It compiles the PRODUCTION RoomPlan sources
#      (Core, Python bridge, floor detection, furniture, RoomPlanBatchApply) and copies the production Python worker.
#   3. Creates a fresh run folder %LOCALAPPDATA%\MGL\RoomPlanGate\<Year>\<stamp>\ (test models + feedback DB live there,
#      the user's real Room Plan learning database is NOT touched).
#   4. Installs a TEMPORARY manifest (MglRoomPlanGate.addin); the add-in is inert without MGL_RP_GATE_JOB.
#   5. Starts Revit with MGL_RP_GATE_JOB set (child process only) and a dialog watcher bound to its PID.
#   6. The gate builds a 3-apartment plate from the default template, generates plans with the Python worker,
#      proves a failing 2nd unit rolls everything back, applies, verifies with real Revit geometry, exports a PNG,
#      undoes/redoes with Revit's own commands and saves models\RoomPlan_Generated.rvt.
#   7. Waits for <run>\DONE, prints the steps, removes the temporary manifest.
#
# Never opens production files, never saves outside the run folder.  ASCII-only on purpose (PowerShell 5.1).

param(
  [ValidateSet('2024', '2025', '2026', '2027')][string]$Year = '2027',
  [int]$TimeoutMin = 25,
  [switch]$NoBuild,
  [switch]$ExitWhenDone,
  # units = 3 apartments on separate floors (Room Plan); floor = one empty 40x18 m storey split into apartments (Floor Plate)
  [ValidateSet('units', 'floor', 'studio')][string]$Mode = 'units',
  # floor mode only: storey size in metres (length x depth), core position, apartment class
  [string]$FloorSize = '40x18',
  [ValidateSet('center', 'end', 'none')][string]$FloorCore = 'center',
  [ValidateSet('economy', 'standard', 'luxury')][string]$FloorTier = 'standard'
)

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$repo = (Resolve-Path (Join-Path $here '..\..')).Path            # revit-mcp
$gateProj = Join-Path $repo 'tests\RoomPlan.LiveGate\RoomPlan.LiveGate.csproj'
$revitExe = "C:\Program Files\Autodesk\Revit $Year\Revit.exe"
$template = "C:\ProgramData\Autodesk\RVT $Year\Templates\Default_M_ENU.rte"
# Revit 2025+ ship an almost empty local library - the 2024 metric families are loaded and upgraded on load.
$library = 'C:\ProgramData\Autodesk\RVT 2024\Libraries\English\US'
$addinsDir = Join-Path $env:APPDATA "Autodesk\Revit\Addins\$Year"
$manifest = Join-Path $addinsDir 'MglRoomPlanGate.addin'
$addinId = '3C9E2F71-5B4A-4D8E-9A61-7E2B0C4D5F18'

function Say($m) { Write-Host ("[roomplan-gate $Year] " + $m) }

if (-not (Test-Path $revitExe)) { Say "NOT RUN - Revit $Year is not installed ($revitExe)"; exit 3 }
if (-not (Test-Path $template)) { Say "NOT RUN - template missing: $template"; exit 3 }
if (-not (Test-Path $library)) { Say "NOT RUN - family library missing: $library"; exit 3 }
$busy = @(Get-Process -Name Revit -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path -like "*Revit $Year*" })
if ($busy.Count -gt 0) { Say "NOT RUN - Revit $Year is already running (PID $($busy[0].Id)); close it first - the gate never touches a user session"; exit 3 }
$python = (Get-Command python -ErrorAction SilentlyContinue)
if (-not $python) { Say 'NOT RUN - python is not on PATH (the Room Plan worker needs Python 3.10+)'; exit 3 }

if (-not $NoBuild) {
  Say 'building RoomPlan.LiveGate (production RoomPlan sources + Python worker)'
  & dotnet build $gateProj -c Release "-p:RevitYear=$Year" -p:Platform=x64 -v q -nologo | Out-Host
  if ($LASTEXITCODE -ne 0) { Say 'FAIL - gate build failed'; exit 2 }
}
$gateBin = Join-Path $repo "tests\RoomPlan.LiveGate\bin\$Year"

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$run = Join-Path $env:LOCALAPPDATA "MGL\RoomPlanGate\$Year\$stamp"
New-Item -ItemType Directory -Force -Path (Join-Path $run 'gate') | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $run 'models') | Out-Null
Copy-Item -Path (Join-Path $gateBin '*') -Destination (Join-Path $run 'gate') -Recurse -Force
$gateDll = Join-Path $run 'gate\MglRoomPlanLiveGate.dll'

$job = @(
  "run_dir=$run",
  "year=$Year",
  "template=$template",
  "library=$library",
  "models_dir=$(Join-Path $run 'models')",
  "exit=$(if ($ExitWhenDone) { '1' } else { '0' })",
  "mode=$Mode",
  "floor_size=$FloorSize",
  "floor_core=$FloorCore",
  "floor_tier=$FloorTier"
)
$jobFile = Join-Path $run 'job.ini'
[IO.File]::WriteAllLines($jobFile, $job, (New-Object Text.UTF8Encoding($false)))

$xml = @"
<?xml version="1.0" encoding="utf-8"?>
<RevitAddIns>
  <AddIn Type="Application">
    <Name>MGL Room Plan live gate (TEST ONLY)</Name>
    <Assembly>$gateDll</Assembly>
    <AddInId>$addinId</AddInId>
    <FullClassName>MglRpGate.GateApp</FullClassName>
    <VendorId>MGL</VendorId>
    <VendorDescription>MGL test harness - inert without MGL_RP_GATE_JOB</VendorDescription>
  </AddIn>
</RevitAddIns>
"@

$revit = $null; $watch = $null
$stopFile = Join-Path $run 'watch.STOP'
try {
  New-Item -ItemType Directory -Force -Path $addinsDir | Out-Null
  [IO.File]::WriteAllText($manifest, $xml, (New-Object Text.UTF8Encoding($false)))
  Say "run folder: $run (mode $Mode)"
  $env:MGL_RP_GATE_JOB = $jobFile
  $env:MGL_ROOMPLAN_DB_PATH = (Join-Path $run 'roomplan-feedback.sqlite3')
  $env:MGL_ROOMPLAN_PYTHON = $python.Source
  $revit = Start-Process -FilePath $revitExe -PassThru
  Remove-Item Env:\MGL_RP_GATE_JOB, Env:\MGL_ROOMPLAN_DB_PATH, Env:\MGL_ROOMPLAN_PYTHON
  Say "Revit $Year started, PID $($revit.Id)"
  $watchScript = Join-Path $here 'dialog-watch.ps1'
  $watch = Start-Process -FilePath 'powershell.exe' -WindowStyle Hidden -PassThru -ArgumentList @(
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"' + $watchScript + '"'),
    '-RevitPid', $revit.Id, '-Log', ('"' + (Join-Path $run 'dialogs.log') + '"'), '-Stop', ('"' + $stopFile + '"'))

  $deadline = (Get-Date).AddMinutes($TimeoutMin)
  $done = $false
  $heartbeat = Join-Path $run 'heartbeat'
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 3
    $revit.Refresh()
    if ($revit.HasExited) { Say "Revit exited (code $($revit.ExitCode))"; break }
    if (Test-Path (Join-Path $run 'DONE')) { $done = $true; Say ('gate reported DONE: ' + (Get-Content (Join-Path $run 'DONE'))); break }
    if ((Test-Path $heartbeat) -and (((Get-Date) - (Get-Item $heartbeat).LastWriteTime).TotalSeconds -gt 240)) {
      Say 'gate silent for 4 min - a modal dialog is probably open in the test Revit (see dialogs.log)'; break
    }
  }
  if (-not $done -and (Get-Date) -ge $deadline) { Say "TIMEOUT after $TimeoutMin min" }
  if ($ExitWhenDone -and $done) {
    $revit.WaitForExit(90000) | Out-Null
    if (-not $revit.HasExited) { Stop-Process -Id $revit.Id -Force; Say "stopped Revit PID $($revit.Id)" }
  }
}
finally {
  New-Item -ItemType File -Force -Path $stopFile | Out-Null
  if ($watch) { Start-Sleep -Seconds 1; try { if (-not $watch.HasExited) { Stop-Process -Id $watch.Id -Force } } catch { } }
  if (Test-Path $manifest) { Remove-Item -Force $manifest; Say 'temporary manifest removed' }
}

Say '--- steps ---'
$steps = Join-Path $run 'steps.jsonl'
if (Test-Path $steps) { Get-Content -Path $steps -Encoding UTF8 | ForEach-Object { Write-Host $_ } } else { Say 'no steps.jsonl (gate add-in did not run?)' }
if ($revit -and -not $revit.HasExited) { Say "Revit PID $($revit.Id) left OPEN with the generated plan (close it yourself; nothing is saved outside the run folder)" }
Say "artifacts: $run"
if (-not $done) { exit 1 }
if ((Get-Content (Join-Path $run 'DONE')) -ne 'PASS') { exit 1 }
exit 0
