# MGL Revit нэмэлт — НЭГДСЭН БАГЦ: суусан бүх Revit (2024–2027) дээр ШИНЭЧЛЭХ эсвэл ШИНЭЭР СУУЛГАХ.
#
# Ажилтан `MGL-Revit-Addin-<хувилбар>.zip`-ийг задлаад `Install.bat` дарна → энэ скрипт:
#   1. Энэ компьютерт суусан Revit онуудыг олно (Program Files\Autodesk\Revit <он>\Revit.exe).
#   2. Он бүрд одоо суусан MGL нэмэлтийн хувилбарыг манифестаас уншина — ямар аргаар суусан нь
#      хамаагүй: Setup exe (хувилбарын хавтас), хуучин zip/Install.bat (Addins\<он>\RevitMcpAddin),
#      хөгжүүлэгчийн build.
#   3. Он бүрд `install.ps1 -Year <он>`-ийг ТУСДАА процесст дуудна: хэш шалгаад хувилбарын хавтсанд
#      суулгаж, манифестийг солиод, хуучин хавтсыг (1.5.1 г.м.) цэвэрлэнэ.  Нэг он унасан ч бусад нь
#      үргэлжилнэ, унасан оны хуучин суулгац ХЭВЭЭР.
#   4. Нэг нэгдсэн тайлан: «Revit 2027: 1.5.1 → 1.7.0 шинэчиллээ», «Revit 2025: шинээр суулгалаа».
#
# Revit нээлттэй байсан ч зогсохгүй — шинэ хувилбар ХАЖУУД нь суугаад дараагийн нээлтэд ачаалагдана.
# Локал өгөгдөл (%APPDATA%\RevitMcpAddin — токен, илгээгдээгүй ажлын цаг) хэзээ ч хөндөгдөхгүй.
# ⚠️ Энэ файл UTF-8 BOM-той байх ЁСТОЙ (PowerShell 5.1 + кирилл) — build-bundle.ps1 BOM-той бичнэ.

[CmdletBinding()]
param(
  [switch]$Uninstall,
  [switch]$PurgeData,
  [switch]$Quiet,
  # Юу ч өөрчлөхгүй — он бүрд Revit суусан эсэх, одоогийн MGL хувилбар, хийх үйлдлийг л хэвлэнэ.
  #   Install.bat -DryRun
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

# --- Тестийн гарц (acceptance harness) — ажилтан ХЭЗЭЭ Ч тавихгүй. ----------------
$AppDataRoot = if ($env:MGL_ADDIN_TEST_APPDATA)      { $env:MGL_ADDIN_TEST_APPDATA }      else { [Environment]::GetFolderPath('ApplicationData') }
$LocalRoot   = if ($env:MGL_ADDIN_TEST_LOCALAPPDATA) { $env:MGL_ADDIN_TEST_LOCALAPPDATA } else { [Environment]::GetFolderPath('LocalApplicationData') }
$Quiet       = $Quiet -or ($env:MGL_ADDIN_TEST_QUIET -eq '1')
$ResultAll   = $env:MGL_ADDIN_TEST_RESULT

$AddInId = '7f3d9c2a-1b4e-4a6f-9c8d-2e5a1b3c4d5e'
$Product = 'MGL Revit нэмэлт'
$here    = $PSScriptRoot
$child   = Join-Path $here 'install.ps1'

function Out-Result([string]$kind, [string]$text) {
  if ($ResultAll) { try { Add-Content -Path $ResultAll -Value "$kind|$text" -Encoding UTF8 } catch { } }
}

function Show([string]$text, [string]$kind = 'Info') {
  Out-Result $kind $text
  Write-Host ""
  Write-Host $text -ForegroundColor $(if ($kind -eq 'Error') { 'Red' } elseif ($kind -eq 'Warn') { 'Yellow' } else { 'Green' })
  if ($Quiet) { return }
  try {
    Add-Type -AssemblyName System.Windows.Forms
    $icon = switch ($kind) { 'Error' { 'Error' } 'Warn' { 'Warning' } default { 'Information' } }
    [void][System.Windows.Forms.MessageBox]::Show($text, $Product, 'OK', $icon)
  } catch { }
}

function RevitInstalled([string]$y) {
  if ($env:MGL_ADDIN_TEST_YEARS) { return (($env:MGL_ADDIN_TEST_YEARS -split ',') -contains $y) }
  if (Test-Path (Join-Path $env:ProgramFiles "Autodesk\Revit $y\Revit.exe")) { return $true }
  return (Test-Path "HKLM:\SOFTWARE\Autodesk\Revit\Autodesk Revit $y")
}

function RevitRunning {
  if ($env:MGL_ADDIN_TEST_REVIT_RUNNING -eq '1') { return $true }
  return @(Get-Process -Name 'Revit' -ErrorAction SilentlyContinue).Count -gt 0
}

# Одоо суусан MGL нэмэлтийн хувилбар (манифест → DLL → release.json / FileVersion).  Байхгүй бол $null.
function Installed-Version([string]$y) {
  $manifest = Join-Path $AppDataRoot "Autodesk\Revit\Addins\$y\RevitMcpAddin.addin"
  if (-not (Test-Path $manifest)) { return $null }
  $txt = ''
  try { $txt = [IO.File]::ReadAllText($manifest) } catch { return 'тодорхойгүй' }
  if ($txt -notmatch [regex]::Escape($AddInId)) { return $null }
  $m = [regex]::Match($txt, '<Assembly>\s*(.*?)\s*</Assembly>')
  if (-not $m.Success) { return 'тодорхойгүй' }
  $asm = [System.Net.WebUtility]::HtmlDecode($m.Groups[1].Value)
  if (-not [IO.Path]::IsPathRooted($asm)) { $asm = Join-Path (Split-Path $manifest -Parent) $asm }
  if (-not (Test-Path $asm)) { return 'эвдэрсэн (DLL алга)' }
  $rel = Join-Path (Split-Path $asm -Parent) 'release.json'
  if (Test-Path $rel) {
    try {
      $v = [string](([IO.File]::ReadAllText($rel, [Text.Encoding]::UTF8) | ConvertFrom-Json).version)
      if ($v -match '^\d+\.\d+\.\d+$') { return $v }
    } catch { }
  }
  try {
    $fv = (Get-Item $asm).VersionInfo.FileVersion
    if ($fv -match '^(\d+\.\d+\.\d+)') { return $Matches[1] }
  } catch { }
  return 'тодорхойгүй'
}

function Run-Child([string[]]$argList, [string]$resultFile) {
  if (Test-Path $resultFile) { Remove-Item -Force $resultFile }
  $all = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $child) + $argList + @('-Quiet', '-ResultFile', $resultFile)
  $p = Start-Process -FilePath 'powershell.exe' -ArgumentList ($all | ForEach-Object { if ($_ -match '\s') { '"' + $_ + '"' } else { $_ } }) -PassThru -Wait -WindowStyle Hidden
  $lines = @()
  if (Test-Path $resultFile) { $lines = @(Get-Content -Encoding UTF8 $resultFile) }
  return @{ code = $p.ExitCode; lines = $lines }
}

# --- Багц бүрэн эсэх --------------------------------------------------------------
if (-not (Test-Path $child)) {
  Show "Суулгагч бүрэн бус (setup\install.ps1 алга).  ZIP-ээ БҮРЭН задлаад Install.bat-ыг задалсан хавтаснаас нь ажиллуулна уу." 'Error'
  exit 1
}
$years = @(Get-ChildItem -Path $here -Directory | Where-Object { $_.Name -match '^20\d\d$' -and (Test-Path (Join-Path $_.FullName 'payload.zip')) } |
           Sort-Object Name | Select-Object -ExpandProperty Name)
if ($years.Count -eq 0) {
  Show "Суулгагч бүрэн бус (setup\<он>\payload.zip алга).  ZIP-ээ дахин татаж, бүрэн задална уу." 'Error'
  exit 1
}
$newVersion = '?'
try { $newVersion = [string](([IO.File]::ReadAllText((Join-Path $here "$($years[0])\release.json"), [Text.Encoding]::UTF8) | ConvertFrom-Json).version) } catch { }

$tmpDir = Join-Path ([IO.Path]::GetTempPath()) ("mgl-addin-" + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Force -Path $tmpDir | Out-Null
$lines = New-Object System.Collections.Generic.List[string]
$failed = 0
$done = 0

try {
  # =============================================================================
  #  УСТГАХ
  # =============================================================================
  if ($Uninstall) {
    Write-Host "$Product устгаж байна..."
    foreach ($y in 2024..2030) {
      $prev = Installed-Version "$y"
      $root = Join-Path $LocalRoot "MGL\RevitAddin\$y"
      if (-not $prev -and -not (Test-Path $root)) { continue }
      $args2 = @('-Year', "$y", '-Uninstall')
      if ($PurgeData) { $args2 += '-PurgeData' }
      $r = Run-Child $args2 (Join-Path $tmpDir "u$y.txt")
      if ($r.code -eq 0) { $lines.Add("Revit ${y}: устгалаа" + $(if ($prev) { " ($prev)" } else { '' })); $done++ }
      else { $lines.Add("Revit ${y}: устгаж чадсангүй"); $failed++ }
    }
    if ($done + $failed -eq 0) { Show "$Product энэ компьютерт суугаагүй байна — устгах зүйл алга." 'Warn'; exit 0 }
    $msg = ($lines -join "`n")
    if (-not $PurgeData) { $msg += "`n`nТаны тохиргоо ба серверт илгээгдээгүй ажлын цаг хадгалагдлаа." }
    if (RevitRunning) { $msg += "`n`nRevit нээлттэй — хаасны дараа бүрэн цэвэрлэгдэнэ." }
    Show $msg $(if ($failed -gt 0) { 'Warn' } else { 'Info' })
    exit $(if ($failed -gt 0) { 1 } else { 0 })
  }

  # =============================================================================
  #  СУУЛГАХ / ШИНЭЧЛЭХ
  # =============================================================================
  Write-Host "$Product $newVersion — суусан Revit-үүдийг шалгаж байна..."
  if ($DryRun) {
    foreach ($y in $years) {
      $prev = Installed-Version $y
      $has = RevitInstalled $y
      $plan = if (-not $has) { 'алгасна (Revit алга)' } elseif (-not $prev) { "шинээр суулгана ($newVersion)" } elseif ($prev -eq $newVersion) { 'аль хэдийн суусан — дахин шалгана' } else { "$prev → $newVersion шинэчилнэ" }
      $line = "Revit ${y}: Revit " + $(if ($has) { 'суусан' } else { 'алга' }) + ", MGL " + $(if ($prev) { $prev } else { 'алга' }) + " — $plan"
      Write-Host "  $line"
      Out-Result 'Info' $line
    }
    Write-Host "  (DryRun — юу ч өөрчлөөгүй.  Revit нээлттэй: $(RevitRunning))"
    exit 0
  }
  $running = RevitRunning
  foreach ($y in $years) {
    $prev = Installed-Version $y
    if (-not (RevitInstalled $y)) {
      if ($prev) { $lines.Add("Revit ${y}: Revit олдсонгүй тул алгасав (MGL нэмэлт $prev суусан хэвээр)") }
      continue
    }
    Write-Host ("  Revit {0}: {1}" -f $y, $(if ($prev) { "одоо $prev → $newVersion" } else { "шинээр суулгана" }))
    $r = Run-Child @('-Year', $y, '-Source', (Join-Path $here $y)) (Join-Path $tmpDir "i$y.txt")
    $errText = ($r.lines | Where-Object { $_ -like 'Error|*' } | ForEach-Object { $_.Substring(6) }) -join ' '
    if ($r.code -eq 0) {
      $done++
      $after = Installed-Version $y
      if ($after -ne $newVersion) {
        $failed++
        $lines.Add("Revit ${y}: АЛДАА — суулгасны дараа $after хувилбар харагдаж байна")
      } elseif (-not $prev) {
        $lines.Add("Revit ${y}: шинээр суулгалаа ($newVersion)")
      } elseif ($prev -eq $newVersion) {
        $lines.Add("Revit ${y}: $newVersion аль хэдийн суусан — шалгаад дахин баталгаажууллаа")
      } else {
        $lines.Add("Revit ${y}: $prev → $newVersion шинэчиллээ")
      }
    } else {
      $failed++
      if (-not $errText) { $errText = "код $($r.code)" }
      $lines.Add("Revit ${y}: АЛДАА — $errText" + $(if ($prev) { " (хуучин $prev хэвээр)" } else { '' }))
    }
  }

  if ($done + $failed -eq 0) {
    Show ("Энэ компьютерт Revit " + ($years -join ', ') + " олдсонгүй — суулгах зүйл алга.") 'Error'
    exit 1
  }

  $msg = "$Product $newVersion`n`n" + ($lines -join "`n") + "`n`n"
  if ($running) {
    $msg += "Revit одоо нээлттэй байна — ажлаа хадгалаад ХААГААД дахин нээнэ үү.  Шинэ хувилбар дараагийн нээлтэд ачаалагдана.`n`n"
  } else {
    $msg += "Revit-ээ нээнэ үү.`n`n"
  }
  $msg += "«MGL» таб дээрх «Тохиргоо» товчоор ERP-ийн нэр, нууц үгээрээ нэвтэрнэ (өмнө нэвтэрсэн бол дахин хэрэггүй).`nЭхний нээлтэд «Add-In Security» асуулт гарвал «Always Load» дарна."
  Show $msg $(if ($failed -gt 0) { 'Warn' } else { 'Info' })
  exit $(if ($failed -gt 0) { 1 } else { 0 })
}
catch {
  Show "Суулгалт амжилтгүй: $($_.Exception.Message)`n`nХуучин суулгац хэвээр байна." 'Error'
  exit 1
}
finally {
  try { Remove-Item -Recurse -Force $tmpDir -ErrorAction SilentlyContinue } catch { }
}
