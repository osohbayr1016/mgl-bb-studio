using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Architecture;
using Autodesk.Revit.UI;
using RevitMcpAddin.Intelligence.Contracts;
using RevitMcpAddin.Intelligence.Core;

namespace RevitMcpAddin.Intelligence.Revit
{
    /// <summary>
    /// REVIT → ХӨДЛӨШГҮЙ КОНТЕКСТ (§10–13, §15, R-16, R-17).
    ///
    /// ⚠️ ЭНЭ АНГИ ЗӨВХӨН Revit-ийн API-ийн ХҮЧИНТЭЙ КОНТЕКСТ ДОТОР дуудагдана
    ///    (`RevitToolBus` → `RevitTools.Run` → энд, эсвэл Revit-ийн үйл явдлын
    ///    гар дотор).  Амьд `Element`/`Document` ЭНДЭЭС ГАРАХГҮЙ — зөвхөн DTO.
    /// ⚠️ ДОТООД ТӨСӨВ.  `RevitToolBus`-ийн timeout нь дуудагчийг хамгаална,
    ///    Revit-ийг БИШ (`RuleFactExtractor.cs`-ийн сургамж) — тиймээс `Stopwatch`
    ///    deadline + элементийн тоон дээд.
    /// ⚠️ БҮХ ПАРАМЕТРИЙГ ХЭЗЭЭ Ч цувруулахгүй — категорийн цагаан жагсаалт.
    /// </summary>
    internal static class RevitContextExtractor
    {
        /// <summary>Нэг агшин зурагт бүрэн хураангуйлах сонголтын дээд (сервер ч 25-аар тасалдаг, R-7).</summary>
        internal const int MaxSummaries = 25;
        /// <summary>`SelectionRest`-ийн дээд — id + категори л.</summary>
        internal const int MaxRest = 500;
        /// <summary>Агшин зургийн Revit-ийн үндсэн thread дээрх төсөв (§54).</summary>
        internal const int SnapshotBudgetMs = 400;

        /* ============================================================== */
        /*  АГШИН ЗУРАГ                                                   */
        /* ============================================================== */

        internal static RevitContextSnapshot Snapshot(UIApplication app, RevitProjectLink link)
        {
            var sw = Stopwatch.StartNew();
            var snap = new RevitContextSnapshot { CapturedAt = DateTime.UtcNow.ToString("o"), ProjectLink = link };
            UIDocument uidoc = app != null ? app.ActiveUIDocument : null;
            Document doc = uidoc != null ? uidoc.Document : null;
            if (doc == null)
            {
                snap.State = RevitErrorState.NO_DOCUMENT;
                snap.CaptureMs = sw.Elapsed.TotalMilliseconds;
                return snap;
            }
            try
            {
                snap.Document = DocumentContext(doc);
                View av = null;
                try { av = doc.ActiveView; } catch { }
                if (av != null)
                {
                    snap.ActiveView = ViewContext(av);
                    if (snap.ActiveView.Level != null) snap.Document.ActiveLevel = snap.ActiveView.Level;
                }
                try { snap.WarningCount = doc.GetWarnings().Count; } catch { snap.WarningCount = null; }
                try { snap.TransactionOpen = doc.IsModifiable; } catch { }

                ICollection<ElementId> ids = uidoc.Selection.GetElementIds();
                snap.SelectionTotal = ids.Count;
                if (ids.Count == 0) snap.State = RevitErrorState.NO_SELECTION;
                int n = 0;
                foreach (ElementId id in ids)
                {
                    if (sw.ElapsedMilliseconds > SnapshotBudgetMs && n >= 1)
                    {
                        // Төсөв дууссан — үлдсэнийг зөвхөн id/категориор.
                        AddRest(snap, doc, id);
                        continue;
                    }
                    if (n < MaxSummaries)
                    {
                        Element e = doc.GetElement(id);
                        if (e == null) continue;
                        snap.Selection.Add(Summarize(doc, e, SummaryDepth.Full));
                        n++;
                    }
                    else
                    {
                        if (snap.SelectionRest.Count >= MaxRest) break;
                        AddRest(snap, doc, id);
                    }
                }
            }
            catch (Exception ex)
            {
                snap.State = RevitErrorState.REVIT_API_ERROR;
                snap.Selection.Clear();
                snap.SelectionRest.Add(new RevitElementRef { ElementId = 0, Category = "REVIT_API_ERROR: " + ex.GetType().Name });
            }
            snap.CaptureMs = Math.Round(sw.Elapsed.TotalMilliseconds, 2);
            return snap;
        }

        private static void AddRest(RevitContextSnapshot snap, Document doc, ElementId id)
        {
            string cat = null;
            try { Element e = doc.GetElement(id); cat = e != null && e.Category != null ? e.Category.Name : null; } catch { }
            snap.SelectionRest.Add(new RevitElementRef { ElementId = id.Value, Category = cat ?? "тодорхойгүй" });
        }

        /* ============================================================== */
        /*  БАРИМТ (§11)                                                   */
        /* ============================================================== */

        internal static RevitDocumentContext DocumentContext(Document doc)
        {
            var d = new RevitDocumentContext
            {
                DocKey = DocKeys.Normalize(RevitTools.DocUid(doc)),
                Title = Safe(() => doc.Title),
                IsWorkshared = Safe(() => doc.IsWorkshared),
                IsFamily = Safe(() => doc.IsFamilyDocument),
                IsLinked = Safe(() => doc.IsLinked),
                IsReadOnly = Safe(() => doc.IsReadOnly),
                RevitVersion = Safe(() => doc.Application.VersionNumber),
            };
            d.DocKeySource = d.DocKey != null && d.DocKey.StartsWith("path:", StringComparison.Ordinal) ? "path" : "project_info";
            string path = Safe(() => doc.PathName);
            d.FileName = string.IsNullOrEmpty(path) ? d.Title : Path.GetFileName(path);
            // ⚠️ Бүтэн зам ГЭРЭЭНД ОРОХГҮЙ — зөвхөн анги (§11, §61).
            if (string.IsNullOrEmpty(path)) d.PathClass = DocumentPathClass.UNSAVED;
            else if (Safe(() => doc.IsModelInCloud)) d.PathClass = DocumentPathClass.CLOUD;
            else if (path.StartsWith("RSN://", StringComparison.OrdinalIgnoreCase) || path.StartsWith("\\\\", StringComparison.Ordinal)) d.PathClass = DocumentPathClass.SERVER;
            else d.PathClass = DocumentPathClass.LOCAL_FILE;

            if (d.IsWorkshared)
            {
                if (Safe(() => doc.IsDetached)) d.Worksharing = DocumentWorksharing.DETACHED;
                else
                {
                    ModelPath central = Safe(() => doc.GetWorksharingCentralModelPath());
                    string cp = central != null ? Safe(() => ModelPathUtils.ConvertModelPathToUserVisiblePath(central)) : null;
                    d.Worksharing = cp != null && string.Equals(cp, path, StringComparison.OrdinalIgnoreCase)
                        ? DocumentWorksharing.CENTRAL
                        : DocumentWorksharing.LOCAL;
                }
            }
            else d.Worksharing = DocumentWorksharing.NOT_WORKSHARED;

            try
            {
                Autodesk.Revit.DB.ProjectInfo pi = doc.ProjectInformation;
                if (pi != null)
                {
                    d.ProjectName = Trim(pi.Name);
                    d.ProjectNumber = Trim(pi.Number);
                }
            }
            catch { }
            try
            {
                ElementId ado = DesignOption.GetActiveDesignOptionId(doc);
                if (ado != null && ado != ElementId.InvalidElementId)
                {
                    Element o = doc.GetElement(ado);
                    d.ActiveDesignOption = o != null ? o.Name : null;
                }
            }
            catch { }
            try
            {
                View av = doc.ActiveView;
                if (av != null)
                {
                    Parameter ph = av.get_Parameter(BuiltInParameter.VIEW_PHASE);
                    if (ph != null && ph.AsElementId() != ElementId.InvalidElementId)
                    {
                        Element p = doc.GetElement(ph.AsElementId());
                        d.ActivePhase = p != null ? p.Name : null;
                    }
                }
            }
            catch { }
            try
            {
                d.LinkCount = new FilteredElementCollector(doc).OfClass(typeof(RevitLinkInstance)).GetElementCount();
            }
            catch { }
            d.IsTestFixture = TestModelFixture.IsTestMarked(doc);
            return d;
        }

        /* ============================================================== */
        /*  ХАРАГДАЦ (§12)                                                 */
        /* ============================================================== */

        internal static RevitViewContext ViewContext(View v)
        {
            var c = new RevitViewContext
            {
                ElementId = v.Id.Value,
                UniqueId = Safe(() => v.UniqueId),
                ViewType = Safe(() => v.ViewType.ToString()),
                Name = Safe(() => v.Name),
                IsTemplate = Safe(() => v.IsTemplate),
            };
            try { Level gl = v.GenLevel; if (gl != null) c.Level = gl.Name; } catch { }
            try { c.Scale = v.Scale; } catch { }
            try { c.Discipline = v.Discipline.ToString(); } catch { }
            try { c.DetailLevel = v.DetailLevel.ToString(); } catch { }
            try { c.IsCropped = v.CropBoxActive; } catch { }
            try
            {
                ElementId t = v.ViewTemplateId;
                if (t != null && t != ElementId.InvalidElementId)
                {
                    Element te = v.Document.GetElement(t);
                    c.TemplateName = te != null ? te.Name : null;
                }
            }
            catch { }
            try
            {
                Parameter ph = v.get_Parameter(BuiltInParameter.VIEW_PHASE);
                if (ph != null && ph.AsElementId() != ElementId.InvalidElementId)
                {
                    Element p = v.Document.GetElement(ph.AsElementId());
                    c.Phase = p != null ? p.Name : null;
                }
            }
            catch { }
            ViewSheet sheet = v as ViewSheet;
            if (sheet != null) c.SheetNumber = Safe(() => sheet.SheetNumber);
            return c;
        }

        /* ============================================================== */
        /*  ЭЛЕМЕНТ (§13, R-16, R-17)                                      */
        /* ============================================================== */

        internal enum SummaryDepth { Index, Full }

        internal static RevitElementSummary Summarize(Document doc, Element e, SummaryDepth depth)
        {
            var s = new RevitElementSummary { ElementId = e.Id.Value };
            try
            {
                s.UniqueId = e.UniqueId;
                s.Category = e.Category != null ? e.Category.Name : null;
                s.Kind = KindOf(e);
                s.Name = Trim(Safe(() => e.Name));
                s.IsType = e is ElementType;
                s.IsPinned = Safe(() => e.Pinned);
                s.Scope = doc.IsLinked ? ElementScope.LINKED_DOCUMENT : ElementScope.HOST_DOCUMENT;

                ElementType type = null;
                try
                {
                    ElementId tid = e.GetTypeId();
                    if (tid != null && tid != ElementId.InvalidElementId) type = doc.GetElement(tid) as ElementType;
                }
                catch { }
                if (type != null)
                {
                    s.Type = Trim(type.Name);
                    s.Family = Trim(Safe(() => type.FamilyName));
                }

                LevelOf(doc, e, s);
                PhasesOf(doc, e, s);
                HostOf(doc, e, s);
                s.Worksharing = Worksharing(doc, e);

                if (depth == SummaryDepth.Full)
                {
                    s.Location = Location(e);
                    s.BoundingBox = BoundingBox(e);
                    Dimensions(doc, e, type, s);
                    ElementParamAllowlist.Fill(doc, e, type, s);
                    Rooms(doc, e, s);
                    Materials(doc, e, s);
                }
            }
            catch (Exception ex)
            {
                s.Warnings.Add("REVIT_API_ERROR:" + ex.GetType().Name);
            }
            return s;
        }

        internal static SceneNodeKind KindOf(Element e)
        {
            if (e == null || e.Category == null) return SceneNodeKind.OTHER;
            if (e is Level) return SceneNodeKind.LEVEL;
            if (e is Room) return SceneNodeKind.ROOM;
            if (e is Wall) return SceneNodeKind.WALL;
            if (e is Floor) return SceneNodeKind.FLOOR;
            if (e is RoofBase) return SceneNodeKind.ROOF;
            if (e is Ceiling) return SceneNodeKind.CEILING;
            if (e is View) return SceneNodeKind.VIEW;
            if (e is Grid) return SceneNodeKind.GRID;
            if (e is RevitLinkInstance) return SceneNodeKind.LINK;
            long cid;
            try { cid = e.Category.Id.Value; } catch { return SceneNodeKind.OTHER; }
            if (cid == (long)BuiltInCategory.OST_Doors) return SceneNodeKind.DOOR;
            if (cid == (long)BuiltInCategory.OST_Windows) return SceneNodeKind.WINDOW;
            if (cid == (long)BuiltInCategory.OST_MEPSpaces) return SceneNodeKind.SPACE;
            if (cid == (long)BuiltInCategory.OST_Stairs) return SceneNodeKind.STAIR;
            if (cid == (long)BuiltInCategory.OST_Columns || cid == (long)BuiltInCategory.OST_StructuralColumns) return SceneNodeKind.COLUMN;
            if (cid == (long)BuiltInCategory.OST_StructuralFraming) return SceneNodeKind.BEAM;
            return SceneNodeKind.OTHER;
        }

        internal static void LevelOf(Document doc, Element e, RevitElementSummary s)
        {
            try
            {
                ElementId lid = e.LevelId;
                if ((lid == null || lid == ElementId.InvalidElementId) && e is FamilyInstance)
                {
                    Parameter p = e.get_Parameter(BuiltInParameter.FAMILY_LEVEL_PARAM) ?? e.get_Parameter(BuiltInParameter.SCHEDULE_LEVEL_PARAM);
                    if (p != null) lid = p.AsElementId();
                }
                if (lid == null || lid == ElementId.InvalidElementId)
                {
                    Room r = e as Room;
                    if (r != null && r.Level != null) lid = r.Level.Id;
                }
                if (lid != null && lid != ElementId.InvalidElementId)
                {
                    Level l = doc.GetElement(lid) as Level;
                    if (l != null) { s.LevelId = l.Id.Value; s.Level = l.Name; }
                }
            }
            catch { }
        }

        private static void PhasesOf(Document doc, Element e, RevitElementSummary s)
        {
            try
            {
                ElementId c = e.CreatedPhaseId;
                if (c != null && c != ElementId.InvalidElementId) { Element p = doc.GetElement(c); if (p != null) s.PhaseCreated = p.Name; }
                ElementId d = e.DemolishedPhaseId;
                if (d != null && d != ElementId.InvalidElementId) { Element p = doc.GetElement(d); if (p != null) s.PhaseDemolished = p.Name; }
            }
            catch { }
        }

        internal static void HostOf(Document doc, Element e, RevitElementSummary s)
        {
            try
            {
                FamilyInstance fi = e as FamilyInstance;
                Element host = fi != null ? fi.Host : null;
                if (host != null) s.Host = Ref(host);
            }
            catch { }
        }

        internal static RevitElementRef Ref(Element e)
        {
            if (e == null) return null;
            return new RevitElementRef
            {
                ElementId = e.Id.Value,
                UniqueId = Safe(() => e.UniqueId),
                Category = e.Category != null ? e.Category.Name : null,
                Name = Trim(Safe(() => e.Name)),
            };
        }

        /// <summary>R-17: төлөв л, хүний нэр ЯВАХГҮЙ.  `Editable == null` = мэдэхгүй.</summary>
        internal static RevitWorksharingState Worksharing(Document doc, Element e)
        {
            var w = new RevitWorksharingState
            {
                Pinned = Safe(() => e.Pinned),
                ReadOnlyDocument = Safe(() => doc.IsReadOnly),
                Linked = Safe(() => doc.IsLinked),
            };
            try
            {
                if (!doc.IsWorkshared)
                {
                    w.Ownership = ElementOwnership.NOT_WORKSHARED;
                    w.Editable = !w.ReadOnlyDocument && !w.Linked;
                    return w;
                }
                CheckoutStatus cs = WorksharingUtils.GetCheckoutStatus(doc, e.Id);
                switch (cs)
                {
                    case CheckoutStatus.OwnedByCurrentUser: w.Ownership = ElementOwnership.OWNED_BY_CURRENT_USER; w.Editable = !w.ReadOnlyDocument; break;
                    case CheckoutStatus.OwnedByOtherUser: w.Ownership = ElementOwnership.OWNED_BY_OTHER_USER; w.Editable = false; break;
                    default: w.Ownership = ElementOwnership.NOT_OWNED; w.Editable = !w.ReadOnlyDocument; break;
                }
                try
                {
                    WorksetId wid = e.WorksetId;
                    if (wid != null && wid != WorksetId.InvalidWorksetId)
                    {
                        Workset ws = doc.GetWorksetTable().GetWorkset(wid);
                        if (ws != null) w.Workset = Trim(ws.Name);
                    }
                }
                catch { }
            }
            catch
            {
                w.Ownership = ElementOwnership.UNKNOWN;
                w.Editable = null;
            }
            return w;
        }

        internal static RevitLocationSummary Location(Element e)
        {
            try
            {
                LocationCurve lc = e.Location as LocationCurve;
                if (lc != null && lc.Curve != null)
                {
                    Curve c = lc.Curve;
                    XYZ a = c.GetEndPoint(0), b = c.GetEndPoint(1);
                    var loc = new RevitLocationSummary
                    {
                        Kind = LocationKind.LINE,
                        StartMm = UnitsBoundary.PointFeetToMm(a.X, a.Y, a.Z),
                        EndMm = UnitsBoundary.PointFeetToMm(b.X, b.Y, b.Z),
                        IsCurved = !(c is Line),
                    };
                    Line ln = c as Line;
                    if (ln != null)
                    {
                        loc.DirectionDeg = Math.Round(UnitsBoundary.RadToDeg(Math.Atan2(ln.Direction.Y, ln.Direction.X)), 2);
                    }
                    return loc;
                }
                LocationPoint lp = e.Location as LocationPoint;
                if (lp != null && lp.Point != null)
                {
                    return new RevitLocationSummary { Kind = LocationKind.POINT, PointMm = UnitsBoundary.PointFeetToMm(lp.Point.X, lp.Point.Y, lp.Point.Z) };
                }
            }
            catch { }
            return new RevitLocationSummary { Kind = LocationKind.NONE };
        }

        internal static RevitBoundingBoxMm BoundingBox(Element e)
        {
            try
            {
                BoundingBoxXYZ bb = e.get_BoundingBox(null);
                if (bb == null) return null;
                double[] min = UnitsBoundary.PointFeetToMm(bb.Min.X, bb.Min.Y, bb.Min.Z);
                double[] max = UnitsBoundary.PointFeetToMm(bb.Max.X, bb.Max.Y, bb.Max.Z);
                return new RevitBoundingBoxMm
                {
                    MinMm = min, MaxMm = max,
                    SizeMm = new[] { UnitsBoundary.Round1(max[0] - min[0]), UnitsBoundary.Round1(max[1] - min[1]), UnitsBoundary.Round1(max[2] - min[2]) },
                };
            }
            catch { return null; }
        }

        /// <summary>
        /// Хэмжээс — эх сурвалж нь `BuiltinGeometry` (Wall.Width, curve.Length,
        /// Room.Area) эсвэл LENGTH/AREA spec-тэй `TypedParam`.  Нэгжгүй параметр
        /// ЭНД ОРОХГҮЙ (`ElementParamAllowlist` нь түүнийг `NONE` гэж ил үзүүлнэ).
        /// </summary>
        internal static void Dimensions(Document doc, Element e, ElementType type, RevitElementSummary s)
        {
            Wall wall = e as Wall;
            if (wall != null)
            {
                Add(s, Try(() => UnitsBoundary.LengthMm("width_mm", wall.Width, QuantitySource.BuiltinGeometry, "builtin:Wall.Width")));
                LocationCurve lc = e.Location as LocationCurve;
                if (lc != null && lc.Curve != null)
                    Add(s, Try(() => UnitsBoundary.LengthMm("length_mm", lc.Curve.Length, QuantitySource.BuiltinGeometry, "builtin:LocationCurve.Length")));
                Add(s, ParamLength(e, BuiltInParameter.WALL_USER_HEIGHT_PARAM, "height_mm"));
                Add(s, ParamArea(e, BuiltInParameter.HOST_AREA_COMPUTED, "area_m2"));
                Add(s, ParamVolume(e, BuiltInParameter.HOST_VOLUME_COMPUTED, "volume_m3"));
                return;
            }
            Room room = e as Room;
            if (room != null)
            {
                Add(s, Try(() => UnitsBoundary.AreaM2("area_m2", room.Area, QuantitySource.BuiltinGeometry, "builtin:Room.Area")));
                Add(s, ParamLength(e, BuiltInParameter.ROOM_PERIMETER, "perimeter_mm"));
                Add(s, ParamVolume(e, BuiltInParameter.ROOM_VOLUME, "volume_m3"));
                Add(s, Try(() => UnitsBoundary.LengthMm("unbounded_height_mm", room.UnboundedHeight, QuantitySource.BuiltinGeometry, "builtin:Room.UnboundedHeight")));
                return;
            }
            Floor floor = e as Floor;
            if (floor != null)
            {
                Add(s, ParamLength(type, BuiltInParameter.FLOOR_ATTR_THICKNESS_PARAM, "thickness_mm"));
                Add(s, ParamArea(e, BuiltInParameter.HOST_AREA_COMPUTED, "area_m2"));
                Add(s, ParamVolume(e, BuiltInParameter.HOST_VOLUME_COMPUTED, "volume_m3"));
                return;
            }
            Level lvl = e as Level;
            if (lvl != null)
            {
                Add(s, Try(() => UnitsBoundary.LengthMm("elevation_mm", lvl.Elevation, QuantitySource.BuiltinGeometry, "builtin:Level.Elevation")));
                return;
            }
            if (s.Kind == SceneNodeKind.DOOR || s.Kind == SceneNodeKind.WINDOW)
            {
                // Инстанс дээр байвал түүнийг, үгүй бол төрлийн параметрийг — ЭХ СУРВАЛЖ нь spec-ээр ялгагдана.
                Add(s, ParamLength(e, BuiltInParameter.DOOR_WIDTH, "width_mm") ?? ParamLength(type, BuiltInParameter.DOOR_WIDTH, "width_mm")
                    ?? ParamLength(e, BuiltInParameter.FAMILY_WIDTH_PARAM, "width_mm") ?? ParamLength(type, BuiltInParameter.FAMILY_WIDTH_PARAM, "width_mm"));
                Add(s, ParamLength(e, BuiltInParameter.DOOR_HEIGHT, "height_mm") ?? ParamLength(type, BuiltInParameter.DOOR_HEIGHT, "height_mm")
                    ?? ParamLength(e, BuiltInParameter.FAMILY_HEIGHT_PARAM, "height_mm") ?? ParamLength(type, BuiltInParameter.FAMILY_HEIGHT_PARAM, "height_mm"));
                Add(s, ParamLength(e, BuiltInParameter.INSTANCE_HEAD_HEIGHT_PARAM, "head_height_mm"));
                Add(s, ParamLength(e, BuiltInParameter.INSTANCE_SILL_HEIGHT_PARAM, "sill_height_mm"));
                return;
            }
            // Бусад: bbox-ийн хэмжээ л (эх сурвалж = геометр, ойролцоо).
            if (s.BoundingBox != null && s.BoundingBox.SizeMm != null)
            {
                Add(s, new Measure { Name = "bbox_x_mm", Value = s.BoundingBox.SizeMm[0], Unit = Units.Mm, Source = MeasureSource.COMPUTED, SpecId = "computed:bbox" });
                Add(s, new Measure { Name = "bbox_y_mm", Value = s.BoundingBox.SizeMm[1], Unit = Units.Mm, Source = MeasureSource.COMPUTED, SpecId = "computed:bbox" });
                Add(s, new Measure { Name = "bbox_z_mm", Value = s.BoundingBox.SizeMm[2], Unit = Units.Mm, Source = MeasureSource.COMPUTED, SpecId = "computed:bbox" });
            }
        }

        internal static Measure ParamLength(Element e, BuiltInParameter bip, string name)
        {
            return ParamMeasure(e, bip, name, SpecTypeId.Length, UnitTypeId.Millimeters, Units.Mm);
        }
        internal static Measure ParamArea(Element e, BuiltInParameter bip, string name)
        {
            return ParamMeasure(e, bip, name, SpecTypeId.Area, UnitTypeId.SquareMeters, Units.M2);
        }
        internal static Measure ParamVolume(Element e, BuiltInParameter bip, string name)
        {
            return ParamMeasure(e, bip, name, SpecTypeId.Volume, UnitTypeId.CubicMeters, Units.M3);
        }

        /// <summary>
        /// ⚠️ SPEC-ЭЭР ХӨРВҮҮЛНЭ, нэрээр БИШ (`Units.cs`-ийн «Өргөн» жишээ).
        /// Параметрийн spec нь хүлээсэнтэй зөрвөл `null` — «тэр параметр биш».
        /// </summary>
        private static Measure ParamMeasure(Element e, BuiltInParameter bip, string name, ForgeTypeId wantSpec, ForgeTypeId unit, string unitCode)
        {
            if (e == null) return null;
            try
            {
                Parameter p = e.get_Parameter(bip);
                if (p == null || !p.HasValue || p.StorageType != StorageType.Double) return null;
                ForgeTypeId spec = p.Definition.GetDataType();
                if (spec == null || !spec.Equals(wantSpec)) return null;
                double v = UnitUtils.ConvertFromInternalUnits(p.AsDouble(), unit);
                double rounded = unitCode == Units.Mm ? UnitsBoundary.Round1(v) : Math.Round(v, 3);
                return UnitsBoundary.FromQuantity(name, Quantity.Of(rounded, unitCode, QuantitySource.TypedParam, spec.TypeId));
            }
            catch { return null; }
        }

        private static void Rooms(Document doc, Element e, RevitElementSummary s)
        {
            var r = new RevitRoomRelations();
            bool any = false;
            try
            {
                FamilyInstance fi = e as FamilyInstance;
                if (fi != null)
                {
                    try { Room fr = fi.FromRoom; if (fr != null) { r.FromRoom = Ref(fr); any = true; } } catch { }
                    try { Room tr = fi.ToRoom; if (tr != null) { r.ToRoom = Ref(tr); any = true; } } catch { }
                    try { Room rr = fi.Room; if (rr != null) { r.InRoom = Ref(rr); any = true; } } catch { }
                }
            }
            catch { }
            if (any) s.Rooms = r;
        }

        private static void Materials(Document doc, Element e, RevitElementSummary s)
        {
            try
            {
                int n = 0;
                foreach (ElementId mid in e.GetMaterialIds(false))
                {
                    Element m = doc.GetElement(mid);
                    if (m != null) s.Materials.Add(Trim(m.Name));
                    if (++n >= 8) break;
                }
            }
            catch { }
        }

        /* ============================================================== */
        /*  туслах                                                         */
        /* ============================================================== */

        private static void Add(RevitElementSummary s, Measure m) { if (m != null) s.Dimensions.Add(m); }

        private static Measure Try(Func<Measure> f)
        {
            try { return f(); } catch { return null; }
        }

        internal static T Safe<T>(Func<T> f)
        {
            try { return f(); } catch { return default(T); }
        }

        internal static string Trim(string s)
        {
            if (string.IsNullOrWhiteSpace(s)) return null;
            s = s.Trim();
            return s.Length > 120 ? s.Substring(0, 120) : s;
        }
    }

    /// <summary>
    /// ПАРАМЕТРИЙН ЦАГААН ЖАГСААЛТ (R-16) — категори тутамд хэдхэн built-in.
    /// Утга нь `AsValueString()` (Revit-ийн өөрийн нэгжтэй хүний мөр) + тоон бол
    /// spec-ээр хөрвүүлсэн `Measure`.  Нэгжгүй тоо → `NONE`, ил.
    /// </summary>
    internal static class ElementParamAllowlist
    {
        private static readonly (BuiltInParameter bip, string name, bool type)[] Walls =
        {
            (BuiltInParameter.WALL_ATTR_WIDTH_PARAM, "Width", true),
            (BuiltInParameter.WALL_BASE_CONSTRAINT, "Base Constraint", false),
            (BuiltInParameter.WALL_HEIGHT_TYPE, "Top Constraint", false),
            (BuiltInParameter.WALL_USER_HEIGHT_PARAM, "Unconnected Height", false),
            (BuiltInParameter.WALL_STRUCTURAL_SIGNIFICANT, "Structural", false),
            (BuiltInParameter.FUNCTION_PARAM, "Function", true),
            (BuiltInParameter.FIRE_RATING, "Fire Rating", true),
            (BuiltInParameter.ALL_MODEL_MARK, "Mark", false),
        };
        private static readonly (BuiltInParameter bip, string name, bool type)[] Openings =
        {
            (BuiltInParameter.DOOR_WIDTH, "Width", true),
            (BuiltInParameter.DOOR_HEIGHT, "Height", true),
            (BuiltInParameter.FAMILY_WIDTH_PARAM, "Width", true),
            (BuiltInParameter.FAMILY_HEIGHT_PARAM, "Height", true),
            (BuiltInParameter.INSTANCE_SILL_HEIGHT_PARAM, "Sill Height", false),
            (BuiltInParameter.INSTANCE_HEAD_HEIGHT_PARAM, "Head Height", false),
            (BuiltInParameter.FIRE_RATING, "Fire Rating", true),
            (BuiltInParameter.ALL_MODEL_MARK, "Mark", false),
        };
        private static readonly (BuiltInParameter bip, string name, bool type)[] Rooms =
        {
            (BuiltInParameter.ROOM_NUMBER, "Number", false),
            (BuiltInParameter.ROOM_NAME, "Name", false),
            (BuiltInParameter.ROOM_AREA, "Area", false),
            (BuiltInParameter.ROOM_PERIMETER, "Perimeter", false),
            (BuiltInParameter.ROOM_VOLUME, "Volume", false),
            (BuiltInParameter.ROOM_DEPARTMENT, "Department", false),
            (BuiltInParameter.ROOM_OCCUPANCY, "Occupancy", false),
        };
        private static readonly (BuiltInParameter bip, string name, bool type)[] Floors =
        {
            (BuiltInParameter.FLOOR_ATTR_THICKNESS_PARAM, "Thickness", true),
            (BuiltInParameter.FLOOR_HEIGHTABOVELEVEL_PARAM, "Height Offset From Level", false),
            (BuiltInParameter.HOST_AREA_COMPUTED, "Area", false),
            (BuiltInParameter.ALL_MODEL_MARK, "Mark", false),
        };
        private static readonly (BuiltInParameter bip, string name, bool type)[] Levels =
        {
            (BuiltInParameter.LEVEL_ELEV, "Elevation", false),
        };
        private static readonly (BuiltInParameter bip, string name, bool type)[] Generic =
        {
            (BuiltInParameter.ALL_MODEL_MARK, "Mark", false),
            (BuiltInParameter.ALL_MODEL_INSTANCE_COMMENTS, "Comments", false),
        };

        internal static void Fill(Document doc, Element e, ElementType type, RevitElementSummary s)
        {
            (BuiltInParameter bip, string name, bool type)[] list;
            switch (s.Kind)
            {
                case SceneNodeKind.WALL: list = Walls; break;
                case SceneNodeKind.DOOR:
                case SceneNodeKind.WINDOW: list = Openings; break;
                case SceneNodeKind.ROOM: list = Rooms; break;
                case SceneNodeKind.FLOOR: list = Floors; break;
                case SceneNodeKind.LEVEL: list = Levels; break;
                default: list = Generic; break;
            }
            var seen = new HashSet<string>(StringComparer.Ordinal);
            foreach (var entry in list)
            {
                Element src = entry.type ? (Element)type ?? e : e;
                Parameter p = null;
                try { p = src.get_Parameter(entry.bip); } catch { }
                if (p == null && entry.type) { try { p = e.get_Parameter(entry.bip); } catch { } }
                if (p == null || !p.HasValue) continue;
                if (!seen.Add(entry.name)) continue;
                var pv = new RevitParamValue { Name = entry.name, IsTypeParam = entry.type, IsReadOnly = RevitContextExtractor.Safe(() => p.IsReadOnly) };
                try { pv.Value = RevitContextExtractor.Trim(p.AsValueString() ?? p.AsString()); } catch { }
                if (p.StorageType == StorageType.Double) pv.Measure = MeasureOf(p, entry.name);
                else if (p.StorageType == StorageType.Integer) pv.Measure = UnitsBoundary.Raw(entry.name, p.AsInteger(), null);
                s.Params.Add(pv);
            }
        }

        /// <summary>Spec-ээр нэгж сонгоно; хэмжигдэхгүй spec → `Raw` (NONE, UNTYPED).</summary>
        internal static Measure MeasureOf(Parameter p, string name)
        {
            try
            {
                double raw = p.AsDouble();
                ForgeTypeId spec = p.Definition.GetDataType();
                if (spec != null && UnitUtils.IsMeasurableSpec(spec))
                {
                    if (spec.Equals(SpecTypeId.Length))
                        return UnitsBoundary.FromQuantity(name, Quantity.Of(UnitsBoundary.Round1(UnitUtils.ConvertFromInternalUnits(raw, UnitTypeId.Millimeters)), Units.Mm, QuantitySource.TypedParam, spec.TypeId));
                    if (spec.Equals(SpecTypeId.Area))
                        return UnitsBoundary.FromQuantity(name, Quantity.Of(Math.Round(UnitUtils.ConvertFromInternalUnits(raw, UnitTypeId.SquareMeters), 3), Units.M2, QuantitySource.TypedParam, spec.TypeId));
                    if (spec.Equals(SpecTypeId.Volume))
                        return UnitsBoundary.FromQuantity(name, Quantity.Of(Math.Round(UnitUtils.ConvertFromInternalUnits(raw, UnitTypeId.CubicMeters), 3), Units.M3, QuantitySource.TypedParam, spec.TypeId));
                    if (spec.Equals(SpecTypeId.Angle))
                        return UnitsBoundary.FromQuantity(name, Quantity.Of(Math.Round(UnitUtils.ConvertFromInternalUnits(raw, UnitTypeId.Degrees), 2), Units.Deg, QuantitySource.TypedParam, spec.TypeId));
                    // Бусад хэмжигдэх spec (даралт, температур …) — энэ релизэд толь байхгүй тул хөрвүүлэхгүй, ил тэмдэглэнэ.
                    return UnitsBoundary.FromQuantity(name, Quantity.Of(raw, Units.None, QuantitySource.TypedParam, spec.TypeId));
                }
                return UnitsBoundary.Raw(name, raw, spec != null ? spec.TypeId : null);
            }
            catch { return null; }
        }
    }
}
