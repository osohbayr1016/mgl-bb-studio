using System;
using System.Collections.Generic;
using System.Linq;

namespace MglBb.Core
{
    /// <summary>Хучилтыг crop-ын ирмэг дээрх босоо шугамаар огтолсон хэсэг (харагдацын y, ямар ч нэгж).</summary>
    public struct BbYSpan
    {
        public double Lo, Hi;
        public BbYSpan(double lo, double hi) { Lo = Math.Min(lo, hi); Hi = Math.Max(lo, hi); }
        public double Mid { get { return (Lo + Hi) / 2; } }
        public double Half { get { return (Hi - Lo) / 2; } }
    }

    /// <summary>Нэг break line: харагдацын (X, Y) цэг, тал, left/right (= <see cref="Half"/>), masking.</summary>
    public sealed class BbBreakSpot
    {
        public bool Right;
        /// <summary>Crop-ын ДЭЭД / ДООД ирмэг (дэлгээсийн багана) — break line хэвтээ, <see cref="Half"/> нь X-ийн дагуу.</summary>
        public bool Top, Bottom;
        public double X, Y, Half, Mask;
        public bool Horizontal { get { return Top || Bottom; } }

        /// <summary>
        /// Family-ийн эргэлт (радиан, харагдацын хавтгайд): зүүн +90°, баруун −90° (ЖИШЭЭ-2 «Detail 241»-ийн 270°), дээд 0°, доод 180° — masking
        /// тал нь crop-ын гадагш.
        /// </summary>
        public double Angle { get { return Top ? 0 : Bottom ? Math.PI : Right ? -Math.PI / 2 : Math.PI / 2; } }
    }

    /// <summary>
    /// Огтлолын break line-ын байрлал (ЖИШЭЭ-2-ийн дамнурууны огтлолоос): crop-ын ирмэгийг дайрсан хучилт бүрд ирмэгээс <c>inset</c>-ээр дотогш,
    /// хучилтын зузааны голд нэг break line; left = right = зузааны хагас.  Давхцсан/шүргэлцсэн хучилт (B30 200 + B30 160) = нэг break line.
    /// </summary>
    public static class BbBreakPlan
    {
        /// <summary>Давхцсан эсвэл <paramref name="tol"/>-оос ойр хэсгүүдийг нэгтгэнэ (y-ээр эрэмбэлсэн).</summary>
        public static List<BbYSpan> Merge(IEnumerable<BbYSpan> spans, double tol)
        {
            var res = new List<BbYSpan>();
            foreach (BbYSpan s in (spans ?? Enumerable.Empty<BbYSpan>()).Where(s => s.Hi > s.Lo).OrderBy(s => s.Lo))
            {
                if (res.Count > 0 && s.Lo <= res[res.Count - 1].Hi + tol)
                {
                    BbYSpan last = res[res.Count - 1];
                    res[res.Count - 1] = new BbYSpan(last.Lo, Math.Max(last.Hi, s.Hi));
                }
                else res.Add(s);
            }
            return res;
        }

        /// <param name="x0">Crop-ын зүүн ирмэг.</param>
        /// <param name="x1">Crop-ын баруун ирмэг.</param>
        /// <param name="left">Зүүн ирмэг дээрх хучилтын хэсгүүд (нэгтгээгүй байж болно).</param>
        /// <param name="minThick">Үүнээс нимгэн хэсгийг (ирмэг шүргэсэн г.м.) алгасна.</param>
        public static List<BbBreakSpot> Spots(double x0, double x1, IEnumerable<BbYSpan> left, IEnumerable<BbYSpan> right,
            double inset, double mask, double minThick, double mergeTol)
        {
            var res = new List<BbBreakSpot>();
            foreach (BbYSpan s in Merge(left, mergeTol))
                if (s.Hi - s.Lo >= minThick) res.Add(new BbBreakSpot { Right = false, X = x0 + inset, Y = s.Mid, Half = s.Half, Mask = mask });
            foreach (BbYSpan s in Merge(right, mergeTol))
                if (s.Hi - s.Lo >= minThick) res.Add(new BbBreakSpot { Right = true, X = x1 - inset, Y = s.Mid, Half = s.Half, Mask = mask });
            return res;
        }

        /// <summary>
        /// Гараар тавьсан break line аль хэдийн энэ байрлалд байна уу: босоо (зүүн/баруун) — X <paramref name="tolX"/>, Y хэсгийн дотор; хэвтээ
        /// (дээд/доод) — Y <paramref name="tolX"/>, X хэсгийн дотор.
        /// </summary>
        public static bool Covered(BbBreakSpot spot, IEnumerable<double[]> existingXY, double tolX)
        {
            foreach (double[] p in existingXY ?? Enumerable.Empty<double[]>())
            {
                double across = spot.Horizontal ? Math.Abs(p[1] - spot.Y) : Math.Abs(p[0] - spot.X);
                double along = spot.Horizontal ? Math.Abs(p[0] - spot.X) : Math.Abs(p[1] - spot.Y);
                if (across <= tolX && along <= Math.Max(spot.Half, tolX)) return true;
            }
            return false;
        }

        /// <summary>
        /// Дэлгээсийн break line (crop-ын ирмэгийг дайрсан элементийн харагдацын хүрээгээр): зүүн/баруун ирмэг — дамнуруу (босоо break line, өндрийн
        /// голд, Half = өндрийн хагас), дээд/доод ирмэг — багана (хэвтээ, өргөний голд, Half = өргөний хагас).  Элемент ирмэгийн ДОТОР (break line-ын
        /// байр) ба ГАДНА (<paramref name="outside"/>) хоёуланд байвал л ирмэгийг дайрсан.  Хүрээ crop-оор хязгаарлагдана.
        /// </summary>
        /// <param name="beams">Дамнуруу бүрийн [x0, x1, y0, y1] (харагдацын).</param>
        /// <param name="columns">Багана бүрийн [x0, x1, y0, y1].</param>
        public static List<BbBreakSpot> ElevationSpots(double cx0, double cx1, double cy0, double cy1, IEnumerable<double[]> beams, IEnumerable<double[]> columns,
            double inset, double mask, double outside, double minThick, double mergeTol)
        {
            var left = new List<BbYSpan>();
            var right = new List<BbYSpan>();
            foreach (double[] b in beams ?? Enumerable.Empty<double[]>())
            {
                var ys = new BbYSpan(Math.Max(b[2], cy0), Math.Min(b[3], cy1));
                if (ys.Hi <= ys.Lo) continue;
                if (b[0] < cx0 - outside && b[1] > cx0 + inset) left.Add(ys);
                if (b[1] > cx1 + outside && b[0] < cx1 - inset) right.Add(ys);
            }
            List<BbBreakSpot> res = Spots(cx0, cx1, left, right, inset, mask, minThick, mergeTol);
            var top = new List<BbYSpan>();
            var bottom = new List<BbYSpan>();
            foreach (double[] c in columns ?? Enumerable.Empty<double[]>())
            {
                var xs = new BbYSpan(Math.Max(c[0], cx0), Math.Min(c[1], cx1));
                if (xs.Hi <= xs.Lo) continue;
                if (c[3] > cy1 + outside && c[2] < cy1 - inset) top.Add(xs);
                if (c[2] < cy0 - outside && c[3] > cy0 + inset) bottom.Add(xs);
            }
            foreach (BbYSpan s in Merge(top, mergeTol))
                if (s.Hi - s.Lo >= minThick) res.Add(new BbBreakSpot { Top = true, X = s.Mid, Y = cy1 - inset, Half = s.Half, Mask = mask });
            foreach (BbYSpan s in Merge(bottom, mergeTol))
                if (s.Hi - s.Lo >= minThick) res.Add(new BbBreakSpot { Bottom = true, X = s.Mid, Y = cy0 + inset, Half = s.Half, Mask = mask });
            return res;
        }

        /// <summary>Харагдацын масштабд хамгийн ойр «Scale Factor»-той төрөл (лог зайгаар: 1:20 → 25, 1:50 → 50).  Хоосон бол −1.</summary>
        public static int NearestScale(IList<double> factors, double viewScale)
        {
            int best = -1;
            double bd = double.MaxValue;
            for (int i = 0; i < factors.Count; i++)
            {
                if (factors[i] <= 0) continue;
                double d = Math.Abs(Math.Log(factors[i] / Math.Max(1, viewScale)));
                if (d < bd - 1e-9) { bd = d; best = i; }
            }
            return best;
        }
    }
}
