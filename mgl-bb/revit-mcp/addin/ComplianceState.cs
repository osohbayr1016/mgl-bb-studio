using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Security.Cryptography;
using System.Text;

namespace RevitMcpAddin
{
    /// <summary>
    /// Олдворын АМЬДРАЛЫН МӨЧЛӨГ (v2 §57).
    ///
    /// ⚠️ ЗӨВХӨН ТАВ.  §57 нь долоог нэрлэдэг ч `MUTED` ба `EXPIRED` хоёр нь
    /// ХҮНИЙ шийдвэрээс төрдөг (`finding_overrides`, `2-5`-ын харьяа) тул
    /// хөдөлгүүр тэднийг ХЭЗЭЭ Ч ӨӨРӨӨ онооход хүрэхгүй.  Энд байхгүй нь
    /// «мартсан» БИШ — хөдөлгүүрийн бичих эрхийн ХИЛ.
    /// </summary>
    internal enum LifecycleState
    {
        Open = 0,
        Acknowledged = 1,
        Fixed = 2,
        Reopened = 3,
        Stale = 4,
    }

    /// <summary>
    /// ISO-8601 (UTC, «Z») цаг — НЭГ хэлбэр, НЭГ газар.
    ///
    /// ⚠️ Олдворын бүх мөч ба `learning_events.occurred_at`-ийн формат нь
    /// `BimEmitter`-ийнхтэй ҮГ ҮСГЭЭР таарах ЁСТОЙ: сервер тал хоёуланг нь
    /// нэг л задлагчаар уншина.
    /// </summary>
    internal static class ComplianceIso
    {
        internal static string Now()
        {
            return DateTime.UtcNow.ToString("yyyy-MM-dd'T'HH:mm:ss'Z'", CultureInfo.InvariantCulture);
        }
    }

    /// <summary>ЖИЖИГ JSON бичигч — халуун бус зам, гэхдээ хуваарилалт багатай.</summary>
    internal static class CJson
    {
        internal static void Str(StringBuilder sb, string name, string value)
        {
            Quoted(sb, name);
            sb.Append(':');
            Quoted(sb, value);
        }

        /// <summary>ЗӨВХӨН утга — түлхүүр ч, таслал ч БИЧИХГҮЙ.</summary>
        internal static void Quoted(StringBuilder sb, string value)
        {
            if (value == null) { sb.Append("null"); return; }
            sb.Append('"');
            for (int i = 0; i < value.Length; i++)
            {
                char c = value[i];
                switch (c)
                {
                    case '"': sb.Append("\\\""); break;
                    case '\\': sb.Append("\\\\"); break;
                    case '\n': sb.Append("\\n"); break;
                    case '\r': sb.Append("\\r"); break;
                    case '\t': sb.Append("\\t"); break;
                    default:
                        if (c < 0x20)
                            sb.Append("\\u").Append(((int)c).ToString("x4", CultureInfo.InvariantCulture));
                        else sb.Append(c);
                        break;
                }
            }
            sb.Append('"');
        }

        /// <summary>
        /// ⚠️ `null` ба ТЭГ нь ХОЁР ӨӨР ЗҮЙЛ (v2 §63).  `QtoExtractor`-ийн
        /// `Round3OrNull` нь бодит тэгийг NULL болгодог — ЭНЭ ЗАМД ДАХИН
        /// АШИГЛАХГҮЙ.  Энд 0 нь `0` гэж бичигдэнэ.
        /// </summary>
        internal static void Num(StringBuilder sb, string name, double? value)
        {
            sb.Append('"').Append(name).Append("\":");
            if (!value.HasValue || double.IsNaN(value.Value) || double.IsInfinity(value.Value))
            {
                sb.Append("null");
                return;
            }
            sb.Append(value.Value.ToString("R", CultureInfo.InvariantCulture));
        }
    }

    /// <summary>
    /// НЭГ олдвор — санах ой дахь ЖИНХЭНЭ мөр.
    ///
    /// ⚠️ `ElementUid` (ТОГТВОРТОЙ) нь зангуу; `ElementId` нь ЗӨВХӨН энэ
    /// сессийн доторх хурдан хайлт (`0204:104-105`).  Тойрог хийсний дараа
    /// `ElementId` нь ӨӨР элемент рүү заана — түүгээр олдвор зангуулж
    /// БОЛОХГҮЙ.
    /// </summary>
    internal sealed class FindingRow
    {
        public string DedupKey;
        public string FindingUid;

        public string DocKey;
        public string ElementUid;
        public long ElementId;

        public string RuleUid;
        public int RuleVersion;

        /// <summary>`Verdict`-ийн МӨР хэлбэр: PASS | WARNING | VIOLATION | UNCERTAIN.</summary>
        public string Verdict;
        public string Severity;
        public string IssueClass;
        public string EvidenceLevel;
        public string UncertainReason;
        public string[] MissingInputs;
        public string[] ConflictRuleUids;

        public double? ObservedValue;
        public double? ThresholdValue;
        public string Unit;

        /// <summary>⚠️ `2-2`-ийн clamp-аас ГАРСАН утга.  Энд ДАХИН хавчихгүй.</summary>
        public bool SuppressCitation;
        public string CitationLabelMn;

        public LifecycleState LifecycleState;

        // ── БИЧИХ ҮЕДЭЭ ХӨЛДӨӨДӨГ талбарууд (§3.4) ──────────────────
        // ⚠️ Хожим JOIN-оор шийдэх нь ТҮҮХИЙГ ЧИМЭЭГҮЙ ДАХИН ШОШГОЛНО:
        //    дүрэм хэвлэгдэж `ruleset_version` солигдвол өчигдрийн олдвор
        //    өнөөдрийн багцаар тайлбарлагдана.
        public string VerificationState;
        public string RulesetVersion;
        public string PackSha256;
        public string TeamCode;
        public string TeamSource;

        public string FirstSeenAt;
        public string LastEvaluatedAt;
        public string ResolvedAt;
        public int ScanGeneration;

        /// <summary>null = ХУУЧИРААГҮЙ (§58).</summary>
        public string StaleAt;
        /// <summary>sync | edit | ruleset | central</summary>
        public string StaleReason;

        internal static string VerdictText(Verdict v)
        {
            switch (v)
            {
                case RevitMcpAddin.Verdict.Pass: return "PASS";
                case RevitMcpAddin.Verdict.Warning: return "WARNING";
                case RevitMcpAddin.Verdict.Violation: return "VIOLATION";
                default: return "UNCERTAIN";
            }
        }

        internal static string LifecycleText(LifecycleState s)
        {
            switch (s)
            {
                case LifecycleState.Open: return "OPEN";
                case LifecycleState.Acknowledged: return "ACKNOWLEDGED";
                case LifecycleState.Fixed: return "FIXED";
                case LifecycleState.Reopened: return "REOPENED";
                default: return "STALE";
            }
        }

        internal static FindingRow Create(
            string dedupKey, string docKey, string elementUid, long elementId,
            RuleDef rule, RuleOutcome o, int generation, ComplianceState.PackStamp stamp)
        {
            string now = ComplianceIso.Now();
            FindingRow r = new FindingRow();
            r.DedupKey = dedupKey;
            r.FindingUid = dedupKey;
            r.DocKey = docKey;
            r.ElementUid = elementUid;
            r.ElementId = elementId;
            r.RuleUid = o.RuleUid ?? rule.RuleUid;
            r.RuleVersion = o.RuleVersion != 0 ? o.RuleVersion : rule.Version;
            r.Verdict = VerdictText(o.Result);
            r.Severity = o.Severity;
            r.IssueClass = o.IssueClass;
            r.EvidenceLevel = o.EvidenceLevel;
            r.UncertainReason = o.UncertainReason;
            r.MissingInputs = o.MissingInputs ?? new string[0];
            r.ConflictRuleUids = o.ConflictRuleUids ?? new string[0];
            r.ObservedValue = o.ObservedValue;
            r.ThresholdValue = o.ThresholdValue;
            r.Unit = o.Unit;
            r.SuppressCitation = o.SuppressCitation;
            r.CitationLabelMn = o.CitationLabelMn;
            r.LifecycleState = LifecycleState.Open;
            r.VerificationState = rule.VerificationState;
            r.RulesetVersion = stamp != null ? stamp.RulesetVersion : null;
            r.PackSha256 = stamp != null ? stamp.PackSha256 : null;
            r.TeamCode = stamp != null ? stamp.TeamCode : null;
            r.TeamSource = stamp != null ? stamp.TeamSource : null;
            r.FirstSeenAt = now;
            r.LastEvaluatedAt = now;
            r.ScanGeneration = generation;
            return r;
        }

        /// <summary>
        /// §3.4-ийн `v1:RULE_VALIDATION+RULE_VERDICT` payload.
        ///
        /// ⚠️ `rule_id` ба `passed` нь ЗААВАЛ: `bimEvents.ts:741` нь ЯГ энэ
        /// ХОЁРЫГ хайж `RULE_VERDICT` битийг тавьдаг.  Тэдгүйгээр мөр
        /// `parts_missing = 1` болж `DATASET_ELIGIBLE_SQL`-ээс ХАСАГДАНА —
        /// олдворын бүртгэл чимээгүй хагас болно.
        ///
        /// ⚠️ `passed` нь `verdict == "PASS"` — `UNCERTAIN`-ыг «тэнцсэн» гэж
        /// ХЭЗЭЭ Ч бичихгүй (§3.8-ийн эхний дүрэм: үнэлж чадаагүй нь зөрчил ч
        /// биш, тэнцсэн ч биш).
        /// </summary>
        internal string ToEventPayloadJson(string prevVerdict, string coverage)
        {
            StringBuilder sb = new StringBuilder(768);
            sb.Append('{');
            CJson.Str(sb, "rule_id", RuleUid); sb.Append(',');
            sb.Append("\"passed\":").Append(
                string.Equals(Verdict, "PASS", StringComparison.Ordinal) ? "true" : "false").Append(',');
            CJson.Str(sb, "finding_uid", FindingUid); sb.Append(',');
            CJson.Str(sb, "verdict", Verdict); sb.Append(',');
            CJson.Str(sb, "prev_verdict", prevVerdict); sb.Append(',');
            CJson.Str(sb, "lifecycle_state", LifecycleText(LifecycleState)); sb.Append(',');
            CJson.Str(sb, "issue_class", IssueClass); sb.Append(',');
            CJson.Str(sb, "evidence_level", EvidenceLevel); sb.Append(',');
            CJson.Str(sb, "severity", Severity); sb.Append(',');
            CJson.Str(sb, "coverage", coverage); sb.Append(',');
            CJson.Str(sb, "uncertain_reason", UncertainReason); sb.Append(',');
            sb.Append("\"scan_generation\":")
              .Append(ScanGeneration.ToString(CultureInfo.InvariantCulture)).Append(',');
            CJson.Num(sb, "observed_value", ObservedValue); sb.Append(',');
            CJson.Num(sb, "threshold_value", ThresholdValue); sb.Append(',');
            CJson.Str(sb, "unit", Unit); sb.Append(',');
            CJson.Str(sb, "verification_state", VerificationState); sb.Append(',');
            sb.Append("\"rule_version\":")
              .Append(RuleVersion.ToString(CultureInfo.InvariantCulture)).Append(',');
            CJson.Str(sb, "ruleset_version", RulesetVersion); sb.Append(',');
            CJson.Str(sb, "pack_sha256", PackSha256); sb.Append(',');
            CJson.Str(sb, "team_code", TeamCode); sb.Append(',');
            CJson.Str(sb, "team_source", TeamSource); sb.Append(',');
            CJson.Str(sb, "element_uid", ElementUid); sb.Append(',');
            CJson.Str(sb, "doc_uid", DocKey);
            sb.Append('}');
            return sb.ToString();
        }
    }

    /// <summary>Нэг олдвор ИЛГЭЭХЭД бэлэн болсон мөч.</summary>
    internal sealed class EmittedFinding
    {
        public FindingRow Row;
        /// <summary>null = ШИНЭ олдвор (§3.4-ийн `prev_verdict`).</summary>
        public string PrevVerdict;
    }

    /// <summary>
    /// НЭГ ПРОЦЕССЫН амьд нийцлийн төлөв (v2 §56) — баримт тус бүрээр
    /// `DocKey`-ээр ялгагдана.
    ///
    /// ⚠️ ЦЭВЭР.  Revit-ийн API-д хүрэхгүй, мөрдөгчийн түгжээ хөндөхгүй, UI
    /// урсгал руу синхрон дуудлага хийхгүй, самбар нээхгүй.  `dotnet run`-аар
    /// Revit-гүйгээр тестлэгдэнэ (`check_changeset.py`-ийн заншил).
    ///
    /// ⚠️ Дискний бичилт нь `ChangeTracker.FlushDirty`-ийн ЗАНШЛЫГ дагана:
    /// түр файл → `File.Move` (`ChangeTracker.cs:577-581`).  ГЭХДЭЭ түр
    /// файлын нэрэнд ПРОЦЕССЫН id нэмнэ: нэг PC дээр Revit 2024 ба 2027
    /// зэрэг нээлттэй байвал `%APPDATA%` ХУВААЛЦАГДДАГ ба детерминист нэр нь
    /// хоёр процессыг мөргөлдүүлнэ.
    ///
    /// ⚠️ ТҮГЖЭЭГҮЙ.  ЗӨВХӨН `ComplianceScheduler`-ийн ГАНЦ ажилчин урсгал
    /// дуудна.  Хоёр дахь дуудагч гарвал энд түгжээ НЭМЭХ БИШ, тэр дуудагчийг
    /// АРИЛГА (`ChangeSetCoalescer`-тэй ЯГ ижил шалтгаан).  Гаднаас уншигдах
    /// цорын ганц зүйл нь `OpenCount()`-ийн ХУУЛБАР бөгөөд түүнийг
    /// хуваарилагч `volatile` талбарт тавина.
    /// </summary>
    internal sealed class ComplianceState
    {
        /// <summary>Багцын мөч — олдвор бүрд ХӨЛДӨНӨ (§3.4).</summary>
        internal sealed class PackStamp
        {
            public string RulesetVersion;
            public string PackSha256;
            public string TeamCode;
            /// <summary>`TeamContext.State.Source` — «яагаад энэ баг вэ».</summary>
            public string TeamSource;
        }

        /// <summary>dedup_key → одоогийн олдвор.  §56-ийн «одоо юу буруу байна».</summary>
        private readonly Dictionary<string, FindingRow> _live =
            new Dictionary<string, FindingRow>(StringComparer.Ordinal);

        /// <summary>
        /// docKey → ЭНЭ МӨЧЛӨГТ БАГТААГҮЙ id-ууд.
        ///
        /// ⚠️ ХОЙШЛУУЛАЛТ, АЛДАГДАЛ БИШ.  `MaxDirtyPerPass`-аас илүү гарсан
        /// элемент, ба undo-тэсрэлтийн үед хойшлуулсан БҮХ элемент энд хүлээнэ.
        /// Хязгаартай: `MaxCarry` хүрэхэд ХАМГИЙН ХУУЧИН нь хаягдаж
        /// `CarryDropped` өснө — ЧИМЭЭГҮЙ алдагдал БАЙХГҮЙ.
        /// </summary>
        private readonly Dictionary<string, List<long>> _carry =
            new Dictionary<string, List<long>>(StringComparer.Ordinal);

        private const int MaxCarry = 20000;

        public long CarryDropped { get; private set; }

        private int _scanGeneration;

        /// <summary>
        /// §56-ийн 2-4-р асуултын ЦОРЫН ГАНЦ механизм.
        ///
        /// ⚠️ ЯАГААД ЦАГ ХАНГАЛТГҮЙ ВЭ: «шинээр гарсан зөрчил» ба «бид дөнгөж
        /// хармагцаа анх удаа харагдсан зөрчил» хоёрыг timestamp ЯЛГАЖ ЧАДАХГҮЙ.
        /// Үеийн тоолуур нь «энэ мөр аль сканд төрөв» гэдгийг хэлнэ.
        /// </summary>
        public int NextScanGeneration() { return ++_scanGeneration; }

        public int Generation { get { return _scanGeneration; } }

        public int LiveCount { get { return _live.Count; } }

        /// <summary>sha256(rule_uid \0 element_uid)-ийн эхний 16 hex.</summary>
        internal static string DedupKey(string ruleUid, string elementUid)
        {
            byte[] raw = Encoding.UTF8.GetBytes((ruleUid ?? "") + "\0" + (elementUid ?? ""));
            using (SHA256 sha = SHA256.Create())
            {
                byte[] h = sha.ComputeHash(raw);
                StringBuilder sb = new StringBuilder(16);
                for (int i = 0; i < 8; i++) sb.Append(h[i].ToString("x2", CultureInfo.InvariantCulture));
                return sb.ToString();
            }
        }

        /// <summary>
        /// Дүгнэлт хүлээж авна.
        ///
        /// ⚠️ ТӨЛӨВ ӨӨРЧЛӨГДСӨН, ҮҮССЭН, эсвэл ШИЙДЭГДСЭН үед Л мөр илгээнэ
        /// (§3.4).  Ижил дүгнэлт → ЮУ Ч БИШ.  Энэ бол мөрийн тэсрэлтээс
        /// хамгаалах ГОЛ хамгаалалт: 2000 элементийн буулгалт × 5 хамаарах
        /// дүрэм = нэг цонхонд 10 000 үнэлгээ, гэхдээ ТӨЛӨВ ӨӨРЧЛӨГДӨӨГҮЙ бол
        /// ТЭГ мөр.
        /// </summary>
        public void Apply(string docKey, string elementUid, long elementId,
                          RuleDef rule, RuleOutcome o, int generation,
                          PackStamp stamp, PassResult result)
        {
            if (o == null || rule == null || string.IsNullOrEmpty(elementUid)) return;
            string key = DedupKey(o.RuleUid ?? rule.RuleUid, elementUid);

            FindingRow prev;
            if (!_live.TryGetValue(key, out prev))
            {
                // ⚠️ PASS дээр мөр ҮҮСГЭХГҮЙ.  «Хараад цэвэр байсан» нь олдвор
                //    БИШ; түүнийг бүртгэх нь `rule_run_ledger`-ийн ажил.
                if (o.Result == Verdict.Pass) return;
                FindingRow row = FindingRow.Create(
                    key, docKey, elementUid, elementId, rule, o, generation, stamp);
                _live[key] = row;
                if (result != null) result.Emit(row, null);   // ҮҮССЭН
                return;
            }

            // §58 — хуучирсан тэмдгийг ҮРГЭЛЖ арилгана: дахин тооцоолол дууслаа.
            prev.StaleAt = null;
            prev.StaleReason = null;
            prev.LastEvaluatedAt = ComplianceIso.Now();
            prev.ScanGeneration = generation;
            prev.ElementId = elementId;

            string nextVerdict = FindingRow.VerdictText(o.Result);
            if (string.Equals(prev.Verdict, nextVerdict, StringComparison.Ordinal) &&
                string.Equals(prev.Severity, o.Severity, StringComparison.Ordinal))
            {
                // ИЖИЛ ДҮГНЭЛТ — сервер рүү ЮУ Ч ЯВАХГҮЙ.
                return;
            }

            string was = prev.Verdict;
            prev.Verdict = nextVerdict;
            prev.Severity = o.Severity;
            prev.IssueClass = o.IssueClass;
            prev.EvidenceLevel = o.EvidenceLevel;
            prev.UncertainReason = o.UncertainReason;
            prev.MissingInputs = o.MissingInputs ?? new string[0];
            prev.ConflictRuleUids = o.ConflictRuleUids ?? new string[0];
            prev.ObservedValue = o.ObservedValue;
            prev.ThresholdValue = o.ThresholdValue;
            prev.Unit = o.Unit;
            prev.SuppressCitation = o.SuppressCitation;
            prev.CitationLabelMn = o.CitationLabelMn;
            if (stamp != null)
            {
                prev.RulesetVersion = stamp.RulesetVersion;
                prev.PackSha256 = stamp.PackSha256;
            }

            if (o.Result == Verdict.Pass)
            {
                // §56 «аль нь засагдав».  Мөрийг УСТГАХГҮЙ — түүхээ хадгална.
                prev.LifecycleState = LifecycleState.Fixed;
                prev.ResolvedAt = ComplianceIso.Now();
            }
            else if (prev.LifecycleState == LifecycleState.Fixed)
            {
                prev.LifecycleState = LifecycleState.Reopened;   // §57 REOPENED
                prev.ResolvedAt = null;
            }
            if (result != null) result.Emit(prev, was);          // ӨӨРЧЛӨГДСӨН
        }

        /// <summary>
        /// §58 — ХУУЧРУУЛАХ.  Хуучирсан мөр нь «одоогийн дүгнэлт» гэж ХЭЗЭЭ Ч
        /// харагдахгүй ба бэлэн байдлын хаалтад ТООЛОГДОХГҮЙ.
        ///
        /// ⚠️ Энэ нь ЗӨВХӨН САНАХ ОЙД тэмдэглэдэг.  D1 дээрх `stale_at`-д
        /// хүрэх зам нь `POST /api/compliance/findings/stale`, түүнийг
        /// `ComplianceScheduler.StaleSink` дамжуулна.  Sink суулгаагүй бол
        /// хуучруулалт Revit хаагдмагц АЛГА БОЛНО — энэ бол баримтжуулсан
        /// цоорхой, чимээгүй алдаа БИШ.
        /// </summary>
        public int MarkStale(Func<FindingRow, bool> predicate, string reason, IList<string> touched)
        {
            if (predicate == null) return 0;
            string now = ComplianceIso.Now();
            int n = 0;
            foreach (FindingRow r in _live.Values)
            {
                if (r.StaleAt != null) continue;
                if (!predicate(r)) continue;
                r.StaleAt = now;
                r.StaleReason = reason;
                n++;
                if (touched != null) touched.Add(r.DedupKey);
            }
            return n;
        }

        /// <summary>
        /// Ribbon-ы бичээст очих ЦОРЫН ГАНЦ тоо.
        ///
        /// ⚠️ Хуучирсан мөр ТООЛОГДОХГҮЙ (§58).  Хуучирсан зөрчлийг тоолох нь
        /// «энэ загварт 12 зөрчил бий» гэж хэлээд тэдний талыг нь өөр баг аль
        /// хэдийн зассан байхтай ижил — инженерийн итгэлийг НЭГ УДААД устгадаг
        /// алдаа.
        /// </summary>
        public int OpenCount()
        {
            int n = 0;
            foreach (FindingRow r in _live.Values)
            {
                if (r.StaleAt != null) continue;
                if (r.LifecycleState == LifecycleState.Open ||
                    r.LifecycleState == LifecycleState.Reopened) n++;
            }
            return n;
        }

        public int StaleCount()
        {
            int n = 0;
            foreach (FindingRow r in _live.Values) { if (r.StaleAt != null) n++; }
            return n;
        }

        /// <summary>Тухайн баримтын олдворын element_uid-ийн олонлог (гох №2-т).</summary>
        public void CollectElementUids(string docKey, HashSet<string> into)
        {
            if (into == null) return;
            foreach (FindingRow r in _live.Values)
            {
                if (!string.Equals(r.DocKey, docKey, StringComparison.Ordinal)) continue;
                if (!string.IsNullOrEmpty(r.ElementUid)) into.Add(r.ElementUid);
            }
        }

        /* ============================================================== */
        /*  ХОЙШЛУУЛАЛТ                                                    */
        /* ============================================================== */

        /// <summary>Мөчлөгт багтаагүй / хойшлуулсан id-г ХАДГАЛНА.</summary>
        public void CarryOver(string docKey, long[] ids, int skip)
        {
            if (string.IsNullOrEmpty(docKey) || ids == null) return;
            List<long> list;
            if (!_carry.TryGetValue(docKey, out list))
            {
                list = new List<long>();
                _carry[docKey] = list;
            }
            for (int i = Math.Max(0, skip); i < ids.Length; i++)
            {
                if (list.Count >= MaxCarry)
                {
                    // ⚠️ ХАМГИЙН ХУУЧИН нь хаягдана — шинэ засвар нь хуучин
                    //    засвараас илүү магадлалтай.  Тоолуур нь ИЛ.
                    list.RemoveAt(0);
                    CarryDropped++;
                }
                list.Add(ids[i]);
            }
        }

        /// <summary>Хойшлуулсан id-г БУЦААЖ АВНА (авсны дараа хоосорно).</summary>
        public long[] DrainCarry(string docKey)
        {
            List<long> list;
            if (string.IsNullOrEmpty(docKey) || !_carry.TryGetValue(docKey, out list) || list.Count == 0)
            {
                return new long[0];
            }
            _carry.Remove(docKey);
            return list.ToArray();
        }

        public int CarryCount(string docKey)
        {
            List<long> list;
            return !string.IsNullOrEmpty(docKey) && _carry.TryGetValue(docKey, out list) ? list.Count : 0;
        }

        /* ============================================================== */
        /*  ДИСКНИЙ ТОЛИН ТУСГАЛ                                           */
        /* ============================================================== */

        internal static string StateDir
        {
            get
            {
                return Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
                    "RevitMcpAddin");
            }
        }

        /// <summary>
        /// ⚠️ Файлын нэр нь `docKey`-ийн ХЭШ — `RevitTools.DocUid` нь эцсийн
        /// аргаараа ФАЙЛЫН ЗАМ буцааж болно (`path:C:\...`), тэр нь файлын
        /// нэрэнд хууль бус тэмдэгт агуулна.
        /// </summary>
        internal static string PathFor(string docKey)
        {
            return Path.Combine(StateDir, "compliance-" + ShortHash(docKey) + ".json");
        }

        private static string ShortHash(string s)
        {
            using (SHA256 sha = SHA256.Create())
            {
                byte[] h = sha.ComputeHash(Encoding.UTF8.GetBytes(s ?? ""));
                StringBuilder sb = new StringBuilder(16);
                for (int i = 0; i < 8; i++) sb.Append(h[i].ToString("x2", CultureInfo.InvariantCulture));
                return sb.ToString();
            }
        }

        /// <summary>
        /// ХЭЗЭЭ Ч ШИДЭХГҮЙ.  Диск дүүрсэн / эрх байхгүй үед төлөв санах ойд
        /// үргэлжилнэ (`ChangeTracker.cs:583-585`-ийн заншил).
        /// </summary>
        public void SaveMirror(string docKey)
        {
            if (string.IsNullOrEmpty(docKey)) return;
            try
            {
                Directory.CreateDirectory(StateDir);
                string path = PathFor(docKey);
                int pid = System.Diagnostics.Process.GetCurrentProcess().Id;
                string tmp = path + "." + pid.ToString(CultureInfo.InvariantCulture) + ".tmp";

                StringBuilder sb = new StringBuilder(2048);
                sb.Append("{\"v\":1,");
                CJson.Str(sb, "doc_uid", docKey); sb.Append(',');
                sb.Append("\"generation\":")
                  .Append(_scanGeneration.ToString(CultureInfo.InvariantCulture)).Append(',');
                CJson.Str(sb, "saved_at", ComplianceIso.Now()); sb.Append(',');
                sb.Append("\"findings\":[");
                bool first = true;
                foreach (FindingRow r in _live.Values)
                {
                    if (!string.Equals(r.DocKey, docKey, StringComparison.Ordinal)) continue;
                    if (!first) sb.Append(',');
                    first = false;
                    sb.Append('{');
                    CJson.Str(sb, "dedup_key", r.DedupKey); sb.Append(',');
                    CJson.Str(sb, "rule_uid", r.RuleUid); sb.Append(',');
                    CJson.Str(sb, "element_uid", r.ElementUid); sb.Append(',');
                    CJson.Str(sb, "verdict", r.Verdict); sb.Append(',');
                    CJson.Str(sb, "severity", r.Severity); sb.Append(',');
                    CJson.Str(sb, "lifecycle_state", FindingRow.LifecycleText(r.LifecycleState)); sb.Append(',');
                    CJson.Str(sb, "stale_at", r.StaleAt); sb.Append(',');
                    CJson.Str(sb, "stale_reason", r.StaleReason); sb.Append(',');
                    CJson.Str(sb, "first_seen_at", r.FirstSeenAt); sb.Append(',');
                    CJson.Str(sb, "last_evaluated_at", r.LastEvaluatedAt);
                    sb.Append('}');
                }
                sb.Append("]}");

                File.WriteAllText(tmp, sb.ToString(), new UTF8Encoding(false));
                if (File.Exists(path)) File.Delete(path);
                File.Move(tmp, path);
            }
            catch
            {
                // Диск дүүрсэн / эрх байхгүй — төлөв САНАХ ОЙД үргэлжилнэ.
            }
        }
    }
}
