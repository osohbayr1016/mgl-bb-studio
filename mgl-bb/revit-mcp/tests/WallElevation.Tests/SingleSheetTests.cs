using System;
using System.Collections.Generic;
using System.Linq;
using RevitMcpAddin.WallElevation.Core;

namespace RevitMcpAddin.WallElevation.Tests
{
    /// <summary>
    /// W02 (2026-10-16): «Бүх дэлгээс НЭГ хуудсанд, дөрвөн бүс» — <see cref="WeSingleSheet"/>.  Шаардлага: хэзээ ч үргэлжлэлийн хуудас биш, ямар ч
    /// блок хаягдахгүй, масштаб/хэмжээ өөрчлөгдөхгүй, багтахгүй нь харагдахуйц шилжүүлсэн овоолго эсвэл хуудасны баруун талд.
    /// </summary>
    public static class SingleSheetTests
    {
        private static double Mm(double v) { return Fx.Mm(v); }

        /// <summary>A2-ийн ойролцоо зурах талбай 560 × 380 мм, гадна хүрээ 594 × 420.</summary>
        private static WeSheetArea A2()
        {
            return new WeSheetArea { MinX = Mm(20), MinY = Mm(20), MaxX = Mm(580), MaxY = Mm(400), OuterMaxX = Mm(594), OuterMaxY = Mm(420) };
        }

        private static List<WeComposeItem> Items(int elevations, bool key = true, bool axon = true, int legends = 0, int placeholders = 0,
                                                 double elevW = 150, double elevH = 110)
        {
            var list = new List<WeComposeItem>();
            if (key) list.Add(new WeComposeItem(WeComposeKind.KeyPlan, Mm(140), Mm(150)));
            if (axon) list.Add(new WeComposeItem(WeComposeKind.Axon, Mm(130), Mm(120)));
            for (int i = 0; i < legends; i++) list.Add(new WeComposeItem(WeComposeKind.Legend, Mm(110), Mm(60)));
            for (int i = 0; i < elevations; i++) list.Add(new WeComposeItem(WeComposeKind.Elevation, Mm(elevW), Mm(elevH)));
            for (int i = 0; i < placeholders; i++) list.Add(new WeComposeItem(WeComposeKind.Placeholder, Mm(180), Mm(120)));
            return list;
        }

        private static void AssertComplete(List<WeComposeItem> items, List<WeSheetSlot> slots)
        {
            Assert.Eq(items.Count, slots.Count, "блок бүр яг нэг байрлалтай (хаягдаагүй)");
            Assert.Eq(items.Count, slots.Select(s => s.Index).Distinct().Count(), "давхардсан индекс алга");
            Assert.True(slots.All(s => s.Page == 0), "бүгд ЭНЭ хуудсанд — үргэлжлэлийн хуудас алга");
            for (int a = 0; a < slots.Count; a++)
                for (int b = a + 1; b < slots.Count; b++)
                    Assert.False(Math.Abs(slots[a].CenterX - slots[b].CenterX) < Mm(1) && Math.Abs(slots[a].CenterY - slots[b].CenterY) < Mm(1),
                                 "хоёр блок яг ижил цэгт биш (#" + slots[a].Index + ", #" + slots[b].Index + ")");
        }

        private static WeSheetSlot Of(List<WeSheetSlot> slots, int index) { return slots.Single(s => s.Index == index); }

        [Test]
        public static void Four_elevations_take_the_four_regions_in_label_order()
        {
            List<WeComposeItem> items = Items(4);
            List<WeSheetSlot> slots = WeSingleSheet.Compose(items, A2(), Mm(4), Mm(12));
            AssertComplete(items, slots);
            WeSheetSlot a = Of(slots, 2), b = Of(slots, 3), c = Of(slots, 4), d = Of(slots, 5);
            Assert.Eq(0, a.Region, "A зүүн дээд");
            Assert.Eq(1, b.Region, "B баруун дээд");
            Assert.Eq(2, c.Region, "C зүүн доод");
            Assert.Eq(3, d.Region, "D баруун доод");
            Assert.True(a.CenterX < b.CenterX && c.CenterX < d.CenterX, "зүүн нь баруунаас зүүн");
            Assert.True(a.CenterY > c.CenterY && b.CenterY > d.CenterY, "дээд нь доодоос дээр");
            Assert.False(slots.Any(s => s.Stacked || s.Spill), "4 дэлгээс багтсан — овоолго, хальсан блок алга");
            WeSheetSlot key = Of(slots, 0), axon = Of(slots, 1);
            Assert.True(key.CenterX < a.CenterX && key.CenterY > axon.CenterY, "түлхүүр план зүүн дээд, 3D доор нь");
            Assert.False(WeSingleSheet.Assess(slots, items, A2(), Mm(0.5)).NeedsArrangement, "цэгцлэх шаардлагагүй");
        }

        [Test]
        public static void Top_row_floor_lines_are_aligned()
        {
            List<WeComposeItem> items = Items(4, key: false, axon: false);
            items[0].H = Mm(120); items[0].Base = Mm(100);   // шал дээд захаас 100 мм доор
            items[1].H = Mm(90); items[1].Base = Mm(60);
            List<WeSheetSlot> slots = WeSingleSheet.Compose(items, A2(), Mm(4), Mm(12));
            double floorA = Of(slots, 0).CenterY + items[0].H / 2 - items[0].Base;
            double floorB = Of(slots, 1).CenterY + items[1].H / 2 - items[1].Base;
            Assert.True(Math.Abs(floorA - floorB) < 1e-9, "A, B-ийн шал нэг шулуун дээр");
            Assert.True(Of(slots, 0).CenterY + items[0].H / 2 <= A2().MaxY + 1e-9, "хамгийн өндөр шугамтай нь дээд захад");
        }

        [Test]
        public static void Nine_elevations_stay_on_one_sheet_with_visible_offset_stacks()
        {
            List<WeComposeItem> items = Items(9, elevW: 200, elevH: 140);
            List<WeSheetSlot> slots = WeSingleSheet.Compose(items, A2(), Mm(4), Mm(12));
            AssertComplete(items, slots);
            for (int k = 0; k < 9; k++) Assert.Eq(k % 4, Of(slots, 2 + k).Region, "дэлгээс " + k + " → бүс k mod 4");
            List<WeSheetSlot> stacked = slots.Where(s => s.Stacked).ToList();
            Assert.True(stacked.Count > 0, "багтаагүй нь овоолгод");
            foreach (WeSheetSlot s in stacked)
            {
                // Овоолгын зураг бүсийн эхний зургаас баруун-доош шилжсэн (гарчиг харагдана).
                WeSheetSlot head = slots.Where(x => x.Region == s.Region && !x.Stacked).OrderByDescending(x => x.CenterY).First();
                Assert.True(s.CenterX > head.CenterX - 1e-9 || s.CenterY < head.CenterY + 1e-9, "овоолго шилжүүлсэн");
            }
            WeSheetFitReport rep = WeSingleSheet.Assess(slots, items, A2(), Mm(0.5));
            Assert.True(rep.NeedsArrangement && rep.Stacked == stacked.Count, "тайланд «байрлуулж цэгцлэх»: " + rep.Describe());
        }

        [Test]
        public static void Fifth_and_sixth_elevations_use_free_sheet_space_before_stacking()
        {
            // Live gate 2026-10-16 (GEN-HIDE-102, GEN-LINK-103): 5–6 талтай өрөө A1 хуудсанд — сул зай хангалттай байхад E/F овоолгод орж
            // viewport давхцаж байв.  Багтах газар байвал ДАВХЦАЛГҮЙ, овоолгогүй.
            var area = new WeSheetArea { MinX = Mm(20), MinY = Mm(20), MaxX = Mm(821), MaxY = Mm(574), OuterMaxX = Mm(841), OuterMaxY = Mm(594) };
            var items = new List<WeComposeItem>
            {
                new WeComposeItem(WeComposeKind.KeyPlan, Mm(140), Mm(150)),
                new WeComposeItem(WeComposeKind.Axon, Mm(130), Mm(120)),
            };
            foreach (double w in new[] { 210.0, 150, 130, 100, 120, 210 }) items.Add(new WeComposeItem(WeComposeKind.Elevation, Mm(w), Mm(115)));
            List<WeSheetSlot> slots = WeSingleSheet.Compose(items, area, Mm(4), Mm(12));
            AssertComplete(items, slots);
            WeSheetFitReport rep = WeSingleSheet.Assess(slots, items, area, Mm(0.5));
            Assert.Eq(0, rep.Overlaps, "давхцал алга: " + rep.Describe());
            Assert.Eq(0, rep.Stacked, "овоолго алга — сул зай хангалттай");
            Assert.Eq(0, rep.OutOfFrame, "хүрээнд");
            for (int k = 0; k < 6; k++) Assert.Eq(k % 4, Of(slots, 2 + k).Region, "дэлгээс " + k + " → бүс k mod 4 (тайлан, сонголт)");
            Assert.False(rep.NeedsArrangement, "«байрлуулж цэгцлэх» шаардлагагүй");
        }

        [Test]
        public static void Live_gate_compositions_of_2026_10_16_have_no_overlap_and_no_stack()
        {
            // Бодит live логийн «нэг хуудасны зохиомж» (Revit 2027, синтетик загвар): талбай 30,30,1018,810 мм; түлхүүр план, 3D, дэлгээсүүд
            // (A, B, … дарааллаар), 3 рендерийн байр 180×120.  Засварын өмнө E нь «овоолго» болж A-тай давхцаж байв (sheets.layout FAIL).
            var cases = new Dictionary<string, double[][]>
            {
                { "GEN-HIDE-102",   new[] { new[] { 212.0, 208 }, new[] { 264.0, 217 }, new[] { 246.0, 107 }, new[] { 170.0, 107 }, new[] { 186.0, 107 }, new[] { 248.0, 107 }, new[] { 168.0, 107 }, new[] { 150.0, 107 } } },
                { "GEN-LINK-103",   new[] { new[] { 251.0, 174 }, new[] { 267.0, 218 }, new[] { 206.0, 107 }, new[] { 286.0, 107 }, new[] { 206.0, 107 }, new[] { 286.0, 107 }, new[] { 116.0, 107 } } },
                { "REPLAN-HOST-102", new[] { new[] { 212.0, 208 }, new[] { 264.0, 216 }, new[] { 233.0, 116 }, new[] { 161.0, 116 }, new[] { 173.0, 116 }, new[] { 235.0, 116 }, new[] { 151.0, 110 }, new[] { 137.0, 110 } } },
                { "FOCUS-HOST-103",  new[] { new[] { 251.0, 174 }, new[] { 267.0, 218 }, new[] { 193.0, 116 }, new[] { 273.0, 116 }, new[] { 176.0, 110 }, new[] { 273.0, 110 }, new[] { 116.0, 110 } } },
            };
            var area = new WeSheetArea { MinX = Mm(30), MinY = Mm(30), MaxX = Mm(1018), MaxY = Mm(810), OuterMaxX = Mm(1048), OuterMaxY = Mm(840) };
            foreach (KeyValuePair<string, double[][]> c in cases)
            {
                var items = new List<WeComposeItem>
                {
                    new WeComposeItem(WeComposeKind.KeyPlan, Mm(c.Value[0][0]), Mm(c.Value[0][1])),
                    new WeComposeItem(WeComposeKind.Axon, Mm(c.Value[1][0]), Mm(c.Value[1][1])),
                };
                for (int i = 2; i < c.Value.Length; i++) items.Add(new WeComposeItem(WeComposeKind.Elevation, Mm(c.Value[i][0]), Mm(c.Value[i][1])));
                for (int i = 0; i < 3; i++) items.Add(new WeComposeItem(WeComposeKind.Placeholder, Mm(180), Mm(120)));
                List<WeSheetSlot> slots = WeSingleSheet.Compose(items, area, Mm(4), Mm(12), Mm(55));
                AssertComplete(items, slots);
                WeSheetFitReport rep = WeSingleSheet.Assess(slots, items, area, Mm(0.5));
                Assert.Eq(0, rep.Overlaps, c.Key + ": давхцал алга — " + rep.Describe());
                Assert.Eq(0, rep.Stacked, c.Key + ": овоолго алга");
                Assert.Eq(0, rep.OutOfFrame, c.Key + ": хүрээнд");
                Assert.Eq(0, rep.Spilled, c.Key + ": хуудасны гадна алга");
                for (int k = 0; k < c.Value.Length - 2; k++) Assert.Eq(k % 4, Of(slots, 2 + k).Region, c.Key + ": дэлгээс " + k + " → бүс k mod 4");
            }
        }

        [Test]
        public static void Twenty_elevations_never_open_another_sheet_and_never_coincide()
        {
            List<WeComposeItem> items = Items(20, legends: 2, placeholders: 3, elevW: 180, elevH: 120);
            List<WeSheetSlot> slots = WeSingleSheet.Compose(items, A2(), Mm(4), Mm(12), Mm(55));
            AssertComplete(items, slots);
            // Овоолго бүрт шилжилт дахин давтагдахгүй — бүсийн N дэх овоолго N алхмаар.
            foreach (IGrouping<int, WeSheetSlot> g in slots.Where(s => s.Stacked).GroupBy(s => s.Region))
            {
                List<WeSheetSlot> list = g.ToList();
                Assert.Eq(list.Count, list.Select(s => Math.Round(s.CenterX / Mm(1))).Distinct().Count(), "бүс " + g.Key + ": овоолгын x давтагдахгүй");
            }
            Assert.True(slots.Where(s => items[s.Index].Kind == WeComposeKind.Placeholder).Count() == 3, "рендерийн байр хаягдаагүй");
        }

        [Test]
        public static void Composer_never_changes_view_sizes_or_scales()
        {
            List<WeComposeItem> items = Items(12, legends: 1, elevW: 260, elevH: 170);
            var before = items.Select(i => new[] { i.W, i.H }).ToList();
            List<WeSheetSlot> slots = WeSingleSheet.Compose(items, A2(), Mm(4), Mm(12));
            for (int i = 0; i < items.Count; i++)
                Assert.True(items[i].W == before[i][0] && items[i].H == before[i][1], "блокийн хэмжээ хөндөгдөөгүй #" + i);
            Assert.True(slots.Where(s => items[s.Index].Kind != WeComposeKind.Placeholder).All(s => s.W == 0 && s.H == 0),
                        "зөвхөн рендерийн байрыг жижигрүүлж болно — харагдацыг хэзээ ч");
        }

        [Test]
        public static void Oversize_elevation_is_placed_on_the_same_sheet_and_reported_out_of_frame()
        {
            var items = new List<WeComposeItem>
            {
                new WeComposeItem(WeComposeKind.KeyPlan, Mm(140), Mm(150)),
                new WeComposeItem(WeComposeKind.Elevation, Mm(700), Mm(200)),   // хуудаснаас өргөн
                new WeComposeItem(WeComposeKind.Elevation, Mm(150), Mm(110)),
            };
            List<WeSheetSlot> slots = WeSingleSheet.Compose(items, A2(), Mm(4), Mm(12));
            AssertComplete(items, slots);
            WeSheetFitReport rep = WeSingleSheet.Assess(slots, items, A2(), Mm(0.5));
            Assert.True(rep.OutOfFrame >= 1, "хүрээнээс гарсан гэж тайлагнана: " + rep.Describe());
        }

        [Test]
        public static void Helpers_that_do_not_fit_the_column_use_free_space_or_spill_right_of_the_sheet()
        {
            // Багана өндөр: түлхүүр план 300 мм — 3D, 3 legend баганад багтахгүй.
            var items = new List<WeComposeItem>
            {
                new WeComposeItem(WeComposeKind.KeyPlan, Mm(150), Mm(300)),
                new WeComposeItem(WeComposeKind.Axon, Mm(160), Mm(140)),
                new WeComposeItem(WeComposeKind.Legend, Mm(120), Mm(80)),
                new WeComposeItem(WeComposeKind.Legend, Mm(120), Mm(80)),
                new WeComposeItem(WeComposeKind.Legend, Mm(120), Mm(80)),
            };
            for (int i = 0; i < 4; i++) items.Add(new WeComposeItem(WeComposeKind.Elevation, Mm(190), Mm(180)));
            WeSheetArea area = A2();
            List<WeSheetSlot> slots = WeSingleSheet.Compose(items, area, Mm(4), Mm(12));
            AssertComplete(items, slots);
            foreach (WeSheetSlot s in slots.Where(s => s.Spill))
                Assert.True(s.CenterX - items[s.Index].W / 2 >= area.OuterMaxX - 1e-9, "хальсан блок title block-ийн гадна (бичээсийг дарахгүй)");
            Assert.True(slots.Count(s => s.Spill) >= 1, "зай дууссан үед хуудасны баруун талд");
        }

        [Test]
        public static void Place_in_free_never_moves_existing_viewports_and_spills_below_previous_spills()
        {
            WeSheetArea area = A2();
            // Хуудас бүхэлдээ эзлэгдсэн (хэрэглэгчийн байрлуулалт) + өмнө хальсан нэг блок.
            var occupied = new List<double[]>
            {
                new[] { area.MinX, area.MinY, area.MaxX, area.MaxY },
                new[] { area.SpillX(Mm(4)), area.SpillTop - Mm(100), area.SpillX(Mm(4)) + Mm(150), area.SpillTop },
            };
            int before = occupied.Count;
            var item = new WeComposeItem(WeComposeKind.Elevation, Mm(150), Mm(90));
            WeSheetSlot s = WeSingleSheet.PlaceInFree(item, 7, area, occupied, Mm(4));
            Assert.True(s.Spill && s.Page == 0, "сул зай алга — баруун талд, ижил хуудсанд");
            Assert.True(s.CenterY + Mm(45) <= area.SpillTop - Mm(100) + 1e-9, "өмнө хальсан блокийн ДООР");
            Assert.Eq(before + 1, occupied.Count, "эзлэгдсэн жагсаалтад нэмэгдсэн (дараагийнх давхцахгүй)");

            // Сул зайтай хуудсанд — тэр зайд.
            var occ2 = new List<double[]> { new[] { area.MinX, Mm(200), area.MaxX, area.MaxY } };
            WeSheetSlot f = WeSingleSheet.PlaceInFree(item, 8, area, occ2, Mm(4));
            Assert.False(f.Spill, "сул зайд");
            Assert.True(area.Contains(f.CenterX - Mm(75), f.CenterY - Mm(45), f.CenterX + Mm(75), f.CenterY + Mm(45), 1e-9), "хүрээн дотор");
        }

        [Test]
        public static void Lower_left_region_uses_the_space_beside_the_corner_table()
        {
            // Хүснэгт баруун доод буланд: зурах талбайн доод хил 80 мм, хүснэгтийн зүүн талд (x ≤ 380) 20 мм хүртэл.
            var area = new WeSheetArea { MinX = Mm(20), MinY = Mm(80), MaxX = Mm(580), MaxY = Mm(400), NotchMaxX = Mm(380), NotchMinY = Mm(20), OuterMaxX = Mm(594), OuterMaxY = Mm(420) };
            // Хоёр мөр 170 мм өндөр: доод мөр 80 мм-ийн хилээс доош (56 мм) — хүснэгтийн зүүн талын зайд л хүрээн дотор.
            var items = new List<WeComposeItem>();
            for (int i = 0; i < 4; i++) items.Add(new WeComposeItem(WeComposeKind.Elevation, Mm(170), Mm(170)));
            List<WeSheetSlot> slots = WeSingleSheet.Compose(items, area, Mm(4), Mm(12));
            foreach (int i in new[] { 2, 3 })
            {
                double[] r = WeSingleSheet.RectOf(Of(slots, i), items[i]);
                Assert.True(r[1] < area.MinY && area.Contains(r[0], r[1], r[2], r[3], 1e-9), "доод мөрийн #" + i + " хүснэгтийн зүүн талын зайд, хүрээн дотор");
            }
            Assert.Eq(0, WeSingleSheet.Assess(slots, items, area, Mm(0.5)).OutOfFrame, "доод зай ашиглагдсан — хүрээнээс гарсан алга");
            var noNotch = new WeSheetArea { MinX = area.MinX, MinY = area.MinY, MaxX = area.MaxX, MaxY = area.MaxY, OuterMaxX = area.OuterMaxX, OuterMaxY = area.OuterMaxY };
            Assert.True(WeSingleSheet.Assess(slots, items, noNotch, Mm(0.5)).OutOfFrame >= 2, "хүснэгтийн зайгүй бол доод мөр хүрээнээс гарсан гэж тооцогдоно");
        }

        [Test]
        public static void Partial_bottom_table_line_no_longer_removes_the_whole_bottom_band()
        {
            // Баруун доод буланд хүснэгт: дээд шугам нь өргөний 60 % (400..1000) — өмнө нь бүх өргөнөөр доод хил болж зүүн доод зай алга болдог байв.
            var segs = new List<double[]>
            {
                new double[] { 0, 0, 1000, 0 }, new double[] { 1000, 0, 1000, 700 }, new double[] { 1000, 700, 0, 700 }, new double[] { 0, 700, 0, 0 },
                new double[] { 400, 120, 1000, 120 }, new double[] { 400, 0, 400, 120 },
            };
            double[] old = WeSheetFrame.Drawable(segs, 0, 0, 1000, 700);
            Assert.SeqEq(new double[] { 0, 120, 1000, 700 }, old, "хуучин зан төлөв (хуучин дуудлага) хэвээр");
            List<double[]> partial;
            double[] d = WeSheetFrame.Drawable(segs, 0, 0, 1000, 700, out partial);
            Assert.SeqEq(new double[] { 0, 0, 1000, 700 }, d, "хэсэгчилсэн шугам бүтэн өргөний хил биш");
            Assert.Eq(1, partial.Count, "хүснэгт саад болж буцсан");
            Assert.SeqEq(new double[] { 400, 0, 1000, 120 }, partial[0]);
            double[] avoided = WeSheetFrame.AvoidObstacles(d, partial, 1);
            Assert.SeqEq(new double[] { 0, 120, 1000, 700 }, avoided, "хүснэгтийн дээрх хэсэг");
            double[] notch = WeSheetFrame.Notch(d, avoided, partial, 1);
            Assert.True(notch != null && notch[0] == 400 && notch[1] == 0, "хүснэгтийн зүүн талын доод зай нээлттэй (x ≤ 400 бол y ≥ 0)");

            // Бүтэн өргөнтэй доод шугам — хэвээр хил (доод тууз).
            var band = new List<double[]>(segs.Take(4)) { new double[] { 0, 90, 1000, 90 } };
            List<double[]> none;
            Assert.SeqEq(new double[] { 0, 90, 1000, 700 }, WeSheetFrame.Drawable(band, 0, 0, 1000, 700, out none), "бүтэн тууз хил");
            Assert.Eq(0, none.Count);
        }

        [Test]
        public static void Same_input_gives_the_same_layout()
        {
            List<WeComposeItem> items = Items(11, legends: 2, placeholders: 2, elevW: 170, elevH: 130);
            List<WeSheetSlot> a = WeSingleSheet.Compose(items, A2(), Mm(4), Mm(12), Mm(55));
            List<WeSheetSlot> b = WeSingleSheet.Compose(items, A2(), Mm(4), Mm(12), Mm(55));
            Assert.Eq(a.Count, b.Count);
            for (int i = 0; i < a.Count; i++)
                Assert.True(a[i].Index == b[i].Index && a[i].CenterX == b[i].CenterX && a[i].CenterY == b[i].CenterY && a[i].Stacked == b[i].Stacked, "детерминист #" + i);
        }

        [Test]
        public static void Single_elevation_room_uses_the_whole_width()
        {
            var items = new List<WeComposeItem> { new WeComposeItem(WeComposeKind.Elevation, Mm(400), Mm(150)) };
            List<WeSheetSlot> slots = WeSingleSheet.Compose(items, A2(), Mm(4), Mm(12));
            AssertComplete(items, slots);
            Assert.False(WeSingleSheet.Assess(slots, items, A2(), Mm(0.5)).NeedsArrangement, "нэг дэлгээс бүтэн өргөнд багтана");
        }
    }
}
