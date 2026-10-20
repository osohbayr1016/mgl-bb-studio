// ⚠️ ХАРНЕССИЙН STUB — `check_emitter.py` ЛЕ ашиглана, Revit-д ХЭЗЭЭ Ч
//    ачаалагдахгүй (`addin/` -д БИШ, `training/` -д амьдардаг).
//
//    ЗӨВХӨН ЭНД байгаа зүйлс загварчлагдсан: Revit-ийн цагираг
//    (`ChangeTracker`), HTTP (`AiHttp`), тохиргоо (`SettingsStore`),
//    хэмжүүр (`Metrics`).  `BimEmitter.cs`-ийн дараалал, диск, курсор,
//    багцлалт, backoff, таслуур, нягтралт, унтраалт нь БҮГД ЖИНХЭНЭ КОД.
//
//    Талбарын нэр / төрөл / гарын үсэг нь `addin/ChangeTracker.cs`-тай
//    мөр мөрөөр таарна; зөрвөл эмхэтгэл УНАЖ харнесс улаан болно — тэр нь
//    зориулалт (чимээгүй хуучирахаас хамгаална).

using System;
using System.Collections.Concurrent;
using System.Net;
using System.Net.Http;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace RevitMcpAddin
{
    /// <summary>Харнессийн удирдлага — сүлжээний горим, POST-ын бүртгэл, хавтас.</summary>
    internal static class Harness
    {
        /// <summary>`BimEmitter.Dir`-ийн орлуулга (`check_emitter.py`).</summary>
        public static string Dir;

        /// <summary>Гүйлт бүрийн өвөрмөц таг — POST-ын бүртгэлийн файлын нэр.</summary>
        public static string RunId = "r0";

        /// <summary>⚠️ `Dir`-ЭЭС ГАДНА байх ЁСТОЙ.  T7 (диск бичигдэхгүй) нь
        /// `Dir`-ыг бичигдэхгүй болгодог; бүртгэл тэнд байвал нотолгоо
        /// БАС алга болно.</summary>
        public static string CtlDir;

        public static readonly System.Diagnostics.Stopwatch Clock =
            System.Diagnostics.Stopwatch.StartNew();

        private static readonly object _gate = new object();

        /// <summary>`up` | `down` | `413` | `401` | `500` | `off`.
        /// ⚠️ Оролдлого БҮРД ДАХИН уншина — Python нь гүйлтийн дунд солино.</summary>
        public static string NetMode()
        {
            try { return File.ReadAllText(Path.Combine(CtlDir, "net.txt")).Trim(); }
            catch { return "up"; }
        }

        /// <summary>POST оролдлого бүрийг цаг хугацаа + бие + үр дүнгээр бичнэ.
        /// «оролдсон» ба «хүргэгдсэн» хоёрыг Python тал ЯЛГАЖ чадна.</summary>
        public static void LogAttempt(string mode, int code, bool delivered, string body)
        {
            try
            {
                string p = Path.Combine(CtlDir, "attempts-" + RunId + ".jsonl");
                var sb = new StringBuilder(1024);
                sb.Append("{\"ms\":").Append(Clock.ElapsedMilliseconds);
                sb.Append(",\"run\":").Append(J(RunId));
                sb.Append(",\"mode\":").Append(J(mode));
                sb.Append(",\"code\":").Append(code);
                sb.Append(",\"delivered\":").Append(delivered ? "true" : "false");
                sb.Append(",\"body\":").Append(body == null ? "null" : body);
                sb.Append("}\n");
                lock (_gate) File.AppendAllText(p, sb.ToString(), new UTF8Encoding(false));
            }
            catch { }
        }

        private static string J(string s)
        {
            return System.Text.Json.JsonSerializer.Serialize(s ?? "");
        }
    }

    internal static class BuildInfo
    {
        public static string Version { get { return "1.2.1-harness"; } }
    }

    internal static class BatchQto
    {
        internal static bool IsBatch { get { return false; } }
    }

    internal sealed class AddinSettings
    {
        public string Token { get; set; }
        public string ApiHost { get; set; }
    }

    internal static class SettingsStore
    {
        public static AddinSettings Load()
        {
            return new AddinSettings { Token = "harness-token", ApiHost = "https://harness.invalid" };
        }
    }

    internal static class ApiClient
    {
        internal static string Url(string host, string path) { return host + path; }
    }

    internal enum DegradeState
    {
        Normal = 0, DegradedAi = 1, DegradedServer = 2, DegradedOffline = 3, Off = 4,
    }

    /// <summary>
    /// Сүлжээний stub.  `down` нь `null` буцаана — ЯГ `AiHttp`-ийн «бүх
    /// оролдлого унасан» гэрээ.
    ///
    /// ⚠️ ХАРИУН ДАХЬ ТООНУУД ҮНЭН БАЙХ ЁСТОЙ (ОЛОЛТ D, 2026-09-01).  Өмнө
    ///    нь stub нь БҮХ амжилттай оролдлогод `{"accepted":1}` буцаадаг
    ///    байсан — тэр нь `POST /api/learning/events`-ийн ЖИНХЭНЭ хэлбэр
    ///    БИШ (`routes/learning.ts:1022-1032` нь `{txns,touches,events}`
    ///    бүтэцтэй ТАВАН бүлэг буцаана).  Худал хэлбэртэй stub нь
    ///    «клиент хариуг уншиж байна уу» гэдгийг ХЭМЖИЖ ЧАДАХГҮЙ.  Одоо
    ///    stub нь ИЛГЭЭГДСЭН биеийг задлан үзэж ҮНЭН тоог буцаана.
    ///
    /// Горимууд (`ctl/net.txt`):
    ///   `up`               — 200, БҮГД хүлээн авав
    ///   `down`             — сүлжээ байхгүй (`null`)
    ///   `413` `401` `500`  — тэр статус
    ///   `off`             — эзний унтраалга
    ///   `down-after:K`     — эхний K оролдлого амжилттай, дараа нь `down`
    ///                        (курсорын гэрээг ХЭМЖИХ детерминист хэрэгсэл)
    ///   `reject-txn:K`     — 200, гэхдээ багц тутмын ЭХНИЙ K гүйлгээг
    ///                        `rejected.txns`-д хаяна (ОЛОЛТ D)
    ///   `reject-all`       — 422 `batch_rejected`: `accounted:true`,
    ///                        `retryable:false`.  Сервер алдагдлыг
    ///                        `server_dropped_count`-д БҮРТГЭСЭН тул клиент
    ///                        мөрүүдээ ХАЯХ ЭРХТЭЙ (0243-ийн гэрээ)
    ///   `no-session`       — 409 `loss_unaccounted`: `accounted:false`,
    ///                        `retryable:true`.  ХААНА Ч бүртгэгдээгүй тул
    ///                        клиент мөрүүдээ ЗААВАЛ ХАДГАЛНА
    /// </summary>
    internal static class AiHttp
    {
        internal static void SetState(DegradeState s) { }

        /// <summary>`down-after:K` -ийн процесс доторх оролдлогын тоолуур.</summary>
        private static int _attempts;

        public static Task<HttpResponseMessage> SendAsync(
            Func<HttpRequestMessage> makeRequest, CancellationToken ct)
        {
            string body = null;
            string mode = Harness.NetMode();
            try
            {
                HttpRequestMessage req = makeRequest();
                if (req != null && req.Content != null)
                    body = req.Content.ReadAsStringAsync().GetAwaiter().GetResult();
            }
            catch { }

            int nth = Interlocked.Increment(ref _attempts);
            int rejectTxns = 0;

            if (mode.StartsWith("down-after:", StringComparison.Ordinal))
            {
                int k;
                if (!int.TryParse(mode.Substring(11), out k)) k = 0;
                mode = nth <= k ? "up" : "down";
            }
            else if (mode.StartsWith("reject-txn:", StringComparison.Ordinal))
            {
                if (!int.TryParse(mode.Substring(11), out rejectTxns)) rejectTxns = 0;
                mode = "up";
            }

            if (mode == "down")
            {
                Harness.LogAttempt(mode, 0, false, body);
                return Task.FromResult<HttpResponseMessage>(null);
            }

            // ⚠️ 0243-ИЙН ХОЁР ГЭРЭЭТ АЛДАА.  Хоёулаа 4xx ч ХОЁУЛАА
            //    БҮТЭЦТЭЙ; ялгаа нь ЗӨВХӨН `accounted` талбарт байна.
            if (mode == "reject-all" || mode == "no-session")
            {
                bool acc = mode == "reject-all";
                string p2 = Ledger(body, int.MaxValue, acc);
                Harness.LogAttempt(mode, acc ? 422 : 409, false, body);
                var r2 = new HttpResponseMessage((HttpStatusCode)(acc ? 422 : 409));
                r2.Content = new StringContent(p2, Encoding.UTF8, "application/json");
                return Task.FromResult(r2);
            }

            int code = 200;
            string payload;
            bool delivered = true;
            if (mode == "413") { code = 413; payload = "{\"error\":\"too_large\"}"; delivered = false; }
            else if (mode == "401") { code = 401; payload = "{\"error\":\"unauth\"}"; delivered = false; }
            else if (mode == "500") { code = 500; payload = "{\"error\":\"boom\"}"; delivered = false; }
            else if (mode == "off") { payload = "{\"accepted\":null,\"ingest\":\"off\"}"; delivered = false; }
            else payload = Ledger(body, rejectTxns, true);

            Harness.LogAttempt(mode, code, delivered, body);
            var res = new HttpResponseMessage((HttpStatusCode)code);
            res.Content = new StringContent(payload, Encoding.UTF8, "application/json");
            return Task.FromResult(res);
        }

        /// <summary>
        /// Илгээгдсэн биеийг тоолж `routes/learning.ts`-ийн ЯГ тэр хэлбэрээр
        /// хариулна.  `rejectTxns > 0` бол эхний K гүйлгээ ба ТЭДНИЙ `touches`
        /// нь `rejected` руу орно (серверийн «эцэггүй touch» дүрэм).
        /// </summary>
        private static string Ledger(string body, int rejectTxns, bool accounted)
        {
            int txns = 0, touches = 0, events = 0;
            var owners = new System.Collections.Generic.List<string>();
            var rejectedOwners = new System.Collections.Generic.HashSet<string>(StringComparer.Ordinal);
            try
            {
                using (System.Text.Json.JsonDocument d = System.Text.Json.JsonDocument.Parse(body))
                {
                    System.Text.Json.JsonElement root = d.RootElement, a;
                    if (root.TryGetProperty("transactions", out a) &&
                        a.ValueKind == System.Text.Json.JsonValueKind.Array)
                    {
                        foreach (System.Text.Json.JsonElement t in a.EnumerateArray())
                        {
                            txns++;
                            System.Text.Json.JsonElement u;
                            string uid = t.TryGetProperty("txn_uid", out u) ? u.GetString() : null;
                            owners.Add(uid);
                        }
                    }
                    if (root.TryGetProperty("touches", out a) &&
                        a.ValueKind == System.Text.Json.JsonValueKind.Array)
                        touches = a.GetArrayLength();
                    if (root.TryGetProperty("events", out a) &&
                        a.ValueKind == System.Text.Json.JsonValueKind.Array)
                        events = a.GetArrayLength();

                    for (int i = 0; i < owners.Count && i < rejectTxns; i++)
                        if (owners[i] != null) rejectedOwners.Add(owners[i]);

                    int rejTouch = 0;
                    if (rejectedOwners.Count > 0 &&
                        root.TryGetProperty("touches", out a) &&
                        a.ValueKind == System.Text.Json.JsonValueKind.Array)
                    {
                        foreach (System.Text.Json.JsonElement t in a.EnumerateArray())
                        {
                            System.Text.Json.JsonElement u;
                            if (t.TryGetProperty("txn_uid", out u) &&
                                rejectedOwners.Contains(u.GetString() ?? "")) rejTouch++;
                        }
                    }

                    int rejTxn = Math.Min(rejectTxns, txns);
                    // `reject-all` (`int.MaxValue`) нь ҮЙЛ ЯВДЛЫГ БАС хаяна.
                    int rejEv = rejectTxns == int.MaxValue ? events : 0;
                    var sb = new StringBuilder(256);
                    sb.Append("{\"session_id\":1,\"session_created\":false");
                    Grp(sb, "accepted", txns - rejTxn, touches - rejTouch, events - rejEv);
                    Grp(sb, "duplicates", 0, 0, 0);
                    Grp(sb, "dropped", 0, 0, 0);
                    Grp(sb, "rejected", rejTxn, rejTouch, rejEv);
                    // ⚠️ 0243-ийн ГУРАВ: `ok` / `accounted` / `retryable`.
                    //    `accounted` нь «мөрүүдээ устгаж болно» гэсэн ЦОРЫН
                    //    ГАНЦ эрх (`routes/learning.ts:1076-1082`).
                    bool whole = rejTxn + rejEv >= txns + events && txns + events > 0;
                    sb.Append(",\"degraded\":false,\"failures\":[]");
                    sb.Append(",\"ok\":").Append(whole ? "false" : "true");
                    sb.Append(",\"accounted\":").Append(accounted ? "true" : "false");
                    sb.Append(",\"retryable\":").Append(accounted ? "false" : "true");
                    sb.Append("}");
                    return sb.ToString();
                }
            }
            catch
            {
                return "{\"session_id\":1,\"accepted\":{\"txns\":0,\"touches\":0,\"events\":0}}";
            }
        }

        private static void Grp(StringBuilder sb, string name, int t, int h, int e)
        {
            sb.Append(",\"").Append(name).Append("\":{\"txns\":").Append(t)
              .Append(",\"touches\":").Append(h)
              .Append(",\"events\":").Append(e).Append("}");
        }
    }

    internal sealed class Percentiles
    {
        public Percentiles() { }
        public Percentiles(int cap) { }
        public void Add(double v) { }
    }

    internal static class Metrics
    {
        public static readonly Percentiles Coalesce = new Percentiles(128);
        public static readonly Percentiles EmitQueue = new Percentiles(128);
        public static string Snapshot() { return null; }
    }

    /// <summary>Гүйлгээний цагирагийн stub.  `RawEntry`-ийн талбарууд,
    /// `SamplePerTxn = 24`, `TryDrain`-ийн гарын үсэг нь жинхэнэ
    /// `ChangeTracker.cs`-тай ТААРНА.</summary>
    internal static class ChangeTracker
    {
        internal const int SamplePerTxn = 24;

        private static readonly ManualResetEventSlim _wake = new ManualResetEventSlim(false);
        internal static ManualResetEventSlim Wake { get { return _wake; } }

        internal struct RawEntry
        {
            public long Seq;
            public long Sec;
            public int OpIdx;
            public int Added, Deleted, Modified;
            public int SampleOff, SampleLen;
            public bool Undo;
            public string DocKey;
            public string OpName;
        }

        internal sealed class DocFacts
        {
            public string DocUid, Title, CentralPathHash, Worksharing;
            public bool IsLink;
        }

        private sealed class Item { public string DocKey; public int Touches; public long Seq; }

        private static readonly ConcurrentQueue<Item> _q = new ConcurrentQueue<Item>();
        private static long _seq;
        private static long _injectDropped;

        internal static void Push(string docKey, int touches)
        {
            long s = Interlocked.Increment(ref _seq);
            _q.Enqueue(new Item { DocKey = docKey, Touches = touches, Seq = s });
            try { _wake.Set(); } catch { }
        }

        /// <summary>Цагираг дүүрч алдагдсаныг дуурайна (`droppedSinceLast`).</summary>
        internal static void InjectDropped(long n) { Interlocked.Add(ref _injectDropped, n); }

        internal static int TryDrain(RawEntry[] dst, long[] sampleDst,
                                     out long fromSeq, out long droppedSinceLast)
        {
            fromSeq = 0;
            droppedSinceLast = Interlocked.Exchange(ref _injectDropped, 0);
            if (dst == null || dst.Length == 0) return 0;

            int n = 0;
            long sec = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
            while (n < dst.Length)
            {
                Item it;
                if (!_q.TryDequeue(out it)) break;
                int len = it.Touches;
                if (len > SamplePerTxn) len = SamplePerTxn;
                int off = n * SamplePerTxn;
                if (off + SamplePerTxn > sampleDst.Length) { _q.Enqueue(it); break; }
                for (int i = 0; i < len; i++) sampleDst[off + i] = it.Seq * 1000 + i;
                dst[n] = new RawEntry
                {
                    Seq = it.Seq,
                    Sec = sec,
                    OpIdx = 0,
                    Added = len,
                    Deleted = 0,
                    Modified = 0,
                    SampleOff = off,
                    SampleLen = len,
                    Undo = false,
                    DocKey = it.DocKey,
                    OpName = "HarnessEdit",
                };
                n++;
            }
            if (_q.IsEmpty) { try { _wake.Reset(); } catch { } }
            if (n > 0) fromSeq = dst[0].Seq;
            return n;
        }

        internal static DocFacts FactsOf(string key)
        {
            if (string.IsNullOrEmpty(key)) return null;
            return new DocFacts
            {
                DocUid = key,
                Title = "Harness " + key,
                CentralPathHash = Sha256Hex("central|" + key),
                Worksharing = "none",
                IsLink = false,
            };
        }

        internal static string Sha256Hex(string s)
        {
            if (s == null) return null;
            using (SHA256 sha = SHA256.Create())
            {
                byte[] h = sha.ComputeHash(Encoding.UTF8.GetBytes(s));
                var sb = new StringBuilder(64);
                for (int i = 0; i < h.Length; i++) sb.Append(h[i].ToString("x2"));
                return sb.ToString();
            }
        }
    }
}
