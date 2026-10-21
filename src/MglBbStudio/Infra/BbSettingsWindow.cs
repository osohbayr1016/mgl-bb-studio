using System;
using System.Collections.Generic;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Interop;
using System.Windows.Media;
using MglBb.Core;

namespace MglBb.Infra
{
    /// <summary>
    /// «Тохиргоо»: option сонгох / шинээр үүсгэх / устгах, option-ий арматурын шошго, хомутын шошго, MRA-ийн төрлийг (энэ төсөлд ачаалсан төрлүүдээс)
    /// сонгох.  «Үндсэн» = сурсан стандарт (зөвхөн харах).  «Хадгалах» нь option-уудыг ба ЭНЭ төсөлд идэвхтэй option-ийг хадгална.
    /// Revit-ийн API дуудахгүй (төрлийн жагсаалтыг дуудагч өгнө).
    /// </summary>
    internal sealed class BbSettingsWindow
    {
        private const string Learned = "(сурсан утга)";

        private sealed class Row
        {
            public ComboBox Box;
            public Func<BbOption, string> Get;
            public Action<BbOption, string> Set;
            public IList<string> Choices;
        }

        private readonly Window _w;
        private readonly BbOptionBook _book;
        private readonly BbStandard _learned;
        private readonly string _projectKey;
        private readonly ComboBox _opt = new ComboBox { MinWidth = 300 };
        private readonly TextBox _newName = new TextBox { MinWidth = 220, Margin = new Thickness(0, 0, 8, 0) };
        private readonly Button _del;
        private readonly TextBlock _state = new TextBlock { TextWrapping = TextWrapping.Wrap, Foreground = Brushes.DimGray, Margin = new Thickness(0, 4, 0, 0) };
        private readonly TextBlock _error = new TextBlock { TextWrapping = TextWrapping.Wrap, Foreground = Brushes.Firebrick, Margin = new Thickness(0, 4, 0, 0) };
        private readonly List<Row> _rows = new List<Row>();
        private bool _loading;

        public BbOptionBook Result { get; private set; }

        /// <param name="tagTypes">Төслийн арматурын шошгоны төрөл «family : type».</param>
        /// <param name="mraTypes">Төслийн MRA төрлийн нэр.</param>
        public BbSettingsWindow(BbOptionBook book, BbStandard learned, string projectKey, string projectTitle, IList<string> tagTypes, IList<string> mraTypes)
        {
            _book = BbOptionBook.FromJson(BbJson.Parse(BbJson.Write(book.ToJson())));   // засварыг «Хадгалах» хүртэл хуулбар дээр
            _learned = learned;
            _projectKey = projectKey;

            _w = new Window
            {
                Title = "MGL ББ — Тохиргоо",
                Width = 720,
                SizeToContent = SizeToContent.Height,
                ResizeMode = ResizeMode.NoResize,
                WindowStartupLocation = WindowStartupLocation.CenterOwner,
                ShowInTaskbar = false,
                FontFamily = new FontFamily("Segoe UI"),
                FontSize = 13,
            };
            var root = new DockPanel { Margin = new Thickness(16) };
            var buttons = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Right, Margin = new Thickness(0, 14, 0, 0) };
            DockPanel.SetDock(buttons, Dock.Bottom);
            var save = new Button { Content = "Хадгалах", MinWidth = 96, Padding = new Thickness(10, 4, 10, 4), IsDefault = true, Margin = new Thickness(0, 0, 8, 0) };
            var cancel = new Button { Content = "Болих", MinWidth = 96, Padding = new Thickness(10, 4, 10, 4), IsCancel = true };
            save.Click += (s, e) => { _book.SetActive(_projectKey, SelectedName); Result = _book; _w.DialogResult = true; };
            buttons.Children.Add(save);
            buttons.Children.Add(cancel);
            root.Children.Add(buttons);

            var body = new StackPanel();
            body.Children.Add(new TextBlock
            {
                Text = "Ажлын зураг үүсгэх ба «Стандартаар тэмдэглэх»-ийн арматурын шошго, хомутын шошго, MRA-ийн төрөл.  «Үндсэн» нь сурсан стандарт — " +
                       "өөр утга хэрэгтэй бол шинэ option үүсгэж хадгална.  Option-ууд бүх төсөлд хуваалцагдана; аль нь идэвхтэйг төсөл бүр өөрөө санана.",
                TextWrapping = TextWrapping.Wrap,
                Margin = new Thickness(0, 0, 0, 10),
            });

            body.Children.Add(Heading("Энэ төсөлд хэрэглэх option  (" + projectTitle + ")"));
            var optRow = new StackPanel { Orientation = Orientation.Horizontal };
            optRow.Children.Add(_opt);
            _del = new Button { Content = "Устгах", MinWidth = 80, Padding = new Thickness(8, 2, 8, 2), Margin = new Thickness(8, 0, 0, 0) };
            _del.Click += (s, e) => Delete();
            optRow.Children.Add(_del);
            body.Children.Add(optRow);

            var newRow = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 6, 0, 0) };
            newRow.Children.Add(new TextBlock { Text = "Шинэ option:", Width = 90, VerticalAlignment = VerticalAlignment.Center });
            newRow.Children.Add(_newName);
            var create = new Button { Content = "Үүсгэх", MinWidth = 80, Padding = new Thickness(8, 2, 8, 2) };
            create.Click += (s, e) => Create();
            newRow.Children.Add(create);
            body.Children.Add(newRow);
            body.Children.Add(new TextBlock { Text = "Шинэ option нь одоо харагдаж буй утгуудаар эхэлнэ.", Foreground = Brushes.DimGray, Margin = new Thickness(90, 2, 0, 0) });
            body.Children.Add(_error);

            var grid = new Grid { Margin = new Thickness(0, 8, 0, 0) };
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(150) });
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(150) });
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            AddKind(grid, "Дамнуруу", o => o.Beam, tagTypes, mraTypes);
            AddKind(grid, "Туслах дамнуруу", o => o.BeamAux, tagTypes, mraTypes);
            AddKind(grid, "Багана", o => o.Column, tagTypes, mraTypes);
            AddRow(grid, "Хана", "MRA", o => o.WallMraType, (o, v) => o.WallMraType = v, mraTypes);
            AddRow(grid, "Хучилт", "MRA", o => o.SlabMraType, (o, v) => o.SlabMraType = v, mraTypes);
            body.Children.Add(Heading("Шошго ба MRA-ийн төрөл"));
            body.Children.Add(grid);
            body.Children.Add(Heading("Огтлолын арматурын шошго (дамнуруу, туслах дамнуруу, багана)"));
            body.Children.Add(LayoutPanel());
            body.Children.Add(_state);
            root.Children.Add(body);
            _w.Content = root;

            _opt.SelectionChanged += (s, e) => { if (!_loading) ShowSelected(); };
            FillOptions(_book.ActiveFor(_projectKey));
        }

        private string SelectedName { get { return _opt.SelectedItem as string ?? BbOptionBook.BaseName; } }

        private static TextBlock Heading(string text)
        {
            return new TextBlock { Text = text, FontWeight = FontWeights.SemiBold, Margin = new Thickness(0, 10, 0, 4) };
        }

        private void AddKind(Grid g, string kind, Func<BbOption, BbTagSet> set, IList<string> tags, IList<string> mras)
        {
            AddRow(g, kind, "Арматурын шошго", o => set(o).BarTagType, (o, v) => set(o).BarTagType = v, tags);
            AddRow(g, "", "Хомутын шошго", o => set(o).StirrupTagType, (o, v) => set(o).StirrupTagType = v, tags);
            AddRow(g, "", "Хомутын MRA", o => set(o).MraType, (o, v) => set(o).MraType = v, mras);
        }

        private void AddRow(Grid g, string kind, string label, Func<BbOption, string> get, Action<BbOption, string> setter, IList<string> choices)
        {
            int r = g.RowDefinitions.Count;
            g.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            var k = new TextBlock { Text = kind, FontWeight = FontWeights.SemiBold, VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(0, kind.Length > 0 && r > 0 ? 8 : 2, 0, 2) };
            var l = new TextBlock { Text = label, VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(0, 2, 0, 2) };
            var box = new ComboBox { Margin = new Thickness(0, 2, 0, 2) };
            Grid.SetRow(k, r); Grid.SetColumn(k, 0);
            Grid.SetRow(l, r); Grid.SetColumn(l, 1);
            Grid.SetRow(box, r); Grid.SetColumn(box, 2);
            g.Children.Add(k); g.Children.Add(l); g.Children.Add(box);
            var row = new Row { Box = box, Get = get, Set = setter, Choices = choices ?? new List<string>() };
            box.SelectionChanged += (s, e) =>
            {
                if (_loading) return;
                BbOption o = _book.Find(SelectedName);
                if (o != null && box.SelectedItem is ComboBoxItem it) row.Set(o, it.Tag as string ?? "");
                UpdateState();
            };
            _rows.Add(row);
        }

        private void FillOptions(string select)
        {
            _loading = true;
            _opt.Items.Clear();
            _opt.Items.Add(BbOptionBook.BaseName);
            foreach (BbOption o in _book.Options.OrderBy(o => o.Name, StringComparer.CurrentCulture)) _opt.Items.Add(o.Name);
            _opt.SelectedItem = _book.Find(select)?.Name ?? BbOptionBook.BaseName;
            _loading = false;
            ShowSelected();
        }

        /// <summary>Сонгосон option-ий утгууд («Үндсэн» бол сурсан стандартынх, засагдахгүй).</summary>
        private BbOption Shown()
        {
            return _book.Find(SelectedName) ?? BbOption.FromStandard(BbOptionBook.BaseName, _learned);
        }

        private void ShowSelected()
        {
            bool isBase = _book.Find(SelectedName) == null;
            BbOption shown = Shown();
            BbOption learned = BbOption.FromStandard(BbOptionBook.BaseName, _learned);
            _loading = true;
            foreach (Row r in _rows)
            {
                string v = r.Get(shown) ?? "";
                r.Box.Items.Clear();
                if (!isBase) r.Box.Items.Add(new ComboBoxItem { Content = Learned + Suffix(r.Get(learned)), Tag = "" });
                var all = new List<string>(r.Choices);
                if (v.Length > 0 && !all.Contains(v)) all.Insert(0, v);
                foreach (string c in all)
                    r.Box.Items.Add(new ComboBoxItem { Content = c + (r.Choices.Contains(c) ? "" : "   ⚠ энэ төсөлд алга"), Tag = c });
                r.Box.SelectedItem = r.Box.Items.Cast<ComboBoxItem>().FirstOrDefault(i => (string)i.Tag == v) ?? r.Box.Items.Cast<ComboBoxItem>().FirstOrDefault();
                r.Box.IsEnabled = !isBase;
            }
            _del.IsEnabled = !isBase;
            BbTagLayout learnedLayout = BbTagLayout.From(_learned?.Beam), own = isBase ? null : shown.SecTags;
            foreach (Action<BbTagLayout, BbTagLayout, bool> show in _layoutShow) show(own, learnedLayout, !isBase);
            _learnedNote.Text = "Сурсан утга (дамнуруу): " + Mm(learnedLayout.TagOutMm) + " · " + Mm(learnedLayout.TagGapMm) + " · leader " + Mm(learnedLayout.LeaderLandingMm) +
                                " / " + Mm(learnedLayout.LeaderRunMm) + " · огтлолын тэмдэг " + Mm(learnedLayout.SecMarkGapMm) + ".  Хоосон талбар = гишүүн бүрийн сурсан утга.";
            _resetLayout.IsEnabled = !isBase;
            _loading = false;
            UpdateState();
        }

        // ── Огтлолын шошгоны байрлал (үндсэн plugin-ий «Хэмжээ, тэмдэглэгээ»-ийн хэсэг) ─────────────────────────

        /// <summary>(option-ий утга эсвэл null, сурсан утга, засах боломжтой эсэх) — харуулна.</summary>
        private readonly List<Action<BbTagLayout, BbTagLayout, bool>> _layoutShow = new List<Action<BbTagLayout, BbTagLayout, bool>>();
        private readonly TextBlock _learnedNote = new TextBlock { TextWrapping = TextWrapping.Wrap, Foreground = Brushes.DimGray, Margin = new Thickness(0, 4, 0, 0) };
        private Button _resetLayout;

        private UIElement LayoutPanel()
        {
            var p = new StackPanel();
            CheckBox single = LayoutCheck(p, "Арматурын багцыг (Rebar set) нэг шошгоор тэмдэглэх", 0, l => l.SingleTagPerSet, (l, v) => l.SingleTagPerSet = v);
            CheckBox multi = LayoutCheck(p, "Багцын БҮХ харагдаж буй ширхэг рүү нэг шошгоор leader татах (multi tag)", 22, l => l.MultiLeaderPerSet, (l, v) => l.MultiLeaderPerSet = v);
            CheckBox merge = LayoutCheck(p, "Leader-үүдийг нэгтгэх (Merge leader)", 44, l => l.MergeLeaders, (l, v) => l.MergeLeaders = v);
            LayoutCheck(p, "Ижил дугаартай арматурын элементүүдийг нэг шошгоор (огтлол)", 0, l => l.GroupTags, (l, v) => l.GroupTags = v);
            // multi tag нь багцын шошготой үед л, Merge leader нь multi tag-тай үед л утгатай (хөдөлгүүр тэгж уншина).
            Action deps = () => { multi.Opacity = single.IsChecked == true ? 1 : 0.5; merge.Opacity = single.IsChecked == true && multi.IsChecked == true ? 1 : 0.5; };
            single.Checked += (s, e) => deps(); single.Unchecked += (s, e) => deps();
            multi.Checked += (s, e) => deps(); multi.Unchecked += (s, e) => deps();
            _layoutShow.Add((own, learned, editable) => deps());

            var r1 = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 8, 0, 0) };
            r1.Children.Add(Label("Дамнуруунаас шошго хүртэл:"));
            r1.Children.Add(LayoutNum(l => l.TagOutMm, (l, v) => l.TagOutMm = v));
            r1.Children.Add(Label("мм,   шошго хоорондын зай:"));
            r1.Children.Add(LayoutNum(l => l.TagGapMm, (l, v) => l.TagGapMm = v));
            r1.Children.Add(Label("мм (цаас)"));
            p.Children.Add(r1);
            p.Children.Add(new TextBlock { Text = "Leader-ийн зай (3 цэг: 1 арматур · 2 хугарал · 3 шошго)", Margin = new Thickness(0, 8, 0, 0) });
            var r2 = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 4, 0, 0) };
            r2.Children.Add(Label("Шошгоноос хугарал хүртэл (3→2):"));
            r2.Children.Add(LayoutNum(l => l.LeaderLandingMm, (l, v) => l.LeaderLandingMm = v));
            r2.Children.Add(Label("мм,   хугарлаас арматур хүртэл (2→1):"));
            r2.Children.Add(LayoutNum(l => l.LeaderRunMm, (l, v) => l.LeaderRunMm = v));
            r2.Children.Add(Label("мм (цаас; 0 = автомат)"));
            p.Children.Add(r2);
            var r3 = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 8, 0, 0) };
            r3.Children.Add(Label("Дэлгээс дээрх огтлолын тэмдэг гишүүний гадна ирмэгээс:"));
            r3.Children.Add(LayoutNum(l => l.SecMarkGapMm, (l, v) => l.SecMarkGapMm = v));
            r3.Children.Add(Label("мм (цаас; шинээр үүсгэх огтлолд)"));
            p.Children.Add(r3);
            p.Children.Add(_learnedNote);
            _resetLayout = new Button { Content = "Сурсан утга руу буцаах", HorizontalAlignment = HorizontalAlignment.Left, Padding = new Thickness(8, 2, 8, 2), Margin = new Thickness(0, 6, 0, 0) };
            _resetLayout.Click += (s, e) =>
            {
                BbOption o = _book.Find(SelectedName);
                if (o == null) return;
                o.SecTags = new BbTagLayout();
                ShowSelected();
            };
            p.Children.Add(_resetLayout);
            return p;
        }

        private static TextBlock Label(string text)
        {
            return new TextBlock { Text = text, VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(0, 0, 6, 0) };
        }

        private CheckBox LayoutCheck(Panel p, string text, double indent, Func<BbTagLayout, bool?> get, Action<BbTagLayout, bool?> set)
        {
            var cb = new CheckBox { Content = text, Margin = new Thickness(indent, 3, 0, 3) };
            p.Children.Add(cb);
            _layoutShow.Add((own, learned, editable) =>
            {
                cb.IsChecked = (own == null ? null : get(own)) ?? get(learned) ?? false;
                cb.IsEnabled = editable;
            });
            RoutedEventHandler changed = (s, e) =>
            {
                if (_loading) return;
                BbOption o = _book.Find(SelectedName);
                if (o == null) return;
                if (o.SecTags == null) o.SecTags = new BbTagLayout();
                set(o.SecTags, cb.IsChecked == true);
                UpdateState();
            };
            cb.Checked += changed;
            cb.Unchecked += changed;
            return cb;
        }

        private TextBox LayoutNum(Func<BbTagLayout, double?> get, Action<BbTagLayout, double?> set)
        {
            var tb = new TextBox { Width = 56, Margin = new Thickness(0, 0, 6, 0), TextAlignment = TextAlignment.Right };
            _layoutShow.Add((own, learned, editable) =>
            {
                double? v = (own == null ? null : get(own)) ?? get(learned);
                tb.Text = v.HasValue ? v.Value.ToString("0.#", System.Globalization.CultureInfo.InvariantCulture) : "";
                tb.IsEnabled = editable;
                tb.ClearValue(Control.BorderBrushProperty);
            });
            tb.TextChanged += (s, e) =>
            {
                if (_loading) return;
                BbOption o = _book.Find(SelectedName);
                if (o == null) return;
                string t = (tb.Text ?? "").Trim().Replace(',', '.');
                if (t.Length == 0) { if (o.SecTags != null) set(o.SecTags, null); tb.ClearValue(Control.BorderBrushProperty); return; }
                if (!double.TryParse(t, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out double d) || d < 0 || d > 100)
                {
                    tb.BorderBrush = Brushes.Firebrick;
                    return;
                }
                tb.ClearValue(Control.BorderBrushProperty);
                if (o.SecTags == null) o.SecTags = new BbTagLayout();
                set(o.SecTags, d);
            };
            return tb;
        }

        private static string Mm(double? v)
        {
            return v.HasValue ? v.Value.ToString("0.#", System.Globalization.CultureInfo.InvariantCulture) + " мм" : "—";
        }

        private static string Suffix(string learned) { return string.IsNullOrEmpty(learned) ? "" : " — " + learned; }

        private void UpdateState()
        {
            bool isBase = _book.Find(SelectedName) == null;
            int missing = _rows.Count(r => r.Box.SelectedItem is ComboBoxItem it && (it.Tag as string ?? "").Length > 0 && !r.Choices.Contains((string)it.Tag));
            _state.Text = (isBase
                    ? "«Үндсэн» — «Стандарт сурах» шинэчилнэ; энд засагдахгүй."
                    : "«" + SelectedName + "» — өөрчлөлт «Хадгалах» дарахад хадгалагдана.")
                + (missing > 0 ? "  Энэ төсөлд ачаалаагүй төрөл " + missing + " — тэр тохиолдолд Revit-ийн өгөгдмөл төрлөөр тавигдаж, «Асуудал – Шийдэл»-д бичигдэнэ." : "");
        }

        private void Create()
        {
            string name = (_newName.Text ?? "").Trim();
            string p = _book.NameProblem(name);
            _error.Text = p ?? "";
            if (p != null) return;
            BbOption copy = BbOption.FromJson(BbJson.Parse(BbJson.Write(Shown().ToJson())));
            if (_book.Find(SelectedName) == null) copy = BbOption.FromStandard(name, _learned);
            copy.Name = name;
            _book.Add(copy);
            _newName.Text = "";
            FillOptions(name);
        }

        private void Delete()
        {
            string name = SelectedName;
            if (_book.Find(name) == null) return;
            if (MessageBox.Show(_w, "«" + name + "» option-ийг устгах уу?  Үүнийг хэрэглэж байсан төслүүд «Үндсэн» рүү буцна.", "MGL ББ — Тохиргоо",
                    MessageBoxButton.YesNo, MessageBoxImage.Question) != MessageBoxResult.Yes) return;
            _book.Remove(name);
            FillOptions(BbOptionBook.BaseName);
        }

        public bool Show(IntPtr owner)
        {
            try { if (owner != IntPtr.Zero) new WindowInteropHelper(_w).Owner = owner; } catch { }
            return _w.ShowDialog() == true;
        }
    }
}
