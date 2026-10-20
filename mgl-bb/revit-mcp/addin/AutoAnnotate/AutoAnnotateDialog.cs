using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using RevitMcpAddin.AutoAnnotate.Core;
using RevitMcpAddin.Reinforcement;
using RevitMcpAddin.Reinforcement.Ui;

namespace RevitMcpAddin.AutoAnnotate
{
    /// <summary>Цонх нээгдэх үеийн идэвхтэй таб (хуучин «Огтлолын тэмдэглэгээ» товч → <see cref="Copy"/>).</summary>
    internal enum AaDialogTab
    {
        Default = 0,
        Copy = 1,
    }

    /// <summary>
    /// «Хэмжээс, тэмдэглэгээ»-ний НЭГДСЭН тохиргооны цонх (кодоор угсарсан WPF — XAML-гүй).
    ///
    /// Дээд талд НЭГ «Хэмжээсийн төрөл» (бүх хэмжээсэд — ерөнхий, огтлол, дэлгээс, MRA-ийн хэмжээс) — өмнө нь Арматур/Ерөнхий хоёр хайрцаг байж нэг нь чимээгүй
    /// үл тоогддог байв.  Табууд:
    ///   • арматурын дам нуруу/багана олдвол: «Түргэн» · «Дам нурууны арматурын хэмжээс» · «Баганын арматурын хэмжээс» · «Хана, хучилт» · «Хуулбарлаж зурах»;
    ///   • олдохгүй бол: «Ерөнхий хэмжээс» (тэнхлэг, түвшин, tag — хуучин цонх хэвээр) · «Хуулбарлаж зурах».
    /// «Бас ерөнхий хэмжээс» нь арматурын табын доор эвхэгдэх хэсэг (өмнөх «Ерөнхий хэмжээс» таб — давхар таб үгүй).
    /// «Хуулбарлаж зурах» нь хуучин «Огтлолын тэмдэглэгээ» хэрэгслийн «Загвар харагдацаас хуулах» — зөвхөн хуулбарлах тохиргоотой тусдаа таб.
    /// </summary>
    internal sealed class AutoAnnotateDialog : Window
    {
        private readonly AaViewInfo _info;
        private readonly AaOptions _o;
        private readonly Dictionary<string, CheckBox> _dims = new Dictionary<string, CheckBox>();
        private readonly Dictionary<string, CheckBox> _tags = new Dictionary<string, CheckBox>();
        private readonly RadioButton _allView, _selection;
        private readonly AaPlacementBlock _place;
        private readonly CheckBox _extendGrids, _replace;
        private CheckBox _gridChain;
        private readonly ComboBox _dimType = new ComboBox { MinWidth = 300 };
        private readonly TextBox _first, _step;
        private readonly AaRebarPanel _rebar;
        private readonly AaWallSlabPanel _ws;
        private readonly bool _wsOnly;
        private TabItem _quickTab;
        private CheckBox _qTags, _qDims, _qMember;
        private bool _quickSync;
        private readonly CheckBox _alsoGeneral = new CheckBox();
        private readonly RfTemplatePanel _copy;
        private readonly TabControl _tabs;
        private readonly TabItem _copyTab;
        private readonly Button _ok;
        private readonly TextBlock _footNote;
        private readonly FrameworkElement _dimRow;
        private readonly string _scaleNote;

        /// <summary>«Загвараас хуулах» дарсан бол сонголт ба зорилтот элемент (энэ үед <see cref="ToOptions"/> хэрэглэгдэхгүй).</summary>
        public RfTemplatePick TemplateResult { get; private set; }
        public Autodesk.Revit.DB.Element TemplateTarget { get; private set; }

        public AutoAnnotateDialog(AaViewInfo info, AaOptions prefs, RfTemplatePanel copyPanel, AaDialogTab initialTab)
        {
            _info = info;
            _o = (prefs ?? new AaOptions()).Clone();
            // Огтлол/хана-хучилтын табууд ерөнхий «Байрлал»-ын утгаар нээгдэнэ (нэг үнэн).
            _o.ApplyPlacement();
            _copy = copyPanel;

            // Хэмжээ/байрлал (дэлгэцийн ажлын талбарт багтана, хил хадгалагдана) + дундын сэдэв (Light/Dark/өндөр контраст).
            Ui.MglWindow.Setup(this, "MGL — Хэмжээс, тэмдэглэгээ автоматаар тавих", 880, 700, 780, 540, prefsKey: "auto-annotate");
            Ui.MglTheme.Apply(this);

            var root = new DockPanel { Margin = new Thickness(14) };

            // ── Толгой
            var head = new StackPanel { Margin = new Thickness(0, 0, 0, 8) };
            head.Children.Add(new TextBlock
            {
                Text = "Харагдацын хэмжээс, tag-ийг ажлын зураг шиг автоматаар тавих",
                FontSize = 16,
                FontWeight = FontWeights.SemiBold,
            });
            head.Children.Add(Mute(new TextBlock
            {
                Text = info.ViewName + " · " + KindLabel(info.Kind) + " · 1:" + info.Scale,
                Margin = new Thickness(0, 2, 0, 0),
            }));
            head.Children.Add(Mute(new TextBlock
            {
                Text = "Олдсон: " + FoundLine(info),
                TextWrapping = TextWrapping.Wrap,
                Margin = new Thickness(0, 2, 0, 0),
            }));
            foreach (UIElement note in Diagnostics(info))
                head.Children.Add(note);

            // ── НЭГ «Хэмжээсийн төрөл» (бүх хэмжээсэд)
            _dimRow = BuildDimTypeRow(head);
            DockPanel.SetDock(head, Dock.Top);
            root.Children.Add(head);

            // ── Доод: тайлбар + товч
            var bottom = new DockPanel { Margin = new Thickness(0, 10, 0, 0) };
            var buttons = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Right };
            _ok = new Button { Content = "Тавих", IsDefault = true, MinWidth = 130, Padding = new Thickness(12, 5, 12, 5) };
            Ui.MglUi.Primary(_ok);
            _ok.Click += OnOk;
            var cancel = new Button { Content = "Болих", IsCancel = true, MinWidth = 80, Margin = new Thickness(8, 0, 0, 0), Padding = new Thickness(12, 5, 12, 5) };
            buttons.Children.Add(_ok);
            buttons.Children.Add(cancel);
            DockPanel.SetDock(buttons, Dock.Right);
            bottom.Children.Add(buttons);
            _scaleNote = "Бүгд нэг Ctrl+Z-ээр буцна.  Таны гараар тавьсан хэмжээс, tag ХӨНДӨГДӨХГҮЙ — "
                + "дахин дарахад зөвхөн энэ хэрэгслийн өмнө тавьсныг солино.  Зай нь цаасан дээрх мм "
                + "(1:" + info.Scale + " масштабт 10 мм = " + (info.Scale / 100.0).ToString("0.##", CultureInfo.InvariantCulture) + " м).";
            Border footBorder = Ui.MglUi.Note(_scaleNote);
            footBorder.Margin = new Thickness(0, 0, 12, 0);
            _footNote = footBorder.Child as TextBlock;
            bottom.Children.Add(footBorder);
            DockPanel.SetDock(bottom, Dock.Bottom);
            root.Children.Add(bottom);

            // ── Ерөнхий хэмжээсийн самбар (план/зүсэлт/фасадын хэмжээс, tag)
            var generalLeft = new StackPanel();
            var generalRight = new StackPanel();
            generalLeft.Children.Add(Section("Хэмжээс"));
            if (info.Kind == AaViewKind.Plan)
            {
                AddDim(generalLeft, "grid", "Тэнхлэг хоорондын хэмжээс", _o.GridDims, info.Grids >= 2,
                    info.Grids >= 2 ? info.Grids + " тэнхлэг" : "тэнхлэг " + info.Grids + " — 2-оос цөөн тул тавигдахгүй");
                AddGridChain(generalLeft);
                AddDim(generalLeft, "facade", "Гадна хана — булан, цонх, хаалганы нүх", _o.FacadeDims, info.WallsExterior > 0,
                    info.WallsExterior > 0 ? info.WallsExterior + " гадна хана" : "гадна хана олдсонгүй");
                AddDim(generalLeft, "interior", "Дотор — хананы зузаан, өрөөний хэмжээ", _o.InteriorDims, info.Walls > 0 && info.Grids >= 2,
                    info.Walls == 0 ? "хана олдсонгүй" : info.Grids >= 2 ? "тэнхлэг хоорондын дундаар" : "тэнхлэг (2+) хэрэгтэй");
                AddDim(generalLeft, "door", "Дотор хаалганы нүх ба холболт", _o.DoorDims, info.Doors + info.Windows > 0,
                    info.Doors + info.Windows > 0 ? info.Doors + " хаалга" : "хаалга олдсонгүй");
                AddDim(generalLeft, "column", "Баганыг тэнхлэгт холбох", info.Structural ? _o.ColumnTiesStructural : _o.ColumnTiesArchitectural,
                    info.Columns > 0 && info.Grids > 0,
                    info.Columns == 0 ? "багана олдсонгүй" : info.Grids == 0 ? info.Columns + " багана — тэнхлэг хэрэгтэй"
                        : info.Columns + " багана" + (info.Structural ? "" : " (архитектурын планд анхдагч унтраалттай)"));
            }
            else
            {
                AddDim(generalLeft, "level", "Түвшин — давхрын өндөр, нийт өндөр", _o.LevelDims, info.Levels >= 2,
                    info.Levels >= 2 ? info.Levels + " түвшин" : "түвшин " + info.Levels + " — 2-оос цөөн тул тавигдахгүй");
                AddDim(generalLeft, "grid", "Тэнхлэг хоорондын хэмжээс", _o.GridDims, info.Grids >= 2,
                    info.Grids >= 2 ? info.Grids + " тэнхлэг" : "тэнхлэг " + info.Grids + " — 2-оос цөөн тул тавигдахгүй");
                AddGridChain(generalLeft);
                AddDim(generalLeft, "opening", "Цонх, хаалганы доод/дээд ирмэг", _o.OpeningHeights, info.Doors + info.Windows > 0,
                    info.Doors + info.Windows > 0 ? (info.Doors + info.Windows) + " нүх" : "цонх, хаалга олдсонгүй");
            }

            // «Байрлал» — хэрэгслийн БҮХ хэмжээсийн НЭГ байрлал (2026-10-12, t1.pdf).  Арматурын огтлол, хана-хучилтын блокуудтай холбогдоно (доор Link).
            _place = new AaPlacementBlock("aa-gen-place", "Барилгын 4 талд", "Ханаас", _o.AllSides, _o.RightSide, _o.FirstMm, _o.StepMm, null);
            _place.Panel.Margin = new Thickness(0, 6, 0, 0);
            generalLeft.Children.Add(_place.Panel);
            _first = _place.First;
            _step = _place.Step;

            _extendGrids = new CheckBox
            {
                Content = "Тэнхлэгийн бөмбөлгийг хэмжээсний гадна гаргах",
                IsChecked = _o.ExtendGrids,
                IsEnabled = info.Grids > 0 || info.Levels > 0,
                Margin = new Thickness(0, 8, 0, 2),
                ToolTip = "Зөвхөн ЭНЭ харагдацад тэнхлэгийн шугамыг уртасгана (бусад харагдац хөндөгдөхгүй).",
            };
            generalLeft.Children.Add(_extendGrids);

            generalRight.Children.Add(Section("Tag / шошго"));
            foreach (AaTagInfo t in info.Tags)
            {
                if (t.Count == 0)
                    continue;
                bool hasType = t.TagTypeId != Autodesk.Revit.DB.ElementId.InvalidElementId;
                int todo = t.Count - t.AlreadyTagged;
                // Tag family-гүй бол л идэвхгүй (тавих боломжгүй) — «бүгд tag-тай» үед ч сонгож болно.
                var cb = new CheckBox
                {
                    IsChecked = hasType && AaTags.Enabled(_o, t.Key),
                    IsEnabled = hasType,
                    Margin = new Thickness(0, 3, 0, 3),
                };
                var tx = new StackPanel();
                tx.Children.Add(new TextBlock
                {
                    Text = t.Label + " — " + t.Count + (todo <= 0 ? " (бүгд аль хэдийн tag-тай)" : t.AlreadyTagged > 0 ? " (" + t.AlreadyTagged + " нь аль хэдийн tag-тай)" : ""),
                });
                tx.Children.Add(Mute(new TextBlock
                {
                    Text = hasType ? t.TagTypeName : "Tag family ачаалаагүй — Revit-ийн «Insert → Load Family → Annotations»-оор ачаална уу",
                    TextWrapping = TextWrapping.Wrap,
                }));
                cb.Content = tx;
                _tags[t.Key] = cb;
                generalRight.Children.Add(cb);
            }
            if (_tags.Count == 0)
                generalRight.Children.Add(Mute(new TextBlock { Text = "Энэ харагдацад tag-лах элемент олдсонгүй." }));

            generalRight.Children.Add(Section("Хүрээ"));
            _allView = new RadioButton { Content = "Харагдацад байгаа бүх элемент", IsChecked = true, Margin = new Thickness(0, 2, 0, 2) };
            _selection = new RadioButton
            {
                Content = info.SelectionCount > 0 ? "Зөвхөн сонгосон " + info.SelectionCount + " элемент (тэнхлэг/түвшин сонгосон бол тэдний гинж)" : "Зөвхөн сонгосон элемент (сонголт алга)",
                IsEnabled = info.SelectionCount > 0,
                Margin = new Thickness(0, 2, 0, 2),
            };
            generalRight.Children.Add(_allView);
            generalRight.Children.Add(_selection);
            _replace = new CheckBox
            {
                Content = info.PreviousCount > 0
                    ? "Энэ хэрэгслийн өмнө тавьсан " + info.PreviousCount + " хэмжээс/tag-ийг устгаад дахин тавих"
                    : "Дахин дарахад өмнөхийг солих (одоогоор өмнөх алга)",
                IsChecked = _o.ReplacePrevious,
                Margin = new Thickness(0, 8, 0, 2),
            };
            generalRight.Children.Add(_replace);

            // ── Табууд
            _tabs = new TabControl();
            bool rebarMode = info.Rebar != null && info.Rebar.HasWork;
            TabItem firstTab;
            bool wsHas = info.WallSlab != null && info.WallSlab.HasWork;
            bool wsOnly = wsHas && !rebarMode;
            // «Хана, хучилт» таб ҮРГЭЛЖ байна (багц олдоогүй бол шалтгаантай) — өмнө нь олдоогүй үед таб алга болдог байв.
            _wsOnly = wsOnly;
            if (info.WallSlab != null && info.Rebar != null)
                _ws = new AaWallSlabPanel(info.WallSlab, info.Rebar, _o.WallSlab, _o.Rebar?.MraTypeUid, _o.Rebar?.BarTagTypeUid);
            if (rebarMode || wsOnly)
            {
                // «Бас ерөнхий хэмжээс»: арматурын табын доор эвхэгдэх хэсэг (өмнө нь тусдаа «Ерөнхий хэмжээс» таб байв).
                _alsoGeneral.Content = "Бас ерөнхий хэмжээс (тэнхлэг, түвшин, tag) тавих";
                _alsoGeneral.IsChecked = _o.Rebar != null && _o.Rebar.AlsoGeneral;
                _alsoGeneral.FontWeight = FontWeights.SemiBold;
                var expander = new Expander
                {
                    Header = _alsoGeneral,
                    Margin = new Thickness(0, 14, 0, 6),
                    IsExpanded = _alsoGeneral.IsChecked == true,
                    Content = new Border { Padding = new Thickness(8, 4, 0, 0), Child = GeneralGrid(generalLeft, generalRight, scroll: false) },
                };
                if (rebarMode)
                {
                    _rebar = new AaRebarPanel(info.Rebar, _o.Rebar);
                    _rebar.TagsBody.Children.Add(expander);
                    // «Түргэн» таб — ЭХНИЙ: [✓ Шошго] [✓ Хэмжээс] + «Тавих».  Нарийвчилсан тохиргоо доорх хоёр табд хэвээр.
                    _quickTab = new TabItem { Header = "Түргэн", Content = BuildQuickTab(info) };
                    _tabs.Items.Add(_quickTab);
                    firstTab = new TabItem { Header = AaRebarPanel.TagsTabHeader, Content = _rebar.TagsTab };
                    _tabs.Items.Add(firstTab);
                    _tabs.Items.Add(new TabItem { Header = "Баганын арматурын хэмжээс", Content = _rebar.DimsTab });
                    _tabs.SelectedItem = _o.Rebar != null && !_o.Rebar.Enabled ? null : _quickTab;
                    if (_ws != null) _tabs.Items.Add(new TabItem { Header = "Хана, хучилт", Content = _ws.Tab });
                }
                else
                {
                    _ws.Body.Children.Add(expander);
                    firstTab = new TabItem { Header = "Хана, хучилт", Content = _ws.Tab };
                    _tabs.Items.Add(firstTab);
                    _tabs.SelectedItem = firstTab;
                }
            }
            else
            {
                firstTab = new TabItem { Header = "Ерөнхий хэмжээс", Content = GeneralGrid(generalLeft, generalRight, scroll: true) };
                _tabs.Items.Add(firstTab);
                _tabs.SelectedItem = firstTab;
                // Хана/хучилтын багц олдоогүй ч таб харагдана (шалтгаан, тохиргоо хадгалагдана).
                if (_ws != null) _tabs.Items.Add(new TabItem { Header = "Хана, хучилт", Content = _ws.Tab });
            }

            // НЭГ «Байрлал»: ерөнхий, огтлол, хана-хучилтын блокууд нэг утгатай — аль нэгийг засахад бусад нь дагана.
            AaPlacementBlock.Link(_place, _rebar?.Placement, _ws?.Placement);

            _copyTab = new TabItem
            {
                Header = RfText.TplTabHeader,
                Content = new ScrollViewer { Content = _copy ?? (UIElement)new TextBlock { Text = RfText.TplUnsupportedView, TextWrapping = TextWrapping.Wrap }, VerticalScrollBarVisibility = ScrollBarVisibility.Auto, Margin = new Thickness(2, 0, 8, 6) },
            };
            _tabs.Items.Add(_copyTab);
            if (initialTab == AaDialogTab.Copy) _tabs.SelectedItem = _copyTab;
            else if (_tabs.SelectedItem == null) _tabs.SelectedIndex = 0;

            _tabs.SelectionChanged += (s, e) =>
            {
                if (e.OriginalSource == _tabs) OnTabChanged();
            };
            if (_copy != null) _copy.StateChanged += (s, e) => OnTabChanged();
            root.Children.Add(_tabs);
            Content = root;
            OnTabChanged();
        }

        /// <summary>
        /// «Түргэн» таб: нэг товчоор шошго БА хэмжээсийг ХАМТ тавина; чагтаар хоёуланг эсвэл аль нэгийг нь сонгоно.  Эндхи чагт нь нарийвчилсан табуудын чагтуудыг
        /// ШУУД удирддаг (давхар төлөв үгүй): шошго ✓ = огтлолын ажлын/хомутын шошго + дэлгээсийн шошго; хэмжээс ✓ = хомутын гинж + давхцал + тэнхлэг/түвшний гинж;
        /// MRA (алхмын хэмжээс + шошго) ба хана/хучилтын MRA нь хоёулаа ✓ үед л.  Байрлал, зай = «Дам нурууны арматурын хэмжээс» табын мм (компанийн стандарт).
        /// </summary>
        private FrameworkElement BuildQuickTab(AaViewInfo info)
        {
            var body = new StackPanel { Margin = new Thickness(6, 4, 8, 6) };
            body.Children.Add(new TextBlock { Text = "Нэг товчоор шошго, хэмжээсийг хамт тавина", FontSize = 15, FontWeight = FontWeights.SemiBold });
            body.Children.Add(Mute(new TextBlock
            {
                Text = "Юуг тавихаа чагтлаад доорх «Тавих» дарна.  Байрлал, зай нь «Дам нурууны арматурын хэмжээс» табын тохиргоо (мм, цаасан дээр) — тэндээ нэг удаа тохируулбал энд ижил хэвээр тавигдана.",
                TextWrapping = TextWrapping.Wrap,
                Margin = new Thickness(0, 2, 0, 8),
            }));

            _qTags = new CheckBox { IsChecked = _rebar.AnyTags, Margin = new Thickness(0, 6, 0, 0), FontSize = 14 };
            var tagText = new StackPanel();
            tagText.Children.Add(new TextBlock { Text = "Шошго (tag)", FontWeight = FontWeights.SemiBold });
            tagText.Children.Add(Mute(new TextBlock { Text = "Огтлол: ажлын арматур, хомут · Дэлгээс: ажлын арматур", TextWrapping = TextWrapping.Wrap }));
            _qTags.Content = tagText;

            _qDims = new CheckBox { IsChecked = _rebar.AnyDims, Margin = new Thickness(0, 10, 0, 0), FontSize = 14 };
            var dimText = new StackPanel();
            dimText.Children.Add(new TextBlock { Text = "Хэмжээс", FontWeight = FontWeights.SemiBold });
            dimText.Children.Add(Mute(new TextBlock { Text = "Огтлол: хомутаас бетон хүртэлх гинж («30 | 240 | 30») · Дэлгээс: давхцал, тэнхлэг/түвшний гинж", TextWrapping = TextWrapping.Wrap }));
            _qDims.Content = dimText;

            body.Children.Add(_qTags);
            body.Children.Add(_qDims);
            body.Children.Add(Mute(new TextBlock
            {
                Text = "Хоёулаа ✓ бол хомутын MRA (алхмын хэмжээс + шошго) ба хана/хучилтын MRA ч тавигдана.  Нэгийг нь авбал MRA тавигдахгүй.",
                TextWrapping = TextWrapping.Wrap,
                Margin = new Thickness(22, 2, 0, 0),
            }));

            // Багана, дам нурууны хэмжээ — тэнхлэг, хана, хучилттай уялдуулсан гадна гинж (эзний хүсэлт 2026-10-08).  «Хэмжээс»-ээс ТУСДАА чагт.
            _qMember = new CheckBox { IsChecked = _rebar.MemberDims, Margin = new Thickness(0, 14, 0, 0), FontSize = 14 };
            var memberText = new StackPanel();
            memberText.Children.Add(new TextBlock { Text = "Багана, дам нурууны хэмжээ — тэнхлэг, хана, хучилттай уялдуулах", FontWeight = FontWeights.SemiBold });
            memberText.Children.Add(Mute(new TextBlock
            {
                Text = "Огтлол: хомутын гинжний гадна — хэвтээ «нүүр | тэнхлэг | нүүр» («150 | 150»), босоо «дээд нүүр | хучилтын доод | доод нүүр» («170 | 330»); шүргэлцсэн хана байвал ханын нүүр ч орно."
                    + (info.Rebar != null && info.Rebar.SectionHosts == 0 ? "  (Энэ харагдацад огтлол алга — огтлол дээр ажиллана.)" : ""),
                TextWrapping = TextWrapping.Wrap,
            }));
            _qMember.Content = memberText;
            body.Children.Add(_qMember);
            _qMember.Checked += (s, e) => { if (!_quickSync) _rebar.MemberDims = true; };
            _qMember.Unchecked += (s, e) => { if (!_quickSync) _rebar.MemberDims = false; };

            string found = QuickFound(info);
            if (found != null)
                body.Children.Add(Mute(new TextBlock { Text = "Энэ харагдацад: " + found, TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 12, 0, 0) }));

            _qTags.Checked += (s, e) => OnQuickToggled();
            _qTags.Unchecked += (s, e) => OnQuickToggled();
            _qDims.Checked += (s, e) => OnQuickToggled();
            _qDims.Unchecked += (s, e) => OnQuickToggled();
            // Нарийвчилсан табд өөрчлөхөд түргэн табын чагт дагана.
            _rebar.QuickChanged += (s, e) => SyncQuickFromDetail();
            return new ScrollViewer { Content = body, VerticalScrollBarVisibility = ScrollBarVisibility.Auto };
        }

        private static string QuickFound(AaViewInfo info)
        {
            var parts = new List<string>();
            if (info.Rebar != null)
            {
                if (info.Rebar.SectionHosts > 0) parts.Add(info.Rebar.SectionHosts + " огтлол");
                if (info.Rebar.ElevationHosts > 0) parts.Add(info.Rebar.ElevationHosts + " дэлгээс");
            }
            if (info.WallSlab != null && info.WallSlab.HasWork) parts.Add(info.WallSlab.Sets + " хана/хучилтын багц");
            return parts.Count == 0 ? null : string.Join(" · ", parts);
        }

        /// <summary>Түргэн табын чагт өөрчлөгдөхөд нарийвчилсан чагтуудыг тохируулна.</summary>
        private void OnQuickToggled()
        {
            if (_quickSync || _rebar == null) return;
            _quickSync = true;
            try
            {
                bool tags = _qTags.IsChecked == true, dims = _qDims.IsChecked == true;
                _rebar.SetTags(tags);
                _rebar.SetDims(dims);
                bool both = tags && dims;
                _rebar.SetMra(both);
                if (_ws != null) _ws.Enabled = both;
            }
            finally
            {
                _quickSync = false;
            }
        }

        /// <summary>Нарийвчилсан табд чагт өөрчлөгдвөл түргэн табын хоёр чагтыг (ядаж нэг нь асаалттай эсэхээр) шинэчилнэ.</summary>
        private void SyncQuickFromDetail()
        {
            if (_quickSync || _qTags == null) return;
            _quickSync = true;
            try
            {
                _qTags.IsChecked = _rebar.AnyTags;
                _qDims.IsChecked = _rebar.AnyDims;
                if (_qMember != null) _qMember.IsChecked = _rebar.MemberDims;
            }
            finally
            {
                _quickSync = false;
            }
        }

        private bool CopyActive { get { return ReferenceEquals(_tabs.SelectedItem, _copyTab); } }

        /// <summary>Идэвхтэй таб солигдоход: үндсэн товч, тайлбар, хэмжээсийн төрлийн мөр (хуулбарт хамаагүй — загварын хэмжээс өөрийн төрлөөрөө).</summary>
        private void OnTabChanged()
        {
            bool copy = CopyActive;
            _ok.Content = copy ? RfText.TplCopy : "Тавих";
            _ok.IsEnabled = !copy || (_copy != null && _copy.CanCopy);
            _dimRow.Visibility = copy ? Visibility.Collapsed : Visibility.Visible;
            if (_footNote != null)
                _footNote.Text = "ⓘ " + (copy
                    ? "Бүгд нэг Ctrl+Z-ээр буцна.  Таны гараар тавьсан хэмжээс, tag, текст ХЭЗЭЭ Ч устахгүй — шинэ харагдац ҮҮСЭХГҮЙ, энэ харагдац дээр шууд нэмэгдэнэ."
                    : _scaleNote);
        }

        private void OnOk(object sender, RoutedEventArgs e)
        {
            if (CopyActive)
            {
                if (_copy == null || !_copy.CanCopy) return;
                TemplateResult = _copy.CurrentPick();
                TemplateTarget = _copy.TargetHost;
                if (TemplateResult == null || TemplateTarget == null) return;
                DialogResult = true;
                return;
            }
            if (Validate())
                DialogResult = true;
        }

        /// <summary>
        /// «Хэмжээсийн төрөл» — бүх хэмжээсэд НЭГ сонголт.  Хадгалсан UniqueId энэ төсөлд олдохгүй бол (устгагдсан / өөр төслийн) ИЛ анхааруулж өгөгдмөл рүү
        /// тавина — чимээгүй өөр төрөл хэрэглэхгүй.
        /// </summary>
        private FrameworkElement BuildDimTypeRow(Panel host)
        {
            var wrap = new StackPanel { Margin = new Thickness(0, 8, 0, 0) };
            var row = new DockPanel();
            row.Children.Add(new TextBlock { Text = "Хэмжээсийн төрөл (бүх хэмжээсэд):", VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(0, 0, 8, 0), FontWeight = FontWeights.SemiBold });
            _dimType.Items.Add(new ComboBoxItem { Content = "(файлын өгөгдмөл)", Tag = "" });
            var options = new List<AaTypeOption>();
            foreach (KeyValuePair<string, string> kv in _info.DimensionTypes)
            {
                options.Add(new AaTypeOption(kv.Key, kv.Value));
                _dimType.Items.Add(new ComboBoxItem { Content = kv.Value + (kv.Key == _info.DefaultDimensionUid ? "  (өгөгдмөл)" : ""), Tag = kv.Key });
            }
            AaTypeSelection sel = AaTypeChoice.Choose(options, _o.DimensionTypeUid);
            int idx = 0;
            for (int i = 0; i < _dimType.Items.Count; i++)
            {
                var it = _dimType.Items[i] as ComboBoxItem;
                if (it != null && string.Equals(it.Tag as string, sel.Uid, StringComparison.Ordinal)) { idx = i; break; }
            }
            _dimType.SelectedIndex = idx;
            _dimType.ToolTip = "Ерөнхий хэмжээс, огтлолын хомутын гинж, дэлгээсийн давхцал/гинж, хомутын MRA-ийн хэмжээс БҮГД яг энэ төрлөөр үүснэ.";
            row.Children.Add(_dimType);
            wrap.Children.Add(row);
            if (sel.Stale)
            {
                var warn = Mute(new TextBlock
                {
                    Text = "⚠ Өмнө сонгосон хэмжээсийн төрөл энэ төсөлд олдсонгүй (устгагдсан эсвэл өөр төслийн) — «файлын өгөгдмөл» болголоо.  Хүсвэл дахин сонгоно уу.",
                    TextWrapping = TextWrapping.Wrap,
                    Margin = new Thickness(0, 2, 0, 0),
                });
                warn.SetResourceReference(TextBlock.ForegroundProperty, "Warn");
                wrap.Children.Add(warn);
            }
            host.Children.Add(wrap);
            return wrap;
        }

        private static FrameworkElement GeneralGrid(StackPanel left, StackPanel right, bool scroll)
        {
            var grid = new Grid();
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(14) });
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            FrameworkElement l = left, r = right;
            if (scroll)
            {
                l = new ScrollViewer { Content = left, VerticalScrollBarVisibility = ScrollBarVisibility.Auto };
                r = new ScrollViewer { Content = right, VerticalScrollBarVisibility = ScrollBarVisibility.Auto };
            }
            Grid.SetColumn(l, 0);
            Grid.SetColumn(r, 2);
            grid.Children.Add(l);
            grid.Children.Add(r);
            return grid;
        }

        private static TextBlock Section(string text) => new TextBlock
        {
            Text = text,
            FontWeight = FontWeights.SemiBold,
            FontSize = 13,
            Margin = new Thickness(0, 10, 0, 4),
        };

        /// <summary>
        /// ⚠️ Хайрцаг ХЭЗЭЭ Ч идэвхгүй болохгүй (1.7.1).  1.7.0 нь элемент олдоогүй үед бүгдийг саарал
        /// болгодог байсан тул хэрэглэгч «checkbox ажиллахгүй» гэж ойлгосон.  Одоо боломжгүй сонголт
        /// анхдагчаар л унтраалттай, доор нь шар өнгөөр шалтгаан; сонгож болно (тавих юм олдохгүй бол
        /// тайланд хэлнэ).  Хадгалсан сонголтыг хэрэглэгч хөндөөгүй бол өөрчлөхгүй (<see cref="Dim"/>).
        /// </summary>
        private void AddDim(Panel p, string key, string label, bool on, bool possible, string hint)
        {
            var cb = new CheckBox { IsChecked = on && possible, Margin = new Thickness(0, 3, 0, 3), Tag = possible };
            var tx = new StackPanel();
            tx.Children.Add(new TextBlock { Text = label });
            // Боломжгүй шалтгаан: өнгө (Warn токен) + «⚠» тэмдэг — өнгөөр ганцаараа биш.
            var h = new TextBlock { Text = possible ? hint : "⚠ " + hint, TextWrapping = TextWrapping.Wrap };
            Mute(h);
            if (!possible) h.SetResourceReference(TextBlock.ForegroundProperty, "Warn");
            tx.Children.Add(h);
            cb.Content = tx;
            _dims[key] = cb;
            p.Children.Add(cb);
        }

        /// <summary>Тэнхлэгийн хэмжээсийн дор: тэнхлэг БҮРИЙН хооронд (гинж) тавих уу, зөвхөн нийт хэмжээ юу.</summary>
        private void AddGridChain(Panel p)
        {
            _gridChain = new CheckBox
            {
                Content = "Тэнхлэг бүрийн хооронд ч тавих (гинж)  —  унтраавал зөвхөн нийт хэмжээ",
                IsChecked = _o.GridChain,
                Margin = new Thickness(22, 0, 0, 4),
                ToolTip = "Асаалттай: зэргэлдээ тэнхлэг бүрийн хоорондын хэмжээс + нийт.  Унтраалттай: зөвхөн хамгийн захын хоёр тэнхлэгийн хоорондын НИЙТ хэмжээ.",
            };
            p.Children.Add(_gridChain);
        }

        /// <summary>Олдсон зүйлийн тайлбар: link-ээс уншсан, ачаалагдаагүй link, «яагаад 0».</summary>
        private static IEnumerable<UIElement> Diagnostics(AaViewInfo i)
        {
            var r = new List<UIElement>();
            if (i.EmptyReason != null)
                r.Add(Note(i.EmptyReason, true));
            if (i.LinksUnloaded.Count > 0 && i.EmptyReason == null)
                r.Add(Note("Ачаалагдаагүй link: " + string.Join(", ", i.LinksUnloaded) + " — Manage Links → Reload хийвэл тэдгээрийг ч хэмжинэ.", true));
            if (i.LinkedElements > 0)
                r.Add(Note(i.LinkedElements + " элементийг холбосон файлаас (link: " + string.Join(", ", i.LinkNames)
                    + ") уншсан — хэмжээс, tag нь link-ийн элементэд холбогдоно.", false));
            if (i.CutFallback)
                r.Add(Note("Харагдацын огтлолын хавтгайд (View Range → Cut Plane) хана таараагүй тул ханыг өөр өндрөөр огтолж уншлаа.", true));
            return r;
        }

        private static Border Note(string text, bool warn)
        {
            Border b = Ui.MglUi.Note(text, warn ? Ui.MglSeverity.Warn : Ui.MglSeverity.Info);
            b.Margin = new Thickness(0, 6, 0, 0);
            return b;
        }

        /// <summary>Хоёрдогч бичвэр: `Opacity` БИШ — `FgMuted` токен, ≥ 12 DIP.</summary>
        private static TextBlock Mute(TextBlock t)
        {
            t.FontSize = 12;
            t.SetResourceReference(TextBlock.ForegroundProperty, "FgMuted");
            return t;
        }

        private static string KindLabel(AaViewKind k)
        {
            switch (k)
            {
                case AaViewKind.Plan: return "план";
                case AaViewKind.Section: return "зүсэлт";
                case AaViewKind.Elevation: return "фасад";
                default: return "дэмжигдэхгүй";
            }
        }

        private static string FoundLine(AaViewInfo i)
        {
            var parts = new List<string>();
            if (i.Kind == AaViewKind.Plan)
            {
                if (i.Walls > 0) parts.Add(i.Walls + " хана (" + i.WallsExterior + " гадна)");
                if (i.Doors > 0) parts.Add(i.Doors + " хаалга");
                if (i.Windows > 0) parts.Add(i.Windows + " цонх");
                if (i.Columns > 0) parts.Add(i.Columns + " багана");
                if (i.Beams > 0) parts.Add(i.Beams + " дам нуруу");
                if (i.Rooms > 0) parts.Add(i.Rooms + " өрөө");
                if (i.Grids > 0) parts.Add(i.Grids + " тэнхлэг");
                if (i.CurtainWalls > 0) parts.Add(i.CurtainWalls + " шилэн хана (хэмжихгүй)");
            }
            else
            {
                if (i.Levels > 0) parts.Add(i.Levels + " түвшин");
                if (i.Grids > 0) parts.Add(i.Grids + " тэнхлэг");
                if (i.Doors > 0) parts.Add(i.Doors + " хаалга");
                if (i.Windows > 0) parts.Add(i.Windows + " цонх");
            }
            return parts.Count > 0 ? string.Join(", ", parts) : "хэмжих элемент алга";
        }

        private static bool TryMm(TextBox tb, double min, double max, out double v)
        {
            return AaPlacement.TryParseMm(tb.Text, min, max, out v);
        }

        private bool Validate()
        {
            if (_rebar != null)
            {
                string bad = _rebar.Validate();
                if (bad != null)
                {
                    MessageBox.Show(this, bad, Title, MessageBoxButton.OK, MessageBoxImage.Warning);
                    return false;
                }
            }
            if (_ws != null)
            {
                string badWs = _ws.Validate();
                if (badWs != null)
                {
                    MessageBox.Show(this, badWs, Title, MessageBoxButton.OK, MessageBoxImage.Warning);
                    return false;
                }
            }
            if (!TryMm(_first, 3, 40, out _) || !TryMm(_step, 4, 30, out _))
            {
                MessageBox.Show(this, "Зай: эхний гинж 3–40 мм, гинж хооронд 4–30 мм байна.", Title, MessageBoxButton.OK, MessageBoxImage.Warning);
                return false;
            }
            return true;
        }

        /// <summary>
        /// Харагдсан хайрцгийн утга.  Энэ харагдацад боломжгүй (элемент алга) сонголтыг хэрэглэгч
        /// асаагаагүй бол хадгалсан тохиргоог хэвээр үлдээнэ — тэнхлэггүй харагдац нээснээс болж
        /// «тэнхлэгийн хэмжээс» тохиргоо бүрмөсөн унтрахгүй.
        /// </summary>
        private bool Dim(string key, bool fallback)
        {
            if (!_dims.TryGetValue(key, out CheckBox cb))
                return fallback;
            bool possible = !(cb.Tag is bool b) || b;
            if (!possible && cb.IsChecked != true)
                return fallback;
            return cb.IsChecked == true;
        }

        private bool TagOn(string key, bool fallback)
            => _tags.TryGetValue(key, out CheckBox cb) && cb.IsEnabled ? cb.IsChecked == true : fallback;

        /// <summary>Хадгалах тохиргоо — харагдацын төрлөөс хамааран харагдаагүй сонголт өмнөх утгаа хадгална.</summary>
        public AaOptions ToOptions()
        {
            AaOptions o = _o.Clone();
            o.GridDims = Dim("grid", o.GridDims);
            if (_gridChain != null) o.GridChain = _gridChain.IsChecked == true;
            o.FacadeDims = Dim("facade", o.FacadeDims);
            o.InteriorDims = Dim("interior", o.InteriorDims);
            o.DoorDims = Dim("door", o.DoorDims);
            o.ColumnTies = Dim("column", _info.Structural ? o.ColumnTiesStructural : o.ColumnTiesArchitectural);
            if (_dims.TryGetValue("column", out CheckBox colCb) && (!(colCb.Tag is bool cp) || cp || colCb.IsChecked == true))
            {
                if (_info.Structural) o.ColumnTiesStructural = o.ColumnTies;
                else o.ColumnTiesArchitectural = o.ColumnTies;
            }
            o.LevelDims = Dim("level", o.LevelDims);
            o.OpeningHeights = Dim("opening", o.OpeningHeights);
            o.AllSides = _place.IsAllSides;
            o.RightSide = _place.IsRightSide;
            o.ExtendGrids = _extendGrids.IsChecked == true;
            o.ReplacePrevious = _replace.IsChecked == true;
            o.OnlySelection = _selection.IsChecked == true;
            if (TryMm(_first, 3, 40, out double f)) o.FirstMm = f;
            if (TryMm(_step, 4, 30, out double s)) o.StepMm = s;
            // НЭГ сонголт — UniqueId (хоосон = файлын өгөгдмөл).
            o.DimensionTypeUid = _dimType.SelectedItem is ComboBoxItem ci && ci.Tag is string uid ? uid : "";
            // Tag: цонхонд харагдсан ангилал л өөрчлөгдөнө (энэ харагдацад элемент алга бол өмнөх утга).
            o.TagDoors = TagOn("doors", o.TagDoors);
            o.TagWindows = TagOn("windows", o.TagWindows);
            o.TagRooms = TagOn("rooms", o.TagRooms);
            o.TagWalls = TagOn("walls", o.TagWalls);
            o.TagColumns = TagOn("columns", o.TagColumns);
            o.TagFraming = TagOn("framing", o.TagFraming);
            if (_rebar != null)
            {
                o.Rebar = _rebar.ToOptions();
                o.Rebar.AlsoGeneral = _alsoGeneral.IsChecked == true;
            }
            else if (_ws != null && _wsOnly)
            {
                if (o.Rebar == null) o.Rebar = new AaRebarOptions();
                o.Rebar.AlsoGeneral = _alsoGeneral.IsChecked == true;
            }
            if (_ws != null) o.WallSlab = _ws.ToOptions();
            // Ерөнхий «Байрлал» = эх сурвалж: огтлол, хана-хучилт, дэлгээсийн зай/тал руу хуулна (хадгалагдах JSON ч нэг утгатай).
            o.ApplyPlacement();
            return o;
        }
    }
}
