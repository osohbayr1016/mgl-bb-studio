using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Threading;
using RevitMcpAddin.Smart.Core;
using RevitMcpAddin.Smart.Ui;
using RevitMcpAddin.SmartCount.Core;

namespace RevitMcpAddin.SmartCount.Ui
{
    /// <summary>
    /// «Smart Count» — модальгүй цонх.  Revit-ийн төрлийг мэдэхгүй (`ICountSession`); бүх Revit
    /// ажил `await`-аар (UI thread гацахгүй), урт ажил `Цуцлах` товчтой.
    ///
    ///   [Хадгалсан хайлт] → ангилал → нөхцөл (AND/OR, нэг түвшин үүрлэж болно) → бүлэглэлт → [Тоолох]
    ///   → бүлгийн мод + мөрүүд → [Сонгох] [Харуулах] [Хуулах]
    ///
    /// Үр дүн «хуучирсан» (загвар өөрчлөгдсөн) бол улбар шар тэмдэглэгээ гарна — дүн ХЭЗЭЭ Ч чимээгүй
    /// хуучирсан хэвээр харагдахгүй.  Сонголт/харуулалт хэт том бол `CountGuards`-аар хамгаална.
    /// </summary>
    internal sealed class SmartCountWindow : Window
    {
        private readonly ICountSession _s;
        private QueryDefinition _q;
        private CountResult _result;
        private CancellationTokenSource _cts;
        private IReadOnlyList<CategoryInfo> _categories = new List<CategoryInfo>();
        private IReadOnlyList<string> _levels = new List<string>();
        private IReadOnlyList<string> _paramNames = new List<string>();
        private bool _loading;

        private readonly ComboBox _saved = new ComboBox { MinWidth = 240, Margin = new Thickness(2) };
        private readonly TextBox _name = UiKit.Box("", 200);
        private readonly ComboBox _scope;
        private readonly CheckBox _types = UiKit.Check("Төрлийг (family type) тоолох — байрлуулсан элемент биш");
        private readonly TextBox _catFilter = UiKit.Box("", 140);
        private readonly StackPanel _catList = new StackPanel();
        private readonly StackPanel _condHost = new StackPanel();
        private readonly StackPanel _groupHost = new StackPanel();
        private readonly TextBlock _issues = UiKit.Text("", wrap: true);
        private readonly ProgressBar _bar = new ProgressBar { Height = 6, Minimum = 0, Maximum = 1, Margin = new Thickness(2, 4, 2, 4), Visibility = Visibility.Collapsed };
        private readonly Button _runBtn, _stopBtn, _selectBtn, _showBtn, _copyBtn;
        private readonly TextBlock _summary = UiKit.Text("Хайлтаа тохируулаад «Тоолох» дарна уу.", bold: true, wrap: true);
        private readonly TextBlock _stale = UiKit.Text("", brush: UiKit.WarningBrush, wrap: true);
        private readonly TextBlock _notes = UiKit.Text("", brush: UiKit.MutedBrush, wrap: true);
        private readonly TextBlock _status = UiKit.Text("", brush: UiKit.MutedBrush, wrap: true);
        private readonly TreeView _tree = new TreeView { Margin = new Thickness(2) };
        private readonly DataGrid _rowsGrid = new DataGrid
        {
            AutoGenerateColumns = false, IsReadOnly = true, CanUserAddRows = false, Margin = new Thickness(2),
            SelectionMode = DataGridSelectionMode.Extended, HeadersVisibility = DataGridHeadersVisibility.Column,
        };
        private readonly DispatcherTimer _staleTimer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(1500) };

        private static readonly string[] ScopeLabels = { "Бүх загвар", "Идэвхтэй харагдац", "Сонгосон элемент" };
        private static readonly CountScope[] ScopeValues = { CountScope.WholeModel, CountScope.ActiveView, CountScope.Selection };
        private static readonly string[] FieldLabels = { "Ангилал", "Гэр бүл", "Төрөл", "Давхар", "Параметр" };
        private static readonly ClauseField[] FieldValues = { ClauseField.Category, ClauseField.Family, ClauseField.Type, ClauseField.Level, ClauseField.Parameter };
        private static readonly string[] ScopeParamLabels = { "өөрийн/төрлийн", "өөрийн", "төрлийн" };
        private static readonly ParamScope[] ScopeParamValues = { ParamScope.Any, ParamScope.Instance, ParamScope.Type };
        private static readonly string[] Units = { "", "mm", "cm", "m", "in", "ft", "cm2", "m2", "ft2", "cm3", "m3", "l", "ft3", "deg", "rad" };

        private static readonly KeyValuePair<ClauseOp, string>[] AllOps =
        {
            new KeyValuePair<ClauseOp, string>(ClauseOp.Equals, "= тэнцүү"),
            new KeyValuePair<ClauseOp, string>(ClauseOp.NotEquals, "≠ тэнцүү биш"),
            new KeyValuePair<ClauseOp, string>(ClauseOp.Contains, "агуулна"),
            new KeyValuePair<ClauseOp, string>(ClauseOp.NotContains, "агуулахгүй"),
            new KeyValuePair<ClauseOp, string>(ClauseOp.StartsWith, "эхэлнэ"),
            new KeyValuePair<ClauseOp, string>(ClauseOp.EndsWith, "төгснө"),
            new KeyValuePair<ClauseOp, string>(ClauseOp.Greater, "> их"),
            new KeyValuePair<ClauseOp, string>(ClauseOp.GreaterOrEqual, "≥ их буюу тэнцүү"),
            new KeyValuePair<ClauseOp, string>(ClauseOp.Less, "< бага"),
            new KeyValuePair<ClauseOp, string>(ClauseOp.LessOrEqual, "≤ бага буюу тэнцүү"),
            new KeyValuePair<ClauseOp, string>(ClauseOp.Between, "хооронд"),
            new KeyValuePair<ClauseOp, string>(ClauseOp.Exists, "байгаа"),
            new KeyValuePair<ClauseOp, string>(ClauseOp.NotExists, "байхгүй"),
            new KeyValuePair<ClauseOp, string>(ClauseOp.IsEmpty, "хоосон"),
            new KeyValuePair<ClauseOp, string>(ClauseOp.NotEmpty, "хоосон биш"),
        };

        private static readonly HashSet<ClauseOp> TextOps = new HashSet<ClauseOp>
        {
            ClauseOp.Equals, ClauseOp.NotEquals, ClauseOp.Contains, ClauseOp.NotContains, ClauseOp.StartsWith, ClauseOp.EndsWith, ClauseOp.IsEmpty, ClauseOp.NotEmpty,
        };

        public SmartCountWindow(ICountSession session)
        {
            _s = session;
            Title = "MGL — Элемент тоолох · " + (session.DocumentTitle ?? "");
            Width = 1180;
            Height = 780;
            MinWidth = 900;
            MinHeight = 560;
            ShowInTaskbar = false;
            UiKit.Prepare(this, "smart-count");

            _scope = UiKit.Combo(ScopeLabels, ScopeLabels[0], 160);
            _runBtn = UiKit.Btn("Тоолох", OnRun, 110);
            _runBtn.FontWeight = FontWeights.SemiBold;
            _stopBtn = UiKit.Btn("Зогсоох", (s, e) => { if (_cts != null) _cts.Cancel(); }, 80);
            _stopBtn.IsEnabled = false;
            _selectBtn = UiKit.Btn("Сонгох", OnSelect);
            _showBtn = UiKit.Btn("Харуулах", OnShow);
            _copyBtn = UiKit.Btn("Нийлбэр хуулах", OnCopy);
            foreach (Button b in new[] { _selectBtn, _showBtn, _copyBtn }) b.IsEnabled = false;

            Content = BuildLayout();

            _saved.SelectionChanged += OnSavedChanged;
            _scope.SelectionChanged += (s, e) => { if (!_loading) { _q.Scope = ScopeValues[Math.Max(0, _scope.SelectedIndex)]; } };
            _types.Checked += (s, e) => { if (!_loading) _q.CountTypes = true; };
            _types.Unchecked += (s, e) => { if (!_loading) _q.CountTypes = false; };
            _name.TextChanged += (s, e) => { if (!_loading) _q.Name = _name.Text; };
            _catFilter.TextChanged += (s, e) => FilterCategories();
            _tree.SelectedItemChanged += OnTreeSelected;
            _staleTimer.Tick += (s, e) => RefreshStale();

            BindSaved(_s.Queries.LastQueryId);
            Loaded += async (s, e) => await LoadCatalog();
            Closed += (s, e) => { _staleTimer.Stop(); if (_cts != null) _cts.Cancel(); };
            _staleTimer.Start();
        }

        /* ============================== LAYOUT ============================= */

        private UIElement BuildLayout()
        {
            var top = new WrapPanel { Margin = new Thickness(6, 6, 6, 0) };
            top.Children.Add(UiKit.Text("Хадгалсан хайлт:", bold: true));
            top.Children.Add(_saved);
            top.Children.Add(UiKit.Btn("Шинэ", (s, e) => NewQuery()));
            top.Children.Add(UiKit.Btn("Хадгалах", (s, e) => SaveQuery(false)));
            top.Children.Add(UiKit.Btn("Шинээр хадгалах", (s, e) => SaveQuery(true)));
            top.Children.Add(UiKit.Btn("Устгах", (s, e) => DeleteQuery()));
            top.Children.Add(UiKit.Text("  Нэр:"));
            top.Children.Add(_name);

            var catScroll = new ScrollViewer { Content = _catList, Height = 150, VerticalScrollBarVisibility = ScrollBarVisibility.Auto, BorderThickness = new Thickness(1), BorderBrush = UiKit.LineBrush };
            var left = new StackPanel { Margin = new Thickness(6) };
            left.Children.Add(UiKit.Section("Хамрах хүрээ", UiKit.Col(UiKit.Row(UiKit.Text("Хаанаас:"), _scope), _types)));
            left.Children.Add(UiKit.Section("Ангилал", UiKit.Col(UiKit.Row(UiKit.Text("Хайх:"), _catFilter), catScroll)));
            left.Children.Add(UiKit.Section("Нөхцөл", _condHost));
            left.Children.Add(UiKit.Section("Бүлэглэх", UiKit.Col(_groupHost, UiKit.Btn("+ Бүлэглэлт нэмэх", (s, e) => AddGroupBy()))));
            left.Children.Add(UiKit.Row(_runBtn, _stopBtn));
            left.Children.Add(_bar);
            left.Children.Add(_issues);
            var leftScroll = new ScrollViewer { Content = left, VerticalScrollBarVisibility = ScrollBarVisibility.Auto, HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled, Width = 560 };

            var rowButtons = UiKit.Row(_selectBtn, _showBtn, _copyBtn);
            var right = new Grid { Margin = new Thickness(6) };
            right.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            right.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star), MinHeight = 80 });
            right.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1.2, GridUnitType.Star), MinHeight = 80 });
            right.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            var header = UiKit.Col(_summary, _stale, _notes, _status);
            Grid.SetRow(header, 0);
            Grid.SetRow(_tree, 1);
            Grid.SetRow(_rowsGrid, 2);
            Grid.SetRow(rowButtons, 3);
            right.Children.Add(header);
            right.Children.Add(_tree);
            right.Children.Add(_rowsGrid);
            right.Children.Add(rowButtons);

            var body = new DockPanel();
            DockPanel.SetDock(leftScroll, Dock.Left);
            body.Children.Add(leftScroll);
            body.Children.Add(right);

            var root = new DockPanel();
            DockPanel.SetDock(top, Dock.Top);
            root.Children.Add(top);
            root.Children.Add(body);
            return root;
        }

        /* ============================== CATALOG ============================ */

        private async System.Threading.Tasks.Task LoadCatalog()
        {
            try
            {
                IReadOnlyList<CategoryInfo> cats = await _s.GetCategoriesAsync(CancellationToken.None);
                IReadOnlyList<string> levels = await _s.GetLevelsAsync(CancellationToken.None);
                UiThread.Run(Dispatcher, () =>
                {
                    _categories = cats;
                    _levels = levels;
                    BuildCategoryList();
                });
                await RefreshParamNames();
                UiThread.Run(Dispatcher, RebuildConditions);
            }
            catch (Exception ex)
            {
                UiThread.Run(Dispatcher, () => _status.Text = "Ангилал уншиж чадсангүй: " + ex.Message);
            }
        }

        private async System.Threading.Tasks.Task RefreshParamNames()
        {
            try
            {
                IReadOnlyList<string> names = await _s.GetParameterNamesAsync(_q.Categories.ToList(), CancellationToken.None);
                UiThread.Run(Dispatcher, () => _paramNames = names);
            }
            catch (Exception) { /* санал болгох нэрс байхгүй ч гараар бичиж болно */ }
        }

        private void BuildCategoryList()
        {
            _catList.Children.Clear();
            foreach (CategoryInfo c in _categories)
            {
                var cb = new CheckBox { Content = c.Name, Tag = c.Id, Margin = new Thickness(2, 1, 2, 1), IsChecked = _q.Categories.Contains(c.Id, StringComparer.OrdinalIgnoreCase) };
                cb.Checked += async (s, e) => await OnCategoryChanged();
                cb.Unchecked += async (s, e) => await OnCategoryChanged();
                _catList.Children.Add(cb);
            }
            FilterCategories();
        }

        private async System.Threading.Tasks.Task OnCategoryChanged()
        {
            if (_loading) return;
            _q.Categories = _catList.Children.OfType<CheckBox>().Where(c => c.IsChecked == true).Select(c => (string)c.Tag).ToList();
            await RefreshParamNames();
            UiThread.Run(Dispatcher, RebuildConditions);
        }

        private void FilterCategories()
        {
            string f = (_catFilter.Text ?? "").Trim();
            foreach (CheckBox cb in _catList.Children.OfType<CheckBox>())
                cb.Visibility = f.Length == 0 || ((string)cb.Content).IndexOf(f, StringComparison.CurrentCultureIgnoreCase) >= 0 ? Visibility.Visible : Visibility.Collapsed;
        }

        /* ============================== SAVED QUERIES ====================== */

        private void BindSaved(string selectId)
        {
            _loading = true;
            try
            {
                _saved.Items.Clear();
                foreach (QueryDefinition q in _s.Queries.Queries) _saved.Items.Add(new ComboBoxItem { Content = q.Name, Tag = q });
                int idx = _s.Queries.Queries.FindIndex(q => q.Id == selectId);
                if (idx < 0 && _saved.Items.Count > 0) idx = 0;
                _saved.SelectedIndex = idx;
            }
            finally { _loading = false; }
            OnSavedChanged(null, null);
        }

        private void OnSavedChanged(object sender, SelectionChangedEventArgs e)
        {
            if (_loading) return;
            var item = _saved.SelectedItem as ComboBoxItem;
            QueryDefinition src = item != null ? item.Tag as QueryDefinition : null;
            LoadQuery(src != null ? src.Clone() : new QueryDefinition());
            if (src != null) { _s.Queries.LastQueryId = src.Id; _s.SaveQueries(); }
        }

        private void LoadQuery(QueryDefinition q)
        {
            _q = q;
            SavedQueryStore.Normalize(_q);
            _loading = true;
            try
            {
                _name.Text = _q.Name;
                _scope.SelectedIndex = Math.Max(0, Array.IndexOf(ScopeValues, _q.Scope));
                _types.IsChecked = _q.CountTypes;
                foreach (CheckBox cb in _catList.Children.OfType<CheckBox>())
                    cb.IsChecked = _q.Categories.Contains((string)cb.Tag, StringComparer.OrdinalIgnoreCase);
            }
            finally { _loading = false; }
            RebuildConditions();
            RebuildGroupBy();
            _issues.Text = "";
        }

        private void NewQuery()
        {
            _loading = true;
            try { _saved.SelectedIndex = -1; }
            finally { _loading = false; }
            LoadQuery(new QueryDefinition());
        }

        private void SaveQuery(bool asNew)
        {
            if (_q == null) return;
            QueryDefinition toSave = _q.Clone();
            if (asNew) { toSave.Id = SmartHash.NewId(); toSave.Version = 1; }
            if (string.IsNullOrWhiteSpace(toSave.Name)) toSave.Name = "Хайлт";
            SavedQueryStore.Upsert(_s.Queries, toSave);
            _s.Queries.LastQueryId = toSave.Id;
            _s.SaveQueries();
            _status.Text = "Хадгаллаа: «" + toSave.Name + "»";
            BindSaved(toSave.Id);
        }

        private void DeleteQuery()
        {
            var item = _saved.SelectedItem as ComboBoxItem;
            var q = item != null ? item.Tag as QueryDefinition : null;
            if (q == null) return;
            if (MessageBox.Show(this, "«" + q.Name + "» хайлтыг устгах уу?", Title, MessageBoxButton.YesNo, MessageBoxImage.Question) != MessageBoxResult.Yes) return;
            SavedQueryStore.Delete(_s.Queries, q.Id);
            _s.SaveQueries();
            BindSaved(null);
        }

        /* ============================== CONDITIONS ========================= */

        private void RebuildConditions()
        {
            _condHost.Children.Clear();
            if (_q == null) return;
            if (_q.Where == null) _q.Where = QueryNode.Group(LogicOp.And);
            _condHost.Children.Add(BuildGroup(_q.Where, 0, null));
        }

        private UIElement BuildGroup(QueryNode group, int depth, Action removeSelf)
        {
            var logic = UiKit.Combo(new[] { "Бүгд хангана (AND)", "Аль нэгийг хангана (OR)" }, null, 170);
            logic.SelectedIndex = group.Op == LogicOp.Or ? 1 : 0;
            logic.SelectionChanged += (s, e) => group.Op = logic.SelectedIndex == 1 ? LogicOp.Or : LogicOp.And;

            var headerItems = new List<UIElement> { UiKit.Text(depth == 0 ? "Нөхцөл:" : "Бүлэг:", bold: true), logic };
            if (removeSelf != null) headerItems.Add(UiKit.Btn("✕ бүлэг", (s, e) => removeSelf()));

            var panel = new StackPanel { Margin = new Thickness(depth * 14, 2, 0, 2) };
            panel.Children.Add(UiKit.Wrap(headerItems.ToArray()));

            foreach (QueryNode child in group.Children.ToList())
            {
                QueryNode c = child;
                if (c.IsGroup) panel.Children.Add(BuildGroup(c, depth + 1, () => { group.Children.Remove(c); RebuildConditions(); }));
                else panel.Children.Add(BuildClause(c, () => { group.Children.Remove(c); RebuildConditions(); }));
            }

            var add = UiKit.Btn("+ Нөхцөл", (s, e) =>
            {
                group.Children.Add(QueryNode.Clause(ClauseField.Parameter, ClauseOp.Equals));
                RebuildConditions();
            });
            var footer = new List<UIElement> { add };
            if (depth < 2) footer.Add(UiKit.Btn(group.Op == LogicOp.Or ? "+ AND бүлэг" : "+ OR бүлэг", (s, e) =>
            {
                group.Children.Add(QueryNode.Group(group.Op == LogicOp.Or ? LogicOp.And : LogicOp.Or));
                RebuildConditions();
            }));
            panel.Children.Add(UiKit.Wrap(footer.ToArray()));
            return panel;
        }

        private UIElement BuildClause(QueryNode n, Action remove)
        {
            var field = UiKit.Combo(FieldLabels, FieldLabels[Math.Max(0, Array.IndexOf(FieldValues, n.Field))], 90);
            var name = UiKit.Combo(_paramNames, null, 140);
            name.IsEditable = true;
            name.Text = n.Name ?? "";
            var scope = UiKit.Combo(ScopeParamLabels, ScopeParamLabels[Math.Max(0, Array.IndexOf(ScopeParamValues, n.Scope))], 100);
            var op = new ComboBox { MinWidth = 120, Margin = new Thickness(2) };
            var value = UiKit.Box(n.Value ?? "", 110);
            var value2 = UiKit.Box(n.Value2 ?? "", 80);
            var unit = UiKit.Combo(Units, n.Unit ?? "", 60);
            unit.IsEditable = true;
            unit.Text = n.Unit ?? "";
            bool suppress = false;
            Func<IEnumerable<KeyValuePair<ClauseOp, string>>> opsFor = () =>
                n.Field == ClauseField.Parameter ? AllOps : AllOps.Where(o => TextOps.Contains(o.Key));

            // Утгын талбаруудын харагдац — `op`/`field` өөрчлөгдөх бүрд.
            Action updateVisibility = () =>
            {
                bool isParam = n.Field == ClauseField.Parameter;
                name.Visibility = scope.Visibility = isParam ? Visibility.Visible : Visibility.Collapsed;
                bool noValue = n.Cmp == ClauseOp.Exists || n.Cmp == ClauseOp.NotExists || n.Cmp == ClauseOp.IsEmpty || n.Cmp == ClauseOp.NotEmpty;
                bool numeric = n.Cmp == ClauseOp.Greater || n.Cmp == ClauseOp.GreaterOrEqual || n.Cmp == ClauseOp.Less || n.Cmp == ClauseOp.LessOrEqual || n.Cmp == ClauseOp.Between;
                value.Visibility = noValue ? Visibility.Collapsed : Visibility.Visible;
                value2.Visibility = n.Cmp == ClauseOp.Between ? Visibility.Visible : Visibility.Collapsed;
                unit.Visibility = isParam && (numeric || n.Cmp == ClauseOp.Equals || n.Cmp == ClauseOp.NotEquals) && !noValue ? Visibility.Visible : Visibility.Collapsed;
            };

            // Үйлдлийн жагсаалтыг (талбараас хамаарна) ДАХИН бүтээнэ.  `suppress` нь Items.Clear()/SelectedIndex
            // нь SelectionChanged-ийг дахин өдөөх (хязгааргүй рекурс)-өөс хамгаална.
            Action rebuildOps = () =>
            {
                suppress = true;
                try
                {
                    List<KeyValuePair<ClauseOp, string>> ops = opsFor().ToList();
                    if (!ops.Any(o => o.Key == n.Cmp)) n.Cmp = ClauseOp.Equals;
                    op.Items.Clear();
                    foreach (var o in ops) op.Items.Add(o.Value);
                    op.SelectedIndex = ops.FindIndex(o => o.Key == n.Cmp);
                }
                finally { suppress = false; }
                updateVisibility();
            };

            field.SelectionChanged += (s, e) =>
            {
                if (suppress) return;
                n.Field = FieldValues[Math.Max(0, field.SelectedIndex)];
                rebuildOps();
            };
            op.SelectionChanged += (s, e) =>
            {
                if (suppress) return;
                List<KeyValuePair<ClauseOp, string>> ops = opsFor().ToList();
                if (op.SelectedIndex >= 0 && op.SelectedIndex < ops.Count)
                {
                    n.Cmp = ops[op.SelectedIndex].Key;
                    updateVisibility();
                }
            };
            name.AddHandler(System.Windows.Controls.Primitives.TextBoxBase.TextChangedEvent, new TextChangedEventHandler((s, e) => n.Name = name.Text));
            scope.SelectionChanged += (s, e) => n.Scope = ScopeParamValues[Math.Max(0, scope.SelectedIndex)];
            value.TextChanged += (s, e) => n.Value = value.Text;
            value2.TextChanged += (s, e) => n.Value2 = value2.Text;
            unit.AddHandler(System.Windows.Controls.Primitives.TextBoxBase.TextChangedEvent, new TextChangedEventHandler((s, e) => n.Unit = string.IsNullOrWhiteSpace(unit.Text) ? null : unit.Text.Trim()));

            rebuildOps();
            var removeBtn = UiKit.Btn("✕", (s, e) => remove(), 28);
            return UiKit.Wrap(field, name, scope, op, value, value2, unit, removeBtn);
        }

        /* ============================== GROUP BY =========================== */

        private static readonly string[] GroupLabels = { "Ангилал", "Гэр бүл", "Төрөл", "Давхар", "Параметр" };
        private static readonly GroupField[] GroupValues = { GroupField.Category, GroupField.Family, GroupField.Type, GroupField.Level, GroupField.Parameter };

        private void RebuildGroupBy()
        {
            _groupHost.Children.Clear();
            foreach (GroupSpec g in _q.GroupBy.ToList())
            {
                GroupSpec spec = g;
                var field = UiKit.Combo(GroupLabels, GroupLabels[Math.Max(0, Array.IndexOf(GroupValues, spec.Field))], 110);
                var pname = UiKit.Combo(_paramNames, null, 160);
                pname.IsEditable = true;
                pname.Text = spec.ParameterName ?? "";
                pname.Visibility = spec.Field == GroupField.Parameter ? Visibility.Visible : Visibility.Collapsed;
                field.SelectionChanged += (s, e) =>
                {
                    spec.Field = GroupValues[Math.Max(0, field.SelectedIndex)];
                    pname.Visibility = spec.Field == GroupField.Parameter ? Visibility.Visible : Visibility.Collapsed;
                };
                pname.AddHandler(System.Windows.Controls.Primitives.TextBoxBase.TextChangedEvent, new TextChangedEventHandler((s, e) => spec.ParameterName = pname.Text));
                var up = UiKit.Btn("↑", (s, e) => MoveGroup(spec, -1), 26);
                var down = UiKit.Btn("↓", (s, e) => MoveGroup(spec, 1), 26);
                var rm = UiKit.Btn("✕", (s, e) => { _q.GroupBy.Remove(spec); RebuildGroupBy(); }, 26);
                _groupHost.Children.Add(UiKit.Row(UiKit.Text((_q.GroupBy.IndexOf(spec) + 1) + "."), field, pname, up, down, rm));
            }
        }

        private void AddGroupBy()
        {
            _q.GroupBy.Add(new GroupSpec { Field = GroupField.Type });
            RebuildGroupBy();
        }

        private void MoveGroup(GroupSpec spec, int delta)
        {
            int i = _q.GroupBy.IndexOf(spec);
            int j = i + delta;
            if (i < 0 || j < 0 || j >= _q.GroupBy.Count) return;
            _q.GroupBy.RemoveAt(i);
            _q.GroupBy.Insert(j, spec);
            RebuildGroupBy();
        }

        /* ============================== RUN ================================ */

        private async void OnRun(object sender, RoutedEventArgs e)
        {
            _q.Categories = _catList.Children.OfType<CheckBox>().Where(c => c.IsChecked == true).Select(c => (string)c.Tag).ToList();
            List<QueryIssue> issues = QueryValidator.Validate(_q);
            _issues.Text = string.Join("\n", issues.Select(i => (i.IsError ? "⛔ " : "⚠ ") + i.Message));
            _issues.Foreground = issues.Any(i => i.IsError) ? UiKit.BlockingBrush : UiKit.WarningBrush;
            if (!QueryValidator.IsRunnable(issues)) return;

            _cts = new CancellationTokenSource();
            SetRunning(true);
            IProgress<JobProgress> progress = UiThread.Progress<JobProgress>(Dispatcher, p =>
            {
                _bar.Value = p.Fraction ?? 0;
                _status.Text = (p.Message ?? "") + (p.Total > 0 ? " " + p.Done + "/" + p.Total : "");
            });
            CountResult res = null;
            string error = null;
            bool cancelled = false;
            try
            {
                res = await _s.RunAsync(_q.Clone(), progress, _cts.Token);
            }
            catch (OperationCanceledException) { cancelled = true; }
            catch (Exception ex) { error = ex.Message; }

            // `await`-ын дараа UI thread дээр байх баталгаагүй — маршалл.
            UiThread.Run(Dispatcher, () =>
            {
                if (res != null) ShowResult(res);
                else _status.Text = cancelled ? "Зогсоосон." : "⛔ " + error;
                SetRunning(false);
            });
        }

        private void SetRunning(bool running)
        {
            _runBtn.IsEnabled = !running;
            _stopBtn.IsEnabled = running;
            _bar.Visibility = running ? Visibility.Visible : Visibility.Collapsed;
            _bar.Value = 0;
        }

        /* ============================== RESULT ============================= */

        private void ShowResult(CountResult res)
        {
            _result = res;
            long total = res.StageMs.Values.Sum();
            _summary.Text = "«" + res.QueryName + "» — нийт " + res.Total + " элемент (шалгасан нэр дэвшигч " + res.Candidates + ", " + total + " мс)";
            _notes.Text = string.Join("\n", res.Notes);
            _status.Text = "";

            _tree.Items.Clear();
            _tree.Items.Add(NodeFor(res.Root, true));
            if (_tree.Items.Count > 0)
            {
                var root = (TreeViewItem)_tree.Items[0];
                root.IsSelected = true;
            }
            _rowsGrid.ItemsSource = null;
            foreach (Button b in new[] { _selectBtn, _showBtn, _copyBtn }) b.IsEnabled = res.Total > 0;
            RefreshStale();
            ShowRows(res.Root);
        }

        private TreeViewItem NodeFor(CountGroup g, bool root)
        {
            var item = new TreeViewItem
            {
                Header = (root ? "Нийт" : (g.FieldLabel + ": " + g.Label)) + "  —  " + g.Count,
                Tag = g,
                IsExpanded = root || g.Children.Count <= 12,
            };
            foreach (CountGroup c in g.Children) item.Items.Add(NodeFor(c, false));
            return item;
        }

        private void OnTreeSelected(object sender, RoutedPropertyChangedEventArgs<object> e)
        {
            var item = e.NewValue as TreeViewItem;
            var g = item != null ? item.Tag as CountGroup : null;
            if (g != null && _result != null) ShowRows(g);
        }

        private const int MaxGridRows = 5000;

        private sealed class RowView
        {
            public string[] Cells;
            public ElementRecord Record;
            public string this[int i] { get { return i < Cells.Length ? Cells[i] : ""; } }
        }

        private List<string> ExtraColumns()
        {
            var names = new List<string>();
            foreach (GroupSpec g in _q.GroupBy)
                if (g.Field == GroupField.Parameter && !string.IsNullOrWhiteSpace(g.ParameterName) && !names.Contains(g.ParameterName)) names.Add(g.ParameterName);
            Action<QueryNode> walk = null;
            walk = n =>
            {
                if (n.IsClause && n.Field == ClauseField.Parameter && !string.IsNullOrWhiteSpace(n.Name) && !names.Contains(n.Name) && names.Count < 4) names.Add(n.Name);
                foreach (QueryNode k in n.Children ?? new List<QueryNode>()) walk(k);
            };
            if (_q.Where != null) walk(_q.Where);
            return names.Take(4).ToList();
        }

        private void ShowRows(CountGroup g)
        {
            List<ElementRecord> rows = _result.RowsOf(g);
            List<string> extra = ExtraColumns();

            _rowsGrid.Columns.Clear();
            string[] headers = new[] { "Ангилал", "Гэр бүл", "Төрөл", "Давхар" }.Concat(extra).Concat(new[] { "ID" }).ToArray();
            for (int i = 0; i < headers.Length; i++)
                _rowsGrid.Columns.Add(new DataGridTextColumn { Header = headers[i], Binding = new System.Windows.Data.Binding("[" + i + "]"), Width = i == headers.Length - 1 ? 80 : new DataGridLength(1, DataGridLengthUnitType.Star) });

            var views = new List<RowView>(Math.Min(rows.Count, MaxGridRows));
            foreach (ElementRecord r in rows.Take(MaxGridRows))
            {
                var cells = new List<string> { r.Category, r.Family, r.Type, r.Level };
                foreach (string n in extra)
                {
                    ParamValue p = r.Param(n);
                    cells.Add(p.Exists ? p.Text : "");
                }
                cells.Add(r.ElementIdValue.ToString());
                views.Add(new RowView { Cells = cells.ToArray(), Record = r });
            }
            _rowsGrid.ItemsSource = views;

            string cap = rows.Count > MaxGridRows ? " (эхний " + MaxGridRows + " харагдаж байна)" : "";
            _status.Text = "Сонгосон бүлэг: " + g.Count + " элемент" + cap;
        }

        private List<ElementRecord> TargetRows()
        {
            var selected = _rowsGrid.SelectedItems.Cast<RowView>().Select(r => r.Record).ToList();
            if (selected.Count > 0) return selected;
            var item = _tree.SelectedItem as TreeViewItem;
            var g = item != null ? item.Tag as CountGroup : null;
            return _result != null && g != null ? _result.RowsOf(g) : new List<ElementRecord>();
        }

        private async void OnSelect(object sender, RoutedEventArgs e)
        {
            List<ElementRecord> rows = TargetRows();
            CountGuards.Verdict v = CountGuards.ForSelect(rows.Count);
            if (!v.Allowed) { _status.Text = "⛔ " + v.Message; return; }
            if (v.NeedsConfirm && MessageBox.Show(this, v.Message, Title, MessageBoxButton.YesNo, MessageBoxImage.Question) != MessageBoxResult.Yes) return;
            await Act(() => _s.SelectAsync(rows, CancellationToken.None));
        }

        private async void OnShow(object sender, RoutedEventArgs e)
        {
            List<ElementRecord> rows = TargetRows();
            CountGuards.Verdict v = CountGuards.ForShow(rows.Count);
            if (!v.Allowed) { _status.Text = "⛔ " + v.Message; return; }
            await Act(() => _s.ShowAsync(rows, CancellationToken.None));
        }

        private async System.Threading.Tasks.Task Act(Func<System.Threading.Tasks.Task<SelectOutcome>> action)
        {
            try
            {
                SelectOutcome o = await action();
                UiThread.Run(Dispatcher, () => _status.Text = o.Message);
            }
            catch (Exception ex)
            {
                UiThread.Run(Dispatcher, () => _status.Text = "⛔ " + ex.Message);
            }
        }

        private void OnCopy(object sender, RoutedEventArgs e)
        {
            if (_result == null) return;
            try
            {
                Clipboard.SetText(CountExport.ToTsv(_result, _q.GroupBy));
                _status.Text = "Нийлбэр хуулагдлаа — Excel руу буулгана уу.";
            }
            catch (Exception ex)
            {
                _status.Text = "Хуулж чадсангүй (" + ex.GetType().Name + ").";
            }
        }

        private void RefreshStale()
        {
            if (_result == null) { _stale.Text = ""; return; }
            bool stale;
            try { stale = _s.IsStale(_result); }
            catch (Exception) { stale = true; }
            _stale.Text = stale ? "⚠ Загвар өөрчлөгдсөн — энэ үр дүн хуучирсан байж болзошгүй. «Тоолох»-оор дахин тооцоолно уу." : "";
        }
    }
}
