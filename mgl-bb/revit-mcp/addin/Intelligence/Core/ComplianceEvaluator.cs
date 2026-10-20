using System;
using System.Collections.Generic;
using RevitMcpAddin.Intelligence.Contracts;

namespace RevitMcpAddin.Intelligence.Core
{
    /// <summary>
    /// ПРОДАКШНЫ BIM ДҮРМИЙН НИЙЛҮҮЛЭГЧ — ХООСОН (R-12).
    ///
    /// Session A-ийн нормын корпуст ил BIM хамаарал (`appliesTo` + хэмжилт +
    /// баталгаажсан эх) ХАРААХАН БАЙХГҮЙ тул энэ нийлүүлэгч
    /// `NO_EXECUTABLE_BIM_RULES` буцаана.  Текстэн заалтаас дүрэм ЗОХИОХГҮЙ.
    /// Ирээдүйд `ai/norm-compiler`-ийн гаралт ЭНД холбогдоно — өөр газар биш.
    /// </summary>
    public sealed class ProductionBimRuleProvider : IBimRuleProvider
    {
        public string Name { get { return "production"; } }

        public RuleProviderResult Load()
        {
            return new RuleProviderResult
            {
                Status = RuleProviderStatus.NO_EXECUTABLE_BIM_RULES,
                Provider = Name,
                Note = "Нормын корпуст BIM хамаарал бүхий гүйцэтгэгдэх дүрэм байхгүй (2026-09). Текстээс дүрэм зохиохгүй.",
            };
        }
    }

    /// <summary>
    /// ЗАГВАРЫН ЧАНАРЫН ШАЛГАЛТ (§42, R-11 B анги) — норм БИШ, хууль БИШ.
    /// Бүгд `Source.Kind = MODEL_QUALITY`; Revit-ийн ӨӨРИЙН семантикаас
    /// (өрөө хаалттай эсэх = `Room.Area > 0`, хаалга хосттой эсэх = `Host`).
    /// </summary>
    public sealed class ModelQualityRuleProvider : IBimRuleProvider
    {
        public string Name { get { return "model-quality"; } }

        public static IssueSource Source(string label)
        {
            return new IssueSource
            {
                Kind = RuleSourceKind.MODEL_QUALITY,
                LabelMn = label,
                Verification = "MODEL_QUALITY",
                ProvenanceNote = "MODEL_QUALITY — Revit-ийн загварын бүрэн байдал; нормын шаардлага БИШ.",
            };
        }

        public RuleProviderResult Load()
        {
            var r = new RuleProviderResult { Status = RuleProviderStatus.OK, Provider = Name };
            r.Rules.Add(new BimExecutableRule
            {
                RuleId = "mq.room_not_enclosed",
                Source = Source("Өрөө хаалттай биш"),
                AppliesTo = new RuleApplicability { Kinds = { SceneNodeKind.ROOM } },
                RequiredInputs = { "flag:not_enclosed" },
                Measurement = new RuleMeasurement { Measure = "flag:not_enclosed", RequireAuthoritativeEdge = false },
                Predicate = new RulePredicate { Op = RulePredicateOp.FLAG_NOT_SET, Flag = "not_enclosed" },
                Severity = IssueSeverity.MEDIUM,
                TitleMn = "Өрөө хаалттай биш (талбай 0)",
                ExplanationKey = "mq.room_not_enclosed",
            });
            r.Rules.Add(new BimExecutableRule
            {
                RuleId = "mq.room_unplaced",
                Source = Source("Өрөө байрлуулаагүй"),
                AppliesTo = new RuleApplicability { Kinds = { SceneNodeKind.ROOM } },
                RequiredInputs = { "flag:unplaced" },
                Measurement = new RuleMeasurement { Measure = "flag:unplaced", RequireAuthoritativeEdge = false },
                Predicate = new RulePredicate { Op = RulePredicateOp.FLAG_NOT_SET, Flag = "unplaced" },
                Severity = IssueSeverity.LOW,
                TitleMn = "Өрөө загварт байрлуулаагүй",
                ExplanationKey = "mq.room_unplaced",
            });
            r.Rules.Add(new BimExecutableRule
            {
                RuleId = "mq.opening_without_host",
                Source = Source("Хаалга/цонх хостгүй"),
                AppliesTo = new RuleApplicability { Kinds = { SceneNodeKind.DOOR, SceneNodeKind.WINDOW } },
                RequiredInputs = { "host" },
                Measurement = new RuleMeasurement { Measure = "host", RequireAuthoritativeEdge = false },
                Predicate = new RulePredicate { Op = RulePredicateOp.EXISTS },
                Severity = IssueSeverity.HIGH,
                TitleMn = "Хаалга/цонх ханад суугаагүй (хостгүй)",
                ExplanationKey = "mq.opening_without_host",
            });
            r.Rules.Add(new BimExecutableRule
            {
                RuleId = "mq.element_without_level",
                Source = Source("Элемент давхаргүй"),
                AppliesTo = new RuleApplicability { Kinds = { SceneNodeKind.WALL, SceneNodeKind.FLOOR, SceneNodeKind.DOOR, SceneNodeKind.WINDOW, SceneNodeKind.ROOM } },
                RequiredInputs = { "level" },
                Measurement = new RuleMeasurement { Measure = "level", RequireAuthoritativeEdge = false },
                Predicate = new RulePredicate { Op = RulePredicateOp.EXISTS },
                Severity = IssueSeverity.LOW,
                TitleMn = "Элемент давхарт хамаарахгүй",
                ExplanationKey = "mq.element_without_level",
            });
            return r;
        }
    }

    /// <summary>Хэд хэдэн нийлүүлэгчийг нэгтгэнэ; продакшн хоосон бол загварын чанар л үлдэнэ.</summary>
    public sealed class CompositeRuleProvider : IBimRuleProvider
    {
        private readonly IBimRuleProvider[] _inner;
        public CompositeRuleProvider(params IBimRuleProvider[] inner) { _inner = inner ?? new IBimRuleProvider[0]; }
        public string Name { get { return "composite"; } }

        public RuleProviderResult Load()
        {
            var r = new RuleProviderResult { Status = RuleProviderStatus.NO_EXECUTABLE_BIM_RULES, Provider = Name };
            var notes = new List<string>();
            foreach (IBimRuleProvider p in _inner)
            {
                RuleProviderResult one;
                try { one = p.Load(); }
                catch (Exception ex) { notes.Add(p.Name + ": ERROR " + ex.Message); continue; }
                notes.Add(p.Name + ": " + one.Status + " (" + one.Rules.Count + ")");
                if (one.Status == RuleProviderStatus.OK && one.Rules.Count > 0)
                {
                    r.Status = RuleProviderStatus.OK;
                    r.Rules.AddRange(one.Rules);
                }
            }
            r.Note = string.Join("; ", notes);
            return r;
        }
    }

    /* ================================================================== */
    /*  ҮНЭЛГЭЭ                                                            */
    /* ================================================================== */

    public sealed class EvaluationSkip
    {
        public long ElementId;
        public string RuleId;
        /// <summary>needs_geometry | missing_input | mixed_units | no_authoritative_relation | not_applicable</summary>
        public string Reason;
    }

    public sealed class EvaluationResult
    {
        public string DocKey;
        public long SceneVersion;
        public readonly List<RevitComplianceIssue> Issues = new List<RevitComplianceIssue>();
        /// <summary>(element, rule) хосууд — ТЭНЦСЭН.  Хуучин олдворыг хаахад хэрэгтэй.</summary>
        public readonly List<KeyValuePair<long, string>> Passed = new List<KeyValuePair<long, string>>();
        public readonly List<EvaluationSkip> Skipped = new List<EvaluationSkip>();
        public int Evaluated;
    }

    /// <summary>
    /// ДЕТЕРМИНИСТ ҮНЭЛГЭЭ (§43) — PASS/FAIL-ийг LLM ХЭЗЭЭ Ч шийдэхгүй.
    ///
    /// Загварын чанарын дүрэм (flag/exists) INDEX давхаргад ажиллана; тоон
    /// дүрэм GEOMETRY давхарга шаардана (`needs_geometry` → дуудагч баяжуулаад
    /// дахин дуудна).  Нэгж зөрвөл `mixed_units` — таамаглахгүй, хөрвүүлэхгүй
    /// (`Units.cs`-ийн дүрэм); олдвор нь `REVIEW_CANDIDATE`.
    /// </summary>
    public static class ComplianceEvaluator
    {
        public static EvaluationResult Evaluate(SceneGraphStore graph, IEnumerable<long> elementIds, IList<BimExecutableRule> rules, DateTime? nowUtc = null)
        {
            if (graph == null) throw new ArgumentNullException(nameof(graph));
            var res = new EvaluationResult { SceneVersion = graph.Version, DocKey = graph.DocKey };
            if (rules == null || rules.Count == 0) return res;
            string now = (nowUtc ?? DateTime.UtcNow).ToString("o");

            foreach (long id in elementIds)
            {
                SceneNode n = graph.Get(id);
                if (n == null || n.Deleted) continue;
                foreach (BimExecutableRule rule in rules)
                {
                    if (!Applies(rule, n)) continue;
                    res.Evaluated++;
                    string reason;
                    List<string> edgeKeys;
                    bool? pass = Check(graph, n, rule, out reason, out edgeKeys);
                    if (pass == null)
                    {
                        res.Skipped.Add(new EvaluationSkip { ElementId = id, RuleId = rule.RuleId, Reason = reason });
                        if (reason == "mixed_units" || reason == "mixed_provenance")
                        {
                            res.Issues.Add(ReviewIssue(graph, n, rule, reason, now));
                        }
                        continue;
                    }
                    if (pass.Value)
                    {
                        res.Passed.Add(new KeyValuePair<long, string>(id, rule.RuleId));
                        continue;
                    }
                    res.Issues.Add(Issue(graph, n, rule, edgeKeys, now));
                }
            }
            return res;
        }

        public static bool Applies(BimExecutableRule rule, SceneNode n)
        {
            if (rule == null || rule.AppliesTo == null) return false;
            if (n.Scope == ElementScope.LINKED_DOCUMENT) return false;
            bool kindOk = rule.AppliesTo.Kinds.Count == 0 || rule.AppliesTo.Kinds.Contains(n.Kind);
            bool catOk = rule.AppliesTo.Categories.Count == 0 ||
                         (n.Category != null && rule.AppliesTo.Categories.Contains(n.Category));
            if (rule.AppliesTo.Kinds.Count > 0 && rule.AppliesTo.Categories.Count > 0)
            {
                if (!kindOk && !catOk) return false;
            }
            else if (!kindOk || !catOk) return false;
            if (rule.AppliesTo.LevelNames.Count > 0)
            {
                bool lv = false;
                foreach (string ln in rule.AppliesTo.LevelNames) if (LevelMatcher.Matches(n.LevelName, ln)) { lv = true; break; }
                if (!lv) return false;
            }
            return true;
        }

        /// <summary>null = үнэлж чадсангүй (`reason`); true = PASS; false = FAIL.</summary>
        private static bool? Check(SceneGraphStore graph, SceneNode n, BimExecutableRule rule, out string reason, out List<string> edgeKeys)
        {
            reason = null;
            edgeKeys = new List<string>();
            if (rule.Measurement == null || rule.Predicate == null) { reason = "not_applicable"; return null; }
            string m = rule.Measurement.Measure ?? "";

            if (rule.Measurement.RequiredRelation != null)
            {
                List<SceneEdge> edges = graph.EdgesOf(n.ElementId, rule.Measurement.RequiredRelation, rule.Measurement.RequireAuthoritativeEdge);
                if (edges.Count == 0) { reason = "no_authoritative_relation"; return null; }
                foreach (SceneEdge e in edges) edgeKeys.Add(e.Key() + "@" + e.Source + "/" + e.Confidence);
            }

            switch (rule.Predicate.Op)
            {
                case RulePredicateOp.FLAG_SET:
                case RulePredicateOp.FLAG_NOT_SET:
                    {
                        string flag = rule.Predicate.Flag ?? (m.StartsWith("flag:", StringComparison.Ordinal) ? m.Substring(5) : m);
                        bool has = n.Flags != null && n.Flags.Contains(flag);
                        return rule.Predicate.Op == RulePredicateOp.FLAG_SET ? has : !has;
                    }
                case RulePredicateOp.EXISTS:
                case RulePredicateOp.NOT_EXISTS:
                    {
                        bool exists;
                        if (m == "host") exists = n.HostId != null;
                        else if (m == "level") exists = n.LevelId != null;
                        else if (m.StartsWith("flag:", StringComparison.Ordinal)) exists = n.Flags != null && n.Flags.Contains(m.Substring(5));
                        else
                        {
                            Measure mm = Find(n, m);
                            if (mm == null && n.Detail < SceneDetailLevel.GEOMETRY) { reason = "needs_geometry"; return null; }
                            exists = mm != null && !mm.Missing;
                        }
                        return rule.Predicate.Op == RulePredicateOp.EXISTS ? exists : !exists;
                    }
                default:
                    {
                        if (n.Detail < SceneDetailLevel.GEOMETRY) { reason = "needs_geometry"; return null; }
                        Measure mm = Find(n, m);
                        if (mm == null || mm.Missing) { reason = "missing_input"; return null; }
                        if (mm.Source == MeasureSource.UNTYPED_PARAM) { reason = "mixed_provenance"; return null; }
                        string want = rule.Predicate.Unit ?? rule.Measurement.Unit ?? Units.None;
                        if (!string.Equals(want, mm.Unit, StringComparison.Ordinal)) { reason = "mixed_units"; return null; }
                        if (rule.Predicate.Threshold == null) { reason = "not_applicable"; return null; }
                        double v = mm.Value, t = rule.Predicate.Threshold.Value;
                        switch (rule.Predicate.Op)
                        {
                            case RulePredicateOp.GTE: return v >= t;
                            case RulePredicateOp.GT: return v > t;
                            case RulePredicateOp.LTE: return v <= t;
                            case RulePredicateOp.LT: return v < t;
                            case RulePredicateOp.EQ: return Math.Abs(v - t) < 1e-9;
                            case RulePredicateOp.NEQ: return Math.Abs(v - t) >= 1e-9;
                        }
                        reason = "not_applicable";
                        return null;
                    }
            }
        }

        private static Measure Find(SceneNode n, string name)
        {
            if (n.Measures == null) return null;
            foreach (Measure m in n.Measures) if (string.Equals(m.Name, name, StringComparison.Ordinal)) return m;
            return null;
        }

        private static RevitComplianceIssue Issue(SceneGraphStore graph, SceneNode n, BimExecutableRule rule, List<string> edgeKeys, string now)
        {
            IssueClass cls = rule.IssueClassOf();
            var i = new RevitComplianceIssue
            {
                Class = cls,
                Severity = rule.Severity,
                DocKey = graph.DocKey,
                IssueType = rule.RuleId,
                TitleMn = rule.TitleMn,
                Source = rule.Source,
                RuleId = rule.RuleId,
                RuleVersion = rule.RuleVersion,
                SceneVersion = graph.Version,
                DetectedAt = now,
                ExplanationKey = rule.ExplanationKey,
                SuggestedAction = rule.SuggestedAction,
                EvidenceEdges = edgeKeys,
            };
            i.ElementIds.Add(n.ElementId);
            if (!string.IsNullOrEmpty(n.UniqueId)) i.ElementUids.Add(n.UniqueId);
            bool approxEdge = false;
            foreach (string k in edgeKeys) if (k.EndsWith("/APPROXIMATE", StringComparison.Ordinal)) approxEdge = true;
            // ⚠️ Эрх бүхий = баталгаажсан норм + ойролцоолсон ирмэггүй (R-5, R-11).
            i.Authoritative = cls == IssueClass.VERIFIED_NORM && !approxEdge;
            if (cls == IssueClass.VERIFIED_NORM && approxEdge) i.Class = IssueClass.REVIEW_CANDIDATE;
            i.Status = i.Class == IssueClass.REVIEW_CANDIDATE ? IssueStatus.HUMAN_REVIEW_REQUIRED : IssueStatus.OPEN;
            if (rule.Measurement != null && rule.Predicate != null && rule.Predicate.Threshold != null)
            {
                i.Measured = Find(n, rule.Measurement.Measure);
                i.Required = new Measure
                {
                    Name = rule.Measurement.Measure,
                    Value = rule.Predicate.Threshold.Value,
                    Unit = rule.Predicate.Unit ?? rule.Measurement.Unit,
                    Source = MeasureSource.COMPUTED,
                };
            }
            i.DetailMn = Detail(n, i);
            i.IssueId = Hash(i.DedupKey());
            return i;
        }

        private static RevitComplianceIssue ReviewIssue(SceneGraphStore graph, SceneNode n, BimExecutableRule rule, string reason, string now)
        {
            var i = new RevitComplianceIssue
            {
                Class = IssueClass.REVIEW_CANDIDATE,
                Severity = IssueSeverity.INFO,
                DocKey = graph.DocKey,
                IssueType = rule.RuleId + ":" + reason,
                TitleMn = rule.TitleMn + " — үнэлж чадсангүй (" + reason + ")",
                DetailMn = reason == "mixed_units"
                    ? "Хэмжсэн нэгж дүрмийн нэгжтэй зөрсөн; хөрвүүлэхгүй, хүн шалгана."
                    : "Параметрийн эх сурвалж тодорхойгүй (нэгжгүй тоо); таамаглахгүй.",
                Source = rule.Source,
                Authoritative = false,
                Status = IssueStatus.HUMAN_REVIEW_REQUIRED,
                RuleId = rule.RuleId,
                RuleVersion = rule.RuleVersion,
                SceneVersion = graph.Version,
                DetectedAt = now,
            };
            i.ElementIds.Add(n.ElementId);
            if (!string.IsNullOrEmpty(n.UniqueId)) i.ElementUids.Add(n.UniqueId);
            i.IssueId = Hash(i.DedupKey());
            return i;
        }

        private static string Detail(SceneNode n, RevitComplianceIssue i)
        {
            string who = (n.Category ?? n.Kind.ToString()) + " #" + n.ElementId;
            if (!string.IsNullOrEmpty(n.TypeName)) who += " · " + n.TypeName;
            if (!string.IsNullOrEmpty(n.LevelName)) who += " · " + n.LevelName;
            if (i.Measured != null && i.Required != null)
            {
                who += " · хэмжсэн " + UnitsBoundary.Format(i.Measured) + ", шаардлага " + UnitsBoundary.Format(i.Required);
            }
            return who;
        }

        internal static string Hash(string s)
        {
            using (var sha = System.Security.Cryptography.SHA256.Create())
            {
                byte[] h = sha.ComputeHash(System.Text.Encoding.UTF8.GetBytes(s ?? ""));
                var sb = new System.Text.StringBuilder(24);
                for (int k = 0; k < 12; k++) sb.Append(h[k].ToString("x2"));
                return sb.ToString();
            }
        }
    }

    /* ================================================================== */
    /*  ОЛДВОРЫН ТӨЛӨВ                                                     */
    /* ================================================================== */

    public sealed class IssueDelta
    {
        public readonly List<RevitComplianceIssue> Detected = new List<RevitComplianceIssue>();
        public readonly List<RevitComplianceIssue> Resolved = new List<RevitComplianceIssue>();
        public int Unchanged;
    }

    /// <summary>Нээлттэй олдворууд — `DedupKey`-ээр; дахин үнэлэхэд PASS болсон нь RESOLVED.</summary>
    public sealed class IssueStore
    {
        private readonly object _gate = new object();
        private readonly Dictionary<string, RevitComplianceIssue> _byKey = new Dictionary<string, RevitComplianceIssue>(StringComparer.Ordinal);

        public IssueDelta Apply(EvaluationResult result, DateTime? nowUtc = null)
        {
            var d = new IssueDelta();
            string now = (nowUtc ?? DateTime.UtcNow).ToString("o");
            lock (_gate)
            {
                var seen = new HashSet<string>(StringComparer.Ordinal);
                foreach (RevitComplianceIssue i in result.Issues)
                {
                    string key = i.DedupKey();
                    seen.Add(key);
                    RevitComplianceIssue prev;
                    if (_byKey.TryGetValue(key, out prev) && prev.Status != IssueStatus.RESOLVED)
                    {
                        prev.SceneVersion = i.SceneVersion;
                        prev.Measured = i.Measured;
                        prev.DetailMn = i.DetailMn;
                        d.Unchanged++;
                        continue;
                    }
                    _byKey[key] = i;
                    d.Detected.Add(i);
                }
                foreach (KeyValuePair<long, string> p in result.Passed)
                {
                    string key = Key(result, p.Key, p.Value);
                    RevitComplianceIssue prev;
                    if (_byKey.TryGetValue(key, out prev) && prev.Status != IssueStatus.RESOLVED && !seen.Contains(key))
                    {
                        prev.Status = IssueStatus.RESOLVED;
                        prev.ResolvedAt = now;
                        d.Resolved.Add(prev);
                    }
                }
            }
            return d;
        }

        /// <summary>Элемент устгагдсан → түүний бүх олдвор RESOLVED (§53).</summary>
        public List<RevitComplianceIssue> ResolveForDeleted(IEnumerable<long> deletedIds, DateTime? nowUtc = null)
        {
            var list = new List<RevitComplianceIssue>();
            string now = (nowUtc ?? DateTime.UtcNow).ToString("o");
            var del = new HashSet<long>(deletedIds);
            lock (_gate)
            {
                foreach (RevitComplianceIssue i in _byKey.Values)
                {
                    if (i.Status == IssueStatus.RESOLVED) continue;
                    bool hit = false;
                    foreach (long id in i.ElementIds) if (del.Contains(id)) { hit = true; break; }
                    if (!hit) continue;
                    i.Status = IssueStatus.RESOLVED;
                    i.ResolvedAt = now;
                    list.Add(i);
                }
            }
            return list;
        }

        public List<RevitComplianceIssue> All(bool includeResolved = false)
        {
            var list = new List<RevitComplianceIssue>();
            lock (_gate)
            {
                foreach (RevitComplianceIssue i in _byKey.Values)
                    if (includeResolved || i.Status != IssueStatus.RESOLVED) list.Add(i);
            }
            list.Sort((a, b) =>
            {
                int c = a.Severity.CompareTo(b.Severity);
                if (c != 0) return c;
                c = a.Class.CompareTo(b.Class);
                return c != 0 ? c : string.CompareOrdinal(a.IssueId, b.IssueId);
            });
            return list;
        }

        public int OpenCount
        {
            get { lock (_gate) { int n = 0; foreach (var i in _byKey.Values) if (i.Status != IssueStatus.RESOLVED) n++; return n; } }
        }

        private static string Key(EvaluationResult r, long elementId, string ruleId)
        {
            // `RevitComplianceIssue.DedupKey()`-тэй ижил хэлбэр — нэг элемент, нэг дүрэм.
            return (r.DocKey ?? "") + "|" + ruleId + "|" + elementId;
        }
    }
}
