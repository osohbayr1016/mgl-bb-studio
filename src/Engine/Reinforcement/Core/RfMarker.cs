using System;
using System.Collections.Generic;

namespace RevitMcpAddin.Reinforcement.Core
{
    /// <summary>
    /// Код-оор зурагдах (family-гүй) төгсгөлийн тэмдгийн хэлбэр.  Binary RFA файл ШААРДАХГҮЙ — төсөлд тохирох
    /// view-based annotation family байхгүй үед (эсвэл хэрэглэгч сонгоогүй үед) detail шугам/нумаар зурна.
    /// </summary>
    public enum RfMarkerStyle
    {
        /// <summary>Хоосон тойрог (хоёр хагас нум).</summary>
        Circle = 0,
        /// <summary>Загварлаг «×» — арматурын чиглэлд ±45°.</summary>
        Cross = 1,
        /// <summary>Нэг налуу зураас «/» — арматурын чиглэлд 45°.</summary>
        Slash = 2,
    }

    public enum RfPrimKind
    {
        Line = 0,
        Arc = 1,
    }

    /// <summary>Тэмдгийн нэг ЭЛЕМЕНТ (detail шугам эсвэл нум) — харагдацын 2D (u, v) координатад.</summary>
    public sealed class RfMarkerPrim
    {
        public RfPrimKind Kind;

        /// <summary>Line: эхлэл, төгсгөл.</summary>
        public RfV2 A, B;

        /// <summary>Arc: төв, радиус, эхлэх/төгсөх өнцөг (радиан, CCW, Start &lt; End, End − Start &lt; 2π).</summary>
        public RfV2 Center;
        public double Radius, StartAngle, EndAngle;

        /// <summary>Элементийн дунд цэг — тэмдгийн төвийг буцаан олоход (хоёр хагас нум ба шугамууд төвийн эсрэг талд).</summary>
        public RfV2 Mid
        {
            get
            {
                if (Kind == RfPrimKind.Line) return (A + B) * 0.5;
                double a = (StartAngle + EndAngle) / 2;
                return Center + new RfV2(Math.Cos(a), Math.Sin(a)) * Radius;
            }
        }
    }

    /// <summary>Код-оор зурагдах тэмдгийн ЦЭВЭР геометр + нэр/өнгө.</summary>
    public static class RfMarkerGeometry
    {
        public const double DefaultSizeMm = 3.0;
        public const double MinSizeMm = 0.5;
        public const double MaxSizeMm = 20.0;

        /// <summary>Өргөтгөсөн хадгалалтын талбарт (SymbolUid) бичигдэх угтвар — family-ийн UniqueId-аас ялгана.</summary>
        public const string TagPrefix = "mk:";

        /// <summary>Тэмдгийн ЦААСАН хэмжээ (мм, тойргийн диаметр / ×-ийн диагональ) → загварын радиус (фут), масштабаар.</summary>
        public static double RadiusFt(double sizeMm, int viewScale)
        {
            double mm = RfTol.Clamp(sizeMm, MinSizeMm, MaxSizeMm);
            int scale = viewScale > 0 ? viewScale : 100;
            return mm / 2.0 * scale / RfTol.MmPerFoot;
        }

        /// <summary>
        /// Тэмдгийн элементүүд.  <paramref name="rotationRad"/> = арматурын төгсгөлөөс ГАДАГШ чиглэлийн өнцөг
        /// (харагдацын 2D дахь CCW) — «×» ба «/» нь түүнтэй харьцангуй (ж: «/» = арматурыг 45°-аар огтолно).
        /// </summary>
        public static List<RfMarkerPrim> Build(RfMarkerStyle style, RfV2 center, double radius, double rotationRad)
        {
            var list = new List<RfMarkerPrim>();
            if (!(radius > 0) || !RfTol.IsFiniteNumber(radius)) return list;
            switch (style)
            {
                case RfMarkerStyle.Cross:
                    list.Add(Line(center, radius, rotationRad + Math.PI / 4));
                    list.Add(Line(center, radius, rotationRad - Math.PI / 4));
                    break;
                case RfMarkerStyle.Slash:
                    list.Add(Line(center, radius, rotationRad + Math.PI / 4));
                    break;
                default:
                    // Хоёр хагас нум: бүтэн тойрог (0…2π) нум Revit-ийн зарим хувилбарт хүлээн авагдахгүй байж болох тул.
                    // Эхлэх өнцгийг [0, 2π)-д хураана — Revit нум үүсгэхэд сөрөг/том өнцгөөс зайлсхийнэ.
                    double a0 = rotationRad % (2 * Math.PI);
                    if (a0 < 0) a0 += 2 * Math.PI;
                    // Хоёр дахь нумын эхлэл ч [0, 2π)-д (a0 + π нь 2π-ээс хэтэрч болох тул).
                    double a1 = a0 + Math.PI;
                    if (a1 >= 2 * Math.PI) a1 -= 2 * Math.PI;
                    list.Add(new RfMarkerPrim { Kind = RfPrimKind.Arc, Center = center, Radius = radius, StartAngle = a0, EndAngle = a0 + Math.PI });
                    list.Add(new RfMarkerPrim { Kind = RfPrimKind.Arc, Center = center, Radius = radius, StartAngle = a1, EndAngle = a1 + Math.PI });
                    break;
            }
            return list;
        }

        private static RfMarkerPrim Line(RfV2 c, double r, double angle)
        {
            RfV2 d = new RfV2(Math.Cos(angle), Math.Sin(angle)) * r;
            return new RfMarkerPrim { Kind = RfPrimKind.Line, A = c - d, B = c + d };
        }

        /// <summary>Тэмдгийн төв = элементүүдийн дунд цэгийн дундаж (хоёр хагас нум, ×-ийн хоёр шугам, / шугам бүгдэд ТӨВ).</summary>
        public static RfV2 CenterOf(IList<RfV2> partMids)
        {
            if (partMids == null || partMids.Count == 0) return new RfV2(0, 0);
            double x = 0, y = 0;
            foreach (RfV2 m in partMids)
            {
                x += m.X;
                y += m.Y;
            }
            return new RfV2(x / partMids.Count, y / partMids.Count);
        }

        public static string Code(RfMarkerStyle s)
        {
            switch (s)
            {
                case RfMarkerStyle.Cross: return "cross";
                case RfMarkerStyle.Slash: return "slash";
                default: return "circle";
            }
        }

        public static bool TryParse(string code, out RfMarkerStyle style)
        {
            style = RfMarkerStyle.Circle;
            if (string.IsNullOrEmpty(code)) return false;
            switch (code.Trim().ToLowerInvariant())
            {
                case "circle": style = RfMarkerStyle.Circle; return true;
                case "cross": style = RfMarkerStyle.Cross; return true;
                case "slash": style = RfMarkerStyle.Slash; return true;
            }
            return false;
        }

        /// <summary>Хадгалалтын тэмдэг: «mk:circle».</summary>
        public static string Tag(RfMarkerStyle s) { return TagPrefix + Code(s); }

        public static bool IsTag(string tag)
        {
            return !string.IsNullOrEmpty(tag) && tag.StartsWith(TagPrefix, StringComparison.Ordinal);
        }

        public static bool TryParseTag(string tag, out RfMarkerStyle style)
        {
            style = RfMarkerStyle.Circle;
            return IsTag(tag) && TryParse(tag.Substring(TagPrefix.Length), out style);
        }
    }
}
