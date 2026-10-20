using System;
using System.Collections.Generic;
using System.Linq;
using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Architecture;
using Autodesk.Revit.UI;
using Autodesk.Revit.UI.Selection;
using RevitMcpAddin.WallElevation.Core;

namespace RevitMcpAddin.WallElevation.Revit
{
    /// <summary>
    /// Хэрэглэгчийн сонголт: host элемент (өрөө, хана, tag) + цэгээр сонгосон link-ийн өрөө (host-д ElementId-гүй — <see cref="WeRoomRef.Uid"/>
    /// түлхүүрээр).  Арын ажил ч ижил сонголтыг ДАХИН уншина.
    /// </summary>
    internal sealed class WeTargets
    {
        public List<ElementId> Ids = new List<ElementId>();
        public List<string> RoomUids = new List<string>();
        public int Count { get { return Ids.Count + RoomUids.Count; } }

        public static WeTargets Of(IEnumerable<ElementId> ids)
        {
            var t = new WeTargets();
            if (ids != null) t.Ids.AddRange(ids);
            return t;
        }

        /// <summary>«+ Өрөө нэмэх»: өмнөх сонголт + шинэ (давхардалгүй, дарааллаар).</summary>
        public static WeTargets Union(WeTargets a, WeTargets b)
        {
            var t = new WeTargets();
            var ids = new HashSet<long>();
            var uids = new HashSet<string>(StringComparer.Ordinal);
            foreach (WeTargets x in new[] { a, b })
            {
                if (x == null) continue;
                foreach (ElementId id in x.Ids) if (id != null && ids.Add(id.Value)) t.Ids.Add(id);
                foreach (string u in x.RoomUids) if (!string.IsNullOrEmpty(u) && uids.Add(u)) t.RoomUids.Add(u);
            }
            return t;
        }
    }

    /// <summary>
    /// Сонголт → <see cref="WeRequest"/>.  Revit-ээс ЗӨВХӨН хямд өгөгдөл уншина: LocationCurve, bounding box,
    /// параметр, өрөөний хил (Finish).  `get_Geometry()` огт дуудахгүй.  Хана бүрийг НЭГ удаа уншиж кэшлэнэ
    /// (өрөөнүүд нэг ханыг хуваалцдаг).
    /// </summary>
    internal sealed class ElevationTargetResolver
    {
        private readonly Document _doc;
        private readonly Dictionary<ElementId, string> _levelNames = new Dictionary<ElementId, string>();
        private readonly Dictionary<long, WeWallInfo> _walls = new Dictionary<long, WeWallInfo>();

        public ElevationTargetResolver(Document doc) { _doc = doc; }

        /// <summary>
        /// Урьдчилсан сонголтоос өрөө/хана; байхгүй бол хэрэглэгчээр сонгуулна.  null = цуцалсан.
        /// <para>План / план viewport-той хуудсанд (2026-10-13, эзэн: «өрөөн дээр дармагц автоматаар таниад шууд дэлгээс гаргадаг болго»):
        /// цонхгүйгээр ШУУД өрөөн дотор НЭГ дарна (<see cref="WeRoomPicker.PickOne"/> — host ба link-ийн өрөө, шошготой ч шошгогүй ч) →
        /// урьдчилсан дүн.  Esc = «Бусад сонголт»: энэ планы бүх өрөө, олон өрөө (<see cref="WeRoomPicker.PickMany"/>), элементээр сонгох
        /// (хуучин <c>PickObjects</c> + «Finish»).</para>
        /// </summary>
        public static WeTargets PickTargets(UIDocument uidoc)
        {
            Document doc = uidoc.Document;
            var pre = uidoc.Selection.GetElementIds()
                .Where(id => IsSelectable(doc.GetElement(id)))
                .ToList();
            if (pre.Count > 0) return WeTargets.Of(pre);

            View active = uidoc.ActiveView;
            if (!WeRoomPicker.Supports(active)) return PickElements(uidoc);
            WeTargets one;
            WePickOutcome outcome;
            try { outcome = WeRoomPicker.PickOne(uidoc, out one); }
            catch (Autodesk.Revit.Exceptions.InvalidOperationException ex)
            {
                // Харагдацад ажлын хавтгай алга г.м. — элементээр сонгох руу (өмнөх зан төлөв).
                WeLog.Info("pick", "цэгээр сонгох боломжгүй — элементээр (" + ex.Message + ")");
                return PickElements(uidoc);
            }
            if (outcome == WePickOutcome.Picked) return one;
            if (outcome == WePickOutcome.Cancelled) return null;
            return ChooseOther(uidoc, active);
        }

        /// <summary>«+ Өрөө нэмэх» (2026-10-14): өрөө бүрт дарна (дахин дарвал хасна), Esc = дуусгах.  null = юу ч нэмээгүй.</summary>
        public static WeTargets PickMore(UIDocument uidoc)
        {
            View active = uidoc.ActiveView;
            if (!WeRoomPicker.Supports(active)) return PickElements(uidoc);
            try { return WeRoomPicker.PickMany(uidoc); }
            catch (Autodesk.Revit.Exceptions.InvalidOperationException ex)
            {
                WeLog.Info("pick", "өрөө нэмэх — элементээр (" + ex.Message + ")");
                return PickElements(uidoc);
            }
        }

        /// <summary>Esc / «Бусад сонголт»: энэ планы бүх өрөө · олон өрөө · элементээр (хана олноор).</summary>
        private static WeTargets ChooseOther(UIDocument uidoc, View active)
        {
            Document doc = uidoc.Document;
            var plan = active as ViewPlan;
            WeTargets all = plan != null && !plan.IsTemplate ? WeRoomPicker.AllRooms(doc, plan) : null;
            var td = new TaskDialog("MGL — Ханын дэлгээс")
            {
                MainInstruction = "Бусад сонголт",
                MainContent = "Нэг өрөө бол «Ханын дэлгээс»-ийг дахин дараад өрөөн дотор нэг дарахад хангалттай (Ctrl+дарвал олон өрөө).  Олон өрөө эсвэл ханаар сонгох бол доороос.  "
                            + "Дараагийн цонхонд урьдчилсан дүн гарах тул загвар одоохондоо өөрчлөгдөхгүй.",
                CommonButtons = TaskDialogCommonButtons.Cancel,
            };
            if (all != null && all.Count > 0)
                td.AddCommandLink(TaskDialogCommandLinkId.CommandLink1, "Энэ планы бүх өрөө (" + all.Count + ")",
                    "«" + plan.Name + "» дээрх битүү өрөө бүр — шошготой ч, шошгогүй ч (link-ийн өрөө ч)");
            td.AddCommandLink(TaskDialogCommandLinkId.CommandLink2, "Олон өрөө сонгох",
                "Өрөө бүрийн дотор дарна — сонгосон өрөө бүдүүн хүрээ, «✓ нэр»-ээр тодорно; дахин дарвал хасна; Esc = дуусгах");
            td.AddCommandLink(TaskDialogCommandLinkId.CommandLink3, "Элемент сонгох (хана олноор)", "Хүрээгээр / Ctrl-оор сонгоод «Finish» — хана, өрөөний tag, host өрөө");
            TaskDialogResult r = td.Show();
            if (r == TaskDialogResult.CommandLink1) return all;
            if (r == TaskDialogResult.CommandLink3) return PickElements(uidoc);
            if (r != TaskDialogResult.CommandLink2) return null;
            try { return WeRoomPicker.PickMany(uidoc); }
            catch (Autodesk.Revit.Exceptions.InvalidOperationException ex)
            {
                WeLog.Info("pick", "олон өрөөний сонголт боломжгүй — элементээр (" + ex.Message + ")");
                return PickElements(uidoc);
            }
        }

        private static WeTargets PickElements(UIDocument uidoc)
        {
            try
            {
                IList<Reference> refs = uidoc.Selection.PickObjects(ObjectType.Element, new RoomOrWallFilter(),
                    "Ханын дэлгээс: өрөө эсвэл хана сонгоод «Finish» дарна уу (Esc = болих)");
                return WeTargets.Of(refs.Select(r => r.ElementId).Distinct());
            }
            catch (Autodesk.Revit.Exceptions.OperationCanceledException)
            {
                return null;
            }
        }

        public static bool IsTarget(Element e) { return e is Room || e is Wall; }

        /// <summary>
        /// Планд харагдах LINK-ийн өрөөний tag — өрөө тус бүрээс нэг (link ачаалагдсан, талбайтай).  Host-ын өрөөний tag орохгүй (өрөө нь
        /// өөрөө жагсаалтад бий).
        /// </summary>
        public static List<ElementId> LinkedRoomTagsIn(Document doc, View plan)
        {
            var list = new List<ElementId>();
            var seen = new HashSet<string>(StringComparer.Ordinal);
            try
            {
                foreach (RoomTag t in new FilteredElementCollector(doc, plan.Id).OfCategory(BuiltInCategory.OST_RoomTags)
                             .WhereElementIsNotElementType().OfType<RoomTag>())
                {
                    RevitLinkInstance li;
                    Room r = WeRoomRef.FromTag(doc, t, out li);
                    if (r == null || li == null || !(r.Area > 1e-6)) continue;
                    if (seen.Add(WeRoomRef.Uid(r, li))) list.Add(t.Id);
                }
            }
            catch (Exception ex) { WeLog.Info("targets", "link-ийн өрөөний tag — " + ex.Message); }
            return list;
        }

        /// <summary>
        /// Хэрэглэгчийн сонгож болох: өрөө, хана, мөн тэдгээрийн TAG — планд өрөөг дарахад ихэвчлэн өрөөний tag сонгогддог
        /// (тэр нь «юу ч сонгоогүй» мэт алгасагдах ёсгүй).
        /// </summary>
        public static bool IsSelectable(Element e) { return IsTarget(e) || e is RoomTag || e is IndependentTag; }

        private sealed class RoomOrWallFilter : ISelectionFilter
        {
            public bool AllowElement(Element elem) { return IsSelectable(elem); }
            public bool AllowReference(Reference reference, XYZ position) { return false; }
        }

        public WeRequest Resolve(IList<ElementId> ids) { return Resolve(WeTargets.Of(ids)); }

        public WeRequest Resolve(WeTargets targets)
        {
            var req = new WeRequest();
            int other = 0;
            var seen = new HashSet<long>();
            var seenRooms = new HashSet<string>(StringComparer.Ordinal);
            var unloaded = new HashSet<string>(StringComparer.Ordinal);
            // Цэгээр сонгосон link-ийн өрөө (host-д tag-гүй ч болно).
            foreach (string uid in targets.RoomUids)
            {
                RevitLinkInstance li;
                Room lr = WeRoomRef.Resolve(_doc, uid, out li);
                if (lr == null)
                {
                    string ln;
                    if (WeLinkRef.IsLink(uid) && IsUnloadedLink(uid, out ln)) unloaded.Add(ln ?? "link");
                    else other++;
                    continue;
                }
                if (seenRooms.Add(WeRoomRef.Uid(lr, li))) req.Rooms.Add(ReadRoom(lr, li, req));
            }
            foreach (ElementId id in Expand(targets.Ids))
            {
                if (!seen.Add(id.Value)) continue;
                Element e = _doc.GetElement(id);
                var tag = e as RoomTag;
                if (tag != null)
                {
                    // Expand нь зөвхөн LINK-ийн өрөөний tag-ийг үлдээдэг.
                    RevitLinkInstance li;
                    Room lr = WeRoomRef.FromTag(_doc, tag, out li);
                    if (lr == null)
                    {
                        string ln;
                        if (WeRoomRef.IsUnloadedLinkTag(_doc, tag, out ln)) unloaded.Add(ln ?? "link");
                        else other++;
                        continue;
                    }
                    if (seenRooms.Add(WeRoomRef.Uid(lr, li))) req.Rooms.Add(ReadRoom(lr, li, req));
                    continue;
                }
                var room = e as Room;
                if (room != null) { if (seenRooms.Add(room.UniqueId)) req.Rooms.Add(ReadRoom(room, null, req)); continue; }
                var wall = e as Wall;
                if (wall != null) { req.Walls.Add(ReadWall(wall)); continue; }
                other++;
            }
            if (other > 0) req.SelectionNotes.Add(other + " элемент өрөө/хана биш тул алгасав.");
            if (unloaded.Count > 0)
                req.SelectionNotes.Add("Өрөөний tag нь ачаалагдаагүй link-ийн өрөөг зааж байна («" + string.Join("», «", unloaded)
                                       + "») — Manage Links-ээс link-ийг ачаалаад дахин сонгоно уу.");
            foreach (WeWallInfo w in _walls.Values) req.WallLookup[w.UniqueId] = w;
            foreach (WeWallInfo w in _linked.Values) req.WallLookup[w.UniqueId] = w;
            try { WeAnnoSourceReader.Read(_doc, req); }
            catch (Exception ex)
            {
                // Тэмдэглэгээний эх уншиж чадаагүй ч дэлгээс хэвээр үүснэ — тэмдэглэгээгүй.
                WeLog.Error("sources", "Тэмдэглэгээний эх өгөгдөл", ex);
                req.Sources = new WeAnnoSources();
                req.SelectionNotes.Add("Тэмдэглэгээний өгөгдлийг уншиж чадсангүй — дэлгээс тэмдэглэгээгүй үүснэ (" + ex.Message + ").");
            }
            return req;
        }

        /// <summary>Link-ийн өрөөний түлхүүрийн link instance байгаа ч ачаалагдаагүй.</summary>
        private bool IsUnloadedLink(string uid, out string linkName)
        {
            linkName = null;
            RevitLinkInstance li;
            Element e;
            WeLinkRef.TryResolve(_doc, uid, out li, out e);
            if (li == null) return false;
            linkName = li.Name;
            try { return li.GetLinkDocument() == null; } catch { return true; }
        }

        /// <summary>Tag → тэмдэглэсэн өрөө/хана (өрөө ба tag хоёуланг сонгосон ч нэг удаа).</summary>
        private IEnumerable<ElementId> Expand(IList<ElementId> ids)
        {
            foreach (ElementId id in ids)
            {
                Element e = _doc.GetElement(id);
                var rt = e as RoomTag;
                if (rt != null)
                {
                    LinkElementId lid = null;
                    try { lid = rt.TaggedRoomId; } catch { lid = null; }
                    if (lid != null && lid.LinkInstanceId != ElementId.InvalidElementId) { yield return rt.Id; continue; }
                    Room r = null;
                    try { r = rt.Room; } catch { }
                    if (r != null) yield return r.Id;
                    continue;
                }
                var it = e as IndependentTag;
                if (it != null)
                {
                    ICollection<ElementId> tagged = null;
                    try { tagged = it.GetTaggedLocalElementIds(); } catch { }
                    if (tagged != null)
                        foreach (ElementId t in tagged)
                            if (IsTarget(_doc.GetElement(t))) yield return t;
                    continue;
                }
                yield return id;
            }
        }

        // ── Хана ──────────────────────────────────────────────────

        public WeWallInfo ReadWall(Wall w)
        {
            WeWallInfo cached;
            if (_walls.TryGetValue(w.Id.Value, out cached)) return cached;

            var info = new WeWallInfo
            {
                UniqueId = w.UniqueId,
                Id = w.Id.Value,
                Mark = ParamString(w, BuiltInParameter.ALL_MODEL_MARK),
                LevelName = LevelName(w.LevelId),
                Kind = WeWallKind.Unknown,
            };
            try { info.TypeName = w.WallType != null ? w.WallType.Name : w.Name; } catch { info.TypeName = w.Name; }
            try
            {
                switch (w.WallType.Kind)
                {
                    case WallKind.Basic: info.Kind = WeWallKind.Basic; break;
                    case WallKind.Curtain: info.Kind = WeWallKind.Curtain; break;
                    case WallKind.Stacked: info.Kind = WeWallKind.Stacked; break;
                    default: info.Kind = WeWallKind.Unknown; break;
                }
            }
            catch { info.Kind = WeWallKind.Unknown; }

            var lc = w.Location as LocationCurve;
            Curve c = lc != null ? lc.Curve : null;
            if (c != null && c.IsBound)
            {
                info.HasLocationLine = true;
                info.IsCurved = !(c is Line);
                info.Start = c.GetEndPoint(0).ToWe();
                info.End = c.GetEndPoint(1).ToWe();
            }

            info.Width = WidthOf(w, info.Kind);
            try { info.IsSlanted = w.CrossSection != WallCrossSection.Vertical; } catch { info.IsSlanted = false; }
            Parameter keyRef = w.get_Parameter(BuiltInParameter.WALL_KEY_REF_PARAM);
            info.LocationIsCenterline = keyRef != null && keyRef.HasValue && keyRef.AsInteger() == 0;
            try { info.OrientationHint = w.Orientation.ToWe(); } catch { info.OrientationHint = WeV3.Zero; }

            BoundingBoxXYZ bb = w.get_BoundingBox(null);
            if (bb != null) { info.BottomZ = bb.Min.Z; info.TopZ = bb.Max.Z; }

            _walls[w.Id.Value] = info;
            return info;
        }

        private readonly Dictionary<string, WeWallInfo> _linked = new Dictionary<string, WeWallInfo>(StringComparer.Ordinal);
        private List<KeyValuePair<Wall, Line>> _hostWalls;

        /// <summary>
        /// Хилийн шугамын (host координат) дагуух host хана: зэрэгцээ, шугамаас ≤ хагас зузаан + 300 мм, шугамын уртын ≥ 50 %-ийг (≥ 1 м
        /// хүртэл) давхцуулсан — хамгийн их давхцалтай, дараа нь хамгийн ойр.  Олдохгүй бол null.
        /// </summary>
        private Wall HostWallAlong(WeV3 a, WeV3 b, double floorZ)
        {
            if (_hostWalls == null)
            {
                _hostWalls = new List<KeyValuePair<Wall, Line>>();
                foreach (Wall w in new FilteredElementCollector(_doc).OfClass(typeof(Wall)).Cast<Wall>())
                {
                    var lc = w.Location as LocationCurve;
                    var line = lc != null ? lc.Curve as Line : null;
                    if (line != null && line.Length > 0.3) _hostWalls.Add(new KeyValuePair<Wall, Line>(w, line));
                }
            }
            double len = Math.Sqrt((b.X - a.X) * (b.X - a.X) + (b.Y - a.Y) * (b.Y - a.Y));
            if (len < 600 / 304.8) return null;
            double dx = (b.X - a.X) / len, dy = (b.Y - a.Y) / len;
            double need = Math.Max(0.5 * len, Math.Min(len, 1000 / 304.8));
            Wall best = null;
            double bestOver = 0, bestDist = double.MaxValue;
            foreach (KeyValuePair<Wall, Line> kv in _hostWalls)
            {
                XYZ p0 = kv.Value.GetEndPoint(0), p1 = kv.Value.GetEndPoint(1);
                double wx = p1.X - p0.X, wy = p1.Y - p0.Y, wl = Math.Sqrt(wx * wx + wy * wy);
                if (wl < 1e-6 || Math.Abs(wx / wl * dy - wy / wl * dx) > 0.02) continue;
                double width;
                try { width = kv.Key.Width; } catch { width = 0; }
                double dist = Math.Abs((p0.X - a.X) * dy - (p0.Y - a.Y) * dx);
                if (dist > width / 2 + 300 / 304.8) continue;
                BoundingBoxXYZ bb = kv.Key.get_BoundingBox(null);
                if (bb == null || bb.Min.Z > floorZ + 1500 / 304.8 || bb.Max.Z < floorZ + 1000 / 304.8) continue;   // өөр давхрын хана
                double t0 = (p0.X - a.X) * dx + (p0.Y - a.Y) * dy, t1 = (p1.X - a.X) * dx + (p1.Y - a.Y) * dy;
                double over = Math.Min(len, Math.Max(t0, t1)) - Math.Max(0, Math.Min(t0, t1));
                if (over < need) continue;
                if (over > bestOver + 1e-6 || (Math.Abs(over - bestOver) <= 1e-6 && dist < bestDist)) { best = kv.Key; bestOver = over; bestDist = dist; }
            }
            return best;
        }

        /// <summary>Link загварын хана → host координат дахь <see cref="WeWallInfo"/> (<see cref="WeLinkRef"/> түлхүүртэй, Id = 0).</summary>
        public WeWallInfo ReadLinkedWall(RevitLinkInstance li, Wall w)
        {
            string uid = WeLinkRef.Make(li, w);
            WeWallInfo cached;
            if (_linked.TryGetValue(uid, out cached)) return cached;
            Transform tf = li.GetTotalTransform();
            var info = new WeWallInfo { UniqueId = uid, Id = 0, IsLinked = true, Kind = WeWallKind.Unknown };
            try { info.Mark = ParamString(w, BuiltInParameter.ALL_MODEL_MARK); } catch { }
            try { info.TypeName = w.WallType != null ? w.WallType.Name : w.Name; } catch { info.TypeName = w.Name; }
            try { info.LevelName = w.Document.GetElement(w.LevelId) is Level lv ? lv.Name : string.Empty; } catch { info.LevelName = string.Empty; }
            try
            {
                switch (w.WallType.Kind)
                {
                    case WallKind.Basic: info.Kind = WeWallKind.Basic; break;
                    case WallKind.Curtain: info.Kind = WeWallKind.Curtain; break;
                    case WallKind.Stacked: info.Kind = WeWallKind.Stacked; break;
                }
            }
            catch { }
            var lc = w.Location as LocationCurve;
            Curve c = lc != null ? lc.Curve : null;
            if (c != null && c.IsBound)
            {
                info.HasLocationLine = true;
                info.IsCurved = !(c is Line);
                info.Start = tf.OfPoint(c.GetEndPoint(0)).ToWe();
                info.End = tf.OfPoint(c.GetEndPoint(1)).ToWe();
            }
            try { info.Width = w.Width; } catch { info.Width = 0; }
            try { info.IsSlanted = w.CrossSection != WallCrossSection.Vertical; } catch { info.IsSlanted = false; }
            Parameter keyRef = w.get_Parameter(BuiltInParameter.WALL_KEY_REF_PARAM);
            info.LocationIsCenterline = keyRef != null && keyRef.HasValue && keyRef.AsInteger() == 0;
            try { info.OrientationHint = tf.OfVector(w.Orientation).ToWe(); } catch { info.OrientationHint = WeV3.Zero; }
            BoundingBoxXYZ bb = w.get_BoundingBox(null);
            if (bb != null)
            {
                double z0 = tf.OfPoint(bb.Min).Z, z1 = tf.OfPoint(bb.Max).Z;
                info.BottomZ = Math.Min(z0, z1);
                info.TopZ = Math.Max(z0, z1);
            }
            _linked[uid] = info;
            return info;
        }

        /// <summary>Давхарласан хананд гишүүдийн ХАМГИЙН их зузаан (гүнд хангалттай нөөц).</summary>
        private double WidthOf(Wall w, WeWallKind kind)
        {
            double width = 0;
            try { width = w.Width; } catch { width = 0; }
            if (kind == WeWallKind.Stacked)
            {
                try
                {
                    foreach (ElementId mid in w.GetStackedWallMemberIds())
                    {
                        var m = _doc.GetElement(mid) as Wall;
                        if (m == null) continue;
                        try { width = Math.Max(width, m.Width); } catch { }
                    }
                }
                catch { }
            }
            return width;
        }

        // ── Өрөө ──────────────────────────────────────────────────

        /// <param name="link">Өрөө link загварт бол тэр link (координат, хилийн элемент тэндээс); host өрөө бол null.</param>
        private WeRoomInfo ReadRoom(Room r, RevitLinkInstance link, WeRequest req)
        {
            Transform tf = WeRoomRef.TransformOf(link);
            var info = new WeRoomInfo
            {
                UniqueId = WeRoomRef.Uid(r, link),
                Id = link == null ? r.Id.Value : 0,
                Number = r.Number,
                Name = ParamString(r, BuiltInParameter.ROOM_NAME),
                IsPlaced = r.Location != null,
                IsEnclosed = r.Area > 1e-6,
            };
            Level lvl = r.Level;
            // Link-ийн өрөө: түвшинг host-ын ИЖИЛ өндөртэй түвшинтэй тааруулна (түлхүүр план, spot-ийн суурь host-ын түвшнээр).
            Level hostLvl = link == null ? lvl : WeRoomRef.HostLevel(_doc, lvl, tf);
            Level named = hostLvl ?? lvl;
            info.LevelName = named != null ? named.Name : string.Empty;
            info.LevelId = hostLvl != null ? hostLvl.Id.Value : 0;
            info.LevelElevation = hostLvl != null ? WeAnnoSourceReader.LevelZ(hostLvl) : lvl != null ? WeAnnoSourceReader.LevelZ(lvl) + tf.Origin.Z : tf.Origin.Z;
            var lp = r.Location as LocationPoint;
            if (lp != null) info.Location = tf.OfPoint(lp.Point).ToWe();
            double baseZ = lvl != null ? WeAnnoSourceReader.LevelZ(lvl) + tf.Origin.Z : info.LevelElevation;
            info.BottomZ = baseZ + r.BaseOffset;
            double h = r.UnboundedHeight;
            if (!(h > 1e-6))
            {
                BoundingBoxXYZ bb = r.get_BoundingBox(null);
                if (bb != null) { info.BottomZ = bb.Min.Z + tf.Origin.Z; h = bb.Max.Z - bb.Min.Z; }
            }
            info.TopZ = info.BottomZ + Math.Max(0, h);
            if (!info.IsPlaced || !info.IsEnclosed) return info;

            var opts = new SpatialElementBoundaryOptions { SpatialElementBoundaryLocation = SpatialElementBoundaryLocation.Finish };
            IList<IList<BoundarySegment>> loops = r.GetBoundarySegments(opts);
            if (loops == null) return info;

            Document rd = r.Document;
            foreach (IList<BoundarySegment> loop in loops)
            {
                var wl = new WeRoomLoop();
                foreach (BoundarySegment seg in loop)
                {
                    Curve c = seg.GetCurve();
                    if (c == null || !c.IsBound) continue;
                    var s = new WeBoundarySegment
                    {
                        IsStraight = c is Line,
                        A = tf.OfPoint(c.GetEndPoint(0)).ToWe(),
                        B = tf.OfPoint(c.GetEndPoint(1)).ToWe(),
                        Host = WeBoundaryHost.Other,
                    };
                    if (link != null)
                    {
                        // Link-ийн өрөөний хилийн элемент нь ТЭР link-ийн баримтад.  Link-ийн хана = жинхэнэ хана (host координатад);
                        // link доторх давхар link-ийн элемент — хана биш хил (нэгтгэлд давж болно).
                        Element le = seg.LinkElementId != ElementId.InvalidElementId ? null : rd.GetElement(seg.ElementId);
                        var lw = le as Wall;
                        if (lw != null)
                        {
                            s.Host = WeBoundaryHost.Wall;
                            s.WallUniqueId = ReadLinkedWall(link, lw).UniqueId;
                        }
                        else if (s.IsStraight)
                        {
                            // ХЭМЖСЭН (MITIC 202 Лобби, 2026-10-08): архитектурын link-д хил нь «Room Separation» шугам, харин интерьерийн
                            // (host) загварт тэр шугам дээр шилэн/өнгөлгөөний хана бий — жишиг 202A (6000 шилэн хана) яг тэр.  Шугамын дагуу
                            // host хана байвал түүгээр.
                            Wall hw = HostWallAlong(s.A, s.B, info.BottomZ);
                            if (hw != null)
                            {
                                s.Host = WeBoundaryHost.Wall;
                                s.WallUniqueId = ReadWall(hw).UniqueId;
                            }
                        }
                        wl.Segments.Add(s);
                        continue;
                    }
                    Element host = _doc.GetElement(seg.ElementId);
                    if (seg.LinkElementId != ElementId.InvalidElementId || host is RevitLinkInstance)
                    {
                        // ХЭМЖСЭН (GATEWAY, 2026-10-07): 101 өрөөний хилийн ихэнх сегмент нь бүтцийн link-ийн хана — өмнө нь тэдгээр
                        // тал «дэлгээсгүй» болж өрөө бүрийн талын тал нь алга болдог байв.  Link-ийн ХАНА = жинхэнэ хана (host координатад),
                        // link-ийн багана, шал … = хана биш хил (нэгтгэлд давж болно); link ачаалагдаагүй = уншиж чадаагүй хана.
                        var li = host as RevitLinkInstance;
                        Document ld = null;
                        try { ld = li != null ? li.GetLinkDocument() : null; } catch { ld = null; }
                        Element le = ld != null && seg.LinkElementId != ElementId.InvalidElementId ? ld.GetElement(seg.LinkElementId) : null;
                        var lw = le as Wall;
                        if (lw != null)
                        {
                            s.Host = WeBoundaryHost.Wall;
                            s.WallUniqueId = ReadLinkedWall(li, lw).UniqueId;
                        }
                        else s.Host = le != null ? WeBoundaryHost.Other : WeBoundaryHost.LinkedWall;
                    }
                    else
                    {
                        var wall = host as Wall;
                        if (wall != null)
                        {
                            s.Host = WeBoundaryHost.Wall;
                            s.WallUniqueId = ReadWall(wall).UniqueId;
                        }
                    }
                    wl.Segments.Add(s);
                }
                info.Loops.Add(wl);
            }
            Probe(r, info, tf);
            return info;
        }

        /// <summary>
        /// Геометрээр олсон «дотор тал»-ыг Revit-ийн `IsPointInRoom`-оор баталгаажуулна: ханын гадаргуугаас ~ 45 мм дотогш,
        /// өрөөний суурьс 0.3 м дээр.  Зөрвөл төлөвлөгч «хүн шалгах» болгоно (таахгүй).
        /// </summary>
        private static void Probe(Room r, WeRoomInfo info, Transform tf)
        {
            if (info.Loops.Count == 0) return;
            int outer = 0;
            double best = -1;
            for (int i = 0; i < info.Loops.Count; i++)
            {
                double a = Math.Abs(RoomBoundaryAnalyzer.SignedArea(info.Loops[i].Segments));
                if (a > best) { best = a; outer = i; }
            }
            double z = info.BottomZ + 1.0;
            for (int i = 0; i < info.Loops.Count; i++)
            {
                bool ccw = RoomBoundaryAnalyzer.SignedArea(info.Loops[i].Segments) > 0;
                foreach (WeBoundarySegment s in info.Loops[i].Segments)
                {
                    if (s.Host != WeBoundaryHost.Wall || !s.IsStraight) continue;
                    WeV3 n = RoomBoundaryAnalyzer.InteriorNormal(s.A, s.B, i == outer, ccw);
                    if (n.IsZero) continue;
                    WeV3 mid = (s.A + s.B) * 0.5 + n * 0.15;
                    try { s.InteriorProbe = WeRoomRef.IsPointInRoom(r, tf, new XYZ(mid.X, mid.Y, z)); }
                    catch { s.InteriorProbe = null; }
                }
            }
        }

        // ── Туслах ───────────────────────────────────────────────

        private string LevelName(ElementId id)
        {
            if (id == null || id == ElementId.InvalidElementId) return string.Empty;
            string n;
            if (_levelNames.TryGetValue(id, out n)) return n;
            Element l = _doc.GetElement(id);
            n = l != null ? l.Name : string.Empty;
            _levelNames[id] = n;
            return n;
        }

        private static string ParamString(Element e, BuiltInParameter bip)
        {
            try
            {
                Parameter p = e.get_Parameter(bip);
                return p != null && p.HasValue ? (p.AsString() ?? string.Empty) : string.Empty;
            }
            catch { return string.Empty; }
        }
    }
}
