using System;
using System.Collections.Generic;
using System.Linq;

namespace RevitMcpAddin.RoomPlan.Core
{
    /// <summary>
    /// Python worker-ийн (эсвэл ямар ч эх сурвалжийн) планыг Revit-д хэрэглэхээс
    /// ӨМНӨ БИЕ ДААН шалгана — subprocess-ийн гаралтад итгэхгүй (2026-10-14 аудит P2-d).
    ///
    /// <see cref="RoomPlanRanking.GeometrySafe"/> нь өрөөний хэмжээ, хаалганы
    /// уулзвар/зай; <see cref="FurniturePlanner.Safe"/> нь тавилга.  Энэ анги нь
    /// тэдний шалгаагүй ХАМРАХ ХҮРЭЭ: тоо төгсгөлгүй эсэх, планы хэмжээ сонгосон
    /// хилтэй таарах, периметрийн 4 хана бүтэн, өрөө хил дотор / давхцалгүй /
    /// талбайг бүрэн хучих, хаалга хананыхаа ШУГАМ дээр (зөвхөн уртын дагуу биш —
    /// перпендикуляр зай), тавилга өрөөндөө.  Цэвэр код — Revit API-гүй, тестлэгдэнэ.
    /// </summary>
    public static class RoomPlanPlanCheck
    {
        /// <summary>Метрийн хүлцэл — Python мм-ийн сүлжээнд тойруулдаг.</summary>
        public const double Tol = 1e-3;

        private static readonly string[] Sides = { "south", "north", "west", "east" };

        private static bool Finite(double v) { return !double.IsNaN(v) && !double.IsInfinity(v); }

        public static bool Consistent(GeneratedPlan plan, double boundaryWidth, double boundaryHeight,
            out string reason)
        {
            reason = null;
            if (plan == null) { reason = "plan missing"; return false; }
            double w = plan.Width, h = plan.Height;
            if (!Finite(w) || !Finite(h) || w <= 0 || h <= 0)
            { reason = "plan size is not a positive finite number"; return false; }
            if (Math.Abs(w - boundaryWidth) > Tol || Math.Abs(h - boundaryHeight) > Tol)
            {
                reason = "plan size " + w.ToString("0.###") + "×" + h.ToString("0.###") +
                         " differs from the selected boundary " + boundaryWidth.ToString("0.###") + "×" +
                         boundaryHeight.ToString("0.###");
                return false;
            }
            if (plan.Rooms.Count == 0 || plan.Walls.Count == 0 || plan.Doors.Count == 0)
            { reason = "empty plan"; return false; }

            foreach (PlanRoom r in plan.Rooms)
            {
                if (r == null || string.IsNullOrEmpty(r.Name) ||
                    !Finite(r.X1) || !Finite(r.Y1) || !Finite(r.X2) || !Finite(r.Y2))
                { reason = "room with missing name or non-finite coordinates"; return false; }
                if (r.X2 - r.X1 <= Tol || r.Y2 - r.Y1 <= Tol)
                { reason = "degenerate room " + r.Name; return false; }
                if (r.X1 < -Tol || r.Y1 < -Tol || r.X2 > w + Tol || r.Y2 > h + Tol)
                { reason = "room outside the boundary: " + r.Name; return false; }
            }
            for (int i = 0; i < plan.Rooms.Count; i++)
                for (int j = i + 1; j < plan.Rooms.Count; j++)
                {
                    PlanRoom a = plan.Rooms[i], b = plan.Rooms[j];
                    double ox = Math.Min(a.X2, b.X2) - Math.Max(a.X1, b.X1);
                    double oy = Math.Min(a.Y2, b.Y2) - Math.Max(a.Y1, b.Y1);
                    if (ox > Tol && oy > Tol)
                    { reason = "overlapping rooms: " + a.Name + " / " + b.Name; return false; }
                }
            double area = plan.Rooms.Sum(r => r.Area);
            if (Math.Abs(area - w * h) > Math.Max(0.01, w * h * 1e-4))
            { reason = "rooms do not cover the boundary"; return false; }

            var walls = new Dictionary<string, PlanWall>(StringComparer.Ordinal);
            foreach (PlanWall wall in plan.Walls)
            {
                if (wall == null || wall.Start == null || wall.End == null || string.IsNullOrEmpty(wall.Id) ||
                    !Finite(wall.Start.X) || !Finite(wall.Start.Y) || !Finite(wall.End.X) || !Finite(wall.End.Y))
                { reason = "wall with missing id or non-finite coordinates"; return false; }
                if (walls.ContainsKey(wall.Id)) { reason = "duplicate wall id " + wall.Id; return false; }
                bool vertical = Math.Abs(wall.Start.X - wall.End.X) < Tol;
                bool horizontal = Math.Abs(wall.Start.Y - wall.End.Y) < Tol;
                if (!vertical && !horizontal) { reason = "diagonal wall " + wall.Id; return false; }
                if (Math.Abs(wall.Start.X - wall.End.X) + Math.Abs(wall.Start.Y - wall.End.Y) < 0.05)
                { reason = "zero-length wall " + wall.Id; return false; }
                foreach (PlanPoint p in new[] { wall.Start, wall.End })
                    if (p.X < -Tol || p.Y < -Tol || p.X > w + Tol || p.Y > h + Tol)
                    { reason = "wall outside the boundary: " + wall.Id; return false; }
                walls[wall.Id] = wall;
            }
            foreach (string side in Sides)
            {
                if (!walls.TryGetValue(side, out PlanWall p))
                { reason = "perimeter wall missing: " + side; return false; }
                double x1 = Math.Min(p.Start.X, p.End.X), x2 = Math.Max(p.Start.X, p.End.X);
                double y1 = Math.Min(p.Start.Y, p.End.Y), y2 = Math.Max(p.Start.Y, p.End.Y);
                bool ok =
                    side == "south" ? Math.Abs(y1) < Tol && Math.Abs(y2) < Tol && Math.Abs(x1) < Tol && Math.Abs(x2 - w) < Tol :
                    side == "north" ? Math.Abs(y1 - h) < Tol && Math.Abs(y2 - h) < Tol && Math.Abs(x1) < Tol && Math.Abs(x2 - w) < Tol :
                    side == "west" ? Math.Abs(x1) < Tol && Math.Abs(x2) < Tol && Math.Abs(y1) < Tol && Math.Abs(y2 - h) < Tol :
                    Math.Abs(x1 - w) < Tol && Math.Abs(x2 - w) < Tol && Math.Abs(y1) < Tol && Math.Abs(y2 - h) < Tol;
                if (!ok) { reason = "perimeter wall is not the full edge: " + side; return false; }
            }

            foreach (PlanDoor d in plan.Doors)
            {
                if (d == null || d.Center == null || !Finite(d.Center.X) || !Finite(d.Center.Y))
                { reason = "door with non-finite position"; return false; }
                if (!walls.TryGetValue(d.HostWall ?? "", out PlanWall host))
                { reason = "door host wall missing: " + d.HostWall; return false; }
                bool vertical = Math.Abs(host.Start.X - host.End.X) < Tol;
                double offLine = vertical ? Math.Abs(d.Center.X - host.Start.X) : Math.Abs(d.Center.Y - host.Start.Y);
                double along = vertical ? d.Center.Y : d.Center.X;
                double lo = vertical ? Math.Min(host.Start.Y, host.End.Y) : Math.Min(host.Start.X, host.End.X);
                double hi = vertical ? Math.Max(host.Start.Y, host.End.Y) : Math.Max(host.Start.X, host.End.X);
                if (offLine > Tol) { reason = "door is not on its host wall line: " + d.HostWall; return false; }
                if (along < lo - Tol || along > hi + Tol)
                { reason = "door is beyond its host wall: " + d.HostWall; return false; }
            }

            foreach (FurnitureTarget f in plan.Furnishings)
            {
                if (f == null || f.Position == null || !Finite(f.Position.X) || !Finite(f.Position.Y) ||
                    !Finite(f.Width) || !Finite(f.Depth) || f.Width <= 0 || f.Depth <= 0)
                { reason = "furniture with invalid size or position"; return false; }
                PlanRoom room = plan.Rooms.FirstOrDefault(r => r.Name == f.RoomName);
                if (room == null) { reason = "furniture room missing: " + f.RoomName; return false; }
                if (f.MinX < room.X1 - Tol || f.MaxX > room.X2 + Tol || f.MinY < room.Y1 - Tol || f.MaxY > room.Y2 + Tol)
                { reason = "furniture outside its room: " + f.Kind + " in " + f.RoomName; return false; }
            }
            return true;
        }
    }
}
