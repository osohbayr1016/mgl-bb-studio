using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;

namespace MglWeGate
{
    /// <summary>
    /// Интерьерийн багийн 3-р тойрог (2026-10-14) — production-ийн ҮҮСГЭСЭН зүйлийг Revit API-аар шалгана (black-box):
    ///   • шал/таазны spot ТОЛИН — бичвэр тэмдгийн гадна (leader-ийн эхлэлийн эсрэг талд);
    ///   • таазнаас дээш БҮДЭГ давхарга: masking region, тунгалаг байдал = opacity (20), хил харагдахгүй, таазнаас хүрээний орой хүртэл;
    ///   • дэлгээс, түлхүүр планд бөөрөнхий улаан тасархай хүрээ (4 шулуун + 4 нум, crop-ын дотор); түлхүүр планд хуучин хилийн улаан шугам алга;
    ///   • рендерийн байр (ХАРАГДАХ БАЙДАЛ NN) — бүгд байгаа, сүүлийн эсвэл сүүлээсээ 2 дахь хуудсанд.
    /// </summary>
    internal static class Round3Checks
    {
        public const string FrameStyle = "MGL — Улаан тасархай хүрээ";
        public const string OldKeyStyle = "MGL — Түлхүүр байгуулалт";
        private static double Mm(double ft) { return ft * 304.8; }
        private static string F(double v) { return v.ToString("0.#", CultureInfo.InvariantCulture); }

        /// <param name="expectFade">Өрөөнд тааз бий (Synth: 101, 102) — дэлгээс бүрт бүдэг давхарга ЗААВАЛ.  Үгүй бол давхарга байвал л шалгана.</param>
        public static void Run(Document doc, LiveContext L, List<View> views, List<ViewSheet> sheets, Geo.LinkedRoom lr, ScenarioResult res,
                               bool expectFade, int opacity = 20, int perspectives = 3)
        {
            var mirrorBad = new List<string>();
            var fadeBad = new List<string>();
            var frameBad = new List<string>();
            int mirrored = 0, faded = 0, framed = 0;
            foreach (View v in views)
            {
                XYZ right = v.RightDirection, up = v.UpDirection;
                List<XYZ> c = Geo.CropCorners(v);
                double cx0 = c.Min(p => p.DotProduct(right)), cx1 = c.Max(p => p.DotProduct(right));
                double cz0 = c.Min(p => p.DotProduct(up)), cz1 = c.Max(p => p.DotProduct(up));

                // ── Толин spot ──
                foreach (SpotDimension sd in new FilteredElementCollector(doc).OfClass(typeof(SpotDimension)).Cast<SpotDimension>().Where(s => s.OwnerViewId == v.Id))
                {
                    double xe, xt, xo;
                    try
                    {
                        xe = sd.LeaderEndPosition.DotProduct(right);
                        xt = sd.TextPosition.DotProduct(right);
                        xo = sd.Origin.DotProduct(right);
                    }
                    catch { continue; }
                    if (xe >= cx0 - 1e-6) continue;   // leader-гүй (хүрээн дотор) — хаалга/цонхны spot
                    if ((xt - xe) * (xo - xe) < 0) mirrored++;
                    else mirrorBad.Add(v.Name + " #" + sd.Id.Value + ": бичвэр төгсгөлөөс " + F(Mm(xt - xe) / Math.Max(1, v.Scale)) + " мм (цаас) — эхлэлийн талд");
                }

                // ── Бүдэг давхарга ──
                List<FilledRegion> masks = new FilteredElementCollector(doc).OfClass(typeof(FilledRegion)).Cast<FilledRegion>()
                    .Where(fr => fr.OwnerViewId == v.Id && fr.IsMasking).ToList();
                if (masks.Count == 0 && !expectFade) res.Info("fade." + v.Name, "бүдэг давхаргагүй (өрөөнд тааз алга)");
                else if (masks.Count != 1) fadeBad.Add(v.Name + ": masking region " + masks.Count + " (хүлээгдэж буй 1)");
                else
                {
                    FilledRegion m = masks[0];
                    int t = v.GetElementOverrides(m.Id).Transparency;
                    // FilledRegion-д хилийн хэв маягийг УНШИХ API алга (зөвхөн SetLineStyleId) — хил харагдахгүйг PNG-ээр шалгана.
                    BoundingBoxXYZ bb = m.get_BoundingBox(v);
                    var pts = new List<XYZ>();
                    if (bb != null)
                        foreach (double x in new[] { bb.Min.X, bb.Max.X })
                            foreach (double y in new[] { bb.Min.Y, bb.Max.Y })
                                foreach (double z in new[] { bb.Min.Z, bb.Max.Z })
                                    pts.Add(bb.Transform != null ? bb.Transform.OfPoint(new XYZ(x, y, z)) : new XYZ(x, y, z));
                    double mz0 = pts.Count > 0 ? pts.Min(p => p.DotProduct(up)) : double.NaN, mz1 = pts.Count > 0 ? pts.Max(p => p.DotProduct(up)) : double.NaN;
                    double mx0 = pts.Count > 0 ? pts.Min(p => p.DotProduct(right)) : double.NaN, mx1 = pts.Count > 0 ? pts.Max(p => p.DotProduct(right)) : double.NaN;
                    double fromFloor = Mm(mz0 - lr.LevelZ);
                    var bad = new List<string>();
                    if (t != opacity) bad.Add("тунгалаг " + t + " ≠ " + opacity);
                    if (!(fromFloor > 2650 && fromFloor < 3000)) bad.Add("доод хил шалнаас " + F(fromFloor) + " мм (тааз ≈ 2700)");
                    if (Math.Abs(mz1 - cz1) > 0.01) bad.Add("дээд хил crop-оос " + F(Mm(mz1 - cz1)) + " мм");
                    if (Math.Abs(mx0 - cx0) > 0.01 || Math.Abs(mx1 - cx1) > 0.01) bad.Add("өргөн crop-той таарахгүй");
                    if (bad.Count > 0) fadeBad.Add(v.Name + ": " + string.Join(", ", bad));
                    else
                    {
                        faded++;
                        res.Info("fade." + v.Name, "masking region #" + m.Id.Value + " · тунгалаг " + t + " · шалнаас " + F(fromFloor) + " мм → crop-ын орой");
                    }
                }

                // ── Улаан хүрээ ──
                string fb = FrameProblem(doc, v, cx0, cx1, cz0, cz1, right, up);
                if (fb != null) frameBad.Add(v.Name + ": " + fb); else framed++;
            }
            if (mirrored + mirrorBad.Count == 0) res.Info("r3.spot_mirrored", "leader-тэй (шал/таазны) spot алга — өрөөнд тааз/шал олдоогүй");
            else res.Expect(mirrorBad.Count == 0, "r3.spot_mirrored",
                            mirrorBad.Count == 0 ? mirrored + " шал/таазны spot — бичвэр тэмдгийн гадна (толин)" : string.Join("; ", mirrorBad.Take(6)));
            if (expectFade || faded > 0 || fadeBad.Count > 0)
                res.Expect(fadeBad.Count == 0 && (!expectFade || faded == views.Count), "r3.fade_above_ceiling",
                           fadeBad.Count == 0 ? faded + "/" + views.Count + " дэлгээст таазнаас дээш бүдэг (opacity " + opacity + ")" : string.Join("; ", fadeBad.Take(6)));
            res.Expect(frameBad.Count == 0 && framed == views.Count, "r3.red_frame_elevations",
                       frameBad.Count == 0 ? framed + " дэлгээс бөөрөнхий улаан тасархай хүрээтэй (crop-ын дотор)" : string.Join("; ", frameBad.Take(6)));

            // ── Түлхүүр план ──
            List<View> keys = L.Added.Select(id => doc.GetElement(new ElementId(id)) as View)
                .Where(x => x != null && x.IsValidObject && x.ViewType == ViewType.FloorPlan && x.Name.StartsWith("Түлхүүр байгуулалт", StringComparison.Ordinal)).ToList();
            if (keys.Count == 0) res.Info("r3.key_plan", "энэ ажиллагаанд шинэ түлхүүр план алга (өмнө үүссэн)");
            foreach (View k in keys)
            {
                List<XYZ> c = Geo.CropCorners(k);
                XYZ right = k.RightDirection, up = k.UpDirection;
                string fb = FrameProblem(doc, k, c.Min(p => p.DotProduct(right)), c.Max(p => p.DotProduct(right)), c.Min(p => p.DotProduct(up)), c.Max(p => p.DotProduct(up)), right, up);
                int old = new FilteredElementCollector(doc).OfClass(typeof(CurveElement)).OfType<DetailCurve>()
                    .Count(d => d.OwnerViewId == k.Id && d.LineStyle != null && d.LineStyle.Name == OldKeyStyle);
                res.Expect(fb == null && old == 0, "r3.red_frame_key_plan", k.Name + ": " + (fb ?? "бөөрөнхий улаан хүрээ") + " · өрөөний хилийн хуучин улаан шугам " + old);
            }

            // ── Рендерийн байр ──
            if (sheets.Count > 0)
            {
                List<ViewSheet> ordered = sheets.OrderBy(s => s.SheetNumber, StringComparer.Ordinal).ToList();
                var where = new List<string>();
                int total = 0;
                for (int i = 0; i < ordered.Count; i++)
                {
                    int n = new FilteredElementCollector(doc).OfClass(typeof(TextNote)).Cast<TextNote>()
                        .Count(tn => tn.OwnerViewId == ordered[i].Id && (tn.Text ?? string.Empty).StartsWith("ХАРАГДАХ БАЙДАЛ", StringComparison.Ordinal));
                    total += n;
                    if (n > 0) where.Add(ordered[i].SheetNumber + " (" + (i + 1) + "/" + ordered.Count + "): " + n);
                    if (n > 0 && i < ordered.Count - 2) where.Add("⚠ сүүлийн 2 хуудаснаас өмнө");
                }
                res.Expect(total == perspectives && !where.Any(w => w.StartsWith("⚠", StringComparison.Ordinal)), "r3.render_slots",
                           "рендерийн байр " + total + "/" + perspectives + " · " + (where.Count > 0 ? string.Join(" · ", where) : "алга"));
            }
        }

        /// <summary>null = зөв: <see cref="FrameStyle"/> хэв маягтай 4 шулуун + 4 нум, бүгд crop-ын дотор (≤ 2 мм цаас).</summary>
        private static string FrameProblem(Document doc, View v, double cx0, double cx1, double cz0, double cz1, XYZ right, XYZ up)
        {
            List<DetailCurve> curves = new FilteredElementCollector(doc).OfClass(typeof(CurveElement)).OfType<DetailCurve>()
                .Where(d => d.OwnerViewId == v.Id && d.LineStyle != null && d.LineStyle.Name == FrameStyle).ToList();
            int lines = curves.Count(d => d.GeometryCurve is Line), arcs = curves.Count(d => d.GeometryCurve is Arc);
            if (lines != 4 || arcs != 4) return "хүрээ: шулуун " + lines + ", нум " + arcs + " (хүлээгдэж буй 4 + 4)";
            double tol = 2.0 / 304.8 * Math.Max(1, v.Scale);
            foreach (DetailCurve d in curves)
                foreach (XYZ p in d.GeometryCurve.Tessellate())
                {
                    double x = p.DotProduct(right), y = p.DotProduct(up);
                    if (x < cx0 - 1e-6 || x > cx1 + 1e-6 || y < cz0 - 1e-6 || y > cz1 + 1e-6) return "хүрээ crop-оос гарсан";
                    if (Math.Min(Math.Min(x - cx0, cx1 - x), Math.Min(y - cz0, cz1 - y)) > tol && IsOnStraight(d)) return "хүрээ crop-оос хол (" + F(Mm(Math.Min(x - cx0, cx1 - x)) / Math.Max(1, v.Scale)) + " мм цаас)";
                }
            var gs = curves[0].LineStyle as GraphicsStyle;
            Category cat = gs != null ? gs.GraphicsStyleCategory : null;
            if (cat == null || cat.LineColor.Red < 150 || cat.LineColor.Green > 90) return "хүрээний өнгө улаан биш";
            return null;
        }

        private static bool IsOnStraight(DetailCurve d) { return d.GeometryCurve is Line; }

        // ── PDF (хэвлэлт) — бүдэг давхарга хадгалагдах эсэх ──

        /// <summary>
        /// 101-ийн эхний дэлгээс ба хуудсыг PDF-ээр (вектор ба raster) гаргана — бүдэг хэсэг хэвлэлтэд хадгалагдах эсэхийг ДАРАА нь пикселээр
        /// (PyMuPDF) хэмжинэ.  Revit 2022+ <c>Document.Export(folder, views, PDFExportOptions)</c>.
        /// </summary>
        public static Scenario PdfExport(string id, string room)
        {
            return new Scenario
            {
                Id = id, Title = "Бүдэг хэсэг PDF-д (вектор / raster) — " + room, Category = "output", NoCommand = true,
                Setup = (app, L, res, st) => true,
                Inspect = (app, L, res, st) =>
                {
                    Document doc = app.ActiveUIDocument.Document;
                    List<long> made;
                    if (!L.Generated.TryGetValue(room, out made) || made.Count == 0) { res.Add("pdf", "BLOCKED", room + "-ийн дэлгээс алга (GEN сценари унасан)"); return; }
                    var v = doc.GetElement(new ElementId(made[0])) as View;
                    List<long> sh;
                    var sheet = L.GeneratedSheets.TryGetValue(room, out sh) && sh.Count > 0 ? doc.GetElement(new ElementId(sh.Last())) as ViewSheet : null;
                    string dir = Path.Combine(L.R.Job.RunDir, "pdf");
                    Directory.CreateDirectory(dir);
                    foreach (bool raster in new[] { false, true })
                        foreach (View x in new View[] { v, sheet })
                        {
                            if (x == null) continue;
                            string name = (raster ? "raster-" : "vector-") + (x is ViewSheet ? "sheet" : "elev");
                            try
                            {
                                var o = new PDFExportOptions { FileName = name, Combine = true, AlwaysUseRaster = raster, ExportQuality = PDFExportQualityType.DPI300, ColorDepth = ColorDepthType.Color };
                                bool ok = doc.Export(dir, new List<ElementId> { x.Id }, o);
                                string f = Path.Combine(dir, name + ".pdf");
                                res.Expect(ok && File.Exists(f), "pdf." + name, (ok ? "гарсан " : "Export false ") + f + (File.Exists(f) ? " (" + new FileInfo(f).Length + " B)" : ""));
                                res.Evidence.Add(f);
                            }
                            catch (Exception ex) { res.Add("pdf." + name, "FAIL", ex.GetType().Name + ": " + ex.Message); }
                        }
                    res.Info("pdf.view", v != null ? v.Name + " #" + v.Id.Value : "-");
                },
            };
        }

        // ── «* Type Designator» (GEN-LINK-104) ──

        public const string TypeDesignatorParam = "* Type Designator";

        /// <summary>Хуудасны ангилалд «* Type Designator» (бичвэр) параметр — gate-ийн түр shared parameter файлаар.  true = нэмсэн/байсан.</summary>
        public static bool EnsureTypeDesignator(UIApplication app, LiveContext L, ScenarioResult res)
        {
            Document doc = app.ActiveUIDocument.Document;
            Category sheets = Category.GetCategory(doc, BuiltInCategory.OST_Sheets);
            DefinitionBindingMapIterator it = doc.ParameterBindings.ForwardIterator();
            while (it.MoveNext())
                if (it.Key != null && it.Key.Name == TypeDesignatorParam) return true;
            Autodesk.Revit.ApplicationServices.Application a = app.Application;
            string prev = a.SharedParametersFilename;
            string spf = Path.Combine(L.R.Job.RunDir, "gate-shared-params.txt");
            try
            {
                if (!File.Exists(spf)) File.WriteAllText(spf, string.Empty);
                a.SharedParametersFilename = spf;
                DefinitionFile df = a.OpenSharedParameterFile();
                DefinitionGroup g = df.Groups.get_Item("MGL GATE") ?? df.Groups.Create("MGL GATE");
                Definition def = g.Definitions.get_Item(TypeDesignatorParam) ?? g.Definitions.Create(new ExternalDefinitionCreationOptions(TypeDesignatorParam, SpecTypeId.String.Text));
                CategorySet cs = a.Create.NewCategorySet();
                cs.Insert(sheets);
                using (var t = new Transaction(doc, "gate: * Type Designator"))
                {
                    t.Start();
                    bool ok = doc.ParameterBindings.Insert(def, a.Create.NewInstanceBinding(cs), GroupTypeId.IdentityData);
                    t.Commit();
                    res.Info("setup.type_designator", "«" + TypeDesignatorParam + "» хуудасны параметр нэмэв: " + ok);
                    return ok;
                }
            }
            catch (Exception ex) { res.Add("setup.type_designator", "BLOCKED", ex.Message); return false; }
            finally { try { a.SharedParametersFilename = prev; } catch { } }
        }

        /// <summary>
        /// Синтетик загварт 101–105 өрөөний доор шал алга (шалны spot огт үүсдэггүй) — өрөөний хилээр HOST-д шал (дээд нүүр = давхрын түвшин)
        /// үүсгэнэ, ингэснээр шалны spot-ын толин хэлбэрийг бодитоор шалгана.
        /// </summary>
        public static bool AddFloorUnder(UIApplication app, LiveContext L, Geo.LinkedRoom lr, ScenarioResult res)
        {
            Document doc = app.ActiveUIDocument.Document;
            var plan = doc.GetElement(new ElementId(Convert.ToInt64(L.R.Facts["plan_l1"]))) as ViewPlan;
            Level lv = plan != null ? plan.GenLevel : null;
            if (lv == null) { res.Add("setup.floor", "BLOCKED", "L1 түвшин алга"); return false; }
            try
            {
                IList<IList<Autodesk.Revit.DB.BoundarySegment>> segs = lr.Room.GetBoundarySegments(new SpatialElementBoundaryOptions());
                var loop = new CurveLoop();
                double z = lv.ProjectElevation;
                foreach (Autodesk.Revit.DB.BoundarySegment b in segs[0])
                {
                    Curve c = b.GetCurve().CreateTransformed(lr.Tf);
                    XYZ p0 = c.GetEndPoint(0), p1 = c.GetEndPoint(1);
                    loop.Append(Line.CreateBound(new XYZ(p0.X, p0.Y, z), new XYZ(p1.X, p1.Y, z)));
                }
                FloorType ft = new FilteredElementCollector(doc).OfClass(typeof(FloorType)).Cast<FloorType>().First(f => !f.IsFoundationSlab);
                using (var t = new Transaction(doc, "gate: шал " + lr.Number))
                {
                    t.Start();
                    Floor f = Floor.Create(doc, new List<CurveLoop> { loop }, ft.Id, lv.Id);
                    t.Commit();
                    res.Info("setup.floor", lr.Number + "-ийн доор host шал #" + f.Id.Value + " (" + ft.Name + ")");
                }
                return true;
            }
            catch (Exception ex) { res.Add("setup.floor", "BLOCKED", ex.Message); return false; }
        }

        public static void CheckTypeDesignator(Document doc, List<ViewSheet> sheets, string expected, ScenarioResult res)
        {
            var got = sheets.Select(s => { Parameter p = s.LookupParameter(TypeDesignatorParam); return s.SheetNumber + "=" + (p != null ? p.AsString() ?? "∅" : "алга"); }).ToList();
            bool ok = sheets.Count > 0 && sheets.All(s => { Parameter p = s.LookupParameter(TypeDesignatorParam); return p != null && p.AsString() == expected; });
            res.Expect(ok, "r3.type_designator", "цонхонд «" + expected + "» сонгосон → хуудас: " + string.Join(", ", got));
        }
    }
}
