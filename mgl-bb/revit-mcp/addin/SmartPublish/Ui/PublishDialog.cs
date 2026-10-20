using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.ComponentModel;
using System.Diagnostics;
using System.Linq;
using System.Text;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Data;
using System.Windows.Threading;
using RevitMcpAddin.Smart.Core;
using RevitMcpAddin.Smart.Ui;
using RevitMcpAddin.SmartPublish.Core;

namespace RevitMcpAddin.SmartPublish.Ui
{
    internal enum PublishDialogAction { None = 0, Publish, Retry, AnalyzeChanges }

    /// <summary>Цонхноос командад буцах шийдвэр.  Командыг Revit API контекстод ажиллуулна.</summary>
    internal sealed class PublishDialogResult
    {
        public PublishDialogAction Action { get; set; }
        public PublishProfile Profile { get; set; }
        public List<PublishItem> Items { get; set; } = new List<PublishItem>();
        public PublishPlan Plan { get; set; }
        public PreflightReport Report { get; set; }
        public PublishRun RetryOf { get; set; }
        /// <summary>Хэрэглэгчийн сонгосон (профайлаас өөр байж болох) үндсэн хавтас.</summary>
        public string BaseFolder { get; set; }
    }

    internal sealed class ItemRow : NotifyBase
    {
        private bool _selected;
        private string _flag;
        public PublishItem Item { get; set; }
        public string Number { get { return Item.Number; } }
        public string Name { get { return Item.Name; } }
        public string Kind { get { return Item.Kind == PublishItemKind.Sheet ? "Хуудас" : (Item.ViewType ?? "Харагдац"); } }
        public string Revision { get { return Item.RevisionNumber; } }
        public string LastPublished { get; set; }
        /// <summary>«Өөрчлөлт» багана: нөлөөлөгдсөн / санал / олдсонгүй / хараахан гаргаагүй / шинжлээгүй.</summary>
        public string Change { get; set; }
        public System.Windows.Media.Brush ChangeBrush { get; set; }
        /// <summary>«Яагаад?» — нөлөөллийн шалтгаанууд (багана дээр хулганаа аваачихад).</summary>
        public string ToolTipText { get; set; }
        public bool Selected { get { return _selected; } set { Set(ref _selected, value); } }
        /// <summary>Preflight-ийн тэмдэглэгээ: «⛔» блоклосон, «⚠» анхааруулга.</summary>
        public string Flag { get { return _flag; } set { Set(ref _flag, value); } }
    }

    internal sealed class PlanRow
    {
        public string Label { get; set; }
        public string Format { get; set; }
        public string FileName { get; set; }
        public string Action { get; set; }
        public string Folder { get; set; }
    }

    internal sealed class FindingRow
    {
        public string Severity { get; set; }
        public string SeverityText { get; set; }
        public string Message { get; set; }
        public string Hint { get; set; }
        public System.Windows.Media.Brush Brush { get; set; }
    }

    internal sealed class RunRow
    {
        public PublishRun Run { get; set; }
        public string When { get { return Run.StartedUtc.ToLocalTime().ToString("yyyy-MM-dd HH:mm"); } }
        public string Profile { get { return Run.ProfileName + (Run.ParentRunId != null ? " (дахин)" : ""); } }
        public string Status { get { return StatusOf(Run); } }
        public string Counts
        {
            get
            {
                int ok = Run.Artifacts.Count(a => a.Status == ArtifactStatus.Succeeded);
                int bad = Run.Artifacts.Count(a => a.Status == ArtifactStatus.Failed);
                int cancelled = Run.Artifacts.Count(a => a.Status == ArtifactStatus.Cancelled);
                return ok + " ✓" + (bad > 0 ? "  " + bad + " ✕" : "") + (cancelled > 0 ? "  " + cancelled + " —" : "");
            }
        }

        /// <summary>
        /// Гүйлтийн төлөв.  Бүх файл «алгассан» (байгаа файл, SkipExisting) бол ШИНЭ юу ч гараагүй — «Амжилттай» гэж харуулахгүй (хэрэглэгч
        /// файлууд шинэчлэгдсэн гэж ойлгоно).
        /// </summary>
        internal static string StatusOf(PublishRun run)
        {
            if (run.Status == RunStatus.Succeeded && run.Artifacts.Count > 0
                && run.Artifacts.All(a => a.Status == ArtifactStatus.Skipped))
                return "Алгассан — шинэ файл гараагүй";
            return StatusText(run.Status);
        }

        internal static string StatusText(RunStatus s)
        {
            switch (s)
            {
                case RunStatus.Running: return "Явагдаж байна (дуусаагүй)";
                case RunStatus.Succeeded: return "Амжилттай";
                case RunStatus.Partial: return "Хэсэгчлэн";
                case RunStatus.Failed: return "Бүтэлгүйтсэн";
                case RunStatus.Cancelled: return "Цуцлагдсан";
                default: return "—";
            }
        }
    }

    /// <summary>
    /// «Smart Publish»-ийн гол цонх: профайл → хуудас → урьдчилан харах → preflight → гаргах → түүх.
    ///
    /// ГЭРЭЭ: цонх нь Revit-ийн API-д ХЭЗЭЭ Ч хүрэхгүй (`IPublishSession`).  «Гаргах» нь зөвхөн шийдвэр
    /// (`PublishDialogResult`) буцааж хаагдана; бодит экспорт командын Revit API контекстод явагдана.
    /// Preflight ба урьдчилан харах нь ЦЭВЭР тул өөрчлөлт бүрд (300 мс debounce) шууд шинэчлэгдэнэ.
    /// </summary>
    internal sealed class PublishDialog : Window
    {
        private readonly IPublishSession _s;
        private PublishProfile _profile;
        private readonly ObservableCollection<ItemRow> _rows = new ObservableCollection<ItemRow>();
        private readonly ObservableCollection<PlanRow> _planRows = new ObservableCollection<PlanRow>();
        private readonly ObservableCollection<FindingRow> _findRows = new ObservableCollection<FindingRow>();
        private readonly ObservableCollection<RunRow> _runRows = new ObservableCollection<RunRow>();
        private readonly ComboBox _profileCombo = new ComboBox { MinWidth = 280, Margin = new Thickness(2) };
        private readonly TextBox _filter = UiKit.Box("", 160);
        private readonly TextBox _folder = UiKit.Box("", 300);
        private readonly DataGrid _itemsGrid, _planGrid, _findGrid, _runGrid;
        private readonly TextBlock _summary = UiKit.Text("", wrap: true);
        private readonly TextBox _runDetails = new TextBox { IsReadOnly = true, TextWrapping = TextWrapping.Wrap, VerticalScrollBarVisibility = ScrollBarVisibility.Auto, Margin = new Thickness(2) };
        private readonly TabControl _tabs = new TabControl { Margin = new Thickness(0, 6, 0, 0) };
        private readonly Button _publishBtn, _retryBtn, _analyzeBtn, _affectedBtn, _suggestedBtn;
        private readonly TextBlock _changeInfo = UiKit.Text("", wrap: true);
        private readonly DispatcherTimer _debounce = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(300) };
        private readonly ICollectionView _itemsView;
        private bool _loading;
        private PublishPlan _plan;
        private PreflightReport _report;

        public PublishDialogResult Result { get; private set; }

        public PublishDialog(IPublishSession session, string initialTab = null)
        {
            _s = session;
            Title = "MGL — Файл гаргах · " + (session.DocumentTitle ?? "");
            Width = 1180;
            Height = 780;
            MinWidth = 900;
            MinHeight = 560;
            WindowStartupLocation = WindowStartupLocation.CenterOwner;
            UiKit.Prepare(this, "publish");

            _itemsGrid = BuildItemsGrid();
            _planGrid = BuildPlanGrid();
            _findGrid = BuildFindingsGrid();
            _runGrid = BuildRunGrid();
            _itemsView = CollectionViewSource.GetDefaultView(_rows);
            _itemsGrid.ItemsSource = _itemsView;
            _planGrid.ItemsSource = _planRows;
            _findGrid.ItemsSource = _findRows;
            _runGrid.ItemsSource = _runRows;

            _publishBtn = UiKit.Btn("Гаргах", OnPublish, 110);
            _publishBtn.FontWeight = FontWeights.SemiBold;
            _retryBtn = UiKit.Btn("Бүтэлгүйтсэнийг дахин оролдох", OnRetry);
            _retryBtn.IsEnabled = false;

            _analyzeBtn = UiKit.Btn("Өөрчлөлт шинжлэх…", OnAnalyzeChanges);
            _analyzeBtn.ToolTip = "Сүүлийн гаргалтаас хойш аль хуудас өөрчлөгдсөнийг «Өөрчлөлтийн нөлөө»-ийн бүртгэлээр тодорхойлно (хэдэн секундээс минут). Дараа нь сонголтыг санал болгоно.";
            _affectedBtn = UiKit.Btn("Нөлөөлөгдсөнийг сонгох", (s, e) => SelectAffected());
            _affectedBtn.ToolTip = "ШУУД (A) нөлөөлөлтэй + хараахан гаргаагүй хуудсыг сонгоно.";
            _suggestedBtn = UiKit.Btn("+ Санал болгосныг нэмэх", (s, e) => AddSuggested());
            _suggestedBtn.ToolTip = "Магадлалтай/боломжтой/сул нөлөөлөлтэй, мөн «өөрчлөгдөөгүй гэж батлах боломжгүй» хуудсыг сонголтод НЭМНЭ.";
            // Шинжилгээ ПРОФАЙЛД холбоотой тул товчны төлөвийг профайл сонгогдсоны дараа `UpdateChangeInfo` тогтооно.
            _affectedBtn.IsEnabled = _suggestedBtn.IsEnabled = false;

            Content = BuildLayout();

            _debounce.Tick += (s, e) => { _debounce.Stop(); Refresh(); };
            _filter.TextChanged += (s, e) => { _itemsView.Filter = FilterRow; _itemsView.Refresh(); };
            _folder.TextChanged += (s, e) => Schedule();
            _profileCombo.SelectionChanged += OnProfileChanged;
            _runGrid.SelectionChanged += OnRunSelected;

            BindProfiles(session.Profiles.LastProfileId);
            LoadRuns();
            if (initialTab == "history") _tabs.SelectedIndex = 2;
            UpdateChangeInfo();
            // Шинжилгээ дөнгөж хийгдсэн бол анхны сонголт = «нөлөөлөгдсөн» (A + хараахан гаргаагүй); санал болгосныг хэрэглэгч нэмнэ.
            if (CurrentAffected() != null && initialTab != "history") SelectAffected();
        }

        /// <summary>
        /// Одоо сонгосон профайлд ХҮЧИНТЭЙ шинжилгээ (эсвэл null).  Шинжилгээ нь хуудас бүрийн checkpoint-оос (профайл тутамд) гардаг тул ӨӨР профайл руу
        /// шилжихэд харуулах/сонгоход ашиглах нь буруу: энэ профайлаар хараахан гаргаагүй хуудас нөгөө профайлаар «гарсан» мэт харагдана.
        /// </summary>
        private AffectedPublishSet CurrentAffected()
        {
            AffectedPublishSet a = _s.Affected;
            if (a == null || _profile == null) return null;
            return a.AppliesTo(_profile.Id, _profile.Formats) ? a : null;
        }

        protected override void OnClosed(EventArgs e)
        {
            // Debounce таймер цонх хаагдсаны дараа ажиллаж хаагдсан цонхны control-д хүрэхээс сэргийлнэ.
            _debounce.Stop();
            base.OnClosed(e);
        }

        /* ============================== LAYOUT ============================= */

        private UIElement BuildLayout()
        {
            var top = new WrapPanel { Margin = new Thickness(6, 6, 6, 0) };
            top.Children.Add(UiKit.Text("Профайл:", bold: true));
            top.Children.Add(_profileCombo);
            top.Children.Add(UiKit.Btn("Засах…", (s, e) => EditProfile(false)));
            top.Children.Add(UiKit.Btn("Шинэ…", (s, e) => EditProfile(true)));
            top.Children.Add(UiKit.Btn("Хуулах", (s, e) => CopyProfile()));
            top.Children.Add(UiKit.Btn("Устгах", (s, e) => DeleteProfile()));
            top.Children.Add(UiKit.Btn("Жишээ профайл сэргээх", (s, e) => RestoreStarters()));

            // Зүүн: хуудаснууд
            var selButtons = new WrapPanel();
            selButtons.Children.Add(UiKit.Btn("Бүгдийг", (s, e) => SetVisible(true)));
            selButtons.Children.Add(UiKit.Btn("Хоосолох", (s, e) => SetVisible(false)));
            selButtons.Children.Add(UiKit.Btn("Профайлын дүрмээр", (s, e) => ApplyRule()));
            selButtons.Children.Add(UiKit.Btn("Блоклосныг хасах", (s, e) => DropBlocked()));
            selButtons.Children.Add(UiKit.Btn("Хараахан гаргаагүйг", (s, e) => SelectNeverPublished()));
            var changeButtons = new WrapPanel { Margin = new Thickness(0, 4, 0, 0) };
            changeButtons.Children.Add(UiKit.Text("Өөрчлөлт:", bold: true));
            changeButtons.Children.Add(_analyzeBtn);
            changeButtons.Children.Add(_affectedBtn);
            changeButtons.Children.Add(_suggestedBtn);
            var leftTop = new StackPanel();
            leftTop.Children.Add(UiKit.Row(UiKit.Text("Хайх:"), _filter));
            leftTop.Children.Add(selButtons);
            leftTop.Children.Add(changeButtons);
            leftTop.Children.Add(_changeInfo);
            var left = new DockPanel { Margin = new Thickness(6) };
            DockPanel.SetDock(leftTop, Dock.Top);
            left.Children.Add(leftTop);
            left.Children.Add(_itemsGrid);

            // Баруун: табууд
            var previewTab = new TabItem { Header = "Урьдчилан харах", Content = _planGrid };
            var preflightTab = new TabItem { Header = "Гаргахын өмнөх шалгалт", Content = _findGrid };

            var runButtons = UiKit.Row(_retryBtn, UiKit.Btn("Хавтас нээх", (s, e) => OpenRunFolder()));
            var historyGrid = new Grid();
            historyGrid.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star), MinHeight = 80 });
            historyGrid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            historyGrid.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1.4, GridUnitType.Star), MinHeight = 80 });
            Grid.SetRow(_runGrid, 0);
            Grid.SetRow(runButtons, 1);
            Grid.SetRow(_runDetails, 2);
            historyGrid.Children.Add(_runGrid);
            historyGrid.Children.Add(runButtons);
            historyGrid.Children.Add(_runDetails);
            var historyTab = new TabItem { Header = "Түүх", Content = historyGrid };

            _tabs.Items.Add(previewTab);
            _tabs.Items.Add(preflightTab);
            _tabs.Items.Add(historyTab);

            var split = new Grid { Margin = new Thickness(0) };
            // Зүүн (хуудасны жагсаалт) нь «Өөрчлөлт» баганатай болсон тул арай өргөн.
            split.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(7, GridUnitType.Star), MinWidth = 340 });
            split.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(6, GridUnitType.Star), MinWidth = 320 });
            Grid.SetColumn(left, 0);
            Grid.SetColumn(_tabs, 1);
            _tabs.Margin = new Thickness(0, 6, 6, 6);
            split.Children.Add(left);
            split.Children.Add(_tabs);

            // Доор: хавтас + дүгнэлт + товч
            var browse = UiKit.Btn("Хавтас…", (s, e) =>
            {
                string picked = FolderPicker.Pick(this, _folder.Text, "Гаргах үндсэн хавтас");
                if (picked != null) _folder.Text = picked;
            });
            var close = UiKit.Btn("Хаах", (s, e) => { Result = null; DialogResult = false; }, 80);
            close.IsCancel = true;
            var bottomButtons = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Right };
            bottomButtons.Children.Add(_publishBtn);
            bottomButtons.Children.Add(close);
            var folderRow = UiKit.Row(UiKit.Text("Үндсэн хавтас:", bold: true), _folder, browse);
            var bottom = new DockPanel { Margin = new Thickness(6) };
            DockPanel.SetDock(bottomButtons, Dock.Right);
            DockPanel.SetDock(folderRow, Dock.Top);
            bottom.Children.Add(bottomButtons);
            bottom.Children.Add(folderRow);
            bottom.Children.Add(_summary);

            var root = new DockPanel();
            DockPanel.SetDock(top, Dock.Top);
            DockPanel.SetDock(bottom, Dock.Bottom);
            root.Children.Add(top);
            root.Children.Add(bottom);
            root.Children.Add(split);
            return root;
        }

        private DataGrid NewGrid()
        {
            return new DataGrid
            {
                AutoGenerateColumns = false,
                CanUserAddRows = false,
                CanUserDeleteRows = false,
                IsReadOnly = true,
                HeadersVisibility = DataGridHeadersVisibility.Column,
                GridLinesVisibility = DataGridGridLinesVisibility.Horizontal,
                SelectionMode = DataGridSelectionMode.Single,
                Margin = new Thickness(2),
            };
        }

        private DataGrid BuildItemsGrid()
        {
            DataGrid g = NewGrid();
            g.IsReadOnly = false;
            var check = new DataGridCheckBoxColumn { Header = "✓", Binding = new Binding("Selected") { Mode = BindingMode.TwoWay, UpdateSourceTrigger = UpdateSourceTrigger.PropertyChanged }, Width = 36 };
            g.Columns.Add(check);
            g.Columns.Add(new DataGridTextColumn { Header = "", Binding = new Binding("Flag") { Mode = BindingMode.OneWay }, Width = 28, IsReadOnly = true });
            g.Columns.Add(new DataGridTextColumn { Header = "Дугаар", Binding = new Binding("Number") { Mode = BindingMode.OneWay }, Width = 90, IsReadOnly = true });
            g.Columns.Add(new DataGridTextColumn { Header = "Нэр", Binding = new Binding("Name") { Mode = BindingMode.OneWay }, Width = new DataGridLength(1, DataGridLengthUnitType.Star), MinWidth = 170, IsReadOnly = true });
            g.Columns.Add(new DataGridTextColumn { Header = "Төрөл", Binding = new Binding("Kind") { Mode = BindingMode.OneWay }, Width = 80, IsReadOnly = true });
            g.Columns.Add(new DataGridTextColumn { Header = "Ревиз", Binding = new Binding("Revision") { Mode = BindingMode.OneWay }, Width = 50, IsReadOnly = true });
            g.Columns.Add(new DataGridTextColumn { Header = "Сүүлд гаргасан", Binding = new Binding("LastPublished") { Mode = BindingMode.OneWay }, Width = 130, IsReadOnly = true });

            // «Өөрчлөлт» — шинжилгээний ангилал (өнгөтэй).  Шинжилгээ хийгээгүй бол хоосон.
            var change = new FrameworkElementFactory(typeof(TextBlock));
            change.SetBinding(TextBlock.TextProperty, new Binding("Change") { Mode = BindingMode.OneWay });
            change.SetBinding(TextBlock.ForegroundProperty, new Binding("ChangeBrush") { Mode = BindingMode.OneWay });
            change.SetBinding(FrameworkElement.ToolTipProperty, new Binding("ToolTipText") { Mode = BindingMode.OneWay });
            change.SetValue(FrameworkElement.MarginProperty, new Thickness(3, 1, 3, 1));
            g.Columns.Add(new DataGridTemplateColumn
            {
                Header = "Өөрчлөлт", Width = 200, IsReadOnly = true, SortMemberPath = "Change",
                CellTemplate = new DataTemplate { VisualTree = change },
            });
            return g;
        }

        private DataGrid BuildPlanGrid()
        {
            DataGrid g = NewGrid();
            g.Columns.Add(new DataGridTextColumn { Header = "Хуудас", Binding = new Binding("Label"), Width = new DataGridLength(2, DataGridLengthUnitType.Star) });
            g.Columns.Add(new DataGridTextColumn { Header = "Формат", Binding = new Binding("Format"), Width = 60 });
            g.Columns.Add(new DataGridTextColumn { Header = "Файл", Binding = new Binding("FileName"), Width = new DataGridLength(3, DataGridLengthUnitType.Star) });
            g.Columns.Add(new DataGridTextColumn { Header = "Үйлдэл", Binding = new Binding("Action"), Width = 110 });
            g.Columns.Add(new DataGridTextColumn { Header = "Хавтас", Binding = new Binding("Folder"), Width = new DataGridLength(2, DataGridLengthUnitType.Star) });
            return g;
        }

        private DataGrid BuildFindingsGrid()
        {
            DataGrid g = NewGrid();
            var sev = new DataGridTextColumn { Header = "Түвшин", Binding = new Binding("SeverityText"), Width = 90 };
            g.Columns.Add(sev);
            g.Columns.Add(new DataGridTextColumn { Header = "Асуудал", Binding = new Binding("Message"), Width = new DataGridLength(3, DataGridLengthUnitType.Star) });
            g.Columns.Add(new DataGridTextColumn { Header = "Хэрхэн засах", Binding = new Binding("Hint"), Width = new DataGridLength(2, DataGridLengthUnitType.Star) });
            var style = new Style(typeof(DataGridRow));
            style.Setters.Add(new Setter(Control.ForegroundProperty, new Binding("Brush")));
            g.RowStyle = style;
            return g;
        }

        private DataGrid BuildRunGrid()
        {
            DataGrid g = NewGrid();
            g.Columns.Add(new DataGridTextColumn { Header = "Хэзээ", Binding = new Binding("When"), Width = 120 });
            g.Columns.Add(new DataGridTextColumn { Header = "Профайл", Binding = new Binding("Profile"), Width = new DataGridLength(1, DataGridLengthUnitType.Star) });
            g.Columns.Add(new DataGridTextColumn { Header = "Төлөв", Binding = new Binding("Status"), Width = 150 });
            g.Columns.Add(new DataGridTextColumn { Header = "Файл", Binding = new Binding("Counts"), Width = 110 });
            return g;
        }

        /* ============================== PROFILES =========================== */

        private void BindProfiles(string selectId)
        {
            _loading = true;
            try
            {
                _profileCombo.Items.Clear();
                foreach (PublishProfile p in _s.Profiles.Profiles) _profileCombo.Items.Add(new ComboBoxItem { Content = p.Name, Tag = p });
                int idx = _s.Profiles.Profiles.FindIndex(p => p.Id == selectId);
                if (idx < 0 && _profileCombo.Items.Count > 0) idx = 0;
                _profileCombo.SelectedIndex = idx;
            }
            finally { _loading = false; }
            OnProfileChanged(null, null);
        }

        private void OnProfileChanged(object sender, SelectionChangedEventArgs e)
        {
            if (_loading) return;
            var item = _profileCombo.SelectedItem as ComboBoxItem;
            _profile = item != null ? item.Tag as PublishProfile : null;
            _s.Profiles.LastProfileId = _profile != null ? _profile.Id : null;
            if (_profile == null)
            {
                _rows.Clear();
                _planRows.Clear();
                _findRows.Clear();
                _summary.Text = "Профайл байхгүй байна — «Шинэ…» эсвэл «Жишээ профайл сэргээх» дарна уу.";
                _publishBtn.IsEnabled = false;
                UpdateChangeInfo();
                return;
            }

            string last;
            _s.Profiles.LastFolders.TryGetValue(_profile.Id, out last);
            _folder.Text = !string.IsNullOrWhiteSpace(_profile.Destination.BaseFolder) ? _profile.Destination.BaseFolder : (last ?? "");
            LoadRows();
            ApplyRule();
            UpdateChangeInfo();
        }

        private void LoadRows()
        {
            IReadOnlyDictionary<string, SheetCheckpoint> cps = _s.CheckpointsFor(_profile.Id);
            AffectedPublishSet affected = CurrentAffected();
            foreach (ItemRow r in _rows) r.PropertyChanged -= OnRowChanged;
            _rows.Clear();
            foreach (PublishItem it in ItemSelection.Eligible(_s.Items, _profile.Selection))
            {
                SheetCheckpoint cp;
                var row = new ItemRow { Item = it, LastPublished = LastPublishInfo.Describe(cps != null && cps.TryGetValue(it.Id, out cp) ? cp : null, _profile.Formats) };
                SheetAffect aff = affected != null ? affected.Get(it.Id) : null;
                if (aff != null && aff.State != AffectState.NotApplicable)
                {
                    row.Change = AffectedPublishSet.StateText(aff);
                    row.ChangeBrush = ChangeBrush(aff.State);
                    row.ToolTipText = string.Join("\n", aff.Reasons);
                }
                row.PropertyChanged += OnRowChanged;
                _rows.Add(row);
            }
            _itemsView.Filter = FilterRow;
        }

        private static System.Windows.Media.Brush ChangeBrush(AffectState s)
        {
            switch (s)
            {
                case AffectState.Affected: return UiKit.BlockingBrush;
                case AffectState.Suggested: return UiKit.WarningBrush;
                case AffectState.Unknown: return UiKit.WarningBrush;
                case AffectState.NeverPublished: return UiKit.InfoBrush;
                default: return UiKit.MutedBrush;
            }
        }

        private void OnRowChanged(object sender, PropertyChangedEventArgs e)
        {
            if (e.PropertyName == "Selected") Schedule();
        }

        private void EditProfile(bool isNew)
        {
            PublishProfile source = isNew ? new PublishProfile { Name = "Шинэ профайл" } : _profile;
            if (source == null) return;
            PublishProfile edited = RunEditor(source.Clone());
            if (edited == null) return;
            PublishProfileStore.Upsert(_s.Profiles, edited);
            SaveProfilesOrWarn();
            BindProfiles(edited.Id);
        }

        /// <summary>
        /// Профайлын засвар хадгалагдаагүй бол (файл түгжигдсэн, шинэ хувилбарынх) ИЛ хэлнэ — өөрөөр хэрэглэгч засвараа хадгалагдсан гэж
        /// найдаж, дараагийн нээлтэд алдагдсан байхыг олно.
        /// </summary>
        private void SaveProfilesOrWarn()
        {
            if (_s.SaveProfiles()) return;
            MessageBox.Show(this, "Профайлын өөрчлөлтийг ХАДГАЛЖ ЧАДСАНГҮЙ (файл түгжигдсэн эсвэл өөр хувилбарын add-in-ийн бичсэн байж болно).\n"
                + "Одоо ажиллаж буй цонхонд өөрчлөлт харагдах ч Revit-ийг хаавал алдагдана.", Title, MessageBoxButton.OK, MessageBoxImage.Warning);
        }

        private PublishProfile RunEditor(PublishProfile profile)
        {
            var dlg = new ProfileEditorDialog(_s, profile) { Owner = this };
            return dlg.ShowDialog() == true ? dlg.Edited : null;
        }

        private void CopyProfile()
        {
            if (_profile == null) return;
            PublishProfile copy = _profile.Clone();
            copy.Id = SmartHash.NewId();
            copy.Name = _profile.Name + " (хуулбар)";
            copy.Version = 1;
            copy.Starter = false;
            PublishProfileStore.Upsert(_s.Profiles, copy);
            SaveProfilesOrWarn();
            BindProfiles(copy.Id);
        }

        private void DeleteProfile()
        {
            if (_profile == null) return;
            if (MessageBox.Show(this, "«" + _profile.Name + "» профайлыг устгах уу?\n(Гаргалтын түүх хэвээр үлдэнэ.)", Title, MessageBoxButton.YesNo, MessageBoxImage.Question) != MessageBoxResult.Yes) return;
            PublishProfileStore.Delete(_s.Profiles, _profile.Id);
            SaveProfilesOrWarn();
            BindProfiles(null);
        }

        private void RestoreStarters()
        {
            int n = PublishProfileStore.RestoreStarters(_s.Profiles);
            SaveProfilesOrWarn();
            BindProfiles(_profile != null ? _profile.Id : null);
            MessageBox.Show(this, n == 0 ? "Бүх жишээ профайл аль хэдийн байна." : n + " жишээ профайл нэмэгдлээ.", Title);
        }

        /* ============================== SELECTION ========================== */

        private bool FilterRow(object o)
        {
            string f = (_filter.Text ?? "").Trim();
            if (f.Length == 0) return true;
            var r = (ItemRow)o;
            return (r.Number ?? "").IndexOf(f, StringComparison.OrdinalIgnoreCase) >= 0 || (r.Name ?? "").IndexOf(f, StringComparison.OrdinalIgnoreCase) >= 0;
        }

        private void SetVisible(bool value)
        {
            foreach (ItemRow r in _rows.Where(x => FilterRow(x))) r.Selected = value;
        }

        private void ApplyRule()
        {
            if (_profile == null) return;
            foreach (ItemRow r in _rows) r.PropertyChanged -= OnRowChanged;
            foreach (ItemRow r in _rows) r.Selected = ItemSelection.Matches(r.Item, _profile.Selection);
            foreach (ItemRow r in _rows) r.PropertyChanged += OnRowChanged;
            Refresh();
        }

        private void DropBlocked()
        {
            if (_report == null) return;
            HashSet<string> blocked = _report.BlockedItemIds();
            foreach (ItemRow r in _rows.Where(x => blocked.Contains(x.Item.Id))) r.Selected = false;
        }

        /// <summary>Профайлаар хараахан гаргаагүй хуудсуудыг тэмдэглэнэ (шинэ хуудас олох хурдан арга).</summary>
        private void SelectNeverPublished()
        {
            foreach (ItemRow r in _rows) r.Selected = LastPublishInfo.NeedsPublish(r.LastPublished);
        }

        /* ===================== ӨӨРЧЛӨГДСӨН ХУУДАС (Change Impact) ======================= */

        /// <summary>
        /// «Нөлөөлөгдсөнийг сонгох» — ЗӨВХӨН ШУУД (A) нөлөөлөлтэй + хараахан гаргаагүй хуудас.  Санал болгосон (B-D) нь ЭНД ОРОХГҮЙ:
        /// тэдгээрийг хэрэглэгч «+ Санал болгосныг нэмэх»-ээр ИЛ нэмнэ.  Бүгдийг гаргах «Бүгдийг» товч үргэлж боломжтой.
        /// </summary>
        private void SelectAffected()
        {
            AffectedPublishSet a = CurrentAffected();
            if (a == null) return;
            HashSet<string> ids = a.AffectedIds();
            foreach (ItemRow r in _rows) r.PropertyChanged -= OnRowChanged;
            foreach (ItemRow r in _rows) r.Selected = ids.Contains(r.Item.Id);
            foreach (ItemRow r in _rows) r.PropertyChanged += OnRowChanged;
            Refresh();
        }

        private void AddSuggested()
        {
            AffectedPublishSet a = CurrentAffected();
            if (a == null) return;
            HashSet<string> ids = a.SuggestedIds();
            foreach (ItemRow r in _rows) r.PropertyChanged -= OnRowChanged;
            foreach (ItemRow r in _rows.Where(x => ids.Contains(x.Item.Id))) r.Selected = true;
            foreach (ItemRow r in _rows) r.PropertyChanged += OnRowChanged;
            Refresh();
        }

        private void UpdateChangeInfo()
        {
            AffectedPublishSet a = CurrentAffected();
            _affectedBtn.IsEnabled = _suggestedBtn.IsEnabled = a != null;
            if (a == null)
            {
                AffectedPublishSet other = _s.Affected;
                if (other != null && _profile != null)
                {
                    // Шинжилгээ байгаа ч ӨӨР профайл/форматад хийгдсэн — энэ профайлд ХҮЧИНГҮЙ (багана хоосон, товчнууд идэвхгүй).
                    PublishProfile was = _s.Profiles.Profiles.FirstOrDefault(p => p.Id == other.ProfileId);
                    bool sameProfile = string.Equals(other.ProfileId, _profile.Id, StringComparison.Ordinal);
                    _changeInfo.Text = (sameProfile
                            ? "Өөрчлөлтийн шинжилгээ профайлын ӨӨР форматын багцаар хийгдсэн (формат өөрчлөгдсөн)"
                            : "Өөрчлөлтийн шинжилгээ ӨӨР профайлаар" + (was != null ? " («" + was.Name + "»)" : "") + " хийгдсэн")
                        + " — энэ профайлд хүчингүй. «Өөрчлөлт шинжлэх…»-ийг энэ профайлаар дахин ажиллуулна уу.";
                    _changeInfo.Foreground = UiKit.WarningBrush;
                    return;
                }
                _changeInfo.Text = "Өөрчлөлтийн шинжилгээ хийгдээгүй — «Өөрчлөлт шинжлэх…» нь сүүлийн гаргалтаас хойш өөрчлөгдсөн хуудсыг тэмдэглэнэ. "
                    + "Шинжлээгүй хуудсыг ХЭЗЭЭ Ч «өөрчлөгдөөгүй» гэж үзэхгүй; бүх хуудсыг гаргахдаа «Бүгдийг» ашиглана.";
                _changeInfo.Foreground = UiKit.MutedBrush;
                return;
            }

            _changeInfo.Text = "Шинжилгээ " + a.Utc.ToLocalTime().ToString("HH:mm") + ": нөлөөлөгдсөн " + a.Count(AffectState.Affected)
                + " · хараахан гаргаагүй " + a.Count(AffectState.NeverPublished)
                + " · санал болгосон " + (a.Count(AffectState.Suggested) + a.Count(AffectState.Unknown))
                + " · нөлөөлөл олдсонгүй " + a.Count(AffectState.NoImpactFound) + " (баталгаа БИШ)."
                + (a.Incomplete ? "\n⚠ Шинжилгээ бүрэн бус — «олдсонгүй» гэдэг нь «өөрчлөгдөөгүй» гэсэн үг БИШ." : "")
                + (a.Notes.Count > 0 ? "\n" + string.Join("\n", a.Notes.Take(3)) : "");
            _changeInfo.Foreground = a.Incomplete ? UiKit.WarningBrush : UiKit.MutedBrush;
        }

        private void OnAnalyzeChanges(object sender, RoutedEventArgs e)
        {
            if (_profile == null) return;
            PublishProfile prof = EffectiveProfile();
            _s.Profiles.LastFolders[_profile.Id] = prof.Destination.BaseFolder ?? "";
            _s.SaveProfiles();
            Result = new PublishDialogResult { Action = PublishDialogAction.AnalyzeChanges, Profile = prof, BaseFolder = prof.Destination.BaseFolder };
            DialogResult = true;
        }

        /* ============================== REFRESH ============================ */

        private void Schedule()
        {
            if (_loading) return;
            _debounce.Stop();
            _debounce.Start();
        }

        private PublishProfile EffectiveProfile()
        {
            PublishProfile p = _profile.Clone();
            p.Destination.BaseFolder = string.IsNullOrWhiteSpace(_folder.Text) ? null : _folder.Text.Trim();
            return p;
        }

        private List<PublishItem> SelectedItems()
        {
            return _rows.Where(r => r.Selected).Select(r => r.Item).ToList();
        }

        private void Refresh()
        {
            if (_profile == null) return;
            PublishProfile prof = EffectiveProfile();
            List<PublishItem> selected = SelectedItems();

            try
            {
                _plan = PublishPlanner.Build(prof, selected, _s.Project, _s.Fs);
                _report = PreflightEngine.Run(new PreflightContext
                {
                    Profile = prof,
                    Items = selected,
                    Plan = _plan,
                    Project = _s.Project,
                    Env = _s.EnvFor(prof),
                    Fs = _s.Fs,
                });
            }
            catch (Exception ex)
            {
                _summary.Text = "Шалгалт хийхэд алдаа гарлаа: " + ex.GetType().Name;
                _publishBtn.IsEnabled = false;
                return;
            }

            _planRows.Clear();
            foreach (PlannedArtifact a in _plan.Artifacts)
                _planRows.Add(new PlanRow
                {
                    Label = a.ItemLabel,
                    Format = a.Format.ToString().ToUpperInvariant(),
                    FileName = a.FileName,
                    Action = ActionText(a),
                    Folder = a.Folder,
                });

            _findRows.Clear();
            foreach (PreflightFinding f in _report.Findings)
                _findRows.Add(new FindingRow
                {
                    Severity = f.Severity.ToString(),
                    SeverityText = f.Severity == PreflightSeverity.Blocking ? "⛔ Блоклосон" : f.Severity == PreflightSeverity.Warning ? "⚠ Анхааруулга" : "ℹ Мэдээлэл",
                    Message = f.Message,
                    Hint = f.Hint,
                    Brush = UiKit.SeverityBrush(f.Severity.ToString()),
                });

            HashSet<string> blocked = _report.BlockedItemIds();
            var warned = new HashSet<string>(_report.Findings.Where(f => f.Severity == PreflightSeverity.Warning && !string.IsNullOrEmpty(f.ItemId)).Select(f => f.ItemId));
            foreach (ItemRow r in _rows) r.Flag = blocked.Contains(r.Item.Id) ? "⛔" : warned.Contains(r.Item.Id) ? "⚠" : "";

            bool canPublish = _report.CanRun && _plan.Artifacts.Count > 0;
            _publishBtn.IsEnabled = canPublish;
            _summary.Text = selected.Count + " хуудас → " + _plan.Artifacts.Count + " файл.   "
                + (_report.Blocking > 0 ? "⛔ " + _report.Blocking + " блоклосон   " : "")
                + (_report.Warnings > 0 ? "⚠ " + _report.Warnings + " анхааруулга   " : "")
                + (canPublish ? "Гаргахад бэлэн." : (_plan.Artifacts.Count == 0 ? "Гаргах зүйл алга." : "Гаргахын өмнөх шалгалтын блоклосон асуудлыг засна уу."));
            _summary.Foreground = _report.Blocking > 0 ? UiKit.BlockingBrush : _report.Warnings > 0 ? UiKit.WarningBrush : UiKit.OkBrush;
        }

        private static string ActionText(PlannedArtifact a)
        {
            switch (a.Action)
            {
                case PlanAction.SkipExisting: return "Алгасна (байгаа)";
                case PlanAction.Overwrite: return "Дарж бичнэ";
                case PlanAction.Versioned: return "Шинэ дугаартай";
                default: return a.TargetExists ? "Файл байна ⚠" : "Экспорт";
            }
        }

        /* ============================== HISTORY ============================ */

        private void LoadRuns()
        {
            _runRows.Clear();
            foreach (PublishRun r in _s.History().Runs) _runRows.Add(new RunRow { Run = r });
        }

        private void OnRunSelected(object sender, SelectionChangedEventArgs e)
        {
            var row = _runGrid.SelectedItem as RunRow;
            _retryBtn.IsEnabled = row != null && PublishRetry.Targets(row.Run).Count > 0;
            _runDetails.Text = row == null ? "" : DescribeRun(row.Run);
        }

        internal static string DescribeRun(PublishRun run)
        {
            var sb = new StringBuilder();
            sb.AppendLine(RunRow.StatusOf(run) + " · " + run.ProfileName + " (v" + run.ProfileVersion + ") · " + run.DurationMs / 1000.0 + " с");
            if (!string.IsNullOrEmpty(run.Destination)) sb.AppendLine("Хавтас: " + run.Destination);
            sb.AppendLine("Файл: " + run.Artifacts.Count + " (амжилттай " + run.Artifacts.Count(a => a.Status == ArtifactStatus.Succeeded)
                + ", бүтэлгүй " + run.Artifacts.Count(a => a.Status == ArtifactStatus.Failed) + ", алгассан " + run.Artifacts.Count(a => a.Status == ArtifactStatus.Skipped)
                + ", цуцлагдсан " + run.Artifacts.Count(a => a.Status == ArtifactStatus.Cancelled) + ")");
            if (run.Status == RunStatus.Running) sb.AppendLine("⚠ Энэ гүйлт дуусаагүй — Revit гэнэт хаагдсан эсвэл унасан байж болзошгүй.");
            if (run.Failures.Count > 0)
            {
                sb.AppendLine();
                sb.AppendLine("Алдаа:");
                foreach (PublishFailure f in run.Failures)
                    sb.AppendLine(" • " + f.ItemLabel + " [" + f.Format.ToString().ToUpperInvariant() + "] " + f.Code + " — " + f.Message + (f.Retryable ? "" : " (дахин оролдоход тус болохгүй)"));
            }
            sb.AppendLine();
            sb.AppendLine("Файлууд:");
            foreach (PublishArtifact a in run.Artifacts)
            {
                sb.AppendLine(" " + (a.Status == ArtifactStatus.Succeeded ? "✓" : a.Status == ArtifactStatus.Failed ? "✕" : a.Status == ArtifactStatus.Skipped ? "↷" : "—")
                    + " " + a.ItemLabel + " [" + a.Format.ToString().ToUpperInvariant() + "] " + System.IO.Path.GetFileName(a.Path ?? "") + (a.SizeBytes > 0 ? "  " + a.SizeBytes / 1024 + " КБ" : ""));
                foreach (string n in a.Notes) sb.AppendLine("     " + n);
            }
            return sb.ToString();
        }

        private void OpenRunFolder()
        {
            var row = _runGrid.SelectedItem as RunRow;
            string path = row != null ? row.Run.Destination : _folder.Text;
            if (string.IsNullOrWhiteSpace(path) || !System.IO.Directory.Exists(path)) return;
            try { Process.Start(new ProcessStartInfo("explorer.exe", "\"" + path + "\"") { UseShellExecute = true }); }
            catch (Exception) { /* explorer нээгдсэнгүй — чимээгүй */ }
        }

        /* ============================== ACTIONS ============================ */

        private void OnPublish(object sender, RoutedEventArgs e)
        {
            Refresh();
            if (_profile == null || _plan == null || _report == null || !_report.CanRun || _plan.Artifacts.Count == 0) return;

            PublishProfile prof = EffectiveProfile();
            _s.Profiles.LastFolders[_profile.Id] = prof.Destination.BaseFolder ?? "";
            _s.SaveProfiles();

            int overwrites = _plan.Artifacts.Count(a => a.Action == PlanAction.Overwrite);
            if (overwrites > 0 && MessageBox.Show(this, overwrites + " байгаа файлыг дарж бичнэ. Үргэлжлүүлэх үү?", Title, MessageBoxButton.YesNo, MessageBoxImage.Warning) != MessageBoxResult.Yes) return;

            Result = new PublishDialogResult
            {
                Action = PublishDialogAction.Publish,
                Profile = prof,
                Items = SelectedItems(),
                Plan = _plan,
                Report = _report,
                BaseFolder = prof.Destination.BaseFolder,
            };
            DialogResult = true;
        }

        private void OnRetry(object sender, RoutedEventArgs e)
        {
            var row = _runGrid.SelectedItem as RunRow;
            if (row == null || PublishRetry.Targets(row.Run).Count == 0) return;
            Result = new PublishDialogResult { Action = PublishDialogAction.Retry, RetryOf = row.Run };
            DialogResult = true;
        }
    }
}
