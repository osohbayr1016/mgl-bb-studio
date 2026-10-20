using System;
using System.Collections.Generic;
using System.Linq;
using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Analysis;
using RevitMcpAddin.ChangeImpact.Core;
using RevitMcpAddin.Smart.Core;

namespace RevitMcpAddin.ChangeImpact
{
    /// <summary>
    /// Гарцын зам (Path of Travel) — ТОДОРХОЙЛОГДСОН: AI ХЭРЭГГҮЙ, Revit-ийн `PathOfTravel.FindShortestPaths` (элемент ҮҮСГЭХГҮЙ,
    /// транзакц шаардахгүй — баримтжуулсан) ашиглана.
    ///
    ///   • ГАРЦ = хэрэглэгчийн нэг удаа сонгосон хаалганууд (`PreChangeExitStore`, UniqueId, ЛОКАЛ).  Хаалганы НЭРЭЭР ТААМАГЛАХГҮЙ.
    ///     Гарц сонгоогүй бол «тооцоогүй» — ХЭЗЭЭ Ч 0 биш.
    ///   • ЭХЛЭХ цэг = нэр дэвшигч өрөө бүрийн байрлалын цэг (Room.Location); төгсгөл = өрөөний давхарт байгаа гарцын хаалганы цэг.
    ///     Гарц бүрийн хамгийн ойрыг Revit өөрөө сонгоно (min).
    ///   • Давхар бүрд crop-гүй (crop идэвхгүй) план шаардана — crop идэвхтэй харагдацад зам дутуу гарч болдог (Revit-ийн сануулга).
    ///     Олдохгүй бол ТЭР давхрын өрөөнүүд «тооцоогүй».
    ///   • Зөвхөн ЗЭРГЭЭД (нэр дэвшигч) өрөөнөөс — холын өрөөнөөс гарах зам ДАМЖИХ коридор өөрчлөгдөж болох ч хэмжээгүй (тэмдэглэнэ).
    ///   • Хууль тогтоосон дээд зайг ХАТУУ бичихгүй, тулгахгүй.
    /// </summary>
    internal static class PreChangeEgressProbe
    {
        internal const int MaxRooms = 12;
        /// <summary>Гарцын хаалганы нүүрний өмнөх төгсгөлийн цэгийн хамгийн бага зай (мм).</summary>
        internal const double FrontOffsetMinMm = 300;

        internal static EgressSpec Plan(Document doc, DocumentKey key, IEnumerable<long> candidateRoomIds)
        {
            var spec = new EgressSpec();
            List<ExitInfo> stored = PreChangeExitStore.Load(key);
            if (stored.Count == 0)
            {
                spec.Configured = false;
                return spec;
            }
            spec.Configured = true;

            int missing = 0;
            foreach (ExitInfo ex in stored.Take(PreChangeExitStore.MaxExits))
            {
                Element e = null;
                try { if (!string.IsNullOrEmpty(ex.Uid)) e = doc.GetElement(ex.Uid); } catch (Exception) { }
                var fi = e as FamilyInstance;
                if (fi == null || !(fi.Location is LocationPoint)) { missing++; continue; }
                long lvl = 0;
                try { if (fi.LevelId != null && fi.LevelId != ElementId.InvalidElementId) lvl = fi.LevelId.Value; } catch (Exception) { }
                spec.Exits.Add(new ExitRef { Id = fi.Id.Value, Uid = fi.UniqueId, Name = ex.Name, LevelId = lvl });
            }
            if (missing > 0) spec.IncompleteReasons.Add(missing + " гарцын хаалга загварт олдсонгүй (устсан байж болзошгүй) — гарцыг дахин сонгоно уу.");
            if (stored.Count > PreChangeExitStore.MaxExits) spec.IncompleteReasons.Add("Гарц " + stored.Count + " — эхний " + PreChangeExitStore.MaxExits + "-г л авав.");
            if (spec.Exits.Count == 0)
            {
                spec.NotEvaluatedReason = "Сонгосон гарцын хаалга загварт олдсонгүй.";
                return spec;
            }

            int roomCount = 0;
            foreach (long rid in candidateRoomIds)
            {
                var room = doc.GetElement(new ElementId(rid)) as Autodesk.Revit.DB.Architecture.Room;
                if (room == null || room.Location as LocationPoint == null || room.Area <= 1e-6) continue;
                if (++roomCount > MaxRooms)
                {
                    spec.IncompleteReasons.Add("Гарцын зам " + MaxRooms + " өрөөнөөс л тооцсон (нэр дэвшигч өрөө олон).");
                    break;
                }
                long lvl = room.LevelId != null && room.LevelId != ElementId.InvalidElementId ? room.LevelId.Value : 0;
                spec.Rooms.Add(new EgressRoomRef { RoomId = rid, LevelId = lvl, Name = PreChangeWallRules.RoomLabel(room) });
            }
            if (spec.Rooms.Count == 0)
            {
                spec.NotEvaluatedReason = "Хананы ойролцоо хаалттай өрөө олдсонгүй — гарцын замыг эхлүүлэх цэг алга.";
                return spec;
            }

            foreach (long levelId in spec.Rooms.Select(r => r.LevelId).Distinct())
            {
                var lp = new EgressLevelPlan { LevelId = levelId };
                var lv = doc.GetElement(new ElementId(levelId)) as Level;
                lp.LevelName = lv != null ? lv.Name : "#" + levelId;
                ViewPlan plan = FindPlan(doc, levelId);
                if (plan == null) lp.Problem = "«" + lp.LevelName + "» давхарт crop-гүй (crop идэвхгүй) давхрын план олдсонгүй.";
                else if (!spec.Exits.Any(x => x.LevelId == levelId)) lp.Problem = "«" + lp.LevelName + "» давхарт сонгосон гарц алга.";
                else lp.ViewId = plan.Id.Value;
                spec.Levels.Add(lp);
            }
            return spec;
        }

        private static ViewPlan FindPlan(Document doc, long levelId)
        {
            foreach (ViewPlan v in new FilteredElementCollector(doc).OfClass(typeof(ViewPlan)).Cast<ViewPlan>())
            {
                try
                {
                    if (v.IsTemplate || v.ViewType != ViewType.FloorPlan) continue;
                    if (v.GenLevel == null || v.GenLevel.Id.Value != levelId) continue;
                    if (v.CropBoxActive) continue;
                    if (v.GetPrimaryViewId() != ElementId.InvalidElementId) continue;     // dependent харагдац — crop-той байж болно
                    return v;
                }
                catch (Exception) { }
            }
            return null;
        }

        internal static EgressSnap Read(Document doc, EgressSpec spec, BeforeMemo memo = null)
        {
            var snap = new EgressSnap();
            if (spec == null || !spec.Configured) return snap;           // Configured=false → «тооцоогүй»
            snap.Configured = true;
            snap.IncompleteReasons.AddRange(spec.IncompleteReasons);
            if (!string.IsNullOrEmpty(spec.NotEvaluatedReason))
            {
                snap.NotEvaluatedReason = spec.NotEvaluatedReason;
                return snap;
            }

            snap.Evaluated = true;
            foreach (EgressLevelPlan lp in spec.Levels)
            {
                var allHere = spec.Rooms.Where(r => r.LevelId == lp.LevelId).ToList();
                // ӨМНӨХ зам (хөдөлгөөнгүй) зайнаас хамаарахгүй — аль хэдийн тооцсон өрөөний замыг Path of Travel-ээр дахин тооцохгүй.
                var roomsHere = new List<EgressRoomRef>();
                foreach (EgressRoomRef rr in allHere)
                {
                    EgressRoute known;
                    if (memo != null && memo.EgressRoutes.TryGetValue(rr.RoomId, out known)) snap.Routes[rr.RoomId] = known;
                    else roomsHere.Add(rr);
                }
                if (roomsHere.Count == 0) continue;
                if (lp.ViewId == 0)
                {
                    foreach (EgressRoomRef r in roomsHere)
                        snap.Routes[r.RoomId] = new EgressRoute { RoomId = r.RoomId, RoomName = r.Name, Evaluated = false, Note = lp.Problem };
                    snap.IncompleteReasons.Add(lp.Problem);
                    continue;
                }

                try
                {
                    var view = doc.GetElement(new ElementId(lp.ViewId)) as View;
                    var starts = new List<XYZ>();
                    foreach (EgressRoomRef r in roomsHere)
                    {
                        var room = doc.GetElement(new ElementId(r.RoomId)) as Autodesk.Revit.DB.Architecture.Room;
                        var loc = room != null ? room.Location as LocationPoint : null;
                        starts.Add(loc != null ? loc.Point : null);
                    }
                    var dests = new List<XYZ>();
                    foreach (ExitRef x in spec.Exits.Where(e => e.LevelId == lp.LevelId))
                    {
                        var fi = doc.GetElement(new ElementId(x.Id)) as FamilyInstance;
                        var p = fi != null ? fi.Location as LocationPoint : null;
                        if (p == null) continue;
                        // Хаалганы цэг нь ханын бодис дотор тул «зам олдсонгүй» гэж худал гарч болно — хаалганы ХОЁР нүүрний өмнөх цэгийг
                        // (хост ханын хагас зузаан + 150 мм, доод тал нь 300 мм) төгсгөл болгоно; Revit хамгийн ойрыг сонгоно.
                        XYZ f = fi.FacingOrientation;
                        if (f == null || new XYZ(f.X, f.Y, 0).GetLength() < 1e-6) { dests.Add(p.Point); continue; }
                        XYZ dir = new XYZ(f.X, f.Y, 0).Normalize();
                        double half = 0;
                        var hostWall = fi.Host as Wall;
                        if (hostWall != null) half = hostWall.Width / 2;
                        double off = Math.Max(PcUnits.ToInternalMm(FrontOffsetMinMm), half + PcUnits.ToInternalMm(150));
                        dests.Add(p.Point + dir * off);
                        dests.Add(p.Point - dir * off);
                    }

                    var okStarts = new List<XYZ>();
                    var okRooms = new List<EgressRoomRef>();
                    for (int i = 0; i < roomsHere.Count; i++)
                    {
                        if (starts[i] == null)
                        {
                            snap.Routes[roomsHere[i].RoomId] = new EgressRoute { RoomId = roomsHere[i].RoomId, RoomName = roomsHere[i].Name, Evaluated = false, Note = "Өрөөний байрлалын цэг алга." };
                            continue;
                        }
                        okStarts.Add(starts[i]);
                        okRooms.Add(roomsHere[i]);
                    }
                    if (okStarts.Count == 0 || dests.Count == 0)
                    {
                        snap.IncompleteReasons.Add("«" + lp.LevelName + "» давхарт гарцын замын эхлэх/төгсгөлийн цэг олдсонгүй.");
                        continue;
                    }

                    IList<IList<XYZ>> paths = PathOfTravel.FindShortestPaths(view, dests, okStarts);
                    for (int i = 0; i < okRooms.Count; i++)
                    {
                        IList<XYZ> path = paths != null && i < paths.Count ? paths[i] : null;
                        var route = new EgressRoute { RoomId = okRooms[i].RoomId, RoomName = okRooms[i].Name, Evaluated = paths != null && i < paths.Count };
                        if (route.Evaluated)
                        {
                            if (path == null || path.Count < 2) route.LengthM = null;          // Revit: зам олдсонгүй (хоосон массив)
                            else
                            {
                                double ft = 0;
                                for (int k = 1; k < path.Count; k++) ft += path[k - 1].DistanceTo(path[k]);
                                route.LengthM = PcUnits.M(ft);
                            }
                        }
                        snap.Routes[route.RoomId] = route;
                        if (memo != null && route.Evaluated) memo.EgressRoutes[route.RoomId] = route;
                    }
                }
                catch (Exception ex)
                {
                    foreach (EgressRoomRef r in roomsHere)
                        snap.Routes[r.RoomId] = new EgressRoute { RoomId = r.RoomId, RoomName = r.Name, Evaluated = false, Note = "Path of Travel тооцоолж чадсангүй (" + ex.GetType().Name + ")." };
                    snap.IncompleteReasons.Add("«" + lp.LevelName + "» давхрын Path of Travel тооцоо амжилтгүй (" + ex.GetType().Name + ") — Revit LT эсвэл тооцооллын сервис байхгүй байж болно.");
                }
            }
            snap.IncompleteReasons = snap.IncompleteReasons.Distinct(StringComparer.Ordinal).ToList();
            return snap;
        }
    }
}
