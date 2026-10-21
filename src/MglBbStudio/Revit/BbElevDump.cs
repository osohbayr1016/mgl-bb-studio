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
            foreach (IndependentTag t in new FilteredElementCollector(doc, view.Id).OfClass(typeof(IndependentTag)).Cast<IndependentTag>())
            {
                if (t.OwnerViewId != view.Id || mraTags.Contains(t.Id.Value)) continue;
                string tagged = "";
                try { tagged = string.Join(",", t.GetTaggedLocalElementIds().Select(id => id.Value + (bars.TryGetValue(id.Value, out string b) ? "[" + b + "]" : ""))); } catch { }
                string head = "", lead = "";
                try { XYZ h = f.Local(t.TagHeadPosition); head = "head r " + mm(h.X) + " u " + U(h.Y); } catch { }
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
