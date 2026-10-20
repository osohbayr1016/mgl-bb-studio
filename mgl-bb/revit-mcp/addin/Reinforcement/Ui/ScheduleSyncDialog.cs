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
    internal enum RfSyncAction { None, CreateMissing, FixFilters, DeleteTicked }

    internal sealed class RfSyncGridRow : INotifyPropertyChanged
    {
        public readonly RfSyncRow Row;
        private bool _delete;

        public RfSyncGridRow(RfSyncRow row) { Row = row; }

        public event PropertyChangedEventHandler PropertyChanged;

        public string Partition { get { return Row.Partition; } }
        public string Status { get { return RfText.SyncStatusLabel(Row.Status); } }
        public string Expected { get { return Row.ExpectedName; } }
        public string Current { get { return Row.ScheduleName ?? string.Empty; } }
        public bool CanDelete { get { return Row.Status == RfSyncStatus.Orphan; } }

        public bool Delete
        {
            get { return _delete; }
            set
            {
                if (!CanDelete) return; // ЗӨВХӨН «загварт Partition алга» мөрийг устгаж болно
                if (_delete != value)
                {
                    _delete = value;
                    PropertyChangedEventHandler h = PropertyChanged;
                    if (h != null) h(this, new PropertyChangedEventArgs("Delete"));
                }
            }
        }
    }

    /// <summary>
    /// «Түүвэр синк хийх» цонх: загвар дахь Partition-ууд ба үүсгэсэн түүврүүдийг харьцуулж төлөв гаргана.
    /// ЮУ Ч АВТОМАТААР УСТГАХГҮЙ — устгах нь зөвхөн «загварт Partition алга» мөрийг гараар чагталсан үед.
    /// Цонх нэг үйлдэл сонгоод хаагдана; бичилтийг команд хийнэ.
    /// </summary>
    internal sealed class ScheduleSyncDialog : Window
    {
        private readonly RfScheduleSourcePanel _src;
        private readonly DataGrid _grid = new DataGrid();
        private readonly List<RfSyncGridRow> _rows = new List<RfSyncGridRow>();
        private readonly TextBlock _summary = new TextBlock { TextWrapping = TextWrapping.Wrap };
        private readonly Button _bCreate, _bFix, _bDelete;

        public RfSyncAction Action { get; private set; }
        public RfCloneRequest Request { get; private set; }
        public List<long> DeleteIds { get; private set; }

        /// <summary>Эх түүврийн id — устгалтаас хамгаална.</summary>
        public long TemplateId { get { return _src.Template == null ? -1 : _src.Template.Id.Value; } }

        public ScheduleSyncDialog(RfScheduleSession session, List<ViewSchedule> templates, ViewSchedule preferred)
        {
            RfUi.Setup(this, RfText.SyncTitle, 1000, 740, 860, 600);
            DeleteIds = new List<long>();

            var root = new DockPanel { Margin = new Thickness(14) };
            var head = new StackPanel { Margin = new Thickness(0, 0, 0, 6) };
            head.Children.Add(new TextBlock { Text = RfText.SyncHeader, FontSize = 16, FontWeight = FontWeights.SemiBold });
            head.Children.Add(RfUi.Hint(RfText.SyncIntro));
            DockPanel.SetDock(head, Dock.Top);
            root.Children.Add(head);

            var buttons = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Right, Margin = new Thickness(0, 10, 0, 0) };
            _bCreate = RfUi.MakeButton(RfText.SyncCreateMissing, false, false, 130);
            _bFix = RfUi.MakeButton(RfText.SyncFixFilters, false, false, 130);
            _bDelete = RfUi.MakeButton(RfText.SyncDeleteTicked, false, false, 130);
            Button close = RfUi.MakeButton(RfText.Close, false, true, 80);
            _bCreate.Click += OnCreateMissing;
            _bFix.Click += OnFixFilters;
            _bDelete.Click += OnDeleteTicked;
            buttons.Children.Add(_bCreate);
            buttons.Children.Add(_bFix);
            buttons.Children.Add(_bDelete);
            buttons.Children.Add(close);
            DockPanel.SetDock(buttons, Dock.Bottom);
            root.Children.Add(buttons);

            _src = new RfScheduleSourcePanel(session, templates, preferred);
            DockPanel.SetDock(_src, Dock.Top);
            root.Children.Add(_src);

            DockPanel.SetDock(_summary, Dock.Bottom);
            _summary.Margin = new Thickness(0, 6, 0, 0);
            root.Children.Add(_summary);

            BuildGrid();
            root.Children.Add(_grid);
            Content = root;

            _src.Changed += (s, e) => Refresh();
            Refresh();
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
            _grid.Margin = new Thickness(0, 8, 0, 0);
            _grid.MinHeight = 160;

            _grid.Columns.Add(new DataGridTextColumn { Header = RfText.ColPartition, Binding = new WpfBinding("Partition"), Width = new DataGridLength(1, DataGridLengthUnitType.Star) });
            _grid.Columns.Add(new DataGridTextColumn { Header = RfText.ColStatus, Binding = new WpfBinding("Status"), Width = 190 });
            _grid.Columns.Add(new DataGridTextColumn { Header = RfText.ColName, Binding = new WpfBinding("Expected"), Width = new DataGridLength(2, DataGridLengthUnitType.Star) });
            _grid.Columns.Add(new DataGridTextColumn { Header = RfText.ColSchedule, Binding = new WpfBinding("Current"), Width = new DataGridLength(2, DataGridLengthUnitType.Star) });

            var cb = new FrameworkElementFactory(typeof(CheckBox));
            cb.SetBinding(CheckBox.IsCheckedProperty, new WpfBinding("Delete") { Mode = BindingMode.TwoWay, UpdateSourceTrigger = UpdateSourceTrigger.PropertyChanged });
            cb.SetBinding(UIElement.IsEnabledProperty, new WpfBinding("CanDelete") { Mode = BindingMode.OneWay });
            cb.SetValue(FrameworkElement.HorizontalAlignmentProperty, HorizontalAlignment.Center);
            _grid.Columns.Add(new DataGridTemplateColumn { Header = RfText.ColTick, Width = 70, CellTemplate = new DataTemplate { VisualTree = cb } });
        }

        private void Refresh()
        {
            foreach (RfSyncGridRow r in _rows) r.PropertyChanged -= OnRowChanged;
            _rows.Clear();
            _grid.ItemsSource = null;

            if (!_src.Ready || _src.PatternIssue != RfNameIssue.None)
            {
                _summary.Text = !_src.Ready ? RfText.NoPartitionField : RfText.PatternIssue(_src.PatternIssue);
                UpdateButtons();
                return;
            }

            List<string> parts = _src.Partitions.Values.Select(v => v.Value).ToList();
            List<RfSyncRow> rows = RfSyncPlanner.Plan(parts, _src.Pattern, _src.Template.Name, _src.Template.Id.Value, _src.Existing);
            foreach (RfSyncRow r in rows)
            {
                var gr = new RfSyncGridRow(r);
                gr.PropertyChanged += OnRowChanged;
                _rows.Add(gr);
            }
            _grid.ItemsSource = _rows;

            Func<RfSyncStatus, int> n = st => rows.Count(x => x.Status == st);
            _summary.Text = string.Join(" · ", new[]
            {
                RfText.SyncStatusLabel(RfSyncStatus.Missing) + " " + n(RfSyncStatus.Missing),
                RfText.SyncStatusLabel(RfSyncStatus.UpToDate) + " " + (n(RfSyncStatus.UpToDate) + n(RfSyncStatus.UpToDateRenamed)),
                RfText.SyncStatusLabel(RfSyncStatus.WrongTarget) + " " + n(RfSyncStatus.WrongTarget),
                RfText.SyncStatusLabel(RfSyncStatus.Conflict) + " " + n(RfSyncStatus.Conflict),
                RfText.SyncStatusLabel(RfSyncStatus.Orphan) + " " + n(RfSyncStatus.Orphan),
            });
            UpdateButtons();
        }

        private void OnRowChanged(object sender, PropertyChangedEventArgs e) { UpdateButtons(); }

        private void UpdateButtons()
        {
            _bCreate.IsEnabled = _rows.Any(r => r.Row.Status == RfSyncStatus.Missing);
            _bFix.IsEnabled = _rows.Any(r => r.Row.Status == RfSyncStatus.WrongTarget);
            _bDelete.IsEnabled = _rows.Any(r => r.Delete);
        }

        private RfCloneRequest MakeRequest(IEnumerable<RfClonePlanItem> items)
        {
            return new RfCloneRequest
            {
                Template = _src.Template,
                ParamId = _src.ParamId,
                AddHiddenField = _src.AddHidden,
                Items = items.ToList(),
            };
        }

        private void OnCreateMissing(object sender, RoutedEventArgs e)
        {
            // Хоёр ӨӨР Partition нэг нэрэнд хөрвөх бол (ж: «DN:1» ба «DN_1») ЭХНИЙГ нь л үүсгэнэ; Revit давхар нэрийг хүлээж авахгүй.
            var usedNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            var skippedNotes = new List<string>();
            var items = new List<RfClonePlanItem>();
            foreach (RfSyncGridRow r in _rows.Where(x => x.Row.Status == RfSyncStatus.Missing))
            {
                if (!usedNames.Add(r.Row.ExpectedName))
                {
                    skippedNotes.Add(RfText.ItemFailed(r.Row.Partition, RfText.ReasonLabel(RfCloneReason.DuplicateName)));
                    continue;
                }
                items.Add(new RfClonePlanItem
                {
                    Partition = r.Row.Partition,
                    ProposedName = r.Row.ExpectedName,
                    Action = RfCloneAction.Create,
                });
            }
            Request = MakeRequest(items);
            Request.PlannedSkips = skippedNotes.Count;
            Request.PlannedConflicts = skippedNotes.Count;
            Request.PlannedNotes.AddRange(skippedNotes);
            Action = RfSyncAction.CreateMissing;
            DialogResult = true;
        }

        private void OnFixFilters(object sender, RoutedEventArgs e)
        {
            var items = _rows.Where(r => r.Row.Status == RfSyncStatus.WrongTarget).Select(r => new RfClonePlanItem
            {
                Partition = r.Row.Partition,
                ProposedName = r.Row.ExpectedName,
                Action = RfCloneAction.UpdateFilter,
                ExistingId = r.Row.ScheduleId,
            });
            Request = MakeRequest(items);
            Action = RfSyncAction.FixFilters;
            DialogResult = true;
        }

        private void OnDeleteTicked(object sender, RoutedEventArgs e)
        {
            List<long> ids = _rows.Where(r => r.Delete).Select(r => r.Row.ScheduleId).Distinct().ToList();
            if (ids.Count == 0) return;
            List<string> names = _rows.Where(r => r.Delete).Select(r => r.Row.ScheduleName).Distinct().ToList();
            var td = new TaskDialog(RfText.SyncTitle)
            {
                MainInstruction = RfText.SyncDeleteTicked,
                MainContent = RfText.ConfirmDelete(names),
                CommonButtons = TaskDialogCommonButtons.Yes | TaskDialogCommonButtons.No,
                DefaultButton = TaskDialogResult.No,
            };
            if (td.Show() != TaskDialogResult.Yes) return;
            DeleteIds = ids;
            Action = RfSyncAction.DeleteTicked;
            DialogResult = true;
        }
    }
}
