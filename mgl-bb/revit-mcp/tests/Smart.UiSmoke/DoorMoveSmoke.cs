using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using RevitMcpAddin.ChangeImpact.Core;
using RevitMcpAddin.ChangeImpact.Ui;
using RevitMcpAddin.ClashCheck.Core;
using RevitMcpAddin.Smart.Core;

namespace RevitMcpAddin.Smart.UiSmoke
{
    /// <summary>
    /// Revit-гүй «Хаалга зөөх» simulation-ийн жишээ сесс: бодит `DoorMoveContext`, `PreChangeDiff`, `DoorSimulationController`-оор хуурамч загварт (хост 0→6000 мм,
    /// хаалга D-120 s=1500 өргөн 900, Коридор ↔ Оффис 203) тайлан гаргана.  Ghost, тодруулга Revit-д ХЭЗЭЭ Ч явахгүй — зөвхөн дуудлагыг тоолно.
    ///
    /// ⚠️ Энэ нь интерактив Windows desktop session шаардана.  Linux дээр ЗӨВХӨН КОМПАЙЛ хийгддэг; ажиллуулаагүй бол «ажиллуулаагүй» гэж тайланд бичнэ.
    /// </summary>
    internal sealed class FakeDoorSession : IPreChangeSession, IDoorMoveSession
    {
        public string DocumentTitle { get { return "Tennis-Hall"; } }
        public FreshnessState Freshness = FreshnessState.Fresh;
        public bool CurrentContext = true;
        public int PreviewCalls, ApplyCalls, ShowVisualCalls, ClearVisualCalls, LoadCalls, PickTargetCalls;
        public double PickedOffset = 300;
        public PreChangeRequest LastRequest;
        public DoorVisualState LastVisual;
        public int PreviewDelayMs = 40;
        public ApplyStatus ApplyResult = ApplyStatus.AppliedVerified;
        public DoorMoveContext Context = Build();

        private static DoorMoveContext Build()
        {
            return new DoorMoveContext
            {
                ModelStamp = "a:1",
                Host = new HostGeometry { Id = 50, Uid = "host", Label = "Interior 200", StartX = 0, StartY = 0, EndX = 6000, EndY = 0, ThicknessMm = 200, ZMinMm = 0, ZMaxMm = 3000 },
                Door = new DoorBody
                {
                    Id = 100, Uid = "door-100", Label = "D-120", TypeName = "Single-Flush", CenterParamMm = 1500, WidthMm = 900, WidthSource = WidthSource.Parameter, GhostWidthMm = 900,
                    HeightMm = 2100, ZMinMm = 0, ZMaxMm = 2100, DepthMm = 200, FromRoomId = 1, ToRoomId = 2, FromRoomLabel = "Коридор", ToRoomLabel = "Оффис 203", RoomsReadable = true,
                },
                Rooms =
                {
                    new ObstacleBox { Id = 1, Kind = ObstacleKind.Room, Label = "Коридор", BoxMm = new[] { 0.0, 200, 0, 3000, 4000, 3000 } },
                    new ObstacleBox { Id = 2, Kind = ObstacleKind.Room, Label = "Оффис 203", BoxMm = new[] { 0.0, -4000, 0, 3000, -200, 3000 } },
                },
            };
        }

        private PreChangeSelection Selection()
        {
            return new PreChangeSelection
            {
                Valid = true, Operation = PreChangeOperationKind.DoorMove, SourceId = 100, SourceUid = "door-100", Label = "D-120", Mark = "D-120", HostId = 50, HostUid = "host", HostLabel = "Interior 200",
                TangentX = 1, TangentY = 0, DoorWidthMm = 900, DoorHeightMm = 2100, LevelName = "Level 1", FromRoom = "Коридор", ToRoom = "Оффис 203", LengthMm = 6000, ThicknessMm = 200,
            };
        }

        public Task<PreChangeSelection> GetDoorSelectionAsync(CancellationToken ct) { return Task.FromResult(Selection()); }
        public Task<string> PeekSelectedDoorAsync(CancellationToken ct) { return Task.FromResult("door-100"); }
        public Task<PreChangeSelection> PickDoorAsync(CancellationToken ct) { return Task.FromResult(Selection()); }
        public Task<DoorContextLoad> LoadContextAsync(PreChangeSelection door, CancellationToken ct)
        {
            LoadCalls++;
            return Task.FromResult(new DoorContextLoad { Ok = true, Context = Context });
        }
        public bool IsContextCurrent(DoorMoveContext ctx) { return CurrentContext; }
        public Task<DoorTargetPick> PickTargetAsync(DoorMoveContext ctx, CancellationToken ct)
        {
            PickTargetCalls++;
            return Task.FromResult(DoorTargetPick.Of(PickedOffset));
        }
        public void ShowVisual(DoorVisualState visual) { ShowVisualCalls++; LastVisual = visual; }
        public void ClearVisual() { ClearVisualCalls++; }

        public Task<PreChangeSelection> GetSelectionAsync(CancellationToken ct) { return Task.FromResult(PreChangeSelection.Invalid(null)); }
        public Task<string> PeekSelectedWallAsync(CancellationToken ct) { return Task.FromResult((string)null); }
        public Task<PreChangeSelection> PickWallAsync(CancellationToken ct) { return Task.FromResult(PreChangeSelection.Invalid(null)); }
        public Task<SidePickResult> PickSideAsync(PreChangeSelection wall, CancellationToken ct) { return Task.FromResult(SidePickResult.Cancel()); }
        public bool OwnershipAcknowledged(PreChangeSelection wall) { return true; }
        public void AcknowledgeOwnership(PreChangeSelection wall) { }
        public Task SetGhostAsync(PreChangeGhostRequest ghost, CancellationToken ct) { return Task.FromResult(true); }
        public Task ClearGhostAsync() { return Task.FromResult(true); }
        public IReadOnlyList<ExitInfo> Exits() { return new List<ExitInfo>(); }
        public Task<ExitConfigResult> SetExitsFromSelectionAsync(CancellationToken ct) { return Task.FromResult(new ExitConfigResult { Ok = true }); }
        public Task<ExitConfigResult> ClearExitsAsync(CancellationToken ct) { return Task.FromResult(new ExitConfigResult { Ok = true }); }
        public FreshnessState CheckFreshness(PreChangeReport report) { return Freshness; }
        public Task<SelectOutcome> ShowAsync(PreChangeItem item, CancellationToken ct) { return Task.FromResult(new SelectOutcome { Requested = 1, Applied = 1, Message = "Харууллаа" }); }

        public async Task<PreChangeReport> PreviewAsync(PreChangeRequest request, IProgress<JobProgress> progress, Action<PreChangeReport> onProvisional, CancellationToken ct)
        {
            PreviewCalls++;
            LastRequest = request;
            double s0 = Context.Door.CenterParamMm;
            Func<AnalysisStage, PreChangeInput> input = stage =>
            {
                var before = new StateSnapshot { Captured = true, Clash = new ClashSnap { Evaluated = true, Complete = true }, Egress = new EgressSnap { Configured = false } };
                var after = new StateSnapshot { Captured = true, Clash = new ClashSnap { Evaluated = true, Complete = true }, Egress = new EgressSnap { Configured = false } };
                before.Source = new ElementPlace { Id = 100, Uid = "door-100", Name = "Single-Flush", Category = "Doors", Location = new[] { s0, 0.0, 0.0 } };
                after.Source = new ElementPlace { Id = 100, Uid = "door-100", Name = "Single-Flush", Category = "Doors", Location = new[] { s0 + request.OffsetMm, 0.0, 0.0 } };
                before.Hosted[100] = new HostedSnap { Id = 100, Uid = "door-100", Category = "Doors", Exists = true, HostId = 50, HostKnown = true, LocationMm = new[] { s0, 0.0, 0.0 }, FromRoomId = 1, ToRoomId = 2, FromRoomName = "Коридор", ToRoomName = "Оффис 203", RoomsReadable = true, FlipKnown = true, Mark = "D-120" };
                after.Hosted[100] = new HostedSnap { Id = 100, Uid = "door-100", Category = "Doors", Exists = true, HostId = 50, HostKnown = true, LocationMm = new[] { s0 + request.OffsetMm, 0.0, 0.0 }, FromRoomId = 1, ToRoomId = 2, FromRoomName = "Коридор", ToRoomName = "Оффис 203", RoomsReadable = true, FlipKnown = true, Mark = "D-120" };
                return new PreChangeInput
                {
                    Request = request, DocumentTitle = DocumentTitle, Utc = DateTime.UtcNow, Outcome = SandboxOutcome.Simulated, Before = before, After = after,
                    Deps = new PreChangeDependencies { VisibilityChecked = true, AfterVisibilityChecked = true }, Door = Context, Stage = stage,
                    Fingerprint = new PreChangeFingerprint { SourceUid = "door-100", SourceId = 100, ModelStamp = "a:1" },
                };
            };
            if (onProvisional != null) onProvisional(PreChangeDiff.Compute(input(AnalysisStage.Quick)));
            await Task.Delay(PreviewDelayMs, ct);
            return PreChangeDiff.Compute(input(AnalysisStage.Full));
        }

        public Task<ApplyOutcome> ApplyAsync(PreChangeReport preview, PreChangeRequest currentRequest, IProgress<JobProgress> progress, CancellationToken ct)
        {
            ApplyCalls++;
            return Task.FromResult(new ApplyOutcome { Status = ApplyResult, Message = PreChangeText.AppliedVerified(preview.Request, PreChangeSummary.CountsLine(preview)) });
        }
    }

    public static class DoorMoveSmoke
    {
        private static DoorMoveWindow OpenWindow(FakeDoorSession s)
        {
            var w = new DoorMoveWindow(s, s);
            Ui.Open(w);
            Ui.Wait(400);          // Loaded → сонгосон хаалгыг АВТОМАТААР авч, контекстыг уншина
            return w;
        }

        public static void Window_Opens_AdoptsTheSelectedDoor_AndLoadsItsContext()
        {
            var s = new FakeDoorSession();
            var w = OpenWindow(s);
            try
            {
                string text = Ui.AllText(w);
                Ui.True(text.Contains("D-120") && text.Contains("900 × 2100"), "хаалга автоматаар орсон: " + text);
                Ui.True(text.Contains("Коридор") && text.Contains("Оффис 203"), "хоёр талын өрөө: " + text);
                Ui.Eq(1, s.LoadCalls, "контекст нэг удаа уншигдсан");
                Ui.Eq(0, s.PreviewCalls, "нээхэд шинжилгээ ӨӨРӨӨ эхлэхгүй");
                Ui.True(text.Contains(PreChangeDecisionEngine.NormAutoNotDone), "норм мөр ТУСДАА, үргэлж харагдана");
                Ui.True(text.Contains("тооцоолоогүй"), "swing: тооцоолоогүй");
                Ui.True(!Ui.All<Button>(w).Any(b => b.IsEnabled && b.Content is string && ((string)b.Content).Contains("зөөх")), "зорилтгүй үед зөөх товч идэвхгүй");
                Ui.Shot(w, "doormove-open");
            }
            finally { w.Close(); }
        }

        public static void Nudge_ShowsGhostInstantly_ThenFinalVerdict_AndApprovesOnce()
        {
            var s = new FakeDoorSession();
            var w = OpenWindow(s);
            try
            {
                Ui.Click(Ui.FindButton(w, "+100"));
                Ui.Wait(30);
                Ui.True(s.ShowVisualCalls >= 1, "ghost ШУУД (sandbox хүлээлгүй)");
                Ui.Eq(0, s.PreviewCalls, "debounce дотор sandbox эхлээгүй");
                Ui.Wait(900);          // debounce 220 мс + preview
                Ui.Eq(1, s.PreviewCalls, "яг нэг шинжилгээ");
                Ui.Eq(100.0, s.LastRequest.OffsetMm, "зай");
                string text = Ui.AllText(w);
                Ui.True(text.Contains("ТЕХНИКИЙН ХУВЬД ЗӨӨЖ БОЛНО"), "🟢: " + text);
                Button primary = Ui.FindButton(w, "зөөх");
                Ui.True(primary.IsEnabled, "эцсийн 🟢 дүн дээр Approve идэвхтэй");
                Ui.Click(primary);
                Ui.Wait(300);
                Ui.Eq(1, s.ApplyCalls, "нэг Apply");
                Ui.True(s.ClearVisualCalls >= 1, "зөөгдсөний дараа ghost арилсан");
                Ui.Shot(w, "doormove-applied");
            }
            finally { w.Close(); }
        }

        public static void RapidNudges_StartOneSandbox_AndDiscardLeavesTheModelUntouched()
        {
            var s = new FakeDoorSession();
            var w = OpenWindow(s);
            try
            {
                for (int i = 0; i < 4; i++) { Ui.Click(Ui.FindButton(w, "+10")); Ui.Wait(20); }
                Ui.Wait(900);
                Ui.Eq(1, s.PreviewCalls, "4 даралт → 1 sandbox (latest-wins)");
                Ui.Eq(40.0, s.LastRequest.OffsetMm, "хамгийн сүүлийн зорилт");
                Ui.Click(Ui.FindButton(w, "Цуцлах"));
                Ui.Wait(100);
                Ui.True(s.ClearVisualCalls >= 1, "Discard → ghost арилсан");
                Ui.Eq(0, s.ApplyCalls, "Discard бодит зөөлт хийгээгүй");
            }
            finally { w.Close(); }
        }

        public static void PickTarget_UsesRevitPickPoint_AndStaleFreshnessClosesApprove()
        {
            var s = new FakeDoorSession { PickedOffset = 300 };
            var w = OpenWindow(s);
            try
            {
                Ui.Click(Ui.FindButton(w, "Зураг дээр сонгох"));
                Ui.Wait(900);
                Ui.Eq(1, s.PickTargetCalls, "Revit PickPoint нэг удаа");
                Ui.Eq(300.0, s.LastRequest.OffsetMm, "сонгосон байрлал → зай");
                s.Freshness = FreshnessState.Stale;
                Ui.Wait(1400);
                Ui.True(!Ui.All<Button>(w).Any(b => b.IsEnabled && b.Content is string && ((string)b.Content).Contains("мм зөөх")), "хуучирсан үед Approve идэвхгүй");
            }
            finally { w.Close(); }
        }
    }
}
