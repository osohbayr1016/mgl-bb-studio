using System;
using System.Collections.Generic;
using System.Linq;
using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Structure;
using MglBb.Core;
using RevitMcpAddin.Reinforcement;
using RevitMcpAddin.Reinforcement.Core;

namespace MglBb.RevitSide
{
    /// <summary>
    /// Дамнурууны дэлгээсийн хомутын эгнээнд (MRA-ийн шугам дээр) бүс хоорондын хэмжээс — хөдөлгүүрт байхгүй (ЖИШЭЭ-2 ДДН-10-аас тайлангаар, 2026-10-21):
    /// дараалсан хоёр ГОЛ бүсийн хооронд багана байвал «сүүлийн хомут | баганын нүүр | баганын нүүр | эхний хомут» (50 | 700 | 50), байхгүй бол
    /// «хомут | хомут» (100, 150).  Богино нэмэлт бүс (≤ <see cref="BbMemberStandard.MraShortMaxBars"/> ширхэг — туслах дамнурууны огтлолцол) гинжинд
    /// орохгүй, түүнийг дайрсан шилжилтэд хэмжээс тавихгүй.  Гинжийн БҮХ гишүүний бүсийг нэгтгэж (гишүүн хоорондын баганад ч), харагдацын хүрээнд.
    /// Лавлагаа: дэлгээсийн геометрийн босоо шугам (хөдөлгүүрийн төгсгөлийн лавлагаатай ижил арга).  Нээлттэй Transaction дотор.  <c>src/Engine</c>-ийг засахгүй.
    /// </summary>
    internal static class BbElevStirrupDims
    {
        private sealed class Leg
        {
            public Reference Ref;
            public double R, V;
        }

        private sealed class Zone
        {
            public long Id;
            public int Count;
            public Leg First, Last;
        }

        internal sealed class Support
        {
            public double R0, R1;
            public Reference Near, Far;
            public Element El;
            public bool Framing;
        }

        /// <summary>Сүүлийн <see cref="Place"/>-ийн үүсгэсэн хэмжээсүүд (оношлогоо).</summary>
        [ThreadStatic] internal static List<ElementId> CreatedStore;
        internal static List<ElementId> Created { get { return CreatedStore ?? (CreatedStore = new List<ElementId>()); } }
        [ThreadStatic] private static Dictionary<long, double> WantedStore;
        private static Dictionary<long, double> Wanted { get { return WantedStore ?? (WantedStore = new Dictionary<long, double>()); } }

        /// <summary>Өөр хэрэгслийн (дээд гинж) CUT_EDGE-тэй хэмжээсийг <see cref="Restore"/>-д бүртгэнэ.</summary>
        public static void Track(Dimension d, double wantU)
        {
            if (d == null) return;
            Created.Add(d.Id);
            Wanted[d.Id.Value] = wantU;
        }

        /// <summary>
        /// Огтлолын ирмэг (CUT_EDGE) + бусад лавлагаатай хэмжээсийг дараагийн Regenerate 4.75 м доош шилжүүлдэг (ЖИШЭЭ 3 ТДН-1-5, хэмжсэн; тусад нь
        /// үүсгэхэд давтагддаггүй) — commit-ийн өмнө зориулсан эгнээнд нь буцаана.  Нээлттэй Transaction дотор.
        /// </summary>
        public static int Restore(Document doc, View view)
        {
            if (Created.Count == 0) return 0;
            BbFrame f = BbFrame.Of(view);
            int n = 0;
            // Зөөсний дараах Regenerate ч дахин шилжүүлж болно — тогтвортой болтол (≤ 3).
            for (int pass = 0; pass < 3; pass++)
            {
                doc.Regenerate();
                int moved = 0;
                foreach (ElementId id in Created)
                {
                    if (!(doc.GetElement(id) is Dimension d) || !(d.Curve is Line l) || !Wanted.TryGetValue(id.Value, out double want)) continue;
                    double du = want - f.Local(l.Origin).Y;
                    if (Math.Abs(du) < RfTol.MmToFt(1)) continue;
                    try { ElementTransformUtils.MoveElement(doc, id, f.U * du); moved++; } catch { }
                }
                n += moved;
                if (moved == 0) break;
            }
            return n;
        }

        public static int Place(Document doc, View view, IList<RfElevContext> ctxs, BbMemberStandard ms, ElementId dimTypeId, BbAnnoReport rep, string mark)
        {
            Created.Clear();
            Wanted.Clear();
            if (!ms.ElevStirrupGaps) return 0;
            List<RfElevContext> beams = ctxs.Where(c => !c.IsColumn && c.Input.Stirrups.Count > 0).ToList();
            if (beams.Count == 0) return 0;
            BbFrame f = BbFrame.Of(view);

            // Бүх гишүүний бүс (id-аар давхардалгүй); хомутын хөлийн өндрийн босго = ХОМУТЫН ӨӨРИЙН өндрийн 50 % (гүн гишүүний — ДДН-10-ийн
            // 2067 мм — гүнээр бол 616 мм-ийн хөл шүүгдэж X5 баганын хэмжээс алга болдог байв).
            var zones = new List<Zone>();
            var seen = new HashSet<long>();
            RfElevContext main = beams.OrderByDescending(c => c.Input.Stirrups.Count).First();
            foreach (RfElevContext c in beams)
            {
                foreach (RfElevStirrup s in c.Input.Stirrups)
                {
                    if (!seen.Add(s.Id) || !c.Rebars.TryGetValue(s.Id, out Rebar rb)) continue;
                    if (!Extent(rb, f, out double u0, out double u1)) continue;
                    var z = new Zone { Id = s.Id, Count = s.Count };
                    Legs(rb, view, f, 0.5 * (u1 - u0), out z.First, out z.Last);   // богино бүс ч — дарааллыг тасалдуулахад
                    if (z.First != null) zones.Add(z);
                }
            }
            zones = zones.OrderBy(z => z.First.R).ToList();
            // Нэг бүстэй (ТДН-4) ч захын баганын «250 | 75»-ыг тавина.
            if (zones.Count < 1 || !Extent(main.Host, f, out double mb, out double _)) return 0;
            int scale = view.Scale > 0 ? view.Scale : 50;
            double lineU = mb - RfTol.PaperMmToModelFt(Math.Max(1, ms.StirrupDimOffsetPaperMm), scale);
            // MRA-ийн хамгийн гадна шугамтай нэг эгнээнд (ДН-5: инженер 150 / 50-400-50-ыг MRA-ийн шугам дээр).
            double? mraLine = MraLine(doc, view, f);
            if (mraLine != null) lineU = mraLine.Value;
            double lowest = lineU;
            // Олон гишүүнтэй (өөр өндөр) дамнуруунд хэмжээс тухайн хэсгийн MRA-ийн мөрөнд (ДДН-3: 600 өндөр — 2006, 700 — 2106, 800 — 2206).
            // Гишүүн бүрийн ХАМГИЙН ДООД MRA-ийн мөр (богино бүсийн ойрын мөр биш) — R-ээр гишүүнийг олно.
            List<double[]> mraRows = MraRows(doc, view, f);
            var hostRows = new List<double[]>();   // [R0, R1, u]
            foreach (RfElevContext c in beams)
            {
                double lo = double.MaxValue, hi = double.MinValue;
                try { BoundingBoxXYZ hb = c.Host.get_BoundingBox(null); f.Extent(hb, out XYZ ha, out XYZ hz); lo = ha.X; hi = hz.X; } catch { continue; }
                List<double[]> mine = mraRows.Where(m => (m[0] + m[1]) / 2 > lo && (m[0] + m[1]) / 2 < hi).ToList();
                if (mine.Count > 0) hostRows.Add(new[] { lo, hi, mine.Min(m => m[2]) });
            }
            Func<double, double> RowAt = r => hostRows.Count == 0 ? lowest : hostRows.OrderBy(m => r < m[0] ? m[0] - r : r > m[1] ? r - m[1] : 0).First()[2];
            var dimType = dimTypeId != null && dimTypeId != ElementId.InvalidElementId ? doc.GetElement(dimTypeId) as DimensionType : null;
            List<Support> supports = Supports(doc, view, f);
            List<Support> ends = Supports(doc, view, f, true);
            // Энэ дамнуурнаас НАРИЙН эсрэг чиглэлийн дамнуруу = түүн дээр тулдаг хоёрдогч (ЖИШЭЭ 3 ТДН-1-9: 200 өргөн, хажуудаа 4 ширхэг/50 хомут) —
            // тулгуур биш, инженер «хомут | хомут» = 300.
            double hostW = 0;
            try { BoundingBoxXYZ hb = main.Host.get_BoundingBox(null); f.Extent(hb, out XYZ ha, out XYZ hz); hostW = hz.Z - ha.Z; } catch { }
            if (hostW > 0) ends = ends.Where(x => !x.Framing || x.R1 - x.R0 >= hostW - RfTol.MmToFt(5)).ToList();

            int made = 0;
            double tol = RfTol.MmToFt(5);
            Func<List<Reference>, double, double, double, string, bool> dim = (refs, r0, r1, depth, what) =>
            {
                var ra = new ReferenceArray();
                foreach (Reference rf in refs) ra.Append(rf);
                using (var st = new SubTransaction(doc))
                {
                    st.Start();
                    try
                    {
                        Line line = Line.CreateBound(f.World(r0, lineU, depth), f.World(r1, lineU, depth));
                        Dimension d = dimType != null ? doc.Create.NewDimension(view, line, ra, dimType) : doc.Create.NewDimension(view, line, ra);
                        if (d == null) throw new InvalidOperationException("NewDimension → null");
                        st.Commit();
                        made++;
                        Created.Add(d.Id);
                        Wanted[d.Id.Value] = lineU;
                        return true;
                    }
                    catch (Exception ex)
                    {
                        if (st.HasStarted() && !st.HasEnded()) st.RollBack();
                        rep?.Notes.Add(mark + " «" + view.Name + "»: " + what + " — " + (ex.Message ?? "").Split('\n')[0]);
                        return false;
                    }
                }
            };
            // Харагдацын бүх тэнхлэг (R → лавлагаа).
            var allGrids = new SortedDictionary<double, Reference>();
            foreach (RfElevContext c in beams)
                foreach (KeyValuePair<double, Element> g in c.Spans)
                {
                    if (!(g.Value is Grid)) continue;
                    double r = f.Local(c.Model(g.Key, 0)).X;
                    if (!allGrids.Keys.Any(x => Math.Abs(x - r) < tol)) allGrids[r] = new Reference(g.Value);
                }
            for (int i = 0; i + 1 < zones.Count; i++)
            {
                Zone a = zones[i], b = zones[i + 1];
                // Богино бүсийг дайрсан шилжилт — сурсан бол тэр ч (ЖИШЭЭ 3 ТДН-1-9: «100 | 300 | 100» туслах дамнууртай огтлолцолд).
                if (!ms.ElevStirrupGapsShort && (a.Count <= ms.MraShortMaxBars || b.Count <= ms.MraShortMaxBars)) continue;
                if (b.First.R <= a.Last.R) continue;
                var refs = new List<Reference> { a.Last.Ref };
                // Завсрын тулгуур — багана ЭСВЭЛ эсрэг чиглэлийн дамнуруу (ТДН-1-9: «50 | 600 | 50»).
                Support sp = ends.FirstOrDefault(x => x.R0 > a.Last.R - tol && x.R1 < b.First.R + tol);
                if (sp != null)
                {
                    // Дотор нь тэнхлэг: дамнуруу — оруулна (ДДН-3 «50 | 450 | 450 | 50»), туслах — үгүй (ТДН-1-9 «50 | 600 | 50»).
                    refs.Add(sp.Near);
                    if (ms.ElevGapGrid) foreach (var g in allGrids) if (g.Key > sp.R0 + tol && g.Key < sp.R1 - tol) refs.Add(g.Value);
                    refs.Add(sp.Far);
                }
                refs.Add(b.First.Ref);
                lineU = RowAt((a.Last.R + b.First.R) / 2);
                dim(refs, a.Last.R, b.First.R, a.Last.V, "хомутын бүс хоорондын хэмжээс (" + a.Id + " → " + b.Id + ")");
                lineU = lowest;
            }
            // Захын багана: «баганын өргөн | нүүрнээс эхний хомут» (ДН-5: 400 | 50 хоёр захад).  Хомут нүүрнээс 150 мм дотор л.
            double reach = RfTol.MmToFt(150);
            Zone z0 = zones[0], z1 = zones[zones.Count - 1];
            Support s0 = ends.Where(x => x.R1 <= z0.First.R + tol && z0.First.R - x.R1 <= reach).OrderByDescending(x => x.R1).FirstOrDefault();
            Func<Support, List<Reference>> faceRefs = sp =>
            {
                var l = new List<Reference> { sp.Near };
                // Захын тулгуурт: дамнуруу — тэнхлэгтэй (ДДН-3 баруун «50 | 250 | 550»), туслах — тэнхлэггүй (ТДН-1-11 «52 | 614»).
                if (ms.ElevGapGrid && ms.ElevGridChainToSupport) foreach (var g in allGrids) if (g.Key > sp.R0 + tol && g.Key < sp.R1 - tol) l.Add(g.Value);
                l.Add(sp.Far);
                return l;
            };
            lineU = RowAt(z0.First.R);
            if (s0 != null) { var l0 = faceRefs(s0); l0.Add(z0.First.Ref); dim(l0, s0.R0, z0.First.R, z0.First.V, "захын баганын хэмжээс (" + z0.Id + ")"); }
            Support s1 = ends.Where(x => x.R0 >= z1.Last.R - tol && x.R0 - z1.Last.R <= reach).OrderBy(x => x.R0).FirstOrDefault();
            lineU = RowAt(z1.Last.R);
            if (s1 != null) { var l1 = new List<Reference> { z1.Last.Ref }; l1.AddRange(faceRefs(s1)); dim(l1, z1.Last.R, s1.R1, z1.Last.V, "захын баганын хэмжээс (" + z1.Id + ")"); }
            lineU = lowest;
            // Тэнхлэг ганц бол хөдөлгүүр гинж зурдаггүй — «тулгуурын гадна нүүр | тэнхлэг | тулгуурын гадна нүүр», MRA-аас нэг алхам доош
            // (ТДН-2: багана | 1-р тэнхлэг | дамнуруу = 2950 | 100).
            if (ms.ElevSpans && s0 != null && s1 != null)
            {
                var grids = new SortedDictionary<double, Reference>();
                foreach (RfElevContext c in beams)
                    foreach (KeyValuePair<double, Element> g in c.Spans)
                    {
                        if (!(g.Value is Grid)) continue;
                        double r = f.Local(c.Model(g.Key, 0)).X;
                        if (r > s0.R0 + tol && r < s1.R1 - tol && !grids.Keys.Any(x => Math.Abs(x - r) < tol)) grids[r] = new Reference(g.Value);
                    }
                if (grids.Count == 1)
                {
                    // Тэнхлэг байгаа тулгуурын ХОЁР нүүр (ББ инженер 2026-10-23: «300 | 300 | 5974»).
                    double g = grids.Keys.First();
                    var refs = new List<Reference> { s0.Near };
                    if (g > s0.R0 && g < s0.R1) { refs.Add(grids[g]); refs.Add(s0.Far); }
                    else if (g > s1.R0 && g < s1.R1) { refs.Add(s1.Near); refs.Add(grids[g]); }
                    else refs.Add(grids[g]);
                    refs.Add(s1.Far);
                    lineU -= RfTol.PaperMmToModelFt(Math.Max(2, ms.DimPitchPaperMm), scale);
                    dim(refs, s0.R0, s1.R1, z0.First.V, "тулгуур хоорондын гинж");
                }
            }
            // Тэнхлэгийн гинж(үүд): гишүүн бүрийнхийг НЭГ гинж болгож, захын тулгуурт (эсвэл тулгуургүй бол дамнурууны төгсгөлд) хүртэл сунгана
            // (ТДН-1-9: «… | 7141»; ДДН-3: «550 | 7500 | 6500 | 7000 | 9500 | 9500 | 3026»).
            if (ms.ElevSpans && allGrids.Count >= 2)
                ExtendGridChain(doc, view, f, s0, s1, ctxs.Where(c => !c.IsColumn).ToList(), allGrids, dimType, rep, mark, tol, ms.ElevGridChainToSupport);
            // Эсрэг чиглэлийн (огтлолоор харагдах) тулгуур дамнуурын өндөр — тулгуурын гадна талд босоо (ББ инженер 2026-10-23: хоёр талд;
            // ЖИШЭЭ 3 ТДН-1-5: «500» баруун нүүрээс ≈ 9 мм).
            double off = RfTol.PaperMmToModelFt(Math.Max(2, ms.ElevDimFirstPaperMm), scale);
            foreach (Support sp in new[] { s0, s1 })
            {
                if (sp == null || !sp.Framing || sp.El == null) continue;
                if (!HorizontalFaces(sp.El, view, f, out Leg bot, out Leg top)) continue;
                double r = sp == s0 ? sp.R0 - off : sp.R1 + off;
                using (var st = new SubTransaction(doc))
                {
                    st.Start();
                    try
                    {
                        var ra = new ReferenceArray();
                        ra.Append(bot.Ref); ra.Append(top.Ref);
                        Line line = Line.CreateBound(f.World(r, bot.R, 0), f.World(r, top.R, 0));
                        Dimension d = dimType != null ? doc.Create.NewDimension(view, line, ra, dimType) : doc.Create.NewDimension(view, line, ra);
                        if (d == null) throw new InvalidOperationException("NewDimension → null");
                        st.Commit();
                        made++;
                    }
                    catch (Exception ex)
                    {
                        if (st.HasStarted() && !st.HasEnded()) st.RollBack();
                        rep?.Notes.Add(mark + " «" + view.Name + "»: тулгуур дамнуурын өндөр — " + (ex.Message ?? "").Split('\n')[0]);
                    }
                }
            }
            return made;
        }

        /// <summary>Харагдацын MRA-ийн хэмжээсийн шугамын хамгийн доод u (MRA байхгүй бол null).</summary>
        /// <summary>MRA бүрийн [R0, R1, шугамын u].</summary>
        private static List<double[]> MraRows(Document doc, View view, BbFrame f)
        {
            var res = new List<double[]>();
            foreach (MultiReferenceAnnotation m in new FilteredElementCollector(doc, view.Id).OfClass(typeof(MultiReferenceAnnotation)).Cast<MultiReferenceAnnotation>())
            {
                if (m.OwnerViewId != view.Id || !(doc.GetElement(m.DimensionId) is Dimension d) || !(d.Curve is Line l)) continue;
                double lo = double.MaxValue, hi = double.MinValue;
                try
                {
                    if (d.Segments != null && d.Segments.Size > 0)
                        foreach (DimensionSegment sg in d.Segments) { double o = f.Local(sg.Origin).X, h = (sg.Value ?? 0) / 2; lo = Math.Min(lo, o - h); hi = Math.Max(hi, o + h); }
                    else { double o = f.Local(d.Origin).X, h = (d.Value ?? 0) / 2; lo = o - h; hi = o + h; }
                }
                catch { continue; }
                if (lo <= hi) res.Add(new[] { lo, hi, f.Local(l.Origin).Y });
            }
            return res;
        }

        private static double? MraLine(Document doc, View view, BbFrame f)
        {
            double? best = null;
            foreach (MultiReferenceAnnotation m in new FilteredElementCollector(doc, view.Id).OfClass(typeof(MultiReferenceAnnotation)).Cast<MultiReferenceAnnotation>())
            {
                if (m.OwnerViewId != view.Id || !(doc.GetElement(m.DimensionId) is Dimension d) || !(d.Curve is Line l)) continue;
                double u = f.Local(l.Origin).Y;
                if (best == null || u < best.Value) best = u;
            }
            return best;
        }

        /// <summary>Элементийн босоо муж (харагдацын u).</summary>
        private static bool Extent(Element e, BbFrame f, out double u0, out double u1)
        {
            u0 = u1 = 0;
            BoundingBoxXYZ bb = e?.get_BoundingBox(null);
            if (bb == null) return false;
            f.Extent(bb, out XYZ a, out XYZ b);
            u0 = a.Y; u1 = b.Y;
            return true;
        }

        /// <summary>Хомутын олонлогийн эхний / сүүлийн ширхгийн босоо шугамын лавлагаа (өндөр ≥ <paramref name="minLen"/>); хэд хэдэн шугамтай бол дунджид ойр.</summary>
        private static void Legs(Rebar rb, View view, BbFrame f, double minLen, out Leg first, out Leg last)
        {
            first = last = null;
            GeometryElement ge;
            try { ge = rb.get_Geometry(new Options { ComputeReferences = true, View = view, IncludeNonVisibleObjects = true }); }
            catch { return; }
            if (ge == null) return;
            var legs = new List<Leg>();
            Walk(ge, l =>
            {
                Reference rf;
                try { rf = l.Reference; } catch { return; }
                if (rf == null) return;
                XYZ pa = f.Local(l.GetEndPoint(0)), pb = f.Local(l.GetEndPoint(1));
                double dr = pb.X - pa.X, du = pb.Y - pa.Y, len = Math.Sqrt(dr * dr + du * du);
                if (len < minLen || Math.Abs(dr) / len > 0.05) return;
                legs.Add(new Leg { Ref = rf, R = (pa.X + pb.X) / 2, V = (pa.Z + pb.Z) / 2 });
            });
            if (legs.Count == 0) return;
            double tol = RfTol.MmToFt(20);
            double lo = legs.Min(x => x.R), hi = legs.Max(x => x.R);
            first = Pick(legs.Where(x => x.R <= lo + tol).ToList());
            last = Pick(legs.Where(x => x.R >= hi - tol).ToList());
        }

        private static Leg Pick(List<Leg> g)
        {
            double mid = g.Average(x => x.R);
            return g.OrderBy(x => Math.Abs(x.R - mid)).First();
        }

        /// <summary>
        /// Харагдацын баганууд: дамнурууны дагуух хоёр нүүрний (тэнхлэгт перпендикуляр) лавлагаа.  <paramref name="framing"/> = огтлолоор харагдах
        /// (тэнхлэг нь харагдацын R-д перпендикуляр) дамнуруу ч тулгуур — ТДН-2-ийн баруун зах дамнуруун дээр тулдаг («25 | 300»).
        /// </summary>
        internal static List<Support> Supports(Document doc, View view, BbFrame f, bool framing = false)
        {
            var res = new List<Support>();
            List<Leg> hostEdges = null;
            var els = new FilteredElementCollector(doc, view.Id).OfCategory(BuiltInCategory.OST_StructuralColumns).WhereElementIsNotElementType().ToList();
            if (framing)
                els.AddRange(new FilteredElementCollector(doc, view.Id).OfCategory(BuiltInCategory.OST_StructuralFraming).WhereElementIsNotElementType()
                    .Where(e => e.Location is LocationCurve lc && lc.Curve is Line ln && Math.Abs(ln.Direction.DotProduct(f.R)) < 0.5));   // ТДН-1-11: 12° налуу (0.21)
            foreach (Element col in els)
            {
                GeometryElement ge;
                try { ge = col.get_Geometry(new Options { ComputeReferences = true, View = view }); }
                catch { continue; }
                if (ge == null) continue;
                var faces = new List<Leg>();
                var cuts = new List<Leg>();
                double hx0 = double.MaxValue, hx1 = double.MinValue;   // хэвтээ огтлолын ирмэгийн R-муж (тулгуурын бүтэн өргөн)
                bool skew = false;
                WalkSolids(ge, s =>
                {
                    foreach (Face fc in s.Faces)
                    {
                        if (!(fc is PlanarFace pf) || pf.Reference == null) continue;
                        double dot = Math.Abs(pf.FaceNormal.DotProduct(f.R));
                        if (dot < 0.9) continue;   // ТДН-1-11: 12° налуу тулгуурын нүүр 0.977
                        if (dot < 0.99999) skew = true;
                        faces.Add(new Leg { Ref = pf.Reference, R = PlaneR(f, pf.Origin, pf.FaceNormal) });
                    }
                    // Огтлолын хавтгай дахь босоо ирмэг (CUT_EDGE) — налуу нүүрний SURFACE лавлагаатай хэмжээс commit-д «invalid reference» болж БҮХ
                    // тэмдэглэгээг буцаадаг байв (ЖИШЭЭ 3 ТДН-1-5, 3° тулгуур); инженер ч «…:24:CUT_EDGE/5»-аар хэмжсэн.
                    foreach (Edge ed in s.Edges)
                    {
                        if (ed.Reference == null || !(ed.AsCurve() is Line l)) continue;
                        XYZ a = f.Local(l.GetEndPoint(0)), b = f.Local(l.GetEndPoint(1));
                        if (Math.Abs(a.Z) > 0.05 || Math.Abs(b.Z) > 0.05) continue;
                        if (Math.Abs(a.Y - b.Y) < RfTol.MmToFt(1)) { hx0 = Math.Min(hx0, Math.Min(a.X, b.X)); hx1 = Math.Max(hx1, Math.Max(a.X, b.X)); }
                        if (Math.Abs(a.X - b.X) > RfTol.MmToFt(1)) continue;
                        cuts.Add(new Leg { Ref = ed.Reference, R = (a.X + b.X) / 2 });
                    }
                });
                // Нэг тал нь туслах дамнууртай нийлсэн (ЖИШЭЭ 3 ТДН-1-8: босоо ирмэг ганц, нөгөө тал = гишүүний төгсгөлийн ирмэг) — тэр ирмэгээр
                // нөхнө (инженер ч «73afbc84…:24:CUT_EDGE/1/3»).
                if (skew && cuts.Count == 1 && hx1 - hx0 > RfTol.MmToFt(50))
                {
                    double miss = Math.Abs(cuts[0].R - hx0) < Math.Abs(cuts[0].R - hx1) ? hx1 : hx0;
                    Leg other = (hostEdges ?? (hostEdges = HostCutEdges(doc, view, f))).OrderBy(x => Math.Abs(x.R - miss)).FirstOrDefault();
                    if (other != null && Math.Abs(other.R - miss) < RfTol.MmToFt(3)) cuts.Add(other);
                }
                if (skew) { if (cuts.Count < 2) continue; faces = cuts; }   // огтлогдоогүй налуу тулгуурын нүүр хэмжиж болохгүй
                if (faces.Count < 2) continue;
                Leg near = faces.OrderBy(x => x.R).First(), far = faces.OrderBy(x => x.R).Last();
                if (far.R - near.R < RfTol.MmToFt(50)) continue;
                res.Add(new Support { R0 = near.R, R1 = far.R, Near = near.Ref, Far = far.Ref, El = col, Framing = col.Category?.Id.Value == (long)BuiltInCategory.OST_StructuralFraming });
            }
            return res.OrderBy(x => x.R0).ToList();
        }

        /// <summary>
        /// Хөдөлгүүрийн тэнхлэгийн гинж сүүлийн тэнхлэгээр дуусдаг — захын тулгуурт тэнхлэг байхгүй бол тулгуурын гадна нүүр хүртэл сунгана
        /// (ЖИШЭЭ 3 ТДН-1-9: «6500 | 6500 | 8500 | 7141»).  Шинийг ижил шугамд үүсгээд хуучныг устгана.
        /// </summary>
        private static void ExtendGridChain(Document doc, View view, BbFrame f, Support s0, Support s1, List<RfElevContext> beams,
                                            SortedDictionary<double, Reference> allGrids, DimensionType dimType, BbAnnoReport rep, string mark, double tol, bool toSupport)
        {
            // Харагдацын тэнхлэг-л хэмжээсүүд (≥ 2 тэнхлэг).  Эхний—сүүлийн тэнхлэгийн НИЙТ урт (3+ тэнхлэгтэй үед) — хэвээр.
            var gridR = new Dictionary<long, double>();
            foreach (RfElevContext c in beams)
                foreach (KeyValuePair<double, Element> g in c.Spans)
                    if (g.Value is Grid) gridR[g.Value.Id.Value] = f.Local(c.Model(g.Key, 0)).X;
            var dims = new List<KeyValuePair<Dimension, List<long>>>();
            foreach (Dimension d in new FilteredElementCollector(doc, view.Id).OfClass(typeof(Dimension)).Cast<Dimension>().ToList())
            {
                if (d.OwnerViewId != view.Id || !(d.Curve is Line)) continue;
                var ids = new List<long>();
                try { foreach (Reference r in d.References) ids.Add(r.ElementId.Value); } catch { continue; }
                if (ids.Count < 2 || !ids.All(id => doc.GetElement(new ElementId(id)) is Grid)) continue;
                dims.Add(new KeyValuePair<Dimension, List<long>>(d, ids));
            }
            if (dims.Count == 0) return;
            var union = dims.SelectMany(x => x.Value).Distinct().Where(gridR.ContainsKey).OrderBy(id => gridR[id]).ToList();
            if (union.Count < 2) return;
            if (union.Count >= 3)
                dims.RemoveAll(x => x.Value.Count == 2 && x.Value.Contains(union[0]) && x.Value.Contains(union[union.Count - 1]));   // нийт
            if (dims.Count == 0) return;
            double gMin = gridR[union[0]], gMax = gridR[union[union.Count - 1]];

            // Захын лавлагаа: тулгуурт тэнхлэг байхгүй бол тулгуурын гадна нүүр; тулгуургүй бол дамнурууны төгсгөлийн нүүр (ДДН-3 зүүн зах).
            var ends = new List<KeyValuePair<double, Reference>>();
            foreach (RfElevContext c in beams) ends.AddRange(BbElevTopChain.EndFaceRefs(c.Host, view, f));
            KeyValuePair<double, Reference>? left = null, right = null;
            KeyValuePair<double, Reference>? eL = ends.Count > 0 ? ends.OrderBy(x => x.Key).First() : (KeyValuePair<double, Reference>?)null;
            KeyValuePair<double, Reference>? eR = ends.Count > 0 ? ends.OrderBy(x => x.Key).Last() : (KeyValuePair<double, Reference>?)null;
            // Тулгуураас цааш гарсан консол (ДДН-3 зүүн: 3026) — дамнурууны төгсгөл хүртэл; эс бөгөөс тэнхлэггүй тулгуурын гадна нүүр хүртэл.
            // Тэнхлэг тулгуурын дотор байсан ч гадна нүүр хүртэл (ДДН-3 баруун: «… | 550»; ББ инженер: тулгуурын нүүрийг оруулна).
            if (s0 != null && eL != null && eL.Value.Key < s0.R0 - tol) left = eL;
            else if (s0 != null) { if (s0.R0 < gMin - tol && (toSupport || !(gMin > s0.R0 - tol && gMin < s0.R1 + tol))) left = new KeyValuePair<double, Reference>(s0.R0, s0.Near); }
            else if (eL != null && eL.Value.Key < gMin - tol) left = eL;
            if (s1 != null && eR != null && eR.Value.Key > s1.R1 + tol) right = eR;
            else if (s1 != null) { if (s1.R1 > gMax + tol && (toSupport || !(gMax > s1.R0 - tol && gMax < s1.R1 + tol))) right = new KeyValuePair<double, Reference>(s1.R1, s1.Far); }
            else if (eR != null && eR.Value.Key > gMax + tol) right = eR;
            Func<double, string> mm = x => BbGeom.ToMm(x).ToString("0");
            string why = "grids " + string.Join(",", union.Select(id => mm(gridR[id]))) + " dims " + dims.Count + " s0 " + (s0 == null ? "-" : mm(s0.R0) + ".." + mm(s0.R1)) + " s1 " + (s1 == null ? "-" : mm(s1.R0) + ".." + mm(s1.R1))
                         + " ends " + string.Join(",", ends.Select(x => mm(x.Key))) + " → left " + (left == null ? "-" : mm(left.Value.Key)) + " right " + (right == null ? "-" : mm(right.Value.Key));
            try { System.IO.File.WriteAllText(System.IO.Path.Combine(Paths.Root, "gridchain-log.txt"), DateTime.Now.ToString("s") + " «" + view.Name + "» " + why, new System.Text.UTF8Encoding(true)); } catch { }
            if (left == null && right == null && dims.Count == 1 && dims[0].Value.Count == union.Count) return;   // аль хэдийн бүтэн

            double u = dims.Min(x => f.Local(((Line)x.Key.Curve).Origin).Y);
            double r0 = left?.Key ?? gMin, r1 = right?.Key ?? gMax;
            Support a = s0, b = s1;
            // Revit тулгуурын огтлолын ирмэгийг заримдаа хасдаг (дээд гинж шиг) — дутуу бол устгаад Regenerate, тулгуурыг шинээр авч дахин.
            for (int attempt = 0; attempt < 3; attempt++)
            {
                if (attempt > 0)
                {
                    doc.Regenerate();
                    List<Support> fresh = Supports(doc, view, f, true);
                    if (s0 != null && left != null && left.Value.Value == (a?.Near)) { a = fresh.FirstOrDefault(x => Math.Abs(x.R0 - s0.R0) < tol) ?? s0; left = new KeyValuePair<double, Reference>(a.R0, a.Near); }
                    if (s1 != null && right != null && right.Value.Value == (b?.Far)) { b = fresh.FirstOrDefault(x => Math.Abs(x.R1 - s1.R1) < tol) ?? s1; right = new KeyValuePair<double, Reference>(b.R1, b.Far); }
                }
                // Хуучин хэмжээсийн тэнхлэгийн лавлагаа шинэд «Invalid number of references» — элементээс нь (хэмжсэн).
                var list = union.Select(id => new Reference(doc.GetElement(new ElementId(id)))).ToList();
                if (left != null) list.Insert(0, left.Value.Value);
                if (right != null) list.Add(right.Value.Value);
                Dimension nd = null;
                using (var st = new SubTransaction(doc))
                {
                    st.Start();
                    try
                    {
                        var ra = new ReferenceArray();
                        foreach (Reference r in list) ra.Append(r);
                        Line line = Line.CreateBound(f.World(r0, u, 0), f.World(r1, u, 0));
                        nd = dimType != null ? doc.Create.NewDimension(view, line, ra, dimType) : doc.Create.NewDimension(view, line, ra);
                        if (nd != null && (nd.Segments?.Size ?? 0) < list.Count - 1) { doc.Delete(nd.Id); nd = null; }
                        st.Commit();
                    }
                    catch (Exception ex)
                    {
                        if (st.HasStarted() && !st.HasEnded()) st.RollBack();
                        nd = null;
                        if (attempt == 2) rep?.Notes.Add(mark + " «" + view.Name + "»: тэнхлэгийн гинж нэгтгэх — " + (ex.Message ?? "").Split('\n')[0]);
                    }
                }
                if (nd == null) continue;
                Created.Add(nd.Id);
                Wanted[nd.Id.Value] = u;
                foreach (var x in dims) try { doc.Delete(x.Key.Id); } catch { }
                break;
            }
        }

        /// <summary>Харагдацын дагуух (R-тэй зэрэгцээ) дамнуруунуудын огтлолын БОСОО ирмэгүүд — төгсгөлийн ирмэг.</summary>
        private static List<Leg> HostCutEdges(Document doc, View view, BbFrame f)
        {
            var res = new List<Leg>();
            foreach (Element e in new FilteredElementCollector(doc, view.Id).OfCategory(BuiltInCategory.OST_StructuralFraming).WhereElementIsNotElementType()
                         .Where(e => e.Location is LocationCurve lc && lc.Curve is Line ln && Math.Abs(ln.Direction.DotProduct(f.R)) > 0.9))
            {
                GeometryElement ge;
                try { ge = e.get_Geometry(new Options { ComputeReferences = true, View = view }); } catch { continue; }
                if (ge == null) continue;
                WalkSolids(ge, s =>
                {
                    foreach (Edge ed in s.Edges)
                    {
                        if (ed.Reference == null || !(ed.AsCurve() is Line l)) continue;
                        XYZ a = f.Local(l.GetEndPoint(0)), b = f.Local(l.GetEndPoint(1));
                        if (Math.Abs(a.Z) > 0.05 || Math.Abs(b.Z) > 0.05) continue;
                        if (Math.Abs(a.X - b.X) < RfTol.MmToFt(1)) { res.Add(new Leg { Ref = ed.Reference, R = (a.X + b.X) / 2 }); continue; }
                        // Төгсгөлийн босоо ирмэг геометрт ирдэггүй — хэвтээ огтлолын ирмэгийн ҮЗҮҮРИЙН цэг («…:24:CUT_EDGE/3» → «…:24:CUT_EDGE/1/3»,
                        // ЖИШЭЭ 3 ТДН-1-8-д инженерийн хэмжсэн лавлагаа).
                        string rep;
                        try { rep = ed.Reference.ConvertToStableRepresentation(doc); } catch { continue; }
                        int i = rep.LastIndexOf(":CUT_EDGE/", StringComparison.Ordinal);
                        if (i < 0) continue;
                        for (int k = 0; k < 2; k++)
                        {
                            try
                            {
                                Reference pr = Reference.ParseFromStableRepresentation(doc, rep.Substring(0, i) + ":CUT_EDGE/" + k + "/" + rep.Substring(i + 10));
                                if (pr != null) res.Add(new Leg { Ref = pr, R = k == 0 ? a.X : b.X });
                            }
                            catch { }
                        }
                    }
                });
            }
            return res;
        }

        /// <summary>Огтлолоор харагдах дамнуурын доод/дээд хэвтээ нүүр (Leg.R = харагдацын u); огтлолын ирмэгийг (CUT_EDGE) түрүүлж.</summary>
        private static bool HorizontalFaces(Element e, View view, BbFrame f, out Leg bot, out Leg top)
        {
            bot = top = null;
            GeometryElement ge;
            try { ge = e.get_Geometry(new Options { ComputeReferences = true, View = view }); } catch { return false; }
            if (ge == null) return false;
            var cuts = new List<Leg>();
            var faces = new List<Leg>();
            WalkSolids(ge, s =>
            {
                foreach (Edge ed in s.Edges)
                {
                    if (ed.Reference == null || !(ed.AsCurve() is Line l)) continue;
                    XYZ a = f.Local(l.GetEndPoint(0)), b = f.Local(l.GetEndPoint(1));
                    if (Math.Abs(a.Z) > 0.05 || Math.Abs(b.Z) > 0.05 || Math.Abs(a.Y - b.Y) > RfTol.MmToFt(1) || Math.Abs(a.X - b.X) < RfTol.MmToFt(50)) continue;
                    cuts.Add(new Leg { Ref = ed.Reference, R = (a.Y + b.Y) / 2 });
                }
                foreach (Face fc in s.Faces)
                    if (fc is PlanarFace pf && pf.Reference != null && Math.Abs(pf.FaceNormal.DotProduct(f.U)) > 0.999)
                        faces.Add(new Leg { Ref = pf.Reference, R = f.Local(pf.Origin).Y });
            });
            List<Leg> use = cuts.Count >= 2 ? cuts : faces;
            if (use.Count < 2) return false;
            bot = use.OrderBy(x => x.R).First(); top = use.OrderBy(x => x.R).Last();
            return top.R - bot.R > RfTol.MmToFt(50);
        }

        /// <summary>
        /// Нүүрний хавтгай харагдацын хавтгайг (гүн 0) огтлох R.  Origin-ийн R налуу дамнуурын нүүрэнд буруу — ЖИШЭЭ 3 ТДН-1-5-ын тулгуур 3°
        /// налуу, Origin 5.8 м цаана тул 2479-ын оронд 2780 гарч байв.
        /// </summary>
        internal static double PlaneR(BbFrame f, XYZ origin, XYZ normal)
        {
            XYZ p = f.Local(origin), n = f.Local(origin + normal) - p;
            return Math.Abs(n.X) < 1e-6 ? p.X : p.X + n.Z * p.Z / n.X;
        }

        private static void Walk(GeometryElement ge, Action<Line> onLine)
        {
            foreach (GeometryObject go in ge)
            {
                if (go is Line l) { onLine(l); continue; }
                if (go is GeometryInstance gi)
                {
                    GeometryElement sub = null;
                    try { sub = gi.GetSymbolGeometry(); } catch { }
                    if (sub != null) Walk(sub, onLine);
                }
            }
        }

        private static void WalkSolids(GeometryElement ge, Action<Solid> onSolid)
        {
            foreach (GeometryObject go in ge)
            {
                if (go is Solid s && s.Faces.Size > 0) { onSolid(s); continue; }
                if (go is GeometryInstance gi)
                {
                    GeometryElement sub = null;
                    try { sub = gi.GetInstanceGeometry(); } catch { }
                    if (sub != null) WalkSolids(sub, onSolid);
                }
            }
        }
    }
}
