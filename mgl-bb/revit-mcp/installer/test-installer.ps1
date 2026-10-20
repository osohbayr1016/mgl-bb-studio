# Acceptance harness for MGL-Revit2027-Setup-<ver>.exe  (ASCII-only, PowerShell 5.1)
#
# Runs the REAL exe (IExpress -> run.cmd -> install.ps1) into a throwaway
# APPDATA/LOCALAPPDATA root via MGL_ADDIN_TEST_* env vars, so this PC's live
# Revit add-in and registry are never touched (registry writes are only
# exercised when -WithRegistry is passed, and removed again at the end).
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File revit-mcp\installer\test-installer.ps1
[CmdletBinding()]
param(
  [string]$Exe = '',
  [switch]$WithRegistry
)
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $Exe) {
  $Exe = Get-ChildItem -Path (Join-Path $here '..\dist') -Recurse -Filter 'MGL-Revit2027-Setup-*.exe' |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1 -ExpandProperty FullName
}
if (-not (Test-Path $Exe)) { throw "installer not found: $Exe" }
$version = [regex]::Match((Split-Path $Exe -Leaf), 'Setup-(\d+\.\d+\.\d+)').Groups[1].Value

$root = Join-Path $env:TEMP ("mgl-setup-test-" + [guid]::NewGuid().ToString('N').Substring(0, 8))
$appData = Join-Path $root 'Roaming'
$local = Join-Path $root 'Local'
$result = Join-Path $root 'result.txt'
New-Item -ItemType Directory -Force -Path $appData, $local | Out-Null

$addins = Join-Path $appData 'Autodesk\Revit\Addins\2027'
$manifest = Join-Path $addins 'RevitMcpAddin.addin'
$instRoot = Join-Path $local 'MGL\RevitAddin\2027'
$verDir = Join-Path $instRoot "versions\$version"
$dataDir = Join-Path $appData 'RevitMcpAddin'

$pass = 0; $fail = 0
function Check($cond, $msg) {
  if ($cond) { $script:pass++; Write-Host "  ok    $msg" -ForegroundColor Green }
  else { $script:fail++; Write-Host "  FAIL  $msg" -ForegroundColor Red }
}

function Run-Exe([hashtable]$extraEnv = @{}) {
  $env:MGL_ADDIN_TEST_APPDATA = $appData
  $env:MGL_ADDIN_TEST_LOCALAPPDATA = $local
  $env:MGL_ADDIN_TEST_QUIET = '1'
  $env:MGL_ADDIN_TEST_RESULT = $result
  $env:MGL_ADDIN_TEST_NOREG = if ($WithRegistry) { '' } else { '1' }
  foreach ($k in $extraEnv.Keys) { Set-Item -Path "env:$k" -Value $extraEnv[$k] }
  if (Test-Path $result) { Remove-Item $result -Force }
  $p = Start-Process -FilePath $Exe -PassThru -Wait
  foreach ($k in $extraEnv.Keys) { Remove-Item -Path "env:$k" -ErrorAction SilentlyContinue }
  $out = if (Test-Path $result) { Get-Content -Raw -Encoding UTF8 $result } else { '' }
  return @{ code = $p.ExitCode; out = $out }
}

function Run-Uninstall([switch]$Purge) {
  $script = Join-Path $instRoot 'uninstall.ps1'
  $args = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $script, '-Uninstall', '-Quiet')
  if ($Purge) { $args += '-PurgeData' }
  $p = Start-Process -FilePath 'powershell.exe' -ArgumentList $args -PassThru -Wait -WindowStyle Hidden
  return $p.ExitCode
}

try {
  Write-Host "installer: $Exe ($version)"
  Write-Host "test root: $root"

  # 0. The exe never asks for elevation (IExpress stub manifest = asInvoker).
  $bytes = [IO.File]::ReadAllBytes($Exe)
  $text = [Text.Encoding]::ASCII.GetString($bytes)
  Check ($text -match 'requestedExecutionLevel\s+level="asInvoker"') 'exe manifest: asInvoker (no UAC prompt)'
  Check ($text -notmatch 'requireAdministrator') 'exe manifest: no requireAdministrator'

  # 1. Legacy dev/zip install present: relative manifest + DLL folder in Addins.
  New-Item -ItemType Directory -Force -Path (Join-Path $addins 'RevitMcpAddin') | Out-Null
  Set-Content -Path (Join-Path $addins 'RevitMcpAddin\RevitMcpAddin.dll') -Value 'old' -Encoding ascii
  @'
<?xml version="1.0" encoding="utf-8"?>
<RevitAddIns><AddIn Type="Application"><Name>Revit MCP</Name><Assembly>RevitMcpAddin\RevitMcpAddin.dll</Assembly><AddInId>7f3d9c2a-1b4e-4a6f-9c8d-2e5a1b3c4d5e</AddInId><FullClassName>RevitMcpAddin.App</FullClassName><VendorId>com.revitmcp</VendorId></AddIn></RevitAddIns>
'@ | Set-Content -Path $manifest -Encoding UTF8
  # An older versioned install to be cleaned up + unsynced local data that must survive.
  New-Item -ItemType Directory -Force -Path (Join-Path $instRoot 'versions\1.3.9'), (Join-Path $dataDir 'tracking') | Out-Null
  Set-Content -Path (Join-Path $instRoot 'versions\1.3.9\RevitMcpAddin.dll') -Value 'x' -Encoding ascii
  Set-Content -Path (Join-Path $dataDir 'tracking\outbox-abc.json') -Value '{"segments":[1]}' -Encoding ascii

  Write-Host "`n--- clean install over a legacy install"
  $r = Run-Exe
  Check ($r.code -eq 0) "exit code 0 ($($r.code))"
  Check ($r.out -match 'Info\|') "success message ($($r.out.Trim().Split("`n")[0]))"
  Check (Test-Path (Join-Path $verDir 'RevitMcpAddin.dll')) 'DLL installed in versioned per-user folder'
  Check (Test-Path (Join-Path $verDir 'RevitMcpAddin.deps.json')) 'deps.json shipped'
  Check (Test-Path (Join-Path $verDir 'RevitMcpAddin.runtimeconfig.json')) 'runtimeconfig.json shipped'
  Check (Test-Path (Join-Path $verDir 'Microsoft.CodeAnalysis.CSharp.Scripting.dll')) 'Roslyn scripting shipped'
  Check (Test-Path (Join-Path $verDir 'Microsoft.Web.WebView2.Wpf.dll')) 'WebView2 managed DLL shipped'
  Check (Test-Path (Join-Path $verDir 'runtimes\win-x64\native\WebView2Loader.dll')) 'native WebView2Loader (x64) shipped'
  Check (-not (Get-ChildItem -Path $verDir -Recurse -Filter *.pdb)) 'no .pdb in payload'
  Check (Test-Path (Join-Path $verDir 'release.json')) 'release.json next to DLL (health check)'
  $rel = Get-Content -Raw (Join-Path $verDir 'release.json') | ConvertFrom-Json
  Check ($rel.version -eq $version) "release.json version $($rel.version)"
  Check ($rel.api_host -eq 'https://mgl-progress-api.mglenc-design.workers.dev') "release api_host $($rel.api_host)"
  $fv = (Get-Item (Join-Path $verDir 'RevitMcpAddin.dll')).VersionInfo.FileVersion
  Check ($fv -like "$version*") "DLL FileVersion $fv"
  # UTF-16 user strings may start at an odd byte offset - decode both alignments.
  $dllBytes = [IO.File]::ReadAllBytes((Join-Path $verDir 'RevitMcpAddin.dll'))
  $dllText = [Text.Encoding]::Unicode.GetString($dllBytes) + [Text.Encoding]::Unicode.GetString($dllBytes, 1, $dllBytes.Length - 1)
  Check ($dllText.Contains('https://mgl-progress-api.mglenc-design.workers.dev')) 'production API host compiled into the DLL'
  Check ($dllText.Contains('/api/revit/tracking/sync')) 'tracking client compiled into the DLL'

  $xml = [xml](Get-Content -Raw $manifest)
  $asm = $xml.RevitAddIns.AddIn.Assembly
  Check ([IO.Path]::IsPathRooted($asm) -and (Test-Path $asm)) "manifest Assembly is absolute and exists ($asm)"
  Check ($xml.RevitAddIns.AddIn.AddInId -eq '7f3d9c2a-1b4e-4a6f-9c8d-2e5a1b3c4d5e') 'manifest keeps the AddInId (replaces, never duplicates)'
  $ours = @(Get-ChildItem -Path $addins -Filter *.addin | Where-Object { (Get-Content -Raw $_.FullName) -match '7f3d9c2a-1b4e-4a6f-9c8d-2e5a1b3c4d5e' })
  Check ($ours.Count -eq 1) "exactly one manifest with our AddInId ($($ours.Count))"
  Check (-not (Test-Path (Join-Path $addins 'RevitMcpAddin'))) 'legacy Addins\2027\RevitMcpAddin folder removed (no stale DLLs)'
  Check (-not (Test-Path (Join-Path $instRoot 'versions\1.3.9'))) 'older version folder cleaned up'
  Check (Test-Path (Join-Path $instRoot 'uninstall.ps1')) 'uninstaller placed'
  Check (Test-Path (Join-Path $dataDir 'tracking\outbox-abc.json')) 'unsynced tracking queue preserved'
  $firstBytes = [IO.File]::ReadAllBytes($manifest)[0..2]
  Check (-not ($firstBytes[0] -eq 0xEF)) 'manifest written without BOM'

  Write-Host "`n--- reinstall same version (idempotent)"
  $stamp = (Get-Item (Join-Path $verDir 'RevitMcpAddin.dll')).LastWriteTimeUtc
  $r = Run-Exe
  Check ($r.code -eq 0) "exit code 0 ($($r.code))"
  Check ((Get-Item (Join-Path $verDir 'RevitMcpAddin.dll')).LastWriteTimeUtc -eq $stamp) 'identical version reused, files untouched'
  Check (@(Get-ChildItem -Path $addins -Filter *.addin).Count -eq 1) 'still exactly one manifest'

  Write-Host "`n--- Revit running with the current version loaded (DLL locked)"
  $lock = [IO.File]::Open((Join-Path $verDir 'RevitMcpAddin.dll'), 'Open', 'Read', 'Read')
  try {
    New-Item -ItemType Directory -Force -Path (Join-Path $instRoot 'versions\1.3.8') | Out-Null
    Set-Content -Path (Join-Path $instRoot 'versions\1.3.8\RevitMcpAddin.dll') -Value 'y' -Encoding ascii
    $lock2 = [IO.File]::Open((Join-Path $instRoot 'versions\1.3.8\RevitMcpAddin.dll'), 'Open', 'Read', 'Read')
    try {
      $r = Run-Exe @{ MGL_ADDIN_TEST_REVIT_RUNNING = '1' }
      Check ($r.code -eq 0) "install succeeds while Revit is running ($($r.code))"
      Check ($r.out -match 'Revit 2027') 'message tells the user to restart Revit'
      Check (Test-Path (Join-Path $instRoot 'versions\1.3.8')) 'version in use by the running Revit is left alone'
    } finally { $lock2.Dispose() }
  } finally { $lock.Dispose() }
  $r = Run-Exe
  Check (-not (Test-Path (Join-Path $instRoot 'versions\1.3.8'))) 'left-over version cleaned on the next install'

  Write-Host "`n--- corrupted payload is refused, old install kept"
  # Tamper: a different payload cannot be produced from the exe, so check the guard directly.
  $tmp = Join-Path $root 'tamper'
  New-Item -ItemType Directory -Force -Path $tmp | Out-Null
  & "$Exe" /C /T:$tmp /Q | Out-Null
  $deadline = (Get-Date).AddSeconds(60)
  while (-not (Test-Path (Join-Path $tmp 'payload.zip')) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 300 }
  Start-Sleep -Milliseconds 500
  Check (Test-Path (Join-Path $tmp 'install.ps1')) 'exe extracts install.ps1 (/C /T)'
  $bom = [IO.File]::ReadAllBytes((Join-Path $tmp 'install.ps1'))[0..2]
  Check ($bom[0] -eq 0xEF -and $bom[1] -eq 0xBB -and $bom[2] -eq 0xBF) 'staged install.ps1 has UTF-8 BOM (PowerShell 5.1 + Cyrillic)'
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $zip = [IO.Compression.ZipFile]::Open((Join-Path $tmp 'payload.zip'), 'Update')
  try {
    $entry = $zip.Entries | Where-Object { $_.FullName -like '*RevitMcpAddin.dll' } | Select-Object -First 1
    $name = $entry.FullName; $entry.Delete()
    $new = $zip.CreateEntry($name); $w = New-Object IO.StreamWriter($new.Open()); $w.Write('tampered'); $w.Dispose()
  } finally { $zip.Dispose() }
  # Simulate a new version so the tampered payload would be installed side-by-side.
  $relTmp = Get-Content -Raw (Join-Path $tmp 'release.json') | ConvertFrom-Json
  $relTmp.version = '9.9.9'
  [IO.File]::WriteAllText((Join-Path $tmp 'release.json'), ($relTmp | ConvertTo-Json), (New-Object Text.UTF8Encoding($false)))
  $env:MGL_ADDIN_TEST_APPDATA = $appData; $env:MGL_ADDIN_TEST_LOCALAPPDATA = $local; $env:MGL_ADDIN_TEST_QUIET = '1'; $env:MGL_ADDIN_TEST_NOREG = '1'; $env:MGL_ADDIN_TEST_RESULT = $result
  if (Test-Path $result) { Remove-Item $result -Force }
  $p = Start-Process powershell.exe -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $tmp 'install.ps1')) -PassThru -Wait -WindowStyle Hidden
  Check ($p.ExitCode -ne 0) "tampered payload rejected (exit $($p.ExitCode))"
  Check (-not (Test-Path (Join-Path $instRoot 'versions\9.9.9'))) 'tampered version not installed'
  Check ((Get-Content -Raw $manifest) -match [regex]::Escape($version)) "manifest still points at $version"

  if ($WithRegistry) {
    Write-Host "`n--- registry (HKCU, per-user)"
    $key = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\MGL.RevitAddin.2027'
    $r = Run-Exe
    $reg = Get-ItemProperty -Path $key -ErrorAction SilentlyContinue
    Check ($reg -and $reg.DisplayVersion -eq $version) "Apps & features entry, version $($reg.DisplayVersion)"
    Check ($reg -and $reg.UninstallString -match 'uninstall\.ps1') 'UninstallString points at the per-user uninstaller'
  }

  Write-Host "`n--- uninstall keeps data, purge removes it"
  $code = Run-Uninstall
  Check ($code -eq 0) "uninstall exit 0 ($code)"
  Check (-not (Test-Path $manifest)) 'manifest removed'
  Check (-not (Test-Path (Join-Path $instRoot 'versions'))) 'binaries removed'
  Check (Test-Path (Join-Path $dataDir 'tracking\outbox-abc.json')) 'unsynced queue kept after uninstall'
  if ($WithRegistry) {
    Check (-not (Test-Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\MGL.RevitAddin.2027')) 'registry entry removed'
  }
  $r = Run-Exe
  Check ($r.code -eq 0 -and (Test-Path (Join-Path $verDir 'RevitMcpAddin.dll'))) 'reinstall after uninstall works'
  $code = Run-Uninstall -Purge
  Check (-not (Test-Path $dataDir)) 'uninstall -PurgeData removes local data'
}
finally {
  foreach ($k in 'MGL_ADDIN_TEST_APPDATA', 'MGL_ADDIN_TEST_LOCALAPPDATA', 'MGL_ADDIN_TEST_QUIET', 'MGL_ADDIN_TEST_RESULT', 'MGL_ADDIN_TEST_NOREG', 'MGL_ADDIN_TEST_REVIT_RUNNING') {
    Remove-Item -Path "env:$k" -ErrorAction SilentlyContinue
  }
  if ($WithRegistry) { Remove-Item -Recurse -Force 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\MGL.RevitAddin.2027' -ErrorAction SilentlyContinue }
  Remove-Item -Recurse -Force $root -ErrorAction SilentlyContinue
}

Write-Host ""
if ($fail -eq 0) { Write-Host "PASS $pass/$($pass + $fail)" -ForegroundColor Green; exit 0 }
Write-Host "FAIL $pass/$($pass + $fail)" -ForegroundColor Red
exit 1
