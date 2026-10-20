using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text;
using RevitMcpAddin.Intelligence.Contracts;

namespace RevitMcpAddin.Intelligence.Core
{
    /* ================================================================== */
    /*  R4.1 — ЦЭВЭР ДАМЖЛАГА: урьдчилсан нөхцөл · preview үүсгэлт ·       */
    /*  баталгааны тулгалт · postcondition · аудит.  Revit API ЭНД БАЙХГҮЙ. */
    /* ================================================================== */

    public static class ActionPreconditions
    {
        private static readonly HashSet<string> ProhibitedCategories = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            // Хамгаалалттай/бүтцийн категори — R4.1-д хөндөхгүй (жижиг, буцаах боломжтой үйлдлээс эхэлнэ).
            "Levels", "Grids", "Project Information", "Views", "Sheets", "Revit Links", "RVT Links", "Worksets", "Phases", "Design Options",
        };

        /// <summary>SET_PARAMETER: ЗӨВХӨН энэ жагсаалтын параметр (R4.1 — аюулгүй, буцаах боломжтой текст/тоо).</summary>
        public static readonly string[] WritableParameterAllowlist = { "Comments", "Mark", "Description" };

        /// <summary>
        /// Бодлого + баримт дээрх ШАЛГАЛТ (§8) — preview-ийн ӨМНӨ, гүйцэтгэлийн ӨМНӨ (ижил функц ХОЁР удаа).
        /// Кодгүй = OK.  Envelope-ийн схемийн шалгалт (`RevitActionValidator.Validate`) ТУСДАА.
        /// </summary>
        public static List<ActionValidationCode> Check(RevitActionEnvelope a, DocumentFacts doc, ElementFacts el, IReadOnlyList<RevitComplianceIssue> issues)
        {
            var codes = new List<ActionValidationCode>();
            if (a == null) { codes.Add(ActionValidationCode.MISSING_ACTION_ID); return codes; }

            if (!ActionSafety.IsWrite(a.Action)) return codes; // унших үйлдэл — энд хамааралгүй
            if (!ActionSafety.IsEnabledWrite(a.Action)) { codes.Add(ActionValidationCode.WRITE_ACTION_DISABLED_IN_THIS_RELEASE); return codes; }
            if (a.SafetyLevel > ActionSafety.MaxLevel) codes.Add(ActionValidationCode.SAFETY_LEVEL_EXCEEDS_SESSION_MAX);

            // Үндэслэл (§13): зорилт нь сонголт / хэрэгслийн үр дүн / хэрэглэгчийн ил заалтаас
            if (a.Evidence == null || a.Evidence.Count == 0) codes.Add(ActionValidationCode.TARGET_NOT_GROUNDED);
            if (a.TargetElementIds == null || a.TargetElementIds.Count == 0) codes.Add(ActionValidationCode.NO_TARGETS);
            else if (a.TargetElementIds.Count > 1) codes.Add(ActionValidationCode.TARGET_AMBIGUOUS); // R4.1: яг НЭГ элемент

            // Норм: REVIEW_CANDIDATE нормын засварыг ЗӨВШӨӨРӨХГҮЙ; VERIFIED_NORM л; MODEL_QUALITY нь дэмжинэ (баталгаа хэвээр)
            if (a.Reason != null && !string.IsNullOrEmpty(a.Reason.IssueId) && issues != null)
            {
                foreach (RevitComplianceIssue iss in issues)
                {
                    if (iss == null || iss.IssueId != a.Reason.IssueId) continue;
                    bool synthetic = iss.Source != null && iss.Source.Kind == RuleSourceKind.SYNTHETIC;
                    if (iss.Class == IssueClass.REVIEW_CANDIDATE || synthetic || (iss.Class == IssueClass.VERIFIED_NORM && !iss.Authoritative))
                        codes.Add(ActionValidationCode.NORM_AUTHORIZATION_INSUFFICIENT);
                    break;
                }
            }

            // Баримт
            if (doc == null || doc.IsReadOnly || !doc.IsModifiable || doc.IsLinked || doc.IsFamily) codes.Add(ActionValidationCode.DOCUMENT_NOT_WRITABLE);

            // Элемент
            if (el == null || !el.Exists) { codes.Add(ActionValidationCode.ELEMENT_NOT_FOUND); return codes; }
            if (el.IsLinked) codes.Add(ActionValidationCode.LINKED_ELEMENT_NOT_WRITABLE);
            if (!el.Editable) codes.Add(ActionValidationCode.WORKSHARING_BLOCKED);
            if (el.IsElementType) codes.Add(ActionValidationCode.ELEMENT_NOT_EDITABLE);
            if (!string.IsNullOrEmpty(el.Category) && ProhibitedCategories.Contains(el.Category)) codes.Add(ActionValidationCode.PROHIBITED_CATEGORY);
            if (a.TargetUniqueIds != null && a.TargetUniqueIds.Count > 0 && !string.IsNullOrEmpty(el.UniqueId) && a.TargetUniqueIds[0] != el.UniqueId)
                codes.Add(ActionValidationCode.STALE_ACTION_PREVIEW); // ElementId дахин ашиглагдсан

            switch (a.Action)
            {
                case RevitActionKind.SET_PARAMETER:
                    CheckSetParameter(a, el, codes);
                    break;
                case RevitActionKind.MOVE_ELEMENT:
                    CheckMove(a, el, codes);
                    break;
                case RevitActionKind.CHANGE_TYPE:
                    CheckChangeType(a, el, codes);
                    break;
            }
            return codes;
        }

        private static void CheckSetParameter(RevitActionEnvelope a, ElementFacts el, List<ActionValidationCode> codes)
        {
            string name = Get(a, "name");
            string value = Get(a, "value");
            if (string.IsNullOrEmpty(name) || Array.IndexOf(WritableParameterAllowlist, name) < 0) { codes.Add(ActionValidationCode.PARAMETER_NOT_FOUND); return; }
            ParamFacts p;
            if (!el.Params.TryGetValue(name, out p)) { codes.Add(ActionValidationCode.PARAMETER_NOT_FOUND); return; }
            if (p.ReadOnly) codes.Add(ActionValidationCode.PARAMETER_READ_ONLY);
            if (p.IsTypeParam) codes.Add(ActionValidationCode.ELEMENT_NOT_EDITABLE); // төрлийн параметр = олон элемент, R4.1-д хориотой
            if (value == null) { codes.Add(ActionValidationCode.VALUE_SCHEMA_INVALID); return; }
            switch (p.Storage)
            {
                case ParamStorage.STRING:
                    if (value.Length > 512 || value.IndexOf('\0') >= 0) codes.Add(ActionValidationCode.VALUE_SCHEMA_INVALID);
                    break;
                case ParamStorage.INTEGER:
                    { int i; if (!int.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out i)) codes.Add(ActionValidationCode.STORAGE_TYPE_MISMATCH); }
                    break;
                case ParamStorage.DOUBLE:
                    { double d; if (!double.TryParse(value, NumberStyles.Float, CultureInfo.InvariantCulture, out d) || double.IsNaN(d) || double.IsInfinity(d)) codes.Add(ActionValidationCode.STORAGE_TYPE_MISMATCH); }
                    break;
                default:
                    codes.Add(ActionValidationCode.STORAGE_TYPE_MISMATCH); // ELEMENT_ID / NONE — R4.1-д бичихгүй
                    break;
            }
        }

        private static void CheckMove(RevitActionEnvelope a, ElementFacts el, List<ActionValidationCode> codes)
        {
            if (el.IsPinned) codes.Add(ActionValidationCode.ELEMENT_PINNED);
            if (!el.HasPointOrCurveLocation) codes.Add(ActionValidationCode.ELEMENT_NOT_EDITABLE);
            double[] d = MoveDelta(a);
            if (d == null) { codes.Add(ActionValidationCode.VALUE_SCHEMA_INVALID); return; }
            bool any = false;
            foreach (double v in d)
            {
                if (double.IsNaN(v) || double.IsInfinity(v)) { codes.Add(ActionValidationCode.VALUE_SCHEMA_INVALID); return; }
                if (Math.Abs(v) > ActionSafety.MaxMoveDeltaMm) { codes.Add(ActionValidationCode.DELTA_OUT_OF_BOUNDS); return; }
                if (Math.Abs(v) > 0) any = true;
            }
            if (!any) codes.Add(ActionValidationCode.VALUE_SCHEMA_INVALID); // 0 зөрүү = үйлдэлгүй
        }

        /// <summary>
        /// CHANGE_TYPE: `type_name` → `type_id` (элементийн ValidTypes дотроос, нэр ЯГ таарах ёстой; олон таарвал
        /// TARGET_AMBIGUOUS).  Детерминист канончлол — LLM/хэрэглэгч id мэдэх шаардлагагүй, id-г Revit л өгнө.
        /// </summary>
        public static ActionValidationCode? CanonicalizeChangeType(RevitActionEnvelope a, ElementFacts el)
        {
            if (a == null || a.Action != RevitActionKind.CHANGE_TYPE || el == null || a.Parameters == null) return null;
            string name = Get(a, "type_name");
            if (string.IsNullOrWhiteSpace(name) || !string.IsNullOrEmpty(Get(a, "type_id"))) return null;
            TypeFacts hit = null; int n = 0;
            foreach (TypeFacts t in el.ValidTypes)
                if (string.Equals(t.Name, name.Trim(), StringComparison.Ordinal)) { hit = t; n++; }
            if (n == 0) return ActionValidationCode.TYPE_NOT_FOUND;
            if (n > 1) return ActionValidationCode.TARGET_AMBIGUOUS;
            a.Parameters["type_id"] = hit.TypeId.ToString(CultureInfo.InvariantCulture);
            return null;
        }

        private static void CheckChangeType(RevitActionEnvelope a, ElementFacts el, List<ActionValidationCode> codes)
        {
            long tid;
            string raw = Get(a, "type_id");
            if (string.IsNullOrEmpty(raw) || !long.TryParse(raw, NumberStyles.Integer, CultureInfo.InvariantCulture, out tid)) { codes.Add(ActionValidationCode.TYPE_NOT_FOUND); return; }
            if (el.TypeId.HasValue && el.TypeId.Value == tid) { codes.Add(ActionValidationCode.VALUE_SCHEMA_INVALID); return; } // ижил төрөл = үйлдэлгүй
            TypeFacts found = null;
            foreach (TypeFacts t in el.ValidTypes) if (t.TypeId == tid) { found = t; break; }
            if (found == null) { codes.Add(ActionValidationCode.TYPE_INCOMPATIBLE); return; }
            if (!string.IsNullOrEmpty(el.Category) && !string.IsNullOrEmpty(found.Category) && !string.Equals(el.Category, found.Category, StringComparison.Ordinal))
                codes.Add(ActionValidationCode.TYPE_INCOMPATIBLE);
        }

        public static double[] MoveDelta(RevitActionEnvelope a)
        {
            double dx, dy, dz;
            if (!double.TryParse(Get(a, "dx_mm") ?? "0", NumberStyles.Float, CultureInfo.InvariantCulture, out dx)) return null;
            if (!double.TryParse(Get(a, "dy_mm") ?? "0", NumberStyles.Float, CultureInfo.InvariantCulture, out dy)) return null;
            if (!double.TryParse(Get(a, "dz_mm") ?? "0", NumberStyles.Float, CultureInfo.InvariantCulture, out dz)) return null;
            return new[] { dx, dy, dz };
        }

        public static string Get(RevitActionEnvelope a, string key)
        {
            string v;
            return a.Parameters != null && a.Parameters.TryGetValue(key, out v) ? v : null;
        }
    }

    /// <summary>Preview үүсгэх, баталгааг тулгах — ХОЛБООС (§14).</summary>
    public static class ActionPreviewBuilder
    {
        public const int PreviewTtlMinutes = 10;

        public static ActionElementState StateOf(ElementFacts el, string valueForAction)
        {
            var st = new ActionElementState
            {
                ElementId = el.ElementId, UniqueId = el.UniqueId, Category = el.Category, Family = el.Family, Type = el.Type, TypeId = el.TypeId,
                Value = valueForAction, LocationMm = el.LocationMm,
            };
            st.Fingerprint = ActionHash.StateFingerprint(st.Value, st.LocationMm, st.TypeId);
            return st;
        }

        /// <summary>Үйлдлийн ӨМНӨХ утга — SET_PARAMETER: параметрийн утга; MOVE: null (байршил тусдаа); CHANGE_TYPE: төрлийн нэр.</summary>
        public static string BeforeValue(RevitActionEnvelope a, ElementFacts el)
        {
            if (a.Action == RevitActionKind.SET_PARAMETER)
            {
                ParamFacts p; string name = ActionPreconditions.Get(a, "name");
                return name != null && el.Params.TryGetValue(name, out p) ? (p.Value ?? "") : null;
            }
            if (a.Action == RevitActionKind.CHANGE_TYPE) return el.Type;
            return null;
        }

        public static ActionPreview Build(RevitActionEnvelope a, DocumentFacts doc, ElementFacts el, List<ActionValidationCode> codes, DateTime nowUtc)
        {
            var pv = new ActionPreview
            {
                PreviewId = "pv_" + Guid.NewGuid().ToString("N").Substring(0, 12),
                ActionId = a.ActionId, Action = a.Action, DocKey = doc != null ? doc.DocKey : a.DocKey,
                DocFingerprint = doc != null ? doc.Fingerprint : null,
                ReasonMn = a.Reason != null ? a.Reason.SummaryMn : null,
                Risk = a.RiskLevel,
                ProposalHash = ActionHash.ProposalHash(a),
                Nonce = ActionHash.Nonce(),
                IssuedAt = nowUtc.ToString("o"),
                ExpiresAt = nowUtc.AddMinutes(PreviewTtlMinutes).ToString("o"),
                Validation = new ActionValidation { Ok = codes.Count == 0, ExecutableNow = codes.Count == 0 },
            };
            pv.Validation.Codes.AddRange(codes.Count == 0 ? new[] { ActionValidationCode.OK } : codes.ToArray());
            if (el != null && el.Exists)
            {
                pv.Before = StateOf(el, BeforeValue(a, el));
                switch (a.Action)
                {
                    case RevitActionKind.SET_PARAMETER:
                        pv.ParameterName = ActionPreconditions.Get(a, "name");
                        pv.AfterValue = ActionPreconditions.Get(a, "value");
                        break;
                    case RevitActionKind.MOVE_ELEMENT:
                        {
                            double[] d = ActionPreconditions.MoveDelta(a);
                            if (d != null && el.LocationMm != null) pv.AfterLocationMm = new[] { el.LocationMm[0] + d[0], el.LocationMm[1] + d[1], el.LocationMm[2] + d[2] };
                            break;
                        }
                    case RevitActionKind.CHANGE_TYPE:
                        {
                            long tid; string raw = ActionPreconditions.Get(a, "type_id");
                            if (raw != null && long.TryParse(raw, NumberStyles.Integer, CultureInfo.InvariantCulture, out tid))
                            {
                                pv.AfterTypeId = tid;
                                foreach (TypeFacts t in el.ValidTypes) if (t.TypeId == tid) { pv.AfterTypeName = t.Name; break; }
                            }
                            foreach (TypeFacts t in el.ValidTypes)
                            {
                                if (pv.ValidTypes.Count >= 30) break;
                                pv.ValidTypes.Add(new ActionTypeOption { TypeId = t.TypeId, Name = t.Name, Family = t.Family, Current = el.TypeId.HasValue && el.TypeId.Value == t.TypeId });
                            }
                            break;
                        }
                }
                pv.BindingHash = ActionHash.Binding(pv.DocFingerprint, el.UniqueId, pv.Before.Fingerprint, pv.ProposalHash, pv.Nonce);
            }
            pv.LinesMn = RenderLines(pv);
            return pv;
        }

        public static List<string> RenderLines(ActionPreview pv)
        {
            var l = new List<string>();
            l.Add("Санал болгож буй өөрчлөлт");
            if (pv.Before != null) l.Add("Элемент: " + (pv.Before.Category ?? "?") + " · " + (pv.Before.Family ?? "") + " " + (pv.Before.Type ?? "") + " (ElementId " + pv.Before.ElementId + ")");
            switch (pv.Action)
            {
                case RevitActionKind.SET_PARAMETER:
                    l.Add("Өөрчлөлт: " + pv.ParameterName);
                    l.Add("Өмнө: «" + (pv.Before != null ? pv.Before.Value : "") + "»");
                    l.Add("Дараа: «" + (pv.AfterValue ?? "") + "»");
                    break;
                case RevitActionKind.MOVE_ELEMENT:
                    l.Add("Өмнө: " + Fmt(pv.Before != null ? pv.Before.LocationMm : null));
                    l.Add("Дараа: " + Fmt(pv.AfterLocationMm));
                    break;
                case RevitActionKind.CHANGE_TYPE:
                    l.Add("Өмнө: " + (pv.Before != null ? pv.Before.Family + " / " + pv.Before.Type : ""));
                    l.Add("Дараа: " + (pv.AfterTypeName ?? ("type " + pv.AfterTypeId)));
                    break;
            }
            l.Add("Шалтгаан: " + (pv.ReasonMn ?? "—"));
            l.Add("Эрсдэл: " + pv.Risk);
            if (pv.Validation != null && !pv.Validation.Ok) l.Add("⛔ Шалгалт: " + string.Join(", ", pv.Validation.Codes));
            return l;
        }

        private static string Fmt(double[] p)
        {
            if (p == null) return "—";
            return "(" + string.Join(", ", Array.ConvertAll(p, v => Math.Round(v, 1).ToString(CultureInfo.InvariantCulture))) + ") мм";
        }

        /// <summary>
        /// Баталгааг ОДООГИЙН төлөвтэй тулгана (§14): preview байгаа · хугацаа · binding hash · баримт · элемент · өмнөх төлөв.
        /// Хоосон жагсаалт = гүйцэтгэж болно.
        /// </summary>
        public static List<ActionValidationCode> VerifyConfirmation(ActionPreview pv, ActionConfirmation c, DocumentFacts doc, ElementFacts elNow, RevitActionEnvelope a, DateTime nowUtc)
        {
            var codes = new List<ActionValidationCode>();
            if (c == null || pv == null) { codes.Add(ActionValidationCode.NOT_CONFIRMED); return codes; }
            if (c.ConfirmedBy != "USER_UI" && c.ConfirmedBy != "DEV_BRIDGE_TOKEN") { codes.Add(ActionValidationCode.NOT_CONFIRMED); return codes; }
            if (c.PreviewId != pv.PreviewId || string.IsNullOrEmpty(c.BindingHash) || c.BindingHash != pv.BindingHash) { codes.Add(ActionValidationCode.STALE_ACTION_PREVIEW); return codes; }
            DateTime exp;
            if (DateTime.TryParse(pv.ExpiresAt, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out exp) && nowUtc > exp) codes.Add(ActionValidationCode.PREVIEW_EXPIRED);
            if (pv.Validation == null || !pv.Validation.Ok) codes.Add(ActionValidationCode.PRECONDITION_FAILED);
            if (doc == null || doc.Fingerprint != pv.DocFingerprint) codes.Add(ActionValidationCode.STALE_ACTION_PREVIEW);
            if (elNow == null || !elNow.Exists) { codes.Add(ActionValidationCode.ELEMENT_NOT_FOUND); return codes; }
            if (pv.Before == null || elNow.UniqueId != pv.Before.UniqueId) { codes.Add(ActionValidationCode.STALE_ACTION_PREVIEW); return codes; }
            ActionElementState nowState = StateOf(elNow, BeforeValue(a, elNow));
            if (nowState.Fingerprint != pv.Before.Fingerprint) codes.Add(ActionValidationCode.STALE_ACTION_PREVIEW);
            if (ActionHash.ProposalHash(a) != pv.ProposalHash) codes.Add(ActionValidationCode.STALE_ACTION_PREVIEW);
            return codes;
        }

        /// <summary>Postcondition — regenerate + дахин уншсан төлөв нь ХҮЛЭЭСЭНтэй таарах ёстой.</summary>
        public static bool Postcondition(RevitActionEnvelope a, ActionPreview pv, ElementFacts after, out string reason)
        {
            reason = null;
            if (after == null || !after.Exists) { reason = "элемент алга"; return false; }
            switch (a.Action)
            {
                case RevitActionKind.SET_PARAMETER:
                    {
                        ParamFacts p;
                        if (!after.Params.TryGetValue(pv.ParameterName ?? "", out p)) { reason = "параметр алга"; return false; }
                        if (!ValuesEqual(p, pv.AfterValue)) { reason = "утга таарсангүй: «" + p.Value + "» ≠ «" + pv.AfterValue + "»"; return false; }
                        return true;
                    }
                case RevitActionKind.MOVE_ELEMENT:
                    {
                        if (after.LocationMm == null || pv.AfterLocationMm == null) { reason = "байршил уншигдсангүй"; return false; }
                        for (int i = 0; i < 3; i++)
                            if (Math.Abs(after.LocationMm[i] - pv.AfterLocationMm[i]) > 1.0) { reason = "байршлын зөрүү " + Math.Round(after.LocationMm[i] - pv.AfterLocationMm[i], 2) + " мм (тэнхлэг " + i + ")"; return false; }
                        return true;
                    }
                case RevitActionKind.CHANGE_TYPE:
                    if (!after.TypeId.HasValue || !pv.AfterTypeId.HasValue || after.TypeId.Value != pv.AfterTypeId.Value) { reason = "төрөл солигдсонгүй"; return false; }
                    return true;
            }
            reason = "үйлдэл дэмжигдэхгүй";
            return false;
        }

        private static bool ValuesEqual(ParamFacts p, string expected)
        {
            if (p.Storage == ParamStorage.DOUBLE)
            {
                double x, y;
                return double.TryParse(p.Value, NumberStyles.Float, CultureInfo.InvariantCulture, out x) && double.TryParse(expected, NumberStyles.Float, CultureInfo.InvariantCulture, out y) && Math.Abs(x - y) < 1e-9;
            }
            return string.Equals(p.Value ?? "", expected ?? "", StringComparison.Ordinal);
        }
    }

    /// <summary>Аудит — JSONL, процесс тутам; нууц/JWT/геометр ХЭЗЭЭ Ч (§16).</summary>
    public sealed class ActionAudit
    {
        private readonly string _path;
        private readonly object _gate = new object();
        private long _seq;
        public readonly List<ActionAuditRecord> Memory = new List<ActionAuditRecord>();

        public ActionAudit(IIntelligenceStoragePaths paths, string processTag)
        {
            _path = paths != null && paths.RootDir != null ? Path.Combine(paths.RootDir, "actions-" + processTag + ".jsonl") : null;
        }

        public string Path_ { get { return _path; } }

        public ActionAuditRecord Write(ActionAuditRecord r, DateTime? nowUtc = null)
        {
            lock (_gate)
            {
                r.Seq = ++_seq;
                r.At = (nowUtc ?? DateTime.UtcNow).ToString("o");
                Memory.Add(r);
                if (_path != null)
                {
                    try
                    {
                        Directory.CreateDirectory(Path.GetDirectoryName(_path));
                        File.AppendAllText(_path, Serialize(r) + "\n", new UTF8Encoding(false));
                    }
                    catch { /* аудит унасан ч үйлдлийн үр дүнг нуухгүй — Memory-д хэвээр */ }
                }
                return r;
            }
        }

        public static string Serialize(ActionAuditRecord r) { return IntelligenceJson.Serialize(r); }

        /// <summary>Аудитын мөрөнд ОРОХ ЁСГҮЙ зүйлийн хамгаалалт — тест ба бичихийн өмнөх шалгалт.</summary>
        public static bool LooksSafe(string json)
        {
            if (string.IsNullOrEmpty(json)) return true;
            string l = json.ToLowerInvariant();
            return !(l.Contains("x-mglai-secret") || l.Contains("\"secret\"") || l.Contains("\"token\"") || l.Contains("eyj") || l.Contains("bearer "));
        }
    }
}
