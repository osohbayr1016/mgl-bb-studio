using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Architecture;
using RevitMcpAddin.ChangeImpact.Core;
using RevitMcpAddin.Smart.Core;

namespace RevitMcpAddin.ChangeImpact
{
    /// <summary>
    /// ӨМНӨ / ДАРАА төлөвийг ХУУЛСАН `StateSnapshot` (SI, Revit обьектгүй) болгон уншина.
    ///
    /// ГЭРЭЭ:
    ///   • ЗӨВХӨН УНШИНА (транзакц нээхгүй, загвар өөрчлөхгүй).  ӨМНӨ ба ДАРАА АДИЛХАН `CaptureSpec`-ээр — харьцуулах хосууд зөрөхгүй.
    ///   • Шинжилгээний явцад алдаа (элемент уншигдсангүй, API шидсэн) → `IncompleteReasons` (ЧИМЭЭГҮЙ алгасахгүй, «0» болгохгүй).
    ///   • Revit-ийн амьд обьектыг (Element, Room, GeometryObject) буцаахгүй.
    /// </summary>
    /// <summary>Нэг уншилтад аль хэсгийг унших вэ.  Quick = `Core`; Deep = үлдсэн үнэтэй шалгалтууд.</summary>
    [Flags]
    internal enum CaptureStages
    {
        None = 0,
        /// <summary>Хана, өрөө, хэмжээс, хаалга/цонх (орчны зайгүй), холбогдсон хана.</summary>
        Core = 1,
        Schedules = 2,
        Clash = 4,
        Egress = 8,
        Clearance = 16,
        Deep = Schedules | Clash | Egress | Clearance,
        All = Core | Deep,
    }

    internal static class PreChangeCapture
    {
        internal const int MaxRooms = 200;
        internal const int MaxJoined = 20;
        /// <summary>Өрөөний хил (GetBoundarySegments) уншихад зарцуулах дээд хугацаа (мс).</summary>
        private const int RoomBoundaryBudgetMs = 2500;

        /* ============================== PLAN (спец бэлдэх) =================== */

        /// <summary>
        /// Байрлуулсан ч хаалттай БИШ өрөөний (талбай 0) индекс — bbox-гүй тул bbox шүүлтэд ордоггүй; хөдөлгөөнөөр хаагдаж болох тул БҮХ өрөөг НЭГ удаа скан хийж
        /// (≤8000) байрлалын цэгийг нь хадгална.  Зайнаас ХАМААРАХГҮЙ тул кэшлэгдэж, 200 → 300 → 450 мм-д дахин скан хийхгүй.
        /// </summary>
        internal static UnenclosedRoomIndex BuildUnenclosedIndex(Document doc)
        {
            var idx = new UnenclosedRoomIndex();
            try
            {
                int scanned = 0;
                foreach (Element e in new FilteredElementCollector(doc).OfCategory(BuiltInCategory.OST_Rooms).WhereElementIsNotElementType())
                {
                    if (++scanned > 8000) { idx.Notes.Add("Өрөө 8000-аас олон — хаалттай биш өрөөний хайлтыг таслав."); break; }
                    var room = e as Room;
                    if (room == null || room.Area > 1e-6) continue;
                    var lp = room.Location as LocationPoint;
                    if (lp == null) continue;
                    idx.Ids.Add(room.Id.Value);
                    idx.Points.Add(new[] { lp.Point.X, lp.Point.Y });
                }
            }
            catch (Exception ex)
            {
                idx.Notes.Add("Хаалттай биш өрөөний хайлт амжилтгүй (" + ex.GetType().Name + ").");
            }
            return idx;
        }

        /// <summary>Нэр дэвшигч өрөө — хөдөлгөөний хүрээнд (bbox) + байрлалын цэг нь хүрээнд байгаа «хаалттай биш» өрөө.</summary>
        internal static List<long> PlanRooms(Document doc, Wall wall, XYZ moveFt, List<string> incomplete, UnenclosedRoomIndex unenclosed = null)
        {
            Outline region = PreChangeClashProbe.Region(wall, moveFt);
            if (region == null)
            {
                incomplete.Add("Хананы хэмжээ (bounding box) уншигдсангүй — нэр дэвшигч өрөөг олж чадсангүй.");
                return new List<long>();
            }
            return PlanRoomsIn(doc, region, incomplete, unenclosed, null);
        }

        /// <summary>
        /// Нэр дэвшигч өрөө — `region` (дотоод нэгж) -ийн bbox-той огтлолцох өрөө + хаалттай биш өрөөний цэг.  `seed` өгвөл (хаалганы From/To, хөдөлгөөний цэг дэх өрөө) ЭХЭНД орно.
        /// Хана, хаалга зөөхөд ИЖИЛ логик.
        /// </summary>
        internal static List<long> PlanRoomsIn(Document doc, Outline region, List<string> incomplete, UnenclosedRoomIndex unenclosed, IEnumerable<long> seed)
        {
            var ids = new List<long>();
            var seen = new HashSet<long>();
            if (seed != null)
                foreach (long sid in seed)
                    if (sid > 0 && seen.Add(sid)) ids.Add(sid);

            // `region == null` = хүрээ тодорхойгүй (bbox уншигдаагүй) — зөвхөн `seed` өрөөнүүд; хоосон хүрээгээр (0,0,0) өрөө ХАЙХГҮЙ.
            if (region != null)
            {
                try
                {
                    foreach (ElementId id in new FilteredElementCollector(doc).OfCategory(BuiltInCategory.OST_Rooms).WhereElementIsNotElementType()
                        .WherePasses(new BoundingBoxIntersectsFilter(region)).ToElementIds())
                        if (seen.Add(id.Value)) ids.Add(id.Value);
                }
                catch (Exception ex)
                {
                    incomplete.Add("Нэр дэвшигч өрөөг олж чадсангүй (" + ex.GetType().Name + ").");
                }

                // Байрлуулсан ч хаалттай БИШ өрөө — байрлалын цэгээр нэмнэ (индекс кэшлэгдсэн үед скан хийхгүй).
                UnenclosedRoomIndex idx = unenclosed ?? BuildUnenclosedIndex(doc);
                incomplete.AddRange(idx.Notes);
                double pad = PcUnits.ToInternalMm(1000);
                for (int i = 0; i < idx.Ids.Count; i++)
                {
                    if (seen.Contains(idx.Ids[i])) continue;
                    double x = idx.Points[i][0], y = idx.Points[i][1];
                    if (x >= region.MinimumPoint.X - pad && x <= region.MaximumPoint.X + pad && y >= region.MinimumPoint.Y - pad && y <= region.MaximumPoint.Y + pad)
                    {
                        seen.Add(idx.Ids[i]);
                        ids.Add(idx.Ids[i]);
                    }
                }
            }

            if (ids.Count > MaxRooms)
            {
                incomplete.Add("Нэр дэвшигч өрөө " + ids.Count + " — эхний " + MaxRooms + "-г л шалгав.");
                ids = ids.Take(MaxRooms).ToList();
            }
            return ids;
        }

        /// <summary>Ханатай холбогдсон (join) хөрш ханууд.</summary>
        internal static List<long> PlanJoined(Document doc, Wall wall, List<string> incomplete)
        {
            var ids = new HashSet<long>();
            try
            {
                var lc = wall.Location as LocationCurve;
                if (lc != null)
                    for (int end = 0; end < 2; end++)
                    {
                        ElementArray arr = lc.get_ElementsAtJoin(end);
                        if (arr == null) continue;
                        foreach (Element e in arr)
                            if (e is Wall && e.Id != wall.Id) ids.Add(e.Id.Value);
                    }
            }
            catch (Exception ex) { incomplete.Add("Ханын төгсгөлийн холболтыг уншиж чадсангүй (" + ex.GetType().Name + ")."); }

            try
            {
                foreach (ElementId id in JoinGeometryUtils.GetJoinedElements(doc, wall))
                    if (doc.GetElement(id) is Wall) ids.Add(id.Value);
            }
            catch (Exception ex) { incomplete.Add("Ханын join-ийг уншиж чадсангүй (" + ex.GetType().Name + ")."); }

            if (ids.Count > MaxJoined)
            {
                incomplete.Add("Холбогдсон хана " + ids.Count + " — эхний " + MaxJoined + "-г л авав.");
                return ids.Take(MaxJoined).ToList();
            }
            return ids.ToList();
        }

        /* ============================== READ ================================ */

        /// <summary>
        /// Нэг төлвийг (ӨМНӨ эсвэл ДАРАА) шатаар унших.  `stages` = аль хэсгийг; `clock` ≠ null бол дэд шат бүрийн ҮНЭН хугацааг (`prefix + "rooms_ms"` г.м.) бүртгэнэ.
        /// `memo` ≠ null БОЛ ЗӨВХӨН ӨМНӨХ төлөв (хөдөлгөөнгүй) — зайнаас хамаарахгүй тул аль хэдийн уншсаныг дахин уншихгүй, шинийг memo-д хадгална.
        /// ⚠️ ДАРАА төлөвт memo ХЭЗЭЭ Ч дамжуулахгүй.
        /// </summary>
        internal static StateSnapshot Read(Document doc, CaptureSpec spec, CaptureStages stages, int clashBudgetMs, StageClock clock, string prefix, BeforeMemo memo)
        {
            var snap = new StateSnapshot();
            try
            {
                if ((stages & CaptureStages.Core) != 0)
                {
                    Time(clock, prefix + "source", () =>
                    {
                        if (memo != null && memo.Source != null) snap.Source = memo.Source;
                        else
                        {
                            snap.Source = ReadPlace(doc, spec.SourceId);
                            if (memo != null && snap.Source != null) memo.Source = snap.Source;
                        }
                        snap.SourceDeleted = snap.Source == null;
                    });
                    Time(clock, prefix + "rooms", () => ReadRooms(doc, spec, snap, memo));
                    Time(clock, prefix + "dimensions", () => ReadDimensions(doc, spec, snap, memo));
                    Time(clock, prefix + "hosted", () => ReadHosted(doc, spec, snap, memo));
                    Time(clock, prefix + "joined", () => ReadJoined(doc, spec, snap, memo));
                }
                if ((stages & CaptureStages.Clearance) != 0)
                    Time(clock, prefix + "clearance", () => ReadClearance(doc, spec, snap, memo));
                if ((stages & CaptureStages.Schedules) != 0)
                    Time(clock, prefix + "schedules", () => ReadSchedules(doc, spec, snap, memo));
                if ((stages & CaptureStages.Clash) != 0)
                    Time(clock, prefix + "mep", () => snap.Clash = PreChangeClashProbe.Read(doc, spec.Clash, spec.SourceId, clashBudgetMs, memo));
                if ((stages & CaptureStages.Egress) != 0)
                    Time(clock, prefix + "egress", () => snap.Egress = PreChangeEgressProbe.Read(doc, spec.Egress, memo));
                snap.Captured = true;
            }
            catch (Exception ex)
            {
                snap.Captured = false;
                snap.IncompleteReasons.Add("Төлөвийг уншиж чадсангүй (" + ex.GetType().Name + ").");
                SmartLog.Error("prechange", "capture_failed", ex);
            }
            snap.IncompleteReasons = snap.IncompleteReasons.Distinct(StringComparer.Ordinal).ToList();
            snap.AdvisoryReasons = snap.AdvisoryReasons.Distinct(StringComparer.Ordinal).ToList();
            return snap;
        }

        private static void Time(StageClock clock, string stage, Action work)
        {
            if (clock == null) work();
            else clock.Measure(stage + "_ms", work);
        }

        /// <summary>Байрлал (мм) ЗӨВХӨН — хурдан (restore probe, settled тулгалт).  Цэг: [x,y,z]; шугам: [x1,y1,z1,x2,y2,z2]; байхгүй бол null.</summary>
        internal static double[] ReadLocation(Element e)
        {
            try
            {
                var lc = e.Location as LocationCurve;
                var lp = e.Location as LocationPoint;
                if (lc != null) return PcUnits.LineMm(lc.Curve);
                if (lp != null) return PcUnits.PointMm(lp.Point);
            }
            catch (Exception) { }
            return null;
        }

        internal static ElementPlace ReadPlace(Document doc, long id)
        {
            Element e = doc.GetElement(new ElementId(id));
            if (e == null) return null;
            var p = new ElementPlace { Id = id };
            try { p.Uid = e.UniqueId; } catch (Exception) { }
            try { p.Category = e.Category != null ? e.Category.Name : null; } catch (Exception) { }
            try
            {
                Element t = doc.GetElement(e.GetTypeId());
                p.Name = t != null ? t.Name : e.Name;
            }
            catch (Exception) { }
            try
            {
                var lc = e.Location as LocationCurve;
                var lp = e.Location as LocationPoint;
                if (lc != null) p.Location = PcUnits.LineMm(lc.Curve);
                else if (lp != null) p.Location = PcUnits.PointMm(lp.Point);
            }
            catch (Exception) { }
            return p;
        }

        /* ---------- өрөө ---------- */

        private static void ReadRooms(Document doc, CaptureSpec spec, StateSnapshot snap, BeforeMemo memo)
        {
            var sw = Stopwatch.StartNew();
            int skippedBoundary = 0;
            foreach (long id in spec.RoomIds)
            {
                RoomSnap cached;
                if (memo != null && memo.Rooms.TryGetValue(id, out cached)) { snap.Rooms[id] = cached; continue; }
                var room = doc.GetElement(new ElementId(id)) as Room;
                if (room == null) continue;                     // алга — Core «алга болно / байхгүй» гэж тайлбарлана
                var r = new RoomSnap { Id = id };
                try
                {
                    try { r.Uid = room.UniqueId; } catch (Exception) { }
                    r.Number = ParamText(room, BuiltInParameter.ROOM_NUMBER);
                    r.Name = ParamText(room, BuiltInParameter.ROOM_NAME);
                    r.Phase = ParamValueText(room, BuiltInParameter.ROOM_PHASE);
                    try { Level lv = room.Level; r.Level = lv != null ? lv.Name : null; } catch (Exception) { }
                    r.Placed = room.Location != null;
                    double area = room.Area;
                    r.Enclosed = r.Placed && area > 1e-6;
                    r.AreaM2 = r.Enclosed ? PcUnits.M2(area) : 0;
                    try { if (r.Enclosed) r.PerimeterM = PcUnits.M(room.Perimeter); } catch (Exception) { }
                    r.Readable = true;

                    if (r.Enclosed)
                    {
                        if (sw.ElapsedMilliseconds > RoomBoundaryBudgetMs) skippedBoundary++;
                        else r.BoundedBySource = RoomBoundedBy(room, spec.BoundaryId);
                    }
                }
                catch (Exception)
                {
                    r.Readable = false;
                }
                snap.Rooms[id] = r;
                // Зөвхөн ТӨГС уншигдсаныг (хилийн хугацааны хязгаарт ороогүй) memo-д хадгална — алгассан өрөө дараа нь дахин оролдогдоно.
                if (memo != null && r.Readable && !(r.Enclosed && sw.ElapsedMilliseconds > RoomBoundaryBudgetMs)) memo.Rooms[id] = r;
            }
            if (skippedBoundary > 0)
                snap.CaptureNotes.Add(skippedBoundary + " өрөөний хилийг (ханатай холбоо) хугацааны хязгаараас болж шалгаагүй — талбайн өөрчлөлт хэвээр хэмжигдсэн.");
        }

        private static bool RoomBoundedBy(Room room, long wallId)
        {
            try
            {
                IList<IList<BoundarySegment>> loops = room.GetBoundarySegments(new SpatialElementBoundaryOptions());
                if (loops == null) return false;
                foreach (IList<BoundarySegment> loop in loops)
                    foreach (BoundarySegment seg in loop)
                        if (seg.ElementId != null && seg.ElementId.Value == wallId) return true;
            }
            catch (Exception) { /* хил уншигдсангүй — «хилийг үүсгэнэ» гэж ТҮГЖИХГҮЙ, зөвхөн тэмдэглэгээ */ }
            return false;
        }

        private static string ParamText(Element e, BuiltInParameter bip)
        {
            try { Parameter p = e.get_Parameter(bip); return p != null ? p.AsString() : null; }
            catch (Exception) { return null; }
        }

        private static string ParamValueText(Element e, BuiltInParameter bip)
        {
            try { Parameter p = e.get_Parameter(bip); return p != null ? p.AsValueString() : null; }
            catch (Exception) { return null; }
        }

        /* ---------- хэмжээс ---------- */

        private static void ReadDimensions(Document doc, CaptureSpec spec, StateSnapshot snap, BeforeMemo memo)
        {
            foreach (long id in spec.DimIds)
            {
                DimSnap cached;
                if (memo != null && memo.Dimensions.TryGetValue(id, out cached)) { snap.Dimensions[id] = cached; continue; }
                var dim = doc.GetElement(new ElementId(id)) as Dimension;
                if (dim == null) continue;
                var d = new DimSnap { Id = id };
                try
                {
                    try { d.Uid = dim.UniqueId; } catch (Exception) { }
                    try { d.Name = dim.DimensionType != null ? dim.DimensionType.Name : null; } catch (Exception) { }
                    try
                    {
                        d.OwnerViewId = dim.OwnerViewId != null ? dim.OwnerViewId.Value : 0;
                        var v = doc.GetElement(dim.OwnerViewId) as View;
                        d.ViewName = v != null ? v.Name : null;
                    }
                    catch (Exception) { }

                    if (dim.DimensionShape != DimensionShape.Linear)
                    {
                        d.Readable = false;
                        d.UnreadableReason = "Шугаман биш хэмжээс";
                    }
                    else if (dim.NumberOfSegments > 1)
                    {
                        bool ok = true;
                        foreach (DimensionSegment seg in dim.Segments)
                        {
                            double? v = seg.Value;
                            if (!v.HasValue) { ok = false; break; }
                            d.SegmentsMm.Add(PcUnits.Mm(v.Value));
                        }
                        d.Readable = ok;
                    }
                    else
                    {
                        double? v = dim.Value;
                        if (v.HasValue) { d.SegmentsMm.Add(PcUnits.Mm(v.Value)); d.Readable = true; }
                        else d.Readable = false;
                    }
                }
                catch (Exception ex)
                {
                    d.Readable = false;
                    d.UnreadableReason = ex.GetType().Name;
                }
                snap.Dimensions[id] = d;
                if (memo != null) memo.Dimensions[id] = d;
            }
        }

        /* ---------- хаалга, цонх ---------- */

        private static void ReadHosted(Document doc, CaptureSpec spec, StateSnapshot snap, BeforeMemo memo)
        {
            foreach (long id in spec.HostedIds)
            {
                HostedSnap cached;
                if (memo != null && memo.Hosted.TryGetValue(id, out cached)) { snap.Hosted[id] = BeforeMemo.CloneHosted(cached); continue; }

                var fi = doc.GetElement(new ElementId(id)) as FamilyInstance;
                var h = new HostedSnap { Id = id };
                if (fi == null) { h.Exists = false; snap.Hosted[id] = h; continue; }
                bool ok = true;
                try
                {
                    try { h.Uid = fi.UniqueId; } catch (Exception) { }
                    try { h.Category = fi.Category != null ? fi.Category.Name : null; } catch (Exception) { }
                    try { h.Name = fi.Symbol != null ? fi.Symbol.FamilyName + " : " + fi.Symbol.Name : fi.Name; } catch (Exception) { }
                    var lp = fi.Location as LocationPoint;
                    if (lp != null) h.LocationMm = PcUnits.PointMm(lp.Point);
                    try
                    {
                        Element host = fi.Host;
                        h.HostId = host != null ? host.Id.Value : 0;
                        h.HostKnown = true;
                    }
                    catch (Exception) { h.HostKnown = false; }

                    try
                    {
                        Room from = fi.FromRoom, to = fi.ToRoom;
                        h.FromRoomId = from != null ? from.Id.Value : 0;
                        h.ToRoomId = to != null ? to.Id.Value : 0;
                        h.FromRoomName = from != null ? PreChangeWallRules.RoomLabel(from) : null;
                        h.ToRoomName = to != null ? PreChangeWallRules.RoomLabel(to) : null;
                        h.RoomsReadable = true;
                    }
                    catch (Exception) { h.RoomsReadable = false; }
                    h.ClearanceEvaluated = false;
                    h.ClearanceNote = "Орчны зайг тусдаа шатанд хэмжинэ.";
                    h.Mark = PreChangeDoorRules.MarkOf(fi);
                    // Хаалганы эргэлт (flip): зөөхөд хадгалагдах ёстой.  Уншигдахгүй бол «мэдэгдэхгүй» — ХЭЗЭЭ Ч «өөрчлөгдөөгүй» гэж үзэхгүй.
                    try { h.FacingFlipped = fi.FacingFlipped; h.HandFlipped = fi.HandFlipped; h.FlipKnown = true; }
                    catch (Exception) { h.FlipKnown = false; }
                }
                catch (Exception ex)
                {
                    ok = false;
                    snap.IncompleteReasons.Add("Хаалга/цонхыг уншиж чадсангүй (" + ex.GetType().Name + ").");
                }
                snap.Hosted[id] = h;
                if (memo != null && ok) memo.Hosted[id] = BeforeMemo.CloneHosted(h);
            }
        }

        /// <summary>
        /// Хаалганы ОРЧНЫ ЗАЙ (3D харагдацын ray) — ӨӨР ШАТ: хамгийн үнэтэй (хаалга бүрд 2 ray) тул гүн шатанд л.  `snap.Hosted`-д хаалга байхгүй (ЗӨВХӨН
        /// энэ шатыг уншсан) бол зөвхөн орчны зайтай HostedSnap үүсгэнэ — `PreChangeSnapshots.Merge` үндсэн snapshot-д id-аар нь нэгтгэнэ.
        /// </summary>
        private static void ReadClearance(Document doc, CaptureSpec spec, StateSnapshot snap, BeforeMemo memo)
        {
            View3D v3 = null;
            if (spec.Clearance3dViewId != 0) v3 = doc.GetElement(new ElementId(spec.Clearance3dViewId)) as View3D;

            foreach (long id in spec.HostedIds)
            {
                HostedSnap h;
                if (!snap.Hosted.TryGetValue(id, out h)) { h = new HostedSnap { Id = id }; snap.Hosted[id] = h; }

                ClearanceMemo cm;
                if (memo != null && memo.Clearance.TryGetValue(id, out cm))
                {
                    h.ClearanceMm = cm.Mm; h.ClearanceEvaluated = cm.Evaluated; h.ClearanceNote = cm.Note;
                    continue;
                }

                var fi = doc.GetElement(new ElementId(id)) as FamilyInstance;
                if (fi == null) { h.Exists = false; continue; }
                try
                {
                    bool isDoor = fi.Category != null && fi.Category.Id.Value == (long)BuiltInCategory.OST_Doors;
                    if (!isDoor)
                    {
                        h.ClearanceEvaluated = false;
                        h.ClearanceNote = "Орчны зайг зөвхөн хаалгад хэмжинэ.";
                    }
                    else if (v3 == null)
                    {
                        h.ClearanceEvaluated = false;
                        h.ClearanceNote = spec.ClearanceProblem ?? "3D харагдац олдсонгүй.";
                    }
                    else
                    {
                        string note;
                        double? mm = PreChangeClearanceProbe.Measure(doc, v3, fi, out note);
                        h.ClearanceMm = mm;
                        h.ClearanceEvaluated = mm.HasValue;
                        h.ClearanceNote = note;
                    }
                }
                catch (Exception ex)
                {
                    h.ClearanceEvaluated = false;
                    h.ClearanceNote = "Орчны зайг хэмжиж чадсангүй (" + ex.GetType().Name + ").";
                }
                if (memo != null && h.ClearanceEvaluated) memo.Clearance[id] = new ClearanceMemo { Mm = h.ClearanceMm, Evaluated = true, Note = h.ClearanceNote };
            }
        }

        /* ---------- холбогдсон хана ---------- */

        private static void ReadJoined(Document doc, CaptureSpec spec, StateSnapshot snap, BeforeMemo memo)
        {
            foreach (long id in spec.JoinedIds)
            {
                ElementPlace cached;
                if (memo != null && memo.Joined.TryGetValue(id, out cached)) { snap.Joined[id] = cached; continue; }
                ElementPlace p = ReadPlace(doc, id);
                if (p != null) { snap.Joined[id] = p; if (memo != null) memo.Joined[id] = p; }
            }
        }

        /* ---------- хүснэгт ---------- */

        private static void ReadSchedules(Document doc, CaptureSpec spec, StateSnapshot snap, BeforeMemo memo)
        {
            if (spec.Schedules.Count == 0 || spec.ScheduleCandidateIds.Count == 0) return;
            ElementIdSetFilter filter = null;

            foreach (ScheduleRef s in spec.Schedules)
            {
                ScheduleSnap cached;
                if (memo != null && memo.Schedules.TryGetValue(s.Id, out cached)) { snap.Schedules[s.Id] = BeforeMemo.CloneSchedule(cached); continue; }
                if (filter == null)
                {
                    try { filter = new ElementIdSetFilter(spec.ScheduleCandidateIds.Select(i => new ElementId(i)).ToList()); }
                    catch (Exception ex) { snap.AdvisoryReasons.Add("Хүснэгтийн шүүлт бэлдэж чадсангүй (" + ex.GetType().Name + ")."); return; }
                }
                var ss = new ScheduleSnap { Id = s.Id, Name = s.Name };
                try
                {
                    foreach (ElementId id in new FilteredElementCollector(doc, new ElementId(s.Id)).WherePasses(filter).ToElementIds())
                        ss.Members.Add(id.Value);
                    ss.Evaluated = true;
                }
                catch (Exception) { ss.Evaluated = false; }
                snap.Schedules[s.Id] = ss;
                if (memo != null && ss.Evaluated) memo.Schedules[s.Id] = BeforeMemo.CloneSchedule(ss);
            }
        }

        /// <summary>
        /// Хүснэгтийн мөрийг элементээр шүүх нь Revit-ийн баримтжуулалтад БАЙХГҮЙ (hub-ийн тэмдэглэл) — тиймээс ӨМНӨ ба ДАРАА хоёулаа ХООСОН бол
        /// «гишүүнчлэл өөрчлөгдөөгүй» БИШ, «шалгаж чадаагүй».  Хоёр snapshot-ыг хамт дуудаж тэмдэглэнэ.
        /// </summary>
        internal static void FinalizeSchedules(StateSnapshot before, StateSnapshot after)
        {
            foreach (long id in before.Schedules.Keys.ToList())
            {
                ScheduleSnap b = before.Schedules[id], a;
                if (!after.Schedules.TryGetValue(id, out a)) { b.Evaluated = false; continue; }
                if (b.Evaluated && a.Evaluated && b.Members.Count == 0 && a.Members.Count == 0)
                {
                    b.Evaluated = false;
                    a.Evaluated = false;
                }
            }
        }
    }
}
