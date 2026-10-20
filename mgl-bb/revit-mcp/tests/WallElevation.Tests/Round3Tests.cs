using System;
using System.Collections.Generic;
using System.Linq;
using RevitMcpAddin.WallElevation.Core;

namespace RevitMcpAddin.WallElevation.Tests
{
    /// <summary>
    /// Интерьерийн багийн 3-р тойрог (2026-10-14): толин spot, тод/бүдэг хэсэг, улаан хүрээ, рендерийн байр (хэзээ ч хаягдахгүй), legend хайлт,
    /// «* Type Designator».
    /// </summary>
    public static class Round3Tests
    {
        private const long FloorFinish = 10, UpperSlab = 13, Ceiling = 20;

        private static WeSlabInfo Slab(long id, WeSlabKind kind, double z0, double z1)
        {
            return new WeSlabInfo { Id = id, Kind = kind, Min = Fx.P(0, 0, z0), Max = Fx.P(5000, 4000, z1) };
        }

        /// <summary>5000×4000 өрөө, шал 0, тааз 2750–2770, дээд хучилт 4200–4400, дээд түвшин 4500.</summary>
        private static WeRequest Scene(bool ceiling = true)
        {
            WeRequest req = Fx.SquareRoom(5000, 4000);
            WeAnnoSources s = req.Sources;
            s.Levels.Add(new WeLevelInfo { Id = 1, Name = "L01", Z = 0 });
            s.Levels.Add(new WeLevelInfo { Id = 2, Name = "L02", Z = Fx.Mm(4500) });
            s.Slabs.Add(Slab(FloorFinish, WeSlabKind.Floor, -100, 0));
            s.Slabs.Add(Slab(UpperSlab, WeSlabKind.Floor, 4200, 4400));
            if (ceiling) s.Slabs.Add(Slab(Ceiling, WeSlabKind.Ceiling, 2750, 2770));
            return req;
        }

        private static WePlannedElevation South(WeRequest req, Action<WeSettings> tweak = null)
        {
            string uid = req.Rooms[0].Loops[0].Segments[0].WallUniqueId;
            return WallElevationPlanner.Plan(req, Fx.Ctx(tweak)).Items.Single(i => i.WallUid == uid);
        }

        private static double Mm(double ft) { return Math.Round(ft * WeFixedUnits.MmPerFoot, 1); }

        // ── 3. Толин spot ─────────────────────────────────────────────

        [Test]
        public static void Floor_and_ceiling_spots_are_mirrored_text_outside()
        {
            WePlannedElevation p = South(Scene());
            WeSpot floor = p.Annotation.Spots.Single(s => s.Target.Kind == WeRefKind.FloorTop);
            WeSpot ceil = p.Annotation.Spots.Single(s => s.Target.Kind == WeRefKind.CeilingBottom);
            Assert.True(floor.Mirrored && ceil.Mirrored, "шал, таазны spot толин (бичвэр тэмдгийн гадна — жишээ хуудас 232)");
            Assert.True(floor.Leader && floor.EndX < p.Box.MinX && ceil.EndX < p.Box.MinX, "тэмдэг хүрээний зүүн талд");
            // Толин тэмдэг нь тэмдэгт орно — өмнөх (толин биш) дэлгээс дахин ажиллуулахад шинэчлэгдэнэ.
            Assert.True(WeIdentity.AnnotationPart(p.Signature).Length > 0);
        }

        // ── 4/5. Тод / бүдэг хэсэг, улаан хүрээ ─────────────────────────

        [Test]
        public static void Fade_starts_at_the_ceiling_top_and_runs_to_the_crop_top()
        {
            WePlannedElevation p = South(Scene());
            Assert.Eq(2770.0, Mm(p.Annotation.FadeFromY), "тод хэсэг таазны ДЭЭД нүүр хүртэл (тааз өөрөө тод)");
            Assert.True(p.Box.MaxY > p.Annotation.FadeFromY + Fx.Mm(1000), "бүдэг хэсэг = таазнаас хүрээний орой хүртэл: " + Mm(p.Box.MaxY));
            Assert.True(Math.Abs(p.Box.MaxY - Fx.Mm(4500)) < Fx.Mm(0.5), "хүрээ хэвээр дээд түвшин хүртэл (бүдэг хэсэг хүрээг өөрчлөхгүй)");
        }

        [Test]
        public static void Fade_by_height_or_off()
        {
            WePlannedElevation h = South(Scene(), s => { s.FadeMode = WeFadeMode.AboveHeight; s.FadeHeightMm = 2400; });
            Assert.Eq(2400.0, Mm(h.Annotation.FadeFromY), "шалны дээд нүүрнээс 2400");
            WePlannedElevation off = South(Scene(), s => s.FadeMode = WeFadeMode.None);
            Assert.True(double.IsNaN(off.Annotation.FadeFromY), "бүдэгрүүлэхгүй");
            WePlannedElevation noCeil = South(Scene(false));
            Assert.True(double.IsNaN(noCeil.Annotation.FadeFromY), "тааз алга — бүдэг хэсэг алга");
            Assert.True(noCeil.Annotation.Notes.Any(n => n.Contains("Тааз олдсонгүй")), "шалтгааныг хэлнэ");
        }

        [Test]
        public static void Fade_and_frame_settings_change_the_signature()
        {
            WeRequest req = Scene();
            string a = South(req).Signature;
            string b = South(req, s => s.FadeOpacity = 35).Signature;
            string c = South(req, s => s.RedFrame = false).Signature;
            string d = South(req, s => s.FadeMode = WeFadeMode.None).Signature;
            Assert.True(a != b && a != c && a != d && b != c, "opacity, хүрээ, горим солиход дэлгээс шинэчлэгдэнэ");
            Assert.Eq(a, South(req).Signature, "тогтвортой");
        }

        [Test]
        public static void Settings_round_trip_and_validation()
        {
            var s = new WeSettings { FadeMode = WeFadeMode.AboveHeight, FadeHeightMm = 2600, FadeOpacity = 35, RedFrame = false, RenderPlacement = WeRenderPlacement.AllSheets };
            WeSettings r = WeSettings.Deserialize(s.Serialize());
            Assert.Eq(WeFadeMode.AboveHeight, r.FadeMode);
            Assert.Eq(2600.0, r.FadeHeightMm);
            Assert.Eq(35, r.FadeOpacity);
            Assert.False(r.RedFrame);
            Assert.Eq(WeRenderPlacement.AllSheets, r.RenderPlacement);
            var def = new WeSettings();
            Assert.Eq(WeFadeMode.AboveCeiling, def.FadeMode, "өгөгдмөл: таазнаас дээш бүдэг");
            Assert.Eq(20, def.FadeOpacity, "өгөгдмөл opacity 20 (интерьерийн жишиг)");
            Assert.True(def.RedFrame, "өгөгдмөл: улаан хүрээтэй");
            Assert.Eq(WeRenderPlacement.LastSheet, def.RenderPlacement);
            // Хуучин файл (шинэ түлхүүргүй) → өгөгдмөл; буруу утга → өгөгдмөл.
            WeSettings old = WeSettings.Deserialize("viewKind=Elevation\nfadeOpacity=150\nfadeMode=Xyz\n");
            Assert.Eq(20, old.FadeOpacity);
            Assert.Eq(WeFadeMode.AboveCeiling, old.FadeMode);
            Assert.True(new WeSettings { FadeOpacity = 101 }.Validate().Any(e => e.Contains("харагдах")), "opacity 0–100");
            Assert.True(new WeSettings { FadeMode = WeFadeMode.AboveHeight, FadeHeightMm = 100 }.Validate().Any(e => e.Contains("Тод хэсгийн")), "өндөр 300+");
            Assert.False(new WeSettings { FadeMode = WeFadeMode.AboveCeiling, FadeHeightMm = 100 }.Validate().Any(e => e.Contains("Тод хэсгийн")), "өндөр зөвхөн тэр горимд шалгагдана");
        }

        [Test]
        public static void Rounded_rectangle_is_a_closed_chain_inside_the_box()
        {
            WeRoundedRect.Outline o = WeRoundedRect.Of(0, 0, 100, 60, 3, 0.1);
            Assert.Eq(4, o.Lines.Count);
            Assert.Eq(4, o.Arcs.Count);
            // Шулуун бүрийн үзүүр нь нумын үзүүртэй давхцана (битүү).
            var ends = new List<double[]>();
            foreach (WeSegment2 l in o.Lines) { ends.Add(new[] { l.X0, l.Y0 }); ends.Add(new[] { l.X1, l.Y1 }); }
            foreach (WeArc2 a in o.Arcs)
            {
                Assert.True(ends.Any(e => Math.Abs(e[0] - a.X0) < 1e-9 && Math.Abs(e[1] - a.Y0) < 1e-9), "нумын эхлэл шулуунтай");
                Assert.True(ends.Any(e => Math.Abs(e[0] - a.X1) < 1e-9 && Math.Abs(e[1] - a.Y1) < 1e-9), "нумын төгсгөл шулуунтай");
                Assert.True(a.Cx - a.R >= -1e-9 && a.Cx + a.R <= 100 + 1e-9 && a.Cy - a.R >= -1e-9 && a.Cy + a.R <= 60 + 1e-9, "хайрцгаас гарахгүй");
            }
            Assert.Eq(3.0, o.Radius);
            Assert.True(WeRoundedRect.Of(0, 0, 4, 60, 3, 0.1).Radius < 2, "нарийн тэгш өнцөгтөд радиус багасна");
            Assert.True(WeRoundedRect.Of(0, 0, 0.05, 60, 3, 0.1) == null, "хоосон тэгш өнцөгт — null");
        }

        // ── 7. Рендерийн байр — ХЭЗЭЭ Ч ХАЯГДАХГҮЙ ────────────────────

        private static List<WeComposeItem> Items(int elevations, int renders, double elevW = 240, double elevH = 95)
        {
            var list = new List<WeComposeItem> { new WeComposeItem(WeComposeKind.KeyPlan, Fx.Mm(150), Fx.Mm(160)) };
            for (int i = 0; i < elevations; i++) list.Add(new WeComposeItem(WeComposeKind.Elevation, Fx.Mm(elevW), Fx.Mm(elevH)));
            for (int i = 0; i < renders; i++) list.Add(new WeComposeItem(WeComposeKind.Placeholder, Fx.Mm(180), Fx.Mm(120)));
            return list;
        }

        private static double W(WeSheetSlot s, List<WeComposeItem> items) { return s.W > 0 ? s.W : items[s.Index].W; }
        private static double H(WeSheetSlot s, List<WeComposeItem> items) { return s.H > 0 ? s.H : items[s.Index].H; }

        private static void NoOverlap(List<WeComposeItem> items, List<WeSheetSlot> slots)
        {
            for (int i = 0; i < slots.Count; i++)
                for (int j = i + 1; j < slots.Count; j++)
                {
                    WeSheetSlot a = slots[i], b = slots[j];
                    if (a.Page != b.Page) continue;
                    bool ov = Math.Abs(a.CenterX - b.CenterX) < (W(a, items) + W(b, items)) / 2 - 1e-9 && Math.Abs(a.CenterY - b.CenterY) < (H(a, items) + H(b, items)) / 2 - 1e-9;
                    Assert.False(ov, "давхцал #" + a.Index + "(p" + a.Page + ") ↔ #" + b.Index);
                }
        }

        [Test]
        public static void Renders_are_never_dropped_on_any_sheet_size()
        {
            // 2026-10-14 (интерьерийн баг: «render-ийн хэсэг заримдаа олдохгүй»): өмнө нь сүүлийн хуудсанд багтахгүй бол байр ЧИМЭЭГҮЙ хаягддаг байв.
            double gap = Fx.Mm(8);
            foreach (double[] sheet in new[] { new[] { 420.0, 297 }, new[] { 594.0, 380 }, new[] { 800.0, 500 }, new[] { 380.0, 260 } })
                for (int n = 1; n <= 14; n += 3)
                    for (int r = 1; r <= 4; r++)
                    {
                        List<WeComposeItem> items = Items(n, r);
                        List<WeSheetSlot> slots = WeSheetComposer.Compose(items, 0, 0, Fx.Mm(sheet[0]), Fx.Mm(sheet[1]), gap, Fx.Mm(55));
                        List<WeSheetSlot> ph = slots.Where(s => items[s.Index].Kind == WeComposeKind.Placeholder).ToList();
                        string tag = sheet[0] + "×" + sheet[1] + " · " + n + " дэлгээс · " + r + " рендер";
                        Assert.Eq(r, ph.Count, "рендер бүр байртай — " + tag);
                        Assert.Eq(items.Count, slots.Select(s => s.Index).Distinct().Count(), "блок бүр байрлалтай — " + tag);
                        NoOverlap(items, slots);
                        foreach (WeSheetSlot p in ph)
                            Assert.True(p.CenterX - W(p, items) / 2 >= -1e-9 && p.CenterX + W(p, items) / 2 <= Fx.Mm(sheet[0]) + 1e-9
                                        && p.CenterY - H(p, items) / 2 >= -1e-9 && p.CenterY + H(p, items) / 2 <= Fx.Mm(sheet[1]) + 1e-9, "хуудсанд багтана — " + tag);
                    }
        }

        [Test]
        public static void Renders_go_to_the_last_sheet_bottom_row_when_there_is_room()
        {
            List<WeComposeItem> items = Items(4, 2);
            List<WeSheetSlot> slots = WeSheetComposer.Compose(items, 0, 0, Fx.Mm(1000), Fx.Mm(700), Fx.Mm(10), Fx.Mm(55));
            List<WeSheetSlot> ph = slots.Where(s => items[s.Index].Kind == WeComposeKind.Placeholder).ToList();
            Assert.True(ph.All(p => p.Page == 0 && Math.Abs(p.CenterY - H(p, items) / 2) < 1e-9), "сүүлийн (энд цорын ганц) хуудасны доод мөрөнд");
        }

        [Test]
        public static void Renders_fall_back_to_the_second_to_last_sheet_or_split_never_a_new_page_when_room_exists()
        {
            // Хоёр хуудас: эхний хуудасны доод хэсэг сул (дэлгээс хоёр мөр), сүүлийн хуудас дэлгээсээр дүүрэн.
            double x1 = Fx.Mm(594), y1 = Fx.Mm(420), gap = Fx.Mm(8);
            var items = new List<WeComposeItem> { new WeComposeItem(WeComposeKind.KeyPlan, Fx.Mm(150), Fx.Mm(160)) };
            // Эхний хуудас: баганын баруун талд 2 өргөн дэлгээс (430 мм) — 3 дахь нь багтахгүй тул дараагийн хуудсанд; дараагийн хуудас бүтэн өндөртэй.
            items.Add(new WeComposeItem(WeComposeKind.Elevation, Fx.Mm(420), Fx.Mm(120)));
            items.Add(new WeComposeItem(WeComposeKind.Elevation, Fx.Mm(420), Fx.Mm(120)));
            items.Add(new WeComposeItem(WeComposeKind.Elevation, Fx.Mm(590), Fx.Mm(415)));
            items.Add(new WeComposeItem(WeComposeKind.Placeholder, Fx.Mm(180), Fx.Mm(120)));
            items.Add(new WeComposeItem(WeComposeKind.Placeholder, Fx.Mm(180), Fx.Mm(120)));
            List<WeSheetSlot> slots = WeSheetComposer.Compose(items, 0, 0, x1, y1, gap, Fx.Mm(55));
            int last = slots.Where(s => items[s.Index].Kind != WeComposeKind.Placeholder).Max(s => s.Page);
            Assert.Eq(1, last, "дэлгээс 2 хуудсанд");
            List<WeSheetSlot> ph = slots.Where(s => items[s.Index].Kind == WeComposeKind.Placeholder).ToList();
            Assert.Eq(2, ph.Count);
            Assert.True(ph.All(p => p.Page == 0), "сүүлийн хуудас дүүрэн — сүүлээсээ 2 дахь хуудасны доод мөрөнд: " + string.Join(",", ph.Select(p => p.Page)));
            NoOverlap(items, slots);
        }

        [Test]
        public static void Renders_open_their_own_page_only_when_no_sheet_has_room()
        {
            // Нэг хуудас бүтэн дүүрэн (доод сул зай 55 мм-ээс бага) — шинэ хуудсанд, хаягдахгүй.
            var items = new List<WeComposeItem>
            {
                new WeComposeItem(WeComposeKind.Elevation, Fx.Mm(400), Fx.Mm(260)),
                new WeComposeItem(WeComposeKind.Placeholder, Fx.Mm(180), Fx.Mm(120)),
            };
            List<WeSheetSlot> slots = WeSheetComposer.Compose(items, 0, 0, Fx.Mm(420), Fx.Mm(297), Fx.Mm(8), Fx.Mm(55));
            WeSheetSlot ph = slots.Single(s => s.Index == 1);
            Assert.Eq(1, ph.Page, "тусдаа хуудсанд (өмнө нь алга болдог байв)");
            Assert.True(Math.Abs(ph.CenterY - H(ph, items) / 2) < 1e-9, "тэр хуудасны доод мөрөнд");
        }

        [Test]
        public static void All_sheets_mode_puts_renders_on_every_sheet()
        {
            List<WeComposeItem> items = Items(14, 2, 240, 95);
            List<WeSheetSlot> slots = WeSheetComposer.Compose(items, 0, 0, Fx.Mm(800), Fx.Mm(500), Fx.Mm(10), Fx.Mm(55), double.NaN, double.NaN, true, WeRenderPlacement.AllSheets);
            int last = slots.Where(s => items[s.Index].Kind != WeComposeKind.Placeholder).Max(s => s.Page);
            Assert.True(last >= 1, "олон хуудас");
            NoOverlap(items, slots);
            for (int p = 0; p <= last; p++)
            {
                List<WeSheetSlot> ph = slots.Where(s => s.Page == p && items[s.Index].Kind == WeComposeKind.Placeholder).ToList();
                Assert.True(ph.Count >= 1, p + "-р хуудсанд рендерийн байр");
                Assert.True(ph.All(x => Math.Abs(x.CenterY - H(x, items) / 2) < 1e-9), "доод мөрөнд");
                // Дугаар 01, 02 … — хуудас бүрт эхний рендерүүд.
                Assert.SeqEq(Enumerable.Range(0, ph.Count).Select(i => items.FindIndex(it => it.Kind == WeComposeKind.Placeholder) + i), ph.OrderBy(x => x.Index).Select(x => x.Index));
            }
        }

        // ── 1. Legend хайлт ─────────────────────────────────────────

        [Test]
        public static void Legend_search_by_name_and_mark_ignores_case_dashes_and_lookalike_letters()
        {
            var a = new WeLegendInfo("Материалын legend — хана") { Texts = { "ЗХ-01-С Хананы будаг", "ЗХ-02-С Хавтан" } };
            a.Codes = WeLegendSearch.Codes(a.Texts);
            var b = new WeLegendInfo("Шалны материал") { Texts = { "ШМ-03 Паркет" } };
            b.Codes = WeLegendSearch.Codes(b.Texts);
            Assert.SeqEq(new[] { "ЗХ-01-С", "ЗХ-02-С" }, a.Codes, "тэмдэг таних");
            Assert.True(WeLegendSearch.Matches(a, "ЗХ-01-С"), "яг тэмдгээр");
            Assert.True(WeLegendSearch.Matches(a, "зх01с"), "жижиг үсэг, зураасгүй");
            Assert.True(WeLegendSearch.Matches(a, "3X-01-C"), "латин X, C, цифр 3 (ижил дүрс)");
            Assert.True(WeLegendSearch.Matches(a, "хана"), "нэрээр");
            Assert.True(WeLegendSearch.Matches(a, "хана 02"), "олон үг — бүгд");
            Assert.False(WeLegendSearch.Matches(a, "ЗХ-03"), "өөр тэмдэг");
            Assert.False(WeLegendSearch.Matches(b, "ЗХ"), "нөгөө legend-д алга");
            Assert.True(WeLegendSearch.Matches(b, "паркет"), "бичвэрээр");
            Assert.True(WeLegendSearch.Matches(b, "  "), "хоосон — бүгд");
            Assert.SeqEq(new string[0], WeLegendSearch.Codes(new[] { "2026.10.14", "1:50", "Хана" }), "огноо, масштаб, цэвэр үг тэмдэг биш");
        }

        // ── 2. «* Type Designator» ───────────────────────────────────

        [Test]
        public static void Type_designator_values_are_ranked_and_default_comes_from_our_sheets()
        {
            var counts = new Dictionary<string, int> { { "ID", 5 }, { "AD", 12 }, { "  ", 3 }, { "IE", 5 } };
            Assert.SeqEq(new[] { "AD", "ID", "IE" }, WeSheetParamChoice.Rank(counts), "олон хэрэглэгдсэн нь эхэнд, тэнцвэл үсгээр");
            string src;
            Assert.Eq("ID", WeSheetParamChoice.PickDefault(new Dictionary<string, int> { { "ID", 2 } }, new Dictionary<string, int> { { "IE", 9 } }, out src));
            Assert.True(src.Contains("хэрэгслийн"));
            Assert.Eq("IE", WeSheetParamChoice.PickDefault(new Dictionary<string, int>(), new Dictionary<string, int> { { "IE", 9 } }, out src));
            Assert.Eq(string.Empty, WeSheetParamChoice.PickDefault(new Dictionary<string, int>(), new Dictionary<string, int>(), out src), "таамаглахгүй — бичихгүй");

            var s = new WeSettings { FixedSheetParams = WeSheetDiscipline.Interior() };
            s.SheetParams["* Type Designator"] = "ID";
            s.SheetParams["Classification"] = "Буруу";   // тогтмолтой ижил нэр — тогтмол давуу
            Dictionary<string, string> all = s.AllSheetParams();
            Assert.Eq("ID", WeSheetDiscipline.ValueFor(all, "* Type Designator"));
            Assert.Eq(WeSheetDiscipline.InteriorClassification, WeSheetDiscipline.ValueFor(all, WeSheetDiscipline.ClassificationParam));
            Assert.Eq(3, all.Count);
            Assert.Eq("ID", WeSheetDiscipline.ValueFor(s.Clone().SheetParams, "* Type Designator"), "Clone хуулна");
        }
    }
}
