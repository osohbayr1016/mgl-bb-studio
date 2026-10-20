using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Windows.Threading;

namespace RevitMcpAddin.CloneDrawings.UiSmoke
{
    /// <summary>Самбарын товчийг дарахад юу дуудагдсаныг тэмдэглэнэ.</summary>
    internal sealed class FakeCommands : ICdJobCommands
    {
        public readonly List<string> Calls = new List<string>();
        public void Pause(int job) => Calls.Add("pause:" + job);
        public void Resume(int job) => Calls.Add("resume:" + job);
        public void Cancel(int job) => Calls.Add("cancel:" + job);
        public void UndoAll(int job) => Calls.Add("undo:" + job);
        public void OpenSheet(int job) => Calls.Add("sheet:" + job);
        public void OpenView(int job) => Calls.Add("view:" + job);
        public void Dismiss(int job) => Calls.Add("dismiss:" + job);
    }

    public static class Program
    {
        private static int _pass, _fail;

        [STAThread]
        public static int Main(string[] args)
        {
            Console.OutputEncoding = System.Text.Encoding.UTF8;
            var app = new Application { ShutdownMode = ShutdownMode.OnExplicitShutdown };
            Run("EmptyState", EmptyState);
            Run("RunningCard", RunningCard);
            Run("PausedWithNotice", PausedWithNotice);
            Run("QueueAndHistoryOrder", QueueAndHistoryOrder);
            Run("DoneCardButtons", DoneCardButtons);
            Run("CardsAreReused", CardsAreReused);
            Run("NarrowAndWideShots", NarrowAndWideShots);
            Console.WriteLine();
            Console.WriteLine((_fail == 0 ? "PASS " : "FAIL ") + _pass + "/" + (_pass + _fail));
            Console.WriteLine("Зураг: " + OutDir);
            app.Shutdown();
            return _fail == 0 ? 0 : 1;
        }

        private static void Run(string name, Action test)
        {
            try
            {
                test();
                _pass++;
                Console.WriteLine("  ok   " + name);
            }
            catch (Exception ex)
            {
                _fail++;
                Console.WriteLine("  FAIL " + name + "\n       " + ex.GetType().Name + ": " + ex.Message);
            }
        }

        // ── Тестүүд ────────────────────────────────────────────────────────

        private static void EmptyState()
        {
            var (w, v, _) = Host(360, 300);
            v.Update(new List<CdJobCard>());
            Pump();
            True(Texts(v).Any(t => t.Contains("Одоогоор ажил алга")), "хоосон төлвийн бичвэр");
            Shot(w, "pane-empty");
            w.Close();
        }

        private static void RunningCard()
        {
            var (w, v, cmd) = Host(360, 420);
            v.Update(new List<CdJobCard> { Running(1) });
            Pump();
            List<Button> visible = VisibleButtons(v);
            True(visible.Any(b => Label(b) == "Түр зогсоох"), "явж буй ажилд «Түр зогсоох»");
            True(visible.Any(b => Label(b) == "Цуцлах"), "явж буй ажилд «Цуцлах»");
            True(!visible.Any(b => Label(b) == "Бүгдийг буцаах"), "явж буй ажилд «Бүгдийг буцаах» харагдахгүй");
            True(!visible.Any(b => Label(b) == "Үргэлжлүүлэх"), "явж буй ажилд «Үргэлжлүүлэх» харагдахгүй");
            ProgressBar bar = All<ProgressBar>(v).Single();
            Eq(52.0, Math.Round(bar.Value), "явцын мөр");
            True(Texts(v).Contains("52%"), "хувь");
            Click(visible.First(b => Label(b) == "Түр зогсоох"));
            Eq("pause:1", cmd.Calls.LastOrDefault(), "Түр зогсоох → Pause(1)");
            Shot(w, "pane-running");
            w.Close();
        }

        private static void PausedWithNotice()
        {
            var (w, v, cmd) = Host(360, 460);
            CdJobCard c = Running(2);
            c.State = CdCardState.Paused;
            c.Status = "Түр зогсоосон";
            c.Notice = "Ctrl+Z клонлолтын алхмыг буцаасан тул түр зогсоолоо.  «Үргэлжлүүлэх» дарвал буцсан хэсгийг дахин хийнэ.";
            v.Update(new List<CdJobCard> { c });
            Pump();
            List<Button> visible = VisibleButtons(v);
            True(visible.Any(b => Label(b) == "Үргэлжлүүлэх"), "зогссон ажилд «Үргэлжлүүлэх»");
            True(!visible.Any(b => Label(b) == "Түр зогсоох"), "зогссон ажилд «Түр зогсоох» харагдахгүй");
            True(Texts(v).Any(t => t.Contains("Ctrl+Z")), "шар мэдэгдэл харагдана");
            Click(visible.First(b => Label(b) == "Үргэлжлүүлэх"));
            Eq("resume:2", cmd.Calls.LastOrDefault(), "Үргэлжлүүлэх → Resume(2)");
            Shot(w, "pane-paused");
            w.Close();
        }

        private static void QueueAndHistoryOrder()
        {
            var (w, v, _) = Host(360, 700);
            CdJobCard done = Done(3);
            CdJobCard queued = Running(5);
            queued.State = CdCardState.Queued;
            queued.Title = "Багана «C1» → 5 элемент";
            CdJobCard active = Running(4);
            CdJobCard older = Done(1);
            older.State = CdCardState.Cancelled;
            v.Update(new List<CdJobCard> { done, queued, older, active });
            Pump();
            List<string> titles = Titles(v);
            Eq(4, titles.Count, "4 карт");
            Eq(active.Title, titles[0], "явж буй ажил хамгийн дээр");
            Eq(queued.Title, titles[1], "дараалал хоёрт");
            Eq(done.Title, titles[2], "дууссан (шинэ нь) гуравт");
            Eq(older.Title, titles[3], "хуучин дууссан хамгийн доор");
            Shot(w, "pane-queue");
            w.Close();
        }

        private static void DoneCardButtons()
        {
            var (w, v, cmd) = Host(360, 640);
            v.Update(new List<CdJobCard> { Done(7) });
            Pump();
            List<Button> visible = VisibleButtons(v);
            foreach (string b in new[] { "Эхний хуудсыг нээх", "Эхний харагдацыг нээх", "Бүгдийг буцаах", "Жагсаалтаас хасах" })
                True(visible.Any(x => Label(x) == b), "дууссан ажилд «" + b + "»");
            True(!visible.Any(x => Label(x) == "Цуцлах"), "дууссан ажилд «Цуцлах» харагдахгүй");
            Expander exp = All<Expander>(v).Single();
            True(exp.IsExpanded, "дуусмагц тайлан нээлттэй");
            True(All<TextBox>(v).Single().Text.Contains("ХАРАГДАЦ, ХУУДАС"), "тайлангийн бичвэр");
            Click(visible.First(x => Label(x) == "Эхний хуудсыг нээх"));
            Eq("sheet:7", cmd.Calls.LastOrDefault(), "хуудас нээх");
            Click(visible.First(x => Label(x) == "Жагсаалтаас хасах"));
            Eq("dismiss:7", cmd.Calls.LastOrDefault(), "жагсаалтаас хасах");

            // Буцаасны дараа: «Бүгдийг буцаах», нээх товч алга, мессеж харагдана.
            CdJobCard undone = Done(7);
            undone.CanUndo = false;
            undone.CanOpenSheet = false;
            undone.CanOpenView = false;
            undone.Message = "Буцаалаа: 32 харагдац, 8 хуудас, 120 тэмдэглэгээ устгав.";
            v.Update(new List<CdJobCard> { undone });
            Pump();
            visible = VisibleButtons(v);
            True(!visible.Any(x => Label(x) == "Бүгдийг буцаах"), "буцаасны дараа товч алга");
            True(Texts(v).Any(t => t.StartsWith("Буцаалаа")), "буцаалтын мессеж");
            Shot(w, "pane-done");
            w.Close();
        }

        private static void CardsAreReused()
        {
            var (w, v, _) = Host(360, 640);
            CdJobCard c = Running(9);
            v.Update(new List<CdJobCard> { c });
            Pump();
            Border first = All<Border>(v).First(b => b.CornerRadius.TopLeft == 4);
            c.Fraction = 0.9;
            c.Percent = 90;
            v.Update(new List<CdJobCard> { c });
            Pump();
            Border second = All<Border>(v).First(b => b.CornerRadius.TopLeft == 4);
            True(ReferenceEquals(first, second), "шинэчлэлт картыг дахин үүсгэхгүй (тайлан нээлттэй эсэх хадгалагдана)");
            True(Texts(v).Contains("90%"), "хувь шинэчлэгдсэн");
            // Дуусахад тайлан нээгдэнэ; хэрэглэгч хаасан бол дараагийн шинэчлэлт дахин нээхгүй.
            CdJobCard d = Done(9);
            v.Update(new List<CdJobCard> { d });
            Pump();
            Expander exp = All<Expander>(v).Single();
            True(exp.IsExpanded, "дуусмагц нээгдэнэ");
            exp.IsExpanded = false;
            v.Update(new List<CdJobCard> { d });
            Pump();
            True(!exp.IsExpanded, "хэрэглэгч хаасныг дахин нээхгүй");
            v.Update(new List<CdJobCard>());
            Pump();
            True(Texts(v).Any(t => t.Contains("Одоогоор ажил алга")), "бүх карт хасагдвал хоосон төлөв");
            w.Close();
        }

        private static void NarrowAndWideShots()
        {
            foreach (int width in new[] { 260, 340, 460 })
            {
                var (w, v, _) = Host(width, 900);
                CdJobCard q = Running(12);
                q.State = CdCardState.Queued;
                q.Title = "Багана «C1» → 5 элемент";
                CdJobCard f = Done(10);
                f.State = CdCardState.Failed;
                f.Status = "Загвар элемент устсан тул клонлолт зогслоо";
                v.Update(new List<CdJobCard> { Running(11), q, f });
                Pump();
                w.UpdateLayout();
                ScrollViewer sv = All<ScrollViewer>(v).First();
                True(sv.ExtentWidth <= sv.ViewportWidth + 1, "хэвтээ гүйлгэлтгүй (" + width + " px)");
                Shot(w, "pane-" + width);
                w.Close();
            }
        }

        // ── Хуурамч картууд ────────────────────────────────────────────────

        private static CdJobCard Running(int n) => new CdJobCard
        {
            Number = n,
            State = CdCardState.Running,
            Title = "Дам нуруу «B1» → 8 элемент",
            DocTitle = "Snowdon Towers Structural",
            Status = "B5 (5/8) · tag, хэмжээс: «B1 - Longitudinal»  (12/40)",
            Fraction = 0.52,
            Percent = 52,
            TimeLine = "4/8 элемент · 0:42 ажилласан · ≈0:38 үлдсэн",
            Counters = "харагдац 21 · хуудас 4 · tag 63 · хэмжээс 40",
        };

        private static CdJobCard Done(int n) => new CdJobCard
        {
            Number = n,
            State = CdCardState.Done,
            Title = "Дам нуруу «B1» → 8 элемент",
            DocTitle = "Snowdon Towers Structural",
            Status = "Дууслаа — 8 элементэд клонлов",
            Fraction = 1,
            Percent = 100,
            TimeLine = "14:32 · 1:24 зарцуулсан",
            Counters = "харагдац 32 · хуудас 8 · tag 96 · хэмжээс 64",
            Report = "8 элементэд зураг клонлов.\n\nХАРАГДАЦ, ХУУДАС\n• Шинэ харагдац: 32\n• Шинэ хуудас: 8   · байрлуулсан харагдац 32\n\n"
                     + "ТЭМДЭГЛЭГЭЭ\n• Tag: 96\n• Хэмжээс: 64\n\nБуцаах бол самбарын «Бүгдийг буцаах» товч — энэ клонлолтоор үүссэн бүхнийг нэг дор устгана.",
            CanOpenSheet = true,
            CanOpenView = true,
            CanUndo = true,
        };

        // ── Туслах ────────────────────────────────────────────────────────

        private static (Window, CdJobPaneView, FakeCommands) Host(int width, int height)
        {
            var v = new CdJobPaneView();
            var cmd = new FakeCommands();
            v.Attach(cmd);
            var w = new Window { Width = width, Height = height, Content = v, WindowStyle = WindowStyle.ToolWindow, ShowInTaskbar = false };
            w.Show();
            Pump();
            return (w, v, cmd);
        }

        private static string OutDir
        {
            get
            {
                string d = Environment.GetEnvironmentVariable("SMOKE_OUT");
                if (string.IsNullOrWhiteSpace(d)) d = Path.Combine(Path.GetTempPath(), "clone-uismoke");
                Directory.CreateDirectory(d);
                return d;
            }
        }

        private static void True(bool c, string msg) { if (!c) throw new Exception(msg); }

        private static void Eq<T>(T expected, T actual, string msg)
        {
            if (!EqualityComparer<T>.Default.Equals(expected, actual))
                throw new Exception(msg + " — expected=" + expected + " actual=" + actual);
        }

        private static IEnumerable<T> All<T>(DependencyObject root) where T : DependencyObject
        {
            var seen = new HashSet<DependencyObject>();
            var stack = new Stack<DependencyObject>();
            stack.Push(root);
            while (stack.Count > 0)
            {
                DependencyObject cur = stack.Pop();
                if (!seen.Add(cur)) continue;
                if (cur is T t) yield return t;
                if (cur is Visual)
                {
                    int n = VisualTreeHelper.GetChildrenCount(cur);
                    for (int i = 0; i < n; i++) stack.Push(VisualTreeHelper.GetChild(cur, i));
                }
                foreach (object child in LogicalTreeHelper.GetChildren(cur))
                {
                    if (child is DependencyObject d) stack.Push(d);
                }
            }
        }

        private static List<string> Texts(DependencyObject root) => All<TextBlock>(root).Where(IsShown).Select(t => t.Text).ToList();

        private static List<string> Titles(CdJobPaneView v)
        {
            // Картын эхний TextBlock = гарчиг; карт нь Tag="cd-card" Border (товчны загварын Border-оос ялгана).  Дэлгэцийн дарааллаар (Y).
            return All<Border>(v).Where(b => (b.Tag as string) == "cd-card" && IsShown(b))
                .OrderBy(b => b.TranslatePoint(new Point(0, 0), v).Y)
                .Select(b => ((StackPanel)b.Child).Children.OfType<TextBlock>().First().Text)
                .ToList();
        }

        private static List<Button> VisibleButtons(DependencyObject root) => All<Button>(root).Where(IsShown).ToList();

        private static bool IsShown(UIElement e)
        {
            for (DependencyObject cur = e; cur != null; cur = VisualTreeHelper.GetParent(cur) ?? LogicalTreeHelper.GetParent(cur))
            {
                if (cur is UIElement u && u.Visibility != Visibility.Visible)
                    return false;
            }
            return true;
        }

        private static string Label(Button b) => (b.Content as TextBlock)?.Text ?? b.Content as string;

        private static void Click(Button b)
        {
            Dispatcher.CurrentDispatcher.Invoke(() => b.RaiseEvent(new RoutedEventArgs(ButtonBase.ClickEvent, b)));
            Pump();
        }

        private static void Pump()
        {
            var frame = new DispatcherFrame();
            Dispatcher.CurrentDispatcher.BeginInvoke(DispatcherPriority.ApplicationIdle, new Action(() => frame.Continue = false));
            Dispatcher.PushFrame(frame);
        }

        private static void Shot(Window w, string name)
        {
            w.UpdateLayout();
            Pump();
            var rtb = new RenderTargetBitmap((int)w.ActualWidth, (int)w.ActualHeight, 96, 96, PixelFormats.Pbgra32);
            rtb.Render(w);
            var enc = new PngBitmapEncoder();
            enc.Frames.Add(BitmapFrame.Create(rtb));
            using (FileStream fs = File.Create(Path.Combine(OutDir, name + ".png")))
                enc.Save(fs);
        }
    }
}
