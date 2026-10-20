using System;
using System.Collections.Generic;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace RevitMcpAddin.Intelligence.Contracts
{
    /* ================================================================== */
    /*  MGL AI ↔ REVIT — УТСАН ГЭРЭЭ (R-7)                                  */
    /*                                                                    */
    /*  `backend/src/lib/mglai/revitContext.ts`-ийн `RawRevitContext`-той  */
    /*  ЯГ ИЖИЛ талбарууд.  Тэр файл сервер дээр `parseRevitContext`-оор   */
    /*  задалж, 25-аар тасалж, `summarizeRevit`-ээр prompt-д шигтгэдэг.    */
    /*  ЭНД шинэ талбар нэмэх нь ТЭР файлыг (Session D-ийн хил) хөндөнө —  */
    /*  тиймээс баялаг мэдээлэл `RevitContextSnapshot`-д үлдэж, утсаар     */
    /*  ЗӨВХӨН энэ хураангуй явна.                                        */
    /* ================================================================== */

    public sealed class MglAiRevitContextWire
    {
        [JsonPropertyName("docTitle")] public string DocTitle { get; set; }
        [JsonPropertyName("docUid")] public string DocUid { get; set; }
        [JsonPropertyName("revitVersion")] public string RevitVersion { get; set; }
        [JsonPropertyName("activeViewName")] public string ActiveViewName { get; set; }
        [JsonPropertyName("activeViewType")] public string ActiveViewType { get; set; }
        [JsonPropertyName("levelName")] public string LevelName { get; set; }
        [JsonPropertyName("selection")] public List<MglAiSelectedElementWire> Selection { get; set; } = new List<MglAiSelectedElementWire>();
        [JsonPropertyName("warnings")] public int Warnings { get; set; }
        [JsonPropertyName("projectId")] public int? ProjectId { get; set; }
        [JsonPropertyName("transactionOpen")] public bool TransactionOpen { get; set; }
        /// <summary>Баримт дахь нээлттэй детерминист асуудлын НИЙТ тоо (IssueStore) — R3.5.</summary>
        [JsonPropertyName("issuesTotal")] public int IssuesTotal { get; set; }
        /// <summary>Продакшны BIM дүрмийн төлөв — ҮРГЭЛЖ NO_EXECUTABLE_BIM_RULES (R-13); загвар норм зохиохгүй гэдгийг серверт ил хэлнэ.</summary>
        [JsonPropertyName("productionRules")] public string ProductionRules { get; set; } = "NO_EXECUTABLE_BIM_RULES";
        /// <summary>MGL-AI-TEST тэмдэгтэй синтетик баримт — сервер «синтетик тест загвар» гэж заавал тэмдэглүүлнэ (R3.5).</summary>
        [JsonPropertyName("isTestFixture")] public bool IsTestFixture { get; set; }
        /// <summary>
        /// Детерминист тайлангийн нотолгоо (R3.5) — ЗӨВХӨН тайлангийн асуултад host хавсаргана
        /// (`ReportEvidenceBuilder` + `ReportRenderer`, TECHNICAL_SELF_REPORT).  Загвар тайланг ЗӨВХӨН эндээс үглэнэ;
        /// явцын хувь ХЭЗЭЭ Ч энд байхгүй (PROGRESS_ESTIMATE_UNAVAILABLE, R-8).
        /// </summary>
        [JsonPropertyName("report")] public MglAiReportWire Report { get; set; }
    }

    public sealed class MglAiSelectedElementWire
    {
        [JsonPropertyName("id")] public string Id { get; set; }
        [JsonPropertyName("category")] public string Category { get; set; }
        [JsonPropertyName("family")] public string Family { get; set; }
        [JsonPropertyName("type")] public string Type { get; set; }
        [JsonPropertyName("name")] public string Name { get; set; }
        [JsonPropertyName("level")] public string Level { get; set; }
        /// <summary>
        /// ХЭМЖСЭН утга (R3.5) — серверийн `RevitMeasure` (revitContext.ts): ЗӨВХӨН BUILTIN_GEOMETRY /
        /// TYPED_PARAM, missing биш.  UNTYPED_PARAM/COMPUTED ХЭЗЭЭ Ч явахгүй (mixed_provenance) —
        /// сервер эдгээрийг `revit_model` итгэмжлэгдсэн баримт болгодог тул хагас найдвартай тоо орох ёсгүй.
        /// </summary>
        [JsonPropertyName("measures")] public List<MglAiMeasureWire> Measures { get; set; } = new List<MglAiMeasureWire>();
        /// <summary>ЭНЭ элементэд хамаарах детерминист асуудал (IssueStore, нээлттэй) — R3.5.  Загвар асуудлыг ЗӨВХӨН эндээс.</summary>
        [JsonPropertyName("issues")] public List<MglAiIssueWire> Issues { get; set; } = new List<MglAiIssueWire>();
    }

    /// <summary>Детерминист асуудлын утсан хэлбэр — ангилал ХЭЗЭЭ Ч дээшлэхгүй (REVIEW_CANDIDATE → VERIFIED_NORM биш).</summary>
    public sealed class MglAiIssueWire
    {
        [JsonPropertyName("class")] public string Class { get; set; }
        [JsonPropertyName("severity")] public string Severity { get; set; }
        [JsonPropertyName("status")] public string Status { get; set; }
        [JsonPropertyName("rule_id")] public string RuleId { get; set; }
        [JsonPropertyName("source")] public string Source { get; set; }
        [JsonPropertyName("synthetic")] public bool Synthetic { get; set; }
        [JsonPropertyName("authoritative")] public bool Authoritative { get; set; }
        [JsonPropertyName("title")] public string Title { get; set; }
    }

    public sealed class MglAiReportWire
    {
        [JsonPropertyName("period")] public string Period { get; set; }
        [JsonPropertyName("audience")] public string Audience { get; set; }
        [JsonPropertyName("period_start")] public string PeriodStart { get; set; }
        [JsonPropertyName("period_end")] public string PeriodEnd { get; set; }
        [JsonPropertyName("title")] public string Title { get; set; }
        [JsonPropertyName("lines")] public List<string> Lines { get; set; } = new List<string>();
        [JsonPropertyName("facts")] public List<MglAiReportFactWire> Facts { get; set; } = new List<MglAiReportFactWire>();
        [JsonPropertyName("progress_estimate")] public string ProgressEstimate { get; set; } = "PROGRESS_ESTIMATE_UNAVAILABLE";
    }

    public sealed class MglAiReportFactWire
    {
        [JsonPropertyName("kind")] public string Kind { get; set; }
        [JsonPropertyName("value")] public string Value { get; set; }
        [JsonPropertyName("number")] public double? Number { get; set; }
        [JsonPropertyName("unit")] public string Unit { get; set; }
        [JsonPropertyName("source")] public string Source { get; set; }
        [JsonPropertyName("subject")] public string Subject { get; set; }
        [JsonPropertyName("observed_at")] public string ObservedAt { get; set; }
    }

    public sealed class MglAiMeasureWire
    {
        [JsonPropertyName("name")] public string Name { get; set; }
        [JsonPropertyName("value")] public double Value { get; set; }
        [JsonPropertyName("unit")] public string Unit { get; set; }
        [JsonPropertyName("source")] public string Source { get; set; }
    }

    public static class MglAiWire
    {
        /// <summary>Серверийн `MAX_ELEMENTS` (revitContext.ts) — ХОС.  Илүүг явуулах нь утгагүй: сервер тасална.</summary>
        public const int MaxSelection = 25;

        /// <summary>
        /// Баялаг агшин зураг → утсан хураангуй.  ⚠️ `projectId` нь ЗӨВХӨН
        /// `CONFIRMED` холбоосоос — санал болгосон төслийг серверт «энэ
        /// төсөл» гэж хэлэхгүй (R-10).
        /// </summary>
        public static MglAiRevitContextWire FromSnapshot(RevitContextSnapshot snap)
        {
            return FromSnapshot(snap, null);
        }

        /// <summary>R3.5: детерминист тайланг утсан хэлбэрт (мөр ≤ 40, баримт ≤ 60).</summary>
        public static MglAiReportWire ReportToWire(RevitReport r)
        {
            if (r == null) return null;
            var w = new MglAiReportWire
            {
                Period = r.Period.ToString(),
                Audience = r.Audience.ToString(),
                PeriodStart = r.Evidence != null ? r.Evidence.PeriodStart : null,
                PeriodEnd = r.Evidence != null ? r.Evidence.PeriodEnd : null,
                Title = r.TitleMn,
            };
            if (r.LinesMn != null) foreach (string l in r.LinesMn) { if (w.Lines.Count >= 40) break; if (!string.IsNullOrEmpty(l)) w.Lines.Add(l); }
            if (r.Evidence != null && r.Evidence.Facts != null)
            {
                foreach (ReportFact f in r.Evidence.Facts)
                {
                    if (w.Facts.Count >= 60) break;
                    if (f == null) continue;
                    w.Facts.Add(new MglAiReportFactWire { Kind = f.Kind.ToString(), Value = f.Value, Number = f.Number, Unit = f.Unit, Source = f.Source.ToString(), Subject = f.Subject, ObservedAt = f.ObservedAt });
                }
            }
            return w;
        }

        /// <summary>R3.5: сонгосон элементийн детерминист асуудлыг (IssueStore) хамт явуулна.</summary>
        public static MglAiRevitContextWire FromSnapshot(RevitContextSnapshot snap, IReadOnlyList<RevitComplianceIssue> openIssues)
        {
            var w = new MglAiRevitContextWire();
            if (snap == null) return w;
            if (snap.Document != null)
            {
                w.DocTitle = snap.Document.Title;
                w.DocUid = snap.Document.DocKey;
                w.RevitVersion = snap.Document.RevitVersion;
                w.LevelName = snap.Document.ActiveLevel;
            }
            if (snap.ActiveView != null)
            {
                w.ActiveViewName = snap.ActiveView.Name;
                w.ActiveViewType = snap.ActiveView.ViewType;
                if (!string.IsNullOrEmpty(snap.ActiveView.Level)) w.LevelName = snap.ActiveView.Level;
            }
            w.Warnings = snap.WarningCount ?? 0;
            w.TransactionOpen = snap.TransactionOpen;
            if (snap.ProjectLink != null && snap.ProjectLink.State == ProjectLinkState.CONFIRMED)
            {
                w.ProjectId = snap.ProjectLink.ProjectId;
            }
            int n = 0;
            foreach (RevitElementSummary e in snap.Selection)
            {
                if (n++ >= MaxSelection) break;
                var sel = new MglAiSelectedElementWire
                {
                    Id = e.ElementId.ToString(),
                    Category = e.Category,
                    Family = e.Family,
                    Type = e.Type,
                    Name = e.Name,
                    Level = e.Level,
                };
                if (openIssues != null)
                {
                    int k = 0;
                    foreach (RevitComplianceIssue iss in openIssues)
                    {
                        if (iss == null || iss.ElementIds == null || !iss.ElementIds.Contains(e.ElementId)) continue;
                        if (k++ >= 8) break;
                        sel.Issues.Add(new MglAiIssueWire
                        {
                            Class = iss.Class.ToString(),
                            Severity = iss.Severity.ToString(),
                            Status = iss.Status.ToString(),
                            RuleId = iss.RuleId,
                            Source = iss.Source != null ? iss.Source.Kind.ToString() : null,
                            Synthetic = iss.Source != null && iss.Source.Kind == RuleSourceKind.SYNTHETIC,
                            Authoritative = iss.Authoritative,
                            Title = iss.TitleMn,
                        });
                    }
                }
                if (e.Dimensions != null)
                {
                    foreach (Measure m in e.Dimensions)
                    {
                        if (m == null || m.Missing || string.IsNullOrEmpty(m.Name)) continue;
                        if (m.Source != MeasureSource.BUILTIN_GEOMETRY && m.Source != MeasureSource.TYPED_PARAM) continue;
                        if (double.IsNaN(m.Value) || double.IsInfinity(m.Value)) continue;
                        sel.Measures.Add(new MglAiMeasureWire { Name = m.Name, Value = m.Value, Unit = m.Unit, Source = m.Source.ToString() });
                    }
                }
                w.Selection.Add(sel);
            }
            if (openIssues != null) w.IssuesTotal = openIssues.Count;
            if (snap.Document != null) w.IsTestFixture = snap.Document.IsTestFixture;
            // ⚠️ Таслагдсаныг серверт ҮНЭНЭЭР хэлнэ: сервер `selection.length`-ийг
            //    `selectionTotal` гэж уншдаг тул үлдсэн элементийг id + категориор
            //    (хураангуйгүй, хямд) явуулна.  Сервер өөрөө 25-аар таслаад
            //    «эхний 25-г л жагсаав» гэж загварт хэлнэ.
            foreach (RevitElementRef r in snap.SelectionRest)
            {
                if (w.Selection.Count >= 500) break;
                w.Selection.Add(new MglAiSelectedElementWire
                {
                    Id = r.ElementId.ToString(),
                    Category = r.Category,
                });
            }
            return w;
        }
    }

    /* ================================================================== */
    /*  ЭЭЛЖИЙН ХҮСЭЛТ — IMglAiRevitClient-ийн оролт/гаралт                */
    /* ================================================================== */

    public sealed class RevitTurnRequest
    {
        [JsonPropertyName("question")] public string Question { get; set; }
        [JsonPropertyName("conv_uid")] public string ConvUid { get; set; }
        [JsonPropertyName("seq")] public int Seq { get; set; }
        [JsonPropertyName("surface")] public string Surface { get; set; } = "revit";
        [JsonPropertyName("revit_context")] public MglAiRevitContextWire RevitContext { get; set; }
        /// <summary>Ярианы түүх (хөтчийн адил, сүүлийн N) — engine `history`; R3.5-д нэмэгдсэн.</summary>
        [JsonPropertyName("history")] public List<RevitChatTurnWire> History { get; set; } = new List<RevitChatTurnWire>();
        /// <summary>Өмнөх ээлжийн `convStateNext` — ХӨНДӨЛГҮЙ буцаана (сервер үүсгэсэн).</summary>
        [JsonPropertyName("conv_state")] public JsonElement? ConvState { get; set; }
        /// <summary>Typed Revit хэрэгслийн үр дүн — `tool_results`-ийн загвараар сервер угсарна.</summary>
        [JsonPropertyName("tool_results")] public List<RevitToolResultWire> ToolResults { get; set; } = new List<RevitToolResultWire>();
    }

    public sealed class RevitChatTurnWire
    {
        [JsonPropertyName("role")] public string Role { get; set; }
        [JsonPropertyName("content")] public string Content { get; set; }
    }

    public sealed class RevitToolResultWire
    {
        [JsonPropertyName("tool")] public string Tool { get; set; }
        [JsonPropertyName("ok")] public bool Ok { get; set; }
        [JsonPropertyName("data")] public object Data { get; set; }
        [JsonPropertyName("source_type")] public ToolSourceType SourceType { get; set; }
    }

    public enum TurnAnswerSource { MODEL, SERVER_TEMPLATE, RETRIEVAL_ONLY, MOCK, ERROR }

    public sealed class RevitTurnResult
    {
        [JsonPropertyName("answer_mn")] public string AnswerMn { get; set; }
        [JsonPropertyName("source")] public TurnAnswerSource Source { get; set; }
        [JsonPropertyName("state")] public RevitErrorState State { get; set; } = RevitErrorState.OK;
        [JsonPropertyName("citations")] public List<string> Citations { get; set; } = new List<string>();
        [JsonPropertyName("notices")] public List<string> Notices { get; set; } = new List<string>();
        [JsonPropertyName("binding")] public string Binding { get; set; }
        /// <summary>Engine-ийн `stopReason` (stop | length | aborted | repetition | timeout | interrupted).</summary>
        [JsonPropertyName("stop_reason")] public string StopReason { get; set; }
        /// <summary>Engine-ийн нэр (llama.cpp / retrieval-only …).</summary>
        [JsonPropertyName("engine")] public string Engine { get; set; }
        [JsonPropertyName("first_token_ms")] public double? FirstTokenMs { get; set; }
        [JsonPropertyName("total_ms")] public double? TotalMs { get; set; }
        /// <summary>Гэрээний оношилгоо (`contractDiag`: mode/risk/final) — түүхий JSON.</summary>
        [JsonPropertyName("contract_diag")] public JsonElement? ContractDiag { get; set; }
        /// <summary>Дараагийн ээлжид буцаах ярианы төлөв — хөндөлгүй.</summary>
        [JsonPropertyName("conv_state_next")] public JsonElement? ConvStateNext { get; set; }
        /// <summary>R4.2: загварын ИТГЭМЖЛЭГДЭЭГҮЙ санал (хуваалцсан хөдөлгүүр салгасан) — гүйцэтгэх эрхгүй.</summary>
        [JsonPropertyName("action_candidate")] public RevitActionCandidate ActionCandidate { get; set; }
        [JsonPropertyName("action_candidate_rejected")] public string ActionCandidateRejected { get; set; }
        /// <summary>Binder + preview-ийн үр дүн (host үүсгэнэ): preview байвал карт харагдана; кодууд байвал татгалзсан шалтгаан.</summary>
        [JsonPropertyName("action_preview")] public ActionPreview ActionPreview { get; set; }
        [JsonPropertyName("action_bind_codes")] public List<string> ActionBindCodes { get; set; } = new List<string>();
        [JsonPropertyName("action_bind_note")] public string ActionBindNote { get; set; }
    }
}
