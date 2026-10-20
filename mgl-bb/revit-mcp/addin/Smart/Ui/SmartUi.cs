using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.CompilerServices;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;

namespace RevitMcpAddin.Smart.Ui
{
    /// <summary>
    /// «MGL Smart»-ын цонхнуудын ДУНДЫН WPF туслах — кодоор угсарсан (XAML-гүй; `CloneDrawingsDialog`-ийн
    /// ижил хэв маяг), системийн анхдагч загвар.  Өнгө нь утга учиртай (ноцтой байдал) үед л.
    /// </summary>
    internal static class UiKit
    {
        // ⚠️ Өнгө нь `Ui/MglBrushes` (сэдэв солигдоход шинэчлэгддэг live brush) — тогтмол (190,40,40) г.м. харанхуй сэдэвт
        // уншигдахгүй байв.  Ноцтой байдал өнгөөр ГАНЦААРАА биш: дуудагч бичвэрт «⛔ ⚠ ℹ» тэмдэг, үг хамт бичнэ.
        internal static Brush BlockingBrush { get { return global::RevitMcpAddin.Ui.MglBrushes.Danger; } }
        internal static Brush WarningBrush { get { return global::RevitMcpAddin.Ui.MglBrushes.Warn; } }
        internal static Brush InfoBrush { get { return global::RevitMcpAddin.Ui.MglBrushes.Info; } }
        internal static Brush OkBrush { get { return global::RevitMcpAddin.Ui.MglBrushes.Ok; } }
        internal static Brush MutedBrush { get { return global::RevitMcpAddin.Ui.MglBrushes.FgMuted; } }
        internal static Brush FgBrush { get { return global::RevitMcpAddin.Ui.MglBrushes.Fg; } }
        /// <summary>Хүснэгтийн шугам, самбарын хүрээ (декоратив — удирдлагын хүрээ биш).</summary>
        internal static Brush LineBrush { get { return global::RevitMcpAddin.Ui.MglBrushes.Line; } }
        /// <summary>Хүснэгтийн сондгой мөрийн дэвсгэр.</summary>
        internal static Brush AltRowBrush { get { return global::RevitMcpAddin.Ui.MglBrushes.Bg; } }

        /// <summary>
        /// Smart цонх бүрийн ҮНДСЭН бэлтгэл: ЭЗЭН дэлгэцийн ажлын талбарт багтаах (хэмжээг цонх өөрөө өмнө нь тохируулсан —
        /// <c>MglWindow.Adopt</c>, хил хадгалагдана) + дундын сэдэв (Light/Dark/өндөр контраст).  Конструкторын хэмжээ тавьсны ДАРАА дууд.
        /// </summary>
        internal static void Prepare(Window w, string key)
        {
            global::RevitMcpAddin.Ui.MglWindow.Adopt(w, key);
            global::RevitMcpAddin.Ui.MglTheme.Apply(w, 12);
        }

        internal static TextBlock Text(string text, bool bold = false, Brush brush = null, bool wrap = false)
        {
            var t = new TextBlock { Text = text, VerticalAlignment = VerticalAlignment.Center };
            if (bold) t.FontWeight = FontWeights.SemiBold;
            if (brush != null) t.Foreground = brush;
            if (wrap) t.TextWrapping = TextWrapping.Wrap;
            return t;
        }

        internal static Button Btn(string text, RoutedEventHandler onClick, double minWidth = 0)
        {
            var b = new Button { Content = text, Padding = new Thickness(10, 3, 10, 3), Margin = new Thickness(2) };
            if (minWidth > 0) b.MinWidth = minWidth;
            if (onClick != null) b.Click += onClick;
            return b;
        }

        internal static CheckBox Check(string text, bool isChecked = false, RoutedEventHandler onChanged = null)
        {
            var c = new CheckBox { Content = text, IsChecked = isChecked, Margin = new Thickness(2, 3, 2, 3), VerticalAlignment = VerticalAlignment.Center };
            if (onChanged != null) { c.Checked += onChanged; c.Unchecked += onChanged; }
            return c;
        }

        internal static ComboBox Combo(IEnumerable<string> items, string selected = null, double minWidth = 140)
        {
            var c = new ComboBox { MinWidth = minWidth, Margin = new Thickness(2) };
            foreach (string s in items) c.Items.Add(s);
            if (selected != null) c.SelectedItem = selected;
            return c;
        }

        internal static TextBox Box(string text = "", double minWidth = 0, bool multiline = false)
        {
            var t = new TextBox { Text = text ?? "", Margin = new Thickness(2), VerticalContentAlignment = VerticalAlignment.Center };
            if (minWidth > 0) t.MinWidth = minWidth;
            if (multiline)
            {
                t.AcceptsReturn = true;
                t.TextWrapping = TextWrapping.Wrap;
                t.VerticalScrollBarVisibility = ScrollBarVisibility.Auto;
                t.VerticalContentAlignment = VerticalAlignment.Top;
            }
            return t;
        }

        internal static StackPanel Row(params UIElement[] children)
        {
            var p = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 2, 0, 2) };
            foreach (UIElement c in children) p.Children.Add(c);
            return p;
        }

        /// <summary>Тэнхлэг хөндлөн дүүрвэл ДАРААГИЙН МӨР руу шилжих мөр — нарийн самбарт хэт олон хяналт багтахгүй үед.</summary>
        internal static WrapPanel Wrap(params UIElement[] children)
        {
            var p = new WrapPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 2, 0, 2) };
            foreach (UIElement c in children) p.Children.Add(c);
            return p;
        }

        internal static StackPanel Col(params UIElement[] children)
        {
            var p = new StackPanel { Orientation = Orientation.Vertical };
            foreach (UIElement c in children) p.Children.Add(c);
            return p;
        }

        internal static GroupBox Section(string header, UIElement body)
        {
            return new GroupBox { Header = header, Content = body, Margin = new Thickness(0, 4, 0, 4), Padding = new Thickness(6) };
        }

        /// <summary>Шошго + талбар хос (`Grid` 2 багана) — маягтын мөр.</summary>
        internal static Grid Form(params KeyValuePair<string, UIElement>[] rows)
        {
            var g = new Grid { Margin = new Thickness(0, 2, 0, 2) };
            g.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(190) });
            g.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            int r = 0;
            foreach (var kv in rows)
            {
                g.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
                TextBlock label = Text(kv.Key);
                label.Margin = new Thickness(2, 4, 8, 4);
                label.VerticalAlignment = VerticalAlignment.Top;
                Grid.SetRow(label, r);
                g.Children.Add(label);
                Grid.SetRow(kv.Value, r);
                Grid.SetColumn(kv.Value, 1);
                g.Children.Add(kv.Value);
                r++;
            }
            return g;
        }

        internal static KeyValuePair<string, UIElement> F(string label, UIElement element)
        {
            return new KeyValuePair<string, UIElement>(label, element);
        }

        internal static Brush SeverityBrush(string severityName)
        {
            switch (severityName)
            {
                case "Blocking": return BlockingBrush;
                case "Warning": return WarningBrush;
                default: return InfoBrush;
            }
        }
    }

    /// <summary>
    /// UI thread руу ЭНГИЙН БА ХАТУУ маршалл.  `await`-ын дараах үргэлжлэл ердийн WPF-д UI thread дээр
    /// буцдаг ч (DispatcherSynchronizationContext), Revit-ийн message loop-оос эсвэл `SynchronizationContext`
    /// байхгүй газраас дуудагдсан бол thread pool дээр унаж «өөр thread эзэмшдэг» алдаа өгдөг.  Тиймээс
    /// await-ын ДАРАА UI-д хүрэх БҮХ код энд дамжина.
    /// </summary>
    /// <summary>
    /// Нэг синхрон ажлын (гаргалт, шинжилгээ) туршид Revit-ийн үндсэн цонхыг ИДЭВХГҮЙ болгоно (`WS_DISABLED`).
    ///
    /// ⚠️ ЯАГААД: ажил `Execute` дотор синхроноор явж, цонхыг `UiPump.DoEvents()`-ээр л шинэчилдэг.  Revit-ийн үндсэн цонх идэвхтэй
    /// байвал ажлын явцад дарсан товч/товчлуур дараалалд хуримтлагдаж, ДАРАА нь Revit-д (Execute дотор) хэрэгжинэ.  `ShowDialog` өөрөө
    /// ингэж owner-ыг хаадаг; бид `Show()` хэрэглэдэг тул гараар.  `Dispose` нь ӨМНӨХ төлөвийг сэргээнэ.
    /// </summary>
    internal sealed class OwnerLock : IDisposable
    {
        [System.Runtime.InteropServices.DllImport("user32.dll")]
        private static extern bool EnableWindow(IntPtr hWnd, bool bEnable);
        [System.Runtime.InteropServices.DllImport("user32.dll")]
        private static extern bool IsWindowEnabled(IntPtr hWnd);

        private readonly IntPtr _hwnd;
        private readonly bool _wasEnabled;

        public OwnerLock(IntPtr hwnd)
        {
            _hwnd = hwnd;
            if (hwnd == IntPtr.Zero) return;
            try
            {
                _wasEnabled = IsWindowEnabled(hwnd);
                if (_wasEnabled) EnableWindow(hwnd, false);
            }
            catch (Exception) { _wasEnabled = false; }
        }

        public void Dispose()
        {
            if (_hwnd == IntPtr.Zero || !_wasEnabled) return;
            try { EnableWindow(_hwnd, true); } catch (Exception) { }
        }
    }

    internal static class UiThread
    {
        /// <summary>Тестэд л: UI-ийн алдааг ЗАЛГИХГҮЙ дамжуулна (smoke тест бодит алдааг харахын тулд).</summary>
        public static bool ThrowOnError { get; set; }

        /// <summary>
        /// ⚠️ `await`-ын дараах UI код ЭНД ороход шидсэн алдаа thread pool руу (хаана ч баригдахгүй) гарч Revit-ийг
        /// унагаж болно — тиймээс энд ЗААВАЛ барьж логлоно.  Алдаатай UI шинэчлэл алдагдаж болох ч Revit унахгүй.
        /// </summary>
        public static void Run(System.Windows.Threading.Dispatcher d, Action a)
        {
            Action safe = () =>
            {
                try { a(); }
                catch (Exception ex)
                {
                    RevitMcpAddin.Smart.Core.SmartLog.Error("ui", "dispatch_failed", ex);
                    if (ThrowOnError) throw;
                }
            };
            if (d.CheckAccess()) safe();
            else d.Invoke(safe);
        }

        public static IProgress<T> Progress<T>(System.Windows.Threading.Dispatcher d, Action<T> handler)
        {
            return new DispatcherProgress<T>(d, handler);
        }

        private sealed class DispatcherProgress<T> : IProgress<T>
        {
            private readonly System.Windows.Threading.Dispatcher _d;
            private readonly Action<T> _h;
            public DispatcherProgress(System.Windows.Threading.Dispatcher d, Action<T> h) { _d = d; _h = h; }
            public void Report(T value)
            {
                // Прогрессийн handler-ийн алдаа dispatcher-ийг (Revit-ийн UI thread) унагаж болохгүй.
                Action run = () =>
                {
                    try { _h(value); }
                    catch (Exception ex)
                    {
                        RevitMcpAddin.Smart.Core.SmartLog.Error("ui", "progress_failed", ex);
                        if (ThrowOnError) throw;
                    }
                };
                if (_d.CheckAccess()) run();
                else _d.BeginInvoke(run);
            }
        }
    }

    /// <summary>`INotifyPropertyChanged`-ийн хамгийн бага суурь — DataGrid-ийн мөр.</summary>
    internal abstract class NotifyBase : INotifyPropertyChanged
    {
        public event PropertyChangedEventHandler PropertyChanged;

        protected void Raise([CallerMemberName] string name = null)
        {
            PropertyChangedEventHandler h = PropertyChanged;
            if (h != null) h(this, new PropertyChangedEventArgs(name));
        }

        protected bool Set<T>(ref T field, T value, [CallerMemberName] string name = null)
        {
            if (EqualityComparer<T>.Default.Equals(field, value)) return false;
            field = value;
            Raise(name);
            return true;
        }
    }

    /// <summary>Хавтас сонгох — `Microsoft.Win32.OpenFolderDialog` (.NET 8+ WPF; WinForms хэрэггүй).</summary>
    internal static class FolderPicker
    {
        internal static string Pick(Window owner, string initial, string title)
        {
            try
            {
                var dlg = new Microsoft.Win32.OpenFolderDialog { Title = title, Multiselect = false };
                if (!string.IsNullOrWhiteSpace(initial) && System.IO.Directory.Exists(initial)) dlg.InitialDirectory = initial;
                return dlg.ShowDialog(owner) == true ? dlg.FolderName : null;
            }
            catch (Exception)
            {
                return null;
            }
        }
    }
}
