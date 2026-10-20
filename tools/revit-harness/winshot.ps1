# Capture every top-level window of a process with PrintWindow (works for minimized-to-background, does not touch the user's screen).
param([Parameter(Mandatory = $true)][int]$ProcId, [Parameter(Mandatory = $true)][string]$OutDir)
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System; using System.Text; using System.Runtime.InteropServices; using System.Collections.Generic;
public static class WinShot {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc f, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint f);
  public struct RECT { public int L, T, R, B; }
  public static List<IntPtr> Of(uint pid) {
    var res = new List<IntPtr>();
    EnumWindows((h, l) => { uint p; GetWindowThreadProcessId(h, out p); if (p == pid && IsWindowVisible(h)) res.Add(h); return true; }, IntPtr.Zero);
    return res;
  }
  public static string Title(IntPtr h) { var sb = new StringBuilder(512); GetWindowText(h, sb, 512); return sb.ToString(); }
}
"@
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$i = 0
foreach ($h in [WinShot]::Of([uint32]$ProcId)) {
  $r = New-Object WinShot+RECT
  [void][WinShot]::GetWindowRect($h, [ref]$r)
  $w = $r.R - $r.L; $hh = $r.B - $r.T
  Write-Host ("{0} '{1}' {2}x{3} at {4},{5}" -f $i, [WinShot]::Title($h), $w, $hh, $r.L, $r.T)
  if ($w -le 0 -or $hh -le 0) { $i++; continue }
  $bmp = New-Object System.Drawing.Bitmap $w, $hh
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $hdc = $g.GetHdc()
  [void][WinShot]::PrintWindow($h, $hdc, 2)
  $g.ReleaseHdc($hdc); $g.Dispose()
  $bmp.Save((Join-Path $OutDir ("win$i.png")), [System.Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose()
  $i++
}
