using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;
using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Structure;
using RevitMcpAddin.Reinforcement.Core;

namespace RevitMcpAddin.Reinforcement
{
    /// <summary>Дэлгээсийн тохиргоо (Revit талын) — цаасан мм.  Үсэг бүрийн утгыг хэрэглэгч оруулна; хэрэгсэл өөрөөсөө зай нэмэхгүй.</summary>
    internal sealed class RfElevUi
    {
        public bool TagBars = true, StirrupMra = true, SpanDims = true, LapDims = true;

        /// <summary>Давхцалтай арматурын эгнээний үргэлжилсэн (гинжин) хэмжээс — <see cref="RfElevOptions.LapChain"/>.</summary>
        public bool LapChain = false;
        public ElementId DimTypeId = ElementId.InvalidElementId;
        public ElementId BarTagTypeId = ElementId.InvalidElementId;
        public ElementId MraTypeId = ElementId.InvalidElementId;

        /// <summary>Гишүүний ирмэгээс шошгоны эхний эгнээ (цаасан мм).</summary>
        public double TagOffsetMm = 8;

        /// <summary>Хөрш шошгоны ХАРАГДАХ зай (цаасан мм).</summary>
        public double TagGapMm = 4;

        /// <summary>Хэмжээсийн эгнээ хоорондын зай (цаасан мм).</summary>
        public double DimPitchMm = 8;

        /// <summary>Гишүүнээс хомутын MRA-ийн хэмжээсийн шугам хүртэл (цаасан мм).  0 = автомат (бусад эгнээний ард).</summary>
        public double StirrupDimOffsetMm = 0;

        /// <summary>«Байрлал»-ын «эхний гинж» (цаасан мм): хэмжээсийн шугам гишүүнээс үүнээс ойр биш.  0 = хязгааргүй.</summary>
        public double DimFirstMm = 0;

        /// <summary>Багана: хэмжээсийг (MRA, давхцал, түвшний гинж) харагдацын ЗҮҮН талд.  false = баруун (өмнөх зан төлөв).</summary>
        public bool ColumnDimsLeft = false;

        /// <summary>Шошгоны leader: 3→2 (хэвтээ хэсэг) ба 2→1 (налуу хэсгийн хэвтээ зай), цаасан мм.  0 = автомат.</summary>
        public double LeaderLandingMm = 0, LeaderRunMm = 0;

        public RfElevOptions ToCore(View view)
        {
            int scale = view != null && view.Scale > 0 ? view.Scale : 100;
            Func<double, double> ft = mm => RfTol.PaperMmToModelFt(mm, scale);
            return new RfElevOptions
            {
                TagBars = TagBars,
                StirrupMra = StirrupMra,
                SpanDims = SpanDims,
                LapDims = LapDims,
                LapChain = LapChain,
                TagOffsetFt = ft(TagOffsetMm),
                TagGapFt = ft(TagGapMm),
                DimPitchFt = ft(DimPitchMm),
                StirrupDimOffsetFt = StirrupDimOffsetMm > 0 ? ft(StirrupDimOffsetMm) : 0,
                DimFirstFt = DimFirstMm > 0 ? ft(DimFirstMm) : 0,
                LeaderLandingFt = LeaderLandingMm > 0 ? ft(LeaderLandingMm) : 0,
                LeaderRunFt = LeaderRunMm > 0 ? ft(LeaderRunMm) : 0,
                // Хэмжих хүртэлх таамаг (цаасан 16 × 5 мм — энгийн «(5) Ø22»).
                DefaultTagWidthFt = ft(16),
                DefaultTagHeightFt = ft(5),
            };
        }
    }

    /// <summary>Нэг арматурын төгсгөлийн лавлагаа (зүүн/баруун, u дарааллаар).</summary>
    internal sealed class RfElevEndRefs
    {
        public Reference Left, Right;
    }

    internal sealed class RfElevContext
    {
        public Document Doc;
        public View View;
        public Element Host;

        /// <summary>
        /// ХОСТ-ТЭНХЛЭГИЙН frame: дам нуруу = харагдацын frame; багана = 90° эргүүлсэн (u = өндөр).  Planner, шошго, MRA, хэмжээс бүгд энэ frame-д (<see cref="RfElevHostFrame"/>).
        /// </summary>
        public RfViewFrame Frame;
        public RfElevAxisKind Axis = RfElevAxisKind.AlongRight;
        public RfElevInput Input = new RfElevInput();
        public readonly Dictionary<long, Rebar> Rebars = new Dictionary<long, Rebar>();
        public readonly Dictionary<long, RfElevEndRefs> EndRefs = new Dictionary<long, RfElevEndRefs>();

        /// <summary>Хэмжээсийн гинжийн лавлах элементүүд (u): дам нууруунд тэнхлэг (Grid), баганад түвшин (Level).</summary>
        public readonly List<KeyValuePair<double, Element>> Spans = new List<KeyValuePair<double, Element>>();
        public bool IsColumn { get { return Axis == RfElevAxisKind.AlongUp; } }
        public int HostRebars, VisibleRebars, SkippedOther, StyleMismatch;

        public XYZ Model(double u, double v) { return RfConv.X(Frame.ToModel(new RfV2(u, v))); }
        public XYZ Model(RfV2 p) { return RfConv.X(Frame.ToModel(p)); }
    }

    internal sealed class RfElevReport
    {
        public int TagsPlanned, Tags, MrasPlanned, Mras, LapsPlanned, Laps, LapChainsPlanned, LapChains, SpansPlanned, Spans, SpanSegments;
        public readonly List<ElementId> Created = new List<ElementId>();
        public readonly List<string> Failures = new List<string>();
        public readonly List<string> Notes = new List<string>();
        public RfElevPlan Plan;
    }

    /// <summary>
    /// Арматурын ДЭЛГЭЭС: дам нурууны хажуугаас харсан харагдац дээр ажлын арматурын шошго, хомутын MRA (алхам + шошго), давхцлын хэмжээс,
    /// тэнхлэгийн гинжийг автоматаар тавина.  Байрлалын дүрэм Core/RfElevation.cs (цэвэр, тесттэй); энд зөвхөн Revit-ээс унших, үүсгэх.
    ///
    /// ⚠️ FACE REFERENCE (бодит Revit 2027 дээр хэмжсэн, 2026-10-05): арматурын хэмжээсийн лавлагаа нь Edge/Face БИШ — харагдацын геометрт
    /// <c>IncludeNonVisibleObjects</c>-оор гарах «Highlight» шугамууд.  Шулуун арматурын хоёр үзүүрийн хэрчим <c>…:1003000</c> (эхлэл) /
    /// <c>…:1004000</c> (төгсгөл); голын шугам <c>…:1100000</c>.  Гараар тавьсан «500» давхцлын хэмжээс яг эдгээрийг заадаг.  Хомутын олонлог нь
    /// MRA-аар (<see cref="MultiReferenceAnnotation"/>) — олонлогийн элементийг л өгнө.
    /// </summary>
    internal static class RfElevationService
    {
        /// <summary>Нэг дам нуурууны уншихад ашиглах арматурын ширхгийн дээд (олонлогийн ширхэг тус бүр биш, элемент).</summary>
        private const int MaxRebars = 400;

        /// <summary>Олонлогоос шалгах ширхгийн дээд (эхний + сүүлийн + завсар).</summary>
        private const int MaxBarsPerSet = 24;

        private static readonly Regex EndCapCode = new Regex(@":100[34]000(:|$)", RegexOptions.CultureInvariant);

        // ── Хост таних ──────────────────────────────────────────────────

        /// <summary>
        /// Дам нуруу уг харагдацад ХЭВЭЭР (хажуугаас) харагдаж байна уу: тэнхлэг нь харагдацын хавтгайд параллель (≤ 5.7°) ба харагдацын «баруун»
        /// чигтэй параллель (≤ 5.7°).  Огтлол (тэнхлэг нь харагдацын нормалиар) ба босоо багана энд ОРОХГҮЙ.
        /// </summary>
        public static bool IsElevationHost(View view, Element host)
        {
            RfViewFrame ignore;
            return ElevationKind(view, host, out ignore) != RfElevAxisKind.None;
        }

        /// <summary>
        /// Гишүүн энэ харагдацад дэлгээсээр (уртаашаа) харагдаж байна уу: дам нуруу = тэнхлэг нь харагдацын «баруун»-тай, багана = «дээш»-тэй параллель.
        /// <paramref name="hostFrame"/> = planner-ийн ашиглах frame (<see cref="RfElevHostFrame"/>).  Огтлол (тэнхлэг нормалиар), налуу = None.
        /// </summary>
        public static RfElevAxisKind ElevationKind(View view, Element host, out RfViewFrame hostFrame)
        {
            RfV3 axis;
            hostFrame = RfView.Frame(view);
            if (!AxisOf(host, out axis)) return RfElevAxisKind.None;
            return RfElevHostFrame.Resolve(hostFrame, axis, RfSectionAnalyzer.InPlaneMaxDot, out hostFrame);
        }

        /// <summary>
        /// Гишүүний тэнхлэг (уртааш чиглэл).  Дам нуруу, налуу багана = голын шугам (шулуун биш бол false); БОСОО багана (LocationPoint, налуу биш) = (0, 0, 1).
        /// </summary>
        public static bool AxisOf(Element e, out RfV3 axis)
        {
            axis = new RfV3(0, 0, 0);
            try
            {
                LocationCurve lc = e.Location as LocationCurve;
                Line ln = lc == null ? null : lc.Curve as Line;
                if (ln != null)
                {
                    axis = RfConv.V(ln.Direction).Normalized();
                    return axis.Length > 0.5;
                }
                if (lc == null && RfSectionAnalyzer.KindOf(e) == RfHostKind.Column)
                {
                    FamilyInstance fi = e as FamilyInstance;
                    if (fi != null && !fi.IsSlantedColumn)
                    {
                        axis = new RfV3(0, 0, 1);
                        return true;
                    }
                }
                return false;
            }
            catch
            {
                return false;
            }
        }

        // ── ANALYZE (Revit-д юу ч бичихгүй) ───────────────────────────

        public static RfElevContext Analyze(Document doc, View view, Element host, RfElevUi ui)
        {
            RfViewFrame hostFrame;
            RfElevAxisKind kind = ElevationKind(view, host, out hostFrame);
            if (kind == RfElevAxisKind.None) hostFrame = RfView.Frame(view); // дуудагч IsElevationHost-оор шүүсэн — аюулгүй байдлын нөөц
            // Багана: хэмжээсийн («доод») тал = харагдацын баруун (өгөгдмөл) эсвэл «Байрлал — зүүн ба доод» үед зүүн.
            if (kind == RfElevAxisKind.AlongUp && ui.ColumnDimsLeft) hostFrame = RfElevHostFrame.RotatedLeft(RfView.Frame(view));
            var c = new RfElevContext { Doc = doc, View = view, Host = host, Frame = hostFrame, Axis = kind == RfElevAxisKind.None ? RfElevAxisKind.AlongRight : kind };
            c.Input.Options = ui.ToCore(view);
            ReadBeamExtent(c);
            if (c.IsColumn) ReadLevels(c);
            else ReadGrids(c);
            ReadRebars(c);
            return c;
        }

        private static void ReadBeamExtent(RfElevContext c)
        {
            double u0 = double.MaxValue, u1 = double.MinValue, v0 = double.MaxValue, v1 = double.MinValue;
            Action<XYZ> add = p =>
            {
                RfV2 q = c.Frame.ToView(RfConv.V(p));
                if (q.X < u0) u0 = q.X;
                if (q.X > u1) u1 = q.X;
                if (q.Y < v0) v0 = q.Y;
                if (q.Y > v1) v1 = q.Y;
            };
            try
            {
                GeometryElement ge = c.Host.get_Geometry(new Options { DetailLevel = ViewDetailLevel.Fine });
                if (ge != null) WalkEdges(ge, Transform.Identity, add);
            }
            catch
            {
                // Геометр уншигдахгүй — доорх bbox.
            }
            if (u0 > u1)
            {
                try
                {
                    BoundingBoxXYZ bb = c.Host.get_BoundingBox(null);
                    if (bb != null)
                    {
                        foreach (double x in new[] { bb.Min.X, bb.Max.X })
                            foreach (double y in new[] { bb.Min.Y, bb.Max.Y })
                                foreach (double z in new[] { bb.Min.Z, bb.Max.Z })
                                    add(new XYZ(x, y, z));
                    }
                }
                catch
                {
                    // Хүрээ мэдэгдэхгүй.
                }
            }
            if (u0 <= u1)
            {
                c.Input.BeamU0 = u0;
                c.Input.BeamU1 = u1;
                c.Input.BeamV0 = v0;
                c.Input.BeamV1 = v1;
            }
        }

        private static void WalkEdges(GeometryElement ge, Transform t, Action<XYZ> add)
        {
            foreach (GeometryObject go in ge)
            {
                Solid s = go as Solid;
                if (s != null && s.Volume > 1e-9)
                {
                    foreach (Edge e in s.Edges)
                    {
                        Curve cv = e.AsCurve();
                        add(t.OfPoint(cv.GetEndPoint(0)));
                        add(t.OfPoint(cv.GetEndPoint(1)));
                    }
                    continue;
                }
                GeometryInstance gi = go as GeometryInstance;
                if (gi != null)
                {
                    GeometryElement sym = gi.GetSymbolGeometry();
                    if (sym != null) WalkEdges(sym, t.Multiply(gi.Transform), add);
                }
            }
        }

        private static void ReadGrids(RfElevContext c)
        {
            try
            {
                foreach (Grid g in new FilteredElementCollector(c.Doc, c.View.Id).OfClass(typeof(Grid)).Cast<Grid>())
                {
                    Line ln = g.Curve as Line;
                    if (ln == null) continue;
                    RfV3 d = RfConv.V(ln.Direction).Normalized();
                    // Харагдацад босоо шугам болж харагдах тэнхлэг: чиглэл нь «баруун»-д перпендикуляр.
                    if (Math.Abs(d.Dot(c.Frame.Right)) > 0.02) continue;
                    double u = c.Frame.ToView(RfConv.V(ln.GetEndPoint(0))).X;
                    c.Spans.Add(new KeyValuePair<double, Element>(u, g));
                    c.Input.GridU.Add(u);
                }
            }
            catch
            {
                // Тэнхлэг уншигдахгүй — гинж тавигдахгүй.
            }
        }

        /// <summary>
        /// БАГАНЫ дэлгээс: хэмжээсийн гинжийн лавлах нь харагдацад харагдаж буй ТҮВШИН (Level) — давхрын өндрийн гинж.  Түвшний шугам харагдацын «дээш»-тэй
        /// перпендикуляр (хэвтээ) харагдах ёстой, тиймээс харагдацад ХЭВТЭЭ шугам болж гарах (view-д зүсэгдсэн) түвшнийг л авна.  u = түвшний өндөр (багана-frame-д).
        /// </summary>
        private static void ReadLevels(RfElevContext c)
        {
            try
            {
                foreach (Level lv in new FilteredElementCollector(c.Doc, c.View.Id).OfClass(typeof(Level)).Cast<Level>())
                {
                    // Түвшин нь Z = ProjectElevation дээрх хавтгай; frame-ийн u тэнхлэг (босоо) руу цэгийг буулгана.
                    double u = c.Frame.ToView(new RfV3(0, 0, lv.ProjectElevation)).X;
                    // Төв цэг (0,0,z) харагдацын хавтгайн өөр гүнд байж болно — u нь Up-тай ЗӨВХӨН z-ээр л тогтоно (View.Up босоо үед), эс бөгөөс алгасна.
                    if (Math.Abs(c.Frame.Right.Z) < 0.999) continue;
                    c.Spans.Add(new KeyValuePair<double, Element>(u, lv));
                    c.Input.GridU.Add(u);
                }
            }
            catch
            {
                // Түвшин уншигдахгүй — гинж тавигдахгүй.
            }
        }

        private static void ReadRebars(RfElevContext c)
        {
            IList<Rebar> inHost = null;
            try
            {
                if (RebarHostData.IsValidHost(c.Host))
                {
                    RebarHostData hd = RebarHostData.GetRebarHostData(c.Host);
                    if (hd != null) inHost = hd.GetRebarsInHost();
                }
            }
            catch
            {
                inHost = null;
            }
            if (inHost == null) return;
            c.HostRebars = inHost.Count;

            var visible = new HashSet<long>();
            foreach (ElementId id in new FilteredElementCollector(c.Doc, c.View.Id).OfClass(typeof(Rebar)).ToElementIds())
                visible.Add(id.Value);

            RfV3 axis;
            AxisOf(c.Host, out axis);
            var styleCache = new Dictionary<long, RfRebarStyle>();
            int n = 0;
            foreach (Rebar r in inHost)
            {
                if (r == null || !visible.Contains(r.Id.Value)) continue;
                if (++n > MaxRebars) break;
                c.VisibleRebars++;

                List<int> existing = RfSectionAnalyzer.ExistingBars(r);
                if (existing.Count == 0) continue;
                List<RfV3> probe = RfSectionAnalyzer.PointsAt(r, existing[0]);
                RfBarClass geom = probe == null ? RfBarClass.Other : RfSectionGeometry.Classify(probe, axis);
                RfRebarStyle style = RfSectionAnalyzer.StyleOf(r, styleCache);
                RfClassBasis basis;
                RfBarClass cls = RfSectionGeometry.Resolve(style, geom, out basis);
                if (basis == RfClassBasis.Mismatch)
                {
                    c.StyleMismatch++;
                    continue;
                }
                double dia = RfSectionAnalyzer.Diameter(c.Doc, r);

                if (cls == RfBarClass.Transverse)
                {
                    List<RfV3> last = existing.Count > 1 ? RfSectionAnalyzer.PointsAt(r, existing[existing.Count - 1]) : probe;
                    if (probe == null || last == null) continue;
                    double ua = Mean(probe.Select(p => c.Frame.ToView(p).X)), ub = Mean(last.Select(p => c.Frame.ToView(p).X));
                    c.Rebars[r.Id.Value] = r;
                    c.Input.Stirrups.Add(new RfElevStirrup { Id = r.Id.Value, U0 = Math.Min(ua, ub), U1 = Math.Max(ua, ub), Count = existing.Count });
                }
                else if (cls == RfBarClass.Longitudinal)
                {
                    RfElevBar bar = ReadLongitudinal(c, r, existing, dia);
                    if (bar == null) continue;
                    c.Rebars[r.Id.Value] = r;
                    c.Input.Bars.Add(bar);
                }
                else
                {
                    c.SkippedOther++;
                }
            }

            // Давхцалын хэмжээсийн төгсгөлийн лавлагаа олдсон эсэх (Core зөвхөн шулуун арматурт сонгоно) — олдохгүй бол шулуун гэж тооцохгүй.
            if (c.Input.Options.LapDims || c.Input.Options.LapChain)
            {
                foreach (RfElevBar b in c.Input.Bars.Where(x => x.Straight))
                {
                    RfElevEndRefs er = FindEndCaps(c, c.Rebars[b.Id], b);
                    b.HasEndRefs = er != null;
                    if (er == null) b.Straight = false;
                    else c.EndRefs[b.Id] = er;
                }
            }
        }

        private static double Mean(IEnumerable<double> xs)
        {
            double s = 0;
            int n = 0;
            foreach (double x in xs) { s += x; n++; }
            return n == 0 ? 0 : s / n;
        }

        private static RfElevBar ReadLongitudinal(RfElevContext c, Rebar r, List<int> existing, double dia)
        {
            // Ширхгүүдээс түүвэр (олонлог том бол эхний/сүүлийн/завсар).
            var idxs = new List<int>();
            if (existing.Count <= MaxBarsPerSet) idxs.AddRange(existing);
            else
            {
                double step = (existing.Count - 1) / (double)(MaxBarsPerSet - 1);
                for (int k = 0; k < MaxBarsPerSet; k++) idxs.Add(existing[(int)Math.Round(k * step)]);
            }
            double u0 = double.MaxValue, u1 = double.MinValue;
            var vs = new List<double>();
            var vIdx = new List<int>();
            bool straight = true;
            bool first = true;
            foreach (int idx in idxs)
            {
                List<RfV3> pts = RfSectionAnalyzer.PointsAt(r, idx);
                if (pts == null) continue;
                double bu0 = double.MaxValue, bu1 = double.MinValue, sv = 0;
                foreach (RfV3 p in pts)
                {
                    RfV2 q = c.Frame.ToView(p);
                    if (q.X < bu0) bu0 = q.X;
                    if (q.X > bu1) bu1 = q.X;
                    sv += q.Y;
                }
                if (bu0 < u0) u0 = bu0;
                if (bu1 > u1) u1 = bu1;
                vs.Add(sv / pts.Count);
                vIdx.Add(idx);
                if (first)
                {
                    first = false;
                    // Шулуун = нэг сегмент (tessellated 2 цэг) ба харагдацын хавтгайд хэвтээ.
                    if (pts.Count != 2) straight = false;
                    else if (Math.Abs(c.Frame.ToView(pts[0]).Y - c.Frame.ToView(pts[1]).Y) > RfTol.MmToFt(1)) straight = false;
                }
            }
            if (vs.Count == 0 || u0 > u1) return null;
            double mean = vs.Average();
            double mid = (c.Input.BeamV0 + c.Input.BeamV1) / 2;
            // Гишүүний талд хамгийн ойр ширхэг: дээд тал → хамгийн их v; доод тал → хамгийн бага v.
            double anchorV = mean >= mid ? vs.Max() : vs.Min();
            int anchorIdx = vIdx[vs.IndexOf(anchorV)];
            return new RfElevBar
            {
                Id = r.Id.Value,
                Group = RfSectionAnalyzer.GroupKey(c.Doc, r, dia),
                Diameter = dia,
                U0 = u0,
                U1 = u1,
                AnchorV = anchorV,
                TagBarIndex = anchorIdx,
                MeanV = mean,
                Straight = straight,
            };
        }

        // ── FACE REFERENCE: арматурын төгсгөлийн хэрчим ───────────────

        /// <summary>
        /// Шулуун арматурын зүүн/баруун ТӨГСГӨЛИЙН хэрчмийн лавлагаа.  <c>View + IncludeNonVisibleObjects</c> геометрийн «Highlight» шугамаас:
        /// харагдацад босоо (арматурын тэнхлэгт перпендикуляр), урт нь ≈ голч, u нь арматурын төгсгөлд (≤ 2 мм).  <c>:1003000</c>/<c>:1004000</c> кодтой нь
        /// давуу (гараар хэмжээс тавихад Revit-ийн өөрийн ашигладаг).  Олдохгүй бол null.
        /// </summary>
        internal static RfElevEndRefs FindEndCaps(RfElevContext c, Rebar rebar, RfElevBar bar)
        {
            GeometryElement ge;
            try { ge = rebar.get_Geometry(new Options { ComputeReferences = true, View = c.View, IncludeNonVisibleObjects = true }); }
            catch { return null; }
            if (ge == null) return null;
            double tol = RfTol.MmToFt(2);
            Reference left = null, right = null;
            bool leftCode = false, rightCode = false;
            Walk(ge, line =>
            {
                Reference rf;
                try { rf = line.Reference; }
                catch { return; }
                if (rf == null) return;
                RfV3 a = RfConv.V(line.GetEndPoint(0)), b = RfConv.V(line.GetEndPoint(1));
                RfV2 pa = c.Frame.ToView(a), pb = c.Frame.ToView(b);
                RfV2 d = pb - pa;
                double len = d.Length;
                if (len < bar.Diameter * 0.5 || len > bar.Diameter * 1.6) return;
                if (Math.Abs(d.X) / len > 0.05) return; // босоо биш
                double u = (pa.X + pb.X) / 2;
                bool code = false;
                try { code = EndCapCode.IsMatch(rf.ConvertToStableRepresentation(c.Doc)); }
                catch { code = false; }
                if (Math.Abs(u - bar.U0) <= tol && (left == null || (code && !leftCode)))
                {
                    left = rf;
                    leftCode = code;
                }
                if (Math.Abs(u - bar.U1) <= tol && (right == null || (code && !rightCode)))
                {
                    right = rf;
                    rightCode = code;
                }
            });
            if (left == null || right == null) return null;
            return new RfElevEndRefs { Left = left, Right = right };
        }

        private static void Walk(GeometryElement ge, Action<Line> onLine)
        {
            foreach (GeometryObject go in ge)
            {
                Line l = go as Line;
                if (l != null) { onLine(l); continue; }
                GeometryInstance gi = go as GeometryInstance;
                if (gi != null)
                {
                    GeometryElement sub = null;
                    try { sub = gi.GetSymbolGeometry(); }
                    catch { sub = null; }
                    if (sub != null) Walk(sub, onLine);
                }
            }
        }

        // ── PLAN ────────────────────────────────────────────────────────

        public static RfElevPlan Plan(RfElevContext c, RfElevSizes sizes)
        {
            return RfElevPlanner.Build(c.Input, sizes);
        }

        // ── RENDER ──────────────────────────────────────────────────────

        /// <summary>
        /// ⚠️ ОНЦГОЙ Transaction ДОТОР дуудна (дуудагч эзэмшинэ).  Хоёр шат: (1) ТҮР — шошго, MRA-г толгойгүйгээр (leader-гүй) үүсгээд бодит өргөн/өндрийг
        /// хэмжиж БУЦААНА; (2) эцсийн байрлалаар (хэрэглэгчийн зайтай) үүсгэнэ.
        /// </summary>
        public static RfElevReport Render(RfElevContext c, RfElevUi ui)
        {
            var rep = new RfElevReport();
            RfElevPlan plan0 = Plan(c, null);
            foreach (RfElevWarning w in plan0.Warnings) Describe(w, rep, c.IsColumn);
            if (plan0.Tags.Count + plan0.Mras.Count + plan0.Laps.Count + plan0.LapChains.Count + plan0.Spans.Count == 0)
            {
                rep.Plan = plan0;
                return rep;
            }

            DimensionType dimType = ui.DimTypeId != ElementId.InvalidElementId ? c.Doc.GetElement(ui.DimTypeId) as DimensionType : null;
            FamilySymbol tagType = PrepareTagType(c, ui.BarTagTypeId, plan0.Tags.Count > 0, rep, false);
            MultiReferenceAnnotationType mraType = PrepareMraType(c, ui.MraTypeId, plan0.Mras.Count > 0, rep);

            // 1. ХЭМЖИХ
            RfElevSizes sizes = Measure(c, plan0, tagType, mraType, rep);
            RfElevPlan plan = Plan(c, sizes);
            rep.Plan = plan;
            rep.TagsPlanned = plan.Tags.Count;
            rep.MrasPlanned = plan.Mras.Count;
            rep.LapsPlanned = plan.Laps.Count;
            rep.SpansPlanned = plan.Spans.Count;
            rep.LapChainsPlanned = plan.LapChains.Count;

            // 2. ЭЦСИЙН
            if (tagType != null) foreach (RfElevTagPlan t in plan.Tags) CreateTag(c, t, tagType, true, rep, true);
            if (mraType != null) foreach (RfElevMraPlan m in plan.Mras) CreateMra(c, m, mraType, dimType, true, rep, true);
            foreach (RfElevLapPlan l in plan.Laps) CreateLap(c, l, dimType, rep);
            foreach (RfElevLapChainPlan lc in plan.LapChains) CreateLapChain(c, lc, dimType, rep);
            foreach (RfElevSpanPlan s in plan.Spans) CreateSpan(c, s, dimType, rep);
            return rep;
        }

        private static void Describe(RfElevWarning w, RfElevReport rep, bool column)
        {
            string host = column ? "баганы" : "дам нурууны";
            switch (w.Code)
            {
                case RfElevWarn.NoBeamExtent: rep.Notes.Add((column ? "Баганын" : "Дам нурууны") + " хэмжээг (харагдацад) тодорхойлж чадсангүй."); break;
                case RfElevWarn.NoBars: rep.Notes.Add("Энэ " + host + " харагдаж буй ажлын арматур олдсонгүй."); break;
                case RfElevWarn.NoStirrups: rep.Notes.Add("Энэ " + host + " харагдаж буй хомут олдсонгүй."); break;
                case RfElevWarn.StirrupSingle: rep.Notes.Add("Нэг ширхэг хомут (id " + w.Arg + ") — алхамгүй тул MRA тавигдсангүй."); break;
                case RfElevWarn.FewGrids:
                    rep.Notes.Add(column
                        ? "Баганын өндөрт дайрсан түвшин " + w.Arg + " — гинжид 2+ түвшин хэрэгтэй."
                        : "Дам нурууны уртад дайрсан тэнхлэг " + w.Arg + " — гинжид 2+ тэнхлэг хэрэгтэй.");
                    break;
                case RfElevWarn.LapNoRefs: rep.Notes.Add("Давхцлын хэмжээсийн лавлагаа олдсонгүй."); break;
                case RfElevWarn.StirrupOffsetOverlap:
                    rep.Notes.Add("Хомутын хэмжээсийн зай хэт бага — хэмжээсийн шугам шошго/давхцлын эгнээнд давхцаж байна. Зайг нэмж үзнэ үү.");
                    break;
            }
        }

        // ── Төрөл бэлтгэх ──────────────────────────────────────────────

        private static FamilySymbol PrepareTagType(RfElevContext c, ElementId typeId, bool needed, RfElevReport rep, bool silent)
        {
            if (!needed) return null;
            if (typeId == null || typeId == ElementId.InvalidElementId)
            {
                rep.Failures.Add("Арматурын шошгоны төрөл сонгогдоогүй.");
                return null;
            }
            FamilySymbol fs = c.Doc.GetElement(typeId) as FamilySymbol;
            if (fs == null || !RfSectionRenderer.IsRebarTagType(fs))
            {
                rep.Failures.Add("Сонгосон шошгоны төрөл Structural Rebar Tag биш.");
                return null;
            }
            try
            {
                if (c.View.GetCategoryHidden(new ElementId(BuiltInCategory.OST_RebarTags)))
                {
                    rep.Failures.Add("Арматурын шошгоны ангилал (Structural Rebar Tags) энэ харагдацад нуугдсан — Visibility/Graphics-ээс асаана уу.");
                    return null;
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
                    return null;
                }
            }
            return fs;
        }

        private static MultiReferenceAnnotationType PrepareMraType(RfElevContext c, ElementId typeId, bool needed, RfElevReport rep)
        {
            if (!needed) return null;
            if (typeId == null || typeId == ElementId.InvalidElementId)
            {
                rep.Failures.Add("Хомутын MRA (Multi-Rebar Annotation)-ийн төрөл сонгогдоогүй.");
                return null;
            }
            MultiReferenceAnnotationType t = c.Doc.GetElement(typeId) as MultiReferenceAnnotationType;
            if (t == null)
                rep.Failures.Add("Сонгосон MRA төрөл олдсонгүй.");
            return t;
        }

        // ── Хэмжих шат ────────────────────────────────────────────────

        private static RfElevSizes Measure(RfElevContext c, RfElevPlan plan0, FamilySymbol tagType, MultiReferenceAnnotationType mraType, RfElevReport rep)
        {
            var sizes = new RfElevSizes();
            if ((tagType == null || plan0.Tags.Count == 0) && (mraType == null || plan0.Mras.Count == 0)) return sizes;
            using (var st = new SubTransaction(c.Doc))
            {
                st.Start();
                try
                {
                    var tmp = new RfElevReport();
                    if (tagType != null)
                    {
                        foreach (RfElevTagPlan t in plan0.Tags)
                        {
                            IndependentTag tag = CreateTag(c, t, tagType, false, tmp, false);
                            double[] wh = tag == null ? null : SizeOf(c, tag);
                            if (wh != null) sizes.Tag[t.BarId] = wh;
                        }
                    }
                    if (mraType != null)
                    {
                        foreach (RfElevMraPlan m in plan0.Mras)
                        {
                            MultiReferenceAnnotation mra = CreateMra(c, m, mraType, null, false, tmp, false);
                            IndependentTag tag = mra == null ? null : c.Doc.GetElement(mra.TagId) as IndependentTag;
                            double[] wh = tag == null ? null : SizeOf(c, tag);
                            if (wh != null) sizes.Mra[m.RebarId] = wh;
                        }
                    }
                }
                catch (Exception ex)
                {
                    rep.Notes.Add("Шошгоны хэмжээг хэмжиж чадсангүй (" + ex.Message.Trim().TrimEnd('.') + ") — таамаг хэмжээгээр байрлууллаа.");
                }
                finally
                {
                    if (st.HasStarted() && !st.HasEnded()) st.RollBack(); // ТҮР: хэзээ ч үлдээхгүй
                }
            }
            return sizes;
        }

        /// <summary>Tag-ийн (leader-гүй) харагдацын u/v дахь өргөн, өндөр.</summary>
        private static double[] SizeOf(RfElevContext c, IndependentTag tag)
        {
            try
            {
                c.Doc.Regenerate();
                BoundingBoxXYZ bb = tag.get_BoundingBox(c.View);
                if (bb == null) return null;
                double u0 = double.MaxValue, u1 = double.MinValue, v0 = double.MaxValue, v1 = double.MinValue;
                foreach (double x in new[] { bb.Min.X, bb.Max.X })
                    foreach (double y in new[] { bb.Min.Y, bb.Max.Y })
                        foreach (double z in new[] { bb.Min.Z, bb.Max.Z })
                        {
                            RfV2 q = c.Frame.ToView(new RfV3(x, y, z));
                            if (q.X < u0) u0 = q.X;
                            if (q.X > u1) u1 = q.X;
                            if (q.Y < v0) v0 = q.Y;
                            if (q.Y > v1) v1 = q.Y;
                        }
                double w = u1 - u0, h = v1 - v0;
                if (!(w > RfTol.PointFt) || !(h > RfTol.PointFt)) return null;
                return new[] { w, h };
            }
            catch
            {
                return null;
            }
        }

        // ── Үүсгэх ─────────────────────────────────────────────────────

        private static IndependentTag CreateTag(RfElevContext c, RfElevTagPlan t, FamilySymbol type, bool leader, RfElevReport rep, bool final)
        {
            Rebar rebar;
            if (!c.Rebars.TryGetValue(t.BarId, out rebar)) return null;
            int barIndex = 0;
            foreach (RfElevBar b in c.Input.Bars)
            {
                if (b.Id == t.BarId) { barIndex = b.TagBarIndex; break; }
            }
            XYZ target = c.Model(t.Anchor);
            XYZ head = c.Model(t.Head);
            // Хэрэглэгчийн заасан leader-ийн 3→2 / 2→1 зай (зөвхөн эцсийн шошго; хэмжих шошго нь leader-гүй).  Шошгоны өргөн нь хэмжсэн утга —
            // багана дээр host frame 90° эргэсэн тул харагдацын ХЭВТЭЭ өргөн = frame-ийн өндөр.
            XYZ elbowPt = null;
            if (final && leader && RfLeaderPlacer.IsOn(c.Input.Options.LeaderLandingFt, c.Input.Options.LeaderRunFt))
            {
                XYZ headPlanned = head;
                string shapeNote;
                if (RfLeaderPlacer.Plan(c.View, target, headPlanned, c.IsColumn ? t.Height : t.Width, c.Input.Options.LeaderLandingFt, c.Input.Options.LeaderRunFt,
                        out head, out elbowPt, out shapeNote) && shapeNote != null)
                    rep.Notes.Add("Шошго (арматур " + t.BarId + "): " + shapeNote);
            }
            string lastError = null;
            // ⚠️ Revit «The reference can not be tagged» гэж `new Reference(rebar)`-ийг хүлээн авдаггүй (дэлгээсэд хэмжсэн, 2026-10-05) — гараар
            // тавьсан шошго `<uid>:2000000:SUBELEMENT` дэд-элементийн лавлагаатай.  Тиймээс нэр дэвшигчдийг дарааллаар оролдоно.
            foreach (Reference reference in RfRebarRefs.TagReferences(rebar, barIndex, true))
            {
                using (var st = new SubTransaction(c.Doc))
                {
                    st.Start();
                    try
                    {
                        IndependentTag tag = IndependentTag.Create(c.Doc, type.Id, c.View.Id, reference, leader, TagOrientation.Horizontal, leader ? target : head);
                        if (tag == null) throw new InvalidOperationException("IndependentTag.Create → null");
                        string problem = null;
                        try { tag.TagHeadPosition = head; }
                        catch (Exception ex) { problem = ex.Message; }
                        if (leader)
                        {
                            try
                            {
                                tag.LeaderEndCondition = LeaderEndCondition.Free;
                                IList<Reference> tagged = tag.GetTaggedReferences();
                                Reference tr = tagged != null && tagged.Count > 0 ? tagged[0] : reference;
                                tag.SetLeaderEnd(tr, target);
                            }
                            catch (Exception ex)
                            {
                                problem = problem ?? ex.Message;
                            }
                        }
                        if (problem != null && final)
                            rep.Notes.Add("Шошго (id " + t.BarId + "): толгой/leader-ийн байрлалыг бүрэн тохируулж чадсангүй (" + problem.Trim().TrimEnd('.') + ").");
                        if (elbowPt != null)
                        {
                            try { c.Doc.Regenerate(); }
                            catch { /* regenerate амжилтгүй — elbow-г шууд оролдоно */ }
                            string elbowProblem = RfLeaderPlacer.Apply(tag, reference, elbowPt);
                            if (elbowProblem != null)
                                rep.Notes.Add("Шошго (арматур " + t.BarId + "): leader-ийн elbow-г заасан зайгаар тавьж чадсангүй (" + elbowProblem + ") — Revit-ийн автомат elbow-оор үлдлээ.");
                        }
                        st.Commit();
                        if (final)
                        {
                            rep.Created.Add(tag.Id);
                            rep.Tags++;
                        }
                        return tag;
                    }
                    catch (Exception ex)
                    {
                        if (st.HasStarted() && !st.HasEnded()) st.RollBack();
                        lastError = ex.Message.Split('\n')[0].Trim().TrimEnd('.');
                    }
                }
            }
            if (final) rep.Failures.Add("Шошго (арматур " + t.BarId + "): " + lastError + ".");
            return null;
        }

        /// <summary>
        /// MRA-ийн хэмжээс нь MRA ТӨРЛИЙН өөрийн хэмжээсийн загварыг (<c>MultiReferenceAnnotationType.DimensionStyleId</c>) хэрэглэдэг тул хэрэглэгчийн сонгосон
        /// «Хэмжээсийн төрөл» ЭНД чимээгүй үл тоогддог байв.  Үүссэн MRA-ийн хэмжээсийг сонгосон төрөлд тохируулна.  Revit зөвшөөрөхгүй бол MRA хэвээр
        /// үлдэж (тавигдсан), ИЛ тэмдэглэл гарна: «MRA-ийн хэмжээс X төрлөөр» — өөр төрлөөр чимээгүй гарахгүй.  MRA төрлийг өөрчлөхгүй (төслийн бусад MRA-д нөлөөлнө).
        /// </summary>
        internal static void ApplyMraDimensionType(Document doc, MultiReferenceAnnotation mra, DimensionType dimType, long rebarId, List<string> notes)
        {
            try
            {
                Dimension child = doc.GetElement(mra.DimensionId) as Dimension;
                if (child == null) return;
                string why;
                if (!global::RevitMcpAddin.AutoAnnotate.AaDimType.Enforce(child, dimType, out why))
                    notes.Add("MRA (арматур " + rebarId + "): хэмжээсийг «" + global::RevitMcpAddin.AutoAnnotate.AaDimType.SafeName(dimType)
                        + "» төрөлд шилжүүлж чадсангүй — MRA төрлийнхөө хэмжээсийн загвараар үлдлээ (" + why + ").");
            }
            catch (Exception ex)
            {
                notes.Add("MRA (арматур " + rebarId + "): хэмжээсийн төрлийг шалгаж чадсангүй (" + ex.Message.Split('\n')[0].Trim().TrimEnd('.') + ").");
            }
        }

        private static MultiReferenceAnnotation CreateMra(RfElevContext c, RfElevMraPlan m, MultiReferenceAnnotationType type, DimensionType dimType, bool leader, RfElevReport rep, bool final)
        {
            using (var st = new SubTransaction(c.Doc))
            {
                st.Start();
                try
                {
                    var dt = c.Doc.GetElement(type.DimensionStyleId) as DimensionType;
                    double midU = (m.U0 + m.U1) / 2;
                    var opt = new MultiReferenceAnnotationOptions(type)
                    {
                        DimensionStyleType = dt != null ? dt.StyleType : DimensionStyleType.Linear,
                        DimensionLineOrigin = c.Model(midU, m.LineV),
                        DimensionLineDirection = RfConv.X(c.Frame.Right),
                        DimensionPlaneNormal = c.View.ViewDirection,
                        TagHeadPosition = c.Model(m.Head),
                        TagHasLeader = leader,
                    };
                    opt.SetElementsToDimension(new List<ElementId> { new ElementId(m.RebarId) });
                    MultiReferenceAnnotation mra = MultiReferenceAnnotation.Create(c.Doc, c.View.Id, opt);
                    if (mra == null) throw new InvalidOperationException("MultiReferenceAnnotation.Create → null");
                    if (final && dimType != null) ApplyMraDimensionType(c.Doc, mra, dimType, m.RebarId, rep.Notes);
                    st.Commit();
                    if (final)
                    {
                        rep.Created.Add(mra.Id);
                        rep.Mras++;
                    }
                    return mra;
                }
                catch (Exception ex)
                {
                    if (st.HasStarted() && !st.HasEnded()) st.RollBack();
                    if (final) rep.Failures.Add("Хомутын MRA (арматур " + m.RebarId + "): " + ex.Message.Trim().TrimEnd('.') + ".");
                    return null;
                }
            }
        }

        private static void CreateLap(RfElevContext c, RfElevLapPlan l, DimensionType dimType, RfElevReport rep)
        {
            RfElevEndRefs a, b;
            if (!c.EndRefs.TryGetValue(l.BarA, out a) || !c.EndRefs.TryGetValue(l.BarB, out b))
            {
                rep.Failures.Add("Давхцлын хэмжээс (" + l.BarA + " ↔ " + l.BarB + "): төгсгөлийн лавлагаа олдсонгүй.");
                return;
            }
            using (var st = new SubTransaction(c.Doc))
            {
                st.Start();
                try
                {
                    var ra = new ReferenceArray();
                    ra.Append(b.Left);    // B-ийн зүүн үзүүр (давхцал эхлэх)
                    ra.Append(a.Right);   // A-ийн баруун үзүүр (давхцал төгсөх)
                    Line line = Line.CreateBound(c.Model(l.U0, l.LineV), c.Model(l.U1, l.LineV));
                    Dimension d = dimType != null ? c.Doc.Create.NewDimension(c.View, line, ra, dimType) : c.Doc.Create.NewDimension(c.View, line, ra);
                    if (d == null) throw new InvalidOperationException("NewDimension → null");
                    string typeWhy;
                    if (!global::RevitMcpAddin.AutoAnnotate.AaDimType.Enforce(d, dimType, out typeWhy))
                    {
                        st.RollBack();
                        rep.Failures.Add("Давхцлын хэмжээс (" + l.BarA + " ↔ " + l.BarB + "): " + typeWhy + " — тавигдсангүй.");
                        return;
                    }
                    c.Doc.Regenerate();
                    object raw = d.Value;
                    double actual = raw == null ? double.NaN : (double)raw;
                    if (!RfTol.IsFiniteNumber(actual) || Math.Abs(actual - l.Length) > RfTol.DimMatchFt)
                    {
                        st.RollBack();
                        rep.Failures.Add("Давхцлын хэмжээс (" + l.BarA + " ↔ " + l.BarB + "): Revit-ийн утга " + Mm(actual) + " мм, хүлээсэн " + Mm(l.Length) + " мм — тавигдсангүй.");
                        return;
                    }
                    st.Commit();
                    rep.Created.Add(d.Id);
                    rep.Laps++;
                }
                catch (Exception ex)
                {
                    if (st.HasStarted() && !st.HasEnded()) st.RollBack();
                    rep.Failures.Add("Давхцлын хэмжээс (" + l.BarA + " ↔ " + l.BarB + "): " + ex.Message.Trim().TrimEnd('.') + ".");
                }
            }
        }

        /// <summary>
        /// Давхцалтай эгнээний ҮРГЭЛЖИЛСЭН хэмжээс: арматур бүрийн хоёр төгсгөлийн хэрчмийн лавлагаа (<see cref="FindEndCaps"/>) → НЭГ Dimension.
        /// Revit-ийн сегмент бүрийн утгыг хүлээсэнтэй (0.5 мм) тулгаж, таарахгүй бол буцаана (буруу лавлагаатай хэмжээс үлдээхгүй).
        /// </summary>
        private static void CreateLapChain(RfElevContext c, RfElevLapChainPlan p, DimensionType dimType, RfElevReport rep)
        {
            string who = "Үргэлжилсэн хэмжээс (" + string.Join(", ", p.Bar.Distinct()) + ")";
            var ra = new ReferenceArray();
            for (int i = 0; i < p.U.Count; i++)
            {
                RfElevEndRefs er;
                if (!c.EndRefs.TryGetValue(p.Bar[i], out er))
                {
                    rep.Failures.Add(who + ": арматур " + p.Bar[i] + "-ийн төгсгөлийн лавлагаа олдсонгүй.");
                    return;
                }
                ra.Append(p.IsLeft[i] ? er.Left : er.Right);
            }
            using (var st = new SubTransaction(c.Doc))
            {
                st.Start();
                try
                {
                    Line line = Line.CreateBound(c.Model(p.U0, p.LineV), c.Model(p.U1, p.LineV));
                    Dimension d = dimType != null ? c.Doc.Create.NewDimension(c.View, line, ra, dimType) : c.Doc.Create.NewDimension(c.View, line, ra);
                    if (d == null) throw new InvalidOperationException("NewDimension → null");
                    string typeWhy;
                    if (!global::RevitMcpAddin.AutoAnnotate.AaDimType.Enforce(d, dimType, out typeWhy))
                    {
                        st.RollBack();
                        rep.Failures.Add(who + ": " + typeWhy + " — тавигдсангүй.");
                        return;
                    }
                    c.Doc.Regenerate();
                    string bad = VerifySegments(d, p.U);
                    if (bad != null)
                    {
                        st.RollBack();
                        rep.Failures.Add(who + ": " + bad + " — тавигдсангүй.");
                        return;
                    }
                    st.Commit();
                    rep.Created.Add(d.Id);
                    rep.LapChains++;
                }
                catch (Exception ex)
                {
                    if (st.HasStarted() && !st.HasEnded()) st.RollBack();
                    rep.Failures.Add(who + ": " + ex.Message.Trim().TrimEnd('.') + ".");
                }
            }
        }

        /// <summary>Олон сегменттэй хэмжээсийн сегмент бүрийн утга = дараалсан байрлалын зөрүү (0.5 мм).  null = зөв.</summary>
        internal static string VerifySegments(Dimension d, IList<double> pos)
        {
            int n = pos.Count;
            if (n == 2)
            {
                object raw = d.Value;
                double v = raw == null ? double.NaN : (double)raw;
                double want = pos[1] - pos[0];
                return RfTol.IsFiniteNumber(v) && Math.Abs(v - want) <= RfTol.DimMatchFt ? null : "Revit-ийн утга " + Mm(v) + " мм, хүлээсэн " + Mm(want) + " мм";
            }
            if (d.NumberOfSegments != n - 1) return "сегментийн тоо " + d.NumberOfSegments + ", хүлээсэн " + (n - 1);
            int k = 0;
            foreach (DimensionSegment seg in d.Segments)
            {
                object raw = seg.Value;
                double v = raw == null ? double.NaN : (double)raw;
                double want = pos[k + 1] - pos[k];
                if (!RfTol.IsFiniteNumber(v) || Math.Abs(v - want) > RfTol.DimMatchFt)
                    return (k + 1) + "-р сегмент " + Mm(v) + " мм, хүлээсэн " + Mm(want) + " мм";
                k++;
            }
            return null;
        }

        private static string Mm(double ft)
        {
            return RfTol.IsFiniteNumber(ft) ? (ft * RfTol.MmPerFoot).ToString("0.#", System.Globalization.CultureInfo.InvariantCulture) : "?";
        }

        private static void CreateSpan(RfElevContext c, RfElevSpanPlan s, DimensionType dimType, RfElevReport rep)
        {
            var refs = new List<Reference>();
            string kind = c.IsColumn ? "Түвшний" : "Тэнхлэгийн";
            foreach (double u in s.GridU)
            {
                Element g = null;
                double best = RfTol.MmToFt(2);
                foreach (KeyValuePair<double, Element> kv in c.Spans)
                {
                    double dd = Math.Abs(kv.Key - u);
                    if (dd <= best) { best = dd; g = kv.Value; }
                }
                if (g == null)
                {
                    rep.Failures.Add(kind + " хэмжээс: u = " + Mm(u) + " мм дээрх " + (c.IsColumn ? "түвшин" : "тэнхлэг") + " олдсонгүй.");
                    return;
                }
                refs.Add(new Reference(g));
            }
            using (var st = new SubTransaction(c.Doc))
            {
                st.Start();
                try
                {
                    var ra = new ReferenceArray();
                    foreach (Reference r in refs) ra.Append(r);
                    Line line = Line.CreateBound(c.Model(s.GridU[0], s.LineV), c.Model(s.GridU[s.GridU.Count - 1], s.LineV));
                    Dimension d = dimType != null ? c.Doc.Create.NewDimension(c.View, line, ra, dimType) : c.Doc.Create.NewDimension(c.View, line, ra);
                    if (d == null) throw new InvalidOperationException("NewDimension → null");
                    string typeWhy;
                    if (!global::RevitMcpAddin.AutoAnnotate.AaDimType.Enforce(d, dimType, out typeWhy))
                    {
                        st.RollBack();
                        rep.Failures.Add(kind + " хэмжээс: " + typeWhy + " — тавигдсангүй.");
                        return;
                    }
                    c.Doc.Regenerate();
                    int segs = d.NumberOfSegments > 1 ? d.NumberOfSegments : 1;
                    if (segs != s.GridU.Count - 1)
                    {
                        st.RollBack();
                        rep.Failures.Add(kind + " хэмжээс: сегментийн тоо " + segs + ", хүлээсэн " + (s.GridU.Count - 1) + " — тавигдсангүй.");
                        return;
                    }
                    st.Commit();
                    rep.Created.Add(d.Id);
                    rep.Spans++;
                    rep.SpanSegments += segs;
                }
                catch (Exception ex)
                {
                    if (st.HasStarted() && !st.HasEnded()) st.RollBack();
                    rep.Failures.Add(kind + " хэмжээс: " + ex.Message.Trim().TrimEnd('.') + ".");
                }
            }
        }
    }
}
