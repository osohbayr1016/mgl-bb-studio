using System;
using System.Collections.Generic;
using System.Linq;
using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Architecture;
using RevitMcpAddin.RoomPlan.Core;

namespace RevitMcpAddin.RoomPlan
{
    /// <summary>
    /// «Давхрын план»-ы Revit тал, UI-гүй: коридор / айл хоорондын хана (`BuildShell`) ба нийтийн коридорын Room
    /// (`AddCommonRoom`).  `RoomPlanFloorCommand` ба live gate (`tests/RoomPlan.LiveGate`) ХОЁУЛАА энэ кодыг дуудна —
    /// gate цонх, лиценз компайлддаггүй тул тусдаа файл.
    /// </summary>
    internal static class FloorPlateShell
    {
        /// <summary>Бүх давхрын TransactionGroup — Revit-ийн Undo жагсаалтад харагдах ганц нэр.</summary>
        internal const string GroupName = "MGL — Давхрын план";
        internal const string ShellTransactionName = "MGL — Давхрын коридор, айл хоорондын хана";
        internal const string CommonRoomTransactionName = "MGL — Нийтийн коридор";
        internal const double ShellWallHeightMeters = 2.8;

        /// <summary>
        /// Коридор / айл хоорондын ханыг НЭГ transaction-оор үүсгэж, айл бүрийн хүрээг (гадна хана + шинэ хана)
        /// угсарна.  Алдаа гарвал бүх хана буцаана (дуудагчийн TransactionGroup ч мөн).
        /// <paramref name="created"/> = үүссэн хана (layout.Walls-ийн дарааллаар).
        /// </summary>
        internal static List<PythonUnitRequest> BuildShell(Document doc, Level level, ExistingFloorBoundary storey,
            FloorPlateLayout layout, WallType partition, out List<ElementId> created)
        {
            var walls = new List<(FloorWall plan, Wall wall)>();
            var failures = new RoomPlanBatchApply.RollbackOnError();
            using (var tx = new Transaction(doc, ShellTransactionName))
            {
                FailureHandlingOptions handling = tx.GetFailureHandlingOptions();
                handling.SetFailuresPreprocessor(failures);
                tx.SetFailureHandlingOptions(handling);
                if (tx.Start() != TransactionStatus.Started) throw new InvalidOperationException("Transaction эхэлсэнгүй.");
                foreach (FloorWall w in layout.Walls)
                {
                    XYZ a = new XYZ(storey.MinX + M(w.X1), storey.MinY + M(w.Y1), level.Elevation);
                    XYZ b = new XYZ(storey.MinX + M(w.X2), storey.MinY + M(w.Y2), level.Elevation);
                    Wall wall = Wall.Create(doc, Line.CreateBound(a, b), partition.Id, level.Id, M(ShellWallHeightMeters), 0, false, false);
                    if (wall == null) throw new InvalidOperationException("Хана үүссэнгүй (" + w.Kind + ").");
                    walls.Add((w, wall));
                }
                if (tx.Commit() != TransactionStatus.Committed)
                    throw new InvalidOperationException(failures.Errors.Count == 0 ? "Commit амжилтгүй." : string.Join("; ", failures.Errors.Distinct()));
            }
            created = walls.Select(x => x.wall.Id).ToList();

            double width = layout.Width, height = layout.Height, eps = 0.005;
            Wall Find(FloorUnit u, string side)
            {
                bool horizontal = side == "south" || side == "north";
                double c = side == "south" ? u.Y1 : side == "north" ? u.Y2 : side == "west" ? u.X1 : u.X2;
                double lo = horizontal ? u.X1 : u.Y1, hi = horizontal ? u.X2 : u.Y2;
                if (horizontal && Math.Abs(c) < eps) return storey.Perimeter["south"];
                if (horizontal && Math.Abs(c - height) < eps) return storey.Perimeter["north"];
                if (!horizontal && Math.Abs(c) < eps) return storey.Perimeter["west"];
                if (!horizontal && Math.Abs(c - width) < eps) return storey.Perimeter["east"];
                foreach (var (plan, wall) in walls)
                {
                    bool planHorizontal = Math.Abs(plan.Y1 - plan.Y2) < 1e-9;
                    if (planHorizontal != horizontal) continue;
                    double pc = horizontal ? plan.Y1 : plan.X1;
                    double p1 = horizontal ? Math.Min(plan.X1, plan.X2) : Math.Min(plan.Y1, plan.Y2);
                    double p2 = horizontal ? Math.Max(plan.X1, plan.X2) : Math.Max(plan.Y1, plan.Y2);
                    if (Math.Abs(pc - c) < eps && p1 <= lo + eps && p2 >= hi - eps) return wall;
                }
                throw new InvalidOperationException(u.Id + " — " + side + " талын хана олдсонгүй.");
            }

            var requests = new List<PythonUnitRequest>();
            foreach (FloorUnit u in layout.Units)
            {
                var perimeter = new Dictionary<string, Wall>(StringComparer.Ordinal);
                foreach (string side in new[] { "south", "north", "west", "east" }) perimeter[side] = Find(u, side);
                var boundary = ExistingFloorBoundary.FromWalls(storey.Floor,
                    storey.MinX + M(u.X1), storey.MinY + M(u.Y1), storey.MinX + M(u.X2), storey.MinY + M(u.Y2), perimeter);
                requests.Add(new PythonUnitRequest
                {
                    Id = u.Id, Boundary = boundary,
                    Entry = (PlanEntrySide)Enum.Parse(typeof(PlanEntrySide), char.ToUpperInvariant(u.Entry[0]) + u.Entry.Substring(1)),
                    Bedrooms = u.Bedrooms, Bathrooms = u.Bathrooms, Tier = u.Tier,
                    Facades = u.Facades.ToList(),
                    ExteriorWallThickness = RoomPlanBatchApply.ExteriorThickness(boundary),
                });
            }
            return requests;
        }

        internal static string CommonRoomName(FloorPlateLayout layout)
        {
            return layout.Core != null ? "Нийтийн коридор, шат, лифт" : "Нийтийн коридор";
        }

        /// <summary>
        /// Нийтийн коридор (+ коридор руу нээлттэй шат, лифтийн хонгил) — нэг Room + tag.  Айлуудыг хэрэгжүүлсний ДАРАА:
        /// өмнө нь үүсгэвэл коридорын Room-ийн bbox хонгилын эгнээний айлуудыг «эзэлсэн» болгоно.
        /// </summary>
        internal static void AddCommonRoom(Document doc, Level level, ViewPlan view, ExistingFloorBoundary storey,
            FloorPlateLayout layout, RoomPlanApplyResult made)
        {
            var failures = new RoomPlanBatchApply.RollbackOnError();
            using (var tx = new Transaction(doc, CommonRoomTransactionName))
            {
                FailureHandlingOptions handling = tx.GetFailureHandlingOptions();
                handling.SetFailuresPreprocessor(failures);
                tx.SetFailureHandlingOptions(handling);
                if (tx.Start() != TransactionStatus.Started) throw new InvalidOperationException("Transaction эхэлсэнгүй.");
                var at = new UV(storey.MinX + M(layout.Corridor.Cx), storey.MinY + M(layout.Corridor.Cy));
                Room room = doc.Create.NewRoom(level, at);
                if (room == null) throw new InvalidOperationException("Room үүссэнгүй.");
                room.Name = CommonRoomName(layout);
                doc.Regenerate();
                if (room.Area <= 0) throw new InvalidOperationException("Коридор битүү биш байна.");
                RoomTag tag = doc.Create.NewRoomTag(new LinkElementId(room.Id), at, view.Id);
                if (tx.Commit() != TransactionStatus.Committed)
                    throw new InvalidOperationException(failures.Errors.Count == 0 ? "Commit амжилтгүй." : string.Join("; ", failures.Errors.Distinct()));
                made.Rooms.Add(room.Id);
                if (tag != null) made.Tags.Add(tag.Id);
            }
        }

        private static double M(double metres) { return UnitUtils.ConvertToInternalUnits(metres, UnitTypeId.Meters); }
    }
}
