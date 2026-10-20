using System;
using RevitMcpAddin.WallElevation.Core;

namespace RevitMcpAddin.WallElevation.Tests
{
    /// <summary>
    /// W06 үр дүнгийн хөтчийн байрлал (live gate 2026-10-16, SEL-HOST-EMPTY-101): Revit-ийн цонх жижиг байхад хадгалсан абсолют байрлал Revit
    /// бүтэн дэлгэц болоход зургийн голд гарч товшилтыг булааж байв.  Байрлал Revit-ийн цонхны баруун доод булангаас харьцангуй.
    /// </summary>
    public static class FloatPlacementTests
    {
        [Test]
        public static void Position_follows_the_revit_window_when_it_grows()
        {
            // Revit restored: (-1900, 100) 1500×800 — хэрэглэгч хөтчийг баруун доод буланд байлгасан.
            double[] at = WeFloatPlacement.Default(-1900, 100, 1500, 800, 560, 520);
            Assert.Eq(-1900 + 1500 - 560 - 330.0, at[0]);
            Assert.Eq(100 + 800 - 520 - 60.0, at[1]);
            double[] rel = WeFloatPlacement.ToRelative(-1900, 100, 1500, 800, at[0], at[1]);
            // Дараа нь Revit бүтэн дэлгэц: (-1928, -8) 1936×1048 — хөтөч ДАХИН баруун доод буланд (зургийн голд биш).
            double[] again = WeFloatPlacement.FromRelative(-1928, -8, 1936, 1048, rel[0], rel[1]);
            Assert.Eq(-1928 + 1936 - 560 - 330.0, again[0], "баруун захаас ижил зайтай");
            Assert.Eq(-8 + 1048 - 520 - 60.0, again[1], "доод захаас ижил зайтай");
            // Хуучин абсолют хадгалалт (-1240, 262) товшилтын цэг (-934, 669)-ийг халхалдаг байв; одоо халхлахгүй.
            Assert.True(-934 < again[0], "зургийн голын товшилтын цэг хөтчийн зүүн талд үлдэнэ");
        }

        [Test]
        public static void User_moved_position_is_kept_relative_and_clamped_to_the_work_area()
        {
            double[] rel = WeFloatPlacement.ToRelative(0, 0, 1920, 1040, 1200, 700);
            double[] same = WeFloatPlacement.FromRelative(0, 0, 1920, 1040, rel[0], rel[1]);
            Assert.Eq(1200.0, same[0]);
            Assert.Eq(700.0, same[1]);
            // Жижиг Revit цонх — харьцангуй байрлал дэлгэцээс гарвал ажлын талбайд багтаана.
            double[] off = WeFloatPlacement.FromRelative(100, 100, 600, 400, rel[0], rel[1]);
            double[] c = WeFloatPlacement.Clamp(off[0], off[1], 560, 520, 0, 0, 1920, 1040);
            Assert.True(c[0] >= 0 && c[0] + 560 <= 1920 && c[1] >= 0 && c[1] + 520 <= 1040, "бүтнээр харагдана: " + c[0] + "," + c[1]);
            double[] big = WeFloatPlacement.Clamp(50, 50, 2500, 1500, 0, 0, 1920, 1040);
            Assert.Eq(0.0, big[0], "дэлгэцээс том бол зүүн/дээд зах харагдана");
            Assert.Eq(0.0, big[1]);
        }
    }
}
