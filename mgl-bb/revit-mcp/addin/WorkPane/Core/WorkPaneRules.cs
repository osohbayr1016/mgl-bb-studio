using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace RevitMcpAddin.WorkPane.Core
{
    /* ================================================================== */
    /*  «MGL ажил» самбарын ЦЭВЭР дүрэм (Revit work tracking MVP,           */
    /*  2026-09-29).  Revit, WPF, сүлжээ, диск ХӨНДӨХГҮЙ —                   */
    /*  `revit-mcp/tests/WorkPane.Tests` шууд эмхэтгэнэ.                     */
    /*                                                                      */
    /*  Хоёр том шийдвэр энд амьдарна:                                      */
    /*   1. Таскийг ХЭЗЭЭ автоматаар сонгох — зөвхөн ил нотолгоотой үед     */
    /*      (брифийн «нэг таск тодорхой бол хэрэглэ, сул таамаглалаар       */
    /*      хэзээ ч бүү оноо»).                                             */
    /*   2. Хувь илгээхийн өмнөх шалгалт — серверийн `revitProgress.ts`-ийн  */
    /*      ИХЭР (99-ийн тааз, ухралтгүй, 100 = зөвхөн ил «хаах»).           */
    /* ================================================================== */

    /// <summary>`GET /api/revit/work-context`-ийн хариу (`routes/revit.ts`).</summary>
    public sealed class WorkContextDto
    {
        [JsonPropertyName("me")] public MeDto Me { get; set; }
        [JsonPropertyName("document")] public WorkDocumentDto Document { get; set; }
        /// <summary>hint | single | my_tasks | null</summary>
        [JsonPropertyName("resolved_by")] public string ResolvedBy { get; set; }
        [JsonPropertyName("ambiguous")] public bool Ambiguous { get; set; }
        [JsonPropertyName("registrations")] public List<RegistrationDto> Registrations { get; set; } = new List<RegistrationDto>();
        [JsonPropertyName("doc_code")] public string DocCode { get; set; }
        [JsonPropertyName("suggestions")] public List<SuggestionDto> Suggestions { get; set; } = new List<SuggestionDto>();
        [JsonPropertyName("project")] public WorkProjectDto Project { get; set; }
        [JsonPropertyName("tasks")] public List<WorkTaskDto> Tasks { get; set; } = new List<WorkTaskDto>();
        [JsonPropertyName("ceiling")] public double Ceiling { get; set; } = 99;
        [JsonPropertyName("completion_questions")] public List<CompletionQuestionDto> CompletionQuestions { get; set; } = new List<CompletionQuestionDto>();
    }

    public sealed class MeDto
    {
        [JsonPropertyName("id")] public int Id { get; set; }
        [JsonPropertyName("role")] public string Role { get; set; }
        [JsonPropertyName("is_manager")] public bool IsManager { get; set; }
    }

    public sealed class WorkDocumentDto
    {
        [JsonPropertyName("revit_document_id")] public int RevitDocumentId { get; set; }
        [JsonPropertyName("project_id")] public int ProjectId { get; set; }
        [JsonPropertyName("project_name")] public string ProjectName { get; set; }
        [JsonPropertyName("project_status")] public string ProjectStatus { get; set; }
        [JsonPropertyName("file_name")] public string FileName { get; set; }
    }

    public sealed class RegistrationDto
    {
        [JsonPropertyName("revit_document_id")] public int RevitDocumentId { get; set; }
        [JsonPropertyName("project_id")] public int ProjectId { get; set; }
        [JsonPropertyName("project_name")] public string ProjectName { get; set; }
        [JsonPropertyName("project_status")] public string ProjectStatus { get; set; }
        public string Label => ProjectName ?? ("Төсөл #" + ProjectId);
    }

    public sealed class SuggestionDto
    {
        [JsonPropertyName("project_id")] public int ProjectId { get; set; }
        [JsonPropertyName("project_name")] public string ProjectName { get; set; }
        /// <summary>code | my_tasks</summary>
        [JsonPropertyName("reason")] public string Reason { get; set; }
        [JsonPropertyName("open_tasks")] public int OpenTasks { get; set; }

        public string Label =>
            (ProjectName ?? ("Төсөл #" + ProjectId)) +
            (OpenTasks > 0 ? "  ·  таны " + OpenTasks + " таск" : "") +
            (Reason == "code" ? "  ·  код таарсан" : "");
    }

    public sealed class WorkProjectDto
    {
        [JsonPropertyName("id")] public int Id { get; set; }
        [JsonPropertyName("name")] public string Name { get; set; }
        [JsonPropertyName("status")] public string Status { get; set; }
        /// <summary>tasks | hours</summary>
        [JsonPropertyName("progress_mode")] public string ProgressMode { get; set; }
    }

    public sealed class WorkTaskDto
    {
        [JsonPropertyName("task_id")] public int TaskId { get; set; }
        [JsonPropertyName("task_name")] public string TaskName { get; set; }
        [JsonPropertyName("drawing_name")] public string DrawingName { get; set; }
        [JsonPropertyName("block_name")] public string BlockName { get; set; }
        [JsonPropertyName("current_progress")] public double CurrentProgress { get; set; }
        /// <summary>tasks | hours</summary>
        [JsonPropertyName("progress_mode")] public string ProgressMode { get; set; }
        [JsonPropertyName("reported_today")] public bool ReportedToday { get; set; }
        [JsonPropertyName("marked_today")] public bool MarkedToday { get; set; }

        public bool IsHoursMode => string.Equals(ProgressMode, "hours", StringComparison.Ordinal);

        /// <summary>Сонгогчийн мөр — «Блок · Зураг · Таск  (40%)».</summary>
        public string Label
        {
            get
            {
                var parts = new List<string>();
                if (!string.IsNullOrWhiteSpace(BlockName)) parts.Add(BlockName.Trim());
                if (!string.IsNullOrWhiteSpace(DrawingName)) parts.Add(DrawingName.Trim());
                parts.Add(string.IsNullOrWhiteSpace(TaskName) ? "Таск #" + TaskId : TaskName.Trim());
                string tail = IsHoursMode
                    ? "  (засвар" + (MarkedToday ? ", өнөөдөр ✓" : "") + ")"
                    : "  (" + WorkPaneRules.Pct(CurrentProgress) + "%" + (ReportedToday ? ", өнөөдөр ✓" : "") + ")";
                return string.Join(" · ", parts) + tail;
            }
        }
    }

    public sealed class CompletionQuestionDto
    {
        [JsonPropertyName("id")] public string Id { get; set; }
        [JsonPropertyName("text")] public string Text { get; set; }
    }

    /* ------------------------------------------------------------------ */

    /// <summary>Самбар таскийн сонголтыг юу хийх вэ.</summary>
    public enum TaskDecisionKind
    {
        /// <summary>Төсөлд танд нээлттэй таск алга.</summary>
        NoTasks,
        /// <summary>Хост аль хэдийн ЭНЭ төслийн нээлттэй таск дээр — хөндөхгүй.</summary>
        KeepCurrent,
        /// <summary>Ажилтны ӨӨРИЙН өмнөх сонголт (хостын санамж) — сэргээнэ.</summary>
        Restore,
        /// <summary>Баталгаатай төсөлд ГАНЦ нээлттэй таск — автоматаар, ил тэмдэглэлтэй.</summary>
        AutoSingle,
        /// <summary>Хэрэглэгч сонгоно.</summary>
        NeedsChoice,
    }

    public sealed class TaskDecision
    {
        public TaskDecisionKind Kind { get; set; }
        /// <summary>Сонгох таск (KeepCurrent / Restore / AutoSingle үед).</summary>
        public int? TaskId { get; set; }
        /// <summary>
        /// Хост одоо тоолж буй таск энэ төслийн НЭЭЛТТЭЙ жагсаалтад АЛГА (дууссан,
        /// өөр хүнд шилжсэн, өөр төслийнх) — самбар `ClearTask` дуудаж, тоололтыг
        /// зогсооно.  Дууссан таск дээр цаг үргэлжлэн тоологдох ёсгүй.
        /// </summary>
        public bool ClearStale { get; set; }
    }

    public enum PercentCheckCode
    {
        Ok,
        Empty,
        NotANumber,
        /// <summary>Одоогийн явцаас бага — сервер 409 өгнө.</summary>
        BelowCurrent,
        /// <summary>99-өөс их (хаахгүй бол) / 100-аас их.</summary>
        AboveCeiling,
    }

    /// <summary>Илгээгдээгүй тайлангийн мөр — самбарын «ИЛГЭЭГДЭЭГҮЙ ТАЙЛАН» хэсэг.</summary>
    public enum OutboxLineKind
    {
        /// <summary>Дараалалд, сүлжээтэй — хэдэн секундэд илгээгдэнэ.</summary>
        Sending,
        /// <summary>Дараалалд, сүлжээгүй — холболт сэргэхэд илгээгдэнэ.</summary>
        Offline,
        /// <summary>Дараалалд, токен хүчингүй — дахин нэвтэрсний дараа илгээгдэнэ.</summary>
        NeedsLogin,
        /// <summary>Сервер ТОДОРХОЙ татгалзсан — текст хадгалагдсан, ажилтан шийднэ.</summary>
        Rejected,
    }

    public static class WorkPaneRules
    {
        /// <summary>Серверийн `CEILING` (машины санал / өдрийн тайлангийн дээд).</summary>
        public const double Ceiling = 99;

        /// <summary>Серверийн `COMPLETE` — зөвхөн ил «хаах» үйлдлээр.</summary>
        public const double Complete = 100;

        /// <summary>
        /// Таскийн сонголтын шийдвэр.
        ///
        /// ⚠️ АВТОМАТ СОНГОЛТ ЗӨВХӨН ХОЁР ҮЕД:
        ///   (1) ажилтны ӨӨРИЙН өмнөх сонголт (хостын санамж) нээлттэй хэвээр;
        ///   (2) төсөл нь СЕРВЕРИЙН бүртгэлээр БАТАЛГААТАЙ (`single` / `hint`) ба
        ///       танд тэр төсөлд ЯГ НЭГ нээлттэй таск бий — самбар «автоматаар
        ///       сонгогдлоо» гэж ил хэлнэ.
        ///   `my_tasks` (олон бүртгэлээс дүгнэсэн) дээр ГАНЦ таск ч автоматаар
        ///   сонгогдохгүй — тэр нь таамаглал.  Хэзээ ч «эхний» таскийг сонгохгүй.
        /// </summary>
        public static TaskDecision DecideTask(
            IReadOnlyList<int> openTaskIds,
            int? currentTaskId,
            bool currentIsThisProject,
            int? rememberedTaskId,
            string resolvedBy)
        {
            var ids = openTaskIds ?? Array.Empty<int>();
            bool currentOpen = currentTaskId.HasValue && ids.Contains(currentTaskId.Value);
            // Хост энэ төсөл дээр тоолж байгаа ч таск нь нээлттэй жагсаалтад алга.
            bool stale = currentIsThisProject && currentTaskId.HasValue && !currentOpen;

            if (ids.Count == 0)
                return new TaskDecision { Kind = TaskDecisionKind.NoTasks, ClearStale = stale };
            if (currentIsThisProject && currentOpen)
                return new TaskDecision { Kind = TaskDecisionKind.KeepCurrent, TaskId = currentTaskId };
            if (rememberedTaskId.HasValue && ids.Contains(rememberedTaskId.Value))
                return new TaskDecision { Kind = TaskDecisionKind.Restore, TaskId = rememberedTaskId, ClearStale = stale };
            bool confirmedProject = resolvedBy == "single" || resolvedBy == "hint";
            if (ids.Count == 1 && confirmedProject)
                return new TaskDecision { Kind = TaskDecisionKind.AutoSingle, TaskId = ids[0], ClearStale = stale };
            return new TaskDecision { Kind = TaskDecisionKind.NeedsChoice, ClearStale = stale };
        }

        /// <summary>
        /// Хувийг шалгана — `backend/src/lib/revitProgress.ts`
        /// `verifySubmittedPercent`-ийн ИХЭР (сервер эцсийн шийдвэр гаргана; энэ
        /// нь зөвхөн илгээхээс ӨМНӨ ойлгомжтой мессеж өгөх).
        /// ⚠️ Таслалыг ЦЭГ болгоно: монгол гарнаас «45,5» гэж бичихэд
        ///    InvariantCulture мянгатын тусгаарлагч гэж 455 болгодог (AssistantPane-ийн
        ///    олдсон алдаа).
        /// </summary>
        public static PercentCheckCode CheckPercent(string raw, double current, bool completing, out double pct)
        {
            pct = 0;
            if (completing)
            {
                pct = Complete;
                return current >= Complete ? PercentCheckCode.AboveCeiling : PercentCheckCode.Ok;
            }
            string s = (raw ?? string.Empty).Trim().Replace(',', '.').TrimEnd('%').Trim();
            if (s.Length == 0) return PercentCheckCode.Empty;
            if (!double.TryParse(s, NumberStyles.Float, CultureInfo.InvariantCulture, out pct) ||
                double.IsNaN(pct) || double.IsInfinity(pct))
            {
                pct = 0;
                return PercentCheckCode.NotANumber;
            }
            if (pct > Ceiling) return PercentCheckCode.AboveCeiling;
            if (pct < Clamp(current)) return PercentCheckCode.BelowCurrent;
            return PercentCheckCode.Ok;
        }

        /// <summary>Хариулаагүй (хоосон) асуултуудын ТЕКСТ — серверийн `missing`-ийн ихэр.</summary>
        public static List<string> MissingAnswers(
            IEnumerable<CompletionQuestionDto> questions, IDictionary<string, string> answers)
        {
            var missing = new List<string>();
            foreach (CompletionQuestionDto q in questions ?? Enumerable.Empty<CompletionQuestionDto>())
            {
                if (q == null || string.IsNullOrEmpty(q.Id)) continue;
                string a;
                if (answers == null || !answers.TryGetValue(q.Id, out a) || string.IsNullOrWhiteSpace(a))
                    missing.Add(q.Text ?? q.Id);
            }
            return missing;
        }

        /// <summary>
        /// `completion_qa`-ийн JSON — ЗӨВХӨН асуултын id-гаар, тайрсан.  Серверийн
        /// `submitProgressEntry` мөн ижил хэлбэрээр хадгална.
        /// </summary>
        public static string CompletionQaJson(
            IEnumerable<CompletionQuestionDto> questions, IDictionary<string, string> answers)
        {
            var map = new SortedDictionary<string, string>(StringComparer.Ordinal);
            foreach (CompletionQuestionDto q in questions ?? Enumerable.Empty<CompletionQuestionDto>())
            {
                if (q == null || string.IsNullOrEmpty(q.Id)) continue;
                string a = null;
                if (answers != null) answers.TryGetValue(q.Id, out a);
                map[q.Id] = (a ?? string.Empty).Trim();
            }
            return JsonSerializer.Serialize(map);
        }

        /// <summary>
        /// Дарааллын тайлангийн төлөв → самбарын мөр.  `state` нь
        /// `WorkTracking/Core/TrackingModel.cs` `ReportStates`-ийн ИХЭР утга
        /// (pending | failed | sent) — энэ файл тэр төслөөс хамаарахгүй (тестийн
        /// тусгаарлалт).  `sent` → null (харуулахгүй); танигдахгүй утга = дараалалд.
        /// </summary>
        public static OutboxLineKind? OutboxKind(string state, bool online, bool authRequired)
        {
            if (string.Equals(state, "sent", StringComparison.Ordinal)) return null;
            if (string.Equals(state, "failed", StringComparison.Ordinal)) return OutboxLineKind.Rejected;
            if (authRequired) return OutboxLineKind.NeedsLogin;
            return online ? OutboxLineKind.Sending : OutboxLineKind.Offline;
        }

        /// <summary>
        /// «⚠ Илгээгдсэнгүй: Фасад · 60%».  Өөр өдөр бичсэн (офлайн) тайланд
        /// «· 09-28» — аль тайлан болохыг ажилтан таньж, устгах эсэхээ шийднэ.
        /// </summary>
        public static string OutboxHeadline(OutboxLineKind kind, string taskName, int taskId, double pct,
            string reportDate, string today)
        {
            string what = (string.IsNullOrWhiteSpace(taskName) ? "Таск #" + taskId : taskName.Trim()) +
                          " · " + Pct(pct) + "%";
            if (!string.IsNullOrEmpty(reportDate) && reportDate.Length == 10 &&
                !string.Equals(reportDate, today, StringComparison.Ordinal))
                what += " · " + reportDate.Substring(5);
            switch (kind)
            {
                case OutboxLineKind.Rejected: return "⚠ Илгээгдсэнгүй: " + what;
                case OutboxLineKind.NeedsLogin: return "⏳ Дахин нэвтэрсний дараа илгээгдэнэ: " + what;
                case OutboxLineKind.Offline: return "⏳ Сүлжээ сэргэхэд илгээгдэнэ: " + what;
                default: return "⏳ Илгээж байна: " + what;
            }
        }

        /// <summary>«40» / «40.5» — илүүдэл тэггүй.</summary>
        public static string Pct(double v)
        {
            return Math.Round(v, 1).ToString("0.#", CultureInfo.InvariantCulture);
        }

        private static double Clamp(double v)
        {
            if (double.IsNaN(v)) return 0;
            return Math.Min(100, Math.Max(0, v));
        }
    }
}
