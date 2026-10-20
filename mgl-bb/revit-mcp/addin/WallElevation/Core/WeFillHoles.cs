using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;

namespace RevitMcpAddin.WallElevation.Core
{
    /// <summary>
    /// Түлхүүр планы өрөөний дүүргэлтийг шошго / маркерын доороос нүхлэх хайрцгууд — ТОГТМОЛ дараалал ба тэмдэг.
    /// ХЭМЖСЭН (live gate 2026-10-16, PRESET-KEEP-B102): эхний ажиллуулалт «(өрөө − шошго) − маркер» (маркер дэлгээсийн дараа үүсдэг тул хоёр
    /// алхам), дахин ажиллуулалт «өрөө − (шошго, маркер)» (маркер аль хэдийн бий) — талбай ижил ч Boolean-ийн хилийн сегмент 12 ↔ 13 болж
    /// дахин ажиллуулалт бүрт «өөрчлөгдсөн» гэж харагдав.  Тиймээс дүүргэлтийг ҮРГЭЛЖ анхны өрөөний хилээс, энэ эрэмбээр нэг алхмаар
    /// хасна; хайрцгийн тэмдэг ижил бол дахин зурахгүй.  Хайрцаг = {x0, y0, x1, y1} (фут, план XY, зайгүй).
    /// </summary>
    public static class WeFillHoles
    {
        /// <summary>Тэмдэгт тулгах нарийвчлал (фут, ≈ 0.3 мм) — Revit-ийн bounding box-ийн дугуйлалтын шуугиан.</summary>
        public const double Grid = 1e-3;

        /// <summary>Хоосон / буруу хайрцгийг хасаж, ижилийг нэг болгож, (x0, y0, x1, y1)-ээр эрэмбэлнэ — дуудах дарааллаас үл хамаарна.</summary>
        public static List<double[]> Sorted(IEnumerable<double[]> rects)
        {
            var list = new List<double[]>();
            var seen = new HashSet<string>(StringComparer.Ordinal);
            if (rects == null) return list;
            foreach (double[] r in rects)
            {
                if (r == null || r.Length < 4) continue;
                double x0 = Math.Min(r[0], r[2]), x1 = Math.Max(r[0], r[2]), y0 = Math.Min(r[1], r[3]), y1 = Math.Max(r[1], r[3]);
                if (double.IsNaN(x0 + x1 + y0 + y1) || x1 - x0 < Grid || y1 - y0 < Grid) continue;
                var n = new[] { x0, y0, x1, y1 };
                if (seen.Add(Key(n))) list.Add(n);
            }
            return list.OrderBy(q => Snap(q[0])).ThenBy(q => Snap(q[1])).ThenBy(q => Snap(q[2])).ThenBy(q => Snap(q[3])).ToList();
        }

        /// <summary>Хайрцгийн олонлогийн тэмдэг (эрэмбэлсэн, <see cref="Grid"/>-ээр) — ижил бол дүүргэлтийн хил ижил гарна.</summary>
        public static string Signature(IEnumerable<double[]> rects)
        {
            return string.Join(";", Sorted(rects).Select(Key));
        }

        private static long Snap(double v) { return (long)Math.Round(v / Grid); }

        private static string Key(double[] r)
        {
            return string.Join(",", r.Take(4).Select(v => Snap(v).ToString(CultureInfo.InvariantCulture)));
        }
    }
}
