# MGL Revit add-in - build ONE distributable zip for ALL Revit years (2024-2027).
#
# ASCII-ONLY BY DESIGN (Windows PowerShell 5.1 reads a BOM-less .ps1 as ANSI).
# Mongolian text lives in install.ps1 / install-all.ps1 / bundle-README.txt, which
# this script copies WITH a UTF-8 BOM.
#
# WHY: every earlier hand-off was a folder of 5+ files (Setup exe for 2027 only,
# four per-year zips each with its own Install.bat) and the person installing had
# to pick the right one.  The bundle is one zip -> extract -> Install.bat, which
# (setup\install-all.ps1) finds every installed Revit year and, per year, runs
# the SAME per-user installer as the Setup exe (install.ps1 -Year <year>):
# hash-checked versioned folder, atomic manifest swap, old install (zip-style
# Addins\<year>\RevitMcpAddin or an older versions\<x> folder) cleaned up.
# An old version is UPGRADED; no install -> FRESH install.  Same AddInId and
# manifest name as every earlier install, so no duplicate add-in can appear.
#
# Usage (from repo root):
#   powershell -NoProfile -ExecutionPolicy Bypass -File revit-mcp\installer\build-bundle.ps1 -Build
#   ... -Include 'revit-mcp\dist\1.6.0\demo'     (extra files/folders copied to the bundle root)
# Output:
#   revit-mcp\dist\<version>\MGL-Revit-Addin-<version>.zip  (+ .json with sha256)
[CmdletBinding()]
param(
  [switch]$Build,
  # Build in a PRIVATE copy of addin\ (own obj\bin) and package from there.  The shared addin\obj is an
  # incremental state that other builds also write; when it is half-written the WPF two-pass markup compile
  # dies with "BG1002 ...\obj\x64\Release R24\<Window>.baml cannot be found" (measured 2026-10-01) and a
  # concurrent build by another agent can corrupt it mid-run.  A private copy has neither problem.
  [switch]$Isolated,
  [switch]$Force,
  [string[]]$Years = @('2024', '2025', '2026', '2027'),
  # Extra files/folders for the bundle root (feature notes, demo models).  Every
  # *.txt in dist\<version>\ is included automatically.
  [string[]]$Include = @(),
  [ValidateSet("prod","qa")][string]$Channel = "prod"
)
$ErrorActionPreference = 'Stop'
$here     = Split-Path -Parent $MyInvocation.MyCommand.Path
$addinDir = (Resolve-Path (Join-Path $here '..\addin')).Path
$proj     = Join-Path $addinDir 'RevitMcpAddin.csproj'
$distRoot = Join-Path (Split-Path $addinDir -Parent) 'dist'
$apiHost  = 'https://mgl-progress-api.mglenc-design.workers.dev'
$cfgMap   = @{ '2024' = 'R24'; '2025' = 'R25'; '2026' = 'R26'; '2027' = 'R27' }

$csprojXml = [xml](Get-Content -Raw -Path $proj)
$version = ([string[]]($csprojXml.Project.PropertyGroup.Version | Where-Object { $_ }))[0].Trim()
if ($version -notmatch '^\d+\.\d+\.\d+$') { throw "csproj <Version> not readable: '$version'" }

# -Isolated: compile (and read bin\) from a throwaway copy of addin\ instead of the shared tree.
$buildDir = $addinDir
$isoRoot = $null
if ($Isolated) {
  $isoRoot = Join-Path $env:TEMP "mgl-addin-iso-$version"
  if (Test-Path $isoRoot) { Remove-Item -Recurse -Force $isoRoot }
  $buildDir = Join-Path $isoRoot 'addin'
  New-Item -ItemType Directory -Force -Path $buildDir | Out-Null
  & robocopy $addinDir $buildDir /MIR /XD obj bin /XF '*_wpftmp*' /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "robocopy of addin\ failed (exit $LASTEXITCODE)" }
  Write-Host "== isolated build copy: $buildDir" -ForegroundColor Cyan
}
$buildProj = Join-Path $buildDir 'RevitMcpAddin.csproj'

$distDir = Join-Path $distRoot $version
New-Item -ItemType Directory -Force -Path $distDir | Out-Null
$name    = "MGL-Revit-Addin-$version"
$zipPath = Join-Path $distDir "$name.zip"
if ((Test-Path $zipPath) -and -not $Force) { throw "$zipPath exists - bump <Version> or pass -Force" }

$gitSha = 'unknown'; $gitDirty = $false
try {
  $repo = (Resolve-Path (Join-Path $here '..\..')).Path
  $sha = & git -C $repo rev-parse HEAD 2>$null
  if ($LASTEXITCODE -eq 0 -and $sha) { $gitSha = $sha.Trim() }
  $dirty = & git -C $repo status --porcelain 2>$null
  if ($LASTEXITCODE -eq 0 -and $dirty) { $gitDirty = $true }
} catch { }

$utf8Bom = New-Object Text.UTF8Encoding($true)
$utf8    = New-Object Text.UTF8Encoding($false)
$stageRoot = Join-Path $env:TEMP "mgl-revit-bundle-$version"
if (Test-Path $stageRoot) { Remove-Item -Recurse -Force $stageRoot }
$stage = Join-Path $stageRoot $name
$setup = Join-Path $stage 'setup'
New-Item -ItemType Directory -Force -Path $setup | Out-Null
$builtAt = (Get-Date).ToUniversalTime().ToString('o')
$perYear = [ordered]@{}

foreach ($year in $Years) {
  $cfg = "Release $($cfgMap[$year])"
  if (-not $cfgMap.ContainsKey($year)) { throw "unknown Revit year $year" }
  if ($Build) {
    Write-Host "== dotnet build $cfg ==" -ForegroundColor Cyan
    # WARNING: never pass -p:DeployToRevit=true here - it overwrites this PC's live add-in.
    & dotnet build $buildProj -c $cfg -p:Platform=x64 -v q -nologo
    if ($LASTEXITCODE -ne 0) { throw "build failed ($cfg)" }
  }
  $binDir = Join-Path $buildDir "bin\x64\$cfg"
  $dll = Join-Path $binDir 'RevitMcpAddin.dll'
  if (-not (Test-Path $dll)) { throw "no build output at $binDir (use -Build)" }
  $fileVer = (Get-Item $dll).VersionInfo.FileVersion
  if (-not "$fileVer".StartsWith($version)) { throw "stale build ($year): DLL FileVersion $fileVer but csproj says $version (use -Build)" }

  $yearDir = Join-Path $setup $year
  $payload = Join-Path $stageRoot "payload-$year"
  New-Item -ItemType Directory -Force -Path $yearDir, $payload | Out-Null
  Get-ChildItem -Path $binDir -Recurse -File |
    Where-Object { $_.Extension -notin '.pdb', '.xml' } |
    ForEach-Object {
      $rel = $_.FullName.Substring($binDir.Length).TrimStart('\')
      $to = Join-Path $payload $rel
      New-Item -ItemType Directory -Force -Path (Split-Path $to -Parent) | Out-Null
      Copy-Item $_.FullName $to -Force
    }

  # .NET (Core) builds: every DLL deps.json names must be in the payload (net48 has no deps.json).
  $depsFile = Join-Path $payload 'RevitMcpAddin.deps.json'
  if (Test-Path $depsFile) {
    $deps = Get-Content -Raw $depsFile | ConvertFrom-Json
    $missing = @()
    foreach ($target in $deps.targets.PSObject.Properties) {
      foreach ($lib in $target.Value.PSObject.Properties) {
        foreach ($kind in 'runtime', 'native') {
          $section = $lib.Value.$kind
          if (-not $section) { continue }
          foreach ($f in $section.PSObject.Properties.Name) {
            if ($lib.Name -like 'RevitMcpAddin/*') { continue }
            $leaf = Split-Path $f -Leaf
            if (-not (Get-ChildItem -Path $payload -Recurse -File -Filter $leaf -ErrorAction SilentlyContinue)) { $missing += "$($lib.Name): $f" }
          }
        }
      }
    }
    if ($missing.Count -gt 0) { throw ("payload $year is missing dependencies:`n  " + ($missing -join "`n  ")) }
  }

  $lines = foreach ($f in (Get-ChildItem -Path $payload -Recurse -File | Sort-Object FullName)) {
    $rel = $f.FullName.Substring($payload.Length).TrimStart('\')
    "{0}  {1}" -f (Get-FileHash -Algorithm SHA256 $f.FullName).Hash.ToLower(), $rel
  }
  $fileCount = @($lines).Count
  $shaList = Join-Path $payload 'payload.sha256.txt'
  [IO.File]::WriteAllText($shaList, (($lines -join "`n") + "`n"), $utf8)
  $payloadSha = (Get-FileHash -Algorithm SHA256 $shaList).Hash.ToLower()

  $release = [ordered]@{
    schema = 'mgl-addin-release-v1'; version = $version; revit = $year; channel = $Channel
    installer = 'bundle-per-user'; api_host = $apiHost; git_sha = $gitSha; git_dirty = $gitDirty
    built_at = $builtAt; files = $fileCount; payload_sha256 = $payloadSha
  }
  $releaseJson = ($release | ConvertTo-Json -Depth 4)
  [IO.File]::WriteAllText((Join-Path $yearDir 'release.json'), $releaseJson, $utf8)
  # InstallCheck.Run reads release.json next to the DLL (health report "recognised").
  [IO.File]::WriteAllText((Join-Path $payload 'release.json'), $releaseJson, $utf8)
  Compress-Archive -Path (Join-Path $payload '*') -DestinationPath (Join-Path $yearDir 'payload.zip') -Force
  Remove-Item -Recurse -Force $payload
  $perYear[$year] = [ordered]@{ files = $fileCount; payload_sha256 = $payloadSha; dll = "$fileVer" }
  Write-Host ("  {0}: {1} files, payload {2}" -f $year, $fileCount, $payloadSha.Substring(0, 12))
}

# --- installer scripts WITH a UTF-8 BOM -------------------------------------------
foreach ($s in 'install.ps1', 'install-all.ps1') {
  $txt = [IO.File]::ReadAllText((Join-Path $here $s), [Text.Encoding]::UTF8)
  [IO.File]::WriteAllText((Join-Path $setup $s), $txt, $utf8Bom)
}

# --- entry points (ASCII .bat: cmd parses .bat in the OEM code page) ---------------
$bat = @'
@echo off
if not exist "%~dp0setup\install-all.ps1" (
  echo.
  echo  The zip is not fully extracted. Right-click the zip, "Extract All", then run Install.bat
  echo  from the extracted folder.
  echo.
  pause
  exit /b 1
)
echo MGL Revit add-in: installing / updating ...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup\install-all.ps1" %*
exit /b %ERRORLEVEL%
'@
[IO.File]::WriteAllText((Join-Path $stage 'Install.bat'), ($bat -replace "`r?`n", "`r`n"), [Text.Encoding]::ASCII)
$ubat = $bat.Replace('installing / updating', 'uninstalling').Replace('install-all.ps1" %*', 'install-all.ps1" -Uninstall %*')
[IO.File]::WriteAllText((Join-Path $stage 'Uninstall.bat'), ($ubat -replace "`r?`n", "`r`n"), [Text.Encoding]::ASCII)

$readme = [IO.File]::ReadAllText((Join-Path $here 'bundle-README.txt'), [Text.Encoding]::UTF8)
$readme = $readme.Replace('__VERSION__', $version).Replace('__YEARS__', ($Years -join ', '))
[IO.File]::WriteAllText((Join-Path $stage 'README.txt'), ($readme -replace "`r?`n", "`r`n"), $utf8Bom)

# --- notes + extras ------------------------------------------------------------------
foreach ($t in Get-ChildItem -Path $distDir -Filter '*.txt' -File -ErrorAction SilentlyContinue) {
  Copy-Item $t.FullName (Join-Path $stage $t.Name) -Force
}
foreach ($inc in $Include) {
  if (-not (Test-Path $inc)) { throw "include not found: $inc" }
  $item = Get-Item $inc
  Copy-Item $item.FullName (Join-Path $stage $item.Name) -Recurse -Force
}

# --- zip -------------------------------------------------------------------------------
# ZipFile (not Compress-Archive): forward-slash entry names + UTF-8 names with the
# language flag, so Explorer / 7-Zip both show the Mongolian note file names.
if (Test-Path $zipPath) { Remove-Item -Force $zipPath }
Add-Type -AssemblyName System.IO.Compression.FileSystem
[IO.Compression.ZipFile]::CreateFromDirectory($stage, $zipPath, [IO.Compression.CompressionLevel]::Optimal, $true)
Remove-Item -Recurse -Force $stageRoot

$zipSha = (Get-FileHash -Algorithm SHA256 $zipPath).Hash.ToLower()
$meta = [ordered]@{
  file = "$name.zip"; version = $version; years = $Years; bytes = (Get-Item $zipPath).Length; sha256 = $zipSha
  per_year = $perYear; git_sha = $gitSha; git_dirty = $gitDirty; built_at = $builtAt; api_host = $apiHost
}
[IO.File]::WriteAllText((Join-Path $distDir "$name.json"), ($meta | ConvertTo-Json -Depth 5), $utf8)

if ($isoRoot -and (Test-Path $isoRoot)) { Remove-Item -Recurse -Force $isoRoot -ErrorAction SilentlyContinue }

Write-Host ""
Write-Host "  bundle : $zipPath" -ForegroundColor Green
Write-Host "  bytes  : $((Get-Item $zipPath).Length)"
Write-Host "  sha256 : $zipSha"
if ($gitDirty) { Write-Warning "working tree is dirty - release.json records git_dirty=true" }
