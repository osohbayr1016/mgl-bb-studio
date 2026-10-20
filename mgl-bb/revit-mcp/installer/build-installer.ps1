# MGL Revit 2027 add-in - build the one-click per-user installer (.exe).
#
# ASCII-ONLY BY DESIGN: Windows PowerShell 5.1 reads a BOM-less .ps1 as the
# ANSI codepage.  User-facing Mongolian text lives in install.ps1, which this
# script re-writes WITH a UTF-8 BOM when staging (so an editor that strips the
# BOM from the repo copy cannot break employee machines).
#
# WHY IExpress: it ships with Windows (C:\Windows\System32\iexpress.exe), needs
# no third-party toolchain, and its wextract stub carries an `asInvoker`
# manifest, so the exe never triggers UAC even though its name contains
# "Setup" (measured on installer/dist/MGL-AI-Setup-1.0.1.exe).  Same precedent
# as the MGL AI installer (installer/build.ps1).
#
# IExpress cannot keep sub-folders, so the add-in payload (which has
# runtimes\win-*\native\WebView2Loader.dll) travels as ONE payload.zip that
# install.ps1 expands and hash-checks.
#
# WARNING: UNSIGNED unless a code-signing certificate is configured (env
# MGL_SIGN_CERT_THUMBPRINT or MGL_SIGN_CMD, see harden-release.ps1; pass
# -RequireSigned to make that mandatory).  SmartScreen may show "Windows
# protected your PC" on a downloaded unsigned copy (More info -> Run anyway) and
# Revit shows its "Add-In Security" prompt once (Always Load).  Both go away only
# with a code-signing certificate - do not tell employees to disable SmartScreen.
#
# Usage (from repo root):
#   powershell -NoProfile -ExecutionPolicy Bypass -File revit-mcp\installer\build-installer.ps1 -Build
# Output:
#   revit-mcp\dist\<version>\MGL-Revit2027-Setup-<version>.exe  (+ .json with sha256)

[CmdletBinding()]
param(
  [switch]$Build,
  [switch]$Force,
  [string]$Configuration = 'Release R27',
  # Fail the build when no code-signing certificate is configured (see harden-release.ps1).
  [switch]$RequireSigned
)
$ErrorActionPreference = 'Stop'

$here     = Split-Path -Parent $MyInvocation.MyCommand.Path
$addinDir = (Resolve-Path (Join-Path $here '..\addin')).Path
$proj     = Join-Path $addinDir 'RevitMcpAddin.csproj'
$binDir   = Join-Path $addinDir "bin\x64\$Configuration"
$distRoot = Join-Path (Split-Path $addinDir -Parent) 'dist'

# The production API host is compiled into the DLL (AddinSettings.FallbackApiHost);
# release.json repeats it for visibility only.  No secret is ever bundled.
$apiHost = 'https://mgl-progress-api.mglenc-design.workers.dev'

# --- version from the csproj (single source of truth) -----------------------
$csprojXml = [xml](Get-Content -Raw -Path $proj)
$version = ([string[]]($csprojXml.Project.PropertyGroup.Version | Where-Object { $_ }))[0].Trim()
if ($version -notmatch '^\d+\.\d+\.\d+$') { throw "csproj <Version> not readable: '$version'" }

if ($Build) {
  Write-Host "== dotnet build $Configuration ==" -ForegroundColor Cyan
  # WARNING: never pass -p:DeployToRevit=true here - it overwrites this PC's live add-in.
  & dotnet build $proj -c $Configuration -p:Platform=x64 -v m -nologo
  if ($LASTEXITCODE -ne 0) { throw "build failed" }
}

$dll = Join-Path $binDir 'RevitMcpAddin.dll'
if (-not (Test-Path $dll)) { throw "no build output at $binDir (use -Build)" }
$fileVer = (Get-Item $dll).VersionInfo.FileVersion
if (-not "$fileVer".StartsWith($version)) {
  throw "stale build: DLL FileVersion $fileVer but csproj says $version (use -Build)"
}

# --- release hardening (installer/harden-release.ps1) ------------------------
# 1) gate: no key material / Debug build / MGL_ALLOW_EXEC in the shipped binaries
# 2) optional obfuscation (external tool, env MGL_OBFUSCATE_CMD) - defence in depth only
# 3) Authenticode-sign the DLL (env MGL_SIGN_CERT_THUMBPRINT or MGL_SIGN_CMD) BEFORE it is
#    hashed into the payload; the installer exe is signed again below.
$hardenScript = Join-Path $here 'harden-release.ps1'
& $hardenScript -Mode Gate -BinDir $binDir -Version $version
& $hardenScript -Mode Obfuscate -BinDir $binDir
& $hardenScript -Mode Sign -Files @($dll) -RequireSigned:$RequireSigned

$distDir = Join-Path $distRoot $version
New-Item -ItemType Directory -Force -Path $distDir | Out-Null
$exeName = "MGL-Revit2027-Setup-$version.exe"
$exePath = Join-Path $distDir $exeName
if ((Test-Path $exePath) -and -not $Force) { throw "$exePath exists - bump <Version> or pass -Force" }

# --- git identity (never fails the build) ------------------------------------
$gitSha = 'unknown'; $gitDirty = $false
try {
  $repo = (Resolve-Path (Join-Path $here '..\..')).Path
  $sha = & git -C $repo rev-parse HEAD 2>$null
  if ($LASTEXITCODE -eq 0 -and $sha) { $gitSha = $sha.Trim() }
  $dirty = & git -C $repo status --porcelain 2>$null
  if ($LASTEXITCODE -eq 0 -and $dirty) { $gitDirty = $true }
} catch { }

# --- stage --------------------------------------------------------------------
$stage = Join-Path $env:TEMP "mgl-revit-setup-$version"
if (Test-Path $stage) { Remove-Item -Recurse -Force $stage }
$payload = Join-Path $stage 'payload'
New-Item -ItemType Directory -Force -Path $payload | Out-Null

# Only runtime files: no .pdb, no stray satellite/test junk.
Get-ChildItem -Path $binDir -Recurse -File |
  Where-Object { $_.Extension -notin '.pdb', '.xml' } |
  ForEach-Object {
    $rel = $_.FullName.Substring($binDir.Length).TrimStart('\')
    $to = Join-Path $payload $rel
    New-Item -ItemType Directory -Force -Path (Split-Path $to -Parent) | Out-Null
    Copy-Item $_.FullName $to -Force
  }

# Every DLL the add-in's deps.json names must be in the payload - a DLL that only
# exists on the developer PC would load here and fail on an employee PC.
$deps = Get-Content -Raw (Join-Path $payload 'RevitMcpAddin.deps.json') | ConvertFrom-Json
$missing = @()
foreach ($target in $deps.targets.PSObject.Properties) {
  foreach ($lib in $target.Value.PSObject.Properties) {
    foreach ($kind in 'runtime', 'native') {
      $section = $lib.Value.$kind
      if (-not $section) { continue }
      foreach ($f in $section.PSObject.Properties.Name) {
        if ($lib.Name -like 'RevitMcpAddin/*') { continue }
        $leaf = Split-Path $f -Leaf
        $hit = Get-ChildItem -Path $payload -Recurse -File -Filter $leaf -ErrorAction SilentlyContinue
        if (-not $hit) { $missing += "$($lib.Name): $f" }
      }
    }
  }
}
if ($missing.Count -gt 0) { throw ("payload is missing dependencies:`n  " + ($missing -join "`n  ")) }

# payload.sha256.txt: one line per file, "<sha256>  <relative path>", LF, no BOM.
$lines = foreach ($f in (Get-ChildItem -Path $payload -Recurse -File | Sort-Object FullName)) {
  $rel = $f.FullName.Substring($payload.Length).TrimStart('\')
  "{0}  {1}" -f (Get-FileHash -Algorithm SHA256 $f.FullName).Hash.ToLower(), $rel
}
$fileCount = @($lines).Count
$shaList = Join-Path $payload 'payload.sha256.txt'
[IO.File]::WriteAllText($shaList, (($lines -join "`n") + "`n"), (New-Object Text.UTF8Encoding($false)))
$payloadSha = (Get-FileHash -Algorithm SHA256 $shaList).Hash.ToLower()

$release = [ordered]@{
  schema         = 'mgl-addin-release-v1'
  version        = $version
  revit          = '2027'
  channel        = 'prod'
  installer      = 'iexpress-per-user'
  api_host       = $apiHost
  git_sha        = $gitSha
  git_dirty      = $gitDirty
  built_at       = (Get-Date).ToUniversalTime().ToString('o')
  files          = $fileCount
  payload_sha256 = $payloadSha
}
$releaseJson = ($release | ConvertTo-Json -Depth 4)
[IO.File]::WriteAllText((Join-Path $stage 'release.json'), $releaseJson, (New-Object Text.UTF8Encoding($false)))
# InstallCheck.Run reads release.json next to the DLL (health report "recognised").
[IO.File]::WriteAllText((Join-Path $payload 'release.json'), $releaseJson, (New-Object Text.UTF8Encoding($false)))

Compress-Archive -Path (Join-Path $payload '*') -DestinationPath (Join-Path $stage 'payload.zip') -Force
Remove-Item -Recurse -Force $payload

# install.ps1 WITH a UTF-8 BOM (PowerShell 5.1 + Cyrillic).
$installSrc = [IO.File]::ReadAllText((Join-Path $here 'install.ps1'), [Text.Encoding]::UTF8)
[IO.File]::WriteAllText((Join-Path $stage 'install.ps1'), $installSrc, (New-Object Text.UTF8Encoding($true)))

# run.cmd - the IExpress entry point.  -ExecutionPolicy Bypass is process-local,
# needs no elevation; the window is hidden, the user sees message boxes only.
# WARNING: AppLaunched must be `run.cmd`, NOT `cmd /c run.cmd` - measured
# 2026-09-29 on Windows 11 26200: with `cmd /c run.cmd` wextract exits 0 after
# ~1 s WITHOUT extracting or launching anything (a silent no-op installer);
# `run.cmd` extracts and runs.  (installer/build.ps1 of MGL AI uses the broken form.)
@'
@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0install.ps1"
exit /b %ERRORLEVEL%
'@ | Set-Content -Path (Join-Path $stage 'run.cmd') -Encoding ascii

# --- IExpress -----------------------------------------------------------------
# WARNING: .sed is picky - absolute paths, every file listed twice.
if (Test-Path $exePath) { Remove-Item -Force $exePath }
$sedPath = Join-Path $env:TEMP "mgl-revit-setup-$version.sed"
@"
[Version]
Class=IEXPRESS
SEDVersion=3
[Options]
PackagePurpose=InstallApp
ShowInstallProgramWindow=1
HideExtractAnimation=1
UseLongFileName=1
InsideCompressed=0
CAB_FixedSize=0
CAB_ResvCodeSigning=0
RebootMode=N
InstallPrompt=%InstallPrompt%
DisplayLicense=%DisplayLicense%
FinishMessage=%FinishMessage%
TargetName=%TargetName%
FriendlyName=%FriendlyName%
AppLaunched=%AppLaunched%
PostInstallCmd=%PostInstallCmd%
AdminQuietInstCmd=
UserQuietInstCmd=
SourceFiles=SourceFiles
[Strings]
InstallPrompt=
DisplayLicense=
FinishMessage=
TargetName=$exePath
FriendlyName=MGL Revit 2027 Setup $version
AppLaunched=run.cmd
PostInstallCmd=<None>
FILE0="run.cmd"
FILE1="install.ps1"
FILE2="release.json"
FILE3="payload.zip"
[SourceFiles]
SourceFiles0=$stage\
[SourceFiles0]
%FILE0%=
%FILE1%=
%FILE2%=
%FILE3%=
"@ | Set-Content -Path $sedPath -Encoding ascii

Write-Host "== iexpress -> $exeName ==" -ForegroundColor Cyan
& "$env:WINDIR\System32\iexpress.exe" /N /Q $sedPath | Out-Null
$deadline = (Get-Date).AddSeconds(120)
while (-not (Test-Path $exePath) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 500 }
if (-not (Test-Path $exePath)) { throw "iexpress did not produce $exePath (sed: $sedPath)" }
Start-Sleep -Milliseconds 500
Remove-Item $sedPath -Force -ErrorAction SilentlyContinue

& $hardenScript -Mode Sign -Files @($exePath) -RequireSigned:$RequireSigned
$exeSha = (Get-FileHash -Algorithm SHA256 $exePath).Hash.ToLower()
$exeBytes = (Get-Item $exePath).Length
$meta = [ordered]@{
  file = $exeName; version = $version; revit = '2027'; bytes = $exeBytes; sha256 = $exeSha
  payload_sha256 = $payloadSha; files = $fileCount; git_sha = $gitSha; git_dirty = $gitDirty
  built_at = $release.built_at; api_host = $apiHost
}
[IO.File]::WriteAllText((Join-Path $distDir "MGL-Revit2027-Setup-$version.json"), ($meta | ConvertTo-Json), (New-Object Text.UTF8Encoding($false)))
Remove-Item -Recurse -Force $stage

Write-Host ""
Write-Host "  installer : $exePath" -ForegroundColor Green
Write-Host "  bytes     : $exeBytes"
Write-Host "  sha256    : $exeSha"
Write-Host "  payload   : $fileCount files, sha256 $payloadSha"
if ($gitDirty) { Write-Warning "working tree is dirty - release.json records git_dirty=true" }
