<#
  MGL AI · CONTINUAL LEARNING LOOP — approved conversation feedback only.

  Usage:
    $env:MGLAI_TOKEN = "<admin token>"
    npm run ai:train:continuous
    npm run ai:train:continuous -- -Once
    npm run ai:train:continuous -- -PollMinutes 60 -MinNewApproved 10 -AutoEvaluate

  What this does:
    1) export ONLY admin-approved/included feedback via the existing control-plane endpoint;
    2) rebuild the serving-v2 behavioral SFT corpus (synthetic safety/tool cases + AEC curriculum + approved corrections);
    3) run training-readiness gates;
    4) start one detached QLoRA candidate on Qwen3-8B;
    5) when training finishes, export the LoRA GGUF; optionally run candidate-vs-baseline evaluation.

  What this NEVER does:
    - never trains on raw/pending employee conversations;
    - never auto-approves feedback;
    - never merges adapter-on-adapter;
    - never changes the production manifest or promotes a candidate;
    - never bypasses dataset lint, GPU guard, memory probe, or release gates.

  Every candidate is trained fresh from the frozen Qwen3-8B serving base against the
  latest approved corpus.  That prevents repeated fine-tune drift from compounding.
#>
param(
  [int]$PollMinutes = 60,
  [int]$MinNewApproved = 10,
  [double]$Epochs = 2.0,
  [double]$LearningRate = 0.0001,
  [switch]$AutoEvaluate,
  [switch]$Once
)

$ErrorActionPreference = 'Stop'
$AiDir = Split-Path -Parent $PSScriptRoot
$TrainDir = $PSScriptRoot
$StatePath = Join-Path $TrainDir 'continuous-state.json'
$OutDir = Join-Path $TrainDir 'out'
$AdaptersDir = Join-Path $AiDir 'models\adapters'
$ExportScript = Join-Path $AiDir 'scripts\export-feedback.mjs'
$Builder = Join-Path $TrainDir 'build_behavior_sft.mjs'
$Readiness = Join-Path $TrainDir 'readiness.mjs'
$TrainRunner = Join-Path $TrainDir 'train.ps1'
$ExportAdapter = Join-Path $TrainDir 'export_adapter.py'
$EvalCandidate = Join-Path $TrainDir 'eval-candidate.mjs'
$Python = Join-Path $TrainDir '.venv\Scripts\python.exe'

if (-not $env:MGLAI_TOKEN) {
  throw 'MGLAI_TOKEN алга. Admin-approved feedback экспортлоход админы token шаардлагатай.'
}
if ($PollMinutes -lt 5 -and -not $Once) {
  throw 'PollMinutes хамгийн багадаа 5. Conversation feedback минут тутамд fine-tune хийх ёсгүй.'
}
if ($MinNewApproved -lt 1) { throw 'MinNewApproved >= 1 байх ёстой.' }

function New-State {
  return [ordered]@{
    schema = 1
    last_trained_hash = $null
    last_trained_rows = 0
    last_run = $null
    last_completed_at = $null
    last_failure_hash = $null
    last_failure = $null
    pending_run = $null
    pending_hash = $null
    pending_rows = 0
    pending_dataset_version = $null
    pending_started_at = $null
    last_eval = $null
  }
}

function Read-State {
  if (-not (Test-Path $StatePath)) { return New-State }
  try {
    $raw = Get-Content $StatePath -Raw -Encoding UTF8 | ConvertFrom-Json
    $s = New-State
    foreach ($p in $raw.PSObject.Properties) { $s[$p.Name] = $p.Value }
    return $s
  } catch {
    throw "continuous-state.json эвдэрсэн: $($_.Exception.Message)"
  }
}

function Save-State($s) {
  $tmp = "$StatePath.tmp"
  ($s | ConvertTo-Json -Depth 8) | Set-Content -Path $tmp -Encoding UTF8
  Move-Item -Force $tmp $StatePath
}

function Invoke-Step([string]$Label, [scriptblock]$Command) {
  Write-Output ""
  Write-Output "  ▶ $Label"
  & $Command
  if ($LASTEXITCODE -ne 0) {
    throw "$Label унав (exit $LASTEXITCODE)."
  }
}

function Export-CompletedAdapter([string]$RunName) {
  $gguf = Join-Path $AdaptersDir "$RunName\$RunName.lora.gguf"
  if (Test-Path $gguf) {
    Write-Output "  ✔ GGUF LoRA аль хэдийн байна: $gguf"
    return
  }
  if (-not (Test-Path $Python)) {
    Write-Warning "training venv алга — LoRA экспорт алгасав: $Python"
    return
  }
  try {
    Invoke-Step "GGUF LoRA экспорт ($RunName)" {
      & $Python -X utf8 $ExportAdapter --run $RunName
    }
  } catch {
    # Сургалт өөрөө амжилттай болсон. Export нь тусдаа шат тул дараагийн feedback
    # cycle-ийг хорихгүй; админ ai:train:export-оор дахин оролдож болно.
    Write-Warning "Адаптер экспорт амжилтгүй: $($_.Exception.Message)"
  }
}

function Maybe-Evaluate([string]$RunName, $s) {
  if (-not $AutoEvaluate) { return }
  try {
    Invoke-Step "candidate vs frozen baseline ($RunName)" {
      & node $EvalCandidate --run $RunName
    }
    $s.last_eval = [ordered]@{ run = $RunName; status = 'completed'; at = (Get-Date).ToString('o') }
  } catch {
    # Evaluation prerequisite (local backend/candidate knowledge/runtime) may be absent.
    # Candidate is NEVER promoted here, so keep the failure diagnostic only.
    $s.last_eval = [ordered]@{ run = $RunName; status = 'failed'; at = (Get-Date).ToString('o'); error = $_.Exception.Message }
    Write-Warning "Candidate evaluation ажилласангүй: $($_.Exception.Message)"
  }
}

function Resolve-Pending($s) {
  $run = [string]$s.pending_run
  if (-not $run) { return $false }

  $runStatePath = Join-Path $AdaptersDir "$run\state.json"
  if (-not (Test-Path $runStatePath)) {
    Write-Output "  … $run эхлэх/ачаалах төлөв хүлээж байна."
    return $true
  }

  try { $rs = Get-Content $runStatePath -Raw -Encoding UTF8 | ConvertFrom-Json }
  catch {
    Write-Warning "$run state.json уншигдсангүй — энэ мөчлөгт дахин сургалт эхлүүлэхгүй."
    return $true
  }

  $status = [string]$rs.status
  if ($status -in @('LOADING','TRAINING','EVALUATING')) {
    $step = if ($null -ne $rs.step) { " · step $($rs.step)/$($rs.max_steps)" } else { '' }
    Write-Output "  … $run: $status$step"
    return $true
  }

  if ($status -eq 'DONE') {
    Write-Output "  ✔ $run сургалт дууссан."
    Export-CompletedAdapter $run
    Maybe-Evaluate $run $s

    $s.last_trained_hash = $s.pending_hash
    $s.last_trained_rows = [int]$s.pending_rows
    $s.last_run = $run
    $s.last_completed_at = (Get-Date).ToString('o')
    $s.last_failure_hash = $null
    $s.last_failure = $null
    $s.pending_run = $null
    $s.pending_hash = $null
    $s.pending_rows = 0
    $s.pending_dataset_version = $null
    $s.pending_started_at = $null
    Save-State $s
    return $false
  }

  if ($status -in @('FAILED','STOPPED','THERMAL_STOPPED')) {
    Write-Warning "$run сургалт $status төлөвөөр дууссан. Ижил feedback snapshot-ийг автоматаар дахин сургахгүй."
    $s.last_failure_hash = $s.pending_hash
    $s.last_failure = [ordered]@{
      run = $run
      status = $status
      at = (Get-Date).ToString('o')
      error = if ($rs.error) { [string]$rs.error } else { $null }
    }
    $s.pending_run = $null
    $s.pending_hash = $null
    $s.pending_rows = 0
    $s.pending_dataset_version = $null
    $s.pending_started_at = $null
    Save-State $s
    return $false
  }

  Write-Output "  … $run: танихгүй/завсрын төлөв '$status' — шинэ сургалт эхлүүлэхгүй."
  return $true
}

function Run-Cycle {
  $s = Read-State
  if (Resolve-Pending $s) { return }

  # export-feedback semantic version only accepts N.N.N. Reusing the day's path is
  # intentional: polling does not create thousands of identical snapshots.
  $now = Get-Date
  $exportVersion = "$($now.Year).$($now.Month).$($now.Day)"
  Invoke-Step "admin-approved conversation feedback export" {
    & node $ExportScript $exportVersion
  }

  $feedbackFile = Join-Path $AiDir "datasets\mgl-dataset-$exportVersion\train.jsonl"
  if (-not (Test-Path $feedbackFile)) { throw "feedback export файл алга: $feedbackFile" }

  $hash = (Get-FileHash $feedbackFile -Algorithm SHA256).Hash.ToLowerInvariant()
  $rows = @(Get-Content $feedbackFile -Encoding UTF8 | Where-Object { $_.Trim().Length -gt 0 }).Count

  Write-Output "  approved snapshot: $rows мөр · sha256 $($hash.Substring(0,16))…"

  if ($hash -eq [string]$s.last_trained_hash) {
    Write-Output '  → шинэ approved correction алга.'
    return
  }
  if ($hash -eq [string]$s.last_failure_hash) {
    Write-Output '  → энэ snapshot өмнөх сургалтад унасан; шинэ feedback иртэл давтахгүй.'
    return
  }

  $previousRows = [int]$s.last_trained_rows
  $newRows = [Math]::Max(0, $rows - $previousRows)
  $editedExisting = $previousRows -gt 0 -and $rows -eq $previousRows -and [string]$s.last_trained_hash

  if (-not $editedExisting -and $newRows -lt $MinNewApproved) {
    Write-Output "  → шинэ approved мөр $newRows/$MinNewApproved. Илүү correction цуглартал сургахгүй."
    return
  }

  # Unique reproducible corpus identity for this candidate.
  $stamp = $now.ToString('yyyy-MM-dd-HHmmss')
  $datasetVersion = "behav-$stamp.continual"
  $runName = "mgl-adapter-auto-$($now.ToString('yyyyMMdd-HHmmss'))"

  Invoke-Step "serving-v2 SFT corpus build ($datasetVersion)" {
    & node $Builder --feedback $feedbackFile --out $OutDir --version $datasetVersion
  }

  Invoke-Step 'training readiness gates' {
    & node $Readiness
  }

  # Same stable 8 GB profile as adapter 0.5. train_lora.py still re-checks
  # memory probe, CUDA, dataset lint, serving base revision and GPU ownership.
  $trainArgs = "--epochs $Epochs --lr $LearningRate --grad-accum 8 --max-seq-len 2048 --seq-buckets 1536,1792,2048 --quantize-lm-head --save-steps 10 --reason continual-approved-conversation-aec"

  Invoke-Step "detached QLoRA candidate start ($runName)" {
    & powershell -NoProfile -ExecutionPolicy Bypass -File $TrainRunner -RunName $runName -TrainArgs $trainArgs
  }

  $s.pending_run = $runName
  $s.pending_hash = $hash
  $s.pending_rows = $rows
  $s.pending_dataset_version = $datasetVersion
  $s.pending_started_at = (Get-Date).ToString('o')
  Save-State $s

  Write-Output ""
  Write-Output "  ✔ Candidate training started: $runName"
  Write-Output "    It is NOT production and will never be auto-promoted by this loop."
}

Push-Location $AiDir
try {
  Write-Output ""
  Write-Output "MGL AI · continual learning"
  Write-Output "  source: admin-approved conversation corrections only"
  Write-Output "  trigger: >= $MinNewApproved new approved rows (or an edit to the last approved snapshot)"
  Write-Output "  cadence: $(if ($Once) { 'one cycle' } else { "every $PollMinutes min" })"
  Write-Output "  promotion: NEVER automatic"
  Write-Output ""

  do {
    try {
      Run-Cycle
    } catch {
      Write-Warning $_.Exception.Message
    }

    if ($Once) { break }
    Start-Sleep -Seconds ($PollMinutes * 60)
  } while ($true)
}
finally {
  Pop-Location
}
