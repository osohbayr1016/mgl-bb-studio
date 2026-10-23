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

        /// <summary>
        /// Хөдөлгүүр шошгыг олонлогийн 0-р ширхэгт (…:2000000:SUBELEMENT) холбодог — ЖИШЭЭ 3-ын туслах дамнуурын харагдацад (гүн 148 мм) тэр
        /// ширхгийн шошго ХАРАГДДАГГҮЙ, зөвхөн дунд ширхгийнх харагддаг (инженер ч 2000001-д; ширхэг бүр геометрээрээ зурагддаг ч — хэмжсэн).
        /// Урьдчилан таах дүрэм олдоогүй тул туршина: харагдахгүй шошгыг дунд ширхэгт, тэр ч үгүй бол бусад ширхэгт дахин үүсгэнэ (байрлал,
        /// leader хэвээр); <c>r.Created</c>-ийг шинэчилнэ.  Харагдацын цуглуулга (view-ийг дахин тооцдог) — оролдлого бүрд НЭГ удаа.
        /// </summary>
        public static int RetargetHiddenBars(RfElevContext c, RfElevReport r)
        {
            Document doc = c.Doc;
            View view = c.View;
            var pending = new List<KeyValuePair<ElementId, int>>();   // шошго → дараагийн оролдлогын дугаар
            foreach (ElementId id in r.Created) if (doc.GetElement(id) is IndependentTag) pending.Add(new KeyValuePair<ElementId, int>(id, 0));
            if (pending.Count == 0) return 0;
            int n = 0;
            for (int round = 0; round < 4 && pending.Count > 0; round++)
            {
                doc.Regenerate();
                var visible = new HashSet<long>(new FilteredElementCollector(doc, view.Id).OfClass(typeof(IndependentTag)).ToElementIds().Select(x => x.Value));
                var next = new List<KeyValuePair<ElementId, int>>();
                foreach (var kv in pending)
                {
                    if (visible.Contains(kv.Key.Value) || !(doc.GetElement(kv.Key) is IndependentTag t)) continue;
                    Reference rf = t.GetTaggedReferences().FirstOrDefault();
                    if (rf == null || !(doc.GetElement(rf.ElementId) is Rebar rb)) continue;
                    string rep;
                    try { rep = rf.ConvertToStableRepresentation(doc); } catch { continue; }
                    var m = System.Text.RegularExpressions.Regex.Match(rep, @":(\d+):SUBELEMENT$");
                    if (!m.Success) continue;
                    int cur = int.Parse(m.Groups[1].Value) - 2000000, cnt = rb.NumberOfBarPositions;
                    // Оролдлогын дараалал: дунд, дараа нь бусад (одоогийнхоос бусад).
                    var order = new List<int> { (cnt - 1) / 2 };
                    for (int i = 0; i < cnt; i++) if (!order.Contains(i)) order.Add(i);
                    order.Remove(cur);
                    if (kv.Value >= order.Count) continue;
                    int vis = order[kv.Value];
                    try
                    {
                        Reference nr = Reference.ParseFromStableRepresentation(doc, rep.Substring(0, m.Index) + ":" + (2000000 + vis) + ":SUBELEMENT");
                        XYZ head = t.TagHeadPosition;
                        bool free = t.HasLeader && t.LeaderEndCondition == LeaderEndCondition.Free;
                        XYZ end = free ? t.GetLeaderEnd(rf) : null;
                        IndependentTag nt = IndependentTag.Create(doc, t.GetTypeId(), view.Id, nr, t.HasLeader, t.TagOrientation, head);
                        doc.Delete(t.Id);
                        // Create-ийн цэг leader-тэй үед толгой биш (ЖИШЭЭ 3: дээд шошго 200-ийн оронд 684-т) — дараа нь шууд онооно.
                        if (free) { nt.LeaderEndCondition = LeaderEndCondition.Free; nt.SetLeaderEnd(nr, end); }
                        nt.TagHeadPosition = head;
                        int k = r.Created.IndexOf(kv.Key);
                        if (k >= 0) r.Created[k] = nt.Id; else r.Created.Add(nt.Id);
                        next.Add(new KeyValuePair<ElementId, int>(nt.Id, kv.Value + 1));
                        n++;
                    }
                    catch { }
                }
                pending = next;
            }
            return n;
        }

        /// <summary>
        /// Дээд талын давхцлын эгнээ = дээд нүүрнээс <see cref="BbMemberStandard.ElevDimFirstPaperMm"/> (ДН-5: 9.5 мм).  Хөдөлгүүр давхцлыг шошгоны
        /// эгнээнээс БҮТЭН алхам гадна (18.5) тавьдаг — шошго ба давхцал хэвтээ чиглэлд давхцдаггүй тул инженер шошгоны дээр шууд тавьдаг.
        /// </summary>
        public static int TopLapRow(RfElevContext c, RfElevReport r, BbMemberStandard ms)
        {
            RfElevPlan plan = r?.Plan;
            if (plan == null || c.IsColumn || ms.ElevDimFirstPaperMm <= 0) return 0;
            List<RfElevLapPlan> laps = plan.Laps.Where(l => l.Side == RfElevSide.Top).ToList();
            if (laps.Count == 0) return 0;
            int scale = c.View.Scale > 0 ? c.View.Scale : 50;
            double want = c.Input.BeamV1 + RfTol.PaperMmToModelFt(ms.ElevDimFirstPaperMm, scale);
            double tol = BbGeom.Ft(5);
            var lines = laps.Select(l => l.LineV).Where(v => Math.Abs(v - want) > tol).Distinct().ToList();
            int n = 0;
            foreach (ElementId id in r.Created)
            {
                if (!(c.Doc.GetElement(id) is Dimension d) || d is SpotDimension || !(d.Curve is Line l)) continue;
                double v = c.Frame.ToView(RfConv.V(l.Origin)).Y;
                if (!lines.Any(x => Math.Abs(x - v) < tol)) continue;
                try { ElementTransformUtils.MoveElement(c.Doc, d.Id, c.Model(0, want) - c.Model(0, v)); n++; } catch { }
            }
            foreach (RfElevLapPlan lp in laps) lp.LineV = want;
            return n;
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
