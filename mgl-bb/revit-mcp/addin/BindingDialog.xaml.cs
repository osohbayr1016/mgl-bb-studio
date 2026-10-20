using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.ComponentModel;
using System.Linq;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Data;
using RevitMcpAddin.Ui.Core;

namespace RevitMcpAddin
{
    /// <summary>ComboBox-ийн нэг сонголт — id + харагдах шошго.</summary>
    public sealed class PickOption
    {
        public int Id { get; set; }
        public string Label { get; set; }
        public int ParentId { get; set; }
        public override string ToString() => Label;
    }

    /// <summary>Холбоосын нэг мөр.</summary>
    public sealed class BindingRow : INotifyPropertyChanged
    {
        private bool _isChecked;
        private PickOption _selectedDrawing;
        private PickOption _selectedTask;

        public string SheetUid { get; set; }
        public string SheetNumber { get; set; }
        public string SheetName { get; set; }
        public double Confidence { get; set; }

        /// <summary>
        /// Өмнө нь «алгасах» гэж хадгалагдсан мөр.  Ийм мөрийг жагсаалтаас
        /// ХАСАХГҮЙ: сервер тал дээр `ignored`-ыг буцаах ямар ч зам байхгүй тул
        /// нэг удаа алгассан хуудсыг хэн ч дахин холбож чадахгүй болдог байв.
        /// Саараар харуулж (XAML RowStyle), тэмдэглээгүй байдлаар үлдээнэ.
        /// </summary>
        public bool IsIgnored { get; set; }

        /// <summary>Өмнө нь «confirmed» гэж хадгалагдсан мөр.</summary>
        public bool WasConfirmed { get; set; }

        /// <summary>Төлөв БИЧВЭРЭЭР (өмнө нь алгассан мөр зөвхөн саарал байв).</summary>
        public string StatusLabel => BindingView.StatusLabel(WasConfirmed, IsIgnored);

        /// <summary>Цэвэр тоолол/шүүлтэд (`BindingView`) өгөх агшин зураг.</summary>
        public BindingRowState State => new BindingRowState
        {
            IsChecked = IsChecked,
            HasTask = SelectedTask != null,
            WasIgnored = IsIgnored,
            WasConfirmed = WasConfirmed,
            SheetNumber = SheetNumber,
            SheetName = SheetName,
        };

        public string ConfidenceLabel => Confidence > 0 ? Confidence.ToString("0.00") : "—";

        public IReadOnlyList<PickOption> DrawingOptions { get; set; }

        /// <summary>Ажлын сонголт нь СОНГОСОН ЗУРГААС хамаарч дахин тооцогдоно.</summary>
        private readonly List<PickOption> _allTasks;
        private ObservableCollection<PickOption> _taskOptions = new ObservableCollection<PickOption>();
        public ObservableCollection<PickOption> TaskOptions => _taskOptions;

        public BindingRow(List<PickOption> allTasks) => _allTasks = allTasks;

        public bool IsChecked
        {
            get => _isChecked;
            set { _isChecked = value; Raise(nameof(IsChecked)); Changed?.Invoke(); }
        }

        public PickOption SelectedDrawing
        {
            get => _selectedDrawing;
            set
            {
                _selectedDrawing = value;
                Raise(nameof(SelectedDrawing));
                RebuildTasks();
            }
        }

        public PickOption SelectedTask
        {
            get => _selectedTask;
            set { _selectedTask = value; Raise(nameof(SelectedTask)); Changed?.Invoke(); }
        }

        /// <summary>Зураг солигдоход ажлын жагсаалтыг шүүнэ; одоогийн сонголт таарахгүй бол цэвэрлэнэ.</summary>
        private void RebuildTasks()
        {
            _taskOptions.Clear();
            if (_selectedDrawing != null)
            {
                foreach (PickOption t in _allTasks.Where(t => t.ParentId == _selectedDrawing.Id))
                    _taskOptions.Add(t);
            }
            if (_selectedTask != null && !_taskOptions.Contains(_selectedTask))
            {
                _selectedTask = null;
                Raise(nameof(SelectedTask));
            }
            Raise(nameof(TaskOptions));
            Changed?.Invoke();
        }

        /// <summary>Эхний ачаалалтад сонголтыг ДАХИН тооцоолохгүйгээр тавина.</summary>
        public void Seed(PickOption drawing, PickOption task)
        {
            _selectedDrawing = drawing;
            RebuildTasks();
            if (task != null && _taskOptions.Contains(task))
            {
                _selectedTask = task;
                Raise(nameof(SelectedTask));
            }
        }

        public Action Changed;
        public event PropertyChangedEventHandler PropertyChanged;
        private void Raise(string n) => PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(n));
    }

    /// <summary>
    /// «Зураг холбох» цонх — Revit-ийн хуудас ↔ вэбийн ажлын холбоос.
    ///
    /// Энэ бол бүх урсгалын ГАНЦ гар ажиллагаа.  Нэг .rvt файлд нэг удаа
    /// хийхэд хангалттай: холбоос нь `ViewSheet.UniqueId`-д тулгуурладаг тул
    /// хуудасны дугаар солих, нэр солих, файлын нэр солих, worksharing sync
    /// бүгдийг даван гарна.
    /// </summary>
    public partial class BindingDialog : Window
    {
        private readonly ObservableCollection<BindingRow> _rows = new ObservableCollection<BindingRow>();
        private readonly string _host;
        private readonly string _token;
        private readonly int _documentId;

        /// <summary>Итгэлцлийн босго — үүнээс дээш саналыг автоматаар тэмдэглэнэ.</summary>
        private const double AutoTickConfidence = 0.8;

        public bool Saved { get; private set; }

        private ICollectionView _view;
        private BindingFilter _filter = BindingFilter.All;
        private string _query = string.Empty;
        /// <summary>Ачаалж дууссаны дараах ЯМАР Ч өөрчлөлт (чагт, зураг, таск) — хадгалаагүй хаахад анхааруулна.</summary>
        private bool _loaded;
        private bool _dirty;

        public BindingDialog(string host, string token, HandshakeResult hs)
        {
            InitializeComponent();
            _host = host;
            _token = token;
            _documentId = hs?.Document?.Id ?? 0;

            Ui.MglWindow.Setup(this, "MGL — Ажилтай холбох · " + (hs?.Document?.ProjectName ?? ""),
                1040, 680, 820, 480, prefsKey: "binding");
            Ui.MglTheme.Apply(this);
            Ui.MglUi.Primary(SaveBtn);
            Ui.MglAuto.LabelFor(SearchLabel, SearchBox);
            Ui.MglAuto.LabelFor(FilterLabel, FilterCombo);
            Ui.MglAuto.Name(SearchBox, "Хуудас хайх", "Хуудасны дугаар эсвэл нэрээр шүүнэ");
            foreach (BindingFilter f in new[] { BindingFilter.All, BindingFilter.ToLink, BindingFilter.ToIgnore, BindingFilter.NoTask, BindingFilter.PreviouslyIgnored })
                FilterCombo.Items.Add(new FilterItem { Kind = f, Label = BindingView.FilterLabel(f) });
            FilterCombo.DisplayMemberPath = "Label";
            FilterCombo.SelectedIndex = 0;

            var drawingOptions = (hs?.Candidates?.Drawings ?? new List<DrawingCandidateDto>())
                .Select(d => new PickOption
                {
                    Id = d.Id,
                    Label = string.IsNullOrWhiteSpace(d.BlockName) ? d.Name : d.BlockName + " · " + d.Name,
                })
                .ToList();

            var taskOptions = (hs?.Candidates?.Tasks ?? new List<TaskCandidateDto>())
                .Select(t => new PickOption { Id = t.Id, Label = t.Name, ParentId = t.DrawingId })
                .ToList();

            foreach (BindingDto b in hs?.Bindings ?? new List<BindingDto>())
            {
                bool ignored = b.Status == "ignored";
                var row = new BindingRow(taskOptions)
                {
                    SheetUid = b.SheetUid,
                    SheetNumber = b.SheetNumber,
                    SheetName = b.SheetName,
                    Confidence = b.Confidence,
                    DrawingOptions = drawingOptions,
                    IsIgnored = ignored,
                    WasConfirmed = b.Status == "confirmed",
                };
                row.Seed(
                    drawingOptions.FirstOrDefault(d => b.DrawingId.HasValue && d.Id == b.DrawingId.Value),
                    taskOptions.FirstOrDefault(t => b.TaskId.HasValue && t.Id == b.TaskId.Value));
                // Аль хэдийн батлагдсан, эсвэл итгэлтэй санал — урьдчилан тэмдэглэнэ.
                // Алгассан мөрийг АВТОМАТААР тэмдэглэхгүй: хэрэглэгч санаатай
                // тэмдэглээгүй байхад сервер confidence = 1.0 бичдэг тул автомат
                // дүрэм түүнийг эргүүлж асаах эрсдэлтэй.
                row.IsChecked = !ignored &&
                                (b.Status == "confirmed" ||
                                 (b.Confidence >= AutoTickConfidence && b.TaskId.HasValue));
                row.Changed = OnRowChanged;
                _rows.Add(row);
            }

            _view = CollectionViewSource.GetDefaultView(_rows);
            _view.Filter = o => BindingView.Matches(((BindingRow)o).State, _filter, _query);
            Grid.ItemsSource = _view;
            _loaded = true;
            UpdateCount();

            Closing += OnClosing;
        }

        private sealed class FilterItem
        {
            public BindingFilter Kind { get; set; }
            public string Label { get; set; }
        }

        private void OnRowChanged()
        {
            if (_loaded) _dirty = true;
            UpdateCount();
            // Шүүлт идэвхтэй үед (жишээ нь «Холбогдохоор») чагт солигдвол мөр жагсаалтаас гарч/орж болно.
            if (_filter != BindingFilter.All) _view?.Refresh();
        }

        private BindingCounts Counts() => BindingView.Count(_rows.Select(r => r.State));

        private void UpdateCount()
        {
            BindingCounts c = Counts();
            CountText.Text = BindingView.SummaryText(c);
            // Хадгалах боломжгүй шалтгааныг ИЛ хэлнэ (өмнө нь товч зүгээр бүдгэрдэг байв).
            if (!_saving) StatusText.Text = BindingView.SaveHint(c);
            SaveBtn.IsEnabled = !_saving && c.CanSave;
        }

        private bool _saving;

        private void SearchBox_TextChanged(object sender, System.Windows.Controls.TextChangedEventArgs e)
        {
            _query = SearchBox.Text ?? string.Empty;
            _view?.Refresh();
        }

        private void FilterCombo_SelectionChanged(object sender, System.Windows.Controls.SelectionChangedEventArgs e)
        {
            var item = FilterCombo.SelectedItem as FilterItem;
            _filter = item != null ? item.Kind : BindingFilter.All;
            _view?.Refresh();
        }

        private void OnClosing(object sender, CancelEventArgs e)
        {
            // Хадгалсан, эсвэл өөрчлөлтгүй бол хаана.  Хадгалж буй үед хаахыг зөвшөөрөхгүй (хүсэлт явж байна).
            if (_saving) { e.Cancel = true; return; }
            if (Saved || !_dirty) return;
            MessageBoxResult r = MessageBox.Show(this,
                "Хадгалаагүй өөрчлөлт алга болно (чагт, сонгосон зураг, таск). Хаах уу?",
                "MGL — Ажилтай холбох", MessageBoxButton.YesNo, MessageBoxImage.Question, MessageBoxResult.No);
            if (r != MessageBoxResult.Yes) e.Cancel = true;
        }

        private void CheckHighBtn_Click(object sender, RoutedEventArgs e)
        {
            foreach (BindingRow r in _rows)
                r.IsChecked = r.Confidence >= AutoTickConfidence && r.SelectedTask != null;
            UpdateCount();
        }

        private void CheckAllBtn_Click(object sender, RoutedEventArgs e)
        {
            foreach (BindingRow r in _rows) r.IsChecked = r.SelectedTask != null;
            UpdateCount();
        }

        private void ClearBtn_Click(object sender, RoutedEventArgs e)
        {
            foreach (BindingRow r in _rows) r.IsChecked = false;
            UpdateCount();
        }

        private async void SaveBtn_Click(object sender, RoutedEventArgs e)
        {
            // Хадгалахаас ӨМНӨ: хэдэн хуудас холбогдох, хэдэн нь «алгассан» болохыг ил хэлж баталгаажуулна
            // (өмнө нь «Бүгдийг батлах» нь чагтлаагүй мөрийг чимээгүй алгасдаг байв).
            BindingCounts counts = Counts();
            MessageBoxResult go = MessageBox.Show(this,
                BindingView.SaveConfirmText(counts) + "\n\nХадгалах уу?",
                "MGL — Холбоос хадгалах", MessageBoxButton.YesNo, MessageBoxImage.Question);
            if (go != MessageBoxResult.Yes) return;

            _saving = true;
            SaveBtn.IsEnabled = false;
            StatusText.Text = "Хадгалж байна…";
            try
            {
                // ⚠️ WPF элементийг ЗААВАЛ UI thread дээр уншина.  Урьд нь энэ
                // уншилт доорх `Task.Run` лямбда дотор байсан тул thread-pool
                // thread дээр биелж, `DependencyObject.VerifyAccess()` шидээд
                // «Бүгдийг батлах» товч 100% ажиллахгүй байв — HTTP хүсэлт огт
                // явахгүй, хэрэглэгч англи алдааны цонх л хардаг.
                bool seedChecklist = SeedChecklistBox.IsChecked == true;

                var items = _rows
                    .Where(r => r.IsChecked && r.SelectedTask != null)
                    .Select(r => new BindingSaveItem
                    {
                        SheetUid = r.SheetUid,
                        DrawingId = r.SelectedDrawing?.Id,
                        TaskId = r.SelectedTask?.Id,
                        Status = "confirmed",
                    })
                    .ToList();

                // Тэмдэглээгүй мөрүүдийг «алгасах» гэж тэмдэглэнэ — дараагийн
                // handshake дээр дахин санал болгохгүй, чимээгүй алдагдахгүй.
                items.AddRange(_rows
                    .Where(r => !r.IsChecked)
                    .Select(r => new BindingSaveItem
                    {
                        // ⚠️ Сонгосон зураг/ажлыг ЗААВАЛ хамт явуулна: сервер
                        // `drawing_id = ?, task_id = ?`-ыг НӨХЦӨЛГҮЙ бичдэг тул
                        // хоосон явуулбал саналыг нь устгаж, дараа нь дахин
                        // тэмдэглэхэд юу ч сонгоогүй хоосон мөр үлдэнэ.
                        SheetUid = r.SheetUid,
                        DrawingId = r.SelectedDrawing?.Id,
                        TaskId = r.SelectedTask?.Id,
                        Status = "ignored",
                    }));

                BindingSaveResult res = await Task.Run(() =>
                    RevitApi.SaveBindingsAsync(
                        _host, _token, _documentId, items, seedChecklist));

                Saved = true;
                _saving = false;
                MessageBox.Show(
                    this,
                    BindingView.SavedText(res?.Saved ?? 0, res?.Ignored ?? 0, seedChecklist),
                    "MGL — Холбоос хадгалагдлаа",
                    MessageBoxButton.OK,
                    MessageBoxImage.Information);
                DialogResult = true;
            }
            catch (Exception ex)
            {
                _saving = false;
                StatusText.Text = string.Empty;
                UpdateCount();
                MessageBox.Show(this, RevitApi.FriendlyError(ex), "MGL — Холбоос хадгалж чадсангүй",
                    MessageBoxButton.OK, MessageBoxImage.Warning);
            }
        }
    }
}
