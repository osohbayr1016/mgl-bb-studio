using System;
using System.Collections.Generic;
using System.Linq;
using RevitMcpAddin.WallElevation.Core;

namespace RevitMcpAddin.WallElevation.Tests
{
    /// <summary>
    /// Elevation маркер (жишээ хуудас 206A-G / 205G-N): тэгш өнцөгт өрөөнд НЭГ маркер 4 сумтай, сум бүр ӨӨРИЙН ханаа заана; L, налуу,
    /// олон талт өрөөнд заахгүй бол тусдаа маркер.  Revit 2027-д хэмжсэн индекс → чиглэл (0 = −X, 1 = +Y, 2 = +X, 3 = −Y).
    /// </summary>
    public static class MarkerTests
    {
        private static double Mm(double ft) { return Math.Round(ft * WeFixedUnits.MmPerFoot, 1); }

        private static void Near(double expected, double actual, double tol, string msg = null)
        {
            Assert.True(Math.Abs(expected - actual) <= tol, (msg ?? "ойролцоо") + ": expected=" + expected + " actual=" + actual);
        }

        private static void ArrowsPointAtTheirWalls(WePlan plan)
        {
            foreach (WePlannedElevation i in plan.Items.Where(x => x.Marker != null))
            {
                WeV3 arrow = WeMarkerPlanner.SlotLook(i.Marker.Slot, i.Marker.Rotation);
                Assert.True(arrow.Dot(i.Frame.Look.Flat().Normalized()) > 1 - 1e-6, i.Label + ": сум ханаа харна");
            }
            // Нэг маркерын нэг сум = нэг дэлгээс.
            Assert.Eq(plan.Items.Count(x => x.Marker != null), plan.Items.Where(x => x.Marker != null).Select(x => x.Marker.Group + "#" + x.Marker.Slot).Distinct().Count(), "сум давхардахгүй");
        }

        [Test]
        public static void Slot_directions_match_the_measured_Revit_order()
        {
            Assert.True(WeMarkerPlanner.SlotLook(0, 0).Dot(new WeV3(-1, 0, 0)) > 0.999999, "0 = −X");
            Assert.True(WeMarkerPlanner.SlotLook(1, 0).Dot(new WeV3(0, 1, 0)) > 0.999999, "1 = +Y");
            Assert.True(WeMarkerPlanner.SlotLook(2, 0).Dot(new WeV3(1, 0, 0)) > 0.999999, "2 = +X");
            Assert.True(WeMarkerPlanner.SlotLook(3, 0).Dot(new WeV3(0, -1, 0)) > 0.999999, "3 = −Y");
            int slot; double rot;
            WeMarkerPlanner.ChooseSlot(new WeV3(Math.Cos(Math.PI / 6), Math.Sin(Math.PI / 6), 0), out slot, out rot);
            Assert.Eq(2, slot);
            Near(Math.PI / 6, rot, 1e-9, "30° эргэлт");
        }

        [Test]
        public static void Rectangle_room_gets_one_marker_with_four_arrows_in_the_middle()
        {
            WePlan plan = Poly.Plan(Poly.Room(Poly.P(0, 0, 5000, 0, 5000, 4000, 0, 4000)));
            List<WeMarkerPlacement> ms = plan.Items.Select(i => i.Marker).ToList();
            Assert.True(ms.All(m => m != null), "бүгд маркертай");
            Assert.Eq(1, ms.Select(m => m.Group).Distinct().Count(), "нэг маркер");
            Assert.Eq(4, ms.Select(m => m.Slot).Distinct().Count());
            Assert.True(ms.All(m => m.Shared == 4));
            Near(2500, Mm(ms[0].Position.X), 1, "өрөөний төв X");
            Near(2000, Mm(ms[0].Position.Y), 1, "өрөөний төв Y");
            Near(0, ms[0].Rotation, 1e-9, "эргэлтгүй");
            ArrowsPointAtTheirWalls(plan);
        }

        [Test]
        public static void Rotated_room_rotates_its_single_marker()
        {
            double a = Math.PI / 6;
            Func<double, double, double[]> r = (x, y) => new[] { x * Math.Cos(a) - y * Math.Sin(a), x * Math.Sin(a) + y * Math.Cos(a) };
            double[][] pts = { r(0, 0), r(5000, 0), r(5000, 4000), r(0, 4000) };
            WePlan plan = Poly.Plan(Poly.Room(pts));
            List<WeMarkerPlacement> ms = plan.Items.Select(i => i.Marker).ToList();
            Assert.Eq(1, ms.Select(m => m.Group).Distinct().Count(), "нэг маркер");
            Near(a, Math.Abs(ms[0].Rotation), 1e-6, "маркер 30° эргэсэн");
            double[] c = r(2500, 2000);
            Near(c[0], Mm(ms[0].Position.X), 1);
            Near(c[1], Mm(ms[0].Position.Y), 1);
            ArrowsPointAtTheirWalls(plan);
        }

        [Test]
        public static void L_room_arrows_each_point_at_their_own_wall_from_inside()
        {
            WeRequest req = Poly.Room(Poly.P(0, 0, 6000, 0, 6000, 2500, 3500, 2500, 3500, 4000, 0, 4000));
            WePlan plan = Poly.Plan(req);
            WeRoomInfo room = req.Rooms[0];
            int groups = plan.Items.Select(i => i.Marker.Group).Distinct().Count();
            Assert.True(groups >= 2 && groups < plan.Items.Count, "L өрөө: хуваалцсан + тусдаа маркер (" + groups + ")");
            foreach (WePlannedElevation i in plan.Items)
            {
                WeV3 p = i.Marker.Position;
                WeV3 local = i.Frame.ToLocal(new WeV3(p.X, p.Y, i.Frame.Origin.Z));
                Assert.True(Math.Abs(local.X) <= i.FaceLength / 2 + 1e-6, i.Label + ": маркер ханын өргөний дотор");
                Assert.True(-local.Z >= Fx.Mm(300) - 1e-6, i.Label + ": маркер ханаас өмнө");
                Assert.True(WeKeyPlanner.InsideRoom(room, p), i.Label + ": маркер өрөөн дотор");
            }
            ArrowsPointAtTheirWalls(plan);
        }

        [Test]
        public static void Markers_of_one_room_keep_apart_by_the_symbol_size()
        {
            // GATEWAY 310 (2026-10-07): L өрөөний гурван маркерын хоёр нь бие биенийхээ дээр — сумны тэмдэг давхцсан.  Одоо маркерын төвүүдийн
            // хооронд ≥ тэмдгийн хэмжээ (түлхүүр планы хүлээгдэж буй масштабаар), сум бүр ханаа заасаар.
            foreach (double[][] pts in new[]
            {
                Poly.P(0, 0, 6200, 0, 6200, 7300, 2500, 7300, 2500, 1750, 0, 1750),
                Poly.P(0, 0, 6000, 0, 6000, 2500, 3500, 2500, 3500, 4000, 0, 4000),
                Poly.P(0, 0, 9000, 0, 9000, 3000, 6000, 3000, 6000, 8000, 3000, 8000, 3000, 3000, 0, 3000),
            })
            {
                WeRequest req = Poly.Room(pts);
                WePlan plan = Poly.Plan(req);
                WeRoomInfo room = req.Rooms[0];
                var s = new WeSettings();
                double sep = Fx.Mm(WeKeyPlanner.MarkerPaperMm * WeKeyPlanner.ExpectedScale(room, s, new WeFixedUnits()));
                List<WeV3> centers = plan.Items.Where(i => i.Marker != null).GroupBy(i => i.Marker.Group).Select(g => g.First().Marker.Position).ToList();
                for (int a = 0; a < centers.Count; a++)
                    for (int b = a + 1; b < centers.Count; b++)
                        Assert.True((centers[a] - centers[b]).Flat().Length >= sep - 1e-6,
                            "маркер хоорондын зай " + Mm((centers[a] - centers[b]).Flat().Length) + " ≥ " + Mm(sep) + " мм");
                foreach (WePlannedElevation i in plan.Items)
                {
                    WeV3 p = i.Marker.Position;
                    WeV3 local = i.Frame.ToLocal(new WeV3(p.X, p.Y, i.Frame.Origin.Z));
                    Assert.True(Math.Abs(local.X) <= i.FaceLength / 2 + 1e-6, i.Label + ": маркер ханын өргөний дотор");
                    Assert.True(WeKeyPlanner.InsideRoom(room, p), i.Label + ": маркер өрөөн дотор");
                    // we-test 301E (2026-10-07): зөөсөн маркер ханаас төлөвлөсөн зүсэх хавтгайгаас ЦААШ холдвол дэлгээс шалгалтад унадаг.
                    Assert.True(-local.Z <= -i.Box.Near + 1e-6, i.Label + ": маркер зүсэх хавтгайгаас цааш холдоогүй (" + Mm(-local.Z) + " ≤ " + Mm(-i.Box.Near) + ")");
                }
                ArrowsPointAtTheirWalls(plan);
            }
        }

        [Test]
        public static void Pilaster_faces_get_their_own_markers()
        {
            WeRequest req = Poly.Room(Poly.P(0, 0, 2000, 0, 2000, 300, 2500, 300, 2500, 0, 6000, 0, 6000, 4000, 0, 4000),
                                      new[] { "s", "pl", "pf", "pr", "s", "e", "n", "w" });
            WePlan plan = Poly.Plan(req);
            // 2026-10-08 (MITIC жишиг ИЗД1_A2_40): цухуйсан хэсгийн урд нүүр нь давсан урт талын дэлгээст — тусдаа дэлгээсгүй.  Хажуу нүүрүүд
            // (300 мм) — 2026-10-14-өөс 1 м-ээс богино булангийн хэсэг, мөн тусдаа дэлгээсгүй (эзний шийдвэр).
            Assert.False(plan.Items.Any(i => i.WallUid == "wall-pf"), "пилястрын урд нүүр — урд талын дэлгээст");
            Assert.False(plan.Items.Any(i => i.WallUid == "wall-pl" || i.WallUid == "wall-pr"), "300 мм-ийн хажуу нүүр — дэлгээсгүй");
            ArrowsPointAtTheirWalls(plan);
        }

        [Test]
        public static void Section_kind_existing_views_and_wall_mode()
        {
            WeRequest req = Poly.Room(Poly.P(0, 0, 5000, 0, 5000, 4000, 0, 4000));
            Assert.True(Poly.Plan(req, s => s.ViewKind = WeViewKind.Section).Items.All(i => i.Marker == null), "Section — маркергүй");
            req.Existing = Fx.AsExisting(Poly.Plan(req));
            Assert.True(Poly.Plan(req).Items.All(i => i.Marker == null), "байгаа дэлгээс өөрийн маркертай хэвээр");

            var w = Fx.Wall(Fx.P(0, 0), Fx.P(4000, 0), new WeV3(0, -1, 0), id: 77);
            w.UniqueId = "w77";
            var wr = new WeRequest();
            wr.Walls.Add(w);
            wr.WallLookup[w.UniqueId] = w;
            WePlan wp = Poly.Plan(wr, s => s.WallSide = WeWallSidePick.Both);
            Assert.Eq(2, wp.Items.Count);
            Assert.Eq(2, wp.Items.Select(i => i.Marker.Group).Distinct().Count(), "хана горим: дэлгээс тус бүр өөрийн маркер");
            ArrowsPointAtTheirWalls(wp);
        }

        [Test]
        public static void Settings_view_kind_round_trips_and_old_files_upgrade()
        {
            var s = new WeSettings { ViewKind = WeViewKind.Section, ViewTypeName = "X" };
            WeSettings r = WeSettings.Deserialize(s.Serialize());
            Assert.Eq(WeViewKind.Section, r.ViewKind);
            Assert.Eq("X", r.ViewTypeName);
            Assert.False(r.FromOlderFile);
            WeSettings old = WeSettings.Deserialize("version=1\nviewType=Ханын дэлгээс\nscale=50\n");
            Assert.True(old.FromOlderFile, "хуучин файл");
            Assert.Eq(WeViewKind.Elevation, old.ViewKind);
            Assert.Eq(string.Empty, old.ViewTypeName, "зүсэлтийн төрлийн нэрийг Elevation-д хэрэглэхгүй");
            Assert.Eq(WeViewKind.Elevation, new WeSettings().ViewKind, "өгөгдмөл = Elevation");
        }

        [Test]
        public static void LooksGenerated_recognises_tool_labels_only()
        {
            Dictionary<string, string> v = WeNaming.Values("L2", "205", "Лоунж", null, null, 0, null, null);
            Assert.True(WeNaming.LooksGenerated("{Room}{Side}", "205C", v));
            Assert.True(WeNaming.LooksGenerated("{Room}{Side}", "205AA", v));
            Assert.False(WeNaming.LooksGenerated("{Room}{Side}", "205", v), "үсэггүй");
            Assert.False(WeNaming.LooksGenerated("{Room}{Side}", "A-1", v), "хэрэглэгчийн дугаар");
            Assert.False(WeNaming.LooksGenerated("{Room}{Side}", "301C", v), "өөр өрөө");
            Assert.True(WeNaming.LooksGenerated("Ханын дэлгээс {Room}{Side}", "Ханын дэлгээс 205B", v));
            Assert.False(WeNaming.LooksGenerated("Ханын дэлгээс {Room}{Side}", "Зүүн хана", v));
            Assert.False(WeNaming.LooksGenerated("{Side}", "C", v), "тогтмол хэсэггүй загвар — таахгүй");
        }
    }
}
