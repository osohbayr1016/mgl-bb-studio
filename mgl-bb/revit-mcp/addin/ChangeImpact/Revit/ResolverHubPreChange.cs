using System;
using System.Collections.Generic;
using System.Linq;
using Autodesk.Revit.DB;
using RevitMcpAddin.ChangeImpact.Core;

namespace RevitMcpAddin.ChangeImpact
{
    /// <summary>
    /// «Өөрчлөхөөс өмнө шалгах»-д зориулсан `ResolverHub`-ийн НЭМЭЛТ гарц (хоёр дахь индекс БИЧЭЭГҮЙ — одоо байгаа
    /// viewport/харагдацын индексийг дахин ашиглана).
    /// </summary>
    internal sealed partial class ResolverHub
    {
        /// <summary>Хуудсанд байрласан МОДЕЛИЙН харагдацууд (план, зүсэлт, фасад, 3D, дэлгэрэнгүй) — хөдөлсний дараах харагдалтын нэр дэвшигч.</summary>
        internal IReadOnlyList<long> PlacedModelViews()
        {
            EnsureViewportIndex();
            var res = new List<long>();
            foreach (long vid in _viewportsByView.Keys)
            {
                var v = Live(vid) as View;
                if (v != null && IsModelView(v)) res.Add(vid);
            }
            return res;
        }

        /// <summary>Харагдацын ХУУДАС руу гарах холбоо (viewport) — хуудасны id-ууд.</summary>
        internal IReadOnlyList<long> SheetsOfView(long viewId)
        {
            EnsureViewportIndex();
            var res = new List<long>();
            List<long> vps;
            if (_viewportsByView.TryGetValue(viewId, out vps))
                foreach (long vp in vps)
                {
                    long sheet;
                    if (_viewportSheet.TryGetValue(vp, out sheet) && !res.Contains(sheet)) res.Add(sheet);
                }
            return res;
        }

        /// <summary>Хүснэгт хуудсанд байрласан хуудсууд (ScheduleSheetInstance → хуудас).</summary>
        internal IReadOnlyList<long> SheetsOfSchedule(long scheduleId)
        {
            EnsureViewportIndex();
            var res = new List<long>();
            List<long> inst;
            if (_scheduleInstances.TryGetValue(scheduleId, out inst))
                foreach (long i in inst)
                {
                    ImpactNode n = Node(i);
                    if (n.OwnerViewId > 0 && !res.Contains(n.OwnerViewId)) res.Add(n.OwnerViewId);
                }
            return res;
        }
    }
}
