using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.Linq;
using System.Threading.Tasks;
using System.Windows.Input;
using System.Windows.Threading;
using RevitMcpAddin.SheetNumerator.Core;

namespace RevitMcpAddin.SheetNumerator.Ui
{
    /// <summary>
    /// «Зургийн хуудасны дугаарлалт» цонхны ViewModel — Revit-ийн ЯМАР Ч төрөл харахгүй.
    ///
    /// Урсгал: Revit API → (ExternalEvent) → ЭНГИЙН snapshot НЭГ удаа → цэвэр <see cref="NumberingEngine"/>-ээр
    /// олон удаа урьдчилсан харалт → «Хэрэгжүүлэх» дээр НЭГ ExternalEvent.  Хэрэглэгч бичих бүрт Revit-ийн API
    /// ДУУДАГДАХГҮЙ (debounce-той).
    ///
    /// ⚠️ Урьдчилсан харалт нь модельд ЮУ Ч БИЧИХГҮЙ.  Жагсаалтыг чирэх нь зөвхөн <see cref="WorkingOrderState"/>-ийг
    /// өөрчилнө; Revit руу зөвхөн <see cref="ApplyCommand"/> л бичнэ.
    /// ⚠️ Нэг дор ЗӨВХӨН НЭГ бүлгийн дараалал «бохирдсон» байж болно: бохир бүлгээс гарахдаа баталгаа асууна.
    /// </summary>
    public sealed partial class SheetNumeratorViewModel : ObservableObject
    {
        private readonly ISheetNumeratorGateway _gateway;
        private readonly IUserPrompts _prompts;
        private readonly DispatcherTimer _debounce;

        private DocumentSnapshot _snapshot;
        private GroupingResult _grouping;
        private SheetGroup _currentGroup;
        private WorkingOrderState _order;
        private RenumberPlan _plan;
        private Dictionary<long, SheetRowViewModel> _rowCache = new Dictionary<long, SheetRowViewModel>();
        private readonly HashSet<long> _selectedIds = new HashSet<long>();
        private int _selectedIndex = -1;

        private bool _busy;
        private string _busyText = string.Empty;
        private bool _stale;
        private string _bannerText = string.Empty;
        private string _statusText = string.Empty;
        private RowState _statusState;
        private string _groupHeader = string.Empty;
        private bool _suppressNodeSelection;
        private bool _loading;
        private bool _initialized;

        /// <summary>
        /// true = <see cref="Rows"/>-ийг дахин байгуулж байна.  ListView мөр устахад «сонголт арилсан» гэж ЗААВАЛ
        /// мэдэгддэг (синхрон) — тэр үед <see cref="SetSelection"/> VM-ийн сонголтыг (зөөхөд хадгалах ёстой)
        /// хоослохгүй байхын тулд үл тооно.  Сонголтыг дараа нь <see cref="RequestSelectionRestore"/> сэргээнэ.
        /// </summary>
        private bool _rebuilding;

        public SheetNumeratorViewModel(ISheetNumeratorGateway gateway, IUserPrompts prompts, SheetNumeratorPrefs prefs)
        {
            _gateway = gateway;
            _prompts = prompts;
            Prefs = prefs ?? new SheetNumeratorPrefs();
            Settings = Prefs.Settings;

            _debounce = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(120) };
            _debounce.Tick += (s, e) =>
            {
                _debounce.Stop();
                Recompute();
            };

            Rows = new ObservableCollection<SheetRowViewModel>();
            TreeRoots = new ObservableCollection<GroupNodeViewModel>();

            Part1 = new PartViewModel(0, () => RequestRecompute(false));
            Part2 = new PartViewModel(1, () => RequestRecompute(false));
            Part3 = new PartViewModel(2, () => RequestRecompute(false));
            InitSettingsProxies();
            LoadFieldsFromSettings();

            RefreshCommand = new RelayCommand(() => { var _ = RefreshWithConfirmAsync(); });
            ApplyCommand = new RelayCommand(() => { var _ = ApplyAsync(); }, () => CanApply);
            MoveUpCommand = new RelayCommand(() => ExecuteMove(o => _order.MoveUp(o)), () => CanMove);
            MoveDownCommand = new RelayCommand(() => ExecuteMove(o => _order.MoveDown(o)), () => CanMove);
            MoveTopCommand = new RelayCommand(() => ExecuteMove(o => _order.MoveToTop(o)), () => CanMove);
            MoveBottomCommand = new RelayCommand(() => ExecuteMove(o => _order.MoveToBottom(o)), () => CanMove);
            ResetOrderCommand = new RelayCommand(() => ResetOrder(), () => IsOrderDirty);
            CleanMarkersCommand = new RelayCommand(() => ToggleCleanMarkers(), () => CanCleanMarkers);
        }

        // ══════════════════════════════════════════════════════════════
        //  Нийтийн төлөв
        // ══════════════════════════════════════════════════════════════
        public SheetNumeratorPrefs Prefs { get; }
        public RenumberSettings Settings { get; }

        public ObservableCollection<SheetRowViewModel> Rows { get; }
        public ObservableCollection<GroupNodeViewModel> TreeRoots { get; }

        public ICommand RefreshCommand { get; }
        public ICommand ApplyCommand { get; }
        public ICommand MoveUpCommand { get; }
        public ICommand MoveDownCommand { get; }
        public ICommand MoveTopCommand { get; }
        public ICommand MoveBottomCommand { get; }
        public ICommand ResetOrderCommand { get; }
        public ICommand CleanMarkersCommand { get; }

        /// <summary>Мөрүүдийг дахин байгуулсны дараа сонголтыг сэргээх хүсэлт (view ListView-д хэрэглэнэ).</summary>
        public event Action<IReadOnlyList<long>> SelectionRestoreRequested;

        /// <summary>Мөрийг харагдах хэсэгт гүйлгэх хүсэлт.</summary>
        public event Action<long> ScrollToRequested;

        /// <summary>Амжилттай хэрэгжсэний хөнгөн заалт (view богино хугацаанд харуулна).</summary>
        public event Action<string> SuccessFlash;

        public bool IsBusy
        {
            get { return _busy; }
            private set
            {
                if (Set(ref _busy, value))
                {
                    Raise("IsIdle");
                    UpdateCommandStates();
                }
            }
        }

        public bool IsIdle => !_busy;
        public string BusyText { get { return _busyText; } private set { Set(ref _busyText, value); } }

        public bool IsStale
        {
            get { return _stale; }
            private set
            {
                if (Set(ref _stale, value))
                    UpdateCommandStates();
            }
        }

        public string BannerText
        {
            get { return _bannerText; }
            private set
            {
                if (Set(ref _bannerText, value ?? string.Empty))
                    Raise("HasBanner");
            }
        }

        public bool HasBanner => !string.IsNullOrEmpty(_bannerText);

        public string StatusText { get { return _statusText; } private set { Set(ref _statusText, value ?? string.Empty); } }
        public RowState StatusState { get { return _statusState; } private set { Set(ref _statusState, value); } }

        public string GroupHeader { get { return _groupHeader; } private set { Set(ref _groupHeader, value); } }

        public bool ShowTree
        {
            get
            {
                // Нэг л бүлэг (үндэс) байвал мод хэрэггүй.
                return _grouping != null && _grouping.Groups.Count > 1
                    || (_grouping != null && _grouping.Root.Children.Count > 0);
            }
        }

        public bool HasDocument => _snapshot != null;
        public string DocumentTitle => _snapshot != null ? _snapshot.DocumentTitle : string.Empty;

        /// <summary>Текст хэлбэрийн тайлан: «Өөрчлөгдөх: …».</summary>
        public string EmptyHint
        {
            get
            {
                if (_snapshot == null)
                    return string.Empty;
                if (_snapshot.Sheets.Count == 0)
                    return "Энэ төсөлд хуудас алга.";
                if (_currentGroup == null)
                    return "Зүүн талаас бүлэг сонгоно уу.";
                return string.Empty;
            }
        }

        public bool CanApply
        {
            get
            {
                return !_busy && !_stale && _snapshot != null && _plan != null
                    && _plan.HasChanges && !_plan.HasBlockingErrors && _parseErrors.Count == 0;
            }
        }

        public RenumberPlan Plan => _plan;
        public SheetGroup CurrentGroup => _currentGroup;
        public DocumentSnapshot Snapshot => _snapshot;
        public WorkingOrderState Order => _order;
        public bool IsOrderDirty => _order != null && _order.IsDirty;

        // ══════════════════════════════════════════════════════════════
        //  Ачаалах, шинэчлэх
        // ══════════════════════════════════════════════════════════════
        public async Task InitializeAsync()
        {
            if (_initialized)
                return;
            _initialized = true;
            await LoadAsync(keepOrder: false, selectActive: true);
        }

        private async Task RefreshWithConfirmAsync()
        {
            if (IsOrderDirty && !_prompts.Confirm(Msg.ToolTitle, Msg.DiscardOrderConfirm, true))
                return;
            await LoadAsync(keepOrder: false, selectActive: false);
        }

        public Task RefreshAsync()
        {
            return LoadAsync(keepOrder: false, selectActive: false);
        }

        private async Task LoadAsync(bool keepOrder, bool selectActive)
        {
            if (_loading)
                return;
            _loading = true;
            SetBusy(true, "Жагсаалт ачаалж байна…");
            SnapshotResult res;
            try
            {
                res = await _gateway.LoadAsync();
            }
            catch (Exception ex)
            {
                res = new SnapshotResult { Success = false, Error = "Жагсаалтыг ачаалж чадсангүй: " + ex.Message };
            }
            finally
            {
                SetBusy(false, string.Empty);
                _loading = false;
            }

            if (res == null || !res.Success)
            {
                ClearAll();
                IsStale = true;
                BannerText = res != null ? res.Error : Msg.NoDocumentNotice;
                StatusText = BannerText;
                StatusState = RowState.Error;
                return;
            }

            GroupKey prevKey = _currentGroup != null ? _currentGroup.Key : null;
            WorkingOrderState prevOrder = _order;
            var prevSelected = _selectedIds.ToList();

            _snapshot = res.Snapshot;
            _rowCache = new Dictionary<long, SheetRowViewModel>();
            IsStale = false;
            BannerText = string.Empty;

            ReconcileSettingsWithCatalog();
            RebuildOptionLists();
            BuildGrouping(prevKey, keepOrder ? prevOrder : null, selectActive ? _snapshot.ActiveSheetId : 0, prevSelected);

            Raise("HasDocument");
            Raise("DocumentTitle");
            Raise("ShowTree");
            Raise("EmptyHint");

            // Өмнөх сессээс «үл үзэгдэх тэмдэг ашиглах» хадгалагдсан бол probe-ийг одоо дуусгана.
            await ResumeMarkerProbeAsync();
        }

        private void ClearAll()
        {
            _snapshot = null;
            _grouping = null;
            _currentGroup = null;
            _order = null;
            _plan = null;
            _selectedIds.Clear();
            _selectedIndex = -1;
            ClearRows();
            TreeRoots.Clear();
            GroupHeader = string.Empty;
            Raise("HasDocument");
            Raise("ShowTree");
            Raise("EmptyHint");
            UpdateCommandStates();
        }

        private void SetBusy(bool busy, string text)
        {
            BusyText = text ?? string.Empty;
            IsBusy = busy;
        }

        // ══════════════════════════════════════════════════════════════
        //  Бүлэглэлт, сонголт
        // ══════════════════════════════════════════════════════════════
        private void BuildGrouping(GroupKey prevKey, WorkingOrderState rebaseFrom, long activeSheetId, List<long> prevSelected)
        {
            _grouping = SheetGroupingService.Build(_snapshot, Prefs.DisplayMode, Prefs.SortByName);

            TreeRoots.Clear();
            var rootVm = new GroupNodeViewModel(_grouping.Root, OnNodeSelected);
            TreeRoots.Add(rootVm);

            SheetGroup group = null;
            if (rebaseFrom != null && prevKey != null)
                group = _grouping.Find(prevKey);
            if (group == null && activeSheetId != 0)
                group = _grouping.FindContaining(activeSheetId);
            if (group == null && prevSelected != null)
            {
                foreach (long id in prevSelected)
                {
                    group = _grouping.FindContaining(id);
                    if (group != null)
                        break;
                }
            }
            if (group == null && prevKey != null)
                group = _grouping.Find(prevKey);
            if (group == null)
                group = _grouping.Groups.FirstOrDefault();

            WorkingOrderState keep = rebaseFrom != null && group != null && rebaseFrom.Group.Key.Equals(group.Key) ? rebaseFrom : null;
            SelectGroup(group, keep);

            // Сонгох мөр: идэвхтэй хуудас (анх нээхэд), эс бөгөөс өмнөх сонголт.
            var wanted = new List<long>();
            if (activeSheetId != 0 && _order != null && _order.Working.Any(s => s.SheetId == activeSheetId))
                wanted.Add(activeSheetId);
            else if (prevSelected != null && _order != null)
                wanted.AddRange(prevSelected.Where(id => _order.Working.Any(s => s.SheetId == id)));
            if (wanted.Count > 0)
            {
                _selectedIds.Clear();
                foreach (long id in wanted)
                    _selectedIds.Add(id);
                RequestSelectionRestore();
                ScrollToRequested?.Invoke(wanted[0]);
            }
        }

        private void SelectGroup(SheetGroup group, WorkingOrderState rebaseFrom)
        {
            _currentGroup = group;
            _selectedIds.Clear();
            _selectedIndex = -1;

            if (group == null)
            {
                _order = null;
                ClearRows();
                _plan = null;
                GroupHeader = "Урьдчилан харах";
                MarkTree();
                AfterStateChanged();
                return;
            }

            _order = rebaseFrom != null ? WorkingOrderState.Rebase(rebaseFrom, group) : new WorkingOrderState(group);
            GroupHeader = "Урьдчилан харах — " + group.Title;
            MarkTree();
            RebuildRows();
            Recompute();
            AfterStateChanged();
        }

        private void MarkTree()
        {
            _suppressNodeSelection = true;
            try
            {
                foreach (GroupNodeViewModel root in TreeRoots)
                {
                    foreach (GroupNodeViewModel n in root.Flatten())
                    {
                        bool sel = _currentGroup != null && n.Group != null && n.Group.Key.Equals(_currentGroup.Key);
                        n.SetSelectedSilently(sel);
                        n.IsDirty = sel && IsOrderDirty;
                    }
                }
            }
            finally
            {
                _suppressNodeSelection = false;
            }
        }

        private void OnNodeSelected(GroupNodeViewModel node)
        {
            if (_suppressNodeSelection)
                return;

            // Зөвхөн агуулагч (өөрийн хуудасгүй) зангилаа — одоогийн сонголтыг хэвээр үлдээнэ.
            if (node.Group == null)
            {
                MarkTree();
                return;
            }
            if (_currentGroup != null && node.Group.Key.Equals(_currentGroup.Key))
                return;

            if (IsOrderDirty && !_prompts.Confirm(Msg.ToolTitle, Msg.SwitchGroupConfirm, true))
            {
                MarkTree();   // сонголтыг хуучин бүлэг рүү буцаана
                return;
            }
            SelectGroup(node.Group, null);
        }

        /// <summary>Жагсаалтын сонголт өөрчлөгдсөн (view-ээс).  Сонгосон мөрийн дараалал нь WorkingOrder-оор.</summary>
        public void SetSelection(IEnumerable<long> ids)
        {
            if (_rebuilding)
                return;   // мөрүүдийг дахин байгуулах үеийн түр «сонголт арилсан» мэдэгдэл — VM-ийн сонголтыг хадгална
            _selectedIds.Clear();
            if (ids != null)
            {
                foreach (long id in ids)
                    _selectedIds.Add(id);
            }

            int old = _selectedIndex;
            _selectedIndex = -1;
            if (_order != null)
            {
                for (int i = 0; i < _order.Working.Count; i++)
                {
                    if (_selectedIds.Contains(_order.Working[i].SheetId))
                    {
                        _selectedIndex = i;
                        break;
                    }
                }
            }

            UpdateCommandStates();
            if (old != _selectedIndex && Settings.StartFromSelected)
                RequestRecompute(true);
        }

        public IReadOnlyCollection<long> SelectedIds => _selectedIds;

        private void RequestSelectionRestore()
        {
            Action<IReadOnlyList<long>> h = SelectionRestoreRequested;
            if (h != null)
                h(_selectedIds.ToList());
        }

        // ══════════════════════════════════════════════════════════════
        //  Дараалал (зөөх)
        // ══════════════════════════════════════════════════════════════
        public bool CanMove => !_busy && _order != null && _selectedIds.Count > 0;

        private void ExecuteMove(Func<ISet<long>, bool> move)
        {
            if (_order == null || _busy)
                return;
            if (move(_selectedIds))
                AfterOrderChanged();
        }

        /// <summary>Чирж зөөх (view-ээс): сонгосон мөрүүдийг <paramref name="insertIndex"/> (зөөхөөс өмнөх координат) байрлалд.</summary>
        public bool DropRows(IReadOnlyCollection<long> ids, int insertIndex)
        {
            if (_order == null || _busy || ids == null || ids.Count == 0)
                return false;
            if (!ids.All(IsInCurrentGroup))
                return false;   // ӨӨР бүлгийн хуудас — ХЭЗЭЭ Ч зөөхгүй
            var set = new HashSet<long>(ids);
            bool changed = _order.MoveSelectedTo(set, insertIndex);
            if (changed)
            {
                _selectedIds.Clear();
                foreach (long id in set)
                    _selectedIds.Add(id);
                AfterOrderChanged();
            }
            return changed;
        }

        /// <summary>Эдгээр хуудас БҮГД одоогийн бүлэгт байна.  Бүлэг хоорондын чирэлтийг татгалзахад.</summary>
        public bool IsInCurrentGroup(long sheetId)
        {
            return _currentGroup != null && _currentGroup.Sheets.Any(s => s.SheetId == sheetId);
        }

        public bool BelongsToGroup(long sheetId, GroupNodeViewModel node)
        {
            return node != null && node.Group != null && node.Group.Sheets.Any(s => s.SheetId == sheetId);
        }

        /// <summary>Энэ мод зангилаа ОДООГИЙН бүлгийн зангилаа (бүлэг хоорондын чирэлтийг татгалзахад).</summary>
        public bool BelongsToCurrentGroup(GroupNodeViewModel node)
        {
            return node != null && node.Group != null && _currentGroup != null && node.Group.Key.Equals(_currentGroup.Key);
        }

        /// <summary>Хуудсыг ӨӨР бүлэг рүү чирэх оролдлого — жагсаалт ӨӨРЧЛӨГДӨХГҮЙ, зөвхөн тайлбар.</summary>
        public void ReportInvalidDrop()
        {
            StatusText = Msg.InvalidDrop;
            StatusState = RowState.Warning;
        }

        /// <summary>Хүлээгдээгүй алдаа (цонхны үйлдэл дунд): логлоод, Revit-ийг унагаахгүйгээр хэрэглэгчид хэлнэ.</summary>
        public void ReportUnexpected(Exception ex)
        {
            try
            {
                if (ErrorLogger != null)
                    ErrorLogger("ui", ex);
            }
            catch (Exception)
            {
                // Лог бичихэд алдаа гарвал үргэлжилнэ.
            }
            StatusText = Msg.UnexpectedUiError;
            StatusState = RowState.Error;
            _prompts.ShowError(Msg.ToolTitle, Msg.UnexpectedUiError, ex.GetType().Name + ": " + ex.Message + "\nLog: " + _gateway.LogPath);
        }

        /// <summary>Алдааг логлох (Revit давхарга тавина).</summary>
        public Action<string, Exception> ErrorLogger { get; set; }

        /// <summary>Хаахаас өмнө: хадгалаагүй дараалал байвал баталгаа асууна.</summary>
        public bool ConfirmClose()
        {
            return !IsOrderDirty || _prompts.Confirm(Msg.ToolTitle, Msg.CloseDirtyConfirm, true);
        }

        private void ResetOrder()
        {
            if (_order == null)
                return;
            _order.Reset();
            AfterOrderChanged();
        }

        private void AfterOrderChanged()
        {
            RebuildRows();
            MarkTree();
            Recompute();
            Raise("IsOrderDirty");
            Raise("CanToggleMoveRenumber");
            UpdateCommandStates();
            RequestSelectionRestore();
        }

        private void RebuildRows()
        {
            _rebuilding = true;
            try
            {
                Rows.Clear();
                if (_order == null)
                    return;
                foreach (SheetSnapshot s in _order.Working)
                {
                    SheetRowViewModel row;
                    if (!_rowCache.TryGetValue(s.SheetId, out row) || !ReferenceEquals(row.Sheet, s))
                    {
                        row = new SheetRowViewModel(s);
                        _rowCache[s.SheetId] = row;
                    }
                    Rows.Add(row);
                }
            }
            finally
            {
                _rebuilding = false;
            }
        }

        private void ClearRows()
        {
            _rebuilding = true;
            try
            {
                Rows.Clear();
            }
            finally
            {
                _rebuilding = false;
            }
        }

        // ══════════════════════════════════════════════════════════════
        //  Урьдчилсан харалт (цэвэр тооцоо)
        // ══════════════════════════════════════════════════════════════
        public void RequestRecompute(bool immediate)
        {
            if (immediate)
            {
                _debounce.Stop();
                Recompute();
            }
            else
            {
                _debounce.Stop();
                _debounce.Start();
            }
        }

        public void Recompute()
        {
            _debounce.Stop();
            SyncFromFields();

            if (_snapshot == null || _currentGroup == null || _order == null)
            {
                _plan = null;
                AfterStateChanged();
                return;
            }

            _plan = NumberingEngine.Compute(new NumberingInput
            {
                Document = _snapshot,
                Group = _currentGroup,
                WorkingOrder = _order.Working,
                SelectedIndex = _selectedIndex,
                Settings = Settings,
                Markers = MarkerCaps,
            });

            // Талбарын задлалын алдаа (тоо биш г.м.) — Apply-ийг хаана.
            foreach (KeyValuePair<string, string> kv in _parseErrors)
            {
                var issue = ValidationIssue.Error(IssueCode.SettingsInvalid, kv.Value);
                issue.Field = kv.Key;
                _plan.GlobalIssues.Add(issue);
            }

            for (int i = 0; i < _plan.Rows.Count; i++)
            {
                PlannedRow pr = _plan.Rows[i];
                SheetRowViewModel row;
                if (_rowCache.TryGetValue(pr.Sheet.SheetId, out row))
                    row.Update(pr, Prefs.HidePreview);
            }

            AfterStateChanged();
        }

        private void AfterStateChanged()
        {
            RebuildFieldErrors();
            RebuildSummary();
            Raise("CanApply");
            Raise("EmptyHint");
            Raise("IsOrderDirty");
            Raise("CanToggleMoveRenumber");
            Raise("CanCleanMarkers");
            RaiseModeProperties();
            UpdateCommandStates();
        }

        private void UpdateCommandStates()
        {
            Raise("CanApply");
            Raise("CanMove");
            foreach (ICommand c in new ICommand[] { ApplyCommand, MoveUpCommand, MoveDownCommand, MoveTopCommand, MoveBottomCommand, ResetOrderCommand, CleanMarkersCommand })
            {
                RelayCommand rc = c as RelayCommand;
                if (rc != null)
                    rc.RaiseCanExecuteChanged();
            }
        }

        // ── Хураангуй, төлөв ────────────────────────────────────────
        private void RebuildSummary()
        {
            if (_snapshot == null)
            {
                StatusState = RowState.Normal;
                return;
            }
            if (_plan == null)
            {
                StatusText = string.Empty;
                StatusState = RowState.Normal;
                return;
            }

            ValidationIssue blocking = _plan.AllIssues.FirstOrDefault(i => i.IsBlocking);
            var parts = new List<string>();
            parts.Add("Өөрчлөгдөх: " + _plan.ChangedCount + " хуудас");
            int err = _plan.ErrorCount;
            int warn = _plan.WarningCount;
            if (err > 0)
                parts.Add("Алдаа: " + err);
            if (warn > 0)
                parts.Add("Анхааруулга: " + warn);

            if (_stale)
            {
                StatusState = RowState.Error;
                StatusText = "Жагсаалт хуучирсан — шинэчилнэ үү.";
            }
            else if (blocking != null)
            {
                StatusState = RowState.Error;
                StatusText = "Хэрэгжүүлэх боломжгүй: " + blocking.Message.Split('\n')[0] + "  ·  " + string.Join(" · ", parts);
            }
            else if (!_plan.HasChanges)
            {
                StatusState = RowState.Normal;
                StatusText = "Өөрчлөлт алга.";
            }
            else
            {
                StatusState = warn > 0 || _plan.GlobalIssues.Any(i => i.Severity == IssueSeverity.Warning) ? RowState.Warning : RowState.Changed;
                StatusText = string.Join(" · ", parts);
            }
        }

        /// <summary>Жагсаалтын дээд талын (мөрөнд хамаарахгүй) анхааруулгууд — «Жагсаалтын дараалал өөрчлөгдсөн…» г.м.</summary>
        public IReadOnlyList<string> GlobalWarnings
        {
            get
            {
                if (_plan == null)
                    return new string[0];
                return _plan.GlobalIssues.Where(i => i.Severity == IssueSeverity.Warning).Select(i => i.Message).ToList();
            }
        }

        public bool HasGlobalWarnings => GlobalWarnings.Count > 0;

        public string GlobalWarningText => string.Join("\n", GlobalWarnings);

        // ══════════════════════════════════════════════════════════════
        //  Хэрэгжүүлэх
        // ══════════════════════════════════════════════════════════════
        public async Task ApplyAsync()
        {
            if (!CanApply)
                return;

            ApplyRequest request = ApplyRequestBuilder.Build(_plan, _snapshot);
            if (request.Items.Count == 0)
                return;

            SetBusy(true, "Хэрэгжүүлж байна…");
            ApplyResult result;
            bool gatewayFailed = false;
            try
            {
                result = await _gateway.ApplyAsync(request);
            }
            catch (Exception ex)
            {
                gatewayFailed = true;
                result = new ApplyResult
                {
                    Outcome = ApplyOutcome.RollbackUnverified,
                    Message = "Өөрчлөлтийг хэрэгжүүлэх үед алдаа гарлаа. Жагсаалтыг шинэчилж, хуудасны дугаарыг шалгана уу.\nДэлгэрэнгүй мэдээллийг MGL Add-in log-оос шалгана уу.",
                    Detail = ex.GetType().Name + ": " + ex.Message + "\nLog: " + _gateway.LogPath,
                };
            }
            finally
            {
                SetBusy(false, string.Empty);
            }

            await HandleApplyResultAsync(result, gatewayFailed);
        }

        private async Task HandleApplyResultAsync(ApplyResult result, bool gatewayFailed)
        {
            switch (result.Outcome)
            {
                case ApplyOutcome.Applied:
                    Settings.ShiftActive = false;
                    Settings.CleanMarkers = false;
                    ShiftIncreaseOn = false;
                    ShiftDecreaseOn = false;
                    CleanActive = false;
                    await LoadAsync(keepOrder: false, selectActive: false);
                    StatusText = result.Message;
                    StatusState = RowState.Changed;
                    SaveSoon();
                    SuccessFlash?.Invoke(result.Message);
                    break;

                case ApplyOutcome.NothingToDo:
                    StatusText = result.Message;
                    StatusState = RowState.Normal;
                    break;

                case ApplyOutcome.Stale:
                    IsStale = true;
                    BannerText = result.Message + (string.IsNullOrEmpty(result.Detail) ? string.Empty : "\n" + result.Detail);
                    StatusText = result.Message.Split('\n')[0];
                    StatusState = RowState.Error;
                    RebuildSummary();
                    break;

                case ApplyOutcome.Blocked:
                case ApplyOutcome.RolledBack:
                    StatusText = result.Message.Split('\n')[0];
                    StatusState = RowState.Error;
                    _prompts.ShowError(Msg.ToolTitle, result.Message, result.Detail);
                    break;

                default:
                    // RollbackUnverified: төлөв тодорхойгүй — хэрэглэгчид хэлээд БОДИТ төлвийг дахин уншина.
                    StatusText = result.Message.Split('\n')[0];
                    StatusState = RowState.Error;
                    _prompts.ShowError(Msg.ToolTitle, result.Message, result.Detail);
                    await LoadAsync(keepOrder: true, selectActive: false);
                    break;
            }
        }

        // ══════════════════════════════════════════════════════════════
        //  Нэр өөрчлөх, устгах
        // ══════════════════════════════════════════════════════════════
        public async Task RenameAsync(SheetRowViewModel row)
        {
            if (row == null || _busy || _stale || _snapshot == null)
                return;
            string name = _prompts.AskText(Msg.RenameTitle, Msg.RenamePrompt, row.Sheet.Name);
            if (name == null)
                return;
            name = name.Trim();
            if (name.Length == 0 || string.Equals(name, row.Sheet.Name, StringComparison.Ordinal))
                return;

            SetBusy(true, "Нэр өөрчилж байна…");
            OperationResult res;
            try
            {
                res = await _gateway.RenameAsync(new RenameRequest
                {
                    DocumentKey = _snapshot.DocumentKey,
                    SheetId = row.Sheet.SheetId,
                    UniqueId = row.Sheet.UniqueId,
                    ExpectedNumber = row.Sheet.Number,
                    ExpectedName = row.Sheet.Name,
                    NewName = name,
                });
            }
            catch (Exception ex)
            {
                res = new OperationResult { Success = false, Message = "Нэрийг өөрчилж чадсангүй: " + ex.Message };
            }
            finally
            {
                SetBusy(false, string.Empty);
            }
            await HandleSheetOpAsync(res);
        }

        public async Task DeleteAsync(SheetRowViewModel row)
        {
            if (row == null || _busy || _stale || _snapshot == null)
                return;
            string confirm = Msg.DeleteConfirm(row.Sheet.Number, row.Sheet.Name);
            if (IsOrderDirty)
                confirm += "\n\n" + Msg.DeleteKeepsPendingOrder;   // зөөсөн дараалал ЧИМЭЭГҮЙ дахин суурилагдахгүй
            if (!_prompts.Confirm(Msg.DeleteTitle, confirm, true))
                return;

            SetBusy(true, "Хуудас устгаж байна…");
            OperationResult res;
            try
            {
                res = await _gateway.DeleteAsync(new DeleteRequest
                {
                    DocumentKey = _snapshot.DocumentKey,
                    SheetId = row.Sheet.SheetId,
                    UniqueId = row.Sheet.UniqueId,
                    ExpectedNumber = row.Sheet.Number,
                    ExpectedName = row.Sheet.Name,
                });
            }
            catch (Exception ex)
            {
                res = new OperationResult { Success = false, Message = "Хуудсыг устгаж чадсангүй: " + ex.Message };
            }
            finally
            {
                SetBusy(false, string.Empty);
            }
            await HandleSheetOpAsync(res);
        }

        private async Task HandleSheetOpAsync(OperationResult res)
        {
            if (res.Success)
            {
                // Хуудас өөрчлөгдсөн → шинэчилнэ, гэхдээ хэрэглэгчийн ЗӨӨСӨН дарааллыг (боломжтой бол) хадгална.
                await LoadAsync(keepOrder: true, selectActive: false);
                return;
            }
            if (res.Stale)
            {
                IsStale = true;
                BannerText = res.Message + (string.IsNullOrEmpty(res.Detail) ? string.Empty : "\n" + res.Detail);
                RebuildSummary();
                return;
            }
            _prompts.ShowError(Msg.ToolTitle, res.Message, res.Detail);
        }

        // ══════════════════════════════════════════════════════════════
        //  Document өөрчлөгдсөн эсэх
        // ══════════════════════════════════════════════════════════════
        /// <summary>Цонх идэвхжих бүрт (modeless тул document бидний мэдэлгүй өөрчлөгдөж болно).</summary>
        public async Task CheckFreshnessAsync()
        {
            if (_snapshot == null || _busy || _loading)
                return;
            DocumentStamp stamp;
            try
            {
                stamp = await _gateway.ReadStampAsync();
            }
            catch (Exception)
            {
                return;
            }
            if (_snapshot == null || _busy || _loading)
                return;

            FreshnessResult fr = FreshnessChecker.Compare(_snapshot, stamp, null);
            if (fr.IsFresh)
                return;

            if (fr.Status == FreshnessStatus.DocumentChanged && !IsOrderDirty)
            {
                // Өөр төсөл рүү шилжсэн — дараалал хадгалах зүйлгүй, шинэ контекстээр шууд ачаална.
                await LoadAsync(keepOrder: false, selectActive: true);
                return;
            }

            IsStale = true;
            switch (fr.Status)
            {
                case FreshnessStatus.NoDocument:
                    BannerText = Msg.NoDocumentNotice;
                    break;
                case FreshnessStatus.DocumentChanged:
                    BannerText = Msg.DocumentChangedNotice;
                    break;
                default:
                    BannerText = Msg.StaleNotice + "\n" + string.Join("\n", fr.Details.Take(6));
                    break;
            }
            RebuildSummary();
        }

        // ══════════════════════════════════════════════════════════════
        //  Горимын сонголтууд (харагдац)
        // ══════════════════════════════════════════════════════════════
        public bool IsGroupedMode
        {
            get { return Prefs.DisplayMode == DisplayMode.Grouped; }
            set
            {
                if (value)
                    SetDisplayMode(DisplayMode.Grouped);
            }
        }

        public bool IsAllInOneMode
        {
            get { return Prefs.DisplayMode == DisplayMode.AllInOne; }
            set
            {
                if (value)
                    SetDisplayMode(DisplayMode.AllInOne);
            }
        }

        private void SetDisplayMode(DisplayMode mode)
        {
            if (Prefs.DisplayMode == mode)
                return;
            if (IsOrderDirty && !_prompts.Confirm(Msg.ToolTitle, Msg.SwitchGroupConfirm, true))
            {
                Raise("IsGroupedMode");
                Raise("IsAllInOneMode");
                return;
            }
            Prefs.DisplayMode = mode;
            Raise("IsGroupedMode");
            Raise("IsAllInOneMode");
            Raise("CanSortByName");
            RebuildGroupingAfterModeChange();
        }

        public bool CanSortByName => Prefs.DisplayMode == DisplayMode.AllInOne;

        public bool SortByName
        {
            get { return Prefs.SortByName; }
            set
            {
                if (Prefs.SortByName == value)
                    return;
                if (IsOrderDirty && !_prompts.Confirm(Msg.ToolTitle, Msg.SwitchGroupConfirm, true))
                {
                    Raise("SortByName");
                    return;
                }
                Prefs.SortByName = value;
                Raise("SortByName");
                RebuildGroupingAfterModeChange();
            }
        }

        private void RebuildGroupingAfterModeChange()
        {
            if (_snapshot == null)
                return;
            var prevSelected = _selectedIds.ToList();
            long activeId = prevSelected.Count > 0 ? prevSelected[0] : (_snapshot.ActiveSheetId);
            _rowCache = new Dictionary<long, SheetRowViewModel>();
            BuildGrouping(null, null, activeId, prevSelected);
            Raise("ShowTree");
            Raise("EmptyHint");
        }

        public bool HidePreview
        {
            get { return Prefs.HidePreview; }
            set
            {
                if (Prefs.HidePreview == value)
                    return;
                Prefs.HidePreview = value;
                Raise("HidePreview");
                Raise("HidePreviewLabel");
                Recompute();
            }
        }

        public string HidePreviewLabel
        {
            get { return Prefs.HidePreview ? "Урьдчилсан өөрчлөлтийг харуулах" : "Урьдчилсан өөрчлөлтийг нуух"; }
        }

        // ── Хадгалалт ───────────────────────────────────────────────
        /// <summary>Хадгалах хүсэлт (Window/Command сонсож, диск рүү бичнэ).</summary>
        public event Action SaveRequested;

        private void SaveSoon()
        {
            Action h = SaveRequested;
            if (h != null)
                h();
        }

        /// <summary>Цонх хаагдахад: оруулсан тохиргоог Prefs-д эцэслэнэ.</summary>
        public SheetNumeratorPrefs ExportPrefs()
        {
            SyncFromFields();
            return Prefs;
        }
    }
}
