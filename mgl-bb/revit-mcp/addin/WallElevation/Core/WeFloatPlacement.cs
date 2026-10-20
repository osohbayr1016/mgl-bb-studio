using System;

namespace RevitMcpAddin.WallElevation.Core
{
    /// <summary>
    /// Revit-ийн цонхонд хамаарах хөвөгч цонхны (үр дүнгийн хөтөч) байрлал — Revit-ийн ҮНДСЭН цонхны БАРУУН ДООД булангаас ХАРЬЦАНГУЙ санана.
    /// ХЭМЖСЭН (live gate 2026-10-16): абсолют дэлгэцийн байрлал Revit-ийн цонх жижиг (restored) байхад тооцогдож хадгалагдаад, Revit бүтэн
    /// дэлгэц болсны дараа зургийн талбайн ГОЛД гарч ирж, тэнд хийсэн товшилтыг (gate-ийн, хэрэглэгчийн) өөр рүүгээ авч байв.  Харьцангуй
    /// байрлал Revit-ийн цонхны хэмжээ, дэлгэц солигдоход дагана.  Бүх утга DIP: (left, top, width, height).
    /// </summary>
    public static class WeFloatPlacement
    {
        /// <summary>Анхдагч зай: Revit-ийн цонхны баруун захаас (Project Browser-ийг халхлахгүй) ба доод захаас.</summary>
        public const double RightMargin = 330, BottomMargin = 60;

        /// <summary>Анхдагч байрлал (left, top) — Revit-ийн цонхны баруун доод буланд, цонхноос гарахгүй.</summary>
        public static double[] Default(double ol, double ot, double ow, double oh, double w, double h)
        {
            return new[] { Math.Max(ol, ol + ow - w - RightMargin), Math.Max(ot, ot + oh - h - BottomMargin) };
        }

        /// <summary>Хадгалах утга: цонхны зүүн дээд булан Revit-ийн цонхны баруун/доод захаас хэр зайтай (dx, dy).</summary>
        public static double[] ToRelative(double ol, double ot, double ow, double oh, double left, double top)
        {
            return new[] { ol + ow - left, ot + oh - top };
        }

        /// <summary>Хадгалсан (dx, dy)-ээс одоогийн Revit-ийн цонхонд (left, top).</summary>
        public static double[] FromRelative(double ol, double ot, double ow, double oh, double dx, double dy)
        {
            return new[] { ol + ow - dx, ot + oh - dy };
        }

        /// <summary>
        /// Ажлын талбайд (таскбаргүй дэлгэц) бүтнээр багтаана; багтахгүй бол дээд/зүүн зах харагдана (гарчгийн мөрөөр чирж болохоор).
        /// </summary>
        public static double[] Clamp(double left, double top, double w, double h, double wl, double wt, double ww, double wh)
        {
            double x = Math.Max(wl, Math.Min(left, wl + ww - w));
            double y = Math.Max(wt, Math.Min(top, wt + wh - h));
            return new[] { x, y };
        }
    }
}
