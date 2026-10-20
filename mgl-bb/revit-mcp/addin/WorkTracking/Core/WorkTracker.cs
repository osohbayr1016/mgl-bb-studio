using System;
using System.Collections.Generic;
using System.Globalization;

namespace RevitMcpAddin.WorkTracking.Core
{
    /// <summary>
    /// АВТОМАТ ЦАГ БҮРТГЭГЧИЙН ЦӨМ — Revit API, WPF, сүлжээ, диск ХӨНДӨХГҮЙ
    /// (тестээс шууд ажиллана).
    ///
    /// Загвар:
    ///   • Хост `SampleInterval` тутам OS-ийн дохиог `Sample()`-д өгнө.
    ///   • Хоёр уншилтын завсрыг МОНОТОН цагаар хэмжиж, түүний ИДЭВХТЭЙ хэсгийг
    ///     одоогийн контекстын сегментэд нэмнэ.  Идэвхтэй хэсэг нь:
    ///       min(одоо, сүүлийн оролт + IdleThreshold,
    ///           Revit урд талаас гарсан агшин + ForegroundGrace,
    ///           дэлгэц түгжигдсэн агшин) хүртэл.
    ///     Тиймээс 10:00-д зогссон хүний 10:00–10:05 нь (бодох зуур) тоологдож,
    ///     10:05-аас IDLE болно; оролт буцаж ирэхэд ЯМАР Ч товчгүйгээр
    ///     ижил таск дээр үргэлжилнэ.
    ///   • Таск/баримт солигдоход ЭХЛЭЭД хуучин контекстыг одоо хүртэл тоолж
    ///     ДУУСГААД дараа нь шилжинэ — А зогсож, Б эхэлнэ.
    ///   • `MaxSampleGap`-ээс их завсар (унтах горим, цаг солих) ТООЛОГДОХГҮЙ.
    ///
    /// ⚠️ Revit-ийн `Idling` үйл явдлыг «хүн идэвхгүй» гэсэн нотолгоо болгож
    ///    ХЭРЭГЛЭХГҮЙ — тэр нь Revit-ийн UI мөчлөгийн тухай, хүний тухай биш.
    /// ⚠️ Бүх public гишүүн `_gate`-ээр түгжигдэнэ — sampler timer, sync loop,
    ///    Revit-ийн үйл явдал, UI гурвуулаа дуудна.  Түгжээ дотор I/O БАЙХГҮЙ.
    /// </summary>
    public sealed class WorkTracker
    {
        private readonly object _gate = new object();
        private readonly TrackingPolicy _p;
        private readonly ITrackingClock _clock;

        public string SessionId { get; }

        private WorkContext _ctx;
        private TrackState _noContextState = TrackState.NoDocument;
        private bool _suspended;

        private bool _started;
        private long _lastMs;
        private DateTime _lastWall;
        private long _lastInputMs;
        private long? _bgSinceMs;
        private long? _lockedSinceMs;
        private bool _lastForeground = true;
        private bool _lastLocked;
        private TrackState _state = TrackState.NoDocument;
        private int _gaps;
        private int _segSeq;

        private readonly Dictionary<string, SegmentRecord> _segments =
            new Dictionary<string, SegmentRecord>(StringComparer.Ordinal);
        private readonly HashSet<string> _dirty = new HashSet<string>(StringComparer.Ordinal);

        public WorkTracker(TrackingPolicy policy, ITrackingClock clock, string sessionId = null)
        {
            _p = policy ?? TrackingPolicy.Default;
            _clock = clock ?? SystemTrackingClock.Instance;
            SessionId = string.IsNullOrEmpty(sessionId) ? Guid.NewGuid().ToString("N") : sessionId;
        }

        /* ============================================================== */
        /*  Оролт                                                          */
        /* ============================================================== */

        /// <summary>OS-ийн шинэ уншилт.  `SampleInterval` тутам хостын timer-ээс.</summary>
        public TrackerSnapshot Sample(ActivitySignals s)
        {
            lock (_gate)
            {
                long now = _clock.MonotonicMs;
                DateTime wall = _clock.UtcNow;
                long lastInput = s.IdleMs >= 0 ? now - s.IdleMs : (_started ? _lastInputMs : now);
                Advance(now, wall, s.RevitForeground, s.SessionLocked, lastInput);
                return SnapshotLocked(now, wall);
            }
        }

        /// <summary>
        /// Таск / баримт / хэрэглэгч солигдлоо.  null = тоолох зүйлгүй (`reason` нь
        /// UI-д харагдах шалтгаан: NoDocument, NoTask, SignedOut).
        /// ⚠️ ЭХЛЭЭД хуучин контекстыг одоо хүртэл тоолж дуусгана.
        /// </summary>
        public void SetContext(WorkContext ctx, TrackState reasonIfNone = TrackState.NoTask)
        {
            lock (_gate)
            {
                long now = _clock.MonotonicMs;
                DateTime wall = _clock.UtcNow;

                if (ctx != null && ctx.SameWork(_ctx))
                {
                    // Ижил ажил — нэр, серверийн id зэргийг л шинэчилнэ (тоололт тасрахгүй).
                    _ctx = ctx;
                    return;
                }

                if (_started) Advance(now, wall, _lastForeground, _lastLocked, _lastInputMs);
                _ctx = ctx;
                _noContextState = ctx == null ? reasonIfNone : TrackState.NoTask;
                if (_started) _state = ComputeState(now);
            }
        }

        /// <summary>Унтах горим / Revit хаагдаж байна — одоо хүртэл тоолоод зогсооно.</summary>
        public void Suspend()
        {
            lock (_gate)
            {
                long now = _clock.MonotonicMs;
                if (_started && !_suspended) Advance(now, _clock.UtcNow, _lastForeground, _lastLocked, _lastInputMs);
                _suspended = true;
                _state = TrackState.Suspended;
            }
        }

        /// <summary>Сэрлээ — завсрыг ТООЛОХГҮЙ, суурийг одооноос эхлүүлнэ.</summary>
        public void Resume()
        {
            lock (_gate)
            {
                if (!_suspended) return;
                _suspended = false;
                _started = false;   // дараагийн Sample шинэ суурь болно
                _bgSinceMs = null;
                _lockedSinceMs = null;
                _state = _ctx == null ? _noContextState : TrackState.Working;
            }
        }

        /* ============================================================== */
        /*  Гаралт                                                         */
        /* ============================================================== */

        public TrackerSnapshot Snapshot()
        {
            lock (_gate) return SnapshotLocked(_clock.MonotonicMs, _clock.UtcNow);
        }

        public TrackState State { get { lock (_gate) return _state; } }

        public WorkContext Context { get { lock (_gate) return _ctx; } }

        /// <summary>
        /// Өөрчлөгдсөн сегментүүдийн ХУРИМТЛАЛЫН хуулбар.  Дуудах бүрд «бохир»
        /// тэмдэг арилна — дуудагч (sync) тэдгээрийг ЗААВАЛ дараалалд хадгална.
        /// </summary>
        public List<SegmentRecord> DrainDirty()
        {
            lock (_gate)
            {
                var list = new List<SegmentRecord>(_dirty.Count);
                foreach (string k in _dirty)
                {
                    SegmentRecord s;
                    if (_segments.TryGetValue(k, out s)) list.Add(s.Clone());
                }
                _dirty.Clear();
                return list;
            }
        }

        /// <summary>Энэ сесст тухайн таск дээр тухайн өдөр хуримтлагдсан идэвхтэй мс.</summary>
        public long SessionActiveMs(int taskId, string workDate)
        {
            lock (_gate)
            {
                long sum = 0;
                foreach (SegmentRecord s in _segments.Values)
                    if (s.TaskId == taskId && s.WorkDate == workDate) sum += s.ActiveMs;
                return sum;
            }
        }

        /// <summary>Сервер рүү явах heartbeat-ийн төлөв.</summary>
        public PresenceDto Presence()
        {
            lock (_gate)
            {
                WorkContext c = _ctx;
                return new PresenceDto
                {
                    State = TrackStateWire.Of(_state),
                    TaskId = c?.TaskId,
                    ProjectId = c?.ProjectId,
                    RevitDocumentId = c?.RevitDocumentId,
                    DocName = c?.DocName,
                    ClientAt = Iso(_clock.UtcNow),
                };
            }
        }

        /* ============================================================== */
        /*  Дотоод                                                         */
        /* ============================================================== */

        private void Advance(long now, DateTime wall, bool foreground, bool locked, long lastInputMs)
        {
            if (lastInputMs > now) lastInputMs = now;

            if (!_started)
            {
                _started = true;
                _lastMs = now;
                _lastWall = wall;
                _lastInputMs = lastInputMs;
                _bgSinceMs = foreground ? (long?)null : now;
                _lockedSinceMs = locked ? (long?)now : null;
                _lastForeground = foreground;
                _lastLocked = locked;
                _state = ComputeState(now);
                return;
            }

            long dt = now - _lastMs;
            if (dt <= 0)
            {
                // Монотон цаг ухрахгүй; ижил агшны давхар дуудлага л.
                _lastForeground = foreground;
                _lastLocked = locked;
                if (lastInputMs > _lastInputMs) _lastInputMs = lastInputMs;
                _state = ComputeState(now);
                return;
            }

            double wallDt = (wall - _lastWall).TotalMilliseconds;
            bool gap = dt > _p.MaxSampleGapMs || Math.Abs(wallDt - dt) > _p.MaxSampleGapMs;
            if (gap)
            {
                // ⚠️ Унтах горим / цаг солих / процесс гацах — завсарт юу болсныг
                //    мэдэхгүй тул ТООЛОХГҮЙ.  Сэрэх үеийн товчлуурын дараа оролт
                //    «шинэ» харагддаг — тэр нь 2 цагийн унтсан хугацааг ажил гэж
                //    тоолох шалтгаан БОЛОХГҮЙ.
                _gaps++;
                _lastMs = now;
                _lastWall = wall;
                _lastInputMs = lastInputMs;
                _bgSinceMs = foreground ? (long?)null : now;
                _lockedSinceMs = locked ? (long?)now : null;
                _lastForeground = foreground;
                _lastLocked = locked;
                _state = ComputeState(now);
                return;
            }

            long prev = _lastMs;
            long? bgSince = _bgSinceMs;
            if (!foreground && bgSince == null) bgSince = prev;       // энэ завсарт гарсан
            long? lockSince = _lockedSinceMs;
            if (locked && lockSince == null) lockSince = prev;

            long until = now;
            until = Math.Min(until, lastInputMs + _p.IdleThresholdMs);
            if (bgSince.HasValue) until = Math.Min(until, bgSince.Value + _p.ForegroundGraceMs);
            if (lockSince.HasValue) until = Math.Min(until, lockSince.Value);

            long active = until - prev;
            if (active < 0) active = 0;
            if (active > dt) active = dt;

            if (_ctx != null && !_suspended) Credit(_ctx, wall, active, dt - active);

            _lastMs = now;
            _lastWall = wall;
            _lastInputMs = lastInputMs;
            _bgSinceMs = foreground ? (long?)null : bgSince;
            _lockedSinceMs = locked ? lockSince : null;
            _lastForeground = foreground;
            _lastLocked = locked;
            _state = ComputeState(now);
        }

        private TrackState ComputeState(long now)
        {
            if (_suspended) return TrackState.Suspended;
            if (_ctx == null) return _noContextState;
            bool inputActive = now < _lastInputMs + _p.IdleThresholdMs && _lockedSinceMs == null;
            if (!inputActive) return TrackState.Idle;
            if (_bgSinceMs.HasValue && now >= _bgSinceMs.Value + _p.ForegroundGraceMs) return TrackState.Background;
            return TrackState.Working;
        }

        private void Credit(WorkContext c, DateTime wall, long active, long idle)
        {
            if (active <= 0 && idle <= 0) return;
            string date = _p.WorkDateOf(wall);
            string key = c.UserId.ToString(CultureInfo.InvariantCulture) + "|" +
                         c.TaskId.ToString(CultureInfo.InvariantCulture) + "|" +
                         (c.DocKey ?? "") + "|" + date;
            SegmentRecord seg;
            if (!_segments.TryGetValue(key, out seg))
            {
                seg = new SegmentRecord
                {
                    SegmentId = SessionId + "-" + (++_segSeq).ToString(CultureInfo.InvariantCulture),
                    SessionId = SessionId,
                    UserId = c.UserId,
                    TaskId = c.TaskId,
                    DocKey = c.DocKey,
                    WorkDate = date,
                    FirstAt = Iso(wall),
                };
                _segments[key] = seg;
            }
            // Серверийн id хожим тодорч болно — сүүлийн мэдэгдсэнийг авна.
            if (c.ProjectId.HasValue) seg.ProjectId = c.ProjectId;
            if (c.RevitDocumentId.HasValue) seg.RevitDocumentId = c.RevitDocumentId;
            seg.ActiveMs += Math.Max(0, active);
            seg.IdleMs += Math.Max(0, idle);
            seg.LastAt = Iso(wall);
            seg.Rev++;
            _dirty.Add(key);
        }

        private TrackerSnapshot SnapshotLocked(long now, DateTime wall)
        {
            string date = _p.WorkDateOf(wall);
            long cur = 0, total = 0;
            foreach (SegmentRecord s in _segments.Values)
            {
                if (s.WorkDate != date) continue;
                total += s.ActiveMs;
                if (_ctx != null && s.TaskId == _ctx.TaskId && s.UserId == _ctx.UserId) cur += s.ActiveMs;
            }
            return new TrackerSnapshot
            {
                State = _started ? _state : (_suspended ? TrackState.Suspended : (_ctx == null ? _noContextState : TrackState.Working)),
                Context = _ctx,
                CurrentTaskSessionMs = cur,
                SessionTodayMs = total,
                AtMs = _started ? _lastMs : now,
                WorkDate = date,
                Gaps = _gaps,
            };
        }

        internal static string Iso(DateTime utc)
        {
            return utc.ToUniversalTime().ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture);
        }
    }
}
