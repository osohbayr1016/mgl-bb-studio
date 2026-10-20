using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.ComponentModel;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Media;
using Autodesk.Revit.DB;

namespace RevitMcpAddin
{
    /// <summary>Нэг файлын илгээлтийн эцсийн үр дүн (командын exit code-д).</summary>
    public sealed class FilePushOutcome
    {
        public string FileName;
        public bool Ok;
        public bool Skipped;
        public int RunId;
        public string Error;
    }

    /// <summary>
    /// Олон файлын задаргаа + илгээлтийн progress цонх.
    ///
    /// Threading: БҮХ ажил (задаргаа, орчестрац, UI шинэчлэл) Revit-ийн UI thread
    /// дээр, IExternalCommand.Execute-ийн stack дотор явна. Цонх ShowDialog()-оор
    /// нээгддэг (owner = Revit main window) тул Revit UI автоматаар түгжигдэнэ;
    /// будалтыг UiPump.DoEvents()-ээр хийнэ (задаргааны ~300 элемент тутам,
    /// push хүлээх үед 50мс тутам). HTTP push нь Task.Run-аар тусдаа thread дээр
    /// явагдах бөгөөд poll-pump-аар хүлээнэ — GetResult()-ын 30с царцаанаас
    /// сэргийлнэ. Энэ хугацаанд MCP bridge-ийн /execute 60с timeout-доо унана
    /// (модаль цонхны баримтжуулсан хязгаарлалт — HttpServer.cs-ийн тайлбар).
    /// </summary>
    public partial class QtoProgressWindow : Window
    {
        private readonly List<QtoTarget> _targets;
        private readonly string _revitVersion;
        private AddinSettings _settings;
        private readonly ObservableCollection<FileProgressItem> _items =
            new ObservableCollection<FileProgressItem>();

        private bool _started;
        private bool _running;
        private bool _cancelRequested;

        public List<FilePushOutcome> Results { get; } = new List<FilePushOutcome>();

        public QtoProgressWindow(
            List<QtoTarget> targets, AddinSettings settings, string revitVersion)
        {
            InitializeComponent();
            // MGL UI-ийн дундын давхарга: эзэн Revit-ийн дэлгэцийн ажлын талбарт тохируулах + Light/Dark/өндөр контраст.
            // Хэмжээ: өргөн 560 (ажлын талбараас том биш), өндөр агуулгаар, MaxHeight 640-аас ихгүй.
            Ui.MglWindow.Setup(this, Title, 560, 0, 440, 0, sizeToContentHeight: true, resizable: false);
            MaxHeight = Math.Min(MaxHeight, 640);
            Ui.MglTheme.Apply(this);
            _targets = targets;
            _settings = settings;
            _revitVersion = revitVersion;

            foreach (QtoTarget target in _targets)
            {
                var item = new FileProgressItem { FileName = target.FileName };
                if (target.Document == null)
                    item.SetSkipped(target.SkipReason);
                else
                    item.SetPending();
                _items.Add(item);
            }
            FileList.ItemsSource = _items;

            int runnable = CountRunnable();
            OverallBar.Maximum = runnable > 0 ? runnable : 1;
            OverallBar.Value = 0;
            UpdateCounts(0);
        }

        private int CountRunnable()
        {
            int n = 0;
            foreach (QtoTarget t in _targets)
                if (t.Document != null)
                    n++;
            return n;
        }

        private void Window_ContentRendered(object sender, EventArgs e)
        {
            if (_started)
                return;
            _started = true;
            _running = true;
            try
            {
                RunAll();
            }
            finally
            {
                _running = false;
                CancelBtn.Content = Ui.MglUiText.Close;
                CancelBtn.IsEnabled = true;
                NoteText.Visibility = System.Windows.Visibility.Collapsed;   // Revit дахин чөлөөлөгдсөн — «түгжигдэнэ» гэсэн тайлбар хуучирсан
                HeaderText.Text = _cancelRequested
                    ? "Цуцлагдлаа."
                    : "Дууслаа.";
            }
        }

        private void RunAll()
        {
            int finished = 0;
            bool authFailed = false;

            for (int i = 0; i < _targets.Count; i++)
            {
                QtoTarget target = _targets[i];
                FileProgressItem item = _items[i];

                if (target.Document == null)
                {
                    Results.Add(new FilePushOutcome
                    {
                        FileName = target.FileName,
                        Skipped = true,
                        Error = target.SkipReason,
                    });
                    continue;
                }

                if (_cancelRequested || authFailed)
                {
                    item.SetCancelled(authFailed ? "токен хүчингүй" : null);
                    Results.Add(new FilePushOutcome
                    {
                        FileName = target.FileName,
                        Skipped = true,
                        Error = authFailed ? "токен хүчингүй" : "цуцлагдсан",
                    });
                    continue;
                }

                var outcome = new FilePushOutcome { FileName = target.FileName };
                try
                {
                    // ── Задаргаа (Revit UI thread дээр; будалт throttle-тэй) ──
                    item.SetExtracting(0);
                    UiPump.DoEvents();
                    QtoExtractionResult extraction = QtoExtractor.Extract(
                        target.Document, _revitVersion,
                        n =>
                        {
                            if (n % 300 == 0)
                            {
                                item.SetExtracting(n);
                                UiPump.DoEvents();
                            }
                        });
                    item.SetExtracting(extraction.ElementCount);
                    UiPump.DoEvents();

                    if (_cancelRequested)
                    {
                        item.SetCancelled(null);
                        outcome.Skipped = true;
                        outcome.Error = "цуцлагдсан";
                        Results.Add(outcome);
                        continue;
                    }

                    QtoPayload payload = extraction.Payload;
                    payload.ProjectId = _settings.ProjectId.Value;

                    // ── Илгээлт (тусдаа thread; poll-pump хүлээлт) ──
                    item.SetPushing();
                    bool retriedAuth = false;
                    while (true)
                    {
                        try
                        {
                            QtoPushResult push = AwaitWithPump(Task.Run(() =>
                                ApiClient.PostRevitRunAsync(
                                    _settings.ApiHost, _settings.Token, payload)));
                            outcome.Ok = true;
                            outcome.RunId = push.RunId;
                            item.SetDone(push.RunId, push.Facts, push.Unmapped);
                            break;
                        }
                        catch (DuplicatePushException dup)
                        {
                            // Ижил push аль хэдийн орсон — амжилтад тооцно.
                            outcome.Ok = true;
                            outcome.RunId = dup.RunId;
                            item.SetDuplicate(dup.RunId);
                            break;
                        }
                        catch (UnauthorizedException)
                        {
                            if (retriedAuth)
                            {
                                authFailed = true;
                                outcome.Error = "токен хүчингүй";
                                item.SetFailed("токен хүчингүй");
                                break;
                            }
                            // Нэг удаа дахин нэвтрүүлж үзнэ (цонх нь энэ цонхонд owned).
                            var dialog = new SettingsDialog { Owner = this };
                            bool? ok = dialog.ShowDialog();
                            _settings = SettingsStore.Load();
                            if (ok != true || string.IsNullOrEmpty(_settings.Token))
                            {
                                authFailed = true;
                                outcome.Error = "токен хүчингүй";
                                item.SetFailed("токен хүчингүй");
                                break;
                            }
                            if (_settings.ProjectId != null)
                                payload.ProjectId = _settings.ProjectId.Value;
                            retriedAuth = true;
                        }
                    }
                }
                catch (Exception ex)
                {
                    // Задаргаа/сүлжээний алдаа — энэ файлыг ✗ тэмдэглээд үргэлжилнэ.
                    outcome.Error = ex.Message;
                    item.SetFailed(Shorten(ex.Message));
                }

                Results.Add(outcome);
                finished++;
                OverallBar.Value = finished;
                UpdateCounts(finished);
                UiPump.DoEvents();
            }
        }

        /// <summary>Task дуусахыг цонхоо будсаар хүлээнэ (UI царцаахгүй).</summary>
        private static T AwaitWithPump<T>(Task<T> task)
        {
            while (!task.IsCompleted)
            {
                UiPump.DoEvents();
                Thread.Sleep(50);
            }
            return task.GetAwaiter().GetResult();
        }

        private void UpdateCounts(int finished)
        {
            CountText.Text = finished + " / " + CountRunnable();
        }

        private static string Shorten(string message)
        {
            if (message == null)
                return string.Empty;
            return message.Length > 80 ? message.Substring(0, 80) + "…" : message;
        }

        private void CancelBtn_Click(object sender, RoutedEventArgs e)
        {
            if (_running)
            {
                _cancelRequested = true;
                CancelBtn.IsEnabled = false;
                CancelBtn.Content = "Цуцалж байна…";
            }
            else
            {
                Close();
            }
        }

        private void Window_Closing(object sender, CancelEventArgs e)
        {
            if (_running)
            {
                // X дарахад Цуцлахтай адил — ажиллаж дуустал цонх хаагдахгүй.
                e.Cancel = true;
                _cancelRequested = true;
                CancelBtn.IsEnabled = false;
                CancelBtn.Content = "Цуцалж байна…";
            }
        }
    }

    /// <summary>Нэг файлын мөрийн төлөв.  XAML-ийн DataTrigger нь токен өнгө (Info/Ok/Danger/Warn) сонгоно — сэдэвт дагана.</summary>
    public enum FileStatusKind
    {
        Pending = 0,
        Working = 1,
        Ok = 2,
        Failed = 3,
        Skipped = 4,
        Cancelled = 5,
    }

    /// <summary>
    /// Нэг файлын мөрийн binding загвар.  ⚠️ Өмнө нь `StatusBrush` (Gray/SteelBlue/ForestGreen/Firebrick/DarkOrange)
    /// байсан — тогтмол өнгө нь Dark/өндөр контрастад дагахгүй тул `Kind` болгов.  Төлөв ЗӨВХӨН өнгөөр илрэхгүй:
    /// ✓/✗ тэмдэг, «Алгассан:» угтвар, «Цуцлагдсан» бичвэр хамт явна.
    /// </summary>
    public sealed class FileProgressItem : INotifyPropertyChanged
    {
        private string _statusText = string.Empty;
        private FileStatusKind _kind = FileStatusKind.Pending;

        public string FileName { get; set; }

        public string StatusText
        {
            get { return _statusText; }
            private set { _statusText = value; Notify("StatusText"); }
        }

        public FileStatusKind Kind
        {
            get { return _kind; }
            private set { _kind = value; Notify("Kind"); }
        }

        public void SetPending() { Set("Хүлээж байна…", FileStatusKind.Pending); }
        public void SetExtracting(int n)
        {
            Set(n > 0 ? "Задалж байна… (" + n.ToString("N0") + " элемент)" : "Задалж байна…",
                FileStatusKind.Working);
        }
        public void SetPushing() { Set("Илгээж байна…", FileStatusKind.Working); }
        public void SetDone(int runId, int facts, int unmapped)
        {
            Set("✓ Run #" + runId + " (" + facts.ToString("N0") + " мөр, ангилаагүй "
                + unmapped.ToString("N0") + ")", FileStatusKind.Ok);
        }
        public void SetDuplicate(int runId)
        {
            Set("✓ Давхардсан (Run #" + runId + ")", FileStatusKind.Ok);
        }
        public void SetFailed(string reason) { Set("✗ " + reason, FileStatusKind.Failed); }
        public void SetSkipped(string reason) { Set("Алгассан: " + reason, FileStatusKind.Skipped); }
        public void SetCancelled(string reason)
        {
            Set(reason == null ? "Цуцлагдсан" : "Цуцлагдсан (" + reason + ")", FileStatusKind.Cancelled);
        }

        private void Set(string text, FileStatusKind kind)
        {
            StatusText = text;
            Kind = kind;
        }

        public event PropertyChangedEventHandler PropertyChanged;
        private void Notify(string name)
        {
            PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
        }
    }
}
