using System.Collections.Generic;
using System.Linq;
using RevitMcpAddin.Ui.Core;

namespace RevitMcpAddin.Ui.Tests
{
    /// <summary>«Хуудас үүсгэх» цонхны оролт шалгалт, дугаар угсрах, давхцал тоолох, «Үүсгэх»-ийг хориглох шалтгаан.</summary>
    public static class BatchSheetRulesTests
    {
        [Test]
        public static void Valid_input_has_no_field_errors()
        {
            BatchInput i = BatchSheetRules.Parse("1", "20", "3");
            Assert.True(i.Valid);
            Assert.Eq(1, i.Start); Assert.Eq(20, i.Count); Assert.Eq(3, i.Pad);
        }

        [Test]
        public static void Each_bad_field_gets_its_own_inline_error_and_the_others_stay_clean()
        {
            BatchInput i = BatchSheetRules.Parse("-1", "501", "11");
            Assert.False(i.Valid);
            Assert.NotNull(i.StartError); Assert.NotNull(i.CountError); Assert.NotNull(i.PadError);
            Assert.True(i.CountError.Contains("1–500"), i.CountError);
            Assert.True(i.PadError.Contains("0–10"), i.PadError);

            BatchInput j = BatchSheetRules.Parse("5", "abc", "0");
            Assert.Null(j.StartError); Assert.NotNull(j.CountError); Assert.Null(j.PadError);
            Assert.False(BatchSheetRules.Parse("1", "", "3").Valid, "хоосон тоо ширхэг буруу");
            Assert.True(BatchSheetRules.Parse(" 7 ", " 3 ", " 0 ").Valid, "зай хасагдана");
        }

        [Test]
        public static void Number_composition_matches_the_documented_examples()
        {
            Assert.Eq("007", BatchSheetRules.PadNumber(7, 3));
            Assert.Eq("1234", BatchSheetRules.PadNumber(1234, 3), "урттай тоо таслагдахгүй");
            Assert.Eq("7", BatchSheetRules.PadNumber(7, 0));
            Assert.Eq("AR-STR-007", BatchSheetRules.ComposeNumber(new List<string> { "AR", "STR" }, "007", "-"));
            Assert.Eq("007", BatchSheetRules.ComposeNumber(new List<string>(), "007", "-"), "параметргүй бол зөвхөн тоо");
            Assert.Eq("A-001", BatchSheetRules.Compose(new[] { "A" }, 1, 3, "-"));
        }

        [Test]
        public static void Name_template_n_is_the_padded_counter_only_not_the_full_sheet_number()
        {
            Assert.Eq("План 007", BatchSheetRules.ResolveName("План <n>", "007"));
            Assert.Eq("План 007 / 007", BatchSheetRules.ResolveName("План <N> / <n>", "007"), "том жижиг үсэг үл ялгана, бүгдийг солино");
            Assert.Null(BatchSheetRules.ResolveName("  ", "007"));
            Assert.True(BatchSheetRules.NameTemplateHelp.Contains("БҮРЭН дугаар биш"), "тусламж энэ нарийн мэдээллийг хэлнэ");
        }

        [Test]
        public static void Preview_counts_cover_the_whole_run_not_only_the_eight_visible_rows()
        {
            BatchInput i = BatchSheetRules.Parse("1", "30", "3");
            var existing = new HashSet<string>(System.StringComparer.OrdinalIgnoreCase) { "A-001", "A-025", "a-030" };
            BatchPreviewCounts c = BatchSheetRules.Count(new[] { "A" }, i, "-", existing);
            Assert.Eq(30, c.Total);
            Assert.Eq(3, c.Duplicates, "харагдахгүй 25, 30-р дугаарыг (том жижиг үсэг үл ялгаж) тоолно");
            Assert.Eq(27, c.New);
            Assert.Eq("A-002", c.First, "эхний ШИНЭ дугаар (давхцсан 001-ийг алгасна)");
            Assert.Eq("A-029", c.Last, "сүүлийн ШИНЭ дугаар (давхцсан 030-ыг алгасна)");
            Assert.True(BatchSheetRules.CountsText(c).Contains("27 / 30") && BatchSheetRules.CountsText(c).Contains("алгасах: 3"));
        }

        [Test]
        public static void Create_is_blocked_with_a_reason_when_input_is_bad_or_everything_collides()
        {
            BatchInput bad = BatchSheetRules.Parse("x", "1", "0");
            Assert.NotNull(BatchSheetRules.BlockReason(bad, BatchSheetRules.Count(null, bad, "-", null)));

            BatchInput ok = BatchSheetRules.Parse("1", "2", "3");
            var all = new HashSet<string> { "001", "002" };
            BatchPreviewCounts c = BatchSheetRules.Count(null, ok, "-", all);
            Assert.Eq(0, c.New);
            string reason = BatchSheetRules.BlockReason(ok, c);
            Assert.NotNull(reason);
            Assert.True(reason.Contains("давхцсан"), reason);

            BatchPreviewCounts fine = BatchSheetRules.Count(null, ok, "-", new HashSet<string>());
            Assert.Null(BatchSheetRules.BlockReason(ok, fine));
        }

        [Test]
        public static void Warnings_and_help_state_the_unit_and_the_consequence()
        {
            Assert.True(BatchSheetRules.PadHelp.Contains("0-ээр нөхөх"));
            Assert.True(BatchSheetRules.PadHelp.Contains("0 = нөхөхгүй"));
            Assert.True(BatchSheetRules.NoTitleBlockWarning.Contains("хоосон хуудас"));
        }
    }
}
