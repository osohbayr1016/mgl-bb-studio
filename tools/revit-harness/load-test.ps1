# Load test: start a PRIVATE Revit <Year> (no model) with a temporary manifest for the freshly built MglBbStudio.dll,
# wait for the ribbon tab «MGL ББ», capture the window, remove the manifest, then close that Revit (only the PID we started).
param(
  [Parameter(Mandatory = $true)][string]$Year,
  [Parameter(Mandatory = $true)][string]$Dll,
  [Parameter(Mandatory = $true)][string]$OutDir,
  [int]$TimeoutSec = 420
)
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$revitExe = "C:\Program Files\Autodesk\Revit $Year\Revit.exe"
if (-not (Test-Path $revitExe)) { Write-Host "NOT RUN - Revit $Year not installed"; exit 3 }
$busy = @(Get-Process -Name Revit -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path -like "*Revit $Year*" })
if ($busy.Count -gt 0) { Write-Host "NOT RUN - Revit $Year already running (PID $($busy[0].Id))"; exit 3 }
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$addinsDir = Join-Path $env:APPDATA "Autodesk\Revit\Addins\$Year"
$manifest = Join-Path $addinsDir 'MglBbStudio.LOADTEST.addin'
if (Test-Path (Join-Path $addinsDir 'MglBbStudio.addin')) { Write-Host "NOT RUN - MglBbStudio already installed for $Year"; exit 3 }
$xml = @"
<?xml version="1.0" encoding="utf-8"?>
<RevitAddIns>
  <AddIn Type="Application">
    <Name>MGL BB Studio (LOAD TEST)</Name>
    <Assembly>$Dll</Assembly>
    <AddInId>B6D2F1A4-3C8E-4E7B-9A51-0F2C7D8E9A13</AddInId>
    <FullClassName>MglBb.App</FullClassName>
    <VendorId>MGLE</VendorId>
    <VendorDescription>MGL E&amp;C</VendorDescription>
  </AddIn>
</RevitAddIns>
"@
[IO.File]::WriteAllText($manifest, $xml, (New-Object Text.UTF8Encoding($false)))
$revit = Start-Process -FilePath $revitExe -PassThru -WindowStyle Minimized
Write-Host "Revit $Year PID $($revit.Id)"
$stop = Join-Path $OutDir 'watch.STOP'
if (Test-Path $stop) { Remove-Item $stop }
$watch = Start-Process -FilePath 'powershell.exe' -WindowStyle Hidden -PassThru -ArgumentList @(
  '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"' + (Join-Path $here 'dialog-watch.ps1') + '"'),
  '-RevitPid', $revit.Id, '-Log', ('"' + (Join-Path $OutDir 'dialogs.log') + '"'), '-Stop', ('"' + $stop + '"'))
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$AE = [System.Windows.Automation.AutomationElement]
$byPid = New-Object System.Windows.Automation.PropertyCondition($AE::ProcessIdProperty, $revit.Id)
$found = $false
$deadline = (Get-Date).AddSeconds($TimeoutSec)
while ((Get-Date) -lt $deadline -and -not $found) {
  Start-Sleep -Seconds 4
  if ($revit.HasExited) { break }
  try {
    foreach ($w in $AE::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, $byPid)) {
      $c = New-Object System.Windows.Automation.PropertyCondition($AE::NameProperty, 'MGL ББ')
      $t = $w.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $c)
      if ($t -ne $null) { $found = $true; Write-Host ("tab found: " + $t.Current.ControlType.ProgrammaticName + " in '" + $w.Current.Name + "'"); break }
    }
  } catch { }
}
Remove-Item -Force $manifest -ErrorAction SilentlyContinue
Write-Host 'manifest removed'
if ($found) { & (Join-Path $here 'winshot.ps1') -ProcId $revit.Id -OutDir $OutDir | Out-Null }
$err = Join-Path $env:APPDATA 'MGL\BbStudio\startup-error.txt'
if (Test-Path $err) { Write-Host 'startup-error.txt:'; Get-Content $err -Tail 5 }
Set-Content -Path $stop -Value 'stop'
if (-not $revit.HasExited) { Stop-Process -Id $revit.Id -Force; Write-Host "closed PID $($revit.Id)" }
if ($found) { Write-Host 'LOAD OK'; exit 0 } else { Write-Host 'LOAD FAIL (tab not found)'; exit 1 }
