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
using RevitMcpAddin.ChangeImpact.Core;
using RevitMcpAddin.Smart.Core;
using RevitMcpAddin.Smart.Ui;

namespace RevitMcpAddin.ChangeImpact.Ui
{
    /// <summary>
    /// «Өөрчлөлтийн нөлөө» — модальгүй цонх.  Revit-ийн төрлийг мэдэхгүй (`IImpactSession`); бүх Revit ажил `await`-аар.
    ///
    ///   [Өөрчлөлт бүртгэх] [Шинэчлэх]  Эхлэх цэг: [Бүх бүртгэл ▾]  [Шалгах цэг тавих]
    ///   Шинжилгээ: [Харагдалт (C)] [Хүснэгт] [Өрөө]  [Шинжлэх] [Зогсоох]
    ///   ┌ Өөрчлөлтийн багц ┐ ┌ Нөлөөлөл: итгэл [A Шууд][B Магадлалтай][C Боломжтой][D Сул таамаг] · төрөл · хайлт ┐
    ///   └ (сонгож шинжилнэ) ┘ └ жагсаалт  →  «Яагаад?» (зам, холбоо бүрийн итгэл)  →  [Харуулах] [Хуулах] ┘
    ///
    /// ЯАГААД ИНГЭЖ:
    ///   • Итгэл бүр ӨӨРИЙН ШОШГОтой (Шууд / Магадлалтай / Боломжтой / Сул таамаг) — «таамаг» хэзээ ч «шууд» мэт харагдахгүй.
    ///   • Бүрэн БИШ шинжилгээ (хязгаар, цоорхой, устсан элементийн мэдээлэл алга) ИЛ анхааруулгатай.
    ///   • Загвар өөрчлөгдсөн бол тайлан «хуучирсан» тэмдэгтэй.
    ///   • «Яагаад?» нь замын алхам бүрийг, ШУУД ба ТААМАГ алхмыг ялгаж харуулна.
    /// </summary>
    internal sealed class ChangeImpactWindow : Window
    {
        private const int MaxRows = 3000;

        private readonly IImpactSession _s;
        private IReadOnlyList<ChangeBatch> _batches = new List<ChangeBatch>();
        private IReadOnlyList<ModelCheckpoint> _cps = new List<ModelCheckpoint>();
        private ImpactReport _report;
        private CancellationTokenSource _cts;
        private bool _running;
        private bool _loading;

        private readonly CheckBox _tracking = UiKit.Check("Өөрчлөлт бүртгэх", true);
        private readonly ComboBox _baseline = new ComboBox { MinWidth = 300, Margin = new Thickness(2) };
        private readonly Button _refreshBtn, _cpBtn, _delCpBtn, _analyzeBtn, _stopBtn, _historyBtn, _clearBtn;
        private readonly CheckBox _incVis = UiKit.Check("Харагдалт (C, удаан)", true);
        private readonly CheckBox _incSched = UiKit.Check("Хүснэгт", true);
        private readonly CheckBox _incRooms = UiKit.Check("Өрөөний хил", true);
        private readonly CheckBox _useVersion = UiKit.Check("Revit-ийн хувилбарын түүхийг нэмэх", true);
        private readonly ProgressBar _bar = new ProgressBar { Height = 6, Minimum = 0, Maximum = 1, Margin = new Thickness(2, 4, 2, 4), Visibility = Visibility.Collapsed };
        private readonly TextBlock _summary = UiKit.Text("Өөрчлөлтөө сонгоод «Шинжлэх» дарна уу.", bold: true, wrap: true);
        private readonly TextBlock _warn = UiKit.Text("", brush: UiKit.WarningBrush, wrap: true);
        private readonly TextBlock _notes = UiKit.Text("", brush: UiKit.MutedBrush, wrap: true);
        private readonly TextBlock _status = UiKit.Text("", brush: UiKit.MutedBrush, wrap: true);
        private readonly TextBlock _batchInfo = UiKit.Text("", brush: UiKit.MutedBrush, wrap: true);

        private readonly DataGrid _batchGrid = new DataGrid
        {
            AutoGenerateColumns = false, IsReadOnly = true, CanUserAddRows = false, Margin = new Thickness(2),
            SelectionMode = DataGridSelectionMode.Extended, HeadersVisibility = DataGridHeadersVisibility.Column,
            GridLinesVisibility = DataGridGridLinesVisibility.Horizontal, HorizontalGridLinesBrush = UiKit.LineBrush,
        };

        private readonly CheckBox _chipA, _chipB, _chipC, _chipD;
        private readonly ComboBox _kindFilter = new ComboBox { MinWidth = 130, Margin = new Thickness(2) };
        private readonly TextBox _search = UiKit.Box("", 170);
        private readonly TextBlock _listInfo = UiKit.Text("", brush: UiKit.MutedBrush);
        private readonly DataGrid _grid = new DataGrid
        {
            AutoGenerateColumns = false, IsReadOnly = true, CanUserAddRows = false, Margin = new Thickness(2),
            SelectionMode = DataGridSelectionMode.Single, HeadersVisibility = DataGridHeadersVisibility.Column,
            GridLinesVisibility = DataGridGridLinesVisibility.Horizontal, HorizontalGridLinesBrush = UiKit.LineBrush,
            AlternationCount = 2, AlternatingRowBackground = UiKit.AltRowBrush,
        };
        private readonly TextBlock _detail = UiKit.Text("Нөлөөлөл сонгоно уу — «Яагаад?» тайлбар энд гарна.", wrap: true);
        private readonly Button _openBtn, _copyBtn;
        private readonly DispatcherTimer _timer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(10) };

        private static readonly string[] KindLabels = { "Бүгд", "Хуудас", "Харагдац", "Хүснэгт", "Өрөө", "Tag / хэмжээс", "Бусад элемент" };
        private const string AllBatches = "Бүх бүртгэл";

        /// <summary>Нөлөөллийн жагсаалтын нэг мөр (binding-д).</summary>
        internal sealed class ItemRow
        {
            internal ImpactItem Item;
            public string Confidence { get; set; }
            public int ConfidenceRank { get; set; }
            public Brush ConfidenceBrush { get; set; }
            public string Kind { get; set; }
            public string Name { get; set; }
            public string Detail { get; set; }
            public string Reason { get; set; }
            public string Source { get; set; }
        }

        internal sealed class BatchRow
        {
            internal ChangeBatch Batch;
            public string Time { get; set; }
            public string Action { get; set; }
            public int Added { get; set; }
            public int Modified { get; set; }
            public int Deleted { get; set; }
            public string Flags { get; set; }
        }

        internal ChangeImpactWindow(IImpactSession session)
        {
            _s = session;
            Title = "MGL — Өөрчлөлтийн нөлөө · " + (session.DocumentTitle ?? "");
            Width = 1320;
            Height = 820;
            MinWidth = 1000;
            MinHeight = 620;
            ShowInTaskbar = false;
            UiKit.Prepare(this, "change-impact");

            _refreshBtn = UiKit.Btn("Шинэчлэх", (s, e) => RefreshBatches(false));
            _cpBtn = UiKit.Btn("Шалгах цэг тавих…", (s, e) => OnCheckpoint());
            _delCpBtn = UiKit.Btn("Цэг устгах", (s, e) => OnDeleteCheckpoint());
            _analyzeBtn = UiKit.Btn("Шинжлэх", OnAnalyze, 110);
            _analyzeBtn.FontWeight = FontWeights.SemiBold;
            _stopBtn = UiKit.Btn("Зогсоох", (s, e) => { if (_cts != null) _cts.Cancel(); }, 80);
            _stopBtn.IsEnabled = false;
            _historyBtn = UiKit.Btn("Түүх…", (s, e) => OnHistory());
            _clearBtn = UiKit.Btn("Бүртгэл цэвэрлэх", (s, e) => OnClearLog());
            _openBtn = UiKit.Btn("Харуулах / нээх", OnOpen);
            _copyBtn = UiKit.Btn("Жагсаалт хуулах", OnCopy);
            _openBtn.IsEnabled = _copyBtn.IsEnabled = false;

            _chipA = Chip(ImpactConfidence.A);
            _chipB = Chip(ImpactConfidence.B);
            _chipC = Chip(ImpactConfidence.C);
            _chipD = Chip(ImpactConfidence.D);
            _chipD.IsChecked = true;

            _kindFilter.ItemsSource = KindLabels;
            _kindFilter.SelectedIndex = 0;
            _tracking.IsChecked = session.TrackingEnabled;
            _tracking.ToolTip = "Унтраавал шинэ өөрчлөлт бүртгэгдэхгүй (бүртгэсэн түүх хэвээр).";
            _incVis.ToolTip = "Revit-ийн харагдацын шүүлтүүрээр элемент бүр аль харагдацад «магадгүй харагдах»-ыг шалгана — хуудсанд байрласан харагдац бүрийг уншдаг тул удаан байж болно.";
            _useVersion.ToolTip = "Сонгосон шалгах цэгийн Revit хувилбараас хойших өөрчлөлтийг (бидний бүртгэлд ороогүй, өөр session/хэрэглэгч) нэмнэ. ⚠ Revit-ийн version GUID бүх өөрчлөлтөд шинэчлэгддэггүй — нэмэлт нотолгоо л.";

            BuildBatchColumns();
            BuildResultColumns();
            Content = BuildLayout();

            _baseline.SelectionChanged += (s, e) => { if (!_loading) RefreshBatchList(); };
            _tracking.Checked += (s, e) => { if (!_loading) _s.TrackingEnabled = true; };
            _tracking.Unchecked += (s, e) => { if (!_loading) _s.TrackingEnabled = false; };
            _kindFilter.SelectionChanged += (s, e) => { if (!_loading) RefreshResults(); };
            _search.TextChanged += (s, e) => RefreshResults();
            _grid.SelectionChanged += (s, e) => UpdateDetail();
            _batchGrid.SelectionChanged += (s, e) => UpdateBatchInfo();
            _timer.Tick += (s, e) => { if (!_running && IsVisible) RefreshBatches(true); RefreshStale(); };

            _report = _s.LastReport();
            BindBaseline();
            RefreshAll();
            Loaded += (s, e) => RefreshBatches(true);
            Closed += (s, e) => { _timer.Stop(); if (_cts != null) _cts.Cancel(); };
            _timer.Start();
        }

        private CheckBox Chip(ImpactConfidence c)
        {
            CheckBox cb = UiKit.Check(ImpactConf.Letter(c) + " " + ImpactConf.Label(c), c != ImpactConfidence.D, (s, e) => { if (!_loading) RefreshResults(); });
            cb.ToolTip = ImpactConf.Meaning(c);
            cb.Foreground = ConfBrush(c);
            return cb;
        }

        /* ============================== LAYOUT ============================= */

        private UIElement BuildLayout()
        {
            var top1 = new WrapPanel { Margin = new Thickness(6, 6, 6, 0) };
            top1.Children.Add(_tracking);
            top1.Children.Add(_refreshBtn);
            top1.Children.Add(UiKit.Text("   Эхлэх цэг:", bold: true));
            top1.Children.Add(_baseline);
            top1.Children.Add(_cpBtn);
            top1.Children.Add(_delCpBtn);
            top1.Children.Add(_useVersion);
            top1.Children.Add(_historyBtn);

            var top2 = new WrapPanel { Margin = new Thickness(6, 0, 6, 0) };
            top2.Children.Add(UiKit.Text("Шинжилгээ:", bold: true));
            top2.Children.Add(_incVis);
            top2.Children.Add(_incSched);
            top2.Children.Add(_incRooms);
            top2.Children.Add(UiKit.Text("    "));
            top2.Children.Add(_analyzeBtn);
            top2.Children.Add(_stopBtn);

            var info = UiKit.Col(_bar, _summary, _warn, _notes, _status);
            info.Margin = new Thickness(8, 2, 8, 2);

            // Зүүн: өөрчлөлтийн багц.
            var left = new DockPanel { Margin = new Thickness(6, 2, 4, 6), Width = 400 };
            var leftHead = UiKit.Col(UiKit.Text("Өөрчлөлтийн багц", bold: true), _batchInfo);
            DockPanel.SetDock(leftHead, Dock.Top);
            var leftFoot = UiKit.Wrap(_clearBtn);
            DockPanel.SetDock(leftFoot, Dock.Bottom);
            left.Children.Add(leftHead);
            left.Children.Add(leftFoot);
            left.Children.Add(_batchGrid);

            // Баруун: нөлөөлөл + дэлгэрэнгүй.
            var chips = UiKit.Wrap(UiKit.Text("Итгэл:", bold: true), _chipA, _chipB, _chipC, _chipD,
                UiKit.Text("   Төрөл:"), _kindFilter, UiKit.Text("  Хайх:"), _search, UiKit.Text("   "), _listInfo);
            var detailBox = new Border
            {
                BorderThickness = new Thickness(0, 1, 0, 0), BorderBrush = UiKit.LineBrush, Padding = new Thickness(4), MaxHeight = 280,
                Child = new ScrollViewer
                {
                    VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
                    Content = UiKit.Col(_detail, UiKit.Wrap(_openBtn, _copyBtn)),
                },
            };

            var right = new Grid { Margin = new Thickness(4, 2, 6, 6) };
            right.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            right.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star), MinHeight = 120 });
            right.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            Grid.SetRow(chips, 0);
            Grid.SetRow(_grid, 1);
            Grid.SetRow(detailBox, 2);
            right.Children.Add(chips);
            right.Children.Add(_grid);
            right.Children.Add(detailBox);

            var body = new DockPanel();
            DockPanel.SetDock(left, Dock.Left);
            body.Children.Add(left);
            body.Children.Add(right);

            var top = UiKit.Col(top1, top2, info);
            var root = new DockPanel();
            DockPanel.SetDock(top, Dock.Top);
            root.Children.Add(top);
            root.Children.Add(body);
            return root;
        }

        private void BuildBatchColumns()
        {
            _batchGrid.Columns.Add(new DataGridTextColumn { Header = "Цаг", Binding = new Binding("Time") { Mode = BindingMode.OneWay }, Width = 120 });
            _batchGrid.Columns.Add(new DataGridTextColumn { Header = "Үйлдэл", Binding = new Binding("Action") { Mode = BindingMode.OneWay }, Width = new DataGridLength(1, DataGridLengthUnitType.Star) });
            _batchGrid.Columns.Add(new DataGridTextColumn { Header = "+", Binding = new Binding("Added") { Mode = BindingMode.OneWay }, Width = 36 });
            _batchGrid.Columns.Add(new DataGridTextColumn { Header = "~", Binding = new Binding("Modified") { Mode = BindingMode.OneWay }, Width = 40 });
            _batchGrid.Columns.Add(new DataGridTextColumn { Header = "−", Binding = new Binding("Deleted") { Mode = BindingMode.OneWay }, Width = 36 });
            _batchGrid.Columns.Add(new DataGridTextColumn { Header = "", Binding = new Binding("Flags") { Mode = BindingMode.OneWay }, Width = 30 });
        }

        private void BuildResultColumns()
        {
            var tb = new FrameworkElementFactory(typeof(TextBlock));
            tb.SetBinding(TextBlock.TextProperty, new Binding("Confidence") { Mode = BindingMode.OneWay });
            tb.SetBinding(TextBlock.ForegroundProperty, new Binding("ConfidenceBrush") { Mode = BindingMode.OneWay });
            tb.SetValue(FrameworkElement.MarginProperty, new Thickness(4, 1, 4, 1));
            tb.SetValue(TextBlock.FontWeightProperty, FontWeights.SemiBold);
            _grid.Columns.Add(new DataGridTemplateColumn
            {
                Header = "Итгэл", CellTemplate = new DataTemplate { VisualTree = tb }, Width = 130, SortMemberPath = "ConfidenceRank",
            });
            _grid.Columns.Add(Text("Төрөл", "Kind", 90));
            _grid.Columns.Add(Text("Нэр", "Name", 0));
            _grid.Columns.Add(Text("Дэлгэрэнгүй", "Detail", 140));
            _grid.Columns.Add(Text("Шалтгаан", "Reason", 0));
            _grid.Columns.Add(Text("Эх сурвалж", "Source", 200));
        }

        private static DataGridColumn Text(string header, string path, double width)
        {
            return new DataGridTextColumn
            {
                Header = header, Binding = new Binding(path) { Mode = BindingMode.OneWay },
                Width = width > 0 ? new DataGridLength(width) : new DataGridLength(1, DataGridLengthUnitType.Star),
            };
        }

        /* ============================== BATCHES ============================ */

        private static string Local(DateTime utc)
        {
            DateTime l = utc.ToLocalTime();
            return l.Date == DateTime.Now.Date ? l.ToString("HH:mm:ss", CultureInfo.InvariantCulture) : l.ToString("MM-dd HH:mm", CultureInfo.InvariantCulture);
        }

        private ModelCheckpoint SelectedBaseline()
        {
            var item = _baseline.SelectedItem as ComboBoxItem;
            return item != null ? item.Tag as ModelCheckpoint : null;
        }

        private void BindBaseline()
        {
            _loading = true;
            try
            {
                string keep = SelectedBaseline() != null ? SelectedBaseline().Id : null;
                _cps = _s.Checkpoints();
                _baseline.Items.Clear();
                _baseline.Items.Add(new ComboBoxItem { Content = AllBatches, Tag = null });
                int sel = 0;
                foreach (ModelCheckpoint cp in _cps)
                {
                    _baseline.Items.Add(new ComboBoxItem
                    {
                        Content = "Шалгах цэг: " + cp.Label + "  (" + Local(cp.Utc) + (cp.Kind == "publish" ? ", гаргалт" : "") + ")",
                        Tag = cp,
                    });
                    if (cp.Id == keep) sel = _baseline.Items.Count - 1;
                }
                _baseline.SelectedIndex = sel;
            }
            finally { _loading = false; }
            _delCpBtn.IsEnabled = SelectedBaseline() != null && !_running;
        }

        private async void RefreshBatches(bool silent)
        {
            try
            {
                IReadOnlyList<ChangeBatch> batches = await _s.GetBatchesAsync(CancellationToken.None);
                UiThread.Run(Dispatcher, () =>
                {
                    _batches = batches;
                    RefreshBatchList();
                    if (!silent) _status.Text = "Өөрчлөлтийн бүртгэл шинэчлэгдлээ (" + batches.Count + " багц).";
                });
            }
            catch (Exception ex)
            {
                UiThread.Run(Dispatcher, () => _status.Text = "⛔ Бүртгэл уншиж чадсангүй: " + ex.Message);
            }
        }

        private void RefreshBatchList()
        {
            ModelCheckpoint cp = SelectedBaseline();
            long from = cp != null ? cp.ChangeSeq : 0;
            var keep = new HashSet<long>(SelectedBatches().Select(b => b.Seq));

            var rows = _batches.Where(b => b.Seq > from).OrderByDescending(b => b.Seq).Select(b => new BatchRow
            {
                Batch = b,
                Time = Local(b.Utc),
                Action = b.Transactions.Count > 0 ? string.Join(", ", b.Transactions) : (b.Operation ?? ""),
                Added = b.Added, Modified = b.Modified, Deleted = b.Deleted,
                Flags = (b.Truncated ? "✂" : "") + (b.Entries.Any(e => e.Kind == ChangeKind.Deleted && !e.Known) ? "⚠" : ""),
            }).ToList();
            _batchGrid.ItemsSource = rows;
            foreach (BatchRow r in rows) if (keep.Contains(r.Batch.Seq)) _batchGrid.SelectedItems.Add(r);

            int dropped = 0;
            try { dropped = _s.DroppedBatches; } catch (Exception) { }
            _batchInfo.Text = rows.Count + " багц" + (cp != null ? " (шалгах цэгээс хойш)" : "")
                + (dropped > 0 ? " · ⚠ " + dropped + " багц бүртгэгдээгүй (цоорхой)" : "")
                + "\n✂ = хэт олон өөрчлөлт, ⚠ = устсан элементийн мэдээлэл алга.";
            UpdateBatchInfo();
        }

        private List<ChangeBatch> SelectedBatches()
        {
            return _batchGrid.SelectedItems.OfType<BatchRow>().Select(r => r.Batch).ToList();
        }

        private void UpdateBatchInfo()
        {
            int n = _batchGrid.SelectedItems.Count;
            _analyzeBtn.ToolTip = n > 0
                ? n + " сонгосон багцыг шинжилнэ."
                : "Багц сонгоогүй — «эхлэх цэг»-ээс хойших БҮХ өөрчлөлтийг шинжилнэ.";
        }

        /* ============================== CHECKPOINT ========================= */

        private async void OnCheckpoint()
        {
            string label = PromptDialog.Ask(this, "Шалгах цэг тавих",
                "Одоогийн байдлыг «шалгасан/баталсан» гэж тэмдэглэнэ. Дараа нь «энэ цэгээс хойш юу өөрчлөгдсөн бэ» гэж асууна.\n\nНэр:",
                "Шалгасан " + DateTime.Now.ToString("MM-dd HH:mm", CultureInfo.InvariantCulture));
            if (label == null) return;
            try
            {
                ModelCheckpoint cp = await _s.AddCheckpointAsync(label, CancellationToken.None);
                UiThread.Run(Dispatcher, () =>
                {
                    BindBaseline();
                    _status.Text = "Шалгах цэг хадгалагдлаа: «" + cp.Label + "».";
                });
            }
            catch (Exception ex)
            {
                UiThread.Run(Dispatcher, () => _status.Text = "⛔ " + ex.Message);
            }
        }

        private void OnDeleteCheckpoint()
        {
            ModelCheckpoint cp = SelectedBaseline();
            if (cp == null) return;
            if (MessageBox.Show(this, "«" + cp.Label + "» шалгах цэгийг устгах уу? (Өөрчлөлтийн бүртгэл хөндөгдөхгүй.)", Title,
                    MessageBoxButton.YesNo, MessageBoxImage.Question) != MessageBoxResult.Yes) return;
            string failure = null;
            try { _s.DeleteCheckpoint(cp.Id); }
            catch (Exception ex) { failure = ex.Message; }
            BindBaseline();
            RefreshBatchList();
            _status.Text = failure != null ? "⛔ " + failure : "Шалгах цэг устгагдлаа.";
        }

        private async void OnClearLog()
        {
            if (MessageBox.Show(this, "Өөрчлөлтийн бүртгэлийг (багцууд) цэвэрлэх үү?\n\nШалгах цэг, шинжилгээний түүх хөндөгдөхгүй. Гэхдээ цэвэрлэсний өмнөх өөрчлөлтийг дахин шинжлэх боломжгүй болно.",
                    Title, MessageBoxButton.YesNo, MessageBoxImage.Warning) != MessageBoxResult.Yes) return;
            try
            {
                await _s.ClearLogAsync(CancellationToken.None);
                UiThread.Run(Dispatcher, () => { _batches = new List<ChangeBatch>(); RefreshBatchList(); _status.Text = "Бүртгэл цэвэрлэгдлээ."; });
            }
            catch (Exception ex)
            {
                UiThread.Run(Dispatcher, () => _status.Text = "⛔ " + ex.Message);
            }
        }

        private void OnHistory()
        {
            var dlg = new ImpactHistoryDialog(this, _s.History(), _s.Checkpoints());
            dlg.ShowDialog();
        }

        /* ============================== ANALYZE ============================ */

        private async void OnAnalyze(object sender, RoutedEventArgs e)
        {
            ModelCheckpoint cp = SelectedBaseline();
            List<ChangeBatch> sel = SelectedBatches();
            var req = new ImpactRequest
            {
                FromSeqExclusive = cp != null ? cp.ChangeSeq : 0,
                OnlyBatchSeqs = sel.Count > 0 ? sel.Select(b => b.Seq).ToList() : null,
                IncludeVisibility = _incVis.IsChecked == true,
                IncludeSchedules = _incSched.IsChecked == true,
                IncludeRooms = _incRooms.IsChecked == true,
                BaselineVersionGuid = cp != null && _useVersion.IsChecked == true ? cp.VersionGuid : null,
            };

            bool anyBatch = _batchGrid.Items.Count > 0;
            if (!anyBatch && string.IsNullOrEmpty(req.BaselineVersionGuid))
            {
                _status.Text = "Шинжлэх өөрчлөлт алга — загварт өөрчлөлт хийсний дараа дахин оролдоно уу.";
                return;
            }

            _cts = new CancellationTokenSource();
            SetRunning(true);
            IProgress<JobProgress> progress = UiThread.Progress<JobProgress>(Dispatcher, p =>
            {
                _bar.Value = p.Fraction ?? 0;
                _status.Text = (p.Message ?? "") + (p.Total > 0 ? " " + p.Done + "/" + p.Total : "");
            });

            ImpactReport report = null;
            string error = null;
            bool cancelled = false;
            try { report = await _s.AnalyzeAsync(req, progress, _cts.Token); }
            catch (OperationCanceledException) { cancelled = true; }
            catch (Exception ex) { error = ex.Message; }

            UiThread.Run(Dispatcher, () =>
            {
                if (report != null) { _report = report; RefreshAll(); _status.Text = ""; }
                else
                {
                    // Өмнөх (хуучин) дүн дэлгэц дээр хэвээр үлдэнэ — түүний «бүрэн бус / хуучирсан» анхааруулга ХЭЗЭЭ Ч нуугдахгүй.
                    RefreshSummary();
                    RefreshStale();
                    _status.Text = cancelled ? "Зогсоосон — шинэ дүн хадгалагдаагүй." : "⛔ " + error;
                }
                SetRunning(false);
            });
        }

        private void SetRunning(bool running)
        {
            _running = running;
            _analyzeBtn.IsEnabled = !running;
            _stopBtn.IsEnabled = running;
            foreach (Button b in new[] { _refreshBtn, _cpBtn, _delCpBtn, _clearBtn }) b.IsEnabled = !running;
            _baseline.IsEnabled = !running;
            _bar.Visibility = running ? Visibility.Visible : Visibility.Collapsed;
            _bar.Value = 0;
            _delCpBtn.IsEnabled = !running && SelectedBaseline() != null;
        }

        /* ============================== RESULTS ============================ */

        private static Brush ConfBrush(ImpactConfidence c)
        {
            switch (ImpactConf.Normalize(c))
            {
                case ImpactConfidence.A: return UiKit.BlockingBrush;
                case ImpactConfidence.B: return UiKit.WarningBrush;
                case ImpactConfidence.C: return UiKit.InfoBrush;
                default: return UiKit.MutedBrush;
            }
        }

        private static string KindText(ImpactNodeKind k)
        {
            switch (k)
            {
                case ImpactNodeKind.Sheet: return "Хуудас";
                case ImpactNodeKind.View: return "Харагдац";
                case ImpactNodeKind.Schedule: return "Хүснэгт";
                case ImpactNodeKind.Placement: return "Байрлал";
                case ImpactNodeKind.Tag: return "Tag";
                case ImpactNodeKind.Dimension: return "Хэмжээс";
                case ImpactNodeKind.Room: return "Өрөө";
                case ImpactNodeKind.Level: return "Давхар";
                case ImpactNodeKind.Type: return "Төрөл";
                case ImpactNodeKind.Link: return "Линк";
                case ImpactNodeKind.Group: return "Групп";
                case ImpactNodeKind.Global: return "Төслийн тохиргоо";
                default: return "Элемент";
            }
        }

        private bool KindShown(ImpactNodeKind k)
        {
            switch (_kindFilter.SelectedIndex)
            {
                case 1: return k == ImpactNodeKind.Sheet;
                case 2: return k == ImpactNodeKind.View;
                case 3: return k == ImpactNodeKind.Schedule;
                case 4: return k == ImpactNodeKind.Room;
                case 5: return k == ImpactNodeKind.Tag || k == ImpactNodeKind.Dimension;
                case 6: return k != ImpactNodeKind.Sheet && k != ImpactNodeKind.View && k != ImpactNodeKind.Schedule && k != ImpactNodeKind.Room
                                && k != ImpactNodeKind.Tag && k != ImpactNodeKind.Dimension;
                default: return true;
            }
        }

        private bool ConfShown(ImpactConfidence c)
        {
            switch (ImpactConf.Normalize(c))
            {
                case ImpactConfidence.A: return _chipA.IsChecked == true;
                case ImpactConfidence.B: return _chipB.IsChecked == true;
                case ImpactConfidence.C: return _chipC.IsChecked == true;
                default: return _chipD.IsChecked == true;
            }
        }

        private void RefreshAll()
        {
            RefreshSummary();
            RefreshResults();
            RefreshStale();
        }

        private void RefreshSummary()
        {
            if (_report == null)
            {
                _summary.Text = "Өөрчлөлтөө сонгоод «Шинжлэх» дарна уу.";
                _notes.Text = "";
                _warn.Text = "";
                return;
            }

            ImpactReport r = _report;
            int Count(ImpactConfidence c) { return r.Items.Count(i => ImpactConf.Normalize(i.Confidence) == c); }
            double sec = r.StageMs.Values.Sum() / 1000.0;
            _summary.Text = "Шинжилгээ " + Local(r.Utc) + ": " + r.SourceCount + " өөрчилсөн элемент (+" + r.Added + " ~" + r.Modified + " −" + r.Deleted + ") → "
                + r.Items.Count + " нөлөөлөл · хуудас " + r.Items.Count(i => i.Kind == ImpactNodeKind.Sheet)
                + " · A " + Count(ImpactConfidence.A) + " · B " + Count(ImpactConfidence.B) + " · C " + Count(ImpactConfidence.C) + " · D " + Count(ImpactConfidence.D)
                + " · " + sec.ToString("0.0", CultureInfo.InvariantCulture) + " с";
            _notes.Text = string.Join("\n", r.Notes);
            _warn.Text = r.Incomplete
                ? "⚠ Энэ шинжилгээ БҮРЭН БИШ — «нөлөөлөл олдсонгүй» гэдэг нь «нөлөөлөхгүй» гэсэн үг БИШ. Доорх тэмдэглэлийг уншина уу."
                : "";
        }

        private void RefreshStale()
        {
            if (_report == null) return;
            bool stale;
            try { stale = _s.IsStale(_report); }
            catch (Exception) { stale = true; }
            if (stale && !_warn.Text.Contains("хуучирсан"))
                _warn.Text = (_warn.Text.Length > 0 ? _warn.Text + "\n" : "") + "⚠ Загвар өөрчлөгдсөн — энэ тайлан хуучирсан байж болзошгүй. «Шинжлэх»-ээр шинэчилнэ үү.";
        }

        private void RefreshResults()
        {
            if (_loading) return;
            var keep = _grid.SelectedItem as ItemRow;
            long keepId = keep != null ? keep.Item.Id : -1;

            if (_report == null)
            {
                _grid.ItemsSource = null;
                _listInfo.Text = "";
                UpdateDetail();
                return;
            }

            _chipA.Content = "A Шууд (" + _report.Items.Count(i => ImpactConf.Normalize(i.Confidence) == ImpactConfidence.A) + ")";
            _chipB.Content = "B Магадлалтай (" + _report.Items.Count(i => ImpactConf.Normalize(i.Confidence) == ImpactConfidence.B) + ")";
            _chipC.Content = "C Боломжтой (" + _report.Items.Count(i => ImpactConf.Normalize(i.Confidence) == ImpactConfidence.C) + ")";
            _chipD.Content = "D Сул таамаг (" + _report.Items.Count(i => ImpactConf.Normalize(i.Confidence) == ImpactConfidence.D) + ")";

            string q = (_search.Text ?? "").Trim();
            List<ImpactItem> shown = _report.Items.Where(i => ConfShown(i.Confidence) && KindShown(i.Kind) && (q.Length == 0 || Matches(i, q))).ToList();
            var rows = shown.Take(MaxRows).Select(ToRow).ToList();
            _grid.ItemsSource = rows;
            _listInfo.Text = shown.Count > MaxRows ? "Харагдаж байгаа: " + MaxRows + " / " + shown.Count : "Харагдаж байгаа: " + shown.Count;
            ItemRow again = rows.FirstOrDefault(r => r.Item.Id == keepId);
            if (again != null) _grid.SelectedItem = again;
            UpdateDetail();
        }

        private static bool Matches(ImpactItem i, string q)
        {
            Func<string, bool> has = s => !string.IsNullOrEmpty(s) && s.IndexOf(q, StringComparison.CurrentCultureIgnoreCase) >= 0;
            return has(i.Name) || has(i.Detail) || has(i.Reason) || has(i.SourceLabel) || has(i.SheetNumber);
        }

        private static ItemRow ToRow(ImpactItem i)
        {
            return new ItemRow
            {
                Item = i,
                Confidence = ImpactConf.Letter(i.Confidence) + " · " + ImpactConf.Label(i.Confidence),
                ConfidenceRank = ImpactConf.Rank(i.Confidence),
                ConfidenceBrush = ConfBrush(i.Confidence),
                Kind = KindText(i.Kind),
                Name = i.Name,
                Detail = i.Detail,
                Reason = i.Reason,
                Source = i.SourceLabel,
            };
        }

        private void UpdateDetail()
        {
            var row = _grid.SelectedItem as ItemRow;
            _openBtn.IsEnabled = row != null;
            _copyBtn.IsEnabled = _grid.Items.Count > 0;
            if (row == null)
            {
                _detail.Text = "Нөлөөлөл сонгоно уу — «Яагаад?» тайлбар энд гарна.";
                return;
            }
            _detail.Text = "Яагаад?\n" + string.Join("\n", ImpactExplainer.Describe(row.Item));
        }

        /* ============================== ACTIONS ============================ */

        private async void OnOpen(object sender, RoutedEventArgs e)
        {
            var row = _grid.SelectedItem as ItemRow;
            if (row == null) return;
            try
            {
                SelectOutcome o = await _s.ShowAsync(row.Item, CancellationToken.None);
                UiThread.Run(Dispatcher, () => _status.Text = o.Message);
            }
            catch (Exception ex)
            {
                UiThread.Run(Dispatcher, () => _status.Text = "⛔ " + ex.Message);
            }
        }

        private void OnCopy(object sender, RoutedEventArgs e)
        {
            var rows = _grid.Items.OfType<ItemRow>().ToList();
            if (rows.Count == 0) return;
            try
            {
                var sb = new System.Text.StringBuilder();
                sb.Append("Итгэл\tТөрөл\tНэр\tДэлгэрэнгүй\tШалтгаан\tЭх сурвалж\n");
                foreach (ItemRow r in rows)
                    sb.Append(r.Confidence).Append('\t').Append(r.Kind).Append('\t').Append(Tsv(r.Name)).Append('\t').Append(Tsv(r.Detail)).Append('\t')
                      .Append(Tsv(r.Reason)).Append('\t').Append(Tsv(r.Source)).Append('\n');
                Clipboard.SetText(sb.ToString());
                _status.Text = rows.Count + " мөр хуулагдлаа — Excel руу буулгана уу.";
            }
            catch (Exception ex)
            {
                _status.Text = "Хуулж чадсангүй (" + ex.GetType().Name + ").";
            }
        }

        private static string Tsv(string s)
        {
            return (s ?? "").Replace('\t', ' ').Replace('\r', ' ').Replace('\n', ' ');
        }
    }

    /// <summary>Богино бичвэр асуух (шалгах цэгийн нэр).  `null` = Болих.  Дундын <c>Ui/MglPrompt</c> руу дамжуулна (өмнө нь давхардсан хуулбар байв).</summary>
    internal static class PromptDialog
    {
        internal static string Ask(Window owner, string title, string prompt, string initial)
        {
            return global::RevitMcpAddin.Ui.MglPrompt.Ask(owner, title, prompt, initial, requireText: true);
        }
    }

    /// <summary>Шинжилгээний түүх + шалгах цэгүүд (зөвхөн унших).</summary>
    internal sealed class ImpactHistoryDialog : Window
    {
        internal ImpactHistoryDialog(Window owner, IReadOnlyList<ImpactReportHeader> history, IReadOnlyList<ModelCheckpoint> checkpoints)
        {
            Title = "Шинжилгээний түүх";
            Owner = owner;
            WindowStartupLocation = WindowStartupLocation.CenterOwner;
            Width = 760;
            Height = 520;
            ShowInTaskbar = false;
            UiKit.Prepare(this, "impact-history");

            var hist = new ListBox { Margin = new Thickness(2) };
            foreach (ImpactReportHeader h in history)
                hist.Items.Add(h.Utc.ToLocalTime().ToString("yyyy-MM-dd HH:mm", CultureInfo.InvariantCulture) + "  ·  " + h.SourceCount + " өөрчлөлт → " + h.TotalItems
                    + " нөлөөлөл (хуудас " + h.Sheets + ", шууд " + h.DirectCount + ")" + (h.Incomplete ? "  ⚠ бүрэн бус" : ""));
            if (history.Count == 0) hist.Items.Add("Шинжилгээ хараахан хийгдээгүй.");

            var cps = new ListBox { Margin = new Thickness(2) };
            foreach (ModelCheckpoint c in checkpoints)
                cps.Items.Add(c.Utc.ToLocalTime().ToString("yyyy-MM-dd HH:mm", CultureInfo.InvariantCulture) + "  ·  " + c.Label + (c.Kind == "publish" ? "  (гаргалт)" : ""));
            if (checkpoints.Count == 0) cps.Items.Add("Шалгах цэг алга.");

            var g = new Grid { Margin = new Thickness(8) };
            g.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            g.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
            g.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            g.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
            var h1 = UiKit.Text("Өмнөх шинжилгээ (хамгийн сүүлийнх нь л бүтэн хадгалагдсан)", bold: true);
            var h2 = UiKit.Text("Шалгах цэгүүд", bold: true);
            Grid.SetRow(h1, 0); Grid.SetRow(hist, 1); Grid.SetRow(h2, 2); Grid.SetRow(cps, 3);
            g.Children.Add(h1); g.Children.Add(hist); g.Children.Add(h2); g.Children.Add(cps);
            Content = g;
        }
    }
}
