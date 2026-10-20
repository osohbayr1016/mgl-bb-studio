# Member Sheets live gate - dialog watcher for ONE Revit process (the one run-live.ps1 started).
# Copy of release-gate\room-plan\dialog-watch.ps1 with one difference, measured 2026-10-19 (Revit 2027.2):
# the "Security - Unsigned Add-In" command links expose NO UIA pattern (no Invoke, no LegacyIAccessible), so the
# room-plan watcher could not answer it and the gate waited forever.  Fallback: bring that dialog to the front and
# click "Load Once" at its UIA rectangle (cursor restored).  "Load Once" - the test DLL is never trusted permanently.
#
#   * Revit asks "Security - Unsigned Add-In" for the unsigned test add-in -> answers "Load Once" (only for that dialog).
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
Add-Type @"
using System; using System.Runtime.InteropServices;
public static class MsGateMouse {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out P p);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, int x, int y, uint d, UIntPtr e);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  public struct P { public int X; public int Y; }
}
"@
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
    # No pattern (Revit 2027 TaskDialog command link): click its rectangle, then put the cursor back.
    $r = $e.Current.BoundingRectangle
    if ($r.Width -le 0 -or $r.Height -le 0) { continue }
    $p = New-Object MsGateMouse+P
    [void][MsGateMouse]::GetCursorPos([ref]$p)
    try { [void][MsGateMouse]::SetForegroundWindow([IntPtr]$w.Current.NativeWindowHandle) } catch { }
    Start-Sleep -Milliseconds 150
    [void][MsGateMouse]::SetCursorPos([int]($r.X + $r.Width / 2), [int]($r.Y + $r.Height / 2))
    Start-Sleep -Milliseconds 60
    [MsGateMouse]::mouse_event(2, 0, 0, 0, [UIntPtr]::Zero)
    [MsGateMouse]::mouse_event(4, 0, 0, 0, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 60
    [void][MsGateMouse]::SetCursorPos($p.X, $p.Y)
    return ($n + ' (click)')
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
        $hit = Invoke-Named $w '^Load Once'
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
