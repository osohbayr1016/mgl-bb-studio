using System;
using System.Collections.Generic;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Interop;
using System.Windows.Media;

namespace MglBb.Infra
{
    /// <summary>
    /// Кодоор угсардаг энгийн WPF харилцах цонх (XAML-гүй — R24 net48 ба R25+ net8/10 хоёуланд ижил).  Үндсэн plugin-ий UI санг ХЭРЭГЛЭХГҮЙ
    /// (тусдаа байлгах шаардлага).  Revit-ийн үндсэн цонхонд эзэмшүүлж modal харуулна.
    /// </summary>
    internal sealed class BbDialog
    {
        private readonly Window _w;
        private readonly StackPanel _body;

        public BbDialog(string title, string header, double width = 520)
        {
            _w = new Window
            {
                Title = title,
                Width = width,
                SizeToContent = SizeToContent.Height,
                ResizeMode = ResizeMode.NoResize,
                WindowStartupLocation = WindowStartupLocation.CenterOwner,
                ShowInTaskbar = false,
                FontFamily = new FontFamily("Segoe UI"),
                FontSize = 13,
            };
            var root = new DockPanel { Margin = new Thickness(16) };
            var buttons = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Right, Margin = new Thickness(0, 14, 0, 0) };
            DockPanel.SetDock(buttons, Dock.Bottom);
            var ok = new Button { Content = "Эхлүүлэх", MinWidth = 96, Padding = new Thickness(10, 4, 10, 4), IsDefault = true, Margin = new Thickness(0, 0, 8, 0) };
            var cancel = new Button { Content = "Болих", MinWidth = 96, Padding = new Thickness(10, 4, 10, 4), IsCancel = true };
            ok.Click += (s, e) => { _w.DialogResult = true; };
            buttons.Children.Add(ok);
            buttons.Children.Add(cancel);
            OkButton = ok;
            root.Children.Add(buttons);
            _body = new StackPanel();
            if (!string.IsNullOrEmpty(header))
                _body.Children.Add(new TextBlock { Text = header, TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 0, 0, 10) });
            root.Children.Add(_body);
            _w.Content = root;
        }

        public Button OkButton { get; private set; }

        /// <summary>Аль товчоор хаасан (<see cref="ResultButton"/>-ийн код; «Эхлүүлэх» = 0).</summary>
        public int ResultCode { get; private set; }

        /// <summary>Цонхыг хааж <see cref="ResultCode"/>-д кодыг өгдөг нэмэлт товч («Болих»-ын зүүн талд).</summary>
        public Button ResultButton(string text, int code)
        {
            var b = new Button { Content = text, MinWidth = 96, Padding = new Thickness(10, 4, 10, 4), Margin = new Thickness(0, 0, 8, 0) };
            b.Click += (s, e) => { ResultCode = code; _w.DialogResult = true; };
            var panel = (StackPanel)OkButton.Parent;
            panel.Children.Insert(panel.Children.IndexOf(OkButton), b);
            return b;
        }

        /// <summary>
        /// Сонгох боломжтой жагсаалт (олон сонголт).  <paramref name="search"/> бол дээр нь хайлтын мөр: үг бүр (зайгаар) нэрэнд байх мөрүүд л харагдана,
        /// нуугдсан мөрийн СОНГОЛТ хэвээр (хайлтаа сольж олон бүлгээс сонгож болно).  Мөрүүд <c>Items</c>-д хэвээр — индекс өөрчлөгдөхгүй.
        /// </summary>
        public ListBox Picker(IEnumerable<string> items, double height = 220, bool search = false)
        {
            var lb = new ListBox { Height = height, SelectionMode = SelectionMode.Extended, Margin = new Thickness(0, 2, 0, 4) };
            VirtualizingStackPanel.SetIsVirtualizing(lb, false);    // нуух/харуулах нь мөр бүрийн container-оор
            var texts = new List<string>();
            foreach (string s in items)
            {
                texts.Add(s ?? "");
                lb.Items.Add(new ListBoxItem { Content = new TextBlock { Text = s, TextWrapping = TextWrapping.Wrap, MaxWidth = _w.Width - 70 } });
            }
            if (search)
            {
                var row = new DockPanel { Margin = new Thickness(0, 2, 0, 2) };
                var l = new TextBlock { Text = "Хайх:", Width = 50, VerticalAlignment = VerticalAlignment.Center };
                DockPanel.SetDock(l, Dock.Left);
                var count = new TextBlock { Foreground = Brushes.DimGray, Margin = new Thickness(8, 0, 0, 0), VerticalAlignment = VerticalAlignment.Center };
                DockPanel.SetDock(count, Dock.Right);
                var box = new TextBox();
                Action update = () =>
                {
                    string[] words = (box.Text ?? "").Split(new[] { ' ' }, StringSplitOptions.RemoveEmptyEntries);
                    int shown = 0;
                    for (int i = 0; i < lb.Items.Count; i++)
                    {
                        bool ok = words.All(w => texts[i].IndexOf(w, StringComparison.CurrentCultureIgnoreCase) >= 0);
                        ((ListBoxItem)lb.Items[i]).Visibility = ok ? Visibility.Visible : Visibility.Collapsed;
                        if (ok) shown++;
                    }
                    count.Text = shown + " / " + lb.Items.Count + " · сонгосон " + lb.SelectedItems.Count;
                };
                box.TextChanged += (s, e) => update();
                lb.SelectionChanged += (s, e) => update();
                row.Children.Add(l);
                row.Children.Add(count);
                row.Children.Add(box);
                _body.Children.Add(row);
                _w.Loaded += (s, e) => { update(); box.Focus(); };
            }
            _body.Children.Add(lb);
            return lb;
        }

        public void Section(string title)
        {
            _body.Children.Add(new TextBlock { Text = title, FontWeight = FontWeights.SemiBold, Margin = new Thickness(0, 10, 0, 4) });
        }

        public TextBlock Note(string text, bool muted = true)
        {
            var t = new TextBlock { Text = text, TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 2, 0, 2) };
            if (muted) t.Foreground = Brushes.DimGray;
            _body.Children.Add(t);
            return t;
        }

        public TextBox List(IEnumerable<string> lines, double height = 120)
        {
            var tb = new TextBox
            {
                Text = string.Join(Environment.NewLine, lines),
                IsReadOnly = true,
                Height = height,
                VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
                HorizontalScrollBarVisibility = ScrollBarVisibility.Auto,
                FontFamily = new FontFamily("Consolas, Segoe UI"),
                Margin = new Thickness(0, 2, 0, 4),
            };
            _body.Children.Add(tb);
            return tb;
        }

        public CheckBox Check(string label, bool value, string tip = null)
        {
            var c = new CheckBox { Content = label, IsChecked = value, Margin = new Thickness(0, 3, 0, 3) };
            if (!string.IsNullOrEmpty(tip)) c.ToolTip = tip;
            _body.Children.Add(c);
            return c;
        }

        public ComboBox Combo(string label, IList<string> items, int selected)
        {
            var row = new DockPanel { Margin = new Thickness(0, 3, 0, 3) };
            var l = new TextBlock { Text = label, Width = 190, VerticalAlignment = VerticalAlignment.Center };
            DockPanel.SetDock(l, Dock.Left);
            var cb = new ComboBox();
            foreach (string s in items) cb.Items.Add(s);
            cb.SelectedIndex = Math.Max(0, Math.Min(items.Count - 1, selected));
            row.Children.Add(l);
            row.Children.Add(cb);
            _body.Children.Add(row);
            return cb;
        }

        public bool Show(IntPtr owner)
        {
            try { if (owner != IntPtr.Zero) new WindowInteropHelper(_w).Owner = owner; } catch { }
            return _w.ShowDialog() == true;
        }
    }
}
