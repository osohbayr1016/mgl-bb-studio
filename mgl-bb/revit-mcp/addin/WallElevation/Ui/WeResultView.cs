using System;
using System.Collections.Generic;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using RevitMcpAddin.Ui;
using RevitMcpAddin.WallElevation.Core;

namespace RevitMcpAddin.WallElevation.Ui
{
    /// <summary>Үр дүнгийн хөтчийн үйлдэл (W06).</summary>
    public enum WeResultAction
    {
        OpenSheet,
        OpenView,
        SelectViewport,
        Locate,
        ShowInPlan,
        Refresh,
        Closed,
    }

    /// <summary>Үйлдлийн зорилт — Revit-ийн объектгүй (id-ууд).</summary>
    public sealed class WeResultTarget
    {
        public long SheetId;
        public long ViewId;
        public long ViewportId;
        public string RoomUid;
        public string What;
    }

    /// <summary>
    /// ҮР ДҮНГИЙН ХӨТӨЧ-ийн цонх (W06, 2026-10-16) — Өрөө → Дэлгээс → одоогийн Хуудас.  Revit-ийн төрөлгүй (UI smoke-д ажиллана): индексийг
    /// <see cref="SetIndex"/>-ээр авч харуулна, үйлдлийг <see cref="ActionRequested"/>-ээр хостод (Revit-ийн ExternalEvent) өгнө.  Хуудас бүрийг нэг
    /// нэгээр шалгах «Шалгасан · Дараах» (2026-10-14-ний самбараас) энд — шалгасан тэмдэг индекс дахин уншихад хадгалагдана.
    /// </summary>
    public sealed class WeResultView : Window
    {
        public const string WindowTitle = "MGL — Ханын дэлгээсийн үр дүн";

        private readonly TreeView _tree = new TreeView { MinHeight = 160 };
        private readonly TextBlock _summary;
        private readonly TextBlock _status;
        private readonly Button _openSheet, _openView, _selectVp, _locate, _plan, _refresh, _prev, _next;
        private List<WeResultRoom> _rooms = new List<WeResultRoom>();
        private WeReviewState _review = new WeReviewState(new List<WeReviewItem>());
        private int _fitSkipped;
        private WeResultRoom _selRoom;
        private WeResultRow _selRow;

        /// <summary>Хост (Revit) хэрэгжүүлнэ — Revit API зөвхөн тэнд.</summary>
        public event Action<WeResultAction, WeResultTarget> ActionRequested;

        public IList<WeResultRoom> Rooms { get { return _rooms; } }
        public WeReviewState Review { get { return _review; } }
        public string StatusText { get { return _status.Text; } }

        public WeResultView()
        {
            MglWindow.Setup(this, WindowTitle, 560, 520, 420, 320, "wall-elevation-results");
            MglTheme.Apply(this);
            Topmost = false;
            var root = new Grid { Margin = new Thickness(12, 10, 12, 10) };
            root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            root.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
            root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });

            var head = new StackPanel { Margin = new Thickness(0, 0, 0, 8) };
            head.Children.Add(MglUi.Heading("Өрөө → дэлгээс → хуудас"));
            _summary = MglUi.Muted(string.Empty);
            _summary.TextWrapping = TextWrapping.Wrap;
            head.Children.Add(_summary);
            head.Children.Add(MglUi.Muted("Мөр дээр давхар дарвал нээнэ · Enter / → = хуудас шалгасан, дараагийнх · ← = өмнөх"));
            Grid.SetRow(head, 0);
            root.Children.Add(head);

            _tree.SelectedItemChanged += (s, e) => OnSelect();
            _tree.MouseDoubleClick += (s, e) => OpenSelected();
            MglAuto.Name(_tree, "Үр дүнгийн жагсаалт");
            Grid.SetRow(_tree, 1);
            root.Children.Add(_tree);

            _status = MglUi.Muted(string.Empty);
            _status.TextWrapping = TextWrapping.Wrap;
            _status.Margin = new Thickness(0, 6, 0, 0);
            MglAuto.Name(_status, "Үр дүнгийн мэдэгдэл");
            Grid.SetRow(_status, 2);
            root.Children.Add(_status);

            var bars = new StackPanel { Margin = new Thickness(0, 8, 0, 0) };
            var row1 = new WrapPanel();
            _openSheet = Btn("Хуудас нээх", "Сонгосон мөрийн одоогийн хуудсыг нээнэ (хэрэглэгч зөөсөн бол тэр хуудас)", WeResultAction.OpenSheet, row1);
            _openView = Btn("Харагдац нээх", "Дэлгээс / түлхүүр план / 3D харагдацыг нээнэ", WeResultAction.OpenView, row1);
            _selectVp = Btn("Viewport сонгох", "Хуудсыг нээж тэр viewport-ийг сонгоод томруулна", WeResultAction.SelectViewport, row1);
            _locate = Btn("Project Browser-т олох", "Project Browser-ийг харуулж харагдацыг сонгоно (Revit тэр мөрийг тодруулна); Browser Organization-ийн шүүлтүүрт"
                                                    + Environment.NewLine + "нуугдсан бол тайлбарлаад эндээс нээнэ.  Browser Organization-ийг өөрчлөхгүй.", WeResultAction.Locate, row1);
            bars.Children.Add(row1);
            var row2 = new DockPanel { Margin = new Thickness(0, 4, 0, 0), LastChildFill = false };
            _prev = new Button { Content = "◀ Өмнөх", Padding = new Thickness(10, 4, 10, 4), Margin = new Thickness(0, 0, 6, 0) };
            _prev.Click += (s, e) => Previous();
            _plan = new Button { Content = "Планд харуулах", Padding = new Thickness(10, 4, 10, 4), Margin = new Thickness(0, 0, 6, 0),
                                 ToolTip = "Өрөөг план дээр бусад өрөөтэй хамт тодруулж томруулна (загварт юу ч бичихгүй)" };
            _plan.Click += (s, e) => Raise(WeResultAction.ShowInPlan, false);
            _refresh = new Button { Content = "Шинэчлэх", Padding = new Thickness(10, 4, 10, 4), Margin = new Thickness(0, 0, 6, 0),
                                    ToolTip = "Жагсаалтыг баримтаас дахин уншина (гараар зөөсөн, нэрийг сольсон, устгасан зураг)" };
            _refresh.Click += (s, e) => Raise(WeResultAction.Refresh, false);
            _next = MglUi.Primary(new Button { Content = "Шалгасан · Дараах ▶", Padding = new Thickness(12, 4, 12, 4) });
            _next.Click += (s, e) => Next();
            foreach (Button b in new[] { _prev, _plan, _refresh }) { MglAuto.Name(b, (string)b.Content); DockPanel.SetDock(b, Dock.Left); row2.Children.Add(b); }
            MglAuto.Name(_next, "Шалгасан Дараах");
            DockPanel.SetDock(_next, Dock.Right);
            row2.Children.Add(_next);
            bars.Children.Add(row2);
            Grid.SetRow(bars, 3);
            root.Children.Add(bars);
            Content = root;

            PreviewKeyDown += OnKey;
            Closed += (s, e) => Raise(WeResultAction.Closed, false);
        }

        private Button Btn(string text, string tip, WeResultAction act, Panel host)
        {
            var b = new Button { Content = text, Padding = new Thickness(10, 3, 10, 3), Margin = new Thickness(0, 0, 6, 4), ToolTip = tip };
            MglAuto.Name(b, text);
            b.Click += (s, e) => Raise(act, false);
            host.Children.Add(b);
            return b;
        }

        /// <summary>
        /// Индексийг харуулна (анх эсвэл «Шинэчлэх»-ийн дараа) — хуудас шалгасан тэмдэг, сонголт хадгалагдана.  <paramref name="sheetNames"/> =
        /// хуудасны id → нэр (шалгах жагсаалтын бичвэрт; байхгүй бол хоосон).
        /// </summary>
        public void SetIndex(List<WeResultRoom> rooms, Func<long, string> sheetNames, int fitSkipped)
        {
            string keepKey = _selRow != null ? _selRow.Key : null, keepRoom = _selRoom != null ? _selRoom.RoomUid : null;
            var checkedSheets = new HashSet<long>(_review.Items.Where(i => i.Checked).Select(i => i.SheetId));
            long curSheet = _review.Item != null ? _review.Item.SheetId : 0;
            _rooms = rooms ?? new List<WeResultRoom>();
            _fitSkipped = fitSkipped;
            var items = new List<WeReviewItem>();
            foreach (WeResultRoom r in _rooms)
                foreach (KeyValuePair<long, string> sh in r.Sheets)
                {
                    if (items.Any(i => i.SheetId == sh.Key)) continue;
                    items.Add(new WeReviewItem { SheetId = sh.Key, SheetNumber = sh.Value, SheetName = sheetNames != null ? sheetNames(sh.Key) : null,
                                                 RoomUid = r.RoomUid, RoomLabel = r.Label, Checked = checkedSheets.Contains(sh.Key) });
                }
            _review = new WeReviewState(items);
            int cur = items.FindIndex(i => i.SheetId == curSheet);
            if (cur >= 0) _review.Select(cur);
            Fill(keepRoom, keepKey);
        }

        public void Say(string text) { _status.Text = text ?? string.Empty; }

        private void Fill(string keepRoom, string keepKey)
        {
            _tree.Items.Clear();
            TreeViewItem select = null;
            foreach (WeResultRoom r in _rooms)
            {
                r.Checked = r.Sheets.Count > 0 && r.Sheets.All(s => _review.Items.Any(i => i.SheetId == s.Key && i.Checked));
                var node = new TreeViewItem { Header = Mark(r.Worst) + r.Title, Tag = r, IsExpanded = true };
                MglAuto.Name(node, "Өрөө " + (r.Label ?? r.RoomUid));
                foreach (WeResultRow row in r.Rows)
                {
                    var child = new TreeViewItem { Header = Mark(row.State) + row.Title, Tag = row };
                    if (!string.IsNullOrEmpty(row.Note)) child.ToolTip = row.Note;
                    MglAuto.Name(child, "Мөр " + (row.Label ?? row.Kind.ToString()) + " " + row.State);
                    node.Items.Add(child);
                    if (keepKey != null && row.Key == keepKey && select == null) select = child;
                }
                _tree.Items.Add(node);
                if (select == null && keepKey == null && keepRoom != null && r.RoomUid == keepRoom) select = node;
            }
            if (select == null && _tree.Items.Count > 0) select = (TreeViewItem)_tree.Items[0];
            if (select != null) { select.IsSelected = true; select.BringIntoView(); }
            _summary.Text = WeResultIndex.Summary(_rooms) + (_fitSkipped > 0 ? " · " + _fitSkipped + " зургийн байрлалыг шалгаагүй (хугацаа) — «Шинэчлэх»" : string.Empty)
                            + " · шалгасан хуудас " + _review.CheckedCount + "/" + _review.Items.Count;
            OnSelect();
        }

        public static string Mark(WeResultState s)
        {
            switch (s)
            {
                case WeResultState.Failed: return "✖ ";
                case WeResultState.Unplaced: return "○ ";
                case WeResultState.Arrange: return "⚠ ";
                default: return "✓ ";
            }
        }

        /// <summary>Мөр/өрөөг түлхүүр (мөр) эсвэл өрөөний UniqueId-аар сонгоно — UI smoke, хост.</summary>
        public bool SelectByKey(string rowKey, string roomUid = null)
        {
            foreach (TreeViewItem node in _tree.Items.OfType<TreeViewItem>())
            {
                var r = node.Tag as WeResultRoom;
                if (rowKey == null && r != null && r.RoomUid == roomUid) { node.IsSelected = true; return true; }
                foreach (TreeViewItem child in node.Items.OfType<TreeViewItem>())
                {
                    var row = child.Tag as WeResultRow;
                    if (row != null && row.Key == rowKey) { child.IsSelected = true; return true; }
                }
            }
            return false;
        }

        private void OnSelect()
        {
            var item = _tree.SelectedItem as TreeViewItem;
            _selRow = item != null ? item.Tag as WeResultRow : null;
            _selRoom = item != null ? item.Tag as WeResultRoom : null;
            if (_selRow != null) _selRoom = _rooms.FirstOrDefault(r => r.Rows.Contains(_selRow));
            _openSheet.IsEnabled = SheetTarget() != 0;
            _openView.IsEnabled = _selRow != null && _selRow.ViewId != 0;
            _selectVp.IsEnabled = _selRow != null && _selRow.ViewportId != 0 && _selRow.SheetId != 0;
            _locate.IsEnabled = _selRow != null ? _selRow.ViewId != 0 : SheetTarget() != 0;
            _plan.IsEnabled = _selRoom != null && !string.IsNullOrEmpty(_selRoom.RoomUid);
            _next.IsEnabled = _review.Items.Count > 0;
            _prev.IsEnabled = _review.Items.Count > 0;
            if (_selRow != null && !string.IsNullOrEmpty(_selRow.Note)) _status.Text = _selRow.Note;
            else if (_selRow == null) _status.Text = string.Empty;
        }

        private long SheetTarget()
        {
            if (_selRow != null) return _selRow.SheetId;
            if (_selRoom != null && _selRoom.Sheets.Count > 0) return _selRoom.Sheets[0].Key;
            return 0;
        }

        private void OpenSelected()
        {
            if (_selRow != null && _selRow.ViewId != 0) Raise(WeResultAction.OpenView, false);
            else if (SheetTarget() != 0) Raise(WeResultAction.OpenSheet, false);
        }

        private void OnKey(object sender, KeyEventArgs e)
        {
            if (e.Key == Key.Enter || e.Key == Key.Right) { Next(); e.Handled = true; }
            else if (e.Key == Key.Left) { Previous(); e.Handled = true; }
            else if (e.Key == Key.Escape) { Close(); e.Handled = true; }
        }

        /// <summary>«Шалгасан · Дараах»: одоогийн хуудсыг шалгасан болгоод дараагийн шалгаагүй хуудсыг нээнэ.</summary>
        public void Next()
        {
            if (_review.Items.Count == 0) return;
            bool more = _review.Next();
            SelectReviewRoom();
            if (more) Raise(WeResultAction.OpenSheet, true);
            else Say("Бүх хуудсыг шалгасан.");
        }

        public void Previous()
        {
            if (_review.Items.Count == 0) return;
            _review.Previous();
            SelectReviewRoom();
            Raise(WeResultAction.OpenSheet, true);
        }

        /// <summary>Эхний (одоогийн) шалгах хуудсыг нээх хүсэлт — ажил дуусахад хэрэглэгч хүлээж байсан бол.</summary>
        public void OpenCurrentReviewSheet()
        {
            if (_review.Item != null) Raise(WeResultAction.OpenSheet, true);
        }

        private void SelectReviewRoom()
        {
            WeReviewItem it = _review.Item;
            Fill(it != null ? it.RoomUid : null, null);
        }

        private void Raise(WeResultAction a, bool sheetFromReview)
        {
            var t = new WeResultTarget
            {
                SheetId = sheetFromReview && _review.Item != null ? _review.Item.SheetId : SheetTarget(),
                ViewId = _selRow != null ? _selRow.ViewId : 0,
                ViewportId = _selRow != null ? _selRow.ViewportId : 0,
                RoomUid = _selRoom != null ? _selRoom.RoomUid : null,
                What = _selRow != null ? _selRow.Title : _selRoom != null ? _selRoom.Label : null,
            };
            Action<WeResultAction, WeResultTarget> h = ActionRequested;
            if (h != null) h(a, t);
        }
    }
}
