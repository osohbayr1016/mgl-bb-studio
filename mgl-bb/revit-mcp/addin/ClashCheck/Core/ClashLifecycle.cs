using System;
using System.Collections.Generic;
using System.Linq;
using RevitMcpAddin.Smart.Core;

namespace RevitMcpAddin.ClashCheck.Core
{
    /// <summary>Илэрсэн clash (Revit-ийн шалгалтын ДҮН) — lifecycle-д орох оролт.</summary>
    public sealed class DetectedClash
    {
        public string Fingerprint { get; set; }
        public ClashElementInfo A { get; set; }
        public ClashElementInfo B { get; set; }
        public double VolumeCm3 { get; set; }
        public double[] Point { get; set; }
        public double[] Box { get; set; }
        public string Level { get; set; }
    }

    /// <summary>Өмнө нь илэрсэн, энэ удаа ИЛЭРЭЭГҮЙ хосын байдал — ЗӨВХӨН нотолгоотой үед «шийдэгдсэн».</summary>
    public enum PairState
    {
        /// <summary>Нотолгоо алга (оролцсонгүй, дэмжигдээгүй, алдаа) — Resolved БОЛГОХГҮЙ.</summary>
        NotEvaluated = 0,
        /// <summary>Элемент загвараас УСТСАН.</summary>
        ElementMissing,
        /// <summary>Хоёулаа байгаа, bbox давхцахаа больсон (зөөгдсөн) — бодитоор холдсон.</summary>
        NoLongerOverlapping,
        /// <summary>Геометрийн шалгалт «clash байхгүй» гэж ЯГ баталсан.</summary>
        NoClash,
        /// <summary>Шалгалт дэмжигдээгүй/алдаатай — баталгаажаагүй.</summary>
        Unverified,
        /// <summary>
        /// Хос нь одоо ЗОРИУДЫН давхцал (Join Geometry / hosted / MEP холбогдсон) — дүрмийн өөрийн тодорхойлолтоор
        /// clash БИШ.  (Дүрмийн тохиргоо өөрчлөгдөөгүй — өөрчлөгдсөн бол хэш өөр, энэ issue оролцохгүй.)
        /// </summary>
        IgnoredByDesign,
    }

    public sealed class ReconcileInput
    {
        public string RuleId { get; set; }
        public string RuleName { get; set; }
        public string RuleHash { get; set; }
        public ClashSeverity Severity { get; set; }
        public IReadOnlyList<DetectedClash> Detected { get; set; } = new DetectedClash[0];
        /// <summary>
        /// Гүйлт БҮРЭН дууссан (цуцлагдаагүй, бүх нэр дэвшигч шалгагдсан).  false үед ХЭЗЭЭ Ч «Resolved»
        /// болгохгүй — шалгаагүй хэсэгт clash байж болно.
        /// </summary>
        public bool RunComplete { get; set; }
        /// <summary>Өмнөх идэвхтэй issue (энэ дүрмийн, энэ хэштэй)-ийн энэ удаагийн байдал.  Байхгүй = NotEvaluated.</summary>
        public Func<ClashIssue, PairState> StateOf { get; set; }
    }

    public sealed class ReconcileResult
    {
        public List<ClashIssue> Issues { get; set; } = new List<ClashIssue>();
        public int New { get; set; }
        public int Updated { get; set; }
        public int Resolved { get; set; }
        public int Reappeared { get; set; }
        public int Unverified { get; set; }
    }

    /// <summary>
    /// Clash-ийн ХАРИУЦЛАГАТАЙ lifecycle (ЦЭВЭР, тестлэгдсэн):
    ///
    ///   • fingerprint байгаа           → төлөв ХЭВЭЭР (Accepted нэг ч удаа дахин «New» болохгүй), `LastSeen` шинэчлэгдэнэ
    ///   • шинэ fingerprint             → `New`
    ///   • өмнө идэвхтэй, одоо алга     → ЗӨВХӨН нотолгоотой үед `Resolved` (устсан / холдсон / «clash биш» гэж батлагдсан);
    ///                                    бусад үед төлөв хэвээр + `Unverified` тэмдэг («шийдэгдсэн» гэж ХУУЛАХГҮЙ)
    ///   • `Resolved` байсан, дахин илэрсэн → `New` (reappeared) + түүхэнд тэмдэглэл
    ///   • дүрмийн ТОХИРГОО (hash) өөр issue → ХӨНДӨХГҮЙ (түүхэнд, одоогийн дүрмийн дүн БИШ)
    ///   • гүйлт бүрэн БИШ (цуцлагдсан) → юуг ч Resolved болгохгүй
    /// </summary>
    public static class ClashReconciler
    {
        public static ReconcileResult Reconcile(IReadOnlyList<ClashIssue> previous, ReconcileInput input, DateTime now)
        {
            var res = new ReconcileResult();
            res.Issues = previous.ToList();

            var current = new Dictionary<string, ClashIssue>(StringComparer.Ordinal);
            foreach (ClashIssue p in previous)
                if (p.RuleId == input.RuleId && p.RuleHash == input.RuleHash && !string.IsNullOrEmpty(p.Fingerprint))
                    current[p.Fingerprint] = p;

            var seen = new HashSet<string>(StringComparer.Ordinal);
            foreach (DetectedClash d in input.Detected)
            {
                if (!seen.Add(d.Fingerprint)) continue;       // ижил хос давхар илэрсэн (A/B хоёр жагсаалтад) — нэг л issue

                ClashIssue p;
                if (current.TryGetValue(d.Fingerprint, out p))
                {
                    if (p.Status == ClashStatus.Resolved)
                    {
                        Transition(p, ClashStatus.New, "reappeared", "Шийдэгдсэн байсан clash дахин илэрлээ.", now);
                        p.ResolvedUtc = null;
                        res.Reappeared++;
                    }
                    else if (p.Status == ClashStatus.Unknown)
                    {
                        p.Status = ClashStatus.New;
                    }
                    p.LastSeenUtc = now;
                    p.TimesSeen++;
                    p.Unverified = false;
                    Apply(p, d, input);
                    res.Updated++;
                }
                else
                {
                    var n = new ClashIssue
                    {
                        Fingerprint = d.Fingerprint,
                        RuleId = input.RuleId,
                        RuleHash = input.RuleHash,
                        Status = ClashStatus.New,
                        FirstSeenUtc = now,
                        LastSeenUtc = now,
                        TimesSeen = 1,
                    };
                    Apply(n, d, input);
                    n.History.Add(new ClashHistoryEntry { Utc = now, From = ClashStatus.Unknown, To = ClashStatus.New, Reason = "detected" });
                    res.Issues.Add(n);
                    res.New++;
                }
            }

            if (input.RunComplete)
            {
                foreach (ClashIssue p in current.Values)
                {
                    if (seen.Contains(p.Fingerprint) || p.Status == ClashStatus.Resolved) continue;

                    PairState state = input.StateOf != null ? input.StateOf(p) : PairState.NotEvaluated;
                    switch (state)
                    {
                        case PairState.ElementMissing:
                            Resolve(p, "deleted", "Элемент загвараас устсан.", now);
                            res.Resolved++;
                            break;
                        case PairState.NoLongerOverlapping:
                            Resolve(p, "moved_apart", "Элементүүд холдсон (давхцахаа больсон).", now);
                            res.Resolved++;
                            break;
                        case PairState.NoClash:
                            Resolve(p, "rerun", "Дахин шалгахад clash илрээгүй.", now);
                            res.Resolved++;
                            break;
                        case PairState.IgnoredByDesign:
                            Resolve(p, "ignored_by_design", "Зориудын давхцал болсон (join / hosted / холбогдсон MEP).", now);
                            res.Resolved++;
                            break;
                        default:
                            // Нотолгоо алга — «шийдэгдсэн» гэж ХУУЛАХГҮЙ.
                            p.Unverified = true;
                            res.Unverified++;
                            break;
                    }
                }
            }
            return res;
        }

        private static void Apply(ClashIssue i, DetectedClash d, ReconcileInput input)
        {
            i.RuleName = input.RuleName;
            i.Severity = input.Severity;
            i.A = d.A ?? i.A;
            i.B = d.B ?? i.B;
            i.VolumeCm3 = d.VolumeCm3;
            i.Point = d.Point;
            i.Box = d.Box;
            i.Level = d.Level;
        }

        private static void Resolve(ClashIssue p, string reason, string note, DateTime now)
        {
            Transition(p, ClashStatus.Resolved, reason, note, now);
            p.ResolvedUtc = now;
            p.Unverified = false;
        }

        private static void Transition(ClashIssue p, ClashStatus to, string reason, string note, DateTime now)
        {
            p.History.Add(new ClashHistoryEntry { Utc = now, From = p.Status, To = to, Reason = reason, Note = note });
            p.Status = to;
        }

        /* ======================= ХЭРЭГЛЭГЧИЙН ТӨЛӨВ ======================== */

        /// <summary>
        /// Хэрэглэгч төлөв солино.  ⚠️ `Resolved`-г ГАРААР тавихгүй (зөвхөн дахин шалгалтын нотолгоотой систем);
        /// `Resolved` issue-г гараар сэргээхгүй (clash дахин илэрвэл систем өөрөө `New` болгоно).
        /// </summary>
        public static bool TrySetStatus(ClashIssue issue, ClashStatus to, string note, DateTime now, out string error)
        {
            error = null;
            if (to == ClashStatus.Resolved || to == ClashStatus.Unknown)
            {
                error = "«Шийдэгдсэн» төлөвийг зөвхөн дахин шалгалт баталгаажуулна.";
                return false;
            }
            if (issue.Status == ClashStatus.Resolved)
            {
                error = "Шийдэгдсэн clash-ийн төлөвийг гараар өөрчлөхгүй — дахин илэрвэл автоматаар «Шинэ» болно.";
                return false;
            }
            if (issue.Status == to && string.IsNullOrWhiteSpace(note)) return true;

            issue.History.Add(new ClashHistoryEntry { Utc = now, From = issue.Status, To = to, Reason = "user", Note = string.IsNullOrWhiteSpace(note) ? null : note.Trim() });
            issue.Status = to;
            if (!string.IsNullOrWhiteSpace(note)) issue.Note = note.Trim();
            return true;
        }

        /// <summary>Ачаалсан файлын мөрүүдийг засна: танигдаагүй төлөв → `New`; null талбарууд.</summary>
        public static void Normalize(ClashIssue i)
        {
            if (i.Status == ClashStatus.Unknown) i.Status = ClashStatus.New;
            if (i.A == null) i.A = new ClashElementInfo();
            if (i.B == null) i.B = new ClashElementInfo();
            if (i.History == null) i.History = new List<ClashHistoryEntry>();
        }
    }

    /// <summary>Хоёр баримт (host) тус бүрийн clash төлөв хадгалалт — `DocStore`-ийн гэрээг дагана.</summary>
    public static class ClashStateStore
    {
        public const int Schema = 1;
        public const int MaxIssues = 50000;
        public const int MaxRuns = 60;

        private static readonly DocStore<ClashState> Store =
            new DocStore<ClashState>("clash-state.json", Schema, () => new ClashState(), indented: false);

        public static ClashState Load(DocumentKey key)
        {
            ClashState s = Store.Load(key).Value ?? new ClashState();
            if (s.Issues == null) s.Issues = new List<ClashIssue>();
            if (s.Runs == null) s.Runs = new List<ClashRunRecord>();
            foreach (ClashIssue i in s.Issues) ClashReconciler.Normalize(i);
            return s;
        }

        public static bool Save(DocumentKey key, ClashState s, out string error)
        {
            Trim(s);
            return Store.Save(key, s, out error);
        }

        private static readonly object Gate = new object();

        /// <summary>
        /// Хадгалсан төлөвийг ШИНЭЭР уншиж, өөрчилж, хадгална — НЭГ түгжээнд.  Шалгалтын дүн (Revit-ийн thread)
        /// ба хэрэглэгчийн төлөв солилт (UI thread) нэг файлыг зэрэг «уншаад-бичих» үед нэг нь нөгөөгийнхөө
        /// өөрчлөлтийг дарж бичихээс сэргийлнэ.  ⚠️ `mutate` дотор удаан ажил хийхгүй (түгжээ барьж байна).
        /// </summary>
        public static bool Update(DocumentKey key, Action<ClashState> mutate, out string error)
        {
            lock (Gate)
            {
                ClashState s = Load(key);
                mutate(s);
                return Save(key, s, out error);
            }
        }

        /// <summary>Хэт олон issue болвол ХАМГИЙН ХУУЧИН «Resolved»-уудыг хасна; идэвхтэй/зөвшөөрсөн ХЭЗЭЭ Ч хасагдахгүй.</summary>
        public static void Trim(ClashState s)
        {
            if (s.Runs.Count > MaxRuns) s.Runs = s.Runs.OrderByDescending(r => r.StartedUtc).Take(MaxRuns).ToList();
            if (s.Issues.Count <= MaxIssues) return;
            int excess = s.Issues.Count - MaxIssues;
            var drop = new HashSet<ClashIssue>(
                s.Issues.Where(i => i.Status == ClashStatus.Resolved).OrderBy(i => i.ResolvedUtc ?? i.LastSeenUtc).Take(excess));
            s.Issues.RemoveAll(i => drop.Contains(i));            // O(n) — `Remove` давталт нь O(n·k) байв
        }
    }
}
