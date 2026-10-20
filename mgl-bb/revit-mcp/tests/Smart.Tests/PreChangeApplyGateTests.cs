using System;
using System.Linq;
using RevitMcpAddin.ChangeImpact.Core;
using RevitMcpAddin.ClashCheck.Core;
using static RevitMcpAddin.Smart.Tests.PreChangeFixtures;

namespace RevitMcpAddin.Smart.Tests
{
    /// <summary>Apply товчийн fail-closed хаалга + preview-ийн «шинэ эсэх» (Unknown нь Fresh БИШ).</summary>
    public static class PreChangeApplyGateTests
    {
        private static ApplyGateResult Gate(PreChangeReport r, FreshnessState f, bool busy = false)
        {
            return PreChangeApplyGate.Evaluate(new ApplyGateInput { Decision = r == null ? null : PreChangeDecisionEngine.Decide(r), Freshness = f, Busy = busy, DistanceMm = 300 });
        }

        private static PreChangeReport Ok() { return Run(); }
        private static PreChangeReport Review() { return Run(Snap().WithRoom(Room(1, 24.8, true)), Snap().WithRoom(Room(1, 22.9))); }
        private static PreChangeReport Stop() { return Run(after: Snap().WithPair(Pair("D-03", ClashVerdict.ConfirmedClash))); }
        private static PreChangeReport Unknown()
        {
            StateSnapshot a = Snap(); a.Clash.Complete = false; a.Clash.IncompleteReasons.Add("1 линк unload хийгдсэн.");
            return Run(after: a);
        }

        /* ============================== FRESHNESS (fail-closed) ============= */

        [Test]
        public static void StaleCheckThrows_IsUnknown_NeverFresh()
        {
            FreshnessState f = PreChangeFreshness.FromStamps("s1", () => { throw new InvalidOperationException("Revit API"); });
            Assert.Eq(FreshnessState.Unknown, f);
            Assert.False(Gate(Ok(), f).PrimaryEnabled, "шалгаж чадаагүй бол Apply хаалттай");
            Assert.Eq(PreChangeFreshness.UnknownNotice, Gate(Ok(), f).Hint);
            Assert.True(Gate(Ok(), f).ShowRecheck);
        }

        [Test]
        public static void ProbeThatThrows_IsUnknown()
        {
            Assert.Eq(FreshnessState.Unknown, PreChangeFreshness.Probe(() => { throw new Exception("x"); }));
            Assert.Eq(FreshnessState.Unknown, PreChangeFreshness.Probe(null));
        }

        [Test]
        public static void MissingFingerprint_IsUnknown_ApplyDisabled()
        {
            PreChangeReport r = Ok(); r.Fingerprint = null;
            FreshnessState f = PreChangeFreshness.Of(r, () => "s1");
            Assert.Eq(FreshnessState.Unknown, f);
            Assert.False(Gate(r, f).PrimaryEnabled);
        }

        [Test]
        public static void MissingOrEmptyStamps_AreUnknown()
        {
            Assert.Eq(FreshnessState.Unknown, PreChangeFreshness.FromStamps(null, () => "s1"));
            Assert.Eq(FreshnessState.Unknown, PreChangeFreshness.FromStamps("", () => "s1"));
            Assert.Eq(FreshnessState.Unknown, PreChangeFreshness.FromStamps("s1", () => null));
            Assert.Eq(FreshnessState.Unknown, PreChangeFreshness.FromStamps("s1", () => ""));
            Assert.Eq(FreshnessState.Unknown, PreChangeFreshness.FromStamps("s1", null));
            Assert.Eq(FreshnessState.Unknown, PreChangeFreshness.Of(null, () => "s1"));
        }

        [Test]
        public static void EqualStamps_Fresh_DifferentStamps_Stale()
        {
            Assert.Eq(FreshnessState.Fresh, PreChangeFreshness.FromStamps("s1", () => "s1"));
            Assert.Eq(FreshnessState.Stale, PreChangeFreshness.FromStamps("s1", () => "s2"));
        }

        [Test]
        public static void Stale_DisablesApply_AndOffersRecheck()
        {
            ApplyGateResult g = Gate(Ok(), FreshnessState.Stale);
            Assert.False(g.PrimaryEnabled);
            Assert.True(g.ShowRecheck);
            Assert.Eq("Дахин шалгах", g.RecheckLabel);
            Assert.True(g.Hint.Contains("дахин шалгана"));
        }

        [Test]
        public static void StaleBeatsEverything_EvenAGreenPreview()
        {
            Assert.False(Gate(Ok(), FreshnessState.Stale).PrimaryEnabled);
            Assert.False(Gate(Review(), FreshnessState.Stale).PrimaryEnabled);
        }

        /* ============================== ТОВЧИЙН ТЕКСТ ======================= */

        [Test]
        public static void Green_SaysExactMovement()
        {
            ApplyGateResult g = Gate(Ok(), FreshnessState.Fresh);
            Assert.True(g.PrimaryEnabled);
            Assert.Eq("300 мм зөөх", g.PrimaryLabel);
            Assert.Eq(ApplyTone.Green, g.Tone);
        }

        [Test]
        public static void Amber_SaysReviewAndMovement()
        {
            ApplyGateResult g = Gate(Review(), FreshnessState.Fresh);
            Assert.True(g.PrimaryEnabled);
            Assert.Eq("Хянаад 300 мм зөөх", g.PrimaryLabel);
            Assert.Eq(ApplyTone.Amber, g.Tone);
        }

        [Test]
        public static void Red_DisablesPrimary_OffersWhy_NoOverride()
        {
            ApplyGateResult g = Gate(Stop(), FreshnessState.Fresh);
            Assert.False(g.PrimaryEnabled);
            Assert.True(g.ShowWhy);
            Assert.Eq(ApplyTone.Red, g.Tone);
            Assert.False(g.PrimaryLabel.Contains("зөөх") && g.PrimaryEnabled);
        }

        [Test]
        public static void Unknown_DisablesPrimary_OffersCompleteCheck()
        {
            ApplyGateResult g = Gate(Unknown(), FreshnessState.Fresh);
            Assert.False(g.PrimaryEnabled);
            Assert.True(g.ShowRecheck);
            Assert.Eq("Шалгалтыг гүйцээх", g.RecheckLabel);
            Assert.True(g.ShowWhy);
        }

        [Test]
        public static void Busy_DisablesEverything()
        {
            ApplyGateResult g = Gate(Ok(), FreshnessState.Fresh, busy: true);
            Assert.False(g.PrimaryEnabled);
            Assert.Eq("Шалгаж байна…", g.PrimaryLabel);
        }

        [Test]
        public static void NoPreview_DisablesPrimary()
        {
            Assert.False(Gate(null, FreshnessState.Fresh).PrimaryEnabled);
        }

        [Test]
        public static void ProvisionalResult_NeverEnablesApply()
        {
            PreChangeInput inp = Input(Snap().WithRoom(Room(1, 24.8, true)), Snap().WithRoom(Room(1, 22.9)));
            inp.Stage = AnalysisStage.Quick;
            ApplyGateResult g = Gate(PreChangeDiff.Compute(inp), FreshnessState.Fresh);
            Assert.False(g.PrimaryEnabled);
            Assert.True(g.PrimaryLabel.Contains("Эцсийн дүн"));
        }

        [Test]
        public static void Distance_IsRoundedInLabel()
        {
            var g = PreChangeApplyGate.Evaluate(new ApplyGateInput { Decision = PreChangeDecisionEngine.Decide(Ok()), Freshness = FreshnessState.Fresh, DistanceMm = 149.6 });
            Assert.Eq("150 мм зөөх", g.PrimaryLabel);
        }
    }
}
