using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Autodesk.Revit.ApplicationServices;
using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Architecture;
using Autodesk.Revit.DB.Structure;

namespace MglWeGate
{
    /// <summary>
    /// Synthetic golden model-уудыг ТУХАЙН Revit хувилбарт шинээр үүсгэнэ (2024-ийнхийг 2024, 2027-ийнхийг 2027 дээр — хуучин Revit шинэ
    /// файлыг хэзээ ч нээхгүй).  Бүх файл run-ийн `models` хавтсанд; production файл оролцохгүй.  Үүсгэсэн элементийн id-г манифестэд
    /// бичнэ — сценари/шалгалт түүгээр «дээд давхрын элемент», «link-ийн өрөө» г.м.-ийг таньна (таамаглахгүй).
    /// </summary>
    internal sealed class ModelFactory
    {
        private readonly Application _app;
        private readonly GateJob _job;
        public readonly WarningSwallower Warnings = new WarningSwallower();
        public readonly Dictionary<string, object> Facts = new Dictionary<string, object>(StringComparer.Ordinal);

        public ModelFactory(Application app, GateJob job) { _app = app; _job = job; }

        private string Out(string file) { Directory.CreateDirectory(_job.ModelsDir); return Path.Combine(_job.ModelsDir, file); }

        // ── Архитектур ─────────────────────────────────────────────

        public string BuildArchitecture(Synth.Building spec, string file)
        {
            string path = Out(file);
            Document doc = _app.NewProjectDocument(_job.Template);
            try
            {
                Level l1, l2, l3;
                using (Transaction t = WarningSwallower.Start(doc, "gate: levels", Warnings))
                {
                    SetupLevels(doc, out l1, out l2, out l3);
                    t.Commit();
                }
                var levels = new Dictionary<string, Level> { { "L1", l1 }, { "L2", l2 }, { "L3", l3 } };
                var walls = new Dictionary<string, Wall>(StringComparer.Ordinal);
                using (Transaction t = WarningSwallower.Start(doc, "gate: walls", Warnings))
                {
                    var types = new Dictionary<double, WallType>();
                    foreach (Synth.WallDef w in spec.Walls)
                    {
                        Level lv = levels[w.Level];
                        Level top = w.Level == "L1" ? l2 : l3;
                        walls[w.Tag] = MakeWall(doc, WallTypeOf(doc, types, w.Width), lv, top,
                                                U.P(w.X0, w.Y0, Elev(w.Level)), U.P(w.X1, w.Y1, Elev(w.Level)));
                    }
                    if (spec.Name == "A")
                    {
                        // 104 — 30° эргэсэн павильон
                        WallType pt = WallTypeOf(doc, types, 200);
                        double[][] c = { new double[] { 0, 0 }, new double[] { 5000, 0 }, new double[] { 5000, 4000 }, new double[] { 0, 4000 } };
                        string[] tags = { "PAV-S", "PAV-E", "PAV-N", "PAV-W" };
                        for (int i = 0; i < 4; i++)
                        {
                            double[] a = c[i], b = c[(i + 1) % 4];
                            walls[tags[i]] = MakeWall(doc, pt, l1, l2, Synth.Pav104(a[0], a[1]), Synth.Pav104(b[0], b[1]));
                        }
                    }
                    t.Commit();
                }
                using (Transaction t = WarningSwallower.Start(doc, "gate: floors", Warnings))
                {
                    FloorType slab = FloorTypeOf(doc, "MGL gate slab 200", 200);
                    if (spec.Name == "A")
                    {
                        MakeFloor(doc, slab, l1, Rect(-150, -150, 24150, 12150, 0), 0);
                        MakeFloor(doc, slab, l2, Rect(-150, -150, 24150, 12150, Synth.L2), 0);
                    }
                    else MakeFloor(doc, slab, l1, Rect(-100, -100, 6100, 5100, 0), 0);
                    t.Commit();
                }
                using (Transaction t = WarningSwallower.Start(doc, "gate: doors and windows", Warnings))
                {
                    FamilySymbol door = SymbolOf(doc, BuiltInCategory.OST_Doors, Lib("Doors", "Commercial", "M_Door-Passage-Single-Flush.rfa"));
                    FamilySymbol window = SymbolOf(doc, BuiltInCategory.OST_Windows, Lib("Windows", "M_Instance-Window-Fixed.rfa"));
                    var inserts = new List<Synth.InsertDef>(spec.Inserts);
                    foreach (Synth.InsertDef d in inserts)
                    {
                        Wall host;
                        if (!walls.TryGetValue(d.WallTag, out host)) { GateLog.Warn("insert: хана алга " + d.WallTag); continue; }
                        Level lv = doc.GetElement(host.LevelId) as Level;
                        Place(doc, d.Kind == "door" ? door : window, host, lv, U.P(d.X, d.Y, lv.Elevation * 304.8));
                    }
                    if (spec.Name == "A")
                    {
                        Place(doc, door, walls["PAV-S"], l1, Synth.Pav104(2500, 0));
                        Place(doc, window, walls["PAV-E"], l1, Synth.Pav104(5000, 2000));
                    }
                    t.Commit();
                }
                var roomIds = new List<string>();
                using (Transaction t = WarningSwallower.Start(doc, "gate: rooms", Warnings))
                {
                    doc.Regenerate();
                    foreach (Synth.RoomDef rd in spec.Rooms)
                    {
                        Level lv = levels[rd.Level];
                        XYZ at = rd.Number == "104" ? Synth.Pav104(2500, 2000) : U.P(rd.X, rd.Y);
                        Room r = doc.Create.NewRoom(lv, new UV(at.X, at.Y));
                        r.Number = rd.Number;
                        r.get_Parameter(BuiltInParameter.ROOM_NAME).Set(rd.Name);
                        if (rd.UpperLimitL2)
                        {
                            r.get_Parameter(BuiltInParameter.ROOM_UPPER_LEVEL).Set(l2.Id);
                            r.get_Parameter(BuiltInParameter.ROOM_UPPER_OFFSET).Set(0.0);
                        }
                        else
                        {
                            r.get_Parameter(BuiltInParameter.ROOM_UPPER_LEVEL).Set(lv.Id);
                            r.get_Parameter(BuiltInParameter.ROOM_UPPER_OFFSET).Set(U.Mm(rd.LimitOffset));
                        }
                        roomIds.Add(rd.Number + "=" + r.Id.Value);
                        ViewPlan plan = PlanOf(doc, lv);
                        if (plan != null) doc.Create.NewRoomTag(new LinkElementId(r.Id), new UV(at.X, at.Y), plan.Id);
                    }
                    t.Commit();
                }
                // Өрөө бүр хүрээлэгдсэн эсэх — үүсгэгч өөрөө баталгаажна (буруу загвар дээр тест утгагүй).
                foreach (Room r in new FilteredElementCollector(doc).OfCategory(BuiltInCategory.OST_Rooms).Cast<Room>())
                    if (!(r.Area > 1e-6)) GateLog.Error("model " + spec.Name + ": өрөө " + r.Number + " хүрээлэгдээгүй (area 0)");
                    else GateLog.Info("model " + spec.Name + ": өрөө " + r.Number + " area=" + U.F(r.Area * 0.09290304) + " м²");
                Facts["arch_" + spec.Name + "_rooms"] = string.Join(";", roomIds);
                doc.SaveAs(path, new SaveAsOptions { OverwriteExistingFile = true });
                GateLog.Info("saved " + path);
            }
            finally { doc.Close(false); }
            return path;
        }

        // ── Интерьер (host) ────────────────────────────────────────

        public string BuildInterior(string archA, string archB)
        {
            string path = Out("Interior_Test.rvt");
            Document doc = _app.NewProjectDocument(_job.Template);
            try
            {
                Level l1, l2, l3;
                using (Transaction t = WarningSwallower.Start(doc, "gate: levels", Warnings))
                {
                    SetupLevels(doc, out l1, out l2, out l3);
                    t.Commit();
                }
                RevitLinkInstance la, lb, lb2;
                using (Transaction t = WarningSwallower.Start(doc, "gate: links", Warnings))
                {
                    ElementId ta = RevitLinkType.Create(doc, ModelPathUtils.ConvertUserVisiblePathToModelPath(archA), new RevitLinkOptions(false)).ElementId;
                    ElementId tb = RevitLinkType.Create(doc, ModelPathUtils.ConvertUserVisiblePathToModelPath(archB), new RevitLinkOptions(false)).ElementId;
                    la = PlaceLink(doc, ta, Synth.LinkA);
                    lb = PlaceLink(doc, tb, Synth.LinkB);
                    lb2 = PlaceLink(doc, tb, Synth.LinkB2);
                    t.Commit();
                }
                Facts["link_A"] = la.Id.Value;
                Facts["link_B"] = lb.Id.Value;
                Facts["link_B2"] = lb2.Id.Value;

                var upper = new List<long>();
                var lower = new List<long>();
                Func<double, double, double, XYZ> A = (x, y, z) => Synth.LinkA.ToHost(x, y, z);
                using (Transaction t = WarningSwallower.Start(doc, "gate: interior finishes", Warnings))
                {
                    var types = new Dictionary<double, WallType>();
                    WallType fin = WallTypeOf(doc, types, Synth.FinishW);
                    // 101: хойд (P2) ба зүүн (P1) дотор нүүрэнд 20 мм өнгөлгөөний хана, тааз хүртэл.
                    lower.Add(MakeWall(doc, fin, l1, null, A(150, 4930, 0), A(5940, 4930, 0), 2700).Id.Value);
                    lower.Add(MakeWall(doc, fin, l1, null, A(5930, 150, 0), A(5930, 4940, 0), 2700).Id.Value);
                    // 102: урд гадна хананы дотор нүүрэнд.
                    lower.Add(MakeWall(doc, fin, l1, null, A(6060, 160, 0), A(13940, 160, 0), 2800).Id.Value);

                    CeilingType ct = new FilteredElementCollector(doc).OfClass(typeof(CeilingType)).Cast<CeilingType>().FirstOrDefault();
                    if (ct != null)
                    {
                        lower.Add(MakeCeiling(doc, ct, l1, Poly(A, 0, 150, 150, 5920, 150, 5920, 4920, 150, 4920), 2700));
                        lower.Add(MakeCeiling(doc, ct, l1, Poly(A, 0, 6060, 150, 13940, 150, 13940, 4940, 9940, 4940, 9940, 7940, 6060, 7940), 2800));
                    }
                    else GateLog.Warn("CeilingType алга — тааз үүсгэсэнгүй");

                    // Дээд айлын өнгөлгөөний шал (L2 … L2 + 50) — WE-BUG-001: доод өрөөний дэлгээст ОРОХ ЁСГҮЙ.
                    FloorType f50 = FloorTypeOf(doc, "MGL gate finish floor 50", 50);
                    long upperFinish = MakeFloor(doc, f50, l2, Poly(A, Synth.L2, 150, 150, 5940, 150, 5940, 4940, 150, 4940), 50);
                    upper.Add(upperFinish);

                    // W08 (2026-10-16): 201A (L2, дотор нүүр x 150–2940, y 150–4940; өөр сценари ашигладаггүй) — бодит нүүрээр шалгах шал, тааз.
                    // Суурь шал = дээрх өнгөлгөөний шал (+50); хойд 1.2 м-т тавцан +150; урд хагаст тэгш тааз 2700, хойд хагаст НАЛУУ тааз 2400 →
                    // (y 4940) ≈ 2807.  Бүгд L2-оос дээш — 101-ийн дэлгээсийн хүрээ (L2 дээр ЯГ зогсдог) тэдгээрт хүрэхгүй.
                    Facts["surf_floor_base"] = upperFinish;
                    FloorType f150 = FloorTypeOf(doc, "MGL gate platform 150", 150);
                    Facts["surf_floor_platform"] = MakeFloor(doc, f150, l2, Poly(A, Synth.L2, 150, 3740, 2940, 3740, 2940, 4940, 150, 4940), 150);
                    if (ct != null)
                    {
                        Facts["surf_ceiling_flat"] = MakeCeiling(doc, ct, l2, Poly(A, Synth.L2, 150, 150, 2940, 150, 2940, 2500, 150, 2500), 2700);
                        Facts["surf_ceiling_sloped"] = MakeSlopedCeiling(doc, ct, l2, Poly(A, Synth.L2, 150, 2500, 2940, 2500, 2940, 4940, 150, 4940),
                                                                         Line.CreateBound(A(1500, 2500, Synth.L2), A(1500, 4940, Synth.L2)), 1.0 / 6.0, 2400);
                    }
                    t.Commit();
                }
                LogSlabFaces(doc, "surf_ceiling_sloped");
                LogSlabFaces(doc, "surf_ceiling_flat");
                LogSlabFaces(doc, "surf_floor_platform");
                using (Transaction t = WarningSwallower.Start(doc, "gate: furniture", Warnings))
                {
                    FamilySymbol desk = SymbolOf(doc, BuiltInCategory.OST_Furniture, Lib("Furniture", "Tables", "M_Desk.rfa"));
                    FamilySymbol chair = SymbolOf(doc, BuiltInCategory.OST_Furniture, Lib("Furniture", "Seating", "M_Chair-Desk.rfa"), "Chair");
                    FamilySymbol cab = SymbolOf(doc, BuiltInCategory.OST_Casework, Lib("Casework", "Base Cabinets", "M_Base Cabinet-Single Door.rfa"));
                    // L1 — 101 доторх тавилга (host)
                    lower.Add(Free(doc, desk, l1, A(1200, 2500, 0)));
                    lower.Add(Free(doc, chair, l1, A(2200, 2500, 0)));
                    lower.Add(Free(doc, cab, l1, A(3000, 4600, 0)));
                    lower.Add(Box(doc, BuiltInCategory.OST_LightingFixtures, A, 2700, 2200, 3300, 2800, 2620, 2700, "gate light 101"));
                    // L2 — 101-ийн яг дээрх айл (WE-BUG-001-ийн ГОО ЗОРИЛТ)
                    upper.Add(Free(doc, desk, l2, A(1500, 4300, Synth.L2)));
                    upper.Add(Free(doc, cab, l2, A(4500, 450, Synth.L2)));
                    upper.Add(Free(doc, chair, l2, A(600, 2500, Synth.L2)));
                    // Жижиг цухуйсан геометр: дээд давхрын шалнаас 30 мм доош, 400 мм дээш.
                    upper.Add(Box(doc, BuiltInCategory.OST_GenericModel, A, 2500, 2000, 3500, 3000, Synth.L2 - 30, Synth.L2 + 400, "gate upper protrusion"));
                    t.Commit();
                }
                Facts["upper_storey_host_ids"] = string.Join(",", upper.Where(i => i > 0));
                Facts["lower_storey_host_ids"] = string.Join(",", lower.Where(i => i > 0));

                ViewPlan p1 = PlanOf(doc, l1), p2 = PlanOf(doc, l2);
                using (Transaction t = WarningSwallower.Start(doc, "gate: room tags", Warnings))
                {
                    int n = 0;
                    foreach (RevitLinkInstance li in new[] { la, lb, lb2 })
                    {
                        Document ld = li.GetLinkDocument();
                        if (ld == null) { GateLog.Error("link ачаалагдаагүй: " + li.Name); continue; }
                        Transform tf = li.GetTotalTransform();
                        foreach (Room r in new FilteredElementCollector(ld).OfCategory(BuiltInCategory.OST_Rooms).Cast<Room>())
                        {
                            var lp = r.Location as LocationPoint;
                            if (lp == null || !(r.Area > 1e-6)) continue;
                            ViewPlan plan = Math.Abs(r.Level.Elevation - U.Mm(Synth.L2)) < 0.01 ? p2 : p1;
                            if (plan == null) continue;
                            XYZ h = tf.OfPoint(lp.Point);
                            doc.Create.NewRoomTag(new LinkElementId(li.Id, r.Id), new UV(h.X, h.Y), plan.Id);
                            n++;
                        }
                    }
                    Facts["linked_room_tags"] = n;
                    // Үндсэн барилгын орчим crop (B ба B2 хол — viewport асар том болохгүй).
                    foreach (ViewPlan p in new[] { p1, p2 }.Where(p => p != null)) CropTo(p, A(-3000, -3000, 0), A(47000, 15000, 0));
                    t.Commit();
                }
                using (Transaction t = WarningSwallower.Start(doc, "gate: X plan, sheet, template", Warnings))
                {
                    // Room Reference (X) ба Interior Fill харагддаг план — эзний дэлгэцийн зурган дээрх «X» (link-ийн өрөө, By Host View).
                    var px = doc.GetElement(p1.Duplicate(ViewDuplicateOption.WithDetailing)) as ViewPlan;
                    px.Name = "L1 - ROOM REFERENCE (X)";
                    ShowRoomReference(doc, px);
                    Facts["plan_x"] = px.Id.Value;
                    Facts["plan_l1"] = p1.Id.Value;
                    Facts["plan_l2"] = p2 != null ? p2.Id.Value : -1;

                    FamilySymbol tb = SymbolOf(doc, BuiltInCategory.OST_TitleBlocks, Lib("Titleblocks", "A1 metric.rfa"));
                    ViewSheet sheet = ViewSheet.Create(doc, tb != null ? tb.Id : ElementId.InvalidElementId);
                    sheet.SheetNumber = "ИЗД1_101";
                    sheet.Name = "1-Р ДАВХРЫН ТАВИЛГЫН ЗУРАГ";
                    Viewport.Create(doc, sheet.Id, p1.Id, new XYZ(U.Mm(420), U.Mm(300), 0));
                    Facts["sheet_plan"] = sheet.Id.Value;

                    View elev = new FilteredElementCollector(doc).OfClass(typeof(View)).Cast<View>()
                        .FirstOrDefault(v => !v.IsTemplate && v.ViewType == ViewType.Elevation);
                    if (elev != null)
                    {
                        View tpl = elev.CreateViewTemplate();
                        tpl.Name = "4.2. Дотор Дэлгээс (тест)";
                        Facts["view_template"] = tpl.Id.Value;
                    }
                    t.Commit();
                }
                doc.SaveAs(path, new SaveAsOptions { OverwriteExistingFile = true });
                GateLog.Info("saved " + path);
            }
            finally { doc.Close(false); }
            return path;
        }

        // ── Туслах ─────────────────────────────────────────────────

        private static double Elev(string level) { return level == "L2" ? Synth.L2 : level == "L3" ? Synth.L3 : 0; }

        private string Lib(params string[] parts)
        {
            if (string.IsNullOrEmpty(_job.Library)) return null;
            string p = Path.Combine(new[] { _job.Library }.Concat(parts).ToArray());
            return File.Exists(p) ? p : null;
        }

        private static void SetupLevels(Document doc, out Level l1, out Level l2, out Level l3)
        {
            List<Level> levels = new FilteredElementCollector(doc).OfClass(typeof(Level)).Cast<Level>().OrderBy(l => l.Elevation).ToList();
            l1 = levels.Count > 0 ? levels[0] : Level.Create(doc, 0);
            l2 = levels.Count > 1 ? levels[1] : Level.Create(doc, U.Mm(Synth.L2));
            l3 = levels.Count > 2 ? levels[2] : Level.Create(doc, U.Mm(Synth.L3));
            for (int i = 3; i < levels.Count; i++) { try { doc.Delete(levels[i].Id); } catch { } }
            l3.Elevation = U.Mm(Synth.L3);
            l2.Elevation = U.Mm(Synth.L2);
            l1.Elevation = 0;
            l1.Name = "L1"; l2.Name = "L2"; l3.Name = "L3";
            ViewFamilyType fp = new FilteredElementCollector(doc).OfClass(typeof(ViewFamilyType)).Cast<ViewFamilyType>()
                .First(t => t.ViewFamily == ViewFamily.FloorPlan);
            foreach (Level lv in new[] { l1, l2, l3 })
            {
                ViewPlan p = PlanOf(doc, lv) ?? ViewPlan.Create(doc, fp.Id, lv.Id);
                try { p.Name = lv.Name; } catch { }
            }
        }

        private static ViewPlan PlanOf(Document doc, Level lv)
        {
            return new FilteredElementCollector(doc).OfClass(typeof(ViewPlan)).Cast<ViewPlan>()
                .FirstOrDefault(v => !v.IsTemplate && v.ViewType == ViewType.FloorPlan && v.GenLevel != null && v.GenLevel.Id == lv.Id);
        }

        private static WallType WallTypeOf(Document doc, Dictionary<double, WallType> cache, double widthMm)
        {
            WallType wt;
            if (cache.TryGetValue(widthMm, out wt)) return wt;
            WallType basic = OneLayerFirst(new FilteredElementCollector(doc).OfClass(typeof(WallType)).Cast<WallType>().Where(t => t.Kind == WallKind.Basic));
            wt = (WallType)basic.Duplicate("MGL gate wall " + widthMm);
            SetSingleLayer(wt, U.Mm(widthMm));
            cache[widthMm] = wt;
            return wt;
        }

        private static FloorType FloorTypeOf(Document doc, string name, double thicknessMm)
        {
            FloorType ft = new FilteredElementCollector(doc).OfClass(typeof(FloorType)).Cast<FloorType>().FirstOrDefault(t => t.Name == name);
            if (ft != null) return ft;
            FloorType basic = OneLayerFirst(new FilteredElementCollector(doc).OfClass(typeof(FloorType)).Cast<FloorType>().Where(t => !t.IsFoundationSlab));
            ft = (FloorType)basic.Duplicate(name);
            SetSingleLayer(ft, U.Mm(thicknessMm));
            return ft;
        }

        /// <summary>Нэг давхаргатай (Generic) төрлийг түрүүлж — ХЭМЖСЭН (Revit 2024): шинээр CreateSingleLayerCompoundStructure хийсэн бүтцийг
        /// ханын төрөл «wrong EndCap condition»-оор татгалздаг; байгаа бүтцийн давхаргын зузааныг л солино.</summary>
        private static T OneLayerFirst<T>(IEnumerable<T> types) where T : HostObjAttributes
        {
            List<T> list = types.ToList();
            return list.FirstOrDefault(t => { CompoundStructure c = t.GetCompoundStructure(); return c != null && c.LayerCount == 1; }) ?? list.First();
        }

        private static void SetSingleLayer(HostObjAttributes type, double widthFt)
        {
            CompoundStructure cs = type.GetCompoundStructure();
            if (cs.LayerCount == 1) cs.SetLayerWidth(0, widthFt);
            else
            {
                int si = cs.StructuralMaterialIndex >= 0 ? cs.StructuralMaterialIndex : 0;
                ElementId mat = cs.GetMaterialId(si);
                cs.SetNumberOfShellLayers(ShellLayerType.Exterior, 0);
                cs.SetNumberOfShellLayers(ShellLayerType.Interior, 0);
                cs.SetLayers(new List<CompoundStructureLayer> { new CompoundStructureLayer(widthFt, MaterialFunctionAssignment.Structure, mat) });
                cs.StructuralMaterialIndex = 0;
            }
            type.SetCompoundStructure(cs);
        }

        private static Wall MakeWall(Document doc, WallType type, Level lv, Level top, XYZ a, XYZ b, double heightMm = 3300)
        {
            Wall w = Wall.Create(doc, Line.CreateBound(a, b), type.Id, lv.Id, U.Mm(heightMm), 0, false, false);
            if (top != null)
            {
                w.get_Parameter(BuiltInParameter.WALL_HEIGHT_TYPE).Set(top.Id);
                w.get_Parameter(BuiltInParameter.WALL_TOP_OFFSET).Set(0.0);
            }
            return w;
        }

        private static long MakeFloor(Document doc, FloorType type, Level lv, CurveLoop loop, double topOffsetMm)
        {
            Floor f = Floor.Create(doc, new List<CurveLoop> { loop }, type.Id, lv.Id);
            if (Math.Abs(topOffsetMm) > 1e-9) f.get_Parameter(BuiltInParameter.FLOOR_HEIGHTABOVELEVEL_PARAM).Set(U.Mm(topOffsetMm));
            return f.Id.Value;
        }

        private static long MakeCeiling(Document doc, CeilingType type, Level lv, CurveLoop loop, double heightMm)
        {
            Ceiling c = Ceiling.Create(doc, new List<CurveLoop> { loop }, type.Id, lv.Id);
            c.get_Parameter(BuiltInParameter.CEILING_HEIGHTABOVELEVEL_PARAM).Set(U.Mm(heightMm));
            return c.Id.Value;
        }

        /// <summary>W08: налуу тааз (налуугийн сум, налуу = өндөр/урт) — сумын эхэнд <paramref name="heightMm"/>.  Revit 2022+ API.</summary>
        private static long MakeSlopedCeiling(Document doc, CeilingType type, Level lv, CurveLoop loop, Line arrow, double slope, double heightMm)
        {
            Ceiling c = Ceiling.Create(doc, new List<CurveLoop> { loop }, type.Id, lv.Id, arrow, slope);
            c.get_Parameter(BuiltInParameter.CEILING_HEIGHTABOVELEVEL_PARAM).Set(U.Mm(heightMm));
            return c.Id.Value;
        }

        /// <summary>Шалгалтын лог: элементийн дээд/доод нүүрүүдийн нормаль, өндөр (хүлээгдэж буй налуу/өндөр бодитоор үүссэн эсэх).</summary>
        private void LogSlabFaces(Document doc, string fact)
        {
            object v;
            if (!Facts.TryGetValue(fact, out v)) return;
            var ho = doc.GetElement(new ElementId(Convert.ToInt64(v))) as HostObject;
            if (ho == null) { GateLog.Warn(fact + ": элемент алга"); return; }
            var parts = new List<string>();
            foreach (bool top in new[] { true, false })
            {
                IList<Reference> refs;
                try { refs = top ? HostObjectUtils.GetTopFaces(ho) : HostObjectUtils.GetBottomFaces(ho); } catch { continue; }
                foreach (Reference r in refs)
                {
                    var pf = ho.GetGeometryObjectFromReference(r) as PlanarFace;
                    if (pf == null) { parts.Add((top ? "дээд" : "доод") + " муруй"); continue; }
                    BoundingBoxUV bb = pf.GetBoundingBox();
                    XYZ a = pf.Evaluate(bb.Min), b = pf.Evaluate(bb.Max);
                    parts.Add((top ? "дээд" : "доод") + " n=(" + U.F(pf.FaceNormal.X) + "," + U.F(pf.FaceNormal.Y) + "," + U.F(pf.FaceNormal.Z) + ") z "
                              + U.F(a.Z * 304.8) + "…" + U.F(b.Z * 304.8) + " мм");
                }
            }
            GateLog.Info("model: " + fact + " #" + v + " — " + string.Join("; ", parts));
        }

        private static CurveLoop Rect(double x0, double y0, double x1, double y1, double zMm)
        {
            return Loop(new[] { U.P(x0, y0, zMm), U.P(x1, y0, zMm), U.P(x1, y1, zMm), U.P(x0, y1, zMm) });
        }

        private static CurveLoop Poly(Func<double, double, double, XYZ> tf, double zMm, params double[] xy)
        {
            var pts = new List<XYZ>();
            for (int i = 0; i + 1 < xy.Length; i += 2) pts.Add(tf(xy[i], xy[i + 1], zMm));
            return Loop(pts);
        }

        private static CurveLoop Loop(IList<XYZ> pts)
        {
            var loop = new CurveLoop();
            for (int i = 0; i < pts.Count; i++) loop.Append(Line.CreateBound(pts[i], pts[(i + 1) % pts.Count]));
            return loop;
        }

        private FamilySymbol SymbolOf(Document doc, BuiltInCategory cat, string libPath, string nameHint = null)
        {
            FamilySymbol s = null;
            if (libPath != null)
            {
                Family f;
                string fam = Path.GetFileNameWithoutExtension(libPath);
                if (!doc.LoadFamily(libPath, out f))
                    f = new FilteredElementCollector(doc).OfClass(typeof(Family)).Cast<Family>().FirstOrDefault(x => x.Name == fam);
                if (f != null)
                    s = f.GetFamilySymbolIds().Select(id => doc.GetElement(id) as FamilySymbol).Where(x => x != null)
                         .OrderBy(x => nameHint != null && x.Name.IndexOf(nameHint, StringComparison.OrdinalIgnoreCase) >= 0 ? 0 : 1).FirstOrDefault();
            }
            if (s == null)
                s = new FilteredElementCollector(doc).OfClass(typeof(FamilySymbol)).OfCategory(cat).Cast<FamilySymbol>().FirstOrDefault();
            if (s == null) { GateLog.Warn("family алга: " + cat + " (" + (libPath ?? "сан тохируулаагүй") + ")"); return null; }
            if (!s.IsActive) { s.Activate(); doc.Regenerate(); }
            GateLog.Info("family " + cat + ": " + s.FamilyName + " / " + s.Name);
            return s;
        }

        private static void Place(Document doc, FamilySymbol sym, Wall host, Level lv, XYZ at)
        {
            if (sym == null || host == null) return;
            try { doc.Create.NewFamilyInstance(at, sym, host, lv, StructuralType.NonStructural); }
            catch (Exception ex) { GateLog.Warn("insert " + sym.FamilyName + " — " + ex.Message); }
        }

        private static long Free(Document doc, FamilySymbol sym, Level lv, XYZ at)
        {
            if (sym == null) return -1;
            try { return doc.Create.NewFamilyInstance(new XYZ(at.X, at.Y, lv.Elevation), sym, lv, StructuralType.NonStructural).Id.Value; }
            catch (Exception ex) { GateLog.Warn("instance " + sym.FamilyName + " — " + ex.Message); return -1; }
        }

        /// <summary>DirectShape хайрцаг — дизайн координатаар (link A-гийн хувиргалттай), тухайн ангилалд.</summary>
        private static long Box(Document doc, BuiltInCategory cat, Func<double, double, double, XYZ> tf,
                                double x0, double y0, double x1, double y1, double z0, double z1, string name)
        {
            try
            {
                CurveLoop loop = Loop(new[] { tf(x0, y0, z0), tf(x1, y0, z0), tf(x1, y1, z0), tf(x0, y1, z0) });
                Solid s = GeometryCreationUtilities.CreateExtrusionGeometry(new List<CurveLoop> { loop }, XYZ.BasisZ, U.Mm(z1 - z0));
                DirectShape ds = DirectShape.CreateElement(doc, new ElementId(cat));
                ds.ApplicationId = "MGL.WeGate";
                ds.ApplicationDataId = name;
                ds.SetShape(new List<GeometryObject> { s });
                ds.SetName(name);
                return ds.Id.Value;
            }
            catch (Exception ex) { GateLog.Warn("directshape " + name + " — " + ex.Message); return -1; }
        }

        private static RevitLinkInstance PlaceLink(Document doc, ElementId typeId, Synth.Placement p)
        {
            RevitLinkInstance li = RevitLinkInstance.Create(doc, typeId);
            if (Math.Abs(p.PreX) + Math.Abs(p.PreY) > 0) ElementTransformUtils.MoveElement(doc, li.Id, U.P(p.PreX, p.PreY));
            if (Math.Abs(p.AngleDeg) > 1e-9)
                ElementTransformUtils.RotateElement(doc, li.Id, Line.CreateBound(XYZ.Zero, XYZ.BasisZ), p.AngleDeg * Math.PI / 180);
            if (Math.Abs(p.PostX) + Math.Abs(p.PostY) > 0) ElementTransformUtils.MoveElement(doc, li.Id, U.P(p.PostX, p.PostY));
            GateLog.Info("link " + p.Name + ": " + li.Name + " angle=" + p.AngleDeg);
            return li;
        }

        private static void CropTo(ViewPlan p, XYZ a, XYZ b)
        {
            BoundingBoxXYZ cb = p.CropBox;
            cb.Min = new XYZ(Math.Min(a.X, b.X), Math.Min(a.Y, b.Y), cb.Min.Z);
            cb.Max = new XYZ(Math.Max(a.X, b.X), Math.Max(a.Y, b.Y), cb.Max.Z);
            p.CropBox = cb;
            p.CropBoxActive = true;
        }

        /// <summary>
        /// ХЭМЖСЭН (Revit 2024, 2026-10-13): `SetCategoryHidden(new ElementId(OST_RoomReference))` → «Category cannot be hidden».  Rooms-ийн
        /// дэд ангиллыг нэрээр нь (Interior Fill, Reference) олж, view template-ийг тайлаад асаана; бүгдийг логлоно.
        /// </summary>
        private static void ShowRoomReference(Document doc, View v)
        {
            try { v.ViewTemplateId = ElementId.InvalidElementId; } catch { }
            Category rooms = Category.GetCategory(doc, BuiltInCategory.OST_Rooms);
            foreach (Category sub in rooms.SubCategories)
            {
                bool can = v.CanCategoryBeHidden(sub.Id);
                bool hidden = v.GetCategoryHidden(sub.Id);
                GateLog.Info("rooms subcategory «" + sub.Name + "» id=" + sub.Id.Value + " canHide=" + can + " hidden=" + hidden);
                if ((sub.Name.IndexOf("Interior", StringComparison.OrdinalIgnoreCase) >= 0 || sub.Name.IndexOf("Reference", StringComparison.OrdinalIgnoreCase) >= 0) && hidden)
                {
                    try { v.SetCategoryHidden(sub.Id, false); GateLog.Info("   → асаав"); }
                    catch (Exception ex) { GateLog.Warn("   → асааж чадсангүй: " + ex.Message); }
                }
            }
        }

        private static void TryUnhide(View v, BuiltInCategory cat)
        {
            try { v.SetCategoryHidden(new ElementId(cat), false); }
            catch (Exception ex) { GateLog.Warn("unhide " + cat + " — " + ex.Message); }
        }
    }
}
