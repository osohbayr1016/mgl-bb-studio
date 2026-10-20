using System;
using System.Collections.Generic;
using System.Linq;
using RevitMcpAddin.ChangeImpact.Core;
using RevitMcpAddin.ClashCheck.Core;
using static RevitMcpAddin.Smart.Tests.DoorFixtures;

namespace RevitMcpAddin.Smart.Tests
{
    /// <summary>
    /// Хаалга зөөхийн ДИФФ + ШИЙДВЭР: ӨМНӨ/ДАРАА settled snapshot, нүх/зам/саад, From/To өрөө, орчны зай → 🟢 🟠 🔴 ⚪.
    /// Шийдвэрийн хөдөлгүүр хана зөөхтэй ИЖИЛ — хаалганд өөр шийдвэр зохиогдоогүй.
    /// </summary>
    public static class DoorDecisionTests
    {
        private static DoorMoveContext C() { return Ctx(1500, 900); }

        /* ============================== 🟢 ================================== */

        [Test]
        public static void CompleteExactResult_WithNoImpact_IsMoveOk_AndSwingNormAndEgressNeverChangeIt()
        {
            PreChangeReport r = Run(C(), 400);
            MoveDecision d = Decide(r);
            Assert.Eq(MoveVerdict.MoveOk, d.Verdict, string.Join("|", d.ReviewReasons.Select(x => x.Text)) + string.Join("|", d.UnknownReasons.Select(x => x.Text)));
            Assert.Eq("ТЕХНИКИЙН ХУВЬД ЗӨӨЖ БОЛНО", d.Title);
            Assert.True(d.CanBeApplied);
            Assert.NotNull(Item(r, ItemCodes.DoorMoved), "хаалга хүссэн байрлалдаа очно гэсэн хэвийн мөр");
            Assert.NotNull(Item(r, ItemCodes.DoorSwingNe), "swing тооцоолоогүй гэдгийг ил хэлнэ");
            Assert.Eq(TruthState.NotEvaluated, Item(r, ItemCodes.DoorSwingNe).Truth);
            Assert.True(d.NormLine.Contains("автомат шалгалт хийгдээгүй"));
        }

        [Test]
        public static void QuickStage_NeverShowsGreen_EvenWithoutAnyImpact()
        {
            PreChangeReport r = Run(C(), 400, stage: AnalysisStage.Quick);
            MoveDecision d = Decide(r);
            Assert.True(d.IsPending);
            Assert.True(d.Verdict != MoveVerdict.MoveOk);
            Assert.False(d.CanBeApplied);
        }

        /* ============================== 🔴 ================================== */

        [Test]
        public static void NewOpeningOverlap_IsDoNotMove_AndNamesBothDoors()
        {
            DoorMoveContext ctx = C();
            ctx.Openings.Add(Opening(121, 3000, 900, label: "D-121"));
            PreChangeReport r = Run(ctx, 1200);
            MoveDecision d = Decide(r);
            Assert.Eq(MoveVerdict.DoNotMove, d.Verdict);
            Assert.Eq(ItemCodes.DoorOpeningOverlap, d.Primary.Code);
            Assert.True(d.Primary.Text.Contains("D-120") && d.Primary.Text.Contains("D-121") && d.Primary.Text.Contains("600 мм"), d.Primary.Text);
            Assert.False(d.CanBeApplied);
        }

        [Test]
        public static void ConfirmedStructuralClash_IsDoNotMove()
        {
            StateSnapshot after = Snap(DoorSnap(2500)).WithPair(DoorPair("host:900", ObstacleKind.Column, ClashVerdict.ConfirmedClash, 900));
            PreChangeReport r = Run(C(), 1000, after: after);
            MoveDecision d = Decide(r);
            Assert.Eq(MoveVerdict.DoNotMove, d.Verdict);
            Assert.Eq(ItemCodes.DoorStructureClash, d.Primary.Code);
            Assert.True(d.Primary.Text.Contains("Column 900"), d.Primary.Text);
        }

        [Test]
        public static void NewMepClash_IsDoNotMove()
        {
            StateSnapshot after = Snap(DoorSnap(2500)).WithPair(DoorPair("host:910", ObstacleKind.Mep, ClashVerdict.ConfirmedClash, 910));
            MoveDecision d = Decide(Run(C(), 1000, after: after));
            Assert.Eq(MoveVerdict.DoNotMove, d.Verdict);
            Assert.Eq(ItemCodes.ClashNew, d.Primary.Code);
        }

        [Test]
        public static void ExactOverlapWithAnotherDoorsGeometry_IsCriticalToo_AndNotDuplicatedWithTheIntervalFinding()
        {
            DoorMoveContext ctx = C();
            ctx.Openings.Add(Opening(121, 3000, 900));
            StateSnapshot after = Snap(DoorSnap(2700)).WithPair(DoorPair("host:121", ObstacleKind.Door, ClashVerdict.ConfirmedClash, 121));
            PreChangeReport r = Run(ctx, 1200, after: after);
            Assert.Eq(1, r.Items.Count(i => i.Code == ItemCodes.DoorOpeningOverlap), "нэг нүхний давхцал нэг л мөр");
            Assert.Eq(MoveVerdict.DoNotMove, Decide(r).Verdict);
        }

        [Test]
        public static void HostLost_IsDoNotMove()
        {
            StateSnapshot after = Snap(DoorSnap(2500, hostId: 77));
            MoveDecision d = Decide(Run(C(), 1000, after: after));
            Assert.Eq(MoveVerdict.DoNotMove, d.Verdict);
            Assert.Eq(ItemCodes.HostLost, d.Primary.Code);
            Assert.True(d.Primary.Text.Contains("ханаасаа сална"), d.Primary.Text);
        }

        [Test]
        public static void DoorDeleted_IsDoNotMove_WithATypedReason()
        {
            StateSnapshot after = Snap(DoorSnap(2500, exists: false));
            MoveDecision d = Decide(Run(C(), 1000, after: after));
            Assert.Eq(MoveVerdict.DoNotMove, d.Verdict);
            Assert.Eq(ItemCodes.DoorLost, d.Primary.Code);
            Assert.True(d.Primary.Text.Contains("Хаалга өөрөө"), d.Primary.Text);
            StateSnapshot gone = Snap(null);
            gone.SourceDeleted = true;
            Assert.Eq(MoveVerdict.DoNotMove, Decide(Run(C(), 1000, after: gone)).Verdict);
        }

        [Test]
        public static void RevitRefusingTheMove_IsDoNotMove_AndAnUnsupportedDoorIsUnknown()
        {
            PreChangeInput refused = Input(C(), 400);
            refused.Outcome = SandboxOutcome.Blocked;
            refused.BlockReasons.Add("Revit энэ хөдөлгөөнийг зөвшөөрөөгүй (InvalidOperationException).");
            Assert.Eq(MoveVerdict.DoNotMove, Decide(PreChangeDiff.Compute(refused)).Verdict);

            PreChangeInput unsupported = Input(C(), 400);
            unsupported.Outcome = SandboxOutcome.Rejected;
            unsupported.Rejection = RejectionKind.Unsupported;
            unsupported.BlockReasons.Add("Энэ хаалга Group дотор байгаа тул дэмжигдээгүй.");
            MoveDecision u = Decide(PreChangeDiff.Compute(unsupported));
            Assert.Eq(MoveVerdict.Unknown, u.Verdict);
            Assert.True(u.Primary.Text.Contains("Group"), u.Primary.Text);
        }

        [Test]
        public static void SandboxCannotRestore_IsUnknown_AndTheModelMayBeModified()
        {
            PreChangeInput i = Input(C(), 400);
            i.Outcome = SandboxOutcome.NotRestored;
            i.BlockReasons.Add("Загвар буцаагдсан эсэх батлагдсангүй.");
            MoveDecision d = Decide(PreChangeDiff.Compute(i));
            Assert.Eq(MoveVerdict.Unknown, d.Verdict);
            Assert.True(d.ModelMayBeModified);
        }

        /* ============================== 🟠 ================================== */

        [Test]
        public static void RoomFromToChange_IsMoveWithReview_AndNamesTheRooms()
        {
            StateSnapshot after = Snap(DoorSnap(4200, from: 1, to: 3, toName: "Meeting Room"));
            PreChangeReport r = Run(C(), 2700, after: after);
            MoveDecision d = Decide(r);
            Assert.Eq(MoveVerdict.MoveWithReview, d.Verdict);
            Assert.NotNull(Item(r, ItemCodes.DoorRoomsChanged));
            PreChangeItem rc = Item(r, ItemCodes.DoorRoomsChanged);
            Assert.True(rc.Before.Contains("Оффис 203") && rc.After.Contains("Meeting Room"), rc.Before + " → " + rc.After);
            Assert.True(d.ReviewReasons.Any(x => x.Code == ItemCodes.DoorRoomsChanged && x.Text.Contains("From/To")));
            Assert.Eq(2, r.Items.Count(i => i.Code == ItemCodes.DoorRoomAffected), "хоёр өрөө (Оффис 203 алдагдана, Meeting Room нэмэгдэнэ)");
            Assert.True(d.CanBeApplied);
        }

        [Test]
        public static void OnlyDimensionChanges_IsMoveWithReview()
        {
            PreChangeDependencies deps = PreChangeFixtures.Deps();
            deps.DimensionIds.Add(938);
            StateSnapshot b = Snap(DoorSnap(1500)); b.Dimensions[938] = new DimSnap { Id = 938, Name = "Linear", SegmentsMm = new List<double> { 1500 }, Readable = true };
            StateSnapshot a = Snap(DoorSnap(1900)); a.Dimensions[938] = new DimSnap { Id = 938, Name = "Linear", SegmentsMm = new List<double> { 1900 }, Readable = true };
            PreChangeReport r = Run(C(), 400, b, a, deps: deps);
            MoveDecision d = Decide(r);
            Assert.Eq(MoveVerdict.MoveWithReview, d.Verdict);
            Assert.True(r.Items.Any(i => i.Code == ItemCodes.DimChanged && i.Why.Contains("хаалгыг")), "хэмжээсийн тайлбар хаалгыг нэрлэнэ (хана биш)");
            Assert.Eq(1, DoorMoveView.Build(ControllerWith(r, 400), FreshnessState.Fresh).Docs.Dimensions);
        }

        [Test]
        public static void FurnitureConfirmedByGeometry_IsReview_NotCritical()
        {
            StateSnapshot after = Snap(DoorSnap(2500)).WithPair(DoorPair("host:44", ObstacleKind.Furniture, ClashVerdict.ConfirmedClash, 44));
            PreChangeReport r = Run(C(), 1000, after: after);
            MoveDecision d = Decide(r);
            Assert.Eq(MoveVerdict.MoveWithReview, d.Verdict);
            Assert.Eq(ItemCodes.DoorFurnitureClash, d.ReviewReasons.First().Code);
            Assert.Eq(0, d.Blocking.Count);
        }

        [Test]
        public static void BoundingBoxCandidate_ThatGeometryClears_BecomesAChecked_NotAReview()
        {
            DoorMoveContext ctx = C();
            ctx.Obstacles.Add(Box(44, ObstacleKind.Furniture, 2400, 2800, -150, 150, 0, 900, "Cabinet F44"));
            StateSnapshot after = Snap(DoorSnap(2500)).WithPair(DoorPair("host:44", ObstacleKind.Furniture, ClashVerdict.NoClash, 44));
            StateSnapshot before = Snap(DoorSnap(1500)).WithPair(DoorPair("host:44", ObstacleKind.Furniture, ClashVerdict.NoClash, 44));
            PreChangeReport r = Run(ctx, 1000, before, after);
            Assert.Null(Item(r, ItemCodes.DoorObstacleCandidate), "геометрээр огтлолцохгүй нь батлагдсан");
            Assert.NotNull(Item(r, ItemCodes.DoorNearbyClear));
            Assert.Eq(MoveVerdict.MoveOk, Decide(r).Verdict);
        }

        [Test]
        public static void BoundingBoxCandidate_ThatGeometryCouldNotCheck_StaysReview()
        {
            DoorMoveContext ctx = C();
            ctx.Obstacles.Add(Box(44, ObstacleKind.Furniture, 2400, 2800, -150, 150, 0, 900, "Cabinet F44"));
            PreChangeReport r = Run(ctx, 1000);       // clash snapshot-д хос алга (хугацаа/уншигдаагүй)
            Assert.NotNull(Item(r, ItemCodes.DoorObstacleCandidate));
            Assert.Eq(MoveVerdict.MoveWithReview, Decide(r).Verdict);
        }

        [Test]
        public static void QuickStage_ReportsBoundingBoxCandidatesAsReview_NotAsClashes()
        {
            DoorMoveContext ctx = C();
            ctx.Obstacles.Add(Box(900, ObstacleKind.Column, 2400, 2800, -200, 200, 0, 3000, "Column C12"));
            PreChangeReport r = Run(ctx, 1000, stage: AnalysisStage.Quick);
            PreChangeItem cand = Item(r, ItemCodes.DoorObstacleCandidate);
            Assert.NotNull(cand);
            Assert.Eq(TruthState.Review, cand.Truth);
            Assert.Null(Item(r, ItemCodes.DoorStructureClash));
            Assert.False(Decide(r).CanBeApplied);
        }

        [Test]
        public static void CandidateOnThePathButCleanAtTheFinalPosition_DoesNotChangeTheVerdict()
        {
            DoorMoveContext ctx = C();
            ctx.Obstacles.Add(Box(901, ObstacleKind.Furniture, 3000, 3300, -150, 150, 0, 900, "Cabinet F44"));
            PreChangeReport r = Run(ctx, 3000);
            Assert.NotNull(Item(r, ItemCodes.DoorPathCandidate));
            Assert.Eq(MoveVerdict.MoveOk, Decide(r).Verdict, "зам дээрх нэр дэвшигч ганцаараа 🟠 болгохгүй");
        }

        [Test]
        public static void RevitMovingTheDoorByADifferentAmount_IsReview_AndReportsBoth()
        {
            StateSnapshot after = Snap(DoorSnap(1500 + 380));      // 400 хүссэн, Revit 380 зөөнө
            PreChangeReport r = Run(C(), 400, after: after);
            PreChangeItem dev = Item(r, ItemCodes.DoorDeviated);
            Assert.NotNull(dev);
            Assert.True(dev.Before.Contains("400") && dev.After.Contains("380"), dev.Before + " / " + dev.After);
            Assert.Eq(MoveVerdict.MoveWithReview, Decide(r).Verdict);
        }

        [Test]
        public static void DoorFlip_IsPreservedWhenUnchanged_AndAReviewWhenItChanges()
        {
            Assert.Null(Item(Run(C(), 400), ItemCodes.DoorFlip));
            StateSnapshot b = Snap(DoorSnap(1500, facing: false));
            StateSnapshot a = Snap(DoorSnap(1900, facing: true));
            PreChangeReport r = Run(C(), 400, b, a);
            Assert.NotNull(Item(r, ItemCodes.DoorFlip));
            Assert.Eq(MoveVerdict.MoveWithReview, Decide(r).Verdict);
            // уншигдаагүй flip «өөрчлөгдөөгүй» гэж тооцогдохгүй — advisory дутагдал (🟠, ногоон биш)
            PreChangeReport unk = Run(C(), 400, Snap(DoorSnap(1500, flipKnown: false)), Snap(DoorSnap(1900, flipKnown: false)));
            Assert.Eq(MoveVerdict.MoveWithReview, Decide(unk).Verdict);
        }

        [Test]
        public static void AdjacentWallEndProximity_IsReview()
        {
            PreChangeReport r = Run(C(), 4050);          // нүх ханын төгсгөлтэй шүргэнэ
            Assert.NotNull(Item(r, ItemCodes.DoorWallEnd));
            Assert.Eq(MoveVerdict.MoveWithReview, Decide(r).Verdict);
        }

        [Test]
        public static void ClearanceReduction_IsReportedWithBeforeAfterDelta_AndNotANormCheck()
        {
            StateSnapshot b = Snap(DoorSnap(1500)); b.Hosted[DoorId].ClearanceMm = 1100; b.Hosted[DoorId].ClearanceEvaluated = true;
            StateSnapshot a = Snap(DoorSnap(1900)); a.Hosted[DoorId].ClearanceMm = 720; a.Hosted[DoorId].ClearanceEvaluated = true;
            PreChangeReport r = Run(C(), 400, b, a);
            PreChangeItem it = Item(r, ItemCodes.ClearanceChanged);
            Assert.NotNull(it);
            Assert.Eq("1100 мм", it.Before);
            Assert.Eq("720 мм", it.After);
            Assert.True(it.Delta.Contains("380"), it.Delta);
            Assert.True(it.Why.Contains("нормын шалгалт БИШ"), it.Why);
            Assert.Eq(MoveVerdict.MoveWithReview, Decide(r).Verdict);
            DoorClearanceView cv = DoorMoveView.Build(ControllerWith(r, 400), FreshnessState.Fresh).Clearance;
            Assert.True(cv.Evaluated && cv.Note.Contains("Нормын шалгалт биш"));
        }

        [Test]
        public static void UnreadableClearance_IsNotEvaluated_NeverZero()
        {
            StateSnapshot b = Snap(DoorSnap(1500)); b.Hosted[DoorId].ClearanceNote = "3D харагдац олдсонгүй.";
            StateSnapshot a = Snap(DoorSnap(1900));
            PreChangeReport r = Run(C(), 400, b, a);
            PreChangeItem ne = Item(r, ItemCodes.ClearanceNe);
            Assert.NotNull(ne);
            Assert.Eq(TruthState.NotEvaluated, ne.Truth);
            Assert.Eq(MoveVerdict.MoveOk, Decide(r).Verdict, "тооцоолоогүй нь шийдвэрийг өөрчлөхгүй");
        }

        /* ============================== ⚪ ================================== */

        [Test]
        public static void IncompleteGeometryScan_IsUnknown_NeverGreen()
        {
            StateSnapshot after = Snap(DoorSnap(1900));
            after.Clash.Complete = false;
            after.Clash.IncompleteReasons.Add("2 линк unload хийгдсэн.");
            MoveDecision d = Decide(Run(C(), 400, after: after));
            Assert.Eq(MoveVerdict.Unknown, d.Verdict);
            Assert.True(d.UnknownReasons.Any(x => x.Text.Contains("unload")));
        }

        [Test]
        public static void MissingDoorContext_IsUnknown()
        {
            PreChangeInput i = Input(C(), 400);
            i.Door = null;
            Assert.Eq(MoveVerdict.Unknown, Decide(PreChangeDiff.Compute(i)).Verdict);
        }

        [Test]
        public static void DoorThatCouldNotBeReadAfterTheMove_IsUnknown()
        {
            StateSnapshot after = Snap(null);          // хаалга settled төлөвт уншигдсангүй (устсан биш)
            MoveDecision d = Decide(Run(C(), 400, after: after));
            Assert.Eq(MoveVerdict.Unknown, d.Verdict);
        }

        [Test]
        public static void UnknownWidth_CannotProveAnOverlap_SoItIsAdvisoryAndNeverGreenByAccident()
        {
            DoorMoveContext ctx = Ctx(1500, 900, WidthSource.Unknown);
            PreChangeReport r = Run(ctx, 400);
            Assert.True(r.AdvisoryIncomplete.Any(x => x.Contains("өргөн")), string.Join("|", r.AdvisoryIncomplete));
            Assert.Eq(MoveVerdict.MoveWithReview, Decide(r).Verdict);
        }

        /* ============================== ХУВААЛЦСАН ХЭСЭГ ==================== */

        [Test]
        public static void DocumentationImpact_IsCounted_ViewsSheetsAndSchedules()
        {
            PreChangeDependencies deps = PreChangeFixtures.Deps();
            deps.Views.Add(new DepNode { Id = 11, Name = "Level 12 Plan", Kind = ImpactNodeKind.View, ViewType = "FloorPlan", Confidence = ImpactConfidence.A, SheetIds = new List<long> { 21 } });
            deps.Views.Add(new DepNode { Id = 12, Name = "Section 1", Kind = ImpactNodeKind.View, ViewType = "Section", Confidence = ImpactConfidence.A, SheetIds = new List<long> { 22 } });
            deps.Sheets.Add(new DepNode { Id = 21, Name = "Plans", SheetNumber = "A-203", Kind = ImpactNodeKind.Sheet, Confidence = ImpactConfidence.A });
            deps.Sheets.Add(new DepNode { Id = 22, Name = "Sections", SheetNumber = "A-301", Kind = ImpactNodeKind.Sheet, Confidence = ImpactConfidence.A });
            PreChangeReport r = Run(C(), 400, deps: deps);
            DoorMoveView v = DoorMoveView.Build(ControllerWith(r, 400), FreshnessState.Fresh);
            Assert.Eq(2, v.Docs.Sheets);
            Assert.True(v.Docs.Line.Contains("1 план") && v.Docs.Line.Contains("1 зүсэлт") && v.Docs.Line.Contains("2 хуудас"), v.Docs.Line);
            Assert.Eq(MoveVerdict.MoveWithReview, Decide(r).Verdict);
        }

        [Test]
        public static void StaleMessages_NameTheDoor_NotTheWall()
        {
            var preview = new PreChangeFingerprint { DocumentId = "d", SourceUid = "door-uid", SourceId = DoorId, Location = new[] { 1500.0, 0, 0 }, TypeId = 5, VectorMm = Req(400).VectorMm, ModelStamp = "s1", DependencyHash = "h" };
            var now = new PreChangeFingerprint { DocumentId = "d", SourceUid = "door-uid", SourceId = DoorId, Location = new[] { 1600.0, 0, 0 }, TypeId = 5, VectorMm = Req(400).VectorMm, ModelStamp = "s1", DependencyHash = "h", SourceExists = true };
            StaleVerdict v = PreChangeStale.Evaluate(preview, now, Req(400));
            Assert.True(v.IsStale);
            Assert.True(v.Message.Contains("Хаалга preview хийснээс хойш хөдөлсөн"), v.Message);
            now.SourceExists = false;
            Assert.True(PreChangeStale.Evaluate(preview, now, Req(400)).Message.Contains("Хаалга устсан"));
            // хана зөөхийн хуучин мессеж хэвээр
            now.SourceExists = true; now.Location = new[] { 1600.0, 0, 0 };
            Assert.True(PreChangeStale.Evaluate(preview, now, new PreChangeRequest { SourceId = DoorId, DistanceMm = 400, DirX = 1 }).Message.Contains("Хана preview хийснээс хойш хөдөлсөн"));
        }

        [Test]
        public static void PostCommitGate_ComparesTheDoorPosition_Host_AndFromToRooms()
        {
            PreChangeRequest req = Req(400);
            StateSnapshot preview = Snap(DoorSnap(1900));
            Assert.Eq(PostCommitAction.Assimilate, PreChangePostCommitGate.Decide(req, preview, Snap(DoorSnap(1900)), true).Action);
            Assert.Eq(PostCommitAction.RollBack, PreChangePostCommitGate.Decide(req, preview, Snap(DoorSnap(1850)), true).Action);
            PostCommitVerdict hostChanged = PreChangePostCommitGate.Decide(req, preview, Snap(DoorSnap(1900, hostId: 77)), true);
            Assert.Eq(PostCommitAction.RollBack, hostChanged.Action);
            Assert.True(hostChanged.Details.Any(x => x.Contains("хост")), string.Join("|", hostChanged.Details));
            PostCommitVerdict rooms = PreChangePostCommitGate.Decide(req, preview, Snap(DoorSnap(1900, to: 9)), true);
            Assert.Eq(PostCommitAction.RollBack, rooms.Action);
            Assert.True(PreChangePostCommitGate.Decide(req, preview, Snap(DoorSnap(1900)), true).Compared.Contains("хаалганы байрлал"));
        }

        [Test]
        public static void TextAfterApply_SaysDoor_AndKeepsTheWallWording()
        {
            Assert.True(PreChangeText.AppliedVerified(Req(620), null).Contains("Хаалга 620 мм зөөгдлөө"));
            Assert.True(PreChangeText.AppliedVerified(new PreChangeRequest { SourceId = 1, DistanceMm = 300, DirX = 1 }, null).Contains("Хана 300 мм зөөгдлөө"));
            Assert.True(PreChangeOperations.UndoName(PreChangeOperationKind.DoorMove) == "MGL — Хаалга зөөх");
        }

        /* ---- helper ---- */

        private static DoorSimulationController ControllerWith(PreChangeReport r, double offset)
        {
            var host = new FakeHost();
            DoorSimulationController c = Controller(host);
            c.SetTarget(offset);
            PassDebounce(host, c);
            c.OnExactFinished(c.Generation, r);
            return c;
        }
    }
}
