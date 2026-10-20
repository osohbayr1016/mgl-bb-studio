using System;
using System.Collections.Generic;
using System.Text.Json.Serialization;

namespace RevitMcpAddin.Intelligence.Contracts
{
    /* ================================================================== */
    /*  R4.1 — CONFIRM_WRITE: preview · баталгаа · гүйцэтгэл · аудит       */
    /*                                                                    */
    /*  Урсгал (Checkpoint 3C §6):                                        */
    /*    typed proposal → детерминист шалгалт → preview (ХОЛБООС)        */
    /*    → хэрэглэгчийн ИЛ баталгаа → RevitToolBus → ExternalEvent       */
    /*    → Transaction → яг НЭГ мутаци → Regenerate → дахин унших        */
    /*    → postcondition → COMMIT | ROLLBACK → аудит.                     */
    /*                                                                    */
    /*  ⚠️ LLM ХЭЗЭЭ Ч C# гаргахгүй; ЗӨВХӨН typed action.  Ямар ч загварын  */
    /*     хариу, хэрэгслийн үр дүн, ERP даалгавар, өмнөх баталгаа нь        */
    /*     БАТАЛГАА гэж тооцогдохгүй (§20) — зөвхөн `ActionConfirmation`,  */
    /*     тэр нь ЗӨВХӨН хэрэглэгчийн UI үйлдлээс (эсвэл DEV bridge-ийн    */
    /*     preview id-тай ИЛ токен — тест л).                              */
    /* ================================================================== */

    public enum ActionRiskLevel { LOW, MEDIUM, HIGH }

    /// <summary>Саналын үндэслэл — ЗӨВХӨН детерминист эх (сонголт, хэрэгслийн үр дүн, асуудал).</summary>
    public sealed class ActionEvidence
    {
        /// <summary>SELECTION | TOOL_RESULT | ISSUE | USER_INPUT</summary>
        [JsonPropertyName("kind")] public string Kind { get; set; }
        [JsonPropertyName("ref")] public string Ref { get; set; }
        [JsonPropertyName("text_mn")] public string TextMn { get; set; }
    }

    /// <summary>Preview-ийн үеийн элементийн төлөв — мутацийн ӨМНӨХ/ДАРААХ тулгалтад, аудитад.</summary>
    public sealed class ActionElementState
    {
        [JsonPropertyName("element_id")] public long ElementId { get; set; }
        [JsonPropertyName("unique_id")] public string UniqueId { get; set; }
        [JsonPropertyName("category")] public string Category { get; set; }
        [JsonPropertyName("family")] public string Family { get; set; }
        [JsonPropertyName("type")] public string Type { get; set; }
        [JsonPropertyName("type_id")] public long? TypeId { get; set; }
        /// <summary>SET_PARAMETER: параметрийн одоогийн утга (мөрөөр); MOVE: байршил; CHANGE_TYPE: төрөл.</summary>
        [JsonPropertyName("value")] public string Value { get; set; }
        [JsonPropertyName("location_mm")] public double[] LocationMm { get; set; }
        /// <summary>Төлөвийн хурууны хээ — sha256(value|location|type_id) — preview-ийн холбоос.</summary>
        [JsonPropertyName("fingerprint")] public string Fingerprint { get; set; }
    }

    /// <summary>
    /// PREVIEW — баталгаа ЭНЭ preview-д л холбогдоно (§14).  `binding_hash` =
    /// sha256(doc_fingerprint | unique_id | before.fingerprint | proposal_hash | nonce).
    /// Баталгаажуулахад бүгдийг Revit-ийн ОДООГИЙН төлөвтэй дахин тулгана; зөрвөл STALE_ACTION_PREVIEW.
    /// </summary>
    public sealed class ActionPreview
    {
        [JsonPropertyName("schema_version")] public int SchemaVersion { get; set; } = Schema.Version;
        [JsonPropertyName("preview_id")] public string PreviewId { get; set; }
        [JsonPropertyName("action_id")] public string ActionId { get; set; }
        [JsonPropertyName("action")] public RevitActionKind Action { get; set; }
        [JsonPropertyName("doc_key")] public string DocKey { get; set; }
        /// <summary>Баримтын хурууны хээ — doc_key + нээлттэй баримтын title + элементийн тоо (өөрчлөлт мэдрэгч).</summary>
        [JsonPropertyName("doc_fingerprint")] public string DocFingerprint { get; set; }
        [JsonPropertyName("target")] public ActionElementState Before { get; set; }
        [JsonPropertyName("after_value")] public string AfterValue { get; set; }
        [JsonPropertyName("after_location_mm")] public double[] AfterLocationMm { get; set; }
        [JsonPropertyName("after_type_id")] public long? AfterTypeId { get; set; }
        [JsonPropertyName("after_type_name")] public string AfterTypeName { get; set; }
        /// <summary>CHANGE_TYPE: тухайн элементэд Revit-ийн зөвшөөрөх төрлүүд (≤ 30) — сонголтод; бичих эрх ОЛГОХГҮЙ.</summary>
        [JsonPropertyName("valid_types")] public List<ActionTypeOption> ValidTypes { get; set; } = new List<ActionTypeOption>();
        [JsonPropertyName("parameter_name")] public string ParameterName { get; set; }
        [JsonPropertyName("reason_mn")] public string ReasonMn { get; set; }
        [JsonPropertyName("risk")] public ActionRiskLevel Risk { get; set; }
        [JsonPropertyName("proposal_hash")] public string ProposalHash { get; set; }
        [JsonPropertyName("nonce")] public string Nonce { get; set; }
        [JsonPropertyName("binding_hash")] public string BindingHash { get; set; }
        [JsonPropertyName("issued_at")] public string IssuedAt { get; set; }
        [JsonPropertyName("expires_at")] public string ExpiresAt { get; set; }
        [JsonPropertyName("validation")] public ActionValidation Validation { get; set; }
        /// <summary>Хэрэглэгчид харуулах мөрүүд («Өмнө/Дараа/Хамрах/Шалтгаан»).</summary>
        [JsonPropertyName("lines_mn")] public List<string> LinesMn { get; set; } = new List<string>();
    }

    /// <summary>ИЛ баталгаа — ЗӨВХӨН хэрэглэгчийн үйлдлээс (UI Apply, эсвэл DEV bridge-ийн ил токен).</summary>
    public sealed class ActionConfirmation
    {
        [JsonPropertyName("preview_id")] public string PreviewId { get; set; }
        [JsonPropertyName("binding_hash")] public string BindingHash { get; set; }
        /// <summary>USER_UI | DEV_BRIDGE_TOKEN — загварын хариу, хэрэгсэл, ERP ХЭЗЭЭ Ч энд орохгүй.</summary>
        [JsonPropertyName("confirmed_by")] public string ConfirmedBy { get; set; }
        [JsonPropertyName("confirmed_at")] public string ConfirmedAt { get; set; }
    }

    public sealed class ActionTypeOption
    {
        [JsonPropertyName("type_id")] public long TypeId { get; set; }
        [JsonPropertyName("name")] public string Name { get; set; }
        [JsonPropertyName("family")] public string Family { get; set; }
        [JsonPropertyName("current")] public bool Current { get; set; }
    }

    public enum ActionExecutionStatus { REJECTED, STALE, APPLIED, ROLLED_BACK, FAILED }

    public sealed class ActionExecution
    {
        [JsonPropertyName("schema_version")] public int SchemaVersion { get; set; } = Schema.Version;
        [JsonPropertyName("action_id")] public string ActionId { get; set; }
        [JsonPropertyName("preview_id")] public string PreviewId { get; set; }
        [JsonPropertyName("action")] public RevitActionKind Action { get; set; }
        [JsonPropertyName("status")] public ActionExecutionStatus Status { get; set; }
        [JsonPropertyName("codes")] public List<ActionValidationCode> Codes { get; set; } = new List<ActionValidationCode>();
        [JsonPropertyName("before")] public ActionElementState Before { get; set; }
        [JsonPropertyName("after")] public ActionElementState After { get; set; }
        /// <summary>Postcondition батлагдсан эсэх (commit-ийн ӨМНӨ regenerate + дахин уншсан).</summary>
        [JsonPropertyName("verified")] public bool Verified { get; set; }
        [JsonPropertyName("rollback_reason")] public string RollbackReason { get; set; }
        [JsonPropertyName("issues_after")] public int IssuesAfter { get; set; }
        [JsonPropertyName("elapsed_ms")] public double ElapsedMs { get; set; }
        [JsonPropertyName("audit_seq")] public long AuditSeq { get; set; }
        [JsonPropertyName("message_mn")] public string MessageMn { get; set; }
    }

    /// <summary>
    /// АУДИТ — локал JSONL (`intelligence/actions-<pid>.jsonl`).  ХЭЗЭЭ Ч: нууц, JWT, геометрийн
    /// бүтэн дамп, хамааралгүй ажилтны өгөгдөл.  Зөвхөн id, төлөвийн мөр, хурууны хээ, кодууд.
    /// </summary>
    public sealed class ActionAuditRecord
    {
        [JsonPropertyName("schema_version")] public int SchemaVersion { get; set; } = Schema.Version;
        [JsonPropertyName("seq")] public long Seq { get; set; }
        [JsonPropertyName("at")] public string At { get; set; }
        [JsonPropertyName("stage")] public string Stage { get; set; }
        [JsonPropertyName("action_id")] public string ActionId { get; set; }
        [JsonPropertyName("preview_id")] public string PreviewId { get; set; }
        [JsonPropertyName("action")] public RevitActionKind Action { get; set; }
        [JsonPropertyName("doc_fingerprint")] public string DocFingerprint { get; set; }
        [JsonPropertyName("element_unique_id")] public string ElementUniqueId { get; set; }
        [JsonPropertyName("element_id")] public long? ElementId { get; set; }
        [JsonPropertyName("before")] public string Before { get; set; }
        [JsonPropertyName("proposed")] public string Proposed { get; set; }
        [JsonPropertyName("confirmed_by")] public string ConfirmedBy { get; set; }
        [JsonPropertyName("executed")] public bool Executed { get; set; }
        [JsonPropertyName("result")] public string Result { get; set; }
        [JsonPropertyName("post_validation")] public string PostValidation { get; set; }
        [JsonPropertyName("rollback_reason")] public string RollbackReason { get; set; }
        [JsonPropertyName("codes")] public List<string> Codes { get; set; } = new List<string>();
        [JsonPropertyName("requested_by")] public string RequestedBy { get; set; }
    }
}
