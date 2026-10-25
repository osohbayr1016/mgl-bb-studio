using System;
using System.Collections.Generic;
using System.Linq;
using MglBb.Core;

namespace MglBb.Tests
{
    public static class RebarPlanTests
    {
        [Test]
        public static void AnchorageAndLapFollowSp52101()
        {
            // l0,an = Rs·d / (4·η1·η2·Rbt·γb1): A500 Ø20 B25 = 435·20 / (4·2.5·1.05·0.9) = 920.6 → 930.
            Assert.Near(920.63, BbRebarCode.BasicAnchorage(20, BbSteel.A500, "B25"), 0.01);
            Assert.Near(930, BbRebarCode.Anchorage(20, BbSteel.A500, "B25"), 1e-9);
            Assert.Near(760, BbRebarCode.Anchorage(20, BbSteel.A400, "В25"), 1e-9);   // кирилл «В»
            Assert.Near(910, BbRebarCode.Lap(20, BbSteel.A400, "B25"), 1e-9);
            Assert.Near(1510, BbRebarCode.Lap(20, BbSteel.A400, "B25", allInOneSection: true), 1e-9);
            // Шахалт α = 0.75: 0.75·450.8 = 338.1 → 340 (≥ 15d = 180, ≥ 200).
            Assert.Near(340, BbRebarCode.Anchorage(12, BbSteel.A400, "B25", tension: false), 1e-9);
            // A240 η1 = 1.5: 1.2·379.2 = 455.0 → 460.
            Assert.Near(460, BbRebarCode.Lap(10, BbSteel.A240, "B25"), 1e-9);
            // d > 32 → η2 = 0.9.
            Assert.Near(1841.3, BbRebarCode.BasicAnchorage(36, BbSteel.A500, "B25"), 0.1);
        }

        [Test]
        public static void CoverClearAndStirrupMinimums()
        {
            Assert.Near(25, BbRebarCode.MinCover(25, BbExposure.Indoor), 1e-9);
            Assert.Near(30, BbRebarCode.MinCover(12, BbExposure.Outdoor), 1e-9);
            Assert.Near(25, BbRebarCode.MinClear(16, false), 1e-9);
            Assert.Near(37.5, BbRebarCode.MinClear(25, true), 1e-9);
            Assert.Eq(8, BbRebarCode.MinStirrupDiameter(25, 600));
            Assert.Eq(8, BbRebarCode.MinStirrupDiameter(16, 900));
            Assert.Eq(6, BbRebarCode.MinStirrupDiameter(16, 500));
            Assert.Near(280.5, BbRebarCode.MaxStirrupSupport(561), 1e-9);
            Assert.Near(500, BbRebarCode.MaxStirrupMid(800), 1e-9);
        }

        [Test]
        public static void PickBarsFindsSmallestAreaThatFits()
        {
            // 300 өргөн, хамгаалах 25 + хомут 8 → w = 234; As = 900: 8Ø12 багтахгүй, 6Ø14 = 923.6 хамгийн бага.
            BbBarSpec s = BbRebarCode.PickBars(900, 234, false);
            Assert.Eq(6, s.N);
            Assert.Eq(14, s.D);
            Assert.Eq("6Ø14", s.ToString());
            Assert.True(BbRebarCode.Fits(6, 14, 234, true), "6·14 + 5·30 = 234 яг багтана");
            Assert.False(BbRebarCode.PickBars(5000, 100, false).Any);
        }

        /// <summary>2 алгаслын дамнуруу 300×600: багана 400 (0…400, 6200…6600, 12200…12600), B25, A500, хамгаалах 25.</summary>
        static BbBeamInput TwoSpans()
        {
            return new BbBeamInput
            {
                Length = 12600, B = 300, H = 600,
                Supports = new List<BbSupport> { new BbSupport(0, 400), new BbSupport(6200, 6600), new BbSupport(12200, 12600) },
            };
        }

        [Test]
        public static void TwoSpanMainBarsAnchorAndSplice()
        {
            BbBeamRebar r = BbBeamRebarPlan.Plan(TwoSpans(), new BbBeamPreset());
            Assert.Eq(6, r.StirrupD);
            Assert.Near(561, r.H0, 1e-9);
            Assert.Near(250, r.S1, 1e-9);
            Assert.Near(400, r.S2, 1e-9);
            Assert.Eq(2, r.Spans.Count);
            Assert.Near(890, r.LapTop, 1e-9);

            // 12550 > 11700 → дээд нь 2-р алгаслын голд (9400), доод нь дунд тулгуур дээр (6400) давхцана.
            List<BbBarRun> top = r.Bars.Where(b => b.Role == BbRunRole.Top).OrderBy(b => b.X0).ToList();
            Assert.Eq(2, top.Count);
            Assert.Near(25 + 8, top[0].X0, 1e-6);   // тэнхлэг = хамгаалах үе + d/2
            Assert.Near(9845, top[0].X1, 1e-6);
            Assert.Near(8955, top[1].X0, 1e-6);
            Assert.Near(12567, top[1].X1, 1e-6);
            // Анкерлах 740 > шулуун 367 → хөл 380; зөвхөн гадна төгсгөлд.
            Assert.Near(380, top[0].HookStart, 1e-9);
            Assert.Near(0, top[0].HookEnd, 1e-9);
            Assert.Near(380, top[1].HookEnd, 1e-9);
            Assert.True(top.All(b => b.Length <= 11700));

            List<BbBarRun> bot = r.Bars.Where(b => b.Role == BbRunRole.Bottom).OrderBy(b => b.X0).ToList();
            Assert.Eq(2, bot.Count);
            Assert.Near(6845, bot[0].X1, 1e-6);
            Assert.Near(5955, bot[1].X0, 1e-6);
            Assert.Near(31 + 8, bot[0].Z, 1e-9);
            Assert.Near(600 - 31 - 8, top[0].Z, 1e-9);
            Assert.Eq(0, r.Warnings.Count, string.Join("; ", r.Warnings));
        }

        [Test]
        public static void ThreeZoneStirrupsPerSpan()
        {
            BbBeamRebar r = BbBeamRebarPlan.Plan(TwoSpans(), new BbBeamPreset());
            // Алгасал 400…6200: 450-аас 6×@250 (…1700), гол 8×@400 (1900…4700), 4900-аас 6×@250 (…6150).
            List<BbStirrupSet> s = r.Stirrups.Where(x => x.Span == 0).OrderBy(x => x.X0).ToList();
            Assert.Eq(3, s.Count);
            Assert.Near(450, s[0].X0, 1e-6);
            Assert.Eq(6, s[0].Count);
            Assert.Near(250, s[0].Spacing, 1e-9);
            Assert.Near(1900, s[1].X0, 1e-6);
            Assert.Eq(8, s[1].Count);
            Assert.Near(4700, s[1].X1, 1e-6);
            Assert.Near(4900, s[2].X0, 1e-6);
            Assert.Near(6150, s[2].X1, 1e-6);
            Assert.Eq(6, r.Stirrups.Count);
        }

        [Test]
        public static void AdditionalBarsShareRowAndExtendOverSupports()
        {
            var p = new BbBeamPreset { AddTop = new BbBarSpec(2, 16), AddBottom = new BbBarSpec(2, 16) };
            p.AddTopBySupport = new BbBarSpec?[] { null, new BbBarSpec(2, 20), null };   // LIRA: дунд тулгуур дээр их
            BbBeamRebar r = BbBeamRebarPlan.Plan(TwoSpans(), p);

            // 2Ø16 + 2Ø20 нэг эгнээнд (w = 238): үндсэн булангуудад, нэмэлт завсарт.
            BbBarRun main = r.Bars.First(b => b.Role == BbRunRole.Top);
            Assert.Eq(2, main.N);
            List<BbBarRun> add = r.Bars.Where(b => b.Role == BbRunRole.AddTop).OrderBy(b => b.X0).ToList();
            Assert.Eq(3, add.Count);
            Assert.True(add.All(b => b.Layer == 1));
            Assert.True(add.All(b => b.Y.All(y => y > main.Y.Min() && y < main.Y.Max())));

            // Захын тулгуур: 25 + d/2 (хөлтэй) … 400 + ¼·5800; дунд: нүүрээс ⅓·5800.
            Assert.Near(25 + 8, add[0].X0, 1e-6);
            Assert.True(add[0].HookStart > 0);
            Assert.Near(1850, add[0].X1, 1e-6);
            Assert.Eq(20, add[1].D);
            Assert.Near(6200 - 5800.0 / 3, add[1].X0, 1e-6);
            Assert.Near(6600 + 5800.0 / 3, add[1].X1, 1e-6);
            Assert.Near(12200 - 0.25 * 5600, add[2].X0, 1e-6);   // 2-р алгасал 6600…12200

            List<BbBarRun> ab = r.Bars.Where(b => b.Role == BbRunRole.AddBottom).OrderBy(b => b.X0).ToList();
            Assert.Eq(2, ab.Count);
            Assert.Near(980, ab[0].X0, 1e-6);
            Assert.Near(5620, ab[0].X1, 1e-6);
        }

        [Test]
        public static void AdditionalBottomKeepsMainBarPositions()
        {
            // Хэрэглэгч: нэмэлт доод нь үндсэн доодын байрлалыг хөдөлгөхгүй — завсарт нь орно (AddBottomRowGap = 0 үед нэг эгнээ).
            var p0 = new BbBeamPreset { Bottom = new BbBarSpec(3, 16) };
            var p1 = new BbBeamPreset { Bottom = new BbBarSpec(3, 16), AddBottom = new BbBarSpec(2, 12), AddBottomRowGap = 0 };
            double[] y0 = BbBeamRebarPlan.Plan(TwoSpans(), p0).Bars.First(b => b.Role == BbRunRole.Bottom).Y;
            BbBeamRebar r = BbBeamRebarPlan.Plan(TwoSpans(), p1);
            double[] y1 = r.Bars.First(b => b.Role == BbRunRole.Bottom).Y;
            Assert.Eq(y0.Length, y1.Length);
            for (int i = 0; i < y0.Length; i++) Assert.Near(y0[i], y1[i], 1e-6);
            BbBarRun add = r.Bars.First(b => b.Role == BbRunRole.AddBottom);
            Assert.Eq(1, add.Layer);
            Assert.Near((y0[0] + y0[1]) / 2, add.Y.Min(), 1e-6);
            Assert.Near((y0[1] + y0[2]) / 2, add.Y.Max(), 1e-6);
        }

        [Test]
        public static void AdditionalBottomSits60AboveMainBottom()
        {
            // Хэрэглэгч: нэмэлт доод үргэлж 2-р эгнээнд, үндсэн доодоос дээш 60 мм цэвэр зайтай.
            var p = new BbBeamPreset { Bottom = new BbBarSpec(3, 16), AddBottom = new BbBarSpec(2, 12) };
            BbBeamRebar r = BbBeamRebarPlan.Plan(TwoSpans(), p);
            BbBarRun main = r.Bars.First(b => b.Role == BbRunRole.Bottom), add = r.Bars.First(b => b.Role == BbRunRole.AddBottom);
            Assert.Eq(2, add.Layer);
            Assert.Near(60, add.Z - main.Z - (16 + 12) / 2.0, 1e-6);
        }

        [Test]
        public static void AdditionalBarsGoToSecondLayerWhenRowIsFull()
        {
            var p = new BbBeamPreset { Top = new BbBarSpec(3, 25), AddTop = new BbBarSpec(3, 25) };
            BbBeamRebar r = BbBeamRebarPlan.Plan(TwoSpans(), p);
            BbBarRun main = r.Bars.First(b => b.Role == BbRunRole.Top);
            BbBarRun add = r.Bars.First(b => b.Role == BbRunRole.AddTop);
            Assert.Eq(2, add.Layer);
            // 2-р эгнээ: цэвэр зай 1.5·25 = 37.5.
            Assert.Near(main.Z - 25 - 37.5, add.Z, 1e-9);
        }

        [Test]
        public static void CantileverGetsFullTopHookAndUniformStirrups()
        {
            var beam = new BbBeamInput
            {
                Length = 7000, B = 300, H = 600,
                Supports = new List<BbSupport> { new BbSupport(0, 400), new BbSupport(5000, 5400) },
            };
            BbBeamRebar r = BbBeamRebarPlan.Plan(beam, new BbBeamPreset());
            Assert.Eq(2, r.Spans.Count);
            BbBarRun top = r.Bars.Single(b => b.Role == BbRunRole.Top);
            Assert.Near(600 - 2 * 31 - 16, top.HookEnd, 1e-9);   // дээд ба доод эгнээний төв хооронд
            BbBarRun bot = r.Bars.Single(b => b.Role == BbRunRole.Bottom);
            Assert.Near(0, bot.HookEnd, 1e-9);
            List<BbStirrupSet> c = r.Stirrups.Where(s => s.Span == 1).ToList();
            Assert.Eq(1, c.Count);
            Assert.Near(5450, c[0].X0, 1e-6);
            Assert.Near(6975, c[0].X1, 1e-6);
            Assert.True(c[0].Spacing <= 250 + 1e-9);
        }

        [Test]
        public static void CustomStirrupPattern()
        {
            var p = new BbBeamPreset { StirrupPattern = "4*200+5*300" };
            BbBeamRebar r = BbBeamRebarPlan.Plan(TwoSpans(), p);
            List<BbStirrupSet> s = r.Stirrups.Where(x => x.Span == 0).OrderBy(x => x.X0).ToList();
            Assert.Eq(3, s.Count);
            Assert.Eq(5, s[0].Count);
            Assert.Near(1250, s[0].X1, 1e-6);
            Assert.Near(1550, s[1].X0, 1e-6);
            Assert.Near(2750, s[1].X1, 1e-6);
            Assert.Near(6150, s[2].X0, 1e-6);
            Assert.True(r.Warnings.Any(w => w.Contains("сүүлийн завсар")));

            BbBeamRebar bad = BbBeamRebarPlan.Plan(TwoSpans(), new BbBeamPreset { StirrupPattern = "4-200" });
            Assert.True(bad.Warnings.Any(w => w.Contains("буруу")));
        }

        [Test]
        public static void SplitFallsBackWhenNoGoodZone()
        {
            var r = new BbBeamRebar();
            List<double[]> seg = BbBeamRebarPlan.Split(0, 20000, 0, 0, 800, 11700, new double[0], r, "Дээд");
            Assert.Eq(2, seg.Count);
            Assert.Near(11700, seg[0][1], 1e-6);
            Assert.Near(10900, seg[1][0], 1e-6);
            Assert.Eq(1, r.Warnings.Count);
        }

        /// <summary>ЖИШЭЭ-1 маягийн 600×700: багана 1200 (тэнхлэг 0, 7000, 14500), цэвэр алгасал 5800 ба 6300.</summary>
        static BbBeamInput Company2()
        {
            return new BbBeamInput
            {
                Length = 14500, B = 600, H = 700,
                Supports = new List<BbSupport> { new BbSupport(-600, 600), new BbSupport(6400, 7600), new BbSupport(13900, 15100) },
            };
        }

        [Test]
        public static void CompanyTopBarsAreSupportBarsPlusSpanBars()
        {
            BbBeamRebar r = BbBeamRebarPlan.Plan(Company2(), BbBeamPreset.Company(600));
            List<BbBarRun> top = r.Bars.Where(b => b.Role == BbRunRole.Top).OrderBy(b => b.X0).ToList();
            Assert.Eq(3, top.Count);
            // Захын тулгуур: баганын алс нүүрээс 66, бүтэн хөл доош (дээд 627.5 … доод 52.5).
            Assert.Near(-534, top[0].X0, 1e-6);
            Assert.Near(575, top[0].HookStart, 1e-6);
            // ⅓l + 550, нүүрээс 50-аар дээш (2483 → 2500).
            Assert.Near(600 + 2500, top[0].X1, 1e-6);
            Assert.Near(6400 - 2500, top[1].X0, 1e-6);   // тал бүр өөрийн алгаслаар
            Assert.Near(7600 + 2650, top[1].X1, 1e-6);
            Assert.Near(15034, top[2].X1, 1e-6);
            Assert.Near(700 - 52 - 8 - 12.5, top[0].Z, 1e-9);

            // Голд 6Ø12 ⅓…⅔, тулгуурынхтай 550 давхцана, доор нь шүргэж.
            List<BbBarRun> mid = r.Bars.Where(b => b.Role == BbRunRole.SpanTop).OrderBy(b => b.X0).ToList();
            Assert.Eq(2, mid.Count);
            Assert.Eq(12, mid[0].D);
            Assert.Eq(6, mid[0].N);
            Assert.Near(550, top[0].X1 - mid[0].X0, 1e-6);
            Assert.Near(550, mid[0].X1 - top[1].X0, 1e-6);
            Assert.Near(top[0].Z - 18.5, mid[0].Z, 1e-9);
        }

        [Test]
        public static void CompanyBottomBarsLapAtThirdSpanAndBendUp()
        {
            BbBeamRebar r = BbBeamRebarPlan.Plan(Company2(), BbBeamPreset.Company(600));
            List<BbBarRun> bot = r.Bars.Where(b => b.Role == BbRunRole.Bottom).OrderBy(b => b.X0).ToList();
            Assert.Eq(2, bot.Count);
            Assert.Near(-490, bot[0].X0, 1e-6);                 // алс нүүрээс 110
            Assert.Near(400, bot[0].HookStart, 1e-6);           // 15·25 = 375 → 400
            Assert.Near(1390, r.LapBottom, 1e-9);               // Ø25 хүснэгтэд байхгүй → норм
            // Холбоосын төв 2-р алгаслын нүүрээс ⅓ (7600 + 2100 = 9700).
            Assert.Near(9700, (bot[0].X1 + bot[1].X0) / 2, 1e-6);
            Assert.True(bot.All(b => b.Length <= 12000));
            // ЖИШЭЭ-1-ийн Ø22 давхцал 1100 < нормын 1.2·l0,an = 1220 → норм зөрчихгүй (анхааруулгатай); EnforceCode = false бол хүснэгтийнх.
            BbBeamRebar r22 = BbBeamRebarPlan.Plan(Company2(), CompanyWith(22));
            Assert.Near(1220, r22.LapBottom, 1e-9);
            Assert.True(r22.Warnings.Any(w => w.Contains("нормынхыг")));
            BbBeamPreset loose = CompanyWith(22);
            loose.EnforceCode = false;
            Assert.Near(1100, BbBeamRebarPlan.Plan(Company2(), loose).LapBottom, 1e-9);
        }

        static BbBeamPreset CompanyWith(int d)
        {
            BbBeamPreset p = BbBeamPreset.Company(600);
            p.Bottom = new BbBarSpec(6, d);
            return p;
        }

        [Test]
        public static void CompanyStirrupsSideBarsAndTies()
        {
            BbBeamRebar r = BbBeamRebarPlan.Plan(Company2(), BbBeamPreset.Company(600));
            Assert.Eq(8, r.StirrupD);
            // 650-аас 20 @100 (…2550), 150 завсар, 9 @200 (2700…4300), 150, 4450-аас 20 @100 (…6350).
            List<BbStirrupSet> s = r.Stirrups.Where(x => x.Span == 0).OrderBy(x => x.X0).ToList();
            Assert.Eq(3, s.Count);
            Assert.Near(650, s[0].X0, 1e-6);
            Assert.Near(2550, s[0].X1, 1e-6);
            Assert.Near(2700, s[1].X0, 1e-6);
            Assert.Near(4300, s[1].X1, 1e-6);
            Assert.Near(200, s[1].Spacing, 1e-9);
            Assert.Near(4450, s[2].X0, 1e-6);
            Assert.Near(6350, s[2].X1, 1e-6);

            // 4 салаа: давхардсан хоёр битүү, тус бүр 338 (ЖИШЭЭ-1 b600 → 338…340).
            Assert.Eq(2, r.StirrupWidths.Count);
            Assert.Near(338, r.StirrupWidths[0][1] - r.StirrupWidths[0][0], 1e-6);
            Assert.Near(338, r.StirrupWidths[1][1] - r.StirrupWidths[1][0], 1e-6);

            // h700 → хажуугийн Ø12 хоёр эгнээ (дээрээс ≈264 / 456), C-хомут ≤ 400.
            List<BbBarRun> side = r.Bars.Where(b => b.Role == BbRunRole.Side).ToList();
            Assert.Eq(2, r.TieZ.Length);
            Assert.True(side.All(b => b.D == 12 && b.N == 2));
            Assert.Near(700 - 627.5 + 575.0 / 3, 700 - r.TieZ[0], 1e-6);
            Assert.True(r.Ties.Where(t => t.Span == 0).All(t => t.Spacing <= 400 + 1e-9));
            Assert.Eq(0, r.Warnings.Count, string.Join("; ", r.Warnings));
        }

        [Test]
        public static void CompanyLoadPointGetsDenseStirrupsAndBentBars()
        {
            BbBeamInput beam = Company2();
            beam.LoadPoints.Add(new BbLoadPoint(3350, 3650, 500));   // туслах 300×500
            BbBeamRebar r = BbBeamRebarPlan.Plan(beam, BbBeamPreset.Company(600));
            List<double> xs = r.Stirrups.Where(x => x.Span == 0)
                .SelectMany(x => Enumerable.Range(0, x.Count).Select(k => x.X0 + k * x.Spacing)).OrderBy(x => x).ToList();
            // Туслахын нүүр бүрээс 50, 100, 150; өргөнд нь хомутгүй.
            foreach (double x in new[] { 3200.0, 3250, 3300, 3700, 3750, 3800 })
                Assert.True(xs.Any(v => Math.Abs(v - x) < 1e-6), "хомут x=" + x);
            Assert.False(xs.Any(v => v > 3300 + 1e-6 && v < 3700 - 1e-6));
            Assert.True(xs.Zip(xs.Skip(1), (a, b) => a == 3300 ? 0 : b - a).All(g => g <= 100 + 1e-6), "туслахаас бусад завсар ≤ 100");

            BbBentBar bent = r.Bent.Single();
            Assert.Eq(16, bent.D);
            Assert.Near(360, bent.Flat, 1e-9);                  // 300 + 60
            Assert.Near(150, bent.ZLow, 1e-9);                  // туслахын доод нүүрээс 50 доош
            Assert.Near(-200, bent.Y[0] - 300, 1e-6);           // ЖИШЭЭ-1: ±200
            Assert.Near(200, bent.Y[3] - 300, 1e-6);
            Assert.Near(3500 - 180 - 477.5 - 480, bent.X0, 1e-6);
        }

        [Test]
        public static void StirrupLayoutsSingleInnerAndC()
        {
            // 600×700, 6Ø25: ширхгийн төв 52.5 … 547.5 (алхам 99).
            BbBeamPreset p = BbBeamPreset.Company(600);
            p.Layout = BbStirrupLayout.Single;
            BbBeamRebar r = BbBeamRebarPlan.Plan(Company2(), p);
            Assert.Eq(1, r.StirrupShapes.Count);
            Assert.Near(32, r.StirrupShapes[0].X0, 1e-9);
            Assert.Near(568, r.StirrupShapes[0].X1, 1e-9);
            Assert.Near(32, r.StirrupShapes[0].Y0, 1e-9);
            Assert.Near(700 - 52, r.StirrupShapes[0].Y1, 1e-9);

            p.Layout = BbStirrupLayout.OuterInner;
            r = BbBeamRebarPlan.Plan(Company2(), p);
            Assert.Eq(2, r.StirrupShapes.Count);
            Assert.Near(230, r.StirrupShapes[1].X0, 1e-6);   // 3-р ширхэг 250.5 − 12.5 − 8
            Assert.Near(370, r.StirrupShapes[1].X1, 1e-6);

            p.Layout = BbStirrupLayout.OuterC;
            r = BbBeamRebarPlan.Plan(Company2(), p);
            List<BbTieShape> cs = r.StirrupShapes.Where(s => !s.Closed).ToList();
            Assert.Eq(2, cs.Count);
            Assert.Near(151.5, cs[0].X0, 1e-6);
            Assert.Near(448.5, cs[1].X0, 1e-6);

            p.Layout = BbStirrupLayout.Pair;
            Assert.Eq(2, BbBeamRebarPlan.Plan(Company2(), p).StirrupShapes.Count(s => s.Closed));
        }

        [Test]
        public static void SeparateCoversSideRowsAndSpanSpacing()
        {
            BbBeamPreset p = BbBeamPreset.Company(600);
            p.CoverBottom = 40;
            p.SideRows = 1;
            p.SideTies = false;
            p.S2BySpan = new double?[] { null, 150 };
            BbBeamRebar r = BbBeamRebarPlan.Plan(Company2(), p);
            Assert.Near(40 + 8 + 12.5, r.Bars.First(b => b.Role == BbRunRole.Bottom).Z, 1e-9);
            Assert.Eq(1, r.TieZ.Length);
            Assert.Eq(0, r.Ties.Count);
            Assert.True(r.Stirrups.Where(s => s.Span == 1 && s.Count > 1).Any(s => Math.Abs(s.Spacing - 150) < 1e-9));
            Assert.False(r.Stirrups.Where(s => s.Span == 0).Any(s => Math.Abs(s.Spacing - 150) < 1e-9));
        }

        [Test]
        public static void CodeIsEnforcedForCoverAndSpacing()
        {
            var p = new BbBeamPreset { Cover = 10, S1 = 400, S2 = 700 };
            BbBeamRebar r = BbBeamRebarPlan.Plan(TwoSpans(), p);
            Assert.True(r.Warnings.Any(w => w.Contains("болгов")));
            Assert.Near(250, r.S1, 1e-9);   // 0.5·h0 (≈ 285) → 250
            Assert.Near(400, r.S2, 1e-9);
            Assert.Near(20 + 6 + 8, r.Bars.First(b => b.Role == BbRunRole.Bottom).Z, 1e-9);   // хамгаалах 20 болсон
        }

        [Test]
        public static void JoinEndContinuesIntoNextSection()
        {
            // 600×700 хэсэг: зүүн талд багана, баруун төгсгөл (7000) өөр огтлолтой хэсэгт тулгуургүй залгагдана.
            var beam = new BbBeamInput { Length = 7000, B = 600, H = 700, JoinEnd = true, Supports = new List<BbSupport> { new BbSupport(-600, 600) } };
            BbBeamRebar r = BbBeamRebarPlan.Plan(beam, BbBeamPreset.Company(600));
            Assert.Eq(1, r.Spans.Count);
            BbBarRun bot = r.Bars.Where(b => b.Role == BbRunRole.Bottom).OrderBy(b => b.X1).Last();
            Assert.Near(7000 + 1160, bot.X1, 1e-6);   // Ø25 A500 B25 анкерлах 1160 шулуун
            Assert.Near(0, bot.HookEnd, 1e-9);
            BbBarRun top = r.Bars.Where(b => b.Role == BbRunRole.Top).OrderBy(b => b.X1).Last();
            Assert.Near(0, top.HookEnd, 1e-9);
            Assert.Near(6950, r.Stirrups.Max(s => s.X1), 1e-6);
        }

        [Test]
        public static void SplitBySelectedSpans()
        {
            // 3 алгасал: багана 0…400, 6200…6600, 12200…12600, 18200…18600; дунд алгаслыг унтраавал 2 бие даасан хэсэг.
            var beam = new BbBeamInput
            {
                Length = 18600, B = 300, H = 600,
                Supports = new List<BbSupport> { new BbSupport(0, 400), new BbSupport(6200, 6600), new BbSupport(12200, 12600), new BbSupport(18200, 18600) },
            };
            Assert.Eq(3, BbBeamRebarPlan.SpanCount(beam));
            var parts = BbBeamRebarPlan.SplitBySpans(beam, new[] { true, false, true });
            Assert.Eq(2, parts.Count);
            Assert.Near(0, parts[0].Item1, 1e-9);
            Assert.Near(6600, parts[0].Item2.Length, 1e-9);
            Assert.Eq(2, parts[0].Item2.Supports.Count);
            Assert.Near(12200, parts[1].Item1, 1e-9);
            Assert.Near(6400, parts[1].Item2.Length, 1e-9);
            Assert.Near(0, parts[1].Item2.Supports[0].Lo, 1e-9);
            Assert.Eq(2, parts[1].Item3);
            // Хэсэг бүр бүтэн дамнуруу шиг: дунд тулгуурын (6200…6600) алс нүүрт L-ээр төгсөнө.
            BbBeamRebar r = BbBeamRebarPlan.Plan(parts[0].Item2, BbBeamPreset.Company(300));
            Assert.Eq(1, r.Spans.Count);
            Assert.True(r.Bars.Where(b => b.Role == BbRunRole.Bottom).All(b => b.X1 <= 6600));
            Assert.Eq(1, BbBeamRebarPlan.SplitBySpans(beam, new[] { true, true, true }).Count);
        }

        [Test]
        public static void BookAppliesSpanRowsLayoutAndSide()
        {
            var book = new BbRebarBook();
            BbRebarRow row = book.Row("ДН-1");
            row.Layout = "OuterC";
            row.Side = "1Ø14";
            row.Span(1).AddBottom = "2Ø20";
            row.Span(1).S2 = 150;
            row.Span(2).AddTop = "3Ø25";
            var errors = new List<string>();
            BbBeamPreset p = book.Preset(row, 600, errors, 1, 2);   // алгасал 1…2
            Assert.Eq(0, errors.Count, string.Join("; ", errors));
            Assert.Eq(BbStirrupLayout.OuterC, p.Layout);
            Assert.Eq(14, p.SideD);
            Assert.Eq(1, p.SideRows);
            Assert.Eq("2Ø20", p.AddBottomBySpan[0].Value.ToString());
            Assert.Near(150, p.S2BySpan[0].Value, 1e-9);
            Assert.Eq("3Ø25", p.AddTopBySupport[1].Value.ToString());
            row.Side = "0";
            Assert.Eq(0, book.Preset(row, 600).SideD);
            string path = System.IO.Path.Combine(System.IO.Path.GetTempPath(), "mglbb-tests", "rebar-book-span.json");
            book.Save(path);
            BbRebarRow r2 = BbRebarBook.Load(path).Row("ДН-1");
            Assert.Eq("OuterC", r2.Layout);
            Assert.Eq("2Ø20", r2.Span(1).AddBottom);
        }

        [Test]
        public static void DeepBeamGetsSideBarsByCode()
        {
            // h = 900 > 700, энгийн каркасын горимд хажуугийн арматургүй → нормоор Ø12, ≤ 400 алхамтай эгнээ нэмнэ.
            BbBeamInput beam = TwoSpans();
            beam.H = 900;
            BbBeamRebar r = BbBeamRebarPlan.Plan(beam, new BbBeamPreset());
            Assert.True(r.TieZ.Length >= 1);
            double[] z = new[] { r.Bars.First(b => b.Role == BbRunRole.Top).Z }.Concat(r.TieZ).Concat(new[] { r.Bars.First(b => b.Role == BbRunRole.Bottom).Z }).ToArray();
            Assert.True(z.Zip(z.Skip(1), (a, b) => a - b).All(g => g <= 400 + 1e-6), "эгнээ хоорондын зай ≤ 400");
            Assert.True(r.Bars.Any(b => b.Role == BbRunRole.Side && b.D == 12));
            Assert.True(r.Warnings.Any(w => w.Contains("h > 700")));
        }

        [Test]
        public static void ShortEndSupportWarnsAnchorage()
        {
            // Компанийн L төгсгөл, тулгуур 200 өргөнтэй: шулуун 134 + хөл < анкерлах → анхааруулга.
            var beam = new BbBeamInput
            {
                Length = 6400, B = 300, H = 400,
                Supports = new List<BbSupport> { new BbSupport(0, 200), new BbSupport(6200, 6400) },
            };
            BbBeamPreset p = BbBeamPreset.Company(300);
            p.Top = new BbBarSpec(2, 28);
            BbBeamRebar r = BbBeamRebarPlan.Plan(beam, p);
            Assert.True(r.Warnings.Any(w => w.Contains("анкерлах урт хүрэхгүй")));
        }

        [Test]
        public static void WarnsOnLowCoverAndThinStirrup()
        {
            var p = new BbBeamPreset { Cover = 15, StirrupD = 6, Top = new BbBarSpec(2, 32) };
            BbBeamRebar r = BbBeamRebarPlan.Plan(TwoSpans(), p);
            Assert.True(r.Warnings.Any(w => w.Contains("Хамгаалах")));
            Assert.True(r.Warnings.Any(w => w.Contains("Хомут")));
        }
    }
}
