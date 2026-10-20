using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Data;
using System.Windows.Media;
using System.Windows.Threading;
using RevitMcpAddin.ClashCheck.Core;
using RevitMcpAddin.Smart.Core;
using RevitMcpAddin.Smart.Ui;

namespace RevitMcpAddin.ClashCheck.Ui
{
    /// <summary>
    /// «Clash шалгах» — модальгүй цонх.  Revit-ийн төрлийг мэдэхгүй (`IClashSession`); бүх Revit ажил `await`-аар
    /// (UI thread гацахгүй), урт ажил `Зогсоох` товчтой.
    ///
    ///   [Дүрэм] [Шинэ/Засах/Хуулах/Устгах]   [Шалгах] [Бүх идэвхтэйг шалгах] [Зогсоох]
    ///   → сүүлийн шалгалтын хураангуй (A, B, нэр дэвшигч, баталгаажсан, дэмжигдэхгүй, алдаа, хугацаа)
    ///   → шүүлтүүр (төлөв, давхар, ангилал, хайлт) → clash-ийн жагсаалт → дэлгэрэнгүй (A/B, түүх, тэмдэглэл)
    ///   → [Хянасан] [Зөвшөөрсөн] [Шинэ] · [A сонгох] [B сонгох] [Хоёуланг] [Харуулах]
    ///
    /// ЯАГААД ИНГЭЖ:
    ///   • «Шийдэгдсэн» төлөвийг хэрэглэгч ГАРААР тавьдаггүй (зөвхөн дахин шалгалтын нотолгоотой систем).
    ///   • Хэрэглэгчийн төлөв солилт ба шалгалтын дүн нэг файлыг зэрэг бичдэг тул ХОЁУЛАА `UpdateState` (нэг түгжээ).
    ///   • Дэмжигдээгүй / геометрийн алдаатай хос «clash биш» гэж харагдахгүй — хураангуйд тусдаа тоолуур.
    ///   • Загвар өөрчлөгдсөн бол үр дүн «хуучирсан» тэмдэгтэй (чимээгүй хуучирсан хэвээр харагдахгүй).
    /// </summary>
    internal sealed class ClashWindow : Window
    {
        private const int MaxRows = 3000;

        private readonly IClashSession _s;
        private ClashState _state = new ClashState();
        private IReadOnlyList<CategoryInfo> _categories = new List<CategoryInfo>();
        private CancellationTokenSource _cts;
        private bool _running;
        private bool _loading;
        private bool _bulkSelecting;

        private readonly ComboBox _rules = new ComboBox { MinWidth = 320, Margin = new Thickness(2) };
        private readonly Button _newBtn, _editBtn, _copyBtn, _delBtn, _runBtn, _runAllBtn, _stopBtn;
        private readonly ProgressBar _bar = new ProgressBar { Height = 6, Minimum = 0, Maximum = 1, Margin = new Thickness(2, 4, 2, 4), Visibility = Visibility.Collapsed };
        private readonly TextBlock _summary = UiKit.Text("Дүрмээ сонгоод «Шалгах» дарна уу.", bold: true, wrap: true);
        private readonly TextBlock _stale = UiKit.Text("", brush: UiKit.WarningBrush, wrap: true);
        private readonly TextBlock _runNotes = UiKit.Text("", brush: UiKit.MutedBrush, wrap: true);
        private readonly TextBlock _status = UiKit.Text("", brush: UiKit.MutedBrush, wrap: true);

        private readonly CheckBox _fNew, _fReviewed, _fAccepted, _fResolved, _fAllRules, _fOldHash;
        private readonly TextBox _search = UiKit.Box("", 180);
        private readonly ComboBox _levelFilter = new ComboBox { MinWidth = 120, Margin = new Thickness(2) };
        private readonly ComboBox _catFilter = new ComboBox { MinWidth = 140, Margin = new Thickness(2) };
        private readonly ComboBox _sevFilter = new ComboBox { MinWidth = 110, Margin = new Thickness(2) };
        private readonly TextBlock _listInfo = UiKit.Text("", brush: UiKit.MutedBrush);

        private readonly DataGrid _grid = new DataGrid
        {
            AutoGenerateColumns = false, IsReadOnly = true, CanUserAddRows = false, Margin = new Thickness(2),
            SelectionMode = DataGridSelectionMode.Extended, HeadersVisibility = DataGridHeadersVisibility.Column,
            GridLinesVisibility = DataGridGridLinesVisibility.Horizontal,
            HorizontalGridLinesBrush = UiKit.LineBrush,
            AlternationCount = 2,
            AlternatingRowBackground = UiKit.AltRowBrush,
        };

        private readonly TextBlock _detail = UiKit.Text("Clash сонгоно уу.", wrap: true);
        private readonly ListBox _history = new ListBox { Height = 110, Margin = new Thickness(2) };
        private readonly TextBox _note = UiKit.Box("", 0, multiline: true);
        private readonly Button _reviewBtn, _acceptBtn, _newStatusBtn, _saveNoteBtn, _selABtn, _selBBtn, _selBothBtn, _showBtn;
        private readonly DispatcherTimer _staleTimer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(1500) };

        private static readonly string[] SeverityFilterLabels = { "Бүгд", "Ноцтой", "Анхааруулга", "Мэдээлэл" };
        private const string AllLevels = "Бүх давхар";
        private const string AllCategories = "Бүх ангилал";

        /// <summary>Жагсаалтын нэг мөр — `ClashIssue`-ийн ХАРАГДАХ хэлбэр (binding-д).</summary>
        internal sealed class IssueRow
        {
            internal ClashIssue Issue;
            public string Severity { get; set; }
            public int SeverityRank { get; set; }
            public Brush SeverityBrush { get; set; }
            public string Status { get; set; }
            public int StatusRank { get; set; }
            public Brush StatusBrush { get; set; }
            public string Level { get; set; }
            public string A { get; set; }
            public string B { get; set; }
            public double VolumeValue { get; set; }
            public string Volume { get; set; }
            public int Times { get; set; }
            public string First { get; set; }
            public string Last { get; set; }
        }

        internal ClashWindow(IClashSession session)
        {
            _s = session;
            Title = "MGL — Давхцал шалгах · " + (session.DocumentTitle ?? "");
            Width = 1240;
            Height = 800;
            MinWidth = 960;
            MinHeight = 600;
            ShowInTaskbar = false;
            UiKit.Prepare(this, "clash");

            _newBtn = UiKit.Btn("Шинэ", (s, e) => OnNewRule());
            _editBtn = UiKit.Btn("Засах", (s, e) => OnEditRule());
            _copyBtn = UiKit.Btn("Хуулах", (s, e) => OnCopyRule());
            _delBtn = UiKit.Btn("Устгах", (s, e) => OnDeleteRule());
            _runBtn = UiKit.Btn("Шалгах", OnRun, 110);
            _runBtn.FontWeight = FontWeights.SemiBold;
            _runAllBtn = UiKit.Btn("Бүх идэвхтэй дүрмийг шалгах", OnRunAll);
            _stopBtn = UiKit.Btn("Зогсоох", (s, e) => { if (_cts != null) _cts.Cancel(); }, 80);
            _stopBtn.IsEnabled = false;

            _fNew = UiKit.Check("Шинэ", true, (s, e) => OnFilterChanged());
            _fReviewed = UiKit.Check("Хянасан", true, (s, e) => OnFilterChanged());
            _fAccepted = UiKit.Check("Зөвшөөрсөн", true, (s, e) => OnFilterChanged());
            _fResolved = UiKit.Check("Шийдэгдсэн", false, (s, e) => OnFilterChanged());
            _fAllRules = UiKit.Check("Бүх дүрмийн clash", false, (s, e) => OnFilterChanged());
            _fOldHash = UiKit.Check("Хуучин тохиргооны түүх", false, (s, e) => OnFilterChanged());
            _fNew.ToolTip = "Шинээр илэрсэн, хараахан хараагүй.";
            _fReviewed.ToolTip = "Хүн харсан, шийдвэр хүлээгдэж байна.";
            _fAccepted.ToolTip = "Зориудаар зөвшөөрсөн — дахин шалгахад «Шинэ» болохгүй.";
            _fResolved.ToolTip = "Дахин шалгалтаар (устсан / холдсон / clash биш) систем баталгаажуулсан.";
            _fOldHash.ToolTip = "Дүрмийн тохиргоо өөрчлөгдөхөөс өмнөх clash-ууд (одоогийн тохиргооны үр дүн биш).";

            _reviewBtn = UiKit.Btn("Хянасан", (s, e) => ApplyStatus(ClashStatus.Reviewed));
            _acceptBtn = UiKit.Btn("Зөвшөөрсөн", (s, e) => ApplyStatus(ClashStatus.Accepted));
            _newStatusBtn = UiKit.Btn("Шинэ болгох", (s, e) => ApplyStatus(ClashStatus.New));
            _saveNoteBtn = UiKit.Btn("Тэмдэглэл хадгалах", (s, e) => SaveNote());
            _reviewBtn.ToolTip = "Харсан гэж тэмдэглэнэ.";
            _acceptBtn.ToolTip = "Зориудаар зөвшөөрнө — дараагийн шалгалтаар дахин «Шинэ» болохгүй.";
            _selABtn = UiKit.Btn("A сонгох", (s, e) => OnSelect(ClashTarget.A));
            _selBBtn = UiKit.Btn("B сонгох", (s, e) => OnSelect(ClashTarget.B));
            _selBothBtn = UiKit.Btn("Хоёуланг сонгох", (s, e) => OnSelect(ClashTarget.Both));
            _showBtn = UiKit.Btn("Харуулах (ойртуулах)", OnShow);

            _sevFilter.ItemsSource = SeverityFilterLabels;
            _sevFilter.SelectedIndex = 0;

            BuildGridColumns();
            Content = BuildLayout();

            _rules.SelectionChanged += (s, e) => { if (!_loading) OnRuleChanged(); };
            _search.TextChanged += (s, e) => OnFilterChanged();
            _levelFilter.SelectionChanged += (s, e) => { if (!_loading) OnFilterChanged(); };
            _catFilter.SelectionChanged += (s, e) => { if (!_loading) OnFilterChanged(); };
            _sevFilter.SelectionChanged += (s, e) => { if (!_loading) OnFilterChanged(); };
            _grid.SelectionChanged += (s, e) => { if (!_bulkSelecting) UpdateDetail(); };
            _staleTimer.Tick += (s, e) => RefreshStale();

            _state = _s.LoadState();
            BindRules(_s.Rules.LastRuleId);
            RefreshAll();
            UpdateButtons();

            Loaded += async (s, e) => await LoadCatalog();
            Closed += (s, e) => { _staleTimer.Stop(); if (_cts != null) _cts.Cancel(); };
            _staleTimer.Start();
        }

        /* ============================== LAYOUT ============================= */

        private UIElement BuildLayout()
        {
            var ruleBar = new WrapPanel { Margin = new Thickness(6, 6, 6, 0) };
            ruleBar.Children.Add(UiKit.Text("Дүрэм:", bold: true));
            ruleBar.Children.Add(_rules);
            ruleBar.Children.Add(_newBtn);
            ruleBar.Children.Add(_editBtn);
            ruleBar.Children.Add(_copyBtn);
            ruleBar.Children.Add(_delBtn);
            ruleBar.Children.Add(UiKit.Text("      "));
            ruleBar.Children.Add(_runBtn);
            ruleBar.Children.Add(_runAllBtn);
            ruleBar.Children.Add(_stopBtn);

            var info = UiKit.Col(_bar, _summary, _stale, _runNotes, _status);
            info.Margin = new Thickness(8, 2, 8, 2);

            var chips = UiKit.Wrap(UiKit.Text("Төлөв:", bold: true), _fNew, _fReviewed, _fAccepted, _fResolved,
                UiKit.Text("   "), _fAllRules, _fOldHash);
            var filters = UiKit.Wrap(UiKit.Text("Хайх:"), _search, UiKit.Text("  Давхар:"), _levelFilter,
                UiKit.Text("  Ангилал:"), _catFilter, UiKit.Text("  Ноцтой:"), _sevFilter, UiKit.Text("   "), _listInfo);
            var filterBox = UiKit.Col(chips, filters);
            filterBox.Margin = new Thickness(6, 0, 6, 0);

            var detailRoot = BuildDetail();

            var main = new Grid { Margin = new Thickness(6, 2, 6, 6) };
            main.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star), MinHeight = 120 });
            main.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            Grid.SetRow(_grid, 0);
            Grid.SetRow(detailRoot, 1);
            main.Children.Add(_grid);
            main.Children.Add(detailRoot);

            var top = UiKit.Col(ruleBar, info, filterBox);
            var root = new DockPanel();
            DockPanel.SetDock(top, Dock.Top);
            root.Children.Add(top);
            root.Children.Add(main);
            return root;
        }

        private UIElement BuildDetail()
        {
            _note.Height = 52;
            _note.ToolTip = "Төлөв солихдоо тэмдэглэл хадгална (юу ч бичихгүй байж болно).";

            var left = new StackPanel();
            left.Children.Add(_detail);
            left.Children.Add(UiKit.Text("Тэмдэглэл:", brush: UiKit.MutedBrush));
            left.Children.Add(_note);
            left.Children.Add(UiKit.Wrap(_reviewBtn, _acceptBtn, _newStatusBtn, _saveNoteBtn,
                UiKit.Text("   "), _selABtn, _selBBtn, _selBothBtn, _showBtn));

            var right = new StackPanel { Width = 360 };
            right.Children.Add(UiKit.Text("Түүх:", brush: UiKit.MutedBrush));
            right.Children.Add(_history);

            var g = new Grid { Margin = new Thickness(2, 4, 2, 0) };
            g.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            g.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            Grid.SetColumn(left, 0);
            Grid.SetColumn(right, 1);
            g.Children.Add(left);
            g.Children.Add(right);

            return new Border
            {
                Child = g,
                BorderThickness = new Thickness(0, 1, 0, 0),
                BorderBrush = UiKit.LineBrush,
                Padding = new Thickness(4),
                MaxHeight = 300,
            };
        }

        private void BuildGridColumns()
        {
            _grid.Columns.Add(Templated("Ноцтой", "Severity", "SeverityBrush", "SeverityRank", 92, true));
            _grid.Columns.Add(Templated("Төлөв", "Status", "StatusBrush", "StatusRank", 150, false));
            _grid.Columns.Add(Text("Давхар", "Level", 90, null));
            _grid.Columns.Add(Text("A", "A", 0, null));
            _grid.Columns.Add(Text("B", "B", 0, null));
            _grid.Columns.Add(Text("Эзлэхүүн, см³", "Volume", 100, "VolumeValue"));
            _grid.Columns.Add(Text("×", "Times", 40, null));
            _grid.Columns.Add(Text("Анх илэрсэн", "First", 125, null));
            _grid.Columns.Add(Text("Сүүлд", "Last", 125, null));
        }

        private static DataGridColumn Text(string header, string path, double width, string sortPath)
        {
            return new DataGridTextColumn
            {
                Header = header,
                Binding = new Binding(path) { Mode = BindingMode.OneWay },
                Width = width > 0 ? new DataGridLength(width) : new DataGridLength(1, DataGridLengthUnitType.Star),
                SortMemberPath = sortPath ?? path,
            };
        }

        private static DataGridColumn Templated(string header, string textPath, string brushPath, string sortPath, double width, bool bold)
        {
            var tb = new FrameworkElementFactory(typeof(TextBlock));
            tb.SetBinding(TextBlock.TextProperty, new Binding(textPath) { Mode = BindingMode.OneWay });
            tb.SetBinding(TextBlock.ForegroundProperty, new Binding(brushPath) { Mode = BindingMode.OneWay });
            tb.SetValue(FrameworkElement.MarginProperty, new Thickness(4, 1, 4, 1));
            if (bold) tb.SetValue(TextBlock.FontWeightProperty, FontWeights.SemiBold);
            return new DataGridTemplateColumn
            {
                Header = header,
                CellTemplate = new DataTemplate { VisualTree = tb },
                Width = new DataGridLength(width),
                SortMemberPath = sortPath,
            };
        }

        /* ============================== CATALOG ============================ */

        private async Task LoadCatalog()
        {
            try
            {
                IReadOnlyList<CategoryInfo> cats = await _s.GetCategoriesAsync(CancellationToken.None);
                UiThread.Run(Dispatcher, () => _categories = cats);
            }
            catch (Exception ex)
            {
                UiThread.Run(Dispatcher, () => _status.Text = "Ангилал уншиж чадсангүй: " + ex.Message);
            }
        }

        /* ============================== RULES ============================== */

        private void BindRules(string selectId)
        {
            _loading = true;
            try
            {
                _rules.Items.Clear();
                foreach (ClashRule r in _s.Rules.Rules)
                    _rules.Items.Add(new ComboBoxItem { Content = r.Name + (r.Enabled ? "" : "  (идэвхгүй)"), Tag = r });
                int idx = _s.Rules.Rules.FindIndex(r => r.Id == selectId);
                if (idx < 0 && _rules.Items.Count > 0) idx = 0;
                _rules.SelectedIndex = idx;
            }
            finally { _loading = false; }
        }

        private ClashRule SelectedRule()
        {
            var item = _rules.SelectedItem as ComboBoxItem;
            return item != null ? item.Tag as ClashRule : null;
        }

        private void OnRuleChanged()
        {
            ClashRule r = SelectedRule();
            if (r != null)
            {
                _s.Rules.LastRuleId = r.Id;
                _s.SaveRules();
            }
            RefreshAll();
            UpdateButtons();
        }

        private void OnNewRule()
        {
            var rule = new ClashRule { Name = "Шинэ дүрэм" };
            EditRule(rule, false);
        }

        private void OnEditRule()
        {
            ClashRule r = SelectedRule();
            if (r != null) EditRule(r, true);
        }

        private void OnCopyRule()
        {
            ClashRule r = SelectedRule();
            if (r == null) return;
            ClashRule c = r.Clone();
            c.Id = SmartHash.NewId();
            c.Name = r.Name + " (хуулбар)";
            EditRule(c, false);
        }

        private void EditRule(ClashRule rule, bool existing)
        {
            var dlg = new ClashRuleDialog(this, rule, _categories, existing);
            if (dlg.ShowDialog() != true || dlg.Result == null) return;
            ClashRuleStore.Upsert(_s.Rules, dlg.Result);
            _s.Rules.LastRuleId = dlg.Result.Id;
            _s.SaveRules();
            BindRules(dlg.Result.Id);
            RefreshAll();
            UpdateButtons();
            _status.Text = "Хадгаллаа: «" + dlg.Result.Name + "»";
        }

        private void OnDeleteRule()
        {
            ClashRule r = SelectedRule();
            if (r == null) return;
            int issues = _state.Issues.Count(i => i.RuleId == r.Id);
            string msg = "«" + r.Name + "» дүрмийг устгах уу?" + (issues > 0
                ? "\n\nЭнэ дүрмийн " + issues + " clash түүхэнд үлдэнэ («Бүх дүрмийн clash» сонголтоор харагдана)."
                : "");
            if (MessageBox.Show(this, msg, Title, MessageBoxButton.YesNo, MessageBoxImage.Question) != MessageBoxResult.Yes) return;
            ClashRuleStore.Delete(_s.Rules, r.Id);
            _s.SaveRules();
            BindRules(null);
            RefreshAll();
            UpdateButtons();
        }

        /* ============================== RUN ================================ */

        private async void OnRun(object sender, RoutedEventArgs e)
        {
            ClashRule r = SelectedRule();
            if (r == null) { _status.Text = "Эхлээд дүрэм сонгоно уу."; return; }
            await RunRulesAsync(new List<ClashRule> { r.Clone() });
        }

        private async void OnRunAll(object sender, RoutedEventArgs e)
        {
            var rules = _s.Rules.Rules.Where(r => r.Enabled).Select(r => r.Clone()).ToList();
            if (rules.Count == 0) { _status.Text = "Идэвхтэй дүрэм алга."; return; }
            await RunRulesAsync(rules);
        }

        private async Task RunRulesAsync(List<ClashRule> rules)
        {
            // Нэг ч дүрмийг ажиллуулахаас ӨМНӨ бүгдийг баталгаажуулна (дундаас нь алдаа гарахаас өмнө хэрэглэгчид хэлнэ).
            var lines = new List<string>();
            var runnable = new List<ClashRule>();
            foreach (ClashRule rule in rules)
            {
                List<RuleIssue> issues = ClashRuleLogic.Validate(rule);
                if (ClashRuleLogic.IsRunnable(issues)) runnable.Add(rule);
                else lines.Add("⛔ «" + rule.Name + "»: " + string.Join(" ", issues.Where(i => i.IsError).Select(i => i.Message)));
            }
            if (runnable.Count == 0)
            {
                _status.Text = string.Join("\n", lines);
                _status.Foreground = UiKit.BlockingBrush;
                return;
            }

            _cts = new CancellationTokenSource();
            CancellationToken ct = _cts.Token;
            SetRunning(true);
            _status.Foreground = UiKit.MutedBrush;

            bool cancelled = false;
            for (int i = 0; i < runnable.Count && !cancelled; i++)
            {
                ClashRule rule = runnable[i];
                string prefix = runnable.Count > 1 ? "(" + (i + 1) + "/" + runnable.Count + ") " + rule.Name + " — " : "";
                IProgress<JobProgress> progress = UiThread.Progress<JobProgress>(Dispatcher, p =>
                {
                    _bar.Value = p.Fraction ?? 0;
                    _status.Text = prefix + (p.Message ?? "") + (p.Total > 0 ? " " + p.Done + "/" + p.Total : "");
                });

                ClashRunOutcome outcome = null;
                string error = null;
                try { outcome = await _s.RunAsync(rule, progress, ct); }
                catch (OperationCanceledException) { cancelled = true; }
                catch (Exception ex) { error = ex.Message; }

                if (outcome != null) lines.Add(Describe(rule, outcome));
                else if (cancelled) lines.Add("⏹ «" + rule.Name + "»: зогсоосон — илэрсэн clash хадгалагдсан, ЮУ Ч «шийдэгдсэн» болгоогүй.");
                else lines.Add("⛔ «" + rule.Name + "»: " + error);
            }

            // `await`-ын дараа UI thread дээр байх баталгаагүй — маршалл.
            UiThread.Run(Dispatcher, () =>
            {
                _state = _s.LoadState();
                RefreshAll();
                _status.Text = string.Join("\n", lines);
                SetRunning(false);
                UpdateButtons();
            });
        }

        private static string Describe(ClashRule rule, ClashRunOutcome o)
        {
            string head = "«" + rule.Name + "»: ";
            if (o.Run == null) return head + "дүн алга.";

            // ⚠ тэмдэглэл бүр (хадгалж чадаагүй, хэсэгчилсэн, загвар өөрчлөгдсөн, линк unload...) ХЭЗЭЭ Ч нуугдахгүй.
            List<string> warn = o.Run.Notes.Where(n => !string.IsNullOrEmpty(n) && n.StartsWith("⚠", StringComparison.Ordinal)).ToList();
            if (o.Run.Status == RunStatus.Failed)
            {
                string f = head + "⛔ алдаатай" + (o.Run.Confirmed > 0 ? " (илэрсэн " + o.Run.Confirmed + " clash)" : "");
                List<string> why = warn.Count > 0 ? warn : o.Run.Notes.Take(2).ToList();
                return f + " — " + string.Join(" ", why.Take(3));
            }

            string s = head + o.Run.Confirmed + " clash";
            if (o.New > 0) s += " (шинэ " + o.New + ")";
            if (o.Resolved > 0) s += ", шийдэгдсэн " + o.Resolved;
            if (o.Reappeared > 0) s += ", дахин илэрсэн " + o.Reappeared;
            if (o.Unverified > 0) s += ", баталгаагүй " + o.Unverified;
            if (o.Run.Status == RunStatus.Partial) s += " · ХЭСЭГЧИЛСЭН";
            if (warn.Count > 0) s += "\n    " + string.Join("\n    ", warn.Take(4));
            return s;
        }

        private void SetRunning(bool running)
        {
            _running = running;
            _runBtn.IsEnabled = !running;
            _runAllBtn.IsEnabled = !running;
            _stopBtn.IsEnabled = running;
            foreach (Button b in new[] { _newBtn, _editBtn, _copyBtn, _delBtn }) b.IsEnabled = !running;
            _rules.IsEnabled = !running;
            _bar.Visibility = running ? Visibility.Visible : Visibility.Collapsed;
            _bar.Value = 0;
            UpdateButtons();
        }

        /* ============================== LIST =============================== */

        private void OnFilterChanged()
        {
            if (_loading) return;
            RefreshList();
        }

        private void RefreshAll()
        {
            RebuildFilterChoices();
            RefreshList();
            RefreshSummary();
        }

        private static string StatusText(ClashStatus s)
        {
            switch (s)
            {
                case ClashStatus.Reviewed: return "Хянасан";
                case ClashStatus.Accepted: return "Зөвшөөрсөн";
                case ClashStatus.Resolved: return "Шийдэгдсэн";
                default: return "Шинэ";
            }
        }

        private static int StatusRank(ClashStatus s)
        {
            switch (s)
            {
                case ClashStatus.Resolved: return 3;
                case ClashStatus.Accepted: return 2;
                case ClashStatus.Reviewed: return 1;
                default: return 0;
            }
        }

        private static string SeverityText(ClashSeverity s)
        {
            switch (s)
            {
                case ClashSeverity.Critical: return "Ноцтой";
                case ClashSeverity.Warning: return "Анхааруулга";
                default: return "Мэдээлэл";
            }
        }

        private static Brush SeverityBrush(ClashSeverity s)
        {
            switch (s)
            {
                case ClashSeverity.Critical: return UiKit.BlockingBrush;
                case ClashSeverity.Warning: return UiKit.WarningBrush;
                default: return UiKit.InfoBrush;
            }
        }

        private static string Local(DateTime utc)
        {
            return utc.ToLocalTime().ToString("yyyy-MM-dd HH:mm", CultureInfo.InvariantCulture);
        }

        /// <summary>Одоогийн дүрэм/хэшийн хүрээнд харагдах issue-ууд (төлөвийн шүүлтээс ӨМНӨ).</summary>
        private IEnumerable<ClashIssue> InScope()
        {
            ClashRule rule = SelectedRule();
            string hash = rule != null ? ClashRuleLogic.SemanticHash(rule) : null;
            bool all = _fAllRules.IsChecked == true;
            bool old = _fOldHash.IsChecked == true;

            string level = _levelFilter.SelectedItem as string;
            string cat = _catFilter.SelectedItem as string;
            int sev = _sevFilter.SelectedIndex;
            string q = (_search.Text ?? "").Trim();

            foreach (ClashIssue i in _state.Issues)
            {
                if (!all)
                {
                    if (rule == null || i.RuleId != rule.Id) continue;
                    if (!old && i.RuleHash != hash) continue;
                }
                if (!string.IsNullOrEmpty(level) && level != AllLevels && (i.Level ?? "") != level) continue;
                if (!string.IsNullOrEmpty(cat) && cat != AllCategories && (i.A.Category ?? "") != cat && (i.B.Category ?? "") != cat) continue;
                if (sev == 1 && i.Severity != ClashSeverity.Critical) continue;
                if (sev == 2 && i.Severity != ClashSeverity.Warning) continue;
                if (sev == 3 && i.Severity != ClashSeverity.Info) continue;
                if (q.Length > 0 && !Matches(i, q)) continue;
                yield return i;
            }
        }

        private static bool Matches(ClashIssue i, string q)
        {
            Func<string, bool> has = s => !string.IsNullOrEmpty(s) && s.IndexOf(q, StringComparison.CurrentCultureIgnoreCase) >= 0;
            return has(i.A.Label) || has(i.B.Label) || has(i.A.Family) || has(i.B.Family) || has(i.A.Type) || has(i.B.Type)
                || has(i.Level) || has(i.RuleName) || has(i.Note);
        }

        private bool StatusShown(ClashStatus s)
        {
            switch (s)
            {
                case ClashStatus.Reviewed: return _fReviewed.IsChecked == true;
                case ClashStatus.Accepted: return _fAccepted.IsChecked == true;
                case ClashStatus.Resolved: return _fResolved.IsChecked == true;
                default: return _fNew.IsChecked == true;
            }
        }

        private void RefreshList()
        {
            var keep = new HashSet<string>(SelectedIssues().Select(i => i.Fingerprint), StringComparer.Ordinal);
            ClashRule rule = SelectedRule();
            string hash = rule != null ? ClashRuleLogic.SemanticHash(rule) : null;

            List<ClashIssue> scoped = InScope().ToList();
            _fNew.Content = "Шинэ (" + scoped.Count(i => i.Status == ClashStatus.New || i.Status == ClashStatus.Unknown) + ")";
            _fReviewed.Content = "Хянасан (" + scoped.Count(i => i.Status == ClashStatus.Reviewed) + ")";
            _fAccepted.Content = "Зөвшөөрсөн (" + scoped.Count(i => i.Status == ClashStatus.Accepted) + ")";
            _fResolved.Content = "Шийдэгдсэн (" + scoped.Count(i => i.Status == ClashStatus.Resolved) + ")";

            List<ClashIssue> shown = scoped.Where(i => StatusShown(i.Status)).ToList();
            var rows = shown
                .OrderBy(i => StatusRank(i.Status))
                .ThenByDescending(i => (int)i.Severity)
                .ThenByDescending(i => i.VolumeCm3)
                .Take(MaxRows)
                .Select(i => ToRow(i, hash))
                .ToList();

            _grid.ItemsSource = rows;
            _listInfo.Text = shown.Count > MaxRows
                ? "Харагдаж байгаа: " + MaxRows + " / " + shown.Count + " (шүүлтүүрээр нарийсгана уу)"
                : "Харагдаж байгаа: " + shown.Count;

            if (keep.Count > 0) SelectRows(rows, keep);
            UpdateDetail();
        }

        /// <summary>
        /// Сонголтыг програмаар сэргээх.  ⚠️ `SelectedItems.Add` бүр `SelectionChanged` өдөөж `UpdateDetail` (O(сонгосон))-ийг
        /// дууддаг — мянган мөр сонгосон үед O(k²) болж UI царцдаг.  Тиймээс энд тасалж, төгсгөлд НЭГ л удаа шинэчилнэ.
        /// </summary>
        private void SelectRows(IEnumerable<IssueRow> rows, HashSet<string> fingerprints)
        {
            _bulkSelecting = true;
            try
            {
                _grid.SelectedItems.Clear();
                foreach (IssueRow row in rows)
                    if (fingerprints.Contains(row.Issue.Fingerprint)) _grid.SelectedItems.Add(row);
            }
            finally { _bulkSelecting = false; }
        }

        private IssueRow ToRow(ClashIssue i, string currentHash)
        {
            string status = StatusText(i.Status);
            if (i.Unverified) status += " ⚠ баталгаагүй";
            if (currentHash != null && i.RuleHash != currentHash && _fAllRules.IsChecked != true) status += " · хуучин тохиргоо";
            return new IssueRow
            {
                Issue = i,
                Severity = SeverityText(i.Severity),
                SeverityRank = (int)i.Severity,
                SeverityBrush = SeverityBrush(i.Severity),
                Status = status,
                StatusRank = StatusRank(i.Status),
                StatusBrush = i.Status == ClashStatus.Accepted || i.Status == ClashStatus.Resolved ? UiKit.MutedBrush : UiKit.FgBrush,
                Level = i.Level ?? "",
                A = i.A.Label,
                B = i.B.Label,
                VolumeValue = i.VolumeCm3,
                Volume = i.VolumeCm3.ToString("N1", CultureInfo.CurrentCulture),
                Times = i.TimesSeen,
                First = Local(i.FirstSeenUtc),
                Last = Local(i.LastSeenUtc),
            };
        }

        private void RebuildFilterChoices()
        {
            _loading = true;
            try
            {
                string level = _levelFilter.SelectedItem as string;
                string cat = _catFilter.SelectedItem as string;

                var levels = _state.Issues.Select(i => i.Level).Where(l => !string.IsNullOrEmpty(l)).Distinct().OrderBy(l => l, StringComparer.CurrentCultureIgnoreCase).ToList();
                levels.Insert(0, AllLevels);
                _levelFilter.ItemsSource = levels;
                _levelFilter.SelectedItem = level != null && levels.Contains(level) ? level : AllLevels;

                var cats = _state.Issues.SelectMany(i => new[] { i.A.Category, i.B.Category }).Where(c => !string.IsNullOrEmpty(c)).Distinct()
                    .OrderBy(c => c, StringComparer.CurrentCultureIgnoreCase).ToList();
                cats.Insert(0, AllCategories);
                _catFilter.ItemsSource = cats;
                _catFilter.SelectedItem = cat != null && cats.Contains(cat) ? cat : AllCategories;
            }
            finally { _loading = false; }
        }

        /* ============================== SUMMARY ============================ */

        private ClashRunRecord LastRun(ClashRule rule)
        {
            if (rule == null) return null;
            return _state.Runs.Where(r => r.RuleId == rule.Id).OrderByDescending(r => r.StartedUtc).FirstOrDefault();
        }

        private static string RunStatusText(RunStatus s)
        {
            switch (s)
            {
                case RunStatus.Succeeded: return "дууссан";
                case RunStatus.Partial: return "хэсэгчилсэн";
                case RunStatus.Cancelled: return "зогсоосон";
                case RunStatus.Failed: return "алдаатай";
                case RunStatus.Running: return "явагдаж байна";
                default: return "хүлээгдэж байна";
            }
        }

        private void RefreshSummary()
        {
            ClashRule rule = SelectedRule();
            ClashRunRecord run = LastRun(rule);
            if (rule == null) { _summary.Text = "Дүрэм алга — «Шинэ»-ээр үүсгэнэ үү."; _runNotes.Text = ""; _stale.Text = ""; return; }
            if (run == null) { _summary.Text = "«" + rule.Name + "» — хараахан шалгаагүй. «Шалгах» дарна уу."; _runNotes.Text = ""; _stale.Text = ""; return; }

            long ms = run.StageMs.Values.Sum();
            var parts = new List<string>
            {
                "A " + run.ACount, "B " + run.BCount, "нэр дэвшигч " + run.Candidates,
                "баталгаажсан " + run.Confirmed, "clash биш " + run.NoClash,
            };
            if (run.Unsupported > 0) parts.Add("⚠ дэмжигдээгүй " + run.Unsupported);
            if (run.GeometryErrors > 0) parts.Add("⚠ геометрийн алдаа " + run.GeometryErrors);
            if (run.SkippedByDesign > 0) parts.Add("зориудын давхцал " + run.SkippedByDesign);
            if (run.ElementsWithoutBounds > 0) parts.Add("хэмжээсгүй элемент " + run.ElementsWithoutBounds);
            if (run.New > 0) parts.Add("шинэ " + run.New);
            if (run.Resolved > 0) parts.Add("шийдэгдсэн " + run.Resolved);
            if (run.Reappeared > 0) parts.Add("дахин илэрсэн " + run.Reappeared);

            _summary.Text = "«" + run.RuleName + "» — сүүлийн шалгалт " + Local(run.StartedUtc) + " (" + RunStatusText(run.Status) + ", "
                + (ms / 1000.0).ToString("0.0", CultureInfo.InvariantCulture) + " с): " + string.Join(" · ", parts);
            _runNotes.Text = string.Join("\n", run.Notes);
            RefreshStale();
        }

        private void RefreshStale()
        {
            ClashRunRecord run = LastRun(SelectedRule());
            if (run == null || (run.Status != RunStatus.Succeeded && run.Status != RunStatus.Partial)) { _stale.Text = ""; return; }
            bool stale;
            try { stale = _s.IsStale(run); }
            catch (Exception) { stale = true; }
            _stale.Text = stale ? "⚠ Загвар өөрчлөгдсөн — энэ үр дүн хуучирсан байж болзошгүй. «Шалгах»-аар шинэчилнэ үү." : "";
        }

        /* ============================== DETAIL ============================= */

        private List<ClashIssue> SelectedIssues()
        {
            return _grid.SelectedItems.OfType<IssueRow>().Select(r => r.Issue).ToList();
        }

        private void UpdateDetail()
        {
            List<ClashIssue> sel = SelectedIssues();
            _history.Items.Clear();
            if (sel.Count == 0)
            {
                _detail.Text = "Clash сонгоно уу.";
                _note.Text = "";
                UpdateButtons();
                return;
            }
            if (sel.Count > 1)
            {
                _detail.Text = sel.Count + " clash сонгосон — төлөв солилт бүгдэд хамаарна.";
                _note.Text = "";
                UpdateButtons();
                return;
            }

            ClashIssue i = sel[0];
            var sb = new System.Text.StringBuilder();
            sb.Append("A: ").Append(i.A.Label).Append('\n');
            sb.Append("B: ").Append(i.B.Label).Append('\n');
            sb.Append("Дүрэм: ").Append(i.RuleName).Append(" · Ноцтой байдал: ").Append(SeverityText(i.Severity));
            if (!string.IsNullOrEmpty(i.Level)) sb.Append(" · Давхар: ").Append(i.Level);
            sb.Append(" · Огтлолцол: ").Append(i.VolumeCm3.ToString("N1", CultureInfo.CurrentCulture)).Append(" см³");
            if (i.Point != null && i.Point.Length == 3)
                sb.Append(" · Төв (мм): ").Append(i.Point[0].ToString("0", CultureInfo.InvariantCulture)).Append(", ")
                  .Append(i.Point[1].ToString("0", CultureInfo.InvariantCulture)).Append(", ").Append(i.Point[2].ToString("0", CultureInfo.InvariantCulture));
            sb.Append('\n');
            sb.Append("Төлөв: ").Append(StatusText(i.Status)).Append(" · Анх илэрсэн: ").Append(Local(i.FirstSeenUtc))
              .Append(" · Сүүлд харагдсан: ").Append(Local(i.LastSeenUtc)).Append(" · ").Append(i.TimesSeen).Append(" удаа");
            if (i.ResolvedUtc.HasValue) sb.Append(" · Шийдэгдсэн: ").Append(Local(i.ResolvedUtc.Value));
            if (i.Unverified) sb.Append("\n⚠ Сүүлийн шалгалтаар энэ хосыг баталгаажуулж чадаагүй — «шийдэгдсэн» гэж ТООЦООГҮЙ.");
            _detail.Text = sb.ToString();
            _note.Text = i.Note ?? "";

            foreach (ClashHistoryEntry h in i.History.OrderByDescending(x => x.Utc))
                _history.Items.Add(Local(h.Utc) + "  " + (h.From == ClashStatus.Unknown ? "" : StatusText(h.From) + " → ") + StatusText(h.To)
                    + "  (" + ReasonText(h.Reason) + ")" + (string.IsNullOrEmpty(h.Note) ? "" : " — " + h.Note));
            UpdateButtons();
        }

        private static string ReasonText(string r)
        {
            switch (r)
            {
                case "user": return "хэрэглэгч";
                case "detected": return "илэрсэн";
                case "reappeared": return "дахин илэрсэн";
                case "deleted": return "элемент устсан";
                case "moved_apart": return "холдсон";
                case "rerun": return "дахин шалгахад clash биш";
                case "ignored_by_design": return "зориудын давхцал болсон";
                default: return r ?? "";
            }
        }

        private void UpdateButtons()
        {
            List<ClashIssue> sel = SelectedIssues();
            bool any = sel.Count > 0;
            bool editable = any && !_running && sel.Any(i => i.Status != ClashStatus.Resolved);
            _reviewBtn.IsEnabled = _acceptBtn.IsEnabled = _newStatusBtn.IsEnabled = editable;
            _saveNoteBtn.IsEnabled = editable && sel.Count == 1;
            bool one = sel.Count >= 1;
            _selABtn.IsEnabled = _selBBtn.IsEnabled = _selBothBtn.IsEnabled = _showBtn.IsEnabled = one;
            _editBtn.IsEnabled = _copyBtn.IsEnabled = _delBtn.IsEnabled = !_running && SelectedRule() != null;
            _runBtn.IsEnabled = !_running && SelectedRule() != null;
        }

        /* ============================== STATUS ============================= */

        private void ApplyStatus(ClashStatus to)
        {
            List<ClashIssue> sel = SelectedIssues().Where(i => i.Status != ClashStatus.Resolved).ToList();
            if (sel.Count == 0) return;
            if (sel.Count > 50 && MessageBox.Show(this, sel.Count + " clash-ийн төлөвийг «" + StatusText(to) + "» болгох уу?", Title,
                    MessageBoxButton.YesNo, MessageBoxImage.Question) != MessageBoxResult.Yes) return;

            string note = _note.Text;
            var fps = new HashSet<string>(sel.Select(i => i.Fingerprint), StringComparer.Ordinal);
            int changed = 0;
            string firstError = null;
            DateTime now = SmartClock.UtcNow;
            string saveError;
            bool saved = _s.UpdateState(st =>
            {
                foreach (ClashIssue issue in st.Issues)
                {
                    if (!fps.Contains(issue.Fingerprint)) continue;
                    string err;
                    // Олон clash сонгосон бол тэмдэглэл хэнд ч хадгалагдахгүй (нэгэн хэлбэрийн тэмдэглэл андуурна).
                    if (ClashReconciler.TrySetStatus(issue, to, fps.Count == 1 ? note : null, now, out err)) changed++;
                    else if (firstError == null) firstError = err;
                }
            }, out saveError);

            _state = _s.LoadState();
            RefreshAll();
            ReselectFingerprints(fps);
            _status.Text = !saved
                ? "⛔ Хадгалж чадсангүй: " + saveError
                : changed + " clash «" + StatusText(to) + "» боллоо" + (firstError != null ? " (" + firstError + ")" : "") + ".";
        }

        private void SaveNote()
        {
            List<ClashIssue> sel = SelectedIssues();
            if (sel.Count != 1) return;
            string fp = sel[0].Fingerprint;
            string note = _note.Text;
            string saveError;
            bool saved = _s.UpdateState(st =>
            {
                ClashIssue issue = st.Issues.FirstOrDefault(x => x.Fingerprint == fp);
                if (issue == null) return;
                issue.Note = string.IsNullOrWhiteSpace(note) ? null : note.Trim();
            }, out saveError);
            _state = _s.LoadState();
            RefreshAll();
            ReselectFingerprints(new HashSet<string>(new[] { fp }, StringComparer.Ordinal));
            _status.Text = saved ? "Тэмдэглэл хадгалагдлаа." : "⛔ Хадгалж чадсангүй: " + saveError;
        }

        private void ReselectFingerprints(HashSet<string> fps)
        {
            SelectRows(_grid.Items.OfType<IssueRow>().ToList(), fps);
            UpdateDetail();
        }

        /* ============================== SELECT / SHOW ====================== */

        private ClashIssue FirstSelected()
        {
            return SelectedIssues().FirstOrDefault();
        }

        private async void OnSelect(ClashTarget target)
        {
            ClashIssue issue = FirstSelected();
            if (issue == null) return;
            await Act(() => _s.SelectAsync(issue, target, CancellationToken.None));
        }

        private async void OnShow(object sender, RoutedEventArgs e)
        {
            ClashIssue issue = FirstSelected();
            if (issue == null) return;
            await Act(() => _s.ShowAsync(issue, CancellationToken.None));
        }

        private async Task Act(Func<Task<SelectOutcome>> action)
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
    }
}
