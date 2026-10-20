using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;

namespace RevitMcpAddin.WallElevation.Core
{
    /// <summary>
    /// «+ Хана нэмэх» (2026-10-14, интерьерийн баг: «хана нэмэх дээр дарахад хуудас руу шилжих биш, цонхон дотроо шинэ үсэг гарч ирээд
    /// хэмжээгээ өөрсдөө тохируулаад ханын дэлгээсээ үүсгэнэ»): өрөөний НЭМЭЛТ ТАЛ — хэрэглэгчийн план засварлагч дээр зурсан/чирсэн зүсэх шугам.
    /// <list type="bullet">
    /// <item>Түлхүүр «v1|room:&lt;өрөө&gt;|wall:|side:extra-N» — ханаас үл хамаарах (шугамаа хаа ч чирсэн ч тэр дэлгээс).</item>
    /// <item>Шугам нь дэлгээсийн тохируулга (<see cref="WeSideOverride"/>) — цонхонд <see cref="WeSettings.Overrides"/>, үүссэн харагдац дээр
    /// Extensible Storage-д → дахин ажиллуулахад тэндээс (нэмэлт тал санагдана).</item>
    /// <item>Үсэг өрөөний бусад талын ДАРАА (E, F …), бусад нь өрөөний тал шиг (хуудас, түлхүүр план, маркер, тэмдэглэгээ).</item>
    /// </list>
    /// </summary>
    public static class WeExtraSides
    {
        private const string SidePrefix = "extra-";

        public static string Key(string roomUid, string id)
        {
            return WeIdentity.Key(roomUid, string.Empty, SidePrefix + id);
        }

        public static bool IsExtraKey(string key)
        {
            return key != null && key.IndexOf("|side:" + SidePrefix, StringComparison.Ordinal) >= 0;
        }

        /// <summary>Түлхүүрийн нэмэлт талын дугаар («3»); нэмэлт тал биш бол null.</summary>
        public static string IdOf(string key)
        {
            if (!IsExtraKey(key)) return null;
            int i = key.IndexOf("|side:" + SidePrefix, StringComparison.Ordinal) + ("|side:" + SidePrefix).Length;
            int j = key.IndexOf('|', i);
            return j < 0 ? key.Substring(i) : key.Substring(i, j - i);
        }

        /// <summary>Өрөөнд хэрэглэгдээгүй дараагийн дугаар (устгасан ч давхцахгүй — хамгийн их + 1).</summary>
        public static string NextId(IEnumerable<string> usedIds)
        {
            int max = 0;
            if (usedIds != null)
                foreach (string s in usedIds)
                {
                    int n;
                    if (int.TryParse(s, NumberStyles.None, CultureInfo.InvariantCulture, out n) && n > max) max = n;
                }
            return (max + 1).ToString(CultureInfo.InvariantCulture);
        }

        /// <summary>
        /// Шинэ нэмэлт талын анхны шугам: сонгосон талын гадаргуу дээр, ТӨВД нь, уртын ХАГАС (ижил харах чиглэл) — тэр тал дээрээ тодорч
        /// харагдах ба үзүүрийг чирж хүссэн хэмжээнд хүргэнэ.
        /// </summary>
        public static WeSideOverride InitialLine(WeV3 a, WeV3 b, WeV3 look)
        {
            WeV3 m = ((a + b) * 0.5).Flat(), q = ((b - a) * 0.25).Flat();
            return WeSideOverride.Line(m - q, m + q, look);
        }

        /// <summary>
        /// Цонхны «+ Хана нэмэх»-ийн анхны шугам: <see cref="InitialLine(WeV3, WeV3, WeV3)"/>-ийг өрөө рүү (харах чиглэлийн эсрэг) өрөөний гүний
        /// гуравны нэгээр (300–1200 мм) оруулна — сонгосон талын шугам, үсэгтэй давхцахгүй, план дээр шинэ үсэг тусдаа харагдана; ижил хана руу харна.
        /// Өрөөний хил өгөөгүй/олдохгүй бол тал дээрээ.
        /// </summary>
        public static WeSideOverride InitialLine(WeV3 a, WeV3 b, WeV3 look, IList<List<WeV3>> outline)
        {
            WeSideOverride l = InitialLine(a, b, look);
            if (l == null || !l.IsValid || outline == null) return l;
            WeV3 back = -l.Look;
            WeV3 m = (l.A + l.B) * 0.5;
            double depth = double.MaxValue;
            foreach (List<WeV3> loop in outline)
            {
                if (loop == null || loop.Count < 2) continue;
                for (int i = 0; i < loop.Count; i++)
                {
                    double s = Forward(m, back, loop[i].Flat(), loop[(i + 1) % loop.Count].Flat());
                    if (s < depth) depth = s;
                }
            }
            if (depth == double.MaxValue) return l;
            double off = Math.Max(MinOffset, Math.Min(MaxOffset, depth / 3));
            if (off > depth * 0.8) off = depth / 2;
            WeV3 d = back * off;
            return WeSideOverride.Line(l.A + d, l.B + d, l.Look);
        }

        /// <summary>300 / 1200 мм (фут) — анхны шугамыг өрөө рүү оруулах зай.</summary>
        private const double MinOffset = 300 / 304.8, MaxOffset = 1200 / 304.8;

        /// <summary>Цацраг p + n·s (s &gt; 1 мм — эхлэх хил өөрөө биш) ба AB хэрчим; байхгүй бол MaxValue.</summary>
        private static double Forward(WeV3 p, WeV3 n, WeV3 a, WeV3 b)
        {
            WeV3 e = b - a;
            double denom = n.X * e.Y - n.Y * e.X;
            if (Math.Abs(denom) < 1e-12) return double.MaxValue;
            WeV3 ap = a - p;
            double s = (ap.X * e.Y - ap.Y * e.X) / denom;
            double u = (ap.X * n.Y - ap.Y * n.X) / denom;
            if (s <= 0.0033 || u < -1e-9 || u > 1 + 1e-9) return double.MaxValue;
            return s;
        }

        /// <summary>Өрөөний хүрээний төвөөр хэвтээ шугам (өрөөний өргөний хагас), хойд тийш харна — талгүй өрөөнд.</summary>
        public static WeSideOverride InitialLine(IList<List<WeV3>> outline)
        {
            List<WeV3> pts = outline != null ? outline.SelectMany(l => l).ToList() : new List<WeV3>();
            if (pts.Count == 0) return null;
            double x0 = pts.Min(p => p.X), x1 = pts.Max(p => p.X), y0 = pts.Min(p => p.Y), y1 = pts.Max(p => p.Y);
            double cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, q = (x1 - x0) / 4;
            if (q <= 1e-3) return null;
            return WeSideOverride.Line(new WeV3(cx - q, cy, 0), new WeV3(cx + q, cy, 0), new WeV3(0, 1, 0));
        }

        /// <summary>
        /// Шугамын АРД (харах чиглэлд) байгаа өрөөний хилийн хана — шугамын 5 цэгээс харах чиглэлд цацраг, хамгийн ойр хил (хана) бүрийг;
        /// олон удаа таарсан нь эхэнд.  Нүх (хаалга, цонх), шошго тэдгээр ханаар.  Олдохгүй бол хоосон.
        /// </summary>
        public static List<string> WallsBehind(WeRoomInfo room, WeV3 a, WeV3 b, WeV3 look)
        {
            var hits = new Dictionary<string, int>(StringComparer.Ordinal);
            var order = new List<string>();
            if (room == null || room.Loops == null || look.IsZero) return order;
            WeV3 n = look.Flat().Normalized();
            foreach (double f in new[] { 0.1, 0.3, 0.5, 0.7, 0.9 })
            {
                WeV3 p = (a + (b - a) * f).Flat();
                double best = double.MaxValue;
                WeBoundarySegment seg = null;
                foreach (WeRoomLoop loop in room.Loops)
                    foreach (WeBoundarySegment s in loop.Segments)
                    {
                        double h = Ray(p, n, s.A.Flat(), s.B.Flat());
                        if (h >= best) continue;
                        // Хилийг ӨРӨӨН ДОТРООС мөргөсөн байх ёстой (5 мм өмнөх цэг өрөөнд): шугам хананы нүүр дээр, өрөө рүү харсан бол
                        // («⇅ Эсрэг») тэр нүүрийг биш, эсрэг талын ханыг.
                        if (!WeKeyPlanner.InsideRoom(room, p + n * (h - InsideProbe))) continue;
                        best = h;
                        seg = s;
                    }
                if (seg == null || string.IsNullOrEmpty(seg.WallUniqueId) || seg.Host == WeBoundaryHost.Other) continue;
                int c;
                hits.TryGetValue(seg.WallUniqueId, out c);
                if (c == 0) order.Add(seg.WallUniqueId);
                hits[seg.WallUniqueId] = c + 1;
            }
            return order.OrderByDescending(u => hits[u]).ThenBy(u => order.IndexOf(u)).ToList();
        }

        /// <summary>5 мм (фут).</summary>
        private const double InsideProbe = 5 / 304.8;

        /// <summary>Цацраг p + n·s (s ≥ −1 мм — шугам хана дээр байвал ч тэр ханыг) ба AB хэрчим; байхгүй бол MaxValue.</summary>
        private static double Ray(WeV3 p, WeV3 n, WeV3 a, WeV3 b)
        {
            WeV3 e = b - a;
            double denom = n.X * e.Y - n.Y * e.X;
            if (Math.Abs(denom) < 1e-12) return double.MaxValue;
            WeV3 ap = a - p;
            double s = (ap.X * e.Y - ap.Y * e.X) / denom;
            double u = (ap.X * n.Y - ap.Y * n.X) / denom;
            if (s < -0.0033 || u < -1e-9 || u > 1 + 1e-9) return double.MaxValue;
            return Math.Abs(s);
        }
    }
}
