using System;
using System.Collections.Generic;
using System.Linq;
using RevitMcpAddin.ChangeImpact.Core;
using RevitMcpAddin.ClashCheck.Core;
using static RevitMcpAddin.Smart.Tests.DoorFixtures;

namespace RevitMcpAddin.Smart.Tests
{
    /// <summary>
    /// Хаалга зөөх SIMULATION-ы төлөвийн машин: generation, latest-wins, хуучирсан үр дүнгийн хаялт, Approve уралдаан, Discard/Apply/Close-ийн
    /// зураглал цэвэрлэлт, ghost/тодруулгын шууд шинэчлэл, overlay mesh, UI загвар.  Бүгд Revit-гүй; цаг `FakeHost.Now`-оос.
    /// </summary>
    public static class DoorSimulationTests
    {
        private static DoorMoveContext C() { return Ctx(1500, 900); }

        private static PreChangeReport Final(double offset) { return Run(C(), offset); }

        private static void Settle(FakeHost host, DoorSimulationController c, double offset)
        {
            c.SetTarget(offset);
            PassDebounce(host, c);
            c.OnExactFinished(c.Generation, Final(offset));
        }

        /* ============================== ШУУД ХАРИУЦЛАГА ===================== */

        [Test]
        public static void SettingATarget_ShowsTheGhostAndFastScanImmediately_WithoutStartingTheSandbox()
        {
            var host = new FakeHost();
            DoorSimulationController c = Controller(host);
            c.SetTarget(400);
            Assert.Eq(1, host.Visuals.Count, "ghost ШУУД");
            Assert.Eq(0, host.Started.Count, "sandbox debounce-ийг хүлээнэ");
            Assert.False(host.LastVisual.Exact, "fast scan нь ЭЦСИЙН БИШ");
            Assert.NotNull(host.LastVisual.Ghost);
            Assert.Eq(ExactPhase.Debouncing, c.Phase);
            Assert.NotNull(c.Fast);
            Assert.Near(400, host.LastVisual.OffsetMm, 1e-9);
            Assert.Near(400, host.LastVisual.VectorMm[0], 1e-9, "вектор нь хостын чиглэл × offset");
        }

        [Test]
        public static void ZeroOffset_ClearsTheGhost_AndIsNotASimulation()
        {
            var host = new FakeHost();
            DoorSimulationController c = Controller(host);
            c.SetTarget(400);
            int before = host.ClearCount;
            c.SetTarget(0);
            Assert.Eq(ExactPhase.None, c.Phase);
            Assert.Eq(before + 1, host.ClearCount);
            Assert.Eq(0, host.Started.Count);
        }

        [Test]
        public static void SettingTheSameTargetTwice_DoesNothingTheSecondTime()
        {
            var host = new FakeHost();
            DoorSimulationController c = Controller(host);
            c.SetTarget(400);
            int g = c.Generation, v = host.Visuals.Count;
            c.SetTarget(400);
            Assert.Eq(g, c.Generation);
            Assert.Eq(v, host.Visuals.Count);
        }

        [Test]
        public static void TargetWithoutContext_IsIgnored_AndNanInfinityAreIgnored()
        {
            var host = new FakeHost();
            var c = new DoorSimulationController(host, Sel());
            c.SetTarget(400);
            Assert.False(c.HasTarget);
            c.SetContext(C());
            c.SetTarget(double.NaN);
            c.SetTarget(double.PositiveInfinity);
            Assert.False(c.HasTarget);
            Assert.Eq(0, host.Visuals.Count);
        }

        [Test]
        public static void EveryVisual_IsTaggedWithTheGenerationItWasBuiltFor()
        {
            var host = new FakeHost();
            DoorSimulationController c = Controller(host);
            c.SetTarget(100);
            Assert.Eq(c.Generation, host.LastVisual.Generation);
            c.SetTarget(200);
            Assert.Eq(c.Generation, host.LastVisual.Generation);
            Assert.True(host.Visuals.Select(v => v.Generation).Distinct().Count() == 2);
        }

        /* ============================== LATEST-WINS / GENERATION ============ */

        [Test]
        public static void RapidNudges_StartExactlyOneSandbox_ForTheLatestTarget()
        {
            var host = new FakeHost();
            DoorSimulationController c = Controller(host);
            for (int i = 0; i < 4; i++) { c.Nudge(10); host.Now += 40; c.Tick(); }
            Assert.Eq(0, host.Started.Count, "debounce дотор sandbox эхлэхгүй");
            PassDebounce(host, c);
            Assert.Eq(1, host.Started.Count, "4 даралт → ЯГ 1 sandbox");
            Assert.Near(40, host.Started[0].Value.OffsetMm, 1e-9);
            Assert.Eq(c.Generation, host.Started[0].Key);
        }

        [Test]
        public static void SlowResultOfAnOldTarget_NeverReplacesTheNewTargetUi()
        {
            var host = new FakeHost();
            DoorSimulationController c = Controller(host);
            c.SetTarget(400);
            PassDebounce(host, c);
            int g1 = host.Started[0].Key;
            c.SetTarget(800);                                              // хэрэглэгч шинэ байрлал руу шилжив — sandbox 1 цуцлагдана
            Assert.True(host.Cancelled.Contains(g1), "явж буй sandbox цуцлагдах ёстой");
            int visuals = host.Visuals.Count;

            bool accepted = c.OnExactFinished(g1, Final(400));             // хуучин үр дүн ХОЖИМ ирлээ
            Assert.False(accepted);
            Assert.Near(800, c.OffsetMm.Value, 1e-9, "UI шинэ зорилт дээр хэвээр");
            Assert.Null(c.CurrentReport);
            Assert.Eq(visuals, host.Visuals.Count, "хуучин үр дүн зураглалыг ХЭЗЭЭ Ч шинэчлэхгүй");
            Assert.Eq(1L, c.Timings.LateIgnoredCount);
            Assert.False(c.ExactIsCurrentAndFinal);
        }

        [Test]
        public static void LateProvisionalAndFailureOfAnOldTarget_AreIgnoredToo()
        {
            var host = new FakeHost();
            DoorSimulationController c = Controller(host);
            c.SetTarget(400);
            PassDebounce(host, c);
            int g1 = host.Started[0].Key;
            c.SetTarget(800);
            Assert.False(c.OnExactProvisional(g1, Final(400)));
            Assert.False(c.OnExactFailed(g1, "алдаа", false));
            Assert.Eq(ExactPhase.Debouncing, c.Phase);
            Assert.Null(c.LastError);
        }

        [Test]
        public static void PreviousResult_IsKeptAsPrevious_WhileTheNewTargetIsChecked()
        {
            var host = new FakeHost();
            DoorSimulationController c = Controller(host);
            Settle(host, c, 400);
            Assert.NotNull(c.CurrentReport);
            c.SetTarget(500);
            Assert.Null(c.CurrentReport);
            Assert.NotNull(c.PreviousReport, "өмнөх дүн бүдэг харуулахад үлдэнэ");
            DoorMoveView v = DoorMoveView.Build(c, FreshnessState.Fresh);
            Assert.True(v.ListsArePrevious);
            Assert.Near(400, v.PreviousOffsetMm.Value, 1e-9);
            Assert.True(v.Busy);
            Assert.True(v.Predictive);
        }

        [Test]
        public static void ProvisionalThenFinal_OnlyFinalEnablesApprove_AndLateProvisionalAfterFinalIsIgnored()
        {
            var host = new FakeHost();
            DoorSimulationController c = Controller(host);
            c.SetTarget(400);
            PassDebounce(host, c);
            int g = c.Generation;
            Assert.True(c.OnExactProvisional(g, Run(C(), 400, stage: AnalysisStage.Quick)));
            Assert.Eq(ExactPhase.Provisional, c.Phase);
            Assert.False(c.Gate(FreshnessState.Fresh).PrimaryEnabled, "түр дүнгээр зөөж болохгүй");
            Assert.True(c.OnExactFinished(g, Final(400)));
            Assert.True(c.Gate(FreshnessState.Fresh).PrimaryEnabled);
            Assert.False(c.OnExactProvisional(g, Run(C(), 400, stage: AnalysisStage.Quick)), "эцсийн дүнгийн ДАРАА ирсэн түр дүн хаягдана");
            Assert.Eq(ExactPhase.Final, c.Phase);
        }

        [Test]
        public static void CancelledFailure_IsNotAnError_AndDoesNotChangeThePhase()
        {
            var host = new FakeHost();
            DoorSimulationController c = Controller(host);
            c.SetTarget(400);
            PassDebounce(host, c);
            Assert.False(c.OnExactFailed(c.Generation, "цуцлагдсан", true));
            Assert.Null(c.LastError);
            Assert.Eq(ExactPhase.Running, c.Phase);
        }

        [Test]
        public static void SandboxFailure_ClosesApprove_AndOffersARecheck_WithoutAnyReport()
        {
            var host = new FakeHost();
            DoorSimulationController c = Controller(host);
            c.SetTarget(400);
            PassDebounce(host, c);
            Assert.True(c.OnExactFailed(c.Generation, "Revit алдаа", false));
            Assert.Eq(ExactPhase.Failed, c.Phase);
            ApplyGateResult g = c.Gate(FreshnessState.Fresh);
            Assert.False(g.PrimaryEnabled);
            Assert.True(g.ShowRecheck);
            DoorMoveView v = DoorMoveView.Build(c, FreshnessState.Fresh);
            Assert.Eq("ДҮГНЭХ БОЛОМЖГҮЙ", v.Title);
            Assert.False(v.Gate.PrimaryEnabled);
            string refusal;
            Assert.Null(c.TryBeginApply(FreshnessState.Fresh, out refusal));
            Assert.NotNull(refusal);
        }

        [Test]
        public static void Recheck_StartsAFreshGenerationImmediately_WithoutDebounce()
        {
            var host = new FakeHost();
            DoorSimulationController c = Controller(host);
            c.SetTarget(400);
            PassDebounce(host, c);
            c.OnExactFailed(c.Generation, "x", false);
            int g = c.Generation;
            c.Recheck();
            Assert.Eq(g + 1, c.Generation);
            Assert.Eq(2, host.Started.Count);
            Assert.Eq(c.Generation, host.Started[1].Key);
            Assert.Eq(ExactPhase.Running, c.Phase);
        }

        /* ============================== APPROVE УРАЛДАА ===================== */

        [Test]
        public static void Approve_IsClosedUntilTheExactFinalResultOfTheCurrentTargetArrives()
        {
            var host = new FakeHost();
            DoorSimulationController c = Controller(host);
            string refusal;
            Assert.Null(c.TryBeginApply(FreshnessState.Fresh, out refusal), "зорилтгүй");
            c.SetTarget(400);
            Assert.False(c.Gate(FreshnessState.Fresh).PrimaryEnabled, "debounce");
            Assert.Null(c.TryBeginApply(FreshnessState.Fresh, out refusal));
            PassDebounce(host, c);
            Assert.False(c.Gate(FreshnessState.Fresh).PrimaryEnabled, "sandbox ажиллаж байна");
            Assert.Null(c.TryBeginApply(FreshnessState.Fresh, out refusal));
            Assert.True(refusal.Contains("шалгаж байна"), refusal);
            c.OnExactFinished(c.Generation, Final(400));
            Assert.True(c.Gate(FreshnessState.Fresh).PrimaryEnabled);
            PreChangeReport r = c.TryBeginApply(FreshnessState.Fresh, out refusal);
            Assert.NotNull(r);
            Assert.True(c.Applying);
        }

        [Test]
        public static void Approve_AfterTheTargetMoved_IsRefused_EvenIfTheOldResultWasGreen()
        {
            var host = new FakeHost();
            DoorSimulationController c = Controller(host);
            Settle(host, c, 400);
            Assert.True(c.Gate(FreshnessState.Fresh).PrimaryEnabled);
            c.Nudge(10);                                                  // хэрэглэгч 410 болгов — «зөвшөөрсөн» нь 400-ийн дүн
            string refusal;
            Assert.Null(c.TryBeginApply(FreshnessState.Fresh, out refusal));
            Assert.False(c.Gate(FreshnessState.Fresh).PrimaryEnabled);
            Assert.False(c.ExactIsCurrentAndFinal);
        }

        [Test]
        public static void DoubleClickingApprove_AppliesOnlyOnce()
        {
            var host = new FakeHost();
            DoorSimulationController c = Controller(host);
            Settle(host, c, 400);
            string refusal;
            Assert.NotNull(c.TryBeginApply(FreshnessState.Fresh, out refusal));
            Assert.Null(c.TryBeginApply(FreshnessState.Fresh, out refusal));
            Assert.True(refusal.Contains("Хэрэгжүүлж"), refusal);
        }

        [Test]
        public static void TargetChangesAndLateResults_AreIgnoredWhileApplying()
        {
            var host = new FakeHost();
            DoorSimulationController c = Controller(host);
            Settle(host, c, 400);
            string refusal;
            c.TryBeginApply(FreshnessState.Fresh, out refusal);
            int g = c.Generation;
            c.SetTarget(900);
            c.Nudge(10);
            Assert.Near(400, c.OffsetMm.Value, 1e-9, "Apply-ийн үед зорилт өөрчлөгдөхгүй");
            Assert.Eq(g, c.Generation);
            Assert.False(c.Discard(), "Apply-ийн үед Discard байхгүй");
            Assert.False(c.OnExactFinished(g, Final(400)));
        }

        [Test]
        public static void ApproveGate_RefusesDoNotMove_Stale_AndUnknownVerdicts()
        {
            var host = new FakeHost();
            DoorSimulationController c = Controller(host);
            // 🔴: бүтцийн хана руу мөргөнө
            DoorMoveContext ctx = C();
            ctx.Obstacles.Add(Box(700, ObstacleKind.Structure, 1900, 2300));
            c.SetContext(ctx);
            c.SetTarget(500);
            PassDebounce(host, c);
            StateSnapshot after = Snap(DoorSnap(2000));
            PreChangeInput inp = Input(ctx, 500, after: after);
            inp.After.Clash.Pairs["host:700"] = DoorPair("host:700", ObstacleKind.Structure, ClashVerdict.ConfirmedClash, 700);
            c.OnExactFinished(c.Generation, PreChangeDiff.Compute(inp));
            Assert.Eq(MoveVerdict.DoNotMove, PreChangeDecisionEngine.Decide(c.ExactReport).Verdict);
            Assert.False(c.Gate(FreshnessState.Fresh).PrimaryEnabled);
            string refusal;
            Assert.Null(c.TryBeginApply(FreshnessState.Fresh, out refusal));

            // Хуучирсан загвар → 🟢 байсан ч хаалттай
            var host2 = new FakeHost();
            DoorSimulationController c2 = Controller(host2);
            Settle(host2, c2, 400);
            Assert.True(c2.Gate(FreshnessState.Fresh).PrimaryEnabled);
            Assert.False(c2.Gate(FreshnessState.Stale).PrimaryEnabled);
            Assert.False(c2.Gate(FreshnessState.Unknown).PrimaryEnabled);
        }

        /* ============================== APPLY ҮР ДҮН ======================== */

        [Test]
        public static void SuccessfulApply_ClearsEverything_AndShowsTheMessage()
        {
            var host = new FakeHost();
            DoorSimulationController c = Controller(host);
            Settle(host, c, 400);
            string refusal;
            c.TryBeginApply(FreshnessState.Fresh, out refusal);
            int clears = host.ClearCount;
            c.OnApplied(new ApplyOutcome { Status = ApplyStatus.AppliedVerified, Message = "Хаалга 400 мм зөөгдлөө" });
            Assert.False(c.Applying);
            Assert.False(c.HasTarget);
            Assert.Null(c.ExactReport);
            Assert.Eq(clears + 1, host.ClearCount, "ghost + тодруулга арилсан");
            Assert.Eq("Хаалга 400 мм зөөгдлөө", c.Notice);
            Assert.Eq(ExactPhase.None, c.Phase);
        }

        [Test]
        public static void StaleApply_RechecksAutomatically_WithoutMovingAnything()
        {
            var host = new FakeHost();
            DoorSimulationController c = Controller(host);
            Settle(host, c, 400);
            string refusal;
            c.TryBeginApply(FreshnessState.Fresh, out refusal);
            int started = host.Started.Count;
            c.OnApplied(new ApplyOutcome { Status = ApplyStatus.Stale, Message = "хуучирсан" });
            Assert.Eq(started + 1, host.Started.Count, "автоматаар дахин шалгана");
            Assert.True(c.HasTarget, "зорилт хэвээр — зөөгдөөгүй");
            Assert.False(c.ExactIsCurrentAndFinal, "хуучин дүн Approve-д ашиглагдахгүй");
        }

        [Test]
        public static void FailedOrMismatchedApply_KeepsTheTarget_ButClosesApproveUntilARecheck()
        {
            foreach (ApplyStatus st in new[] { ApplyStatus.Failed, ApplyStatus.RolledBackMismatch, ApplyStatus.Cancelled })
            {
                var host = new FakeHost();
                DoorSimulationController c = Controller(host);
                Settle(host, c, 400);
                string refusal;
                c.TryBeginApply(FreshnessState.Fresh, out refusal);
                int clears = host.ClearCount;
                c.OnApplied(new ApplyOutcome { Status = st, Message = "алдаа" });
                Assert.True(c.HasTarget, st.ToString());
                Assert.Eq(clears + 1, host.ClearCount, st + ": Apply амжилтгүй бол ghost ЦЭВЭРЛЭГДЭНЭ");
                Assert.False(c.Gate(FreshnessState.Fresh).PrimaryEnabled, st.ToString());
                Assert.True(c.Gate(FreshnessState.Fresh).ShowRecheck, st + ": дахин шалгах санал болгоно");
                Assert.Eq("алдаа", c.Notice);
                Assert.Eq(ExactPhase.None, c.Phase);
            }
        }

        [Test]
        public static void ApplyWithoutAnOutcome_NeverLeavesTheControllerStuckApplying()
        {
            var host = new FakeHost();
            DoorSimulationController c = Controller(host);
            Settle(host, c, 400);
            string refusal;
            c.TryBeginApply(FreshnessState.Fresh, out refusal);
            c.OnApplied(null);
            Assert.False(c.Applying);
            Assert.True(c.Notice.Contains("Revit"), c.Notice);
        }

        /* ============================== DISCARD / CLOSE ===================== */

        [Test]
        public static void Discard_CancelsRunningWork_ClearsGhost_AndIgnoresLateResults()
        {
            var host = new FakeHost();
            DoorSimulationController c = Controller(host);
            c.SetTarget(400);
            PassDebounce(host, c);
            int g = host.Started[0].Key;
            int clears = host.ClearCount;
            Assert.True(c.Discard());
            Assert.True(host.Cancelled.Contains(g));
            Assert.Eq(clears + 1, host.ClearCount);
            Assert.False(c.HasTarget);
            Assert.Eq(PreChangeText.SimulationDiscarded, c.Notice);
            Assert.False(c.OnExactFinished(g, Final(400)), "Discard-ийн дараа ирсэн үр дүн хаягдана");
            Assert.Null(c.CurrentReport);
            Assert.False(c.Gate(FreshnessState.Fresh).PrimaryEnabled);
            // Discard нь бодит загварт ХЭЗЭЭ Ч хүрэхгүй: зөвхөн нэг (цуцлагдсан) sandbox эхэлсэн, өөр шинжилгээ/Apply үгүй.
            Assert.Eq(1, host.Started.Count);
        }

        [Test]
        public static void Close_IsIdempotent_AndClearsTheGraphics()
        {
            var host = new FakeHost();
            DoorSimulationController c = Controller(host);
            Settle(host, c, 400);
            c.Close();
            c.Close();
            Assert.True(host.ClearCount >= 2);
            Assert.False(c.HasTarget);
            Assert.False(c.Applying);
            Assert.Null(c.ExactReport);
        }

        [Test]
        public static void Close_DuringApply_ReleasesTheApplyingFlag()
        {
            var host = new FakeHost();
            DoorSimulationController c = Controller(host);
            Settle(host, c, 400);
            string refusal;
            c.TryBeginApply(FreshnessState.Fresh, out refusal);
            c.Close();
            Assert.False(c.Applying);
        }

        /* ============================== ТЭМДЭГЛЭГДСЭН ТАТГАЛЗАЛ ============= */

        [Test]
        public static void TargetOutsideTheHost_IsAnImmediateFinalDoNotMove_WithoutAnySandbox()
        {
            var host = new FakeHost();
            DoorSimulationController c = Controller(host);
            c.SetTarget(5000);                                            // 1500 + 5000 = 6500 > хост 6000
            Assert.Eq(0, host.Started.Count);
            PassDebounce(host, c);
            Assert.Eq(0, host.Started.Count, "тодорхой татгалзалд sandbox ХЭРЭГГҮЙ");
            Assert.Eq(ExactPhase.Final, c.Phase);
            Assert.True(c.ExactIsCurrentAndFinal);
            MoveDecision d = PreChangeDecisionEngine.Decide(c.ExactReport);
            Assert.Eq(MoveVerdict.DoNotMove, d.Verdict);
            Assert.False(c.Gate(FreshnessState.Fresh).PrimaryEnabled);
            DoorMoveView v = DoorMoveView.Build(c, FreshnessState.Fresh);
            Assert.True(v.Subtitle != null && v.Subtitle.Length > 0);
        }

        /* ============================== ШҮҮЛТҮҮР / ТОДРУУЛГА ================= */

        [Test]
        public static void ClickingACounter_FiltersTheHighlights_AndAllRestoresThem()
        {
            var host = new FakeHost();
            DoorMoveContext ctx = C();
            ctx.Obstacles.Add(Box(700, ObstacleKind.Structure, 2300, 2700));          // эхлэлийн интервал [1050,1950]-д хүрэхгүй, эцсийн [1550,2450]-д орно
            ctx.Obstacles.Add(Box(701, ObstacleKind.Furniture, 2000, 2400));
            DoorSimulationController c = Controller(host, ctx);
            c.SetTarget(500);
            int all = host.LastVisual.Overlay.Count;
            Assert.True(all >= 2, "хоёр нэр дэвшигч тодрох ёстой");
            c.SetFilter(ImpactGroup.Critical);
            Assert.Eq(ImpactGroup.Critical, host.LastVisual.Filter.Value);
            Assert.True(host.LastVisual.Overlay.All(b => b.Group == ImpactGroup.Critical));
            Assert.True(host.LastVisual.Overlay.Count < all);
            c.SetFilter(null);
            Assert.Eq(all, host.LastVisual.Overlay.Count);
        }

        [Test]
        public static void Filter_SurvivesATargetChange_ButIsClearedByDiscard()
        {
            var host = new FakeHost();
            DoorSimulationController c = Controller(host);
            c.SetTarget(400);
            c.SetFilter(ImpactGroup.Review);
            c.SetTarget(500);
            Assert.Eq(ImpactGroup.Review, host.LastVisual.Filter.Value);
            c.Discard();
            Assert.False(c.Filter.HasValue);
        }

        /* ============================== ХУГАЦААНЫ ХЭМЖИЛТ =================== */

        [Test]
        public static void Timings_AreMeasuredFromTheHostClock_NotInvented()
        {
            var host = new FakeHost();
            DoorSimulationController c = Controller(host);
            c.SetTarget(400);
            PassDebounce(host, c);
            host.Now += 130;
            c.OnExactProvisional(c.Generation, Run(C(), 400, stage: AnalysisStage.Quick));
            host.Now += 250;
            c.OnExactFinished(c.Generation, Final(400));
            Assert.Eq(130L, c.Timings.ExactToProvisionalMs);
            Assert.Eq(380L, c.Timings.ExactToFinalMs);
            Assert.Eq(1L, c.Timings.ExactCount);
            Assert.True(c.Timings.FastScanMs >= 0);
            DoorMoveView v = DoorMoveView.Build(c, FreshnessState.Fresh);
            Assert.True(v.TechnicalInfo.Contains("эцсийн дүн 380 мс"), v.TechnicalInfo);
            // ghost / UI / зөөлтийн хугацаа: ghost-ийг контроллер өөрөө хэмжинэ; UI, зөөлтийг цонх хэмжиж тавина — зөвхөн хэмжсэн утга л гарна.
            Assert.True(c.Timings.GhostUpdateMs >= 0);
            c.Timings.GhostUpdateMs = 1.25; c.Timings.RenderMs = 3.2; c.Timings.ApplyMs = 450;
            string tech = DoorMoveView.Build(c, FreshnessState.Fresh).TechnicalInfo;
            Assert.True(tech.Contains("ghost 1.25 мс") && tech.Contains("UI 3.2 мс") && tech.Contains("зөөлт 450 мс"), tech);
            var fresh = Controller(new FakeHost());
            Assert.False(DoorMoveView.Build(fresh, FreshnessState.Fresh).TechnicalInfo.Contains("зөөлт"), "хэмжээгүй хугацааг зохиож харуулахгүй");
        }

        /* ============================== OVERLAY ============================= */

        private static ImpactEntry E(ImpactGroup g, string key, bool predictive = false)
        {
            return new ImpactEntry { Group = g, TargetKey = key, Id = 1, Kind = ImpactNodeKind.Element, Title = key, Predictive = predictive };
        }

        [Test]
        public static void OverlayBuild_OrdersBySeverity_SkipsNotEvaluated_AndKeepsTheMostSevereForDuplicates()
        {
            DoorMoveContext ctx = C();
            ctx.Obstacles.Add(Box(1, ObstacleKind.Structure, 0, 100));
            ctx.Obstacles.Add(Box(2, ObstacleKind.Furniture, 200, 300));
            ctx.Obstacles.Add(Box(3, ObstacleKind.Mep, 400, 500));
            List<OverlayBox> o = DoorOverlayBuilder.Build(ctx, new[]
            {
                E(ImpactGroup.Review, "0:2"), E(ImpactGroup.Critical, "0:1"), E(ImpactGroup.NotEvaluated, "0:3"),
                E(ImpactGroup.Changed, "0:1"), E(ImpactGroup.Review, "0:1"),
            }, null);
            Assert.Eq(2, o.Count);
            Assert.Eq(ImpactGroup.Critical, o[0].Group);
            Assert.Eq("0:1", o[0].Key);
            Assert.Eq(ImpactGroup.Review, o[1].Group);
        }

        [Test]
        public static void OverlayBuild_SkipsUnknownBoxes_AndBoundsTheCounts()
        {
            DoorMoveContext ctx = C();
            var entries = new List<ImpactEntry> { E(ImpactGroup.Critical, "0:9999") };
            for (int i = 0; i < 100; i++)
            {
                ctx.Obstacles.Add(Box(1000 + i, ObstacleKind.Structure, i * 10, i * 10 + 5));
                entries.Add(E(ImpactGroup.Critical, "0:" + (1000 + i)));
            }
            List<OverlayBox> o = DoorOverlayBuilder.Build(ctx, entries, null);
            Assert.Eq(DoorOverlayBuilder.MaxBoxes, o.Count, "дээд тал нь " + DoorOverlayBuilder.MaxBoxes + " хайрцаг");
            Assert.Eq(DoorOverlayBuilder.MaxMarkers, o.Count(b => b.Marker), "зүү хязгаартай");
            Assert.True(o.All(b => b.Key != "0:9999"), "олдоогүй хайрцаг орохгүй");
        }

        [Test]
        public static void OnlyCriticalAndReview_GetPins_AndChangedSafeDoNot()
        {
            DoorMoveContext ctx = C();
            for (int i = 0; i < 4; i++) ctx.Obstacles.Add(Box(10 + i, ObstacleKind.Furniture, i * 500, i * 500 + 200));
            List<OverlayBox> o = DoorOverlayBuilder.Build(ctx, new[]
            {
                E(ImpactGroup.Critical, "0:10"), E(ImpactGroup.Review, "0:11"), E(ImpactGroup.Changed, "0:12"), E(ImpactGroup.Safe, "0:13"),
            }, null);
            Assert.Eq(2, o.Count(b => b.Marker));
            Assert.True(o.Where(b => b.Group == ImpactGroup.Changed || b.Group == ImpactGroup.Safe).All(b => !b.Marker));
        }

        [Test]
        public static void MeshBuild_GroupsByColour_ConvertsUnits_AndNeverEmitsNanOrDegenerateBoxes()
        {
            const double ft = 1.0 / 304.8;
            var boxes = new List<OverlayBox>
            {
                new OverlayBox { Key = "a", Group = ImpactGroup.Critical, BoxMm = new[] { 0.0, 0, 0, 1000, 200, 3000 }, Marker = true },
                new OverlayBox { Key = "b", Group = ImpactGroup.Critical, BoxMm = new[] { 2000.0, 0, 0, 3000, 200, 3000 } },
                new OverlayBox { Key = "c", Group = ImpactGroup.Review, BoxMm = new[] { 0.0, 0, 0, 0, 200, 3000 } },                       // хавтгай → нимгэн хайрцаг болно
                new OverlayBox { Key = "d", Group = ImpactGroup.Changed, BoxMm = new[] { double.NaN, 0, 0, 1, 1, 1 } },                  // NaN → орхино
                new OverlayBox { Key = "e", Group = ImpactGroup.Safe, BoxMm = null },
            };
            List<OverlayMesh> m = DoorOverlayMesh.Build(boxes, ft);
            Assert.Eq(2, m.Count, "Critical + Review (NaN/null орхигдсон)");
            OverlayMesh crit = m.First(x => x.Group == ImpactGroup.Critical);
            Assert.True(crit.Vertices.All(v => !double.IsNaN(v) && !double.IsInfinity(v)));
            Assert.Near((3000 + 600 + 120 * 1.6) * ft, crit.Vertices.Max(), 1e-9, "зүүний оргил: хайрцгийн дээд + 600 + толгой — мм → дотоод нэгж");
            Assert.True(crit.Triangles.Length == 2 * 36, "2 хайрцаг × 12 гурвалжин × 3");
            Assert.True(crit.Edges.Length > 2 * 24, "зүүний шугам нэмэгдсэн");
            Assert.True(crit.Triangles.All(i => i >= 0 && i < crit.Vertices.Length / 3));
            Assert.True(crit.Edges.All(i => i >= 0 && i < crit.Vertices.Length / 3));
            OverlayMesh rev = m.First(x => x.Group == ImpactGroup.Review);
            Assert.True(rev.Vertices.Length == 24, "нэг хайрцаг");
            Assert.Near(3000 * ft, rev.Vertices.Max(), 1e-9, "зүүгүй хайрцгийн дээд = 3000 мм");
            Assert.True(DoorOverlayMesh.Build(boxes, 0).Count == 0 && DoorOverlayMesh.Build(boxes, double.NaN).Count == 0 && DoorOverlayMesh.Build(null, ft).Count == 0);
        }

        [Test]
        public static void SeverityColours_AreDistinct_AndFollowTheSpec()
        {
            byte[] r = DoorOverlayMesh.Rgb(ImpactGroup.Critical), o = DoorOverlayMesh.Rgb(ImpactGroup.Review), y = DoorOverlayMesh.Rgb(ImpactGroup.Changed), b = DoorOverlayMesh.Rgb(ImpactGroup.Safe);
            Assert.True(r[0] > r[1] + 100 && r[0] > r[2] + 100, "улаан");
            Assert.True(o[0] > 200 && o[1] > 100 && o[1] < 190 && o[2] < 50, "улбар шар");
            Assert.True(y[0] > 200 && y[1] > 170 && y[2] < 50, "шар");
            Assert.True(b[2] > b[0] + 100, "цэнхэр");
            Assert.Eq(4, new[] { r, o, y, b }.Select(x => string.Join(",", x)).Distinct().Count());
        }

        [Test]
        public static void Ghost_IsBuiltFromTheOriginalDoor_AtItsCurrentPosition()
        {
            DoorGhostSpec g = DoorOverlayBuilder.GhostOf(C());
            Assert.Near(1500, g.CenterX, 1e-6);
            Assert.Near(0, g.CenterY, 1e-6);
            Assert.Near(900, g.WidthMm, 1e-6);
            Assert.Near(1, g.DirX, 1e-9);
            Assert.Near(2100, g.ZMaxMm, 1e-6);
            Assert.Null(DoorOverlayBuilder.GhostOf(null));
        }

        /* ============================== UI ЗАГВАР =========================== */

        [Test]
        public static void ViewWithoutATarget_ExplainsWhatToDo_AndNeverShowsAVerdict()
        {
            var host = new FakeHost();
            DoorSimulationController c = Controller(host);
            DoorMoveView v = DoorMoveView.Build(c, FreshnessState.Fresh);
            Assert.False(v.HasTarget);
            Assert.Eq("ШИНЭ БАЙРЛАЛ ЗААГААГҮЙ", v.Title);
            Assert.False(v.Gate.PrimaryEnabled);
            Assert.Eq(DoorMoveView.ModelUnchanged, v.StatusLine);
            Assert.True(v.DoorHeadline.Contains("D-120") && v.DoorHeadline.Contains("900 × 2100"), v.DoorHeadline);
            Assert.True(v.RoomsLine.Contains("Коридор") && v.RoomsLine.Contains("Оффис 203"));
        }

        [Test]
        public static void ViewDuringTheFastPhase_IsLabelledPreliminary_AndNeverGreen()
        {
            var host = new FakeHost();
            DoorSimulationController c = Controller(host);
            c.SetTarget(400);
            DoorMoveView v = DoorMoveView.Build(c, FreshnessState.Fresh);
            Assert.True(v.Predictive && v.Busy);
            Assert.True(v.Mark != "🟢", "fast scan хэзээ ч 🟢 биш");
            Assert.True(v.StageLabel.Contains("Урьдчилсан"), v.StageLabel);
            Assert.False(v.Gate.PrimaryEnabled);
        }

        [Test]
        public static void FastScanCritical_ShowsATemporaryRed_AndTheExactResultThenReplacesIt()
        {
            var host = new FakeHost();
            DoorMoveContext ctx = C();
            ctx.Openings.Add(Opening(121, 2100, 900));                       // мэдэгдсэн өргөнтэй хөрш нүх → интервалын давхцал (тоон баталгаа)
            DoorSimulationController c = Controller(host, ctx);
            c.SetTarget(500);
            DoorMoveView fast = DoorMoveView.Build(c, FreshnessState.Fresh);
            Assert.Eq("ЗӨӨХГҮЙ (түр)", fast.Title);
            Assert.True(fast.Critical.Count >= 1);
            Assert.True(fast.Critical.All(e => e.Predictive));
            Assert.False(fast.Gate.PrimaryEnabled);
            PassDebounce(host, c);
            c.OnExactFinished(c.Generation, Run(ctx, 500));
            DoorMoveView fin = DoorMoveView.Build(c, FreshnessState.Fresh);
            Assert.True(fin.VerdictIsFinal);
            Assert.False(fin.Predictive);
            Assert.Eq(MoveVerdict.DoNotMove, fin.Verdict);
            Assert.True(fin.StageLabel == PreChangeView.StageFinal, fin.StageLabel);
            Assert.True(fin.Critical.Count >= 1 && fin.Critical.All(e => !e.Predictive));
        }

        [Test]
        public static void FastScanBoundingBoxCandidate_IsOnlyAReview_NeverACriticalOrGreen()
        {
            var host = new FakeHost();
            DoorMoveContext ctx = C();
            ctx.Obstacles.Add(Box(700, ObstacleKind.Structure, 2300, 2700));
            DoorSimulationController c = Controller(host, ctx);
            c.SetTarget(500);
            DoorMoveView v = DoorMoveView.Build(c, FreshnessState.Fresh);
            Assert.Eq("ХЯНАХ (түр)", v.Title, "bbox давхцал ганцаараа 🔴 биш");
            Assert.True(v.Mark != "🟢");
            Assert.Eq(0, c.Fast.CriticalCount);
            Assert.Eq(1, c.Fast.ReviewCount);
        }

        [Test]
        public static void CountersAreClickable_Ordered_AndShowTheActiveFilter()
        {
            var host = new FakeHost();
            DoorSimulationController c = Controller(host);
            Settle(host, c, 400);
            c.SetFilter(ImpactGroup.Review);
            DoorMoveView v = DoorMoveView.Build(c, FreshnessState.Fresh);
            Assert.Eq("all", v.Counters[0].Key);
            Assert.Eq("Critical", v.Counters[1].Key, "Ноцтой нь хамгийн түрүүнд");
            Assert.True(v.Counters.Single(x => x.Active).Group == ImpactGroup.Review);
            Assert.False(v.Counters[0].Active);
            v.Counters.ToList().ForEach(x => Assert.True(x.Count >= 0));
        }

        [Test]
        public static void NormalUserText_NeverContainsElementIdsGenerationsOrApiNames()
        {
            var host = new FakeHost();
            DoorMoveContext ctx = C();
            ctx.Obstacles.Add(Box(700, ObstacleKind.Furniture, 1900, 2300, label: "Ширээ T-4"));
            DoorSimulationController c = Controller(host, ctx);
            Settle(host, c, 500);
            DoorMoveView v = DoorMoveView.Build(c, FreshnessState.Fresh);
            var texts = new List<string> { v.Title, v.Subtitle, v.StageLabel, v.StatusLine, v.NormLine, v.SwingLine, v.DoorHeadline, v.RoomsLine, v.HostLine };
            texts.AddRange(v.Entries.SelectMany(e => new[] { e.Title, e.Detail, e.Subject }));
            texts.AddRange(v.Top.Select(t => t.Text));
            foreach (string t in texts.Where(t => !string.IsNullOrEmpty(t)))
            {
                Assert.False(t.Contains("generation"), t);
                Assert.False(t.Contains("ElementId"), t);
                Assert.False(t.Contains("FamilyInstance"), t);
                Assert.False(t.Contains("Transaction"), t);
            }
            Assert.True(v.TechnicalInfo.Contains("generation"), "generation нь ЗӨВХӨН техникийн мэдээлэлд");
        }

        [Test]
        public static void SwingAndNorm_AreAlwaysStated_AndNeverAVerdict()
        {
            var host = new FakeHost();
            DoorSimulationController c = Controller(host);
            Settle(host, c, 400);
            DoorMoveView v = DoorMoveView.Build(c, FreshnessState.Fresh);
            Assert.True(v.SwingLine.Contains("тооцоолоогүй"));
            Assert.True(v.NormLine.Contains("автомат шалгалт хийгдээгүй"));
            Assert.False(v.Title.Contains("Нормд нийцсэн"));
            Assert.Eq(MoveVerdict.MoveOk, v.Verdict);
        }

        /* ============================== ХҮСЭЛТ (REQUEST) ==================== */

        [Test]
        public static void Request_VectorEqualsHostDirectionTimesSignedOffset_ForBothSigns()
        {
            PreChangeRequest p = Req(400), n = Req(-250);
            Assert.Near(400, p.VectorMm[0], 1e-9);
            Assert.Near(-250, n.VectorMm[0], 1e-9);
            Assert.Near(0, p.VectorMm[1], 1e-9);
            Assert.Eq(PreChangeOperationKind.DoorMove, p.Operation);
            Assert.Eq(DoorId, p.SourceId);
            Assert.Eq(HostId, p.HostId);
            string problem = PreChangeRequestRules.Validate(p);
            Assert.Null(problem, problem);
            Assert.Null(PreChangeRequestRules.Validate(n));
        }

        [Test]
        public static void Request_ForAnInvalidVector_IsRejected()
        {
            PreChangeRequest r = Req(400);
            r.DirX = 0; r.DirY = 1;                                       // хостын дагуу биш
            Assert.NotNull(PreChangeRequestRules.Validate(r), "хостоос гарсан чиглэл хориотой");
        }

        /* ============================== ОРОЛТ ============================= */

        [Test]
        public static void SignedOffsetParsing_AcceptsSignsUnitsAndUnicodeMinus_AndRejectsGarbage()
        {
            Assert.Near(300, DoorMoveInput.ParseSignedOffsetMm("+300").Value, 1e-9);
            Assert.Near(300, DoorMoveInput.ParseSignedOffsetMm("300").Value, 1e-9);
            Assert.Near(-250, DoorMoveInput.ParseSignedOffsetMm("-250").Value, 1e-9);
            Assert.Near(-250, DoorMoveInput.ParseSignedOffsetMm("\u2212250 мм").Value, 1e-9);
            Assert.Near(300, DoorMoveInput.ParseSignedOffsetMm("0,3 м").Value, 1e-9);
            Assert.Near(-300, DoorMoveInput.ParseSignedOffsetMm("-30см").Value, 1e-9);
            Assert.Near(0, DoorMoveInput.ParseSignedOffsetMm("0").Value, 1e-9);
            foreach (string bad in new[] { null, "", "  ", "abc", "+-5", "--5", "5mm5", "NaN", "Infinity", "1e9", "-", "+" })
                Assert.Null(DoorMoveInput.ParseSignedOffsetMm(bad), "«" + bad + "» буруу");
        }

        [Test]
        public static void OffsetFormatting_IsStable_AndKeyboardStepsAreFineNormalCoarse()
        {
            Assert.Eq("+300", DoorMoveInput.FormatSignedOffset(300));
            Assert.Eq("-250.5", DoorMoveInput.FormatSignedOffset(-250.5));
            Assert.Eq("0", DoorMoveInput.FormatSignedOffset(0.01));
            Assert.Near(10, DoorMoveInput.KeyStepMm(true, false), 1e-9);
            Assert.Near(50, DoorMoveInput.KeyStepMm(false, false), 1e-9);
            Assert.Near(100, DoorMoveInput.KeyStepMm(false, true), 1e-9);
            Assert.SeqEq(new[] { 10, 50, 100 }, DoorMoveInput.NudgeSteps);
        }

        [Test]
        public static void GhostScene_ForADoor_HasTheGhostOldOutlineAndEveryOverlayGroup_WithBoundsCoveringAll()
        {
            const double ft = 1.0 / 304.8;
            var host = new FakeHost();
            DoorMoveContext ctx = C();
            ctx.Obstacles.Add(Box(700, ObstacleKind.Structure, 2300, 2700));
            ctx.Obstacles.Add(Box(701, ObstacleKind.Furniture, 2000, 2400));
            DoorSimulationController c = Controller(host, ctx);
            c.SetTarget(500);
            GhostScene scene = GhostScenes.ForDoor(host.LastVisual, ft);
            Assert.False(scene.IsEmpty);
            Assert.True(scene.Layers.Any(l => l.Name == "ghost.faces" && l.Triangles.Length == 36), "тунгалаг шинэ байрлал");
            Assert.True(scene.Layers.Any(l => l.Name == "ghost.old" && l.Rgb[0] == 110), "хуучин контур саарал");
            Assert.True(scene.Layers.Any(l => l.Name == "overlay.Review"), "bbox нэр дэвшигч = Review (улбар шар)");
            Assert.Eq(host.LastVisual.Generation, scene.Generation);
            foreach (GhostLayer l in scene.Layers)
                for (int i = 0; i + 2 < l.Xyz.Length; i += 3)
                {
                    Assert.True(l.Xyz[i] >= scene.Bounds[0] - 1e-9 && l.Xyz[i] <= scene.Bounds[3] + 1e-9, "bounds X");
                    Assert.True(l.Xyz[i + 2] >= scene.Bounds[2] - 1e-9 && l.Xyz[i + 2] <= scene.Bounds[5] + 1e-9, "bounds Z");
                }
            // Урьдчилсан тодруулга эцсийнхээс бүдэг
            Assert.True(scene.Layers.First(l => l.Name.StartsWith("overlay.")).Transparency > GhostScenes.ExactOverlayTransparency);
            Assert.True(GhostScenes.ForDoor(null, ft).IsEmpty && GhostScenes.ForDoor(host.LastVisual, 0).IsEmpty && GhostScenes.ForDoor(host.LastVisual, double.NaN).IsEmpty);
        }

        [Test]
        public static void GhostScene_ForAWall_KeepsThePreviousThreeLayerShape()
        {
            GhostMesh m = PreChangeGhostGeometry.Build(0, 0, 1, 0, 10, 0.5, 0, 3, 0, 1);
            GhostScene scene = GhostScenes.ForWall(m, PreChangeGhostGeometry.ToneRgb(ApplyTone.Amber));
            Assert.Eq(3, scene.Layers.Count);
            Assert.Eq(8, scene.Layers[0].VertexCount);
            Assert.Eq(0, scene.Layers[1].Triangles.Length);
            Assert.True(scene.Layers[1].VertexCount > 8, "сум орсон");
            Assert.Eq(0.6, scene.Layers[0].Transparency);
            Assert.NotNull(scene.Bounds);
            Assert.True(GhostScenes.ForWall(null, null).IsEmpty);
        }

        [Test]
        public static void ApproveLabel_SaysTheDoorAndTheSignedDistance()
        {
            var host = new FakeHost();
            DoorSimulationController c = Controller(host);
            Settle(host, c, 400);
            Assert.Eq("Хаалгыг +400 мм зөөх", c.Gate(FreshnessState.Fresh).PrimaryLabel);
            var host2 = new FakeHost();
            DoorSimulationController c2 = Controller(host2);
            Settle(host2, c2, -250);
            Assert.Eq("Хаалгыг -250 мм зөөх", c2.Gate(FreshnessState.Fresh).PrimaryLabel);

            // 🟠: «Хянаад …»
            var host3 = new FakeHost();
            DoorSimulationController c3 = Controller(host3);
            c3.SetTarget(400);
            PassDebounce(host3, c3);
            StateSnapshot after = Snap(DoorSnap(1900, to: 3, toName: "Meeting Room"));
            c3.OnExactFinished(c3.Generation, Run(C(), 400, after: after));
            Assert.Eq("Хянаад хаалгыг +400 мм зөөх", c3.Gate(FreshnessState.Fresh).PrimaryLabel);
        }
    }
}
