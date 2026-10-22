using System;
using System.Collections.Generic;
using System.Linq;
using MglBb.Core;

namespace MglBb.Tests
{
    public static class BreakPlanTests
    {
        [Test]
        public static void LeftEdgeSlabGivesOneBreakAtMidThickness()
        {
            // ЖИШЭЭ-2 «ДН-1 S1»: crop x 470…1378.5, хучилт B30 200 y 479.4…679.4 зүүн ирмэгийг дайрна → (514.9, 579.4), left = right = 100.
            List<BbBreakSpot> s = BbBreakPlan.Spots(470, 1378.5, new[] { new BbYSpan(479.4, 679.4) }, new BbYSpan[0], 44.9, 48.6, 20, 2);
            Assert.Eq(1, s.Count);
            Assert.False(s[0].Right);
            Assert.Near(514.9, s[0].X, 1e-6);
            Assert.Near(579.4, s[0].Y, 1e-6);
            Assert.Near(100, s[0].Half, 1e-6);
            Assert.Near(48.6, s[0].Mask, 1e-6);
        }

        [Test]
        public static void StackedSlabsMergeAndRightSideMirrors()
        {
            // B30 200 (660…860) ба B30 160 (700…860) давхцана → нэг; баруун талд тусдаа нимгэн хэсэг алгасагдана.
            List<BbBreakSpot> s = BbBreakPlan.Spots(0, 889, new BbYSpan[0],
                new[] { new BbYSpan(700, 860), new BbYSpan(660, 860), new BbYSpan(100, 105) }, 44.5, 48.6, 20, 2);
            Assert.Eq(1, s.Count);
            Assert.True(s[0].Right);
            Assert.Near(889 - 44.5, s[0].X, 1e-6);
            Assert.Near(760, s[0].Y, 1e-6);
            Assert.Near(100, s[0].Half, 1e-6);
        }

        [Test]
        public static void SeparateSlabsStaySeparate()
        {
            List<BbYSpan> m = BbBreakPlan.Merge(new[] { new BbYSpan(0, 200), new BbYSpan(500, 700), new BbYSpan(201, 250) }, 2);
            Assert.Eq(2, m.Count);
            Assert.Near(250, m[0].Hi, 1e-9);
        }

        [Test]
        public static void ManualBreakIsRespected()
        {
            var spot = new BbBreakSpot { X = 514.9, Y = 579.4, Half = 100 };
            Assert.True(BbBreakPlan.Covered(spot, new[] { new[] { 520.0, 600.0 } }, 30));
            Assert.False(BbBreakPlan.Covered(spot, new[] { new[] { 900.0, 579.4 } }, 30));
        }

        [Test]
        public static void ElevationBeamsAtSidesColumnsAtTopBottom()
        {
            // Crop x 0…10000, y −1500…700 (дээд нүүр 0).  Дамнуруу (−700…0) зүүн/баруун ирмэгийг дайрна; баганууд (x 2800…3500, 9300…9900)
            // дээд/доод ирмэгийг дайрна; crop дотор бүхэлдээ байгаа багана (x 6000…6500) — break line-гүй.
            var beams = new[] { new double[] { -2000, 12000, -700, 0 } };
            var cols = new[]
            {
                new double[] { 2800, 3500, -5000, 3000 },
                new double[] { 9300, 9900, -900, 3000 },
                new double[] { 6000, 6500, -1000, 500 },
            };
            var s = BbBreakPlan.ElevationSpots(0, 10000, -1500, 700, beams, cols, 112, 120, 1, 20, 2);
            BbBreakSpot left = s.Single(x => !x.Right && !x.Horizontal), right = s.Single(x => x.Right);
            Assert.Near(112, left.X, 1e-9); Assert.Near(-350, left.Y, 1e-9); Assert.Near(350, left.Half, 1e-9);
            Assert.Near(10000 - 112, right.X, 1e-9);
            Assert.Near(Math.PI / 2, left.Angle, 1e-9); Assert.Near(-Math.PI / 2, right.Angle, 1e-9);
            var tops = s.Where(x => x.Top).OrderBy(x => x.X).ToList();
            Assert.Eq(2, tops.Count);
            Assert.Near(3150, tops[0].X, 1e-9); Assert.Near(700 - 112, tops[0].Y, 1e-9); Assert.Near(350, tops[0].Half, 1e-9);
            Assert.Near(0, tops[0].Angle, 1e-9);
            BbBreakSpot bottom = s.Single(x => x.Bottom);
            Assert.Near(3150, bottom.X, 1e-9); Assert.Near(-1500 + 112, bottom.Y, 1e-9); Assert.Near(Math.PI, bottom.Angle, 1e-9);
            // Гараар тавьсан хэвтээ break line (дээд, x 3100) — дахин тавихгүй.
            Assert.True(BbBreakPlan.Covered(tops[0], new[] { new double[] { 3100, 600 } }, 50));
        }

        [Test]
        public static void TypeByScale()
        {
            var f = new List<double> { 25, 100, 50 };
            Assert.Eq(0, BbBreakPlan.NearestScale(f, 20));
            Assert.Eq(2, BbBreakPlan.NearestScale(f, 50));
            Assert.Eq(1, BbBreakPlan.NearestScale(f, 120));
            Assert.Eq(-1, BbBreakPlan.NearestScale(new List<double>(), 20));
        }
    }
}
