using System;
using System.Collections.Concurrent;
using System.Threading;
using System.Threading.Tasks;
using Autodesk.Revit.UI;
using RevitMcpAddin.SheetNumerator.Core;
using RevitMcpAddin.SheetNumerator.Ui;

namespace RevitMcpAddin.SheetNumerator.Revit
{
    /// <summary>
    /// ExternalEvent гарц: модальгүй (modeless) цонхноос Revit-ийн API-д хүрэх ЦОРЫН ГАНЦ зам.
    ///
    /// ⚠️ Цонхны event handler нь Revit API-ийн хүчинтэй контекст БИШ (ижил thread ч гэсэн).  Тиймээс модель
    /// өөрчлөх, document унших БҮХ ажил ЭНД дараалалд орж, Revit өөрөө «idle» болоход handler дотор гүйцэтгэгдэнэ.
    ///
    /// ⚠️ ExternalEvent нь ЗӨВХӨН хүчинтэй API контекстэд (команд, OnStartup) үүснэ — тиймээс <see cref="Create"/>-г
    /// `SheetNumeratorCommand.Execute`-ээс дуудна.  Цонх хаагдахад <see cref="Dispose"/> — хүлээгдэж буй
    /// ажлуудыг цуцалж, ExternalEvent-ийг суллана.
    ///
    /// ⚠️ Revit-ийн үндсэн thread-ээс энэ Task-ыг `.Wait()`/`.Result` хийж БОЛОХГҮЙ (өөрөө өөрийгөө хүлээж гацна).
    /// </summary>
    internal sealed class SheetNumeratorBridge : IExternalEventHandler, ISheetNumeratorGateway, IDisposable
    {
        private sealed class Job
        {
            public Func<UIApplication, object> Work;
            public TaskCompletionSource<object> Tcs;
            public string Name;
        }

        private readonly ConcurrentQueue<Job> _queue = new ConcurrentQueue<Job>();
        private ExternalEvent _event;
        private volatile bool _disposed;

        private SheetNumeratorBridge()
        {
        }

        /// <summary>Хүчинтэй API контекстээс (команд) НЭГ удаа.</summary>
        public static SheetNumeratorBridge Create()
        {
            var b = new SheetNumeratorBridge();
            b._event = ExternalEvent.Create(b);
            return b;
        }

        public string LogPath
        {
            get { return SheetNumeratorLog.LogPath; }
        }

        // ── ISheetNumeratorGateway ──────────────────────────────────
        public Task<SnapshotResult> LoadAsync()
        {
            return Run("load", app => SheetSnapshotService.Capture(app));
        }

        public Task<ApplyResult> ApplyAsync(ApplyRequest request)
        {
            return Run("apply", app => RenumberApplyService.Apply(app, request));
        }

        public Task<OperationResult> RenameAsync(RenameRequest request)
        {
            return Run("rename", app => SheetEditService.Rename(app, request));
        }

        public Task<OperationResult> DeleteAsync(DeleteRequest request)
        {
            return Run("delete", app => SheetEditService.Delete(app, request));
        }

        public Task<DocumentStamp> ReadStampAsync()
        {
            return Run("stamp", app => SheetSnapshotService.ReadStamp(app));
        }

        public Task<MarkerCapabilities> ProbeMarkersAsync()
        {
            return Run("probe", app =>
            {
                Autodesk.Revit.DB.Document doc = app.ActiveUIDocument != null ? app.ActiveUIDocument.Document : null;
                return UnicodeProbe.Probe(doc);
            });
        }

        // ── Дараалал ────────────────────────────────────────────────
        private Task<T> Run<T>(string name, Func<UIApplication, T> work)
        {
            var tcs = new TaskCompletionSource<object>(TaskCreationOptions.RunContinuationsAsynchronously);
            if (_disposed || _event == null)
            {
                tcs.SetException(new ObjectDisposedException("SheetNumeratorBridge"));
                return Convert<T>(tcs.Task);
            }

            _queue.Enqueue(new Job { Name = name, Work = app => (object)work(app), Tcs = tcs });
            Raise();
            return Convert<T>(tcs.Task);
        }

        private static Task<T> Convert<T>(Task<object> t)
        {
            return t.ContinueWith(x =>
            {
                if (x.IsFaulted)
                    throw x.Exception.InnerException ?? x.Exception;
                if (x.IsCanceled)
                    throw new OperationCanceledException();
                return (T)x.Result;
            }, TaskContinuationOptions.ExecuteSynchronously);
        }

        private void Raise()
        {
            try
            {
                ExternalEventRequest r = _event.Raise();
                if (r == ExternalEventRequest.Denied || r == ExternalEventRequest.TimedOut)
                {
                    // Revit модаль цонхонд байж болно — дараалалд үлдээж, удахгүй дахин оролдоно.
                    Task.Delay(400).ContinueWith(_ =>
                    {
                        try
                        {
                            if (!_disposed && !_queue.IsEmpty)
                                _event.Raise();
                        }
                        catch (Exception)
                        {
                            // Цонх хаагдсан үед ExternalEvent суларсан байж болно.
                        }
                    }, TaskScheduler.Default);
                }
            }
            catch (Exception ex)
            {
                SheetNumeratorLog.Error("bridge", "ExternalEvent.Raise амжилтгүй", ex);
            }
        }

        // ── IExternalEventHandler ───────────────────────────────────
        public void Execute(UIApplication app)
        {
            Job job;
            while (_queue.TryDequeue(out job))
            {
                if (_disposed)
                {
                    job.Tcs.TrySetCanceled();
                    continue;
                }
                try
                {
                    job.Tcs.TrySetResult(job.Work(app));
                }
                catch (Exception ex)
                {
                    SheetNumeratorLog.Error("bridge", "«" + job.Name + "» ажил унав", ex);
                    job.Tcs.TrySetException(ex);
                }
            }
        }

        public string GetName()
        {
            return "MGL Зургийн хуудас дугаарлах";
        }

        // ── Цэвэрлэгээ ──────────────────────────────────────────────
        public void Dispose()
        {
            if (_disposed)
                return;
            _disposed = true;

            Job job;
            while (_queue.TryDequeue(out job))
                job.Tcs.TrySetCanceled();

            try
            {
                if (_event != null)
                    _event.Dispose();
            }
            catch (Exception ex)
            {
                SheetNumeratorLog.Error("bridge", "ExternalEvent.Dispose амжилтгүй", ex);
            }
            _event = null;
        }
    }
}
