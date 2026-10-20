using System;
using System.Collections.Generic;
using System.Text.Json.Serialization;

namespace RevitMcpAddin.Intelligence.Contracts
{
    /* ================================================================== */
    /*  ERP ДААЛГАВРЫН КОНТЕКСТ (§29–32, R-9)                               */
    /*                                                                    */
    /*  ⚠️ D1 руу ХЭЗЭЭ Ч шууд хүрэхгүй — `RevitApi.GetContextAsync`        */
    /*  (нэвтрэлттэй `GET /api/revit/context`) л эх сурвалж.               */
    /*  ⚠️ Явцын хувийг ЗОХИОХГҮЙ: `ProgressEstimate` нь дүрэм байхгүй бол  */
    /*  `PROGRESS_ESTIMATE_UNAVAILABLE`.                                   */
    /* ================================================================== */

    public sealed class RevitTaskItem
    {
        [JsonPropertyName("task_id")] public int TaskId { get; set; }
        [JsonPropertyName("title")] public string Title { get; set; }
        [JsonPropertyName("status")] public string Status { get; set; }
        [JsonPropertyName("priority")] public string Priority { get; set; }
        [JsonPropertyName("due_date")] public string DueDate { get; set; }
        [JsonPropertyName("project_id")] public int? ProjectId { get; set; }
        [JsonPropertyName("project_name")] public string ProjectName { get; set; }
        [JsonPropertyName("drawing_name")] public string DrawingName { get; set; }
        [JsonPropertyName("block_name")] public string BlockName { get; set; }
        [JsonPropertyName("assigned_to_me")] public bool AssignedToMe { get; set; } = true;
        /// <summary>ERP-ийн ХҮНИЙ бичсэн явц (progress_entries) — Revit тооцоогүй.</summary>
        [JsonPropertyName("current_progress")] public double CurrentProgress { get; set; }
        [JsonPropertyName("checklist_done")] public int ChecklistDone { get; set; }
        [JsonPropertyName("checklist_total")] public int ChecklistTotal { get; set; }
        [JsonPropertyName("reported_today")] public bool ReportedToday { get; set; }
        /// <summary>Хуудасны холбоос байвал — `ViewSheet.UniqueId`-ууд (Track 2-ийн түлхүүр).</summary>
        [JsonPropertyName("sheet_uids")] public List<string> SheetUids { get; set; } = new List<string>();
    }

    public enum TaskContextStatus { OK, ERP_OFFLINE, AUTH_REQUIRED, PROJECT_NOT_LINKED, NO_TASKS }

    public sealed class RevitTaskContext
    {
        [JsonPropertyName("schema_version")] public int SchemaVersion { get; set; } = Schema.Version;
        [JsonPropertyName("status")] public TaskContextStatus Status { get; set; }
        [JsonPropertyName("project_id")] public int? ProjectId { get; set; }
        [JsonPropertyName("project_name")] public string ProjectName { get; set; }
        [JsonPropertyName("tasks")] public List<RevitTaskItem> Tasks { get; set; } = new List<RevitTaskItem>();
        [JsonPropertyName("is_manager")] public bool IsManager { get; set; }
        [JsonPropertyName("scope")] public string Scope { get; set; }
        /// <summary>Кэшлэгдсэн бол — хэзээ татсан (§74: хуучин өгөгдлийг «одоогийнх» гэж харуулахгүй).</summary>
        [JsonPropertyName("fetched_at")] public string FetchedAt { get; set; }
        [JsonPropertyName("from_cache")] public bool FromCache { get; set; }
        [JsonPropertyName("error")] public string Error { get; set; }
    }

    public enum InterpretationConfidence { NONE, LOW, MEDIUM, HIGH }

    /// <summary>
    /// Даалгаврын текстээс гаргасан BIM ТААМАГЛАЛ (§30–31).  Шошго нь ҮРГЭЛЖ
    /// `TASK_INTERPRETATION` — загварт биш, ЗАГВАРААС элемент тодорхойлогдтол
    /// энэ бол санал.
    /// </summary>
    public sealed class RevitTaskInterpretation
    {
        [JsonPropertyName("schema_version")] public int SchemaVersion { get; set; } = Schema.Version;
        [JsonPropertyName("label")] public string Label { get; set; } = "TASK_INTERPRETATION";
        [JsonPropertyName("task_id")] public int TaskId { get; set; }
        [JsonPropertyName("target_levels")] public List<string> TargetLevels { get; set; } = new List<string>();
        [JsonPropertyName("target_kinds")] public List<SceneNodeKind> TargetKinds { get; set; } = new List<SceneNodeKind>();
        [JsonPropertyName("target_categories")] public List<string> TargetCategories { get; set; } = new List<string>();
        [JsonPropertyName("target_element_ids")] public List<long> TargetElementIds { get; set; } = new List<long>();
        /// <summary>check | draw | fix | annotate | unknown — үйл үгээс.</summary>
        [JsonPropertyName("intent")] public string Intent { get; set; } = "unknown";
        [JsonPropertyName("confidence")] public InterpretationConfidence Confidence { get; set; }
        [JsonPropertyName("unresolved_terms")] public List<string> UnresolvedTerms { get; set; } = new List<string>();
        /// <summary>DETERMINISTIC_KEYWORDS | LLM_ASSISTED — хэн тайлсан.</summary>
        [JsonPropertyName("interpreter")] public string Interpreter { get; set; } = "DETERMINISTIC_KEYWORDS";
        [JsonPropertyName("query")] public ElementQuery Query { get; set; }
    }

    public sealed class TaskCandidateSet
    {
        [JsonPropertyName("task_id")] public int TaskId { get; set; }
        [JsonPropertyName("scene_version")] public long SceneVersion { get; set; }
        [JsonPropertyName("element_ids")] public List<long> ElementIds { get; set; } = new List<long>();
        [JsonPropertyName("by_kind")] public Dictionary<string, int> ByKind { get; set; } = new Dictionary<string, int>(StringComparer.Ordinal);
        [JsonPropertyName("truncated")] public bool Truncated { get; set; }
        /// <summary>Ажилтан «шалгасан» гэж тэмдэглэсэн id — ХҮНИЙ дохио (R-9).</summary>
        [JsonPropertyName("reviewed_ids")] public List<long> ReviewedIds { get; set; } = new List<long>();
        [JsonPropertyName("issues_open")] public int IssuesOpen { get; set; }
        /// <summary>⚠️ ҮРГЭЛЖ `PROGRESS_ESTIMATE_UNAVAILABLE` — даалгаврын гүйцэтгэлийн дүрэм байхгүй.</summary>
        [JsonPropertyName("progress")] public string Progress { get; set; } = "PROGRESS_ESTIMATE_UNAVAILABLE";
    }
}
