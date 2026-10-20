using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using RevitMcpAddin.ChangeImpact.Core;
using RevitMcpAddin.ChangeImpact.Ui;
using RevitMcpAddin.ClashCheck.Core;
using RevitMcpAddin.Smart.Core;

namespace RevitMcpAddin.Smart.UiSmoke
{
    /// <summary>
    /// Revit-гүй `IPreChangeSession`: бодит `PreChangeDiff`-ээр CEO demo-н хуурамч загварт тайлан гаргана (Коридор ↔ Оффис 203,
    /// 2 өрөө, 2 хэмжээс, хаалга, 1 section + 2 plan, 3 хуудас, 1 шинэ MEP clash).  Түр дүн (Quick) → эцсийн дүгнэлт (Full) бодитоор дамжина.
    /// Цонх → автомат сонголт → зайн товч → түр дүн → шийдвэр → нэг товч → хуучирсан / боломжгүй гинжийг бодитоор товч дарж шалгана.
    ///
    /// ⚠️ Энэ нь интерактив Windows desktop session шаардана.  Linux дээр ЗӨВХӨН КОМПАЙЛ хийгддэг; ажиллуулаагүй бол «ажиллуулаагүй» гэж тайланд бичнэ.
    /// ⚠️ `MessageBox` (🟠 баталгаажуулалт, эзэмшлийн асуулт) модаль тул тест 🟠-ийн зөөх товчийг дарахгүй — зөвхөн шошгыг шалгана.
    /// </summary>
    internal sealed class FakePreChangeSession : IPreChangeSession
    {
        public string DocumentTitle { get { return "Tennis-Hall"; } }
        public bool Blocked, Incomplete, Clean;
        public bool NewClash = true;
        public bool NeedsAck, Acked;
        public FreshnessState Freshness = FreshnessState.Fresh;
        public int PreviewCalls, ApplyCalls, ShowCalls, ProvisionalCalls, GhostSets, GhostClears;
        public ApplyTone LastGhostTone = ApplyTone.None;
        public PreChangeRequest LastRequest;
        public List<ExitInfo> ExitList = new List<ExitInfo>();
        public ApplyStatus ApplyResult = ApplyStatus.AppliedVerified;
        public int PickSideIndex = 1;

        public Task<PreChangeSelection> GetSelectionAsync(CancellationToken ct) { return Task.FromResult(Selection()); }
        public Task<string> PeekSelectedWallAsync(CancellationToken ct) { return Task.FromResult("wall-1234"); }
        public Task<PreChangeSelection> PickWallAsync(CancellationToken ct) { return Task.FromResult(Selection()); }
        public Task<SidePickResult> PickSideAsync(PreChangeSelection wall, CancellationToken ct) { return Task.FromResult(SidePickResult.Of(PickSideIndex)); }

        private PreChangeSelection Selection()
        {
            return new PreChangeSelection
            {
                Valid = true, SourceId = 1234, SourceUid = "wall-1234", Label = "Basic Wall : Interior 200 · #1234", LevelName = "L1",
                LengthMm = 6400, ThicknessMm = 200, HostedCount = 1, NeedsCheckoutAck = NeedsAck,
                Sides =
                {
                    new WallSideInfo { Index = 0, Label = "Коридор тал руу", DirX = 0, DirY = 1, RoomName = "Коридор" },
                    new WallSideInfo { Index = 1, Label = "Оффис 203 тал руу", DirX = 0, DirY = -1, RoomName = "Оффис 203" },
                },
            };
        }

        public bool OwnershipAcknowledged(PreChangeSelection wall) { return !NeedsAck || Acked; }
        public void AcknowledgeOwnership(PreChangeSelection wall) { Acked = true; }

        public Task SetGhostAsync(PreChangeGhostRequest ghost, CancellationToken ct) { GhostSets++; LastGhostTone = ghost.Tone; return Task.FromResult(true); }
        public Task ClearGhostAsync() { GhostClears++; return Task.FromResult(true); }

        private static StateSnapshot NewSnap()
        {
            return new StateSnapshot { Captured = true, Clash = new ClashSnap { Evaluated = true, Complete = true }, Egress = new EgressSnap { Configured = false } };
        }

        private PreChangeInput BuildInput(PreChangeRequest request, AnalysisStage stage)
        {
            var before = NewSnap();
            var after = NewSnap();
            var deps = new PreChangeDependencies { VisibilityChecked = true, AfterVisibilityChecked = true };
            if (!Clean)
            {
                before.Rooms[1] = new RoomSnap { Id = 1, Number = "203", Name = "Оффис", Placed = true, Enclosed = true, AreaM2 = 24.8, BoundedBySource = true };
                after.Rooms[1] = new RoomSnap { Id = 1, Number = "203", Name = "Оффис", Placed = true, Enclosed = true, AreaM2 = 22.9, BoundedBySource = true };
                before.Rooms[2] = new RoomSnap { Id = 2, Name = "Коридор", Placed = true, Enclosed = true, AreaM2 = 18.1, BoundedBySource = true };
                after.Rooms[2] = new RoomSnap { Id = 2, Name = "Коридор", Placed = true, Enclosed = true, AreaM2 = 20.0, BoundedBySource = true };
                before.Dimensions[10] = new DimSnap { Id = 10, Readable = true, SegmentsMm = { 4200 }, ViewName = "Plan L1" };
                after.Dimensions[10] = new DimSnap { Id = 10, Readable = true, SegmentsMm = { 3900 }, ViewName = "Plan L1" };
                before.Hosted[20] = new HostedSnap { Id = 20, Name = "Door D-120", Category = "Doors", LocationMm = new double[] { 0, 0, 0 } };
                after.Hosted[20] = new HostedSnap { Id = 20, Name = "Door D-120", Category = "Doors", LocationMm = new double[] { 0, -300, 0 } };
                deps.Views.Add(new DepNode { Id = 31, Name = "Plan L1", Kind = ImpactNodeKind.View, ViewType = "FloorPlan", Confidence = ImpactConfidence.B, Reason = "Хэмжээсийн эзэн харагдац", SheetIds = { 41 } });
                deps.Views.Add(new DepNode { Id = 33, Name = "Section 1", Kind = ImpactNodeKind.View, ViewType = "Section", Confidence = ImpactConfidence.C, Reason = "Магадгүй харагдана", SheetIds = { 43 } });
                deps.Sheets.Add(new DepNode { Id = 41, Name = "Ground floor plan", SheetNumber = "A-102", Kind = ImpactNodeKind.Sheet, Confidence = ImpactConfidence.B });
                deps.Sheets.Add(new DepNode { Id = 43, Name = "Sections", SheetNumber = "A-501", Kind = ImpactNodeKind.Sheet, Confidence = ImpactConfidence.C });
            }
            if (NewClash && stage == AnalysisStage.Full)
                after.Clash.Pairs["duct-1"] = new ClashPairState { Key = "duct-1", OtherId = 9832, OtherLabel = "Duct #9832", Verdict = ClashVerdict.ConfirmedClash, VolumeCm3 = 410 };
            before.Clash.Pairs["duct-1"] = new ClashPairState { Key = "duct-1", OtherId = 9832, OtherLabel = "Duct #9832", Verdict = ClashVerdict.NoClash };
            if (Incomplete) { after.Clash.IncompleteReasons.Add("1 линк unload хийгдсэн"); after.Clash.Complete = false; }

            var input = new PreChangeInput
            {
                Request = request, DocumentTitle = DocumentTitle, Utc = DateTime.UtcNow, Before = before, After = after, Deps = deps, Stage = stage,
                Outcome = Blocked ? SandboxOutcome.Blocked : SandboxOutcome.Simulated,
                Fingerprint = new PreChangeFingerprint { SourceUid = "wall-1234", SourceId = 1234, ModelStamp = "a:1" },
            };
            if (stage == AnalysisStage.Quick) input.PendingChecks.AddRange(new[] { "MEP clash", "Гарцын зам" });
            if (Blocked) input.BlockReasons.Add("Хана түгжигдсэн хэмжээсээр хязгаарлагдсан.");
            return input;
        }

        public async Task<PreChangeReport> PreviewAsync(PreChangeRequest request, IProgress<JobProgress> progress, Action<PreChangeReport> onProvisional, CancellationToken ct)
        {
            PreviewCalls++;
            LastRequest = request;
            if (progress != null) progress.Report(JobProgress.Of("sandbox", 1, 2, "Хөдөлгөөнийг түр турших"));
            if (!Blocked && onProvisional != null)
            {
                ProvisionalCalls++;
                onProvisional(PreChangeDiff.Compute(BuildInput(request, AnalysisStage.Quick)));
            }
            await Task.Delay(40, ct);
            return PreChangeDiff.Compute(BuildInput(request, AnalysisStage.Full));
        }

        public Task<ApplyOutcome> ApplyAsync(PreChangeReport preview, PreChangeRequest currentRequest, IProgress<JobProgress> progress, CancellationToken ct)
        {
            ApplyCalls++;
            var o = new ApplyOutcome { Status = ApplyResult };
            o.Message = ApplyResult == ApplyStatus.AppliedVerified
                ? PreChangeText.AppliedVerified(preview.Request, PreChangeSummary.CountsLine(preview))
                : PreChangeText.StalePreview;
            // Хуучирсан → дараагийн preview шинэ (Fresh).
            if (ApplyResult == ApplyStatus.Stale) { Freshness = FreshnessState.Fresh; ApplyResult = ApplyStatus.AppliedVerified; }
            return Task.FromResult(o);
        }

        public FreshnessState CheckFreshness(PreChangeReport report) { return Freshness; }

        public Task<SelectOutcome> ShowAsync(PreChangeItem item, CancellationToken ct)
        {
            ShowCalls++;
            return Task.FromResult(new SelectOutcome { Requested = 1, Applied = 1, Message = "Харууллаа" });
        }

        public IReadOnlyList<ExitInfo> Exits() { return ExitList; }
        public Task<ExitConfigResult> SetExitsFromSelectionAsync(CancellationToken ct)
        {
            ExitList = new List<ExitInfo> { new ExitInfo { Id = 7, Name = "Main entrance" } };
            return Task.FromResult(new ExitConfigResult { Ok = true, Exits = ExitList, Message = "1 хаалгыг гарц болгон хадгаллаа" });
        }
        public Task<ExitConfigResult> ClearExitsAsync(CancellationToken ct)
        {
            ExitList = new List<ExitInfo>();
            return Task.FromResult(new ExitConfigResult { Ok = true, Message = "Гарц цэвэрлэгдлээ" });
        }
    }

    public static class PreChangeSmoke
    {
        private static PreChangeWindow OpenWindow(FakePreChangeSession s)
        {
            var w = new PreChangeWindow(s);
            Ui.Open(w);
            Ui.Wait(250);          // Loaded → сонгосон ханыг АВТОМАТААР авна
            return w;
        }

        private static void Chip(PreChangeWindow w, string mm)
        {
            Ui.ClickToggle(w, mm);
            Ui.Wait(500);
        }

        public static void Window_Opens_AutoReadsSelection_ShowsChipsSidesAndSeparateNormLine()
        {
            var s = new FakePreChangeSession();
            var w = OpenWindow(s);
            try
            {
                string text = Ui.AllText(w);
                Ui.True(text.Contains("Basic Wall"), "сонгосон хана автоматаар орсон: " + text);
                Ui.Eq(5, Ui.All<ToggleButton>(w).Count(t => t.Content is string && new[] { "100", "200", "300", "500", "1000" }.Contains((string)t.Content)), "5 зайн товч");
                Ui.Eq(2, Ui.All<RadioButton>(w).Count(), "хоёр тал");
                Ui.True(text.Contains("Коридор тал руу") && text.Contains("Оффис 203 тал руу"), "тал нь өрөөний нэрээр: " + text);
                Ui.True(text.Contains(PreChangeDecisionEngine.NormAutoNotDone), "норм мөр ТУСДАА, үргэлж харагдана: " + text);
                Ui.True(!Ui.FindButton(w, "Эхлээд нөлөөллийг шалгана").IsEnabled, "шалгаагүй үед үндсэн товч идэвхгүй");
                Ui.Eq(0, s.PreviewCalls, "нээхэд шинжилгээ ӨӨРӨӨ эхлэхгүй (загварт хүрэхгүй)");
                Ui.Shot(w, "prechange-open");
            }
            finally { w.Close(); }
        }

        public static void Chip_StartsAnalysis_ShowsProvisionalThenFinal_AndGhost()
        {
            var s = new FakePreChangeSession();
            var w = OpenWindow(s);
            try
            {
                Chip(w, "300");
                string text = Ui.AllText(w);
                Ui.Eq(1, s.PreviewCalls, "нэг шинжилгээ");
                Ui.Eq(1, s.ProvisionalCalls, "түр дүн нэг удаа гарсан");
                Ui.True(s.GhostSets >= 1, "сүүдэр зурагдсан");
                Ui.Eq(300.0, s.LastRequest.DistanceMm, "зай");
                Ui.True(text.Contains("ЗӨӨХГҮЙ"), "шинэ MEP clash → 🔴 ЗӨӨХГҮЙ: " + text);
                Ui.True(text.Contains("Эцсийн техникийн дүгнэлт"), "эцсийн шат: " + text);
                Ui.Eq(ApplyTone.Red, s.LastGhostTone, "сүүдрийн өнгө = шийдвэр");
                Ui.True(!Ui.FindButton(w, "Зөөхгүй").IsEnabled, "🔴 үед үндсэн товч идэвхгүй");
                Ui.True(Ui.FindButton(w, "Яагаад?").Visibility == Visibility.Visible, "«Яагаад?» харагдана");
                Ui.True(text.Contains(PreChangeDecisionEngine.NormAutoNotDone), "норм мөр хэвээр");
                Ui.Shot(w, "prechange-red");
            }
            finally { w.Close(); }
        }

        public static void CleanModel_IsGreen_ButtonSaysMoveAndAppliesOnce()
        {
            var s = new FakePreChangeSession { Clean = true, NewClash = false };
            var w = OpenWindow(s);
            try
            {
                Chip(w, "200");
                string text = Ui.AllText(w);
                Ui.True(text.Contains("ТЕХНИКИЙН ХУВЬД ЗӨӨЖ БОЛНО"), "🟢: " + text);
                Ui.True(text.Contains(PreChangeDecisionEngine.ModelOnlyNote), "ногоон = нормын зөвшөөрөл БИШ гэж ил хэлнэ");
                Ui.True(text.Contains(PreChangeDecisionEngine.NormAutoNotDone), "норм мөр ногоон дээр ч харагдана");
                Ui.Eq(ApplyTone.Green, s.LastGhostTone, "ногоон сүүдэр");
                Button primary = Ui.FindButton(w, "200 мм зөөх");
                Ui.True(primary.IsEnabled, "ногоон дээр «200 мм зөөх» идэвхтэй");
                Ui.Eq(0, s.ApplyCalls, "preview өөрөө Apply хийхгүй");
                Ui.Click(primary);
                Ui.Wait(300);
                Ui.Eq(1, s.ApplyCalls, "нэг Apply");
                text = Ui.AllText(w);
                Ui.True(text.Contains("зөөгдлөө") && text.Contains("таарсан") && text.Contains("Ctrl+Z"), "баталгаажсан мессеж + буцаах: " + text);
                Ui.True(s.GhostClears >= 1, "хэрэгжсэний дараа сүүдэр арилсан");
                Ui.True(!Ui.All<Button>(w).Any(b => b.IsEnabled && b.Content is string && ((string)b.Content).Contains("мм зөөх")), "хэрэгжсэний дараа үндсэн товч идэвхгүй (preview дахин хэрэглэгдэхгүй)");
            }
            finally { w.Close(); }
        }

        public static void Review_IsAmber_ButtonSaysReviewAndMove()
        {
            var s = new FakePreChangeSession { NewClash = false };
            var w = OpenWindow(s);
            try
            {
                Chip(w, "300");
                string text = Ui.AllText(w);
                Ui.True(text.Contains("ХЯНААД ЗӨӨ"), "🟠: " + text);
                Ui.True(Ui.FindButton(w, "Хянаад 300 мм зөөх").IsEnabled, "🟠 дээр «Хянаад 300 мм зөөх» идэвхтэй");
                Ui.Eq(ApplyTone.Amber, s.LastGhostTone, "шар сүүдэр");
                Ui.Eq(0, s.ApplyCalls, "(MessageBox модаль тул энд Apply дарахгүй)");
            }
            finally { w.Close(); }
        }

        public static void Incomplete_IsUnknown_NotGreen_RecheckOffered()
        {
            var s = new FakePreChangeSession { Incomplete = true, NewClash = false };
            var w = OpenWindow(s);
            try
            {
                Chip(w, "300");
                string text = Ui.AllText(w);
                Ui.True(text.Contains("ДҮГНЭХ БОЛОМЖГҮЙ"), "⚪: " + text);
                Ui.True(!text.Contains("ТЕХНИКИЙН ХУВЬД ЗӨӨЖ БОЛНО"), "бүрэн бус үед ногоон БИШ");
                Ui.True(Ui.FindButton(w, "Шалгалтыг гүйцээх").Visibility == Visibility.Visible, "«Шалгалтыг гүйцээх»");
                Ui.Eq(ApplyTone.Gray, s.LastGhostTone, "саарал сүүдэр");
            }
            finally { w.Close(); }
        }

        public static void Blocked_ShowsReason_AndDisablesMove()
        {
            var s = new FakePreChangeSession { Blocked = true };
            var w = OpenWindow(s);
            try
            {
                Chip(w, "500");
                string text = Ui.AllText(w);
                Ui.True(text.Contains("ЗӨӨХГҮЙ"), "Revit татгалзсан → 🔴: " + text);
                Ui.True(text.Contains("түгжигдсэн хэмжээс"), "шалтгаан харагдана");
                Ui.True(!Ui.FindButton(w, "Зөөхгүй").IsEnabled, "боломжгүй үед товч идэвхгүй");
            }
            finally { w.Close(); }
        }

        public static void Apply_OnStalePreview_DoesNotMove_AutoRefreshes_AndNeedsSecondClick()
        {
            var s = new FakePreChangeSession { Clean = true, NewClash = false, ApplyResult = ApplyStatus.Stale };
            var w = OpenWindow(s);
            try
            {
                Chip(w, "300");
                Ui.Eq(1, s.PreviewCalls, "эхний шинжилгээ");
                Ui.Click(Ui.FindButton(w, "300 мм зөөх"));
                Ui.Wait(700);
                Ui.Eq(1, s.ApplyCalls, "хуучирсан Apply нэг удаа дуудагдсан (зөөгдөөгүй)");
                Ui.Eq(2, s.PreviewCalls, "автоматаар дахин шалгасан");
                Ui.True(Ui.AllText(w).Contains(PreChangeText.StaleRefreshed), "мессеж: " + Ui.AllText(w));
                Button again = Ui.FindButton(w, "300 мм зөөх");
                Ui.True(again.IsEnabled, "шинэ дүнтэй товч дахин идэвхтэй");
                Ui.Eq(1, s.ApplyCalls, "хоёр дахь товшилтгүйгээр ЗӨӨХГҮЙ");
                Ui.Click(again);
                Ui.Wait(300);
                Ui.Eq(2, s.ApplyCalls, "хоёр дахь товшилтоор л зөөнө");
            }
            finally { w.Close(); }
        }

        public static void StalePreview_ShowsBanner_AndDisablesMove()
        {
            var s = new FakePreChangeSession { Clean = true, NewClash = false };
            var w = OpenWindow(s);
            try
            {
                Chip(w, "300");
                s.Freshness = FreshnessState.Stale;
                Ui.Wait(2600);           // 2 с-ийн шинэлэг шалгалт
                Ui.True(Ui.AllText(w).Contains(PreChangeText.StalePreview), "хуучирсан баннер");
                Ui.True(!Ui.All<Button>(w).Any(b => b.IsEnabled && b.Content is string && ((string)b.Content).Contains("мм зөөх")), "хуучирсан үед зөөх идэвхгүй");
                Ui.True(Ui.FindButton(w, "Дахин шалгах").Visibility == Visibility.Visible, "«Дахин шалгах» харагдана");
            }
            finally { w.Close(); }
        }

        public static void UnknownFreshness_FailsClosed()
        {
            var s = new FakePreChangeSession { Clean = true, NewClash = false, Freshness = FreshnessState.Unknown };
            var w = OpenWindow(s);
            try
            {
                Chip(w, "300");
                Ui.True(!Ui.All<Button>(w).Any(b => b.IsEnabled && b.Content is string && ((string)b.Content).Contains("мм зөөх")), "шинэлэг нь тодорхойгүй үед зөөх идэвхгүй");
                Ui.True(Ui.AllText(w).Contains("баталгаажуулж чадсангүй"), "тайлбар");
            }
            finally { w.Close(); }
        }

        public static void PickSideInCanvas_SelectsThatSide_AndRerunsAnalysis()
        {
            var s = new FakePreChangeSession { Clean = true, NewClash = false, PickSideIndex = 1 };
            var w = OpenWindow(s);
            try
            {
                Chip(w, "300");
                Ui.Eq(0.0, s.LastRequest.DirX, "анхны тал 0: dirX");
                Ui.Eq(1.0, s.LastRequest.DirY, "анхны тал 0: dirY");
                Ui.Click(w, "Зураг дээр тал сонгох");
                Ui.Wait(500);
                Ui.Eq(2, s.PreviewCalls, "тал солигдоход дахин шалгана");
                Ui.Eq(-1.0, s.LastRequest.DirY, "сонгосон тал руу: dirY");
                Ui.True(Ui.All<RadioButton>(w).First(r => r.IsChecked == true).Content.ToString().Contains("Оффис 203"), "сонгосон тал идэвхтэй");
            }
            finally { w.Close(); }
        }

        public static void ChangingDistance_RestartsAnalysis_WithNewValue()
        {
            var s = new FakePreChangeSession { Clean = true, NewClash = false };
            var w = OpenWindow(s);
            try
            {
                Chip(w, "300");
                Chip(w, "500");
                Ui.Eq(2, s.PreviewCalls, "хоёр шинжилгээ");
                Ui.Eq(500.0, s.LastRequest.DistanceMm, "шинэ зай");
                Ui.True(Ui.AllText(w).Contains("500 мм зөөх") || Ui.All<Button>(w).Any(b => b.Content is string && ((string)b.Content).Contains("500 мм зөөх")), "товч шинэ зайг хэлнэ");
            }
            finally { w.Close(); }
        }

        public static void Ownership_AlreadyAcknowledged_DoesNotPrompt_AndAnalysisRuns()
        {
            var s = new FakePreChangeSession { Clean = true, NewClash = false, NeedsAck = true, Acked = true };
            var w = OpenWindow(s);
            try
            {
                Chip(w, "300");
                Ui.Eq(1, s.PreviewCalls, "зөвшөөрсөн ханад асуулгүйгээр шинжилнэ");
            }
            finally { w.Close(); }
        }

        public static void Cancel_ClearsResultAndGhost()
        {
            var s = new FakePreChangeSession { Clean = true, NewClash = false };
            var w = OpenWindow(s);
            try
            {
                Chip(w, "300");
                int clears = s.GhostClears;
                Ui.Click(w, "Цуцлах");
                Ui.Wait(150);
                Ui.True(s.GhostClears > clears, "сүүдэр арилсан");
                Ui.True(Ui.AllText(w).Contains(PreChangeText.Cancelled), "цуцлагдсан мессеж");
                Ui.True(!Ui.All<Button>(w).Any(b => b.IsEnabled && b.Content is string && ((string)b.Content).Contains("мм зөөх")), "цуцалсны дараа зөөх идэвхгүй");
            }
            finally { w.Close(); }
        }

        public static void Close_ClearsGhost()
        {
            var s = new FakePreChangeSession { Clean = true, NewClash = false };
            var w = OpenWindow(s);
            Chip(w, "300");
            int clears = s.GhostClears;
            w.Close();
            Ui.Wait(150);
            Ui.True(s.GhostClears > clears, "цонх хаагдахад сүүдэр арилна");
        }

        public static void Exits_SetAndClear_UpdateLabel_InsideCollapsedAdvanced()
        {
            var s = new FakePreChangeSession();
            var w = OpenWindow(s);
            try
            {
                Expander adv = Ui.All<Expander>(w).First(e => e.Header is string && ((string)e.Header).StartsWith("Нарийвчилсан"));
                Ui.True(!adv.IsExpanded, "«Нарийвчилсан» анхнаасаа хаалттай");
                Ui.True(Ui.AllText(w).Contains("тохируулаагүй"), "эхэндээ гарц тохируулаагүй");
                Ui.Click(w, "гарц болгох");
                Ui.Wait(150);
                Ui.True(Ui.AllText(w).Contains("Main entrance"), "гарц харагдана: " + Ui.AllText(w));
                Ui.Click(w, "Гарц цэвэрлэх");
                Ui.Wait(150);
                Ui.True(Ui.AllText(w).Contains("тохируулаагүй"), "цэвэрлэсний дараа");
            }
            finally { w.Close(); }
        }

        public static void AdvancedHeader_ShowsStatusLine_AfterAnalysis()
        {
            var s = new FakePreChangeSession { Clean = true, NewClash = false };
            var w = OpenWindow(s);
            try
            {
                Chip(w, "300");
                Expander adv = Ui.All<Expander>(w).First(e => e.Header is string && ((string)e.Header).StartsWith("Нарийвчилсан"));
                string h = (string)adv.Header;
                Ui.True(h.Contains("Өрөө ✓") && h.Contains("Хэмжээс ✓") && h.Contains("MEP ✓") && h.Contains("Гарц — тохируулаагүй") && h.Contains("Норм — шалгаагүй"), "төлөвийн мөр: " + h);
            }
            finally { w.Close(); }
        }

        public static void CardClick_ShowsInRevit()
        {
            var s = new FakePreChangeSession { NewClash = false };
            var w = OpenWindow(s);
            try
            {
                Chip(w, "300");
                Ui.True(Ui.All<Button>(w).Any(b => b.Content is string && ((string)b.Content).Contains("Харуулах")), "«Харуулах» товч байна (өрөө, MEP...)");
                Ui.Click(w, "Харуулах");
                Ui.Wait(150);
                Ui.True(s.ShowCalls >= 1, "Revit-д харуулсан");
            }
            finally { w.Close(); }
        }
    }
}
