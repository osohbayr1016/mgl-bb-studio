# MGL Revit нэмэлт — НЭГ ТОВЧТОЙ, ХЭРЭГЛЭГЧ ТУТМЫН суулгагч / устгагч (Revit нэг он).
#
# Хоёр газраас дуудагдана:
#   1. `MGL-Revit2027-Setup-<хувилбар>.exe` — IExpress энэ скриптийг түр хавтсанд
#      задалж параметргүй ажиллуулна (-Year = 2027, payload нь скриптийн хажууд).
#   2. Нэгдсэн багц `MGL-Revit-Addin-<хувилбар>.zip` → `Install.bat` →
#      `setup\install-all.ps1` нь суусан Revit ОН БҮРД энийг
#      `-Year <он> -Source setup\<он> -Quiet -ResultFile …`-оор тусдаа процесст дуудна.
# ЯМАР Ч АСУУЛТГҮЙ: сервер хаяг, зам, тохиргоо, admin эрх — нэг нь ч хэрэггүй.
#
# ⚠️ ОН БҮР ТУСДАА: хувилбарын хавтас, манифест, «Apps & features» мөр
#    (`MGL.RevitAddin.<он>`) бүгд оноор салдаг — 2024-ийг шинэчлэхэд 2027 хөндөгдөхгүй.
#
# ХАЙНА:
#   %LOCALAPPDATA%\MGL\RevitAddin\<он>\versions\<хувилбар>\   ← DLL-үүд
#   %APPDATA%\Autodesk\Revit\Addins\<он>\RevitMcpAddin.addin   ← Revit-ийн манифест (абсолют зам)
#   HKCU\...\Uninstall\MGL.RevitAddin.<он>                     ← «Apps & features»-д устгах мөр
#   %APPDATA%\RevitMcpAddin\                                   ← тохиргоо, токен, офлайн дараалал (ХӨНДӨХГҮЙ)
#
# ⚠️ ХУВИЛБАР ТУС БҮР ӨӨРИЙН ХАВТСАНД.  Revit нээлттэй байхад DLL түгжигддэг —
#    шинэ хувилбар ХАЖУУД нь суугаад манифест л солигдоно.  Нээлттэй Revit
#    хуучин хувилбараараа ажилласаар, дараагийн нээлтэд шинэ нь ачаалагдана.
#    ХАГАС ачаалагдсан хувилбар ХЭЗЭЭ Ч үүсэхгүй.
# ⚠️ ManifestAddInId нь хуучин zip/dev суулгацынхтай ИЖИЛ, файлын нэр ч ижил —
#    дахин суулгахад давхар манифест үүсэхгүй, хуучныг дарна.
# ⚠️ Устгахад локал өгөгдөл (%APPDATA%\RevitMcpAddin) ХАДГАЛАГДАНА: тэнд
#    серверт илгээгдээгүй ажлын цаг/тайлан байж болно — дахин суулгахад
#    илгээгдэнэ.  Бүрэн цэвэрлэх: -PurgeData.
# ⚠️ Энэ файл UTF-8 BOM-той байх ЁСТОЙ (Windows PowerShell 5.1 BOM-гүй бол
#    кирилл уншиж чадахгүй) — build-installer.ps1 BOM-той бичнэ.

[CmdletBinding()]
param(
  [switch]$Uninstall,
  [switch]$PurgeData,
  [switch]$Quiet,
  # Revit он.  Өгөгдмөл 2027 — Setup exe параметргүй дууддаг (өмнөх зан төлөв ХЭВЭЭР).
  [string]$Year = '2027',
  # payload.zip + release.json-той хавтас.  Өгөгдмөл нь энэ скриптийн хавтас (Setup exe).
  [string]$Source = '',
  # Мессежийг MessageBox биш энэ файлд «төрөл|бичвэр» мөрөөр (install-all.ps1 нэгтгэнэ).
  [string]$ResultFile = ''
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

# --- Тестийн гарц (acceptance harness) — ажилтан ХЭЗЭЭ Ч тавихгүй. -----------
$AppDataRoot  = if ($env:MGL_ADDIN_TEST_APPDATA)      { $env:MGL_ADDIN_TEST_APPDATA }      else { [Environment]::GetFolderPath('ApplicationData') }
$LocalRoot    = if ($env:MGL_ADDIN_TEST_LOCALAPPDATA) { $env:MGL_ADDIN_TEST_LOCALAPPDATA } else { [Environment]::GetFolderPath('LocalApplicationData') }
$NoRegistry   = $env:MGL_ADDIN_TEST_NOREG -eq '1'
$Quiet        = $Quiet -or ($env:MGL_ADDIN_TEST_QUIET -eq '1')
if (-not $ResultFile) { $ResultFile = $env:MGL_ADDIN_TEST_RESULT }
if ($Year -notmatch '^20\d\d$') { Write-Host "Буруу Revit он: $Year"; exit 1 }

$AddInId   = '7f3d9c2a-1b4e-4a6f-9c8d-2e5a1b3c4d5e'
$Product   = "MGL Revit $Year нэмэлт"
$RegKey    = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\MGL.RevitAddin.$Year"
$Root      = Join-Path $LocalRoot "MGL\RevitAddin\$Year"
$Versions  = Join-Path $Root 'versions'
$AddinsDir = Join-Path $AppDataRoot "Autodesk\Revit\Addins\$Year"
$Manifest  = Join-Path $AddinsDir 'RevitMcpAddin.addin'
$Legacy    = Join-Path $AddinsDir 'RevitMcpAddin'
$DataDir   = Join-Path $AppDataRoot 'RevitMcpAddin'
$LogFile   = Join-Path $Root 'install.log'

function Log([string]$m) {
  try {
    New-Item -ItemType Directory -Force -Path $Root | Out-Null
    Add-Content -Path $LogFile -Value ("{0:u}  {1}" -f (Get-Date).ToUniversalTime(), $m) -Encoding UTF8
  } catch { }
}

function Say([string]$text, [string]$kind = 'Info') {
  Log "${kind}: $text"
  if ($ResultFile) { try { Add-Content -Path $ResultFile -Value "$kind|$text" -Encoding UTF8 } catch { } }
  if ($Quiet) { return }
  try {
    Add-Type -AssemblyName System.Windows.Forms
    $icon = switch ($kind) { 'Error' { 'Error' } 'Warn' { 'Warning' } default { 'Information' } }
    [void][System.Windows.Forms.MessageBox]::Show($text, $Product, 'OK', $icon)
  } catch { Write-Host $text }
}

function Ask([string]$text) {
  if ($Quiet) { return $true }
  try {
    Add-Type -AssemblyName System.Windows.Forms
    return ([System.Windows.Forms.MessageBox]::Show($text, $Product, 'YesNo', 'Question') -eq 'Yes')
  } catch { return $true }
}

function RevitRunning {
  if ($env:MGL_ADDIN_TEST_REVIT_RUNNING -eq '1') { return $true }
  return @(Get-Process -Name 'Revit' -ErrorAction SilentlyContinue).Count -gt 0
}

function RevitInstalled {
  if ($env:MGL_ADDIN_TEST_APPDATA) { return $true }
  if (Test-Path (Join-Path $env:ProgramFiles "Autodesk\Revit $Year\Revit.exe")) { return $true }
  return (Test-Path "HKLM:\SOFTWARE\Autodesk\Revit\Autodesk Revit $Year")
}

function Test-Payload([string]$dir) {
  # payload.sha256.txt-ийн мөр бүр:  <sha256><2 зай><харьцангуй зам>
  $list = Join-Path $dir 'payload.sha256.txt'
  if (-not (Test-Path $list)) { return 'payload.sha256.txt алга' }
  $n = 0
  foreach ($line in [IO.File]::ReadAllLines($list)) {
    if (-not $line.Trim()) { continue }
    $parts = $line -split '\s+', 2
    if ($parts.Count -lt 2) { continue }
    $f = Join-Path $dir $parts[1].Trim()
    if (-not (Test-Path $f)) { return "дутуу файл: $($parts[1])" }
    if ((Get-FileHash -Algorithm SHA256 $f).Hash.ToLower() -ne $parts[0].ToLower()) { return "хэш зөрсөн: $($parts[1])" }
    $n++
  }
  if ($n -eq 0) { return 'хоосон payload' }
  return $null
}

function Write-Manifest([string]$dllPath) {
  New-Item -ItemType Directory -Force -Path $AddinsDir | Out-Null
  $xml = @"
<?xml version="1.0" encoding="utf-8"?>
<RevitAddIns>
  <AddIn Type="Application">
    <Name>MGL</Name>
    <Assembly>$([Security.SecurityElement]::Escape($dllPath))</Assembly>
    <AddInId>$AddInId</AddInId>
    <FullClassName>RevitMcpAddin.App</FullClassName>
    <VendorId>com.revitmcp</VendorId>
    <VendorDescription>MGL Engineering &amp; Construction — ажлын явц, цаг бүртгэл</VendorDescription>
  </AddIn>
</RevitAddIns>
"@
  $tmp = "$Manifest.tmp"
  [IO.File]::WriteAllText($tmp, $xml, (New-Object Text.UTF8Encoding($false)))
  Move-Item -Force -Path $tmp -Destination $Manifest
}

function Remove-Quietly([string]$path) {
  if (-not (Test-Path $path)) { return $true }
  try { Remove-Item -Recurse -Force -Path $path -ErrorAction Stop; return $true } catch { return $false }
}

# Хавтасны DLL-ийг нээлттэй Revit ачаалсан (түгжигдсэн) уу.  Ийм хавтсыг Remove-Item -Recurse хэсэгчлэн устгадаг —
# DLL үлдэж, Python / нөөц файл устаад тэр Revit-ийн сесс «Python хөдөлгүүр олдсонгүй» болдог байв (2026-10-14, 1.41.0 → 1.42.0).
function Test-InUse([string]$dir) {
  if (-not (Test-Path $dir)) { return $false }
  foreach ($f in Get-ChildItem -Path $dir -Recurse -File -Filter *.dll -ErrorAction SilentlyContinue) {
    try { $s = [IO.File]::Open($f.FullName, 'Open', 'ReadWrite', 'None'); $s.Close() } catch { return $true }
  }
  return $false
}

# =============================================================================
#  УСТГАХ
# =============================================================================
if ($Uninstall) {
  Log "uninstall start (purge=$PurgeData)"
  $running = RevitRunning
  if (Test-Path $Manifest) {
    $txt = [IO.File]::ReadAllText($Manifest)
    if ($txt -match [regex]::Escape($AddInId)) { Remove-Item -Force $Manifest }
  }
  [void](Remove-Quietly $Legacy)
  $leftover = -not (Remove-Quietly $Versions)
  if (-not $NoRegistry) { try { Remove-Item -Recurse -Force $RegKey -ErrorAction SilentlyContinue } catch { } }
  if ($PurgeData) { [void](Remove-Quietly $DataDir) }
  foreach ($f in 'uninstall.ps1', 'current.json') { [void](Remove-Quietly (Join-Path $Root $f)) }
  $msg = "MGL нэмэлтийг Revit $Year-оос устгалаа."
  if ($leftover -or $running) { $msg += "`n`nRevit нээлттэй байсан тул зарим файл үлдсэн — Revit-ийг хаасны дараа дахин устгавал бүрэн цэвэрлэгдэнэ." }
  if (-not $PurgeData) { $msg += "`n`nТаны тохиргоо ба серверт хараахан илгээгдээгүй ажлын цаг хадгалагдлаа ($DataDir)." }
  Say $msg
  exit 0
}

# =============================================================================
#  СУУЛГАХ
# =============================================================================
try {
  $src = if ($Source) { $Source } else { $PSScriptRoot }
  $releasePath = Join-Path $src 'release.json'
  $payloadZip  = Join-Path $src 'payload.zip'
  if (-not (Test-Path $releasePath) -or -not (Test-Path $payloadZip)) {
    Say 'Суулгагч бүрэн бус байна (release.json эсвэл payload.zip алга). Суулгагчаа дахин татаж авна уу.' 'Error'
    exit 1
  }
  $release = [IO.File]::ReadAllText($releasePath, [Text.Encoding]::UTF8) | ConvertFrom-Json
  $version = [string]$release.version
  if ($version -notmatch '^\d+\.\d+\.\d+$') { Say "Буруу хувилбарын дугаар: $version" 'Error'; exit 1 }
  Log "install $version start"

  if (-not (RevitInstalled)) {
    if (-not (Ask "Энэ компьютерт Revit $Year олдсонгүй.`n`nГэсэн ч суулгах уу?")) { Log 'cancelled: no revit'; exit 1 }
  }

  $running = RevitRunning
  $target = Join-Path $Versions $version
  $staging = Join-Path $Versions "$version.new"
  New-Item -ItemType Directory -Force -Path $Versions | Out-Null

  # 1. Задлаад ХЭШЭЭР шалгана — зөрвөл юу ч хөндөхгүй.
  [void](Remove-Quietly $staging)
  Expand-Archive -Path $payloadZip -DestinationPath $staging -Force
  $bad = Test-Payload $staging
  if ($bad) {
    [void](Remove-Quietly $staging)
    Say "Суулгах файл гэмтсэн байна ($bad). Суулгагчаа дахин татаж авна уу. Хуучин суулгац ХЭВЭЭР." 'Error'
    exit 1
  }

  # 2. Хувилбарын хавтас.
  #    ⚠️ V03 (2026-10-16): урьд нь `versions\<хувилбар>` хавтас өөрийнхөө жагсаалттай таарвал «зөв суусан» гэж ДАХИН
  #    АШИГЛАДАГ байв — ижил дугаартай ӨӨР build (өөр payload) суулгахад диск дээр ХУУЧИН DLL үлдэж, current.json ба
  #    «Apps & features» шинэ build-ийг зарладаг байсан (WE-RISK-002).  Одоо payload.sha256.txt-ийн хэш ЯГ ИЖИЛ бол л
  #    дахин ашиглана; өөр бол хавтсыг солино; солих боломжгүй (нээлттэй Revit DLL-ийг барьж байна) бол тухайн build-ийн
  #    ӨӨРЧЛӨГДӨХГҮЙ хавтас `<хувилбар>-b<payload sha8>`-д суулгаж манифестыг тийш заана (дараагийн нээлтэд ачаалагдана).
  $newSha = (Get-FileHash -Algorithm SHA256 (Join-Path $staging 'payload.sha256.txt')).Hash.ToLower()
  if ($release.payload_sha256 -and ([string]$release.payload_sha256).ToLower() -ne $newSha) {
    [void](Remove-Quietly $staging)
    Say "Суулгагч гэмтсэн байна (release.json payload-тай таарахгүй). Суулгагчаа дахин татаж авна уу. Хуучин суулгац ХЭВЭЭР." 'Error'
    exit 1
  }
  function Test-SameBuild([string]$dir) {
    $l = Join-Path $dir 'payload.sha256.txt'
    if (-not (Test-Path $l)) { return $false }
    if ((Get-FileHash -Algorithm SHA256 $l).Hash.ToLower() -ne $newSha) { return $false }
    return -not (Test-Payload $dir)
  }
  $reuse = $false
  if (Test-Path $target) {
    if (Test-SameBuild $target) {
      $reuse = $true
      [void](Remove-Quietly $staging)
    } elseif ((Test-InUse $target) -or -not (Remove-Quietly $target)) {
      # Нээлттэй Revit хуучин build-ийг барьж байна (эсвэл устгагдсангүй) — шинэ build-д ӨӨРИЙН хавтас.
      $target = Join-Path $Versions ("$version-b" + $newSha.Substring(0, 8))
      if (Test-Path $target) {
        if (Test-SameBuild $target) {
          $reuse = $true
          [void](Remove-Quietly $staging)
        } elseif (-not (Remove-Quietly $target)) {
          [void](Remove-Quietly $staging)
          Say "Revit $Year нээлттэй байгаа тул $version хувилбарын файлуудыг солих боломжгүй.`n`nRevit-ийг хаагаад суулгагчийг дахин ажиллуулна уу." 'Error'
          exit 1
        }
      }
      Log "install $version -> $(Split-Path -Leaf $target) (same version number, different payload; previous folder in use)"
    }
  }
  if (-not $reuse) { Rename-Item -Path $staging -NewName (Split-Path -Leaf $target) }

  $dll = Join-Path $target 'RevitMcpAddin.dll'
  if (-not (Test-Path $dll)) { Say 'RevitMcpAddin.dll алга — суулгагч гэмтсэн.' 'Error'; exit 1 }
  Get-ChildItem -Path $target -Recurse -File | Unblock-File -ErrorAction SilentlyContinue

  # 3. Манифест — АТОМ солилт.  Хуучин zip/dev суулгацын манифест (ижил нэр, ижил AddInId) дарагдана.
  Write-Manifest $dll

  # 4. Хуучин суулгацын DLL хавтас (Addins\2027\RevitMcpAddin) — манифест одоо өөр газар
  #    заадаг тул ачаалагдахгүй; түгжигдээгүй бол устгана (хуучин DLL үлдэхгүй).
  $legacyLeft = if (Test-InUse $Legacy) { $true } else { -not (Remove-Quietly $Legacy) }

  # 5. Бүх хэрэглэгчийн (ProgramData) манифестад ижил AddInId байвал Revit давхардал гэж унана.
  $dup = $null
  $pd = Join-Path $env:ProgramData "Autodesk\Revit\Addins\$Year"
  if (-not $env:MGL_ADDIN_TEST_APPDATA -and (Test-Path $pd)) {
    foreach ($f in Get-ChildItem -Path $pd -Filter *.addin -ErrorAction SilentlyContinue) {
      try { if ([IO.File]::ReadAllText($f.FullName) -match [regex]::Escape($AddInId)) { $dup = $f.FullName } } catch { }
    }
  }

  # 6. Устгагч + «Apps & features» мөр (HKCU — admin эрхгүй).
  Copy-Item -Force -Path $PSCommandPath -Destination (Join-Path $Root 'uninstall.ps1')
  $current = [ordered]@{ version = $version; folder = (Split-Path -Leaf $target); installed_at = (Get-Date).ToUniversalTime().ToString('o'); payload_sha256 = $newSha; api_host = $release.api_host }
  [IO.File]::WriteAllText((Join-Path $Root 'current.json'), ($current | ConvertTo-Json), (New-Object Text.UTF8Encoding($false)))
  if (-not $NoRegistry) {
    New-Item -Force -Path $RegKey | Out-Null
    $uninstallCmd = 'powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + (Join-Path $Root 'uninstall.ps1') + '" -Uninstall -Year ' + $Year
    $size = [int]((Get-ChildItem -Path $target -Recurse -File | Measure-Object -Property Length -Sum).Sum / 1KB)
    $props = @{
      DisplayName = $Product; DisplayVersion = $version; Publisher = 'MGL Engineering & Construction'
      InstallLocation = $Root; UninstallString = $uninstallCmd; QuietUninstallString = "$uninstallCmd -Quiet"
      NoModify = 1; NoRepair = 1; EstimatedSize = $size
    }
    foreach ($k in $props.Keys) {
      $type = if ($props[$k] -is [int]) { 'DWord' } else { 'String' }
      New-ItemProperty -Force -Path $RegKey -Name $k -Value $props[$k] -PropertyType $type | Out-Null
    }
  }

  # 7. Хуучин хувилбарууд — нээлттэй Revit ашиглаж буй хавтсыг (түгжигдсэн DLL) БҮХЭЛД нь үлдээнэ, бусдыг устгана.
  #    Үлдсэнийг Revit хаагдсаны дараах суулгалт цэвэрлэнэ.
  $kept = @()
  $targetLeaf = Split-Path -Leaf $target
  foreach ($d in Get-ChildItem -Path $Versions -Directory -ErrorAction SilentlyContinue) {
    if ($d.Name -eq $targetLeaf) { continue }
    if (Test-InUse $d.FullName) { $kept += $d.Name } else { [void](Remove-Quietly $d.FullName) }
  }

  Log "install $version ok (folder=$targetLeaf reuse=$reuse running=$running legacyLeft=$legacyLeft kept=$($kept -join ',') dup=$dup)"
  $msg = "$Product $version суулгалаа.`n`n"
  if ($running) {
    $msg += "Revit $Year одоо нээлттэй байна — хадгалаад ХААГААД дахин нээнэ үү. Шинэ хувилбар дараагийн нээлтэд ачаалагдана.`n`n"
  } else {
    $msg += "Revit $Year-г нээнэ үү.`n`n"
  }
  $msg += "«MGL» таб дээрх «Тохиргоо» товчоор ERP-ийн нэр, нууц үгээрээ нэвтэрнэ.`nЭхний нээлтэд «Add-In Security» асуулт гарвал «Always Load» дарна."
  if ($dup) { $msg += "`n`n⚠ Бүх хэрэглэгчийн хавтсанд хуучин манифест байна ($dup) — IT-ээр устгуулна уу." }
  Say $msg
  exit 0
}
catch {
  Log "FAILED: $($_.Exception.Message)"
  Say "Суулгалт амжилтгүй: $($_.Exception.Message)`n`nХуучин суулгац хэвээр байна. Лог: $LogFile" 'Error'
  exit 1
}
