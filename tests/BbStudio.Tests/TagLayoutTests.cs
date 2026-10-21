using MglBb.Core;

namespace MglBb.Tests
{
    public static class TagLayoutTests
    {
        private static BbStandard Learned()
        {
            var std = new BbStandard();
            std.Beam.SecTagOutPaperMm = 5; std.Beam.TagGapPaperMm = 2;
            std.Beam.SecLeaderLandingPaperMm = 10; std.Beam.SecLeaderRunPaperMm = 8;
            std.Column.SecTagOutPaperMm = 6.5;
            return std;
        }

        [Test]
        public static void NewOptionKeepsEachMembersLearnedLayout()
        {
            BbOption o = BbOption.FromStandard("A", Learned());
            BbStandard std = o.ApplyTo(Learned());
            Assert.Near(5, std.Beam.SecTagOutPaperMm, 1e-9);
            Assert.Near(6.5, std.Column.SecTagOutPaperMm, 1e-9, "баганын сурсан зай дамнуруугаар дарагдахгүй");
            Assert.Near(10, std.Beam.SecLeaderLandingPaperMm, 1e-9);
        }

        [Test]
        public static void SetValuesApplyToBeamsAndColumns()
        {
            BbOption o = BbOption.FromStandard("A", Learned());
            o.SecTags.TagOutMm = 7; o.SecTags.LeaderRunMm = 0; o.SecTags.MergeLeaders = true; o.SecTags.GroupTags = false; o.SecTags.SecMarkGapMm = 5;
            BbStandard std = o.ApplyTo(Learned());
            foreach (BbMemberStandard ms in new[] { std.Beam, std.BeamAux, std.Column })
            {
                Assert.Near(7, ms.SecTagOutPaperMm, 1e-9);
                Assert.Near(5, ms.SecMarkGapPaperMm, 1e-9);
                Assert.Near(0, ms.SecLeaderRunPaperMm, 1e-9);
                Assert.True(ms.SecMergeLeaders);
                Assert.False(ms.SecGroupTags);
            }
            Assert.Near(10, std.Beam.SecLeaderLandingPaperMm, 1e-9, "хоосон талбар = сурсан утга");
        }

        [Test]
        public static void LayoutRoundTripsThroughJson()
        {
            var book = new BbOptionBook();
            BbOption o = book.Add(BbOption.FromStandard("A", Learned()));
            o.SecTags.TagGapMm = 2.5; o.SecTags.SingleTagPerSet = false;
            BbOption back = BbOptionBook.FromJson(BbJson.Parse(BbJson.Write(book.ToJson()))).Find("A");
            Assert.Near(2.5, back.SecTags.TagGapMm.Value, 1e-9);
            Assert.Eq(false, back.SecTags.SingleTagPerSet);
            Assert.Eq(null, back.SecTags.TagOutMm);
            Assert.Eq(null, back.SecTags.MergeLeaders);
        }
    }
}
