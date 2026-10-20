using System;
using System.Collections.Generic;
using System.Linq;
using RevitMcpAddin.AutoAnnotate.Core;

namespace RevitMcpAddin.AutoAnnotate.Tests
{
    /// <summary>
    /// 2026-10-05: (1) «Хэмжээсийн төрөл» НЭГ сонголт — UI → тохиргоо → ажиллуулагч → Revit хүртэл ЯГ ИЖИЛ UniqueId, чимээгүй өөр төрөл хэрэглэхгүй;
    /// (2) байрлалын тохиргооны шалгалт, цаасан мм → фут хөрвүүлэлт.  Бүгд Revit-гүй.
    /// </summary>
    public static class PlacementAndDimTypeTests
    {
        private static List<AaTypeOption> Types()
        {
            return new List<AaTypeOption>
            {
                new AaTypeOption("uid-A", "Linear - 2.5mm Arial"),
                new AaTypeOption("uid-B", "MGL Хэмжээс 3.5"),
                new AaTypeOption("uid-C", "Арматурын хэмжээс"),
            };
        }

        // ── Хэмжээсийн төрөл ───────────────────────────────────────────

        [Test]
        public static void Selected_type_B_survives_the_whole_pipeline_and_A_is_never_substituted()
        {
            List<AaTypeOption> ui = Types();
            // 1. Хэрэглэгч B-г сонгоно → тохиргоонд UniqueId хадгалагдана.
            string saved = ui[1].Uid;
            // 2. Дахин нээхэд сонголт ЯГ B (индекс/нэрээр биш).
            AaTypeSelection sel = AaTypeChoice.Choose(ui, saved);
            Assert.Eq("uid-B", sel.Uid);
            Assert.False(sel.Stale);
            // 3. Ажиллуулахын өмнө: олдсон + Linear → ЗААВАЛ сонгосон.
            Assert.Eq(AaTypeVerdict.UseSelected, AaTypeChoice.Decide(sel.Uid, true, true));
            // 4. Үүссэн хэмжээсийн бодит төрөл B → таарна; A (өгөгдмөл) бол таарахгүй.
            Assert.True(AaTypeChoice.Matches(200, 200), "B → B");
            Assert.False(AaTypeChoice.Matches(200, 100), "B хүсчихээд A үүссэн — алдаа");
        }

        [Test]
        public static void Selected_type_A_then_B_each_resolve_to_their_own_uid()
        {
            List<AaTypeOption> ui = Types();
            Assert.Eq("uid-A", AaTypeChoice.Choose(ui, "uid-A").Uid);
            Assert.Eq("uid-B", AaTypeChoice.Choose(ui, "uid-B").Uid);
            Assert.Eq("uid-C", AaTypeChoice.Choose(ui, "uid-C").Uid);
        }

        [Test]
        public static void Empty_selection_is_an_explicit_default_not_a_stale_one()
        {
            AaTypeSelection sel = AaTypeChoice.Choose(Types(), "");
            Assert.True(sel.IsDefault);
            Assert.False(sel.Stale);
            Assert.Eq(AaTypeVerdict.UseDefault, AaTypeChoice.Decide("", false, false));
        }

        [Test]
        public static void A_saved_type_missing_from_this_project_is_flagged_not_silently_replaced()
        {
            // Өөр төслийн / устгагдсан төрөл: UniqueId энэ төслийн жагсаалтад алга.
            AaTypeSelection sel = AaTypeChoice.Choose(Types(), "uid-from-another-project");
            Assert.True(sel.IsDefault);
            Assert.True(sel.Stale, "хуучирсан гэж ИЛ тэмдэглэнэ");
            Assert.Eq("uid-from-another-project", sel.StaleUid);
        }

        [Test]
        public static void Display_name_is_never_used_to_find_the_type()
        {
            // Ижил нэртэй хоёр төрөл байж болно (өөр UniqueId) — нэрээр биш UniqueId-аар л таардаг.
            var ui = new List<AaTypeOption> { new AaTypeOption("u1", "Same"), new AaTypeOption("u2", "Same") };
            Assert.Eq("u2", AaTypeChoice.Choose(ui, "u2").Uid);
            Assert.True(AaTypeChoice.Choose(ui, "Same").Stale, "нэр нь UniqueId биш");
        }

        [Test]
        public static void Run_stops_on_missing_or_wrong_kind_type_instead_of_using_the_default()
        {
            Assert.Eq(AaTypeVerdict.Missing, AaTypeChoice.Decide("uid-gone", false, false));
            Assert.Eq(AaTypeVerdict.WrongKind, AaTypeChoice.Decide("uid-text-note", true, false));
            Assert.True(AaTypeChoice.VerdictMessage(AaTypeVerdict.Missing).Length > 10);
            Assert.True(AaTypeChoice.VerdictMessage(AaTypeVerdict.WrongKind).Length > 10);
            Assert.True(AaTypeChoice.VerdictMessage(AaTypeVerdict.UseSelected) == null);
        }

        [Test]
        public static void Matches_ignores_the_check_only_for_the_default_selection()
        {
            Assert.True(AaTypeChoice.Matches(-1, 5), "өгөгдмөл — шалгахгүй");
            Assert.True(AaTypeChoice.Matches(0, 5));
            Assert.False(AaTypeChoice.Matches(7, 5));
        }

        // ── Байрлалын тохиргоо ─────────────────────────────────────────

        private static AaPlacement Valid()
        {
            return new AaPlacement { HostOffsetMm = 3, TagGapMm = 10, DimPitchMm = 8, SectionDimOffsetMm = 10, StirrupDimOffsetMm = 15 };
        }

        [Test]
        public static void Mm_parsing_accepts_decimals_and_comma_and_rejects_garbage()
        {
            double v;
            Assert.True(AaPlacement.TryParseMm("3,5", 0, 60, out v));
            Assert.Near(3.5, v, 1e-12);
            Assert.True(AaPlacement.TryParseMm(" 12.25 ", 0, 60, out v));
            Assert.Near(12.25, v, 1e-12);
            Assert.True(AaPlacement.TryParseMm("0", 0, 60, out v));
            foreach (string bad in new[] { "", "   ", "abc", "NaN", "Infinity", "-Infinity", "-1", "61", "1e9", "1e400", "−5", "3 мм" })
                Assert.False(AaPlacement.TryParseMm(bad, 0, 60, out v), "'" + bad + "' татгалзах ёстой");
        }

        [Test]
        public static void Validate_rejects_nan_infinity_negative_and_absurd_offsets()
        {
            Assert.True(Valid().Validate("Баганаас", true) == null);
            foreach (double bad in new[] { double.NaN, double.PositiveInfinity, -1, 1e6 })
            {
                var p = Valid(); p.HostOffsetMm = bad; Assert.True(p.Validate("Баганаас", true) != null, "host " + bad);
                p = Valid(); p.TagGapMm = bad; Assert.True(p.Validate("Баганаас", true) != null, "gap " + bad);
                p = Valid(); p.StirrupDimOffsetMm = bad; Assert.True(p.Validate("Баганаас", true) != null, "stirrup " + bad);
            }
        }

        [Test]
        public static void Leader_distances_default_to_auto_and_are_range_checked()
        {
            Assert.True(Valid().Validate("Баганаас", true) == null, "0 = автомат хүчинтэй");
            var ok = Valid(); ok.LeaderLandingMm = 12; ok.LeaderRunMm = 5;
            Assert.True(ok.Validate("Баганаас", true) == null);
            foreach (double bad in new[] { double.NaN, double.PositiveInfinity, -1, AaPlacement.LeaderMax + 1 })
            {
                var p = Valid(); p.LeaderLandingMm = bad; Assert.True(p.Validate("Баганаас", true) != null, "3→2 " + bad);
                p = Valid(); p.LeaderRunMm = bad; Assert.True(p.Validate("Баганаас", true) != null, "2→1 " + bad);
            }
        }

        [Test]
        public static void Validate_message_names_the_host_kind()
        {
            var p = Valid(); p.HostOffsetMm = 999;
            Assert.True(p.Validate("Баганаас", true).StartsWith("Баганаас"));
            Assert.True(p.Validate("Дам нуруунаас", true).StartsWith("Дам нуруунаас"));
            Assert.True(p.Validate(null, true).StartsWith("Элементээс"));
        }

        [Test]
        public static void Section_offset_is_only_checked_when_a_section_exists()
        {
            var p = Valid(); p.SectionDimOffsetMm = 0;
            Assert.True(p.Validate("Элементээс", false) == null, "огтлол алга — шалгахгүй");
            Assert.True(p.Validate("Элементээс", true) != null, "огтлол байхад 3–40 мм");
        }

        [Test]
        public static void Stirrup_offset_zero_means_automatic_and_is_valid()
        {
            var p = Valid(); p.StirrupDimOffsetMm = 0;
            Assert.True(p.Validate("Баганаас", true) == null);
        }

        [Test]
        public static void Host_word_follows_the_hosts_actually_found()
        {
            Assert.Eq("Дам нуруунаас", AaPlacement.HostWord(3, 0));
            Assert.Eq("Баганаас", AaPlacement.HostWord(0, 2));
            Assert.Eq("Элементээс", AaPlacement.HostWord(2, 2));
            Assert.Eq("Элементээс", AaPlacement.HostWord(0, 0));
        }

        [Test]
        public static void Paper_mm_to_feet_uses_the_view_scale()
        {
            Assert.Near(10.0 * 100 / 304.8, AaPlacement.ToFt(10, 100), 1e-12);
            Assert.Near(10.0 * 20 / 304.8, AaPlacement.ToFt(10, 20), 1e-12);
            Assert.Near(0, AaPlacement.ToFt(0, 50), 1e-12);
            Assert.Near(AaPlacement.ToFt(7, 100), AaPlacement.ToFt(7, -3), 1e-12, "буруу масштаб → 1:100");
        }
    }
}
