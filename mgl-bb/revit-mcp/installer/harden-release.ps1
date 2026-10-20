# MGL Revit add-in - RELEASE HARDENING gate + code-signing / obfuscation integration points.
#
# ASCII-ONLY BY DESIGN (same reason as build-installer.ps1: Windows PowerShell 5.1 reads a
# BOM-less .ps1 as the ANSI codepage).
#
# WHAT THIS IS (and is not): the add-in is a .NET DLL that ships to employee PCs, so anyone
# can copy or decompile it.  Hardening here is DEFENCE IN DEPTH only - the real protection is
# server-side (signed short leases, TPM device key, challenge/response, version kill switch;
# see backend/src/lib/revitDeviceKey.ts).  Obfuscation does NOT make the DLL impossible to
# reverse engineer, it only raises the cost.  Authenticode signing proves WHO built the file
# (SmartScreen / Revit "Add-In Security" prompt) and detects tampering of a distributed copy.
#
# MODES
#   Gate  (default)  verify a built bin dir is safe to distribute:
#                      - no private-key material / test keys / server secrets inside any binary
#                      - not a Debug (optimizer-disabled) build
#                      - DLL FileVersion matches -Version
#                      - no installer/manifest script switches the arbitrary-C# bridge on
#                        (MGL_ALLOW_EXEC must stay OFF in production)
#   Obfuscate        run the external obfuscator named by env MGL_OBFUSCATE_CMD on the DLL
#                    (template, {dll} = path).  Nothing is bundled: a production-grade .NET
#                    obfuscator (Dotfuscator, ConfuserEx fork, Eazfuscator, ...) needs its own
#                    licence.  Unset = skipped with a warning.
#   Sign             Authenticode-sign the given files.  Certificate from env
#                      MGL_SIGN_CERT_THUMBPRINT  (cert in CurrentUser\My or LocalMachine\My), or
#                      MGL_SIGN_CMD              (template, {file} = path; use for HSM / cloud
#                                                 signing, e.g. a signtool command line).
#                    Unset = files stay UNSIGNED (warning; -RequireSigned turns it into an error).
#
# Usage (build-installer.ps1 calls these for you):
#   harden-release.ps1 -Mode Gate      -BinDir <bin> -Version 1.10.0
#   harden-release.ps1 -Mode Obfuscate -BinDir <bin>
#   harden-release.ps1 -Mode Sign      -Files <path>[,<path>] [-RequireSigned]

[CmdletBinding()]
param(
  [ValidateSet('Gate', 'Obfuscate', 'Sign')]
  [string]$Mode = 'Gate',
  [string]$BinDir,
  [string]$Version,
  [string[]]$Files,
  [switch]$RequireSigned
)
$ErrorActionPreference = 'Stop'

$here = Split-Path -Parent $MyInvocation.MyCommand.Path

function Test-BytesContain([byte[]]$haystack, [string]$needle) {
  # ASCII and UTF-16LE (string literals in .NET assemblies are stored as UTF-16 in #US).
  foreach ($enc in @([Text.Encoding]::ASCII, [Text.Encoding]::Unicode)) {
    $n = $enc.GetBytes($needle)
    if ($n.Length -eq 0) { continue }
    $last = $haystack.Length - $n.Length
    for ($i = 0; $i -le $last; $i++) {
      if ($haystack[$i] -ne $n[0]) { continue }
      $ok = $true
      for ($j = 1; $j -lt $n.Length; $j++) { if ($haystack[$i + $j] -ne $n[$j]) { $ok = $false; break } }
      if ($ok) { return $true }
    }
  }
  return $false
}

function Invoke-Gate {
  if (-not $BinDir -or -not (Test-Path $BinDir)) { throw "Gate: -BinDir not found: $BinDir" }
  $problems = @()

  # 1) secrets / key material that must NEVER be inside a distributed binary.
  #    - the TEST license private key (backend/src/routes/revitLicense.test.ts) - proves a test key leaked in
  #    - PEM private-key headers, Worker secret names, the dev auth bypass switch
  $forbidden = @(
    'bOJ9ULu0YkNP8ywDgnEjRY',   # test-0001 private scalar (public repo test fixture)
    'BEGIN PRIVATE KEY',
    'BEGIN EC PRIVATE KEY',
    'REVIT_LICENSE_KEY',
    'JWT_SECRET',
    'DEV_AUTH_BYPASS',
    '.mgl-secrets'
  )
  $bins = Get-ChildItem -Path $BinDir -Recurse -File | Where-Object { $_.Extension -in '.dll', '.exe' }
  foreach ($f in $bins) {
    # Third-party DLLs are not ours to judge for 'JWT_SECRET'-like names, but our own binaries must be clean.
    if ($f.Name -notlike 'RevitMcpAddin*' -and $f.Name -notlike 'MGL*') { continue }
    $bytes = [IO.File]::ReadAllBytes($f.FullName)
    foreach ($needle in $forbidden) {
      if (Test-BytesContain $bytes $needle) { $problems += "$($f.Name): contains forbidden string '$needle'" }
    }
  }

  # 2) the add-in DLL itself
  $dll = Join-Path $BinDir 'RevitMcpAddin.dll'
  if (-not (Test-Path $dll)) { $problems += 'RevitMcpAddin.dll missing' }
  else {
    $fv = (Get-Item $dll).VersionInfo.FileVersion
    if ($Version -and -not "$fv".StartsWith($Version)) { $problems += "DLL FileVersion $fv does not match $Version (stale build)" }
    # Debug (optimizer-disabled) builds carry DebuggableAttribute with DisableOptimizations (0x100).
    try {
      $asm = [Reflection.Assembly]::LoadFile((Resolve-Path $dll).Path)
      foreach ($a in [Reflection.CustomAttributeData]::GetCustomAttributes($asm)) {
        if ($a.AttributeType.Name -eq 'DebuggableAttribute') {
          $modes = 0
          foreach ($arg in $a.ConstructorArguments) { if ($arg.Value -is [int]) { $modes = $arg.Value } }
          if (($modes -band 0x100) -ne 0) { $problems += 'DLL is a Debug build (JIT optimizer disabled)' }
        }
      }
    } catch {
      Write-Warning "Gate: could not inspect DebuggableAttribute ($($_.Exception.Message)); verify the Release configuration by hand"
    }
    $sig = Get-AuthenticodeSignature -FilePath $dll
    if ($sig.Status -eq 'Valid') { Write-Host "  signature : Valid ($($sig.SignerCertificate.Subject))" }
    else { Write-Warning "RevitMcpAddin.dll is UNSIGNED (status $($sig.Status)); SmartScreen / Revit Add-In Security will prompt" }
  }

  # 3) MGL_ALLOW_EXEC must never be switched on by an installer / manifest (arbitrary C# over localhost).
  $scripts = @()
  $scripts += Get-ChildItem -Path $here -File -Include '*.ps1', '*.cmd', '*.bat', '*.txt' -ErrorAction SilentlyContinue
  $scripts += Get-ChildItem -Path (Join-Path $here '..\addin') -File -Filter '*.addin' -ErrorAction SilentlyContinue
  foreach ($s in $scripts) {
    if ($s.Name -eq 'harden-release.ps1') { continue }
    $text = [IO.File]::ReadAllText($s.FullName)
    if ($text -match '(?i)SetEnvironmentVariable\(\s*[''"]MGL_ALLOW_EXEC' -or $text -match '(?im)^\s*(set|\$env:)\s*MGL_ALLOW_EXEC\s*=\s*[''"]?1') {
      $problems += "$($s.Name): enables MGL_ALLOW_EXEC (arbitrary C# execution must stay OFF in production)"
    }
  }

  if ($problems.Count -gt 0) { throw ("Release gate FAILED:`n  " + ($problems -join "`n  ")) }
  Write-Host '  release gate : OK (no key material, not a Debug build, MGL_ALLOW_EXEC off)' -ForegroundColor Green
}

function Invoke-Obfuscate {
  $cmd = $env:MGL_OBFUSCATE_CMD
  if (-not $cmd) {
    Write-Warning 'MGL_OBFUSCATE_CMD not set - DLL is NOT obfuscated (defence in depth only; the server-side checks do not depend on it)'
    return
  }
  $dll = Join-Path $BinDir 'RevitMcpAddin.dll'
  if (-not (Test-Path $dll)) { throw "Obfuscate: $dll missing" }
  $line = $cmd.Replace('{dll}', "`"$dll`"")
  Write-Host "== obfuscate: $line" -ForegroundColor Cyan
  & cmd.exe /c $line
  if ($LASTEXITCODE -ne 0) { throw "obfuscator failed ($LASTEXITCODE)" }
}

function Invoke-Sign {
  if (-not $Files -or $Files.Count -eq 0) { throw 'Sign: -Files required' }
  $thumb = $env:MGL_SIGN_CERT_THUMBPRINT
  $cmd = $env:MGL_SIGN_CMD
  if (-not $thumb -and -not $cmd) {
    $msg = 'no signing configured (set MGL_SIGN_CERT_THUMBPRINT or MGL_SIGN_CMD) - files stay UNSIGNED'
    if ($RequireSigned) { throw "Sign: $msg" }
    Write-Warning $msg
    return
  }
  $cert = $null
  if ($thumb) {
    $cert = Get-ChildItem Cert:\CurrentUser\My, Cert:\LocalMachine\My -ErrorAction SilentlyContinue |
      Where-Object { $_.Thumbprint -eq $thumb } | Select-Object -First 1
    if (-not $cert) { throw "Sign: certificate $thumb not found in CurrentUser\My / LocalMachine\My" }
  }
  foreach ($f in $Files) {
    if (-not (Test-Path $f)) { throw "Sign: $f not found" }
    if ($cmd) {
      $line = $cmd.Replace('{file}', "`"$f`"")
      & cmd.exe /c $line
      if ($LASTEXITCODE -ne 0) { throw "signing command failed for $f ($LASTEXITCODE)" }
    } else {
      $r = Set-AuthenticodeSignature -FilePath $f -Certificate $cert -HashAlgorithm SHA256 -TimestampServer 'http://timestamp.digicert.com'
      if ($r.Status -ne 'Valid') { throw "Sign: $f -> $($r.Status) $($r.StatusMessage)" }
    }
    $v = Get-AuthenticodeSignature -FilePath $f
    if ($v.Status -ne 'Valid') { throw "Sign: $f verification -> $($v.Status)" }
    Write-Host "  signed : $f" -ForegroundColor Green
  }
}

switch ($Mode) {
  'Gate'      { Invoke-Gate }
  'Obfuscate' { Invoke-Obfuscate }
  'Sign'      { Invoke-Sign }
}
