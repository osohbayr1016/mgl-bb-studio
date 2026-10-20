using System;

namespace RevitMcpAddin.Ui.Core
{
    // ══════════════════════════════════════════════════════════════════════════
    //  Цонхны хэмжээ/байрлалыг ЭЗЭН Revit-ийн ДЭЛГЭЦИЙН ажлын талбарт тохируулах ЦЭВЭР геометр.
    //
    //  Өмнөх `RfUi.Setup` нь ЗӨВХӨН үндсэн дэлгэцийн `SystemParameters.WorkArea`-г хэрэглэж,
    //  `Left/Top`-г огт хязгаарладаггүй, `App.ShowOwned` дараа нь эзэн дээр дахин төвлөрүүлдэг
    //  байсан (олон дэлгэц, 125–200 % масштабт цонх хальж болзошгүй).  Энд бүх тооцоо DIP-ээр,
    //  ЦЭВЭР: WPF/Revit хамааралгүй тул macOS дээр `MglUi.Tests` шалгана.
    // ══════════════════════════════════════════════════════════════════════════

    public struct UiRect
    {
        public double Left;
        public double Top;
        public double Width;
        public double Height;

        public UiRect(double left, double top, double width, double height)
        {
            Left = left; Top = top; Width = width; Height = height;
        }

        public double Right { get { return Left + Width; } }
        public double Bottom { get { return Top + Height; } }

        /// <summary>Хоёр тэгш өнцөгтийн огтлолцлын (өргөн, өндөр); огтлолцохгүй бол (0, 0).</summary>
        public static void OverlapSize(UiRect a, UiRect b, out double w, out double h)
        {
            w = Math.Min(a.Right, b.Right) - Math.Max(a.Left, b.Left);
            h = Math.Min(a.Bottom, b.Bottom) - Math.Max(a.Top, b.Top);
            if (w < 0) w = 0;
            if (h < 0) h = 0;
        }

        /// <summary>Физик пиксельийг DIP болгоно (dpiScale = DPI / 96).</summary>
        public static UiRect PixelsToDips(UiRect px, double dpiScale)
        {
            double s = dpiScale > 0.0 ? dpiScale : 1.0;
            return new UiRect(px.Left / s, px.Top / s, px.Width / s, px.Height / s);
        }
    }

    public sealed class FitRequest
    {
        public double DesiredWidth;
        public double DesiredHeight;
        public double MinWidth;
        public double MinHeight;

        /// <summary>Цонх гарах дэлгэцийн ажлын талбар (DIP) — Revit-ийн үндсэн цонх байгаа дэлгэц.</summary>
        public UiRect WorkArea;

        /// <summary>Эзэн (Revit) цонхны хил (DIP); null бол ажлын талбарын төв.</summary>
        public UiRect? Owner;

        /// <summary>Өмнө хадгалсан хил (DIP); null эсвэл ашиглах боломжгүй бол үл тооно.</summary>
        public UiRect? Saved;
    }

    public sealed class FitResult
    {
        public double Left;
        public double Top;
        public double Width;
        public double Height;
        public double MinWidth;
        public double MinHeight;
        public double MaxWidth;
        public double MaxHeight;
        public bool Centered;
        public bool UsedSaved;
    }

    public static class WindowFit
    {
        /// <summary>Хадгалсан хил дор хаяж энэ хэмжээгээр харагдахгүй бол «дэлгэц салгасан» гэж үзнэ.</summary>
        public const double MinVisibleWidth = 120.0;
        public const double MinVisibleHeight = 80.0;

        public static FitResult Compute(FitRequest r)
        {
            if (r == null) throw new ArgumentNullException("r");
            UiRect wa = r.WorkArea;
            if (wa.Width <= 0 || wa.Height <= 0)
                wa = new UiRect(0, 0, 1280, 720);   // мэдэгдэхгүй бол аюулгүй анхдагч

            // Хэмжээ: ХЭЗЭЭ Ч ажлын талбараас том биш; доод хязгаар ч мөн (WPF MinWidth-ийг ямар ч дэлгэц дээр албадна).
            double minW = Math.Min(Math.Max(0, r.MinWidth), wa.Width);
            double minH = Math.Min(Math.Max(0, r.MinHeight), wa.Height);

            double wantW = r.DesiredWidth;
            double wantH = r.DesiredHeight;
            bool useSaved = false;

            UiRect saved = default(UiRect);
            if (r.Saved.HasValue && IsUsable(r.Saved.Value, wa))
            {
                saved = r.Saved.Value;
                wantW = saved.Width;
                wantH = saved.Height;
                useSaved = true;
            }

            double w = Clamp(wantW, minW, wa.Width);
            double h = Clamp(wantH, minH, wa.Height);

            double left, top;
            bool centered;
            if (useSaved)
            {
                left = saved.Left;
                top = saved.Top;
                centered = false;
            }
            else if (r.Owner.HasValue && r.Owner.Value.Width > 0 && r.Owner.Value.Height > 0)
            {
                UiRect o = r.Owner.Value;
                left = o.Left + (o.Width - w) / 2.0;
                top = o.Top + (o.Height - h) / 2.0;
                centered = true;
            }
            else
            {
                left = wa.Left + (wa.Width - w) / 2.0;
                top = wa.Top + (wa.Height - h) / 2.0;
                centered = true;
            }

            // Цонх бүхэлдээ ажлын талбар дотор байх ёстой.
            left = Clamp(left, wa.Left, Math.Max(wa.Left, wa.Right - w));
            top = Clamp(top, wa.Top, Math.Max(wa.Top, wa.Bottom - h));

            return new FitResult
            {
                Left = left,
                Top = top,
                Width = w,
                Height = h,
                MinWidth = minW,
                MinHeight = minH,
                MaxWidth = wa.Width,
                MaxHeight = wa.Height,
                Centered = centered,
                UsedSaved = useSaved,
            };
        }

        /// <summary>Хадгалсан хил хүчинтэй эсэх: NaN/сөрөг биш, мөн ажлын талбартай хангалттай огтлолцдог.</summary>
        public static bool IsUsable(UiRect saved, UiRect workArea)
        {
            if (IsBad(saved.Left) || IsBad(saved.Top) || IsBad(saved.Width) || IsBad(saved.Height)) return false;
            if (saved.Width < 100 || saved.Height < 60) return false;
            double ow, oh;
            UiRect.OverlapSize(saved, workArea, out ow, out oh);
            return ow >= MinVisibleWidth && oh >= MinVisibleHeight;
        }

        private static bool IsBad(double v)
        {
            return double.IsNaN(v) || double.IsInfinity(v);
        }

        private static double Clamp(double v, double lo, double hi)
        {
            if (hi < lo) hi = lo;
            if (v < lo) return lo;
            if (v > hi) return hi;
            return v;
        }
    }
}
