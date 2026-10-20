using System;
using System.Collections.Generic;
using System.Linq;
using RevitMcpAddin.WallElevation.Core;

namespace RevitMcpAddin.WallElevation.Tests
{
    /// <summary>
    /// Дурын олон өнцөгт өрөө (мм, CCW): ирмэг бүр нэг хана (эсвэл <see cref="Other"/> = багана/тусгаарлах шугам, <see cref="Linked"/>).
    /// Ижил <c>wallKey</c>-тэй ирмэгүүд НЭГ хана (жишээ: дундах хаалтаар тасарсан ганц хана).
    /// </summary>
    public static class Poly
    {
        public const string Other = "~other";
        public const string Linked = "~link";

        public static WeRequest Room(double[][] ptsMm, string[] wallKeys = null, string number = "201", double heightMm = 2800)
        {
            var req = new WeRequest();
            var loop = new WeRoomLoop();
            var walls = new Dictionary<string, WeWallInfo>(StringComparer.Ordinal);
            long id = 7000;
            for (int i = 0; i < ptsMm.Length; i++)
            {
                WeV3 a = Fx.P(ptsMm[i][0], ptsMm[i][1]);
                WeV3 b = Fx.P(ptsMm[(i + 1) % ptsMm.Length][0], ptsMm[(i + 1) % ptsMm.Length][1]);
                string key = wallKeys != null && i < wallKeys.Length && wallKeys[i] != null ? wallKeys[i] : "e" + i;
                if (key == Other || key == Linked)
                {
                    loop.Segments.Add(new WeBoundarySegment { Host = key == Other ? WeBoundaryHost.Other : WeBoundaryHost.LinkedWall, IsStraight = true, A = a, B = b });
                    continue;
                }
                WeWallInfo w;
                if (!walls.TryGetValue(key, out w))
                {
                    // CCW контурын гадна = баруун нормаль.
                    WeV3 t = (b - a).Flat().Normalized();
                    w = Fx.Wall(a, b, new WeV3(t.Y, -t.X, 0), id: ++id);
                    w.UniqueId = "wall-" + key;
                    walls[key] = w;
                    req.WallLookup[w.UniqueId] = w;
                }
                loop.Segments.Add(new WeBoundarySegment { Host = WeBoundaryHost.Wall, WallUniqueId = w.UniqueId, IsStraight = true, A = a, B = b });
            }
            req.Rooms.Add(new WeRoomInfo
            {
                UniqueId = "room-" + number, Id = 600, Number = number, Name = "Лоунж", LevelName = "L02", LevelId = 31,
                BottomZ = 0, TopZ = Fx.Mm(heightMm), IsPlaced = true, IsEnclosed = true, Loops = { loop },
            });
            return req;
        }

        public static double[][] P(params double[] xy)
        {
            var r = new double[xy.Length / 2][];
            for (int i = 0; i < r.Length; i++) r[i] = new[] { xy[2 * i], xy[2 * i + 1] };
            return r;
        }

        public static List<WeRoomSide> Sides(WeRequest req, bool merge = true)
        {
            return RoomBoundaryAnalyzer.Sides(req.Rooms[0], new List<KeyValuePair<WeBoundarySegment, string>>(), merge, Fx.Mm(1000), Fx.Mm(5));
        }

        public static WePlan Plan(WeRequest req, Action<WeSettings> tweak = null)
        {
            return WallElevationPlanner.Plan(req, Fx.Ctx(tweak));
        }
    }

    /// <summary>Өрөөний ТАЛ (нэг дэлгээс): тэгш өнцөгт, L, налуу, олон талт, нэг шулуун дээрх олон хана, пилястр, ниш, хаалт хана.</summary>
    public static class SideTests
    {
        private const double E = 1e-6;

        private static double Mm(double ft) { return Math.Round(ft * WeFixedUnits.MmPerFoot, 1); }

        [Test]
        public static void Rectangle_gives_four_sides_with_one_wall_each()
        {
            List<WeRoomSide> sides = Poly.Sides(Poly.Room(Poly.P(0, 0, 5000, 0, 5000, 4000, 0, 4000)));
            Assert.Eq(4, sides.Count);
            Assert.True(sides.All(s => s.Walls.Count == 1 && !s.IsCurved));
            Assert.SeqEq(new[] { 5000.0, 4000, 5000, 4000 }, sides.Select(s => Mm(s.Length)));
        }

        [Test]
        public static void L_shaped_room_gives_six_sides()
        {
            // 6000×4000, баруун дээд буланд 2500×1500 тасархай.
            WeRequest req = Poly.Room(Poly.P(0, 0, 6000, 0, 6000, 2500, 3500, 2500, 3500, 4000, 0, 4000));
            List<WeRoomSide> sides = Poly.Sides(req);
            Assert.Eq(6, sides.Count, "L өрөө = 6 тал");
            WePlan plan = Poly.Plan(req);
            Assert.Eq(6, plan.Items.Count(i => i.Action == WeAction.Create), "6 дэлгээс");
            Assert.SeqEq(new[] { "A", "B", "C", "D", "E", "F" }, plan.Items.Select(i => i.SideLetter).OrderBy(x => x));
        }

        [Test]
        public static void Corner_column_notch_merges_into_the_two_adjacent_sides()
        {
            // MITIC 215 (хэмжсэн): 6750 × 4800 өрөөний баруун дээд буланд 250 × 450 баганын хонхор — жишиг хуудас 4 дэлгээс.
            WeRequest req = Poly.Room(Poly.P(0, 0, 6750, 0, 6750, 4350, 6500, 4350, 6500, 4800, 0, 4800));
            List<WeRoomSide> sides = Poly.Sides(req);
            Assert.Eq(4, sides.Count, "баганын хонхор тусдаа тал болохгүй");
            WeRoomSide east = sides.Single(s => s.InteriorNormal.AlmostEquals(new WeV3(-1, 0, 0), E));
            Assert.Eq(4800.0, Mm(east.Length), "4350 + 450");
            Assert.Eq(250.0, Mm(east.Protrusion), "хонхорын хана 250 мм өрөө рүү");
            Assert.Eq("wall-e1", east.AnchorWallUid, "зангуу = урт хана");
            WeRoomSide north = sides.Single(s => s.InteriorNormal.AlmostEquals(new WeV3(0, -1, 0), E));
            Assert.Eq(6750.0, Mm(north.Length), "6500 + 250");
            Assert.Eq(450.0, Mm(north.Protrusion));
            Assert.Eq("wall-e4", north.AnchorWallUid);
            WePlan plan = Poly.Plan(req);
            Assert.Eq(4, plan.Items.Count(i => i.Action == WeAction.Create), "4 дэлгээс");
            WePlannedElevation e = plan.Items.Single(i => i.WallUid == "wall-e1");
            Assert.SeqEq(new[] { "wall-e1", "wall-e3" }, e.WallUids);

            // Гүн алхам (1.5 м — L өрөө) нэгдэхгүй; нимгэн алхам (100 мм) урт талд ч нэгдэнэ.
            Assert.Eq(6, Poly.Sides(Poly.Room(Poly.P(0, 0, 6000, 0, 6000, 2500, 4500, 2500, 4500, 4000, 0, 4000))).Count);
            WeRequest thin = Poly.Room(Poly.P(0, 0, 6000, 0, 6000, 2000, 5900, 2000, 5900, 4000, 0, 4000));
            Assert.Eq(4, Poly.Sides(thin).Count, "100 мм өнгөлгөөний алхам — нэг тал");
        }

        [Test]
        public static void Opening_reveals_are_not_separate_elevations()
        {
            // MITIC 202 Лобби (хэмжсэн): зүүн талд 2560 мм нээлхий (тусгаарлах шугам), хоёр талдаа 700 мм хүрээ — жишиг 4 дэлгээс.
            WeRequest req = Poly.Room(Poly.P(0, 0, 8000, 0, 8000, 2000, 8700, 2000, 8700, 4560, 8000, 4560, 8000, 5590, 0, 5590),
                                      new[] { null, null, null, Poly.Other });
            var skipped = new List<KeyValuePair<WeBoundarySegment, string>>();
            List<WeRoomSide> sides = RoomBoundaryAnalyzer.Sides(req.Rooms[0], skipped, true, Fx.Mm(WallElevationPlanner.MaxJogMm), Fx.Mm(WallElevationPlanner.LineTolMm));
            Assert.False(sides.Any(sd => Mm(sd.Length) <= 700.5), "700 мм-ийн нээлхийн хүрээ тусдаа тал болохгүй");
            Assert.True(skipped.Any(k => k.Value.Contains("нээлхийн хажуу")), "тайланд шалтгаантай");

            // Хананд залгаа 660 мм-ийн богино тал (216E/F) — эзний шийдвэр 2026-10-14: 1 м-ээс богино булангийн хэсэг тусдаа дэлгээсгүй.
            WeRequest stub = Poly.Room(Poly.P(0, 0, 5000, 0, 5000, 2000, 5660, 2000, 5660, 2130, 5000, 2130, 5000, 3400, 0, 3400));
            var stubSkipped = new List<KeyValuePair<WeBoundarySegment, string>>();
            List<WeRoomSide> stubSides = RoomBoundaryAnalyzer.Sides(stub.Rooms[0], stubSkipped, true, Fx.Mm(WallElevationPlanner.MaxJogMm), Fx.Mm(WallElevationPlanner.LineTolMm));
            Assert.False(stubSides.Any(sd => Math.Abs(Mm(sd.Length) - 660) < 1), "660 мм-ийн булангийн тал — тусдаа дэлгээсгүй");
            Assert.True(stubSkipped.Any(k => k.Value.Contains("1 м-ээс богино")), "тайланд шалтгаантай");
        }

        [Test]
        public static void Angled_and_polygonal_rooms_get_every_side()
        {
            // Трапец (нэг налуу хана) ба 8 өнцөгт — 4-өөр хязгаарлахгүй.
            WeRequest trap = Poly.Room(Poly.P(0, 0, 6000, 0, 4500, 3000, 0, 3000));
            Assert.Eq(4, Poly.Plan(trap).Items.Count(i => i.Action == WeAction.Create));
            var oct = new List<double>();
            for (int k = 0; k < 8; k++)
            {
                double a = Math.PI / 8 + k * Math.PI / 4;
                oct.Add(Math.Round(3000 * Math.Cos(a), 3));
                oct.Add(Math.Round(3000 * Math.Sin(a), 3));
            }
            WePlan p = Poly.Plan(Poly.Room(Poly.P(oct.ToArray())));
            Assert.Eq(8, p.Items.Count(i => i.Action == WeAction.Create), "8 тал");
            Assert.True(p.Items.All(i => i.Frame != null && WallFrameCalculator.IsValid(i.Frame)));
            Assert.Eq(8, p.Items.Select(i => i.SideLetter).Distinct().Count(), "8 өөр үсэг");
        }

        [Test]
        public static void Collinear_walls_merge_into_one_side_with_the_longest_as_anchor()
        {
            // Урд тал = 3 хана (2000 + 4500 + 1190) нэг шулуун дээр — жишээ зургийн 205C шиг нэг дэлгээс.
            WeRequest req = Poly.Room(Poly.P(0, 0, 2000, 0, 6500, 0, 7690, 0, 7690, 4000, 0, 4000),
                                      new[] { "s1", "s2", "s3", "e", "n", "w" });
            List<WeRoomSide> sides = Poly.Sides(req);
            Assert.Eq(4, sides.Count, "3 хана нэг тал");
            WeRoomSide south = sides.Single(s => s.InteriorNormal.AlmostEquals(new WeV3(0, 1, 0), E));
            Assert.Eq(7690.0, Mm(south.Length));
            Assert.SeqEq(new[] { "wall-s2", "wall-s1", "wall-s3" }, south.Walls.Select(w => w.WallUniqueId), "зангуу = хамгийн урт");

            WePlan plan = Poly.Plan(req);
            WePlannedElevation item = plan.Items.Single(i => i.WallUid == "wall-s2");
            Assert.Eq(WeIdentity.Key("room-201", "wall-s2", WeSide.Interior), item.Key, "түлхүүр = зангуу ханын (нэгтгэхгүй горимтой ижил)");
            Assert.SeqEq(new[] { "wall-s2", "wall-s1", "wall-s3" }, item.WallUids);
            Assert.True(Math.Abs(item.FaceLength - Fx.Mm(7690)) < 1e-9);

            // Нэгтгэхгүй горим: хана бүр тусдаа (хуучин зан төлөв).
            Assert.Eq(6, Poly.Sides(req, merge: false).Count);
            Assert.Eq(6, Poly.Plan(req, s => s.MergeCollinear = false).Items.Count(i => i.Action == WeAction.Create));
        }

        [Test]
        public static void Single_wall_sides_keep_their_old_keys_when_merging_is_switched_on()
        {
            WeRequest req = Poly.Room(Poly.P(0, 0, 5000, 0, 5000, 4000, 0, 4000));
            var a = Poly.Plan(req, s => s.MergeCollinear = false).Items.Select(i => i.Key).OrderBy(k => k, StringComparer.Ordinal).ToList();
            var b = Poly.Plan(req).Items.Select(i => i.Key).OrderBy(k => k, StringComparer.Ordinal).ToList();
            Assert.SeqEq(a, b, "тэгш өнцөгт өрөөнд нэгтгэх горим дахин ажиллуулахад шинэ харагдац үүсгэхгүй");
        }

        [Test]
        public static void Pilaster_and_column_are_bridged_and_push_the_cut_plane_forward()
        {
            // Урд хананы дунд 500×300 багана (пилястр) өрөө рүү цухуйсан.
            WeRequest req = Poly.Room(Poly.P(0, 0, 2000, 0, 2000, 300, 2500, 300, 2500, 0, 6000, 0, 6000, 4000, 0, 4000),
                                      new[] { "s", Poly.Other, Poly.Other, Poly.Other, "s", "e", "n", "w" });
            List<WeRoomSide> sides = Poly.Sides(req);
            WeRoomSide south = sides.Single(s => s.InteriorNormal.AlmostEquals(new WeV3(0, 1, 0), E) && Mm(s.Length) > 1000);
            Assert.Eq(6000.0, Mm(south.Length), "пилястрыг давж нэг тал");
            Assert.True(south.HasNonWall, "багана (давсан завсарт) талд орсон");
            Assert.Eq(300.0, Mm(south.Protrusion));
            Assert.Eq(1, south.Walls.Count, "нэг хана (хоёр хэсэг)");
            Assert.Eq(5500.0, Mm(south.Walls[0].Length));

            WePlannedElevation item = Poly.Plan(req, s => s.DepthMode = WeDepthMode.Fixed).Items.Single(i => i.WallUid == "wall-s" && i.FaceLength > Fx.Mm(5000));
            Assert.Eq(-900.0, Mm(item.Box.Near), "зүсэх хавтгай пилястраас 600 мм өмнө");
        }

        [Test]
        public static void Shallow_niche_is_bridged_and_deepens_the_view_deep_recess_is_not()
        {
            // Урд хананд 1000 өргөн, 600 гүн ниш.
            WeRequest req = Poly.Room(Poly.P(0, 0, 2000, 0, 2000, -600, 3000, -600, 3000, 0, 6000, 0, 6000, 4000, 0, 4000));
            WeRoomSide south = Poly.Sides(req).Single(s => s.InteriorNormal.AlmostEquals(new WeV3(0, 1, 0), E) && Mm(s.Length) > 2000);
            Assert.Eq(6000.0, Mm(south.Length));
            Assert.Eq(600.0, Mm(south.Recess));
            WePlannedElevation item = Poly.Plan(req).Items.Single(i => i.FaceLength > Fx.Mm(5999) && i.Frame.Look.AlmostEquals(new WeV3(0, -1, 0), E));
            Assert.True(item.Box.Far >= Fx.Mm(600 + 200), "гүн нишийг хамарна: far " + Mm(item.Box.Far));
            // Нишийн арын хана өөрөө тусдаа тал (жишээ зургийн нарийн 205E/F шиг); 600 мм-ийн хажуу нүүр — булангийн богино хэсэг (2026-10-14).
            Assert.Eq(5, Poly.Sides(req).Count, "4 тал + нишийн арын хана");

            // 3000 гүн «U» хонхор — хоёр хэсэг ТУСДАА.
            WeRequest deep = Poly.Room(Poly.P(0, 0, 2000, 0, 2000, -3000, 3000, -3000, 3000, 0, 6000, 0, 6000, 4000, 0, 4000));
            Assert.Eq(2, Poly.Sides(deep).Count(s => s.InteriorNormal.AlmostEquals(new WeV3(0, 1, 0), E) && Math.Abs(s.A.Y) < 1e-6));
        }

        [Test]
        public static void Partition_splits_one_wall_into_two_sides_with_distinct_keys()
        {
            // Урд ханаас өрөө рүү 2500 урт хаалт хана (зузаан 100, x = 3000) — нэг хана хоёр тал болно.
            WeRequest req = Poly.Room(Poly.P(0, 0, 3000, 0, 3000, 2500, 3100, 2500, 3100, 0, 6000, 0, 6000, 4000, 0, 4000),
                                      new[] { "s", "p", "p2", "p", "s", "e", "n", "w" });
            WePlan plan = Poly.Plan(req);
            List<WePlannedElevation> south = plan.Items.Where(i => i.WallUid == "wall-s").ToList();
            Assert.Eq(2, south.Count, "урд хана хоёр дэлгээс");
            Assert.Eq(2, south.Select(i => i.Key).Distinct().Count(), "түлхүүр давхардахгүй");
            Assert.True(south.Any(i => i.Key.EndsWith("|part:2", StringComparison.Ordinal)));
            Assert.True(plan.Items.All(i => i.Action == WeAction.Create));
            Assert.False(plan.Notes.Any(n => n.Contains("давхар")), "давхар сонголт гэж тооцохгүй");
        }

        [Test]
        public static void Separation_line_inside_a_side_is_kept_open_side_is_reported()
        {
            // Урд талын дунд 1000 өрөө тусгаарлах шугам (хоёр ханын хооронд) — нэг тал; баруун тал бүхэлдээ шугам — дэлгээсгүй.
            WeRequest req = Poly.Room(Poly.P(0, 0, 2500, 0, 3500, 0, 6000, 0, 6000, 4000, 0, 4000),
                                      new[] { "s1", Poly.Other, "s2", "e", "n", Poly.Other });
            var skipped = new List<KeyValuePair<WeBoundarySegment, string>>();
            List<WeRoomSide> sides = RoomBoundaryAnalyzer.Sides(req.Rooms[0], skipped, true, Fx.Mm(1000), Fx.Mm(5));
            Assert.Eq(3, sides.Count);
            Assert.True(sides.Any(s => Mm(s.Length) == 6000 && s.HasNonWall && s.Walls.Count == 2));
            Assert.Eq(1, skipped.Count, "баруун тал");
            WePlan plan = Poly.Plan(req);
            Assert.True(plan.Notes.Any(n => n.Contains("хана биш хил")));
        }

        [Test]
        public static void Separation_line_behind_the_wall_face_is_covered_by_the_side_not_reported()
        {
            // Revit-ийн бодит хил (Revit 2027-д хэмжсэн): ханын завсрыг ТЭНХЛЭГ дээр тавьсан тусгаарлах шугам нүүрээс 100 мм ард —
            // хил: нүүр → 100 мм холбоос → шугам → холбоос → нүүр.  Тал завсрыг давж нэг дэлгээс болно; 3 «хана биш» хэсэг нь тэр
            // дэлгээст багтсан тул «дэлгээсгүй» гэж тайланд гарах ёсгүй.
            WeRequest req = Poly.Room(Poly.P(0, 0, 2500, 0, 2500, -100, 3500, -100, 3500, 0, 6000, 0, 6000, 4000, 0, 4000),
                                      new[] { "s1", Poly.Other, Poly.Other, Poly.Other, "s2", "e", "n", "w" });
            var skipped = new List<KeyValuePair<WeBoundarySegment, string>>();
            List<WeRoomSide> sides = RoomBoundaryAnalyzer.Sides(req.Rooms[0], skipped, true, Fx.Mm(1000), Fx.Mm(5));
            Assert.Eq(4, sides.Count);
            Assert.True(sides.Any(s => Mm(s.Length) == 6000 && s.HasNonWall && s.Walls.Count == 2), "урд тал завсрыг давсан");
            Assert.Eq(0, skipped.Count, "давсан хил тайланд гарахгүй");
            Assert.False(Poly.Plan(req).Notes.Any(n => n.Contains("хана биш хил")));
        }

        [Test]
        public static void Bridged_gap_on_a_side_without_walls_stays_reported()
        {
            // Хойд тал бүхэлдээ тусгаарлах шугам, дунд нь 300 мм-ийн ниш (мөн шугам) — хана ороогүй тул дэлгээс үүсэхгүй, бүх 5
            // хэсэг тайланд үлдэнэ (давсан завсрыг «хамарсан» гэж зөвхөн тал үүссэн үед тооцно).
            WeRequest req = Poly.Room(Poly.P(0, 0, 6000, 0, 6000, 4000, 4000, 4000, 4000, 4300, 3000, 4300, 3000, 4000, 0, 4000),
                                      new[] { "s", "e", Poly.Other, Poly.Other, Poly.Other, Poly.Other, Poly.Other, "w" });
            var skipped = new List<KeyValuePair<WeBoundarySegment, string>>();
            List<WeRoomSide> sides = RoomBoundaryAnalyzer.Sides(req.Rooms[0], skipped, true, Fx.Mm(1000), Fx.Mm(5));
            Assert.Eq(3, sides.Count);
            Assert.Eq(5, skipped.Count);
        }

        [Test]
        public static void Tiny_wall_segment_is_merged_or_rejected_never_crashes()
        {
            // 3 мм-ийн сегмент (Revit заримдаа өгдөг) нэг шулуун дээр — нэгтгэнэ.
            WeRequest req = Poly.Room(Poly.P(0, 0, 2000, 0, 2003, 0, 5000, 0, 5000, 4000, 0, 4000), new[] { "s1", "s2", "s3", "e", "n", "w" });
            WePlan plan = Poly.Plan(req);
            Assert.Eq(4, plan.Items.Count(i => i.Action == WeAction.Create));
            // Нэгтгэхгүй горимд 3 мм хана «хэт богино биш» (Revit-ийн доод хязгаараас урт) ч хүрээ гарна — унахгүй.
            WePlan off = Poly.Plan(req, s => s.MergeCollinear = false);
            Assert.Eq(6, off.Items.Count);
        }

        [Test]
        public static void Half_room_depth_cuts_through_the_middle_of_the_room()
        {
            WeRequest req = Fx.SquareRoom(5000, 4000);
            WePlan plan = WallElevationPlanner.Plan(req, Fx.Ctx());
            WePlannedElevation south = plan.Items.Single(i => i.Frame.Look.AlmostEquals(new WeV3(0, -1, 0), E));
            WePlannedElevation east = plan.Items.Single(i => i.Frame.Look.AlmostEquals(new WeV3(1, 0, 0), E));
            Assert.Eq(-2000.0, Mm(south.Box.Near), "4000 гүн өрөөний дунд");
            Assert.Eq(-2500.0, Mm(east.Box.Near), "5000 өргөн өрөөний дунд");
            // Дээд хязгаар.
            WePlannedElevation capped = WallElevationPlanner.Plan(req, Fx.Ctx(s => s.MaxDepthMm = 1200)).Items
                .Single(i => i.Frame.Look.AlmostEquals(new WeV3(0, -1, 0), E));
            Assert.Eq(-1200.0, Mm(capped.Box.Near));
        }

        [Test]
        public static void Depth_ray_hits_the_nearest_opposite_boundary()
        {
            WeRequest req = Poly.Room(Poly.P(0, 0, 6000, 0, 6000, 2500, 3500, 2500, 3500, 4000, 0, 4000));
            // Урд талын дунд хэсгээс дээш: x < 3500 → 4000, x > 3500 → 2500; 5 цэгийн медиан.
            double d = RoomBoundaryAnalyzer.DepthInFront(req.Rooms[0], Fx.P(0, 0), Fx.P(6000, 0), new WeV3(0, 1, 0));
            Assert.Eq(4000.0, Mm(d), "x = 600, 1800, 3000 → 4000; 4200, 5400 → 2500; медиан 4000");
        }

        [Test]
        public static void Merged_side_carries_openings_of_every_member_wall()
        {
            WeRequest req = Poly.Room(Poly.P(0, 0, 3000, 0, 7000, 0, 7000, 4000, 0, 4000), new[] { "s1", "s2", "e", "n", "w" });
            req.Sources.Levels.Add(new WeLevelInfo { Id = 1, Name = "L02", Z = 0 });
            req.Sources.Inserts.Add(new WeInsertInfo { Id = 91, Kind = WeInsertKind.Door, HostWallUid = "wall-s1", Center = Fx.P(1000, 0), HalfWidth = Fx.Mm(450), TopZ = Fx.Mm(2100) });
            req.Sources.Inserts.Add(new WeInsertInfo { Id = 92, Kind = WeInsertKind.Window, HostWallUid = "wall-s2", Center = Fx.P(5000, 0), HalfWidth = Fx.Mm(600), BottomZ = Fx.Mm(900), TopZ = Fx.Mm(2100) });
            WePlannedElevation south = Poly.Plan(req).Items.Single(i => i.WallUids.Count == 2);
            WeDimRow open = south.Annotation.Rows.Single(r => r.Group == WeDimGroup.Openings);
            Assert.SeqEq(new long[] { 92, 92, 91, 91 }, open.Refs.Where(r => r.Kind == WeRefKind.InsertLeft || r.Kind == WeRefKind.InsertRight).Select(r => r.ElementId),
                "хоёр ханын нүх нэг эгнээнд (харахад баруун = −X)");
            Assert.Eq(2, south.Annotation.Spots.Count(sp => sp.Target.ElementId == 92), "цонх доод + дээд");
            Assert.Eq(1, south.Annotation.Spots.Count(sp => sp.Target.ElementId == 91), "хаалга зөвхөн дээд");
            WeCensusEntry walls = south.Annotation.Census.Single(c => c.CategoryKey == WeAnno.Walls);
            Assert.Eq(2, walls.Count, "талын 2 хана танигдсан");
        }

        [Test]
        public static void Rerun_after_merge_reports_absorbed_wall_views_as_orphans_not_deleted()
        {
            WeRequest req = Poly.Room(Poly.P(0, 0, 3000, 0, 7000, 0, 7000, 4000, 0, 4000), new[] { "s1", "s2", "e", "n", "w" });
            WePlan old = Poly.Plan(req, s => s.MergeCollinear = false);
            req.Existing = Fx.AsExisting(old);
            WePlan now = Poly.Plan(req);
            WeOrphan o = now.Orphans.Single();
            Assert.True(o.Reason.Contains("нэгдсэн"), o.Reason);
            WePlannedElevation south = now.Items.Single(i => i.WallUid == "wall-s2");
            Assert.Eq(WeAction.Update, south.Action);
            Assert.True(south.ActionNote.StartsWith("Геометр"), "зангуу ханын дэлгээс уртасна: " + south.ActionNote);
            // Үсэг шилжсэн тал зөвхөн нэрээ шинэчилнэ (хүрээ хөдлөхгүй); бусад хэвээр.
            Assert.True(now.Items.Where(i => i != south).All(i => i.Action == WeAction.Keep || i.ActionNote == "Нэр шинэчлэгдэнэ"));
            Assert.Eq(0, now.Items.Count(i => i.Action == WeAction.Create), "шинэ харагдац үүсгэхгүй");
        }
    }
}
