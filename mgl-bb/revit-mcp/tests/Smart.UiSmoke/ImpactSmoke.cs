using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using RevitMcpAddin.ChangeImpact.Core;
using RevitMcpAddin.ChangeImpact.Ui;
using RevitMcpAddin.Smart.Core;

namespace RevitMcpAddin.Smart.UiSmoke
{
    /// <summary>
    /// Revit-гүй `IImpactSession`: бодит `ImpactGraphBuilder`-ээр хуурамч загварын холбооноос граф байгуулж тайлан гаргана —
    /// цонх → шинжилгээ → итгэлээр шүүх → «яагаад» тайлбар бүхэл гинж (Revit-ийн холбоо унших хэсгээс бусад) энд ажиллана.
    /// </summary>
    internal sealed class FakeImpactSession : IImpactSession
    {
        public string DocumentTitle { get { return "Tennis-Hall"; } }
        public bool TrackingEnabled { get; set; }
        public int DroppedBatches { get; set; }
        public List<ChangeBatch> Batches = new List<ChangeBatch>();
        public List<ModelCheckpoint> Cps = new List<ModelCheckpoint>();
        public ImpactReport Last;
        public List<ImpactReportHeader> Hist = new List<ImpactReportHeader>();
        public ImpactRequest LastRequest;
        public int ShowCalls, AnalyzeCalls, ClearCalls;
        public ImpactItem LastShown;
        public bool Stale;
        public int DelayMs;
        public bool MakeIncomplete;

        // Хуурамч загвар: id → зангилаа.
        private static readonly Dictionary<long, ImpactNode> Nodes = new Dictionary<long, ImpactNode>
        {
            { 1001, new ImpactNode { Id = 1001, Kind = ImpactNodeKind.Element, Category = "Detail Lines", Name = "Detail Line", OwnerViewId = 2001, ViewSpecific = true } },
            { 1002, new ImpactNode { Id = 1002, Kind = ImpactNodeKind.Element, Category = "Walls", Name = "Basic Wall 200" } },
            { 1003, new ImpactNode { Id = 1003, Kind = ImpactNodeKind.Element, Category = "Doors", Name = "Single-Flush : 0915", HostId = 1002 } },
            { 2001, new ImpactNode { Id = 2001, Kind = ImpactNodeKind.View, Name = "Plan L1", Detail = "FloorPlan" } },
            { 2002, new ImpactNode { Id = 2002, Kind = ImpactNodeKind.View, Name = "Section 1", Detail = "Section" } },
            { 3001, new ImpactNode { Id = 3001, Kind = ImpactNodeKind.Sheet, Name = "A-101 Ground floor plan", Detail = "Хуудас A-101" } },
            { 3002, new ImpactNode { Id = 3002, Kind = ImpactNodeKind.Sheet, Name = "A-201 Sections", Detail = "Хуудас A-201" } },
            { 4001, new ImpactNode { Id = 4001, Kind = ImpactNodeKind.Room, Category = "Rooms", Name = "101 Hall" } },
            { 4002, new ImpactNode { Id = 4002, Kind = ImpactNodeKind.Tag, Category = "Room Tags", Name = "Room Tag", OwnerViewId = 2001, ViewSpecific = true } },
            { 5001, new ImpactNode { Id = 5001, Kind = ImpactNodeKind.Schedule, Name = "Door schedule" } },
        };

        private static ImpactEdge E(long a, long b, ImpactConfidence c, string rel, string reason)
        {
            return new ImpactEdge { From = a, To = b, Confidence = c, Relationship = rel, Reason = reason, Resolver = "fake" };
        }

        private static readonly ImpactEdge[] Edges =
        {
            E(1001, 2001, ImpactConfidence.A, "view_owner", "«Detail Line» зөвхөн «Plan L1» харагдацад хамаарна (view-specific)"),
            E(2001, 3001, ImpactConfidence.A, "viewport_sheet", "«Plan L1» харагдац «A-101» хуудсанд байрласан"),
            E(1002, 1003, ImpactConfidence.B, "host_hosted", "«Basic Wall 200» хост дээр хостолсон элемент"),
            E(1002, 4001, ImpactConfidence.B, "room_boundary", "«Basic Wall 200» нь «101 Hall» өрөөний хилийг үүсгэнэ"),
            E(4001, 4002, ImpactConfidence.B, "tag_host", "«101 Hall»-ийг тэмдэглэсэн tag"),
            E(4002, 2001, ImpactConfidence.A, "view_owner", "«Room Tag» зөвхөн «Plan L1» харагдацад хамаарна (view-specific)"),
            E(1002, 2002, ImpactConfidence.C, "visibility", "«Basic Wall 200» нь «Section 1» харагдацад магадгүй харагдана (Revit-ийн харагдацын шүүлтүүр; crop/нуугдсан/хаагдсан байж болно)"),
            E(2002, 3002, ImpactConfidence.A, "viewport_sheet", "«Section 1» харагдац «A-201» хуудсанд байрласан"),
            E(1003, 5001, ImpactConfidence.C, "schedule_membership", "«Single-Flush» нь «Door schedule» хүснэгтийн мөрөнд орсон (аль параметр харагдахыг мэдэхгүй)"),
        };

        public FakeImpactSession()
        {
            TrackingEnabled = true;
            DateTime t0 = new DateTime(2026, 10, 1, 9, 0, 0, DateTimeKind.Utc);
            Batches.Add(Batch(100, t0, "Move wall", ChangeKind.Modified, 1002));
            Batches.Add(Batch(200, t0.AddMinutes(5), "Edit detail", ChangeKind.Modified, 1001));
            Batches.Add(Batch(300, t0.AddMinutes(9), "Delete door", ChangeKind.Deleted, 1003));
            Cps.Add(new ModelCheckpoint { Id = "cp1", Label = "Өглөөний гаргалт", Kind = "publish", Utc = t0.AddMinutes(2), ChangeSeq = 150, VersionGuid = Guid.NewGuid().ToString() });
        }

        private static ChangeBatch Batch(long seq, DateTime utc, string tx, ChangeKind kind, long id)
        {
            ImpactNode n = Nodes[id];
            var b = new ChangeBatch { Seq = seq, Utc = utc, Operation = "TransactionCommitted", Resolved = true, Transactions = { tx } };
            if (kind == ChangeKind.Deleted) b.Deleted = 1; else b.Modified = 1;
            b.Entries.Add(new ChangeEntry { Id = id, Kind = kind, Known = true, Category = n.Category, Name = n.Name, NodeKind = n.Kind, OwnerViewId = n.OwnerViewId, HostId = n.HostId });
            return b;
        }

        public Task<IReadOnlyList<ChangeBatch>> GetBatchesAsync(CancellationToken ct)
        {
            return Task.FromResult<IReadOnlyList<ChangeBatch>>(Batches.ToList());
        }

        public IReadOnlyList<ModelCheckpoint> Checkpoints() { return Cps.OrderByDescending(c => c.Utc).ToList(); }

        public Task<ModelCheckpoint> AddCheckpointAsync(string label, CancellationToken ct)
        {
            var cp = new ModelCheckpoint { Label = label, Kind = "user", Utc = DateTime.UtcNow, ChangeSeq = Batches.Max(b => b.Seq), VersionGuid = Guid.NewGuid().ToString() };
            Cps.Add(cp);
            return Task.FromResult(cp);
        }

        public void DeleteCheckpoint(string id) { Cps.RemoveAll(c => c.Id == id); }

        public async Task<ImpactReport> AnalyzeAsync(ImpactRequest request, IProgress<JobProgress> progress, CancellationToken ct)
        {
            AnalyzeCalls++;
            LastRequest = request;
            if (DelayMs > 0) await Task.Delay(DelayMs, ct); else await Task.Yield();
            progress.Report(JobProgress.Of("graph", 1, 2, "Нөлөөллийн граф"));

            var batches = Batches.Where(b => b.Seq > request.FromSeqExclusive && b.Seq <= request.ToSeqInclusive
                && (request.OnlyBatchSeqs == null || request.OnlyBatchSeqs.Contains(b.Seq))).ToList();
            var sources = batches.SelectMany(b => b.Entries).GroupBy(e => e.Id).Select(g => new SourceChange { Id = g.Key, Kind = g.Last().Kind, Seq = 1 }).ToList();

            var look = Edges.ToLookup(e => e.From);
            ImpactGraph g = new ImpactGraphBuilder(sources, id => look[id].Where(e => request.IncludeVisibility || e.Relationship != "visibility").ToList()).RunAll();

            var report = new ImpactReport
            {
                Utc = DateTime.UtcNow, FromSeq = request.FromSeqExclusive, ToSeq = batches.Count > 0 ? batches.Last().Seq : 0, Status = RunStatus.Succeeded,
                SourceCount = sources.Count, Modified = sources.Count(s => s.Kind == ChangeKind.Modified), Deleted = sources.Count(s => s.Kind == ChangeKind.Deleted),
                ModelStamp = "s1", Incomplete = MakeIncomplete,
            };
            report.StageMs["graph"] = 12;
            if (MakeIncomplete) report.Notes.Add("⚠ 1 устсан элементийн мэдээлэл байхгүй — нөлөөллийг тодорхойлж чадаагүй.");
            Func<long, string> label = id => Nodes.ContainsKey(id) ? Nodes[id].Label : "#" + id;
            foreach (ImpactTarget t in g.Targets.Values)
            {
                ImpactNode n = Nodes[t.Id];
                ImpactEdge last = t.Path.Last();
                var item = new ImpactItem
                {
                    Id = n.Id, Kind = n.Kind, Name = n.Name, Detail = n.Detail ?? n.Category, Confidence = t.Confidence, Depth = t.Depth, SourceId = t.SourceId,
                    SourceLabel = label(t.SourceId), SourceChange = sources.First(s => s.Id == t.SourceId).Kind, PathCount = t.PathCount,
                    Relationship = last.Relationship, Reason = last.Reason, Resolver = last.Resolver,
                };
                foreach (ImpactEdge e in t.Path)
                    item.Path.Add(new ImpactPathStepView { FromLabel = label(e.From), ToLabel = label(e.To), Relationship = e.Relationship, Confidence = e.Confidence, Reason = e.Reason, Resolver = e.Resolver });
                report.Items.Add(item);
            }
            report.Items = report.Items.OrderBy(i => ImpactConf.Rank(i.Confidence)).ThenBy(i => i.Kind).ToList();
            Last = report;
            Hist.Insert(0, ImpactReportStore.HeaderOf(report));
            return report;
        }

        public ImpactReport LastReport() { return Last; }
        public IReadOnlyList<ImpactReportHeader> History() { return Hist; }

        public Task<SelectOutcome> ShowAsync(ImpactItem item, CancellationToken ct)
        {
            ShowCalls++;
            LastShown = item;
            return Task.FromResult(new SelectOutcome { Requested = 1, Applied = 1, Message = "«" + item.Name + "» нээгдэж байна." });
        }

        public bool IsStale(ImpactReport report) { return Stale; }

        public Task ClearLogAsync(CancellationToken ct)
        {
            ClearCalls++;
            Batches.Clear();
            return Task.FromResult(0);
        }
    }

    public static class ImpactSmoke
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

        private static DataGrid ResultGrid(DependencyObject root)
        {
            DataGrid g = Ui.All<DataGrid>(root).FirstOrDefault(d => d.SelectionMode == DataGridSelectionMode.Single);
            if (g == null) throw new SmokeFailed("Үр дүнгийн DataGrid олдсонгүй");
            return g;
        }

        private static DataGrid BatchGrid(DependencyObject root)
        {
            DataGrid g = Ui.All<DataGrid>(root).FirstOrDefault(d => d.SelectionMode == DataGridSelectionMode.Extended);
            if (g == null) throw new SmokeFailed("Багцын DataGrid олдсонгүй");
            return g;
        }

        private static List<ChangeImpactWindow.ItemRow> Items(DependencyObject root)
        {
            return ResultGrid(root).Items.OfType<ChangeImpactWindow.ItemRow>().ToList();
        }

        private static List<ChangeImpactWindow.BatchRow> BatchRows(DependencyObject root)
        {
            return BatchGrid(root).Items.OfType<ChangeImpactWindow.BatchRow>().ToList();
        }

        private static ChangeImpactWindow OpenWindow(FakeImpactSession s)
        {
            var w = new ChangeImpactWindow(s);
            Ui.Open(w);
            WaitUntil(() => BatchRows(w).Count > 0, "багцууд ачаалагдах");
            return w;
        }

        private static void Analyze(ChangeImpactWindow w)
        {
            Ui.Click(Btn(w, "Шинжлэх"));
            WaitUntil(() => Ui.AllText(w).Contains("Шинжилгээ ") && Items(w).Count > 0, "шинжилгээний үр дүн");
        }

        public static void Window_Opens_ListsBatches_AndCheckpoints()
        {
            var s = new FakeImpactSession();
            var w = OpenWindow(s);
            try
            {
                Ui.Eq(3, BatchRows(w).Count, "3 багц");
                Ui.True(BatchRows(w)[0].Action.Contains("Delete door"), "хамгийн шинэ нь эхэнд: " + BatchRows(w)[0].Action);
                ComboBox baseline = Ui.All<ComboBox>(w).First(c => c.MinWidth == 300);
                Ui.Eq(2, baseline.Items.Count, "«Бүх бүртгэл» + 1 шалгах цэг");
                Ui.True(Chip(w, "Өөрчлөлт бүртгэх").IsChecked == true, "бүртгэл идэвхтэй");
                Ui.Shot(w, "impact-main");
            }
            finally { w.Close(); }
        }

        public static void Analyze_ShowsItemsWithConfidenceLabels_AndSummary()
        {
            var s = new FakeImpactSession();
            var w = OpenWindow(s);
            try
            {
                Analyze(w);
                string text = Ui.AllText(w);
                Ui.True(text.Contains("3 өөрчилсөн элемент"), "хураангуй: " + text);
                List<ChangeImpactWindow.ItemRow> rows = Items(w);
                ChangeImpactWindow.ItemRow a101 = rows.Single(r => r.Name.StartsWith("A-101"));
                Ui.True(a101.Confidence.StartsWith("A"), "A-101 — шууд (view-specific мөр → харагдац → хуудас): " + a101.Confidence);
                ChangeImpactWindow.ItemRow a201 = rows.Single(r => r.Name.StartsWith("A-201"));
                Ui.True(a201.Confidence.StartsWith("C"), "A-201 — зөвхөн «магадгүй харагдана» (C): " + a201.Confidence);
                Ui.True(a201.Confidence.Contains("Боломжтой"), a201.Confidence);
                Ui.Shot(w, "impact-result");
            }
            finally { w.Close(); }
        }

        public static void Explain_ShowsDirectVsInferredSteps()
        {
            var s = new FakeImpactSession();
            var w = OpenWindow(s);
            try
            {
                Analyze(w);
                ChangeImpactWindow.ItemRow a201 = Items(w).Single(r => r.Name.StartsWith("A-201"));
                ResultGrid(w).SelectedItem = a201;
                Ui.Pump();
                string text = Ui.AllText(w);
                Ui.True(text.Contains("Яагаад?"), "тайлбарын гарчиг");
                Ui.True(text.Contains("[C таамаг]") && text.Contains("[A шууд]"), "шууд ба таамаг алхам ялгагдана: " + text);
                Ui.True(text.Contains("хамгийн сул холбоо"), "хамгийн сул холбоо нэрлэгдэнэ");
                Ui.True(text.Contains("crop"), "C итгэлийн тайлбар (crop/нуугдсан)");
                Ui.Shot(w, "impact-explain");
            }
            finally { w.Close(); }
        }

        public static void ConfidenceChips_FilterRows()
        {
            var s = new FakeImpactSession();
            var w = OpenWindow(s);
            try
            {
                Analyze(w);
                int all = Items(w).Count;
                Chip(w, "C Боломжтой").IsChecked = false;
                WaitUntil(() => Items(w).Count < all && Items(w).All(r => !r.Confidence.StartsWith("C")), "C шүүгдэх");
                Chip(w, "A Шууд").IsChecked = false;
                WaitUntil(() => Items(w).All(r => r.Confidence.StartsWith("B")), "зөвхөн B үлдэх");
                Chip(w, "A Шууд").IsChecked = true;
                Chip(w, "C Боломжтой").IsChecked = true;
                WaitUntil(() => Items(w).Count == all, "бүгд буцах");
            }
            finally { w.Close(); }
        }

        public static void KindFilter_ShowsOnlySheets()
        {
            var s = new FakeImpactSession();
            var w = OpenWindow(s);
            try
            {
                Analyze(w);
                ComboBox kind = Ui.All<ComboBox>(w).First(c => c.MinWidth == 130);
                kind.SelectedIndex = 1;
                WaitUntil(() => Items(w).Count == 2 && Items(w).All(r => r.Kind == "Хуудас"), "зөвхөн хуудсууд: " + Items(w).Count);
            }
            finally { w.Close(); }
        }

        public static void Baseline_FiltersBatches_AndLimitsRequest()
        {
            var s = new FakeImpactSession();
            var w = OpenWindow(s);
            try
            {
                ComboBox baseline = Ui.All<ComboBox>(w).First(c => c.MinWidth == 300);
                baseline.SelectedIndex = 1;               // шалгах цэг (seq 150) — зөвхөн 200, 300 үлдэнэ
                WaitUntil(() => BatchRows(w).Count == 2, "багц шүүгдэх");
                Analyze(w);
                Ui.Eq(150L, s.LastRequest.FromSeqExclusive, "хүсэлтийн эхлэх цэг");
                Ui.True(!string.IsNullOrEmpty(s.LastRequest.BaselineVersionGuid), "Revit хувилбарын GUID дамжина");
                Ui.True(Items(w).All(r => !r.Name.StartsWith("Basic Wall")), "цэгээс өмнөх (хана) өөрчлөлт орохгүй");
            }
            finally { w.Close(); }
        }

        public static void SelectedBatches_AreSentAsExplicitSelection()
        {
            var s = new FakeImpactSession();
            var w = OpenWindow(s);
            try
            {
                var rows = BatchRows(w);
                BatchGrid(w).SelectedItems.Add(rows.Single(r => r.Batch.Seq == 200));
                Ui.Pump();
                Analyze(w);
                Ui.True(s.LastRequest.OnlyBatchSeqs != null && s.LastRequest.OnlyBatchSeqs.Count == 1 && s.LastRequest.OnlyBatchSeqs.Contains(200), "зөвхөн сонгосон багц");
                Ui.Eq(2, Items(w).Count, "detail line → харагдац, хуудас");
            }
            finally { w.Close(); }
        }

        public static void Incomplete_ShowsExplicitWarning()
        {
            var s = new FakeImpactSession { MakeIncomplete = true };
            var w = OpenWindow(s);
            try
            {
                Analyze(w);
                string text = Ui.AllText(w);
                Ui.True(text.Contains("БҮРЭН БИШ"), "бүрэн бус анхааруулга: " + text);
                Ui.True(text.Contains("«нөлөөлөл олдсонгүй» гэдэг нь «нөлөөлөхгүй» гэсэн үг БИШ"), "тайлбар");
                Ui.Shot(w, "impact-incomplete");
            }
            finally { w.Close(); }
        }

        public static void Visibility_Option_IsPassedToRequest()
        {
            var s = new FakeImpactSession();
            var w = OpenWindow(s);
            try
            {
                Chip(w, "Харагдалт").IsChecked = false;
                Analyze(w);
                Ui.True(!s.LastRequest.IncludeVisibility, "харагдалтыг унтраасан");
                Ui.True(Items(w).All(r => !r.Confidence.StartsWith("C") || !r.Name.StartsWith("A-201")), "харагдалтгүйгээр A-201 (C) гарахгүй");
            }
            finally { w.Close(); }
        }

        public static void StaleBadge_AppearsWhenModelChanged()
        {
            var s = new FakeImpactSession();
            var w = OpenWindow(s);
            try
            {
                Analyze(w);
                Ui.True(!Ui.AllText(w).Contains("хуучирсан"), "эхлээд хуучирсан биш");
                s.Stale = true;
                WaitUntil(() => Ui.AllText(w).Contains("хуучирсан"), "хуучирсан тэмдэг", 14000);
            }
            finally { w.Close(); }
        }

        public static void Cancel_StopsAnalysis()
        {
            var s = new FakeImpactSession { DelayMs = 3000 };
            var w = OpenWindow(s);
            try
            {
                Ui.Click(Btn(w, "Шинжлэх"));
                Ui.Click(Btn(w, "Зогсоох"));
                WaitUntil(() => Ui.AllText(w).Contains("Зогсоосон"), "зогсолт");
                Ui.True(Btn(w, "Шинжлэх").IsEnabled, "зогссоны дараа «Шинжлэх» идэвхжих ёстой");
                Ui.True(s.Last == null, "цуцлагдсан шинжилгээ дүн үлдээхгүй");
            }
            finally { w.Close(); }
        }

        public static void Open_CallsSessionWithSelectedItem()
        {
            var s = new FakeImpactSession();
            var w = OpenWindow(s);
            try
            {
                Analyze(w);
                ResultGrid(w).SelectedItem = Items(w).First(r => r.Name.StartsWith("A-101"));
                Ui.Pump();
                Ui.Click(Btn(w, "Харуулах / нээх"));
                WaitUntil(() => s.ShowCalls == 1, "харуулах дуудагдах");
                Ui.Eq(3001L, s.LastShown.Id, "сонгосон мөр");
            }
            finally { w.Close(); }
        }

        public static void TrackingToggle_CallsSession()
        {
            var s = new FakeImpactSession();
            var w = OpenWindow(s);
            try
            {
                Chip(w, "Өөрчлөлт бүртгэх").IsChecked = false;
                Ui.Pump();
                Ui.True(!s.TrackingEnabled, "бүртгэл унтарсан");
                Chip(w, "Өөрчлөлт бүртгэх").IsChecked = true;
                Ui.Pump();
                Ui.True(s.TrackingEnabled, "бүртгэл асав");
            }
            finally { w.Close(); }
        }

        public static void Checkpoint_ViaPrompt_IsAddedAndSelectable()
        {
            var s = new FakeImpactSession();
            var w = OpenWindow(s);
            try
            {
                int before = s.Cps.Count;
                var timer = new System.Windows.Threading.DispatcherTimer { Interval = TimeSpan.FromMilliseconds(40) };
                Exception err = null;
                bool handled = false;
                timer.Tick += (a, b) =>
                {
                    Window dlg = Application.Current.Windows.OfType<Window>().FirstOrDefault(x => x.IsVisible && x.Title == "Шалгах цэг тавих");
                    if (dlg == null) return;
                    timer.Stop();
                    handled = true;
                    try
                    {
                        TextBox box = Ui.All<TextBox>(dlg).First();
                        box.Text = "Тест цэг";
                        Ui.Pump();
                        Ui.Click(Btn(dlg, "Хадгалах"));
                    }
                    catch (Exception ex) { err = ex; dlg.DialogResult = false; }
                };
                timer.Start();
                Ui.Click(Btn(w, "Шалгах цэг тавих…"));
                timer.Stop();
                if (err != null) throw err;
                Ui.True(handled, "prompt нээгдээгүй");
                WaitUntil(() => s.Cps.Count == before + 1, "шалгах цэг нэмэгдэх");
                Ui.Eq("Тест цэг", s.Cps.Last().Label, "нэр");
                ComboBox baseline = Ui.All<ComboBox>(w).First(c => c.MinWidth == 300);
                WaitUntil(() => baseline.Items.Count == 3, "жагсаалтад нэмэгдэх");
            }
            finally { w.Close(); }
        }

        public static void CopyList_PutsTsvOnClipboard()
        {
            var s = new FakeImpactSession();
            var w = OpenWindow(s);
            try
            {
                Analyze(w);
                Ui.Click(Btn(w, "Жагсаалт хуулах"));
                string tsv = Clipboard.GetText();
                Ui.True(tsv.StartsWith("Итгэл\tТөрөл") && tsv.Contains("A-101"), "TSV: " + tsv);
            }
            finally { w.Close(); }
        }

        public static void HistoryDialog_Opens_WithReportsAndCheckpoints()
        {
            var s = new FakeImpactSession();
            var w = OpenWindow(s);
            try
            {
                Analyze(w);
                var dlg = new ImpactHistoryDialog(w, s.History(), s.Checkpoints());
                Ui.RunModal(dlg, () =>
                {
                    string text = string.Join("\n", Ui.All<ListBox>(dlg).SelectMany(l => l.Items.OfType<string>()));
                    Ui.True(text.Contains("3 өөрчлөлт") && text.Contains("Өглөөний гаргалт"), "түүх + шалгах цэг: " + text);
                    Ui.Shot(dlg, "impact-history");
                });
            }
            finally { w.Close(); }
        }
    }
}
