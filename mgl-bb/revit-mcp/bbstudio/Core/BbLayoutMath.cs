using System;
using System.Collections.Generic;
using System.Linq;

namespace MglBb.Core
{
    /// <summary>Тэнхлэгийн дагуух нэг муж (загварын мм).</summary>
    public struct BbSpan
    {
        public double A, B;
        public BbSpan(double a, double b) { A = Math.Min(a, b); B = Math.Max(a, b); }
        public double Length { get { return B - A; } }
        public double Mid { get { return (A + B) / 2; } }
        public override string ToString() { return A.ToString("0") + ".." + B.ToString("0"); }
    }

    /// <summary>
    /// Дамнурууны дэлгээс/огтлолын байрлалын ЦЭВЭР тооцоо (Revit-гүй, тесттэй).  Бүх утга гишүүний тэнхлэгийн дагуух координат, загварын мм:
    /// 0 = гинжийн эхлэл.  Тулгуур = гинжийг дайрсан баганы (эсвэл хананы) муж.
    /// </summary>
    public static class BbLayoutMath
    {
        /// <summary>Тулгуурын хоорондох цэвэр алгасалууд (тулгуурын нүүрээс нүүр хүртэл).  Тулгуургүй бол бүх урт нэг алгасал.</summary>
        public static List<BbSpan> ClearSpans(BbSpan member, IEnumerable<BbSpan> supports)
        {
            var sup = (supports ?? Enumerable.Empty<BbSpan>())
                .Where(s => s.B > member.A - 1 && s.A < member.B + 1)
                .OrderBy(s => s.A)
                .ToList();
            // давхцсан тулгуурыг нэгтгэнэ
            var merged = new List<BbSpan>();
            foreach (BbSpan s in sup)
            {
                if (merged.Count > 0 && s.A <= merged[merged.Count - 1].B + 1)
                {
                    BbSpan last = merged[merged.Count - 1];
                    merged[merged.Count - 1] = new BbSpan(last.A, Math.Max(last.B, s.B));
                }
                else merged.Add(s);
            }
            var spans = new List<BbSpan>();
            double cur = member.A;
            foreach (BbSpan s in merged)
            {
                if (s.A > cur + 1) spans.Add(new BbSpan(cur, Math.Min(s.A, member.B)));
                cur = Math.Max(cur, s.B);
            }
            if (member.B > cur + 1) spans.Add(new BbSpan(cur, member.B));
            return spans.Where(s => s.Length > 50).ToList();
        }

        /// <summary>
        /// Огтлолын байрлал: алгасал бүрд (тулгуурын ойролцоо 2 + дунд 1), тулгуурын нүүрнээс <paramref name="supportOffsetMm"/> (≤ 0 бол
        /// алгасал × <paramref name="supportRatio"/>).  <paramref name="minGapMm"/>-ээс ойр хоёр огтлолыг нэгтгэнэ.  Эрэмбэтэй.
        /// Консол (нэг тал нь тулгуургүй) алгасалд чөлөөт үзүүрийн огтлол тавихгүй — зөвхөн тулгуурын ойролцоо.
        /// </summary>
        public static List<double> SectionStations(BbSpan member, IList<BbSpan> spans, IEnumerable<BbSpan> supports, double supportOffsetMm,
            double supportRatio, bool atSupports, bool atMid, double minGapMm, bool rightOnlyLast = false)
        {
            var sup = (supports ?? Enumerable.Empty<BbSpan>()).ToList();
            var res = new List<double>();
            for (int si = 0; si < spans.Count; si++)
            {
                BbSpan s = spans[si];
                bool leftSupported = sup.Any(x => Math.Abs(x.B - s.A) < 5);
                bool rightSupported = sup.Any(x => Math.Abs(x.A - s.B) < 5);
                double off = supportOffsetMm > 0 ? supportOffsetMm : s.Length * Math.Max(0.05, Math.Min(0.45, supportRatio));
                off = Math.Min(off, s.Length / 3);
                if (atSupports && leftSupported) res.Add(s.A + off);
                if (atMid || (!leftSupported && !rightSupported)) res.Add(s.Mid);
                // Инженерийн дадал (ЖИШЭЭ-1, ДН-1): алгасал бүрд ЗҮҮН тулгуур + дунд, баруун тулгуурынх зөвхөн СҮҮЛИЙН алгасалд
                // (тулгуур дээгүүр үргэлжлэх дээд арматур дараагийн алгасалын зүүн огтлолд аль хэдийн харагдана).
                if (atSupports && rightSupported && (!rightOnlyLast || si == spans.Count - 1)) res.Add(s.B - off);
            }
            res.Sort();
            var outList = new List<double>();
            foreach (double x in res)
            {
                if (x < member.A || x > member.B) continue;
                if (outList.Count > 0 && x - outList[outList.Count - 1] < minGapMm) continue;
                outList.Add(x);
            }
            return outList;
        }

        /// <summary>
        /// Урт дэлгээсийг хэсгүүдэд хуваана: хэсэг бүр ≤ <paramref name="maxLenMm"/> (загварын мм), хуваах цэгийг тулгуурын голд (эсвэл
        /// хамгийн ойр тулгуурт) тавина — дамнуруу баганын дундуур таслагдана (жишээ зурагтай адил).  Хэсгүүд <paramref name="overlapMm"/>-ээр давхцана.
        /// </summary>
        public static List<BbSpan> SplitParts(BbSpan extent, IEnumerable<BbSpan> supports, double maxLenMm, double overlapMm)
        {
            var parts = new List<BbSpan>();
            if (maxLenMm <= 0 || extent.Length <= maxLenMm) { parts.Add(extent); return parts; }
            int n = (int)Math.Ceiling(extent.Length / maxLenMm);
            var cuts = new List<double>();
            var mids = (supports ?? Enumerable.Empty<BbSpan>()).Select(s => s.Mid).Where(m => m > extent.A && m < extent.B).OrderBy(m => m).ToList();
            for (int i = 1; i < n; i++)
            {
                double ideal = extent.A + extent.Length * i / n;
                double best = ideal;
                if (mids.Count > 0)
                {
                    double near = mids.OrderBy(m => Math.Abs(m - ideal)).First();
                    // тулгуур ойролцоо (хэсгийн урт 25 %-аас ихгүй зөрвөл) — тулгуураар хуваана
                    if (Math.Abs(near - ideal) < extent.Length / n * 0.25) best = near;
                }
                cuts.Add(best);
            }
            double a = extent.A;
            foreach (double c in cuts)
            {
                parts.Add(new BbSpan(a, Math.Min(extent.B, c + overlapMm / 2)));
                a = Math.Max(extent.A, c - overlapMm / 2);
            }
            parts.Add(new BbSpan(a, extent.B));
            return parts;
        }
    }
}
