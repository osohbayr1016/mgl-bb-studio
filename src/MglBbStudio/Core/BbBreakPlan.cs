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
        public double X, Y, Half, Mask;
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

        /// <summary>Гараар тавьсан break line аль хэдийн энэ байрлалд байна уу (тал нь ижил, X <paramref name="tolX"/>, Y хэсгийн дотор).</summary>
        public static bool Covered(BbBreakSpot spot, IEnumerable<double[]> existingXY, double tolX)
        {
            foreach (double[] p in existingXY ?? Enumerable.Empty<double[]>())
                if (Math.Abs(p[0] - spot.X) <= tolX && Math.Abs(p[1] - spot.Y) <= Math.Max(spot.Half, tolX)) return true;
            return false;
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
