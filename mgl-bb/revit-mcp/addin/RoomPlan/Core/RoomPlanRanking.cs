using System;
using System.Collections.Generic;
using System.Linq;

namespace RevitMcpAddin.RoomPlan.Core
{
    public sealed class RankedPlan
    {
        public GeneratedPlan Plan;
        public double Score; // heuristic ranking, NOT normative compliance
        public string Summary;
        public List<string> Warnings = new List<string>();
        public override string ToString()
        {
            return Score.ToString("0") + "/100 · Хувилбар " + (Plan.Variant + 1) + " — " + Summary;
        }
    }

    /// <summary>
    /// Deterministic option ranking. Rejects invalid envelopes and door locations;
    /// score = schematic furniture/circulation/area quality, not BNbD compliance.
    /// Door and room family availability is a separate Revit host gate.
    /// </summary>
    public static class RoomPlanRanking
    {
        public static IReadOnlyList<RankedPlan> GenerateOptions(double width, double height, int bedrooms,
            PlanEntrySide entry = PlanEntrySide.South)
        {
            var result = new List<RankedPlan>();
            for (int variant = 0; variant <= 26; variant++)
            {
                GeneratedPlan plan;
                try
                {
                    bool turn = entry == PlanEntrySide.East || entry == PlanEntrySide.West;
                    GeneratedPlan basePlan = RoomPlanGenerator.Generate(
                        turn ? height : width, turn ? width : height, bedrooms, variant);
                    plan = RoomPlanTransform.ToEntrySide(basePlan, entry);
                }
                catch (ArgumentException) { continue; }
                string reason;
                if (!GeometrySafe(plan, out reason)) continue;
                // Reject plans where even our schematic furniture envelopes
                // cannot fit without collisions or blocking room entrance.
                try { FurniturePlanner.Create(plan); }
                catch (ArgumentException) { continue; }
                PlanRoom living = plan.Rooms.Single(r => r.Name.StartsWith("Зочны", StringComparison.Ordinal));
                PlanRoom bath = plan.Rooms.Single(r => r.Name.StartsWith("Ариун", StringComparison.Ordinal));
                List<PlanRoom> beds = plan.Rooms.Where(r => r.Name.StartsWith("Унтлагын", StringComparison.Ordinal)).ToList();
                double minBedroom = beds.Min(r => r.Area);
                double penalty =
                    Math.Abs(living.Area - (bedrooms == 1 ? 23 : 27)) * 0.55 +
                    Math.Abs(bath.Area - 7.5) * 0.5 +
                    beds.Sum(r => Math.Abs(r.Area - 14) * 0.65) +
                    (plan.Height * 1.6 / (width * height)) * 28;
                double score = Math.Max(1, Math.Min(99, 96 - penalty));
                result.Add(new RankedPlan
                {
                    Plan = plan, Score = score,
                    Summary = "Зочны " + living.Area.ToString("0.0") +
                        " м² · WC " + bath.Area.ToString("0.0") +
                        " м² · min унтлагын " + minBedroom.ToString("0.0") + " м²",
                    Warnings = { "Энэ нь дизайны ойролцоо оноо; БНбД/MNS баталгаа биш." }
                });
            }
            return result.OrderByDescending(r => r.Score).ThenBy(r => r.Plan.Variant).ToList();
        }

        public static bool GeometrySafe(GeneratedPlan plan, out string reason)
        {
            reason = "";
            if (plan == null || plan.Rooms.Count == 0) { reason = "empty"; return false; }
            foreach (PlanRoom room in plan.Rooms)
            {
                double w = room.X2 - room.X1, h = room.Y2 - room.Y1;
                // Schematic minimum to fit representative furniture and access.
                // NOT a Mongolian regulatory dimension.
                if (room.Name != "Хонгил" && (w < 2.15 || h < 2.15 || room.Area < 5))
                { reason = "room too narrow for schematic layout"; return false; }
                if (room.Name.StartsWith("Унтлагын", StringComparison.Ordinal) && room.Area < 9)
                { reason = "bedroom too small"; return false; }
                if (room.Name.StartsWith("Зочны", StringComparison.Ordinal) && room.Area < 14)
                { reason = "living area too small"; return false; }
            }
            for (int i = 0; i < plan.Rooms.Count; i++)
                for (int j = i + 1; j < plan.Rooms.Count; j++)
                {
                    PlanRoom a = plan.Rooms[i], b = plan.Rooms[j];
                    if (Math.Min(a.X2, b.X2) - Math.Max(a.X1, b.X1) > 0.001 &&
                        Math.Min(a.Y2, b.Y2) - Math.Max(a.Y1, b.Y1) > 0.001)
                    { reason = "overlapping rooms"; return false; }
                }
            foreach (PlanDoor door in plan.Doors)
            {
                PlanWall host = plan.Walls.FirstOrDefault(w => w.Id == door.HostWall);
                if (host == null) { reason = "door without wall"; return false; }
                bool vertical = Math.Abs(host.Start.X - host.End.X) < 0.0001;
                double coordinate = vertical ? door.Center.Y : door.Center.X;
                double first = vertical ? Math.Min(host.Start.Y, host.End.Y) : Math.Min(host.Start.X, host.End.X);
                double last = vertical ? Math.Max(host.Start.Y, host.End.Y) : Math.Max(host.Start.X, host.End.X);
                if (coordinate - first < 0.65 || last - coordinate < 0.65)
                { reason = "door too close to wall end"; return false; }
                foreach (PlanWall divider in plan.Walls)
                {
                    if (ReferenceEquals(divider, host)) continue;
                    // Door footprint must not overlap internal wall junctions.
                    if (vertical && Math.Abs(divider.Start.Y - divider.End.Y) < 0.0001 &&
                        Math.Abs(door.Center.Y - divider.Start.Y) < 0.65 &&
                        Math.Min(divider.Start.X, divider.End.X) <= door.Center.X + 0.001 &&
                        Math.Max(divider.Start.X, divider.End.X) >= door.Center.X - 0.001)
                    { reason = "door at wall junction"; return false; }
                    if (!vertical && Math.Abs(divider.Start.X - divider.End.X) < 0.0001 &&
                        Math.Abs(door.Center.X - divider.Start.X) < 0.65 &&
                        Math.Min(divider.Start.Y, divider.End.Y) <= door.Center.Y + 0.001 &&
                        Math.Max(divider.Start.Y, divider.End.Y) >= door.Center.Y - 0.001)
                    { reason = "door at wall junction"; return false; }
                }
            }
            for (int i = 0; i < plan.Doors.Count; i++)
                for (int j = i + 1; j < plan.Doors.Count; j++)
                {
                    var a = plan.Doors[i]; var b = plan.Doors[j];
                    if (a.HostWall == b.HostWall &&
                        Math.Sqrt(Math.Pow(a.Center.X - b.Center.X, 2) +
                                  Math.Pow(a.Center.Y - b.Center.Y, 2)) < 1.45)
                    { reason = "two doors overlapping on one wall"; return false; }
                }
            return true;
        }
    }
}
