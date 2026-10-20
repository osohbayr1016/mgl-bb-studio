using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text.Json;

namespace RevitMcpAddin
{
    /// <summary>Гурван утгат логик — False=0, Unknown=1, True=2.</summary>
    internal enum Tri
    {
        False = 0,
        Unknown = 1,
        True = 2,
    }

    /// <summary>
    /// ⚠️ `min` / `max` / `2−x` нь Kleene-ийн логиктой ЯГ ТЭНЦҮҮ, бөгөөд TS
    /// (`Math.min`) ба C# (`Math.Min`) дээр НЭГ АРИФМЕТИК.  Тиймээс паритетын
    /// харуул нь зөвхөн FIXTURE-ийг тулгах хэрэгтэй — логикийн хэрэгжилт нь
    /// бүтцээрээ ижил (Хавсралт §5.5).
    /// </summary>
    internal static class Kleene
    {
        internal static Tri All(Tri a, Tri b) { return (Tri)Math.Min((int)a, (int)b); }
        internal static Tri Any(Tri a, Tri b) { return (Tri)Math.Max((int)a, (int)b); }
        internal static Tri Not(Tri a) { return (Tri)(2 - (int)a); }
    }

    internal enum NodeKind
    {
        Cmp = 0,
        CmpText = 1,
        Between = 2,
        InNum = 3,
        InText = 4,
        ContainsAny = 5,
        Exists = 6,
        All = 7,
        Any = 8,
        Not = 9,
        Cond = 10,
    }

    /// <summary>
    /// НЭГ зангилааны төрөл — `record` БАЙХГҮЙ (net48 = Revit 2024).  Талбарууд
    /// нь `Kind`-ээс хамаарч Л утгатай.
    ///
    /// ⚠️ `Cond` нь ЗӨВХӨН `check`-ийн модонд гарна (Хавсралт §5.3).  Задлагч нь
    ///    `applicability` задлахдаа `Cond` тааралдвал БҮХ БАГЦЫГ ТАТГАЛЗАНА.
    /// ⚠️ `PredicateNode` нь `CheckNode`-ын ДЭД ОЛОНЛОГ — тусдаа төрөл
    ///    зарлахгүй; ялгаа нь ЗАДЛАГЧИЙН хязгаарлалт.
    /// </summary>
    internal sealed class CheckNode
    {
        public NodeKind Kind;

        public string Fact;
        public string Op;
        public double Num;
        public string Text;
        public double Lo;
        public double Hi;
        public double[] Nums;
        public string[] Texts;
        public bool Want;

        public CheckNode[] Children;
        public CheckNode Child;
        public CheckNode If;
        public CheckNode Then;
        public CheckNode Else;
    }

    /// <summary>Нэг зангилааны үнэлгээний үр дүн.</summary>
    internal sealed class NodeEval
    {
        public Tri Result;
        /// <summary>§5.7 — `ObservedValue`/`ThresholdValue`-ыг бөглөх ЦОРЫН ГАНЦ эх сурвалж.</summary>
        public CheckNode DecidingLeaf;
        /// <summary>ҮР ДҮНГ ЗААВАЛ БЛОКЛОЖ БУЙ баримтууд, ordinal эрэмбэлсэн.</summary>
        public string[] Blocking;
        /// <summary>null | missing_input | mixed_units | mixed_provenance …</summary>
        public string Problem;
    }

    internal enum Verdict
    {
        Pass = 0,
        Warning = 1,
        Violation = 2,
        Uncertain = 3,
    }

    /// <summary>Хамаарлын үр дүн (Хавсралт §9.1).</summary>
    internal sealed class Applicability
    {
        /// <summary>APPLICABLE | NOT_APPLICABLE | UNCERTAIN</summary>
        public string Kind;
        public string Reason;
        public string[] Missing;

        internal static Applicability Applicable()
        {
            Applicability a = new Applicability();
            a.Kind = "APPLICABLE";
            a.Missing = new string[0];
            return a;
        }

        internal static Applicability NotApplicable(string reason)
        {
            Applicability a = new Applicability();
            a.Kind = "NOT_APPLICABLE";
            a.Reason = reason;
            a.Missing = new string[0];
            return a;
        }

        internal static Applicability Uncertain(string[] missing)
        {
            Applicability a = new Applicability();
            a.Kind = "UNCERTAIN";
            a.Missing = missing ?? new string[0];
            return a;
        }
    }

    /// <summary>
    /// НЭГ дүрмийн гүйцэтгэлийн үр дүн.
    /// ⚠️ `CalcJson` / `EvidenceJson` нь ЭНЭ ТӨРӨЛД ОРОХГҮЙ — тэдгээрийг `2-3`
    /// нь `FindingRow`-д УГСАРНА.  Цэвэр хөдөлгүүр цуваарилдаггүй.
    /// </summary>
    internal sealed class RuleOutcome
    {
        public string RuleUid;
        public int RuleVersion;
        public Verdict Result;
        /// <summary>ХАВЧААРЫН ДАРААХ утга.</summary>
        public string Severity;
        public string IssueClass;
        /// <summary>ХАВЧААРЫН ДАРААХ утга.</summary>
        public string EvidenceLevel;

        public double? ObservedValue;
        public double? ThresholdValue;
        public string Unit;

        public string[] MissingInputs;
        public string[] ConflictRuleUids;

        /// <summary>NOT_APPLICABLE-ийн шалтгаан — мөр ҮҮСГЭХГҮЙ.</summary>
        public string SkippedReason;
        /// <summary>`Result != Uncertain` бол null.</summary>
        public string UncertainReason;

        /// <summary>
        /// ХАВЧААРЫН ДАРААХ утга — `clampByVerification`-ийн `suppressCitation`.
        /// true бол UI нь `document_uid` / `clause_uid` / `edition_ref` ГУРВЫГ
        /// ХАРУУЛАХГҮЙ, тэдний ОРОНД `CitationLabelMn`-ийг харуулна.
        /// ⚠️ Энэ хоёр талбар нь TS-ийн `ClampOutput`-ийн 4, 5 дахь гаралт —
        /// тэднийг хасах нь хос файлыг ЧИМЭЭГҮЙ зөрүүлнэ.
        /// </summary>
        public bool SuppressCitation;
        /// <summary>`SuppressCitation == false` бол null.</summary>
        public string CitationLabelMn;
    }

    /// <summary>
    /// ДҮРМИЙН ГҮЙЦЭТГЭГЧ.  ⚠️ Revit-ийн API-гийн ямар ч төрөл БАЙХГҮЙ: оролт
    /// нь `FactBag`, гаралт нь `RuleOutcome`.
    ///
    /// ⛔ ИНФЕРЕНС ЭНД ХЭЗЭЭ Ч БАЙХГҮЙ.  LLM дуудлага, сүлжээ, диск байхгүй.
    /// ⛔ `RevitToolEventHandler.Execute` (`RevitToolBus.cs:442-454`) ба
    ///    `ChangeTracker.OnDocumentChanged` (`ChangeTracker.cs:764-775`) дээр
    ///    ХЭЗЭЭ Ч ажиллахгүй.
    ///
    /// ⚠️ ХОС ФАЙЛ: `backend/src/lib/ruleApplicability.ts` +
    ///    `backend/src/lib/complianceModel.ts`.  Харш нь
    ///    `revit-mcp/training/check_rules.py --parity`.
    /// </summary>
    internal static class RuleEngine
    {
        /* ============================================================== */
        /*  ХЯЗГААРУУД — Хавсралт §5.9                                     */
        /* ============================================================== */

        internal const int MAX_NODE_DEPTH = 8;
        internal const int MAX_NODES_PER_RULE = 64;
        internal const int MAX_ARRAY_OPERANDS = 32;
        internal const int MAX_NEEDLE_LEN = 64;

        /// <summary>EPS — ЗӨВХӨН eq / ne / in / between-ийн гишүүнчлэлд.
        /// Эрэмбийн операторууд (gt/gte/lt/lte) НЯГТ (Хавсралт §5.4).</summary>
        internal const double NUMERIC_EPSILON = 1e-9;

        /* ============================================================== */
        /*  ДӨРВӨН ХААЛГА — ХОС ФАЙЛЫН ТОГТМОЛУУД                          */
        /* ============================================================== */

        // ⚠️ ЭДГЭЭР НЭР НЬ ЗОРИУД SCREAMING_SNAKE_CASE — C#-ийн заншил БИШ.
        //    `backend/src/lib/ruleApplicability.ts` дээр ЯГ ижил нэртэй байх ба
        //    хос файлын тулгалт (`grep -c "HIGH_RISE_HEIGHT_M\|HIGH_RISE_STORIES"`)
        //    ХОЁУЛАНГ НЬ олох ёстой.  Нэг талд 51-ийг 50 болгосон засвар нь
        //    ЧИМЭЭГҮЙ өнгөрөх ЁСГҮЙ.
        internal const double HIGH_RISE_HEIGHT_M = 51;
        internal const double HIGH_RISE_STORIES = 16;
        internal const double WIND_RESONANCE_HEIGHT_M = 30;
        internal const double CAST_IN_PLACE_STORIES = 21;
        internal const double NETWORK_REPEATER_STORIES = 15;

        /// <summary>
        /// ⚠️ «мэдэхгүй» нь `false` БИШ.  Хоёулаа NULL бол `null` буцаана —
        /// чимээгүй PASS нь R2-ийн хамгийн муу уналт.
        /// </summary>
        internal static bool? OpensHighRiseDocumentSet(double? heightM, double? storiesAboveGrade)
        {
            if (!heightM.HasValue && !storiesAboveGrade.HasValue) return null;
            if (heightM.HasValue && heightM.Value > HIGH_RISE_HEIGHT_M) return true;
            if (storiesAboveGrade.HasValue && storiesAboveGrade.Value > HIGH_RISE_STORIES) return true;
            return false;
        }

        /* ============================================================== */
        /*  ЗАДЛАГЧ — ХЭЗЭЭ Ч ШИДЭХГҮЙ (Хавсралт §5.11)                    */
        /* ============================================================== */

        private static readonly string[] CombinatorKeys = { "all", "any", "not", "if", "then", "else" };

        internal static bool IsFactName(string s)
        {
            if (string.IsNullOrEmpty(s)) return false;
            int dot = s.IndexOf('.');
            if (dot <= 0) return false;
            string scope = s.Substring(0, dot);
            if (scope != "project" && scope != "doc" && scope != "element") return false;
            string local = s.Substring(dot + 1);
            if (local.Length < 1 || local.Length > 48) return false;
            char c0 = local[0];
            if (c0 < 'a' || c0 > 'z') return false;
            for (int i = 1; i < local.Length; i++)
            {
                char c = local[i];
                bool ok = (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '_';
                if (!ok) return false;
            }
            return true;
        }

        internal static bool TryParsePredicate(JsonElement raw, out CheckNode node, out string err)
        {
            return TryParseNode(raw, "$", 1, false, out node, out err);
        }

        internal static bool TryParseCheck(JsonElement raw, out CheckNode node, out string err)
        {
            return TryParseNode(raw, "$", 1, true, out node, out err);
        }

        internal static bool IsEmptyObject(JsonElement raw)
        {
            if (raw.ValueKind != JsonValueKind.Object) return false;
            foreach (JsonProperty unused in raw.EnumerateObject()) { return false; }
            return true;
        }

        private static bool Fail(string message, string path, out CheckNode node, out string err)
        {
            node = null;
            err = path + ": " + message;
            return false;
        }

        private static bool TryParseNode(
            JsonElement raw, string path, int depth, bool allowCond, out CheckNode node, out string err)
        {
            node = null;
            err = null;
            if (depth > MAX_NODE_DEPTH) return Fail("гүн хэтэрсэн", path, out node, out err);
            if (raw.ValueKind != JsonValueKind.Object) return Fail("объект байх ёстой", path, out node, out err);

            List<string> keys = new List<string>();
            foreach (JsonProperty p in raw.EnumerateObject()) keys.Add(p.Name);
            if (keys.Count == 0) return Fail("хоосон зангилаа", path, out node, out err);

            string first = keys[0];

            if (keys.Count == 1 && (first == "all" || first == "any"))
            {
                JsonElement arr = raw.GetProperty(first);
                if (arr.ValueKind != JsonValueKind.Array)
                {
                    return Fail(first + " нь цуваа байх ёстой", path, out node, out err);
                }
                List<CheckNode> kids = new List<CheckNode>();
                int i = 0;
                foreach (JsonElement child in arr.EnumerateArray())
                {
                    CheckNode kid;
                    if (!TryParseNode(child, path + "." + first + "[" + i + "]", depth + 1, allowCond, out kid, out err))
                    {
                        node = null;
                        return false;
                    }
                    kids.Add(kid);
                    i++;
                }
                node = new CheckNode();
                node.Kind = first == "all" ? NodeKind.All : NodeKind.Any;
                node.Children = kids.ToArray();
                return true;
            }

            if (keys.Count == 1 && first == "not")
            {
                CheckNode inner;
                if (!TryParseNode(raw.GetProperty("not"), path + ".not", depth + 1, allowCond, out inner, out err))
                {
                    node = null;
                    return false;
                }
                node = new CheckNode();
                node.Kind = NodeKind.Not;
                node.Child = inner;
                return true;
            }

            if (keys.Contains("if") || keys.Contains("then") || keys.Contains("else"))
            {
                if (!allowCond)
                {
                    return Fail("cond нь applicability-д зөвшөөрөгдөхгүй", path, out node, out err);
                }
                if (keys.Count != 3 || !keys.Contains("if") || !keys.Contains("then") || !keys.Contains("else"))
                {
                    return Fail("cond нь ЯГ if/then/else гурвыг агуулна", path, out node, out err);
                }
                CheckNode c1, c2, c3;
                if (!TryParseNode(raw.GetProperty("if"), path + ".if", depth + 1, false, out c1, out err))
                {
                    node = null;
                    return false;
                }
                if (!TryParseNode(raw.GetProperty("then"), path + ".then", depth + 1, true, out c2, out err))
                {
                    node = null;
                    return false;
                }
                if (!TryParseNode(raw.GetProperty("else"), path + ".else", depth + 1, true, out c3, out err))
                {
                    node = null;
                    return false;
                }
                node = new CheckNode();
                node.Kind = NodeKind.Cond;
                node.If = c1;
                node.Then = c2;
                node.Else = c3;
                return true;
            }

            if (keys.Count != 1) return Fail("навч нь ЯГ нэг түлхүүртэй", path, out node, out err);
            if (Array.IndexOf(CombinatorKeys, first) >= 0)
            {
                return Fail(first + " нь хасагдсан үг", path, out node, out err);
            }
            if (!IsFactName(first)) return Fail("баримтын нэр хүчингүй: " + first, path, out node, out err);

            JsonElement opObj = raw.GetProperty(first);
            if (opObj.ValueKind != JsonValueKind.Object)
            {
                return Fail("операторын объект байх ёстой", path, out node, out err);
            }
            string op = null;
            int opCount = 0;
            foreach (JsonProperty p in opObj.EnumerateObject()) { op = p.Name; opCount++; }
            if (opCount != 1) return Fail("ЯГ нэг оператор байна", path, out node, out err);

            JsonElement operand = opObj.GetProperty(op);
            string leafPath = path + "." + first + "." + op;

            switch (op)
            {
                case "eq":
                case "ne":
                    if (operand.ValueKind == JsonValueKind.String)
                    {
                        node = new CheckNode();
                        node.Kind = NodeKind.CmpText;
                        node.Fact = first;
                        node.Op = op;
                        node.Text = operand.GetString();
                        return true;
                    }
                    return LeafNumber(operand, first, op, leafPath, out node, out err);
                case "gt":
                case "gte":
                case "lt":
                case "lte":
                    return LeafNumber(operand, first, op, leafPath, out node, out err);
                case "between":
                {
                    if (operand.ValueKind != JsonValueKind.Array || operand.GetArrayLength() != 2)
                    {
                        return Fail("between нь [lo, hi] цуваа", leafPath, out node, out err);
                    }
                    double lo = 0, hi = 0;
                    int idx = 0;
                    foreach (JsonElement x in operand.EnumerateArray())
                    {
                        double v;
                        if (!NumberOk(x, out v)) return Fail("between нь тоон хос", leafPath, out node, out err);
                        if (idx == 0) lo = v; else hi = v;
                        idx++;
                    }
                    if (lo > hi) return Fail("between: lo > hi", leafPath, out node, out err);
                    node = new CheckNode();
                    node.Kind = NodeKind.Between;
                    node.Fact = first;
                    node.Lo = lo;
                    node.Hi = hi;
                    return true;
                }
                case "in":
                {
                    if (operand.ValueKind != JsonValueKind.Array || operand.GetArrayLength() == 0)
                    {
                        return Fail("in нь хоосон биш цуваа", leafPath, out node, out err);
                    }
                    if (operand.GetArrayLength() > MAX_ARRAY_OPERANDS)
                    {
                        return Fail("in хэт олон гишүүнтэй", leafPath, out node, out err);
                    }
                    bool allText = true, allNum = true;
                    foreach (JsonElement x in operand.EnumerateArray())
                    {
                        if (x.ValueKind != JsonValueKind.String) allText = false;
                        double ignored;
                        if (!NumberOk(x, out ignored)) allNum = false;
                    }
                    if (allText)
                    {
                        List<string> texts = new List<string>();
                        foreach (JsonElement x in operand.EnumerateArray()) texts.Add(x.GetString());
                        node = new CheckNode();
                        node.Kind = NodeKind.InText;
                        node.Fact = first;
                        node.Texts = texts.ToArray();
                        return true;
                    }
                    if (allNum)
                    {
                        List<double> nums = new List<double>();
                        foreach (JsonElement x in operand.EnumerateArray())
                        {
                            double v;
                            NumberOk(x, out v);
                            nums.Add(v);
                        }
                        node = new CheckNode();
                        node.Kind = NodeKind.InNum;
                        node.Fact = first;
                        node.Nums = nums.ToArray();
                        return true;
                    }
                    return Fail("in нь НЭГ ТӨРЛИЙН цуваа байна", leafPath, out node, out err);
                }
                case "contains_any":
                {
                    if (operand.ValueKind != JsonValueKind.Array || operand.GetArrayLength() == 0)
                    {
                        return Fail("contains_any нь хоосон биш мөрийн цуваа", leafPath, out node, out err);
                    }
                    if (operand.GetArrayLength() > MAX_ARRAY_OPERANDS)
                    {
                        return Fail("contains_any хэт олон гишүүнтэй", leafPath, out node, out err);
                    }
                    List<string> needles = new List<string>();
                    foreach (JsonElement x in operand.EnumerateArray())
                    {
                        if (x.ValueKind != JsonValueKind.String) return Fail("needle нь мөр", leafPath, out node, out err);
                        string s = x.GetString();
                        if (string.IsNullOrEmpty(s)) return Fail("needle хоосон", leafPath, out node, out err);
                        if (s.Length > MAX_NEEDLE_LEN) return Fail("needle хэт урт", leafPath, out node, out err);
                        needles.Add(s);
                    }
                    node = new CheckNode();
                    node.Kind = NodeKind.ContainsAny;
                    node.Fact = first;
                    node.Texts = needles.ToArray();
                    return true;
                }
                case "exists":
                {
                    if (operand.ValueKind != JsonValueKind.True && operand.ValueKind != JsonValueKind.False)
                    {
                        return Fail("exists нь true/false", leafPath, out node, out err);
                    }
                    node = new CheckNode();
                    node.Kind = NodeKind.Exists;
                    node.Fact = first;
                    node.Want = operand.ValueKind == JsonValueKind.True;
                    return true;
                }
                default:
                    return Fail("оператор танигдахгүй: " + op, leafPath, out node, out err);
            }
        }

        private static bool LeafNumber(
            JsonElement operand, string fact, string op, string leafPath, out CheckNode node, out string err)
        {
            double v;
            if (!NumberOk(operand, out v)) return Fail("операнд нь тоо байх ёстой", leafPath, out node, out err);
            node = new CheckNode();
            node.Kind = NodeKind.Cmp;
            node.Fact = fact;
            node.Op = op;
            node.Num = v;
            err = null;
            return true;
        }

        /// <summary>
        /// §6.3-ын ТООНЫ ПРОФАЙЛ.  ⚠️ ТҮҮХИЙ БИЧВЭР дээр шалгана: `1e3` нь
        /// `GetDouble()`-ээр 1000 болж задардаг тул экспонентыг зөвхөн
        /// `GetRawText()` барина.
        /// </summary>
        internal static bool NumberOk(JsonElement e, out double value)
        {
            value = 0;
            if (e.ValueKind != JsonValueKind.Number) return false;
            string raw = e.GetRawText();
            if (raw.IndexOf('e') >= 0 || raw.IndexOf('E') >= 0) return false;
            int dot = raw.IndexOf('.');
            if (dot >= 0 && raw.Length - dot - 1 > 6) return false;
            double v;
            if (!double.TryParse(raw, NumberStyles.Float, CultureInfo.InvariantCulture, out v)) return false;
            if (double.IsNaN(v) || double.IsInfinity(v)) return false;
            if (Math.Abs(v) >= 1e9) return false;
            value = v;
            return true;
        }

        internal static int CountNodes(CheckNode n)
        {
            if (n == null) return 0;
            switch (n.Kind)
            {
                case NodeKind.All:
                case NodeKind.Any:
                {
                    int total = 1;
                    for (int i = 0; i < n.Children.Length; i++) total += CountNodes(n.Children[i]);
                    return total;
                }
                case NodeKind.Not: return 1 + CountNodes(n.Child);
                case NodeKind.Cond: return 1 + CountNodes(n.If) + CountNodes(n.Then) + CountNodes(n.Else);
                default: return 1;
            }
        }

        /* ============================================================== */
        /*  ҮНЭЛГЭЭ                                                        */
        /* ============================================================== */

        internal static NodeEval Evaluate(CheckNode node, FactBag facts)
        {
            List<string> problems = new List<string>();
            NodeEval r = Eval(node, facts, 1, problems);
            r.Problem = problems.Count > 0 ? problems[0] : null;
            return r;
        }

        private static NodeEval Leaf(CheckNode node, FactBag facts, List<string> problems)
        {
            NodeEval e = new NodeEval();
            e.DecidingLeaf = node;
            e.Blocking = new string[0];

            FactResolution res = facts.Resolve(node.Fact);
            if (res.Problem != null && !problems.Contains(res.Problem)) problems.Add(res.Problem);
            FactValue v = res.Value;

            if (node.Kind == NodeKind.Exists)
            {
                // ⚠️ `exists` нь Missing-ийг ТОДОРХОЙ буль болгодог ЦОРЫН ГАНЦ оператор.
                bool present = v.Kind != RuleFactKind.Missing;
                e.Result = present == node.Want ? Tri.True : Tri.False;
                return e;
            }

            if (v.Kind == RuleFactKind.Missing)
            {
                e.Result = Tri.Unknown;
                e.Blocking = new string[] { node.Fact };
                return e;
            }

            switch (node.Kind)
            {
                case NodeKind.Cmp:
                {
                    if (v.Kind != RuleFactKind.Number) { e.Result = Tri.Unknown; e.Blocking = new string[] { node.Fact }; return e; }
                    double a = v.Num.Value;
                    switch (node.Op)
                    {
                        case "eq": e.Result = NearlyEqual(a, node.Num) ? Tri.True : Tri.False; break;
                        case "ne": e.Result = NearlyEqual(a, node.Num) ? Tri.False : Tri.True; break;
                        case "gt": e.Result = a > node.Num ? Tri.True : Tri.False; break;
                        case "gte": e.Result = a >= node.Num ? Tri.True : Tri.False; break;
                        case "lt": e.Result = a < node.Num ? Tri.True : Tri.False; break;
                        case "lte": e.Result = a <= node.Num ? Tri.True : Tri.False; break;
                        default: e.Result = Tri.Unknown; break;
                    }
                    return e;
                }
                case NodeKind.CmpText:
                {
                    if (v.Kind != RuleFactKind.Text) { e.Result = Tri.Unknown; e.Blocking = new string[] { node.Fact }; return e; }
                    bool same = string.Equals(v.Text, node.Text, StringComparison.Ordinal);
                    e.Result = (node.Op == "eq" ? same : !same) ? Tri.True : Tri.False;
                    return e;
                }
                case NodeKind.Between:
                {
                    if (v.Kind != RuleFactKind.Number) { e.Result = Tri.Unknown; e.Blocking = new string[] { node.Fact }; return e; }
                    double a = v.Num.Value;
                    bool inside = (a > node.Lo || NearlyEqual(a, node.Lo)) && (a < node.Hi || NearlyEqual(a, node.Hi));
                    e.Result = inside ? Tri.True : Tri.False;
                    return e;
                }
                case NodeKind.InNum:
                {
                    if (v.Kind != RuleFactKind.Number) { e.Result = Tri.Unknown; e.Blocking = new string[] { node.Fact }; return e; }
                    e.Result = Tri.False;
                    for (int i = 0; i < node.Nums.Length; i++)
                    {
                        if (NearlyEqual(v.Num.Value, node.Nums[i])) { e.Result = Tri.True; break; }
                    }
                    return e;
                }
                case NodeKind.InText:
                {
                    if (v.Kind != RuleFactKind.Text) { e.Result = Tri.Unknown; e.Blocking = new string[] { node.Fact }; return e; }
                    e.Result = Tri.False;
                    for (int i = 0; i < node.Texts.Length; i++)
                    {
                        if (string.Equals(v.Text, node.Texts[i], StringComparison.Ordinal)) { e.Result = Tri.True; break; }
                    }
                    return e;
                }
                case NodeKind.ContainsAny:
                {
                    if (v.Kind != RuleFactKind.Text) { e.Result = Tri.Unknown; e.Blocking = new string[] { node.Fact }; return e; }
                    // ⚠️ Needle-ууд БАГЦАД АЛЬ ХЭДИЙН хураагдсан — хөдөлгүүр
                    //    `TextFold`-д ХҮРЭХГҮЙ (тав дахь хуулбар үүсгэхгүй).
                    e.Result = Tri.False;
                    for (int i = 0; i < node.Texts.Length; i++)
                    {
                        if (v.Text.IndexOf(node.Texts[i], StringComparison.Ordinal) >= 0)
                        {
                            e.Result = Tri.True;
                            break;
                        }
                    }
                    return e;
                }
                default:
                    e.Result = Tri.Unknown;
                    return e;
            }
        }

        private static NodeEval Eval(CheckNode node, FactBag facts, int depth, List<string> problems)
        {
            NodeEval e = new NodeEval();
            e.Blocking = new string[0];

            // ⚠️ Гүний тоолуур ДАВХАР: хэтэрвэл Unknown, ШИДЭХГҮЙ — %APPDATA%-д
            //    гараар засагдсан файл Revit-ийг StackOverflow-оор унагахгүй.
            if (node == null || depth > MAX_NODE_DEPTH)
            {
                e.Result = Tri.Unknown;
                return e;
            }

            switch (node.Kind)
            {
                case NodeKind.All:
                {
                    Tri acc = Tri.True;
                    CheckNode firstFalse = null;
                    List<string> blocks = new List<string>();
                    for (int i = 0; i < node.Children.Length; i++)
                    {
                        NodeEval r = Eval(node.Children[i], facts, depth + 1, problems);
                        acc = Kleene.All(acc, r.Result);
                        if (r.Result == Tri.Unknown) AddAll(blocks, r.Blocking);
                        if (r.Result == Tri.False && firstFalse == null) firstFalse = r.DecidingLeaf;
                    }
                    e.Result = acc;
                    e.DecidingLeaf = acc == Tri.False ? firstFalse : null;
                    if (acc == Tri.Unknown) e.Blocking = Sorted(blocks);
                    return e;
                }
                case NodeKind.Any:
                {
                    Tri acc = Tri.False;
                    CheckNode firstTrue = null;
                    List<string> blocks = new List<string>();
                    for (int i = 0; i < node.Children.Length; i++)
                    {
                        NodeEval r = Eval(node.Children[i], facts, depth + 1, problems);
                        acc = Kleene.Any(acc, r.Result);
                        if (r.Result == Tri.Unknown) AddAll(blocks, r.Blocking);
                        if (r.Result == Tri.True && firstTrue == null) firstTrue = r.DecidingLeaf;
                    }
                    e.Result = acc;
                    e.DecidingLeaf = acc == Tri.True ? firstTrue : null;
                    if (acc == Tri.Unknown) e.Blocking = Sorted(blocks);
                    return e;
                }
                case NodeKind.Not:
                {
                    NodeEval r = Eval(node.Child, facts, depth + 1, problems);
                    e.Result = Kleene.Not(r.Result);
                    // ⚠️ Үгүйсгэл нь босгын утгыг эсрэгээр уншуулна → null.
                    e.DecidingLeaf = null;
                    e.Blocking = r.Blocking;
                    return e;
                }
                case NodeKind.Cond:
                {
                    NodeEval c = Eval(node.If, facts, depth + 1, problems);
                    // ⚠️ Unknown нөхцөл дээр ХОЁУЛАНГ НЬ ҮНЭЛЭХГҮЙ.  Хатуу салааг
                    //    сонговол хэн ч тавиагүй шаардлага зохионо; зөөлнийг
                    //    сонговол ХУДАЛ PASS — хоёул хориотой.
                    if (c.Result == Tri.Unknown)
                    {
                        e.Result = Tri.Unknown;
                        e.DecidingLeaf = null;
                        e.Blocking = c.Blocking;
                        return e;
                    }
                    CheckNode branch = c.Result == Tri.True ? node.Then : node.Else;
                    return Eval(branch, facts, depth + 1, problems);
                }
                default:
                    return Leaf(node, facts, problems);
            }
        }

        private static void AddAll(List<string> into, string[] items)
        {
            if (items == null) return;
            for (int i = 0; i < items.Length; i++)
            {
                if (!into.Contains(items[i])) into.Add(items[i]);
            }
        }

        private static string[] Sorted(List<string> items)
        {
            string[] a = items.ToArray();
            Array.Sort(a, StringComparer.Ordinal);
            return a;
        }

        private static bool NearlyEqual(double a, double b)
        {
            return Math.Abs(a - b) <= NUMERIC_EPSILON;
        }

        /* ============================================================== */
        /*  ХАМААРАЛ — Хавсралт §9.1                                       */
        /* ============================================================== */

        /// <summary>
        /// Навчны баримтын нэр → `NOT_APPLICABLE.reason`.  ХААЛТТАЙ зураглал;
        /// `ruleApplicability.ts`-ийн `applicabilityReasonForFact`-тай ЯГ таарна.
        /// </summary>
        internal static string ReasonForFact(string fact)
        {
            if (fact == "project.height_m" || fact == "project.stories_above_grade") return "high_rise_gate";
            if (fact == "doc.room_boundary_location") return "boundary_location";
            if (fact == "element.category") return "category";
            if (fact == "element.name_folded") return "name";
            if (fact.StartsWith("project.", StringComparison.Ordinal) ||
                fact.StartsWith("doc.", StringComparison.Ordinal))
            {
                return "context";
            }
            return "category";
        }

        /// <summary>
        /// ШИЙДСЭН ХУДАЛ НАВЧ — ЗӨВХӨН `reason` гаргахад.
        /// ⚠️ Хавсралт §5.7-ийн `DecidingLeaf`-ЭЭС ӨӨР: тэр нь БОСГО
        /// тайлагнахад зориулагдсан тул `any` ХУДАЛ болоход `null` буцаадаг.
        /// Гэтэл P2 fixture (`height_m = 51` ЯГ) нь `any[...]` бүхэлдээ ХУДАЛ
        /// болох замаар `high_rise_gate` шаарддаг — `any` ХУДАЛ бол бүх хүүхэд
        /// ХУДАЛ гэдгийг ашиглаж ЭХНИЙХИЙГ нь авна.
        /// </summary>
        private static CheckNode DecisiveFalseLeaf(CheckNode node, FactBag facts)
        {
            if (node == null) return null;
            List<string> ignored = new List<string>();
            if (Eval(node, facts, 1, ignored).Result != Tri.False) return null;
            switch (node.Kind)
            {
                case NodeKind.All:
                case NodeKind.Any:
                {
                    for (int i = 0; i < node.Children.Length; i++)
                    {
                        CheckNode r = DecisiveFalseLeaf(node.Children[i], facts);
                        if (r != null) return r;
                    }
                    return null;
                }
                case NodeKind.Not:
                    return null;
                case NodeKind.Cond:
                {
                    List<string> ign2 = new List<string>();
                    Tri c = Eval(node.If, facts, 1, ign2).Result;
                    if (c == Tri.True) return DecisiveFalseLeaf(node.Then, facts);
                    if (c == Tri.False) return DecisiveFalseLeaf(node.Else, facts);
                    return null;
                }
                default:
                    return node;
            }
        }

        /// <summary>
        /// ⚠️ ХАМААРЛЫН ҮНЭЛГЭЭНИЙ ДАРААЛАЛ (ХОЁР ТАЛД ижил).  `2-2`-ийн
        /// Хавсралт §9.1 нь 2-р алхмыг «requiresContext-ийн аль нэг нь Missing
        /// бол ШУУД UNCERTAIN» гэж бичсэн, гэтэл §3.13.1-ийн **P4** fixture
        /// (`height=null`, `stories=17`) нь APPLICABLE байхыг шаарддаг — хоёр
        /// шаардлага НЭГ ЗЭРЭГ биелэх БОЛОМЖГҮЙ.  ШИЙДЭВ: `requiresContext` нь
        /// UNCERTAIN-ы ШАЛТГААНЫГ НЭРЛЭНЭ, UNCERTAIN болохыг ӨӨРӨӨ ШИЙДЭХГҮЙ.
        ///   1. exceptions[] — аль нэг нь True → NOT_APPLICABLE("exception:"+code)
        ///   2. applicability Kleene: True→APPLICABLE, False→NOT_APPLICABLE(reason),
        ///      Unknown→UNCERTAIN(requiresContext ∩ blocking, эс бөгөөс blocking)
        /// </summary>
        internal static Applicability EvaluateApplicability(RuleDef rule, FactBag facts)
        {
            List<string> fired = new List<string>();
            if (rule.Exceptions != null)
            {
                for (int i = 0; i < rule.Exceptions.Length; i++)
                {
                    RuleException ex = rule.Exceptions[i];
                    if (ex == null) continue;
                    // ⚠️ `when` БАЙХГҮЙ ҮЕД АЛГАСАХ нь FAIL-OPEN: дүрэм ИЛ
                    //    зөвшөөрсөн тохиолдол (жишээ нь `atrium`) зөрчил болж
                    //    инженерийн нүүр рүү гарна, ямар ч дохиогүй.  Тиймээс
                    //    ЭНД АЛГАСАХГҮЙ — ХАМААРЛЫГ ТОГТООЖ ЧАДААГҮЙ гэж үзээд
                    //    UNCERTAIN буцаана (fail-closed).
                    //    ⚠️ Үндсэн хаалга нь `RulePack.ParseRule` — тэр нь
                    //    `when`-гүй үл хамаарах зүйлтэй БАГЦЫГ БҮХЭЛД НЬ
                    //    ТАТГАЛЗАНА, тиймээс ачаалагдсан багцаас энэ салаа
                    //    хүрэхгүй.  Энэ нь кодоор угсарсан `RuleDef`-ийн
                    //    эсрэг хоёр дахь давхарга.
                    if (ex.When == null) return Applicability.Uncertain(new string[0]);
                    if (Evaluate(ex.When, facts).Result == Tri.True) fired.Add(ex.Code);
                }
            }
            if (fired.Count > 0)
            {
                string[] codes = Sorted(fired);
                return Applicability.NotApplicable("exception:" + codes[0]);
            }

            if (rule.Applicability == null) return Applicability.Applicable();

            NodeEval e = Evaluate(rule.Applicability, facts);
            if (e.Result == Tri.True) return Applicability.Applicable();
            if (e.Result == Tri.False)
            {
                CheckNode leaf = DecisiveFalseLeaf(rule.Applicability, facts);
                return Applicability.NotApplicable(leaf != null ? ReasonForFact(leaf.Fact) : "context");
            }

            List<string> declared = new List<string>();
            if (rule.RequiresContext != null)
            {
                for (int i = 0; i < rule.RequiresContext.Length; i++)
                {
                    string name = rule.RequiresContext[i];
                    if (Array.IndexOf(e.Blocking, name) >= 0 && !declared.Contains(name)) declared.Add(name);
                }
            }
            string[] missing = declared.Count > 0 ? Sorted(declared) : e.Blocking;
            return Applicability.Uncertain(missing);
        }

        /// <summary>
        /// ХЯМД УРЬДЧИЛСАН ШҮҮЛТ — `FactBag`-ийн ХЭСЭГЧИЛСЭН хувилбар дээр,
        /// Revit уншихаас ӨМНӨ.
        ///
        /// ⚠️ МОНОТОН: `False` үед Л `false`; `Unknown` үед `true`.
        /// «Unknown → false» гэж бичих нь энэ хөдөлгүүрийн ХАМГИЙН ХЯЛБАР,
        /// ХАМГИЙН ХОР ХӨНӨӨЛТЭЙ АЛДАА — `element.name_folded` нь урьдчилсан
        /// шүүлтийн үед ҮРГЭЛЖ Missing тул бүх дүрэм ЧИМЭЭГҮЙ УНТАРНА.
        /// </summary>
        internal static bool MayApply(RuleDef rule, FactBag partial, out string skipReason)
        {
            skipReason = null;
            if (rule.Applicability == null) return true;
            if (Evaluate(rule.Applicability, partial).Result != Tri.False) return true;
            CheckNode leaf = DecisiveFalseLeaf(rule.Applicability, partial);
            skipReason = leaf != null ? ReasonForFact(leaf.Fact) : "context";
            return false;
        }

        /* ============================================================== */
        /*  ХАВЧААР + ГҮЙЦЭТГЭЛ                                            */
        /* ============================================================== */

        /// <summary>
        /// UNVERIFIED дүрмийн эшлэлийг орлох бичвэр — `complianceModel.ts`-ийн
        /// `UNVERIFIED_CITATION_MN`-ийн ҮСЭГ ҮСГИЙН хос.  ⚠️ Хоёр талын мөр
        /// ЗӨРВӨЛ нэг нүүрэнд «дотоод шалгуур», нөгөөд нь өөр бичвэр гарна.
        /// </summary>
        internal const string UNVERIFIED_CITATION_MN = "дотоод шалгуур (эх сурвалж баталгаажаагүй)";

        internal static readonly string[] SeverityOrder = { "INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL" };
        internal static readonly string[] EvidenceOrder =
        {
            "UNKNOWN", "AI_INFERRED", "MODEL_DERIVED", "RULE_BACKED", "HUMAN_VERIFIED",
        };

        internal static int SeverityRank(string s)
        {
            int i = Array.IndexOf(SeverityOrder, s ?? "");
            return i < 0 ? 0 : i + 1;
        }

        internal static int EvidenceRank(string s)
        {
            int i = Array.IndexOf(EvidenceOrder, s ?? "");
            return i < 0 ? 0 : i + 1;
        }

        /// <summary>
        /// БАТАЛГААНЫ ХАВЧААР — `complianceModel.ts`-ийн `clampByVerification`-ийн
        /// C# хос.  ⚠️ `RuleEngine.Execute`-ийн ТӨГСГӨЛД НЭГ УДАА хэрэглэнэ;
        /// `2-3` нь түүнийг ДАХИН хэрэгжүүлэхгүй.
        /// </summary>
        internal static void ClampByVerification(RuleOutcome outcome, string verificationState)
        {
            if (!string.Equals(verificationState, "UNVERIFIED", StringComparison.Ordinal))
            {
                outcome.SuppressCitation = false;
                outcome.CitationLabelMn = null;
                return;
            }
            if (outcome.Result == Verdict.Violation) outcome.Result = Verdict.Warning;
            outcome.EvidenceLevel = "MODEL_DERIVED";
            if (string.Equals(outcome.Severity, "CRITICAL", StringComparison.Ordinal))
            {
                outcome.Severity = "HIGH";
            }
            // ⚠️ 4, 5 дахь ГАРАЛТ.  Эзний шийдвэр: UNVERIFIED нь ЭШЛЭЛИЙГ дарна,
            //    зөвхөн ноцтой байдлыг БИШ.  Эдгээргүйгээр `2-5`-ийн рендерер
            //    баталгаажаагүй дүрмийн «БНбД 31-03, 4.2» -ыг албан ёсны
            //    иш татсан мэт харуулна.
            outcome.SuppressCitation = true;
            outcome.CitationLabelMn = UNVERIFIED_CITATION_MN;
        }

        /// <summary>
        /// ХАМААРАЛ → ШАЛГАЛТ → ХАВЧААР.  ДАРААЛАЛ НЬ АЧАА ҮҮРНЭ: §61
        /// «Only after applicability is established should the rule be
        /// executed» — хамаарлыг тогтоохоос ӨМНӨ check ажиллуулбал контекстгүй
        /// төсөл дээр утгагүй тоо гарна.
        ///
        /// Буцах утга `null` = дүрэм ХАМААРАХГҮЙ (олдвор мөр ҮҮСГЭХГҮЙ);
        /// `SkippedReason` нь `skipped` гаралтад тусад нь өгөгдөнө.
        /// </summary>
        internal static RuleOutcome Execute(RuleDef rule, FactBag facts, out Applicability applicability)
        {
            applicability = EvaluateApplicability(rule, facts);

            RuleOutcome o = new RuleOutcome();
            o.RuleUid = rule.RuleUid;
            o.RuleVersion = rule.Version;
            o.Severity = rule.Severity;
            o.IssueClass = rule.IssueClass;
            o.EvidenceLevel = "MODEL_DERIVED";
            o.Unit = rule.Unit;
            o.MissingInputs = new string[0];
            o.ConflictRuleUids = new string[0];

            if (applicability.Kind == "NOT_APPLICABLE")
            {
                // ⚠️ NOT_APPLICABLE нь МӨР БОЛЖ ХЭЗЭЭ Ч ҮҮСЭХГҮЙ.
                o.SkippedReason = applicability.Reason;
                return null;
            }
            if (applicability.Kind == "UNCERTAIN")
            {
                o.Result = Verdict.Uncertain;
                o.MissingInputs = applicability.Missing;
                o.UncertainReason = "missing_context";
                ClampByVerification(o, rule.VerificationState);
                return o;
            }

            if (rule.Check == null)
            {
                // ⚠️ `check = {}` нь ХАМААРЛЫН ХЭМЖИГДЭХҮҮН — олдвор ҮҮСГЭХГҮЙ.
                return null;
            }

            NodeEval e = Evaluate(rule.Check, facts);
            if (e.Result == Tri.True)
            {
                o.Result = Verdict.Pass;
            }
            else if (e.Result == Tri.False)
            {
                o.Result = Verdict.Violation;
            }
            else
            {
                o.Result = Verdict.Uncertain;
                o.MissingInputs = e.Blocking;
                o.UncertainReason = e.Problem ?? "missing_input";
            }

            if (o.Result != Verdict.Uncertain)
            {
                FillValues(o, e.DecidingLeaf, facts, rule.Unit);
            }
            ClampByVerification(o, rule.VerificationState);
            return o;
        }

        /// <summary>
        /// §5.7-ийн ТАЙЛАГНАХ ДҮРЭМ — ГУРВЫГ хангавал Л утга бөглөгдөнө:
        /// (1) навч нь тоон, (2) операторыг нь gt/gte/lt/lte/between/eq/ne,
        /// (3) баримтын нэгж нь `rule.unit`-тай ЯГ тэнцүү.  ТААМАГЛАХГҮЙ.
        /// </summary>
        private static void FillValues(RuleOutcome o, CheckNode leaf, FactBag facts, string ruleUnit)
        {
            if (leaf == null) return;
            if (leaf.Kind != NodeKind.Cmp && leaf.Kind != NodeKind.Between) return;
            if (!string.Equals(Units.ForFactName(leaf.Fact), ruleUnit, StringComparison.Ordinal)) return;
            FactResolution r = facts.Resolve(leaf.Fact);
            if (r.Value.Kind != RuleFactKind.Number) return;
            double observed = r.Value.Num.Value;
            o.ObservedValue = observed;
            if (leaf.Kind == NodeKind.Cmp)
            {
                o.ThresholdValue = leaf.Num;
            }
            else
            {
                o.ThresholdValue = observed < leaf.Lo ? leaf.Lo : leaf.Hi;
            }
        }

        /* ============================================================== */
        /*  §64 — ЗӨРЧИЛДӨӨН.  НЭГИЙГ НЬ ЧИМЭЭГҮЙ СОНГОХГҮЙ                */
        /* ============================================================== */

        private static bool Loud(Verdict v)
        {
            return v == Verdict.Violation || v == Verdict.Warning;
        }

        private static bool Disagrees(RuleOutcome a, RuleOutcome b)
        {
            if (a.Result == b.Result) return false;
            return Loud(a.Result) || Loud(b.Result);
        }

        /// <summary>
        /// НЭГ ЭЛЕМЕНТИЙН дүгнэлтүүдийг эвлэрүүлнэ (Хавсралт §8.4).
        ///
        /// ⚠️ ХОЁР Pass ХЭЗЭЭ Ч ЗӨРЧИЛДӨХГҮЙ.
        /// ⚠️ `precedence` нь ДҮГНЭЛТИЙГ ХЭЗЭЭ Ч ӨӨРЧИЛӨХГҮЙ — хүн бүртгэсэн
        ///    тэргүүлэх эрх нь ЗӨВЛӨМЖ, автомат шийдэл БИШ.
        /// ⚠️ `ThresholdValue = null` ЗААВАЛ — зөрчилдөж буй хоёр босгын аль
        ///    нэгийг сонгож харуулах нь яг тэр «чимээгүй сонголт».
        /// ⚠️ `RuleUid` нь ordinal-аар ХАМГИЙН БАГА оролцогч — `DedupKey`-ийн
        ///    ТОГТВОРТОЙ БАЙДЛЫН шаардлага.
        /// </summary>
        internal static RuleOutcome[] Reconcile(RuleOutcome[] outcomes, ConflictTable table)
        {
            if (outcomes == null || outcomes.Length < 2 || table == null) return outcomes;

            List<int> involved = new List<int>();
            for (int i = 0; i < outcomes.Length; i++)
            {
                for (int j = i + 1; j < outcomes.Length; j++)
                {
                    if (!table.Has(outcomes[i].RuleUid, outcomes[j].RuleUid)) continue;
                    if (!Disagrees(outcomes[i], outcomes[j])) continue;
                    if (!involved.Contains(i)) involved.Add(i);
                    if (!involved.Contains(j)) involved.Add(j);
                }
            }
            if (involved.Count == 0) return outcomes;

            List<string> uids = new List<string>();
            string severity = "INFO";
            string evidence = "HUMAN_VERIFIED";
            List<string> missing = new List<string>();
            string unit = null;
            bool unitSame = true;
            // ⚠️ ЭШЛЭЛ ДАРАЛТ нь ЭВЛЭРҮҮЛЭЛТЭЭР СЭРГЭХГҮЙ: оролцогчдын АЛЬ НЭГ
            //    нь UNVERIFIED бол нэгтгэсэн мөр ч эшлэлгүй.  Эс бөгөөс
            //    зөрчилдөөн нь баталгаажаагүй дүрмийн эшлэлийг «хожигчийн»
            //    нэрээр буцааж оруулах цоорхой болно.
            bool suppress = false;
            for (int k = 0; k < involved.Count; k++)
            {
                RuleOutcome m = outcomes[involved[k]];
                if (m.SuppressCitation) suppress = true;
                if (!uids.Contains(m.RuleUid)) uids.Add(m.RuleUid);
                if (SeverityRank(m.Severity) > SeverityRank(severity)) severity = m.Severity;
                if (EvidenceRank(m.EvidenceLevel) < EvidenceRank(evidence)) evidence = m.EvidenceLevel;
                AddAll(missing, m.MissingInputs);
                if (unit == null) unit = m.Unit;
                else if (!string.Equals(unit, m.Unit, StringComparison.Ordinal)) unitSame = false;
            }
            string[] sortedUids = Sorted(uids);
            string winnerUid = sortedUids[0];
            int winnerVersion = 1;
            for (int k = 0; k < involved.Count; k++)
            {
                if (string.Equals(outcomes[involved[k]].RuleUid, winnerUid, StringComparison.Ordinal))
                {
                    winnerVersion = outcomes[involved[k]].RuleVersion;
                    break;
                }
            }

            RuleOutcome merged = new RuleOutcome();
            merged.RuleUid = winnerUid;
            merged.RuleVersion = winnerVersion;
            merged.Result = Verdict.Uncertain;
            merged.IssueClass = "UNKNOWN_NEEDS_REVIEW";
            merged.UncertainReason = "conflict";
            merged.ConflictRuleUids = sortedUids;
            merged.Severity = severity;
            merged.EvidenceLevel = evidence;
            merged.ObservedValue = null;
            merged.ThresholdValue = null;
            merged.Unit = unitSame && unit != null ? unit : Units.None;
            merged.MissingInputs = Sorted(missing);
            merged.SuppressCitation = suppress;
            merged.CitationLabelMn = suppress ? UNVERIFIED_CITATION_MN : null;

            List<RuleOutcome> outList = new List<RuleOutcome>();
            for (int i = 0; i < outcomes.Length; i++)
            {
                if (involved.Contains(i)) continue;
                outList.Add(outcomes[i]);
            }
            outList.Add(merged);
            return outList.ToArray();
        }
    }
}
