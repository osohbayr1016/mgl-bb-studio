using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Interop;
using System.Windows.Media.Imaging;

namespace RevitMcpAddin.Feedback
{
    /// <summary>
    /// Revit-ийн үндсэн цонхны дэлгэцийн зураг (хэрэглэгч ИЛ дарсан үед л) → PNG.
    /// System.Drawing ХЭРЭГЛЭХГҮЙ (net48 / net8 / net10 бүгдэд нэг код): Win32 BitBlt → HBITMAP → WPF BitmapSource → PngBitmapEncoder.
    /// Дэлгэцээс (screen DC) хуулдаг тул Revit-ийн DirectX зураглал ч гарна; дуудагч өөрийн цонхоо түр нуусан байх ёстой.
    /// ⚠️ Зураг нь дэлгэц дээр харагдаж буй бүхнийг агуулж болно — хэрэглэгч хавсаргахаас өмнө урьдчилан харж, хасаж болно.
    /// </summary>
    internal static class FeedbackScreenshot
    {
        public static string CaptureWindow(IntPtr hwnd, string directory)
        {
            if (hwnd == IntPtr.Zero) throw new InvalidOperationException("Revit-ийн цонх олдсонгүй");
            if (!GetWindowRect(hwnd, out RECT r)) throw new InvalidOperationException("Цонхны хэмжээг уншиж чадсангүй");
            int w = Math.Max(1, r.Right - r.Left), h = Math.Max(1, r.Bottom - r.Top);
            // Хэт том (8K олон дэлгэц) зураг 25 MiB-ийн хязгаараас хэтрэхээс сэргийлж хэмжээг барина.
            if ((long)w * h > 7680L * 4320L) throw new InvalidOperationException("Цонх хэт том — дэлгэцийн зургийг гараар хавсаргана уу");

            IntPtr screen = GetDC(IntPtr.Zero);
            IntPtr mem = CreateCompatibleDC(screen);
            IntPtr bmp = CreateCompatibleBitmap(screen, w, h);
            IntPtr old = SelectObject(mem, bmp);
            try
            {
                if (!BitBlt(mem, 0, 0, w, h, screen, r.Left, r.Top, SRCCOPY | CAPTUREBLT)) throw new InvalidOperationException("Дэлгэцийн зураг авч чадсангүй");
                SelectObject(mem, old);
                BitmapSource src = Imaging.CreateBitmapSourceFromHBitmap(bmp, IntPtr.Zero, Int32Rect.Empty, BitmapSizeOptions.FromEmptyOptions());
                Directory.CreateDirectory(directory);
                string path = Path.Combine(directory, "revit-" + DateTime.Now.ToString("yyyyMMdd-HHmmss") + ".png");
                var enc = new PngBitmapEncoder();
                enc.Frames.Add(BitmapFrame.Create(src));
                using (var fs = new FileStream(path, FileMode.CreateNew, FileAccess.Write)) enc.Save(fs);
                return path;
            }
            finally
            {
                DeleteObject(bmp);
                DeleteDC(mem);
                ReleaseDC(IntPtr.Zero, screen);
            }
        }

        private const int SRCCOPY = 0x00CC0020;
        private const int CAPTUREBLT = 0x40000000;

        [StructLayout(LayoutKind.Sequential)]
        private struct RECT { public int Left, Top, Right, Bottom; }

        [DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
        [DllImport("user32.dll")] private static extern IntPtr GetDC(IntPtr hWnd);
        [DllImport("user32.dll")] private static extern int ReleaseDC(IntPtr hWnd, IntPtr hDc);
        [DllImport("gdi32.dll")] private static extern IntPtr CreateCompatibleDC(IntPtr hdc);
        [DllImport("gdi32.dll")] private static extern IntPtr CreateCompatibleBitmap(IntPtr hdc, int w, int h);
        [DllImport("gdi32.dll")] private static extern IntPtr SelectObject(IntPtr hdc, IntPtr obj);
        [DllImport("gdi32.dll")] private static extern bool BitBlt(IntPtr dst, int x, int y, int w, int h, IntPtr src, int sx, int sy, int rop);
        [DllImport("gdi32.dll")] private static extern bool DeleteObject(IntPtr obj);
        [DllImport("gdi32.dll")] private static extern bool DeleteDC(IntPtr hdc);
    }
}
