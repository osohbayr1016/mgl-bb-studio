using System;
using System.Collections.Generic;
using System.Linq;
using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Architecture;
using Autodesk.Revit.DB.Structure;
using RevitMcpAddin.RoomPlan.Core;

namespace RevitMcpAddin.RoomPlan
{
    /// <summary>What one committed batch created, per kind.</summary>
    internal sealed class RoomPlanApplyResult
    {
        internal readonly List<ElementId> Walls = new List<ElementId>();
        internal readonly List<ElementId> Doors = new List<ElementId>();
        internal readonly List<ElementId> Rooms = new List<ElementId>();
        internal readonly List<ElementId> Tags = new List<ElementId>();
        internal readonly List<ElementId> Furniture = new List<ElementId>();
        /// <summary>Doors whose swing was turned towards the private room (subset of Doors).</summary>
        internal readonly List<ElementId> FlippedDoors = new List<ElementId>();
        /// <summary>The plan target each furniture instance was placed for (kind, room, back side).</summary>
        internal readonly Dictionary<ElementId, FurnitureTarget> FurnitureTargets = new Dictionary<ElementId, FurnitureTarget>();
        /// <summary>Companions left out because their real Family did not fit (shown to the architect).</summary>
        internal readonly List<string> FurnitureDropped = new List<string>();
        /// <summary>Local SQLite feedback writes that failed after the commit (shown, never fatal).</summary>
        internal readonly List<string> FeedbackErrors = new List<string>();
    }

    /// <summary>
    /// The Revit half of «Олон өрөөний план» without any UI: the checks around the
    /// Python call and the ONE atomic transaction that writes every selected unit.
    /// RoomPlanBatchCommand (dialogs) and the live gate (tests/RoomPlan.LiveGate,
    /// a separate Revit process) run exactly this code.
    /// </summary>
    internal static class RoomPlanBatchApply
    {
        internal const string TransactionName = "MGL — Python олон нэгжийн план";

        /// <summary>Default program from the floor area; the architect can still change it.</summary>
        internal static void SuggestProgram(PythonUnitRequest request)
        {
            double area = request.Boundary.WidthMeters * request.Boundary.HeightMeters;
            request.Bedrooms = area < 48 ? 1 : area < 72 ? 2 : area < 100 ? 3 : 4;
            request.Bathrooms = request.Bedrooms >= 3 || area >= 85 ? 2 : 1;
            request.Tier = SuggestTier(area, request.Bedrooms);
        }

        /// <summary>Area per bedroom: ≥ 35 m² luxury, ≥ 24 m² standard, else economy (architect can change it).</summary>
        internal static string SuggestTier(double area, int bedrooms)
        {
            double each = area / Math.Max(1, bedrooms);
            return each >= 35 ? "luxury" : each >= 24 ? "standard" : "economy";
        }

        /// <summary>Thickest perimeter wall of the unit (m) — the layout keeps furniture off its face.</summary>
        internal static double ExteriorThickness(ExistingFloorBoundary b)
        {
            return b.Perimeter.Values.Max(w => UnitUtils.ConvertFromInternalUnits(w.Width, UnitTypeId.Meters));
        }

        /// <summary>
        /// Window sides of one unit: not the entrance, and not a wall shared
        /// with another selected apartment (same wall element, or coincident
        /// centrelines overlapping by more than 1 m).
        /// </summary>
        internal static List<string> DetectFacades(PythonUnitRequest unit, IList<PythonUnitRequest> all)
        {
            var result = new List<string>();
            string entry = unit.Entry.ToString().ToLowerInvariant();
            double tol = Metres(0.35), overlap = Metres(1.0);
            ExistingFloorBoundary a = unit.Boundary;
            foreach (string side in new[] { "south", "north", "west", "east" })
            {
                if (side == entry) continue;
                bool shared = false;
                foreach (var other in all)
                {
                    if (ReferenceEquals(other, unit)) continue;
                    ExistingFloorBoundary b = other.Boundary;
                    string opposite = side == "south" ? "north" : side == "north" ? "south" :
                        side == "west" ? "east" : "west";
                    if (a.Perimeter.TryGetValue(side, out Wall mine) &&
                        b.Perimeter.TryGetValue(opposite, out Wall theirs) && mine.Id == theirs.Id)
                    { shared = true; break; }
                    bool horizontal = side == "south" || side == "north";
                    double line = side == "south" ? a.MinY : side == "north" ? a.MaxY :
                        side == "west" ? a.MinX : a.MaxX;
                    double otherLine = opposite == "south" ? b.MinY : opposite == "north" ? b.MaxY :
                        opposite == "west" ? b.MinX : b.MaxX;
                    double span = horizontal
                        ? Math.Min(a.MaxX, b.MaxX) - Math.Max(a.MinX, b.MinX)
                        : Math.Min(a.MaxY, b.MaxY) - Math.Max(a.MinY, b.MinY);
                    if (Math.Abs(line - otherLine) < tol && span > overlap) { shared = true; break; }
                }
                if (!shared) result.Add(side);
            }
            return result;
        }

        internal static string CheckSharedBoundaryDoorConflicts(PythonBatch batch,
            IReadOnlyDictionary<string, PythonOption> selected)
        {
            // Two apartments can share one native exterior Wall. Blindly
            // placing identical entry points on it creates overlapping hosted
            // Revit doors, even when their Floor footprints do not intersect.
            var all = new List<Tuple<ElementId, XYZ, string>>();
            foreach (var unit in batch.Units)
            {
                if (!selected.TryGetValue(unit.Id, out PythonOption chosen))
                    return unit.Id + " сонголт олдсонгүй.";
                foreach (PlanDoor d in chosen.Plan.Doors)
                {
                    if (!unit.Boundary.Perimeter.TryGetValue(d.HostWall, out Wall host))
                        continue;
                    XYZ p = new XYZ(unit.Boundary.MinX + Metres(d.Center.X),
                        unit.Boundary.MinY + Metres(d.Center.Y), 0);
                    // Different units' doors on one wall (a corridor wall carries every entry of its row) only
                    // clash when the leaves themselves overlap: the generator keeps each door ≥ 0.7 m from its
                    // unit's corners, so neighbours sit ≥ 1.4 m apart with the party wall between them.
                    foreach (var earlier in all)
                        if (earlier.Item1.Equals(host.Id) &&
                            earlier.Item2.DistanceTo(p) < Metres(1.0))
                            return "Нэг хананд давхцах орох хаалга: " +
                                earlier.Item3 + " ба " + unit.Id + ".";
                    all.Add(Tuple.Create(host.Id, p, unit.Id));
                }
            }
            return null;
        }

        /// <summary>Хувилбарын БҮХ амьдрах өрөө (унтлагын, зочны) цонхтой юу (Python-ы `daylit_rooms` / `habitable_rooms`).</summary>
        internal static bool FullyLit(PythonOption o)
        {
            return o != null && o.DaylitRooms >= o.HabitableRooms;
        }

        /// <summary>
        /// «Шилдэг» хувилбарын дараалал: бүх өрөө нь цонхтой хувилбарууд түрүүлж (Python-ы оноогоор), дараа нь бусад.
        /// Python оноогоороо эрэмбэлдэг (гэрэл 32 %-ийн жинтэй) тул цонхгүй унтлагын өрөөтэй хувилбар заримдаа №1 болдог —
        /// цонхгүй амьдрах өрөө бол зураг төслийн согог, оноо бага зэрэг өндөр гэдгээр сонгогдох ёсгүй.  «Бүгдэд шилдгийг
        /// сонгох», «Давхрын план»-ы хувилбар бүрдүүлэлт ба live gate үүгээр (галерей оноогоор хэвээр, ☀ шүүлтүүртэй).
        /// </summary>
        internal static IEnumerable<PythonOption> BestFirst(IEnumerable<PythonOption> options)
        {
            List<PythonOption> list = options.ToList();
            return list.Where(FullyLit).Concat(list.Where(o => !FullyLit(o)));
        }

        internal static bool FootprintsOverlap(ExistingFloorBoundary a, ExistingFloorBoundary b)
        {
            return Math.Min(a.MaxX,b.MaxX)-Math.Max(a.MinX,b.MinX) > 0.05 &&
                   Math.Min(a.MaxY,b.MaxY)-Math.Max(a.MinY,b.MinY) > 0.05;
        }

        internal static bool HasOccupied(Document doc, Level level, IEnumerable<PythonUnitRequest> units)
        {
            var boundaries = units.Select(r => r.Boundary).ToList();
            var allowedWalls = new HashSet<ElementId>(boundaries.SelectMany(x => x.Perimeter.Values.Select(v => v.Id)));
            var cats = new[]
            {
                BuiltInCategory.OST_Rooms, BuiltInCategory.OST_Doors,
                BuiltInCategory.OST_Windows, BuiltInCategory.OST_Furniture,
                BuiltInCategory.OST_Casework, BuiltInCategory.OST_PlumbingFixtures,
                BuiltInCategory.OST_StructuralColumns, BuiltInCategory.OST_Columns
            };
            foreach (Wall wall in new FilteredElementCollector(doc).OfClass(typeof(Wall)))
            {
                if (wall.LevelId != level.Id || allowedWalls.Contains(wall.Id)) continue;
                if (IntersectsAny(wall.get_BoundingBox(null), boundaries)) return true;
            }
            // Only this storey counts: identical units on the next floor must not
            // read as «occupied» once the floor below is planned (XY alone did).
            double bottom = level.Elevation + 0.01, top = level.Elevation + Metres(2.8) - 0.01;
            foreach (BuiltInCategory cat in cats)
                foreach (Element e in new FilteredElementCollector(doc).OfCategory(cat)
                    .WhereElementIsNotElementType())
                {
                    if (e is Room room && (room.LevelId != level.Id || room.Area <= 0)) continue;
                    BoundingBoxXYZ box = e.get_BoundingBox(null);
                    if (!(e is Room) && box != null && (box.Max.Z < bottom || box.Min.Z > top)) continue;
                    if (IntersectsAny(box, boundaries)) return true;
                }
            return false;
        }

        /// <summary>
        /// Can Revit build the chosen door in each wall type it will be hosted in?  Measured
        /// 2026-10-14: «M_Door-Passage-Single-Flush» builds in a 200 mm wall but fails in a
        /// 100 mm partition («Profile sketch is empty!» → «Can't make type») — every interior
        /// door then kills the whole batch at commit.  Tries the door in a temporary wall of
        /// each type far from the model and ALWAYS rolls back.  Null = fine, otherwise a
        /// message for the architect.
        /// </summary>
        internal static string DoorHostProblem(Document doc, Level level, IEnumerable<WallType> wallTypes,
            FamilySymbol doorType)
        {
            var problems = new List<string>();
            foreach (WallType wallType in wallTypes.GroupBy(t => t.Id).Select(g => g.First()))
            {
                var failures = new RollbackOnError(false);
                using (var group = new TransactionGroup(doc, "MGL — хаалга шалгах"))
                {
                    group.Start();
                    using (var tx = new Transaction(doc, "MGL — хаалга шалгах"))
                    {
                        FailureHandlingOptions handling = tx.GetFailureHandlingOptions();
                        handling.SetFailuresPreprocessor(failures);
                        tx.SetFailureHandlingOptions(handling);
                        tx.Start();
                        if (!doorType.IsActive) { doorType.Activate(); doc.Regenerate(); }
                        XYZ at = new XYZ(Metres(-900), Metres(-900), level.Elevation);
                        Wall wall = Wall.Create(doc, Line.CreateBound(at, at + new XYZ(Metres(4), 0, 0)),
                            wallType.Id, level.Id, Metres(2.8), 0, false, false);
                        doc.Regenerate();
                        doc.Create.NewFamilyInstance(at + new XYZ(Metres(2), 0, 0), doorType, wall, level,
                            StructuralType.NonStructural);
                        tx.Commit();
                    }
                    group.RollBack();
                }
                if (failures.Errors.Count > 0)
                    problems.Add("«" + wallType.Name + "» (" + (wallType.Width * 304.8).ToString("0") + " мм): " +
                        string.Join("; ", failures.Errors.Distinct()));
            }
            if (problems.Count == 0) return null;
            return "Хаалга «" + doorType.FamilyName + " : " + doorType.Name + "» дараах хананд Revit-д үүсэхгүй:\n" +
                string.Join("\n", problems) + "\nӨөр хаалганы төрөл, эсвэл илүү зузаан дотор ханын төрөл сонгоно уу.";
        }

        /// <summary>
        /// Writes every unit of <paramref name="batch"/> in ONE transaction (one Ctrl+Z).
        /// Any failure throws; the transaction is then rolled back and nothing stays in the model.
        /// </summary>
        /// <param name="furniture">Хоосон (эсвэл null) = тавилгагүй горим: хана, хаалга, Room л — «Давхрын план»-ы эхний алхам.</param>
        /// <param name="skipMissingFamilies">true = family-гүй заавал тавилгыг (ор, буйдан …) алгасна (студи — самбар тэмдэглэнэ);
        /// false = «Олон өрөөний план»-ы хатуу шалгалт (family сонгоогүй бол бүгдийг буцаана).</param>
        internal static RoomPlanApplyResult Apply(Document doc, Level level, ViewPlan view, PythonBatch batch,
            IReadOnlyDictionary<string, PythonOption> selected, WallType wallType, FamilySymbol doorType,
            IDictionary<FurnitureKind, ElementId> furniture, bool skipMissingFamilies = false)
        {
            var result = new RoomPlanApplyResult();
            var failures = new RollbackOnError();
            using (var tx = new Transaction(doc, TransactionName))
            {
                // A Revit error must never become a half plan: without this the
                // architect gets Revit's error dialog, may pick «Delete Element(s)»
                // and the commit succeeds with whatever survived.
                FailureHandlingOptions handling = tx.GetFailureHandlingOptions();
                handling.SetFailuresPreprocessor(failures);
                tx.SetFailureHandlingOptions(handling);
                if (tx.Start() != TransactionStatus.Started)
                    throw new InvalidOperationException("Revit transaction эхэлсэнгүй.");
                if (!doorType.IsActive) { doorType.Activate(); doc.Regenerate(); }
                var allTags = new List<(RoomTag tag, Room room)>();
                foreach (var unit in batch.Units)
                {
                    if (!selected.TryGetValue(unit.Id, out PythonOption option))
                        throw new InvalidOperationException(unit.Id + " сонголт алга.");
                    GeneratedPlan plan = option.Plan;
                    ExistingFloorBoundary b = unit.Boundary;
                    var walls = new Dictionary<string, Wall>(b.Perimeter, StringComparer.Ordinal);
                    foreach (PlanWall segment in plan.Walls.Where(w => !b.Perimeter.ContainsKey(w.Id)))
                    {
                        XYZ a = At(b, level, segment.Start), e = At(b, level, segment.End);
                        Wall wall = Wall.Create(doc, Line.CreateBound(a, e),
                            wallType.Id, level.Id, Metres(2.8), 0, false, false);
                        if (wall == null) throw new InvalidOperationException("Хана үүссэнгүй: " + unit.Id);
                        walls.Add(segment.Id, wall); result.Walls.Add(wall.Id);
                    }
                    doc.Regenerate();
                    var placedDoors = new List<FamilyInstance>();
                    foreach (PlanDoor d in plan.Doors)
                    {
                        if (!walls.TryGetValue(d.HostWall, out Wall host))
                            throw new InvalidOperationException("Хаалганы host Wall олдсонгүй: " + d.HostWall);
                        FamilyInstance door = doc.Create.NewFamilyInstance(At(b, level, d.Center),
                            doorType, host, level, StructuralType.NonStructural);
                        if (door == null) throw new InvalidOperationException(unit.Id + " Door бүтэлгүйтсэн.");
                        result.Doors.Add(door.Id); placedDoors.Add(door);
                    }
                    doc.Regenerate();
                    foreach (PlanRoom room in plan.Rooms)
                    {
                        XYZ point = At(b, level, room.Center);
                        // A corridor drawn as several rectangles (foyer +
                        // cross corridor) has no wall between its pieces, so
                        // Revit sees ONE enclosed region: place one Room.
                        if (room.Name == "Хонгил" &&
                            doc.GetRoomAtPoint(point + new XYZ(0, 0, Metres(1.0))) is Room existing &&
                            existing.LevelId == level.Id)
                            continue;
                        Room revitRoom = doc.Create.NewRoom(level, new UV(point.X, point.Y));
                        if (revitRoom == null)
                            throw new InvalidOperationException("Room үүссэнгүй: " + room.Name);
                        revitRoom.Name = room.Name;
                        doc.Regenerate();
                        if (revitRoom.Area <= 0)
                            throw new InvalidOperationException("Room битүү биш: " + unit.Id + " / " + room.Name);
                        RoomTag tag = doc.Create.NewRoomTag(new LinkElementId(revitRoom.Id),
                            new UV(point.X, point.Y), view.Id);
                        if (tag == null)
                            throw new InvalidOperationException("Room Tag үүссэнгүй: " + unit.Id);
                        result.Rooms.Add(revitRoom.Id); result.Tags.Add(tag.Id);
                        allTags.Add((tag, revitRoom));
                    }
                    var unitFurniture = new List<ElementId>();
                    var perimeterHalf = b.Perimeter.ToDictionary(kv => kv.Key, kv => kv.Value.Width / 2);
                    if (furniture != null && furniture.Count > 0)
                        RoomPlanFurnitureRevit.Create(doc, level, b.MinX, b.MinY, plan, furniture, unitFurniture,
                            perimeterHalf, wallType.Width / 2, result.FurnitureTargets, result.FurnitureDropped, skipMissingFamilies);
                    result.Furniture.AddRange(unitFurniture);
                    // Swings last: they must know where the real furniture ended up.
                    OrientSwings(doc, placedDoors, unitFurniture, view, plan, b, result.FlippedDoors);
                    doc.Regenerate();
                }
                // Tags last, over every unit at once: a tag's text spills across the party wall.
                PlaceTags(doc, view, allTags, result.Furniture);
                if (tx.Commit() != TransactionStatus.Committed)
                    throw new InvalidOperationException("Batch commit амжилтгүй" +
                        (failures.Errors.Count == 0 ? "." : ": " + string.Join("; ", failures.Errors.Distinct())));
            }
            return result;
        }

        /// <summary>
        /// Revit puts a hosted door's swing on whichever side the host wall was drawn towards,
        /// so nothing decided it.  Measured 2026-10-14 on a 3-apartment plate: bedroom, bathroom
        /// and entry doors swung into one 1.4 m corridor and hit each other, and doors swung
        /// into the corner of a 1.5×2.0 m bed.  For every door, all four ways it can hang
        /// (facing × hinge side) are evaluated from the family's real plan arc, mirrored:
        ///   1. the leaf must not hit furniture or sweep into another room (through a wall),
        ///   2. it must not overlap the swing of a door already decided in this unit,
        ///   3. between a corridor («Хонгил») / the living hub («Зочны …») and a private room
        ///      it opens INTO the private room, keeping circulation clear.
        /// Ties keep the door as Revit placed it.  No plan arc → the door is left alone.
        /// </summary>
        internal static void OrientSwings(Document doc, IList<FamilyInstance> doors, IList<ElementId> furniture,
            View view, GeneratedPlan plan, ExistingFloorBoundary b, ICollection<ElementId> flipped)
        {
            var boxes = furniture.Select(id => doc.GetElement(id)?.get_BoundingBox(null)).Where(x => x != null).ToList();
            var decided = new List<Swing>();
            double inset = Metres(0.01);
            foreach (FamilyInstance door in doors)
            {
                if (!(door.Host is Wall host) || !(((LocationCurve)host.Location).Curve is Line line)) continue;
                Arc arc = SwingArc(door, view);
                if (arc == null) continue;
                XYZ at = Flat(((LocationPoint)door.Location).Point);
                XYZ dir = Flat(line.Direction).Normalize();
                XYZ normal = new XYZ(-dir.Y, dir.X, 0);
                double probe = host.Width / 2 + Metres(0.3);
                PlanRoom plusRoom = PlanRoomAt(plan, b, at + normal * probe), minusRoom = PlanRoomAt(plan, b, at - normal * probe);
                int want = 0;   // +1 / -1 = side of the more private room, 0 = no preference
                if (plusRoom != null && minusRoom != null && Circulation(plusRoom.Name) != Circulation(minusRoom.Name))
                    want = Circulation(plusRoom.Name) > Circulation(minusRoom.Name) ? 1 : -1;
                var placed = new Swing(Flat(arc.Center), Flat(arc.GetEndPoint(0)), Flat(arc.GetEndPoint(1)), arc.Radius);

                Swing best = null;
                bool bestFacing = false, bestHand = false;
                int bestScore = int.MinValue;
                foreach (bool facing in new[] { false, true })
                    foreach (bool hand in new[] { false, true })
                    {
                        if ((facing && !door.CanFlipFacing) || (hand && !door.CanFlipHand)) continue;
                        Func<XYZ, XYZ> mirror = p =>
                        {
                            if (facing) p = p - normal * (2 * (p - at).DotProduct(normal));
                            if (hand) p = p - dir * (2 * (p - at).DotProduct(dir));
                            return p;
                        };
                        var swing = new Swing(mirror(placed.Center), mirror(placed.E0), mirror(placed.E1), placed.Radius);
                        List<XYZ> samples = swing.Samples();
                        var rooms = new HashSet<string>(samples.Select(p => PlanRoomAt(plan, b, p)?.Name ?? "∅"));
                        bool blocked = rooms.Count > 1 || samples.Any(p => boxes.Any(x =>
                            p.X > x.Min.X + inset && p.X < x.Max.X - inset && p.Y > x.Min.Y + inset && p.Y < x.Max.Y - inset));
                        bool clash = decided.Any(o => samples.Any(o.Contains) || o.Samples().Any(swing.Contains));
                        int side = Math.Sign((swing.Mid() - at).DotProduct(normal));
                        int score = (blocked ? 0 : 4) + (clash ? 0 : 2) + (want == 0 || side == want ? 1 : 0);
                        if (score > bestScore) { bestScore = score; best = swing; bestFacing = facing; bestHand = hand; }
                    }
                if (bestFacing) door.flipFacing();
                if (bestHand) door.flipHand();
                if (bestFacing || bestHand) flipped.Add(door.Id);
                decided.Add(best);
            }
        }

        /// <summary>A door leaf's swept quarter: hinge centre, closed/open end points, radius (plan, Z = 0).</summary>
        private sealed class Swing
        {
            internal readonly XYZ Center, E0, E1;
            internal readonly double Radius;

            internal Swing(XYZ center, XYZ e0, XYZ e1, double radius) { Center = center; E0 = e0; E1 = e1; Radius = radius; }

            internal XYZ Mid()
            {
                XYZ m = (E0 - Center) + (E1 - Center);
                return m.GetLength() < 1e-9 ? Center : Center + m.Normalize() * Radius;
            }

            /// <summary>Inside the sector (≤ 180°) — orientation-free, so it also works mirrored.</summary>
            internal bool Contains(XYZ p)
            {
                XYZ v = p - Center, a = E0 - Center, c = E1 - Center;
                if (v.GetLength() > Radius) return false;
                double ab = Cross(a, c), av = Cross(a, v), vb = Cross(v, c);
                return ab >= 0 ? av >= -1e-9 && vb >= -1e-9 : av <= 1e-9 && vb <= 1e-9;
            }

            internal List<XYZ> Samples()
            {
                var list = new List<XYZ>();
                XYZ a = (E0 - Center).Normalize(), c = (E1 - Center).Normalize();
                for (double f = 0.05; f < 1; f += 0.1)
                {
                    XYZ d = (a * (1 - f) + c * f).Normalize();
                    for (double k = 0.15; k < 0.96; k += 0.1333) list.Add(Center + d * (Radius * k));
                }
                return list;
            }

            private static double Cross(XYZ a, XYZ b) { return a.X * b.Y - a.Y * b.X; }
        }

        private static XYZ Flat(XYZ p) { return new XYZ(p.X, p.Y, 0); }

        /// <summary>0 = corridor, 1 = living hub, 2 = private room.</summary>
        private static int Circulation(string name)
        {
            if (name == "Хонгил") return 0;
            return name.StartsWith("Зочны", StringComparison.Ordinal) ? 1 : 2;
        }

        private static PlanRoom PlanRoomAt(GeneratedPlan plan, ExistingFloorBoundary b, XYZ p)
        {
            double x = UnitUtils.ConvertFromInternalUnits(p.X - b.MinX, UnitTypeId.Meters);
            double y = UnitUtils.ConvertFromInternalUnits(p.Y - b.MinY, UnitTypeId.Meters);
            return plan.Rooms.FirstOrDefault(r => x > r.X1 && x < r.X2 && y > r.Y1 && y < r.Y2);
        }

        /// <summary>The door's swing arc in plan (radius ≈ leaf width) from the family's plan representation.</summary>
        internal static Arc SwingArc(FamilyInstance door, View view)
        {
            Parameter p = door.Symbol.get_Parameter(BuiltInParameter.DOOR_WIDTH) ??
                          door.Symbol.get_Parameter(BuiltInParameter.FAMILY_WIDTH_PARAM) ??
                          door.get_Parameter(BuiltInParameter.DOOR_WIDTH);
            double width = p != null && p.StorageType == StorageType.Double ? p.AsDouble() : Metres(0.9);
            GeometryElement geometry = door.get_Geometry(new Options { View = view });
            Arc best = null;
            foreach (Arc arc in Arcs(geometry))
                if (arc.IsBound && Math.Abs(arc.Radius - width) < width * 0.25 &&
                    (best == null || arc.Radius > best.Radius)) best = arc;
            return best;
        }

        private static IEnumerable<Arc> Arcs(GeometryElement geometry)
        {
            if (geometry == null) yield break;
            foreach (GeometryObject o in geometry)
            {
                if (o is Arc a) yield return a;
                else if (o is GeometryInstance gi)
                    foreach (Arc x in Arcs(gi.GetInstanceGeometry())) yield return x;
            }
        }

        /// <summary>
        /// A tag at the room centre sits on the bed or the dining table, and a «M_Room Tag» at 1:100
        /// is 3.3–4.4 m × 1.4 m (measured 2026-10-14) — wider than most rooms, so its text spills
        /// into the neighbour.  Each tag stays inside its own room's extent where it fits (centred
        /// across it where it does not) and takes the spot that covers the least furniture and no
        /// tag placed before it; a tie keeps it nearest the room centre.  Tightest rooms go first,
        /// the roomy ones step aside.
        /// </summary>
        private static void PlaceTags(Document doc, View view, List<(RoomTag tag, Room room)> tags, IList<ElementId> furniture)
        {
            var boxes = furniture.Select(id => doc.GetElement(id)?.get_BoundingBox(null)).Where(x => x != null)
                .Select(x => new[] { x.Min.X, x.Min.Y, x.Max.X, x.Max.Y }).ToList();
            var placed = new List<double[]>();
            double margin = Metres(0.1), step = Metres(0.1), eps = 1e-6;
            var work = new List<(RoomTag tag, Room room, BoundingBoxXYZ extent, BoundingBoxXYZ area, XYZ at, double slack)>();
            foreach (var (tag, room) in tags)
            {
                BoundingBoxXYZ extent = tag.get_BoundingBox(view), area = room.get_BoundingBox(null);
                if (extent == null || area == null || !(tag.Location is LocationPoint lp)) continue;
                double slack = Math.Min((area.Max.X - area.Min.X) - (extent.Max.X - extent.Min.X),
                                        (area.Max.Y - area.Min.Y) - (extent.Max.Y - extent.Min.Y));
                work.Add((tag, room, extent, area, lp.Point, slack));
            }
            foreach (var w in work.OrderBy(x => x.slack))
            {
                XYZ at = w.at;
                double l = at.X - w.extent.Min.X, r = w.extent.Max.X - at.X;
                double d = at.Y - w.extent.Min.Y, u = w.extent.Max.Y - at.Y;
                IEnumerable<double> Range(double lo, double hi, double before, double after)
                {
                    double a = lo + margin + before, b = hi - margin - after;
                    if (a > b) { yield return (lo + hi) / 2 + (before - after) / 2; yield break; }
                    for (double v = a; v <= b + eps; v += step) yield return v;
                }
                double Over(double[] x, double cx, double cy) =>
                    Math.Max(0, Math.Min(cx + r, x[2]) - Math.Max(cx - l, x[0])) *
                    Math.Max(0, Math.Min(cy + u, x[3]) - Math.Max(cy - d, x[1]));
                double Cost(double cx, double cy) => boxes.Sum(x => Over(x, cx, cy)) + 4 * placed.Sum(x => Over(x, cx, cy));
                double z = w.room.Level.Elevation + Metres(1.0);
                double bestX = at.X, bestY = at.Y, bestCost = double.MaxValue, bestDist = double.MaxValue;
                foreach (double x in Range(w.area.Min.X, w.area.Max.X, l, r))
                    foreach (double y in Range(w.area.Min.Y, w.area.Max.Y, d, u))
                    {
                        if (!w.room.IsPointInRoom(new XYZ(x, y, z))) continue;
                        double cost = Cost(x, y), dist = Math.Abs(x - at.X) + Math.Abs(y - at.Y);
                        if (cost < bestCost - eps || (cost < bestCost + eps && dist < bestDist))
                        { bestX = x; bestY = y; bestCost = cost; bestDist = dist; }
                    }
                if (bestCost == double.MaxValue) { bestX = at.X; bestY = at.Y; }
                if (Math.Abs(bestX - at.X) > eps || Math.Abs(bestY - at.Y) > eps)
                    ElementTransformUtils.MoveElement(doc, w.tag.Id, new XYZ(bestX - at.X, bestY - at.Y, 0));
                placed.Add(new[] { bestX - l, bestY - d, bestX + r, bestY + u });
            }
        }

        /// <summary>Any Revit error (not warning) rolls the whole batch back without a dialog.</summary>
        internal sealed class RollbackOnError : IFailuresPreprocessor
        {
            internal readonly List<string> Errors = new List<string>();
            private readonly bool _withIds;

            internal RollbackOnError(bool withIds = true) { _withIds = withIds; }

            public FailureProcessingResult PreprocessFailures(FailuresAccessor accessor)
            {
                bool error = false;
                foreach (FailureMessageAccessor m in accessor.GetFailureMessages())
                    if (m.GetSeverity() != FailureSeverity.Warning)
                    {
                        error = true;
                        ICollection<ElementId> ids = m.GetFailingElementIds();
                        Errors.Add(m.GetDescriptionText() + (!_withIds || ids.Count == 0 ? "" :
                            " (ID " + string.Join(", ", ids.Select(i => i.ToString())) + ")"));
                    }
                if (!error) return FailureProcessingResult.Continue;
                FailureHandlingOptions options = accessor.GetFailureHandlingOptions();
                options.SetClearAfterRollback(true);
                accessor.SetFailureHandlingOptions(options);
                return FailureProcessingResult.ProceedWithRollBack;
            }
        }

        private static XYZ At(ExistingFloorBoundary b, Level level, PlanPoint p)
        {
            return new XYZ(b.MinX + Metres(p.X), b.MinY + Metres(p.Y), level.Elevation);
        }

        private static double Metres(double x) { return UnitUtils.ConvertToInternalUnits(x, UnitTypeId.Meters); }

        private static bool IntersectsAny(BoundingBoxXYZ box, List<ExistingFloorBoundary> bounds)
        {
            if (box == null) return false;
            return bounds.Any(b => box.Max.X > b.MinX + 0.015 && box.Min.X < b.MaxX - 0.015 &&
                                   box.Max.Y > b.MinY + 0.015 && box.Min.Y < b.MaxY - 0.015);
        }
    }
}
