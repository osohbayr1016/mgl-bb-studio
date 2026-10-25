using System.Collections.Generic;
using System;
using System.Linq;
using MglBb.Core;

namespace MglBb.Tests
{
    public static class RebarStyleTests
    {
        /// <summary>ЖИШЭЭ 3-ын хэв маяг: хомут Ø10 (600×1150 — Ø12), C Ø8, хамгаалах 30, дээд нь чиглэлээр 30 / 50, 600 өргөнд 5Ø16 муруй, шилжилтгүй.</summary>
        static BbRebarStyle Example3()
        {
            var s = new BbRebarStyleSamples();
            for (int i = 0; i < 6; i++)
            {
                s.Stirrup("x" + i, 600, 800, 0, 10, "⌀10_A240", 30, 30, 30, i % 2 == 0 ? 100 : 200);
                s.Stirrup("y" + i, 600, 700, 90, 10, "⌀10_A240", 30, 30, 50, i % 2 == 0 ? 100 : 200);
                s.Tie("x" + i, 8, "⌀8_A240");
                s.Side("x" + i, 12, "⌀12_A400");
                s.Main("x" + i, 25, "⌀25_A500", false);
            }
            s.Stirrup("deep", 600, 1150, 0, 12, "⌀12_A400", 30, 30, 30, 100);
            s.Stirrup("deep", 600, 1150, 0, 12, "⌀12_A400", 30, 30, 30, 100);
            s.Bent("y0", 600, 5, 16, "⌀16_A400");
            s.Bent("y1", 400, 3, 16, "⌀16_A400");
            s.Transition(40, 31);   // шилжилтгүй хувилбар жишээтэй илүү таарсан
            return s.Build();
        }

        [Test]
        public static void LearnsModesFromSamples()
        {
            BbRebarStyle st = Example3();
            Assert.Eq(13, st.Chains);
            Assert.Eq(10, st.StirrupD);
            Assert.Eq(12, st.StirrupDBySize["600x1150"]);
            Assert.Eq(8, st.TieD);
            Assert.Eq(12, st.SideD);
            Assert.Near(30, st.CoverSide, 1e-9);
            Assert.Near(30, st.CoverTopByDir[0], 1e-9);
            Assert.Near(50, st.CoverTopByDir[90], 1e-9);
            Assert.Eq(5, st.BentNByWidth[600]);
            Assert.True(st.Transition == false, "шилжилтгүй нь илүү таарсан");
            Assert.Eq("⌀8_A240", st.TypeNames["tie:8"]);
            Assert.Eq("⌀12_A400", st.TypeNames["minor:12"]);
        }

        [Test]
        public static void AppliedToCompanyPresetByDirectionAndSize()
        {
            BbRebarStyle st = Example3();
            var book = new BbRebarBook { Style = st };
            BbBeamPreset px = book.Preset(null, 600, null, h: 800, dirDeg: 180.2);   // чиглэл 180 ≡ 0
            Assert.Eq(10, px.StirrupD);
            Assert.Eq(8, px.TieD);
            Assert.Near(30, px.Cover, 1e-9);
            Assert.Near(30, px.CoverTop, 1e-9);
            Assert.True(!px.AverageTransition);
            Assert.Eq(5, px.Bent.N);
            Assert.Eq("⌀10_A240", px.TypeNames["stirrup:10"]);
            Assert.Near(50, book.Preset(null, 600, null, h: 700, dirDeg: -90).CoverTop, 1e-9);
            Assert.Eq(12, book.Preset(null, 600, null, h: 1150, dirDeg: 0).StirrupD);
            Assert.Eq(3, book.Preset(null, 400, null, h: 700, dirDeg: 0).Bent.N);

            // Мөрт бичсэн Ø давуу; нормын горимд хэв маяг хэрэглэгдэхгүй; унтраавал компанийн анхдагч (ЖИШЭЭ-1: Ø8, 32/52).
            Assert.Eq(12, book.Preset(new BbRebarRow { Mark = "a", StirrupD = 12 }, 600, null, h: 800, dirDeg: 0).StirrupD);
            book.LearnStyle = false;
            BbBeamPreset c = book.Preset(null, 600, null, h: 800, dirDeg: 0);
            Assert.Eq(8, c.StirrupD);
            Assert.Near(52, c.CoverTop, 1e-9);
            // «Энгийн каркас»-д ч загварын хэв маяг (ЖИШЭЭ-4-ийг сурч тааруулна); унтраавал ЖИШЭЭ-4-ийн анхдагч (C-хомут = хомутын Ø).
            book.LearnStyle = true;
            book.Company = false;
            Assert.Eq(8, book.Preset(null, 600, null, h: 800, dirDeg: 0).TieD);
            book.LearnStyle = false;
            BbBeamPreset o = book.Preset(null, 400, null, h: 600, dirDeg: 0);
            Assert.Eq(0, o.TieD);
            Assert.Eq(8, o.StirrupD);
            Assert.True(o.SupportTop && o.SpanTopLapInside && o.EndRoundNearest, "ЖИШЭЭ-4 дээд арматур");
        }

        static string Sets(BbBeamRebar r)
        {
            return string.Join(" ", r.Stirrups.OrderBy(x => x.X0).Select(x => x.X0 + (x.Count > 1 ? "x" + x.Count + "@" + x.Spacing : "")));
        }

        static BbBeamInput Span(double len, double h, double colL, double colR)
        {
            var beam = new BbBeamInput { Length = len, B = 400, H = h };
            beam.Supports.Add(new BbSupport(-colL, 0));
            beam.Supports.Add(new BbSupport(len, len + colR));
            return beam;
        }

        [Test]
        public static void Example4OrdinaryStirrupZones()
        {
            // ЖИШЭЭ-4 ДН-4: цэвэр 6450 → 17@100 / 15@200 / 17@100, 5800 → 15 / 14 / 15 (нягт нь нүүрээс ¼l, гол нь төвд).
            Assert.Eq("50x17@100 1825x15@200 4800x17@100", Sets(BbBeamRebarPlan.Plan(Span(6450, 600, 500, 600), BbBeamPreset.Ordinary(400))));
            Assert.Eq("50x15@100 1600x14@200 4350x15@100", Sets(BbBeamRebarPlan.Plan(Span(5800, 500, 600, 600), BbBeamPreset.Ordinary(400))));
        }

        [Test]
        public static void Example4SupportTopAndHangerLap()
        {
            // ЖИШЭЭ-4 ДН-4 400×600: тулгуурын дээд нүүрээс ⅓·6450 = 2150, голын 4Ø12 түүнтэй 500 давхцана (1650…4800).
            BbBeamRebar r = BbBeamRebarPlan.Plan(Span(6450, 600, 500, 600), BbBeamPreset.Ordinary(400));
            List<BbBarRun> top = r.Bars.Where(b => b.Role == BbRunRole.Top).OrderBy(b => b.X0).ToList();
            Assert.Eq(2, top.Count);
            Assert.Near(2150, top[0].X1, 1e-6);
            Assert.Near(6450 - 2150, top[1].X0, 1e-6);
            BbBarRun span = r.Bars.Single(b => b.Role == BbRunRole.SpanTop);
            Assert.Near(1650, span.X0, 1e-6);
            Assert.Near(4800, span.X1, 1e-6);
            Assert.Eq(4, span.N);
            // 6500 / 3 = 2166.7 → 2150 (ДН-7: 50-ийн ойрын үржвэр).
            Assert.Near(2150, BbBeamRebarPlan.Plan(Span(6500, 500, 500, 500), BbBeamPreset.Ordinary(400)).Bars.Where(b => b.Role == BbRunRole.Top).Min(b => b.X1), 1e-6);
        }

        [Test]
        public static void Example4StraightBottomIntoDeeperNeighbour()
        {
            // ЖИШЭЭ-4 FX2–FX3: 400×500 хоёр талдаа 400×600 — доод арматур хөлгүй, баганын алс нүүрээс цааш (≥ 100, анкерлах уртаас багагүй).
            BbBeamInput b = Span(5800, 500, 600, 600);
            b.StraightBottomStart = b.StraightBottomEnd = true;
            BbBeamPreset p = BbBeamPreset.Ordinary(400);
            BbBeamRebar r = BbBeamRebarPlan.Plan(b, p);
            BbBarRun bot = r.Bars.Single(x => x.Role == BbRunRole.Bottom);
            double lan = BbRebarCode.Anchorage(p.Bottom.D, p.Steel, p.Concrete);
            Assert.Near(0, bot.HookStart + bot.HookEnd, 1e-9);
            // Хэрэглэгч: энгийн каркаст алс нүүрээс 100 хангалттай (нормын анкерлах урт заавал биш).
            Assert.Near(-600 - 100, bot.X0, 1e-6);
            Assert.Near(5800 + 600 + 100, bot.X1, 1e-6);
            // Хажуугийн арматур тулгуурын дотроо хэвээр.
            Assert.True(r.Bars.Where(x => x.Role == BbRunRole.Side).All(x => x.X0 > -600 && x.X1 < 6400));
        }

        [Test]
        public static void NiceLengthsAndSideBarsByHeight()
        {
            // Хэрэглэгч: 330 → 350, 220 → 200, 185 → 190, 480 → 500, 320 → 300.
            Assert.Near(350, BbBeamRebarPlan.NiceRound(330), 1e-9);
            Assert.Near(200, BbBeamRebarPlan.NiceRound(220), 1e-9);
            Assert.Near(190, BbBeamRebarPlan.NiceRound(185), 1e-9);
            Assert.Near(500, BbBeamRebarPlan.NiceRound(480), 1e-9);
            Assert.Near(300, BbBeamRebarPlan.NiceRound(320), 1e-9);
            // 1 хажуугийн = яг голд (600 → 300); 2 = өндрийг 3 хувааж ирмэгээс бүхэл (550/3 = 183 → 180, дээд нь 550 − 180).
            BbBeamPreset p = BbBeamPreset.Ordinary(400);
            BbBeamRebar r = BbBeamRebarPlan.Plan(Span(6450, 600, 500, 600), p);
            Assert.Eq(1, r.TieZ.Length);
            Assert.Near(300, r.TieZ[0], 1e-9);
            p.SideRows = 2;
            BbBeamRebar r2 = BbBeamRebarPlan.Plan(Span(6000, 550, 600, 600), p);
            Assert.Eq("370 180", string.Join(" ", r2.TieZ.Select(z => Math.Round(z))));
            // Доод U-ийн хөл: харагдах урт (тэнхлэг + d/2) бүхэл.
            BbBarRun bot = r.Bars.First(b => b.Role == BbRunRole.Bottom && b.HookStart > 0);
            Assert.Near(0, (bot.HookStart + bot.D / 2.0) % 50, 1e-6);
        }

        [Test]
        public static void OrdinaryBottomBarsPassInteriorColumnBy100()
        {
            // Хэрэглэгч / ЖИШЭЭ-4 ДН-7: голын тулгуур дээр алгасал бүрийн доод арматур баганын алс нүүрээс 100 гарна (-420…7100, 6400…13500).
            var beam = new BbBeamInput { Length = 19900, B = 400, H = 500 };
            foreach (var s in new[] { new[] { -500.0, 0 }, new[] { 6500.0, 7000 }, new[] { 12900.0, 13400 }, new[] { 19900.0, 20400 } }) beam.Supports.Add(new BbSupport(s[0], s[1]));
            BbBeamRebar r = BbBeamRebarPlan.Plan(beam, BbBeamPreset.Ordinary(400));
            List<BbBarRun> bot = r.Bars.Where(x => x.Role == BbRunRole.Bottom).OrderBy(x => x.X0).ToList();
            Assert.Eq(3, bot.Count);
            Assert.Near(7000 + 100, bot[0].X1, 1e-6);
            Assert.Near(6500 - 100, bot[1].X0, 1e-6);
            Assert.Near(13400 + 100, bot[1].X1, 1e-6);
            Assert.Near(12900 - 100, bot[2].X0, 1e-6);
            Assert.True(bot[0].HookEnd == 0 && bot[1].HookStart == 0 && bot[1].HookEnd == 0 && bot[2].HookStart == 0, "голын тулгуурт хөлгүй");
            Assert.True(bot[0].HookStart > 0 && bot[2].HookEnd > 0, "захын тулгуурт хөлтэй");
        }

        [Test]
        public static void Example4CantileverHooksAtTip()
        {
            // ДН-4-1 (хэрэглэгчийн засвар): консол 1700, тулгуур эхэнд — доод нь үзүүрт дээш хөлтэй, тулгуурт шулуун; дээдийн үзүүрийн хөл доод
            // эгнээнээс 30 дээш.
            var beam = new BbBeamInput { Length = 1700, B = 400, H = 500 };
            beam.Supports.Add(new BbSupport(-500, 0));
            BbBeamPreset p = BbBeamPreset.Ordinary(400);
            BbBeamRebar r = BbBeamRebarPlan.Plan(beam, p);
            BbBarRun bot = r.Bars.Single(x => x.Role == BbRunRole.Bottom), top = r.Bars.Single(x => x.Role == BbRunRole.Top);
            Assert.Near(0, bot.HookStart, 1e-9);
            Assert.True(bot.HookEnd >= 240, "доод үзүүрт хөл " + bot.HookEnd);
            double legMax = top.Z - bot.Z;
            // legMax − 30, харагдах урт (тэнхлэг + d/2) бүхэл: 50-ийн үржвэр.
            Assert.Near(0, (top.HookEnd + 8) % 50, 1e-6);
            Assert.True(top.HookEnd <= legMax - 30 + 5, "хөл " + top.HookEnd);

            // Үзүүрийг 300 өргөн хаалтын дамнуруу тэнхлэгээр нь дайрна (ДН-4 / ТДН-3): арматур түүний алс нүүрээс хамгаалах үе + d/2 дотор.
            beam.TipExtEnd = 150;
            BbBeamRebar rt = BbBeamRebarPlan.Plan(beam, p);
            Assert.Near(1700 + 150 - p.Cover - 8, rt.Bars.Single(x => x.Role == BbRunRole.Top).X1, 1e-6);
            Assert.Near(1700 + 150 - p.Cover - 8, rt.Bars.Single(x => x.Role == BbRunRole.Bottom).X1, 1e-6);
        }

        [Test]
        public static void OrdinaryLoadPointGetsBentBarsAndDenseStirrups()
        {
            // Үндсэн дамнуруунд туслах тулвал (ЖИШЭЭ 3-ын адил): муруй арматур + туслахын нүүр бүрээс 3@50.
            BbBeamInput beam = Span(6000, 550, 600, 600);
            beam.LoadPoints = new List<BbLoadPoint> { new BbLoadPoint(2220, 2470, 400) };
            BbBeamRebar r = BbBeamRebarPlan.Plan(beam, BbBeamPreset.Ordinary(400));
            Assert.Eq(1, r.Bent.Count);
            Assert.Eq(3, r.Bent[0].Y.Length);
            Assert.True(r.Stirrups.Any(s => Math.Abs(s.X0 + (s.Count - 1) * s.Spacing - (2220 - 50)) < 1 && s.Spacing == 50 && s.Count == 3), "туслахын өмнө 3@50: " + Sets(r));
            Assert.True(r.Stirrups.Any(s => Math.Abs(s.X0 - (2470 + 50)) < 1 && s.Spacing == 50 && s.Count == 3), "туслахын дараа 3@50: " + Sets(r));
        }

        [Test]
        public static void TopContinuesAcrossHeightChange()
        {
            // ЖИШЭЭ-4 ДН-4: 400×600 (цэвэр 6450) → багана 600 → 400×500 (цэвэр 5800): 400×600-ийн дээд нь 400×500-д ⅓·5800 ≈ 1950 хүртэл, хөлгүй;
            // 400×500 тэр баганад өөрөө тавихгүй.
            BbBeamInput a = Span(6450, 600, 500, 600);
            a.ContinueTopEnd = 5800;
            BbBeamRebar ra = BbBeamRebarPlan.Plan(a, BbBeamPreset.Ordinary(400));
            BbBarRun last = ra.Bars.Where(b => b.Role == BbRunRole.Top).OrderBy(b => b.X1).Last();
            Assert.Near(6450 + 600 + 1950, last.X1, 1e-6);
            Assert.Near(0, last.HookEnd, 1e-6);

            BbBeamInput b2 = Span(5800, 500, 600, 600);
            b2.ContinueTopStart = true;
            BbBeamRebar rb = BbBeamRebarPlan.Plan(b2, BbBeamPreset.Ordinary(400));
            List<BbBarRun> topB = rb.Bars.Where(b => b.Role == BbRunRole.Top).ToList();
            Assert.Eq(1, topB.Count);
            Assert.True(topB[0].X0 > 0, "эхний тулгуурын дээд арматур өмнөх хэсгийнх");

            // Хөрш нь консол (1278, h500): үзүүрээс хамгаалах үе хүртэл, хөл нь консолын өндрөөр (600-гийнхаас 100 богино).
            BbBeamInput c = Span(6450, 600, 500, 500);
            c.ContinueTopEnd = 1278; c.ContinueTopEndTip = true; c.ContinueTopEndH = 500;
            BbBeamPreset pc = BbBeamPreset.Ordinary(400);
            BbBeamRebar rc = BbBeamRebarPlan.Plan(c, pc);
            BbBarRun tip = rc.Bars.Where(b => b.Role == BbRunRole.Top).OrderBy(b => b.X1).Last();
            Assert.Near(6450 + 500 + 1278 - pc.Cover - 8, tip.X1, 1e-6);   // үзүүрээс хамгаалах үе + d/2
            // legMax(h600) = 518 → консолд 418, доод эгнээнээс 30 дээш → 388; харагдах 396 → 400 → тэнхлэг 392.
            Assert.Near(392, tip.HookEnd, 1e-6);
        }

        [Test]
        public static void TieDiameterUsedForSideTies()
        {
            var beam = new BbBeamInput { Length = 6000, B = 600, H = 800, Supports = { new BbSupport(-300, 300), new BbSupport(5700, 6300) } };
            BbBeamPreset p = BbBeamPreset.Company(600);
            p.StirrupD = 10;
            p.TieD = 8;
            BbBeamRebar r = BbBeamRebarPlan.Plan(beam, p);
            Assert.True(r.Ties.Count > 0);
            Assert.True(r.Ties.All(t => t.D == 8));
            Assert.True(r.Stirrups.All(t => t.D == 10));
        }

        [Test]
        public static void StyleRoundTripsThroughBookJson()
        {
            var book = new BbRebarBook { Style = Example3() };
            BbRebarBook back = BbRebarBook.FromJson(BbJson.Parse(BbJson.Write(book.ToJson())));
            Assert.True(back.Style != null && back.LearnStyle);
            Assert.Eq(13, back.Style.Chains);
            Assert.Near(50, back.Style.CoverTopByDir[90], 1e-9);
            Assert.Eq(5, back.Style.BentNByWidth[600]);
            Assert.True(back.Style.Transition == false);
            Assert.Eq("⌀16_A400", back.Style.TypeNames["bent:16"]);
            Assert.Eq(12, back.Style.StirrupDBySize["600x1150"]);
            Assert.True(BbRebarBook.FromJson(BbJson.Parse(BbJson.Write(new BbRebarBook().ToJson()))).Style == null);
        }
            [Test]
        public static void Example3StirrupZoneCounts()
        {
            // ЖИШЭЭ 3-аас хэмжсэн (цэвэр алгасал → нягт / гол / нягт): 5750 → 20/9/20, 5450 → 19/9/19, 4976 → 17/8/17, 4316 → 15/7/15, 5650 → 19/9/19.
            foreach (var c in new[] { new[] { 5750, 20, 9 }, new[] { 5450, 19, 9 }, new[] { 4976, 17, 8 }, new[] { 4316, 15, 7 }, new[] { 5650, 19, 9 } })
            {
                var beam = new BbBeamInput { Length = c[0], B = 600, H = 600 };
                beam.Supports.Add(new BbSupport(-400, 0));
                beam.Supports.Add(new BbSupport(c[0], c[0] + 400));
                BbBeamPreset p = BbBeamPreset.Company(600);
                p.AverageTransition = false;
                BbBeamRebar r = BbBeamRebarPlan.Plan(beam, p);
                var sets = r.Stirrups.OrderBy(x => x.X0).ToList();
                Assert.Eq(3, sets.Count, "алгасал " + c[0]);
                Assert.Eq(c[1], sets[0].Count, "нягт " + c[0]);
                Assert.Eq(c[2], sets[1].Count, "гол " + c[0]);
                Assert.Eq(c[1], sets[2].Count, "нягт баруун " + c[0]);
                Assert.Near(50, sets[0].X0, 1e-9);
                Assert.Near(c[0] - 50, sets[2].X0 + (sets[2].Count - 1) * sets[2].Spacing, 1e-9);
                double g1 = sets[1].X0 - (sets[0].X0 + (sets[0].Count - 1) * 100), g2 = sets[2].X0 - (sets[1].X0 + (sets[1].Count - 1) * 200);
                Assert.True(g1 >= 50 && g1 <= 200 && Math.Abs(g1 - g2) < 1e-6, "завсар " + g1 + "/" + g2);
            }
        }
            [Test]
        public static void Example3LoadPointStirrups()
        {
            // ЖИШЭЭ 3 ДН-1-8 (400×700): цэвэр 7050, туслах 1850–2050, 4600–4800 (200×400), 5250–5550, 6600–6900 (300×500).
            var beam = new BbBeamInput { Length = 7050, B = 400, H = 700 };
            beam.Supports.Add(new BbSupport(-1400, 0));
            beam.Supports.Add(new BbSupport(7050, 8250));
            beam.LoadPoints = new List<BbLoadPoint> { new BbLoadPoint(1850, 2050, 400), new BbLoadPoint(4600, 4800, 400), new BbLoadPoint(5250, 5550, 500), new BbLoadPoint(6600, 6900, 500) };
            BbBeamPreset p = BbBeamPreset.Company(400);
            p.AverageTransition = false;
            p.LoadPointBand = 0;
            BbBeamRebar r = BbBeamRebarPlan.Plan(beam, p);
            string got = string.Join(" ", r.Stirrups.OrderBy(x => x.X0).Select(x => x.X0 + (x.Count > 1 ? "x" + x.Count + "@" + x.Spacing : "")));
            // Жишээнд гол нь 2300…4300; бид ДДН-ийн олонхын дүрмээр (гол хэсгийг төвд) 2325…4325 — ±25.
            Assert.Eq("50x17@100 1700x3@50 2100x3@50 2325x11@200 4450x3@50 4850x3@50 5100x3@50 5600x3@50 5800x7@100 6450x3@50 6950x2@50", got);
        }
            [Test]
        public static void Example1LoadPointStirrupsWithBand()
        {
            // ЖИШЭЭ-1 ДН-2 алгасал 2: цэвэр 6800, туслах 1850–2150, 4650–4950 (300×500); туслахын хажууд @100 зурвас, гол @200.
            var beam = new BbBeamInput { Length = 6800, B = 600, H = 800 };
            beam.Supports.Add(new BbSupport(-600, 0));
            beam.Supports.Add(new BbSupport(6800, 7400));
            beam.LoadPoints = new List<BbLoadPoint> { new BbLoadPoint(1850, 2150, 500), new BbLoadPoint(4650, 4950, 500) };
            BbBeamRebar r = BbBeamRebarPlan.Plan(beam, BbBeamPreset.Company(600));
            string got = string.Join(" ", r.Stirrups.OrderBy(x => x.X0).Select(x => x.X0 + (x.Count > 1 ? "x" + x.Count + "@" + x.Spacing : "")));
            Assert.Eq("50x17@100 1700x3@50 2200x3@50 2400x7@100 3200x4@200 3900x6@100 4500x3@50 5000x3@50 5150x17@100", got);
        }
    }
}
