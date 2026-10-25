using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Data;
using System.Windows.Media;
using MglBb.Core;
using MglBb.RevitSide;
using WBinding = System.Windows.Data.Binding;
using WCombo = System.Windows.Controls.ComboBox;

namespace MglBb.BeamRebar
{
    /// <summary>Хомутын хэлбэрийн сонголт (цонхонд): нэр ↔ <see cref="BbStirrupLayout"/>.</summary>
    internal static class LayoutNames
    {
        public static readonly string[][] Beam =
        {
            new[] { "", "(анхдагч)" },
            new[] { "Single", "▭ Нэг битүү (2 салаа)" },
            new[] { "Pair", "▭▭ Хоёр давхардсан (4 салаа, ЖИШЭЭ-1)" },
            new[] { "OuterInner", "▣ Гадна + дотоод битүү" },
            new[] { "OuterC", "▭| Гадна + босоо C" },
        };

        public static readonly string[][] Column =
        {
            new[] { "", "(анхдагч)" },
            new[] { "Outer", "□ Зөвхөн гадна" },
            new[] { "Pairs", "□▯ Хосын тэгш өнцөгт (ЖИШЭЭ-1)" },
            new[] { "CEvery", "□┼ Ширхэг бүрд C" },
            new[] { "CAlternate", "□+ Ээлжлэн C" },
            new[] { "OuterInner", "▣ Гадна + дотоод битүү" },
        };

        public static string Label(string[][] t, string key) { return (t.FirstOrDefault(x => x[0] == (key ?? "")) ?? t[0])[1]; }
        public static string Key(string[][] t, string label) { return (t.FirstOrDefault(x => x[1] == label) ?? t[0])[0]; }
    }

    /// <summary>Цонхны мөр (DataGrid-д холбогдоно).</summary>
    public sealed class BeamRebarRowVm
    {
        internal BbBeamGenItem Item;
        internal BbRebarRow Row;
        public bool On { get { return Row.Enabled; } set { Row.Enabled = value; } }
        public string Mark { get { return Item.Key; } }
        public string Size { get { return Item.Size; } }
        public string Spans { get { return BbBeamRebarPlan.SpanCount(Item.Input).ToString(); } }
        public string Cover
        {
            get
            {
                if (Item.CoverSide <= 0 && Item.CoverBottom <= 0 && Item.CoverTop <= 0) return "—";
                return Fmt(Item.CoverTop) + "/" + Fmt(Item.CoverBottom) + "/" + Fmt(Item.CoverSide);
            }
        }
        static string Fmt(double v) { return v > 0 ? v.ToString("0") : "—"; }
        public string Status
        {
            get
            {
                if (Item.Skip != null) return "алгасна: " + Item.Skip;
                var s = new List<string>();
                if (Item.Parts > 1) s.Add("хэсэг " + Item.Part + "/" + Item.Parts);
                if (Item.Own > 0) s.Add("өмнө үүсгэсэн " + Item.Own);
                if (Item.Foreign > 0) s.Add("гараар " + Item.Foreign);
                if (Item.Input.LoadPoints.Count > 0) s.Add("туслах " + Item.Input.LoadPoints.Count);
                int off = Row.Spans.Count(x => x.Off);
                if (off > 0) s.Add("унтраасан алгасал " + off);
                return string.Join(", ", s);
            }
        }
        public string Top { get { return Row.Top; } set { Row.Top = value ?? ""; } }
        public string Bottom { get { return Row.Bottom; } set { Row.Bottom = value ?? ""; } }
        public string SpanTop { get { return Row.SpanTop; } set { Row.SpanTop = value ?? ""; } }
        public string AddTop { get { return Row.AddTop; } set { Row.AddTop = value ?? ""; } }
        public string AddBottom { get { return Row.AddBottom; } set { Row.AddBottom = value ?? ""; } }
        public string Side { get { return Row.Side; } set { Row.Side = value ?? ""; } }
        public string Layout { get { return LayoutNames.Label(LayoutNames.Beam, Row.Layout); } set { Row.Layout = LayoutNames.Key(LayoutNames.Beam, value); } }
        public string StirrupD { get { return Row.StirrupD > 0 ? Row.StirrupD.ToString() : ""; } set { int v; Row.StirrupD = int.TryParse(value, out v) ? v : 0; } }
        public string S1 { get { return Row.S1 > 0 ? Row.S1.ToString("0") : ""; } set { Row.S1 = Num(value); } }
        public string S2 { get { return Row.S2 > 0 ? Row.S2.ToString("0") : ""; } set { Row.S2 = Num(value); } }
        public string Lira
        {
            get
            {
                if (Row.AsTop <= 0 && Row.AsBottom <= 0) return "";
                return "As " + (Row.AsTop / 100).ToString("0.0") + " / " + (Row.AsBottom / 100).ToString("0.0") + " см² → " + SuggestTop + " / " + SuggestBottom;
            }
        }
        internal string SuggestTop { get { return BbRebarBook.Suggest(Row.AsTop, InnerWidth, true, MaxN); } }
        internal string SuggestBottom { get { return BbRebarBook.Suggest(Row.AsBottom, InnerWidth, false, MaxN); } }
        int MaxN { get { return Item.Input.B < 450 ? 4 : 6; } }
        double InnerWidth { get { return Item.Input.B - 2 * ((Item.CoverSide > 0 ? Item.CoverSide : 32) + 8); } }

        internal static double Num(string s)
        {
            double v;
            return double.TryParse((s ?? "").Replace(',', '.'), System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out v) && v > 0 ? v : 0;
        }
    }

    /// <summary>Алгаслын мөр (сонгосон дамнурууны).</summary>
    public sealed class SpanRowVm
    {
        internal BbSpanRow Row;
        internal double Len;
        public string No { get { return (Row.Index + 1).ToString(); } }
        public string Length { get { return Math.Round(Len).ToString("0"); } }
        public bool On { get { return !Row.Off; } set { Row.Off = !value; } }
        public string AddTop { get { return Row.AddTop; } set { Row.AddTop = value ?? ""; } }
        public string AddTopEnd { get { return Row.AddTopEnd; } set { Row.AddTopEnd = value ?? ""; } }
        public string AddBottom { get { return Row.AddBottom; } set { Row.AddBottom = value ?? ""; } }
        public string S1 { get { return Row.S1 > 0 ? Row.S1.ToString("0") : ""; } set { Row.S1 = BeamRebarRowVm.Num(value); } }
        public string S2 { get { return Row.S2 > 0 ? Row.S2.ToString("0") : ""; } set { Row.S2 = BeamRebarRowVm.Num(value); } }
    }

    /// <summary>
    /// «Дамнурууны арматур» цонх (CADS / Naviate / Alpha BIM-ийн хялбар тал): дээр нь систем (рамын / энгийн каркас), бетон, ган, элементийн cover,
    /// гараар тавьсныг солих; марк бүрийн мөр (арматур, хомутын хэлбэр, хажуугийн арматур, алхам, LIRA санал); сонгосон мөрийн алгаслын хүснэгт
    /// (асаах / унтраах, нэмэлт, алхам); урьдчилсан фасад + огтлол.
    /// </summary>
    internal sealed class BeamRebarWindow : Window
    {
        private readonly BbRebarBook _book;
        private readonly List<BeamRebarRowVm> _rows;
        private readonly DataGrid _grid, _spans;
        private readonly RadioButton _company;
        private readonly RadioButton _code;
        private readonly WCombo _concrete = new WCombo { Width = 80 }, _steel = new WCombo { Width = 80 };
        private readonly CheckBox _replace, _hostCover;
        private readonly RebarPreview _preview;
        private readonly TextBlock _spansTitle = new TextBlock { FontWeight = FontWeights.SemiBold, Margin = new Thickness(0, 6, 0, 2) };

        public BeamRebarWindow(BbRebarBook book, List<BbBeamGenItem> items)
        {
            _book = book;
            _rows = items.Select(it => new BeamRebarRowVm { Item = it, Row = book.Row(it.Key) }).ToList();
            Title = BeamRebarFlow.Title;
            Width = 1320;
            Height = Math.Min(1000, SystemParameters.WorkArea.Height - 20);   // толгой мөр + картуудад дамнурууны хүснэгт багтах
            WindowStartupLocation = WindowStartupLocation.CenterOwner;
            ShowInTaskbar = false;
            FontFamily = new FontFamily("Segoe UI");
            FontSize = 13;

            var root = new DockPanel { Margin = new Thickness(14) };
            var opts = new WrapPanel { Margin = new Thickness(0, 0, 0, 8) };
            DockPanel.SetDock(opts, Dock.Top);
            _company = new RadioButton
            {
                Content = "Рамын холбоост систем (strong column, ЖИШЭЭ-1/3)", IsChecked = book.Company, Margin = new Thickness(0, 4, 14, 4), VerticalAlignment = VerticalAlignment.Center,
                ToolTip = "ЖИШЭЭ-1-ийн 80 дамнуруунаас сурсан: тулгуурын дээд ⅓l + 550, голд Ø12, 4 салаа хомут @100/@200, L төгсгөл, туслах дамнуруунд 3@50 + муруй.",
            };
            _code = new RadioButton
            {
                Content = "Энгийн каркас (СП 52-101, ЖИШЭЭ-4)", IsChecked = !book.Company, Margin = new Thickness(0, 4, 18, 4), VerticalAlignment = VerticalAlignment.Center,
                ToolTip = "Нормын ердийн зарчим: тасралтгүй дээд / доод, тулгуурын ¼ нягт бүс, алхам 0.5h0 / 0.75h0.",
            };
            opts.Children.Add(_company);
            opts.Children.Add(_code);
            opts.Children.Add(Label("Бетон:"));
            foreach (string c in new[] { "B15", "B20", "B25", "B30", "B35", "B40", "B45", "B50" }) _concrete.Items.Add(c);
            _concrete.SelectedItem = _concrete.Items.Contains(book.Concrete) ? book.Concrete : "B25";
            opts.Children.Add(_concrete);
            opts.Children.Add(Label("  Ажлын арматур:"));
            foreach (string s in new[] { "A400", "A500" }) _steel.Items.Add(s);
            _steel.SelectedItem = book.Steel == BbSteel.A400 ? "A400" : "A500";
            opts.Children.Add(_steel);
            _hostCover = new CheckBox
            {
                Content = "Хамгаалах үе = элементийн Rebar Cover", IsChecked = book.UseHostCover, Margin = new Thickness(18, 4, 0, 4), VerticalAlignment = VerticalAlignment.Center,
                ToolTip = "Дамнурууны «Rebar Cover - Top / Bottom / Other» параметрээс.  Тодорхойгүй бол системийн анхдагч.  Нормоос бага бол нормын хэмжээ болгоно.",
            };
            _hostCover.Checked += (s, e) => { _book.UseHostCover = true; Preview(); };
            _hostCover.Unchecked += (s, e) => { _book.UseHostCover = false; Preview(); };
            opts.Children.Add(_hostCover);
            _replace = new CheckBox
            {
                Content = "Гараар тавьсан арматурыг устгаж солих", IsChecked = book.ReplaceForeign, Margin = new Thickness(18, 4, 0, 4), VerticalAlignment = VerticalAlignment.Center,
                ToolTip = "Тэмдэглээгүй бол гараар арматурласан дамнурууг алгасна.  Plugin-ий өмнө үүсгэсэн арматур үргэлж шинээр солигдоно.",
            };
            opts.Children.Add(_replace);
            root.Children.Add(BbTheme.Card("Систем ба материал", opts, Dock.Top));

            if (book.Style != null && !book.Style.Empty)
            {
                var learn = new CheckBox
                {
                    Content = "Загварын гар арматураас сурсан хэв маяг: " + book.Style.Describe(), IsChecked = book.LearnStyle, Margin = new Thickness(0, 0, 0, 6),
                    ToolTip = "«Рамын холбоост систем»-д компанийн анхдагчийн оронд энэ төслийн гараар тавьсан арматурын хомут / C-хомут / хажуугийн Ø, bar type, " +
                        "хамгаалах үе (дээд нь чиглэлээр), муруй арматурын тоо, @150 шилжилтийг авна.  Мөрт бичсэн утга ба элементийн cover давуу.",
                };
                learn.Checked += (s, e) => { _book.LearnStyle = true; Preview(); };
                learn.Unchecked += (s, e) => { _book.LearnStyle = false; Preview(); };
                DockPanel.SetDock(learn, Dock.Top);
                root.Children.Add(learn);
            }

            var hint = new TextBlock
            {
                Text = "Хоосон нүд = анхдагч.  Бичих: «6Ø25», «0» = байхгүй; хажуугийн «2Ø12» = тал бүрд 2 эгнээ.  Мөр сонговол доор алгаслын хүснэгт ба зураг — " +
                    "алгаслыг унтраавал зөвхөн асаалттайг үүсгэнэ.  Норм (хамгаалах үе, давхцал, алхам) зөрчигдвөл автоматаар засаж анхааруулна.",
                TextWrapping = TextWrapping.Wrap, Foreground = Brushes.DimGray, Margin = new Thickness(0, 0, 0, 6),
            };
            DockPanel.SetDock(hint, Dock.Top);
            root.Children.Add(hint);

            var buttons = new DockPanel { Margin = new Thickness(0, 10, 0, 0) };
            DockPanel.SetDock(buttons, Dock.Bottom);
            var lira = new Button { Content = "LIRA CSV ачаалах…", Padding = new Thickness(10, 4, 10, 4), Margin = new Thickness(0, 0, 8, 0) };
            lira.Click += (s, e) => LoadLira();
            var apply = new Button { Content = "Саналыг хоосон нүдэнд бичих", Padding = new Thickness(10, 4, 10, 4), Margin = new Thickness(0, 0, 8, 0) };
            apply.Click += (s, e) => ApplySuggestions();
            var copy = new Button
            {
                Content = "Энэ мөрийг ижил огтлолтой бүгдэд хуулах", Padding = new Thickness(10, 4, 10, 4),
                ToolTip = "Сонгосон мөрийн арматур, хомутын хэлбэр, алхмыг ижил b×h-тэй бусад мөрөнд (Naviate-ийн «settings» шиг).",
            };
            copy.Click += (s, e) => CopyToSameSize();
            foreach (Button b in new[] { lira, apply, copy }) { DockPanel.SetDock(b, Dock.Left); buttons.Children.Add(b); }
            var right = MglBb.DimLines.DimLineWindow.Buttons("Үүсгэх", Go, 0);
            right.HorizontalAlignment = HorizontalAlignment.Right;
            buttons.Children.Add(right);
            BbTheme.Buttons(buttons, "Үүсгэх");
            root.Children.Add(buttons);

            _preview = new RebarPreview { Margin = new Thickness(0, 8, 0, 0) };
            DockPanel.SetDock(_preview, Dock.Bottom);
            root.Children.Add(BbTheme.Card("Урьдчилсан зураг (фасад + огтлол)", _preview, Dock.Bottom, 0));

            var spanPanel = new DockPanel();
            DockPanel.SetDock(spanPanel, Dock.Bottom);
            DockPanel.SetDock(_spansTitle, Dock.Top);
            spanPanel.Children.Add(_spansTitle);
            _spans = Grid(120);
            _spans.Columns.Add(new DataGridCheckBoxColumn { Header = "Үүсгэх", Binding = new WBinding("On") { UpdateSourceTrigger = UpdateSourceTrigger.PropertyChanged } });
            Col(_spans, "№", "No", true, 40);
            Col(_spans, "Цэвэр урт", "Length", true, 80);
            Col(_spans, "Эхлэлийн тулгуурын нэмэлт дээд", "AddTop", false, 200);
            Col(_spans, "Төгсгөлийн тулгуурын нэмэлт дээд", "AddTopEnd", false, 210);
            Col(_spans, "Нэмэлт доод", "AddBottom", false, 110);
            Col(_spans, "s1", "S1", false, 60);
            Col(_spans, "s2", "S2", false, 60);
            spanPanel.Children.Add(_spans);
            root.Children.Add(BbTheme.Card(null, spanPanel, Dock.Bottom));

            _grid = Grid(0);
            _grid.ItemsSource = _rows;
            _grid.Columns.Add(new DataGridCheckBoxColumn { Header = "✓", Binding = new WBinding("On") { UpdateSourceTrigger = UpdateSourceTrigger.PropertyChanged } });
            Col(_grid, "Марк", "Mark", true, 120);
            Col(_grid, "Огтлол", "Size", true, 75);
            Col(_grid, "Алгасал", "Spans", true, 60);
            Col(_grid, "Cover д/д/х", "Cover", true, 85);
            Col(_grid, "Тулгуурын дээд", "Top", false, 105);
            Col(_grid, "Доод", "Bottom", false, 70);
            Col(_grid, "Голын дээд", "SpanTop", false, 80);
            Col(_grid, "Нэмэлт дээд", "AddTop", false, 85);
            Col(_grid, "Нэмэлт доод", "AddBottom", false, 85);
            _grid.Columns.Add(new DataGridComboBoxColumn
            {
                Header = "Хомутын хэлбэр", Width = new DataGridLength(230), ItemsSource = LayoutNames.Beam.Select(x => x[1]).ToList(),
                SelectedItemBinding = new WBinding("Layout") { Mode = BindingMode.TwoWay, UpdateSourceTrigger = UpdateSourceTrigger.PropertyChanged },
            });
            Col(_grid, "Хомут Ø", "StirrupD", false, 60);
            Col(_grid, "s1", "S1", false, 45);
            Col(_grid, "s2", "S2", false, 45);
            Col(_grid, "Хажуугийн", "Side", false, 75);
            Col(_grid, "LIRA санал", "Lira", true, 180);
            Col(_grid, "Төлөв", "Status", true, 200);
            root.Children.Add(BbTheme.Card("Дамнуруунууд (марк / огтлол бүрээр)", _grid));
            Content = BbTheme.Frame(this, "Дамнурууны арматур", "Систем сонгож, мөр бүрийн арматурыг шалгаад «Үүсгэх» — алгаслыг доор асааж / унтраана.", root);

            _grid.SelectionChanged += (s, e) => { FillSpans(); Preview(); };
            _grid.CellEditEnding += (s, e) => Later(Preview);
            _spans.CellEditEnding += (s, e) => Later(Preview);
            _spans.CurrentCellChanged += (s, e) => Later(Preview);
            _company.Checked += (s, e) => { _book.Company = true; Preview(); };
            _code.Checked += (s, e) => { _book.Company = false; Preview(); };
            Loaded += (s, e) => { if (_rows.Count > 0) _grid.SelectedIndex = 0; FillSpans(); Preview(); };
        }

        void Later(Action a) { Dispatcher.BeginInvoke(a, System.Windows.Threading.DispatcherPriority.Background); }

        static DataGrid Grid(double height)
        {
            var g = new DataGrid
            {
                AutoGenerateColumns = false, CanUserAddRows = false, CanUserDeleteRows = false, HeadersVisibility = DataGridHeadersVisibility.Column,
                GridLinesVisibility = DataGridGridLinesVisibility.Horizontal, RowHeight = 24, SelectionMode = DataGridSelectionMode.Single,
            };
            if (height > 0) g.Height = height;
            BbTheme.Grid(g);
            return g;
        }

        static void Col(DataGrid g, string header, string path, bool ro, double w)
        {
            g.Columns.Add(new DataGridTextColumn
            {
                Header = header, IsReadOnly = ro, Width = new DataGridLength(w),
                Binding = new WBinding(path) { Mode = ro ? BindingMode.OneWay : BindingMode.TwoWay, UpdateSourceTrigger = UpdateSourceTrigger.LostFocus },
            });
        }

        static TextBlock Label(string t) { return new TextBlock { Text = t, VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(0, 0, 6, 0) }; }

        void FillSpans()
        {
            var r = _grid.SelectedItem as BeamRebarRowVm;
            if (r == null) { _spans.ItemsSource = null; _spansTitle.Text = "Алгасал"; return; }
            List<BbSupport> spans = BbBeamRebarPlan.InteriorSpans(r.Item.Input);
            int n = spans.Count;
            var list = new List<SpanRowVm>();
            for (int i = 0; i < n; i++)
                list.Add(new SpanRowVm { Row = r.Row.Span(i), Len = i < spans.Count ? spans[i].Hi - spans[i].Lo : 0 });
            _spans.ItemsSource = list;
            _spansTitle.Text = "Алгасал — " + r.Mark + " (" + n + ")";
        }

        void Preview()
        {
            var r = _grid.SelectedItem as BeamRebarRowVm;
            if (r == null) { _preview.Clear("Мөр сонговол фасад ба огтлол энд харагдана."); return; }
            if (r.Item.Skip != null) { _preview.Clear(r.Mark + ": " + r.Item.Skip); return; }
            try
            {
                int n = BbBeamRebarPlan.SpanCount(r.Item.Input);
                _preview.ShowBeam(r.Item.Input, BbBeamRebarGen.PresetFor(_book, r.Item, null, 0, n), r.Mark,
                    Enumerable.Range(0, n).Select(i => !(r.Row.Spans.FirstOrDefault(s => s.Index == i)?.Off ?? false)).ToArray());
            }
            catch (Exception ex) { _preview.Clear("Зураг: " + ex.Message); }
        }

        void CopyToSameSize()
        {
            _grid.CommitEdit(DataGridEditingUnit.Row, true);
            var src = _grid.SelectedItem as BeamRebarRowVm;
            if (src == null) { MessageBox.Show(this, "Эхлээд мөр сонгоно уу.", Title); return; }
            int n = 0;
            foreach (BeamRebarRowVm r in _rows.Where(x => x != src && x.Size == src.Size))
            {
                r.Row.Top = src.Row.Top; r.Row.Bottom = src.Row.Bottom; r.Row.SpanTop = src.Row.SpanTop; r.Row.AddTop = src.Row.AddTop; r.Row.AddBottom = src.Row.AddBottom;
                r.Row.Layout = src.Row.Layout; r.Row.Side = src.Row.Side; r.Row.StirrupD = src.Row.StirrupD; r.Row.S1 = src.Row.S1; r.Row.S2 = src.Row.S2;
                n++;
            }
            _grid.Items.Refresh();
            MessageBox.Show(this, src.Size + " огтлолтой " + n + " мөрөнд хууллаа (алгаслын засварыг хуулахгүй).", Title);
        }

        void LoadLira()
        {
            var dlg = new Microsoft.Win32.OpenFileDialog { Filter = "CSV / текст (*.csv;*.txt)|*.csv;*.txt|Бүх файл|*.*", Title = "LIRA-ийн шаардлагатай арматур (марк; As дээд; As доод, см²)" };
            if (dlg.ShowDialog(this) != true) return;
            var errors = new List<string>();
            Dictionary<string, double[]> m;
            try { m = BbRebarBook.ParseLiraCsv(File.ReadAllText(dlg.FileName, Encoding.UTF8), errors); }
            catch (Exception ex) { MessageBox.Show(this, "Уншиж чадсангүй: " + ex.Message, Title); return; }
            int hit = 0;
            foreach (BeamRebarRowVm r in _rows)
            {
                double[] v;
                if (!m.TryGetValue(r.Mark, out v) && !m.TryGetValue(r.Item.Mark, out v)) continue;
                r.Row.AsTop = v[0];
                r.Row.AsBottom = v[1];
                hit++;
            }
            _grid.Items.Refresh();
            MessageBox.Show(this, m.Count + " марк уншлаа, " + hit + " нь энэ жагсаалтад таарлаа." + (errors.Count > 0 ? Environment.NewLine + string.Join(Environment.NewLine, errors.Take(10)) : ""), Title);
        }

        void ApplySuggestions()
        {
            int n = 0;
            foreach (BeamRebarRowVm r in _rows)
            {
                if (string.IsNullOrWhiteSpace(r.Top) && r.SuggestTop != "") { r.Top = r.SuggestTop; n++; }
                if (string.IsNullOrWhiteSpace(r.Bottom) && r.SuggestBottom != "") { r.Bottom = r.SuggestBottom; n++; }
            }
            _grid.Items.Refresh();
            MessageBox.Show(this, n + " нүдэнд LIRA-ийн санал бичлээ.", Title);
        }

        void Go()
        {
            _grid.CommitEdit(DataGridEditingUnit.Row, true);
            _spans.CommitEdit(DataGridEditingUnit.Row, true);
            _book.Company = _company.IsChecked == true;
            _book.Concrete = _concrete.SelectedItem as string ?? "B25";
            _book.Steel = (_steel.SelectedItem as string) == "A400" ? BbSteel.A400 : BbSteel.A500;
            _book.ReplaceForeign = _replace.IsChecked == true;
            _book.UseHostCover = _hostCover.IsChecked == true;
            var errors = new List<string>();
            foreach (BeamRebarRowVm r in _rows.Where(x => x.On))
                BbBeamRebarGen.PresetFor(_book, r.Item, errors, 0, BbBeamRebarPlan.SpanCount(r.Item.Input));
            if (errors.Count > 0)
            {
                MessageBox.Show(this, string.Join(Environment.NewLine, errors.Distinct().Take(15)), Title);
                return;
            }
            if (!_rows.Any(x => x.On)) { MessageBox.Show(this, "Нэг ч мөр сонгоогүй байна.", Title); return; }
            DialogResult = true;
        }
    }
}
