using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Architecture;
using Autodesk.Revit.UI;
using RevitMcpAddin.RoomPlan;
using RevitMcpAddin.RoomPlan.Core;

namespace MglRpGate
{
    /// <summary>
    /// «Давхрын план» (Finch маяг) горим: 40 × 18 м ХООСОН давхар → `FloorPlateSplitter` (коридор, шат-лифтийн хонгил,
    /// айлын харьцаа) → production `FloorPlateShell.BuildShell` (коридор / айл хоорондын хана) → айл бүрт Python хувилбар →
    /// «Бүгдэд шилдгийг сонгох» → Family → `RoomPlanBatchApply.Apply` → `FloorPlateShell.AddCommonRoom` — бүгд production-ий
    /// ижил НЭГ TransactionGroup-д (ExternalEvent-ийн нэг алхам дотор: Revit нээлттэй group-ийг алхам хооронд зөвшөөрдөггүй).
    /// Дараа нь Revit-ийн бодит геометрээр шалгаж, зураг гаргаад НЭГ Ctrl+Z давхрыг бүхэлд нь (коридорын хана ч) буцаана.
    /// </summary>
    internal static class FloorScenario
    {
        public static void Build(GateRunner r)
        {
            var s = new Scenario.State();
            r.Enqueue("floor.plate.build", app => { s.PlatePath = PlateFactory.BuildFloor(app.Application, r.Job, r.Facts); return StepState.Done; }, 15, true);
            r.Enqueue("floor.open", app => Scenario.Open(r, s, app), 10, true);
            r.Enqueue("floor.split", app => Split(r, s), 2, true);
            r.Enqueue("floor.apply", app => Apply(r, s), 20, true);
            r.Enqueue("floor.verify-units", app => Scenario.Verify(r, s));
            r.Enqueue("floor.verify-storey", app => VerifyStorey(r, s));
            r.Enqueue("floor.export", app => Scenario.Export(r, s, app));
            r.Enqueue("floor.undo", app => Scenario.PostEdit(r, app, true));
            r.Enqueue("floor.undo-check", app => Scenario.AfterUndo(r, s), 2);
            r.Enqueue("floor.redo", app => Scenario.PostEdit(r, app, false));
            r.Enqueue("floor.redo-check", app => Scenario.AfterRedo(r, s), 2);
            r.Enqueue("floor.save", app => Scenario.Save(r, s, app));
        }

        // ── Давхрыг айлуудад хуваах (цонхны өгөгдмөл сонголт) ─────────

        private static StepState Split(GateRunner r, Scenario.State s)
        {
            Document doc = s.Doc;
            List<Floor> floors = new FilteredElementCollector(doc).OfClass(typeof(Floor)).Cast<Floor>()
                .Where(f => f.LevelId == s.Level.Id).ToList();
            if (floors.Count != 1) return r.Fail("давхарт " + floors.Count + " floor (1 байх ёстой)");
            s.Storey = ExistingFloorBoundary.Read(doc, floors[0], s.Level);
            var probe = new PythonUnitRequest { Id = "FLOOR", Boundary = s.Storey };
            if (RoomPlanBatchApply.HasOccupied(doc, s.Level, new[] { probe })) return r.Fail("хоосон давхрыг «эзэлсэн» гэж үзэв");
            s.Partition = new FilteredElementCollector(doc).OfClass(typeof(WallType)).Cast<WallType>()
                .FirstOrDefault(t => t.Name == FloorPlate.PartitionType);
            if (s.Partition == null) return r.Fail("коридорын ханын төрөл алга");

            // FloorPlateWindow-ийн өгөгдмөл: Auto коридор, төвд хонгил, standard, 0/40/40/20 % харьцаа
            // (`job.ini` `floor_core=center|end|none`, `floor_tier=economy|standard|luxury`-гаар солино).
            var input = new FloorPlateInput
            {
                Width = s.Storey.WidthMeters, Height = s.Storey.HeightMeters,
                ExteriorThickness = RoomPlanBatchApply.ExteriorThickness(s.Storey),
                WallThickness = UnitUtils.ConvertFromInternalUnits(s.Partition.Width, UnitTypeId.Meters),
                Core = (CorePosition)Enum.Parse(typeof(CorePosition), r.Job.Get("floor_core", "center"), true),
                Tier = r.Job.Get("floor_tier", "standard"),
            };
            r.Facts["split.input"] = U.F(input.Width) + "×" + U.F(input.Height) + " м · хонгил " + input.Core + " · " + input.Tier;
            var sw = Stopwatch.StartNew();
            s.Layout = FloorPlateSplitter.Split(input);
            sw.Stop();
            FloorPlateLayout l = s.Layout;
            r.Facts["split.ms"] = Math.Round(sw.Elapsed.TotalMilliseconds, 1);
            if (l.Error != null) return r.Fail("хуваалт: " + l.Error);
            r.Facts["split.scheme"] = l.Scheme + " · эгнээний гүн " + U.F(Math.Round(l.RowDepth, 2)) + " м";
            r.Facts["split.units"] = l.Units.Count + " айл · 1ӨА " + l.Count(1) + " · 2ӨА " + l.Count(2) + " · 3ӨА " + l.Count(3) + " · 4ӨА " + l.Count(4);
            r.Facts["split.all_lit"] = l.AllLit;
            r.Facts["split.efficiency"] = U.F(Math.Round(l.Nfa, 1)) + " / " + U.F(Math.Round(l.Gfa, 1)) + " м² = " + U.F(Math.Round(l.Efficiency * 100, 1)) + " %";
            r.Facts["split.corridor"] = Rect(l.Corridor);
            r.Facts["split.core"] = l.Core == null ? "—" : Rect(l.Core);
            r.Facts["split.walls"] = l.Walls.Count(w => w.Kind == "corridor") + " коридорын · " + l.Walls.Count(w => w.Kind == "party") + " айл хоорондын";
            if (l.Notes.Count > 0) r.Facts["split.notes"] = string.Join(" | ", l.Notes);
            foreach (FloorUnit u in l.Units)
                r.Facts["split." + u.Id] = u.Bedrooms + "ӨА " + u.Tier + " · " + U.F(Math.Round(u.Width, 2)) + "×" + U.F(Math.Round(u.Depth, 2)) + " м = " +
                    U.F(Math.Round(u.Area, 1)) + " м² · орц " + u.Entry + " · цонх " + string.Join("/", u.Facades) + " · " + u.Bathrooms + " АЦӨ";
            return StepState.Done;
        }

        private static string Rect(FloorRect x)
        {
            return "(" + U.F(Math.Round(x.X1, 2)) + "," + U.F(Math.Round(x.Y1, 2)) + ")–(" + U.F(Math.Round(x.X2, 2)) + "," + U.F(Math.Round(x.Y2, 2)) + ") " +
                   U.F(Math.Round(x.Area, 1)) + " м²";
        }

        // ── Production-ий НЭГ TransactionGroup ─────────────────────

        private static StepState Apply(GateRunner r, Scenario.State s)
        {
            Document doc = s.Doc;
            s.BeforeApply = Scenario.Snapshot(doc);
            var names = new List<string>();
            r.ChangeListener = e => names.AddRange(e.GetTransactionNames());
            var sw = Stopwatch.StartNew();
            string failure = null;
            try
            {
                using (var group = new TransactionGroup(doc, FloorPlateShell.GroupName))
                {
                    if (group.Start() != TransactionStatus.Started) return r.Fail("TransactionGroup эхэлсэнгүй");
                    try { failure = Pipeline(r, s, sw); }
                    catch (Exception ex) { failure = ex.GetType().Name + ": " + ex.Message; }
                    if (failure != null) group.RollBack();
                    else if (group.Assimilate() != TransactionStatus.Committed) failure = "Assimilate амжилтгүй";
                }
            }
            finally { r.ChangeListener = null; }
            sw.Stop();
            r.Facts["apply.total_seconds"] = Math.Round(sw.Elapsed.TotalSeconds, 2);
            r.Facts["apply.transactions"] = string.Join(" | ", names);
            if (failure != null)
            {
                HashSet<long> left = Scenario.Snapshot(doc);
                r.Facts["apply.rollback_leftover"] = left.Except(s.BeforeApply).Count();
                return r.Fail(failure);
            }

            int walls = s.Batch.Units.Sum(u => s.Selected[u.Id].Plan.Walls.Count(w => !u.Boundary.Perimeter.ContainsKey(w.Id)));
            int doors = s.Batch.Units.Sum(u => s.Selected[u.Id].Plan.Doors.Count);
            int furniture = s.Batch.Units.Sum(u => s.Selected[u.Id].Plan.Furnishings.Count(f => s.Furniture.ContainsKey(f.Kind)))
                            - s.Made.FurnitureDropped.Count;
            r.Facts["apply.created"] = s.ShellWalls.Count + " коридор/айл хоорондын хана · " + s.Made.Walls.Count + " дотор хана · " +
                s.Made.Doors.Count + " хаалга · " + s.Made.Rooms.Count + " room · " + s.Made.Tags.Count + " tag · " + s.Made.Furniture.Count + " тавилга";
            r.Facts["apply.doors_swing_flipped"] = s.Made.FlippedDoors.Count + "/" + s.Made.Doors.Count;
            r.Facts["apply.furniture_dropped"] = s.Made.FurnitureDropped.Count == 0 ? "—" : string.Join(" | ", s.Made.FurnitureDropped);
            var problems = new List<string>();
            if (s.ShellWalls.Count != s.Layout.Walls.Count) problems.Add("коридорын хана " + s.ShellWalls.Count + "/" + s.Layout.Walls.Count);
            if (s.Made.Walls.Count != walls) problems.Add("дотор хана " + s.Made.Walls.Count + "/" + walls);
            if (s.Made.Doors.Count != doors) problems.Add("хаалга " + s.Made.Doors.Count + "/" + doors);
            if (s.Made.Furniture.Count != furniture) problems.Add("тавилга " + s.Made.Furniture.Count + "/" + furniture);
            if (s.Made.Tags.Count != s.Made.Rooms.Count) problems.Add("tag " + s.Made.Tags.Count + " ≠ room " + s.Made.Rooms.Count);
            if (s.CommonRoom == null) problems.Add("нийтийн коридорын room алга");
            return problems.Count == 0 ? StepState.Done : r.Fail(string.Join("; ", problems));
        }

        /// <summary>`RoomPlanFloorCommand.Execute` + `RoomPlanBatchCommand.RunPipeline`-ийн цонхгүй давталт.  Null = OK.</summary>
        private static string Pipeline(GateRunner r, Scenario.State s, Stopwatch sw)
        {
            Document doc = s.Doc;
            s.Requests = FloorPlateShell.BuildShell(doc, s.Level, s.Storey, s.Layout, s.Partition, out List<ElementId> shell);
            s.ShellWalls = shell;
            r.Facts["apply.shell_seconds"] = Math.Round(sw.Elapsed.TotalSeconds, 2);
            if (s.Requests.Count != s.Layout.Units.Count) return "айлын хүсэлт " + s.Requests.Count + "/" + s.Layout.Units.Count;
            if (s.Requests.Any(q => !q.Boundary.Virtual || !q.Boundary.AxesStillMatch())) return "айлын хүрээ хана тэнхлэгтэйгээ таарахгүй";
            // Production RunPipeline: шинэ коридорын хана нь хүрээний хана — давхар «эзэлсэн» гэж үзэгдэх ёсгүй.
            if (RoomPlanBatchApply.HasOccupied(doc, s.Level, s.Requests)) return "коридорын ханын дараа айлуудыг «эзэлсэн» гэж үзэв";
            foreach (PythonUnitRequest q in s.Requests)
                r.Facts["unit." + q.Id + ".program"] = U.F(Math.Round(q.Boundary.WidthMeters, 2)) + "×" + U.F(Math.Round(q.Boundary.HeightMeters, 2)) + " м, " +
                    q.Bedrooms + " унтлагын, " + q.Bathrooms + " АЦӨ, " + q.Tier + ", орц " + q.Entry + ", цонх " + string.Join("/", q.Facades) +
                    ", гадна хана " + U.F(q.ExteriorWallThickness) + " м";

            double t0 = sw.Elapsed.TotalSeconds;
            s.Batch = RoomPlanPythonBridge.Generate(s.Requests);
            r.Facts["generate.seconds"] = Math.Round(sw.Elapsed.TotalSeconds - t0, 2);
            if (s.Batch.Units.Count != s.Requests.Count) return "Python нэгжийн тоо таарахгүй";
            List<PythonUnitResult> empty = s.Batch.Units.Where(u => u.Options.Count == 0).ToList();
            // Хуваагч айл бүрийг Python-ы доод хэмжээнээс том гаргадаг — хувилбаргүй айл = хуваагчийн алдаа.
            if (empty.Count > 0) return "хувилбаргүй айл: " + string.Join("; ", empty.Select(u => u.Id + " (" + u.Error + ")"));
            string select = Scenario.SelectBest(r, s);
            if (select != null) return select;
            string cross = RoomPlanBatchApply.CheckSharedBoundaryDoorConflicts(s.Batch, s.Selected);
            if (cross != null) return cross;

            if (Scenario.PickFamilies(r, s) != StepState.Done) return "family сонголт амжилтгүй (дээрх алдаа)";
            if (s.Requests.Any(q => q.Boundary.Perimeter.Values.Any(w => w == null || !w.IsValidObject) || !q.Boundary.AxesStillMatch()))
                return "Family сонголтын дараа айлын хүрээ өөрчлөгдсөн";

            t0 = sw.Elapsed.TotalSeconds;
            s.Made = RoomPlanBatchApply.Apply(doc, s.Level, s.View, s.Batch, s.Selected, s.Interior, s.Door, s.Furniture);
            r.Facts["apply.units_seconds"] = Math.Round(sw.Elapsed.TotalSeconds - t0, 2);
            foreach (PythonUnitResult u in s.Batch.Units)
                if (!RoomPlanPythonBridge.TryEvent(s.Batch, u, s.Selected[u.Id], "applied", null, out string err))
                    r.Facts["apply.feedback_error." + u.Id] = err;

            FloorPlateShell.AddCommonRoom(doc, s.Level, s.View, s.Storey, s.Layout, s.Made);
            s.CommonRoom = s.Made.Rooms.Last();
            return null;
        }

        // ── Давхрын түвшний шалгалт (айлын дотрыг Verifier шалгасан) ─────

        internal static StepState VerifyStorey(GateRunner r, Scenario.State s)
        {
            Document doc = s.Doc;
            FloorPlateLayout l = s.Layout;
            var hard = new List<string>();
            double tol = U.Mm(2);

            // 1. Коридор / айл хоорондын хана төлөвлөгөөний байрлалдаа, room-bounding, энэ давхарт.
            for (int i = 0; i < l.Walls.Count; i++)
            {
                FloorWall p = l.Walls[i];
                var w = i < s.ShellWalls.Count ? doc.GetElement(s.ShellWalls[i]) as Wall : null;
                if (w == null) { hard.Add(p.Kind + " хана #" + i + " алга"); continue; }
                var line = (Line)((LocationCurve)w.Location).Curve;
                XYZ a = At(s, p.X1, p.Y1), b = At(s, p.X2, p.Y2);
                XYZ e0 = Flat(line.GetEndPoint(0)), e1 = Flat(line.GetEndPoint(1));
                bool ok = (e0.DistanceTo(a) < tol && e1.DistanceTo(b) < tol) || (e0.DistanceTo(b) < tol && e1.DistanceTo(a) < tol);
                if (!ok) hard.Add(p.Kind + " хана #" + w.Id.Value + " төлөвлөгөөний байрлалаас зөрсөн");
                if (w.LevelId != s.Level.Id) hard.Add(p.Kind + " хана #" + w.Id.Value + " өөр level дээр");
                if (w.get_Parameter(BuiltInParameter.WALL_ATTR_ROOM_BOUNDING)?.AsInteger() != 1) hard.Add(p.Kind + " хана #" + w.Id.Value + " room-bounding биш");
            }

            // 2. Нийтийн коридор: битүү, коридор + хонгилоос хальдаггүй (айл руу урсаагүй).
            var common = s.CommonRoom == null ? null : doc.GetElement(s.CommonRoom) as Room;
            if (common == null || !(common.Area > 0)) hard.Add("нийтийн коридорын room алга / битүү биш");
            else
            {
                double axis = l.Corridor.Area + (l.Core?.Area ?? 0);
                double area = U.M2(common.Area);
                r.Facts["storey.common_room"] = Name(common) + " " + U.F(Math.Round(area, 2)) + " м² / тэнхлэгээр " + U.F(Math.Round(axis, 2)) +
                                                " м² (" + U.F(Math.Round(area / axis * 100)) + "%)";
                if (area > axis * 1.02) hard.Add("нийтийн коридор тэнхлэгийн талбайгаасаа ТОМ — айл руу урссан");
                if (area < axis * 0.6) hard.Add("нийтийн коридор хэт жижиг (" + U.F(Math.Round(area, 1)) + " м²) — хана коридорыг хаасан");
                foreach (FloorRect x in new[] { l.Corridor, l.Core }.Where(x => x != null))
                {
                    XYZ c = At(s, x.Cx, x.Cy) + new XYZ(0, 0, s.Level.Elevation + U.Mm(1000));
                    if (!common.IsPointInRoom(c)) hard.Add("нийтийн коридорын room " + (x == l.Core ? "хонгил" : "коридор") + "-ын төвийг хамрахгүй");
                }
            }

            // 3. Айл бүр ЯГ НЭГ орцоор нийтийн коридор руу нээгдэнэ.
            var entries = new Dictionary<string, int>(StringComparer.Ordinal);
            foreach (ElementId id in s.Made.Doors)
            {
                var d = doc.GetElement(id) as FamilyInstance;
                if (d == null || common == null) continue;
                Room unitRoom = d.FromRoom != null && d.FromRoom.Id == common.Id ? d.ToRoom : d.ToRoom != null && d.ToRoom.Id == common.Id ? d.FromRoom : null;
                if (unitRoom == null || unitRoom.Location == null) continue;
                XYZ p = ((LocationPoint)unitRoom.Location).Point;
                PythonUnitResult u = s.Batch.Units.FirstOrDefault(x => p.X > x.Boundary.MinX && p.X < x.Boundary.MaxX && p.Y > x.Boundary.MinY && p.Y < x.Boundary.MaxY);
                if (u != null) entries[u.Id] = entries.TryGetValue(u.Id, out int n) ? n + 1 : 1;
            }
            foreach (PythonUnitResult u in s.Batch.Units)
            {
                int n = entries.TryGetValue(u.Id, out int c) ? c : 0;
                if (n != 1) hard.Add(u.Id + ": коридор руу нээгдэх орц " + n + " (1 байх ёстой)");
            }
            r.Facts["storey.units_with_entry"] = entries.Count(kv => kv.Value == 1) + "/" + s.Batch.Units.Count;

            // 4. Хуваалт давхрыг бүрэн хамарна: айл + коридор + хонгил = давхрын талбай (тэнхлэгээр).
            double cover = l.Units.Sum(u => u.Area) + l.Corridor.Area + (l.Core?.Area ?? 0);
            r.Facts["storey.coverage"] = U.F(Math.Round(cover, 2)) + " / " + U.F(Math.Round(l.Gfa, 2)) + " м²";
            if (Math.Abs(cover - l.Gfa) > 0.05) hard.Add("хуваалт давхрыг бүрэн хамарсангүй (" + U.F(Math.Round(cover, 2)) + " / " + U.F(Math.Round(l.Gfa, 2)) + ")");

            // 5. Өдрийн гэрэл: хуваагч айл бүрийг БҮХ өрөө цонхтой байх өргөнөөр хуваасан бол (AllLit) сонгосон хувилбар бүр
            //    бүх амьдрах өрөөндөө цонхтой байх ёстой (2026-10-14-ний эхний run-д дунд айлуудад цонхгүй унтлагын өрөө гарч байв).
            var dark = s.Batch.Units.Where(u => !RoomPlanBatchApply.FullyLit(s.Selected[u.Id]))
                .Select(u => u.Id + " ☀" + s.Selected[u.Id].DaylitRooms + "/" + s.Selected[u.Id].HabitableRooms).ToList();
            r.Facts["storey.all_lit_split"] = l.AllLit;
            r.Facts["storey.units_fully_lit"] = (s.Batch.Units.Count - dark.Count) + "/" + s.Batch.Units.Count +
                                                (dark.Count == 0 ? "" : " (" + string.Join(", ", dark) + ")");
            if (l.AllLit && dark.Count > 0) hard.Add("цонхгүй өрөөтэй айл: " + string.Join(", ", dark));

            // 6. Айлын бодит (Revit) цэвэр талбай ↔ хуваагчийн тэнхлэгийн талбай.
            var areas = new List<string>();
            foreach (FloorUnit u in l.Units)
            {
                double net = s.Made.Rooms.Where(id => id != s.CommonRoom).Select(id => doc.GetElement(id) as Room)
                    .Where(x => x != null && x.Location != null && Inside(s, u, ((LocationPoint)x.Location).Point)).Sum(x => U.M2(x.Area));
                areas.Add(u.Id + " " + u.Bedrooms + "ӨА " + U.F(Math.Round(net, 1)) + "/" + U.F(Math.Round(u.Area, 1)) + " м²");
                if (net <= 0) hard.Add(u.Id + ": айлд room алга");
            }
            r.Facts["storey.unit_net_vs_axis"] = string.Join(" · ", areas);

            foreach (string h in hard) GateLog.Error("storey: " + h);
            r.Facts["storey.hard"] = hard.Count;
            return hard.Count == 0 ? StepState.Done : r.Fail(string.Join("; ", hard.Take(6)) + (hard.Count > 6 ? " … (+" + (hard.Count - 6) + ")" : ""));
        }

        private static bool Inside(Scenario.State s, FloorUnit u, XYZ p)
        {
            XYZ a = At(s, u.X1, u.Y1), b = At(s, u.X2, u.Y2);
            return p.X > a.X && p.X < b.X && p.Y > a.Y && p.Y < b.Y;
        }

        private static XYZ At(Scenario.State s, double xM, double yM)
        {
            return new XYZ(s.Storey.MinX + xM / 0.3048, s.Storey.MinY + yM / 0.3048, 0);
        }

        private static XYZ Flat(XYZ p) { return new XYZ(p.X, p.Y, 0); }

        private static string Name(Room r) { return (r.get_Parameter(BuiltInParameter.ROOM_NAME)?.AsString() ?? r.Name) + " #" + r.Id.Value; }
    }
}
