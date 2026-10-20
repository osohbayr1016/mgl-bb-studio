# Builds the LIRA add-in and packs an installable zip into lira-addin\dist\.
# Usage:  powershell -ExecutionPolicy Bypass -File lira-addin\package.ps1
# (This file is ASCII on purpose - PowerShell 5.1 reads BOM-less scripts as ANSI.)
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
[xml]$proj = Get-Content (Join-Path $root 'MglLiraReport.csproj') -Raw -Encoding UTF8
$version = ($proj.Project.PropertyGroup | ForEach-Object { $_.Version } | Where-Object { $_ } | Select-Object -First 1)
$name = "MGL-LIRA-Report-$version"
$out = Join-Path $root 'bin\Release'
$dist = Join-Path $root 'dist'
$stage = Join-Path $dist $name
$zip = Join-Path $dist "$name.zip"

& 'C:\Program Files\dotnet\dotnet.exe' build (Join-Path $root 'app\MglReportEditor.csproj') -c Release -o $out --nologo -v q
if ($LASTEXITCODE -ne 0) { throw "build failed ($LASTEXITCODE)" }

if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
if (Test-Path $zip) { Remove-Item $zip -Force }
New-Item -ItemType Directory -Force $stage | Out-Null
foreach ($f in 'MglLiraReport.dll', 'MglReportEditor.exe', 'MglReportEditor.exe.config') {
    $p = Join-Path $out $f
    if (Test-Path $p) { Copy-Item $p $stage }
}

$utf8Bom = New-Object Text.UTF8Encoding $true
foreach ($f in Get-ChildItem (Join-Path $root 'package') -File) {
    $text = [IO.File]::ReadAllText($f.FullName, [Text.Encoding]::UTF8) -replace "`r?`n", "`r`n"
    $dest = Join-Path $stage $f.Name
    if ($f.Extension -eq '.cmd') { [IO.File]::WriteAllText($dest, $text, [Text.Encoding]::ASCII) }
    else { [IO.File]::WriteAllText($dest, $text, $utf8Bom) }
}

# 24x20 menu icon
Add-Type -AssemblyName System.Drawing
$bmp = New-Object System.Drawing.Bitmap 24, 20
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.Clear([System.Drawing.Color]::FromArgb(41, 60, 87))
$font = New-Object System.Drawing.Font 'Arial', 7, ([System.Drawing.FontStyle]::Bold)
$g.DrawString('MGL', $font, [System.Drawing.Brushes]::White, 0, 4)
$g.Dispose(); $bmp.Save((Join-Path $stage 'MglLiraReport.png'), [System.Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose()

Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $zip
$hash = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLower()
"zip:    $zip"
"size:   $((Get-Item $zip).Length) bytes"
"sha256: $hash"
Get-ChildItem $stage | Select-Object Name, Length | Format-Table -AutoSize | Out-String
