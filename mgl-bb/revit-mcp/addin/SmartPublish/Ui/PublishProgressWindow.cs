using System;
using System.ComponentModel;
using System.Threading;
using System.Windows;
using System.Windows.Controls;
using RevitMcpAddin.Smart.Core;
using RevitMcpAddin.Smart.Ui;

namespace RevitMcpAddin.SmartPublish.Ui
{
    /// <summary>
    /// Гаргалтын ПРОГРЕСС цонх.  Гаргалт Revit-ийн үндсэн thread дээр СИНХРОНООР явдаг (IExternalCommand
    /// дотор — API контекст хүчинтэй) тул цонхыг файл бүрийн ДАРАА `UiPump.DoEvents()`-ээр шинэчилнэ
    /// (`QtoProgressWindow`-ийн ижил хэв маяг).  «Цуцлах» нь `CancellationToken`-ийг тавина; гаргалт
    /// ЯВАГДАЖ БУЙ файлаа дуустал хүлээгээд дараагийн файлаас өмнө зогсоно (экспортыг дундаас нь
    /// тасалж болохгүй).  Цонхыг хаахыг оролдвол мөн цуцлалт болно.
    /// </summary>
    internal sealed class PublishProgressWindow : Window, IProgress<JobProgress>
    {
        private readonly TextBlock _stage = UiKit.Text("Бэлтгэж байна…", bold: true);
        private readonly TextBlock _detail = UiKit.Text("", wrap: true);
        private readonly ProgressBar _bar = new ProgressBar { Height = 18, Minimum = 0, Maximum = 1, Margin = new Thickness(0, 8, 0, 8) };
        private readonly Button _cancel;
        private readonly CancellationTokenSource _cts = new CancellationTokenSource();
        private readonly string _verb;
        private readonly string _cancelNote;
        private bool _finished;

        public CancellationToken Token { get { return _cts.Token; } }

        /// <param name="verb">Прогрессийн толгойн үйл үг («Гаргаж байна», «Шинжилж байна»).</param>
        /// <param name="cancelNote">«Цуцлах» дарсны дараах тайлбар (ажлын төрлөөс хамаарна).</param>
        public PublishProgressWindow(string title, string verb = "Гаргаж байна", string cancelNote = "Зогсоож байна — одоо явагдаж буй файлыг дуусгана…")
        {
            _verb = verb;
            _cancelNote = cancelNote;
            Title = title;
            Width = 480;
            Height = 190;
            ResizeMode = ResizeMode.NoResize;
            WindowStartupLocation = WindowStartupLocation.CenterOwner;
            ShowInTaskbar = false;
            UiKit.Prepare(this, null);

            _cancel = UiKit.Btn("Цуцлах", (s, e) => RequestCancel(), 90);
            var panel = new StackPanel { Margin = new Thickness(14) };
            panel.Children.Add(_stage);
            panel.Children.Add(_bar);
            panel.Children.Add(_detail);
            var row = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Right, Margin = new Thickness(0, 8, 0, 0) };
            row.Children.Add(_cancel);
            panel.Children.Add(row);
            Content = panel;

            Closing += OnClosing;
        }

        private void OnClosing(object sender, CancelEventArgs e)
        {
            if (_finished) return;
            e.Cancel = true;            // ажил явагдаж байхад хаах боломжгүй — зөвхөн цуцлалт
            RequestCancel();
        }

        private void RequestCancel()
        {
            if (_cts.IsCancellationRequested) return;
            _cts.Cancel();
            _cancel.IsEnabled = false;
            _detail.Text = _cancelNote;
        }

        public void Report(JobProgress p)
        {
            _stage.Text = p.Total > 0 ? _verb + " " + Math.Min(p.Done, p.Total) + " / " + p.Total : _verb + "…";
            if (p.Fraction.HasValue) { _bar.IsIndeterminate = false; _bar.Value = p.Fraction.Value; }
            else _bar.IsIndeterminate = true;
            if (!_cts.IsCancellationRequested) _detail.Text = p.Message ?? "";
        }

        public void Finish()
        {
            _finished = true;
            try { Close(); } catch (InvalidOperationException) { }
        }
    }
}
