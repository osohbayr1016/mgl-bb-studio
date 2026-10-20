using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text;

namespace RevitMcpAddin.SmartCount.Core
{
    public sealed class EvalStats
    {
        /// <summary>Нөхцөл утга/төрөл таарахгүйн улмаас (тоон бус параметрт `>`, нэгж таарахгүй) шалгагдаж ЧАДААГҮЙ тоо.</summary>
        public int Problems { get; set; }
        public HashSet<string> ProblemNotes { get; set; } = new HashSet<string>(StringComparer.Ordinal);

        public void Problem(string note)
        {
            Problems++;
            if (ProblemNotes.Count < 20) ProblemNotes.Add(note);
        }
    }

    /// <summary>
    /// Нөхцөлийн модыг ХУУЛСАН элемент (`ElementRecord`) дээр шалгана — ЦЭВЭР.  Revit-ийн слабый
    /// шүүлтүүр (`ElementParameterFilter`) нь зөвхөн НАРИЙВЧЛАХ (superset); эцсийн шийдвэр ҮРГЭЛЖ энд —
    /// тиймээс Revit-ийн шүүлтүүрийн үсгийн/нарийвчлалын онцлог дүнг өөрчлөхгүй.
    ///
    /// Семантик (баримтжуулсан):
    ///   • Текст харьцуулалт өгөгдмөлөөр үсгийн том/жижгийг үл хамаарна, Юникод NFC-ээр (Монгол кирилл).
    ///   • Параметр ОЛДООГҮЙ элемент нь `NotExists`-д л таарна; бусад бүх харьцуулалтад (`NotEquals` ч)
    ///     таарахгүй (SQL-ийн NULL-тэй адил: «үл мэдэгдэх» нь «тэнцүү биш» БИШ).
    ///   • Тоон харьцуулалт ЗӨВХӨН тоон параметрт; текст параметрт `&gt;` → «шалгагдсангүй» (false + Problem).
    ///   • Тоон `Equals` нь хэрэглэгчийн утга тоо бол тоогоор (хүлцэлтэй), үгүй бол текстээр.
    ///   • Хоосон `AND` = бүгд; хоосон `OR` = юу ч таарахгүй.
    /// </summary>
    public static class QueryEvaluator
    {
        /// <summary>Тоон харьцуулалтын хүлцэл (КАНОНИК нэгжээр: мм / м² / м³ / °).  Revit-ийн native шүүлтүүрийн «суперсет» тэлэлт эдгээрээс ГАРАХ ёстой.</summary>
        internal const double AbsTol = 1e-6;
        internal const double RelTol = 1e-9;

        public static bool Matches(QueryNode node, ElementRecord r, EvalStats stats = null)
        {
            if (node == null) return true;
            stats = stats ?? new EvalStats();
            return Eval(node, r, stats, 0);
        }

        private static bool Eval(QueryNode n, ElementRecord r, EvalStats st, int depth)
        {
            if (depth > 12) { st.Problem("нөхцөл хэт гүн"); return false; }

            if (n.IsGroup)
            {
                IEnumerable<QueryNode> kids = n.Children ?? new List<QueryNode>();
                switch (n.Op)
                {
                    case LogicOp.And:
                        foreach (QueryNode k in kids) if (!Eval(k, r, st, depth + 1)) return false;
                        return true;
                    case LogicOp.Or:
                        bool any = false;
                        foreach (QueryNode k in kids) if (Eval(k, r, st, depth + 1)) { any = true; break; }
                        return any;
                    default:
                        st.Problem("танигдаагүй логик (AND/OR)");
                        return false;
                }
            }

            if (n.IsClause) return EvalClause(n, r, st);

            st.Problem("танигдаагүй зангилаа");
            return false;
        }

        private static bool EvalClause(QueryNode c, ElementRecord r, EvalStats st)
        {
            switch (c.Field)
            {
                case ClauseField.Category: return EvalText(c, r.Category, st);
                case ClauseField.Family: return EvalText(c, r.Family, st);
                case ClauseField.Type: return EvalText(c, r.Type, st);
                case ClauseField.Level: return EvalText(c, r.Level, st);
                case ClauseField.Parameter: return EvalParam(c, r.Param(c.Name, c.Scope), st);
                default:
                    st.Problem("танигдаагүй талбар");
                    return false;
            }
        }

        /* ------------------------------- TEXT ----------------------------- */

        internal static string Norm(string s, bool caseSensitive)
        {
            if (s == null) return "";
            string t = s.Trim();
            try { t = t.Normalize(NormalizationForm.FormC); } catch (ArgumentException) { }
            return caseSensitive ? t : t.ToUpperInvariant();
        }

        private static bool EvalText(QueryNode c, string actual, EvalStats st)
        {
            string a = Norm(actual, c.CaseSensitive);
            string v = Norm(c.Value, c.CaseSensitive);
            switch (c.Cmp)
            {
                case ClauseOp.Equals: return a == v;
                case ClauseOp.NotEquals: return a != v;
                case ClauseOp.Contains: return v.Length == 0 || a.IndexOf(v, StringComparison.Ordinal) >= 0;
                case ClauseOp.NotContains: return v.Length != 0 && a.IndexOf(v, StringComparison.Ordinal) < 0;
                case ClauseOp.StartsWith: return a.StartsWith(v, StringComparison.Ordinal);
                case ClauseOp.EndsWith: return a.EndsWith(v, StringComparison.Ordinal);
                case ClauseOp.Exists: return a.Length > 0;
                case ClauseOp.NotExists: return a.Length == 0;
                case ClauseOp.IsEmpty: return a.Length == 0;
                case ClauseOp.NotEmpty: return a.Length > 0;
                default:
                    st.Problem("текст талбарт тоон/танигдаагүй үйлдэл (" + c.Cmp + ")");
                    return false;
            }
        }

        /* ----------------------------- PARAMETER -------------------------- */

        private static bool EvalParam(QueryNode c, ParamValue p, EvalStats st)
        {
            switch (c.Cmp)
            {
                case ClauseOp.Exists: return p.Exists;
                case ClauseOp.NotExists: return !p.Exists;
                case ClauseOp.IsEmpty: return p.Exists && !p.HasValue;
                case ClauseOp.NotEmpty: return p.Exists && p.HasValue;
            }
            if (!p.Exists) return false;   // олдоогүй параметр харьцуулалтад таарахгүй (дээрх баримтжуулсан дүрэм)

            switch (c.Cmp)
            {
                case ClauseOp.Greater:
                case ClauseOp.GreaterOrEqual:
                case ClauseOp.Less:
                case ClauseOp.LessOrEqual:
                case ClauseOp.Between:
                    return EvalNumeric(c, p, st);

                case ClauseOp.Equals:
                case ClauseOp.NotEquals:
                    if (p.IsNumeric)
                    {
                        double parsed;
                        string suffix;
                        if (UnitCatalog.TryParseNumber(c.Value, out parsed, out suffix))
                        {
                            // Утга тоо — тоогоор (хүлцэлтэй) харьцуулна.  Нэгж таарахгүй бол Problem + false
                            // (чимээгүй текст харьцуулалт руу унахгүй).
                            double target;
                            if (!TryTarget(c.Value, c.Unit, p, st, true, out target)) return false;
                            bool eq = Close(p.Number, target);
                            return c.Cmp == ClauseOp.Equals ? eq : !eq;
                        }
                    }
                    break;
            }

            // Текстээр: параметрийн харагдах утга.
            return EvalText(c, p.HasValue ? p.Text : "", st);
        }

        private static bool EvalNumeric(QueryNode c, ParamValue p, EvalStats st)
        {
            if (!p.IsNumeric)
            {
                st.Problem("«" + c.Name + "» тоон параметр биш — тоон харьцуулалт хийгдсэнгүй");
                return false;
            }
            if (!p.HasValue) return false;

            double lo;
            if (!TryTarget(c.Value, c.Unit, p, st, true, out lo)) return false;

            switch (c.Cmp)
            {
                case ClauseOp.Greater: return p.Number > lo && !Close(p.Number, lo);
                case ClauseOp.GreaterOrEqual: return p.Number > lo || Close(p.Number, lo);
                case ClauseOp.Less: return p.Number < lo && !Close(p.Number, lo);
                case ClauseOp.LessOrEqual: return p.Number < lo || Close(p.Number, lo);
                case ClauseOp.Between:
                    double hi;
                    if (!TryTarget(c.Value2, c.Unit, p, st, true, out hi)) return false;
                    if (hi < lo) { double t = lo; lo = hi; hi = t; }
                    return (p.Number > lo || Close(p.Number, lo)) && (p.Number < hi || Close(p.Number, hi));
            }
            return false;
        }

        /// <summary>
        /// Хэрэглэгчийн утгыг (нэгжтэй) параметрийн КАНОНИК нэгжид хөрвүүлнэ.  Нэгж таарахгүй (мм-ийг
        /// талбайд) бол `Problem` + false — чимээгүй буруу харьцуулахгүй.
        /// </summary>
        private static bool TryTarget(string text, string unit, ParamValue p, EvalStats st, bool report, out double canonical)
        {
            canonical = 0;
            double v;
            string suffix;
            if (!UnitCatalog.TryParseNumber(text, out v, out suffix))
            {
                if (report) st.Problem("утга «" + text + "» тоо биш");
                return false;
            }
            string u = !string.IsNullOrWhiteSpace(unit) ? unit : suffix;
            if (string.IsNullOrWhiteSpace(u))
            {
                canonical = v;       // каноник нэгжээр гэж үзнэ
                return true;
            }
            if (UnitCatalog.CanonicalUnit(p.Family) == null)
            {
                // Нэгж-гүй (count/other) параметрт нэгж өгсөн — зөвхөн хоосон/«none» зөвшөөрнө.
                if (report) st.Problem("«" + u + "» нэгж энэ параметрт хамаарахгүй");
                return false;
            }
            if (!UnitCatalog.ToCanonical(v, u, p.Family, out canonical))
            {
                if (report) st.Problem("«" + u + "» нэгж " + p.Family + " параметртэй таарахгүй");
                return false;
            }
            return true;
        }

        private static bool Close(double a, double b)
        {
            return Math.Abs(a - b) <= AbsTol + RelTol * Math.Max(Math.Abs(a), Math.Abs(b));
        }
    }

    /* ====================================================================== */
    /*  БАТАЛГААЖУУЛАЛТ                                                        */
    /* ====================================================================== */

    public sealed class QueryIssue
    {
        public bool IsError { get; set; }
        public string Message { get; set; }
    }

    public static class QueryValidator
    {
        public const int MaxNodes = 200;

        public static List<QueryIssue> Validate(QueryDefinition def)
        {
            var issues = new List<QueryIssue>();
            if (def == null) { Add(issues, true, "Асуулга байхгүй."); return issues; }

            bool hasCategories = def.Categories != null && def.Categories.Any(c => !string.IsNullOrWhiteSpace(c));
            if (def.Scope == CountScope.WholeModel && !hasCategories)
                Add(issues, true, "Бүх загвараас тоолоход ядаж нэг ангилал сонгоно уу (бүх элементийг шалгах нь хэт удаан).");

            int nodes = 0;
            if (def.Where != null) ValidateNode(def.Where, issues, 0, ref nodes);
            if (nodes > MaxNodes) Add(issues, true, "Нөхцөл хэт олон (" + nodes + " > " + MaxNodes + ").");

            if (def.GroupBy != null)
            {
                foreach (GroupSpec g in def.GroupBy)
                {
                    if (g.Field == GroupField.Unknown) Add(issues, true, "Бүлэглэх талбар танигдсангүй.");
                    else if (g.Field == GroupField.Parameter && string.IsNullOrWhiteSpace(g.ParameterName))
                        Add(issues, true, "Параметрээр бүлэглэхэд параметрийн нэр хэрэгтэй.");
                }
                if (def.GroupBy.Count > 4) Add(issues, false, "4-өөс олон түвшинд бүлэглэх нь уншихад хэцүү.");
            }
            return issues;
        }

        public static bool IsRunnable(List<QueryIssue> issues)
        {
            return !issues.Any(i => i.IsError);
        }

        private static void Add(List<QueryIssue> l, bool error, string msg)
        {
            l.Add(new QueryIssue { IsError = error, Message = msg });
        }

        private static void ValidateNode(QueryNode n, List<QueryIssue> issues, int depth, ref int count)
        {
            count++;
            if (depth > 8) { Add(issues, true, "Нөхцөлийн бүлэг хэт гүн үүрлэсэн."); return; }

            if (n.IsGroup)
            {
                if (n.Op == LogicOp.Unknown) Add(issues, true, "Бүлгийн логик (AND/OR) танигдсангүй.");
                if (n.Op == LogicOp.Or && (n.Children == null || n.Children.Count == 0))
                    Add(issues, false, "Хоосон OR бүлэг юу ч таарахгүй.");
                if (n.Children != null) foreach (QueryNode k in n.Children) ValidateNode(k, issues, depth + 1, ref count);
                return;
            }

            if (!n.IsClause) { Add(issues, true, "Танигдаагүй нөхцөлийн төрөл «" + n.Kind + "»."); return; }

            if (n.Field == ClauseField.Unknown) Add(issues, true, "Нөхцөлийн талбар танигдсангүй.");
            if (n.Cmp == ClauseOp.Unknown) Add(issues, true, "Нөхцөлийн үйлдэл танигдсангүй.");
            if (n.Field == ClauseField.Parameter && string.IsNullOrWhiteSpace(n.Name)) Add(issues, true, "Параметрийн нэр хоосон байна.");

            switch (n.Cmp)
            {
                case ClauseOp.Greater:
                case ClauseOp.GreaterOrEqual:
                case ClauseOp.Less:
                case ClauseOp.LessOrEqual:
                case ClauseOp.Between:
                    CheckNumber(n, n.Value, issues);
                    if (n.Cmp == ClauseOp.Between) CheckNumber(n, n.Value2, issues);
                    if (n.Field != ClauseField.Parameter) Add(issues, true, "Тоон харьцуулалт зөвхөн параметрт хамаарна (" + (n.Name ?? n.Field.ToString()) + ").");
                    break;
                case ClauseOp.Contains:
                case ClauseOp.NotContains:
                case ClauseOp.StartsWith:
                case ClauseOp.EndsWith:
                    if (string.IsNullOrEmpty(n.Value)) Add(issues, true, "«" + Describe(n) + "» — утга хоосон байна.");
                    break;
            }

            if (!string.IsNullOrWhiteSpace(n.Unit))
            {
                UnitCatalog.UnitDef def;
                if (!UnitCatalog.TryGet(n.Unit, out def)) Add(issues, true, "Нэгж «" + n.Unit + "» танигдсангүй (mm, cm, m, m2, m3, deg...).");
            }
        }

        private static void CheckNumber(QueryNode n, string text, List<QueryIssue> issues)
        {
            double v;
            string suffix;
            if (!UnitCatalog.TryParseNumber(text, out v, out suffix))
                Add(issues, true, "«" + Describe(n) + "» — «" + text + "» тоо биш.");
            else if (!string.IsNullOrWhiteSpace(suffix) && string.IsNullOrWhiteSpace(n.Unit))
            {
                UnitCatalog.UnitDef def;
                if (!UnitCatalog.TryGet(suffix, out def)) Add(issues, true, "Утга дахь нэгж «" + suffix + "» танигдсангүй.");
            }
        }

        private static string Describe(QueryNode n)
        {
            return n.Field == ClauseField.Parameter ? (n.Name ?? "?") : n.Field.ToString();
        }
    }

    /* ====================================================================== */
    /*  ТӨЛӨВЛӨГӨӨ — Revit-ийн хурдан шүүлтүүрт юу түлхэж болох вэ              */
    /* ====================================================================== */

    public sealed class NumericBound
    {
        public string Name { get; set; }
        public double? Min { get; set; }
        public double? Max { get; set; }
        /// <summary>
        /// ДООД хязгаарын нэгж.  `QueryEvaluator`-тай ИЖИЛ дүрэм: нөхцөлд тодорхой нэгж (`Unit`) өгсөн бол тэр, үгүй бол ТЭР утга дахь дагавар (`3 m`), үгүй бол
        /// null (каноник нэгжээр гэж үзнэ).  Хязгаар бүр ӨӨРИЙН нэгжтэй байж болно (`Between 50 cm ... 1 m`).
        /// </summary>
        public string MinUnit { get; set; }
        /// <summary>ДЭЭД хязгаарын нэгж (`MinUnit`-ийн дүрэм).</summary>
        public string MaxUnit { get; set; }
    }

    public sealed class QueryPlan
    {
        public List<string> Categories { get; set; } = new List<string>();
        /// <summary>`Level = X` (AND-ийн дээд түвшинд) — `ElementLevelFilter`-д.</summary>
        public List<string> LevelEquals { get; set; } = new List<string>();
        /// <summary>Instance-scope тоон нөхцөл (AND-ийн дээд түвшинд) — `ElementParameterFilter`-д НАРИЙВЧЛАЛ болгон.</summary>
        public List<NumericBound> NumericBounds { get; set; } = new List<NumericBound>();
        /// <summary>Элемент бүрээс УНШИХ параметрийн нэр (нөхцөл + бүлэглэлт) — давхардалгүй.</summary>
        public List<string> ParamNames { get; set; } = new List<string>();
    }

    /// <summary>
    /// ЦЭВЭР төлөвлөгч.  Зөвхөн ГАДНА түвшний AND нөхцөлөөс (OR-ийн дотор биш) НАРИЙВЧЛАЛ гаргана:
    /// энэ нь «суперсет» — Revit-ийн шүүлтүүрээр бага элемент татаж, эцсийн шийдвэрийг `QueryEvaluator` хийнэ.
    /// OR-ийн дотор нөхцөлийг ХЭЗЭЭ Ч түлхэхгүй (шалгагдсан элементийг алдаж болно).
    /// </summary>
    public static class QueryPlanner
    {
        public static QueryPlan Plan(QueryDefinition def)
        {
            var plan = new QueryPlan();
            plan.Categories.AddRange((def.Categories ?? new List<string>()).Where(c => !string.IsNullOrWhiteSpace(c)).Select(c => c.Trim()).Distinct(StringComparer.OrdinalIgnoreCase));

            var names = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            if (def.Where != null) CollectNames(def.Where, names);
            foreach (GroupSpec g in def.GroupBy ?? new List<GroupSpec>())
                if (g.Field == GroupField.Parameter && !string.IsNullOrWhiteSpace(g.ParameterName)) names.Add(g.ParameterName.Trim());
            plan.ParamNames = names.OrderBy(n => n, StringComparer.OrdinalIgnoreCase).ToList();

            foreach (QueryNode c in Conjunctive(def.Where))
            {
                if (c.Field == ClauseField.Level && c.Cmp == ClauseOp.Equals && !string.IsNullOrWhiteSpace(c.Value))
                {
                    plan.LevelEquals.Add(c.Value.Trim());
                    continue;
                }

                if (c.Field == ClauseField.Parameter && c.Scope == ParamScope.Instance && !string.IsNullOrWhiteSpace(c.Name))
                {
                    var b = new NumericBound { Name = c.Name.Trim() };
                    double v, v2;
                    string s1, s2;
                    switch (c.Cmp)
                    {
                        case ClauseOp.Greater:
                        case ClauseOp.GreaterOrEqual:
                            if (!UnitCatalog.TryParseNumber(c.Value, out v, out s1)) continue;
                            b.Min = v; b.MinUnit = UnitOf(c.Unit, s1);
                            break;
                        case ClauseOp.Less:
                        case ClauseOp.LessOrEqual:
                            if (!UnitCatalog.TryParseNumber(c.Value, out v, out s1)) continue;
                            b.Max = v; b.MaxUnit = UnitOf(c.Unit, s1);
                            break;
                        case ClauseOp.Between:
                            if (!UnitCatalog.TryParseNumber(c.Value, out v, out s1) || !UnitCatalog.TryParseNumber(c.Value2, out v2, out s2)) continue;
                            // ⚠️ Хязгаар бүр ӨӨРИЙН нэгжтэй (`50 cm` ... `1 m`) ба min/max-ыг ЭНД СОЛИХГҮЙ: нэгжийг каноник руу хөрвүүлсний ДАРАА (тоон 50 > 1 боловч
                            // 50 cm < 1 m) сольж байж evaluator-ийн (`TryTarget` → сольж харьцуулах) дүгнэлттэй ижил болно.  Урьд нь сүүлийн дагаврыг хоёуланд нь
                            // хэрэглэж, нэгжээс өмнө сольдог байсан тул native шүүлтүүр таарах элементийг хасаж (суперсет БИШ) дутуу тоолдог байв.
                            b.Min = v; b.MinUnit = UnitOf(c.Unit, s1);
                            b.Max = v2; b.MaxUnit = UnitOf(c.Unit, s2);
                            break;
                        default:
                            continue;
                    }
                    plan.NumericBounds.Add(b);
                }
            }
            return plan;
        }

        /// <summary>
        /// Нэг утгын нэгж — `QueryEvaluator.TryTarget`-тай ИЖИЛ: тодорхой нэгж (хоосон/зайтай мөр БИШ) > утга дахь дагавар > null.
        /// (`c.Unit` хоосон мөр ("") байхад дагаврыг орхигдуулж ердийн `??` нь «m»-ийг алдаж байв.)
        /// </summary>
        internal static string UnitOf(string explicitUnit, string suffix)
        {
            return !string.IsNullOrWhiteSpace(explicitUnit) ? explicitUnit : (string.IsNullOrWhiteSpace(suffix) ? null : suffix);
        }

        /// <summary>Зөвхөн AND бүлгүүдээр (OR-гүйгээр) хүрч болох нөхцөлүүд.  Үндэс OR бол хоосон.</summary>
        internal static IEnumerable<QueryNode> Conjunctive(QueryNode root)
        {
            if (root == null) yield break;
            if (root.IsClause) { yield return root; yield break; }
            if (!root.IsGroup || root.Op != LogicOp.And) yield break;
            foreach (QueryNode k in root.Children ?? new List<QueryNode>())
                foreach (QueryNode c in Conjunctive(k)) yield return c;
        }

        private static void CollectNames(QueryNode n, HashSet<string> into)
        {
            if (n.IsClause && n.Field == ClauseField.Parameter && !string.IsNullOrWhiteSpace(n.Name)) into.Add(n.Name.Trim());
            if (n.Children != null) foreach (QueryNode k in n.Children) CollectNames(k, into);
        }
    }
}
