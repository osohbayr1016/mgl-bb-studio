using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;

namespace MglWeGate
{
    /// <summary>
    /// ХЭМЖИЛТ (интерьерийн баг, 2026-10-14, 3-р тойрог) — production код хөндөхгүй, бүх өөрчлөлтийг буцаана (TransactionGroup.RollBack).
    /// <list type="bullet">
    /// <item>Spot level-ийн leader: тэмдэг (гурвалжин) ба бичвэр аль талд гарахыг bend-ийн байрлал / TextPosition-оор (толин дүрс).</item>
    /// <item>Дэлгээс (зүсэлт) дээрх ЦАГААН хатуу дүүргэлт + SetSurfaceTransparency — «бүдэгрүүлэх» давхарга харагдах эсэх.</item>
    /// <item>Crop-ын дотор бөөрөнхий булантай улаан тасархай хүрээ (detail line + arc) бүтэн зурагдах эсэх.</item>
    /// </list>
    /// Тус бүрд PNG + тоон хэмжилт (bbox, байрлал).
    /// </summary>
    internal static class Diagnostics2
    {
        private const double Scale = 50;

        public static Scenario SpotFadeFrame(string id)
        {
            return new Scenario
            {
                Id = id, Title = "ХЭМЖИЛТ: spot-ын толин дүрс, бүдэгрүүлэх давхарга, бөөрөнхий улаан хүрээ", Category = "diagnostic",
                NoCommand = true,
                Setup = (app, L, res, st) => true,
                Inspect = (app, L, res, st) => Measure(app, L, res, st),
            };
        }

        private static double P(double paperMm) { return U.Mm(paperMm * Scale); }

        private static void Measure(UIApplication app, LiveContext L, ScenarioResult res, ScnState st)
        {
            Document doc = app.ActiveUIDocument.Document;
            Level lv = new FilteredElementCollector(doc).OfClass(typeof(Level)).Cast<Level>().OrderBy(l => Math.Abs(l.ProjectElevation)).FirstOrDefault();
            if (lv == null) { res.Add("diag", "BLOCKED", "түвшин алга"); return; }
            double x0 = U.Mm(100000), z0 = lv.ProjectElevation;
            using (var tg = new TransactionGroup(doc, "gate: diag spot/fade/frame"))
            {
                tg.Start();
                try
                {
                    Floor floor; Ceiling ceiling; ViewSection v;
                    var sw = new WarningSwallower();
                    using (Transaction t = WarningSwallower.Start(doc, "gate: загвар", sw))
                    {
                        FloorType ft = new FilteredElementCollector(doc).OfClass(typeof(FloorType)).Cast<FloorType>().First(f => !f.IsFoundationSlab);
                        CurveLoop rect = Rect(x0, 0, x0 + U.Mm(6000), U.Mm(4000), z0);
                        floor = Floor.Create(doc, new List<CurveLoop> { rect }, ft.Id, lv.Id);
                        Wall.Create(doc, Line.CreateBound(new XYZ(x0, U.Mm(4100), z0), new XYZ(x0 + U.Mm(6000), U.Mm(4100), z0)), lv.Id, false);
                        CeilingType ct = new FilteredElementCollector(doc).OfClass(typeof(CeilingType)).Cast<CeilingType>().FirstOrDefault();
                        ceiling = Ceiling.Create(doc, new List<CurveLoop> { Rect(x0, 0, x0 + U.Mm(6000), U.Mm(4000), z0) }, ct.Id, lv.Id);
                        Parameter hp = ceiling.get_Parameter(BuiltInParameter.CEILING_HEIGHTABOVELEVEL_PARAM);
                        if (hp != null && !hp.IsReadOnly) hp.Set(U.Mm(2800));
                        ViewFamilyType sec = new FilteredElementCollector(doc).OfClass(typeof(ViewFamilyType)).Cast<ViewFamilyType>().First(x => x.ViewFamily == ViewFamily.Section);
                        var tf = Transform.Identity;
                        tf.Origin = new XYZ(x0 + U.Mm(3000), U.Mm(1000), z0);
                        tf.BasisX = XYZ.BasisX;
                        tf.BasisY = XYZ.BasisZ;
                        tf.BasisZ = new XYZ(0, -1, 0);
                        var box = new BoundingBoxXYZ { Transform = tf, Min = new XYZ(-U.Mm(3300), -U.Mm(400), -U.Mm(3500)), Max = new XYZ(U.Mm(3300), U.Mm(3600), 0) };
                        v = ViewSection.CreateSection(doc, sec.Id, box);
                        v.Name = "GATE DIAG SPOT";
                        v.Scale = (int)Scale;
                        try { v.Discipline = ViewDiscipline.Coordination; } catch { }
                        v.CropBoxActive = true;
                        v.CropBoxVisible = false;
                        try { Parameter ac = v.get_Parameter(BuiltInParameter.VIEWER_ANNOTATION_CROP_ACTIVE); if (ac != null && !ac.IsReadOnly) ac.Set(0); } catch { }
                        t.Commit();
                    }
                    res.Info("diag.view", "зүсэлт #" + v.Id.Value + " · ViewDirection " + v.ViewDirection + " · Right " + v.RightDirection + " · Up " + v.UpDirection + " · Origin " + v.Origin);

                    Reference floorTop = HostObjectUtils.GetTopFaces(floor).FirstOrDefault();
                    Reference ceilBottom = HostObjectUtils.GetBottomFaces(ceiling).FirstOrDefault();
                    double floorZ = FaceZ(floor, floorTop, z0), ceilZ = FaceZ(ceiling, ceilBottom, z0 + U.Mm(2800));
                    res.Info("diag.faces", "шалны дээд " + U.F(U.ToMm(floorZ - z0)) + " мм · таазны доод " + U.F(U.ToMm(ceilZ - z0)) + " мм");
                    BoundingBoxXYZ cb = v.CropBox;
                    double cropLeftX = cb.Transform.OfPoint(new XYZ(cb.Min.X, 0, 0)).X;
                    double endX = cropLeftX - P(6);   // хэрэгслийн өгөгдмөл: хүрээнээс 300 мм (1:50-д 6 мм)
                    double py = U.Mm(1000);           // зүсэлтийн хавтгай (cut plane) — spot-ын цэгүүд нүүрэн дээр (гүн = нүүрийн дотор)

                    List<SpotDimensionType> types = new FilteredElementCollector(doc).OfClass(typeof(SpotDimensionType)).Cast<SpotDimensionType>()
                        .Where(x => x.StyleType == DimensionStyleType.SpotElevation).ToList();
                    res.Info("diag.spot_types", string.Join(" | ", types.Select(x => x.Name + " (symbol " + SymbolName(doc, x) + ", text loc " + ParamText(x, BuiltInParameter.SPOT_ELEV_TEXT_LOCATION) + ")")));
                    var variants = new[] { "cur", "bendL", "bendL8", "textposL", "noshoulder" };
                    foreach (SpotDimensionType stype in types.Take(4))
                    {
                        foreach (string variant in variants)
                        {
                            var made = new List<ElementId>();
                            string tag = Clean(stype.Name) + "_" + variant;
                            try
                            {
                                using (Transaction t = WarningSwallower.Start(doc, "gate: spot " + tag, new WarningSwallower()))
                                {
                                    foreach (KeyValuePair<Reference, double[]> rf in new[]
                                    {
                                        new KeyValuePair<Reference, double[]>(floorTop, new[] { x0 + U.Mm(1000), floorZ }),
                                        new KeyValuePair<Reference, double[]>(ceilBottom, new[] { x0 + U.Mm(1500), ceilZ }),
                                    })
                                    {
                                        var origin = new XYZ(rf.Value[0], U.Mm(2000), rf.Value[1]);
                                        var end = new XYZ(endX, U.Mm(2000), rf.Value[1]);
                                        XYZ bend = variant == "bendL" ? new XYZ(endX - P(2), U.Mm(2000), rf.Value[1])
                                                 : variant == "bendL8" ? new XYZ(endX - P(8), U.Mm(2000), rf.Value[1])
                                                 : variant == "noshoulder" ? end
                                                 : new XYZ(endX + P(2), U.Mm(2000), rf.Value[1]);
                                        SpotDimension sd = doc.Create.NewSpotElevation(v, rf.Key, origin, bend, end, origin, true);
                                        if (sd == null) continue;
                                        if (sd.GetTypeId() != stype.Id) sd.ChangeTypeId(stype.Id);
                                        made.Add(sd.Id);
                                        if (variant == "textposL")
                                        {
                                            try { sd.TextPosition = new XYZ(endX - P(5), U.Mm(2000), rf.Value[1] + P(1.5)); }
                                            catch (Exception ex) { res.Info("diag." + tag + ".textpos", ex.Message); }
                                        }
                                    }
                                    t.Commit();
                                }
                                foreach (ElementId sid in made) Describe(doc, v, sid, endX, res, tag);
                                Inspector.Export(doc, new List<ElementId> { v.Id }, L, res, st, tag);
                            }
                            catch (Exception ex) { res.Info("diag." + tag, "алдаа: " + ex.Message); }
                            finally
                            {
                                if (made.Count > 0)
                                    using (var t = new Transaction(doc, "gate: spot устгах")) { t.Start(); doc.Delete(made); t.Commit(); }
                            }
                        }
                    }

                    // ── Бүдэгрүүлэх давхарга + бөөрөнхий улаан хүрээ ──
                    double cl = cb.Transform.OfPoint(new XYZ(cb.Min.X, 0, 0)).X, cr = cb.Transform.OfPoint(new XYZ(cb.Max.X, 0, 0)).X;
                    double ctop = cb.Transform.OfPoint(new XYZ(0, cb.Max.Y, 0)).Z, cbot = cb.Transform.OfPoint(new XYZ(0, cb.Min.Y, 0)).Z;
                    double inset = P(0.5);
                    ElementId fadeType;
                    FilledRegion fade = null;
                    using (Transaction t = WarningSwallower.Start(doc, "gate: бүдэгрүүлэх", new WarningSwallower()))
                    {
                        fadeType = WhiteType(doc);
                        CurveLoop loop = PlaneRect(cl + inset, ceilZ, cr - inset, ctop - inset, py);
                        fade = FilledRegion.Create(doc, fadeType, v.Id, new List<CurveLoop> { loop });
                        IList<ElementId> valid = FilledRegion.GetValidLineStyleIdsForFilledRegion(doc);
                        ElementId invisible = valid.FirstOrDefault(i => { var gs = doc.GetElement(i) as GraphicsStyle; return gs != null && gs.Name.IndexOf("Invisible", StringComparison.OrdinalIgnoreCase) >= 0; });
                        res.Info("diag.fade.linestyles", valid.Count + " хүчинтэй хэв маяг · invisible " + (invisible != null ? "#" + invisible.Value : "алга"));
                        if (invisible != null) fade.SetLineStyleId(invisible);
                        var ogs = new OverrideGraphicSettings();
                        ogs.SetSurfaceTransparency(20);
                        v.SetElementOverrides(fade.Id, ogs);
                        t.Commit();
                    }
                    res.Info("diag.fade.t20", "override transparency = " + v.GetElementOverrides(fade.Id).Transparency);
                    Inspector.Export(doc, new List<ElementId> { v.Id }, L, res, st, "fade_t20");
                    foreach (int tr in new[] { 50, 80 })
                    {
                        using (var t = new Transaction(doc, "gate: transparency " + tr))
                        {
                            t.Start();
                            var ogs = new OverrideGraphicSettings();
                            ogs.SetSurfaceTransparency(tr);
                            v.SetElementOverrides(fade.Id, ogs);
                            t.Commit();
                        }
                        res.Info("diag.fade.t" + tr, "override transparency = " + v.GetElementOverrides(fade.Id).Transparency);
                        Inspector.Export(doc, new List<ElementId> { v.Id }, L, res, st, "fade_t" + tr);
                    }

                    // ── Шугам бүдгэрэх эсэх: masking region + тунгалаг, элементийн halftone ──
                    Wall farWall = new FilteredElementCollector(doc).OfClass(typeof(Wall)).Cast<Wall>().FirstOrDefault(w => { var lc = w.Location as LocationCurve; return lc != null && Math.Abs(lc.Curve.GetEndPoint(0).X - x0) < 1e-3; });
                    using (var t = new Transaction(doc, "gate: masking"))
                    {
                        t.Start();
                        doc.Delete(fade.Id);
                        FilledRegion mask = FilledRegion.CreateMaskingRegion(doc, v.Id, new List<CurveLoop> { PlaneRect(cl + inset, ceilZ, cr - inset, ctop - inset, py) });
                        var ogs = new OverrideGraphicSettings();
                        ogs.SetSurfaceTransparency(20);
                        v.SetElementOverrides(mask.Id, ogs);
                        fade = mask;
                        t.Commit();
                    }
                    res.Info("diag.mask.t20", "masking region transparency = " + v.GetElementOverrides(fade.Id).Transparency);
                    Inspector.Export(doc, new List<ElementId> { v.Id }, L, res, st, "mask_t20");
                    using (var t = new Transaction(doc, "gate: masking 80"))
                    {
                        t.Start();
                        var ogs = new OverrideGraphicSettings();
                        ogs.SetSurfaceTransparency(80);
                        v.SetElementOverrides(fade.Id, ogs);
                        t.Commit();
                    }
                    Inspector.Export(doc, new List<ElementId> { v.Id }, L, res, st, "mask_t80");
                    using (var t = new Transaction(doc, "gate: halftone wall"))
                    {
                        t.Start();
                        doc.Delete(fade.Id);
                        fade = FilledRegion.Create(doc, fadeType, v.Id, new List<CurveLoop> { PlaneRect(cl + inset, ceilZ, cr - inset, ctop - inset, py) });
                        IList<ElementId> valid2 = FilledRegion.GetValidLineStyleIdsForFilledRegion(doc);
                        ElementId inv2 = valid2.FirstOrDefault(i => { var gs = doc.GetElement(i) as GraphicsStyle; return gs != null && gs.Name.IndexOf("Invisible", StringComparison.OrdinalIgnoreCase) >= 0; });
                        if (inv2 != null) fade.SetLineStyleId(inv2);
                        var ogs = new OverrideGraphicSettings();
                        ogs.SetSurfaceTransparency(20);
                        v.SetElementOverrides(fade.Id, ogs);
                        if (farWall != null)
                        {
                            var h = new OverrideGraphicSettings();
                            h.SetHalftone(true);
                            v.SetElementOverrides(farWall.Id, h);
                        }
                        t.Commit();
                    }
                    res.Info("diag.halftone", "алс хана #" + (farWall != null ? farWall.Id.Value.ToString(CultureInfo.InvariantCulture) : "алга") + " halftone + давхарга t20");
                    Inspector.Export(doc, new List<ElementId> { v.Id }, L, res, st, "halftone_wall_fill_t20");

                    using (Transaction t = WarningSwallower.Start(doc, "gate: улаан хүрээ", new WarningSwallower()))
                    {
                        GraphicsStyle red = RedDash(doc);
                        double r = P(3);
                        int n = 0;
                        foreach (Curve c in RoundedRect(cl + inset, cbot + inset, cr - inset, ctop - inset, r, py))
                        {
                            DetailCurve dc = doc.Create.NewDetailCurve(v, c);
                            if (red != null) dc.LineStyle = red;
                            n++;
                        }
                        t.Commit();
                        res.Info("diag.frame", n + " муруй (4 шулуун + 4 нум), радиус 3 мм цаас, crop-оос 0.5 мм дотор");
                    }
                    Inspector.Export(doc, new List<ElementId> { v.Id }, L, res, st, "frame_fade_t80");
                }
                finally { tg.RollBack(); }
            }
            res.Add("diag.rolled_back", "PASS", "бүх өөрчлөлт буцаагдсан (TransactionGroup.RollBack)");
        }

        private static void Describe(Document doc, View v, ElementId id, double endX, ScenarioResult res, string tag)
        {
            var sd = doc.GetElement(id) as SpotDimension;
            if (sd == null) return;
            var parts = new List<string>();
            Func<XYZ, string> px = p => p == null ? "-" : U.F((p.X - endX) / U.Mm(Scale)) + "мм,z" + U.F(U.ToMm(p.Z) / Scale);
            try { parts.Add("shoulder=" + sd.LeaderHasShoulder); } catch (Exception ex) { parts.Add("shoulder?" + ex.Message); }
            try { parts.Add("end " + px(sd.LeaderEndPosition)); } catch { }
            try { parts.Add("bend " + px(sd.LeaderShoulderPosition)); } catch { }
            try { parts.Add("text " + px(sd.TextPosition)); } catch { }
            try { parts.Add("origin " + px(sd.Origin)); } catch { }
            BoundingBoxXYZ bb = sd.get_BoundingBox(v);
            if (bb != null)
            {
                // bbox нь харагдацын координатаар (дэлхийн X = харагдацын баруун) — end-ээс цаасны мм-ээр.
                parts.Add("bbox x " + U.F((bb.Min.X - endX) / U.Mm(Scale)) + " … " + U.F((bb.Max.X - endX) / U.Mm(Scale)) + " мм");
            }
            res.Info("diag." + tag + "." + id.Value, string.Join(" · ", parts));
        }

        private static double FaceZ(Element e, Reference r, double fallback)
        {
            try { var pf = e.GetGeometryObjectFromReference(r) as PlanarFace; if (pf != null) return pf.Origin.Z; } catch { }
            return fallback;
        }

        private static string SymbolName(Document doc, SpotDimensionType t)
        {
            try { Parameter p = t.get_Parameter(BuiltInParameter.SPOT_ELEV_SYMBOL); Element s = p != null ? doc.GetElement(p.AsElementId()) : null; return s != null ? s.Name : "-"; }
            catch { return "?"; }
        }

        private static string ParamText(Element e, BuiltInParameter bip)
        {
            try { Parameter p = e.get_Parameter(bip); return p == null ? "-" : (p.AsValueString() ?? p.AsInteger().ToString(CultureInfo.InvariantCulture)); } catch { return "?"; }
        }

        private static string Clean(string s)
        {
            var sb = new System.Text.StringBuilder();
            foreach (char c in s ?? "") sb.Append(char.IsLetterOrDigit(c) ? c : '_');
            return sb.ToString();
        }

        private static CurveLoop Rect(double xa, double ya, double xb, double yb, double z)
        {
            var p = new[] { new XYZ(xa, ya, z), new XYZ(xb, ya, z), new XYZ(xb, yb, z), new XYZ(xa, yb, z) };
            var loop = new CurveLoop();
            for (int i = 0; i < 4; i++) loop.Append(Line.CreateBound(p[i], p[(i + 1) % 4]));
            return loop;
        }

        /// <summary>Зүсэлтийн хавтгай (y = <paramref name="y"/>) дээрх тэгш өнцөгт — x, z.</summary>
        private static CurveLoop PlaneRect(double xa, double za, double xb, double zb, double y)
        {
            var p = new[] { new XYZ(xa, y, za), new XYZ(xb, y, za), new XYZ(xb, y, zb), new XYZ(xa, y, zb) };
            var loop = new CurveLoop();
            for (int i = 0; i < 4; i++) loop.Append(Line.CreateBound(p[i], p[(i + 1) % 4]));
            return loop;
        }

        private static List<Curve> RoundedRect(double xa, double za, double xb, double zb, double r, double y)
        {
            var list = new List<Curve>();
            XYZ X = XYZ.BasisX, Z = XYZ.BasisZ;
            list.Add(Line.CreateBound(new XYZ(xa + r, y, za), new XYZ(xb - r, y, za)));
            list.Add(Line.CreateBound(new XYZ(xb, y, za + r), new XYZ(xb, y, zb - r)));
            list.Add(Line.CreateBound(new XYZ(xb - r, y, zb), new XYZ(xa + r, y, zb)));
            list.Add(Line.CreateBound(new XYZ(xa, y, zb - r), new XYZ(xa, y, za + r)));
            list.Add(Arc.Create(new XYZ(xb - r, y, za + r), r, -Math.PI / 2, 0, X, Z));
            list.Add(Arc.Create(new XYZ(xb - r, y, zb - r), r, 0, Math.PI / 2, X, Z));
            list.Add(Arc.Create(new XYZ(xa + r, y, zb - r), r, Math.PI / 2, Math.PI, X, Z));
            list.Add(Arc.Create(new XYZ(xa + r, y, za + r), r, Math.PI, 1.5 * Math.PI, X, Z));
            return list;
        }

        private static ElementId WhiteType(Document doc)
        {
            List<FilledRegionType> all = new FilteredElementCollector(doc).OfClass(typeof(FilledRegionType)).Cast<FilledRegionType>().ToList();
            Func<ElementId, bool> solid = i => { var fe = doc.GetElement(i) as FillPatternElement; FillPattern fp = fe != null ? fe.GetFillPattern() : null; return fp != null && fp.IsSolidFill; };
            FilledRegionType b = all.FirstOrDefault(x => solid(x.ForegroundPatternId)) ?? all.First();
            var t = (FilledRegionType)b.Duplicate("GATE бүдэгрүүлэх");
            if (!solid(t.ForegroundPatternId))
                t.ForegroundPatternId = new FilteredElementCollector(doc).OfClass(typeof(FillPatternElement)).Cast<FillPatternElement>().First(f => f.GetFillPattern().IsSolidFill).Id;
            t.ForegroundPatternColor = new Color(255, 255, 255);
            try { t.BackgroundPatternId = ElementId.InvalidElementId; } catch { }
            t.IsMasking = false;
            return t.Id;
        }

        private static GraphicsStyle RedDash(Document doc)
        {
            Category lines = doc.Settings.Categories.get_Item(BuiltInCategory.OST_Lines);
            Category sub = doc.Settings.Categories.NewSubcategory(lines, "GATE улаан тасархай");
            sub.LineColor = new Color(220, 30, 30);
            sub.SetLineWeight(3, GraphicsStyleType.Projection);
            LinePatternElement dash = LinePatternElement.GetLinePatternElementByName(doc, "Dash")
                                      ?? new FilteredElementCollector(doc).OfClass(typeof(LinePatternElement)).Cast<LinePatternElement>().FirstOrDefault(l => l.Name.IndexOf("Dash", StringComparison.OrdinalIgnoreCase) >= 0);
            if (dash != null) sub.SetLinePatternId(dash.Id, GraphicsStyleType.Projection);
            return sub.GetGraphicsStyle(GraphicsStyleType.Projection);
        }
    }
}
