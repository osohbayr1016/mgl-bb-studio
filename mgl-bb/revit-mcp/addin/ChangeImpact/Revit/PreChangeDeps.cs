using System;
using System.Collections.Generic;
using System.Linq;
using Autodesk.Revit.DB;
using RevitMcpAddin.ChangeImpact.Core;

namespace RevitMcpAddin.ChangeImpact
{
    /// <summary>
    /// `ImpactGraph` (Change Impact-ийн ТЭР ИЖИЛ резольвер, итгэл A–D) → `PreChangeDependencies` (харагдац, хуудас, хүснэгт, tag, хэмжээс).
    /// Хоёр дахь граф БИЧЭЭГҮЙ.  Ямар ч зорилт «эвдэрсэн» гэж тэмдэглэгдэхгүй — зөвхөн ХЯНАХ (Review) хамаарал.
    /// </summary>
    internal static class PreChangeDeps
    {
        internal static PreChangeDependencies Build(ResolverHub hub, ImpactGraph graph, bool visibilityChecked)
        {
            var deps = new PreChangeDependencies { VisibilityChecked = visibilityChecked };
            int unknownTargets = 0;

            foreach (ImpactTarget t in graph.Targets.Values.OrderBy(x => ImpactConf.Rank(x.Confidence)).ThenBy(x => x.Depth))
            {
                ImpactNode n = hub.Node(t.Id);
                if (n.Unknown) { unknownTargets++; continue; }

                DepNode d = ToDep(n, t, hub);
                switch (n.Kind)
                {
                    case ImpactNodeKind.View:
                        if (n.Detail != null && n.Detail.StartsWith("View template", StringComparison.Ordinal)) continue;     // template өөрөө харагдац биш
                        var view = hub.Live(n.Id) as View;
                        if (view != null) d.ViewType = view.ViewType.ToString();
                        d.SheetIds = hub.SheetsOfView(n.Id).ToList();
                        deps.Views.Add(d);
                        break;
                    case ImpactNodeKind.Sheet:
                        var sheet = hub.Live(n.Id) as ViewSheet;
                        if (sheet != null) d.SheetNumber = sheet.SheetNumber;
                        deps.Sheets.Add(d);
                        break;
                    case ImpactNodeKind.Schedule:
                        d.SheetIds = hub.SheetsOfSchedule(n.Id).ToList();
                        deps.Schedules.Add(d);
                        break;
                    case ImpactNodeKind.Tag:
                        deps.Tags.Add(d);
                        break;
                    case ImpactNodeKind.Dimension:
                        deps.DimensionIds.Add(n.Id);
                        break;
                }
            }

            deps.Notes.AddRange(hub.Notes);
            deps.Notes.AddRange(graph.Notes);
            deps.IncompleteReasons = ImpactCompleteness.Reasons(new CompletenessInputs
            {
                GraphComplete = graph.Complete,
                GraphReasons = graph.IncompleteReasons,
                ResolverFailures = hub.ResolverFailures,
                ResolverTruncations = hub.Truncations,
                TruncationReasons = hub.TruncationReasons,
                UnknownTargets = unknownTargets,
                UnreadableLinks = hub.UnreadableLinks,
            });
            return deps;
        }

        private static DepNode ToDep(ImpactNode n, ImpactTarget t, ResolverHub hub)
        {
            // Хамгийн СУЛ холбоосын шалтгаан — ImpactExplainer-ийн «нийт итгэл = хамгийн сул холбоос» хэв маяг.
            ImpactEdge weakest = t.Path.Count == 0 ? null : t.Path.OrderByDescending(e => ImpactConf.Rank(e.Confidence)).First();
            return new DepNode
            {
                Id = n.Id,
                Uid = n.Uid,
                Name = !string.IsNullOrEmpty(n.Name) ? n.Name : n.Category,
                Detail = n.Detail,
                Kind = n.Kind,
                Confidence = t.Confidence,
                Reason = weakest != null ? weakest.Reason : null,
                PathCount = t.PathCount,
            };
        }

        /// <summary>Хөдөлсний ДАРАА шинээр харагдах харагдацыг (C, хэмжсэн) нэмнэ.</summary>
        internal static void AddNewlyVisible(PreChangeDependencies deps, ResolverHub hub, IEnumerable<long> viewIds)
        {
            foreach (long vid in viewIds)
            {
                if (deps.Views.Any(v => v.Id == vid)) continue;
                ImpactNode n = hub.Node(vid);
                if (n.Unknown) continue;
                var view = hub.Live(vid) as View;
                var d = new DepNode
                {
                    Id = n.Id, Uid = n.Uid, Name = !string.IsNullOrEmpty(n.Name) ? n.Name : n.Category, Detail = n.Detail, Kind = ImpactNodeKind.View,
                    Confidence = ImpactConfidence.C,
                    Reason = "Хана хөдөлсний ДАРАА энэ харагдацад харагдана (Revit-ийн харагдацын шүүлтүүрээр; crop/нуугдсан/хаагдсан байж болно).",
                    ViewType = view != null ? view.ViewType.ToString() : null,
                    SheetIds = hub.SheetsOfView(vid).ToList(),
                };
                deps.Views.Add(d);
                foreach (long sid in d.SheetIds)
                {
                    if (deps.Sheets.Any(s => s.Id == sid)) continue;
                    ImpactNode sn = hub.Node(sid);
                    if (sn.Unknown) continue;
                    var sh = hub.Live(sid) as ViewSheet;
                    deps.Sheets.Add(new DepNode
                    {
                        Id = sid, Uid = sn.Uid, Name = sn.Name, Kind = ImpactNodeKind.Sheet, Confidence = ImpactConfidence.C,
                        Reason = "«" + d.Name + "» харагдац энэ хуудсанд байрласан", SheetNumber = sh != null ? sh.SheetNumber : null,
                    });
                }
            }
        }
    }
}
