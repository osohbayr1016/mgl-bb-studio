# «MGL ББ Студи» багц: Revit 2024–2027-д бүтээж, тусдаа zip (суулгагчтай) үүсгэнэ.
#   powershell -ExecutionPolicy Bypass -File package.ps1 [-Version 0.1.0] [-Years 2024,2027]
# Гаралт: <репо>\dist\<хувилбар>\MGL-BB-Studio-<хувилбар>.zip
# ⚠️ Үндсэн MGL plugin-ий багцтай ХОЛБООГҮЙ — энэ бол тусдаа нэмэлт.

[CmdletBinding()]
param(
  [string]$Version = '',
  [string[]]$Years = @('2024', '2025', '2026', '2027'),
  # Лицензийн шалгалтгүй туршилтын багц (үндсэн MGL plugin шаардахгүй) — zip нэрэнд «-nolicense».
  [switch]$NoLicense
)

$ErrorActionPreference = 'Stop'
# `powershell -File … -Years 2024,2027` нь «2024,2027»-ыг НЭГ мөр болгож дамжуулдаг — өөрсдөө хуваана.
$Years = @($Years | ForEach-Object { $_ -split '[,; ]' } | Where-Object { $_ } | ForEach-Object { [int]$_ })
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
$Proj = Join-Path $Here 'MglBbStudio.csproj'
if (-not $Version) {
  $m = Select-String -Path $Proj -Pattern '<Version>([^<]+)</Version>' | Select-Object -First 1
  $Version = $m.Matches[0].Groups[1].Value
}
$Dist  = Join-Path $Here "..\..\dist\$Version"
$Stage = Join-Path $Dist 'stage'
if (Test-Path $Stage) { Remove-Item $Stage -Recurse -Force }
New-Item -ItemType Directory -Force -Path $Stage | Out-Null

foreach ($y in $Years) {
  $cfg = "Release R$($y - 2000)"
  Write-Host "== $cfg"
  & dotnet build $Proj -c $cfg -p:Platform=x64 -p:Version=$Version "-p:NoLicense=$(if ($NoLicense) { 'true' } else { 'false' })" -v q -nologo
  if ($LASTEXITCODE -ne 0) { throw "Бүтээлт унав: $cfg" }
  $out = Join-Path $Here "bin\x64\$cfg"
  $dst = Join-Path $Stage "$y"
  New-Item -ItemType Directory -Force -Path $dst | Out-Null
  # Зөвхөн өөрийн DLL (Revit API, .NET сангууд Revit-тэй хамт ирдэг).
  Copy-Item (Join-Path $out 'MglBbStudio.dll') $dst
  if (Test-Path (Join-Path $out 'MglBbStudio.pdb')) { Copy-Item (Join-Path $out 'MglBbStudio.pdb') $dst }
}

Copy-Item (Join-Path $Here 'installer\install.ps1') $Stage
Set-Content -Path (Join-Path $Stage 'version.txt') -Value $Version -Encoding UTF8
$bat = "@echo off`r`npowershell -NoProfile -ExecutionPolicy Bypass -File `"%~dp0install.ps1`"`r`npause`r`n"
[IO.File]::WriteAllText((Join-Path $Stage 'Install.bat'), $bat, (New-Object Text.ASCIIEncoding))
$ubat = "@echo off`r`npowershell -NoProfile -ExecutionPolicy Bypass -File `"%~dp0install.ps1`" -Uninstall`r`npause`r`n"
[IO.File]::WriteAllText((Join-Path $Stage 'Uninstall.bat'), $ubat, (New-Object Text.ASCIIEncoding))
Copy-Item (Join-Path $Here 'installer\README.txt') $Stage

$zip = Join-Path $Dist "MGL-BB-Studio-$Version$(if ($NoLicense) { '-nolicense' }).zip"
if (Test-Path $zip) { Remove-Item $zip -Force }
Compress-Archive -Path (Join-Path $Stage '*') -DestinationPath $zip
$h = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLower()
Write-Host "OK $zip"
Write-Host "sha256 $h"
