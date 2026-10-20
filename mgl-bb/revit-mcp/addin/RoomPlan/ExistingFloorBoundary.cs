using System;
using System.Collections.Generic;
using System.Linq;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;
using Autodesk.Revit.UI.Selection;
using RevitMcpAddin.RoomPlan.Core;

namespace RevitMcpAddin.RoomPlan
{
    /// <summary>
    /// Strict, fail-closed first detector: a SINGLE axis-aligned rectangular floor
    /// and FOUR matching room-bounding existing basic walls. No geometry modifications.
    /// Revit sloped, curved, L-shaped, linked or multiple-floor footprints are rejected.
    /// </summary>
    internal sealed class ExistingFloorBoundary
    {
        internal Floor Floor;
        internal double MinX, MinY, MaxX, MaxY;
        /// <summary>
        /// Давхрын планаас (`RoomPlanFloorCommand`) үүссэн айл: өөрийн Floor-гүй, хүрээ нь гадна хана +
        /// шинээр үүсгэсэн коридор / айл хоорондын хана.  `Floor` нь бүтэн давхрын шал.
        /// </summary>
        internal bool Virtual;
        internal readonly Dictionary<string, Wall> Perimeter = new Dictionary<string, Wall>(StringComparer.Ordinal);
        internal double WidthMeters { get { return UnitUtils.ConvertFromInternalUnits(MaxX - MinX, UnitTypeId.Meters); } }
        internal double HeightMeters { get { return UnitUtils.ConvertFromInternalUnits(MaxY - MinY, UnitTypeId.Meters); } }

        internal static ExistingFloorBoundary Pick(UIDocument ui, Level level)
        {
            Floor floor = ui.Selection.GetElementIds().Select(id => ui.Document.GetElement(id))
                .OfType<Floor>().SingleOrDefault();
            if (floor == null)
            {
                Reference reference = ui.Selection.PickObject(ObjectType.Element,
                    new OnlyFloors(), "Шал (Floor) сонгоно уу. Зөвхөн нэг тэгш өнцөгт шалыг дэмжинэ.");
                floor = ui.Document.GetElement(reference) as Floor;
            }
            if (floor == null || floor.LevelId != level.Id)
                throw new ArgumentException("Floor энэ Floor Plan-ы Level дээр биш байна.");
            return Read(ui.Document, floor, level);
        }

        /// <summary>Давхрын планы айлын хүрээ: тэнхлэгийн тэгш өнцөгт + тал бүрийн хана (south/north/west/east).</summary>
        internal static ExistingFloorBoundary FromWalls(Floor storey, double minX, double minY, double maxX, double maxY,
            IDictionary<string, Wall> perimeter)
        {
            var b = new ExistingFloorBoundary { Floor = storey, MinX = minX, MinY = minY, MaxX = maxX, MaxY = maxY, Virtual = true };
            foreach (string side in new[] { "south", "north", "west", "east" })
            {
                if (!perimeter.TryGetValue(side, out Wall wall) || wall == null)
                    throw new ArgumentException("Айлын " + side + " талын хана олдсонгүй.");
                b.Perimeter[side] = wall;
            }
            if (!b.AxesStillMatch()) throw new ArgumentException("Айлын хүрээний хана тэнхлэгтэйгээ таарахгүй байна.");
            return b;
        }

        /// <summary>Хүрээний хана бүрийн тэнхлэг айлын ирмэг дээр, ирмэгийг бүрэн хамарч байна уу.</summary>
        internal bool AxesStillMatch()
        {
            const double tol = 0.02, endTol = 0.05; // ft
            foreach (var kv in Perimeter)
            {
                if (kv.Value == null || !kv.Value.IsValidObject || !((kv.Value.Location as LocationCurve)?.Curve is Line line)) return false;
                XYZ a = line.GetEndPoint(0), b = line.GetEndPoint(1);
                bool vertical = kv.Key == "west" || kv.Key == "east";
                double axis = vertical ? (a.X + b.X) / 2 : (a.Y + b.Y) / 2;
                double want = kv.Key == "south" ? MinY : kv.Key == "north" ? MaxY : kv.Key == "west" ? MinX : MaxX;
                double lo = vertical ? Math.Min(a.Y, b.Y) : Math.Min(a.X, b.X), hi = vertical ? Math.Max(a.Y, b.Y) : Math.Max(a.X, b.X);
                double from = vertical ? MinY : MinX, to = vertical ? MaxY : MaxX;
                if (Math.Abs(axis - want) > tol || lo > from + endTol || hi < to - endTol) return false;
            }
            return true;
        }

        internal PlanEntrySide PickEntrance(UIDocument ui)
        {
            Reference selected = ui.Selection.PickObject(ObjectType.Element,
                new OnlyBoundaryWalls(Perimeter.Values),
                "Орох ХААЛГА байрлуулах ГАДНА ХАНЫГ сонгоно (4 ханы аль нэг). Esc = цуцлах");
            Wall wall = ui.Document.GetElement(selected) as Wall;
            string key = Perimeter.First(kv => kv.Value.Id == wall.Id).Key;
            return (PlanEntrySide)Enum.Parse(typeof(PlanEntrySide),
                char.ToUpperInvariant(key[0]) + key.Substring(1));
        }

        internal static ExistingFloorBoundary Read(Document doc, Floor floor, Level level)
        {
            if (floor == null || floor.LevelId != level.Id)
                throw new ArgumentException("Шал устсан эсвэл өөр Level-тэй байна.");
            var result = new ExistingFloorBoundary { Floor = floor };

            // Demand actual 4-edge geometry rather than guessing from BoundingBox.
            // Raised/sloped/irregular/holed/slab-edited floors need another algorithm.
            IList<XYZ> corners = ReadFourCorners(floor);
            result.MinX = corners.Min(p => p.X);
            result.MaxX = corners.Max(p => p.X);
            result.MinY = corners.Min(p => p.Y);
            result.MaxY = corners.Max(p => p.Y);

            const double snap = 0.035; // ft: 10.7 mm, numerical vertex tolerance
            foreach (XYZ p in corners)
                if (!(Near(p.X, result.MinX, snap) || Near(p.X, result.MaxX, snap)) ||
                    !(Near(p.Y, result.MinY, snap) || Near(p.Y, result.MaxY, snap)))
                    throw new ArgumentException("Шал тэгш өнцөгт биш байна.");

            // Perimeter wall centrelines can be offset a little from slab outer edge.
            // Instead of duplicating them, they become the room boundary and entry host.
            var walls = new FilteredElementCollector(doc).OfClass(typeof(Wall))
                .Cast<Wall>().Where(w => w.LevelId == level.Id &&
                    w.WallType != null && w.WallType.Kind == WallKind.Basic &&
                    w.get_Parameter(BuiltInParameter.WALL_ATTR_ROOM_BOUNDING)?.AsInteger() != 0)
                .ToList();
            result.Perimeter["south"] = PickWall(walls, false, result.MinY, result.MinX, result.MaxX);
            result.Perimeter["north"] = PickWall(walls, false, result.MaxY, result.MinX, result.MaxX);
            result.Perimeter["west"] = PickWall(walls, true, result.MinX, result.MinY, result.MaxY);
            result.Perimeter["east"] = PickWall(walls, true, result.MaxX, result.MinY, result.MaxY);
            if (result.Perimeter.Values.Select(w => w.Id).Distinct().Count() != 4)
                throw new ArgumentException("Дөрвөн тусдаа гадна хана олдсонгүй.");

            // Use actual wall axes so interior walls JOIN instead of leaving gaps to
            // the bounding outer walls. Confirm axis-aligned rectangular relationships.
            result.MinX = Axis(result.Perimeter["west"], true);
            result.MaxX = Axis(result.Perimeter["east"], true);
            result.MinY = Axis(result.Perimeter["south"], false);
            result.MaxY = Axis(result.Perimeter["north"], false);
            if (result.MinX >= result.MaxX || result.MinY >= result.MaxY)
                throw new ArgumentException("Гадна ханыг зөв таньсангүй.");
            return result;
        }

        private static Wall PickWall(List<Wall> walls, bool vertical,
            double desiredAxis, double low, double high)
        {
            const double maxOffset = 1.65; // ft ≈ 500 mm slab boundary to wall centre
            const double endTolerance = 1.65;
            var choices = new List<(Wall wall, double distance)>();
            foreach (Wall wall in walls)
            {
                if (!((wall.Location as LocationCurve)?.Curve is Line line)) continue;
                XYZ a = line.GetEndPoint(0), b = line.GetEndPoint(1);
                if (vertical && Math.Abs(a.X - b.X) > 0.025) continue;
                if (!vertical && Math.Abs(a.Y - b.Y) > 0.025) continue;
                double axis = vertical ? (a.X + b.X) / 2 : (a.Y + b.Y) / 2;
                double start = vertical ? Math.Min(a.Y, b.Y) : Math.Min(a.X, b.X);
                double end = vertical ? Math.Max(a.Y, b.Y) : Math.Max(a.X, b.X);
                double distance = Math.Abs(axis - desiredAxis);
                if (distance <= maxOffset && start <= low + endTolerance &&
                    end >= high - endTolerance)
                    choices.Add((wall, distance));
            }
            if (choices.Count != 1)
                throw new ArgumentException("Хүрээний ханын нэг утгатай сонголт олдсонгүй (" +
                    (vertical ? "босоо" : "хэвтээ") + ", " + choices.Count +
                    "). Өөр давхар, давхцсан хана, олон сегмент эсэхийг шалгана уу.");
            return choices[0].wall;
        }

        private static double Axis(Wall wall, bool vertical)
        {
            Line line = (Line)((LocationCurve)wall.Location).Curve;
            return vertical ? line.GetEndPoint(0).X : line.GetEndPoint(0).Y;
        }

        private static bool Near(double a, double b, double eps) { return Math.Abs(a - b) <= eps; }

        private static IList<XYZ> ReadFourCorners(Floor floor)
        {
            var options = new Options { DetailLevel = ViewDetailLevel.Fine };
            GeometryElement geometry = floor.get_Geometry(options);
            if (geometry == null) throw new ArgumentException("Шалны геометр олдсонгүй.");
            foreach (GeometryObject obj in geometry)
            {
                if (!(obj is Solid solid) || solid.Volume <= 0) continue;
                foreach (Face face in solid.Faces)
                {
                    if (!(face is PlanarFace pface) || pface.FaceNormal.Z < 0.9999) continue;
                    if (pface.EdgeLoops.Size != 1) continue; // holes explicitly unsupported
                    EdgeArray loop = pface.EdgeLoops.get_Item(0);
                    if (loop.Size != 4) continue;
                    var corners = new List<XYZ>();
                    double? z = null;
                    foreach (Edge edge in loop)
                    {
                        if (!(edge.AsCurve() is Line line))
                        { corners.Clear(); break; }
                        XYZ a = line.GetEndPoint(0), b = line.GetEndPoint(1);
                        if (z.HasValue && Math.Abs(a.Z - z.Value) > 0.01)
                        { corners.Clear(); break; }
                        z = a.Z;
                        if (Math.Abs(b.Z - a.Z) > 0.01 ||
                            !(Near(a.X, b.X, 0.03) || Near(a.Y, b.Y, 0.03)))
                        { corners.Clear(); break; }
                        corners.Add(a);
                    }
                    if (corners.Count == 4) return corners;
                }
            }
            throw new ArgumentException("Зөвхөн нүхгүй, хэвтээ, дөрвөн шулуун талтай Floor дэмжинэ.");
        }

        private sealed class OnlyBoundaryWalls : ISelectionFilter
        {
            private readonly HashSet<ElementId> _allowed;
            internal OnlyBoundaryWalls(IEnumerable<Wall> walls)
            {
                _allowed = new HashSet<ElementId>(walls.Select(w => w.Id));
            }
            public bool AllowElement(Element e) { return e is Wall && _allowed.Contains(e.Id); }
            public bool AllowReference(Reference r, XYZ p) { return false; }
        }

        private sealed class OnlyFloors : ISelectionFilter
        {
            public bool AllowElement(Element e) { return e is Floor; }
            public bool AllowReference(Reference r, XYZ p) { return false; }
        }
    }
}
