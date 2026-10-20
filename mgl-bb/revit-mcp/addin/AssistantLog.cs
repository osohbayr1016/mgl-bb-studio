using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading.Tasks;

namespace RevitMcpAddin
{
    /// <summary>Нэг мөр хэрэглээ — сургалтын түүхий материал.</summary>
    public sealed class AssistantLogEntry
    {
        [JsonPropertyName("id")] public string Id { get; set; }
        [JsonPropertyName("ts")] public string Ts { get; set; }
        [JsonPropertyName("text")] public string Text { get; set; }
        [JsonPropertyName("predicted")] public string Predicted { get; set; }
        [JsonPropertyName("confidence")] public double Confidence { get; set; }
        [JsonPropertyName("decided_by")] public string DecidedBy { get; set; }
        [JsonPropertyName("acted")] public bool Acted { get; set; }
        /// <summary>Хэрэглэгч ЗАСВАЛ жинхэнэ санаа.  null = засаагүй.</summary>
        [JsonPropertyName("corrected")] public string Corrected { get; set; }
        /// <summary>1 = 👍, -1 = 👎, null = юу ч дараагүй.</summary>
        [JsonPropertyName("feedback")] public int? Feedback { get; set; }

        /// <summary>
        /// 👎 дарсны ДАРАА хэрэглэгчийн БИЧСЭН шалтгаан.  null = бичээгүй.
        ///
        /// ⚠️ `Corrected`-ЭЭС ЯЛГААТАЙ.  `Corrected` нь хаалттай багцаас сонгосон
        /// ЗӨВ САНААНЫ НЭР (машинд шууд сургах шошго); энэ нь чөлөөт бичвэр —
        /// «хариулт нь хэт урт», «энэ хуудсыг ойлгосонгүй» гэх мэт САНААНЫ
        /// НЭРЭЭР илэрхийлэгдэхгүй зүйлийг барина.  Хоёулаа хэрэгтэй.
        /// </summary>
        [JsonPropertyName("feedback_note")] public string FeedbackNote { get; set; }
        [JsonPropertyName("doc_uid")] public string DocUid { get; set; }
        [JsonPropertyName("revit_version")] public string RevitVersion { get; set; }
        [JsonPropertyName("project_id")] public int? ProjectId { get; set; }
        [JsonPropertyName("model_version")] public string ModelVersion { get; set; }

        /// <summary>
        /// Add-in-ы build хувилбар (ж. "1.1.0").
        ///
        /// ⚠️ ЯАГААД: ажилтны компьютерт АВТОМАТ ШИНЭЧЛЭЛ БАЙХГҮЙ, `dist/` нь
        /// git-д ороогүй.  Энэ талбаргүйгээр «аль инженер аль build-тай явж
        /// байна» гэдгийг МЭДЭХ арга байхгүй — өөрөөр хэлбэл алдааны тайланг
        /// ямар кодтой тулгахаа мэдэхгүй.
        /// </summary>
        [JsonPropertyName("addin_version")] public string AddinVersion { get; set; }

        /* ============================================================== */
        /*  ХЭМЖИЛТ (1C) — БҮГД NULLABLE                                   */
        /*                                                                */
        /*  ⚠️ 1B-3-ЫН ХАМААРАЛ.  `assistant_logs`-д тохирох БАГАНА гарах  */
        /*  хүртэл сервер эдгээрийг `model_version`-тэй ЯГ АДИЛ ЧИМЭЭГҮЙ   */
        /*  ХАЯНА (`routes/revit.ts`-ийн `.map(...)` тэднийг уншдаггүй).   */
        /*  Тэр нь хор хоргүй — add-in тал бэлэн, сервер тал гүйцнэ.       */
        /*                                                                */
        /*  ⚠️ НУУЦЛАЛ: зөвхөн ХУГАЦАА.  Загварын геометр, элементийн нэр, */
        /*  файлын агуулга ОГТ ОРОХГҮЙ — `AssistantLog`-ийн хилтэй ижил.   */
        /* ============================================================== */

        /// <summary>Мессеж илгээхээс хариу гарах хүртэлх БҮТЭН зам (мс).</summary>
        [JsonPropertyName("t_total_ms")] public double? TotalMs { get; set; }

        /// <summary>`IntentRouter.Route` — гурван давхаргын шийдвэрийн үнэ (мс).</summary>
        [JsonPropertyName("t_route_ms")] public double? RouteMs { get; set; }

        /// <summary>`keyword` / `model` / `fallback` — АЛЬ давхарга шийдсэн.</summary>
        [JsonPropertyName("route_layer")] public string RouteLayer { get; set; }

        /// <summary>`empty` / `busy` / `pending` / `fallback` / `acted`.</summary>
        [JsonPropertyName("exit_path")] public string ExitPath { get; set; }

        /// <summary>Загварын ХҮЙТЭН ачаалалт (918 KB parse, мс).  Сесст нэг удаа.</summary>
        [JsonPropertyName("t_model_load_ms")] public double? ModelLoadMs { get; set; }

        /// <summary>`local` / `embedded` / `none`.</summary>
        [JsonPropertyName("model_load_source")] public string ModelLoadSource { get; set; }

        /// <summary>Хэрэгслийн БҮТЭН дуудлага (мс) — сүүлийнх.</summary>
        [JsonPropertyName("t_tool_total_ms")] public double? ToolTotalMs { get; set; }

        /// <summary>Үүнээс: `Gate`-д хүлээсэн (мс) — «өмнөх дуудлага барьсан».</summary>
        [JsonPropertyName("t_tool_queue_ms")] public double? ToolQueueMs { get; set; }

        /// <summary>Үүнээс: `Raise`-ээс dequeue хүртэл (мс) — «Revit завгүй».</summary>
        [JsonPropertyName("t_tool_event_ms")] public double? ToolEventMs { get; set; }

        /// <summary>Үүнээс: `RevitTools.Run` (мс).  ⚠️ JSON сериалчлал ҮҮН ДОТОР.</summary>
        [JsonPropertyName("t_tool_exec_ms")] public double? ToolExecMs { get; set; }

        /// <summary>
        /// AI агентын ЭХНИЙ токен хүртэл (мс).
        /// ⚠️ ЗӨВХӨН локал stream (`AgentChat.RunLocalAsync`) дээр утгатай.
        /// Алсын `PostTurnAsync` нь streaming БИШ тул тэнд TTFT ≡ total бөгөөд
        /// энэ талбар NULL үлдэнэ — «яагаад хоосон вэ» гэсэн асуулт хожим
        /// төрөхөөс сэргийлж энд бичив.
        /// </summary>
        [JsonPropertyName("t_agent_ttft_ms")] public double? AgentTtftMs { get; set; }

        /// <summary>AI агентын БҮТЭН эргэлт (мс).</summary>
        [JsonPropertyName("t_agent_total_ms")] public double? AgentTotalMs { get; set; }

        /// <summary>Серверт хүрсэн эсэх — локалд л хэрэглэгдэнэ, илгээхгүй.</summary>
        [JsonIgnore] public bool Sent { get; set; }
    }

    /// <summary>
    /// ХЭРЭГЛЭЭНИЙ БҮРТГЭЛ — ангилагчийг сайжруулах ЦОРЫН ГАНЦ өгөгдлийн эх.
    ///
    /// ⚠️ ЯАГААД ЛОКАЛД ЭХЛЭЭД БИЧДЭГ ВЭ: инженер интернэтгүй, VPN-гүй, эсвэл
    /// сервер унтарсан үед ч ажиллана.  Бүртгэл ХЭЗЭЭ Ч алдагдах ёсгүй —
    /// нэг өдрийн бодит хэрэглээ нь гараар бичсэн 50 жишээнээс үнэ цэнтэй.
    /// Илгээлт нь дараа, багцаар, чимээгүй болно.
    ///
    /// ⚠️ НУУЦЛАЛ: ЗӨВХӨН хэрэглэгчийн БИЧСЭН ТЕКСТ ба таамаглал.  Загварын
    /// геометр, элементийн нэр, файлын агуулга ОГТ ОРОХГҮЙ.  `doc_uid` нь
    /// зөвхөн таних тэмдэг — файлын нэр ч биш.
    ///
    /// ⚠️ ЭНЭ БҮХЭН UI-Г ГАЦААХГҮЙ.  Бүх бичилт синхрон боловч жижиг
    /// (хэдэн арван мөр); илгээлт нь `Task.Run` дотор.  Алдаа ГАРВАЛ
    /// чимээгүй залгина — бүртгэл нь чат ажиллахад саад болох ёсгүй.
    /// </summary>
    public static class AssistantLog
    {
        /// <summary>Локалд хадгалах дээд мөр — хуучныг нь хаяна.</summary>
        private const int MaxEntries = 3000;

        /// <summary>Нэг илгээлтэд явуулах дээд мөр.</summary>
        private const int BatchSize = 100;

        private static readonly object Gate = new object();
        private static List<AssistantLogEntry> _entries;
        private static bool _loaded;

        private static string Dir =>
            Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
                "RevitMcpAddin");

        private static string LogPath => Path.Combine(Dir, "assistant-log.jsonl");

        /// <summary>Панелиас тавина — бүртгэл бүрд контекст нэмнэ.</summary>
        public static string DocUid { get; set; }
        public static string RevitVersion { get; set; }
        public static int? ProjectId { get; set; }

        /* ============================================================== */

        private static void EnsureLoaded()
        {
            if (_loaded) return;
            _loaded = true;
            _entries = new List<AssistantLogEntry>();
            try
            {
                if (!File.Exists(LogPath)) return;
                // ⚠️ `utf-8` — бид BOM-гүй бичдэг, гэхдээ гараар засагдсан
                // байвал ч уншина.
                foreach (string line in File.ReadAllLines(LogPath, Encoding.UTF8))
                {
                    string t = line.Trim();
                    if (t.Length == 0) continue;
                    try
                    {
                        var e = JsonSerializer.Deserialize<AssistantLogEntry>(t);
                        if (e?.Id != null) _entries.Add(e);
                    }
                    catch
                    {
                        // Эвдэрсэн мөр — алгасна, бүхэл файлыг хаяхгүй.
                    }
                }
            }
            catch
            {
                _entries = new List<AssistantLogEntry>();
            }
        }

        /// <summary>
        /// НЭГ мөр залгана.  ⚠️ Энэ бол ЕРДИЙН зам — мессеж бүрд дуудагдана.
        ///
        /// Урьд нь энд `Save()` дуудагдаж, 3000 мөрийн БҮТЭН файлыг дахин
        /// цувуулж бичдэг байв — тэр нь UI thread дээр, чат мессеж бүрд.
        /// Бүртгэл өсөх тусам чат удаашрах бөгөөд шалтгаан нь ил биш.
        /// JSONL нь ЗАЛГАМАЛ формат тул нэг мөр нэмэхэд л хангалттай.
        /// </summary>
        private static void AppendOne(AssistantLogEntry e)
        {
            try
            {
                Directory.CreateDirectory(Dir);
                File.AppendAllText(LogPath,
                    JsonSerializer.Serialize(e) + Environment.NewLine,
                    new UTF8Encoding(false));
            }
            catch
            {
                // Диск дүүрсэн / эрхгүй — чат ажиллахад саад болохгүй.
            }
        }

        /// <summary>
        /// БҮТЭН дахин бичилт.  ⚠️ Зөвхөн ХОВОР тохиолдолд: 👍/👎 (байгаа мөр
        /// өөрчлөгдөнө) ба хязгаараас хэтэрч тайрах үед.
        /// </summary>
        private static void Save()
        {
            try
            {
                Directory.CreateDirectory(Dir);
                var sb = new StringBuilder();
                foreach (AssistantLogEntry e in _entries)
                    sb.AppendLine(JsonSerializer.Serialize(e));
                // BOM-гүй — Python сургалтын скрипт мөн уншина.
                File.WriteAllText(LogPath, sb.ToString(), new UTF8Encoding(false));
            }
            catch
            {
                // Диск дүүрсэн / эрхгүй — чат ажиллахад саад болохгүй.
            }
        }

        /* ============================================================== */

        /// <summary>Нэг хэрэглээг бүртгэнэ.  Дараа нь засварлах ID буцаана.</summary>
        public static string Record(RouteResult route, string text, bool acted)
        {
            try
            {
                lock (Gate)
                {
                    EnsureLoaded();
                    var e = new AssistantLogEntry
                    {
                        Id = Guid.NewGuid().ToString("N").Substring(0, 16),
                        Ts = DateTime.UtcNow.ToString("o"),
                        Text = text ?? string.Empty,
                        Predicted = route?.Intent,
                        Confidence = route?.Confidence ?? 0,
                        DecidedBy = IntentRouter.DecidedByTag(route?.By ?? DecidedBy.Fallback),
                        Acted = acted,
                        DocUid = DocUid,
                        RevitVersion = RevitVersion,
                        ProjectId = ProjectId,
                        ModelVersion = IntentModel.LoadedVersion,
                        AddinVersion = BuildInfo.Version,
                    };
                    _entries.Add(e);
                    if (_entries.Count > MaxEntries)
                    {
                        // Тайрах нь ХОВОР — тэр үед л бүтнээр дахин бичнэ.
                        _entries.RemoveRange(0, _entries.Count - MaxEntries);
                        Save();
                    }
                    else
                    {
                        AppendOne(e);
                    }
                    return e.Id;
                }
            }
            catch
            {
                return null;
            }
        }

        /// <summary>
        /// 👍 / 👎 эсвэл засвар.
        ///
        /// ⚠️ `corrected` нь ХАМГИЙН ҮНЭ ЦЭНТЭЙ талбар: «энэ текст → ЭНЭ санаа»
        /// гэсэн ЯГ ЗӨВ шошго.  Хэрэглэгч сонголтоос сонгох бүрд бид үүнийг
        /// авдаг — тиймээс сонголтын жагсаалт нь алдаа биш, СУРГАЛТ.
        /// </summary>
        public static void Feedback(string id, int? feedback, string corrected)
        {
            Feedback(id, feedback, corrected, null);
        }

        /// <summary>
        /// Дээрхтэй ижил, дээр нь ЧӨЛӨӨТ ТАЙЛБАР.
        ///
        /// ⚠️ Тайлбар нь 👎-ЭЭС ХОЙШ ирдэг тул тусдаа дуудлага болно: хүн
        /// эхлээд 👎 дарж, дараа нь бичнэ (эсвэл бичихгүй).  Аль ч тохиолдолд
        /// 👎 нь аль хэдийн хадгалагдсан байх ёстой — тайлбар бичээгүй нь
        /// саналыг нь алдагдуулах ёсгүй.
        /// </summary>
        public static void Feedback(string id, int? feedback, string corrected, string note)
        {
            if (string.IsNullOrEmpty(id)) return;
            try
            {
                lock (Gate)
                {
                    EnsureLoaded();
                    AssistantLogEntry e = _entries.LastOrDefault(x => x.Id == id);
                    if (e == null) return;
                    if (feedback.HasValue) e.Feedback = feedback.Value;
                    if (!string.IsNullOrWhiteSpace(note))
                    {
                        string t = note.Trim();
                        // Сервер 500-аар таслах ч энд ч барина — локал файл хэт
                        // томроход бүх бүртгэл удаашрана.
                        e.FeedbackNote = t.Length > 500 ? t.Substring(0, 500) : t;
                    }
                    if (!string.IsNullOrEmpty(corrected))
                    {
                        e.Corrected = corrected;
                        // Засвар ирсэн бол үйлдэл гүйцэтгэгдсэн гэж үзнэ.
                        e.Acted = true;
                    }
                    // Дахин илгээгдэх ёстой.
                    e.Sent = false;
                    Save();
                }
            }
            catch { }
        }

        /// <summary>
        /// ХЭМЖИЛТ (1C) — өмнө нь бичигдсэн мөрөнд цагийн утгуудыг хавсаргана.
        ///
        /// ⚠️ ЯАГААД ТУСДАА ДУУДЛАГА ВЭ: `Record(...)` нь үйлдэл ЭХЛЭХЭД
        /// дуудагдана (тэр үед `t_total_ms` хараахан мэдэгдээгүй), харин
        /// хугацаа нь үйлдэл ДУУСМАГЦ л гарна.  `Record`-ийн хуучин гарын
        /// үсгийг ХЭВЭЭР үлдээж, түүн дээр нэмэлт дуудлага хийж байгаа нь
        /// зориуд — 6 дуудагчийг бүгдийг нь хөндөх шаардлагагүй.
        ///
        /// ⚠️ Бүхэл мс болгож ДУГУЙЛНА (JSON жижиг байх, нарийвчлал хангалттай).
        /// ⚠️ ХЭЗЭЭ Ч алдаа шидэхгүй — хэмжилт нь чатыг унагаах ёсгүй.
        /// ⚠️ `Sent`-ыг СОЛИХГҮЙ: мөр хараахан илгээгдээгүй байхад цагийг нь
        /// бичих нь ердийн зам; аль хэдийн илгээгдсэн бол дахин илгээхийн
        /// оронд ТЭР МӨРИЙГ ОРХИНО — цаг нь хожуу ирсэн нэмэлт мэдээлэл
        /// боловч дахин илгээх нь `ON CONFLICT` дээр бүх талбарыг дарж
        /// бичихгүй тул ашиггүй.
        /// </summary>
        public static void AttachTiming(
            string id,
            double? totalMs,
            double? routeMs,
            string routeLayer,
            string exitPath,
            double? modelLoadMs,
            string modelLoadSource,
            double? toolTotalMs,
            double? toolQueueMs,
            double? toolEventMs,
            double? toolExecMs,
            double? agentTtftMs,
            double? agentTotalMs)
        {
            if (string.IsNullOrEmpty(id)) return;
            try
            {
                lock (Gate)
                {
                    EnsureLoaded();
                    AssistantLogEntry e = _entries.LastOrDefault(x => x.Id == id);
                    if (e == null) return;
                    e.TotalMs = Timing.Round(totalMs);
                    e.RouteMs = Timing.Round(routeMs);
                    e.RouteLayer = routeLayer;
                    e.ExitPath = exitPath;
                    e.ModelLoadMs = Timing.Round(modelLoadMs);
                    e.ModelLoadSource = modelLoadSource;
                    e.ToolTotalMs = Timing.Round(toolTotalMs);
                    e.ToolQueueMs = Timing.Round(toolQueueMs);
                    e.ToolEventMs = Timing.Round(toolEventMs);
                    e.ToolExecMs = Timing.Round(toolExecMs);
                    e.AgentTtftMs = Timing.Round(agentTtftMs);
                    e.AgentTotalMs = Timing.Round(agentTotalMs);

                    // ⚠️⚠️ ЭНД `Save()` ДУУДАХГҮЙ — БҮҮ БУЦААЖ НЭМ.
                    //
                    // `Save()` нь 3000 мөрийн БҮТЭН файлыг дахин цувуулж
                    // бичдэг (`Save`-ийн тайлбар: «зөвхөн ХОВОР тохиолдолд —
                    // 👍/👎 ба хязгаараас хэтэрч тайрах үед»).  `AttachTiming`
                    // нь МЕССЕЖ БҮРТ, `EndTiming`-ээс, UI thread дээр
                    // дуудагддаг — өөрөөр хэлбэл энэ дуудлага нь `AppendOne`
                    // яг ҮҮНИЙГ арилгахын тулд нэмэгдсэн байсан бүтэн
                    // дахин бичилтийг мессеж тутам БУЦААЖ АВЧИРЧ байв.
                    // Бүртгэл өсөх тусам чат удаашрах бөгөөд шалтгаан нь
                    // ил биш; roaming profile дээр (§2.13) энэ нь мессеж
                    // бүрт сүлжээ хүлээх шалтгаан болно.
                    //
                    // ⚠️ ХЭМЖИЛТ АЛДАГДАХГҮЙ.  Утга нь санах ойн мөрөнд
                    // сууна, тэндээс хоёр замаар диск/сервер хүрнэ:
                    //   • `FlushAsync` амжилттай болмогц `Save()` дуудагдаж
                    //     `Sent` тугтай хамт бүгд бичигдэнэ (ердийн зам —
                    //     мессеж бүрийн дараа `FlushLogsSoon` ажилладаг);
                    //   • Revit хаагдахад `Shutdown()` сүүлчийн `Save()`-ыг
                    //     хийнэ (доор).
                    // Үлдэх цорын ганц алдагдал нь «сервер офлайн + Revit
                    // сүйрсэн» хослол дээр илгээгдээгүй мөрийн ЦАГ алдагдах
                    // явдал; тэр мөр өөрөө `AppendOne`-оор аль хэдийн
                    // бичигдсэн байх тул сургалтын өгөгдөл бүрэн үлдэнэ.
                }
            }
            catch { }
        }

        /// <summary>
        /// УНТРААЛТ — санах ойд үлдсэн өөрчлөлтийг диск рүү бичнэ.
        ///
        /// ⚠️ `App.OnShutdown`-аас НЭГ УДАА дуудна.  Шалтгаан: `AttachTiming`
        /// нь (зориудаар) диск хөндөхөө болисон тул илгээгдээгүй мөрүүдийн
        /// цагийн утга зөвхөн санах ойд байна.  Энэ нь тэднийг хадгална.
        ///
        /// ⚠️ ХЭЗЭЭ Ч алдаа шидэхгүй — унтраалт дээр шидэгдсэн алдаа нь
        /// Revit-ийн хаагдалтыг гацаана.
        /// ⚠️ Огт ачаалагдаагүй бол (`_loaded == false`) ЮУ Ч ХИЙХГҮЙ —
        /// эс бөгөөс хоосон жагсаалтаар байгаа файлыг ДАРЖ бичих эрсдэлтэй.
        /// </summary>
        public static void Shutdown()
        {
            try
            {
                lock (Gate)
                {
                    if (!_loaded || _entries == null) return;
                    Save();
                }
            }
            catch { }
        }

        /// <summary>Илгээгээгүй мөрийн тоо — панельд харуулж болно.</summary>
        public static int PendingCount
        {
            get
            {
                try
                {
                    lock (Gate) { EnsureLoaded(); return _entries.Count(e => !e.Sent); }
                }
                catch { return 0; }
            }
        }

        /// <summary>
        /// Хүлээгдэж буй мөрүүдийг сервер рүү илгээнэ.  ХЭЗЭЭ Ч алдаа шидэхгүй.
        /// Сервер байхгүй/офлайн бол мөрүүд локалд ХЭВЭЭР үлдэнэ.
        /// </summary>
        public static async Task<int> FlushAsync(string host, string token)
        {
            if (string.IsNullOrEmpty(host) || string.IsNullOrEmpty(token)) return 0;

            List<AssistantLogEntry> batch;
            lock (Gate)
            {
                EnsureLoaded();
                batch = _entries.Where(e => !e.Sent).Take(BatchSize).ToList();
            }
            if (batch.Count == 0) return 0;

            try
            {
                using var req = new HttpRequestMessage(
                    HttpMethod.Post, ApiClient.Url(host, "/api/revit/assistant/logs"))
                {
                    Content = ApiClient.JsonContent(new { entries = batch }),
                };
                req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);

                using HttpResponseMessage res =
                    await ApiClient.Http.SendAsync(req).ConfigureAwait(false);
                if (!res.IsSuccessStatusCode) return 0;

                var ids = new HashSet<string>(batch.Select(e => e.Id));
                lock (Gate)
                {
                    foreach (AssistantLogEntry e in _entries)
                        if (ids.Contains(e.Id)) e.Sent = true;
                    Save();
                }
                return batch.Count;
            }
            catch
            {
                // Офлайн — дараагийн удаа дахин оролдоно.
                return 0;
            }
        }

        /// <summary>Дибаг/экспортод — бүх мөрийг JSONL болгож буцаана.</summary>
        public static string ExportJsonl()
        {
            try
            {
                lock (Gate)
                {
                    EnsureLoaded();
                    var sb = new StringBuilder();
                    foreach (AssistantLogEntry e in _entries)
                        sb.AppendLine(JsonSerializer.Serialize(e));
                    return sb.ToString();
                }
            }
            catch { return string.Empty; }
        }
    }
}
