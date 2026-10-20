using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text;

namespace RevitMcpAddin.AutoAnnotate.Core
{
    /// <summary>Хананы аль тал нь гадна (барилгын гадна орон зайд) харж байна.</summary>
    [Flags]
    public enum Exposure
    {
        None = 0,
        /// <summary>Хананы тэнхлэгийн ЗҮҮН тал (A→B чиглэлээс 90° зүүн) гадагшаа.</summary>
        Left = 1,
        /// <summary>Баруун тал гадагшаа.</summary>
        Right = 2,
        /// <summary>Хоёр тал хоёулаа гадна — чөлөөт хана (хашаа, парапет).</summary>
        Both = 3,
    }

    /// <summary>Хана — план дээрх тэнхлэгийн хэрчим + зузаан.</summary>
    public sealed class WallSeg
    {
        public int Key;
        public Seg Line;
        public double Thickness;

        public WallSeg(int key, Seg line, double thickness)
        {
            Key = key;
            Line = line;
            Thickness = thickness;
        }

        public V2 Dir => Line.Dir;
        public V2 LeftNormal => Line.Dir.Perp();
        public double Half => Thickness / 2;

        /// <summary>Тухайн талын гадагш нормаль.</summary>
        public V2 Normal(Exposure side) => side == Exposure.Right ? -LeftNormal : LeftNormal;
    }

    /// <summary>Туяа хаах хэрчим (муруй ханыг олон хэрчмээр — ижил Key-тэй).</summary>
    public struct Blocker
    {
        public readonly int Key;
        public readonly Seg Seg;

        public Blocker(int key, Seg seg) { Key = key; Seg = seg; }
    }

    /// <summary>
    /// ГАДНА ХАНА ТАНИХ — туяа цацах арга.  Хананы тал бүрээс 3 цэгээс (20/50/80%)
    /// гадагш туяа цацна; ≥2 нь өөр ямар ч ханыг огтлохгүй «зугтвал» тэр тал гадна.
    ///
    /// Яагаад `WallType.Function == Exterior` биш вэ: MGL-ийн загварт хананы төрлийн
    /// «Function» ихэвчлэн өгөгдмөлөөрөө (бүгд Exterior, эсвэл бүгд Interior) үлддэг.
    /// Яагаад Revit-ийн хананы «Exterior» тал (Wall.Orientation) биш: зурсан чиглэлээс
    /// хамаардаг, хүмүүс хагасыг нь урвуу зурдаг.  Геометр л үнэн.
    ///
    /// Мэдэгдэж буй хязгаар: хашаан (хаалттай дотоод хашаа) руу харсан хана «дотор»
    /// гэж ангилагдана — хашааны нөгөө талын хана туяаг хаадаг.  Энэ нь ажлын зурагт
    /// хор хөнөөлгүй: хашааны фасадыг хашаан дотор тусад нь хэмжинэ.
    /// </summary>
    public static class Exterior
    {
        public static readonly double[] Samples = { 0.2, 0.5, 0.8 };

        /// <summary>Туяаг хананы нүүрнээс ийм зайд (фут ≈ 3 см) эхлүүлнэ — өөрийн нүүрийг огтлохгүй.</summary>
        public const double Eps = 0.1;

        public static Exposure Classify(WallSeg w, IList<Blocker> blockers)
        {
            if (w.Line.Length < 1e-6)
                return Exposure.None;
            V2 left = w.LeftNormal;
            int l = 0, r = 0;
            foreach (double t in Samples)
            {
                V2 p = w.Line.At(t);
                if (Escapes(p + left * (w.Half + Eps), left, blockers, w.Key))
                    l++;
                if (Escapes(p - left * (w.Half + Eps), -left, blockers, w.Key))
                    r++;
            }
            Exposure e = Exposure.None;
            if (l >= 2) e |= Exposure.Left;
            if (r >= 2) e |= Exposure.Right;
            return e;
        }

        /// <summary>Цэгээс чиглэлийн дагуу туяа ямар ч (өөрөөс бусад) хэрчмийг огтлохгүй юу.</summary>
        public static bool Escapes(V2 origin, V2 dir, IList<Blocker> blockers, int selfKey)
        {
            V2 n = dir.Normalized();
            for (int i = 0; i < blockers.Count; i++)
            {
                Blocker b = blockers[i];
                if (b.Key == selfKey)
                    continue;
                if (b.Seg.Ray(origin, n).HasValue)
                    return false;
            }
            return true;
        }
    }

    /// <summary>Хэмжээсийн гинжийн нэг лавлагаа — байрлал нь гинжийн чиглэлээр (фут).</summary>
    public sealed class ChainItem
    {
        public double Pos;

        /// <summary>Нэг цэгт давхцвал аль нь үлдэх вэ: тэнхлэг (3) &gt; булан (2) &gt; нүх, нүүр (1).</summary>
        public int Priority;

        /// <summary>Revit-ийн лавлагаа (цөмд зөвхөн дамжина).</summary>
        public object Ref;

        public string Kind;

        /// <summary>Лавлагааны хавтгайн нормаль (2D), мэдэгдэх бол — <see cref="Chain.KeepParallel"/>.</summary>
        public V2 Normal;
        public bool HasNormal;

        public ChainItem(double pos, int priority, object reference, string kind)
        {
            Pos = pos;
            Priority = priority;
            Ref = reference;
            Kind = kind;
        }

        public ChainItem WithNormal(V2 n)
        {
            V2 u = n.Normalized();
            if (u.Length > 0.5)
            {
                Normal = u;
                HasNormal = true;
            }
            return this;
        }

        public override string ToString() => Kind + "@" + Pos.ToString("0.###", CultureInfo.InvariantCulture);
    }

    public static class Chain
    {
        public const int PriorityFace = 1;
        public const int PriorityCorner = 2;
        public const int PriorityGrid = 3;

        /// <summary>cos(≈0.003°) — Revit-ийн хэмжээс лавлагаа ЯГ параллель байхыг шаарддаг.</summary>
        public const double StrictCos = 1 - 1e-9;

        /// <summary>
        /// Нормальтай лавлагаануудаас хамгийн олон гишүүнтэй ЯГ параллель бүлгийг үлдээнэ (нормальгүйг
        /// хөндөхгүй).  ⚠️ Хэмжсэн 2026-10-01: <see cref="Dir.Parallel"/>-ийн 2.6° хүлцэлтэй «параллель»
        /// налуу хана/тэнхлэг гинжинд орвол Revit Commit дээр «The References of the highlighted Dimension
        /// are no longer parallel» гэж БҮХ гинжийг хасдаг (L1 планд дотор гинжийн хагас нь).
        /// Тэнцвэл тэнхлэгтэй бүлэг давуу (тэнхлэгийн холболт хамгийн чухал).
        /// </summary>
        public static List<ChainItem> KeepParallel(IEnumerable<ChainItem> items, double cos = StrictCos)
        {
            List<ChainItem> all = items.Where(i => i != null).ToList();
            List<ChainItem> withN = all.Where(i => i.HasNormal).ToList();
            if (withN.Count < 2)
                return all;
            V2 best = withN[0].Normal;
            int bestN = -1, bestGrid = -1;
            foreach (ChainItem a in withN)
            {
                int n = 0, g = 0;
                foreach (ChainItem b in withN)
                {
                    if (Math.Abs(a.Normal.Dot(b.Normal)) >= cos)
                    {
                        n++;
                        if (b.Priority == PriorityGrid)
                            g++;
                    }
                }
                if (n > bestN || (n == bestN && g > bestGrid))
                {
                    bestN = n;
                    bestGrid = g;
                    best = a.Normal;
                }
            }
            return all.Where(i => !i.HasNormal || Math.Abs(i.Normal.Dot(best)) >= cos).ToList();
        }

        /// <summary>
        /// Байрлалаар эрэмбэлж, ойр (≤ tol) лавлагаануудыг нэгтгэнэ — өндөр ач холбогдолтойг үлдээнэ.
        /// Revit-ийн NewDimension лавлагааг ӨӨРӨӨ эрэмбэлдэггүй (дарааллаараа сегмент татна) ба 0 урттай
        /// сегмент нь «хэмжээс хэт жижиг» алдаа өгдөг — хоёуланг энд шийднэ.
        /// </summary>
        public static List<ChainItem> Normalize(IEnumerable<ChainItem> items, double tol)
        {
            var sorted = items.Where(i => i != null && !double.IsNaN(i.Pos)).OrderBy(i => i.Pos).ToList();
            var outList = new List<ChainItem>();
            double anchor = double.NaN;
            foreach (ChainItem it in sorted)
            {
                if (outList.Count > 0 && it.Pos - anchor <= tol)
                {
                    ChainItem kept = outList[outList.Count - 1];
                    if (it.Priority > kept.Priority)
                        outList[outList.Count - 1] = it;
                    continue;
                }
                outList.Add(it);
                anchor = it.Pos;
            }
            return outList;
        }

        /// <summary>Гинжийн «хурууны хээ» — ижил байрлалуудтай хоёр гинжийг нэг гэж үзнэ.</summary>
        public static string Signature(IList<ChainItem> items, double tol)
        {
            var sb = new StringBuilder();
            double q = tol > 0 ? tol : 1e-3;
            foreach (ChainItem i in items)
                sb.Append(Math.Round(i.Pos / q).ToString(CultureInfo.InvariantCulture)).Append('|');
            return sb.ToString();
        }

        /// <summary>Нийт хэмжээс — эхний ба сүүлийн лавлагаа.  Хоёроос цөөн бол хоосон.</summary>
        public static List<ChainItem> Overall(IList<ChainItem> normalized)
        {
            var r = new List<ChainItem>();
            if (normalized == null || normalized.Count < 2)
                return r;
            r.Add(normalized[0]);
            r.Add(normalized[normalized.Count - 1]);
            return r;
        }
    }

    /// <summary>Нэг хананд перпендикуляр (T, L холбоос) хүрч буй хана.</summary>
    public sealed class Touch
    {
        public WallSeg Wall;

        /// <summary>Хүрэлцэх цэгийн байрлал W-ийн дагуу (W.A-аас, фут).</summary>
        public double Pos;
    }

    /// <summary>Булан, хөрш ханын дүрэм.</summary>
    public static class Walls
    {
        /// <summary>1 см — хананы тэнхлэгүүд «хүрч байна» гэх хүлцэл (зузааны хагас дээр нэмнэ).</summary>
        public const double TouchTol = 0.033;

        /// <summary>
        /// W-д перпендикуляр бөгөөд түүнд хүрч буй (L, T холбоос) ханууд, W-ийн дагуух байрлалаар эрэмбэлсэн.
        /// Тэнхлэгүүдийн огтлолцол W-ийн хүрээнд (± P-ийн зузаан) ба P-ийн хүрээнд (± W-ийн зузаан) байх ёстой.
        /// </summary>
        public static List<Touch> Touching(WallSeg w, IEnumerable<WallSeg> all)
        {
            var r = new List<Touch>();
            V2 d = w.Dir;
            double len = w.Line.Length;
            foreach (WallSeg p in all)
            {
                if (p == null || p.Key == w.Key || !Dir.Perpendicular(d, p.Dir))
                    continue;
                V2 pd = p.Dir;
                double den = d.Cross(pd);
                if (Math.Abs(den) < 1e-12)
                    continue;
                V2 ap = p.Line.A - w.Line.A;
                double sw = ap.Cross(pd) / den; // W-ийн дагуух байрлал
                double sp = ap.Cross(d) / den;  // P-ийн дагуух байрлал
                double tolW = p.Half + TouchTol;
                double tolP = w.Half + TouchTol;
                if (sw < -tolW || sw > len + tolW)
                    continue;
                if (sp < -tolP || sp > p.Line.Length + tolP)
                    continue;
                r.Add(new Touch { Wall = p, Pos = sw });
            }
            return r.OrderBy(t => t.Pos).ToList();
        }

        /// <summary>W-ийн end (0 = A, 1 = B) үзүүрт хүрч буй перпендикуляр ханууд.</summary>
        public static List<Touch> AtEnd(WallSeg w, IList<Touch> touching, int end)
        {
            double at = end == 0 ? 0 : w.Line.Length;
            return touching.Where(t => Math.Abs(t.Pos - at) <= t.Wall.Half + w.Half + TouchTol).ToList();
        }

        /// <summary>
        /// ГАДНА гинжийн булан: W-ийн үзүүрт хүрч буй ГАДНА хананы гадна нүүр.
        ///   • P нэг талаараа гадна → тэр талын нүүр (гүдгэр булан ч, хотгор (шат) булан ч зөв).
        ///   • P хоёр талаараа гадна (чөлөөт хана) → W-ийн дундаас ТАЛ руу харсан нүүр.
        ///   • P дотор хана (фасад үргэлжилж байна) → булан биш.
        /// Буцаах: (P, P-ийн аль тал) эсвэл null.
        /// </summary>
        public static Tuple<WallSeg, Exposure> ExteriorCorner(WallSeg w, IList<Touch> atEnd, Func<int, Exposure> exposureOf, int end)
        {
            foreach (Touch t in atEnd)
            {
                Exposure e = exposureOf(t.Wall.Key);
                if (e == Exposure.Left || e == Exposure.Right)
                    return Tuple.Create(t.Wall, e);
            }
            foreach (Touch t in atEnd)
            {
                if (exposureOf(t.Wall.Key) == Exposure.Both)
                    return Tuple.Create(t.Wall, FaceAway(w, t.Wall, end));
            }
            return null;
        }

        /// <summary>
        /// P-ийн хоёр нүүрнээс W-ийн дундаас ТАЛ (end үзүүрийн зүг) харсныг сонгоно.
        /// </summary>
        public static Exposure FaceAway(WallSeg w, WallSeg p, int end)
        {
            V2 outDir = end == 0 ? -w.Dir : w.Dir;
            return p.LeftNormal.Dot(outDir) >= 0 ? Exposure.Left : Exposure.Right;
        }

        /// <summary>P-ийн хоёр нүүрнээс W-ийн тухайн цэг (pos) рүү ХАРСАН нүүр — өрөөний талын хэмжээс.</summary>
        public static Exposure FaceToward(WallSeg w, WallSeg p, double pTouchPos, double towardPos)
        {
            V2 toward = towardPos >= pTouchPos ? w.Dir : -w.Dir;
            return p.LeftNormal.Dot(toward) >= 0 ? Exposure.Left : Exposure.Right;
        }
    }

    /// <summary>Дотор гинжийн шугам (тэнхлэг хоорондын зайн дунд) сонголт.</summary>
    public static class ScanLines
    {
        /// <summary>Эрэмбэлсэн тэнхлэгийн координатуудаас алхам бүрийн дунд.  minBay-аас нарийн алхам алгасна.</summary>
        public static List<double> BayMids(IEnumerable<double> gridCoords, double minBay)
        {
            var c = gridCoords.OrderBy(x => x).ToList();
            var r = new List<double>();
            for (int i = 0; i + 1 < c.Count; i++)
            {
                if (c[i + 1] - c[i] >= minBay)
                    r.Add((c[i] + c[i + 1]) / 2);
            }
            return r;
        }

        /// <summary>
        /// c-г [lo+margin, hi−margin] дотор саад (өрөөний tag, бусад гинж)-аас clear-ээс холдуулна.
        /// c, c±step, c±2step… — эхний тохирохыг.  Олдохгүй бол null.
        /// </summary>
        public static double? Avoid(double c, double lo, double hi, IList<double> obstacles, double clear, double step, double margin)
        {
            double a = lo + margin, b = hi - margin;
            if (a > b)
                return null;
            for (int k = 0; k <= 12; k++)
            {
                foreach (int sign in k == 0 ? new[] { 1 } : new[] { 1, -1 })
                {
                    double y = c + sign * k * step;
                    if (y < a || y > b)
                        continue;
                    bool ok = true;
                    foreach (double o in obstacles)
                    {
                        if (Math.Abs(o - y) < clear)
                        {
                            ok = false;
                            break;
                        }
                    }
                    if (ok)
                        return y;
                }
            }
            return null;
        }
    }

    /// <summary>Хэмжээсийн бичвэрийн байрлал (сегмент тус бүр).</summary>
    public enum TextPlace
    {
        /// <summary>Revit-ийн өгөгдмөл — сегментийн дунд, шугамын дээр.</summary>
        Default = 0,
        /// <summary>Гинжийн эхний сегментээс ӨМНӨ (гадна) — шугамын дагуу.</summary>
        Before = 1,
        /// <summary>Сүүлийн сегментээс ХОЙШ (гадна).</summary>
        After = 2,
        /// <summary>Дундах жижиг сегмент — нэг мөр дээш өргөнө (хөршөөсөө ялгагдана).</summary>
        Raised = 3,
    }

    /// <summary>
    /// Жижиг сегментийн бичвэр давхцахаас сэргийлнэ (ханын зузаан 120, нүхний хажуу 50 г.м.).
    /// Бичвэр сегментэд багтахгүй бол: эхний/сүүлийнх нь гадагш, дундах дараалсан жижгүүдийн
    /// хоёр дахь бүрийг дээш өргөнө — ажлын зурагт гараар хийдэгтэй ижил.
    /// </summary>
    public static class TextLayout
    {
        public static TextPlace[] Plan(IList<double> segLenMm, IList<double> textWidthMm, double gapMm)
        {
            int n = segLenMm.Count;
            var r = new TextPlace[n];
            int run = 0;
            for (int i = 0; i < n; i++)
            {
                bool small = textWidthMm[i] + gapMm > segLenMm[i];
                if (!small)
                {
                    run = 0;
                    continue;
                }
                if (i == 0 && n > 1)
                    r[i] = TextPlace.Before;
                else if (i == n - 1 && n > 1)
                    r[i] = TextPlace.After;
                else
                {
                    // Өмнөх сегмент нь «Before» (гадагш гарсан) бол энэ нь дунд нь багтана.
                    bool prevMoved = i > 0 && (r[i - 1] == TextPlace.Before || r[i - 1] == TextPlace.Raised);
                    r[i] = prevMoved ? TextPlace.Default : (run % 2 == 1 ? TextPlace.Raised : TextPlace.Default);
                }
                run++;
            }
            return r;
        }
    }

    /// <summary>Ойролцоох тэнхлэг (баганын холболт).</summary>
    public static class Nearest
    {
        /// <summary>center-т хамгийн ойр координатын индекс (maxDist-ээс хол бол −1).</summary>
        public static int Index(IList<double> coords, double center, double maxDist)
        {
            int best = -1;
            double bd = double.MaxValue;
            for (int i = 0; i < coords.Count; i++)
            {
                double d = Math.Abs(coords[i] - center);
                if (d < bd)
                {
                    bd = d;
                    best = i;
                }
            }
            return bd <= maxDist ? best : -1;
        }
    }
}
