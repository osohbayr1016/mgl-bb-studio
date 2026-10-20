# MGL тооцооны тайлан — суулгагч (zip доторх файлуудаас, эмхэтгэл шаардахгүй).
# Install.cmd-ээр ажиллуулна. Админ эрх шаардахгүй — зөвхөн энэ хэрэглэгчид суулгана.
#   1) LIRA 10.12-ийн цэсэнд «MGL тооцооны тайлан» команд (LIRA суусан бол)
#   2) LIRA-гүйгээр нээгддэг «MGL Тооцооны тайлан» програм (Desktop + Start цэс)
$ErrorActionPreference = 'Stop'
$LiraVersion = '10.12'
$src = $PSScriptRoot

function Fail($msg) { Write-Host ""; Write-Host "АЛДАА: $msg" -ForegroundColor Red; exit 1 }

Write-Host "MGL тооцооны тайлан суулгаж байна..." -ForegroundColor Cyan

$files = @('MglLiraReport.dll', 'MglReportEditor.exe', 'MglReportEditor.exe.config', 'MglLiraReport.png')
foreach ($f in @('MglLiraReport.dll', 'MglReportEditor.exe')) {
    if (-not (Test-Path (Join-Path $src $f))) { Fail "$f zip дотор алга. Zip-ийг бүтнээр нь задалсан эсэхээ шалгана уу." }
}

if (Get-Process | Where-Object { $_.Path -like '*Lira Soft*' -or $_.Name -eq 'MglReportEditor' }) {
    Fail "LIRA эсвэл MGL Тооцооны тайлан нээлттэй байна. Ажлаа хадгалаад хаагаад дахин Install.cmd ажиллуулна уу."
}

$target = Join-Path $env:LOCALAPPDATA "MGL\LiraAddin\$LiraVersion"
New-Item -ItemType Directory -Force $target | Out-Null
foreach ($f in $files) {
    $p = Join-Path $src $f
    if (Test-Path $p) { Copy-Item $p $target -Force }
}
# Интернэт / имэйлээс татсан zip-ийн файлууд «блоклогдсон» байдаг — .NET тэдгээрийг ачаалахгүй.
Get-ChildItem $target -File | Unblock-File -ErrorAction SilentlyContinue

$dll = Join-Path $target 'MglLiraReport.dll'
$exe = Join-Path $target 'MglReportEditor.exe'
$icon = Join-Path $target 'MglLiraReport.png'

# 1) LIRA-ийн цэс
$liraBin = "C:\Program Files\Lira Soft\Lira$LiraVersion\bin64\LiraAPI.dll"
if (Test-Path $liraBin) {
    $addins = Join-Path $env:APPDATA "Lira Soft\Lira$LiraVersion\Addins"
    $envXml = Join-Path $env:APPDATA "Lira Soft\Lira$LiraVersion\VariableEnvironment_x64.xml"
    if (Test-Path $envXml) {
        $m = Select-String -Path $envXml -Pattern '<AddinsPath[^>]*>([^<]+)</AddinsPath>' -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($m) { $addins = $m.Matches[0].Groups[1].Value }
    }
    New-Item -ItemType Directory -Force $addins | Out-Null
    $xml = @"
<?xml version="1.0" encoding="utf-8"?>
<LiraAddIns>
  <AddIn Type="PROLONGATION">
    <AssemblyPath>$dll</AssemblyPath>
    <CommandName>MGL тооцооны тайлан</CommandName>
    <CommandDescription>Бүтээцийн тооцооны тайланг компанийн загвараар Word-оор гаргана</CommandDescription>
    <ImagePath>$icon</ImagePath>
    <Vendor>Эм Жи Эл И Эн Си ХХК</Vendor>
    <VendorDescription>MGL E&amp;C</VendorDescription>
  </AddIn>
</LiraAddIns>
"@
    [IO.File]::WriteAllText((Join-Path $addins 'MglLiraReport.xml'), $xml, (New-Object Text.UTF8Encoding $true))
    Write-Host "  LIRA $LiraVersion-ийн цэсэнд бүртгэлээ." -ForegroundColor Green
} else {
    Write-Host "  LIRA $LiraVersion олдсонгүй — зөвхөн LIRA-гүй програм суулгалаа." -ForegroundColor Yellow
}

# 2) Товчлол
$shell = New-Object -ComObject WScript.Shell
$programs = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'
foreach ($dir in @([Environment]::GetFolderPath('Desktop'), $programs)) {
    # WScript.Shell нь кирилл нэртэй .lnk хадгалж чаддаггүй (ANSI) — латин нэрээр хадгалаад нэрийг нь солино.
    New-Item -ItemType Directory -Force $dir | Out-Null
    $tmp = Join-Path $dir 'mgl-lira-report.lnk'
    $final = Join-Path $dir 'MGL Тооцооны тайлан.lnk'
    $lnk = $shell.CreateShortcut($tmp)
    $lnk.TargetPath = $exe
    $lnk.WorkingDirectory = $target
    $lnk.Description = 'MGL structural calculation report'
    $lnk.Save()
    Move-Item -LiteralPath $tmp -Destination $final -Force
}
Write-Host "  Desktop болон Start цэсэнд «MGL Тооцооны тайлан» товчлол үүслээ." -ForegroundColor Green

# 3) Фонт — тайлан «ISOCPEUR MON» фонтоор гарна (Revit/AutoCAD-тай хамт ирдэг).
$fontOk = $false
foreach ($key in 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts', 'HKCU:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts') {
    $props = Get-ItemProperty $key -ErrorAction SilentlyContinue
    if ($props -and ($props.PSObject.Properties.Name | Where-Object { $_ -like 'ISOCPEUR MON*' })) { $fontOk = $true }
}
if (-not $fontOk) {
    Write-Host ""
    Write-Host "АНХААР: «ISOCPEUR MON» фонт энэ компьютерт суугаагүй байна." -ForegroundColor Yellow
    Write-Host "  Тайлан ажиллана, гэхдээ Word өөр фонтоор харуулна. isocpeu_mon.ttf фонтыг суулгана уу." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Амжилттай суулгалаа." -ForegroundColor Green
Write-Host "  Хавтас: $target"
Write-Host ""
Write-Host "Хэрэглэх:"
Write-Host "  - Desktop дээрх «MGL Тооцооны тайлан»-г нээнэ (LIRA шаардахгүй), эсвэл"
Write-Host "  - LIRA-д тооцоотой загвараа нээж, үр дүн харах горимд цэснээс «MGL тооцооны тайлан»."
