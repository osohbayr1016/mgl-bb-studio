using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace RevitMcpAddin.WorkTracking.Core
{
    /// <summary>Сервертэй харилцах давхарга — тестэд хуурамчаар солигдоно.</summary>
    public interface ITrackingTransport
    {
        /// <summary>`POST /api/revit/tracking/sync`.  2xx биш бол `TrackingTransportException`, сүлжээ бол бусад алдаа.</summary>
        Task<SyncResponse> SyncAsync(string token, SyncRequest request, CancellationToken ct);

        /// <summary>`POST /api/revit/submissions` — хариуг `ReportResponseClassifier`-оор ангилна.</summary>
        Task<ReportSendResult> SubmitReportAsync(string token, ReportItem report, CancellationToken ct);
    }

    /// <summary>Одоогийн нэвтрэлт.  null = нэвтрээгүй.</summary>
    public sealed class AuthIdentity
    {
        public string Token { get; set; }
        public int UserId { get; set; }
    }

    /// <summary>
    /// ИЛГЭЭГЧ — tracker-ийн хуримтлалыг дараалалд хадгалаад сервер рүү явуулна.
    ///
    ///   1. `DrainDirty` → дараалал → ДИСК (сүлжээнээс ӨМНӨ — унасан ч алдагдахгүй).
    ///   2. Нэвтрээгүй бол энд зогсоно (өөр хүний токеноор ХЭЗЭЭ Ч илгээхгүй).
    ///   3. Хэрэглэгчийн хүлээгдэж буй сегмент + heartbeat → `/tracking/sync`.
    ///      Серверийн баталгаа (`acks`) ирсэн мөрүүдийг л хасна.  2xx биш /
    ///      сүлжээгүй бол ЮУ Ч хасахгүй, ухралттай (backoff) дахин оролдоно.
    ///   4. Тайлангууд — нэг нэгээр, бичсэн дарааллаар.
    ///
    /// ⚠️ Нэг зэрэг НЭГ л ажиллана (`_single`) — timer, «Одоо илгээх», хаалтын
    ///    сүүлийн илгээлт давхцахгүй.
    /// ⚠️ Revit-ийн UI thread-ээс ХЭЗЭЭ Ч await хийхгүй — хост арын loop-оос дуудна.
    /// </summary>
    public sealed class TrackingSync
    {
        private readonly WorkTracker _tracker;
        private readonly ITrackingTransport _transport;
        private readonly Func<AuthIdentity> _auth;
        private readonly TrackingPolicy _p;
        private readonly ITrackingClock _clock;
        private readonly string _addinVersion;
        private readonly SemaphoreSlim _single = new SemaphoreSlim(1, 1);
        private readonly object _gate = new object();

        private TrackingOutbox _outbox;
        private long _nextAttemptMs;
        private long _backoffMs;

        private readonly Dictionary<int, long> _otherByTask = new Dictionary<int, long>();
        private string _otherDate;

        public TrackingSync(WorkTracker tracker, TrackingOutbox outbox, ITrackingTransport transport,
            Func<AuthIdentity> auth, TrackingPolicy policy, ITrackingClock clock, string addinVersion)
        {
            _tracker = tracker ?? throw new ArgumentNullException(nameof(tracker));
            _outbox = outbox ?? throw new ArgumentNullException(nameof(outbox));
            _transport = transport ?? throw new ArgumentNullException(nameof(transport));
            _auth = auth ?? (() => null);
            _p = policy ?? TrackingPolicy.Default;
            _clock = clock ?? SystemTrackingClock.Instance;
            _addinVersion = addinVersion ?? "0";
        }

        /* ---------------- Төлөв (UI) ---------------------------------- */

        /// <summary>Сүүлийн оролдлого амжилттай байсан эсэх.</summary>
        public bool Online { get; private set; }
        /// <summary>Сервер 401 өгсөн — дахин нэвтрэх хүртэл дараалалд хадгална.</summary>
        public bool AuthRequired { get; private set; }
        public string LastError { get; private set; }
        public DateTime? LastSuccessUtc { get; private set; }
        public int Attempts { get; private set; }

        public TrackingOutbox Outbox { get { lock (_gate) return _outbox; } }

        /// <summary>Бусад сессийн (өмнөх Revit нээлт) энэ таскийн өнөөдрийн мс — дэлгэцэнд нэмнэ.</summary>
        public long OtherSessionsMs(int taskId, string workDate)
        {
            lock (_gate)
            {
                if (_otherDate != workDate) return 0;
                long v;
                return _otherByTask.TryGetValue(taskId, out v) ? v : 0;
            }
        }

        public long OtherSessionsTotalMs(string workDate)
        {
            lock (_gate)
            {
                if (_otherDate != workDate) return 0;
                long sum = 0;
                foreach (long v in _otherByTask.Values) sum += v;
                return sum;
            }
        }

        /// <summary>Хүлээгдэж буй сегментүүдийн тоо (одоогийн хэрэглэгч).</summary>
        public int PendingCount()
        {
            AuthIdentity who = _auth();
            return _outbox.PendingSegmentCount(who?.UserId);
        }

        /* ---------------- Үйлдэл -------------------------------------- */

        /// <summary>Тайлан дараалалд — ЭХЛЭЭД дискэнд, дараа нь илгээнэ.</summary>
        public void EnqueueReport(ReportItem r)
        {
            _outbox.AddReport(r);
            _outbox.Save();
            // Тайлан нь ажилтны идэвхтэй үйлдэл — ухралтыг хүлээхгүй.
            lock (_gate) _nextAttemptMs = 0;
        }

        /// <summary>
        /// Нэг мөчлөг.  `force` = ухралтыг үл тоох (хэрэглэгчийн товч, хаалт).
        /// `ended` = Revit хаагдаж / хэрэглэгч гарч байна.
        /// </summary>
        public async Task RunOnceAsync(bool force, bool ended, CancellationToken ct)
        {
            if (!await _single.WaitAsync(ended ? _p.ShutdownFlushTimeout : TimeSpan.Zero).ConfigureAwait(false))
                return;
            try
            {
                Persist();

                AuthIdentity who = _auth();
                if (who == null || string.IsNullOrEmpty(who.Token) || who.UserId <= 0) return;

                long now = _clock.MonotonicMs;
                lock (_gate)
                {
                    if (!force && now < _nextAttemptMs) return;
                }

                Attempts++;
                bool ok = await SyncSegmentsAsync(who, ended, ct).ConfigureAwait(false);
                if (ok) ok = await SendReportsAsync(who, ct).ConfigureAwait(false);
                OnResult(ok);
            }
            finally
            {
                _single.Release();
            }
        }

        /// <summary>Хэрэглэгч солигдоход (гарах/өөр хүн нэвтрэх) — одоогийнхоо хуримтлалыг дискэнд.</summary>
        public void Persist()
        {
            List<SegmentRecord> dirty = _tracker.DrainDirty();
            if (dirty.Count > 0) _outbox.UpsertSegments(dirty);
            _outbox.Prune(_clock.UtcNow);
            _outbox.Save();
        }

        private async Task<bool> SyncSegmentsAsync(AuthIdentity who, bool ended, CancellationToken ct)
        {
            // Нэг мөчлөгт хэд хэдэн багц (удаан офлайн байсны дараа).  Эхний
            // багцад heartbeat явна; сегментгүй ч heartbeat ЗААВАЛ явна.
            for (int batch = 0; batch < 20; batch++)
            {
                List<SegmentRecord> segs = _outbox.PendingSegments(who.UserId, _p.MaxSegmentsPerSync);
                if (batch > 0 && segs.Count == 0) return true;

                var req = new SyncRequest
                {
                    SessionId = _tracker.SessionId,
                    AddinVersion = _addinVersion,
                    Presence = _tracker.Presence(),
                    Segments = segs,
                    Ended = ended,
                    WorkDate = _p.WorkDateOf(_clock.UtcNow),
                };

                SyncResponse res;
                try
                {
                    using (var cts = CancellationTokenSource.CreateLinkedTokenSource(ct))
                    {
                        cts.CancelAfter(_p.HttpTimeout);
                        res = await _transport.SyncAsync(who.Token, req, cts.Token).ConfigureAwait(false);
                    }
                }
                catch (TrackingTransportException tex)
                {
                    if (tex.IsUnauthorized) AuthRequired = true;
                    LastError = tex.StatusCode + ": " + tex.Message;
                    return false;
                }
                catch (Exception ex)
                {
                    LastError = ex is OperationCanceledException ? "timeout" : ex.GetType().Name + ": " + ex.Message;
                    return false;
                }

                AuthRequired = false;
                if (res != null)
                {
                    _outbox.AckSegments(res.Acks);
                    _outbox.Save();
                    ApplyOtherSessions(res);
                }
                if (segs.Count < _p.MaxSegmentsPerSync) return true;
            }
            return true;
        }

        private async Task<bool> SendReportsAsync(AuthIdentity who, CancellationToken ct)
        {
            List<ReportItem> pending = _outbox.PendingReports(who.UserId, _p.MaxReportsPerSync);
            foreach (ReportItem r in pending)
            {
                r.Attempts++;
                ReportSendResult res;
                try
                {
                    using (var cts = CancellationTokenSource.CreateLinkedTokenSource(ct))
                    {
                        cts.CancelAfter(TimeSpan.FromTicks(_p.HttpTimeout.Ticks * 3));   // бичилт нь heartbeat-ээс удаан
                        res = await _transport.SubmitReportAsync(who.Token, r, cts.Token).ConfigureAwait(false);
                    }
                }
                catch (Exception ex)
                {
                    res = new ReportSendResult
                    {
                        Kind = ReportSendKind.Retry,
                        Message = ex is OperationCanceledException ? "timeout" : ex.Message,
                    };
                }

                switch (res.Kind)
                {
                    case ReportSendKind.Sent:
                        r.State = ReportStates.Sent;
                        r.EntryId = res.EntryId;
                        r.SentAt = WorkTracker.Iso(_clock.UtcNow);
                        r.LastError = null;
                        _outbox.UpdateReport(r);
                        _outbox.Save();
                        break;
                    case ReportSendKind.Rejected:
                        // ⚠️ Текстийг УСТГАХГҮЙ — ажилтан засаад дахин илгээнэ.
                        r.State = ReportStates.Failed;
                        r.LastError = res.Message;
                        _outbox.UpdateReport(r);
                        _outbox.Save();
                        break;
                    case ReportSendKind.Unauthorized:
                        AuthRequired = true;
                        r.LastError = res.Message;
                        _outbox.UpdateReport(r);
                        _outbox.Save();
                        return false;
                    default:
                        r.LastError = res.Message;
                        _outbox.UpdateReport(r);
                        _outbox.Save();
                        LastError = res.Message;
                        return false;
                }
            }
            return true;
        }

        private void ApplyOtherSessions(SyncResponse res)
        {
            if (res.OtherSessions == null || string.IsNullOrEmpty(res.WorkDate)) return;
            lock (_gate)
            {
                _otherByTask.Clear();
                foreach (TodayTaskTotal t in res.OtherSessions)
                    if (t != null && t.OtherMs > 0) _otherByTask[t.TaskId] = t.OtherMs;
                _otherDate = res.WorkDate;
            }
        }

        private void OnResult(bool ok)
        {
            long now = _clock.MonotonicMs;
            lock (_gate)
            {
                if (ok)
                {
                    Online = true;
                    LastError = null;
                    LastSuccessUtc = _clock.UtcNow;
                    _backoffMs = 0;
                    _nextAttemptMs = 0;
                }
                else
                {
                    Online = false;
                    long baseMs = (long)_p.SyncInterval.TotalMilliseconds;
                    _backoffMs = _backoffMs <= 0 ? baseMs : Math.Min(_backoffMs * 2, (long)_p.SyncBackoffMax.TotalMilliseconds);
                    _nextAttemptMs = now + _backoffMs;
                }
            }
        }
    }

    /// <summary>
    /// `POST /api/revit/submissions`-ийн хариуг ангилна — ЦЭВЭР, тестлэгдэнэ.
    ///
    /// Дүрэм (серверийн `routes/revit.ts` + `officeAccess.ts`-ээс):
    ///   2xx (duplicate ч)                → Sent
    ///   401                              → Unauthorized (дахин нэвтрэх)
    ///   403 + code office_network_*      → Retry (оффисын сүлжээнд орохоор илгээнэ)
    ///   403 бусад (HOURS_PROGRESS, эрхгүй)→ Rejected
    ///   400 / 404 / 409 / 413 / 422       → Rejected (хувь буурсан, 99%-ийн тааз …)
    ///   429 / 5xx / бусад                 → Retry
    /// </summary>
    public static class ReportResponseClassifier
    {
        /// <summary>`backend/src/lib/officeAccess.ts` `OFFICE_NETWORK_CODE`-ийн ихэр.</summary>
        public const string OfficeNetworkCode = "office_network_required";

        public static ReportSendResult Classify(int status, string body)
        {
            string error = null, message = null, code = null;
            int? entryId = null;
            try
            {
                if (!string.IsNullOrWhiteSpace(body))
                {
                    using (JsonDocument doc = JsonDocument.Parse(body))
                    {
                        JsonElement root = doc.RootElement;
                        if (root.ValueKind == JsonValueKind.Object)
                        {
                            JsonElement v;
                            if (root.TryGetProperty("error", out v) && v.ValueKind == JsonValueKind.String) error = v.GetString();
                            if (root.TryGetProperty("message", out v) && v.ValueKind == JsonValueKind.String) message = v.GetString();
                            if (root.TryGetProperty("code", out v) && v.ValueKind == JsonValueKind.String) code = v.GetString();
                            if (root.TryGetProperty("entry_id", out v) && v.ValueKind == JsonValueKind.Number)
                            {
                                int id;
                                if (v.TryGetInt32(out id)) entryId = id;
                            }
                        }
                    }
                }
            }
            catch
            {
                // JSON биш хариу (Cloudflare-ийн HTML) — статусаар л ангилна.
            }

            string human = !string.IsNullOrWhiteSpace(message) ? message : (error ?? ("HTTP " + status.ToString(CultureInfo.InvariantCulture)));

            if (status >= 200 && status < 300)
                return new ReportSendResult { Kind = ReportSendKind.Sent, EntryId = entryId, Message = message };
            if (status == 401)
                return new ReportSendResult { Kind = ReportSendKind.Unauthorized, Message = human };
            if (status == 403)
            {
                bool office = string.Equals(code, OfficeNetworkCode, StringComparison.Ordinal) ||
                              (code != null && code.IndexOf("OFFICE", StringComparison.OrdinalIgnoreCase) >= 0);
                return new ReportSendResult { Kind = office ? ReportSendKind.Retry : ReportSendKind.Rejected, Message = human };
            }
            if (status == 400 || status == 404 || status == 409 || status == 413 || status == 422)
                return new ReportSendResult { Kind = ReportSendKind.Rejected, Message = human };
            return new ReportSendResult { Kind = ReportSendKind.Retry, Message = human };
        }
    }
}
