using System;
using System.Linq;
using RevitMcpAddin.ChangeImpact.Core;
using static RevitMcpAddin.Smart.Tests.PreChangeFixtures;

namespace RevitMcpAddin.Smart.Tests
{
    /// <summary>
    /// Apply: TransactionGroup { Transaction(commit) → settled төлөв } → preview-ийн settled төлөвтэй тулгана → Assimilate | RollBack.
    /// «Таарсан» гэж ЗӨВХӨН commit амжилттай болсны ДАРАА уншсан төлөвтэй тулгасан үед.
    /// </summary>
    public static class PreChangePostCommitTests
    {
        private static StateSnapshot Settled(double roomArea = 22.9, double wallX = 5300)
        {
            StateSnapshot s = Snap().WithRoom(Room(1, roomArea)).WithDim(Dim(10, 3900)).WithHosted(Door(30, 1600));
            s.Source = new ElementPlace { Id = 100, Location = new[] { 300.0, 0, 0, wallX, 0, 0 } };
            s.Clash.Evaluated = true;
            return s;
        }

        [Test]
        public static void SettledStatesMatch_Assimilates_AsVerified()
        {
            PostCommitVerdict v = PreChangePostCommitGate.Decide(Req(), Settled(), Settled(), true);
            Assert.Eq(PostCommitAction.Assimilate, v.Action);
            Assert.Eq(ApplyStatus.AppliedVerified, v.Status);
            Assert.Contains(v.Compared, "хананы байрлал");
            Assert.Contains(v.Compared, "өрөө");
        }

        [Test]
        public static void ApplySettledStateMismatch_RollsBackTheGroup()
        {
            PostCommitVerdict v = PreChangePostCommitGate.Decide(Req(), Settled(22.9), Settled(23.4), true);
            Assert.Eq(PostCommitAction.RollBack, v.Action);
            Assert.Eq(ApplyStatus.RolledBackMismatch, v.Status);
            Assert.True(v.Details.Any(d => d.Contains("талбай")));
            Assert.True(v.Message.Contains("БУЦААЛАА"));
        }

        [Test]
        public static void WallEndedUpElsewhere_RollsBack()
        {
            PostCommitVerdict v = PreChangePostCommitGate.Decide(Req(), Settled(wallX: 5300), Settled(wallX: 5350), true);
            Assert.Eq(PostCommitAction.RollBack, v.Action);
            Assert.True(v.Details.Any(d => d.Contains("Хана")));
        }

        [Test]
        public static void PreviewSettledStateMissing_RollsBack_NeverClaimsVerified()
        {
            Assert.Eq(PostCommitAction.RollBack, PreChangePostCommitGate.Decide(Req(), null, Settled(), true).Action);
            StateSnapshot bad = Settled(); bad.Captured = false;
            PostCommitVerdict v = PreChangePostCommitGate.Decide(Req(), bad, Settled(), true);
            Assert.Eq(PostCommitAction.RollBack, v.Action);
            Assert.Eq(ApplyStatus.Failed, v.Status);
        }

        [Test]
        public static void ActualSettledStateUnreadable_RollsBack_FailClosed()
        {
            StateSnapshot bad = Settled(); bad.Captured = false;
            Assert.Eq(PostCommitAction.RollBack, PreChangePostCommitGate.Decide(Req(), Settled(), bad, true).Action);
            Assert.Eq(PostCommitAction.RollBack, PreChangePostCommitGate.Decide(Req(), Settled(), null, true).Action);
        }

        [Test]
        public static void NotCommitted_RollsBack()
        {
            PostCommitVerdict v = PreChangePostCommitGate.Decide(Req(), Settled(), Settled(), false);
            Assert.Eq(PostCommitAction.RollBack, v.Action);
            Assert.Eq(ApplyStatus.Failed, v.Status);
        }

        [Test]
        public static void WallOnly_NoRoomsDimsHosted_IsStillVerifiedBecauseWallPositionIsCompared()
        {
            StateSnapshot p = Snap(); p.Source = new ElementPlace { Id = 100, Location = new[] { 300.0, 0, 0, 5300, 0, 0 } }; p.Clash.Evaluated = false;
            StateSnapshot a = Snap(); a.Source = new ElementPlace { Id = 100, Location = new[] { 300.0, 0, 0, 5300, 0, 0 } }; a.Clash.Evaluated = false;
            PostCommitVerdict v = PreChangePostCommitGate.Decide(Req(), p, a, true);
            Assert.Eq(PostCommitAction.Assimilate, v.Action);
            Assert.Contains(v.Compared, "хананы байрлал");
        }

        [Test]
        public static void NothingComparableAtAll_RollsBack()
        {
            StateSnapshot p = Snap(); p.Clash.Evaluated = false; StateSnapshot a = Snap(); a.Clash.Evaluated = false;
            PostCommitVerdict v = PreChangePostCommitGate.Decide(Req(), p, a, true);
            Assert.Eq(PostCommitAction.RollBack, v.Action, "ЮУ Ч тулгаагүй бол «баталгаажсан» гэж хэлэхгүй");
            Assert.Contains(v.NotCompared, "хананы байрлал");
        }

        [Test]
        public static void SmallWithinVerifyTolerance_StillMatches()
        {
            Assert.Eq(PostCommitAction.Assimilate, PreChangePostCommitGate.Decide(Req(), Settled(22.9, 5300), Settled(22.905, 5300.4), true).Action);
        }
    }
}
