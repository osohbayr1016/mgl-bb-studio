using System;
using System.Collections.Generic;
using System.IO;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Windows.Threading;

namespace RevitMcpAddin.SheetNumerator.UiSmoke
{
    internal sealed class SmokeFailed : Exception
    {
        public SmokeFailed(string message) : base(message) { }
    }

    /// <summary>Smoke туслахууд: dispatcher «шахах», async хүлээх, шалгалт, PNG зураг.</summary>
    internal static class Ui
    {
        public static string OutDir
        {
            get
            {
                string dir = Environment.GetEnvironmentVariable("SMOKE_OUT");
                if (string.IsNullOrEmpty(dir))
                    dir = Path.Combine(AppContext.BaseDirectory, "shots");
                Directory.CreateDirectory(dir);
                return dir;
            }
        }

        /// <summary>Dispatcher-ийн дараалалд байгаа бүх ажлыг (render, binding, timer) боловсруулна.</summary>
        public static void Pump(int ms = 0)
        {
            DateTime end = DateTime.UtcNow.AddMilliseconds(ms);
            do
            {
                DoEvents();
                if (ms > 0)
                    System.Threading.Thread.Sleep(4);
            }
            while (DateTime.UtcNow < end);
        }

        private static void DoEvents()
        {
            var frame = new DispatcherFrame();
            Dispatcher.CurrentDispatcher.BeginInvoke(DispatcherPriority.ApplicationIdle,
                new DispatcherOperationCallback(f => { ((DispatcherFrame)f).Continue = false; return null; }), frame);
            Dispatcher.PushFrame(frame);
        }

        public static void PumpUntil(Func<bool> condition, int timeoutMs, string what)
        {
            DateTime end = DateTime.UtcNow.AddMilliseconds(timeoutMs);
            while (!condition())
            {
                if (DateTime.UtcNow > end)
                    throw new SmokeFailed("Хугацаа хэтэрлээ: " + what);
                Pump(10);
            }
        }

        public static void Wait(Task task, int timeoutMs = 15000)
        {
            PumpUntil(() => task.IsCompleted, timeoutMs, "async үйлдэл");
            task.GetAwaiter().GetResult();   // алдаа байвал энд гарна
        }

        public static void Check(bool ok, string message)
        {
            if (!ok)
                throw new SmokeFailed(message);
        }

        public static void Eq<T>(T expected, T actual, string what)
        {
            if (!EqualityComparer<T>.Default.Equals(expected, actual))
                throw new SmokeFailed(what + ": хүлээсэн «" + expected + "», бодит «" + actual + "»");
        }

        public static void Contains(string haystack, string needle, string what)
        {
            if (haystack == null || haystack.IndexOf(needle, StringComparison.Ordinal) < 0)
                throw new SmokeFailed(what + ": «" + needle + "» олдсонгүй, бодит «" + haystack + "»");
        }

        /// <summary>Цонхны ХАРАГДАЦЫГ (OS-ийн гарчгийн мөрөөс бусад нь) PNG болгон хадгална.</summary>
        public static string Render(Window window, string name)
        {
            window.UpdateLayout();
            Pump(60);
            int w = (int)Math.Ceiling(window.ActualWidth);
            int h = (int)Math.Ceiling(window.ActualHeight);
            if (w <= 0 || h <= 0)
                throw new SmokeFailed("Цонх хэмжээгүй байна (layout хийгдээгүй)");
            var bmp = new RenderTargetBitmap(w, h, 96, 96, PixelFormats.Pbgra32);
            bmp.Render(window);
            var enc = new PngBitmapEncoder();
            enc.Frames.Add(BitmapFrame.Create(bmp));
            string path = Path.Combine(OutDir, name + ".png");
            using (FileStream fs = File.Create(path))
                enc.Save(fs);
            return path;
        }

        public static T Find<T>(DependencyObject root, string name) where T : FrameworkElement
        {
            var fe = root as FrameworkElement;
            var found = fe != null ? fe.FindName(name) as T : null;
            if (found == null)
                throw new SmokeFailed("Элемент олдсонгүй: " + name);
            return found;
        }

        public static IEnumerable<T> Descendants<T>(DependencyObject root) where T : DependencyObject
        {
            if (root == null)
                yield break;
            int n = VisualTreeHelper.GetChildrenCount(root);
            for (int i = 0; i < n; i++)
            {
                DependencyObject c = VisualTreeHelper.GetChild(root, i);
                var t = c as T;
                if (t != null)
                    yield return t;
                foreach (T d in Descendants<T>(c))
                    yield return d;
            }
        }
    }
}
