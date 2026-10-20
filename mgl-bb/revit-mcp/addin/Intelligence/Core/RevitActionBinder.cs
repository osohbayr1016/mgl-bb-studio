using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text.RegularExpressions;
using RevitMcpAddin.Intelligence.Contracts;

namespace RevitMcpAddin.Intelligence.Core
{
    /* ================================================================== */
    /*  R4.2 — CANDIDATE → TRUSTED ENVELOPE BINDER (§6–§7), ЦЭВЭР, тесттэй.  */
    /*                                                                    */
    /*  Загварын санал → хатуу схем → CURRENT_SELECTION-ийг ШИНЭ snapshot-  */
    /*  оос шийднэ → хоёрдмол бол татгалзана → аргументыг канончилно →     */
    /*  бодит ElementId/UniqueId → нотолгоо → бодлого → RevitActionEnvelope. */
    /*                                                                    */
    /*  ⚠️ УТГЫН ҮНДЭСЛЭЛ: SET_PARAMETER-ийн VALUE, MOVE-ийн тоо/чиглэл,     */
    /*     CHANGE_TYPE-ийн нэр нь хэрэглэгчийн АСУУЛТАД БАЙХ ёстой — загвар  */
    /*     «100 мм» гэж таамагласан бол INSUFFICIENT_ACTION_PARAMETERS.     */
    /*  ⚠️ Загвар ХЭЗЭЭ Ч: confirmed, safety_level-ийг өсгөх, REVIEW_CANDIDATE- */
    /*     ийг нормын зөвшөөрөл болгох.  Envelope ҮРГЭЛЖ CONFIRM_WRITE,       */
    /*     ProposalSource.MODEL, RequestedBy=MODEL.                         */
    /* ================================================================== */
    public static class RevitActionBinder
    {
        public sealed class BindResult
        {
            public RevitActionEnvelope Envelope;
            public List<ActionValidationCode> Codes = new List<ActionValidationCode>();
            public string NoteMn;
            public bool Ok { get { return Envelope != null && Codes.Count == 0; } }
        }

        private static readonly string[] ParameterAllowlist = { "Comments", "Mark", "Description" };
        private static readonly Regex NormWords = new Regex(@"норм|бнбд|стандарт|дүрэм|norm|standard|code\b", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
        private static readonly Regex NumberMm = new Regex(@"(-?\d+(?:[.,]\d+)?)\s*(мм|mm)", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

        public static BindResult Bind(RevitActionCandidate cand, RevitContextSnapshot snap, string question, string docKey, IReadOnlyList<RevitComplianceIssue> issues)
        {
            var r = new BindResult();
            string q = question ?? "";
            if (cand == null) { r.Codes.Add(ActionValidationCode.NO_TARGETS); r.NoteMn = "Санал алга."; return r; }

            // 1. Схем (хуваалцсан хөдөлгүүр аль хэдийн шалгасан — энд ДАХИН, өөр процессоос ирсэн тул)
            if (cand.SchemaVersion != 1 || cand.Target == null || cand.Target.Reference != "CURRENT_SELECTION") { r.Codes.Add(ActionValidationCode.TARGET_NOT_GROUNDED); r.NoteMn = "Санал зөвхөн CURRENT_SELECTION-д хамаарна."; return r; }
            RevitActionKind kind;
            if (!Enum.TryParse(cand.ActionType ?? "", out kind) || !ActionSafety.IsEnabledWrite(kind)) { r.Codes.Add(ActionValidationCode.WRITE_ACTION_DISABLED_IN_THIS_RELEASE); r.NoteMn = "Энэ үйлдэл энэ релизэд хаалттай."; return r; }

            // 2. Норм: «нормд тааруулж зас» — зөвхөн VERIFIED_NORM (authoritative) асуудалтай үед; REVIEW_CANDIDATE/синтетик ХЭЗЭЭ Ч (§14)
            if (NormWords.IsMatch(q))
            {
                bool authorized = false;
                if (issues != null && snap != null && snap.Selection != null && snap.Selection.Count == 1)
                    foreach (RevitComplianceIssue iss in issues)
                        if (iss != null && iss.Class == IssueClass.VERIFIED_NORM && iss.Authoritative && iss.Source != null && iss.Source.Kind == RuleSourceKind.VERIFIED_NORM && iss.ElementIds != null && iss.ElementIds.Contains(snap.Selection[0].ElementId)) authorized = true;
                if (!authorized) { r.Codes.Add(ActionValidationCode.NORM_AUTHORIZATION_INSUFFICIENT); r.NoteMn = "Нормын зөвшөөрөл алга — продакшны BIM дүрэм NO_EXECUTABLE_BIM_RULES; REVIEW_CANDIDATE нормын засварыг зөвшөөрөхгүй."; return r; }
            }

            // 3. Зорилт — ЯГ НЭГ сонгосон элемент, шинэ snapshot-оос
            if (snap == null || snap.Selection == null || snap.Selection.Count == 0) { r.Codes.Add(ActionValidationCode.NO_TARGETS); r.NoteMn = "Сонгосон элемент алга — HUMAN_REVIEW_REQUIRED."; return r; }
            if (snap.Selection.Count > 1) { r.Codes.Add(ActionValidationCode.TARGET_AMBIGUOUS); r.NoteMn = "Олон элемент сонгогдсон — зорилт хоёрдмол (HUMAN_REVIEW_REQUIRED)."; return r; }
            RevitElementSummary sel = snap.Selection[0];

            // 4. Аргументыг канончилж, АСУУЛТААР үндэслэнэ
            var p = new Dictionary<string, string>(StringComparer.Ordinal);
            var args = cand.Arguments ?? new Dictionary<string, string>();
            switch (kind)
            {
                case RevitActionKind.SET_PARAMETER:
                    {
                        string name = Get(args, "parameter"), value = Get(args, "value");
                        if (name == null || Array.IndexOf(ParameterAllowlist, name) < 0) { r.Codes.Add(ActionValidationCode.PARAMETER_NOT_FOUND); r.NoteMn = "Параметр цагаан жагсаалтад байхгүй."; return r; }
                        if (value == null || value.Length == 0 || value.Length > 512) { r.Codes.Add(ActionValidationCode.INSUFFICIENT_ACTION_PARAMETERS); r.NoteMn = "Утга дутуу."; return r; }
                        if (!ContainsValue(q, value)) { r.Codes.Add(ActionValidationCode.CANDIDATE_NOT_GROUNDED_IN_REQUEST); r.NoteMn = "Саналын утга хэрэглэгчийн хүсэлтэд байхгүй — таамаг."; return r; }
                        foreach (string k in args.Keys) if (k != "parameter" && k != "value") { r.Codes.Add(ActionValidationCode.UNKNOWN_PARAMETER_FOR_ACTION); return r; }
                        p["name"] = name; p["value"] = value;
                        break;
                    }
                case RevitActionKind.MOVE_ELEMENT:
                    {
                        double dx = Num(Get(args, "dx_mm")), dy = Num(Get(args, "dy_mm")), dz = Num(Get(args, "dz_mm"));
                        foreach (string k in args.Keys) if (k != "dx_mm" && k != "dy_mm" && k != "dz_mm") { r.Codes.Add(ActionValidationCode.UNKNOWN_PARAMETER_FOR_ACTION); return r; }
                        if (double.IsNaN(dx) || double.IsNaN(dy) || double.IsNaN(dz)) { r.Codes.Add(ActionValidationCode.VALUE_SCHEMA_INVALID); r.NoteMn = "Зөрүү тоо биш."; return r; }
                        int axes = (dx != 0 ? 1 : 0) + (dy != 0 ? 1 : 0) + (dz != 0 ? 1 : 0);
                        if (axes != 1) { r.Codes.Add(ActionValidationCode.INSUFFICIENT_ACTION_PARAMETERS); r.NoteMn = "Чиглэл/зай тодорхойгүй — яг нэг тэнхлэгийн зөрүү хэрэгтэй."; return r; }
                        double d = dx != 0 ? dx : (dy != 0 ? dy : dz);
                        string axis = dx != 0 ? "x" : (dy != 0 ? "y" : "z");
                        // Хэрэглэгч тоо + чиглэлээ ИЛ хэлсэн байх ёстой — «жаахан зөө» → INSUFFICIENT (§13)
                        if (!QuestionHasMm(q, Math.Abs(d)) || !QuestionHasAxis(q, axis)) { r.Codes.Add(ActionValidationCode.INSUFFICIENT_ACTION_PARAMETERS); r.NoteMn = "Хэрэглэгч зай (мм) болон чиглэл (X/Y/Z)-ээ хэлээгүй — таамаглахгүй."; return r; }
                        if (Math.Abs(d) > ActionSafety.MaxMoveDeltaMm) { r.Codes.Add(ActionValidationCode.DELTA_OUT_OF_BOUNDS); r.NoteMn = "Зөрүү " + ActionSafety.MaxMoveDeltaMm + " мм-ээс их."; return r; }
                        p["dx_mm"] = Fmt(dx); p["dy_mm"] = Fmt(dy); p["dz_mm"] = Fmt(dz);
                        break;
                    }
                case RevitActionKind.CHANGE_TYPE:
                    {
                        string tn = Get(args, "type_name");
                        foreach (string k in args.Keys) if (k != "type_name") { r.Codes.Add(ActionValidationCode.UNKNOWN_PARAMETER_FOR_ACTION); return r; }
                        if (string.IsNullOrWhiteSpace(tn)) { r.Codes.Add(ActionValidationCode.INSUFFICIENT_ACTION_PARAMETERS); r.NoteMn = "Төрлийн нэр дутуу."; return r; }
                        if (!ContainsValue(q, tn)) { r.Codes.Add(ActionValidationCode.CANDIDATE_NOT_GROUNDED_IN_REQUEST); r.NoteMn = "Төрлийн нэр хэрэглэгчийн хүсэлтэд байхгүй."; return r; }
                        p["type_name"] = tn.Trim();
                        break;
                    }
            }

            // 5. Envelope — ИТГЭМЖЛЭГДСЭН талбарууд ЭНД л үүснэ; загварын reason нь текст л
            var e = new RevitActionEnvelope
            {
                ActionId = "act_" + Guid.NewGuid().ToString("N").Substring(0, 10),
                Action = kind,
                DocKey = docKey,
                TargetElementIds = { sel.ElementId },
                TargetUniqueIds = { sel.UniqueId },
                Parameters = p,
                Reason = new ActionReason { SummaryMn = Clip(string.IsNullOrWhiteSpace(cand.ReasonMn) ? "Загварын санал (хэрэглэгчийн хүсэлтээр)" : cand.ReasonMn, 200) },
                RequestedBy = new ActionRequester { Kind = "MODEL" },
                SafetyLevel = ActionSafetyLevel.CONFIRM_WRITE, // MODEL ҮРГЭЛЖ CONFIRM_WRITE — өсгөж БОЛОХГҮЙ
                RiskLevel = kind == RevitActionKind.SET_PARAMETER ? ActionRiskLevel.LOW : ActionRiskLevel.MEDIUM,
                ProposalSource = ProposalSource.MODEL,
                CreatedAt = DateTime.UtcNow.ToString("o"),
            };
            e.Evidence.Add(new ActionEvidence { Kind = "SELECTION", Ref = sel.ElementId.ToString(), TextMn = "Сонгосон элемент: " + sel.Category + " " + sel.Name });
            e.Evidence.Add(new ActionEvidence { Kind = "USER_INPUT", Ref = "question", TextMn = Clip(q, 120) });
            r.Envelope = e;
            return r;
        }

        /* ---- туслах (цэвэр) ---- */

        /// <summary>Утга хэрэглэгчийн асуултад БАЙГАА эсэх — ишлэл ('…' «…» "…") дотор ч, шууд ч (том/жижиг үсэг ялгахгүй).</summary>
        public static bool ContainsValue(string question, string value)
        {
            if (string.IsNullOrEmpty(question) || string.IsNullOrEmpty(value)) return false;
            string v = value.Trim();
            return question.IndexOf(v, StringComparison.OrdinalIgnoreCase) >= 0;
        }

        public static bool QuestionHasMm(string question, double mm)
        {
            foreach (Match m in NumberMm.Matches(question ?? ""))
            {
                double v;
                if (double.TryParse(m.Groups[1].Value.Replace(',', '.'), NumberStyles.Float, CultureInfo.InvariantCulture, out v) && Math.Abs(v - mm) < 1e-9) return true;
            }
            return false;
        }

        public static bool QuestionHasAxis(string question, string axis)
        {
            string q = (question ?? "").ToLowerInvariant();
            string a = axis.ToLowerInvariant();
            // Кирилл гар: «Х» (U+0445) ≡ X, «У» (U+0443) ≡ Y — ижил дүрстэй үсгийг ч тэнхлэг гэж хүлээн авна (Z-д ийм хос алга)
            if (a == "x") a = "(x|х)"; else if (a == "y") a = "(y|у)";
            // «Y чиглэлд», «Y тэнхлэгээр», «Y-ээр», «along Y»
            return Regex.IsMatch(q, @"(^|[\s(,;:])" + a + @"(\s*[-–]?\s*(чиглэл|тэнхлэг|ээр|аар|оор|өөр|axis|direction))", RegexOptions.CultureInvariant)
                || Regex.IsMatch(q, @"(along|direction|axis)\s+" + a + @"\b", RegexOptions.CultureInvariant);
        }

        private static string Get(Dictionary<string, string> d, string k) { string v; return d != null && d.TryGetValue(k, out v) ? v : null; }
        private static double Num(string s) { if (s == null) return 0; double v; return double.TryParse(s.Trim(), NumberStyles.Float, CultureInfo.InvariantCulture, out v) ? v : double.NaN; }
        private static string Fmt(double v) { return v.ToString(CultureInfo.InvariantCulture); }
        private static string Clip(string s, int n) { return s == null ? null : (s.Length <= n ? s : s.Substring(0, n)); }
    }
}
