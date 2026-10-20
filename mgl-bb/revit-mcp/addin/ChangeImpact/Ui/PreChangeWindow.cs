using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Threading;
using RevitMcpAddin.ChangeImpact.Core;
using RevitMcpAddin.Smart.Core;
using RevitMcpAddin.Smart.Ui;

namespace RevitMcpAddin.ChangeImpact.Ui
{
    /// <summary>
    /// «MGL — Өөрчлөхөөс өмнө шалгах» — модальгүй цонх.  Revit-ийн төрлийг мэдэхгүй (`IPreChangeSession`).  Бүх шийдвэр, текст, тоо `PreChangeView` (цэвэр)-ээс.
    ///
    /// 30 СЕКУНДЫН АЖЛЫН УРСГАЛ (архитектор):
    ///   1. Revit-д ханаа сонго.  Цонх нээгдэхэд сонгосон хана АВТОМАТААР орно (нэмж товших шаардлагагүй).
    ///   2. Зайн товч (100 / 200 / 300 / 500 / 1000) эсвэл өөрийн тоо.  Тал = өрөөний нэрээр, эсвэл «Зураг дээр тал сонгох».
    ///      → ХАНЫН СҮҮДЭР (ghost) Revit-д шууд харагдана; шинжилгээ автоматаар эхэлнэ.
    ///   3. ТҮР ДҮН (өрөө, хэмжээс, хаалга) хурдан гарч, ЭЦСИЙН ТЕХНИКИЙН ДҮГНЭЛТ (MEP, гарц, хүснэгт) дараа нь орно.
    ///   4. НЭГ ШИЙДВЭР: 🟢 ТЕХНИКИЙН ХУВЬД ЗӨӨЖ БОЛНО · 🟠 ХЯНААД ЗӨӨ · 🔴 ЗӨӨХГҮЙ · ⚪ ДҮГНЭХ БОЛОМЖГҮЙ — шалтгаан, тэргүүн 3 үр дагавар, 5 карт.
    ///   5. Доод талын НЭГ товч: «300 мм зөөх» / «Хянаад 300 мм зөөх».  🔴/⚪ үед идэвхгүй.
    ///
    /// ⚠️ Энэ нь МОДЕЛИЙН техникийн дүгнэлт.  «Монгол нормын автомат баталгаажуулалт хийгдээгүй.» мөр ТУСДАА, үргэлж харагдана — ногоон нь нормын зөвшөөрөл БИШ.
    /// ⚠️ Preview загварт ямар ч өөрчлөлт хийхгүй (түр транзакц БҮТНЭЭРЭЭ буцаагдана).  Зөвхөн зөөх товч дарсны дараа хана зөөгдөнө (нэг Undo).
    /// </summary>
    internal sealed class PreChangeWindow : Window
    {
        private const int MaxItemsPerGroup = 60;

        private readonly IPreChangeSession _s;
        private PreChangeSelection _sel;
        private PreChangeSelection _offered;
        private PreChangeReport _report;
        private PreChangeRequest _lastRequest;
        private CancellationTokenSource _cts;
        private int _seq;
        private bool _previewing, _applying, _picking, _selectionPollBusy;
        // Цонх хаагдсаны ДАРАА ирсэн async үр дүн сүүдэр/UI-г дахин «амилуулахгүй».
        private bool _closed;
        private string _declinedUid;
        // Revit-д сонгосон нь ДЭМЖИГДЭХГҮЙ/хүчингүй хана — ижил сонголтыг тик бүрд дахин бүтнээр нь шалгахгүй.
        private string _ignoredUid;
        private string _notice = "";
        private FreshnessState _renderedFreshness = FreshnessState.Unknown;
        private bool _showWhy;
        private readonly List<RadioButton> _sideButtons = new List<RadioButton>();
        private readonly List<ToggleButton> _chips = new List<ToggleButton>();

        // ---- хана + хөдөлгөөн
        private readonly TextBlock _wallInfo = UiKit.Text("", wrap: true);
        private readonly TextBlock _wallWarn = UiKit.Text("", brush: UiKit.WarningBrush, wrap: true);
        private readonly TextBlock _offer = UiKit.Text("", brush: UiKit.InfoBrush, wrap: true, bold: true);
        private readonly Button _offerBtn;
        private readonly Border _offerBox;
        private readonly Button _pickBtn, _sidePickBtn;
        private readonly WrapPanel _chipPanel = new WrapPanel();
        private readonly WrapPanel _sidePanel = new WrapPanel();
        private readonly TextBox _distance = UiKit.Box("", 70);
        private readonly TextBlock _distanceErr = UiKit.Text("", brush: UiKit.BlockingBrush, wrap: true);

        // ---- нарийвчилсан
        private readonly Expander _advanced = new Expander { Margin = new Thickness(0, 4, 0, 0), IsExpanded = false };
        private readonly TextBlock _exitInfo = UiKit.Text("", brush: UiKit.MutedBrush, wrap: true);
        private readonly TextBlock _diag = UiKit.Text("", brush: UiKit.MutedBrush, wrap: true);
        private readonly Button _exitsBtn, _exitsClearBtn;

        // ---- дүн
        private readonly StackPanel _result = new StackPanel { Margin = new Thickness(8, 4, 8, 4) };
        private readonly ProgressBar _bar = new ProgressBar { Height = 4, Minimum = 0, Maximum = 1, IsIndeterminate = true, Margin = new Thickness(2, 2, 2, 2), Visibility = Visibility.Collapsed };
        private readonly TextBlock _status = UiKit.Text("", brush: UiKit.MutedBrush, wrap: true);
        private readonly TextBlock _outcome = UiKit.Text("", bold: true, wrap: true);

        // ---- доод (sticky) мөр
        private readonly Button _primary, _whyBtn, _recheckBtn, _cancelBtn;
        private readonly TextBlock _gateHint = UiKit.Text("", brush: UiKit.MutedBrush, wrap: true);
        private readonly DispatcherTimer _timer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(2) };

        internal PreChangeWindow(IPreChangeSession session)
        {
            _s = session;
            Title = PreChangeText.WindowTitle + " · " + (session.DocumentTitle ?? "");
            Width = 560;
            Height = 820;
            MinWidth = 440;
            MinHeight = 560;
            ShowInTaskbar = false;
            Topmost = false;
            UiKit.Prepare(this, "pre-change-impact");

            _pickBtn = UiKit.Btn("Өөр хана сонгох", (s, e) => OnPickWall(), 120);
            _sidePickBtn = UiKit.Btn("Зураг дээр тал сонгох", (s, e) => OnPickSide(), 150);
            _exitsBtn = UiKit.Btn("Сонгосон хаалгыг гарц болгох", OnSetExits);
            _exitsClearBtn = UiKit.Btn("Гарц цэвэрлэх", OnClearExits);
            _offerBtn = UiKit.Btn("Үүнийг шалгах", (s, e) => OnAdoptOffer(), 110);
            _offerBox = new Border
            {
                BorderThickness = new Thickness(1), BorderBrush = UiKit.InfoBrush, Padding = new Thickness(6), Margin = new Thickness(0, 4, 0, 2), Visibility = Visibility.Collapsed,
                Child = UiKit.Wrap(_offer, _offerBtn),
            };

            _primary = UiKit.Btn("Эхлээд нөлөөллийг шалгана", (s, e) => OnPrimary(), 220);
            _primary.FontWeight = FontWeights.SemiBold;
            _primary.FontSize = 14;
            _primary.Padding = new Thickness(14, 8, 14, 8);
            _primary.IsEnabled = false;
            _whyBtn = UiKit.Btn("Яагаад?", (s, e) => { _showWhy = !_showWhy; Render(); }, 80);
            _recheckBtn = UiKit.Btn("Дахин шалгах", (s, e) => RunPreview(), 110);
            _cancelBtn = UiKit.Btn("Цуцлах", (s, e) => OnCancelPreview(), 80);
            _whyBtn.Visibility = _recheckBtn.Visibility = Visibility.Collapsed;
            _cancelBtn.IsEnabled = false;

            _distance.ToolTip = "Зөөх зай (мм).  Жишээ: 300, 300 мм, 0.3 м.  Enter дарахад шалгана.";
            _distance.KeyDown += (s, e) => { if (e.Key == Key.Enter) OnDistanceTyped(); };
            _distance.LostKeyboardFocus += (s, e) => OnDistanceTyped(onlyIfChanged: true);

            BuildChips();
            Content = BuildLayout();
            RefreshExits();
            Render();

            _timer.Tick += (s, e) => OnTick();
            Loaded += (s, e) => { AdoptCurrentSelection(true); _timer.Start(); };
            Closing += (s, e) => { if (_applying) e.Cancel = true; };
            Closed += (s, e) =>
            {
                _closed = true;
                _seq++;                              // нислэгт буй preview/apply-ийн үр дүн UI-г ч, сүүдрийг ч дахин өөрчлөхгүй
                _timer.Stop();
                try { if (_cts != null) _cts.Cancel(); } catch (Exception) { }
                ClearGhost();
            };
        }

        /* ============================== LAYOUT ============================= */

        private void BuildChips()
        {
            foreach (int mm in PreChangeWorkflow.ChipDistances)
            {
                int v = mm;
                var tb = new ToggleButton { Content = mm.ToString(System.Globalization.CultureInfo.InvariantCulture), MinWidth = 54, Padding = new Thickness(8, 5, 8, 5), Margin = new Thickness(2), Tag = v };
                tb.Click += (s, e) => { SetDistance(v); RunPreview(); };
                _chips.Add(tb);
                _chipPanel.Children.Add(tb);
            }
        }

        private UIElement BuildLayout()
        {
            var distRow = new WrapPanel { Margin = new Thickness(0, 2, 0, 0) };
            distRow.Children.Add(UiKit.Text("Зай (мм):", bold: true));
            foreach (UIElement c in _chipPanel.Children.Cast<UIElement>().ToList()) { _chipPanel.Children.Remove(c); distRow.Children.Add(c); }
            distRow.Children.Add(UiKit.Text("эсвэл"));
            distRow.Children.Add(_distance);

            var sideRow = new StackPanel();
            sideRow.Children.Add(UiKit.Text(PreChangeText.ChooseSide, bold: true));
            sideRow.Children.Add(_sidePanel);
            sideRow.Children.Add(_sidePickBtn);
            _sidePickBtn.HorizontalAlignment = HorizontalAlignment.Left;

            _advanced.Header = "Нарийвчилсан";
            _advanced.Content = UiKit.Col(
                UiKit.Text("Гарц (зам тооцох):", bold: true),
                UiKit.Wrap(_exitsBtn, _exitsClearBtn),
                _exitInfo,
                UiKit.Text("Оношилгоо:", bold: true),
                _diag);

            var head = UiKit.Col(_wallInfo, _wallWarn, UiKit.Wrap(_pickBtn), _offerBox, distRow, _distanceErr, sideRow, _advanced, _bar, _status);
            head.Margin = new Thickness(8, 6, 8, 2);

            var scroll = new ScrollViewer { VerticalScrollBarVisibility = ScrollBarVisibility.Auto, Content = UiKit.Col(_result, _outcome) };

            var foot = new StackPanel { Margin = new Thickness(8, 4, 8, 8) };
            _primary.HorizontalAlignment = HorizontalAlignment.Stretch;
            foot.Children.Add(_primary);
            foot.Children.Add(_gateHint);
            foot.Children.Add(UiKit.Wrap(_whyBtn, _recheckBtn, _cancelBtn));

            var root = new DockPanel();
            DockPanel.SetDock(head, Dock.Top);
            var footBorder = new Border { BorderThickness = new Thickness(0, 1, 0, 0), BorderBrush = UiKit.LineBrush, Child = foot };
            DockPanel.SetDock(footBorder, Dock.Bottom);
            root.Children.Add(head);
            root.Children.Add(footBorder);
            root.Children.Add(scroll);
            return root;
        }

        /* ============================== ХАНА (автомат сонголт) ============== */

        private async void AdoptCurrentSelection(bool silentIfNone)
        {
            string error = null;
            PreChangeSelection sel = null;
            try { sel = await _s.GetSelectionAsync(CancellationToken.None); }
            catch (Exception ex) { error = ex.Message; }
            UiThread.Run(Dispatcher, () =>
            {
                if (error != null) { _status.Text = "⛔ " + error; return; }
                if (sel == null) return;
                if (!sel.Valid && silentIfNone && string.IsNullOrEmpty(sel.Problem))
                {
                    _wallInfo.Text = "Revit-д ханаа сонгоно уу — цонх автоматаар авна.  Эсвэл «Өөр хана сонгох».";
                    return;
                }
                ApplySelection(sel);
            });
        }

        private async void OnPickWall()
        {
            if (_applying || _picking) return;
            _picking = true;
            _status.Text = "Revit-д ханаа сонгоно уу…";
            string error = null;
            PreChangeSelection sel = null;
            try { sel = await _s.PickWallAsync(CancellationToken.None); }
            catch (OperationCanceledException) { }
            catch (Exception ex) { error = ex.Message; }
            UiThread.Run(Dispatcher, () =>
            {
                _picking = false;
                _status.Text = "";
                if (error != null) { _status.Text = "⛔ " + error; return; }
                if (sel != null && (sel.Valid || !string.IsNullOrEmpty(sel.Problem))) { _declinedUid = null; ApplySelection(sel); }
            });
        }

        private void ApplySelection(PreChangeSelection sel)
        {
            // Хана өөрчлөгдөхөд өмнөх preview, сүүдэр хүчингүй.
            CancelRunning();
            _report = null;
            _lastRequest = null;
            _offered = null;
            _offerBox.Visibility = Visibility.Collapsed;
            _notice = "";
            _outcome.Text = "";
            ClearGhost();

            _sel = sel;
            _sidePanel.Children.Clear();
            _sideButtons.Clear();
            _wallWarn.Text = "";
            _distanceErr.Text = "";
            if (!sel.Valid)
            {
                _wallInfo.Text = string.IsNullOrEmpty(sel.Problem) ? "Хана сонгоогүй." : "⛔ " + sel.Problem;
                Render();
                return;
            }

            // Workshare: хэн ч эзэмшээгүй хана — preview түр эзэмшил үүсгэж болзошгүй.  ЭХЛЭХЭЭС ӨМНӨ асууна, чимээгүй авахгүй.
            if (sel.NeedsCheckoutAck && !_s.OwnershipAcknowledged(sel))
            {
                bool yes = MessageBox.Show(this, PreChangeText.OwnershipAck, Title, MessageBoxButton.YesNo, MessageBoxImage.Question) == MessageBoxResult.Yes;
                if (!yes)
                {
                    _declinedUid = sel.SourceUid;
                    _wallInfo.Text = "Шалгалтыг эхлүүлээгүй — ханын эзэмшлийн сэрэмжлүүлгийг зөвшөөрөөгүй.  «Өөр хана сонгох» эсвэл Revit-д дахин сонгоно уу.";
                    _sel = null;
                    Render();
                    return;
                }
                _declinedUid = null;
                _s.AcknowledgeOwnership(sel);
            }

            _wallInfo.Text = "Хана: " + sel.Label + (string.IsNullOrEmpty(sel.LevelName) ? "" : " · " + sel.LevelName)
                + " · урт " + PreChangeText.Mm(sel.LengthMm) + " · зузаан " + PreChangeText.Mm(sel.ThicknessMm)
                + (sel.HostedCount > 0 ? " · хаалга/цонх " + sel.HostedCount : "");
            _wallWarn.Text = string.Join("\n", sel.Warnings.Select(w => "⚠ " + w));
            foreach (WallSideInfo side in sel.Sides)
            {
                var rb = new RadioButton
                {
                    Content = side.Label, GroupName = "side", Margin = new Thickness(2, 3, 10, 3), Padding = new Thickness(6, 3, 6, 3),
                    IsChecked = side.Index == 0, Tag = side,
                };
                rb.Click += (s, e) => { if (HasDistance()) RunPreview(); };
                _sideButtons.Add(rb);
                _sidePanel.Children.Add(rb);
            }
            Render();
        }

        /* ============================== ЗАЙ / ТАЛ =========================== */

        private bool HasDistance()
        {
            return PreChangeRequestRules.ParseDistanceMm(_distance.Text).HasValue;
        }

        private void SetDistance(double mm)
        {
            _distance.Text = mm.ToString("0.##", System.Globalization.CultureInfo.InvariantCulture);
            SyncChips();
        }

        private void SyncChips()
        {
            int idx = PreChangeWorkflow.ChipIndexOf(PreChangeRequestRules.ParseDistanceMm(_distance.Text));
            for (int i = 0; i < _chips.Count; i++) _chips[i].IsChecked = i == idx;
        }

        private string _lastTypedDistance = "";

        private void OnDistanceTyped(bool onlyIfChanged = false)
        {
            string t = (_distance.Text ?? "").Trim();
            if (onlyIfChanged && string.Equals(t, _lastTypedDistance, StringComparison.Ordinal)) return;
            _lastTypedDistance = t;
            if (t.Length == 0) { SyncChips(); return; }
            double? mm = PreChangeRequestRules.ParseDistanceMm(t);
            if (!mm.HasValue) { _distanceErr.Text = "Зайг мм-ээр, 0-ээс их тоогоор бичнэ үү (жишээ: 300)."; return; }
            SyncChips();
            RunPreview();
        }

        private async void OnPickSide()
        {
            if (_sel == null || !_sel.Valid || _applying || _picking) return;
            _picking = true;
            _status.Text = "Зураг дээр аль тал руу зөөхөө дарна уу…";
            string error = null;
            SidePickResult r = null;
            try { r = await _s.PickSideAsync(_sel, CancellationToken.None); }
            catch (Exception ex) { error = ex.Message; }
            UiThread.Run(Dispatcher, () =>
            {
                _picking = false;
                _status.Text = "";
                if (error != null) { _status.Text = "⛔ " + error; return; }
                if (r == null || r.Cancelled) return;
                if (r.SideIndex < 0) { _distanceErr.Text = r.Message ?? "Тал тодорхойгүй."; return; }
                RadioButton rb = _sideButtons.FirstOrDefault(b => ((WallSideInfo)b.Tag).Index == r.SideIndex);
                if (rb == null) return;
                rb.IsChecked = true;
                _distanceErr.Text = "";
                if (HasDistance()) RunPreview();
            });
        }

        private PreChangeRequest BuildRequest()
        {
            _distanceErr.Text = "";
            if (_sel == null || !_sel.Valid) { _distanceErr.Text = "Эхлээд Revit-д ханаа сонгоно уу."; return null; }
            double? mm = PreChangeRequestRules.ParseDistanceMm(_distance.Text);
            if (!mm.HasValue) { _distanceErr.Text = "Зайг сонгоно уу (товч) эсвэл мм-ээр бичнэ үү."; return null; }
            RadioButton rb = _sideButtons.FirstOrDefault(b => b.IsChecked == true);
            if (rb == null) { _distanceErr.Text = "Хананы талыг сонгоно уу."; return null; }
            var side = (WallSideInfo)rb.Tag;
            var req = new PreChangeRequest
            {
                SourceId = _sel.SourceId, SourceUid = _sel.SourceUid, SourceLabel = _sel.Label,
                DistanceMm = mm.Value, DirX = side.DirX, DirY = side.DirY, SideLabel = side.Label, SideIndex = side.Index,
            };
            string bad = PreChangeRequestRules.Validate(req);
            if (bad != null) { _distanceErr.Text = bad; return null; }
            return req;
        }

        /* ============================== СҮҮДЭР ============================== */

        private void UpdateGhost(ApplyTone tone, PreChangeRequest req)
        {
            if (_closed || _sel == null || !_sel.Valid || req == null) return;
            try
            {
                Task t = _s.SetGhostAsync(new PreChangeGhostRequest { WallId = _sel.SourceId, VectorMm = req.VectorMm, Tone = tone }, CancellationToken.None);
                t.ContinueWith(x => { var _ = x.Exception; }, TaskContinuationOptions.OnlyOnFaulted);
            }
            catch (Exception) { /* сүүдэр нь зөвхөн харагдац */ }
        }

        private void ClearGhost()
        {
            try
            {
                Task t = _s.ClearGhostAsync();
                if (t != null) t.ContinueWith(x => { var _ = x.Exception; }, TaskContinuationOptions.OnlyOnFaulted);
            }
            catch (Exception) { }
        }

        /* ============================== PREVIEW ============================= */

        private void CancelRunning()
        {
            try { if (_cts != null) _cts.Cancel(); } catch (Exception) { }
            _seq++;
            _previewing = false;
        }

        /// <summary>Шинжилгээг (дахин) эхлүүлнэ.  Явж байгаа нь цуцлагдаж, ШИНЭ параметрээр эхэлнэ.  Үр дүн: түр дүн → эцсийн дүгнэлт.</summary>
        private async void RunPreview()
        {
            if (_applying || _closed) return;
            PreChangeRequest req = BuildRequest();
            if (req == null) return;

            try { if (_cts != null) _cts.Cancel(); } catch (Exception) { }
            var cts = new CancellationTokenSource();
            _cts = cts;
            int seq = ++_seq;
            _previewing = true;
            _lastRequest = req;
            _report = null;                  // өмнөх (өөр параметрийн) дүн шинэ параметртэй холилдохгүй
            _outcome.Text = "";
            _status.Text = "Хамаарлыг бэлдэж байна…";
            Render();
            UpdateGhost(ApplyTone.Gray, req);

            IProgress<JobProgress> progress = UiThread.Progress<JobProgress>(Dispatcher, p =>
            {
                if (seq != _seq) return;
                _status.Text = (p.Message ?? "") + (p.Total > 0 ? " " + p.Done + "/" + p.Total : "");
            });
            Action<PreChangeReport> provisional = rep =>
            {
                // Revit-ийн thread-ээс — Execute дуустал саатуулж, дараа нь л UI-г шинэчилнэ.
                Dispatcher.BeginInvoke(new Action(() =>
                {
                    // Эцсийн дүн ирсний ДАРАА (эсвэл цуцлагдсаны/хаагдсаны дараа) ирсэн түр дүн эцсийн дүнг дарахгүй.
                    if (seq != _seq || rep == null || !_previewing || _closed) return;
                    _report = rep;
                    Render();
                }));
            };

            PreChangeReport final = null;
            string error = null;
            bool cancelled = false;
            try { final = await _s.PreviewAsync(req, progress, provisional, cts.Token); }
            catch (OperationCanceledException) { cancelled = true; }
            catch (Exception ex) { error = ex.Message; }

            UiThread.Run(Dispatcher, () =>
            {
                if (seq != _seq) return;             // шинэ шинжилгээ UI-г эзэмшинэ
                _previewing = false;
                if (final != null)
                {
                    _report = final;
                    _status.Text = "";
                    Render();
                    PreChangeView v = PreChangeView.Build(final, _s.CheckFreshness(final), false);
                    UpdateGhost(PreChangeWorkflow.ToneFor(v.Decision), req);
                }
                else
                {
                    _report = null;
                    _status.Text = cancelled ? "Зогсоосон — загварт өөрчлөлт хийгдээгүй." : "⛔ " + error + "  (Загварт өөрчлөлт хийгдээгүй.)";
                    Render();
                    if (!cancelled) ClearGhost();
                }
            });
        }

        private void OnCancelPreview()
        {
            CancelRunning();
            _report = null;
            _notice = "";
            _outcome.Text = PreChangeText.Cancelled;
            _outcome.Foreground = UiKit.MutedBrush;
            _status.Text = "";
            foreach (ToggleButton c in _chips) c.IsChecked = false;
            ClearGhost();
            Render();
        }

        /* ============================== APPLY =============================== */

        private async void OnPrimary()
        {
            if (_applying || _previewing || _report == null) return;
            PreChangeView view = PreChangeView.Build(_report, _s.CheckFreshness(_report), false);
            if (!view.Gate.PrimaryEnabled) return;
            PreChangeRequest current = BuildRequest();
            if (current == null) return;

            // 🟠: хянах зүйлийг нэг удаа дахин харуулж, мэдсээр зөөлгөнө.
            if (view.Decision.Verdict == MoveVerdict.MoveWithReview)
            {
                string reasons = string.Join("\n• ", view.Decision.Top.Select(t => t.Text));
                if (MessageBox.Show(this, "Хянах зүйл:\n• " + reasons + "\n\nҮүнийг хараад ханыг зөөх үү?", Title, MessageBoxButton.YesNo, MessageBoxImage.Warning) != MessageBoxResult.Yes) return;
            }

            _applying = true;
            _notice = "";
            _outcome.Text = "";
            _status.Text = "Хөдөлгөөнийг хэрэгжүүлж, preview-тэй тулгаж байна…";
            Render();
            IProgress<JobProgress> progress = UiThread.Progress<JobProgress>(Dispatcher, p => { _status.Text = p.Message ?? ""; });
            ApplyOutcome outcome = null;
            string error = null;
            PreChangeReport applied = _report;
            try { outcome = await _s.ApplyAsync(applied, current, progress, CancellationToken.None); }
            catch (Exception ex) { error = ex.Message; }

            UiThread.Run(Dispatcher, () =>
            {
                _applying = false;
                _status.Text = "";
                if (error != null)
                {
                    _outcome.Text = "⛔ " + error + " Загварт өөрчлөлт орсон эсэхийг Revit-д шалгана уу.";
                    _outcome.Foreground = UiKit.BlockingBrush;
                    Render();
                    return;
                }

                if (outcome.Status == ApplyStatus.Stale)
                {
                    // Хуучирсан preview: ЗӨӨГӨӨГҮЙ.  Автоматаар дахин шалгана; шинэ дүнг хараад хэрэглэгч ДАХИН дарна (хоёр дахь товшилт заавал).
                    _notice = PreChangeText.StaleRefreshed;
                    RunPreview();
                    return;
                }

                _outcome.Text = outcome.Message + (outcome.Details.Count > 0 ? "\n• " + string.Join("\n• ", outcome.Details) : "");
                _outcome.Foreground = outcome.Status == ApplyStatus.AppliedVerified ? UiKit.OkBrush : outcome.Moved ? UiKit.WarningBrush : UiKit.BlockingBrush;
                if (outcome.Moved || outcome.Status == ApplyStatus.RolledBackMismatch || outcome.Status == ApplyStatus.Failed)
                {
                    _report = null;
                    foreach (ToggleButton c in _chips) c.IsChecked = false;
                    _distance.Text = "";
                    _lastTypedDistance = "";
                    ClearGhost();
                }
                Render();
            });
        }

        /* ============================== ГАРЦ ================================ */

        private async void OnSetExits(object sender, RoutedEventArgs e)
        {
            ExitConfigResult r = null;
            string error = null;
            try { r = await _s.SetExitsFromSelectionAsync(CancellationToken.None); }
            catch (Exception ex) { error = ex.Message; }
            UiThread.Run(Dispatcher, () =>
            {
                _status.Text = error != null ? "⛔ " + error : r.Message;
                RefreshExits();
                // Гарцын тохиргоо өөрчлөгдсөн — өмнөх дүн хуучирсан (Apply-ийн хурууны хээ бас барина).
                if (_report != null && r != null && r.Ok) { _notice = "Гарцын тохиргоо өөрчлөгдсөн — «Дахин шалгах» дарна уу."; Render(); }
            });
        }

        private async void OnClearExits(object sender, RoutedEventArgs e)
        {
            ExitConfigResult r = null;
            string error = null;
            try { r = await _s.ClearExitsAsync(CancellationToken.None); }
            catch (Exception ex) { error = ex.Message; }
            UiThread.Run(Dispatcher, () =>
            {
                _status.Text = error != null ? "⛔ " + error : r.Message;
                RefreshExits();
                if (_report != null && r != null && r.Ok) { _notice = "Гарцын тохиргоо өөрчлөгдсөн — «Дахин шалгах» дарна уу."; Render(); }
            });
        }

        private void RefreshExits()
        {
            IReadOnlyList<ExitInfo> exits = _s.Exits();
            _exitInfo.Text = exits.Count == 0
                ? "тохируулаагүй — гарцын зам тооцогдохгүй (энэ нь алдаа биш; хаалганы нэрээр таамаглахгүй)"
                : exits.Count + " хаалга: " + string.Join(", ", exits.Take(3).Select(x => x.Name ?? ("#" + x.Id))) + (exits.Count > 3 ? " …" : "");
        }

        /* ============================== ТАЙМЕР (шинэлэг + сонголт) ========== */

        private void OnTick()
        {
            if (_applying || _closed) return;
            if (_report != null && !_previewing)
            {
                FreshnessState f = SafeFreshness(_report);
                if (f != _renderedFreshness) Render();
            }
            PollSelection();
        }

        private FreshnessState SafeFreshness(PreChangeReport r)
        {
            try { return _s.CheckFreshness(r); }
            catch (Exception) { return FreshnessState.Unknown; }
        }

        /// <summary>Revit-д ӨӨР хана сонгогдсон бол санал болгоно (preview-ийг чимээгүй алдуулахгүй).  Дүн байхгүй бол автоматаар авна.</summary>
        private async void PollSelection()
        {
            if (_selectionPollBusy || _previewing || _applying || _picking) return;
            _selectionPollBusy = true;
            PreChangeSelection next = null;
            try
            {
                // Хялбар шалгалт: сонголт ӨӨРЧЛӨГДӨӨГҮЙ бол бүтэн (өрөө, хост, эзэмшил уншдаг) шалгалт хийхгүй.
                string uid = await _s.PeekSelectedWallAsync(CancellationToken.None);
                // Хэрэглэгч сонголтоо арилгасан/өөр хана сонгосон бол «татгалзсан»/«үл хэрэгсэх» тэмдэг хүчингүй: ижил ханыг дахин сонговол дахин асууна.
                if (uid == null || (_declinedUid != null && !string.Equals(uid, _declinedUid, StringComparison.Ordinal))) _declinedUid = null;
                if (uid == null || (_ignoredUid != null && !string.Equals(uid, _ignoredUid, StringComparison.Ordinal))) _ignoredUid = null;
                bool same = uid == null || (_sel != null && _sel.Valid && string.Equals(uid, _sel.SourceUid, StringComparison.Ordinal))
                    || (_offered != null && string.Equals(uid, _offered.SourceUid, StringComparison.Ordinal))
                    || (_declinedUid != null && string.Equals(uid, _declinedUid, StringComparison.Ordinal))
                    || (_ignoredUid != null && string.Equals(uid, _ignoredUid, StringComparison.Ordinal));
                if (!same)
                {
                    next = await _s.GetSelectionAsync(CancellationToken.None);
                    if (next != null && !next.Valid) _ignoredUid = uid;      // хүчингүй сонголтыг тик бүрд дахин бүтнээр нь шалгахгүй
                }
            }
            catch (Exception) { }
            UiThread.Run(Dispatcher, () =>
            {
                _selectionPollBusy = false;
                if (_closed || next == null || _applying || _previewing) return;
                if (!PreChangeWorkflow.SelectionChanged(_sel, next)) return;
                if (_declinedUid != null && string.Equals(_declinedUid, next.SourceUid, StringComparison.Ordinal)) return;
                if (_report == null && !_previewing) { ApplySelection(next); return; }
                _offered = next;
                _offer.Text = PreChangeText.SelectionOffer + " " + (next.Label ?? "");
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

        /* ============================== ДҮН ================================= */

        private void Render()
        {
            _result.Children.Clear();
            bool busy = _previewing || _applying;
            FreshnessState fresh = _report == null ? FreshnessState.Unknown : SafeFreshness(_report);
            _renderedFreshness = fresh;
            PreChangeView view = PreChangeView.Build(_report, fresh, busy);

            _bar.Visibility = busy || (_report != null && !view.Decision.IsFinal) ? Visibility.Visible : Visibility.Collapsed;
            _cancelBtn.IsEnabled = !_applying && (_report != null || _previewing);
            _pickBtn.IsEnabled = !_applying;
            _sidePickBtn.IsEnabled = !_applying && _sel != null && _sel.Valid;
            _distance.IsEnabled = !_applying;
            foreach (ToggleButton c in _chips) c.IsEnabled = !_applying && _sel != null && _sel.Valid;
            foreach (RadioButton rb in _sideButtons) rb.IsEnabled = !_applying;
            _advanced.Header = "Нарийвчилсан" + (_report != null ? "  ·  " + PreChangeWorkflow.StatusLine(view.Decision) : "");

            if (!string.IsNullOrEmpty(_notice))
                _result.Children.Add(Banner("ℹ " + _notice, UiKit.InfoBrush));

            if (_report == null)
            {
                RenderEmpty();
                RenderFooter(view);
                RenderDiagnostics(null);
                return;
            }

            if (fresh != FreshnessState.Fresh && view.Decision.IsFinal && !busy)
                _result.Children.Add(Banner("⚠ " + (fresh == FreshnessState.Stale ? PreChangeText.StalePreview : PreChangeFreshness.UnknownNotice), UiKit.WarningBrush));

            RenderDecision(view);
            RenderNorm(view);
            if (_showWhy) RenderWhy(view);
            RenderConsequences(view);
            RenderCards(view);
            RenderArea(view);
            RenderMep(view);
            RenderEgress(view);
            RenderDetails(view);
            RenderFooter(view);
            RenderDiagnostics(view);
        }

        private void RenderEmpty()
        {
            string t;
            if (_previewing) t = "Шалгаж байна… (загварт өөрчлөлт хийхгүй)";
            else if (_sel == null || !_sel.Valid) t = "1. Revit-д ханаа сонгоно уу.";
            else t = "2. Зайн товчийг дарна уу (эсвэл мм-ээр бичээд Enter). Хананы сүүдэр Revit-д харагдана.";
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

        private static Brush VerdictBrush(MoveDecision d)
        {
            if (d.IsPending) return UiKit.MutedBrush;
            switch (d.Verdict)
            {
                case MoveVerdict.MoveOk: return UiKit.OkBrush;
                case MoveVerdict.MoveWithReview: return UiKit.WarningBrush;
                case MoveVerdict.DoNotMove: return UiKit.BlockingBrush;
                default: return UiKit.MutedBrush;
            }
        }

        private void RenderDecision(PreChangeView view)
        {
            MoveDecision d = view.Decision;
            Brush tone = VerdictBrush(d);
            var title = UiKit.Text(d.Mark + " " + d.Title, bold: true, brush: tone, wrap: true);
            title.FontSize = 20;
            var stage = UiKit.Text(view.StageLabel + (d.IsPending ? " — гүн шалгалт (MEP, гарц, хүснэгт) үргэлжилж байна…" : ""), brush: UiKit.MutedBrush, wrap: true);
            var body = UiKit.Col(title, stage);
            if (!string.IsNullOrEmpty(d.Subtitle)) body.Children.Add(UiKit.Text(d.Subtitle, wrap: true));
            if (d.ModelMayBeModified)
                body.Children.Add(UiKit.Text("⚠ Загвар анхны төлөвт буцсаныг батлах боломжгүй — Revit-д Ctrl+Z-ээр шалгана уу.", brush: UiKit.BlockingBrush, bold: true, wrap: true));

            // Яагаад — шалтгаан (🟢-д алга).  Тэргүүн нь том, нийт ≤3.
            foreach (DecisionReason r in d.Top.Take(3))
                body.Children.Add(ReasonRow(r, tone));

            _result.Children.Add(new Border
            {
                BorderThickness = new Thickness(4, 1, 1, 1), BorderBrush = tone, Padding = new Thickness(10, 8, 8, 8), Margin = new Thickness(0, 2, 0, 6), Child = body,
            });
        }

        private UIElement ReasonRow(DecisionReason r, Brush tone)
        {
            var row = new DockPanel { Margin = new Thickness(0, 3, 0, 0) };
            if (r.Id > 0 && r.Kind != ImpactNodeKind.Global)
            {
                PreChangeItem it = FindItem(r.ItemKey, r.Id, r.Kind, r.Text);
                Button b = UiKit.Btn("Харуулах", (s, e) => OnShow(it), 80);
                DockPanel.SetDock(b, Dock.Right);
                row.Children.Add(b);
            }
            row.Children.Add(UiKit.Text("• " + r.Text, wrap: true));
            return row;
        }

        /// <summary>Монгол нормын автомат баталгаажуулалт — МОДЕЛИЙН дүгнэлтээс ТУСДАА, үргэлж харагдана.</summary>
        private UIElement NormBox(PreChangeView view)
        {
            var body = UiKit.Col(
                UiKit.Text(PreChangeDecisionEngine.NormAutoNotDone, bold: true, brush: UiKit.InfoBrush, wrap: true),
                UiKit.Text(PreChangeDecisionEngine.ModelOnlyNote, brush: UiKit.MutedBrush, wrap: true));
            return new Border
            {
                BorderThickness = new Thickness(1), BorderBrush = UiKit.InfoBrush, Padding = new Thickness(8, 5, 8, 5), Margin = new Thickness(0, 0, 0, 6), Child = body,
                ToolTip = "Ногоон дүгнэлт нь БНбД-ийн зөвшөөрөл БИШ — зөвхөн Revit моделийн нөлөөлөл.",
            };
        }

        private void RenderNorm(PreChangeView view) { _result.Children.Add(NormBox(view)); }

        private void RenderWhy(PreChangeView view)
        {
            if (view.Why.Count == 0) { _result.Children.Add(UiKit.Text("Зөөхөд саад болох зүйл алга.", brush: UiKit.MutedBrush)); return; }
            var body = new StackPanel();
            body.Children.Add(UiKit.Text("Яагаад?", bold: true));
            foreach (DecisionReason r in view.Why.Take(30)) body.Children.Add(ReasonRow(r, UiKit.FgBrush));
            _result.Children.Add(new Border { BorderThickness = new Thickness(1), BorderBrush = UiKit.LineBrush, Padding = new Thickness(8), Margin = new Thickness(0, 0, 0, 6), Child = body });
        }

        private void RenderConsequences(PreChangeView view)
        {
            if (view.Top.Count == 0) return;
            _result.Children.Add(UiKit.Text("Юу өөрчлөгдөнө", bold: true));
            foreach (ConsequenceRow row in view.Top)
            {
                var grid = new Grid { Margin = new Thickness(0, 3, 0, 3) };
                grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
                grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
                string change = row.Before != null || row.After != null
                    ? (row.Before ?? PreChangeText.Unknown) + " → " + (row.After ?? PreChangeText.Unknown) + (string.IsNullOrEmpty(row.Delta) ? "" : "   " + row.Delta)
                    : (row.After ?? row.Detail ?? "");
                var text = UiKit.Col(UiKit.Text(PreChangeText.SeverityMark(row.Tone) + " " + row.Label, bold: true, wrap: true), UiKit.Text(change, wrap: true));
                Grid.SetColumn(text, 0);
                grid.Children.Add(text);
                if (row.CanShow)
                {
                    PreChangeItem it = FindItem(row.ItemKey, row.Id, row.Kind, row.Label);
                    Button b = UiKit.Btn("Харуулах", (s, e) => OnShow(it), 80);
                    b.VerticalAlignment = VerticalAlignment.Top;
                    Grid.SetColumn(b, 1);
                    grid.Children.Add(b);
                }
                _result.Children.Add(new Border { BorderThickness = new Thickness(0, 0, 0, 1), BorderBrush = UiKit.LineBrush, Child = grid });
            }
        }

        private void RenderCards(PreChangeView view)
        {
            if (view.Cards.Count == 0) return;
            var wrap = new WrapPanel { Margin = new Thickness(0, 8, 0, 6) };
            foreach (SummaryCard c in view.Cards) wrap.Children.Add(BuildCard(view, c));
            _result.Children.Add(wrap);
        }

        private UIElement BuildCard(PreChangeView view, SummaryCard c)
        {
            Brush tone = c.Truth == TruthState.NotEvaluated || c.Truth == TruthState.Incomplete ? UiKit.MutedBrush : ToneBrush(c.Tone);
            var value = UiKit.Text(c.Value ?? PreChangeText.Unknown, bold: true, brush: tone);
            value.FontSize = 17;
            var panel = UiKit.Col(UiKit.Text(c.Title, brush: UiKit.MutedBrush), value, UiKit.Text(c.Detail ?? "", brush: UiKit.MutedBrush, wrap: true));
            panel.Width = 118;
            PreChangeItem target = ItemForCard(view.Report, c.Key);
            var border = new Border
            {
                BorderThickness = new Thickness(1), BorderBrush = UiKit.LineBrush, Padding = new Thickness(8, 4, 8, 4), Margin = new Thickness(0, 0, 6, 6), Child = panel,
                ToolTip = Truth.Label(c.Truth) + (target != null ? " · дарвал Revit-д харуулна" : ""),
            };
            if (target != null)
            {
                border.Cursor = Cursors.Hand;
                border.MouseLeftButtonUp += (s, e) => OnShow(target);
            }
            return border;
        }

        private static PreChangeItem ItemForCard(PreChangeReport r, string key)
        {
            if (r == null) return null;
            Func<PreChangeCategory, PreChangeItem> pick = cat =>
                r.Items.Where(i => i.Category == cat && i.CanShow)
                    .OrderByDescending(i => i.Severity).ThenByDescending(i => i.Truth == TruthState.Confirmed).FirstOrDefault();
            switch (key)
            {
                case PreChangeSummary.Rooms: return pick(PreChangeCategory.Room);
                case PreChangeSummary.Dimensions: return pick(PreChangeCategory.Dimension);
                case PreChangeSummary.Mep: return pick(PreChangeCategory.Clash);
                case PreChangeSummary.Egress: return pick(PreChangeCategory.Egress);
                case PreChangeSummary.Sheets: return pick(PreChangeCategory.Sheet) ?? pick(PreChangeCategory.View);
                default: return null;
            }
        }

        private void RenderArea(PreChangeView view)
        {
            PreChangeAreaSummary a = view.Area;
            if (a == null || !a.HasContent) return;
            _result.Children.Add(UiKit.Text(a.Title, bold: true));
            foreach (AreaRow row in a.Rows.Take(12))
            {
                var line = UiKit.Text(row.Label + "   " + PreChangeText.M2(row.BeforeM2) + " → " + PreChangeText.M2(row.AfterM2) + "   " + PreChangeText.DeltaM2(row.DeltaM2),
                    brush: row.DeltaM2 < 0 ? UiKit.WarningBrush : UiKit.FgBrush, wrap: true);
                line.Margin = new Thickness(0, 2, 0, 2);
                if (row.RoomId > 0)
                {
                    RoomHit(line, row.RoomId, row.Label);
                }
                _result.Children.Add(line);
            }
            if (a.Rows.Count > 12) _result.Children.Add(UiKit.Text("… бусад " + (a.Rows.Count - 12) + " өрөө", brush: UiKit.MutedBrush));
            if (!string.IsNullOrEmpty(a.TotalText)) _result.Children.Add(UiKit.Text(a.TotalText, brush: UiKit.MutedBrush, wrap: true));
        }

        private void RoomHit(UIElement el, long roomId, string label)
        {
            el.MouseLeftButtonUp += (s, e) => OnShow(new PreChangeItem { Id = roomId, Kind = ImpactNodeKind.Room, Title = label, Category = PreChangeCategory.Room });
            if (el is FrameworkElement fe) { fe.Cursor = Cursors.Hand; fe.ToolTip = "Дарвал Revit-д харуулна"; }
        }

        private void RenderMep(PreChangeView view)
        {
            if (view.MepNew.Count == 0 && view.MepExisting.Count == 0) return;
            _result.Children.Add(UiKit.Text("MEP", bold: true));
            foreach (MepClashLine l in view.MepNew.Concat(view.MepExisting))
            {
                var head = UiKit.Text((l.IsNew ? "🔴 " : "· ") + l.Headline, bold: true, brush: l.IsNew ? UiKit.BlockingBrush : UiKit.MutedBrush, wrap: true);
                var body = UiKit.Col(head, UiKit.Text(l.Wall + " ↔ " + l.Other + (string.IsNullOrEmpty(l.Link) ? "" : "  (линк: " + l.Link + ")"), wrap: true));
                if (!string.IsNullOrEmpty(l.Metric)) body.Children.Add(UiKit.Text(l.Metric, brush: UiKit.MutedBrush));
                var dock = new DockPanel { Margin = new Thickness(0, 3, 0, 3) };
                if (l.Id > 0)
                {
                    PreChangeItem it = FindItem(l.ItemKey, l.Id, ImpactNodeKind.Element, l.Other);
                    Button b = UiKit.Btn("Revit дээр харуулах", (s, e) => OnShow(it), 130);
                    DockPanel.SetDock(b, Dock.Right);
                    dock.Children.Add(b);
                }
                dock.Children.Add(body);
                _result.Children.Add(new Border { BorderThickness = new Thickness(0, 0, 0, 1), BorderBrush = UiKit.LineBrush, Child = dock });
            }
        }

        private void RenderEgress(PreChangeView view)
        {
            if (view.Egress.Count == 0) return;
            _result.Children.Add(UiKit.Text("Гарц", bold: true));
            foreach (EgressLine l in view.Egress)
            {
                string line = l.Lost ? "🔴 " + l.Headline + " · " + l.Room : l.Room + "   " + (l.Before ?? PreChangeText.Unknown) + " → " + (l.After ?? PreChangeText.Unknown) + (string.IsNullOrEmpty(l.Delta) ? "" : "   " + l.Delta);
                var t = UiKit.Text(line, bold: l.Lost, brush: l.Lost ? UiKit.BlockingBrush : UiKit.FgBrush, wrap: true);
                t.Margin = new Thickness(0, 2, 0, 2);
                if (l.Id > 0) RoomHit(t, l.Id, l.Room);
                _result.Children.Add(t);
            }
            if (!string.IsNullOrEmpty(view.EgressNote)) _result.Children.Add(UiKit.Text(view.EgressNote, brush: UiKit.MutedBrush, wrap: true));
        }

        private void RenderDetails(PreChangeView view)
        {
            PreChangeSummary sum = view.Details;
            if (sum == null) return;
            var groups = sum.Groups.Where(g => g.Items.Count > 0).ToList();
            if (groups.Count == 0 && sum.Warnings.Count == 0) return;
            var body = new StackPanel();
            foreach (string w in sum.Warnings) body.Children.Add(UiKit.Text("⚠ " + w, brush: UiKit.WarningBrush, wrap: true));
            foreach (SummaryGroup g in groups) body.Children.Add(BuildGroup(g));
            _result.Children.Add(new Expander { Header = "Дэлгэрэнгүй", IsExpanded = false, Content = body, Margin = new Thickness(0, 6, 0, 2), FontWeight = FontWeights.SemiBold });
        }

        private void RenderDiagnostics(PreChangeView view)
        {
            if (view == null || view.Report == null) { _diag.Text = "—"; return; }
            PreChangeReport r = view.Report;
            var lines = new List<string>();
            PreChangeCoverage c = r.Coverage ?? new PreChangeCoverage();
            lines.Add("Шалгасан: өрөө " + (c.RoomsChecked ? "✓" : "—") + " · хэмжээс " + (c.DimensionsChecked ? "✓" : "—") + " · харагдац " + (c.ViewsChecked ? "✓" : "—")
                + " · хүснэгт " + (c.SchedulesChecked ? "✓" : "—") + " · MEP " + (c.ClashEvaluated ? (c.ClashComplete ? "✓" : "бүрэн биш") : "—")
                + " · гарц " + (!c.EgressConfigured ? "тохируулаагүй" : c.EgressEvaluated ? "✓" : "—"));
            if (r.StageMs != null && r.StageMs.Count > 0)
            {
                Func<string, string> ms = k => { long v; return r.StageMs.TryGetValue(k, out v) ? v + " мс" : "—"; };
                lines.Add("Хугацаа: түр дүн " + ms("first_result") + " · эцсийн дүн " + ms("full_result") + " · нийт " + ms("total"));
                lines.Add("Алхам: өмнөх унших " + SumMs(r, "before.") + " мс · sandbox (хөдөлгөөн + буцаалт) " + SumMs(r, "move_regenerate_ms", "commit_ms", "rollback_ms") + " мс · дараах унших " + SumMs(r, "after_capture_ms") + " мс");
            }
            foreach (string reason in r.RequiredIncomplete.Take(5)) lines.Add("⚠ " + reason);
            _diag.Text = string.Join("\n", lines);
        }

        private static long SumMs(PreChangeReport r, params string[] keys)
        {
            long total = 0;
            foreach (KeyValuePair<string, long> kv in r.StageMs)
                foreach (string k in keys)
                    if (kv.Key == k || (k.EndsWith(".", StringComparison.Ordinal) && kv.Key.StartsWith(k, StringComparison.Ordinal))) { total += kv.Value; break; }
            return total;
        }

        /* ============================== ДООД (sticky) ====================== */

        private void RenderFooter(PreChangeView view)
        {
            ApplyGateResult g = view.Gate;
            _primary.Content = g.PrimaryLabel;
            _primary.IsEnabled = g.PrimaryEnabled && !_applying && !_previewing;
            switch (g.Tone)
            {
                case ApplyTone.Green: _primary.Background = UiKit.OkBrush; _primary.Foreground = Brushes.White; break;
                case ApplyTone.Amber: _primary.Background = UiKit.WarningBrush; _primary.Foreground = Brushes.White; break;
                case ApplyTone.Red: _primary.Background = UiKit.BlockingBrush; _primary.Foreground = Brushes.White; break;
                default: _primary.ClearValue(Control.BackgroundProperty); _primary.ClearValue(Control.ForegroundProperty); break;
            }
            _gateHint.Text = g.Hint ?? "";
            _whyBtn.Visibility = g.ShowWhy ? Visibility.Visible : Visibility.Collapsed;
            _recheckBtn.Visibility = g.ShowRecheck ? Visibility.Visible : Visibility.Collapsed;
            if (g.RecheckLabel != null) _recheckBtn.Content = g.RecheckLabel;
            _recheckBtn.IsEnabled = !_applying;
            _whyBtn.Content = _showWhy ? "Яагаад? ▲" : "Яагаад?";
        }

        /* ============================== ХАРУУЛАХ =========================== */

        private PreChangeItem FindItem(string key, long id, ImpactNodeKind kind, string title)
        {
            PreChangeItem found = null;
            if (_report != null && !string.IsNullOrEmpty(key)) found = _report.Items.FirstOrDefault(i => i.Key == key);
            return found ?? new PreChangeItem { Id = id, Kind = kind, Title = title };
        }

        private async void OnShow(PreChangeItem it)
        {
            if (it == null) return;
            string msg = null;
            try { SelectOutcome r = await _s.ShowAsync(it, CancellationToken.None); msg = r != null ? r.Message : null; }
            catch (Exception ex) { msg = "⛔ " + ex.Message; }
            UiThread.Run(Dispatcher, () => { if (msg != null) _status.Text = msg; });
        }

        private UIElement BuildGroup(SummaryGroup g)
        {
            var body = new StackPanel();
            int shown = 0;
            foreach (PreChangeItem it in g.Items)
            {
                if (shown++ >= MaxItemsPerGroup) break;
                body.Children.Add(BuildRow(it));
            }
            if (g.Items.Count > MaxItemsPerGroup)
                body.Children.Add(UiKit.Text("… бусад " + (g.Items.Count - MaxItemsPerGroup) + " зүйл (жагсаалт товчлогдсон)", brush: UiKit.MutedBrush));
            return new Expander
            {
                Header = g.Title + " (" + g.Items.Count + ")",
                IsExpanded = false,
                Content = body, Margin = new Thickness(0, 2, 0, 2), FontWeight = FontWeights.SemiBold,
            };
        }

        private UIElement BuildRow(PreChangeItem it)
        {
            var grid = new Grid { Margin = new Thickness(4, 3, 4, 3) };
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(26) });
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

            var mark = UiKit.Text(it.Truth == TruthState.NotEvaluated || it.Truth == TruthState.Incomplete ? "—" : PreChangeText.SeverityMark(it.Severity));
            mark.VerticalAlignment = VerticalAlignment.Top;
            Grid.SetColumn(mark, 0);

            string cat = PreChangeText.CategoryLabel(it.Category);
            string sev = it.Truth == TruthState.Confirmed || it.Truth == TruthState.Review ? " · " + PreChangeText.SeverityWord(it.Severity) : "";
            string conf = it.Truth == TruthState.Review && it.Confidence != ImpactConfidence.Unknown ? " · итгэл " + ImpactConf.Letter(it.Confidence) : "";
            var lines = new List<UIElement>
            {
                UiKit.Text(it.Title ?? "", bold: true, wrap: true),
                UiKit.Text(cat + " · " + Truth.Label(it.Truth) + sev + conf + (string.IsNullOrEmpty(it.SheetNumber) ? "" : " · хуудас " + it.SheetNumber), brush: UiKit.MutedBrush, wrap: true),
            };
            if (!string.IsNullOrEmpty(it.Before) || !string.IsNullOrEmpty(it.After))
                lines.Add(UiKit.Text((it.Before ?? PreChangeText.Unknown) + "  →  " + (it.After ?? PreChangeText.Unknown) + (string.IsNullOrEmpty(it.Delta) ? "" : "   (" + it.Delta + ")"), wrap: true));
            if (!string.IsNullOrEmpty(it.Why)) lines.Add(UiKit.Text(it.Why, brush: UiKit.MutedBrush, wrap: true));
            var content = UiKit.Col(lines.ToArray());
            Grid.SetColumn(content, 1);

            grid.Children.Add(mark);
            grid.Children.Add(content);
            if (it.CanShow)
            {
                Button b = UiKit.Btn("Харуулах", (s, e) => OnShow(it), 80);
                b.VerticalAlignment = VerticalAlignment.Top;
                Grid.SetColumn(b, 2);
                grid.Children.Add(b);
            }
            return new Border { BorderThickness = new Thickness(0, 0, 0, 1), BorderBrush = UiKit.LineBrush, Child = grid };
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
    }
}
