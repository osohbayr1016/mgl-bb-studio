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
    /// Үндсэн хөдөлгүүрийн (RfElevationService) дэлгээсийг компанийн стандарт руу ойртуулах өмнөх/дараах алхмууд.  Хөдөлгүүрийн эх код
    /// ХӨНДӨГДӨХГҮЙ — зөвхөн түүний оролт (<see cref="RfElevContext.Input"/>) ба гаралтыг (<see cref="RfElevReport"/>) засна.
    /// <list type="number">
    /// <item><see cref="DedupeStirrups"/> — нэг байрлалд давхар (дотор/гадна) хомутын хоёр олонлог байвал НЭГ MRA (харагчид ойрынх).
    /// ЖИШЭЭ-1: 4 салаат хомут = хоёр ижил олонлог; инженер нэгийг л тэмдэглэдэг.  Өмнө нь MRA хоёр дахин олон (56 ↔ 26) болж тархаж байв.</item>
    /// <item><see cref="SplitBarGroups"/> — ижил дугаартай боловч өөр байрлалын арматур бүр өөрийн шошготой (инженер элемент бүрийг тэмдэглэдэг).</item>
    /// <item><see cref="RelayoutMras"/> — MRA-г <see cref="BbMraLayout"/>-ын дүрмээр (хоёр эгнээ, толгой шугамаас гишүүн рүү) дахин үүсгэнэ.</item>
    /// <item><see cref="SideTags"/> — хажуугийн (дунд өндрийн) арматурын шошгыг гишүүний дунд өндөрт, хэвтээ leader-тэй.</item>
    /// </list>
    /// ⚠️ Бүгд нээлттэй Transaction ДОТОР (Render-ийн дараах алхмууд).
    /// </summary>
    internal static class BbElevMra
    {
        // ── 0. Харагдацад тааруулах ─────────────────────────────────────

        /// <summary>
        /// (1) Гишүүний v-мужийг хостын ХҮРЭЭНИЙ (bbox) хэмжээгээр — хавтантай нийлсэн дам нурууны геометр хавтангийн доод талд тасардаг тул хөдөлгүүрийн
        /// «дээд ирмэг» 200 мм доор гарч дээд шошго ирмэг дээрээ наалддаг байв (инженер хүрээнээс 4.6 мм дээш).  (2) Хэсэгчилсэн дэлгээсэд (Copy 1 г.м.)
        /// u-мужийг crop-оор хязгаарлаж, crop-оос гадна хомутын олонлогийг хасаж, арматурын мужийг харагдах хэсгээр тайрна — шошго харагдацаас гадна гарахгүй.
        /// </summary>
        public static void FitToView(RfElevContext c)
        {
            try
            {
                BoundingBoxXYZ hb = c.Host.get_BoundingBox(null);
                if (hb != null && Corners(c, hb, out RfV2 a, out RfV2 b))
                {
                    if (b.Y > c.Input.BeamV1) c.Input.BeamV1 = b.Y;
                    if (a.Y < c.Input.BeamV0) c.Input.BeamV0 = a.Y;
                }
            }
            catch { }
            if (!c.View.CropBoxActive) return;
            if (!Corners(c, c.View.CropBox, out RfV2 ca, out RfV2 cb)) return;
            double margin = RfTol.PaperMmToModelFt(2, c.View.Scale > 0 ? c.View.Scale : 50);
            double cu0 = ca.X + margin, cu1 = cb.X - margin;
            if (cu1 <= cu0) return;
            c.Input.BeamU0 = Math.Max(c.Input.BeamU0, cu0);
            c.Input.BeamU1 = Math.Min(c.Input.BeamU1, cu1);
            c.Input.Stirrups.RemoveAll(s => (s.U0 + s.U1) / 2 < cu0 || (s.U0 + s.U1) / 2 > cu1);
            c.Input.Bars.RemoveAll(x => x.U1 < cu0 || x.U0 > cu1);
            foreach (RfElevBar x in c.Input.Bars)
            {
                if (x.U0 < cu0) { x.U0 = cu0; x.Straight = false; }
                if (x.U1 > cu1) { x.U1 = cu1; x.Straight = false; }
            }
            c.Input.GridU.RemoveAll(g => g < ca.X - margin || g > cb.X + margin);
        }

        private static bool Corners(RfElevContext c, BoundingBoxXYZ bb, out RfV2 min, out RfV2 max)
        {
            Transform t = bb.Transform ?? Transform.Identity;
            double u0 = double.MaxValue, v0 = double.MaxValue, u1 = double.MinValue, v1 = double.MinValue;
            foreach (double x in new[] { bb.Min.X, bb.Max.X })
                foreach (double y in new[] { bb.Min.Y, bb.Max.Y })
                    foreach (double zz in new[] { bb.Min.Z, bb.Max.Z })
                    {
                        RfV2 p = c.Frame.ToView(RfConv.V(t.OfPoint(new XYZ(x, y, zz))));
                        u0 = Math.Min(u0, p.X); u1 = Math.Max(u1, p.X); v0 = Math.Min(v0, p.Y); v1 = Math.Max(v1, p.Y);
                    }
            min = new RfV2(u0, v0); max = new RfV2(u1, v1);
            return u1 >= u0;
        }

        // ── 1. Давхар хомут ─────────────────────────────────────────────

        public static int DedupeStirrups(RfElevContext c)
        {
            // Хомутын MRA зөвхөн ХОМУТ хэлбэрт (StirrupTie) — хөдөлгүүр хөндлөн байрласан ердийн арматурыг (туслах дам нурууны огтлолцлын ⌀22, ⌀16)
            // «хомут» гэж ангилж MRA тавьдаг байв; инженер тэдэнд MRA тавьдаггүй (ЖИШЭЭ-1 ДН-1: 26 MRA бүгд ⌀8 хомут).
            c.Input.Stirrups.RemoveAll(s => !c.Rebars.TryGetValue(s.Id, out Rebar rb) || !(c.Doc.GetElement(rb.GetShapeId()) is RebarShape sh) || sh.RebarStyle != RebarStyle.StirrupTie);
            double tol = BbGeom.Ft(15);
            var groups = new List<List<RfElevStirrup>>();
            foreach (RfElevStirrup s in c.Input.Stirrups)
            {
                List<RfElevStirrup> g = groups.FirstOrDefault(x => Math.Abs(x[0].U0 - s.U0) < tol && Math.Abs(x[0].U1 - s.U1) < tol && x[0].Count == s.Count && SameBar(c, x[0].Id, s.Id));
                if (g == null) groups.Add(new List<RfElevStirrup> { s });
                else g.Add(s);
            }
            int dropped = c.Input.Stirrups.Count - groups.Count;
            if (dropped <= 0) return 0;
            c.Input.Stirrups.Clear();
            foreach (List<RfElevStirrup> g in groups)
                c.Input.Stirrups.Add(g.OrderByDescending(s => Depth(c, s.Id)).ThenBy(s => s.Id).First());
            return dropped;
        }

        private static bool SameBar(RfElevContext c, long a, long b)
        {
            if (!c.Rebars.TryGetValue(a, out Rebar ra) || !c.Rebars.TryGetValue(b, out Rebar rb)) return false;
            if (ra.GetTypeId() != rb.GetTypeId()) return false;
            string na = Number(ra), nb = Number(rb);
            return na == nb;
        }

        public static string Number(Rebar r)
        {
            try { return r.get_Parameter(BuiltInParameter.REBAR_NUMBER)?.AsString() ?? ""; } catch { return ""; }
        }

        /// <summary>Харагч руу чиглэсэн гүн — их нь ойр.</summary>
        private static double Depth(RfElevContext c, long id)
        {
            if (!c.Rebars.TryGetValue(id, out Rebar r)) return double.MinValue;
            BoundingBoxXYZ bb = r.get_BoundingBox(null);
            if (bb == null) return double.MinValue;
            return ((bb.Min + bb.Max) / 2).DotProduct(c.View.ViewDirection);
        }

        // ── 2. Шошгоны бүлэг ────────────────────────────────────────────

        public static int SplitBarGroups(RfElevContext c)
        {
            double tol = BbGeom.Ft(300);
            int made = 0;
            foreach (IGrouping<string, RfElevBar> grp in c.Input.Bars.Where(b => b.Group.Length > 0).GroupBy(b => b.Group).ToList())
            {
                var clusters = new List<List<RfElevBar>>();
                foreach (RfElevBar b in grp.OrderBy(b => b.U0))
                {
                    List<RfElevBar> cl = clusters.FirstOrDefault(x => x.Any(o => Math.Abs(o.U0 - b.U0) < tol && Math.Abs(o.U1 - b.U1) < tol));
                    if (cl == null) clusters.Add(new List<RfElevBar> { b });
                    else cl.Add(b);
                }
                if (clusters.Count <= 1) continue;
                for (int i = 0; i < clusters.Count; i++)
                    foreach (RfElevBar b in clusters[i]) b.Group = grp.Key + "#" + i;
                made += clusters.Count - 1;
            }
            return made;
        }

        // ── 3. MRA ──────────────────────────────────────────────────────

        public static int RelayoutMras(RfElevContext c, RfElevReport r, RfElevUi ui, BbMemberStandard ms, BbAnnoReport rep, string mark)
        {
            Document doc = c.Doc;
            RfElevPlan plan = r.Plan;
            if (plan == null || plan.Mras.Count == 0) return 0;
            var created = r.Created.Select(id => doc.GetElement(id)).OfType<MultiReferenceAnnotation>().ToList();
            if (created.Count == 0) return 0;
            var type = doc.GetElement(created[0].GetTypeId()) as MultiReferenceAnnotationType;
            if (type == null) return 0;
            RfElevOptions o = c.Input.Options;
            int scale = c.View.Scale > 0 ? c.View.Scale : 50;
            Func<double, double> ft = mm => RfTol.PaperMmToModelFt(mm, scale);

            // Гишүүний доод талын хамгийн гадна эгнээ (шошго, давхцал, үргэлжилсэн хэмжээс) — MRA үүнээс гадагш.
            double cursor = c.Input.BeamV0;
            foreach (RfElevTagPlan t in plan.Tags.Where(t => t.Side == RfElevSide.Bottom && !(ms.ElevSideTags && IsSide(c, t.Anchor.Y)))) cursor = Math.Min(cursor, t.Head.Y - t.Height / 2);
            foreach (RfElevLapPlan l in plan.Laps.Where(l => l.Side == RfElevSide.Bottom)) cursor = Math.Min(cursor, l.LineV);
            foreach (RfElevLapChainPlan l in plan.LapChains.Where(l => l.Side == RfElevSide.Bottom)) cursor = Math.Min(cursor, l.LineV);

            // Бүс бүрийн бичвэрийн хүрээг (leader-гүй) хэмжинэ.
            // Бичвэр нь дугаар + голчоос хамаарна — нэг түлхүүрт НЭГ удаа хэмжинэ (хэмжилт бүр Regenerate-тэй, том моделд удаан).
            var zones = new List<BbMraZone>();
            var cache = new Dictionary<string, double[]>(StringComparer.Ordinal);
            foreach (RfElevMraPlan m in plan.Mras)
            {
                var z = new BbMraZone { Id = m.RebarId, U0 = m.U0, U1 = m.U1, Count = StirrupCount(c, m.RebarId) };
                string key = c.Rebars.TryGetValue(m.RebarId, out Rebar rb) ? Number(rb) + "|" + rb.GetTypeId().Value : "#" + m.RebarId;
                if (!cache.TryGetValue(key, out double[] box))
                {
                    box = MeasureText(c, m, type, z) ? new[] { z.DL, z.DR, z.DB, z.DT } : new[] { -m.Width / 2, m.Width / 2, -m.Height / 2, m.Height / 2 };
                    cache[key] = box;
                }
                z.DL = box[0]; z.DR = box[1]; z.DB = box[2]; z.DT = box[3];
                zones.Add(z);
            }
            var rules = new BbMraRules
            {
                ShortMaxBars = ms.MraShortMaxBars,
                GapFt = ft(Math.Max(0.5, ms.TagGapPaperMm)),
                PitchFt = ft(Math.Max(2, ms.DimPitchPaperMm)),
                NearHeadFt = ft(ms.MraNearHeadPaperMm),
                FarHeadFt = ft(ms.MraFarHeadPaperMm),
                MidHeadFt = ft(ms.MraMidHeadPaperMm),
                MidMaxBars = ms.MraMidMaxBars,
                LongRel = ms.MraLongRel,
                MidRel = ms.MraMidRel,
                ShortGapFt = ft(ms.MraShortGapPaperMm),
                PairFt = ft(ms.MraPairPaperMm),
                MinTagGapFt = ft(1.5),
            };
            BbMraLayout.Plan(zones, cursor, rules);

            // Хөдөлгүүрийн MRA-г устгаж шинээр үүсгэнэ.
            double oldLowest = plan.Mras.Min(m => Math.Min(m.LineV, m.Head.Y - m.Height / 2));
            foreach (MultiReferenceAnnotation m in created)
            {
                try { doc.Delete(m.Id); } catch { }
            }
            DimensionType dimType = ui.DimTypeId != ElementId.InvalidElementId ? doc.GetElement(ui.DimTypeId) as DimensionType : null;
            int made = 0;
            foreach (BbMraZone z in zones)
            {
                MultiReferenceAnnotation mra = Create(c, type, z.Id, (z.U0 + z.U1) / 2, z.LineV, new RfV2(z.HeadU, z.HeadV), true);
                if (mra == null)
                {
                    rep.Issues.Add(new BbIssue { Tool = "Тэмдэглэх", Severity = BbSeverity.Warning, Member = mark, View = c.View.Name, ViewId = c.View.Id.Value, ElementId = z.Id,
                        Problem = "Хомутын MRA (арматур " + z.Id + ") дахин үүссэнгүй.", Proposal = "Гараар MRA тавих.", Key = "anno|" + mark + "|" + c.View.Name + "|mra|" + z.Id });
                    continue;
                }
                if (dimType != null) RfElevationService.ApplyMraDimensionType(doc, mra, dimType, z.Id, r.Notes);
                made++;
            }

            // Тэнхлэгийн гинжийг шинэ MRA-ийн гадна (нэг алхамын зайтай).
            double newLowest = zones.Min(z => Math.Min(z.LineV, z.HeadV + z.DB));
            var spanLines = plan.Spans.Where(s => s.LineV < c.Input.BeamV0).Select(s => s.LineV).ToList();
            if (spanLines.Count > 0)
            {
                double first = spanLines.Max();
                double delta = (newLowest - rules.PitchFt) - first;
                if (Math.Abs(delta) > ft(0.3)) MoveDims(c, r, spanLines, delta);
            }
            return made;
        }

        private static int StirrupCount(RfElevContext c, long id)
        {
            RfElevStirrup s = c.Input.Stirrups.FirstOrDefault(x => x.Id == id);
            if (s != null) return s.Count;
            return c.Rebars.TryGetValue(id, out Rebar r) ? r.NumberOfBarPositions : 0;
        }

        private static MultiReferenceAnnotation Create(RfElevContext c, MultiReferenceAnnotationType type, long rebarId, double midU, double lineV, RfV2 head, bool leader)
        {
            using (var st = new SubTransaction(c.Doc))
            {
                st.Start();
                try
                {
                    var dt = c.Doc.GetElement(type.DimensionStyleId) as DimensionType;
                    var opt = new MultiReferenceAnnotationOptions(type)
                    {
                        DimensionStyleType = dt != null ? dt.StyleType : DimensionStyleType.Linear,
                        DimensionLineOrigin = c.Model(midU, lineV),
                        DimensionLineDirection = RfConv.X(c.Frame.Right),
                        DimensionPlaneNormal = c.View.ViewDirection,
                        TagHeadPosition = c.Model(head),
                        TagHasLeader = leader,
                    };
                    opt.SetElementsToDimension(new List<ElementId> { new ElementId(rebarId) });
                    MultiReferenceAnnotation mra = MultiReferenceAnnotation.Create(c.Doc, c.View.Id, opt);
                    if (mra == null) { st.RollBack(); return null; }
                    st.Commit();
                    return mra;
                }
                catch
                {
                    if (st.HasStarted() && !st.HasEnded()) st.RollBack();
                    return null;
                }
            }
        }

        /// <summary>Leader-гүй MRA-г түр үүсгэж бичвэрийн хүрээг толгойн цэгээс хэмжинэ (ҮРГЭЛЖ буцаана).</summary>
        private static bool MeasureText(RfElevContext c, RfElevMraPlan m, MultiReferenceAnnotationType type, BbMraZone z)
        {
            using (var st = new SubTransaction(c.Doc))
            {
                st.Start();
                try
                {
                    var head = new RfV2((m.U0 + m.U1) / 2, m.LineV + BbGeom.Ft(500));
                    MultiReferenceAnnotation mra = Create(c, type, m.RebarId, (m.U0 + m.U1) / 2, m.LineV, head, false);
                    if (mra == null) return false;
                    c.Doc.Regenerate();
                    var tag = c.Doc.GetElement(mra.TagId) as IndependentTag;
                    if (tag == null) return false;
                    if (!Box(c, tag, out RfV2 a, out RfV2 b)) return false;
                    RfV2 h = c.Frame.ToView(RfConv.V(tag.TagHeadPosition));
                    z.DL = a.X - h.X; z.DR = b.X - h.X; z.DB = a.Y - h.Y; z.DT = b.Y - h.Y;
                    return z.DR - z.DL > 1e-6 && z.DT - z.DB > 1e-6;
                }
                catch { return false; }
                finally { if (st.HasStarted() && !st.HasEnded()) st.RollBack(); }
            }
        }

        /// <summary>Элементийн харагдацын хүрээ host frame-д (8 булангийн проекц).</summary>
        public static bool Box(RfElevContext c, Element e, out RfV2 min, out RfV2 max)
        {
            min = max = new RfV2(0, 0);
            BoundingBoxXYZ bb;
            try { bb = e.get_BoundingBox(c.View); } catch { return false; }
            if (bb == null) return false;
            return Corners(c, bb, out min, out max);
        }

        /// <summary>Хөдөлгүүрийн үүсгэсэн, шугам нь <paramref name="lines"/>-ийн аль нэгэнд таарах хэмжээсүүдийг v-ээр зөөнө.</summary>
        private static void MoveDims(RfElevContext c, RfElevReport r, List<double> lines, double delta)
        {
            XYZ move = c.Model(0, delta) - c.Model(0, 0);
            double tol = BbGeom.Ft(5);
            foreach (ElementId id in r.Created)
            {
                if (!(c.Doc.GetElement(id) is Dimension d) || d is SpotDimension) continue;
                Line l = d.Curve as Line;
                if (l == null) continue;
                double v = c.Frame.ToView(RfConv.V(l.Origin)).Y;
                if (!lines.Any(x => Math.Abs(x - v) < tol)) continue;
                try { ElementTransformUtils.MoveElement(c.Doc, d.Id, move); } catch { }
            }
        }

        // ── 4. Хажуугийн арматурын шошго ────────────────────────────────

        /// <summary>
        /// Гишүүний дунд хэсэгт (дээд/доод нүүрнээс хол) байрлах арматурын шошгыг гишүүний дунд өндөрт, арматурын хажууд (зүүн, давхцвал баруун),
        /// хэвтээ «landing»-тай leader-ээр.  ЖИШЭЭ-1: 11⌀16, 13⌀12 г.м. хажуугийн арматур дунд өндөрт (456.1 / 448–464).
        /// </summary>
        public static int MidTags(RfElevContext c, RfElevReport r, RfElevUi ui, BbMemberStandard ms, BbAnnoReport rep)
        {
            RfElevPlan plan = r.Plan;
            double v0 = c.Input.BeamV0, v1 = c.Input.BeamV1;
            if (v1 - v0 <= 0) return 0;
            int scale = c.View.Scale > 0 ? c.View.Scale : 50;
            var row = new MidRow
            {
                Mid = (v0 + v1) / 2,
                Run = RfTol.PaperMmToModelFt(Math.Max(1, ms.SideTagRunPaperMm), scale),
                Gap = RfTol.PaperMmToModelFt(1.5, scale),
            };
            var tags = r.Created.Select(id => c.Doc.GetElement(id)).OfType<IndependentTag>().ToList();
            double wDefault = plan != null && plan.Tags.Count > 0 ? plan.Tags.Select(t => t.Width).OrderBy(x => x).ElementAt(plan.Tags.Count / 2) : RfTol.PaperMmToModelFt(12, scale);
            var moves = new List<MidMove>();
            if (plan != null && ms.ElevSideTags)
            {
                foreach (RfElevTagPlan t in plan.Tags.OrderBy(t => t.Anchor.X))
                {
                    if (!IsSide(c, t.Anchor.Y)) continue;
                    IndependentTag tag = tags.FirstOrDefault(x => Tagged(x).Contains(t.BarId));
                    if (tag == null) continue;
                    double cx = row.Place(t.Anchor.X, t.Width, out double dir);
                    moves.Add(new MidMove { Tag = tag, Cx = cx, Dir = dir, Anchor = t.Anchor });
                }
            }
            if (ms.ElevTagOtherBars && ui.BarTagTypeId != ElementId.InvalidElementId)
                TagOtherBars(c, r, ui, row, wDefault, rep, moves);
            return ApplyMid(c, row, moves);
        }

        private sealed class MidRow
        {
            public readonly List<KeyValuePair<double, double>> Placed = new List<KeyValuePair<double, double>>();
            public double Mid, Run, Gap;

            /// <summary>Бичвэрийн төвийн u: зангуунаас зүүн (давхцвал баруун), хэвтээ landing-тай.  <paramref name="dir"/> = −1 зүүн / +1 баруун.</summary>
            public double Place(double anchorU, double w, out double dir)
            {
                double cl = anchorU - Run - w / 2, cr = anchorU + Run + w / 2;
                bool leftFree = !Hits(cl, w);
                bool rightFree = !Hits(cr, w);
                dir = leftFree || !rightFree ? -1 : 1;
                double cx = dir < 0 ? cl : cr;
                int guard = 0;
                while (Hits(cx, w) && guard++ < 40) cx += dir * (w / 2);
                Placed.Add(new KeyValuePair<double, double>(cx - w / 2, cx + w / 2));
                return cx;
            }

            private bool Hits(double cx, double w) { return Placed.Any(p => cx - w / 2 < p.Value + Gap && cx + w / 2 > p.Key - Gap); }
        }

        private sealed class MidMove
        {
            public IndependentTag Tag;
            public double Cx, Dir;
            public RfV2 Anchor;
        }

        /// <summary>
        /// ⚠️ Дараалал чухал (Revit 2024-д хэмжсэн): толгой → Free → төгсгөл, ДАРАА НЬ Regenerate, тэгээд л elbow.  Regenerate-гүйгээр elbow тавибал
        /// <c>TagHeadPosition</c> шинэ утгаа буцаадаг ч шошго ХУУЧИН байрандаа зурагддаг (bbox ч хуучин) — шошго гишүүний доор үлдэж байв.
        /// Бүх шошгыг хоёр шатаар (нэг Regenerate) — шошго бүрт Regenerate хийвэл том моделд удаан.
        /// </summary>
        private static int ApplyMid(RfElevContext c, MidRow row, List<MidMove> moves)
        {
            var ok = new List<MidMove>();
            foreach (MidMove m in moves)
            {
                try
                {
                    IList<Reference> refs = m.Tag.GetTaggedReferences();
                    if (refs == null || refs.Count == 0) continue;
                    if (!m.Tag.HasLeader) m.Tag.HasLeader = true;
                    m.Tag.LeaderEndCondition = LeaderEndCondition.Attached;
                    ok.Add(m);
                }
                catch { }
            }
            if (ok.Count == 0) return 0;
            c.Doc.Regenerate();
            foreach (MidMove m in ok)
            {
                try
                {
                    Reference r0 = m.Tag.GetTaggedReferences()[0];
                    m.Tag.TagHeadPosition = c.Model(m.Cx, row.Mid);
                    m.Tag.LeaderEndCondition = LeaderEndCondition.Free;
                    m.Tag.SetLeaderEnd(r0, c.Model(m.Anchor));
                }
                catch { }
            }
            c.Doc.Regenerate();
            foreach (MidMove m in ok)
            {
                try { m.Tag.SetLeaderElbow(m.Tag.GetTaggedReferences()[0], c.Model(m.Anchor.X + m.Dir * row.Run * 0.5, row.Mid)); } catch { }
            }
            c.Doc.Regenerate();
            return ok.Count;
        }

        /// <summary>
        /// Хөдөлгүүрийн ангилж чадаагүй (нугалсан, <c>SkippedOther</c>) харагдаж буй арматурт шинээр шошго — ЖИШЭЭ-1-ийн 11⌀16 (хэлбэр 46) бүгд
        /// тэмдэглэгдэлгүй үлддэг байв.  Харагчид ойр ширхгийг, crop доторх хэсгийн голд зангуулж, дунд өндрийн эгнээнд.
        /// </summary>
        private static int TagOtherBars(RfElevContext c, RfElevReport r, RfElevUi ui, MidRow row, double w, BbAnnoReport rep, List<MidMove> moves)
        {
            RebarHostData hd;
            try { hd = RebarHostData.GetRebarHostData(c.Host); } catch { return 0; }
            if (hd == null) return 0;
            var visible = new HashSet<long>();
            foreach (ElementId id in new FilteredElementCollector(c.Doc, c.View.Id).OfClass(typeof(Rebar)).ToElementIds()) visible.Add(id.Value);
            var already = new HashSet<long>(c.Rebars.Keys);
            foreach (IndependentTag t in new FilteredElementCollector(c.Doc, c.View.Id).OfClass(typeof(IndependentTag)).Cast<IndependentTag>())
                foreach (long id in Tagged(t)) already.Add(id);
            int made = 0;
            double minLen = BbGeom.Ft(300);
            foreach (Rebar rb in hd.GetRebarsInHost().OfType<Rebar>())
            {
                if (!visible.Contains(rb.Id.Value) || already.Contains(rb.Id.Value)) continue;
                RebarShape sh = c.Doc.GetElement(rb.GetShapeId()) as RebarShape;
                if (sh == null || sh.RebarStyle != RebarStyle.Standard) continue;
                List<int> existing = RfSectionAnalyzer.ExistingBars(rb);
                if (existing.Count == 0) continue;
                int best = existing[0];
                double bestDepth = double.MinValue;
                foreach (int k in new[] { existing[0], existing[existing.Count - 1] })
                {
                    List<RfV3> pk = RfSectionAnalyzer.PointsAt(rb, k);
                    if (pk == null || pk.Count == 0) continue;
                    double d = pk.Average(p => c.Frame.DepthOf(p));
                    if (d > bestDepth) { bestDepth = d; best = k; }
                }
                List<RfV3> pts = RfSectionAnalyzer.PointsAt(rb, best);
                if (pts == null || pts.Count < 2) continue;
                var q = pts.Select(p => c.Frame.ToView(p)).ToList();
                double u0 = Math.Max(q.Min(p => p.X), c.Input.BeamU0), u1 = Math.Min(q.Max(p => p.X), c.Input.BeamU1);
                if (u1 - u0 < minLen) continue;      // харагдацад перпендикуляр (хөндлөн) эсвэл crop-оос гадна
                double um = (u0 + u1) / 2;
                RfV2 anchor = Nearest(q, um);
                if (anchor.X < u0 || anchor.X > u1) anchor = new RfV2(um, anchor.Y);
                IndependentTag tag = null;
                foreach (Reference reference in RfRebarRefs.TagReferences(rb, best, true))
                {
                    using (var st = new SubTransaction(c.Doc))
                    {
                        st.Start();
                        try
                        {
                            tag = IndependentTag.Create(c.Doc, ui.BarTagTypeId, c.View.Id, reference, true, TagOrientation.Horizontal, c.Model(anchor));
                            if (tag == null) { st.RollBack(); continue; }
                            st.Commit();
                            break;
                        }
                        catch
                        {
                            if (st.HasStarted() && !st.HasEnded()) st.RollBack();
                            tag = null;
                        }
                    }
                }
                if (tag == null)
                {
                    rep.Notes.Add("«" + c.View.Name + "»: арматур " + rb.Id.Value + " (" + sh.Name + ") шошголж чадсангүй.");
                    continue;
                }
                double cx = row.Place(anchor.X, w, out double dir);
                moves.Add(new MidMove { Tag = tag, Cx = cx, Dir = dir, Anchor = anchor });
                r.Created.Add(tag.Id);
                already.Add(rb.Id.Value);
                made++;
            }
            return made;
        }

        /// <summary>Олон шугамын (tessellated) дагуу u нь <paramref name="u"/>-д хамгийн ойр цэг.</summary>
        private static RfV2 Nearest(IList<RfV2> q, double u)
        {
            for (int i = 0; i + 1 < q.Count; i++)
            {
                RfV2 a = q[i], b = q[i + 1];
                double lo = Math.Min(a.X, b.X), hi = Math.Max(a.X, b.X);
                if (u >= lo && u <= hi && hi - lo > 1e-9)
                {
                    double k = (u - a.X) / (b.X - a.X);
                    return new RfV2(u, a.Y + (b.Y - a.Y) * k);
                }
            }
            return q.OrderBy(p => Math.Abs(p.X - u)).First();
        }

        /// <summary>Арматур гишүүний дээд/доод нүүрнээс хол (дунд хэсэгт) — хажуугийн арматур.</summary>
        public static bool IsSide(RfElevContext c, double v)
        {
            double v0 = c.Input.BeamV0, v1 = c.Input.BeamV1, h = v1 - v0;
            if (h <= 0) return false;
            double band = Math.Max(h * 0.3, BbGeom.Ft(150));
            return v > v0 + band && v < v1 - band;
        }

        private static HashSet<long> Tagged(IndependentTag t)
        {
            var s = new HashSet<long>();
            try { foreach (ElementId id in t.GetTaggedLocalElementIds()) s.Add(id.Value); } catch { }
            return s;
        }
    }
}
