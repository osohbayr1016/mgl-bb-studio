using System;

namespace RevitMcpAddin
{
    /// <summary>
    /// ТОГТМОЛ ХЭМЖЭЭТЭЙ ТОЙРОГ БУФЕР дээрх p50 / p95 / p99 / max ба
    /// алдааны хувь.
    ///
    /// ⚠️ ТАВУУЛАА ХЭРЭГТЭЙ.  p95 дангаараа «20-оос 1-д нь ямар байсан»
    /// гэдгийг л хэлнэ; p50 нь ердийн туршлага, p99/max нь хэрэглэгч
    /// «хөлдлөө» гэж гомдох мөч, алдааны хувь нь «хэмжилт огт дуусаагүй»
    /// тохиолдол.  Аль нэгийг нь орхивол дүгнэлт ХУДАЛ гарна.
    ///
    /// ⚠️ Add-in нь өдөрт хэдэн зуун дуудлага л хийдэг тул эрэмбэлээд
    /// индекс авах нь хангалттай — t-digest хэрэггүй.
    ///
    /// ⚠️ Autodesk.Revit-ийн ямар ч төрөл ХЭРЭГЛЭХГҮЙ — net48 (R24) build
    /// дээр ч эмхэтгэгдэнэ.
    /// </summary>
    internal sealed class Percentiles
    {
        private readonly double[] _buf;
        private readonly object _gate = new object();
        private int _count;      // буферт бичигдсэн (хязгаарлагдсан)
        private int _next;       // дараагийн бичих индекс (тойрог)
        private long _total;     // ХЯЗГААРГҮЙ нийт тоо
        private long _errors;    // амжилтгүй (timeout / exception) тоо

        public Percentiles(int capacity = 512)
        {
            _buf = new double[Math.Max(8, capacity)];
        }

        /// <summary>Нэг хэмжилт нэмнэ.  ok:false нь алдааны хувьд тооцогдоно.</summary>
        public void Add(double ms, bool ok = true)
        {
            lock (_gate)
            {
                _total++;
                if (!ok) _errors++;
                _buf[_next] = ms;
                _next = (_next + 1) % _buf.Length;
                if (_count < _buf.Length) _count++;
            }
        }

        /// <summary>Нийт дуудлага (буферийн хэмжээнээс ХАМААРАХГҮЙ).</summary>
        public long Total { get { lock (_gate) { return _total; } } }

        /// <summary>p50 / p95 / p99 / max / нийт / алдааны хувь.</summary>
        public Snapshot Read()
        {
            double[] copy;
            long total, errors;
            lock (_gate)
            {
                total = _total;
                errors = _errors;
                if (_count == 0)
                {
                    return new Snapshot
                    {
                        Total = total,
                        ErrorRate = total == 0 ? 0 : (double)errors / total,
                    };
                }
                copy = new double[_count];
                Array.Copy(_buf, copy, _count);
            }
            Array.Sort(copy);
            return new Snapshot
            {
                P50 = At(copy, 0.50),
                P95 = At(copy, 0.95),
                P99 = At(copy, 0.99),
                Max = copy[copy.Length - 1],
                Total = total,
                ErrorRate = total == 0 ? 0 : (double)errors / total,
            };
        }

        private static double At(double[] sorted, double q)
        {
            // ⚠️ «Хамгийн ойрын зэрэглэл» арга.  Жижиг түүвэрт (n < 20)
            // интерполяци нь БАЙХГҮЙ хэмжилт зохиох тул зориуд хэрэглэхгүй.
            int i = (int)Math.Ceiling(q * sorted.Length) - 1;
            if (i < 0) i = 0;
            if (i >= sorted.Length) i = sorted.Length - 1;
            return sorted[i];
        }

        internal struct Snapshot
        {
            public double? P50;
            public double? P95;
            public double? P99;
            public double? Max;
            public long Total;
            public double ErrorRate;

            public override string ToString()
            {
                return string.Format(
                    System.Globalization.CultureInfo.InvariantCulture,
                    "n={0} p50={1:F0} p95={2:F0} p99={3:F0} max={4:F0} err={5:P1}",
                    Total, P50 ?? 0, P95 ?? 0, P99 ?? 0, Max ?? 0, ErrorRate);
            }
        }
    }
}

namespace RevitMcpAddin
{
    /// <summary>
    /// БҮХ ЛАТЕНТЫН ХУРИМТЛУУЛАГЧ — процессын турш амьд, тогтмол санах ойтой.
    ///
    /// ⚠️ Энэ нь СЕРВЕРИЙН БҮРТГЭЛИЙГ ОРЛОХГҮЙ.  Сервер тал нь бүх ажилтны
    /// мөрийг нэгтгэж жинхэнэ p50/p95/p99-ыг гаргана; энэ нь ЛОКАЛ, нэг
    /// сессийн зураг — «яг одоо энэ машин дээр юу болж байна» гэдгийг
    /// Debug гаралтаас харах хэрэгсэл.
    ///
    /// ⚠️ Autodesk.Revit-ийн ямар ч төрөл ХЭРЭГЛЭХГҮЙ (net48 build).
    /// </summary>
    internal static class Metrics
    {
        /// <summary>Мессеж илгээхээс хариу гарах хүртэлх бүтэн зам.</summary>
        public static readonly Percentiles Total = new Percentiles();
        /// <summary>IntentRouter.Route — гурван давхаргын шийдвэр.</summary>
        public static readonly Percentiles Route = new Percentiles();
        /// <summary>IntentModel-ийн ХҮЙТЭН ачаалалт (918 KB parse).</summary>
        public static readonly Percentiles ModelLoad = new Percentiles(32);
        /// <summary>RevitToolBus.Call — бүтэн (дараалал + үйл явдал + гүйцэтгэл).</summary>
        public static readonly Percentiles ToolTotal = new Percentiles();
        /// <summary>Gate.Wait — ӨМНӨХ дуудлага дуусахыг хүлээсэн хугацаа.</summary>
        public static readonly Percentiles ToolQueue = new Percentiles();
        /// <summary>Raise-ээс Execute нь dequeue хийх хүртэл.</summary>
        public static readonly Percentiles ToolEvent = new Percentiles();
        /// <summary>RevitTools.Run — Revit-ийн ажил + JSON сериалчлал.</summary>
        public static readonly Percentiles ToolExec = new Percentiles();
        /// <summary>DocumentChanged handler (ТҮҮВЭРЛЭСЭН — 64 гүйлгээ тутамд нэг).</summary>
        public static readonly Percentiles DocChanged = new Percentiles(128);
        /// <summary>FlushDirty-ийн ТҮГЖЭЭ БАРИХ хэсэг (түүвэрлээгүй).</summary>
        public static readonly Percentiles FlushLock = new Percentiles(128);
        /// <summary>AI агентын эхний токен хүртэл (зөвхөн локал stream).</summary>
        public static readonly Percentiles AgentTtft = new Percentiles(128);
        /// <summary>AI агентын бүтэн эргэлт.</summary>
        public static readonly Percentiles AgentTotal = new Percentiles(128);

        /* ============================================================== */
        /*  TRACK 2 (2-4) — ТАВАН ШИНЭ ХУРИМТЛУУЛАГЧ                       */
        /*                                                                */
        /*  ⚠️ ТАВУУЛАА ЭНЭ РЕЛИЗЭД ОРШИХ ЁСТОЙ.  `2-3-compliance-engine`  */
        /*  нь `RuleEval` ба `InputCollect` рүү БИЧДЭГ боловч тэднийг      */
        /*  ҮҮСГЭХ эрхгүй (тэр сессийн «Хөндөх файлууд»-д `Percentiles.cs` */
        /*  БАЙХГҮЙ).  Дутуу үлдвэл 2-3 эмхэтгэгдэхгүй.                    */
        /* ============================================================== */

        /// <summary>Нэгтгэгчийн хаалт (BACKGROUND) — `ChangeSetCoalescer`.</summary>
        public static readonly Percentiles Coalesce = new Percentiles(128);
        /// <summary>Нэг олонлогийн дүрмийн гүйцэтгэлт (BACKGROUND).  ⚠️ 2-3 БИЧНЭ.</summary>
        public static readonly Percentiles RuleEval = new Percentiles(128);
        /// <summary>`collect_rule_inputs` (COLD).  ⚠️ 2-3 БИЧНЭ.</summary>
        public static readonly Percentiles InputCollect = new Percentiles(128);
        /// <summary>Багц POST (REMOTE) — `AiHttp.SendAsync`-ийн бүтэн эргэлт.</summary>
        public static readonly Percentiles EmitPost = new Percentiles(128);
        /// <summary>Илгээгчийн дарааллын хүлээлт (REMOTE) — мөр `Pending`-д
        /// орсноос POST-д багтах хүртэлх хугацаа.</summary>
        public static readonly Percentiles EmitQueue = new Percentiles(128);

        /// <summary>
        /// Хүн уншихад зориулсан нэг мөр.  ⚠️ p95 ДАНГААРАА БИШ — p50/p95/
        /// p99/max/алдаа тавуулаа хэвлэгдэнэ, эс бөгөөс дүгнэлт худал гарна.
        /// </summary>
        public static string Summary()
        {
            return
                "[MGL/timing] total " + Total.Read() +
                " | route " + Route.Read() +
                " | tool " + ToolTotal.Read() +
                " | tool.queue " + ToolQueue.Read() +
                " | tool.event " + ToolEvent.Read() +
                " | tool.exec " + ToolExec.Read() +
                " | model.load " + ModelLoad.Read() +
                " | doc.changed " + DocChanged.Read() +
                " | flush.lock " + FlushLock.Read() +
                " | agent.ttft " + AgentTtft.Read() +
                " | agent.total " + AgentTotal.Read() +
                " | coalesce " + Coalesce.Read() +
                " | rule.eval " + RuleEval.Read() +
                " | input.collect " + InputCollect.Read() +
                " | emit.post " + EmitPost.Read() +
                " | emit.queue " + EmitQueue.Read();
        }

        /// <summary>
        /// Сесс рүү илгээх ХУРААНГУЙ (0226-ийн `perf_json`).
        ///
        /// ⚠️ БҮХ талбар NULL бол ЯГ NULL буцаана, `{}` БИШ — 0216:29-40-ийн
        /// «ХЭМЖЭЭГҮЙ» ба «тэр үе шат болоогүй» ялгаа.  Хоосон объект нь
        /// «хэмжсэн, тэг гарсан» гэсэн ХУДАЛ мэдэгдэл болно.
        ///
        /// ⚠️ Загварын геометр, элементийн нэр, файлын агуулга ОРОХГҮЙ —
        /// ЗӨВХӨН миллисекунд ба тоолуур.
        ///
        /// ⚠️ `doc_changed_sampled: true` ЗААВАЛ орно — `DocChanged` нь 1/64
        /// түүвэр (`ChangeTracker.DcSampleEvery`) тул ХОВОР ОРГИЛ энд
        /// ХАРАГДАХГҮЙ.  Түүнийг тэмдэглэхгүй бол сервер тал энэ p95-ыг
        /// бүрэн хуваарилалт гэж уншина.
        ///
        /// ⚠️ ХЭЗЭЭ Ч алдаа шидэхгүй.
        /// </summary>
        public static string Snapshot()
        {
            try
            {
                var sb = new System.Text.StringBuilder(256);
                int n = 0;
                Action<string, Percentiles> put = (name, p) =>
                {
                    Percentiles.Snapshot s = p.Read();
                    if (s.Total == 0 || !s.P95.HasValue) return;
                    if (n++ > 0) sb.Append(',');
                    sb.Append('"').Append(name).Append("\":").Append(
                        Timing.Round(s.P95).Value.ToString(
                            System.Globalization.CultureInfo.InvariantCulture));
                };

                put("p95_doc_changed_ms", DocChanged);
                put("p95_flush_lock_ms", FlushLock);
                put("p95_coalesce_ms", Coalesce);
                put("p95_rule_eval_ms", RuleEval);
                put("p95_input_collect_ms", InputCollect);
                put("p95_emit_post_ms", EmitPost);
                put("p95_emit_queue_ms", EmitQueue);
                put("p95_tool_total_ms", ToolTotal);

                if (n == 0) return null;

                sb.Append(",\"doc_changed_sampled\":true");
                sb.Append(",\"doc_changed_n\":").Append(
                    DocChanged.Total.ToString(
                        System.Globalization.CultureInfo.InvariantCulture));
                return "{" + sb + "}";
            }
            catch { return null; }
        }

        /* ============================================================== */
        /*  ДУРСГАЛТ ГАРАЛТ — ХЭМЖИЛТИЙН ЦОРЫН ГАНЦ ХААЛГА                */
        /* ============================================================== */

        /// <summary>
        /// ⚠️⚠️ `Debug.WriteLine`-ЫГ ЭНД БҮҮ БУЦААЖ ТАВЬ.
        ///
        /// `Debug.WriteLine` нь `[Conditional("DEBUG")]` — `DEBUG` тогтмол
        /// тодорхойлогдоогүй build дээр ДУУДЛАГА нь бүхэлдээ, АРГУМЕНТ нь
        /// хамт эмхэтгэлээс хасагдана (`Metrics.Summary()` хүртэл огт
        /// ДУУДАГДАХГҮЙ).
        ///
        /// Энэ төслийн Configuration нэрс нь «Release R27» / «Debug R27»
        /// тул .NET SDK нь `DEBUG` БИШ, тухайн нэрнээс гаргасан тогтмол
        /// тодорхойлдог.  ХЭМЖИГДСЭН (2026-08-28, энэ хавтсанд):
        ///
        ///   dotnet msbuild RevitMcpAddin.csproj -p:Configuration="Release R27" \
        ///          -p:Platform=x64 -getProperty:DefineConstants
        ///     → TRACE;MCP_EXECUTOR;RELEASE_R27
        ///   ... -p:Configuration="Debug R27" ...
        ///     → TRACE;MCP_EXECUTOR;DEBUG_R27
        ///   ... -p:Configuration="Release R24" ...
        ///     → TRACE;RELEASE_R24
        ///
        /// Өөрөөр хэлбэл `DEBUG` нь ЭНЭ ТӨСӨЛД АЛЬ Ч Configuration дээр
        /// тодорхойлогддоггүй — `Debug.WriteLine` нь ажилтны машин дээр ч,
        /// хөгжүүлэгчийн машин дээр ч ХЭЗЭЭ Ч гүйцэтгэгддэггүй.  1C-ийн
        /// БҮХ утга нь «латент хэмжих» тул тэр нөхцөлд «250 мс» гэсэн тоог
        /// батлах ямар ч ул мөр үлддэггүй байв.
        ///
        /// ХОЁР ХАЯГ РУУ бичнэ:
        ///   1. `Trace.Write` — `TRACE` нь БҮХ Configuration дээр
        ///      тодорхойлогддог (дээрх гаралт) тул Release дээр ҮЛДЭНЭ;
        ///      DebugView / Visual Studio-гоор шууд харагдана.
        ///   2. `%APPDATA%\RevitMcpAddin\timing.log` — ажилтны машинд
        ///      дибаггер залгагдаагүй тул ФАЙЛ нь цорын ганц дурсгалт хаяг.
        ///      ⚠️ Сервер тал ӨНӨӨДӨР `t_*` баганагүй хэвээр (1B-3 нь
        ///      `model_version` / `addin_version`-ыг л нэмсэн —
        ///      `grep t_total_ms backend/src/routes/revit.ts` → таарц алга),
        ///      тиймээс энэ файл бол хэмжилт хүрдэг ЦОРЫН ГАНЦ газар.
        ///      Багана гармагц энэ файл нь НӨӨЦ болж үлдэнэ, хаягдахгүй.
        ///
        /// ⚠️ ХЭЗЭЭ Ч алдаа шидэхгүй — хэмжилт нь чатыг унагаах ЁСГҮЙ.
        /// ⚠️ `ChangeTracker.OnDocumentChanged`-ЭЭС ЭНЭ АРГЫГ БҮҮ ДУУД:
        ///    тэнд диск хөндөх нь Revit-ийн ҮНДСЭН thread дээр I/O
        ///    хүлээлгэнэ (§4-ийн «диск хөндөхгүй» дүрэм).  Тэр цэгийн
        ///    утга нь `DocChanged` хуримтлуулагчид ордог ба энд зөвхөн
        ///    ХУРИМТЛУУЛСАН дүн болж хэвлэгддэг.
        ///
        /// ⚠️⚠️ 2026-08-28 — ЭНЭ АРГА НЬ ОДОО ДИСК ХӨНДӨХГҮЙ.  Дуудагчийн
        ///    thread дээр зөвхөн мөр форматлаж, хязгаартай дараалалд хийнэ;
        ///    файл ба `Trace` руу бичихийг АРЫН thread хийнэ (доорх
        ///    `PumpLoop`).  ЯАГААД ЗААВАЛ ИЙМ БАЙХ ЁСТОЙ вэ — `PumpLoop`-ийн
        ///    тайлбарт: хэмжигч нь хэмжиж буй тоогоо ӨӨРӨӨ өсгөж байв.
        /// </summary>
        public static void Emit(string line)
        {
            if (string.IsNullOrEmpty(line)) return;

            // ⚠️ ЦАГИЙН ТЭМДЭГ НЬ ҮЙЛ ЯВДЛЫН МӨЧИД тавигдана, flush-ийн
            // мөчид БИШ.  Буфферлэсэн мөр арын thread дээр хожим дискэнд
            // ордог тул бичих үедээ тэмдэглэвэл бүх мөр flush-ийн цагтай
            // болж, мөр хоорондын ЗАЙ — яг таны хэмжиж буй зүйл — устана.
            string stamped = Stamp(line);

            if (System.Threading.Volatile.Read(ref _closed) == 0)
            {
                EnsurePump();
                try
                {
                    if (Pending.TryAdd(stamped)) return;

                    // Дараалал дүүрсэн — ХАЯНА, ХЭЗЭЭ Ч БЛОКЛОХГҮЙ.  Хэдэн
                    // мөр хаясан нь ӨӨРӨӨ хэмжилт тул арын thread дараагийн
                    // багцтайгаа хамт бичнэ — ЧИМЭЭГҮЙ алдагдал БАЙХГҮЙ.
                    System.Threading.Interlocked.Increment(ref _dropped);
                    return;
                }
                catch
                {
                    // `CompleteAdding`-ийн дараа `TryAdd` алдаа шиднэ —
                    // мөрийг алдахгүйн тулд доорх шууд зам руу унана.
                }
            }

            // Унтраалт (эсвэл thread үүсгэж чадаагүй) — энэ мөр нь сессийн
            // ЭЦСИЙН зураг байж болзошгүй тул СИНХРОНООР бичнэ.  Энэ зам
            // халуун зам БИШ: `App.OnShutdown` дээр нэг удаа.
            WriteThrough(stamped);
        }

        /// <summary>
        /// УНТРААЛТ — дараалалд үлдсэнийг дискэнд гаргаж, арын бичигчийг
        /// зогсооно.  `App.OnShutdown`-д `EmitSummary(force: true)`-ийн
        /// ДАРАА дуудна: тэр дүн нь дараалалд ОРСОН байх бөгөөд энэ
        /// дуудлагагүйгээр процесс хаагдахад алдагдана (бичигч нь
        /// `IsBackground = true`).
        ///
        /// ⚠️ ХЯЗГААРТАЙ ХҮЛЭЭЛТ.  Хэмжилт нь Revit-ийн унтраалтыг ХЭЗЭЭ Ч
        /// барих ЁСГҮЙ — `Join` нь `ShutdownJoinMs`-ээр таслагдана.
        /// ⚠️ Давхар дуудахад аюулгүй.
        /// </summary>
        public static void Shutdown()
        {
            try
            {
                System.Threading.Volatile.Write(ref _closed, 1);
                Pending.CompleteAdding();
            }
            catch { }
            try
            {
                System.Threading.Thread t = _pump;
                if (t != null) t.Join(ShutdownJoinMs);
            }
            catch { }
        }

        /// <summary>
        /// Хуримтлуулсан дүнг бичнэ.  ⚠️ ЧАДВАРЛАГДСАН: мессеж бүрт ~700
        /// тэмдэгт бичих нь дискний ачааг утгагүй өсгөнө, харин дүн нь
        /// секунд тутамд мэдэгдэхүйц өөрчлөгддөггүй.  `force: true` нь
        /// зөвхөн УНТРААЛТАД — тэр нэг мөр нь бүхэл сессийн эцсийн зураг.
        /// </summary>
        public static void EmitSummary(bool force = false)
        {
            try
            {
                // ⚠️ ЭНЭ ТҮГЖЭЭ НЬ ФАЙЛЫН ТҮГЖЭЭ БИШ.  Урьд нь хоёулаа нэг
                // `LogGate` байсан тул хэмнэлтийн тоолуурыг уншихын тулд
                // дискний бичилт дуусахыг хүлээх шалтгаантай байв.
                lock (SummaryGate)
                {
                    double now = SummaryClock.Elapsed.TotalMilliseconds;
                    if (!force && now - _lastSummaryMs < SummaryEveryMs) return;
                    _lastSummaryMs = now;
                }
                Emit(Summary());
            }
            catch { }
        }

        /* ============================================================== */
        /*  АРЫН БИЧИГЧ                                                    */
        /* ============================================================== */

        /// <summary>
        /// ⚠️⚠️ ЯАГААД АРЫН THREAD ЗААВАЛ ХЭРЭГТЭЙ ВЭ (2026-08-28).
        ///
        /// `Emit` нь урьд нь ДУУДАГЧИЙН thread дээр файл нээж, бичиж,
        /// хаадаг байв.  Гурван дуудагчийн НЭГ Ч НЬ түүнийг тэвчихгүй:
        ///
        ///   • `RevitToolBus.Finish` — `Gate` СЕМАФОРЫГ БАРЬЖ байхдаа
        ///     дууддаг байсан.  Дискний хүлээлт нь ДАРААГИЙН хэрэгслийн
        ///     дуудлагын `MsQueueWait`-д ШУУД нэмэгддэг: хэмжигч нь
        ///     хэмжиж буй тоогоо ӨӨРӨӨ өсгөж байв.
        ///   • `AssistantPane.EndTiming` — Revit-ийн ҮНДСЭН (UI) thread
        ///     дээр, мессеж БҮРТ.  Roaming `%APPDATA%` (сүлжээний профайл)
        ///     дээр энэ нь харагдахуйц UI гацаа бөгөөд `t_total_ms`-д
        ///     өөрөө нэмэгддэг.
        ///   • `IntentModel.EnsureLoaded` — `Gate` ТҮГЖЭЭНИЙ ДОТОР, 918 KB
        ///     parse-ийн критик хэсэгт.
        ///
        /// Тиймээс дүрэм: хэмжилтийн бичилт нь (а) критик хэсгээс ГАДУУР,
        /// (б) UI thread дээр БИШ.  Буфер + арын flush нь энэ хоёрыг нэг
        /// дор шийднэ, дуудлагын цэгүүдийг өөрчлөхгүйгээр.
        ///
        /// ⚠️ `IsBackground = true` — энэ thread нь Revit-ийн хаагдалтыг
        /// ХЭЗЭЭ Ч барихгүй.  Хариуд нь `Shutdown()` нь эцсийн мөрүүдийг
        /// гаргах үүрэгтэй.
        /// </summary>
        private static void PumpLoop()
        {
            var sb = new System.Text.StringBuilder(8 * 1024);
            try
            {
                foreach (string first in Pending.GetConsumingEnumerable())
                {
                    sb.Length = 0;
                    sb.Append(first);

                    // БАГЦЛАНА: бэлэн байгаа бүхнийг НЭГ файлын нээлтээр.
                    // Мөр бүрт нэг open/append/close хийх нь roaming
                    // профайл дээр хамгийн үнэтэй хэсэг нь.
                    string more;
                    while (sb.Length < MaxBatchChars && Pending.TryTake(out more))
                        sb.Append(more);

                    long lost = System.Threading.Interlocked.Exchange(ref _dropped, 0);
                    if (lost > 0)
                    {
                        // ⚠️ ХАЯСАН МӨРИЙГ ЗААВАЛ ЗАРЛАНА.  Дуугүй алдагдсан
                        // хэмжилт нь байхгүй хэмжилтээс ДОР — тоо нь бүрэн
                        // мэт харагдана.
                        sb.Append(Stamp(
                            "[MGL/timing] dropped=" +
                            lost.ToString(System.Globalization.CultureInfo.InvariantCulture) +
                            " (буфер дүүрсэн)"));
                    }

                    WriteThrough(sb.ToString());
                }
            }
            catch
            {
                // ⚠️ Бичигч унасан ч add-in АЖИЛЛАСААР байна — ГЭХДЭЭ `_closed`-ыг
                //    ЗААВАЛ тавина.  Үгүй бол `_pumpStarted` нь 1 хэвээр, `_closed`
                //    нь 0 хэвээр үлдэж, `Emit` нь ХЭРЭГЛЭГЧГҮЙ дараалал руу 4096
                //    хүртэл `TryAdd` хийгээд дараа нь `_dropped`-ыг МӨНХӨД өсгөнө —
                //    тэр тоолуурыг зарлах PumpLoop нь аль хэдийн үхсэн байна.
                //    Ө.х. хэмжилт ЧИМЭЭГҮЙ, БҮРМӨСӨН алдагдана.  `_closed = 1` нь
                //    `Emit`-ийг `WriteThrough` (синхрон) салаа руу буулгана:
                //    удаан ч гэсэн ХАРАГДАНА.
                System.Threading.Volatile.Write(ref _closed, 1);
            }
        }

        /// <summary>
        /// Бичигчийг УРЬДЧИЛАН эхлүүлнэ.  `App.OnStartup`-аас дуудна.
        ///
        /// ⚠️ ЯАГААД: эхний `Emit` нь thread үүсгэж, `PumpLoop`/`WriteThrough`
        /// -ийг JIT хийдэг — ХЭМЖСЭН нь 4.0 мс (2026-08-28, Release/net10,
        /// энэ машин).  Дараагийн дуудлагууд p50=0.0003 / p99=0.006 мс.
        /// Тэр 4 мс нь мессежийн замд унавал ЯГ ТЭР зүйл болно: хэмжигч нь
        /// хэмжиж буй тоогоо өсгөх.  Revit-ийн эхлэл дээр төлбөл харагдахгүй.
        ///
        /// ⚠️ ЗӨВХӨН thread үүсгэх нь ХАНГАЛТГҮЙ.  ХЭМЖСЭН (2026-08-28):
        /// `EnsurePump()` дангаараа 1.94 мс, дараагийн ЭХНИЙ `Emit` НЬ БАС
        /// 2.23 мс (`DateTime.Now`-ийн цагийн бүсийн ачаалалт + `Stamp` /
        /// `TryAdd`-ийн JIT).  Тиймээс энд БОДИТ мөр бичиж бүтэн замыг
        /// халаана — тэр мөр нь өөрөө хэрэгтэй: локал `timing.log`-ийг
        /// сесс болон add-in хувилбараар нь тамгална.
        ///
        /// ⚠️ Идемпотент — `EnsurePump` нь `Interlocked`-оор хамгаалагдсан;
        /// давхар дуудвал нэмэлт сесс мөр л бичигдэнэ (хор хоргүй).
        /// </summary>
        public static void Start()
        {
            EnsurePump();
            Emit("[MGL/timing] session start addin=" + BuildInfo.Version);
        }

        /// <summary>Эхний `Emit`-д НЭГ УДАА бичигчийг эхлүүлнэ.</summary>
        private static void EnsurePump()
        {
            // ⚠️ Статик КОНСТРУКТОРООС thread эхлүүлэхгүй (төрөл эхлүүлэх
            // түгжээний сонгодог гацаа).  `Emit`-ийн бие ажиллаж эхэлсэн
            // үед cctor аль хэдийн дууссан тул эндээс эхлүүлэх нь аюулгүй.
            if (System.Threading.Interlocked.CompareExchange(ref _pumpStarted, 1, 0) != 0) return;
            try
            {
                var t = new System.Threading.Thread(PumpLoop);
                t.IsBackground = true;
                t.Name = "MGL.Metrics";
                _pump = t;
                t.Start();
            }
            catch
            {
                // Thread үүсгэж чадсангүй — бүх мөр синхрон замаар явна.
                // Хэмжилт УДААШРАХ нь хэмжилт БАЙХГҮЙ болохоос дээр.
                System.Threading.Volatile.Write(ref _closed, 1);
            }
        }

        private static string Stamp(string line)
        {
            return
                DateTime.Now.ToString(
                    "yyyy-MM-dd HH:mm:ss.fff",
                    System.Globalization.CultureInfo.InvariantCulture) +
                " " + line + Environment.NewLine;
        }

        /// <summary>
        /// ЦОРЫН ГАНЦ файл хөндөгч.  Ердийн үед зөвхөн `PumpLoop`-ээс,
        /// унтраалтад `Emit`-ээс шууд дуудагдана — тиймээс түгжээ хэвээр.
        /// </summary>
        private static void WriteThrough(string text)
        {
            if (string.IsNullOrEmpty(text)) return;

            // `Trace` нь БҮХ Configuration дээр амьд (`TRACE` тодорхойлогдсон).
            // ⚠️ `Write`, `WriteLine` БИШ: `text` нь мөр бүрийн төгсгөлд
            // шинэ мөрөө аль хэдийн авсан.
            try { System.Diagnostics.Trace.Write(text); } catch { }

            try
            {
                lock (FileGate)
                {
                    string path = LogPath;
                    string dir = System.IO.Path.GetDirectoryName(path);
                    if (!string.IsNullOrEmpty(dir)) System.IO.Directory.CreateDirectory(dir);

                    // ⚠️ ТОГТМОЛ ДЭЭД ХЭМЖЭЭ.  Хязгааргүй өсгөвөл roaming
                    // profile дээр (сүлжээний %APPDATA%) энэ нь мессеж бүрт
                    // сүлжээ хүлээх шалтгаан болно (§2.13-ын нөхцөл).
                    // Нэг үеийн нөөц л барина — хуучныг `.1` болгож дарна.
                    var fi = new System.IO.FileInfo(path);
                    if (fi.Exists && fi.Length > MaxLogBytes)
                    {
                        string old = path + ".1";
                        try { if (System.IO.File.Exists(old)) System.IO.File.Delete(old); }
                        catch { }
                        try { System.IO.File.Move(path, old); }
                        catch { }
                    }

                    System.IO.File.AppendAllText(
                        path, text, new System.Text.UTF8Encoding(false));
                }
            }
            catch
            {
                // Диск дүүрсэн / эрхгүй / файл түгжигдсэн — чимээгүй өнгөрнө.
            }
        }

        /// <summary>
        /// Хүлээгдэж буй мөрүүд.  ХЯЗГААРТАЙ: дүүрвэл `TryAdd` нь `false`
        /// буцаана (блоклохгүй) — тэр мөр хаягдаж, ТООЛОГДОНО.  Хязгааргүй
        /// байвал диск удаашрах үед санах ой хязгааргүй өснө.
        /// </summary>
        private static readonly System.Collections.Concurrent.BlockingCollection<string> Pending =
            new System.Collections.Concurrent.BlockingCollection<string>(
                new System.Collections.Concurrent.ConcurrentQueue<string>(), MaxPendingLines);

        private const int MaxPendingLines = 4096;
        private const int MaxBatchChars = 64 * 1024;
        private const int ShutdownJoinMs = 750;

        private static System.Threading.Thread _pump;
        private static int _pumpStarted;
        private static int _closed;
        private static long _dropped;

        private static readonly object FileGate = new object();
        private static readonly object SummaryGate = new object();
        private const long MaxLogBytes = 512 * 1024;
        private const double SummaryEveryMs = 60000;
        private static readonly System.Diagnostics.Stopwatch SummaryClock =
            System.Diagnostics.Stopwatch.StartNew();
        private static double _lastSummaryMs = double.NegativeInfinity;

        private static string LogPath
        {
            get
            {
                return System.IO.Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
                    "RevitMcpAddin", "timing.log");
            }
        }
    }
}
