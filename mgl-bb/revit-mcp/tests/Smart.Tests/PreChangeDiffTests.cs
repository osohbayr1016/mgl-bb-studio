using System;
using System.Collections.Generic;
using System.Linq;
using RevitMcpAddin.ChangeImpact.Core;
using RevitMcpAddin.ClashCheck.Core;
using static RevitMcpAddin.Smart.Tests.PreChangeFixtures;

namespace RevitMcpAddin.Smart.Tests
{
    /// <summary>
    /// `PreChangeDiff.Compute` — ӨМНӨ ↔ ДАРАА ялгаа → нөлөөллийн тайлан.  Бүтээгдэхүүний үндсэн амлалт:
    ///   хэмжсэн ялгаа = Confirmed · бодит хамаарал ч нотолгоогүй = Review · тооцоолоогүй = NotEvaluated (ХЭЗЭЭ Ч «0» биш) ·
    ///   бүрэн бус скан → IncompleteReasons ба Level ХЭЗЭЭ Ч Clean биш.
    /// </summary>
    public static class PreChangeDiffTests
    {
        /* ------------------------------ БАЗ: бүрэн цэвэр ------------------------------ */

        [Test]
        public static void Baseline_FullyCompleteDeltaFreeInput_IsClean()
        {
            PreChangeReport r = Run();
            Assert.Eq(AttentionLevel.Clean, r.Level);
            Assert.False(r.Incomplete, "бүрэн дууссан → бүрэн бус шалтгаан байхгүй");
            Assert.True(r.CanApply);
            Assert.False(r.IsBlocked);
            Assert.False(r.Items.Any(i => i.Truth == TruthState.Confirmed && i.Severity >= ItemSeverity.Notice));
        }

        [Test]
        public static void Baseline_NotConfiguredEgressAndNorm_AreNotEvaluated_NeverZero()
        {
            PreChangeReport r = Run();
            PreChangeItem eg = Item(r, "egress:ne");
            PreChangeItem norm = Item(r, "norm");
            Assert.NotNull(eg);
            Assert.Eq(TruthState.NotEvaluated, eg.Truth);
            Assert.NotNull(norm);
            Assert.Eq(TruthState.NotEvaluated, norm.Truth);
            Assert.Null(eg.BeforeValue, "тооцоогүй зүйл тоо (0) агуулж болохгүй");
            Assert.Null(eg.AfterValue);
            Assert.Null(norm.DeltaValue);
        }

        [Test]
        public static void Baseline_UnknownTruth_NormalizesToIncomplete_NeverConfirmed()
        {
            Assert.Eq(TruthState.Incomplete, Truth.Normalize(TruthState.Unknown));
            Assert.Eq(TruthState.Confirmed, Truth.Normalize(TruthState.Confirmed));
            Assert.Eq(Truth.Label(TruthState.Incomplete), Truth.Label(TruthState.Unknown));
        }

        [Test]
        public static void Compute_NullInput_Throws()
        {
            Assert.Throws<ArgumentNullException>(() => PreChangeDiff.Compute(null));
        }

        [Test]
        public static void Compute_NullSnapshotsAndDeps_AreIncomplete_NeverClean()
        {
            var inp = new PreChangeInput { Request = Req(), Outcome = SandboxOutcome.Simulated };
            PreChangeReport r = PreChangeDiff.Compute(inp);
            Assert.True(r.Incomplete);
            Assert.True(r.Level != AttentionLevel.Clean);
        }

        /* ------------------------------ ӨРӨӨ ------------------------------ */

        [Test]
        public static void Room_UnchangedArea_ProducesNoRoomItem()
        {
            PreChangeReport r = Run(Snap().WithRoom(Room(1, 34.82)), Snap().WithRoom(Room(1, 34.82)));
            Assert.Eq(0, r.Of(PreChangeCategory.Room).Count());
            Assert.Eq(AttentionLevel.Clean, r.Level);
        }

        [Test]
        public static void Room_AreaChangeWithinTolerance_ProducesNoRoomItem()
        {
            PreChangeReport r = Run(Snap().WithRoom(Room(1, 34.82)), Snap().WithRoom(Room(1, 34.82 + PreChangeTolerance.AreaM2 * 0.9)));
            Assert.Eq(0, r.Of(PreChangeCategory.Room).Count());
        }

        [Test]
        public static void Room_AreaChanged_ProducesConfirmedItemWithValuesAndText()
        {
            PreChangeReport r = Run(Snap().WithRoom(Room(1, 35.33)), Snap().WithRoom(Room(1, 34.82)));
            PreChangeItem it = Item(r, "room:1");
            Assert.NotNull(it);
            Assert.Eq(TruthState.Confirmed, it.Truth);
            Assert.Eq(PreChangeCategory.Room, it.Category);
            Assert.Eq(ItemSeverity.Warning, it.Severity);
            Assert.Near(35.33, it.BeforeValue.Value, 1e-9);
            Assert.Near(34.82, it.AfterValue.Value, 1e-9);
            Assert.Near(-0.51, it.DeltaValue.Value, 1e-9);
            Assert.Eq("35.33 м²", it.Before);
            Assert.Eq("34.82 м²", it.After);
            Assert.Eq("−0.51 м²", it.Delta);
            Assert.True(it.Delta.StartsWith(PreChangeText.Minus), "U+2212 минус, ASCII '-' биш");
            Assert.False(it.Delta.Contains("-"));
            Assert.Eq(AttentionLevel.Review, r.Level);
        }

        [Test]
        public static void Room_AreaIncrease_HasPlusSign()
        {
            PreChangeReport r = Run(Snap().WithRoom(Room(1, 20.00)), Snap().WithRoom(Room(1, 20.75)));
            Assert.Eq("+0.75 м²", Item(r, "room:1").Delta);
        }

        [Test]
        public static void Room_BoundedBySource_ExplainsWallCreatesBoundary()
        {
            PreChangeReport r = Run(Snap().WithRoom(Room(1, 20, bounded: true)), Snap().WithRoom(Room(1, 21)));
            Assert.True(Item(r, "room:1").Why.Contains("хилийг үүсгэнэ"));
        }

        [Test]
        public static void Room_BecomesNotEnclosed_IsCriticalConfirmed_AndReportCritical()
        {
            RoomSnap after = Room(1, 0);                       // Placed, Area 0 → !Enclosed
            Assert.False(after.Enclosed);
            PreChangeReport r = Run(Snap().WithRoom(Room(1, 35.33)), Snap().WithRoom(after));
            PreChangeItem it = Item(r, "room:1");
            Assert.NotNull(it);
            Assert.Eq(ItemSeverity.Critical, it.Severity);
            Assert.Eq(TruthState.Confirmed, it.Truth);
            Assert.Eq("35.33 м²", it.Before);
            Assert.Eq(AttentionLevel.Critical, r.Level);
        }

        [Test]
        public static void Room_BecomesNotPlaced_IsCritical()
        {
            RoomSnap after = Room(1, 35.33);
            after.Placed = false;
            PreChangeReport r = Run(Snap().WithRoom(Room(1, 35.33)), Snap().WithRoom(after));
            Assert.Eq(ItemSeverity.Critical, Item(r, "room:1").Severity);
            Assert.Eq(AttentionLevel.Critical, r.Level);
        }

        [Test]
        public static void Room_UnreadableAfter_IsNotReportedAsZeroChange_AndAddsIncompleteReason()
        {
            RoomSnap after = Room(1, 0);
            after.Readable = false;
            PreChangeReport r = Run(Snap().WithRoom(Room(1, 35.33)), Snap().WithRoom(after));
            Assert.Eq(0, r.Of(PreChangeCategory.Room).Count(), "уншигдаагүй өрөөнд «талбай 0 болно» гэж хэлж болохгүй");
            Assert.True(r.IncompleteReasons.Any(s => s.Contains("өрөөний талбайг уншиж чадсангүй")));
            Assert.True(r.Level != AttentionLevel.Clean);
        }

        [Test]
        public static void Room_UnreadableBefore_IsNotReportedAsZeroChange_AndAddsIncompleteReason()
        {
            RoomSnap before = Room(1, 35.33);
            before.Readable = false;
            PreChangeReport r = Run(Snap().WithRoom(before), Snap().WithRoom(Room(1, 34.0)));
            Assert.Eq(0, r.Of(PreChangeCategory.Room).Count());
            Assert.True(r.Incomplete);
            Assert.True(r.Level != AttentionLevel.Clean);
        }

        [Test]
        public static void Room_PresentBeforeMissingAfter_IsCritical()
        {
            PreChangeReport r = Run(Snap().WithRoom(Room(1, 35.33)), Snap());
            PreChangeItem it = Item(r, "room:1");
            Assert.NotNull(it);
            Assert.Eq(ItemSeverity.Critical, it.Severity);
            Assert.Eq(TruthState.Confirmed, it.Truth);
            Assert.Eq(AttentionLevel.Critical, r.Level);
        }

        [Test]
        public static void Room_NewRoomAfter_IsWarning()
        {
            PreChangeReport r = Run(Snap(), Snap().WithRoom(Room(5, 12.0)));
            PreChangeItem it = Item(r, "room:5");
            Assert.NotNull(it);
            Assert.Eq(ItemSeverity.Warning, it.Severity);
            Assert.Eq(TruthState.Confirmed, it.Truth);
            Assert.Eq("12.00 м²", it.After);
            Assert.Eq(AttentionLevel.Review, r.Level);
        }

        [Test]
        public static void Room_NotEnclosedBeforeAndAfter_IsSkipped()
        {
            PreChangeReport r = Run(Snap().WithRoom(Room(1, 0)), Snap().WithRoom(Room(1, 0)));
            Assert.Eq(0, r.Of(PreChangeCategory.Room).Count());
        }

        [Test]
        public static void Room_NewlyEnclosed_IsNoticeNotCritical()
        {
            PreChangeReport r = Run(Snap().WithRoom(Room(1, 0)), Snap().WithRoom(Room(1, 9.0)));
            Assert.Eq(ItemSeverity.Notice, Item(r, "room:1").Severity);
        }

        /* ------------------------------ ХЭМЖЭЭС ------------------------------ */

        [Test]
        public static void Dimension_SingleSegmentChanged_IsConfirmedWithDeltaMm()
        {
            PreChangeReport r = Run(Snap().WithDim(Dim(10, 4200)), Snap().WithDim(Dim(10, 4500)));
            PreChangeItem it = Item(r, "dim:10");
            Assert.NotNull(it);
            Assert.Eq(TruthState.Confirmed, it.Truth);
            Assert.Eq("4200 мм", it.Before);
            Assert.Eq("4500 мм", it.After);
            Assert.Eq("+300 мм", it.Delta);
            Assert.Near(300, it.DeltaValue.Value, 1e-9);
            Assert.Near(4200, it.BeforeValue.Value, 1e-9);
            Assert.Eq(AttentionLevel.Review, r.Level);
        }

        [Test]
        public static void Dimension_NegativeDelta_UsesU2212Minus()
        {
            PreChangeReport r = Run(Snap().WithDim(Dim(10, 4200)), Snap().WithDim(Dim(10, 3900)));
            Assert.Eq("−300 мм", Item(r, "dim:10").Delta);
        }

        [Test]
        public static void Dimension_MultiSegmentChanged_IsConfirmed_WithSegmentDeltas()
        {
            PreChangeReport r = Run(Snap().WithDim(Dim(11, 1000, 2000)), Snap().WithDim(Dim(11, 1000, 2300)));
            PreChangeItem it = Item(r, "dim:11");
            Assert.NotNull(it);
            Assert.Eq(TruthState.Confirmed, it.Truth);
            Assert.Eq("1000 · 2000 мм", it.Before);
            Assert.Eq("1000 · 2300 мм", it.After);
            Assert.Eq("өөрчлөгдөөгүй · +300 мм", it.Delta);
            Assert.Near(300, it.DeltaValue.Value, 1e-9);
        }

        [Test]
        public static void Dimension_Unchanged_HasNoConfirmedItem_OnlyAggregatedReviewOk()
        {
            PreChangeReport r = Run(Snap().WithDim(Dim(10, 4200)).WithDim(Dim(11, 1000, 2000)),
                                    Snap().WithDim(Dim(10, 4200.3)).WithDim(Dim(11, 1000, 2000)));
            Assert.False(r.Of(PreChangeCategory.Dimension).Any(i => i.Truth == TruthState.Confirmed));
            PreChangeItem agg = Item(r, "dim:unchanged");
            Assert.NotNull(agg);
            Assert.Eq(TruthState.Review, agg.Truth);
            Assert.Eq(ItemSeverity.Ok, agg.Severity);
            Assert.True(agg.Title.StartsWith("2 "));
            Assert.Eq(AttentionLevel.Clean, r.Level, "өөрчлөгдөөгүй хэмжээс ганцаараа түвшинг өсгөхгүй");
        }

        [Test]
        public static void Dimension_Unreadable_AddsIncompleteReason_NotAZeroChange()
        {
            DimSnap bad = Dim(10, 4200);
            bad.Readable = false;
            PreChangeReport r = Run(Snap().WithDim(Dim(10, 4200)), Snap().WithDim(bad));
            Assert.Eq(0, r.Of(PreChangeCategory.Dimension).Count());
            Assert.True(r.IncompleteReasons.Any(s => s.Contains("хэмжээсийн тоон утгыг уншиж чадсангүй")));
            Assert.True(r.Level != AttentionLevel.Clean);
        }

        [Test]
        public static void Dimension_CandidateNeverCaptured_IsIncomplete()
        {
            var deps = Deps();
            deps.DimensionIds.Add(77);                       // graph хэмжээс гэж хэлсэн, гэхдээ snapshot-д алга
            PreChangeReport r = Run(Snap(), Snap(), deps);
            Assert.True(r.IncompleteReasons.Any(s => s.Contains("хэмжээс")));
            Assert.True(r.Level != AttentionLevel.Clean);
        }

        [Test]
        public static void Dimension_SegmentCountChanged_IsReviewNotConfirmed()
        {
            PreChangeReport r = Run(Snap().WithDim(Dim(10, 1000, 2000)), Snap().WithDim(Dim(10, 3000)));
            PreChangeItem it = Item(r, "dim:10");
            Assert.Eq(TruthState.Review, it.Truth);
        }

        [Test]
        public static void Dimension_RemovedAfter_IsCriticalConfirmed()
        {
            PreChangeReport r = Run(Snap().WithDim(Dim(10, 4200)), Snap());
            Assert.Eq(ItemSeverity.Critical, Item(r, "dim:10").Severity);
            Assert.Eq(AttentionLevel.Critical, r.Level);
        }

        /* ------------------------------ ХАРАГДАЦ / ХУУДАС ------------------------------ */

        [Test]
        public static void ViewsAndSheets_AreReviewTruth_NeverConfirmed_SeverityNotice()
        {
            var deps = Deps();
            deps.Views.Add(View(1, "FloorPlan", 20));
            deps.Views.Add(View(2, "Section", 20));
            deps.Sheets.Add(Sheet(20, "A-101"));
            PreChangeReport r = Run(Snap(), Snap(), deps);
            foreach (PreChangeItem i in r.Items.Where(i => i.Category == PreChangeCategory.View || i.Category == PreChangeCategory.Sheet))
            {
                Assert.Eq(TruthState.Review, i.Truth, i.Key);
                Assert.Eq(ItemSeverity.Notice, i.Severity, i.Key);
            }
            Assert.Eq(2, r.Of(PreChangeCategory.View).Count());
            Assert.Eq(1, r.Of(PreChangeCategory.Sheet).Count());
            Assert.Eq(AttentionLevel.Review, r.Level);
            Assert.False(r.Items.Any(i => (i.Category == PreChangeCategory.View || i.Category == PreChangeCategory.Sheet) && i.Truth == TruthState.Confirmed));
        }

        [Test]
        public static void Views_DuplicateDependencyEntries_BecomeSingleItem()
        {
            var deps = Deps();
            deps.Views.Add(View(1, "FloorPlan", 20));
            deps.Views.Add(View(1, "FloorPlan", 20));
            deps.Sheets.Add(Sheet(20, "A-101"));
            deps.Sheets.Add(Sheet(20, "A-101"));
            PreChangeReport r = Run(Snap(), Snap(), deps);
            Assert.Eq(1, r.Of(PreChangeCategory.View).Count());
            Assert.Eq(1, r.Of(PreChangeCategory.Sheet).Count());
        }

        [Test]
        public static void Views_DuplicateWithDifferentConfidence_KeepsStrongestEvidence()
        {
            var deps = Deps();
            DepNode weak = View(1, "FloorPlan"); weak.Confidence = ImpactConfidence.D;
            DepNode strong = View(1, "FloorPlan"); strong.Confidence = ImpactConfidence.A;
            deps.Views.Add(weak);
            deps.Views.Add(strong);
            PreChangeReport r = Run(Snap(), Snap(), deps);
            Assert.Eq(ImpactConfidence.A, Item(r, "view:1").Confidence);
        }

        [Test]
        public static void Views_ShowSheetNumbersFromReachedSheets()
        {
            var deps = Deps();
            deps.Views.Add(View(1, "FloorPlan", 20, 21));
            deps.Sheets.Add(Sheet(20, "A-102"));
            deps.Sheets.Add(Sheet(21, "A-101"));
            PreChangeReport r = Run(Snap(), Snap(), deps);
            Assert.Eq("A-101, A-102", Item(r, "view:1").SheetNumber);
        }

        [Test]
        public static void DistinctSheetCount_UnionsSheetsReachedThroughViewsAndSchedules()
        {
            var deps = Deps();
            deps.Sheets.Add(Sheet(20, "A-101"));
            deps.Views.Add(View(1, "FloorPlan", 20, 21));
            deps.Views.Add(View(2, "Section", 21));
            deps.Schedules.Add(Sched(50, 22, 20));
            Assert.Eq(3, PreChangeDiff.DistinctSheetCount(deps));
            Assert.Eq(0, PreChangeDiff.DistinctSheetCount(null));
            Assert.Eq(0, PreChangeDiff.DistinctSheetCount(new PreChangeDependencies()));
        }

        [Test]
        public static void Tags_AreAggregatedIntoOneReviewItem()
        {
            var deps = Deps();
            deps.Tags.Add(new DepNode { Id = 5, Kind = ImpactNodeKind.Tag });
            deps.Tags.Add(new DepNode { Id = 5, Kind = ImpactNodeKind.Tag });
            deps.Tags.Add(new DepNode { Id = 6, Kind = ImpactNodeKind.Tag });
            PreChangeReport r = Run(Snap(), Snap(), deps);
            PreChangeItem it = Item(r, "tags");
            Assert.Eq(TruthState.Review, it.Truth);
            Assert.True(it.Title.StartsWith("2 tag"));
        }

        /* ------------------------------ ТОЛГОЙ ДҮГНЭЛТ: бүрэн бус скан ------------------------------ */

        [Test]
        public static void Incomplete_VisibilityNotChecked_AddsReason_AndLevelNeverClean()
        {
            var deps = Deps();
            deps.VisibilityChecked = false;
            PreChangeReport r = Run(Snap(), Snap(), deps);
            Assert.True(r.Incomplete);
            Assert.True(r.IncompleteReasons.Any(s => s.Contains("Харагдалтыг шалгаагүй")));
            Assert.True(r.Level != AttentionLevel.Clean);
            Assert.False(r.Coverage.ViewsChecked);
        }

        [Test]
        public static void Incomplete_AfterVisibilityNotChecked_AddsReason()
        {
            var deps = Deps();
            deps.AfterVisibilityChecked = false;
            PreChangeReport r = Run(Snap(), Snap(), deps);
            Assert.True(r.IncompleteReasons.Any(s => s.Contains("ДАРАА")));
            Assert.True(r.Level != AttentionLevel.Clean);
        }

        [Test]
        public static void Incomplete_AfterNotCaptured_AddsReason_AndLevelNeverClean()
        {
            StateSnapshot after = Snap();
            after.Captured = false;
            PreChangeReport r = Run(Snap(), after);
            Assert.True(r.Incomplete);
            Assert.True(r.Level != AttentionLevel.Clean);
            Assert.False(r.Coverage.RoomsChecked);
            Assert.False(r.Coverage.DimensionsChecked);
        }

        [Test]
        public static void Incomplete_BeforeNotCaptured_AddsReason()
        {
            StateSnapshot before = Snap();
            before.Captured = false;
            PreChangeReport r = Run(before, Snap());
            Assert.True(r.IncompleteReasons.Any(s => s.Contains("ӨМНӨХ")));
            Assert.True(r.Level != AttentionLevel.Clean);
        }

        [Test]
        public static void Incomplete_ReasonsFromSnapshotsDepsAndExtra_AreAllCollected_AndDeduplicated()
        {
            StateSnapshot b = Snap(), a = Snap();
            b.IncompleteReasons.Add("capture-before");
            a.IncompleteReasons.Add("capture-after");
            var deps = Deps();
            deps.IncompleteReasons.Add("graph-limit");
            deps.IncompleteReasons.Add("graph-limit");
            PreChangeInput inp = Input(b, a, deps);
            inp.ExtraIncompleteReasons.Add("extra");
            PreChangeReport r = PreChangeDiff.Compute(inp);
            foreach (string s in new[] { "capture-before", "capture-after", "graph-limit", "extra" })
                Assert.Contains(r.IncompleteReasons, s);
            Assert.Eq(1, r.IncompleteReasons.Count(s => s == "graph-limit"));
            Assert.True(r.Level != AttentionLevel.Clean);
        }

        [Test]
        public static void Incomplete_BlankReasons_AreIgnored()
        {
            StateSnapshot b = Snap();
            b.IncompleteReasons.Add("  ");
            b.IncompleteReasons.Add(null);
            PreChangeReport r = Run(b, Snap());
            Assert.False(r.Incomplete);
            Assert.Eq(AttentionLevel.Clean, r.Level);
        }

        [Test]
        public static void Level_CriticalWinsEvenWhenIncomplete()
        {
            StateSnapshot after = Snap().WithRoom(Room(1, 0));
            after.IncompleteReasons.Add("x");
            PreChangeReport r = Run(Snap().WithRoom(Room(1, 10)), after);
            Assert.Eq(AttentionLevel.Critical, r.Level);
            Assert.True(r.Incomplete);
        }

        [Test]
        public static void Items_AreOrderedMostSevereFirst()
        {
            StateSnapshot b = Snap().WithRoom(Room(1, 10)).WithRoom(Room(2, 10));
            StateSnapshot a = Snap().WithRoom(Room(1, 0)).WithRoom(Room(2, 11));
            PreChangeReport r = Run(b, a);
            Assert.Eq(ItemSeverity.Critical, r.Items[0].Severity);
            for (int i = 1; i < r.Items.Count; i++)
                Assert.True((int)r.Items[i - 1].Severity >= (int)r.Items[i].Severity, "эрэмбэ буурах");
        }

        /* ------------------------------ REVIT FAILURE / DELETE ------------------------------ */

        [Test]
        public static void Failure_ErrorIsCritical_WarningIsNotice()
        {
            PreChangeInput inp = Input();
            inp.Failures.Add(new FailureNote { IsError = true, Text = "Хана давхцана", ElementIds = new List<long> { 7 } });
            inp.Failures.Add(new FailureNote { IsError = false, Text = "Жижиг анхааруулга" });
            inp.Failures.Add(new FailureNote { IsError = true, Text = "  " });       // хоосон текст алгасагдана
            PreChangeReport r = PreChangeDiff.Compute(inp);
            Assert.Eq(2, r.Of(PreChangeCategory.Failure).Count());
            Assert.Eq(ItemSeverity.Critical, Item(r, "failure:0").Severity);
            Assert.Eq(7L, Item(r, "failure:0").Id);
            Assert.Eq(ItemSeverity.Notice, Item(r, "failure:1").Severity);
            Assert.Eq(AttentionLevel.Critical, r.Level);
        }

        [Test]
        public static void DeletedElements_AreCriticalConfirmed()
        {
            StateSnapshot a = Snap();
            a.DeletedIds.AddRange(new long[] { 1, 2, 3 });
            PreChangeReport r = Run(Snap(), a);
            PreChangeItem it = Item(r, "deleted");
            Assert.NotNull(it);
            Assert.Eq(ItemSeverity.Critical, it.Severity);
            Assert.Eq(TruthState.Confirmed, it.Truth);
            Assert.Near(3, it.AfterValue.Value, 1e-9);
            Assert.True(it.Title.StartsWith("3 "));
            Assert.Eq(AttentionLevel.Critical, r.Level);
        }

        /* ------------------------------ HOSTED / CLEARANCE ------------------------------ */

        [Test]
        public static void Hosted_MovedExactlyByRequestVector_IsConfirmedOk_NotAViolation()
        {
            PreChangeReport r = Run(Snap().WithHosted(Door(30, 1000)), Snap().WithHosted(Door(30, 1300)), req: Req(300, 1, 0));
            PreChangeItem it = Item(r, "host:30");
            Assert.NotNull(it);
            Assert.Eq(TruthState.Confirmed, it.Truth);
            Assert.Eq(ItemSeverity.Ok, it.Severity, "ханатайгаа хамт хөдөлнө — зөрчил биш");
            Assert.True(it.Why.Contains("хамт"));
            Assert.Eq("300 мм", it.Delta);
            Assert.True(r.Level != AttentionLevel.Critical);
            Assert.False(r.Items.Any(i => i.Category == PreChangeCategory.Hosted && i.Severity >= ItemSeverity.Warning));
        }

        [Test]
        public static void Hosted_MovedByRequestVectorWithinTolerance_StillMovesWithSource()
        {
            PreChangeReport r = Run(Snap().WithHosted(Door(30, 1000)), Snap().WithHosted(Door(30, 1300.8)), req: Req(300, 1, 0));
            Assert.Eq(ItemSeverity.Ok, Item(r, "host:30").Severity);
        }

        [Test]
        public static void Hosted_MovedDiagonalVector_MatchesNonAxisRequest()
        {
            double c = Math.Sqrt(0.5);
            PreChangeRequest req = Req(1000, c, c);
            double dx = c * 1000;
            PreChangeReport r = Run(Snap().WithHosted(Door(30, 0, 0)), Snap().WithHosted(Door(30, dx, dx)), req: req);
            Assert.Eq(ItemSeverity.Ok, Item(r, "host:30").Severity);
        }

        [Test]
        public static void Hosted_MovedByDifferentAmount_IsWarning()
        {
            PreChangeReport r = Run(Snap().WithHosted(Door(30, 1000)), Snap().WithHosted(Door(30, 1100)), req: Req(300, 1, 0));
            PreChangeItem it = Item(r, "host:30");
            Assert.Eq(ItemSeverity.Warning, it.Severity);
            Assert.Eq(TruthState.Confirmed, it.Truth);
            Assert.True(it.Why.Contains("ӨӨР"));
        }

        [Test]
        public static void Hosted_MovedInWrongDirection_IsWarning()
        {
            PreChangeReport r = Run(Snap().WithHosted(Door(30, 1000)), Snap().WithHosted(Door(30, 700)), req: Req(300, 1, 0));
            Assert.Eq(ItemSeverity.Warning, Item(r, "host:30").Severity);
        }

        [Test]
        public static void Hosted_NotMoved_ProducesNoMoveItem()
        {
            PreChangeReport r = Run(Snap().WithHosted(Door(30, 1000)), Snap().WithHosted(Door(30, 1000)));
            Assert.Null(Item(r, "host:30"));
        }

        [Test]
        public static void Hosted_Deleted_IsCritical()
        {
            HostedSnap gone = Door(30, 1000);
            gone.Exists = false;
            PreChangeReport r1 = Run(Snap().WithHosted(Door(30, 1000)), Snap().WithHosted(gone));
            PreChangeReport r2 = Run(Snap().WithHosted(Door(30, 1000)), Snap());
            foreach (PreChangeReport r in new[] { r1, r2 })
            {
                Assert.Eq(ItemSeverity.Critical, Item(r, "host:30").Severity);
                Assert.Eq(TruthState.Confirmed, Item(r, "host:30").Truth);
                Assert.Eq(AttentionLevel.Critical, r.Level);
            }
        }

        [Test]
        public static void Hosted_LocationUnreadable_IsIncomplete_NotAssumedMovedWithSource()
        {
            HostedSnap a = Door(30, 1000); a.LocationMm = null;
            PreChangeReport r = Run(Snap().WithHosted(Door(30, 1000)), Snap().WithHosted(a));
            Assert.Null(Item(r, "host:30"));
            Assert.True(r.IncompleteReasons.Any(s => s.Contains("байрлалыг уншиж чадсангүй")));
            Assert.True(r.Level != AttentionLevel.Clean);
        }

        [Test]
        public static void Hosted_FromToRoomChange_IsConfirmedNotice()
        {
            HostedSnap b = Door(30, 1000);
            HostedSnap a = Door(30, 1000);
            a.ToRoomId = 3; a.ToRoomName = "C";
            PreChangeReport r = Run(Snap().WithHosted(b), Snap().WithHosted(a));
            PreChangeItem it = Item(r, "host-rooms:30");
            Assert.NotNull(it);
            Assert.Eq(TruthState.Confirmed, it.Truth);
            Assert.Eq(ItemSeverity.Notice, it.Severity);
            Assert.Eq("A → B", it.Before);
            Assert.Eq("A → C", it.After);
            Assert.Eq(AttentionLevel.Review, r.Level);
        }

        [Test]
        public static void Hosted_RoomsUnreadable_DoNotProduceRoomChangeItem()
        {
            HostedSnap b = Door(30, 1000), a = Door(30, 1000);
            a.ToRoomId = 3; a.RoomsReadable = false;
            PreChangeReport r = Run(Snap().WithHosted(b), Snap().WithHosted(a));
            Assert.Null(Item(r, "host-rooms:30"));
        }

        [Test]
        public static void Clearance_EvaluatedBeforeAndAfter_DecreaseIsWarning_ConfirmedDelta()
        {
            HostedSnap b = Door(30, 1000); b.ClearanceEvaluated = true; b.ClearanceMm = 1200;
            HostedSnap a = Door(30, 1000); a.ClearanceEvaluated = true; a.ClearanceMm = 900;
            PreChangeReport r = Run(Snap().WithHosted(b), Snap().WithHosted(a));
            PreChangeItem it = Item(r, "clr:30");
            Assert.NotNull(it);
            Assert.Eq(TruthState.Confirmed, it.Truth);
            Assert.Eq(ItemSeverity.Warning, it.Severity);
            Assert.Near(-300, it.DeltaValue.Value, 1e-9);
            Assert.Eq("−300 мм", it.Delta);
            Assert.Null(Item(r, "clr:ne"), "хоёулаа тооцоолсон тул «тооцоогүй» мөр гарахгүй");
        }

        [Test]
        public static void Clearance_Increase_IsNotice()
        {
            HostedSnap b = Door(30, 1000); b.ClearanceEvaluated = true; b.ClearanceMm = 900;
            HostedSnap a = Door(30, 1000); a.ClearanceEvaluated = true; a.ClearanceMm = 1200;
            PreChangeReport r = Run(Snap().WithHosted(b), Snap().WithHosted(a));
            Assert.Eq(ItemSeverity.Notice, Item(r, "clr:30").Severity);
            Assert.Eq("+300 мм", Item(r, "clr:30").Delta);
        }

        [Test]
        public static void Clearance_UnchangedWithinTolerance_ProducesNoItem()
        {
            HostedSnap b = Door(30, 1000); b.ClearanceEvaluated = true; b.ClearanceMm = 1200;
            HostedSnap a = Door(30, 1000); a.ClearanceEvaluated = true; a.ClearanceMm = 1200.3;
            PreChangeReport r = Run(Snap().WithHosted(b), Snap().WithHosted(a));
            Assert.Null(Item(r, "clr:30"));
        }

        [Test]
        public static void Clearance_NotEvaluated_IsNotEvaluatedItem_NeverANumber()
        {
            HostedSnap b = Door(30, 1000);                    // ClearanceEvaluated=false
            HostedSnap a = Door(30, 1000);
            a.ClearanceNote = "3D харагдац алга";
            PreChangeReport r = Run(Snap().WithHosted(b), Snap().WithHosted(a));
            PreChangeItem it = Item(r, "clr:ne");
            Assert.NotNull(it);
            Assert.Eq(TruthState.NotEvaluated, it.Truth);
            Assert.Null(it.BeforeValue);
            Assert.Null(it.AfterValue);
            Assert.Null(it.DeltaValue);
            Assert.Null(it.Before);
            Assert.True(it.Why.Contains("3D харагдац алга"));
            Assert.Null(Item(r, "clr:30"));
        }

        [Test]
        public static void Clearance_OnlyOneSideEvaluated_IsNotEvaluated_NotDeltaFromZero()
        {
            HostedSnap b = Door(30, 1000); b.ClearanceEvaluated = true; b.ClearanceMm = 1200;
            HostedSnap a = Door(30, 1000);                    // after тооцоогүй
            PreChangeReport r = Run(Snap().WithHosted(b), Snap().WithHosted(a));
            Assert.Null(Item(r, "clr:30"));
            Assert.Eq(TruthState.NotEvaluated, Item(r, "clr:ne").Truth);
        }

        [Test]
        public static void Joined_NeighbourMovesWithWall_IsConfirmedNotice_UnmovedIsIgnored()
        {
            StateSnapshot b = Snap(), a = Snap();
            b.Joined[40] = new ElementPlace { Id = 40, Uid = "j40", Name = "Хөрш хана", Location = new[] { 0.0, 0, 0, 3000, 0, 0 } };
            a.Joined[40] = new ElementPlace { Id = 40, Uid = "j40", Name = "Хөрш хана", Location = new[] { 0.0, 0, 0, 3300, 0, 0 } };
            b.Joined[41] = new ElementPlace { Id = 41, Location = new[] { 0.0, 0, 0, 3000, 0, 0 } };
            a.Joined[41] = new ElementPlace { Id = 41, Location = new[] { 0.1, 0, 0, 3000, 0, 0 } };
            PreChangeReport r = Run(b, a);
            Assert.NotNull(Item(r, "joined:40"));
            Assert.Eq(TruthState.Confirmed, Item(r, "joined:40").Truth);
            Assert.Eq(ItemSeverity.Notice, Item(r, "joined:40").Severity);
            Assert.Null(Item(r, "joined:41"));
        }

        /* ------------------------------ ХҮСНЭГТ ------------------------------ */

        [Test]
        public static void Schedule_MembershipChange_IsConfirmed()
        {
            var deps = Deps();
            deps.Schedules.Add(Sched(50, 20));
            StateSnapshot b = Snap(), a = Snap();
            b.Schedules[50] = SchedSnap(50, true, 1, 2);
            a.Schedules[50] = SchedSnap(50, true, 1, 2, 3);
            PreChangeReport r = Run(b, a, deps);
            PreChangeItem it = Item(r, "sched:50");
            Assert.Eq(TruthState.Confirmed, it.Truth);
            Assert.Eq("2 мөр", it.Before);
            Assert.Eq("3 мөр", it.After);
            Assert.Eq("1 орно", it.Delta);
            Assert.Eq(AttentionLevel.Review, r.Level);
            Assert.True(r.Coverage.SchedulesChecked);
        }

        [Test]
        public static void Schedule_EnterAndLeave_BothCounted()
        {
            var deps = Deps();
            deps.Schedules.Add(Sched(50));
            StateSnapshot b = Snap(), a = Snap();
            b.Schedules[50] = SchedSnap(50, true, 1, 2);
            a.Schedules[50] = SchedSnap(50, true, 2, 3, 4);
            PreChangeReport r = Run(b, a, deps);
            Assert.Eq("2 орно, 1 гарна", Item(r, "sched:50").Delta);
        }

        [Test]
        public static void Schedule_MembershipUnchanged_IsReviewOk_NotConfirmed()
        {
            var deps = Deps();
            deps.Schedules.Add(Sched(50));
            StateSnapshot b = Snap(), a = Snap();
            b.Schedules[50] = SchedSnap(50, true, 1, 2);
            a.Schedules[50] = SchedSnap(50, true, 1, 2);
            PreChangeReport r = Run(b, a, deps);
            PreChangeItem it = Item(r, "sched:50");
            Assert.Eq(TruthState.Review, it.Truth);
            Assert.Eq(ItemSeverity.Ok, it.Severity);
            Assert.Eq(AttentionLevel.Clean, r.Level);
        }

        [Test]
        public static void Schedule_NotEvaluated_IsNotEvaluated_AndAddsIncompleteReason()
        {
            var deps = Deps();
            deps.Schedules.Add(Sched(50));
            StateSnapshot b = Snap(), a = Snap();
            b.Schedules[50] = SchedSnap(50, false);
            a.Schedules[50] = SchedSnap(50, true, 1);
            PreChangeReport r = Run(b, a, deps);
            PreChangeItem it = Item(r, "sched:50");
            Assert.Eq(TruthState.NotEvaluated, it.Truth);
            Assert.True(r.IncompleteReasons.Any(s => s.Contains("хүснэгтийн")));
            Assert.True(r.Level != AttentionLevel.Clean);
            Assert.False(r.Coverage.SchedulesChecked);
        }

        [Test]
        public static void Schedule_MissingSnapshot_IsNotEvaluated()
        {
            var deps = Deps();
            deps.Schedules.Add(Sched(51));
            PreChangeReport r = Run(Snap(), Snap(), deps);
            Assert.Eq(TruthState.NotEvaluated, Item(r, "sched:51").Truth);
            Assert.True(r.Incomplete);
        }

        /* ------------------------------ BLOCKED / REJECTED / NOT RESTORED ------------------------------ */

        private static PreChangeInput BlockedInput(SandboxOutcome o)
        {
            // Before/After-д ЯЛГАА тавьсан ч (өрөө алга болно) blocked үед дельта ТООЦООЛОГДОХГҮЙ.
            PreChangeInput inp = Input(Snap().WithRoom(Room(1, 10)), Snap());
            inp.Outcome = o;
            inp.BlockReasons.Add("Хана түгжигдсэн");
            return inp;
        }

        [Test]
        public static void Blocked_NoDeltasComputed_BlockReasonsPresent_ModelUntouchedNoted()
        {
            foreach (SandboxOutcome o in new[] { SandboxOutcome.Blocked, SandboxOutcome.Rejected })
            {
                PreChangeReport r = PreChangeDiff.Compute(BlockedInput(o));
                Assert.Eq(AttentionLevel.Blocked, r.Level, o.ToString());
                Assert.True(r.IsBlocked);
                Assert.False(r.CanApply);
                Assert.Contains(r.BlockReasons, "Хана түгжигдсэн");
                Assert.Contains(r.Notes, PreChangeText.ModelUntouched);
                Assert.Eq(0, r.Of(PreChangeCategory.Room).Count(), "blocked үед өрөөний дельта гарахгүй");
                Assert.Eq(1, r.Items.Count);
                Assert.Eq("blocked", r.Items[0].Key);
                Assert.Eq(ItemSeverity.Critical, r.Items[0].Severity);
            }
        }

        [Test]
        public static void Blocked_WithoutExplicitReasons_GetsDefaultReason()
        {
            PreChangeInput inp = BlockedInput(SandboxOutcome.Blocked);
            inp.BlockReasons.Clear();
            PreChangeReport r = PreChangeDiff.Compute(inp);
            Assert.True(r.BlockReasons.Count > 0);
        }

        [Test]
        public static void Blocked_RevitFailuresBecomeBlockReasons()
        {
            PreChangeInput inp = BlockedInput(SandboxOutcome.Blocked);
            inp.BlockReasons.Clear();
            inp.Failures.Add(new FailureNote { IsError = true, Text = "Хана давхцана" });
            inp.Failures.Add(new FailureNote { IsError = false, Text = "Жижиг" });
            PreChangeReport r = PreChangeDiff.Compute(inp);
            Assert.Contains(r.BlockReasons, "Revit алдаа: Хана давхцана");
            Assert.Contains(r.BlockReasons, "Revit анхааруулга: Жижиг");
        }

        [Test]
        public static void NotRestored_IsBlocked_AndDoesNotClaimModelUntouched()
        {
            PreChangeReport r = PreChangeDiff.Compute(BlockedInput(SandboxOutcome.NotRestored));
            Assert.Eq(AttentionLevel.Blocked, r.Level);
            Assert.False(r.CanApply);
            Assert.False(r.Notes.Contains(PreChangeText.ModelUntouched), "загвар буцсан эсэх БАТЛАГДААГҮЙ — «өөрчлөгдөөгүй» гэж хэлж болохгүй");
            Assert.True(r.Items[0].Title.Contains("батлагдсангүй"));
        }

        [Test]
        public static void NotRestored_WithoutReasons_DefaultMessageMentionsRestoreFailure()
        {
            PreChangeInput inp = BlockedInput(SandboxOutcome.NotRestored);
            inp.BlockReasons.Clear();
            PreChangeReport r = PreChangeDiff.Compute(inp);
            Assert.True(r.BlockReasons.Any(s => s.Contains("буцаасныг баталгаажуулж чадсангүй")));
        }

        [Test]
        public static void Blocked_PreservesExtraIncompleteReasons()
        {
            PreChangeInput inp = BlockedInput(SandboxOutcome.Blocked);
            inp.ExtraIncompleteReasons.Add("x");
            Assert.Contains(PreChangeDiff.Compute(inp).IncompleteReasons, "x");
        }

        [Test]
        public static void Unknown_Outcome_IsTreatedAsBlocked_NotSimulated()
        {
            PreChangeInput inp = Input();
            inp.Outcome = SandboxOutcome.Unknown;
            PreChangeReport r = PreChangeDiff.Compute(inp);
            Assert.Eq(AttentionLevel.Blocked, r.Level);
            Assert.False(r.CanApply);
        }

        [Test]
        public static void ComputeLevel_NonSimulatedReport_IsBlocked()
        {
            var r = new PreChangeReport { Outcome = SandboxOutcome.Blocked };
            Assert.Eq(AttentionLevel.Blocked, PreChangeDiff.ComputeLevel(r));
        }

        /* ------------------------------ DEDUPE ------------------------------ */

        [Test]
        public static void Report_FingerprintAndSnapshotsAreCarriedForApply()
        {
            PreChangeInput inp = Input();
            inp.Fingerprint = Fp();
            PreChangeReport r = PreChangeDiff.Compute(inp);
            Assert.NotNull(r.Fingerprint);
            Assert.NotNull(r.Before);
            Assert.NotNull(r.After);
            Assert.Eq(new DateTime(2026, 10, 5, 9, 0, 0, DateTimeKind.Utc), r.Utc);
        }
    }
}
