using System;
using System.Linq;

namespace RevitMcpAddin.RoomPlan.Core
{
    public enum PlanEntrySide { South, North, East, West }

    /// <summary>
    /// Rotate a schematic layout and its entry point to the architect-selected
    /// native exterior wall. Names/host IDs are remapped for safe wall reuse.
    /// Orthogonal rectangles only; NOT linked or sloped floor support.
    /// </summary>
    public static class RoomPlanTransform
    {
        public static GeneratedPlan ToEntrySide(GeneratedPlan source, PlanEntrySide side)
        {
            if (source == null) throw new ArgumentNullException(nameof(source));
            if (side == PlanEntrySide.South) return source;
            if (!Enum.IsDefined(typeof(PlanEntrySide), side)) throw new ArgumentOutOfRangeException(nameof(side));
            bool turn = side == PlanEntrySide.East || side == PlanEntrySide.West;
            var result = new GeneratedPlan
            {
                Width = turn ? source.Height : source.Width,
                Height = turn ? source.Width : source.Height,
                Bedrooms = source.Bedrooms, Variant = source.Variant
            };
            Func<PlanPoint, PlanPoint> rotate = p =>
            {
                switch (side)
                {
                    case PlanEntrySide.North:
                        return new PlanPoint(source.Width - p.X, source.Height - p.Y);
                    case PlanEntrySide.East:
                        return new PlanPoint(source.Height - p.Y, p.X);
                    case PlanEntrySide.West:
                        return new PlanPoint(p.Y, source.Width - p.X);
                    default: return new PlanPoint(p.X, p.Y);
                }
            };
            Func<string, string> host = id =>
            {
                if (id != "south" && id != "north" && id != "west" && id != "east") return id;
                switch (side)
                {
                    case PlanEntrySide.North:
                        return id == "south" ? "north" : id == "north" ? "south" :
                            id == "west" ? "east" : "west";
                    case PlanEntrySide.East:
                        return id == "south" ? "east" : id == "north" ? "west" :
                            id == "west" ? "south" : "north";
                    case PlanEntrySide.West:
                        return id == "south" ? "west" : id == "north" ? "east" :
                            id == "west" ? "north" : "south";
                    default: return id;
                }
            };
            foreach (PlanWall w in source.Walls)
            {
                PlanPoint a = rotate(w.Start), b = rotate(w.End);
                result.Walls.Add(new PlanWall(host(w.Id), a.X, a.Y, b.X, b.Y));
            }
            foreach (PlanRoom room in source.Rooms)
            {
                PlanPoint a = rotate(new PlanPoint(room.X1, room.Y1));
                PlanPoint b = rotate(new PlanPoint(room.X2, room.Y2));
                result.Rooms.Add(new PlanRoom(room.Name,
                    Math.Min(a.X, b.X), Math.Min(a.Y, b.Y),
                    Math.Max(a.X, b.X), Math.Max(a.Y, b.Y)));
            }
            foreach (PlanDoor d in source.Doors)
            {
                PlanPoint p = rotate(d.Center);
                result.Doors.Add(new PlanDoor(host(d.HostWall), p.X, p.Y));
            }
            if (result.Walls.Select(w => w.Id).Distinct().Count() != result.Walls.Count)
                throw new ArgumentException("Wall IDs collided after transform.");
            return result;
        }
    }
}
