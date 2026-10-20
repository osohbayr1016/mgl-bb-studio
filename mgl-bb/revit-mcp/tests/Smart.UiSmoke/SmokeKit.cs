using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Windows.Threading;

namespace RevitMcpAddin.Smart.UiSmoke
{
    public sealed class SmokeFailed : Exception
    {
        public SmokeFailed(string m) : base(m) { }
    }

    /// <summary>WPF цонхыг Revit-гүйгээр удирдах хэрэгслүүд: мод хөндлөн гарах, товч дарах, зураг авах.</summary>
    public static class Ui
    {
        public static string OutDir
        {
            get
            {
                string d = Environment.GetEnvironmentVariable("SMOKE_OUT");
                if (string.IsNullOrWhiteSpace(d)) d = Path.Combine(Path.GetTempPath(), "smart-uismoke");
                Directory.CreateDirectory(d);
                return d;
            }
        }

        public static void True(bool c, string msg) { if (!c) throw new SmokeFailed(msg); }
        public static void Eq<T>(T expected, T actual, string msg)
        {
            if (!EqualityComparer<T>.Default.Equals(expected, actual))
                throw new SmokeFailed(msg + " — expected=" + expected + " actual=" + actual);
        }

        public static IEnumerable<T> All<T>(DependencyObject root) where T : DependencyObject
        {
            if (root == null) yield break;
            var seen = new HashSet<DependencyObject>();
            var stack = new Stack<DependencyObject>();
            stack.Push(root);
            while (stack.Count > 0)
            {
                DependencyObject cur = stack.Pop();
                if (!seen.Add(cur)) continue;
                if (cur is T) yield return (T)cur;
                if (cur is Visual || cur is System.Windows.Media.Media3D.Visual3D)
                {
                    int n = VisualTreeHelper.GetChildrenCount(cur);
                    for (int i = 0; i < n; i++) stack.Push(VisualTreeHelper.GetChild(cur, i));
                }
                foreach (object child in LogicalTreeHelper.GetChildren(cur))
                {
                    var d = child as DependencyObject;
                    if (d != null) stack.Push(d);
                }
                var tab = cur as TabControl;
                if (tab != null)
                    foreach (object it in tab.Items)
                    {
                        var d2 = it as DependencyObject;
                        if (d2 != null) stack.Push(d2);
                    }
            }
        }

        public static Button FindButton(DependencyObject root, string contains)
        {
            Button b = All<Button>(root).FirstOrDefault(x => x.Content is string && ((string)x.Content).Contains(contains));
            if (b == null) throw new SmokeFailed("Товч олдсонгүй: «" + contains + "»");
            return b;
        }

        public static ToggleButton FindToggle(DependencyObject root, string exact)
        {
            ToggleButton t = All<ToggleButton>(root).FirstOrDefault(x => x.Content is string && (string)x.Content == exact);
            if (t == null) throw new SmokeFailed("Сонголтын товч олдсонгүй: «" + exact + "»");
            return t;
        }

        /// <summary>Зайн товч (ToggleButton) дарах — `Click` үйл явдлыг бодитоор өдөөнө (Dispatcher-ээр).</summary>
        public static void ClickToggle(DependencyObject root, string exact)
        {
            ToggleButton b = FindToggle(root, exact);
            if (!b.IsEnabled) throw new SmokeFailed("Товч идэвхгүй: «" + b.Content + "»");
            Dispatcher.CurrentDispatcher.Invoke(() => b.RaiseEvent(new RoutedEventArgs(ButtonBase.ClickEvent, b)));
            Pump();
        }

        public static void Click(Button b)
        {
            if (!b.IsEnabled) throw new SmokeFailed("Товч идэвхгүй: «" + b.Content + "»");
            // Dispatcher-ээр (Revit-д товч дарахтай ижил): WPF нь DispatcherSynchronizationContext-ийг ЗӨВХӨН
            // Dispatcher-ээр дуудагдсан callback-д тавьдаг — шууд RaiseEvent нь `await`-ыг thread pool руу унагана.
            Dispatcher.CurrentDispatcher.Invoke(() => b.RaiseEvent(new RoutedEventArgs(ButtonBase.ClickEvent, b)));
            Pump();
        }

        public static void Click(DependencyObject root, string contains)
        {
            Click(FindButton(root, contains));
        }

        public static TextBlock FindText(DependencyObject root, string contains)
        {
            return All<TextBlock>(root).FirstOrDefault(t => (t.Text ?? "").Contains(contains));
        }

        public static string AllText(DependencyObject root)
        {
            return string.Join("\n", All<TextBlock>(root).Select(t => t.Text));
        }

        /// <summary>Dispatcher-ийн хүлээгдэж буй ажлыг (layout, binding, render) шавхана.</summary>
        public static void Pump()
        {
            var frame = new DispatcherFrame();
            Dispatcher.CurrentDispatcher.BeginInvoke(DispatcherPriority.ApplicationIdle, new Action(() => frame.Continue = false));
            Dispatcher.PushFrame(frame);
        }

        /// <summary>`DispatcherTimer`-тэй (debounce) цонхыг хүлээнэ.</summary>
        public static void Wait(int ms)
        {
            var until = DateTime.UtcNow.AddMilliseconds(ms);
            while (DateTime.UtcNow < until)
            {
                Pump();
                Thread.Sleep(15);
            }
            Pump();
        }

        public static void Shot(Window w, string name)
        {
            try
            {
                w.UpdateLayout();
                Pump();
                int width = (int)Math.Max(100, w.ActualWidth), height = (int)Math.Max(100, w.ActualHeight);
                var rtb = new RenderTargetBitmap(width, height, 96, 96, PixelFormats.Pbgra32);
                rtb.Render(w);
                var enc = new PngBitmapEncoder();
                enc.Frames.Add(BitmapFrame.Create(rtb));
                string path = Path.Combine(OutDir, name + ".png");
                using (var fs = File.Create(path)) enc.Save(fs);
            }
            catch (Exception ex)
            {
                Console.WriteLine("       (зураг хадгалсангүй: " + ex.GetType().Name + ")");
            }
        }

        /// <summary>Цонхыг модальгүй нээж, layout-ыг гүйцээнэ.</summary>
        public static void Open(Window w)
        {
            w.WindowStartupLocation = WindowStartupLocation.Manual;
            w.Left = 40;
            w.Top = 40;
            w.Show();
            Pump();
            w.UpdateLayout();
            Pump();
        }

        /// <summary>
        /// Модаль (ShowDialog) цонхыг ажиллуулж, нээгдсэний дараа `script`-ийг дуудна.  `script` нь цонхыг хаахаа
        /// өөрөө хариуцна (товч дарж).  Хаагдахгүй бол 15 секундийн дараа хүчээр хаана (тест гацахгүй).
        /// </summary>
        public static bool? RunModal(Window w, Action script)
        {
            Exception error = null;
            w.WindowStartupLocation = WindowStartupLocation.Manual;
            w.Left = 40;
            w.Top = 40;
            w.Loaded += (s, e) =>
            {
                Dispatcher.CurrentDispatcher.BeginInvoke(DispatcherPriority.ApplicationIdle, new Action(() =>
                {
                    try { script(); }
                    catch (Exception ex) { error = ex; }
                    if (w.IsVisible) { try { w.DialogResult = false; } catch (Exception) { w.Close(); } }
                }));
            };
            var guard = new DispatcherTimer { Interval = TimeSpan.FromSeconds(15) };
            guard.Tick += (s, e) => { guard.Stop(); if (w.IsVisible) { error = error ?? new SmokeFailed("Модаль цонх 15 с-д хаагдсангүй"); try { w.DialogResult = false; } catch (Exception) { w.Close(); } } };
            guard.Start();
            bool? result = w.ShowDialog();
            guard.Stop();
            if (error != null) throw error;
            return result;
        }
    }
}
