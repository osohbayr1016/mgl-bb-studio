using System;
using System.Collections.Generic;
using System.Linq;
using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Structure;
using RevitMcpAddin.Reinforcement.Core;

namespace RevitMcpAddin.Reinforcement
{
    internal enum RfHostKind
    {
        Auto = 0,
        Beam = 1,
        Column = 2,
    }

    /// <summary>Analyzer-ийн үр дүн: Core-ийн цэвэр оролт + Revit объектын холбоос (Reference, Rebar).</summary>
    internal sealed class RfSectionContext
    {
        public Document Doc;
        public View View;
        public Element Host;

        /// <summary>Тавих (annotation) хавтгай: view.Origin дээр.</summary>
        public RfViewFrame AnnotFrame;

        /// <summary>Огтлолын БОДИТ хавтгай (план дээр View Range-ийн Cut Plane) — гүн, огтлох цэг үүгээр.</summary>
        public RfViewFrame CutFrame;

        public RfSectionInput Input = new RfSectionInput();
        public readonly Dictionary<int, Reference> FaceRefs = new Dictionary<int, Reference>();

        /// <summary>Гадна гинжийн лавлагаа (<see cref="RfAuxSample.Id"/> → тэнхлэг / хучилт, ханын нүүр).</summary>
        public readonly Dictionary<int, Reference> AuxRefs = new Dictionary<int, Reference>();
        public readonly Dictionary<long, Rebar> Rebars = new Dictionary<long, Rebar>();

        public int HostRebars, VisibleRebars, SkippedOther, StirrupsTooFar, HiddenBars, FacesRejected;

        /// <summary>RebarStyle (Standard / Stirrup-Tie) ба геометр зөрсөн (алгассан) арматур — таамаглаагүй.</summary>
        public int StyleMismatch;

        /// <summary>Ангилалд RebarStyle ашиглагдсан / style мэдэгдэхгүй тул геометрээр нөөцөлсөн арматурын тоо (оношилгоо).</summary>
        public int ClassifiedByStyle, ClassifiedByGeometry;
        public bool NoHostData;
    }

    /// <summary>
    /// ANALYZE шат: сонгосон гишүүн (дам нуруу/багана) ба түүний арматураас Core-ийн <see cref="RfSectionInput"/>-ыг
    /// гаргана.  ⚠️ Revit-д ЮУ Ч БИЧИХГҮЙ (зөвхөн уншина).
    ///
    /// Гүйцэтгэл: зөвхөн ЭНЭ гишүүний арматур (`RebarHostData.GetRebarsInHost`), харагдацад харагдаж буй нь;
    /// загварын бүх арматурын геометрийг ХЭЗЭЭ Ч уншихгүй.  Хомутын олонлогоос огтлолд хамгийн ойр НЭГ ширхгийг л авна.
    /// </summary>
    internal static class RfSectionAnalyzer
    {
        /// <summary>Хомут огтлолын хавтгайгаас үүнээс хол (фут) бол «огтлолд хамаагүй» гэж үзнэ (≈ 1 м).</summary>
        public const double MaxStirrupDepthFt = 3.2808;

        /// <summary>Нэг гишүүнд тавих ажлын арматурын ширхгийн дээд хязгаар (санамсаргүй асар олон ширхэгээс хамгаална).</summary>
        public const int MaxLongBars = 1500;

        /// <summary>Огтлолын нормальтай «перпендикуляр» нүүр гэж үзэх |n·N| дээд хэмжээ (≈ 5.7°).</summary>
        public const double InPlaneMaxDot = 0.1;

        public static RfHostKind KindOf(Element e)
        {
            try
            {
                long cat = e.Category == null ? 0 : e.Category.Id.Value;
                if (cat == (long)BuiltInCategory.OST_StructuralColumns) return RfHostKind.Column;
                if (cat == (long)BuiltInCategory.OST_StructuralFraming) return RfHostKind.Beam;
            }
            catch
            {
                // Ангилал уншигдахгүй.
            }
            return RfHostKind.Auto;
        }

        public static bool IsValidHost(Element e)
        {
            try { return e != null && RebarHostData.IsValidHost(e); }
            catch { return false; }
        }

        /// <summary>
        /// Эзэн болох элемент: Structural Framing / Structural Column БА арматур агуулах боломжтой (<see cref="RfHostPick.Accepts"/>).
        /// Урьдчилан сонгосон ба сонгуулах (<c>ISelectionFilter</c>) хоёр замд ЯГ ИЖИЛ шалгалт.
        /// </summary>
        public static bool IsAcceptableHost(Element e)
        {
            return e != null && RfHostPick.Accepts(KindOf(e) != RfHostKind.Auto, IsValidHost(e));
        }

        /// <summary>
        /// Элементийн ХҮНД ойлгомжтой тодорхойлолт: Mark · Family : Type [Ангилал].  Түүхий ElementId-г үндсэн шошго болгохгүй (дуудагч хоёрдогч болгон нэмнэ).
        /// </summary>
        public static string Describe(Document doc, Element e)
        {
            string mark = string.Empty, fam = string.Empty, type = string.Empty, cat = string.Empty;
            try { mark = RfParam.Text(e.get_Parameter(BuiltInParameter.ALL_MODEL_MARK)); }
            catch { mark = string.Empty; }
            try
            {
                ElementType et = doc.GetElement(e.GetTypeId()) as ElementType;
                if (et != null)
                {
                    fam = et.FamilyName;
                    type = et.Name;
                }
                else
                {
                    type = e.Name;
                }
            }
            catch
            {
                type = string.Empty;
            }
            try { cat = e.Category == null ? string.Empty : e.Category.Name; }
            catch { cat = string.Empty; }
            return RfHostPick.Describe(mark, fam, type, cat);
        }

        /// <summary>
        /// Annotation хавтгай ба огтлолын хавтгай (план дээр хоёр өөр).
        /// ⚠️ Огтлолын түвшин: `Level.ProjectElevation` (дотоод координаттай ижил; `Level.Elevation` нь «Elevation Base» =
        /// Shared үед хуваалцсан эхлэлээс хамаарч ЗӨРНӨ).  `AutoAnnotate/AaScan.ReadPlan`-ийн бодит Revit дээр шалгагдсан
        /// логик: View Range-ийн Cut Plane-ийн түвшин, байхгүй бол харагдацын түвшин (Associated Level).
        /// </summary>
        public static void Frames(View view, out RfViewFrame annot, out RfViewFrame cut)
        {
            annot = RfView.Frame(view);
            cut = annot;
            ViewPlan plan = view as ViewPlan;
            if (plan == null) return;
            try
            {
                Level gen = plan.GenLevel;
                double z = gen != null ? gen.ProjectElevation : annot.Origin.Z;
                PlanViewRange pvr = plan.GetViewRange();
                ElementId lid = pvr.GetLevelId(PlanViewPlane.CutPlane);
                Level cl = view.Document.GetElement(lid) as Level;
                // «Холбоотой түвшин» (Associated Level) нь тусгай token тул GetElement null буцаана — харагдацын түвшин.
                if (cl != null) z = cl.ProjectElevation;
                z += pvr.GetOffset(PlanViewPlane.CutPlane);
                RfV3 o = annot.Origin;
                double nz = Math.Abs(annot.Normal.Z) < 1e-9 ? 1 : annot.Normal.Z;
                double k = (z - o.Z) / nz;
                cut = new RfViewFrame(o + annot.Normal * k, annot.Right, annot.Up, annot.Normal);
            }
            catch
            {
                cut = annot;
            }
        }

        public static RfSectionContext Analyze(Document doc, View view, Element host, RfSectionOptions options)
        {
            var c = new RfSectionContext { Doc = doc, View = view, Host = host };
            RfViewFrame annot, cut;
            Frames(view, out annot, out cut);
            c.AnnotFrame = annot;
            c.CutFrame = cut;
            c.Input.View = cut;
            c.Input.Options = options;

            CollectFaces(c);
            CollectRebars(c, options.DoDimensions || options.TagStirrups, options.TagLongitudinal);
            CollectAux(c);
            return c;
        }

        // ── Гадна гинж: тэнхлэг, шүргэлцсэн хучилт/хана ────────────────────

        /// <summary>Гишүүнд «шүргэлцсэн» гэж үзэх хүлцэл (bbox, загварын фут ≈ 20 мм).</summary>
        private const double TouchFt = 20 / 304.8;

        /// <summary>
        /// Гишүүний гадна гинжийн лавлагаа (Revit-д юу ч бичихгүй): (1) огтлолд харагдаж буй тэнхлэг (харагдацын хавтгайг огтолсон шугам),
        /// (2) гишүүнд шүргэлцсэн (bbox 20 мм), огтлолын хавтгайг хөвсөн ХУЧИЛТ (шал) — хэвтээ дээд/доод нүүр; ХАНА (хөшиг биш) — ханын шугамд перпендикуляр
        /// босоо хажуу нүүр.  Нүүр бүр огтлолын хавтгайд перпендикуляр (харагдацад шугам болж харагдах) байх ёстой.  Холбосон файл (link) ОРОХГҮЙ.
        /// Аль нь гинжид орохыг planner (<see cref="RfMemberDims"/>) шийднэ.
        /// </summary>
        private static void CollectAux(RfSectionContext c)
        {
            int nextId = 1;
            RfViewFrame cut = c.CutFrame;
            try
            {
                foreach (Grid g in new FilteredElementCollector(c.Doc, c.View.Id).OfClass(typeof(Grid)).Cast<Grid>())
                {
                    Line ln = g.Curve as Line;
                    if (ln == null) continue;
                    RfV3 d = RfConv.V(ln.Direction).Normalized();
                    // Тэнхлэгийн хавтгай = босоо, шугамыг агуулсан; нормаль G = d × Z.
                    RfV3 gn = new RfV3(d.Y, -d.X, 0);
                    if (gn.Length < 0.5) continue;
                    gn = gn.Normalized();
                    RfV2 g2 = cut.ToViewVec(gn);
                    double len = g2.Length;
                    if (len < 0.5) continue; // тэнхлэгийн хавтгай харагдацын хавтгайтай бараг параллель — огтлолд шугам үүсэхгүй
                    RfV2 n2 = new RfV2(g2.X / len, g2.Y / len);
                    double k = (RfConv.V(ln.GetEndPoint(0)) - cut.Origin).Dot(gn) / len;
                    int id = nextId++;
                    c.Input.Aux.Add(new RfAuxSample { Id = id, Kind = RfAuxKind.Grid, Origin = new RfV2(n2.X * k, n2.Y * k), Normal = n2 });
                    c.AuxRefs[id] = new Reference(g);
                }
            }
            catch
            {
                // Тэнхлэг уншигдахгүй — гадна гинж тэнхлэггүй.
            }

            BoundingBoxXYZ hb;
            try { hb = c.Host.get_BoundingBox(null); }
            catch { hb = null; }
            if (hb == null) return;
            var touch = new XYZ(TouchFt, TouchFt, TouchFt);
            ElementFilter near;
            try { near = new BoundingBoxIntersectsFilter(new Outline(hb.Min - touch, hb.Max + touch)); }
            catch { return; }

            foreach (BuiltInCategory cat in new[] { BuiltInCategory.OST_Floors, BuiltInCategory.OST_Walls })
            {
                bool wall = cat == BuiltInCategory.OST_Walls;
                List<Element> els;
                try
                {
                    els = new FilteredElementCollector(c.Doc, c.View.Id).OfCategory(cat).WhereElementIsNotElementType().WherePasses(near).ToList();
                }
                catch
                {
                    continue;
                }
                foreach (Element e in els.Take(40))
                {
                    if (e.Id == c.Host.Id) continue;
                    RfV3 wallDir = new RfV3(0, 0, 0);
                    if (wall)
                    {
                        Wall w = e as Wall;
                        Line wl = w == null ? null : (w.Location as LocationCurve)?.Curve as Line;
                        if (w == null || wl == null) continue;
                        try { if (w.WallType != null && w.WallType.Kind == WallKind.Curtain) continue; }
                        catch { continue; }
                        wallDir = RfConv.V(wl.Direction).Normalized();
                    }
                    try
                    {
                        GeometryElement ge = e.get_Geometry(new Options { ComputeReferences = true, DetailLevel = ViewDetailLevel.Fine });
                        if (ge != null) WalkAux(c, ge, Transform.Identity, wall ? RfAuxKind.Wall : RfAuxKind.Slab, wallDir, ref nextId);
                    }
                    catch
                    {
                        // Энэ элементийн геометр уншигдахгүй — алгасна.
                    }
                }
            }
        }

        private static void WalkAux(RfSectionContext c, GeometryElement ge, Transform t, RfAuxKind kind, RfV3 wallDir, ref int nextId)
        {
            RfV3 n = c.CutFrame.Normal;
            foreach (GeometryObject go in ge)
            {
                Solid s = go as Solid;
                if (s != null && s.Volume > 1e-9)
                {
                    foreach (Face f in s.Faces)
                    {
                        PlanarFace pf = f as PlanarFace;
                        if (pf == null || pf.Reference == null) continue;
                        RfV3 normal = RfConv.V(t.OfVector(pf.FaceNormal)).Normalized();
                        if (Math.Abs(normal.Dot(n)) > InPlaneMaxDot) continue;
                        if (kind == RfAuxKind.Slab && Math.Abs(normal.Z) < 0.999) continue;
                        if (kind == RfAuxKind.Wall && (Math.Abs(normal.Z) > 0.001 || Math.Abs(normal.Dot(wallDir)) > RfTol.PerpendicularCos)) continue;
                        double dMin, dMax;
                        FaceDepthRange(pf, t, c.CutFrame, out dMin, out dMax);
                        double tol = RfTol.MmToFt(1);
                        if (!(dMin <= tol && dMax >= -tol)) continue; // огтлолын хавтгайг хөвөөгүй нүүр
                        int id = nextId++;
                        c.Input.Aux.Add(new RfAuxSample
                        {
                            Id = id,
                            Kind = kind,
                            Origin = c.CutFrame.ToView(RfConv.V(t.OfPoint(pf.Origin))),
                            Normal = c.CutFrame.ToViewVec(normal).Normalized(),
                        });
                        c.AuxRefs[id] = pf.Reference;
                    }
                    continue;
                }
                GeometryInstance gi = go as GeometryInstance;
                if (gi != null)
                {
                    GeometryElement sym = gi.GetSymbolGeometry();
                    if (sym != null) WalkAux(c, sym, t.Multiply(gi.Transform), kind, wallDir, ref nextId);
                }
            }
        }

        // ── Бетон нүүр ─────────────────────────────────────────────────

        private static void CollectFaces(RfSectionContext c)
        {
            int nextId = 1;
            try
            {
                var opt = new Options { ComputeReferences = true, DetailLevel = ViewDetailLevel.Fine, IncludeNonVisibleObjects = false };
                GeometryElement ge = c.Host.get_Geometry(opt);
                if (ge == null) return;
                Walk(c, ge, Transform.Identity, ref nextId);
            }
            catch
            {
                // Геометр уншигдахгүй — нүүргүй (planner NoFaces анхааруулна).
            }
        }

        private static void Walk(RfSectionContext c, GeometryElement ge, Transform t, ref int nextId)
        {
            RfV3 n = c.CutFrame.Normal;
            foreach (GeometryObject go in ge)
            {
                Solid s = go as Solid;
                if (s != null && s.Volume > 1e-9)
                {
                    foreach (Face f in s.Faces)
                    {
                        PlanarFace pf = f as PlanarFace;
                        if (pf == null || pf.Reference == null) continue;
                        RfV3 normal = RfConv.V(t.OfVector(pf.FaceNormal)).Normalized();
                        if (Math.Abs(normal.Dot(n)) > InPlaneMaxDot)
                        {
                            // Огтлолын хавтгайд перпендикуляр биш нүүр (төгсгөлийн нүүр г.м.) — хэмжээс тавигдахгүй.
                            c.FacesRejected++;
                            continue;
                        }
                        RfV2 n2 = c.CutFrame.ToViewVec(normal).Normalized();
                        RfV2 o2 = c.CutFrame.ToView(RfConv.V(t.OfPoint(pf.Origin)));
                        int id = nextId++;
                        double dMin, dMax;
                        FaceDepthRange(pf, t, c.CutFrame, out dMin, out dMax);
                        c.Input.Faces.Add(new RfFaceSample { Id = id, Origin = o2, Normal = n2, Area = pf.Area, DepthMin = dMin, DepthMax = dMax });
                        c.FaceRefs[id] = pf.Reference;
                    }
                    continue;
                }
                GeometryInstance gi = go as GeometryInstance;
                if (gi != null)
                {
                    GeometryElement sym = gi.GetSymbolGeometry();
                    if (sym != null) Walk(c, sym, t.Multiply(gi.Transform), ref nextId);
                }
            }
        }

        /// <summary>
        /// Нүүрний хилийн (edge loop) цэгүүдийн огтлолын хавтгайгаас зайн хамгийн бага/их.  Уншигдахгүй бол хязгааргүй (= огтлолыг хөвж байна гэж үзнэ —
        /// өмнөх зан төлөв).
        /// </summary>
        private static void FaceDepthRange(PlanarFace pf, Transform t, RfViewFrame cut, out double dMin, out double dMax)
        {
            dMin = double.NegativeInfinity;
            dMax = double.PositiveInfinity;
            try
            {
                double lo = double.MaxValue, hi = double.MinValue;
                foreach (CurveLoop loop in pf.GetEdgesAsCurveLoops())
                {
                    foreach (Curve cv in loop)
                    {
                        foreach (XYZ p in cv.Tessellate())
                        {
                            double d = cut.DepthOf(RfConv.V(t.OfPoint(p)));
                            if (d < lo) lo = d;
                            if (d > hi) hi = d;
                        }
                    }
                }
                if (lo <= hi)
                {
                    dMin = lo;
                    dMax = hi;
                }
            }
            catch
            {
                // Хилийн цэг уншигдахгүй — хязгааргүй хэвээр.
            }
        }

        // ── Арматур ────────────────────────────────────────────────────

        private static void CollectRebars(RfSectionContext c, bool needStirrups, bool needLong)
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
            if (inHost == null)
            {
                c.NoHostData = true;
                return;
            }
            c.HostRebars = inHost.Count;

            var visible = new HashSet<long>();
            foreach (ElementId id in new FilteredElementCollector(c.Doc, c.View.Id).OfClass(typeof(Rebar)).ToElementIds())
                visible.Add(id.Value);

            RfV3 normal = c.CutFrame.Normal;
            int longCount = 0;
            var styleCache = new Dictionary<long, RfRebarStyle>();
            foreach (Rebar r in inHost)
            {
                if (r == null || !visible.Contains(r.Id.Value)) continue;
                c.VisibleRebars++;

                List<int> existing = ExistingBars(r);
                if (existing.Count == 0) continue;

                List<RfV3> probe = PointsAt(r, existing[0]);
                RfBarClass geom = probe == null ? RfBarClass.Other : RfSectionGeometry.Classify(probe, normal);

                // Ангилал: Revit-ийн RebarStyle (Standard / Stirrup-Tie) ЭХЭЛЖ — shape-ийн НЭРээр БИШ; геометр нь баталгаажуулна.
                // Style мэдэгдэхгүй (shape/free-form accessor уншигдаагүй) үед геометрээр нөөцөлнө.  Зөрвөл таамаглахгүй, алгасна.
                RfRebarStyle style = StyleOf(r, styleCache);
                RfClassBasis basis;
                RfBarClass cls = RfSectionGeometry.Resolve(style, geom, out basis);
                if (basis == RfClassBasis.Mismatch) c.StyleMismatch++;
                else if (basis == RfClassBasis.Style || basis == RfClassBasis.StandardLoop) c.ClassifiedByStyle++;
                else c.ClassifiedByGeometry++;
                double dia = Diameter(c.Doc, r);
                string group = GroupKey(c.Doc, r, dia);

                if (cls == RfBarClass.Transverse && needStirrups)
                {
                    int idx;
                    List<RfV3> pts = NearestBar(r, existing, c.CutFrame, out idx);
                    if (pts == null) continue;
                    if (Math.Abs(c.CutFrame.DepthOf(pts[0])) > MaxStirrupDepthFt)
                    {
                        c.StirrupsTooFar++;
                        continue;
                    }
                    // Standard style-тай гогцоо (бөгж) = ЗӨВХӨН tag; хэмжээс зөвхөн Stirrup/Tie style-тай хомутод.
                    var s = new RfBarSample { Id = r.Id.Value, BarIndex = idx, Diameter = dia, TagOnly = basis == RfClassBasis.StandardLoop };
                    s.Points.AddRange(pts);
                    c.Input.Stirrups.Add(s);
                    c.Rebars[r.Id.Value] = r;
                }
                else if (cls == RfBarClass.Longitudinal && needLong)
                {
                    foreach (int idx in existing)
                    {
                        if (longCount >= MaxLongBars) break;
                        bool hidden = false;
                        try { hidden = r.IsBarHidden(c.View, idx); } catch { }
                        if (hidden)
                        {
                            c.HiddenBars++;
                            continue;
                        }
                        List<RfV3> pts = idx == existing[0] ? probe : PointsAt(r, idx);
                        RfV2 pos;
                        if (pts == null || !RfSectionGeometry.TryCutPoint(pts, c.CutFrame, out pos)) continue;
                        c.Input.Longitudinal.Add(new RfLongBar { Id = r.Id.Value, BarIndex = idx, Pos = pos, Diameter = dia, Group = group });
                        c.Rebars[r.Id.Value] = r;
                        longCount++;
                    }
                }
                else if (cls == RfBarClass.Other && basis != RfClassBasis.Mismatch)
                {
                    c.SkippedOther++;
                }
            }
        }

        /// <summary>
        /// Арматурын <c>RebarStyle</c>: shape-driven бол <c>RebarShape.RebarStyle</c>, free-form бол <c>GetFreeFormAccessor().RebarStyle</c>.
        /// Уншигдахгүй бол Unknown (дуудагч геометрээр нөөцөлнө).  Shape тус бүрд нэг л удаа (кэш).
        /// </summary>
        internal static RfRebarStyle StyleOf(Rebar r, Dictionary<long, RfRebarStyle> cache)
        {
            try
            {
                if (r.IsRebarFreeForm())
                {
                    RebarFreeFormAccessor fa = r.GetFreeFormAccessor();
                    return fa == null ? RfRebarStyle.Unknown : Map(fa.RebarStyle);
                }
                ElementId sid = r.GetShapeId();
                if (sid == null || sid == ElementId.InvalidElementId) return RfRebarStyle.Unknown;
                RfRebarStyle cached;
                if (cache.TryGetValue(sid.Value, out cached)) return cached;
                RebarShape shape = r.Document.GetElement(sid) as RebarShape;
                RfRebarStyle st = shape == null ? RfRebarStyle.Unknown : Map(shape.RebarStyle);
                cache[sid.Value] = st;
                return st;
            }
            catch
            {
                return RfRebarStyle.Unknown;
            }
        }

        private static RfRebarStyle Map(RebarStyle s)
        {
            switch (s)
            {
                case RebarStyle.Standard: return RfRebarStyle.Standard;
                case RebarStyle.StirrupTie: return RfRebarStyle.StirrupTie;
                default: return RfRebarStyle.Unknown;
            }
        }

        /// <summary>
        /// Tag-ийн бүлэглэлтийн түлхүүр: арматурын төрөл | голч | shape | <b>Rebar Number</b>.
        ///
        /// ⚠️ Revit-ийн арматурын tag нь ЗӨВХӨН tag-лагдсан ЭЛЕМЕНТИЙН өөрийн мэдээллийг (Quantity, Mark, Number) уншдаг — өөр элементийн
        /// ширхгийг нэг tag-д нэгтгэвэл тоо дутуу харагдана.  Тиймээс элемент хоорондын нэгтгэл ЗӨВХӨН Revit өөрөө ИЖИЛ дугаар
        /// (Rebar Number) өгсөн арматурт (ижил дугаартай арматурын tag ижил бичвэр гаргана); дугааргүй (хоосон) бол хоосон түлхүүр
        /// буцаана ⇒ элемент бүр өөрийн tag-тай (нэгтгэхгүй).  Уншигдахгүй бол ч хоосон.
        /// </summary>
        internal static string GroupKey(Document doc, Rebar r, double diameterFt)
        {
            try
            {
                string number = RfParam.Text(r.get_Parameter(BuiltInParameter.REBAR_NUMBER));
                if (string.IsNullOrWhiteSpace(number)) return string.Empty;

                // ⚠️ Rebar Number нь ЗӨВХӨН ӨӨРИЙН Partition дотор давтагдахгүй (NumberingSchema: «number that does not exist in the same
                // partition») — «ДН-1» №1 ба «ДН-2» №1 нь ӨӨР арматур.  Тиймээс Partition түлхүүрт ЗААВАЛ орно (NUMBER_PARTITION_PARAM; ELEM_PARTITION_PARAM нь Workset тул БИШ).  Partition хоосон нь ХУУЧИН «хоосон Partition» — зөв (Partition ашигладаггүй төсөлд ижил
                // дугаар = ижил арматур); харин Partition ӨӨР бол ижил дугаар ч ӨӨР арматур тул нэгтгэхгүй.
                string partition = RfParam.Text(r.get_Parameter(BuiltInParameter.NUMBER_PARTITION_PARAM));
                if (partition == null) partition = string.Empty;

                ElementId tid = r.GetTypeId();
                ElementId sid = null;
                try { sid = r.GetShapeId(); }
                catch { sid = null; }
                long shape = sid == null ? -1 : sid.Value;
                return RfSectionGeometry.NumberedGroupKey(RfSectionGeometry.BarGroupKey(tid.Value, diameterFt, shape), number, partition);
            }
            catch
            {
                return string.Empty;
            }
        }

        internal static List<int> ExistingBars(Rebar r)
        {
            var list = new List<int>();
            int n = 1;
            try { n = Math.Max(1, r.NumberOfBarPositions); }
            catch { n = 1; }
            for (int i = 0; i < n; i++)
            {
                try
                {
                    if (r.DoesBarExistAtPosition(i)) list.Add(i);
                }
                catch
                {
                    // Энэ индекс байхгүй.
                }
            }
            return list;
        }

        /// <summary>
        /// Ширхгийн голын шугамын цэгүүд (tessellated).  Дэгээ (hook)-г ХАСНА: дэгээ нь зарим хомутын хавтгайгаас
        /// гадна гарч planarity-г эвдэж, ангилал/хүрээг буруу болгодог.
        /// </summary>
        internal static List<RfV3> PointsAt(Rebar r, int idx)
        {
            try
            {
                IList<Curve> curves = r.GetTransformedCenterlineCurves(false, true, false, MultiplanarOption.IncludeOnlyPlanarCurves, idx);
                if (curves == null || curves.Count == 0) return null;
                var pts = new List<RfV3>();
                foreach (Curve cv in curves)
                {
                    IList<XYZ> tess = cv.Tessellate();
                    for (int i = 0; i < tess.Count; i++)
                    {
                        RfV3 p = RfConv.V(tess[i]);
                        if (pts.Count > 0 && pts[pts.Count - 1].DistanceTo(p) < 1e-9) continue;
                        pts.Add(p);
                    }
                }
                return pts.Count < 2 ? null : pts;
            }
            catch
            {
                return null;
            }
        }

        /// <summary>
        /// Хомутын олонлогоос огтлолын хавтгайд ХАМГИЙН ОЙР ширхэг.  ≤ 64 ширхэг бол бүгдийг шалгана; илүү бол
        /// эхний/сүүлийн ширхгийн гүнээс шугаман ойролцоолж, хөрш 2-ыг шалгана (хомут жигд зайтай).
        /// </summary>
        private static List<RfV3> NearestBar(Rebar r, IList<int> existing, RfViewFrame cut, out int bestIdx)
        {
            int bestLocal = existing[0];
            List<RfV3> bestPts = null;
            double bestDepth = double.MaxValue;

            Action<int> consider = idx =>
            {
                List<RfV3> p = PointsAt(r, idx);
                if (p == null) return;
                double d = Math.Abs(cut.DepthOf(p[0]));
                if (d < bestDepth)
                {
                    bestDepth = d;
                    bestLocal = idx;
                    bestPts = p;
                }
            };

            if (existing.Count <= 64)
            {
                foreach (int i in existing) consider(i);
                bestIdx = bestLocal;
                return bestPts;
            }

            List<RfV3> a = PointsAt(r, existing[0]);
            List<RfV3> b = PointsAt(r, existing[existing.Count - 1]);
            if (a == null || b == null)
            {
                bestIdx = existing[0];
                return a ?? b;
            }
            double d0 = cut.DepthOf(a[0]), d1 = cut.DepthOf(b[0]);
            double span = d1 - d0;
            int guess = Math.Abs(span) < 1e-9 ? 0 : (int)Math.Round((0 - d0) / span * (existing.Count - 1));
            guess = Math.Max(0, Math.Min(existing.Count - 1, guess));
            for (int k = guess - 2; k <= guess + 2; k++)
            {
                if (k >= 0 && k < existing.Count) consider(existing[k]);
            }
            consider(existing[0]);
            consider(existing[existing.Count - 1]);
            bestIdx = bestLocal;
            return bestPts;
        }

        internal static double Diameter(Document doc, Rebar r)
        {
            try
            {
                RebarBarType bt = doc.GetElement(r.GetTypeId()) as RebarBarType;
                if (bt != null)
                {
                    double d = bt.BarModelDiameter;
                    if (d > 1e-9) return d;
                    if (bt.BarNominalDiameter > 1e-9) return bt.BarNominalDiameter;
                }
            }
            catch
            {
                // Төрөл уншигдахгүй.
            }
            return 0;
        }
    }
}
