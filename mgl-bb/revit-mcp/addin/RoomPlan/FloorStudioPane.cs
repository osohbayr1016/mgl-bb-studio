using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using Autodesk.Revit.UI;
using RevitMcpAddin.RoomPlan.Core;
using ComboBox = System.Windows.Controls.ComboBox;
using WpfGrid = System.Windows.Controls.Grid;

namespace RevitMcpAddin.RoomPlan
{
    /// <summary>
    /// «MGL — Давхрын план» бэхлэгддэг самбар (зүүн тал).  ⚠️ GUID ТОГТМОЛ (Revit байрлалыг үүгээр санадаг) — хэзээ ч бүү соль.
    /// ⚠️ <c>RegisterDockablePane</c> ЗӨВХӨН OnStartup-д (App.cs).  Анх удаа харагдахгүй — «Давхрын план» дарахад нээгдэнэ.
    /// </summary>
    public sealed class FloorStudioPaneProvider : IDockablePaneProvider
    {
        public static readonly Guid PaneGuid = new Guid("6b0e2f4a-3c8d-4e51-9a7f-1d2c5e8b9f30");

        public static DockablePaneId PaneId => new DockablePaneId(PaneGuid);

        private static FloorStudioPane _view;

        internal static FloorStudioPane View => _view ?? (_view = new FloorStudioPane());

        public void SetupDockablePane(DockablePaneProviderData data)
        {
            data.FrameworkElement = View;
            data.VisibleByDefault = false;
            data.InitialState = new DockablePaneState { DockPosition = DockPosition.Left };
        }

        internal static void Show(UIApplication app)
        {
            try { app.GetDockablePane(PaneId)?.Show(); }
            catch { /* самбар бүртгэгдээгүй (OnStartup унасан) — View-ийг шууд ашиглана */ }
        }
    }

    /// <summary>
    /// Нэг товчоор: давхрын олон зуун хувилбарыг арын урсгалд бэлдээд шилдэг 20-ыг карт болгож харуулна; карт дээр дарж сонгоод
    /// «Revit-д тавих», дараа нь «Тавилга байрлуулах».  Цонх, асуулт БАЙХГҮЙ.  Revit API-г зөвхөн <c>CdJobHost.Post</c>-оор
    /// (Idling).  Өнгө: самбар нь `MglTheme`-ийн токен; план нь цаасан дээрх шиг цайвар (сэдвээс үл хамаарна).
    /// </summary>
    public sealed class FloorStudioPane : UserControl
    {
        private const int RecommendCount = 20;

        private readonly TextBlock _title = new TextBlock { FontSize = 15, FontWeight = FontWeights.SemiBold, TextWrapping = TextWrapping.Wrap };
        private readonly TextBlock _storeyText = new TextBlock { FontSize = 12, TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 2, 0, 0) };
        private readonly TextBlock _status = new TextBlock { FontSize = 12, TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 6, 0, 0) };
        private readonly ProgressBar _bar = new ProgressBar { Height = 6, Minimum = 0, Maximum = 1, Margin = new Thickness(0, 6, 0, 0) };
        private readonly ComboBox _tier = new ComboBox { MinWidth = 120, Margin = new Thickness(0, 0, 8, 0) };
        private readonly ComboBox _mix = new ComboBox { MinWidth = 140 };
        private readonly TextBlock _poolText = new TextBlock { FontSize = 12, TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 8, 0, 4) };
        private readonly StackPanel _cards = new StackPanel();
        private readonly ScrollViewer _scroll;
        private readonly Button _apply = new Button { Content = "Сонгосныг Revit-д тавих", MinHeight = 32, Padding = new Thickness(10, 4, 10, 4) };
        private readonly Button _furnish = new Button { Content = "Тавилга байрлуулах", MinHeight = 32, Padding = new Thickness(10, 4, 10, 4), Margin = new Thickness(8, 0, 0, 0) };
        private readonly Button _regen = new Button { Content = "Дахин үүсгэх", Padding = new Thickness(8, 2, 8, 2) };
        private readonly TextBlock _result = new TextBlock { FontSize = 12, TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 8, 0, 0) };

        private StudioStorey _storey;
        private StudioGeneration _gen;
        private CancellationTokenSource _cts;
        private StudioCandidate _selected;
        /// <summary>Энэ самбараас сүүлд Revit-д тавьсан хувилбар (картын «✔ Revit-д» тэмдэг) — Revit API-гүйгээр (шүүлтүүр солих нь API контекст биш).</summary>
        private StudioCandidate _applied;
        private bool _refreshPosted;
        private readonly Dictionary<StudioCandidate, Border> _cardOf = new Dictionary<StudioCandidate, Border>();
        private bool _busy;

        internal StudioStorey Storey => _storey;

        public FloorStudioPane()
        {
            MinWidth = 320;
            var root = new DockPanel { Margin = new Thickness(10) };

            var head = new StackPanel { Margin = new Thickness(0, 0, 0, 6) };
            var titleRow = new DockPanel();
            DockPanel.SetDock(_regen, Dock.Right);
            titleRow.Children.Add(_regen);
            _title.Text = "Давхрын план";
            titleRow.Children.Add(Fg(_title, "Fg"));
            head.Children.Add(titleRow);
            head.Children.Add(Fg(_storeyText, "FgMuted"));
            head.Children.Add(Fg(_status, "Fg"));
            head.Children.Add(_bar);
            var filters = new WrapPanel { Margin = new Thickness(0, 8, 0, 0) };
            _tier.Items.Add("Бүх зэрэглэл");
            foreach (string t in FloorStudio.Tiers) _tier.Items.Add(FloorStudio.TierLabel(t));
            _tier.SelectedIndex = 0;
            _mix.Items.Add("Бүх харьцаа");
            foreach (MixPreset p in FloorStudio.Presets) _mix.Items.Add(p.Label);
            _mix.SelectedIndex = 0;
            _tier.SelectionChanged += (s, e) => ShowRecommendations();
            _mix.SelectionChanged += (s, e) => ShowRecommendations();
            filters.Children.Add(_tier);
            filters.Children.Add(_mix);
            head.Children.Add(filters);
            head.Children.Add(Fg(_poolText, "FgMuted"));
            DockPanel.SetDock(head, Dock.Top);
            root.Children.Add(head);

            var foot = new StackPanel { Margin = new Thickness(0, 8, 0, 0) };
            var buttons = new WpfGrid();
            buttons.ColumnDefinitions.Add(new ColumnDefinition());
            buttons.ColumnDefinitions.Add(new ColumnDefinition());
            WpfGrid.SetColumn(_furnish, 1);
            buttons.Children.Add(_apply);
            buttons.Children.Add(_furnish);
            foot.Children.Add(buttons);
            foot.Children.Add(Fg(_result, "Fg"));
            DockPanel.SetDock(foot, Dock.Bottom);
            root.Children.Add(foot);

            _scroll = new ScrollViewer
            {
                Content = _cards,
                VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
                HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
            };
            root.Children.Add(_scroll);
            Content = root;

            _apply.Click += (s, e) => ApplySelected();
            _furnish.Click += (s, e) => FurnishApplied();
            _regen.Click += (s, e) => Post(app => Start(FloorStudioEngine.Capture(app.ActiveUIDocument)));
            _apply.IsEnabled = false;
            _furnish.IsEnabled = false;
            _regen.IsEnabled = false;
            // Ctrl+Z / гараар устгасны дараа «Тавилга байрлуулах» төлөв өөрчлөгдөнө — хулгана самбар дээр ирэхэд API контекстод шинэчилнэ.
            MouseEnter += (s, e) =>
            {
                if (_refreshPosted || _busy || _storey == null || _storey.Doc == null) return;
                _refreshPosted = true;
                Post(app => { _refreshPosted = false; RefreshFurnishButton(); });
            };
            _status.Text = "Floor Plan нээгээд туузан цэсний «Давхрын план» товчийг дарна уу.  Давхрыг олон зуун янзаар хувааж, " +
                           "шилдэг " + RecommendCount + "-ыг энд санал болгоно.";
            _bar.Visibility = Visibility.Collapsed;

            try { global::RevitMcpAddin.Ui.MglTheme.Apply(this, 12); }
            catch { Background = SystemColors.WindowBrush; Foreground = SystemColors.WindowTextBrush; }
        }

        // ── Эхлүүлэх (команд, «Дахин үүсгэх») ──────────────────────────

        /// <summary>API контекстоос (`Capture`-ийн дараа).  Өмнөх үүсгэлтийг цуцалж шинээр эхэлнэ.</summary>
        internal void Start(StudioStorey storey)
        {
            _cts?.Cancel();
            _storey = storey;
            _gen = null;
            _selected = null;
            _cards.Children.Clear();
            _cardOf.Clear();
            _poolText.Text = "";
            _result.Text = "";
            _apply.IsEnabled = false;
            _regen.IsEnabled = storey != null && storey.Doc != null;
            _storeyText.Text = storey?.Title ?? "";
            _applied = null;
            RefreshFurnishButton();
            if (storey == null || storey.Problem != null)
            {
                _bar.Visibility = Visibility.Collapsed;
                SetStatus(storey?.Problem ?? "Давхар олдсонгүй.", "Warn");
                return;
            }
            var cts = new CancellationTokenSource();
            _cts = cts;
            _bar.Visibility = Visibility.Visible;
            _bar.Value = 0;
            SetStatus("Хувилбар үүсгэж байна…", "Fg");
            System.Windows.Threading.Dispatcher dispatcher = Dispatcher;
            Task.Run(() => FloorStudioEngine.Generate(storey, (text, value) =>
                dispatcher.BeginInvoke(new Action(() =>
                {
                    if (cts.IsCancellationRequested) return;
                    SetStatus(text, "Fg");
                    _bar.Value = value;
                })), cts.Token), cts.Token)
                .ContinueWith(t => dispatcher.BeginInvoke(new Action(() =>
                {
                    if (cts.IsCancellationRequested || !ReferenceEquals(_cts, cts)) return;
                    _bar.Visibility = Visibility.Collapsed;
                    if (t.IsFaulted || t.IsCanceled)
                    {
                        SetStatus("Хувилбар үүсгэж чадсангүй: " + (t.Exception?.GetBaseException().Message ?? "цуцлагдсан"), "Danger");
                        return;
                    }
                    _gen = t.Result;
                    if (_gen.Error != null && _gen.Pool.Count == 0) { SetStatus(_gen.Error, "Danger"); return; }
                    SetStatus(_gen.Pool.Count + " бүтэн давхрын хувилбар (" + _gen.Splits.Count + " айл хуваалт × айл бүрийн өрөөний план) " +
                              F1(_gen.Seconds) + " с-д үүслээ" +
                              (_gen.FailedUnits > 0 ? " · " + _gen.FailedUnits + " айлын хэмжээнд өрөөний план олдсонгүй (тэдгээрийг агуулсан хуваалт хасагдсан)" : "") + ".",
                              "Fg");
                    ShowRecommendations();
                })));
        }

        // ── Санал болгох жагсаалт ───────────────────────────────────────

        private void ShowRecommendations()
        {
            _cards.Children.Clear();
            _cardOf.Clear();
            if (_gen == null || _gen.Pool.Count == 0) return;
            string tier = _tier.SelectedIndex > 0 ? FloorStudio.Tiers[_tier.SelectedIndex - 1] : null;
            string mix = _mix.SelectedIndex > 0 ? FloorStudio.Presets[_mix.SelectedIndex - 1].Key : null;
            int inFilter = _gen.Pool.Count(c => (tier == null || c.Split.Tier == tier) && (mix == null || c.Split.Preset.Key == mix));
            List<StudioCandidate> top = FloorStudio.Recommend(_gen.Pool, RecommendCount, tier, mix);
            _poolText.Text = inFilter + " хувилбараас шилдэг " + top.Count + " (тав тух, гэрэл, агаар сэлгэлт, үр ашгаар) — карт дээр дарж сонгоно.";
            if (top.Count == 0)
            {
                _cards.Children.Add(Fg(new TextBlock { Text = "Энэ шүүлтүүрээр хувилбар алга.", TextWrapping = TextWrapping.Wrap }, "FgMuted"));
                return;
            }
            foreach (StudioCandidate c in top)
            {
                Border card = Card(c, ReferenceEquals(c, _applied));
                _cardOf[c] = card;
                _cards.Children.Add(card);
            }
            Select(top.Contains(_selected) ? _selected : top[0]);
            _scroll.ScrollToTop();
        }

        private Border Card(StudioCandidate c, bool applied)
        {
            FloorPlateLayout l = c.Split.Layout;
            var body = new StackPanel();
            var head = new DockPanel();
            var score = Fg(new TextBlock { Text = c.Score.ToString("0", CultureInfo.InvariantCulture) + " оноо", FontWeight = FontWeights.SemiBold }, "Accent");
            DockPanel.SetDock(score, Dock.Right);
            head.Children.Add(score);
            head.Children.Add(Fg(new TextBlock
            {
                Text = "№" + c.Rank + "  " + FloorStudio.Describe(c.Split) + (applied ? "  ✔ Revit-д" : ""),
                FontWeight = FontWeights.SemiBold, TextWrapping = TextWrapping.Wrap,
            }, "Fg"));
            body.Children.Add(head);
            body.Children.Add(new Viewbox
            {
                Child = FloorStudioDrawing.Build(c), Stretch = Stretch.Uniform, StretchDirection = StretchDirection.Both,
                MaxHeight = 260, Margin = new Thickness(0, 6, 0, 6),
            });
            body.Children.Add(Fg(new TextBlock
            {
                Text = l.Units.Count + " айл: " + FloorStudio.MixText(l) + " · айлын талбай " + l.Nfa.ToString("0", CultureInfo.InvariantCulture) +
                       " м² · үр ашиг " + (l.Efficiency * 100).ToString("0", CultureInfo.InvariantCulture) + " %",
                TextWrapping = TextWrapping.Wrap,
            }, "Fg"));
            body.Children.Add(Fg(new TextBlock
            {
                Text = "☀ " + c.LitUnits + "/" + l.Units.Count + " айлын бүх өрөө цонхтой · ↔ " + c.DualAspectUnits + "/" + l.Units.Count +
                       " айл хоёр талдаа цонхтой (агаар сэлгэлт) · тав тух " + Pct(c.Parts["comfort"]),
                TextWrapping = TextWrapping.Wrap,
            }, "FgMuted"));
            var details = Fg(new TextBlock
            {
                Text = "Тав тух " + Pct(c.Parts["comfort"]) + " · Гэрэл " + Pct(c.Parts["daylight"]) + " · Агаар " + Pct(c.Parts["ventilation"]) +
                       " · Үр ашиг " + Pct(c.Parts["efficiency"]) + " · Харьцаа " + Pct(c.Parts["mix"]) + " · Хэмжээ " + Pct(c.Parts["size"]) +
                       " · Ойлгомж " + Pct(c.Parts["clarity"]),
                TextWrapping = TextWrapping.Wrap, Visibility = Visibility.Collapsed, Margin = new Thickness(0, 4, 0, 0),
                Tag = "details",
            }, "FgMuted");
            body.Children.Add(details);

            var border = new Border
            {
                Child = body, Padding = new Thickness(8), Margin = new Thickness(0, 0, 0, 8),
                BorderThickness = new Thickness(1), CornerRadius = new CornerRadius(4), Cursor = Cursors.Hand, Tag = c,
            };
            border.SetResourceReference(Border.BackgroundProperty, "BgRaised");
            border.SetResourceReference(Border.BorderBrushProperty, "Line");
            border.MouseLeftButtonUp += (s, e) => Select(c);
            return border;
        }

        private void Select(StudioCandidate c)
        {
            _selected = c;
            foreach (var pair in _cardOf)
            {
                bool on = ReferenceEquals(pair.Key, c);
                pair.Value.BorderThickness = new Thickness(on ? 2 : 1);
                pair.Value.SetResourceReference(Border.BorderBrushProperty, on ? "Accent" : "Line");
                foreach (TextBlock t in ((StackPanel)pair.Value.Child).Children.OfType<TextBlock>())
                    if (Equals(t.Tag, "details")) t.Visibility = on ? Visibility.Visible : Visibility.Collapsed;
            }
            _apply.IsEnabled = c != null && !_busy;
        }

        // ── Revit (Idling) ──────────────────────────────────────────────

        private void ApplySelected()
        {
            StudioCandidate c = _selected;
            StudioStorey s = _storey;
            if (c == null || s == null || _busy) return;
            SetBusy(true, "Revit-д тавьж байна…");
            Post(app => ShowOutcome(FloorStudioEngine.Apply(s, c, false)));
        }

        private void FurnishApplied()
        {
            StudioStorey s = _storey;
            if (s == null || _busy) return;
            SetBusy(true, "Тавилга байрлуулж байна…");
            Post(app => ShowOutcome(FloorStudioEngine.Furnish(s)));
        }

        /// <summary>Хэрэгжүүлсний үр дүн (API контекстод дуудагдана — самбартай ижил UI урсгал).</summary>
        internal void ShowOutcome(StudioApplyOutcome o)
        {
            SetBusy(false, null);
            if (o == null) return;
            _result.Text = o.Message + (o.Notes.Count == 0 ? "" : "\n• " + string.Join("\n• ", o.Notes));
            _result.SetResourceReference(TextBlock.ForegroundProperty, o.Ok ? "Ok" : "Danger");
            if (o.Ok) _applied = o.Candidate;
            if (o.Ok && _gen != null) ShowRecommendations();
            RefreshFurnishButton();
        }

        private void RefreshFurnishButton()
        {
            _furnish.IsEnabled = !_busy && _storey != null && _storey.Doc != null && _storey.Doc.IsValidObject &&
                                 FloorStudioEngine.HasUnfurnished(_storey.Doc, _storey.LevelId);
        }

        private void SetBusy(bool busy, string text)
        {
            _busy = busy;
            _apply.IsEnabled = !busy && _selected != null;
            _regen.IsEnabled = !busy && _storey != null && _storey.Doc != null;
            if (busy) { _furnish.IsEnabled = false; _result.Text = text; _result.SetResourceReference(TextBlock.ForegroundProperty, "FgMuted"); }
        }

        private void Post(Action<UIApplication> action)
        {
            global::RevitMcpAddin.CloneDrawings.CdJobHost.Post(app =>
            {
                try { action(app); }
                catch (Exception ex)
                {
                    SetBusy(false, null);
                    _result.Text = "Алдаа: " + ex.Message;
                    _result.SetResourceReference(TextBlock.ForegroundProperty, "Danger");
                }
            });
        }

        // ── Туслах ─────────────────────────────────────────────────────

        private void SetStatus(string text, string key)
        {
            _status.Text = text;
            _status.SetResourceReference(TextBlock.ForegroundProperty, key);
        }

        private static T Fg<T>(T t, string key) where T : TextBlock
        {
            t.SetResourceReference(TextBlock.ForegroundProperty, key);
            return t;
        }

        private static string Pct(double v) { return (v * 100).ToString("0", CultureInfo.InvariantCulture) + " %"; }
        private static string F1(double v) { return v.ToString("0.#", CultureInfo.InvariantCulture); }
    }
}
