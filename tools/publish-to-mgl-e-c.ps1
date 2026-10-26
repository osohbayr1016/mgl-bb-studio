# «MGL ББ Студи»-г mgl-e-c-ийн үндсэн MGL plugin руу НИЙТЛЭХ (нэг чиглэлтэй хуулбар).
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\publish-to-mgl-e-c.ps1 -Target C:\Users\User\project\mgl-release-165
#
# Юу хийдэг:
#   src\MglBbStudio      → <Target>\revit-mcp\bbstudio              (bin, obj-гүй, MIRROR — тэнд хуучин файл үлдэхгүй)
#   tests\BbStudio.Tests → <Target>\revit-mcp\tests\BbStudio.Tests
#   ба mgl-e-c-д тохируулах ЯГ ТОДОРХОЙ засварууд (доорх $edits) — хөдөлгүүрийг ../addin-аас линкээр эмхэтгэнэ (src\Engine хуулбар БИШ).
#   Засвар бүр ЯГ НЭГ удаа таарах ёстой — таарахгүй бол зогсоно (эх файл өөрчлөгдсөнийг чимээгүй алгасахгүй).
#   <Target>\revit-mcp\bbstudio\SOURCE.txt-д салаа, commit, огноог бичнэ.
#
# ⚠️ mgl-e-c-ийн revit-mcp\bbstudio-д ГАРААР БҮҮ засварла — энэ скрипт дарна.  Засварыг энд (mgl-bb-studio) хийгээд дахин нийтэл.
# ⚠️ Кирилл бичвэртэй тул энэ файл UTF-8 BOM-той.  Файлыг Get-Content-оор БИШ [IO.File]-аар уншина (PowerShell 5.1 ANSI урхи).
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Target
)
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$Target = (Resolve-Path $Target).Path
$rm = Join-Path $Target 'revit-mcp'
if (-not (Test-Path (Join-Path $rm 'addin\RevitMcpAddin.csproj'))) { throw "$Target нь mgl-e-c биш (revit-mcp\addin\RevitMcpAddin.csproj алга)" }

$srcAddin = Join-Path $repo 'src\MglBbStudio'
$srcTests = Join-Path $repo 'tests\BbStudio.Tests'
$dstAddin = Join-Path $rm 'bbstudio'
$dstTests = Join-Path $rm 'tests\BbStudio.Tests'

function Mirror([string]$from, [string]$to) {
  & robocopy $from $to /MIR /XD bin obj /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "robocopy $from -> $to унав (exit $LASTEXITCODE)" }
}
Mirror $srcAddin $dstAddin
Mirror $srcTests $dstTests

$utf8 = New-Object System.Text.UTF8Encoding($false)
function Edit-Once([string]$path, [string]$old, [string]$new) {
  $bytes = [IO.File]::ReadAllBytes($path)
  $bom = $bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF
  $text = $utf8.GetString($bytes, $(if ($bom) { 3 } else { 0 }), $bytes.Length - $(if ($bom) { 3 } else { 0 }))
  $n = ([regex]::Matches($text, [regex]::Escape($old))).Count
  if ($n -ne 1) { throw "$path : «$old» $n удаа таарав (1 байх ёстой) — эх файл өөрчлөгдсөн, скриптийг шинэчил" }
  $text = $text.Replace($old, $new)
  [IO.File]::WriteAllText($path, $text, (New-Object System.Text.UTF8Encoding($bom)))
}

$edits = @(
  @((Join-Path $dstAddin 'MglBbStudio.csproj'), '<Addin>..\Engine</Addin>',
    '<Addin>..\addin</Addin>  <!-- mgl-e-c: хөдөлгүүр = ../addin (линк); эх репод ../Engine хуулбар. SOURCE.txt -->'),
  @((Join-Path $dstAddin 'package.ps1'), '# Гаралт: <репо>\dist\<хувилбар>\MGL-BB-Studio-<хувилбар>.zip',
    '# Гаралт: revit-mcp\dist\bbstudio\<хувилбар>\MGL-BB-Studio-<хувилбар>.zip'),
  @((Join-Path $dstAddin 'package.ps1'), '"..\..\dist\$Version"', '"..\dist\bbstudio\$Version"'),
  @((Join-Path $dstTests 'BbStudio.Tests.csproj'), 'цөмийн тест (src/MglBbStudio/Core)', 'цөмийн тест (bbstudio/Core)'),
  @((Join-Path $dstTests 'BbStudio.Tests.csproj'), 'ОРОХГҮЙ — src/MglBbStudio/Core дотор', 'ОРОХГҮЙ — bbstudio/Core дотор'),
  @((Join-Path $dstTests 'BbStudio.Tests.csproj'), '(tests/BbStudio.Tests хавтаснаас)', '(revit-mcp/tests/BbStudio.Tests хавтаснаас)'),
  @((Join-Path $dstTests 'BbStudio.Tests.csproj'), '..\..\src\MglBbStudio\Core\*.cs', '..\..\bbstudio\Core\*.cs'),
  @((Join-Path $dstTests 'DefaultStandardTests.cs'), 'Path.Combine(dir, "src", "MglBbStudio", "Resources", "standard-default.json")',
    'Path.Combine(dir, "bbstudio", "Resources", "standard-default.json")')
)
foreach ($e in $edits) { Edit-Once $e[0] $e[1] $e[2] }

$ignore = "bin/`nobj/`n"
[IO.File]::WriteAllText((Join-Path $dstAddin '.gitignore'), $ignore, $utf8)
[IO.File]::WriteAllText((Join-Path $dstTests '.gitignore'), $ignore, $utf8)

$sha = (& git -C $repo rev-parse HEAD).Trim()
$branch = (& git -C $repo rev-parse --abbrev-ref HEAD).Trim()
$dirty = & git -C $repo status --porcelain
$state = if ($dirty) { ' (+ commit хийгээгүй өөрчлөлт)' } else { '' }
$stamp = (Get-Date).ToString('yyyy-MM-ddTHH:mm:ss')
$source = "mgl-bb-studio $branch @ $sha$state`r`nhttps://github.com/osohbayr1016/mgl-bb-studio`r`npublished $stamp`r`n`r`n" +
  "Энэ хавтас ба revit-mcp/tests/BbStudio.Tests нь mgl-bb-studio репогоос tools/publish-to-mgl-e-c.ps1-ээр хуулагдсан.`r`n" +
  "ЭНД БҮҮ ЗАСВАРЛА — дараагийн нийтлэлт дарна. Засварыг mgl-bb-studio-д хийгээд дахин нийтэлнэ.`r`n"
[IO.File]::WriteAllText((Join-Path $dstAddin 'SOURCE.txt'), $source, $utf8)

Write-Host "Нийтлэв: $branch @ $($sha.Substring(0, 8))$state -> $dstAddin" -ForegroundColor Green
