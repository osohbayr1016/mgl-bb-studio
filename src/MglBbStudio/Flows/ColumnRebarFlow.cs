using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Interop;
using System.Windows.Media;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;
using Autodesk.Revit.UI.Selection;
using MglBb.Core;
using MglBb.RevitSide;
using WBinding = System.Windows.Data.Binding;
using WCombo = System.Windows.Controls.ComboBox;

namespace MglBb.BeamRebar
{
    /// <summary>
    /// «Баганын арматур»: сонгосон эсвэл бүх загварын төмөр бетон багана (давхар бүрийн элемент) → марк бүрийн мөр («4×4Ø20», хомут) →
    /// элемент бүр тусдаа transaction.  Дэвтэр нь дамнуруутай нэг (<see cref="BbRebarBook.Cols"/>).
    /// </summary>
    internal static class ColumnRebarFlow
    {
        internal const string Title = "MGL ББ — Баганын арматур";

        public static Result Run(UIDocument uidoc)
        {
            if (RebarJobHost.Busy) { TaskDialog.Show(Title, "Арматур үүсгэх ажил явж байна — явцын цонхонд дуусах эсвэл «Зогсоох» хүртэл хүлээнэ үү."); return Result.Cancelled; }
            Document doc = uidoc.Document;
            List<FamilyInstance> cols = uidoc.Selection.GetElementIds().Select(id => doc.GetElement(id)).OfType<FamilyInstance>()
                .Where(IsColumn).ToList();
            if (cols.Count == 0)
            {
                var td = new TaskDialog(Title) { MainInstruction = "Аль баганад арматур үүсгэх вэ?" };
                td.AddCommandLink(TaskDialogCommandLinkId.CommandLink1, "Загварын бүх төмөр бетон багана");
                td.AddCommandLink(TaskDialogCommandLinkId.CommandLink2, "Багана сонгох");
                td.CommonButtons = TaskDialogCommonButtons.Cancel;
                TaskDialogResult res = td.Show();
                if (res == TaskDialogResult.CommandLink1) cols = BbColumnRebarGen.AllColumns(doc).ToList();
                else if (res == TaskDialogResult.CommandLink2)
                {
                    try
                    {
                        cols = uidoc.Selection.PickObjects(ObjectType.Element, new ColumnFilter(), "Багана сонгоод Finish дарна уу")
                            .Select(r => doc.GetElement(r)).OfType<FamilyInstance>().ToList();
                    }
                    catch (Autodesk.Revit.Exceptions.OperationCanceledException) { return Result.Cancelled; }
                }
                else return Result.Cancelled;
            }
            List<BbColumnGenItem> items = BbColumnRebarGen.Collect(doc, cols);
            if (items.Count == 0) { TaskDialog.Show(Title, "Төмөр бетон (Concrete материалтай) багана олдсонгүй."); return Result.Cancelled; }

            string path = Path.Combine(Paths.Root, "rebar", BbRebarBook.SafeName(doc.Title) + ".json");
            BbRebarBook book;
            try { book = BbRebarBook.Load(path); }
            catch { book = new BbRebarBook(); }
            BbColumnStyle learned = BbRebarLearn.FromColumns(doc, items);
            if (!learned.Empty && (book.ColStyle == null || learned.Columns >= book.ColStyle.Columns)) book.ColStyle = learned;
            var win = new ColumnRebarWindow(book, items);
            try { new WindowInteropHelper(win).Owner = uidoc.Application.MainWindowHandle; } catch { }
            if (win.ShowDialog() != true) return Result.Cancelled;
            try { book.Save(path); } catch { }

            int made = 0, done = 0, failed = 0;
            var notes = new List<string>();
            var steps = new List<RebarJobHost.Step>();
            foreach (BbColumnGenItem item in items)
            {
                BbColumnGenItem it = item;
                BbColumnRow row = book.Col(it.Mark);
                if (!row.Enabled) continue;
                string tag = it.Mark + " (" + it.Level + ")";
                if (it.Skip != null) { notes.Add(tag + ": алгаслаа — " + it.Skip + "."); continue; }
                if (it.Foreign > 0 && !book.ReplaceForeign) { notes.Add(tag + ": гараар тавьсан арматуртай — алгаслаа."); continue; }
                steps.Add(new RebarJobHost.Step
                {
                    Text = tag,
                    Run = () =>
                    {
                        if (!it.Column.IsValidObject) { failed++; return "✗ " + tag + " — багана устсан, алгаслаа"; }
                        BbColumnPreset p = BbColumnRebarGen.PresetFor(book, it, null);
                        using (var t = new Transaction(doc, "Арматур " + it.Mark))
                        {
                            FailureHandlingOptions fh = t.GetFailureHandlingOptions();
                            fh.SetFailuresPreprocessor(new BbSwallowWarnings());
                            t.SetFailureHandlingOptions(fh);
                            t.Start();
                            BbBeamRebarGen.Outcome o;
                            try { o = BbColumnRebarGen.Generate(doc, it, p, book.ReplaceForeign); }
                            catch (Exception ex) { t.RollBack(); notes.Add(tag + ": алдаа — " + ex.Message); failed++; return "✗ " + tag + " — алдаа (буцаагдсан)"; }
                            if (t.Commit() != TransactionStatus.Committed) { notes.Add(tag + ": Revit буцаалаа."); failed++; return "✗ " + tag + " — Revit буцаалаа"; }
                            made += o.Created; done++; failed += o.Failed;
                            List<string> mine = o.Notes.Distinct().ToList();
                            foreach (string n in mine) notes.Add(tag + ": " + n);
                            return (o.Failed > 0 ? "✗ " : "✓ ") + tag + " — " + o.Created + " элемент" + (o.Failed > 0 ? ", " + o.Failed + " бүтсэнгүй" : "")
                                + (mine.Count > 0 ? ", анхааруулга " + mine.Count : "");
                        }
                    },
                });
            }
            if (steps.Count == 0)
            {
                TaskDialog.Show(Title, "Үүсгэх багана алга." + (items.Any(x => x.Skip == null && x.Foreign > 0) && !book.ReplaceForeign
                    ? "  Гараар тавьсан арматуртайг солих бол цонхны «Гараар тавьсан арматурыг устгаж солих»-ыг тэмдэглэнэ үү." : "") + (notes.Count > 0 ? Environment.NewLine + string.Join(Environment.NewLine, notes.Take(20)) : ""));
                return Result.Cancelled;
            }
            RebarJobHost.Start(uidoc, Title, steps,
                (n, total) => done + " баганад " + made + " арматурын элемент үүсгэлээ" + (failed > 0 ? " (" + failed + " бүтсэнгүй)" : "") + ".  Багана бүр өөрийн Ctrl+Z-тэй.",
                () => notes.Distinct().Take(300).ToList());
            return Result.Succeeded;
        }

        static bool IsColumn(Element e) { return e?.Category != null && e.Category.Id.Value == (long)BuiltInCategory.OST_StructuralColumns; }

        private sealed class ColumnFilter : ISelectionFilter
        {
            public bool AllowElement(Element e) { return IsColumn(e); }
            public bool AllowReference(Reference r, XYZ p) { return false; }
        }
    }

    public sealed class ColumnRebarRowVm
    {
        internal BbColumnGenItem Item;
        internal BbColumnRow Row;
        internal BbRebarBook Book;
        public bool On { get { return Row.Enabled; } set { Row.Enabled = value; } }
        public string Mark { get { return Item.Mark; } }
        public string Level { get { return Item.Level; } }
        public string Size { get { return Item.Size; } }
        public string Default
        {
            get
            {
                BbColumnPreset p = Book.ColumnPreset(null, Item.Input.B, Item.Input.H);
                return p.Nb + "×" + p.Nh + "Ø" + p.D;
            }
        }
        public string Bars { get { return Row.Bars; } set { Row.Bars = value ?? ""; } }
        public string Layout { get { return LayoutNames.Label(LayoutNames.Column, Row.TieLayout); } set { Row.TieLayout = LayoutNames.Key(LayoutNames.Column, value); } }
        public string Cover { get { return Item.Cover > 0 ? Item.Cover.ToString("0") : "—"; } }
        public string TieD { get { return Row.TieD > 0 ? Row.TieD.ToString() : ""; } set { int v; Row.TieD = int.TryParse(value, out v) ? v : 0; } }
        public string S { get { return Row.S > 0 ? Row.S.ToString("0") : ""; } set { double v; Row.S = double.TryParse(value, out v) ? v : 0; } }
        public string SDense { get { return Row.SDense > 0 ? Row.SDense.ToString("0") : ""; } set { double v; Row.SDense = double.TryParse(value, out v) ? v : 0; } }
        public string Status
        {
            get
            {
                if (Item.Skip != null) return "алгасна: " + Item.Skip;
                var s = new List<string>();
                if (Item.Input.OnFoundation) s.Add("суурь дээр");
                if (!Item.Input.ContinuesAbove) s.Add("дээд давхар");
                if (Item.Own > 0) s.Add("өмнө үүсгэсэн " + Item.Own);
                if (Item.Foreign > 0) s.Add("гараар " + Item.Foreign);
                return string.Join(", ", s);
            }
        }
    }

    internal sealed class ColumnRebarWindow : Window
    {
        private readonly BbRebarBook _book;
        private readonly List<ColumnRebarRowVm> _rows;
        private readonly DataGrid _grid;
        private readonly RadioButton _company;
        private readonly WCombo _concrete = new WCombo { Width = 80 };
        private readonly CheckBox _replace, _hostCover;

        public ColumnRebarWindow(BbRebarBook book, List<BbColumnGenItem> items)
        {
            _book = book;
            _rows = items.Select(it => new ColumnRebarRowVm { Item = it, Row = book.Col(it.Mark), Book = book }).ToList();
            Title = ColumnRebarFlow.Title;
            Width = 980;
            Height = 600;
            WindowStartupLocation = WindowStartupLocation.CenterOwner;
            ShowInTaskbar = false;
            FontFamily = new FontFamily("Segoe UI");
            FontSize = 13;

            var root = new DockPanel { Margin = new Thickness(14) };
            var opts = new WrapPanel { Margin = new Thickness(0, 0, 0, 8) };
            DockPanel.SetDock(opts, Dock.Top);
            _company = new RadioButton { Content = "Рамын холбоост систем (strong column, ЖИШЭЭ-1/3)", IsChecked = book.Company, Margin = new Thickness(0, 4, 14, 4) };
            var code = new RadioButton { Content = "Энгийн каркас (СП 52-101, ЖИШЭЭ-4)", IsChecked = !book.Company, Margin = new Thickness(0, 4, 18, 4) };
            _company.Checked += (s, e) => { _book.Company = true; _grid?.Items.Refresh(); };
            code.Checked += (s, e) => { _book.Company = false; _grid?.Items.Refresh(); Preview(); };
            opts.Children.Add(_company);
            opts.Children.Add(code);
            opts.Children.Add(new TextBlock { Text = "Бетон:", VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(0, 0, 6, 0) });
            foreach (string c in new[] { "B15", "B20", "B25", "B30", "B35", "B40", "B45", "B50" }) _concrete.Items.Add(c);
            _concrete.SelectedItem = _concrete.Items.Contains(book.Concrete) ? book.Concrete : "B25";
            opts.Children.Add(_concrete);
            _replace = new CheckBox { Content = "Гараар тавьсан арматурыг устгаж солих", IsChecked = book.ReplaceForeign, Margin = new Thickness(18, 4, 0, 4) };
            opts.Children.Add(_replace);
            _hostCover = new CheckBox { Content = "Хамгаалах үе = элементийн Rebar Cover", IsChecked = book.UseHostCover, Margin = new Thickness(18, 4, 0, 4) };
            _hostCover.Checked += (s, e) => { _book.UseHostCover = true; Preview(); };
            _hostCover.Unchecked += (s, e) => { _book.UseHostCover = false; Preview(); };
            opts.Children.Add(_hostCover);
            root.Children.Add(BbTheme.Card("Систем ба материал", opts, Dock.Top));
            if (book.ColStyle != null && !book.ColStyle.Empty)
            {
                var learn = new CheckBox
                {
                    Content = "Загварын гар арматураас сурсан хэв маяг: " + book.ColStyle.Describe(), IsChecked = book.LearnStyle, Margin = new Thickness(0, 0, 0, 6),
                    ToolTip = "«Рамын холбоост систем»-д компанийн анхдагчийн оронд энэ төслийн баганын хамгаалах үе, хомутын Ø / алхам / эхний ба сүүлийн, " +
                        "залгаасын өндөр, дотоод хосын тоог авна.  Мөрт бичсэн утга ба элементийн cover давуу.",
                };
                learn.Checked += (s, e) => { _book.LearnStyle = true; Preview(); };
                learn.Unchecked += (s, e) => { _book.LearnStyle = false; Preview(); };
                DockPanel.SetDock(learn, Dock.Top);
                root.Children.Add(learn);
            }

            var hint = new TextBlock
            {
                Text = "Хоосон нүд = анхдагч (баганаар: тал бүр ≤ 200 алхам).  «4×4Ø20» = B тал 4, H тал 4 ширхэг (булан орно).  Дээд давхар ижил огтлолтой бол " +
                    "ажлын арматур дээд нүүрээс дээш давхцалтай гарна; үгүй бол зангилаанд L хөлтэй.",
                TextWrapping = TextWrapping.Wrap, Foreground = Brushes.DimGray, Margin = new Thickness(0, 0, 0, 6),
            };
            DockPanel.SetDock(hint, Dock.Top);
            root.Children.Add(hint);

            var buttons = MglBb.DimLines.DimLineWindow.Buttons("Үүсгэх", Go, 10);
            buttons.HorizontalAlignment = HorizontalAlignment.Right;
            DockPanel.SetDock(buttons, Dock.Bottom);
            BbTheme.Buttons(buttons, "Үүсгэх");
            root.Children.Add(buttons);

            _grid = new DataGrid
            {
                AutoGenerateColumns = false, CanUserAddRows = false, CanUserDeleteRows = false, ItemsSource = _rows, HeadersVisibility = DataGridHeadersVisibility.Column,
                GridLinesVisibility = DataGridGridLinesVisibility.Horizontal, RowHeight = 24,
            };
            BbTheme.Grid(_grid);
            _grid.Columns.Add(new DataGridCheckBoxColumn { Header = "✓", Binding = new WBinding("On") { UpdateSourceTrigger = System.Windows.Data.UpdateSourceTrigger.PropertyChanged } });
            Col("Марк", "Mark", true, 80);
            Col("Түвшин", "Level", true, 130);
            Col("Огтлол", "Size", true, 80);
            Col("Анхдагч", "Default", true, 80);
            Col("Cover", "Cover", true, 55);
            Col("Ажлын арматур", "Bars", false, 110);
            _grid.Columns.Add(new DataGridComboBoxColumn
            {
                Header = "Хомутын хэлбэр", Width = new DataGridLength(220), ItemsSource = LayoutNames.Column.Select(x => x[1]).ToList(),
                SelectedItemBinding = new WBinding("Layout") { Mode = System.Windows.Data.BindingMode.TwoWay, UpdateSourceTrigger = System.Windows.Data.UpdateSourceTrigger.PropertyChanged },
            });
            Col("Хомут Ø", "TieD", false, 65);
            Col("s", "S", false, 55);
            Col("s нягт", "SDense", false, 60);
            Col("Төлөв", "Status", true, 220);
            _preview = new RebarPreview { Margin = new Thickness(0, 8, 0, 0), Height = 260 };
            DockPanel.SetDock(_preview, Dock.Bottom);
            root.Children.Add(BbTheme.Card("Урьдчилсан зураг", _preview, Dock.Bottom, 0));
            root.Children.Add(BbTheme.Card("Баганууд (давхар бүрээр)", _grid));
            Content = BbTheme.Frame(this, "Баганын арматур", "Систем сонгож, мөр бүрийн арматурыг шалгаад «Үүсгэх».", root);
            Height = Math.Min(960, SystemParameters.WorkArea.Height - 20);
            _grid.SelectionChanged += (s, e) => Preview();
            _grid.CellEditEnding += (s, e) => Dispatcher.BeginInvoke(new Action(Preview), System.Windows.Threading.DispatcherPriority.Background);
            _company.Checked += (s, e) => Preview();
            Loaded += (s, e) => { if (_rows.Count > 0) _grid.SelectedIndex = 0; Preview(); };
        }

        private readonly RebarPreview _preview;

        void Preview()
        {
            var r = _grid?.SelectedItem as ColumnRebarRowVm;
            if (_preview == null) return;
            if (r == null) { _preview.Clear("Мөр сонговол огтлол ба босоо зам энд харагдана."); return; }
            if (r.Item.Skip != null) { _preview.Clear(r.Mark + ": " + r.Item.Skip); return; }
            try { _preview.ShowColumn(r.Item.Input, BbColumnRebarGen.PresetFor(_book, r.Item, null), r.Mark + " " + r.Level); }
            catch (Exception ex) { _preview.Clear("Зураг: " + ex.Message); }
        }

        void Col(string header, string path, bool ro, double w)
        {
            _grid.Columns.Add(new DataGridTextColumn
            {
                Header = header, IsReadOnly = ro, Width = new DataGridLength(w),
                Binding = new WBinding(path) { Mode = ro ? System.Windows.Data.BindingMode.OneWay : System.Windows.Data.BindingMode.TwoWay },
            });
        }

        void Go()
        {
            _grid.CommitEdit(DataGridEditingUnit.Row, true);
            _book.Company = _company.IsChecked == true;
            _book.Concrete = _concrete.SelectedItem as string ?? "B25";
            _book.ReplaceForeign = _replace.IsChecked == true;
            _book.UseHostCover = _hostCover.IsChecked == true;
            var errors = new List<string>();
            foreach (ColumnRebarRowVm r in _rows.Where(x => x.On)) BbColumnRebarGen.PresetFor(_book, r.Item, errors);
            if (errors.Count > 0) { MessageBox.Show(this, string.Join(Environment.NewLine, errors.Distinct().Take(15)), Title); return; }
            if (!_rows.Any(x => x.On)) { MessageBox.Show(this, "Нэг ч мөр сонгоогүй байна.", Title); return; }
            DialogResult = true;
        }
    }
}
