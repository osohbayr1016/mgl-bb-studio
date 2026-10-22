using System;
using System.Collections.Generic;
using System.Linq;
using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Structure;
using MglBb.Core;
using RevitMcpAddin.Reinforcement;
using RevitMcpAddin.Reinforcement.Core;

namespace MglBb.RevitSide
{
    /// <summary>
    /// Дамнурууны дэлгээсийн инженерийн дүрэм (ЖИШЭЭ-2 ДДН-10-аас тайлангаар тодорхойлсон, 2026-10-21): давхцлын хэмжээс зөвхөн дээд үеийн арматурт,
    /// тэнхлэгийн гинжийн нийт урт байхгүй.  Хөдөлгүүр төлөвлөгөөгөө дотроо гаргаж шууд зурдаг тул ЗУРСНЫ ДАРАА (MRA дахин байрлуулахаас ӨМНӨ) илүүдлийг
    /// устгаж төлөвлөгөөнөөс хасна — MRA тэр эгнээг тооцохгүй.  <c>src/Engine</c>-ийг засахгүй.
    /// </summary>
    internal static class BbElevRules
    {
        /// <summary>Арматурын хамгийн урт ШУЛУУН хэсгийн дунд цэгийн өндөр (харагдацын u) — нугалсан арматурын bbox өндрөөр сунадаг.</summary>
        public static bool MainU(Rebar rb, BbFrame f, out double u)
        {
            u = 0;
            try
            {
                Line best = null;
                foreach (Curve c in rb.GetTransformedCenterlineCurves(false, true, true, MultiplanarOption.IncludeOnlyPlanarCurves, 0))
                    if (c is Line l && (best == null || l.Length > best.Length)) best = l;
                if (best == null) return false;
                u = f.Local(best.Evaluate(0.5, true)).Y;
                return true;
            }
            catch { return false; }
        }

        /// <summary>Арматурын үе (дээд / доод / бөөр) — гишүүний <paramref name="u0"/>…<paramref name="u1"/> өндрөөр.  Тодорхойлж чадахгүй бол null.</summary>
        public static BbBarRole? Layer(Rebar rb, BbFrame f, double u0, double u1)
        {
            if (rb == null || !MainU(rb, f, out double u)) return null;
            return BbTagRoles.Layer(u, u0, u1);
        }

        /// <summary>Хөдөлгүүрийн зурсан илүүдэл давхцал / нийт уртыг устгаж төлөвлөгөөнөөс хасна (Transaction дотор).  Хассан тоо.</summary>
        public static int Prune(RfElevContext c, RfElevReport r, BbMemberStandard ms)
        {
            RfElevPlan plan = r?.Plan;
            if (plan == null || c.IsColumn || (!ms.ElevLapsTopOnly && ms.ElevSpanTotal)) return 0;
            var dims = r.Created.Select(id => c.Doc.GetElement(id)).OfType<Dimension>().ToList();
            Func<Dimension, HashSet<long>> refs = d =>
            {
                var s = new HashSet<long>();
                try { foreach (Reference rf in d.References) s.Add(rf.ElementId.Value); } catch { }
                return s;
            };
            var gone = new List<ElementId>();
            int n = 0;
            if (ms.ElevLapsTopOnly && plan.Laps.Count > 0)
            {
                BoundingBoxXYZ hb = c.Host.get_BoundingBox(null);
                BbFrame f = BbFrame.Of(c.View);
                if (hb != null)
                {
                    f.Extent(hb, out XYZ a, out XYZ b);
                    Func<long, bool> top = id => c.Rebars.TryGetValue(id, out Rebar rb) && Layer(rb, f, a.Y, b.Y) == BbBarRole.Top;
                    foreach (RfElevLapPlan l in plan.Laps.ToList())
                    {
                        if (l.Side == RfElevSide.Top && top(l.BarA) && top(l.BarB)) continue;
                        foreach (Dimension d in dims)
                        {
                            HashSet<long> s = refs(d);
                            if (s.Contains(l.BarA) && s.Contains(l.BarB)) gone.Add(d.Id);
                        }
                        plan.Laps.Remove(l);
                        r.Laps = Math.Max(0, r.Laps - 1);
                        n++;
                    }
                }
            }
            if (!ms.ElevSpanTotal)
            {
                foreach (RfElevSpanPlan s in plan.Spans.Where(x => x.Overall).ToList())
                {
                    foreach (Dimension d in dims)
                    {
                        HashSet<long> ids = refs(d);
                        if (ids.Count == 2 && ids.All(id => c.Doc.GetElement(new ElementId(id)) is Grid)) gone.Add(d.Id);
                    }
                    plan.Spans.Remove(s);
                    r.Spans = Math.Max(0, r.Spans - 1);
                    n++;
                }
            }
            foreach (ElementId id in gone.Distinct())
            {
                try { c.Doc.Delete(id); } catch { }
                r.Created.Remove(id);
            }
            return n;
        }
    }
}
