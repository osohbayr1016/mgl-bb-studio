# MGL AI - CLEAN-MACHINE ACCEPTANCE HARNESS  (Session B, P0-3)
#
# ASCII-ONLY BY DESIGN - see bootstrap.ps1 header.
#
# Runs the 15-step employee-PC acceptance and prints one PASS / FAIL / BLOCKED
# line per step plus a JSON report.  Exit code = number of FAILs.
#
#   Real mode (fresh Windows VM / spare PC, NO repository clone needed):
#     powershell -ExecutionPolicy Bypass -File acceptance.ps1 -Mode Real -Phase 1 `
#       -ManifestUrl https://pub-mgl-media.r2.dev/mgl-ai-components.json -Token <ERP JWT>
#     ... reboot Windows, sign in ...
#     powershell -ExecutionPolicy Bypass -File acceptance.ps1 -Mode Real -Phase 2 -Token <ERP JWT>
#
#   Fixture mode (any Windows machine, INCLUDING one that already runs MGL AI):
#     installs into its OWN root / port / task name with the echo engine, so the
#     live install is never touched.  Needs the packed runtime zip
#     (ai/scripts/publish-installer.mjs --pack-runtime) and node.exe on PATH.
#     powershell -ExecutionPolicy Bypass -File acceptance.ps1 -Mode Fixture -RuntimeZip <zip>
#     powershell -ExecutionPolicy Bypass -File acceptance.ps1 -Mode Fixture -Cleanup
#
# Steps 9-10 (Windows restart) can only be verified across a real reboot:
# Phase 1 ends with BLOCKED for them and prints the exact Phase 2 command.
#
# WARNING: -Cleanup removes the harness root, its scheduled task and its
#   processes ONLY.  It never touches %LOCALAPPDATA%\MglAi unless that is the
#   root you explicitly passed with -DataDir.

[CmdletBinding()]
param(
  [ValidateSet('Fixture', 'Real')][string]$Mode = 'Real',
  [ValidateSet(1, 2)][int]$Phase = 1,
  [string]$ManifestUrl = '',
  [string]$DataDir = '',
  [int]$Port = 0,
  [string]$TaskName = '',
  [string]$RuntimeZip = '',
  [string]$Token = '',
  [string]$ControlPlane = 'https://mgl-progress-api.mglenc-design.workers.dev',
  [switch]$Cleanup
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path

if ($Mode -eq 'Fixture') {
  if (-not $DataDir) { $DataDir = Join-Path $env:LOCALAPPDATA 'MglAi-acceptance' }
  if ($Port -eq 0) { $Port = 39271 }
  if (-not $TaskName) { $TaskName = 'MGL AI acceptance' }
} else {
  if (-not $DataDir) { $DataDir = Join-Path $env:LOCALAPPDATA 'MglAi' }
  if ($Port -eq 0) { $Port = 39217 }
  if (-not $TaskName) { $TaskName = 'MGL AI runtime' }
}
$Root = $DataDir
$Base = "http://127.0.0.1:$Port"
$Results = @()
$Work = Join-Path $Root 'diagnostics\acceptance'

function Record([string]$Id, [string]$Name, [string]$Status, [string]$Detail = '') {
  $color = switch ($Status) { 'PASS' { 'Green' } 'FAIL' { 'Red' } default { 'Yellow' } }
  Write-Host ("[{0,-7}] {1} {2}  {3}" -f $Status, $Id, $Name, $Detail) -ForegroundColor $color
  $script:Results += [pscustomobject]@{ id = $Id; name = $Name; status = $Status; detail = $Detail; at = (Get-Date).ToUniversalTime().ToString('o') }
}

function Step([string]$Id, [string]$Name, [scriptblock]$Body) {
  try {
    $r = & $Body
    if ($r -is [string] -and $r.StartsWith('BLOCKED:')) { Record $Id $Name 'BLOCKED' $r.Substring(8).Trim() }
    elseif ($r -is [string] -and $r.StartsWith('FAIL:')) { Record $Id $Name 'FAIL' $r.Substring(5).Trim() }
    else { Record $Id $Name 'PASS' ([string]$r) }
  } catch {
    Record $Id $Name 'FAIL' $_.Exception.Message
  }
}

function Http([string]$Method, [string]$Url, $Body = $null, [hashtable]$Headers = @{}, [int]$TimeoutSec = 30) {
  $p = @{ Method = $Method; Uri = $Url; TimeoutSec = $TimeoutSec; UseBasicParsing = $true; Headers = $Headers }
  if ($null -ne $Body) { $p['Body'] = ($Body | ConvertTo-Json -Compress -Depth 6); $p['ContentType'] = 'application/json' }
  try {
    $r = Invoke-WebRequest @p
    # SSE bodies (/generate) are not JSON - keep the raw text.
    $parsed = $null
    try { $parsed = ($r.Content | ConvertFrom-Json) } catch { $parsed = $r.Content }
    return @{ status = [int]$r.StatusCode; body = $parsed }
  } catch {
    $code = 0
    if ($_.Exception.Response) { $code = [int]$_.Exception.Response.StatusCode }
    return @{ status = $code; body = $null; error = $_.Exception.Message }
  }
}

function NodeExe {
  if ($Mode -eq 'Fixture') { return (Get-Command node.exe).Source }
  return (Join-Path $Root 'node\node.exe')
}
function Pointer { $p = Join-Path $Root 'app\current.runtime.json'; if (Test-Path $p) { Get-Content $p -Raw | ConvertFrom-Json } else { $null } }
function VersionDir { $p = Pointer; if ($p) { $p.path } else { $null } }
function RunNode([string]$Script, [string[]]$Extra) {
  $all = @($Script) + $Extra + @('--data-dir', $Root)
  $out = & (NodeExe) $all 2>$null
  return ($out -join "`n")
}
function Secret { $f = Join-Path $Root 'secret.txt'; if (Test-Path $f) { (Get-Content $f -Raw).Trim() } else { '' } }
function RtHeaders { @{ 'x-mglai-secret' = (Secret) } }

# ---------------------------------------------------------------------------
#  Cleanup
# ---------------------------------------------------------------------------
if ($Cleanup) {
  Write-Host "Cleanup: $Root / task '$TaskName'"
  try { Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction Stop; Write-Host '  task removed' } catch { Write-Host '  task not present' }
  $rootMatch = '*' + $Root.TrimEnd('\') + '*'
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like $rootMatch } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Seconds 1
  if ($Mode -eq 'Fixture' -and (Test-Path $Root)) { Remove-Item $Root -Recurse -Force; Write-Host '  root removed' }
  $left = Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like $rootMatch }
  $ok = (-not (Test-Path $Root)) -and (-not $left) -and (-not (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue))
  Write-Host ("[{0,-7}] 15 uninstall" -f $(if ($ok) { 'PASS' } else { 'FAIL' }))
  exit $(if ($ok) { 0 } else { 1 })
}

New-Item -ItemType Directory -Force -Path $Work | Out-Null

# ---------------------------------------------------------------------------
#  Fixture artifacts: components manifest, knowledge sqlite, release manifests
# ---------------------------------------------------------------------------
function Sha([string]$Path) { (Get-FileHash -Path $Path -Algorithm SHA256).Hash.ToLowerInvariant() }
function FileUrl([string]$Path) { 'file:///' + ($Path -replace '\\', '/') }

function New-FixtureKnowledge([string]$Path, [bool]$Corrupt) {
  if ($Corrupt) { Set-Content -Path $Path -Value 'this is not a sqlite database' -Encoding ascii; return }
  # An EMPTY sqlite file with a valid header: the runtime applies knowledge/schema.sql itself on open.
  $js = "const {DatabaseSync}=require('node:sqlite');const d=new DatabaseSync(process.argv[1]);d.exec('CREATE TABLE fixture_seed(x INTEGER); DROP TABLE fixture_seed;');d.close();"
  & (NodeExe) -e $js $Path | Out-Null
}
function New-ReleaseManifest([string]$OutPath, [string]$ReleaseId, [string]$KnowledgeVersion, [string]$KnowledgePath, [string]$ShaOverride = '') {
  $sha = if ($ShaOverride) { $ShaOverride } else { Sha $KnowledgePath }
  $m = [ordered]@{
    schema = 'mgl-ai-release/1'; releaseId = $ReleaseId; channel = 'stable'; createdAt = (Get-Date).ToUniversalTime().ToString('o')
    components = [ordered]@{ knowledge = [ordered]@{ version = $KnowledgeVersion; sha256 = $sha; url = (FileUrl $KnowledgePath); sizeBytes = [int](Get-Item $KnowledgePath).Length; meta = @{ fileName = 'knowledge.sqlite' } } }
    compatibility = @{}
  }
  $m | ConvertTo-Json -Depth 6 | Set-Content -Path $OutPath -Encoding ascii
  return $OutPath
}

# ===========================================================================
#  PHASE 2 - after Windows restart
# ===========================================================================
if ($Phase -eq 2) {
  Step '09' 'windows restart' {
    $t = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if (-not $t) { return 'FAIL: scheduled task missing after restart' }
    $up = (Http 'GET' "$Base/health").status -eq 200
    if (-not $up) { return 'FAIL: runtime not answering after restart (task state: ' + $t.State + ')' }
    "task $($t.State), runtime up on $Port"
  }
  Step '10' 'health after restart' {
    $j = RunNode (Join-Path (VersionDir) 'deployment\bin\health.ts') @()
    $h = $j | ConvertFrom-Json
    if ($h.status -in @('READY', 'DEGRADED')) { "status $($h.status) [$($h.reasonCodes -join ',')]" } else { "FAIL: $($h.status) [$($h.reasonCodes -join ',')]" }
  }
  Step '10b' 'no duplicate runtime' {
    $rootMatch = '*' + $Root.TrimEnd('\') + '*'
    $n = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like $rootMatch -and $_.CommandLine -like '*server.ts*' }).Count
    if ($n -eq 1) { '1 runtime process' } else { "FAIL: $n runtime processes" }
  }
  $Results | ConvertTo-Json -Depth 4 | Set-Content -Path (Join-Path $Work 'acceptance-phase2.json') -Encoding utf8
  $fails = @($Results | Where-Object { $_.status -eq 'FAIL' }).Count
  Write-Host "`nPhase 2: $fails FAIL"
  exit $fails
}

# ===========================================================================
#  PHASE 1
# ===========================================================================
$nodeExe = $null
$fixtureManifest = $null
if ($Mode -eq 'Fixture') {
  if (-not $RuntimeZip -or -not (Test-Path $RuntimeZip)) { throw 'Fixture mode needs -RuntimeZip <packed runtime zip>' }
  $nodeExe = NodeExe
  $fixtureManifest = Join-Path $Work 'components.json'
  $zipAbs = (Resolve-Path $RuntimeZip).Path
  $ver = if ($zipAbs -match 'mgl-ai-runtime-(.+)\.zip$') { $Matches[1] } else { '0.0.0-fixture' }
  @{ generated_at = (Get-Date).ToUniversalTime().ToString('o'); components = @{ 'runtime-code' = @{ version = $ver; url = (FileUrl $zipAbs); sha256 = (Sha $zipAbs) } } } |
    ConvertTo-Json -Depth 5 | Set-Content -Path $fixtureManifest -Encoding ascii
  $ManifestUrl = FileUrl $fixtureManifest
}
if (-not $ManifestUrl) { throw 'Real mode needs -ManifestUrl (the public components manifest)' }

# 1. bootstrap ---------------------------------------------------------------
Step '01' 'bootstrap/installer' {
  $bs = Join-Path $here 'bootstrap.ps1'
  # Start-Process joins the list with spaces: quote every value that may contain one.
  $q = { param($v) '"' + $v + '"' }
  $args = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (& $q $bs), '-ManifestUrl', (& $q $ManifestUrl), '-Quiet', '-DataDir', (& $q $Root), '-Port', "$Port", '-TaskName', (& $q $TaskName))
  if ($Mode -eq 'Fixture') { $args += @('-EngineEcho', '-SkipNode', '-SkipLlama') }
  $p = Start-Process -FilePath 'powershell.exe' -ArgumentList $args -Wait -PassThru -NoNewWindow
  if ($p.ExitCode -ne 0) { return "FAIL: bootstrap exit $($p.ExitCode) (log: $Root\install.log)" }
  "exit 0"
}

# 2. layout -------------------------------------------------------------------
Step '02' 'application layout' {
  $missing = @('app', 'state', 'logs', 'updates\staging', 'diagnostics', 'knowledge', 'models') | Where-Object { -not (Test-Path (Join-Path $Root $_)) }
  if ($missing) { return "FAIL: missing $($missing -join ',')" }
  if (-not (Test-Path (Join-Path $Root 'state\installed.json'))) { return 'FAIL: state\installed.json missing' }
  'dirs + installed.json'
}

# 3. runtime installed ---------------------------------------------------------
Step '03' 'runtime installed (versioned + pointer)' {
  $p = Pointer
  if (-not $p) { return 'FAIL: app\current.runtime.json missing' }
  $entry = Join-Path $p.path 'runtime\src\server.ts'
  if (-not (Test-Path $entry)) { return "FAIL: entry missing $entry" }
  "pointer -> $($p.version)"
}

# 4. model --------------------------------------------------------------------
Step '04' 'model' {
  if ($Mode -eq 'Fixture') { return 'echo engine (fixture: no model by design)' }
  $i = Http 'GET' "$Base/info" $null (RtHeaders)
  if ($i.status -ne 200) { return "FAIL: /info $($i.status)" }
  if ($i.body.active_model) { "active $($i.body.active_model.version)" } else { 'BLOCKED: model downloads after the browser pairs (open the ERP MGL AI page once), re-run Phase 1 step 4 later' }
}

# 5. knowledge -----------------------------------------------------------------
$k1 = Join-Path $Work 'knowledge-v1.sqlite'
Step '05' 'knowledge installed' {
  if ($Mode -eq 'Fixture') {
    New-FixtureKnowledge $k1 $false
    $m = New-ReleaseManifest (Join-Path $Work 'rel-k1.json') 'acc-k1' 'acc-2026.09.11.1' $k1
    $out = RunNode (Join-Path (VersionDir) 'deployment\bin\update.ts') @('--manifest', $m)
    $r = ($out -split "`n" | Select-Object -Last 1) | ConvertFrom-Json
    if ($r.code -ne 'ACTIVATED') { return "FAIL: $($r.code) $($r.detail)" }
    $kp = Join-Path $Root 'knowledge\current.knowledge.json'
    if (-not (Test-Path $kp)) { return 'FAIL: knowledge pointer missing' }
    "activated acc-2026.09.11.1 (restart chain)"
  } else {
    $kp = Join-Path $Root 'knowledge\current.knowledge.json'
    if (Test-Path $kp) { 'pointer present' } else { 'BLOCKED: knowledge pack arrives after pairing (POST /pair) - re-run later' }
  }
}

# 6. supervisor ------------------------------------------------------------------
Step '06' 'supervisor configured' {
  $t = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  if (-not $t) { return 'FAIL: scheduled task missing' }
  $act = ($t.Actions | Select-Object -First 1).Arguments
  if ($act -notlike '*supervise.ts*') { return "FAIL: task action is not the supervisor: $act" }
  "task '$TaskName' -> supervise.ts ($($t.State))"
}

# 7. first-run health ------------------------------------------------------------
Step '07' 'first-run health' {
  $j = RunNode (Join-Path (VersionDir) 'deployment\bin\health.ts') @()
  $h = $j | ConvertFrom-Json
  $want = if ($Mode -eq 'Fixture') { @('DEGRADED') } else { @('READY', 'DEGRADED') }
  if ($h.status -in $want) { "status $($h.status) [$($h.reasonCodes -join ',')]" } else { "FAIL: $($h.status) [$($h.reasonCodes -join ',')]" }
}

# 8. generation smoke -------------------------------------------------------------
Step '08' 'local generation smoke' {
  $r = Http 'POST' "$Base/generate" @{ turns = @(@{ role = 'user'; content = 'Sain uu' }); max_tokens = 8; stream = $false } (RtHeaders) 120
  if ($r.status -ne 200) { return "FAIL: /generate $($r.status) $($r.error)" }
  "200"
}

# 9-10. restart ------------------------------------------------------------------
Record '09' 'windows restart' 'BLOCKED' "reboot, sign in, then: acceptance.ps1 -Mode $Mode -Phase 2 -DataDir `"$Root`" -Port $Port -TaskName `"$TaskName`""
Record '10' 'health after restart' 'BLOCKED' 'Phase 2'

# 11. component update ---------------------------------------------------------------
$k2 = Join-Path $Work 'knowledge-v2.sqlite'
Step '11' 'knowledge-only component update (restart chain)' {
  if ($Mode -ne 'Fixture') { return 'BLOCKED: real mode - publish a new knowledge pack, then re-run' }
  New-FixtureKnowledge $k2 $false
  $m = New-ReleaseManifest (Join-Path $Work 'rel-k2.json') 'acc-k2' 'acc-2026.09.12.1' $k2
  $out = RunNode (Join-Path (VersionDir) 'deployment\bin\update.ts') @('--manifest', $m)
  $r = ($out -split "`n" | Select-Object -Last 1) | ConvertFrom-Json
  if ($r.code -ne 'ACTIVATED') { return "FAIL: $($r.code) $($r.detail)" }
  $kp = Get-Content (Join-Path $Root 'knowledge\current.knowledge.json') -Raw | ConvertFrom-Json
  if ($kp.version -ne 'acc-2026.09.12.1') { return "FAIL: pointer $($kp.version)" }
  $i = Http 'GET' "$Base/info" $null (RtHeaders)
  "pointer acc-2026.09.12.1, running knowledge $($i.body.deployment.running.knowledge)"
}

# 12. rollback ------------------------------------------------------------------------
Step '12' 'rollback simulation (sha mismatch, then corrupt knowledge)' {
  if ($Mode -ne 'Fixture') { return 'BLOCKED: real mode' }
  $k3 = Join-Path $Work 'knowledge-v3.sqlite'
  New-FixtureKnowledge $k3 $false
  $m = New-ReleaseManifest (Join-Path $Work 'rel-k3-badsha.json') 'acc-k3' 'acc-2026.09.13.1' $k3 ('f' * 64)
  $out = RunNode (Join-Path (VersionDir) 'deployment\bin\update.ts') @('--manifest', $m)
  $r = ($out -split "`n" | Select-Object -Last 1) | ConvertFrom-Json
  if ($r.code -ne 'SHA_MISMATCH') { return "FAIL: expected SHA_MISMATCH, got $($r.code)" }
  $kp = Get-Content (Join-Path $Root 'knowledge\current.knowledge.json') -Raw | ConvertFrom-Json
  if ($kp.version -ne 'acc-2026.09.12.1') { return "FAIL: pointer moved to $($kp.version)" }
  $k4 = Join-Path $Work 'knowledge-v4.sqlite'
  New-FixtureKnowledge $k4 $true
  $m4 = New-ReleaseManifest (Join-Path $Work 'rel-k4-corrupt.json') 'acc-k4' 'acc-2026.09.14.1' $k4
  $out = RunNode (Join-Path (VersionDir) 'deployment\bin\update.ts') @('--manifest', $m4)
  $r = ($out -split "`n" | Select-Object -Last 1) | ConvertFrom-Json
  if ($r.code -notin @('HEALTH_FAILED_ROLLED_BACK', 'RESTART_FAILED', 'VERSION_MISMATCH')) { return "FAIL: expected rollback, got $($r.code) $($r.detail)" }
  if ($r.rollbackOk -ne $true) { return "FAIL: rollback health not ok ($($r.detail))" }
  $kp = Get-Content (Join-Path $Root 'knowledge\current.knowledge.json') -Raw | ConvertFrom-Json
  if ($kp.version -ne 'acc-2026.09.12.1') { return "FAIL: pointer $($kp.version) after rollback" }
  $up = (Http 'GET' "$Base/health").status -eq 200
  if (-not $up) { return 'FAIL: runtime not up after rollback' }
  "SHA_MISMATCH kept v2; corrupt v4 -> $($r.code), rolled back to v2, runtime up"
}

# 13. feedback -----------------------------------------------------------------------
Step '13' 'feedback pipeline (message-context stamp)' {
  if (-not $Token) { return 'BLOCKED: -Token <ERP JWT> not given' }
  $i = Http 'GET' "$Base/info" $null (RtHeaders)
  $d = $i.body.deployment
  $r = Http 'POST' "$ControlPlane/api/mgl-ai/fleet/message-context" @{ msg_uid = ('acc_' + [guid]::NewGuid().ToString('N').Substring(0, 16)); conv_uid = 'acc'; installation_id = $d.installation_id; channel = $d.channel; versions = $d.versions } @{ Authorization = "Bearer $Token" }
  if ($r.status -ne 200) { return "FAIL: message-context $($r.status)" }
  "200 installation $($d.installation_id)"
}

# 14. fleet heartbeat ------------------------------------------------------------------
Step '14' 'fleet heartbeat' {
  if (-not $Token) { return 'BLOCKED: -Token <ERP JWT> not given' }
  $p = Http 'POST' "$Base/pair" @{ token = $Token } (RtHeaders)
  if ($p.status -ne 200) { return "FAIL: /pair $($p.status)" }
  $h = Http 'POST' "$Base/deploy/heartbeat" $null (RtHeaders) 60
  if ($h.status -ne 200 -or -not $h.body.sent) { return "FAIL: heartbeat $($h.status) $($h.body.reason)" }
  "sent (check the admin Fleet page)"
}

# 15. repair ----------------------------------------------------------------------------
Step '15' 'repair (force re-activate) + uninstall readiness' {
  if ($Mode -ne 'Fixture') { return 'BLOCKED: real mode - run update.ts --repair by hand' }
  $m = Join-Path $Work 'rel-k2.json'
  $out = RunNode (Join-Path (VersionDir) 'deployment\bin\update.ts') @('--repair', '--manifest', $m)
  $r = ($out -split "`n" | Select-Object -Last 1) | ConvertFrom-Json
  if ($r.code -ne 'ACTIVATED') { return "FAIL: repair $($r.code) $($r.detail)" }
  "repair ACTIVATED; uninstall: acceptance.ps1 -Mode Fixture -Cleanup -DataDir `"$Root`" -TaskName `"$TaskName`""
}

$Results | ConvertTo-Json -Depth 4 | Set-Content -Path (Join-Path $Work 'acceptance-phase1.json') -Encoding utf8
$fails = @($Results | Where-Object { $_.status -eq 'FAIL' }).Count
$blocked = @($Results | Where-Object { $_.status -eq 'BLOCKED' }).Count
Write-Host "`nPhase 1: $fails FAIL, $blocked BLOCKED  (report: $Work\acceptance-phase1.json)"
exit $fails
