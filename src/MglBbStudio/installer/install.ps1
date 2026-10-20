# «MGL ББ Студи» — ТУСДАА Revit нэмэлтийн суулгагч / устгагч (хэрэглэгч тутам, admin эрх шаардахгүй).
#
# ⚠️ ҮНДСЭН MGL plugin-ий (RevitMcpAddin) файл, манифест, тохиргоог ХЭЗЭЭ Ч хөндөхгүй:
#   өөрийн манифест  %APPDATA%\Autodesk\Revit\Addins\<он>\MglBbStudio.addin
#   өөрийн DLL       %LOCALAPPDATA%\MGL\BbStudio\<он>\versions\<хувилбар>\
#   өөрийн өгөгдөл   %APPDATA%\MGL\BbStudio\ (сурсан стандарт — устгахад ХАДГАЛАГДАНА)
# ⚠️ Хувилбар бүр өөрийн хавтсанд — Revit нээлттэй байхад DLL түгжигддэг тул шинэ хувилбар хажууд нь суугаад манифест л солигдоно.
# ⚠️ UTF-8 BOM-той (Windows PowerShell 5.1 кирилл уншихад).

[CmdletBinding()]
param(
  [switch]$Uninstall,
  [switch]$Quiet
)

$ErrorActionPreference = 'Stop'
$AddInId  = 'b6d2f1a4-3c8e-4e7b-9a51-0f2c7d8e9a13'
$Here     = Split-Path -Parent $MyInvocation.MyCommand.Path
# Тестийн гарц (ажилтан ХЭЗЭЭ Ч тавихгүй): тусгаарласан хавтсанд суулгаж шалгах.
$AppData  = if ($env:MGL_BBS_TEST_APPDATA) { $env:MGL_BBS_TEST_APPDATA } else { [Environment]::GetFolderPath('ApplicationData') }
$Local    = if ($env:MGL_BBS_TEST_LOCALAPPDATA) { $env:MGL_BBS_TEST_LOCALAPPDATA } else { [Environment]::GetFolderPath('LocalApplicationData') }
$AnyYear  = $env:MGL_BBS_TEST_ANYYEAR -eq '1'
$Version  = (Get-Content (Join-Path $Here 'version.txt') -Encoding UTF8 -ErrorAction SilentlyContinue | Select-Object -First 1)
if (-not $Version) { $Version = '0.0.0' }

function Say([string]$m) { if (-not $Quiet) { Write-Host $m } }

$years = Get-ChildItem -Path $Here -Directory | Where-Object { $_.Name -match '^20\d\d$' } | Select-Object -ExpandProperty Name
if (-not $years) { Say 'Багцад Revit оны хавтас (2024…2027) алга.'; exit 1 }

$done = @()
foreach ($y in $years) {
  $addinDir = Join-Path $AppData "Autodesk\Revit\Addins\$y"
  $manifest = Join-Path $addinDir 'MglBbStudio.addin'
  $root     = Join-Path $Local "MGL\BbStudio\$y"
  if ($Uninstall) {
    if (Test-Path $manifest) { Remove-Item $manifest -Force }
    if (Test-Path $root) { try { Remove-Item $root -Recurse -Force } catch { Say "  ${y}: зарим DLL түгжигдсэн (Revit нээлттэй) — дараа нь устгана уу: $root" } }
    $done += "$y устгагдлаа"
    continue
  }
  # Revit тэр он суусан эсэх: Addins хавтас (Revit анх нээгдэхэд үүсдэг) эсвэл Program Files.
  $installed = $AnyYear -or (Test-Path $addinDir) -or (Test-Path "C:\Program Files\Autodesk\Revit $y\Revit.exe")
  if (-not $installed) { continue }
  $dst = Join-Path $root "versions\$Version"
  New-Item -ItemType Directory -Force -Path $dst | Out-Null
  Copy-Item -Path (Join-Path $Here "$y\*") -Destination $dst -Recurse -Force
  $dll = Join-Path $dst 'MglBbStudio.dll'
  if (-not (Test-Path $dll)) { Say "  ${y}: MglBbStudio.dll олдсонгүй — алгасав."; continue }
  New-Item -ItemType Directory -Force -Path $addinDir | Out-Null
  $xml = @"
<?xml version="1.0" encoding="utf-8"?>
<RevitAddIns>
  <AddIn Type="Application">
    <Name>MGL ББ Студи</Name>
    <Assembly>$dll</Assembly>
    <AddInId>$AddInId</AddInId>
    <FullClassName>MglBb.App</FullClassName>
    <VendorId>MGL</VendorId>
    <VendorDescription>MGL E&amp;C — бүтээцийн ажлын зураг (тусдаа нэмэлт)</VendorDescription>
  </AddIn>
</RevitAddIns>
"@
  [IO.File]::WriteAllText($manifest, $xml, (New-Object Text.UTF8Encoding($true)))
  # Хуучин хувилбарын хавтсыг цэвэрлэнэ (түгжигдсэн бол үлдээнэ — дараагийн суулгалтаар).
  Get-ChildItem (Join-Path $root 'versions') -Directory | Where-Object { $_.Name -ne $Version } | ForEach-Object { try { Remove-Item $_.FullName -Recurse -Force } catch { } }
  $done += "Revit $y"
}

if ($Uninstall) { Say ('MGL ББ Студи: ' + ($done -join ', ')); exit 0 }
if (-not $done) { Say 'Суусан Revit (2024–2027) олдсонгүй.'; exit 1 }
Say ("MGL ББ Студи $Version суулаа: " + ($done -join ', ') + ".  Revit-ийг дахин нээхэд «MGL ББ» таб гарна.")
exit 0
