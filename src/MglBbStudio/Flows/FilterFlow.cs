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
using MglBb.Core;
using WCombo = System.Windows.Controls.ComboBox;
using WGrid = System.Windows.Controls.Grid;
using WBrushes = System.Windows.Media.Brushes;

namespace MglBb.Filter
{
    /// <summary>
    /// «Параметрээр шүүх» (ModPlus-ийн Filter selection маягийн) — НЭЭЛТТЭЙ (modeless) цонх: хэрэглэгч шүүлтүүрийг нэрлэж (ангилал, ≤ 3 нөхцөл, харагдацын
    /// төрөл) хадгалаад, нэг товшилтоор ИДЭВХТЭЙ харагдацад ажиллуулж элементээ сонгоно / түр тусгаарлана.  Шүүлтүүрүүд бүх төсөлд хуваалцана
    /// (%APPDATA%\MGL\BbStudio\filters.json).  Revit API-ийн бүх үйлдэл ExternalEvent-ээр.  Загварт юу ч бичихгүй (тусгаарлах нь түр горим).
    /// </summary>
    internal static class FilterFlow
    {
        internal const string Title = "MGL ББ — Параметрээр шүүх";
        internal const string TypeSuffix = " (төрөл)";
        internal static string BookPath { get { return Path.Combine(Paths.Root, "filters.json"); } }

        internal static readonly KeyValuePair<string, string>[] Kinds =
        {
            new KeyValuePair<string, string>(BbFilterBook.Plan, "Төлөвлөгөө"),
            new KeyValuePair<string, string>(BbFilterBook.Section, "Огтлол / дэлгээс"),
            new KeyValuePair<string, string>(BbFilterBook.ThreeD, "3D"),
        };

        private static FilterWindow _open;

        /// <summary>Командаас (API context): цонхыг нээх эсвэл урд нь гаргах.</summary>
        public static Result Run(UIDocument uidoc)
        {
            if (_open != null) { _open.Front(); _open.Reload(); return Result.Succeeded; }
            BbFilterBook book;
            try { book = BbFilterBook.Load(BookPath); }
            catch { try { File.Copy(BookPath, BookPath + ".broken", true); } catch { } book = new BbFilterBook(); }
            var host = new FilterHost();
            var ev = ExternalEvent.Create(host);
            _open = new FilterWindow(host, ev, book, uidoc.Application.MainWindowHandle);
            host.Window = _open;
            _open.Closed += (s, e) => { try { ev.Dispose(); } catch { } _open = null; };
            _open.Show();
            _open.Reload();
            return Result.Succeeded;
        }

        /// <summary>Харагдацын төрөл: төлөвлөгөө / огтлол-дэлгээс-detail / 3D; загварын бус (хуудас, түүвэр, drafting, legend) бол null.</summary>
        internal static string KindOf(View v)
        {
            if (v == null || v.IsTemplate) return null;
            switch (v.ViewType)
            {
                case ViewType.FloorPlan: case ViewType.CeilingPlan: case ViewType.EngineeringPlan: case ViewType.AreaPlan: return BbFilterBook.Plan;
                case ViewType.Section: case ViewType.Elevation: case ViewType.Detail: return BbFilterBook.Section;
                case ViewType.ThreeD: return BbFilterBook.ThreeD;
                default: return null;
            }
        }

        internal static string KindName(string kind) { return Kinds.FirstOrDefault(k => k.Key == kind).Value ?? "загварын бус"; }

        /// <summary>Харагдацад харагдах загварын элементүүд ангиллаар (BuiltInCategory-ийн нэр → элементүүд).</summary>
        private static Dictionary<string, List<Element>> ByCategory(Document doc, View view)
        {
            var res = new Dictionary<string, List<Element>>(StringComparer.Ordinal);
            foreach (Element e in new FilteredElementCollector(doc, view.Id).WhereElementIsNotElementType())
            {
                Category c = e.Category;
                if (c == null || c.CategoryType != CategoryType.Model || c.Parent != null) continue;
                string key;
                try { key = ((BuiltInCategory)c.Id.Value).ToString(); } catch { continue; }
                if (!res.TryGetValue(key, out var l)) res[key] = l = new List<Element>();
                l.Add(e);
            }
            return res;
        }

        /// <summary>Идэвхтэй харагдацын ангиллууд (тоотой) + <paramref name="cats"/> ангиллын элементийн параметрийн утга (API context-д).</summary>
        internal static Snapshot Read(UIDocument uidoc, ICollection<string> cats)
        {
            var snap = new Snapshot();
            View view = uidoc?.ActiveView;
            snap.Kind = KindOf(view);
            if (snap.Kind == null) { snap.Problem = "Загварын харагдац (төлөвлөгөө, огтлол, дэлгээс, 3D) нээнэ үү."; return snap; }
            Document doc = uidoc.Document;
            snap.ViewId = view.Id;
            snap.ViewName = view.Name;
            snap.DocTitle = doc.Title;
            foreach (var kv in ByCategory(doc, view))
            {
                snap.Cats.Add(new CatInfo { Key = kv.Key, Name = kv.Value[0].Category.Name, Count = kv.Value.Count });
                if (cats != null && cats.Contains(kv.Key))
                    foreach (Element e in kv.Value) snap.Items.Add(new Item { Id = e.Id, Cat = kv.Key, Values = Values(doc, e) });
            }
            snap.Cats.Sort((a, b) => string.Compare(a.Name, b.Name, StringComparison.CurrentCulture));
            return snap;
        }

        /// <summary>Шүүлтүүрийг ИДЭВХТЭЙ харагдацад (API context-д): таарсан элементүүд.  <paramref name="why"/> = ажиллаагүй шалтгаан.</summary>
        internal static List<ElementId> Match(UIDocument uidoc, BbSavedFilter f, out View view, out string why)
        {
            view = uidoc?.ActiveView;
            why = null;
            string kind = KindOf(view);
            if (kind == null) { why = "Загварын харагдац нээнэ үү."; return new List<ElementId>(); }
            if (!f.AppliesTo(kind)) { why = "«" + f.Name + "» шүүлтүүр " + string.Join(", ", f.ViewKinds.Select(KindName)) + " харагдацад зориулагдсан — идэвхтэй нь " + KindName(kind) + "."; return new List<ElementId>(); }
            Document doc = uidoc.Document;
            var res = new List<ElementId>();
            Dictionary<string, List<Element>> by = ByCategory(doc, view);
            foreach (string c in f.Categories)
                if (by.TryGetValue(c, out var list))
                    foreach (Element e in list)
                        if (BbParamFilter.MatchAll(Values(doc, e), f.Rules)) res.Add(e.Id);
            if (res.Count == 0) why = "«" + f.Name + "»-д таарах элемент энэ харагдацад алга.";
            return res;
        }

        internal sealed class CatInfo
        {
            public string Key, Name;
            public int Count;
        }

        internal sealed class Item
        {
            public ElementId Id;
            public string Cat;
            public Dictionary<string, string> Values;
        }

        internal sealed class Snapshot
        {
            public ElementId ViewId;
            public string ViewName = "", DocTitle = "", Kind, Problem;
            public readonly List<CatInfo> Cats = new List<CatInfo>();
            public readonly List<Item> Items = new List<Item>();
        }

        /// <summary>Элементийн instance + type параметрийн харагдах утга (type-ийнх «(төрөл)» дагавартай).</summary>
        private static Dictionary<string, string> Values(Document doc, Element e)
        {
            var d = new Dictionary<string, string>(StringComparer.Ordinal);
            Read(doc, e, "", d);
            Element type = null;
            try { type = doc.GetElement(e.GetTypeId()); } catch { }
            if (type != null) Read(doc, type, TypeSuffix, d);
            return d;
        }

        private static void Read(Document doc, Element e, string suffix, Dictionary<string, string> d)
        {
            foreach (Parameter p in e.Parameters)
            {
                string name = p.Definition?.Name;
                if (string.IsNullOrEmpty(name)) continue;
                string key = name + suffix;
                if (!d.ContainsKey(key)) d[key] = Text(doc, p);
            }
        }

        private static string Text(Document doc, Parameter p)
        {
            try
            {
                if (!p.HasValue) return "";
                switch (p.StorageType)
                {
                    case StorageType.String: return p.AsString() ?? "";
                    case StorageType.ElementId:
                        ElementId id = p.AsElementId();
                        if (id == null || id == ElementId.InvalidElementId) return "";
                        return doc.GetElement(id)?.Name ?? p.AsValueString() ?? id.Value.ToString();
                    default: return p.AsValueString() ?? "";
                }
            }
            catch { return ""; }
        }
    }

    /// <summary>ExternalEvent: цонхны хүсэлтийг Revit-ийн API context-д гүйцэтгэнэ.</summary>
    internal sealed class FilterHost : IExternalEventHandler
    {
        public enum Op { Load, Select, Isolate, Reset }

        public FilterWindow Window;
        private Op _op;
        private BbSavedFilter _filter;
        private HashSet<string> _cats = new HashSet<string>();

        public void Ask(Op op, BbSavedFilter filter, IEnumerable<string> cats)
        {
            _op = op;
            _filter = filter;
            _cats = new HashSet<string>(cats ?? Enumerable.Empty<string>(), StringComparer.Ordinal);
        }

        public void Execute(UIApplication app)
        {
            UIDocument uidoc = app.ActiveUIDocument;
            string msg = null;
            try
            {
                if (uidoc == null) { msg = "Revit-д төсөл нээгээгүй байна."; return; }
                Document doc = uidoc.Document;
                switch (_op)
                {
                    case Op.Load:
                        FilterFlow.Snapshot snap = FilterFlow.Read(uidoc, _cats);
                        Window?.Dispatcher.Invoke(() => Window.Load(snap));
                        return;
                    case Op.Select:
                    case Op.Isolate:
                        List<ElementId> ids = FilterFlow.Match(uidoc, _filter, out View v, out string why);
                        if (ids.Count == 0) { msg = why; return; }
                        if (_op == Op.Isolate)
                            using (var t = new Transaction(doc, "MGL ББ: «" + _filter.Name + "» тусгаарлах"))
                            {
                                t.Start();
                                v.IsolateElementsTemporary(ids);
                                t.Commit();
                            }
                        uidoc.Selection.SetElementIds(ids);
                        msg = "«" + _filter.Name + "»: " + ids.Count + " элемент " + (_op == Op.Isolate ? "тусгаарлаж сонголоо" : "сонголоо") + " («" + v.Name + "»).";
                        return;
                    case Op.Reset:
                        View av = uidoc.ActiveView;
                        using (var t = new Transaction(doc, "MGL ББ: тусгаарлалт цуцлах"))
                        {
                            t.Start();
                            av.DisableTemporaryViewMode(TemporaryViewMode.TemporaryHideIsolate);
                            t.Commit();
                        }
                        msg = "Тусгаарлалтыг цуцаллаа («" + av.Name + "»).";
                        return;
                }
            }
            catch (Exception ex) { msg = "Алдаа: " + ex.Message; }
            finally
            {
                if (msg != null) Window?.Dispatcher.Invoke(() => Window.Status(msg));
            }
        }

        public string GetName() { return "MGL ББ параметрээр шүүх"; }
    }

    /// <summary>Шүүлтүүрийн цонх (modeless, кодоор угсарсан WPF).  Revit API дуудахгүй — бүгдийг <see cref="FilterHost"/>-оор.</summary>
    internal sealed class FilterWindow : Window
    {
        private sealed class Row
        {
            public WCombo Param, Op, Value;
        }

        private readonly FilterHost _host;
        private readonly ExternalEvent _ev;
        private readonly BbFilterBook _book;
        private readonly TextBlock _viewText = new TextBlock { FontWeight = FontWeights.SemiBold, TextWrapping = TextWrapping.Wrap, VerticalAlignment = VerticalAlignment.Center };
        private readonly TextBlock _count = new TextBlock { FontWeight = FontWeights.SemiBold, Margin = new Thickness(0, 8, 0, 0) };
        private readonly TextBlock _status = new TextBlock { Foreground = WBrushes.DimGray, TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 6, 0, 0) };
        private readonly ListBox _list = new ListBox { Height = 330 };
        private readonly System.Windows.Controls.TextBox _name = new System.Windows.Controls.TextBox { Margin = new Thickness(0, 2, 0, 4) };
        private readonly List<CheckBox> _kinds = new List<CheckBox>();
        private readonly ListBox _cats = new ListBox { Height = 120, SelectionMode = SelectionMode.Extended, Margin = new Thickness(0, 2, 0, 4) };
        private readonly List<Row> _rows = new List<Row>();
        private FilterFlow.Snapshot _snap = new FilterFlow.Snapshot();
        private List<string> _catKeys = new List<string>();
        private BbSavedFilter _editing;
        private bool _loading;

        public FilterWindow(FilterHost host, ExternalEvent ev, BbFilterBook book, IntPtr owner)
        {
            _host = host;
            _ev = ev;
            _book = book;
            Title = FilterFlow.Title;
            Width = 960;
            SizeToContent = SizeToContent.Height;
            ResizeMode = ResizeMode.CanMinimize;
            WindowStartupLocation = WindowStartupLocation.CenterOwner;
            ShowInTaskbar = false;
            FontFamily = new FontFamily("Segoe UI");
            FontSize = 13;
            try { if (owner != IntPtr.Zero) new WindowInteropHelper(this).Owner = owner; } catch { }

            var root = new StackPanel { Margin = new Thickness(16) };
            var top = new DockPanel { Margin = new Thickness(0, 0, 0, 8) };
            var reload = Btn("Шинэчлэх (идэвхтэй харагдац)", Reload);
            DockPanel.SetDock(reload, Dock.Right);
            top.Children.Add(reload);
            top.Children.Add(_viewText);
            root.Children.Add(top);

            var grid = new WGrid();
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(280) });
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(16) });
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

            // ── Зүүн: хадгалсан шүүлтүүрүүд (давхар товшилт = шууд сонгох).
            var left = new StackPanel();
            left.Children.Add(Heading("Хадгалсан шүүлтүүр"));
            left.Children.Add(_list);
            var lb = new WrapPanel { Margin = new Thickness(0, 4, 0, 0) };
            lb.Children.Add(Btn("Шинэ", NewFilter, 0));
            lb.Children.Add(Btn("Хуулах", CopyFilter));
            lb.Children.Add(Btn("Устгах", DeleteFilter));
            left.Children.Add(lb);
            var run = Btn("▶ Сонгох (нэг товшилт)", () => RunSaved(FilterHost.Op.Select), 0);
            run.Margin = new Thickness(0, 6, 0, 0);
            run.FontWeight = FontWeights.SemiBold;
            left.Children.Add(run);
            left.Children.Add(Note("Давхар товшвол шууд сонгоно.  ⚠ = идэвхтэй харагдацын төрөлд зориулагдаагүй."));
            WGrid.SetColumn(left, 0);
            grid.Children.Add(left);

            // ── Баруун: засварлагч.
            var right = new StackPanel();
            right.Children.Add(Heading("Нэр"));
            right.Children.Add(_name);
            right.Children.Add(Heading("Ашиглах харагдац (сонгоогүй = бүх)"));
            var kp = new StackPanel { Orientation = Orientation.Horizontal };
            foreach (var k in FilterFlow.Kinds)
            {
                var cb = new CheckBox { Content = k.Value, Tag = k.Key, Margin = new Thickness(0, 2, 16, 2) };
                cb.Checked += (s, e) => MarkList(); cb.Unchecked += (s, e) => MarkList();
                _kinds.Add(cb);
                kp.Children.Add(cb);
            }
            right.Children.Add(kp);
            right.Children.Add(Heading("Ангилал (идэвхтэй харагдацад байгаа — тоотой)"));
            right.Children.Add(_cats);
            right.Children.Add(Heading("Нөхцөл (параметр · үйлдэл · утга) — бүгд хангагдах"));
            for (int i = 0; i < 3; i++) right.Children.Add(RuleRow());
            right.Children.Add(_count);
            var rb = new WrapPanel { Margin = new Thickness(0, 8, 0, 0) };
            rb.Children.Add(Btn("Хадгалах", SaveFilter, 0));
            rb.Children.Add(Btn("Сонгох", () => RunEditor(FilterHost.Op.Select)));
            rb.Children.Add(Btn("Тусгаарлах (түр)", () => RunEditor(FilterHost.Op.Isolate)));
            rb.Children.Add(Btn("Тусгаарлалт цуцлах", () => { _host.Ask(FilterHost.Op.Reset, null, null); _ev.Raise(); }));
            right.Children.Add(rb);
            WGrid.SetColumn(right, 2);
            grid.Children.Add(right);
            root.Children.Add(grid);

            root.Children.Add(Note("Ажиллагаа: (1) ангилал, нөхцөл, харагдацын төрлөө сонгоод нэр өгч «Хадгалах» — бүх төсөлд хадгалагдана.  (2) Жагсаалтаас шүүлтүүрээ давхар " +
                                   "товшиж эсвэл «▶ Сонгох» дарж идэвхтэй харагдацын элементүүдийг нэг товшилтоор сонгоно.  (3) Харагдацын төрөл заасан шүүлтүүр зөвхөн тэр " +
                                   "төрлийн харагдацад ажиллана (ж: «Огтлол / дэлгээс» — төлөвлөгөөнд ажиллахгүй).  Өөрчлөхдөө жагсаалтаас сонгоод засаж «Хадгалах»."));
            var bottom = new DockPanel { Margin = new Thickness(0, 8, 0, 0) };
            var close = Btn("Хаах", Close);
            DockPanel.SetDock(close, Dock.Right);
            bottom.Children.Add(close);
            bottom.Children.Add(_status);
            root.Children.Add(bottom);
            Content = root;

            _list.SelectionChanged += (s, e) => { if (!_loading) Edit(_list.SelectedItem is ListBoxItem it ? it.Tag as BbSavedFilter : null); };
            _list.MouseDoubleClick += (s, e) => RunSaved(FilterHost.Op.Select);
            _cats.SelectionChanged += (s, e) => { if (!_loading) LoadCats(); };
            FillList(null);
        }

        // ── UI туслах ─────────────────────────────────────────────────────

        private static TextBlock Heading(string t) { return new TextBlock { Text = t, FontWeight = FontWeights.SemiBold, Margin = new Thickness(0, 8, 0, 2) }; }

        private static TextBlock Note(string t) { return new TextBlock { Text = t, Foreground = WBrushes.DimGray, TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 6, 0, 0) }; }

        private Button Btn(string text, Action a, double leftMargin = 8)
        {
            var b = new Button { Content = text, MinWidth = 80, Padding = new Thickness(10, 4, 10, 4), Margin = new Thickness(leftMargin, 0, 0, 0) };
            b.Click += (s, e) => a();
            return b;
        }

        private UIElement RuleRow()
        {
            var g = new WGrid { Margin = new Thickness(0, 3, 0, 3) };
            g.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(3, GridUnitType.Star) });
            g.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(110) });
            g.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(3, GridUnitType.Star) });
            var r = new Row
            {
                Param = new WCombo { IsEditable = true, Margin = new Thickness(0, 0, 6, 0) },
                Op = new WCombo { Margin = new Thickness(0, 0, 6, 0) },
                Value = new WCombo { IsEditable = true },
            };
            foreach (string op in BbParamFilter.Ops) r.Op.Items.Add(op);
            r.Op.SelectedIndex = 0;
            WGrid.SetColumn(r.Param, 0); WGrid.SetColumn(r.Op, 1); WGrid.SetColumn(r.Value, 2);
            g.Children.Add(r.Param); g.Children.Add(r.Op); g.Children.Add(r.Value);
            _rows.Add(r);
            r.Param.SelectionChanged += (s, e) => { if (!_loading) { FillValues(r); Recount(); } };
            r.Param.AddHandler(System.Windows.Controls.Primitives.TextBoxBase.TextChangedEvent, new TextChangedEventHandler((s, e) => Recount()));
            r.Op.SelectionChanged += (s, e) => { r.Value.IsEnabled = !BbParamFilter.Unary(r.Op.SelectedItem as string); Recount(); };
            r.Value.AddHandler(System.Windows.Controls.Primitives.TextBoxBase.TextChangedEvent, new TextChangedEventHandler((s, e) => Recount()));
            r.Value.SelectionChanged += (s, e) => Recount();
            return g;
        }

        public void Front()
        {
            if (WindowState == WindowState.Minimized) WindowState = WindowState.Normal;
            Activate();
        }

        public void Status(string s) { _status.Text = s ?? ""; }

        // ── Revit-тэй харилцах ───────────────────────────────────────────

        public void Reload() { Status("Уншиж байна…"); LoadCats(); }

        /// <summary>Сонгосон ангиллын утгыг (шууд тоолох, параметрийн жагсаалтад) дахин уншина.</summary>
        private void LoadCats()
        {
            _host.Ask(FilterHost.Op.Load, null, SelectedCats());
            _ev.Raise();
        }

        /// <summary>ExternalEvent-ээс: идэвхтэй харагдацын өгөгдөл.</summary>
        public void Load(FilterFlow.Snapshot snap)
        {
            _snap = snap ?? new FilterFlow.Snapshot();
            if (_snap.Problem != null) { _viewText.Text = "—"; Status(_snap.Problem); }
            else { _viewText.Text = "Харагдац: «" + _snap.ViewName + "» · " + FilterFlow.KindName(_snap.Kind) + "  (" + _snap.DocTitle + ")"; Status(""); }
            FillCats(SelectedCats());
            RefillParams();
            MarkList();
        }

        private void RunEditor(FilterHost.Op op)
        {
            BbSavedFilter f = Def();
            if (f.Categories.Count == 0) { Status("Ангилал сонгоно уу."); return; }
            if (string.IsNullOrWhiteSpace(f.Name)) f.Name = "(хадгалаагүй)";
            _host.Ask(op, f, null);
            _ev.Raise();
        }

        private void RunSaved(FilterHost.Op op)
        {
            if (!(_list.SelectedItem is ListBoxItem it) || !(it.Tag is BbSavedFilter f)) { Status("Жагсаалтаас шүүлтүүр сонгоно уу."); return; }
            _host.Ask(op, f, null);
            _ev.Raise();
        }

        // ── Хадгалсан шүүлтүүр ───────────────────────────────────────────

        private void FillList(BbSavedFilter select)
        {
            _loading = true;
            _list.Items.Clear();
            foreach (BbSavedFilter f in _book.Filters.OrderBy(x => x.Name, StringComparer.CurrentCulture))
                _list.Items.Add(new ListBoxItem { Content = f.Name, Tag = f });
            _list.SelectedItem = _list.Items.Cast<ListBoxItem>().FirstOrDefault(i => ReferenceEquals(i.Tag, select));
            _loading = false;
            MarkList();
            Edit(select);
        }

        /// <summary>Идэвхтэй харагдацын төрөлд зориулагдаагүй шүүлтүүрийг ⚠-ээр.</summary>
        private void MarkList()
        {
            foreach (ListBoxItem it in _list.Items)
            {
                var f = (BbSavedFilter)it.Tag;
                bool ok = _snap.Kind == null || f.AppliesTo(_snap.Kind);
                it.Content = (ok ? "" : "⚠ ") + f.Name + (f.ViewKinds.Count > 0 ? "   [" + string.Join(", ", f.ViewKinds.Select(FilterFlow.KindName)) + "]" : "");
                it.Foreground = ok ? WBrushes.Black : WBrushes.Gray;
            }
        }

        private void Edit(BbSavedFilter f)
        {
            _editing = f;
            _loading = true;
            _name.Text = f?.Name ?? "";
            foreach (CheckBox cb in _kinds) cb.IsChecked = f != null && f.ViewKinds.Contains((string)cb.Tag);
            FillCats(f?.Categories ?? SelectedCats());
            for (int i = 0; i < _rows.Count; i++)
            {
                BbParamRule r = f != null && i < f.Rules.Count ? f.Rules[i] : null;
                _rows[i].Param.Text = r?.Param ?? "";
                _rows[i].Op.SelectedItem = r?.Op ?? BbParamFilter.Eq;
                _rows[i].Value.Text = r?.Value ?? "";
            }
            _loading = false;
            LoadCats();
        }

        /// <summary>Засварлагчийн одоогийн тодорхойлолт.</summary>
        private BbSavedFilter Def()
        {
            return new BbSavedFilter
            {
                Name = (_name.Text ?? "").Trim(),
                Categories = SelectedCats(),
                ViewKinds = _kinds.Where(c => c.IsChecked == true).Select(c => (string)c.Tag).ToList(),
                Rules = _rows.Select(r => new BbParamRule { Param = (r.Param.Text ?? "").Trim(), Op = r.Op.SelectedItem as string ?? BbParamFilter.Eq, Value = r.Value.Text ?? "" })
                    .Where(r => r.Param.Length > 0).ToList(),
            };
        }

        private void SaveFilter()
        {
            BbSavedFilter d = Def();
            string p = _book.NameProblem(d.Name, _editing);
            if (p != null) { Status(p); return; }
            if (d.Categories.Count == 0) { Status("Ангилал сонгоно уу."); return; }
            if (_editing != null) _book.Filters.Remove(_editing);
            _book.Filters.Add(d);
            try { _book.Save(FilterFlow.BookPath); Status("«" + d.Name + "» хадгалагдлаа."); }
            catch (Exception ex) { Status("Хадгалж чадсангүй: " + ex.Message); }
            FillList(d);
        }

        private void NewFilter()
        {
            var f = new BbSavedFilter { Name = _book.FreeName("Шүүлтүүр"), Categories = SelectedCats() };
            _list.SelectedItem = null;
            Edit(null);
            _name.Text = f.Name;
            Status("Шинэ шүүлтүүр — тохируулаад «Хадгалах».");
        }

        private void CopyFilter()
        {
            BbSavedFilter d = Def();
            _list.SelectedItem = null;
            _editing = null;
            _name.Text = _book.FreeName(string.IsNullOrWhiteSpace(d.Name) ? "Шүүлтүүр" : d.Name + " хуулбар");
            Status("Хуулбар — нэрээ өгөөд «Хадгалах».");
        }

        private void DeleteFilter()
        {
            if (_editing == null) { Status("Устгах шүүлтүүрээ жагсаалтаас сонгоно уу."); return; }
            if (MessageBox.Show(this, "«" + _editing.Name + "» шүүлтүүрийг устгах уу?", FilterFlow.Title, MessageBoxButton.YesNo, MessageBoxImage.Question) != MessageBoxResult.Yes) return;
            _book.Filters.Remove(_editing);
            try { _book.Save(FilterFlow.BookPath); Status("Устгалаа."); } catch (Exception ex) { Status("Хадгалж чадсангүй: " + ex.Message); }
            FillList(null);
        }

        // ── Ангилал, нөхцөл ───────────────────────────────────────────────

        private List<string> SelectedCats()
        {
            return _cats.SelectedItems.Cast<object>().Select(o => _catKeys[_cats.Items.IndexOf(o)]).ToList();
        }

        /// <summary>Идэвхтэй харагдацын ангиллууд + хадгалсан боловч энэ харагдацад алга ангилал; <paramref name="select"/>-ийг сонгоно.</summary>
        private void FillCats(ICollection<string> select)
        {
            _loading = true;
            var want = new HashSet<string>(select ?? new List<string>(), StringComparer.Ordinal);
            _cats.Items.Clear();
            _catKeys = new List<string>();
            foreach (FilterFlow.CatInfo c in _snap.Cats) { _catKeys.Add(c.Key); _cats.Items.Add(c.Name + "   (" + c.Count + ")"); }
            foreach (string k in want.Where(k => !_catKeys.Contains(k))) { _catKeys.Add(k); _cats.Items.Add(k.Replace("OST_", "") + "   (харагдацад алга)"); }
            for (int i = 0; i < _catKeys.Count; i++) if (want.Contains(_catKeys[i])) _cats.SelectedItems.Add(_cats.Items[i]);
            _loading = false;
        }

        private List<FilterFlow.Item> Pool()
        {
            var sel = new HashSet<string>(SelectedCats(), StringComparer.Ordinal);
            return _snap.Items.Where(x => sel.Contains(x.Cat)).ToList();
        }

        private void RefillParams()
        {
            _loading = true;
            List<string> names = Pool().SelectMany(x => x.Values.Keys).Distinct().OrderBy(s => s.EndsWith(FilterFlow.TypeSuffix, StringComparison.Ordinal))
                .ThenBy(s => s, StringComparer.CurrentCulture).ToList();
            foreach (Row r in _rows)
            {
                string keep = r.Param.Text;
                r.Param.Items.Clear();
                foreach (string s in names) r.Param.Items.Add(s);
                r.Param.Text = keep;
                FillValues(r);
            }
            _loading = false;
            Recount();
        }

        /// <summary>Тухайн параметрийн бодит утгууд (≤ 300) — жагсаалтаас сонгоход.</summary>
        private void FillValues(Row row)
        {
            string pn = (row.Param.Text ?? "").Trim();
            string text = row.Value.Text;
            row.Value.Items.Clear();
            if (pn.Length > 0)
                foreach (string v in Pool().Select(x => x.Values.TryGetValue(pn, out string vv) ? vv : null).Where(v => !string.IsNullOrEmpty(v))
                             .Distinct().OrderBy(v => BbParamFilter.Number(v) ?? double.MaxValue).ThenBy(v => v, StringComparer.CurrentCulture).Take(300))
                    row.Value.Items.Add(v);
            row.Value.Text = text;
        }

        private void Recount()
        {
            if (_loading) return;
            List<BbParamRule> rs = Def().Rules;
            List<FilterFlow.Item> pool = Pool();
            _count.Text = "Таарсан: " + pool.Count(x => BbParamFilter.MatchAll(x.Values, rs)) + " / " + pool.Count + "  (идэвхтэй харагдацад)";
        }
    }
}
