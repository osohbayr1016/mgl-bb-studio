# Wall Elevation release gate - build a CANDIDATE bundle that contains exactly:
#   committed HEAD  +  the uncommitted changes under the overlay paths (default: the Wall Elevation tool only).
#
# Why not build the working tree: several agents edit revit-mcp\addin concurrently; their unfinished, possibly
# non-compiling work must never end up in a test build that is installed into the user's Revit.
#
#   powershell -ExecutionPolicy Bypass -File build-candidate.ps1 [-Years 2024,2027] [-Overlay <repo-relative paths>]
#
# Output: revit-mcp\dist\gate\<version>-<head8>[-o<overlay8>]\  MGL-Revit-Addin-<version>.zip + candidate.json
# ASCII-only on purpose (PowerShell 5.1).

param(
  [string[]]$Years = @('2024', '2027'),
  [string[]]$Overlay = @('revit-mcp/addin/WallElevation'),
  [switch]$KeepWorktree
)

$ErrorActionPreference = 'Stop'
# '-File x.ps1 -Years 2024,2027' arrives as ONE string - split it.
$Years = @($Years | ForEach-Object { $_ -split ',' } | ForEach-Object { $_.Trim() } | Where-Object { $_ })
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = (& git -C $here rev-parse --show-toplevel).Trim()
$head = (& git -C $root rev-parse HEAD).Trim()
$wt = Join-Path $env:TEMP 'mgl-we-gate-worktree'

function Say($m) { Write-Host ('[build-candidate] ' + $m) }

# Overlay fingerprint: sorted list of (path, sha256) of every file under the overlay paths that differs from HEAD
# (modified, added or untracked).  Empty overlay -> the candidate is exactly HEAD.
$changed = @()
foreach ($p in $Overlay) {
  $lines = & git -C $root status --porcelain --untracked-files=all -- $p
  foreach ($l in $lines) {
    $rel = $l.Substring(3).Trim('"')
    if ($rel -match ' -> ') { $rel = ($rel -split ' -> ')[1] }
    $changed += $rel
  }
}
$changed = @($changed | Sort-Object -Unique)
$fp = ''
foreach ($rel in $changed) {
  $full = Join-Path $root $rel
  $h = if (Test-Path $full -PathType Leaf) { (Get-FileHash -Algorithm SHA256 -Path $full).Hash } else { 'DELETED' }
  $fp += "$rel=$h`n"
}
$overlayHash = ''
if ($changed.Count -gt 0) {
  $sha = [Security.Cryptography.SHA256]::Create()
  $overlayHash = ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($fp))) -replace '-', '').ToLower().Substring(0, 8)
}
Say ("HEAD " + $head.Substring(0, 8) + ", overlay files " + $changed.Count + $(if ($overlayHash) { " (o$overlayHash)" } else { '' }))

# V03 (2026-10-16): make the candidate SCOPE explicit.  Uncommitted changes under revit-mcp that are not in the overlay
# are NOT in the candidate (HEAD + overlay only).  Warn and record them in candidate.json so nobody mistakes the tested
# build for "all fixes included".  To include them: commit, or pass -Overlay.
$excluded = @()
foreach ($l in (& git -C $root status --porcelain --untracked-files=all -- 'revit-mcp')) {
  $rel = $l.Substring(3).Trim('"')
  if ($rel -match ' -> ') { $rel = ($rel -split ' -> ')[1] }
  if ($rel -like 'revit-mcp/dist/*') { continue }
  if ($changed -contains $rel) { continue }
  $excluded += $rel
}
$excluded = @($excluded | Sort-Object -Unique)
if ($excluded.Count -gt 0) {
  Write-Warning ("[build-candidate] " + $excluded.Count + " uncommitted change(s) under revit-mcp are NOT in this candidate (commit them or pass -Overlay):")
  foreach ($x in ($excluded | Select-Object -First 30)) { Write-Warning ("    " + $x) }
}

if (Test-Path $wt) { & git -C $root worktree remove --force $wt 2>$null; if (Test-Path $wt) { Remove-Item -Recurse -Force $wt } }
& git -C $root worktree prune
& git -C $root worktree add --detach $wt $head | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'git worktree add failed' }
try {
  foreach ($rel in $changed) {
    $src = Join-Path $root $rel
    $dst = Join-Path $wt $rel
    if (Test-Path $src -PathType Leaf) {
      New-Item -ItemType Directory -Force -Path (Split-Path -Parent $dst) | Out-Null
      Copy-Item -Force -Path $src -Destination $dst
    } elseif (Test-Path $dst) { Remove-Item -Force $dst }
  }
  $bb = Join-Path $wt 'revit-mcp\installer\build-bundle.ps1'
  Say ('building bundle for ' + ($Years -join ',') + ' (isolated)')
  # -Command (not -File) so that -Years is parsed as an array literal.
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ("& '" + $bb + "' -Build -Isolated -Force -Years " + ($Years -join ',') + '; exit $LASTEXITCODE')
  if ($LASTEXITCODE -ne 0) { throw "build-bundle failed (exit $LASTEXITCODE)" }
  $zip = Get-ChildItem -Path (Join-Path $wt 'revit-mcp\dist') -Recurse -Filter 'MGL-Revit-Addin-*.zip' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if (-not $zip) { throw 'bundle zip not found' }
  $version = ($zip.BaseName -replace '^MGL-Revit-Addin-', '')
  $tag = "$version-" + $head.Substring(0, 8) + $(if ($overlayHash) { "-o$overlayHash" } else { '' })
  $out = Join-Path $root "revit-mcp\dist\gate\$tag"
  New-Item -ItemType Directory -Force -Path $out | Out-Null
  Copy-Item -Force -Path $zip.FullName -Destination $out
  $side = [IO.Path]::ChangeExtension($zip.FullName, '.json')
  if (Test-Path $side) { Copy-Item -Force -Path $side -Destination $out }
  # V04: per-year DLL SHA-256 - live-gate evidence is bound to exactly this build (compared with the installed DLL).
  $dllSha = [ordered]@{}
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $zx = [IO.Compression.ZipFile]::OpenRead($zip.FullName)
  try {
    foreach ($y in $Years) {
      $pe = $zx.Entries | Where-Object { $_.FullName -match ("setup[/\\]" + $y + "[/\\]payload\.zip$") } | Select-Object -First 1
      if (-not $pe) { continue }
      $ms = New-Object IO.MemoryStream
      $st = $pe.Open(); $st.CopyTo($ms); $st.Close()
      $ms.Position = 0
      $inner = New-Object IO.Compression.ZipArchive($ms, [IO.Compression.ZipArchiveMode]::Read)
      $de = $inner.Entries | Where-Object { $_.FullName -eq 'RevitMcpAddin.dll' } | Select-Object -First 1
      if ($de) {
        $ds = $de.Open()
        $sha2 = [Security.Cryptography.SHA256]::Create()
        $dllSha[$y] = ([BitConverter]::ToString($sha2.ComputeHash($ds)) -replace '-', '').ToLower()
        $ds.Close()
      }
      $inner.Dispose(); $ms.Dispose()
    }
  } finally { $zx.Dispose() }

  $meta = [ordered]@{
    schema         = 'mgl-we-candidate-v1'
    version        = $version
    tag            = $tag
    git_head       = $head
    overlay_paths  = $Overlay
    overlay_files  = $changed
    overlay_hash   = $overlayHash
    excluded_uncommitted = $excluded
    dll_sha256     = $dllSha
    years          = $Years
    zip            = (Join-Path $out $zip.Name)
    zip_sha256     = (Get-FileHash -Algorithm SHA256 -Path $zip.FullName).Hash.ToLower()
    built_at       = (Get-Date).ToUniversalTime().ToString('o')
  }
  [IO.File]::WriteAllText((Join-Path $out 'candidate.json'), ($meta | ConvertTo-Json -Depth 4), (New-Object Text.UTF8Encoding($false)))
  [IO.File]::WriteAllText((Join-Path $out 'overlay-files.txt'), $fp, (New-Object Text.UTF8Encoding($false)))
  Say "candidate: $out"
}
finally {
  if (-not $KeepWorktree) { & git -C $root worktree remove --force $wt 2>$null; & git -C $root worktree prune }
}
