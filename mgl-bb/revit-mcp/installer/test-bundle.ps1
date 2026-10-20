# Acceptance harness for MGL-Revit-Addin-<ver>.zip  (PowerShell 5.1; UTF-8 WITH BOM - it matches
# Mongolian result text, and 5.1 reads a BOM-less .ps1 as ANSI)
#
# Extracts the REAL bundle and runs its Install.bat / Uninstall.bat into a throwaway
# APPDATA/LOCALAPPDATA root via MGL_ADDIN_TEST_* env vars - this PC's live Revit
# add-in and registry are never touched.  MGL_ADDIN_TEST_YEARS fakes which Revit
# years are installed.  Scenarios:
#   A. fresh PC (Revit 2025 + 2027)          -> both installed from scratch
#   B. upgrade: 2027 from an old Setup exe (default 1.5.1, versioned folder),
#               2025 from an old zip Install.bat (Addins\2025\RevitMcpAddin)
#   C. re-run the same bundle                -> nothing breaks, reported as verified
#   D. Revit running                         -> still installs side-by-side
#   E. tampered payload                      -> that year fails, old install intact
#   F. Uninstall.bat                         -> manifests + binaries gone, data kept
#   H. same version number, different payload (V03, WE-RISK-002):
#        H1 Revit closed  -> versions\<v> is REPLACED (not silently reused)
#        H2 old DLL locked -> new build goes to versions\<v>-b<sha8>, manifest points there, old folder kept
#        H3 re-run while locked -> that -b folder is reused (same payload)
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File revit-mcp\installer\test-bundle.ps1
[CmdletBinding()]
param(
  [string]$Bundle = '',
  [string]$OldSetupExe = '',
  [string]$OldZip2025 = '',
  # Bundle-ийн setup\install*.ps1-ийг ЭНЭ хавтасны ажлын хуулбараар солино (шинэ bundle барихаас өмнө суулгагчийн засвар турших).
  [switch]$UseWorkingInstaller
)
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$dist = Join-Path $here '..\dist'
if (-not $Bundle) {
  $Bundle = Get-ChildItem -Path $dist -Recurse -Filter 'MGL-Revit-Addin-*.zip' | Sort-Object LastWriteTime -Descending |
    Select-Object -First 1 -ExpandProperty FullName
}
if (-not $OldSetupExe) { $OldSetupExe = Join-Path $dist '1.5.1\MGL-Revit2027-Setup-1.5.1.exe' }
if (-not $OldZip2025)  { $OldZip2025  = Join-Path $dist '1.5.1\RevitMcpAddin-Revit2025.zip' }
foreach ($f in $Bundle, $OldSetupExe, $OldZip2025) { if (-not (Test-Path $f)) { throw "not found: $f" } }
$version = [regex]::Match((Split-Path $Bundle -Leaf), 'Addin-(\d+\.\d+\.\d+)').Groups[1].Value
$oldVer  = [regex]::Match((Split-Path $OldSetupExe -Leaf), 'Setup-(\d+\.\d+\.\d+)').Groups[1].Value

$root = Join-Path $env:TEMP ("mgl-bundle-test-" + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Force -Path $root | Out-Null
$pass = 0; $fail = 0
function Check($cond, $msg) {
  if ($cond) { $script:pass++; Write-Host "  ok    $msg" -ForegroundColor Green }
  else { $script:fail++; Write-Host "  FAIL  $msg" -ForegroundColor Red }
}

$AddInId = '7f3d9c2a-1b4e-4a6f-9c8d-2e5a1b3c4d5e'
function New-Env([string]$name) {
  $e = @{ root = (Join-Path $root $name) }
  $e.appData = Join-Path $e.root 'Roaming'
  $e.local = Join-Path $e.root 'Local'
  $e.result = Join-Path $e.root 'result.txt'
  New-Item -ItemType Directory -Force -Path $e.appData, $e.local | Out-Null
  return $e
}
function Manifest($e, $y) { Join-Path $e.appData "Autodesk\Revit\Addins\$y\RevitMcpAddin.addin" }
function VerDir($e, $y, $v) { Join-Path $e.local "MGL\RevitAddin\$y\versions\$v" }
function Assembly-Of($e, $y) {
  $m = Manifest $e $y
  if (-not (Test-Path $m)) { return $null }
  $x = [regex]::Match([IO.File]::ReadAllText($m), '<Assembly>\s*(.*?)\s*</Assembly>')
  if (-not $x.Success) { return $null }
  $a = [Net.WebUtility]::HtmlDecode($x.Groups[1].Value)
  if (-not [IO.Path]::IsPathRooted($a)) { $a = Join-Path (Split-Path $m) $a }
  return $a
}
function Dll-Version($path) {
  if (-not $path -or -not (Test-Path $path)) { return $null }
  return (Get-Item $path).VersionInfo.FileVersion
}

function Set-TestEnv($e, [hashtable]$extra) {
  $env:MGL_ADDIN_TEST_APPDATA = $e.appData
  $env:MGL_ADDIN_TEST_LOCALAPPDATA = $e.local
  $env:MGL_ADDIN_TEST_QUIET = '1'
  $env:MGL_ADDIN_TEST_NOREG = '1'
  $env:MGL_ADDIN_TEST_RESULT = $e.result
  foreach ($k in $extra.Keys) { Set-Item -Path "env:$k" -Value $extra[$k] }
}
function Clear-TestEnv {
  foreach ($k in 'MGL_ADDIN_TEST_APPDATA', 'MGL_ADDIN_TEST_LOCALAPPDATA', 'MGL_ADDIN_TEST_QUIET', 'MGL_ADDIN_TEST_NOREG',
                 'MGL_ADDIN_TEST_RESULT', 'MGL_ADDIN_TEST_YEARS', 'MGL_ADDIN_TEST_REVIT_RUNNING') {
    Remove-Item -Path "env:$k" -ErrorAction SilentlyContinue
  }
}
function Run-Bat($e, [string]$bat, [hashtable]$extra) {
  Set-TestEnv $e $extra
  if (Test-Path $e.result) { Remove-Item -Force $e.result }
  $p = Start-Process -FilePath 'cmd.exe' -ArgumentList @('/c', '"' + $bat + '"') -PassThru -Wait -WindowStyle Hidden
  Clear-TestEnv
  $out = if (Test-Path $e.result) { Get-Content -Raw -Encoding UTF8 $e.result } else { '' }
  return @{ code = $p.ExitCode; out = $out }
}

try {
  Write-Host "bundle : $Bundle ($version)"
  Write-Host "old    : $OldSetupExe ($oldVer)"
  Write-Host "root   : $root"

  # --- extract exactly like a person would (whole zip) -----------------------------
  $ex = Join-Path $root 'extracted'
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  [IO.Compression.ZipFile]::ExtractToDirectory($Bundle, $ex)
  $top = Join-Path $ex "MGL-Revit-Addin-$version"
  if ($UseWorkingInstaller) {
    foreach ($s in 'install.ps1', 'install-all.ps1') { Copy-Item -Force (Join-Path $here $s) (Join-Path $top "setup\$s") }
    Write-Host "installer: WORKING COPY ($here)"
  }
  $install = Join-Path $top 'Install.bat'
  $uninstall = Join-Path $top 'Uninstall.bat'
  Write-Host "`n--- bundle layout"
  Check (Test-Path $install) 'Install.bat at the bundle root'
  Check (Test-Path $uninstall) 'Uninstall.bat at the bundle root'
  Check (Test-Path (Join-Path $top 'README.txt')) 'README.txt'
  foreach ($y in 2024..2027) {
    Check ((Test-Path (Join-Path $top "setup\$y\payload.zip")) -and (Test-Path (Join-Path $top "setup\$y\release.json"))) "setup\$y payload + release.json"
  }
  $bom = [IO.File]::ReadAllBytes((Join-Path $top 'setup\install-all.ps1'))
  Check ($bom[0] -eq 0xEF -and $bom[1] -eq 0xBB -and $bom[2] -eq 0xBF) 'install-all.ps1 has a UTF-8 BOM (PowerShell 5.1 + Cyrillic)'
  $notes = @(Get-ChildItem -Path $top -Filter '*.txt' | Where-Object { $_.Name -ne 'README.txt' })
  Check ($notes.Count -ge 2) "feature notes present ($($notes.Count)): $((($notes | ForEach-Object Name) -join ', '))"
  Check (@($notes | Where-Object { $_.Name -match '[^\x00-\x7F]' }).Count -eq $notes.Count) 'Mongolian note file names survived the zip'

  # --- A. fresh PC --------------------------------------------------------------------
  Write-Host "`n--- A. fresh PC (Revit 2025 + 2027)"
  $a = New-Env 'A'
  $r = Run-Bat $a $install @{ MGL_ADDIN_TEST_YEARS = '2025,2027' }
  Check ($r.code -eq 0) "Install.bat exit 0 ($($r.code))"
  foreach ($y in '2025', '2027') {
    $asm = Assembly-Of $a $y
    Check ($asm -and $asm.StartsWith((VerDir $a $y $version))) "$y manifest -> versions\$version (absolute)"
    Check ((Dll-Version $asm) -like "$version*") "$y DLL FileVersion $version"
    Check ([IO.File]::ReadAllText((Manifest $a $y)) -match $AddInId) "$y manifest AddInId unchanged"
    $cur = Join-Path $a.local "MGL\RevitAddin\$y\current.json"
    Check ((Test-Path $cur) -and ((Get-Content -Raw $cur | ConvertFrom-Json).version -eq $version)) "$y current.json = $version"
  }
  Check (-not (Test-Path (Manifest $a '2024'))) '2024 (no Revit) untouched'
  Check (-not (Test-Path (Manifest $a '2026'))) '2026 (no Revit) untouched'
  Check ($r.out -match "Revit 2025: [^\r\n]*$version" -and $r.out -match "Revit 2027: [^\r\n]*$version") 'summary names both years'

  # --- B. upgrade from 1.5.1 ------------------------------------------------------------
  Write-Host "`n--- B. upgrade: 2027 from Setup $oldVer, 2025 from zip Install.bat $oldVer"
  $b = New-Env 'B'
  Set-TestEnv $b @{}
  $p = Start-Process -FilePath $OldSetupExe -PassThru -Wait
  Clear-TestEnv
  Check ($p.ExitCode -eq 0) "old Setup $oldVer installed into the test root"
  Check ((Dll-Version (Assembly-Of $b '2027')) -like "$oldVer*") "2027 before: $oldVer"
  # zip-style install: the old zip's RevitMcpAddin folder + relative manifest in Addins\2025
  $z = Join-Path $root 'oldzip'
  [IO.Compression.ZipFile]::ExtractToDirectory($OldZip2025, $z)
  $zipRoot = Split-Path (Get-ChildItem -Path $z -Recurse -Filter 'RevitMcpAddin.addin' | Select-Object -First 1).FullName
  $add25 = Join-Path $b.appData 'Autodesk\Revit\Addins\2025'
  New-Item -ItemType Directory -Force -Path $add25 | Out-Null
  Copy-Item (Join-Path $zipRoot 'RevitMcpAddin') (Join-Path $add25 'RevitMcpAddin') -Recurse
  Copy-Item (Join-Path $zipRoot 'RevitMcpAddin.addin') $add25
  Copy-Item (Join-Path $zipRoot 'release.json') (Join-Path $add25 'RevitMcpAddin\release.json')
  Check ((Dll-Version (Assembly-Of $b '2025')) -like "$oldVer*") "2025 before: $oldVer (zip-style Addins\2025\RevitMcpAddin)"
  # local data that must survive
  $data = Join-Path $b.appData 'RevitMcpAddin'
  New-Item -ItemType Directory -Force -Path (Join-Path $data 'tracking') | Out-Null
  Set-Content -Path (Join-Path $data 'tracking\outbox-x.json') -Value '{"unsynced":1}' -Encoding ascii
  Set-Content -Path (Join-Path $data 'settings.json') -Value '{"token":"keep"}' -Encoding ascii

  $r = Run-Bat $b $install @{ MGL_ADDIN_TEST_YEARS = '2025,2027' }
  Check ($r.code -eq 0) "Install.bat exit 0 ($($r.code))"
  foreach ($y in '2025', '2027') {
    Check ((Dll-Version (Assembly-Of $b $y)) -like "$version*") "$y after: $version"
    Check ($r.out -match "Revit ${y}: $([regex]::Escape($oldVer)) [^\r\n]*$([regex]::Escape($version))") "$y reported as $oldVer -> $version"
  }
  Check (-not (Test-Path (VerDir $b '2027' $oldVer))) "2027 old versions\$oldVer removed"
  Check (-not (Test-Path (Join-Path $add25 'RevitMcpAddin'))) '2025 old zip folder Addins\2025\RevitMcpAddin removed'
  Check (@(Get-ChildItem -Path (Join-Path $b.appData 'Autodesk\Revit\Addins\2025') -Filter *.addin).Count -eq 1) '2025 exactly one manifest (no duplicate add-in)'
  Check ((Get-Content -Raw (Join-Path $data 'tracking\outbox-x.json')) -match 'unsynced') 'unsynced work-time queue kept'
  Check ((Get-Content -Raw (Join-Path $data 'settings.json')) -match 'keep') 'settings / login kept'

  # --- C. run the same bundle again ------------------------------------------------------
  Write-Host "`n--- C. re-run the same bundle"
  $r = Run-Bat $b $install @{ MGL_ADDIN_TEST_YEARS = '2025,2027' }
  Check ($r.code -eq 0) "second Install.bat exit 0 ($($r.code))"
  Check ($r.out -match "Revit 2027: $([regex]::Escape($version))") 'reported as already installed + verified'
  Check ((Dll-Version (Assembly-Of $b '2027')) -like "$version*") '2027 still loads the new DLL'

  # --- D. Revit running ------------------------------------------------------------------
  Write-Host "`n--- D. Revit running"
  $d = New-Env 'D'
  $r = Run-Bat $d $install @{ MGL_ADDIN_TEST_YEARS = '2027'; MGL_ADDIN_TEST_REVIT_RUNNING = '1' }
  Check ($r.code -eq 0) "Install.bat exit 0 with Revit open ($($r.code))"
  Check ((Dll-Version (Assembly-Of $d '2027')) -like "$version*") 'installed side-by-side'
  Check ($r.out -match 'нээлттэй') 'summary tells the user to restart Revit'

  # --- E. tampered payload -----------------------------------------------------------------
  Write-Host "`n--- E. tampered payload (2027) - old install must survive"
  $tam = Join-Path $root 'tampered'
  Copy-Item $top $tam -Recurse
  $pz = Join-Path $tam 'setup\2027\payload.zip'
  $tx = Join-Path $root 'tx'
  [IO.Compression.ZipFile]::ExtractToDirectory($pz, $tx)
  Add-Content -Path (Join-Path $tx 'RevitMcpAddin.dll') -Value 'x' -Encoding ascii
  Remove-Item -Force $pz
  [IO.Compression.ZipFile]::CreateFromDirectory($tx, $pz)
  $e = New-Env 'E'
  Set-TestEnv $e @{}
  $p = Start-Process -FilePath $OldSetupExe -PassThru -Wait
  Clear-TestEnv
  $r = Run-Bat $e (Join-Path $tam 'Install.bat') @{ MGL_ADDIN_TEST_YEARS = '2027' }
  Check ($r.code -ne 0) "Install.bat reports failure ($($r.code))"
  Check ((Dll-Version (Assembly-Of $e '2027')) -like "$oldVer*") "old $oldVer still installed and loadable"
  Check ($r.out -match 'АЛДАА') 'summary shows the error'
  Check (-not (Test-Path (VerDir $e '2027' $version))) 'no half-installed new version folder'

  # --- F. uninstall --------------------------------------------------------------------------
  Write-Host "`n--- F. Uninstall.bat"
  $r = Run-Bat $b $uninstall @{}
  Check ($r.code -eq 0) "Uninstall.bat exit 0 ($($r.code))"
  foreach ($y in '2025', '2027') {
    Check (-not (Test-Path (Manifest $b $y))) "$y manifest removed"
    Check (-not (Test-Path (Join-Path $b.local "MGL\RevitAddin\$y\versions"))) "$y binaries removed"
  }
  Check ((Get-Content -Raw (Join-Path $data 'settings.json')) -match 'keep') 'local data kept after uninstall'

  # --- H. same version, different payload ------------------------------------------------------------
  Write-Host "`n--- H. same version number, different payload (2027)"
  $alt = Join-Path $root 'altbuild'
  Copy-Item $top $alt -Recurse
  $apz = Join-Path $alt 'setup\2027\payload.zip'
  $ax = Join-Path $root 'ax'
  [IO.Compression.ZipFile]::ExtractToDirectory($apz, $ax)
  Set-Content -Path (Join-Path $ax 'ALT-BUILD.txt') -Value 'different payload, same version number' -Encoding ascii
  $altHash = (Get-FileHash -Algorithm SHA256 (Join-Path $ax 'ALT-BUILD.txt')).Hash.ToLower()
  $listPath = Join-Path $ax 'payload.sha256.txt'
  $lines = @([IO.File]::ReadAllLines($listPath) | Where-Object { $_.Trim() }) + ("{0}  {1}" -f $altHash, 'ALT-BUILD.txt')
  [IO.File]::WriteAllText($listPath, (($lines -join "`n") + "`n"), (New-Object Text.UTF8Encoding($false)))
  $altSha = (Get-FileHash -Algorithm SHA256 $listPath).Hash.ToLower()
  foreach ($rj in (Join-Path $ax 'release.json'), (Join-Path $alt 'setup\2027\release.json')) {
    $j = [IO.File]::ReadAllText($rj, [Text.Encoding]::UTF8) | ConvertFrom-Json
    $j.payload_sha256 = $altSha
    [IO.File]::WriteAllText($rj, ($j | ConvertTo-Json -Depth 4), (New-Object Text.UTF8Encoding($false)))
  }
  Remove-Item -Force $apz
  [IO.Compression.ZipFile]::CreateFromDirectory($ax, $apz)
  $altInstall = Join-Path $alt 'Install.bat'

  # H1 - Revit closed: the folder is replaced
  $h = New-Env 'H1'
  $r = Run-Bat $h $install @{ MGL_ADDIN_TEST_YEARS = '2027' }
  Check ($r.code -eq 0) "H1 original install exit 0 ($($r.code))"
  $r = Run-Bat $h $altInstall @{ MGL_ADDIN_TEST_YEARS = '2027' }
  Check ($r.code -eq 0) "H1 alt build install exit 0 ($($r.code))"
  Check (Test-Path (Join-Path (VerDir $h '2027' $version) 'ALT-BUILD.txt')) 'H1 versions\<v> now holds the NEW payload (not silently reused)'
  $cur = Get-Content -Raw (Join-Path $h.local 'MGL\RevitAddin\2027\current.json') | ConvertFrom-Json
  $diskList = Join-Path (VerDir $h '2027' $version) 'payload.sha256.txt'
  $diskSha = if (Test-Path $diskList) { (Get-FileHash -Algorithm SHA256 $diskList).Hash.ToLower() } else { '' }
  Check ($diskSha -eq $altSha -and $cur.payload_sha256 -eq $diskSha) 'H1 current.json payload_sha256 = the payload actually on disk (= new build)'
  Check ($cur.folder -eq $version) "H1 current.json folder = $version"

  # H2 - old DLL locked by a running Revit: immutable per-build folder
  $h2 = New-Env 'H2'
  $r = Run-Bat $h2 $install @{ MGL_ADDIN_TEST_YEARS = '2027' }
  Check ($r.code -eq 0) "H2 original install exit 0 ($($r.code))"
  $oldDll = Join-Path (VerDir $h2 '2027' $version) 'RevitMcpAddin.dll'
  $lock = [IO.File]::Open($oldDll, 'Open', 'Read', 'Read')
  try {
    $r = Run-Bat $h2 $altInstall @{ MGL_ADDIN_TEST_YEARS = '2027'; MGL_ADDIN_TEST_REVIT_RUNNING = '1' }
    Check ($r.code -eq 0) "H2 alt build install exit 0 while the old DLL is locked ($($r.code))"
    $bdir = VerDir $h2 '2027' ("$version-b" + $altSha.Substring(0, 8))
    Check (Test-Path (Join-Path $bdir 'ALT-BUILD.txt')) "H2 new build in versions\$version-b$($altSha.Substring(0, 8))"
    $asm = Assembly-Of $h2 '2027'
    Check ($asm -and $asm.StartsWith($bdir)) 'H2 manifest points at the new build folder'
    Check (Test-Path $oldDll) 'H2 folder in use by the running Revit kept intact'
    $cur = Get-Content -Raw (Join-Path $h2.local 'MGL\RevitAddin\2027\current.json') | ConvertFrom-Json
    $named = if ($cur.folder) { Join-Path (VerDir $h2 '2027' '') $cur.folder } else { VerDir $h2 '2027' $version }
    $namedList = Join-Path $named 'payload.sha256.txt'
    $namedSha = if (Test-Path $namedList) { (Get-FileHash -Algorithm SHA256 $namedList).Hash.ToLower() } else { '' }
    Check ($cur.folder -eq ("$version-b" + $altSha.Substring(0, 8)) -and $namedSha -eq $altSha -and $cur.payload_sha256 -eq $namedSha) 'H2 current.json names the build folder and that folder holds the claimed payload'

    # H3 - re-run the same alt build while still locked: reuse, no error
    $r = Run-Bat $h2 $altInstall @{ MGL_ADDIN_TEST_YEARS = '2027'; MGL_ADDIN_TEST_REVIT_RUNNING = '1' }
    Check ($r.code -eq 0) "H3 re-run exit 0 ($($r.code))"
    Check ((Assembly-Of $h2 '2027').StartsWith($bdir)) 'H3 manifest still points at the same build folder'
  }
  finally { $lock.Close() }

  # --- G. no Revit at all ------------------------------------------------------------------------
  Write-Host "`n--- G. no Revit installed"
  $g = New-Env 'G'
  $r = Run-Bat $g $install @{ MGL_ADDIN_TEST_YEARS = 'none' }
  Check ($r.code -ne 0) "Install.bat exit non-zero ($($r.code))"
  Check ($r.out -match 'олдсонгүй') 'message says Revit was not found'
}
finally {
  Clear-TestEnv
  Write-Host ""
  if ($fail -eq 0) { Write-Host "PASS $pass/$($pass + $fail)" -ForegroundColor Green }
  else { Write-Host "FAIL $fail of $($pass + $fail)  (root kept: $root)" -ForegroundColor Red }
  if ($fail -eq 0) { Remove-Item -Recurse -Force $root -ErrorAction SilentlyContinue }
}
