# Room Plan live gate - dialog watcher for ONE Revit process (the one run-live.ps1 started).
#
#   * Revit asks "Security - Unsigned Add-In" for the unsigned test add-in -> answers "Always Load" (only for that dialog).
#   * Every other new window of that process is only LOGGED (name + buttons) so a stuck run can be diagnosed.
#   * Exits when Revit exits or when the STOP file appears.
#
# ASCII-only on purpose (PowerShell 5.1 reads BOM-less files as ANSI).

param(
  [Parameter(Mandatory = $true)][int]$RevitPid,
  [Parameter(Mandatory = $true)][string]$Log,
  [Parameter(Mandatory = $true)][string]$Stop
)

Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$AE = [System.Windows.Automation.AutomationElement]
$Scope = [System.Windows.Automation.TreeScope]
$root = $AE::RootElement
$byPid = New-Object System.Windows.Automation.PropertyCondition($AE::ProcessIdProperty, $RevitPid)
$isWindow = New-Object System.Windows.Automation.PropertyCondition($AE::ControlTypeProperty, [System.Windows.Automation.ControlType]::Window)
$seen = @{}

function Write-Log($m) { Add-Content -Path $Log -Value ((Get-Date -Format 'HH:mm:ss') + ' ' + $m) -Encoding UTF8 }

function Get-Windows {
  $out = @()
  foreach ($w in $root.FindAll($Scope::Children, $byPid)) {
    $out += $w
    try { foreach ($c in $w.FindAll($Scope::Children, $isWindow)) { $out += $c } } catch { }
  }
  return $out
}

function Invoke-Named($w, $regex) {
  foreach ($e in $w.FindAll($Scope::Descendants, [System.Windows.Automation.Condition]::TrueCondition)) {
    $n = ''
    try { $n = $e.Current.Name } catch { continue }
    if ($n -notmatch $regex) { continue }
    $pat = $null
    if ($e.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$pat)) { $pat.Invoke(); return $n }
  }
  return $null
}

Write-Log "watching Revit PID $RevitPid"
while (-not (Test-Path $Stop)) {
  if (-not (Get-Process -Id $RevitPid -ErrorAction SilentlyContinue)) { Write-Log 'Revit exited'; break }
  try {
    foreach ($w in Get-Windows) {
      $name = ''
      try { $name = $w.Current.Name } catch { continue }
      if ($name -match 'Unsigned Add-In|Security - ') {
        $hit = Invoke-Named $w '^Always Load'
        if ($hit) { Write-Log "security dialog '$name' -> $hit" }
        continue
      }
      $key = $name + '|' + $w.Current.NativeWindowHandle
      if (-not $seen.ContainsKey($key)) {
        $seen[$key] = 1
        $buttons = @()
        try {
          $btnCond = New-Object System.Windows.Automation.PropertyCondition($AE::ControlTypeProperty, [System.Windows.Automation.ControlType]::Button)
          foreach ($b in $w.FindAll($Scope::Descendants, $btnCond)) { $buttons += $b.Current.Name }
        } catch { }
        Write-Log ("window '" + $name + "' buttons: " + (($buttons | Select-Object -First 12) -join ' | '))
      }
    }
  } catch { Write-Log ('watch error: ' + $_.Exception.Message) }
  Start-Sleep -Milliseconds 700
}
Write-Log 'watcher stopped'
