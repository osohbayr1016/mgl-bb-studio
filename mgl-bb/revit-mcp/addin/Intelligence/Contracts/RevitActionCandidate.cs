using System.Collections.Generic;
using System.Text.Json.Serialization;

namespace RevitMcpAddin.Intelligence.Contracts
{
    /* ================================================================== */
    /*  R4.2 — ЗАГВАРЫН ИТГЭМЖЛЭГДЭЭГҮЙ САНАЛ (§5): гүйцэтгэх эрх БАЙХГҮЙ.    */
    /*                                                                    */
    /*  Хуваалцсан хөдөлгүүр (packages/mglai-common/src/turn/revitAction.ts)*/
    /*  хариултын блокоос салгаж, хатуу схемээр шалгаад `revitActionCandidate`*/
    /*  талбараар буцаана.  Энд ИТГЭМЖЛЭГДСЭН талбар (action_id, binding,   */
    /*  хурууны хээ, нотолгоо, worksharing, баталгаа, аудит) БАЙХГҮЙ —     */
    /*  тэдгээрийг ЗӨВХӨН `RevitActionBinder` (детерминист, Revit тал)      */
    /*  шинэ snapshot-оос үүсгэнэ.                                          */
    /* ================================================================== */

    public sealed class RevitActionCandidate
    {
        [JsonPropertyName("schema_version")] public int SchemaVersion { get; set; }
        /// <summary>SET_PARAMETER | MOVE_ELEMENT | CHANGE_TYPE</summary>
        [JsonPropertyName("action_type")] public string ActionType { get; set; }
        [JsonPropertyName("target")] public RevitActionCandidateTarget Target { get; set; }
        [JsonPropertyName("arguments")] public Dictionary<string, string> Arguments { get; set; } = new Dictionary<string, string>();
        [JsonPropertyName("reason_mn")] public string ReasonMn { get; set; }
        [JsonPropertyName("confidence")] public string Confidence { get; set; }
    }

    public sealed class RevitActionCandidateTarget
    {
        /// <summary>ЗӨВХӨН "CURRENT_SELECTION" — загвар элементийн id нэрлэхгүй.</summary>
        [JsonPropertyName("reference")] public string Reference { get; set; }
    }

    /// <summary>Саналын гарал — аудит/UI: MODEL нь ҮРГЭЛЖ CONFIRM_WRITE, хэзээ ч өөрөө батлахгүй.</summary>
    public enum ProposalSource { USER_UI, MODEL, DETERMINISTIC_ISSUE }
}
