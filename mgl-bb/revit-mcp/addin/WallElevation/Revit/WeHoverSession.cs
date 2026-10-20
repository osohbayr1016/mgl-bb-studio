using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Threading;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;
using RevitMcpAddin.WallElevation.Core;
using WpfColor = System.Windows.Media.Color;

namespace RevitMcpAddin.WallElevation.Revit
{
    /// <summary>
    /// Өрөө сонгох үеийн КУРСОР ДООРХ ТОДРУУЛГА (2026-10-14, эзэн: «хэрэгслээ сонгоод өрөөнд ойртуулахад тэр өрөө бүх хүрээгээрээ тодорч,
    /// аль хүрээгээр дуудагдаж байгааг танидаг болго»; «олон өрөө сонгоход байршлыг нь харуул»).
    ///
    /// Revit-д курсор хөдлөх үйл явдал байхгүй тул: PickPoint-ын ӨМНӨ өрөөнүүдийн хилийг нэг удаа индексэлнэ (<see cref="WeRoomPicker.HoverIndex"/>),
    /// дараа нь WPF таймер (60 мс) курсорын байрлалыг (Win32) харагдацын координат болгож, доорх өрөөг дарахтай ИЖИЛ дүрмээр олж,
    /// DirectContext3D-ээр (<see cref="WeRoomOverlay"/>) хилийг нь тодруулна + курсорын хажууд нэрийг нь.  Загварт юу ч бичихгүй.
    /// Ямар нэг алхам унавал тодруулга зогсож, сонголт хэвээр ажиллана (<see cref="WeRoomPicker.At"/>).
    /// </summary>
    internal sealed class WeHoverSession : IDisposable
    {
        private const int TickMs = 60;
        private static readonly byte[] HoverRgb = { 0xF2, 0x7A, 0x1A };
        private static readonly byte[] SelectedRgb = { 0x1E, 0x6F, 0xD9 };

        private readonly UIDocument _uidoc;
        private readonly List<WeHoverRoom> _rooms;
        private readonly Func<IEnumerable<string>> _selected;
        private readonly double _band;
        private readonly string _docKey;
        private readonly long _viewId;
        private readonly WeV3 _right, _up;
        private UIView _uiview;
        private DispatcherTimer _timer;
        private HoverTip _tip;
        private int _left, _top, _rightPx, _bottom;
        private WeV3 _c0, _c1;
        private string _lastKey = "\u0000", _lastSel = "\u0000";
        private bool _busy, _warnedApi, _warnedRefresh, _disposed, _shown;
        private int _ticks, _swaps;

        private WeHoverSession(UIDocument uidoc, View active, List<WeHoverRoom> rooms, double band, Func<IEnumerable<string>> selected)
        {
            _uidoc = uidoc;
            _rooms = rooms;
            _band = band;
            _selected = selected;
            _docKey = WeRoomOverlay.DocKey(uidoc.Document);
            _viewId = active.Id.Value;
            _right = new WeV3(active.RightDirection.X, active.RightDirection.Y, active.RightDirection.Z);
            _up = new WeV3(active.UpDirection.X, active.UpDirection.Y, active.UpDirection.Z);
        }

        /// <summary>Эхлүүлнэ (API-ийн орчинд, PickPoint-ын ӨМНӨ).  Боломжгүй бол null — сонголт тодруулгагүй үргэлжилнэ.</summary>
        internal static WeHoverSession TryStart(UIDocument uidoc, Func<IEnumerable<string>> selected = null)
        {
            try
            {
                if (uidoc == null) return null;
                View active = uidoc.ActiveView;
                if (!WeRoomPicker.Supports(active)) return null;
                var sw = Stopwatch.StartNew();
                double band;
                List<WeHoverRoom> rooms = WeRoomPicker.HoverIndex(uidoc.Document, active, out band);
                WeLog.Info("hover", "индекс: " + rooms.Count + " өрөө, " + sw.ElapsedMilliseconds + " мс («" + active.Name + "»)");
                if (rooms.Count == 0) return null;
                var s = new WeHoverSession(uidoc, active, rooms, band, selected);
                s._uiview = uidoc.GetOpenUIViews().FirstOrDefault(u => u.ViewId == active.Id);
                if (s._uiview == null || !s.ReadView()) { WeLog.Info("hover", "UIView олдсонгүй — тодруулгагүй"); return null; }
                if (!WeRoomOverlay.Show(uidoc.Document, active.Id, s.Layers(null))) return null;
                WeRoomOverlay.Refresh(uidoc);
                s._tip = new HoverTip();
                s._timer = new DispatcherTimer(DispatcherPriority.Normal) { Interval = TimeSpan.FromMilliseconds(TickMs) };
                s._timer.Tick += (o, e) => s.Tick();
                s._timer.Start();
                return s;
            }
            catch (Exception ex)
            {
                WeLog.Info("hover", "эхлүүлж чадсангүй — " + ex.Message);
                return null;
            }
        }

        /// <summary>UIView-ийн цонх ба харагдах мужийг уншина (pan/zoom дагана).  API унавал өмнөх утга хэвээр.</summary>
        private bool ReadView()
        {
            try
            {
                Rectangle r = _uiview.GetWindowRectangle();
                IList<XYZ> c = _uiview.GetZoomCorners();
                if (c == null || c.Count < 2) return false;
                _left = r.Left; _top = r.Top; _rightPx = r.Right; _bottom = r.Bottom;
                _c0 = new WeV3(c[0].X, c[0].Y, c[0].Z);
                _c1 = new WeV3(c[1].X, c[1].Y, c[1].Z);
                return true;
            }
            catch (Exception ex)
            {
                if (!_warnedApi) { _warnedApi = true; WeLog.Info("hover", "харагдацын муж уншигдсангүй (сүүлийн утгаар) — " + ex.Message); }
                return false;
            }
        }

        private void Tick()
        {
            if (_busy || _disposed) return;
            _busy = true;
            try
            {
                _ticks++;
                ReadView();
                POINT pt;
                if (!GetCursorPos(out pt)) return;
                WeV3? p = WeHoverGeometry.ScreenToView(pt.X, pt.Y, _left, _top, _rightPx, _bottom, _c0, _c1, _right, _up);
                WeHoverRoom h = p.HasValue ? WeHoverGeometry.At(_rooms, p.Value.X, p.Value.Y) : null;
                string key = h != null ? h.Candidate.Key : string.Empty;
                string sel = _selected != null ? string.Join("|", _selected() ?? Enumerable.Empty<string>()) : string.Empty;
                if (key != _lastKey || sel != _lastSel)
                {
                    _lastKey = key;
                    _lastSel = sel;
                    WeRoomOverlay.Swap(_docKey, _viewId, Layers(h));
                    _swaps++;
                    if (!WeRoomOverlay.Refresh(_uidoc) && !_warnedRefresh)
                    {
                        _warnedRefresh = true;
                        WeLog.Info("hover", "RefreshActiveView сонголтын үед хориотой — Revit дараагийн зурагт харуулна");
                    }
                    if (h != null) WeLog.Info("hover", "→ " + h.Caption);
                }
                if (_tip != null) _tip.Place(h != null ? h.Caption : null, pt.X, pt.Y);
                _shown |= h != null;
            }
            catch (Exception ex)
            {
                WeLog.Info("hover", "тодруулга зогсов — " + ex.Message);
                Stop();
            }
            finally { _busy = false; }
        }

        private List<WeOverlayLayer> Layers(WeHoverRoom hover)
        {
            var layers = new List<WeOverlayLayer>();
            var selKeys = new HashSet<string>(_selected != null ? (_selected() ?? Enumerable.Empty<string>()) : Enumerable.Empty<string>(), StringComparer.Ordinal);
            if (selKeys.Count > 0)
            {
                var fill = new WeOverlayLayer { R = SelectedRgb[0], G = SelectedRgb[1], B = SelectedRgb[2], Transparency = 0.8 };
                var band = new WeOverlayLayer { R = SelectedRgb[0], G = SelectedRgb[1], B = SelectedRgb[2], Transparency = 0.1 };
                foreach (WeHoverRoom r in _rooms.Where(r => selKeys.Contains(r.Candidate.Key)))
                {
                    WeHoverGeometry.Fill(r, fill);
                    WeHoverGeometry.Band(r, _band, band);
                }
                layers.Add(fill);
                layers.Add(band);
            }
            if (hover != null)
            {
                var fill = new WeOverlayLayer { R = HoverRgb[0], G = HoverRgb[1], B = HoverRgb[2], Transparency = 0.72 };
                var band = new WeOverlayLayer { R = HoverRgb[0], G = HoverRgb[1], B = HoverRgb[2], Transparency = 0 };
                WeHoverGeometry.Fill(hover, fill);
                WeHoverGeometry.Band(hover, _band * 1.5, band);
                layers.Add(fill);
                layers.Add(band);
            }
            return layers;
        }

        private void Stop()
        {
            try { if (_timer != null) _timer.Stop(); } catch { }
            _timer = null;
            try { if (_tip != null) _tip.Close(); } catch { }
            _tip = null;
        }

        public void Dispose()
        {
            if (_disposed) return;
            _disposed = true;
            Stop();
            WeRoomOverlay.Hide();
            WeRoomOverlay.Refresh(_uidoc);
            WeRoomOverlay.Shutdown();
            WeLog.Info("hover", "дуусав · " + _ticks + " шалгалт, " + _swaps + " солилт, тодруулсан " + (_shown ? "тийм" : "үгүй"));
        }

        // ── Курсорын хажуугийн шошго ───────────────────────────────────

        private sealed class HoverTip
        {
            private readonly Window _w;
            private readonly TextBlock _text;
            private IntPtr _hwnd;
            private string _last;

            public HoverTip()
            {
                _text = new TextBlock { Foreground = Brushes.White, FontSize = 12, Margin = new Thickness(8, 4, 8, 5) };
                var border = new Border
                {
                    Background = new SolidColorBrush(WpfColor.FromArgb(0xE6, 0x2A, 0x2D, 0x34)),
                    BorderBrush = new SolidColorBrush(WpfColor.FromRgb(HoverRgb[0], HoverRgb[1], HoverRgb[2])),
                    BorderThickness = new Thickness(0, 0, 0, 2),
                    CornerRadius = new CornerRadius(3),
                    Child = _text,
                };
                _w = new Window
                {
                    WindowStyle = WindowStyle.None, AllowsTransparency = true, Background = Brushes.Transparent, Topmost = true,
                    ShowInTaskbar = false, ShowActivated = false, Focusable = false, IsHitTestVisible = false, ResizeMode = ResizeMode.NoResize,
                    SizeToContent = SizeToContent.WidthAndHeight, Content = border, Left = -10000, Top = -10000,
                };
                _w.SourceInitialized += (s, e) =>
                {
                    _hwnd = new WindowInteropHelper(_w).Handle;
                    int ex = GetWindowLong(_hwnd, GWL_EXSTYLE);
                    SetWindowLong(_hwnd, GWL_EXSTYLE, ex | WS_EX_NOACTIVATE | WS_EX_TRANSPARENT | WS_EX_TOOLWINDOW);
                };
            }

            public void Place(string caption, int x, int y)
            {
                if (string.IsNullOrEmpty(caption))
                {
                    if (_w.IsVisible) _w.Hide();
                    _last = null;
                    return;
                }
                if (caption != _last) { _text.Text = caption + "\nДарж сонгоно"; _last = caption; }
                if (!_w.IsVisible) _w.Show();
                if (_hwnd != IntPtr.Zero) SetWindowPos(_hwnd, HWND_TOPMOST, x + 18, y + 22, 0, 0, SWP_NOSIZE | SWP_NOACTIVATE);
            }

            public void Close() { try { _w.Close(); } catch { } }
        }

        // ── Win32 ───────────────────────────────────────────────────────

        [StructLayout(LayoutKind.Sequential)] private struct POINT { public int X, Y; }
        [DllImport("user32.dll")] private static extern bool GetCursorPos(out POINT p);
        [DllImport("user32.dll")] private static extern int GetWindowLong(IntPtr h, int i);
        [DllImport("user32.dll")] private static extern int SetWindowLong(IntPtr h, int i, int v);
        [DllImport("user32.dll")] private static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
        private const int GWL_EXSTYLE = -20, WS_EX_NOACTIVATE = 0x08000000, WS_EX_TRANSPARENT = 0x20, WS_EX_TOOLWINDOW = 0x80;
        private const uint SWP_NOSIZE = 0x1, SWP_NOACTIVATE = 0x10;
        private static readonly IntPtr HWND_TOPMOST = new IntPtr(-1);
    }
}
