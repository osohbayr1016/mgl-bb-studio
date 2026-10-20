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
using System.Windows.Threading;
using RevitMcpAddin.ChangeImpact.Core;
using RevitMcpAddin.Smart.Core;
using RevitMcpAddin.Smart.Ui;

namespace RevitMcpAddin.ChangeImpact.Ui
{
    /// <summary>
    /// «MGL — Хаалга зөөх (simulation)» — модальгүй цонх.  Revit-ийн төрлийг мэдэхгүй (`IPreChangeSession` + `IDoorMoveSession`).
    /// Бүх шийдвэр, текст, тоо `DoorMoveView` (цэвэр) ба `DoorSimulationController` (цэвэр төлөвийн машин)-оос; цонх зөвхөн ЗУРНА.
    ///
    /// 30–60 СЕКУНДЫН АЖЛЫН УРСГАЛ (захирал, архитектор):
    ///   1. Revit-д хаалгаа сонго (эсвэл «Өөр хаалга сонгох»).  Цонх нээгдэхэд сонгосон хаалга АВТОМАТААР орно.
    ///   2. «Зураг дээр сонгох» → ханан дээр дарна, ЭСВЭЛ ← → / ±10 ±50 ±100 товч, ЭСВЭЛ зайг бичнэ (+300, −250).
    ///      → хаалганы ШИНЭ байрлал (ghost), нөлөөлөх элемент (улаан/улбар шар/шар/цэнхэр) Revit-ийн ЗУРАГ ДЭЭР шууд харагдана.
    ///   3. Урьдчилсан дүн ~шууд (0.5 мс-ийн хайрцгийн шалгалт), эцсийн техникийн дүгнэлт (sandbox) 220 мс-ийн debounce-ийн дараа.
    ///   4. НЭГ ШИЙДВЭР: 🟢 ТЕХНИКИЙН ХУВЬД ЗӨӨЖ БОЛНО · 🟠 ХЯНААД ЗӨӨ · 🔴 ЗӨӨХГҮЙ · ⚪ ДҮГНЭХ БОЛОМЖГҮЙ — «Ноцтой» бүлэг түрүүлнэ, карт дарвал тухайн бүлгийг л тодруулна.
    ///   5. «Зөөх» (БАТЛАХ) = ЯГ НЭГ бодит зөөлт, нэг Undo.  «Цуцлах» = хаалга ХЭЗЭЭ Ч хөдлөөгүй, ghost арилна.
    ///
    /// ⚠️ Энэ нь МОДЕЛИЙН техникийн дүгнэлт.  Монгол нормын автомат шалгалт, хаалганы дүүжин (swing) ХИЙГДЭЭГҮЙ — цонх үргэлж тэгж ИЛ хэлнэ.
    /// ⚠️ Бодит хаалгыг хулганаар ХЭЗЭЭ Ч «чирэхгүй».  Preview загварт ямар ч өөрчлөлт хийхгүй (түр транзакц БҮТНЭЭРЭЭ буцаагдана).
    /// </summary>
    internal sealed class DoorMoveWindow : Window, IDoorSimulationHost
    {
        private const int MaxItemsPerGroup = 40;
        private const int TickMs = 40;
        private const int PollEveryTicks = 25;       // ~1 с

        private readonly IPreChangeSession _s;
        private readonly IDoorMoveSession _d;
        private readonly Stopwatch _clock = Stopwatch.StartNew();
        private readonly Dictionary<int, CancellationTokenSource> _exact = new Dictionary<int, CancellationTokenSource>();
        private readonly DispatcherTimer _timer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(TickMs) };

        private PreChangeSelection _sel;
        private PreChangeSelection _offered;
        private DoorMoveContext _ctx;
        private DoorSimulationController _c;
        private bool _closed, _loading, _picking, _applying, _pollBusy, _renderPending;
        private int _loadSeq, _ticks;
        private string _declinedUid, _ignoredUid;
        private string _progressText = "";
        private string _banner = "";
        private readonly List<long> _autoReloads = new List<long>();
        private FreshnessState _renderedFreshness = FreshnessState.Unknown;

        // ---- хаалга
        private readonly TextBlock _doorInfo = UiKit.Text("", wrap: true, bold: true);
        private readonly TextBlock _doorWarn = UiKit.Text("", brush: UiKit.WarningBrush, wrap: true);
        private readonly TextBlock _offer = UiKit.Text("", brush: UiKit.InfoBrush, wrap: true, bold: true);
        private readonly Button _offerBtn, _pickDoorBtn;
        private readonly Border _offerBox;

        // ---- шинэ байрлал
        private readonly TextBlock _offsetText = UiKit.Text("", bold: true);
        private readonly TextBox _offsetBox = UiKit.Box("", 80);
        private readonly TextBlock _offsetErr = UiKit.Text("", brush: UiKit.BlockingBrush, wrap: true);
        private readonly List<Button> _nudges = new List<Button>();
        private readonly Button _pickTargetBtn, _resetBtn;

        // ---- дүн
        private readonly StackPanel _result = new StackPanel { Margin = new Thickness(8, 4, 8, 4) };
        private readonly ProgressBar _bar = new ProgressBar { Height = 4, Minimum = 0, Maximum = 1, IsIndeterminate = true, Margin = new Thickness(2, 2, 2, 2), Visibility = Visibility.Collapsed };
        private readonly TextBlock _status = UiKit.Text("", brush: UiKit.MutedBrush, wrap: true);

        // ---- доод (sticky) мөр
        private readonly Button _primary, _discardBtn, _recheckBtn;
        private readonly TextBlock _gateHint = UiKit.Text("", brush: UiKit.MutedBrush, wrap: true);

        internal DoorMoveWindow(IPreChangeSession session, IDoorMoveSession door)
        {
            _s = session;
            _d = door;
            Title = "MGL — Хаалга зөөх · " + (session.DocumentTitle ?? "");
            Width = 580;
            Height = 840;
            MinWidth = 460;
            MinHeight = 580;
            ShowInTaskbar = false;
            Topmost = false;
            UiKit.Prepare(this, "door-move-simulation");

            _pickDoorBtn = UiKit.Btn("Өөр хаалга сонгох", (s, e) => OnPickDoor(), 130);
            _offerBtn = UiKit.Btn("Үүнийг шалгах", (s, e) => OnAdoptOffer(), 110);
            _offerBox = new Border
            {
                BorderThickness = new Thickness(1), BorderBrush = UiKit.InfoBrush, Padding = new Thickness(6), Margin = new Thickness(0, 4, 0, 2), Visibility = Visibility.Collapsed,
                Child = UiKit.Wrap(_offer, _offerBtn),
            };

            _pickTargetBtn = UiKit.Btn("Зураг дээр сонгох", (s, e) => OnPickTarget(), 140);
            _pickTargetBtn.ToolTip = "Revit-ийн зураг дээр шинэ байрлал дээр дарна — хананы дагуу шахагдана (Esc = цуцлах).";
            _resetBtn = UiKit.Btn("Анхны байрлал", (s, e) => { if (_c != null) _c.SetTarget(0); }, 110);

            _offsetBox.ToolTip = "Хаалганы одоогийн байрлалаас хананы дагуух зай (мм).  Жишээ: +300, −250, 0.3 м.  Enter дарахад шалгана.";
            _offsetBox.KeyDown += (s, e) => { if (e.Key == Key.Enter) { OnOffsetTyped(); e.Handled = true; } };
            _offsetBox.LostKeyboardFocus += (s, e) => OnOffsetTyped(onlyIfChanged: true);

            _primary = UiKit.Btn("Эхлээд шинэ байрлал заана", (s, e) => OnApprove(), 240);
            _primary.FontWeight = FontWeights.SemiBold;
            _primary.FontSize = 14;
            _primary.Padding = new Thickness(14, 8, 14, 8);
            _primary.IsEnabled = false;
            _discardBtn = UiKit.Btn("Цуцлах", (s, e) => OnDiscard(), 90);
            _discardBtn.ToolTip = "Хаалга ХЭЗЭЭ Ч хөдлөөгүй — зөвхөн ghost, тодруулга арилна.  (Esc)";
            _recheckBtn = UiKit.Btn("Дахин шалгах", (s, e) => OnRecheck(), 110);
            _recheckBtn.Visibility = Visibility.Collapsed;

            Content = BuildLayout();
            PreviewKeyDown += OnPreviewKeyDown;
            Render();

            _timer.Tick += (s, e) => OnTick();
            Loaded += (s, e) => { AdoptCurrentSelection(true); _timer.Start(); };
            Closing += (s, e) => { if (_applying) e.Cancel = true; };
            Closed += (s, e) => ShutDown();
        }

        /* ============================== LAYOUT ============================= */

        private UIElement BuildLayout()
        {
            var nudgeRow = new WrapPanel { Margin = new Thickness(0, 4, 0, 0) };
            nudgeRow.Children.Add(UiKit.Text("Зөөх:", bold: true));
            var steps = DoorMoveInput.NudgeSteps;
            for (int i = steps.Length - 1; i >= 0; i--) nudgeRow.Children.Add(MakeNudge(-steps[i]));
            for (int i = 0; i < steps.Length; i++) nudgeRow.Children.Add(MakeNudge(steps[i]));

            var typeRow = new WrapPanel { Margin = new Thickness(0, 4, 0, 0) };
            typeRow.Children.Add(UiKit.Text("Зай (мм):", bold: true));
            typeRow.Children.Add(_offsetBox);
            typeRow.Children.Add(_pickTargetBtn);
            typeRow.Children.Add(_resetBtn);

            var head = UiKit.Col(_doorInfo, _doorWarn, UiKit.Wrap(_pickDoorBtn), _offerBox, nudgeRow, typeRow, _offsetText, _offsetErr, _bar, _status);
            head.Margin = new Thickness(8, 6, 8, 2);

            var scroll = new ScrollViewer { VerticalScrollBarVisibility = ScrollBarVisibility.Auto, Content = _result };

            var foot = new StackPanel { Margin = new Thickness(8, 4, 8, 8) };
            _primary.HorizontalAlignment = HorizontalAlignment.Stretch;
            foot.Children.Add(_primary);
            foot.Children.Add(_gateHint);
            foot.Children.Add(UiKit.Wrap(_discardBtn, _recheckBtn));

            var root = new DockPanel();
            DockPanel.SetDock(head, Dock.Top);
            var footBorder = new Border { BorderThickness = new Thickness(0, 1, 0, 0), BorderBrush = UiKit.LineBrush, Child = foot };
            DockPanel.SetDock(footBorder, Dock.Bottom);
            root.Children.Add(head);
            root.Children.Add(footBorder);
            root.Children.Add(scroll);
            return root;
        }

        private Button MakeNudge(int deltaMm)
        {
            string label = (deltaMm > 0 ? "+" : "−") + Math.Abs(deltaMm);
            Button b = UiKit.Btn(label, (s, e) => { if (_c != null) _c.Nudge(deltaMm); }, 52);
            b.ToolTip = deltaMm > 0 ? "Хананы эхлэлээс төгсгөл рүү " + Math.Abs(deltaMm) + " мм" : "Хананы төгсгөлөөс эхлэл рүү " + Math.Abs(deltaMm) + " мм";
            _nudges.Add(b);
            return b;
        }

        /* ============================== ГАР (← →, Esc) ===================== */

        private void OnPreviewKeyDown(object sender, KeyEventArgs e)
        {
            if (_applying || _closed) return;
            // Бичиж байхад (TextBox) сумаар зай өөрчлөхгүй — «аюулгүй» хэсэг л.
            if (Keyboard.FocusedElement is TextBox) { if (e.Key == Key.Escape) { Keyboard.ClearFocus(); e.Handled = true; } return; }
            if (_c == null) return;
            bool ctrl = (Keyboard.Modifiers & ModifierKeys.Control) != 0, shift = (Keyboard.Modifiers & ModifierKeys.Shift) != 0;
            switch (e.Key)
            {
                case Key.Left: _c.Nudge(-DoorMoveInput.KeyStepMm(ctrl, shift)); e.Handled = true; break;
                case Key.Right: _c.Nudge(DoorMoveInput.KeyStepMm(ctrl, shift)); e.Handled = true; break;
                case Key.Escape: OnDiscard(); e.Handled = true; break;
            }
        }

        /* ============================== ХААЛГА (сонголт) ==================== */

        private async void AdoptCurrentSelection(bool silentIfNone)
        {
            string error = null;
            PreChangeSelection sel = null;
            try { sel = await _d.GetDoorSelectionAsync(CancellationToken.None); }
            catch (Exception ex) { error = ex.Message; }
            UiThread.Run(Dispatcher, () =>
            {
                if (_closed) return;
                if (error != null) { _status.Text = "⛔ " + error; return; }
                if (sel == null) return;
                if (!sel.Valid && silentIfNone && string.IsNullOrEmpty(sel.Problem))
                {
                    _doorInfo.Text = "Revit-д хаалгаа сонгоно уу — цонх автоматаар авна.  Эсвэл «Өөр хаалга сонгох».";
                    return;
                }
                ApplySelection(sel);
            });
        }

        private async void OnPickDoor()
        {
            if (_applying || _picking) return;
            _picking = true;
            _status.Text = "Revit-д хаалгаа сонгоно уу…";
            string error = null;
            PreChangeSelection sel = null;
            try { sel = await _d.PickDoorAsync(CancellationToken.None); }
            catch (OperationCanceledException) { }
            catch (Exception ex) { error = ex.Message; }
            UiThread.Run(Dispatcher, () =>
            {
                _picking = false;
                _status.Text = "";
                if (_closed) return;
                if (error != null) { _status.Text = "⛔ " + error; return; }
                if (sel != null && (sel.Valid || !string.IsNullOrEmpty(sel.Problem))) { _declinedUid = null; ApplySelection(sel); }
            });
        }

        private void ApplySelection(PreChangeSelection sel)
        {
            CloseController();
            _offered = null;
            _offerBox.Visibility = Visibility.Collapsed;
            _doorWarn.Text = "";
            _offsetErr.Text = "";
            _offsetBox.Text = "";
            _sel = sel;
            _ctx = null;
            if (!sel.Valid)
            {
                _doorInfo.Text = string.IsNullOrEmpty(sel.Problem) ? "Хаалга сонгоогүй." : "⛔ " + sel.Problem;
                Render();
                return;
            }

            // Workshare: хэн ч эзэмшээгүй — preview түр эзэмшил үүсгэж болзошгүй.  ЭХЛЭХЭЭС ӨМНӨ асууна, чимээгүй авахгүй.
            if (sel.NeedsCheckoutAck && !_s.OwnershipAcknowledged(sel))
            {
                bool yes = MessageBox.Show(this, PreChangeText.OwnershipAckDoor, Title, MessageBoxButton.YesNo, MessageBoxImage.Question) == MessageBoxResult.Yes;
                if (!yes)
                {
                    _declinedUid = sel.SourceUid;
                    _doorInfo.Text = "Шалгалтыг эхлүүлээгүй — эзэмшлийн сэрэмжлүүлгийг зөвшөөрөөгүй.  «Өөр хаалга сонгох» эсвэл Revit-д дахин сонгоно уу.";
                    _sel = null;
                    Render();
                    return;
                }
                _declinedUid = null;
                _s.AcknowledgeOwnership(sel);
            }

            _doorInfo.Text = HeaderOf(sel);
            _doorWarn.Text = string.Join("\n", sel.Warnings.Select(w => "⚠ " + w));
            LoadContext(sel, false);
        }

        private static string HeaderOf(PreChangeSelection sel)
        {
            var parts = new List<string> { "Хаалга: " + (string.IsNullOrWhiteSpace(sel.Mark) ? sel.Label : sel.Mark) };
            if (sel.DoorWidthMm > 0 && sel.DoorHeightMm > 0) parts.Add(Math.Round(sel.DoorWidthMm).ToString("0") + " × " + Math.Round(sel.DoorHeightMm).ToString("0"));
            if (!string.IsNullOrEmpty(sel.LevelName)) parts.Add(sel.LevelName);
            string text = string.Join(" · ", parts);
            if (!string.IsNullOrEmpty(sel.FromRoom) || !string.IsNullOrEmpty(sel.ToRoom))
                text += "\n" + (string.IsNullOrEmpty(sel.FromRoom) ? "гадна" : sel.FromRoom) + " ↔ " + (string.IsNullOrEmpty(sel.ToRoom) ? "гадна" : sel.ToRoom);
            if (!string.IsNullOrEmpty(sel.HostLabel)) text += "\nХост: " + sel.HostLabel + " · урт " + PreChangeText.Mm(sel.LengthMm);
            return text;
        }

        /// <summary>Хаалганы контекстыг (хост, нүх, саад, өрөө) уншина.  `reload` = загвар өөрчлөгдсөн тул шинэчлэх: контроллер, зорилт хэвээр.</summary>
        private async void LoadContext(PreChangeSelection sel, bool reload)
        {
            int seq = ++_loadSeq;
            _loading = true;
            _status.Text = reload ? "Загвар өөрчлөгдсөн — хаалганы орчныг дахин уншиж байна…" : "Хаалганы орчныг (хана, нүх, саад, өрөө) уншиж байна…";
            Render();
            DoorContextLoad load = null;
            string error = null;
            try { load = await _d.LoadContextAsync(sel, CancellationToken.None); }
            catch (Exception ex) { error = ex.Message; }
            UiThread.Run(Dispatcher, () =>
            {
                if (_closed || seq != _loadSeq) return;
                _loading = false;
                _status.Text = "";
                if (error != null || load == null || !load.Ok)
                {
                    _ctx = null;
                    _doorInfo.Text = "⛔ " + (error ?? (load != null ? load.Problem : "Контекст уншигдсангүй.")) + (load != null && load.Refused ? "  (Revit энэ хаалгыг зөөхийг зөвшөөрөхгүй.)" : "");
                    if (_c != null) _c.Close();
                    _c = null;
                    Render();
                    return;
                }
                _ctx = load.Context;
                _banner = "";
                if (!reload || _c == null)
                {
                    _c = new DoorSimulationController(this, sel);
                    _c.SetContext(_ctx);
                }
                else
                {
                    _c.SetContext(_ctx);
                    if (_c.HasTarget) _c.Recheck();
                }
                Render();
            });
        }

        private void CloseController()
        {
            CancelAllExact();
            if (_c != null) _c.Close();
            _c = null;
            _ctx = null;
            _loadSeq++;
            _loading = false;
        }

        /* ============================== ШИНЭ БАЙРЛАЛ ======================== */

        private void OnOffsetTyped(bool onlyIfChanged = false)
        {
            string t = (_offsetBox.Text ?? "").Trim();
            if (onlyIfChanged && string.Equals(t, _lastTyped, StringComparison.Ordinal)) return;
            _lastTyped = t;
            _offsetErr.Text = "";
            if (t.Length == 0 || _c == null) return;
            double? mm = DoorMoveInput.ParseSignedOffsetMm(t);
            if (!mm.HasValue) { _offsetErr.Text = "Зайг мм-ээр, тэмдэгтэй бичнэ үү (жишээ: +300 эсвэл −250)."; return; }
            _c.SetTarget(mm.Value);
        }

        private string _lastTyped = "";

        private async void OnPickTarget()
        {
            if (_c == null || _ctx == null || _applying || _picking) return;
            _picking = true;
            _status.Text = "Зураг дээр хаалганы шинэ байрлал дээр дарна уу…";
            Render();
            string error = null;
            DoorTargetPick r = null;
            try { r = await _d.PickTargetAsync(_ctx, CancellationToken.None); }
            catch (Exception ex) { error = ex.Message; }
            UiThread.Run(Dispatcher, () =>
            {
                _picking = false;
                _status.Text = "";
                if (_closed) return;
                if (error != null) { _status.Text = "⛔ " + error; Render(); return; }
                if (r == null || r.Cancelled) { Render(); return; }
                if (!r.OffsetMm.HasValue) { _offsetErr.Text = r.Message ?? "Байрлал тодорхойгүй."; Render(); return; }
                _offsetErr.Text = "";
                if (_c != null) _c.SetTarget(r.OffsetMm.Value);
                Render();
            });
        }

        /// <summary>«Дахин шалгах»: контекст хуучирсан бол ЭХЛЭЭД шинээр уншина (автомат унших зогссон байж болно), үгүй бол зөвхөн шинжилгээг дахин ажиллуулна.</summary>
        private void OnRecheck()
        {
            if (_c == null || _applying) return;
            if (_sel != null && _sel.Valid && _ctx != null && !_d.IsContextCurrent(_ctx)) { _autoReloads.Clear(); _banner = ""; LoadContext(_sel, true); return; }
            _c.Recheck();
        }

        private void OnDiscard()
        {
            if (_c == null || _applying) return;
            CancelAllExact();
            _c.Discard();
            _offsetBox.Text = "";
            _lastTyped = "";
            _offsetErr.Text = "";
        }

        /* ============================== EXACT (sandbox) — IDoorSimulationHost = */

        public long NowMs { get { return _clock.ElapsedMilliseconds; } }

        public void StartExact(int generation, PreChangeRequest request)
        {
            var cts = new CancellationTokenSource();
            _exact[generation] = cts;
            _progressText = "";
            IProgress<JobProgress> progress = UiThread.Progress<JobProgress>(Dispatcher, p =>
            {
                if (_c != null && generation == _c.Generation) { _progressText = p.Message ?? ""; MarkDirty(); }
            });
            Action<PreChangeReport> provisional = rep =>
            {
                // Revit-ийн thread-ээс — UI thread руу.  Хуучин generation-ийнх бол контроллер өөрөө хаяна.
                Dispatcher.BeginInvoke(new Action(() => { if (!_closed && _c != null) _c.OnExactProvisional(generation, rep); }));
            };
            RunExact(generation, request, progress, provisional, cts);
        }

        private async void RunExact(int generation, PreChangeRequest request, IProgress<JobProgress> progress, Action<PreChangeReport> provisional, CancellationTokenSource cts)
        {
            PreChangeReport final = null;
            string error = null;
            bool cancelled = false;
            try { final = await _s.PreviewAsync(request, progress, provisional, cts.Token); }
            catch (OperationCanceledException) { cancelled = true; }
            catch (Exception ex) { error = ex.Message; }
            UiThread.Run(Dispatcher, () =>
            {
                _exact.Remove(generation);
                try { cts.Dispose(); } catch (Exception) { }
                if (_closed || _c == null) return;
                if (final != null) _c.OnExactFinished(generation, final);
                else _c.OnExactFailed(generation, cancelled ? "Цуцлагдсан" : (error ?? "Шинжилгээний дүн гарсангүй.") + "  (Загварт өөрчлөлт хийгдээгүй.)", cancelled);
            });
        }

        public void CancelExact(int generation)
        {
            CancellationTokenSource cts;
            if (_exact.TryGetValue(generation, out cts))
            {
                try { cts.Cancel(); } catch (Exception) { }
            }
        }

        private void CancelAllExact()
        {
            foreach (CancellationTokenSource cts in _exact.Values.ToList())
            {
                try { cts.Cancel(); } catch (Exception) { }
            }
        }

        /* ============================== ЗУРАГЛАЛ (Revit дээр) =============== */

        public void ShowVisual(DoorVisualState visual)
        {
            if (_closed || visual == null) return;
            try { _d.ShowVisual(visual); }
            catch (Exception) { /* ghost нь зөвхөн харагдац — шинжилгээ, шийдвэрт нөлөөлөхгүй */ }
        }

        public void ClearVisual()
        {
            try { _d.ClearVisual(); }
            catch (Exception) { }
        }

        public void Changed()
        {
            MarkDirty();
        }

        private void MarkDirty()
        {
            if (_renderPending || _closed) return;
            _renderPending = true;
            Dispatcher.BeginInvoke(new Action(() => { _renderPending = false; if (!_closed) Render(); }), DispatcherPriority.Background);
        }

        /* ============================== ТАЙМЕР ============================== */

        private void OnTick()
        {
            if (_closed) return;
            if (_c != null) _c.Tick();
            if (++_ticks % PollEveryTicks != 0 || _applying) return;

            if (_c != null && _c.ExactReport != null && _c.ExactReportGeneration == _c.Generation)
            {
                FreshnessState f = SafeFreshness(_c.ExactReport);
                if (f != _renderedFreshness) Render();
            }
            PollModelAndSelection();
        }

        private FreshnessState SafeFreshness(PreChangeReport r)
        {
            try { return _s.CheckFreshness(r); }
            catch (Exception) { return FreshnessState.Unknown; }
        }

        /// <summary>Загвар өөрчлөгдсөн бол контекстыг шинэчилнэ; Revit-д ӨӨР хаалга сонгогдсон бол санал болгоно (бодит хөдөлгөөнийг чимээгүй алдуулахгүй).</summary>
        private async void PollModelAndSelection()
        {
            if (_pollBusy || _loading || _picking || _applying) return;
            if (_sel != null && _sel.Valid && _ctx != null && !_d.IsContextCurrent(_ctx))
            {
                // Хаалганы эргэн тойрон өөрчлөгдсөн — хуучин контекстоор «зөөж болно» гэж ХЭЗЭЭ Ч хэлэхгүй.
                // Гэхдээ загвар БАЙНГА өөрчлөгдөж байвал (жишээ нь буцаалт баталгаагүй) автоматаар дахин унших гогцоонд ОРОХГҮЙ: 15 с-д ≤ 3 удаа.
                long now = _clock.ElapsedMilliseconds;
                _autoReloads.RemoveAll(t => now - t > 15000);
                if (_autoReloads.Count >= 3)
                {
                    if (string.IsNullOrEmpty(_banner))
                    {
                        _banner = "Загвар байнга өөрчлөгдөж байна — автоматаар дахин унших түр зогсов.  Тайван болмогц «Дахин шалгах» дарна уу.";
                        MarkDirty();
                    }
                    return;
                }
                _autoReloads.Add(now);
                LoadContext(_sel, true);
                return;
            }
            _pollBusy = true;
            PreChangeSelection next = null;
            try
            {
                string uid = await _d.PeekSelectedDoorAsync(CancellationToken.None);
                if (uid == null || (_declinedUid != null && !string.Equals(uid, _declinedUid, StringComparison.Ordinal))) _declinedUid = null;
                if (uid == null || (_ignoredUid != null && !string.Equals(uid, _ignoredUid, StringComparison.Ordinal))) _ignoredUid = null;
                bool same = uid == null || (_sel != null && _sel.Valid && string.Equals(uid, _sel.SourceUid, StringComparison.Ordinal))
                    || (_offered != null && string.Equals(uid, _offered.SourceUid, StringComparison.Ordinal))
                    || (_declinedUid != null && string.Equals(uid, _declinedUid, StringComparison.Ordinal))
                    || (_ignoredUid != null && string.Equals(uid, _ignoredUid, StringComparison.Ordinal));
                if (!same)
                {
                    next = await _d.GetDoorSelectionAsync(CancellationToken.None);
                    if (next != null && !next.Valid) _ignoredUid = uid;
                }
            }
            catch (Exception) { }
            UiThread.Run(Dispatcher, () =>
            {
                _pollBusy = false;
                if (_closed || next == null || _applying || _loading) return;
                if (_sel != null && _sel.Valid && string.Equals(_sel.SourceUid, next.SourceUid, StringComparison.Ordinal)) return;
                if (_declinedUid != null && string.Equals(_declinedUid, next.SourceUid, StringComparison.Ordinal)) return;
                if (_c == null || !_c.HasTarget) { ApplySelection(next); return; }
                _offered = next;
                _offer.Text = "Revit-д өөр хаалга сонгогдсон: " + (string.IsNullOrWhiteSpace(next.Mark) ? next.Label : next.Mark) + ".";
                _offerBox.Visibility = Visibility.Visible;
            });
        }

        private void OnAdoptOffer()
        {
            if (_offered == null) return;
            PreChangeSelection n = _offered;
            _offered = null;
            _offerBox.Visibility = Visibility.Collapsed;
            ApplySelection(n);
        }

        /* ============================== APPROVE ============================= */

        private async void OnApprove()
        {
            if (_c == null || _applying || _closed) return;
            FreshnessState fresh = _c.ExactReport != null ? SafeFreshness(_c.ExactReport) : FreshnessState.Unknown;
            DoorMoveView view = DoorMoveView.Build(_c, fresh);
            if (!view.Gate.PrimaryEnabled) return;

            // 🟠: хянах зүйлийг нэг удаа дахин харуулж, мэдсээр зөөлгөнө (яг ЭНЭ зорилтын эцсийн дүн).
            if (view.Decision != null && view.Decision.Verdict == MoveVerdict.MoveWithReview)
            {
                string reasons = string.Join("\n• ", view.Decision.Top.Take(5).Select(t => t.Text));
                if (MessageBox.Show(this, "Хянах зүйл:\n• " + reasons + "\n\nҮүнийг хараад хаалгыг зөөх үү?", Title, MessageBoxButton.YesNo, MessageBoxImage.Warning) != MessageBoxResult.Yes) return;
            }

            // Уралдаан: ЯГ ОДООГИЙН generation-ийн эцсийн дүн + шинэлэг байх ёстой — эс бөгөөс null.
            string refusal;
            PreChangeReport report = _c.TryBeginApply(fresh, out refusal);
            if (report == null) { _status.Text = refusal ?? ""; Render(); return; }
            PreChangeRequest current = _c.BuildRequest();

            _applying = true;
            CancelAllExact();
            _status.Text = "Хаалгыг зөөж, preview-тэй тулгаж байна…";
            Render();
            IProgress<JobProgress> progress = UiThread.Progress<JobProgress>(Dispatcher, p => { _status.Text = p.Message ?? ""; });
            ApplyOutcome outcome = null;
            string error = null;
            var swApply = Stopwatch.StartNew();
            try { outcome = await _s.ApplyAsync(report, current, progress, CancellationToken.None); }
            catch (Exception ex) { error = ex.Message; }
            long applyMs = swApply.ElapsedMilliseconds;

            UiThread.Run(Dispatcher, () =>
            {
                if (_c != null) _c.Timings.ApplyMs = applyMs;
                _applying = false;
                _status.Text = "";
                if (_closed) return;
                if (error != null)
                {
                    if (_c != null) _c.OnApplied(null);
                    _status.Text = "⛔ " + error + " Загварт өөрчлөлт орсон эсэхийг Revit-д шалгана уу.";
                    Render();
                    return;
                }
                if (_c != null) _c.OnApplied(outcome);
                _offsetBox.Text = "";
                _lastTyped = "";
                if (outcome != null && outcome.Moved && _sel != null && _sel.Valid)
                {
                    // Хаалга шинэ байрлалд — контекстыг (шинэ байрлал, From/To) дахин уншина; дараагийн зөөлт шинэ байрлалаас.
                    _status.Text = outcome.Message ?? "";
                    LoadContext(_sel, true);
                }
                Render();
            });
        }

        /* ============================== ХААГДАХ ============================= */

        private void ShutDown()
        {
            _closed = true;
            _timer.Stop();
            _loadSeq++;
            CancelAllExact();
            try { if (_c != null) _c.Close(); } catch (Exception) { }
            ClearVisual();
        }

        /* ============================== ДҮН (render) ======================== */

        private void Render()
        {
            if (_closed) return;
            var swRender = Stopwatch.StartNew();
            try { RenderCore(); }
            finally { if (_c != null) _c.Timings.RenderMs = swRender.Elapsed.TotalMilliseconds; }
        }

        private void RenderCore()
        {
            _result.Children.Clear();
            bool busy = _applying || _loading || _picking;
            bool hasCtl = _c != null;
            FreshnessState fresh = hasCtl && _c.ExactReport != null && _c.ExactReportGeneration == _c.Generation ? SafeFreshness(_c.ExactReport) : FreshnessState.Unknown;
            _renderedFreshness = fresh;
            DoorMoveView view = hasCtl ? DoorMoveView.Build(_c, fresh) : null;

            _bar.Visibility = busy || (view != null && view.Busy) ? Visibility.Visible : Visibility.Collapsed;
            _pickDoorBtn.IsEnabled = !_applying;
            bool canEdit = hasCtl && !_applying && !_loading;
            foreach (Button b in _nudges) b.IsEnabled = canEdit;
            _offsetBox.IsEnabled = canEdit;
            _pickTargetBtn.IsEnabled = canEdit && !_picking;
            _resetBtn.IsEnabled = canEdit && _c.HasTarget;
            _discardBtn.IsEnabled = hasCtl && !_applying && (_c.HasTarget || _c.Phase != ExactPhase.None);
            _offsetText.Text = view != null && view.HasTarget ? "Шинэ байрлал: " + view.OffsetText + " (хананы дагуу)" : "";
            if (view != null && view.HasTarget && !_offsetBox.IsKeyboardFocusWithin) _offsetBox.Text = DoorMoveInput.FormatSignedOffset(view.OffsetMm ?? 0);
            if (!string.IsNullOrEmpty(_progressText) && view != null && view.Busy && !_applying) _status.Text = _progressText;
            else if (!_applying && !_loading && !_picking) _status.Text = "";

            if (view == null)
            {
                RenderEmpty();
                RenderFooter(null);
                return;
            }

            if (!string.IsNullOrEmpty(_banner)) _result.Children.Add(Banner("⚠ " + _banner, UiKit.WarningBrush));
            if (!string.IsNullOrEmpty(view.Notice)) _result.Children.Add(Banner("ℹ " + view.Notice, UiKit.InfoBrush));
            if (fresh != FreshnessState.Fresh && view.VerdictIsFinal && !view.Busy)
                _result.Children.Add(Banner("⚠ " + (fresh == FreshnessState.Stale ? PreChangeText.StalePreview : PreChangeFreshness.UnknownNotice), UiKit.WarningBrush));

            RenderDecision(view);
            if (view.HasTarget)
            {
                RenderCounters(view);
                RenderGroups(view);
                RenderDocs(view);
                RenderClearance(view);
            }
            _result.Children.Add(UiKit.Text(DoorMoveView.SwingText, brush: UiKit.MutedBrush, wrap: true));
            _result.Children.Add(NormBox(view));
            _result.Children.Add(new Expander
            {
                Header = "Техникийн мэдээлэл", IsExpanded = false, Margin = new Thickness(0, 6, 0, 2), FontWeight = FontWeights.SemiBold,
                Content = UiKit.Text(view.TechnicalInfo ?? "", brush: UiKit.MutedBrush, wrap: true),
            });
            RenderFooter(view);
        }

        private void RenderEmpty()
        {
            string t;
            if (_loading) t = "Хаалганы орчныг уншиж байна…";
            else if (_sel == null || !_sel.Valid) t = "1. Revit-д хаалгаа сонгоно уу.";
            else t = "2. «Зураг дээр сонгох», ← → эсвэл ±10 ±50 ±100 товчоор шинэ байрлал заана уу.  Хаалганы сүүдэр Revit-ийн зураг дээр шууд харагдана.";
            _result.Children.Add(UiKit.Text(t, brush: UiKit.MutedBrush, wrap: true));
            _result.Children.Add(NormBox(null));
        }

        private UIElement Banner(string text, Brush brush)
        {
            return new Border
            {
                BorderThickness = new Thickness(1), BorderBrush = brush, Padding = new Thickness(6), Margin = new Thickness(0, 2, 0, 6),
                Child = UiKit.Text(text, brush: brush, bold: true, wrap: true),
            };
        }

        private static Brush ToneBrush(ItemSeverity s)
        {
            switch (s)
            {
                case ItemSeverity.Critical: return UiKit.BlockingBrush;
                case ItemSeverity.Warning: return UiKit.WarningBrush;
                case ItemSeverity.Notice: return UiKit.InfoBrush;
                default: return UiKit.OkBrush;
            }
        }

        private static Brush VerdictBrush(DoorMoveView v)
        {
            if (!v.VerdictIsFinal) return v.Tone == ItemSeverity.Critical ? UiKit.BlockingBrush : v.Tone == ItemSeverity.Warning ? UiKit.WarningBrush : UiKit.MutedBrush;
            switch (v.Verdict)
            {
                case MoveVerdict.MoveOk: return UiKit.OkBrush;
                case MoveVerdict.MoveWithReview: return UiKit.WarningBrush;
                case MoveVerdict.DoNotMove: return UiKit.BlockingBrush;
                default: return UiKit.MutedBrush;
            }
        }

        private void RenderDecision(DoorMoveView v)
        {
            Brush tone = VerdictBrush(v);
            var title = UiKit.Text(v.Mark + " " + v.Title, bold: true, brush: tone, wrap: true);
            title.FontSize = 20;
            var body = UiKit.Col(title);
            if (!string.IsNullOrEmpty(v.StageLabel)) body.Children.Add(UiKit.Text(v.StageLabel, brush: UiKit.MutedBrush, wrap: true));
            if (!string.IsNullOrEmpty(v.Subtitle)) body.Children.Add(UiKit.Text(v.Subtitle, wrap: true));
            if (v.ModelMayBeModified)
                body.Children.Add(UiKit.Text("⚠ Загвар анхны төлөвт буцсаныг батлах боломжгүй — Revit-д Ctrl+Z-ээр шалгана уу.", brush: UiKit.BlockingBrush, bold: true, wrap: true));
            else if (!v.HasTarget || v.Phase == ExactPhase.None) body.Children.Add(UiKit.Text(DoorMoveView.ModelUnchanged, brush: UiKit.MutedBrush, wrap: true));
            if (v.ListsArePrevious && v.PreviousOffsetMm.HasValue)
                body.Children.Add(UiKit.Text("Доорх жагсаалт нь өмнөх байрлал (" + DoorMoveView.OffsetLabel(v.PreviousOffsetMm.Value) + ")-ын дүн — шинэ шалгалт үргэлжилж байна…", brush: UiKit.InfoBrush, wrap: true));

            foreach (TopImpactRow r in v.Top.Take(3))
            {
                var row = new DockPanel { Margin = new Thickness(0, 3, 0, 0) };
                if (r.CanShow && IsHostKey(r.TargetKey))
                {
                    TopImpactRow rr = r;
                    Button b = UiKit.Btn("Харуулах", (s, e) => OnShow(new PreChangeItem { Id = rr.Id, Kind = rr.Kind, Title = rr.Text }), 80);
                    DockPanel.SetDock(b, Dock.Right);
                    row.Children.Add(b);
                }
                row.Children.Add(UiKit.Text("• " + r.Text, wrap: true));
                body.Children.Add(row);
            }

            _result.Children.Add(new Border
            {
                BorderThickness = new Thickness(4, 1, 1, 1), BorderBrush = tone, Padding = new Thickness(10, 8, 8, 8), Margin = new Thickness(0, 2, 0, 6), Child = body,
            });
        }

        /// <summary>Линк загварын элементийн id нь host-ынхтай ДАВХЦАЖ болно — зөвхөн host-ын элементийг «Харуулах».</summary>
        private static bool IsHostKey(string key)
        {
            return string.IsNullOrEmpty(key) || key.StartsWith("0:", StringComparison.Ordinal);
        }

        private UIElement NormBox(DoorMoveView view)
        {
            var body = UiKit.Col(
                UiKit.Text(PreChangeDecisionEngine.NormAutoNotDone, bold: true, brush: UiKit.InfoBrush, wrap: true),
                UiKit.Text(PreChangeDecisionEngine.ModelOnlyNote, brush: UiKit.MutedBrush, wrap: true));
            return new Border
            {
                BorderThickness = new Thickness(1), BorderBrush = UiKit.InfoBrush, Padding = new Thickness(8, 5, 8, 5), Margin = new Thickness(0, 4, 0, 6), Child = body,
                ToolTip = "Ногоон дүгнэлт нь БНбД-ийн зөвшөөрөл БИШ — зөвхөн Revit моделийн нөлөөлөл.",
            };
        }

        private void RenderCounters(DoorMoveView v)
        {
            var wrap = new WrapPanel { Margin = new Thickness(0, 4, 0, 6) };
            foreach (ImpactCounter c in v.Counters)
            {
                ImpactCounter cc = c;
                Brush tone = c.Group == null ? UiKit.FgBrush : c.Count == 0 ? UiKit.MutedBrush
                    : c.Group == ImpactGroup.Critical ? UiKit.BlockingBrush : c.Group == ImpactGroup.Review ? UiKit.WarningBrush
                    : c.Group == ImpactGroup.Safe ? UiKit.OkBrush : c.Group == ImpactGroup.Changed ? UiKit.InfoBrush : UiKit.MutedBrush;
                var count = UiKit.Text(c.Count.ToString(), bold: true, brush: tone);
                count.FontSize = 18;
                var panel = UiKit.Col(UiKit.Text(c.Title, brush: UiKit.MutedBrush), count);
                panel.Width = 78;
                var border = new Border
                {
                    BorderThickness = new Thickness(c.Active ? 2 : 1), BorderBrush = c.Active ? tone : UiKit.LineBrush, Padding = new Thickness(6, 3, 6, 3), Margin = new Thickness(0, 0, 6, 6),
                    Cursor = Cursors.Hand, Child = panel, ToolTip = "Дарвал зөвхөн энэ бүлгийг Revit-ийн зураг дээр тодруулна.",
                };
                border.MouseLeftButtonUp += (s, e) => { if (_c != null) _c.SetFilter(cc.Active ? (ImpactGroup?)null : cc.Group); };
                wrap.Children.Add(border);
            }
            _result.Children.Add(wrap);
        }

        private void RenderGroups(DoorMoveView v)
        {
            IEnumerable<ImpactEntry> entries = v.Entries;
            if (v.Filter.HasValue) entries = entries.Where(e => e.Group == v.Filter.Value);
            var dim = v.ListsArePrevious ? 0.45 : 1.0;
            foreach (ImpactGroup g in new[] { ImpactGroup.Critical, ImpactGroup.Review, ImpactGroup.Changed, ImpactGroup.Safe, ImpactGroup.NotEvaluated })
            {
                List<ImpactEntry> list = entries.Where(e => e.Group == g).ToList();
                if (list.Count == 0) continue;
                var body = new StackPanel { Opacity = dim };
                foreach (ImpactEntry e in list.Take(MaxItemsPerGroup)) body.Children.Add(BuildRow(e));
                if (list.Count > MaxItemsPerGroup)
                    body.Children.Add(UiKit.Text("… бусад " + (list.Count - MaxItemsPerGroup) + " зүйл (жагсаалт товчлогдсон)", brush: UiKit.MutedBrush));
                bool open = g == ImpactGroup.Critical || g == ImpactGroup.Review;
                _result.Children.Add(new Expander
                {
                    Header = GroupMark(g) + " " + GroupTitle(g) + " (" + list.Count + ")", IsExpanded = open || v.Filter == g, Content = body,
                    Margin = new Thickness(0, 2, 0, 2), FontWeight = FontWeights.SemiBold,
                });
            }
        }

        private static string GroupMark(ImpactGroup g)
        {
            switch (g)
            {
                case ImpactGroup.Critical: return "🔴";
                case ImpactGroup.Review: return "🟠";
                case ImpactGroup.Changed: return "🟡";
                case ImpactGroup.Safe: return "🟢";
                default: return "⚪";
            }
        }

        private static string GroupTitle(ImpactGroup g)
        {
            switch (g)
            {
                case ImpactGroup.Critical: return "Ноцтой";
                case ImpactGroup.Review: return "Хянах";
                case ImpactGroup.Changed: return "Өөрчлөгдөнө";
                case ImpactGroup.Safe: return "Хэвийн";
                default: return "Тооцоолоогүй";
            }
        }

        private UIElement BuildRow(ImpactEntry e)
        {
            var grid = new Grid { Margin = new Thickness(4, 3, 4, 3) };
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            var lines = new List<UIElement> { UiKit.Text((e.Predictive ? "≈ " : "") + (e.Title ?? ""), bold: true, wrap: true) };
            if (!string.IsNullOrEmpty(e.Before) || !string.IsNullOrEmpty(e.After))
                lines.Add(UiKit.Text((e.Before ?? PreChangeText.Unknown) + "  →  " + (e.After ?? PreChangeText.Unknown) + (string.IsNullOrEmpty(e.Delta) ? "" : "   (" + e.Delta + ")"), wrap: true));
            if (!string.IsNullOrEmpty(e.Detail)) lines.Add(UiKit.Text(e.Detail, brush: UiKit.MutedBrush, wrap: true));
            var content = UiKit.Col(lines.ToArray());
            Grid.SetColumn(content, 0);
            grid.Children.Add(content);
            if (e.CanShow && IsHostKey(e.TargetKey))
            {
                ImpactEntry ee = e;
                Button b = UiKit.Btn("Харуулах", (s, ev) => OnShow(new PreChangeItem { Id = ee.Id, Kind = ee.Kind, Title = ee.Title, Category = ee.Category }), 80);
                b.VerticalAlignment = VerticalAlignment.Top;
                Grid.SetColumn(b, 1);
                grid.Children.Add(b);
            }
            return new Border { BorderThickness = new Thickness(0, 0, 0, 1), BorderBrush = UiKit.LineBrush, Child = grid };
        }

        private void RenderDocs(DoorMoveView v)
        {
            if (v.Docs == null || !v.Docs.HasContent) return;
            _result.Children.Add(UiKit.Text("Баримтжуулалтад нөлөөлөх: " + v.Docs.Line, wrap: true));
        }

        private void RenderClearance(DoorMoveView v)
        {
            DoorClearanceView c = v.Clearance;
            if (c == null) return;
            var body = new StackPanel { Margin = new Thickness(0, 4, 0, 2) };
            body.Children.Add(UiKit.Text("Хаалганы орчны зай", bold: true));
            if (c.Evaluated) body.Children.Add(UiKit.Text((c.Before ?? PreChangeText.Unknown) + " → " + (c.After ?? PreChangeText.Unknown) + (string.IsNullOrEmpty(c.Delta) ? "" : "   (" + c.Delta + ")"), wrap: true));
            body.Children.Add(UiKit.Text(c.Note ?? "", brush: UiKit.MutedBrush, wrap: true));
            _result.Children.Add(body);
        }

        /* ============================== ДООД (sticky) ====================== */

        private void RenderFooter(DoorMoveView v)
        {
            ApplyGateResult g = v != null ? v.Gate : new ApplyGateResult { PrimaryLabel = "Эхлээд хаалгаа сонгоно уу", Tone = ApplyTone.Gray };
            _primary.Content = g.PrimaryLabel;
            _primary.IsEnabled = g.PrimaryEnabled && !_applying && !_loading && !_picking;
            switch (g.Tone)
            {
                case ApplyTone.Green: _primary.Background = UiKit.OkBrush; _primary.Foreground = Brushes.White; break;
                case ApplyTone.Amber: _primary.Background = UiKit.WarningBrush; _primary.Foreground = Brushes.White; break;
                case ApplyTone.Red: _primary.Background = UiKit.BlockingBrush; _primary.Foreground = Brushes.White; break;
                default: _primary.ClearValue(Control.BackgroundProperty); _primary.ClearValue(Control.ForegroundProperty); break;
            }
            _gateHint.Text = g.Hint ?? "";
            _recheckBtn.Visibility = g.ShowRecheck ? Visibility.Visible : Visibility.Collapsed;
            if (g.RecheckLabel != null) _recheckBtn.Content = g.RecheckLabel;
            _recheckBtn.IsEnabled = !_applying;
        }

        /* ============================== ХАРУУЛАХ =========================== */

        private async void OnShow(PreChangeItem it)
        {
            if (it == null) return;
            string msg = null;
            try { SelectOutcome r = await _s.ShowAsync(it, CancellationToken.None); msg = r != null ? r.Message : null; }
            catch (Exception ex) { msg = "⛔ " + ex.Message; }
            UiThread.Run(Dispatcher, () => { if (msg != null && !_closed) _status.Text = msg; });
        }
    }
}
