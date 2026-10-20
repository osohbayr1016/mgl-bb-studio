using System;
using System.Collections.Generic;
using System.Linq;
using RevitMcpAddin.WallElevation.Core;

namespace RevitMcpAddin.WallElevation.Tests
{
    /// <summary>
    /// Материалын тэмдэглэл: бичвэр (GATEWAY-ийн бодит материалын нэрс, 2026-10-07) ба дэлгээсний дээрх байрлал (жишээ хуудас 205A-F:
    /// бичвэр зургийн дээр, заагч босоо, бичвэрүүд давхцахгүй, заагч бичвэр огтлохгүй).
    /// </summary>
    public static class NoteTests
    {
        [Test]
        public static void Material_labels_follow_the_BIMon_names_in_Mongolian()
        {
            Assert.Eq("ГИПСЭН ХАВТАН", WeMaterialLabel.Label("Хавтан+гипсэн", "Gypsum Wall Board", "Гипсэн хавтан"));
            Assert.Eq("БЕТОН B35", WeMaterialLabel.Label("Бетон+B35", "Cast-in-place concrete", "Бетон"));
            Assert.Eq("ХҮЧИТГЭСЭН БЕТОН", WeMaterialLabel.Label("Бетон+Хүчитгэсэн", "Cast-in-place concrete", "Бетон"));
            Assert.Eq("ЦАГААН БУДАГ", WeMaterialLabel.Label("Будаг - Цагаан", "", "Miscellaneous"));
            Assert.Eq("ПЛИТА 600x600", WeMaterialLabel.Label("Плита+Ерөнхий_600x600(2)", "Cork flooring tiles", "Керамик"));
            Assert.Eq("ПАРКЕТ", WeMaterialLabel.Label("MGL E&C ПАРКЕТ", "", "Generic"));
            Assert.Eq("МОД ЦАРС ӨНГӨЛГӨӨ", WeMaterialLabel.Label("Мод+Царс өнгөлгөө", "Quercus Rubra", "Мод"));
        }

        [Test]
        public static void English_link_materials_are_translated_not_printed_in_English()
        {
            // Хэмжсэн: link (260413_GATEWAY_PS_A)-ийн багана «CONCRETE, CAST-IN-PLACE, GRAY» гэж хуудсанд гарч байв.
            Assert.Eq("ЦУТГАМАЛ БЕТОН", WeMaterialLabel.Label("Concrete, Cast-in-Place, Gray", "Cast-in-place concrete", "Concrete"));
            Assert.Eq("БЕТОН БЛОК ӨРЛӨГ", WeMaterialLabel.Label("Concrete Masonry Units", "Concrete masonry units", "Masonry"));
            Assert.Eq("ГИПСЭН ХАВТАН", WeMaterialLabel.Label("Gypsum Wall Board", "", "Gypsum"));
            // Кирилл тайлбар нь англи нэрээс түрүүлнэ.
            Assert.Eq("БИЕТ ДУЛААЛГА", WeMaterialLabel.Label("Insulation A", "Биет дулаалга", "Insulation"));
            // Танихгүй англи нэр — сүүлийн арга.
            Assert.Eq("XYZ FINISH 7", WeMaterialLabel.Label("XYZ finish 7", "", ""));
        }

        [Test]
        public static void Placeholder_materials_get_no_note()
        {
            Assert.True(WeMaterialLabel.Label("BIMon - Үндсэн+Хана", "", "<Үндсэн>") == null, "BIMon өгөгдмөл");
            Assert.True(WeMaterialLabel.Label("Default Wall", "", "Generic") == null, "Default");
            Assert.True(WeMaterialLabel.Label("<By Category>", "", "") == null, "<By Category>");
            Assert.True(WeMaterialLabel.Label("", "", "") == null, "хоосон");
        }

        private static void NoOverlaps(List<WeNotePlace> ps, double gap)
        {
            foreach (WeNotePlace a in ps)
                foreach (WeNotePlace b in ps)
                {
                    if (ReferenceEquals(a, b)) continue;
                    if (a.Row == b.Row)
                        Assert.True(a.OccRight + gap <= b.OccLeft + 1e-9 || b.OccRight + gap <= a.OccLeft + 1e-9, a.Item.Key + " ↔ " + b.Item.Key + " нэг мөрөнд давхцав");
                    if (a.Row > b.Row)
                        Assert.True(a.Item.LeaderX <= b.OccLeft - gap + 1e-9 || a.Item.LeaderX >= b.OccRight + gap - 1e-9, a.Item.Key + "-ийн заагч " + b.Item.Key + "-ийн бичвэр/мөрийг огтлов");
                }
        }

        [Test]
        public static void Notes_of_one_elevation_never_overlap_or_cross()
        {
            // 310G (хэмжсэн): хоёр материал 1750 мм өргөн хананд ойрхон — өмнө нь бие биен дээрээ давхарласан.
            var items = new List<WeNoteItem>
            {
                new WeNoteItem { Key = "ГИПСЭН ХАВТАН", LeaderX = 600, Width = 1500 },
                new WeNoteItem { Key = "ЦУТГАМАЛ БЕТОН", LeaderX = 700, Width = 1600 },
            };
            List<WeNotePlace> ps = WeNoteLayout.Place(items, 0, 1750, 150, 100, 1000);
            NoOverlaps(ps, 100);
            Assert.Eq(2, ps.Count);
        }

        [Test]
        public static void Notes_sit_beside_their_leader_inside_the_frame()
        {
            var items = new List<WeNoteItem>
            {
                new WeNoteItem { Key = "A", LeaderX = 500, Width = 1500 },    // зүүн хагас — бичвэр баруун талд
                new WeNoteItem { Key = "B", LeaderX = 5800, Width = 1500 },   // баруун хагас — бичвэр зүүн талд
            };
            List<WeNotePlace> ps = WeNoteLayout.Place(items, 0, 6450, 150, 100, 500);
            WeNotePlace a = ps.First(p => p.Item.Key == "A"), b = ps.First(p => p.Item.Key == "B");
            Assert.True(a.TextOnRight && a.TextLeft > a.Item.LeaderX, "A баруун талд");
            Assert.True(!b.TextOnRight && b.TextRight < b.Item.LeaderX, "B зүүн талд");
            Assert.Eq(0, a.Row);
            Assert.Eq(0, b.Row);
            Assert.True(b.TextRight <= 6450, "B хүрээнээс гарахгүй");
        }

        [Test]
        public static void Leader_lands_on_the_wall_face_not_in_a_gap_or_on_a_door()
        {
            // 310F (хэмжсэн): ханын нүүр 0..2100 × 0..4430, 600..2100 хооронд 0..2400 өндөр завсар (өөр ханын хаалга харагдана).
            double[] face = { 0, 0, 600, 0, 600, 2400, 2100, 2400, 2100, 4430, 0, 4430 };
            var loops = new List<double[]> { face };
            double ex, ey;
            double score = WeLeaderPoint.Find(0, 2100, 0, 4430, 1350, 0.6 * 4430 - 1500, new List<double[]>(), loops, 300, out ex, out ey);
            Assert.True(score > 0, "нүүр олдсон");
            Assert.True(WeLeaderPoint.Inside(loops, ex, ey), "заагч ханын нүүрэн дээр");
            Assert.True(!(ex > 600 && ey < 2400), "завсар (хаалга) дээр биш");
            // Нүхтэй нүүр: дотоод хүрээ = нүх.
            var holed = new List<double[]> { new double[] { 0, 0, 3000, 0, 3000, 3000, 0, 3000 }, new double[] { 1000, 0, 2000, 0, 2000, 2200, 1000, 2200 } };
            Assert.True(!WeLeaderPoint.Inside(holed, 1500, 1000), "нүхэнд биш");
            Assert.True(WeLeaderPoint.Inside(holed, 500, 1000), "нүүрэн дээр");
            // Тавилга (саад) — түүнээс зайтай.
            WeLeaderPoint.Find(0, 3000, 0, 3000, 1500, 1800, new List<double[]> { new double[] { 1200, 1500, 1800, 2100 } }, null, 300, out ex, out ey);
            Assert.True(ex <= 900 + 1e-6 || ex >= 2100 - 1e-6 || ey <= 1200 + 1e-6 || ey >= 2400 - 1e-6, "саадаас ≥ 300");
        }

        [Test]
        public static void Many_notes_on_a_narrow_wall_stack_without_crossing()
        {
            var items = Enumerable.Range(0, 5).Select(i => new WeNoteItem { Key = "N" + i, LeaderX = 200 + 250 * i, Width = 1400 }).ToList();
            List<WeNotePlace> ps = WeNoteLayout.Place(items, 0, 1500, 150, 100, 2000);
            NoOverlaps(ps, 100);
        }
    }
}
