using System;
using System.Linq;
using RevitMcpAddin.ChangeImpact.Core;
using RevitMcpAddin.ClashCheck.Core;
using static RevitMcpAddin.Smart.Tests.PreChangeFixtures;

namespace RevitMcpAddin.Smart.Tests
{
    /// <summary>
    /// Core-ийн «худал цэвэр» гэсэн хоёр алдааны регрессийн тест (2026-10-05, тест бичих үед илэрсэн, засагдсан):
    /// (1) өмнөх төлөв `Unsupported` байхад MEP шалгалт «бүрэн» гэж тооцогдож «0 шинэ clash» гэж хэлж байсан;
    /// (2) «Хуудас» карт зөвхөн `deps.Sheets`-ийг тоолж, харагдац/хүснэгтээр дамжин хүрсэн хуудсыг орхидог байсан.
    /// </summary>
    public static class PreChangeRegressionTests
    {
        /// <summary>
        /// Өмнөх төлөв `Unsupported` (геометр шалгах боломжгүй), дараа нь ConfirmedClash → «шинэ эсэх» мэдэгдэхгүй (Review).
        /// Гэвч `geoErr` нь ӨМНӨХ талын `Unsupported`-г тоолдоггүй → complete=true → «clash:none»
        /// («Шинэ MEP clash илрээгүй … бүгд шалгагдсан») + MEP карт «0 шинэ clash / шалгалт бүрэн» гэж ХУДЛАА хэлнэ.
        /// </summary>
        [Test]
        public static void Clash_BeforeUnsupported_AfterClash_MustNotClaimCompleteZeroNewClash()
        {
            PreChangeReport r = Run(Snap().WithPair(Pair("k1", ClashVerdict.Unsupported)), Snap().WithPair(Pair("k1", ClashVerdict.ConfirmedClash)));
            Assert.Null(Item(r, "clash:none"), "шийдэгдээгүй clash байхад «шинэ clash илрээгүй» гэж хэлж болохгүй");
            SummaryCard c = PreChangeSummary.Build(r).Card(PreChangeSummary.Mep);
            Assert.False(c.Value.StartsWith("0"), "MEP карт: " + c.Value + " / " + c.Detail);
            Assert.True(r.Incomplete, "өмнөх төлөв шалгагдаагүй → бүрэн бус");
        }

        /// <summary>
        /// Review (хянах) clash байгаа ч MEP карт «0 шинэ clash» гэж гарч болохгүй — GeometryError-той адил дүрэм Unsupported-д ч үйлчлэх ёстой.
        /// </summary>
        [Test]
        public static void Clash_UnresolvedReviewClash_NeverShowsZeroCardWithCompleteDetail()
        {
            PreChangeReport r = Run(Snap().WithPair(Pair("k1", ClashVerdict.Unsupported)), Snap().WithPair(Pair("k1", ClashVerdict.ConfirmedClash)));
            SummaryCard c = PreChangeSummary.Build(r).Card(PreChangeSummary.Mep);
            Assert.False(c.Value == "0 шинэ clash" && c.Detail == "шалгалт бүрэн");
        }

        /// <summary>
        /// Хуудасны карт `PreChangeDiff.DistinctSheetCount`-ийг ашигладаггүй: зөвхөн `deps.Sheets` дахь Sheet мөрийг тоолно.
        /// Хуудас руу харагдац/хүснэгтээр л хүрсэн (deps.Sheets-д орээгүй) бол карт дутуу тоолно.
        /// (Revit давхарга deps.Sheets-ийг үргэлж бөглөдөг бол энэ нь онолын эрсдэл.)
        /// </summary>
        [Test]
        public static void SheetsCard_EqualsDistinctSheetCount_EvenWhenSheetsReachedOnlyThroughViews()
        {
            var deps = Deps();
            deps.Views.Add(View(1, "FloorPlan", 20, 21));
            deps.Schedules.Add(Sched(50, 22));
            PreChangeReport r = Run(Snap(), Snap(), deps);
            int expected = PreChangeDiff.DistinctSheetCount(deps);
            Assert.Eq(3, expected);
            Assert.Eq(expected.ToString(), PreChangeSummary.Build(r).Card(PreChangeSummary.Sheets).Value);
        }
    }
}
