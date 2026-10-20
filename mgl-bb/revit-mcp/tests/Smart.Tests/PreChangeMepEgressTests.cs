using System;
using System.Collections.Generic;
using System.Linq;
using RevitMcpAddin.ChangeImpact.Core;
using RevitMcpAddin.ClashCheck.Core;
using static RevitMcpAddin.Smart.Tests.PreChangeFixtures;

namespace RevitMcpAddin.Smart.Tests
{
    /// <summary>MEP clash ба гарцын замын тайлан — «хуучин / шинэ / арилсан», «тооцоогүй ≠ 0», «бүрэн биш ≠ цэвэр».</summary>
    public static class PreChangeMepEgressTests
    {
        /* ============================== MEP / CLASH ============================== */

        [Test]
        public static void Clash_ExistingBothBeforeAndAfter_IsExisting_NotCritical()
        {
            PreChangeReport r = Run(Snap().WithPair(Pair("k1", ClashVerdict.ConfirmedClash)), Snap().WithPair(Pair("k1", ClashVerdict.ConfirmedClash)));
            PreChangeItem it = Item(r, "clash:k1");
            Assert.NotNull(it);
            Assert.True(it.Title.StartsWith("Хуучин clash"));
            Assert.Eq(ItemSeverity.Ok, it.Severity);
            Assert.Eq(TruthState.Confirmed, it.Truth);
            Assert.Eq(0, PreChangeDiff.NewClashCount(r));
            Assert.True(r.Level != AttentionLevel.Critical);
        }

        [Test]
        public static void Clash_NoClashBeforeAndClashAfter_IsNewCriticalConfirmed()
        {
            PreChangeReport r = Run(Snap().WithPair(Pair("k1", ClashVerdict.NoClash)), Snap().WithPair(Pair("k1", ClashVerdict.ConfirmedClash, 123.4)));
            PreChangeItem it = Item(r, "clash:k1");
            Assert.NotNull(it);
            Assert.True(it.Title.StartsWith("Шинэ clash"));
            Assert.Eq(ItemSeverity.Critical, it.Severity);
            Assert.Eq(TruthState.Confirmed, it.Truth);
            Assert.Eq("123.4 см³", it.After);
            Assert.Eq(1, PreChangeDiff.NewClashCount(r));
            Assert.Eq(AttentionLevel.Critical, r.Level);
        }

        [Test]
        public static void Clash_AbsentBeforeAndClashAfter_IsAlsoNew()
        {
            PreChangeReport r = Run(Snap(), Snap().WithPair(Pair("k9", ClashVerdict.ConfirmedClash)));
            Assert.Eq(1, PreChangeDiff.NewClashCount(r));
            Assert.Eq(AttentionLevel.Critical, r.Level);
            Assert.True(Item(r, "clash:k9").Why.Contains("Өмнө нь энэ хос огтлолцоогүй"));
        }

        [Test]
        public static void Clash_ClashBeforeNoClashAfter_IsResolvedOk_AndNotCountedAsNew()
        {
            PreChangeReport r = Run(Snap().WithPair(Pair("k1", ClashVerdict.ConfirmedClash)), Snap().WithPair(Pair("k1", ClashVerdict.NoClash)));
            PreChangeItem it = Item(r, "clash:resolved:k1");
            Assert.NotNull(it);
            Assert.Eq(ItemSeverity.Ok, it.Severity);
            Assert.Eq(TruthState.Confirmed, it.Truth);
            Assert.True(it.Title.StartsWith("Clash арилна"));
            Assert.Eq(0, PreChangeDiff.NewClashCount(r));
            Assert.Eq(AttentionLevel.Clean, r.Level);
        }

        [Test]
        public static void Clash_ManyNew_AreCountedIndividually()
        {
            StateSnapshot a = Snap().WithPair(Pair("a", ClashVerdict.ConfirmedClash)).WithPair(Pair("b", ClashVerdict.ConfirmedClash)).WithPair(Pair("c", ClashVerdict.NoClash));
            PreChangeReport r = Run(Snap(), a);
            Assert.Eq(2, PreChangeDiff.NewClashCount(r));
        }

        [Test]
        public static void Clash_BeforeGeometryError_AfterClash_IsReview_CannotClaimNew()
        {
            PreChangeReport r = Run(Snap().WithPair(Pair("k1", ClashVerdict.GeometryError)), Snap().WithPair(Pair("k1", ClashVerdict.ConfirmedClash)));
            PreChangeItem it = Item(r, "clash:k1");
            Assert.NotNull(it);
            Assert.Eq(TruthState.Review, it.Truth);
            Assert.Eq(0, PreChangeDiff.NewClashCount(r), "өмнөх төлөв мэдэгдэхгүй бол «шинэ» гэж үл хэлнэ");
            Assert.True(r.Incomplete, "өмнөх талд геометр алдаа → бүрэн бус");
            Assert.True(r.Level != AttentionLevel.Clean);
        }

        [Test]
        public static void Clash_BeforeUnsupported_AfterClash_IsReview_CannotClaimNew()
        {
            PreChangeReport r = Run(Snap().WithPair(Pair("k1", ClashVerdict.Unsupported)), Snap().WithPair(Pair("k1", ClashVerdict.ConfirmedClash)));
            Assert.Eq(TruthState.Review, Item(r, "clash:k1").Truth);
            Assert.Eq(0, PreChangeDiff.NewClashCount(r));
            Assert.True(r.Level != AttentionLevel.Clean);
        }

        [Test]
        public static void Clash_NotEvaluated_IsNotEvaluatedItem_AndMepCardSaysNotCalculatedNotZero()
        {
            StateSnapshot b = Snap(), a = Snap();
            b.Clash = new ClashSnap { Evaluated = false, NotEvaluatedReason = "MEP шалгалт идэвхгүй" };
            a.Clash = new ClashSnap { Evaluated = false, NotEvaluatedReason = "MEP шалгалт идэвхгүй" };
            PreChangeReport r = Run(b, a);
            PreChangeItem it = Item(r, "clash:ne");
            Assert.NotNull(it);
            Assert.Eq(TruthState.NotEvaluated, it.Truth);
            Assert.Null(Item(r, "clash:none"));
            Assert.False(r.Coverage.ClashEvaluated);
            SummaryCard c = PreChangeSummary.Build(r).Card(PreChangeSummary.Mep);
            Assert.Eq("тооцоогүй", c.Value);
            Assert.Eq(TruthState.NotEvaluated, c.Truth);
            Assert.False(c.Value.StartsWith("0"));
            Assert.Eq("MEP шалгалт идэвхгүй", c.Detail);
        }

        [Test]
        public static void Clash_OneSideNotEvaluated_IsNotEvaluated()
        {
            StateSnapshot a = Snap();
            a.Clash = new ClashSnap { Evaluated = false };
            PreChangeReport r = Run(Snap(), a);
            Assert.Eq(TruthState.NotEvaluated, Item(r, "clash:ne").Truth);
            Assert.Eq("тооцоогүй", PreChangeSummary.Build(r).Card(PreChangeSummary.Mep).Value);
        }

        [Test]
        public static void Clash_UnloadedLink_IsIncomplete_NoZeroNewClashCard_NotClean()
        {
            StateSnapshot b = Snap(), a = Snap();
            b.Clash.Complete = false; b.Clash.IncompleteReasons.Add("Линк «MEP.rvt» ачаалагдаагүй");
            a.Clash.Complete = false; a.Clash.IncompleteReasons.Add("Линк «MEP.rvt» ачаалагдаагүй");
            PreChangeReport r = Run(b, a);
            Assert.Contains(r.IncompleteReasons, "Линк «MEP.rvt» ачаалагдаагүй");
            Assert.True(r.Level != AttentionLevel.Clean);
            Assert.Null(Item(r, "clash:none"), "«шинэ clash илрээгүй» гэж батлах боломжгүй");
            PreChangeItem inc = Item(r, "clash:incomplete");
            Assert.NotNull(inc);
            Assert.Eq(TruthState.Incomplete, inc.Truth);
            SummaryCard c = PreChangeSummary.Build(r).Card(PreChangeSummary.Mep);
            Assert.False(c.Value.StartsWith("0"), "карт «0 шинэ clash» гэж хэлж болохгүй");
            Assert.Eq("бүрэн биш", c.Value);
            Assert.False(r.Coverage.ClashComplete);
        }

        [Test]
        public static void Clash_UnloadedLinkOnOneSideOnly_IsStillIncomplete()
        {
            StateSnapshot a = Snap();
            a.Clash.Complete = false; a.Clash.IncompleteReasons.Add("линк алга");
            PreChangeReport r = Run(Snap(), a);
            Assert.True(r.Incomplete);
            Assert.True(r.Level != AttentionLevel.Clean);
        }

        [Test]
        public static void Clash_GeometryErrorPairAfter_IsIncomplete_AndNeverCleanZero()
        {
            PreChangeReport r = Run(Snap(), Snap().WithPair(Pair("k1", ClashVerdict.GeometryError)));
            Assert.True(r.IncompleteReasons.Any(s => s.Contains("геометрээр шалгаж чадсангүй")));
            Assert.Null(Item(r, "clash:none"));
            Assert.True(r.Level != AttentionLevel.Clean);
            Assert.False(PreChangeSummary.Build(r).Card(PreChangeSummary.Mep).Value.StartsWith("0"));
        }

        [Test]
        public static void Clash_UnsupportedPairAfter_IsIncomplete()
        {
            PreChangeReport r = Run(Snap(), Snap().WithPair(Pair("k1", ClashVerdict.Unsupported)));
            Assert.True(r.Incomplete);
            Assert.True(r.Level != AttentionLevel.Clean);
        }

        [Test]
        public static void Clash_CompleteAndNoPairs_SaysNoNewClash_WithZeroValuesAndCleanLevel()
        {
            PreChangeReport r = Run();
            PreChangeItem it = Item(r, "clash:none");
            Assert.NotNull(it);
            Assert.Eq(TruthState.Confirmed, it.Truth);
            Assert.Eq(ItemSeverity.Ok, it.Severity);
            Assert.Eq("0 шинэ clash", PreChangeSummary.Build(r).Card(PreChangeSummary.Mep).Value);
            Assert.True(r.Coverage.ClashComplete);
        }

        [Test]
        public static void Clash_NewClashSummaryCard_IsOneNewClash_CriticalTone()
        {
            PreChangeReport r = Run(Snap(), Snap().WithPair(Pair("k1", ClashVerdict.ConfirmedClash)));
            SummaryCard c = PreChangeSummary.Build(r).Card(PreChangeSummary.Mep);
            Assert.Eq("1 шинэ clash", c.Value);
            Assert.Eq(ItemSeverity.Critical, c.Tone);
            Assert.Eq(TruthState.Confirmed, c.Truth);
        }

        /* ============================== ГАРЦ ============================== */

        [Test]
        public static void Egress_NotConfigured_IsNotEvaluated_WithExactText_AndCardSaysNotCalculated()
        {
            PreChangeReport r = Run();
            PreChangeItem it = Item(r, "egress:ne");
            Assert.Eq(PreChangeText.EgressNotConfigured, it.Title);
            Assert.Eq(TruthState.NotEvaluated, it.Truth);
            Assert.False(r.Coverage.EgressConfigured);
            SummaryCard c = PreChangeSummary.Build(r).Card(PreChangeSummary.Egress);
            Assert.Eq("тооцоогүй", c.Value);
            Assert.Eq(TruthState.NotEvaluated, c.Truth);
        }

        [Test]
        public static void Egress_PathLonger_IsConfirmedPositiveDelta()
        {
            StateSnapshot b = Snap().WithEgress(Route(1, 10.00));
            StateSnapshot a = Snap().WithEgress(Route(1, 11.24));
            PreChangeReport r = Run(b, a);
            PreChangeItem it = Item(r, "egress:1");
            Assert.NotNull(it);
            Assert.Eq(TruthState.Confirmed, it.Truth);
            Assert.Near(1.24, it.DeltaValue.Value, 1e-9);
            Assert.True(it.Delta.Contains("+1.24 м"), it.Delta);
            Assert.Eq("10.00 м", it.Before);
            Assert.Eq("11.24 м", it.After);
            Assert.Eq(ItemSeverity.Notice, it.Severity);
            Assert.Eq(AttentionLevel.Review, r.Level);
            Assert.Eq("+1.24 м", PreChangeSummary.Build(r).Card(PreChangeSummary.Egress).Value);
        }

        [Test]
        public static void Egress_PathShorter_IsOkSeverity_NegativeDelta()
        {
            PreChangeReport r = Run(Snap().WithEgress(Route(1, 10.00)), Snap().WithEgress(Route(1, 9.50)));
            PreChangeItem it = Item(r, "egress:1");
            Assert.Eq(ItemSeverity.Ok, it.Severity);
            Assert.Near(-0.5, it.DeltaValue.Value, 1e-9);
            Assert.Eq("−0.50 м", it.Delta);
        }

        [Test]
        public static void Egress_UnchangedWithinTolerance_ProducesNoItem_CardSaysUnchanged()
        {
            PreChangeReport r = Run(Snap().WithEgress(Route(1, 10.00)), Snap().WithEgress(Route(1, 10.005)));
            Assert.Null(Item(r, "egress:1"));
            Assert.Eq("өөрчлөгдөхгүй", PreChangeSummary.Build(r).Card(PreChangeSummary.Egress).Value);
            Assert.Eq(AttentionLevel.Clean, r.Level);
        }

        [Test]
        public static void Egress_BeforeHasPathAfterNull_IsCritical_Impossible()
        {
            PreChangeReport r = Run(Snap().WithEgress(Route(1, 10.0)), Snap().WithEgress(Route(1, null)));
            PreChangeItem it = Item(r, "egress:1");
            Assert.Eq(ItemSeverity.Critical, it.Severity);
            Assert.Eq(TruthState.Confirmed, it.Truth);
            Assert.True(it.Title.Contains("боломжгүй"));
            Assert.Eq(AttentionLevel.Critical, r.Level);
            Assert.Eq("боломжгүй", PreChangeSummary.Build(r).Card(PreChangeSummary.Egress).Value);
        }

        [Test]
        public static void Egress_BeforeNullAfterHasPath_IsNotice()
        {
            PreChangeReport r = Run(Snap().WithEgress(Route(1, null)), Snap().WithEgress(Route(1, 12.0)));
            PreChangeItem it = Item(r, "egress:1");
            Assert.Eq(ItemSeverity.Notice, it.Severity);
            Assert.True(it.Title.Contains("боломжтой болно"));
        }

        [Test]
        public static void Egress_NoPathBeforeNorAfter_IsWarning_NotAChange()
        {
            PreChangeReport r = Run(Snap().WithEgress(Route(1, null)), Snap().WithEgress(Route(1, null)));
            Assert.Eq(ItemSeverity.Warning, Item(r, "egress:1").Severity);
            Assert.Null(Item(r, "egress:1").DeltaValue);
        }

        [Test]
        public static void Egress_RouteNotEvaluated_IsIncompleteReason_NotZero()
        {
            PreChangeReport r = Run(Snap().WithEgress(Route(1, 10.0, evaluated: false)), Snap().WithEgress(Route(1, 11.0, evaluated: false)));
            Assert.Null(Item(r, "egress:1"), "тооцоогүй зам дельта үүсгэж болохгүй");
            Assert.True(r.IncompleteReasons.Any(s => s.Contains("гарц хүртэлх замыг тооцоолж чадсангүй")));
            Assert.True(r.Level != AttentionLevel.Clean);
            Assert.False(r.Coverage.EgressEvaluated);
            SummaryCard c = PreChangeSummary.Build(r).Card(PreChangeSummary.Egress);
            Assert.Eq("тооцоогүй", c.Value);
            Assert.True(c.Truth != TruthState.Confirmed);
        }

        [Test]
        public static void Egress_RouteEvaluatedOnlyOneSide_IsIncomplete()
        {
            PreChangeReport r = Run(Snap().WithEgress(Route(1, 10.0)), Snap().WithEgress(Route(1, 11.0, evaluated: false)));
            Assert.Null(Item(r, "egress:1"));
            Assert.True(r.Incomplete);
        }

        [Test]
        public static void Egress_RoomOnlyInOneSnapshot_IsIncomplete()
        {
            PreChangeReport r = Run(Snap().WithEgress(Route(1, 10.0), Route(2, 5.0)), Snap().WithEgress(Route(1, 10.0)));
            Assert.True(r.IncompleteReasons.Any(s => s.Contains("гарц хүртэлх замыг")));
            Assert.True(r.Level != AttentionLevel.Clean);
            Assert.False(r.Coverage.EgressEvaluated);
        }

        [Test]
        public static void Egress_ConfiguredButSnapshotNotEvaluated_IsNotEvaluatedItem_WithIncompleteReasons()
        {
            StateSnapshot b = Snap().WithEgress(Route(1, 10.0));
            StateSnapshot a = Snap().WithEgress(Route(1, 11.0));
            a.Egress.Evaluated = false;
            a.Egress.NotEvaluatedReason = "Path of Travel сервис хариулсангүй";
            a.Egress.IncompleteReasons.Add("PoT уналт");
            PreChangeReport r = Run(b, a);
            PreChangeItem it = Item(r, "egress:ne");
            Assert.Eq(TruthState.NotEvaluated, it.Truth);
            Assert.True(it.Why.Contains("Path of Travel сервис хариулсангүй"));
            Assert.Contains(r.IncompleteReasons, "PoT уналт");
            Assert.True(r.Level != AttentionLevel.Clean);
            Assert.Null(Item(r, "egress:1"));
        }

        [Test]
        public static void Egress_ConfiguredWithNoRoutes_IsNotAZeroImpactCard()
        {
            PreChangeReport r = Run(Snap().WithEgress(), Snap().WithEgress());
            Assert.False(r.Coverage.EgressEvaluated);
            Assert.Eq("тооцоогүй", PreChangeSummary.Build(r).Card(PreChangeSummary.Egress).Value);
            Assert.Contains(r.Notes, "Гарцын замд нөлөөлөх өрөө олдсонгүй.");
        }

        [Test]
        public static void Egress_ReportedIncompleteReasonsFromSnapshots_AreCarried()
        {
            StateSnapshot b = Snap().WithEgress(Route(1, 10.0));
            StateSnapshot a = Snap().WithEgress(Route(1, 10.0));
            b.Egress.IncompleteReasons.Add("гарцын хаалга уншигдсангүй");
            PreChangeReport r = Run(b, a);
            Assert.Contains(r.IncompleteReasons, "гарцын хаалга уншигдсангүй");
            Assert.True(r.Level != AttentionLevel.Clean);
        }

        [Test]
        public static void Egress_NoHardCodedLegalThreshold_VeryLongPathStaysNoticeOnly()
        {
            // Хууль тогтоосон «max» ЭНД ХЭЗЭЭ Ч шалгагдахгүй: 500 м зам ч нормын «зөрчил» (Warning/Critical) болохгүй.
            PreChangeReport r = Run(Snap().WithEgress(Route(1, 10.0)), Snap().WithEgress(Route(1, 500.0)));
            PreChangeItem it = Item(r, "egress:1");
            Assert.Eq(ItemSeverity.Notice, it.Severity);
            Assert.Eq(TruthState.Confirmed, it.Truth);
            Assert.False(it.Why.ToLowerInvariant().Contains("max"));
            Assert.False(r.Items.Any(i => i.Category == PreChangeCategory.Egress && i.Severity >= ItemSeverity.Warning));
            Assert.True(r.Level != AttentionLevel.Critical);
            Assert.Eq(TruthState.NotEvaluated, Item(r, "norm").Truth, "норм ХЭЗЭЭ Ч автоматаар шалгагдахгүй");
        }
    }
}
