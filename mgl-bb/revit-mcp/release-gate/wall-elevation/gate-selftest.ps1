# Self-test of the release-gate decision logic (gate-lib.ps1): every way evidence could produce a FALSE PASS.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File gate-selftest.ps1
#
# Exit 0 = all checks pass.  No Revit, no files, no network.  ASCII-only on purpose (PowerShell 5.1).

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $here 'gate-lib.ps1')

$pass = 0; $fail = 0
function Check($cond, $msg) {
  if ($cond) { $script:pass++; Write-Host "  ok    $msg" -ForegroundColor Green }
  else { $script:fail++; Write-Host "  FAIL  $msg" -ForegroundColor Red }
}
function Scen($id, $status) { [pscustomobject]@{ id = $id; status = $status; category = 'geometry'; known_ids = @() } }
$FX = [pscustomobject]@{ kind = 'synthetic'; generator = 'WallElevation.LiveGate.dll'; generator_sha256 = ('c' * 64); template = 'DefaultMetric.rte'; template_sha256 = ('d' * 64) }
function Rep($year, $sha, $statuses, [string]$filter = '*', [string]$claimed = $null) {
  $sc = @(); $i = 0
  foreach ($s in $statuses) { $i++; $sc += (Scen ("S-$i") $s) }
  $o = [ordered]@{ year = $year; product_sha256 = $sha; scenarios = $sc; scenario_filter = $filter; fixture = $FX }
  if ($claimed) { $o.synthetic_live_status = $claimed } else { $o.synthetic_live_status = (Get-ScenarioStatus $sc) }
  return [pscustomobject]$o
}
function Run($year, $abort = $null) { [pscustomobject]@{ revit_version = $year; revit_build = "$year.2.0.1"; abort = $abort } }

$A = 'a' * 64; $B = 'b' * 64

Write-Host "--- live evidence selection"
$r24 = @{ dir = 'r24'; report = (Rep '2024' $A @('PASS', 'PASS')); run = (Run '2024') }
Check ($null -eq (Select-LiveReport @($r24) '2027' $A)) '2024 report with the same DLL sha does NOT count for 2027'
Check ($null -eq (Select-LiveReport @(@{ dir = 'nr'; report = (Rep '2024' $A @('PASS')); run = $null }) '2027' $A)) '2024 report without run.json does NOT count for 2027 (report year alone decides)'
Check ($null -eq (Select-LiveReport @(@{ dir = 'x'; report = (Rep '2027' $B @('PASS')); run = (Run '2027') }) '2027' $A)) 'report for another DLL build is ignored'
Check ($null -eq (Select-LiveReport @(@{ dir = 'x'; report = (Rep '2027' $A @('PASS')); run = (Run '2024') }) '2027' $A)) 'report whose run.json says another Revit year is ignored'
Check ($null -eq (Select-LiveReport @($r24) '2024' '')) 'no candidate DLL sha -> nothing is selected'
$sel = Select-LiveReport @(@{ dir = 'new'; report = (Rep '2027' $B @('PASS')); run = (Run '2027') }, @{ dir = 'old'; report = (Rep '2027' $A @('PASS')); run = (Run '2027') }) '2027' $A
Check ($sel -and $sel.dir -eq 'old') 'the newest report FOR THIS DLL is chosen, not simply the newest run'

Write-Host "--- live verdict"
Check ((Get-LiveVerdict (Rep '2027' $A @('PASS', 'PASS')) (Run '2027')).status -eq 'PASS') 'complete run, all PASS -> PASS'
Check ((Get-LiveVerdict (Rep '2027' $A @('PASS', 'FAIL') '*' 'PASS') (Run '2027')).status -eq 'FAIL') 'report claims PASS over a failing scenario -> FAIL'
Check ((Get-LiveVerdict (Rep '2027' $A @('PASS') 'GEN-HOST-101') (Run '2027')).status -eq 'NOT VERIFIED') 'partial run (scenario filter) -> NOT VERIFIED even when all PASS'
Check ((Get-LiveVerdict (Rep '2027' $A @()) (Run '2027')).status -eq 'NOT VERIFIED') 'no scenarios -> NOT VERIFIED'
Check ((Get-LiveVerdict (Rep '2027' $A @('PASS')) $null).status -eq 'NOT VERIFIED') 'run.json missing (Revit build unknown) -> NOT VERIFIED'
Check ((Get-LiveVerdict (Rep '2027' $A @('PASS')) (Run '2027' 'timeout')).status -eq 'FAIL') 'aborted run -> FAIL'
Check ((Get-LiveVerdict (Rep '2027' $A @('PASS', 'BLOCKED')) (Run '2027')).status -eq 'NOT VERIFIED') 'BLOCKED scenario -> NOT VERIFIED'
Check ((Get-LiveVerdict (Rep '2027' $A @('PASS', 'KNOWN')) (Run '2027')).status -eq 'KNOWN') 'known pre-existing bug -> KNOWN (decided by known-issues)'
$legacy = [pscustomobject]@{ year = '2027'; product_sha256 = $A; scenarios = @((Scen 'S' 'PASS')); synthetic_live_status = 'PASS'; fixture = $FX }
Check ((Get-LiveVerdict $legacy (Run '2027')).status -eq 'NOT VERIFIED') 'older report without scenario_filter -> completeness unknown -> NOT VERIFIED'
Check ((Get-LiveVerdict $legacy (Run '2027') 'GEN-LINK-101,PDF-FADE-101').status -eq 'NOT VERIFIED') 'older report + job.ini with a scenario filter -> partial -> NOT VERIFIED'
Check ((Get-LiveVerdict $legacy (Run '2027') '*').status -eq 'PASS') 'older report + job.ini scenarios=* -> complete -> PASS'
Check ((Get-LiveVerdict (Rep '2027' $A @('PASS') 'GEN-HOST-101') (Run '2027') '*').status -eq 'NOT VERIFIED') 'report filter wins over job.ini (job.ini cannot widen a partial report)'
Check ((Read-JobScenarios "year=2024`r`nphase=all`r`nscenarios=GEN-LINK-101,RERUN-101`r`n") -eq 'GEN-LINK-101,RERUN-101') 'job.ini scenarios line is read'
$full = Rep '2027' $A @('PASS', 'PASS')
Check ((Get-LiveVerdict $full (Run '2027') $null @('S-1', 'S-2')).status -eq 'PASS') 'every required scenario present -> PASS'
Check ((Get-LiveVerdict $full (Run '2027') $null @('S-1', 'S-2', 'PDF-FADE-101')).status -eq 'NOT VERIFIED') 'a required scenario deleted from the run/code -> NOT VERIFIED'
$planned = Rep '2027' $A @('PASS', 'PASS')
$planned | Add-Member -NotePropertyName scenario_plan -NotePropertyValue @('S-1', 'S-2', 'S-3')
Check ((Get-LiveVerdict $planned (Run '2027')).status -eq 'NOT VERIFIED') 'run stopped early (planned scenario without a result) -> NOT VERIFIED'
$nofx = Rep '2027' $A @('PASS')
$nofx.PSObject.Properties.Remove('fixture')
Check ((Get-LiveVerdict $nofx (Run '2027')).status -eq 'NOT VERIFIED') 'report without fixture identity -> NOT VERIFIED'
$halffx = Rep '2027' $A @('PASS')
$halffx.fixture = [pscustomobject]@{ generator_sha256 = ('c' * 64); template_sha256 = $null }
Check ((Get-LiveVerdict $halffx (Run '2027')).status -eq 'NOT VERIFIED') 'fixture without template sha256 -> NOT VERIFIED'
$mixed = @((Scen 'G' 'PASS'), [pscustomobject]@{ id = 'PDF-1'; status = 'FAIL'; category = 'output'; known_ids = @() })
Check ((Get-CategoryStatus $mixed 'output') -eq 'FAIL') 'PDF/export category status is computed on its own (FAIL)'
Check ((Get-CategoryStatus $mixed 'missing-cat') -eq 'NOT RUN') 'category absent from the report -> NOT RUN'
Check ((Read-JobScenarios "year=2024`nphase=all`n") -eq '*') "job.ini without scenarios= -> '*' (LiveGate default)"
Check ((Read-JobScenarios "scenarios=`n") -eq '*') "empty scenarios= -> '*' (LiveGate treats empty as default)"

Write-Host "--- real-project sign-off"
$tag = '1.46.0-abcdef12'
Check ((Test-RealProject $null '2027' $A $tag).status -eq 'NOT VERIFIED') 'no file -> NOT VERIFIED'
$legacyRp = [pscustomobject]@{ result = 'PASS'; tester = 'x'; model = 'm'; date = '2026-10-16' }
Check ((Test-RealProject $legacyRp '2027' $A $tag).status -eq 'NOT VERIFIED') 'legacy single sign-off without year/DLL -> NOT VERIFIED'
$v24 = [pscustomobject]@{ validations = @([pscustomobject]@{ year = '2024'; dll_sha256 = $A; candidate = $tag; model = 'm'; model_version = 'v1'; scenarios = @('rooms 1-3'); tester = 't'; date = 'd'; revit_build = '24.1'; result = 'PASS' }) }
Check ((Test-RealProject $v24 '2027' $A $tag).status -eq 'NOT VERIFIED') 'a 2024 sign-off does NOT satisfy 2027'
Check ((Test-RealProject $v24 '2024' $A $tag).status -eq 'PASS') 'matching 2024 sign-off satisfies 2024'
Check ((Test-RealProject $v24 '2024' $B $tag).status -eq 'NOT VERIFIED') 'sign-off for another DLL build -> NOT VERIFIED'
Check ((Test-RealProject $v24 '2024' $A 'other-tag').status -eq 'NOT VERIFIED') 'sign-off for another candidate -> NOT VERIFIED'
$noBuild = [pscustomobject]@{ validations = @([pscustomobject]@{ year = '2027'; dll_sha256 = $A; candidate = $tag; model = 'm'; model_version = 'v1'; scenarios = @('x'); tester = 't'; date = 'd'; result = 'PASS' }) }
Check ((Test-RealProject $noBuild '2027' $A $tag).status -eq 'NOT VERIFIED') 'sign-off without the Revit build -> NOT VERIFIED'
$noModelVer = [pscustomobject]@{ validations = @([pscustomobject]@{ year = '2027'; dll_sha256 = $A; candidate = $tag; model = 'm'; scenarios = @('x'); tester = 't'; date = 'd'; revit_build = '27.2'; result = 'PASS' }) }
Check ((Test-RealProject $noModelVer '2027' $A $tag).status -eq 'NOT VERIFIED') 'sign-off without the model fixture version -> NOT VERIFIED'
$noScen = [pscustomobject]@{ validations = @([pscustomobject]@{ year = '2027'; dll_sha256 = $A; candidate = $tag; model = 'm'; model_version = 'v1'; scenarios = @(); tester = 't'; date = 'd'; revit_build = '27.2'; result = 'PASS' }) }
Check ((Test-RealProject $noScen '2027' $A $tag).status -eq 'NOT VERIFIED') 'sign-off without the scenario set -> NOT VERIFIED'
$rpFail = [pscustomobject]@{ validations = @([pscustomobject]@{ year = '2027'; dll_sha256 = $A; candidate = $tag; model = 'm'; model_version = 'v1'; scenarios = @('x'); tester = 't'; date = 'd'; revit_build = '27.2'; result = 'FAIL' }) }
Check ((Test-RealProject $rpFail '2027' $A $tag).status -eq 'FAIL') 'signed FAIL -> FAIL'

Write-Host "--- final decision"
$ki = [pscustomobject]@{ issues = @([pscustomobject]@{ id = 'WE-BUG-X'; release_blocking = $true; status = 'fixed' }, [pscustomobject]@{ id = 'WE-RISK-1'; release_blocking = $false; status = 'open' }) }
function St($id, $status, $known = @()) { [pscustomobject]@{ id = $id; status = $status; known_ids = $known } }
Check ((Get-FinalDecision @((St 'a' 'PASS'), (St 'b' 'PASS')) $ki).final -eq 'PASS') 'all PASS -> PASS'
Check ((Get-FinalDecision @((St 'a' 'PASS'), (St 'b' 'FAIL')) $ki).final -eq 'FAIL') 'one FAIL -> FAIL'
Check ((Get-FinalDecision @((St 'a' 'PASS'), (St 'b' 'NOT RUN')) $ki).final -eq 'NOT VERIFIED') 'NOT RUN -> NOT VERIFIED'
Check ((Get-FinalDecision @((St 'a' 'KNOWN' @('WE-BUG-X'))) $ki).final -eq 'FAIL') "blocking known issue reproduces -> FAIL even with status 'fixed'"
Check ((Get-FinalDecision @((St 'a' 'KNOWN' @('WE-RISK-1'))) $ki).final -eq 'PASS') 'non-blocking known issue -> does not block'
Check ((Get-FinalDecision @() $ki).final -eq 'NOT VERIFIED') 'no stages at all -> NOT VERIFIED (never PASS by default)'

Write-Host ""
if ($fail -eq 0) { Write-Host "PASS $pass/$($pass + $fail)" -ForegroundColor Green; exit 0 }
Write-Host "FAIL $fail of $($pass + $fail)" -ForegroundColor Red
exit 1
