using System;
using System.Collections.Generic;
using System.Linq;
using RevitMcpAddin.WallElevation.Core;

namespace RevitMcpAddin.WallElevation.Tests
{
    /// <summary>
    /// Title block-ийн хүснэгт зөвхөн баруун доод буланд («Булангын хүснэгт», GATEWAY): хүснэгтийн зүүн талын доод зурвас зураг
    /// байрлуулахад нээлттэй.  ХЭМЖСЭН (БА429, 2026-10-07): 310H хүснэгтээс дээш багтаагүй тул үргэлжлэлийн хуудас руу шилжсэн.
    /// </summary>
    public static class SheetNotchTests
    {
        private static double Mm(double mm) { return Fx.Mm(mm); }

        [Test]
        public static void Corner_table_leaves_the_bottom_left_band_usable()
        {
            // GATEWAY-ийн хэмжсэн утга (мм): хүрээ -574..-10 × 10..410, хүснэгт -180..-11 × 10..50.
            double[] rect = { Mm(-574), Mm(10), Mm(-10), Mm(410) };
            // + баруун хилийн 1 мм-ийн шугам (хэмжсэн: зурах талбай -574,50,-11,410).
            // Хэмжсэн бусад саад: хүрээний бүсийн босоо зураас (бүтэн өндөр, нимгэн), зүүн хилийн бүсийн үсгийн хайрцаг, бүтэн хуудасны дүүргэлт.
            var obstacles = new List<double[]>
            {
                new[] { Mm(-180), Mm(10), Mm(-11), Mm(50) }, new[] { Mm(-11.5), Mm(10), Mm(-9), Mm(410) },
                new[] { Mm(-528), Mm(-12), Mm(-525), Mm(475) }, new[] { Mm(-575), Mm(6), Mm(-564), Mm(50) }, new[] { Mm(-594), Mm(0), Mm(0), Mm(420) },
            };
            double[] avoided = WeSheetFrame.AvoidObstacles(rect, obstacles, Mm(1));
            Assert.True(Math.Abs(avoided[1] - Mm(50)) < 1e-9, "доод зурвас бүтэн өргөнөөр хасагдана");
            double[] notch = WeSheetFrame.Notch(rect, avoided, obstacles, Mm(1));
            Assert.True(notch != null, "зүүн талын зай");
            Assert.True(Math.Abs(notch[0] - Mm(-180)) < 1e-9 && Math.Abs(notch[1] - Mm(10)) < 1e-9, "x ≤ -180 бол y ≥ 10");
        }

        [Test]
        public static void Full_width_band_gives_no_notch()
        {
            double[] rect = { 0, 0, Mm(800), Mm(500) };
            var obstacles = new List<double[]> { new[] { Mm(40), 0, Mm(800), Mm(60) } };
            double[] avoided = WeSheetFrame.AvoidObstacles(rect, obstacles, Mm(1));
            Assert.True(WeSheetFrame.Notch(rect, avoided, obstacles, Mm(1)) == null, "хүснэгт бараг бүтэн өргөнтэй — зай алга");
        }

        [Test]
        public static void Composer_uses_the_space_left_of_the_corner_table()
        {
            // Хоёр мөр: дээд мөрөнд 3 зураг, доод мөрийн зураг зөвхөн хүснэгтийн зүүн талын зайд л багтана.
            double gap = Mm(10);
            var items = new List<WeComposeItem>
            {
                new WeComposeItem(WeComposeKind.Elevation, Mm(130), Mm(150)),
                new WeComposeItem(WeComposeKind.Elevation, Mm(190), Mm(150)),
                new WeComposeItem(WeComposeKind.Elevation, Mm(110), Mm(150)),
                new WeComposeItem(WeComposeKind.Elevation, Mm(200), Mm(190)),
            };
            double x0 = Mm(-564), y0 = Mm(60), x1 = Mm(-20), y1 = Mm(400);
            List<WeSheetSlot> plain = WeSheetComposer.Compose(items, x0, y0, x1, y1, gap);
            Assert.True(plain.Any(s => s.Page > 0), "зайгүйгээр 4 дэх зураг дараагийн хуудас руу");
            List<WeSheetSlot> slots = WeSheetComposer.Compose(items, x0, y0, x1, y1, gap, 0, Mm(-190), Mm(20));
            Assert.True(slots.All(s => s.Page == 0), "хүснэгтийн зүүн талын зайгаар нэг хуудсанд");
            WeSheetSlot last = slots.First(s => s.Index == 3);
            Assert.True(last.CenterX + Mm(100) <= Mm(-190) + 1e-9, "доод мөрийн зураг хүснэгтийн зүүн талд");
            Assert.True(last.CenterY - Mm(95) >= Mm(20) - 1e-9, "хүрээний доод хилээс доош гарахгүй");
        }

        [Test]
        public static void Render_placeholder_goes_beside_the_bottom_left_elevation()
        {
            // БА429 (хэмжсэн): 310H доод мөрийн зүүн хэсэгт — перспективын байр (180 × 120) түүний баруун талд, хүснэгтээс дээш.
            double gap = Mm(10);
            var items = new List<WeComposeItem>
            {
                new WeComposeItem(WeComposeKind.Elevation, Mm(130), Mm(150)),
                new WeComposeItem(WeComposeKind.Elevation, Mm(190), Mm(150)),
                new WeComposeItem(WeComposeKind.Elevation, Mm(110), Mm(150)),
                new WeComposeItem(WeComposeKind.Elevation, Mm(200), Mm(190)),
                new WeComposeItem(WeComposeKind.Placeholder, Mm(180), Mm(120)),
            };
            List<WeSheetSlot> slots = WeSheetComposer.Compose(items, Mm(-564), Mm(60), Mm(-20), Mm(400), gap, Mm(55), Mm(-190), Mm(20));
            WeSheetSlot ph = slots.FirstOrDefault(s => s.Index == 4);
            Assert.True(ph != null && ph.Page == 0, "перспективын байр эхний хуудсанд");
            WeSheetSlot e4 = slots.First(s => s.Index == 3);
            Assert.True(ph.CenterX - Mm(90) >= e4.CenterX + Mm(100) + gap - 1e-9, "310H-ийн баруун талд");
            Assert.True(ph.CenterY - Mm(60) >= Mm(60) - 1e-9, "хүснэгтээс дээш");
        }
    }
}
