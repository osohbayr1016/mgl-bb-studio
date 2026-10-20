using System;
using System.Collections.Generic;
using System.Linq;
using RevitMcpAddin.WallElevation.Core;

namespace RevitMcpAddin.WallElevation.Tests
{
    /// <summary>
    /// W04 (2026-10-16): Elevation маркер БҮР — шинэ ганц, хуваалцсан, зөөсөн — баталгаажна: сум ханаа харна, ханын өргөний дотор, ханаас ≥ 300 мм
    /// өмнө, өрөөн дотор (арал/нүхийн гадна).  Өрөөний шошго / Location ХЭРЭГЛЭГДЭХГҮЙ.  Өмнө нь шинэ ганц маркерыг огт шалгадаггүй байсан.
    /// </summary>
    public static class MarkerCentreTests
    {
        private static void AddIsland(WeRequest req, double x0, double y0, double x1, double y1)
        {
            var loop = new WeRoomLoop();
            var pts = new[] { Fx.P(x0, y0), Fx.P(x0, y1), Fx.P(x1, y1), Fx.P(x1, y0) };
            for (int i = 0; i < 4; i++)
                loop.Segments.Add(new WeBoundarySegment { Host = WeBoundaryHost.Other, IsStraight = true, A = pts[i], B = pts[(i + 1) % 4] });
            req.Rooms[0].Loops.Add(loop);
        }

        /// <summary>Маркер бүрийн шалгуур — <see cref="WeMarkerPlanner"/>-ийн дүрмийг тестээс ХАРААТ БУСААР дахин бодно.</summary>
        private static void AssertEveryMarkerValid(WePlan plan, WeRoomInfo room)
        {
            List<WePlannedElevation> withMarker = plan.Items.Where(i => i.Marker != null).ToList();
            Assert.True(withMarker.Count > 0, "маркер оногдсон");
            foreach (WePlannedElevation i in withMarker)
            {
                WeV3 p = i.Marker.Position;
                WeV3 arrow = WeMarkerPlanner.SlotLook(i.Marker.Slot, i.Marker.Rotation);
                Assert.True(arrow.Dot(i.Frame.Look.Flat().Normalized()) > 1 - 1e-6, i.Label + ": сум ханаа харна");
                WeV3 local = i.Frame.ToLocal(new WeV3(p.X, p.Y, i.Frame.Origin.Z));
                Assert.True(Math.Abs(local.X) <= i.FaceLength / 2 + 1e-6, i.Label + ": ханын өргөний дотор");
                Assert.True(-local.Z >= Fx.Mm(300) - 1e-6, i.Label + ": ханаас ≥ 300 мм өмнө");
                Assert.True(WeKeyPlanner.InsideRoom(room, p), i.Label + ": өрөөн дотор (арлын гадна)");
                Assert.True(i.Marker.Validated, i.Label + ": баталгаажсан");
            }
        }

        [Test]
        public static void Column_in_the_middle_never_hosts_the_marker()
        {
            // 5 × 4 м өрөөний яг төвд 600 × 600 багана — өмнө нь 4 сумтай маркер багана ДОТОР (өрөөний гадна) гардаг байв.
            WeRequest req = Poly.Room(Poly.P(0, 0, 5000, 0, 5000, 4000, 0, 4000));
            AddIsland(req, 2200, 1700, 2800, 2300);
            WePlan plan = Poly.Plan(req);
            Assert.Eq(4, plan.Items.Count(i => i.Marker != null), "дөрвөн тал маркертай (баганын 600 мм нүүр — дэлгээсгүй)");
            AssertEveryMarkerValid(plan, req.Rooms[0]);
            Assert.True(plan.Items.Select(i => i.Marker.Group).Distinct().Count() >= 2, "нэг цэгээс бүх хана харагдахгүй — олон маркер");
        }

        [Test]
        public static void U_shaped_room_markers_stay_inside_and_face_their_walls()
        {
            // U: 9 × 6 м, дээд талын голд 3 × 3 м хонхор (нээлттэй).
            WeRequest req = Poly.Room(Poly.P(0, 0, 9000, 0, 9000, 6000, 6000, 6000, 6000, 3000, 3000, 3000, 3000, 6000, 0, 6000));
            WePlan plan = Poly.Plan(req);
            AssertEveryMarkerValid(plan, req.Rooms[0]);
        }

        [Test]
        public static void Moving_the_room_tag_or_location_does_not_move_the_markers()
        {
            WeRequest a = Poly.Room(Poly.P(0, 0, 6000, 0, 6000, 2500, 3500, 2500, 3500, 4000, 0, 4000));
            WeRequest b = Poly.Room(Poly.P(0, 0, 6000, 0, 6000, 2500, 3500, 2500, 3500, 4000, 0, 4000));
            a.Rooms[0].Location = Fx.P(300, 300);       // шошго хананд наалдсан
            b.Rooms[0].Location = Fx.P(5800, 2400);     // өөр буланд
            WePlan pa = Poly.Plan(a), pb = Poly.Plan(b);
            Assert.Eq(pa.Items.Count, pb.Items.Count);
            for (int i = 0; i < pa.Items.Count; i++)
            {
                WeMarkerPlacement ma = pa.Items[i].Marker, mb = pb.Items[i].Marker;
                Assert.True((ma.Position - mb.Position).Flat().Length < 1e-9 && ma.Slot == mb.Slot, pa.Items[i].Label + ": маркер өрөөний цэгээс үл хамаарна");
            }
            AssertEveryMarkerValid(pa, a.Rooms[0]);
        }

        [Test]
        public static void Narrow_and_rotated_rooms_keep_valid_markers()
        {
            AssertEveryMarkerValid(Poly.Plan(Poly.Room(Poly.P(0, 0, 8000, 0, 8000, 1200, 0, 1200))), Poly.Room(Poly.P(0, 0, 8000, 0, 8000, 1200, 0, 1200)).Rooms[0]);
            double ang = Math.PI / 5;
            Func<double, double, double[]> r = (x, y) => new[] { x * Math.Cos(ang) - y * Math.Sin(ang), x * Math.Sin(ang) + y * Math.Cos(ang) };
            double[][] pts = { r(0, 0), r(7000, 0), r(7000, 3000), r(4000, 3000), r(4000, 5000), r(0, 5000) };
            WeRequest req = Poly.Room(pts);
            AssertEveryMarkerValid(Poly.Plan(req), req.Rooms[0]);
        }

        [Test]
        public static void Rectangle_markers_are_validated_and_centred()
        {
            WeRequest req = Poly.Room(Poly.P(0, 0, 5000, 0, 5000, 4000, 0, 4000));
            WePlan plan = Poly.Plan(req);
            AssertEveryMarkerValid(plan, req.Rooms[0]);
            Assert.Eq(1, plan.Items.Select(i => i.Marker.Group).Distinct().Count(), "тэгш өнцөгт — нэг маркер, утга бүхий төв");
        }
    }
}
