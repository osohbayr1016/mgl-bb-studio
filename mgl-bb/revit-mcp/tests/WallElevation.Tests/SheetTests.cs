using System;
using System.Collections.Generic;
using System.Linq;
using RevitMcpAddin.WallElevation.Core;

namespace RevitMcpAddin.WallElevation.Tests
{
    /// <summary>Хуудасны блокууд: түлхүүр план, 3D axon, хуудасны зохиомж, тэмдэг/нэр.</summary>
    public static class SheetTests
    {
        private const double E = 1e-6;

        private static double Mm(double ft) { return Math.Round(ft * WeFixedUnits.MmPerFoot, 1); }

        private static WePlan SheetPlan(WeRequest req, Action<WeSettings> tweak = null)
        {
            // Бичвэр тэмдгийн байрлалын тестүүд 1:100, захын зай 1500-аар (өгөгдмөл 2026-10-07-нөөс 1:50, 900 мм — жишээ хуудас).
            return WallElevationPlanner.Plan(req, Fx.Ctx(s => { s.Output = WeOutputMode.ViewsAndSheets; s.KeyPlanScale = 100; s.KeyPlanMarginMm = 1500; if (tweak != null) tweak(s); }));
        }

        /// <summary>Цэг олон өнцөгтийн дотор уу (ray casting, план).</summary>
        private static bool Inside(WeV3 p, WeRoomLoop loop)
        {
            bool inside = false;
            foreach (WeBoundarySegment s in loop.Segments)
            {
                WeV3 a = s.A, b = s.B;
                if ((a.Y > p.Y) != (b.Y > p.Y) && p.X < (b.X - a.X) * (p.Y - a.Y) / (b.Y - a.Y) + a.X) inside = !inside;
            }
            return inside;
        }

        // ── Тэмдэг, нэр ─────────────────────────────────────────────

        [Test]
        public static void Labels_follow_the_room_number_and_letter()
        {
            WePlan plan = SheetPlan(Fx.SquareRoom(5000, 4000, number: "205"));
            Assert.SeqEq(new[] { "205A", "205B", "205C", "205D" }, plan.Items.Select(i => i.Label));
            Assert.SeqEq(new[] { 1, 2, 3, 4 }, plan.Items.Select(i => i.SideIndex));
            WeGroupInfo g = plan.Groups.Single();
            Assert.Eq("A-D", g.SideRange);
            Assert.Eq("205A-D", g.Label);
        }

        [Test]
        public static void Name_tokens_room_number_wall_index_and_side_range()
        {
            WePlan plan = WallElevationPlanner.Plan(Fx.SquareRoom(5000, 4000, number: "205"),
                Fx.Ctx(s => { s.NamePattern = "{RoomNumber}-{WallIndex} ({SideRange})"; s.LabelPattern = "{RoomName}-{Side}"; }));
            Assert.SeqEq(new[] { "205-1 (A-D)", "205-2 (A-D)", "205-3 (A-D)", "205-4 (A-D)" }, plan.Items.Select(i => i.Name));
            Assert.Eq("Office-A", plan.Items[0].Label);
            Assert.Eq(0, new WeSettings { NamePattern = "{RoomNumber}{Side}", SheetNamePattern = "{Room} {SideRange}" }.Validate().Count);
            Assert.Eq("A-F", WeNaming.SideRange(new[] { "C", "A", "F", "?", "B" }));
            Assert.Eq("AA", WeNaming.SideRange(new[] { "AA" }));
            Assert.Eq("Z-AB", WeNaming.SideRange(new[] { "AB", "Z", "AA" }), "урт үсэг хойно");
        }

        [Test]
        public static void Groups_exist_only_in_sheet_mode_and_for_rooms()
        {
            WeRequest req = Fx.SquareRoom(5000, 4000);
            req.Walls.Add(Fx.Wall(Fx.P(0, 9000), Fx.P(4000, 9000), new WeV3(0, -1, 0)));
            Assert.Eq(0, WallElevationPlanner.Plan(req, Fx.Ctx()).Groups.Count, "зөвхөн харагдац горимд блокгүй");
            WePlan plan = SheetPlan(req);
            Assert.Eq(1, plan.Groups.Count, "хана горимын бүлэгт түлхүүр план/3D байхгүй");
            Assert.NotNull(plan.Groups[0].KeyPlan);
            Assert.NotNull(plan.Groups[0].Axon);
            Assert.Eq(0, SheetPlan(req, s => { s.KeyPlan = false; s.Axon = false; }).Groups.Count);
            Assert.Null(SheetPlan(req, s => s.Axon = false).Groups[0].Axon);
        }

        // ── Түлхүүр план ─────────────────────────────────────────────

        [Test]
        public static void Key_plan_has_one_marker_per_side_inside_the_room()
        {
            WeRequest req = Poly.Room(Poly.P(0, 0, 7000, 0, 7000, 11775, 0, 11775), number: "205");
            WePlan plan = SheetPlan(req);
            WeKeyPlan kp = plan.Groups.Single().KeyPlan;
            Assert.Eq("key|room:room-205", kp.Key);
            Assert.Eq(4, kp.Markers.Count);
            Assert.SeqEq(plan.Items.Select(i => i.Label).OrderBy(x => x), kp.Markers.Select(m => m.Label).OrderBy(x => x));
            WeRoomLoop loop = req.Rooms[0].Loops[0];
            foreach (WeKeyMarker m in kp.Markers)
            {
                Assert.True(Inside(m.LabelAt, loop), m.Label + " өрөөний дотор");
                Assert.True((m.LabelAt - m.Target).Normalized().AlmostEquals(-m.Look, 1e-6), m.Label + " ханаас дотогш");
                Assert.Eq(1000.0, Mm((m.LabelAt - m.Target).Length), "1:100 × 10 мм");
            }
            // Хүрээ = өрөө + 1500 мм.
            Assert.Eq(-1500.0, Mm(kp.MinX));
            Assert.Eq(8500.0, Mm(kp.MaxX));
            Assert.Eq(13275.0, Mm(kp.MaxY));
            Assert.Eq(100, kp.Scale);
        }

        [Test]
        public static void Key_plan_markers_stay_inside_a_narrow_room_and_do_not_overlap()
        {
            // 1200 өргөн коридор: тэмдгийн зай өрөөний гүний 35 %; урд/хойд хоёр тэмдэг давхцахгүй.
            WeRequest req = Poly.Room(Poly.P(0, 0, 9000, 0, 9000, 1200, 0, 1200), number: "C1");
            WeKeyPlan kp = SheetPlan(req).Groups.Single().KeyPlan;
            Func<double, double> paper = mm => Fx.Mm(mm * 100);
            foreach (WeKeyMarker m in kp.Markers)
                Assert.True(Inside(m.LabelAt, req.Rooms[0].Loops[0]), m.Label);
            for (int i = 0; i < kp.Markers.Count; i++)
                for (int j = i + 1; j < kp.Markers.Count; j++)
                    Assert.False(WeKeyPlanner.Overlap(kp.Markers[i], kp.Markers[j], paper), kp.Markers[i].Label + " ↔ " + kp.Markers[j].Label);
        }

        [Test]
        public static void Key_plan_handles_an_angled_irregular_room()
        {
            WeRequest req = Poly.Room(Poly.P(0, 0, 6000, 0, 6000, 2500, 3500, 5000, 0, 5000), number: "206");
            WePlan plan = SheetPlan(req);
            WeKeyPlan kp = plan.Groups.Single().KeyPlan;
            Assert.Eq(5, kp.Markers.Count, "5 тал (налуу хана орно)");
            foreach (WeKeyMarker m in kp.Markers) Assert.True(Inside(m.LabelAt, req.Rooms[0].Loops[0]), m.Label);
        }

        [Test]
        public static void Key_plan_markers_of_an_L_room_stay_inside_and_apart()
        {
            // Revit дээр хэмжсэн (2026-10-06): L өрөөний нарийн далавчинд 2 тэмдэг давхцаж, шилжүүлэхэд хананы гадна гарсан.
            WeRequest req = Poly.Room(Poly.P(0, 0, 4000, 0, 8000, 0, 8000, 3000, 5000, 3000, 5000, 6000, 0, 6000),
                                      new[] { "s1", "s2", "e", "n1", "e2", "n2", "w" }, number: "205");
            WeKeyPlan kp = SheetPlan(req).Groups.Single().KeyPlan;
            Assert.Eq(6, kp.Markers.Count);
            Func<double, double> paper = mm => Fx.Mm(mm * 100);
            foreach (WeKeyMarker m in kp.Markers)
            {
                WeV3 h = WeKeyPlanner.HalfSize(m.Label, paper) * 0.9;
                foreach (WeV3 c in new[] { new WeV3(-h.X, -h.Y, 0), new WeV3(h.X, -h.Y, 0), new WeV3(h.X, h.Y, 0), new WeV3(-h.X, h.Y, 0) })
                    Assert.True(WeKeyPlanner.InsideRoom(req.Rooms[0], m.LabelAt + c), m.Label + " хайрцаг өрөөний дотор");
            }
            for (int i = 0; i < kp.Markers.Count; i++)
                for (int j = i + 1; j < kp.Markers.Count; j++)
                    Assert.False(WeKeyPlanner.Overlap(kp.Markers[i], kp.Markers[j], paper), kp.Markers[i].Label + " ↔ " + kp.Markers[j].Label);
        }

        // ── 3D axon ─────────────────────────────────────────────────

        [Test]
        public static void Axon_box_follows_the_longest_wall_cuts_near_walls_and_ceiling()
        {
            WeRequest req = Poly.Room(Poly.P(0, 0, 7000, 0, 7000, 11775, 0, 11775), number: "205");
            req.Sources.Slabs.Add(new WeSlabInfo { Id = 1, Kind = WeSlabKind.Ceiling, Min = Fx.P(-100, -100, 2700), Max = Fx.P(7100, 11900, 2720) });
            req.Sources.Slabs.Add(new WeSlabInfo { Id = 2, Kind = WeSlabKind.Ceiling, Min = Fx.P(20000, 0, 2400), Max = Fx.P(25000, 5000, 2420) });
            WeAxonPlan ap = SheetPlan(req).Groups.Single().Axon;
            Assert.Eq("axon|room:room-205", ap.Key);
            Assert.True(Math.Abs(Math.Abs(ap.AxisX.Y) - 1) < E, "урт тал (11775) Y тэнхлэгийн дагуу: " + ap.AxisX);
            Assert.Eq(2650.0, Mm(ap.MaxZ), "таазнаас 50 мм доор (хөрш өрөөний тааз биш)");
            Assert.Eq(-200.0, Mm(ap.MinZ));
            // Харагч тал 5 мм дотогш, цаад тал хана + 150.
            double widthX = Mm(ap.MaxX - ap.MinX), widthY = Mm(ap.MaxY - ap.MinY);
            Assert.Eq(11775 - 5 + 200 + 150.0, widthX);
            Assert.Eq(7000 - 5 + 200 + 150.0, widthY);
            Assert.True(ap.Forward.Z < -0.5 && Math.Abs(ap.Forward.Length - 1) < E, "доош харна");
            Assert.True(Math.Abs(ap.Up.Dot(ap.Forward)) < E && ap.Up.Z > 0, "дээш ⟂ харах");
            Assert.Eq(8, ap.Corners().Count());
            WeV3 center = ap.Corners().Aggregate(WeV3.Zero, (a, b) => a + b) * (1.0 / 8);
            Assert.True((center - ap.Eye).Normalized().AlmostEquals(ap.Forward, 1e-6), "нүднээс төв рүү");
        }

        [Test]
        public static void Axon_frame_rotates_with_the_room_and_is_independent_of_loop_winding()
        {
            double r = Math.PI / 6, c = Math.Cos(r), s = Math.Sin(r);
            Func<double, double, double[]> rot = (x, y) => new[] { x * c - y * s, x * s + y * c };
            var pts = new[] { rot(0, 0), rot(6000, 0), rot(6000, 4000), rot(0, 4000) };
            WeRequest ccw = Poly.Room(pts);
            WeRequest cw = Poly.Room(pts.Reverse().ToArray());
            WeAxonPlan a = SheetPlan(ccw).Groups.Single().Axon, b = SheetPlan(cw).Groups.Single().Axon;
            Assert.True(Math.Abs(Math.Abs(a.AxisX.Dot(new WeV3(c, s, 0))) - 1) < 1e-9, "30° эргэлт");
            Assert.True(a.AxisX.AlmostEquals(b.AxisX, 1e-9), "контурын чиглэлээс үл хамаарна");
            Assert.Eq(Mm(a.MaxX - a.MinX), Mm(b.MaxX - b.MinX));
        }

        [Test]
        public static void Axon_without_ceiling_cuts_below_the_room_top()
        {
            WeRequest req = Fx.SquareRoom(5000, 4000);
            req.Rooms[0].TopZ = Fx.Mm(3600);
            WeAxonPlan ap = SheetPlan(req).Groups.Single().Axon;
            Assert.Eq(3300.0, Mm(ap.MaxZ), "дээд давхрын хавтангаас 300 мм доор");
        }

        // ── Хуудасны зохиомж ─────────────────────────────────────────

        private static List<WeComposeItem> Items(int elevations, bool key = true, bool axon = true, int placeholders = 0, bool legend = false)
        {
            var list = new List<WeComposeItem>();
            if (key) list.Add(new WeComposeItem(WeComposeKind.KeyPlan, Fx.Mm(150), Fx.Mm(160)));
            if (axon) list.Add(new WeComposeItem(WeComposeKind.Axon, Fx.Mm(170), Fx.Mm(140)));
            if (legend) list.Add(new WeComposeItem(WeComposeKind.Legend, Fx.Mm(120), Fx.Mm(60)));
            for (int i = 0; i < elevations; i++) list.Add(new WeComposeItem(WeComposeKind.Elevation, Fx.Mm(i % 3 == 0 ? 240 : 110), Fx.Mm(95)));
            for (int i = 0; i < placeholders; i++) list.Add(new WeComposeItem(WeComposeKind.Placeholder, Fx.Mm(180), Fx.Mm(120)));
            return list;
        }

        private static void AssertSane(List<WeComposeItem> items, List<WeSheetSlot> slots, double x0, double y0, double x1, double y1)
        {
            Assert.Eq(items.Count, slots.Count, "блок бүр байрлалтай");
            for (int i = 0; i < slots.Count; i++)
            {
                WeSheetSlot s = slots[i];
                WeComposeItem it = items[s.Index];
                if (!s.Oversize)
                {
                    Assert.True(s.CenterX - it.W / 2 >= x0 - 1e-9 && s.CenterX + it.W / 2 <= x1 + 1e-9, "x хүрээнд " + it.Kind + " #" + s.Index);
                    Assert.True(s.CenterY - it.H / 2 >= y0 - 1e-9 && s.CenterY + it.H / 2 <= y1 + 1e-9, "y хүрээнд " + it.Kind + " #" + s.Index);
                }
                for (int j = i + 1; j < slots.Count; j++)
                    Assert.False(WeSheetLayout.Overlaps(s, new WeV3(it.W, it.H, 0), slots[j], new WeV3(items[slots[j].Index].W, items[slots[j].Index].H, 0)),
                        "давхцал #" + s.Index + " ↔ #" + slots[j].Index);
            }
        }

        [Test]
        public static void Composer_puts_key_plan_top_left_axon_below_and_elevations_to_the_right()
        {
            // A1 ажлын талбай ≈ 800 × 500 мм.
            double x0 = 0, y0 = 0, x1 = Fx.Mm(800), y1 = Fx.Mm(500), gap = Fx.Mm(10);
            List<WeComposeItem> items = Items(6, placeholders: 2);
            List<WeSheetSlot> slots = WeSheetComposer.Compose(items, x0, y0, x1, y1, gap);
            AssertSane(items, slots, x0, y0, x1, y1);
            WeSheetSlot key = slots[0], axon = slots[1];
            Assert.Eq(0, key.Page);
            Assert.True(Math.Abs(key.CenterX - Fx.Mm(75)) < 1e-9 && Math.Abs(key.CenterY - Fx.Mm(500 - 80)) < 1e-9, "түлхүүр зүүн дээд буланд");
            Assert.True(Math.Abs(axon.CenterX - Fx.Mm(85)) < 1e-9 && axon.CenterY < key.CenterY && axon.Page == 0, "3D түлхүүрийн доор");
            double colRight = Fx.Mm(170);
            foreach (WeSheetSlot s in slots.Where(s => items[s.Index].Kind == WeComposeKind.Elevation && s.Page == 0))
                Assert.True(s.CenterX - items[s.Index].W / 2 >= colRight + gap - 1e-9, "дэлгээс баганын баруун талд");
            // Дарааллаа хадгална: дэлгээс i нь i+1-ээс өмнө (хуудас, мөр, x).
            List<WeSheetSlot> elev = slots.Where(s => items[s.Index].Kind == WeComposeKind.Elevation).ToList();
            for (int i = 1; i < elev.Count; i++)
            {
                WeSheetSlot a = elev[i - 1], b = elev[i];
                Assert.True(a.Page < b.Page || a.Page == b.Page && (a.CenterY - b.CenterY > 1e-9 || Math.Abs(a.CenterY - b.CenterY) < 1e-9 && a.CenterX < b.CenterX)
                            || a.Page == b.Page && b.CenterX < colRight, "дараалал #" + i);
            }
            Assert.True(slots.Where(s => items[s.Index].Kind == WeComposeKind.Placeholder).All(p => elev.All(e => p.Page > e.Page || p.CenterY <= e.CenterY + 1e-9)), "перспектив дэлгээсүүдийн дараа");
        }

        [Test]
        public static void Composer_places_several_legends_column_first_then_flow_without_overlap()
        {
            // 2026-10-14 (интерьерийн баг): олон legend — баганад багтсан нь түлхүүр планы доор, бусад нь урсгалд; давхцалгүй.
            double x1 = Fx.Mm(800), y1 = Fx.Mm(500), gap = Fx.Mm(10);
            List<WeComposeItem> items = Items(5, axon: false, placeholders: 1);
            items.Insert(1, new WeComposeItem(WeComposeKind.Legend, Fx.Mm(120), Fx.Mm(60)));
            items.Insert(2, new WeComposeItem(WeComposeKind.Legend, Fx.Mm(140), Fx.Mm(80)));
            items.Insert(3, new WeComposeItem(WeComposeKind.Legend, Fx.Mm(100), Fx.Mm(300)));
            List<WeSheetSlot> slots = WeSheetComposer.Compose(items, 0, 0, x1, y1, gap);
            AssertSane(items, slots, 0, 0, x1, y1);
            WeSheetSlot key = slots.Single(s => s.Index == 0);
            WeSheetSlot l1 = slots.Single(s => s.Index == 1), l2 = slots.Single(s => s.Index == 2), l3 = slots.Single(s => s.Index == 3);
            Assert.True(l1.CenterY < key.CenterY && l2.CenterY < l1.CenterY, "эхний хоёр legend түлхүүр планы доор, дарааллаар");
            Assert.True(Math.Abs(l1.CenterX - Fx.Mm(60)) < 1e-9 && Math.Abs(l2.CenterX - Fx.Mm(70)) < 1e-9, "зүүн баганад");
            Assert.True(l3.CenterX - Fx.Mm(50) > Fx.Mm(150) || l3.Page > 0, "өндөр legend баганад багтахгүй — урсгалд");
        }

        [Test]
        public static void Composer_puts_render_placeholders_on_the_bottom_row_when_there_is_room()
        {
            // Жишээ хуудас: рендерүүд хуудасны доод мөрөнд, дэлгээсүүдээс доош сул зайд.
            double x1 = Fx.Mm(1000), y1 = Fx.Mm(700), gap = Fx.Mm(10);
            List<WeComposeItem> items = Items(4, placeholders: 2);
            List<WeSheetSlot> slots = WeSheetComposer.Compose(items, 0, 0, x1, y1, gap);
            AssertSane(items, slots, 0, 0, x1, y1);
            List<WeSheetSlot> ph = slots.Where(s => items[s.Index].Kind == WeComposeKind.Placeholder).ToList();
            Assert.True(ph.All(p => p.Page == 0 && Math.Abs(p.CenterY - items[p.Index].H / 2) < 1e-9), "рендер хуудасны доод ирмэгт");
            Assert.True(ph[0].CenterX < ph[1].CenterX, "зүүнээс баруун");
            Assert.True(slots.Where(s => items[s.Index].Kind == WeComposeKind.Elevation).All(e => e.CenterY > ph[0].CenterY), "дэлгээс рендерийн дээр");

            // Сул зай хангалтгүй (жижиг талбай) — ердийн урсгал, давхцалгүй.
            double sy1 = Fx.Mm(330);
            List<WeSheetSlot> tight = WeSheetComposer.Compose(items, 0, 0, Fx.Mm(800), sy1, gap);
            AssertSane(items, tight, 0, 0, Fx.Mm(800), sy1);
        }

        [Test]
        public static void Composer_aligns_the_floor_line_of_elevations_in_a_row()
        {
            // Жишээ хуудас 206A-G: нэг мөрийн дэлгээсүүдийн давхрын шал нэг шулуун дээр.  Блок бүр дээр нь өөр хэмжээний бичвэр (материалын
            // тэмдэглэл, гарчиг) — дээд захаар тэгшилбэл шал зөрнө.
            double x1 = Fx.Mm(800), y1 = Fx.Mm(500), gap = Fx.Mm(10);
            var items = new List<WeComposeItem>
            {
                new WeComposeItem(WeComposeKind.KeyPlan, Fx.Mm(150), Fx.Mm(160)),
                new WeComposeItem(WeComposeKind.Elevation, Fx.Mm(140), Fx.Mm(120)) { Base = Fx.Mm(100) },
                new WeComposeItem(WeComposeKind.Elevation, Fx.Mm(120), Fx.Mm(110)) { Base = Fx.Mm(80) },
                new WeComposeItem(WeComposeKind.Elevation, Fx.Mm(130), Fx.Mm(140)) { Base = Fx.Mm(115) },
                new WeComposeItem(WeComposeKind.Elevation, Fx.Mm(200), Fx.Mm(100)) { Base = Fx.Mm(70) },
                new WeComposeItem(WeComposeKind.Elevation, Fx.Mm(200), Fx.Mm(90)) { Base = Fx.Mm(75) },
            };
            List<WeSheetSlot> slots = WeSheetComposer.Compose(items, 0, 0, x1, y1, gap);
            AssertSane(items, slots, 0, 0, x1, y1);
            Func<WeSheetSlot, double> floor = s => s.CenterY + items[s.Index].H / 2 - items[s.Index].Base;
            var rows = slots.Where(s => items[s.Index].Kind == WeComposeKind.Elevation)
                            .GroupBy(s => Math.Round(floor(s) / Fx.Mm(1)))
                            .ToList();
            // Шал нэг шулуун дээр байгаа мөр бүрт ≥ 2 дэлгээс (эхний 3 нь нэг мөрөнд багтана).
            Assert.True(rows.Count >= 1 && rows.Count < 5, "мөр бүрт шал нэг шулуун дээр (мөрийн тоо " + rows.Count + ")");
            List<WeSheetSlot> first = slots.Where(s => s.Index >= 1 && s.Index <= 3).ToList();
            Assert.True(first.All(s => Math.Abs(floor(s) - floor(first[0])) < 1e-9), "эхний мөрийн 3 дэлгээсийн шал ижил");
            // Мөрийн хамгийн өндөр «дээд хэсэг» (115) дээд захад тулна.
            Assert.True(Math.Abs(floor(first[0]) - (y1 - Fx.Mm(115))) < 1e-9, "шал = дээд хил − хамгийн их дээд хэсэг");
            // Тэгшлэхгүй (Base = NaN) бол өмнөх зан төлөв — дээд захаар.
            var plain = items.Select(i => new WeComposeItem(i.Kind, i.W, i.H)).ToList();
            List<WeSheetSlot> ps = WeSheetComposer.Compose(plain, 0, 0, x1, y1, gap);
            AssertSane(plain, ps, 0, 0, x1, y1);
            Assert.True(Math.Abs(ps[1].CenterY + plain[1].H / 2 - y1) < 1e-9 && Math.Abs(ps[2].CenterY + plain[2].H / 2 - y1) < 1e-9, "дээд захаар");
        }

        [Test]
        public static void Composer_flows_many_elevations_onto_continuation_pages()
        {
            double x1 = Fx.Mm(800), y1 = Fx.Mm(500), gap = Fx.Mm(10);
            for (int n = 1; n <= 24; n += 5)
            {
                List<WeComposeItem> items = Items(n);
                List<WeSheetSlot> slots = WeSheetComposer.Compose(items, 0, 0, x1, y1, gap);
                AssertSane(items, slots, 0, 0, x1, y1);
                Assert.True(slots.All(s => !s.Oversize), "n = " + n);
            }
            List<WeSheetSlot> many = WeSheetComposer.Compose(Items(24), 0, 0, x1, y1, gap);
            Assert.True(many.Max(s => s.Page) >= 1, "24 дэлгээс нэг хуудсанд багтахгүй");
        }

        [Test]
        public static void Composer_without_key_plan_or_with_a_huge_one_uses_the_full_width()
        {
            double x1 = Fx.Mm(800), y1 = Fx.Mm(500), gap = Fx.Mm(10);
            List<WeComposeItem> noKey = Items(3, key: false, axon: false);
            List<WeSheetSlot> s1 = WeSheetComposer.Compose(noKey, 0, 0, x1, y1, gap);
            Assert.True(Math.Abs(s1[0].CenterX - noKey[0].W / 2) < 1e-9, "эхний дэлгээс зүүн захаас");
            var huge = Items(3, axon: false);
            huge[0].W = Fx.Mm(500);
            List<WeSheetSlot> s2 = WeSheetComposer.Compose(huge, 0, 0, x1, y1, gap);
            AssertSane(huge, s2, 0, 0, x1, y1);
            Assert.True(Math.Abs(s2[0].CenterY - (y1 - huge[0].H / 2)) < 1e-9, "том түлхүүр план — урсгалын эхэнд");
        }

        [Test]
        public static void Composer_gives_an_oversize_block_its_own_page()
        {
            double x1 = Fx.Mm(800), y1 = Fx.Mm(500), gap = Fx.Mm(10);
            List<WeComposeItem> items = Items(3);
            items.Insert(3, new WeComposeItem(WeComposeKind.Elevation, Fx.Mm(1200), Fx.Mm(100)));
            List<WeSheetSlot> slots = WeSheetComposer.Compose(items, 0, 0, x1, y1, gap);
            WeSheetSlot big = slots.Single(s => s.Oversize);
            Assert.True(slots.Where(s => s != big).All(s => s.Page != big.Page), "том блок ганцаараа");
            AssertSane(items, slots, 0, 0, x1, y1);
        }

        [Test]
        public static void Composer_legend_and_placeholders_never_overlap_with_tall_columns()
        {
            double x1 = Fx.Mm(594), y1 = Fx.Mm(380), gap = Fx.Mm(8);   // A2
            List<WeComposeItem> items = Items(8, legend: true, placeholders: 3);
            List<WeSheetSlot> slots = WeSheetComposer.Compose(items, 0, 0, x1, y1, gap);
            AssertSane(items, slots, 0, 0, x1, y1);
        }
    
        private static double[] Seg(double x1, double y1, double x2, double y2) { return new[] { x1, y1, x2, y2 }; }

        private static List<double[]> Rect(double x0, double y0, double x1, double y1)
        {
            return new List<double[]> { Seg(x0, y0, x1, y0), Seg(x1, y0, x1, y1), Seg(x1, y1, x0, y1), Seg(x0, y1, x0, y0) };
        }

        [Test]
        public static void Sheet_frame_excludes_the_right_info_band_and_bottom_strip()
        {
            // «E1 30 x 42 Horizontal» хэлбэр: гадна хүрээ, дотор хүрээ, баруун зурвас 943..1078 (лого, хүснэгт — богино шугамууд).
            var segs = Rect(0, 0, 1100, 785);
            segs.AddRange(Rect(38, 20, 1078, 765));
            segs.Add(Seg(943, 20, 943, 400));          // зурвасын хил ХОЁР хэсгээр зурсан
            segs.Add(Seg(943, 400, 943, 765));
            for (int y = 60; y < 760; y += 40) segs.Add(Seg(943, y, 1078, y));   // зурвасын нүднүүд
            segs.Add(Seg(1000, 60, 1000, 300));        // зурвас доторх богино босоо
            double[] r = WeSheetFrame.Drawable(segs, 0, 0, 1100, 785);
            Assert.SeqEq(new double[] { 38, 20, 943, 765 }, r, "баруун зурвас хасагдсан");

            // Доод тууз (хэвтээ title strip) — бүтэн өргөнтэй шугам.
            var strip = Rect(0, 0, 1000, 700);
            strip.Add(Seg(0, 90, 1000, 90));
            for (int x = 100; x < 1000; x += 150) strip.Add(Seg(x, 0, x, 90));
            Assert.SeqEq(new double[] { 0, 90, 1000, 700 }, WeSheetFrame.Drawable(strip, 0, 0, 1000, 700), "доод тууз хасагдсан");
        }

        [Test]
        public static void Sheet_frame_falls_back_to_the_box_without_usable_lines()
        {
            Assert.SeqEq(new double[] { 0, 0, 100, 50 }, WeSheetFrame.Drawable(new List<double[]>(), 0, 0, 100, 50), "шугамгүй → bbox");
            // Дунд нь зурсан ганц босоо шугам талбайг хоёр хуваахгүй.
            var mid = Rect(0, 0, 100, 50);
            mid.Add(Seg(50, 0, 50, 50));
            mid.Add(Seg(48, 0, 48, 50));
            double[] r = WeSheetFrame.Drawable(mid, 0, 0, 100, 50);
            Assert.True(r[2] - r[0] >= 50 - E, "өргөн ≥ 50 %");
            // Налуу, богино шугам үл тоогдоно.
            var diag = Rect(0, 0, 100, 50);
            diag.Add(Seg(10, 0, 90, 50));
            diag.Add(Seg(80, 0, 80, 20));
            Assert.SeqEq(new double[] { 0, 0, 100, 50 }, WeSheetFrame.Drawable(diag, 0, 0, 100, 50));
        }

        [Test]
        public static void Sheet_frame_trims_title_block_obstacles_from_the_cheapest_side()
        {
            // GATEWAY «Булангын хүснэгт»: доод бүтэн зурвас (тайлбар + бичээс) nested family-д — шугамаар танигдахгүй, саадаар.
            double[] frame = { 20, 10, 584, 410 };
            var band = new List<double[]> { new double[] { 22, 10, 300, 46 }, new double[] { 300, 10, 584, 52 } };
            Assert.SeqEq(new double[] { 20, 52, 584, 410 }, WeSheetFrame.AvoidObstacles(frame, band, 1), "доод зурвас хасагдсан");

            // Баруун доод буланд жижиг бичээс 185×55 — доороос тайрах (564×55) нь баруунаас (185×400)-аас бага алдагдал.
            Assert.SeqEq(new double[] { 20, 65, 584, 410 }, WeSheetFrame.AvoidObstacles(frame, new List<double[]> { new double[] { 399, 10, 584, 65 } }, 1));

            // Баруун талын өндөр багана (лого, хүснэгт) — баруунаас.
            Assert.SeqEq(new double[] { 20, 10, 450, 410 }, WeSheetFrame.AvoidObstacles(frame, new List<double[]> { new double[] { 450, 10, 584, 410 } }, 1));

            // Бүсийн тэмдэглэгээний зураасны бүлэг (бүтэн өндөр, 3 мм) — үл тооно; тэр нь хажууд нь байсан ч бичээсийг хасна.
            var ticks = new List<double[]> { new double[] { 244, -12, 247, 475 }, new double[] { -10, 108, 700, 112 }, new double[] { 330, 7, 581, 48 } };
            Assert.SeqEq(new double[] { 20, 48, 584, 410 }, WeSheetFrame.AvoidObstacles(frame, ticks, 1), "зураасны туузыг үл тоож, бичээсийг хассан");

            // Хүрээг бүхэлд нь хамарсан дүүргэлт, 1 мм-ээс жижиг цэг — үл тооно.
            Assert.SeqEq(frame, WeSheetFrame.AvoidObstacles(frame, new List<double[]> { new double[] { 0, 0, 600, 420 }, new double[] { 100, 100, 100.5, 100.5 } }, 1));
        }

        [Test]
        public static void Composer_shrinks_renders_into_the_free_bottom_strip_and_never_opens_a_page_for_them()
        {
            double x1 = Fx.Mm(800), y1 = Fx.Mm(400), gap = Fx.Mm(10);
            List<WeComposeItem> items = Items(6, placeholders: 3);
            List<WeSheetSlot> slots = WeSheetComposer.Compose(items, 0, 0, x1, y1, gap, Fx.Mm(55));
            List<WeSheetSlot> ph = slots.Where(s => items[s.Index].Kind == WeComposeKind.Placeholder).ToList();
            Assert.Eq(3, ph.Count, "3 рендер");
            foreach (WeSheetSlot p in ph)
            {
                double w = p.W > 0 ? p.W : items[p.Index].W, h = p.H > 0 ? p.H : items[p.Index].H;
                Assert.True(h >= Fx.Mm(55) - 1e-9 && h <= items[p.Index].H + 1e-9, "өндөр 55 мм ба бүтэн хэмжээний хооронд");
                Assert.True(Math.Abs(p.CenterY - h / 2) < 1e-9 && p.Page == 0, "доод ирмэгт, эхний хуудсанд");
                foreach (WeSheetSlot o in slots.Where(o => o != p && o.Page == p.Page))
                {
                    double ow = o.W > 0 ? o.W : items[o.Index].W, oh = o.H > 0 ? o.H : items[o.Index].H;
                    bool overlap = Math.Abs(o.CenterX - p.CenterX) < (ow + w) / 2 - 1e-9 && Math.Abs(o.CenterY - p.CenterY) < (oh + h) / 2 - 1e-9;
                    Assert.False(overlap, "рендер давхцахгүй #" + p.Index + " ↔ #" + o.Index);
                }
            }

            // Багтах зай огт байхгүй (жижиг хуудас, олон дэлгээс) — рендерийн төлөө шинэ хуудас үүсэхгүй.
            List<WeComposeItem> many = Items(4, placeholders: 2);
            List<WeSheetSlot> s2 = WeSheetComposer.Compose(many, 0, 0, Fx.Mm(420), Fx.Mm(297), gap, Fx.Mm(55));
            int lastOther = s2.Where(s => many[s.Index].Kind != WeComposeKind.Placeholder).Max(s => s.Page);
            Assert.True(s2.Where(s => many[s.Index].Kind == WeComposeKind.Placeholder).All(s => s.Page <= lastOther), "рендер зөвхөн байгаа хуудсанд");
        }
}
}
