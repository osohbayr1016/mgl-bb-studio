using System;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Interop;
using System.Windows.Threading;

namespace RevitMcpAddin.Ui
{
    /// <summary>
    /// `IExternalCommand.Execute` дотроос сүлжээний дуудлагыг хүлээх ҮЕД Revit-ийг «Not Responding» болгохгүй, хэрэглэгчид юу хүлээж буйг,
    /// хэр удсаныг харуулна.
    ///
    /// Яагаад: ERP-д илгээх команд (тоо хэмжээ, PDF, түүвэр, холбоос) нь `Task.Run(...).GetAwaiter().GetResult()`-оор Revit-ийн UI thread-ийг ≤ 180 с
    /// ХӨЛДӨӨЖ байв — цонх хариу өгөхгүй, юу ч харагдахгүй.  `Execute` нь синхрон байх ёстой (Revit API) тул `await` болохгүй; харин
    /// ТҮР МОДАЛЬ цонхны (nested message loop) тусламжтай дуудлага хүлээгдэж буй хооронд Windows-ийн мессежүүд боловсруулагдсаар байна.
    ///
    ///  • Хурдан дуудлага (≤ 400 мс) цонх ҮЗҮҮЛЭХГҮЙ — анивчихгүй.
    ///  • Цонх ГАРАХААР «Цуцлах» БАЙХГҮЙ: `ApiClient`-ийн дуудлага цуцлах токенгүй, хүсэлт сервер рүү аль хэдийн явсан тул цуцалсан
    ///    мэт харагдуулбал өгөгдөл ЯГ Л хадгалагдаж магадгүй (хуурамч амлалт).  Оронд нь хэр удсаныг ил харуулна.
    ///  • Revit API-г ЭНД ХЭЗЭЭ Ч дуудахгүй — `work` нь зөвхөн сүлжээ (өгөгдөл өмнө нь цуглуулагдсан).
    ///  • `work`-ийн алдаа оригиналаараа (AggregateException биш) дахин шидэгдэнэ — дуудагчийн `catch (UnauthorizedException)` хэвээр ажиллана.
    /// </summary>
    internal static class MglBusy
    {
        /// <summary>Энэ хугацаанаас богино бол цонх гаргахгүй.</summary>
        internal const int ShowAfterMs = 400;

        internal static T Run<T>(string message, Func<Task<T>> work)
        {
            if (work == null) throw new ArgumentNullException("work");
            Task<T> task = Task.Run(work);
            if (task.Wait(ShowAfterMs)) return task.GetAwaiter().GetResult();

            try
            {
                ShowUntilDone(message, task);
            }
            catch (Exception)
            {
                // Цонх үүсгэж чадаагүй (жишээ нь STA биш) — хуучин зан төлөвт (синхрон хүлээлт) буцна.  Дуудлага ХЭЗЭЭ Ч алдагдахгүй.
                task.Wait();
            }
            return task.GetAwaiter().GetResult();
        }

        private static void ShowUntilDone(string message, Task task)
        {
            var w = new Window
            {
                Title = "MGL — Сервертэй холбогдож байна",
                WindowStyle = WindowStyle.ToolWindow,
                ShowInTaskbar = false,
            };
            global::RevitMcpAddin.Ui.MglWindow.Setup(w, w.Title, 460, 0, 380, 0, prefsKey: null, resizable: false, sizeToContentHeight: true);
            MglTheme.Apply(w, 13);

            var text = new TextBlock { Text = message, TextWrapping = TextWrapping.Wrap };
            text.SetResourceReference(FrameworkElement.StyleProperty, "MglBody");
            var bar = new ProgressBar { IsIndeterminate = true, Height = 8, Margin = new Thickness(0, 12, 0, 8) };
            bar.SetResourceReference(Control.ForegroundProperty, "Accent");
            bar.SetResourceReference(Control.BackgroundProperty, "BgInput");
            var elapsed = new TextBlock { Text = "Хүлээсэн: 0 с" };
            elapsed.SetResourceReference(FrameworkElement.StyleProperty, "MglMuted");
            var hint = new TextBlock
            {
                Text = "Хариу ирэх хүртэл хүлээнэ үү (хамгийн ихдээ ~3 минут). Энэ цонх өөрөө хаагдана; Revit хаахгүй байна уу.",
                Margin = new Thickness(0, 6, 0, 0),
            };
            hint.SetResourceReference(FrameworkElement.StyleProperty, "MglMuted");

            var panel = new StackPanel { Margin = new Thickness(18, 16, 18, 16) };
            panel.Children.Add(text);
            panel.Children.Add(bar);
            panel.Children.Add(elapsed);
            panel.Children.Add(hint);
            w.Content = panel;
            System.Windows.Automation.AutomationProperties.SetName(bar, "Сервертэй холбогдож байна");

            bool finished = false;
            DateTime start = DateTime.UtcNow;
            var timer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(1) };
            timer.Tick += (s, e) => elapsed.Text = "Хүлээсэн: " + (int)(DateTime.UtcNow - start).TotalSeconds + " с";

            // Хэрэглэгч хаахыг (Alt+F4) зөвшөөрөхгүй — дуудлага явж байхад хаавал үр дүн алдагдана.
            w.Closing += (s, e) => { if (!finished) e.Cancel = true; };
            w.Loaded += (s, e) => timer.Start();
            w.Closed += (s, e) => timer.Stop();

            Action close = () =>
            {
                finished = true;
                try { w.DialogResult = true; } catch { try { w.Close(); } catch { /* аль хэдийн хаагдсан */ } }
            };
            task.ContinueWith(_ =>
            {
                try { w.Dispatcher.BeginInvoke(close); } catch { /* цонх устсан */ }
            }, TaskScheduler.Default);

            IntPtr owner = IntPtr.Zero;
            try { Func<IntPtr> p = global::RevitMcpAddin.Ui.MglWindow.OwnerHandleProvider; if (p != null) owner = p(); } catch { /* эзэнгүй */ }
            if (owner != IntPtr.Zero) new WindowInteropHelper(w).Owner = owner;
            w.ShowDialog();
        }
    }
}
