using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Documents;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Shapes;
using RevitMcpAddin.Ui;
using RevitMcpAddin.WallElevation.Core;

namespace RevitMcpAddin.WallElevation.Ui
{
    /// <summary>
    /// «Ханын дэлгээс» — НЭГ цонх, урьдчилсан дүн ТӨВД:
    ///   • өрөө тус бүр жижиг ПЛАН (аль хана аль үсэг, хойд чиглэл) + мөр бүр checkbox (хасаж болно);
    ///   • баруун талд зөвхөн 3 гол тохиргоо (төрөл, загвар, масштаб) + гаралт; бусад нь «Нарийвчилсан» дотор хураалттай;
    ///   • товч нь яг хэд үүсэхийг хэлнэ («8 дэлгээс үүсгэх»).
    /// Тохиргоо солих бүрт ЦЭВЭР төлөвлөгчийг дахин ажиллуулна (Revit API дуудахгүй, загварт хүрэхгүй).
    /// Кодоор (XAML-гүй) — WPF-ийн хоёр алхамт эмхэтгэлд шинэ хуудас нэмэхгүйн тулд (repo-ийн бусад цонхтой ижил).
    /// </summary>
    internal sealed class WallElevationDialog : Window
    {
        private readonly Func<WeSettings, WePlan> _planner;
        private readonly IWeUnits _units;
        private readonly bool _hasWalls;

        private readonly ComboBox _viewKind = new ComboBox();
        private readonly ComboBox _viewType = new ComboBox();
        private readonly Func<WeViewKind, IList<string>> _viewTypesOf;
        private readonly ComboBox _template = new ComboBox();
        private readonly ComboBox _scale = new ComboBox { IsEditable = true };
        private readonly TextBox _padding = Num();
        private readonly TextBox _near = Num();
        private readonly TextBox _far = Num();
        private readonly TextBox _pattern = new TextBox { Padding = new Thickness(4, 2, 4, 2) };
        private readonly ComboBox _wallSide = new ComboBox();
        private readonly RadioButton _viewsOnly = new RadioButton { Content = "Зөвхөн харагдац", GroupName = "weout", Margin = new Thickness(0, 2, 0, 2) };
        private readonly RadioButton _viewsSheets = new RadioButton { Content = "Харагдац + хуудас (өрөө тус бүр)", GroupName = "weout", Margin = new Thickness(0, 2, 0, 2) };
        private readonly ComboBox _titleBlock = new ComboBox();
        // W02 (2026-10-16): бүх дэлгээс НЭГ хуудсанд — өрөө тус бүр шинэ хуудас (өгөгдмөл) эсвэл хэрэглэгчийн ИЛ сонгосон бэлэн хуудас.
        private readonly ComboBox _targetSheet = new ComboBox();
        private const string NewSheetPerRoom = "‹Өрөө тус бүр шинэ хуудас›";
        private readonly CheckBox _resetPlacement = new CheckBox { Content = "Дахин байрлуулах (өмнө үүсгэсэн хуудсыг шинээр зохиомжлох)", Margin = new Thickness(0, 6, 0, 0),
            ToolTip = "Зөвхөн энэ удаа: өмнө үүсгэсэн өрөөний хуудсан дээрх энэ хэрэгслийн зургийг (дэлгээс, түлхүүр план, 3D) дөрвөн бүсээр дахин байрлуулна." + Environment.NewLine
                      + "Сонгоогүй үед (өгөгдмөл) таны гараар зөөсөн байрлал, гарчиг, масштаб хөдлөхгүй — зөвхөн шинэ зураг сул зайд нэмэгдэнэ." + Environment.NewLine
                      + "Өөр хуудас руу зөөсөн зураг тэндээ үлдэнэ." };
        private readonly TextBox _sheetPattern = new TextBox { Padding = new Thickness(4, 2, 4, 2) };
        private readonly TextBox _sheetMargin = Num();
        private readonly CheckBox _update = new CheckBox { Content = "Өмнө үүсгэснийг шинэчлэх", Margin = new Thickness(0, 6, 0, 0) };
        private readonly CheckBox _hideMarkers = new CheckBox { Content = "Бусад дэлгээсийн тэмдгийг нуух", Margin = new Thickness(0, 4, 0, 0) };
        private readonly StackPanel _sheetPanel = new StackPanel { Margin = new Thickness(22, 2, 0, 0) };
        // Тэмдэглэгээ: «мөр:багана» → checkbox.
        private readonly Dictionary<string, CheckBox> _anno = new Dictionary<string, CheckBox>(StringComparer.Ordinal);
        private readonly ComboBox _dimType = new ComboBox();
        private readonly ComboBox _spotType = new ComboBox();
        private readonly ComboBox _keynoteType = new ComboBox();
        private readonly TextBox _annoOffset = Num();
        private readonly TextBox _annoStep = Num();
        private const string DefaultChoice = "‹Төслийн өгөгдмөл›";
        private readonly StackPanel _wallSidePanel = new StackPanel();
        // Хэвтээ хэмжээсийн эгнээ.
        private readonly CheckBox _separated = new CheckBox { Content = "Хэвтээ хэмжээс ангиллаар тусдаа", Margin = new Thickness(0, 8, 0, 0) };
        private readonly CheckBox _overall = new CheckBox { Content = "Нийт урт (хана → хана)", Margin = new Thickness(0, 4, 0, 0) };
        // Хуудасны нэмэлт блок.
        private readonly CheckBox _keyPlan = new CheckBox { Content = "Түлхүүр байгуулалт (план)", Margin = new Thickness(0, 6, 0, 0), ToolTip = "Өрөөний план: хил тодруулсан, тал бүрийн тэмдэг («205A»), зүүн дээд буланд" };
        private readonly CheckBox _axon = new CheckBox { Content = "3D харагдах байдал", Margin = new Thickness(0, 4, 0, 0), ToolTip = "Өрөөг тааз доогуур, харагч талын ханыг тайрсан изометр зураг (түлхүүр планы доор)" };
        private readonly ComboBox _persp = new ComboBox();
        // Legend олноор (2026-10-14, интерьерийн баг): нэр → чагт, төслийн дарааллаар.
        private readonly List<CheckBox> _legendChecks = new List<CheckBox>();
        private readonly StackPanel _legendList = new StackPanel();
        // 3-р тойрог (2026-10-14): legend-ийг нэр, таних тэмдгээр («ЗХ-01-С») шууд хайх.
        private readonly Dictionary<string, WeLegendInfo> _legendInfo = new Dictionary<string, WeLegendInfo>(StringComparer.Ordinal);
        private readonly TextBox _legendSearch = new TextBox { Padding = new Thickness(4, 2, 4, 2) };
        private readonly TextBlock _legendCount = new TextBlock { Margin = new Thickness(0, 2, 0, 0), TextWrapping = TextWrapping.Wrap };
        // 3-р тойрог: тод / бүдэг хэсэг, улаан хүрээ, рендерийн байрлал, «* Type Designator».
        private readonly ComboBox _fadeMode = new ComboBox();
        private readonly TextBox _fadeHeight = Num();
        private readonly TextBox _fadeOpacity = Num();
        private readonly CheckBox _redFrame = new CheckBox { Content = "Улаан тасархай хүрээ (дэлгээс, түлхүүр план)", Margin = new Thickness(0, 8, 0, 0),
                                                             ToolTip = "Дэлгээс бүр, түлхүүр планыг бөөрөнхий өнцөгтэй улаан тасархай зураасаар хүрээлнэ (жишээ хуудас 232/238)" };
        private readonly ComboBox _renderPlace = new ComboBox();
        private readonly ComboBox _typeDesignator = new ComboBox { IsEditable = true, IsTextSearchEnabled = true, StaysOpenOnEdit = true };
        private const string NoWrite = "‹Бичихгүй›";
        private readonly WeSheetParamChoice _typeChoice;
        // Нарийвчилсан: тал, гүн, тэмдэг.
        private readonly CheckBox _merge = new CheckBox { Content = "Нэг шулуун дээрх хана → нэг дэлгээс", Margin = new Thickness(0, 6, 0, 0), ToolTip = "Өрөөний нэг талын хэд хэдэн хана, дундах багана, гүехэн ниш/пилястр (≤ 1 м) нэг дэлгээс болно" };
        private readonly ComboBox _depthMode = new ComboBox();
        private readonly TextBox _maxDepth = Num();
        private readonly TextBox _labelPattern = new TextBox { Padding = new Thickness(4, 2, 4, 2) };
        private readonly TextBox _titlePattern = new TextBox { Padding = new Thickness(4, 2, 4, 2) };
        private readonly TextBox _sheetName = new TextBox { Padding = new Thickness(4, 2, 4, 2) };
        // W03 (2026-10-16): масштаб бүр ТУСДАА, үндсэн тохиргоонд (өмнө нь «Нарийвчилсан» дотор нуугдаж, хуудсанд багтаахаар солигддог байв).
        private readonly ComboBox _keyScale = new ComboBox { IsEditable = true };
        private readonly ComboBox _axonScale = new ComboBox { IsEditable = true };
        private readonly TextBox _bottomBand = Num();
        // W05 (2026-10-16): дугаарлалт — тэмдэг (үсэг/тоо, муж, орон, тасралтгүй) ба шинэ хуудасны дугаар (загвар/муж).
        private readonly ComboBox _labelMode = new ComboBox();
        private readonly TextBox _labelStart = Num();
        private readonly TextBox _labelEnd = Num();
        private readonly TextBox _labelDigits = Num();
        private readonly CheckBox _labelContinuous = new CheckBox { Content = "Багц даяар тасралтгүй (өрөө тус бүр дахин эхлэхгүй)", Margin = new Thickness(0, 6, 0, 0) };
        private readonly ComboBox _sheetMode = new ComboBox();
        private readonly TextBox _sheetPrefix = new TextBox { Padding = new Thickness(4, 2, 4, 2) };
        private readonly TextBox _sheetStart = Num();
        private readonly TextBox _sheetEnd = Num();
        private readonly TextBox _sheetDigits = Num();
        private readonly TextBlock _numberingPreview = new TextBlock { TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 6, 0, 0) };
        private readonly Func<WePlan, WeSettings, ICollection<string>, WeNumberingResult> _numbering;
        private WeNumberingResult _lastNumbering;

        private readonly StackPanel _preview = new StackPanel { Margin = new Thickness(2, 0, 6, 0) };
        private readonly TextBlock _summary = new TextBlock { TextWrapping = TextWrapping.Wrap, FontSize = 13, VerticalAlignment = VerticalAlignment.Center };
        private readonly TextBlock _headline = new TextBlock { TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 2, 0, 0) };
        private readonly Button _generate = new Button { Content = "Үүсгэх", MinWidth = 150, Padding = new Thickness(14, 5, 14, 5), Margin = new Thickness(8, 0, 0, 0), IsDefault = true };
        private readonly Button _cancel = new Button { Content = "Болих", MinWidth = 90, Padding = new Thickness(12, 5, 12, 5), Margin = new Thickness(8, 0, 0, 0), IsCancel = true };
        // «Санал хүсэлт» (2026-10-16): програм хариуцагчид алдаа/санал — цонх нь Revit-гүй (UiSmoke) тул callback-аар.
        private readonly Button _feedback = new Button { Content = "Санал хүсэлт", MinWidth = 110, Padding = new Thickness(12, 5, 12, 5), Margin = new Thickness(0, 0, 8, 0), Visibility = Visibility.Collapsed };
        private Action _feedbackRequested;

        /// <summary>«Санал хүсэлт» товчны үйлдэл (тохиргооны хураангуй, өрөөний тоо оношилгоонд орно).  Тавигдсан үед л товч харагдана.</summary>
        public Action FeedbackRequested
        {
            get { return _feedbackRequested; }
            set { _feedbackRequested = value; _feedback.Visibility = value != null ? Visibility.Visible : Visibility.Collapsed; }
        }
        // 2026-10-14 (интерьерийн баг: «олон өрөө сонгоход 1 л гардаг»): цонхыг түр хааж өөр өрөө нэмж сонгоно — тохиргоо хадгалагдана.
        private readonly Button _addRooms = new Button { Content = "+ Өрөө нэмэх", Padding = new Thickness(12, 5, 12, 5), Margin = new Thickness(0, 0, 0, 0) };

        /// <summary>«+ Өрөө нэмэх» дарсан — workflow өрөө нэмж сонгуулаад цонхыг ДАХИН нээнэ (тохиргоо, хассан/хүчилсэн мөр, тохируулсан шугам хэвээр).</summary>
        public bool AddRoomsRequested { get; private set; }

        /// <summary>W06: «Өмнөх үр дүн…» дарсан — цонх хаагдаад баримтын үүсгэсэн бүх дэлгээсийн хөтөч нээгдэнэ (юу ч үүсгэхгүй).</summary>
        public bool ResultsRequested { get; private set; }
        private readonly Button _results = new Button { Content = "Өмнөх үр дүн…", Padding = new Thickness(12, 5, 12, 5), Margin = new Thickness(0, 0, 8, 0) };


        private readonly HashSet<string> _excluded = new HashSet<string>(StringComparer.Ordinal);
        /// <summary>«Үүсэхгүй» мөрийг хэрэглэгч чагтлаж хүчээр үүсгэх (2026-10-14) — <see cref="WeSettings.Forced"/>.</summary>
        private readonly HashSet<string> _forced = new HashSet<string>(StringComparer.Ordinal);

        // ── 2026-10-14: засварлах план + доод талын урьдчилсан зураг ──
        /// <summary>Хэрэглэгчийн тохируулсан дэлгээсийн байрлал (түлхүүр → шугам) — төлөвлөгч рүү <see cref="WeSettings.Overrides"/>.</summary>
        private readonly WeOverrides _overrides = new WeOverrides();
        /// <summary>W07: дэлгээс тус бүрийн босоо хүрээ (түлхүүр → доод/дээд мм) — төлөвлөгч рүү <see cref="WeSettings.Crops"/>.</summary>
        private readonly WeCropOverrides _crops = new WeCropOverrides();
        // ── W09: зориулалт (өрөө тус бүрд) ──
        private readonly ComboBox _defaultPreset = new ComboBox();
        private readonly TextBlock _presetCaption = new TextBlock { TextWrapping = TextWrapping.Wrap, FontWeight = FontWeights.SemiBold, Margin = new Thickness(0, 8, 0, 2) };
        private readonly TextBlock _presetInfo = new TextBlock { TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 0, 0, 4), FontSize = 11 };
        private readonly Button _presetReset = new Button { Content = "↺ Суурь утга", Padding = new Thickness(8, 1, 8, 1), HorizontalAlignment = HorizontalAlignment.Left, Margin = new Thickness(0, 0, 0, 4) };
        private readonly Dictionary<string, string> _roomPresets = new Dictionary<string, string>(StringComparer.Ordinal);
        /// <summary>Доорх зориулалтын удирдлагууд (загвар, тод/бүдэг, тэмдэглэгээ, түлхүүр план, 3D, рендерийн байр) ЗАСАЖ БУЙ зориулалт = сонгосон өрөөнийх.</summary>
        private string _editPreset = WePresetId.Custom;
        private Expander _annoExpander;
        private string _selectedKey;
        private readonly Func<WePlannedElevation, WeSettings, IWePreviewJob> _render;
        // Алхам алхмаар бэлтгэж буй урьдчилсан зураг (2026-10-14, «цонх огт гацахгүй») — нэг зэрэг ганц.
        private IWePreviewJob _job;
        private string _jobKey;
        private Border _previewFrame;
        private Button _previewRefresh;
        private GridSplitter _previewSplitter;
        /// <summary>Нуухаас өмнөх өндөр (splitter-ээр тохируулсан) — дахин харуулахад сэргээнэ.</summary>
        private GridLength _previewHeight = new GridLength(1, GridUnitType.Star);
        private readonly Image _previewImage = new Image { Stretch = Stretch.Uniform, StretchDirection = StretchDirection.DownOnly };
        private readonly TextBlock _previewStatus = new TextBlock { TextWrapping = TextWrapping.Wrap, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(12) };
        private readonly TextBlock _previewTitle = new TextBlock { FontWeight = FontWeights.SemiBold, VerticalAlignment = VerticalAlignment.Center };
        private readonly CheckBox _previewOn = new CheckBox { Content = "Урьдчилсан зураг", IsChecked = true, VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(0, 0, 12, 0),
                                                              ToolTip = "Сонгосон дэлгээсийг жинхэнэ Revit-ээр түр үүсгэж зургийг нь харуулна (загварт юу ч үлдэхгүй)" };
        private readonly RowDefinition _previewRow = new RowDefinition { Height = new GridLength(1, GridUnitType.Star), MinHeight = 0 };
        private readonly System.Windows.Threading.DispatcherTimer _renderTimer = new System.Windows.Threading.DispatcherTimer { Interval = TimeSpan.FromMilliseconds(450) };
        private readonly Dictionary<string, WePreviewResult> _renderCache = new Dictionary<string, WePreviewResult>(StringComparer.Ordinal);
        private string _shownRenderKey;
        private WePlan _plan;
        private bool _loading = true;
        // Ажлын зургийн бүрдэл (Project Browser-ийн бүлэг, 2026-10-14) — түвшин бүрд нэг жагсаалт (бичигдэхгүй түвшинд null).
        private readonly WeSheetFolders _folders;
        private readonly List<ComboBox> _folderBoxes = new List<ComboBox>();
        private readonly TextBlock _folderPath = new TextBlock { TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 6, 0, 2) };
        private bool _folderFilling;

        public WeSettings Settings { get; private set; }

        /// <summary>Хэрэглэгчийн хассан дэлгээсийн түлхүүр.</summary>
        public ICollection<string> ExcludedKeys { get { return _excluded; } }

        public WallElevationDialog(WeSettings initial, IList<string> viewTypes, IList<string> templates, IList<string> titleBlocks,
                                   int roomCount, int wallCount, Func<WeSettings, WePlan> planner, IWeUnits units,
                                   IList<string> dimTypes = null, IList<string> spotTypes = null, IList<string> keynoteTypes = null,
                                   IList<WeLegendInfo> legends = null, Func<WeViewKind, IList<string>> viewTypesOf = null,
                                   string autoTemplateLabel = null, Func<WePlannedElevation, WeSettings, IWePreviewJob> render = null,
                                   WeSheetFolders sheetFolders = null, bool canAddRooms = false, ICollection<string> excludedKeys = null,
                                   WeSheetParamChoice typeDesignator = null, IList<string> sheetChoices = null,
                                   Func<WePlan, WeSettings, ICollection<string>, WeNumberingResult> numbering = null)
        {
            _numbering = numbering;
            _render = render;
            _folders = sheetFolders;
            _typeChoice = typeDesignator;
            _planner = planner;
            _viewTypesOf = viewTypesOf;
            _units = units;
            _hasWalls = wallCount > 0;
            Settings = initial.Clone();
            // «+ Өрөө нэмэх»-ээс дахин нээгдэхэд өмнөх сонголт (хассан, хүчилсэн мөр, тохируулсан шугам) хэвээр.
            if (excludedKeys != null) foreach (string k in excludedKeys) _excluded.Add(k);
            if (Settings.Forced != null) foreach (string k in Settings.Forced) _forced.Add(k);
            if (Settings.Overrides != null) foreach (KeyValuePair<string, WeSideOverride> kv in Settings.Overrides) if (kv.Value != null) _overrides[kv.Key] = kv.Value.Clone();
            if (Settings.Crops != null) foreach (KeyValuePair<string, WeCropOverride> kv in Settings.Crops) if (kv.Value != null) _crops[kv.Key] = kv.Value.Clone();
            if (Settings.RoomPresets != null) foreach (KeyValuePair<string, string> kv in Settings.RoomPresets) if (WePresetId.IsKnown(kv.Value)) _roomPresets[kv.Key] = kv.Value;
            _editPreset = WePresetId.IsKnown(Settings.DefaultPreset) ? Settings.DefaultPreset : WePresetId.Custom;

            MglWindow.Setup(this, Settings.InteriorTool ? "MGL — Ханын дэлгээс (Интерьер)" : "MGL — Ханын дэлгээс", 1280, 900, 900, 600, "wall-elevations");
            // Интерьерийн хэрэгсэл (2026-10-14): хуудасны бүлэглэлтийн түвшин нь тогтмол параметр («* Classification» …) бол утгыг нь түгжинэ.
            if (_folders != null && Settings.FixedSheetParams != null && Settings.FixedSheetParams.Count > 0)
                for (int i = 0; i < _folders.Levels.Count; i++)
                {
                    string fixedValue = WeSheetDiscipline.ValueFor(Settings.FixedSheetParams, _folders.Levels[i].Name);
                    if (fixedValue == null) continue;
                    while (_folders.Default.Count <= i) _folders.Default.Add(string.Empty);
                    _folders.Default[i] = fixedValue;
                }
            MglTheme.Apply(this);

            var root = new Grid { Margin = new Thickness(16, 12, 16, 12) };
            root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            root.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
            root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            root.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            root.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(350) });

            // ── Толгой ──────────────────────────────────────────────
            var head = new StackPanel { Margin = new Thickness(0, 0, 0, 10) };
            head.Children.Add(MglUi.Heading("Ханын дэлгээс"));
            _headline.SetResourceReference(TextBlock.ForegroundProperty, "FgMuted");
            head.Children.Add(_headline);
            Grid.SetColumnSpan(head, 2);
            root.Children.Add(head);

            // ── Урьдчилсан дүн (төвд) ───────────────────────────────
            var prevBorder = new Border { BorderThickness = new Thickness(1), CornerRadius = new CornerRadius(4), Padding = new Thickness(8, 4, 4, 8) };
            prevBorder.SetResourceReference(Border.BorderBrushProperty, "Line");
            prevBorder.Child = new ScrollViewer { Content = _preview, VerticalScrollBarVisibility = ScrollBarVisibility.Auto, HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled };
            MglAuto.Name(prevBorder, "Урьдчилсан дүн");
            // 2026-10-14: доор нь жинхэнэ дэлгээсийн урьдчилсан зураг (splitter-ээр хэмжээ, «Урьдчилсан зураг» чагтаар нуух).
            var left = new Grid();
            left.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star), MinHeight = 160 });
            left.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            left.RowDefinitions.Add(_previewRow);
            left.Children.Add(prevBorder);
            var splitter = new GridSplitter { Height = 6, HorizontalAlignment = HorizontalAlignment.Stretch, VerticalAlignment = VerticalAlignment.Center, ResizeDirection = GridResizeDirection.Rows, Background = Brushes.Transparent, Cursor = Cursors.SizeNS };
            _previewSplitter = splitter;
            Grid.SetRow(splitter, 1);
            left.Children.Add(splitter);
            UIElement shot = PreviewPanel();
            Grid.SetRow(shot, 2);
            left.Children.Add(shot);
            Grid.SetRow(left, 1);
            root.Children.Add(left);

            // ── Тохиргоо (баруун) ───────────────────────────────────
            var form = new StackPanel { Margin = new Thickness(14, 0, 0, 0) };
            Fill(_viewKind, new[] { "Elevation — маркер (View → Elevation)", "Section — зүсэлт" }, null);
            _viewKind.SelectedIndex = Settings.ViewKind == WeViewKind.Section ? 1 : 0;
            _viewKind.ToolTip = "Elevation: өрөөнд Revit-ийн Elevation маркер (тэгш өнцөгт өрөөнд нэг маркер 4 сумтай), огтлохгүй — түлхүүр план дээрх "
                                + "тэмдэг viewport-ийн дугаар, хуудсыг өөрөө харуулна.  Section: 2026-10-06 хүртэлх зүсэлт.";
            // Эхний мөр = хэрэгслийн өөрийн «Ханын дэлгээс» төрөл (тохиргоонд хоосон нэр).
            Fill(_viewType, viewTypes, string.IsNullOrWhiteSpace(Settings.ViewTypeName) && viewTypes.Count > 0 ? viewTypes[0] : Settings.ViewTypeName);
            var tpl = new List<string> { string.IsNullOrEmpty(autoTemplateLabel) ? "‹Төрлийн өгөгдмөл›" : autoTemplateLabel, "‹Загваргүй›" };
            tpl.AddRange(templates);
            Fill(_template, tpl, Settings.TemplateName == WeSettings.TemplateNone ? tpl[1]
                : string.IsNullOrEmpty(Settings.TemplateName) ? tpl[0] : Settings.TemplateName);
            foreach (int sc in new[] { 20, 25, 50, 100 }) _scale.Items.Add(sc.ToString(CultureInfo.InvariantCulture));
            _scale.Text = Settings.Scale.ToString(CultureInfo.InvariantCulture);
            _padding.Text = Fmt(Settings.PaddingMm);
            _near.Text = Fmt(Settings.NearOffsetMm);
            _far.Text = Fmt(Settings.FarDepthMm);
            _pattern.Text = Settings.NamePattern;
            Fill(_wallSide, new[] { "Гадна талаас", "Дотор талаас", "Хоёр талаас" }, null);
            _wallSide.SelectedIndex = (int)Settings.WallSide;
            _viewsOnly.IsChecked = Settings.Output == WeOutputMode.ViewsOnly;
            _viewsSheets.IsChecked = Settings.Output == WeOutputMode.ViewsAndSheets;
            Fill(_titleBlock, titleBlocks, Settings.TitleBlockName);
            var sheetList = new List<string> { NewSheetPerRoom };
            if (sheetChoices != null) sheetList.AddRange(sheetChoices);
            Fill(_targetSheet, sheetList, NewSheetPerRoom);
            _targetSheet.ToolTip = "Өгөгдмөл: өрөө тус бүр НЭГ шинэ хуудас — бүх дэлгээс, түлхүүр план, 3D, legend, рендерийн байр тэр хуудсанд (багтахгүй ч гэсэн;" + Environment.NewLine
                                   + "үргэлжлэлийн хуудас үүсгэхгүй, масштаб хэвээр).  Бэлэн хуудас сонговол бүх өрөөний шинэ зургийг тэр хуудасны сул зайд тавина.";
            _resetPlacement.IsChecked = false;
            _sheetPattern.Text = Settings.SheetNumberPattern;
            _sheetMargin.Text = Fmt(Settings.SheetMarginMm);
            _update.IsChecked = Settings.UpdateExisting;
            _hideMarkers.IsChecked = Settings.HideOtherMarkers;
            _keyPlan.IsChecked = Settings.KeyPlan;
            _axon.IsChecked = Settings.Axon;
            Fill(_persp, new[] { "Үгүй", "1", "2", "3", "4" }, null);
            _persp.SelectedIndex = Math.Max(0, Math.Min(4, Settings.Perspectives));
            Fill(_renderPlace, new[] { "Сүүлийн хуудсанд (багтахгүй бол сүүлээсээ 2 дахь)", "Хуудас бүрт" }, null);
            _renderPlace.SelectedIndex = Settings.RenderPlacement == WeRenderPlacement.AllSheets ? 1 : 0;
            _renderPlace.ToolTip = "Перспектив / рендер зургийн байр хуудасны ДООД мөрөнд.  Сүүлийн хуудсанд багтахгүй бол сүүлээсээ 2 дахь хуудсанд, "
                                   + "тэнд ч үгүй бол хоёуланд хувааж, эцэст нь тусдаа хуудсанд — хэзээ ч алга болохгүй (тайланд хаана орсныг хэлнэ).";
            Fill(_fadeMode, new[] { "Тааз хүртэл тод · дээш нь бүдэг", "Өгсөн өндөр хүртэл тод · дээш нь бүдэг", "Бүгд тод (бүдэгрүүлэхгүй)" }, null);
            _fadeMode.SelectedIndex = Settings.FadeMode == WeFadeMode.AboveHeight ? 1 : Settings.FadeMode == WeFadeMode.None ? 2 : 0;
            _fadeMode.ToolTip = "Жишээ хуудас 232: таазнаас дээд хучилт хүртэлх хэсэг бүдэг (opacity 20 %), өрөө тод.  Урьдчилсан зурагт шууд харагдана.";
            _fadeHeight.Text = Fmt(Settings.FadeHeightMm);
            _fadeHeight.ToolTip = "Тод хэсгийн өндөр — шалны дээд нүүрнээс, загварын мм (жишээ 2700).";
            _fadeOpacity.Text = Settings.FadeOpacity.ToString(CultureInfo.InvariantCulture);
            _fadeOpacity.ToolTip = "Бүдэг хэсэг хэдэн хувь харагдах вэ: 20 = 20 % (интерьерийн жишиг), 0 = бүрэн далд, 100 = бүдэгрүүлэхгүй.";
            _redFrame.IsChecked = Settings.RedFrame;
            FillLegends(legends);
            _merge.IsChecked = Settings.MergeCollinear;
            Fill(_depthMode, new[] { "Өрөөний дунд хүртэл (тавилга харагдана)", "Тогтмол — «Ханаас өмнө, мм»" }, null);
            _depthMode.SelectedIndex = Settings.DepthMode == WeDepthMode.Fixed ? 1 : 0;
            _maxDepth.Text = Fmt(Settings.MaxDepthMm);
            _labelPattern.Text = Settings.LabelPattern;
            _titlePattern.Text = Settings.TitlePattern;
            _sheetName.Text = Settings.SheetNamePattern;
            foreach (int sc in new[] { 25, 50, 75, 100, 125, 150, 200 }) _keyScale.Items.Add(sc.ToString(CultureInfo.InvariantCulture));
            foreach (int sc in new[] { 20, 25, 50, 75, 100, 150 }) _axonScale.Items.Add(sc.ToString(CultureInfo.InvariantCulture));
            _keyScale.Text = Settings.KeyPlanScale.ToString(CultureInfo.InvariantCulture);
            _axonScale.Text = Settings.AxonScale.ToString(CultureInfo.InvariantCulture);
            _scale.ToolTip = "Дэлгээсийн масштаб — үүсгэх, дахин ажиллуулахад ЯГ хэвээр (хуудсанд багтаахаар хэрэгсэл өөрчлөхгүй).";
            _keyScale.ToolTip = "Түлхүүр планы масштаб — сонгосон утгаараа (өрөө том бол хуудаснаас хальж болно — тайланд «байрлуулж цэгцлэх»).";
            _axonScale.ToolTip = "3D харагдах байдлын масштаб — сонгосон утгаараа.  Revit-д гараар сольсон масштабыг дахин ажиллуулахад хадгална.";
            _bottomBand.Text = Fmt(Settings.SheetBottomBandMm);
            Fill(_labelMode, new[] { "Үсгээр (A, B, C …)", "Тоогоор (1, 2, 3 …)" }, null);
            _labelMode.SelectedIndex = Settings.LabelMode == WeLabelMode.Numbers ? 1 : 0;
            _labelStart.Text = Settings.LabelStart.ToString(CultureInfo.InvariantCulture);
            _labelEnd.Text = Settings.LabelEnd.ToString(CultureInfo.InvariantCulture);
            _labelDigits.Text = Settings.LabelDigits.ToString(CultureInfo.InvariantCulture);
            _labelContinuous.IsChecked = Settings.LabelContinuous;
            _labelEnd.ToolTip = "Тоон тэмдгийн дээд хязгаар (0 = хязгааргүй).  Хүрэлцэхгүй бол үүсгэхээс ӨМНӨ засуулна — хуурамч дэлгээс, хоосон хуудас үүсгэхгүй.";
            _labelContinuous.ToolTip = "Өгөгдмөл: өрөө тус бүр A-аас (1-ээс) эхэлж тэмдэгт өрөөний дугаар орно («205A»).  Сонговол сонгосон бүх өрөө нэг цуваа.";
            Fill(_sheetMode, new[] { "Загвараар (давхардвал «-2»)", "Мужаар (угтвар + эхлэх–дуусах)" }, null);
            _sheetMode.SelectedIndex = Settings.SheetNumberMode == WeSheetNumberMode.Range ? 1 : 0;
            _sheetPrefix.Text = Settings.SheetRangePrefix ?? string.Empty;
            _sheetStart.Text = Settings.SheetRangeStart.ToString(CultureInfo.InvariantCulture);
            _sheetEnd.Text = Settings.SheetRangeEnd.ToString(CultureInfo.InvariantCulture);
            _sheetDigits.Text = Settings.SheetRangeDigits.ToString(CultureInfo.InvariantCulture);
            _sheetMode.ToolTip = "Мужаар: угтвар + [эхлэх … дуусах] доторх СУЛ дугаар (бусдын хуудсыг дугаарлахгүй).  Хүрэлцэхгүй бол үүсгэхээс ӨМНӨ засуулна — мужаас хэтрэхгүй.";

            // ── W09: зориулалт — нэг хэрэгсэл интерьер, архитектурт; өрөө бүр өөрийн зориулалттай (нууц түгжээгүй, харагдана) ──
            form.Children.Add(new TextBlock { Text = "Зориулалт", FontWeight = FontWeights.SemiBold, Margin = new Thickness(0, 0, 0, 0) });
            foreach (string id in WePresetId.All) _defaultPreset.Items.Add(WePresetCatalog.Title(id) + (id == WePresetId.Custom ? " (таны тохиргоо)" : string.Empty));
            _defaultPreset.SelectedIndex = Math.Max(0, Array.IndexOf(WePresetId.All, WePresetId.IsKnown(Settings.DefaultPreset) ? Settings.DefaultPreset : WePresetId.Custom));
            _defaultPreset.ToolTip = "Өрөө бүрт өөрөөр сонгоогүй бол энэ зориулалт.  «Тусгай» = таны тохиргоо (өмнөх зан төлөв); «Интерьер» товч → Интерьер." + Environment.NewLine
                                     + "Ариун цэврийн өрөөг (нэр, сантехникийн хэрэгслээр) таньж санал болгоно — «Тусгай» өгөгдмөл үед зөвхөн санал (автоматаар солихгүй)." + Environment.NewLine
                                     + "Өрөө бүрийн зориулалтыг зүүн талын жагсаалтад сольж болно.";
            Row(form, "Өгөгдмөл зориулалт", _defaultPreset);
            MglAuto.Name(_presetCaption, "Засаж буй зориулалт");
            form.Children.Add(_presetCaption);
            _presetInfo.SetResourceReference(TextBlock.ForegroundProperty, "FgMuted");
            form.Children.Add(_presetInfo);
            _presetReset.ToolTip = "Энэ зориулалтыг суурь утга руу буцаана (тэмдэглэгээ, тод/бүдэг, түлхүүр план, 3D, рендерийн байр, загвар).";
            MglAuto.Name(_presetReset, "Зориулалтыг суурь утга руу");
            _presetReset.Click += (s, e) => { Settings.SetPreset(WePresetCatalog.BuiltIn(_editPreset)); LoadPresetControls(_editPreset); Replan(); };
            form.Children.Add(_presetReset);

            Row(form, "Дэлгээсийн хэлбэр", _viewKind);
            Row(form, "Харагдацын төрөл", _viewType);
            Row(form, "Загвар (view template) — зориулалтын", _template);
            Row(form, "Масштаб  1 :", _scale);
            form.Children.Add(Pair("Түлхүүр планы масштаб 1:", _keyScale, "3D масштаб 1:", _axonScale));
            // 3-р тойрог (2026-10-14, интерьерийн баг): аль хэсэг тод, аль нь бүдэг (opacity), улаан хүрээ — үүсгэхдээ шууд.
            form.Children.Add(Caption("Тод / бүдэг хэсэг"));
            MglAuto.Name(_fadeMode, "Тод бүдэг хэсэг");
            form.Children.Add(_fadeMode);
            form.Children.Add(Pair("Тод хэсгийн өндөр, мм", _fadeHeight, "Бүдэг хэсэг харагдах, %", _fadeOpacity));
            form.Children.Add(_redFrame);
            if (_hasWalls)
            {
                Row(_wallSidePanel, "Сонгосон ханыг", _wallSide);
                form.Children.Add(_wallSidePanel);
            }
            form.Children.Add(Caption("Гаралт"));
            form.Children.Add(_viewsOnly);
            form.Children.Add(_viewsSheets);
            Row(_sheetPanel, "Хүрээний хуудас", _titleBlock);
            Row(_sheetPanel, "Хуудасны дугаар", _sheetPattern);
            Row(_sheetPanel, "Байршлын хуудас", _targetSheet);
            _sheetPanel.Children.Add(_resetPlacement);
            if (Settings.InteriorTool && Settings.FixedSheetParams != null && Settings.FixedSheetParams.Count > 0)
            {
                TextBlock fixedNote = Muted("Интерьер товч: «Тусгай», «Интерьер», «Ариун цэврийн өрөө» зориулалттай өрөөний хуудсанд " + WeSheetDiscipline.Describe(Settings.FixedSheetParams)
                                            + " автоматаар бичигдэнэ («Архитектур» өрөөнд бичихгүй).", 0);
                fixedNote.Margin = new Thickness(0, 8, 0, 0);
                MglAuto.Name(fixedNote, "Интерьерийн ангилал");
                _sheetPanel.Children.Add(fixedNote);
            }
            _sheetPanel.Children.Add(FolderPanel());
            _sheetPanel.Children.Add(TypeDesignatorPanel());
            _sheetPanel.Children.Add(_keyPlan);
            _sheetPanel.Children.Add(_axon);
            Row(_sheetPanel, "Перспективын байр", _persp);
            Row(_sheetPanel, "Перспективын байрын хуудас", _renderPlace);
            _sheetPanel.Children.Add(LegendPanel());
            form.Children.Add(_sheetPanel);

            var annoExpander = new Expander { Header = "Тэмдэглэгээ", Content = AnnotationPanel(dimTypes, spotTypes, keynoteTypes), IsExpanded = true, Margin = new Thickness(0, 12, 0, 0) };
            MglAuto.Name(annoExpander, "Тэмдэглэгээ");
            _annoExpander = annoExpander;
            form.Children.Add(annoExpander);

            var num = new StackPanel { Margin = new Thickness(0, 4, 0, 0) };
            Row(num, "Тэмдэг (хуудас, түлхүүр план)", _labelMode);
            var labelRow = new Grid { Margin = new Thickness(0, 6, 0, 0) };
            for (int c = 0; c < 5; c++) labelRow.ColumnDefinitions.Add(new ColumnDefinition { Width = c % 2 == 1 ? new GridLength(6) : new GridLength(1, GridUnitType.Star) });
            AddCell(labelRow, 0, "Эхлэх", _labelStart);
            AddCell(labelRow, 2, "Дуусах (0 = ∞)", _labelEnd);
            AddCell(labelRow, 4, "Орон", _labelDigits);
            num.Children.Add(labelRow);
            num.Children.Add(_labelContinuous);
            Row(num, "Шинэ хуудасны дугаар", _sheetMode);
            Row(num, "Угтвар", _sheetPrefix);
            var sheetRow = new Grid { Margin = new Thickness(0, 6, 0, 0) };
            for (int c = 0; c < 5; c++) sheetRow.ColumnDefinitions.Add(new ColumnDefinition { Width = c % 2 == 1 ? new GridLength(6) : new GridLength(1, GridUnitType.Star) });
            AddCell(sheetRow, 0, "Эхлэх", _sheetStart);
            AddCell(sheetRow, 2, "Дуусах", _sheetEnd);
            AddCell(sheetRow, 4, "Орон", _sheetDigits);
            num.Children.Add(sheetRow);
            num.Children.Add(_numberingPreview);
            MglAuto.Name(_numberingPreview, "Дугаарлалтын урьдчилсан дүн");
            bool numCustom = Settings.LabelMode != WeLabelMode.Letters || Settings.LabelContinuous || Settings.SheetNumberMode != WeSheetNumberMode.Pattern;
            var numExpander = new Expander { Header = "Дугаарлалт", Content = num, IsExpanded = numCustom, Margin = new Thickness(0, 12, 0, 0) };
            MglAuto.Name(numExpander, "Дугаарлалт");
            form.Children.Add(numExpander);

            var adv = new StackPanel { Margin = new Thickness(0, 4, 0, 0) };
            adv.Children.Add(Pair("Хүрээний зай, мм", _padding, "Ханаас өмнө, мм", _near));
            adv.Children.Add(Pair("Ханын ард, мм", _far, "Хуудасны дотор зай, мм", _sheetMargin));
            adv.Children.Add(Pair("Хэмжээс хүрээнээс, мм", _annoOffset, "Дараагийн эгнээ хүртэл, мм", _annoStep));
            _annoOffset.ToolTip = "Хүрээнээс эхний хэмжээсийн эгнээ хүртэл — загварын мм (1:50-д 300 мм = цаасан дээр 6 мм).  Spot level-ийн leader мөн энэ зайд.";
            _annoStep.ToolTip = "Өмнөх эгнээнээс дараагийн эгнээ хүртэл — загварын мм (300 → 300, 600, 900 …).";
            adv.Children.Add(_merge);
            Row(adv, "Харах гүн", _depthMode);
            adv.Children.Add(Pair("Гүний дээд хязгаар, мм", _maxDepth, "Хуудасны доод зурвас, мм", _bottomBand));
            Row(adv, "Нэрийн загвар", _pattern);
            Row(adv, "Тэмдэг (хуудас, түлхүүр план)", _labelPattern);
            Row(adv, "Гарчиг (Title on Sheet)", _titlePattern);
            Row(adv, "Хуудасны нэр", _sheetName);
            TextBlock hint = MglUi.Muted("{Level} {Room} {RoomNumber} {RoomName} {Side} {Wall} {WallIndex} {Type} {SideRange}.  Жишээ: тэмдэг «{Room}{Side}» → 205A, хуудас «… /{Room}{SideRange}/» → 205A-F.  "
                                       + "Нэр зөвхөн харагдана — дахин ажиллуулахад харагдацыг далд түлхүүрээр танина, таны сольсон нэр, гарчгийг хөндөхгүй.");
            hint.TextWrapping = TextWrapping.Wrap;
            hint.Margin = new Thickness(0, 2, 0, 2);
            adv.Children.Add(hint);
            adv.Children.Add(_update);
            adv.Children.Add(_hideMarkers);
            var expander = new Expander { Header = "Нарийвчилсан", Content = adv, IsExpanded = false, Margin = new Thickness(0, 12, 0, 0) };
            form.Children.Add(expander);

            var formScroll = new ScrollViewer { Content = form, VerticalScrollBarVisibility = ScrollBarVisibility.Auto };
            Grid.SetRow(formScroll, 1);
            Grid.SetColumn(formScroll, 1);
            root.Children.Add(formScroll);

            // ── Хураангуй + товч ────────────────────────────────────
            var foot = new DockPanel { Margin = new Thickness(0, 10, 0, 0), LastChildFill = true };
            var buttons = new StackPanel { Orientation = Orientation.Horizontal, VerticalAlignment = VerticalAlignment.Center };
            MglUi.Primary(_generate);
            // 2026-10-07: ажил АРЫН ГОРИМД — дармагц цонх хаагдаж Revit-д үргэлжлүүлэн ажиллана (явц баруун талын самбарт).
            _generate.ToolTip = "Дармагц ажил арын горимд эхэлнэ — хүлээх хооронд Revit-д үргэлжлүүлэн ажиллаж болно." + Environment.NewLine
                                + "Явц, тайлан, «Хуудас нээх», «Бүгдийг буцаах» нь баруун талын «MGL — Ажлын явц» самбарт.";
            if (canAddRooms)
            {
                _addRooms.ToolTip = "Цонхыг түр хааж планд өөр өрөө нэмж сонгоно (өрөө бүрт дарна, Esc = дуусгах) — тохиргоо, хассан мөр хадгалагдана.";
                MglAuto.Name(_addRooms, "Өрөө нэмэх");
                _addRooms.Click += (s, e) =>
                {
                    Replan();   // одоогийн тохиргоог (зөв бол) хадгална
                    AddRoomsRequested = true;
                    CancelPreviewJob();
                    DialogResult = false;
                };
                buttons.Children.Add(_addRooms);
            }
            // W06: баримтын үүсгэсэн бүх дэлгээс (өрөө → дэлгээс → одоогийн хуудас) — Revit дахин асаасны дараа ч; юу ч үүсгэхгүй.
            _results.ToolTip = "Энэ баримтад өмнө үүсгэсэн бүх дэлгээс: өрөө → дэлгээс → ОДООГИЙН хуудас (гараар зөөсөн ч), цэгцлэх / хуудасгүй;" + Environment.NewLine
                               + "хуудас, харагдац нээх, viewport сонгох, Project Browser-т олох.  Энэ цонх хаагдана (юу ч үүсгэхгүй, тохиргоо хадгалагдахгүй).";
            MglAuto.Name(_results, "Өмнөх үр дүн");
            _results.Click += (s, e) =>
            {
                ResultsRequested = true;
                CancelPreviewJob();
                DialogResult = false;
            };
            buttons.Children.Add(_results);
            _feedback.ToolTip = "Энэ хэрэгслийн алдаа, сайжруулах санал, асуултаа програм хариуцагчид илгээнэ (тохиргоо, Revit/add-in хувилбар хамт явна; юу илгээгдэхийг харж болно).";
            MglAuto.Name(_feedback, "Санал хүсэлт");
            _feedback.Click += (s, e) => { Action a = _feedbackRequested; if (a != null) a(); };
            buttons.Children.Add(_feedback);
            buttons.Children.Add(_generate);
            buttons.Children.Add(_cancel);
            DockPanel.SetDock(buttons, Dock.Right);
            foot.Children.Add(buttons);
            foot.Children.Add(_summary);
            Grid.SetRow(foot, 2);
            Grid.SetColumnSpan(foot, 2);
            root.Children.Add(foot);

            Content = root;

            foreach (TextBox tb in new[] { _padding, _near, _far, _pattern, _sheetPattern, _sheetMargin, _annoOffset, _annoStep,
                                           _maxDepth, _labelPattern, _titlePattern, _sheetName, _bottomBand, _fadeHeight, _fadeOpacity,
                                           _labelStart, _labelEnd, _labelDigits, _sheetPrefix, _sheetStart, _sheetEnd, _sheetDigits })
            {
                tb.LostFocus += (s, e) => Replan();
                tb.KeyDown += (s, e) => { if (e.Key == Key.Enter) Replan(); };
            }
            foreach (ComboBox sc in new[] { _scale, _keyScale, _axonScale })
            {
                sc.LostFocus += (s, e) => Replan();
                sc.SelectionChanged += (s, e) => Dispatcher.BeginInvoke(new Action(() => Replan()));
                sc.KeyDown += (s, e) => { if (e.Key == Key.Enter) Replan(); };
            }
            foreach (ComboBox cb in new[] { _viewType, _template, _wallSide, _titleBlock, _targetSheet, _dimType, _spotType, _keynoteType, _persp, _depthMode, _renderPlace, _labelMode, _sheetMode, _defaultPreset })
                cb.SelectionChanged += (s, e) => Replan();
            _fadeMode.SelectionChanged += (s, e) => { _fadeHeight.IsEnabled = _fadeMode.SelectedIndex == 1; _fadeOpacity.IsEnabled = _fadeMode.SelectedIndex != 2; Replan(); };
            _fadeHeight.IsEnabled = _fadeMode.SelectedIndex == 1;
            _fadeOpacity.IsEnabled = _fadeMode.SelectedIndex != 2;
            _redFrame.Checked += (s, e) => Replan();
            _redFrame.Unchecked += (s, e) => Replan();
            _typeDesignator.LostFocus += (s, e) => Replan();
            _typeDesignator.SelectionChanged += (s, e) => Dispatcher.BeginInvoke(new Action(() => Replan()));
            _viewsOnly.Checked += (s, e) => Replan();
            _viewsSheets.Checked += (s, e) => Replan();
            foreach (CheckBox c in new[] { _update, _hideMarkers, _separated, _overall, _keyPlan, _axon, _merge, _resetPlacement, _labelContinuous }.Concat(_anno.Values).Concat(_legendChecks))
            {
                c.Checked += (s, e) => Replan();
                c.Unchecked += (s, e) => Replan();
            }
            _viewKind.SelectionChanged += (s, e) =>
            {
                if (_loading) return;
                if (_viewTypesOf != null)
                {
                    IList<string> list = _viewTypesOf(_viewKind.SelectedIndex == 1 ? WeViewKind.Section : WeViewKind.Elevation);
                    Fill(_viewType, list, list.Count > 0 ? list[0] : null);   // өөр гэр бүлийн төрлийн нэр хүчингүй — өөрийн төрөл
                }
                Replan();
            };
            _generate.Click += (s, e) => { if (Replan()) { CancelPreviewJob(); DialogResult = true; } };
            // Цонх хаагдахад (Үүсгэх, Болих, ✕) бэлтгэж буй урьдчилсан зургийн түр өөрчлөлтийг БУЦААНА.
            Closing += (s, e) => CancelPreviewJob();

            string sel = (roomCount > 0 ? roomCount + " өрөө" : string.Empty)
                         + (roomCount > 0 && wallCount > 0 ? ", " : string.Empty)
                         + (wallCount > 0 ? wallCount + " хана" : string.Empty);
            _headline.Text = "Сонгосон: " + sel + ".  Урьдчилсан дүн загварт хүрэхгүй — хүсээгүй дэлгээсийн тэмдгийг арилгана уу."
                             + (canAddRooms ? "  Олон өрөө: «+ Өрөө нэмэх» (эсвэл планд Ctrl+дарж сонгоно)." : string.Empty)
                             + "  Нэмэлт тал: өрөө бүрийн «+ Хана нэмэх».";

            LoadPresetControls(_editPreset);
            _loading = false;
            _previewOn.IsChecked = _render != null && initial.LivePreview;
            _previewOn.IsEnabled = _render != null;
            SetPreviewShown(_previewOn.IsChecked == true);
            _renderTimer.Tick += (s, e) => { _renderTimer.Stop(); RenderPreview(); };
            // 2026-10-14 (интерьерийн баг): «нуусны дараа буцааж гаргах товч олдохгүй» — өмнө нь чагт өөрөө нуугдах мөрөнд байсан.
            // Одоо толгой (чагт) ҮРГЭЛЖ харагдана, зөвхөн зургийн хүрээ хураагдана.
            _previewOn.Checked += (s, e) => { SetPreviewShown(true); Settings.LivePreview = true; SchedulePreview(0); };
            _previewOn.Unchecked += (s, e) => { CancelPreviewJob(); SetPreviewShown(false); Settings.LivePreview = false; };
            Loaded += (s, e) => Replan();
        }

        // ── Доод талын урьдчилсан зураг ─────────────────────────────

        private UIElement PreviewPanel()
        {
            var panel = new DockPanel { Margin = new Thickness(0, 4, 0, 0) };
            var head = new DockPanel { Margin = new Thickness(0, 0, 0, 4) };
            var refresh = new Button { Content = "Шинэчлэх", Padding = new Thickness(10, 2, 10, 2), ToolTip = "Сонгосон дэлгээсийн зургийг дахин гаргах" };
            refresh.Click += (s, e) => { CancelPreviewJob(); _renderCache.Clear(); _shownRenderKey = null; SchedulePreview(0); };
            _previewRefresh = refresh;
            DockPanel.SetDock(refresh, Dock.Right);
            head.Children.Add(refresh);
            head.Children.Add(_previewOn);
            head.Children.Add(_previewTitle);
            DockPanel.SetDock(head, Dock.Top);
            panel.Children.Add(head);
            var frame = new Border { BorderThickness = new Thickness(1), CornerRadius = new CornerRadius(4), ClipToBounds = true, MinHeight = 60 };
            _previewFrame = frame;
            frame.SetResourceReference(Border.BorderBrushProperty, "Line");
            frame.SetResourceReference(Border.BackgroundProperty, "BgRaised");
            var g = new Grid();
            g.Children.Add(_previewImage);
            _previewStatus.SetResourceReference(TextBlock.ForegroundProperty, "FgMuted");
            g.Children.Add(_previewStatus);
            frame.Child = g;
            panel.Children.Add(frame);
            MglAuto.Name(panel, "Урьдчилсан зураг");
            _previewStatus.Text = _render == null ? "Урьдчилсан зураг энэ горимд алга." : "Дэлгээсийн мөр эсвэл план дээрх шугамыг сонгоно уу.";
            return panel;
        }

        /// <summary>
        /// Зургийн хүрээг харуулах/хураах — толгой (чагт «Урьдчилсан зураг») ҮРГЭЛЖ харагдана, тиймээс нуусны дараа нэг дарж буцаана.
        /// </summary>
        private void SetPreviewShown(bool on)
        {
            if (_previewFrame == null) return;
            if (on)
            {
                _previewFrame.Visibility = Visibility.Visible;
                if (_previewRefresh != null) _previewRefresh.Visibility = Visibility.Visible;
                if (_previewSplitter != null) _previewSplitter.Visibility = Visibility.Visible;
                _previewRow.MinHeight = 120;
                _previewRow.Height = _previewHeight;
                if (_previewTitle.Text == HiddenTitle) _previewTitle.Text = string.Empty;
            }
            else
            {
                if (_previewRow.Height.IsStar || _previewRow.Height.IsAbsolute) _previewHeight = _previewRow.Height;
                _previewFrame.Visibility = Visibility.Collapsed;
                if (_previewRefresh != null) _previewRefresh.Visibility = Visibility.Collapsed;
                if (_previewSplitter != null) _previewSplitter.Visibility = Visibility.Collapsed;
                _previewRow.MinHeight = 0;
                _previewRow.Height = GridLength.Auto;
                _previewTitle.Text = _render == null ? string.Empty : HiddenTitle;
            }
        }

        private const string HiddenTitle = "— нуусан (чагтлаад дахин харуулна)";
        private const string ChordNote = WallElevationPlanner.ChordViewNote;

        /// <summary>Дуусаагүй урьдчилсан зургийг цуцалж түр өөрчлөлтийг БУЦААНА (загварт юу ч үлдэхгүй).</summary>
        public void CancelPreviewJob()
        {
            IWePreviewJob j = _job;
            _job = null;
            _jobKey = null;
            if (j == null) return;
            try { j.Dispose(); } catch { /* цуцлах нь хэзээ ч цонхыг унагахгүй */ }
        }

        /// <summary>Урьдчилсан зургийн кэшийн түлхүүр — дэлгээс, геометр, тэмдэглэгээ, загвар, масштаб.</summary>
        private string PreviewKey(WePlannedElevation p)
        {
            WePreset pr = Settings.PresetOf(p.PresetId);
            return p.Key + "|" + p.Signature + "|" + (p.Annotation != null ? p.Annotation.Digest : string.Empty) + "|" + pr.Annotations + "|" + pr.TemplateName + "|" + Settings.Scale;
        }

        private void SchedulePreview(int ms = 450)
        {
            if (_render == null || _previewOn.IsChecked != true) return;
            _renderTimer.Stop();
            _renderTimer.Interval = TimeSpan.FromMilliseconds(Math.Max(1, ms));
            _renderTimer.Start();
        }

        private WePlannedElevation SelectedItem()
        {
            return _plan == null ? null : _plan.Items.FirstOrDefault(i => i.Key == _selectedKey);
        }

        private void RenderPreview()
        {
            if (_render == null || _previewOn.IsChecked != true) { CancelPreviewJob(); return; }
            WePlannedElevation p = SelectedItem();
            if (p == null) { CancelPreviewJob(); _previewTitle.Text = string.Empty; ShowPreview(null, "Дэлгээсийн мөр эсвэл план дээрх шугамыг сонгоно уу."); return; }
            _previewTitle.Text = (p.SideLetter ?? "?") + "  ·  " + DirectionText(p) + (p.Override != null ? "  (таны тохируулсан)" : string.Empty) + "   " + (p.GroupLabel ?? string.Empty);
            if (!Included(p))
            {
                CancelPreviewJob();
                ShowPreview(null, p.Status <= WeStatus.Warning ? "Хассан дэлгээс — чагтлаж оруулбал зураг гарна."
                                  : p.CanForce ? "Энэ дэлгээс автоматаар үүсэхгүй: " + p.Message + "  —  чагтлаад таны сонголтоор үүсгэж болно."
                                                 + (p.ChordView ? "  " + ChordNote : string.Empty)
                                  : "Энэ дэлгээс үүсэхгүй: " + p.Message);
                return;
            }
            string key = PreviewKey(p);
            WePreviewResult cached;
            if (_renderCache.TryGetValue(key, out cached)) { CancelPreviewJob(); ShowResult(key, cached); return; }
            if (_job != null && _jobKey == key) return;   // аль хэдийн бэлтгэж байна
            CancelPreviewJob();
            IWePreviewJob job;
            try { job = _render(p, Settings); }
            catch (Exception ex) { ShowPreview(null, "Зураг гарсангүй: " + ex.Message); return; }
            if (job == null) { ShowPreview(null, "Зураг гарсангүй"); return; }
            _job = job;
            _jobKey = key;
            ShowPreview(null, "Зураг бэлтгэж байна… цонхонд үргэлжлүүлэн ажиллаж болно (Revit дээр түр үүсгээд буцаана).");
            PumpPreview(job);
        }

        /// <summary>
        /// Дараагийн алхмыг Background эрэмбээр — хэрэглэгчийн оролт (дарах, бичих, гүйлгэх) алхам бүрийн ӨМНӨ боловсруулагдана, тиймээс
        /// бэлтгэх явцад цонх гацахгүй.  Сонголт/тохиргоо солигдвол <see cref="CancelPreviewJob"/> ажлыг тасалж буцаана.
        /// </summary>
        private void PumpPreview(IWePreviewJob job)
        {
            Dispatcher.BeginInvoke(System.Windows.Threading.DispatcherPriority.Background, new Action(() =>
            {
                if (!ReferenceEquals(job, _job)) return;   // цуцлагдсан / солигдсон
                try { job.Step(); }
                catch { /* Job.Step өөрөө шиддэггүй — хамгаалалт */ }
                if (!ReferenceEquals(job, _job)) return;
                if (job.Done)
                {
                    string key = _jobKey;
                    WePreviewResult r = job.Result ?? new WePreviewResult { Error = "зураг гарсангүй" };
                    _job = null;
                    _jobKey = null;
                    try { job.Dispose(); } catch { }
                    if (key != null && r.Error != "цуцалсан") _renderCache[key] = r;
                    WePlannedElevation cur = SelectedItem();
                    if (cur != null && key != null && PreviewKey(cur) == key) ShowResult(key, r);
                    return;
                }
                int pct = (int)Math.Round(100 * Math.Max(0, Math.Min(1, job.Fraction)));
                _previewStatus.Text = "Зураг бэлтгэж байна… " + pct + "%" + (string.IsNullOrEmpty(job.Status) ? string.Empty : " · " + job.Status)
                                      + Environment.NewLine + "Цонхонд үргэлжлүүлэн ажиллаж болно.";
                PumpPreview(job);
            }));
        }

        private void ShowResult(string key, WePreviewResult r)
        {
            if (_shownRenderKey == key && _previewImage.Source != null) return;
            if (r == null || string.IsNullOrEmpty(r.Path) || !System.IO.File.Exists(r.Path)) { ShowPreview(null, "Зураг гарсангүй: " + (r != null ? r.Error : "-")); return; }
            try
            {
                var bmp = new System.Windows.Media.Imaging.BitmapImage();
                bmp.BeginInit();
                bmp.CacheOption = System.Windows.Media.Imaging.BitmapCacheOption.OnLoad;
                bmp.CreateOptions = System.Windows.Media.Imaging.BitmapCreateOptions.IgnoreImageCache;
                bmp.UriSource = new Uri(r.Path);
                bmp.EndInit();
                bmp.Freeze();
                ShowPreview(bmp, null);
                _shownRenderKey = key;
                _previewStatus.Text = string.Empty;
                if (r.Ms > 0) _previewImage.ToolTip = "Revit-ээр түр үүсгэж буцаасан · " + (r.Ms / 1000.0).ToString("0.0", CultureInfo.InvariantCulture) + " с";
            }
            catch (Exception ex) { ShowPreview(null, "Зураг уншиж чадсангүй: " + ex.Message); }
        }

        private void ShowPreview(ImageSource img, string status)
        {
            _previewImage.Source = img;
            _previewStatus.Text = status ?? string.Empty;
            if (img == null) _shownRenderKey = null;
            // UI automation (gate PREVIEW-101): зураг гарсан эсэх, эсвэл шалтгаан.
            System.Windows.Automation.AutomationProperties.SetName(_previewImage,
                img != null ? "Урьдчилсан зураг бэлэн: " + _previewTitle.Text : "Урьдчилсан зураг алга: " + (status ?? string.Empty));
        }

        private void Select(string key)
        {
            if (key == _selectedKey) return;
            _selectedKey = key;
            CancelPreviewJob();   // өөр дэлгээс сонгосон — өмнөхийн бэлтгэлийг шууд тасална
            SyncEditPreset();     // W09: доорх зориулалтын удирдлагууд сонгосон өрөөний зориулалтыг засна
            Render();
            SchedulePreview(150);
        }

        /// <summary>
        /// W07: сонгосон дэлгээсийн БОСОО ХҮРЭЭ — «Доод / Дээд, мм» (өрөөний шалнаас, хана горимд ханын суурьнаас) + «Авто».  Талбарт одоогийн хил
        /// (авто бол хэрэгслийн тооцоолсон утга, бүдэг); засаж Enter / өөр тийш дарахад тэр тал тогтооно, нөгөө тал өмнөх төлөвөөрөө.  Хадгалагдана
        /// (үүсгэсэн харагдац дээр) — дахин нээхэд сэргэнэ.  Урьдчилсан зураг шинэ хүрээгээр дахин гарна.
        /// </summary>
        private UIElement CropEditor(WePlannedElevation cur)
        {
            if (cur == null || cur.Frame == null || cur.Box == null) return null;
            var panel = new StackPanel { Margin = new Thickness(0, 6, 0, 0) };
            string basis = cur.Kind == WeSourceKind.Wall ? "ханын суурьнаас" : "өрөөний шалнаас";
            var head = new TextBlock { Text = "Босоо хүрээ (" + basis + ", мм)" + (cur.HasDeclaredCrop ? " — таны тохируулсан" : " — авто"), FontSize = 11, Margin = new Thickness(0, 0, 0, 2) };
            head.SetResourceReference(TextBlock.ForegroundProperty, cur.HasDeclaredCrop ? "Accent" : "FgMuted");
            head.ToolTip = "Дэлгээсийн доод ба дээд хил — " + basis + " (Room-ийн доод хил: түвшин + Base Offset).  Хүрээ ЯГ энэ хил болно;"
                           + Environment.NewLine + "хилээс гадуурх хэмжээс, spot level, шошго тавигдахгүй.  Хэсэгчилсэн хүрээ ЗОРИУД — алдаа гэж тооцогдохгүй."
                           + Environment.NewLine + "«Авто» — хэрэгслийн өөрийн хүрээ (харагдац дээр хадгалсныг арилгана).";
            panel.Children.Add(head);
            var row = new WrapPanel();
            double loNow = Math.Round(_units.InternalToMeters(cur.Box.MinY) * 1000), hiNow = Math.Round(_units.InternalToMeters(cur.Box.MaxY) * 1000);
            TextBox lo = CropBox(loNow, !double.IsNaN(cur.CropLowerMm)), hi = CropBox(hiNow, !double.IsNaN(cur.CropUpperMm));
            MglAuto.Name(lo, "Босоо хүрээний доод хил " + (cur.SideLetter ?? string.Empty), "мм, " + basis);
            MglAuto.Name(hi, "Босоо хүрээний дээд хил " + (cur.SideLetter ?? string.Empty), "мм, " + basis);
            row.Children.Add(new TextBlock { Text = "Доод", VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(0, 0, 4, 0) });
            row.Children.Add(lo);
            row.Children.Add(new TextBlock { Text = "Дээд", VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(10, 0, 4, 0) });
            row.Children.Add(hi);
            var auto = new Button { Content = "Авто", Padding = new Thickness(8, 1, 8, 1), Margin = new Thickness(8, 0, 0, 0), IsEnabled = cur.HasDeclaredCrop || _crops.ContainsKey(cur.Key),
                                    ToolTip = "Хэрэгслийн өөрийн босоо хүрээ (харагдац дээр хадгалсныг ч арилгана)" };
            MglAuto.Name(auto, "Босоо хүрээг авто болгох " + (cur.SideLetter ?? string.Empty));
            string key = cur.Key;
            auto.Click += (s, e) => { _crops[key] = new WeCropOverride(); _selectedKey = key; Replan(); };
            row.Children.Add(auto);
            Action commit = () => CommitCrop(key, cur, lo.Text, hi.Text, loNow, hiNow);
            foreach (TextBox tb in new[] { lo, hi })
            {
                tb.KeyDown += (s, e) => { if (e.Key == Key.Enter) commit(); };
                tb.LostFocus += (s, e) => commit();
            }
            panel.Children.Add(row);
            return panel;
        }

        private static TextBox CropBox(double mm, bool declared)
        {
            var tb = new TextBox { Text = mm.ToString("0", CultureInfo.InvariantCulture), Width = 64, Padding = new Thickness(3, 1, 3, 1), VerticalAlignment = VerticalAlignment.Center,
                                   ToolTip = declared ? "Таны тохируулсан хил" : "Авто (хэрэгслийн тооцоолсон) — засвал энэ хил тогтоно" };
            if (!declared) tb.SetResourceReference(Control.ForegroundProperty, "FgMuted");
            return tb;
        }

        /// <summary>Талбарыг уншина: зөвхөн ӨӨРЧИЛСӨН тал тогтоогдоно (засаагүй авто тал авто хэвээр).  Буруу утга → тайлбар, өөрчлөлтгүй.</summary>
        private void CommitCrop(string key, WePlannedElevation cur, string loText, string hiText, double loNow, double hiNow)
        {
            double lo, hi;
            bool okLo = WeVerticalCrop.TryParseField(loText, out lo), okHi = WeVerticalCrop.TryParseField(hiText, out hi);
            if (!okLo || !okHi)
            {
                _summary.Text = "✖ Босоо хүрээ: тоо (мм) эсвэл хоосон («авто») бичнэ үү";
                _summary.SetResourceReference(TextBlock.ForegroundProperty, "Danger");
                return;
            }
            WeCropOverride prev;
            _crops.TryGetValue(key, out prev);
            double baseLo = prev != null ? prev.LowerMm : cur.CropLowerMm, baseHi = prev != null ? prev.UpperMm : cur.CropUpperMm;
            // Засаагүй тал (одоогийн утгатай ижил) — өмнөх төлөв (авто бол авто).  Хоосолсон тал — авто.
            double nextLo = !double.IsNaN(lo) && Math.Abs(lo - loNow) < 0.5 ? baseLo : lo;
            double nextHi = !double.IsNaN(hi) && Math.Abs(hi - hiNow) < 0.5 ? baseHi : hi;
            if (SameMm(nextLo, cur.CropLowerMm) && SameMm(nextHi, cur.CropUpperMm) && prev == null) return;
            if (prev != null && SameMm(nextLo, prev.LowerMm) && SameMm(nextHi, prev.UpperMm)) return;
            string problem = WeVerticalCrop.Problem(nextLo, nextHi);
            if (problem != null)
            {
                _summary.Text = "✖ Босоо хүрээ: " + problem;
                _summary.SetResourceReference(TextBlock.ForegroundProperty, "Danger");
                return;
            }
            _crops[key] = new WeCropOverride { LowerMm = nextLo, UpperMm = nextHi };
            _selectedKey = key;
            Replan();
        }

        private static bool SameMm(double a, double b)
        {
            return double.IsNaN(a) ? double.IsNaN(b) : !double.IsNaN(b) && Math.Abs(a - b) < 0.5;
        }

        private void EditOverride(string key, WeSideOverride ov)
        {
            if (string.IsNullOrEmpty(key) || ov == null) return;
            _overrides[key] = ov;
            _selectedKey = key;
            Replan();
        }

        /// <summary>
        /// «+ Хана нэмэх» (2026-10-14, интерьерийн баг): өрөөнд шинэ нэмэлт тал — сонгосон (эсвэл эхний) талын өмнө (өрөө рүү бага зэрэг), төвд нь,
        /// уртын хагас, ижил хана руу харна; шууд сонгогдож план дээр тодорно, урьдчилсан зураг түүнийх.  Цонх хаагдахгүй — план дээр чирж
        /// байрлал, уртыг тохируулна.
        /// </summary>
        private void AddExtraSide(string roomUid, string groupKey)
        {
            if (_plan == null || string.IsNullOrEmpty(roomUid)) return;
            List<WePlannedElevation> roomItems = _plan.Items.Where(i => i.GroupKey == groupKey).ToList();
            Func<WePlannedElevation, bool> geo = i => !i.PlanLook.IsZero && (i.PlanB - i.PlanA).Flat().Length > 1e-6;
            WePlannedElevation basis = roomItems.FirstOrDefault(i => i.Key == _selectedKey && geo(i))
                                       ?? roomItems.FirstOrDefault(i => i.Frame != null && geo(i)) ?? roomItems.FirstOrDefault(geo);
            WeSideOverride line = null;
            List<List<WeV3>> outline;
            _plan.Outlines.TryGetValue(groupKey ?? string.Empty, out outline);
            if (basis != null) line = WeExtraSides.InitialLine(basis.PlanA, basis.PlanB, basis.PlanLook, outline);
            else if (outline != null) line = WeExtraSides.InitialLine(outline);
            if (line == null || !line.IsValid)
            {
                _summary.Text = "✖ Нэмэлт тал гаргах байрлал олдсонгүй (өрөөний хил уншигдаагүй)";
                _summary.SetResourceReference(TextBlock.ForegroundProperty, "Danger");
                return;
            }
            var used = new List<string>(Settings.ExtraSidesOf(roomUid));
            used.AddRange(roomItems.Select(i => WeExtraSides.IdOf(i.Key)).Where(x => x != null));
            string id = WeExtraSides.NextId(used);
            string key = WeExtraSides.Key(roomUid, id);
            Settings.AddExtraSide(roomUid, id);
            _overrides[key] = line;
            _excluded.Remove(key);
            _selectedKey = key;
            CancelPreviewJob();
            Replan();
        }

        // ── Төлөвлөх + харуулах ───────────────────────────────────────

        /// <summary>true = зөв тохиргоо, хийх ажил байна.</summary>
        private bool Replan()
        {
            if (_loading) return false;
            WeSettings s = Read();
            _sheetPanel.Visibility = s.Output == WeOutputMode.ViewsAndSheets ? Visibility.Visible : Visibility.Collapsed;
            List<string> errors = s.Validate();
            if (errors.Count > 0)
            {
                _summary.Text = "✖ " + string.Join("  ", errors);
                _summary.SetResourceReference(TextBlock.ForegroundProperty, "Danger");
                _generate.IsEnabled = false;
                return false;
            }
            Settings = s;
            try { _plan = _planner(s); }
            catch (Exception ex)
            {
                _summary.Text = "✖ Урьдчилсан дүн гаргаж чадсангүй: " + ex.Message;
                _summary.SetResourceReference(TextBlock.ForegroundProperty, "Danger");
                _generate.IsEnabled = false;
                return false;
            }
            if (_plan.Items.All(i => i.Key != _selectedKey))
                _selectedKey = (_plan.Items.FirstOrDefault(Included) ?? _plan.Items.FirstOrDefault())?.Key;
            SyncEditPreset();
            // Тохиргоо солигдож бэлтгэж буй зураг хуучирвал ШУУД цуцална (хуучин зургийг дуустал хүлээхгүй).
            if (_job != null)
            {
                WePlannedElevation sel = SelectedItem();
                if (sel == null || PreviewKey(sel) != _jobKey) CancelPreviewJob();
            }
            Render();
            SchedulePreview();
            return UpdateFooter();
        }

        private void Render()
        {
            _preview.Children.Clear();
            foreach (IGrouping<string, WePlannedElevation> g in _plan.Items.GroupBy(i => i.GroupKey))
                _preview.Children.Add(Group(g.ToList()));

            if (_plan.Orphans.Count > 0)
            {
                var b = new StackPanel { Margin = new Thickness(0, 12, 0, 0) };
                b.Children.Add(new TextBlock { Text = "Эх нь алга болсон дэлгээс (устгаагүй)", FontWeight = FontWeights.SemiBold, Margin = new Thickness(0, 0, 0, 2) });
                foreach (WeOrphan o in _plan.Orphans)
                    b.Children.Add(Muted("⚠ " + o.Name + " — " + o.Reason, 8));
                _preview.Children.Add(b);
            }
            if (_plan.Notes.Count > 0)
            {
                var b = new StackPanel { Margin = new Thickness(0, 12, 0, 0) };
                foreach (string n in _plan.Notes) b.Children.Add(Muted("ⓘ " + n, 0));
                _preview.Children.Add(b);
            }
            if (_plan.Items.Count == 0)
                _preview.Children.Add(MglUi.Note("Дэлгээс гаргах өрөө/хана олдсонгүй.", MglSeverity.Warn));
        }

        /// <summary>Нэг өрөө (эсвэл ханын түвшин): зүүн талд жижиг план, баруун талд мөрүүд.</summary>
        private UIElement Group(List<WePlannedElevation> items)
        {
            var g = new Grid { Margin = new Thickness(0, 10, 0, 0) };
            // 2026-10-14 (эзэн): план ТОМ, мөрүүд нарийн — план дээрээс дэлгээсийг чирж тохируулна.
            g.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(EditorWidth + 4) });
            g.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            g.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            g.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });

            var title = new TextBlock { Text = items[0].GroupLabel, FontWeight = FontWeights.SemiBold, FontSize = 14, Margin = new Thickness(0, 0, 0, 4), TextWrapping = TextWrapping.Wrap };
            string extras = ExtrasText(items[0].GroupKey);
            if (extras.Length > 0)
            {
                var run = new Run("   " + extras) { FontWeight = FontWeights.Normal, FontSize = 12 };
                run.SetResourceReference(TextElement.ForegroundProperty, "FgMuted");
                title.Inlines.Add(run);
            }
            Grid.SetColumnSpan(title, 2);
            g.Children.Add(title);

            UIElement plan = EditorFor(items);
            Grid.SetRow(plan, 1);
            g.Children.Add(plan);

            var rows = new StackPanel { Margin = new Thickness(8, 0, 0, 0) };
            UIElement presetLine = PresetLine(items);
            if (presetLine != null) rows.Children.Add(presetLine);
            foreach (WePlannedElevation p in items) rows.Children.Add(ItemRow(p));
            // «+ Хана нэмэх» (2026-10-14, интерьерийн баг: «хуудас руу шилжих биш, цонхон дотроо шинэ үсэг гарч ирээд хэмжээгээ өөрсдөө
            // тохируулна»): энэ өрөөнд шинэ нэмэлт тал (E, F …) — сонгосон талын өмнө, уртын хагас; план дээр чирж байрлал, уртыг тохируулна.
            WePlannedElevation first = items[0];
            bool unplaced = items.Count == 1 && first.Key != null && first.Key.EndsWith("|side:room", StringComparison.Ordinal);   // өрөө байршаагүй / битүү биш
            if (first.Kind == WeSourceKind.Room && !string.IsNullOrEmpty(first.RoomUid) && !unplaced)
            {
                var addSide = new Button { Content = "+ Хана нэмэх", Padding = new Thickness(10, 2, 10, 2), Margin = new Thickness(0, 6, 0, 0), HorizontalAlignment = HorizontalAlignment.Left };
                addSide.ToolTip = "Энэ өрөөнд шинэ нэмэлт дэлгээс (E, F …) нэмнэ — сонгосон талын өмнө (өрөө рүү бага зэрэг), уртын хагасаар гарна."
                                  + Environment.NewLine + "Зүүн талын план дээр шугамыг чирж зөөнө, үзүүрийг чирж уртыг тохируулна; «⟲ 90°», «⇅ Эсрэг»-ээр эргүүлнэ."
                                  + Environment.NewLine + "Хуудас, түлхүүр план, хэмжээс, шошго өрөөний бусад талтай адил.";
                MglAuto.Name(addSide, "Хана нэмэх " + first.GroupLabel);
                string roomUid = first.RoomUid, groupKey = first.GroupKey;
                addSide.Click += (s, e) => AddExtraSide(roomUid, groupKey);
                rows.Children.Add(addSide);
            }
            Grid.SetRow(rows, 1);
            Grid.SetColumn(rows, 1);
            g.Children.Add(rows);
            return g;
        }

        private const double EditorWidth = 340, EditorHeight = 270;

        /// <summary>Том, засварлах план + сонгосон дэлгээсийн товч («⟲ 90°», «⇅ Эсрэг», «↺ Анхных»).</summary>
        private UIElement EditorFor(List<WePlannedElevation> items)
        {
            var stack = new StackPanel();
            var ed = new WePlanEditor(EditorWidth, EditorHeight);
            List<List<WeV3>> outline;
            if (_plan == null || !_plan.Outlines.TryGetValue(items[0].GroupKey ?? string.Empty, out outline)) outline = null;
            string sel = items.Any(i => i.Key == _selectedKey) ? _selectedKey : null;
            ed.Show(outline, items, Included, sel, _units);
            ed.Selected += Select;
            ed.Edited += EditOverride;
            stack.Children.Add(ed);

            WePlannedElevation cur = items.FirstOrDefault(i => i.Key == _selectedKey);
            var tools = new WrapPanel { Margin = new Thickness(0, 4, 0, 0) };
            Func<string, string, Func<WePlannedElevation, WeSideOverride>, Button> btn = (text, tip, make) =>
            {
                var b = new Button { Content = text, Padding = new Thickness(8, 1, 8, 1), Margin = new Thickness(0, 0, 4, 2), ToolTip = tip, IsEnabled = cur != null && Included(cur) };
                b.Click += (s, e) =>
                {
                    WePlannedElevation p = items.FirstOrDefault(i => i.Key == _selectedKey);
                    if (p == null) return;
                    WeSideOverride o = make(p);
                    if (o != null) EditOverride(p.Key, o);
                };
                return b;
            };
            Func<WePlannedElevation, WeSideOverride> currentLine = p => WeSideOverride.Line(p.PlanA, p.PlanB, p.PlanLook);
            tools.Children.Add(btn("⟲ 90°", "Сонгосон дэлгээсийн шугамыг 90° эргүүлнэ (төв нь хэвээр)", p => currentLine(p).Rotated90()));
            tools.Children.Add(btn("⇅ Эсрэг", "Харах чиглэлийг эсрэг болгоно", p => currentLine(p).Flipped()));
            var reset = btn("↺ Анхных", "Хэрэгслийн өөрийн байрлал руу буцаана", p => new WeSideOverride { Reset = true });
            // Нэмэлт талын шугам нь өөрөө тохируулга — «анхных» гэж байхгүй (хасах бол мөрийн «✕»).
            reset.IsEnabled = cur != null && !cur.Manual && (cur.Override != null || _overrides.ContainsKey(cur.Key));
            tools.Children.Add(reset);
            stack.Children.Add(tools);
            UIElement crop = CropEditor(cur);
            if (crop != null) stack.Children.Add(crop);
            // Нэг мөр (дэлгэцийн зураг, gate 2026-10-14: урт тайлбар бүлгийн доод захад тасарсан) — дэлгэрэнгүй нь tooltip-д.
            TextBlock hint = MglUi.Muted("Дарж сонгоно · чирж зөөнө · үзүүрээр уртасгана");
            hint.ToolTip = "Шугам дээр дарж сонгоно.  Чирж зөөнө (Shift — зөвхөн урагш/хойш).  Үзүүрийг чирж урт/богино болгоно (Ctrl — дурын өнцөг).";
            hint.TextWrapping = TextWrapping.Wrap;
            hint.FontSize = 11;
            hint.MaxWidth = EditorWidth;
            stack.Children.Add(hint);
            return stack;
        }

        /// <summary>Нэг дэлгээсний мөр: [✓] A · Хойд хана · 5.00 × 2.80 м · нэр · үйлдэл; доор нь шалтгаан.</summary>
        private UIElement ItemRow(WePlannedElevation p)
        {
            bool actionable = p.Action == WeAction.Create || p.Action == WeAction.Update
                              || (p.Action == WeAction.Keep && p.Status <= WeStatus.Warning)
                              || (_excluded.Contains(p.Key) && p.Status <= WeStatus.Warning && p.Frame != null);
            var panel = new StackPanel { Margin = new Thickness(0, 1, 0, 3) };
            var row = new DockPanel { LastChildFill = true };
            var host = new Border { Child = panel, CornerRadius = new CornerRadius(3), Padding = new Thickness(4, 2, 4, 2), Cursor = Cursors.Hand, Background = Brushes.Transparent };
            if (p.Key == _selectedKey) host.SetResourceReference(Border.BackgroundProperty, "AccentSoft");
            string selKey = p.Key;
            host.MouseLeftButtonUp += (s, e) => { if (!(e.OriginalSource is CheckBox)) Select(selKey); };

            // «Үүсэхгүй» (шалгах / дэмжигдэхгүй) мөр — 2026-10-14: чагтлаад хүчээр үүсгэж болно (хүрээ гарах боломжтой бол).
            bool forceRow = p.CanForce;
            var check = new CheckBox
            {
                IsChecked = forceRow ? p.Forced && !_excluded.Contains(p.Key) : actionable && !_excluded.Contains(p.Key),
                IsEnabled = actionable || forceRow,
                VerticalAlignment = VerticalAlignment.Center,
                Margin = new Thickness(0, 0, 6, 0),
            };
            if (forceRow)
                check.ToolTip = "Хэрэгсэл энэ дэлгээсийг автоматаар үүсгэхгүй: " + (p.Forced ? p.ForcedReason : p.Message)
                                + Environment.NewLine + "Чагтлавал таны сонголтоор үүсгэнэ — үр дүнг (тал, гүн, хүрээ) шалгана уу."
                                + (p.ChordView ? Environment.NewLine + ChordNote : string.Empty);
            MglAuto.Name(check, (p.SideLetter ?? "?") + " " + DirectionText(p), forceRow ? "Автоматаар үүсэхгүй дэлгээсийг хүчээр үүсгэх" : "Энэ дэлгээсийг үүсгэх эсэх");
            string key = p.Key;
            if (forceRow)
            {
                check.Checked += (s, e) => { _forced.Add(key); _excluded.Remove(key); _selectedKey = key; Replan(); };
                check.Unchecked += (s, e) => { _forced.Remove(key); Replan(); };
            }
            else
            {
                check.Checked += (s, e) => { _excluded.Remove(key); Refresh(); };
                check.Unchecked += (s, e) => { _excluded.Add(key); Refresh(); };
            }
            DockPanel.SetDock(check, Dock.Left);
            row.Children.Add(check);

            // Нэмэлт тал, ХАРААХАН үүсээгүй — «✕» буцаана (үүссэн бол чагтаар хасна; бүр устгах бол харагдацыг Revit-ээс устгана).
            string extraId = p.Manual ? WeExtraSides.IdOf(p.Key) : null;
            if (extraId != null && p.ExistingViewId == 0 && Settings.HasExtraSide(p.RoomUid, extraId))
            {
                var remove = new Button { Content = "✕", Padding = new Thickness(6, 0, 6, 0), Margin = new Thickness(6, 0, 0, 0), VerticalAlignment = VerticalAlignment.Center,
                                          MinWidth = 0, MinHeight = 0, ToolTip = "Нэмэлт талыг хасах" };
                MglAuto.Name(remove, "Нэмэлт талыг хасах " + (p.SideLetter ?? string.Empty));
                string rUid = p.RoomUid, pKey = p.Key;
                remove.Click += (s, e) =>
                {
                    Settings.RemoveExtraSide(rUid, extraId);
                    _excluded.Remove(pKey);
                    _forced.Remove(pKey);
                    _overrides.Remove(pKey);
                    Replan();
                };
                DockPanel.SetDock(remove, Dock.Right);
                row.Children.Add(remove);
            }

            var action = new TextBlock { Text = ActionText(p), Margin = new Thickness(8, 0, 0, 0), VerticalAlignment = VerticalAlignment.Center };
            action.SetResourceReference(TextBlock.ForegroundProperty, ActionTone(p));
            DockPanel.SetDock(action, Dock.Right);
            row.Children.Add(action);

            var text = new TextBlock { TextWrapping = TextWrapping.NoWrap, TextTrimming = TextTrimming.CharacterEllipsis, VerticalAlignment = VerticalAlignment.Center };
            var letter = new Run((p.SideLetter == null || p.SideLetter == "?" ? "–" : p.SideLetter) + "  ") { FontWeight = FontWeights.SemiBold };
            text.Inlines.Add(letter);
            var mark = new Run(StatusMark(p) + " ");
            mark.SetResourceReference(TextElement.ForegroundProperty, StatusTone(p));
            if (p.Status != WeStatus.Ready) text.Inlines.Add(mark);
            text.Inlines.Add(new Run(DirectionText(p)));
            if (p.Box != null)
            {
                var size = new Run("   " + _units.InternalToMeters(p.FaceLength).ToString("0.00", CultureInfo.InvariantCulture) + " × "
                                   + _units.InternalToMeters(p.FaceHeight).ToString("0.00", CultureInfo.InvariantCulture) + " м");
                size.SetResourceReference(TextElement.ForegroundProperty, "FgMuted");
                text.Inlines.Add(size);
            }
            if (p.Override != null)
            {
                var custom = new Run("   ✎");
                custom.SetResourceReference(TextElement.ForegroundProperty, "Accent");
                text.Inlines.Add(custom);
            }
            if (p.Manual)
            {
                var manual = new Run("   нэмэлт");
                manual.SetResourceReference(TextElement.ForegroundProperty, "Accent");
                text.Inlines.Add(manual);
            }
            if (p.HasDeclaredCrop)
            {
                var crop = new Run("   ↕");
                crop.SetResourceReference(TextElement.ForegroundProperty, "Accent");
                text.Inlines.Add(crop);
            }
            string census0 = CensusText(p);
            text.ToolTip = (p.WallLabel ?? string.Empty) + (string.IsNullOrEmpty(p.Name) ? string.Empty : "\n" + p.Name)
                           + (p.Override != null ? "\nТаны тохируулсан байрлал" : string.Empty)
                           + (p.Manual ? "\n" + (string.IsNullOrEmpty(p.Message) ? "Гараар нэмсэн хана" : p.Message) : string.Empty)
                           + (p.HasDeclaredCrop ? "\nБосоо хүрээ таны тохируулсан: " + WeVerticalCrop.Describe(p.CropLowerMm, p.CropUpperMm)
                                                  + (p.CropFromView ? " (харагдац дээр хадгалсан)" : string.Empty) : string.Empty)
                           + (census0.Length > 0 ? "\n" + census0 : string.Empty);
            row.Children.Add(text);
            panel.Children.Add(row);

            string why = p.Status > WeStatus.Ready ? (p.CanForce && !p.Forced ? p.Message + " — чагтлаад үүсгэж болно" : p.Message) : null;
            if (!string.IsNullOrEmpty(why))
            {
                TextBlock w = Muted(why, 26);
                w.FontSize = 11;
                w.TextTrimming = TextTrimming.CharacterEllipsis;
                w.TextWrapping = TextWrapping.NoWrap;
                w.ToolTip = why;
                panel.Children.Add(w);
            }
            // 2026-10-14: «Танигдсан …» урт бичвэр мөрийн tooltip-д (мөрүүд нарийн — план том).
            return host;
        }

        /// <summary>Checkbox-ийн дараа: зөвхөн план ба хураангуйг шинэчилнэ (төлөвлөгч дахин ажиллахгүй).</summary>
        private void Refresh()
        {
            Render();
            UpdateFooter();
        }

        private bool Included(WePlannedElevation p)
        {
            return !_excluded.Contains(p.Key) && p.Status <= WeStatus.Warning && p.Frame != null;
        }

        private bool UpdateFooter()
        {
            int create = 0, update = 0, keep = 0, excluded = 0, forced = 0, forceable = 0;
            var notMade = new List<string>();
            foreach (WePlannedElevation p in _plan.Items)
            {
                if (_excluded.Contains(p.Key) && p.Status <= WeStatus.Warning) { excluded++; continue; }
                if (p.Forced && (p.Action == WeAction.Create || p.Action == WeAction.Update)) forced++;
                if (p.CanForce && !p.Forced && p.Status > WeStatus.Warning) forceable++;
                switch (p.Action)
                {
                    case WeAction.Create: create++; break;
                    case WeAction.Update: update++; break;
                    case WeAction.Keep: keep++; break;
                    default:
                        if (p.Status > WeStatus.Warning) notMade.Add(ShortReason(p));
                        break;
                }
            }
            var parts = new List<string>();
            if (create > 0) parts.Add(create + " шинэ");
            if (update > 0) parts.Add(update + " шинэчлэгдэнэ");
            if (keep > 0) parts.Add(keep + " өөрчлөлтгүй");
            if (excluded > 0) parts.Add(excluded + " хассан");
            string s = parts.Count == 0 ? "Хийх зүйл алга" : string.Join(" · ", parts);
            bool sheetsMode = Settings.Output == WeOutputMode.ViewsAndSheets;
            if (create + update == 0 && !(sheetsMode && keep > 0) && parts.Count > 0)
                s = "Хийх өөрчлөлт алга (" + s + ") — шинэ дэлгээс хэрэгтэй бол мөрийг сонгох эсвэл тохиргоог өөрчлөнө үү";
            if (forced > 0) s += " (" + forced + " нь таны сонголтоор)";
            if (notMade.Count > 0)
                s += "     " + notMade.Count + " үүсэхгүй (" + string.Join(", ", notMade.GroupBy(x => x).Select(x => x.Count() > 1 ? x.Key + " ×" + x.Count() : x.Key)) + ")"
                     + (forceable > 0 ? " — " + forceable + "-ийг чагтлаад үүсгэж болно" : string.Empty);
            string anno = AnnotationSummary();
            if (anno.Length > 0) s += Environment.NewLine + anno;
            if (Settings.Output == WeOutputMode.ViewsAndSheets && _plan.Groups.Count > 0)
            {
                int kp = _plan.Groups.Count(g => g.KeyPlan != null), ax = _plan.Groups.Count(g => g.Axon != null);
                var ex = new List<string>();
                if (kp > 0) ex.Add(kp + " түлхүүр план");
                if (ax > 0) ex.Add(ax + " 3D");
                if (ex.Count > 0) s += Environment.NewLine + "Хуудсанд: " + string.Join(", ", ex) + " (өрөө тус бүр; байгааг нь шинэчилнэ)";
                s += Environment.NewLine + (string.IsNullOrEmpty(Settings.TargetSheetNumber)
                    ? "Хуудас: өрөө тус бүр НЭГ — бүх зураг тэнд (багтахгүй бол овоолж / хуудасны хажууд; үргэлжлэлийн хуудас үүсгэхгүй, масштаб хэвээр)"
                    : "Хуудас: «" + Settings.TargetSheetNumber + "» — бүх өрөөний шинэ зураг тэр хуудасны сул зайд")
                     + (Settings.ResetPlacement ? " · өмнөх хуудсыг дахин байрлуулна" : string.Empty);
            }
            // W05: дугаарлалтын урьдчилсан дүн — зөрчилтэй бол «Үүсгэх» идэвхгүй (засахаас өмнө загварт хүрэхгүй).
            _lastNumbering = _numbering != null ? _numbering(_plan, Settings, _excluded) : null;
            bool numberingOk = _lastNumbering == null || _lastNumbering.Ok;
            UpdateNumberingFields();
            if (_lastNumbering != null)
            {
                string line = _lastNumbering.Preview;
                if (_lastNumbering.Notes.Count > 0) line += (line.Length > 0 ? Environment.NewLine : string.Empty) + string.Join(Environment.NewLine, _lastNumbering.Notes);
                _numberingPreview.Text = numberingOk ? line : string.Join(Environment.NewLine, _lastNumbering.Errors);
                _numberingPreview.SetResourceReference(TextBlock.ForegroundProperty, numberingOk ? "FgMuted" : "Danger");
                if (!string.IsNullOrEmpty(_lastNumbering.Preview)) s += Environment.NewLine + _lastNumbering.Preview;
                if (!numberingOk) s += Environment.NewLine + "⚠ " + string.Join(" ", _lastNumbering.Errors);
            }
            _summary.Text = s;
            _summary.SetResourceReference(TextBlock.ForegroundProperty, numberingOk ? "Fg" : "Danger");

            bool sheets = Settings.Output == WeOutputMode.ViewsAndSheets;
            int work = create + update;
            string label = work > 0
                ? (create > 0 && update == 0 ? create + " дэлгээс үүсгэх" : create == 0 ? update + " дэлгээс шинэчлэх" : work + " дэлгээс үүсгэх/шинэчлэх")
                : (sheets && keep > 0 ? "Хуудсанд байрлуулах" : "Үүсгэх");
            _generate.Content = work > 0 && sheets ? label + " + хуудас" : label;
            _generate.IsEnabled = (work > 0 || (sheets && keep > 0)) && numberingOk;
            return _generate.IsEnabled;
        }

        /// <summary>«Танигдсан: Хана 2, Хаалга 1, Тавилга 4 · хэмжээс: хана, хаалга · spot: хаалга» — дэлгээст юу байгаа, юуг тэмдэглэхийг.</summary>
        private static string CensusText(WePlannedElevation p)
        {
            if (p.Annotation == null || p.Annotation.Census.Count == 0 || p.Frame == null || p.Status > WeStatus.Warning) return string.Empty;
            List<WeCensusEntry> c = p.Annotation.Census;
            string text = "Танигдсан: " + string.Join(", ", c.Select(x => x.Label + " " + x.Count));
            Func<Func<WeCensusEntry, bool>, string, string> part = (f, what) =>
            {
                List<string> l = c.Where(f).Select(x => x.Label.ToLowerInvariant()).ToList();
                return l.Count == 0 ? string.Empty : "  ·  " + what + ": " + string.Join(", ", l);
            };
            return text + part(x => x.Dimensioned, "хэмжээс") + part(x => x.Spotted, "spot") + part(x => x.Tagged, "шошго");
        }

        /// <summary>Бүлгийн хуудасны нэмэлт блок («+ түлхүүр план «205A-D» · 3D · 2 перспектив»).</summary>
        private string ExtrasText(string groupKey)
        {
            if (Settings.Output != WeOutputMode.ViewsAndSheets || _plan == null) return string.Empty;
            WeGroupInfo g = _plan.Groups.FirstOrDefault(x => x.GroupKey == groupKey);
            if (g == null) return string.Empty;
            var parts = new List<string>();
            if (g.KeyPlan != null) parts.Add("түлхүүр план «" + g.Label + "»");
            if (g.Axon != null) parts.Add("3D");
            if (Settings.Perspectives > 0) parts.Add(Settings.Perspectives + " перспективын байр");
            int lgCount = Settings.LegendNames != null ? Settings.LegendNames.Count : 0;
            if (lgCount > 0) parts.Add(lgCount == 1 ? "legend" : lgCount + " legend");
            return parts.Count == 0 ? string.Empty : "+ " + string.Join(" · ", parts);
        }

        /// <summary>Шинэ/шинэчлэх дэлгээсүүдэд тавигдах тэмдэглэгээний тоо — товч дарахаас өмнө юу гарахыг хэлнэ.</summary>
        private string AnnotationSummary()
        {
            int dims = 0, spots = 0, tags = 0, keys = 0;
            foreach (WePlannedElevation p in _plan.Items)
            {
                if (_excluded.Contains(p.Key) || (p.Action != WeAction.Create && p.Action != WeAction.Update) || p.Annotation == null) continue;
                dims += p.Annotation.Rows.Count;
                spots += p.Annotation.Spots.Count;
                tags += p.Annotation.Tags.Count(t => !t.Keynote);
                keys += p.Annotation.Tags.Count(t => t.Keynote);
            }
            var parts = new List<string>();
            if (dims > 0) parts.Add(dims + " хэмжээс");
            if (spots > 0) parts.Add(spots + " spot level");
            if (tags > 0) parts.Add(tags + " шошго");
            if (keys > 0) parts.Add(keys + " keynote");
            return parts.Count == 0 ? string.Empty : "Тэмдэглэгээ: " + string.Join(", ", parts);
        }

        /// <summary>
        /// «Ямар элемент дээр юу тавих» хүснэгт: мөр = элемент, багана = Spot level · Хэмжээс · Шошго · Keynote.
        /// Хамааралгүй нүдэнд (жишээ: давхрын шошго) checkbox байхгүй.  Нүд бүрийн tooltip нь яг юу тавигдахыг хэлнэ.
        /// </summary>
        private UIElement AnnotationPanel(IList<string> dimTypes, IList<string> spotTypes, IList<string> keynoteTypes)
        {
            var panel = new StackPanel { Margin = new Thickness(0, 4, 0, 0) };
            var grid = new Grid();
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            string[] cols = { WeAnno.Spot, WeAnno.Dim, WeAnno.Tag, WeAnno.Keynote };
            string[] heads = { "Spot level", "Хэмжээс", "Шошго", "Keynote" };
            foreach (string c in cols) grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(58) });
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            var corner = new TextBlock { Text = "Элемент", VerticalAlignment = VerticalAlignment.Bottom, Margin = new Thickness(0, 0, 0, 4) };
            corner.SetResourceReference(TextBlock.ForegroundProperty, "FgMuted");
            grid.Children.Add(corner);
            for (int i = 0; i < cols.Length; i++)
            {
                var h = new TextBlock { Text = heads[i], TextAlignment = TextAlignment.Center, TextWrapping = TextWrapping.Wrap, VerticalAlignment = VerticalAlignment.Bottom, Margin = new Thickness(0, 0, 0, 4) };
                h.SetResourceReference(TextBlock.ForegroundProperty, "FgMuted");
                Grid.SetColumn(h, i + 1);
                grid.Children.Add(h);
            }
            HashSet<string> on = WeAnno.Parse(Settings.Annotations);
            int row = 1;
            foreach (WeAnno.Row r in WeAnno.Rows)
            {
                grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
                // W09: Revit-ийн англи ангиллын нэр (танихад) — нэгтгэсэн мөрөнд «Group: …», яг аль ангилал нь tooltip-д.
                var label = new TextBlock { TextWrapping = TextWrapping.Wrap, VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(0, 3, 4, 3), ToolTip = r.Categories };
                label.Inlines.Add(new Run(r.Label));
                if (!string.IsNullOrEmpty(r.English))
                {
                    var en = new Run("  " + r.English) { FontSize = 11 };
                    en.SetResourceReference(TextElement.ForegroundProperty, "FgMuted");
                    label.Inlines.Add(en);
                }
                Grid.SetRow(label, row);
                grid.Children.Add(label);
                for (int i = 0; i < cols.Length; i++)
                {
                    string cell = WeAnno.Cell(r.Key, cols[i]);
                    UIElement el;
                    if (WeAnno.Applicable(r.Key, cols[i]))
                    {
                        var cb = new CheckBox { IsChecked = on.Contains(cell), HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center, ToolTip = CellHint(r, cols[i]) };
                        MglAuto.Name(cb, r.Label + " — " + heads[i]);
                        _anno[cell] = cb;
                        el = cb;
                    }
                    else
                    {
                        var dash = new TextBlock { Text = "–", HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center };
                        dash.SetResourceReference(TextBlock.ForegroundProperty, "FgMuted");
                        el = dash;
                    }
                    Grid.SetRow(el, row);
                    Grid.SetColumn(el, i + 1);
                    grid.Children.Add(el);
                }
                row++;
            }
            panel.Children.Add(grid);
            TextBlock hint = MglUi.Muted("Босоо 1-р эгнээ: шалны зузаан · шалны дээд · таазны доод · дээд хучилтын доод.  2-р эгнээ: давхар хооронд.  "
                                       + "Хэвтээ гинж: сонгосон элементийн ирмэг, тэнхлэг (хоорондын зай) + нийт урт.  Хаалганд spot зөвхөн дээд ирмэгт.");
            hint.TextWrapping = TextWrapping.Wrap;
            hint.Margin = new Thickness(0, 6, 0, 2);
            panel.Children.Add(hint);
            _separated.IsChecked = Settings.DimGrouping == WeDimGrouping.Separated;
            _separated.ToolTip = "Дэлгээснээс гадагш: тоноглол, тавилга · хаалга, цонх · хана, тэнхлэг · нийт урт.  Унтраавал нэг холимог гинж.";
            _overall.IsChecked = Settings.OverallRow;
            panel.Children.Add(_separated);
            panel.Children.Add(_overall);

            var dt = new List<string> { DefaultChoice };
            if (dimTypes != null) dt.AddRange(dimTypes);
            Fill(_dimType, dt, string.IsNullOrEmpty(Settings.DimTypeName) ? DefaultChoice : Settings.DimTypeName);
            var st = new List<string> { DefaultChoice };
            if (spotTypes != null) st.AddRange(spotTypes);
            Fill(_spotType, st, string.IsNullOrEmpty(Settings.SpotTypeName) ? DefaultChoice : Settings.SpotTypeName);
            var kt = new List<string> { DefaultChoice };
            if (keynoteTypes != null) kt.AddRange(keynoteTypes);
            Fill(_keynoteType, kt, string.IsNullOrEmpty(Settings.KeynoteTypeName) ? DefaultChoice : Settings.KeynoteTypeName);
            Row(panel, "Хэмжээсийн төрөл", _dimType);
            Row(panel, "Spot level-ийн төрөл", _spotType);
            Row(panel, "Keynote-ийн төрөл", _keynoteType);
            _annoOffset.Text = Fmt(Settings.DimOffsetMm);
            _annoStep.Text = Fmt(Settings.DimStepMm);
            return panel;
        }

        private static string CellHint(WeAnno.Row r, string col)
        {
            switch (col)
            {
                case WeAnno.Spot: return r.SpotHint;
                case WeAnno.Dim: return r.DimHint;
                case WeAnno.Tag: return r.Label + " — элемент дээр шошго (ангиллын өгөгдмөл шошго)";
                default: return r.Label + " — keynote (дэлгээсийн дээр, leader-ээр элемент рүү)";
            }
        }

        // ── Текст ────────────────────────────────────────────────

        private static string DirectionText(WePlannedElevation p)
        {
            if (p.PlanLook.IsZero) return string.IsNullOrEmpty(p.WallLabel) ? "Хана" : p.WallLabel;
            string dir = WeNaming.CompassName(p.PlanLook) + " хана";
            if (p.Kind == WeSourceKind.Wall)
                return (p.Side == WeSide.Interior ? "Дотор тал" : "Гадна тал") + " · " + (string.IsNullOrEmpty(p.WallLabel) ? dir : p.WallLabel);
            return dir;
        }

        private static string ShortReason(WePlannedElevation p)
        {
            string m = p.Message ?? string.Empty;
            if (m.StartsWith("Муруй", StringComparison.Ordinal)) return "муруй";
            if (m.StartsWith("Налуу", StringComparison.Ordinal)) return "налуу";
            if (m.Contains("давхардал")) return "давхардсан";
            if (p.Status == WeStatus.Failed) return "алдаа";
            if (p.Status == WeStatus.RequiresReview) return "шалгах";
            return "дэмжигдэхгүй";
        }

        private string ActionText(WePlannedElevation p)
        {
            if (_excluded.Contains(p.Key) && p.Status <= WeStatus.Warning) return "хассан";
            switch (p.Action)
            {
                case WeAction.Create: return p.Forced ? "шинэ (таны сонголт)" : "шинэ";
                case WeAction.Update: return p.Forced ? "шинэчлэх (таны сонголт)" : "шинэчлэх";
                case WeAction.Keep: return "өөрчлөлтгүй";
                default: return p.Status > WeStatus.Warning ? (p.CanForce ? "үүсэхгүй · чагтлах" : "үүсэхгүй") : "алгасна";
            }
        }

        private string ActionTone(WePlannedElevation p)
        {
            if (_excluded.Contains(p.Key)) return "FgMuted";
            switch (p.Action)
            {
                case WeAction.Create: return "Ok";
                case WeAction.Update: return "Accent";
                case WeAction.Keep: return "FgMuted";
                default: return p.Status > WeStatus.Warning ? "Danger" : "FgMuted";
            }
        }

        private static string StatusMark(WePlannedElevation p)
        {
            switch (p.Status)
            {
                case WeStatus.Warning: return "⚠";
                case WeStatus.RequiresReview: return "?";
                case WeStatus.Ready: return "✓";
                default: return "✖";
            }
        }

        private static string StatusTone(WePlannedElevation p)
        {
            switch (p.Status)
            {
                case WeStatus.Ready: return "Ok";
                case WeStatus.Warning:
                case WeStatus.RequiresReview: return "Warn";
                default: return "Danger";
            }
        }

        private WeSettings Read()
        {
            WeSettings s = Settings.Clone();
            s.ViewKind = _viewKind.SelectedIndex == 1 ? WeViewKind.Section : WeViewKind.Elevation;
            s.ViewTypeName = _viewType.SelectedIndex <= 0 ? string.Empty : (_viewType.SelectedItem as string ?? string.Empty);
            int ti = _template.SelectedIndex;
            string tplName = ti <= 0 ? WeSettings.TemplateTypeDefault : ti == 1 ? WeSettings.TemplateNone : (_template.SelectedItem as string ?? string.Empty);
            s.Scale = ParseInt(ComboText(_scale), -1);
            s.PaddingMm = ParseDouble(_padding.Text);
            s.NearOffsetMm = ParseDouble(_near.Text);
            s.FarDepthMm = ParseDouble(_far.Text);
            s.NamePattern = (_pattern.Text ?? string.Empty).Trim();
            if (_hasWalls) s.WallSide = _wallSide.SelectedIndex < 0 ? WeWallSidePick.Exterior : (WeWallSidePick)_wallSide.SelectedIndex;
            s.Output = _viewsSheets.IsChecked == true ? WeOutputMode.ViewsAndSheets : WeOutputMode.ViewsOnly;
            // Эхний мөр = автомат (төслийн стандарт хүрээ) — хоосон нэр.
            s.TitleBlockName = _titleBlock.SelectedIndex <= 0 ? string.Empty : (_titleBlock.SelectedItem as string ?? string.Empty);
            s.SheetNumberPattern = (_sheetPattern.Text ?? string.Empty).Trim();
            s.TargetSheetNumber = _targetSheet.SelectedIndex <= 0 ? string.Empty : SheetNumberOf(_targetSheet.SelectedItem as string);
            s.ResetPlacement = _resetPlacement.IsChecked == true;
            if (_folders != null && _folders.Selectable && _folderBoxes.Count > 0)
            {
                List<string> chosen = FolderChoice();
                s.SheetFolders = _folders.ToSettings(chosen);
                s.SheetFoldersMove = _folders.Changed(chosen);
                s.SheetFoldersPath = _folders.Describe(chosen);
            }
            s.SheetMarginMm = ParseDouble(_sheetMargin.Text);
            s.UpdateExisting = _update.IsChecked == true;
            s.HideOtherMarkers = _hideMarkers.IsChecked == true;
            string anno = WeAnno.Format(_anno.Where(kv => kv.Value.IsChecked == true).Select(kv => kv.Key));
            s.DimTypeName = _dimType.SelectedIndex <= 0 ? string.Empty : (_dimType.SelectedItem as string ?? string.Empty);
            s.SpotTypeName = _spotType.SelectedIndex <= 0 ? string.Empty : (_spotType.SelectedItem as string ?? string.Empty);
            s.KeynoteTypeName = _keynoteType.SelectedIndex <= 0 ? string.Empty : (_keynoteType.SelectedItem as string ?? string.Empty);
            s.DimOffsetMm = ParseDouble(_annoOffset.Text);
            s.DimStepMm = ParseDouble(_annoStep.Text);
            s.DimGrouping = _separated.IsChecked == true ? WeDimGrouping.Separated : WeDimGrouping.Combined;
            s.OverallRow = _overall.IsChecked == true;
            bool keyPlan = _keyPlan.IsChecked == true, axon = _axon.IsChecked == true;
            int persp = Math.Max(0, _persp.SelectedIndex);
            s.RenderPlacement = _renderPlace.SelectedIndex == 1 ? WeRenderPlacement.AllSheets : WeRenderPlacement.LastSheet;
            s.LegendNames = _legendChecks.Where(c => c.IsChecked == true).Select(c => c.Tag as string).Where(n => !string.IsNullOrEmpty(n)).ToList();
            WeFadeMode fade = _fadeMode.SelectedIndex == 1 ? WeFadeMode.AboveHeight : _fadeMode.SelectedIndex == 2 ? WeFadeMode.None : WeFadeMode.AboveCeiling;
            // Өндрийн талбар зөвхөн «өгсөн өндөр» горимд шалгагдана — бусад горимд буруу бичвэр тохиргоог эвдэхгүй.
            double fh = ParseDouble(_fadeHeight.Text);
            s.FadeHeightMm = fade == WeFadeMode.AboveHeight || !double.IsNaN(fh) ? fh : Settings.FadeHeightMm;
            if (fade != WeFadeMode.AboveHeight && (double.IsNaN(s.FadeHeightMm) || s.FadeHeightMm < 300 || s.FadeHeightMm > 20000)) s.FadeHeightMm = Settings.FadeHeightMm;
            s.FadeOpacity = fade == WeFadeMode.None ? Settings.FadeOpacity : ParseInt(_fadeOpacity.Text, -1);
            s.RedFrame = _redFrame.IsChecked == true;
            s.SheetParams = new Dictionary<string, string>(StringComparer.Ordinal);
            if (_typeChoice != null && _typeChoice.Selectable && _typeDesignator.IsEnabled)
            {
                string tv = (_typeDesignator.Text ?? string.Empty).Trim();
                if (tv.Length > 0 && tv != NoWrite) s.SheetParams[_typeChoice.ParamName] = tv;
            }
            s.MergeCollinear = _merge.IsChecked == true;
            s.DepthMode = _depthMode.SelectedIndex == 1 ? WeDepthMode.Fixed : WeDepthMode.HalfRoom;
            s.MaxDepthMm = ParseDouble(_maxDepth.Text);
            s.LabelPattern = (_labelPattern.Text ?? string.Empty).Trim();
            s.TitlePattern = (_titlePattern.Text ?? string.Empty).Trim();
            s.SheetNamePattern = (_sheetName.Text ?? string.Empty).Trim();
            s.LabelMode = _labelMode.SelectedIndex == 1 ? WeLabelMode.Numbers : WeLabelMode.Letters;
            s.LabelStart = ParseInt(_labelStart.Text, -1);
            s.LabelEnd = ParseInt(_labelEnd.Text, -1);
            s.LabelDigits = ParseInt(_labelDigits.Text, -1);
            s.LabelContinuous = _labelContinuous.IsChecked == true;
            s.SheetNumberMode = _sheetMode.SelectedIndex == 1 ? WeSheetNumberMode.Range : WeSheetNumberMode.Pattern;
            s.SheetRangePrefix = (_sheetPrefix.Text ?? string.Empty).Trim();
            s.SheetRangeStart = ParseInt(_sheetStart.Text, -1);
            s.SheetRangeEnd = ParseInt(_sheetEnd.Text, -1);
            s.SheetRangeDigits = ParseInt(_sheetDigits.Text, -1);
            s.KeyPlanScale = ParseInt(ComboText(_keyScale), -1);
            s.AxonScale = ParseInt(ComboText(_axonScale), -1);
            s.SheetBottomBandMm = ParseDouble(_bottomBand.Text);
            s.Overrides = _overrides.Copy();
            s.Crops = _crops.Copy();
            s.Forced = new HashSet<string>(_forced, StringComparer.Ordinal);
            if (_render != null) s.LivePreview = _previewOn.IsChecked == true;
            // W09: зориулалттай холбогдох утгууд — ЗАСАЖ БУЙ зориулалтад («Тусгай» бол ерөнхий утгууд); бусад зориулалт хэвээр.
            WePreset ep = s.PresetOf(_editPreset);
            ep.TemplateName = tplName;
            ep.Annotations = anno;
            ep.KeyPlan = keyPlan;
            ep.Axon = axon;
            ep.Perspectives = persp;
            ep.FadeMode = fade;
            s.SetPreset(ep);
            s.DefaultPreset = _defaultPreset.SelectedIndex >= 0 && _defaultPreset.SelectedIndex < WePresetId.All.Length ? WePresetId.All[_defaultPreset.SelectedIndex] : WePresetId.Custom;
            s.RoomPresets = new Dictionary<string, string>(_roomPresets, StringComparer.Ordinal);
            return s;
        }

        // ── W09: зориулалт ───────────────────────────────────────

        /// <summary>Сонгосон өрөөний зориулалт засаж буйтай ялгаатай бол удирдлагуудыг тэр зориулалтаар дүүргэнэ (Settings аль хэдийн шинэ).</summary>
        private void SyncEditPreset()
        {
            WePlannedElevation sel = SelectedItem();
            string want = sel != null ? sel.PresetId : (WePresetId.IsKnown(Settings.DefaultPreset) ? Settings.DefaultPreset : WePresetId.Custom);
            if (!WePresetId.IsKnown(want)) want = WePresetId.Custom;
            if (want != _editPreset)
            {
                _editPreset = want;
                LoadPresetControls(want);
            }
            else UpdatePresetCaption();
        }

        /// <summary>Зориулалтын утгуудыг удирдлагуудад (Replan өдөөхгүй).</summary>
        private void LoadPresetControls(string id)
        {
            WePreset p = Settings.PresetOf(id);
            bool was = _loading;
            _loading = true;
            try
            {
                HashSet<string> on = WeAnno.Parse(p.Annotations);
                foreach (KeyValuePair<string, CheckBox> kv in _anno) kv.Value.IsChecked = on.Contains(kv.Key);
                _fadeMode.SelectedIndex = p.FadeMode == WeFadeMode.AboveHeight ? 1 : p.FadeMode == WeFadeMode.None ? 2 : 0;
                _fadeHeight.IsEnabled = _fadeMode.SelectedIndex == 1;
                _fadeOpacity.IsEnabled = _fadeMode.SelectedIndex != 2;
                _keyPlan.IsChecked = p.KeyPlan;
                _axon.IsChecked = p.Axon;
                _persp.SelectedIndex = Math.Max(0, Math.Min(4, p.Perspectives));
                int ti = string.IsNullOrEmpty(p.TemplateName) ? 0 : p.TemplateName == WeSettings.TemplateNone ? 1 : _template.Items.IndexOf(p.TemplateName);
                _template.SelectedIndex = ti < 0 ? 0 : ti;
            }
            finally { _loading = was; }
            UpdatePresetCaption();
        }

        private void UpdatePresetCaption()
        {
            string title = WePresetCatalog.Title(_editPreset);
            List<string> rooms = _plan == null ? new List<string>()
                : _plan.Items.Where(i => i.Kind == WeSourceKind.Room && i.PresetId == _editPreset).Select(i => (i.RoomNumber ?? string.Empty).Trim())
                       .Where(n => n.Length > 0).Distinct().ToList();
            _presetCaption.Text = "«" + title + "» зориулалтын тохиргоо" + (rooms.Count > 0 ? " — өрөө " + string.Join(", ", rooms.Take(6)) + (rooms.Count > 6 ? " …" : string.Empty) : string.Empty)
                                  + "  (загвар, тод/бүдэг, тэмдэглэгээ, түлхүүр план, 3D, рендерийн байр)";
            _presetInfo.Text = WePresetCatalog.Description(_editPreset)
                               + (WePresetCatalog.PendingSample(_editPreset) ? "  ⚠ Компанийн ариун цэврийн өрөөний хуудасны жишээ хүлээгдэж байна — энэ нь СУУРЬ, «зөв стандарт» биш." : string.Empty);
            _presetReset.IsEnabled = _editPreset != WePresetId.Custom && !Settings.PresetOf(_editPreset).SameAs(WePresetCatalog.BuiltIn(_editPreset));
            // «Тэмдэглэгээ» хэсгийн толгой ХЭВЭЭР (UI automation, gate driver нэрээр нь олдог) — зориулалт нь тайлбарт.
            if (_annoExpander != null) _annoExpander.ToolTip = "Энэ хүснэгт «" + title + "» зориулалтынх (сонгосон өрөөний).";
        }

        /// <summary>Өрөөний толгой: «Зориулалт: [Интерьер ▾] (санал: нэрэнд «WC» байна)» + хэрэглээгүй саналд «хэрэглэх».</summary>
        private UIElement PresetLine(List<WePlannedElevation> items)
        {
            WePlannedElevation f = items.FirstOrDefault(i => i.Kind == WeSourceKind.Room && !string.IsNullOrEmpty(i.RoomUid));
            if (f == null) return null;
            var line = new WrapPanel { Margin = new Thickness(0, 0, 0, 4) };
            var lab = new TextBlock { Text = "Зориулалт:", VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(0, 0, 6, 0) };
            line.Children.Add(lab);
            var cb = new ComboBox { MinWidth = 170, VerticalAlignment = VerticalAlignment.Center };
            foreach (string id in WePresetId.All) cb.Items.Add(WePresetCatalog.Title(id));
            cb.SelectedIndex = Math.Max(0, Array.IndexOf(WePresetId.All, f.PresetId));
            cb.ToolTip = WePresetCatalog.Description(f.PresetId);
            MglAuto.Name(cb, "Өрөөний зориулалт " + f.GroupLabel);
            MglAuto.LabelFor(lab, cb);
            string uid = f.RoomUid, key = f.Key;
            cb.SelectionChanged += (s, e) =>
            {
                if (_loading || cb.SelectedIndex < 0) return;
                _roomPresets[uid] = WePresetId.All[cb.SelectedIndex];
                if (_plan == null || !_plan.Items.Any(i => i.Key == _selectedKey && i.RoomUid == uid)) _selectedKey = key;
                Replan();
            };
            line.Children.Add(cb);
            string why = f.PresetSource == WePresetSource.Chosen ? "таны сонголт"
                       : f.PresetSource == WePresetSource.Stored ? "өмнө үүсгэсэн дэлгээсээс"
                       : f.PresetSource == WePresetSource.Suggested ? "санал: " + f.PresetReason
                       : "өгөгдмөл";
            TextBlock w = Muted("  (" + why + ")", 0);
            w.VerticalAlignment = VerticalAlignment.Center;
            line.Children.Add(w);
            if (f.SuggestedPreset != null && f.SuggestedPreset != f.PresetId && f.PresetSource != WePresetSource.Chosen)
            {
                var apply = new Button { Content = "Санал: " + WePresetCatalog.Title(f.SuggestedPreset) + " — хэрэглэх", Padding = new Thickness(8, 0, 8, 0), Margin = new Thickness(8, 0, 0, 0),
                                         ToolTip = "Шалтгаан: " + f.SuggestedReason + Environment.NewLine + WePresetCatalog.Description(f.SuggestedPreset) };
                MglAuto.Name(apply, "Зориулалтын санал хэрэглэх " + f.GroupLabel);
                string sug = f.SuggestedPreset;
                apply.Click += (s, e) => { _roomPresets[uid] = sug; _selectedKey = key; Replan(); };
                line.Children.Add(apply);
            }
            return line;
        }

        // ── Туслах ───────────────────────────────────────────────

        private static TextBox Num() { return new TextBox { MinWidth = 70, Padding = new Thickness(4, 2, 4, 2) }; }

        /// <summary>Дугаарлалтын талбарууд горимоор идэвхжинэ (тоон горимд муж, хуудасны мужид угтвар …).</summary>
        private void UpdateNumberingFields()
        {
            bool numbers = _labelMode.SelectedIndex == 1;
            _labelStart.IsEnabled = numbers;
            _labelEnd.IsEnabled = numbers;
            _labelDigits.IsEnabled = numbers;
            bool range = _sheetMode.SelectedIndex == 1 && _viewsSheets.IsChecked == true;
            _sheetPrefix.IsEnabled = range;
            _sheetStart.IsEnabled = range;
            _sheetEnd.IsEnabled = range;
            _sheetDigits.IsEnabled = range;
            _sheetPattern.IsEnabled = !range;
        }

        private static void AddCell(Grid g, int col, string label, Control input)
        {
            var sp = new StackPanel();
            var l = new TextBlock { Text = label, Margin = new Thickness(0, 0, 0, 2), TextWrapping = TextWrapping.Wrap };
            MglAuto.LabelFor(l, input);
            sp.Children.Add(l);
            sp.Children.Add(input);
            Grid.SetColumn(sp, col);
            g.Children.Add(sp);
        }

        /// <summary>«BA428 — 101 ХАНЫН ДЭЛГЭЭС» → «BA428» (хуудасны жагсаалтын мөрөөс дугаар).</summary>
        internal static string SheetNumberOf(string label)
        {
            if (string.IsNullOrWhiteSpace(label)) return string.Empty;
            int i = label.IndexOf(" — ", StringComparison.Ordinal);
            return (i > 0 ? label.Substring(0, i) : label).Trim();
        }

        /// <summary>Засварлах боломжтой ComboBox-ийн утга: жагсаалтаас сонгосон эсвэл бичиж буй.</summary>
        private static string ComboText(ComboBox cb)
        {
            string t = cb.SelectedItem as string;
            if (cb.IsKeyboardFocusWithin || string.IsNullOrEmpty(t)) t = cb.Text;
            return t;
        }

        private static string Fmt(double v) { return v.ToString("0.##", CultureInfo.InvariantCulture); }

        private static int ParseInt(string t, int fallback)
        {
            int r;
            return int.TryParse((t ?? string.Empty).Trim(), NumberStyles.Integer, CultureInfo.InvariantCulture, out r) ? r : fallback;
        }

        /// <summary>«300», «300,5», «300.5» — буруу бол NaN (Validate барина).</summary>
        private static double ParseDouble(string t)
        {
            string s = (t ?? string.Empty).Trim().Replace(',', '.');
            double r;
            return double.TryParse(s, NumberStyles.Float, CultureInfo.InvariantCulture, out r) ? r : double.NaN;
        }

        private static void Fill(ComboBox cb, IEnumerable<string> items, string selected)
        {
            cb.Items.Clear();
            foreach (string i in items) cb.Items.Add(i);
            int idx = -1;
            for (int i = 0; i < cb.Items.Count; i++)
                if (string.Equals(cb.Items[i] as string, selected, StringComparison.Ordinal)) { idx = i; break; }
            cb.SelectedIndex = idx >= 0 ? idx : (cb.Items.Count > 0 ? 0 : -1);
        }

        /// <summary>
        /// «Ажлын зургийн бүрдэлд» (2026-10-14, интерьерийн баг): хуудсыг Project Browser-ийн аль бүлэг, хэсэгт оруулах.  Бүлэглэлтийн түвшин бүрд
        /// засаж болох жагсаалт — төслийн хуудсуудын одоогийн бүлгүүд (дээд түвшний сонголтоор шүүсэн); шинэ нэр бичвэл шинэ бүлэг үүснэ.
        /// </summary>
        private UIElement FolderPanel()
        {
            var box = new StackPanel();
            box.Children.Add(new TextBlock { Text = "Ажлын зургийн бүрдэлд", Margin = new Thickness(0, 12, 0, 0), FontWeight = FontWeights.SemiBold });
            if (_folders == null || !_folders.Selectable)
            {
                string why = _folders == null ? "Project Browser-ийн хуудасны бүлэглэлт уншигдсангүй."
                    : !string.IsNullOrEmpty(_folders.Problem) ? _folders.Problem
                    : "Project Browser-ийн бүлэг бүр хуудасны дугаар, нэр эсвэл бичигдэхгүй параметрээс хамаардаг — тохируулах зүйл алга ("
                      + string.Join(", ", _folders.Levels.Select(l => l.Name)) + ").";
                box.Children.Add(Muted(why, 0));
                return box;
            }
            for (int i = 0; i < _folders.Levels.Count; i++)
            {
                WeFolderLevel l = _folders.Levels[i];
                if (!l.Settable)
                {
                    TextBlock t = Muted(l.Name + ": " + l.Why, 0);
                    t.Margin = new Thickness(0, 8, 0, 0);
                    box.Children.Add(t);
                    _folderBoxes.Add(null);
                    continue;
                }
                var cb = new ComboBox { IsEditable = true, IsTextSearchEnabled = true, StaysOpenOnEdit = true };
                cb.ToolTip = "«" + l.Name + "» — жагсаалтаас сонгох эсвэл шинэ нэр бичих (хоосон = «???» бүлэг).";
                if (WeSheetDiscipline.ValueFor(Settings.FixedSheetParams, l.Name) != null)
                {
                    // Интерьерийн хэрэгсэл: тогтмол ангилал — өөрчлөхгүй (Default-д аль хэдийн бичсэн).
                    cb.IsEnabled = false;
                    cb.ToolTip = "Интерьерийн хэрэгсэл — «" + l.Name + "» үргэлж «" + WeSheetDiscipline.ValueFor(Settings.FixedSheetParams, l.Name) + "».";
                }
                MglAuto.Name(cb, "Хуудасны бүлэг: " + l.Name);
                Row(box, l.Name, cb);
                int level = _folderBoxes.Count;
                _folderBoxes.Add(cb);
                cb.AddHandler(TextBoxBase.TextChangedEvent, new TextChangedEventHandler((o, e) => FolderEdited(level)));
                cb.SelectionChanged += (o, e) => Dispatcher.BeginInvoke(new Action(() => FolderEdited(level)));
            }
            _folderPath.SetResourceReference(TextBlock.ForegroundProperty, "FgMuted");
            MglAuto.Name(_folderPath, "Хуудасны бүлгийн зам");
            box.Children.Add(_folderPath);
            string src = _folders.DefaultSource != null ? "Анхны утга: " + _folders.DefaultSource + ".  " : string.Empty;
            box.Children.Add(Muted(src + "Өөрчилбөл энэ өрөөнүүдийн өмнө үүсгэсэн хуудас ч тэнд шилжинэ.", 0));
            FillFolders(_folders.Default, 0);
            return box;
        }

        /// <summary>Одоогийн сонголт, түвшин бүрд ("" = хоосон).</summary>
        private List<string> FolderChoice()
        {
            var list = new List<string>();
            for (int i = 0; i < _folders.Levels.Count; i++)
            {
                ComboBox cb = i < _folderBoxes.Count ? _folderBoxes[i] : null;
                list.Add(cb == null ? string.Empty : WeSheetFolders.Normalize(cb.Text));
            }
            return list;
        }

        /// <summary>
        /// <paramref name="from"/>-оос доош түвшний жагсаалтыг дээд түвшний сонголтоор шүүж дүүргэнэ (бичиж буй түвшнийг хөндөхгүй — курсор алдагдахгүй).
        /// <paramref name="values"/> өгвөл бичвэрийг тэгнэ, үгүй бол одоогийнхыг хадгална.
        /// </summary>
        private void FillFolders(IList<string> values, int from)
        {
            if (_folders == null) return;
            _folderFilling = true;
            try
            {
                List<string> chosen = values != null ? values.Select(WeSheetFolders.Normalize).ToList() : FolderChoice();
                while (chosen.Count < _folders.Levels.Count) chosen.Add(string.Empty);
                for (int i = Math.Max(0, from); i < _folderBoxes.Count; i++)
                {
                    ComboBox cb = _folderBoxes[i];
                    if (cb == null) continue;
                    string keep = chosen[i];
                    cb.Items.Clear();
                    foreach (string o in _folders.OptionsFor(i, chosen)) cb.Items.Add(o);
                    cb.Text = keep;
                }
                _folderPath.Text = "→ " + _folders.Describe(chosen);
            }
            finally { _folderFilling = false; }
        }

        private void FolderEdited(int level)
        {
            if (_folderFilling) return;
            FillFolders(null, level + 1);
        }

        /// <summary>
        /// Хуудасны «* Type Designator» (2026-10-14, интерьерийн баг 3-р тойрог) — төслийн хуудсуудад бичигдсэн утгаас сонгох эсвэл шинээр бичих.
        /// Project Browser нь энэ параметрээр бүлэглэдэг бол дээрх «Ажлын зургийн бүрдэлд» хэсэг аль хэдийн сонгуулна (давхардуулахгүй).
        /// </summary>
        private UIElement TypeDesignatorPanel()
        {
            var box = new StackPanel();
            _typeDesignator.IsEnabled = false;
            if (_typeChoice == null) return box;
            string label = "Хуудасны «" + (_typeChoice.ParamName ?? WeSheetDiscipline.TypeDesignatorParam) + "»";
            string key = WeSheetDiscipline.NormalizeName(_typeChoice.ParamName);
            if (_folders != null && _folders.Selectable && _folders.Levels.Any(l => l.Settable && WeSheetDiscipline.NormalizeName(l.Name) == key))
            {
                TextBlock t = Muted(label + " — дээрх «Ажлын зургийн бүрдэлд» хэсгээс сонгоно (Project Browser үүгээр бүлэглэдэг).", 0);
                t.Margin = new Thickness(0, 8, 0, 0);
                box.Children.Add(t);
                return box;
            }
            if (!_typeChoice.Selectable)
            {
                TextBlock t = Muted(label + ": " + (_typeChoice.Problem ?? "сонгох боломжгүй."), 0);
                t.Margin = new Thickness(0, 8, 0, 0);
                MglAuto.Name(t, "Type Designator тайлбар");
                box.Children.Add(t);
                return box;
            }
            _typeDesignator.IsEnabled = true;
            _typeDesignator.Items.Clear();
            _typeDesignator.Items.Add(NoWrite);
            foreach (string v in _typeChoice.Values) _typeDesignator.Items.Add(v);
            // «+ Өрөө нэмэх»-ээс дахин нээгдэхэд өмнө сонгосон утга хэвээр.
            string carried = WeSheetDiscipline.ValueFor(Settings.SheetParams, _typeChoice.ParamName);
            _typeDesignator.Text = !string.IsNullOrEmpty(carried) ? carried : string.IsNullOrEmpty(_typeChoice.Default) ? NoWrite : _typeChoice.Default;
            _typeDesignator.ToolTip = "Шинэ хуудсанд (мөн энэ өрөөний өмнөх хуудсанд) бичнэ.  Жагсаалт = төслийн хуудсуудад бичигдсэн утга (олон хэрэглэгдсэн нь эхэнд); шинээр бичиж болно.  "
                                      + NoWrite + " = хөндөхгүй.";
            MglAuto.Name(_typeDesignator, "Type Designator");
            Row(box, label, _typeDesignator);
            if (!string.IsNullOrEmpty(_typeChoice.DefaultSource))
                box.Children.Add(Muted("Анхны утга: " + _typeChoice.DefaultSource + ".", 0));
            return box;
        }

        /// <summary>
        /// «Legend (материал)» — төслийн legend бүр чагттай (хэдийг ч сонгоно); олон бол гүйлгэнэ.  3-р тойрог (2026-10-14): дээр нь ХАЙЛТ — нэр эсвэл
        /// legend доторх таних тэмдгээр («ЗХ-01-С», том жижиг үсэг, зураас, кирилл/латин ижил дүрстэй үсэг үл тоогдоно).  Сонгосон нь үргэлж харагдана;
        /// Enter = эхний олдсоныг чагтлах.
        /// </summary>
        private UIElement LegendPanel()
        {
            var box = new StackPanel();
            box.Children.Add(new TextBlock { Text = "Legend (материал) — хэдийг ч сонгоно", Margin = new Thickness(0, 8, 0, 2) });
            if (_legendChecks.Count == 0)
            {
                box.Children.Add(Muted("Төсөлд legend харагдац алга.", 0));
                return box;
            }
            var searchRow = new DockPanel { Margin = new Thickness(0, 0, 0, 3) };
            var icon = new TextBlock { Text = "Хайх:", VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(0, 0, 6, 0) };
            DockPanel.SetDock(icon, Dock.Left);
            searchRow.Children.Add(icon);
            _legendSearch.ToolTip = "Нэр эсвэл таних тэмдэг (жишээ «ЗХ-01-С», «зх01с»).  Enter = эхний олдсоныг чагтлах, Esc = цэвэрлэх.";
            MglAuto.Name(_legendSearch, "Legend хайх");
            searchRow.Children.Add(_legendSearch);
            box.Children.Add(searchRow);
            var frame = new Border { BorderThickness = new Thickness(1), CornerRadius = new CornerRadius(3), Padding = new Thickness(6, 3, 6, 3) };
            frame.SetResourceReference(Border.BorderBrushProperty, "Line");
            frame.Child = new ScrollViewer { Content = _legendList, MaxHeight = 180, VerticalScrollBarVisibility = ScrollBarVisibility.Auto, HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled };
            MglAuto.Name(frame, "Legend-ийн жагсаалт");
            box.Children.Add(frame);
            _legendCount.SetResourceReference(TextBlock.ForegroundProperty, "FgMuted");
            MglAuto.Name(_legendCount, "Legend-ийн тоо");
            box.Children.Add(_legendCount);
            _legendSearch.TextChanged += (s, e) => FilterLegends();
            // PreviewKeyDown + Handled: Enter нь цонхны «Үүсгэх» (IsDefault) товчийг ДАРАХГҮЙ.
            _legendSearch.PreviewKeyDown += (s, e) =>
            {
                if (e.Key == Key.Escape && !string.IsNullOrEmpty(_legendSearch.Text)) { _legendSearch.Text = string.Empty; e.Handled = true; }
                else if (e.Key == Key.Enter)
                {
                    CheckBox first = _legendChecks.FirstOrDefault(c => c.Visibility == Visibility.Visible && c.IsChecked != true);
                    if (first != null) first.IsChecked = true;
                    e.Handled = true;
                }
            };
            foreach (CheckBox c in _legendChecks)
            {
                c.Checked += (s, e) => FilterLegends();
                c.Unchecked += (s, e) => FilterLegends();
            }
            FilterLegends();
            return box;
        }

        /// <summary>Хайлтаар шүүнэ — сонгосон нь үргэлж харагдана (нуугдсан сонголт гэж байхгүй).</summary>
        private void FilterLegends()
        {
            string q = _legendSearch.Text ?? string.Empty;
            int shown = 0, matched = 0;
            foreach (CheckBox c in _legendChecks)
            {
                WeLegendInfo info;
                _legendInfo.TryGetValue(c.Tag as string ?? string.Empty, out info);
                bool hit = WeLegendSearch.Matches(info ?? new WeLegendInfo(c.Tag as string), q);
                if (hit) matched++;
                bool show = hit || c.IsChecked == true;
                c.Visibility = show ? Visibility.Visible : Visibility.Collapsed;
                if (show) shown++;
            }
            int chosen = _legendChecks.Count(c => c.IsChecked == true);
            _legendCount.Text = (string.IsNullOrWhiteSpace(q) ? _legendChecks.Count + " legend" : "Олдсон: " + matched + " / " + _legendChecks.Count)
                                + (chosen > 0 ? " · сонгосон " + chosen : string.Empty);
        }

        private void FillLegends(IList<WeLegendInfo> legends)
        {
            _legendChecks.Clear();
            _legendList.Children.Clear();
            _legendInfo.Clear();
            var chosen = new HashSet<string>(Settings.LegendNames ?? new List<string>(), StringComparer.Ordinal);
            foreach (WeLegendInfo li in legends ?? new List<WeLegendInfo>())
            {
                string n = li != null ? li.Name : null;
                if (string.IsNullOrEmpty(n) || _legendInfo.ContainsKey(n)) continue;
                _legendInfo[n] = li;
                var content = new StackPanel();
                content.Children.Add(new TextBlock { Text = n, TextWrapping = TextWrapping.Wrap });
                string codes = WeLegendSearch.CodesLabel(li, 4);
                if (codes.Length > 0)
                {
                    var ct = new TextBlock { Text = codes, FontSize = 11, TextWrapping = TextWrapping.Wrap };
                    ct.SetResourceReference(TextBlock.ForegroundProperty, "FgMuted");
                    content.Children.Add(ct);
                }
                var cb = new CheckBox { Content = content, Tag = n, IsChecked = chosen.Contains(n), Margin = new Thickness(0, 2, 0, 2),
                                        ToolTip = "Хуудсанд «" + n + "» legend-ийг байрлуулна" + (codes.Length > 0 ? Environment.NewLine + "Тэмдэг: " + codes : string.Empty) };
                MglAuto.Name(cb, "Legend: " + n);
                _legendChecks.Add(cb);
                _legendList.Children.Add(cb);
            }
        }

        private static TextBlock Caption(string text)
        {
            return new TextBlock { Text = text, Margin = new Thickness(0, 10, 0, 2) };
        }

        private static void Row(Panel host, string label, Control input)
        {
            var l = new TextBlock { Text = label, Margin = new Thickness(0, 8, 0, 2) };
            MglAuto.LabelFor(l, input);
            host.Children.Add(l);
            host.Children.Add(input);
        }

        private static UIElement Pair(string l1, Control c1, string l2, Control c2)
        {
            var g = new Grid { Margin = new Thickness(0, 6, 0, 0) };
            g.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            g.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(8) });
            g.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            var a = new StackPanel();
            var b = new StackPanel();
            var la = new TextBlock { Text = l1, Margin = new Thickness(0, 0, 0, 2), TextWrapping = TextWrapping.Wrap };
            var lb = new TextBlock { Text = l2, Margin = new Thickness(0, 0, 0, 2), TextWrapping = TextWrapping.Wrap };
            MglAuto.LabelFor(la, c1);
            MglAuto.LabelFor(lb, c2);
            a.Children.Add(la); a.Children.Add(c1);
            b.Children.Add(lb); b.Children.Add(c2);
            Grid.SetColumn(b, 2);
            g.Children.Add(a);
            g.Children.Add(b);
            return g;
        }

        private static TextBlock Muted(string text, double indent)
        {
            TextBlock t = MglUi.Muted(text);
            t.TextWrapping = TextWrapping.Wrap;
            t.Margin = new Thickness(indent, 0, 0, 2);
            return t;
        }
    }
}
