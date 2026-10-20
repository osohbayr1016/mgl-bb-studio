using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;
using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Structure;
using RevitMcpAddin.RoomPlan.Core;

namespace RevitMcpAddin.RoomPlan
{
    /// <summary>
    /// Uses ONLY user-selected preloaded non-hosted model families.
    /// No internet downloads, no speculative FamilySymbol selection.
    /// Caller must run inside its one atomic Revit transaction.
    /// </summary>
    internal static class RoomPlanFurnitureRevit
    {
        /// <summary>Categories a Family for this kind may come from (first = the usual one).</summary>
        internal static BuiltInCategory[] Categories(FurnitureKind kind)
        {
            switch (kind)
            {
                case FurnitureKind.Kitchen: return new[] { BuiltInCategory.OST_Casework };
                case FurnitureKind.Wardrobe: return new[] { BuiltInCategory.OST_Furniture, BuiltInCategory.OST_Casework };
                case FurnitureKind.Toilet:
                case FurnitureKind.Basin:
                case FurnitureKind.Bathtub:
                case FurnitureKind.Shower: return new[] { BuiltInCategory.OST_PlumbingFixtures };
                case FurnitureKind.Washer: return new[] { BuiltInCategory.OST_SpecialityEquipment, BuiltInCategory.OST_PlumbingFixtures };
                default: return new[] { BuiltInCategory.OST_Furniture };
            }
        }

        internal static BuiltInCategory Category(FurnitureKind kind) { return Categories(kind)[0]; }

        internal static IList<FamilySymbol> Candidates(Document doc, FurnitureKind kind)
        {
            var result = new List<FamilySymbol>();
            foreach (BuiltInCategory cat in Categories(kind))
                result.AddRange(new FilteredElementCollector(doc)
                    .OfClass(typeof(FamilySymbol)).OfCategory(cat)
                    .Cast<FamilySymbol>()
                    .Where(s => s.Family != null &&
                        s.Family.FamilyPlacementType == FamilyPlacementType.OneLevelBased));
            return result
                .OrderBy(s => s.Family.Name, StringComparer.OrdinalIgnoreCase)
                .ThenBy(s => s.Name, StringComparer.OrdinalIgnoreCase)
                .ToList();
        }

        internal static string Label(FurnitureKind kind)
        {
            switch (kind)
            {
                case FurnitureKind.Bed: return "Давхар ор (Furniture)";
                case FurnitureKind.BedSingle: return "Нэг хүний ор (Furniture)";
                case FurnitureKind.Nightstand: return "Орны хажуугийн шүүгээ (Furniture)";
                case FurnitureKind.Wardrobe: return "Хувцасны шүүгээ (Furniture / Casework)";
                case FurnitureKind.Desk: return "Бичгийн ширээ (Furniture)";
                case FurnitureKind.Sofa: return "Буйдан (Furniture)";
                case FurnitureKind.CoffeeTable: return "Кофены ширээ (Furniture)";
                case FurnitureKind.TvUnit: return "ТВ-ийн тавиур (Furniture)";
                case FurnitureKind.DiningTable: return "Хоолны ширээ (Furniture)";
                case FurnitureKind.Kitchen: return "Гал тогооны шүүгээ (Casework)";
                case FurnitureKind.Toilet: return "Суултуур (Plumbing Fixtures)";
                case FurnitureKind.Basin: return "Угаалтуур (Plumbing Fixtures)";
                case FurnitureKind.Bathtub: return "Ванн (Plumbing Fixtures)";
                case FurnitureKind.Shower: return "Шүршүүр (Plumbing Fixtures)";
                case FurnitureKind.Washer: return "Угаалгын машин (Specialty Equipment)";
                default: return kind.ToString();
            }
        }

        internal static string[] Keywords(FurnitureKind kind)
        {
            switch (kind)
            {
                case FurnitureKind.Bed:
                case FurnitureKind.BedSingle: return new[] { "bed", "ор_", "ор-" };
                case FurnitureKind.Nightstand: return new[] { "night", "тумбо" };
                case FurnitureKind.Wardrobe: return new[] { "wardrobe", "dresser", "armoire", "closet", "хувцас" };
                case FurnitureKind.Desk: return new[] { "desk", "бичгийн" };
                case FurnitureKind.Sofa: return new[] { "sofa", "couch", "буйдан" };
                case FurnitureKind.CoffeeTable: return new[] { "coffee", "кофе" };
                case FurnitureKind.TvUnit: return new[] { "tv stand", "tv unit", "media", "entertainment", "зурагт" };
                case FurnitureKind.DiningTable: return new[] { "dining", "хоолны" };
                case FurnitureKind.Kitchen: return new[] { "kitchen", "counter", "гал тогоо" };
                case FurnitureKind.Toilet: return new[] { "toilet", "wc", "унитаз", "суултуур" };
                case FurnitureKind.Basin: return new[] { "basin", "lavatory", "vanity", "угаалтуур" };
                case FurnitureKind.Bathtub: return new[] { "tub", "ванн" };
                case FurnitureKind.Shower: return new[] { "shower", "шүршүүр" };
                case FurnitureKind.Washer: return new[] { "washer", "washing", "угаалгын" };
                default: return new string[0];
            }
        }

        /// <summary>
        /// The picker's default for a kind: keyword matches only, then the type whose plan size is
        /// closest to what the chosen plans drew for that kind (median envelope); null when nothing
        /// matches (the architect chooses).  Size = the type's Width/Depth/Length parameters, else
        /// the first two millimetre numbers in its name («1372 x 1905mm»).
        /// </summary>
        internal static FamilySymbol Suggest(FurnitureKind kind, IList<FamilySymbol> candidates,
            IEnumerable<FurnitureTarget> targets = null)
        {
            string[] terms = Keywords(kind);
            List<FamilySymbol> matching = candidates.Where(c => terms.Any(t =>
                (c.Family.Name + " " + c.Name).IndexOf(t, StringComparison.OrdinalIgnoreCase) >= 0)).ToList();
            if (kind == FurnitureKind.Basin)   // «sink» alone would also take kitchen sinks
                matching = matching.Where(c => (c.Family.Name + c.Name).IndexOf("kitchen", StringComparison.OrdinalIgnoreCase) < 0).ToList();
            if (matching.Count == 0) return null;
            List<FurnitureTarget> wanted = (targets ?? Enumerable.Empty<FurnitureTarget>()).Where(t => t.Kind == kind).ToList();
            if (wanted.Count == 0)
            {
                string prefer = kind == FurnitureKind.Bed ? "queen|double|1525|1600|1530"
                              : kind == FurnitureKind.BedSingle ? "twin|single|0965|0900|1000" : null;
                return prefer == null ? matching[0]
                    : matching.FirstOrDefault(c => Regex.IsMatch(c.Name, prefer, RegexOptions.IgnoreCase)) ?? matching[0];
            }
            double Median(IEnumerable<double> xs) { var l = xs.OrderBy(x => x).ToList(); return l[l.Count / 2]; }
            double wantLong = Median(wanted.Select(t => Math.Max(t.Width, t.Depth)));
            double wantShort = Median(wanted.Select(t => Math.Min(t.Width, t.Depth)));
            return matching.OrderBy(c =>
            {
                double[] size = PlanSize(c);
                if (size == null) return double.MaxValue;
                return size.Length == 1 ? Math.Abs(size[0] - wantLong)
                                        : Math.Abs(size[0] - wantLong) + Math.Abs(size[1] - wantShort);
            }).ThenBy(c => c.Family.Name, StringComparer.OrdinalIgnoreCase).ThenBy(c => c.Name, StringComparer.OrdinalIgnoreCase).First();
        }

        /// <summary>
        /// The architect picks a Family (and a default type); each item then takes the type of that
        /// SAME family whose plan size is closest to what the plan drew for it — a King bed in a
        /// luxury master bedroom, a Twin in an economy child's room, the 2135 sofa in a large living
        /// room.  Bigger than the drawn size is penalised (it eats the walking space the plan kept),
        /// so a type never grows past the plan by much.  Kinds stretched by «Length» (kitchen run,
        /// wardrobe, TV unit) and types without a readable size keep the chosen type.
        /// </summary>
        internal static FamilySymbol SizedType(Document doc, FamilySymbol chosen, FurnitureTarget target)
        {
            if (target.Kind == FurnitureKind.Kitchen || target.Kind == FurnitureKind.Wardrobe ||
                target.Kind == FurnitureKind.TvUnit || chosen.Family == null)
                return chosen;
            double wantLong = Math.Max(target.Width, target.Depth), wantShort = Math.Min(target.Width, target.Depth);
            double Cost(FamilySymbol s)
            {
                double[] size = PlanSize(s);
                if (size == null) return double.MaxValue;
                double over = Math.Max(0, size[0] - wantLong) + (size.Length > 1 ? Math.Max(0, size[1] - wantShort) : 0);
                double diff = Math.Abs(size[0] - wantLong) + (size.Length > 1 ? Math.Abs(size[1] - wantShort) : 0);
                return diff + 3 * over;
            }
            double now = Cost(chosen);
            if (now == double.MaxValue) return chosen;
            FamilySymbol best = chosen;
            double bestCost = now;
            foreach (ElementId id in chosen.Family.GetFamilySymbolIds())
            {
                if (!(doc.GetElement(id) is FamilySymbol s) || s.Id == chosen.Id) continue;
                double c = Cost(s);
                if (c < bestCost - 0.02) { best = s; bestCost = c; }
            }
            return best;
        }

        /// <summary>Plan size of a type in metres, long side first (one value = only its length is known).</summary>
        internal static double[] PlanSize(FamilySymbol symbol)
        {
            var dims = new List<double>();
            foreach (string name in new[] { "Width", "Depth", "Length" })
            {
                Parameter p = symbol.LookupParameter(name);
                if (p != null && p.StorageType == StorageType.Double && p.AsDouble() > 0)
                    dims.Add(UnitUtils.ConvertFromInternalUnits(p.AsDouble(), UnitTypeId.Meters));
            }
            if (dims.Count < 2)
            {
                dims.Clear();
                foreach (Match m in Regex.Matches(symbol.Name, @"\d{3,4}"))
                    if (dims.Count < 2) dims.Add(double.Parse(m.Value) / 1000.0);
            }
            if (dims.Count == 0) return null;
            return dims.Where(d => d > 0.1 && d < 4.0).OrderByDescending(d => d).Take(2).ToArray();
        }

        internal static int Create(Document doc, Level level, double originX, double originY,
            GeneratedPlan plan, IDictionary<FurnitureKind, ElementId> mapping,
            ICollection<ElementId> created = null)
        {
            return Create(doc, level, originX, originY, plan, mapping, created, null, 0, null);
        }

        /// <param name="perimeterHalf">Half thickness of the unit's own perimeter walls by side
        /// (south/north/west/east); null = the room is measured at its wall centrelines − 9 cm.</param>
        /// <param name="interiorHalf">Half thickness of the new interior walls.</param>
        internal static int Create(Document doc, Level level, double originX, double originY,
            GeneratedPlan plan, IDictionary<FurnitureKind, ElementId> mapping,
            ICollection<ElementId> created, IDictionary<string, double> perimeterHalf, double interiorHalf,
            IDictionary<ElementId, FurnitureTarget> targetsOut, ICollection<string> dropped = null, bool skipMissingFamilies = false)
        {
            IReadOnlyList<FurnitureTarget> targets;
            if (plan.PythonGenerated)
            {
                // The Python plan owns the target positions; Revit only validates
                // actual hosted Family geometry and materializes chosen symbols.
                if (plan.Furnishings.Count == 0)
                    throw new InvalidOperationException("Python furniture invalid: missing");
                string reason;
                if (!FurniturePlanner.Safe(plan.Furnishings, plan, out reason, plan.ExteriorThickness, plan.InteriorThickness))
                    throw new InvalidOperationException("Python furniture invalid: " + reason);
                targets = plan.Furnishings;
            }
            else
                targets = FurniturePlanner.Create(plan);
            var placed = new List<(FurnitureTarget target, FamilyInstance instance)>();
            foreach (FurnitureTarget target in targets)
            {
                if (!mapping.TryGetValue(target.Kind, out ElementId id) || id == null || id == ElementId.InvalidElementId)
                {
                    // Companions (night stands, wardrobe, tub …) without a Family are simply left out; the studio
                    // («Давхрын план») also skips required ones and lists the missing families in its pane.
                    if (!FurniturePlanner.Required(target.Kind) || skipMissingFamilies) continue;
                    throw new InvalidOperationException("Family сонгогдоогүй: " + Label(target.Kind));
                }
                FamilySymbol symbol = doc.GetElement(id) as FamilySymbol;
                if (symbol == null || symbol.Category == null ||
                    !Categories(target.Kind).Any(c => symbol.Category.Id == new ElementId(c)) ||
                    symbol.Family == null ||
                    symbol.Family.FamilyPlacementType != FamilyPlacementType.OneLevelBased)
                    throw new InvalidOperationException("Family төрөл/placement тохирохгүй: " + Label(target.Kind));
                symbol = SizedType(doc, symbol, target);
                if (!symbol.IsActive) { symbol.Activate(); doc.Regenerate(); }
                XYZ pt = new XYZ(originX + Metres(target.Position.X),
                    originY + Metres(target.Position.Y), level.Elevation);
                FamilyInstance instance = doc.Create.NewFamilyInstance(
                    pt, symbol, level, StructuralType.NonStructural);
                if (instance == null) throw new InvalidOperationException("Family байршуулж чадсангүй: " + Label(target.Kind));
                MatchLength(instance, target);
                placed.Add((target, instance));
            }
            doc.Regenerate();
            Func<PlanRoom, double[]> faces = room => Faces(room, plan, originX, originY, perimeterHalf, interiorHalf);
            foreach (var item in placed)
                FitToTarget(doc, item.instance, item.target,
                    faces(plan.Rooms.Single(r => r.Name == item.target.RoomName)), originX, originY);
            doc.Regenerate();
            SeparateNeighbours(doc, placed, plan, faces);
            doc.Regenerate();
            double tolerance = Metres(0.01), doorTolerance = Metres(0.05);
            // A companion (night stand, desk, tub, the 2nd kitchen run …) whose real Family does
            // not fit is left out with a note; a required item that does not fit fails the batch.
            var seen = new HashSet<string>();
            Func<(FurnitureTarget target, FamilyInstance instance), bool> optional = item =>
                !FurniturePlanner.Required(item.target.Kind) ||
                placed.Any(o => !ReferenceEquals(o.instance, item.instance) && o.target.RoomName == item.target.RoomName &&
                                o.target.Kind == item.target.Kind && placed.IndexOf(o) < placed.IndexOf(item));
            Action<(FurnitureTarget target, FamilyInstance instance), string> drop = (item, why) =>
            {
                dropped?.Add(Label(item.target.Kind) + " «" + item.target.RoomName + "»: " + why);
                doc.Delete(item.instance.Id);
            };
            foreach (var item in placed.ToList())
            {
                BoundingBoxXYZ ob = item.instance.get_BoundingBox(null);
                double[] of = faces(plan.Rooms.Single(r => r.Name == item.target.RoomName));
                bool outside = ob == null || ob.Min.X < of[0] - tolerance || ob.Max.X > of[2] + tolerance ||
                               ob.Min.Y < of[1] - tolerance || ob.Max.Y > of[3] + tolerance;
                bool inDoor = ob != null && DoorZones(plan, plan.Rooms.Single(r => r.Name == item.target.RoomName), originX, originY)
                    .Any(z => ob.Min.X < z[2] - doorTolerance && ob.Max.X > z[0] + doorTolerance &&
                              ob.Min.Y < z[3] - doorTolerance && ob.Max.Y > z[1] + doorTolerance);
                bool clash = ob != null && placed.Any(o => !ReferenceEquals(o.instance, item.instance) && o.instance.IsValidObject &&
                    placed.IndexOf(o) < placed.IndexOf(item) && Overlaps(o.instance.get_BoundingBox(null), ob, tolerance));
                if ((outside || inDoor || clash) &&
                    Nudge(doc, item.target, item.instance,
                        placed.Where(o => !ReferenceEquals(o.instance, item.instance) && o.instance.IsValidObject).Select(o => o.instance),
                        of, DoorZones(plan, plan.Rooms.Single(r => r.Name == item.target.RoomName), originX, originY).ToList(),
                        doorTolerance))
                    continue;
                if ((outside || inDoor || clash) && optional(item))
                {
                    drop(item, outside ? "өрөөнд багтахгүй" : inDoor ? "хаалганы эргэх мужид орно" : "өөр тавилгатай давхцана");
                    placed.Remove(item);
                }
            }
            doc.Regenerate();
            foreach (var item in placed)
            {
                BoundingBoxXYZ b = item.instance.get_BoundingBox(null);
                PlanRoom room = plan.Rooms.Single(r => r.Name == item.target.RoomName);
                double[] f = faces(room);
                if (b == null ||
                    b.Min.X < f[0] - tolerance || b.Max.X > f[2] + tolerance ||
                    b.Min.Y < f[1] - tolerance || b.Max.Y > f[3] + tolerance)
                    throw new InvalidOperationException("Family бодит хэмжээ/эргэлт өрөөнөөс гарсан: " +
                        Label(item.target.Kind) + " — «" + item.instance.Symbol.Family.Name + " / " +
                        item.instance.Symbol.Name + "» " + Size(b) + " м, «" + room.Name + "» " +
                        ((f[2] - f[0]) * 0.3048).ToString("0.00") + "×" + ((f[3] - f[1]) * 0.3048).ToString("0.00") +
                        " м (хананы нүүрээр). Жижиг төрөл сонгоно уу. Бүх plan rollback болно.");
                foreach (double[] zone in DoorZones(plan, room, originX, originY))
                    if (b.Min.X < zone[2] - doorTolerance && b.Max.X > zone[0] + doorTolerance &&
                        b.Min.Y < zone[3] - doorTolerance && b.Max.Y > zone[1] + doorTolerance)
                        throw new InvalidOperationException("Тавилга хаалганы эргэх мужид орсон: " + Label(item.target.Kind) +
                            " «" + item.instance.Symbol.Family.Name + "» — жижиг төрөл сонгоно уу.");
            }
            for (int i = 0; i < placed.Count; i++)
                for (int j = i + 1; j < placed.Count; j++)
                {
                    var a = placed[i].instance.get_BoundingBox(null);
                    var b = placed[j].instance.get_BoundingBox(null);
                    if (a == null || b == null) continue;
                    if (Overlaps(a, b, tolerance))
                        throw new InvalidOperationException("Family геометр давхцсан: " +
                            Label(placed[i].target.Kind) + " / " + Label(placed[j].target.Kind));
                }
            if (created != null)
                foreach (var item in placed) created.Add(item.instance.Id);
            if (targetsOut != null)
                foreach (var item in placed) targetsOut[item.instance.Id] = item.target;
            return placed.Count;
        }

        /// <summary>
        /// A real Family bigger than the plan drew (library dining tables start at 1.5 m where a
        /// small living room had space for 1.0 m) lands in a door swing or on a neighbour.  Before
        /// it is dropped (or the batch fails), take the nearest spot within 1 m where it fits: an
        /// item backed to a wall only slides along that wall; a free-standing one may move anywhere
        /// but keeps 0.6 m (a chair) from every other item.  Measured 2026-10-14: the standard
        /// unit's dining table was dropped on every run.
        /// </summary>
        private static bool Nudge(Document doc, FurnitureTarget target, FamilyInstance instance,
            IEnumerable<FamilyInstance> others, double[] f, IList<double[]> zones, double doorTolerance)
        {
            BoundingBoxXYZ b = instance.get_BoundingBox(null);
            if (b == null) return false;
            double edge = Metres(0.015), keep = target.Back == null ? Metres(0.6) : Metres(0.01);
            double step = Metres(0.05);
            int n = 20;   // 20 × 5 cm = 1 m
            var boxes = others.Select(o => o.get_BoundingBox(null)).Where(x => x != null).ToList();
            bool Ok(double dx, double dy)
            {
                double x1 = b.Min.X + dx, x2 = b.Max.X + dx, y1 = b.Min.Y + dy, y2 = b.Max.Y + dy;
                if (x1 < f[0] + edge || x2 > f[2] - edge || y1 < f[1] + edge || y2 > f[3] - edge) return false;
                if (zones.Any(z => x1 < z[2] - doorTolerance && x2 > z[0] + doorTolerance &&
                                   y1 < z[3] - doorTolerance && y2 > z[1] + doorTolerance)) return false;
                return boxes.All(o => x2 + keep <= o.Min.X || x1 - keep >= o.Max.X || y2 + keep <= o.Min.Y || y1 - keep >= o.Max.Y);
            }
            bool alongX = target.Back == "south" || target.Back == "north";
            bool alongY = target.Back == "west" || target.Back == "east";
            var moves = new List<(double dx, double dy)>();
            for (int i = -n; i <= n; i++)
                for (int j = -n; j <= n; j++)
                    if (!(alongX && j != 0) && !(alongY && i != 0) && (i != 0 || j != 0))
                        moves.Add((i * step, j * step));
            foreach (var (dx, dy) in moves.OrderBy(m => Math.Abs(m.dx) + Math.Abs(m.dy)).ThenBy(m => m.dx).ThenBy(m => m.dy))
                if (Ok(dx, dy))
                {
                    ElementTransformUtils.MoveElement(doc, instance.Id, new XYZ(dx, dy, 0));
                    doc.Regenerate();
                    return true;
                }
            return false;
        }

        private static bool Overlaps(BoundingBoxXYZ a, BoundingBoxXYZ b, double tolerance)
        {
            return a != null && b != null &&
                   a.Min.X < b.Max.X - tolerance && a.Max.X > b.Min.X + tolerance &&
                   a.Min.Y < b.Max.Y - tolerance && a.Max.Y > b.Min.Y + tolerance &&
                   a.Min.Z < b.Max.Z && a.Max.Z > b.Min.Z;
        }

        /// <summary>
        /// Parametric casework (a counter top, a wardrobe, a TV unit) is set to the run length the plan
        /// drew — what an architect does by hand.  Only a writable INSTANCE length parameter named
        /// «Length» (or «Width» when there is no Length) is touched; the type is never edited.
        /// </summary>
        private static void MatchLength(FamilyInstance instance, FurnitureTarget target)
        {
            if (target.Back == null || !(target.Kind == FurnitureKind.Kitchen || target.Kind == FurnitureKind.Wardrobe ||
                                         target.Kind == FurnitureKind.TvUnit)) return;
            double along = target.Back == "south" || target.Back == "north" ? target.Width : target.Depth;
            foreach (string name in new[] { "Length", "Width" })
            {
                Parameter p = instance.LookupParameter(name);
                if (p == null || p.IsReadOnly || p.StorageType != StorageType.Double) continue;
                if (p.Definition.GetDataType() != SpecTypeId.Length) continue;
                try { p.Set(Metres(along)); } catch (Autodesk.Revit.Exceptions.ApplicationException) { }
                return;
            }
        }

        /// <summary>Room rectangle at the wall FACES in model feet: [minX, minY, maxX, maxY].</summary>
        private static double[] Faces(PlanRoom room, GeneratedPlan plan, double originX, double originY,
            IDictionary<string, double> perimeterHalf, double interiorHalf)
        {
            double Half(double at, double limit, string side)
            {
                if (perimeterHalf == null) return Metres(0.09);
                return Math.Abs(at - limit) < 1e-6 && perimeterHalf.TryGetValue(side, out double h) ? h : interiorHalf;
            }
            return new[]
            {
                originX + Metres(room.X1) + Half(room.X1, 0, "west"),
                originY + Metres(room.Y1) + Half(room.Y1, 0, "south"),
                originX + Metres(room.X2) - Half(room.X2, plan.Width, "east"),
                originY + Metres(room.Y2) - Half(room.Y2, plan.Height, "north"),
            };
        }

        /// <summary>Swing keep-out of every door on this room's edges (same rule as FurniturePlanner.Safe), model feet.</summary>
        private static IEnumerable<double[]> DoorZones(GeneratedPlan plan, PlanRoom r, double originX, double originY)
        {
            double h = FurniturePlanner.DoorHalf, d = FurniturePlanner.DoorDepth;
            foreach (PlanDoor door in plan.Doors)
            {
                double cx = door.Center.X, cy = door.Center.Y;
                bool alongX = cx >= r.X1 - 0.01 && cx <= r.X2 + 0.01, alongY = cy >= r.Y1 - 0.01 && cy <= r.Y2 + 0.01;
                double[] z;
                if (alongX && Math.Abs(cy - r.Y1) < 0.02) z = new[] { cx - h, r.Y1, cx + h, r.Y1 + d };
                else if (alongX && Math.Abs(cy - r.Y2) < 0.02) z = new[] { cx - h, r.Y2 - d, cx + h, r.Y2 };
                else if (alongY && Math.Abs(cx - r.X1) < 0.02) z = new[] { r.X1, cy - h, r.X1 + d, cy + h };
                else if (alongY && Math.Abs(cx - r.X2) < 0.02) z = new[] { r.X2 - d, cy - h, r.X2, cy + h };
                else continue;
                yield return new[] { originX + Metres(z[0]), originY + Metres(z[1]), originX + Metres(z[2]), originY + Metres(z[3]) };
            }
        }

        /// <summary>
        /// Library families rarely have their insertion point at the footprint centre
        /// (M_Counter Top: back corner) and their long side may point the other way.
        /// A target with a Back side: the family's back (local +Y, Revit's furniture
        /// convention — the front faces −Y) is turned to that wall and its real back edge
        /// is put on the target's back edge (the wall face), centred along the wall.
        /// A free-standing target: the long side follows the envelope, centred.
        /// Then it slides the minimum distance back inside the room if it overhangs.
        /// </summary>
        private static void FitToTarget(Document doc, FamilyInstance instance, FurnitureTarget target,
            double[] faces, double originX, double originY)
        {
            BoundingBoxXYZ b = instance.get_BoundingBox(null);
            if (b == null) return;
            XYZ pivot = ((LocationPoint)instance.Location).Point;
            double turn = 0;
            if (target.Back != null)
                turn = target.Back == "north" ? 0 : target.Back == "south" ? Math.PI :
                       target.Back == "west" ? Math.PI / 2 : -Math.PI / 2;
            else
            {
                double w = b.Max.X - b.Min.X, d = b.Max.Y - b.Min.Y;
                bool squareTarget = Math.Abs(target.Width - target.Depth) < 0.05;
                bool squareFamily = Math.Abs(w - d) < Metres(0.05);
                if (!squareTarget && !squareFamily && (target.Width > target.Depth) != (w > d)) turn = Math.PI / 2;
            }
            if (Math.Abs(turn) > 1e-9)
            {
                ElementTransformUtils.RotateElement(doc, instance.Id, Line.CreateBound(pivot, pivot + XYZ.BasisZ), turn);
                doc.Regenerate();
                b = instance.get_BoundingBox(null);
                if (b == null) return;
            }
            double tx1 = originX + Metres(target.MinX), tx2 = originX + Metres(target.MaxX);
            double ty1 = originY + Metres(target.MinY), ty2 = originY + Metres(target.MaxY);
            double mx = (tx1 + tx2) / 2 - (b.Min.X + b.Max.X) / 2;
            double my = (ty1 + ty2) / 2 - (b.Min.Y + b.Max.Y) / 2;
            // The back goes onto the REAL wall face (the partition type is chosen after the
            // layout, so the face can differ from the one Python assumed).
            double off = Metres(0.02);
            switch (target.Back)
            {
                case "south": my = faces[1] + off - b.Min.Y; break;
                case "north": my = faces[3] - off - b.Max.Y; break;
                case "west": mx = faces[0] + off - b.Min.X; break;
                case "east": mx = faces[2] - off - b.Max.X; break;
            }
            // A real family longer than Python's envelope (M_Counter Top is 2.5 m
            // where the plan drew 1.2 m) overflows the room at the planned centre
            // although the room can hold it: slide it the minimum distance back
            // inside, like an architect sliding a counter along its wall.  A family
            // bigger than the room stays put and fails the room check.
            mx += Inside(b.Min.X + mx, b.Max.X + mx, faces[0], faces[2]);
            my += Inside(b.Min.Y + my, b.Max.Y + my, faces[1], faces[3]);
            if (Math.Abs(mx) > 1e-6 || Math.Abs(my) > 1e-6)
                ElementTransformUtils.MoveElement(doc, instance.Id, new XYZ(mx, my, 0));
        }

        /// <summary>
        /// A real family wider than its envelope (a 0.5 m night stand in a 0.45 m slot) can touch
        /// its neighbour: slide the later one along its own wall until it clears, if the room allows.
        /// </summary>
        private static void SeparateNeighbours(Document doc, List<(FurnitureTarget target, FamilyInstance instance)> placed,
            GeneratedPlan plan, Func<PlanRoom, double[]> faces)
        {
            double gap = Metres(0.01);
            for (int j = 1; j < placed.Count; j++)
            {
                FurnitureTarget t = placed[j].target;
                if (t.Back == null) continue;
                bool alongX = t.Back == "south" || t.Back == "north";
                for (int i = 0; i < j; i++)
                {
                    if (placed[i].target.RoomName != t.RoomName) continue;
                    BoundingBoxXYZ a = placed[i].instance.get_BoundingBox(null), b = placed[j].instance.get_BoundingBox(null);
                    if (a == null || b == null) continue;
                    bool overlap = a.Min.X < b.Max.X - gap && a.Max.X > b.Min.X + gap && a.Min.Y < b.Max.Y - gap && a.Max.Y > b.Min.Y + gap;
                    if (!overlap) continue;
                    double shift = alongX
                        ? ((b.Min.X + b.Max.X) > (a.Min.X + a.Max.X) ? a.Max.X - b.Min.X + gap : a.Min.X - b.Max.X - gap)
                        : ((b.Min.Y + b.Max.Y) > (a.Min.Y + a.Max.Y) ? a.Max.Y - b.Min.Y + gap : a.Min.Y - b.Max.Y - gap);
                    if (Math.Abs(shift) > Metres(0.15)) continue;          // a real clash — the checks report it
                    double[] f = faces(plan.Rooms.Single(r => r.Name == t.RoomName));
                    bool fits = alongX ? b.Min.X + shift >= f[0] && b.Max.X + shift <= f[2]
                                       : b.Min.Y + shift >= f[1] && b.Max.Y + shift <= f[3];
                    if (!fits) continue;
                    ElementTransformUtils.MoveElement(doc, placed[j].instance.Id, alongX ? new XYZ(shift, 0, 0) : new XYZ(0, shift, 0));
                    doc.Regenerate();
                }
            }
        }

        /// <summary>Shift that puts [min,max] inside [lo,hi]; 0 when it is inside or cannot fit.</summary>
        private static double Inside(double min, double max, double lo, double hi)
        {
            if (max - min > hi - lo) return 0;
            if (min < lo) return lo - min;
            if (max > hi) return hi - max;
            return 0;
        }

        private static string Size(BoundingBoxXYZ b)
        {
            return b == null ? "?" : ((b.Max.X - b.Min.X) * 0.3048).ToString("0.00") + "×" +
                ((b.Max.Y - b.Min.Y) * 0.3048).ToString("0.00");
        }

        private static double Metres(double value)
        {
            return UnitUtils.ConvertToInternalUnits(value, UnitTypeId.Meters);
        }
    }
}
