using System;
using System.Collections.Generic;
using System.Linq;
using Autodesk.Revit.DB;
using MglBb.Core;

namespace MglBb.RevitSide
{
    /// <summary>Нэг түвшний рамын байгуулалтад орох багана (түвшнийг дайрсан / доороос ирсэн) ба дамнуруу (дээд нүүр нь түвшинд).</summary>
    internal sealed class BbFrameLevel
    {
        public Level Level;
        public string LevelText = "";
        public readonly List<FamilyInstance> Columns = new List<FamilyInstance>();
        public readonly List<FamilyInstance> Beams = new List<FamilyInstance>();
        public double X0 = double.MaxValue, Y0 = double.MaxValue, X1 = double.MinValue, Y1 = double.MinValue;
    }

    /// <summary>
    /// РАМЫН БАЙГУУЛАЛТ — түвшин бүрийн төлөвлөгөө (ЖИШЭЭ-2 3-1 «БАГАНА, ДАМНУРУУНЫ БАЙГУУЛАЛТ /-5.02/», 1:100, «2.1. Рамын байгуулалт»).
    /// Хэмжсэн зохиомж: доор + баруун талд тэнхлэгийн гинж (+ нийт); багана бүрт «нүүр | тэнхлэг | нүүр» хоёр чиглэлд (хэвтээ нь баганын доор,
    /// босоо нь баруун талд; тэнхлэггүй бол «нүүр | төв | нүүр»); тэнхлэг дээрх дамнуруу бүрт «нүүр | тэнхлэг | нүүр»; тэнхлэг хоорондын зурвас
    /// бүрийг хөндлөн огтолсон дамнуурын нүүрний гинж; баганын марк (хөтлөгчтэй) ба дамнуурын марк (хөтлөгчгүй).  Огтлолуудыг инженер тавина.
    /// </summary>
    internal static class BbFramePlan
    {
        public const string Role = "frame";
        private const double Paper = 1 / 304.8;
        private static readonly double Below = BbGeom.Ft(1000), Above = BbGeom.Ft(1500);

        /// <summary>Багана эсвэл дамнуруутай түвшнүүд (өндрөөр).  Бүх загварын bbox-ийг нэг удаа уншина.</summary>
        public static List<BbFrameLevel> Levels(Document doc)
        {
            var cols = Boxes(doc, BuiltInCategory.OST_StructuralColumns);
            var beams = Boxes(doc, BuiltInCategory.OST_StructuralFraming).Where(b => b.Line).ToList();
            var res = new List<BbFrameLevel>();
            foreach (Level lv in new FilteredElementCollector(doc).OfClass(typeof(Level)).Cast<Level>().OrderBy(l => l.Elevation))
            {
                var fl = Collect(lv, cols, beams);
                if (fl.Beams.Count > 0) res.Add(fl);
            }
            return res;
        }

        public static BbFrameLevel Of(Document doc, Level lv)
        {
            return Collect(lv, Boxes(doc, BuiltInCategory.OST_StructuralColumns), Boxes(doc, BuiltInCategory.OST_StructuralFraming).Where(b => b.Line).ToList());
        }

        private sealed class Box
        {
            public FamilyInstance E;
            public double X0, Y0, Z0, X1, Y1, Z1;
            public bool Line;
        }

        private static List<Box> Boxes(Document doc, BuiltInCategory cat)
        {
            var res = new List<Box>();
            foreach (FamilyInstance fi in new FilteredElementCollector(doc).OfCategory(cat).OfClass(typeof(FamilyInstance)).Cast<FamilyInstance>())
            {
                BoundingBoxXYZ bb = fi.get_BoundingBox(null);
                if (bb == null) continue;
                XYZ a = bb.Min, b = bb.Max;
                bool line = fi.Location is LocationCurve lc && lc.Curve is Line l && Math.Abs(l.Direction.Z) < 0.02;
                res.Add(new Box { E = fi, X0 = a.X, Y0 = a.Y, Z0 = a.Z, X1 = b.X, Y1 = b.Y, Z1 = b.Z, Line = line });
            }
            return res;
        }

        private static BbFrameLevel Collect(Level lv, List<Box> cols, List<Box> beams)
        {
            var fl = new BbFrameLevel { Level = lv, LevelText = BbPlates.LevelText(lv) };
            double z = lv.Elevation;
            foreach (Box b in beams)
                if (b.Z1 >= z - Below && b.Z1 <= z + BbGeom.Ft(300)) { fl.Beams.Add(b.E); Grow(fl, b); }
            if (fl.Beams.Count == 0) return fl;
            foreach (Box c in cols)
                if (c.Z0 < z + Above && c.Z1 > z - Below) { fl.Columns.Add(c.E); Grow(fl, c); }
            return fl;
        }

        private static void Grow(BbFrameLevel fl, Box b)
        {
            fl.X0 = Math.Min(fl.X0, b.X0); fl.Y0 = Math.Min(fl.Y0, b.Y0); fl.X1 = Math.Max(fl.X1, b.X1); fl.Y1 = Math.Max(fl.Y1, b.Y1);
        }

        // ── Үүсгэх ──────────────────────────────────────────────────────

        /// <summary>Нээлттэй Transaction дотор.  Төлөвлөгөө нэг (<see cref="BbGenResult.Plans"/>), үүрэг <see cref="Role"/>.</summary>
        public static BbGenResult Create(Document doc, BbFrameLevel fl, BbStandard std, BbGenOptions opt, Dictionary<long, string> roles)
        {
            BbPlateStandard ps = std.Plate;
            string mark = fl.LevelText;
            var res = new BbGenResult { Mark = mark, Kind = BbMemberKind.Frame };
            if (fl.Level == null) { res.Issues.Add(Issue(mark, BbSeverity.Error, "Түвшин тодорхойгүй.", "Түвшнийг сонгох.", "frame-level")); return res; }
            if (fl.Beams.Count == 0) { res.Issues.Add(Issue(mark, BbSeverity.Warning, mark + " түвшинд дамнуруу алга — рамын байгуулалт үүсгэсэнгүй.", "Өөр түвшин сонгох.", "frame-empty")); return res; }
            string name = ps.FrameName.Replace("{level}", mark) + opt.NameSuffix;
            if (opt.Existing == "skip" && new FilteredElementCollector(doc).OfClass(typeof(View)).Cast<View>().Any(v => !v.IsTemplate && v.Name == name))
            {
                res.Notes.Add("«" + name + "» аль хэдийн байгаа — алгасав.");
                return res;
            }
            var plans = new FilteredElementCollector(doc).OfClass(typeof(ViewFamilyType)).Cast<ViewFamilyType>().Where(t => t.ViewFamily == ViewFamily.StructuralPlan).ToList();
            string pick = BbCompanyRules.PickFrameViewType(plans.Select(t => t.Name), ps.FrameViewType);
            ViewFamilyType vft = pick != null ? plans.First(t => t.Name == pick) : null;
            if (vft == null)
            {
                // Өөр төрлөөр (жишээ нь «1.1. Суурийн байгуулалт») үүсгэхгүй — инженер төрлөө оруулна.
                res.Issues.Add(Issue(mark, BbSeverity.Error, "«" + BbCompanyRules.FrameViewType + "» (Structural Plan) төрөл энэ төсөлд алга — рамын байгуулалт үүсгэсэнгүй.  Байгаа: "
                    + string.Join("; ", plans.Select(t => "«" + t.Name + "»")), "Компанийн template-ээс «Рамын байгуулалт» төрлийг оруулах.", "frame-vft"));
                return res;
            }
            ViewPlan v;
            try { v = ViewPlan.Create(doc, vft.Id, fl.Level.Id); }
            catch (Exception ex) { res.Notes.Add(mark + ": төлөвлөгөө үүсгэж чадсангүй (" + ex.Message + ")"); return res; }
            BbAnnoStore.MarkGenerated(v);
            try { v.Name = BbGeom.UniqueViewName(doc, name); } catch (Exception ex) { res.Notes.Add(mark + ": нэр тавигдсангүй (" + ex.Message + ")"); }
            View tpl = BbGeom.FindTemplate(doc, ps.FrameTemplate);
            if (tpl == null && !string.IsNullOrEmpty(ps.FrameTemplate))
                res.Issues.Add(Issue(mark, BbSeverity.Warning, "Харагдацын загвар «" + ps.FrameTemplate + "» алга — загваргүй үүсгэв.", "Компанийн template-ээс тэр view template-ийг оруулах.", "tpl|" + ps.FrameTemplate));
            if (tpl != null) { try { v.ViewTemplateId = tpl.Id; } catch (Exception ex) { res.Notes.Add(mark + ": загвар тавигдсангүй (" + ex.Message + ")"); } }
            try { if (v.Scale != ps.FrameScale) v.Scale = ps.FrameScale; } catch { }
            if (fl.X0 < fl.X1)
            {
                double m = BbGeom.Ft(ps.FrameCropMm);
                try
                {
                    BoundingBoxXYZ cb = v.CropBox;
                    cb.Min = new XYZ(fl.X0 - m, fl.Y0 - m, cb.Min.Z);
                    cb.Max = new XYZ(fl.X1 + m, fl.Y1 + m, cb.Max.Z);
                    v.CropBoxActive = true;
                    v.CropBox = cb;
                }
                catch (Exception ex) { res.Notes.Add(mark + ": crop тавигдсангүй (" + ex.Message + ")"); }
            }
            res.Plans.Add(v);
            roles[v.Id.Value] = Role;
            res.Notes.Add(mark + ": рамын байгуулалтын огтлолуудыг (ЖИШЭЭ-2 «ДАВХАР-B1 S1 …», 1:50) инженер сонгоно — автоматаар үүсгээгүй.");
            return res;
        }

        // ── Тэмдэглэх ───────────────────────────────────────────────────

        /// <summary>
        /// Нүүрний байрлал + лавлагааны stable representation.  Geometry-ийн Reference объект дараагийн хэмжээс үүсэхэд (regenerate) хуучирч
        /// «Invalid number of references» өгдөг (ЖИШЭЭ-2 -5.02: тэнхлэг дээрх 22 дамнуурын 15 нь, хэмжсэн) — хэрэглэх үедээ дахин задлана.
        /// </summary>
        private struct Fc
        {
            public double At;
            public string Rep;
            public Reference Ref(Document doc) { return Reference.ParseFromStableRepresentation(doc, Rep); }
        }

        private sealed class Beam
        {
            public FamilyInstance E;
            public bool AlongR;          // харагдацын R (хэвтээ) дагуу
            public double S0, S1;        // тэнхлэгийн дагуух муж (локал)
            public Fc W0, W1;            // хоёр хажуу нүүр (тэнхлэгт перпендикуляр координат)
            public XYZ P0, P1;           // тэнхлэгийн цэгүүд (загвар)
        }

        /// <summary>Нээлттэй Transaction-гүй үед.  Энэ хэрэгслийн өмнөх тэмдэглэгээг сольж, шинээр тавина.</summary>
        /// <param name="bubbles">Тэнхлэгийн толгойг гинжийн талд шилжүүлэх — тэнхлэгийн элементийг засна (workshared-д sync нэхнэ).</param>
        public static void Annotate(Document doc, View view, BbFrameLevel fl, BbPlateStandard ps, BbAnnoReport rep, string mark, bool bubbles = true)
        {
            if (!(view is ViewPlan vp) || vp.GenLevel == null) return;
            DimensionType dimType = DimType(doc, ps.FrameDimType, rep, mark);
            using (var t = new Transaction(doc, "MGL ББ: рамын байгуулалтын тэмдэглэгээ"))
            {
                t.Start();
                FailureHandlingOptions fho = t.GetFailureHandlingOptions();
                fho.SetFailuresPreprocessor(new BbSwallowWarnings());
                t.SetFailureHandlingOptions(fho);
                int removed = BbAnnoStore.DeletePrevious(doc, view);
                if (removed > 0) { doc.Regenerate(); rep.Replaced += removed; }
                HashSet<long> before = BbAnnoStore.Owned(doc, view);

                // Харагдацад үнэхээр харагдаж буй гишүүд (загвар/шүүлтүүрээр нуусныг тэмдэглэхгүй) — OwnerViewId-гүй нэг цуглуулга.
                var visible = new HashSet<long>(new FilteredElementCollector(doc, view.Id).WhereElementIsNotElementType()
                    .Where(e => e.Category != null && (e.Category.Id.Value == (long)BuiltInCategory.OST_StructuralColumns || e.Category.Id.Value == (long)BuiltInCategory.OST_StructuralFraming))
                    .Select(e => e.Id.Value));
                BbFrame f = BbFrame.Of(view);
                double sc = Math.Max(1, view.Scale);
                double levelZ = vp.GenLevel.Elevation;
                double cutZ = levelZ + BbGeom.Ft(300);
                try { PlanViewRange r = vp.GetViewRange(); cutZ = (doc.GetElement(r.GetLevelId(PlanViewPlane.CutPlane)) as Level ?? vp.GenLevel).Elevation + r.GetOffset(PlanViewPlane.CutPlane); } catch { }
                double vz = Math.Abs(f.V.Z) > 0.99 ? (levelZ - f.O.Z) * Math.Sign(f.V.Z) : 0;

                // Тэнхлэг: харагдацад босоо (R-ээр байрлалтай) ба хэвтээ (U-ээр).
                var gridsR = new List<KeyValuePair<double, Reference>>();
                var gridsU = new List<KeyValuePair<double, Reference>>();
                foreach (Grid g in new FilteredElementCollector(doc, view.Id).OfClass(typeof(Grid)).Cast<Grid>())
                {
                    if (!(g.Curve is Line gl)) continue;
                    XYZ p = f.Local(gl.GetEndPoint(0)), q = f.Local(gl.GetEndPoint(1));
                    if (Math.Abs(gl.Direction.DotProduct(f.R)) < 0.02) { gridsR.Add(new KeyValuePair<double, Reference>(p.X, new Reference(g))); if (bubbles) Bubble(g, view, p.Y < q.Y); }
                    else if (Math.Abs(gl.Direction.DotProduct(f.U)) < 0.02) { gridsU.Add(new KeyValuePair<double, Reference>(p.Y, new Reference(g))); if (bubbles) Bubble(g, view, p.X > q.X); }
                }
                gridsR = gridsR.OrderBy(x => x.Key).ToList();
                gridsU = gridsU.OrderBy(x => x.Key).ToList();

                List<FamilyInstance> cols = PickColumns(fl.Columns.Where(c => visible.Contains(c.Id.Value)).ToList(), f, cutZ, levelZ);
                List<Beam> beams = fl.Beams.Where(b => visible.Contains(b.Id.Value)).Select(b => MakeBeam(b, view, f)).Where(b => b != null).ToList();
                var hosts = cols.Cast<Element>().Concat(beams.Select(b => (Element)b.E)).ToList();
                int dims = 0, tags = 0, colDims = 0, beamDims = 0, bayDims = 0, onGrid = 0;

                dims += BbGridDims.FramePlan(doc, view, hosts, dimType, rep.Notes, ps.FrameGridChainPaperMm, ps.FrameGridTotalPaperMm);

                // Багана: «нүүр | тэнхлэг | нүүр» — хэвтээ шугам баганын доор, босоо шугам баруун талд.
                double colOff = ps.FrameColumnDimPaperMm * Paper * sc;
                foreach (FamilyInstance c in cols)
                {
                    List<Fc> fr = Faces(c, view, f, true), fu = Faces(c, view, f, false);
                    if (fr.Count >= 2)
                    {
                        double a = fr.Min(x => x.At), b = fr.Max(x => x.At);
                        var refs = Binding(doc, fr, gridsR, a, b, Center(c, f, true));
                        double u0 = fu.Count >= 2 ? fu.Min(x => x.At) : f.Local((c.Location as LocationPoint)?.Point ?? XYZ.Zero).Y;
                        if (refs != null) colDims += BbGridDims.Chain(doc, view, f, refs, true, u0 - colOff, dimType, rep.Notes, vz);
                    }
                    if (fu.Count >= 2)
                    {
                        double a = fu.Min(x => x.At), b = fu.Max(x => x.At);
                        var refs = Binding(doc, fu, gridsU, a, b, Center(c, f, false));
                        double r1 = fr.Count >= 2 ? fr.Max(x => x.At) : f.Local((c.Location as LocationPoint)?.Point ?? XYZ.Zero).X;
                        if (refs != null) colDims += BbGridDims.Chain(doc, view, f, refs, false, r1 + colOff, dimType, rep.Notes, vz);
                    }
                }

                // Тэнхлэг дээрх дамнуруу: «нүүр | тэнхлэг | нүүр» уртын FrameBeamDimAt-д.
                foreach (Beam b in beams)
                {
                    var grids = b.AlongR ? gridsU : gridsR;
                    double eps = BbGeom.Ft(5);
                    KeyValuePair<double, Reference>? g = null;
                    foreach (var x in grids) if (x.Key >= b.W0.At - eps && x.Key <= b.W1.At + eps) { g = x; break; }
                    if (g == null) continue;
                    onGrid++;
                    var refs = Distinct(new List<KeyValuePair<double, Reference>>
                    {
                        new KeyValuePair<double, Reference>(b.W0.At, b.W0.Ref(doc)), g.Value, new KeyValuePair<double, Reference>(b.W1.At, b.W1.Ref(doc)),
                    });
                    if (refs.Count < 2) continue;
                    double at = b.S0 + (b.S1 - b.S0) * ps.FrameBeamDimAt;
                    beamDims += BbGridDims.Chain(doc, view, f, refs, !b.AlongR, at, dimType, rep.Notes, vz);
                }

                // Тэнхлэг хоорондын зурвас бүрийг хөндлөн огтолсон дамнуурын нүүрний гинж (ЖИШЭЭ-2: 600|2550|300|2600 …).
                if (ps.FrameBayChains)
                {
                    bayDims += BayChains(doc, view, f, gridsU, beams.Where(b => !b.AlongR).ToList(), true, ps.FrameBayChainAt, dimType, rep.Notes, vz);
                    bayDims += BayChains(doc, view, f, gridsR, beams.Where(b => b.AlongR).ToList(), false, ps.FrameBayChainAt, dimType, rep.Notes, vz);
                }
                dims += colDims + beamDims + bayDims;
                rep.Notes.Insert(0, mark + " рам: багана " + cols.Count + " (хэмжээс " + colDims + "), дамнуруу " + beams.Count + " (тэнхлэг дээр " + onGrid + ", хэмжээс " + beamDims + "), зурвасын гинж " + bayDims + ", тэнхлэг " + gridsR.Count + "×" + gridsU.Count);

                // Марк.
                ElementId colTag = TagType(doc, BuiltInCategory.OST_StructuralColumnTags, ps.FrameColumnTagType, rep, mark);
                ElementId beamTag = TagType(doc, BuiltInCategory.OST_StructuralFramingTags, ps.FrameBeamTagType, rep, mark);
                foreach (FamilyInstance c in cols)
                {
                    if (BbGeom.Mark(c).Length == 0 || !(c.Location is LocationPoint lp)) continue;
                    XYZ head = new XYZ(lp.Point.X, lp.Point.Y, levelZ) + f.R * (ps.FrameColumnTagDxPaperMm * Paper * sc) + f.U * (ps.FrameColumnTagDyPaperMm * Paper * sc);
                    tags += Tag(doc, view, colTag, c, true, head, rep, mark);
                }
                foreach (Beam b in beams)
                {
                    string bm = BbGeom.Mark(b.E);
                    if (bm.Length == 0 || bm.IndexOf("Хэрэггүй", StringComparison.OrdinalIgnoreCase) >= 0) continue;
                    XYZ p = b.P0 + (b.P1 - b.P0) * ps.FrameBeamTagAt;
                    XYZ side = b.AlongR ? f.U : f.R.Negate();
                    XYZ head = new XYZ(p.X, p.Y, levelZ) + side * (ps.FrameBeamTagOffPaperMm * Paper * sc);
                    tags += Tag(doc, view, beamTag, b.E, false, head, rep, mark);
                }

                rep.ElevSpans += dims;
                rep.ElevTags += tags;
                if (dims + tags > 0)
                {
                    BbAnnoStore.Record(doc, view, before);
                    t.Commit();
                    rep.Views++;
                }
                else t.RollBack();
            }
        }

        /// <summary>
        /// Тэнхлэгийн толгой гинжийн талд (ЖИШЭЭ-2 3-1: босоо тэнхлэг доор, хэвтээ тэнхлэг баруун талд) — зөвхөн энэ харагдацад.
        /// <paramref name="atEnd0"/> = End0 нь доод / баруун үзүүр.
        /// </summary>
        private static void Bubble(Grid g, View view, bool atEnd0)
        {
            DatumEnds show = atEnd0 ? DatumEnds.End0 : DatumEnds.End1, hide = atEnd0 ? DatumEnds.End1 : DatumEnds.End0;
            try { if (!g.IsBubbleVisibleInView(show, view)) g.ShowBubbleInView(show, view); } catch { }
            try { if (g.IsBubbleVisibleInView(hide, view)) g.HideBubbleInView(hide, view); } catch { }
        }

        /// <summary>Байрлал бүрт нэг багана: огтлолын хавтгайг дайрсан нь, эс бөгөөс доороос ирсэн (дээд нь түвшинд хамгийн ойр) нь.</summary>
        private static List<FamilyInstance> PickColumns(List<FamilyInstance> cols, BbFrame f, double cutZ, double levelZ)
        {
            var byPos = new Dictionary<string, FamilyInstance>();
            var score = new Dictionary<string, double>();
            foreach (FamilyInstance c in cols)
            {
                if (!(c.Location is LocationPoint lp)) continue;
                BoundingBoxXYZ bb = c.get_BoundingBox(null);
                if (bb == null) continue;
                double z0 = bb.Min.Z, z1 = bb.Max.Z;
                XYZ q = f.Local(lp.Point);
                string key = Math.Round(q.X / BbGeom.Ft(100)) + ":" + Math.Round(q.Y / BbGeom.Ft(100));
                double s = z0 <= cutZ && z1 >= cutZ ? 0 : 1 + Math.Abs(z1 - levelZ);
                if (!score.TryGetValue(key, out double old) || s < old) { score[key] = s; byPos[key] = c; }
            }
            return byPos.Values.ToList();
        }

        private static Beam MakeBeam(FamilyInstance e, View view, BbFrame f)
        {
            if (!(e.Location is LocationCurve lc) || !(lc.Curve is Line l)) return null;
            XYZ d = l.Direction;
            bool alongR;
            if (Math.Abs(d.DotProduct(f.R)) > 0.995) alongR = true;
            else if (Math.Abs(d.DotProduct(f.U)) > 0.995) alongR = false;
            else return null;                                    // ташуу дамнуруу — хэмжээсгүй
            List<Fc> side = Faces(e, view, f, !alongR);
            if (side.Count < 2) return null;
            XYZ a = f.Local(l.GetEndPoint(0)), b = f.Local(l.GetEndPoint(1));
            double sa = alongR ? a.X : a.Y, sb = alongR ? b.X : b.Y;
            return new Beam
            {
                E = e, AlongR = alongR, S0 = Math.Min(sa, sb), S1 = Math.Max(sa, sb),
                W0 = side.OrderBy(x => x.At).First(), W1 = side.OrderBy(x => x.At).Last(),
                P0 = sa <= sb ? l.GetEndPoint(0) : l.GetEndPoint(1), P1 = sa <= sb ? l.GetEndPoint(1) : l.GetEndPoint(0),
            };
        }

        /// <summary>«нүүр | тэнхлэг | нүүр»; гишүүнийг тэнхлэг дайрахгүй бол «нүүр | төв | нүүр» (ЖИШЭЭ-2: 550|550), төв ч алга бол «нүүр | нүүр».</summary>
        private static List<KeyValuePair<double, Reference>> Binding(Document doc, List<Fc> faces, List<KeyValuePair<double, Reference>> grids, double a, double b, KeyValuePair<double, Reference>? center)
        {
            Fc lo = faces.OrderBy(x => x.At).First(), hi = faces.OrderBy(x => x.At).Last();
            var res = new List<KeyValuePair<double, Reference>> { new KeyValuePair<double, Reference>(lo.At, lo.Ref(doc)), new KeyValuePair<double, Reference>(hi.At, hi.Ref(doc)) };
            double eps = BbGeom.Ft(5);
            KeyValuePair<double, Reference>? g = null;
            foreach (var x in grids) if (x.Key > a - eps && x.Key < b + eps) { g = x; break; }
            if (g != null) res.Add(g.Value);
            else if (center != null) res.Add(center.Value);
            res = Distinct(res);
            return res.Count >= 2 ? res : null;
        }

        /// <summary>Баганын төвийн reference plane — HandOrientation нь R-тэй параллель бол CenterLeftRight нь R-ийн дагуух байрлалтай.</summary>
        private static KeyValuePair<double, Reference>? Center(FamilyInstance c, BbFrame f, bool alongR)
        {
            if (!(c.Location is LocationPoint lp)) return null;
            XYZ axis = alongR ? f.R : f.U;
            bool handAlong;
            try { handAlong = Math.Abs(c.HandOrientation.DotProduct(axis)) > 0.9; } catch { return null; }
            IList<Reference> refs;
            try { refs = c.GetReferences(handAlong ? FamilyInstanceReferenceType.CenterLeftRight : FamilyInstanceReferenceType.CenterFrontBack); } catch { return null; }
            if (refs == null || refs.Count == 0) return null;
            XYZ q = f.Local(lp.Point);
            return new KeyValuePair<double, Reference>(alongR ? q.X : q.Y, refs[0]);
        }

        private static int BayChains(Document doc, View view, BbFrame f, List<KeyValuePair<double, Reference>> grids, List<Beam> crossing, bool horizontal,
            double at, DimensionType type, List<string> notes, double vz)
        {
            int made = 0;
            double margin = BbGeom.Ft(50);
            for (int i = 0; i + 1 < grids.Count; i++)
            {
                double a = grids[i].Key, b = grids[i + 1].Key;
                if (b - a < BbGeom.Ft(500)) continue;
                double line = a + (b - a) * at;
                var refs = new List<KeyValuePair<double, Reference>>();
                foreach (Beam bm in crossing)
                {
                    if (bm.S0 > line - margin || bm.S1 < line + margin) continue;
                    refs.Add(new KeyValuePair<double, Reference>(bm.W0.At, bm.W0.Ref(doc)));
                    refs.Add(new KeyValuePair<double, Reference>(bm.W1.At, bm.W1.Ref(doc)));
                }
                refs = Distinct(refs);
                if (refs.Count < 3) continue;
                made += BbGridDims.Chain(doc, view, f, refs, horizontal, line, type, notes, vz);
            }
            return made;
        }

        /// <summary>Харагдацын R (alongR) эсвэл U тэнхлэгтэй параллель нормальтай хавтгай нүүрнүүд — тэр тэнхлэгийн дагуух байрлалтай.</summary>
        private static List<Fc> Faces(Element e, View view, BbFrame f, bool alongR)
        {
            var res = new List<Fc>();
            XYZ axis = alongR ? f.R : f.U;
            foreach (Options opt in new[] { new Options { ComputeReferences = true, View = view }, new Options { ComputeReferences = true, DetailLevel = ViewDetailLevel.Fine } })
            {
                GeometryElement ge;
                try { ge = e.get_Geometry(opt); }
                catch { continue; }
                if (ge == null) continue;
                BbElevTopChain.Walk(ge, Transform.Identity, (s, tr) =>
                {
                    foreach (Face fc in s.Faces)
                    {
                        if (!(fc is PlanarFace pf) || pf.Reference == null) continue;
                        if (Math.Abs(tr.OfVector(pf.FaceNormal).DotProduct(axis)) < 0.999) continue;
                        XYZ q = f.Local(tr.OfPoint(pf.Origin));
                        string rp;
                        try { rp = pf.Reference.ConvertToStableRepresentation(e.Document); } catch { continue; }
                        res.Add(new Fc { At = alongR ? q.X : q.Y, Rep = rp });
                    }
                });
                if (res.Count >= 2) break;
                res.Clear();
            }
            return res;
        }

        private static List<KeyValuePair<double, Reference>> Distinct(List<KeyValuePair<double, Reference>> xs)
        {
            var res = new List<KeyValuePair<double, Reference>>();
            foreach (var x in xs.OrderBy(x => x.Key))
                if (res.Count == 0 || x.Key - res[res.Count - 1].Key > BbGeom.Ft(3)) res.Add(x);
            return res;
        }

        private static int Tag(Document doc, View view, ElementId type, Element e, bool leader, XYZ head, BbAnnoReport rep, string mark)
        {
            using (var st = new SubTransaction(doc))
            {
                st.Start();
                try
                {
                    IndependentTag tag = IndependentTag.Create(doc, view.Id, new Reference(e), leader, TagMode.TM_ADDBY_CATEGORY, TagOrientation.Horizontal, head);
                    if (tag == null) { st.RollBack(); return 0; }
                    if (type != ElementId.InvalidElementId && tag.GetTypeId() != type) { try { tag.ChangeTypeId(type); } catch { } }
                    if (leader) { try { tag.TagHeadPosition = head; } catch { } }
                    st.Commit();
                    return 1;
                }
                catch (Exception ex)
                {
                    if (st.HasStarted() && !st.HasEnded()) st.RollBack();
                    rep.Notes.Add(mark + " «" + view.Name + "»: марк — " + ex.Message.Split('\n')[0]);
                    return 0;
                }
            }
        }

        private static ElementId TagType(Document doc, BuiltInCategory cat, string familyAndType, BbAnnoReport rep, string mark)
        {
            var all = new FilteredElementCollector(doc).OfCategory(cat).WhereElementIsElementType().OfType<FamilySymbol>().ToList();
            FamilySymbol fs = all.FirstOrDefault(x => x.FamilyName + " : " + x.Name == familyAndType) ?? all.FirstOrDefault(x => x.Name == familyAndType);
            if (fs != null) return fs.Id;
            if (!string.IsNullOrEmpty(familyAndType))
                rep.Issues.Add(new BbIssue { Tool = "Тэмдэглэх", Member = mark, Severity = BbSeverity.Warning, Problem = "Марк «" + familyAndType + "» алга — өгөгдмөлөөр.", Proposal = "Шошгоны family-г ачаалах.", Key = "anno|tag|" + familyAndType });
            return ElementId.InvalidElementId;
        }

        private static DimensionType DimType(Document doc, string name, BbAnnoReport rep, string mark)
        {
            ElementId id = BbAnnotate.DimTypeId(doc, name, rep, mark);
            return id == ElementId.InvalidElementId ? null : doc.GetElement(id) as DimensionType;
        }

        private static BbIssue Issue(string mark, BbSeverity sev, string problem, string proposal, string code)
        {
            return new BbIssue { Tool = "Ажлын зураг үүсгэх", Severity = sev, Member = mark, Problem = problem, Proposal = proposal, Key = "gen|" + mark + "|" + code };
        }
    }
}
