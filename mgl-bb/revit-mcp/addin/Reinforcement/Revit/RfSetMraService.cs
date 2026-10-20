using System;
using System.Collections.Generic;
using System.Linq;
using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Structure;
using RevitMcpAddin.Reinforcement.Core;

namespace RevitMcpAddin.Reinforcement
{
    /// <summary>Хана/хучилтын олонлогийн MRA-ийн тохиргоо (Revit талын) — цаасан мм.</summary>
    internal sealed class RfSetMraUi
    {
        public ElementId MraTypeId = ElementId.InvalidElementId;
        public ElementId DimTypeId = ElementId.InvalidElementId;

        /// <summary>Олонлогийн ХАМГИЙН ГАДНА арматураас хэмжээсийн шугам хүртэл (цаасан мм).</summary>
        public double OffsetMm = 10;

        /// <summary>Шугамаас шошгоны хайрцаг хүртэл (цаасан мм).</summary>
        public double TagGapMm = 4;

        public bool Flip;

        /// <summary>MRA (multi rebar tag) ба тусдаа шошгыг ТУСДАА сонгоно (2026-10-08).</summary>
        public bool Mra = true, Tags = false;
        public ElementId TagTypeId = ElementId.InvalidElementId;

        /// <summary>Давхцалтай олонлогийн үргэлжилсэн хэмжээс; хана/хучилтын ерөнхий (нийт) хэмжээс.</summary>
        public bool LapChain = false, Overall = false;

        /// <summary>Ерөнхий хэмжээсийн шугам хана/хучилтын ирмэгээс (цаасан мм).</summary>
        public double OverallOffsetMm = 10;

        /// <summary>«Байрлал» (2026-10-09): true = 4 талд (зүүн+баруун, доод+дээд), false = зөвхөн зүүн ба доод.  «Гинж хооронд» = тэмдэглэгээнээс цааш зай (цаасан мм).</summary>
        public bool OverallAllSides = false;
        /// <summary>«Зөвхөн баруун ба доод талд» (2026-10-12): 4 талд биш үед босоо хэмжээс зүүн биш баруун талд.</summary>
        public bool OverallRightSide = false;
        public double OverallStepMm = 8;

        public RfSetMraOptions ToCore(View view)
        {
            int scale = view != null && view.Scale > 0 ? view.Scale : 100;
            return new RfSetMraOptions
            {
                OffsetFt = RfTol.PaperMmToModelFt(OffsetMm, scale),
                TagGapFt = RfTol.PaperMmToModelFt(TagGapMm, scale),
                TagWidthFt = RfTol.PaperMmToModelFt(16, scale),
                TagHeightFt = RfTol.PaperMmToModelFt(5, scale),
                Flip = Flip,
                Mra = Mra,
                Tags = Tags,
                LapChain = LapChain,
                ChainOffsetFt = RfTol.PaperMmToModelFt(OffsetMm, scale),
            };
        }
    }

    /// <summary>Хана/хучилтын тэнхлэгт перпендикуляр хамгийн захын нүүр (ерөнхий хэмжээсэд).</summary>
    internal sealed class RfHostFaceRef
    {
        public Reference Ref;
        public double Pos, Area;
    }

    internal sealed class RfSetMraContext
    {
        public Document Doc;
        public View View;
        public Element Host;
        public RfViewFrame Frame;
        public readonly List<RfSetSample> Sets = new List<RfSetSample>();
        public readonly HashSet<long> RebarIds = new HashSet<long>();
        public readonly Dictionary<long, Rebar> Rebars = new Dictionary<long, Rebar>();
        public int HostRebars, VisibleRebars, SingleOrHidden;

        /// <summary>Хост (хана/хучилт)-ын хүрээ харагдацад ба тэнхлэг бүрийн хамгийн захын хоёр нүүр (U: баруун/зүүн, V: дээд/доод).  null = олдоогүй.</summary>
        public double HostMinU = double.MaxValue, HostMaxU = double.MinValue, HostMinV = double.MaxValue, HostMaxV = double.MinValue;
        public RfHostFaceRef MinUFace, MaxUFace, MinVFace, MaxVFace;

        /// <summary>Нөөц: харагдацад шугам болж харагдах шулуун ИРМЭГ (шалны хажуу нүүр Reference-гүй байдаг — хэмжсэн).</summary>
        public RfHostFaceRef MinUEdge, MaxUEdge, MinVEdge, MaxVEdge;

        public XYZ Model(RfV2 p) { return RfConv.X(Frame.ToModel(p)); }
    }

    internal sealed class RfSetMraReport
    {
        public int Planned, Made;
        public int TagsPlanned, TagsMade, ChainsPlanned, ChainsMade, OverallPlanned, OverallMade;

        /// <summary>Нэг арматурт нэг MRA (2026-10-09, эзэн): аль хэдийн MRA-тай тул алгассан олонлог; давхардсан тул устгасан MRA.</summary>
        public int MraExisting, MraDuplicatesRemoved;

        /// <summary>Давхардал устгахад ҮЛДСЭН (өмнө нь тавьсан) MRA-ууд — ерөнхий хэмжээсийн байрлалыг тэдгээрээс цааш тооцоход.</summary>
        public readonly List<ElementId> KeptMras = new List<ElementId>();
        public readonly List<ElementId> Created = new List<ElementId>();
        public readonly List<string> Failures = new List<string>();
        public readonly List<string> Notes = new List<string>();
    }

    /// <summary>
    /// ХАНА, ХУЧИЛТ дээрх арматурын ОЛОНЛОГ бүрд MRA (шошго + алхамын хэмжээс).  Байрлалыг ХОСТООС БИШ, харагдаж буй АРМАТУРААС тооцно — хэмжээсийн шугам
    /// олонлогийн хамгийн гадна арматураас хэрэглэгчийн мм-ээр (<see cref="RfSetMraPlanner"/>, цэвэр, тесттэй).  Revit-д MRA нь арматурын ЭЛЕМЕНТЭЭС
    /// (<c>SetElementsToDimension</c>) үүсэх тул лавлагааны асуудалгүй.
    /// </summary>
    internal static class RfSetMraService
    {
        /// <summary>Нэг олонлогоос шалгах ширхгийн дээд (эхний + сүүлийн + завсар).</summary>
        private const int MaxSamples = 24;

        public static RfSetMraContext Analyze(Document doc, View view, Element host)
        {
            var c = new RfSetMraContext { Doc = doc, View = view, Host = host, Frame = RfView.Frame(view) };
            ReadHost(c);
            IList<Rebar> inHost = null;
            try
            {
                if (RebarHostData.IsValidHost(host))
                {
                    RebarHostData hd = RebarHostData.GetRebarHostData(host);
                    if (hd != null) inHost = hd.GetRebarsInHost();
                }
            }
            catch
            {
                inHost = null;
            }
            if (inHost == null) return c;
            c.HostRebars = inHost.Count;

            var visible = new HashSet<long>();
            foreach (ElementId id in new FilteredElementCollector(doc, view.Id).OfClass(typeof(Rebar)).ToElementIds())
                visible.Add(id.Value);

            foreach (Rebar r in inHost)
            {
                if (r == null || !visible.Contains(r.Id.Value)) continue;
                c.VisibleRebars++;
                List<int> existing = RfSectionAnalyzer.ExistingBars(r);
                var shown = new HashSet<int>();
                foreach (int idx in existing)
                {
                    bool hidden = false;
                    try { hidden = r.IsBarHidden(view, idx); } catch { }
                    if (!hidden) shown.Add(idx);
                }
                // ⚠️ 2026-10-09 (эзэн: «хана хучилтын multi rebar tag харагдац дээрээ тавигдахгүй»): хана/хучилтын олонлог ихэвчлэн «Middle» эсвэл
                // «First/Last» дүрслэлтэй — харагдацад 1–2 ширхэг л зурагдана.  Өмнө нь «≥ 2 ЗУРАГДСАН ширхэг» шаардаж ийм олонлогийг бүгдийг алгасдаг байв.
                // MRA нь олонлогийг (элементийг) бүхэлд нь хэмждэг тул тархалтыг БҮХ байгаа ширхгээс авна; олонлог өөрөө ≥ 2 ширхэгтэй л байх ёстой.
                if (existing.Count < 2 || shown.Count == 0)
                {
                    c.SingleOrHidden++;
                    continue;
                }
                List<int> pick = Sample(existing).Union(shown).Distinct().OrderBy(i => i).ToList();
                var s = new RfSetSample { Id = r.Id.Value, Diameter = RfSectionAnalyzer.Diameter(doc, r) };
                double depthSum = 0;
                int depthN = 0;
                foreach (int idx in pick)
                {
                    List<RfV3> pts = RfSectionAnalyzer.PointsAt(r, idx);
                    if (pts == null) continue;
                    double su = 0, sv = 0;
                    foreach (RfV3 p in pts)
                    {
                        RfV2 q = c.Frame.ToView(p);
                        s.Points.Add(q);
                        su += q.X;
                        sv += q.Y;
                        depthSum += c.Frame.DepthOf(p);
                        depthN++;
                    }
                    if (pts.Count != 2) s.Straight = false;
                    s.Centres.Add(new RfV2(su / pts.Count, sv / pts.Count));
                    s.BarIndices.Add(idx);
                    s.Shown.Add(shown.Contains(idx));
                }
                s.Depth = depthN == 0 ? 0 : depthSum / depthN;
                if (s.Centres.Count >= 2)
                {
                    c.Sets.Add(s);
                    c.RebarIds.Add(r.Id.Value);
                    c.Rebars[r.Id.Value] = r;
                }
                else
                {
                    c.SingleOrHidden++;
                }
            }
            return c;
        }

        /// <summary>
        /// Хана/хучилтын харагдацад харагдах хүрээ (бүх ирмэгийн цэг) ба харагдацын Right/Up-тай перпендикуляр (харагдацад шугам болж харагдах) хамгийн захын
        /// хавтгай нүүрүүд — ерөнхий хэмжээсийн лавлагаа.  Налуу ирмэгтэй хана/хучилтын тэр тэнхлэгт нүүр олдохгүй бол ерөнхий хэмжээс тавигдахгүй.
        /// </summary>
        private static void ReadHost(RfSetMraContext c)
        {
            GeometryElement ge;
            try { ge = c.Host.get_Geometry(new Options { ComputeReferences = true, DetailLevel = ViewDetailLevel.Fine }); }
            catch { return; }
            if (ge == null) return;
            WalkHost(c, ge, Transform.Identity);
            c.MinUFace = Pick(c.MinUFace, c.MinUEdge, true);
            c.MaxUFace = Pick(c.MaxUFace, c.MaxUEdge, false);
            c.MinVFace = Pick(c.MinVFace, c.MinVEdge, true);
            c.MaxVFace = Pick(c.MaxVFace, c.MaxVEdge, false);
        }

        private static void WalkHost(RfSetMraContext c, GeometryElement ge, Transform t)
        {
            foreach (GeometryObject go in ge)
            {
                Solid s = go as Solid;
                if (s != null && s.Volume > 1e-9)
                {
                    foreach (Edge e in s.Edges)
                    {
                        Curve cv = e.AsCurve();
                        RfV2 qa = c.Frame.ToView(RfConv.V(t.OfPoint(cv.GetEndPoint(0)))), qb = c.Frame.ToView(RfConv.V(t.OfPoint(cv.GetEndPoint(1))));
                        foreach (RfV2 q in new[] { qa, qb })
                        {
                            c.HostMinU = Math.Min(c.HostMinU, q.X);
                            c.HostMaxU = Math.Max(c.HostMaxU, q.X);
                            c.HostMinV = Math.Min(c.HostMinV, q.Y);
                            c.HostMaxV = Math.Max(c.HostMaxV, q.Y);
                        }
                        // ⚠️ Хэмжсэн (2026-10-08, хучилт «B20 170»): шалны хажуу нүүрний 63-аас 61 нь Reference-гүй (ComputeReferences ч, View ч) — харин ирмэг БҮР
                        // лавлагаатай.  Тиймээс харагдацад босоо/хэвтээ шугам болж харагдах шулуун ирмэгийг нөөц лавлагаа болгоно (нүүр олдвол нүүр давуу).
                        Reference er;
                        try { er = cv is Line ? e.Reference : null; } catch { er = null; }
                        if (er == null) continue;
                        RfV3 d3 = RfConv.V(t.OfVector(((Line)cv).Direction)).Normalized();
                        if (Math.Abs(d3.Dot(c.Frame.Normal)) > 0.01) continue;
                        RfV2 d2 = c.Frame.ToViewVec(d3);
                        if (Math.Abs(d2.X) <= 0.001)
                        {
                            KeepEdge(ref c.MinUEdge, er, (qa.X + qb.X) / 2, true);
                            KeepEdge(ref c.MaxUEdge, er, (qa.X + qb.X) / 2, false);
                        }
                        else if (Math.Abs(d2.Y) <= 0.001)
                        {
                            KeepEdge(ref c.MinVEdge, er, (qa.Y + qb.Y) / 2, true);
                            KeepEdge(ref c.MaxVEdge, er, (qa.Y + qb.Y) / 2, false);
                        }
                    }
                    foreach (Face f in s.Faces)
                    {
                        PlanarFace pf = f as PlanarFace;
                        if (pf == null || pf.Reference == null) continue;
                        RfV3 n = RfConv.V(t.OfVector(pf.FaceNormal)).Normalized();
                        if (Math.Abs(n.Dot(c.Frame.Normal)) > RfSectionAnalyzer.InPlaneMaxDot) continue;
                        RfV2 n2 = c.Frame.ToViewVec(n).Normalized();
                        RfV2 o2 = c.Frame.ToView(RfConv.V(t.OfPoint(pf.Origin)));
                        if (Math.Abs(n2.X) >= 0.999)
                        {
                            Keep(ref c.MinUFace, pf, o2.X, true);
                            Keep(ref c.MaxUFace, pf, o2.X, false);
                        }
                        else if (Math.Abs(n2.Y) >= 0.999)
                        {
                            Keep(ref c.MinVFace, pf, o2.Y, true);
                            Keep(ref c.MaxVFace, pf, o2.Y, false);
                        }
                    }
                    continue;
                }
                GeometryInstance gi = go as GeometryInstance;
                if (gi != null)
                {
                    GeometryElement sym = gi.GetSymbolGeometry();
                    if (sym != null) WalkHost(c, sym, t.Multiply(gi.Transform));
                }
            }
        }

        private static void KeepEdge(ref RfHostFaceRef slot, Reference r, double pos, bool min)
        {
            if (slot == null || (min ? pos < slot.Pos - RfTol.MmToFt(0.5) : pos > slot.Pos + RfTol.MmToFt(0.5)))
                slot = new RfHostFaceRef { Ref = r, Pos = pos };
        }

        /// <summary>Нүүр олдоогүй, эсвэл ирмэг нь илүү захад (нүүр лавлагаагүй тул) байвал ирмэгийг авна; тэнцүү бол нүүр.</summary>
        private static RfHostFaceRef Pick(RfHostFaceRef face, RfHostFaceRef edge, bool min)
        {
            if (face == null) return edge;
            if (edge == null) return face;
            double tol = RfTol.MmToFt(0.5);
            return (min ? edge.Pos < face.Pos - tol : edge.Pos > face.Pos + tol) ? edge : face;
        }

        private static void Keep(ref RfHostFaceRef slot, PlanarFace pf, double pos, bool min)
        {
            double tol = RfTol.MmToFt(0.5);
            bool better = slot == null
                || (min ? pos < slot.Pos - tol : pos > slot.Pos + tol)
                || (Math.Abs(pos - slot.Pos) <= tol && pf.Area > slot.Area);
            if (better) slot = new RfHostFaceRef { Ref = pf.Reference, Pos = pos, Area = pf.Area };
        }

        private static List<int> Sample(List<int> shown)
        {
            if (shown.Count <= MaxSamples) return shown;
            var res = new List<int>();
            double step = (shown.Count - 1) / (double)(MaxSamples - 1);
            for (int k = 0; k < MaxSamples; k++) res.Add(shown[(int)Math.Round(k * step)]);
            return res;
        }

        /// <summary>PLAN: цэвэр.</summary>
        public static RfSetMraResult Plan(RfSetMraContext c, RfSetMraUi ui)
        {
            return RfSetMraPlanner.Build(c.Sets, ui.ToCore(c.View));
        }

        /// <summary>
        /// ⚠️ Нээлттэй Transaction ДОТОР дуудна (дуудагч эзэмшинэ).  MRA бүр өөрийн SubTransaction — нэг нь унавал бусад үлдэнэ.
        /// Хэмжээсийн төрлийг MRA-ийн хэмжээсэд ЗААВАЛ тохируулна (<see cref="RfElevationService.ApplyMraDimensionType"/>).
        /// </summary>
        public static RfSetMraReport Render(RfSetMraContext c, RfSetMraUi ui, DimensionType dimType)
        {
            var rep = new RfSetMraReport();
            RfSetMraResult plan = Plan(c, ui);
            foreach (RfSetMraWarning w in plan.Warnings)
                rep.Notes.Add("Арматур " + w.Id + ": " + (w.Code == RfSetMraWarn.NoSpread ? "ширхгүүд харагдацад нэг цэгт (тархалтгүй) — MRA тавигдсангүй." : "нэг ширхэг л харагдаж байна."));
            rep.Planned = plan.Plans.Count;
            rep.TagsPlanned = plan.Tags.Count;
            rep.ChainsPlanned = plan.LapChains.Count;
            RenderMras(c, plan, ui, dimType, rep);
            if (plan.Tags.Count > 0) RenderTags(c, plan.Tags, ui.TagTypeId, rep);
            foreach (RfSetLapChainPlan lc in plan.LapChains) CreateChain(c, lc, dimType, rep);
            if (ui.Overall) RenderOverall(c, ui, dimType, rep);
            return rep;
        }

        private static void RenderMras(RfSetMraContext c, RfSetMraResult plan, RfSetMraUi ui, DimensionType dimType, RfSetMraReport rep)
        {
            if (plan.Plans.Count == 0) return;
            MultiReferenceAnnotationType type = ui.MraTypeId == null || ui.MraTypeId == ElementId.InvalidElementId
                ? null : c.Doc.GetElement(ui.MraTypeId) as MultiReferenceAnnotationType;
            if (type == null)
            {
                rep.Failures.Add("MRA (Multi-Rebar Annotation)-ийн төрөл сонгогдоогүй эсвэл олдсонгүй.");
                return;
            }

            HashSet<long> covered = DedupeExistingMras(c, rep);
            foreach (RfSetMraPlan p in plan.Plans)
            {
                if (covered.Contains(p.RebarId))
                {
                    rep.MraExisting++;
                    continue;
                }
                using (var st = new SubTransaction(c.Doc))
                {
                    st.Start();
                    try
                    {
                        var dt = c.Doc.GetElement(type.DimensionStyleId) as DimensionType;
                        RfV3 dir3 = c.Frame.Right * p.LineDir.X + c.Frame.Up * p.LineDir.Y;
                        var opt = new MultiReferenceAnnotationOptions(type)
                        {
                            DimensionStyleType = dt != null ? dt.StyleType : DimensionStyleType.Linear,
                            DimensionLineOrigin = c.Model(p.LineOrigin),
                            DimensionLineDirection = RfConv.X(dir3.Normalized()),
                            DimensionPlaneNormal = c.View.ViewDirection,
                            TagHeadPosition = c.Model(p.Head),
                            TagHasLeader = true,
                        };
                        opt.SetElementsToDimension(new List<ElementId> { new ElementId(p.RebarId) });
                        MultiReferenceAnnotation mra = MultiReferenceAnnotation.Create(c.Doc, c.View.Id, opt);
                        if (mra == null) throw new InvalidOperationException("MultiReferenceAnnotation.Create → null");
                        if (dimType != null) RfElevationService.ApplyMraDimensionType(c.Doc, mra, dimType, p.RebarId, rep.Notes);
                        st.Commit();
                        rep.Created.Add(mra.Id);
                        rep.Made++;
                        covered.Add(p.RebarId);
                    }
                    catch (Exception ex)
                    {
                        if (st.HasStarted() && !st.HasEnded()) st.RollBack();
                        rep.Failures.Add("MRA (арматур " + p.RebarId + "): " + ex.Message.Split('\n')[0].Trim().TrimEnd('.') + ".");
                    }
                }
            }
        }

        /// <summary>
        /// НЭГ АРМАТУРТ НЭГ MRA (2026-10-09, эзэн: «давхцуулж тавихгүй, давхцвал remove хийх — тухайн арматурт multi rebar tag 1 байхад л болно»).
        /// Энэ харагдацын, энэ хостын арматурыг хамарсан MRA-уудыг id-ийн дарааллаар (эртнийх эхэнд) гүйж: хамарсан бүх арматур нь аль хэдийн үлдээсэн MRA-д
        /// хамрагдсан бол тэр MRA илүүдэл → устгана (өөр арматурын цорын ганц MRA-г ХЭЗЭЭ Ч устгахгүй).  Буцаах = MRA-тай арматурын id — тэдэнд шинээр тавихгүй.
        /// Хамрах хүрээ = MRA-ийн хэмжээсийн лавлагааны элементүүд ∪ шошгоны элементүүд.
        /// </summary>
        private static HashSet<long> DedupeExistingMras(RfSetMraContext c, RfSetMraReport rep)
        {
            var kept = new HashSet<long>();
            var found = new List<KeyValuePair<MultiReferenceAnnotation, HashSet<long>>>();
            try
            {
                foreach (MultiReferenceAnnotation m in new FilteredElementCollector(c.Doc).OwnedByView(c.View.Id).OfClass(typeof(MultiReferenceAnnotation))
                             .Cast<MultiReferenceAnnotation>())
                {
                    HashSet<long> ids = CoveredRebars(c.Doc, m);
                    if (ids.Count > 0 && ids.Overlaps(c.RebarIds)) found.Add(new KeyValuePair<MultiReferenceAnnotation, HashSet<long>>(m, ids));
                }
            }
            catch
            {
                return kept;
            }
            foreach (KeyValuePair<MultiReferenceAnnotation, HashSet<long>> kv in found.OrderBy(x => x.Key.Id.Value))
            {
                if (!kv.Value.All(kept.Contains))
                {
                    kept.UnionWith(kv.Value);
                    rep.KeptMras.Add(kv.Key.Id);
                    continue;
                }
                using (var st = new SubTransaction(c.Doc))
                {
                    st.Start();
                    try
                    {
                        c.Doc.Delete(kv.Key.Id);
                        st.Commit();
                        rep.MraDuplicatesRemoved++;
                    }
                    catch (Exception ex)
                    {
                        if (st.HasStarted() && !st.HasEnded()) st.RollBack();
                        rep.Notes.Add("Давхардсан MRA (id " + kv.Key.Id.Value + ")-г устгаж чадсангүй: " + ex.Message.Split('\n')[0].Trim().TrimEnd('.') + ".");
                    }
                }
            }
            return kept;
        }

        private static HashSet<long> CoveredRebars(Document doc, MultiReferenceAnnotation m)
        {
            var ids = new HashSet<long>();
            try
            {
                if (doc.GetElement(m.DimensionId) is Dimension d)
                    foreach (Reference r in d.References)
                        if (r != null && r.ElementId != ElementId.InvalidElementId) ids.Add(r.ElementId.Value);
            }
            catch
            {
                // Хэмжээсийн лавлагаа уншигдахгүй — шошгоор.
            }
            try
            {
                if (doc.GetElement(m.TagId) is IndependentTag t)
                    foreach (ElementId id in t.GetTaggedLocalElementIds())
                        if (id != ElementId.InvalidElementId) ids.Add(id.Value);
            }
            catch
            {
                // Шошго уншигдахгүй.
            }
            return ids;
        }

        /// <summary>
        /// Олонлогийн тусдаа шошго: голын ширхгийн дэд-элементийн лавлагаа (<c>&lt;uid&gt;:2000000+idx:SUBELEMENT</c>) эхлээд, дараа нь элемент.  Leader голын
        /// ширхэг рүү, толгой олонлогийн гадна.  Төрөл = «Хана, хучилт» табын шошго (байхгүй бол дуудагч арматурын табынхыг өгнө).
        /// </summary>
        private static void RenderTags(RfSetMraContext c, List<RfSetTagPlan> tags, ElementId typeId, RfSetMraReport rep)
        {
            FamilySymbol fs = typeId == null || typeId == ElementId.InvalidElementId ? null : c.Doc.GetElement(typeId) as FamilySymbol;
            if (fs == null || !RfSectionRenderer.IsRebarTagType(fs))
            {
                rep.Failures.Add("Хана/хучилтын шошго: арматурын шошгоны төрөл (Structural Rebar Tag) сонгогдоогүй эсвэл олдсонгүй.");
                return;
            }
            try
            {
                if (c.View.GetCategoryHidden(new ElementId(BuiltInCategory.OST_RebarTags)))
                {
                    rep.Failures.Add("Арматурын шошгоны ангилал (Structural Rebar Tags) энэ харагдацад нуугдсан — Visibility/Graphics-ээс асаана уу.");
                    return;
                }
            }
            catch
            {
                // Нуугдсан эсэх уншигдахгүй — үргэлжлүүлнэ.
            }
            if (!fs.IsActive)
            {
                try
                {
                    fs.Activate();
                    c.Doc.Regenerate();
                }
                catch (Exception ex)
                {
                    rep.Failures.Add("Шошгоны төрлийг идэвхжүүлж чадсангүй: " + ex.Message);
                    return;
                }
            }
            foreach (RfSetTagPlan t in tags)
            {
                Rebar rebar;
                if (!c.Rebars.TryGetValue(t.RebarId, out rebar)) continue;
                XYZ target = c.Model(t.Target), head = c.Model(t.Head);
                string last = null;
                bool made = false;
                foreach (Reference reference in RfRebarRefs.TagReferences(rebar, t.BarIndex, true))
                {
                    using (var st = new SubTransaction(c.Doc))
                    {
                        st.Start();
                        try
                        {
                            IndependentTag tag = IndependentTag.Create(c.Doc, fs.Id, c.View.Id, reference, true, TagOrientation.Horizontal, target);
                            if (tag == null) throw new InvalidOperationException("IndependentTag.Create → null");
                            try { tag.TagHeadPosition = head; } catch { /* толгой зөөгдөхгүй — Revit-ийн байрлал */ }
                            try
                            {
                                tag.LeaderEndCondition = LeaderEndCondition.Free;
                                IList<Reference> tagged = tag.GetTaggedReferences();
                                tag.SetLeaderEnd(tagged != null && tagged.Count > 0 ? tagged[0] : reference, target);
                            }
                            catch
                            {
                                // Leader-ийн төгсгөл зөөгдөхгүй — Revit-ийн өгөгдмөл (арматур дээр).
                            }
                            st.Commit();
                            rep.Created.Add(tag.Id);
                            rep.TagsMade++;
                            made = true;
                            break;
                        }
                        catch (Exception ex)
                        {
                            if (st.HasStarted() && !st.HasEnded()) st.RollBack();
                            last = ex.Message.Split('\n')[0].Trim().TrimEnd('.');
                        }
                    }
                }
                if (!made) rep.Failures.Add("Шошго (арматур " + t.RebarId + "): " + (last ?? "лавлагаа олдсонгүй") + ".");
            }
        }

        private static readonly System.Text.RegularExpressions.Regex EndCapCode = new System.Text.RegularExpressions.Regex(@":100[34]000(:|$)");

        /// <summary>
        /// Олонлогийн ширхгийн ТӨГСГӨЛИЙН хэрчмийн лавлагаа (дэлгээсийн <c>FindEndCaps</c>-ийн ерөнхий хувилбар, чиглэл нь дурын): харагдацын геометрийн далд
        /// (Highlight) шугам — урт ≈ голч, ширхгийн чиглэлд перпендикуляр, ширхгийн чиглэлийн координат нь <paramref name="s"/> (≤ 2 мм).
        /// <c>:1003000</c>/<c>:1004000</c> кодтой нь давуу.  Олдохгүй бол null.
        /// </summary>
        private static Reference FindCap(RfSetMraContext c, Rebar rebar, RfV2 dir, double s, double dia)
        {
            GeometryElement ge = RfRebarRefs.ViewGeometry(rebar, c.View);
            if (ge == null) return null;
            Reference found = null;
            bool foundCode = false;
            double tol = RfTol.MmToFt(2);
            var stack = new Stack<GeometryElement>();
            stack.Push(ge);
            while (stack.Count > 0)
            {
                foreach (GeometryObject go in stack.Pop())
                {
                    GeometryInstance gi = go as GeometryInstance;
                    if (gi != null)
                    {
                        GeometryElement sub = null;
                        try { sub = gi.GetSymbolGeometry(); } catch { sub = null; }
                        if (sub != null) stack.Push(sub);
                        continue;
                    }
                    Line l = go as Line;
                    if (l == null) continue;
                    Reference rf;
                    try { rf = l.Reference; } catch { continue; }
                    if (rf == null) continue;
                    RfV2 pa = c.Frame.ToView(RfConv.V(l.GetEndPoint(0))), pb = c.Frame.ToView(RfConv.V(l.GetEndPoint(1)));
                    RfV2 d = pb - pa;
                    double len = d.Length;
                    if (dia > 0 && (len < dia * 0.5 || len > dia * 1.6)) continue;
                    if (Math.Abs(d.Dot(dir)) > 0.05 * len) continue;
                    if (Math.Abs((pa + pb).Dot(dir) * 0.5 - s) > tol) continue;
                    bool code = false;
                    try { code = EndCapCode.IsMatch(rf.ConvertToStableRepresentation(c.Doc)); } catch { code = false; }
                    if (found == null || (code && !foundCode))
                    {
                        found = rf;
                        foundCode = code;
                    }
                }
            }
            return found;
        }

        /// <summary>Давхцалтай олонлогуудын үргэлжилсэн хэмжээс — олонлог бүрийн төгсгөлийн хэрчим, сегмент бүрийн утгыг тулгана.</summary>
        private static void CreateChain(RfSetMraContext c, RfSetLapChainPlan p, DimensionType dimType, RfSetMraReport rep)
        {
            string who = "Үргэлжилсэн хэмжээс (" + string.Join(", ", p.SetId.Distinct()) + ")";
            var ra = new ReferenceArray();
            for (int i = 0; i < p.Pos.Count; i++)
            {
                Rebar r;
                RfSetSample s = c.Sets.FirstOrDefault(x => x.Id == p.SetId[i]);
                if (s == null || !c.Rebars.TryGetValue(p.SetId[i], out r))
                {
                    rep.Failures.Add(who + ": арматур " + p.SetId[i] + " олдсонгүй.");
                    return;
                }
                Reference cap = FindCap(c, r, p.Dir, p.Pos[i], s.Diameter);
                if (cap == null)
                {
                    rep.Failures.Add(who + ": арматур " + p.SetId[i] + "-ийн төгсгөлийн лавлагаа олдсонгүй.");
                    return;
                }
                ra.Append(cap);
            }
            using (var st = new SubTransaction(c.Doc))
            {
                st.Start();
                try
                {
                    Line line = Line.CreateBound(c.Model(p.LineOrigin + p.Dir * p.Pos[0]), c.Model(p.LineOrigin + p.Dir * p.Pos[p.Pos.Count - 1]));
                    Dimension d = dimType != null ? c.Doc.Create.NewDimension(c.View, line, ra, dimType) : c.Doc.Create.NewDimension(c.View, line, ra);
                    if (d == null) throw new InvalidOperationException("NewDimension → null");
                    string why;
                    if (!global::RevitMcpAddin.AutoAnnotate.AaDimType.Enforce(d, dimType, out why))
                    {
                        st.RollBack();
                        rep.Failures.Add(who + ": " + why + " — тавигдсангүй.");
                        return;
                    }
                    c.Doc.Regenerate();
                    string bad = RfElevationService.VerifySegments(d, p.Pos);
                    if (bad != null)
                    {
                        st.RollBack();
                        rep.Failures.Add(who + ": " + bad + " — тавигдсангүй.");
                        return;
                    }
                    st.Commit();
                    rep.Created.Add(d.Id);
                    rep.ChainsMade++;
                }
                catch (Exception ex)
                {
                    if (st.HasStarted() && !st.HasEnded()) st.RollBack();
                    rep.Failures.Add(who + ": " + ex.Message.Split('\n')[0].Trim().TrimEnd('.') + ".");
                }
            }
        }

        /// <summary>
        /// Хана/хучилтын ЕРӨНХИЙ (нийт) хэмжээс: харагдацын хэвтээ (U) ба босоо (V) тэнхлэг тус бүрд хамгийн захын хоёр нүүр хооронд.  Шугам хостын ирмэгээс
        /// хэрэглэгчийн мм-ээр — MRA-ийн ЭСРЭГ талд (MRA автоматаар дээш/баруун тул ерөнхий нь доор/зүүн; «Эсрэг талд» үед эсрэгээр).
        /// </summary>
        private static void RenderOverall(RfSetMraContext c, RfSetMraUi ui, DimensionType dimType, RfSetMraReport rep)
        {
            int scale = c.View.Scale > 0 ? c.View.Scale : 100;
            double first = RfTol.PaperMmToModelFt(ui.OverallOffsetMm, scale);
            double step = RfTol.PaperMmToModelFt(ui.OverallStepMm, scale);
            string who = RfSectionAnalyzer.Describe(c.Doc, c.Host);

            // Энэ хост дээр аль хэдийн тавьсан MRA/шошгоны БОДИТ хүрээ (хэмжсэн, 2026-10-08: ханын огтлолд зүүн талын шошго «800»-тай давхцсан) — ерөнхий хэмжээс
            // хостын ирмэгээс «эхний гинж»-ийн зайд, гэхдээ тэмдэглэгээ тэр талд цухуйж байвал тэдгээрээс «гинж хооронд»-оор цааш (2026-10-09, R2.pdf — ерөнхий
            // хэмжээсийн «Байрлал»-тай адил).  Давхардал устгахад ҮЛДСЭН хуучин MRA-ууд (<see cref="RfSetMraReport.KeptMras"/>) ч тооцогдоно.
            double lowV = double.PositiveInfinity, highV = double.NegativeInfinity, leftU = double.PositiveInfinity, rightU = double.NegativeInfinity;
            try { c.Doc.Regenerate(); } catch { /* хүрээ уншигдахгүй бол хостын ирмэгээр */ }
            foreach (ElementId id in rep.Created.Concat(rep.KeptMras))
            {
                BoundingBoxXYZ bb;
                try { bb = c.Doc.GetElement(id)?.get_BoundingBox(c.View); } catch { bb = null; }
                if (bb == null) continue;
                foreach (double x in new[] { bb.Min.X, bb.Max.X })
                    foreach (double y in new[] { bb.Min.Y, bb.Max.Y })
                        foreach (double z in new[] { bb.Min.Z, bb.Max.Z })
                        {
                            RfV2 q = c.Frame.ToView(new RfV3(x, y, z));
                            lowV = Math.Min(lowV, q.Y);
                            highV = Math.Max(highV, q.Y);
                            leftU = Math.Min(leftU, q.X);
                            rightU = Math.Max(rightU, q.X);
                        }
            }
            // «Байрлал»: доод тал үргэлж, босоо нь зүүн (эсвэл «Зөвхөн баруун ба доод» бол баруун); «4 талд» бол эсрэг тал ч.
            var placements = new List<KeyValuePair<bool, bool>>();   // (alongU, high)
            foreach (bool alongU in new[] { true, false })
            {
                bool primaryHigh = !alongU && ui.OverallRightSide && !ui.OverallAllSides;
                placements.Add(new KeyValuePair<bool, bool>(alongU, primaryHigh));
                if (ui.OverallAllSides) placements.Add(new KeyValuePair<bool, bool>(alongU, true));
            }
            foreach (KeyValuePair<bool, bool> pl in placements)
            {
                bool alongU = pl.Key, high = pl.Value;
                RfHostFaceRef a = alongU ? c.MinUFace : c.MinVFace, b = alongU ? c.MaxUFace : c.MaxVFace;
                if (a == null || b == null || b.Pos - a.Pos < RfTol.MmToFt(1)) continue;
                rep.OverallPlanned++;
                double hostEdge = alongU ? (high ? c.HostMaxV : c.HostMinV) : (high ? c.HostMaxU : c.HostMinU);
                double annEdge = alongU ? (high ? highV : lowV) : (high ? rightU : leftU);
                double line = RfSetMraPlanner.OverallLine(hostEdge, annEdge, high, first, step);
                RfV2 p0 = alongU ? new RfV2(a.Pos, line) : new RfV2(line, a.Pos);
                RfV2 p1 = alongU ? new RfV2(b.Pos, line) : new RfV2(line, b.Pos);
                using (var st = new SubTransaction(c.Doc))
                {
                    st.Start();
                    try
                    {
                        var ra = new ReferenceArray();
                        ra.Append(a.Ref);
                        ra.Append(b.Ref);
                        Line ln = Line.CreateBound(c.Model(p0), c.Model(p1));
                        Dimension d = dimType != null ? c.Doc.Create.NewDimension(c.View, ln, ra, dimType) : c.Doc.Create.NewDimension(c.View, ln, ra);
                        if (d == null) throw new InvalidOperationException("NewDimension → null");
                        string why;
                        if (!global::RevitMcpAddin.AutoAnnotate.AaDimType.Enforce(d, dimType, out why))
                        {
                            st.RollBack();
                            rep.Failures.Add(who + ": ерөнхий хэмжээс — " + why + ".");
                            continue;
                        }
                        c.Doc.Regenerate();
                        string bad = RfElevationService.VerifySegments(d, new List<double> { a.Pos, b.Pos });
                        if (bad != null)
                        {
                            st.RollBack();
                            rep.Failures.Add(who + ": ерөнхий хэмжээс — " + bad + ".");
                            continue;
                        }
                        st.Commit();
                        rep.Created.Add(d.Id);
                        rep.OverallMade++;
                    }
                    catch (Exception ex)
                    {
                        if (st.HasStarted() && !st.HasEnded()) st.RollBack();
                        rep.Failures.Add(who + ": ерөнхий хэмжээс — " + ex.Message.Split('\n')[0].Trim().TrimEnd('.') + ".");
                    }
                }
            }
        }
    }
}
