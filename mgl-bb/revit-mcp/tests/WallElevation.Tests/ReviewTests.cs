using System.Linq;
using RevitMcpAddin.WallElevation.Core;

namespace RevitMcpAddin.WallElevation.Tests
{
    /// <summary>Хуудсуудыг нэг нэгээр шалгах самбарын төлөв (2026-10-14).</summary>
    public static class ReviewTests
    {
        private static WeReviewState Three()
        {
            return new WeReviewState(new[]
            {
                new WeReviewItem { SheetId = 1, SheetNumber = "ИЗД1_101", RoomUid = "r101", RoomLabel = "101 Оффис" },
                new WeReviewItem { SheetId = 2, SheetNumber = "ИЗД1_102", RoomUid = "r157", RoomLabel = "157 Бэлтгэх" },
                new WeReviewItem { SheetId = 3, SheetNumber = "ИЗД1_103", RoomUid = "r157", RoomLabel = "157 Бэлтгэх" },
            });
        }

        [Test]
        public static void Next_marks_the_sheet_checked_and_moves_on_until_all_are_done()
        {
            WeReviewState s = Three();
            Assert.Eq(0, s.Current);
            Assert.True(s.Next());
            Assert.Eq(1, s.Current);
            Assert.True(s.Items[0].Checked);
            Assert.True(s.Next());
            Assert.Eq(2, s.Current);
            Assert.False(s.Next(), "сүүлийнх — бүгд шалгагдсан");
            Assert.True(s.AllChecked);
            Assert.True(s.Summary.Contains("бүгд"), s.Summary);
        }

        [Test]
        public static void Next_skips_sheets_already_checked_and_wraps_around()
        {
            WeReviewState s = Three();
            s.Items[1].Checked = true;
            s.Select(2);
            Assert.True(s.Next(), "эхэнд эргэнэ");
            Assert.Eq(0, s.Current);
        }

        [Test]
        public static void Pages_of_one_room_are_numbered()
        {
            WeReviewState s = Three();
            Assert.Eq("ИЗД1_103  ·  157 Бэлтгэх  (2/2)", s.Items[2].Title);
            Assert.False(s.Items[0].Title.Contains("/"), "ганц хуудастай өрөөнд дугааргүй");
        }
    }
}
