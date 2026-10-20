using System;
using System.Collections.Generic;
using System.Linq;
using RevitMcpAddin.ChangeImpact.Core;
using RevitMcpAddin.ClashCheck.Core;

namespace RevitMcpAddin.Smart.Tests
{
    /// <summary>
    /// «Өөрчлөхөөс өмнө шалгах» (PreChange*) тестүүдийн ХУВААЛЦСАН builder-ууд.  Анхдагч snapshot нь «бүрэн дууссан, юу ч өөрчлөгдөөгүй,
    /// гарц тохируулаагүй» — тест бүр ЗӨВХӨН өөрийн сонирхсон хэсгийг өөрчилнө.
    /// </summary>
    internal static class PreChangeFixtures
    {
        /// <summary>300 мм, +X чиглэл → вектор [300, 0, 0].</summary>
        public static PreChangeRequest Req(double mm = 300, double dx = 1, double dy = 0, string side = "Оффис 203 тал руу")
        {
            return new PreChangeRequest { SourceId = 100, SourceUid = "wall-uid", SourceLabel = "Хана", DistanceMm = mm, DirX = dx, DirY = dy, SideLabel = side };
        }

        /// <summary>Captured=true, clash үнэлсэн+бүрэн (хос алга), гарц тохируулаагүй.</summary>
        public static StateSnapshot Snap()
        {
            return new StateSnapshot
            {
                Captured = true,
                Clash = new ClashSnap { Evaluated = true, Complete = true },
                Egress = new EgressSnap { Configured = false },
            };
        }

        public static PreChangeDependencies Deps()
        {
            return new PreChangeDependencies { VisibilityChecked = true, AfterVisibilityChecked = true };
        }

        public static PreChangeInput Input(StateSnapshot before = null, StateSnapshot after = null, PreChangeDependencies deps = null, PreChangeRequest req = null)
        {
            return new PreChangeInput
            {
                Request = req ?? Req(),
                DocumentTitle = "Тест",
                Utc = new DateTime(2026, 10, 5, 9, 0, 0, DateTimeKind.Utc),
                Outcome = SandboxOutcome.Simulated,
                Before = before ?? Snap(),
                After = after ?? Snap(),
                Deps = deps ?? Deps(),
            };
        }

        public static PreChangeReport Run(StateSnapshot before = null, StateSnapshot after = null, PreChangeDependencies deps = null, PreChangeRequest req = null)
        {
            return PreChangeDiff.Compute(Input(before, after, deps, req));
        }

        public static PreChangeItem Item(PreChangeReport r, string key)
        {
            return r.Items.FirstOrDefault(i => i.Key == key);
        }

        /* ------------------------------ builders ------------------------------ */

        public static RoomSnap Room(long id, double area, bool bounded = false, string number = "203", string name = "Оффис")
        {
            return new RoomSnap { Id = id, Uid = "r" + id, Number = number, Name = name, Placed = true, Enclosed = area > 0, AreaM2 = area, Readable = true, BoundedBySource = bounded };
        }

        public static StateSnapshot WithRoom(this StateSnapshot s, RoomSnap r) { s.Rooms[r.Id] = r; return s; }

        public static DimSnap Dim(long id, params double[] segmentsMm)
        {
            return new DimSnap { Id = id, Uid = "d" + id, Name = "Хэмжээс", ViewName = "План 1", Readable = true, SegmentsMm = segmentsMm.ToList() };
        }

        public static StateSnapshot WithDim(this StateSnapshot s, DimSnap d) { s.Dimensions[d.Id] = d; return s; }

        public static HostedSnap Door(long id, double x, double y = 0, double z = 0)
        {
            return new HostedSnap { Id = id, Uid = "h" + id, Name = "Хаалга", Category = "Doors", Exists = true, LocationMm = new[] { x, y, z }, RoomsReadable = true, FromRoomId = 1, ToRoomId = 2, FromRoomName = "A", ToRoomName = "B" };
        }

        public static StateSnapshot WithHosted(this StateSnapshot s, HostedSnap h) { s.Hosted[h.Id] = h; return s; }

        public static ClashPairState Pair(string key, ClashVerdict v, double vol = 12.5)
        {
            return new ClashPairState { Key = key, OtherId = 900 + Math.Abs(key.GetHashCode() % 50), OtherLabel = "Дукт " + key, Verdict = v, VolumeCm3 = vol };
        }

        public static StateSnapshot WithPair(this StateSnapshot s, ClashPairState p) { s.Clash.Pairs[p.Key] = p; return s; }

        public static StateSnapshot WithEgress(this StateSnapshot s, params EgressRoute[] routes)
        {
            s.Egress.Configured = true;
            s.Egress.Evaluated = true;
            foreach (EgressRoute r in routes) s.Egress.Routes[r.RoomId] = r;
            return s;
        }

        public static EgressRoute Route(long roomId, double? lengthM, bool evaluated = true)
        {
            return new EgressRoute { RoomId = roomId, RoomName = "Өрөө " + roomId, LengthM = lengthM, Evaluated = evaluated };
        }

        public static DepNode View(long id, string viewType = "FloorPlan", params long[] sheetIds)
        {
            return new DepNode { Id = id, Uid = "v" + id, Name = "Харагдац " + id, Kind = ImpactNodeKind.View, Confidence = ImpactConfidence.B, ViewType = viewType, SheetIds = sheetIds.ToList(), Reason = "харагдана" };
        }

        public static DepNode Sheet(long id, string number)
        {
            return new DepNode { Id = id, Uid = "s" + id, Name = "Хуудас", SheetNumber = number, Kind = ImpactNodeKind.Sheet, Confidence = ImpactConfidence.B };
        }

        public static DepNode Sched(long id, params long[] sheetIds)
        {
            return new DepNode { Id = id, Uid = "sc" + id, Name = "Хүснэгт " + id, Kind = ImpactNodeKind.Schedule, Confidence = ImpactConfidence.B, SheetIds = sheetIds.ToList() };
        }

        public static ScheduleSnap SchedSnap(long id, bool evaluated, params long[] members)
        {
            return new ScheduleSnap { Id = id, Name = "Хүснэгт " + id, Evaluated = evaluated, Members = new HashSet<long>(members) };
        }

        public static PreChangeFingerprint Fp()
        {
            return new PreChangeFingerprint
            {
                DocumentId = "doc-1", SourceUid = "wall-uid", SourceId = 100, Location = new[] { 0.0, 0, 0, 5000, 0, 0 }, TypeId = 7,
                ModelStamp = "stamp-1", VectorMm = new[] { 300.0, 0, 0 }, DependencyHash = "dep-1", SourceExists = true,
            };
        }
    }
}
