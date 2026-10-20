using System;
using System.Collections.Generic;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading.Tasks;

namespace RevitMcpAddin
{
    /// <summary>Серверийн нэг ээлжийн хариу.</summary>
    public class AgentTurnResponse
    {
        [JsonPropertyName("stop_reason")] public string StopReason { get; set; }
        [JsonPropertyName("text")] public string Text { get; set; }
        [JsonPropertyName("tool_uses")] public List<AgentToolUse> ToolUses { get; set; }
            = new List<AgentToolUse>();
        /// <summary>⚠️ ЯГ ХЭВЭЭР нь дараагийн assistant мессеж болно.</summary>
        [JsonPropertyName("assistant_content")] public JsonElement AssistantContent { get; set; }
        [JsonPropertyName("model")] public string Model { get; set; }
        [JsonPropertyName("provider")] public string Provider { get; set; }
        [JsonPropertyName("degraded")] public bool Degraded { get; set; }
        [JsonPropertyName("dropped_tools")] public List<string> DroppedTools { get; set; }
            = new List<string>();
    }

    public class AgentToolUse
    {
        [JsonPropertyName("id")] public string Id { get; set; }
        [JsonPropertyName("name")] public string Name { get; set; }
        [JsonPropertyName("input")] public JsonElement Input { get; set; }
    }

    /// <summary>Панель руу явцыг мэдээлэх дуудлагууд.</summary>
    public class AgentEvents
    {
        public Action<string> OnText;                 // туслахын хэлсэн үг
        public Action<string, string> OnToolStart;    // (нэр, хүн уншихуйц тайлбар)
        public Action<string, bool> OnToolDone;       // (нэр, амжилттай эсэх)
        public Action<string> OnStatus;               // "бодож байна…"
        public Action<string> OnDegraded;             // хямд загвар руу шилжсэн
    }

    /// <summary>
    /// AI туслахын ДАВТАЛТ — add-in эзэмшинэ.
    ///
    /// ⚠️ Яагаад давталт нь ЭНД байдаг вэ: хэрэгслүүд нь ЭНЭ компьютер дээрх
    /// Revit дотор гүйцэтгэгддэг.  Сервер тэдгээрийг дуудаж чадахгүй тул
    /// зөвхөн НЭГ ээлжийг л буцаадаг, бид гүйцэтгээд дахин асууна.
    ///
    /// ⚠️ ТҮЛХҮҮР ЭНД БАЙХГҮЙ.  Бүх LLM дуудлага `/api/revit/agent/turn`-ээр
    /// дамжина; Anthropic-ийн түлхүүр Cloudflare secret дотор үлддэг.
    ///
    /// ⚠️ БҮХ хэрэгслийн дуудлага `Task.Run` дотор — `RevitToolBus.Call` нь
    /// UI thread дээр дуудагдвал ӨӨРИЙГӨӨ хүлээж гацна.
    /// </summary>
    public static class AgentChat
    {
        /// <summary>Нэг хүсэлтэд зөвшөөрөх хэрэгслийн ээлжийн дээд тоо.</summary>
        private const int MaxToolTurns = 6;

        /// <summary>Хэрэгслийн үр дүнгийн текстийг тайрах хэмжээ.</summary>
        private const int MaxToolResultChars = 6000;

        private static readonly JsonSerializerOptions Read = new JsonSerializerOptions
        {
            PropertyNameCaseInsensitive = true,
        };

        /// <summary>Хүнд харагдах монгол нэр — хэрэгсэл ажиллаж байхад харуулна.</summary>
        private static readonly Dictionary<string, string> Labels =
            new Dictionary<string, string>
            {
                { "get_document_context", "Баримтын мэдээлэл уншиж байна" },
                { "list_sheets", "Хуудсуудыг уншиж байна" },
                { "capture_baseline", "Суурь тэмдэглэж байна" },
                { "diff_since_baseline", "Өөрчлөлтийг шалгаж байна" },
                { "list_changes", "Юу өөрчлөгдсөнийг задалж байна" },
                { "goto_element", "Тэр элемент рүү үсэрч байна" },
                { "isolate_sheet_elements", "Хуудсыг тусгаарлаж байна" },
                { "reset_isolation", "Тусгаарлалтыг цуцалж байна" },
                { "capture_view_image", "Харагдацын зураг авч байна" },
            };

        /// <summary>
        /// КЛИЕНТ ТАЛЫН ЗӨВШӨӨРӨГДСӨН ХЭРЭГСЭЛ — `backend/src/lib/revitAgent.ts`-ийн
        /// `ALLOWED_TOOLS`-ийн ХОСЛОЛ (twin).  ГУРВУУЛАА зэрэг өөрчлөгдөнө:
        ///   1. `AgentChat.ToolSpecs()`       — add-in ЗАРЛАДАГ   (одоо 8)
        ///   2. `revitAgent.ts ALLOWED_TOOLS` — сервер ЗӨВШӨӨРДӨГ (одоо 9)
        ///   3. `RevitTools.Run` switch       — add-in ГҮЙЦЭТГЭДЭГ (одоо 10)
        ///
        /// ⚠️⚠️ ЭНЭ ЖАГСААЛТ НЬ PYTHON АГЕНТЫН ALLOWLIST БИШ.
        /// `revit-mcp/agent/mgl_agent.py`-ийн `ALLOWED` бол ТУСДАА зам —
        /// Claude Agent SDK → MCP сервер (`revit-mcp/server/revit_mcp/server.py`)
        /// → локал HTTP гүүр.  Тэр зам ЭНЭ ФАЙЛААР ОГТ ДАМЖДАГГҮЙ; түүнд
        /// хэрэгсэл нэмэхийн тулд `server.py`-д `@mcp.tool` бичих хэрэгтэй.
        /// Тиймээс `list_changes` / `goto_element` нь MCP-д БАЙХГҮЙ ч ЭНД
        /// ҮХМЭЛ БИШ — ЗАМ Б дээр бүрэн ажилладаг тул БҮҮ УСТГА.
        ///
        /// ⚠️ ЯАГААД КЛИЕНТ ТАЛД БАС ХЭРЭГТЭЙ ВЭ: сервер нь Anthropic-ийн
        /// `tool_use` блокуудыг ШҮҮДЭГГҮЙ (`revitAgent.ts` дэх Workers AI-ийн
        /// зам нь шүүдэг, Anthropic-ийнх нь ҮГҮЙ — `shapeAnthropic` нь
        /// `assistantContent`-ыг ТҮҮХИЙ буцаадаг).  Тиймээс хийсвэрлэсэн нэр
        /// (`change_digest`, `capture_view_image`) энэ хүртэл хүрч,
        /// `RevitTools`-ийн switch түүнийг ГҮЙЦЭТГЭНЭ.  Хоёулаа зөвхөн
        /// УНШИНА тул өнөөдөр эрсдэл бага — гэхдээ хилийг ЭНД ч барина.
        ///
        /// ЗӨРҮҮНИЙ БҮРТГЭЛ (шинэчлэгдсэн 2026-08-28 — ХОЁУЛАН ЗАМЫГ хамарна):
        ///
        ///   Spec = `AgentChat.ToolSpecs()`                       (ЗАМ Б, 8)
        ///   Srv  = `backend/src/lib/revitAgent.ts ALLOWED_TOOLS` (ЗАМ Б, 9)
        ///   Cli  = `ClientAllowedTools` (энэ жагсаалт)           (ЗАМ Б, 8)
        ///   Run  = `RevitTools.Run` switch — ХОЁР ЗАМЫН ГҮЙЦЭТГЭГЧ    (10)
        ///   MCP  = `revit_mcp/server.py` `@mcp.tool`             (ЗАМ А, 10)
        ///   Py   = `mgl_agent.py ALLOWED`                        (ЗАМ А, 7)
        ///
        ///   хэрэгсэл                Spec Srv Cli Run │ MCP  Py
        ///   get_document_context     ✔   ✔   ✔   ✔  │  ✔   ✔
        ///   list_sheets              ✔   ✔   ✔   ✔  │  ✔   ✔
        ///   capture_baseline         ✔   ✔   ✔   ✔  │  ✔   ✔
        ///   diff_since_baseline      ✔   ✔   ✔   ✔  │  ✔   ✔
        ///   isolate_sheet_elements   ✔   ✔   ✔   ✔  │  ✔   ✔
        ///   reset_isolation          ✔   ✔   ✔   ✔  │  ✔   ✔
        ///   list_changes             ✔   ✔   ✔   ✔  │  ✘   ✘   ← ЗӨВХӨН ЗАМ Б
        ///   goto_element             ✔   ✔   ✔   ✔  │  ✘   ✘   ← ЗӨВХӨН ЗАМ Б
        ///   capture_view_image       ✘   ✔   ✘   ✔  │  ✘   ✘   (зарлагдаагүй)
        ///   change_digest            ✘   ✘   ✘   ✔  │  ✘   ✘   (зарлагдаагүй)
        ///   ping_revit               ✘   ✘   ✘   ✘  │  ✔   ✔   (GET /health)
        ///   get_model_info           ✘   ✘   ✘   ✘  │  ✔   ✘   (Roslyn → 403)
        ///   get_selection            ✘   ✘   ✘   ✘  │  ✔   ✘   (Roslyn → 403)
        ///   run_revit_code           ✘   ✘   ✘   ✘  │  ✔   ✘   (санаатай хориотой)
        ///
        /// ⚠️ Сүүлийн ДӨРВӨН мөр нь `RevitTools.Run`-д ОГТ БАЙХГҮЙ.  Тэд
        /// add-in-ий өөр эцсийн цэгүүд рүү ордог: `ping_revit` → `/health`,
        /// бусад гурав → `/execute` (Roslyn), тэр нь `MGL_ALLOW_EXEC=1`
        /// байхгүй бол 403.  Тиймээс `get_model_info` / `get_selection`
        /// 2026-08-28-нд `mgl_agent.py ALLOWED`-ээс ХАСАГДСАН — бодит ПК
        /// дээр 100% алдаа өгдөг байсан (аудитын олдвор A1).
        ///
        /// ⚠️ `capture_view_image` нь Srv+Run дээр байгаа ч ХААНААС Ч
        /// ЗАРЛАГДААГҮЙ (Spec ✘) тул загвар түүнийг дуудахгүй — унтаа чадвар.
        /// `change_digest` нь бүр Srv дээр ч байхгүй.  Аль алиныг нь
        /// амилуулах гэвэл `ToolSpecs()` + `ClientAllowedTools`-д ЗЭРЭГ нэм.
        ///
        /// ⚠️ `Labels` толь нь 9 бичлэгтэй (`capture_view_image` тэнд БАЙГАА)
        /// — тэр нь зөвхөн ХАРУУЛАХ нэр, зөвшөөрөл БИШ.  Хольж болохгүй.
        /// </summary>
        private static readonly HashSet<string> ClientAllowedTools =
            new HashSet<string>(StringComparer.Ordinal)
            {
                "get_document_context", "list_sheets", "capture_baseline",
                "diff_since_baseline", "list_changes", "goto_element",
                "isolate_sheet_elements", "reset_isolation",
            };

        /// <summary>Add-in-ий зарладаг хэрэгслүүд.  Сервер эдгээрийг ШҮҮНЭ.</summary>
        private static object[] ToolSpecs()
        {
            return new object[]
            {
                Tool("get_document_context",
                    "Одоо нээлттэй Revit баримтын мэдээлэл: нэр, хувилбар, хуудасны тоо, төслийн нэр.",
                    NoArgs()),
                Tool("list_sheets",
                    "Баримтын бүх хуудсыг буцаана: uid, дугаар, нэр, байрлуулсан харагдацын тоо. " +
                    "Хуудсыг ҮРГЭЛЖ uid-ээр нь заа, дугаараар нь БИШ.",
                    NoArgs()),
                Tool("capture_baseline",
                    "Загварын өнөөгийн төлөвийг суурь болгож хадгална. Загварыг ӨӨРЧЛӨХГҮЙ.",
                    NoArgs()),
                // ⚠️ ЭНЭ ТАЙЛБАР 2026-08-25 хүртэл ХУДАЛ байв: «ямар ХУУДАС
                // өөрчлөгдсөнийг буцаана», «засварыг ХАРАХГҮЙ» гэсэн хоёулаа
                // `ChangeTracker` орсноор хүчингүй болсон.  Загвар тайлбарыг
                // үнэн гэж үзэж шийдвэр гаргадаг тул хуучирсан тайлбар нь
                // алдаатай хариулт төрүүлдэг.
                Tool("diff_since_baseline",
                    "Суурь тавьснаас хойш хэдэн ЭЛЕМЕНТ нэмэгдсэн / устсан / " +
                    "засварлагдсаныг буцаана.  Зөвхөн ТОО — аль элемент болохыг " +
                    "мэдэхийн тулд list_changes-ийг ашигла.",
                    NoArgs()),
                Tool("list_changes",
                    "Суурь тавьснаас хойшхи өөрчлөлтийг КАТЕГОРИОР задалж буцаана: " +
                    "хана, багана, шал, дээвэр, тааз гэх мэт.  Мөр бүрт элементийн " +
                    "id, төрлийн нэр, давхар, Revit-ийн хийсэн үйлдэл (зөөсөн, " +
                    "төрөл сольсон г.м.) ба цаг байна.  Загварыг ӨӨРЧЛӨХГҮЙ.",
                    NoArgs()),
                Tool("goto_element",
                    "Тухайн элементийг харуулж буй харагдацыг нээж, элементийг " +
                    "СОНГОЖ, түүн рүү ойртуулна.  Аль хуудсанд байгааг нь бас " +
                    "буцаана.  Зөвхөн ХАРАГДАЦЫГ өөрчилнө, загварыг БИШ.  " +
                    "element_id-г list_changes-ээс ав.",
                    OneNumber("element_id", "list_changes-ээс авсан элементийн id")),
                Tool("isolate_sheet_elements",
                    "Тухайн хуудасны элементүүдийг идэвхтэй харагдацад тусгаарлана. " +
                    "Харагдацыг өөрчилнө (Ctrl+Z-ээр буцна).",
                    OneString("sheet_uid", "list_sheets-ээс авсан хуудасны uid")),
                Tool("reset_isolation",
                    "Идэвхтэй харагдацын түр тусгаарлалтыг цуцална.",
                    NoArgs()),
            };
        }

        private static object Tool(string name, string desc, object schema) =>
            new { name, description = desc, input_schema = schema };

        private static object NoArgs() =>
            new { type = "object", properties = new { }, required = new string[0] };

        private static object OneNumber(string field, string desc)
        {
            var props = new Dictionary<string, object>
            {
                { field, new { type = "integer", description = desc } },
            };
            return new { type = "object", properties = props, required = new[] { field } };
        }

        private static object OneString(string field, string desc)
        {
            var props = new Dictionary<string, object>
            {
                { field, new { type = "string", description = desc } },
            };
            return new { type = "object", properties = props, required = new[] { field } };
        }

        /* ============================================================== */
        /*  ЛОКАЛ АГЕНТ — хэрэглэгчийн Claude ЗАХИАЛГААР                  */
        /* ============================================================== */

        /// <summary>
        /// Локал агентын хаяг.  `MGL_AGENT_URL`-ээр дарж бичнэ.
        ///
        /// ⚠️ `localhost` БИШ, `127.0.0.1`.  Хэмжсэн (2026-08-24, энэ машин дээр):
        ///   http://localhost:5099/health   эхний дуудлага → 2062 мс
        ///   http://127.0.0.1:5099/health   эхний дуудлага →    0 мс
        /// Хоёр шалтгаан бий.  Нэг: .NET нь ХОСТЫН НЭРД proxy шийдэлт (WPAD)
        /// хийдэг ба энэ нь эхний удаад ~2 секунд зарцуулдаг; шууд IP бичвэл
        /// алгасдаг.  Хоёр: `localhost` нь эхлээд `::1` (IPv6) болж хөрвөдөг
        /// атал агент нь зөвхөн `127.0.0.1` дээр сонсдог тул нэмэлт оролдлого
        /// хийгддэг.  Доорх шалгалт 2 секундын хугацаатай байсан тул probe
        /// ҮРГЭЛЖ уначихаад, панель нь агент ажиллаж байхад ч «AI туслах бэлэн
        /// биш байна» гэж хэлдэг байв.
        /// </summary>
        public static string LocalUrl =>
            Environment.GetEnvironmentVariable("MGL_AGENT_URL")?.TrimEnd('/')
            ?? "http://127.0.0.1:5099";

        private static bool? _localUp;
        private static DateTime _localCheckedAt;

        /// <summary>
        /// Локал агентын session токен.  `%APPDATA%\RevitMcpAddin\agent.json`-оос
        /// уншина (агент өөрөө асахдаа бичнэ — 1A-5).
        ///
        /// ⚠️ null буцаах нь ХЭВИЙН: агент хуучин хувилбар (токенгүй) байж
        /// болно.  Тэр үед толгойг ОГТ НЭМЭХГҮЙ — эс бөгөөс хуучин агент
        /// 400 өгнө.  Ингэснээр энэ релиз ХУУЧИН агенттай ч, ШИНЭ агенттай ч
        /// ажиллана; lockstep шинэчлэл шаардахгүй.
        /// ⚠️ БҮХ дуудлагад (`/health` БОЛОН `/chat`) нэмнэ.
        /// ⚠️ КЭШЛЭХГҮЙ — агент дахин асахад токен солигдоно.
        /// ⚠️ Файлын нэр (`agent.json`) ба талбарын нэр (`token`) нь 1A-5-ын
        /// Python талтай ЯГ ТААРАХ ЁСТОЙ.  Зөрвөл локал AI бүх машин дээр
        /// унах ба засах нь ДАХИН БҮРЭН ШИНЭЧЛЭЛ.
        /// </summary>
        private static string LocalToken()
        {
            try
            {
                string p = System.IO.Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
                    "RevitMcpAddin", "agent.json");
                if (!System.IO.File.Exists(p)) return null;
                using JsonDocument d = JsonDocument.Parse(
                    System.IO.File.ReadAllText(p, Encoding.UTF8));
                return d.RootElement.TryGetProperty("token", out JsonElement t)
                    ? t.GetString()
                    : null;
            }
            catch { return null; }
        }

        /// <summary>Токен байвал `Authorization: Bearer` нэмнэ, байхгүй бол ЮУ Ч нэмэхгүй.</summary>
        private static void AddLocalAuth(HttpRequestMessage req)
        {
            string t = LocalToken();
            if (!string.IsNullOrEmpty(t))
                req.Headers.Authorization =
                    new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", t);
        }

        /// <summary>
        /// Локал агент ажиллаж байгаа эсэх.  Үр дүнг 15 секунд кэшлэнэ —
        /// мессеж бүрт шалгах нь илүүц саатал.
        /// </summary>
        public static async Task<bool> IsLocalAvailableAsync()
        {
            if (_localUp.HasValue && (DateTime.UtcNow - _localCheckedAt).TotalSeconds < 15)
                return _localUp.Value;
            try
            {
                // 2 секунд хэтэрхий чанга байсан (дээрх тайлбар).  IP хаяг руу
                // шууд залгахад 0 мс болсон ч, машин ачаалалтай үед нөөцтэй
                // байхын тулд 5 секунд болгов — агент байхгүй үед ч хүн
                // 5 секундээс илүү хүлээхгүй.
                using var cts = new System.Threading.CancellationTokenSource(TimeSpan.FromSeconds(5));
                // ⚠️ `GetAsync` биш `SendAsync` — токен нэмэхийн тулд
                // `HttpRequestMessage` хэрэгтэй (1A-5).
                using var probe = new HttpRequestMessage(HttpMethod.Get, LocalUrl + "/health");
                AddLocalAuth(probe);
                using HttpResponseMessage r = await ApiClient.Http
                    .SendAsync(probe, cts.Token).ConfigureAwait(false);
                _localUp = r.IsSuccessStatusCode;
            }
            catch
            {
                _localUp = false;
            }
            _localCheckedAt = DateTime.UtcNow;
            return _localUp.Value;
        }

        /// <summary>Дараагийн дуудлагад дахин шалгуулна.</summary>
        public static void ForgetLocalProbe() => _localUp = null;

        /// <summary>
        /// Локал агент руу илгээж, NDJSON урсгалыг мөр мөрөөр нь уншина.
        ///
        /// ⚠️ Давталт нь АГЕНТ дотор явна — тэр өөрөө MCP-ээр Revit-ийн
        /// хэрэгслүүдийг дуудна.  Энд зөвхөн харуулна.
        /// </summary>
        private static async Task RunLocalAsync(string userText, AgentEvents ev)
        {
            // ⚠️ ХЭМЖИЛТ (1C): TTFT = ЭХНИЙ NDJSON мөр ирэх хүртэлх хугацаа.
            // Энэ бол хэрэглэгчийн мэдрэх «хэдийд хариулж эхэлсэн бэ» — бүтэн
            // эргэлтийн хугацаанаас ТЭС ӨӨР зүйл.
            var sw = System.Diagnostics.Stopwatch.StartNew();
            bool firstLineSeen = false;
            bool ok = false;
            try
            {
                var payload = new { message = userText };
                using var req = new HttpRequestMessage(HttpMethod.Post, LocalUrl + "/chat")
                {
                    Content = ApiClient.JsonContent(payload),
                };
                AddLocalAuth(req);

                using HttpResponseMessage res = await ApiClient.Http
                    .SendAsync(req, HttpCompletionOption.ResponseHeadersRead)
                    .ConfigureAwait(false);

                if (!res.IsSuccessStatusCode)
                {
                    ev?.OnText?.Invoke("Локал туслах алдаа өглөө (" + (int)res.StatusCode + ").");
                    return;
                }

                using System.IO.Stream stream =
                    await res.Content.ReadAsStreamAsync().ConfigureAwait(false);
                using var reader = new System.IO.StreamReader(stream, Encoding.UTF8);

                string line;
                while ((line = await reader.ReadLineAsync().ConfigureAwait(false)) != null)
                {
                    if (!firstLineSeen)
                    {
                        firstLineSeen = true;
                        _lastTtftMs = sw.Elapsed.TotalMilliseconds;
                        Metrics.AgentTtft.Add(_lastTtftMs.Value);
                    }
                    line = line.Trim();
                    if (line.Length == 0) continue;
                    JsonElement ev1;
                    try
                    {
                        using JsonDocument d = JsonDocument.Parse(line);
                        ev1 = d.RootElement.Clone();
                    }
                    catch
                    {
                        continue; // chunked хэмжээний мөр г.м. — алгасна
                    }

                    string kind = ev1.TryGetProperty("type", out JsonElement t) ? t.GetString() : "";
                    switch (kind)
                    {
                        case "text":
                            ev?.OnText?.Invoke(ev1.GetProperty("text").GetString());
                            break;
                        case "tool":
                            string name = ev1.GetProperty("name").GetString();
                            ev?.OnToolStart?.Invoke(
                                name, Labels.TryGetValue(name, out string l2) ? l2 : name);
                            break;
                        case "error":
                            ev?.OnText?.Invoke(ev1.GetProperty("text").GetString());
                            break;
                        case "done":
                            ok = true;
                            return;
                    }
                }
                ok = true;
            }
            finally
            {
                // ⚠️ БҮХ гарцад бичнэ — `return`, exception, урсгал дуусах.
                _lastTotalMs = sw.Elapsed.TotalMilliseconds;
                Metrics.AgentTotal.Add(_lastTotalMs.Value, ok);
                if (!firstLineSeen) _lastTtftMs = null;
            }
        }

        /* ============================================================== */
        /*  ХЭМЖИЛТ (1C) — AI тээвэр                                       */
        /* ============================================================== */

        private static double? _lastTtftMs;
        private static double? _lastTotalMs;

        /// <summary>
        /// Эхний токен хүртэлх мс.
        ///
        /// ⚠️ ЗӨВХӨН ЛОКАЛ УРСГАЛ (`RunLocalAsync`, NDJSON) дээр утгатай.
        /// Алсын `PostTurnAsync` нь streaming БИШ — бүтэн JSON биеийг нэг
        /// дор уншдаг, өөрөөр хэлбэл TTFT ≡ total.  Тэр замаар явахад энэ
        /// нь NULL үлдэнэ; тайланд «TTFT яагаад хоосон вэ» гэсэн асуулт
        /// төрөхөөс сэргийлж энд тэмдэглэв.
        /// </summary>
        public static double? LastTtftMs => _lastTtftMs;

        /// <summary>AI агентын БҮТЭН эргэлтийн мс (локал эсвэл алсын).</summary>
        public static double? LastTotalMs => _lastTotalMs;

        /// <summary>
        /// ХЭМЖИЛТИЙН ЦЭВЭРЛЭГЭЭ — мессеж БҮРИЙН эхэнд дуудна.
        ///
        /// ⚠️ ЯАГААД: дээрх хоёр талбар нь «хамгийн сүүлийн эргэлт» бөгөөд
        /// ЦЭВЭРЛЭГДДЭГГҮЙ байв.  `AssistantPane` нь мессеж бүрийн төгсгөлд
        /// тэднийг `assistant_logs`-д бичдэг тул AI-г ОГТ хөндөөгүй мессеж
        /// (түлхүүр үгээр шийдэгдсэн — өөрөөр хэлбэл ИХЭНХ нь) ӨМНӨХ
        /// мессежийн AI хугацааг өөрийн болгож зөөдөг байсан.  Тэр нь
        /// сервер дээр «офлайн зам 3 секунд AI дуудсан» гэсэн худал хэв
        /// маяг үүсгэнэ.
        ///
        /// ⚠️ Хуримтлуулагч (`Metrics.Agent*`) ЦЭВЭРЛЭГДЭХГҮЙ.
        /// ⚠️ `busy` гарц дээр БҮҮ ДУУД — ӨМНӨХ мессеж гүйж байна.
        /// </summary>
        public static void ResetLastTiming()
        {
            _lastTtftMs = null;
            _lastTotalMs = null;
        }

        /// <summary>
        /// Хэрэглэгчийн мессежийг боловсруулж, шаардлагатай бол хэрэгслүүдийг
        /// гүйцэтгээд эцсийн хариуг буцаана.  ХЭЗЭЭ Ч алдаа шидэхгүй.
        ///
        /// ⚠️ ХОЁР ЗАМ:
        ///   1. Локал агент (localhost:5099) ажиллаж байвал ТҮҮГЭЭР — энэ нь
        ///      хэрэглэгчийн Claude ЗАХИАЛГЫГ ашиглана, API түлхүүр хэрэггүй.
        ///   2. Эс бөгөөс сервер рүү (`/api/revit/agent/turn`).
        /// Хоёулаа боломжгүй бол ЮУ ХИЙХИЙГ тодорхой хэлнэ — 404 гэж бүү үлдээ.
        /// </summary>
        public static async Task RunAsync(
            string host, string token, string userText,
            Dictionary<string, object> docContext, int? projectId, AgentEvents ev)
        {
            // Локал агент байвал ТҮҮГЭЭР — захиалгын хязгаараар, түлхүүргүй.
            if (await IsLocalAvailableAsync().ConfigureAwait(false))
            {
                try
                {
                    await RunLocalAsync(userText, ev).ConfigureAwait(false);
                    return;
                }
                catch (Exception ex)
                {
                    ForgetLocalProbe();
                    ev?.OnText?.Invoke("Локал туслахтай холбогдож чадсангүй: " + ex.Message);
                    return;
                }
            }

            string runId = Guid.NewGuid().ToString("N");

            // Ярианы түүх — Anthropic-ийн content блокийн хэлбэрээр.
            var messages = new List<object>
            {
                new
                {
                    role = "user",
                    content = new object[] { new { type = "text", text = userText } },
                },
            };

            for (int turn = 0; turn < MaxToolTurns; turn++)
            {
                ev?.OnStatus?.Invoke(turn == 0 ? "Бодож байна…" : "Үргэлжлүүлж байна…");

                AgentTurnResponse res;
                try
                {
                    res = await PostTurnAsync(host, token, runId, projectId, docContext, messages);
                }
                catch (ApiException api) when (api.StatusCode == 404)
                {
                    // Серверт AI зам хараахан байршуулагдаагүй.  Хэрэглэгчид
                    // ЯГ ЮУ ХИЙХИЙГ хэл — «404» гэж үлдээх нь ашиггүй.
                    ev?.OnText?.Invoke(
                        "AI туслах бэлэн биш байна.\n\n" +
                        "Локал туслахыг асаагаарай — Terminal дээр:\n" +
                        "  cd <repo>\\revit-mcp\n" +
                        "  server\\.venv\\Scripts\\python.exe agent\\mgl_agent.py\n\n" +
                        "Тэгээд энд дахин бичээрэй. (Таны Claude захиалгаар ажиллана.)");
                    return;
                }
                catch (Exception ex)
                {
                    ev?.OnText?.Invoke(RevitApi.FriendlyError(ex));
                    return;
                }

                if (res == null) { ev?.OnText?.Invoke("Сервер хариу өгсөнгүй."); return; }

                if (res.Degraded && turn == 0)
                {
                    ev?.OnDegraded?.Invoke(
                        "Хямд загвараар ажиллаж байна — хариу товч, олон алхамт төлөвлөгөө гаргахгүй.");
                }

                if (!string.IsNullOrWhiteSpace(res.Text)) ev?.OnText?.Invoke(res.Text);

                if (res.StopReason != "tool_use" || res.ToolUses == null || res.ToolUses.Count == 0)
                    return;

                // ⚠️ Серверийн буцаасан блокуудыг ЯГ ХЭВЭЭР нь нэмнэ.  `text` +
                // `tool_uses`-аас ДАХИН БҮТЭЭВЭЛ tool_use-ийн id алдагдаж,
                // дараагийн хүсэлт 400 өгнө.
                messages.Add(new
                {
                    role = "assistant",
                    content = JsonSerializer.Deserialize<object>(res.AssistantContent.GetRawText()),
                });

                var results = new List<object>();
                foreach (AgentToolUse tu in res.ToolUses)
                {
                    // ⚠️ КЛИЕНТ ТАЛЫН ALLOWLIST.  Сервер нь Anthropic-ийн
                    // `tool_use` блокуудыг ШҮҮДЭГГҮЙ тул зарлагдаагүй нэр
                    // (`change_digest`, `capture_view_image`) энд хүрч ирж
                    // болно — `RevitTools.Run`-ий switch түүнийг гүйцэтгэнэ.
                    //
                    // ⚠️ ТАЙВАН ТАТГАЛЗАНА — `tool_use_id` бүрт `tool_result`
                    // ЗААВАЛ буцаана.  Чимээгүй алгасвал хариугүй `tool_use`
                    // үлдэж, дараагийн хүсэлт Anthropic-ийн Messages API дээр
                    // 400 өгнө.  Мөн энэ нь загварт «энэ хэрэгсэл байхгүй»
                    // гэдгийг ойлгуулна.
                    if (!ClientAllowedTools.Contains(tu.Name))
                    {
                        ev?.OnToolDone?.Invoke(tu.Name, false);
                        results.Add(new
                        {
                            type = "tool_result",
                            tool_use_id = tu.Id,
                            is_error = true,
                            content = new object[]
                            {
                                new { type = "text", text = "{\"error\":\"tool_not_allowed\"}" },
                            },
                        });
                        continue;
                    }

                    string label = Labels.TryGetValue(tu.Name, out string l) ? l : tu.Name;
                    ev?.OnToolStart?.Invoke(tu.Name, label);

                    string payload;
                    bool ok = true;
                    try
                    {
                        string argsJson = tu.Input.ValueKind == JsonValueKind.Undefined
                            ? "{}"
                            : tu.Input.GetRawText();
                        // ⚠️ Task.Run — UI thread дээр ExternalEvent хүлээвэл гацна.
                        ToolCall call = await Task.Run(
                            () => RevitToolBus.Call(tu.Name, argsJson));
                        if (call.Success)
                        {
                            payload = call.ResultJson ?? "{}";
                        }
                        else
                        {
                            ok = false;
                            payload = "{\"error\":" + JsonSerializer.Serialize(call.Error ?? "failed") + "}";
                        }
                    }
                    catch (Exception ex)
                    {
                        ok = false;
                        payload = "{\"error\":" + JsonSerializer.Serialize(ex.Message) + "}";
                    }

                    if (payload.Length > MaxToolResultChars)
                        payload = payload.Substring(0, MaxToolResultChars) + "…(тайрсан)";

                    ev?.OnToolDone?.Invoke(tu.Name, ok);

                    results.Add(new
                    {
                        type = "tool_result",
                        tool_use_id = tu.Id,
                        is_error = !ok,
                        content = new object[] { new { type = "text", text = payload } },
                    });
                }

                messages.Add(new { role = "user", content = results });
            }

            ev?.OnText?.Invoke(
                "Хэт олон алхам болсон тул зогслоо. Асуултаа арай тодорхой хэлж үзнэ үү.");
        }

        private static async Task<AgentTurnResponse> PostTurnAsync(
            string host, string token, string runId, int? projectId,
            Dictionary<string, object> doc, List<object> messages)
        {
            var payload = new
            {
                run_id = runId,
                turn_id = Guid.NewGuid().ToString("N"),
                project_id = projectId,
                doc,
                tools = ToolSpecs(),
                messages,
                max_tokens = 2000,
            };

            using var req = new HttpRequestMessage(
                HttpMethod.Post, ApiClient.Url(host, "/api/revit/agent/turn"))
            {
                Content = ApiClient.JsonContent(payload),
            };
            req.Headers.Authorization =
                new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);

            // ⚠️ ХЭМЖИЛТ (1C): энэ зам нь streaming БИШ тул TTFT-ийг ялгах
            // боломжгүй — `t_agent_ttft_ms` NULL үлдэнэ, `t_agent_total_ms`
            // л утгатай.
            var sw = System.Diagnostics.Stopwatch.StartNew();
            try
            {
                using HttpResponseMessage res = await ApiClient.Http.SendAsync(req).ConfigureAwait(false);
                string body = await res.Content.ReadAsStringAsync().ConfigureAwait(false);
                if (!res.IsSuccessStatusCode) throw ApiClient.Error(res, body);
                AgentTurnResponse parsed = JsonSerializer.Deserialize<AgentTurnResponse>(body, Read);
                _lastTotalMs = sw.Elapsed.TotalMilliseconds;
                _lastTtftMs = null;
                Metrics.AgentTotal.Add(_lastTotalMs.Value, ok: true);
                return parsed;
            }
            catch
            {
                _lastTotalMs = sw.Elapsed.TotalMilliseconds;
                _lastTtftMs = null;
                Metrics.AgentTotal.Add(_lastTotalMs.Value, ok: false);
                throw;
            }
        }
    }
}
