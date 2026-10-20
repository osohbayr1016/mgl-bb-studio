using System;
using System.Collections.Generic;
using System.Text.Json.Serialization;

namespace RevitMcpAddin.Intelligence.Contracts
{
    /* ================================================================== */
    /*  ҮЙЛ АЖИЛЛАГААНЫ ЖУРНАЛ + ТАЙЛАНГИЙН НОТОЛГОО (§26, §33–36, R-8,    */
    /*  R-18, R-19)                                                        */
    /*                                                                    */
    /*  Тайлангийн ӨГҮҮЛБЭР бүр `ReportFact`-аас.  Загвар үг нэмж болно,    */
    /*  БАРИМТ нэмэхгүй.  Менежерийн үзэгдэхүүнд элементийн тоо ОРОХГҮЙ    */
    /*  (эзний 2026-08-26-ны дүрэм, `revitNoteAi.ts`-д тестлэгдсэн).      */
    /* ================================================================== */

    public enum JournalEventKind
    {
        SESSION_STARTED, SESSION_ENDED, DOCUMENT_OPENED, DOCUMENT_CLOSED,
        VIEW_CHANGED, SELECTION_CHANGED, CHANGESET, SCENE_REFRESHED,
        ISSUE_DETECTED, ISSUE_RESOLVED, TASK_SELECTED, TASK_ELEMENT_REVIEWED,
        PROJECT_LINK_CONFIRMED, REPORT_GENERATED, MGL_AI_TURN,
    }

    /// <summary>
    /// Нэг журналын мөр.  ⚠️ Геометр ХЭЗЭЭ Ч энд орохгүй — зөвхөн id, тоо,
    /// категори, нэр.  Локал JSONL-д (`intelligence/journal-<өдөр>.jsonl`)
    /// залгагдана; серверт ЯВАХГҮЙ (`BimEmitter` нь сургалтын үйл явдлыг
    /// тусад нь илгээдэг, энэ нь ТАЙЛАНГИЙН журнал).
    /// </summary>
    public sealed class JournalEvent
    {
        [JsonPropertyName("seq")] public long Seq { get; set; }
        [JsonPropertyName("kind")] public JournalEventKind Kind { get; set; }
        [JsonPropertyName("at")] public string At { get; set; }
        [JsonPropertyName("session_id")] public string SessionId { get; set; }
        [JsonPropertyName("doc_key")] public string DocKey { get; set; }
        [JsonPropertyName("project_id")] public int? ProjectId { get; set; }
        [JsonPropertyName("task_id")] public int? TaskId { get; set; }
        [JsonPropertyName("view_name")] public string ViewName { get; set; }
        [JsonPropertyName("level_name")] public string LevelName { get; set; }
        /// <summary>CHANGESET: категори → {added, modified, deleted}.</summary>
        [JsonPropertyName("category_counts")] public Dictionary<string, int[]> CategoryCounts { get; set; }
        [JsonPropertyName("added")] public int? Added { get; set; }
        [JsonPropertyName("modified")] public int? Modified { get; set; }
        [JsonPropertyName("deleted")] public int? Deleted { get; set; }
        [JsonPropertyName("issue_id")] public string IssueId { get; set; }
        [JsonPropertyName("issue_class")] public IssueClass? IssueClass { get; set; }
        [JsonPropertyName("element_ids")] public List<long> ElementIds { get; set; }
        [JsonPropertyName("note")] public string Note { get; set; }
    }

    public enum ReportFactSource
    {
        REVIT_CHANGESET, SCENE_GRAPH, ERP_TASK, COMPLIANCE_STATE, USER_CONFIRMED, SESSION, ACTIVITY_JOURNAL,
    }

    public enum ReportFactKind
    {
        SESSION_START, SESSION_END, SESSION_DURATION_MIN,
        DOCUMENT, PROJECT, VIEW_TOUCHED, LEVEL_TOUCHED,
        CATEGORY_TOUCHED, ELEMENTS_ADDED, ELEMENTS_MODIFIED, ELEMENTS_DELETED,
        TASK_REFERENCED, TASK_ELEMENTS_CANDIDATE, TASK_ELEMENTS_REVIEWED, TASK_CHECKLIST,
        ISSUE_FOUND, ISSUE_RESOLVED, ISSUES_REMAINING,
        PROGRESS_ESTIMATE,
    }

    /// <summary>Нэг баримт — юу, хэд, хаанаас, хэзээ (R-18).</summary>
    public sealed class ReportFact
    {
        [JsonPropertyName("kind")] public ReportFactKind Kind { get; set; }
        [JsonPropertyName("value")] public string Value { get; set; }
        [JsonPropertyName("number")] public double? Number { get; set; }
        [JsonPropertyName("unit")] public string Unit { get; set; }
        [JsonPropertyName("source")] public ReportFactSource Source { get; set; }
        [JsonPropertyName("observed_at")] public string ObservedAt { get; set; }
        /// <summary>Категори, даалгаврын id гэх мэт нэмэлт хаяг.</summary>
        [JsonPropertyName("subject")] public string Subject { get; set; }
        /// <summary>Журналын `seq`-үүд — «энэ тоо хаанаас гарав» (§62).</summary>
        [JsonPropertyName("evidence_seqs")] public List<long> EvidenceSeqs { get; set; } = new List<long>();
        /// <summary>true = ЭЛЕМЕНТИЙН ТОО — менежерийн тайланд ОРОХГҮЙ (R-8).</summary>
        [JsonPropertyName("is_element_count")] public bool IsElementCount { get; set; }
    }

    /// <summary>Хэнд зориулсан тайлан — үзэгдэхүүн энэ тугаар шүүгдэнэ.</summary>
    public enum ReportAudience { TECHNICAL_SELF_REPORT, TEAM_TASK_REPORT, MANAGER_REPORT }

    public enum ReportPeriodKind { TODAY, THIS_SESSION, TASK, ISSUES }

    public sealed class RevitReportEvidence
    {
        [JsonPropertyName("schema_version")] public int SchemaVersion { get; set; } = Schema.Version;
        [JsonPropertyName("period")] public ReportPeriodKind Period { get; set; }
        [JsonPropertyName("period_start")] public string PeriodStart { get; set; }
        [JsonPropertyName("period_end")] public string PeriodEnd { get; set; }
        [JsonPropertyName("doc_key")] public string DocKey { get; set; }
        [JsonPropertyName("document_title")] public string DocumentTitle { get; set; }
        [JsonPropertyName("project_id")] public int? ProjectId { get; set; }
        [JsonPropertyName("project_name")] public string ProjectName { get; set; }
        [JsonPropertyName("task_id")] public int? TaskId { get; set; }
        [JsonPropertyName("facts")] public List<ReportFact> Facts { get; set; } = new List<ReportFact>();
        /// <summary>Нотолгоо ДУТУУ бол яагаад (`ERP_OFFLINE`, `NO_CHANGESETS` …) — «хийсэн зүйл алга» БИШ.</summary>
        [JsonPropertyName("gaps")] public List<string> Gaps { get; set; } = new List<string>();
        [JsonPropertyName("generated_at")] public string GeneratedAt { get; set; }
    }

    /// <summary>Тайлангийн ГАРАЛТ — детерминист; загвар зөвхөн `WordedMn`-ийг сайжруулж болно.</summary>
    public sealed class RevitReport
    {
        [JsonPropertyName("audience")] public ReportAudience Audience { get; set; }
        [JsonPropertyName("period")] public ReportPeriodKind Period { get; set; }
        [JsonPropertyName("title_mn")] public string TitleMn { get; set; }
        [JsonPropertyName("lines_mn")] public List<string> LinesMn { get; set; } = new List<string>();
        /// <summary>Мөр бүрийн баримтын индекс `Evidence.Facts` дотор — мөр = баримт.</summary>
        [JsonPropertyName("line_facts")] public List<List<int>> LineFacts { get; set; } = new List<List<int>>();
        [JsonPropertyName("evidence")] public RevitReportEvidence Evidence { get; set; }
        /// <summary>DETERMINISTIC | MGL_AI_WORDED — загвар үглэсэн эсэх.</summary>
        [JsonPropertyName("rendering")] public string Rendering { get; set; } = "DETERMINISTIC";
        [JsonPropertyName("preview_only")] public bool PreviewOnly { get; set; } = true;
    }
}
