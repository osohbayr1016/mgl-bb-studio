using System;
using System.Collections.Generic;
using System.Text.Json.Serialization;

namespace RevitMcpAddin.Intelligence.Contracts
{
    /* ================================================================== */
    /*  НИЙЦЭЛ (§37–43, R-11, R-12)                                        */
    /*                                                                    */
    /*  ГУРВАН АНГИ, ХЭЗЭЭ Ч ХОЛИХГҮЙ:                                     */
    /*    VERIFIED_NORM    — баталгаажсан эх + ил BIM хамаарал + детерминист */
    /*                       хэмжилт → эрх бүхий болж БОЛНО                */
    /*    MODEL_QUALITY    — загварын чанар (өрөө хаалттай биш, хостгүй    */
    /*                       хаалга …) — хууль/нормын зөрчил БИШ           */
    /*    REVIEW_CANDIDATE — эх сурвалж эсвэл хамаарал ХАНГАЛТГҮЙ →         */
    /*                       HUMAN_REVIEW_REQUIRED                          */
    /*                                                                    */
    /*  ⚠️ Track 2-ийн `FindingRow` (ComplianceState.cs) нь СЕРВЕР РҮҮ      */
    /*  явдаг, хөлдөөсөн хувилбартай бүртгэлийн мөр.  Энэ гэрээ нь         */
    /*  Revit-ийн САМБАРЫН + ирээдүйн BIM хамаарлын гэрээ; хоёр нь          */
    /*  `RuleUid`/`RuleVersion`-оор холбогдоно, нэг нь нөгөөг орлохгүй.     */
    /* ================================================================== */

    public enum IssueClass { VERIFIED_NORM, MODEL_QUALITY, REVIEW_CANDIDATE }

    public enum IssueSeverity { CRITICAL, HIGH, MEDIUM, LOW, INFO }

    public enum IssueStatus { OPEN, RESOLVED, HUMAN_REVIEW_REQUIRED, SUPERSEDED }

    /// <summary>Дүрмийн эх сурвалжийн төрөл.  `SYNTHETIC` нь ЗӨВХӨН тестийн fixture-д (R-12).</summary>
    public enum RuleSourceKind { VERIFIED_NORM, MODEL_QUALITY, SYNTHETIC, UNVERIFIED_NORM }

    public sealed class IssueSource
    {
        [JsonPropertyName("kind")] public RuleSourceKind Kind { get; set; }
        /// <summary>Жишээ: «БНбД 31-03-…» — ЗӨВХӨН `VERIFIED_NORM`/`UNVERIFIED_NORM`-д.</summary>
        [JsonPropertyName("document_code")] public string DocumentCode { get; set; }
        [JsonPropertyName("clause")] public string Clause { get; set; }
        [JsonPropertyName("label_mn")] public string LabelMn { get; set; }
        /// <summary>Session A-ийн `verification` төлөв (verified | needs_human_review …) эсвэл `SYNTHETIC_NON_REGULATORY`.</summary>
        [JsonPropertyName("verification")] public string Verification { get; set; }
        [JsonPropertyName("currentness")] public string Currentness { get; set; }
        /// <summary>«SYNTHETIC — NON_REGULATORY — TEST FIXTURE» гэх мэт хүнд уншигдах provenance.</summary>
        [JsonPropertyName("provenance_note")] public string ProvenanceNote { get; set; }
    }

    public sealed class RevitComplianceIssue
    {
        [JsonPropertyName("schema_version")] public int SchemaVersion { get; set; } = Schema.Version;
        [JsonPropertyName("issue_id")] public string IssueId { get; set; }
        [JsonPropertyName("issue_class")] public IssueClass Class { get; set; }
        [JsonPropertyName("severity")] public IssueSeverity Severity { get; set; }
        [JsonPropertyName("doc_key")] public string DocKey { get; set; }
        [JsonPropertyName("element_ids")] public List<long> ElementIds { get; set; } = new List<long>();
        [JsonPropertyName("element_uids")] public List<string> ElementUids { get; set; } = new List<string>();
        /// <summary>Машины нэр: `room_not_enclosed`, `door_without_host`, `synthetic_min_door_width` …</summary>
        [JsonPropertyName("issue_type")] public string IssueType { get; set; }
        [JsonPropertyName("title_mn")] public string TitleMn { get; set; }
        [JsonPropertyName("detail_mn")] public string DetailMn { get; set; }
        [JsonPropertyName("measured")] public Measure Measured { get; set; }
        [JsonPropertyName("required")] public Measure Required { get; set; }
        [JsonPropertyName("source")] public IssueSource Source { get; set; }
        /// <summary>ЗӨВХӨН `VERIFIED_NORM` + authoritative ирмэг + детерминист хэмжилт үед true.</summary>
        [JsonPropertyName("authoritative")] public bool Authoritative { get; set; }
        [JsonPropertyName("explanation_key")] public string ExplanationKey { get; set; }
        [JsonPropertyName("suggested_action")] public RevitActionKind? SuggestedAction { get; set; }
        [JsonPropertyName("status")] public IssueStatus Status { get; set; } = IssueStatus.OPEN;
        [JsonPropertyName("rule_id")] public string RuleId { get; set; }
        [JsonPropertyName("rule_version")] public int RuleVersion { get; set; }
        /// <summary>Аудит (§62): ямар графийн хувилбар дээр илэрсэн.</summary>
        [JsonPropertyName("scene_version")] public long SceneVersion { get; set; }
        [JsonPropertyName("detected_at")] public string DetectedAt { get; set; }
        [JsonPropertyName("resolved_at")] public string ResolvedAt { get; set; }
        /// <summary>Ирмэгийн итгэл `APPROXIMATE` байсан бол — хэрэглэсэн ирмэгүүд.</summary>
        [JsonPropertyName("evidence_edges")] public List<string> EvidenceEdges { get; set; } = new List<string>();

        /// <summary>Дахин илрүүлэхэд ИЖИЛ асуудал мөн эсэхийг таних түлхүүр.</summary>
        public string DedupKey()
        {
            string ids = ElementIds.Count == 0 ? "-" : string.Join(",", ElementIds);
            return (DocKey ?? "") + "|" + (RuleId ?? IssueType ?? "") + "|" + ids;
        }
    }

    /* ================================================================== */
    /*  BIM ГҮЙЦЭТГЭГДЭХ ДҮРЭМ (§40–41)                                     */
    /*                                                                    */
    /*  Session A-ийн нормын хөдөлгүүрийг ХӨНДӨХГҮЙ.  Энэ бол ирээдүйн     */
    /*  «норм → BIM хамаарал» гүүрний ГЭРЭЭ; продакшны нийлүүлэгч          */
    /*  ӨНӨӨДӨР `NO_EXECUTABLE_BIM_RULES` буцаана (R-12).                  */
    /* ================================================================== */

    public enum RulePredicateOp { GTE, GT, LTE, LT, EQ, NEQ, EXISTS, NOT_EXISTS, FLAG_SET, FLAG_NOT_SET }

    public enum AutoFixPolicy { NONE, PROPOSE_ONLY, CONFIRM_WRITE, SAFE_AUTOFIX }

    public sealed class RuleApplicability
    {
        [JsonPropertyName("kinds")] public List<SceneNodeKind> Kinds { get; set; } = new List<SceneNodeKind>();
        [JsonPropertyName("categories")] public List<string> Categories { get; set; } = new List<string>();
        /// <summary>Хэрэв тодорхой давхарт л — нэрээр.  Хоосон = бүх давхар.</summary>
        [JsonPropertyName("level_names")] public List<string> LevelNames { get; set; } = new List<string>();
    }

    /// <summary>
    /// Хэмжилтийн заавар.  `Measure` нь зангилааны `Measures`-ийн НЭР
    /// (`width_mm`, `area_m2` …) эсвэл `flag:<нэр>`.  Ирмэгийн шаардлагатай
    /// бол `RequiredRelation` + `RequireAuthoritativeEdge` (R-5).
    /// </summary>
    public sealed class RuleMeasurement
    {
        [JsonPropertyName("measure")] public string Measure { get; set; }
        [JsonPropertyName("unit")] public string Unit { get; set; }
        [JsonPropertyName("required_relation")] public EdgeRelation? RequiredRelation { get; set; }
        [JsonPropertyName("require_authoritative_edge")] public bool RequireAuthoritativeEdge { get; set; } = true;
    }

    public sealed class RulePredicate
    {
        [JsonPropertyName("op")] public RulePredicateOp Op { get; set; }
        [JsonPropertyName("threshold")] public double? Threshold { get; set; }
        [JsonPropertyName("unit")] public string Unit { get; set; }
        [JsonPropertyName("flag")] public string Flag { get; set; }
    }

    public sealed class BimExecutableRule
    {
        [JsonPropertyName("schema_version")] public int SchemaVersion { get; set; } = Schema.Version;
        [JsonPropertyName("rule_id")] public string RuleId { get; set; }
        [JsonPropertyName("rule_version")] public int RuleVersion { get; set; } = 1;
        [JsonPropertyName("source")] public IssueSource Source { get; set; }
        [JsonPropertyName("applies_to")] public RuleApplicability AppliesTo { get; set; } = new RuleApplicability();
        [JsonPropertyName("required_inputs")] public List<string> RequiredInputs { get; set; } = new List<string>();
        [JsonPropertyName("measurement")] public RuleMeasurement Measurement { get; set; }
        [JsonPropertyName("predicate")] public RulePredicate Predicate { get; set; }
        [JsonPropertyName("severity")] public IssueSeverity Severity { get; set; } = IssueSeverity.MEDIUM;
        [JsonPropertyName("auto_fix_policy")] public AutoFixPolicy AutoFixPolicy { get; set; } = AutoFixPolicy.NONE;
        [JsonPropertyName("title_mn")] public string TitleMn { get; set; }
        [JsonPropertyName("explanation_key")] public string ExplanationKey { get; set; }
        [JsonPropertyName("suggested_action")] public RevitActionKind? SuggestedAction { get; set; }

        /// <summary>Энэ дүрэм эрх бүхий олдвор гаргаж БОЛОХ уу (R-11 A анги).</summary>
        public bool MayBeAuthoritative()
        {
            return Source != null
                && Source.Kind == RuleSourceKind.VERIFIED_NORM
                && string.Equals(Source.Verification, "verified", StringComparison.Ordinal);
        }

        /// <summary>Олдворын анги — дүрмийн эх сурвалжаас ДЕТЕРМИНИСТ (загвар шийддэггүй).</summary>
        public IssueClass IssueClassOf()
        {
            if (Source == null) return IssueClass.REVIEW_CANDIDATE;
            switch (Source.Kind)
            {
                case RuleSourceKind.MODEL_QUALITY: return IssueClass.MODEL_QUALITY;
                case RuleSourceKind.VERIFIED_NORM:
                    return MayBeAuthoritative() ? IssueClass.VERIFIED_NORM : IssueClass.REVIEW_CANDIDATE;
                case RuleSourceKind.SYNTHETIC: return IssueClass.REVIEW_CANDIDATE;
                default: return IssueClass.REVIEW_CANDIDATE;
            }
        }
    }

    public enum RuleProviderStatus { OK, NO_EXECUTABLE_BIM_RULES, ERROR }

    public sealed class RuleProviderResult
    {
        [JsonPropertyName("status")] public RuleProviderStatus Status { get; set; }
        [JsonPropertyName("provider")] public string Provider { get; set; }
        [JsonPropertyName("rules")] public List<BimExecutableRule> Rules { get; set; } = new List<BimExecutableRule>();
        [JsonPropertyName("note")] public string Note { get; set; }
    }

    /// <summary>Дүрмийн нийлүүлэгчийн хил (§40) — Session A-ийн компайлер ирээдүйд ЭНД холбогдоно.</summary>
    public interface IBimRuleProvider
    {
        string Name { get; }
        RuleProviderResult Load();
    }
}
