using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Text;
using Autodesk.Revit.ApplicationServices;
using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Architecture;
using Autodesk.Revit.DB.Structure;
using Autodesk.Revit.UI;
using RevitMcpAddin.Intelligence.Contracts;
using RevitMcpAddin.Intelligence.Core;

namespace RevitMcpAddin.Intelligence.Revit
{
    /// <summary>
    /// СИНТЕТИК ТЕСТ ЗАГВАРЫН ҮҮСГЭГЧ — DEVELOPMENT / TEST ONLY · NON-PRODUCTION.
    ///
    /// ⚠️ ЭНЭ БОЛ ХЯНАЛТТАЙ ТЕСТИЙН БИЧИЛТ, ирээдүйн MGL AI-ийн үйлдлийн систем
    ///    БИШ (§46–49-ийн typed action энд хамаарахгүй).  Гэхдээ ИЖИЛ гарцаар
    ///    явна: `RevitToolBus` → `RevitTools.Run` → энд, Revit-ийн `Transaction`
    ///    дотор (R-2).  Өөр ExternalEvent БАЙХГҮЙ.
    ///
    /// ⚠️ АЮУЛГҮЙН ХААЛТ (`Gate`): загварын агуулгатай баримтад ХЭЗЭЭ Ч
    ///    ажиллахгүй — файлын нэр «test» байсан ч.  Зөвшөөрөгдөх нь:
    ///    (а) `ProjectInformation.Name` тэмдэгтэй (энэ л үүсгэгчийн бичсэн),
    ///    (б) хадгалаагүй ХООСОН төсөл, (в) хадгалсан ХООСОН + ил зөвшөөрлийн
    ///    токен.  Гурвуулаа «хоосон» шаардана.
    ///
    /// Хэмжээс (мм, детерминист): гадна 10000×8000, Level 2 = 3000, хана
    /// өндөр 3000; коридор урд талд 2000 гүн; дотор хана x=5000 (y 2000→8000).
    ///   Room 101 = баруун (x 0–5000, y 2000–8000) · Room 102 = зүүн
    ///   Corridor = урд (x 0–10000, y 0–2000).
    /// </summary>
    internal static class TestModelFixture
    {
        private const double WidthMm = 10000, DepthMm = 8000, HeightMm = 3000, CorridorMm = 2000, DividerXMm = 5000;

        private static readonly BuiltInCategory[] ContentCategories =
        {
            BuiltInCategory.OST_Walls, BuiltInCategory.OST_Floors, BuiltInCategory.OST_Rooms, BuiltInCategory.OST_Doors,
            BuiltInCategory.OST_Windows, BuiltInCategory.OST_Roofs, BuiltInCategory.OST_Columns, BuiltInCategory.OST_StructuralColumns,
            BuiltInCategory.OST_StructuralFraming, BuiltInCategory.OST_Ceilings, BuiltInCategory.OST_Stairs,
            BuiltInCategory.OST_GenericModel, BuiltInCategory.OST_Furniture, BuiltInCategory.OST_MechanicalEquipment,
            BuiltInCategory.OST_DuctCurves, BuiltInCategory.OST_PipeCurves, BuiltInCategory.OST_RvtLinks,
        };

        private static double Ft(double mm) => UnitsBoundary.MmToFeet(mm);

        /* ============================================================== */
        /*  ХААЛТ                                                          */
        /* ============================================================== */

        internal static bool IsTestMarked(Document doc)
        {
            try
            {
                string n = doc.ProjectInformation != null ? doc.ProjectInformation.Name : null;
                return n != null && n.StartsWith("MGL-AI-TEST", StringComparison.Ordinal);
            }
            catch { return false; }
        }

        internal static int ModelElementCount(Document doc)
        {
            int n = 0;
            foreach (BuiltInCategory bic in ContentCategories)
            {
                try { n += new FilteredElementCollector(doc).OfCategory(bic).WhereElementIsNotElementType().GetElementCount(); }
                catch { }
            }
            return n;
        }

        internal static TestModelGate Gate(Document doc, string confirm)
        {
            var g = new TestModelGate();
            if (doc == null) { g.Reason = TestModelGateReason.REFUSED_NO_DOCUMENT; return g; }
            g.DocKey = DocKeys.Normalize(RevitTools.DocUid(doc));
            if (doc.IsFamilyDocument) { g.Reason = TestModelGateReason.REFUSED_FAMILY_DOCUMENT; return g; }
            if (doc.IsLinked) { g.Reason = TestModelGateReason.REFUSED_LINKED_DOCUMENT; return g; }
            if (doc.IsWorkshared) { g.Reason = TestModelGateReason.REFUSED_WORKSHARED; return g; }
            if (doc.IsReadOnly) { g.Reason = TestModelGateReason.REFUSED_READ_ONLY; return g; }
            g.IsTestMarked = IsTestMarked(doc);
            g.IsUnsaved = string.IsNullOrEmpty(doc.PathName);
            g.ModelElementCount = ModelElementCount(doc);
            // ⚠️ ХООСОН БИШ бол ЯМАР Ч нөхцөлд татгалзана — тэмдэгтэй байсан ч дахин
            //    үүсгэхгүй (давхар барилга гарна), файлын нэр «test» гэсэн ч итгэхгүй.
            if (g.ModelElementCount > 0) { g.Reason = TestModelGateReason.REFUSED_HAS_MODEL_CONTENT; return g; }
            if (g.IsTestMarked) { g.Allowed = true; g.Reason = TestModelGateReason.ALLOWED_TEST_MARKED; return g; }
            if (g.IsUnsaved) { g.Allowed = true; g.Reason = TestModelGateReason.ALLOWED_BLANK_UNSAVED; return g; }
            if (string.Equals(confirm, TestModel.ConfirmToken, StringComparison.Ordinal)) { g.Allowed = true; g.Reason = TestModelGateReason.ALLOWED_BLANK_CONFIRMED; return g; }
            g.Reason = TestModelGateReason.REFUSED_SAVED_UNMARKED_NO_CONFIRM;
            return g;
        }

        /* ============================================================== */
        /*  ҮҮСГЭЛТ                                                        */
        /* ============================================================== */

        internal static TestModelManifest Create(UIApplication app, string confirm)
        {
            Document doc = app.ActiveUIDocument != null ? app.ActiveUIDocument.Document : null;
            TestModelGate gate = Gate(doc, confirm);
            if (!gate.Allowed) throw new InvalidOperationException("TEST_MODEL_REFUSED: " + gate.Reason);

            var sw = Stopwatch.StartNew();
            var m = new TestModelManifest
            {
                Document = doc.Title,
                DocKey = gate.DocKey,
                RevitVersion = doc.Application.VersionNumber,
                CreatedAt = DateTime.UtcNow.ToString("o"),
            };

            using (var t = new Transaction(doc, "MGL AI Test Model (SYNTHETIC)"))
            {
                t.Start();
                try
                {
                    // ─── Тэмдэг ───
                    try { doc.ProjectInformation.Name = TestModel.ProjectInfoMarker; } catch { m.States.Add("PROJECT_INFO_MARK_FAILED"); }

                    // ─── Давхар ───
                    Level l1 = FindLevelNear(doc, 0), l2 = FindLevelNear(doc, HeightMm);
                    if (l1 == null) { l1 = Level.Create(doc, 0); TrySetName(l1, "MGL-AI Level 1"); m.States.Add("LEVEL1_CREATED"); }
                    else m.States.Add("LEVEL1_REUSED:" + l1.Name);
                    if (l2 == null) { l2 = Level.Create(doc, Ft(HeightMm)); TrySetName(l2, "MGL-AI Level 2"); m.States.Add("LEVEL2_CREATED"); }
                    else m.States.Add("LEVEL2_REUSED:" + l2.Name);
                    m.Elements.Levels.Add(Ref("level.1", l1));
                    m.Elements.Levels.Add(Ref("level.2", l2));

                    // ─── Хана ───
                    WallType wt = FindWallType(doc);
                    if (wt == null) { m.States.Add("WALL_SKIPPED_NO_TYPE"); }
                    else
                    {
                        // R4.2 — CHANGE_TYPE-ийн зорилт: баримтын ӨӨРИЙН хананы төрлийг ЭНЭ баримтад л хуулбарлана
                        //   (Duplicate = синтетик баримт дотор шинэ ElementType; загвар файл, компанийн template,
                        //   суулгасан family сан ХӨНДӨГДӨХГҮЙ).  Нэр нь ТЕСТ гэдгээ ил хэлнэ.
                        m.Elements.WallTypes.Add(Ref("walltype.base", wt));
                        try
                        {
                            WallType alt = wt.Duplicate(TestModel.AltWallTypeName) as WallType;
                            if (alt != null)
                            {
                                Parameter altComments = alt.LookupParameter("Comments");
                                if (altComments != null && !altComments.IsReadOnly && altComments.StorageType == StorageType.String) altComments.Set(TestModel.ElementMarker);
                                m.Elements.WallTypes.Add(Ref("walltype.alt", alt));
                                m.States.Add("WALLTYPE_ALT_CREATED");
                            }
                        }
                        catch (Exception ex) { m.States.Add("WALLTYPE_ALT_FAILED:" + ex.GetType().Name); }
                        double h = Ft(HeightMm);
                        XYZ a = new XYZ(0, 0, 0), b = new XYZ(Ft(WidthMm), 0, 0), c = new XYZ(Ft(WidthMm), Ft(DepthMm), 0), d = new XYZ(0, Ft(DepthMm), 0);
                        m.Elements.Walls.Add(Ref("wall.exterior.south", MakeWall(doc, a, b, wt, l1, h)));
                        m.Elements.Walls.Add(Ref("wall.exterior.east", MakeWall(doc, b, c, wt, l1, h)));
                        m.Elements.Walls.Add(Ref("wall.exterior.north", MakeWall(doc, c, d, wt, l1, h)));
                        m.Elements.Walls.Add(Ref("wall.exterior.west", MakeWall(doc, d, a, wt, l1, h)));
                        Wall corridor = MakeWall(doc, new XYZ(0, Ft(CorridorMm), 0), new XYZ(Ft(WidthMm), Ft(CorridorMm), 0), wt, l1, h);
                        m.Elements.Walls.Add(Ref("wall.interior.corridor", corridor));
                        Wall divider = MakeWall(doc, new XYZ(Ft(DividerXMm), Ft(CorridorMm), 0), new XYZ(Ft(DividerXMm), Ft(DepthMm), 0), wt, l1, h);
                        m.Elements.Walls.Add(Ref("wall.interior.center", divider, "intentional: Comments marker"));
                        // §8 — синтетик параметрийн тэмдэг (MODEL_QUALITY тест, норм БИШ).
                        Parameter cm = divider.get_Parameter(BuiltInParameter.ALL_MODEL_INSTANCE_COMMENTS);
                        if (cm != null && !cm.IsReadOnly) { cm.Set(TestModel.ElementMarker); m.IntentionalDefects.Add("wall.interior.center: Comments = " + TestModel.ElementMarker + " (test_marker)"); }
                        doc.Regenerate();

                        // ─── Шал ───
                        FloorType ft = FindFloorType(doc);
                        if (ft == null) m.States.Add("FLOOR_SKIPPED_NO_TYPE");
                        else
                        {
                            try
                            {
                                var loop = new CurveLoop();
                                loop.Append(Line.CreateBound(a, b)); loop.Append(Line.CreateBound(b, c));
                                loop.Append(Line.CreateBound(c, d)); loop.Append(Line.CreateBound(d, a));
                                Floor floor = Floor.Create(doc, new List<CurveLoop> { loop }, ft.Id, l1.Id);
                                m.Elements.Floors.Add(Ref("floor.level1", floor));
                                m.States.Add("FLOOR_CREATED");
                            }
                            catch (Exception ex) { m.States.Add("FLOOR_FAILED:" + ex.GetType().Name); }
                        }

                        // ─── Өрөө ───
                        try
                        {
                            Room r101 = doc.Create.NewRoom(l1, new UV(Ft(2500), Ft(5000)));
                            Room r102 = doc.Create.NewRoom(l1, new UV(Ft(7500), Ft(5000)));
                            Room cor = doc.Create.NewRoom(l1, new UV(Ft(5000), Ft(1000)));
                            SetRoom(r101, "101", "Room 101", "TEST");
                            // §8 — Room 102 ЗОРИУД Department-гүй (MODEL_QUALITY тест: no_department).
                            SetRoom(r102, "102", "Room 102", null);
                            SetRoom(cor, "100", "Corridor", "TEST");
                            m.Elements.Rooms.Add(Ref("room.101", r101));
                            m.Elements.Rooms.Add(Ref("room.102", r102, "intentional: no Department"));
                            m.Elements.Rooms.Add(Ref("corridor.main", cor));
                            m.IntentionalDefects.Add("room.102: Department хоосон (no_department)");
                            m.States.Add("ROOMS_CREATED");
                        }
                        catch (Exception ex) { m.States.Add("ROOMS_FAILED:" + ex.GetType().Name + ":" + ex.Message); }
                        doc.Regenerate();

                        // ─── Хаалга / цонх (заавал биш) ───
                        FamilySymbol door = FindSymbol(doc, BuiltInCategory.OST_Doors) ?? TryLoadSymbol(doc, BuiltInCategory.OST_Doors, m);
                        if (door == null) m.States.Add("DOOR_SKIPPED_NO_FAMILY");
                        else
                        {
                            try
                            {
                                Activate(doc, door);
                                FamilyInstance d1 = doc.Create.NewFamilyInstance(new XYZ(Ft(2500), Ft(CorridorMm), 0), door, corridor, l1, StructuralType.NonStructural);
                                m.Elements.Doors.Add(Ref("door.corridor.101", d1));
                                FamilyInstance d2 = doc.Create.NewFamilyInstance(new XYZ(Ft(7500), Ft(CorridorMm), 0), door, corridor, l1, StructuralType.NonStructural);
                                m.Elements.Doors.Add(Ref("door.corridor.102", d2));
                                m.States.Add("DOOR_CREATED");
                            }
                            catch (Exception ex) { m.States.Add("DOOR_FAILED:" + ex.GetType().Name); }
                        }
                        FamilySymbol win = FindSymbol(doc, BuiltInCategory.OST_Windows) ?? TryLoadSymbol(doc, BuiltInCategory.OST_Windows, m);
                        if (win == null) m.States.Add("WINDOW_SKIPPED_NO_FAMILY");
                        else
                        {
                            try
                            {
                                Activate(doc, win);
                                Wall north = doc.GetElement(new ElementId(m.Elements.Find("wall.exterior.north").ElementId)) as Wall;
                                FamilyInstance w1 = doc.Create.NewFamilyInstance(new XYZ(Ft(2500), Ft(DepthMm), Ft(900)), win, north, l1, StructuralType.NonStructural);
                                Parameter sill = w1.get_Parameter(BuiltInParameter.INSTANCE_SILL_HEIGHT_PARAM);
                                if (sill != null && !sill.IsReadOnly) sill.Set(Ft(900));
                                m.Elements.Windows.Add(Ref("window.north.101", w1));
                                m.States.Add("WINDOW_CREATED");
                            }
                            catch (Exception ex) { m.States.Add("WINDOW_FAILED:" + ex.GetType().Name); }
                        }
                        doc.Regenerate();
                    }
                    t.Commit();
                }
                catch
                {
                    t.RollBack();
                    throw;
                }
            }
            m.ElapsedMs = Math.Round(sw.Elapsed.TotalMilliseconds, 1);
            WriteManifest(m);
            return m;
        }

        /* ============================================================== */
        /*  ХЯНАЛТТАЙ ӨӨРЧЛӨЛТ (§11) — тест зөвхөн тэмдэгтэй баримтад        */
        /* ============================================================== */

        /// <summary>
        /// `move_interior_wall` — төв ханыг +500 мм зүүн тийш (ElementTransformUtils);
        /// `delete_interior_wall` — төв ханыг устгана → Room 101/102 нэг зай болж
        ///   нэг нь Revit-д «redundant» (талбай 0) → MODEL_QUALITY `room_not_enclosed`;
        /// `delete_door` — эхний хаалгыг устгана.
        /// </summary>
        internal static object Mutate(UIApplication app, string op)
        {
            Document doc = app.ActiveUIDocument != null ? app.ActiveUIDocument.Document : null;
            if (doc == null) throw new InvalidOperationException("NO_DOCUMENT");
            if (!IsTestMarked(doc)) throw new InvalidOperationException("TEST_MUTATE_REFUSED: баримт MGL-AI-TEST тэмдэггүй");
            TestModelManifest m = ReadManifest(DocKeys.Normalize(RevitTools.DocUid(doc)));
            if (m == null) throw new InvalidOperationException("TEST_MUTATE_REFUSED: манифест алга (эхлээд test_model_create)");
            using (var t = new Transaction(doc, "MGL AI Test Mutate (SYNTHETIC): " + op))
            {
                t.Start();
                object result;
                switch (op)
                {
                    case "move_interior_wall":
                        {
                            long id = m.Elements.Find("wall.interior.center").ElementId;
                            ElementTransformUtils.MoveElement(doc, new ElementId(id), new XYZ(Ft(500), 0, 0));
                            result = new { op, element_id = id, dx_mm = 500 };
                            break;
                        }
                    case "delete_interior_wall":
                        {
                            long id = m.Elements.Find("wall.interior.center").ElementId;
                            ICollection<ElementId> deleted = doc.Delete(new ElementId(id));
                            result = new { op, element_id = id, deleted = deleted.Count };
                            break;
                        }
                    case "delete_door":
                        {
                            if (m.Elements.Doors.Count == 0) { t.RollBack(); return new { op, skipped = "DOOR_SKIPPED_NO_FAMILY" }; }
                            long id = m.Elements.Doors[0].ElementId;
                            ICollection<ElementId> deleted = doc.Delete(new ElementId(id));
                            result = new { op, element_id = id, deleted = deleted.Count };
                            break;
                        }
                    default:
                        t.RollBack();
                        throw new ArgumentException("Танихгүй op: " + op);
                }
                t.Commit();
                return result;
            }
        }

        /* ============================================================== */
        /*  ХАДГАЛАХ (§13) — Session R-ийн dev байршилд, дарж бичихгүй       */
        /* ============================================================== */

        internal static string TestModelsDir
        {
            get { return Path.Combine(new AppDataStoragePaths().RootDir, "test-models"); }
        }

        internal static string Save(UIApplication app)
        {
            Document doc = app.ActiveUIDocument != null ? app.ActiveUIDocument.Document : null;
            if (doc == null) throw new InvalidOperationException("NO_DOCUMENT");
            if (!IsTestMarked(doc)) throw new InvalidOperationException("TEST_SAVE_REFUSED: баримт MGL-AI-TEST тэмдэггүй — компанийн загварыг энэ замаар хадгалахгүй");
            Directory.CreateDirectory(TestModelsDir);
            string path = Path.Combine(TestModelsDir, TestModel.FixtureId + "-" + DateTime.UtcNow.ToString("yyyyMMdd-HHmmss") + ".rvt");
            if (File.Exists(path)) throw new InvalidOperationException("TEST_SAVE_REFUSED: файл аль хэдийн байна");
            var opts = new SaveAsOptions { OverwriteExistingFile = false };
            doc.SaveAs(path, opts);
            TestModelManifest m = ReadManifest(DocKeys.Normalize(RevitTools.DocUid(doc)));
            if (m != null) { m.SavedPath = path; WriteManifest(m); }
            return path;
        }

        /* ============================================================== */
        /*  ШИНЭ ТӨСӨЛ (§14) — баримтгүй үед                                */
        /* ============================================================== */

        /// <summary>
        /// `NewProjectDocument(Metric)` нь UI-д ХАРАГДАХГҮЙ баримт үүсгэдэг тул:
        /// үүсгэ → тэмдэглэ → dev байршилд SaveAs → хаа → `OpenAndActivateDocument`.
        /// Идэвхжүүлэлт унавал API-тай тэмцэхгүй: замыг буцаагаад хэрэглэгч
        /// (эсвэл дараагийн хэрэгсэл) нээнэ — `NEW_PROJECT_SAVED_OPEN_MANUALLY`.
        /// </summary>
        internal static object NewTestProject(UIApplication app)
        {
            Application a = app.Application;
            Directory.CreateDirectory(TestModelsDir);
            string path = Path.Combine(TestModelsDir, TestModel.FixtureId + "-blank-" + DateTime.UtcNow.ToString("yyyyMMdd-HHmmss") + ".rvt");
            Document doc = a.NewProjectDocument(UnitSystem.Metric);
            try
            {
                using (var t = new Transaction(doc, "MGL AI Test Project mark"))
                {
                    t.Start();
                    doc.ProjectInformation.Name = TestModel.ProjectInfoMarker;
                    t.Commit();
                }
                doc.SaveAs(path, new SaveAsOptions { OverwriteExistingFile = false });
            }
            finally
            {
                try { doc.Close(false); } catch { }
            }
            try
            {
                UIDocument ui = app.OpenAndActivateDocument(path);
                return new { state = "NEW_PROJECT_OPENED", path, title = ui != null ? ui.Document.Title : null };
            }
            catch (Exception ex)
            {
                return new { state = "NEW_PROJECT_SAVED_OPEN_MANUALLY", path, error = ex.GetType().Name + ": " + ex.Message };
            }
        }

        /// <summary>Хадгалсан тест .rvt-г нээнэ — ЗӨВХӨН Session R-ийн test-models хавтаснаас (компанийн файл энэ замаар нээгдэхгүй).</summary>
        internal static object OpenTestProject(UIApplication app, string path)
        {
            if (string.IsNullOrEmpty(path)) throw new ArgumentException("path");
            string full = Path.GetFullPath(path);
            string dir = Path.GetFullPath(TestModelsDir).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
            if (!full.StartsWith(dir, StringComparison.OrdinalIgnoreCase)) throw new InvalidOperationException("TEST_OPEN_REFUSED: зөвхөн " + dir);
            if (!File.Exists(full)) throw new FileNotFoundException(full);
            UIDocument ui = app.OpenAndActivateDocument(full);
            return new { state = "TEST_PROJECT_OPENED", path = full, title = ui != null ? ui.Document.Title : null, is_test_marked = ui != null && IsTestMarked(ui.Document) };
        }

        /// <summary>
        /// Нээлттэй тест баримтыг ХААНА (хадгалахгүй) — идэвхтэй баримтыг Revit API хааж чаддаггүй
        /// тул дуудагч эхлээд өөр баримт идэвхжүүлнэ.  Зөвхөн test-models хавтасны, тэмдэгтэй файл.
        /// </summary>
        internal static object CloseTestProject(UIApplication app, string path)
        {
            if (string.IsNullOrEmpty(path)) throw new ArgumentException("path");
            string full = Path.GetFullPath(path);
            string dir = Path.GetFullPath(TestModelsDir).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
            if (!full.StartsWith(dir, StringComparison.OrdinalIgnoreCase)) throw new InvalidOperationException("TEST_CLOSE_REFUSED: зөвхөн " + dir);
            Document active = app.ActiveUIDocument != null ? app.ActiveUIDocument.Document : null;
            foreach (Document d in app.Application.Documents)
            {
                if (!string.Equals(Path.GetFullPath(d.PathName ?? ""), full, StringComparison.OrdinalIgnoreCase)) continue;
                if (active != null && d.Equals(active)) throw new InvalidOperationException("TEST_CLOSE_REFUSED: идэвхтэй баримт — эхлээд өөр баримт нээ");
                if (!IsTestMarked(d)) throw new InvalidOperationException("TEST_CLOSE_REFUSED: тэмдэггүй");
                bool ok = d.Close(false);
                return new { state = ok ? "TEST_PROJECT_CLOSED" : "CLOSE_RETURNED_FALSE", path = full };
            }
            return new { state = "NOT_OPEN", path = full };
        }

        /* ============================================================== */
        /*  туслах                                                         */
        /* ============================================================== */

        private static Level FindLevelNear(Document doc, double mm)
        {
            double want = Ft(mm), tol = Ft(50);
            foreach (Level l in new FilteredElementCollector(doc).OfClass(typeof(Level)))
            {
                if (Math.Abs(l.Elevation - want) <= tol) return l;
            }
            return null;
        }

        private static void TrySetName(Element e, string name)
        {
            try { e.Name = name; } catch { }
        }

        private static WallType FindWallType(Document doc)
        {
            WallType any = null;
            foreach (WallType t in new FilteredElementCollector(doc).OfClass(typeof(WallType)))
            {
                if (t.Kind != WallKind.Basic) continue;
                if (any == null) any = t;
                string n = t.Name ?? "";
                if (n.IndexOf("Generic", StringComparison.OrdinalIgnoreCase) >= 0 && n.IndexOf("200", StringComparison.Ordinal) >= 0) return t;
            }
            return any;
        }

        private static FloorType FindFloorType(Document doc)
        {
            FloorType any = null;
            foreach (FloorType t in new FilteredElementCollector(doc).OfClass(typeof(FloorType)))
            {
                try { if (t.IsFoundationSlab) continue; } catch { }
                if (any == null) any = t;
                if ((t.Name ?? "").IndexOf("Generic", StringComparison.OrdinalIgnoreCase) >= 0) return t;
            }
            return any;
        }

        private static Wall MakeWall(Document doc, XYZ a, XYZ b, WallType wt, Level level, double h)
        {
            return Wall.Create(doc, Line.CreateBound(a, b), wt.Id, level.Id, h, 0, false, false);
        }

        private static void SetRoom(Room r, string number, string name, string department)
        {
            try { r.Number = number; } catch { }
            try { r.Name = name; } catch { }
            if (department != null)
            {
                try { Parameter p = r.get_Parameter(BuiltInParameter.ROOM_DEPARTMENT); if (p != null && !p.IsReadOnly) p.Set(department); } catch { }
            }
        }

        private static FamilySymbol FindSymbol(Document doc, BuiltInCategory bic)
        {
            FamilySymbol any = null;
            foreach (FamilySymbol s in new FilteredElementCollector(doc).OfCategory(bic).OfClass(typeof(FamilySymbol)))
            {
                if (any == null) any = s;
                string fam = s.FamilyName ?? "";
                if (fam.IndexOf("Single-Flush", StringComparison.OrdinalIgnoreCase) >= 0 || fam.IndexOf("Fixed", StringComparison.OrdinalIgnoreCase) >= 0) return s;
            }
            return any;
        }

        /// <summary>Зөвхөн Autodesk-ийн суулгасан сангийн МЭДЭГДЭЖ БУЙ нэрс; олдохгүй бол null (fixture унахгүй).</summary>
        private static FamilySymbol TryLoadSymbol(Document doc, BuiltInCategory bic, TestModelManifest m)
        {
            string lib = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "Autodesk", "RVT 2027", "Libraries");
            string[] names = bic == BuiltInCategory.OST_Doors
                ? new[] { "M_Single-Flush.rfa", "Single-Flush.rfa" }
                : new[] { "M_Fixed.rfa", "Fixed.rfa" };
            if (!Directory.Exists(lib)) return null;
            foreach (string n in names)
            {
                string[] found;
                try { found = Directory.GetFiles(lib, n, SearchOption.AllDirectories); } catch { continue; }
                foreach (string f in found)
                {
                    try
                    {
                        Family fam;
                        if (!doc.LoadFamily(f, out fam) || fam == null) continue;
                        m.States.Add("FAMILY_LOADED:" + n);
                        foreach (ElementId sid in fam.GetFamilySymbolIds())
                        {
                            FamilySymbol s = doc.GetElement(sid) as FamilySymbol;
                            if (s != null) return s;
                        }
                    }
                    catch { }
                }
            }
            return null;
        }

        private static void Activate(Document doc, FamilySymbol s)
        {
            if (!s.IsActive) { s.Activate(); doc.Regenerate(); }
        }

        private static TestModelElement Ref(string logical, Element e, string note = null)
        {
            return new TestModelElement
            {
                Logical = logical,
                ElementId = e.Id.Value,
                UniqueId = e.UniqueId,
                Category = e.Category != null ? e.Category.Name : null,
                Note = note,
            };
        }

        /* ---- манифест ---- */

        internal static string ManifestPath(string docKey)
        {
            string safe = (docKey ?? "doc").Replace(':', '_').Replace('\\', '_').Replace('/', '_');
            return Path.Combine(new AppDataStoragePaths().RootDir, "test-model-manifest-" + safe + ".json");
        }

        internal static void WriteManifest(TestModelManifest m)
        {
            try
            {
                string p = ManifestPath(m.DocKey);
                Directory.CreateDirectory(Path.GetDirectoryName(p));
                File.WriteAllText(p, IntelligenceJson.Pretty.WriteIndented ? System.Text.Json.JsonSerializer.Serialize(m, IntelligenceJson.Pretty) : IntelligenceJson.Serialize(m), new UTF8Encoding(false));
            }
            catch { }
        }

        internal static TestModelManifest ReadManifest(string docKey)
        {
            try
            {
                string p = ManifestPath(docKey);
                if (!File.Exists(p)) return null;
                return IntelligenceJson.Deserialize<TestModelManifest>(File.ReadAllText(p, Encoding.UTF8));
            }
            catch { return null; }
        }
    }
}
