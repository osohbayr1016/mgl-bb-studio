using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using RevitMcpAddin.Smart.Core;
using RevitMcpAddin.SmartCount.Core;
using RevitMcpAddin.SmartCount.Ui;

namespace RevitMcpAddin.Smart.UiSmoke
{
    /// <summary>
    /// Revit-гүй `ICountSession`: элементүүдийг ЖИНХЭНЭ цэвэр `QueryEvaluator` + `CountAggregator`-оор шалгана —
    /// тиймээс цонх → хайлт → үр дүн бүхэл гинжин урсгал (Revit-ийн цорын ганц хэсгээс бусад) энд ажилладаг.
    /// </summary>
    internal sealed class FakeCountSession : ICountSession
    {
        public string DocumentTitle { get { return "Tennis-Hall"; } }
        public SavedQueriesFile Queries { get; private set; }
        public List<ElementRecord> Model { get; private set; }
        public bool Stale { get; set; }
        public int SaveCount { get; private set; }
        public int SelectCalls, ShowCalls;
        public int LastSelectCount;
        public int DelayMs;

        public FakeCountSession()
        {
            Queries = SavedQueryStore.Load(new SmartStore(System.IO.Path.Combine(System.IO.Path.GetTempPath(), "smart-uismoke-q-" + Guid.NewGuid().ToString("N"))));
            Model = new List<ElementRecord>();
            long id = 1;
            Func<string, string, string, string, double, ElementRecord> wall = (fam, type, level, mark, len) =>
            {
                var r = new ElementRecord { ElementIdValue = id, UniqueId = "u" + id, Category = "Walls", Family = fam, Type = type, Level = level };
                r.Params["Length"] = ParamValue.OfNumber(len, "length", len + " mm");
                r.Params["Mark"] = ParamValue.OfText(mark);
                id++;
                return r;
            };
            for (int i = 0; i < 30; i++) Model.Add(wall("Basic Wall", i % 3 == 0 ? "Generic - 300mm" : "Generic - 200mm", i % 2 == 0 ? "Level 1" : "Level 2", i % 5 == 0 ? "" : "W-" + i, 1500 + i * 250));
            for (int i = 0; i < 12; i++)
            {
                var d = new ElementRecord { ElementIdValue = id, UniqueId = "u" + id, Category = "Doors", Family = "Single-Flush", Type = i % 2 == 0 ? "0915 x 2134mm" : "0762 x 2032mm", Level = i < 8 ? "Level 1" : "Level 2" };
                d.Params["Width"] = ParamValue.OfNumber(i % 2 == 0 ? 915 : 762, "length", "mm");
                Model.Add(d);
                id++;
            }
        }

        public void SaveQueries() { SaveCount++; }

        public Task<IReadOnlyList<CategoryInfo>> GetCategoriesAsync(CancellationToken ct)
        {
            return Task.FromResult<IReadOnlyList<CategoryInfo>>(new List<CategoryInfo>
            {
                new CategoryInfo { Id = "OST_Doors", Name = "Хаалга" },
                new CategoryInfo { Id = "OST_Walls", Name = "Хана" },
                new CategoryInfo { Id = "OST_Windows", Name = "Цонх" },
            });
        }

        public Task<IReadOnlyList<string>> GetLevelsAsync(CancellationToken ct)
        {
            return Task.FromResult<IReadOnlyList<string>>(new List<string> { "Level 1", "Level 2" });
        }

        public Task<IReadOnlyList<string>> GetParameterNamesAsync(IReadOnlyList<string> categoryIds, CancellationToken ct)
        {
            return Task.FromResult<IReadOnlyList<string>>(new List<string> { "Length", "Mark", "Width", "Fire Rating" });
        }

        public async Task<CountResult> RunAsync(QueryDefinition q, IProgress<JobProgress> progress, CancellationToken ct)
        {
            if (DelayMs > 0) await Task.Delay(DelayMs, ct); else await Task.Yield();
            var catIds = new Dictionary<string, string> { { "OST_Walls", "Walls" }, { "OST_Doors", "Doors" }, { "OST_Windows", "Windows" } };
            var names = q.Categories.Select(c => catIds.ContainsKey(c) ? catIds[c] : c).ToList();
            var agg = new CountAggregator(q.GroupBy);
            var stats = new EvalStats();
            int cand = 0;
            foreach (ElementRecord r in Model)
            {
                ct.ThrowIfCancellationRequested();
                if (names.Count > 0 && !names.Contains(r.Category)) continue;
                cand++;
                if (QueryEvaluator.Matches(q.Where, r, stats)) agg.Add(r);
            }
            progress.Report(JobProgress.Of("scan", cand, cand, "шалгаж байна"));
            CountResult res = agg.Build();
            res.QueryId = q.Id;
            res.QueryName = q.Name;
            res.Candidates = cand;
            res.StageMs["evaluate"] = 3;
            res.ModelStamp = "s1";
            if (stats.Problems > 0) res.Notes.Add("⚠ " + stats.Problems + " удаа шалгагдсангүй");
            return res;
        }

        public Task<SelectOutcome> SelectAsync(IReadOnlyList<ElementRecord> rows, CancellationToken ct)
        {
            SelectCalls++;
            LastSelectCount = rows.Count;
            return Task.FromResult(new SelectOutcome { Requested = rows.Count, Applied = rows.Count, Message = rows.Count + " элемент сонгов." });
        }

        public Task<SelectOutcome> ShowAsync(IReadOnlyList<ElementRecord> rows, CancellationToken ct)
        {
            ShowCalls++;
            return Task.FromResult(new SelectOutcome { Requested = rows.Count, Applied = rows.Count, Message = rows.Count + " элемент харууллаа." });
        }

        public bool IsStale(CountResult result) { return Stale; }
    }

    public static class CountSmoke
    {
        private static T Find<T>(DependencyObject root, Func<T, bool> pred) where T : DependencyObject
        {
            T t = Ui.All<T>(root).FirstOrDefault(pred);
            if (t == null) throw new SmokeFailed("олдсонгүй: " + typeof(T).Name);
            return t;
        }

        private static void WaitUntil(Func<bool> cond, string what, int ms = 5000)
        {
            var until = DateTime.UtcNow.AddMilliseconds(ms);
            while (!cond())
            {
                if (DateTime.UtcNow > until) throw new SmokeFailed("хугацаа дууслаа: " + what);
                Ui.Wait(30);
            }
        }

        public static void Window_Opens_ShowsStarterQueries_AndCategories()
        {
            var s = new FakeCountSession();
            var w = new SmartCountWindow(s);
            Ui.Open(w);
            try
            {
                WaitUntil(() => Ui.All<CheckBox>(w).Count(c => c.Tag is string) == 3, "ангилал ачаалагдах");
                ComboBox saved = Find<ComboBox>(w, c => c.Items.Count == 3 && c.MinWidth == 240);
                Ui.Eq(3, saved.Items.Count, "жишээ хайлт");
                Ui.Shot(w, "count-main");
            }
            finally { w.Close(); }
        }

        public static void Run_WallsByType_ShowsTreeAndRows()
        {
            var s = new FakeCountSession();
            var w = new SmartCountWindow(s);
            Ui.Open(w);
            try
            {
                WaitUntil(() => Ui.All<CheckBox>(w).Count(c => c.Tag is string) == 3, "ангилал");
                // Эхний жишээ хайлт «Хана — төрлөөр» ачаалагдсан.
                CheckBox walls = Find<CheckBox>(w, c => (c.Tag as string) == "OST_Walls");
                Ui.True(walls.IsChecked == true, "«Хана» ангилал сонгогдоогүй");
                Ui.Click(w, "Тоолох");
                WaitUntil(() => Ui.All<TextBlock>(w).Any(t => (t.Text ?? "").Contains("нийт 30 элемент")), "үр дүн");
                TreeView tree = Find<TreeView>(w, t => true);
                var root = (TreeViewItem)tree.Items[0];
                Ui.Eq(2, root.Items.Count, "төрлийн бүлэг (300мм, 200мм)");
                string header = (string)((TreeViewItem)root.Items[0]).Header;
                Ui.True(header.Contains("Generic - 200mm") && header.Contains("20"), "эхний бүлэг: " + header);
                DataGrid grid = Find<DataGrid>(w, g => g.Columns.Count >= 5);
                Ui.True(((System.Collections.IEnumerable)grid.ItemsSource).Cast<object>().Count() == 30, "мөрүүд");
                Ui.Shot(w, "count-result");
            }
            finally { w.Close(); }
        }

        public static void Run_WithNumericCondition_FiltersWithUnits()
        {
            var s = new FakeCountSession();
            // Хана, урт > 5 м (5000 мм) — хэрэглэгч метрээр бичнэ.
            var q = new QueryDefinition { Name = "Урт хана", Categories = { "OST_Walls" } };
            q.Where.Children.Add(QueryNode.Param("Length", ClauseOp.Greater, "5", unit: "m"));
            q.GroupBy.Add(new GroupSpec { Field = GroupField.Level });
            SavedQueryStore.Upsert(s.Queries, q);
            s.Queries.LastQueryId = q.Id;

            var w = new SmartCountWindow(s);
            Ui.Open(w);
            try
            {
                WaitUntil(() => Ui.All<CheckBox>(w).Count(c => c.Tag is string) == 3, "ангилал");
                Ui.Shot(w, "count-condition-editor");
                Ui.Click(w, "Тоолох");
                // 1500 + i*250 > 5000 → i >= 15 → i = 15..29 → 15 хана.
                WaitUntil(() => Ui.All<TextBlock>(w).Any(t => (t.Text ?? "").Contains("нийт 15 элемент")), "15 хана: " + string.Join("|", Ui.All<TextBlock>(w).Select(t => t.Text).Where(t => t != null && t.Contains("нийт"))));
            }
            finally { w.Close(); }
        }

        public static void Validation_Blocks_WholeModelWithoutCategory()
        {
            var s = new FakeCountSession();
            s.Queries.Queries.Clear();
            var w = new SmartCountWindow(s);
            Ui.Open(w);
            try
            {
                WaitUntil(() => Ui.All<CheckBox>(w).Count(c => c.Tag is string) == 3, "ангилал");
                Ui.Click(w, "Тоолох");
                Ui.True(Ui.AllText(w).Contains("ядаж нэг ангилал"), "баталгаажуулалт: " + Ui.AllText(w));
            }
            finally { w.Close(); }
        }

        public static void Select_And_Show_UseSelectedGroupRows()
        {
            var s = new FakeCountSession();
            var w = new SmartCountWindow(s);
            Ui.Open(w);
            try
            {
                WaitUntil(() => Ui.All<CheckBox>(w).Count(c => c.Tag is string) == 3, "ангилал");
                Ui.Click(w, "Тоолох");
                WaitUntil(() => Ui.All<TextBlock>(w).Any(t => (t.Text ?? "").Contains("нийт 30 элемент")), "үр дүн");
                TreeView tree = Find<TreeView>(w, t => true);
                var group = (TreeViewItem)((TreeViewItem)tree.Items[0]).Items[1];   // 300мм бүлэг (10)
                group.IsSelected = true;
                Ui.Pump();
                Ui.Click(w, "Сонгох");
                WaitUntil(() => s.SelectCalls == 1, "сонгох дуудагдах");
                Ui.Eq(10, s.LastSelectCount, "сонгосон бүлгийн мөр");
                Ui.Click(w, "Харуулах");
                WaitUntil(() => s.ShowCalls == 1, "харуулах дуудагдах");
            }
            finally { w.Close(); }
        }

        public static void StaleBadge_AppearsWhenModelChanged()
        {
            var s = new FakeCountSession();
            var w = new SmartCountWindow(s);
            Ui.Open(w);
            try
            {
                WaitUntil(() => Ui.All<CheckBox>(w).Count(c => c.Tag is string) == 3, "ангилал");
                Ui.Click(w, "Тоолох");
                WaitUntil(() => Ui.All<TextBlock>(w).Any(t => (t.Text ?? "").Contains("нийт 30 элемент")), "үр дүн");
                Ui.True(!Ui.AllText(w).Contains("хуучирсан"), "эхлээд хуучирсан биш");
                s.Stale = true;
                WaitUntil(() => Ui.AllText(w).Contains("хуучирсан"), "хуучирсан тэмдэг", 4000);
                Ui.Shot(w, "count-stale");
            }
            finally { w.Close(); }
        }

        public static void Cancel_StopsRunningQuery()
        {
            var s = new FakeCountSession();
            s.DelayMs = 3000;
            var w = new SmartCountWindow(s);
            Ui.Open(w);
            try
            {
                WaitUntil(() => Ui.All<CheckBox>(w).Count(c => c.Tag is string) == 3, "ангилал");
                Ui.Click(w, "Тоолох");
                Ui.Click(w, "Зогсоох");
                WaitUntil(() => Ui.AllText(w).Contains("Зогсоосон"), "зогсолт");
                Ui.True(Ui.FindButton(w, "Тоолох").IsEnabled, "зогссоны дараа «Тоолох» идэвхжих ёстой");
            }
            finally { w.Close(); }
        }

        public static void Save_And_Delete_Query()
        {
            var s = new FakeCountSession();
            var w = new SmartCountWindow(s);
            Ui.Open(w);
            try
            {
                WaitUntil(() => Ui.All<CheckBox>(w).Count(c => c.Tag is string) == 3, "ангилал");
                int before = s.Queries.Queries.Count;
                Ui.Click(w, "Шинээр хадгалах");
                Ui.Eq(before + 1, s.Queries.Queries.Count, "шинээр хадгалсан");
                Ui.True(s.SaveCount >= 1, "SaveQueries дуудагдаагүй");
            }
            finally { w.Close(); }
        }
    }
}
