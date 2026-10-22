using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text;
using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Structure;
using MglBb.Core;

namespace MglBb.RevitSide
{
    /// <summary>
    /// «Стандарт сурах» (заасан горим): дамнурууны ДЭЛГЭЭСИЙН хэмжээс, MRA, шошгыг бүрэн хэмжиж тайлан болгоно — инженерийн зургийн дүрмийг (хомутын
    /// алхам, хомутыг баганын ирмэгээс, дээд үеийн гинж, шошгоны байрлал) тодорхойлж сурагч/тавигчийг бичихэд.  Загварт юу ч бичихгүй.
    /// Координат: харагдацын хүрээ r (баруун), u (дээш) — загварын мм; «p» = цаасан мм (/ масштаб).  u-г дамнурууны ДЭЭД нүүрнээс (uT) хэмжинэ.
    /// </summary>
    internal static class BbElevDump
    {
        public static void Beam(Document doc, BbViewSample v, StringBuilder sb)
        {
            View view = v.View;
            BbFrame f = v.Frame;
            double sc = Math.Max(1, view.Scale);
            Func<double, string> mm = ft => BbGeom.ToMm(ft).ToString("0", CultureInfo.InvariantCulture);
            Func<double, string> pp = ft => (BbGeom.ToMm(ft) / sc).ToString("0.0", CultureInfo.InvariantCulture);
            sb.AppendLine("==== VIEW «" + view.Name + "» id " + view.Id.Value + " 1:" + sc + " mark " + v.Mark + " kind " + v.Kind);

            BbBeamChain chain = v.Host == null ? null : BbGeom.BeamChain(doc, v.Host);
            if (chain == null) { sb.AppendLine("  no beam chain"); return; }
            var hosts = new HashSet<long>(chain.Members.Select(m => m.Id.Value));
            double uB = double.MaxValue, uT = double.MinValue;
            foreach (FamilyInstance m in chain.Members)
            {
                BoundingBoxXYZ bb = m.get_BoundingBox(null);
                if (bb == null) continue;
                f.Extent(bb, out XYZ a, out XYZ b);
                uB = Math.Min(uB, a.Y); uT = Math.Max(uT, b.Y);
                sb.AppendLine("  member " + m.Id.Value + " r " + mm(a.X) + ".." + mm(b.X) + " u " + mm(a.Y - uT) + ".." + mm(b.Y - uT));
            }
            Func<double, string> U = u => mm(u - uT) + " (top " + pp(u - uT) + "p, bot " + pp(u - uB) + "p)";
            sb.AppendLine("  beam depth " + mm(uT - uB) + "  (u below = from TOP face)");
            foreach (BbSpan s in chain.Supports)
            {
                double ra = f.Local(chain.Origin + chain.Axis * BbGeom.Ft(s.A)).X, rb = f.Local(chain.Origin + chain.Axis * BbGeom.Ft(s.B)).X;
                sb.AppendLine("  support faces r " + mm(Math.Min(ra, rb)) + " | " + mm(Math.Max(ra, rb)));
            }

            // Харагдах арматур (гинжийн гишүүдийнх).
            var bars = new Dictionary<long, string>();
            foreach (Rebar r in new FilteredElementCollector(doc, view.Id).OfClass(typeof(Rebar)).Cast<Rebar>())
            {
                bool mine;
                try { mine = hosts.Contains(r.GetHostId().Value); } catch { mine = false; }
                if (!mine) continue;
                bool stirrup = false;
                try { stirrup = (doc.GetElement(r.GetShapeId()) as RebarShape)?.RebarStyle == RebarStyle.StirrupTie; } catch { }
                string dia = "";
                try { dia = BbGeom.ToMm(r.GetBendData().BarModelDiameter).ToString("0"); } catch { }
                string num = "";
                try { num = r.get_Parameter(BuiltInParameter.REBAR_NUMBER)?.AsString() ?? ""; } catch { }
                BoundingBoxXYZ bb = r.get_BoundingBox(null);
                string ext = "";
                if (bb != null) { f.Extent(bb, out XYZ a, out XYZ b); ext = " r " + mm(a.X) + ".." + mm(b.X) + " u " + mm(a.Y - uT) + ".." + mm(b.Y - uT); }
                string spacing = "";
                try { if (r.LayoutRule != RebarLayoutRule.Single) spacing = " n " + r.NumberOfBarPositions + " s " + BbGeom.ToMm(r.MaxSpacing).ToString("0"); } catch { }
                string tag = (stirrup ? "STIRRUP" : "BAR") + " #" + num + " d" + dia;
                bars[r.Id.Value] = tag;
                sb.AppendLine("  rebar " + r.Id.Value + " " + tag + spacing + ext);
            }

            var mraDims = new HashSet<long>();
            var mraTags = new HashSet<long>();
            foreach (MultiReferenceAnnotation m in new FilteredElementCollector(doc, view.Id).OfClass(typeof(MultiReferenceAnnotation)).Cast<MultiReferenceAnnotation>())
            {
                if (m.OwnerViewId != view.Id) continue;
                mraDims.Add(m.DimensionId.Value); mraTags.Add(m.TagId.Value);
                var d = doc.GetElement(m.DimensionId) as Dimension;
                var t = doc.GetElement(m.TagId) as IndependentTag;
                string line = d == null ? "" : DimText(d, f, mm, pp, U, bars, doc);
                string head = "";
                try { if (t != null) { XYZ h = f.Local(t.TagHeadPosition); head = " tag head r " + mm(h.X) + " u " + U(h.Y); } } catch { }
                sb.AppendLine("  MRA " + m.Id.Value + " «" + doc.GetElement(m.GetTypeId())?.Name + "»" + head + " | " + line);
            }
            foreach (Dimension d in new FilteredElementCollector(doc, view.Id).OfClass(typeof(Dimension)).Cast<Dimension>())
            {
                if (d.OwnerViewId != view.Id || mraDims.Contains(d.Id.Value)) continue;
                sb.AppendLine("  DIM " + d.Id.Value + " «" + d.DimensionType?.Name + "» " + DimText(d, f, mm, pp, U, bars, doc));
            }
            EndSymbols(doc, v, f, bars, mm, U, sb);
            foreach (IndependentTag t in new FilteredElementCollector(doc, view.Id).OfClass(typeof(IndependentTag)).Cast<IndependentTag>())
            {
                if (t.OwnerViewId != view.Id || mraTags.Contains(t.Id.Value)) continue;
                string tagged = "";
                try { tagged = string.Join(",", t.GetTaggedLocalElementIds().Select(id => id.Value + (bars.TryGetValue(id.Value, out string b) ? "[" + b + "]" : ""))); } catch { }
                string head = "", lead = "";
                try { XYZ h = f.Local(t.TagHeadPosition); head = "head r " + mm(h.X) + " u " + U(h.Y); } catch { }
                try { BoundingBoxXYZ tb = t.get_BoundingBox(view); if (tb != null) { f.Extent(tb, out XYZ ta, out XYZ tz); head += " text r " + mm(ta.X) + ".." + mm(tz.X); } } catch { }
                // Сурагчийн хэмжилт (3→2 / 2→1 цаасан мм) — сурах үнэн хэрэгтээ юу авч байгааг харуулна.
                List<double[]> lr = BbLearner.ElevLeader(t, view, f, Math.Max(1, view.Scale), out string why);
                head += " learn " + (lr.Count == 0 ? "— " + why : string.Join(" ", lr.Select(x => x[0].ToString("0.0") + "/" + x[1].ToString("0.0"))));
                try
                {
                    if (t.HasLeader)
                        foreach (Reference rf in t.GetTaggedReferences())
                        {
                            string e = "", el = "";
                            try { if (t.LeaderEndCondition == LeaderEndCondition.Free) { XYZ p = f.Local(t.GetLeaderEnd(rf)); e = " end r " + mm(p.X) + " u " + U(p.Y); } } catch { }
                            try { if (t.HasLeaderElbow(rf)) { XYZ p = f.Local(t.GetLeaderElbow(rf)); el = " elbow r " + mm(p.X) + " u " + U(p.Y); } } catch { }
                            lead += " [" + el + e + " ]";
                        }
                }
                catch { }
                sb.AppendLine("  TAG " + t.Id.Value + " «" + doc.GetElement(t.GetTypeId())?.Name + "» " + head + " leader " + t.HasLeader + lead + " → " + tagged
                              + " txt «" + (t.TagText ?? "").Replace('\n', ' ').Replace('\r', ' ') + "»");
            }
        }

        /// <summary>
        /// Арматурын төгсгөлийн тэмдэг: (1) үндсэн plugin-ий «Төгсгөлийн тэмдэг» хэрэгслийн тавьсан (Extensible Storage-тай — арматур, эхлэл/төгсгөл,
        /// ширхэг, тэмдэг, эргэлт, оффсет); (2) бусад detail family (гараар) — байрлал, эргэлт, хамгийн ойр арматурын үзүүр.
        /// </summary>
        private static void EndSymbols(Document doc, BbViewSample v, BbFrame f, Dictionary<long, string> bars, Func<double, string> mm, Func<double, string> U, StringBuilder sb)
        {
            View view = v.View;
            double hu0 = 0, hu1 = 0;
            BoundingBoxXYZ hb = v.Host?.get_BoundingBox(null);
            if (hb != null) { f.Extent(hb, out XYZ ha, out XYZ hz); hu0 = ha.Y; hu1 = hz.Y; }
            Func<Rebar, string> label = rb =>
            {
                string l = bars.TryGetValue(rb.Id.Value, out string b) ? b : "rebar";
                BbBarRole? layer = hb == null ? null : BbElevRules.Layer(rb, f, hu0, hu1);
                return rb.Id.Value + "[" + l + (layer == null ? "" : " " + layer) + "]";
            };
            var tool = new HashSet<long>();
            Dictionary<string, RevitMcpAddin.Reinforcement.RfPlacedEnd> placed;
            try { placed = RevitMcpAddin.Reinforcement.RfEndSymbolStore.Previous(doc, view); }
            catch (Exception ex) { sb.AppendLine("  ENDSYM store — " + ex.Message); placed = new Dictionary<string, RevitMcpAddin.Reinforcement.RfPlacedEnd>(); }
            foreach (var p in placed.Values)
            {
                foreach (Element part in p.Parts) tool.Add(part.Id.Value);
                if (p.Instance != null) tool.Add(p.Instance.Id.Value);
                var rb = doc.GetElement(p.RebarUid) as Rebar;
                string what = p.IsMarker ? "marker " + p.SymbolUid : p.Instance == null ? "?" : p.Instance.Symbol.FamilyName + " : " + p.Instance.Symbol.Name;
                string at = "";
                try { if (p.Instance?.Location is LocationPoint lp) { XYZ q = f.Local(lp.Point); at = " at r " + mm(q.X) + " u " + U(q.Y); } } catch { }
                sb.AppendLine("  ENDSYM tool " + (rb == null ? p.RebarUid : label(rb)) + " " + p.Kind + " bar#" + p.BarIndex + " «" + what + "» rot "
                              + (p.Rot * 180 / Math.PI).ToString("0") + "° natural " + (p.Natural * 180 / Math.PI).ToString("0") + "° offset " + mm(p.OffsetFt)
                              + " hooks " + p.Hooks + " auto " + p.Auto + at + (p.Copies > 0 ? " copies " + p.Copies : ""));
            }
            // Гараар тавьсан detail family — хамгийн ойр арматурын үзүүр (харагдах ширхгийн тэнхлэгийн төгсгөлүүд).
            var ends = new List<KeyValuePair<Rebar, XYZ>>();
            foreach (Rebar rb in new FilteredElementCollector(doc, view.Id).OfClass(typeof(Rebar)).Cast<Rebar>())
            {
                if (!bars.ContainsKey(rb.Id.Value)) continue;
                try
                {
                    int n = Math.Min(rb.NumberOfBarPositions, 60);
                    for (int i = 0; i < n; i++)
                    {
                        IList<Curve> cs = rb.GetTransformedCenterlineCurves(false, true, true, MultiplanarOption.IncludeOnlyPlanarCurves, i);
                        if (cs.Count == 0) continue;
                        ends.Add(new KeyValuePair<Rebar, XYZ>(rb, f.Local(cs[0].GetEndPoint(0))));
                        ends.Add(new KeyValuePair<Rebar, XYZ>(rb, f.Local(cs[cs.Count - 1].GetEndPoint(1))));
                    }
                }
                catch { }
            }
            int other = 0;
            foreach (FamilyInstance fi in new FilteredElementCollector(doc).OwnedByView(view.Id).OfClass(typeof(FamilyInstance)).Cast<FamilyInstance>())
            {
                if (tool.Contains(fi.Id.Value) || !(fi.Location is LocationPoint lp)) continue;
                other++;
                XYZ q = f.Local(lp.Point);
                string near = "";
                if (ends.Count > 0)
                {
                    var best = ends.OrderBy(e => Math.Pow(e.Value.X - q.X, 2) + Math.Pow(e.Value.Y - q.Y, 2)).First();
                    double d = Math.Sqrt(Math.Pow(best.Value.X - q.X, 2) + Math.Pow(best.Value.Y - q.Y, 2));
                    near = " nearest end " + label(best.Key) + " at r " + mm(best.Value.X) + " u " + U(best.Value.Y) + " dist " + mm(d);
                }
                double rot = 0;
                try { rot = lp.Rotation * 180 / Math.PI; } catch { }
                sb.AppendLine("  ENDSYM manual " + fi.Id.Value + " «" + fi.Symbol.FamilyName + " : " + fi.Symbol.Name + "» cat " + fi.Category?.Name
                              + " at r " + mm(q.X) + " u " + U(q.Y) + " rot " + rot.ToString("0") + "°" + near);
            }
            int curves = new FilteredElementCollector(doc).OwnedByView(view.Id).OfClass(typeof(CurveElement)).Count(e => e is DetailCurve && !tool.Contains(e.Id.Value));
            sb.AppendLine("  ENDSYM summary: tool " + placed.Count + ", manual families " + other + ", other detail curves " + curves);
        }

        private static string DimText(Dimension d, BbFrame f, Func<double, string> mm, Func<double, string> pp, Func<double, string> U, Dictionary<long, string> bars, Document doc)
        {
            var sb = new StringBuilder();
            bool horizontal = true;
            try
            {
                if (d.Curve is Line l) horizontal = Math.Abs(l.Direction.DotProduct(f.R)) > 0.7;
                XYZ o = f.Local(d.Curve is Line ln ? ln.Origin : d.Origin);
                sb.Append(horizontal ? "H line u " + U(o.Y) : "V line r " + mm(o.X));
            }
            catch { }
            var refs = new List<string>();
            try
            {
                foreach (Reference r in d.References)
                {
                    Element e = doc.GetElement(r.ElementId);
                    string what = e == null ? "?" : bars.TryGetValue(e.Id.Value, out string b) ? b : e is Grid g ? "GRID " + g.Name : (e.Category?.Name ?? e.GetType().Name);
                    refs.Add(r.ElementId.Value + ":" + what);
                }
            }
            catch { }
            sb.Append(" refs [" + string.Join(" ", refs) + "]");
            try
            {
                if (d.Segments != null && d.Segments.Size > 0)
                {
                    sb.Append(" segs");
                    foreach (DimensionSegment s in d.Segments)
                    {
                        XYZ o = f.Local(s.Origin);
                        sb.Append(" " + mm(s.Value ?? 0) + "@" + (horizontal ? "r" + mm(o.X) : "u" + mm(o.Y)) + (string.IsNullOrEmpty(s.ValueOverride) ? "" : "«" + s.ValueOverride + "»"));
                    }
                }
                else
                {
                    XYZ o = f.Local(d.Origin);
                    sb.Append(" value " + mm(d.Value ?? 0) + "@" + (horizontal ? "r" + mm(o.X) : "u" + mm(o.Y)) + (string.IsNullOrEmpty(d.ValueOverride) ? "" : "«" + d.ValueOverride + "»"));
                }
            }
            catch { }
            return sb.ToString();
        }
    }
}
