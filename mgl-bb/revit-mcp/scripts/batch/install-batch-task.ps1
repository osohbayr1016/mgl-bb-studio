# =====================================================================
# "MGL QTO Batch" scheduled task-уудыг бүртгэнэ (өдөрт 3 удаа).
#
# ⚠️ ЭНЭ SCRIPT-ЫГ БАТЧ ДАНСААР НЭВТЭРЧ БАЙЖ АЖИЛЛУУЛНА:
#     powershell -ExecutionPolicy Bypass -File install-batch-task.ps1
#   Add-in (%APPDATA%\Autodesk\Revit\Addins\<он>\), API токен ба
#   batch-config.json / batch-state.json (%APPDATA%\RevitMcpAddin\) БҮГД
#   ХЭРЭГЛЭГЧ ТУС БҮРИЙН зам.  Task-ыг эдгээр нь БАЙХГҮЙ өөр дансаар
#   ажиллуулбал:
#     • add-in огт ачаалагдахгүй → queue уншигдахгүй → ажиллагаа бүр exit 1;
#     • batch-state.json хоосон → БҮХ файл дахин push → qto_runs давхардана.
#   README.md-ийн «Нэг удаагийн тохиргоо» 0-4 алхмыг ЯГ ТЭР дансаар гүйцээ.
#
# Анхаар: task нь "хэрэглэгч нэвтэрсэн үед л" (interactive) ажиллана —
# Revit нь GUI програм тул session шаардана. 24/7 PC дээр хэрэглэгчээ
# нэвтэрсэн хэвээр (дэлгэц түгжээтэй байж болно) байлгаарай.
#
# Least-privilege: батч машин диск дээрээ 1 жилийн API токен хадгалдаг тул
# энэ данс нь ДОМЭЙН АДМИН БИШ, сүлжээний .rvt хавтас руу ЗӨВХӨН УНШИХ
# эрхтэй тусдаа Windows данс байг (жишээ нь MGL\qto-batch).
#
# -User нь ЗӨВХӨН ХОЁРДОГЧ зам: админ өөр дансны ӨМНӨӨС бүртгэнэ.  Тэр данс
# дээр дээрх тохиргоо АЛЬ ХЭДИЙН хийгдсэн байх ёстой — script боломжтойг нь
# шалгаад анхааруулга бичнэ, гэхдээ БАТАЛЖ ЧАДАХГҮЙ.
# =====================================================================
param(
    [string[]]$Times = @('02:00', '12:30', '18:30'),
    [string]$TaskName = 'MGL QTO Batch',
    # Task-ыг ажиллуулах Windows данс ('DOMAIN\user' эсвэл '.\user').
    # Хоосон = бүртгэж буй (энэ) хэрэглэгчийн доор ажиллана — ҮНДСЭН ЗАМ.
    [string]$User,
    # ⛔ ДЭМЖИГДЭХГҮЙ.  Доорх татгалзалыг үз — өгвөл script шууд зогсоно.
    [System.Management.Automation.PSCredential]$Credential
)

# ---- -Credential-ыг ИЛ ТАТГАЛЗАНА ------------------------------------
# Өмнө нь ХОЁР чимээгүй алдаа байсан:
#   • -Credential-ыг -User-гүй өгвөл `if ($User)` ХУДАЛ болж, ямар ч
#     мэдэгдэлгүй else салаа (= одоогийн хэрэглэгч) ажиллана — хүн өөр
#     дансаар бүртгэсэн гэж итгэсээр байтал task нь өөр дансных болно.
#   • -User + -Credential хамт өгвөл Principal УСТГАГДАЖ,
#     Register-ScheduledTask -User/-Password нь LogonType-ыг Password
#     болгоно.  Тэр логон нь ИНТЕРАКТИВ session БИШ тул Revit GUI огт
#     асахгүй — энэ файлын толгойн (:5-7) шаардлагатай шууд зөрчилдөнө.
#     Дээр нь нууц үг plaintext hashtable-д ороод процессын санах ойд үлдэнэ.
# Интерактив task-ыг ӨӨР дансаар бүртгэхэд НУУЦ ҮГ ОГТ ШААРДЛАГАГҮЙ —
# зөвхөн энэ PC дээрх админ эрх хэрэгтэй.
if ($PSBoundParameters.ContainsKey('Credential')) {
    throw ("-Credential дэмжигдэхгүй: нууц үгтэй логон нь LogonType=Password болгодог ба " +
        "тэр нь ИНТЕРАКТИВ session БИШ тул Revit GUI асахгүй.  Батч дансаар НЭВТЭРЧ энэ " +
        "script-ийг -User-гүй ажиллуул, эсвэл админ PowerShell-ээс -User 'DOMAIN\user' " +
        "(нууц үггүй) ашигла.")
}

$scriptPath = Join-Path $PSScriptRoot 'batch-qto.ps1'
if (-not (Test-Path $scriptPath)) { throw "batch-qto.ps1 олдсонгүй: $scriptPath" }

$action = New-ScheduledTaskAction -Execute 'powershell.exe' `
    -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$scriptPath`""

$triggers = foreach ($t in $Times) {
    New-ScheduledTaskTrigger -Daily -At $t
}

# ⚠️ ExecutionTimeLimit нь batch-config.json-ий `timeout_minutes`-ээс (анхдагч
# 90 мин — batch-qto.ps1) ЗААВАЛ УРТ байх ёстой.  Хооронд нь бүү солиорхойл:
# task эхэлж зогсвол PowerShell процесс ХАТУУ алагдаж, script-ийн `finally`
# ажиллахгүй → batch-queue.json диск дээр үлдэнэ.  Тэр үлдэгдэл нь дараагийн
# ЭНГИЙН Revit нээлтийг батч болгож хувиргаад Revit-ийг өөрөө хаадаг
# (BatchQto.cs:102).  batch-qto.ps1 одоо эхлэхдээ өөрөө цэвэрлэдэг боловч
# тэр нь дараагийн ажиллагаа хүртэлх завсарыг хамгаалахгүй.
# ⚠️ Энэ 3 цагийг өөрчилвөл batch-qto.ps1-ийн $LiveRevitMaxAgeMinutes-ыг мөн
# дагуулж өөрчил — тэр нь «амьд Revit» шүүлтийн насны хязгаар.
$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -DontStopOnIdleEnd `
    -ExecutionTimeLimit (New-TimeSpan -Hours 3)

# Байвал хуучныг устгаад дахин бүртгэнэ (idempotent).
try { Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction Stop } catch {}

$description = 'MGL: өөрчлөгдсөн Revit файлуудын тоо хэмжээг вэбсайт руу автоматаар илгээнэ (batch-qto.ps1)'

if ($User) {
    # ⚠️ P0-B: өөр дансаар ажиллуулах нь ЗӨВХӨН тэр данс дээр add-in + токен +
    # batch-config.json АЛЬ ХЭДИЙН байгаа үед л утга учиртай.  Боломжтойг нь
    # шалгана (профайл руу нэвтрэх эрхгүй бол зүгээр л анхааруулна).
    $leaf = ($User -split '\\')[-1]
    $peer = Join-Path $env:SystemDrive "Users\$leaf\AppData\Roaming"
    if (Test-Path $peer) {
        if (-not (Test-Path (Join-Path $peer 'RevitMcpAddin\batch-config.json'))) {
            Write-Warning "'$User' дансанд batch-config.json алга ($peer\RevitMcpAddin\) — ажиллагаа бүр exit 1 болно.  README-гийн 0-4 алхмыг ТЭР дансаар гүйцээ."
        }
        $addins = @(Get-ChildItem (Join-Path $peer 'Autodesk\Revit\Addins') -Filter 'RevitMcpAddin.addin' -Recurse -ErrorAction SilentlyContinue)
        if ($addins.Count -eq 0) {
            Write-Warning "'$User' дансанд MGL add-in суугаагүй бололтой — Revit асаад ЮУ Ч хийлгүй хаагдана, ажиллагаа бүр exit 1."
        }
    } else {
        Write-Warning "'$User' дансны профайл ($peer) уншигдсангүй — add-in / токен / batch-config.json байгаа эсэхийг ГАРААР батал."
    }

    # Өөр дансны нэрээр task бүртгэхэд админ эрх шаардлагатай.
    try {
        $ident   = [Security.Principal.WindowsIdentity]::GetCurrent()
        $isAdmin = (New-Object Security.Principal.WindowsPrincipal($ident)).IsInRole(
            [Security.Principal.WindowsBuiltInRole]::Administrator)
        if (-not $isAdmin -and $ident.Name -ne $User) {
            Write-Warning "Одоогийн session ($($ident.Name)) админ БИШ — өөр дансны task бүртгэхэд 'Access is denied' гарч болзошгүй.  PowerShell-ээ админаар нээнэ үү."
        }
    } catch { }

    # RunLevel Limited = өргөтгөсөн эрхгүй (Revit-д admin шаардлагагүй).
    # LogonType Interactive = тэр данс нэвтэрсэн байх ёстой (Revit GUI).
    # ⚠️ Энэ хоёрыг бүү сулруул: Password/S4U логон нь интерактив session
    # үүсгэдэггүй тул Revit асахгүй (толгойн :5-7 тэмдэглэлийг үз).
    $principal = New-ScheduledTaskPrincipal -UserId $User -LogonType Interactive -RunLevel Limited
    Register-ScheduledTask -TaskName $TaskName `
        -Action $action -Trigger $triggers -Settings $settings `
        -Principal $principal -Description $description | Out-Null
    Write-Host "Данс: $User (RunLevel Limited, Interactive)"
    Write-Host "АНХААР: %APPDATA% нь хэрэглэгч тус бүрд ТУСДАА — тэр данс дээр add-in,"
    Write-Host "        токен, batch-config.json БАЙХ ЁСТОЙ (README «Нэг удаагийн тохиргоо»)."
} else {
    Register-ScheduledTask -TaskName $TaskName `
        -Action $action -Trigger $triggers -Settings $settings `
        -Description $description | Out-Null
    Write-Host "Данс: $env:USERDOMAIN\$env:USERNAME (бүртгэсэн хэрэглэгч) — ҮНДСЭН ЗАМ."
    Write-Host "        Энэ данс нь add-in суусан, токен бичсэн, batch-config.json-той"
    Write-Host "        (%APPDATA%\RevitMcpAddin\) байхыг батал."
}

Write-Host "Бүртгэгдлээ: '$TaskName' — өдөр бүр $($Times -join ', ') цагт."
Write-Host "Шалгах:  Get-ScheduledTask -TaskName '$TaskName' | Get-ScheduledTaskInfo"
Write-Host "Данс шалгах:  (Get-ScheduledTask -TaskName '$TaskName').Principal"
Write-Host "Гараар ажиллуулах:  Start-ScheduledTask -TaskName '$TaskName'"
