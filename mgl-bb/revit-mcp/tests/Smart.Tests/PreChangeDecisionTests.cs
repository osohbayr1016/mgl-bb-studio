using System;
using System.Collections.Generic;
using System.Linq;
using RevitMcpAddin.ChangeImpact.Core;
using RevitMcpAddin.ClashCheck.Core;
using static RevitMcpAddin.Smart.Tests.PreChangeFixtures;

namespace RevitMcpAddin.Smart.Tests
{
    /// <summary>
    /// Шийдвэрийн хөдөлгүүр (🟢 🟠 🔴 ⚪) — «Энэ зөөлтийг хийх үү?».  Мөр бүр ТОДОРХОЙ шалтгаантай, ижил тайлан → ижил шийдвэр.
    /// Ногоон нь Монгол нормын зөвшөөрөл БИШ; «норм шалгаагүй» нь техникийн шийдвэрийг өөрчлөхгүй.
    /// </summary>
    public static class PreChangeDecisionTests
    {
        private static MoveDecision Decide(PreChangeReport r) { return PreChangeDecisionEngine.Decide(r); }

        private static PreChangeReport Blocked(SandboxOutcome o, RejectionKind kind = RejectionKind.None, string reason = "Тайлбар")
        {
            var inp = Input();
            inp.Outcome = o; inp.Rejection = kind; inp.BlockReasons.Add(reason);
            return PreChangeDiff.Compute(inp);
        }

        /* ============================== 🔴 ЗӨӨХГҮЙ =========================== */

        [Test]
        public static void NewConfirmedClash_IsDoNotMove_WithExplicitReason()
        {
            StateSnapshot a = Snap().WithPair(Pair("D-03", ClashVerdict.ConfirmedClash));
            MoveDecision d = Decide(Run(after: a));
            Assert.Eq(MoveVerdict.DoNotMove, d.Verdict);
            Assert.Eq("🔴", d.Mark);
            Assert.Eq("ЗӨӨХГҮЙ", d.Title);
            Assert.True(d.Primary.Text.Contains("Дукт D-03") && d.Primary.Text.Contains("шинэ clash"), d.Primary.Text);
            Assert.Eq(ItemCodes.ClashNew, d.Primary.Code);
            Assert.True(d.Subtitle.Contains("шинэ clash"), d.Subtitle);
            Assert.False(d.CanBeApplied);
        }

        [Test]
        public static void TwoNewClashes_AreOneAggregatedReason()
        {
            StateSnapshot a = Snap().WithPair(Pair("D-03", ClashVerdict.ConfirmedClash)).WithPair(Pair("P-07", ClashVerdict.ConfirmedClash));
            MoveDecision d = Decide(Run(after: a));
            Assert.Eq(MoveVerdict.DoNotMove, d.Verdict);
            Assert.Eq(1, d.Blocking.Count(x => x.Code == ItemCodes.ClashNew));
            Assert.True(d.Primary.Text.StartsWith("2 шинэ MEP clash"), d.Primary.Text);
        }

        [Test]
        public static void PreExistingClash_IsNotABlock()
        {
            StateSnapshot b = Snap().WithPair(Pair("D-03", ClashVerdict.ConfirmedClash));
            StateSnapshot a = Snap().WithPair(Pair("D-03", ClashVerdict.ConfirmedClash));
            Assert.Eq(MoveVerdict.MoveOk, Decide(Run(b, a)).Verdict);
        }

        [Test]
        public static void RoomBecomesUnenclosed_IsDoNotMove()
        {
            StateSnapshot b = Snap().WithRoom(Room(1, 24.8));
            RoomSnap open = Room(1, 0); open.Enclosed = false;
            StateSnapshot a = Snap().WithRoom(open);
            MoveDecision d = Decide(Run(b, a));
            Assert.Eq(MoveVerdict.DoNotMove, d.Verdict);
            Assert.Eq(ItemCodes.RoomUnenclosed, d.Primary.Code);
            Assert.True(d.Primary.Text.Contains("хаалттай орон зай"), d.Primary.Text);
        }

        [Test]
        public static void RoomRemoved_IsDoNotMove()
        {
            Assert.Eq(MoveVerdict.DoNotMove, Decide(Run(Snap().WithRoom(Room(1, 24.8)), Snap())).Verdict);
        }

        [Test]
        public static void ConfiguredEgress_Lost_IsDoNotMove()
        {
            StateSnapshot b = Snap().WithEgress(Route(1, 12.0));
            StateSnapshot a = Snap().WithEgress(Route(1, null));
            MoveDecision d = Decide(Run(b, a));
            Assert.Eq(MoveVerdict.DoNotMove, d.Verdict);
            Assert.Eq(ItemCodes.EgressLost, d.Primary.Code);
            Assert.True(d.Primary.Text.Contains("гарц руу зам тасарна"), d.Primary.Text);
        }

        [Test]
        public static void HostedDoorDeleted_IsDoNotMove()
        {
            StateSnapshot b = Snap().WithHosted(Door(30, 1300));
            HostedSnap gone = Door(30, 1300); gone.Exists = false;
            StateSnapshot a = Snap().WithHosted(gone);
            MoveDecision d = Decide(Run(b, a));
            Assert.Eq(MoveVerdict.DoNotMove, d.Verdict);
            Assert.Eq(ItemCodes.HostDeleted, d.Primary.Code);
        }

        [Test]
        public static void HostedDoorLosesItsHost_IsDoNotMove()
        {
            HostedSnap bd = Door(30, 1300); bd.HostId = 100; bd.HostKnown = true;
            HostedSnap ad = Door(30, 1600); ad.HostId = 555; ad.HostKnown = true;
            MoveDecision d = Decide(Run(Snap().WithHosted(bd), Snap().WithHosted(ad), req: Req()));
            Assert.Eq(MoveVerdict.DoNotMove, d.Verdict);
            Assert.Eq(ItemCodes.HostLost, d.Primary.Code);
            Assert.True(d.Primary.Text.Contains("хостоо алдана"), d.Primary.Text);
        }

        [Test]
        public static void HostNotReadable_IsNeverClaimedAsLost()
        {
            HostedSnap bd = Door(30, 1300); bd.HostKnown = false;
            HostedSnap ad = Door(30, 1600); ad.HostKnown = false;
            Assert.False(Decide(Run(Snap().WithHosted(bd), Snap().WithHosted(ad))).Blocking.Any(x => x.Code == ItemCodes.HostLost));
        }

        [Test]
        public static void SourceWallDisappears_IsDoNotMove()
        {
            StateSnapshot a = Snap(); a.SourceDeleted = true;
            MoveDecision d = Decide(Run(after: a));
            Assert.Eq(MoveVerdict.DoNotMove, d.Verdict);
            Assert.Eq(ItemCodes.SourceMissing, d.Primary.Code);
        }

        [Test]
        public static void RevitRefusedMove_IsDoNotMove()
        {
            MoveDecision d = Decide(Blocked(SandboxOutcome.Blocked, reason: "Хязгаарлалт зөрчигдөнө"));
            Assert.Eq(MoveVerdict.DoNotMove, d.Verdict);
            Assert.Eq("move.refused", d.Primary.Code);
            Assert.True(d.Primary.Text.Contains("Хязгаарлалт"));
            Assert.False(d.ModelMayBeModified);
        }

        [Test]
        public static void PinnedOrForeignOwnedWall_RejectedAsRefused_IsDoNotMove()
        {
            MoveDecision d = Decide(Blocked(SandboxOutcome.Rejected, RejectionKind.Refused, "Хана түгжигдсэн (Pin) байна."));
            Assert.Eq(MoveVerdict.DoNotMove, d.Verdict);
        }

        [Test]
        public static void AnyOtherConfirmedCritical_IsDoNotMove()
        {
            StateSnapshot a = Snap(); a.DeletedIds = new List<long> { 5, 6 };
            MoveDecision d = Decide(Run(after: a));
            Assert.Eq(MoveVerdict.DoNotMove, d.Verdict);
            Assert.Eq(ItemCodes.ModelDeleted, d.Primary.Code);
        }

        /* ============================== ⚪ ДҮГНЭХ БОЛОМЖГҮЙ =================== */

        [Test]
        public static void RollbackCannotBeProven_IsUnknown_NeverApplyable_WithAlert()
        {
            MoveDecision d = Decide(Blocked(SandboxOutcome.NotRestored, reason: "Хананы байрлал анхныхаасаа өөр байна."));
            Assert.Eq(MoveVerdict.Unknown, d.Verdict);
            Assert.True(d.ModelMayBeModified, "загвар өөрчлөгдсөн байж болзошгүй — хэрэглэгчид ИЛ хэлнэ");
            Assert.Eq("restore.unknown", d.Primary.Code);
            Assert.False(d.CanBeApplied);
        }

        [Test]
        public static void UnsupportedWall_IsUnknown_NotDoNotMove()
        {
            MoveDecision d = Decide(Blocked(SandboxOutcome.Rejected, RejectionKind.Unsupported, "Нумант хана MVP-д дэмжигдээгүй."));
            Assert.Eq(MoveVerdict.Unknown, d.Verdict);
            Assert.Eq("check.unsupported", d.Primary.Code);
        }

        [Test]
        public static void ToolFault_IsUnknown_NotARevitRefusal()
        {
            Assert.Eq(MoveVerdict.Unknown, Decide(Blocked(SandboxOutcome.Faulted, reason: "Simulation алдаатай")).Verdict);
        }

        [Test]
        public static void MepLinkUnloaded_IsUnknown_NotGreen()
        {
            StateSnapshot b = Snap(); b.Clash.Complete = false; b.Clash.IncompleteReasons.Add("1 линк unload хийгдсэн — тэдгээрийн MEP-г шалгаагүй.");
            StateSnapshot a = Snap(); a.Clash.Complete = false; a.Clash.IncompleteReasons.Add("1 линк unload хийгдсэн — тэдгээрийн MEP-г шалгаагүй.");
            MoveDecision d = Decide(Run(b, a));
            Assert.Eq(MoveVerdict.Unknown, d.Verdict);
            Assert.True(d.Primary.Text.Contains("линк"), d.Primary.Text);
            Assert.Eq(CheckState.Incomplete, d.Chip("mep").State);
        }

        [Test]
        public static void MepNotEvaluatedAtAll_IsUnknown()
        {
            StateSnapshot b = Snap(); b.Clash = new ClashSnap { Evaluated = false, NotEvaluatedReason = "Хананы bounding box уншигдсангүй." };
            StateSnapshot a = Snap(); a.Clash = new ClashSnap { Evaluated = false, NotEvaluatedReason = "Хананы bounding box уншигдсангүй." };
            Assert.Eq(MoveVerdict.Unknown, Decide(Run(b, a)).Verdict);
        }

        [Test]
        public static void ClosedWorksetOrGeometryFailure_IsUnknown()
        {
            StateSnapshot a = Snap().WithPair(Pair("D-9", ClashVerdict.GeometryError));
            Assert.Eq(MoveVerdict.Unknown, Decide(Run(after: a)).Verdict);
        }

        [Test]
        public static void DependencyGraphTruncated_IsUnknown()
        {
            PreChangeDependencies deps = Deps();
            deps.IncompleteReasons.Add("Граф хязгаарт хүрч зарим холбоо орхигдсон.");
            Assert.Eq(MoveVerdict.Unknown, Decide(Run(deps: deps)).Verdict);
        }

        [Test]
        public static void ConfiguredEgress_CalculationFails_IsUnknown()
        {
            StateSnapshot b = Snap().WithEgress(Route(1, 12.0));
            StateSnapshot a = Snap().WithEgress(Route(1, 12.0));
            a.Egress.Evaluated = false; a.Egress.NotEvaluatedReason = "Path of Travel сервис хариулсангүй.";
            MoveDecision d = Decide(Run(b, a));
            Assert.Eq(MoveVerdict.Unknown, d.Verdict, "гарц ТОХИРУУЛСАН хэрнээ тооцоо унавал техникийн шалгалт дутуу");
            Assert.Eq(CheckState.Incomplete, d.Chip("egress").State);
        }

        [Test]
        public static void RoomUnreadable_IsUnknown_NotGreen()
        {
            RoomSnap bad = Room(1, 24.8); bad.Readable = false;
            Assert.Eq(MoveVerdict.Unknown, Decide(Run(Snap().WithRoom(bad), Snap().WithRoom(bad))).Verdict);
        }

        [Test]
        public static void ConfirmedBlock_BeatsIncompleteness()
        {
            StateSnapshot a = Snap().WithPair(Pair("D-03", ClashVerdict.ConfirmedClash));
            a.Clash.IncompleteReasons.Add("1 линк unload хийгдсэн."); a.Clash.Complete = false;
            Assert.Eq(MoveVerdict.DoNotMove, Decide(Run(after: a)).Verdict);
        }

        /* ============================== 🟢 / 🟠 ============================== */

        [Test]
        public static void AllCoreChecksComplete_NoConsequences_IsMoveOk()
        {
            MoveDecision d = Decide(Run());
            Assert.Eq(MoveVerdict.MoveOk, d.Verdict);
            Assert.Eq("🟢", d.Mark);
            Assert.Eq("ТЕХНИКИЙН ХУВЬД ЗӨӨЖ БОЛНО", d.Title);
            Assert.True(d.CanBeApplied);
            Assert.True(d.Subtitle.Contains("Техникийн хувьд зөөж болно"), d.Subtitle);
            Assert.False(d.Title.ToLowerInvariant().Contains("норм"), "ногоон нь нормын зөвшөөрөл мэт харагдах ёсгүй");
            Assert.False(d.Subtitle.ToLowerInvariant().Contains("нийцсэн"));
        }

        [Test]
        public static void NormNotEvaluated_Alone_DoesNotTurnTechnicalOkIntoUnknown()
        {
            PreChangeReport r = Run();
            Assert.True(r.Items.Any(i => i.Code == ItemCodes.NormNe && i.Truth == TruthState.NotEvaluated), "норм ТООЦООЛООГҮЙ гэж үргэлж харагдана");
            MoveDecision d = Decide(r);
            Assert.Eq(MoveVerdict.MoveOk, d.Verdict);
            Assert.Eq("Монгол норм: — автомат шалгалт хийгдээгүй", d.NormLine);
            Assert.True(d.ModelLine.Contains("✓ шалгасан"));
            CheckChip norm = d.Chip("norm");
            Assert.True(norm.Separate, "норм нь загварын шалгалтаас ТУСДАА хэв маягтай");
            Assert.Eq(CheckState.NotChecked, norm.State);
        }

        [Test]
        public static void EgressNeverConfigured_DoesNotMakeVerdictUnknown_ButShowsSeparately()
        {
            MoveDecision d = Decide(Run());
            Assert.Eq(MoveVerdict.MoveOk, d.Verdict);
            CheckChip e = d.Chip("egress");
            Assert.Eq(CheckState.NotConfigured, e.State);
            Assert.Eq("Гарц — тохируулаагүй", e.Text);
        }

        [Test]
        public static void RoomAreaAndDimensionsChange_NoCritical_IsMoveWithReview()
        {
            StateSnapshot b = Snap().WithRoom(Room(1, 24.8, true)).WithRoom(Room(2, 18.1, true, "101", "Коридор")).WithDim(Dim(10, 4200)).WithDim(Dim(11, 3000));
            StateSnapshot a = Snap().WithRoom(Room(1, 22.9)).WithRoom(Room(2, 20.0, false, "101", "Коридор")).WithDim(Dim(10, 3900)).WithDim(Dim(11, 2700));
            PreChangeDependencies deps = Deps(); deps.DimensionIds.AddRange(new long[] { 10, 11 });
            MoveDecision d = Decide(Run(b, a, deps));
            Assert.Eq(MoveVerdict.MoveWithReview, d.Verdict);
            Assert.Eq("🟠", d.Mark);
            Assert.Eq("ХЯНААД ЗӨӨ", d.Title);
            Assert.True(d.CanBeApplied);
            Assert.True(d.Primary.Code == ItemCodes.RoomArea, "өрөө хамгийн түрүүнд");
            Assert.True(d.Top.Any(x => x.Code == ItemCodes.DimChanged && x.Text.StartsWith("2 хэмжээс")), "хэмжээс нэгтгэгдсэн");
            Assert.True(d.Subtitle.StartsWith("Хөдөлгөөн боломжтой"), d.Subtitle);
        }

        [Test]
        public static void ViewsAndSheetsOnly_IsMoveWithReview()
        {
            PreChangeDependencies deps = Deps();
            deps.Views.Add(View(20, "FloorPlan", 30));
            deps.Sheets.Add(Sheet(30, "A-102"));
            MoveDecision d = Decide(Run(deps: deps));
            Assert.Eq(MoveVerdict.MoveWithReview, d.Verdict);
            Assert.True(d.ReviewReasons.Any(x => x.Text.Contains("A-102") && x.Text.Contains("хуудас")), string.Join("|", d.ReviewReasons.Select(x => x.Text)));
        }

        [Test]
        public static void HostedMovingNormallyWithWall_IsAReviewReason()
        {
            StateSnapshot b = Snap().WithHosted(Door(30, 1300));
            StateSnapshot a = Snap().WithHosted(Door(30, 1600));
            MoveDecision d = Decide(Run(b, a));
            Assert.Eq(MoveVerdict.MoveWithReview, d.Verdict);
            Assert.True(d.ReviewReasons.Any(x => x.Code == ItemCodes.HostMoved));
        }

        [Test]
        public static void EgressLongerButReachable_IsReview_NotStop()
        {
            StateSnapshot b = Snap().WithEgress(Route(1, 28.4));
            StateSnapshot a = Snap().WithEgress(Route(1, 28.7));
            MoveDecision d = Decide(Run(b, a));
            Assert.Eq(MoveVerdict.MoveWithReview, d.Verdict);
            Assert.True(d.Primary.Text.Contains("+0.30 м"), d.Primary.Text);
        }

        [Test]
        public static void AdvisoryIncompleteness_CapsAtReview_NeverGreen_NeverUnknown()
        {
            StateSnapshot b = Snap().WithRoom(Room(1, 10)); b.AdvisoryReasons.Add("Хүснэгтийн шүүлт бэлдэж чадсангүй.");
            MoveDecision d = Decide(Run(b, Snap().WithRoom(Room(1, 10))));
            Assert.Eq(MoveVerdict.MoveWithReview, d.Verdict);
            Assert.True(d.ReviewReasons.Any(x => x.Code == "incomplete.advisory"));
        }

        [Test]
        public static void ClearanceDecrease_WithNoLegalThreshold_IsReview()
        {
            HostedSnap bd = Door(30, 1300); bd.ClearanceEvaluated = true; bd.ClearanceMm = 1500;
            HostedSnap ad = Door(30, 1600); ad.ClearanceEvaluated = true; ad.ClearanceMm = 900;
            MoveDecision d = Decide(Run(Snap().WithHosted(bd), Snap().WithHosted(ad)));
            Assert.Eq(MoveVerdict.MoveWithReview, d.Verdict);
            Assert.True(d.ReviewReasons.Any(x => x.Code == ItemCodes.ClearanceChanged));
        }

        /* ============================== ТҮР ДҮН (QUICK) ====================== */

        [Test]
        public static void QuickStage_NeverShowsGreen_EvenWithNothingFound()
        {
            PreChangeInput inp = Input(); inp.Stage = AnalysisStage.Quick; inp.PendingChecks.AddRange(new[] { "MEP", "Гарц" });
            MoveDecision d = Decide(PreChangeDiff.Compute(inp));
            Assert.True(d.IsPending);
            Assert.False(d.IsFinal);
            Assert.Eq(MoveVerdict.Unknown, d.Verdict);
            Assert.Eq("ШАЛГАЖ БАЙНА…", d.Title);
            Assert.False(d.CanBeApplied);
            Assert.Eq(CheckState.Pending, d.Chip("mep").State);
        }

        [Test]
        public static void QuickStage_ReviewIsShownAsProvisionalOrange_AndApplyStaysClosed()
        {
            PreChangeInput inp = Input(Snap().WithRoom(Room(1, 24.8, true)), Snap().WithRoom(Room(1, 22.9)));
            inp.Stage = AnalysisStage.Quick;
            MoveDecision d = Decide(PreChangeDiff.Compute(inp));
            Assert.Eq(MoveVerdict.MoveWithReview, d.Verdict);
            Assert.True(d.IsPending);
            Assert.False(d.CanBeApplied);
            PreChangeView v = PreChangeView.Build(PreChangeDiff.Compute(inp), FreshnessState.Fresh, false);
            Assert.Eq(PreChangeView.StageProvisional, v.StageLabel);
            Assert.False(v.Gate.PrimaryEnabled);
        }

        [Test]
        public static void QuickStage_ConfirmedBlockIsAlreadyRed()
        {
            PreChangeInput inp = Input(Snap().WithRoom(Room(1, 24.8)), Snap());
            inp.Stage = AnalysisStage.Quick;
            MoveDecision d = Decide(PreChangeDiff.Compute(inp));
            Assert.Eq(MoveVerdict.DoNotMove, d.Verdict);
            Assert.True(d.IsPending, "гүн шалгалт үргэлжилж байгааг түр дүн гэж тэмдэглэнэ");
        }

        [Test]
        public static void QuickStage_DoesNotReportPendingChecksAsIncomplete()
        {
            PreChangeInput inp = Input(); inp.Stage = AnalysisStage.Quick;
            PreChangeReport r = PreChangeDiff.Compute(inp);
            Assert.Eq(0, r.RequiredIncomplete.Count);
            Assert.False(r.Coverage.ClashEvaluated, "гүн шалгалт хийгдээгүйг «хийгдсэн» гэж тэмдэглэхгүй");
        }

        /* ============================== ТОДОРХОЙЛОГДСОН ЭРЭМБЭ ============== */

        [Test]
        public static void ReasonOrdering_IsDeterministic_AcrossItemOrder()
        {
            StateSnapshot b = Snap().WithRoom(Room(1, 24.8, true)).WithRoom(Room(2, 18.1, true, "101", "Коридор")).WithRoom(Room(3, 30.0, true, "305", "Склад"))
                .WithDim(Dim(10, 4200)).WithHosted(Door(30, 1300));
            StateSnapshot a = Snap().WithRoom(Room(1, 22.9)).WithRoom(Room(2, 20.0, false, "101", "Коридор")).WithRoom(Room(3, 29.5, false, "305", "Склад"))
                .WithDim(Dim(10, 3900)).WithHosted(Door(30, 1600));
            PreChangeDependencies deps = Deps(); deps.DimensionIds.Add(10);
            deps.Views.Add(View(20, "FloorPlan", 31)); deps.Sheets.Add(Sheet(31, "A-501")); deps.Sheets.Add(Sheet(32, "A-102"));
            PreChangeReport r1 = Run(b, a, deps);
            MoveDecision d1 = Decide(r1);
            r1.Items.Reverse();
            MoveDecision d2 = Decide(r1);
            Assert.SeqEq(d1.Top.Select(x => x.Text), d2.Top.Select(x => x.Text));
            Assert.SeqEq(d1.ReviewReasons.Select(x => x.Text), d2.ReviewReasons.Select(x => x.Text));
            Assert.Eq(3, d1.Top.Count);
        }

        [Test]
        public static void TopReasons_AreAtMostThree_RoomsByLargestAreaChangeFirst()
        {
            StateSnapshot b = Snap().WithRoom(Room(1, 24.8, true)).WithRoom(Room(2, 18.1, true, "101", "Коридор")).WithRoom(Room(3, 30.0, true, "305", "Склад")).WithRoom(Room(4, 12.0, true, "401", "Агуулах"));
            StateSnapshot a = Snap().WithRoom(Room(1, 24.0)).WithRoom(Room(2, 20.5, false, "101", "Коридор")).WithRoom(Room(3, 29.0, false, "305", "Склад")).WithRoom(Room(4, 11.5, false, "401", "Агуулах"));
            MoveDecision d = Decide(Run(b, a));
            Assert.Eq(3, d.Top.Count);
            Assert.True(d.Top[0].Text.Contains("101 Коридор"), d.Top[0].Text);       // |Δ| = 2.4
            Assert.True(d.Top[1].Text.Contains("305 Склад"), d.Top[1].Text);          // 1.0
            Assert.True(d.ReviewReasons.Count >= 4);
        }

        [Test]
        public static void BlockingReasonPriority_SourceThenDeletedThenRoomThenClash()
        {
            StateSnapshot b = Snap().WithRoom(Room(1, 24.8));
            RoomSnap open = Room(1, 0); open.Enclosed = false;
            StateSnapshot a = Snap().WithRoom(open).WithPair(Pair("D-03", ClashVerdict.ConfirmedClash));
            a.DeletedIds = new List<long> { 1 };
            MoveDecision d = Decide(Run(b, a));
            Assert.SeqEq(new[] { ItemCodes.ModelDeleted, ItemCodes.RoomUnenclosed, ItemCodes.ClashNew }, d.Blocking.Select(x => x.Code));
            Assert.Eq(ItemCodes.ModelDeleted, d.Primary.Code);
        }

        [Test]
        public static void ModelOnlyNote_NeverClaimsLegalApproval()
        {
            Assert.True(PreChangeDecisionEngine.NormAutoNotDone == "Монгол нормын автомат баталгаажуулалт хийгдээгүй.");
            Assert.True(PreChangeDecisionEngine.ModelOnlyNote.Contains("биш"));
        }

        [Test]
        public static void NullReport_IsUnknown()
        {
            Assert.Eq(MoveVerdict.Unknown, Decide(null).Verdict);
        }
        /* ============================== ХЯНАХ МӨР ШАЛТГААНГҮЙ ҮЛДЭЖ БОЛОХГҮЙ ===== */

        [Test]
        public static void RevitWarning_MakesTheVerdictAmber_NeverGreen()
        {
            PreChangeReport r = Run(Snap(), Snap());
            Assert.Eq(MoveVerdict.MoveOk, Decide(r).Verdict, "суурь нь ногоон");
            r.Items.Add(new PreChangeItem { Key = "failure:0", Code = ItemCodes.FailureWarning, Category = PreChangeCategory.Failure, Truth = TruthState.Confirmed, Severity = ItemSeverity.Notice, Title = "Revit анхааруулга", Why = "Highlighted walls overlap", Kind = ImpactNodeKind.Element });
            MoveDecision d = Decide(r);
            Assert.Eq(MoveVerdict.MoveWithReview, d.Verdict);
            Assert.True(d.Primary.Text.Contains("Revit анхааруулга") && d.Primary.Text.Contains("Highlighted walls overlap"), d.Primary.Text);
            Assert.True(d.CanBeApplied, "🟠 нь «Хянаад зөөх» — хаалттай биш");
        }

        [Test]
        public static void DoorFromToRoomChange_MakesTheVerdictAmber_NeverGreen()
        {
            PreChangeReport r = Run(Snap(), Snap());
            r.Items.Add(new PreChangeItem { Key = "host-rooms:20", Code = ItemCodes.HostRooms, Subject = "Door D-120", Category = PreChangeCategory.Hosted, Truth = TruthState.Confirmed, Severity = ItemSeverity.Notice, Title = "Door D-120 өрөө солигдоно", Kind = ImpactNodeKind.Element });
            MoveDecision d = Decide(r);
            Assert.Eq(MoveVerdict.MoveWithReview, d.Verdict);
            Assert.True(d.Primary.Text.Contains("From/To"), d.Primary.Text);
        }

        [Test]
        public static void AnyConfirmedOrReviewNoticeItem_CanNeverYieldGreen_UnlessItIsAKnownNeutralCode()
        {
            // Хамгаалалт: ItemCodes-д нэмэгдсэн ШИНЭ код «хянах» нөлөөлөл мөртлөө шалтгаангүй үлдэж ногоон болгохгүй.
            var neutral = new HashSet<string>
            {
                ItemCodes.ClashOld, ItemCodes.ClashNone, ItemCodes.ClashResolved, ItemCodes.DimUnchanged, ItemCodes.Tags, ItemCodes.NormNe, ItemCodes.ClashNe,
                ItemCodes.EgressNe, ItemCodes.EgressNotConfigured, ItemCodes.ClearanceNe, ItemCodes.ScheduleNe, ItemCodes.ClashIncomplete,
            };
            foreach (System.Reflection.FieldInfo f in typeof(ItemCodes).GetFields(System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Static))
            {
                var code = (string)f.GetRawConstantValue();
                if (neutral.Contains(code)) continue;
                foreach (TruthState truth in new[] { TruthState.Confirmed, TruthState.Review })
                {
                    PreChangeReport r = Run(Snap(), Snap());
                    r.Items.Add(new PreChangeItem { Key = "x:" + code, Code = code, Subject = "S", Category = PreChangeCategory.Model, Truth = truth, Severity = ItemSeverity.Notice, Title = "Нөлөөлөл " + code, Kind = ImpactNodeKind.Element });
                    MoveDecision d = Decide(r);
                    Assert.True(d.Verdict != MoveVerdict.MoveOk, "код «" + code + "» (" + truth + ", Notice) шалтгаангүй үлдэж шийдвэрийг 🟢 болгосон");
                }
            }
        }
    }
}
