using System;
using System.Collections.Generic;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Media;
using RevitMcpAddin.CloneDrawings.Core;

namespace RevitMcpAddin.CloneDrawings
{
    /// <summary>Цонхонд санах харагдацын сонголт (хэрэглэгчийн өмнөх шийдвэр) — <see cref="CloneDrawingsPrefs"/>-ээс.</summary>
    internal sealed class CdViewChoice
    {
        /// <summary>Өгөгдмөлөөр сонгогдоогүй ч хэрэглэгч сонгосон харагдац (UniqueId).</summary>
        public HashSet<string> On = new HashSet<string>(StringComparer.Ordinal);
        /// <summary>Өгөгдмөлөөр сонгогдсон ч хэрэглэгч хассан харагдац (UniqueId).</summary>
        public HashSet<string> Off = new HashSet<string>(StringComparer.Ordinal);
        /// <summary>Шүүлтэд унтраасан төрөл («3D», «План» …) — загварын төрлөөр.</summary>
        public HashSet<string> TypesOff = new HashSet<string>(StringComparer.Ordinal);
    }

    /// <summary>
    /// «Зураг хувилах»-ын тохиргооны цонх (кодоор угсарсан WPF — XAML-гүй).
    ///
    ///   1. Загварын зураг — загвар элементэд ХОЛБОГДСОН харагдацууд ГУРВАН БҮЛЭГТ (2026-10-01):
    ///      «өөрийн зураг» (өгөгдмөлөөр сонгогдоно), «ерөнхий харагдац», «бусад элементийн зураг».  Дээр нь ШҮҮЛТ —
    ///      хайлт + төрөл (план, зүсэлт, фасад, callout, 3D).  ⚠️ Шүүлтэд таарахгүй харагдац КЛОНЛОГДОХГҮЙ
    ///      («харагдаж буй нь л явна») — «дам нуруу хийж байхад зөвхөн дам нурууны зураг».
    ///   2. Юуг хувилах — tag, хэмжээс, түвшний тэмдэг, 2D, хуудас, арматур; аль элементийн tag (сонгосон
    ///      харагдацуудаас тоолно).
    ///   3. Зорилтот элементүүд — ДЭЛГЭРЭНГҮЙ БҮЛГЭЭР (төрөл · хэмжээ · эргэлт · давхар).
    ///   Доор нь урьдчилсан тооцоо: хэдэн харагдац, хуудас үүснэ.
    /// </summary>
    internal sealed class CloneDrawingsDialog : Window
    {
        private readonly CdTemplateInfo _info;
        private readonly Func<bool, List<CdTargetInfo>> _addMore;
        private readonly Func<List<CdLinkedView>> _deepScan;
        private readonly CdViewChoice _choice;
        private readonly string _queueNote;

        private readonly List<ViewRow> _rows = new List<ViewRow>();      // info.Views (холбогдсон) — анхны дараалал
        private readonly List<ViewRow> _candRows = new List<ViewRow>();  // «Бусад харагдац хайх»-аар олдсон
        private readonly Dictionary<ViewRelevance, ViewGroup> _groups = new Dictionary<ViewRelevance, ViewGroup>();
        private ViewGroup _foundGroup;
        private readonly TextBox _search = new TextBox { MinWidth = 160, VerticalContentAlignment = VerticalAlignment.Center };
        private readonly Dictionary<string, ToggleButton> _typeToggles = new Dictionary<string, ToggleButton>(StringComparer.Ordinal);
        private readonly TextBlock _viewsSummary = Mute(new TextBlock { TextWrapping = TextWrapping.Wrap });

        private readonly StackPanel _kindsSection = new StackPanel();
        private readonly WrapPanel _kindsPanel = new WrapPanel();
        private readonly Dictionary<string, bool> _kindOn = new Dictionary<string, bool>(StringComparer.Ordinal);
        private readonly HashSet<string> _kindsAllOnByDefault;
        private List<CdAnnKind> _kindsShown = new List<CdAnnKind>();
        private readonly List<KeyValuePair<CheckBox, CdAnnKind>> _kindChecks = new List<KeyValuePair<CheckBox, CdAnnKind>>();

        private readonly List<CdTargetInfo> _targets;
        private readonly Dictionary<ElementIdKey, CheckBox> _targetChecks = new Dictionary<ElementIdKey, CheckBox>();
        private readonly TreeView _tree = new TreeView();
        private readonly TextBlock _preview = new TextBlock { TextWrapping = TextWrapping.Wrap };
        private readonly TextBlock _targetsHeader = new TextBlock { FontWeight = FontWeights.SemiBold };
        private readonly CheckBox _tags, _dims, _spots, _details, _sheets, _rebar, _replace, _recreate;
        private readonly Button _ok;
        private bool _updating;

        private sealed class ViewRow
        {
            public CdLinkedView View;
            public CheckBox Check;
            public ComboBox Mode;
            public FrameworkElement Root;
            public ViewGroup Group;
            public bool DefaultOn;
        }

        private sealed class ViewGroup
        {
            public Expander Expander;
            public CheckBox Check;
            public TextBlock Count;
            public StackPanel Body;
            public TextBlock Empty;
            public readonly List<ViewRow> Rows = new List<ViewRow>();
        }

        /// <summary>ElementId-ийг dictionary түлхүүр болгох (net48-д ElementId-ийн хэш хангалттай ч тодорхой байлгая).</summary>
        private struct ElementIdKey : IEquatable<ElementIdKey>
        {
            public readonly long Value;
            public ElementIdKey(long v) { Value = v; }
            public bool Equals(ElementIdKey o) => Value == o.Value;
            public override bool Equals(object obj) => obj is ElementIdKey k && Equals(k);
            public override int GetHashCode() => Value.GetHashCode();
        }

        public CloneDrawingsDialog(CdTemplateInfo info, List<CdTargetInfo> targets, CdOptions prefs,
            Func<bool, List<CdTargetInfo>> addMore, Func<List<CdLinkedView>> deepScan = null,
            CdViewChoice choice = null, string queueNote = null)
        {
            _info = info;
            _targets = targets;
            _addMore = addMore;
            _deepScan = deepScan;
            _choice = choice ?? new CdViewChoice();
            _queueNote = queueNote;
            prefs = prefs ?? new CdOptions();
            _kindsAllOnByDefault = prefs.AnnotationKinds;

            // Хэмжээ/байрлал (дэлгэцийн ажлын талбарт багтана, хил хадгалагдана) + дундын сэдэв (Light/Dark/өндөр контраст).
            Ui.MglWindow.Setup(this, "MGL — Зураг хувилах: " + info.Kind, 1040, 760, 860, 580, prefsKey: "clone-drawings");
            Ui.MglTheme.Apply(this);

            var root = new DockPanel { Margin = new Thickness(14) };

            // ── Толгой
            var head = new StackPanel { Margin = new Thickness(0, 0, 0, 8) };
            head.Children.Add(new TextBlock
            {
                Text = info.Kind + " хувилах — «" + info.Label + "»-ийн зургийг бусад " + info.Kind.ToLowerInvariant() + " рүү",
                FontSize = 16,
                FontWeight = FontWeights.SemiBold,
            });
            head.Children.Add(Mute(new TextBlock
            {
                Text = "Загвар: " + info.Summary + "   ·   зураг хайсан " + (info.AnalyzeMs / 1000.0).ToString("0.00") + " с",
                TextWrapping = TextWrapping.Wrap,
                Margin = new Thickness(0, 2, 0, 0),
            }));
            DockPanel.SetDock(head, Dock.Top);
            root.Children.Add(head);

            // ── Доод хэсэг: урьдчилсан тооцоо + товч
            var bottom = new DockPanel { Margin = new Thickness(0, 10, 0, 0) };
            var buttons = new StackPanel
            {
                Orientation = Orientation.Horizontal,
                HorizontalAlignment = HorizontalAlignment.Right,
                VerticalAlignment = VerticalAlignment.Bottom,
            };
            _ok = new Button { Content = "Хувилах", IsDefault = true, MinWidth = 110, Padding = new Thickness(12, 5, 12, 5) };
            Ui.MglUi.Primary(_ok);
            _ok.Click += (s, e) => DialogResult = true;
            var cancel = new Button { Content = "Болих", IsCancel = true, MinWidth = 80, Margin = new Thickness(8, 0, 0, 0), Padding = new Thickness(12, 5, 12, 5) };
            buttons.Children.Add(_ok);
            buttons.Children.Add(cancel);
            DockPanel.SetDock(buttons, Dock.Right);
            bottom.Children.Add(buttons);
            // Урьдчилсан тооцоо: дундын «MglNote» загвар (токен) — өмнө нь тогтмол translucent цэнхэр.
            var previewBox = new Border { Margin = new Thickness(0, 0, 12, 0), Child = _preview };
            previewBox.SetResourceReference(FrameworkElement.StyleProperty, "MglNote");
            bottom.Children.Add(previewBox);
            DockPanel.SetDock(bottom, Dock.Bottom);
            root.Children.Add(bottom);

            // ── Гол хэсэг: зүүн (зураг + сонголт), баруун (зорилт)
            var grid = new Grid();
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1.2, GridUnitType.Star) });
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(12) });
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

            var left = new Grid();
            left.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
            left.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });

            // 1. Холбогдсон харагдац — бүлгээр, шүүлттэй.
            var viewsDock = new DockPanel();
            FrameworkElement filterBar = BuildFilterBar();
            DockPanel.SetDock(filterBar, Dock.Top);
            viewsDock.Children.Add(filterBar);
            _viewsSummary.Margin = new Thickness(0, 2, 0, 4);
            DockPanel.SetDock(_viewsSummary, Dock.Top);
            viewsDock.Children.Add(_viewsSummary);

            var viewsPanel = new StackPanel();
            foreach (ViewRelevance r in new[] { ViewRelevance.Own, ViewRelevance.General, ViewRelevance.Other })
            {
                ViewGroup g = NewGroup(ViewRelevanceRule.GroupTitle(r, info.Label), GroupTooltip(r));
                _groups[r] = g;
                viewsPanel.Children.Add(g.Expander);
            }
            foreach (CdLinkedView lv in info.Views)
            {
                ViewRelevance rel = lv.Relevance;
                bool defOn = ViewRelevanceRule.DefaultSelected(rel);
                bool on = defOn;
                if (!string.IsNullOrEmpty(lv.UniqueId))
                {
                    if (defOn && _choice.Off.Contains(lv.UniqueId))
                        on = false;
                    else if (!defOn && _choice.On.Contains(lv.UniqueId))
                        on = true;
                }
                AddRow(lv, _groups[rel], _rows, on, defOn);
            }
            if (info.Views.Count == 0)
            {
                _groups[ViewRelevance.Own].Empty.Text = "«" + info.Label + "»-ийн tag, хэмжээстэй эсвэл нэрэндээ «" + info.Label
                    + "» агуулсан харагдац олдсонгүй — доорх «Бусад харагдац хайх»-ыг дарна уу.";
            }
            else if (_groups[ViewRelevance.Own].Rows.Count == 0)
            {
                _groups[ViewRelevance.Own].Empty.Text = "«" + info.Label + "»-д ТУСГАЙЛАН зориулсан зураг олдсонгүй — доорх бүлгүүдээс "
                    + "сонгоно уу (ерөнхий харагдацад tag/хэмжээсийг байранд нь нэмнэ), эсвэл «Бусад харагдац хайх».";
            }

            _foundGroup = NewGroup("Хайж олсон харагдац — загварыг харуулдаг ч холбогдоогүй",
                "«Бусад харагдац хайх»-аар олдсон, загварыг ТУСГАЙЛАН харуулдаг (tag/хэмжээсгүй) харагдацууд.  Сонговол загвартай ХОЛБОГДОЖ файлд хадгалагдана.");
            foreach (CdLinkedView lv in info.Candidates)
                AddRow(lv, _foundGroup, _candRows, false, false);
            if (_deepScan != null)
            {
                var scanStatus = Mute(new TextBlock { TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 4, 0, 0) });
                Button scan = null;
                scan = SmallButton("Бусад харагдац хайх (удаан байж болно)", () =>
                {
                    var sw = System.Diagnostics.Stopwatch.StartNew();
                    List<CdLinkedView> found;
                    try
                    {
                        Cursor = System.Windows.Input.Cursors.Wait;
                        found = _deepScan() ?? new List<CdLinkedView>();
                    }
                    finally
                    {
                        Cursor = null;
                    }
                    foreach (CdLinkedView lv in found)
                        AddRow(lv, _foundGroup, _candRows, false, false);
                    scan.IsEnabled = false;
                    scanStatus.Text = found.Count == 0
                        ? "Өөр харагдац олдсонгүй (" + (sw.ElapsedMilliseconds / 1000.0).ToString("0.0") + " с)."
                        : found.Count + " харагдац олдлоо (" + (sw.ElapsedMilliseconds / 1000.0).ToString("0.0")
                          + " с) — сонговол загвартай ХОЛБОГДОЖ файлд хадгалагдана, дараагийн удаа шууд гарна.";
                    _foundGroup.Expander.IsExpanded = true;
                    RebuildTypeToggles();
                    ApplyFilter();
                });
                scan.HorizontalAlignment = HorizontalAlignment.Left;
                scan.Margin = new Thickness(0, 10, 0, 0);
                scan.ToolTip = "Загварыг ТУСГАЙЛАН харуулдаг ч tag/хэмжээсгүй, нэрэнд нь тэмдэг ороогүй зүсэлт, callout-ыг бүх харагдацаас хайна.";
                viewsPanel.Children.Add(scan);
                viewsPanel.Children.Add(scanStatus);
            }
            viewsPanel.Children.Add(_foundGroup.Expander);

            // Бүлэг нээлттэй эсэх: өөрийн зураг үргэлж; бусад нь сонгосон мөртэй бол.
            foreach (KeyValuePair<ViewRelevance, ViewGroup> kv in _groups)
                kv.Value.Expander.IsExpanded = kv.Key == ViewRelevance.Own || kv.Value.Rows.Any(x => x.Check.IsChecked == true);
            if (_groups[ViewRelevance.Own].Rows.Count == 0)
                _groups[ViewRelevance.General].Expander.IsExpanded = true; // өөрийн зураггүй бол сонголтыг шууд харуулна
            _foundGroup.Expander.IsExpanded = _foundGroup.Rows.Count > 0;

            var viewsScroll = new ScrollViewer
            {
                Content = viewsPanel,
                VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
                HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
            };
            viewsDock.Children.Add(viewsScroll);
            var viewsGroup = Group("1. Загварын зураг — аль харагдацыг хувилах", viewsDock);
            Grid.SetRow(viewsGroup, 0);
            left.Children.Add(viewsGroup);

            // 2. Юуг хувилах
            var opts = new Grid();
            opts.ColumnDefinitions.Add(new ColumnDefinition());
            opts.ColumnDefinitions.Add(new ColumnDefinition());
            var c1 = new StackPanel();
            var c2 = new StackPanel();
            _tags = Check(c1, "Tag", prefs.Tags);
            _dims = Check(c1, "Хэмжээс (зорилтын нүүр рүү)", prefs.Dimensions);
            _spots = Check(c1, "Түвшний тэмдэг (spot)", prefs.Spots);
            _details = Check(c1, "2D — текст, зураас, штрих, detail", prefs.Details);
            _sheets = Check(c2, "Хуудас (ижил байрлалтай)", prefs.Sheets);
            _rebar = Check(c2, "Арматур тулгах" + (info.RebarCount > 0 ? " (" + info.RebarCount + ")" : " (загварт алга)"), prefs.Rebar);
            _rebar.IsEnabled = info.RebarCount > 0;
            _replace = Check(c2, "«" + (string.IsNullOrEmpty(info.Mark) ? "Mark" : info.Mark) + "»-ийг нэр, текстэд зорилтын тэмдэгээр солих", prefs.ReplaceMark);
            _recreate = Check(c2, "Өмнөх клоныг устгаж шинээр үүсгэх  (⚠ сэргээгдэхгүй)", false);
            _recreate.ToolTip = "Анхдагчаар өмнө хувилсан харагдац/хуудсыг ДАХИН АШИГЛАЖ дутуу tag, хэмжээсийг л нэмнэ (давхардахгүй).  "
                + "Үүнийг сонговол тэдгээрийг устгаад шинээр үүсгэнэ — гараар хийсэн засвар алга болно.";
            Grid.SetColumn(c2, 1);
            opts.Children.Add(c1);
            opts.Children.Add(c2);
            var optsBody = new StackPanel();
            optsBody.Children.Add(opts);
            _kindsSection.Children.Add(new TextBlock
            {
                Text = "Аль элементийн tag, хэмжээсийг хувилах (сонгосон зургуудаас):",
                FontWeight = FontWeights.SemiBold,
                Margin = new Thickness(0, 10, 0, 2),
            });
            _kindsSection.Children.Add(_kindsPanel);
            _kindsSection.Children.Add(Hint("Зөвхөн «" + info.Kind + "»-ийг сонговол хурдан бөгөөд зөвхөн түүнтэй холбоотой tag, хэмжээс хуулагдана."));
            optsBody.Children.Add(_kindsSection);
            var optsGroup = Group("2. Юуг хувилах", optsBody);
            Grid.SetRow(optsGroup, 1);
            left.Children.Add(optsGroup);
            grid.Children.Add(left);

            // 3. Зорилтот элементүүд
            var right = new DockPanel();
            var tbar = new WrapPanel { Margin = new Thickness(0, 6, 0, 0) };
            tbar.Children.Add(SmallButton("+ Ижил төрлийн бүгд", () => AddMore(true)));
            tbar.Children.Add(SmallButton("+ Ижил ангиллын бүгд", () => AddMore(false)));
            tbar.Children.Add(SmallButton("Бүгдийг сонгох", () => SetAllTargets(true)));
            tbar.Children.Add(SmallButton("Цэвэрлэх", () => SetAllTargets(false)));
            DockPanel.SetDock(tbar, Dock.Bottom);
            right.Children.Add(tbar);
            DockPanel.SetDock(_targetsHeader, Dock.Top);
            right.Children.Add(_targetsHeader);
            _tree.Margin = new Thickness(0, 4, 0, 0);
            _tree.BorderThickness = new Thickness(0);
            right.Children.Add(_tree);
            var rightGroup = Group("3. Зорилтот элементүүд — бүлгээр", right);
            Grid.SetColumn(rightGroup, 2);
            grid.Children.Add(rightGroup);

            root.Children.Add(grid);
            Content = root;

            foreach (CheckBox cb in new[] { _tags, _dims, _spots, _details, _sheets, _rebar, _replace, _recreate })
            {
                cb.Checked += (s, e) => UpdatePreview();
                cb.Unchecked += (s, e) => UpdatePreview();
            }
            RebuildTypeToggles();
            ApplyFilter();
            RebuildTree();
        }

        private static string GroupTooltip(ViewRelevance r)
        {
            switch (r)
            {
                case ViewRelevance.Own:
                    return "Загвар элементэд ЗОРИУЛСАН зураг — зүсэлт, callout, нэрэндээ тэмдэгтэй, гараар холбосон.  "
                           + "Зорилт бүрд эдгээрийн хуулбар үүснэ.";
                case ViewRelevance.General:
                    return "Олон элементийг харуулдаг том харагдац (план, 3D, ерөнхий зүсэлт).  Сонговол зорилт тэнд "
                           + "харагдаж байвал tag, хэмжээсийг ТЭНД нь нэмнэ (шинэ харагдац үүсгэхгүй).";
                default:
                    return "Өөр элементийн зураг (баганы зүсэлт, өмнө нь өөр элементэд хувилсан харагдац) — загвар "
                           + "зөвхөн хөрш болж харагддаг.  Ихэвчлэн хувилах ёсгүй.";
            }
        }

        // ── Шүүлт ──────────────────────────────────────────────────────────

        private WrapPanel _typesPanel;

        private FrameworkElement BuildFilterBar()
        {
            var bar = new DockPanel { Margin = new Thickness(0, 0, 0, 2), LastChildFill = true };
            var searchRow = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 0, 10, 4) };
            searchRow.Children.Add(new TextBlock { Text = "Хайх:", VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(0, 0, 6, 0) });
            _search.ToolTip = "Харагдац, хуудасны нэр, дугаараар шүүнэ (үг бүр таарах ёстой; кирилл/латин ялгахгүй).";
            _search.TextChanged += (s, e) => ApplyFilter();
            searchRow.Children.Add(_search);
            var clear = new Button { Content = "×", Width = 22, Margin = new Thickness(2, 0, 0, 0), ToolTip = "Хайлтыг цэвэрлэх" };
            clear.Click += (s, e) => _search.Text = "";
            searchRow.Children.Add(clear);
            DockPanel.SetDock(searchRow, Dock.Left);
            bar.Children.Add(searchRow);
            _typesPanel = new WrapPanel { VerticalAlignment = VerticalAlignment.Center };
            bar.Children.Add(_typesPanel);
            return bar;
        }

        /// <summary>Жагсаалтад байгаа төрлүүдийн товч (байхгүй төрөл харагдахгүй).</summary>
        private void RebuildTypeToggles()
        {
            var present = new HashSet<string>(_rows.Concat(_candRows).Select(r => r.View.TypeGroup ?? ViewTypeGroups.Other), StringComparer.Ordinal);
            foreach (string t in ViewTypeGroups.Order)
            {
                if (!present.Contains(t) || _typeToggles.ContainsKey(t))
                    continue;
                var tb = new ToggleButton
                {
                    Content = t,
                    IsChecked = !_choice.TypesOff.Contains(t),
                    Padding = new Thickness(8, 2, 8, 2),
                    Margin = new Thickness(0, 0, 4, 4),
                    ToolTip = "«" + t + "» төрлийн харагдацыг харуулах/нуух.  Нуусан харагдац КЛОНЛОГДОХГҮЙ.",
                };
                tb.Checked += (s, e) => ApplyFilter();
                tb.Unchecked += (s, e) => ApplyFilter();
                _typeToggles[t] = tb;
            }
            _typesPanel.Children.Clear();
            _typesPanel.Children.Add(new TextBlock { Text = "Төрөл:", VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(0, 0, 6, 4) });
            foreach (string t in ViewTypeGroups.Order)
            {
                if (_typeToggles.TryGetValue(t, out ToggleButton tb))
                    _typesPanel.Children.Add(tb);
            }
        }

        private bool RowVisible(ViewRow r)
        {
            string type = r.View.TypeGroup ?? ViewTypeGroups.Other;
            if (_typeToggles.TryGetValue(type, out ToggleButton tb) && tb.IsChecked != true)
                return false;
            return ViewSearch.Matches(_search.Text, r.View.Name, r.View.TypeLabel, r.View.SheetNumber, r.View.SheetName, r.View.RelevanceNote);
        }

        private void ApplyFilter()
        {
            foreach (ViewRow r in _rows.Concat(_candRows))
                r.Root.Visibility = RowVisible(r) ? Visibility.Visible : Visibility.Collapsed;
            foreach (ViewGroup g in _groups.Values.Concat(new[] { _foundGroup }))
                SyncGroup(g);
            _foundGroup.Expander.Visibility = _foundGroup.Rows.Count == 0 ? Visibility.Collapsed : Visibility.Visible;
            RebuildKinds();
            UpdatePreview();
        }

        // ── Бүлэг, мөр ─────────────────────────────────────────────────────

        private ViewGroup NewGroup(string title, string tooltip)
        {
            var g = new ViewGroup();
            g.Check = new CheckBox { IsThreeState = true, VerticalAlignment = VerticalAlignment.Center, ToolTip = "Харагдаж буй мөрүүдийг бүгдийг сонгох / цэвэрлэх" };
            g.Check.Click += (s, e) =>
            {
                List<ViewRow> visible = g.Rows.Where(RowVisible).ToList();
                bool on = visible.Any(x => x.Check.IsChecked != true);
                _updating = true;
                foreach (ViewRow x in visible)
                    x.Check.IsChecked = on;
                _updating = false;
                if (on && visible.Count > 0)
                    g.Expander.IsExpanded = true; // юу сонгогдсоныг харуулна
                SyncGroup(g);
                RebuildKinds();
                UpdatePreview();
            };
            g.Count = Mute(new TextBlock { Margin = new Thickness(6, 0, 0, 0), VerticalAlignment = VerticalAlignment.Center });
            var header = new StackPanel { Orientation = Orientation.Horizontal, ToolTip = tooltip };
            header.Children.Add(g.Check);
            header.Children.Add(new TextBlock { Text = title, FontWeight = FontWeights.SemiBold, Margin = new Thickness(4, 0, 0, 0), VerticalAlignment = VerticalAlignment.Center });
            header.Children.Add(g.Count);
            g.Body = new StackPanel { Margin = new Thickness(18, 2, 0, 4) };
            g.Empty = Mute(new TextBlock { TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 2, 0, 2) });
            g.Body.Children.Add(g.Empty);
            g.Expander = new Expander { Header = header, Content = g.Body, Margin = new Thickness(0, 2, 0, 2) };
            return g;
        }

        private void AddRow(CdLinkedView lv, ViewGroup g, List<ViewRow> into, bool on, bool defaultOn)
        {
            var row = new Grid { Margin = new Thickness(0, 3, 0, 3) };
            row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

            var text = new StackPanel();
            text.Children.Add(new TextBlock { Text = lv.Name, FontWeight = FontWeights.SemiBold, TextTrimming = TextTrimming.CharacterEllipsis });
            string sub = lv.TypeLabel + (string.IsNullOrEmpty(lv.SheetNumber) ? "" : "  ·  хуудас " + lv.SheetNumber)
                + "  ·  " + lv.CountsText;
            text.Children.Add(Mute(new TextBlock { Text = sub, TextTrimming = TextTrimming.CharacterEllipsis }));
            if (!string.IsNullOrEmpty(lv.RelevanceNote) && lv.Relevance != ViewRelevance.General)
            {
                var note = new TextBlock
                {
                    Text = lv.RelevanceNote,
                    FontSize = 12,
                    FontStyle = FontStyles.Italic,
                    TextTrimming = TextTrimming.CharacterEllipsis,
                };
                // Өнгө токеноос (сэдэв дагана); утга нь бичвэрээр ч илэрнэ (RelevanceNote).
                note.SetResourceReference(TextBlock.ForegroundProperty, lv.Relevance == ViewRelevance.Other ? "Warn" : "Ok");
                text.Children.Add(note);
            }
            var cb = new CheckBox
            {
                Content = text,
                IsChecked = on,
                VerticalContentAlignment = VerticalAlignment.Center,
                ToolTip = lv.Name + (string.IsNullOrEmpty(lv.RelevanceNote) ? "" : "\n" + lv.RelevanceNote),
            };
            row.Children.Add(cb);

            var mode = new ComboBox { Width = 190, Margin = new Thickness(8, 0, 0, 0), VerticalAlignment = VerticalAlignment.Center };
            if (lv.CanClone)
                mode.Items.Add(new ComboBoxItem { Content = "Шинэ харагдац үүсгэх", Tag = CdViewMode.NewView });
            mode.Items.Add(new ComboBoxItem { Content = "Байгаа харагдацад нэмэх", Tag = CdViewMode.InPlace });
            foreach (ComboBoxItem it in mode.Items)
            {
                if ((CdViewMode)it.Tag == lv.Mode)
                    mode.SelectedItem = it;
            }
            if (mode.SelectedItem == null)
                mode.SelectedIndex = 0;
            mode.ToolTip = "Шинэ харагдац үүсгэх — зорилт бүрд энэ харагдацын хуулбарыг (зүсэлт, callout, тайрсан план) үүсгэж, хуудсанд тавина.\n"
                + "Байгаа харагдацад нэмэх — олон элементийг харуулдаг ерөнхий харагдац: зорилт энд харагдаж байвал tag, хэмжээсийг ЭНД нь нэмнэ.";
            Grid.SetColumn(mode, 1);
            row.Children.Add(mode);

            var vr = new ViewRow { View = lv, Check = cb, Mode = mode, Root = row, Group = g, DefaultOn = defaultOn };
            into.Add(vr);
            g.Rows.Add(vr);
            g.Body.Children.Add(row);
            cb.Checked += (s, e) => OnRowChanged(vr);
            cb.Unchecked += (s, e) => OnRowChanged(vr);
            mode.SelectionChanged += (s, e) =>
            {
                if (!_updating)
                {
                    RebuildKinds();
                    UpdatePreview();
                }
            };
            mode.IsEnabled = on;
        }

        private void OnRowChanged(ViewRow vr)
        {
            vr.Mode.IsEnabled = vr.Check.IsChecked == true;
            if (_updating)
                return;
            SyncGroup(vr.Group);
            RebuildKinds();
            UpdatePreview();
        }

        private void SyncGroup(ViewGroup g)
        {
            if (g == null)
                return;
            List<ViewRow> visible = g.Rows.Where(RowVisible).ToList();
            int on = visible.Count(x => x.Check.IsChecked == true);
            int hidden = g.Rows.Count - visible.Count;
            bool prev = _updating;
            _updating = true;
            g.Check.IsChecked = visible.Count == 0 || on == 0 ? false : on == visible.Count ? (bool?)true : null;
            g.Check.IsEnabled = visible.Count > 0;
            _updating = prev;
            g.Count.Text = g.Rows.Count == 0 ? "(0)"
                : "(" + on + "/" + visible.Count + " сонгосон" + (hidden > 0 ? ", " + hidden + " шүүлтээр нуугдсан" : "") + ")";
            if (g.Rows.Count == 0)
            {
                if (string.IsNullOrEmpty(g.Empty.Text))
                    g.Empty.Text = "Ийм харагдац алга.";
                g.Empty.Visibility = Visibility.Visible;
            }
            else
            {
                g.Empty.Text = visible.Count == 0 ? "Шүүлтэд таарах харагдац алга." : "";
                g.Empty.Visibility = visible.Count == 0 ? Visibility.Visible : Visibility.Collapsed;
            }
        }

        // ── Элементийн төрлийн сонголт (сонгосон зургуудаас) ───────────────

        private void RebuildKinds()
        {
            if (_kindsPanel == null)
                return;
            // Одоогийн сонголтыг хадгална.
            foreach (KeyValuePair<CheckBox, CdAnnKind> kv in _kindChecks)
            {
                if (!kv.Value.IsTemplate)
                    _kindOn[kv.Value.Kind] = kv.Key.IsChecked == true;
            }
            List<CdLinkedView> sources = EffectiveRows()
                .Where(r => r.View.Dedicated && ModeOf(r) == CdViewMode.NewView)
                .Select(r => r.View).ToList();
            _kindsShown = CdAnalysis.AggregateKinds(_info, sources);
            _kindChecks.Clear();
            _kindsPanel.Children.Clear();
            foreach (CdAnnKind k in _kindsShown)
            {
                bool on = k.IsTemplate || (_kindOn.TryGetValue(k.Kind, out bool was)
                    ? was
                    : _kindsAllOnByDefault == null || _kindsAllOnByDefault.Contains(k.Kind));
                var cb = new CheckBox
                {
                    Content = new TextBlock
                    {
                        Text = k.Kind + (k.IsTemplate ? " (загвар)" : "") + "  " + k.CountsText,
                        FontWeight = k.IsTemplate ? FontWeights.SemiBold : FontWeights.Normal,
                    },
                    IsChecked = on,
                    IsEnabled = !k.IsTemplate,
                    Margin = new Thickness(0, 3, 14, 0),
                    ToolTip = k.IsTemplate
                        ? "Загвар элементийн (ба арматурын) tag, хэмжээс ҮРГЭЛЖ хувилагдана."
                        : "Загварын зурагт байгаа " + k.Kind.ToLowerInvariant() + "-ийн tag, хэмжээсийг зорилтын талын харгалзах элемент дээр хувилах.",
                };
                CdAnnKind kind = k;
                cb.Checked += (s, e) => { _kindOn[kind.Kind] = true; UpdatePreview(); };
                cb.Unchecked += (s, e) => { _kindOn[kind.Kind] = false; UpdatePreview(); };
                _kindsPanel.Children.Add(cb);
                _kindChecks.Add(new KeyValuePair<CheckBox, CdAnnKind>(cb, k));
            }
            _kindsSection.Visibility = _kindsShown.Count > 1 ? Visibility.Visible : Visibility.Collapsed;
        }

        // ── Зорилтын мод ───────────────────────────────────────────────────

        private void RebuildTree()
        {
            _updating = true;
            var keep = _targetChecks.ToDictionary(kv => kv.Key, kv => kv.Value.IsChecked == true);
            _tree.Items.Clear();
            _targetChecks.Clear();
            // Дараалал: ижил төрөл → ижил хэмжээ → эргэлтгүй → толин биш → ижил давхар.
            foreach (var g in _targets.GroupBy(t => t.GroupKey)
                         .OrderBy(g => g.First().Facts?.SameType == true ? 0 : 1)
                         .ThenBy(g => g.First().Facts != null && Core.TargetGrouping.SizeDiffers(g.First().Facts) ? 1 : 0)
                         .ThenBy(g => g.First().Facts == null ? 0 : Math.Abs(Core.TargetGrouping.AngleBucket(g.First().Facts.PlanAngleDeg)))
                         .ThenBy(g => g.First().Facts?.Mirrored == true ? 1 : 0)
                         .ThenBy(g => g.First().Facts?.SameLevel == false ? 1 : 0)
                         .ThenBy(g => g.Key, StringComparer.Ordinal))
            {
                List<CdTargetInfo> list = g.OrderBy(t => t.Label, StringComparer.CurrentCultureIgnoreCase).ToList();
                var groupCheck = new CheckBox
                {
                    Content = new TextBlock { Text = list[0].GroupLabel + "   (" + list.Count + ")", FontWeight = FontWeights.SemiBold },
                    IsThreeState = true,
                };
                var node = new TreeViewItem { Header = groupCheck, IsExpanded = true };
                var children = new List<CheckBox>();
                foreach (CdTargetInfo t in list)
                {
                    var key = new ElementIdKey(t.Id.Value);
                    var cb = new CheckBox
                    {
                        Content = new TextBlock { Text = t.Row },
                        IsChecked = keep.TryGetValue(key, out bool was) ? was : t.Include,
                        ToolTip = t.TypeName + "\nID " + t.Id.Value,
                    };
                    cb.Checked += (s, e) => { t.Include = true; SyncTargetGroup(groupCheck, children); UpdatePreview(); };
                    cb.Unchecked += (s, e) => { t.Include = false; SyncTargetGroup(groupCheck, children); UpdatePreview(); };
                    t.Include = cb.IsChecked == true;
                    children.Add(cb);
                    _targetChecks[key] = cb;
                    node.Items.Add(new TreeViewItem { Header = cb });
                }
                groupCheck.Click += (s, e) =>
                {
                    bool on = children.Any(x => x.IsChecked != true);
                    _updating = true;
                    foreach (CheckBox x in children)
                        x.IsChecked = on;
                    _updating = false;
                    SyncTargetGroup(groupCheck, children);
                    UpdatePreview();
                };
                SyncTargetGroup(groupCheck, children);
                _tree.Items.Add(node);
            }
            if (_targets.Count == 0)
            {
                _tree.Items.Add(new TreeViewItem
                {
                    Header = Mute(new TextBlock
                    {
                        Text = "Зорилт сонгоогүй.  Доорх «+ Ижил төрлийн бүгд» товчоор нэмнэ үү,\nэсвэл цонхыг хаагаад Revit дээр сонгоно уу.",
                    }),
                    IsEnabled = false,
                });
            }
            _updating = false;
            UpdatePreview();
        }

        private void SyncTargetGroup(CheckBox group, List<CheckBox> children)
        {
            int on = children.Count(x => x.IsChecked == true);
            bool prev = _updating;
            _updating = true;
            group.IsChecked = on == 0 ? false : on == children.Count ? (bool?)true : null;
            _updating = prev;
        }

        private void SetAllTargets(bool on)
        {
            _updating = true;
            foreach (CheckBox cb in _targetChecks.Values)
                cb.IsChecked = on;
            _updating = false;
            RebuildTree();
        }

        private void AddMore(bool sameType)
        {
            if (_addMore == null)
                return;
            List<CdTargetInfo> more;
            try
            {
                Cursor = System.Windows.Input.Cursors.Wait;
                more = _addMore(sameType) ?? new List<CdTargetInfo>();
            }
            finally
            {
                Cursor = null;
            }
            var have = new HashSet<long>(_targets.Select(t => t.Id.Value));
            int added = 0;
            foreach (CdTargetInfo t in more)
            {
                if (have.Add(t.Id.Value))
                {
                    _targets.Add(t);
                    added++;
                }
            }
            RebuildTree();
            if (added == 0)
                MessageBox.Show(this, "Нэмэх шинэ элемент олдсонгүй.", Title, MessageBoxButton.OK, MessageBoxImage.Information);
        }

        // ── Урьдчилсан тооцоо ─────────────────────────────────────────────

        private void UpdatePreview()
        {
            if (_updating || _preview == null || _ok == null || _sheets == null || _recreate == null)
                return;
            int total = _targets.Count, chosen = _targets.Count(t => t.Include);
            _targetsHeader.Text = total == 0 ? "" : "Сонгосон: " + chosen + " / " + total
                + "   — бүлэг нь төрөл, хэмжээ, эргэлт, давхраар";
            List<CdLinkedView> views = SelectedViews();
            int n = SelectedTargetIds().Count;
            int newViews = views.Count(v => v.Mode == CdViewMode.NewView);
            int inPlace = views.Count(v => v.Mode == CdViewMode.InPlace);
            int sheets = _sheets.IsChecked == true
                ? views.Where(v => v.Mode == CdViewMode.NewView && !string.IsNullOrEmpty(v.SheetNumber))
                    .Select(v => v.SheetNumber).Distinct().Count()
                : 0;
            int already = _targets.Where(t => t.Include).Count(t => t.ExistingClones > 0);
            int hiddenChecked = _rows.Concat(_candRows).Count(r => r.Check.IsChecked == true && !RowVisible(r));
            int allViews = _rows.Count + _candRows.Count;

            _viewsSummary.Text = "Хувилах харагдац: " + views.Count + " / " + allViews
                + (hiddenChecked > 0 ? "   (сонгосон " + hiddenChecked + " нь шүүлтээр нуугдсан тул ОРОХГҮЙ)" : "");

            var parts = new List<string>();
            if (n == 0 || views.Count == 0)
            {
                _preview.Text = (n == 0 ? "Зорилтот элемент сонгоогүй байна." : "Хувилах харагдац сонгоогүй байна (шүүлт, бүлгийг шалгана уу).")
                    + (string.IsNullOrEmpty(_queueNote) ? "" : "\n" + _queueNote);
                _ok.IsEnabled = false;
                return;
            }
            parts.Add(n + " элемент");
            if (newViews > 0)
                parts.Add(n + " × " + newViews + " = " + (n * newViews) + " шинэ харагдац");
            if (sheets > 0)
                parts.Add(n * sheets + " шинэ хуудас");
            if (inPlace > 0)
                parts.Add(inPlace + " ерөнхий харагдацад tag/хэмжээс нэмнэ");
            string s = "Урьдчилсан тооцоо:  " + string.Join("  ·  ", parts) + ".";
            if (already > 0)
                s += "\n" + already + " элемент өмнө хувилагдсан — "
                    + (_recreate.IsChecked == true ? "УСТГААД шинээр үүсгэнэ — ⚠ устсан өмнөх клоныг «Бүгдийг буцаах» сэргээхгүй, гараар хийсэн засвар алга болно." : "байгааг нь ашиглаж дутууг нь л нэмнэ.");
            s += "\n«Хувилах» дарсны дараа Revit-д үргэлжлүүлэн ажиллаж болно — явц баруун талын «Зураг хувилах» самбарт.";
            if (!string.IsNullOrEmpty(_queueNote))
                s += "\n" + _queueNote;
            _preview.Text = s;
            _ok.IsEnabled = true;
        }

        // ── Үр дүн ─────────────────────────────────────────────────────────

        private static CdViewMode ModeOf(ViewRow r) => r.Mode.SelectedItem is ComboBoxItem it ? (CdViewMode)it.Tag : CdViewMode.InPlace;

        /// <summary>Сонгосон БА шүүлтэд таарсан мөрүүд — анхны дараалалаар (харагдацын жагсаалт, дараа нь хайж олсон).</summary>
        private IEnumerable<ViewRow> EffectiveRows() => _rows.Concat(_candRows).Where(r => r.Check.IsChecked == true && RowVisible(r));

        /// <summary>Хувилах харагдацууд — сонгосон БА шүүлтэд таарсан (нуугдсан нь ОРОХГҮЙ).</summary>
        public List<CdLinkedView> SelectedViews()
        {
            var list = new List<CdLinkedView>();
            foreach (ViewRow r in EffectiveRows())
            {
                r.View.Mode = ModeOf(r);
                list.Add(r.View);
            }
            return list;
        }

        /// <summary>Загвартай гараар холбох (файлд хадгалах) харагдацууд: хуучин гарын холбоос + шинээр сонгосон нэр дэвшигч.
        /// ⚠️ Шүүлтээс ҮЛ ХАМААРНА — шүүлт нь энэ удаагийн сонголт, холбоосыг устгахгүй.</summary>
        public List<string> ManualViewUids()
        {
            var uids = new List<string>();
            foreach (ViewRow r in _rows)
            {
                if (r.View.Manual && r.Check.IsChecked == true)
                    uids.Add(r.View.UniqueId);
            }
            foreach (ViewRow r in _candRows)
            {
                if (r.Check.IsChecked == true)
                    uids.Add(r.View.UniqueId);
            }
            return uids;
        }

        /// <summary>Гарын холбоос өөрчлөгдсөн үү (хадгалах шаардлагатай эсэх).</summary>
        public bool ManualLinksChanged()
        {
            bool anyCand = _candRows.Any(r => r.Check.IsChecked == true);
            bool manualDropped = _rows.Any(r => r.View.Manual && r.Check.IsChecked != true);
            return anyCand || manualDropped;
        }

        /// <summary>
        /// Дараагийн удаа санах сонголт: өгөгдмөлөөс ЗӨРСӨН харагдацууд (UniqueId) ба унтраасан төрлүүд.  Хайж олсон
        /// харагдац энд орохгүй (тэд гарын холбоосоор санагдана).
        /// </summary>
        public CdViewChoice Choice()
        {
            var c = new CdViewChoice();
            foreach (ViewRow r in _rows)
            {
                if (string.IsNullOrEmpty(r.View.UniqueId))
                    continue;
                bool on = r.Check.IsChecked == true;
                if (on && !r.DefaultOn)
                    c.On.Add(r.View.UniqueId);
                else if (!on && r.DefaultOn)
                    c.Off.Add(r.View.UniqueId);
            }
            foreach (KeyValuePair<string, ToggleButton> kv in _typeToggles)
            {
                if (kv.Value.IsChecked != true)
                    c.TypesOff.Add(kv.Key);
            }
            return c;
        }

        /// <summary>Цонхонд байсан бүх харагдацын UniqueId (санасан сонголтыг шинэчлэхэд — энд байгаагүйг хөндөхгүй).</summary>
        public IEnumerable<string> ShownViewUids() => _rows.Select(r => r.View.UniqueId).Where(u => !string.IsNullOrEmpty(u));

        /// <summary>Жагсаалтад байсан төрлүүд (санасан төрлийн шүүлтийг шинэчлэхэд).</summary>
        public IEnumerable<string> ShownTypes() => _typeToggles.Keys;

        public List<Autodesk.Revit.DB.ElementId> SelectedTargetIds() =>
            _targets.Where(t => t.Include).Select(t => t.Id).ToList();

        public CdOptions ToOptions() => new CdOptions
        {
            Tags = _tags.IsChecked == true,
            Dimensions = _dims.IsChecked == true,
            Spots = _spots.IsChecked == true,
            Details = _details.IsChecked == true,
            Sheets = _sheets.IsChecked == true,
            Rebar = _rebar.IsChecked == true,
            ReplaceMark = _replace.IsChecked == true,
            Recreate = _recreate.IsChecked == true,
            AnnotationKinds = SelectedKinds(),
        };

        /// <summary>Сонгосон элементийн төрлүүд; жагсаалтад ганц төрөл (загварынх) л байвал null = бүгд.</summary>
        public HashSet<string> SelectedKinds()
        {
            if (_kindChecks.Count <= 1)
                return null;
            var set = new HashSet<string>(_kindChecks.Where(kv => kv.Key.IsChecked == true).Select(kv => kv.Value.Kind));
            set.Add(_info.Kind);
            return set;
        }

        /// <summary>Санах «аль элементийн tag» сонголт — цонхонд гарсан эсэхээс үл хамааран хэрэглэгчийн сүүлийн шийдвэр.</summary>
        public Dictionary<string, bool> KindChoices()
        {
            foreach (KeyValuePair<CheckBox, CdAnnKind> kv in _kindChecks)
            {
                if (!kv.Value.IsTemplate)
                    _kindOn[kv.Value.Kind] = kv.Key.IsChecked == true;
            }
            return new Dictionary<string, bool>(_kindOn, StringComparer.Ordinal);
        }

        // ── Жижиг туслахууд ────────────────────────────────────────────────

        private static GroupBox Group(string header, UIElement content) => new GroupBox
        {
            Header = new TextBlock { Text = header, FontWeight = FontWeights.SemiBold },
            Content = content,
            Margin = new Thickness(0, 6, 0, 0),
            Padding = new Thickness(8, 6, 8, 6),
        };

        private static CheckBox Check(Panel parent, string text, bool value)
        {
            var cb = new CheckBox
            {
                Content = new TextBlock { Text = text, TextWrapping = TextWrapping.Wrap },
                IsChecked = value,
                Margin = new Thickness(0, 3, 8, 0),
            };
            parent.Children.Add(cb);
            return cb;
        }

        private static Button SmallButton(string text, Action onClick)
        {
            var b = new Button { Content = text, Margin = new Thickness(0, 0, 6, 4), Padding = new Thickness(8, 2, 8, 2) };
            b.Click += (s, e) => onClick();
            return b;
        }

        private static TextBlock Hint(string text) => Mute(new TextBlock
        {
            Text = text,
            TextWrapping = TextWrapping.Wrap,
            Margin = new Thickness(0, 6, 0, 0),
        });

        /// <summary>Хоёрдогч бичвэр: `Opacity` БИШ (хуурамч контраст) — `FgMuted` токен, ≥ 12 DIP.</summary>
        private static TextBlock Mute(TextBlock t)
        {
            t.FontSize = 12;
            t.SetResourceReference(TextBlock.ForegroundProperty, "FgMuted");
            return t;
        }
    }
}
