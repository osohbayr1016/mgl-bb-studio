using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IO;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;

namespace RevitMcpAddin.Smart.Core
{
    /// <summary>
    /// «MGL Smart»-ын ДИАГНОСТИК ЛОГ — `%APPDATA%\RevitMcpAddin\smart\logs\smart.log.jsonl`
    /// (1.5 МБ хэтрэхэд `.1` руу эргэлдэнэ).
    ///
    /// ⚠️ НУУЦЛАЛ.  Лог нь ТӨСЛИЙН АГУУЛГА (элементийн нэр, хуудасны нэр/дугаар, файлын зам,
    /// параметрийн утга)-г ОРУУЛАХГҮЙ: зөвхөн тоо, нэр томьёоны код, хугацаа, ХЭШЛЭСЭН
    /// таних тэмдэг (`Id()`), хэвийн алдааны ТӨРӨЛ.  Дуудагч өгөгдлөө өөрөө цэвэр өгнө;
    /// `Scrub` нь алдааны мессеж дэх зам/нэрийг орлуулдаг хамгаалалт.
    ///
    /// ⚠️ ДЭЭД ХЭСЭГ БЛОКЛОХГҮЙ.  `DocumentChanged` гэх мэт халуун зам дуудаж болох тул
    /// бичилт нь дараалалд хийгээд ӨӨРИЙН thread-ээр дискэнд бичигдэнэ (IsBackground).
    /// Дараалал дүүрвэл мөрийг ХАЯНА (лог нь ажлыг хүлээлгэх ёсгүй).  Алдаа ХЭЗЭЭ Ч
    /// шидэхгүй.
    /// </summary>
    public static class SmartLog
    {
        private const long MaxBytes = 1_500_000;
        private const int QueueCap = 5000;

        private static readonly object Gate = new object();
        private static BlockingCollection<string> _queue;
        private static Thread _thread;
        private static string _dirOverride;
        private static long _dropped;
        private static int _pendingWrites;
        private static readonly ManualResetEventSlim Idle = new ManualResetEventSlim(true);

        /// <summary>Тест/тусгай байршил.  null = `SmartPaths.Logs`.</summary>
        public static void Configure(string dir)
        {
            lock (Gate) { _dirOverride = dir; }
        }

        private static string Dir
        {
            get { return !string.IsNullOrEmpty(_dirOverride) ? _dirOverride : SmartPaths.Logs; }
        }

        public static void Info(string component, string evt, object data = null) { Write("info", component, evt, null, data); }
        public static void Warn(string component, string evt, object data = null) { Write("warn", component, evt, null, data); }
        public static void Error(string component, string evt, Exception ex, object data = null) { Write("error", component, evt, ex, data); }

        /// <summary>Таних тэмдгийг хэшлэж логт оруулна (UniqueId, файлын нэр г.м. — шууд бичихгүй).</summary>
        public static string Id(string raw)
        {
            return string.IsNullOrEmpty(raw) ? "" : SmartHash.Short(raw, 4);
        }

        private static readonly Regex DrivePath = new Regex(@"[A-Za-z]:\\[^\s""'<>|]*", RegexOptions.Compiled);
        private static readonly Regex UncPath = new Regex(@"\\\\[^\s""'<>|]+", RegexOptions.Compiled);
        private static readonly Regex Quoted = new Regex("[\"“«'][^\"”»']{1,120}[\"”»']", RegexOptions.Compiled);

        /// <summary>Алдааны мессежээс зам ба хашилтан доторх нэрийг арилгана; 200 тэмдэгтэд тайрна.</summary>
        public static string Scrub(string message)
        {
            if (string.IsNullOrEmpty(message)) return "";
            string s = UncPath.Replace(message, "<path>");
            s = DrivePath.Replace(s, "<path>");
            s = Quoted.Replace(s, "<name>");
            s = s.Replace('\r', ' ').Replace('\n', ' ');
            return s.Length > 200 ? s.Substring(0, 200) : s;
        }

        private static void Write(string level, string component, string evt, Exception ex, object data)
        {
            try
            {
                var sb = new StringBuilder(160);
                sb.Append("{\"t\":\"").Append(DateTime.UtcNow.ToString("o")).Append("\",\"lvl\":\"").Append(level)
                  .Append("\",\"c\":").Append(Json(component)).Append(",\"e\":").Append(Json(evt));
                if (ex != null)
                {
                    sb.Append(",\"ex\":").Append(Json(ex.GetType().Name))
                      .Append(",\"msg\":").Append(Json(Scrub(ex.Message)));
                }
                if (data != null)
                {
                    string d = SmartJson.Serialize(data);
                    // data нь JSON объект хэлбэртэй л байх ёстой; хэт урт бол тайрна.
                    if (d.Length > 1200) d = Json("(truncated " + d.Length + ")");
                    sb.Append(",\"d\":").Append(d);
                }
                sb.Append('}');
                Enqueue(sb.ToString());
            }
            catch (Exception)
            {
                // Лог нь ХЭЗЭЭ Ч ажлыг унагаахгүй.
            }
        }

        private static string Json(string s)
        {
            return System.Text.Json.JsonSerializer.Serialize(s ?? "");
        }

        private static void Enqueue(string line)
        {
            EnsureWriter();
            BlockingCollection<string> q = _queue;
            if (q == null) return;
            Interlocked.Increment(ref _pendingWrites);
            Idle.Reset();
            if (!q.TryAdd(line))
            {
                Interlocked.Decrement(ref _pendingWrites);
                Interlocked.Increment(ref _dropped);
            }
        }

        private static void EnsureWriter()
        {
            if (_thread != null) return;
            lock (Gate)
            {
                if (_thread != null) return;
                _queue = new BlockingCollection<string>(QueueCap);
                _thread = new Thread(Pump) { IsBackground = true, Name = "MGL Smart log" };
                _thread.Start();
            }
        }

        private static void Pump()
        {
            var batch = new List<string>(64);
            foreach (string first in _queue.GetConsumingEnumerable())
            {
                batch.Clear();
                batch.Add(first);
                string next;
                while (batch.Count < 200 && _queue.TryTake(out next)) batch.Add(next);
                try { WriteBatch(batch); }
                catch (Exception) { /* дараагийн оролдлогод */ }
                if (Interlocked.Add(ref _pendingWrites, -batch.Count) <= 0) Idle.Set();
            }
        }

        private static void WriteBatch(List<string> lines)
        {
            string dir = Dir;
            Directory.CreateDirectory(dir);
            string path = Path.Combine(dir, "smart.log.jsonl");
            try
            {
                var fi = new FileInfo(path);
                if (fi.Exists && fi.Length > MaxBytes)
                {
                    string old = Path.Combine(dir, "smart.log.1.jsonl");
                    if (File.Exists(old)) File.Delete(old);
                    File.Move(path, old);
                }
            }
            catch (IOException) { }
            catch (UnauthorizedAccessException) { }

            var sb = new StringBuilder();
            foreach (string l in lines) sb.Append(l).Append('\n');
            File.AppendAllText(path, sb.ToString(), new UTF8Encoding(false));
        }

        /// <summary>Дараалал шавхагдтал (эсвэл хугацаа дуустал) хүлээнэ.  Тест, унтраалт.</summary>
        public static bool Flush(int timeoutMs = 3000)
        {
            return Idle.Wait(timeoutMs);
        }

        public static long Dropped
        {
            get { return Interlocked.Read(ref _dropped); }
        }
    }
}
