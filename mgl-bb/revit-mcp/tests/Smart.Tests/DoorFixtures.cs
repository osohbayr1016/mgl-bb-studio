using System;
using System.Collections.Generic;
using System.Linq;
using RevitMcpAddin.ChangeImpact.Core;
using RevitMcpAddin.ClashCheck.Core;

namespace RevitMcpAddin.Smart.Tests
{
    /// <summary>
    /// «Хаалга зөөх» тестүүдийн ХУВААЛЦСАН builder-ууд.
    ///
    /// ДҮҮРЭН: хост хана +X тэнхлэгийн дагуу (0,0) → (6000,0) мм, зузаан 200, өндөр 0..3000.  Хаалга D-120 (id 100) төвөөрөө s=1500, өргөн 900, өндөр 2100.
    /// Хост координатад s = X, n = Y (зүүн нормаль = +Y).
    /// </summary>
    internal static class DoorFixtures
    {
        public const long DoorId = 100;
        public const long HostId = 50;

        public static HostGeometry Host(double length = 6000, double startJoin = 0, double endJoin = 0)
        {
            return new HostGeometry
            {
                Id = HostId, Uid = "host-uid", Label = "Wall W-42", StartX = 0, StartY = 0, EndX = length, EndY = 0, ThicknessMm = 200,
                ZMinMm = 0, ZMaxMm = 3000, StartJoinThicknessMm = startJoin, EndJoinThicknessMm = endJoin,
            };
        }

        public static DoorBody Door(double center = 1500, double width = 900, WidthSource src = WidthSource.Parameter)
        {
            return new DoorBody
            {
                Id = DoorId, Uid = "door-uid", Label = "D-120", TypeName = "Single-Flush", CenterParamMm = center, CenterNormalMm = 0,
                WidthMm = src == WidthSource.Unknown ? 0 : width, WidthSource = src, GhostWidthMm = width, HeightMm = 2100, ZMinMm = 0, ZMaxMm = 2100, DepthMm = 200,
                FromRoomId = 1, ToRoomId = 2, FromRoomLabel = "Коридор", ToRoomLabel = "Оффис 203", RoomsReadable = true,
            };
        }

        public static OpeningSpan Opening(long id, double center, double width = 900, bool known = true, ObstacleKind kind = ObstacleKind.Door, string label = null)
        {
            return new OpeningSpan
            {
                Id = id, Uid = "op-" + id, Label = label ?? "D-" + id, Kind = kind, CenterParamMm = center, WidthMm = known ? width : 0,
                WidthSource = known ? WidthSource.Parameter : WidthSource.Unknown,
                BoxMm = new[] { center - width / 2, -100, 0, center + width / 2, 100, 2100 },
            };
        }

        /// <summary>Хайрцаг (хост = дэлхийн XY ижил): x0..x1, y0..y1, z0..z1.</summary>
        public static ObstacleBox Box(long id, ObstacleKind kind, double x0, double x1, double y0 = -150, double y1 = 150, double z0 = 0, double z1 = 3000, string label = null, long link = 0)
        {
            return new ObstacleBox { Id = id, Uid = "o-" + id, Label = label ?? kind + " " + id, Kind = kind, BoxMm = new[] { x0, y0, z0, x1, y1, z1 }, LinkInstanceId = link, LinkName = link > 0 ? "Link" : null };
        }

        public static DoorMoveContext Ctx(double doorCenter = 1500, double doorWidth = 900, WidthSource src = WidthSource.Parameter, double hostLength = 6000)
        {
            return new DoorMoveContext
            {
                Host = Host(hostLength), Door = Door(doorCenter, doorWidth, src),
                Rooms = new List<ObstacleBox>
                {
                    Box(1, ObstacleKind.Room, 0, 3000, 200, 4000, 0, 3000, "Коридор"),
                    Box(2, ObstacleKind.Room, 0, 3000, -4000, -200, 0, 3000, "Оффис 203"),
                },
            };
        }

        public static PreChangeSelection Sel()
        {
            return new PreChangeSelection
            {
                Valid = true, Operation = PreChangeOperationKind.DoorMove, SourceId = DoorId, SourceUid = "door-uid", Label = "D-120", Mark = "D-120",
                HostId = HostId, HostUid = "host-uid", HostLabel = "Wall W-42", TangentX = 1, TangentY = 0, DoorWidthMm = 900, DoorHeightMm = 2100, LevelName = "Level 12",
                FromRoom = "Коридор", ToRoom = "Оффис 203",
            };
        }

        public static PreChangeRequest Req(double offset)
        {
            return DoorMoveRequests.Build(Sel(), offset);
        }

        /* ---- snapshot builders ---- */

        public static HostedSnap DoorSnap(double x, long hostId = HostId, long from = 1, long to = 2, string fromName = "Коридор", string toName = "Оффис 203", bool exists = true,
            bool facing = false, bool hand = false, bool flipKnown = true)
        {
            return new HostedSnap
            {
                Id = DoorId, Uid = "door-uid", Name = "Single-Flush", Category = "Doors", Exists = exists, HostId = hostId, HostKnown = true,
                LocationMm = new[] { x, 0.0, 0.0 }, FromRoomId = from, ToRoomId = to, FromRoomName = fromName, ToRoomName = toName, RoomsReadable = true,
                FlipKnown = flipKnown, FacingFlipped = facing, HandFlipped = hand, Mark = "D-120",
            };
        }

        public static StateSnapshot Snap(HostedSnap door)
        {
            StateSnapshot s = PreChangeFixtures.Snap();
            s.Source = new ElementPlace { Id = DoorId, Uid = "door-uid", Name = "Single-Flush", Category = "Doors", Location = door != null ? door.LocationMm : null };
            if (door != null) s.Hosted[door.Id] = door;
            return s;
        }

        public static ClashPairState DoorPair(string key, ObstacleKind kind, ClashVerdict v, long id = 900, long link = 0, double vol = 25)
        {
            return new ClashPairState { Key = key, OtherId = id, OtherLabel = kind + " " + id, OtherKind = kind, Verdict = v, VolumeCm3 = vol, OtherLinkInstanceId = link, OtherLink = link > 0 ? "Link" : null };
        }

        /// <summary>Эцсийн (Full) тайлан: хаалга `offset`-ээр хүссэн байрлалдаа очдог, өөр юу ч өөрчлөгдөхгүй.</summary>
        public static PreChangeInput Input(DoorMoveContext ctx, double offset, StateSnapshot before = null, StateSnapshot after = null, AnalysisStage stage = AnalysisStage.Full)
        {
            double s0 = ctx.Door.CenterParamMm;
            StateSnapshot b = before ?? Snap(DoorSnap(s0));
            StateSnapshot a = after ?? Snap(DoorSnap(s0 + offset));
            return new PreChangeInput
            {
                Request = Req(offset), DocumentTitle = "Тест", Utc = new DateTime(2026, 10, 5, 9, 0, 0, DateTimeKind.Utc), Outcome = SandboxOutcome.Simulated,
                Before = b, After = a, Deps = PreChangeFixtures.Deps(), Door = ctx, Stage = stage,
            };
        }

        public static PreChangeReport Run(DoorMoveContext ctx, double offset, StateSnapshot before = null, StateSnapshot after = null, AnalysisStage stage = AnalysisStage.Full, PreChangeDependencies deps = null)
        {
            PreChangeInput inp = Input(ctx, offset, before, after, stage);
            if (deps != null) inp.Deps = deps;
            return PreChangeDiff.Compute(inp);
        }

        public static PreChangeItem Item(PreChangeReport r, string code)
        {
            return r.Items.FirstOrDefault(i => i.Code == code);
        }

        public static MoveDecision Decide(PreChangeReport r) { return PreChangeDecisionEngine.Decide(r); }

        /* ---- simulation host fake ---- */

        internal sealed class FakeHost : IDoorSimulationHost
        {
            public long Now;
            public readonly List<KeyValuePair<int, PreChangeRequest>> Started = new List<KeyValuePair<int, PreChangeRequest>>();
            public readonly List<int> Cancelled = new List<int>();
            public readonly List<DoorVisualState> Visuals = new List<DoorVisualState>();
            public int ClearCount, ChangedCount;
            public long NowMs { get { return Now; } }
            public void StartExact(int generation, PreChangeRequest request) { Started.Add(new KeyValuePair<int, PreChangeRequest>(generation, request)); }
            public void CancelExact(int generation) { Cancelled.Add(generation); }
            public void ShowVisual(DoorVisualState visual) { Visuals.Add(visual); }
            public void ClearVisual() { ClearCount++; }
            public void Changed() { ChangedCount++; }
            public DoorVisualState LastVisual { get { return Visuals.Count == 0 ? null : Visuals[Visuals.Count - 1]; } }
        }

        public static DoorSimulationController Controller(FakeHost host, DoorMoveContext ctx = null)
        {
            var c = new DoorSimulationController(host, Sel());
            c.SetContext(ctx ?? Ctx());
            return c;
        }

        /// <summary>Debounce-ыг өнгөрөөж sandbox эхлүүлнэ.</summary>
        public static void PassDebounce(FakeHost host, DoorSimulationController c)
        {
            host.Now += DoorSimulationController.DebounceMs + 1;
            c.Tick();
        }

        public static PreChangeReport FinalReport(DoorMoveContext ctx, double offset) { return Run(ctx, offset); }
    }
}
