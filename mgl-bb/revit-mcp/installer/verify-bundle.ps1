# Static content check of MGL-Revit-Addin-<ver>.zip - NO install, nothing outside %TEMP% is touched.
# (ASCII only: Windows PowerShell 5.1 reads a BOM-less .ps1 as ANSI.)
#
# Opens the REAL zip and checks, for every Revit year in it:
#   - the zip sha256 equals the .json sidecar; Install.bat / Uninstall.bat / README / setup\install*.ps1 present;
#   - release.json version/year, payload.sha256.txt hashes every payload file, payload_sha256 matches,
#     the DLL FileVersion equals the bundle version, release.json sits next to the DLL (health report);
#   - which ribbon commands are compiled in: the "common" set must be in every year, the "newer" set
#     (Smart, MGL ajil pane, Family Hub) must be in 2025-2027 and ABSENT in 2024 (net48 build).
# When you add a ribbon command, add its class name to $common / $newer below.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File revit-mcp\installer\verify-bundle.ps1
[CmdletBinding()]
param(
  [string]$Bundle = '',
  [string]$Version = ''
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $Bundle) {
  $Bundle = Get-ChildItem -Path (Join-Path $here '..\dist') -Recurse -Filter 'MGL-Revit-Addin-*.zip' | Sort-Object LastWriteTime -Descending |
    Select-Object -First 1 -ExpandProperty FullName
}
if (-not $Bundle -or -not (Test-Path $Bundle)) { throw "bundle not found: $Bundle" }
if (-not $Version) { $Version = [regex]::Match((Split-Path $Bundle -Leaf), 'Addin-(\d+\.\d+\.\d+)').Groups[1].Value }
if (-not $Version) { throw 'cannot derive the version from the file name; pass -Version' }

$pass = 0; $fail = 0
function Check($cond, $msg) {
  if ($cond) { $script:pass++; Write-Host "  ok    $msg" -ForegroundColor Green }
  else { $script:fail++; Write-Host "  FAIL  $msg" -ForegroundColor Red }
}

$root = Join-Path $env:TEMP ("mgl-verify-" + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Force -Path $root | Out-Null
try {
  $zipInfo = Get-Item $Bundle
  Write-Host ("bundle: {0}  ({1:N1} MB)" -f $zipInfo.FullName, ($zipInfo.Length / 1MB))
  $sha = (Get-FileHash -Algorithm SHA256 $Bundle).Hash.ToLower()
  $metaPath = [IO.Path]::ChangeExtension($Bundle, '.json')
  if (Test-Path $metaPath) {
    $meta = Get-Content -Raw -Encoding UTF8 $metaPath | ConvertFrom-Json
    Check ($meta.sha256 -eq $sha) "zip sha256 equals the .json sidecar ($($sha.Substring(0,16))...)"
    Check ($meta.version -eq $Version) "sidecar version $Version"
  }
  $ex = Join-Path $root 'x'
  [IO.Compression.ZipFile]::ExtractToDirectory($Bundle, $ex)
  $top = Join-Path $ex "MGL-Revit-Addin-$Version"
  Check (Test-Path $top) "single top-level folder MGL-Revit-Addin-$Version"
  foreach ($n in 'Install.bat', 'Uninstall.bat', 'README.txt', 'setup\install.ps1', 'setup\install-all.ps1') {
    Check (Test-Path (Join-Path $top $n)) "file $n"
  }
  $readme = [IO.File]::ReadAllText((Join-Path $top 'README.txt'), [Text.Encoding]::UTF8)
  Check ($readme -match [regex]::Escape($Version)) 'README mentions the version'
  Check ($readme -notmatch '__VERSION__|__YEARS__') 'README placeholders were substituted'
  Write-Host ("  top-level entries: " + ((Get-ChildItem $top | ForEach-Object { $_.Name }) -join ' | '))

  $common = 'SheetNumeratorCommand', 'CloneDrawingsCommand', 'AutoAnnotateCommand', 'BatchSheetCommand', 'CopyToOtherCommand', 'QtoExportCommand', 'AssistantPaneCommand',
            'RebarEndSymbolCommand', 'SectionAnnotationCommand', 'RefreshAnnotationsCommand', 'ScheduleCloneCommand', 'ScheduleSyncCommand', 'RebarShowEdgesCommand', 'RebarShowPickCommand', 'WallElevationCommand', 'RoomPlanBatchCommand', 'RoomPlanFloorCommand', 'FeedbackCommand'
  $newer = 'SmartPublishCommand', 'SmartCountCommand', 'ClashCheckCommand', 'ChangeImpactCommand', 'PreChangeCommand', 'WorkPaneCommand', 'FamilyHubCommand'
  foreach ($y in 2024..2027) {
    Write-Host "`n--- Revit $y"
    $yd = Join-Path $top "setup\$y"
    if (-not (Test-Path (Join-Path $yd 'release.json'))) { Check $false "setup\$y\release.json present"; continue }
    $rel = Get-Content -Raw -Encoding UTF8 (Join-Path $yd 'release.json') | ConvertFrom-Json
    Check ($rel.version -eq $Version -and "$($rel.revit)" -eq "$y") "release.json version=$($rel.version) revit=$($rel.revit)"
    $px = Join-Path $root "p$y"
    [IO.Compression.ZipFile]::ExtractToDirectory((Join-Path $yd 'payload.zip'), $px)
    $listPath = Join-Path $px 'payload.sha256.txt'
    Check (Test-Path $listPath) 'payload.sha256.txt present'
    $listHash = (Get-FileHash -Algorithm SHA256 $listPath).Hash.ToLower()
    Check ($listHash -eq $rel.payload_sha256) 'payload_sha256 = sha256 of the hash list'
    $bad = 0; $n = 0
    foreach ($line in [IO.File]::ReadAllLines($listPath)) {
      if (-not $line.Trim()) { continue }
      $parts = $line -split '\s+', 2
      $f = Join-Path $px $parts[1].Trim()
      $n++
      if (-not (Test-Path $f) -or (Get-FileHash -Algorithm SHA256 $f).Hash.ToLower() -ne $parts[0]) { $bad++ }
    }
    Check ($bad -eq 0 -and $n -eq [int]$rel.files) "all $n payload files match their hashes (release.json says $($rel.files))"
    $dll = Join-Path $px 'RevitMcpAddin.dll'
    Check ((Get-Item $dll).VersionInfo.FileVersion -like "$Version*") "DLL FileVersion $((Get-Item $dll).VersionInfo.FileVersion)"
    Check (Test-Path (Join-Path $px 'release.json')) 'release.json next to the DLL (health report recognises the install)'
    Check (Test-Path (Join-Path $px 'RoomPlan\Python\roomplan_cli.py')) 'offline Python engine packaged (not loaded from developer checkout)'
    Check (Test-Path (Join-Path $px 'RoomPlan\Python\plan_archetypes.py')) 'original adaptive plan library packaged'
    Check (Test-Path (Join-Path $px 'RoomPlan\Python\plan_validation.py')) 'local graph validation module packaged'
    Check (Test-Path (Join-Path $px 'RoomPlan\Python\plan_generator.py')) 'program-driven plan generator packaged'
    Check (Test-Path (Join-Path $px 'RoomPlan\Python\plan_furniture.py')) 'tiered furniture layout packaged'
    if ($y -ne 2024) { Check (Test-Path (Join-Path $px 'RevitMcpAddin.deps.json')) 'deps.json present (net8/net10 isolated load)' }
    $txt = [Text.Encoding]::ASCII.GetString([IO.File]::ReadAllBytes($dll))
    foreach ($t in $common) { Check ($txt.Contains($t)) "$t is in the DLL" }
    foreach ($t in $newer) {
      if ($y -eq 2024) { Check (-not $txt.Contains($t)) "$t correctly absent on Revit 2024 (net48)" }
      else { Check ($txt.Contains($t)) "$t is in the DLL" }
    }
    $sizeMb = ((Get-ChildItem $px -Recurse -File | Measure-Object Length -Sum).Sum / 1MB)
    Write-Host ("  payload: {0} files, {1:N1} MB unpacked" -f $n, $sizeMb)
  }
}
finally {
  Remove-Item -Recurse -Force $root -ErrorAction SilentlyContinue
  Write-Host ""
  if ($fail -eq 0) { Write-Host "VERIFY PASS $pass/$($pass + $fail)" -ForegroundColor Green }
  else { Write-Host "VERIFY FAIL $fail of $($pass + $fail)" -ForegroundColor Red }
}
if ($fail -gt 0) { exit 1 }
