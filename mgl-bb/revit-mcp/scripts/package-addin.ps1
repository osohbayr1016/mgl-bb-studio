<#
.SYNOPSIS
  MGL Revit add-in-ийг тархаах zip болгож савлана (repo-гүйгээр өөр PC-д суулгах).

.DESCRIPTION
  bin\x64\Release R2x\ доторх build гаралтыг Revit хувилбар болбүрт нэг zip болгоно:
    <dist>\<хувилбар>\RevitMcpAddin-Revit<он>.zip
      ├─ RevitMcpAddin.addin        (Revit-ийн manifest)
      ├─ RevitMcpAddin\             (DLL-үүд; .pdb хасагдсан)
      ├─ release.json               (энэ багцын таних тэмдэг — хувилбар, он, payload хэш)
      ├─ payload.sha256.txt         (RevitMcpAddin\ доторх файл БҮРИЙН sha256)
      ├─ Install.bat / install.ps1  (ХЭШ ШАЛГАДАГ, fail-safe суулгагч)
      ├─ Uninstall.bat / uninstall.ps1
      ├─ Test.bat / test-bridge.ps1
      └─ README.txt
  Хүлээн авагч: zip задлаад Install.bat дээр дархад л болно.

  ⚠️ ГУРВАН ХЭШИЙН ДАВХАРГА (v2 §74-ийн MANIFEST + HASH шат).
     1. `payload.sha256.txt`   — файл БҮРИЙН хэш.  ZIP ДОТОР явдаг тул
        хүлээн авагч ПК суулгахын ӨМНӨ бүгдийг шалгаж чадна.  Урьд нь
        манифест `dist\`-д, ZIP-ийн ГАДНА үлддэг байсан — хүлээн авагч
        түүнийг физикээр харах боломжгүй байв, өөрөөр хэлбэл HASH шат
        УТГА АГУУЛААГҮЙ.
     2. `release.json.payload_sha256` — (1)-ийн өөрийнх нь хэш.  Суулгасны
        ДАРАА ч машин дээр үлддэг цорын ганц баталгаа, `InstallCheck.Run`
        болон `POST /api/revit/health` -ийн `release_sha256` тэр нь.
     3. `<zip>.manifest.json.sha256` — ZIP файлын хэш.  ZIP нь өөрийнхөө
        хэшийг агуулж ЧАДАХГҮЙ тул энэ нь ЗӨВХӨН zip-ийн хажууд байна;
        архив ба `POST /api/revit-addin/releases`-ийн таних тэмдэг.

  ⚠️ ХУВИЛБАРААР САЛГАСАН ФОЛДЕР.  Гаралт нь `dist\<хувилбар>\` дотор
     буудаг.  Урьд нь бүх build `dist\` үндэс рүү ижил нэрээр бичигдэж,
     өмнөх релизийг ЧИМЭЭГҮЙ дардаг байв — тэр нь §8-ийн буцаалтын
     цорын ганц байг устгана.  Одоо хуучин файл ХЭВЭЭР үлдэнэ.

.EXAMPLE
  # Аль хэдийн build хийсэн бол зүгээр л савлана:
  pwsh -File scripts\package-addin.ps1

.EXAMPLE
  # Build + савлах (ДӨРВҮҮЛЭН — релизийн стандарт зам):
  pwsh -File scripts\package-addin.ps1 -Build

.EXAMPLE
  # Зөвхөн 2024 ба 2027 (ХЭСЭГЧИЛСЭН — релизэд хэрэглэхгүй):
  pwsh -File scripts\package-addin.ps1 -Build -Versions 2024,2027
#>
[CmdletBinding()]
param(
  [ValidateSet('2024','2025','2026','2027')]
  [string[]]$Versions = @('2024','2025','2026','2027'),
  [switch]$Build,
  # Аль хэдийн савласан ижил хувилбарыг ДАХИН бичихийг ил зөвшөөрөх.
  # ⚠️ Анхдагчаар ХОРИГЛОНО: нэг хувилбарын дугаараар хоёр өөр байт
  #    тараагдвал буцаалтын архив нь дугаараар таних чадвараа алдана.
  [switch]$Force
)
$ErrorActionPreference = 'Stop'

$addinDir = (Resolve-Path (Join-Path $PSScriptRoot '..\addin')).Path
$proj     = Join-Path $addinDir 'RevitMcpAddin.csproj'
$manifest = Join-Path $addinDir 'RevitMcpAddin.addin'
$distRoot = Join-Path (Split-Path $addinDir -Parent) 'dist'

$cfgMap = @{ '2024'='R24'; '2025'='R25'; '2026'='R26'; '2027'='R27' }

# ⚠️ РЕЛИЗИЙН ХУВИЛБАР — csproj-оос УНШИНА, энд ХАТУУ БИЧИХГҮЙ.
# Ажилтны компьютерт автомат шинэчлэл БАЙХГҮЙ тул «аль инженер аль
# build-тай явж байна» гэдгийг хэлэх цорын ганц зүйл бол энэ дугаар.
$csprojVersion = '0'
try {
  $csprojXml = [xml](Get-Content -Raw -Path $proj)
  $found = $csprojXml.Project.PropertyGroup.Version | Where-Object { $_ }
  if ($found) { $csprojVersion = ([string[]]$found)[0].Trim() }
} catch {
  Write-Warning "csproj-оос <Version> уншиж чадсангүй — манифест дээр '0' бичигдэнэ."
}
if ($csprojVersion -eq '0') {
  # ⚠️ Хувилбаргүй релиз нь бүртгэгдэх боломжгүй: `addin_releases` нь
  #    (version, revit_year, channel) гурвалаар түлхүүрлэгддэг ба '0' нь
  #    БҮХ релизийг нэг мөр болгож нийлүүлнэ.
  throw "csproj-ийн <Version> уншигдсангүй — савлалт ЗОГСЛОО."
}

$distDir = Join-Path $distRoot $csprojVersion
New-Item -ItemType Directory -Force -Path $distDir | Out-Null

# git sha — репогүй/gitгүй машин дээр ч савлалт УНАХ ЁСГҮЙ.
$gitSha = 'unknown'
$gitDirty = $false
try {
  $repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
  $sha = & git -C $repoRoot rev-parse HEAD 2>$null
  if ($LASTEXITCODE -eq 0 -and $sha) { $gitSha = $sha.Trim() }
  $dirty = & git -C $repoRoot status --porcelain 2>$null
  if ($LASTEXITCODE -eq 0 -and $dirty) { $gitDirty = $true }
} catch { }

# ⚠️ ЦЭВЭР БУС АЖЛЫН МОД = МАНИФЕСТЫН ХУДАЛ `git_sha`.  2026-08-28-ны
#    dist\ доторх манифестууд `git_sha 9fe82a04` гэж бичигдсэн атлаа
#    савласан .cs файлууд түүнээс ДӨРӨВ ГАРУЙ commit ШИНЭ байсан —
#    өөрөөр хэлбэл zip нь өөрийнхөө нэрлэсэн эх кодтой ТААРАХГҮЙ.
#    Тиймээс энэ нь манифестад ил тэмдэглэгдэнэ (зогсоохгүй: зөвшөөрөгдсөн
#    ажлын урсгал нь commit-оос ӨМНӨ туршилтын багц гаргах явдал).
if ($gitDirty) {
  Write-Warning "Ажлын мод ЦЭВЭР БИШ — манифест дээр git_dirty=true гэж тэмдэглэгдэнэ."
}

# --------------------------------------------------------------------------
#  install.ps1 — ТЭГ-АЛДААТАЙ СУУЛГАГЧ (v2 §74-ийн INSTALL шат)
#  __YEAR__-ийг он-оор солино. Литерал тул single-quote here-string.
# --------------------------------------------------------------------------
$installPs1Template = @'
# MGL Revit нэмэлт суулгагч — Revit __YEAR__
#
# ⚠️ ЯАГААД ЭНЭ БҮХЭН ХЭРЭГТЭЙ ВЭ: ~20 машин дээр ГАРААР дараалан суулгадаг
#    ба алдаа гарвал оператор түүнийг МЭДЭХГҮЙ өнгөрдөг байв — хуучин
#    хувилбар нь «Дууслаа» гэсэн НОГООН мөрийг БОЛЗОЛГҮЙ хэвлэдэг байсан.
#    v2 §74: «A client with an incompatible version must fail gracefully and
#    not corrupt user work.»
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
$ErrorActionPreference = 'Stop'          # ⚠️ 1-Р ЗАСВАР: чимээгүй үргэлжлэхийг зогсооно
$year = '__YEAR__'
$src  = $PSScriptRoot
$dst  = Join-Path $env:APPDATA "Autodesk\Revit\Addins\$year"

function Fail($m) { Write-Host ""; Write-Host "АЛДАА: $m" -ForegroundColor Red; exit 1 }

Write-Host "MGL Revit нэмэлт ($year) суулгаж байна ->" $dst

# --- 0. Багц бүрэн эсэх --------------------------------------------------
if (-not (Test-Path (Join-Path $src 'RevitMcpAddin.addin'))) {
    Fail "RevitMcpAddin.addin олдсонгүй. ZIP-ээ БҮРЭН задалсан эсэхээ шалгана уу."
}
if (-not (Test-Path (Join-Path $src 'release.json'))) {
    Fail "release.json олдсонгүй — энэ багц бүрэн бус эсвэл албан ёсны БИШ."
}
if (-not (Test-Path (Join-Path $src 'payload.sha256.txt'))) {
    Fail "payload.sha256.txt олдсонгүй — хэш шалгах боломжгүй. Багц бүрэн бус."
}

# --- 1. Revit ажиллаж байвал ЗОГСОНО (2-Р ЗАСВАР) ------------------------
# ⚠️ Revit нээлттэй бол DLL түгжигдэнэ.  Урьд нь энэ үед хуучин фолдер
#    УСТААД шинэ нь хуулагдаж чаддаггүй байв — машин НЭМЭЛТГҮЙ үлддэг,
#    өөрөөр хэлбэл суулгалтын оролдлого нь өмнөхөөсөө МУУ төлөв үлдээдэг.
$revitProcs = @(Get-Process -ErrorAction SilentlyContinue |
                Where-Object { $_.Name -like 'Revit*' })
if ($revitProcs.Count -gt 0) {
    $names = ($revitProcs | Select-Object -ExpandProperty Name -Unique) -join ', '
    Fail "Revit ажиллаж байна ($names). Revit-ээ БҮГДИЙГ хаагаад дахин ажиллуулна уу."
}

# --- 2. Тухайн Revit он суусан эсэх --------------------------------------
# ⚠️ Урьд нь буруу оны zip суулгах нь БҮРЭН ЧИМЭЭГҮЙ no-op байв.
# ⚠️ ЭНЭ БОЛ СУУЛГАГЧИЙН ЦОРЫН ГАНЦ АСУУЛТ (R7 / v2 §53).  Нэвтрэх нэр,
#    төсөл, баг, хэл, зам, сувгийн сонголт, телеметрийн зөвшөөрөл —
#    НЭГ Ч АСУУЛТ БАЙХГҮЙ.
$revitRoot = Join-Path $env:ProgramFiles "Autodesk\Revit $year"
if (-not (Test-Path $revitRoot)) {
    Write-Host "АНХААР: Revit $year энэ компьютерт олдсонгүй ($revitRoot)." -ForegroundColor Yellow
    Write-Host "        Буруу оны багц суулгаж байж магадгүй." -ForegroundColor Yellow
    $ans = Read-Host "Үргэлжлүүлэх үү? (t/y = тийм)"
    if ($ans -notmatch '^[tyTY]') { Fail "Хэрэглэгч зогсоов." }
}

# --- 3. ХУУЛААД ДАРАА НЬ СОЛИНО (3-Р ЗАСВАР) -----------------------------
# ⚠️ Урьд нь `Remove-Item $addin` нь хуулахаас ӨМНӨ ажилладаг байв.
#    Одоо: .new руу хуулж, БАТАЛГААЖУУЛААД, дараа нь атомарт ойр солино.
#    Аль ч алхамд унасан ч ХУУЧИН СУУЛГАЦ БҮРЭН ХЭВЭЭР үлдэнэ.
New-Item -ItemType Directory -Force -Path $dst | Out-Null
$addin = Join-Path $dst 'RevitMcpAddin'
$new   = "$addin.new"
$old   = "$addin.old"
if (Test-Path $new) { Remove-Item -Recurse -Force $new }
Copy-Item (Join-Path $src 'RevitMcpAddin') $new -Recurse -Force

# --- 4. ХЭШ БАТАЛГААЖУУЛАЛТ (4-Р ЗАСВАР) ---------------------------------
# ⚠️ Урьд нь манифест `dist\`-д үлддэг байсан тул хүлээн авагч ПК хэзээ ч
#    шалгаж чаддаггүй байв.  Одоо payload.sha256.txt нь zip ДОТОР ирнэ.
# ⚠️ Энэ нь БҮРЭН БҮТЭН БАЙДЛЫГ (integrity) шалгана, ГАРАЛ ҮҮСЛИЙГ
#    (authenticity) БИШ — код гарын үсгийн гэрчилгээ БАЙХГҮЙ.
Write-Host "Хэш шалгаж байна..."
$bad = 0
$checked = 0
foreach ($line in Get-Content (Join-Path $src 'payload.sha256.txt')) {
    if (-not $line.Trim()) { continue }
    $parts = $line -split '\s+', 2
    if ($parts.Count -lt 2) { continue }
    $want  = $parts[0].ToLower()
    $rel   = $parts[1].Trim()
    $f     = Join-Path $new $rel
    $checked++
    if (-not (Test-Path $f)) { Write-Host "  ДУТУУ: $rel" -ForegroundColor Red; $bad++; continue }
    $got = (Get-FileHash -Algorithm SHA256 $f).Hash.ToLower()
    if ($got -ne $want) { Write-Host "  ЗӨРСӨН: $rel" -ForegroundColor Red; $bad++ }
}
if ($checked -eq 0) {
    Remove-Item -Recurse -Force $new
    Fail "payload.sha256.txt ХООСОН — багц бүрэн бус. Суулгалт ЦУЦЛАГДЛАА."
}
if ($bad -gt 0) {
    Remove-Item -Recurse -Force $new
    Fail "$bad файл зөрлөө — суулгалт ЦУЦЛАГДЛАА. Хуучин суулгац ХЭВЭЭР байна. ZIP-ээ дахин тата."
}
Write-Host "  $checked файл шалгагдаж, бүгд ТААРАВ." -ForegroundColor Green

# --- 5. Солилт -----------------------------------------------------------
if (Test-Path $old)   { Remove-Item -Recurse -Force $old }
if (Test-Path $addin) { Rename-Item $addin $old }
Rename-Item $new $addin
if (Test-Path $old)   { Remove-Item -Recurse -Force $old }
Copy-Item (Join-Path $src 'RevitMcpAddin.addin') $dst -Force
# ⚠️ release.json ба payload.sha256.txt хоёулаа СУУЛГАЦ ДОТОР үлдэнэ:
#    `InstallCheck.Run()` тэднийг уншиж «энэ бол ямар багц вэ» гэдгийг
#    сервер рүү мэдээлдэг.  Тэдгүйгээр `POST /api/revit/health` нь
#    `recognised: false` буцаана.
Copy-Item (Join-Path $src 'release.json')        (Join-Path $addin 'release.json') -Force
Copy-Item (Join-Path $src 'payload.sha256.txt')  (Join-Path $addin 'payload.sha256.txt') -Force

# --- 6. Unblock — ЗӨВХӨН БИДНИЙ ФОЛДЕР (5-Р ЗАСВАР) ----------------------
# ⚠️ Урьд нь `$dst`-ыг БҮХЭЛД НЬ Unblock хийдэг байсан — тэр нь ӨӨР
#    БОРЛУУЛАГЧИЙН нэмэлтүүдийн Mark-of-the-Web төлөвийг чимээгүй өөрчилдөг.
Get-ChildItem $addin -Recurse -File | Unblock-File
Unblock-File (Join-Path $dst 'RevitMcpAddin.addin')

$ver = '?'
try { $ver = (Get-Content (Join-Path $src 'release.json') -Raw | ConvertFrom-Json).version } catch {}
Write-Host ""
Write-Host "Суулгалт АМЖИЛТТАЙ. Хувилбар: $ver" -ForegroundColor Green
Write-Host "Revit $year-г нээгээд MGL таб гарч ирсэн эсэхийг шалгана уу." -ForegroundColor Green
Write-Host "Эхний нээлтэд 'Add-In Security' анхааруулга гарвал 'Always Load' сонгоно."
exit 0
'@

# --------------------------------------------------------------------------
#  uninstall.ps1 — ӨГӨГДЛИЙГ АНХДАГЧААР ХАДГАЛНА
# --------------------------------------------------------------------------
$uninstallPs1Template = @'
# MGL Revit нэмэлт УСТГАГЧ — Revit __YEAR__
param([switch]$PurgeData)     # ⚠️ АНХДАГЧ нь локал өгөгдлийг ХАДГАЛНА
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
$year = '__YEAR__'
$dst  = Join-Path $env:APPDATA "Autodesk\Revit\Addins\$year"
$manifest = Join-Path $dst 'RevitMcpAddin.addin'
$folder   = Join-Path $dst 'RevitMcpAddin'

Write-Host "MGL Revit нэмэлт ($year) устгаж байна ->" $dst
$removed = 0
if (Test-Path $manifest) { Remove-Item -Force $manifest; $removed++ }
if (Test-Path $folder)   { Remove-Item -Recurse -Force $folder; $removed++ }

# ⚠️ ЯАГААД АНХДАГЧААР УСТГАХГҮЙ ВЭ: %APPDATA%\RevitMcpAddin дотор
#    settings.json (≈1 ЖИЛИЙН API токен), assistant-log.jsonl (илгээгдээгүй
#    сургалтын мөрүүдийн ЦОРЫН ГАНЦ хуулбар), timing.log, changes\*.json,
#    events\*.jsonl байдаг.  Устгагчийг «буцаалт»-ын алхам болгож
#    ажиллуулах нь тэр бүхнийг СЭРГЭЭГДЭШГҮЙ арчина.
#
# ⚠️ БУЦААЛТАД ЭНЭ СКРИПТИЙГ ХЭРЭГЛЭХГҮЙ.  Өмнөх хувилбарын Install.bat-ыг
#    дээрээс нь ажиллуулах нь илүү аюулгүй (§8.2).
$appdata = Join-Path $env:APPDATA 'RevitMcpAddin'
if ($PurgeData) {
    if (Test-Path $appdata) {
        Remove-Item -Recurse -Force $appdata
        Write-Host "Локал өгөгдөл (тохиргоо, ТОКЕН, бүртгэл) УСТГАГДЛАА." -ForegroundColor Yellow
    }
} else {
    Write-Host "Локал тохиргоо, токен, бүртгэл ХЭВЭЭР үлдлээ ($appdata)."
    Write-Host "Бүрэн устгах бол:  powershell -NoProfile -ExecutionPolicy Bypass -File uninstall.ps1 -PurgeData"
}

if ($removed -gt 0) { Write-Host "Устгагдлаа. Revit-ээ дахин нээнэ уу." -ForegroundColor Green }
else { Write-Host "Суулгац олдсонгүй — цэвэрлэх зүйл байхгүй." -ForegroundColor Yellow }
'@

$readmeTemplate = @'
MGL Revit нэмэлт — Revit __YEAR__   ·   хувилбар __VERSION__
=============================================================

СУУЛГАХ
-------
  1. Энэ ZIP-ийг задлана.
     (Задлахаас ӨМНӨ ZIP дээрээ баруун товч > Properties > "Unblock" тэмдэглэвэл сайн.)
  2. Revit __YEAR__-г БҮГДИЙГ нь ХААНА.  (Нээлттэй бол суулгагч ЗОГСОНО.)
  3. "Install.bat" дээр давхар дарна.
  4. Суулгагч файл БҮРИЙН хэшийг шалгана.  "ЗӨРСӨН" гэсэн УЛААН мөр
     гарвал суулгалт ЦУЦЛАГДАНА — хуучин суулгац ХЭВЭЭР ажиллана.
     Тэр тохиолдолд ZIP-ээ ДАХИН татаж авна уу.
  5. Ногоон "Суулгалт АМЖИЛТТАЙ" мөр гарсны дараа Revit __YEAR__-г нээнэ.
  6. Эхний нээлтэд "Add-In Security" анхааруулга гарвал "Always Load" сонгоно.

ЗӨВ СУУСАН ЭСЭХИЙГ ШАЛГАХ
-------------------------
  Revit-ийн туузан цэсэнд "MGL" таб гарч ирнэ.
  Тэр таб дээр ДӨРВӨН бүлэг байна:
      Ажлын явц | Сайт руу илгээх | Загвар | Тохиргоо
  "Ажлын явц" бүлэгт хоёр товч: "Зураг холбох" ба "MGL туслах".

АВТОМАТ ШАЛГАЛТ (интернэт ШААРДАХГҮЙ)
--------------------------------------
  Revit __YEAR__ НЭЭЛТТЭЙ байхад "Test.bat" дээр давхар дарна.
  Revit 2024 дээр зарим алхам ЗОРИУДААР алгасагдана — тэр нь алдаа БИШ
  (Revit 2024-д MCP гүүр байхгүй, энэ нь тогтоосон шийдвэр).
  Гаралтыг БҮХЭЛД НЬ хуулж илгээнэ үү.  Скрин зургаас илүү хэрэгтэй.

  Мөн: MGL-ийн загвараас (template) ШИНЭ хоосон төсөл үүсгээд Test.bat-ыг
  ДАХИН ажиллуулж, хоёр doc_uid ижил эсэхийг харна.

"АЖЛЫН ЯВЦ" ХЭСЭГ (СЕРВЕР ШААРДАНА)
-----------------------------------
  "Зураг холбох" ба "MGL туслах" нь MGL-ийн серверт холбогдоно.
  Интернэт салсан үед эдгээр товч алдаа өгнө — энэ нь ХЭВИЙН, нэмэлтийн
  буруу БИШ.  Дээрх "Test.bat"-ийн шалгалтууд серверээс ХАМААРАЛГҮЙ ажиллана.

ГАРААР СУУЛГАХ (Install.bat ажиллахгүй бол)
-------------------------------------------
  ⚠️ ГАРААР хуулсан суулгац нь ХЭШ ШАЛГАГДААГҮЙ байна.  Боломжтой бол
     Install.bat-ыг ашиглана уу.
  1. File Explorer нээж, хаягийн мөрөнд доорхийг бичээд Enter:
        %APPDATA%\Autodesk\Revit\Addins\__YEAR__
  2. Тэр фолдер руу дараах ХОЁРЫГ хуулна:
        RevitMcpAddin.addin   (файл)
        RevitMcpAddin\        (фолдер бүхэлдээ)
  3. release.json ба payload.sha256.txt хоёрыг RevitMcpAddin\ дотор хуулна.
  4. Хуулсан файл бүр дээр Properties > "Unblock".
  5. Revit-ээ дахин нээнэ.

УСТГАХ
------
  "Uninstall.bat" дээр давхар дарна.
  ⚠️ Энэ нь тохиргоо, ТОКЕН, бүртгэлийг УСТГАХГҮЙ — зөвхөн нэмэлтийг хасна.
  Бүх зүйлийг цэвэрлэх бол:
      powershell -NoProfile -ExecutionPolicy Bypass -File uninstall.ps1 -PurgeData

ШААРДЛАГА
---------
  Revit __YEAR__ суулгасан байх.  Нэмэлт .NET runtime ШААРДЛАГАГҮЙ —
  Revit өөрийн runtime-тай ирдэг.

ХАМГИЙН ХЭРЭГТЭЙ ЗҮЙЛ: алдаа гарвал Test.bat-ийн гаралтыг БҮХЭЛД НЬ
хуулж илгээнэ үү.
'@

$done    = New-Object System.Collections.Generic.List[string]
$missing = New-Object System.Collections.Generic.List[string]
$stale   = New-Object System.Collections.Generic.List[string]

foreach ($year in $Versions) {
    $cfg    = "Release $($cfgMap[$year])"
    $binDir = Join-Path $addinDir "bin\x64\$cfg"

    if ($Build) {
        Write-Host "== Building $cfg ==" -ForegroundColor Cyan
        # ⚠️ `-p:DeployToRevit=true`-ыг ХЭЗЭЭ Ч НЭМЭХГҮЙ.  Савлалт нь
        #    `bin\x64\<cfg>`-ээс ШУУД уншдаг тул тэр target огт хэрэггүй,
        #    харин түүнийг асаах нь энэ МАШИНЫ амьд Revit суулгацуудыг
        #    дарж бичнэ (2026-08-28-нд дөрвүүлэн дарагдсан).
        & dotnet build $proj -c $cfg -p:Platform=x64 -v m
        if ($LASTEXITCODE -ne 0) { throw "Build failed for $cfg" }
    }

    if (-not (Test-Path (Join-Path $binDir 'RevitMcpAddin.dll'))) {
        # ⚠️ `Write-Warning` нь terminating БИШ тул `$ErrorActionPreference =
        #    'Stop'` түүнийг БАРИХГҮЙ.  Урьд нь 4 оноос 3 нь савлагдаад
        #    скрипт exit 0 буцаадаг байсан — ХЭСЭГЧИЛСЭН РЕЛИЗ.  Одоо
        #    тоолуурт бүртгэгдээд ТӨГСГӨЛД throw болно.
        Write-Warning "$year : build гаралт алга ($binDir). -Build флаг ашиглана уу."
        $missing.Add($year) | Out-Null
        continue
    }

    # --- ХУУЧИРСАН BUILD-ЫН ХАМГААЛАЛТ ------------------------------------
    # ⚠️ ХЭМЖИЖ ИЛРҮҮЛСЭН (2026-08-31): csproj-ийн <Version>-ыг 1.2.0 болгосны
    #    ДАРАА энэ скрипт `bin\x64\Release R25|R26`-д үлдсэн 1.1.0-ийн
    #    ХУУЧИН DLL-үүдийг «1.2.0» гэсэн манифесттэй савласан.  Тэр нь яг
    #    2026-08-28-ны dist\ доторх худал манифестын давталт: zip нь
    #    өөрийнхөө нэрлэсэн хувилбартай ТААРАХГҮЙ.  ~20 ПК дээр автомат
    #    шинэчлэл БАЙХГҮЙ тул ийм zip нь «аль машин ямар кодтой вэ» гэсэн
    #    асуултыг БУРУУ хариулна — өөрөөр хэлбэл §8-ийн буцаалт нь
    #    буруу байт руу заана.
    # ⚠️ `AssemblyVersion` нь 1.0.0.0-д ЗОРИУДААР хөлдөөгдсөн тул түүнийг
    #    БҮҮ шалга — `FileVersion` (csproj-ийн <FileVersion>) л хүний
    #    харах дугаар.
    $dllPath = Join-Path $binDir 'RevitMcpAddin.dll'
    $dllVer  = (Get-Item $dllPath).VersionInfo.FileVersion
    if (-not ("$dllVer".StartsWith($csprojVersion))) {
        Write-Warning "$year : build нь $dllVer хувилбартай, csproj нь $csprojVersion. ХУУЧИРСАН."
        $stale.Add(("{0} ({1})" -f $year, $dllVer)) | Out-Null
        continue
    }

    $zip = Join-Path $distDir "RevitMcpAddin-Revit$year.zip"
    if ((Test-Path $zip) -and -not $Force) {
        # ⚠️ Ижил хувилбарын дугаараар ХОЁР ӨӨР БАЙТ гаргах нь §8-ийн
        #    буцаалтыг утгагүй болгоно: архив нь дугаараар нэрлэгддэг.
        throw "$zip аль хэдийн байна.  csproj-ийн <Version>-ыг өсгө, эсвэл -Force."
    }

    # Staging folder
    $stage = Join-Path $env:TEMP "mgladdin_pkg_$year"
    if (Test-Path $stage) { Remove-Item -Recurse -Force $stage }
    $payloadBin = Join-Path $stage 'RevitMcpAddin'
    New-Item -ItemType Directory -Force -Path $payloadBin | Out-Null

    # DLL-үүдийг хуулна (.pdb хасна), дэд-фолдер бүтцийг хадгална.
    Get-ChildItem -Path $binDir -Recurse -File |
        Where-Object { $_.Extension -ne '.pdb' } |
        ForEach-Object {
            $rel    = $_.FullName.Substring($binDir.Length).TrimStart('\')
            $target = Join-Path $payloadBin $rel
            New-Item -ItemType Directory -Force -Path (Split-Path $target -Parent) | Out-Null
            Copy-Item $_.FullName $target -Force
        }

    # Manifest payload үндэст
    Copy-Item $manifest (Join-Path $stage 'RevitMcpAddin.addin') -Force

    # --- payload.sha256.txt — ФАЙЛ БҮРИЙН ХЭШ, ZIP ДОТОР --------------------
    # ⚠️ ЭНЭ БОЛ §74-ийн HASH ШАТЫГ УТГА АГУУЛСАН БОЛГОДОГ ГАНЦ ӨӨРЧЛӨЛТ.
    #    Хүлээн авагч ПК суулгахын ӨМНӨ файл БҮРИЙГ шалгана (install.ps1
    #    4-р алхам).  Мөр бүр:  <sha256><хоёр зай><харьцангуй зам>
    $payloadFiles = Get-ChildItem -Path $payloadBin -Recurse -File | Sort-Object FullName
    $lines = New-Object System.Collections.Generic.List[string]
    foreach ($f in $payloadFiles) {
        $rel  = $f.FullName.Substring($payloadBin.Length).TrimStart('\')
        $hash = (Get-FileHash -Algorithm SHA256 $f.FullName).Hash.ToLower()
        $lines.Add(("{0}  {1}" -f $hash, $rel)) | Out-Null
    }
    $payloadList = Join-Path $stage 'payload.sha256.txt'
    # ⚠️ BOM-гүй, LF — C#-ийн `Sha256File` нь БАЙТУУДЫГ хэшилдэг тул энд
    #    ямар нэг тэмдэгт нэмэгдвэл `release.json.payload_sha256` зөрнө.
    [System.IO.File]::WriteAllText(
        $payloadList,
        (($lines -join "`n") + "`n"),
        (New-Object System.Text.UTF8Encoding($false)))
    $payloadSha = (Get-FileHash -Algorithm SHA256 $payloadList).Hash.ToLower()

    # --- release.json — БАГЦЫН ТАНИХ ТЭМДЭГ, ZIP ДОТОР ---------------------
    # ⚠️ zip-ийн sha256-г ЭНД бичих нь БОЛОМЖГҮЙ (тахир хамаарал: zip нь
    #    өөрийнхөө хэшийг агуулж чадахгүй).  Тиймээс хоёр давхарга:
    #    payload хэш нь zip ДОТОР, zip хэш нь ХАЖУУД + addin_releases.sha256.
    $release = [ordered]@{
        schema         = 'mgl-addin-release-v1'
        version        = $csprojVersion
        revit          = $year
        channel        = 'prod'
        git_sha        = $gitSha
        git_dirty      = $gitDirty
        built_at       = (Get-Date).ToUniversalTime().ToString('o')
        files          = $payloadFiles.Count
        payload_sha256 = $payloadSha
    }
    $releaseJson = Join-Path $stage 'release.json'
    # ⚠️ BOM-ГҮЙ.  `Set-Content -Encoding UTF8` нь PowerShell 5.1 дээр BOM
    #    нэмдэг ба энэ файлыг C# (`InstallCheck.Run`), PowerShell
    #    (`test-bridge.ps1`) ба сервер гурвуулан уншина — BOM-гүй байх нь
    #    хамгийн найдвартай.
    [System.IO.File]::WriteAllText(
        $releaseJson,
        ($release | ConvertTo-Json -Depth 4),
        (New-Object System.Text.UTF8Encoding($false)))

    # install.ps1 / Install.bat / README.txt
    ($installPs1Template -replace '__YEAR__', $year) |
        Set-Content -Path (Join-Path $stage 'install.ps1') -Encoding UTF8
    "@echo off`r`npowershell -NoProfile -ExecutionPolicy Bypass -File `"%~dp0install.ps1`"`r`npause" |
        Set-Content -Path (Join-Path $stage 'Install.bat') -Encoding ASCII
    (($readmeTemplate -replace '__YEAR__', $year) -replace '__VERSION__', $csprojVersion) |
        Set-Content -Path (Join-Path $stage 'README.txt') -Encoding UTF8

    # Устгагч
    ($uninstallPs1Template -replace '__YEAR__', $year) |
        Set-Content -Path (Join-Path $stage 'uninstall.ps1') -Encoding UTF8
    "@echo off`r`npowershell -NoProfile -ExecutionPolicy Bypass -File `"%~dp0uninstall.ps1`"`r`npause" |
        Set-Content -Path (Join-Path $stage 'Uninstall.bat') -Encoding ASCII

    # Шалгах скрипт.  ⚠️ PowerShell-ээр бичсэн — архитекторын компьютерт
    # Node.js байхгүй байх магадлалтай тул JS хувилбарыг савлахгүй.
    $testSrc = Join-Path $PSScriptRoot 'test-bridge.ps1'
    if (Test-Path $testSrc) {
        Copy-Item $testSrc (Join-Path $stage 'test-bridge.ps1') -Force
        "@echo off`r`npowershell -NoProfile -ExecutionPolicy Bypass -File `"%~dp0test-bridge.ps1`"`r`npause" |
            Set-Content -Path (Join-Path $stage 'Test.bat') -Encoding ASCII
    } else {
        Write-Warning "test-bridge.ps1 олдсонгүй — Test.bat савлагдсангүй."
    }

    # --- Zip ---------------------------------------------------------------
    if (Test-Path $zip) { Remove-Item -Force $zip }
    Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $zip -Force
    Remove-Item -Recurse -Force $stage

    $zipItem = Get-Item $zip
    $mb = "{0:N2}" -f ($zipItem.Length / 1MB)
    Write-Host ("-> {0}  ({1} MB)" -f $zip, $mb) -ForegroundColor Green

    # --- РЕЛИЗИЙН МАНИФЕСТ (zip-ийн ХАЖУУД) --------------------------------
    # ⚠️ `$manifest` хувьсагч нь `RevitMcpAddin.addin` (Revit-ийн манифест);
    #    энэ нь ӨӨР зүйл — тиймээс нэрийг нь `$relManifest` гэв.
    # ⚠️ Энэ файл нь `POST /api/revit-addin/releases`-ийн БИЕ.  Түүнийг
    #    БҮХЭЛД НЬ илгээж болно — талбарын нэрс серверийнхтэй таарна.
    $zipHash = (Get-FileHash -Algorithm SHA256 $zip).Hash.ToLower()
    $mf = [ordered]@{
        version        = $csprojVersion
        revit          = $year
        revit_year     = $year
        channel        = 'prod'
        zip            = $zipItem.Name
        sha256         = $zipHash
        payload_sha256 = $payloadSha
        bytes          = $zipItem.Length
        built_at       = $release.built_at
        git_sha        = $gitSha
        git_dirty      = $gitDirty
        files          = $payloadFiles.Count
    }
    $relManifest = Join-Path $distDir ("RevitMcpAddin-Revit{0}.manifest.json" -f $year)
    # ⚠️ BOM-ГҮЙ.  `Out-File -Encoding utf8` нь PowerShell 5.1 дээр BOM нэмдэг
    #    ба энэ файл нь `POST /api/revit-addin/releases`-ийн БИЕ болж шууд
    #    илгээгддэг — BOM-той бол Worker-ийн `c.req.json()` задалж чадахгүй,
    #    хариу нь 400 болно.  (2026-08-31-нд ХЭМЖИЖ илрүүлэв: `JSON.parse`
    #    нь BOM дээр SyntaxError өгсөн.)
    [System.IO.File]::WriteAllText(
        $relManifest,
        ($mf | ConvertTo-Json -Depth 4),
        (New-Object System.Text.UTF8Encoding($false)))
    Write-Host ("-> {0}  sha256={1}" -f $relManifest, $zipHash) -ForegroundColor Green

    $done.Add($year) | Out-Null
}

Write-Host ""
Write-Host ("Хувилбар : {0}" -f $csprojVersion)
Write-Host ("Фолдер   : {0}" -f $distDir)
# ⚠️ PowerShell 5.1-д `if` нь ИЛЭРХИЙЛЭЛ БИШ (тэр нь pwsh 7-гийн зан).
# Build машин дээр 5.1 л байх магадлалтай тул хувьсагчаар урьдчилан бэлдэнэ.
$doneTxt    = '(байхгүй)'
if ($done.Count -gt 0)    { $doneTxt    = ($done -join ', ') }
$missingTxt = '(хоосон)'
if ($missing.Count -gt 0) { $missingTxt = ($missing -join ', ') }
Write-Host ("Савлагдсан: {0}" -f $doneTxt)
Write-Host ("Дутуу     : {0}" -f $missingTxt)
$staleTxt = '(хоосон)'
if ($stale.Count -gt 0) { $staleTxt = ($stale -join ', ') }
Write-Host ("Хуучирсан : {0}" -f $staleTxt)

if ($missing.Count -gt 0) {
    # ⚠️ ХЭСЭГЧИЛСЭН РЕЛИЗ ГАРГАХГҮЙ.  1C-ийн дүрэм: аль нэг Revit оныг
    #    хойшлуулбал ~20 ПК-ийн ГАР ажиллагаа ХОЁР ДАХИН гарна.
    throw ("Дутуу релиз: {0}.  Тэр Configuration-уудыг build хийгээд ДАХИН ажиллуул." -f ($missing -join ', '))
}

if ($stale.Count -gt 0) {
    # ⚠️ ХУДАЛ МАНИФЕСТ ГАРГАХГҮЙ.  Хувилбар нь эх кодтой таарахгүй zip нь
    #    буцаалтыг БУРУУ байт руу чиглүүлнэ.
    throw ("Хуучирсан build: {0}.  Тэр Configuration-уудыг -Build-аар ДАХИН барь." -f $staleTxt)
}

Write-Host ""
Write-Host "⚠️ ТАРААХААС ӨМНӨ ЗААВАЛ (2-8 §8.0):" -ForegroundColor Yellow
Write-Host "   1. Энэ фолдерыг РЕПОГИЙН ГАДНА архивла (R2 revit-addin/archive/$csprojVersion/)."
Write-Host "   2. Манифест бүрийг POST /api/revit-addin/releases рүү илгээ."
Write-Host "   3. Өмнөх хувилбарыг status='superseded' болго."
Write-Host "   4. НЭГ машин дээр UA туршилт: 401 ирж байгааг батал (403 БИШ)."
Write-Host "   ⚠️ Код гарын үсэг (signtool) ЭНЭ БАГЦАД БАЙХГҮЙ — §74-ийн"
Write-Host "      SIGN/VERIFY шат нээлттэй цоорхой хэвээр."
