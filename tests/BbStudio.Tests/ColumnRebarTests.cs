using System;
using System.Collections.Generic;
using System.Linq;
using MglBb.Core;

namespace MglBb.Tests
{
    public static class ColumnRebarTests
    {
        static BbColumnInput Mid() { return new BbColumnInput { B = 500, H = 500, Height = 3300, Joint = 600, ContinuesAbove = true }; }

        [Test]
        public static void PerimeterBarsLapAbove()
        {
            BbColumnRebar r = BbColumnRebarPlan.Plan(Mid(), new BbColumnPreset { Nb = 4, Nh = 4, D = 20 });
            Assert.Eq(12, r.Bars.Count);
            Assert.Eq(4, r.Bars.Count(b => b.Corner));
            Assert.Eq(6, r.TieD);
            Assert.Near(41, r.Bars.Min(b => b.X), 1e-9);
            Assert.Near(459, r.Bars.Max(b => b.Y), 1e-9);
            Assert.Near(1110, r.Lap, 1e-9);
            Assert.Near(3300 + 1110, r.BarZ1, 1e-9);
            Assert.Near(0, r.TopHook, 1e-9);
            Assert.Eq(0, r.Warnings.Count, string.Join("; ", r.Warnings));
        }

        [Test]
        public static void TieZonesDenseAtLapAndTop()
        {
            BbColumnRebar r = BbColumnRebarPlan.Plan(Mid(), new BbColumnPreset { Nb = 4, Nh = 4, D = 20 });
            Assert.Near(300, r.S, 1e-9);
            Assert.Near(200, r.SDense, 1e-9);
            // 50-аас 7 @200 (…1250, давхцал 1110-ийг хамарна), гол 4 @280 (1530…2370), 2650-аас 4 @200 (…3250).
            Assert.Eq(3, r.Ties.Count);
            Assert.Near(50, r.Ties[0].Z0, 1e-9);
            Assert.Near(1250, r.Ties[0].Z1, 1e-9);
            Assert.Near(1530, r.Ties[1].Z0, 1e-9);
            Assert.Eq(4, r.Ties[1].Count);
            Assert.Near(2650, r.Ties[2].Z0, 1e-9);
            Assert.Near(3250, r.Ties[2].Z1, 1e-9);
            // Гадна битүү + 2 + 2 C-хомут.
            Assert.Eq(5, r.Shapes.Count);
            Assert.True(r.Shapes[0].Closed);
        }

        [Test]
        public static void TopStoreyHooksIntoJoint()
        {
            BbColumnInput c = Mid();
            c.ContinuesAbove = false;
            BbColumnRebar r = BbColumnRebarPlan.Plan(c, new BbColumnPreset { Nb = 3, Nh = 3, D = 20 });
            Assert.Near(3259, r.BarZ1, 1e-9);
            Assert.Near(380, r.TopHook, 1e-9);   // lan 930 − шулуун (600 − 41) 559 = 371 → 380
            Assert.Eq(8, r.Bars.Count);

            c.ContinuesAbove = true;
            c.AboveB = 400;
            Assert.True(BbColumnRebarPlan.Plan(c, new BbColumnPreset()).Warnings.Any(w => w.Contains("dowel")));
        }

        [Test]
        public static void ZonesShortColumnIsAllDense()
        {
            List<BbTieSet> z = BbColumnRebarPlan.Zones(50, 950, 600, 500, 100, 300);
            Assert.Eq(1, z.Count);
            Assert.True(z[0].Spacing <= 100 + 1e-9);
            List<BbTieSet> u = BbColumnRebarPlan.Zones(50, 2050, 0, 0, 100, 300);
            Assert.Eq(1, u.Count);
            Assert.True(u[0].Spacing <= 300 + 1e-9);
        }

        static BbColumnInput Company1100()
        {
            return new BbColumnInput { B = 1100, H = 1100, Height = 4000, Joint = 700, ContinuesAbove = true, AboveHeight = 4500 };
        }

        [Test]
        public static void CompanyCouplersStaggerTwoGroups()
        {
            BbColumnRebar r = BbColumnRebarPlan.Plan(Company1100(), BbColumnPresets.Company(1100, 1100));
            // ЖИШЭЭ-1 Б-5-1: 1100 → тал бүр 8, нийт 28, Ø28, нүүрээс 60.
            Assert.Eq(28, r.Bars.Count);
            Assert.Eq(28, r.D);
            Assert.Near(60, r.Bars.Min(b => b.X), 1e-9);
            Assert.Near(0, r.Lap, 1e-9);
            // Бүлэг 0: шалнаас 1200 (H 4000) → дээд давхрын 1250 (H 4500); бүлэг 1: 2400 → 2500.
            List<BbColumnBar> g0 = r.Bars.Where(b => b.Group == 0).ToList(), g1 = r.Bars.Where(b => b.Group == 1).ToList();
            Assert.Eq(14, g0.Count);
            Assert.True(g0.All(b => Math.Abs(b.Path[0][2] - 1200) < 1e-6 && Math.Abs(b.Path[1][2] - 5250) < 1e-6));
            Assert.True(g1.All(b => Math.Abs(b.Path[0][2] - 2400) < 1e-6 && Math.Abs(b.Path[1][2] - 6500) < 1e-6));
            // Хөрш хоёр саваа өөр бүлэгт.
            Assert.True(r.Bars.Zip(r.Bars.Skip(1), (a, b) => a.Group != b.Group).All(x => x));
            // Хомут Ø10 @100 бүх өндөрт: 70 … 3770 (оройгоос 230).
            Assert.Eq(10, r.TieD);
            Assert.Eq(1, r.Ties.Count);
            Assert.Near(70, r.Ties[0].Z0, 1e-9);
            Assert.Near(3770, r.Ties[0].Z1, 1e-9);
            Assert.Near(100, r.Ties[0].Spacing, 1e-9);
            // 8 ширхэгт: гадна + 2 + 2 хосын тэгш өнцөгт (ЖИШЭЭ-1: 5 олонлог), C-гүй.
            Assert.Eq(5, r.Shapes.Count);
            Assert.True(r.Shapes.All(s => s.Closed));
        }

        [Test]
        public static void CompanyInnerTiesByBarCount()
        {
            BbColumnPreset p = BbColumnPresets.Company(1100, 1100);
            p.Nb = p.Nh = 7;
            BbColumnRebar r7 = BbColumnRebarPlan.Plan(Company1100(), p);
            Assert.Eq(5, r7.Shapes.Count(s => s.Closed));
            Assert.Eq(2, r7.Shapes.Count(s => !s.Closed));   // голын саваа C
            p.Nb = p.Nh = 12;
            Assert.Eq(7, BbColumnRebarPlan.Plan(Company1100(), p).Shapes.Count);
            // Хосын тэгш өнцөгт хөрш хоёр савааг тэврэнэ (гадна ирмэг = саваа ± (d/2 + хомут)).
            p.Nb = p.Nh = 8;
            BbColumnRebar r8 = BbColumnRebarPlan.Plan(Company1100(), p);
            BbTieShape inner = r8.Shapes[1];
            double pitch = 980.0 / 7;
            Assert.Near(60 + pitch - 14 - 10, inner.X0, 1e-6);
            Assert.Near(60 + 2 * pitch + 14 + 10, inner.X1, 1e-6);
        }

        [Test]
        public static void CompanyCrankStopAndEmbed()
        {
            BbColumnPreset p = BbColumnPresets.Company(1100, 1100);
            // Дээд давхар 1000, төвөөрөө (тал бүр 50) → тахир: 3200-аас (оройгоос 800) налуу, оройд 50 дотогш.
            BbColumnInput c = Company1100();
            c.AboveB = c.AboveH = 1000;
            c.AboveX0 = c.AboveY0 = 50;
            BbColumnRebar r = BbColumnRebarPlan.Plan(c, p);
            BbColumnBar corner = r.Bars[0];
            Assert.Eq(3, corner.Path.Count);
            Assert.Near(3200, corner.Path[1][2], 1e-9);
            Assert.Near(110, corner.Path[2][0], 1e-9);
            Assert.Near(4000, corner.Path[2][2], 1e-9);

            // Дээд давхар 800 → L: оройгоос 50 доош, 290 дотогш; анхааруулга.
            c.AboveB = c.AboveH = 800;
            c.AboveX0 = c.AboveY0 = 150;
            r = BbColumnRebarPlan.Plan(c, p);
            Assert.Near(3950, r.Bars[0].Path[1][2], 1e-9);
            Assert.Near(60 + 290, r.Bars[0].Path[2][0], 1e-9);
            Assert.True(r.Warnings.Any(w => w.Contains("dowel")));

            // Доод багана огцом өөр → шинэ саваа доош 66d (Ø28 → 1848).
            c = Company1100();
            c.Below = BbBelow.Different;
            Assert.Near(-1848, BbColumnRebarPlan.Plan(c, p).Bars[0].Path[0][2], 1e-9);
            Assert.Near(1500, BbColumnPresets.StaggerZ(5100), 1e-9);
            Assert.Near(3200, BbColumnPresets.StaggerZ(8800), 1e-9);
        }

        [Test]
        public static void TieLayoutChoices()
        {
            BbColumnPreset p = BbColumnPresets.Company(1100, 1100);   // 8×8
            p.TieLayout = BbColumnTieLayout.Outer;
            Assert.Eq(1, BbColumnRebarPlan.Plan(Company1100(), p).Shapes.Count);
            p.TieLayout = BbColumnTieLayout.CEvery;
            BbColumnRebar ce = BbColumnRebarPlan.Plan(Company1100(), p);
            Assert.Eq(1 + 6 + 6, ce.Shapes.Count);
            Assert.Eq(12, ce.Shapes.Count(s => !s.Closed));
            p.TieLayout = BbColumnTieLayout.OuterInner;
            BbColumnRebar oi = BbColumnRebarPlan.Plan(Company1100(), p);
            Assert.Eq(2, oi.Shapes.Count);
            double pitch = 980.0 / 7;
            Assert.Near(60 + pitch - 14 - 10, oi.Shapes[1].X0, 1e-6);
            p.TieLayout = BbColumnTieLayout.Pairs;
            Assert.Eq(5, BbColumnRebarPlan.Plan(Company1100(), p).Shapes.Count);
        }

        [Test]
        public static void ColumnCodeIsEnforced()
        {
            var p = new BbColumnPreset { Nb = 3, Nh = 3, D = 20, Cover = 10, S = 600, Lap = 300 };
            BbColumnRebar r = BbColumnRebarPlan.Plan(Mid(), p);
            Assert.Near(300, r.S, 1e-9);                  // 15·20 = 300
            Assert.Near(1110, r.Lap, 1e-9);               // max(300, норм 1110)
            Assert.Near(20 + 6 + 10, r.Bars.Min(b => b.X), 1e-9);   // хамгаалах 20 болсон
            Assert.Near(10, p.Cover, 1e-9, "дуудагчийн preset өөрчлөгдөхгүй");
            Assert.True(r.Warnings.Count(w => w.Contains("болгов") || w.Contains("нормынхыг")) >= 3);
        }

        [Test]
        public static void ColumnBarPitchAtMost400()
        {
            var c = new BbColumnInput { B = 1200, H = 600, Height = 3600, Joint = 600, ContinuesAbove = true };
            BbColumnRebar r = BbColumnRebarPlan.Plan(c, new BbColumnPreset { Nb = 2, Nh = 2, D = 25 });
            double maxX = r.Bars.Select(b => b.X).Distinct().OrderBy(x => x).Zip(r.Bars.Select(b => b.X).Distinct().OrderBy(x => x).Skip(1), (a, b) => b - a).Max();
            Assert.True(maxX <= 400 + 1e-6, "алхам " + maxX);
            Assert.True(r.Warnings.Any(w => w.Contains("> 400")));
        }

        [Test]
        public static void WarnsWhenBarsDoNotFit()
        {
            var c = new BbColumnInput { B = 300, H = 300, Height = 3000, Joint = 500 };
            BbColumnRebar r = BbColumnRebarPlan.Plan(c, new BbColumnPreset { Nb = 6, Nh = 6, D = 28 });
            Assert.True(r.Warnings.Any(w => w.Contains("багтахгүй")));
        }
    }
}
