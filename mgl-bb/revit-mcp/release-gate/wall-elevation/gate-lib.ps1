# Wall Elevation release gate - PURE decision functions (dot-sourced by gate.ps1 and gate-selftest.ps1).
#
# V04 (2026-10-16): evidence is bound to the exact environment it came from, so one Revit year can never vouch for
# another and a stale / partial / foreign run can never turn into PASS:
#   - live report : report.year == year AND product_sha256 == this candidate's DLL AND run.json.revit_version == year
#                   AND the run covered ALL scenarios (filter '*', every id of required-scenarios.json and of the report's
#                   own scenario_plan has a result) AND the synthetic fixture is identified (generator + template sha256)
#                   AND it did not abort; the status is RECOMPUTED from the scenario results (a report that claims PASS over
#                   a failing scenario is a FAIL);
#   - real project: one signed entry PER YEAR with the same DLL sha256 and candidate tag (a 2024 sign-off does not count
#                   for 2027; the legacy single-object file without a year counts for nothing);
#   - decision    : any FAIL -> FAIL; a release-blocking known issue that reproduces -> FAIL whatever its status says;
#                   anything NOT RUN / NOT VERIFIED / BLOCKED -> NOT VERIFIED; only then PASS.
# No I/O here (callers read files).  ASCII-only on purpose (PowerShell 5.1).

function Select-LiveReport {
  param([object[]]$Runs, [string]$Year, [string]$DllSha)
  # $Runs: newest first; each @{ dir = <path>; report = <live-report.json object>; run = <run.json object or $null> }
  if (-not $DllSha) { return $null }
  foreach ($r in @($Runs)) {
    if (-not $r -or -not $r.report) { continue }
    if ([string]$r.report.year -ne [string]$Year) { continue }
    if ([string]$r.report.product_sha256 -ne [string]$DllSha) { continue }
    if ($r.run -and $r.run.revit_version -and ([string]$r.run.revit_version -ne [string]$Year)) { continue }
    return $r
  }
  return $null
}

function Get-ScenarioStatus {
  param([object[]]$Scenarios)
  $s = @($Scenarios | Where-Object { $_ })
  if ($s.Count -eq 0) { return 'NOT VERIFIED' }
  if (@($s | Where-Object { $_.status -eq 'FAIL' }).Count -gt 0) { return 'FAIL' }
  if (@($s | Where-Object { $_.status -eq 'BLOCKED' }).Count -gt 0) { return 'NOT VERIFIED' }
  if (@($s | Where-Object { $_.status -eq 'KNOWN' }).Count -gt 0) { return 'KNOWN' }
  if (@($s | Where-Object { $_.status -ne 'PASS' }).Count -gt 0) { return 'NOT VERIFIED' }
  return 'PASS'
}

function Get-LiveVerdict {
  param($Report, $Run, [string]$JobScenarios, [string[]]$Required)
  # returns @{ status; notes = @(...) }
  # $JobScenarios: the 'scenarios=' line of the run's job.ini - only used for older reports that do not carry
  # scenario_filter themselves (measured 2026-10-16: the newest Revit 2024 run of 1.45.0 was a 19-scenario filtered run
  # and the previous gate read it as a full PASS).
  $notes = @()
  $status = Get-ScenarioStatus @($Report.scenarios)
  $claimed = [string]$Report.synthetic_live_status
  if ($claimed -and $claimed -ne $status) {
    $notes += "report claims '$claimed' but its scenarios say '$status'"
    if ($claimed -eq 'PASS' -and $status -ne 'PASS') { $status = 'FAIL' }
  }
  if ($status -eq 'FAIL') { return @{ status = 'FAIL'; notes = $notes } }
  if (-not $Run) { $notes += 'run.json missing - the Revit version/build that ran is unknown'; $status = 'NOT VERIFIED' }
  elseif ($Run.abort) { $notes += ('run aborted: ' + [string]$Run.abort); $status = 'FAIL' }
  $filter = $null
  if ($Report.PSObject.Properties['scenario_filter']) { $filter = [string]$Report.scenario_filter }
  elseif ($JobScenarios) { $filter = $JobScenarios; $notes += 'scenario filter taken from job.ini (older LiveGate report)' }
  if (-not $filter) {
    $notes += 'report has no scenario_filter (older LiveGate) and no job.ini - completeness unknown'
    if ($status -eq 'PASS' -or $status -eq 'KNOWN') { $status = 'NOT VERIFIED' }
  } elseif ($filter -ne '*') {
    $shown = if ($filter.Length -gt 80) { $filter.Substring(0, 80) + '...' } else { $filter }
    $notes += ('partial run (scenario filter ' + $shown + ')')
    if ($status -eq 'PASS' -or $status -eq 'KNOWN') { $status = 'NOT VERIFIED' }
  }
  # every required / planned scenario must have a result (a deleted scenario or a run that stopped early is not a PASS)
  $have = @($Report.scenarios | Where-Object { $_ } | ForEach-Object { [string]$_.id })
  $missing = @()
  foreach ($id in @($Required) + @($(if ($Report.PSObject.Properties['scenario_plan']) { $Report.scenario_plan } else { @() }))) {
    if ($id -and ($have -notcontains [string]$id) -and ($missing -notcontains [string]$id)) { $missing += [string]$id }
  }
  if ($missing.Count -gt 0) {
    $notes += ('missing scenario result(s): ' + (($missing | Select-Object -First 8) -join ', ') + $(if ($missing.Count -gt 8) { ' ...' } else { '' }))
    if ($status -eq 'PASS' -or $status -eq 'KNOWN') { $status = 'NOT VERIFIED' }
  }
  # the synthetic fixture the scenarios ran on must be identified (generator build + Revit template)
  $fx = if ($Report.PSObject.Properties['fixture']) { $Report.fixture } else { $null }
  if (-not $fx -or -not $fx.generator_sha256 -or -not $fx.template_sha256) {
    $notes += 'fixture identity missing (generator / template sha256) - evidence not bound to a fixture'
    if ($status -eq 'PASS' -or $status -eq 'KNOWN') { $status = 'NOT VERIFIED' }
  }
  return @{ status = $status; notes = $notes }
}

function Read-JobScenarios {
  param([string]$JobIniText)
  # 'scenarios=' value of a LiveGate job.ini ('*' when the key is absent - that is LiveGate's own default)
  if ($null -eq $JobIniText) { return $null }
  foreach ($line in ($JobIniText -split "`r?`n")) {
    $l = $line.Trim()
    if ($l -match '^scenarios\s*=\s*(.*)$') { $v = $Matches[1].Trim(); if ($v) { return $v } else { return '*' } }
  }
  return '*'
}

function Get-CategoryStatus {
  param([object[]]$Scenarios, [string]$Category)
  # status of one scenario category ('output' = PDF / export); NOT RUN when the report has none of it
  $sc = @($Scenarios | Where-Object { $_ -and [string]$_.category -eq $Category })
  if ($sc.Count -eq 0) { return 'NOT RUN' }
  return (Get-ScenarioStatus $sc)
}

function Test-RealProject {
  param($Doc, [string]$Year, [string]$DllSha, [string]$Tag)
  # returns @{ status; detail }
  if (-not $Doc) { return @{ status = 'NOT VERIFIED'; detail = 'no real-project-validation.json' } }
  if (-not $Doc.PSObject.Properties['validations']) {
    return @{ status = 'NOT VERIFIED'; detail = "legacy sign-off without Revit year / DLL sha256 cannot vouch for Revit $Year" }
  }
  $forYear = @($Doc.validations | Where-Object { [string]$_.year -eq [string]$Year })
  if ($forYear.Count -eq 0) { return @{ status = 'NOT VERIFIED'; detail = "no signed real-project test for Revit $Year (other years do not count)" } }
  foreach ($v in $forYear) {
    if ([string]$v.dll_sha256 -ne [string]$DllSha) { continue }
    if ($Tag -and [string]$v.candidate -ne [string]$Tag) { continue }
    if (-not $v.tester -or -not $v.model -or -not $v.date -or -not $v.revit_build) { continue }
    if (-not $v.model_version -or @($v.scenarios | Where-Object { $_ }).Count -eq 0) { continue }
    if ([string]$v.result -eq 'PASS') { return @{ status = 'PASS'; detail = ("{0} on Revit {1} build {2} by {3} ({4})" -f $v.model, $Year, $v.revit_build, $v.tester, $v.date) } }
    if ([string]$v.result -eq 'FAIL') { return @{ status = 'FAIL'; detail = ("{0} on Revit {1} by {2}: FAIL" -f $v.model, $Year, $v.tester) } }
  }
  return @{ status = 'NOT VERIFIED'; detail = "Revit $Year sign-off is for another build / candidate or incomplete (needs dll_sha256, candidate, model, model_version, scenarios, tester, date, revit_build)" }
}

function Get-FinalDecision {
  param([object[]]$Stages, $KnownIssues)
  $blocking = @($KnownIssues.issues | Where-Object { $_.release_blocking } | ForEach-Object { $_.id })
  $hit = @($Stages | ForEach-Object { $_.known_ids } | Where-Object { $_ } | Sort-Object -Unique)
  $hitBlocking = @($hit | Where-Object { $blocking -contains $_ })
  $failed = @($Stages | Where-Object { $_.status -eq 'FAIL' })
  $unverified = @($Stages | Where-Object { @('NOT RUN', 'NOT VERIFIED', 'BLOCKED') -contains $_.status })
  $final = if ($failed.Count -gt 0 -or $hitBlocking.Count -gt 0) { 'FAIL' } elseif ($unverified.Count -gt 0) { 'NOT VERIFIED' } elseif (@($Stages).Count -eq 0) { 'NOT VERIFIED' } else { 'PASS' }
  $reasons = @()
  foreach ($f in $failed) { $reasons += ('new failure: ' + $f.id) }
  foreach ($k in $hitBlocking) { $reasons += ('release-blocking known issue still reproduces: ' + $k) }
  foreach ($u in $unverified) { $reasons += ('not verified: ' + $u.id) }
  if (@($Stages).Count -eq 0) { $reasons += 'no stage ran' }
  return @{ final = $final; reasons = $reasons; known_hit = $hit }
}
