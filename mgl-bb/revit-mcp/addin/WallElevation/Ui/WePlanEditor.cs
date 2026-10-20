using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Shapes;
using RevitMcpAddin.Ui;
using RevitMcpAddin.WallElevation.Core;

namespace RevitMcpAddin.WallElevation.Ui
{
    /// <summary>
    /// Урьдчилсан дүнгийн ТОМ, ЗАСВАРЛАХ план (2026-10-14, эзэн: «A,B,C,D-ийн preview-г томруулж, тэндээс үсэг, хэмжээсийг нь тавиад хүссэн
    /// газрынхаа дэлгээсийг өөрөө тохируулдаг болго»).  Өрөөний хил + дэлгээс бүрийн зүсэх шугам (харах сум, үсэг).  Сонгосон дэлгээс:
    ///   • шугамыг ЧИРЖ зөөнө (Shift — зөвхөн харах чиглэлд);
    ///   • үзүүрийг чирж УРТЫГ өөрчилнө (шугамын дагуу; Ctrl — чөлөөт өнцөг, харах чиглэл шугамд перпендикуляр болно);
    ///   • «⟲ 90°», «⇅ Эсрэг», «↺ Анхных» товч (<see cref="WallElevationDialog"/>).
    /// Загварт юу ч бичихгүй — өөрчлөлт <see cref="Edited"/>-ээр цонх руу (төлөвлөгч дахин бодно).
    /// </summary>
    internal sealed class WePlanEditor : Border
    {
        public event Action<string> Selected;
        public event Action<string, WeSideOverride> Edited;

        private readonly Canvas _c;
        private readonly double _w, _h;
        private const double Pad = 22;
        private List<List<WeV3>> _outline = new List<List<WeV3>>();
        private List<WePlannedElevation> _items = new List<WePlannedElevation>();
        private Func<WePlannedElevation, bool> _included = p => true;
        private string _selected;
        private double _k = 1, _minX, _minY, _offX, _offY;
        private IWeUnits _units;

        // Чирэлт
        private enum Drag { None, Move, EndA, EndB }
        private Drag _drag;
        private Point _start;
        private WeV3 _a0, _b0, _look0;
        private WeSideOverride _live;
        private bool _moved;

        public WePlanEditor(double width, double height)
        {
            _w = width;
            _h = height;
            _c = new Canvas { Width = width, Height = height, ClipToBounds = true, Background = Brushes.Transparent, Focusable = true };
            BorderThickness = new Thickness(1);
            CornerRadius = new CornerRadius(4);
            SetResourceReference(BorderBrushProperty, "Line");
            Child = _c;
            HorizontalAlignment = HorizontalAlignment.Left;
            VerticalAlignment = VerticalAlignment.Top;
            _c.MouseMove += OnMove;
            _c.MouseLeftButtonUp += OnUp;
            _c.LostMouseCapture += (s, e) => { if (_drag != Drag.None) Finish(); };
            MglAuto.Name(this, "План: дэлгээсийн байрлал (чирж засна)");
        }

        public string SelectedKey { get { return _selected; } }

        public void Show(List<List<WeV3>> outline, List<WePlannedElevation> items, Func<WePlannedElevation, bool> included, string selectedKey, IWeUnits units)
        {
            _outline = outline ?? new List<List<WeV3>>();
            _items = items.Where(i => !i.PlanLook.IsZero && (i.PlanB - i.PlanA).Flat().Length > 1e-6).ToList();
            _included = included ?? (p => true);
            _selected = selectedKey;
            _units = units;
            Fit();
            Redraw();
        }

        // ── Масштаб ─────────────────────────────────────────────────

        private void Fit()
        {
            var pts = new List<WeV3>();
            foreach (List<WeV3> l in _outline) pts.AddRange(l);
            foreach (WePlannedElevation p in _items)
            {
                pts.Add(p.PlanA); pts.Add(p.PlanB);
                if (!p.OrigLook.IsZero) { pts.Add(p.OrigA); pts.Add(p.OrigB); }
            }
            if (pts.Count == 0) { _k = 1; return; }
            _minX = pts.Min(p => p.X); _minY = pts.Min(p => p.Y);
            double spanX = Math.Max(pts.Max(p => p.X) - _minX, 1e-6), spanY = Math.Max(pts.Max(p => p.Y) - _minY, 1e-6);
            _k = Math.Min((_w - 2 * Pad) / spanX, (_h - 2 * Pad) / spanY);
            _offX = Pad + ((_w - 2 * Pad) - spanX * _k) / 2;
            _offY = Pad + ((_h - 2 * Pad) - spanY * _k) / 2;
        }

        private Point Map(WeV3 v) { return new Point(_offX + (v.X - _minX) * _k, _h - (_offY + (v.Y - _minY) * _k)); }
        private WeV3 Delta(Vector d) { return new WeV3(d.X / _k, -d.Y / _k, 0); }

        // ── Зураг ───────────────────────────────────────────────────

        /// <summary>Энэ зураглалд тавьсан үсгүүдийн төв — давхцахгүй (нэмэлт талыг «⇅ Эсрэг» хийхэд үсэг нь хажуу талынхтай давхцдаг байв).</summary>
        private readonly List<Point> _letters = new List<Point>();

        private void Redraw()
        {
            _c.Children.Clear();
            _letters.Clear();
            foreach (List<WeV3> loop in _outline)
            {
                if (loop.Count < 3) continue;
                var poly = new Polygon { StrokeThickness = 1.2, IsHitTestVisible = false };
                foreach (WeV3 p in loop) poly.Points.Add(Map(p));
                poly.SetResourceReference(Shape.StrokeProperty, "FgMuted");
                poly.SetResourceReference(Shape.FillProperty, "BgRaised");
                _c.Children.Add(poly);
            }
            // Сонгосныг хамгийн дээр.
            foreach (WePlannedElevation p in _items.OrderBy(i => i.Key == _selected ? 1 : 0)) DrawItem(p);

            var north = new TextBlock { Text = "↑ Х", FontSize = 12, IsHitTestVisible = false };
            north.SetResourceReference(TextBlock.ForegroundProperty, "FgMuted");
            Canvas.SetRight(north, 6);
            Canvas.SetTop(north, 4);
            _c.Children.Add(north);

            WePlannedElevation sel = _items.FirstOrDefault(i => i.Key == _selected);
            if (sel != null && _drag != Drag.None)
            {
                WeV3 a = _live != null ? _live.A : sel.PlanA, b = _live != null ? _live.B : sel.PlanB;
                var len = new TextBlock { Text = (_units != null ? _units.InternalToMeters((b - a).Flat().Length) : (b - a).Flat().Length).ToString("0.00", CultureInfo.InvariantCulture) + " м", FontSize = 11, IsHitTestVisible = false };
                len.SetResourceReference(TextBlock.ForegroundProperty, "Fg");
                Canvas.SetLeft(len, 6);
                Canvas.SetBottom(len, 4);
                _c.Children.Add(len);
            }
        }

        private void DrawItem(WePlannedElevation p)
        {
            bool on = _included(p), sel = p.Key == _selected;
            WeV3 a = p.PlanA, b = p.PlanB, look = p.PlanLook.Flat().Normalized();
            if (sel && _live != null) { a = _live.A; b = _live.B; look = _live.Look.Flat().Normalized(); }

            // Анхны гадаргуу (тохируулсан бол) — тасархай сүүдэр.
            if ((p.Override != null || (sel && _live != null)) && !p.OrigLook.IsZero)
            {
                Point oa = Map(p.OrigA), ob = Map(p.OrigB);
                var ghost = new Line { X1 = oa.X, Y1 = oa.Y, X2 = ob.X, Y2 = ob.Y, StrokeThickness = 1.5, StrokeDashArray = new DoubleCollection { 3, 3 }, IsHitTestVisible = false };
                ghost.SetResourceReference(Shape.StrokeProperty, "FgMuted");
                _c.Children.Add(ghost);
            }

            Point pa = Map(a), pb = Map(b);
            string tone = !on ? "FgMuted" : sel ? "Accent" : p.Status == WeStatus.Warning ? "Warn" : "Ok";
            var ln = new Line { X1 = pa.X, Y1 = pa.Y, X2 = pb.X, Y2 = pb.Y, StrokeThickness = sel ? 4.5 : on ? 3 : 1.5, StrokeStartLineCap = PenLineCap.Round, StrokeEndLineCap = PenLineCap.Round, IsHitTestVisible = false };
            ln.SetResourceReference(Shape.StrokeProperty, tone);
            _c.Children.Add(ln);

            // Сум (харагчийн талаас ханыг заана) + үсэг.
            Point m = Map((a + b) * 0.5);
            var lv = new Vector(look.X, -look.Y);
            lv.Normalize();
            Point tip = m - lv * 6, bas = m - lv * 20;
            var side = new Vector(-lv.Y, lv.X) * 7;
            var arrow = new Polygon { Points = new PointCollection { tip, bas + side, bas - side }, IsHitTestVisible = false };
            arrow.SetResourceReference(Shape.FillProperty, tone);
            _c.Children.Add(arrow);
            var letter = new TextBlock { Text = string.IsNullOrEmpty(p.SideLetter) ? "?" : p.SideLetter, FontWeight = FontWeights.SemiBold, FontSize = sel ? 15 : 13, IsHitTestVisible = false };
            letter.SetResourceReference(TextBlock.ForegroundProperty, on ? (sel ? "Accent" : "Fg") : "FgMuted");
            letter.Measure(new Size(double.PositiveInfinity, double.PositiveInfinity));
            Point lp = m - lv * 32;
            // Өөр үсэгтэй давхцвал шугамын дагуу хажуу тийш (сонгосныг хамгийн сүүлд зурдаг тул ТЭР нь зөөгдөнө, бусад нь байрандаа).
            var along = new Vector(-lv.Y, lv.X);
            for (int k = 1; k <= 6 && _letters.Any(q => (q - lp).Length < 15); k++)
                lp = m - lv * 32 + along * (18 * ((k + 1) / 2) * (k % 2 == 1 ? 1 : -1));
            _letters.Add(lp);
            Canvas.SetLeft(letter, lp.X - letter.DesiredSize.Width / 2);
            Canvas.SetTop(letter, lp.Y - letter.DesiredSize.Height / 2);
            _c.Children.Add(letter);

            // Дарах/чирэх талбай: шугам (өргөн, тунгалаг) + сум, үсэг орчим.
            string key = p.Key;
            var hit = new Line { X1 = pa.X, Y1 = pa.Y, X2 = pb.X, Y2 = pb.Y, StrokeThickness = 16, Stroke = Brushes.Transparent, Cursor = sel ? Cursors.SizeAll : Cursors.Hand };
            hit.MouseLeftButtonDown += (s, e) => Down(key, Drag.Move, e);
            _c.Children.Add(hit);
            var hit2 = new Ellipse { Width = 34, Height = 34, Fill = Brushes.Transparent, Cursor = Cursors.Hand };
            Point hc = m - lv * 24;
            Canvas.SetLeft(hit2, hc.X - 17);
            Canvas.SetTop(hit2, hc.Y - 17);
            hit2.MouseLeftButtonDown += (s, e) => Down(key, Drag.Move, e);
            _c.Children.Add(hit2);
            hit.ToolTip = hit2.ToolTip = (p.SideLetter ?? "?") + " — дарж сонгоно, чирж зөөнө" + (p.Override != null ? " (таны тохируулсан)" : string.Empty);

            if (sel && on)
            {
                foreach (bool isA in new[] { true, false })
                {
                    Point hp = isA ? pa : pb;
                    var h = new Ellipse { Width = 12, Height = 12, StrokeThickness = 2, Cursor = Cursors.SizeWE, ToolTip = "Чирж уртыг өөрчилнө (Ctrl — чөлөөт өнцөг)" };
                    h.SetResourceReference(Shape.StrokeProperty, "Accent");
                    h.SetResourceReference(Shape.FillProperty, "BgInput");
                    Canvas.SetLeft(h, hp.X - 6);
                    Canvas.SetTop(h, hp.Y - 6);
                    Drag d = isA ? Drag.EndA : Drag.EndB;
                    h.MouseLeftButtonDown += (s, e) => Down(key, d, e);
                    _c.Children.Add(h);
                }
            }
        }

        // ── Хулгана ─────────────────────────────────────────────────

        private void Down(string key, Drag kind, MouseButtonEventArgs e)
        {
            e.Handled = true;
            if (key != _selected)
            {
                _selected = key;
                Redraw();
                if (Selected != null) Selected(key);
                return;   // эхний дарах = сонгох; дараагийнх = чирэх
            }
            WePlannedElevation p = _items.FirstOrDefault(i => i.Key == key);
            if (p == null || !_included(p)) return;
            _drag = kind;
            _start = e.GetPosition(_c);
            _a0 = p.PlanA.Flat(); _b0 = p.PlanB.Flat(); _look0 = p.PlanLook.Flat().Normalized();
            _live = WeSideOverride.Line(_a0, _b0, _look0);
            _moved = false;
            _c.CaptureMouse();
        }

        private void OnMove(object sender, MouseEventArgs e)
        {
            if (_drag == Drag.None) return;
            Vector d = e.GetPosition(_c) - _start;
            if (!_moved && d.Length < 3) return;
            _moved = true;
            WeV3 dv = Delta(d);
            bool ctrl = (Keyboard.Modifiers & ModifierKeys.Control) != 0, shift = (Keyboard.Modifiers & ModifierKeys.Shift) != 0;
            WeV3 dir = (_b0 - _a0).Flat().Normalized();
            if (_drag == Drag.Move)
            {
                if (shift) dv = _look0 * dv.Dot(_look0);
                _live = WeSideOverride.Line(_a0 + dv, _b0 + dv, _look0);
            }
            else
            {
                WeV3 a = _a0, b = _b0;
                if (ctrl)
                {
                    if (_drag == Drag.EndA) a = _a0 + dv; else b = _b0 + dv;
                }
                else
                {
                    double t = dv.Dot(dir);
                    if (_drag == Drag.EndA) a = _a0 + dir * t; else b = _b0 + dir * t;
                }
                WeV3 nd = (b - a).Flat();
                if (nd.Length < 0.3) return;   // ~10 см-ээс богино болохгүй
                WeV3 perp = new WeV3(-nd.Y, nd.X, 0).Normalized();
                if (perp.Dot(_look0) < 0) perp = -perp;
                _live = WeSideOverride.Line(a, b, perp);
            }
            Redraw();
        }

        private void OnUp(object sender, MouseButtonEventArgs e)
        {
            if (_drag == Drag.None) return;
            _c.ReleaseMouseCapture();
            Finish();
        }

        private void Finish()
        {
            Drag d = _drag;
            _drag = Drag.None;
            WeSideOverride ov = _live;
            _live = null;
            if (d != Drag.None && _moved && ov != null && ov.IsValid && Edited != null) Edited(_selected, ov);
            else Redraw();
        }
    }
}
