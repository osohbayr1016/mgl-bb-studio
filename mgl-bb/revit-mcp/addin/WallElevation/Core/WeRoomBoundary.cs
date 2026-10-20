using System;
using System.Collections.Generic;
using System.Linq;

namespace RevitMcpAddin.WallElevation.Core
{
    /// <summary>Өрөөний нэг ханын харах гадаргуу (ижил хана, ижил тал, нэг шулуун дээрх сегментүүдийг нэгтгэсэн).</summary>
    public sealed class WeRoomFace
    {
        public string WallUniqueId;
        public WeV3 A;
        public WeV3 B;
        /// <summary>Гадаргуугаас ӨРӨӨНИЙ ДОТОР руу заасан нэгж нормаль.  Харах чиглэл = −InteriorNormal.</summary>
        public WeV3 InteriorNormal;
        /// <summary>Revit-ийн IsPointInRoom шалгалт геометрийн дүгнэлттэй ЗӨРСӨН (хүн шалгах).</summary>
        public bool ProbeDisagrees;
        /// <summary>Муруй гадаргуунд: хөвчийн (A→B) өрөөний дотор талын нормаль — зөвхөн үсэг/чиглэл (компас) тооцоход.</summary>
        public WeV3 ChordNormal;
        /// <summary>Нэгтгэсэн сегментийн тоо.</summary>
        public int SegmentCount;

        public double Length { get { return (B - A).Flat().Length; } }
    }

    /// <summary>Тал дахь нэг хана ба түүний хамрах урт.</summary>
    public sealed class WeSidePart
    {
        public string WallUniqueId;
        public double Length;
        public bool ProbeDisagrees;
    }

    /// <summary>
    /// Өрөөний НЭГ ТАЛ = нэг дэлгээс.  Нэгтгэх горимд: нэг шулуун дээрх (ижил дотор нормаль) хилийн сегментүүд — хэд хэдэн хана,
    /// дундах багана / тусгаарлах шугам, гүехэн нүх (ниш) ба цухуйлтыг (пилястр) давж нэг тал болно.  Нэгтгэхгүй горимд нэг хана =
    /// нэг тал (<see cref="RoomBoundaryAnalyzer.Faces"/>-тэй ЯГ ижил).
    /// </summary>
    public sealed class WeRoomSide
    {
        public WeV3 A;
        public WeV3 B;
        /// <summary>Гадаргуугаас ӨРӨӨНИЙ ДОТОР руу заасан нэгж нормаль.  Муруй гадаргуунд Zero.</summary>
        public WeV3 InteriorNormal;
        /// <summary>Муруй гадаргуунд хөвчийн дотор нормаль (компас, үсэгт).</summary>
        public WeV3 ChordNormal;
        public bool ProbeDisagrees;
        public int SegmentCount;
        /// <summary>Энэ талыг бүрдүүлэх хана (хамрах уртаараа буурах дарааллаар — эхнийх нь «зангуу»).</summary>
        public List<WeSidePart> Walls = new List<WeSidePart>();
        /// <summary>Тал дотор хана биш хил (багана, тусгаарлах шугам) байна.</summary>
        public bool HasNonWall;
        /// <summary>Тал дотор холбоос (link) загварын хана байна.</summary>
        public bool HasLinked;
        /// <summary>Талын шугамаас ӨРӨӨ рүү цухуйсан хамгийн их зай (пилястр, богино хаалт) — зүсэх хавтгай түүнээс өмнө.</summary>
        public double Protrusion;
        /// <summary>Талын шугамаас ЦААШ орсон хамгийн их зай (ниш) — харах гүн түүнийг хамарна.</summary>
        public double Recess;
        /// <summary>Нэг ханын хэд дэх хэсэг (нэг хана хоёр тусдаа тал болсон үед 2, 3 …; түлхүүрт).  1 = энгийн.</summary>
        public int Part = 1;

        public double Length { get { return (B - A).Flat().Length; } }
        public string AnchorWallUid { get { return Walls.Count > 0 ? Walls[0].WallUniqueId : null; } }
        public bool IsCurved { get { return InteriorNormal.IsZero; } }
    }

    /// <summary>
    /// Өрөөний хилээс ханын гадаргуу олох ЦЭВЭР логик.
    ///
    /// Өрөөний «дотор тал»-ыг Revit-ийн хүрээний чиглэлийн ДҮРЭМД (гадна контур CCW) найдахгүй — контур бүрийн
    /// тэмдэгт талбайгаар бодно: хамгийн том |талбай|-тай контур = гадна хил (дотор нь өрөө), бусад = арал
    /// (гадна нь өрөө).  Revit давхарга нэмж `Room.IsPointInRoom`-оор шалгадаг; зөрвөл хүн шалгана.
    /// </summary>
    public static class RoomBoundaryAnalyzer
    {
        /// <summary>Контурын тэмдэгт талбай (XY, shoelace): &gt; 0 = цагийн зүүний эсрэг (CCW).</summary>
        public static double SignedArea(IList<WeBoundarySegment> loop)
        {
            if (loop == null || loop.Count < 2) return 0;
            double s = 0;
            foreach (WeBoundarySegment seg in loop)
                s += seg.A.X * seg.B.Y - seg.B.X * seg.A.Y;
            return s / 2;
        }

        /// <summary>Сегментийн өрөөний дотор талын нормаль.</summary>
        /// <param name="isOuterLoop">Гадна хил эсэх (үгүй бол арал).</param>
        /// <param name="loopIsCcw">Контур CCW эсэх.</param>
        public static WeV3 InteriorNormal(WeV3 a, WeV3 b, bool isOuterLoop, bool loopIsCcw)
        {
            WeV3 t = WallFrameCalculator.Tangent(a, b);
            if (t.IsZero) return WeV3.Zero;
            WeV3 left = WallFrameCalculator.LeftNormal(t);
            // Гадна контур CCW → дотор нь зүүн; CW → баруун.  Арал эсрэгээрээ (өрөө нь аралын ГАДНА).
            bool interiorIsLeft = isOuterLoop ? loopIsCcw : !loopIsCcw;
            return interiorIsLeft ? left : -left;
        }

        /// <summary>
        /// Өрөөний бүх контураас ханын гадаргуунуудыг гаргана (зөвхөн <see cref="WeBoundaryHost.Wall"/>, шулуун).
        /// Шулуун биш / холбоосын / хана биш сегментийг <paramref name="skipped"/>-д тайлбартай нэмнэ.
        /// Дараалал: контурын дараалал → сегментийн дараалал (тогтвортой).
        /// </summary>
        public static List<WeRoomFace> Faces(WeRoomInfo room, List<KeyValuePair<WeBoundarySegment, string>> skipped)
        {
            var faces = new List<WeRoomFace>();
            if (room == null || room.Loops == null || room.Loops.Count == 0) return faces;

            int outer = -1;
            double best = -1;
            for (int i = 0; i < room.Loops.Count; i++)
            {
                double a = Math.Abs(SignedArea(room.Loops[i].Segments));
                if (a > best) { best = a; outer = i; }
            }

            for (int i = 0; i < room.Loops.Count; i++)
            {
                List<WeBoundarySegment> segs = room.Loops[i].Segments;
                bool ccw = SignedArea(segs) > 0;
                foreach (WeBoundarySegment seg in segs)
                {
                    if (seg.Host == WeBoundaryHost.LinkedWall)
                    {
                        if (skipped != null) skipped.Add(new KeyValuePair<WeBoundarySegment, string>(seg, "холбоос (link) загварын хана"));
                        continue;
                    }
                    if (seg.Host != WeBoundaryHost.Wall || string.IsNullOrEmpty(seg.WallUniqueId))
                    {
                        if (skipped != null) skipped.Add(new KeyValuePair<WeBoundarySegment, string>(seg, "хана биш хил (тусгаарлах шугам, багана …)"));
                        continue;
                    }
                    if (!seg.IsStraight)
                    {
                        // Муруй гадаргуу: InteriorNormal = Zero — төлөвлөгч үүнийг Unsupported гэж ИЛ мэдээлнэ (чимээгүй алгасахгүй).
                        faces.Add(new WeRoomFace
                        {
                            WallUniqueId = seg.WallUniqueId, A = seg.A, B = seg.B, InteriorNormal = WeV3.Zero, SegmentCount = 1,
                            ChordNormal = InteriorNormal(seg.A, seg.B, i == outer, ccw),
                        });
                        continue;
                    }
                    WeV3 n = InteriorNormal(seg.A, seg.B, i == outer, ccw);
                    if (n.IsZero) continue;   // тэг урттай сегмент — Revit заримдаа өгдөг
                    bool disagree = seg.InteriorProbe.HasValue && !seg.InteriorProbe.Value;
                    Merge(faces, seg.WallUniqueId, seg.A, seg.B, n, disagree);
                }
            }
            return faces;
        }

        // ══════════════════════════════════════════════════════════════
        //  Тал (нэг дэлгээс) — нэг шулуун дээрх хилийг нэгтгэх
        // ══════════════════════════════════════════════════════════════

        private sealed class Seg
        {
            public WeBoundarySegment S;
            public int Index;
            public WeV3 N;
        }

        private static int OuterIndex(WeRoomInfo room)
        {
            int outer = -1;
            double best = -1;
            for (int i = 0; i < room.Loops.Count; i++)
            {
                double a = Math.Abs(SignedArea(room.Loops[i].Segments));
                if (a > best) { best = a; outer = i; }
            }
            return outer;
        }

        /// <summary>
        /// Өрөөний ТАЛУУД.  <paramref name="merge"/> = false → <see cref="Faces"/> (нэг хана = нэг тал, хуучин зан төлөв).
        /// <paramref name="merge"/> = true → контур бүрт нэг шулуун дээрх (ижил дотор нормаль, <paramref name="lineTol"/> доторх)
        /// бүх шулуун сегментийг нэг тал болгоно; шулуун дээрх хоёр хэсгийн ЗАВСРЫГ давах нь зөвхөн завсар доторх хил (багана,
        /// пилястр, ниш) шугамаас <paramref name="maxJog"/>-оос ихгүй холдсон үед — эс бөгөөс (гүн цухуйлт, U хэлбэр, дундах
        /// хаалт хана) тусдаа тал.  Хана огт ороогүй тал (зөвхөн тусгаарлах шугам/link) дэлгээсгүй, <paramref name="skipped"/>-д.
        /// Дараалал: контур → эхний сегментийн дараалал (тогтвортой).
        /// </summary>
        public static List<WeRoomSide> Sides(WeRoomInfo room, List<KeyValuePair<WeBoundarySegment, string>> skipped,
                                             bool merge, double maxJog, double lineTol)
        {
            var sides = new List<WeRoomSide>();
            if (!merge)
            {
                foreach (WeRoomFace f in Faces(room, skipped)) sides.Add(FromFace(f));
                return sides;
            }
            if (room == null || room.Loops == null || room.Loops.Count == 0) return sides;
            int outer = OuterIndex(room);
            var order = new List<KeyValuePair<long, WeRoomSide>>();
            // Тал завсраа давахдаа «хамарсан» хил (тусгаарлах шугам, ханын үзүүр) — тэдгээр нь дэлгээст аль хэдийн багтсан тул
            // «дэлгээсгүй» гэж тайланд бичихгүй (төгсгөлд skipped-ээс хасна).
            var covered = new HashSet<WeBoundarySegment>();
            int skippedStart = skipped != null ? skipped.Count : 0;

            for (int i = 0; i < room.Loops.Count; i++)
            {
                List<WeBoundarySegment> segs = room.Loops[i].Segments;
                bool ccw = SignedArea(segs) > 0;
                int loopStart = order.Count;
                var items = new List<Seg>();
                for (int k = 0; k < segs.Count; k++)
                {
                    WeBoundarySegment seg = segs[k];
                    if (!seg.IsStraight)
                    {
                        if (seg.Host == WeBoundaryHost.Wall && !string.IsNullOrEmpty(seg.WallUniqueId))
                        {
                            var curved = new WeRoomSide
                            {
                                A = seg.A, B = seg.B, InteriorNormal = WeV3.Zero, SegmentCount = 1,
                                ChordNormal = InteriorNormal(seg.A, seg.B, i == outer, ccw),
                            };
                            curved.Walls.Add(new WeSidePart { WallUniqueId = seg.WallUniqueId, Length = (seg.B - seg.A).Flat().Length });
                            order.Add(new KeyValuePair<long, WeRoomSide>(i * 100000L + k, curved));
                        }
                        else if (skipped != null)
                            skipped.Add(new KeyValuePair<WeBoundarySegment, string>(seg, seg.Host == WeBoundaryHost.LinkedWall
                                ? "холбоос (link) загварын хана" : "хана биш хил (тусгаарлах шугам, багана …)"));
                        continue;
                    }
                    WeV3 n = InteriorNormal(seg.A, seg.B, i == outer, ccw);
                    if (n.IsZero) continue;   // тэг урттай сегмент
                    items.Add(new Seg { S = seg, Index = k, N = n });
                }

                var used = new bool[items.Count];
                for (int k = 0; k < items.Count; k++)
                {
                    if (used[k]) continue;
                    used[k] = true;
                    WeV3 n = items[k].N;
                    double d = n.Dot(items[k].S.A.Flat());
                    var line = new List<Seg> { items[k] };
                    for (int m = k + 1; m < items.Count; m++)
                    {
                        if (used[m] || items[m].N.Dot(n) < 1 - WeTol.Direction) continue;
                        if (Math.Abs(n.Dot(items[m].S.A.Flat()) - d) > lineTol || Math.Abs(n.Dot(items[m].S.B.Flat()) - d) > lineTol) continue;
                        line.Add(items[m]);
                        used[m] = true;
                    }
                    var t = new WeV3(-n.Y, n.X, 0);
                    WeV3 origin = n * d;
                    Func<WeV3, double> tau = p => (p.Flat() - origin).Dot(t);
                    var iv = line.Select(sg => new { Seg = sg, Lo = Math.Min(tau(sg.S.A), tau(sg.S.B)), Hi = Math.Max(tau(sg.S.A), tau(sg.S.B)) })
                                 .OrderBy(x => x.Lo).ThenBy(x => x.Seg.Index).ToList();
                    var lineSet = new HashSet<int>(line.Select(x => x.Index));
                    List<WeBoundarySegment> others = segs.Where((sg, idx) => !lineSet.Contains(idx)).ToList();

                    var cluster = new List<Seg> { iv[0].Seg };
                    double lo = iv[0].Lo, hi = iv[0].Hi, prot = 0, rec = 0;
                    bool bridgedNonWall = false;
                    var gapSegs = new HashSet<WeBoundarySegment>();
                    Action flush = () =>
                    {
                        WeRoomSide side = Build(cluster, origin, t, n, lo, hi, prot, rec, skipped);
                        if (side == null) return;   // хана ороогүй — завсрын хил ч дэлгээсгүй хэвээр (тайланд үлдэнэ)
                        if (bridgedNonWall) side.HasNonWall = true;
                        covered.UnionWith(gapSegs);
                        order.Add(new KeyValuePair<long, WeRoomSide>(i * 100000L + cluster.Min(c => c.Index), side));
                    };
                    for (int j = 1; j < iv.Count; j++)
                    {
                        double p, r;
                        bool nw;
                        if (iv[j].Lo <= hi + lineTol)
                        {
                            cluster.Add(iv[j].Seg);
                            hi = Math.Max(hi, iv[j].Hi);
                        }
                        else if (Bridge(others, origin, t, n, hi, iv[j].Lo, maxJog, lineTol, out p, out r, out nw, gapSegs))
                        {
                            cluster.Add(iv[j].Seg);
                            hi = Math.Max(hi, iv[j].Hi);
                            prot = Math.Max(prot, p);
                            rec = Math.Max(rec, r);
                            bridgedNonWall |= nw;
                        }
                        else
                        {
                            flush();
                            cluster = new List<Seg> { iv[j].Seg };
                            lo = iv[j].Lo; hi = iv[j].Hi; prot = 0; rec = 0; bridgedNonWall = false;
                            gapSegs = new HashSet<WeBoundarySegment>();
                        }
                    }
                    flush();
                }
                MergeSteps(order, loopStart, segs, maxJog, lineTol);
                DropOpeningReveals(order, loopStart, segs, maxJog, lineTol, skipped);
                DropHiddenSlivers(order, loopStart, maxJog, lineTol, skipped);
            }
            DropShortSides(order, maxJog, lineTol, skipped);

            sides.AddRange(order.OrderBy(kv => kv.Key).Select(kv => kv.Value));
            AssignParts(sides);
            if (skipped != null && covered.Count > 0)
                for (int k = skipped.Count - 1; k >= skippedStart; k--)
                    if (covered.Contains(skipped[k].Key)) skipped.RemoveAt(k);
            return sides;
        }

        /// <summary>
        /// БУЛАНГИЙН АЛХАМ — параллель хоёр тал, шугамын зөрүү нь ≤ <paramref name="maxJog"/>, нэгнийх нь төгсгөл нөгөөгийнх нь
        /// эхлэлтэй t-ээр залгаа (хооронд нь зөвхөн тэр зөрүүтэй тэнцүү перпендикуляр холбогч хил) → НЭГ тал (нэг дэлгээс).
        /// ХЭМЖСЭН (MITIC 2-р давхар, 2026-10-08): 215 өрөөний буланд 250×450 мм баганын хонхор — жишиг хуудас 4 дэлгээс (215A–D),
        /// хэрэгсэл 6 (450 ба 250 мм-ийн «тал» тусдаа).  <see cref="Bridge"/> нь зөвхөн НЭГ шулуун дээрх завсрыг давдаг тул буланд
        /// хүрэхгүй.  Нэгтгэх нөхцөл: богино тал ≤ maxJog, эсвэл зөрүү нимгэн (≤ 0.3·maxJog — өнгөлгөөний зузааны алхам).  Урт
        /// тал = зангуу (хавтгай, түлхүүр хэвээр); богино тал цухуйвал <see cref="WeRoomSide.Protrusion"/>, хонхорвол
        /// <see cref="WeRoomSide.Recess"/>.  L өрөөний 1.5 м+ алхам, нишийн арын хана (давхцсан, залгаа биш) хөндөгдөхгүй.
        /// </summary>
        /// <summary>
        /// НЭЭЛХИЙН ХАЖУУ — ≤ maxJog урт ганц ханын тал, нэг үзүүр нь перпендикуляр ХАНА БИШ хилтэй (≥ 600 мм тусгаарлах шугам = нээлхий,
        /// гарц) залгаа → дэлгээсгүй.  ХЭМЖСЭН (MITIC 202 Лобби, 2026-10-08): 2560 мм-ийн нээлхийн хоёр 700 мм-ийн хүрээ тус тусдаа дэлгээс
        /// болсон, жишиг хуудсанд байхгүй (нээлхий нь том талын дэлгээст багтана).  Хананд залгаа богино тал (216E/F — 660 мм-ийн хана)
        /// хэвээр.
        /// </summary>
        private static void DropOpeningReveals(List<KeyValuePair<long, WeRoomSide>> order, int start, List<WeBoundarySegment> segs,
                                               double maxJog, double tol, List<KeyValuePair<WeBoundarySegment, string>> skipped)
        {
            double minOpening = maxJog * 0.6;
            for (int x = order.Count - 1; x >= start; x--)
            {
                WeRoomSide sd = order[x].Value;
                if (sd.IsCurved || sd.SegmentCount != 1 || sd.Length > maxJog + tol) continue;
                WeV3 dir = (sd.B - sd.A).Flat().Normalized();
                if (dir.IsZero) continue;
                bool reveal = false;
                foreach (WeBoundarySegment g in segs)
                {
                    if (g.Host == WeBoundaryHost.Wall || !g.IsStraight) continue;
                    WeV3 gd = (g.B - g.A).Flat();
                    if (gd.Length < minOpening || Math.Abs(gd.Normalized().Dot(dir)) > 0.1) continue;
                    foreach (WeV3 p in new[] { sd.A, sd.B })
                        if ((g.A - p).Flat().Length <= tol || (g.B - p).Flat().Length <= tol) { reveal = true; break; }
                    if (reveal) break;
                }
                if (!reveal) continue;
                if (skipped != null)
                    skipped.Add(new KeyValuePair<WeBoundarySegment, string>(new WeBoundarySegment { A = sd.A, B = sd.B, IsStraight = true, Host = WeBoundaryHost.Wall, WallUniqueId = sd.AnchorWallUid },
                                                                            "нээлхийн хажуугийн богино хана (" + Math.Round(sd.Length * 304.8) + " мм) — нээлхий нь том талын дэлгээст багтана"));
                order.RemoveAt(x);
            }
        }

        /// <summary>
        /// ДАВХАР ДЭЛГЭЭС — жишиг хуудсанд байхгүй жижиг «тал»-ууд (ХЭМЖСЭН, MITIC 218/219, 2026-10-08):
        ///   • том талын АРД нуугдсан хонхор — 219J: 3160 мм-ийн урд хананд 140 мм өргөн, 20 мм гүн; 218I: 1240 мм-ийн талд 800 мм-ийн хаалганы
        ///     хонхор (20 мм) — том тал завсрыг давж (<see cref="Bridge"/>) бүтэн дэлгээстэй, хонхор (хаалга) түүнд аль хэдийн харагдана;
        ///   • НИМГЭН ХААЛТЫН ҮЗҮҮР — 219G/219I: 20 мм-ийн АЦӨ-ийн хаалт хавтан хананаас 380 мм цухуйж, өрөө хоёр талаар нь тойрсон — хоёр
        ///     нүүр нь эсрэг чиглэлтэй, ≤ 60 мм зайтай; хаалт хөрш дэлгээсүүдэд харагдана.
        /// Хоёулаа ≤ maxJog урттай тал л — урт хана хэзээ ч хасагдахгүй.
        /// </summary>
        private static void DropHiddenSlivers(List<KeyValuePair<long, WeRoomSide>> order, int start, double maxJog, double tol,
                                              List<KeyValuePair<WeBoundarySegment, string>> skipped)
        {
            double maxRecess = 0.3 * maxJog, maxFin = 60 / 304.8;
            var drop = new Dictionary<int, string>();
            for (int x = start; x < order.Count; x++)
            {
                WeRoomSide sd = order[x].Value;
                if (sd.IsCurved || sd.Length > maxJog + tol) continue;
                WeV3 n = sd.InteriorNormal.Flat().Normalized();
                var t = new WeV3(-n.Y, n.X, 0);
                double a0 = Math.Min(sd.A.Dot(t), sd.B.Dot(t)), a1 = Math.Max(sd.A.Dot(t), sd.B.Dot(t));
                for (int y = start; y < order.Count; y++)
                {
                    if (y == x) continue;
                    WeRoomSide o = order[y].Value;
                    if (o.IsCurved) continue;
                    WeV3 on = o.InteriorNormal.Flat().Normalized();
                    double b0 = Math.Min(o.A.Dot(t), o.B.Dot(t)), b1 = Math.Max(o.A.Dot(t), o.B.Dot(t));
                    // Хонхор: ижил чиглэл, том тал (≥ 1.5×) хонхрын бүх өргөнийг хамарсан, хонхор нь түүний АРД (өрөөнөөс хол) ≤ 0.3·maxJog.
                    if (on.Dot(n) > 1 - 1e-6 && o.Length >= 1.5 * sd.Length && b0 <= a0 + tol && b1 >= a1 - tol)
                    {
                        double behind = (o.A - sd.A).Flat().Dot(n);   // өрөө рүү эерэг: том тал хонхроос өрөө рүү урд байх ёстой
                        if (behind > tol && behind <= maxRecess + tol)
                        {
                            drop[x] = "том талын (" + Math.Round(o.Length * 304.8) + " мм) ард " + Math.Round(behind * 304.8) + " мм гүн хонхор ("
                                      + Math.Round(sd.Length * 304.8) + " мм) — том талын дэлгээст харагдана";
                            break;
                        }
                        // Цухуйсан хайрцгийн (багана, босоо суваг) УРД нүүр — том тал түүнийг давж (Protrusion) урд нь харуулна.  ХЭМЖСЭН (MITIC
                        // 211, жишиг ИЗД1_A2_40): 625 мм цухуйсан 1000 мм-ийн хайрцгийн урд нүүр тусдаа дэлгээс болсон; жишигт 211C (7885)-д, хажуу
                        // нүүрүүд (625, 635) нь тусдаа.
                        if (behind < -tol && -behind <= o.Protrusion + tol)
                        {
                            drop[x] = "том талын (" + Math.Round(o.Length * 304.8) + " мм) өмнө " + Math.Round(-behind * 304.8) + " мм цухуйсан хэсгийн урд нүүр ("
                                      + Math.Round(sd.Length * 304.8) + " мм) — том талын дэлгээст харагдана";
                            break;
                        }
                    }
                    // Нимгэн хаалт: эсрэг чиглэл, ≤ 60 мм зайтай, хоёулаа богино, давхцал ≥ 80 %.
                    if (on.Dot(n) < -1 + 1e-6 && o.Length <= maxJog + tol)
                    {
                        double gap = (o.A - sd.A).Flat().Dot(n);   // эсрэг нүүр нь энэ нүүрний АРД (сөрөг) байна
                        double ov = Math.Min(a1, b1) - Math.Max(a0, b0);
                        if (gap < -tol / 2 && -gap <= maxFin + tol && ov >= 0.8 * Math.Min(a1 - a0, b1 - b0))
                        {
                            drop[x] = "нимгэн хаалтын үзүүр (" + Math.Round(-gap * 304.8) + " мм зузаан, " + Math.Round(sd.Length * 304.8)
                                      + " мм) — хөрш дэлгээсүүдэд харагдана";
                            break;
                        }
                    }
                }
            }
            foreach (int x in drop.Keys.OrderByDescending(k => k))
            {
                WeRoomSide sd = order[x].Value;
                if (skipped != null)
                    skipped.Add(new KeyValuePair<WeBoundarySegment, string>(new WeBoundarySegment { A = sd.A, B = sd.B, IsStraight = true, Host = WeBoundaryHost.Wall, WallUniqueId = sd.AnchorWallUid }, drop[x]));
                order.RemoveAt(x);
            }
        }

        /// <summary>
        /// БОГИНО ТАЛ — 1 м-ээс (<paramref name="minLength"/>) богино шулуун тал тусдаа дэлгээсгүй; хөрш том талын дэлгээст харагдана.
        /// Эзний шийдвэр (2026-10-14): MAX ӨРГӨӨ 157 «Бэлтгэх өрөө» (50 хилийн хэрчим, дотроо ханан цөм) хэрэгсэл 27 дэлгээс, оффисын жишиг
        /// 10 — 27-ийн 12 нь 300–900 мм-ийн буланы хэсэг (баганын хонхорын хажуу, цөмийн үзүүр, налуу ханын хонхор).  Өрөөнд ≥ 1 м тал ОГТ
        /// байхгүй бол (жижиг шахуурга, шахмал хонхор) хэвээр — өрөө дэлгээсгүй үлдэхгүй.  Арлын (багана) талууд ч мөн адил.
        /// </summary>
        private static void DropShortSides(List<KeyValuePair<long, WeRoomSide>> order, double minLength, double tol,
                                           List<KeyValuePair<WeBoundarySegment, string>> skipped)
        {
            List<WeRoomSide> longSides = order.Select(kv => kv.Value).Where(sd => sd.IsCurved || sd.Length >= minLength - tol).ToList();
            if (longSides.Count == 0) return;
            for (int x = order.Count - 1; x >= 0; x--)
            {
                WeRoomSide sd = order[x].Value;
                if (sd.IsCurved || sd.Length >= minLength - tol) continue;
                if (IsNicheBack(sd, longSides, tol)) continue;
                // Тайланд нэг мөр («12 1 м-ээс богино тал …») — урт бүрээр нь хуваахгүй.
                if (skipped != null)
                    skipped.Add(new KeyValuePair<WeBoundarySegment, string>(
                        new WeBoundarySegment { A = sd.A, B = sd.B, IsStraight = true, Host = WeBoundaryHost.Wall, WallUniqueId = sd.AnchorWallUid },
                        "1 м-ээс богино тал — хөрш талын дэлгээст харагдана"));
                order.RemoveAt(x);
            }
        }

        /// <summary>
        /// Нишийн АРЫН хана — булангийн хэсэг БИШ: ижил чиглэлтэй урт тал түүний бүх өргөнийг хамарч, түүнээс өрөө рүү урд байна (жишиг
        /// 205E/F, MITIC: 400 мм гүн нишийн 900 мм-ийн арын хана өөрийн дэлгээстэй).  Ийм тал богино ч хэвээр.
        /// </summary>
        private static bool IsNicheBack(WeRoomSide sd, List<WeRoomSide> longSides, double tol)
        {
            WeV3 n = sd.InteriorNormal.Flat().Normalized();
            if (n.IsZero) return false;
            var t = new WeV3(-n.Y, n.X, 0);
            double a0 = Math.Min(sd.A.Dot(t), sd.B.Dot(t)), a1 = Math.Max(sd.A.Dot(t), sd.B.Dot(t));
            foreach (WeRoomSide o in longSides)
            {
                if (o.IsCurved || o.InteriorNormal.Flat().Normalized().Dot(n) < 1 - 1e-6) continue;
                double b0 = Math.Min(o.A.Dot(t), o.B.Dot(t)), b1 = Math.Max(o.A.Dot(t), o.B.Dot(t));
                if (b0 > a0 + tol || b1 < a1 - tol) continue;
                if ((o.A - sd.A).Flat().Dot(n) > tol) return true;   // урт тал нишээс өрөө рүү урд
            }
            return false;
        }

        private static void MergeSteps(List<KeyValuePair<long, WeRoomSide>> order, int start, List<WeBoundarySegment> segs,
                                       double maxJog, double tol)
        {
            var connectors = new List<WeBoundarySegment>();
            bool changed = true;
            while (changed)
            {
                changed = false;
                for (int x = start; x < order.Count && !changed; x++)
                    for (int y = start; y < order.Count && !changed; y++)
                    {
                        if (x == y) continue;
                        WeRoomSide big = order[x].Value, small = order[y].Value;
                        if (big.IsCurved || small.IsCurved) continue;
                        if (big.Length < small.Length - 1e-9 || (Math.Abs(big.Length - small.Length) <= 1e-9 && x > y)) continue;
                        WeV3 n = big.InteriorNormal;
                        if (small.InteriorNormal.Dot(n) < 1 - WeTol.Direction) continue;
                        double d1 = n.Dot(big.A.Flat()), dd = n.Dot(small.A.Flat()) - d1;
                        if (Math.Abs(dd) <= tol || Math.Abs(dd) > maxJog + tol) continue;
                        if (small.Length > maxJog + tol && Math.Abs(dd) > 0.3 * maxJog + tol) continue;
                        var t = new WeV3(-n.Y, n.X, 0);
                        WeV3 origin = n * d1;
                        Func<WeV3, double> tau = p => (p.Flat() - origin).Dot(t);
                        double lo1 = Math.Min(tau(big.A), tau(big.B)), hi1 = Math.Max(tau(big.A), tau(big.B));
                        double lo2 = Math.Min(tau(small.A), tau(small.B)), hi2 = Math.Max(tau(small.A), tau(small.B));
                        double joint;
                        if (Math.Abs(lo2 - hi1) <= tol) joint = hi1;
                        else if (Math.Abs(hi2 - lo1) <= tol) joint = lo1;
                        else continue;
                        double dLo = Math.Min(0, dd) - tol, dHi = Math.Max(0, dd) + tol;
                        WeBoundarySegment connector = segs.FirstOrDefault(s => s.IsStraight
                            && Math.Abs(tau(s.A) - joint) <= tol && Math.Abs(tau(s.B) - joint) <= tol
                            && n.Dot(s.A.Flat()) - d1 >= dLo && n.Dot(s.A.Flat()) - d1 <= dHi
                            && n.Dot(s.B.Flat()) - d1 >= dLo && n.Dot(s.B.Flat()) - d1 <= dHi
                            && Math.Abs((s.B - s.A).Flat().Length - Math.Abs(dd)) <= tol);
                        if (connector == null) continue;
                        connectors.Add(connector);

                        double lo = Math.Min(lo1, lo2), hi = Math.Max(hi1, hi2), z = big.A.Z;
                        var parts = new Dictionary<string, WeSidePart>(StringComparer.Ordinal);
                        foreach (WeSidePart p in big.Walls.Concat(small.Walls))
                        {
                            WeSidePart q;
                            if (!parts.TryGetValue(p.WallUniqueId, out q)) { q = new WeSidePart { WallUniqueId = p.WallUniqueId }; parts[p.WallUniqueId] = q; }
                            q.Length += p.Length;
                            q.ProbeDisagrees |= p.ProbeDisagrees;
                        }
                        var merged = new WeRoomSide
                        {
                            A = new WeV3((origin + t * lo).X, (origin + t * lo).Y, z),
                            B = new WeV3((origin + t * hi).X, (origin + t * hi).Y, z),
                            InteriorNormal = n,
                            ProbeDisagrees = big.ProbeDisagrees || small.ProbeDisagrees,
                            SegmentCount = big.SegmentCount + small.SegmentCount,
                            HasNonWall = big.HasNonWall || small.HasNonWall,
                            HasLinked = big.HasLinked || small.HasLinked,
                            Protrusion = Math.Max(big.Protrusion, Math.Max(0, dd + small.Protrusion)),
                            Recess = Math.Max(big.Recess, Math.Max(0, small.Recess - dd)),
                        };
                        // Зангуу (эхний хана) = урт талынх — түлхүүр хэвээр; бусад нь уртаараа.
                        string anchor = big.AnchorWallUid;
                        merged.Walls.AddRange(parts.Values.OrderByDescending(w => w.WallUniqueId == anchor ? 1 : 0)
                                                          .ThenByDescending(w => Math.Round(w.Length, 6))
                                                          .ThenBy(w => w.WallUniqueId, StringComparer.Ordinal));
                        long key = Math.Min(order[x].Key, order[y].Key);
                        int keep = Math.Min(x, y), drop = Math.Max(x, y);
                        order[keep] = new KeyValuePair<long, WeRoomSide>(key, merged);
                        order.RemoveAt(drop);
                        changed = true;
                    }
            }
            // Нэгдэж чадаагүй богино холбогч (нимгэн алхмын 100 мм-ийн «тал») — хажуугийн дэлгээст ирмэгээрээ харагдана, тусдаа
            // дэлгээс болгохгүй.
            for (int k = order.Count - 1; k >= start; k--)
            {
                WeRoomSide sd = order[k].Value;
                if (sd.IsCurved || sd.Length > 0.3 * maxJog + tol || sd.SegmentCount != 1) continue;
                bool isConnector = connectors.Any(c => (c.A.Flat() - sd.A.Flat()).Length <= tol && (c.B.Flat() - sd.B.Flat()).Length <= tol
                                                     || (c.A.Flat() - sd.B.Flat()).Length <= tol && (c.B.Flat() - sd.A.Flat()).Length <= tol);
                if (isConnector) order.RemoveAt(k);
            }
        }

        private static WeRoomSide FromFace(WeRoomFace f)
        {
            var s = new WeRoomSide
            {
                A = f.A, B = f.B, InteriorNormal = f.InteriorNormal, ChordNormal = f.ChordNormal,
                ProbeDisagrees = f.ProbeDisagrees, SegmentCount = f.SegmentCount,
            };
            s.Walls.Add(new WeSidePart { WallUniqueId = f.WallUniqueId, Length = f.Length, ProbeDisagrees = f.ProbeDisagrees });
            return s;
        }

        /// <summary>
        /// Нэг шулуун дээрх хоёр хэсгийн завсрыг [g0, g1] давж болох уу: завсарт үзүүрээрээ орсон бүх хил (энэ шулууны сегментээс
        /// бусад) шугамаас ≤ maxJog зайд, завсрын дотор байх ёстой; ядаж нэг байх ёстой (хоосон завсар = нээлттэй — давахгүй).
        /// Давж чадвал завсрын хилийг <paramref name="covered"/>-д нэмнэ.
        /// </summary>
        private static bool Bridge(List<WeBoundarySegment> others, WeV3 origin, WeV3 t, WeV3 n, double g0, double g1,
                                   double maxJog, double tol, out double protrusion, out double recess, out bool nonWall,
                                   HashSet<WeBoundarySegment> covered)
        {
            protrusion = 0;
            recess = 0;
            nonWall = false;
            var touched = new List<WeBoundarySegment>();
            foreach (WeBoundarySegment s in others)
            {
                double ta = (s.A.Flat() - origin).Dot(t), tb = (s.B.Flat() - origin).Dot(t);
                double da = (s.A.Flat() - origin).Dot(n), db = (s.B.Flat() - origin).Dot(n);
                bool aIn = ta > g0 - tol && ta < g1 + tol && Math.Abs(da) <= maxJog + tol;
                bool bIn = tb > g0 - tol && tb < g1 + tol && Math.Abs(db) <= maxJog + tol;
                if (!aIn && !bIn) continue;
                if (!aIn || !bIn) return false;   // завсраас гарч гүн рүү/хажуу тийш явсан хил
                // Муруй хил (тойрог булан г.м.) үзүүрээрээ завсарт байсан ч дунд нь maxJog-оос хол товойж болно — давахгүй, тусдаа тал
                // (аудит: 2 м радиусын хагас тойрог 8 м талд нэгдэж, far clip түүнийг тасалж байв).
                if (!s.IsStraight) return false;
                touched.Add(s);
                if (s.Host != WeBoundaryHost.Wall) nonWall = true;
                protrusion = Math.Max(protrusion, Math.Max(da, db));
                recess = Math.Max(recess, Math.Max(-da, -db));
            }
            if (touched.Count == 0) return false;
            if (covered != null) foreach (WeBoundarySegment s in touched) covered.Add(s);
            return true;
        }

        private static WeRoomSide Build(List<Seg> cluster, WeV3 origin, WeV3 t, WeV3 n, double lo, double hi, double prot, double rec,
                                        List<KeyValuePair<WeBoundarySegment, string>> skipped)
        {
            double z = cluster[0].S.A.Z;
            var walls = new Dictionary<string, WeSidePart>(StringComparer.Ordinal);
            bool nonWall = false, linked = false, disagree = false;
            foreach (Seg c in cluster)
            {
                WeBoundarySegment s = c.S;
                if (s.Host == WeBoundaryHost.Wall && !string.IsNullOrEmpty(s.WallUniqueId))
                {
                    WeSidePart part;
                    if (!walls.TryGetValue(s.WallUniqueId, out part)) { part = new WeSidePart { WallUniqueId = s.WallUniqueId }; walls[s.WallUniqueId] = part; }
                    part.Length += (s.B - s.A).Flat().Length;
                    bool dis = s.InteriorProbe.HasValue && !s.InteriorProbe.Value;
                    part.ProbeDisagrees |= dis;
                    disagree |= dis;
                }
                else if (s.Host == WeBoundaryHost.LinkedWall) linked = true;
                else nonWall = true;
            }
            if (walls.Count == 0)
            {
                if (skipped != null)
                    foreach (Seg c in cluster)
                        skipped.Add(new KeyValuePair<WeBoundarySegment, string>(c.S, c.S.Host == WeBoundaryHost.LinkedWall
                            ? "холбоос (link) загварын хана" : "хана биш хил (тусгаарлах шугам, багана …)"));
                return null;
            }
            var side = new WeRoomSide
            {
                A = new WeV3((origin + t * lo).X, (origin + t * lo).Y, z),
                B = new WeV3((origin + t * hi).X, (origin + t * hi).Y, z),
                InteriorNormal = n,
                ProbeDisagrees = disagree,
                SegmentCount = cluster.Count,
                HasNonWall = nonWall,
                HasLinked = linked,
                Protrusion = prot,
                Recess = rec,
            };
            side.Walls.AddRange(walls.Values.OrderByDescending(w => Math.Round(w.Length, 6)).ThenBy(w => w.WallUniqueId, StringComparer.Ordinal));
            return side;
        }

        /// <summary>Нэг зангуу хана, нэг чиглэлтэй хэд хэдэн тал (жишээ: дундах хаалт ханаар хуваагдсан) → 1, 2, … (байрлалаар).</summary>
        private static void AssignParts(List<WeRoomSide> sides)
        {
            foreach (IGrouping<string, WeRoomSide> g in sides.Where(s => !s.IsCurved && s.AnchorWallUid != null)
                                                            .GroupBy(s => s.AnchorWallUid + "|" + Math.Round(s.InteriorNormal.X, 3) + "|" + Math.Round(s.InteriorNormal.Y, 3)))
            {
                if (g.Count() < 2) continue;
                WeV3 n = g.First().InteriorNormal;
                var t = new WeV3(-n.Y, n.X, 0);
                int part = 1;
                foreach (WeRoomSide s in g.OrderBy(s => Math.Round(((s.A + s.B) * 0.5).Flat().Dot(t), 6)))
                    s.Part = part++;
            }
        }

        /// <summary>
        /// Талаас өрөөний ЭСРЭГ хил хүртэлх зай (талын 5 цэгээс дотор нормалийн дагуу цацраг → хамгийн ойр хил, медиан).
        /// Олдохгүй бол NaN.  «Өрөөний дунд хүртэл» харах гүн = үүний хагас.
        /// <paramref name="minDist"/>-ээс ойр хилийг тооцохгүй: нэгтгэсэн талын өөрийн бага зэрэг зөрсөн сегмент (хүлцэл доторх) ба
        /// давсан пилястр/баганын урд нүүр (цухуйлт) — эс бөгөөс цацраг тэднийг мөргөж гүн хэдэн мм болж унадаг (аудит, 2026-10-06).
        /// </summary>
        public static double DepthInFront(WeRoomInfo room, WeV3 a, WeV3 b, WeV3 interiorNormal, double minDist = 0)
        {
            if (room == null || room.Loops == null || interiorNormal.IsZero) return double.NaN;
            var hits = new List<double>();
            WeV3 n = interiorNormal.Flat().Normalized();
            foreach (double f in new[] { 0.1, 0.3, 0.5, 0.7, 0.9 })
            {
                WeV3 p = (a + (b - a) * f).Flat();
                double best = double.MaxValue;
                foreach (WeRoomLoop loop in room.Loops)
                    foreach (WeBoundarySegment s in loop.Segments)
                    {
                        double hit = Ray(p, n, s.A.Flat(), s.B.Flat());
                        if (hit > minDist && hit < best) best = hit;
                    }
                if (best < double.MaxValue) hits.Add(best);
            }
            if (hits.Count == 0) return double.NaN;
            hits.Sort();
            return hits.Count % 2 == 1 ? hits[hits.Count / 2] : (hits[hits.Count / 2 - 1] + hits[hits.Count / 2]) / 2;
        }

        /// <summary>Цацраг p + n·s (s &gt; 0.3 мм) ба AB хэрчмийн огтлолцол — s; байхгүй бол MaxValue.</summary>
        private static double Ray(WeV3 p, WeV3 n, WeV3 a, WeV3 b)
        {
            WeV3 e = b - a;
            double denom = n.X * e.Y - n.Y * e.X;
            if (Math.Abs(denom) < 1e-12) return double.MaxValue;
            WeV3 ap = a - p;
            double s = (ap.X * e.Y - ap.Y * e.X) / denom;
            double u = (ap.X * n.Y - ap.Y * n.X) / denom;
            if (s <= WeTol.Length || u < -1e-9 || u > 1 + 1e-9) return double.MaxValue;
            return s;
        }

        /// <summary>
        /// Ижил хана, ижил дотор нормаль, нэг шулуун дээрх сегментийг нэгтгэнэ (ханыг өөр хана тасалсан г.м.).
        /// Нэгтгэсэн хэсгийн эхлэл/төгсгөл = шулуун дагуух хамгийн бага/их проекц.
        /// </summary>
        internal static void Merge(List<WeRoomFace> faces, string wallUid, WeV3 a, WeV3 b, WeV3 interior, bool disagree)
        {
            foreach (WeRoomFace f in faces)
            {
                if (!string.Equals(f.WallUniqueId, wallUid, StringComparison.Ordinal)) continue;
                if (f.InteriorNormal.IsZero || f.InteriorNormal.Dot(interior) < 1 - WeTol.Direction) continue;
                // Нэг шулуун дээр: шинэ цэгүүд гадаргуугийн хавтгайгаас (нормалын дагуу) хүлцэлд.
                if (Math.Abs((a - f.A).Flat().Dot(interior)) > WeTol.Length || Math.Abs((b - f.A).Flat().Dot(interior)) > WeTol.Length) continue;

                WeV3 t = WallFrameCalculator.Tangent(f.A, f.B);
                double ta = 0, tb = (f.B - f.A).Flat().Dot(t);
                double pa = (a - f.A).Flat().Dot(t), pb = (b - f.A).Flat().Dot(t);
                double lo = Math.Min(Math.Min(ta, tb), Math.Min(pa, pb));
                double hi = Math.Max(Math.Max(ta, tb), Math.Max(pa, pb));
                WeV3 baseP = f.A;
                f.A = baseP + t * lo;
                f.B = baseP + t * hi;
                f.ProbeDisagrees |= disagree;
                f.SegmentCount++;
                return;
            }
            faces.Add(new WeRoomFace { WallUniqueId = wallUid, A = a, B = b, InteriorNormal = interior, ProbeDisagrees = disagree, SegmentCount = 1 });
        }

        /// <summary>
        /// Компасын азимут (0° = хойд/+Y, цагийн зүүгээр): харах чиглэлийнх.  Өрөөний A, B, C… үсгийг
        /// хойд → зүүн → урд → баруун дарааллаар өгөхөд ашиглана (хил дахин хуваагдсан ч үсэг тогтвортой).
        /// </summary>
        public static double Azimuth(WeV3 look)
        {
            double deg = Math.Atan2(look.X, look.Y) * 180.0 / Math.PI;
            if (deg < 0) deg += 360.0;
            // Тоон дуу чимээ (359.99999 ≈ 0) тэгш хэмийг эвдэхгүй.
            if (deg > 360.0 - 1e-6) deg = 0;
            return deg;
        }
    }
}
