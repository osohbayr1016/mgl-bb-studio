# MGL AI - ZERO-CONFIG INSTALLER  (sections 3, 36, 37)
#
# WARNING: THIS FILE IS ASCII-ONLY BY DESIGN.
#   Windows PowerShell 5.1 reads .ps1 as the system ANSI codepage unless the
#   file has a UTF-8 BOM.  A Cyrillic comment without a BOM turns into a
#   parser error on the employee's machine - measured 2026-09-09 while
#   building this installer.  User-visible Mongolian text is emitted from a
#   lookup table written with explicit [char] codes further down, so the
#   script itself stays 7-bit clean and cannot be corrupted by transport.
#
# WHAT THIS DOES - AND WHAT IT DELIBERATELY DOES NOT ASK
#
#   The employee runs one .exe and answers NOTHING.  No API key, no
#   password, no port, no model directory, no inference endpoint.  Section 4
#   of the brief is explicit about this, and the security is NOT removed:
#     - the local service binds 127.0.0.1 only (unreachable from the LAN)
#     - it trusts the browser Origin allowlist, which page JavaScript cannot
#       forge (Origin is a forbidden header)
#     - the ERP token for downloading licensed model weights is handed over
#       by the already-signed-in web page (POST /pair), never typed by hand
#
# WHY COMPONENTS COME FROM OUR OWN BUCKET
#
#   Node and llama.cpp are open-source redistributables, so they live in the
#   PUBLIC media bucket with a published SHA-256.  That is what lets this
#   installer run with no credential at all.  The MODEL WEIGHTS are licensed
#   and stay behind ERP auth - they are downloaded later, after the browser
#   pairs.  Mixing the two would either leak the model or force a credential
#   into the installer.
#
#   Pinning + SHA-256 also answers the objection that killed automatic
#   binary downloads before (ai/scripts/setup.mjs): "downloading the wrong
#   build produces a hard-to-diagnose failure".  A pinned, checksummed
#   artifact cannot be the wrong build.
#
# NO ADMIN RIGHTS.  Everything lands in %LOCALAPPDATA%\MglAi.  Requiring
# elevation would stall the rollout on every machine whose user is not a
# local admin.

[CmdletBinding()]
param(
  # Where the component manifest lives.  Overridable for staging.
  # WARNING: this is the Worker's public /media/:key route, NOT an r2.dev host.
  #   pub-mgl-media.r2.dev never existed (r2.dev access is off for the bucket,
  #   it answers 401) - the reason the 1.0.0 installer could not even fetch
  #   its manifest.  /media is already a credential-free public path, so
  #   pointing here adds no new surface.
  [string]$ManifestUrl = 'https://mgl-progress-api.mglenc-design.workers.dev/media/mgl-ai-components.json',
  [switch]$Quiet,
  # Re-download everything even if it is already present.
  [switch]$Force,
  # --- Acceptance-harness overrides (installer/acceptance.ps1).  Employees never
  #     pass these; the defaults are the production install.  They exist so the
  #     harness can install into a throwaway root on the SAME machine as a live
  #     install without touching it: own data dir, own port, own task name.
  [string]$DataDir = '',
  [int]$Port = 39217,
  [string]$TaskName = 'MGL AI runtime',
  # Fixture mode: no model, echo engine (health reports DEGRADED, never READY).
  [switch]$EngineEcho,
  # Fixture mode on a developer PC only: reuse node.exe from PATH instead of
  # downloading the pinned portable Node.  NOT for employee installs.
  [switch]$SkipNode,
  # Fixture mode: skip llama.cpp (echo engine does not need it).
  [switch]$SkipLlama
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'   # Invoke-WebRequest progress bar is 10x slower

# ---------------------------------------------------------------------------
#  Mongolian strings, built from code points so the file stays ASCII.
# ---------------------------------------------------------------------------
function U { param([int[]]$Codes) -join ($Codes | ForEach-Object { [char]$_ }) }

$T = @{}
# "MGL AI-g beldej baina..."
$T.Preparing   = 'MGL AI-' + (U 0x0433) + ' ' + (U 0x0431,0x044D,0x043B,0x0434,0x044D,0x0436) + ' ' + (U 0x0431,0x0430,0x0439,0x043D,0x0430) + '...'
# "Suulgaj baina"
$T.Installing  = (U 0x0421,0x0443,0x0443,0x043B,0x0433,0x0430,0x0436) + ' ' + (U 0x0431,0x0430,0x0439,0x043D,0x0430)
# "Beleh boloo"
$T.Done        = (U 0x0411,0x044D,0x043B,0x044D,0x043D) + ' ' + (U 0x0431,0x043E,0x043B,0x043B,0x043E,0x043E)
# "Aldaa garlaa"
$T.Failed      = (U 0x0410,0x043B,0x0434,0x0430,0x0430) + ' ' + (U 0x0433,0x0430,0x0440,0x043B,0x0430,0x0430)
# "Tatai baina"
$T.Downloading = (U 0x0422,0x0430,0x0442,0x0430,0x0436) + ' ' + (U 0x0431,0x0430,0x0439,0x043D,0x0430)

function Say([string]$Msg, [string]$Color = 'Gray') {
  if (-not $Quiet) { Write-Host "  $Msg" -ForegroundColor $Color }
}

function Step([string]$Msg) {
  if (-not $Quiet) { Write-Host ""; Write-Host "  >> $Msg" -ForegroundColor Cyan }
}

# ---------------------------------------------------------------------------
#  Paths
# ---------------------------------------------------------------------------
$Root      = if ($DataDir) { $DataDir } else { Join-Path $env:LOCALAPPDATA 'MglAi' }
$BinDir    = Join-Path $Root 'bin'
$NodeDir   = Join-Path $Root 'node'
$AppDir    = Join-Path $Root 'app'
$ModelsDir = Join-Path $Root 'models'
$LogFile   = Join-Path $Root 'install.log'
$TempDir   = Join-Path $Root 'tmp'

foreach ($d in @($Root, $BinDir, $NodeDir, $AppDir, $ModelsDir, $TempDir)) {
  New-Item -ItemType Directory -Force -Path $d | Out-Null
}

function Log([string]$Msg) {
  $line = "{0} {1}" -f (Get-Date -Format 'yyyy-MM-ddTHH:mm:ss'), $Msg
  Add-Content -Path $LogFile -Value $line -Encoding utf8
}

Log "=== install start ==="

# ---------------------------------------------------------------------------
#  Download with SHA-256 verification.
#
#  WARNING: The checksum is NOT optional and there is no "skip" flag.  An
#  unverified binary that runs on 40 workstations is the single highest-value
#  target in this whole product.  A failed checksum deletes the file and
#  aborts - it never falls back to "use it anyway".
# ---------------------------------------------------------------------------
function Get-Verified {
  param(
    [Parameter(Mandatory)][string]$Url,
    [Parameter(Mandatory)][string]$Sha256,
    [Parameter(Mandatory)][string]$OutFile,
    [string]$Label = 'file'
  )

  $part = "$OutFile.part"
  if (Test-Path $part) { Remove-Item $part -Force }

  Say "$($T.Downloading): $Label"
  Log "download $Label from $Url"

  # BITS is resumable and yields to interactive network use; fall back to
  # Invoke-WebRequest where the BITS service is disabled by policy.
  $ok = $false
  try {
    Start-BitsTransfer -Source $Url -Destination $part -Priority Normal -ErrorAction Stop
    $ok = $true
  } catch {
    Log "BITS failed ($($_.Exception.Message)); falling back to Invoke-WebRequest"
  }
  if (-not $ok) {
    Invoke-WebRequest -Uri $Url -OutFile $part -UseBasicParsing -TimeoutSec 1800
  }

  $actual = (Get-FileHash -Path $part -Algorithm SHA256).Hash.ToLowerInvariant()
  $expected = $Sha256.ToLowerInvariant()
  if ($actual -ne $expected) {
    Remove-Item $part -Force -ErrorAction SilentlyContinue
    Log "CHECKSUM MISMATCH $Label expected=$expected actual=$actual"
    throw "Checksum mismatch for $Label. Expected $expected, got $actual."
  }

  if (Test-Path $OutFile) { Remove-Item $OutFile -Force }
  Move-Item $part $OutFile
  Log "verified $Label ($actual)"
}

# ---------------------------------------------------------------------------
#  Multi-part components.
#
#  WHY: wrangler refuses to upload a single R2 object over 300 MiB, and the
#  CUDA build of llama.cpp needs cuBLAS (cublasLt64_12.dll alone is 473 MB
#  raw, 327 MB zipped).  So a component may list `parts` - several zips that
#  are all expanded into the SAME staging folder - and a zip may carry a
#  file split into byte ranges named `<name>.split.001`, `.split.002`, ...
#  which are joined back in order after extraction.  Every part has its own
#  SHA-256 and goes through Get-Verified; nothing is trusted because it is
#  "just a part".  A component without `parts` behaves exactly as before.
# ---------------------------------------------------------------------------
function Get-ComponentParts {
  param([Parameter(Mandatory)]$Component)
  if ($Component.PSObject.Properties['parts'] -and $Component.parts) { return @($Component.parts) }
  return @([pscustomobject]@{ url = $Component.url; sha256 = $Component.sha256; bytes = $Component.bytes })
}

function Expand-Component {
  param(
    [Parameter(Mandatory)]$Component,
    [Parameter(Mandatory)][string]$Stage,
    [Parameter(Mandatory)][string]$Label
  )
  if (Test-Path $Stage) { Remove-Item $Stage -Recurse -Force }
  New-Item -ItemType Directory -Force -Path $Stage | Out-Null
  $parts = Get-ComponentParts $Component
  $i = 0
  foreach ($p in $parts) {
    $i++
    $tag = if ($parts.Count -gt 1) { "$Label ($i/$($parts.Count))" } else { $Label }
    $zip = Join-Path $TempDir ("component-$i.zip")
    Get-Verified -Url $p.url -Sha256 $p.sha256 -OutFile $zip -Label $tag
    Expand-Archive -Path $zip -DestinationPath $Stage -Force
    Remove-Item $zip -Force -ErrorAction SilentlyContinue
  }
  # Rejoin byte-split files: <name>.split.001 + .002 + ... -> <name>
  $splits = Get-ChildItem $Stage -Recurse -File | Where-Object { $_.Name -match '\.split\.\d{3}$' }
  foreach ($group in ($splits | Group-Object { $_.FullName -replace '\.split\.\d{3}$', '' })) {
    $target = $group.Name
    Log "joining $($group.Count) parts -> $target"
    $out = [IO.File]::Open($target, [IO.FileMode]::Create, [IO.FileAccess]::Write)
    try {
      foreach ($piece in ($group.Group | Sort-Object Name)) {
        $in = [IO.File]::OpenRead($piece.FullName)
        try { $in.CopyTo($out) } finally { $in.Dispose() }
      }
    } finally { $out.Dispose() }
    $group.Group | Remove-Item -Force
  }
}

# ---------------------------------------------------------------------------
#  Hardware probe - decides CUDA vs CPU build.
#
#  WARNING: "nvidia-smi is missing" means UNKNOWN, not "no GPU".  We fall
#  back to the CPU build, which is slow but correct; shipping a CUDA build to
#  a machine without the runtime DLLs produces the exact silent
#  CPU-fallback that LlamaCppEngine has to warn about at runtime.
# ---------------------------------------------------------------------------
function Get-GpuKind {
  try {
    $out = & nvidia-smi --query-gpu=name,memory.total --format=csv,noheader,nounits 2>$null
    if ($LASTEXITCODE -eq 0 -and $out) {
      $first = ($out -split "`n")[0]
      Log "gpu detected: $first"
      return 'cuda'
    }
  } catch { }
  Log 'no nvidia gpu detected; using cpu build'
  return 'cpu'
}

# ---------------------------------------------------------------------------
#  Manifest
# ---------------------------------------------------------------------------
Step $T.Preparing

$manifest = $null
# WARNING: /media/:key is served with Cache-Control: immutable and a per-colo
#   edge cache keyed on the FULL URL (query string included).  The manifest
#   has a fixed name but changes on every publish, so a bare GET could return
#   a year-old copy.  A unique query string forces a fresh read from R2 each
#   time; the versioned component zips it points at are safe to cache.
$manifestFetchUrl = $ManifestUrl
if ($ManifestUrl -match '^https?://') {
  $sep = if ($ManifestUrl.Contains('?')) { '&' } else { '?' }
  $manifestFetchUrl = $ManifestUrl + $sep + 't=' + [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
}
try {
  $manifest = Invoke-RestMethod -Uri $manifestFetchUrl -TimeoutSec 60 -UseBasicParsing
} catch {
  Write-Host ""
  Write-Host "  $($T.Failed): MGL AI server unreachable." -ForegroundColor Red
  Write-Host "  $ManifestUrl" -ForegroundColor DarkGray
  Log "manifest fetch failed: $($_.Exception.Message)"
  if (-not $Quiet) { Read-Host "  Press Enter to close" }
  exit 1
}

$gpu = Get-GpuKind
$llamaKey = if ($gpu -eq 'cuda') { 'llama-cuda' } else { 'llama-cpu' }

function Component([string]$Name) {
  $c = $manifest.components.$Name
  if (-not $c) { throw "Manifest is missing component '$Name'." }
  return $c
}

# ---------------------------------------------------------------------------
#  1. Portable Node
#
#  WARNING: We install our OWN Node instead of using whatever is on PATH.
#  The runtime executes TypeScript directly (node runtime/src/server.ts),
#  which needs >= 22.6 for type stripping and >= 22.18 for it to be on by
#  default.  Depending on the employee's Node is how you get "works on my
#  machine": a stale Node 18 fails with a syntax error that looks like a
#  corrupt install.
# ---------------------------------------------------------------------------
$nodeExe = Join-Path $NodeDir 'node.exe'
if ($SkipNode) {
  $found = Get-Command node.exe -ErrorAction SilentlyContinue
  if (-not $found) { throw "-SkipNode given but node.exe is not on PATH." }
  $nodeExe = $found.Source
  Log "SkipNode: using $nodeExe (fixture mode, not an employee install)"
}
$nodeC = if ($SkipNode) { $null } else { Component 'node' }
$nodeStamp = if ($SkipNode) { '' } else { Join-Path $NodeDir ".version-$($nodeC.version)" }

if (-not $SkipNode -and ($Force -or -not (Test-Path $nodeStamp) -or -not (Test-Path $nodeExe))) {
  Step "Node $($nodeC.version)"
  $stage = Join-Path $TempDir 'node-stage'
  Expand-Component -Component $nodeC -Stage $stage -Label "Node $($nodeC.version)"

  Say $T.Installing

  # The official zip nests everything under node-vX.Y.Z-win-x64/.
  $inner = Get-ChildItem $stage -Directory | Select-Object -First 1
  $src = if ($inner) { $inner.FullName } else { $stage }

  Get-ChildItem $NodeDir -Force | Where-Object { $_.Name -notlike '.version-*' } |
    Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
  Copy-Item -Path (Join-Path $src '*') -Destination $NodeDir -Recurse -Force

  Get-ChildItem $NodeDir -Filter '.version-*' -Force -ErrorAction SilentlyContinue |
    Remove-Item -Force -ErrorAction SilentlyContinue
  Set-Content -Path $nodeStamp -Value $nodeC.version -Encoding utf8

  Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue
  Say "Node OK" 'Green'
} elseif (-not $SkipNode) {
  Say "Node $($nodeC.version) already installed" 'DarkGray'
}

if (-not (Test-Path $nodeExe)) { throw "node.exe missing after install: $nodeExe" }

# ---------------------------------------------------------------------------
#  2. llama.cpp binaries
# ---------------------------------------------------------------------------
$llamaC = if ($SkipLlama) { $null } else { Component $llamaKey }
$llamaStamp = if ($SkipLlama) { '' } else { Join-Path $BinDir ".version-$($llamaC.version)-$llamaKey" }
$serverExe = Join-Path $BinDir 'llama-server.exe'

if (-not $SkipLlama -and ($Force -or -not (Test-Path $llamaStamp) -or -not (Test-Path $serverExe))) {
  Step "llama.cpp $($llamaC.version) ($gpu)"
  $stage = Join-Path $TempDir 'llama-stage'
  Expand-Component -Component $llamaC -Stage $stage -Label "llama.cpp ($gpu)"

  Say $T.Installing

  # WARNING: the archive may or may not nest a folder, and the CUDA runtime
  # DLLs historically ship in a SEPARATE cudart archive.  We flatten every
  # .exe/.dll we find so a nested layout cannot silently drop cublas64_*.dll -
  # that omission is exactly what makes the engine fall back to CPU while
  # claiming to use the GPU.
  Get-ChildItem $stage -Recurse -Include '*.exe', '*.dll' |
    ForEach-Object { Copy-Item $_.FullName -Destination $BinDir -Force }

  Get-ChildItem $BinDir -Filter '.version-*' -Force -ErrorAction SilentlyContinue |
    Remove-Item -Force -ErrorAction SilentlyContinue
  Set-Content -Path $llamaStamp -Value $llamaC.version -Encoding utf8

  Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue
  Say "llama.cpp OK" 'Green'
} elseif (-not $SkipLlama) {
  Say "llama.cpp $($llamaC.version) already installed" 'DarkGray'
}

# ---------------------------------------------------------------------------
#  3. Runtime code
#
#  WARNING: This is the code-distribution channel CLAUDE.md says did not
#  exist ("wrangler deploy does not update ai/; every employee must git
#  pull").  Shipping the runtime as a versioned, checksummed zip is what
#  makes a repetition-guard or sampling fix actually reach the 40 machines.
# ---------------------------------------------------------------------------
$appC = Component 'runtime-code'
# Session B: VERSIONED FOLDER + POINTER instead of replacing app\ in place.
#   app\versions\<version>\runtime\src\server.ts   <- this release's code
#   app\current.runtime.json                       <- pointer (atomic rename)
# The supervisor (deployment\bin\supervise.ts) reads the pointer on EVERY spawn,
# so a later component update only has to unpack next to it and swap the
# pointer; the previous folder stays as the rollback target.  Nothing that is
# running is ever overwritten.
$VersionDir = Join-Path $AppDir ("versions\" + $appC.version)
$PointerFile = Join-Path $AppDir 'current.runtime.json'
$entry = Join-Path $VersionDir 'runtime\src\server.ts'

if ($Force -or -not (Test-Path $entry)) {
  Step "MGL AI runtime $($appC.version)"
  $zip = Join-Path $TempDir 'app.zip'
  Get-Verified -Url $appC.url -Sha256 $appC.sha256 -OutFile $zip -Label "MGL AI runtime"

  Say $T.Installing
  $stage = "$VersionDir.staging"
  if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
  Expand-Archive -Path $zip -DestinationPath $stage -Force
  if (Test-Path $VersionDir) { Remove-Item $VersionDir -Recurse -Force }
  Move-Item $stage $VersionDir
  Remove-Item $zip -Force -ErrorAction SilentlyContinue
  Say "Runtime OK" 'Green'
} else {
  Say "Runtime $($appC.version) already installed" 'DarkGray'
}

if (-not (Test-Path $entry)) { throw "Runtime entry point missing: $entry" }

# Pointer: write to .tmp then rename - never a half-written pointer.
$pointer = [pscustomobject]@{
  version     = $appC.version
  sha256      = $appC.sha256.ToLowerInvariant()
  path        = $VersionDir
  activatedAt = (Get-Date).ToUniversalTime().ToString('o')
  releaseId   = $null
}
$pointerTmp = "$PointerFile.tmp"
$pointer | ConvertTo-Json -Compress | Set-Content -Path $pointerTmp -Encoding ascii
Move-Item $pointerTmp $PointerFile -Force
Log "runtime pointer -> $VersionDir"

# Legacy layout: an older installer unpacked straight into app\.  Left in
# place (rollback for a pre-pointer install); the pointer wins in supervise.ts.
$legacyEntry = Join-Path $AppDir 'runtime\src\server.ts'
if (Test-Path $legacyEntry) { Log 'legacy app\runtime layout present (kept, pointer takes precedence)' }

# The supervisor ships inside the runtime package.  The Task Scheduler action
# is pinned to THIS version's supervisor; it re-reads the pointer on every
# spawn, so later runtime updates do not need the task re-registered.
$supervisor = Join-Path $VersionDir 'deployment\bin\supervise.ts'
if (-not (Test-Path $supervisor)) { throw "Supervisor entry missing: $supervisor" }
# A custom root (acceptance harness) is passed explicitly: the scheduled task has
# no environment, and the supervisor must not fall back to the default root.
$supArgs = "`"$supervisor`""
if ($DataDir) { $supArgs = "`"$supervisor`" --data-dir `"$Root`"" }

# ---------------------------------------------------------------------------
#  4. Launcher + auto-start
#
#  WARNING: registered for THIS USER, no elevation.  A machine-wide service
#  would need admin rights on every workstation and would run as SYSTEM,
#  which cannot read %LOCALAPPDATA% of the signed-in employee.
#
#  WARNING: the task starts a LIGHTWEIGHT Node process only.  The model is
#  NOT loaded at logon - the runtime loads it when the web page opens
#  (POST /warmup) or on the first question.  Loading at logon would hold
#  5-6 GB of VRAM all day for someone who never opens the assistant, which
#  is the exact resource complaint this release is fixing.
# ---------------------------------------------------------------------------
Step 'Launcher'

$launcher = Join-Path $Root 'mgl-ai.cmd'
$launcherBody = @"
@echo off
rem MGL AI launcher - generated by the installer.  Do not edit by hand.
start "" /B "$nodeExe" $supArgs
"@
Set-Content -Path $launcher -Value $launcherBody -Encoding ascii

#  WARNING: "started at logon" is not "always available".  Measured
#  2026-09-11 on the developer's own PC: the runtime had died and nothing
#  brought it back until the next logon, so the employee restarted it from a
#  terminal every morning - which is exactly what this installer exists to
#  remove.  Three layers now guarantee recovery without any human action:
#    1. the task action IS the node process, so a crash ends the task and
#       RestartCount/RestartInterval bring it back within a minute;
#    2. a watchdog trigger re-fires every 10 minutes - IgnoreNew means it is
#       a no-op while the runtime is alive and a restart when it is not
#       (covers "killed from Task Manager", where the task ends cleanly and
#       RestartCount does not apply);
#    3. the logon trigger, as before.
#  The model is still NOT loaded by any of these - only the light process.
$taskName = $TaskName

# Install-time runtime configuration.  The supervisor (deployment\bin\supervise.ts)
# merges state\runtime-env.json into the child's environment on every spawn, so
# a non-default port / data dir / echo engine survives reboots without any
# machine-wide environment variable.  Production installs write only MGLAI_DATA_DIR
# when a custom root was chosen; the rest stay at runtime defaults.
$runtimeEnv = @{}
if ($DataDir) { $runtimeEnv['MGLAI_DATA_DIR'] = $Root }
if ($Port -ne 39217) { $runtimeEnv['MGLAI_PORT'] = "$Port"; $runtimeEnv['MGLAI_ENGINE_PORT'] = "$($Port + 1)" }
if ($EngineEcho) { $runtimeEnv['MGLAI_ENGINE'] = 'echo' }
$StateDir = Join-Path $Root 'state'
New-Item -ItemType Directory -Force -Path $StateDir | Out-Null
$runtimeEnvFile = Join-Path $StateDir 'runtime-env.json'
if ($runtimeEnv.Count -gt 0) {
  $runtimeEnv | ConvertTo-Json -Compress | Set-Content -Path $runtimeEnvFile -Encoding ascii
  Log "runtime-env.json: $($runtimeEnv.Keys -join ',')"
} elseif (Test-Path $runtimeEnvFile) {
  Remove-Item $runtimeEnvFile -Force
}
try {
  # Session B: the action is the SUPERVISOR loop, not the runtime itself.
  # One loop (deployment/src/supervisor.ts) = lock file + port probe, so a
  # duplicate runtime can never be started, and a crash restarts with backoff.
  $action = New-ScheduledTaskAction -Execute $nodeExe -Argument $supArgs -WorkingDirectory $AppDir
  $atLogon = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
  $watchdog = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) `
    -RepetitionInterval (New-TimeSpan -Minutes 10)
  $settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
    -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -MultipleInstances IgnoreNew `
    -RestartCount 10 -RestartInterval (New-TimeSpan -Minutes 1)
  Register-ScheduledTask -TaskName $taskName -Action $action -Trigger @($atLogon, $watchdog) `
    -Settings $settings -Description 'MGL AI local inference runtime' -Force | Out-Null
  Say "Auto-start registered" 'Green'
  Log 'scheduled task registered'
} catch {
  # Not fatal: the launcher still works, and the web page tells the user.
  Say "Auto-start could not be registered (policy?). Use the desktop shortcut." 'Yellow'
  Log "scheduled task failed: $($_.Exception.Message)"
}

# Desktop shortcut - the recovery path when Task Scheduler is locked down.
try {
  $desktop = [Environment]::GetFolderPath('Desktop')
  $lnk = Join-Path $desktop 'MGL AI.lnk'
  $ws = New-Object -ComObject WScript.Shell
  $sc = $ws.CreateShortcut($lnk)
  $sc.TargetPath = $nodeExe
  $sc.Arguments = $supArgs
  $sc.WorkingDirectory = $AppDir
  $sc.WindowStyle = 7          # minimised
  $sc.Description = 'MGL AI'
  $sc.Save()
} catch {
  Log "shortcut failed: $($_.Exception.Message)"
}

# ---------------------------------------------------------------------------
#  5. Start it and wait for /health
#
#  WARNING: "installed" is not "working".  Printing success and leaving a
#  dead process behind is the most misleading outcome possible, so we poll
#  the unauthenticated /health endpoint before claiming anything.
# ---------------------------------------------------------------------------
Step 'Starting'

# Stop only processes that belong to THIS install root (a fixture install on a
# developer PC must not kill the developer's live runtime).
$rootMatch = '*' + $Root.TrimEnd('\') + '*'
if (-not $SkipLlama) { Get-Process llama-server -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue }
Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -like $rootMatch -and ($_.CommandLine -like '*server.ts*' -or $_.CommandLine -like '*supervise.ts*') } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

# WARNING: start THROUGH the scheduled task when it exists.  A process
# started here directly is invisible to Task Scheduler, so a crash would not
# be restarted until the next logon; started via the task, RestartCount
# applies from the very first run.
$proc = $null
if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
  Start-ScheduledTask -TaskName $taskName
  Log 'started via scheduled task'
} else {
  $proc = Start-Process -FilePath $nodeExe -ArgumentList $supArgs `
    -WorkingDirectory $AppDir -WindowStyle Hidden -PassThru
  Log 'started directly (no scheduled task)'
}

$port = $Port
$ready = $false
foreach ($i in 1..60) {
  Start-Sleep -Milliseconds 500
  try {
    $r = Invoke-WebRequest -Uri "http://127.0.0.1:$port/health" -TimeoutSec 2 -UseBasicParsing
    if ($r.StatusCode -eq 200) { $ready = $true; break }
  } catch { }
  if ($proc -and $proc.HasExited) { break }
}

Remove-Item $TempDir -Recurse -Force -ErrorAction SilentlyContinue

# Session B: FIRST-RUN HEALTH REPORT (section 11).  /health only says "alive";
# the report says which components are missing (model not downloaded yet is
# EXPECTED on a fresh install - it arrives after the browser pairs).  The
# report is written to state\health.json and printed as one line per facet.
$healthCli = Join-Path $VersionDir 'deployment\bin\health.ts'
if ($ready -and (Test-Path $healthCli)) {
  try {
    foreach ($k in $runtimeEnv.Keys) { Set-Item -Path "Env:$k" -Value $runtimeEnv[$k] }
    $reportJson = if ($DataDir) { & $nodeExe $healthCli --data-dir $Root 2>$null } else { & $nodeExe $healthCli 2>$null }
    $report = ($reportJson -join "") | ConvertFrom-Json
    Log "first-run health: $($report.status) [$($report.reasonCodes -join ',')]"
    foreach ($facet in @('LOCAL_AI','KNOWLEDGE','NORM','COMPANY_BACKEND','REVIT')) {
      $st = $report.facets.$facet.status
      $color = if ($st -eq 'READY') { 'Green' } elseif ($st -eq 'MISSING' -or $st -eq 'DEGRADED') { 'Yellow' } else { 'DarkGray' }
      Say ("{0,-16} {1}" -f $facet, $st) $color
    }
  } catch {
    Log "first-run health report failed: $($_.Exception.Message)"
  }
}

Write-Host ""
if ($ready) {
  Write-Host "  $($T.Done)" -ForegroundColor Green
  Write-Host ""
  Write-Host "  MGL AI is running on this computer."                      -ForegroundColor Gray
  Write-Host "  Open the ERP site and go to the MGL AI page - it will"    -ForegroundColor Gray
  Write-Host "  detect this automatically and finish setting itself up."  -ForegroundColor Gray
  Write-Host "  No key, no password, nothing to configure."               -ForegroundColor DarkGray
  Log 'install complete, runtime healthy'
  $code = 0
} else {
  Write-Host "  $($T.Failed)" -ForegroundColor Red
  Write-Host "  The runtime did not start. Log: $LogFile" -ForegroundColor DarkGray
  Log 'runtime did not become healthy'
  $code = 1
}

if (-not $Quiet) {
  Write-Host ""
  Read-Host "  Press Enter to close"
}
exit $code
