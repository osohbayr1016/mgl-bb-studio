# Restore the harness Revit main window OFF-SCREEN without activating it (owned WPF dialogs are hidden while the owner is minimized).
param([Parameter(Mandatory = $true)][int]$ProcId, [int]$X = -4200, [int]$Y = 0)
Add-Type @"
using System; using System.Runtime.InteropServices; using System.Text; using System.Collections.Generic;
public static class OffWin {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc f, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr h, uint cmd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint f);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  public static List<IntPtr> Of(uint pid) {
    var res = new List<IntPtr>();
    EnumWindows((h, l) => { uint p; GetWindowThreadProcessId(h, out p); if (p == pid && GetWindow(h, 4) == IntPtr.Zero) res.Add(h); return true; }, IntPtr.Zero);
    return res;
  }
  public static string Title(IntPtr h) { var sb = new StringBuilder(512); GetWindowText(h, sb, 512); return sb.ToString(); }
}
"@
foreach ($h in [OffWin]::Of([uint32]$ProcId)) {
  $t = [OffWin]::Title($h)
  if ($t -notlike 'Autodesk Revit*') { continue }
  # SWP_NOACTIVATE 0x10 | SWP_NOZORDER 0x4 | SWP_NOSIZE 0x1
  [void][OffWin]::SetWindowPos($h, [IntPtr]::Zero, $X, $Y, 0, 0, 0x15)
  [void][OffWin]::ShowWindow($h, 4)   # SW_SHOWNOACTIVATE
  [void][OffWin]::SetWindowPos($h, [IntPtr]::Zero, $X, $Y, 0, 0, 0x15)
  Write-Host ("restored off-screen: '{0}' visible={1}" -f $t, [OffWin]::IsWindowVisible($h))
}
# Move every other visible window of the process (owned dialogs) off-screen too.
foreach ($h in [OffWin]::Of([uint32]$ProcId)) { }
