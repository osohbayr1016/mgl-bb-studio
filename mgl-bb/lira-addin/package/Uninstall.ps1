# MGL тооцооны тайланг устгана.  Таны тайлангийн файлууд (Documents\MGL-LIRA) үлдэнэ.
$ErrorActionPreference = 'Stop'
$LiraVersion = '10.12'

if (Get-Process | Where-Object { $_.Path -like '*Lira Soft*' -or $_.Name -eq 'MglReportEditor' }) {
    Write-Host "LIRA эсвэл MGL Тооцооны тайлан нээлттэй байна — хаагаад дахин ажиллуулна уу." -ForegroundColor Red
    exit 1
}

$addins = Join-Path $env:APPDATA "Lira Soft\Lira$LiraVersion\Addins"
$envXml = Join-Path $env:APPDATA "Lira Soft\Lira$LiraVersion\VariableEnvironment_x64.xml"
if (Test-Path $envXml) {
    $m = Select-String -Path $envXml -Pattern '<AddinsPath[^>]*>([^<]+)</AddinsPath>' -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($m) { $addins = $m.Matches[0].Groups[1].Value }
}
Remove-Item (Join-Path $addins 'MglLiraReport.xml') -Force -ErrorAction SilentlyContinue
Remove-Item (Join-Path $env:LOCALAPPDATA "MGL\LiraAddin\$LiraVersion") -Recurse -Force -ErrorAction SilentlyContinue
$programs = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'
foreach ($dir in @([Environment]::GetFolderPath('Desktop'), $programs)) {
    Remove-Item (Join-Path $dir 'MGL Тооцооны тайлан.lnk') -Force -ErrorAction SilentlyContinue
}

Write-Host "MGL тооцооны тайланг устгалаа. Тайлангийн файлууд Documents\MGL-LIRA-д үлдсэн." -ForegroundColor Green
