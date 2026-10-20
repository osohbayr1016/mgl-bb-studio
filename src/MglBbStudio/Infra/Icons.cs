using System;
using System.Globalization;
using System.Windows;
using System.Windows.Media;
using System.Windows.Media.Imaging;

namespace MglBb.Infra
{
    /// <summary>Ribbon-ы дүрс: бараан-хөх дөрвөлжин дээр нэг үсэг (файлгүй — DLL дотор зурна).  «MGL ББ» табын товчнууд нэг загвартай.</summary>
    internal static class Icons
    {
        private static readonly Color Back = Color.FromRgb(0x1F, 0x38, 0x64);
        private static readonly Color Accent = Color.FromRgb(0xE0, 0x8A, 0x1E);

        public static BitmapSource Glyph(string text, int size)
        {
            try
            {
                var dv = new DrawingVisual();
                using (DrawingContext dc = dv.RenderOpen())
                {
                    double r = size * 0.18;
                    dc.DrawRoundedRectangle(new SolidColorBrush(Back), null, new Rect(0.5, 0.5, size - 1, size - 1), r, r);
                    dc.DrawRectangle(new SolidColorBrush(Accent), null, new Rect(size * 0.12, size * 0.80, size * 0.76, Math.Max(1, size * 0.07)));
                    var ft = new FormattedText(text ?? "", CultureInfo.InvariantCulture, FlowDirection.LeftToRight,
                        new Typeface(new FontFamily("Segoe UI"), FontStyles.Normal, FontWeights.Bold, FontStretches.Normal), size * 0.58, Brushes.White, 1.0);
                    dc.DrawText(ft, new Point((size - ft.Width) / 2, (size * 0.86 - ft.Height) / 2));
                }
                var bmp = new RenderTargetBitmap(size, size, 96, 96, PixelFormats.Pbgra32);
                bmp.Render(dv);
                bmp.Freeze();
                return bmp;
            }
            catch
            {
                return null;
            }
        }
    }
}
