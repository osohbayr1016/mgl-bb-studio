# «MGL ББ Студи» — Revit оны бүтээлт + цэвэр тест.
#   powershell -ExecutionPolicy Bypass -File build.ps1 [-Years 2024,2027] [-NoTests]
[CmdletBinding()]
param(
  [string[]]$Years = @('2024', '2025', '2026', '2027'),
  [switch]$NoTests
)
$ErrorActionPreference = 'Stop'
# `powershell -File … -Years 2024,2027` нь «2024,2027»-ыг НЭГ мөр болгож дамжуулдаг — өөрсдөө хуваана.
$Years = @($Years | ForEach-Object { $_ -split '[,; ]' } | Where-Object { $_ } | ForEach-Object { [int]$_ })
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
$Proj = Join-Path $Here 'src\MglBbStudio\MglBbStudio.csproj'
foreach ($y in $Years) {
  $cfg = "Release R$($y - 2000)"
  Write-Host "== $cfg"
  & dotnet build $Proj -c $cfg -p:Platform=x64 -v q -nologo
  if ($LASTEXITCODE -ne 0) { throw "Бүтээлт унав: $cfg" }
}
if (-not $NoTests) {
  Write-Host '== тест'
  & dotnet run --project (Join-Path $Here 'tests\BbStudio.Tests\BbStudio.Tests.csproj') -nologo
  if ($LASTEXITCODE -ne 0) { throw 'Тест унав' }
}
Write-Host 'OK'
