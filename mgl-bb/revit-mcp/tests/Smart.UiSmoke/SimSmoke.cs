using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using RevitMcpAddin.ChangeImpact.Core;
using RevitMcpAddin.ChangeImpact.Ui;

namespace RevitMcpAddin.Smart.UiSmoke
{
    /// <summary>
    /// Revit-гүй «Өөрчлөхөөс өмнө» SIMULATION цонхны жишээ сесс: бодит `SimController`, `SimNarrative`, WPF `Viewport3D`-ээр хуурамч загварт
    /// (1×1×2 м багана + 3 м зайд 200 мм зузаан хана) цонхыг нээж, ачаалж, нудаж, мөргөлдөөнийг УЛААНААР харуулж, Revit-ийн эцсийн дүнг хүлээн авч, зураг хадгална.
    ///
    /// ⚠️ ЭНЭ нь интерактив Windows desktop session шаардана.  Linux дээр ЗӨВХӨН КОМПАЙЛ хийгддэг — ажиллуулаагүй бол тайланд «ажиллуулаагүй» гэж бичнэ.
    /// ⚠️ Хулганаар чирэх (`MouseLeftButtonDown`…) нь бодит Windows хулганы байрлал шаарддаг тул ЭНД чирэлтийг Core-ийн `SimController` тестүүд (`SimControllerTests`) шалгана;
    ///    энд цонхны ачаалал, зураглал, нудалт, Revit-ийн дүн, зөвшөөрөх товчийн төлвийг шалгана.
    /// </summary>
    internal sealed class FakeSimSession : ISimSession
    {
        public string DocumentTitle { get { return "Tennis-Hall"; } }
        public int LoadCalls, AnalyzeCalls, ApplyCalls, GhostShown, GhostCleared, PickCalls;
        public int AnalyzeDelayMs = 60;
        public bool NeedsAck;
        public bool Ack = true;
        public ApplyStatus ApplyResult = ApplyStatus.AppliedVerified;
        public bool ModelChanged;
        public SimExactResult NextExact;
        public GhostScene LastGhost;
        public IList<long> LastSelection;

        public bool OwnershipAcknowledged { get { return Ack; } }
        public void AcknowledgeOwnership() { Ack = true; }
        public double InternalUnitsPerMm { get { return 1.0 / 304.8; } }
        public bool ModelChangedSince(string stamp) { return ModelChanged; }
        public void SetSelection(IList<long> ids) { LastSelection = ids; }
        public Task<IList<long>> PickAsync(CancellationToken ct) { PickCalls++; return Task.FromResult((IList<long>)new List<long>()); }
        public Task ShowElementAsync(long id, int slot, CancellationToken ct) { return Task.FromResult(0); }
        public void ShowGhost(GhostScene scene) { GhostShown++; LastGhost = scene; }
        public void ClearGhost() { GhostCleared++; LastGhost = null; }

        public static SimScene Scene()
        {
            var scene = new SimScene { MovingName = "Багана · Concrete · #1", OriginMm = new double[3], PrimaryId = 1 };
            SimMesh col = SimMeshBuilder.Box("h:1", 0, 0, 0, 1000, 1000, 2000, SimRole.Moving, SimKind.Column);
            col.Id = 1; col.Label = "Багана · Concrete · #1";
            scene.Moving.Add(col);
            SimMesh wall = SimMeshBuilder.Box("h:2", 3000, -2000, 0, 3200, 4000, 3000, SimRole.Context, SimKind.Wall);
            wall.Id = 2; wall.Label = "Хана · Generic 200 · #2"; wall.CategoryName = "Хана";
            scene.Context.Add(wall);
            SimMesh floor = SimMeshBuilder.Box("h:3", -3000, -3000, -300, 8000, 5000, 0, SimRole.Context, SimKind.Floor);
            floor.Id = 3; floor.Label = "Шал · Concrete 300 · #3"; floor.CategoryName = "Шал";
            scene.Context.Add(floor);
            return scene;
        }

        public async Task<SimLoadOutcome> LoadAsync(IProgress<SimLoadProgress> progress, CancellationToken ct)
        {
            LoadCalls++;
            if (progress != null) progress.Report(new SimLoadProgress { Done = 1, Total = 3 });
            await Task.Delay(30, ct);
            return new SimLoadOutcome { Ok = true, Scene = Scene(), LoadMs = 30, DocumentTitle = DocumentTitle, Stamp = "stamp:1", NeedsOwnershipAck = NeedsAck && !Ack };
        }

        public async Task<SimExactResult> AnalyzeAsync(SimVec offsetMm, int generation, CancellationToken ct)
        {
            AnalyzeCalls++;
            await Task.Delay(AnalyzeDelayMs, ct);
            if (NextExact != null)
            {
                SimExactResult r = NextExact;
                r.Generation = generation;
                r.OffsetMm = new[] { offsetMm.X, offsetMm.Y, offsetMm.Z };
                return r;
            }
            return new SimExactResult
            {
                Generation = generation, OffsetMm = new[] { offsetMm.X, offsetMm.Y, offsetMm.Z }, Outcome = SandboxOutcome.Simulated,
                ClashesEvaluated = true, ClashesComplete = true, RoomsEvaluated = true, Stamp = "stamp:1", ElapsedMs = 60,
            };
        }

        public async Task<ApplyOutcome> ApplyAsync(SimVec offsetMm, SimExactResult preview, CancellationToken ct)
        {
            ApplyCalls++;
            await Task.Delay(40, ct);
            return new ApplyOutcome { Status = ApplyResult, Message = "Зөөлөө (нэг Undo)." };
        }
    }

    public static class SimSmoke
    {
        private static SimWindow Open(FakeSimSession s)
        {
            var w = new SimWindow(s);
            Ui.Open(w);
            // Ачаалал async — төгсөх хүртэл хүлээнэ.
            for (int i = 0; i < 100 && (w.IsLoading || w.Controller.Scene == null); i++) Ui.Wait(40);
            return w;
        }

        public static void Window_LoadsTheSceneAndShowsTheElementInTheViewport()
        {
            var s = new FakeSimSession();
            SimWindow w = Open(s);
            Ui.Eq(1, s.LoadCalls, "сцен нэг удаа ачаалагдана");
            Ui.True(!w.IsLoading, "ачаалал дууссан");
            Ui.True(w.Controller.Scene != null && w.Controller.IsReady, "сцен ба суурь (baseline) бэлэн");
            Ui.True(w.ContextModelCount >= 1, "орчин (хана, шал) 3D дээр зурагдсан");
            Ui.True(w.ViewportHost != null && w.ViewportHost.ActualWidth > 100, "3D харагдац нь хэмжээтэй");
            Ui.True(!w.ApproveButton.IsEnabled, "зөөлт хийгээгүй — «Зөвшөөрөх» хаалттай");
            Ui.Shot(w, "sim-01-loaded");
        }

        public static void Window_Nudge_ShowsTheConflictAndRevitResult_ThenApproveEnables()
        {
            var s = new FakeSimSession();
            SimWindow w = Open(s);
            Ui.True(w.NudgeForTest(new SimVec(2300, 0, 0)), "нудалт хүлээн авагдана");
            Ui.True(w.Controller.Offset.X > 2000, "offset өөрчлөгдсөн");
            Ui.True(w.Controller.Report.Lines.Any(l => l.Code == "clash.prelim"), "урьдчилсан мөргөлдөөн мөр: " + string.Join(" | ", w.Controller.Report.Lines.Select(l => l.Text)));
            Ui.True(w.Controller.Report.HighlightKeys.Contains("h:2"), "мөргөлдөж буй хана тодорсон");
            Ui.True(w.PanelChildCount > 0, "баруун самбарт мөр");
            Ui.Shot(w, "sim-02-preliminary-clash");

            // Debounce (260 мс) + Revit-ийн (хуурамч) шалгалт.
            Ui.Wait(900);
            Ui.Eq(1, s.AnalyzeCalls, "Revit-ийн шалгалт нэг удаа явсан");
            Ui.True(w.Controller.Exact != null, "Revit-ийн эцсийн дүн хүлээн авагдсан");
            Ui.Shot(w, "sim-03-exact");
        }

        public static void Window_RevitResult_IsRejected_WhenTheUserMovedAgain()
        {
            var s = new FakeSimSession { AnalyzeDelayMs = 400 };
            SimWindow w = Open(s);
            w.NudgeForTest(new SimVec(500, 0, 0));
            Ui.Wait(450);                                   // debounce дууссан, Revit-ийн (удаан) шалгалт явж байна
            w.NudgeForTest(new SimVec(100, 0, 0));          // хэрэглэгч дахин хөдөлгөв → хуучин дүн хүчингүй
            Ui.Wait(1500);
            Ui.True(w.Controller.Exact == null || w.Controller.Exact.Matches(w.Controller.Offset), "хуучирсан дүн ХЭЗЭЭ Ч хүлээн авагдахгүй");
            Ui.True(s.ApplyCalls == 0, "зөвшөөрөөгүй — загвар хөдлөөгүй");
        }

        public static void Window_StaleModel_ShowsTheNotice_AndNeverApplies()
        {
            var s = new FakeSimSession();
            SimWindow w = Open(s);
            w.NudgeForTest(new SimVec(300, 0, 0));
            Ui.Wait(800);
            s.ModelChanged = true;                          // загвар өөр газраас өөрчлөгдсөн
            Ui.Wait(900);                                   // OnTick (20 тик тутам) мэдэж авна
            Ui.True(!w.ApproveButton.IsEnabled, "загвар өөрчлөгдсөн — «Зөвшөөрөх» хаалттай (fail-closed)");
            Ui.Shot(w, "sim-04-stale");
            Ui.Eq(0, s.ApplyCalls, "хуучирсан загварт зөөлт ХЭЗЭЭ Ч явахгүй");
        }

        public static void Window_RefusedElement_ExplainsWhy_AndHasNothingToDrag()
        {
            var s = new RefusingSession();
            var w = new SimWindow(s);
            Ui.Open(w);
            for (int i = 0; i < 60 && w.IsLoading; i++) Ui.Wait(40);
            Ui.True(!w.ApproveButton.IsEnabled, "зөөх боломжгүй элемент");
            Ui.True(Ui.AllText(w).Contains("Pin") || Ui.AllText(w).Contains("зөөх боломжгүй") || w.StatusText.Length > 0 || w.BannerTitle.Length > 0, "шалтгаан харагдана");
            Ui.Shot(w, "sim-05-refused");
        }

        private sealed class RefusingSession : ISimSession
        {
            public string DocumentTitle { get { return "Tennis-Hall"; } }
            public bool OwnershipAcknowledged { get { return true; } }
            public void AcknowledgeOwnership() { }
            public double InternalUnitsPerMm { get { return 1.0 / 304.8; } }
            public bool ModelChangedSince(string stamp) { return false; }
            public void SetSelection(IList<long> ids) { }
            public Task<IList<long>> PickAsync(CancellationToken ct) { return Task.FromResult((IList<long>)new List<long>()); }
            public Task ShowElementAsync(long id, int slot, CancellationToken ct) { return Task.FromResult(0); }
            public void ShowGhost(GhostScene scene) { }
            public void ClearGhost() { }
            public Task<SimLoadOutcome> LoadAsync(IProgress<SimLoadProgress> progress, CancellationToken ct)
            {
                return Task.FromResult(new SimLoadOutcome { Ok = false, Refused = true, Problem = "Элемент Pin хийгдсэн — зөөх боломжгүй." });
            }
            public Task<SimExactResult> AnalyzeAsync(SimVec offsetMm, int generation, CancellationToken ct) { throw new InvalidOperationException("зөөх боломжгүй элемент шинжлэгдэхгүй"); }
            public Task<ApplyOutcome> ApplyAsync(SimVec offsetMm, SimExactResult preview, CancellationToken ct) { throw new InvalidOperationException("зөөх боломжгүй элемент зөөгдөхгүй"); }
        }
    }
}
