using System;
using System.Collections.Generic;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Interop;
using System.Windows.Media;

namespace MglBb.Infra
{
    /// <summary>
    /// Ажлын зургийн ЯВЦЫН цонх — modeless (Revit-ийн цонхонд эзэмшүүлсэн, Revit-ийг түгжихгүй).  Revit-ийн API дуудахгүй: товч нь зөвхөн
    /// хүсэлт (<see cref="StopRequested"/>, <see cref="OpenFirst"/>, <see cref="OpenExcel"/>) өгнө — гүйцэтгэгч ExternalEvent-ээр биелүүлнэ.
    /// </summary>
    internal sealed class BbProgressWindow
    {
        private readonly Window _w;
        private readonly ProgressBar _bar = new ProgressBar { Height = 16, Margin = new Thickness(0, 6, 0, 4) };
        private readonly TextBlock _current = new TextBlock { TextWrapping = TextWrapping.Wrap, FontWeight = FontWeights.SemiBold };
        private readonly TextBlock _hint = new TextBlock { TextWrapping = TextWrapping.Wrap, Foreground = Brushes.DimGray, Margin = new Thickness(0, 0, 0, 8) };
        private readonly ListBox _log = new ListBox { Height = 240, Margin = new Thickness(0, 6, 0, 0) };
        private readonly Button _stop, _first, _excel, _close;
        private bool _done;

        public bool StopRequested { get; private set; }
        public bool IsOpen { get; private set; }

        /// <summary>«Эхний зургийг нээх» — гүйцэтгэгч ExternalEvent-ээр нээнэ.</summary>
        public event EventHandler OpenFirst;
        public event EventHandler OpenExcel;

        public BbProgressWindow(string title, int total, string source)
        {
            _w = new Window
            {
                Title = title,
                Width = 560,
                SizeToContent = SizeToContent.Height,
                ResizeMode = ResizeMode.CanMinimize,
                WindowStartupLocation = WindowStartupLocation.CenterOwner,
                ShowInTaskbar = false,
                FontFamily = new FontFamily("Segoe UI"),
                FontSize = 13,
            };
            var root = new DockPanel { Margin = new Thickness(16) };
            var buttons = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Right, Margin = new Thickness(0, 12, 0, 0) };
            DockPanel.SetDock(buttons, Dock.Bottom);
            _first = Btn("Эхний зургийг нээх", false);
            _excel = Btn("«Асуудал – Шийдэл» нээх", false);
            _stop = Btn("Зогсоох", true);
            _close = Btn("Хаах", true);
            _first.Visibility = Visibility.Collapsed;
            _excel.Visibility = Visibility.Collapsed;
            _stop.Click += (s, e) => RequestStop();
            _first.Click += (s, e) => OpenFirst?.Invoke(this, EventArgs.Empty);
            _excel.Click += (s, e) => OpenExcel?.Invoke(this, EventArgs.Empty);
            _close.Click += (s, e) => _w.Close();
            foreach (Button b in new[] { _first, _excel, _stop, _close }) buttons.Children.Add(b);
            root.Children.Add(buttons);

            var body = new StackPanel();
            _hint.Text = "Гишүүн бүрийн хооронд Revit чөлөөлөгдөнө — загвар дээр үргэлжлүүлэн ажиллаж болно (харагдац нээх, элемент засах …).  " +
                         "Гишүүн бүр өөрийн Ctrl+Z-тэй.  " + (source ?? "");
            body.Children.Add(_hint);
            body.Children.Add(_current);
            _bar.Maximum = Math.Max(1, total);
            body.Children.Add(_bar);
            body.Children.Add(_log);
            root.Children.Add(body);
            _w.Content = root;
            _w.Closing += (s, e) => { if (!_done) RequestStop(); IsOpen = false; };
        }

        private static Button Btn(string text, bool enabled)
        {
            return new Button { Content = text, MinWidth = 90, Padding = new Thickness(10, 4, 10, 4), Margin = new Thickness(8, 0, 0, 0), IsEnabled = enabled };
        }

        private void RequestStop()
        {
            if (_done || StopRequested) return;
            StopRequested = true;
            _stop.IsEnabled = false;
            _current.Text = "Зогсооход бэлэн — одоогийн гишүүн дуусмагц зогсоно…";
        }

        public void Show(IntPtr owner)
        {
            try { if (owner != IntPtr.Zero) new WindowInteropHelper(_w).Owner = owner; } catch { }
            IsOpen = true;
            _w.Show();
        }

        /// <param name="index">0-ээс — одоо эхэлж буй гишүүн.</param>
        public void Working(int index, int total, string text)
        {
            if (!StopRequested) _current.Text = (index + 1) + " / " + total + " — " + text + " …";
            _bar.Value = index;
        }

        public void Line(string text)
        {
            _log.Items.Add(new TextBlock { Text = text, TextWrapping = TextWrapping.Wrap, MaxWidth = _w.Width - 70 });
            _log.ScrollIntoView(_log.Items[_log.Items.Count - 1]);
        }

        public void Complete(string instruction, IEnumerable<string> lines, bool canOpenFirst, bool hasExcel)
        {
            _done = true;
            _bar.Value = _bar.Maximum;
            _current.Text = instruction;
            Line("────────");
            foreach (string l in lines) if (!string.IsNullOrEmpty(l)) Line(l);
            _stop.Visibility = Visibility.Collapsed;
            _first.Visibility = canOpenFirst ? Visibility.Visible : Visibility.Collapsed;
            _first.IsEnabled = canOpenFirst;
            _excel.Visibility = hasExcel ? Visibility.Visible : Visibility.Collapsed;
            _excel.IsEnabled = hasExcel;
            _close.IsDefault = true;
            try { if (_w.WindowState == WindowState.Minimized) _w.WindowState = WindowState.Normal; _w.Activate(); } catch { }
        }
    }
}
