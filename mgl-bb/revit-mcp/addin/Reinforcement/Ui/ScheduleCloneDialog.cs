using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Data;
using WpfBinding = System.Windows.Data.Binding;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;
using RevitMcpAddin.Reinforcement.Core;

namespace RevitMcpAddin.Reinforcement.Ui
{
    /// <summary>Partition мөр (checkbox + урьдчилан харах).</summary>
    internal sealed class RfCloneRow : INotifyPropertyChanged
    {
        public readonly RfPartitionValue Value;
        private bool _checked;
        private string _status = string.Empty;
        private string _name = string.Empty;
        private string _note = string.Empty;

        public RfCloneRow(RfPartitionValue v) { Value = v; }

        public event PropertyChangedEventHandler PropertyChanged;

        private void Raise(string n)
        {
            PropertyChangedEventHandler h = PropertyChanged;
            if (h != null) h(this, new PropertyChangedEventArgs(n));
        }

        public bool IsChecked
        {
            get { return _checked; }
            set { if (_checked != value) { _checked = value; Raise("IsChecked"); } }
        }

        /// <summary>Хоосон зайг ил харуулахын тулд эхэнд/төгсгөлд зай байвал хашилтаар.</summary>
        public string Partition { get { return Value.HasEdgeWhitespace ? "\"" + Value.Value + "\"" : Value.Value; } }
        public int RebarCount { get { return Value.RebarCount; } }

        public string Status { get { return _status; } set { if (_status != value) { _status = value; Raise("Status"); } } }
        public string Name { get { return _name; } set { if (_name != value) { _name = value; Raise("Name"); } } }
        public string Note { get { return _note; } set { if (_note != value) { _note = value; Raise("Note"); } } }
    }

    /// <summary>
    /// «Түүвэр хувилах» цонх.  Эх түүвэр, Partition талбар, нэрийн загвар, байгаа түүврийн бодлого, Partition-ы
    /// жагсаалт + УРЬДЧИЛАН ХАРАХ (юу үүснэ, юу байгаа, юу шинэчлэгдэх, юу мөргөлдөх).  Загварыг ӨӨРЧЛӨХГҮЙ —
    /// «Үүсгэх» дарахад л <see cref="Request"/> гарна, бичилтийг команд хийнэ.
    /// </summary>
    internal sealed class ScheduleCloneDialog : Window
    {
        private readonly RfSchedulePrefs _prefs;
        private readonly RfScheduleSourcePanel _src;
        private readonly RadioButton _pSkip, _pUpdate, _pReplace;
        private readonly CheckBox _all = new CheckBox { Content = RfText.SelectAll, IsThreeState = true, Margin = new Thickness(0, 0, 0, 4) };
        private readonly DataGrid _grid = new DataGrid();
        private readonly System.Windows.Controls.TextBox _search = new System.Windows.Controls.TextBox { MinWidth = 240, Margin = new Thickness(0, 0, 0, 4), VerticalContentAlignment = VerticalAlignment.Center };
        private ICollectionView _view;
        private readonly List<RfCloneRow> _rows = new List<RfCloneRow>();
        private readonly TextBlock _summary = new TextBlock { TextWrapping = TextWrapping.Wrap };
        private readonly Button _ok;
        private bool _bulk;
        private RfPartitionSet _builtFor;

        public RfCloneRequest Request { get; private set; }
        public RfSchedulePrefs ResultPrefs { get { return _prefs; } }

        public ScheduleCloneDialog(RfScheduleSession session, List<ViewSchedule> templates, ViewSchedule preferred, RfSchedulePrefs prefs)
        {
            _prefs = prefs ?? new RfSchedulePrefs();
            RfUi.Setup(this, RfText.CloneTitle, 1000, 760, 860, 620);

            var root = new DockPanel { Margin = new Thickness(14) };

            // ── Толгой
            var head = new StackPanel { Margin = new Thickness(0, 0, 0, 6) };
            head.Children.Add(new TextBlock { Text = RfText.CloneHeader, FontSize = 16, FontWeight = FontWeights.SemiBold });
            head.Children.Add(RfUi.Hint(RfText.CloneIntro));
            DockPanel.SetDock(head, Dock.Top);
            root.Children.Add(head);

            // ── Доод: товч
            var bottom = new DockPanel { Margin = new Thickness(0, 10, 0, 0) };
            var buttons = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Right };
            var preview = RfUi.MakeButton(RfText.Preview, false, false);
            preview.Click += (s, e) => Recompute();
            _ok = RfUi.MakeButton(RfText.Create, true, false);
            global::RevitMcpAddin.Ui.MglUi.Primary(_ok);
            _ok.Click += OnCreate;
            Button cancel = RfUi.MakeButton(RfText.Cancel, false, true, 80);
            buttons.Children.Add(preview);
            buttons.Children.Add(_ok);
            buttons.Children.Add(cancel);
            DockPanel.SetDock(buttons, Dock.Right);
            bottom.Children.Add(buttons);
            bottom.Children.Add(RfUi.Note(RfText.Ctrlz));
            DockPanel.SetDock(bottom, Dock.Bottom);
            root.Children.Add(bottom);

            // ── Дээд хэсэг: эх, талбар, загвар, бодлого
            _src = new RfScheduleSourcePanel(session, templates, preferred);
            var top = new StackPanel();
            top.Children.Add(_src);

            top.Children.Add(RfUi.Section(RfText.ExistingPolicyLabel));
            var pol = new StackPanel { Orientation = Orientation.Horizontal };
            _pSkip = new RadioButton { Content = RfText.PolicySkip, Margin = new Thickness(0, 0, 18, 0), IsChecked = _prefs.Policy == 0 };
            _pUpdate = new RadioButton { Content = RfText.PolicyUpdate, Margin = new Thickness(0, 0, 18, 0), IsChecked = _prefs.Policy == 1 };
            _pReplace = new RadioButton { Content = RfText.PolicyReplace, IsChecked = _prefs.Policy == 2 };
            if (_prefs.Policy < 0 || _prefs.Policy > 2) _pSkip.IsChecked = true;
            pol.Children.Add(_pSkip);
            pol.Children.Add(_pUpdate);
            pol.Children.Add(_pReplace);
            top.Children.Add(pol);

            top.Children.Add(RfUi.Section(RfText.PartitionsLabel));
            // «Бүгдийг сонгох» + хайлт (Partition эсвэл үүсэх түүврийн нэрээр).  Хайлт нь ЗӨВХӨН жагсаалтыг шүүнэ — Revit-ийн шүүлтүүр БИШ.
            var selectRow = new StackPanel { Orientation = Orientation.Horizontal };
            _all.Margin = new Thickness(0, 0, 18, 4);
            _search.ToolTip = RfText.SearchLabel;
            selectRow.Children.Add(_all);
            selectRow.Children.Add(new TextBlock { Text = RfText.SearchLabel, Margin = new Thickness(0, 0, 6, 4), VerticalAlignment = VerticalAlignment.Center });
            selectRow.Children.Add(_search);
            top.Children.Add(selectRow);
            DockPanel.SetDock(top, Dock.Top);
            root.Children.Add(top);

            // ── Summary (grid-ийн доор)
            DockPanel.SetDock(_summary, Dock.Bottom);
            _summary.Margin = new Thickness(0, 6, 0, 0);
            root.Children.Add(_summary);

            // ── Partition-ы жагсаалт
            BuildGrid();
            _view = CollectionViewSource.GetDefaultView(_rows);
            _view.Filter = o => Matches(o as RfCloneRow);
            root.Children.Add(_grid);
            Content = root;

            _src.Changed += (s, e) => OnSourceChanged();
            _pSkip.Checked += (s, e) => Recompute();
            _pUpdate.Checked += (s, e) => Recompute();
            _pReplace.Checked += (s, e) => Recompute();
            _all.Click += OnAllClicked;
            _search.TextChanged += (s, e) => { _view.Refresh(); Recompute(); };
            OnSourceChanged();
        }

        private void BuildGrid()
        {
            _grid.AutoGenerateColumns = false;
            _grid.CanUserAddRows = false;
            _grid.CanUserDeleteRows = false;
            _grid.HeadersVisibility = DataGridHeadersVisibility.Column;
            _grid.SelectionMode = DataGridSelectionMode.Single;
            _grid.IsReadOnly = true;
            _grid.GridLinesVisibility = DataGridGridLinesVisibility.Horizontal;
            _grid.MinHeight = 160;

            var cbFactory = new FrameworkElementFactory(typeof(CheckBox));
            cbFactory.SetBinding(CheckBox.IsCheckedProperty, new WpfBinding("IsChecked") { Mode = BindingMode.TwoWay, UpdateSourceTrigger = UpdateSourceTrigger.PropertyChanged });
            cbFactory.SetValue(FrameworkElement.HorizontalAlignmentProperty, HorizontalAlignment.Center);
            _grid.Columns.Add(new DataGridTemplateColumn { Header = "", Width = 34, CellTemplate = new DataTemplate { VisualTree = cbFactory } });
            _grid.Columns.Add(new DataGridTextColumn { Header = RfText.ColPartition, Binding = new WpfBinding("Partition"), Width = new DataGridLength(1.2, DataGridLengthUnitType.Star) });
            _grid.Columns.Add(new DataGridTextColumn { Header = RfText.ColRebar, Binding = new WpfBinding("RebarCount"), Width = 80 });
            _grid.Columns.Add(new DataGridTextColumn { Header = RfText.ColStatus, Binding = new WpfBinding("Status"), Width = 130 });
            _grid.Columns.Add(new DataGridTextColumn { Header = RfText.ColName, Binding = new WpfBinding("Name"), Width = new DataGridLength(2, DataGridLengthUnitType.Star) });
            _grid.Columns.Add(new DataGridTextColumn { Header = Lang.T("Тайлбар", "Note"), Binding = new WpfBinding("Note"), Width = new DataGridLength(2, DataGridLengthUnitType.Star) });
        }

        private RfExistingPolicy Policy
        {
            get
            {
                if (_pReplace.IsChecked == true) return RfExistingPolicy.Replace;
                if (_pUpdate.IsChecked == true) return RfExistingPolicy.UpdateFilter;
                return RfExistingPolicy.Skip;
            }
        }

        // ── Өгөгдөл дахин уншигдсан (загвар/талбар солигдсон) → мөрүүдийг дахин байгуулна ──
        private void OnSourceChanged()
        {
            if (!_src.Ready)
            {
                _rows.Clear();
                _builtFor = null;
                _grid.ItemsSource = null;
                _ok.IsEnabled = false;
                _summary.Text = _src.Template == null ? RfText.NoTemplates : RfText.NoPartitionField;
                return;
            }

            if (!ReferenceEquals(_builtFor, _src.Partitions))
            {
                _builtFor = _src.Partitions;
                foreach (RfCloneRow r in _rows) r.PropertyChanged -= OnRowChanged;
                _rows.Clear();
                foreach (RfPartitionValue v in _src.Partitions.Values)
                {
                    var row = new RfCloneRow(v);
                    // Эх түүвэр өөрийн Partition-ыг (DN-1) аль хэдийн агуулдаг — анхнаасаа сонгохгүй.
                    row.IsChecked = !string.Equals(v.Value, _src.TemplateFilterValue, StringComparison.Ordinal);
                    row.PropertyChanged += OnRowChanged;
                    _rows.Add(row);
                }
                _grid.ItemsSource = null;
                _grid.ItemsSource = _rows;
            }
            Recompute();
        }

        private void OnRowChanged(object sender, PropertyChangedEventArgs e)
        {
            if (_bulk || e.PropertyName != "IsChecked") return;
            Recompute();
        }

        /// <summary>Хайлтад тохирох мөр (хоосон хайлт = бүгд).  Partition эсвэл үүсэх түүврийн нэрээр, том/жижиг үсэг үл хамаарна.</summary>
        private bool Matches(RfCloneRow r)
        {
            if (r == null) return false;
            string q = _search.Text == null ? string.Empty : _search.Text.Trim();
            if (q.Length == 0) return true;
            return r.Partition.IndexOf(q, StringComparison.CurrentCultureIgnoreCase) >= 0;
        }

        private List<RfCloneRow> Visible()
        {
            return _view == null ? new List<RfCloneRow>(_rows) : _view.Cast<RfCloneRow>().ToList();
        }

        /// <summary>
        /// Үүсгэх/шинэчлэх мөрүүд = харагдаж буй (хайлтад тохирсон) БА чагталсан.  Хайлтаар нуугдсан мөр чагтлаатай ч ҮҮСГЭГДЭХГҮЙ —
        /// эс бөгөөс «DN-1» гэж хайгаад «Үүсгэх» дарсан хүнд бүх Partition-ийн түүвэр үүснэ.
        /// </summary>
        private List<RfCloneRow> Chosen()
        {
            return Visible().Where(r => r.IsChecked).ToList();
        }

        /// <summary>«Бүгдийг сонгох» нь ЗӨВХӨН харагдаж буй (хайлтад тохирсон) мөрөнд хамаарна.</summary>
        private void OnAllClicked(object sender, RoutedEventArgs e)
        {
            bool target = _all.IsChecked == true;
            _bulk = true;
            foreach (RfCloneRow r in Visible()) r.IsChecked = target;
            _bulk = false;
            Recompute();
        }

        private void UpdateAllState()
        {
            List<RfCloneRow> vis = Visible();
            _bulk = true;
            if (vis.Count == 0) _all.IsChecked = false;
            else if (vis.All(r => r.IsChecked)) _all.IsChecked = true;
            else if (vis.Any(r => r.IsChecked)) _all.IsChecked = null;
            else _all.IsChecked = false;
            _bulk = false;
        }

        // ── Урьдчилан харах ───────────────────────────────────────────
        private void Recompute()
        {
            if (!_src.Ready) return;
            RfNameIssue issue = _src.PatternIssue;

            List<RfCloneRow> checkedRows = Chosen();
            // «Жишээ» нэр = чагталсан ЭХНИЙ Partition-ээр (бодит нэрийн томьёогоор) — хэрэглэгч «Үүсгэх» дарахаас өмнө үүсэх нэрийг харна.
            _src.SetExamplePartition(checkedRows.Count > 0 ? checkedRows[0].Value.Value : null);
            List<RfPartitionValue> chosen = checkedRows.Select(r => r.Value).ToList();
            List<RfClonePlanItem> plan = RfClonePlanner.Plan(
                chosen, _src.Pattern, _src.Template.Name, _src.Template.Id.Value, _src.Existing, Policy, AllPartitionValues());
            var byPartition = new Dictionary<string, RfClonePlanItem>(StringComparer.Ordinal);
            foreach (RfClonePlanItem p in plan) byPartition[p.Partition] = p;

            foreach (RfCloneRow r in _rows)
            {
                RfClonePlanItem item;
                if (!checkedRows.Contains(r) || !byPartition.TryGetValue(r.Value.Value, out item))
                {
                    r.Status = string.Empty;
                    r.Name = string.Empty;
                    r.Note = string.Empty;
                    continue;
                }
                r.Status = RfText.ActionLabel(item.Action);
                r.Name = item.ProposedName;
                var notes = new List<string>();
                string reason = RfText.ReasonLabel(item.Reason);
                if (reason.Length > 0) notes.Add(reason);
                foreach (RfCloneWarn w in item.Warnings) notes.Add(RfText.WarnLabel(w));
                r.Note = string.Join("; ", notes);
            }

            int create = plan.Count(p => p.Action == RfCloneAction.Create);
            int update = plan.Count(p => p.Action == RfCloneAction.UpdateFilter);
            int replace = plan.Count(p => p.Action == RfCloneAction.Replace);
            int exist = plan.Count(p => p.Action == RfCloneAction.UpToDate);
            int skip = plan.Count(p => p.Action == RfCloneAction.Skip);
            int conflict = plan.Count(p => p.Action == RfCloneAction.Conflict);
            _summary.Text = RfText.PlanSummary(create, update, replace, exist, skip, conflict);
            _ok.IsEnabled = issue == RfNameIssue.None && (create + update + replace) > 0;

            UpdateAllState();
        }

        private void OnCreate(object sender, RoutedEventArgs e)
        {
            Recompute();
            List<RfCloneRow> checkedRows = Chosen();
            List<RfClonePlanItem> plan = RfClonePlanner.Plan(
                checkedRows.Select(r => r.Value).ToList(), _src.Pattern, _src.Template.Name, _src.Template.Id.Value, _src.Existing, Policy,
                AllPartitionValues());
            List<RfClonePlanItem> doable = plan.Where(p =>
                p.Action == RfCloneAction.Create || p.Action == RfCloneAction.UpdateFilter || p.Action == RfCloneAction.Replace).ToList();
            if (doable.Count == 0)
            {
                TaskDialog.Show(RfText.CloneTitle, RfText.NothingToDo);
                return;
            }

            List<RfClonePlanItem> replaces = doable.Where(p => p.Action == RfCloneAction.Replace).ToList();
            if (replaces.Count > 0)
            {
                // ⚠️ Устгалттай үйлдэл — ЗААВАЛ баталгаажуулна.
                var td = new TaskDialog(RfText.CloneTitle)
                {
                    MainInstruction = RfText.PolicyReplace,
                    MainContent = RfText.ConfirmReplace(replaces.Select(p => p.ProposedName).ToList(), replaces.Sum(p => p.SheetPlacements)),
                    CommonButtons = TaskDialogCommonButtons.Yes | TaskDialogCommonButtons.No,
                    DefaultButton = TaskDialogResult.No,
                };
                if (td.Show() != TaskDialogResult.Yes) return;
            }

            // «Солих» (устгадаг) нь ДАРААГИЙН удаа өгөгдмөл болж санагдахгүй — зөвхөн «Алгасах»/«Filter шинэчлэх».
            _prefs.Policy = Policy == RfExistingPolicy.UpdateFilter ? 1 : 0;
            List<RfClonePlanItem> notDone = plan.Except(doable).ToList();
            Request = new RfCloneRequest
            {
                Template = _src.Template,
                ParamId = _src.ParamId,
                AddHiddenField = _src.AddHidden,
                Items = doable,
                PlannedSkips = notDone.Count,
                PlannedUpToDate = notDone.Count(p => p.Action == RfCloneAction.UpToDate),
                PlannedConflicts = notDone.Count(p => p.Action == RfCloneAction.Conflict),
            };
            foreach (RfClonePlanItem p in notDone.Where(p => p.Action == RfCloneAction.Conflict))
                Request.PlannedNotes.Add(RfText.ItemFailed(p.Partition, RfText.ReasonLabel(p.Reason)));
            DialogResult = true;
        }

        /// <summary>Загварын БҮХ Partition утга (сонгоогүй ч) — нэрийн мөргөлдөөнийг бүгдээр нь шалгахад.</summary>
        private List<string> AllPartitionValues()
        {
            return _rows.Select(r => r.Value.Value).ToList();
        }
    }
}
