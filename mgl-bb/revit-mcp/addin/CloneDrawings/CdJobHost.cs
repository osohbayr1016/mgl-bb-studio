using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Events;
using Autodesk.Revit.UI;
using Autodesk.Revit.UI.Events;
using RevitMcpAddin.CloneDrawings.Core;

namespace RevitMcpAddin.CloneDrawings
{
    /// <summary>
    /// АРЫН ГОРИМЫН хост (2026-10-01 «Зураг хувилах»; 2026-10-07-оос «Ханын дэлгээс» ч — <see cref="IMglJob"/>) — хувилалтын дараалал, Revit-ийн Idling дээр алхам алхмаар
    /// гүйцэтгэх, явцын самбар.
    ///
    /// ЯАГААД Idling (ExternalEvent биш): Revit-ийн баримт — Idling нь «хэрэглэгч товч дарж чадах» үед л дуудагдана,
    /// аль ч баримтыг transaction-оор өөрчилж болно, ба <c>SetRaiseWithoutDelay</c> дуудсан үед хэрэглэгч хөдлөхгүй
    /// байсан ч тасралтгүй дуудагдана.  ExternalEvent-ийн Raise нь хэрэглэгч хулгана хөдөлгөтөл «Pending» хүлээдэг
    /// нь хэмжигдсэн (Revit VS Code-ийн ард байхад) — урт ажил тасалдана.
    ///
    /// ГЭРЭЭ:
    ///   • Нэг Idling дуудлагад ≈<see cref="SliceMs"/> мс ажил (хамгийн багадаа нэг алхам), дараа нь Revit хэрэглэгчийн
    ///     оролтыг боловсруулна — тиймээс Revit «гацахгүй».  Командын модаль цонх, засварлах горим (sketch), бусад
    ///     команд идэвхтэй үед Revit Idling дуудахгүй → хувилалт өөрөө хүлээнэ.
    ///   • Нэг удаад НЭГ ажил; бусад нь дараалалд.  Самбарын товч (түр зогсоох, цуцлах) Revit API дуудахгүй — зөвхөн
    ///     төлөв; API шаардах үйлдэл (нээх, буцаах) <see cref="Post"/>-оор дараагийн Idling-д.
    ///   • Бүртгэл (Idling, DocumentChanged, DocumentClosed) ЗӨВХӨН OnStartup-д (<see cref="Init"/>).  Ажил байхгүй үед
    ///     Idling-д юу ч хийхгүй, <c>SetRaiseWithoutDelay</c> дуудахгүй — CPU ачаалахгүй.
    /// </summary>
    internal static class CdJobHost
    {
        /// <summary>Нэг Idling дуудлагад өгөх ажлын хугацаа (мс).  Хэрэглэгчийн оролт хамгийн ихдээ ийм удаан хүлээнэ (алхам урт биш бол).</summary>
        internal const int SliceMs = 150;
        /// <summary>Дууссан ажлын картыг хэдийг хадгалах (тайлан, «Бүгдийг буцаах»).</summary>
        private const int KeepFinished = 5;

        private static readonly List<IMglJob> Jobs = new List<IMglJob>();
        private static readonly Dictionary<int, string> Messages = new Dictionary<int, string>();
        private static readonly Queue<Action<UIApplication>> Actions = new Queue<Action<UIApplication>>();
        private static UIControlledApplication _app;
        private static bool _busy;

        internal static bool IsReady { get; private set; }

        /// <summary>Самбар шинэчлэх дохио (Revit-ийн үндсэн thread дээр).</summary>
        internal static event Action Changed;

        internal static void Init(UIControlledApplication app)
        {
            if (IsReady || app == null)
                return;
            _app = app;
            app.Idling += OnIdling;
            app.ControlledApplication.DocumentChanged += OnDocumentChanged;
            app.ControlledApplication.DocumentClosed += OnDocumentClosed;
            IsReady = true;
        }

        internal static void Shutdown()
        {
            if (!IsReady)
                return;
            IsReady = false;
            foreach (IMglJob j in Jobs)
            {
                if (!j.IsFinished)
                    j.Cancel("Revit хаагдсан");
            }
            try { _app.Idling -= OnIdling; } catch { }
            try { _app.ControlledApplication.DocumentChanged -= OnDocumentChanged; } catch { }
            try { _app.ControlledApplication.DocumentClosed -= OnDocumentClosed; } catch { }
            Actions.Clear();
        }

        /// <summary>Явагдаж буй эсвэл дараалалд байгаа ажил бий юу.</summary>
        internal static IMglJob Busy => Jobs.FirstOrDefault(j => !j.IsFinished);

        internal static void Enqueue(IMglJob job)
        {
            job.Background = true;
            Jobs.Add(job);
            Trim();
            RaiseChanged();
        }

        /// <summary>Revit API шаардах үйлдлийг дараагийн Idling-д (API контекст).</summary>
        internal static void Post(Action<UIApplication> action)
        {
            if (action != null)
                Actions.Enqueue(action);
        }

        internal static IMglJob Find(int number) => Jobs.FirstOrDefault(j => j.Number == number);

        /// <summary>Дууссан картыг хасна — Idling-д (жагсаалтыг алхмын дунд өөрчлөхгүй).</summary>
        internal static void Dismiss(int number)
        {
            Post(app =>
            {
                IMglJob j = Find(number);
                if (j != null && j.IsFinished)
                {
                    Jobs.Remove(j);
                    Messages.Remove(number);
                }
            });
        }

        internal static void SetMessage(int number, string message)
        {
            if (string.IsNullOrEmpty(message))
                Messages.Remove(number);
            else
                Messages[number] = message;
            RaiseChanged();
        }

        internal static void RaiseChanged()
        {
            try { Changed?.Invoke(); }
            catch { }
        }

        /// <summary>Самбарыг харуулна (Revit API контекстод).  Самбар бүртгэгдээгүй бол false.</summary>
        internal static bool ShowPane(UIApplication app)
        {
            try
            {
                DockablePane pane = app?.GetDockablePane(CdJobPaneProvider.PaneId);
                if (pane == null)
                    return false;
                if (!pane.IsShown())
                    pane.Show();
                return true;
            }
            catch
            {
                return false;
            }
        }

        private static void Trim()
        {
            List<IMglJob> finished = Jobs.Where(j => j.IsFinished).OrderByDescending(j => j.Number).ToList();
            foreach (IMglJob old in finished.Skip(KeepFinished))
            {
                Jobs.Remove(old);
                Messages.Remove(old.Number);
            }
        }

        // ── Idling ─────────────────────────────────────────────────────────

        private static void OnIdling(object sender, IdlingEventArgs e)
        {
            if (_busy || !IsReady)
                return;
            if (Actions.Count == 0 && !Jobs.Any(j => j.State == CdJobState.Running || j.State == CdJobState.Queued))
                return; // юу ч хийх алга — Revit-ийн энгийн idle рүү
            _busy = true;
            bool changed = false;
            try
            {
                var uiapp = sender as UIApplication;
                while (Actions.Count > 0)
                {
                    Action<UIApplication> a = Actions.Dequeue();
                    try { a(uiapp); }
                    catch (Exception ex) { Debug.WriteLine("[CdJobHost] action: " + ex.Message); }
                    changed = true;
                }

                IMglJob job = NextRunnable();
                if (job != null)
                {
                    var sw = Stopwatch.StartNew();
                    do
                    {
                        long left = Math.Max(1, SliceMs - sw.ElapsedMilliseconds);
                        job.Step(left);
                        changed = true;
                        if (job.IsFinished)
                        {
                            OnFinished(job, uiapp);
                            job = NextRunnable();
                        }
                    }
                    while (job != null && job.State == CdJobState.Running && !job.WaitingForRevit && sw.ElapsedMilliseconds < SliceMs);

                    // Ажил үлдсэн бол Revit Idling-ийг ДАРУЙ дахин дуудна (хэрэглэгч хөдлөхгүй байсан ч) — алхмын
                    // хооронд хэрэглэгчийн оролт эхэлж боловсрогдоно.  Дуудахгүй бол Revit анхдагч горимдоо буцна.
                    // Revit transaction хүлээж авахгүй байвал (засварлах горим) шууд дахин дуудуулахгүй — хэрэглэгчийн дараагийн
                    // үйлдлийн дараах Idling-д оролдоно (эс бөгөөс CPU-г дэмий эргүүлнэ).
                    if (job != null && job.State == CdJobState.Running && !job.WaitingForRevit)
                        e.SetRaiseWithoutDelay();
                }
            }
            catch (Exception ex)
            {
                Debug.WriteLine("[CdJobHost] idling: " + ex.Message);
            }
            finally
            {
                _busy = false;
            }
            if (changed)
                RaiseChanged();
        }

        /// <summary>Явагдаж буй ажил (түр зогссон бол null — дараалал хүлээнэ); байхгүй бол дараалалын эхнийхийг эхлүүлнэ.</summary>
        private static IMglJob NextRunnable()
        {
            IMglJob active = Jobs.FirstOrDefault(j => j.State == CdJobState.Running || j.State == CdJobState.Paused);
            if (active != null)
                return active.State == CdJobState.Running ? active : null;
            IMglJob next = Jobs.FirstOrDefault(j => j.State == CdJobState.Queued);
            if (next == null)
                return null;
            if (!next.DocAlive)
            {
                next.Cancel("Файл хаагдсан тул эхлүүлээгүй");
                return NextRunnable();
            }
            next.Start();
            return next;
        }

        private static void OnFinished(IMglJob job, UIApplication uiapp)
        {
            Trim();
            try { job.Finished(uiapp); }
            catch (Exception ex) { Debug.WriteLine("[CdJobHost] finished: " + ex.Message); }
            // Дууссаныг харуулна — хэрэглэгч самбарыг хаасан байсан ч тайлан харагдана.
            if (!ShowPane(uiapp))
            {
                // Самбар бүртгэгдээгүй (хуучин Revit г.м.) — тайланг цонхоор.
                try
                {
                    TaskDialog.Show("MGL — Ажлын явц", job.Title + "\n\n" + job.FinalReport);
                }
                catch { }
            }
        }

        // ── Revit-ийн өөрчлөлт ─────────────────────────────────────────────

        private static void OnDocumentChanged(object sender, DocumentChangedEventArgs e)
        {
            // ⚠️ Apply-ийн хойшлуулсан commit энд ДАХИН ТОГЛОГДОХГҮЙ: «Зураг клонлох» нь ӨӨРИЙН нэмсэн элементүүдийг л хянадаг (хана зөөлт нь нэмэлт БИШ).
            if (Jobs.Count == 0 || ImpactSimulationScope.Suppressed)
                return;
            bool changed = false;
            try
            {
                Document d = e.GetDocument();
                foreach (IMglJob j in Jobs.ToArray())
                {
                    // Дууссан ажилд ч дамжуулна — «Бүгдийг буцаах»-ын жагсаалтыг Ctrl+Z/Y-тэй уялдуулна (CdJob.TrackCreated).
                    if (j.Undone || !j.SameDoc(d))
                        continue;
                    CdJobState before = j.State;
                    j.OnDocumentChanged(e);
                    changed |= j.State != before;
                }
            }
            catch { }
            if (changed)
                RaiseChanged();
        }

        private static void OnDocumentClosed(object sender, DocumentClosedEventArgs e)
        {
            bool changed = false;
            foreach (IMglJob j in Jobs.ToArray())
            {
                if (!j.IsFinished && !j.DocAlive)
                {
                    j.Cancel("Файл хаагдсан тул ажил зогслоо");
                    changed = true;
                }
            }
            if (changed)
                RaiseChanged();
        }

        // ── Самбарын агшин зураг ───────────────────────────────────────────

        internal static List<CdJobCard> Cards()
        {
            var list = new List<CdJobCard>();
            foreach (IMglJob j in Jobs)
            {
                try
                {
                    CdJobCard c = j.Card();
                    if (Messages.TryGetValue(j.Number, out string m)) c.Message = m;
                    list.Add(c);
                }
                catch { }
            }
            return list;
        }

        internal static CdJobCard ToCard(CdJob j)
        {
            CdReport r = j.Report;
            double f = j.Fraction;
            var card = new CdJobCard
            {
                Number = j.Number,
                State = ToCardState(j.State),
                Title = j.Title,
                DocTitle = j.DocTitle,
                Status = j.Status,
                Notice = j.Notice,
                Fraction = f,
                Percent = JobProgress.Percent(f),
                Counters = Counters(j),
                Message = Messages.TryGetValue(j.Number, out string m) ? m : j.UndoResult,
                CanOpenSheet = r.FirstSheetId != null && !j.Undone,
                CanOpenView = r.FirstViewId != null && !j.Undone,
                CanUndo = j.Background && !j.Undone && j.Created.Count > 0,
                // «Өмнөх клоныг устгаж шинээр»: буцаахад өмнөх клон сэргэхгүй — элементүүд клонгүй үлдэнэ.
                UndoWarning = r.ViewsDeleted > 0
                    ? "⚠ Энэ хувилалт «Өмнөх клоныг устгаж шинээр» горимоор өмнө байсан " + r.ViewsDeleted + " клон харагдац/хуудсыг "
                      + "устгаад шинээр үүсгэсэн.  «Бүгдийг буцаах» нь зөвхөн ШИНЭ клоныг устгана — устгасан өмнөх клон буцаж "
                      + "сэргэхгүй (элементүүд клонгүй үлдэнэ; хэрэгтэй бол дахин клонлоно)."
                    : null,
            };
            if (j.IsFinished)
            {
                card.Report = r.Summary(j.Background);
                string took = JobProgress.Duration(TimeSpan.FromMilliseconds(j.ActiveMs));
                card.TimeLine = (j.FinishedAt.HasValue ? j.FinishedAt.Value.ToString("HH:mm") + " · " : "") + took + " зарцуулсан";
            }
            else if (j.State == CdJobState.Queued)
            {
                card.TimeLine = "Өмнөх хувилалт дуусахыг хүлээж байна";
            }
            else
            {
                TimeSpan? left = j.Remaining;
                card.TimeLine = j.TargetsFinished + "/" + j.TargetCount + " элемент · "
                                + JobProgress.Duration(TimeSpan.FromMilliseconds(j.ActiveMs)) + " ажилласан"
                                + (left.HasValue ? " · ≈" + JobProgress.Duration(left.Value) + " үлдсэн" : "");
            }
            return card;
        }

        private static string Counters(CdJob j)
        {
            CdReport r = j.Report;
            var parts = new List<string>();
            if (r.ViewsCreated + r.ViewsReused > 0)
                parts.Add("харагдац " + r.ViewsCreated + (r.ViewsReused > 0 ? " (+" + r.ViewsReused + " өмнөх)" : ""));
            if (r.SheetsCreated > 0)
                parts.Add("хуудас " + r.SheetsCreated);
            if (r.Tags > 0)
                parts.Add("tag " + r.Tags);
            if (r.Dims > 0)
                parts.Add("хэмжээс " + r.Dims);
            if (r.Errors.Count > 0)
                parts.Add("алдаа " + r.Errors.Count);
            return parts.Count == 0 ? null : string.Join(" · ", parts);
        }

        private static CdCardState ToCardState(CdJobState s)
        {
            switch (s)
            {
                case CdJobState.Running: return CdCardState.Running;
                case CdJobState.Paused: return CdCardState.Paused;
                case CdJobState.Queued: return CdCardState.Queued;
                case CdJobState.Done: return CdCardState.Done;
                case CdJobState.Cancelled: return CdCardState.Cancelled;
                default: return CdCardState.Failed;
            }
        }
    }

    /// <summary>Самбарын товчнууд → хост.  Төлөв солих нь шууд (API-гүй); нээх, буцаах нь Idling-д.</summary>
    internal sealed class CdJobCommands : ICdJobCommands
    {
        public void Pause(int job)
        {
            CdJobHost.Find(job)?.Pause();
            CdJobHost.RaiseChanged();
        }

        public void Resume(int job)
        {
            CdJobHost.Find(job)?.Resume();
            CdJobHost.RaiseChanged();
        }

        public void Cancel(int job)
        {
            CdJobHost.Find(job)?.Cancel();
            CdJobHost.RaiseChanged();
        }

        public void UndoAll(int job)
        {
            CdJobHost.SetMessage(job, "Буцааж байна…");
            CdJobHost.Post(app =>
            {
                IMglJob j = CdJobHost.Find(job);
                CdJobHost.SetMessage(job, j == null ? null : j.UndoAll());
            });
        }

        public void OpenSheet(int job) => Open(job, true);

        public void OpenView(int job) => Open(job, false);

        private static void Open(int job, bool sheet)
        {
            CdJobHost.Post(app =>
            {
                IMglJob j = CdJobHost.Find(job);
                string msg = null;
                try { msg = j?.Open(app, sheet); }
                catch (Exception ex) { msg = "Нээж чадсангүй: " + ex.Message; }
                if (msg != null)
                    CdJobHost.SetMessage(job, msg);
            });
        }

        public void Dismiss(int job) => CdJobHost.Dismiss(job);
    }

    /// <summary>
    /// «MGL — Ажлын явц» бэхлэгддэг самбар (зураг хувилах, ханын дэлгээс).  ⚠️ GUID ТОГТМОЛ (Revit байрлалыг үүгээр санадаг) — хэзээ ч бүү соль.
    /// ⚠️ <c>RegisterDockablePane</c> ЗӨВХӨН OnStartup-д (App.cs).  Анх удаа харагдахгүй — хувилалт эхлэхэд гарна.
    /// </summary>
    public sealed class CdJobPaneProvider : IDockablePaneProvider
    {
        public static readonly Guid PaneGuid = new Guid("3f3d4d16-dd6a-44b2-81b4-bc9de7fa287c");

        public static DockablePaneId PaneId => new DockablePaneId(PaneGuid);

        private static CdJobPaneView _view;

        public static CdJobPaneView View
        {
            get
            {
                if (_view == null)
                {
                    _view = new CdJobPaneView();
                    _view.Attach(new CdJobCommands());
                    CdJobHost.Changed += Refresh;
                    Refresh();
                }
                return _view;
            }
        }

        private static void Refresh()
        {
            try { _view?.Update(CdJobHost.Cards()); }
            catch (Exception ex) { Debug.WriteLine("[CdJobPane] " + ex.Message); }
        }

        public void SetupDockablePane(DockablePaneProviderData data)
        {
            data.FrameworkElement = View;
            data.VisibleByDefault = false;
            data.InitialState = new DockablePaneState { DockPosition = DockPosition.Right };
        }
    }
}
