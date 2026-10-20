using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using RevitMcpAddin.Intelligence.Contracts;

namespace RevitMcpAddin.Intelligence.Core
{
    /// <summary>Хадгалах газрын адаптер (§26) — Session B-ийн LocalAppData зохион байгуулалт ирэхэд ЭНД л солигдоно.</summary>
    public interface IIntelligenceStoragePaths
    {
        /// <summary>Журнал, төслийн холбоос, олдворын төлөв энэ хавтсанд.  null = дискгүй (тест).</summary>
        string RootDir { get; }
    }

    /// <summary>
    /// Өгөгдмөл: `%APPDATA%\RevitMcpAddin\intelligence\` — одоо байгаа add-in-ийн
    /// үндэс (`SettingsStore.Dir`, `BimEmitter.Dir`) дотор.  ШИНЭ үндэс ҮҮСГЭХГҮЙ.
    /// </summary>
    public sealed class AppDataStoragePaths : IIntelligenceStoragePaths
    {
        public string RootDir
        {
            get
            {
                return Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
                    "RevitMcpAddin", "intelligence");
            }
        }
    }

    public sealed class NoDiskStoragePaths : IIntelligenceStoragePaths
    {
        public string RootDir { get { return null; } }
    }

    /// <summary>
    /// ҮЙЛ АЖИЛЛАГААНЫ ЖУРНАЛ (§26) — тайлангийн НОТОЛГООНЫ эх сурвалж.
    ///
    /// ⚠️ Revit-ийн түүхий журнал БИШ; `BimEmitter`-ийн сургалтын үйл явдал ч
    ///    БИШ.  Ажилтны ӨӨРИЙН тайланд хэрэгтэй бүтэцтэй мөрүүд л.
    /// ⚠️ Геометр ХЭЗЭЭ Ч орохгүй; элементийн id-г ЗӨВХӨН олдвор/даалгаврын
    ///    мөрөнд (≤ 50) хадгална.
    /// ⚠️ Диск рүү ЗАЛГАМАЛ (append) — `BimEmitter`-ийн сургамж: бүтэн дахин
    ///    бичилт ХЭЗЭЭ Ч хийхгүй.  Бичилт нь дуудагчийн thread дээр
    ///    (Revit-ийн үйл явдлын дотроос ХЭЗЭЭ Ч дуудахгүй — §15).
    /// ⚠️ Процесс тутамд тусдаа файл (`journal-<өдөр>-<pid>.jsonl`) — хоёр Revit
    ///    нэг файлд бичихэд `FileShare` зөрчил гардаг (`BimEmitter.cs` T6).
    /// </summary>
    public sealed class ActivityJournal
    {
        private readonly object _gate = new object();
        private readonly List<JournalEvent> _mem = new List<JournalEvent>();
        private readonly IIntelligenceStoragePaths _paths;
        private readonly string _fileTag;
        private long _seq;
        private const int MaxInMemory = 20000;
        private const int MaxIdsPerEvent = 50;

        public string SessionId { get; }
        public DateTime SessionStartedUtc { get; }

        public ActivityJournal(IIntelligenceStoragePaths paths, string sessionId = null, string fileTag = null, DateTime? nowUtc = null)
        {
            _paths = paths ?? new NoDiskStoragePaths();
            SessionId = sessionId ?? Guid.NewGuid().ToString("N").Substring(0, 12);
            SessionStartedUtc = nowUtc ?? DateTime.UtcNow;
            _fileTag = fileTag ?? SessionId;
        }

        public long Count { get { lock (_gate) return _mem.Count; } }

        public JournalEvent Append(JournalEvent e, DateTime? nowUtc = null)
        {
            if (e == null) throw new ArgumentNullException(nameof(e));
            if (e.ElementIds != null && e.ElementIds.Count > MaxIdsPerEvent)
            {
                e.ElementIds = e.ElementIds.GetRange(0, MaxIdsPerEvent);
            }
            string line;
            lock (_gate)
            {
                e.Seq = ++_seq;
                e.At = e.At ?? (nowUtc ?? DateTime.UtcNow).ToString("o");
                e.SessionId = e.SessionId ?? SessionId;
                _mem.Add(e);
                if (_mem.Count > MaxInMemory) _mem.RemoveRange(0, _mem.Count - MaxInMemory);
                line = IntelligenceJson.Serialize(e);
            }
            TryAppendDisk(line, e.At);
            return e;
        }

        public JournalEvent Log(JournalEventKind kind, string docKey, Action<JournalEvent> fill = null, DateTime? nowUtc = null)
        {
            var e = new JournalEvent { Kind = kind, DocKey = docKey };
            if (fill != null) fill(e);
            return Append(e, nowUtc);
        }

        /// <summary>Хуулбар — [fromUtc, toUtc] хооронд, баримтаар шүүсэн (null = бүгд).</summary>
        public List<JournalEvent> Read(DateTime? fromUtc = null, DateTime? toUtc = null, string docKey = null)
        {
            var list = new List<JournalEvent>();
            lock (_gate)
            {
                foreach (JournalEvent e in _mem)
                {
                    if (docKey != null && !string.Equals(e.DocKey, docKey, StringComparison.Ordinal)) continue;
                    DateTime at;
                    if (!DateTime.TryParse(e.At, null, System.Globalization.DateTimeStyles.RoundtripKind, out at)) continue;
                    at = at.ToUniversalTime();
                    if (fromUtc != null && at < fromUtc.Value) continue;
                    if (toUtc != null && at > toUtc.Value) continue;
                    list.Add(e);
                }
            }
            return list;
        }

        private void TryAppendDisk(string line, string atIso)
        {
            string root = _paths.RootDir;
            if (string.IsNullOrEmpty(root)) return;
            try
            {
                Directory.CreateDirectory(root);
                string day = atIso != null && atIso.Length >= 10 ? atIso.Substring(0, 10) : DateTime.UtcNow.ToString("yyyy-MM-dd");
                string path = Path.Combine(root, "journal-" + day + "-" + _fileTag + ".jsonl");
                // ⚠️ BOM-гүй UTF-8 (урхи №7: `Encoding.UTF8` BOM нэмдэг).
                using (var fs = new FileStream(path, FileMode.Append, FileAccess.Write, FileShare.Read))
                using (var w = new StreamWriter(fs, new UTF8Encoding(false)))
                {
                    w.Write(line);
                    w.Write('\n');
                }
            }
            catch
            {
                // Диск нь best-effort — санах ойн журнал үнэн хэвээр.
            }
        }
    }
}
