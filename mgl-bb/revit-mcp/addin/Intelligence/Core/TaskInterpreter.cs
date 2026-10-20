using System;
using System.Collections.Generic;
using System.Text.RegularExpressions;
using RevitMcpAddin.Intelligence.Contracts;

namespace RevitMcpAddin.Intelligence.Core
{
    /// <summary>
    /// ДААЛГАВАР → TYPED BIM ХАЙЛТ (§30–32, R-9) — ДЕТЕРМИНИСТ, LLM-гүй.
    ///
    /// «3-р давхрын галын гарцын хаалгуудыг шалгах» →
    ///   levels ["3"], kinds [DOOR], intent "check", unresolved ["galin garc"]
    ///
    /// ⚠️ Гаралт нь ҮРГЭЛЖ `TASK_INTERPRETATION` — ТААМАГЛАЛ.  Бодит
    ///    элементийн гишүүнчлэл `TaskCandidateResolver`-оор ЗАГВАРААС ирнэ.
    /// ⚠️ `TextFold.Fold`-оор кирилл/латин/англи бүгд нэг хэлбэрт орно
    ///    («хаалга» = «haalga» = «halga»); залгамал дагаврыг УГТВАРААР барина
    ///    («хаалгануудыг» → «halganudig» нь «halga»-аар эхэлнэ).
    /// </summary>
    public static class TaskInterpreter
    {
        private sealed class Kw
        {
            public string Prefix;
            public SceneNodeKind Kind;
            /// <summary>true = ЯГ таарах ёстой (богино, хоёрдмол утгатай үг).</summary>
            public bool Exact;
            public Kw(string p, SceneNodeKind k, bool exact = false) { Prefix = p; Kind = k; Exact = exact; }
        }

        // Эвхсэн хэлбэрээр (TextFold.Fold).  Монгол · латин-монгол · англи.
        private static readonly Kw[] Kinds =
        {
            // «хана/хануудыг/ханын/ханыг» — эвхэлт давхар эгшгийг хураадаг тул ЯГ хэлбэрүүд.
            new Kw("hana", SceneNodeKind.WALL), new Kw("hanud", SceneNodeKind.WALL), new Kw("hanin", SceneNodeKind.WALL),
            new Kw("hanig", SceneNodeKind.WALL), new Kw("hanas", SceneNodeKind.WALL), new Kw("wal", SceneNodeKind.WALL),
            new Kw("halg", SceneNodeKind.DOOR), new Kw("dor", SceneNodeKind.DOOR),
            new Kw("conh", SceneNodeKind.WINDOW), new Kw("window", SceneNodeKind.WINDOW),
            new Kw("shal", SceneNodeKind.FLOOR), new Kw("flor", SceneNodeKind.FLOOR), new Kw("slab", SceneNodeKind.FLOOR),
            // «өрөө» → "oro" нь «орох/оролт»-той мөргөлддөг тул ЯГ таарах + залгаварт хэлбэрүүд.
            new Kw("oro", SceneNodeKind.ROOM, true), new Kw("oroni", SceneNodeKind.ROOM), new Kw("oronud", SceneNodeKind.ROOM),
            new Kw("orog", SceneNodeKind.ROOM), new Kw("orond", SceneNodeKind.ROOM), new Kw("oros", SceneNodeKind.ROOM),
            new Kw("rom", SceneNodeKind.ROOM, true), new Kw("roms", SceneNodeKind.ROOM, true), new Kw("tasalga", SceneNodeKind.ROOM),
            new Kw("shat", SceneNodeKind.STAIR), new Kw("stair", SceneNodeKind.STAIR),
            new Kw("bagana", SceneNodeKind.COLUMN), new Kw("column", SceneNodeKind.COLUMN),
            new Kw("dam", SceneNodeKind.BEAM, true), new Kw("beam", SceneNodeKind.BEAM),
            new Kw("dever", SceneNodeKind.ROOF), new Kw("rof", SceneNodeKind.ROOF),
            new Kw("taz", SceneNodeKind.CEILING), new Kw("ceiling", SceneNodeKind.CEILING),
            new Kw("davh", SceneNodeKind.LEVEL), new Kw("level", SceneNodeKind.LEVEL),
        };

        private static readonly string[] CheckVerbs = { "shalga", "check", "verifi", "review", "hiana", "hina" };
        private static readonly string[] DrawVerbs = { "zur", "draw", "model", "bairlul", "place", "tav" };
        private static readonly string[] FixVerbs = { "zas", "fix", "correct", "solih", "change" };
        private static readonly string[] AnnotateVerbs = { "hemjes", "dimension", "annotat", "tailbar", "tag" };

        private static readonly HashSet<string> Stop = new HashSet<string>(StringComparer.Ordinal)
        {
            "ba", "bolon", "and", "the", "of", "to", "for", "in", "on", "with", "iig", "ig", "iin", "in", "r", "ur",
            "deh", "dah", "deer", "der", "bugd", "buh", "all", "every", "shine", "new", "hoshin", "old",
        };

        private static readonly Regex LevelRx = new Regex(
            @"(?:(\d{1,2})\s*(?:r|dugar|dugaar|dugeer|deh|dah)?\s*davh)|(?:level\s*(\d{1,2}))|(?:\bl(\d{1,2})\b)|(?:davhar\s*(\d{1,2}))",
            RegexOptions.CultureInvariant);
        private static readonly Regex NumRx = new Regex(@"^\d+$", RegexOptions.CultureInvariant);

        public static RevitTaskInterpretation Interpret(int taskId, string title, string drawingName = null, string blockName = null)
        {
            var r = new RevitTaskInterpretation { TaskId = taskId };
            string folded = TextFold.Fold((title ?? "") + " " + (blockName ?? ""));
            if (folded.Length == 0)
            {
                r.Confidence = InterpretationConfidence.NONE;
                return r;
            }

            // Давхар
            foreach (Match m in LevelRx.Matches(folded))
            {
                for (int g = 1; g <= 4; g++)
                {
                    if (m.Groups[g].Success)
                    {
                        string n = m.Groups[g].Value.TrimStart('0');
                        if (n.Length == 0) n = "0";
                        if (!r.TargetLevels.Contains(n)) r.TargetLevels.Add(n);
                    }
                }
            }

            // Төрөл
            var kinds = new List<SceneNodeKind>();
            var tokens = folded.Split(new[] { ' ' }, StringSplitOptions.RemoveEmptyEntries);
            var matched = new HashSet<int>();
            for (int i = 0; i < tokens.Length; i++)
            {
                string t = tokens[i];
                // ⚠️ ҮЙЛ ҮГ ЭХЛЭЭД: «шалгах» → "shalgah" нь «шал» (FLOOR)-аар эхэлдэг.
                if (IsVerb(t)) { matched.Add(i); continue; }
                foreach (Kw k in Kinds)
                {
                    bool hit = k.Exact ? t == k.Prefix : t.StartsWith(k.Prefix, StringComparison.Ordinal);
                    if (hit)
                    {
                        if (k.Kind == SceneNodeKind.LEVEL) { matched.Add(i); break; }
                        if (!kinds.Contains(k.Kind)) kinds.Add(k.Kind);
                        matched.Add(i);
                        break;
                    }
                }
            }
            r.TargetKinds.AddRange(kinds);

            // Санаа
            r.Intent = "unknown";
            if (Has(tokens, CheckVerbs)) r.Intent = "check";
            else if (Has(tokens, DrawVerbs)) r.Intent = "draw";
            else if (Has(tokens, FixVerbs)) r.Intent = "fix";
            else if (Has(tokens, AnnotateVerbs)) r.Intent = "annotate";

            // Тайлагдаагүй үгс — «галын гарц» гэх мэт; ил харуулна, таамаглахгүй.
            for (int i = 0; i < tokens.Length; i++)
            {
                string t = tokens[i];
                if (matched.Contains(i) || Stop.Contains(t) || NumRx.IsMatch(t) || t.Length < 4) continue;
                if (IsVerb(t)) continue;
                if (r.UnresolvedTerms.Count < 8 && !r.UnresolvedTerms.Contains(t)) r.UnresolvedTerms.Add(t);
            }

            if (kinds.Count == 0) r.Confidence = InterpretationConfidence.NONE;
            else if (r.UnresolvedTerms.Count == 0 && r.Intent != "unknown") r.Confidence = InterpretationConfidence.HIGH;
            else if (r.UnresolvedTerms.Count <= 2) r.Confidence = InterpretationConfidence.MEDIUM;
            else r.Confidence = InterpretationConfidence.LOW;

            if (kinds.Count > 0)
            {
                r.Query = new ElementQuery();
                r.Query.Kinds.AddRange(kinds);
                r.Query.LevelNames.AddRange(r.TargetLevels);
            }
            return r;
        }

        private static bool Has(string[] tokens, string[] prefixes)
        {
            foreach (string t in tokens)
                foreach (string p in prefixes)
                    if (t.StartsWith(p, StringComparison.Ordinal)) return true;
            return false;
        }

        private static bool IsVerb(string t)
        {
            return Has(new[] { t }, CheckVerbs) || Has(new[] { t }, DrawVerbs)
                || Has(new[] { t }, FixVerbs) || Has(new[] { t }, AnnotateVerbs);
        }
    }

    /// <summary>
    /// Давхрын нэрийн таарц — «3», «Level 3», «3-р давхар», «03», «L3», «+3.000 (3F)».
    /// Тоон дугаар нь давхрын нэрэнд БИЕ ДААСАН тоо байх ёстой («13» нь «3» биш).
    /// </summary>
    public static class LevelMatcher
    {
        private static readonly Regex Nums = new Regex(@"\d+", RegexOptions.CultureInvariant);

        public static bool Matches(string levelName, string target)
        {
            if (string.IsNullOrWhiteSpace(levelName) || string.IsNullOrWhiteSpace(target)) return false;
            string ln = TextFold.Fold(levelName);
            string tg = TextFold.Fold(target);
            if (ln == tg) return true;
            if (Regex.IsMatch(tg, @"^\d+$"))
            {
                foreach (Match m in Nums.Matches(levelName))
                {
                    string n = m.Value.TrimStart('0');
                    if (n.Length == 0) n = "0";
                    if (n == tg) return true;
                }
                return false;
            }
            return ln.Contains(tg);
        }
    }

    /// <summary>Тайлал → графаас ЖИНХЭНЭ элементүүд.  Явц ХЭЗЭЭ Ч тооцохгүй (R-9).</summary>
    public static class TaskCandidateResolver
    {
        public const int MaxCandidates = 500;

        public static TaskCandidateSet Resolve(RevitTaskInterpretation interp, SceneGraphStore graph, ISet<long> reviewedIds = null, int issuesOpen = 0)
        {
            if (interp == null) throw new ArgumentNullException(nameof(interp));
            if (graph == null) throw new ArgumentNullException(nameof(graph));
            var set = new TaskCandidateSet { TaskId = interp.TaskId, SceneVersion = graph.Version, IssuesOpen = issuesOpen };
            if (interp.Query == null) return set;

            // Давхрын нэрийг графийн ЖИНХЭНЭ давхрын нэрээр солино.
            var q = new ElementQuery { Limit = MaxCandidates + 1, IncludeLinked = false };
            q.Kinds.AddRange(interp.Query.Kinds);
            if (interp.TargetLevels.Count > 0)
            {
                foreach (SceneNode lvl in graph.NodesOfKind(SceneNodeKind.LEVEL))
                {
                    foreach (string t in interp.TargetLevels)
                    {
                        if (LevelMatcher.Matches(lvl.Name, t)) { q.LevelIds.Add(lvl.ElementId); break; }
                    }
                }
                if (q.LevelIds.Count == 0)
                {
                    // Давхар олдсонгүй → хоосон буцаана, «бүх давхар» гэж ӨРГӨТГӨХГҮЙ.
                    set.Progress = "PROGRESS_ESTIMATE_UNAVAILABLE";
                    return set;
                }
            }
            if (interp.TargetElementIds.Count > 0) q.ElementIds.AddRange(interp.TargetElementIds);

            List<SceneNode> nodes = graph.Query(q);
            if (nodes.Count > MaxCandidates)
            {
                set.Truncated = true;
                nodes.RemoveRange(MaxCandidates, nodes.Count - MaxCandidates);
            }
            foreach (SceneNode n in nodes)
            {
                set.ElementIds.Add(n.ElementId);
                string k = n.Kind.ToString();
                int c;
                set.ByKind[k] = set.ByKind.TryGetValue(k, out c) ? c + 1 : 1;
                if (reviewedIds != null && reviewedIds.Contains(n.ElementId)) set.ReviewedIds.Add(n.ElementId);
            }
            set.Progress = "PROGRESS_ESTIMATE_UNAVAILABLE";
            return set;
        }
    }
}
