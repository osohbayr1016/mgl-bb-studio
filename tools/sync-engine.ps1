# Хөдөлгүүрийн хуулбарыг (src\Engine) mgl-e-c репогийн revit-mcp\addin-аас шинэчлэнэ.
#   powershell -ExecutionPolicy Bypass -File tools\sync-engine.ps1 -From <mgl-e-c хавтас> [-Apply]
# -Apply-гүй бол юу ч бичихгүй, зөвхөн ялгааг харуулна.  Жагсаалт = engine-files.txt.
[CmdletBinding()]
param(
  [string]$From = '',
  [switch]$Apply
)
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
if (-not $From) { $From = Join-Path (Split-Path -Parent $Root) 'mgl-e-c' }
$Addin = Join-Path $From 'revit-mcp\addin'
if (-not (Test-Path $Addin)) { throw "Олдсонгүй: $Addin" }
$Engine = Join-Path $Root 'src\Engine'
$list = [IO.File]::ReadAllLines((Join-Path $Root 'engine-files.txt')) | Where-Object { $_.Trim() }

function Same([string]$a, [string]$b) {
  if (-not (Test-Path $b)) { return $false }
  # Мөрийн төгсгөл (CRLF/LF) нь checkout-оос хамаарч зөрдөг — агуулгаар л тулгана.
  return [IO.File]::ReadAllText($a).Replace("`r", '') -eq [IO.File]::ReadAllText($b).Replace("`r", '')
}

$changed = @(); $missing = @()
foreach ($rel in $list) {
  $src = Join-Path $Addin $rel
  $dst = Join-Path $Engine $rel
  if (-not (Test-Path $src)) { $missing += $rel; continue }
  if (-not (Same $src $dst)) { $changed += $rel }
}

# Жагсаалтад ороогүй ШИНЭ файл (хөдөлгүүрийн хавтсуудад нэмэгдсэн) — гараар шийднэ.
$known = @{}; foreach ($r in $list) { $known[$r.Replace('/', '\').ToLowerInvariant()] = 1 }
$new = @()
foreach ($dir in @('Reinforcement\Core', 'Reinforcement\Revit', 'AutoAnnotate\Core')) {
  foreach ($f in Get-ChildItem (Join-Path $Addin $dir) -Filter *.cs) {
    $rel = (Join-Path $dir $f.Name)
    if ($rel -eq 'Reinforcement\Revit\RfTemplateService.cs') { continue }
    if (-not $known.ContainsKey($rel.ToLowerInvariant())) { $new += $rel }
  }
}

$commit = ''
try { $commit = (& git -C $From rev-parse HEAD 2>$null) } catch { }
Write-Host "Эх: $Addin  (commit $commit)"
Write-Host "Өөрчлөгдсөн: $($changed.Count)"; $changed | ForEach-Object { Write-Host "  ~ $_" }
if ($missing.Count) { Write-Host "Эх дээр алга болсон: $($missing.Count)"; $missing | ForEach-Object { Write-Host "  - $_" } }
if ($new.Count) { Write-Host "Жагсаалтад ороогүй шинэ файл (хэрэгтэй бол engine-files.txt-д нэмнэ): $($new.Count)"; $new | ForEach-Object { Write-Host "  + $_" } }

if (-not $Apply) { Write-Host 'Юу ч бичээгүй (-Apply өгвөл хуулна).'; exit 0 }
foreach ($rel in $changed) {
  $dst = Join-Path $Engine $rel
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $dst) | Out-Null
  Copy-Item (Join-Path $Addin $rel) $dst -Force
}
$src = "mgl-e-c revit-mcp/addin @ $commit`nsynced $(Get-Date -Format s)`n"
[IO.File]::WriteAllText((Join-Path $Engine 'SOURCE.txt'), $src, (New-Object Text.UTF8Encoding($false)))
Write-Host "Хуулсан: $($changed.Count). Одоо build.ps1 ажиллуулж, хувийн Revit-д шалгана уу."
