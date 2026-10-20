# MGL AI - build MGL-AI-Setup.exe
#
# ASCII-ONLY BY DESIGN - see the header of bootstrap.ps1 for why.
#
# WHY IExpress AND NOT Inno Setup / NSIS / WiX
#
#   IExpress ships with every Windows install (C:\Windows\System32\iexpress.exe),
#   so building the installer needs NO third-party toolchain on the build
#   machine and no signing infrastructure to get started.  Inno Setup and
#   NSIS both produce nicer installers, but neither is present here, and
#   adding a build dependency for a 60 KB self-extractor that only unpacks
#   two files and runs one command is not a trade worth making.
#
#   The .exe is a self-extracting archive that unpacks run.cmd +
#   bootstrap.ps1 into a temp folder and executes run.cmd.  All the real
#   work - and every security decision - is in bootstrap.ps1.
#
# WARNING: THIS PRODUCES AN UNSIGNED BINARY.  SmartScreen will warn on first
#   run until the company buys a code-signing certificate.  Do not "fix"
#   that by telling employees to disable SmartScreen; sign it instead.
#   Recorded here so the next person does not have to rediscover it.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File installer\build.ps1
#   powershell -ExecutionPolicy Bypass -File installer\build.ps1 -Version 1.0.1

[CmdletBinding()]
param(
  [string]$Version = '1.0.0',
  [string]$OutDir = ''
)

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $OutDir) { $OutDir = Join-Path $here 'dist' }
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

$bootstrap = Join-Path $here 'bootstrap.ps1'
if (-not (Test-Path $bootstrap)) { throw "Missing $bootstrap" }

# ---------------------------------------------------------------------------
#  run.cmd - the tiny shim IExpress launches.
#
#  WARNING: -ExecutionPolicy Bypass applies to THIS PROCESS ONLY.  It does
#  not change any machine or user policy, and it needs no elevation.  That
#  is what lets a locked-down workstation run the installer at all.
# ---------------------------------------------------------------------------
$runCmd = Join-Path $here 'run.cmd'
@'
@echo off
title MGL AI
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0bootstrap.ps1"
exit /b %ERRORLEVEL%
'@ | Set-Content -Path $runCmd -Encoding ascii

# ---------------------------------------------------------------------------
#  SED config
#
#  WARNING: IExpress .sed files are INI-shaped and extremely picky.  Paths
#  must be absolute, and every file listed in [SourceFiles0] must also be
#  named in [Strings] as FILE0/FILE1/...  A mismatch produces an .exe that
#  extracts nothing and exits 0 - a silent failure.
# ---------------------------------------------------------------------------
$exeName = "MGL-AI-Setup-$Version.exe"
$exePath = Join-Path $OutDir $exeName
if (Test-Path $exePath) { Remove-Item $exePath -Force }

$sedPath = Join-Path $env:TEMP "mgl-ai-setup-$Version.sed"
$sed = @"
[Version]
Class=IEXPRESS
SEDVersion=3
[Options]
PackagePurpose=InstallApp
ShowInstallProgramWindow=0
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
FriendlyName=MGL AI Setup $Version
AppLaunched=cmd /c run.cmd
PostInstallCmd=<None>
FILE0="run.cmd"
FILE1="bootstrap.ps1"
[SourceFiles]
SourceFiles0=$here
[SourceFiles0]
%FILE0%=
%FILE1%=
"@

Set-Content -Path $sedPath -Value $sed -Encoding ascii

Write-Host "Building $exeName ..." -ForegroundColor Cyan
& "$env:WINDIR\System32\iexpress.exe" /N /Q $sedPath | Out-Null

if (-not (Test-Path $exePath)) {
  throw "iexpress did not produce $exePath. SED: $sedPath"
}

$hash = (Get-FileHash -Path $exePath -Algorithm SHA256).Hash.ToLowerInvariant()
$size = (Get-Item $exePath).Length

Remove-Item $sedPath -Force -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "  built : $exePath" -ForegroundColor Green
Write-Host "  bytes : $size"
Write-Host "  sha256: $hash"
Write-Host ""
Write-Host "  Next: node ai/scripts/publish-installer.mjs --installer `"$exePath`" --version $Version"
Write-Host ""

# Machine-readable output for the publish script.
[pscustomobject]@{ path = $exePath; version = $Version; bytes = $size; sha256 = $hash } |
  ConvertTo-Json -Compress |
  Set-Content -Path (Join-Path $OutDir 'installer.json') -Encoding ascii
