using System;
using System.Collections.Generic;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Documents;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Threading;
using RevitMcpAddin.SheetNumerator.Core;

namespace RevitMcpAddin.SheetNumerator.Ui
{
    /// <summary>
    /// «Зургийн хуудасны дугаарлалт» — модальгүй цонх.  Энэ файл нь ЗӨВХӨН харагдацын логик (чирж зөөх, сонголт,
    /// цонхны байрлал); бүх шийдвэр <see cref="SheetNumeratorViewModel"/>-д, Revit руу хүрэх нь gateway-ээр.
    ///
    /// Чирж зөөх дүрэм (эзний шаардлага): хуудсыг ЗӨВХӨН ӨӨРИЙН бүлгийн дотор зөөнө.  Өөр бүлгийн зангилаа дээр
    /// (эсвэл гаднаас) буулгах оролдлого «хориотой» курсор үзүүлж, жагсаалтад ЮУ Ч өөрчлөхгүй.  Олон мөр
    /// (Ctrl/Shift) нэг дор зөөгдөж харилцан дарааллаа хадгална.
    /// </summary>
    public partial class SheetNumeratorWindow : Window
    {
        internal const string DragFormat = "MglSheetNumeratorRows";

        private readonly SheetNumeratorViewModel _vm;
        private bool _restoringSelection;

        private Point _dragStart;
        private bool _dragPending;
        private bool _deferSelect;
        private SheetRowViewModel _downRow;
        private SheetRowViewModel _contextRow;
        private InsertionAdorner _adorner;
        private TreeViewItem _rejectHover;
        private Brush _rejectHoverOldBackground;

        /// <summary>Тохиргоог диск рүү бичих хүсэлт (цонх хаагдах үед, амжилттай хэрэгжсэний дараа).</summary>
        public event Action<SheetNumeratorPrefs> PersistRequested;

        public SheetNumeratorWindow(SheetNumeratorViewModel vm)
        {
            InitializeComponent();
            _vm = vm;
            DataContext = vm;

            // Дундын сэдэв (Light/Dark/өндөр контраст) — энэ цонхны ӨӨРИЙН resource-д л.
            RevitMcpAddin.Ui.MglTheme.Apply(this, 12);
            ApplySavedBounds(vm.Prefs.Window);

            vm.SelectionRestoreRequested += OnSelectionRestoreRequested;
            vm.ScrollToRequested += OnScrollToRequested;
            vm.SaveRequested += () => Persist();

            SheetList.SelectionChanged += OnListSelectionChanged;
            SheetList.PreviewMouseLeftButtonDown += OnListMouseDown;
            SheetList.PreviewMouseMove += OnListMouseMove;
            SheetList.PreviewMouseLeftButtonUp += OnListMouseUp;
            SheetList.PreviewMouseRightButtonDown += OnListRightDown;
            SheetList.DragOver += OnListDragOver;
            SheetList.DragLeave += OnListDragLeave;
            SheetList.Drop += OnListDrop;

            GroupTree.DragOver += OnTreeDragOver;
            GroupTree.DragLeave += OnTreeDragLeave;
            GroupTree.Drop += OnTreeDrop;

            Loaded += async (s, e) => await _vm.InitializeAsync();
            Activated += (s, e) =>
            {
                var _ = _vm.CheckFreshnessAsync();
            };
            Closing += OnClosing;
            Closed += (s, e) => Persist();
        }

        // ══════════════════════════════════════════════════════════════
        //  Сонголт
        // ══════════════════════════════════════════════════════════════
        private void OnListSelectionChanged(object sender, SelectionChangedEventArgs e)
        {
            if (_restoringSelection)
                return;
            _vm.SetSelection(SheetList.SelectedItems.OfType<SheetRowViewModel>().Select(r => r.SheetId));
        }

        private void OnSelectionRestoreRequested(IReadOnlyList<long> ids)
        {
            _restoringSelection = true;
            try
            {
                var wanted = new HashSet<long>(ids);
                SheetList.SelectedItems.Clear();
                foreach (SheetRowViewModel row in _vm.Rows)
                {
                    if (wanted.Contains(row.SheetId))
                        SheetList.SelectedItems.Add(row);
                }
            }
            finally
            {
                _restoringSelection = false;
            }
            _vm.SetSelection(SheetList.SelectedItems.OfType<SheetRowViewModel>().Select(r => r.SheetId));
        }

        private void OnScrollToRequested(long sheetId)
        {
            SheetRowViewModel row = _vm.Rows.FirstOrDefault(r => r.SheetId == sheetId);
            if (row != null)
                Dispatcher.BeginInvoke(new Action(() => SheetList.ScrollIntoView(row)), DispatcherPriority.Background);
        }

        // ══════════════════════════════════════════════════════════════
        //  Чирж зөөх — эх сурвалж
        // ══════════════════════════════════════════════════════════════
        private void OnListMouseDown(object sender, MouseButtonEventArgs e)
        {
            _dragPending = false;
            _deferSelect = false;
            ListViewItem item = ItemUnder(e.OriginalSource as DependencyObject);
            if (item == null)
                return;

            _downRow = item.DataContext as SheetRowViewModel;
            _dragStart = e.GetPosition(null);
            _dragPending = _downRow != null;

            // Олон мөр сонгосон үед сонгогдсон мөр дээр дарахад WPF сонголтыг ганцад хураадаг — чирэхийн тулд хадгална;
            // чирэлгүй суллавал (MouseUp) тэр үед л ганцад хураана.
            bool noModifiers = (Keyboard.Modifiers & (ModifierKeys.Control | ModifierKeys.Shift)) == ModifierKeys.None;
            if (item.IsSelected && noModifiers && SheetList.SelectedItems.Count > 1)
            {
                _deferSelect = true;
                e.Handled = true;
                item.Focus();
            }
        }

        private void OnListMouseMove(object sender, MouseEventArgs e)
        {
            if (!_dragPending || e.LeftButton != MouseButtonState.Pressed || _downRow == null)
                return;

            Point p = e.GetPosition(null);
            if (Math.Abs(p.X - _dragStart.X) < SystemParameters.MinimumHorizontalDragDistance
                && Math.Abs(p.Y - _dragStart.Y) < SystemParameters.MinimumVerticalDragDistance)
                return;

            _dragPending = false;
            _deferSelect = false;

            // Чирж буй мөр сонгогдоогүй бол зөвхөн тэр.
            List<SheetRowViewModel> selected = SheetList.SelectedItems.OfType<SheetRowViewModel>().ToList();
            if (!selected.Contains(_downRow))
            {
                SheetList.SelectedItems.Clear();
                SheetList.SelectedItems.Add(_downRow);
                selected = new List<SheetRowViewModel> { _downRow };
            }

            long[] ids = selected.Select(r => r.SheetId).ToArray();
            var data = new DataObject(DragFormat, ids);
            try
            {
                DragDrop.DoDragDrop(SheetList, data, DragDropEffects.Move);
            }
            finally
            {
                RemoveAdorner();
                ClearRejectHover();
            }
        }

        private void OnListMouseUp(object sender, MouseButtonEventArgs e)
        {
            if (_deferSelect && _downRow != null)
            {
                _restoringSelection = false;
                SheetList.SelectedItems.Clear();
                SheetList.SelectedItems.Add(_downRow);
            }
            _deferSelect = false;
            _dragPending = false;
        }

        private void OnListRightDown(object sender, MouseButtonEventArgs e)
        {
            ListViewItem item = ItemUnder(e.OriginalSource as DependencyObject);
            _contextRow = item != null ? item.DataContext as SheetRowViewModel : null;
            if (item != null && !item.IsSelected)
            {
                SheetList.SelectedItems.Clear();
                item.IsSelected = true;
            }
        }

        // ══════════════════════════════════════════════════════════════
        //  Чирж зөөх — жагсаалт (зорилт)
        // ══════════════════════════════════════════════════════════════
        private bool TryGetDraggedIds(IDataObject data, out long[] ids)
        {
            ids = null;
            if (data == null || !data.GetDataPresent(DragFormat))
                return false;
            ids = data.GetData(DragFormat) as long[];
            return ids != null && ids.Length > 0;
        }

        // WPF-ийн DragEventArgs-ийг ШУУД ашиглахгүй: шийдвэр бүр (`ComputeListDragEffect`, `HandleListDrop`, …) нь өгөгдөл +
        // «хулганы доорх элемент» + «байрлал» гурвыг л авдаг.  Ингэснээр UiSmoke бодит visual tree дээр hit-test хийж, хулгана
        // зөөхгүйгээр ижил логикийг шалгана; бодит `DoDragDrop`-ийн гогцоо нь л гараар шалгагдах хэсэг.
        private void OnListDragOver(object sender, DragEventArgs e)
        {
            e.Effects = ComputeListDragEffect(e.Data, e.OriginalSource as DependencyObject, e.GetPosition);
            e.Handled = true;
        }

        /// <summary>Жагсаалтын дээгүүр чирж байх үеийн эффект: өөрийн бүлгийн хуудас бол Move (+ оруулах шугам), бусад нь None.</summary>
        internal DragDropEffects ComputeListDragEffect(IDataObject data, DependencyObject originalSource, Func<IInputElement, Point> position)
        {
            long[] ids;
            if (!TryGetDraggedIds(data, out ids) || !ids.All(_vm.IsInCurrentGroup))
            {
                RemoveAdorner();
                return DragDropEffects.None;
            }

            int index = InsertionIndexAt(originalSource, position);
            ShowAdorner(index);
            AutoScroll(position);
            return DragDropEffects.Move;
        }

        private void OnListDragLeave(object sender, DragEventArgs e)
        {
            RemoveAdorner();
        }

        private void OnListDrop(object sender, DragEventArgs e)
        {
            if (HandleListDrop(e.Data, e.OriginalSource as DependencyObject, e.GetPosition) != DropOutcome.NotOurData)
                e.Handled = true;
        }

        internal enum DropOutcome
        {
            /// <summary>Манай мөрүүд биш (гаднаас файл гэх мэт) — үл тооно.</summary>
            NotOurData = 0,

            /// <summary>Өөр бүлгийн хуудас — жагсаалт ӨӨРЧЛӨГДӨӨГҮЙ, «хориотой» тайлбар гарсан.</summary>
            Rejected = 1,

            Moved = 2,

            /// <summary>Өөрийн бүлэг боловч дараалал өөрчлөгдсөнгүй (ижил байрлал).</summary>
            Unchanged = 3,
        }

        internal DropOutcome HandleListDrop(IDataObject data, DependencyObject originalSource, Func<IInputElement, Point> position)
        {
            RemoveAdorner();
            long[] ids;
            if (!TryGetDraggedIds(data, out ids))
                return DropOutcome.NotOurData;
            if (!ids.All(_vm.IsInCurrentGroup))
            {
                _vm.ReportInvalidDrop();
                return DropOutcome.Rejected;
            }
            int index = InsertionIndexAt(originalSource, position);
            return _vm.DropRows(ids, index) ? DropOutcome.Moved : DropOutcome.Unchanged;
        }

        /// <summary>Хулганы байрлалаас «зөөхөөс ӨМНӨХ жагсаалтын» оруулах индекс (0..Rows.Count).</summary>
        internal int InsertionIndexAt(DependencyObject originalSource, Func<IInputElement, Point> position)
        {
            ListViewItem item = ItemUnder(originalSource);
            if (item == null)
            {
                // Жагсаалтын хоосон хэсэг: толгойн ойролцоо бол эхэнд, бусад үед төгсгөлд.
                Point lp = position(SheetList);
                return lp.Y < 28 ? 0 : _vm.Rows.Count;
            }
            int idx = SheetList.ItemContainerGenerator.IndexFromContainer(item);
            if (idx < 0)
                return _vm.Rows.Count;
            Point p = position(item);
            return p.Y > item.ActualHeight / 2.0 ? idx + 1 : idx;
        }

        private void ShowAdorner(int index)
        {
            double y;
            if (!TryGetInsertionY(index, out y))
            {
                RemoveAdorner();
                return;
            }
            if (_adorner == null)
            {
                AdornerLayer layer = AdornerLayer.GetAdornerLayer(SheetList);
                if (layer == null)
                    return;
                _adorner = new InsertionAdorner(SheetList);
                layer.Add(_adorner);
            }
            _adorner.Y = y;
        }

        private bool TryGetInsertionY(int index, out double y)
        {
            y = 0;
            int count = _vm.Rows.Count;
            if (count == 0)
                return false;
            if (index < count)
            {
                var c = SheetList.ItemContainerGenerator.ContainerFromIndex(index) as FrameworkElement;
                if (c == null)
                    return false;
                y = c.TranslatePoint(new Point(0, 0), SheetList).Y;
                return true;
            }
            var last = SheetList.ItemContainerGenerator.ContainerFromIndex(count - 1) as FrameworkElement;
            if (last == null)
                return false;
            y = last.TranslatePoint(new Point(0, last.ActualHeight), SheetList).Y;
            return true;
        }

        private void RemoveAdorner()
        {
            if (_adorner == null)
                return;
            AdornerLayer layer = AdornerLayer.GetAdornerLayer(SheetList);
            if (layer != null)
                layer.Remove(_adorner);
            _adorner = null;
        }

        /// <summary>Жагсаалтын захад ойртоход шууд гүйлгэнэ — урт жагсаалтад чирэхэд зайлшгүй.</summary>
        private void AutoScroll(Func<IInputElement, Point> position)
        {
            ScrollViewer sv = FindScrollViewer(SheetList);
            if (sv == null)
                return;
            Point p = position(SheetList);
            const double zone = 26;
            if (p.Y < zone + 24)
                sv.ScrollToVerticalOffset(Math.Max(0, sv.VerticalOffset - 1));
            else if (p.Y > SheetList.ActualHeight - zone)
                sv.ScrollToVerticalOffset(sv.VerticalOffset + 1);
        }

        // ══════════════════════════════════════════════════════════════
        //  Чирж зөөх — мод (бүлэг хоорондын чирэлт ХОРИОТОЙ)
        // ══════════════════════════════════════════════════════════════
        private void OnTreeDragOver(object sender, DragEventArgs e)
        {
            ComputeTreeDragEffect(e.Data, e.OriginalSource as DependencyObject);
            e.Effects = DragDropEffects.None;   // модон дээр ХЭЗЭЭ Ч буулгахгүй — зөвхөн «хориотой» курсор
            e.Handled = true;
        }

        /// <summary>
        /// Модны дээгүүр чирэхэд ҮРГЭЛЖ «хориотой» (None): бүлэг хоорондын зөөлт хориотой, өөрийн бүлэг дээр буулгах нь нөлөөгүй.
        /// Өөр бүлгийн зангилааг улаанаар тодруулна.  Буцаах утга: тодруулсан зангилаа (байхгүй бол null).
        /// </summary>
        internal TreeViewItem ComputeTreeDragEffect(IDataObject data, DependencyObject originalSource)
        {
            long[] ids;
            if (!TryGetDraggedIds(data, out ids))
                return null;

            TreeViewItem tvi = TreeItemUnder(originalSource);
            if (tvi != _rejectHover)
            {
                ClearRejectHover();
                var node = tvi != null ? tvi.DataContext as GroupNodeViewModel : null;
                if (tvi != null && node != null && node.HasGroup && !_vm.BelongsToCurrentGroup(node))
                {
                    _rejectHover = tvi;
                    _rejectHoverOldBackground = tvi.Background;
                    tvi.Background = new SolidColorBrush(Color.FromArgb(0x40, 0xC6, 0x28, 0x28));
                }
            }
            return _rejectHover;
        }

        private void OnTreeDragLeave(object sender, DragEventArgs e)
        {
            ClearRejectHover();
        }

        private void OnTreeDrop(object sender, DragEventArgs e)
        {
            if (HandleTreeDrop(e.Data, e.OriginalSource as DependencyObject))
                e.Handled = true;
        }

        /// <summary>true = манай мөрүүдийн буулгалт (хориотой ч гэсэн «боловсруулсан»); false = гаднаас, үл тооно.</summary>
        internal bool HandleTreeDrop(IDataObject data, DependencyObject originalSource)
        {
            ClearRejectHover();
            long[] ids;
            if (!TryGetDraggedIds(data, out ids))
                return false;
            TreeViewItem tvi = TreeItemUnder(originalSource);
            var node = tvi != null ? tvi.DataContext as GroupNodeViewModel : null;
            if (node != null && !_vm.BelongsToCurrentGroup(node))
                _vm.ReportInvalidDrop();   // Бүлэг хоорондын зөөлт — ЖАГСААЛТ ӨӨРЧЛӨГДӨХГҮЙ
            return true;
        }

        private void ClearRejectHover()
        {
            if (_rejectHover != null)
            {
                _rejectHover.Background = _rejectHoverOldBackground;
                _rejectHover = null;
                _rejectHoverOldBackground = null;
            }
        }

        // ══════════════════════════════════════════════════════════════
        //  Контекст цэс
        // ══════════════════════════════════════════════════════════════
        private SheetRowViewModel CurrentContextRow()
        {
            if (_contextRow != null && _vm.Rows.Contains(_contextRow))
                return _contextRow;
            return SheetList.SelectedItem as SheetRowViewModel;
        }

        private async void OnRenameClick(object sender, RoutedEventArgs e)
        {
            try
            {
                await _vm.RenameAsync(CurrentContextRow());
            }
            catch (Exception ex)
            {
                _vm.ReportUnexpected(ex);
            }
        }

        private async void OnDeleteClick(object sender, RoutedEventArgs e)
        {
            try
            {
                await _vm.DeleteAsync(CurrentContextRow());
            }
            catch (Exception ex)
            {
                _vm.ReportUnexpected(ex);
            }
        }

        private void OnCloseClick(object sender, RoutedEventArgs e)
        {
            Close();
        }

        // ══════════════════════════════════════════════════════════════
        //  Цонхны байрлал, хаалт
        // ══════════════════════════════════════════════════════════════
        private void ApplySavedBounds(WindowPrefs w)
        {
            // Эзэн (Revit) цонх байгаа дэлгэцийн ажлын талбарт багтаана: MinWidth/MinHeight (960×620) жижиг дэлгэцээс (≈1366×768 @125 %)
            // том байсан тул «Хэрэгжүүлэх» товч дэлгэцээс гардаг, салсан дэлгэцийн хадгалсан байрлал алга болдог байв.
            // `WindowFit` (цэвэр, тестлэгдсэн) хэмжээ, байрлалыг тооцож, сонгосон байрлал хүчинтэй бол сэргээнэ.
            bool hasSaved = w != null && w.HasBounds;
            RevitMcpAddin.Ui.Core.UiRect? saved = hasSaved
                ? new RevitMcpAddin.Ui.Core.UiRect(w.Left, w.Top, w.Width, w.Height)
                : (RevitMcpAddin.Ui.Core.UiRect?)null;
            RevitMcpAddin.Ui.MglWindow.Setup(this, Title, 1180, 780, 960, 620, prefsKey: null, resizable: true,
                sizeToContentHeight: false, savedOverride: saved);
            if (hasSaved && w.Maximized)
                WindowState = WindowState.Maximized;
        }

        private void OnClosing(object sender, System.ComponentModel.CancelEventArgs e)
        {
            if (!_vm.ConfirmClose())
            {
                e.Cancel = true;
                return;
            }

            WindowPrefs w = _vm.Prefs.Window;
            Rect b = WindowState == WindowState.Normal ? new Rect(Left, Top, Width, Height) : base.RestoreBounds;
            if (!b.IsEmpty && !double.IsNaN(b.Left) && b.Width > 0 && b.Height > 0)
            {
                w.Left = b.Left;
                w.Top = b.Top;
                w.Width = b.Width;
                w.Height = b.Height;
                w.Maximized = WindowState == WindowState.Maximized;
            }
        }

        private void Persist()
        {
            Action<SheetNumeratorPrefs> h = PersistRequested;
            if (h == null)
                return;
            try
            {
                h(_vm.ExportPrefs());
            }
            catch (Exception)
            {
                // Тохиргоо хадгалагдахгүй байх нь ажиллагаанд саад болох ёсгүй.
            }
        }

        // ══════════════════════════════════════════════════════════════
        //  Visual tree туслахууд
        // ══════════════════════════════════════════════════════════════
        private static ListViewItem ItemUnder(DependencyObject source)
        {
            while (source != null && !(source is ListViewItem))
            {
                if (source is Visual || source is System.Windows.Media.Media3D.Visual3D)
                    source = VisualTreeHelper.GetParent(source);
                else
                    source = LogicalTreeHelper.GetParent(source);
            }
            return source as ListViewItem;
        }

        private static TreeViewItem TreeItemUnder(DependencyObject source)
        {
            while (source != null && !(source is TreeViewItem))
            {
                if (source is Visual || source is System.Windows.Media.Media3D.Visual3D)
                    source = VisualTreeHelper.GetParent(source);
                else
                    source = LogicalTreeHelper.GetParent(source);
            }
            return source as TreeViewItem;
        }

        private static ScrollViewer FindScrollViewer(DependencyObject d)
        {
            if (d == null)
                return null;
            if (d is ScrollViewer)
                return (ScrollViewer)d;
            int n = VisualTreeHelper.GetChildrenCount(d);
            for (int i = 0; i < n; i++)
            {
                ScrollViewer sv = FindScrollViewer(VisualTreeHelper.GetChild(d, i));
                if (sv != null)
                    return sv;
            }
            return null;
        }

        // ── Оруулах цэгийн шугам ────────────────────────────────────
        private sealed class InsertionAdorner : Adorner
        {
            private static readonly Pen LinePen = MakePen();
            private double _y;

            public InsertionAdorner(UIElement adorned)
                : base(adorned)
            {
                IsHitTestVisible = false;
            }

            public double Y
            {
                get { return _y; }
                set
                {
                    _y = value;
                    InvalidateVisual();
                }
            }

            protected override void OnRender(DrawingContext dc)
            {
                double w = AdornedElement.RenderSize.Width;
                dc.DrawLine(LinePen, new Point(0, _y), new Point(w, _y));
                dc.DrawEllipse(LinePen.Brush, null, new Point(3, _y), 3, 3);
            }

            private static Pen MakePen()
            {
                var b = new SolidColorBrush(Color.FromRgb(0x15, 0x65, 0xC0));
                b.Freeze();
                var p = new Pen(b, 2);
                p.Freeze();
                return p;
            }
        }
    }
}
