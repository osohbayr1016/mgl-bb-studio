<#
  MGL AI — ЛОКАЛ ҮЙЛЧИЛГЭЭГ ЭХЛҮҮЛЭХ / ХЯНАХ.

  npm run ai:start          — эхлүүлнэ (автомат эхлүүлэлт бүртгэлтэй бол
                              тэр даалгаврыг асаана; аль хэдийн ажиллаж
                              байвал юу ч хийхгүй)
  npm run ai:stop           — ТҮР зогсооно: даалгавар идэвхтэй хэвээр, харин
                              `runtime.paused` тэмдэг супервайзерийг асаахгүй.
                              Дараагийн Windows нэвтрэлтэд, 12 цагийн дараа
                              эсвэл `ai:start`-аар өөрөө сэргэнэ
  npm run ai:restart        — зөвхөн node процессыг солино; супервайзер
                              5 секундэд ШИНЭ кодоор дахин асаана
                              (git pull-ийн дараах зам)
  npm run ai:status
  npm run ai:autostart      — нэвтрэх бүрд + унавал автоматаар асна
  npm run ai:start -- -Uninstall

  ⚠️ ЯАГААД ЭНЭ СКРИПТ ОРШИН БАЙНА.  `npm run ai:dev` нь терминал хаагдмагц
     үхдэг.  2026-09-08-нд яг тэр болсон: загвар, бинар хоёулаа дискэн дээр
     байсан ч ЮУ Ч АЖИЛЛАХГҮЙ байсан бөгөөд хэрэглэгчид «локал MGL AI
     ажиллахгүй байна» гэж харагдсан.  Ажилтан бүр терминал нээж суухгүй.

  ⚠️ ЯАГААД СУПЕРВАЙЗЕР (2026-09-11).  Өмнөх хувилбар нь нэвтрэхэд node-ыг
     НЭГ УДАА асаагаад мартдаг байв: node унавал (GPU драйверийн reset,
     unhandled rejection, хэрэглэгч Task Manager-аас хаасан) дараагийн
     нэвтрэлт хүртэл ЮУ Ч сэргээхгүй, хэрэглэгч өдөр бүр терминалаас
     `ai:start` ажиллуулдаг байсан.  Одоо Task Scheduler-ийн даалгавар нь
     `-Supervise` мөчлөг: node-ыг асаана, гарахыг нь ХҮЛЭЭНЭ, унавал
     5 с → 60 с хүртэл ухарч дахин асаана.  Гурван давхар хамгаалалт:
       1. супервайзерийн мөчлөг      — node унахад
       2. даалгаврын RestartCount   — супервайзер өөрөө унахад
       3. 10 минут тутмын хяналтын   — даалгавар огт ажиллахгүй байхад
          триггер (IgnoreNew тул ажиллаж байвал ЮУ Ч хийхгүй)

  ⚠️ ЭНЭ НЬ ЗАГВАР ТАТДАГГҮЙ, АЧААЛДАГГҮЙ.  Зөвхөн ХӨНГӨН node процессыг
     амьд байлгана.  Загвар нь хуудас нээгдэхэд (`/warmup`) VRAM руу орно,
     20 мин сул байвал буцаж гарна — сул зогсолтын VRAM зардлын шийдвэр
     ХЭВЭЭР.  Татах нь `npm run ai:model -- pull` эсвэл админы релиз.
#>
param(
  [switch]$Stop,
  [switch]$Restart,
  [switch]$Status,
  [switch]$Install,
  [switch]$Uninstall,
  [switch]$Foreground,
  [switch]$Supervise,
  # Супервайзерт node-ын АБСОЛЮТ зам — Task Scheduler-ийн орчинд PATH нь
  # терминалынхаас өөр (nvm, fnm, сессийн PATH) байж болох тул бүртгэх
  # үедээ олж, даалгаврын аргументад хатуу бичнэ.
  [string]$NodeExe = ''
)

$ErrorActionPreference = 'Stop'
$AiDir   = Split-Path -Parent $PSScriptRoot
$Entry   = Join-Path $AiDir 'runtime\src\server.ts'
$DataDir = if ($env:MGLAI_DATA_DIR) { $env:MGLAI_DATA_DIR } else { Join-Path $env:LOCALAPPDATA 'MglAi' }
$LogFile = Join-Path $DataDir 'runtime.log'
$SupLog  = Join-Path $DataDir 'supervisor.log'
$PidFile = Join-Path $DataDir 'runtime.pid'
$Port    = if ($env:MGLAI_PORT) { [int]$env:MGLAI_PORT } else { 39217 }
$TaskName = 'MGL AI runtime'
# Хяналтын триггерийн давтамж — даалгавар ямар нэг шалтгаанаар ажиллахгүй
# байвал хамгийн ихдээ ИЙМ хугацааны дараа буцаж асна.
$WatchdogMinutes = 10
# ⚠️ ai:stop = ТҮР ЗОГСОЛТ, Disable БИШ (2026-10-13).  Өмнө нь `-Stop` даалгаврыг
#    Disable хийдэг байсан бөгөөд үүнийг юу ч буцааж асаадаггүй: 2026-09-28-нд
#    сургалтад GPU чөлөөлөхөөр `ai:stop` хийсний дараа runtime 15 хоног огт
#    асаагүй, вэб «MGL AI локал үйлчилгээ ажиллахгүй байна» гэж харуулсаар байв
#    (Task Scheduler: Disabled, LastTaskResult 0x41306).  Одоо даалгавар ИДЭВХТЭЙ
#    хэвээр (нэвтрэлт + 10 мин хяналт), оронд нь энэ тэмдэг — супервайзер түүнийг
#    харвал node асаахгүй гарна.  Тэмдэг дараагийн Windows нэвтрэлтэд, эсвэл
#    $PauseMaxHours цагийн дараа хүчингүй болно; `ai:start` шууд арилгана.
#    Сургалт загвар ачаалахыг `training.lock`-оор аль хэдийн хаадаг тул runtime
#    эрт сэргэсэн ч GPU-г булаахгүй (training/gpu_guard.py).
$PauseFile = Join-Path $DataDir 'runtime.paused'
$PauseMaxHours = 12

function Test-Alive {
  try {
    # ⚠️ /health нь нэвтрэлтгүй, зөвхөн «амьд эсэх» — нууц шаардахгүй.
    $r = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/health" -TimeoutSec 3 -UseBasicParsing
    return $r.StatusCode -eq 200
  } catch { return $false }
}

function Get-RuntimePid {
  if (-not (Test-Path $PidFile)) { return $null }
  $id = (Get-Content $PidFile -Raw).Trim()
  if (-not $id) { return $null }
  try {
    $p = Get-Process -Id ([int]$id) -ErrorAction Stop
    # ⚠️ PID дахин ашиглагддаг — процесс нь node мөн эсэхийг шалгана.
    if ($p.ProcessName -notmatch 'node') { return $null }
    return $p
  } catch { return $null }
}

function Get-Task {
  return Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
}

function Get-NodeExe {
  if ($NodeExe -and (Test-Path $NodeExe)) { return $NodeExe }
  # ⚠️ `node` нь PATH дээр байх ёстой.  Байхгүй бол ойлгомжтой алдаа өгнө —
  #    «файл олдсонгүй» гэсэн Windows-ийн алдаа нь оношлоход хэцүү.
  $node = (Get-Command node -ErrorAction SilentlyContinue).Source
  if (-not $node) {
    throw "node.exe олдсонгүй.  Node.js суулгасан эсэхээ шалгана уу."
  }
  return $node
}

function Get-SessionStart {
  # Энэ Windows нэвтрэлт эхэлсэн цаг ≈ тухайн сессийн explorer.exe эхэлсэн цаг.
  # LastBootUpTime биш: Fast Startup-ийн «унтраах → асаах» нь kernel-ийг
  # ачаалдаггүй тул boot цаг хуучин хэвээр, харин нэвтрэлт ШИНЭ.
  try {
    $sid = (Get-Process -Id $PID).SessionId
    $e = Get-Process explorer -ErrorAction Stop | Where-Object { $_.SessionId -eq $sid } |
         Sort-Object StartTime | Select-Object -First 1
    if ($e) { return [DateTimeOffset]$e.StartTime }
  } catch {}
  return $null
}

function Get-Pause {
  # Хүчинтэй түр зогсолтын эхэлсэн цаг; хүчингүй (хуучирсан, шинэ нэвтрэлт,
  # уншигдахгүй) бол тэмдгийг устгаад $null.
  if (-not (Test-Path $PauseFile)) { return $null }
  $since = $null
  try {
    $since = [DateTimeOffset]::Parse((Get-Content $PauseFile -Raw).Trim(),
      [Globalization.CultureInfo]::InvariantCulture)
  } catch {}
  $expired = $true
  if ($since) {
    $age = [DateTimeOffset]::Now - $since
    $sess = Get-SessionStart
    $newLogon = $null -ne $sess -and $sess -gt $since
    $expired = $age.TotalHours -ge $PauseMaxHours -or $age.TotalMinutes -lt -5 -or $newLogon
  }
  if ($expired) {
    Remove-Item $PauseFile -ErrorAction SilentlyContinue
    return $null
  }
  return $since
}

function Write-SupLog([string]$Msg) {
  $line = "{0} {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Msg
  Add-Content -Path $SupLog -Value $line -Encoding utf8
}

function Stop-Orphans {
  # ⚠️ llama-server нь runtime-ийн ХҮҮХЭД боловч эцэг нь хүчээр
  #    зогсоход өнчрөх боломжтой — VRAM суллахын тулд шалгана.
  Get-Process llama-server -ErrorAction SilentlyContinue | ForEach-Object {
    Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
    Write-Output "  Өнчирсөн llama-server зогслоо (pid $($_.Id))."
  }
}

# ── Төлөв ────────────────────────────────────────────────────────────
if ($Status) {
  $alive = Test-Alive
  $proc  = Get-RuntimePid
  $task  = Get-Task
  Write-Output ""
  Write-Output "  MGL AI runtime"
  Write-Output "    порт $Port : $(if ($alive) { 'АЖИЛЛАЖ БАЙНА' } else { 'хаалттай' })"
  Write-Output "    процесс   : $(if ($proc) { 'pid ' + $proc.Id } else { 'алга' })"
  Write-Output "    лог       : $LogFile"
  $models = Join-Path $DataDir 'models'
  if (Test-Path $models) {
    $g = Get-ChildItem $models -Filter *.gguf -ErrorAction SilentlyContinue |
         Sort-Object Length -Descending | Select-Object -First 1
    Write-Output "    загвар    : $(if ($g) { '{0} ({1:N2} GB)' -f $g.Name, ($g.Length / 1GB) } else { 'АЛГА — татах шаардлагатай' })"
  } else {
    Write-Output "    загвар    : хавтас алга"
  }
  $bin = Join-Path $DataDir 'bin\llama-server.exe'
  Write-Output "    бинар     : $(if (Test-Path $bin) { 'байна' } else { 'АЛГА' })"
  $pause = Get-Pause
  if ($pause) {
    Write-Output "    түр зогсолт: $($pause.LocalDateTime) -аас (ai:stop) — ai:start, дараагийн нэвтрэлт эсвэл $PauseMaxHours цагийн дараа сэргэнэ"
  }
  if ($task) {
    $info = Get-ScheduledTaskInfo -TaskName $TaskName -ErrorAction SilentlyContinue
    $st = "$($task.State)"
    if ($task.State -eq 'Disabled') { $st = 'УНТРААЛТТАЙ (ai:start асаана)' }
    Write-Output "    автомат   : нэвтрэх бүрд + унавал асна — даалгавар $st"
    if ($info) { Write-Output "    сүүлд     : $($info.LastRunTime) (код $($info.LastTaskResult))" }
  } else {
    Write-Output "    автомат   : тохируулаагүй — «npm run ai:autostart»"
  }
  Write-Output ""
  exit 0
}

# ── Зогсоох ──────────────────────────────────────────────────────────
if ($Stop) {
  # ⚠️ Эхлээд ТЭМДЭГ, дараа нь даалгавар/процесс — эсрэг дараалалд супервайзер
  #    node-ыг 5 секундэд буцааж асаана.  Даалгаврыг Disable ХИЙХГҮЙ (дээрх
  #    $PauseFile-ийн тайлбар): нэвтрэлт + хяналтын триггер амьд үлдэнэ.
  New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
  Set-Content -Path $PauseFile -Value ([DateTimeOffset]::Now.ToString('o')) -Encoding utf8
  $task = Get-Task
  if ($task) {
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    Write-Output "  Автомат эхлүүлэлт ТҮР зогслоо — «npm run ai:start», дараагийн Windows нэвтрэлт эсвэл $PauseMaxHours цагийн дараа өөрөө сэргэнэ."
  }
  $proc = Get-RuntimePid
  if ($proc) {
    Stop-Process -Id $proc.Id -Force
    Write-Output "  Зогслоо (pid $($proc.Id))."
  } else {
    Write-Output "  Ажиллаж байгаа процесс олдсонгүй."
  }
  Stop-Orphans
  Remove-Item $PidFile -ErrorAction SilentlyContinue
  exit 0
}

# ── Дахин эхлүүлэх (шинэ код) ────────────────────────────────────────
if ($Restart) {
  $task = Get-Task
  $proc = Get-RuntimePid
  if ($task -and $task.State -eq 'Running' -and $proc) {
    Stop-Process -Id $proc.Id -Force
    Stop-Orphans
    Write-Output "  Node процесс зогслоо (pid $($proc.Id)); супервайзер дахин асаана…"
    $ready = $false
    foreach ($i in 1..60) {
      Start-Sleep -Milliseconds 500
      if (Test-Alive) { $ready = $true; break }
    }
    if ($ready) { Write-Output "  MGL AI шинэ кодоор ажиллаж байна (порт $Port)." ; exit 0 }
    Write-Error "  Дахин асаж чадсангүй.  Лог: $LogFile"
    exit 1
  }
  # Супервайзергүй бол энгийн stop + start.
  & $PSCommandPath -Stop | Out-Null
  & $PSCommandPath
  exit $LASTEXITCODE
}

# ── Автомат эхлүүлэлт ────────────────────────────────────────────────
if ($Uninstall) {
  if (Get-Task) {
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Output "  Автомат эхлүүлэлт УСТЛАА."
  } else { Write-Output "  Автомат эхлүүлэлт тохируулаагүй байна." }
  Remove-Item $PauseFile -ErrorAction SilentlyContinue
  exit 0
}

if ($Install) {
  $nodeAbs = Get-NodeExe
  # ⚠️ ХЭРЭГЛЭГЧИЙН эрхээр, админ ЭРХГҮЙГЭЭР бүртгэнэ — ажилтан админ
  #    эрхгүй байж болно (config.ts-ийн ижил үндэслэл).
  $act = New-ScheduledTaskAction -Execute 'powershell.exe' `
    -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$PSCommandPath`" -Supervise -NodeExe `"$nodeAbs`""
  $atLogon = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
  # Хяналтын триггер: минут тутам биш, $WatchdogMinutes тутам — ажиллаж
  # байвал IgnoreNew тул ЮУ Ч хийхгүй, зөвхөн унтарсан үед сэргээнэ.
  $watchdog = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) `
    -RepetitionInterval (New-TimeSpan -Minutes $WatchdogMinutes)
  $set = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries -StartWhenAvailable `
    -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -MultipleInstances IgnoreNew `
    -RestartCount 10 -RestartInterval (New-TimeSpan -Minutes 1)
  Register-ScheduledTask -TaskName $TaskName -Action $act -Trigger @($atLogon, $watchdog) `
    -Settings $set -Description 'MGL AI локал инференс (супервайзер)' -Force | Out-Null
  Write-Output "  Автомат эхлүүлэлт бүртгэгдлээ — нэвтрэх бүрд асна, унавал өөрөө сэргэнэ."
  # Бүртгээд ШУУД эхлүүлнэ, дараагийн нэвтрэлтийг хүлээхгүй (доорх «Эхлүүлэх»).
}

# ── Супервайзерийн мөчлөг (Task Scheduler-ээс дуудагдана) ────────────
if ($Supervise) {
  New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
  # ai:stop-оор түр зогсоосон — юу ч асаахгүй, чимээгүй гарна (хяналтын
  # триггер 10 мин тутам ирдэг тул энд лог бичвэл зөвхөн чимээ болно).
  if (Get-Pause) { exit 0 }
  $node = Get-NodeExe
  $backoffSec = 5
  Write-SupLog "супервайзер эхэллээ (pid $PID, node $node)"
  while ($true) {
    if (Test-Alive) {
      # Өөр хэн нэгэн (жишээ нь `ai:dev` терминал) аль хэдийн порт дээр
      # байна — давхар асаахгүй, зүгээр хүлээнэ.
      Start-Sleep -Seconds 30
      continue
    }
    # ai:stop нь супервайзерийг Stop-ScheduledTask-аар зогсоож чадаагүй ч
    # node-ыг буцааж асаахгүй.
    if (Get-Pause) {
      Write-SupLog "ai:stop-оор түр зогсоосон — супервайзер гарлаа"
      exit 0
    }
    # Логийг эргүүлнэ — унах бүрд хуучин лог `.1` болж, оношлох боломж үлдэнэ.
    foreach ($f in @($LogFile, "$LogFile.err")) {
      if (Test-Path $f) { Move-Item $f "$f.1" -Force -ErrorAction SilentlyContinue }
    }
    $started = Get-Date
    $p = Start-Process -FilePath $node -ArgumentList "`"$Entry`"" `
      -WindowStyle Hidden -PassThru `
      -RedirectStandardOutput $LogFile -RedirectStandardError "$LogFile.err"
    Set-Content -Path $PidFile -Value $p.Id -Encoding utf8
    Write-SupLog "node асаалаа (pid $($p.Id))"
    $p.WaitForExit()
    $upSec = [int]((Get-Date) - $started).TotalSeconds
    $code = if ($null -eq $p.ExitCode) { 'хүчээр зогсоосон' } else { $p.ExitCode }
    Write-SupLog "node гарлаа (код $code, $upSec с ажилласан)"
    Remove-Item $PidFile -ErrorAction SilentlyContinue
    Get-Process llama-server -ErrorAction SilentlyContinue |
      Stop-Process -Force -ErrorAction SilentlyContinue
    # Ухралт: 1 минутаас урт ажилласан бол ЭРҮҮЛ унасан гэж үзээд 5 с-ээс
    # эхэлнэ; шууд унаж байвал 60 с хүртэл хоёр дахин уртасгана — эвдэрсэн
    # тохиргоог секунд тутам дахин асааж CPU идэхгүй.
    if ($upSec -ge 60) { $backoffSec = 5 } else { $backoffSec = [Math]::Min(60, $backoffSec * 2) }
    Start-Sleep -Seconds $backoffSec
  }
}

# ── Эхлүүлэх ─────────────────────────────────────────────────────────
# Хүн өөрөө асааж байна — ai:stop-ийн түр зогсолт дуусна.
Remove-Item $PauseFile -ErrorAction SilentlyContinue
if (Test-Alive) {
  Write-Output "  MGL AI аль хэдийн ажиллаж байна (порт $Port)."
  exit 0
}

New-Item -ItemType Directory -Force -Path $DataDir | Out-Null

if ($Foreground) {
  & node $Entry
  exit $LASTEXITCODE
}

$task = Get-Task
if ($task) {
  # Даалгавар бүртгэлтэй бол ТҮҮГЭЭР асаана — процесс супервайзерийн
  # хүүхэд болж, унавал сэргэнэ.  Энд шууд node асаавал хяналтгүй үлдэнэ.
  Enable-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue | Out-Null
  Start-ScheduledTask -TaskName $TaskName
  $ready = $false
  foreach ($i in 1..60) {
    Start-Sleep -Milliseconds 500
    if (Test-Alive) { $ready = $true; break }
  }
  if ($ready) {
    $proc = Get-RuntimePid
    Write-Output "  MGL AI ажиллаж эхэллээ — http://127.0.0.1:$Port$(if ($proc) { '  (pid ' + $proc.Id + ')' })"
    Write-Output "  Унавал өөрөө сэргэнэ; нэвтрэх бүрд автоматаар асна."
    Write-Output "  Лог: $LogFile"
    exit 0
  }
  Write-Error "  Даалгавраар эхлүүлж чадсангүй.  Лог: $SupLog / $LogFile"
  if (Test-Path "$LogFile.err") { Get-Content "$LogFile.err" -Tail 20 }
  exit 1
}

# Даалгаваргүй (хуучин зам): хяналтгүй нэг удаа асаана.
$node = Get-NodeExe
$p = Start-Process -FilePath $node -ArgumentList "`"$Entry`"" `
  -WindowStyle Hidden -PassThru `
  -RedirectStandardOutput $LogFile -RedirectStandardError "$LogFile.err"
Set-Content -Path $PidFile -Value $p.Id -Encoding utf8

# Бэлэн болтол хүлээнэ — «эхлүүллээ» гэж хэлээд ажиллаагүй байх нь
# хамгийн төөрөгдүүлэх хариу.
$ready = $false
foreach ($i in 1..40) {
  Start-Sleep -Milliseconds 500
  if (Test-Alive) { $ready = $true; break }
  if ($p.HasExited) { break }
}

if ($ready) {
  Write-Output "  MGL AI ажиллаж эхэллээ — http://127.0.0.1:$Port  (pid $($p.Id))"
  Write-Output "  ⚠️ Хяналтгүй горим: унавал сэргэхгүй.  «npm run ai:autostart» ажиллуулбал"
  Write-Output "     нэвтрэх бүрд асаж, унавал өөрөө сэргэнэ."
  Write-Output "  Лог: $LogFile"
} else {
  Write-Error "  Эхлүүлж чадсангүй.  Лог: $LogFile"
  if (Test-Path "$LogFile.err") { Get-Content "$LogFile.err" -Tail 20 }
  exit 1
}
