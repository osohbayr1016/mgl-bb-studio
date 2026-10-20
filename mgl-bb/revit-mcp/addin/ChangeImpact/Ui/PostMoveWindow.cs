using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Threading;
using RevitMcpAddin.ChangeImpact.Core;
using RevitMcpAddin.Smart.Core;
using RevitMcpAddin.Smart.Ui;

namespace RevitMcpAddin.ChangeImpact.Ui
{
    /// <summary>
    /// Revit-д ШУУД зөөсний дараах жижиг цонх (баруун доод буланд, фокус АВАХГҮЙ — Revit-д ажлаа үргэлжлүүлнэ):
    ///   «Та «Багана»-г X +1500 мм зөөлөө» + юутай мөргөлдөж / юу дагаж өөрчлөгдөж буй
    ///   [Буцаах]  [Хаах]  [Зөөлтийг үлдээх]  (🔴 бол «Өөрийн шийдвэрээр үлдээх»).
    /// Зөөлт АЛЬ ХЭДИЙН хийгдсэн: «Үлдээх» = хэвээр; «Буцаах» = яг буцааж зөөх (нэг Undo).  Хэрэглэгч дахин зөөвөл цонх ШИНЭЧЛЭГДЭНЭ.
    /// ERP мэдэгдэл ЯВАХГҮЙ (эзэн 2026-10-06): зөөсөн хүн холбогдох багийн хүнд өөрөө очиж хэлнэ — цонх хэнд хамаатайг харуулна.
    /// </summary>
    internal sealed class PostMoveWindow : Window
    {
        private static PostMoveWindow _current;

        private INativeMoveSession _s;
        private NativeMoveResult _r;
        private readonly Border _banner = new Border { Padding = new Thickness(12, 8, 12, 8), BorderThickness = new Thickness(0, 0, 0, 3) };
        private readonly TextBlock _title = new TextBlock { FontSize = 15.5, FontWeight = FontWeights.Bold, TextWrapping = TextWrapping.Wrap };
        private readonly TextBlock _sub = new TextBlock { FontSize = 12, TextWrapping = TextWrapping.Wrap };
        private readonly StackPanel _lines = new StackPanel { Margin = new Thickness(10, 6, 10, 4) };
        private readonly StackPanel _info = new StackPanel { Margin = new Thickness(10, 2, 10, 8) };
        private readonly TextBlock _hint = UiKit.Text("Хөндөгдсөн элементийг хийсэн хүмүүст (Revit-д элемент дээр хулганаа барихад «Created by» харагдана) өөрөө мэдэгдэнэ үү.", brush: UiKit.InfoBrush, wrap: true);
        private readonly TextBlock _status = UiKit.Text("", brush: UiKit.MutedBrush, wrap: true);
        private readonly Button _approve, _revert, _close;
        private readonly CheckBox _off;
        private bool _busy, _decided;

        internal static void ShowOrUpdate(INativeMoveSession s)
        {
            NativeMoveResult r = s.Result;
            if (_current != null && _current.IsLoaded && !_current._busy) { _current.Bind(s, r); return; }
            var w = new PostMoveWindow(s, r);
            _current = w;
            w.Closed += (o, e) => { if (ReferenceEquals(_current, w)) _current = null; };
            w.Show();
        }

        /// <summary>Тэр файлын зөөлт буцаагдсан / анхны байрлалдаа ирсэн — цонх, сүүдрийг арилгана (UI thread-ээс бус дуудагдаж болно).</summary>
        internal static void CloseIfFor(DocumentKey key)
        {
            PostMoveWindow w = _current;
            if (w == null) return;
            try { w.Dispatcher.BeginInvoke(new Action(() => { if (w._r != null && w._r.Key.Equals(key) && !w._busy) w.Close(); })); } catch (Exception) { }
        }

        private PostMoveWindow(INativeMoveSession s, NativeMoveResult r)
        {
            Title = "MGL — Зөөлтийн нөлөө";
            Width = 470; Height = 640; MinWidth = 380; MinHeight = 360;
            ShowInTaskbar = false; ShowActivated = false; Topmost = false;
            UiKit.Prepare(this, "native-move");
            WindowStartupLocation = WindowStartupLocation.Manual;
            Rect wa = SystemParameters.WorkArea;
            Left = wa.Right - Width - 16; Top = Math.Max(wa.Top + 16, wa.Bottom - Height - 16);

            _approve = UiKit.Btn("Зөөлтийг үлдээх", (o, e) => OnApprove(), 150);
            _approve.FontWeight = FontWeights.SemiBold;
            _approve.Padding = new Thickness(12, 6, 12, 6);
            _revert = UiKit.Btn("Буцаах", (o, e) => OnRevert(), 80);
            _revert.ToolTip = "Элементийг яг өмнөх байрлалд нь буцааж зөөнө (нэг Undo «MGL — Зөөлтийг буцаах»).";
            _close = UiKit.Btn("Хаах", (o, e) => Close(), 64);
            _close.ToolTip = "Цонхыг хаана — зөөлт хэвээр.";
            _off = UiKit.Check("Энэ Revit-ийн сессэд шууд зөөлтийг шалгахгүй", false, (o, e) => { if (_s != null) _s.SetWatchEnabled(_off.IsChecked != true); });
            _off.FontSize = 11.5;

            var head = new StackPanel { Children = { _title, _sub } };
            _banner.Child = head;
            var scroll = new ScrollViewer { VerticalScrollBarVisibility = ScrollBarVisibility.Auto, Content = new StackPanel { Children = { _lines, _hint, _info } } };
            var buttons = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Right, Children = { _revert, _close, _approve } };
            foreach (UIElement b in buttons.Children) ((FrameworkElement)b).Margin = new Thickness(6, 0, 0, 0);
            var bottom = new StackPanel { Margin = new Thickness(10, 4, 10, 10), Children = { _status, _off, buttons } };
            _status.Margin = new Thickness(0, 0, 0, 4);
            _off.Margin = new Thickness(0, 0, 0, 6);
            var root = new DockPanel();
            DockPanel.SetDock(_banner, Dock.Top); DockPanel.SetDock(bottom, Dock.Bottom);
            root.Children.Add(_banner); root.Children.Add(bottom); root.Children.Add(scroll);
            Content = root;
            Closed += (o, e) => { try { if (_s != null) _s.ClearGhost(); } catch (Exception) { } if (_s != null && !_decided) _s.Settle(); };
            Bind(s, r);
        }

        private void Bind(INativeMoveSession s, NativeMoveResult r)
        {
            _s = s; _r = r; _decided = false;
            SimReport rep = r.Report;
            byte[] tone = SimGhostScene.ToneOf(rep.Verdict);
            var c = Color.FromRgb(tone[0], tone[1], tone[2]);
            _banner.Background = new SolidColorBrush(Color.FromArgb(44, c.R, c.G, c.B));
            _banner.BorderBrush = new SolidColorBrush(c);
            _title.Text = "● " + (rep.Title ?? "");
            _title.Foreground = new SolidColorBrush(c);
            _sub.Text = rep.Headline ?? "";
            _sub.Foreground = UiKit.FgBrush;

            _lines.Children.Clear();
            foreach (SimLine l in rep.Lines.Where(l => l.Severity != SimSeverity.Info).Take(20)) _lines.Children.Add(Card(l));
            // Мэдээлэл (Revit өөрөө засах шал, холбоос…) — хураангуй, «Мэдэгдэл»-ийг доош түлхэхгүй.
            _info.Children.Clear();
            foreach (SimLine l in rep.Lines.Where(l => l.Severity == SimSeverity.Info && l.Code != "modified").Take(6))
                _info.Children.Add(Small("ℹ " + l.Text));
            foreach (string t in rep.Coverage.Take(3)) _info.Children.Add(Small(t));
            _hint.Margin = new Thickness(10, 2, 10, 6);
            _hint.FontSize = 11.5;
            _status.Text = "Шалгалт " + (r.ElapsedMs / 1000.0).ToString("0.0") + " с.  Revit-ийн зураг дээр: саарал = өмнөх байрлал, улаан = мөргөлдөөн.";
            UpdateButtons();
        }

        private static TextBlock Small(string text)
        {
            var t = UiKit.Text(text ?? "", brush: UiKit.MutedBrush, wrap: true);
            t.FontSize = 11;
            t.Margin = new Thickness(0, 1, 0, 1);
            return t;
        }

        private UIElement Card(SimLine l)
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
                cons.Margin = new Thickness(12, 2, 0, 0);
                body.Children.Add(cons);
            }
            if (l.Id != 0)
            {
                long id = l.Id; int slot = l.Slot;
                Button show = UiKit.Btn("Revit-д харуулах", async (o, e) => { try { await _s.ShowElementAsync(id, slot); } catch (Exception) { } }, 0);
                show.Padding = new Thickness(8, 1, 8, 1);
                show.HorizontalAlignment = HorizontalAlignment.Left;
                show.Margin = new Thickness(12, 4, 0, 0);
                body.Children.Add(show);
            }
            return new Border
            {
                BorderBrush = stripe, BorderThickness = new Thickness(4, 0, 0, 0), Padding = new Thickness(8, 4, 6, 6), Margin = new Thickness(0, 0, 0, 6),
                Background = new SolidColorBrush(Color.FromArgb(18, 128, 128, 128)), Child = body,
            };
        }

        private void UpdateButtons()
        {
            if (_approve == null || _r == null) return;
            SimReport rep = _r.Report;
            _approve.Content = rep.CanForce ? "Өөрийн шийдвэрээр үлдээх" : "Зөөлтийг үлдээх";
            _approve.IsEnabled = !_busy;
            _revert.IsEnabled = _close.IsEnabled = !_busy;
        }

        /* ============================== ҮЙЛДЛҮҮД =========================== */

        private void OnApprove()
        {
            if (_busy || _r == null) return;
            try
            {
                if (_r.Report.CanForce && ConfirmForTest == null
                    && MessageBox.Show(this, "Ноцтой үр дагавартай зөөлт.  Өөрийн шийдвэрээр үлдээх үү?\n\nХолбогдох элементийг хийсэн хүмүүст өөрөө мэдэгдэнэ үү.",
                        Title, MessageBoxButton.YesNo, MessageBoxImage.Exclamation) != MessageBoxResult.Yes) return;
                _decided = true;
                _s.Settle();
                _status.Text = "Зөөлт хэвээр үлдлээ.";
                CloseSoon(900);
            }
            catch (Exception ex)
            {
                SmartLog.Error("native", "approve_ui", ex);
                _status.Text = "⛔ Алдаа (" + ex.GetType().Name + ").";
            }
        }

        private async void OnRevert()
        {
            if (_busy || _s == null) return;
            _busy = true; UpdateButtons();
            _status.Text = "Буцааж байна…";
            string err = null;
            try { err = await _s.RevertAsync(); }
            catch (Exception ex) { err = "Буцааж чадсангүй (" + ex.GetType().Name + ") — Ctrl+Z ашиглана уу."; }
            _busy = false;
            if (err == null)
            {
                _decided = true;
                _s.Settle();
                _status.Text = "Буцаалаа — элемент өмнөх байрлалдаа.";
                CloseSoon(1200);
            }
            else { _status.Text = "⛔ " + err; UpdateButtons(); }
        }

        private void CloseSoon(int ms)
        {
            var t = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(ms) };
            t.Tick += (o, e) => { t.Stop(); try { Close(); } catch (Exception) { } };
            t.Start();
        }

        /* ============================== ТЕСТИЙН ХААЛГА ====================== */

        internal static PostMoveWindow Current { get { return _current; } }
        /// <summary>Шалгалтын хэрэгсэлд л: 🔴 үед MessageBox-гүйгээр үлдээнэ.</summary>
        internal static Func<string, bool> ConfirmForTest { get; set; }
        internal string StatusText { get { return _status.Text; } }
        internal string TitleText { get { return _title.Text; } }
        internal NativeMoveResult Result { get { return _r; } }
        internal void ApproveForTest() { OnApprove(); }
        internal void RevertForTest() { OnRevert(); }
    }
}
