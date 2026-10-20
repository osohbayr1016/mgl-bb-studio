using System;
using System.Collections.Generic;
using System.Linq;
using RevitMcpAddin.WallElevation.Core;

namespace RevitMcpAddin.WallElevation.Tests
{
    public static class GeometryTests
    {
        private const double E = 1e-9;

        [Test]
        public static void Straight_wall_exterior_view_looks_from_outside_toward_the_wall()
        {
            // Хана зүүнээс баруун тийш, гадна тал нь УРД (−Y).
            WeWallInfo w = Fx.Wall(Fx.P(0, 0), Fx.P(4000, 0), new WeV3(0, -1, 0));
            var req = new WeRequest(); req.Walls.Add(w);
            WePlannedElevation p = Fx.Only(WallElevationPlanner.Plan(req, Fx.Ctx()));

            Assert.Eq(WeStatus.Ready, p.Status, p.Message);
            Assert.Eq(WeAction.Create, p.Action);
            Assert.Eq(WeSide.Exterior, p.Side);
            Assert.True(p.Frame.Look.AlmostEquals(new WeV3(0, 1, 0), E), "Look = +Y (гаднаас хана руу)");
            Assert.True(p.Frame.ViewDirection.AlmostEquals(new WeV3(0, -1, 0), E), "ViewDirection = гадна тал руу");
            Assert.True(p.Frame.Right.AlmostEquals(new WeV3(1, 0, 0), E), "Баруун = +X (урдаас харахад)");
            Assert.True(WallFrameCalculator.IsValid(p.Frame));
            Assert.True(WallFrameCalculator.FacesFromSide(p.Frame, new WeV3(0, -1, 0)));
            Assert.True(p.Frame.Origin.AlmostEquals(Fx.P(2000, 0, 0), E), "Origin = шугамын дунд, суурь дээр");
        }

        [Test]
        public static void Reversed_wall_direction_gives_the_identical_view()
        {
            WeWallInfo a = Fx.Wall(Fx.P(0, 0), Fx.P(4000, 0), new WeV3(0, -1, 0), id: 7);
            WeWallInfo b = Fx.Wall(Fx.P(4000, 0), Fx.P(0, 0), new WeV3(0, -1, 0), id: 7);
            var ra = new WeRequest(); ra.Walls.Add(a);
            var rb = new WeRequest(); rb.Walls.Add(b);
            WePlannedElevation pa = Fx.Only(WallElevationPlanner.Plan(ra, Fx.Ctx()));
            WePlannedElevation pb = Fx.Only(WallElevationPlanner.Plan(rb, Fx.Ctx()));
            Assert.True(pa.Frame.Look.AlmostEquals(pb.Frame.Look, E));
            Assert.True(pa.Frame.Right.AlmostEquals(pb.Frame.Right, E));
            Assert.Eq(pa.Signature, pb.Signature, "чиглэлээс үл хамаарсан тэмдэг");
            Assert.Eq(pa.Key, pb.Key);
        }

        [Test]
        public static void Rotated_wall_frame_is_perpendicular_and_faces_exterior()
        {
            foreach (double deg in new[] { 17.0, 30.0, 45.0, 123.4, 200.0, 315.0 })
            {
                double r = deg * Math.PI / 180;
                WeV3 t = new WeV3(Math.Cos(r), Math.Sin(r), 0);
                WeV3 ext = new WeV3(Math.Sin(r), -Math.Cos(r), 0);       // баруун талын нормаль
                WeWallInfo w = Fx.Wall(Fx.P(1000, 500), Fx.P(1000, 500) + t * Fx.Mm(5000), ext);
                var req = new WeRequest(); req.Walls.Add(w);
                WePlannedElevation p = Fx.Only(WallElevationPlanner.Plan(req, Fx.Ctx()));
                Assert.Eq(WeStatus.Ready, p.Status, deg + "°");
                Assert.True(WallFrameCalculator.IsValid(p.Frame), deg + "° frame");
                Assert.True(Math.Abs(p.Frame.Look.Dot(t)) < 1e-9, deg + "° look ⟂ хана");
                Assert.True(p.Frame.ViewDirection.Dot(ext) > 1 - 1e-9, deg + "° гадна талаас");
                Assert.True(Math.Abs(p.Frame.Right.Dot(t)) > 1 - 1e-9, deg + "° баруун = ханын дагуу");
            }
        }

        [Test]
        public static void Orientation_is_only_trusted_for_its_sign()
        {
            WeV3 t = new WeV3(1, 0, 0);
            WeV3 ext;
            // 40° хазайсан hint ч чиглэлийг шугамаас яг гаргана.
            Assert.True(WallFrameCalculator.TryExteriorNormal(t, new WeV3(Math.Sin(0.7), -Math.Cos(0.7), 0), out ext));
            Assert.True(ext.AlmostEquals(new WeV3(0, -1, 0), E));
            // Шугамтай параллель hint — тааж зохиохгүй.
            Assert.False(WallFrameCalculator.TryExteriorNormal(t, new WeV3(1, 0.1, 0), out ext));
            Assert.False(WallFrameCalculator.TryExteriorNormal(t, WeV3.Zero, out ext));
        }

        [Test]
        public static void Wall_with_unusable_orientation_fails_instead_of_guessing()
        {
            WeWallInfo w = Fx.Wall(Fx.P(0, 0), Fx.P(4000, 0), new WeV3(1, 0, 0));
            var req = new WeRequest(); req.Walls.Add(w);
            WePlannedElevation p = Fx.Only(WallElevationPlanner.Plan(req, Fx.Ctx()));
            Assert.Eq(WeStatus.Failed, p.Status);
            Assert.Eq(WeAction.Skip, p.Action);
        }

        [Test]
        public static void Room_mode_faces_from_the_room_toward_each_wall_for_both_loop_windings()
        {
            foreach (bool ccw in new[] { true, false })
            {
                WeRequest req = Fx.SquareRoom(5000, 4000, ccw);
                WePlan plan = WallElevationPlanner.Plan(req, Fx.Ctx());
                Assert.Eq(4, plan.Items.Count, "ccw=" + ccw);
                WeV3 center = Fx.P(2500, 2000);
                foreach (WePlannedElevation p in plan.Items)
                {
                    Assert.Eq(WeStatus.Ready, p.Status, p.Message);
                    Assert.Eq(WeSide.Interior, p.Side, "өрөө нь ханын дотор талд");
                    // Харагч өрөөнд: хана руу харах чиглэл нь өрөөний төвөөс ханы тийш.
                    WeV3 toWall = (p.Frame.Origin - center).Flat().Normalized();
                    Assert.True(p.Frame.Look.Dot(toWall) > 0.99, "ccw=" + ccw + " " + p.Name);
                }
            }
        }

        [Test]
        public static void Room_letters_follow_the_compass_not_the_boundary_order()
        {
            foreach (bool ccw in new[] { true, false })
            {
                WePlan plan = WallElevationPlanner.Plan(Fx.SquareRoom(5000, 4000, ccw), Fx.Ctx());
                // Төслийн жишиг (MITIC, 2026-10-08): A = баруун хана (−X руу харна), B = хойд, C = зүүн, D = урд — контурын чиглэлээс үл хамаарна.
                Func<WeV3, string> letterOf = look => plan.Items.Single(i => i.Frame.Look.AlmostEquals(look, 1e-9)).SideLetter;
                Assert.Eq("A", letterOf(new WeV3(-1, 0, 0)), "баруун");
                Assert.Eq("B", letterOf(new WeV3(0, 1, 0)), "хойд");
                Assert.Eq("C", letterOf(new WeV3(1, 0, 0)), "зүүн");
                Assert.Eq("D", letterOf(new WeV3(0, -1, 0)), "урд");
                Assert.SeqEq(new[] { "ДЭЛГЭЭС-101A (L01)", "ДЭЛГЭЭС-101B (L01)", "ДЭЛГЭЭС-101C (L01)", "ДЭЛГЭЭС-101D (L01)" }, plan.Items.Select(i => i.Name).OrderBy(n => n));
            }
        }

        [Test]
        public static void Island_loop_interior_is_outside_the_island()
        {
            // Гадна контур CCW + дунд нь 1×1 м багана маягийн арал (CW) — арлын нормаль арлаас ГАДАГШ.
            WeV3 n1 = RoomBoundaryAnalyzer.InteriorNormal(Fx.P(2000, 2000), Fx.P(2000, 3000), isOuterLoop: false, loopIsCcw: false);
            // Арлын баруун ирмэг дээшээ явна гэвэл CW контур биш — зөвхөн дүрмийг шалгана: арал CW → дотор нь зүүн.
            Assert.True(n1.AlmostEquals(new WeV3(-1, 0, 0), E));
            WeV3 n2 = RoomBoundaryAnalyzer.InteriorNormal(Fx.P(0, 0), Fx.P(1000, 0), isOuterLoop: true, loopIsCcw: true);
            Assert.True(n2.AlmostEquals(new WeV3(0, 1, 0), E));
        }

        [Test]
        public static void Collinear_segments_of_one_wall_merge_into_one_face()
        {
            WeRequest req = Fx.SquareRoom(6000, 4000);
            WeRoomLoop loop = req.Rooms[0].Loops[0];
            // Урд ханыг өөр хана 2000-д хуваасан мэт хоёр сегмент болгоно.
            WeBoundarySegment south = loop.Segments[0];
            loop.Segments.RemoveAt(0);
            loop.Segments.Insert(0, new WeBoundarySegment { Host = WeBoundaryHost.Wall, WallUniqueId = south.WallUniqueId, IsStraight = true, A = Fx.P(2000, 0), B = Fx.P(6000, 0) });
            loop.Segments.Insert(0, new WeBoundarySegment { Host = WeBoundaryHost.Wall, WallUniqueId = south.WallUniqueId, IsStraight = true, A = Fx.P(0, 0), B = Fx.P(2000, 0) });
            WePlan plan = WallElevationPlanner.Plan(req, Fx.Ctx());
            Assert.Eq(4, plan.Items.Count);
            WePlannedElevation s = plan.Items.Single(i => i.Frame.Look.AlmostEquals(new WeV3(0, -1, 0), E));
            Assert.True(Math.Abs(s.FaceLength - Fx.Mm(6000)) < 1e-9, "нэгтгэсэн урт");
        }

        [Test]
        public static void Revit_probe_disagreement_requires_review()
        {
            WeRequest req = Fx.SquareRoom(5000, 4000);
            req.Rooms[0].Loops[0].Segments[0].InteriorProbe = false;
            WePlan plan = WallElevationPlanner.Plan(req, Fx.Ctx());
            Assert.Eq(1, plan.Count(WeStatus.RequiresReview));
            Assert.Eq(3, plan.Count(WeAction.Create));
        }

        [Test]
        public static void Non_wall_and_linked_boundaries_are_reported_not_drawn()
        {
            WeRequest req = Fx.SquareRoom(5000, 4000);
            List<WeBoundarySegment> segs = req.Rooms[0].Loops[0].Segments;
            segs[1].Host = WeBoundaryHost.Other;
            segs[2].Host = WeBoundaryHost.LinkedWall;
            WePlan plan = WallElevationPlanner.Plan(req, Fx.Ctx());
            Assert.Eq(2, plan.Items.Count);
            Assert.True(plan.Notes.Any(n => n.Contains("холбоос") && n.Contains("хана биш")), string.Join(" | ", plan.Notes));
        }
    }
}
