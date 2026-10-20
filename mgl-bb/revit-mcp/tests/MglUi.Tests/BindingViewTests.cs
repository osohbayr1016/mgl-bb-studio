using System.Linq;
using RevitMcpAddin.Ui.Core;

namespace RevitMcpAddin.Ui.Tests
{
    /// <summary>«Ажилтай холбох» цонхны тоолол, шүүлт, хадгалахыг хориглох шалтгаан, мөрийн төлөв.</summary>
    public static class BindingViewTests
    {
        private static BindingRowState Row(bool chk, bool task, string num = "A-01", string name = "Хавтангийн план", bool ignored = false, bool confirmed = false)
        {
            return new BindingRowState { IsChecked = chk, HasTask = task, SheetNumber = num, SheetName = name, WasIgnored = ignored, WasConfirmed = confirmed };
        }

        [Test]
        public static void Counts_separate_link_ignore_and_missing_task()
        {
            BindingCounts c = BindingView.Count(new[]
            {
                Row(true, true), Row(true, true), Row(true, false), Row(false, true), Row(false, false, ignored: true), Row(true, true, confirmed: true),
            });
            Assert.Eq(6, c.Total);
            Assert.Eq(3, c.ToLink, "чагтласан + таск");
            Assert.Eq(1, c.CheckedNoTask, "чагтласан боловч таскгүй");
            Assert.Eq(2, c.ToIgnore, "чагтлаагүй нь алгасагдана");
            Assert.Eq(1, c.PreviouslyIgnored);
            Assert.Eq(1, c.PreviouslyConfirmed);
        }

        [Test]
        public static void Save_is_blocked_with_a_reason_when_a_ticked_row_has_no_task()
        {
            BindingCounts c = BindingView.Count(new[] { Row(true, true), Row(true, false) });
            Assert.False(c.CanSave);
            Assert.True(BindingView.SaveHint(c).Contains("таск сонгоогүй"), "шалтгаан ил хэлэгдэнэ");
        }

        [Test]
        public static void Save_is_blocked_when_nothing_would_be_linked_and_says_so()
        {
            BindingCounts c = BindingView.Count(new[] { Row(false, true), Row(false, false) });
            Assert.False(c.CanSave);
            Assert.True(BindingView.SaveHint(c).Contains("чагтлаагүй"), "юу ч холбохгүй байгааг хэлнэ");
        }

        [Test]
        public static void Save_is_allowed_when_every_ticked_row_has_a_task()
        {
            BindingCounts c = BindingView.Count(new[] { Row(true, true), Row(false, false) });
            Assert.True(c.CanSave);
            Assert.Eq(string.Empty, BindingView.SaveHint(c));
        }

        [Test]
        public static void Summary_states_all_three_numbers_not_just_the_ready_one()
        {
            BindingCounts c = BindingView.Count(new[] { Row(true, true), Row(false, false), Row(false, true) });
            string t = BindingView.SummaryText(c);
            Assert.True(t.Contains("1 хуудас холбогдоно"), t);
            Assert.True(t.Contains("2 алгасна"), t);
            Assert.True(t.Contains("нийт 3"), t);
        }

        [Test]
        public static void Confirmation_text_names_the_ignored_count_before_saving()
        {
            BindingCounts c = BindingView.Count(new[] { Row(true, true), Row(false, true), Row(false, false) });
            string t = BindingView.SaveConfirmText(c);
            Assert.True(t.Contains("1 хуудас ERP-ийн ажилтай холбогдоно"), t);
            Assert.True(t.Contains("2 хуудас «алгассан» гэж хадгалагдана"), t);
        }

        [Test]
        public static void Saved_text_reports_server_numbers_and_only_mentions_the_checklist_when_rows_were_linked()
        {
            string withRows = BindingView.SavedText(5, 2, true);
            Assert.True(withRows.Contains("5 хуудас холбогдлоо") && withRows.Contains("2 хуудас «алгассан»"), withRows);
            Assert.True(withRows.ToLowerInvariant().Contains("дэд жагсаалт"), "хуудас холбогдсон үед дэд жагсаалтыг дурдана");
            string none = BindingView.SavedText(0, 7, true);
            Assert.False(none.ToLowerInvariant().Contains("дэд жагсаалт"), "0 хуудас холбогдсон бол дэд жагсаалт үүссэн гэж худлаа хэлэхгүй");
            string unchecked_ = BindingView.SavedText(3, 0, false);
            Assert.False(unchecked_.ToLowerInvariant().Contains("дэд жагсаалт"), "хэрэглэгч чагтлаагүй бол дурдахгүй");
        }

        [Test]
        public static void Filter_and_search_narrow_the_visible_rows_only()
        {
            var rows = new[]
            {
                Row(true, true, "A-01", "Хавтангийн план"),
                Row(false, true, "A-02", "Хананы огтлол"),
                Row(true, false, "S-10", "Тулгуурын дэлгэрэнгүй"),
                Row(false, false, "S-11", "Суурийн план", ignored: true),
            };
            Assert.Eq(4, rows.Count(r => BindingView.Matches(r, BindingFilter.All, "")));
            Assert.Eq(1, rows.Count(r => BindingView.Matches(r, BindingFilter.ToLink, "")), "зөвхөн чагтласан + таск");
            Assert.Eq(2, rows.Count(r => BindingView.Matches(r, BindingFilter.ToIgnore, "")), "чагтлаагүй нь алгасагдана");
            Assert.Eq(2, rows.Count(r => BindingView.Matches(r, BindingFilter.NoTask, "")));
            Assert.Eq(1, rows.Count(r => BindingView.Matches(r, BindingFilter.PreviouslyIgnored, "")));
            Assert.Eq(2, rows.Count(r => BindingView.Matches(r, BindingFilter.All, "план")), "нэрээр");
            Assert.Eq(1, rows.Count(r => BindingView.Matches(r, BindingFilter.All, "s-10")), "дугаараар, том жижиг үсэг үл ялгана");
            Assert.Eq(1, rows.Count(r => BindingView.Matches(r, BindingFilter.ToIgnore, "план")), "шүүлт БА хайлт хоёул");
            Assert.Eq(0, rows.Count(r => BindingView.Matches(r, BindingFilter.All, "байхгүй үг")));
        }

        [Test]
        public static void Search_ignores_cyrillic_latin_differences()
        {
            BindingRowState r = Row(true, true, "A-01", "План этажа");
            Assert.True(BindingView.Matches(r, BindingFilter.All, "plan"), "латинаар бичсэн хайлт кирилл нэрийг олно");
        }

        [Test]
        public static void Status_is_a_word_not_only_a_colour()
        {
            Assert.Eq("Холбогдсон", BindingView.StatusLabel(true, false));
            Assert.Eq("Алгассан", BindingView.StatusLabel(false, true));
            Assert.Eq("Шинэ санал", BindingView.StatusLabel(false, false));
            Assert.True(BindingView.StatusLabel(true, true) == "Холбогдсон", "confirmed нь ignored-оос түрүүлнэ (давхар төлөв байж болохгүй, гэхдээ тодорхой)");
        }

        [Test]
        public static void Every_filter_has_a_distinct_label()
        {
            var labels = new[] { BindingFilter.All, BindingFilter.ToLink, BindingFilter.ToIgnore, BindingFilter.NoTask, BindingFilter.PreviouslyIgnored }
                .Select(BindingView.FilterLabel).ToList();
            Assert.Eq(labels.Count, labels.Distinct().Count());
            Assert.True(labels.All(l => !string.IsNullOrWhiteSpace(l)));
        }
    }
}
