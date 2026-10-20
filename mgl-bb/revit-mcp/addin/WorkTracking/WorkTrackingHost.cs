using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Events;
using Autodesk.Revit.UI;
using Autodesk.Revit.UI.Events;
using RevitMcpAddin.Intelligence.Core;
using RevitMcpAddin.WorkTracking.Core;

namespace RevitMcpAddin.WorkTracking
{
    /// <summary>UI-д зориулсан агшны төлөв (thread-safe хуулбар).</summary>
    public sealed class TrackingView
    {
        public TrackState State { get; set; }
        public string StateWire { get; set; }
        public int? UserId { get; set; }
        public string UserName { get; set; }
        public int? TaskId { get; set; }
        public string TaskName { get; set; }
        public int? ProjectId { get; set; }
        public string ProjectName { get; set; }
        public string DocName { get; set; }
        /// <summary>Энэ таск дээр ӨНӨӨДӨР (өмнөх Revit нээлтийг оруулаад) идэвхтэй мс — одоогийн агшинд.</summary>
        public long TodayTaskMs { get; set; }
        /// <summary>Өнөөдөр бүх таск дээр Revit-ийн идэвхтэй мс.</summary>
        public long TodayTotalMs { get; set; }
        public bool Online { get; set; }
        public bool AuthRequired { get; set; }
        public int PendingSegments { get; set; }
        public int PendingReports { get; set; }
        public int FailedReports { get; set; }
        public string LastError { get; set; }
        public DateTime? LastSyncUtc { get; set; }
        public string WorkDate { get; set; }
    }

    /// <summary>
    /// АВТОМАТ ЦАГ БҮРТГЭЛИЙН REVIT ХОСТ — нимгэн залгаас.  Бүх шийдвэр
    /// `WorkTracking/Core`-д (тестлэгдсэн); энд зөвхөн:
    ///   • Revit-ийн үйл явдал → идэвхтэй баримт (ViewActivated / DocumentClosing),
    ///   • OS-ийн хоёр дохио → `GetForegroundWindow` (Revit урд уу) ба
    ///     `GetLastInputInfo` (сүүлийн оролтоос хойш хэдэн мс) — ОРОЛТЫН АГУУЛГА,
    ///     дэлгэц, clipboard, бусад програмын нэр ХЭЗЭЭ Ч уншихгүй,
    ///   • арын timer (дохио 2 с) ба арын loop (сервер 10 с),
    ///   • самбарт зориулсан API (таск сонголт, тайлангийн дараалал).
    ///
    /// ⚠️ ДАЛД СИСТЕМ (эзний шийдвэр 2026-09-29): албан ёсны цаг нь гараар удирдах
    ///    Play/Pause таймер (тусдаа систем).  Энэ бүртгэлийн төлөв/цагийг ажилтанд
    ///    ХАРУУЛАХГҮЙ (`TrackingPanel` устсан) — `View()` нь дотоод оношилгоонд л.
    /// ⚠️ Revit-ийн UI/үндсэн thread дээр СҮЛЖЭЭ, ДИСК БАЙХГҮЙ.  Үйл явдлын
    ///    handler нь баримтын нэр/uid уншаад л буцна.
    /// ⚠️ Revit-ийн `Idling`-ийг «хүн идэвхгүй» гэсэн нотолгоо болгохгүй.
    /// </summary>
    public sealed class WorkTrackingHost
    {
        public static WorkTrackingHost Instance { get; private set; }

        private readonly TrackingPolicy _p = TrackingPolicy.Default;
        private readonly object _gate = new object();
        private readonly WorkTracker _tracker;
        private readonly TrackingOutbox _outbox;
        private readonly TrackingSync _sync;
        private readonly TrackingContextMemory _memory;
        private readonly TrackingHttpTransport _transport;
        private readonly CancellationTokenSource _cts = new CancellationTokenSource();
        private readonly int _pid = Process.GetCurrentProcess().Id;

        private UIControlledApplication _app;
        private Timer _sampler;
        private Task _loop;
        private volatile bool _kick;

        // Идэвхтэй баримт — Revit-ийн үйл явдлаас (зөвхөн нэр + түлхүүр).
        private string _activeDocKey;
        private string _activeDocUid;
        private string _activeDocName;

        // Одоогийн нэвтрэлт — SettingsStore-оос, loop бүрд шалгана.
        private int? _userId;
        private string _userName;
        private string _token;

        private readonly HashSet<string> _lookedUp = new HashSet<string>(StringComparer.Ordinal);
        private TrackState _lastRaisedState = (TrackState)(-1);

        /// <summary>Төлөв/тоо өөрчлөгдөхөд — АРЫН thread дээр; UI нь Dispatcher руу шилжүүлнэ.</summary>
        public event Action Changed;

        internal static string TrackingDir =>
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "RevitMcpAddin", "tracking");

        private WorkTrackingHost()
        {
            _tracker = new WorkTracker(_p, SystemTrackingClock.Instance);
            _outbox = TrackingOutbox.Open(TrackingDir, _tracker.SessionId, _p);
            _memory = new TrackingContextMemory(Path.Combine(TrackingDir, "context.json"));
            _transport = new TrackingHttpTransport(() => SettingsStore.Load().ApiHost);
            _sync = new TrackingSync(_tracker, _outbox, _transport, CurrentIdentity, _p,
                SystemTrackingClock.Instance, BuildInfo.Version);
        }

        /* ============================================================== */
        /*  Амьдралын мөчлөг                                               */
        /* ============================================================== */

        public static void Init(UIControlledApplication app)
        {
            if (Instance != null || app == null) return;
            if (BatchQto.IsBatch) return;                 // batch горимд хүн байхгүй — тоолох зүйлгүй
            var h = new WorkTrackingHost { _app = app };
            Instance = h;

            app.ViewActivated += h.OnViewActivated;
            app.ControlledApplication.DocumentClosing += h.OnDocumentClosing;
            app.Idling += h.OnFirstIdling;

            h.RefreshAuth();
            h.Resolve();
            h._sampler = new Timer(_ => h.SampleTick(), null, h._p.SampleInterval, h._p.SampleInterval);
            h._loop = Task.Run(() => h.SyncLoopAsync(h._cts.Token));
        }

        /// <summary>
        /// Revit хаагдаж байна: одоо хүртэл тоолж ДИСКЭНД хадгална, сүүлийн
        /// heartbeat-ийг (ended) хугацаатай оролдоно.  Амжаагүй зүйл дараагийн
        /// асаалтад илгээгдэнэ.
        /// </summary>
        public static void Shutdown()
        {
            WorkTrackingHost h = Instance;
            if (h == null) return;
            Instance = null;
            try { h._app.ViewActivated -= h.OnViewActivated; } catch { }
            try { h._app.ControlledApplication.DocumentClosing -= h.OnDocumentClosing; } catch { }
            try { h._sampler?.Dispose(); } catch { }
            try { h._cts.Cancel(); } catch { }
            try { h._tracker.Suspend(); } catch { }
            try { h._sync.Persist(); } catch { }
            try
            {
                Task t = Task.Run(() => h._sync.RunOnceAsync(true, true, CancellationToken.None));
                t.Wait(h._p.ShutdownFlushTimeout);
            }
            catch { }
            try { h._outbox.Dispose(); } catch { }
        }

        /* ============================================================== */
        /*  Самбарын API                                                   */
        /* ============================================================== */

        /// <summary>`/api/revit/context` баримтыг төсөлтэй тогтоосны дараа — баримт → төсөл санамж.</summary>
        public void RememberDocument(string docUid, int projectId, string projectName, int? revitDocumentId, string docName)
        {
            string key = DocKeys.Normalize(docUid);
            if (string.IsNullOrEmpty(key) || projectId <= 0) return;
            _memory.RememberDoc(key, new TrackingContextMemory.DocInfo
            {
                ProjectId = projectId,
                ProjectName = projectName,
                RevitDocumentId = revitDocumentId,
                DocName = docName,
                SeenAt = WorkTracker.Iso(DateTime.UtcNow),
            });
            Resolve();
        }

        /// <summary>
        /// Ажилтан таскаа СОНГОЛОО (эсвэл өөрийн өмнөх сонголтыг сэргээв).  ⚠️ Эхний
        /// таскийг дураараа сонгож ЭНИЙГ ДУУДАХГҮЙ — тоологдох цагийн эзэн ажилтан.
        /// </summary>
        public void SelectTask(string docUid, int projectId, int taskId, string taskName)
        {
            int? uid = _userId;
            if (!uid.HasValue || projectId <= 0 || taskId <= 0) return;
            string key = DocKeys.Normalize(docUid);
            if (!string.IsNullOrEmpty(key) && _memory.Doc(key) == null)
                _memory.RememberDoc(key, new TrackingContextMemory.DocInfo { ProjectId = projectId, SeenAt = WorkTracker.Iso(DateTime.UtcNow) });
            _memory.RememberTask(uid.Value, projectId, taskId, taskName);
            Resolve();
            Kick();
        }

        /// <summary>Таскаас гарах — энэ төсөл дээр юу ч тоолохгүй болно.</summary>
        public void ClearTask(string docUid)
        {
            int? uid = _userId;
            TrackingContextMemory.DocInfo d = _memory.Doc(DocKeys.Normalize(docUid));
            if (uid.HasValue && d != null) _memory.ForgetTask(uid.Value, d.ProjectId);
            Resolve();
            Kick();
        }

        public int? RememberedTaskId(int projectId)
        {
            int? uid = _userId;
            if (!uid.HasValue) return null;
            return _memory.Task(uid.Value, projectId)?.TaskId;
        }

        public TrackingView View()
        {
            TrackerSnapshot s = _tracker.Snapshot();
            long now = SystemTrackingClock.Instance.MonotonicMs;
            long extra = s.State == TrackState.Working ? Math.Max(0, Math.Min(now - s.AtMs, _p.SampleIntervalMs * 2)) : 0;
            int? uid = _userId;
            List<ReportItem> reports = uid.HasValue ? _outbox.Reports(uid.Value) : new List<ReportItem>();
            WorkContext c = s.Context;
            return new TrackingView
            {
                State = s.State,
                StateWire = TrackStateWire.Of(s.State),
                UserId = uid,
                UserName = _userName,
                TaskId = c?.TaskId,
                TaskName = c?.TaskName,
                ProjectId = c?.ProjectId,
                ProjectName = c?.ProjectName,
                DocName = c?.DocName ?? _activeDocName,
                TodayTaskMs = c == null ? 0 : s.CurrentTaskSessionMs + extra + _sync.OtherSessionsMs(c.TaskId, s.WorkDate),
                TodayTotalMs = s.SessionTodayMs + extra + _sync.OtherSessionsTotalMs(s.WorkDate),
                Online = _sync.Online,
                AuthRequired = _sync.AuthRequired,
                PendingSegments = uid.HasValue ? _outbox.PendingSegmentCount(uid.Value) : 0,
                PendingReports = reports.Count(r => r.State == ReportStates.Pending),
                FailedReports = reports.Count(r => r.State == ReportStates.Failed),
                LastError = _sync.LastError,
                LastSyncUtc = _sync.LastSuccessUtc,
                WorkDate = s.WorkDate,
            };
        }

        /// <summary>Энэ таскийн өнөөдрийн Revit цаг (тайлан илгээх агшинд хавсаргана).</summary>
        public long TodayTaskMs(int taskId)
        {
            string date = _p.WorkDateOf(DateTime.UtcNow);
            return _tracker.SessionActiveMs(taskId, date) + _sync.OtherSessionsMs(taskId, date);
        }

        /// <summary>
        /// Өдрийн тайлан (явц % + юу хийсэн) — ЭХЛЭЭД дискэнд, дараа нь арын loop
        /// илгээнэ.  Сүлжээгүй/сервер унасан ч текст алдагдахгүй.  `draft_uid` нь
        /// тогтвортой тул дахин оролдлого хоёр бичлэг үүсгэхгүй.
        /// </summary>
        public string EnqueueReport(int taskId, string taskName, string projectName, double pct, string notes,
            int? revitDocumentId, IEnumerable<string> sheetUids, string completionQaJson = null)
        {
            int? uid = _userId;
            if (!uid.HasValue) throw new InvalidOperationException("Нэвтрээгүй байна.");
            var r = new ReportItem
            {
                DraftUid = Guid.NewGuid().ToString("N"),
                UserId = uid.Value,
                TaskId = taskId,
                TaskName = taskName,
                ProjectName = projectName,
                Percentage = pct,
                Notes = notes ?? string.Empty,
                RevitDocumentId = revitDocumentId,
                SheetUids = sheetUids?.Where(s => !string.IsNullOrEmpty(s)).Take(200).ToList() ?? new List<string>(),
                RevitActiveMs = TodayTaskMs(taskId),
                ReportDate = _p.WorkDateOf(DateTime.UtcNow),
                CompletionQaJson = string.IsNullOrWhiteSpace(completionQaJson) ? null : completionQaJson,
                CreatedAt = WorkTracker.Iso(DateTime.UtcNow),
                State = ReportStates.Pending,
            };
            _sync.EnqueueReport(r);
            Kick();
            RaiseChanged(force: true);
            return r.DraftUid;
        }

        public IReadOnlyList<ReportItem> Reports()
        {
            int? uid = _userId;
            return uid.HasValue ? _outbox.Reports(uid.Value) : new List<ReportItem>();
        }

        /// <summary>
        /// Татгалзсан тайланг (засаад) дахин илгээнэ.  ⚠️ ШИНЭ draft_uid: татгалзсан
        /// үед серверт бичлэг ҮҮСЭЭГҮЙ (claim буцаагдсан) тул давхардахгүй, харин
        /// хуучин uid-ийн аудит мөр өөр хувьтай үлдэхээс сэргийлнэ.
        /// </summary>
        public string RetryReport(string draftUid, double? percentage = null, string notes = null)
        {
            ReportItem old = Reports().FirstOrDefault(r => r.DraftUid == draftUid);
            if (old == null || old.State == ReportStates.Sent) return null;
            _outbox.RemoveReport(draftUid);
            ReportItem fresh = old.Clone();
            fresh.DraftUid = Guid.NewGuid().ToString("N");
            if (percentage.HasValue) fresh.Percentage = percentage.Value;
            if (notes != null) fresh.Notes = notes;
            fresh.State = ReportStates.Pending;
            fresh.LastError = null;
            fresh.Attempts = 0;
            _sync.EnqueueReport(fresh);
            Kick();
            RaiseChanged(force: true);
            return fresh.DraftUid;
        }

        public void DiscardReport(string draftUid)
        {
            if (_outbox.RemoveReport(draftUid)) { _outbox.Save(); RaiseChanged(force: true); }
        }

        /// <summary>Тохиргоо цонхоор нэвтэрсэн/гарсны дараа — хүлээлгүй шилжинэ.</summary>
        public void NotifyAuthChanged()
        {
            RefreshAuth();
            Resolve();
            Kick();
        }

        /// <summary>Шууд илгээх (самбарын «Шинэчлэх»).</summary>
        public void Kick() { _kick = true; }

        /* ============================================================== */
        /*  Revit-ийн үйл явдал (үндсэн thread — ХЯМД)                      */
        /* ============================================================== */

        private void OnFirstIdling(object sender, IdlingEventArgs e)
        {
            try
            {
                var uiapp = sender as UIApplication;
                Document doc = uiapp?.ActiveUIDocument?.Document;
                if (doc != null && _activeDocKey == null) SetActiveDoc(doc);
            }
            catch { }
            finally
            {
                try { _app.Idling -= OnFirstIdling; } catch { }
            }
        }

        private void OnViewActivated(object sender, ViewActivatedEventArgs e)
        {
            try
            {
                Document doc = e.Document;
                if (doc == null) return;
                // Family засварлах нь ТӨСЛИЙН ажлын хэсэг — контекст хэвээр (тоолол үргэлжилнэ).
                if (doc.IsFamilyDocument) return;
                SetActiveDoc(doc);
            }
            catch { }
        }

        private void OnDocumentClosing(object sender, DocumentClosingEventArgs e)
        {
            try
            {
                Document doc = e.Document;
                if (doc == null || doc.IsFamilyDocument) return;
                string key = DocKeys.Normalize(RevitTools.DocUid(doc));
                bool wasActive;
                lock (_gate)
                {
                    wasActive = string.Equals(key, _activeDocKey, StringComparison.Ordinal);
                    if (wasActive)
                    {
                        _activeDocKey = null;
                        _activeDocUid = null;
                        _activeDocName = null;
                    }
                }
                // Дараагийн баримт идэвхжихэд ViewActivated контекстыг тогтооно.
                if (wasActive) Resolve();
            }
            catch { }
        }

        private void SetActiveDoc(Document doc)
        {
            string raw = RevitTools.DocUid(doc);
            string key = DocKeys.Normalize(raw);
            string name = null;
            try { name = doc.Title; } catch { }
            bool changed;
            lock (_gate)
            {
                changed = !string.Equals(key, _activeDocKey, StringComparison.Ordinal);
                _activeDocKey = key;
                _activeDocUid = raw;
                _activeDocName = name;
            }
            if (changed) Resolve();
        }

        /* ============================================================== */
        /*  Дотоод                                                         */
        /* ============================================================== */

        private void Resolve()
        {
            string key, name, raw;
            lock (_gate) { key = _activeDocKey; name = _activeDocName; raw = _activeDocUid; }
            TrackState reason;
            WorkContext ctx = _memory.Resolve(_userId, key, name, out reason);
            _tracker.SetContext(ctx, reason);
            // Үл мэдэгдэх баримт → сервераас төслийг нь арын thread дээр асууна (нэг удаа).
            if (ctx == null && reason == TrackState.NoTask && key != null && _memory.Doc(key) == null)
                LookupDocSoon(raw, key, name);
            RaiseChanged(force: true);
        }

        private void LookupDocSoon(string rawUid, string key, string name)
        {
            if (string.IsNullOrEmpty(rawUid) || string.IsNullOrEmpty(_token)) return;
            lock (_gate)
            {
                if (!_lookedUp.Add(key)) return;
            }
            string token = _token;
            Task.Run(async () =>
            {
                try
                {
                    TrackingHttpTransport.DocLookup d = await _transport.LookupDocumentAsync(token, rawUid, _cts.Token).ConfigureAwait(false);
                    if (d == null) return;
                    _memory.RememberDoc(key, new TrackingContextMemory.DocInfo
                    {
                        ProjectId = d.ProjectId,
                        ProjectName = d.ProjectName,
                        RevitDocumentId = d.DocumentId,
                        DocName = name,
                        SeenAt = WorkTracker.Iso(DateTime.UtcNow),
                    });
                    Resolve();
                }
                catch
                {
                    lock (_gate) _lookedUp.Remove(key);        // дараа дахин оролдоно
                }
            });
        }

        private AuthIdentity CurrentIdentity()
        {
            string token = _token;
            int? uid = _userId;
            return uid.HasValue && !string.IsNullOrEmpty(token) ? new AuthIdentity { Token = token, UserId = uid.Value } : null;
        }

        /// <summary>Нэвтрэлтийг шалгана.  Хэрэглэгч солигдвол контекстыг дахин шийднэ.</summary>
        private bool RefreshAuth()
        {
            AddinSettings st;
            try { st = SettingsStore.Load(); } catch { st = null; }
            string token = st?.Token;
            int? uid = string.IsNullOrEmpty(token) ? null : JwtSub(token);
            bool changed = uid != _userId;
            _token = uid.HasValue ? token : null;
            _userId = uid;
            _userName = st?.Username;
            if (changed)
            {
                lock (_gate) _lookedUp.Clear();
                _sync.Persist();
            }
            return changed;
        }

        /// <summary>JWT-ийн `sub` (гарын үсэг ШАЛГАХГҮЙ — зөвхөн дарааллыг хэрэглэгчээр ангилахад).</summary>
        internal static int? JwtSub(string token)
        {
            try
            {
                string[] parts = token.Split('.');
                if (parts.Length < 2) return null;
                string b64 = parts[1].Replace('-', '+').Replace('_', '/');
                switch (b64.Length % 4) { case 2: b64 += "=="; break; case 3: b64 += "="; break; }
                using (JsonDocument doc = JsonDocument.Parse(Encoding.UTF8.GetString(Convert.FromBase64String(b64))))
                {
                    JsonElement sub;
                    if (!doc.RootElement.TryGetProperty("sub", out sub)) return null;
                    int id;
                    if (sub.ValueKind == JsonValueKind.Number && sub.TryGetInt32(out id)) return id;
                    if (sub.ValueKind == JsonValueKind.String && int.TryParse(sub.GetString(), out id)) return id;
                }
            }
            catch { }
            return null;
        }

        private void SampleTick()
        {
            try
            {
                _tracker.Sample(ReadSignals());
                RaiseChanged(force: false);
            }
            catch { }
        }

        private async Task SyncLoopAsync(CancellationToken ct)
        {
            long lastRun = 0;
            while (!ct.IsCancellationRequested)
            {
                try { await Task.Delay(1000, ct).ConfigureAwait(false); }
                catch (OperationCanceledException) { return; }
                try
                {
                    long now = SystemTrackingClock.Instance.MonotonicMs;
                    bool kicked = _kick;
                    if (!kicked && now - lastRun < (long)_p.SyncInterval.TotalMilliseconds) continue;
                    _kick = false;
                    lastRun = now;
                    if (RefreshAuth()) Resolve();
                    await _sync.RunOnceAsync(kicked, false, ct).ConfigureAwait(false);
                    RaiseChanged(force: true);
                }
                catch (OperationCanceledException) { return; }
                catch { }
            }
        }

        private void RaiseChanged(bool force)
        {
            TrackState s = _tracker.State;
            if (!force && s == _lastRaisedState) return;
            _lastRaisedState = s;
            try { Changed?.Invoke(); } catch { }
        }

        /* ---------------- OS-ийн дохио (зөвхөн хугацаа/төлөв) ---------------- */

        [StructLayout(LayoutKind.Sequential)]
        private struct LASTINPUTINFO
        {
            public uint cbSize;
            public uint dwTime;
        }

        [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
        [DllImport("user32.dll")] private static extern bool GetLastInputInfo(ref LASTINPUTINFO plii);
        [DllImport("kernel32.dll")] private static extern ulong GetTickCount64();

        private ActivitySignals ReadSignals()
        {
            var s = new ActivitySignals { RevitForeground = false, IdleMs = -1 };
            try
            {
                IntPtr fg = GetForegroundWindow();
                if (fg != IntPtr.Zero)
                {
                    uint pid;
                    GetWindowThreadProcessId(fg, out pid);
                    s.RevitForeground = pid == (uint)_pid;
                }
                // Түгжигдсэн дэлгэц дээр урд цонх ХООСОН — «Revit урд биш» гэж тооцогдоно.
            }
            catch { }
            try
            {
                var lii = new LASTINPUTINFO { cbSize = (uint)Marshal.SizeOf(typeof(LASTINPUTINFO)) };
                if (GetLastInputInfo(ref lii))
                {
                    // dwTime нь 32 битийн GetTickCount — эргэлтийг uint хасалт шийднэ.
                    uint nowTick = unchecked((uint)GetTickCount64());
                    s.IdleMs = unchecked(nowTick - lii.dwTime);
                }
            }
            catch { }
            return s;
        }
    }
}
