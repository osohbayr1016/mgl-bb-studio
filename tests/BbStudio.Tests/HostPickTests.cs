using System.Collections.Generic;
using MglBb.Core;

namespace MglBb.Tests
{
    public static class HostPickTests
    {
        private static BbHostCand C(long id, string g, int pr, double inside) { return new BbHostCand { Id = id, Group = g, Priority = pr, Inside = inside }; }

        [Test]
        public static void BarInAuxBeamHostedOnMainBeamMovesToAux()
        {
            // ТДН-4-ийн доод арматур (6 м) — 5.4 м нь ТДН-4-д, 0.6 м нь тулгуур ДН-2-т; хост = ДН-2 (буруу).
            var c = new List<BbHostCand> { C(10, "F:ДН-2", BbHostPick.PriorityFraming, 0.6), C(20, "F:ТДН-4", BbHostPick.PriorityFraming, 5.4) };
            Assert.Eq(20L, BbHostPick.Pick(10, 6, c, out double s, out double cs));
            Assert.Near(0.9, s, 1e-9, "share");
            Assert.Near(0.1, cs, 1e-9, "current share");
        }

        [Test]
        public static void MultiSpanBarStaysOnAnySpanOfItsChain()
        {
            // 3 алгаслын ДН-1, арматур 1-р алгасалд хостлогдсон — алгаслын аль нь ч 50%-д хүрэхгүй ч бүлгээрээ 100%.
            var c = new List<BbHostCand> { C(1, "F:ДН-1", 3, 3), C(2, "F:ДН-1", 3, 4), C(3, "F:ДН-1", 3, 3) };
            Assert.Eq(0L, BbHostPick.Pick(1, 10, c, out double _, out double _));
            Assert.Eq(2L, BbHostPick.Pick(99, 10, c, out double _, out double _), "хост өөр газар бол хамгийн их урттай алгасал");
        }

        [Test]
        public static void BeamBarInsideSlabPrefersBeam()
        {
            // Дээд арматур хучилтын биет дотор ч (давхцал) дамнурууных — давуу эрэмбэ.
            var c = new List<BbHostCand> { C(5, "#5", BbHostPick.PriorityFloor, 6), C(7, "F:ДН-3", BbHostPick.PriorityFraming, 6) };
            Assert.Eq(7L, BbHostPick.Pick(5, 6, c, out double _, out double _));
            Assert.Eq(0L, BbHostPick.Pick(7, 6, c, out double _, out double _));
        }

        [Test]
        public static void SlabBarCrossingBeamsStaysOnSlab()
        {
            var c = new List<BbHostCand> { C(5, "#5", BbHostPick.PriorityFloor, 8), C(7, "F:ДН-3", 3, 0.4), C(8, "F:ДН-4", 3, 0.4) };
            Assert.Eq(0L, BbHostPick.Pick(5, 8, c, out double _, out double _));
        }

        [Test]
        public static void SupportTopBarHalfInColumnStaysOnBeam()
        {
            // ЖИШЭЭ-5 ДН-2: тулгуурын дээд арматур 47% дамнуруунд, 52% баганад — дамнурууных хэвээр; харин багана дээр 10% бол дамнуруу руу.
            var c = new List<BbHostCand> { C(1, "F:ДН-2", BbHostPick.PriorityFraming, 0.47), C(2, "C:Б-1", BbHostPick.PriorityColumn, 0.52) };
            Assert.Eq(0L, BbHostPick.Pick(1, 1, c, out double _, out double _));
            var d = new List<BbHostCand> { C(1, "F:ДН-9", BbHostPick.PriorityFraming, 0.9), C(2, "C:Б-2", BbHostPick.PriorityColumn, 0.1) };
            Assert.Eq(1L, BbHostPick.Pick(2, 1, d, out double _, out double _));
        }

        [Test]
        public static void UnclearBarIsLeftAlone()
        {
            // Аль ч бүлэгт 50% хүрэхгүй (жишээ нь дамнуруу — баганын зангилаа) → хөндөхгүй.
            var c = new List<BbHostCand> { C(1, "F:ДН-1", 3, 0.4), C(2, "C:Б-1", 2, 0.45) };
            Assert.Eq(0L, BbHostPick.Pick(3, 1, c, out double s, out double _));
            Assert.Eq(0.0, s);
            Assert.Eq(0L, BbHostPick.Pick(3, 0, new List<BbHostCand>(), out double _, out double _));
        }
    }
}
