using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace RevitMcpAddin.WorkTracking.Core
{
    /// <summary>
    /// ОФЛАЙН ДАРААЛАЛ — сервер баталгаажуулах хүртэл ажилласан цаг (сегмент)
    /// ба өдрийн тайлан хэзээ ч алдагдахгүй.
    ///
    /// Хадгалах газар: `%APPDATA%\RevitMcpAddin\tracking\outbox-&lt;сесс&gt;.json`
    /// (add-in-ийн одоо байгаа хэрэглэгч тутмын үндэс — шинэ хамаарал, шинэ
    /// DB, суулгацын эрсдэл ҮҮСГЭХГҮЙ; `System.Text.Json` л).
    ///
    /// ⚠️ ПРОЦЕСС ТУТАМД ТУСДАА ФАЙЛ.  Хоёр Revit зэрэг нээлттэй байхад нэг
    ///    файлыг бүтнээр дахин бичвэл нэг нь нөгөөгийнхөө бичлэгийг дарна.
    ///    Сесс бүр өөрийн файл + `outbox-&lt;сесс&gt;.lock`-ийг (FileShare.None,
    ///    DeleteOnClose) процессын турш барина.  Revit унасан ч OS түгжээг
    ///    чөлөөлнө — дараагийн эхлэл тэр «өнчин» файлыг ӨӨРТӨӨ шингээж
    ///    дахин илгээнэ (сегментийн id нь хуучин сессийнх хэвээр — давхардахгүй).
    /// ⚠️ Бичилт нь АТОМ — `.tmp` руу бичээд солино; дутуу бичигдсэн JSON үлдэхгүй.
    /// ⚠️ Сегмент нь ХУРИМТЛАЛ тул ижил id-г ДАРЖ хадгална (өндөр `rev` ялна).
    /// </summary>
    public sealed class TrackingOutbox : IDisposable
    {
        private const int Schema = 1;
        private const int MaxSentReportsKept = 30;

        private readonly object _gate = new object();
        private readonly string _dir;
        private readonly string _sessionId;
        private readonly TrackingPolicy _p;
        private FileStream _lock;
        private bool _dirty;

        private readonly Dictionary<string, SegmentRecord> _segs =
            new Dictionary<string, SegmentRecord>(StringComparer.Ordinal);
        private readonly List<ReportItem> _reports = new List<ReportItem>();

        /// <summary>Эхлэхэд шингээсэн өнчин файлын тоо (оношилгоо).</summary>
        public int AdoptedFiles { get; private set; }

        private TrackingOutbox(string dir, string sessionId, TrackingPolicy p)
        {
            _dir = dir;
            _sessionId = sessionId;
            _p = p ?? TrackingPolicy.Default;
        }

        /// <summary>Санах ойн дараалал — дискгүй (тест).</summary>
        public static TrackingOutbox InMemory(string sessionId, TrackingPolicy p = null)
        {
            return new TrackingOutbox(null, sessionId, p);
        }

        /// <summary>
        /// Диск дээрх дараалал.  Өнчин файлуудыг (эзэн процесс нь үхсэн) шингээнэ.
        /// Диск ашиглах боломжгүй бол санах ойд ажиллана — бүртгэл зогсохгүй.
        /// </summary>
        public static TrackingOutbox Open(string dir, string sessionId, TrackingPolicy p = null)
        {
            var box = new TrackingOutbox(dir, sessionId, p);
            if (string.IsNullOrEmpty(dir)) return box;
            try
            {
                Directory.CreateDirectory(dir);
                box._lock = new FileStream(box.LockPath(sessionId), FileMode.OpenOrCreate,
                    FileAccess.ReadWrite, FileShare.None, 1, FileOptions.DeleteOnClose);
                box.AdoptOrphans();
                box.Save();
            }
            catch
            {
                // Хавтас бичих эрхгүй г.м. — санах ойд үргэлжилнэ.
            }
            return box;
        }

        private string DataPath(string sessionId) => Path.Combine(_dir, "outbox-" + sessionId + ".json");
        private string LockPath(string sessionId) => Path.Combine(_dir, "outbox-" + sessionId + ".lock");

        /* ============================================================== */
        /*  Сегмент                                                        */
        /* ============================================================== */

        public void UpsertSegments(IEnumerable<SegmentRecord> records)
        {
            if (records == null) return;
            lock (_gate)
            {
                foreach (SegmentRecord r in records)
                {
                    if (r == null || string.IsNullOrEmpty(r.SegmentId)) continue;
                    SegmentRecord cur;
                    if (_segs.TryGetValue(r.SegmentId, out cur) && cur.Rev >= r.Rev) continue;
                    _segs[r.SegmentId] = r.Clone();
                    _dirty = true;
                }
            }
        }

        /// <summary>
        /// Илгээх сегментүүд — хэрэглэгчийнх л (өөр хүний токеноор хэзээ ч явахгүй),
        /// хуучнаас нь эхэлж (`last_at`, id) — дараалал нь тогтвортой.
        /// </summary>
        public List<SegmentRecord> PendingSegments(int userId, int max)
        {
            lock (_gate)
            {
                return _segs.Values
                    .Where(s => s.UserId == userId)
                    .OrderBy(s => s.LastAt ?? "", StringComparer.Ordinal)
                    .ThenBy(s => s.SegmentId, StringComparer.Ordinal)
                    .Take(Math.Max(1, max))
                    .Select(s => s.Clone())
                    .ToList();
            }
        }

        public int PendingSegmentCount(int? userId = null)
        {
            lock (_gate) return userId.HasValue ? _segs.Values.Count(s => s.UserId == userId.Value) : _segs.Count;
        }

        /// <summary>
        /// Серверийн баталгаа — хадгалсан `rev` нь баталсан `rev`-ээс хэтрээгүй бол
        /// хасна.  Баталгааны ДАРАА шинэ цаг нэмэгдсэн бол (өндөр rev) ҮЛДЭЭЖ дахин илгээнэ.
        /// </summary>
        public int AckSegments(IEnumerable<SegmentAck> acks)
        {
            if (acks == null) return 0;
            int removed = 0;
            lock (_gate)
            {
                foreach (SegmentAck a in acks)
                {
                    if (a == null || string.IsNullOrEmpty(a.SegmentId)) continue;
                    if (a.Status != "accepted" && a.Status != "rejected") continue;
                    SegmentRecord cur;
                    if (!_segs.TryGetValue(a.SegmentId, out cur)) continue;
                    if (cur.Rev > a.Rev) continue;
                    _segs.Remove(a.SegmentId);
                    removed++;
                    _dirty = true;
                }
            }
            return removed;
        }

        /* ============================================================== */
        /*  Тайлан                                                         */
        /* ============================================================== */

        public void AddReport(ReportItem r)
        {
            if (r == null || string.IsNullOrEmpty(r.DraftUid)) return;
            lock (_gate)
            {
                _reports.RemoveAll(x => x.DraftUid == r.DraftUid);
                _reports.Add(r.Clone());
                _dirty = true;
            }
        }

        public void UpdateReport(ReportItem r)
        {
            if (r == null) return;
            lock (_gate)
            {
                int i = _reports.FindIndex(x => x.DraftUid == r.DraftUid);
                if (i < 0) return;
                _reports[i] = r.Clone();
                _dirty = true;
            }
        }

        public bool RemoveReport(string draftUid)
        {
            lock (_gate)
            {
                int n = _reports.RemoveAll(x => x.DraftUid == draftUid);
                if (n > 0) _dirty = true;
                return n > 0;
            }
        }

        /// <summary>Илгээгдээгүй (pending) тайлангууд — бичсэн дарааллаар.</summary>
        public List<ReportItem> PendingReports(int userId, int max)
        {
            lock (_gate)
            {
                return _reports
                    .Where(r => r.UserId == userId && r.State == ReportStates.Pending)
                    .OrderBy(r => r.CreatedAt ?? "", StringComparer.Ordinal)
                    .Take(Math.Max(1, max))
                    .Select(r => r.Clone())
                    .ToList();
            }
        }

        /// <summary>UI-д: хэрэглэгчийн бүх тайлан (хүлээгдэж буй, алдаатай, саяхан илгээсэн).</summary>
        public List<ReportItem> Reports(int userId)
        {
            lock (_gate)
            {
                return _reports.Where(r => r.UserId == userId)
                    .OrderBy(r => r.CreatedAt ?? "", StringComparer.Ordinal)
                    .Select(r => r.Clone())
                    .ToList();
            }
        }

        /* ============================================================== */
        /*  Засвар үйлчилгээ                                               */
        /* ============================================================== */

        /// <summary>
        /// Хэт хуучин сегмент (сервер хүлээж авахгүй) болон хэт олон бичлэгийг
        /// хасна.  ⚠️ ИЛГЭЭГДЭЭГҮЙ ТАЙЛАНГ ХЭЗЭЭ Ч ХАСАХГҮЙ — ажилтны текст.
        /// </summary>
        public void Prune(DateTime nowUtc)
        {
            lock (_gate)
            {
                string cutoff = nowUtc.Subtract(_p.MaxQueueAge).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
                var old = _segs.Values.Where(s => string.CompareOrdinal(s.WorkDate ?? "", cutoff) < 0)
                    .Select(s => s.SegmentId).ToList();
                foreach (string id in old) { _segs.Remove(id); _dirty = true; }

                if (_segs.Count > _p.MaxQueuedSegments)
                {
                    foreach (string id in _segs.Values
                                 .OrderBy(s => s.LastAt ?? "", StringComparer.Ordinal)
                                 .Take(_segs.Count - _p.MaxQueuedSegments)
                                 .Select(s => s.SegmentId).ToList())
                    {
                        _segs.Remove(id);
                        _dirty = true;
                    }
                }

                // Илгээгдсэн тайлан нь зөвхөн UI-ийн «өнөөдөр илгээсэн» жагсаалтад —
                // 2 хоногоос хуучин эсвэл 30-аас олон бол хасна.
                string sentCutoff = Iso(nowUtc.AddDays(-2));
                var sent = _reports.Where(r => r.State == ReportStates.Sent)
                    .OrderByDescending(r => r.SentAt ?? r.CreatedAt ?? "", StringComparer.Ordinal).ToList();
                var drop = sent.Skip(MaxSentReportsKept)
                    .Concat(sent.Where(r => string.CompareOrdinal(r.SentAt ?? r.CreatedAt ?? "", sentCutoff) < 0))
                    .Distinct().ToList();
                foreach (ReportItem r in drop)
                {
                    if (_reports.Remove(r)) _dirty = true;
                }
            }
        }

        /// <summary>Өөрчлөлт байвал атомоор бичнэ.  Алдаа залгина — бүртгэл зогсохгүй.</summary>
        public void Save()
        {
            if (string.IsNullOrEmpty(_dir)) { lock (_gate) _dirty = false; return; }
            string json;
            lock (_gate)
            {
                if (!_dirty && File.Exists(DataPath(_sessionId))) return;
                var doc = new OutboxDoc
                {
                    Schema = Schema,
                    SessionId = _sessionId,
                    Segments = _segs.Values.Select(s => s.Clone()).ToList(),
                    Reports = _reports.Select(r => r.Clone()).ToList(),
                };
                json = JsonSerializer.Serialize(doc);
                _dirty = false;
            }
            try
            {
                string path = DataPath(_sessionId);
                string tmp = path + ".tmp";
                File.WriteAllText(tmp, json);
                if (File.Exists(path)) File.Replace(tmp, path, null);
                else File.Move(tmp, path);
            }
            catch
            {
                lock (_gate) _dirty = true;   // дараагийн удаа дахин оролдоно
            }
        }

        private void AdoptOrphans()
        {
            string[] files;
            try { files = Directory.GetFiles(_dir, "outbox-*.json"); }
            catch { return; }
            foreach (string f in files)
            {
                string name = Path.GetFileNameWithoutExtension(f);           // outbox-<id>
                string sid = name.Length > 7 ? name.Substring(7) : null;
                if (string.IsNullOrEmpty(sid) || sid == _sessionId) continue;

                FileStream probe = null;
                try
                {
                    // Эзэн процесс амьд бол түгжээ онгойхгүй — тэр файлд ХҮРЭХГҮЙ.
                    probe = new FileStream(LockPath(sid), FileMode.OpenOrCreate, FileAccess.ReadWrite,
                        FileShare.None, 1, FileOptions.DeleteOnClose);
                }
                catch
                {
                    continue;
                }
                try
                {
                    OutboxDoc doc = null;
                    try { doc = JsonSerializer.Deserialize<OutboxDoc>(File.ReadAllText(f)); }
                    catch { doc = null; }
                    if (doc != null)
                    {
                        UpsertSegments(doc.Segments ?? new List<SegmentRecord>());
                        lock (_gate)
                        {
                            foreach (ReportItem r in doc.Reports ?? new List<ReportItem>())
                            {
                                if (r == null || string.IsNullOrEmpty(r.DraftUid)) continue;
                                if (_reports.Any(x => x.DraftUid == r.DraftUid)) continue;
                                _reports.Add(r);
                                _dirty = true;
                            }
                        }
                        AdoptedFiles++;
                    }
                    // Эхлээд ӨӨРИЙН файлд хадгална, ДАРАА нь өнчнийг устгана — дунд нь
                    // унавал хоёр файлд давхар үлдэнэ (сервер MAX тул хор хөнөөлгүй).
                    _dirty = true;
                    Save();
                    try { File.Delete(f); } catch { }
                    try { File.Delete(f + ".tmp"); } catch { }
                }
                finally
                {
                    probe.Dispose();
                }
            }
        }

        public void Dispose()
        {
            Save();
            try
            {
                bool empty;
                lock (_gate) empty = _segs.Count == 0 && _reports.All(r => r.State == ReportStates.Sent);
                if (empty && !string.IsNullOrEmpty(_dir))
                {
                    try { File.Delete(DataPath(_sessionId)); } catch { }
                }
            }
            finally
            {
                try { _lock?.Dispose(); } catch { }
                _lock = null;
            }
        }

        private static string Iso(DateTime utc) => WorkTracker.Iso(utc);

        internal sealed class OutboxDoc
        {
            [JsonPropertyName("schema")] public int Schema { get; set; }
            [JsonPropertyName("session_id")] public string SessionId { get; set; }
            [JsonPropertyName("segments")] public List<SegmentRecord> Segments { get; set; }
            [JsonPropertyName("reports")] public List<ReportItem> Reports { get; set; }
        }
    }
}
