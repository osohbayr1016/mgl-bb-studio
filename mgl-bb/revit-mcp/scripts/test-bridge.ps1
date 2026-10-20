<#
.SYNOPSIS
  MGL Revit нэмэлтийг ШАЛГАНА — Node.js шаардахгүй, зөвхөн PowerShell.

.DESCRIPTION
  Revit нээлттэй байхад ажиллуулна.  Сервер (интернэт) ШААРДАХГҮЙ —
  бүх шалгалт нь тухайн компьютер дээрх Revit-тэй л харьцана.

  Шалгах зүйлс:
    0. Суулгасан багц (release.json) — хувилбар, Revit он, payload хэш
    1. Нэмэлт ачаалагдсан эсэх (bridge.json)
       ⚠️ Revit 2024-д MCP гүүр ЗОРИУДААР байхгүй тул 1-7 АЛГАСагдаж,
          скрипт exit 0 буцаана.  Тэр нь алдаа БИШ.
    2. /health
    3. Аюулгүй байдал: токенгүй -> 401, дурын код -> 403
    4. Баримтын таних тэмдэг (doc_uid)  <-- ХАРИУГ ХУУЛЖ ЯВУУЛНА
    5. Хуудасны жагсаалт
    6. Суурь тэмдэглэх / ялгавар

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File test-bridge.ps1
#>
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
$ErrorActionPreference = 'Continue'

$script:pass = 0
$script:fail = 0
$script:skip = 0
function OK($m)   { $script:pass++; Write-Host "  ЗӨВ   $m" -ForegroundColor Green }
function NO($m)   { $script:fail++; Write-Host "  АЛДАА $m" -ForegroundColor Red }
function SK($m)   { $script:skip++; Write-Host "  АЛГАС $m" -ForegroundColor DarkYellow }

# --- HTTP туслах (PowerShell 5.1: 4xx нь exception шиддэг) ------------------
function Send-Json {
    param([string]$Url, [string]$Method = 'GET', $Body = $null, [hashtable]$Headers = @{}, [int]$TimeoutSec = 130)
    $result = @{ Status = 0; Text = ''; Error = '' }
    try {
        $params = @{
            Uri             = $Url
            Method          = $Method
            Headers         = $Headers
            TimeoutSec      = $TimeoutSec
            UseBasicParsing = $true
        }
        if ($null -ne $Body) {
            $params['Body']        = (ConvertTo-Json $Body -Depth 6 -Compress)
            $params['ContentType'] = 'application/json'
        }
        $r = Invoke-WebRequest @params
        $result.Status = [int]$r.StatusCode
        $result.Text   = $r.Content
    }
    catch {
        if ($_.Exception.Response) {
            $result.Status = [int]$_.Exception.Response.StatusCode
            try {
                $sr = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
                $result.Text = $sr.ReadToEnd()
                $sr.Close()
            } catch {}
        }
        else { $result.Error = $_.Exception.Message }
    }
    return $result
}

function Call-Tool {
    param([string]$Base, [string]$Name, $Args = @{}, [hashtable]$Headers)
    return Send-Json -Url "$Base/tool" -Method 'POST' -Headers $Headers -Body @{ tool = $Name; args = $Args }
}

Write-Host ""
Write-Host "============ MGL Revit нэмэлт — шалгалт ============" -ForegroundColor Cyan

# --- 0. Суулгасан багцын таних тэмдэг (release.json) ------------------------
# ⚠️ ЭНЭ АЛХАМ ДАРААГИЙН БҮХНИЙГ ТОДОРХОЙЛНО.  release.json нь суулгасан
#    багцын Revit ОНЫГ хэлдэг ба Revit 2024-д MCP гүүр ЗОРИУДААР байхгүй
#    (csproj:99-102 нь MCP_EXECUTOR-ыг net48-аас хасдаг, csproj:157-162 нь
#    HttpServer.cs-ийг хасдаг) тул тэнд bridge.json ХЭЗЭЭ Ч үүсэхгүй.
#    Урьд нь энэ скрипт тэр машин дээр 1-р алхамдаа БАТАЛГААТАЙ exit 1
#    өгдөг байсан — ажилтан улаан гаралт илгээдэг, гэтэл суулгац нь
#    БҮРЭН ЗӨВ байсан.
Write-Host ""
Write-Host "0. Суулгасан багц"
$script:relVersion = "?"
$script:relYear    = 0
$relPaths = @()
foreach ($y in 2024,2025,2026,2027) {
    $relPaths += (Join-Path $env:APPDATA "Autodesk\Revit\Addins\$y\RevitMcpAddin\release.json")
}
# Задалсан ZIP-ийн дэргэдээс ажиллаж байвал тэндхийг нь мөн хараарай.
$relPaths += (Join-Path $PSScriptRoot "release.json")
$relFound = $null
foreach ($rp in $relPaths) { if (Test-Path $rp) { $relFound = $rp; break } }
if (-not $relFound) {
    NO "release.json алга — албан ёсны БУС (эсвэл гараар хуулсан) суулгац"
} else {
    try {
        $rel = Get-Content $relFound -Raw | ConvertFrom-Json
        $script:relVersion = "$($rel.version)"
        $script:relYear    = [int]("$($rel.revit)")
        OK "багц: хувилбар $($rel.version) · Revit $($rel.revit)"
        Write-Host "     payload_sha256 : $($rel.payload_sha256)"
        Write-Host "     git_sha        : $($rel.git_sha)"
        if ($rel.git_dirty -eq $true) {
            Write-Host "     АНХААР: энэ багц commit ХИЙГДЭЭГҮЙ кодоос гарсан." -ForegroundColor Yellow
        }
    } catch { NO "release.json уншигдсангүй: $($_.Exception.Message)" }
}

# --- 1. Гар барих файл -----------------------------------------------------
Write-Host ""
Write-Host "1. Нэмэлт ачаалагдсан эсэх"
$hsPath = Join-Path $env:APPDATA 'RevitMcpAddin\bridge.json'
# ⚠️ REVIT 2024 (net48) ДЭЭР MCP ГҮҮР ЗОРИУДААР ЭМХЭТГЭГДДЭГГҮЙ.
#    csproj:99-102 нь MCP_EXECUTOR-ыг зөвхөн net8/net10-д тодорхойлдог ба
#    csproj:157-162 нь HttpServer.cs-ийг net48 build-аас ХАСДАГ.  Тиймээс
#    App.cs:86-ийн BridgeAuth.Issue ХЭЗЭЭ Ч дуудагдахгүй ⇒ bridge.json
#    ХЭЗЭЭ Ч үүсэхгүй ⇒ энэ скрипт урьд нь Revit 2024-ийн БҮХ машин дээр
#    эхний алхамдаа улаанаар унадаг байв.  Тэр нь АЛДАА БИШ — тогтоосон
#    шийдвэр, тиймээс АЛГАСна.
if ($script:relYear -gt 0 -and $script:relYear -lt 2025) {
    SK "bridge — Revit 2024-д MCP гүүр БАЙХГҮЙ (csproj:99-102, ЗОРИУДААР)"
    Write-Host ""
    Write-Host "  Revit 2024-ийн багц дээр 1-7-р алхмууд хамаарахгүй." -ForegroundColor DarkYellow
    Write-Host "  MGL таб ба товчнууд харагдаж байвал суулгац ЗӨВ." -ForegroundColor DarkYellow
    Write-Host ""
    Write-Host "======  ЗӨВ $script:pass   АЛДАА $script:fail   АЛГАС $script:skip  ======" -ForegroundColor Cyan
    Write-Host "Багцын хувилбар: $script:relVersion" -ForegroundColor Cyan
    Write-Host ""
    if ($script:fail -gt 0) { exit 1 } else { exit 0 }
}
if (-not (Test-Path $hsPath)) {
    NO "bridge.json олдсонгүй: $hsPath"
    Write-Host ""
    Write-Host "  ЯАХ ВЭ:" -ForegroundColor Yellow
    Write-Host "   - Revit нээлттэй байна уу?"
    Write-Host "   - Revit-ийн туузан цэсэнд 'MGL' таб харагдаж байна уу?"
    Write-Host "   - Харагдахгүй бол нэмэлт ачаалагдаагүй: Install.bat-ыг дахин"
    Write-Host "     ажиллуулж, Revit-ээ ХААЖ дахин нээгээд 'Always Load' сонго."
    Write-Host ""
    exit 1
}
try { $hs = Get-Content $hsPath -Raw | ConvertFrom-Json } catch { NO "bridge.json уншигдсангүй: $($_.Exception.Message)"; exit 1 }
OK "bridge.json уншигдав — порт $($hs.port), pid $($hs.pid)"
if ($hs.token -and $hs.token.Length -ge 32) { OK "токен урт $($hs.token.Length)" } else { NO "токен байхгүй / хэт богино" }

$base = "http://localhost:$($hs.port)"
$auth = @{ Authorization = "Bearer $($hs.token)" }

# --- 2. /health ------------------------------------------------------------
Write-Host ""
Write-Host "2. /health (токенгүй ажиллах ёстой)"
$h = Send-Json -Url "$base/health" -TimeoutSec 15
if ($h.Status -eq 200) { OK "health 200 — $($h.Text)" }
else {
    NO "health -> $($h.Status) $($h.Error)"
    Write-Host "  Revit нээлттэй ч нэмэлтийн сервер асаагүй байж магадгүй." -ForegroundColor Yellow
    exit 1
}

# --- 3. Аюулгүй байдал -----------------------------------------------------
Write-Host ""
Write-Host "3. Аюулгүй байдал"
$noTok = Call-Tool -Base $base -Name 'list_sheets' -Headers @{}
if ($noTok.Status -eq 401) { OK "токенгүй -> 401" } else { NO "токенгүй -> 401 байх ёстой, гарсан: $($noTok.Status)" }

$badTok = Call-Tool -Base $base -Name 'list_sheets' -Headers @{ Authorization = 'Bearer wrong' }
if ($badTok.Status -eq 401) { OK "буруу токен -> 401" } else { NO "буруу токен -> 401 байх ёстой, гарсан: $($badTok.Status)" }

$ex = Send-Json -Url "$base/execute" -Method 'POST' -Headers $auth -Body @{ code = 'return Doc.Title;' }
if ($ex.Status -eq 403) { OK "/execute -> 403 (дурын код анхдагчаар УНТРААЛТТАЙ)" }
elseif ($ex.Status -eq 200) { SK "/execute -> 200 (MGL_ALLOW_EXEC=1 тавигдсан байна)" }
else { NO "/execute -> $($ex.Status)" }

# --- 4. Баримтын таних тэмдэг ---------------------------------------------
Write-Host ""
Write-Host "4. Баримтын мэдээлэл"
$ctx = Call-Tool -Base $base -Name 'get_document_context' -Headers $auth
$docOk = $false
if ($ctx.Status -eq 200) {
    $j = $null
    try { $j = $ctx.Text | ConvertFrom-Json } catch {}
    if ($j -and $j.success) {
        $doc = $j.result | ConvertFrom-Json
        $docOk = $true
        OK "баримт уншигдав"
        Write-Host "     Файл       : $($doc.file_name)"
        Write-Host "     Revit       : $($doc.revit_version)"
        Write-Host "     Хуудас      : $($doc.sheet_count)"
        Write-Host "     Worksharing : $($doc.is_workshared)"
        Write-Host "     Төслийн нэр : $($doc.project_name)"
        Write-Host ""
        Write-Host "  >>>>>>>>>>  ЭНЭ МӨРИЙГ ХУУЛЖ ЯВУУЛААРАЙ  <<<<<<<<<<" -ForegroundColor Magenta
        Write-Host "  doc_uid = $($doc.doc_uid)" -ForegroundColor Magenta
        Write-Host "  >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>" -ForegroundColor Magenta
        Write-Host ""
    }
}
if (-not $docOk) {
    SK "Revit-д төслийн файл нээгээгүй байна"
    Write-Host "  -> Revit дотор .rvt файл нээгээд энэ скриптийг ДАХИН ажиллуулна уу." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "======  ЗӨВ $script:pass   АЛДАА $script:fail   АЛГАС $script:skip  ======" -ForegroundColor Cyan
Write-Host "Багцын хувилбар: $script:relVersion" -ForegroundColor Cyan
    if ($script:fail -gt 0) { exit 1 } else { exit 0 }
}

# --- 5. Хуудасны жагсаалт --------------------------------------------------
Write-Host "5. Хуудасны жагсаалт"
$ls = Call-Tool -Base $base -Name 'list_sheets' -Headers $auth
$sheetCount = -1
if ($ls.Status -eq 200) {
    $j = $ls.Text | ConvertFrom-Json
    if ($j.success) {
        $sheets = ($j.result | ConvertFrom-Json).sheets
        $sheetCount = @($sheets).Count
        OK "$sheetCount хуудас"
        $i = 0
        foreach ($s in $sheets) {
            if ($i -ge 8) { break }
            $num = "$($s.number)".PadRight(14)
            $nm  = "$($s.name)"
            if ($nm.Length -gt 44) { $nm = $nm.Substring(0, 44) }
            Write-Host "     $num $nm"
            $i++
        }
        if ($sheetCount -gt 8) { Write-Host "     ... +$($sheetCount - 8)" }
        if ($sheetCount -eq 0) {
            Write-Host "     (хуудас байхгүй — 'Зураг холбох' тест хийхэд хуудас шаардлагатай)" -ForegroundColor Yellow
        }
    } else { NO "list_sheets: $($j.error)" }
} else { NO "list_sheets -> $($ls.Status)" }

# --- 6. Суурь / ялгавар ----------------------------------------------------
Write-Host ""
Write-Host "6. Суурь тэмдэглэх ба ялгавар"
$cb = Call-Tool -Base $base -Name 'capture_baseline' -Headers $auth
if ($cb.Status -eq 200) {
    $j = $cb.Text | ConvertFrom-Json
    if ($j.success) {
        $b = $j.result | ConvertFrom-Json
        OK "суурь авав — $($b.element_count) элемент, $($b.sheet_count) хуудас"
    } else { NO "capture_baseline: $($j.error)" }
} else { NO "capture_baseline -> $($cb.Status)" }

$df = Call-Tool -Base $base -Name 'diff_since_baseline' -Headers $auth
if ($df.Status -eq 200) {
    $j = $df.Text | ConvertFrom-Json
    if ($j.success) {
        $d = $j.result | ConvertFrom-Json
        $ch = @($d.changed_sheets).Count
        OK "ялгавар: нэмэгдсэн=$($d.totals.added) хассан=$($d.totals.removed) өөрчлөгдсөн хуудас=$ch"
        if ($d.self_reported -eq $true) { OK "self_reported=true (сервер баталгаажуулаагүй гэдгээ хэлж байна)" }
        else { NO "self_reported алга" }
    } else { NO "diff_since_baseline: $($j.error)" }
} else { NO "diff_since_baseline -> $($df.Status)" }

# --- 7. Танихгүй хэрэгсэл --------------------------------------------------
Write-Host ""
Write-Host "7. Танихгүй хэрэгсэл (алдааны зан)"
$bad = Call-Tool -Base $base -Name 'no_such_tool' -Headers $auth
$badJson = $null
try { $badJson = $bad.Text | ConvertFrom-Json } catch {}
if ($badJson -and ($badJson.success -eq $false) -and $badJson.error) { OK "ойлгомжтой алдаа буцаав" }
else { NO "танихгүй хэрэгслийн зан: $($bad.Status) $($bad.Text)" }

Write-Host ""
Write-Host "======  ЗӨВ $script:pass   АЛДАА $script:fail   АЛГАС $script:skip  ======" -ForegroundColor Cyan
Write-Host "Багцын хувилбар: $script:relVersion" -ForegroundColor Cyan
Write-Host ""
if ($script:fail -eq 0) {
    Write-Host "Нэмэлт зөв ажиллаж байна." -ForegroundColor Green
    Write-Host "Дараагийн шат (СЕРВЕР ШААРДАНА): MGL таб > 'Зураг холбох' > 'MGL туслах'." -ForegroundColor Green
} else {
    Write-Host "Алдаа гарлаа — дээрх гаралтыг БҮХЭЛД НЬ хуулж илгээнэ үү." -ForegroundColor Red
}
Write-Host ""
if ($script:fail -gt 0) { exit 1 }
