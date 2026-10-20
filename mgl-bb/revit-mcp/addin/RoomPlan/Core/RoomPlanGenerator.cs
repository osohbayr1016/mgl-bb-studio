using System;
using System.Collections.Generic;

namespace RevitMcpAddin.RoomPlan.Core
{
    // Pure geometry: metres, origin at south-west. No Revit / WPF dependencies.
    public sealed class PlanPoint
    {
        public double X, Y;
        public PlanPoint(double x, double y) { X = x; Y = y; }
    }

    public sealed class PlanWall
    {
        public string Id;
        public PlanPoint Start, End;
        public PlanWall(string id, double x1, double y1, double x2, double y2)
        {
            Id = id; Start = new PlanPoint(x1, y1); End = new PlanPoint(x2, y2);
        }
    }

    public sealed class PlanRoom
    {
        public string Name;
        public double X1, Y1, X2, Y2;
        public PlanPoint Center { get { return new PlanPoint((X1 + X2) / 2, (Y1 + Y2) / 2); } }
        public double Area { get { return (X2 - X1) * (Y2 - Y1); } }
        public PlanRoom(string name, double x1, double y1, double x2, double y2)
        {
            Name = name; X1 = x1; Y1 = y1; X2 = x2; Y2 = y2;
        }
    }

    public sealed class PlanDoor
    {
        public string HostWall;
        public PlanPoint Center;
        public PlanDoor(string hostWall, double x, double y)
        {
            HostWall = hostWall; Center = new PlanPoint(x, y);
        }
    }

    public sealed class GeneratedPlan
    {
        public double Width, Height;
        public int Bedrooms, Variant;
        public readonly List<PlanWall> Walls = new List<PlanWall>();
        public readonly List<PlanRoom> Rooms = new List<PlanRoom>();
        public readonly List<PlanDoor> Doors = new List<PlanDoor>();
        // Python is the single source of schematic furnishing placements for the
        // new batch command. C# only validates and instantiates real Revit Families.
        public bool PythonGenerated;
        public readonly List<FurnitureTarget> Furnishings = new List<FurnitureTarget>();
        /// <summary>Full wall thickness (m) the furniture layout assumed (0 = FurniturePlanner defaults).</summary>
        public double ExteriorThickness, InteriorThickness;
    }

    /// <summary>
    /// Offline schematic apartment prototype: outer rectangle + shared hallway,
    /// room partitions and hosted door positions. NOT a Mongolian code validator.
    /// </summary>
    public static class RoomPlanGenerator
    {
        public static GeneratedPlan Generate(double width, double height, int bedrooms, int variant)
        {
            if (double.IsNaN(width) || double.IsNaN(height) ||
                double.IsInfinity(width) || double.IsInfinity(height))
                throw new ArgumentException("Талбайн хэмжээ бодит тоо байх ёстой.");
            if (bedrooms < 1 || bedrooms > 3 || variant < 0 || variant > 26)
                throw new ArgumentOutOfRangeException("bedrooms/variant");
            double minWidth = bedrooms == 3 ? 10.5 : 9.0;
            double minHeight = bedrooms == 3 ? 10.0 : 8.0;
            if (width < minWidth || height < minHeight || width > 30 || height > 30)
                throw new ArgumentException("Сонгосон төрлөөр өргөн " + minWidth +
                    "–30 м, урт " + minHeight + "–30 м байх ёстой.");

            const double hall = 1.6;
            // 27 real parameter combinations, not repeated screenshots of one plan.
            // Keep legacy 0..2 stable for reproducible older test fixtures.
            double offset = variant <= 2
                ? (variant == 1 ? -0.35 : variant == 2 ? 0.35 : 0)
                : ((variant - 3) % 6 - 2.5) * 0.22;
            double cx = width / 2 + offset;
            double left = cx - hall / 2;
            double right = cx + hall / 2;
            if (left < 3 || width - right < 3)
                throw new ArgumentException("Коридорын хоёр талд 3 м-ээс бага зай үлдэж байна.");

            var result = new GeneratedPlan { Width = width, Height = height, Bedrooms = bedrooms, Variant = variant };
            result.Walls.Add(new PlanWall("south", 0, 0, width, 0));
            result.Walls.Add(new PlanWall("north", 0, height, width, height));
            result.Walls.Add(new PlanWall("west", 0, 0, 0, height));
            result.Walls.Add(new PlanWall("east", width, 0, width, height));
            result.Walls.Add(new PlanWall("hall-west", left, 0, left, height));
            result.Walls.Add(new PlanWall("hall-east", right, 0, right, height));
            result.Doors.Add(new PlanDoor("south", cx, 0));
            result.Rooms.Add(new PlanRoom("Хонгил", left, 0, right, height));

            double fraction = variant <= 2
                ? (variant == 1 ? 0.52 : variant == 2 ? 0.64 : 0.58)
                : 0.48 + ((variant - 3) / 6) * 0.045;
            if (bedrooms == 1)
            {
                AddBand(result, "Зочны өрөө + гал тогоо", 0, left, 0, height, "hall-west");
                double sep = height * (variant <= 2 ? (variant == 2 ? 0.40 : 0.35)
                    : 0.30 + ((variant - 3) / 6) * 0.035);
                AddSplit(result, "right-1", right, width, sep);
                AddBand(result, "Ариун цэврийн өрөө", right, width, 0, sep, "hall-east");
                AddBand(result, "Унтлагын өрөө 1", right, width, sep, height, "hall-east");
            }
            else
            {
                double leftSep = height * fraction;
                AddSplit(result, "left-1", 0, left, leftSep);
                AddBand(result, "Зочны өрөө + гал тогоо", 0, left, 0, leftSep, "hall-west");
                AddBand(result, "Унтлагын өрөө 1", 0, left, leftSep, height, "hall-west");
                if (bedrooms == 2)
                {
                    double rightSep = height * (variant <= 2 ? (variant == 1 ? 0.34 : 0.30)
                        : 0.27 + ((variant - 3) / 6) * 0.025);
                    AddSplit(result, "right-1", right, width, rightSep);
                    AddBand(result, "Ариун цэврийн өрөө", right, width, 0, rightSep, "hall-east");
                    AddBand(result, "Унтлагын өрөө 2", right, width, rightSep, height, "hall-east");
                }
                else
                {
                    double first = height * (variant <= 2 ? 0.24 :
                        0.23 + ((variant - 3) / 6) * 0.012);
                    double second = height * (variant <= 2 ?
                        (variant == 1 ? 0.60 : variant == 2 ? 0.66 : 0.62) :
                        0.59 + ((variant - 3) / 6) * 0.025);
                    AddSplit(result, "right-1", right, width, first);
                    AddSplit(result, "right-2", right, width, second);
                    AddBand(result, "Ариун цэврийн өрөө", right, width, 0, first, "hall-east");
                    AddBand(result, "Унтлагын өрөө 2", right, width, first, second, "hall-east");
                    AddBand(result, "Унтлагын өрөө 3", right, width, second, height, "hall-east");
                }
            }

            // All room bands need door centre away from corners; fail before any Revit transaction.
            foreach (PlanRoom room in result.Rooms)
                if (room.X2 <= room.X1 || room.Y2 <= room.Y1 || room.Area < 3.0)
                    throw new ArgumentException("Хэт жижиг эсвэл буруу талбайтай өрөө үүсэхээр байна.");
            return result;
        }

        private static void AddSplit(GeneratedPlan result, string id, double x1, double x2, double y)
        {
            result.Walls.Add(new PlanWall(id, x1, y, x2, y));
        }

        private static void AddBand(GeneratedPlan result, string name,
            double x1, double x2, double y1, double y2, string hallWall)
        {
            result.Rooms.Add(new PlanRoom(name, x1, y1, x2, y2));
            double x = hallWall == "hall-west" ? x2 : x1;
            result.Doors.Add(new PlanDoor(hallWall, x, (y1 + y2) / 2));
        }
    }
}
