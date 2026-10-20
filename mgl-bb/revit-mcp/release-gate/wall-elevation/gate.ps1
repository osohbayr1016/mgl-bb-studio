# Wall Elevation RELEASE GATE - one command, one decision: PASS / FAIL / NOT VERIFIED.
#
#   powershell -ExecutionPolicy Bypass -File gate.ps1                       # newest candidate, existing live reports
#   powershell -ExecutionPolicy Bypass -File gate.ps1 -BuildCandidate -Live # build HEAD+overlay, install it, run Revit 2024+2027
#
# Stages (each is reported separately; nothing is silently skipped):
#   1. Candidate        - bundle built by build-candidate.ps1 (HEAD + Wall Elevation overlay only)
#   2. Build validation - per year: target runtime, RevitAPI major, command type, no IVT/test code, Release build (AddinInspect)
#   3. Core unit tests  - .NET 10 AND .NET Framework 4.8 (Revit 2024 runtime), incl. regression tests with [KnownBug]
#   4. UI smoke         - WallElevation.UiSmoke (preview dialog, real WPF)
#   5. Synthetic live   - per Revit year: installed add-in == candidate (sha256), scenarios in synthetic golden models
#   6. Real project     - per Revit year, only from a human-signed entry in real-project-validation.json; otherwise NOT VERIFIED
#   7. Decision         - known-issues.json separates pre-existing bugs from new regressions
#
# V04 (2026-10-16): the decision logic lives in gate-lib.ps1 (pure functions) and is covered by gate-selftest.ps1 - every
# known way to get a FALSE PASS (another year's report, another DLL, a partial scenario run, a report claiming PASS over a
# failing scenario, a 2024 sign-off for 2027, a blocking known issue marked 'fixed') has a test there.  Evidence is bound to
# Revit year + Revit build (run.json) + DLL sha256 + candidate tag + complete scenario set.
#
# real-project-validation.json (in the candidate folder), one signed entry per Revit year:
#   { "validations": [ { "year": "2027", "revit_build": "27.2.0.39", "candidate": "<candidate tag>",
#                        "dll_sha256": "<RevitMcpAddin.dll sha256 for that year>", "model": "<disposable copy name>",
#                        "model_version": "<model file sha256 or project revision>", "scenarios": ["<what was checked>"],
#                        "tester": "<person>", "date": "YYYY-MM-DDTHH:MM", "result": "PASS|FAIL", "notes": "..." } ] }
# The gate never writes this file; only a person can sign it.
#
# Never deploys or publishes anything.  ASCII-only on purpose (PowerShell 5.1).

param(
  [string]$Candidate,
  [switch]$BuildCandidate,
  [string[]]$Years = @('2024', '2027'),
  [switch]$Live,
  [switch]$SkipUiSmoke
)

$ErrorActionPreference = 'Stop'
# '-File x.ps1 -Years 2024,2027' arrives as ONE string - split it.
$Years = @($Years | ForEach-Object { $_ -split ',' } | ForEach-Object { $_.Trim() } | Where-Object { $_ })
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$revitMcp = (Resolve-Path (Join-Path $here '..\..')).Path
$utf8 = New-Object Text.UTF8Encoding($false)
. (Join-Path $here 'gate-lib.ps1')
function Say($m) { Write-Host ('[gate] ' + $m) }
function ReadJson($p) { if (Test-Path $p) { return ([IO.File]::ReadAllText($p, [Text.Encoding]::UTF8) | ConvertFrom-Json) } return $null }

$stages = New-Object System.Collections.ArrayList
function Stage($id, $title, $status, $detail, $known) {
  [void]$stages.Add([ordered]@{ id = $id; title = $title; status = $status; detail = $detail; known_ids = @($known | Where-Object { $_ }) })
  Say ("{0,-26} {1,-13} {2}" -f $id, $status, $detail)
}

# ---------- 0. gate self-test ----------
$selfLog = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $here 'gate-selftest.ps1') 2>&1 | Out-String
if ($LASTEXITCODE -ne 0) { Write-Host $selfLog; Say 'FAIL - gate self-test failed; the decision logic cannot be trusted'; exit 1 }

# ---------- 1. candidate ----------
if ($BuildCandidate) {
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ("& '" + (Join-Path $here 'build-candidate.ps1') + "' -Years " + ($Years -join ',') + '; exit $LASTEXITCODE')
  if ($LASTEXITCODE -ne 0) { Say 'FAIL - candidate build failed'; exit 1 }
}
$gateRoot = Join-Path $revitMcp 'dist\gate'
if (-not $Candidate) {
  $c = Get-ChildItem -Path $gateRoot -Directory -ErrorAction SilentlyContinue | Where-Object { Test-Path (Join-Path $_.FullName 'candidate.json') } | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if (-not $c) { Say 'NOT VERIFIED - no candidate (run with -BuildCandidate)'; exit 2 }
  $Candidate = $c.FullName
}
$cand = ReadJson (Join-Path $Candidate 'candidate.json')
Stage 'candidate' 'Candidate bundle' 'PASS' ("{0} (HEAD {1}, overlay {2} files)" -f $cand.tag, $cand.git_head.Substring(0, 8), @($cand.overlay_files).Count) $null
$out = Join-Path $Candidate 'gate'
if (Test-Path $out) { Remove-Item -Recurse -Force $out }
New-Item -ItemType Directory -Force -Path $out | Out-Null
$bundleDir = Join-Path $out 'bundle'
Expand-Archive -Path $cand.zip -DestinationPath $bundleDir -Force
$top = Get-ChildItem -Path $bundleDir -Directory | Select-Object -First 1

# ---------- 2. build validation ----------
$inspectProj = Join-Path $revitMcp 'tests\AddinInspect\AddinInspect.csproj'
& dotnet build $inspectProj -c Release -v q -nologo | Out-Null
$inspectDll = Join-Path $revitMcp 'tests\AddinInspect\bin\Release\net10.0\AddinInspect.dll'
$dllSha = @{}
foreach ($y in $Years) {
  $payload = Join-Path $top.FullName "setup\$y\payload.zip"
  if (-not (Test-Path $payload)) { Stage "build.$y" "Build - Revit $y" 'FAIL' 'payload missing from bundle' $null; continue }
  $pd = Join-Path $out "payload-$y"
  Expand-Archive -Path $payload -DestinationPath $pd -Force
  $dll = Join-Path $pd 'RevitMcpAddin.dll'
  $json = Join-Path $out "inspect-$y.json"
  & dotnet $inspectDll $dll $y --json $json | Out-Null
  $ins = ReadJson $json
  $dllSha[$y] = $ins.sha256
  $fails = @($ins.checks | Where-Object { $_.Status -eq 'FAIL' })
  $warns = @($ins.checks | Where-Object { $_.Status -eq 'WARN' })
  $st = if ($fails.Count -gt 0) { 'FAIL' } elseif ($warns.Count -gt 0) { 'PASS (WARN)' } else { 'PASS' }
  $det = "sha256 " + $ins.sha256.Substring(0, 12) + "; " + (@($ins.checks | ForEach-Object { $_.Id + '=' + $_.Status }) -join ', ')
  # V04: the bundle must contain exactly the DLL recorded when the candidate was built (older candidates have no record).
  $recorded = $null
  if ($cand.dll_sha256 -and $cand.dll_sha256.PSObject.Properties[$y]) { $recorded = [string]$cand.dll_sha256.$y }
  if ($recorded -and $recorded.ToLower() -ne ([string]$ins.sha256).ToLower()) {
    $st = 'FAIL'; $det = "bundle DLL sha256 differs from candidate.json (" + $recorded.Substring(0, 12) + "); " + $det
  }
  Stage "build.$y" "Build validation - Revit $y" $st $det @($(if ($warns.Count -gt 0) { 'WE-RISK-001' }))
}

# ---------- 3. core unit tests ----------
foreach ($t in @(@{ id = 'unit.net10'; proj = 'tests\WallElevation.Tests'; title = 'Core tests (.NET 10)' },
                 @{ id = 'unit.net48'; proj = 'tests\WallElevation.Tests.Net48'; title = 'Core tests (.NET Framework 4.8 = Revit 2024 runtime)' })) {
  $json = Join-Path $out ($t.id + '.json')
  Push-Location (Join-Path $revitMcp $t.proj)
  try { & dotnet run -c Release -- --json $json | Out-Null; $code = $LASTEXITCODE } finally { Pop-Location }
  $u = ReadJson $json
  if (-not $u) { Stage $t.id $t.title 'FAIL' "no result (exit $code)" $null; continue }
  $known = @($u.tests | Where-Object { $_.status -eq 'known' } | ForEach-Object { $_.known_id } | Sort-Object -Unique)
  $st = if ($u.fail -gt 0) { 'FAIL' } elseif ($u.known -gt 0) { 'KNOWN' } else { 'PASS' }
  Stage $t.id $t.title $st ("pass {0}, new failures {1}, known {2}, fixed? {3} ({4})" -f $u.pass, $u.fail, $u.known, $u.fixed, $u.runtime) $known
}

# ---------- 4. UI smoke (per Revit year: the WPF runtime that year's Revit uses, outside Revit) ----------
foreach ($y in $Years) {
  $proj = switch ($y) { '2024' { 'tests\WallElevation.UiSmoke.Net48' } '2027' { 'tests\WallElevation.UiSmoke' } default { $null } }
  $rt = switch ($y) { '2024' { '.NET Framework 4.8' } '2027' { '.NET 10' } default { '' } }
  $title = "UI/UX smoke (WPF preview) - Revit $y runtime"
  if ($SkipUiSmoke) { Stage "ui.smoke.$y" $title 'NOT RUN' 'skipped by -SkipUiSmoke' $null; continue }
  if (-not $proj) { Stage "ui.smoke.$y" $title 'NOT RUN' "no UI smoke twin for the Revit $y runtime" $null; continue }
  Push-Location (Join-Path $revitMcp $proj)
  try { $log = & dotnet run -c Release 2>&1 | Out-String; $code = $LASTEXITCODE } finally { Pop-Location }
  [IO.File]::WriteAllText((Join-Path $out "ui-smoke-$y.log"), $log, $utf8)
  Stage "ui.smoke.$y" $title $(if ($code -eq 0 -and $log -match '(?m)^PASS') { 'PASS' } else { 'FAIL' }) "exit $code ($rt, outside Revit)" $null
}

# ---------- 5. synthetic live ----------
if ($Live) {
  foreach ($y in $Years) {
    if (-not (Test-Path "C:\Program Files\Autodesk\Revit $y\Revit.exe")) { continue }
    Say "installing candidate into Revit $y"
    # The installer REUSES an existing versions\<ver> folder when its own payload is intact (same version = same content is
    # assumed) - a second candidate with the same version number would silently keep the OLD DLL (measured 2026-10-13, and
    # current.json then records the NEW payload hash).  Remove a stale folder first; run-live refuses anyway while Revit is open.
    $verDir = Join-Path $env:LOCALAPPDATA ("MGL\RevitAddin\$y\versions\" + $cand.version)
    $instDll = Join-Path $verDir 'RevitMcpAddin.dll'
    if ((Test-Path $instDll) -and $dllSha[$y] -and ((Get-FileHash $instDll -Algorithm SHA256).Hash.ToLower() -ne $dllSha[$y].ToLower())) {
      Remove-Item -Recurse -Force $verDir
      Say "removed stale $verDir (different DLL)"
    }
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $top.FullName 'setup\install.ps1') -Year $y -Source (Join-Path (Join-Path $top.FullName 'setup') $y) -Quiet
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $here 'run-live.ps1') -Year $y -Phase all -TimeoutMin 60
  }
}
$liveStatus = @{}
$reqDoc = ReadJson (Join-Path $here 'required-scenarios.json')
$required = @($(if ($reqDoc) { $reqDoc.ids } else { @() }))
foreach ($y in $Years) {
  $title = "Synthetic live - Revit $y"
  if (-not (Test-Path "C:\Program Files\Autodesk\Revit $y\Revit.exe")) {
    Stage "live.$y" $title 'NOT RUN' "ENVIRONMENT UNAVAILABLE - Revit $y not installed" $null
    Stage "pdf.$y" "PDF / export - Revit $y" 'NOT RUN' "ENVIRONMENT UNAVAILABLE - Revit $y not installed" $null
    continue
  }
  # V04: evidence must be from THIS year, THIS Revit (run.json) and THIS DLL; the status is recomputed from the scenarios.
  $runsInfo = @()
  $runDirs = Get-ChildItem -Path (Join-Path $env:LOCALAPPDATA "MGL\WeGate\$y") -Directory -ErrorAction SilentlyContinue | Sort-Object Name -Descending
  foreach ($r in $runDirs) {
    $j = ReadJson (Join-Path $r.FullName 'live-report.json')
    if (-not $j) { continue }
    $jobIni = Join-Path $r.FullName 'job.ini'
    $jobSc = if (Test-Path $jobIni) { Read-JobScenarios ([IO.File]::ReadAllText($jobIni, [Text.Encoding]::UTF8)) } else { $null }
    $runsInfo += @{ dir = $r.FullName; report = $j; run = (ReadJson (Join-Path $r.FullName 'run.json')); job_scenarios = $jobSc }
  }
  $pick = Select-LiveReport $runsInfo $y $dllSha[$y]
  if (-not $pick) {
    Stage "live.$y" $title 'NOT RUN' ("no live report for Revit $y with this DLL (sha256 " + $(if ($dllSha[$y]) { $dllSha[$y].Substring(0, 12) } else { '?' }) + ") - run with -Live") $null
    Stage "pdf.$y" "PDF / export - Revit $y" 'NOT RUN' 'no live report for this DLL' $null
    continue
  }
  $rep = $pick.report
  $verdict = Get-LiveVerdict $rep $pick.run $pick.job_scenarios $required
  $known = @($rep.scenarios | ForEach-Object { $_.known_ids } | Where-Object { $_ } | Sort-Object -Unique)
  $sum = @($rep.scenarios | Group-Object status | ForEach-Object { $_.Name + ' ' + $_.Count }) -join ', '
  $st = [string]$verdict.status
  $liveStatus[$y] = $st
  $build = if ($pick.run -and $pick.run.revit_build) { [string]$pick.run.revit_build } else { '?' }
  $notes = @($verdict.notes) -join '; '
  Stage "live.$y" $title $st ("Revit build $build; $sum; run " + $pick.dir + $(if ($notes) { "; $notes" } else { '' })) $known
  # PDF / export is its own status per year (V04); a PASS there still needs the whole live run to be valid.
  $pdfSc = @($rep.scenarios | Where-Object { $_.category -eq 'output' })
  $pdfSt = Get-CategoryStatus @($rep.scenarios) 'output'
  if ($pdfSt -eq 'PASS' -and $st -ne 'PASS' -and $st -ne 'KNOWN') { $pdfSt = 'NOT VERIFIED' }
  Stage "pdf.$y" "PDF / export - Revit $y" $pdfSt ($(if ($pdfSc.Count) { (@($pdfSc | ForEach-Object { $_.id + '=' + $_.status })) -join ', ' } else { 'no PDF/export scenario in the report' })) @($pdfSc | ForEach-Object { $_.known_ids } | Where-Object { $_ } | Sort-Object -Unique)
  # every category in the report gets a line (informational breakdown; the live.<year> stage carries the verdict)
  $order = @('environment', 'generation', 'geometry', 'linked-room', 'leak', 'preview', 'selection', 'editability', 'reliability', 'negative', 'diagnostic')
  $cats = @($rep.scenarios | ForEach-Object { [string]$_.category } | Where-Object { $_ -and $_ -ne 'output' } | Sort-Object -Unique)
  $cats = @($order | Where-Object { $cats -contains $_ }) + @($cats | Where-Object { $order -notcontains $_ })
  foreach ($cat in $cats) {
    $sc = @($rep.scenarios | Where-Object { $_.category -eq $cat })
    $cs = Get-ScenarioStatus $sc
    if ($cs -eq 'PASS' -and $st -ne 'PASS' -and $st -ne 'KNOWN') { $cs = 'NOT VERIFIED' }
    Stage "live.$y.$cat" "  $cat ($y)" $cs ((@($sc | ForEach-Object { $_.id + '=' + $_.status })) -join ', ') @($sc | ForEach-Object { $_.known_ids } | Where-Object { $_ } | Sort-Object -Unique)
  }
}

# ---------- 6. real project ----------
$rp = ReadJson (Join-Path $Candidate 'real-project-validation.json')
foreach ($y in $Years) {
  $rv = Test-RealProject $rp $y $dllSha[$y] $cand.tag
  Stage "real.project.$y" "Real-project validation - Revit $y" $rv.status $rv.detail $null
}

# ---------- 7. decision ----------
$ki = ReadJson (Join-Path $here 'known-issues.json')
# A release-blocking issue that REPRODUCES in this gate blocks whatever its status field says ('fix-candidate', even 'fixed'):
# editing known-issues.json must never be a way to silence a bug that is still there.  (Get-FinalDecision, gate-lib.ps1)
$decision = Get-FinalDecision @($stages | ForEach-Object { [pscustomobject]$_ }) $ki
$final = $decision.final
$reasons = @($decision.reasons)
$hitKnown = @($decision.known_hit)

$report = [ordered]@{
  schema = 'mgl-we-gate-report-v2'
  generated_at = (Get-Date).ToUniversalTime().ToString('o')
  candidate = $cand
  final_status = $final
  reasons = $reasons
  known_issues_reproduced = $hitKnown
  stages = $stages
}
[IO.File]::WriteAllText((Join-Path $out 'gate-report.json'), ($report | ConvertTo-Json -Depth 8), $utf8)

$md = New-Object Text.StringBuilder
[void]$md.AppendLine("# Wall Elevation release gate - $($cand.tag)")
[void]$md.AppendLine('')
[void]$md.AppendLine("**Final release status: $final**")
[void]$md.AppendLine('')
foreach ($r in $reasons) { [void]$md.AppendLine("- $r") }
[void]$md.AppendLine('')
[void]$md.AppendLine('| Stage | Status | Detail | Known issues |')
[void]$md.AppendLine('|---|---|---|---|')
foreach ($s in $stages) { [void]$md.AppendLine("| $($s.title) | $($s.status) | $($s.detail -replace '\|','/') | $(@($s.known_ids) -join ', ') |") }
[void]$md.AppendLine('')
[void]$md.AppendLine('## Known unresolved issues (baseline)')
foreach ($i in $ki.issues) { [void]$md.AppendLine("- **$($i.id)** ($(if ($i.release_blocking) { 'release-blocking' } else { 'non-blocking' }), $($i.status)) - $($i.title)") }
[IO.File]::WriteAllText((Join-Path $out 'gate-report.md'), $md.ToString(), $utf8)

Say "FINAL: $final"
Say ("report: " + (Join-Path $out 'gate-report.md'))
if ($final -eq 'PASS') { exit 0 } elseif ($final -eq 'FAIL') { exit 1 } else { exit 2 }
