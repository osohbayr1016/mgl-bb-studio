using System.Collections.Generic;
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
