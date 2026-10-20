using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using Microsoft.Win32;
using RevitMcpAddin.Feedback.Core;

namespace RevitMcpAddin.Feedback
{
    /// <summary>Цонх нээгдсэн нөхцөл: аль хэрэгслээс, аль үе шатанд, ямар алдаатай (байвал).</summary>
    internal sealed class FeedbackContext
    {
        public string ToolId { get; set; }
        public string ToolLabel { get; set; }
        public string Stage { get; set; }
        public Exception Error { get; set; }
        public DiagnosticsInput Diagnostics { get; set; }
        /// <summary>Урьдчилан бөглөх гарчиг (ж: алдаанаас).</summary>
        public string SuggestedTitle { get; set; }
        public string SuggestedDescription { get; set; }
    }

    /// <summary>
    /// «Санал хүсэлт» — MODELESS цонх (Revit-д загвар засварлах ажлыг хаахгүй).  Нээлттэй файлгүй ч ажиллана.
    ///
    /// «Шинэ хүсэлт»: төрөл, гарчиг, тайлбар, давтах алхам, хүлээсэн/бодит үр дүн, санал, нөлөө + ИЛ сонгосон файл / дэлгэцийн
    /// зураг + техникийн мэдээлэл (юу илгээгдэхийг харуулна, хасаж болно).  «Илгээх» нь хүсэлтийг офлайн дараалалд нэмж
    /// арын дэвсгэрт илгээнэ — интернэтгүй, сервер унасан, Revit хаагдсан ч бичсэн зүйл алдагдахгүй.
    /// «Миний хүсэлтүүд»: дарааллын төлөв (хүлээж буй / илгээж буй / нэвтрэх шаардлагатай / алдаа + шалтгаан) ба серверийн
    /// нийтийн төлөв, «Засвар бэлэн» болсон хүсэлтэд «Ажиллаж байна» / «Засагдаагүй» (одоогийн оношилгоотой).
    /// Дотоод тэмдэглэл, бусдын хүсэлт ЭНД ХЭЗЭЭ Ч ирэхгүй (сервер зөвхөн өөрийн мөрийг буцаадаг).
    /// </summary>
    internal sealed class FeedbackWindow : Window
    {
        private static FeedbackWindow _current;

        private FeedbackContext _ctx;
        private readonly ComboBox _type = new ComboBox { MinWidth = 160 };
        private readonly TextBlock _contextLine = new TextBlock { TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 4, 0, 8) };
        private readonly TextBox _title = new TextBox { MaxLength = FeedbackLimits.TitleMax, Padding = new Thickness(4, 3, 4, 3) };
        private readonly TextBox _description = Multi(90);
        private readonly TextBox _steps = Multi(60);
        private readonly TextBox _expected = Multi(46);
        private readonly TextBox _actual = Multi(46);
        private readonly TextBox _suggestion = Multi(60);
        private readonly TextBox _impact = new TextBox { MaxLength = 400, Padding = new Thickness(4, 3, 4, 3) };
        private readonly StackPanel _bugFields = new StackPanel();
        private readonly StackPanel _improvementFields = new StackPanel();
        private readonly StackPanel _files = new StackPanel { Margin = new Thickness(0, 4, 0, 0) };
        private readonly TextBlock _filesSummary = new TextBlock { Margin = new Thickness(0, 4, 0, 0), TextWrapping = TextWrapping.Wrap };
        private readonly CheckBox _includeDiag = new CheckBox { Content = "Техникийн мэдээлэл хавсаргах (Revit/add-in хувилбар, алдааны мөр — нууц үг, токен ОРОХГҮЙ)", IsChecked = true, Margin = new Thickness(0, 8, 0, 0) };
        private readonly TextBox _diagText = new TextBox { IsReadOnly = true, TextWrapping = TextWrapping.Wrap, FontFamily = new FontFamily("Consolas"), FontSize = 11.5, MaxHeight = 220, VerticalScrollBarVisibility = ScrollBarVisibility.Auto };
        private readonly ContentControl _status = new ContentControl { Margin = new Thickness(0, 10, 0, 0) };
        private readonly Button _submit = Btn("Илгээх", 110);
        private readonly Button _signIn = Btn("Нэвтрэх…", 100);
        private readonly TabControl _tabs = new TabControl();
        private readonly StackPanel _queue = new StackPanel();
        private readonly StackPanel _mine = new StackPanel();
        private readonly TextBlock _mineStatus = new TextBlock { TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 6, 0, 0) };
        private readonly List<string> _pickedFiles = new List<string>();
        private readonly List<string> _tempFiles = new List<string>();
        private readonly CancellationTokenSource _cts = new CancellationTokenSource();
        private bool _busy;
        private bool _dirty;

        /// <summary>Нээнэ эсвэл (нээлттэй бол) урдаа гаргана.  Бичээгүй маягт бол шинэ нөхцөлөөр шинэчилнэ.</summary>
        public static void ShowFor(FeedbackContext ctx)
        {
            if (_current != null && _current.IsLoaded)
            {
                if (!_current._dirty) _current.Bind(ctx);
                _current._tabs.SelectedIndex = 0;
                if (_current.WindowState == WindowState.Minimized) _current.WindowState = WindowState.Normal;
                _current.Activate();
                return;
            }
            var w = new FeedbackWindow(ctx);
            _current = w;
            try
            {
                if (App.MainWindowHandle != IntPtr.Zero)
                    new System.Windows.Interop.WindowInteropHelper(w).Owner = App.MainWindowHandle;
            }
            catch (Exception) { }
            w.Closed += (s, e) => { if (ReferenceEquals(_current, w)) _current = null; };
            w.Show();
        }

        private FeedbackWindow(FeedbackContext ctx)
        {
            Ui.MglWindow.Setup(this, "MGL — Санал хүсэлт", 660, 760, 520, 480, prefsKey: "feedback");
            Ui.MglTheme.Apply(this);

            var root = new DockPanel { Margin = new Thickness(16, 12, 16, 12) };
            var head = new StackPanel();
            head.Children.Add(Ui.MglUi.Heading("Санал хүсэлт — MGL програм хариуцагчид"));
            TextBlock intro = Ui.MglUi.Muted("Алдаа, сайжруулалт, асуултаа бичнэ үү.  Хүсэлт тань хадгалагдаж, интернэт байхгүй үед ч сүлжээ сэргэмэгц өөрөө илгээгдэнэ.  Сервер дугаар (ПХ-…) өгмөгц «Миний хүсэлтүүд»-д харагдана.");
            intro.TextWrapping = TextWrapping.Wrap;
            intro.Margin = new Thickness(0, 4, 0, 8);
            head.Children.Add(intro);
            DockPanel.SetDock(head, Dock.Top);
            root.Children.Add(head);

            _tabs.Items.Add(new TabItem { Header = "Шинэ хүсэлт", Content = BuildForm() });
            _tabs.Items.Add(new TabItem { Header = "Миний хүсэлтүүд", Content = BuildMine() });
            _tabs.SelectionChanged += (s, e) =>
            {
                if (e.OriginalSource == _tabs && _tabs.SelectedIndex == 1) { RenderQueue(); _ = LoadMineAsync(); }
            };
            root.Children.Add(_tabs);
            Content = root;

            FeedbackService.Instance.Changed += OnServiceChanged;
            Closed += (s, e) =>
            {
                FeedbackService.Instance.Changed -= OnServiceChanged;
                try { _cts.Cancel(); } catch (Exception) { }
                foreach (string t in _tempFiles) { try { File.Delete(t); } catch (Exception) { } }
            };
            PreviewKeyDown += (s, e) => { if (e.Key == Key.Escape && !_busy) Close(); };
            Bind(ctx);
            Loaded += (s, e) => { _title.Focus(); FeedbackService.Instance.Kick(); };
        }

        /* ───────────────────────────── маягт ───────────────────────────── */

        private UIElement BuildForm()
        {
            var p = new StackPanel { Margin = new Thickness(4, 10, 8, 10) };

            foreach (string t in FeedbackTypes.All) _type.Items.Add(new ComboBoxItem { Content = FeedbackTypes.Label(t), Tag = t });
            _type.SelectedIndex = 0;
            _type.SelectionChanged += (s, e) => { SyncTypeFields(); _dirty = true; };
            var typeRow = new StackPanel { Orientation = Orientation.Horizontal };
            var typeLabel = new TextBlock { Text = "Төрөл:", VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(0, 0, 8, 0) };
            typeRow.Children.Add(typeLabel);
            typeRow.Children.Add(_type);
            Ui.MglAuto.LabelFor(typeLabel, _type);
            p.Children.Add(typeRow);
            _contextLine.SetResourceReference(TextBlock.ForegroundProperty, "FgMuted");
            p.Children.Add(_contextLine);

            p.Children.Add(Field("Гарчиг *", _title));
            p.Children.Add(Field("Тайлбар * — юу болсон, хаана, ямар нөхцөлд", _description));

            _bugFields.Children.Add(Field("Давтах алхам (1. … 2. … 3. …)", _steps));
            var pair = new Grid();
            pair.ColumnDefinitions.Add(new ColumnDefinition());
            pair.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(10) });
            pair.ColumnDefinitions.Add(new ColumnDefinition());
            UIElement exp = Field("Хүлээсэн үр дүн", _expected);
            UIElement act = Field("Бодит үр дүн", _actual);
            Grid.SetColumn(act, 2);
            pair.Children.Add(exp);
            pair.Children.Add(act);
            _bugFields.Children.Add(pair);
            p.Children.Add(_bugFields);
            _improvementFields.Children.Add(Field("Санал — юуг хэрхэн өөрчлөх вэ", _suggestion));
            p.Children.Add(_improvementFields);
            p.Children.Add(Field("Нөлөө (ж: «өдөр бүр 20 мин алддаг», «2 хүн хүлээж байна»)", _impact));

            foreach (TextBox tb in new[] { _title, _description, _steps, _expected, _actual, _suggestion, _impact })
                tb.TextChanged += (s, e) => _dirty = true;

            var filesHead = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 10, 0, 0) };
            filesHead.Children.Add(new TextBlock { Text = "Хавсралт", FontWeight = FontWeights.SemiBold, VerticalAlignment = VerticalAlignment.Center });
            Button add = Btn("Файл нэмэх…", 110);
            Button shot = Btn("Дэлгэцийн зураг", 130);
            add.Click += (s, e) => PickFiles();
            shot.Click += async (s, e) => await CaptureScreenshotAsync();
            filesHead.Children.Add(add);
            filesHead.Children.Add(shot);
            p.Children.Add(filesHead);
            _filesSummary.SetResourceReference(TextBlock.ForegroundProperty, "FgMuted");
            p.Children.Add(_files);
            p.Children.Add(_filesSummary);

            p.Children.Add(_includeDiag);
            var exp2 = new Expander { Header = "Юу илгээгдэх вэ? (техникийн мэдээлэл)", Margin = new Thickness(0, 4, 0, 0), Content = _diagText };
            p.Children.Add(exp2);
            _includeDiag.Checked += (s, e) => _diagText.Opacity = 1;
            _includeDiag.Unchecked += (s, e) => _diagText.Opacity = 0.45;

            p.Children.Add(_status);

            var buttons = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Right, Margin = new Thickness(0, 12, 0, 0) };
            Ui.MglUi.Primary(_submit);
            _submit.Click += async (s, e) => await SubmitAsync();
            _signIn.Click += (s, e) => OpenSignIn();
            _signIn.Visibility = Visibility.Collapsed;
            Button close = Btn("Хаах", 80);
            close.Click += (s, e) => Close();
            buttons.Children.Add(_signIn);
            buttons.Children.Add(_submit);
            buttons.Children.Add(close);
            p.Children.Add(buttons);

            return new ScrollViewer { Content = p, VerticalScrollBarVisibility = ScrollBarVisibility.Auto, HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled };
        }

        private void Bind(FeedbackContext ctx)
        {
            _ctx = ctx ?? new FeedbackContext();
            string tool = string.IsNullOrEmpty(_ctx.ToolLabel) ? _ctx.ToolId : _ctx.ToolLabel;
            _contextLine.Text = string.IsNullOrEmpty(tool)
                ? "Ерөнхий хүсэлт (хэрэгсэл сонгоогүй)."
                : "Хэрэгсэл: " + tool + (string.IsNullOrEmpty(_ctx.Stage) ? "" : " · " + _ctx.Stage) + (_ctx.Error != null ? " · алдаа бүртгэгдсэн" : "");
            if (_ctx.Error != null) _type.SelectedIndex = 0;
            if (!string.IsNullOrEmpty(_ctx.SuggestedTitle) && string.IsNullOrEmpty(_title.Text)) _title.Text = _ctx.SuggestedTitle;
            if (!string.IsNullOrEmpty(_ctx.SuggestedDescription) && string.IsNullOrEmpty(_description.Text)) _description.Text = _ctx.SuggestedDescription;
            _diagText.Text = FeedbackDiagnostics.Summary(_ctx.Diagnostics) + "\n\n" + (DiagnosticsJson(pretty: true) ?? "");
            _dirty = false;
            SyncTypeFields();
            RenderFiles();
            ShowStatus(null, Ui.MglSeverity.Info);
        }

        private void SyncTypeFields()
        {
            string t = SelectedType();
            _bugFields.Visibility = t == FeedbackTypes.Bug ? Visibility.Visible : Visibility.Collapsed;
            _improvementFields.Visibility = t == FeedbackTypes.Improvement ? Visibility.Visible : Visibility.Collapsed;
        }

        private string SelectedType() => (_type.SelectedItem as ComboBoxItem)?.Tag as string ?? FeedbackTypes.Bug;

        private string DiagnosticsJson(bool pretty = false)
        {
            if (_ctx?.Diagnostics == null) return null;
            string json = FeedbackDiagnostics.Build(_ctx.Diagnostics, DateTimeOffset.UtcNow);
            if (!pretty || json == null) return json;
            try
            {
                using (var doc = System.Text.Json.JsonDocument.Parse(json))
                    return System.Text.Json.JsonSerializer.Serialize(doc.RootElement, new System.Text.Json.JsonSerializerOptions { WriteIndented = true });
            }
            catch (Exception) { return json; }
        }

        private void PickFiles()
        {
            var dlg = new OpenFileDialog { Multiselect = true, Filter = FeedbackLimits.DialogFilter(), Title = "Хавсаргах файл сонгох" };
            if (dlg.ShowDialog(this) != true) return;
            foreach (string f in dlg.FileNames) AddFile(f);
        }

        private void AddFile(string path)
        {
            try
            {
                long size = new FileInfo(path).Length;
                long used = _pickedFiles.Sum(x => SafeLength(x));
                string problem = FeedbackLimits.FileProblem(Path.GetFileName(path), size, used, _pickedFiles.Count);
                if (problem != null)
                {
                    ShowStatus(Path.GetFileName(path) + ": " + problem, Ui.MglSeverity.Warn);
                    return;
                }
                if (_pickedFiles.Contains(path, StringComparer.OrdinalIgnoreCase)) return;
                _pickedFiles.Add(path);
                _dirty = true;
                RenderFiles();
            }
            catch (Exception ex)
            {
                ShowStatus("Файл уншиж чадсангүй: " + ex.Message, Ui.MglSeverity.Warn);
            }
        }

        private async Task CaptureScreenshotAsync()
        {
            try
            {
                Visibility = Visibility.Hidden;
                await Task.Delay(250);
                string dir = Path.Combine(Path.GetTempPath(), "mgl-feedback");
                string path = FeedbackScreenshot.CaptureWindow(App.MainWindowHandle, dir);
                _tempFiles.Add(path);
                AddFile(path);
            }
            catch (Exception ex)
            {
                ShowStatus("Дэлгэцийн зураг авч чадсангүй: " + ex.Message, Ui.MglSeverity.Warn);
            }
            finally
            {
                Visibility = Visibility.Visible;
                Activate();
            }
        }

        private void RenderFiles()
        {
            _files.Children.Clear();
            foreach (string f in _pickedFiles.ToList())
            {
                var row = new DockPanel { Margin = new Thickness(0, 2, 0, 2) };
                Button remove = Btn("Хасах", 60);
                remove.Margin = new Thickness(6, 0, 0, 0);
                string captured = f;
                remove.Click += (s, e) => { _pickedFiles.Remove(captured); RenderFiles(); };
                DockPanel.SetDock(remove, Dock.Right);
                row.Children.Add(remove);
                row.Children.Add(new TextBlock { Text = Path.GetFileName(f) + "  ·  " + FeedbackLimits.FormatBytes(SafeLength(f)), VerticalAlignment = VerticalAlignment.Center, TextTrimming = TextTrimming.CharacterEllipsis, ToolTip = f });
                _files.Children.Add(row);
            }
            long total = _pickedFiles.Sum(x => SafeLength(x));
            _filesSummary.Text = _pickedFiles.Count + "/" + FeedbackLimits.MaxAttachments + " файл · " + FeedbackLimits.FormatBytes(total) + " / " + FeedbackLimits.FormatBytes(FeedbackLimits.MaxTotalBytes)
                + ".  Зураг, PDF, лог ≤ " + FeedbackLimits.FormatBytes(FeedbackLimits.MaxOrdinaryBytes) + "; RVT/RFA/ZIP нийт хязгаар хүртэл.  Файл хувийн санд хадгалагдана.";
        }

        private async Task SubmitAsync()
        {
            if (_busy) return;
            var fields = new FeedbackFields
            {
                Type = SelectedType(),
                Title = _title.Text.Trim(),
                Description = _description.Text.Trim(),
                Steps = Opt(_steps),
                Expected = Opt(_expected),
                Actual = Opt(_actual),
                Suggestion = Opt(_suggestion),
                Impact = Opt(_impact),
                ToolId = string.IsNullOrEmpty(_ctx.ToolId) ? null : _ctx.ToolId,
                Source = _ctx.ToolId == "MglWallElevations" ? FeedbackSources.WallElevation : FeedbackSources.RevitTool,
                SourceContext = string.IsNullOrEmpty(_ctx.Stage) ? null : _ctx.Stage,
            };
            if (fields.Type != FeedbackTypes.Bug) { fields.Steps = null; fields.Expected = null; fields.Actual = null; }
            if (fields.Type != FeedbackTypes.Improvement) fields.Suggestion = null;
            string problem = fields.Problem();
            if (problem != null)
            {
                ShowStatus(problem, Ui.MglSeverity.Warn);
                return;
            }
            FeedbackDiagnosticsCollector.FillFields(fields, _ctx.Diagnostics);
            string diag = _includeDiag.IsChecked == true ? DiagnosticsJson() : null;
            var files = _pickedFiles.Select(f => new FeedbackSourceFile
            {
                Path = f,
                Name = Path.GetFileName(f),
                Kind = _tempFiles.Contains(f) ? "screenshot" : "file",
            }).ToList();

            _busy = true;
            _submit.IsEnabled = false;
            ShowStatus("Хадгалж байна…", Ui.MglSeverity.Info);
            try
            {
                // Файл хуулах (≤ 100 MiB) нь UI thread-ийг саатуулахгүй.
                FeedbackItem item = await Task.Run(() => FeedbackService.Instance.Enqueue(fields, diag, files));
                if (_ctx.Error != null) FeedbackRecentErrors.Forget(_ctx.ToolId);
                ResetForm();
                ShowStatus("Хадгалагдлаа — илгээж байна.  Явцыг «Миний хүсэлтүүд»-ээс харна уу.", Ui.MglSeverity.Ok);
                _tabs.SelectedIndex = 1;
            }
            catch (InvalidOperationException ex)
            {
                bool needsSignIn = FeedbackService.Instance.CurrentScope(out _, out _, out _) == null;
                _signIn.Visibility = needsSignIn ? Visibility.Visible : Visibility.Collapsed;
                ShowStatus(ex.Message, Ui.MglSeverity.Warn);
            }
            catch (Exception ex)
            {
                ShowStatus("Хадгалж чадсангүй: " + ex.Message, Ui.MglSeverity.Danger);
                FeedbackService.Log("enqueue failed: " + ex);
            }
            finally
            {
                _busy = false;
                _submit.IsEnabled = true;
            }
        }

        private void ResetForm()
        {
            foreach (TextBox tb in new[] { _title, _description, _steps, _expected, _actual, _suggestion, _impact }) tb.Text = "";
            _pickedFiles.Clear();
            RenderFiles();
            _dirty = false;
        }

        private void OpenSignIn()
        {
            try
            {
                App.ShowOwned(new Licensing.LicenseDialog(fromTool: true));
            }
            catch (Exception ex)
            {
                ShowStatus("Нэвтрэх цонхыг нээж чадсангүй: " + ex.Message, Ui.MglSeverity.Warn);
                return;
            }
            bool signedIn = FeedbackService.Instance.CurrentScope(out _, out _, out _) != null;
            _signIn.Visibility = signedIn ? Visibility.Collapsed : Visibility.Visible;
            ShowStatus(signedIn ? "Нэвтэрлээ — «Илгээх» дарна уу." : "Нэвтрээгүй хэвээр байна.", signedIn ? Ui.MglSeverity.Ok : Ui.MglSeverity.Warn);
            FeedbackService.Instance.Kick();
        }

        /* ─────────────────────────── миний хүсэлтүүд ─────────────────────────── */

        private UIElement BuildMine()
        {
            var p = new StackPanel { Margin = new Thickness(4, 10, 8, 10) };
            var top = new DockPanel();
            Button refresh = Btn("Шинэчлэх", 90);
            refresh.Click += async (s, e) => { RenderQueue(); FeedbackService.Instance.Kick(); await LoadMineAsync(); };
            DockPanel.SetDock(refresh, Dock.Right);
            top.Children.Add(refresh);
            top.Children.Add(new TextBlock { Text = "Энэ компьютерын дараалал", FontWeight = FontWeights.SemiBold, VerticalAlignment = VerticalAlignment.Center });
            p.Children.Add(top);
            p.Children.Add(_queue);
            p.Children.Add(new TextBlock { Text = "Серверт хүлээн авсан хүсэлтүүд", FontWeight = FontWeights.SemiBold, Margin = new Thickness(0, 16, 0, 4) });
            _mineStatus.SetResourceReference(TextBlock.ForegroundProperty, "FgMuted");
            p.Children.Add(_mineStatus);
            p.Children.Add(_mine);
            return new ScrollViewer { Content = p, VerticalScrollBarVisibility = ScrollBarVisibility.Auto, HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled };
        }

        private void OnServiceChanged()
        {
            try { Dispatcher.BeginInvoke(new Action(() => { if (IsLoaded) RenderQueue(); })); } catch (Exception) { }
        }

        private void RenderQueue()
        {
            _queue.Children.Clear();
            List<FeedbackItem> items = FeedbackService.Instance.CurrentItems();
            if (FeedbackService.Instance.CurrentScope(out _, out _, out _) == null)
            {
                _queue.Children.Add(Ui.MglUi.Note("Нэвтрээгүй байна — нэвтэрмэгц таны дараалсан хүсэлтүүд энд харагдаж, өөрөө илгээгдэнэ.", Ui.MglSeverity.Warn));
                return;
            }
            List<FeedbackItem> visible = items.Where(i => i.State != FeedbackStates.Cancelled).OrderByDescending(i => i.CreatedAt).Take(20).ToList();
            if (visible.Count == 0)
            {
                _queue.Children.Add(Ui.MglUi.Muted("Дараалалд хүсэлт алга."));
                return;
            }
            foreach (FeedbackItem it in visible) _queue.Children.Add(QueueRow(it));
        }

        private UIElement QueueRow(FeedbackItem it)
        {
            var box = new Border { BorderThickness = new Thickness(1), CornerRadius = new CornerRadius(4), Padding = new Thickness(10, 6, 10, 6), Margin = new Thickness(0, 4, 0, 0) };
            box.SetResourceReference(Border.BorderBrushProperty, "Line");
            var stack = new StackPanel();
            string number = it.Receipt?.DisplayNumber;
            var title = new TextBlock { Text = (string.IsNullOrEmpty(number) ? "" : number + "  ") + it.Fields?.Title, FontWeight = FontWeights.SemiBold, TextWrapping = TextWrapping.Wrap };
            stack.Children.Add(title);
            string state = it.State == FeedbackStates.Submitted
                ? (it.Receipt?.StatusLabel ?? FeedbackStates.Label(it.State)) + (string.IsNullOrEmpty(it.Receipt?.Note) ? "" : " — " + it.Receipt.Note)
                : FeedbackStates.Label(it.State);
            var line = new TextBlock { Text = state + " · " + Local(it.CreatedAt) + (it.Attachments.Count > 0 ? " · " + it.Attachments.Count + " файл" : ""), TextWrapping = TextWrapping.Wrap };
            line.SetResourceReference(TextBlock.ForegroundProperty, "FgMuted");
            stack.Children.Add(line);
            if (it.LastError != null && it.State != FeedbackStates.Submitted)
                stack.Children.Add(Ui.MglUi.Note(it.LastError.Message, it.State == FeedbackStates.Failed ? Ui.MglSeverity.Danger : Ui.MglSeverity.Warn));
            if (!FeedbackStates.IsTerminal(it.State) && it.State != FeedbackStates.Sending)
            {
                var actions = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 4, 0, 0) };
                if (it.State != FeedbackStates.Queued)
                {
                    Button retry = Btn("Дахин оролдох", 110);
                    retry.Margin = new Thickness(0, 0, 6, 0);
                    retry.Click += (s, e) => { if (!FeedbackService.Instance.Retry(it)) ShowMine("Яг одоо илгээж байна — түр хүлээнэ үү."); RenderQueue(); };
                    actions.Children.Add(retry);
                }
                Button cancel = Btn("Цуцлах", 80);
                cancel.Margin = new Thickness(0);
                cancel.Click += (s, e) =>
                {
                    if (MessageBox.Show(this, "Энэ хүсэлтийг цуцлах уу?  Илгээгдээгүй текст ба хавсралт устна.", "MGL — Санал хүсэлт", MessageBoxButton.YesNo, MessageBoxImage.Question) != MessageBoxResult.Yes) return;
                    if (!FeedbackService.Instance.Cancel(it)) ShowMine("Яг одоо илгээж байна — түр хүлээнэ үү.");
                    RenderQueue();
                };
                actions.Children.Add(cancel);
                stack.Children.Add(actions);
            }
            box.Child = stack;
            return box;
        }

        private async Task LoadMineAsync()
        {
            string scope = FeedbackService.Instance.CurrentScope(out _, out _, out _);
            if (scope == null)
            {
                ShowMine("Нэвтэрмэгц таны хүсэлтүүдийн төлөв энд харагдана.");
                _mine.Children.Clear();
                return;
            }
            ShowMine("Ачаалж байна…");
            try
            {
                var t = new FeedbackHttpTransport(scope, FeedbackService.CurrentCredentials);
                List<MineRow> rows = await Task.Run(() => t.MineAsync(_cts.Token));
                _mine.Children.Clear();
                ShowMine(rows.Count == 0 ? "Серверт хүсэлт алга." : "");
                foreach (MineRow r in rows.Take(30)) _mine.Children.Add(MineRowView(r, scope));
            }
            catch (Exception ex)
            {
                ShowMine("Серверээс ачаалж чадсангүй: " + FeedbackRetry.Describe(ex));
            }
        }

        private UIElement MineRowView(MineRow r, string scope)
        {
            var box = new Border { BorderThickness = new Thickness(1), CornerRadius = new CornerRadius(4), Padding = new Thickness(10, 6, 10, 6), Margin = new Thickness(0, 4, 0, 0) };
            box.SetResourceReference(Border.BorderBrushProperty, "Line");
            var stack = new StackPanel();
            stack.Children.Add(new TextBlock { Text = (r.DisplayNumber ?? "Ноорог") + "  " + r.Title, FontWeight = FontWeights.SemiBold, TextWrapping = TextWrapping.Wrap });
            var line = new TextBlock { Text = r.StatusLabel + " · " + Local(r.SubmittedAt), TextWrapping = TextWrapping.Wrap };
            line.SetResourceReference(TextBlock.ForegroundProperty, "FgMuted");
            stack.Children.Add(line);
            if (r.CanRetest)
            {
                var note = new TextBox { Padding = new Thickness(4, 3, 4, 3), Margin = new Thickness(0, 4, 0, 0), ToolTip = "Шалгасан үр дүн (сонголттой)" };
                stack.Children.Add(note);
                var actions = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 4, 0, 0) };
                string eventId = FeedbackItem.NewClientId("ret");
                if (r.Status == "ready_for_retest")
                {
                    Button works = Btn("Ажиллаж байна", 120);
                    works.Margin = new Thickness(0, 0, 6, 0);
                    works.Click += async (s, e) => await RetestAsync(r, "works", note.Text, eventId, scope);
                    actions.Children.Add(works);
                }
                Button broken = Btn("Засагдаагүй", 110);
                broken.Margin = new Thickness(0);
                broken.Click += async (s, e) => await RetestAsync(r, "still_broken", note.Text, eventId, scope);
                actions.Children.Add(broken);
                stack.Children.Add(actions);
            }
            box.Child = stack;
            return box;
        }

        private async Task RetestAsync(MineRow r, string action, string note, string eventId, string scope)
        {
            try
            {
                var t = new FeedbackHttpTransport(scope, FeedbackService.CurrentCredentials);
                string diag = DiagnosticsJson();
                string label = await Task.Run(() => t.RetestAsync(r.Id, action, note, eventId, diag, _cts.Token));
                ShowMine((r.DisplayNumber ?? "") + ": " + label);
                await LoadMineAsync();
            }
            catch (Exception ex)
            {
                ShowMine("Илгээж чадсангүй: " + FeedbackRetry.Describe(ex));
            }
        }

        /* ─────────────────────────────── туслах ─────────────────────────────── */

        private void ShowStatus(string text, Ui.MglSeverity sev)
        {
            _status.Content = string.IsNullOrEmpty(text) ? null : Ui.MglUi.Note(text, sev);
        }

        private void ShowMine(string text) => _mineStatus.Text = text ?? "";

        private static UIElement Field(string label, Control input)
        {
            var p = new StackPanel { Margin = new Thickness(0, 6, 0, 0) };
            var l = new TextBlock { Text = label, Margin = new Thickness(0, 0, 0, 3) };
            p.Children.Add(l);
            p.Children.Add(input);
            Ui.MglAuto.LabelFor(l, input);
            return p;
        }

        private static TextBox Multi(double height) => new TextBox
        {
            AcceptsReturn = true,
            TextWrapping = TextWrapping.Wrap,
            MinHeight = height,
            MaxLength = FeedbackLimits.TextMax,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            Padding = new Thickness(4, 3, 4, 3),
        };

        private static Button Btn(string text, double minWidth) => new Button
        {
            Content = text,
            MinWidth = minWidth,
            Padding = new Thickness(10, 4, 10, 4),
            Margin = new Thickness(6, 0, 0, 0),
        };

        private static string Opt(TextBox tb) => string.IsNullOrWhiteSpace(tb.Text) ? null : tb.Text.Trim();

        private static long SafeLength(string path)
        {
            try { return new FileInfo(path).Length; } catch (Exception) { return 0; }
        }

        private static string Local(string iso)
        {
            DateTimeOffset t;
            if (string.IsNullOrEmpty(iso) || !DateTimeOffset.TryParse(iso, System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.AssumeUniversal, out t)) return "";
            return t.ToLocalTime().ToString("yyyy-MM-dd HH:mm");
        }
    }
}
