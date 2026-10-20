using System;
using System.Collections.Generic;
using System.Linq;
using RevitMcpAddin.ChangeImpact.Core;
using RevitMcpAddin.ClashCheck.Core;
using static RevitMcpAddin.Smart.Tests.PreChangeFixtures;

namespace RevitMcpAddin.Smart.Tests
{
    /// <summary>«5 секундэд ойлгох» товч: карт бүр ҮНЭНЭЭР тооцсон эсэхээ хэлнэ; тооцоогүй нь «0» биш.</summary>
    public static class PreChangeSummaryTests
    {
        private static PreChangeSummary Sum(PreChangeReport r) { return PreChangeSummary.Build(r); }

        [Test]
        public static void Build_NullReport_Throws()
        {
            Assert.Throws<ArgumentNullException>(() => PreChangeSummary.Build(null));
        }

        [Test]
        public static void Headline_LevelAndFooter_ComeFromReport()
        {
            PreChangeSummary s = Sum(Run(req: Req(300, 1, 0, "Оффис 203 тал руу")));
            Assert.Eq("Энэ ханыг 300 мм Оффис 203 тал руу зөөвөл", s.Headline);
            Assert.Eq(AttentionLevel.Clean, s.Level);
            Assert.Eq("ЦЭВЭР", s.LevelText);
            Assert.True(s.CanApply);
            Assert.Eq(PreChangeText.ModelUntouched, s.Footer);
        }

        [Test]
        public static void Cards_RoomsAndDimensions_CountConfirmedChanges()
        {
            StateSnapshot b = Snap().WithRoom(Room(1, 10)).WithRoom(Room(2, 20)).WithRoom(Room(3, 30)).WithDim(Dim(10, 1000)).WithDim(Dim(11, 2000));
            StateSnapshot a = Snap().WithRoom(Room(1, 11)).WithRoom(Room(2, 19)).WithRoom(Room(3, 30)).WithDim(Dim(10, 1300)).WithDim(Dim(11, 2000));
            PreChangeSummary s = Sum(Run(b, a));
            Assert.Eq("2", s.Card(PreChangeSummary.Rooms).Value);
            Assert.Eq(TruthState.Confirmed, s.Card(PreChangeSummary.Rooms).Truth);
            Assert.Eq(ItemSeverity.Warning, s.Card(PreChangeSummary.Rooms).Tone);
            Assert.Eq("1", s.Card(PreChangeSummary.Dimensions).Value);
        }

        [Test]
        public static void Cards_NoChanges_ShowZeroOnlyBecauseCheckedAndComplete()
        {
            PreChangeSummary s = Sum(Run());
            Assert.Eq("0", s.Card(PreChangeSummary.Rooms).Value);
            Assert.Eq("өөрчлөгдөхгүй", s.Card(PreChangeSummary.Rooms).Detail);
            Assert.Eq(ItemSeverity.Ok, s.Card(PreChangeSummary.Rooms).Tone);
            Assert.Eq("0", s.Card(PreChangeSummary.Dimensions).Value);
        }

        [Test]
        public static void Cards_RoomsAndDimensions_SayNotCalculatedWhenSnapshotNotCaptured()
        {
            StateSnapshot a = Snap(); a.Captured = false;
            PreChangeSummary s = Sum(Run(Snap(), a));
            Assert.Eq("тооцоогүй", s.Card(PreChangeSummary.Rooms).Value);
            Assert.Eq("тооцоогүй", s.Card(PreChangeSummary.Dimensions).Value);
            Assert.Eq("тооцоогүй", s.Card(PreChangeSummary.Hosted).Value);
            Assert.True(s.Card(PreChangeSummary.Rooms).Truth != TruthState.Confirmed);
        }

        [Test]
        public static void Cards_CriticalRoom_HasCriticalTone()
        {
            PreChangeSummary s = Sum(Run(Snap().WithRoom(Room(1, 10)), Snap().WithRoom(Room(1, 0))));
            Assert.Eq(ItemSeverity.Critical, s.Card(PreChangeSummary.Rooms).Tone);
        }

        [Test]
        public static void Cards_Hosted_CountsOnlyMoveItems_NotRoomPairOrClearance()
        {
            HostedSnap a30 = Door(30, 1300), a31 = Door(31, 2000);
            a31.ToRoomId = 9;                                           // зөвхөн From/To солигдоно — «хөдөлсөн» биш
            StateSnapshot b = Snap().WithHosted(Door(30, 1000)).WithHosted(Door(31, 2000));
            PreChangeSummary s = Sum(Run(b, Snap().WithHosted(a30).WithHosted(a31), req: Req(300, 1, 0)));
            Assert.Eq("1", s.Card(PreChangeSummary.Hosted).Value);
            Assert.Eq("хамт хөдөлнө", s.Card(PreChangeSummary.Hosted).Detail);
        }

        [Test]
        public static void Cards_Views_CountOnlyReviewViewItems_WithTypeBreakdown()
        {
            var deps = Deps();
            deps.Views.Add(View(1, "FloorPlan"));
            deps.Views.Add(View(2, "FloorPlan"));
            deps.Views.Add(View(3, "Section"));
            deps.Tags.Add(new DepNode { Id = 5, Kind = ImpactNodeKind.Tag });      // tag нь харагдацын тоонд ОРОХГҮЙ
            deps.Sheets.Add(Sheet(20, "A-1"));                                     // хуудас ч мөн
            PreChangeSummary s = Sum(Run(Snap(), Snap(), deps));
            SummaryCard v = s.Card(PreChangeSummary.Views);
            Assert.Eq("3", v.Value);
            Assert.Eq(TruthState.Review, v.Truth);
            Assert.True(v.Detail.Contains("2 план, 1 зүсэлт"), v.Detail);
            Assert.Eq(ItemSeverity.Notice, v.Tone);
        }

        [Test]
        public static void Cards_Views_NoneFoundButChecked_IsZero_WithOkTone()
        {
            PreChangeSummary s = Sum(Run());
            Assert.Eq("0", s.Card(PreChangeSummary.Views).Value);
            Assert.Eq(ItemSeverity.Ok, s.Card(PreChangeSummary.Views).Tone);
        }

        [Test]
        public static void Cards_ViewsAndSheets_SayNotCalculatedWhenVisibilityNotChecked()
        {
            var deps = Deps();
            deps.VisibilityChecked = false;
            PreChangeSummary s = Sum(Run(Snap(), Snap(), deps));
            Assert.Eq("тооцоогүй", s.Card(PreChangeSummary.Views).Value);
            Assert.Eq("тооцоогүй", s.Card(PreChangeSummary.Sheets).Value);
            Assert.Eq(TruthState.Incomplete, s.Card(PreChangeSummary.Views).Truth);
            Assert.False(s.Card(PreChangeSummary.Views).Value == "0");
        }

        [Test]
        public static void Cards_Sheets_IsDistinctSheetCount()
        {
            var deps = Deps();
            deps.Sheets.Add(Sheet(20, "A-101"));
            deps.Sheets.Add(Sheet(20, "A-101"));       // давхардал
            deps.Sheets.Add(Sheet(21, "A-102"));
            PreChangeSummary s = Sum(Run(Snap(), Snap(), deps));
            Assert.Eq("2", s.Card(PreChangeSummary.Sheets).Value);
            Assert.Eq(ItemSeverity.Notice, s.Card(PreChangeSummary.Sheets).Tone);
            Assert.Eq(TruthState.Review, s.Card(PreChangeSummary.Sheets).Truth);
        }

        [Test]
        public static void Cards_Mep_IsAlwaysPresent_WithKnownKeys()
        {
            PreChangeSummary s = Sum(Run());
            foreach (string k in new[] { PreChangeSummary.Rooms, PreChangeSummary.Dimensions, PreChangeSummary.Hosted, PreChangeSummary.Views, PreChangeSummary.Sheets, PreChangeSummary.Mep, PreChangeSummary.Egress })
                Assert.NotNull(s.Card(k), k);
            Assert.Null(s.Card("nope"));
        }

        [Test]
        public static void Cards_Egress_ShowsPlusDeltaForLongerPath()
        {
            PreChangeSummary s = Sum(Run(Snap().WithEgress(Route(1, 10.0), Route(2, 5.0)), Snap().WithEgress(Route(1, 11.24), Route(2, 5.5))));
            SummaryCard c = s.Card(PreChangeSummary.Egress);
            Assert.Eq("+1.24 м", c.Value, "хамгийн их өсөлт");
            Assert.Eq(TruthState.Confirmed, c.Truth);
        }

        [Test]
        public static void Cards_Egress_NotConfigured_IsNotCalculated()
        {
            SummaryCard c = Sum(Run()).Card(PreChangeSummary.Egress);
            Assert.Eq("тооцоогүй", c.Value);
            Assert.Eq(TruthState.NotEvaluated, c.Truth);
        }

        [Test]
        public static void Groups_PartitionAllItems_FailureOnlyInWarnings()
        {
            PreChangeInput inp = Input(Snap().WithRoom(Room(1, 10)).WithDim(Dim(10, 1000)), Snap().WithRoom(Room(1, 11)).WithDim(Dim(10, 1300)));
            inp.Failures.Add(new FailureNote { IsError = false, Text = "Анхааруулга" });
            inp.Deps.Views.Add(View(1, "FloorPlan"));
            PreChangeReport r = PreChangeDiff.Compute(inp);
            PreChangeSummary s = Sum(r);

            Assert.Eq(4, s.Groups.Count);
            int total = s.Groups.Sum(g => g.Items.Count);
            Assert.Eq(r.Items.Count, total, "мөр бүр яг НЭГ бүлэгт");
            foreach (PreChangeItem i in r.Items)
                Assert.Eq(1, s.Groups.Count(g => g.Items.Contains(i)), i.Key);

            Assert.True(s.Group(PreChangeSummary.GConfirmed).Items.All(i => i.Truth == TruthState.Confirmed && i.Category != PreChangeCategory.Failure));
            Assert.True(s.Group(PreChangeSummary.GReview).Items.All(i => i.Truth == TruthState.Review));
            Assert.True(s.Group(PreChangeSummary.GNotEvaluated).Items.All(i => i.Truth == TruthState.NotEvaluated || i.Truth == TruthState.Incomplete));
            Assert.True(s.Group(PreChangeSummary.GWarnings).Items.All(i => i.Category == PreChangeCategory.Failure));
            Assert.Eq(1, s.Group(PreChangeSummary.GWarnings).Items.Count);
            Assert.False(s.Group(PreChangeSummary.GConfirmed).Items.Any(i => i.Category == PreChangeCategory.Failure));
            Assert.True(s.Group(PreChangeSummary.GNotEvaluated).Items.Any(i => i.Key == "norm"));
        }

        [Test]
        public static void Warnings_ListBlockReasonsAndIncompleteReasons()
        {
            StateSnapshot b = Snap(); b.IncompleteReasons.Add("линк алга");
            PreChangeSummary s = Sum(Run(b, Snap()));
            Assert.Contains(s.Warnings, "Бүрэн биш: линк алга");
        }

        [Test]
        public static void Footer_IsModelUntouched_ExceptForNotRestored()
        {
            foreach (SandboxOutcome o in new[] { SandboxOutcome.Simulated, SandboxOutcome.Blocked, SandboxOutcome.Rejected })
            {
                PreChangeInput inp = Input();
                inp.Outcome = o;
                Assert.Eq(PreChangeText.ModelUntouched, Sum(PreChangeDiff.Compute(inp)).Footer, o.ToString());
            }
            PreChangeInput nr = Input();
            nr.Outcome = SandboxOutcome.NotRestored;
            Assert.Null(Sum(PreChangeDiff.Compute(nr)).Footer, "NotRestored: «өөрчлөлт хийгдээгүй» гэж хэлэхгүй");
        }

        [Test]
        public static void Blocked_HasNoCards_ShowsBlockReasonsAndCannotApply()
        {
            PreChangeInput inp = Input(Snap().WithRoom(Room(1, 10)), Snap());
            inp.Outcome = SandboxOutcome.Blocked;
            inp.BlockReasons.Add("Хана түгжигдсэн");
            PreChangeSummary s = Sum(PreChangeDiff.Compute(inp));
            Assert.Eq(0, s.Cards.Count, "blocked үед карт (тоо) гаргахгүй");
            Assert.Eq(AttentionLevel.Blocked, s.Level);
            Assert.Eq("БОЛОМЖГҮЙ", s.LevelText);
            Assert.False(s.CanApply);
            Assert.Contains(s.Warnings, "Хана түгжигдсэн");
        }

        [Test]
        public static void LevelExplain_MentionsIncompleteOnlyWhenIncomplete()
        {
            Assert.True(PreChangeText.LevelExplain(AttentionLevel.Review, true).Contains("бүрэн биш"));
            Assert.False(PreChangeText.LevelExplain(AttentionLevel.Review, false).Contains("бүрэн биш"));
        }

        [Test]
        public static void CanApply_FollowsSimulatedAndNotBlocked()
        {
            Assert.True(Sum(Run()).CanApply);
            PreChangeReport crit = Run(Snap().WithRoom(Room(1, 10)), Snap().WithRoom(Room(1, 0)));
            Assert.True(Sum(crit).CanApply, "ноцтой нөлөөлөл ч apply хийхийг хориглохгүй (хэрэглэгч шийднэ)");
        }
    }
}
