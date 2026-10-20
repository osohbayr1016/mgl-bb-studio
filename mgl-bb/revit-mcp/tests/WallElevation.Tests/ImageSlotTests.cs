using System;
using System.Collections.Generic;
using RevitMcpAddin.WallElevation.Core;

namespace RevitMcpAddin.WallElevation.Tests
{
    /// <summary>
    /// Render зургийг перспективын байранд «Canva шиг» оруулах (2026-10-14): байр олох, аль байранд ойртуулсныг таних, дүүргэх тайралт.
    /// </summary>
    public static class ImageSlotTests
    {
        private static double Mm(double v) { return Fx.Mm(v); }

        /// <summary><c>DrawPlaceholder</c>-ийн зурдаг 4 шулуун (180 × 120 мм) — төв (cx, cy).</summary>
        private static List<WeSegment2> Box(double cx, double cy, double w = 180, double h = 120)
        {
            double x0 = Mm(cx - w / 2), x1 = Mm(cx + w / 2), y0 = Mm(cy - h / 2), y1 = Mm(cy + h / 2);
            return new List<WeSegment2>
            {
                new WeSegment2(x0, y0, x1, y0), new WeSegment2(x1, y0, x1, y1),
                new WeSegment2(x1, y1, x0, y1), new WeSegment2(x0, y1, x0, y0),
            };
        }

        [Test]
        public static void Placeholder_rectangle_is_found_around_its_label()
        {
            var lines = new List<WeSegment2>();
            lines.AddRange(Box(200, 100));
            lines.AddRange(Box(400, 100));
            // Санамсаргүй шулуун (хүрээ биш) — тойрогт орохгүй.
            lines.Add(new WeSegment2(Mm(150), Mm(120), Mm(170), Mm(120)));
            WeRect? a = WeImageSlots.SlotAround(lines, Mm(200), Mm(100), Mm(0.5));
            WeRect? b = WeImageSlots.SlotAround(lines, Mm(400), Mm(100), Mm(0.5));
            Assert.True(a.HasValue && b.HasValue, "хоёр байр олдсон");
            Assert.True(Math.Abs(a.Value.W - Mm(180)) < 1e-9 && Math.Abs(a.Value.H - Mm(120)) < 1e-9, "180 × 120");
            Assert.True(Math.Abs(b.Value.Cx - Mm(400)) < 1e-9, "хоёр дахь байр өөрийн тэгш өнцөгт");
            Assert.Null(WeImageSlots.SlotAround(lines, Mm(300), Mm(300), Mm(0.5)), "тэгш өнцөгтгүй цэг");
            Assert.Null(WeImageSlots.SlotAround(Box(200, 100).GetRange(0, 3), Mm(200), Mm(100), Mm(0.5)), "дутуу хүрээ");
            Assert.True(WeImageSlots.IsLabel("  ХАРАГДАХ БАЙДАЛ 02\r(перспектив / рендер зураг байрлуулна)"));
            Assert.Eq(2, WeImageSlots.LabelNumber("ХАРАГДАХ БАЙДАЛ 02\r(…)"));
            Assert.False(WeImageSlots.IsLabel("Харагдах байдал"), "оффисын өөр бичвэр биш");
        }

        [Test]
        public static void Image_dropped_near_a_slot_targets_it_and_far_away_does_not()
        {
            var slots = new List<WeRect> { WeRect.Around(Mm(200), Mm(100), Mm(180), Mm(120)), WeRect.Around(Mm(400), Mm(100), Mm(180), Mm(120)) };
            double margin = Mm(15);
            // Төв нь 2-р байрны дотор (жижиг зураг) → 1.
            Assert.Eq(1, WeImageSlots.Target(WeRect.Around(Mm(420), Mm(90), Mm(50), Mm(40)), slots, margin));
            // Том зураг хоёр байрыг хучсан — давхцал ихтэй нь.
            Assert.Eq(0, WeImageSlots.Target(WeRect.Around(Mm(260), Mm(100), Mm(300), Mm(200)), slots, margin));
            // Захаас 10 мм гадна төвтэй — «ойртуулсан» (margin 15).
            Assert.Eq(0, WeImageSlots.Target(WeRect.Around(Mm(200 - 90 - 10), Mm(100), Mm(30), Mm(20)), slots, margin));
            // Хол — байргүй.
            Assert.Eq(-1, WeImageSlots.Target(WeRect.Around(Mm(800), Mm(500), Mm(100), Mm(80)), slots, margin));
            Assert.True(WeImageSlots.Fills(WeRect.Around(Mm(200), Mm(100), Mm(180), Mm(120)), slots[0], Mm(0.5)), "аль хэдийн дүүргэсэн");
            Assert.False(WeImageSlots.Fills(WeRect.Around(Mm(201), Mm(100), Mm(180), Mm(120)), slots[0], Mm(0.5)));
        }

        [Test]
        public static void Fill_crop_keeps_the_slot_aspect_from_the_image_centre()
        {
            int x, y, w, h;
            // 4000×2000 (2:1) → 180×120 (3:2): өргөнийг тайрна.
            WeImageSlots.CropFor(4000, 2000, 180, 120, out x, out y, out w, out h);
            Assert.Eq(3000, w); Assert.Eq(2000, h); Assert.Eq(500, x); Assert.Eq(0, y);
            // 1000×1000 → 3:2: өндрийг тайрна.
            WeImageSlots.CropFor(1000, 1000, 180, 120, out x, out y, out w, out h);
            Assert.Eq(1000, w); Assert.Eq(667, h); Assert.Eq(0, x); Assert.Eq(166, y);
            // Ижил харьцаа — тайрахгүй.
            WeImageSlots.CropFor(1800, 1200, 180, 120, out x, out y, out w, out h);
            Assert.Eq(1800, w); Assert.Eq(1200, h); Assert.Eq(0, x); Assert.Eq(0, y);
            Assert.True(WeImageSlots.SameAspect(1800, 1200, WeRect.Around(0, 0, 180, 120), 0.005));
            Assert.False(WeImageSlots.SameAspect(1000, 1000, WeRect.Around(0, 0, 180, 120), 0.005));
        }
    }
}
