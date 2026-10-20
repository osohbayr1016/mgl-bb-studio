using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Media.Media3D;
using System.Windows.Threading;
using RevitMcpAddin.ChangeImpact.Core;
using RevitMcpAddin.Smart.Core;
using RevitMcpAddin.Smart.Ui;

namespace RevitMcpAddin.ChangeImpact.Ui
{
    /// <summary>
    /// «MGL — Өөрчлөхөөс өмнө (simulation)» — модальгүй цонх.  Ямар ч элемент (хана, хаалга, багана, шал, суваг, тавилга…) ЦЭС, ТӨРӨЛ САЛГАХГҮЙГЭЭР:
    ///
    ///   1. Элементийг Revit-д сонгоод (эсвэл сонгуулаад) хэрэгслийг ажиллуулна → энэ цонхонд элемент болон орчин нь БОДИТ геометрээр (Revit-ийн хэлбэр, шаадтай) 3D-ээр харагдана.
    ///   2. Цэнхэр элементийг ХУЛГАНААР БАРЬЖ чирж хүссэн газартаа тавина (тоо бичихгүй, товч дарахгүй).  Хулганы баруун товч / хоосон газраас чирэх = эргүүлэх, дугуй = ойртуулах.
    ///   3. Чирч байх үед ~мс-д урьдчилсан мөргөлдөөн шууд улаанаар тодорно; тавьсны дараа Revit-ийн sandbox ЯГ тэр зөөлтийг турших бөгөөд «Хэрэв та X-г эндээс тийш зөөвөл …»
    ///      гэсэн тайлан (юуг дахин хийх, ямар асуудал гарах) болон 🟢/🟠/🔴/⚪ дүгнэлт гарна.
    ///   4. «Зөвшөөрөх» дармагц л загвар өөрчлөгдөнө (нэг Undo).  «Болих» = загвар ХЭЗЭЭ Ч хөдлөөгүй.
    ///
    /// Цонх Revit-ийн төрлийг мэдэхгүй (`ISimSession`).  Бүх шийдвэр, текст, барилт, мөргөлдөөн нь Core-д (`SimController`, тестлэгдсэн) — цонх зөвхөн ЗУРНА, хулганы пикселийг дамжуулна.
    /// ⚠️ Хулганы глобал hook, Win32, reflection БАЙХГҮЙ: хулгана энэ цонхны ӨӨРИЙН 3D харагдац дээр л ажиллана (WPF).  Revit-ийн зураг дээрх (DirectContext3D) сүүдэр нь зөвхөн дэлгэц.
    /// ⚠️ Энэ нь МОДЕЛИЙН техникийн дүгнэлт — Монгол нормын (БНбД) баталгаа БИШ.
    /// </summary>
    internal sealed class SimWindow : Window
    {
        private const int TickMs = 50;
        private const int ExactDebounceMs = 260;
        private const int MaxDrawnTriangles = 260000;

        private readonly ISimSession _s;
        private readonly Action<PreChangeOperationKind> _openLegacy;
        private readonly SimController _c = new SimController();
        private readonly DispatcherTimer _timer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(TickMs) };
        private readonly DispatcherTimer _debounce = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(ExactDebounceMs) };
        private readonly Stopwatch _clock = Stopwatch.StartNew();

        private CancellationTokenSource _exactCts;
        private bool _closed, _loading, _applying, _dragging, _orbiting, _panning, _staleScene, _dirty, _labelsDirty, _settledShown, _xray, _sizeKnown;
        private int _loadSeq, _ticks;
        private long _lastRenderMs;
        private string _sceneStamp, _status = "", _lastOverlayKey = "";
        private Point _last;
        private Point _hoverAt;
        private bool _hoverDirty;
        private string _pendingNote = "";

        // ---- 3D
        private readonly Viewport3D _vp = new Viewport3D { ClipToBounds = true, IsHitTestVisible = false };
        private readonly Grid _vpHost = new Grid { Background = Brushes.Transparent, ClipToBounds = true, Focusable = true };
        private readonly PerspectiveCamera _persp = new PerspectiveCamera { FieldOfView = 45 };
        private readonly OrthographicCamera _ortho = new OrthographicCamera();
        private readonly DirectionalLight _head = new DirectionalLight(Color.FromRgb(175, 175, 175), new Vector3D(0, 0, -1));
        private readonly Model3DGroup _contextGroup = new Model3DGroup();
        /// <summary>
        /// Хагас тунгалаг хавтгай (шал, дээвэр, тааз) — зөөж буй элементийн ДАРАА зурагдана, тэгэхгүй бол WPF-ийн depth buffer доорх элементийг нууна.
        /// Revit 2027-д хэмжсэн: олон давхарт багана шалны дор бүрэн нуугдаж, хэрэглэгч юуг чирэхээ харахгүй байв.
        /// </summary>
        private readonly Model3DGroup _glassGroup = new Model3DGroup();
        private bool _glassSlabs;
        private readonly Model3DGroup _movingGroup = new Model3DGroup();
        private readonly Model3DGroup _oldGroup = new Model3DGroup();
        private readonly Model3DGroup _overlayGroup = new Model3DGroup();
        private readonly Model3DGroup _affectedGroup = new Model3DGroup();
        private readonly Model3DGroup _boxGroup = new Model3DGroup();
        private readonly TranslateTransform3D _moveT = new TranslateTransform3D();
        private readonly List<GeometryModel3D> _contextModels = new List<GeometryModel3D>();
        private readonly List<SimKind> _contextKinds = new List<SimKind>();
        private readonly Dictionary<SimKind, Material> _ctxMat = new Dictionary<SimKind, Material>();
        private readonly Dictionary<SimKind, Material> _ctxXray = new Dictionary<SimKind, Material>();
        private readonly Dictionary<SimKind, Material> _ctxGlass = new Dictionary<SimKind, Material>();

        /// <summary>Зөөж буй нь хавтгай (шал/дээвэр/тааз) БИШ бол орчны хавтгайг хагас тунгалаг зурна.</summary>
        private bool IsGlass(SimKind k)
        {
            return _glassSlabs && (k == SimKind.Floor || k == SimKind.Roof || k == SimKind.Ceiling);
        }
        private readonly Dictionary<string, SimMesh> _ctxByKey = new Dictionary<string, SimMesh>(StringComparer.Ordinal);
        private GeometryModel3D _movingModel, _oldModel;
        private MeshGeometry3D _movingGeo;
        private readonly Material _movingMat = SimWpf.Solid(SimWpf.MovingColor, 1.0, 40);
        private readonly Material _oldMat = SimWpf.Solid(Color.FromRgb(120, 124, 132), 0.22, 0);
        private readonly Material _hitMat = SimWpf.Solid(SimWpf.HitColor, 1.0, 120);
        private readonly Material _boxMat = SimWpf.Solid(SimWpf.HitColor, 0.36, 90);
        private readonly Material _affectedMat = SimWpf.Solid(SimWpf.AffectedColor, 0.55, 80);

        // ---- overlay
        private readonly TextBlock _help = new TextBlock { Foreground = new SolidColorBrush(Color.FromRgb(50, 56, 66)), FontSize = 12, TextWrapping = TextWrapping.Wrap, IsHitTestVisible = false };
        private readonly TextBlock _offsetText = new TextBlock { Foreground = new SolidColorBrush(Color.FromRgb(28, 34, 44)), FontSize = 15, FontWeight = FontWeights.SemiBold, IsHitTestVisible = false };
        private readonly TextBlock _hover = new TextBlock { Foreground = Brushes.White, FontSize = 12, IsHitTestVisible = false };
        private readonly Border _hoverBox;
        private readonly Canvas _labels = new Canvas { IsHitTestVisible = false, ClipToBounds = true };
        private readonly TextBlock _loadText = new TextBlock { FontSize = 16, FontWeight = FontWeights.SemiBold, Foreground = new SolidColorBrush(Color.FromRgb(40, 46, 58)), TextAlignment = TextAlignment.Center, TextWrapping = TextWrapping.Wrap };
        private readonly ProgressBar _loadBar = new ProgressBar { Height = 6, Width = 260, Minimum = 0, Maximum = 1, IsIndeterminate = true, Margin = new Thickness(0, 8, 0, 0) };
        private readonly Border _loadOverlay;

        // ---- хажуу самбар, баннер, доод мөр
        private readonly Border _banner = new Border { Padding = new Thickness(12, 8, 12, 8), BorderThickness = new Thickness(0, 0, 0, 3) };
        private readonly TextBlock _bannerMark = new TextBlock { FontSize = 26, Margin = new Thickness(0, 0, 10, 0), VerticalAlignment = VerticalAlignment.Center };
        private readonly TextBlock _bannerTitle = new TextBlock { FontSize = 17, FontWeight = FontWeights.Bold };
        private readonly TextBlock _bannerSub = new TextBlock { FontSize = 12.5, TextWrapping = TextWrapping.Wrap };
        private readonly StackPanel _panel = new StackPanel { Margin = new Thickness(8, 6, 8, 6) };
        private readonly Border _notice = new Border { Padding = new Thickness(8, 6, 8, 6), Margin = new Thickness(0, 0, 0, 6), Visibility = Visibility.Collapsed, BorderThickness = new Thickness(1) };
        private readonly TextBlock _noticeText = UiKit.Text("", wrap: true, bold: true);
        private readonly Button _noticeBtn;
        private readonly TextBlock _statusText = UiKit.Text("", brush: UiKit.MutedBrush, wrap: true);
        private readonly TextBlock _gateHint = UiKit.Text("", brush: UiKit.MutedBrush, wrap: true);
        private readonly Button _approve, _resetBtn, _cancelBtn, _pickBtn, _topBtn, _isoBtn, _fitBtn, _moreBtn;
        private readonly Button _modePlane, _modeAxis, _modeVertical;
        private readonly ComboBox _snap;
        private readonly CheckBox _xrayCheck;
        private readonly TextBlock _lockNote = UiKit.Text("", brush: UiKit.InfoBrush, wrap: true);

        internal SimWindow(ISimSession session, Action<PreChangeOperationKind> openLegacy = null)
        {
            _s = session;
            _openLegacy = openLegacy;
            Title = "MGL — Өөрчлөхөөс өмнө (simulation) · " + (session.DocumentTitle ?? "");
            Width = 1220;
            Height = 800;
            MinWidth = 860;
            MinHeight = 580;
            ShowInTaskbar = false;
            Topmost = false;
            UiKit.Prepare(this, "sim-move");

            _hoverBox = new Border { Background = new SolidColorBrush(Color.FromArgb(220, 30, 36, 48)), CornerRadius = new CornerRadius(3), Padding = new Thickness(6, 3, 6, 3), Child = _hover, Visibility = Visibility.Collapsed, IsHitTestVisible = false, HorizontalAlignment = HorizontalAlignment.Left, VerticalAlignment = VerticalAlignment.Top };
            _loadOverlay = new Border
            {
                Background = new SolidColorBrush(Color.FromArgb(215, 244, 246, 249)), HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center,
                Padding = new Thickness(26, 18, 26, 18), CornerRadius = new CornerRadius(6),
                Child = new StackPanel { Children = { _loadText, _loadBar } },
            };

            _topBtn = UiKit.Btn("Дээрээс", (s, e) => SetView(true), 74);
            _isoBtn = UiKit.Btn("3D", (s, e) => SetView(false), 50);
            _fitBtn = UiKit.Btn("Бүтнээр", (s, e) => FitView(), 70);
            _topBtn.ToolTip = "Дээрээс харах (план) — хавтгайд нарийн байрлуулахад.  Хурдан товч: T";
            _isoBtn.ToolTip = "Гурван хэмжээст харагдац.  Хурдан товч: I";
            _fitBtn.ToolTip = "Элемент ба орчныг бүхлээр харуулах.  Хурдан товч: Home";
            _modePlane = UiKit.Btn("Хавтгайд", (s, e) => SetMode(SimDragMode.Plane), 74);
            _modeAxis = UiKit.Btn("Нэг тэнхлэгээр", (s, e) => SetMode(SimDragMode.Axis), 110);
            _modeVertical = UiKit.Btn("Дээш/доош", (s, e) => SetMode(SimDragMode.Vertical), 84);
            _modePlane.ToolTip = "Элементийг шалны хавтгайд (X, Y) чөлөөтэй чирнэ.";
            _modeAxis.ToolTip = "Хулганыг аль тэнхлэгээр илүү хөдөлгөснөөр зөвхөн тэр тэнхлэгийн дагуу чирнэ.";
            _modeVertical.ToolTip = "Зөвхөн босоо (Z) чирнэ — 3D харагдац дээр (дээрээс харахад ажиллахгүй).";
            _snap = UiKit.Combo(new[] { "Чөлөөтэй", "1 мм", "5 мм", "10 мм", "50 мм", "100 мм" }, "10 мм", 92);
            _snap.ToolTip = "Хулганаар чирэх үеийн алхам (grid).  Сумтай товч ЭНЭ алхмаар нудна.";
            _snap.SelectionChanged += (s, e) => OnSnapChanged();
            _xrayCheck = UiKit.Check("Орчин тунгалаг", false, (s, e) => OnXray());
            _xrayCheck.ToolTip = "Орчны элементийг тунгалаг болгож, ард нь байгааг харна.";
            _pickBtn = UiKit.Btn("Өөр элемент сонгох", (s, e) => OnPickOther(), 130);
            _pickBtn.ToolTip = "Revit-ийн зураг дээр өөр элемент сонгоно (Esc = цуцлах).";
            _moreBtn = UiKit.Btn("…", (s, e) => OnMore(), 30);
            _moreBtn.ToolTip = "Хана, хаалгыг хуудас, хүснэгт, гарц зэрэг БҮТЭН шалгалтаар шалгах.";

            _approve = UiKit.Btn("Зөөлтийг чирж тавина уу", (s, e) => OnApprove(), 250);
            _approve.FontWeight = FontWeights.SemiBold;
            _approve.FontSize = 14;
            _approve.Padding = new Thickness(14, 8, 14, 8);
            _approve.IsEnabled = false;
            _resetBtn = UiKit.Btn("Эхнээс нь", (s, e) => OnReset(), 90);
            _resetBtn.ToolTip = "Элементийг анхны байрлал руу буцаана (загвар хөдлөөгүй).";
            _cancelBtn = UiKit.Btn("Болих", (s, e) => Close(), 80);
            _cancelBtn.ToolTip = "Цонхыг хаана — загвар ХЭЗЭЭ Ч хөдлөөгүй.  (Esc)";
            _noticeBtn = UiKit.Btn("Шинэчлэх", (s, e) => ReloadScene(), 90);

            Content = BuildLayout();
            InitScene3D();
            WireMouse();
            PreviewKeyDown += OnPreviewKeyDown;
            SizeChanged += (s, e) => { _labelsDirty = true; };

            _timer.Tick += (s, e) => Guard(OnTick);
            _debounce.Tick += (s, e) => { _debounce.Stop(); Guard(RunExact); };
            Loaded += (s, e) => { _timer.Start(); Guard(() => LoadScene(null)); };
            Closing += (s, e) => { if (_applying) e.Cancel = true; };
            Closed += (s, e) => ShutDown();
            RenderAll();
        }

        private static void Guard(Action a)
        {
            try { a(); }
            catch (Exception ex) { SmartLog.Error("sim", "ui", ex); }
        }

        /* ============================== LAYOUT ============================= */

        private UIElement BuildLayout()
        {
            // Баннер.
            var bannerText = new StackPanel { Children = { _bannerTitle, _bannerSub } };
            var bannerRow = new DockPanel();
            DockPanel.SetDock(_bannerMark, Dock.Left);
            bannerRow.Children.Add(_bannerMark);
            bannerRow.Children.Add(bannerText);
            _banner.Child = bannerRow;

            // Багажны мөр.
            var tools = new WrapPanel { Margin = new Thickness(8, 6, 8, 4) };
            tools.Children.Add(UiKit.Text("Харах:", bold: true));
            tools.Children.Add(_isoBtn); tools.Children.Add(_topBtn); tools.Children.Add(_fitBtn);
            tools.Children.Add(new TextBlock { Text = "   Чирэх:", FontWeight = FontWeights.SemiBold, VerticalAlignment = VerticalAlignment.Center });
            tools.Children.Add(_modePlane); tools.Children.Add(_modeAxis); tools.Children.Add(_modeVertical);
            tools.Children.Add(new TextBlock { Text = "   Алхам:", FontWeight = FontWeights.SemiBold, VerticalAlignment = VerticalAlignment.Center });
            tools.Children.Add(_snap);
            tools.Children.Add(_xrayCheck);
            tools.Children.Add(_pickBtn);
            tools.Children.Add(_moreBtn);

            // 3D харагдац + давхарга.
            var bg = new Border
            {
                Background = new LinearGradientBrush(Color.FromRgb(226, 231, 238), Color.FromRgb(250, 251, 253), 90),
                BorderBrush = UiKit.LineBrush, BorderThickness = new Thickness(1), Margin = new Thickness(8, 0, 4, 4),
            };
            var hostInner = new Grid();
            hostInner.Children.Add(_vp);
            hostInner.Children.Add(_labels);
            _vpHost.Children.Add(hostInner);

            var legend = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Right, VerticalAlignment = VerticalAlignment.Bottom, Margin = new Thickness(0, 0, 8, 6), IsHitTestVisible = false };
            legend.Children.Add(Legend(SimWpf.MovingColor, "Зөөгдөж буй"));
            legend.Children.Add(Legend(Color.FromRgb(196, 198, 202), "Орчин"));
            legend.Children.Add(Legend(SimWpf.HitColor, "Мөргөлдөөн"));
            legend.Children.Add(Legend(SimWpf.AffectedColor, "Revit өөрчлөх хөрш"));

            _help.Text = "Цэнхэр элементийг ХУЛГАНААР барьж чирнэ.  Хоосон газраас чирэх / баруун товч = эргүүлэх · дугуй = ойртуулах · Shift+баруун товч = зөөх · сумтай товч = нарийн нудах";
            _help.Margin = new Thickness(10, 8, 10, 0);
            _help.HorizontalAlignment = HorizontalAlignment.Left;
            _help.VerticalAlignment = VerticalAlignment.Top;
            _help.MaxWidth = 560;
            _offsetText.Margin = new Thickness(12, 0, 0, 8);
            _offsetText.VerticalAlignment = VerticalAlignment.Bottom;
            _offsetText.HorizontalAlignment = HorizontalAlignment.Left;

            var vpArea = new Grid();
            vpArea.Children.Add(_vpHost);
            vpArea.Children.Add(_help);
            vpArea.Children.Add(_offsetText);
            vpArea.Children.Add(legend);
            vpArea.Children.Add(_hoverBox);
            vpArea.Children.Add(_loadOverlay);
            bg.Child = vpArea;

            // Хажуу самбар.
            _noticeText.Margin = new Thickness(0, 0, 0, 4);
            _notice.Child = new StackPanel { Children = { _noticeText, _noticeBtn } };
            _noticeBtn.HorizontalAlignment = HorizontalAlignment.Left;
            var panelHost = new StackPanel { Children = { _notice, _lockNote, _panel } };
            var scroll = new ScrollViewer { VerticalScrollBarVisibility = ScrollBarVisibility.Auto, HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled, Content = panelHost };
            var side = new Border { BorderBrush = UiKit.LineBrush, BorderThickness = new Thickness(1), Margin = new Thickness(4, 0, 8, 4), Child = scroll };

            // Доод мөр.
            var buttons = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Right };
            buttons.Children.Add(_resetBtn); buttons.Children.Add(_cancelBtn); buttons.Children.Add(_approve);
            foreach (UIElement b in buttons.Children) ((FrameworkElement)b).Margin = new Thickness(6, 0, 0, 0);
            var bottomLeft = new StackPanel { Children = { _statusText, _gateHint } };
            var bottom = new DockPanel { Margin = new Thickness(8, 4, 8, 8) };
            DockPanel.SetDock(buttons, Dock.Right);
            bottom.Children.Add(buttons);
            bottom.Children.Add(bottomLeft);

            var main = new Grid();
            main.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star), MinWidth = 380 });
            main.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(400), MinWidth = 300, MaxWidth = 620 });
            Grid.SetColumn(bg, 0); Grid.SetColumn(side, 1);
            main.Children.Add(bg); main.Children.Add(side);

            var root = new Grid();
            root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            root.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
            root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            Grid.SetRow(_banner, 0); Grid.SetRow(tools, 1); Grid.SetRow(main, 2); Grid.SetRow(bottom, 3);
            root.Children.Add(_banner); root.Children.Add(tools); root.Children.Add(main); root.Children.Add(bottom);
            return root;
        }

        private static UIElement Legend(Color c, string text)
        {
            var sp = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(8, 0, 0, 0) };
            sp.Children.Add(new Border { Width = 11, Height = 11, Background = new SolidColorBrush(c), Margin = new Thickness(0, 0, 4, 0), VerticalAlignment = VerticalAlignment.Center });
            sp.Children.Add(new TextBlock { Text = text, FontSize = 11.5, Foreground = new SolidColorBrush(Color.FromRgb(60, 66, 78)) });
            return sp;
        }

        /* ============================== 3D СЦЕН ============================ */

        private void InitScene3D()
        {
            var lights = new Model3DGroup();
            lights.Children.Add(new AmbientLight(Color.FromRgb(105, 108, 114)));
            lights.Children.Add(_head);
            lights.Children.Add(new DirectionalLight(Color.FromRgb(70, 72, 78), new Vector3D(-0.45, -0.35, -0.82)));
            _vp.Children.Add(new ModelVisual3D { Content = lights });
            _vp.Children.Add(new ModelVisual3D { Content = _contextGroup });
            _movingGroup.Transform = _moveT;
            _vp.Children.Add(new ModelVisual3D { Content = _movingGroup });
            _vp.Children.Add(new ModelVisual3D { Content = _overlayGroup });
            _vp.Children.Add(new ModelVisual3D { Content = _oldGroup });
            _vp.Children.Add(new ModelVisual3D { Content = _affectedGroup });
            _vp.Children.Add(new ModelVisual3D { Content = _glassGroup });
            _vp.Children.Add(new ModelVisual3D { Content = _boxGroup });          // тунгалаг — хамгийн сүүлд
            _vp.Camera = _persp;
            ApplyCamera();
        }

        private void ApplyCamera()
        {
            SimCamera c = _c.Camera;
            c.Recompute();
            ProjectionCamera cam;
            if (c.Ortho)
            {
                _ortho.Width = c.OrthoWidth;
                cam = _ortho;
            }
            else
            {
                _persp.FieldOfView = c.FovDeg;
                cam = _persp;
            }
            cam.Position = SimWpf.P(c.Position);
            cam.LookDirection = SimWpf.V(c.Forward);
            cam.UpDirection = SimWpf.V(c.Up);
            cam.NearPlaneDistance = c.Near;
            cam.FarPlaneDistance = c.Far;
            if (!ReferenceEquals(_vp.Camera, cam)) _vp.Camera = cam;
            _head.Direction = SimWpf.V(c.Forward);
            _labelsDirty = true;
        }

        private sealed class Pack
        {
            public List<KeyValuePair<SimKind, MeshGeometry3D>> Context = new List<KeyValuePair<SimKind, MeshGeometry3D>>();
            public MeshGeometry3D Moving;
            public SimConflictResult Baseline;
            public int Drawn, Skipped;
        }

        /// <summary>АРЫН thread-д: WPF геометр (frozen) + BVH халаалт + хөдөлгөөнгүй үеийн давхцал.  UI обьект үүсгэхгүй.</summary>
        private static Pack BuildPack(SimScene scene)
        {
            var pack = new Pack();
            int used;
            pack.Moving = SimWpf.FlatMesh(scene.Moving, 0, 80000, out used);

            int budget = MaxDrawnTriangles;
            var byKind = new Dictionary<SimKind, List<SimMesh>>();
            foreach (SimMesh m in scene.Context)
            {
                if (budget <= 0) { pack.Skipped += m.TriangleCount; continue; }
                List<SimMesh> list;
                if (!byKind.TryGetValue(m.Kind, out list)) { list = new List<SimMesh>(); byKind[m.Kind] = list; }
                list.Add(m);
                budget -= m.TriangleCount;
                pack.Drawn += m.TriangleCount;
            }
            foreach (KeyValuePair<SimKind, List<SimMesh>> kv in byKind)
            {
                // Нэг геометр дээд тал нь ~MaxTrianglesPerMesh гурвалжин.
                var chunk = new List<SimMesh>();
                int tris = 0;
                Action flush = () =>
                {
                    if (chunk.Count == 0) return;
                    int u;
                    MeshGeometry3D g = SimWpf.FlatMesh(chunk, 0, int.MaxValue, out u);
                    if (g != null) pack.Context.Add(new KeyValuePair<SimKind, MeshGeometry3D>(kv.Key, g));
                    chunk.Clear(); tris = 0;
                };
                foreach (SimMesh m in kv.Value)
                {
                    chunk.Add(m); tris += m.TriangleCount;
                    if (tris >= SimWpf.MaxTrianglesPerMesh) flush();
                }
                flush();
            }

            // Мөргөлдөөнд хэрэгтэй BVH-г урьдчилан барина (хулганаар чирэх эхний мөчид гацахгүй).
            var all = new List<SimMesh>(scene.Moving);
            all.AddRange(scene.Context);
            System.Threading.Tasks.Parallel.ForEach(all, m => { var _ = m.Bvh; });
            pack.Baseline = SimConflicts.Evaluate(scene, new SimVec(0, 0, 0), new SimConflictOptions());
            return pack;
        }

        private void ClearVisuals()
        {
            _contextGroup.Children.Clear(); _glassGroup.Children.Clear(); _contextModels.Clear(); _contextKinds.Clear();
            _movingGroup.Children.Clear(); _oldGroup.Children.Clear();
            _overlayGroup.Children.Clear(); _affectedGroup.Children.Clear(); _boxGroup.Children.Clear();
            _labels.Children.Clear();
            _ctxByKey.Clear();
            _movingModel = null; _oldModel = null; _movingGeo = null;
            _settledShown = false; _lastOverlayKey = "";
            _moveT.OffsetX = _moveT.OffsetY = _moveT.OffsetZ = 0;
            try { _s.ClearGhost(); } catch (Exception) { }
        }

        private void InstallPack(SimScene scene, Pack pack)
        {
            ClearVisuals();
            string pk = scene != null ? scene.PrimaryKind : null;
            _glassSlabs = pk != "Floor" && pk != "Roof" && pk != "Ceiling";
            foreach (SimMesh m in scene.Context) _ctxByKey[m.Key] = m;
            foreach (KeyValuePair<SimKind, MeshGeometry3D> kv in pack.Context)
            {
                Material mat = MaterialFor(kv.Key);
                var gm = SimWpf.Model(kv.Value, mat);
                _contextModels.Add(gm);
                _contextKinds.Add(kv.Key);
                (IsGlass(kv.Key) ? _glassGroup : _contextGroup).Children.Add(gm);
            }
            _movingGeo = pack.Moving;
            if (_movingGeo != null)
            {
                _movingModel = SimWpf.Model(_movingGeo, _movingMat);
                _movingGroup.Children.Add(_movingModel);
                _oldModel = SimWpf.Model(_movingGeo, _oldMat);
                _oldGroup.Children.Add(_oldModel);
            }
        }

        private Material MaterialFor(SimKind k)
        {
            if (!_xray && IsGlass(k))
            {
                Material g;
                if (!_ctxGlass.TryGetValue(k, out g)) { g = SimWpf.Solid(SimWpf.KindColor(k), 0.38, 10); _ctxGlass[k] = g; }
                return g;
            }
            Dictionary<SimKind, Material> d = _xray ? _ctxXray : _ctxMat;
            Material m;
            if (!d.TryGetValue(k, out m))
            {
                m = SimWpf.Solid(SimWpf.KindColor(k), _xray ? 0.28 : 1.0, 18);
                d[k] = m;
            }
            return m;
        }

        private void OnXray()
        {
            _xray = _xrayCheck.IsChecked == true;
            for (int i = 0; i < _contextModels.Count; i++)
            {
                Material m = MaterialFor(_contextKinds[i]);
                _contextModels[i].Material = m; _contextModels[i].BackMaterial = m;
            }
        }

        /* ============================== АЧААЛАЛТ ============================ */

        private void ReloadScene() { LoadScene(null); }

        private async void LoadScene(IList<long> ids)
        {
            try
            {
                int seq = ++_loadSeq;
                CancelExact();
                _debounce.Stop();
                _loading = true; _staleScene = false; _sceneStamp = null;
                _status = "Элемент, орчныг Revit-ээс уншиж байна…";
                _loadText.Text = "Орчныг уншиж байна…";
                _loadBar.IsIndeterminate = true;
                ClearVisuals();
                _c.Load(null, ActualW(), ActualH());
                RenderAll();
                if (ids != null) _s.SetSelection(ids);

                IProgress<SimLoadProgress> progress = UiThread.Progress<SimLoadProgress>(Dispatcher, p =>
                {
                    if (_closed || seq != _loadSeq) return;
                    if (p.Total > 0)
                    {
                        _loadBar.IsIndeterminate = false;
                        _loadBar.Maximum = p.Total; _loadBar.Value = p.Done;
                        _loadText.Text = "Орчныг уншиж байна… " + p.Done + " / " + p.Total;
                    }
                });
                SimLoadOutcome o = null;
                string err = null;
                try { o = await _s.LoadAsync(progress, CancellationToken.None); }
                catch (Exception ex) { err = ex.Message; }
                if (_closed || seq != _loadSeq) return;

                if (err != null || o == null || !o.Ok)
                {
                    _loading = false;
                    _status = "⛔ " + (err ?? (o != null ? o.Problem : "Сцен ачаалагдсангүй."));
                    _loadOverlay.Visibility = Visibility.Collapsed;
                    RenderAll();
                    return;
                }

                if (o.NeedsOwnershipAck)
                {
                    MessageBoxResult r = MessageBox.Show(this,
                        "Ажлын багийн загвар: энэ элемент хэнд ч эзэмшигдээгүй байна.\n\nRevit-ийн түр шинжилгээ элементийг түр «эзэмших» (checkout) боломжтой — загварт өөрчлөлт ОРОХГҮЙ, гэхдээ эзэмшил чөлөөлөгдөхгүй байж болно.\n\nҮргэлжлүүлэх үү?",
                        Title, MessageBoxButton.YesNo, MessageBoxImage.Question);
                    if (r != MessageBoxResult.Yes) { _loading = false; _status = "Цуцалсан — загварт өөрчлөлт хийгдээгүй."; _loadOverlay.Visibility = Visibility.Collapsed; RenderAll(); return; }
                    _s.AcknowledgeOwnership();
                }

                _sceneStamp = o.Stamp;
                SimScene scene = o.Scene;
                _loadText.Text = "Харагдацыг бэлтгэж байна… (" + scene.Moving.Count + " элемент, орчин " + scene.Context.Count + ")";
                _loadBar.IsIndeterminate = true;
                Pack pack = null;
                try { pack = await Task.Run(() => BuildPack(scene)); }
                catch (Exception ex) { err = ex.Message; }
                if (_closed || seq != _loadSeq) return;
                if (pack == null || pack.Moving == null)
                {
                    _loading = false;
                    _status = "⛔ Харагдацыг бэлтгэж чадсангүй" + (err != null ? " (" + err + ")" : " — элементийн геометр хоосон") + ".";
                    _loadOverlay.Visibility = Visibility.Collapsed;
                    RenderAll();
                    return;
                }

                _c.Load(scene, ActualW(), ActualH());
                _c.Mode = SimDragMode.Plane;
                _c.SnapMm = SnapFromCombo();
                InstallPack(scene, pack);
                _c.SetBaseline(pack.Baseline);
                _loading = false;
                _status = pack.Skipped > 0 ? "Орчны " + (pack.Skipped / 1000) + "k гурвалжинг харуулсангүй (хэт том) — мөргөлдөөнд шалгагдана." : "";
                ApplyCamera();
                UpdateMoveTransform();
                RenderAll();
            }
            catch (Exception ex)
            {
                SmartLog.Error("sim", "load_ui", ex);
                _loading = false;
                _status = "⛔ Ачаалахад алдаа гарлаа (" + ex.GetType().Name + ").";
                try { RenderAll(); } catch (Exception) { }
            }
        }

        private double ActualW() { return _vpHost.ActualWidth > 10 ? _vpHost.ActualWidth : 900; }
        private double ActualH() { return _vpHost.ActualHeight > 10 ? _vpHost.ActualHeight : 600; }

        /* ============================== ХУЛГАНА ============================ */

        private void WireMouse()
        {
            _vpHost.MouseLeftButtonDown += (s, e) => Guard(() => OnLeftDown(e));
            _vpHost.MouseLeftButtonUp += (s, e) => Guard(() => OnLeftUp(e));
            _vpHost.MouseRightButtonDown += (s, e) => Guard(() => OnOtherDown(e, false));
            _vpHost.MouseRightButtonUp += (s, e) => Guard(() => OnOtherUp(e));
            _vpHost.MouseDown += (s, e) => { if (e.ChangedButton == MouseButton.Middle) Guard(() => OnOtherDown(e, true)); };
            _vpHost.MouseUp += (s, e) => { if (e.ChangedButton == MouseButton.Middle) Guard(() => OnOtherUp(e)); };
            _vpHost.MouseMove += (s, e) => Guard(() => OnMove(e));
            _vpHost.MouseWheel += (s, e) => Guard(() => OnWheel(e));
            _vpHost.MouseLeave += (s, e) => { _hoverBox.Visibility = Visibility.Collapsed; };
            _vpHost.LostMouseCapture += (s, e) => Guard(OnLostCapture);
            _vpHost.SizeChanged += (s, e) => { _c.SetViewport(ActualW(), ActualH()); _labelsDirty = true; };
        }

        private bool CanInteract { get { return !_closed && !_loading && !_applying && _c.IsReady; } }

        private void OnLeftDown(MouseButtonEventArgs e)
        {
            _vpHost.Focus();
            Point p = e.GetPosition(_vpHost);
            _last = p;
            if (!CanInteract) { StartOrbit(e); return; }
            _debounce.Stop();
            CancelExact();
            if (_c.BeginDrag(p.X, p.Y, ActualW(), ActualH()))
            {
                _dragging = true;
                _vpHost.CaptureMouse();
                _vpHost.Cursor = Cursors.SizeAll;
                RestoreOriginalMoving();
                try { _s.ClearGhost(); } catch (Exception) { }
                _hoverBox.Visibility = Visibility.Collapsed;
                _dirty = true;
                e.Handled = true;
                return;
            }
            StartOrbit(e);       // хоосон газраас чирвэл эргүүлнэ
            e.Handled = true;
        }

        private void StartOrbit(MouseButtonEventArgs e)
        {
            _orbiting = true;
            _vpHost.CaptureMouse();
            _vpHost.Cursor = Cursors.Cross;
            e.Handled = true;
        }

        private void OnOtherDown(MouseButtonEventArgs e, bool middle)
        {
            _vpHost.Focus();
            _last = e.GetPosition(_vpHost);
            if (_dragging) return;
            bool pan = middle || (Keyboard.Modifiers & ModifierKeys.Shift) != 0;
            _panning = pan; _orbiting = !pan;
            _vpHost.CaptureMouse();
            _vpHost.Cursor = pan ? Cursors.ScrollAll : Cursors.Cross;
            e.Handled = true;
        }

        private void OnOtherUp(MouseButtonEventArgs e)
        {
            if (_dragging) return;
            _panning = false; _orbiting = false;
            if (_vpHost.IsMouseCaptured) _vpHost.ReleaseMouseCapture();
            _vpHost.Cursor = Cursors.Arrow;
        }

        private void OnLeftUp(MouseButtonEventArgs e)
        {
            if (_dragging)
            {
                _dragging = false;
                if (_vpHost.IsMouseCaptured) _vpHost.ReleaseMouseCapture();
                _vpHost.Cursor = Cursors.Arrow;
                bool changed = _c.EndDrag();
                UpdateMoveTransform();
                if (changed) ScheduleExact();
                RenderAll();
                e.Handled = true;
                return;
            }
            if (_orbiting)
            {
                _orbiting = false;
                if (_vpHost.IsMouseCaptured) _vpHost.ReleaseMouseCapture();
                _vpHost.Cursor = Cursors.Arrow;
                e.Handled = true;
            }
        }

        private void OnLostCapture()
        {
            // Capture өөр шалтгаанаар алдагдсан (цонх идэвхгүй болсон) — чирэлтийг дуусгана.
            if (_dragging)
            {
                _dragging = false;
                bool changed = _c.EndDrag();
                UpdateMoveTransform();
                if (changed) ScheduleExact();
                RenderAll();
            }
            _orbiting = false; _panning = false;
            _vpHost.Cursor = Cursors.Arrow;
        }

        private void OnMove(MouseEventArgs e)
        {
            Point p = e.GetPosition(_vpHost);
            double dx = p.X - _last.X, dy = p.Y - _last.Y;
            if (_dragging)
            {
                if (_c.DragTo(p.X, p.Y, ActualW(), ActualH()))
                {
                    UpdateMoveTransform();
                    _dirty = true; _labelsDirty = true;
                    UpdateOverlayIfChanged();
                    UpdateBoxes();
                }
                _last = p;
                return;
            }
            if (_orbiting)
            {
                if (_c.Camera.Ortho) _c.Camera.Ortho = false;
                _c.Camera.Orbit(dx, dy);
                ApplyCamera();
                _last = p;
                return;
            }
            if (_panning)
            {
                _c.Camera.Pan(dx, dy, ActualW());
                ApplyCamera();
                _last = p;
                return;
            }
            _last = p;
            _hoverAt = p; _hoverDirty = true;
        }

        private void OnWheel(MouseWheelEventArgs e)
        {
            Point p = e.GetPosition(_vpHost);
            _c.Camera.Zoom(e.Delta / 120.0, p.X, p.Y, ActualW(), ActualH());
            ApplyCamera();
            e.Handled = true;
        }

        private void UpdateHover()
        {
            _hoverDirty = false;
            if (!CanInteract || _dragging || _orbiting || _panning || _c.Scene == null) { _hoverBox.Visibility = Visibility.Collapsed; return; }
            SimRay ray = _c.Camera.Ray(_hoverAt.X, _hoverAt.Y, ActualW(), ActualH());
            SimPick.Result r = SimPick.Nearest(_c.Scene, _c.Offset, ray, true);
            if (r == null) { _hoverBox.Visibility = Visibility.Collapsed; _vpHost.Cursor = Cursors.Arrow; return; }
            _vpHost.Cursor = r.IsMoving ? Cursors.Hand : Cursors.Arrow;
            string label = r.IsMoving ? "⬌ " + (_c.Scene.MovingName ?? "элемент") + " — барьж чирнэ" : (_ctxByKey.ContainsKey(r.Key) ? _ctxByKey[r.Key].Label : r.Key);
            _hover.Text = label;
            _hoverBox.Margin = new Thickness(Math.Min(_hoverAt.X + 14, Math.Max(0, ActualW() - 220)), _hoverAt.Y + 16, 0, 0);
            _hoverBox.Visibility = Visibility.Visible;
        }

        /* ============================== ХӨДӨЛГӨӨН / ДЭЛГЭЦ ================== */

        private void UpdateMoveTransform()
        {
            if (_settledShown) { _moveT.OffsetX = _moveT.OffsetY = _moveT.OffsetZ = 0; return; }
            _moveT.OffsetX = _c.Offset.X; _moveT.OffsetY = _c.Offset.Y; _moveT.OffsetZ = _c.Offset.Z;
        }

        /// <summary>Мөргөлдөөнтэй орчин нь улаанаар (ЯГ ИЖИЛ гурвалжин, нормалиар бага зэрэг түлхсэн) — ТОД харагдана.  Түлхүүрийн олонлог өөрчлөгдсөн үед л дахин бүтээнэ.</summary>
        private void UpdateOverlayIfChanged()
        {
            SimReport r = _c.Report;
            string key = r == null ? "" : string.Join("|", r.HighlightKeys.OrderBy(k => k, StringComparer.Ordinal));
            if (key == _lastOverlayKey) return;
            _lastOverlayKey = key;
            _overlayGroup.Children.Clear();
            if (r == null || r.HighlightKeys.Count == 0) return;
            var meshes = new List<SimMesh>();
            foreach (string k in r.HighlightKeys)
            {
                SimMesh m;
                if (_ctxByKey.TryGetValue(k, out m)) meshes.Add(m);
            }
            int used;
            MeshGeometry3D g = SimWpf.FlatMesh(meshes, 5, 60000, out used);
            if (g != null) _overlayGroup.Children.Add(SimWpf.Model(g, _hitMat));
        }

        private void UpdateBoxes()
        {
            _boxGroup.Children.Clear();
            if (_c.Report == null) return;
            MeshGeometry3D g = SimWpf.BoxesMesh(_c.HitBoxes());
            if (g != null) _boxGroup.Children.Add(SimWpf.Model(g, _boxMat));
        }

        private void RestoreOriginalMoving()
        {
            if (_settledShown && _movingModel != null && _movingGeo != null)
            {
                _movingModel.Geometry = _movingGeo;
                _settledShown = false;
            }
            _affectedGroup.Children.Clear();
            UpdateMoveTransform();
        }

        private void ShowSettled(SimExactResult res)
        {
            try
            {
                if (res.SettledMoving != null && res.SettledMoving.Count > 0 && _movingModel != null)
                {
                    int used;
                    MeshGeometry3D g = SimWpf.FlatMesh(res.SettledMoving, 0, 80000, out used);
                    if (g != null)
                    {
                        // Revit-ийн ЖИНХЭНЭ дүр (join, хайчлалт хамт) — settled байрлал аль хэдийн шилжсэн тул transform тэг.
                        _movingModel.Geometry = g;
                        _settledShown = true;
                        UpdateMoveTransform();
                    }
                }
                _affectedGroup.Children.Clear();
                if (res.SettledAffected != null && res.SettledAffected.Count > 0)
                {
                    int used;
                    MeshGeometry3D ag = SimWpf.FlatMesh(res.SettledAffected, 4, 40000, out used);
                    if (ag != null) _affectedGroup.Children.Add(SimWpf.Model(ag, _affectedMat));
                }
            }
            catch (Exception ex) { SmartLog.Warn("sim", "settled_visual_failed", new { ex = ex.GetType().Name }); }
        }

        private void PushGhost()
        {
            try
            {
                SimReport r = _c.Report;
                if (r == null || _c.Scene == null || !r.IsFinal) { _s.ClearGhost(); return; }
                GhostScene gs = SimGhostScene.Build(_c.Scene, _c.Offset, r.Verdict, _c.HitBoxes(), _s.InternalUnitsPerMm);
                if (gs.IsEmpty) _s.ClearGhost(); else _s.ShowGhost(gs);
            }
            catch (Exception ex) { SmartLog.Warn("sim", "ghost_failed", new { ex = ex.GetType().Name }); }
        }

        /* ============================== REVIT-ИЙН ЭЦСИЙН ШИНЖИЛГЭЭ ========== */

        private void ScheduleExact()
        {
            if (_closed || _loading || _applying) return;
            _debounce.Stop();
            _debounce.Start();
        }

        private void CancelExact()
        {
            CancellationTokenSource cts = _exactCts;
            _exactCts = null;
            if (cts != null) { try { cts.Cancel(); } catch (Exception) { } }
        }

        private async void RunExact()
        {
            if (_closed || _loading || _applying || _dragging || !_c.IsReady) return;
            if (_c.Offset.LengthSq < 0.25) return;
            if (!_s.OwnershipAcknowledged) return;
            CancelExact();
            var cts = new CancellationTokenSource();
            _exactCts = cts;
            int gen = _c.BeginAnalysis();
            SimVec off = _c.Offset;
            _status = "Revit-ээр шалгаж байна… (загварт өөрчлөлт ОРОХГҮЙ)";
            RenderAll();

            SimExactResult res = null;
            string err = null;
            try { res = await _s.AnalyzeAsync(off, gen, cts.Token); }
            catch (OperationCanceledException) { }
            catch (Exception ex) { err = ex.Message; }

            UiThread.Run(Dispatcher, () =>
            {
                if (_closed) return;
                if (ReferenceEquals(_exactCts, cts)) _exactCts = null;
                if (cts.IsCancellationRequested) { _c.AnalysisAborted(gen); RenderAll(); return; }
                if (err != null)
                {
                    _status = "⛔ Revit-ээр шалгаж чадсангүй: " + err;
                    _c.AnalysisAborted(gen);
                    RenderAll();
                    return;
                }
                _status = "";
                if (res != null && _c.AcceptExact(res))
                {
                    ShowSettled(res);
                    UpdateOverlayIfChanged();
                    UpdateBoxes();
                    PushGhost();
                    _pendingNote = res.ElapsedMs > 0 ? "Revit-ийн шалгалт " + (res.ElapsedMs / 1000.0).ToString("0.0") + " с." : "";
                }
                else if (res != null) _c.AnalysisAborted(gen);       // хуучирсан (хэрэглэгч дахин хөдөлгөсөн)
                RenderAll();
            });
        }

        /* ============================== ТОВЧНУУД ============================ */

        private void SetView(bool top)
        {
            if (_c.Scene == null) return;
            if (top) { _c.Camera.SetTopView(); _c.Camera.Ortho = true; }
            else { _c.Camera.SetIsoView(); _c.Camera.Ortho = false; }
            _c.Camera.Fit(SimController.FocusBox(_c.Scene).Expanded(0), ActualW(), ActualH());
            ApplyCamera();
        }

        private void FitView()
        {
            if (_c.Scene == null) return;
            SimBox b = SimController.FocusBox(_c.Scene);
            b.Add(_c.MovedBounds);
            _c.Camera.Fit(b, ActualW(), ActualH());
            ApplyCamera();
        }

        private void SetMode(SimDragMode m)
        {
            if (_c.LineLocked) return;
            _c.Mode = m;
            RenderAll();
        }

        private double SnapFromCombo()
        {
            switch (_snap.SelectedIndex)
            {
                case 1: return 1;
                case 2: return 5;
                case 3: return 10;
                case 4: return 50;
                case 5: return 100;
                default: return 0;
            }
        }

        private void OnSnapChanged() { _c.SnapMm = SnapFromCombo(); }

        private void OnReset()
        {
            if (_closed || _applying || !_c.IsReady) return;
            CancelExact();
            _debounce.Stop();
            RestoreOriginalMoving();
            _c.Reset();
            UpdateMoveTransform();
            _lastOverlayKey = "~"; UpdateOverlayIfChanged(); UpdateBoxes();
            try { _s.ClearGhost(); } catch (Exception) { }
            _status = "";
            RenderAll();
        }

        private async void OnPickOther()
        {
            if (_closed || _applying || _loading) return;
            try
            {
                _status = "Revit-ийн зураг дээр зөөх элементээ сонгоно уу (Esc = цуцлах)…";
                _pickBtn.IsEnabled = false;
                RenderAll();
                IList<long> ids = null;
                string err = null;
                try { ids = await _s.PickAsync(CancellationToken.None); }
                catch (Exception ex) { err = ex.Message; }
                if (_closed) return;
                _pickBtn.IsEnabled = true;
                if (err != null) { _status = "⛔ " + err; RenderAll(); return; }
                if (ids == null || ids.Count == 0) { _status = ""; RenderAll(); return; }
                LoadScene(ids);
            }
            catch (Exception ex) { SmartLog.Error("sim", "pick_ui", ex); _pickBtn.IsEnabled = true; }
        }

        private void OnMore()
        {
            if (_openLegacy == null) return;
            var menu = new ContextMenu { PlacementTarget = _moreBtn, Placement = System.Windows.Controls.Primitives.PlacementMode.Bottom };
            var wall = new MenuItem { Header = "Хана зөөх — БҮТЭН шалгалт (өрөө, хэмжээс, хуудас, гарц…)" };
            wall.Click += (s, e) => Guard(() => _openLegacy(PreChangeOperationKind.WallMove));
            var door = new MenuItem { Header = "Хаалга зөөх — БҮТЭН шалгалт (хаалга, нүх, гарц…)" };
            door.Click += (s, e) => Guard(() => _openLegacy(PreChangeOperationKind.DoorMove));
            menu.Items.Add(wall); menu.Items.Add(door);
            menu.IsOpen = true;
        }

        private async void OnApprove()
        {
            try
            {
                if (_applying || _closed || _loading || _dragging) return;
                SimReport r = _c.Report;
                SimExactResult ex = _c.Exact;
                if (r == null || ex == null || !(r.CanApply || r.CanForce) || !r.IsFinal) return;
                if (_staleScene) { _status = "Загвар өөрчлөгдсөн — эхлээд «Шинэчлэх»."; RenderAll(); return; }

                // 🟠 / 🔴 (Revit зөвшөөрсөн боловч ноцтой): хянах зүйлийг нэг удаа дахин харуулж, архитектор мэдсээр, ӨӨРИЙН ШИЙДВЭРЭЭР зөөнө.
                // Мэдэгдэл ERP руу явахгүй (эзэн 2026-10-06: зөөсөн хүн холбогдох багтаа өөрөө хэлнэ).
                if (r.CanForce || r.Verdict == MoveVerdict.MoveWithReview)
                {
                    SimSeverity sev = r.CanForce ? SimSeverity.Blocking : SimSeverity.Review;
                    string reasons = string.Join("\n• ", r.Lines.Where(l => l.Severity == sev).Take(6).Select(l => l.Text + (l.Consequence != null ? "\n   → " + l.Consequence : "")));
                    string ask = (r.CanForce ? "НОЦТОЙ үр дагавар:\n• " : "Хянах зүйл:\n• ") + reasons + "\n\nҮүнийг хараад «" + _c.Scene.MovingName + "»-г "
                        + (r.CanForce ? "өөрийн шийдвэрээр зөөх үү?" : "зөөх үү?") + "\n\nХолбогдох элементийг хийсэн хүмүүст өөрөө мэдэгдэнэ үү.";
                    bool yes = ConfirmForTest != null ? ConfirmForTest(ask) : MessageBox.Show(this, ask, Title, MessageBoxButton.YesNo, r.CanForce ? MessageBoxImage.Exclamation : MessageBoxImage.Warning) == MessageBoxResult.Yes;
                    if (!yes) return;
                }

                _applying = true;
                CancelExact(); _debounce.Stop();
                _status = "Элементийг зөөж, шинжилгээтэй тулгаж байна…";
                RenderAll();
                ApplyOutcome outcome = null;
                string err = null;
                SimVec off = _c.Offset;
                try { outcome = await _s.ApplyAsync(off, ex, CancellationToken.None); }
                catch (Exception e2) { err = e2.Message; }

                UiThread.Run(Dispatcher, () =>
                {
                    _applying = false;
                    if (_closed) return;
                    if (err != null)
                    {
                        _status = "⛔ " + err + " Загварт өөрчлөлт орсон эсэхийг Revit-д шалгана уу.";
                        RenderAll();
                        return;
                    }
                    if (outcome != null && outcome.Moved)
                    {
                        _pendingNote = outcome.Message ?? "";
                        LoadScene(null);                       // загвар өөрчлөгдсөн — орчин, элементийг дахин уншина
                        _status = outcome.Message ?? "";
                        return;
                    }
                    _status = (outcome != null ? outcome.Message : "Зөөж чадсангүй.") ?? "";
                    if (outcome != null && outcome.Status == ApplyStatus.Stale) { _c.Reset(); RestoreOriginalMoving(); }
                    RenderAll();
                });
            }
            catch (Exception e3)
            {
                SmartLog.Error("sim", "approve_ui", e3);
                _applying = false;
                _status = "⛔ Алдаа гарлаа (" + e3.GetType().Name + "). Загварт өөрчлөлт орсон эсэхийг Revit-д шалгана уу.";
                try { RenderAll(); } catch (Exception) { }
            }
        }

        private void OnPreviewKeyDown(object sender, KeyEventArgs e)
        {
            if (_closed) return;
            if (Keyboard.FocusedElement is TextBox || Keyboard.FocusedElement is ComboBox) return;
            double step = _c.SnapMm > 0 ? _c.SnapMm : 10;
            if ((Keyboard.Modifiers & ModifierKeys.Shift) != 0) step *= 10;
            SimVec? nudge = null;
            switch (e.Key)
            {
                case Key.Escape:
                    if (_dragging) { _c.CancelDrag(); _dragging = false; if (_vpHost.IsMouseCaptured) _vpHost.ReleaseMouseCapture(); UpdateMoveTransform(); RenderAll(); }
                    else Close();
                    e.Handled = true;
                    return;
                case Key.Left: nudge = new SimVec(-step, 0, 0); break;
                case Key.Right: nudge = new SimVec(step, 0, 0); break;
                case Key.Up: nudge = new SimVec(0, step, 0); break;
                case Key.Down: nudge = new SimVec(0, -step, 0); break;
                case Key.PageUp: nudge = new SimVec(0, 0, step); break;
                case Key.PageDown: nudge = new SimVec(0, 0, -step); break;
                case Key.Home: FitView(); e.Handled = true; return;
                case Key.T: SetView(true); e.Handled = true; return;
                case Key.I: SetView(false); e.Handled = true; return;
                case Key.Enter:
                    if (_approve.IsEnabled) { OnApprove(); e.Handled = true; }
                    return;
            }
            if (nudge.HasValue && ApplyNudge(nudge.Value)) e.Handled = true;
        }

        /// <summary>Сумтай товчоор нудах (алхмаар).  Чирж, шалгаж, зөөж байх үед хүлээж авахгүй.  Цонхны хурдан товч ба тестийн хаалга хоёулаа ЭНЭ ГАНЦ замаар.</summary>
        private bool ApplyNudge(SimVec nudge)
        {
            if (!CanInteract || _dragging) return false;
            CancelExact(); _debounce.Stop();
            RestoreOriginalMoving();
            try { _s.ClearGhost(); } catch (Exception) { }
            if (_c.Nudge(nudge))
            {
                UpdateMoveTransform();
                UpdateOverlayIfChanged(); UpdateBoxes();
                ScheduleExact();
            }
            RenderAll();
            return true;
        }

        /* ============================== ХААГДАХ ============================= */

        private void ShutDown()
        {
            _closed = true;
            _timer.Stop(); _debounce.Stop();
            _loadSeq++;
            CancelExact();
            try { _s.ClearGhost(); } catch (Exception) { }
        }

        /* ============================== ДҮН (render) ======================== */

        private void OnTick()
        {
            if (_closed) return;
            _ticks++;
            long now = _clock.ElapsedMilliseconds;
            if (_dirty && now - _lastRenderMs > 70) { _dirty = false; RenderPanelOnly(); }
            if (_labelsDirty) { _labelsDirty = false; UpdateLabels(); }
            if (_hoverDirty && _ticks % 2 == 0) UpdateHover();
            if (_ticks % 20 == 0 && !_loading && !_applying && !_dragging && _sceneStamp != null && !_staleScene && _s.ModelChangedSince(_sceneStamp))
            {
                _staleScene = true;
                CancelExact(); _debounce.Stop();
                RenderAll();
            }
        }

        private void RenderAll()
        {
            if (_closed) return;
            _lastRenderMs = _clock.ElapsedMilliseconds;
            _dirty = false;
            SimReport r = _c.Report;
            bool ready = _c.IsReady && !_loading;
            _loadOverlay.Visibility = _loading ? Visibility.Visible : Visibility.Collapsed;

            // Баннер.
            if (r == null)
            {
                SetBanner("⚪", "ЭЛЕМЕНТ УНШИЖ БАЙНА…", _status, MoveVerdict.Unknown);
            }
            else SetBanner(r.Mark, r.Title, r.Subtitle, r.Verdict);

            // Багажны мөр.
            bool canEdit = ready && !_applying;
            _topBtn.IsEnabled = _isoBtn.IsEnabled = _fitBtn.IsEnabled = _c.Scene != null;
            _snap.IsEnabled = _xrayCheck.IsEnabled = canEdit || _c.Scene != null;
            bool locked = _c.LineLocked;
            _modePlane.IsEnabled = _modeAxis.IsEnabled = _modeVertical.IsEnabled = canEdit && !locked;
            Mark(_modePlane, !locked && _c.Mode == SimDragMode.Plane);
            Mark(_modeAxis, !locked && _c.Mode == SimDragMode.Axis);
            Mark(_modeVertical, !locked && _c.Mode == SimDragMode.Vertical);
            _lockNote.Text = locked ? "🔒 " + _c.Scene.LineConstraintReason : "";
            _lockNote.Visibility = locked ? Visibility.Visible : Visibility.Collapsed;
            _lockNote.Margin = new Thickness(10, 6, 10, 2);
            _pickBtn.IsEnabled = !_applying && !_loading;
            _moreBtn.Visibility = _openLegacy != null ? Visibility.Visible : Visibility.Collapsed;

            // Мэдэгдэл.
            if (_staleScene)
            {
                _notice.Visibility = Visibility.Visible;
                _notice.BorderBrush = UiKit.WarningBrush;
                _noticeText.Text = "Загвар simulation-ээс хойш өөрчлөгдсөн — харагдаж буй орчин хуучирсан байж болно.";
                _noticeBtn.Visibility = Visibility.Visible;
            }
            else _notice.Visibility = Visibility.Collapsed;

            // Доод мөр.
            _resetBtn.IsEnabled = ready && !_applying && (r != null && r.DistanceMm >= 0.5);
            bool can = r != null && (r.CanApply || r.CanForce) && !_staleScene && !_applying && !_dragging;
            _approve.IsEnabled = can;
            UpdateApproveLabel();
            _gateHint.Text = can ? "Зөвшөөрвөл загвар өөрчлөгдөнө (нэг Undo).  Одоогоор загвар ХЭЗЭЭ Ч хөдлөөгүй." : (r != null ? (r.ApplyHint ?? "") : "");
            _statusText.Text = !string.IsNullOrEmpty(_status) ? _status : _pendingNote;
            _offsetText.Text = r != null && r.DistanceMm >= 0.5 ? "Зөөлт: " + r.OffsetText : "";

            RenderPanelCore(r);
            UpdateOverlayIfChanged();
            UpdateBoxes();
            _labelsDirty = true;
        }

        private void RenderPanelOnly()
        {
            _lastRenderMs = _clock.ElapsedMilliseconds;
            SimReport r = _c.Report;
            if (r == null) return;
            SetBanner(r.Mark, r.Title, r.Subtitle, r.Verdict);
            _offsetText.Text = r.DistanceMm >= 0.5 ? "Зөөлт: " + r.OffsetText : "";
            RenderPanelCore(r);
            UpdateApproveLabel();
        }

        /// <summary>«Зөвшөөрөх» товчны бичвэр — мэдэгдэл очих хүний тоог хамт хэлнэ (тусдаа: мэдэгдлийн самбар өөрчлөгдөхөд RenderAll-гүйгээр).</summary>
        private void UpdateApproveLabel()
        {
            if (_closed || _approve == null) return;
            SimReport r = _c.Report;
            bool can = r != null && (r.CanApply || r.CanForce) && !_staleScene && !_applying && !_dragging;
            string label = can ? (r.CanForce ? "Өөрийн шийдвэрээр зөөх" : r.Verdict == MoveVerdict.MoveWithReview ? "Хянаад зөөх" : "Зөвшөөрөх (зөөх)") : (r != null && r.DistanceMm >= 0.5 ? "Зөөх боломжгүй" : "Зөөлтийг чирж тавина уу");
            if (r != null && r.DistanceMm >= 0.5 && r.IsPending) label = "Шалгаж байна…";
            if (_applying) label = "Зөөж байна…";
            _approve.Content = label;
        }

        private static void Mark(Button b, bool on)
        {
            b.FontWeight = on ? FontWeights.Bold : FontWeights.Normal;
            b.BorderBrush = on ? UiKit.InfoBrush : null;
            b.BorderThickness = on ? new Thickness(2) : new Thickness(1);
        }

        private void SetBanner(string mark, string title, string sub, MoveVerdict v)
        {
            byte[] tone = SimGhostScene.ToneOf(v);
            var c = Color.FromRgb(tone[0], tone[1], tone[2]);
            _banner.Background = new SolidColorBrush(Color.FromArgb(44, c.R, c.G, c.B));
            _banner.BorderBrush = new SolidColorBrush(c);
            // WPF өнгөт emoji зурдаггүй (🟠 → цагаан дугуй) — дүгнэлтийн өнгөөр ● зурна.
            _bannerMark.Text = "●";
            _bannerMark.Foreground = new SolidColorBrush(c);
            _bannerTitle.Text = title ?? "";
            _bannerTitle.Foreground = new SolidColorBrush(IsDarkTheme() ? Lighten(c) : Darken(c));
            _bannerSub.Text = sub ?? "";
            _bannerSub.Foreground = UiKit.FgBrush;
        }

        private static Color Darken(Color c) { return Color.FromRgb((byte)(c.R * 0.72), (byte)(c.G * 0.72), (byte)(c.B * 0.72)); }
        private static Color Lighten(Color c) { return Color.FromRgb((byte)(c.R + (255 - c.R) * 0.45), (byte)(c.G + (255 - c.G) * 0.45), (byte)(c.B + (255 - c.B) * 0.45)); }

        /// <summary>Revit-ийн бараан сэдэв (MglTheme цонхны дэвсгэрийг бараан болгосон) — гарчгийн өнгийг гэрэлтүүлнэ, эс бөгөөс бараан дээр бараан бичиг.</summary>
        private bool IsDarkTheme()
        {
            var b = Background as SolidColorBrush;
            if (b == null) return false;
            Color c = b.Color;
            return 0.2126 * c.R + 0.7152 * c.G + 0.0722 * c.B < 110;
        }

        private void RenderPanelCore(SimReport r)
        {
            _panel.Children.Clear();
            if (r == null)
            {
                _panel.Children.Add(UiKit.Text(string.IsNullOrEmpty(_status) ? "Элементийг уншиж байна…" : _status, wrap: true, brush: UiKit.MutedBrush));
                return;
            }
            var head = UiKit.Text(r.Headline ?? "", bold: true, wrap: true);
            head.FontSize = 14;
            head.Margin = new Thickness(0, 2, 0, 8);
            _panel.Children.Add(head);

            if (r.Lines.Count == 0 && r.DistanceMm >= 0.5)
                _panel.Children.Add(UiKit.Text(r.IsFinal ? "Мөргөлдөөн, өөрчлөлт илрээгүй." : "Одоогоор огтлолцол илрээгүй.", brush: UiKit.MutedBrush, wrap: true));

            foreach (SimLine l in r.Lines.Take(40)) _panel.Children.Add(LineCard(l));
            if (r.Lines.Count > 40) _panel.Children.Add(UiKit.Text("… бусад " + (r.Lines.Count - 40) + " мөр", brush: UiKit.MutedBrush));

            if (r.Coverage.Count > 0)
            {
                var cov = new StackPanel { Margin = new Thickness(0, 10, 0, 0) };
                foreach (string c in r.Coverage) cov.Children.Add(Small(c));
                _panel.Children.Add(cov);
            }
            var foot = new StackPanel { Margin = new Thickness(0, 8, 0, 4) };
            foot.Children.Add(Small(r.ModelLine));
            foot.Children.Add(Small(r.NormLine));
            foot.Children.Add(Small(r.ModelOnlyNote));
            _panel.Children.Add(foot);
        }

        private static TextBlock Small(string text)
        {
            var t = UiKit.Text(text ?? "", brush: UiKit.MutedBrush, wrap: true);
            t.FontSize = 11.5;
            t.Margin = new Thickness(0, 1, 0, 1);
            return t;
        }

        private UIElement LineCard(SimLine l)
        {
            Brush stripe = l.Severity == SimSeverity.Blocking ? UiKit.BlockingBrush : l.Severity == SimSeverity.Review ? UiKit.WarningBrush : UiKit.InfoBrush;
            var body = new StackPanel();
            var title = UiKit.Text("", bold: true, wrap: true);
            title.Inlines.Add(new System.Windows.Documents.Run(l.Severity == SimSeverity.Info ? "ℹ  " : "●  ") { Foreground = stripe });
            title.Inlines.Add(new System.Windows.Documents.Run(l.Text ?? ""));
            body.Children.Add(title);
            if (!string.IsNullOrEmpty(l.Consequence))
            {
                var cons = UiKit.Text("→ " + l.Consequence, wrap: true);
                cons.Margin = new Thickness(14, 2, 0, 0);
                body.Children.Add(cons);
            }
            if (l.Id != 0 || l.Keys.Count > 0)
            {
                var row = new WrapPanel { Margin = new Thickness(14, 4, 0, 0) };
                if (l.Keys.Count > 0)
                {
                    Button focus = UiKit.Btn("3D дээр харах", (s, e) => Guard(() => FocusLine(l)), 0);
                    focus.Padding = new Thickness(8, 2, 8, 2);
                    row.Children.Add(focus);
                }
                if (l.Id != 0)
                {
                    Button show = UiKit.Btn("Revit-д харуулах", async (s, e) => { try { await _s.ShowElementAsync(l.Id, l.Slot, CancellationToken.None); } catch (Exception ex) { _status = "⛔ " + ex.Message; RenderAll(); } }, 0);
                    show.Padding = new Thickness(8, 2, 8, 2);
                    show.Margin = new Thickness(6, 0, 0, 0);
                    row.Children.Add(show);
                }
                body.Children.Add(row);
            }
            return new Border
            {
                BorderBrush = stripe, BorderThickness = new Thickness(4, 0, 0, 0), Padding = new Thickness(8, 4, 6, 6), Margin = new Thickness(0, 0, 0, 6),
                Background = new SolidColorBrush(Color.FromArgb(18, 128, 128, 128)), Child = body,
            };
        }

        /// <summary>Мөрийн элементүүд рүү камерыг чиглүүлнэ (зөөгдөж буйгаа хамт).</summary>
        private void FocusLine(SimLine l)
        {
            if (_c.Scene == null) return;
            SimBox b = _c.MovedBounds;
            foreach (string k in l.Keys)
            {
                SimMesh m;
                if (_ctxByKey.TryGetValue(k, out m)) b.Add(m.Bounds);
            }
            if (l.BoxMm != null && l.BoxMm.Length >= 6) b.Add(new SimBox { MinX = l.BoxMm[0], MinY = l.BoxMm[1], MinZ = l.BoxMm[2], MaxX = l.BoxMm[3], MaxY = l.BoxMm[4], MaxZ = l.BoxMm[5] });
            _c.Camera.Fit(b.Expanded(600), ActualW(), ActualH());
            ApplyCamera();
        }

        /// <summary>Мөргөлдөөн бүрт улаан шошго (элементийн нэр) — 3D дээр ЯГ тэр газарт.  Хамгийн ихдээ 6.</summary>
        private void UpdateLabels()
        {
            _labels.Children.Clear();
            SimReport r = _c.Report;
            if (r == null || _c.Scene == null || _loading) return;
            double w = ActualW(), h = ActualH();
            int n = 0;
            foreach (SimLine l in r.Lines)
            {
                if (l.Severity == SimSeverity.Info || n >= 6) continue;
                SimVec? at = null;
                if (l.BoxMm != null && l.BoxMm.Length >= 6) at = new SimVec((l.BoxMm[0] + l.BoxMm[3]) / 2, (l.BoxMm[1] + l.BoxMm[4]) / 2, (l.BoxMm[2] + l.BoxMm[5]) / 2);
                else if (l.Keys.Count > 0)
                {
                    SimMesh m;
                    if (_ctxByKey.TryGetValue(l.Keys[0], out m) && !m.Bounds.IsEmpty)
                    {
                        // Нийт хүрээний төв биш — зөөгдөж буйтай огтлолцсон хэсгийн төв.
                        SimBox ov = m.Bounds.Intersection(_c.MovedBounds);
                        at = (ov.IsEmpty ? m.Bounds : ov).Center;
                    }
                }
                if (!at.HasValue) continue;
                double sx, sy;
                if (!_c.Camera.Project(at.Value, w, h, out sx, out sy)) continue;
                if (sx < -20 || sy < -20 || sx > w + 20 || sy > h + 20) continue;
                string text = LabelOf(l);
                var tag = new Border
                {
                    // Улаан = мөргөлдөөн; улбар шар = Revit-ээр дагаж өөрчлөгдөх (дам нуруу, хана…).
                    Background = new SolidColorBrush(l.Code == "affected" ? Color.FromArgb(235, 214, 120, 20) : Color.FromArgb(235, 214, 32, 32)), CornerRadius = new CornerRadius(3), Padding = new Thickness(5, 2, 5, 2),
                    Child = new TextBlock { Text = "⚠ " + text, Foreground = Brushes.White, FontSize = 11.5, FontWeight = FontWeights.SemiBold },
                };
                Canvas.SetLeft(tag, Math.Max(2, Math.Min(w - 150, sx + 8)));
                Canvas.SetTop(tag, Math.Max(2, Math.Min(h - 24, sy - 22 - n * 2)));
                _labels.Children.Add(tag);
                n++;
            }
        }

        private string LabelOf(SimLine l)
        {
            if (l.Code == "clash.group") return (l.Text ?? "").Split(new[] { ':' }, 2)[0];
            if (l.Keys.Count > 0)
            {
                SimMesh m;
                if (_ctxByKey.TryGetValue(l.Keys[0], out m) && !string.IsNullOrEmpty(m.Label)) return Shorten(m.Label);
            }
            return Shorten(l.Text ?? "");
        }

        private static string Shorten(string s)
        {
            if (s == null) return "";
            return s.Length <= 38 ? s : s.Substring(0, 37) + "…";
        }

        /// <summary>
        /// Цонх аль хэдийн нээлттэй үед хэрэглэгч Revit-д ӨӨР элемент сонгоод хэрэгслийг дахин дарсан — шинэ элементийг ачаална (чирж, шалгаж, зөөж байх үед хөндөхгүй).
        /// </summary>
        internal void SwitchTo(IList<long> ids)
        {
            if (_closed || ids == null || ids.Count == 0) return;
            if (_applying || _loading || _dragging) { _status = "Ажил дуустал хүлээнэ үү — дараа нь «Өөр элемент сонгох»."; RenderAll(); return; }
            LoadScene(ids);
        }

        /* ============================== ТЕСТИЙН ХААЛГА ====================== */

        internal bool NudgeForTest(SimVec offsetMm) { return ApplyNudge(offsetMm); }
        /// <summary>Шалгалтын хэрэгсэлд л: 🟠 баталгаажуулах асуултыг MessageBox-гүйгээр хариулна (null = жинхэнэ MessageBox).</summary>
        internal Func<string, bool> ConfirmForTest { get; set; }
        internal void ApproveForTest() { OnApprove(); }
        internal SimController Controller { get { return _c; } }
        internal bool IsLoading { get { return _loading; } }
        internal string StatusText { get { return _statusText.Text; } }
        internal string BannerTitle { get { return _bannerTitle.Text; } }
        internal Button ApproveButton { get { return _approve; } }
        internal int PanelChildCount { get { return _panel.Children.Count; } }
        internal int ContextModelCount { get { return _contextModels.Count; } }
        internal FrameworkElement ViewportHost { get { return _vpHost; } }
    }
}
