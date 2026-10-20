using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using RevitMcpAddin.ClashCheck.Core;
using RevitMcpAddin.ClashCheck.Ui;
using RevitMcpAddin.Smart.Core;

namespace RevitMcpAddin.Smart.UiSmoke
{
    /// <summary>
    /// Revit-гүй `IClashSession`: ЖИНХЭНЭ `ClashReconciler` + `ClashRuleLogic.Fingerprint`-оор clash-ийг нэгтгэнэ —
    /// тиймээс цонх → шалгалт → жагсаалт → төлөв солих → дахин шалгах бүх урсгал (Revit-ийн геометрээс бусад) энд ажиллана.
    /// </summary>
    internal sealed class FakeClashSession : IClashSession
    {
        public string DocumentTitle { get { return "Tennis-Hall"; } }
        public ClashRulesFile Rules { get; private set; }
        public ClashState State = new ClashState();
        public bool Stale;
        public int DelayMs;
        public int SaveRulesCount, SelectCalls, ShowCalls;
        public ClashTarget LastTarget;
        public int FakeUnsupported;
        public string ModelStamp = "s1";

        /// <summary>Загварт одоо clash үүсгэж буй хосууд (A түлхүүр, B түлхүүр).</summary>
        public List<string[]> Model = new List<string[]>();
        /// <summary>Загвараас устсан элементүүд.</summary>
        public HashSet<string> Deleted = new HashSet<string>();

        public FakeClashSession()
        {
            Rules = new ClashRulesFile { Rules = ClashRuleLogic.Starters(), StartersSeeded = true };
            Rules.LastRuleId = Rules.Rules[0].Id;
            for (int i = 1; i <= 6; i++) Model.Add(new[] { "pipe-" + i, "beam-" + (i % 3 + 1) });
        }

        public void SaveRules() { SaveRulesCount++; }

        public ClashState LoadState()
        {
            lock (State) { return SmartJson.Deserialize<ClashState>(SmartJson.Serialize(State)); }
        }

        public bool UpdateState(Action<ClashState> mutate, out string error)
        {
            error = null;
            lock (State) { mutate(State); }
            return true;
        }

        public Task<IReadOnlyList<CategoryInfo>> GetCategoriesAsync(CancellationToken ct)
        {
            return Task.FromResult<IReadOnlyList<CategoryInfo>>(new List<CategoryInfo>
            {
                new CategoryInfo { Id = "OST_PipeCurves", Name = "Хоолой" },
                new CategoryInfo { Id = "OST_DuctCurves", Name = "Агааржуулалтын хоолой" },
                new CategoryInfo { Id = "OST_StructuralFraming", Name = "Дам нуруу" },
                new CategoryInfo { Id = "OST_Walls", Name = "Хана" },
            });
        }

        private static ElementKey Key(string k) { return ElementKey.Host("doc", k); }

        private static ClashElementInfo Info(string k, string cat, int id)
        {
            return new ClashElementInfo { Key = Key(k).ToString(), Category = cat, Family = cat + " family", Type = cat + " 100", Level = "Level " + (id % 2 + 1), IdValue = id };
        }

        public async Task<ClashRunOutcome> RunAsync(ClashRule rule, IProgress<JobProgress> progress, CancellationToken ct)
        {
            string hash = ClashRuleLogic.SemanticHash(rule);
            var run = new ClashRunRecord { RuleId = rule.Id, RuleName = rule.Name, RuleHash = hash, StartedUtc = DateTime.UtcNow, ModelStamp = ModelStamp };
            var detected = new List<DetectedClash>();
            bool cancelled = false;
            try
            {
                if (DelayMs > 0) await Task.Delay(DelayMs, ct); else await Task.Yield();
                progress.Report(JobProgress.Of("verify", 3, 6, "Геометр шалгаж байна"));
                int n = 0;
                foreach (string[] pair in Model)
                {
                    ct.ThrowIfCancellationRequested();
                    if (Deleted.Contains(pair[0]) || Deleted.Contains(pair[1])) continue;
                    n++;
                    detected.Add(new DetectedClash
                    {
                        Fingerprint = ClashRuleLogic.Fingerprint(rule.Id, hash, Key(pair[0]), Key(pair[1])),
                        A = Info(pair[0], "Pipes", 100 + n),
                        B = Info(pair[1], "Beams", 200 + n),
                        VolumeCm3 = 50 + n * 25.5,
                        Point = new[] { 1000.0 * n, 2000.0, 3000.0 },
                        Level = "Level " + (n % 2 + 1),
                    });
                }
            }
            catch (OperationCanceledException) { cancelled = true; }

            ReconcileResult rec;
            lock (State)
            {
                var input = new ReconcileInput
                {
                    RuleId = rule.Id, RuleName = rule.Name, RuleHash = hash, Severity = rule.Severity, Detected = detected,
                    RunComplete = !cancelled,
                    StateOf = i => Deleted.Contains(i.A.ElementKey.Uid) || Deleted.Contains(i.B.ElementKey.Uid) ? PairState.ElementMissing : PairState.NotEvaluated,
                };
                rec = ClashReconciler.Reconcile(State.Issues, input, DateTime.UtcNow);
                State.Issues = rec.Issues;
                run.EndedUtc = DateTime.UtcNow;
                run.Status = cancelled ? RunStatus.Cancelled : RunStatus.Succeeded;
                run.ACount = 6; run.BCount = 3; run.Candidates = Model.Count + 4; run.Confirmed = detected.Count;
                run.NoClash = 4; run.Unsupported = FakeUnsupported;
                run.New = rec.New; run.Resolved = rec.Resolved; run.Reappeared = rec.Reappeared;
                run.StageMs["verify"] = 120;
                if (FakeUnsupported > 0) run.Notes.Add("⚠ " + FakeUnsupported + " хосыг шалгах боломжгүй — «clash биш» гэж ТООЦООГҮЙ.");
                State.Runs.Insert(0, run);
            }
            if (cancelled) throw new OperationCanceledException(ct);
            return new ClashRunOutcome { Run = run, New = rec.New, Resolved = rec.Resolved, Reappeared = rec.Reappeared, Unverified = rec.Unverified };
        }

        public Task<SelectOutcome> SelectAsync(ClashIssue issue, ClashTarget target, CancellationToken ct)
        {
            SelectCalls++;
            LastTarget = target;
            return Task.FromResult(new SelectOutcome { Requested = 1, Applied = 1, Message = "1 элемент сонгов." });
        }

        public Task<SelectOutcome> ShowAsync(ClashIssue issue, CancellationToken ct)
        {
            ShowCalls++;
            return Task.FromResult(new SelectOutcome { Requested = 2, Applied = 2, Message = "Харууллаа (clash руу ойртуулав)." });
        }

        public bool IsStale(ClashRunRecord lastRun) { return Stale; }
    }

    public static class ClashSmoke
    {
        private static void WaitUntil(Func<bool> cond, string what, int ms = 5000)
        {
            var until = DateTime.UtcNow.AddMilliseconds(ms);
            while (!cond())
            {
                if (DateTime.UtcNow > until) throw new SmokeFailed("хугацаа дууслаа: " + what);
                Ui.Wait(30);
            }
        }

        private static Button Btn(DependencyObject root, string exact)
        {
            Button b = Ui.All<Button>(root).FirstOrDefault(x => (x.Content as string) == exact);
            if (b == null) throw new SmokeFailed("Товч олдсонгүй: «" + exact + "»");
            return b;
        }

        private static CheckBox Chip(DependencyObject root, string startsWith)
        {
            CheckBox c = Ui.All<CheckBox>(root).FirstOrDefault(x => x.Content is string && ((string)x.Content).StartsWith(startsWith));
            if (c == null) throw new SmokeFailed("Checkbox олдсонгүй: «" + startsWith + "»");
            return c;
        }

        private static DataGrid Grid(DependencyObject root)
        {
            DataGrid g = Ui.All<DataGrid>(root).FirstOrDefault();
            if (g == null) throw new SmokeFailed("DataGrid олдсонгүй");
            return g;
        }

        private static List<ClashWindow.IssueRow> Rows(DependencyObject root)
        {
            return Grid(root).Items.OfType<ClashWindow.IssueRow>().ToList();
        }

        private static void Click(Button b)
        {
            Ui.Click(b);
        }

        private static ClashWindow OpenWindow(FakeClashSession s)
        {
            var w = new ClashWindow(s);
            Ui.Open(w);
            return w;
        }

        private static void RunOnce(ClashWindow w, int expectRows)
        {
            Click(Btn(w, "Шалгах"));
            WaitUntil(() => Rows(w).Count == expectRows, "clash жагсаалт " + expectRows + ": " + Rows(w).Count);
        }

        public static void Window_Opens_ShowsStarterRules_AndNoIssuesYet()
        {
            var s = new FakeClashSession();
            var w = OpenWindow(s);
            try
            {
                ComboBox rules = Ui.All<ComboBox>(w).First(c => c.MinWidth == 320);
                Ui.Eq(5, rules.Items.Count, "эхний 5 дүрэм");
                Ui.Eq(0, Rows(w).Count, "хараахан clash байхгүй");
                Ui.True(Ui.AllText(w).Contains("хараахан шалгаагүй"), "эхний мэдэгдэл: " + Ui.AllText(w));
                Ui.Shot(w, "clash-main-empty");
            }
            finally { w.Close(); }
        }

        public static void Run_ListsConfirmedClashes_WithSummary()
        {
            var s = new FakeClashSession();
            var w = OpenWindow(s);
            try
            {
                RunOnce(w, 6);
                string text = Ui.AllText(w);
                Ui.True(text.Contains("баталгаажсан 6"), "хураангуй: " + text);
                Ui.True(text.Contains("шинэ 6"), "шинэ тоо: " + text);
                ClashWindow.IssueRow first = Rows(w)[0];
                Ui.True(first.A.Contains("Pipes") && first.B.Contains("Beams"), "A/B шошго");
                Ui.Eq("Ноцтой", first.Severity, "эхний дүрэм Critical");
                Ui.True(Chip(w, "Шинэ").Content.ToString().Contains("(6)"), "chip тоо: " + Chip(w, "Шинэ").Content);
                Ui.Shot(w, "clash-result");
            }
            finally { w.Close(); }
        }

        public static void Unsupported_IsShownSeparately_NeverAsNoClash()
        {
            var s = new FakeClashSession { FakeUnsupported = 3 };
            var w = OpenWindow(s);
            try
            {
                RunOnce(w, 6);
                string text = Ui.AllText(w);
                Ui.True(text.Contains("дэмжигдээгүй 3"), "дэмжигдээгүй тоо: " + text);
                Ui.True(text.Contains("«clash биш» гэж ТООЦООГҮЙ"), "тайлбар: " + text);
            }
            finally { w.Close(); }
        }

        public static void Accept_Persists_AndSurvivesRerun_AsAccepted()
        {
            var s = new FakeClashSession();
            var w = OpenWindow(s);
            try
            {
                RunOnce(w, 6);
                Grid(w).SelectedIndex = 0;
                Ui.Pump();
                string fp = Rows(w)[0].Issue.Fingerprint;
                Click(Btn(w, "Зөвшөөрсөн"));
                WaitUntil(() => s.State.Issues.Any(i => i.Fingerprint == fp && i.Status == ClashStatus.Accepted), "Accepted хадгалагдах");
                Ui.True(Ui.AllText(w).Contains("«Зөвшөөрсөн» боллоо"), "мэдэгдэл: " + Ui.AllText(w));

                // Дахин шалгалт: ижил хос — төлөв хэвээр.
                Click(Btn(w, "Шалгах"));
                WaitUntil(() => s.State.Runs.Count == 2 && s.State.Runs[0].EndedUtc.HasValue, "2-р шалгалт");
                Ui.Pump();
                ClashIssue after = s.State.Issues.Single(i => i.Fingerprint == fp);
                Ui.Eq(ClashStatus.Accepted, after.Status, "Accepted дахин New болохгүй");
                Ui.Eq(2, after.TimesSeen, "хоёр удаа харагдсан");
                Ui.Eq(6, s.State.Issues.Count, "шинэ issue үүсээгүй");
                Ui.Shot(w, "clash-accepted");
            }
            finally { w.Close(); }
        }

        public static void Resolved_OnlyWithEvidence_AndNotEditable()
        {
            var s = new FakeClashSession();
            var w = OpenWindow(s);
            try
            {
                RunOnce(w, 6);
                string gone = s.Model[0][0];
                s.Deleted.Add(gone);
                Click(Btn(w, "Шалгах"));
                WaitUntil(() => s.State.Runs.Count == 2 && s.State.Issues.Count(i => i.Status == ClashStatus.Resolved) == 1, "Resolved болох");
                ClashIssue resolved = s.State.Issues.Single(i => i.Status == ClashStatus.Resolved);
                Ui.Eq("deleted", resolved.History.Last().Reason, "шалтгаан: элемент устсан");
                WaitUntil(() => Rows(w).Count == 5, "Шийдэгдсэн анхдагчаар нуугдана");

                Chip(w, "Шийдэгдсэн").IsChecked = true;
                WaitUntil(() => Rows(w).Count == 6, "Шийдэгдсэн харуулах");
                ClashWindow.IssueRow row = Rows(w).Single(r => r.Issue.Status == ClashStatus.Resolved);
                Grid(w).SelectedItem = row;
                Ui.Pump();
                Ui.True(!Btn(w, "Зөвшөөрсөн").IsEnabled, "Шийдэгдсэн clash-ийн төлөв гараар өөрчлөгдөхгүй");
                Ui.Shot(w, "clash-resolved");
            }
            finally { w.Close(); }
        }

        public static void FilterBySearch_AndStatus()
        {
            var s = new FakeClashSession();
            var w = OpenWindow(s);
            try
            {
                RunOnce(w, 6);
                // 2 clash-ийг «Хянасан» болгоно.
                Grid(w).SelectedItems.Add(Rows(w)[0]);
                Grid(w).SelectedItems.Add(Rows(w)[1]);
                Ui.Pump();
                Click(Btn(w, "Хянасан"));
                WaitUntil(() => s.State.Issues.Count(i => i.Status == ClashStatus.Reviewed) == 2, "2 хянасан");
                Chip(w, "Шинэ").IsChecked = false;
                WaitUntil(() => Rows(w).Count == 2, "зөвхөн хянасан харагдах");
                Chip(w, "Шинэ").IsChecked = true;
                WaitUntil(() => Rows(w).Count == 6, "бүгд");

                TextBox search = Ui.All<TextBox>(w).First(t => t.MinWidth == 180);
                search.Text = "Pipes · Pipes 100 · 101";
                WaitUntil(() => Rows(w).Count == 0 || Rows(w).Count == 1, "хайлт");
                search.Text = "zzzz-байхгүй";
                WaitUntil(() => Rows(w).Count == 0, "хоосон хайлт");
                search.Text = "";
                WaitUntil(() => Rows(w).Count == 6, "хайлт цэвэрлэх");
            }
            finally { w.Close(); }
        }

        public static void Cancel_StopsRun_AndResolvesNothing()
        {
            var s = new FakeClashSession();
            var w = OpenWindow(s);
            try
            {
                RunOnce(w, 6);
                s.Deleted.Add(s.Model[0][0]);     // нотолгоотой «шийдэгдэх» боломжтой байсан
                s.DelayMs = 3000;
                Click(Btn(w, "Шалгах"));
                Click(Btn(w, "Зогсоох"));
                WaitUntil(() => Ui.AllText(w).Contains("зогсоосон"), "зогсолтын мэдэгдэл");
                Ui.True(Btn(w, "Шалгах").IsEnabled, "зогссоны дараа «Шалгах» идэвхжих ёстой");
                Ui.Eq(0, s.State.Issues.Count(i => i.Status == ClashStatus.Resolved), "цуцлагдсан гүйлт юуг ч «Resolved» болгохгүй");
                Ui.True(Ui.AllText(w).Contains("ЮУ Ч «шийдэгдсэн» болгоогүй"), "нөхцөлийн тайлбар");
            }
            finally { w.Close(); }
        }

        public static void Select_And_Show_CallSession_WithTarget()
        {
            var s = new FakeClashSession();
            var w = OpenWindow(s);
            try
            {
                RunOnce(w, 6);
                Grid(w).SelectedIndex = 0;
                Ui.Pump();
                Click(Btn(w, "B сонгох"));
                WaitUntil(() => s.SelectCalls == 1, "сонгох дуудагдах");
                Ui.Eq(ClashTarget.B, s.LastTarget, "B зорилт");
                Click(Btn(w, "Хоёуланг сонгох"));
                WaitUntil(() => s.SelectCalls == 2 && s.LastTarget == ClashTarget.Both, "хоёуланг");
                Click(Btn(w, "Харуулах (ойртуулах)"));
                WaitUntil(() => s.ShowCalls == 1, "харуулах дуудагдах");
                WaitUntil(() => Ui.AllText(w).Contains("clash руу ойртуулав"), "үр дүн харагдах");
            }
            finally { w.Close(); }
        }

        public static void StaleBadge_AppearsWhenModelChanged()
        {
            var s = new FakeClashSession();
            var w = OpenWindow(s);
            try
            {
                RunOnce(w, 6);
                Ui.True(!Ui.AllText(w).Contains("хуучирсан"), "эхлээд хуучирсан биш");
                s.Stale = true;
                WaitUntil(() => Ui.AllText(w).Contains("хуучирсан"), "хуучирсан тэмдэг", 4000);
                Ui.Shot(w, "clash-stale");
            }
            finally { w.Close(); }
        }

        public static void Validation_Blocks_RunWithoutCategories()
        {
            var s = new FakeClashSession();
            s.Rules.Rules.Clear();
            s.Rules.Rules.Add(new ClashRule { Name = "Хоосон дүрэм" });
            s.Rules.LastRuleId = s.Rules.Rules[0].Id;
            var w = OpenWindow(s);
            try
            {
                Click(Btn(w, "Шалгах"));
                Ui.True(Ui.AllText(w).Contains("ядаж нэг ангилал"), "баталгаажуулалт: " + Ui.AllText(w));
                Ui.Eq(0, s.State.Runs.Count, "шалгалт эхлээгүй");
            }
            finally { w.Close(); }
        }

        public static void RuleDialog_Clearance_IsDisabled_AndOkNeedsCategories()
        {
            var cats = new List<CategoryInfo>
            {
                new CategoryInfo { Id = "OST_PipeCurves", Name = "Хоолой" },
                new CategoryInfo { Id = "OST_StructuralFraming", Name = "Дам нуруу" },
            };
            var rule = new ClashRule { Name = "Шинэ" };
            var dlg = new ClashRuleDialog(null, rule, cats, false);
            Ui.RunModal(dlg, () =>
            {
                ComboBox mode = Ui.All<ComboBox>(dlg).First(c => c.Items.Count == 2 && c.Items[1] is ComboBoxItem);
                Ui.True(!((ComboBoxItem)mode.Items[1]).IsEnabled, "Clearance сонголт идэвхгүй байх ёстой");
                Ui.True(Ui.AllText(dlg).Contains("хэрэгжээгүй"), "Clearance тайлбар");
                Button ok = Btn(dlg, "Хадгалах");
                Ui.True(!ok.IsEnabled, "ангилалгүй бол «Хадгалах» идэвхгүй");
                Ui.True(Ui.AllText(dlg).Contains("ядаж нэг ангилал"), "алдааны мэдэгдэл");

                // Хоёр талд ангилал сонгоно (A: Хоолой, B: Дам нуруу).  Тал бүрийг GroupBox-ийн гарчгаар олно.
                GroupBox sideA = Ui.All<GroupBox>(dlg).First(g => (g.Header as string) == "A тал");
                GroupBox sideB = Ui.All<GroupBox>(dlg).First(g => (g.Header as string) == "B тал");
                Ui.Eq(2, Ui.All<CheckBox>(sideA).Count(c => c.Tag is string), "A талын ангилал");
                Ui.All<CheckBox>(sideA).First(c => (c.Tag as string) == "OST_PipeCurves").IsChecked = true;
                Ui.All<CheckBox>(sideB).First(c => (c.Tag as string) == "OST_StructuralFraming").IsChecked = true;
                Ui.Pump();
                Ui.True(ok.IsEnabled, "ангилал сонгосны дараа «Хадгалах» идэвхжинэ: " + Ui.AllText(dlg));
                Ui.Shot(dlg, "clash-rule-dialog");
                Ui.Click(ok);
            });
            Ui.True(dlg.Result != null, "дүрэм хадгалагдсан");
            Ui.Eq("OST_PipeCurves", dlg.Result.A.Categories.Single(), "A ангилал");
            Ui.Eq("OST_StructuralFraming", dlg.Result.B.Categories.Single(), "B ангилал");
            Ui.True(!dlg.Result.Symmetric, "A≠B тул симметр биш");
        }

        public static void RuleDialog_Cancel_DoesNotChangeOriginal_AndWarnsOnHashChange()
        {
            var cats = new List<CategoryInfo> { new CategoryInfo { Id = "OST_PipeCurves", Name = "Хоолой" }, new CategoryInfo { Id = "OST_Walls", Name = "Хана" } };
            ClashRule rule = ClashRuleLogic.Starters()[0];
            string before = ClashRuleLogic.SemanticHash(rule);
            var dlg = new ClashRuleDialog(null, rule, cats, true);
            Ui.RunModal(dlg, () =>
            {
                Ui.True(!Ui.AllText(dlg).Contains("ТОХИРГОО"), "өөрчлөөгүй үед анхааруулга байхгүй");
                CheckBox walls = Ui.All<CheckBox>(dlg).Where(c => (c.Tag as string) == "OST_Walls").First();
                walls.IsChecked = true;
                Ui.Pump();
                Ui.True(Ui.AllText(dlg).Contains("ТОХИРГОО"), "тохиргоо өөрчлөгдсөн үед анхааруулга: " + Ui.AllText(dlg));
                Ui.Click(Btn(dlg, "Болих"));
            });
            Ui.True(dlg.Result == null, "Болих → үр дүн null");
            Ui.Eq(before, ClashRuleLogic.SemanticHash(rule), "эх дүрэм хөндөгдөөгүй");
        }

        public static void RuleDialog_UnknownCategory_IsKept_NotSilentlyDropped()
        {
            var cats = new List<CategoryInfo> { new CategoryInfo { Id = "OST_PipeCurves", Name = "Хоолой" } };
            var rule = new ClashRule { Name = "X", A = new ClashSelector { Categories = { "OST_PipeCurves", "OST_FutureThing" } }, B = new ClashSelector { Categories = { "OST_PipeCurves" } } };
            var dlg = new ClashRuleDialog(null, rule, cats, true);
            Ui.RunModal(dlg, () =>
            {
                Ui.True(Ui.AllText(dlg).Contains("жагсаалтад алга") || Ui.All<CheckBox>(dlg).Any(c => c.Content is string && ((string)c.Content).Contains("жагсаалтад алга")),
                    "танигдаагүй ангилал харагдах ёстой");
                Ui.Click(Btn(dlg, "Хадгалах"));
            });
            Ui.True(dlg.Result != null && dlg.Result.A.Categories.Contains("OST_FutureThing"), "танигдаагүй ангилал хадгалагдсан хэвээр");
        }

        /// <summary>Товч дарахад нээгдэх МОДАЛЬ дүрмийн диалогийг `script`-ээр удирдана (диалог өөрийгөө хаах ёстой).</summary>
        private static void ClickWithDialog(Button b, Action<ClashRuleDialog> script)
        {
            Exception err = null;
            bool handled = false;
            var timer = new System.Windows.Threading.DispatcherTimer { Interval = TimeSpan.FromMilliseconds(40) };
            timer.Tick += (s, e) =>
            {
                ClashRuleDialog dlg = Application.Current.Windows.OfType<ClashRuleDialog>().FirstOrDefault(d => d.IsVisible);
                if (dlg == null) return;
                timer.Stop();
                handled = true;
                try { script(dlg); }
                catch (Exception ex)
                {
                    err = ex;
                    try { dlg.DialogResult = false; } catch (Exception) { dlg.Close(); }
                }
            };
            timer.Start();
            Ui.Click(b);
            timer.Stop();
            if (err != null) throw err;
            if (!handled) throw new SmokeFailed("Дүрмийн диалог нээгдсэнгүй");
        }

        public static void CopyRule_ViaDialog_AddsRule_AndSelectsIt()
        {
            var s = new FakeClashSession();
            var w = OpenWindow(s);
            try
            {
                Ui.Wait(150);
                int before = s.Rules.Rules.Count;
                ClashRule src = s.Rules.Rules[0];
                ClickWithDialog(Btn(w, "Хуулах"), dlg => Ui.Click(Btn(dlg, "Хадгалах")));
                Ui.Eq(before + 1, s.Rules.Rules.Count, "хуулбар нэмэгдсэн");
                ClashRule copy = s.Rules.Rules.Last();
                Ui.True(copy.Id != src.Id, "шинэ id");
                Ui.True(copy.Name.Contains("хуулбар"), "нэр: " + copy.Name);
                Ui.Eq(copy.Id, s.Rules.LastRuleId, "хуулбар сонгогдсон");
                Ui.True(s.SaveRulesCount >= 1, "SaveRules дуудагдаагүй");
                Ui.Eq(ClashRuleLogic.SemanticHash(src), ClashRuleLogic.SemanticHash(copy), "хуулбар ижил тохиргоотой");
            }
            finally { w.Close(); }
        }

        public static void EditRule_ChangingSemantics_MovesOldIssuesToHistory()
        {
            var s = new FakeClashSession();
            var w = OpenWindow(s);
            try
            {
                Ui.Wait(150);
                RunOnce(w, 6);

                // Дүрмийн тохиргоог өөрчилнө: A талд «Хана» нэмнэ → hash өөр.
                ClickWithDialog(Btn(w, "Засах"), dlg =>
                {
                    CheckBox walls = Ui.All<CheckBox>(dlg).First(c => (c.Tag as string) == "OST_Walls");
                    walls.IsChecked = true;
                    Ui.Pump();
                    Ui.True(Ui.AllText(dlg).Contains("ТОХИРГОО"), "өөрчлөлтийн анхааруулга");
                    Ui.Click(Btn(dlg, "Хадгалах"));
                });

                WaitUntil(() => Rows(w).Count == 0, "хуучин тохиргооны clash анхдагчаар нуугдах: " + Rows(w).Count);
                Chip(w, "Хуучин тохиргоо").IsChecked = true;
                WaitUntil(() => Rows(w).Count == 6, "түүх харагдах");
                Ui.True(Rows(w).All(r => r.Status.Contains("хуучин тохиргоо")), "«хуучин тохиргоо» тэмдэг: " + Rows(w)[0].Status);
                Ui.Eq(6, s.State.Issues.Count(i => i.Status == ClashStatus.New), "хуучин issue-ууд хөндөгдөөгүй (Resolved болоогүй)");
                Ui.Shot(w, "clash-old-config-history");
            }
            finally { w.Close(); }
        }
    }
}
