using System;
using System.Collections.Concurrent;
using System.Threading;
using System.Threading.Tasks;
using Autodesk.Revit.UI;

namespace RevitMcpAddin.FamilyHub.Revit
{
    /// <summary>
    /// Family Hub-ийн ӨӨРИЙН ExternalEvent — `RevitToolBus`-аас ТУСДАА, зориуд:
    /// тэр нь нэрлэсэн typed хэрэгслүүд + глобал `Gate` семафортой бөгөөд энэ
    /// POC-ийн ажил (family ачаалах, байрлуулалтын prompt — хэдэн секунд/минут
    /// үргэлжилж болно) тэр семафорыг барьж чат/QTO-г түгжих ёсгүй.
    ///
    /// `ExternalEvent.Create` нь ЗӨВХӨН хүчинтэй API контекстэд (OnStartup эсвэл
    /// команд/handler дотор) ажилладаг тул `Ensure` нь `FamilyHubCommand.Execute`
    /// -ээс дуудагдана — App.cs-д хөндөх зүйл нэмэхгүй.
    /// </summary>
    internal sealed class FamilyHubExternalEvent : IExternalEventHandler
    {
        private sealed class Job
        {
            public Func<UIApplication, object> Work;
            public TaskCompletionSource<object> Tcs;
            public CancellationToken Ct;
        }

        private static FamilyHubExternalEvent _instance;
        private static ExternalEvent _event;
        private readonly ConcurrentQueue<Job> _queue = new ConcurrentQueue<Job>();

        public static FamilyHubExternalEvent Instance { get { return _instance; } }
        public static bool IsReady { get { return _event != null; } }

        /// <summary>Хүчинтэй API контекстээс НЭГ удаа.</summary>
        public static void Ensure()
        {
            if (_event != null) return;
            _instance = new FamilyHubExternalEvent();
            _event = ExternalEvent.Create(_instance);
        }

        /// <summary>
        /// Ажлыг Revit-ийн үндсэн thread дээр гүйцэтгүүлж, үр дүнг Task-аар авна.
        /// ⚠️ Revit-ийн үндсэн thread-ЭЭС `.Wait()` хийж БОЛОХГҮЙ — ExternalEvent
        /// тэр thread дээр л ажилладаг тул өөрийгөө хүлээж гацна.
        /// </summary>
        public Task<T> RunAsync<T>(Func<UIApplication, T> work, CancellationToken ct)
        {
            if (_event == null) throw new InvalidOperationException("Family Hub ExternalEvent эхлээгүй");
            var tcs = new TaskCompletionSource<object>(TaskCreationOptions.RunContinuationsAsynchronously);
            var job = new Job { Work = app => (object)work(app), Tcs = tcs, Ct = ct };
            _queue.Enqueue(job);
            ExternalEventRequest r = _event.Raise();
            if (r == ExternalEventRequest.Denied || r == ExternalEventRequest.TimedOut)
            {
                // Модаль цонх нээлттэй г.м. — дараалалд үлдээж дахин Raise хийх оролдлого хийнэ.
                Task.Delay(500, ct).ContinueWith(_ => { try { _event.Raise(); } catch { } }, TaskScheduler.Default);
            }
            return tcs.Task.ContinueWith(t =>
            {
                if (t.IsFaulted) throw t.Exception.InnerException ?? t.Exception;
                if (t.IsCanceled) throw new OperationCanceledException(ct);
                return (T)t.Result;
            }, TaskContinuationOptions.ExecuteSynchronously);
        }

        public void Execute(UIApplication app)
        {
            Job job;
            while (_queue.TryDequeue(out job))
            {
                if (job.Ct.IsCancellationRequested) { job.Tcs.TrySetCanceled(); continue; }
                try
                {
                    object result = job.Work(app);
                    job.Tcs.TrySetResult(result);
                }
                catch (Exception ex)
                {
                    job.Tcs.TrySetException(ex);
                }
            }
        }

        public string GetName() { return "MGL Family Hub"; }
    }
}
