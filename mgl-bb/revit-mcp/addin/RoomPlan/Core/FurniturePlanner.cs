using System;
using System.Collections.Generic;
using System.Linq;

namespace RevitMcpAddin.RoomPlan.Core
{
    // Native families will be placed at these centres. The rectangles are
    // conservative schematic furniture envelopes in metres.
    // Values 0-4 are the original five (kept stable); the rest came with the tiered
    // layout of python plan_furniture.py (2026-10-14).
    public enum FurnitureKind
    {
        Bed, Sofa, Kitchen, Toilet, Basin,
        BedSingle, Nightstand, Wardrobe, Desk, CoffeeTable, TvUnit, DiningTable, Bathtub, Shower, Washer
    }

    public sealed class FurnitureTarget
    {
        public FurnitureKind Kind;
        public string RoomName;
        public PlanPoint Position;
        public double Width, Depth;
        /// <summary>Room side the item's back rests on (south/north/west/east) or null when free-standing.
        /// Revit turns the family so its back (local +Y) faces that wall and snaps it to the wall face.</summary>
        public string Back;
        public double MinX { get { return Position.X - Width / 2; } }
        public double MaxX { get { return Position.X + Width / 2; } }
        public double MinY { get { return Position.Y - Depth / 2; } }
        public double MaxY { get { return Position.Y + Depth / 2; } }
        public FurnitureTarget(FurnitureKind kind, PlanRoom room, double x, double y, double width, double depth)
        {
            Kind = kind; RoomName = room.Name; Position = new PlanPoint(x, y);
            Width = width; Depth = depth;
        }
    }

    public static class FurniturePlanner
    {
        public static IReadOnlyList<FurnitureTarget> Create(GeneratedPlan plan)
        {
            var result = new List<FurnitureTarget>();
            foreach (PlanRoom room in plan.Rooms)
            {
                if (room.Name.StartsWith("Унтлагын", StringComparison.Ordinal))
                    result.Add(new FurnitureTarget(FurnitureKind.Bed, room,
                        room.Center.X, room.Center.Y, 1.6, 2.0));
                else if (room.Name.StartsWith("Зочны", StringComparison.Ordinal))
                {
                    result.Add(new FurnitureTarget(FurnitureKind.Sofa, room,
                        room.Center.X, room.Center.Y, 2.0, 0.95));
                    result.Add(new FurnitureTarget(FurnitureKind.Kitchen, room,
                        room.X1 + 0.50, room.Y1 + 0.90, 0.6, 1.2));
                }
                else if (room.Name.StartsWith("Ариун", StringComparison.Ordinal))
                {
                    // Place plumbing fixtures on the side opposite the actual room
                    // door, including mirrored and rotated north/east/west variants.
                    PlanDoor door = plan.Doors.FirstOrDefault(d =>
                        d.HostWall != "south" && d.Center.X >= room.X1 - 0.01 &&
                        d.Center.X <= room.X2 + 0.01 &&
                        d.Center.Y >= room.Y1 - 0.01 &&
                        d.Center.Y <= room.Y2 + 0.01 &&
                        (Math.Abs(d.Center.X - room.X1) < 0.01 ||
                         Math.Abs(d.Center.X - room.X2) < 0.01 ||
                         Math.Abs(d.Center.Y - room.Y1) < 0.01 ||
                         Math.Abs(d.Center.Y - room.Y2) < 0.01));
                    if (door == null) throw new ArgumentException("Ариун цэврийн өрөөний орох хаалга олдсонгүй.");
                    bool fromRight = Math.Abs(door.Center.X - room.X2) < 0.01;
                    bool fromLeft = Math.Abs(door.Center.X - room.X1) < 0.01;
                    if (fromRight || fromLeft)
                    {
                        double x = fromRight ? room.X1 + 0.7 : room.X2 - 0.7;
                        result.Add(new FurnitureTarget(FurnitureKind.Toilet, room,
                            x, room.Y1 + 0.65, 0.7, 1.0));
                        result.Add(new FurnitureTarget(FurnitureKind.Basin, room,
                            x, room.Y2 - 0.50, 0.6, 0.5));
                    }
                    else
                    {
                        double y = Math.Abs(door.Center.Y - room.Y1) < 0.01
                            ? room.Y2 - 0.65 : room.Y1 + 0.65;
                        result.Add(new FurnitureTarget(FurnitureKind.Toilet, room,
                            room.X1 + 0.7, y, 0.7, 1.0));
                        result.Add(new FurnitureTarget(FurnitureKind.Basin, room,
                            room.X2 - 0.7, y, 0.6, 0.5));
                    }
                }
            }
            string failure;
            if (!Safe(result, plan, out failure)) throw new ArgumentException(failure);
            return result;
        }

        /// <summary>Kinds every plan must furnish; the others are placed when they fit and a Family is mapped.</summary>
        public static bool Required(FurnitureKind kind)
        {
            return kind == FurnitureKind.Bed || kind == FurnitureKind.BedSingle || kind == FurnitureKind.Sofa ||
                   kind == FurnitureKind.Kitchen || kind == FurnitureKind.Toilet || kind == FurnitureKind.Basin;
        }

        /// <summary>Wall thickness the Python layout assumes when the request did not carry it (plan_furniture.py).</summary>
        public const double DefaultExteriorThickness = 0.2, DefaultInteriorThickness = 0.1;
        /// <summary>Door keep-out on the room side: the 0.9 m leaf's swing, either hinge (plan_furniture.py DOOR_*).</summary>
        public const double DoorHalf = 0.55, DoorDepth = 0.95;

        /// <summary>
        /// Same rules as python plan_furniture.py: every item stands inside its room at least 1 cm off
        /// the wall FACE (centreline + half the real thickness — exterior on the unit boundary, interior
        /// elsewhere), clear of every door's swing zone, and items in one room do not overlap.
        /// </summary>
        public static bool Safe(IReadOnlyList<FurnitureTarget> fixtures,
            GeneratedPlan plan, out string failure, double exteriorThickness = 0, double interiorThickness = 0)
        {
            failure = "";
            if (exteriorThickness <= 0) exteriorThickness = DefaultExteriorThickness;
            if (interiorThickness <= 0) interiorThickness = DefaultInteriorThickness;
            const double tol = 0.01 - 1e-6;
            foreach (FurnitureTarget f in fixtures)
            {
                PlanRoom r = plan.Rooms.FirstOrDefault(x => x.Name == f.RoomName);
                if (r == null) { failure = "Тавилга өрөөнөөс гарсан: " + f.Kind; return false; }
                double Half(double at, double limit) =>
                    (Math.Abs(at - limit) < 1e-6 ? exteriorThickness : interiorThickness) / 2;
                double fx1 = r.X1 + Half(r.X1, 0), fy1 = r.Y1 + Half(r.Y1, 0);
                double fx2 = r.X2 - Half(r.X2, plan.Width), fy2 = r.Y2 - Half(r.Y2, plan.Height);
                if (f.MinX < fx1 + tol || f.MaxX > fx2 - tol || f.MinY < fy1 + tol || f.MaxY > fy2 - tol)
                { failure = "Тавилга хана руу орсон: " + f.Kind + " / " + f.RoomName; return false; }
                foreach (PlanDoor door in plan.Doors)
                {
                    double cx = door.Center.X, cy = door.Center.Y;
                    double zx1, zy1, zx2, zy2;
                    bool alongX = cx >= r.X1 - 0.01 && cx <= r.X2 + 0.01;
                    bool alongY = cy >= r.Y1 - 0.01 && cy <= r.Y2 + 0.01;
                    if (alongX && Math.Abs(cy - r.Y1) < 0.02) { zx1 = cx - DoorHalf; zx2 = cx + DoorHalf; zy1 = r.Y1; zy2 = r.Y1 + DoorDepth; }
                    else if (alongX && Math.Abs(cy - r.Y2) < 0.02) { zx1 = cx - DoorHalf; zx2 = cx + DoorHalf; zy1 = r.Y2 - DoorDepth; zy2 = r.Y2; }
                    else if (alongY && Math.Abs(cx - r.X1) < 0.02) { zy1 = cy - DoorHalf; zy2 = cy + DoorHalf; zx1 = r.X1; zx2 = r.X1 + DoorDepth; }
                    else if (alongY && Math.Abs(cx - r.X2) < 0.02) { zy1 = cy - DoorHalf; zy2 = cy + DoorHalf; zx1 = r.X2 - DoorDepth; zx2 = r.X2; }
                    else continue;
                    if (f.MinX < zx2 - 1e-6 && f.MaxX > zx1 + 1e-6 && f.MinY < zy2 - 1e-6 && f.MaxY > zy1 + 1e-6)
                    { failure = "Хаалганы эргэх мужид тавилга: " + f.Kind + " / " + f.RoomName; return false; }
                }
            }
            for (int i = 0; i < fixtures.Count; i++)
                for (int j = i + 1; j < fixtures.Count; j++)
                {
                    var a = fixtures[i]; var b = fixtures[j];
                    if (a.RoomName != b.RoomName) continue;
                    if (a.MinX < b.MaxX - 1e-6 && a.MaxX > b.MinX + 1e-6 &&
                        a.MinY < b.MaxY - 1e-6 && a.MaxY > b.MinY + 1e-6)
                    { failure = "Тавилга хоорондоо давхцсан: " + a.Kind + " / " + b.Kind; return false; }
                }
            return true;
        }
    }
}
