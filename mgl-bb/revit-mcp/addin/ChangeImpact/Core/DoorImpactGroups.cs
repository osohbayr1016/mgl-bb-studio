using System;
using System.Collections.Generic;
using System.Linq;

namespace RevitMcpAddin.ChangeImpact.Core
{
    /// <summary>
    /// Хаалга зөөхийн үр дагаврын ТАВАН бүлэг (хэрэглэгчид харагдах):
    ///   Critical      🔴 батлагдсан ноцтой (нүх давхцах, багана огтлолцох, хост алдах…)
    ///   Review        🟠 хянах (өрөө From/To, хуудас, хүснэгт, нэр дэвшигч…)
    ///   Changed       🟡 өөрчлөгдөнө (хэмжээсийн утга, орчны зай нэмэгдэх…) — тодорхой хэмжсэн, ноцтой биш
    ///   Safe          🟢 шалгагдсан, хэвийн
    ///   NotEvaluated  ⚪ тооцоолоогүй / бүрэн биш
    /// </summary>
    public enum ImpactGroup
    {
        Critical = 0,
        Review,
        Changed,
        Safe,
        NotEvaluated,
    }

    public sealed class ImpactEntry
    {
        public ImpactGroup Group { get; set; }
        public string Code { get; set; }
        public PreChangeCategory Category { get; set; }
        public ItemSeverity Severity { get; set; }
        public TruthState Truth { get; set; }
        public string Title { get; set; }
        public string Detail { get; set; }
        public string Subject { get; set; }
        public string Before { get; set; }
        public string After { get; set; }
        public string Delta { get; set; }
        public long Id { get; set; }
        public ImpactNodeKind Kind { get; set; }
        public string ItemKey { get; set; }
        /// <summary>Дэлгэцийн тодруулгад (`ObstacleBox.Key`).  null = хайрцаггүй.</summary>
        public string TargetKey { get; set; }
        /// <summary>true = урьдчилсан (fast scan) — sandbox-оор батлагдаагүй.</summary>
        public bool Predictive { get; set; }
        public bool CanShow { get { return Id > 0 && Kind != ImpactNodeKind.Global; } }
    }

    /// <summary>
    /// `PreChangeReport` (эсвэл түр fast scan) → таван бүлэгт ангилсан мөрүүд.  ЦЭВЭР, тодорхойлогдсон.
    /// Нормын мөр (`NormNe`) ЭНД ОРОХГҮЙ — тусдаа «Монгол норм» мөрөнд.
    /// </summary>
    public static class DoorImpactGroups
    {
        public static ImpactGroup? GroupOf(PreChangeItem i)
        {
            if (i == null || i.Code == ItemCodes.NormNe) return null;
            TruthState t = Truth.Normalize(i.Truth);
            if (t == TruthState.NotEvaluated || t == TruthState.Incomplete) return ImpactGroup.NotEvaluated;
            if (t == TruthState.Confirmed)
            {
                switch (i.Severity)
                {
                    case ItemSeverity.Critical: return ImpactGroup.Critical;
                    case ItemSeverity.Warning: return ImpactGroup.Review;
                    case ItemSeverity.Notice: return ImpactGroup.Changed;
                    default: return ImpactGroup.Safe;
                }
            }
            // Review (батлагдаагүй хамаарал)
            return i.Severity >= ItemSeverity.Notice ? ImpactGroup.Review : ImpactGroup.Safe;
        }

        /// <summary>Тайлангийн мөрүүд → бүлэгтэй жагсаалт.  Тайлан дутуу бол `fast`-аас ЗӨВХӨН урьдчилсан мөрүүд.</summary>
        public static List<ImpactEntry> Build(PreChangeReport report, DoorFastResult fast)
        {
            var list = new List<ImpactEntry>();
            if (report != null)
            {
                foreach (PreChangeItem i in report.Items)
                {
                    ImpactGroup? g = GroupOf(i);
                    if (!g.HasValue) continue;
                    list.Add(new ImpactEntry
                    {
                        Group = g.Value, Code = i.Code, Category = i.Category, Severity = i.Severity, Truth = i.Truth, Title = i.Title, Detail = i.Why, Subject = i.Subject,
                        Before = i.Before, After = i.After, Delta = i.Delta, Id = i.Id, Kind = i.Kind, ItemKey = i.Key, TargetKey = i.TargetKey,
                    });
                }
                // Шалгалт бүрэн биш — «ДҮГНЭХ БОЛОМЖГҮЙ»-н шалтгаан ил харагдана (чимээгүй алгасахгүй).
                foreach (string reason in report.RequiredIncomplete.Concat(report.AdvisoryIncomplete))
                    list.Add(new ImpactEntry { Group = ImpactGroup.NotEvaluated, Code = "incomplete", Category = PreChangeCategory.Model, Severity = ItemSeverity.Ok, Truth = TruthState.Incomplete, Title = "Бүрэн биш: " + reason });
            }
            else if (fast != null)
            {
                foreach (FastFinding f in fast.Findings)
                {
                    ImpactGroup g = f.Severity == ItemSeverity.Critical ? ImpactGroup.Critical
                        : f.Severity >= ItemSeverity.Notice ? ImpactGroup.Review
                        : ImpactGroup.Safe;
                    list.Add(new ImpactEntry
                    {
                        Group = g, Code = "fast." + f.Kind, Category = f.Kind == FastFindingKind.FinalCandidate || f.Kind == FastFindingKind.PathCandidate ? PreChangeCategory.Obstacle : PreChangeCategory.Opening,
                        Severity = f.Severity, Truth = f.Truth, Title = f.Text, Subject = f.Label, Id = f.Id, Kind = ImpactNodeKind.Element,
                        TargetKey = f.Id > 0 ? f.LinkInstanceId + ":" + f.Id : null, Predictive = true,
                    });
                }
            }
            return list
                .OrderBy(e => (int)e.Group)
                .ThenByDescending(e => (int)e.Severity)
                .ThenBy(e => e.Title ?? "", StringComparer.CurrentCultureIgnoreCase)
                .ToList();
        }

        public static int Count(IEnumerable<ImpactEntry> entries, ImpactGroup g)
        {
            return entries == null ? 0 : entries.Count(e => e.Group == g);
        }
    }
}
