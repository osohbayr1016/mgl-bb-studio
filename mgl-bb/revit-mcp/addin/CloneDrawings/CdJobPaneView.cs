using System;
using System.Collections.Generic;
using System.Linq;
using System.Windows;
using System.Windows.Automation;
using System.Windows.Controls;
using System.Windows.Media;

namespace RevitMcpAddin.CloneDrawings
{
    // ══════════════════════════════════════════════════════════════════════
    //  «MGL — Зураг хувилах» бэхлэгддэг самбар (2026-10-01): хувилалтын явц (%),
    //  одоо юу хийж байгаа, үлдсэн хугацаа, түр зогсоох/цуцлах, дууссаны дараа тайлан,
    //  «Бүгдийг буцаах».  ⚠️ Энэ файл Revit-ийн төрөл ХЭРЭГЛЭХГҮЙ — Revit-гүй WPF
    //  smoke тест эмхэтгэдэг.  Бүх өгөгдөл <see cref="CdJobCard"/> (хуулбар) -аар,
    //  бүх үйлдэл <see cref="ICdJobCommands"/>-аар (Revit API-г хост хийнэ).
    // ══════════════════════════════════════════════════════════════════════

    public enum CdCardState
    {
        Running,
        Paused,
        Queued,
        Done,
        Cancelled,
        Failed,
    }

    /// <summary>Нэг хувилалтын агшин зураг — самбарт харуулах бүх зүйл (Revit-ийн объектгүй).</summary>
    public sealed class CdJobCard
    {
        public int Number;
        public CdCardState State;
        public string Title;
        public string DocTitle;
        public string Status;
        public string Notice;
        public double Fraction;
        public int Percent;
        public string TimeLine;
        public string Counters;
        public string Report;
        public string Message;
        public bool CanOpenSheet, CanOpenView, CanUndo;
        /// <summary>«Эхний хуудсыг нээх» / «Эхний харагдацыг нээх» товчны бичвэр, тайлбар — null = хувилалтын бичвэр (W06: «Ханын дэлгээс»-д «Үр дүн»).</summary>
        public string OpenSheetText, OpenSheetTip, OpenViewText;
        /// <summary>«Бүгдийг буцаах»-ын баталгаажуулалтад нэмэх анхааруулга (өмнөх клоныг устгасан ажил г.м.), эсвэл null.</summary>
        public string UndoWarning;
        /// <summary>Хэрэгслийн нэр (цонхны гарчиг) — null = «MGL — Зураг хувилах».</summary>
        public string ToolTitle;
        /// <summary>«Цуцлах», «Бүгдийг буцаах»-ын асуулт — null = хувилалтын бичвэр.</summary>
        public string CancelQuestion, UndoQuestion;
        public bool IsFinished => State == CdCardState.Done || State == CdCardState.Cancelled || State == CdCardState.Failed;
    }

    /// <summary>Самбарын товчнууд — хост (Revit талд) хэрэгжүүлнэ.</summary>
    public interface ICdJobCommands
    {
        void Pause(int job);
        void Resume(int job);
        void Cancel(int job);
        void UndoAll(int job);
        void OpenSheet(int job);
        void OpenView(int job);
        void Dismiss(int job);
    }

    public sealed class CdJobPaneView : UserControl
    {
        // ⚠️ Өнгө ЭНД БАЙХГҮЙ: токен (Bg, BgRaised, BgInput, Line, Fg, FgMuted, Accent, Ok, Warn, Danger …) нь
        // `Ui/MglTheme`-ээс (`Apply`) — Revit-ийн Light/Dark/өндөр контраст дагана.  Элемент бүр `SetResourceReference`-ээр
        // токенд холбогдоно (Brush-ыг зөөж хадгалбал сэдэв солигдоход хуучирна).  Энэ файл Revit-ийн төрөл ХЭРЭГЛЭХГҮЙ.

        private readonly StackPanel _list = new StackPanel();
        private readonly TextBlock _empty;
        private readonly Dictionary<int, Card> _cards = new Dictionary<int, Card>();
        private ICdJobCommands _commands;

        public CdJobPaneView()
        {
            MinWidth = 280;
            var root = new DockPanel { Margin = new Thickness(10) };
            var head = new StackPanel { Margin = new Thickness(2, 0, 2, 8) };
            head.Children.Add(Ref(new TextBlock { Text = "Ажлын явц", FontSize = 14, FontWeight = FontWeights.SemiBold }, "Fg"));
            head.Children.Add(Ref(new TextBlock
            {
                Text = "Зураг хувилах, ханын дэлгээс арын горимд явна — хүлээх хооронд Revit-д үргэлжлүүлэн ажиллаж болно.",
                FontSize = 12,
                TextWrapping = TextWrapping.Wrap,
                Margin = new Thickness(0, 2, 0, 0),
            }, "FgMuted"));
            DockPanel.SetDock(head, Dock.Top);
            root.Children.Add(head);

            _empty = Ref(new TextBlock
            {
                Text = "Одоогоор ажил алга.\nMGL → Зураг → «Зураг хувилах» эсвэл «Ханын дэлгээс» товчоор эхлүүлнэ.",
                FontSize = 12,
                TextWrapping = TextWrapping.Wrap,
                Margin = new Thickness(2, 8, 2, 0),
            }, "FgMuted");
            var body = new StackPanel();
            body.Children.Add(_list);
            body.Children.Add(_empty);
            root.Children.Add(new ScrollViewer
            {
                Content = body,
                VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
                HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
            });
            Content = root;

            // Дундын сэдэв: Bg/Fg/FontSize + implicit Button/TextBox/Expander/ProgressBar загвар (зөвхөн энэ самбарын Resources).
            // Загвар ачаалагдаагүй бол ч токен тавигдана; тэр нь хэрэв огт бүтэлгүйтвэл системийн өнгө.
            try { global::RevitMcpAddin.Ui.MglTheme.Apply(this, 12); }
            catch { Background = SystemColors.WindowBrush; Foreground = SystemColors.WindowTextBrush; }
        }

        public void Attach(ICdJobCommands commands) => _commands = commands;

        /// <summary>Картуудыг шинэчилнэ — байгаа картыг дахин ашиглана (тайлан нээлттэй эсэх, гүйлгэлт хадгалагдана).</summary>
        public void Update(IReadOnlyList<CdJobCard> jobs)
        {
            jobs = jobs ?? new List<CdJobCard>();
            var keep = new HashSet<int>(jobs.Select(j => j.Number));
            foreach (int gone in _cards.Keys.Where(k => !keep.Contains(k)).ToList())
                _cards.Remove(gone);
            var order = jobs
                .OrderBy(j => j.State == CdCardState.Running || j.State == CdCardState.Paused ? 0 : j.State == CdCardState.Queued ? 1 : 2)
                .ThenBy(j => j.IsFinished ? -j.Number : j.Number)
                .ToList();
            _list.Children.Clear();
            foreach (CdJobCard j in order)
            {
                if (!_cards.TryGetValue(j.Number, out Card c))
                    _cards[j.Number] = c = new Card(this, j.Number);
                c.Apply(j);
                _list.Children.Add(c.Root);
            }
            _empty.Visibility = order.Count == 0 ? Visibility.Visible : Visibility.Collapsed;
        }

        // ── Карт ───────────────────────────────────────────────────────────

        private sealed class Card
        {
            private readonly CdJobPaneView _owner;
            private readonly int _number;
            public readonly Border Root;
            private readonly TextBlock _title, _sub, _percent, _status, _time, _counters, _message, _noticeText;
            private readonly Border _notice;
            private readonly ProgressBar _bar;
            private readonly Button _pause, _resume, _cancel, _openSheet, _openView, _undo, _dismiss;
            private readonly Expander _reportBox;
            private readonly TextBox _report;
            private CdJobCard _last;

            /// <summary>Картын Border-ыг (smoke тест) товчны загварын Border-оос ялгах тэмдэг.</summary>
            internal const string CardTag = "cd-card";

            public Card(CdJobPaneView owner, int number)
            {
                _owner = owner;
                _number = number;
                var stack = new StackPanel();
                _title = Text(13, FontWeights.SemiBold, "Fg");
                _sub = Text(12, FontWeights.Normal, "FgMuted");
                stack.Children.Add(_title);
                stack.Children.Add(_sub);

                var barRow = new Grid { Margin = new Thickness(0, 8, 0, 2) };
                barRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
                barRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
                _bar = new ProgressBar
                {
                    Height = 8,
                    Minimum = 0,
                    Maximum = 100,
                    BorderThickness = new Thickness(0),
                    VerticalAlignment = VerticalAlignment.Center,
                };
                _bar.SetResourceReference(Control.BackgroundProperty, "BgInput");
                _bar.SetResourceReference(Control.ForegroundProperty, "Accent");
                AutomationProperties.SetName(_bar, "Хувилалтын явц");
                _percent = Text(13, FontWeights.SemiBold, "Fg");
                _percent.Margin = new Thickness(8, 0, 0, 0);
                _percent.MinWidth = 40;
                _percent.TextAlignment = TextAlignment.Right;
                Grid.SetColumn(_percent, 1);
                barRow.Children.Add(_bar);
                barRow.Children.Add(_percent);
                stack.Children.Add(barRow);

                _status = Text(12, FontWeights.Normal, "Fg");
                _status.Margin = new Thickness(0, 4, 0, 0);
                _time = Text(12, FontWeights.Normal, "FgMuted");
                _counters = Text(12, FontWeights.Normal, "FgMuted");
                stack.Children.Add(_status);
                stack.Children.Add(_time);
                stack.Children.Add(_counters);

                _noticeText = Text(12, FontWeights.Normal, "Fg");
                _notice = new Border
                {
                    BorderThickness = new Thickness(1),
                    CornerRadius = new CornerRadius(3),
                    Padding = new Thickness(6, 4, 6, 4),
                    Margin = new Thickness(0, 6, 0, 0),
                    Child = _noticeText,
                };
                // Анхааруулга: өнгө ганцаараа биш — «⚠» тэмдэг + хүрээ (Apply дотор бичвэрт нэмнэ).
                _notice.SetResourceReference(Border.BackgroundProperty, "WarnBg");
                _notice.SetResourceReference(Border.BorderBrushProperty, "Warn");
                stack.Children.Add(_notice);

                var buttons = new WrapPanel { Margin = new Thickness(0, 8, 0, 0) };
                _pause = MakeButton("Түр зогсоох", false, () => _owner._commands?.Pause(_number));
                _resume = MakeButton("Үргэлжлүүлэх", true, () => _owner._commands?.Resume(_number));
                _cancel = MakeButton("Цуцлах", false, ConfirmCancel);
                _openSheet = MakeButton("Эхний хуудсыг нээх", true, () => _owner._commands?.OpenSheet(_number));
                _openView = MakeButton("Эхний харагдацыг нээх", false, () => _owner._commands?.OpenView(_number));
                _undo = MakeButton("Бүгдийг буцаах", false, ConfirmUndo);
                _undo.ToolTip = "Энэ хувилалтоор үүссэн харагдац, хуудас, tag, хэмжээс, 2D-г нэг дор устгана.\n"
                                + "Хувилалт алхам тутамд хадгалагддаг тул Ctrl+Z нэг нэг алхам л буцаана — үүгээр бүгдийг нэг дор.";
                _dismiss = MakeButton("Жагсаалтаас хасах", false, () => _owner._commands?.Dismiss(_number));
                _dismiss.ToolTip = "Энэ картыг жагсаалтаас хасна (Revit-ийн загварт юу ч өөрчлөхгүй).";
                foreach (Button b in new[] { _pause, _resume, _cancel, _openSheet, _openView, _undo, _dismiss })
                    buttons.Children.Add(b);
                stack.Children.Add(buttons);

                _message = Text(12, FontWeights.Normal, "FgMuted");
                _message.Margin = new Thickness(0, 4, 0, 0);
                stack.Children.Add(_message);

                // Хэв маяг (өнгө, хүрээ, фокус) — `MglControls.xaml`-ийн implicit TextBox/Expander.
                _report = new TextBox
                {
                    IsReadOnly = true,
                    TextWrapping = TextWrapping.Wrap,
                    VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
                    MaxHeight = 320,
                    FontSize = 12,
                    Padding = new Thickness(4),
                };
                AutomationProperties.SetName(_report, "Хувилалтын тайлан");
                _reportBox = new Expander
                {
                    Header = "Тайлан",
                    Content = _report,
                    Margin = new Thickness(0, 6, 0, 0),
                };
                stack.Children.Add(_reportBox);

                Root = new Border
                {
                    BorderThickness = new Thickness(1),
                    CornerRadius = new CornerRadius(4),
                    Padding = new Thickness(10, 8, 10, 10),
                    Margin = new Thickness(0, 0, 0, 8),
                    Child = stack,
                    Tag = CardTag,
                };
                Root.SetResourceReference(Border.BackgroundProperty, "BgRaised");
                Root.SetResourceReference(Border.BorderBrushProperty, "Line");
            }

            public void Apply(CdJobCard j)
            {
                bool wasFinished = _last != null && _last.IsFinished;
                _last = j;
                _title.Text = j.Title ?? "";
                _sub.Text = StateWord(j.State) + (string.IsNullOrEmpty(j.DocTitle) ? "" : "  ·  " + j.DocTitle);
                // Төлөв өнгөөр ГАНЦААРАА илрэхгүй — `_sub` бичвэр нь төлөвийн үгээр эхэлнэ (StateWord).
                _sub.SetResourceReference(TextBlock.ForegroundProperty,
                    j.State == CdCardState.Done ? "Ok"
                    : j.State == CdCardState.Failed ? "Danger"
                    : j.State == CdCardState.Cancelled || j.State == CdCardState.Paused ? "Warn"
                    : "FgMuted");
                _bar.Value = Math.Max(0, Math.Min(100, j.Fraction * 100));
                _bar.SetResourceReference(Control.ForegroundProperty,
                    j.State == CdCardState.Done ? "Ok"
                    : j.State == CdCardState.Failed ? "Danger"
                    : j.State == CdCardState.Running ? "Accent"
                    : j.State == CdCardState.Paused ? "Warn"
                    : "FgMuted");
                _percent.Text = j.Percent + "%";
                _status.Text = j.Status ?? "";
                SetText(_time, j.TimeLine);
                SetText(_counters, j.Counters);
                _noticeText.Text = string.IsNullOrEmpty(j.Notice) ? "" : "⚠ " + j.Notice;
                _notice.Visibility = string.IsNullOrEmpty(j.Notice) ? Visibility.Collapsed : Visibility.Visible;
                SetText(_message, j.Message);

                Show(_pause, j.State == CdCardState.Running);
                Show(_resume, j.State == CdCardState.Paused);
                Show(_cancel, !j.IsFinished);
                Show(_openSheet, j.IsFinished && j.CanOpenSheet);
                Show(_openView, j.IsFinished && j.CanOpenView);
                _openSheet.Content = j.OpenSheetText ?? "Эхний хуудсыг нээх";
                _openSheet.ToolTip = j.OpenSheetTip;
                _openView.Content = j.OpenViewText ?? "Эхний харагдацыг нээх";
                Show(_undo, j.IsFinished && j.CanUndo);
                Show(_dismiss, j.IsFinished);

                _report.Text = j.Report ?? "";
                _reportBox.Visibility = j.IsFinished && !string.IsNullOrEmpty(j.Report) ? Visibility.Visible : Visibility.Collapsed;
                if (j.IsFinished && !wasFinished)
                    _reportBox.IsExpanded = true; // дуусмагц тайланг шууд харуулна
            }

            private void ConfirmCancel()
            {
                MessageBoxResult r = MessageBox.Show(
                    _last?.CancelQuestion ?? "Хувилалтыг зогсоох уу?\n\nОдоог хүртэл хийгдсэн зураг хадгалагдана.  Дахин хувилахад давхардуулахгүйгээр дутууг нь нэмнэ.",
                    _last?.ToolTitle ?? "MGL — Зураг хувилах", MessageBoxButton.YesNo, MessageBoxImage.Question);
                if (r == MessageBoxResult.Yes)
                    _owner._commands?.Cancel(_number);
            }

            private void ConfirmUndo()
            {
                MessageBoxResult r = MessageBox.Show(
                    (_last?.UndoQuestion ?? ("Энэ хувилалтоор үүссэн БҮХ харагдац, хуудас, tag, хэмжээс, 2D-г устгах уу?\n\n"
                    + "Клон харагдацад дараа нь гараар нэмсэн зүйл хамт устна.  Загвар элемент, эх зураг хөндөгдөхгүй.\n"
                    + "Энэ устгалыг өөрийг нь Ctrl+Z-ээр буцааж болно."))
                    + (string.IsNullOrEmpty(_last?.UndoWarning) ? "" : "\n\n" + _last.UndoWarning),
                    "MGL — Бүгдийг буцаах", MessageBoxButton.YesNo, MessageBoxImage.Warning);
                if (r == MessageBoxResult.Yes)
                    _owner._commands?.UndoAll(_number);
            }

            private static string StateWord(CdCardState s)
            {
                switch (s)
                {
                    case CdCardState.Running: return "Явагдаж байна";
                    case CdCardState.Paused: return "Түр зогссон";
                    case CdCardState.Queued: return "Дараалалд";
                    case CdCardState.Done: return "Дууссан";
                    case CdCardState.Cancelled: return "Цуцалсан";
                    default: return "Алдаатай зогссон";
                }
            }

            private static void SetText(TextBlock t, string s)
            {
                t.Text = s ?? "";
                t.Visibility = string.IsNullOrEmpty(s) ? Visibility.Collapsed : Visibility.Visible;
            }

            private static void Show(UIElement e, bool on) => e.Visibility = on ? Visibility.Visible : Visibility.Collapsed;
        }

        // ── Туслах ─────────────────────────────────────────────────────────

        private static TextBlock Text(double size, FontWeight weight, string fgKey)
        {
            var t = new TextBlock { FontSize = size, FontWeight = weight, TextWrapping = TextWrapping.Wrap };
            t.SetResourceReference(TextBlock.ForegroundProperty, fgKey);
            return t;
        }

        /// <summary>Бичвэрийн өнгийг токенд холбоно (сэдэв солигдоход дагана).</summary>
        private static TextBlock Ref(TextBlock t, string fgKey)
        {
            t.SetResourceReference(TextBlock.ForegroundProperty, fgKey);
            return t;
        }

        /// <summary>
        /// Товч: хэв маяг нь `MglControls.xaml` (implicit Button; гол үйлдэл = `MglPrimaryButton`) — hover/дарагдсан/фокус/идэвхгүй,
        /// 28 DIP доод өндөр, харагдах фокус бүгд тэндээс.  Бичвэр нь энгийн string (Automation нэр = бичвэр).
        /// </summary>
        private static Button MakeButton(string text, bool primary, Action onClick)
        {
            var b = new Button
            {
                Content = text,
                Padding = new Thickness(10, 3, 10, 3),
                Margin = new Thickness(0, 0, 6, 6),
                Cursor = System.Windows.Input.Cursors.Hand,
            };
            if (primary) b.SetResourceReference(FrameworkElement.StyleProperty, "MglPrimaryButton");
            b.Click += (s, e) =>
            {
                try { onClick(); }
                catch (Exception ex) { MessageBox.Show(ex.Message, "MGL — Зураг хувилах"); }
            };
            return b;
        }
    }
}
