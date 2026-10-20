# =====================================================================
# MGL QTO batch runner — 24/7 PC дээр Task Scheduler-ээс ажиллана.
#
# Урсгал:
#   1. batch-config.json-д жагсаасан .rvt файлуудын LastWriteTime-ийг
#      batch-state.json-той харьцуулж ӨӨРЧЛӨГДСӨН файлуудыг олно.
#   2. Өөрчлөлттэй бол batch-queue.json бичээд Revit-ийг асаана —
#      add-in (BatchQto.cs) файлуудыг detached нээж, тоо хэмжээг сервер
#      рүү илгээгээд Revit-ээ өөрөө унтраана.
#   3. batch-result.json-г уншиж, амжилттай файлуудын mtime-ийг
#      batch-state.json-д хадгална (дараагийн удаад алгасахын тулд).
#
# Файлууд (бүгд %APPDATA%\RevitMcpAddin\ дотор):
#   batch-config.json  — та бөглөнө (template-г хараарай)
#   batch-state.json   — script өөрөө хөтөлнө, гараар бүү засварла
#   batch-queue.json   — script → add-in захиалга
#   batch-result.json  — add-in → script үр дүн
#   batch-log.txt      — ажиллагааны лог
#
# Гараар турших:  powershell -ExecutionPolicy Bypass -File batch-qto.ps1 -Force
#   (-Force = mtime үл харгалзан бүх файлыг илгээнэ)
# =====================================================================
param(
    [string]$ConfigPath = "$env:APPDATA\RevitMcpAddin\batch-config.json",
    [switch]$Force
)

$ErrorActionPreference = 'Stop'
$dir = "$env:APPDATA\RevitMcpAddin"
$statePath  = Join-Path $dir 'batch-state.json'
$queuePath  = Join-Path $dir 'batch-queue.json'
# Add-in нь queue-г ажиллуулахын өмнө ЭНЭ нэр рүү шилжүүлдэг (BatchQto.cs:66).
# Тэр нь дахин ачаалалтаас хамгаалдаг зориудын механизм — PowerShell тал түүнийг
# ЗӨВХӨН эхлэхдээ устгана, ажиллаж байх үед ХЭЗЭЭ Ч ҮГҮЙ.
$processingPath = Join-Path $dir 'batch-queue.processing.json'
$resultPath = Join-Path $dir 'batch-result.json'
$logPath    = Join-Path $dir 'batch-log.txt'

function Log([string]$msg) {
    $line = "{0:yyyy-MM-dd HH:mm:ss}  {1}" -f (Get-Date), $msg
    Write-Host $line
    Add-Content -Path $logPath -Value $line -Encoding UTF8
}

if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force $dir | Out-Null }

# ---- Хуучирсан queue цэвэрлэх ----------------------------------------
# Өмнөх ажиллагаа ХАТУУ тасалдвал (Task Scheduler-ийн ExecutionTimeLimit
# дуусах, Ctrl+C, reboot, цахилгаан таслалт) batch-queue.json диск дээр
# үлддэг.  Тэр үед тухайн Windows хэрэглэгчийн ДАРААГИЙН ЭНГИЙН Revit
# нээлт (инженер ердийн ажлаа хийхээр нээсэн ч) батч горимд орж, файлуудыг
# push хийгээд Revit-ээ өөрөө хаана
# (BatchQto.cs:102 — Process.GetCurrentProcess().Kill()).  Хадгалаагүй ажил
# алдагдана, шалтгаан нь ямар ч UI-д харагдахгүй — батч горимд TaskDialog
# зориудаар харуулдаггүй (BatchQto.cs:21).
#
# Тохиргоо уншихаас ч ӨМНӨ цэвэрлэнэ: config эвдэрсэн/Revit олдохгүй үед
# script `exit 1` хийдэг тул доор тавибал үлдэгдэл БАЙНГЫН эрсдэл болно.
#
# ⚠️ ГЭХДЭЭ АМЬД ЭЗЭНТЭЙГ ЗААВАЛ ЯЛГАНА.  Хоёр ажиллагаа давхцвал
# (Task Scheduler-ийн триггер давхцах, эсвэл инженер зэрэгцээд гараар
# -Force турших) хожуу эхэлсэн нь өмнөхийн queue-г устгачихвал өмнөх
# ажиллагаа Revit-ээ асаачихаад queue-гүй үлдэж «add-in batch-г огт
# эхлүүлээгүй» гэсэн ХУДАЛ алдаа бүртгэнэ; processing файлыг нь устгавал
# бүр тэр шөнийн push бүхэлдээ алга болно.  Тиймээс queue/processing
# доторх `pid` процесс АМЬД бол ЮУГ Ч УСТГАЛГҮЙ энэ ажиллагааг алгасна.
#
# ⚠️ ГЭХДЭЭ `pid` нь ЗӨВХӨН POWERSHELL-ийг хэмждэг, REVIT-ийг ҮГҮЙ.  PS тал
# ХАТУУ алагдвал (task-ыг зогсоох, ExecutionTimeLimit, Ctrl+Break) түүний
# асаасан Revit нь push-аа ҮРГЭЛЖЛҮҮЛНЭ — тэр үед queue нь аль хэдийн
# `processing` болсон байдаг.  Зөвхөн pid-ээр шүүвэл дараагийн ажиллагаа
# «эзэнгүй» гэж үзээд ХОЁР ДАХЬ Revit асааж, ижил файлууд ДАВХАР
# `qto_runs` үүсгэнэ.  Тиймээс Revit талыг мөн шалгана
# (`Get-LiveBatchRevit`, доор).

function Get-LiveQueueOwner([string]$Path) {
    # `pid` талбарын процесс АМЬД бол тэр процессыг, үгүй бол $null буцаана.
    # $null (= эзэнгүй, тул устгаж болно) буцаах БҮХ тохиолдол:
    #   • файл уншигдахгүй / JSON эвдэрсэн / `pid` талбаргүй (хуучин формат)
    #   • тухайн процесс огт байхгүй
    #   • PID ДАХИН АШИГЛАГДСАН: powershell биш, өөр script, эсвэл queue
    #     бичигдсэнээс ХОЙШ эхэлсэн процесс
    #   • StartTime уншигдахгүй = ӨӨР Windows хэрэглэгчийн процесс.
    #     %APPDATA% нь хэрэглэгч тус бүрд ТУСДАА тул энэ queue-г заавал
    #     БИДНИЙ данс бичсэн байх ёстой → өөр дансных бол PID дахин
    #     ашиглагдсан гэсэн үг.
    $q = $null
    try { $q = Get-Content $Path -Raw -Encoding UTF8 | ConvertFrom-Json } catch { return $null }
    if ($null -eq $q -or -not $q.pid) { return $null }
    $ownerId = 0
    try { $ownerId = [int]$q.pid } catch { return $null }
    # $PID = ЭНЭ процесс.  Цэвэрлэгээ өөрийн queue-г бичихээс ӨМНӨ ажилладаг
    # тул энэ таарал нь зөвхөн PID дахин ашиглагдсан гэсэн утгатай.
    if ($ownerId -le 0 -or $ownerId -eq $PID) { return $null }

    $p = $null
    try { $p = Get-Process -Id $ownerId -ErrorAction Stop } catch { return $null }
    if ($p.ProcessName -notmatch '^(powershell|powershell_ise|pwsh)$') { return $null }

    # Командын мөр — байвал PID дахин ашиглалтын хамгийн хүчтэй ялгагч.
    # CIM хаалттай орчинд алдвал доорх StartTime шүүлт дээр найдна.
    try {
        $cmd = (Get-CimInstance Win32_Process -Filter "ProcessId = $ownerId" -ErrorAction Stop).CommandLine
        if ($cmd -and ($cmd -notlike '*batch-qto*')) { return $null }
    } catch { }

    # Эзэн процесс нь queue бичигдэхээс ӨМНӨ эхэлсэн байх ЁСТОЙ.
    try {
        if ($p.StartTime -gt (Get-Item $Path).LastWriteTime) { return $null }
    } catch { return $null }

    return $p
}

# ⚠️ Насны хязгаар — install-batch-task.ps1-ийн ExecutionTimeLimit (3 цаг)-тай
# ТААРУУЛСАН.  Тэрийг өөрчилвөл ЭНИЙГ мөн өөрчил.  Тохиргоо (timeout_minutes)
# нь энэ цэгт хараахан уншигдаагүй тул зориуд ТОГТМОЛ утга — цэвэрлэгээ нь
# config уншихаас ӨМНӨ ажиллах ёстой (дээрх тайлбарыг үз).
$LiveRevitMaxAgeMinutes = 180

function Get-LiveBatchRevit([string]$Path) {
    # Энэ дарааллыг боловсруулж яваа АМЬД Revit-ийг буцаана, үгүй бол $null.
    # $null буцаах БҮХ тохиолдол:
    #   • Revit огт ажиллахгүй;
    #   • Revit нь queue бичигдэхээс ӨМНӨ эхэлсэн — add-in queue-г ЗӨВХӨН
    #     эхлэхдээ уншдаг (BatchQto.cs:40) тул инженерийн энгийн session
    #     энэ файлын эзэн БАЙХ БОЛОМЖГҮЙ;
    #   • файл $LiveRevitMaxAgeMinutes-ээс хуучин — эс бөгөөс ажлын станц
    #     дээр Revit нээлттэй байх бүрд цэвэрлэгээ МӨНХӨД хаагдаж, батч
    #     дахин ХЭЗЭЭ Ч ажиллахгүй болно.
    # (File.Move нь timestamp-ыг хадгалдаг тул processing файлын
    #  LastWriteTime нь queue бичигдсэн мөчийг заасаар байна.)
    $info = $null
    try { $info = Get-Item $Path -ErrorAction Stop } catch { return $null }
    if (((Get-Date) - $info.LastWriteTime).TotalMinutes -gt $LiveRevitMaxAgeMinutes) { return $null }
    $procs = @()
    try { $procs = @(Get-Process -Name 'Revit' -ErrorAction SilentlyContinue) } catch { return $null }
    foreach ($rp in $procs) {
        # StartTime уншигдахгүй = өөр Windows хэрэглэгчийн процесс — %APPDATA%
        # хэрэглэгч тус бүрд тусдаа тул тэр нь бидний queue-ний эзэн биш.
        try {
            if ($rp.StartTime -ge $info.LastWriteTime) { return $rp }
        } catch { continue }
    }
    return $null
}

foreach ($stale in @($queuePath, $processingPath)) {
    if (-not (Test-Path $stale)) { continue }
    $owner = Get-LiveQueueOwner $stale
    if ($owner) {
        # Алгасах нь АЛДАА биш (дараагийн хуваарьт дахин оролдоно) тул exit 0 —
        # Task Scheduler-т улаан гаргах нь давхцлыг эвдрэл мэт харуулна.
        # Мөрдөх бол batch-log.txt-ээс «ЗОГСЛОО:» гэж хайна.
        Log ("ЗОГСЛОО: өөр batch ажиллагаа явж байна — {0} нь АМЬД pid {1} ({2})-ынх.  Энэ ажиллагааг алгаслаа." -f `
            (Split-Path $stale -Leaf), $owner.Id, $owner.ProcessName)
        exit 0
    }
    # PS эзэн үхсэн ч Revit нь push-аа үргэлжлүүлж байж БОЛНО (B-4).
    # ⚠️ ЗӨВХӨН $processingPath дээр.  Add-in нь дарааллыг ЭЗЭМШИХДЭЭ
    #    файлыг НЭРИЙГ НЬ СОЛЬДОГ (BatchQto.cs: File.Move(Queue -> Processing)),
    #    тиймээс batch-queue.json НЭРТЭЙ ХЭВЭЭР байгаа файлыг ямар ч Revit
    #    аваагүй гэсэн үг.  Түүн дээр «амьд Revit» шалгах нь инженерийн
    #    ЭНГИЙН нээлттэй Revit-ийг эзэн гэж андуурч, эзэнгүй дарааллыг
    #    МӨНХӨД цэвэрлүүлэхгүй болгоно — шөнийн батч чимээгүй зогсоно.
    $liveRevit = if ($stale -eq $processingPath) { Get-LiveBatchRevit $stale } else { $null }
    if ($liveRevit) {
        Log ("ЗОГСЛОО: {0}-г боловсруулж яваа Revit АМЬД байна (pid {1}, {2:HH:mm:ss}-д эхэлсэн) — PS эзэн нь алагдсан байж болзошгүй.  ДАВХАР push-аас сэргийлж энэ ажиллагааг алгаслаа." -f `
            (Split-Path $stale -Leaf), $liveRevit.Id, $liveRevit.StartTime)
        exit 0
    }
    $age = (Get-Date) - (Get-Item $stale).LastWriteTime
    Log ("Анхаар: эзэнгүй {0} олдлоо ({1:N0} мин) — устгалаа" -f (Split-Path $stale -Leaf), $age.TotalMinutes)
    Remove-Item $stale -Force
}

# ---- Тохиргоо унших --------------------------------------------------
if (-not (Test-Path $ConfigPath)) {
    Log "АЛДАА: тохиргооны файл алга: $ConfigPath (batch-config.template.json-оос хуулж бөглөнө үү)"
    exit 1
}
$config = Get-Content $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
$revitExe = if ($config.revit_exe) { $config.revit_exe } else { 'C:\Program Files\Autodesk\Revit 2027\Revit.exe' }
$timeoutMin = if ($config.timeout_minutes) { [int]$config.timeout_minutes } else { 90 }
if (-not (Test-Path $revitExe)) { Log "АЛДАА: Revit олдсонгүй: $revitExe"; exit 1 }
if (-not $config.files -or $config.files.Count -eq 0) { Log "АЛДАА: config-д files хоосон байна"; exit 1 }

# ---- Төлөв унших (PS 5.1: PSCustomObject → hashtable гараар) ---------
$state = @{}
if (Test-Path $statePath) {
    try {
        $raw = Get-Content $statePath -Raw -Encoding UTF8 | ConvertFrom-Json
        foreach ($p in $raw.PSObject.Properties) { $state[$p.Name] = $p.Value }
    } catch { Log "Анхаар: batch-state.json уншигдсангүй — бүгдийг шинээр push хийнэ" }
}

# ---- Өөрчлөгдсөн файлуудыг олох --------------------------------------
$work = @()   # @{ path; project_id; mtime }
foreach ($f in $config.files) {
    if (-not (Test-Path $f.path)) { Log "Анхаар: файл олдсонгүй, алгаслаа: $($f.path)"; continue }
    $mtime = (Get-Item $f.path).LastWriteTimeUtc.ToString('o')
    $prev = $state[$f.path]
    if ($Force -or -not $prev -or $prev.mtime_utc -ne $mtime) {
        $work += @{ path = $f.path; project_id = [int]$f.project_id; mtime = $mtime }
    }
}

if ($work.Count -eq 0) {
    Log "Өөрчлөлт алга — Revit асаахгүй. ($($config.files.Count) файл шалгав)"
    exit 0
}
Log "Өөрчлөгдсөн $($work.Count) файл: $(($work | ForEach-Object { Split-Path $_.path -Leaf }) -join ', ')"

# ---- Queue бичээд Revit асаах ----------------------------------------
if (Test-Path $resultPath) { Remove-Item $resultPath -Force }

# nonce / pid / created_at нь энэ дараалал ХЭНИЙХ, ХЭЗЭЭ бичигдсэнийг тэмдэглэнэ.
#
# ⚠️ ДАРААЛЛЫН ХАТУУ ДҮРЭМ — урвуулбал шөнийн QTO батч ЧИМЭЭГҮЙ зогсоно:
#   Одоо (энэ хувилбар) : PS нь НЭМЭЛТ талбар бичнэ.  Талбар дээрх add-in
#                         тэдгээрийг ҮЛ ТООМСОРЛОНО — BatchQto.cs:68 нь
#                         JsonSerializerOptions дамжуулдаггүй тул
#                         System.Text.Json-ий анхдагч зан төлөв нь
#                         тодорхойлогдоогүй гишүүнийг үл тоомсорлох.
#   1C релиз N          : Add-in ТЭВЧИНЭ — nonce/pid/created_at БАЙВАЛ
#                         хүндэтгэнэ (хуучирсан/эзэнгүй queue-г устгаад
#                         энгийн session хэвээр үлдэнэ), БАЙХГҮЙ бол
#                         хуучин ёсоор ажиллана.
#   1C релиз N+1        : Add-in ШААРДАНА — nonce-гүй queue-г алгасаад устгана.
#
# PS тал (энэ script) НЬ ЭДГЭЭРИЙГ АЛЬ ХЭДИЙН ХЭРЭГЛЭДЭГ — ЧИМЭГЛЭЛ БИШ:
#   nonce      → үр дүн уншихад `results[].nonce`-той тулгана (аудит A2, доор).
#   pid        → ДАРААГИЙН ажиллагаа хуучирсан queue-ний эзнийг амьд эсэхийг
#                шалгана (`Get-LiveQueueOwner`, дээр).
#   created_at → одоохондоо ЗӨВХӨН оношилгооны тэмдэглэл, уншигч алга
#                (амьд эсэхийг файлын LastWriteTime-аар шалгадаг).
#
# `files` бүтцийг ӨӨРЧЛӨХГҮЙ — BatchFile DTO (BatchQto.cs:237-244) яг
# `path` + `project_id` хоёрыг л хүлээдэг.
$nonce = [guid]::NewGuid().ToString('N')
$queue = @{
    exit       = $true
    nonce      = $nonce                                      # add-in релиз N+1-д ЗААВАЛ
    pid        = $PID                                        # энэ script-ийн процессын дугаар
    created_at = (Get-Date).ToUniversalTime().ToString('o')  # TTL шалгах суурь (UTC, ISO-8601)
    files      = @($work | ForEach-Object { @{ path = $_.path; project_id = $_.project_id } })
}
$queue | ConvertTo-Json -Depth 5 | Out-File $queuePath -Encoding utf8
Log "Revit асааж байна ($revitExe, timeout ${timeoutMin}мин, nonce $nonce, pid $PID)..."

# try/finally — Ctrl+C ба terminating error дээр өөрийн queue-г баталгаатай
# устгана.  ХАТУУ Kill (Task Scheduler task-ыг зогсоох, reboot) дээр ЭНЭ
# АЖИЛЛАХГҮЙ — тиймээс дээрх «Хуучирсан queue цэвэрлэх» блок хэвээр зайлшгүй.
$exitCode = 0
try {
    $proc = Start-Process -FilePath $revitExe -PassThru
    $exited = $proc.WaitForExit($timeoutMin * 60 * 1000)
    if (-not $exited) {
        Log "TIMEOUT: Revit ${timeoutMin} минутад дуусаагүй — process-ийг хаалаа"
        try { $proc.Kill() } catch {}
    }

    # Queue үлдсэн бол add-in огт эхлээгүй гэсэн үг (лиценз попап г.м.)
    if (Test-Path $queuePath) {
        Log "АЛДАА: add-in batch-г огт эхлүүлээгүй (queue хэвээр) — Revit дээр попап гарсан эсэхийг шалгана уу"
        $exitCode = 1
    }
    # ---- Үр дүн боловсруулах ---------------------------------------------
    elseif (-not (Test-Path $resultPath)) {
        Log "АЛДАА: batch-result.json олдсонгүй — add-in дуусаагүй бололтой"
        $exitCode = 1
    }
    else {
        $result = Get-Content $resultPath -Raw -Encoding UTF8 | ConvertFrom-Json

        # ---- nonce баталгаажуулалт (аудит A2) --------------------------------
        # Add-in нь queue-ийн nonce-ыг үр дүн БҮРД цуурайтуулна
        # (BatchQto.cs:80 `one.Nonce = nonce` → `results[].nonce`).  Тиймээс
        # энд док-ийн ДЭЭД түвшний биш, `results[]`-ийн талбарыг шалгана —
        # BatchResultDoc-д nonce талбар БАЙХГҮЙ.
        #
        # ⚠️ ХАТУУ ДАРААЛАЛ (урвуулбал шөнийн батч ЧИМЭЭГҮЙ зогсоно):
        #   Одоо (энэ хувилбар): nonce БАЙХГҮЙ = зөвхөн АНХААРУУЛГА.  Талбар
        #     дээр nonce цуурайтуулдаггүй ХУУЧИН add-in байсаар байгаа (~20 ПК,
        #     албадан шинэчлэх механизмгүй, Install.bat гараар) тул шаардвал
        #     тэр бүх машины батч өнөө шөнөөс зогсох ба хэн ч мэдэхгүй.
        #   Дараагийн шат: БҮХ ПК шинэчлэгдсэнийг БАТАЛСНЫ ДАРАА л nonce
        #     байхгүйг мөн АЛДАА болгоно.
        #   Харин ТААРАХГҮЙ нь ОДООНООС АЛДАА — тэр нь хуучин хувилбарын шинж
        #   БИШ, ӨӨР ажиллагааны (эсвэл гараар үлдсэн хуучин) batch-result.json.
        #
        # Таарахгүй бол үр дүнг БҮХЭЛД НЬ голно: өөр ажиллагааны үр дүнгээр
        # state шинэчилбэл push хийгдээгүй файлууд «илгээгдсэн» гэж
        # тэмдэглэгдэж, тэр өөрчлөлт ХЭЗЭЭ Ч дахин илгээгдэхгүй (mtime
        # харьцуулалт үүрд алгасна).
        $seenNonces = @($result.results | ForEach-Object { $_.nonce } | Where-Object { $_ })
        $badNonces  = @($seenNonces | Where-Object { $_ -ne $nonce })
        $acceptResult = $true
        if ($badNonces.Count -gt 0) {
            Log ("АЛДАА: nonce таарсангүй — хүлээсэн '{0}', ирсэн '{1}'.  batch-result.json нь ӨӨР ажиллагааных — үр дүнг голж, batch-state.json-г ШИНЭЧЛЭХГҮЙ." -f `
                $nonce, (($badNonces | Select-Object -Unique) -join ', '))
            $acceptResult = $false
            $exitCode = 1
        }
        elseif ($seenNonces.Count -eq 0) {
            Log "Анхаар: batch-result.json-д nonce алга — add-in-ийн ХУУЧИН хувилбар байна (одоохондоо зөвшөөрөв).  Add-in-ээ шинэчилнэ үү — дараагийн шатанд энэ нь АЛДАА болно."
        }

        if ($acceptResult) {
            $failCount = 0
            foreach ($r in $result.results) {
                if ($r.ok) {
                    $entry = $work | Where-Object { $_.path -eq $r.path } | Select-Object -First 1
                    if ($entry) {
                        $state[$r.path] = @{
                            mtime_utc = $entry.mtime
                            run_id    = $r.run_id
                            pushed_at = (Get-Date).ToUniversalTime().ToString('o')
                        }
                    }
                    Log ("OK  {0} → run #{1}: {2} мөр (ангилсан {3}, ангилаагүй {4}), {5}с" -f `
                        (Split-Path $r.path -Leaf), $r.run_id, $r.facts, $r.mapped, $r.unmapped, $r.duration_sec)
                } else {
                    $failCount++
                    Log ("FAIL {0}: {1}" -f (Split-Path $r.path -Leaf), $r.error)
                }
            }

            # ---- Төлөв хадгалах ---------------------------------------------------
            $stateObj = New-Object PSObject
            foreach ($k in $state.Keys) { $stateObj | Add-Member -NotePropertyName $k -NotePropertyValue $state[$k] }
            $stateObj | ConvertTo-Json -Depth 5 | Out-File $statePath -Encoding utf8

            Log "Дууслаа: $($result.results.Count - $failCount) амжилттай, $failCount алдаатай"
            if ($failCount -gt 0) { $exitCode = 1 }
        }
    }
}
finally {
    # Өөрийнхөө бичсэн queue-г ХЭЗЭЭ Ч диск дээр үлдээхгүй.
    if (Test-Path $queuePath) {
        Remove-Item $queuePath -Force -ErrorAction SilentlyContinue
    }

    # ---- B-5: processing үлдэгдэл ------------------------------------
    # Add-in нь ажлаа дуусгаад ProcessingPath-ыг өөрөө устгадаг
    # (BatchQto.cs:97).  ГЭХДЭЭ Revit timeout-оор алагдвал, эсвэл лиценз
    # попап/сүйрлээр дундаас нь унавал тэр файл диск дээр ҮЛДЭНЭ.  Тэр
    # үлдэгдэл нь дараагийн ажиллагааны цэвэрлэгээнд «эзэнгүй … устгалаа»
    # гэсэн ХУДАЛ анхааруулга бичүүлж, шинжилгээг төөрөгдүүлдэг.
    #
    # ⚠️ ЗӨВХӨН ӨӨРИЙНХӨӨ ҮЛДЭГДЛИЙГ устгана, ХОЁР нөхцөлтэйгээр:
    #   • Revit ЗОГССОН байх ($proc.HasExited) — эс бөгөөс (жишээ нь Ctrl+C
    #     дээр Revit цааш ажилласаар байхад) явж буй session-ий дахин
    #     ачаалалтын хамгаалалтыг татан буулгана;
    #   • файлын `nonce` нь БИДНИЙХ байх — processing нь бидний queue-ний
    #     ЯГ ТЭР файл (File.Move) тул nonce нь үргэлж таарах ёстой.  Өөр
    #     ажиллагааных бол ХӨДӨЛГӨХГҮЙ.
    if ((Test-Path $processingPath) -and $proc -and $proc.HasExited) {
        try {
            $leftover = Get-Content $processingPath -Raw -Encoding UTF8 | ConvertFrom-Json
            if ($leftover -and $leftover.nonce -eq $nonce) {
                Remove-Item $processingPath -Force -ErrorAction SilentlyContinue
                Log "Цэвэрлэв: add-in дуусгаагүй processing файлыг устгалаа (nonce $nonce)"
            }
        } catch { }
    }
}
exit $exitCode
