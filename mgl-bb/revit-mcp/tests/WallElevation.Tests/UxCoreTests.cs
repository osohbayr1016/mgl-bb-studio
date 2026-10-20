using System.Collections.Generic;
using System.Linq;
using RevitMcpAddin.WallElevation.Core;

namespace RevitMcpAddin.WallElevation.Tests
{
    public static class UxCoreTests
    {
        [Test]
        public static void Compass_names_follow_the_look_direction()
        {
            Assert.Eq("Хойд", WeNaming.CompassName(new WeV3(0, 1, 0)));
            Assert.Eq("Зүүн", WeNaming.CompassName(new WeV3(1, 0, 0)));
            Assert.Eq("Урд", WeNaming.CompassName(new WeV3(0, -1, 0)));
            Assert.Eq("Баруун", WeNaming.CompassName(new WeV3(-1, 0, 0)));
            Assert.Eq("Зүүн хойд", WeNaming.CompassName(new WeV3(0.7, 0.7, 0)));
            Assert.Eq("Хойд", WeNaming.CompassName(new WeV3(0.3, 1, 0)), "17° — хойд хэвээр");
        }

        [Test]
        public static void Items_are_ordered_by_letter_within_a_room()
        {
            WePlan plan = WallElevationPlanner.Plan(Fx.SquareRoom(5000, 4000, ccw: false), Fx.Ctx());
            Assert.SeqEq(new[] { "A", "B", "C", "D" }, plan.Items.Select(i => i.SideLetter));
        }

        [Test]
        public static void Curved_wall_keeps_its_compass_letter_so_others_do_not_shift()
        {
            // Smoke-оор олдсон гэмтэл: хойд хана муруй үед зүүн хана «A» болж байв.
            WeRequest req = Fx.SquareRoom(5000, 4000);
            req.Rooms[0].Loops[0].Segments[2].IsStraight = false;      // хойд хана
            WePlan plan = WallElevationPlanner.Plan(req, Fx.Ctx());
            WePlannedElevation curved = plan.Items.Single(i => i.Status == WeStatus.Unsupported);
            Assert.Eq("B", curved.SideLetter, "муруй хойд хана B хэвээр (A = баруун)");
            Assert.Eq("Хойд", WeNaming.CompassName(curved.PlanLook));
            Assert.Eq("C", plan.Items.Single(i => i.Frame != null && i.Frame.Look.AlmostEquals(new WeV3(1, 0, 0), 1e-9)).SideLetter, "зүүн = C");
        }

        [Test]
        public static void Wall_mode_lists_both_sides_of_one_wall_together()
        {
            // Revit дотрох шалгалтаар олдсон: «A, A, A, B, B, B» — нэг хананы хоёр тал зэрэгцэхгүй байв.
            var req = new WeRequest();
            req.Walls.Add(Fx.Wall(Fx.P(0, 0), Fx.P(4000, 0), new WeV3(0, -1, 0), id: 11));
            req.Walls.Add(Fx.Wall(Fx.P(0, 3000), Fx.P(4000, 3000), new WeV3(0, -1, 0), id: 12));
            WePlan plan = WallElevationPlanner.Plan(req, Fx.Ctx(s => s.WallSide = WeWallSidePick.Both));
            Assert.SeqEq(new[] { "11A", "11B", "12A", "12B" }, plan.Items.Select(i => i.WallId + i.SideLetter));
        }

        [Test]
        public static void Excluded_items_are_skipped_without_touching_status()
        {
            WePlan plan = WallElevationPlanner.Plan(Fx.SquareRoom(5000, 4000), Fx.Ctx());
            string key = plan.Items[1].Key;
            WallElevationPlanner.ApplyExclusions(plan, new HashSet<string> { key });
            Assert.Eq(WeAction.Skip, plan.Items[1].Action);
            Assert.Eq(WeStatus.Ready, plan.Items[1].Status);
            Assert.Eq(3, plan.Count(WeAction.Create));
        }
    }
}
