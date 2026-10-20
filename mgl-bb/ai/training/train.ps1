<#
  MGL AI — ОЛОН ЦАГИЙН СУРГАЛТЫГ АРААР АЖИЛЛУУЛАХ (§29).

  npm run ai:train:bg -- -RunName mgl-adapter-0.3 -TrainArgs "--epochs 3 --save-steps 10 --seq-buckets 1536,1792"
  npm run ai:train:status                     # бүх run / -RunName <нэр>
  npm run ai:train:stop -- -RunName <нэр>     # ЭМХ ЦЭГЦТЭЙ (checkpoint хадгалаад зогсоно)
  npm run ai:train:resume -- -RunName <нэр>   # сүүлийн checkpoint-оос
  npm run ai:train:log -- -RunName <нэр>      # сүүлийн 40 мөр

  ⚠️ ЯАГААД ЭНЭ СКРИПТ.  `python train_lora.py` нь терминал хаагдмагц үхнэ; Claude/VS Code-ийн
     сесс дуусахад ч үхнэ (0.1 smoke яг тэгж 2-р epoch-ийн дундаас тасарсан).  Энд процесс
     `Start-Process`-оор ТУСДАА, цонхгүй эхэлж, stdout/stderr нь `runs/<нэр>.log`-т, PID нь
     `runs/<нэр>.pid`-д.  Компьютер унтарвал л зогсоно — тэгвэл `-Resume`.

  ⚠️ ТӨЛӨВ НЬ `models/adapters/<нэр>/state.json`-оос (train_lora.py алхам бүрд бичдэг) —
     процессын гаралтыг задлахгүй.  ETA нь хэмжсэн сүүлийн 10 алхмын дунджаас.

  ⚠️ ЗОГСООХ НЬ KILL БИШ.  `-Stop` нь run_dir/STOP файл үүсгэнэ; train_lora.py дараагийн
     алхмын төгсгөлд checkpoint хадгалаад өөрөө гарна (~1 алхам = 30–60 с хүлээнэ).
     `-Stop -Force` нь л process kill — сүүлийн checkpoint-оос хойшхи алхмууд алдагдана.

  ⚠️ ҮЙЛДВЭРЛЭЛИЙН ИНФЕРЕНС ажиллаж байвал train_lora.py өөрөө ЗОГСОНО (gpu_guard.py) —
     энэ скрипт `npm run ai:stop` хийхгүй; тэр ХҮНИЙ шийдвэр (§2).
#>
param(
  [string]$RunName = '',
  [string]$TrainArgs = '',
  [switch]$Status,
  [switch]$Stop,
  [switch]$Force,
  [switch]$Resume,
  [switch]$Log,
  [int]$Tail = 40,
  # ⚠️ 2026-09-28: `npm run ai:train:bg -- -RunName X -TrainArgs "--epochs 2 --lr 1e-4"` дээр npm (Windows) хашилтыг
  #    задалж `-TrainArgs`-д зөвхөн «--epochs» очоод, «2 --lr 1e-4» нь зайгүй үлддэг байв — 0.5 яг ингэж
  #    «argument --epochs: expected one argument» гэж унасан (2026-09-21).  Үлдсэн токенуудыг ДАРААЛЛААР нь нэмнэ.
  [Parameter(ValueFromRemainingArguments = $true)][string[]]$Rest = @()
)

$ErrorActionPreference = 'Stop'
$AiDir    = Split-Path -Parent $PSScriptRoot
$Python   = Join-Path $AiDir 'training\.venv\Scripts\python.exe'
$Script   = Join-Path $AiDir 'training\train_lora.py'
$RunsDir  = Join-Path $AiDir 'training\runs'
$Adapters = Join-Path $AiDir 'models\adapters'
New-Item -ItemType Directory -Force $RunsDir | Out-Null

function Get-RunProc([string]$name) {
  # ⚠️ venv-ийн python.exe нь ДАМЖУУЛАГЧ — Start-Process-ийн pid нь жинхэнэ сургагч биш.  train_lora.py
  #    state.json-д ӨӨРИЙН pid-ээ бичдэг; тэр нь эхний сонголт, .pid файл нь ачаалалтын үеийн нөөц.
  $candidates = @()
  $stateFile = Join-Path $Adapters "$name\state.json"
  if (Test-Path $stateFile) {
    try { $st = Get-Content $stateFile -Raw -Encoding UTF8 | ConvertFrom-Json; if ($st.pid) { $candidates += [int]$st.pid } } catch {}
  }
  $pidFile = Join-Path $RunsDir "$name.pid"
  if (Test-Path $pidFile) { $id = (Get-Content $pidFile -Raw).Trim(); if ($id) { $candidates += [int]$id } }
  foreach ($id in $candidates) {
    try {
      $p = Get-Process -Id $id -ErrorAction Stop
      if ($p.ProcessName -match 'python') { return $p }   # PID дахин ашиглагдсан бол алгасна
    } catch {}
  }
  return $null
}

function Fmt-Dur([double]$s) {
  if ($s -lt 0) { return '?' }
  $ts = [TimeSpan]::FromSeconds($s)
  if ($ts.TotalHours -ge 1) { return ('{0}ц {1}м' -f [int]$ts.TotalHours, $ts.Minutes) }
  return ('{0}м {1}с' -f $ts.Minutes, $ts.Seconds)
}

function Show-Status([string]$name) {
  $stateFile = Join-Path $Adapters "$name\state.json"
  $proc = Get-RunProc $name
  Write-Output ""
  Write-Output "  ▶ $name"
  Write-Output "    процесс      : $(if ($proc) { 'АЖИЛЛАЖ БАЙНА (pid ' + $proc.Id + ', ' + [int]($proc.WorkingSet64/1MB) + ' MB RAM)' } else { 'алга' })"
  if (-not (Test-Path $stateFile)) {
    Write-Output "    төлөв        : state.json алга (эхлээгүй эсвэл ачаалж байна)"
    Write-Output "    лог          : $(Join-Path $RunsDir "$name.log")"
    return
  }
  $st = Get-Content $stateFile -Raw -Encoding UTF8 | ConvertFrom-Json
  $stale = ((Get-Date) - [datetime]$st.updated_at).TotalSeconds
  $status = $st.status
  if ($status -eq 'TRAINING' -and -not $proc) { $status = 'TRAINING (процесс АЛГА — унтраалт/crash?  -Resume)' }
  Write-Output "    төлөв        : $status   (шинэчлэгдсэн $(Fmt-Dur $stale) өмнө)"
  if ($null -ne $st.step) {
    $pct = if ($st.max_steps) { [math]::Round(100.0 * $st.step / $st.max_steps, 1) } else { '?' }
    Write-Output "    алхам        : $($st.step) / $($st.max_steps)  ($pct%)   epoch $($st.epoch)"
  }
  if ($null -ne $st.loss) { Write-Output "    loss         : $([math]::Round($st.loss, 4))   lr $($st.learning_rate)   grad_norm $(if ($st.grad_norm) { [math]::Round($st.grad_norm, 3) } else { '?' })" }
  if ($null -ne $st.eval_loss) { Write-Output "    eval_loss    : $([math]::Round($st.eval_loss, 4))" }
  if ($null -ne $st.step_ms_recent) { Write-Output "    алхам/хугацаа: $([math]::Round($st.step_ms_recent/1000, 1)) с   өнгөрсөн $(Fmt-Dur $st.elapsed_s)   ETA $(if ($null -ne $st.eta_s) { Fmt-Dur $st.eta_s } else { '?' })" }
  if ($st.gpu) { Write-Output "    GPU          : $($st.gpu.temp_c) °C · $($st.gpu.power_w) W · util $($st.gpu.util_pct)% · $($st.gpu.mem_used_mb)/$($st.gpu.mem_total_mb) MB · throttle $(if ($st.gpu.throttle) { $st.gpu.throttle -join ',' } else { 'үгүй' })" }
  if ($null -ne $st.vram_peak_mb) { Write-Output "    VRAM оргил   : $($st.vram_peak_mb) MB (reserved $($st.vram_reserved_mb))   NaN алхам: $($st.nan_steps)" }
  Write-Output "    checkpoint   : $(if ($st.last_checkpoint) { $st.last_checkpoint } else { 'хараахан алга' })"
  if ($st.error) { Write-Output "    АЛДАА        : $($st.error)" }
  if ($st.adapter) { Write-Output "    адаптер      : $($st.adapter)" }
  Write-Output "    лог          : $(Join-Path $RunsDir "$name.log")"
}

# ── Төлөв ────────────────────────────────────────────────────────────
if ($Status) {
  $names = if ($RunName) { @($RunName) } else {
    Get-ChildItem $Adapters -Directory -ErrorAction SilentlyContinue |
      Where-Object { Test-Path (Join-Path $_.FullName 'state.json') } |
      Sort-Object LastWriteTime -Descending | ForEach-Object { $_.Name }
  }
  if (-not $names) { Write-Output "  Сургалтын run алга."; exit 0 }
  foreach ($n in $names) { Show-Status $n }
  Write-Output ""
  $smi = & nvidia-smi --query-gpu=temperature.gpu,power.draw,utilization.gpu,memory.used,memory.total --format=csv,noheader,nounits 2>$null
  if ($smi) { Write-Output "  GPU одоо: $smi  (°C, W, util%, MB used, MB total)"; Write-Output "" }
  exit 0
}

if (-not $RunName) { throw "-RunName заавал (Status-аас бусад)." }

# ── Лог ──────────────────────────────────────────────────────────────
if ($Log) {
  $lf = Join-Path $RunsDir "$RunName.log"
  if (-not (Test-Path $lf)) { Write-Output "  Лог алга: $lf"; exit 1 }
  Get-Content $lf -Tail $Tail -Encoding UTF8
  exit 0
}

# ── Зогсоох ──────────────────────────────────────────────────────────
if ($Stop) {
  $proc = Get-RunProc $RunName
  if (-not $proc) { Write-Output "  $RunName ажиллахгүй байна."; exit 0 }
  $runDir = Join-Path $Adapters $RunName
  if ($Force) {
    Get-CimInstance Win32_Process -Filter "Name = 'python.exe'" | Where-Object { $_.CommandLine -match 'train_lora\.py' -and $_.CommandLine -match [regex]::Escape($RunName) } |
      ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue; Write-Output "  ⚠️ Хүчээр зогсоов (pid $($_.ProcessId))." }
    Remove-Item (Join-Path $env:LOCALAPPDATA 'MglAi\training.lock') -ErrorAction SilentlyContinue
    Write-Output "  Сүүлийн checkpoint-оос хойшхи алхам АЛДАГДСАН."
    exit 0
  }
  New-Item -ItemType File -Force (Join-Path $runDir 'STOP') | Out-Null
  Write-Output "  STOP файл тавив — дараагийн алхмын төгсгөлд checkpoint хадгалаад зогсоно (30–90 с)…"
  $deadline = (Get-Date).AddMinutes(10)
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 5
    if (-not (Get-RunProc $RunName)) { Write-Output "  ✔ Зогслоо."; Show-Status $RunName; exit 0 }
  }
  Write-Output "  ⚠️ 10 минутад зогссонгүй (ачаалалт эсвэл eval дундуур байж магадгүй).  -Stop -Force хэрэглэж болно."
  exit 1
}

# ── Эхлүүлэх / үргэлжлүүлэх ──────────────────────────────────────────
if (Get-RunProc $RunName) { throw "$RunName аль хэдийн ажиллаж байна.  -Status үз." }
if (-not (Test-Path $Python)) { throw "venv алга: $Python  (pip install -r ai/training/requirements.txt)" }
Remove-Item (Join-Path $Adapters "$RunName\STOP") -ErrorAction SilentlyContinue

$argList = @('-X', 'utf8', $Script, '--dataset', 'behavior', '--run-name', $RunName)
if ($Resume) {
  $cfg = Join-Path $Adapters "$RunName\config.json"
  if (-not (Test-Path $cfg)) { throw "Үргэлжлүүлэх run алга: $cfg" }
  # ⚠️ Тохиргоог config.json-оос ЯГ ижлээр сэргээнэ — өөр LR/rank-аар «үргэлжлүүлэх» нь худал сургалт.
  $c = Get-Content $cfg -Raw -Encoding UTF8 | ConvertFrom-Json
  $argList += @('--resume', '--epochs', "$($c.epochs)", '--rank', "$($c.lora_r)", '--alpha', "$($c.lora_alpha)",
                '--lr', "$($c.learning_rate)", '--grad-accum', "$($c.grad_accum)", '--max-seq-len', "$($c.max_seq_len)",
                '--seq-buckets', ($c.seq_buckets -join ','))
  if ($c.target_modules.Count -eq 4) { $argList += @('--targets', 'attn') }
  if ($c.quantize_lm_head) { $argList += '--quantize-lm-head' }
  if ($c.save_steps) { $argList += @('--save-steps', "$($c.save_steps)") }
  if ($c.reason) { $argList += @('--reason', $c.reason) }
}
if ($TrainArgs) { $argList += ($TrainArgs -split ' ' | Where-Object { $_ }) }
if ($Rest.Count -gt 0) { $argList += ($Rest | Where-Object { $_ }) }

$logFile = Join-Path $RunsDir "$RunName.log"
$errFile = Join-Path $RunsDir "$RunName.err.log"
# ⚠️ Өмнөх логийг ДАРЖ бичихгүй — resume хийхэд эхний хэсгийн loss мөрүүд алдагдаж байв (0.4, 2026-09-11).
foreach ($f in @($logFile, $errFile)) {
  if (Test-Path $f) { Move-Item $f ($f -replace '\.log$', ('.' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.log')) -Force }
}
$pidFile = Join-Path $RunsDir "$RunName.pid"

$env:PYTHONIOENCODING = 'utf-8'
$env:PYTHONUNBUFFERED = '1'
$env:PYTORCH_CUDA_ALLOC_CONF = 'expandable_segments:True'
$p = Start-Process -FilePath $Python -ArgumentList $argList -WorkingDirectory (Join-Path $AiDir 'training') `
       -WindowStyle Hidden -RedirectStandardOutput $logFile -RedirectStandardError $errFile -PassThru
Set-Content -Path $pidFile -Value $p.Id -Encoding ASCII
Write-Output ""
Write-Output "  ▶ $RunName эхэллээ (pid $($p.Id))$(if ($Resume) { ' — RESUME' })"
Write-Output "    тушаал : python $($argList -join ' ')"
Write-Output "    лог    : $logFile"
Write-Output "    төлөв  : npm run ai:train:status -- -RunName $RunName"
Write-Output "    зогсоох: npm run ai:train:stop -- -RunName $RunName"
Write-Output ""
