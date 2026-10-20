using System;
using System.Collections.Generic;
using System.Linq;

namespace RevitMcpAddin.WallElevation.Core
{
    /// <summary>
    /// Тавилгын харагдах геометрийн ПЛАН дахь гүдгэр бүрхүүл (2026-10-14, эзэн: «тавилгын хэмжээсийг ЗӨВ тавь»).
    /// Цэвэр — Revit тал зөвхөн цэгүүдийг цуглуулна (<see cref="WeTaggable.Hull"/>).
    /// </summary>
    public static class WeHull
    {
        /// <summary>Ижил цэгийг нэгтгэх алхам (фут) — 0.03 мм; бүрхүүлийн оройн тоог бууруулна, байрлалд нөлөөлөхгүй.</summary>
        private const double Grid = 1e-4;

        /// <summary>XY гүдгэр бүрхүүл (цагийн зүүний эсрэг, давхардалгүй).  Цэг 0 → хоосон; 1–2 цэг → тэр цэгүүд.</summary>
        public static List<WeV3> Convex(IEnumerable<WeV3> points)
        {
            var pts = new List<WeV3>();
            var seen = new HashSet<long>();
            foreach (WeV3 p in points ?? Enumerable.Empty<WeV3>())
            {
                if (double.IsNaN(p.X) || double.IsNaN(p.Y) || double.IsInfinity(p.X) || double.IsInfinity(p.Y)) continue;
                long kx = (long)Math.Round(p.X / Grid), ky = (long)Math.Round(p.Y / Grid);
                if (!seen.Add(kx * 73856093L ^ ky * 19349663L)) continue;
                pts.Add(new WeV3(kx * Grid, ky * Grid, 0));
            }
            if (pts.Count < 3) return pts;
            pts.Sort((a, b) => a.X != b.X ? a.X.CompareTo(b.X) : a.Y.CompareTo(b.Y));
            var hull = new List<WeV3>(pts.Count + 1);
            // Andrew-ийн monotone chain: доод, дараа нь дээд хагас.
            for (int pass = 0; pass < 2; pass++)
            {
                int start = hull.Count;
                for (int i = 0; i < pts.Count; i++)
                {
                    WeV3 p = pass == 0 ? pts[i] : pts[pts.Count - 1 - i];
                    while (hull.Count >= start + 2 && Cross(hull[hull.Count - 2], hull[hull.Count - 1], p) <= 0) hull.RemoveAt(hull.Count - 1);
                    hull.Add(p);
                }
                hull.RemoveAt(hull.Count - 1);
            }
            return hull.Count >= 1 ? hull : pts;
        }

        private static double Cross(WeV3 o, WeV3 a, WeV3 b)
        {
            return (a.X - o.X) * (b.Y - o.Y) - (a.Y - o.Y) * (b.X - o.X);
        }
    }
}
