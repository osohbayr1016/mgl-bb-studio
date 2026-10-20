using System;
using System.Collections.Generic;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading;
using System.Threading.Tasks;

namespace RevitMcpAddin
{
    /* ================================================================== */
    /*  DTO-ууд — /api/revit-ийн хариунууд                                 */
    /* ================================================================== */

    public class RevitDocumentDto
    {
        [JsonPropertyName("id")] public int Id { get; set; }
        [JsonPropertyName("project_id")] public int ProjectId { get; set; }
        [JsonPropertyName("project_name")] public string ProjectName { get; set; }
        [JsonPropertyName("file_name")] public string FileName { get; set; }
        [JsonPropertyName("sheet_count")] public int SheetCount { get; set; }
    }

    public class BindingDto
    {
        [JsonPropertyName("id")] public int Id { get; set; }
        [JsonPropertyName("sheet_uid")] public string SheetUid { get; set; }
        [JsonPropertyName("sheet_number")] public string SheetNumber { get; set; }
        [JsonPropertyName("sheet_name")] public string SheetName { get; set; }
        [JsonPropertyName("drawing_id")] public int? DrawingId { get; set; }
        [JsonPropertyName("task_id")] public int? TaskId { get; set; }
        [JsonPropertyName("drawing_name")] public string DrawingName { get; set; }
        [JsonPropertyName("task_name")] public string TaskName { get; set; }
        [JsonPropertyName("status")] public string Status { get; set; }
        [JsonPropertyName("match_source")] public string MatchSource { get; set; }
        [JsonPropertyName("confidence")] public double Confidence { get; set; }
    }

    public class DrawingCandidateDto
    {
        [JsonPropertyName("id")] public int Id { get; set; }
        [JsonPropertyName("name")] public string Name { get; set; }
        [JsonPropertyName("block_name")] public string BlockName { get; set; }
    }

    public class TaskCandidateDto
    {
        [JsonPropertyName("id")] public int Id { get; set; }
        [JsonPropertyName("name")] public string Name { get; set; }
        [JsonPropertyName("drawing_id")] public int DrawingId { get; set; }
    }

    public class CandidatesDto
    {
        [JsonPropertyName("drawings")] public List<DrawingCandidateDto> Drawings { get; set; }
            = new List<DrawingCandidateDto>();
        [JsonPropertyName("tasks")] public List<TaskCandidateDto> Tasks { get; set; }
            = new List<TaskCandidateDto>();
    }

    public class HandshakeResult
    {
        [JsonPropertyName("document")] public RevitDocumentDto Document { get; set; }
        [JsonPropertyName("bindings")] public List<BindingDto> Bindings { get; set; }
            = new List<BindingDto>();
        [JsonPropertyName("candidates")] public CandidatesDto Candidates { get; set; }
            = new CandidatesDto();
    }

    public class ChecklistItemDto
    {
        [JsonPropertyName("id")] public int Id { get; set; }
        [JsonPropertyName("text")] public string Text { get; set; }
        [JsonPropertyName("is_done")] public int IsDone { get; set; }
    }

    public class ChecklistDto
    {
        [JsonPropertyName("total")] public int Total { get; set; }
        [JsonPropertyName("done")] public int Done { get; set; }
        [JsonPropertyName("items")] public List<ChecklistItemDto> Items { get; set; }
            = new List<ChecklistItemDto>();
    }

    public class ResolvedTaskDto
    {
        [JsonPropertyName("task_id")] public int TaskId { get; set; }
        [JsonPropertyName("task_name")] public string TaskName { get; set; }
        [JsonPropertyName("drawing_name")] public string DrawingName { get; set; }
        [JsonPropertyName("block_name")] public string BlockName { get; set; }
        /// <summary>Энэ ажил ТУХАЙН хэрэглэгчид хуваарилагдсан эсэх.  scope=all
        /// үед менежер файлд холбогдсон БУСДЫН ажлыг ч хардаг тул ялгах хэрэгтэй.</summary>
        [JsonPropertyName("assigned")] public bool Assigned { get; set; } = true;
        [JsonPropertyName("current_progress")] public double CurrentProgress { get; set; }
        [JsonPropertyName("derived_percent")] public double? DerivedPercent { get; set; }
        [JsonPropertyName("suggested_percent")] public double? SuggestedPercent { get; set; }
        [JsonPropertyName("percent_basis")] public string PercentBasis { get; set; }
        [JsonPropertyName("basis_detail")] public string BasisDetail { get; set; }
        [JsonPropertyName("ceiling")] public double Ceiling { get; set; }
        [JsonPropertyName("checklist")] public ChecklistDto Checklist { get; set; } = new ChecklistDto();
        [JsonPropertyName("reported_today")] public bool ReportedToday { get; set; }
        [JsonPropertyName("sheet_uids")] public List<string> SheetUids { get; set; } = new List<string>();
    }

    public class ContextResult
    {
        [JsonPropertyName("document")] public RevitDocumentDto Document { get; set; }
        [JsonPropertyName("resolved")] public List<ResolvedTaskDto> Resolved { get; set; }
            = new List<ResolvedTaskDto>();
        [JsonPropertyName("unbound_sheet_uids")] public List<string> UnboundSheetUids { get; set; }
            = new List<string>();

        /* --- Хоосон төлөвийг ЯГ ЗӨВ тайлбарлахад хэрэгтэй тоонууд --------- */
        /// <summary>Тухайн хэрэглэгчид энэ төсөлд хуваарилагдсан ажлын тоо.</summary>
        [JsonPropertyName("my_task_count")] public int MyTaskCount { get; set; }
        /// <summary>Файлын хуудсуудад БАТЛАГДСАН холбоостой ажлын тоо.</summary>
        [JsonPropertyName("bound_task_count")] public int BoundTaskCount { get; set; }
        /// <summary>Серверт бүртгэлтэй хуудасны нийт тоо.</summary>
        [JsonPropertyName("sheet_count")] public int SheetCount { get; set; }
        /// <summary>Хэрэглэгч admin/senior эсэх — бүгдийг харах боломжтой юу.</summary>
        [JsonPropertyName("is_manager")] public bool IsManager { get; set; }
        /// <summary>mine эсвэл all.</summary>
        [JsonPropertyName("scope")] public string Scope { get; set; }
    }

    /* ================================================================== */
    /*  Өөрчлөлтийн жагсаалт — `list_changes` / `goto_element`             */
    /* ================================================================== */

    /// <summary>Нэг өөрчлөгдсөн элемент.</summary>
    public class ChangeItemDto
    {
        [JsonPropertyName("id")] public long Id { get; set; }
        [JsonPropertyName("category")] public string Category { get; set; }
        [JsonPropertyName("category_label")] public string CategoryLabel { get; set; }
        [JsonPropertyName("type_name")] public string TypeName { get; set; }
        [JsonPropertyName("level")] public string Level { get; set; }
        /// <summary>added | modified | deleted</summary>
        [JsonPropertyName("kind")] public string Kind { get; set; }
        [JsonPropertyName("kind_label")] public string KindLabel { get; set; }
        /// <summary>Revit-ийн гүйлгээний ТҮҮХИЙ нэр — орчуулагдаагүй.</summary>
        [JsonPropertyName("op")] public string Op { get; set; }
        [JsonPropertyName("op_label")] public string OpLabel { get; set; }
        [JsonPropertyName("at")] public string At { get; set; }
        [JsonPropertyName("view_specific")] public bool ViewSpecific { get; set; }
        /// <summary>Хэдэн удаа хөндсөн — ЗӨВХӨН самбарт, тайланд ОРОХГҮЙ.</summary>
        [JsonPropertyName("hits")] public int Hits { get; set; }
    }

    public class ChangeGroupDto
    {
        [JsonPropertyName("key")] public string Key { get; set; }
        [JsonPropertyName("label")] public string Label { get; set; }
        [JsonPropertyName("count")] public int Count { get; set; }
        /// <summary>Багтаагүй мөрийн тоо — «+N» гэж харуулна.</summary>
        [JsonPropertyName("more")] public int More { get; set; }
        [JsonPropertyName("items")] public List<ChangeItemDto> Items { get; set; }
            = new List<ChangeItemDto>();
    }

    public class ChangesResult
    {
        [JsonPropertyName("baseline_at")] public string BaselineAt { get; set; }
        [JsonPropertyName("groups")] public List<ChangeGroupDto> Groups { get; set; }
            = new List<ChangeGroupDto>();
        /// <summary>Хүнд утга учиртай, жагсаалтад гарсан элементийн тоо.</summary>
        [JsonPropertyName("visible_total")] public int VisibleTotal { get; set; }
        /// <summary>Revit-ийн мэдэгдсэн НИЙТ тоо — дотоод элементүүд ч оруулаад.</summary>
        [JsonPropertyName("raw_total")] public int RawTotal { get; set; }
        /// <summary>Нийт хөндөлт — «эргэлт»-ийг тооцоход.  Тайланд ОРОХГҮЙ.</summary>
        [JsonPropertyName("total_touches")] public int TotalTouches { get; set; }
        /// <summary>Дотоод/туслах гэж шүүгдсэн тоо.</summary>
        [JsonPropertyName("hidden_total")] public int HiddenTotal { get; set; }
        /// <summary>Загварт байхгүй болсон (устгагдсан) элементийн тоо.</summary>
        [JsonPropertyName("gone_total")] public int GoneTotal { get; set; }
        [JsonPropertyName("truncated")] public bool Truncated { get; set; }
        [JsonPropertyName("meta_truncated")] public bool MetaTruncated { get; set; }
        [JsonPropertyName("warnings")] public List<string> Warnings { get; set; }
            = new List<string>();
    }

    public class GotoResult
    {
        [JsonPropertyName("ok")] public bool Ok { get; set; }
        [JsonPropertyName("view_name")] public string ViewName { get; set; }
        [JsonPropertyName("sheet_number")] public string SheetNumber { get; set; }
        [JsonPropertyName("sheet_name")] public string SheetName { get; set; }
        [JsonPropertyName("switched")] public bool Switched { get; set; }
        [JsonPropertyName("zoomed")] public bool Zoomed { get; set; }
        [JsonPropertyName("how")] public string How { get; set; }
        [JsonPropertyName("views_checked")] public int ViewsChecked { get; set; }
        [JsonPropertyName("partial")] public bool Partial { get; set; }
    }

    public class DraftResult
    {
        [JsonPropertyName("task_id")] public int TaskId { get; set; }
        [JsonPropertyName("current_percent")] public double CurrentPercent { get; set; }
        [JsonPropertyName("suggested_percent")] public double? SuggestedPercent { get; set; }
        [JsonPropertyName("derived_percent")] public double? DerivedPercent { get; set; }
        [JsonPropertyName("ceiling")] public double Ceiling { get; set; }
        [JsonPropertyName("percent_basis")] public string PercentBasis { get; set; }
        [JsonPropertyName("basis_detail")] public string BasisDetail { get; set; }
        [JsonPropertyName("note_mn")] public string NoteMn { get; set; }
        [JsonPropertyName("ai_model")] public string AiModel { get; set; }
        [JsonPropertyName("ai_prompt_version")] public string AiPromptVersion { get; set; }
        [JsonPropertyName("fallback")] public bool Fallback { get; set; }
        [JsonPropertyName("warnings")] public List<string> Warnings { get; set; } = new List<string>();
    }

    public class SubmissionResult
    {
        [JsonPropertyName("submission_id")] public int SubmissionId { get; set; }
        [JsonPropertyName("entry_id")] public int EntryId { get; set; }
        [JsonPropertyName("status")] public string Status { get; set; }
        [JsonPropertyName("percentage")] public double Percentage { get; set; }
        [JsonPropertyName("awaiting_approver")] public bool AwaitingApprover { get; set; }
        [JsonPropertyName("duplicate")] public bool Duplicate { get; set; }
        [JsonPropertyName("message")] public string Message { get; set; }
    }

    public class BindingSaveItem
    {
        [JsonPropertyName("sheet_uid")] public string SheetUid { get; set; }
        [JsonPropertyName("drawing_id")] public int? DrawingId { get; set; }
        [JsonPropertyName("task_id")] public int? TaskId { get; set; }
        [JsonPropertyName("status")] public string Status { get; set; } = "confirmed";
    }

    public class BindingSaveResult
    {
        [JsonPropertyName("saved")] public int Saved { get; set; }
        [JsonPropertyName("ignored")] public int Ignored { get; set; }
    }

    /* ---------------- Багийн контекст (2-1) ------------------------ */

    /// <summary>
    /// Шатны НЭР ДЭВШИГЧ — сонгогчийг урьдчилан тэмдэглэхэд.
    ///
    /// ⚠️ ЭНЭ БОЛ ШИЙДВЭР БИШ.  `TeamContextResult.TeamCode` нь шийдвэр;
    /// эдгээр нь «сервер юу харсан бэ» гэдгийг л хэлнэ.  Баталгаажуулагч
    /// шатууд (`sheet_prefix`, `behavior`) ЗӨВХӨН энд гарч ирнэ.
    /// </summary>
    public class TeamCandidateDto
    {
        [JsonPropertyName("team_code")] public string TeamCode { get; set; }
        [JsonPropertyName("source")] public string Source { get; set; }
        [JsonPropertyName("confidence")] public double Confidence { get; set; }
    }

    /// <summary>
    /// АМЬД РОСТЕРЫН нэг мөр — `teams` хүснэгтээс шууд.
    ///
    /// ⚠️ Клиент багийн ТООГ (8 / 9 / 11) ХЭЗЭЭ Ч хатуу бичихгүй, мөн
    /// дүрмийн багцтай багуудын ЖАГСААЛТЫГ хадгалахгүй (⛔ хориг 11).
    /// Сонгогч нь ЭНЭ жагсаалтаас л бүрдэнэ.
    /// </summary>
    public class TeamRosterDto
    {
        [JsonPropertyName("code")] public string Code { get; set; }
        [JsonPropertyName("name_mn")] public string NameMn { get; set; }
        [JsonPropertyName("sort_order")] public int SortOrder { get; set; }
    }

    /// <summary>
    /// `GET /api/revit/team-context` ба `POST /api/revit/team-context/verify`
    /// -ийн хариу.  ХОЁУЛАА ЯГ ИЖИЛ хэлбэртэй (сервер `teamView(...)`-ыг
    /// хуваалцдаг), verify нь дээр нь `verified_via` + `sticky` нэмнэ.
    /// </summary>
    public class TeamContextResult
    {
        [JsonPropertyName("team_code")] public string TeamCode { get; set; }
        [JsonPropertyName("team_confidence")] public double Confidence { get; set; }
        [JsonPropertyName("team_source")] public string Source { get; set; }
        [JsonPropertyName("team_last_verified")] public string LastVerified { get; set; }

        /// <summary>null = зөрчилгүй.  Хоёр шат ижил итгэлцлээр зөрсөн үед л дүүрнэ.</summary>
        [JsonPropertyName("conflict")] public List<string> Conflict { get; set; }

        [JsonPropertyName("candidates")] public List<TeamCandidateDto> Candidates { get; set; }
            = new List<TeamCandidateDto>();

        /// <summary>
        /// `GLOBAL` · `COMPANY` · `TEAM` · `PROJECT`.  «TEAM» байгаа эсэх нь
        /// клиентийн ЦОРЫН ГАНЦ «дүрмийн багцтай юу» дохио.
        /// </summary>
        [JsonPropertyName("scopes")] public List<string> Scopes { get; set; }
            = new List<string>();

        /// <summary>
        /// ГУРВАН УТГАТАЙ: `true` = багцтай, `false` = ЭНЭ багт багц алга,
        /// `null` = дүрмийн бүртгэл бүхэлдээ хоосон.
        ///
        /// ⚠️ Chip нь `Scopes`-оор явна, ҮҮГЭЭР БИШ.  Хоёр нь ижил зүйлийг
        /// хэлдэг ч `null` тохиолдолд `Scopes` нь «TEAM»-ыг АГУУЛНА (сервер
        /// шүүлт хийхгүй) — өөрөөр хэлбэл дүрмийн бүртгэл хоосон байхад БҮХ
        /// багийг «дүрмийн багцгүй» гэж ХУДЛАА шошгохгүй.
        /// </summary>
        [JsonPropertyName("compliance_enabled")] public bool? ComplianceEnabled { get; set; }

        [JsonPropertyName("attribution_id")] public long? AttributionId { get; set; }

        /// <summary>АМЬД РОСТЕР — `teams`-ийн БҮХ мөр (өнөөдөр 11).</summary>
        [JsonPropertyName("teams")] public List<TeamRosterDto> Teams { get; set; }
            = new List<TeamRosterDto>();

        /// <summary>ЗӨВХӨН verify-д: `membership` эсвэл `manager`.</summary>
        [JsonPropertyName("verified_via")] public string VerifiedVia { get; set; }

        /// <summary>ЗӨВХӨН verify-д: баримт дээр наалдсан эсэх.</summary>
        [JsonPropertyName("sticky")] public bool Sticky { get; set; }
    }

    /* ================================================================== */

    /// <summary>
    /// `/api/revit/*`-ийн клиент.
    ///
    /// ⚠️ Энэ нь бүх AI-г СЕРВЕР ТАЛД үлдээдэг.  Add-in дотор ямар ч LLM
    /// түлхүүр байхгүй — `POST /draft` нь Cloudflare Workers AI-гаар монгол
    /// тэмдэглэл бичээд буцаадаг.  Ингэснээр:
    ///   • ажилтны компьютерт API түлхүүр тархахгүй
    ///   • загвар/өртөг солих нь нэг deploy, 50 суулгац биш
    ///   • add-in офлайн үед ч зөвхөн интернэт л дутна, түлхүүр биш
    /// </summary>
    public static class RevitApi
    {
        private static HttpRequestMessage Req(HttpMethod m, string host, string path, string token,
            object payload = null)
        {
            var req = new HttpRequestMessage(m, ApiClient.Url(host, path));
            req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
            if (payload != null) req.Content = ApiClient.JsonContent(payload);
            return req;
        }

        private static async Task<T> SendAsync<T>(HttpRequestMessage req) where T : class
        {
            using (req)
            using (HttpResponseMessage res = await ApiClient.Http.SendAsync(req).ConfigureAwait(false))
            {
                string body = await res.Content.ReadAsStringAsync().ConfigureAwait(false);
                if (!res.IsSuccessStatusCode) throw ApiClient.Error(res, body);
                return JsonSerializer.Deserialize<T>(body, ApiClient.ReadOptions);
            }
        }

        /// <summary>POST /api/revit/handshake — файлыг төсөлтэй холбож санал авна.</summary>
        public static Task<HandshakeResult> HandshakeAsync(
            string host, string token, int projectId, string docUid, string fileName,
            string revitVersion, bool isLink, IEnumerable<RevitTools.SheetDto> sheets)
        {
            var payload = new
            {
                project_id = projectId,
                doc_uid = docUid,
                uid_source = "project_info",
                file_name = fileName,
                revit_version = revitVersion,
                is_link = isLink,
                sheets,
            };
            return SendAsync<HandshakeResult>(Req(HttpMethod.Post, host, "/api/revit/handshake", token, payload));
        }

        /// <summary>PUT /api/revit/bindings — саналыг батлаж, дэд жагсаалт үүсгэнэ.</summary>
        public static Task<BindingSaveResult> SaveBindingsAsync(
            string host, string token, int documentId, IEnumerable<BindingSaveItem> items,
            bool seedChecklist)
        {
            var payload = new
            {
                revit_document_id = documentId,
                items,
                seed_checklist = seedChecklist,
            };
            return SendAsync<BindingSaveResult>(Req(HttpMethod.Put, host, "/api/revit/bindings", token, payload));
        }

        /// <summary>GET /api/revit/context — панелийн унших гарц.</summary>
        public static Task<ContextResult> GetContextAsync(
            string host, string token, string docUid, int? projectId, bool allScope = false)
        {
            string q = "/api/revit/context?doc_uid=" + Uri.EscapeDataString(docUid ?? string.Empty);
            if (projectId.HasValue) q += "&project_id=" + projectId.Value;
            // Серверт энэ хүсэлтийг зөвхөн admin/senior хүлээж авна; бусдад
            // чимээгүй mine болж буцна.
            if (allScope) q += "&scope=all";
            return SendAsync<ContextResult>(Req(HttpMethod.Get, host, q, token));
        }

        /* ---------------- Багийн контекст (2-1) ------------------------ */

        /// <summary>
        /// БОГИНО ХУГАЦААТ дуудлага — `AiHttp.Http` (20 с) дээр, өөрийн
        /// `CancellationTokenSource`-оор дахин хязгаарлагдсан.
        ///
        /// ⚠️ `ApiClient.Http`-ЫГ ХЭРЭГЛЭХГҮЙ: тэр нь 20k мөрийн QTO push-д
        /// зориулсан 180 секунд (`ApiClient.cs:56`).  Самбарын нэг chip
        /// гурван минут «дүүжлэгдэх» нь R7-ийн зөрчил.
        ///
        /// ⚠️ `AiHttp.SendAsync`-ЫГ мөн дуудахгүй — тэр нь дундын доройтлын
        /// тоолуурыг хөдөлгөдөг ба самбарын chip нийцлийн давхаргын төлөвийг
        /// гуйвуулах ЁСГҮЙ.  Зөвхөн ТЭЭВРИЙГ нь хуваалцана
        /// (`ApiClient.PostHealthAsync`-ийн ижил шийдвэр).
        /// </summary>
        private static async Task<T> SendShortAsync<T>(HttpRequestMessage req, int timeoutSec)
            where T : class
        {
            using (req)
            using (var cts = new CancellationTokenSource(TimeSpan.FromSeconds(timeoutSec)))
            using (HttpResponseMessage res =
                await AiHttp.Http.SendAsync(req, cts.Token).ConfigureAwait(false))
            {
                string body = await res.Content.ReadAsStringAsync().ConfigureAwait(false);
                if (!res.IsSuccessStatusCode) throw ApiClient.Error(res, body);
                return JsonSerializer.Deserialize<T>(body, ApiClient.ReadOptions);
            }
        }

        /// <summary>
        /// GET /api/revit/team-context — самбарын chip-ийн ЦОРЫН ГАНЦ эх сурвалж.
        ///
        /// ⚠️ Сервер ХЭЗЭЭ Ч 404 өгөхгүй: бүртгэгдээгүй баримт дээр ч шат нь
        /// хэрэглэгчийн профайл хүртэл уруудаж, хамгийн муудаа
        /// `team_source: "uncertain"` буцаана.  Тиймээс энэ дуудлага
        /// «файл холбогдоогүй» гэсэн шалтгаанаар алгасагдах ЁСГҮЙ.
        ///
        /// ⚠️ `TeamContext.RequestTimeoutSec` (5 с) — chip нь блоклохгүй
        /// чимэглэл, түүнээс болж хүн хүлээх ёсгүй.
        ///
        /// ⚠️ `hintTeamCode` нь ЗӨВХӨН НОТОЛГОО.  Сервер түүнийг ЭХО хийхээс
        /// цааш ЮУ Ч хийхгүй — шийдвэрт нөлөөлөхгүй.  `settings.json`-ыг
        /// тухайн Windows хэрэглэгч засаж чаддаг тул тэр нь эрхийн эх
        /// сурвалж БОЛОХГҮЙ; хүлээн зөвшөөрөх цорын ганц зам нь `verify`.
        /// </summary>
        public static Task<TeamContextResult> GetTeamContextAsync(
            string host, string token, string docUid, int? projectId, string hintTeamCode = null)
        {
            string q = "/api/revit/team-context?doc_uid=" +
                       Uri.EscapeDataString(docUid ?? string.Empty);
            if (projectId.HasValue) q += "&project_id=" + projectId.Value;
            if (!string.IsNullOrWhiteSpace(hintTeamCode))
                q += "&hint_team_code=" + Uri.EscapeDataString(hintTeamCode.Trim());
            return SendShortAsync<TeamContextResult>(
                Req(HttpMethod.Get, host, q, token), TeamContext.RequestTimeoutSec);
        }

        /// <summary>
        /// POST /api/revit/team-context/verify — §73-ын БУЦААГДАХ залруулга.
        ///
        /// ⚠️ Сервер `user_teams`-ээр эрхийг шалгана: гишүүн БИШ бөгөөд
        /// менежер ч биш бол 403.  Тиймээс энэ нь «зарлал» биш «хүсэлт» —
        /// клиент өөрийгөө ямар ч багт хамааруулж ЧАДАХГҮЙ.
        ///
        /// ⚠️ `sticky = true` бол сервер `revit_documents.team_code`-ийг
        /// бичих ба залруулга нь ТУХАЙН ФАЙЛ дээр бүх сесст наалдана.
        /// `false` бол зөвхөн одоогийн нээлттэй сесс(үүд)-д.
        ///
        /// ⚠️ `session_uid` дамжуулахгүй: самбар нь `BimEmitter`-ийн сессийн
        /// таних тэмдгийг эзэмшдэггүй.  Сервер `doc_uid`-аас нээлттэй сессийг
        /// өөрөө олдог (`ended_at IS NULL`) тул үр дүн ижил.
        /// </summary>
        public static Task<TeamContextResult> VerifyTeamAsync(
            string host, string token, string docUid, int? projectId,
            string teamCode, bool sticky)
        {
            var payload = new
            {
                doc_uid = docUid,
                project_id = projectId,
                team_code = teamCode,
                sticky,
            };
            return SendShortAsync<TeamContextResult>(
                Req(HttpMethod.Post, host, "/api/revit/team-context/verify", token, payload),
                TeamContext.RequestTimeoutSec);
        }

        /// <summary>POST /api/revit/draft — хувь + монгол тэмдэглэлийн ноорог (юу ч бичихгүй).</summary>
        public static Task<DraftResult> DraftAsync(
            string host, string token, int taskId, IEnumerable<string> sheetUids, object change)
        {
            var payload = new { task_id = taskId, sheet_uids = sheetUids, change };
            return SendAsync<DraftResult>(Req(HttpMethod.Post, host, "/api/revit/draft", token, payload));
        }

        /// <summary>
        /// POST /api/revit/submissions — ЦОРЫН ГАНЦ бичих дуудлага.
        ///
        /// ⚠️ `draftUid` нь idempotency түлхүүр.  Сүлжээ тасарч ДАХИН илгээхэд
        /// ЯГ ИЖИЛ утгыг дамжуулах ёстой — эс бөгөөс хоёр бүртгэл, хоёр оноо
        /// үүснэ.  Тиймээс ноорог үүсэх үед НЭГ УДАА гаргаж, диск дээр хадгална.
        /// </summary>
        public static Task<SubmissionResult> SubmitAsync(
            string host, string token, string draftUid, int taskId, double percentage,
            string notes, string aiNotes, string aiModel, string aiPromptVersion,
            int? revitDocumentId, IEnumerable<string> sheetUids, object change,
            IEnumerable<object> evidence)
        {
            var payload = new
            {
                draft_uid = draftUid,
                confirmed = true,
                task_id = taskId,
                percentage,
                notes,
                ai_notes = aiNotes,
                ai_model = aiModel,
                ai_prompt_version = aiPromptVersion,
                revit_document_id = revitDocumentId,
                sheet_uids = sheetUids,
                change,
                evidence,
            };
            return SendAsync<SubmissionResult>(
                Req(HttpMethod.Post, host, "/api/revit/submissions", token, payload));
        }

        /// <summary>Алдааны биеэс `message`/`error` талбарыг гаргаж хүнд харуулна.</summary>
        public static string FriendlyError(Exception ex)
        {
            if (ex == null) return "Тодорхойгүй алдаа.";

            // Сүлжээ/хугацааны алдаа.  .NET-ийн текст англи («A task was
            // canceled.», «No such host is known.») тул хэрэглэгчид хэзээ ч
            // шууд харуулахгүй — тэр нь юу хийхээ мэдэхгүй үлддэг.
            if (ex is OperationCanceledException)
            {
                return "Сервер хугацаанд нь хариу өгсөнгүй. Интернэт холболтоо " +
                       "шалгаад дахин оролдоно уу (файл том бол хэсэг хугацаа шаардана).";
            }
            if (ex is System.Net.Http.HttpRequestException)
            {
                return "Сервертэй холбогдож чадсангүй. Интернэт холболт болон MGL → Тохиргоо → " +
                       "«Нарийвчилсан тохиргоо» дахь серверийн хаягаа шалгана уу.";
            }

            if (!(ex is ApiException api))
                return string.IsNullOrWhiteSpace(ex.Message) ? ex.GetType().Name : ex.Message;

            string detail = ExtractApiDetail(api);
            string lead = LeadForStatus(api.StatusCode);

            if (string.IsNullOrWhiteSpace(detail))
                return lead;

            // Сервер монголоор хариулсан бол тэр нь өөрөө хамгийн тодорхой.
            if (HasCyrillic(detail))
                return detail;

            // Англи техникийн текстийг хаяхгүй — гэхдээ хойно нь, хаалтад.
            return lead + "\n\n(" + detail + ")";
        }

        /// <summary>
        /// 409 `MANAGED_ROOT` — энэ таск хуваарилагдсан (managed): Revit-ээс root-ийн хувь илгээхгүй, хувийг вэбээс
        /// («Миний ажлууд»-аас өөрийн хэсгээр) бөглөнө.  ДАХИН ОРОЛДОХ БОЛОМЖГҮЙ — ижил тайлан хэзээ ч амжихгүй.
        /// Сервер: `backend/src/lib/taskAllocGate.ts` `managedRootBody` (`retryable:false`).
        /// </summary>
        public static bool IsManagedRoot(Exception ex)
        {
            ApiException api = ex as ApiException;
            if (api == null || api.StatusCode != 409 || api.Message == null) return false;
            // CONVERTED_PART — хуучин бүлгийг хөрвүүлэхэд root-д нэгтгэгдсэн хэсэг (migration 0385): ижил байдлаар дахин оролдох нь утгагүй.
            return api.Message.IndexOf("MANAGED_ROOT", StringComparison.Ordinal) >= 0
                || api.Message.IndexOf("CONVERTED_PART", StringComparison.Ordinal) >= 0;
        }

        /// <summary>HTTP статусын монгол тайлбар — хүн юу хийхээ мэдэх ёстой.</summary>
        private static string LeadForStatus(int status)
        {
            switch (status)
            {
                case 400:
                    return "Сервер хүсэлтийг хүлээж авсангүй — илгээх өгөгдөл дутуу " +
                           "эсвэл буруу байна.";
                case 401:
                    return "Нэвтрэлт хүчингүй болжээ. MGL → Тохиргоо цонхноос дахин нэвтэрнэ үү.";
                case 403:
                    return "Танд энэ үйлдлийг хийх эрх алга. Админаас эрхээ нээлгэнэ үү.";
                case 404:
                    return "Сервер дээрээс холбогдох бичлэг олдсонгүй.";
                case 409:
                    return "Энэ өгөгдөл аль хэдийн илгээгдсэн байна (давхардал үүсээгүй).";
                case 413:
                    return "Илгээх өгөгдөл хэтэрхий их байна — багасгаад дахин оролдоно уу.";
                case 429:
                    return "Хэт олон хүсэлт явлаа. Хэсэг хүлээгээд дахин оролдоно уу.";
                default:
                    return status >= 500
                        ? "Серверт алдаа гарлаа (" + status + "). Хэсэг хүлээгээд дахин оролдоно уу."
                        : "Сервер алдаа буцаалаа (" + status + ").";
            }
        }

        /// <summary>ApiException-ий биеэс `message`/`error` талбарыг гаргаж авна.</summary>
        private static string ExtractApiDetail(ApiException api)
        {
            try
            {
                string body = api.Message;
                int brace = body.IndexOf('{');
                if (brace >= 0)
                {
                    using JsonDocument doc = JsonDocument.Parse(body.Substring(brace));
                    if (doc.RootElement.TryGetProperty("message", out JsonElement m) &&
                        m.ValueKind == JsonValueKind.String)
                        return m.GetString();
                    if (doc.RootElement.TryGetProperty("error", out JsonElement e) &&
                        e.ValueKind == JsonValueKind.String)
                        return e.GetString();
                }
            }
            catch { }
            return null;
        }

        /// <summary>Текст кирилл үсэг агуулж байна уу (= монголоор бичигдсэн).</summary>
        private static bool HasCyrillic(string text)
        {
            if (string.IsNullOrEmpty(text)) return false;
            foreach (char ch in text)
            {
                // U+0400..U+04FF — кирилл блок.  Тэмдэгтийн escape бичихгүй:
                // тоон харьцуулалт нь файлын кодчилолоос хамаарахгүй.
                int cp = ch;
                if (cp >= 0x0400 && cp <= 0x04FF) return true;
            }
            return false;
        }

        /// <summary>
        /// PATCH /api/tasks/checklist/:itemId — дэд жагсаалтын мөрийг тэмдэглэнэ.
        /// Явцын хувь ҮҮНЭЭС тооцогддог тул энэ бол хамгийн чухал бичилт.
        /// </summary>
        public static async Task ToggleChecklistAsync(
            string host, string token, int itemId, bool isDone)
        {
            using HttpRequestMessage req = Req(
                new HttpMethod("PATCH"), host, "/api/tasks/checklist/" + itemId, token,
                new { is_done = isDone });
            using HttpResponseMessage res = await ApiClient.Http.SendAsync(req).ConfigureAwait(false);
            if (!res.IsSuccessStatusCode)
            {
                string body = await res.Content.ReadAsStringAsync().ConfigureAwait(false);
                throw ApiClient.Error(res, body);
            }
        }

        /// <summary>Ноорог бүрт ШИНЭ idempotency түлхүүр.</summary>
        public static string NewDraftUid() => Guid.NewGuid().ToString("N");

        /// <summary>Локал хэрэгслийг дуудаж JSON үр дүнг буцаана (панелийн туслах).</summary>
        /// <summary>
        /// Хэрэгсэл тутмын хугацааны хязгаар (секунд).
        ///
        /// ⚠️ ЯАГААД НЭГ ТОО БОЛОХГҮЙ ВЭ: бүгд 120 секунд байсан тул хурдан
        /// байх ЁСТОЙ хэрэгсэл гацахад хэрэглэгч ХОЁР МИНУТ хоосон хүлээдэг
        /// байв (2026-08-25-ны гомдол).  Хугацаа нь «энэ хэр удах ёстой вэ»
        /// гэдгийг илэрхийлэх ёстой — тэгвэл гацсаныг ЭРТ мэдэрнэ.
        ///
        /// `ChangeTracker` орсны дараа суурь/диff нь O(1) болсон тул тэдэнд
        /// 15 секунд ч илүүдэл.  Харин `isolate_sheet_elements` нь тухайн
        /// хуудсын харагдацуудыг regenerate хийх ёстой (энэ нь ЗАЙЛШГҮЙ —
        /// аль элементийг тусгаарлахыг мэдэхийн тулд) тул урт хэвээр.
        /// </summary>
        private static int TimeoutFor(string tool)
        {
            switch (tool)
            {
                case "capture_baseline":
                case "diff_since_baseline":
                case "get_document_context":
                case "reset_isolation":
                    return 15;
                case "list_sheets":
                    return 30;
                // ⚠️ `list_changes` нь ЗӨВХӨН индексийн лавлагаа хийдэг тул
                // хурдан.  `goto_element` нь харагдац хайх ёстой ба өөрөө 2.5
                // секундын дотоод төсөвтэй — 45 нь тээглэсэн үед л ажиллана.
                case "list_changes":
                    return 25;
                // Дотоод төсөв нь 4 секунд; 30 нь зөвхөн тээглэсэн үед л ажиллана.
                case "change_digest":
                    return 30;
                case "goto_element":
                    return 45;
                // ⚠️ Дотоод төсөв нь 1.5 секунд, дээд тал нь 150 элемент
                //    (`2-3` §3.7).  10 нь зөвхөн тээглэсэн үед л ажиллана.
                //    ⚠️ Өгөгдмөл 120 руу унагаах нь БОЛОХГҮЙ: энэ хэрэгслийг
                //    АРЫН мөчлөг дуудна ба хоёр минутын deadline нь `Gate`-ыг
                //    хэрэглэгчийн ажлын турш барих боломж үүсгэнэ.
                case "collect_rule_inputs":
                    return ComplianceScheduler.CollectTimeoutSec;
                default:
                    // isolate_sheet_elements · capture_view_image — жинхэнэ хүнд.
                    return 120;
            }
        }

        public static JsonElement CallTool(string tool, object args = null)
        {
            string argsJson = args == null ? "{}" : JsonSerializer.Serialize(args);
            ToolCall call = RevitToolBus.Call(tool, argsJson, TimeoutFor(tool));
            if (!call.Success)
                throw new InvalidOperationException(call.Error ?? "Хэрэгсэл амжилтгүй боллоо.");
            using JsonDocument doc = JsonDocument.Parse(
                string.IsNullOrWhiteSpace(call.ResultJson) ? "{}" : call.ResultJson);
            return doc.RootElement.Clone();
        }

        internal static readonly Encoding Utf8 = new UTF8Encoding(false);
    }
}
