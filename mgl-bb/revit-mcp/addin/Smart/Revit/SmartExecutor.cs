using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.Threading;
using System.Threading.Tasks;
using Autodesk.Revit.UI;
using RevitMcpAddin.Smart.Core;

namespace RevitMcpAddin.Smart
{
    /// <summary>
    /// ХЭСЭГЛЭСЭН ажил — нэг `Step` = Revit-ийн үндсэн thread дээрх БАГА хэмжээний ажил
    /// (нэг хуудас экспортлох, 200 элемент уншиж DTO болгох, нэг хос геометр шалгах).
    ///
    /// ГЭРЭЭ:
    ///   • `Step` бүр БИЕ ДААСАН: транзакц `Step`-ийн ГАДУУР хэзээ ч нээлттэй үлдэхгүй.
    ///     Цуцлалт `Step`-ийн ХООРОНД л хийгддэг тул энэ нь «транзакцийн дундуур
    ///     цуцлах» боломжгүй болгодог.
    ///   • `Step` нь Revit-ийн амьд обьектыг (Element, View, Solid...) дараагийн `Step`-д
    ///     ХАДГАЛАХ ёсгүй (хуучирч болно; хэрэглэгч тэр завсар загварыг засна).  Нэг
    ///     `Step`-ээс нөгөөд зөвхөн ХУУЛСАН DTO / long id дамжуулна.
    /// </summary>
    internal interface ISmartJob
    {
        string Name { get; }

        /// <summary>Нэг хэсэг ажил.  true = ДУУССАН.</summary>
        bool Step(UIApplication app);

        /// <summary>Цуцлагдсан үед (Step-ийн хооронд) нэг удаа дуудагдана — түр нөөц цэвэрлэх.</summary>
        void OnCancelled();
    }

    /// <summary>
    /// «MGL Smart»-ын REVIT-ИЙН ҮНДСЭН THREAD ГАРЦ — модальгүй (modeless) цонхнууд Revit API-д
    /// хандах ЦОРЫН ГАНЦ зам.
    ///
    /// ЯАГААД ӨӨРИЙН ExternalEvent: `RevitToolBus` нь нэрлэсэн typed хэрэгсэл + глобал `Gate`
    /// семафортой (чат/QTO-д зориулсан); Smart-ын ажил (экспорт, clash шалгалт) хэдэн
    /// секундээс минут үргэлжилж болох тул тэр семафорыг барьж чатыг түгжих ёсгүй
    /// (`FamilyHubExternalEvent`-ийн ижил шалтгаан).
    ///
    /// ГЭРЭЭ:
    ///   • ЭХЛЭЭД `Init()` — ЗӨВХӨН хүчинтэй API контекстод (`App.OnStartup`).
    ///   • Revit-ийн үндсэн thread-ээс `.Wait()`/`.Result` ХИЙЖ БОЛОХГҮЙ: ExternalEvent тэр
    ///     thread дээр л ажилладаг тул өөрийгөө хүлээж гацна.  Цонхнууд `await` хэрэглэнэ.
    ///   • `Execute` НЭГ Ч УДАА шидэхгүй: Revit нь handler алдаа гаргавал ExternalEvent-ийг
    ///     `Denied` болгодог (баримтжуулсан) — бүх алдаа тухайн ажлын Task руу очно.
    ///   • ХЭСЭГЛЭСЭН ажил `SliceMs` (150 мс) тутамд Revit-д амьсгал өгнө: үлдсэн ажлыг
    ///     дараалалын сүүлд буцааж, `Raise()`-ийг дахин дуудна.  Ингэснээр урт ажлын үеэр
    ///     Revit-ийн UI хариу өгч, прогресс шинэчлэгдэж, «Цуцлах» дарагдана.
    ///   • `Raise()` нь `Pending` (өмнөх нь хүлээгдэж байна — handler дараалал шавхана, OK),
    ///     `Denied`/`TimedOut` (модаль цонх, синхрончлолын асуудал) үед хугацаатай дахин
    ///     оролдоно.  Revit нь add-in-ийн модаль цонх нээлттэй үед external event
    ///     ГҮЙЦЭТГЭХГҮЙ (баримтжуулсан) — тэнд цонхнууд өөрсдөө API контекстэд ажилладаг.
    /// </summary>
    internal sealed class SmartExecutor : IExternalEventHandler
    {
        /// <summary>Нэг `Execute` дотор хэсэглэсэн ажилд өгөх хугацаа (мс).</summary>
        internal const int SliceMs = 150;

        private abstract class JobBox
        {
            public CancellationToken Ct;
            public abstract string Name { get; }
            /// <summary>true = дууссан (амжилт/алдаа/цуцлал аль нь ч).</summary>
            public abstract bool RunSlice(UIApplication app, Stopwatch sw);
            public abstract void Cancel();
            public abstract void Fault(Exception ex);
        }

        private sealed class OneShot<T> : JobBox
        {
            public Func<UIApplication, T> Work;
            public TaskCompletionSource<T> Tcs;
            public string Label;
            public override string Name { get { return Label ?? "work"; } }

            public override bool RunSlice(UIApplication app, Stopwatch sw)
            {
                T result = Work(app);
                Tcs.TrySetResult(result);
                return true;
            }

            public override void Cancel() { Tcs.TrySetCanceled(Ct); }
            public override void Fault(Exception ex) { Tcs.TrySetException(ex); }
        }

        private sealed class Stepped : JobBox
        {
            public ISmartJob Job;
            public TaskCompletionSource<bool> Tcs;
            public override string Name { get { return Job.Name; } }

            public override bool RunSlice(UIApplication app, Stopwatch sw)
            {
                // Хамгийн багадаа НЭГ Step: хугацаа нь өмнөх ажлаар дууссан байсан ч урагшилна.
                bool done;
                do
                {
                    done = Job.Step(app);
                }
                while (!done && !Ct.IsCancellationRequested && sw.ElapsedMilliseconds < SliceMs);

                if (Ct.IsCancellationRequested && !done)
                {
                    Cancel();
                    return true;
                }
                if (done) Tcs.TrySetResult(true);
                return done;
            }

            public override void Cancel()
            {
                try { Job.OnCancelled(); }
                catch (Exception ex) { SmartLog.Warn("executor", "cancel_cleanup_failed", new { job = Job.Name, ex = ex.GetType().Name }); }
                Tcs.TrySetCanceled(Ct);
            }

            public override void Fault(Exception ex)
            {
                // Step exception шидсэн ч ажил түр нөөц (кэш, түр цонх, зургийн/геометрийн нөөц) үлдээсэн байж болно — цуцлалттай ИЖИЛ цэвэрлэгээ.
                try { Job.OnCancelled(); }
                catch (Exception cx) { SmartLog.Warn("executor", "fault_cleanup_failed", new { job = Job.Name, ex = cx.GetType().Name }); }
                Tcs.TrySetException(ex);
            }
        }

        private static SmartExecutor _instance;
        private static ExternalEvent _event;
        private static Timer _retry;
        private static Timer _followUp;
        private static int _retryDelayMs = 250;
        /// <summary>`Raise()`-ийн `Accepted` БИШ эхний хэдэн үр дүнг (Pending / Denied / TimedOut) логлоно — бодит Revit дээр юу болдгийг гараар шалгахад.</summary>
        private static int _raiseLogBudget = 20;

        // Сэрээлт алдагдахаас хамгаалах «харуул»: дараалал хоосон БИШ атлаа удаан хугацаанд нэг ч Execute болоогүй бол дахин Raise хийнэ.
        // `Raise()`-ийн `Pending` нь «өмнөх хүсэлт хүлээгдэж байна, дараалал шавхагдана» гэж ТАВ ТУХТАЙ баримтжуулагдаагүй тул хоёр дахь
        // хамгаалалт: нэмэлт Raise нь хор хөнөөлгүй (Pending/Accepted) бөгөөд хоосон дараалалтай Execute нь шууд буцна.
        private const int WatchdogMs = 3000;
        private static Timer _watchdog;
        private static long _executeCount;
        private static long _watchdogSeen;
        private static long _watchdogLogTicks;

        private readonly ConcurrentQueue<JobBox> _queue = new ConcurrentQueue<JobBox>();

        internal static bool IsReady { get { return _event != null; } }

        /// <summary>Хүчинтэй API контекстээс (OnStartup) НЭГ удаа.</summary>
        internal static void Init()
        {
            if (_event != null) return;
            _instance = new SmartExecutor();
            _event = ExternalEvent.Create(_instance);
            _watchdog = new Timer(WatchdogTick, null, WatchdogMs, WatchdogMs);
        }

        private static void WatchdogTick(object state)
        {
            try
            {
                SmartExecutor inst = _instance;
                long executed = Interlocked.Read(ref _executeCount);
                if (inst == null || inst._queue.IsEmpty)
                {
                    _watchdogSeen = executed;
                    return;
                }

                // Дараалалд ажил байна, өмнөх тикээс хойш нэг ч Execute болоогүй → сэрээлт алдагдсан эсвэл Revit завгүй (модаль цонх).
                if (executed == _watchdogSeen)
                {
                    long nowTicks = DateTime.UtcNow.Ticks;
                    if (nowTicks - Interlocked.Read(ref _watchdogLogTicks) > TimeSpan.FromSeconds(30).Ticks)
                    {
                        Interlocked.Exchange(ref _watchdogLogTicks, nowTicks);
                        SmartLog.Warn("executor", "watchdog_reraise", new { queued = inst._queue.Count });
                    }
                    RaiseOrRetry();
                }
                _watchdogSeen = executed;
            }
            catch (Exception)
            {
                // Харуул ХЭЗЭЭ Ч унахгүй — дараагийн тикээр дахин оролдоно.
            }
        }

        internal static void Shutdown()
        {
            try { if (_watchdog != null) _watchdog.Dispose(); } catch (Exception) { }
            _watchdog = null;
            try { if (_retry != null) _retry.Dispose(); } catch (Exception) { }
            _retry = null;
            try { if (_followUp != null) _followUp.Dispose(); } catch (Exception) { }
            _followUp = null;
            // ⚠️ ExternalEvent-ийг DISPOSE ХИЙХГҮЙ — Revit хаагдах үед өөрөө цэвэрлэнэ
            // (`RevitToolBus.Shutdown`-ийн ижил дүрэм).
            SmartExecutor inst = _instance;
            if (inst != null)
            {
                JobBox j;
                while (inst._queue.TryDequeue(out j)) { try { j.Cancel(); } catch (Exception) { } }
            }
        }

        /// <summary>Нэг удаагийн богино ажил.  Үр дүн нь Task-аар (UI thread-д `await`).</summary>
        internal static Task<T> Run<T>(Func<UIApplication, T> work, CancellationToken ct = default(CancellationToken), string name = null)
        {
            if (_event == null) throw new InvalidOperationException("MGL Smart гарц эхлээгүй");
            var tcs = new TaskCompletionSource<T>(TaskCreationOptions.RunContinuationsAsynchronously);
            var box = new OneShot<T> { Work = work, Tcs = tcs, Ct = ct, Label = name };
            Enqueue(box);
            return tcs.Task;
        }

        /// <summary>Хэсэглэсэн урт ажил.  Task нь дуусах/цуцлагдах/алдах үед биелнэ.</summary>
        internal static Task RunSteps(ISmartJob job, CancellationToken ct = default(CancellationToken))
        {
            if (_event == null) throw new InvalidOperationException("MGL Smart гарц эхлээгүй");
            var tcs = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
            var box = new Stepped { Job = job, Tcs = tcs, Ct = ct };
            Enqueue(box);
            return tcs.Task;
        }

        private static void Enqueue(JobBox box)
        {
            _instance._queue.Enqueue(box);
            RaiseOrRetry();
        }

        private static void RaiseOrRetry()
        {
            ExternalEvent ev = _event;
            if (ev == null) return;
            ExternalEventRequest r;
            try { r = ev.Raise(); }
            catch (Exception ex)
            {
                SmartLog.Warn("executor", "raise_threw", new { ex = ex.GetType().Name });
                r = ExternalEventRequest.TimedOut;
            }

            if (r != ExternalEventRequest.Accepted && Interlocked.Decrement(ref _raiseLogBudget) >= 0)
                SmartLog.Info("executor", "raise_result", new { result = r.ToString(), queued = _instance != null ? _instance._queue.Count : 0 });

            if (r == ExternalEventRequest.Accepted || r == ExternalEventRequest.Pending)
            {
                _retryDelayMs = 250;
                return;
            }

            // Denied / TimedOut — Revit завгүй (модаль цонх г.м.).  Дараалал хоосон болтол дахин оролдоно.
            int delay = _retryDelayMs;
            _retryDelayMs = Math.Min(2000, _retryDelayMs * 2);
            try
            {
                if (_retry != null) _retry.Dispose();
                _retry = new Timer(_ =>
                {
                    SmartExecutor inst = _instance;
                    if (inst != null && !inst._queue.IsEmpty) RaiseOrRetry();
                }, null, delay, Timeout.Infinite);
            }
            catch (ObjectDisposedException) { }
        }

        public void Execute(UIApplication app)
        {
            // ⚠️ Энэ арга ШИДЭХ ЁСГҮЙ (дээрх тайлбар) — гаднах try нь сүүлийн хамгаалалт.
            Interlocked.Increment(ref _executeCount);       // харуулд «Revit ажиллаж байна» гэдгийг мэдэгдэнэ
            try
            {
                var carry = new List<JobBox>();
                var sw = Stopwatch.StartNew();
                int budget = _queue.Count;   // энэ тойрогт ЗӨВХӨН одоо байгаа ажлууд (шинээр ирэх нь дараагийн тойрогт)

                JobBox job;
                for (int i = 0; i < budget && _queue.TryDequeue(out job); i++)
                {
                    if (job.Ct.IsCancellationRequested)
                    {
                        SafeCancel(job);
                        continue;
                    }

                    bool finished;
                    try
                    {
                        finished = job.RunSlice(app, sw);
                    }
                    catch (Exception ex)
                    {
                        SmartLog.Error("executor", "job_faulted", ex, new { job = job.Name });
                        try { job.Fault(ex); } catch (Exception) { }
                        finished = true;
                    }

                    if (!finished) carry.Add(job);
                    sw.Restart();   // ажил бүр өөрийн хугацааны хэсэгтэй
                }

                foreach (JobBox c in carry) _queue.Enqueue(c);
                if (!_queue.IsEmpty)
                {
                    RaiseOrRetry();
                    ScheduleFollowUp();
                }
            }
            catch (Exception ex)
            {
                SmartLog.Error("executor", "execute_failed", ex);
            }
        }

        /// <summary>
        /// `Execute` ДОТОРООС хийсэн `Raise()` нь `Pending` буцааж болох бөгөөд (өмнөх хүсэлт «хараахан дуусаагүй» тул) тэр үед дараагийн Execute
        /// ирэхийг баталгаажуулах баримтжуулалт байхгүй.  Execute БУЦСАНЫ ДАРАА богино саатлаар дахин `Raise()` хийнэ — харуул (3 сек)-ийг хүлээлгүйгээр
        /// хэсэглэсэн ажил (Step бүр ~150 мс) тасралтгүй урагшилна.  Нэмэлт `Raise()` нь хор хөнөөлгүй (Accepted/Pending), хоосон дараалалтай Execute шууд буцна.
        /// </summary>
        private static void ScheduleFollowUp()
        {
            try
            {
                if (_followUp != null) _followUp.Dispose();
                _followUp = new Timer(_ =>
                {
                    SmartExecutor inst = _instance;
                    if (inst != null && !inst._queue.IsEmpty) RaiseOrRetry();
                }, null, 80, Timeout.Infinite);
            }
            catch (ObjectDisposedException) { }
        }

        private static void SafeCancel(JobBox job)
        {
            try { job.Cancel(); }
            catch (Exception ex) { SmartLog.Warn("executor", "cancel_failed", new { ex = ex.GetType().Name }); }
        }

        public string GetName() { return "MGL Smart"; }
    }
}
