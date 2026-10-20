using System;
using System.Collections.Generic;
using System.Text.Json.Serialization;

namespace RevitMcpAddin.Intelligence.Contracts
{
    /* ================================================================== */
    /*  ИРЭЭДҮЙН TYPED БИЧИХ ҮЙЛДЭЛ (§46–50) — ГЭРЭЭ Л, ГҮЙЦЭТГЭЛ БАЙХГҮЙ    */
    /*                                                                    */
    /*  ⚠️ LLM-ийн C#, eval, dynamic код, дурын Revit команд — ХЭЗЭЭ Ч.     */
    /*  Ирээдүйн зам (§49):                                                */
    /*    typed action → схем → эрх → элемент байгаа эсэх → засварлах      */
    /*    эрх (worksharing) → геометрийн preflight → BIM/норм preflight →  */
    /*    preview → хэрэглэгчийн баталгаа → RevitToolBus (ГАНЦ            */
    /*    ExternalEvent, R-2) → Transaction → regenerate → дахин унших →   */
    /*    дахин шалгах → commit | rollback → аудит.                        */
    /*                                                                    */
    /*  Session R-ийн дээд түвшин = PROPOSE, тэр ч гэсэн preview-only.     */
    /* ================================================================== */

    public enum RevitActionKind
    {
        CREATE_WALL, CREATE_FLOOR, MOVE_ELEMENT, SET_PARAMETER, CHANGE_TYPE,
        PLACE_DOOR, PLACE_WINDOW, DELETE_ELEMENT, SELECT_ELEMENTS, SHOW_ELEMENT,
    }

    /// <summary>Аюулгүй байдлын шат (§48).  Дараалал нь ЧУХАЛ — харьцуулалтад ашиглана.</summary>
    public enum ActionSafetyLevel
    {
        OBSERVE = 0,
        ROAST = 1,
        PROPOSE = 2,
        CONFIRM_WRITE = 3,
        SAFE_AUTOFIX = 4,
        AUTONOMOUS_SANDBOX = 5,
    }

    public static class ActionSafety
    {
        /// <summary>⚠️ Session R-ийн ХАТУУ тааз.  Үүнийг өсгөх нь R4-ийн шийдвэр, кодын засвар биш.</summary>
        /// <summary>
        /// R4.1 (2026-09-15, Checkpoint 3C accepted): CONFIRM_WRITE НЭЭГДЭВ — ЗӨВХӨН хэрэглэгчийн ИЛ баталгаатай,
        /// ЗӨВХӨН `EnabledWriteKinds` (SET_PARAMETER · MOVE_ELEMENT · CHANGE_TYPE).  SAFE_AUTOFIX /
        /// AUTONOMOUS_SANDBOX / автомат create·delete ХААЛТТАЙ ХЭВЭЭР.
        /// </summary>
        public const ActionSafetyLevel MaxLevel = ActionSafetyLevel.CONFIRM_WRITE;

        /// <summary>Энэ релизэд ГҮЙЦЭТГЭЖ болох бичих үйлдэл — бусад бичих үйлдэл WRITE_ACTION_DISABLED_IN_THIS_RELEASE.</summary>
        public static readonly RevitActionKind[] EnabledWriteKinds = { RevitActionKind.SET_PARAMETER, RevitActionKind.MOVE_ELEMENT, RevitActionKind.CHANGE_TYPE };

        public static bool IsEnabledWrite(RevitActionKind kind)
        {
            return Array.IndexOf(EnabledWriteKinds, kind) >= 0;
        }

        /// <summary>MOVE_ELEMENT-ийн зөвшөөрөгдөх дээд зөрүү (мм, тэнхлэг бүр) — R4.2 «жижиг, хязгаартай».</summary>
        public const double MaxMoveDeltaMm = 500.0;

        /// <summary>Загварыг ӨӨРЧЛӨХ үйлдэл мөн үү (навигаци БИШ).</summary>
        public static bool IsWrite(RevitActionKind kind)
        {
            return kind != RevitActionKind.SELECT_ELEMENTS && kind != RevitActionKind.SHOW_ELEMENT;
        }

        public static ActionSafetyLevel RequiredLevel(RevitActionKind kind)
        {
            return IsWrite(kind) ? ActionSafetyLevel.CONFIRM_WRITE : ActionSafetyLevel.OBSERVE;
        }
    }

    public sealed class ActionRequester
    {
        /// <summary>USER | MGL_AI | COMPLIANCE — хэн санаачилсан.</summary>
        [JsonPropertyName("kind")] public string Kind { get; set; }
        [JsonPropertyName("user_id")] public int? UserId { get; set; }
        [JsonPropertyName("issue_id")] public string IssueId { get; set; }
        [JsonPropertyName("request_id")] public string RequestId { get; set; }
    }

    public sealed class ActionReason
    {
        [JsonPropertyName("summary_mn")] public string SummaryMn { get; set; }
        [JsonPropertyName("rule_id")] public string RuleId { get; set; }
        [JsonPropertyName("issue_id")] public string IssueId { get; set; }
    }

    public sealed class ActionPrecondition
    {
        /// <summary>ELEMENT_EXISTS | EDITABLE | NOT_LINKED | NOT_PINNED | DOCUMENT_WRITABLE | SCENE_VERSION</summary>
        [JsonPropertyName("kind")] public string Kind { get; set; }
        [JsonPropertyName("element_id")] public long? ElementId { get; set; }
        [JsonPropertyName("expected")] public string Expected { get; set; }
    }

    public sealed class RevitActionEnvelope
    {
        [JsonPropertyName("schema_version")] public int SchemaVersion { get; set; } = Schema.Version;
        [JsonPropertyName("action_id")] public string ActionId { get; set; }
        [JsonPropertyName("action")] public RevitActionKind Action { get; set; }
        [JsonPropertyName("doc_key")] public string DocKey { get; set; }
        [JsonPropertyName("target_element_ids")] public List<long> TargetElementIds { get; set; } = new List<long>();
        /// <summary>Үйлдлийн параметр — ЗӨВХӨН энгийн утга (мөр/тоо), код БИШ.</summary>
        [JsonPropertyName("parameters")] public Dictionary<string, string> Parameters { get; set; } = new Dictionary<string, string>(StringComparer.Ordinal);
        [JsonPropertyName("reason")] public ActionReason Reason { get; set; }
        [JsonPropertyName("requested_by")] public ActionRequester RequestedBy { get; set; }
        [JsonPropertyName("preconditions")] public List<ActionPrecondition> Preconditions { get; set; } = new List<ActionPrecondition>();
        [JsonPropertyName("safety_level")] public ActionSafetyLevel SafetyLevel { get; set; } = ActionSafetyLevel.PROPOSE;
        /// <summary>Детерминист үндэслэл (§13) — SELECTION | TOOL_RESULT | ISSUE | USER_INPUT; хоосон = зорилтыг үндэслээгүй.</summary>
        [JsonPropertyName("evidence")] public List<ActionEvidence> Evidence { get; set; } = new List<ActionEvidence>();
        [JsonPropertyName("risk_level")] public ActionRiskLevel RiskLevel { get; set; } = ActionRiskLevel.MEDIUM;
        /// <summary>Саналын гарал (R4.2 §7): USER_UI | MODEL | DETERMINISTIC_ISSUE.  MODEL ҮРГЭЛЖ CONFIRM_WRITE; аудитад requested_by.</summary>
        [JsonPropertyName("proposal_source")] public ProposalSource ProposalSource { get; set; } = ProposalSource.USER_UI;
        /// <summary>Зорилтын UniqueId (сонголтоос) — ElementId дахин ашиглагдахаас хамгаална.</summary>
        [JsonPropertyName("target_unique_ids")] public List<string> TargetUniqueIds { get; set; } = new List<string>();
        [JsonPropertyName("scene_version")] public long? SceneVersion { get; set; }
        [JsonPropertyName("created_at")] public string CreatedAt { get; set; }
    }

    public enum ActionValidationCode
    {
        OK,
        MISSING_ACTION_ID,
        MISSING_DOC_KEY,
        NO_TARGETS,
        TARGETS_REQUIRED_FOR_MOVE,
        MISSING_REASON,
        MISSING_REQUESTER,
        SAFETY_LEVEL_EXCEEDS_SESSION_MAX,
        WRITE_ACTION_DISABLED_IN_THIS_RELEASE,
        LINKED_ELEMENT_NOT_WRITABLE,
        PARAMETER_VALUE_LOOKS_LIKE_CODE,
        UNKNOWN_PARAMETER_FOR_ACTION,
        // R4.1 — preview/гүйцэтгэлийн урьдчилсан нөхцөл
        TARGET_NOT_GROUNDED,
        TARGET_AMBIGUOUS,
        DOCUMENT_NOT_WRITABLE,
        ELEMENT_NOT_FOUND,
        ELEMENT_NOT_EDITABLE,
        WORKSHARING_BLOCKED,
        ELEMENT_PINNED,
        PROHIBITED_CATEGORY,
        PARAMETER_NOT_FOUND,
        PARAMETER_READ_ONLY,
        STORAGE_TYPE_MISMATCH,
        VALUE_SCHEMA_INVALID,
        DELTA_OUT_OF_BOUNDS,
        TYPE_NOT_FOUND,
        TYPE_INCOMPATIBLE,
        NORM_AUTHORIZATION_INSUFFICIENT,
        STALE_ACTION_PREVIEW,
        PREVIEW_EXPIRED,
        NOT_CONFIRMED,
        PRECONDITION_FAILED,
        POSTCONDITION_FAILED,
        TRANSACTION_FAILED,
        // R4.2 — загварын саналын binder
        INSUFFICIENT_ACTION_PARAMETERS,
        CANDIDATE_NOT_GROUNDED_IN_REQUEST,
    }

    public sealed class ActionValidation
    {
        [JsonPropertyName("ok")] public bool Ok { get; set; }
        [JsonPropertyName("codes")] public List<ActionValidationCode> Codes { get; set; } = new List<ActionValidationCode>();
        [JsonPropertyName("executable_now")] public bool ExecutableNow { get; set; }
    }
}
