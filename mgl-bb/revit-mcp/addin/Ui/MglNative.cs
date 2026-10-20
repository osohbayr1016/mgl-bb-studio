using System;
using System.Runtime.InteropServices;
using RevitMcpAddin.Ui.Core;

namespace RevitMcpAddin.Ui
{
    /// <summary>
    /// Эзэн (Revit) цонх ХАМГИЙН ӨМНӨ ямар дэлгэц дээр байгааг, тэр дэлгэцийн ажлын талбар, DPI-г олно.
    /// ⚠️ БҮХ P/Invoke нь try/catch-тай: хуучин Windows дээр entry point байхгүй байж болно — тэр үед
    /// аюулгүй анхдагч (null) буцаана, дуудагч `SystemParameters.WorkArea` руу унана.
    /// Pure геометр нь `Ui/Core/WindowFit.cs` (macOS дээр тестлэгддэг); энд ЗӨВХӨН Windows-ийн дуудлага.
    /// </summary>
    internal static class MglNative
    {
        private const uint MONITOR_DEFAULTTONEAREST = 2;
        private const int MDT_EFFECTIVE_DPI = 0;

        [StructLayout(LayoutKind.Sequential)]
        private struct RECT { public int Left, Top, Right, Bottom; }

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Auto)]
        private struct MONITORINFO
        {
            public int cbSize;
            public RECT rcMonitor;
            public RECT rcWork;
            public uint dwFlags;
        }

        [DllImport("user32.dll")] private static extern IntPtr MonitorFromWindow(IntPtr hwnd, uint flags);
        [DllImport("user32.dll", CharSet = CharSet.Auto)] private static extern bool GetMonitorInfo(IntPtr hMonitor, ref MONITORINFO lpmi);
        [DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
        [DllImport("shcore.dll")] private static extern int GetDpiForMonitor(IntPtr hmonitor, int dpiType, out uint dpiX, out uint dpiY);
        [DllImport("user32.dll")] private static extern uint GetDpiForSystem();
        [DllImport("user32.dll")] private static extern IntPtr GetThreadDpiAwarenessContext();
        [DllImport("user32.dll")] private static extern int GetAwarenessFromDpiAwarenessContext(IntPtr value);

        internal sealed class MonitorInfo
        {
            /// <summary>Ажлын талбар (таскбар хасагдсан) — DIP.</summary>
            public UiRect WorkAreaDip;
            /// <summary>Эзэн цонхны хил — DIP (олдохгүй бол null).</summary>
            public UiRect? OwnerDip;
            public double DpiScale;
        }

        /// <summary>Эзэн HWND-ийн дэлгэцийн мэдээлэл; амжилтгүй бол null.</summary>
        internal static MonitorInfo ForOwner(IntPtr ownerHwnd)
        {
            if (ownerHwnd == IntPtr.Zero) return null;
            try
            {
                IntPtr mon = MonitorFromWindow(ownerHwnd, MONITOR_DEFAULTTONEAREST);
                if (mon == IntPtr.Zero) return null;
                var mi = new MONITORINFO { cbSize = Marshal.SizeOf(typeof(MONITORINFO)) };
                if (!GetMonitorInfo(mon, ref mi)) return null;

                double scale = ScaleFor(mon);
                var workPx = new UiRect(mi.rcWork.Left, mi.rcWork.Top, mi.rcWork.Right - mi.rcWork.Left, mi.rcWork.Bottom - mi.rcWork.Top);
                var info = new MonitorInfo { DpiScale = scale, WorkAreaDip = UiRect.PixelsToDips(workPx, scale) };

                RECT wr;
                if (GetWindowRect(ownerHwnd, out wr) && wr.Right > wr.Left && wr.Bottom > wr.Top)
                    info.OwnerDip = UiRect.PixelsToDips(new UiRect(wr.Left, wr.Top, wr.Right - wr.Left, wr.Bottom - wr.Top), scale);
                return info;
            }
            catch
            {
                return null;
            }
        }

        /// <summary>
        /// px → DIP масштаб.  Процессын DPI-awareness-ээс хамаарна: unaware = 1; system-aware = системийн DPI;
        /// per-monitor = тэр дэлгэцийн DPI.  ⚠️ Revit-ийн процессын awareness энэ repo-д ТОДОРХОЙГҮЙ (live шалга).
        /// </summary>
        private static double ScaleFor(IntPtr monitor)
        {
            int awareness = -1;
            try { awareness = GetAwarenessFromDpiAwarenessContext(GetThreadDpiAwarenessContext()); } catch { /* Win10 1607-аас өмнө */ }

            try
            {
                if (awareness == 0) return 1.0;                       // DPI unaware — OS виртуалчилсан координат
                if (awareness == 2)
                {
                    uint dx, dy;
                    if (GetDpiForMonitor(monitor, MDT_EFFECTIVE_DPI, out dx, out dy) == 0 && dx > 0) return dx / 96.0;
                }
                uint sys = GetDpiForSystem();
                if (sys > 0) return sys / 96.0;
            }
            catch { /* доорх анхдагч */ }
            return 1.0;
        }
    }
}
