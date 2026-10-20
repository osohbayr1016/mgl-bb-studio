# UI driver for the private harness Revit: waits for each "MGL ББ" window of the given process, captures it (PrintWindow),
# dumps its controls, then presses the button named in the step.  Steps are separated by '|'.  Optional per-step prefix:
#   "check:<label>=0/1;"  set a CheckBox before pressing,  "pick:<index>;" select ListBox item.
param(
  [Parameter(Mandatory = $true)][int]$RevitPid,
  [Parameter(Mandatory = $true)][string]$OutDir,
  [Parameter(Mandatory = $true)][string]$Steps,
  [int]$TimeoutSec = 600
)
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, System.Drawing
Add-Type @"
using System; using System.Runtime.InteropServices; using System.Text; using System.Collections.Generic;
public static class UiShot {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc f, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint f);
  public struct RECT { public int L, T, R, B; }
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  public static List<IntPtr> Titled(uint pid, string prefix) {
    var res = new List<IntPtr>();
    EnumWindows((h, l) => { uint p; GetWindowThreadProcessId(h, out p); if (p == pid && IsWindowVisible(h)) { var t = new StringBuilder(400); GetWindowText(h, t, 400); if (t.ToString().Contains(prefix)) res.Add(h); } return true; }, IntPtr.Zero);
    return res;
  }
}
"@
$AE = [System.Windows.Automation.AutomationElement]
$Scope = [System.Windows.Automation.TreeScope]
$root = $AE::RootElement
$byPid = New-Object System.Windows.Automation.PropertyCondition($AE::ProcessIdProperty, $RevitPid)
$isWindow = New-Object System.Windows.Automation.PropertyCondition($AE::ControlTypeProperty, [System.Windows.Automation.ControlType]::Window)
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$log = Join-Path $OutDir 'ui-drive.log'
function Log($m) { Add-Content -Path $log -Value ((Get-Date -Format 'HH:mm:ss') + ' ' + $m) -Encoding UTF8; Write-Host $m }

function Find-MglWindow($exclude) {
  foreach ($h in [UiShot]::Titled([uint32]$RevitPid, 'MGL ББ')) {
    if ($exclude.ContainsKey([string]$h)) { continue }
    try { return $AE::FromHandle($h) } catch { }
  }
  return $null
}

function Shot($w, $file) {
  $h = [IntPtr]$w.Current.NativeWindowHandle
  $r = New-Object UiShot+RECT
  [void][UiShot]::GetWindowRect($h, [ref]$r)
  $bw = $r.R - $r.L; $bh = $r.B - $r.T
  if ($bw -le 0 -or $bh -le 0) { return }
  $bmp = New-Object System.Drawing.Bitmap $bw, $bh
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $hdc = $g.GetHdc()
  [void][UiShot]::PrintWindow($h, $hdc, 2)
  $g.ReleaseHdc($hdc); $g.Dispose()
  $bmp.Save($file, [System.Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose()
}

$done = @{}
$i = 0
foreach ($step in $Steps.Split('|')) {
  $i++
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  $w = $null
  while ((Get-Date) -lt $deadline -and $w -eq $null) { Start-Sleep -Milliseconds 700; $w = Find-MglWindow $done }
  if ($w -eq $null) { Log "step $i TIMEOUT waiting for window"; exit 2 }
  Start-Sleep -Milliseconds 1200
  $title = $w.Current.Name
  Log "step $i window '$title'"
  Shot $w (Join-Path $OutDir ("ui-{0:00}.png" -f $i))
  $all = $w.FindAll($Scope::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
  foreach ($e in $all) {
    try {
      $ct = $e.Current.ControlType.ProgrammaticName -replace 'ControlType.', ''
      if ($ct -in @('Button', 'CheckBox', 'ComboBox', 'ListItem', 'Text', 'Edit', 'Hyperlink')) { Log ("   {0} '{1}'" -f $ct, ($e.Current.Name -replace "`r?`n", ' / ')) }
    } catch { }
  }
  $parts = $step.Split(';')
  $press = $parts[$parts.Length - 1]
  foreach ($p in $parts[0..($parts.Length - 2)]) {
    if ($p -like 'check:*') {
      $kv = $p.Substring(6).Split('='); $label = $kv[0]; $want = $kv[1] -eq '1'
      foreach ($e in $all) {
        if ($e.Current.ControlType -eq [System.Windows.Automation.ControlType]::CheckBox -and $e.Current.Name -like "$label*") {
          $tp = $e.GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern)
          $on = $tp.Current.ToggleState -eq [System.Windows.Automation.ToggleState]::On
          if ($on -ne $want) { $tp.Toggle() }
          Log "   set '$label' = $want"
        }
      }
    }
  }
  $hit = $false
  if ($press -like 'td:*') {
    # TaskDialog-ийн командын холбоос (UIA-д pane) — TDM_CLICK_BUTTON (WM_USER+102), id = 1001.. (CommandLink1..)
    [void][UiShot]::PostMessage([IntPtr]$w.Current.NativeWindowHandle, 0x466, [IntPtr][int]$press.Substring(3), [IntPtr]0)
    $hit = $true; Log "   td click $press"
  }
  foreach ($e in $all) {
    if ($hit) { break }
    if ($e.Current.ControlType -ne [System.Windows.Automation.ControlType]::Button) { continue }
    if ($e.Current.Name -ne $press) { continue }
    try { $e.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke(); $hit = $true; Log "   pressed '$press'" } catch { Log "   press failed $_" }
    break
  }
  if (-not $hit) { Log "   button '$press' not found" }
  $done[[string]$w.Current.NativeWindowHandle] = 1
}
Log 'done'
