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
    /// Дамнурууны дэлгээсийн арматурын шошгыг инженерийн хэлбэрт (ЖИШЭЭ-2 ДДН-10, 2026-10-21): бичвэр хугарлын <see cref="BbMemberStandard.ElevLeaderSide"/>
    /// талд, хугарлаас толгой хүртэл <see cref="BbMemberStandard.ElevLeaderHeadPaperMm"/>, хугарал арматураас <see cref="BbMemberStandard.ElevLeaderRunPaperMm"/> —
    /// хэвтээ «landing» + налуу.  Хөдөлгүүрийн <c>RfLeaderElbow</c> шошго арматурын яг дээр байхад бичвэрийг үргэлж зүүн тийш гаргадаг, 2→1 = 0 үед
    /// огт хөдөлгөдөггүй тул энд — зурсны дараа.  Нэг эгнээнд давхцвал эсрэг тал руу.  Нээлттэй Transaction дотор.  <c>src/Engine</c>-ийг засахгүй.
    /// </summary>
    internal static class BbElevLeaders
    {
        private sealed class Move
        {
            public IndependentTag Tag;
            public Reference Ref;
            public RfV2 End;
            public double HeadV, Cx, Elbow;
            public double Lo = double.MinValue, Hi = double.MaxValue;   // leader-ийн төгсгөл гулсах муж (гол шулуун хэсэг)
        }

        public static int Apply(RfElevContext c, RfElevReport r, BbMemberStandard ms)
        {
            if (c.IsColumn || string.IsNullOrEmpty(ms.ElevLeaderSide) || ms.ElevLeaderHeadPaperMm <= 0 || r?.Plan == null) return 0;
            int scale = c.View.Scale > 0 ? c.View.Scale : 50;
            Func<double, double> ft = mm => RfTol.PaperMmToModelFt(mm, scale);
            double headD = ft(ms.ElevLeaderHeadPaperMm), run = ft(Math.Max(0, ms.ElevLeaderRunPaperMm)), gap = ft(Math.Max(0.5, ms.TagGapPaperMm)), over = ft(2);
            double pref = string.Equals(ms.ElevLeaderSide, BbTagRoles.Left, StringComparison.OrdinalIgnoreCase) ? -1 : 1;
            var widths = new Dictionary<long, double>();
            foreach (RfElevTagPlan p in r.Plan.Tags) widths[p.BarId] = p.Width;
            var mraTags = new HashSet<long>(new FilteredElementCollector(c.Doc, c.View.Id).OfClass(typeof(MultiReferenceAnnotation)).Cast<MultiReferenceAnnotation>().Select(m => m.TagId.Value));

            var moves = new List<Move>();
            foreach (IndependentTag t in r.Created.Select(id => c.Doc.GetElement(id)).OfType<IndependentTag>())
            {
                if (mraTags.Contains(t.Id.Value) || !t.HasLeader) continue;
                Rebar rb = t.GetTaggedLocalElementIds().Select(id => c.Doc.GetElement(id)).OfType<Rebar>().FirstOrDefault();
                if (rb == null) continue;
                try { if ((c.Doc.GetElement(rb.GetShapeId()) as RebarShape)?.RebarStyle == RebarStyle.StirrupTie) continue; } catch { }
                Reference rf = t.GetTaggedReferences().FirstOrDefault();
                if (rf == null || t.LeaderEndCondition != LeaderEndCondition.Free) continue;
                RfV2 end = c.Frame.ToView(RfConv.V(t.GetLeaderEnd(rf)));
                RfV2 head = c.Frame.ToView(RfConv.V(t.TagHeadPosition));
                var mv = new Move { Tag = t, Ref = rf, End = end, HeadV = head.Y, Cx = widths.TryGetValue(rb.Id.Value, out double w) ? w : ft(12) };
                // Төгсгөл арматурын ГОЛ шулуун хэсэг дээр (ДН-5: доод #2-ын leader 65 мм дээгүүр зогсож байв — нугалсан үзүүрээр bbox өндөр).
                if (MainLine(c, rb, out RfV2 a, out RfV2 b) && Math.Abs(a.Y - b.Y) < ft(0.5))
                {
                    mv.Lo = Math.Min(a.X, b.X); mv.Hi = Math.Max(a.X, b.X);
                    if (end.X > mv.Lo && end.X < mv.Hi && Math.Abs(end.Y - (a.Y + b.Y) / 2) < ft(8)) mv.End = new RfV2(end.X, (a.Y + b.Y) / 2);
                }
                moves.Add(mv);
            }
            if (moves.Count == 0) return 0;

            // Эгнээ (толгойн өндөр) тус бүрд зүүнээс баруун тийш: илүүд үзэх тал давхцвал эсрэг тал.
            var placed = new List<KeyValuePair<double, double[]>>();   // headV → [x0, x1]
            foreach (Move m in moves.OrderBy(x => x.HeadV).ThenBy(x => x.End.X))
            {
                double w = m.Cx;
                foreach (double dir in new[] { pref, -pref })
                {
                    double endX = m.End.X;
                    double elbow = endX + dir * run;
                    double hx = elbow + dir * headD;
                    // Бичвэрийн хүрээ: толгойноос бичвэрийн тал руу w; бичвэр хугарлаас ≈ 2 мм буцаж гардаг (ДН-5: #4 «-690..179», хугарал -615).
                    double x0 = dir > 0 ? elbow - over : hx - w, x1 = dir > 0 ? hx + w : elbow + over;
                    Func<double, double, bool> hits = (a0, a1) => placed.Any(p => Math.Abs(p.Key - m.HeadV) < ft(1) && a0 < p.Value[1] + gap && a1 > p.Value[0] - gap);
                    bool hit = hits(x0, x1);
                    if (hit && dir == pref) continue;
                    // Хоёр тал хоёулаа давхцвал leader-ийг арматурын дагуу гулсуулна (ДН-5: #7 шошго #4-ийнхийг дарж байв — инженер зүүн тийш зөөсөн).
                    for (int guard = 0; hit && guard < 40; guard++)
                    {
                        double s = placed.Where(p => Math.Abs(p.Key - m.HeadV) < ft(1) && x0 < p.Value[1] + gap && x1 > p.Value[0] - gap)
                                         .Select(p => dir > 0 ? p.Value[1] + gap - x0 : x1 - (p.Value[0] - gap)).Max() + ft(0.5);
                        double nx = endX + dir * s;
                        if (nx < m.Lo || nx > m.Hi) break;
                        endX = nx; x0 += dir * s; x1 += dir * s; elbow += dir * s; hx += dir * s;
                        hit = hits(x0, x1);
                    }
                    if (endX != m.End.X) m.End = new RfV2(endX, m.End.Y);
                    placed.Add(new KeyValuePair<double, double[]>(m.HeadV, new[] { x0, x1 }));
                    m.Elbow = elbow;
                    m.Cx = hx;
                    break;
                }
            }
            // Revit 2024-д хэмжсэн дараалал (BbElevMra.ApplyMid): толгой → Free → төгсгөл, Regenerate, дараа нь elbow.
            foreach (Move m in moves)
            {
                try
                {
                    m.Tag.TagHeadPosition = c.Model(m.Cx, m.HeadV);
                    m.Tag.LeaderEndCondition = LeaderEndCondition.Free;
                    m.Tag.SetLeaderEnd(m.Ref, c.Model(m.End));
                }
                catch { }
            }
            c.Doc.Regenerate();
            int n = 0;
            foreach (Move m in moves)
            {
                try { m.Tag.SetLeaderElbow(m.Ref, c.Model(m.Elbow, m.HeadV)); n++; } catch { }
            }
            c.Doc.Regenerate();
            return n;
        }

        /// <summary>
        /// Дээд талын шошгыг дээд талын хэмжээсийн (давхцал, гинж) туслах шугам дайрвал арматурын дагуу хамгийн бага зайгаар гулсуулна — ДН-5: #6-ийн
        /// бичвэрийг «500»-ийн шугам дайрч байсныг инженер зүүн тийш зөөсөн.  Гинж шошгоны ДАРАА зурагддаг тул эцэст нь.  Нээлттэй Transaction дотор.
        /// </summary>
        public static int AvoidWitness(Document doc, View view, RfElevContext c)
        {
            if (c == null || c.IsColumn || c.Input.BeamV1 <= c.Input.BeamV0) return 0;
            BbFrame f = BbFrame.Of(view);
            int scale = view.Scale > 0 ? view.Scale : 50;
            Func<double, double> ft = mm => RfTol.PaperMmToModelFt(mm, scale);
            double top = f.Local(c.Model(0, c.Input.BeamV1)).Y, gap = ft(1);
            var mraDims = new HashSet<long>(new FilteredElementCollector(doc, view.Id).OfClass(typeof(MultiReferenceAnnotation)).Cast<MultiReferenceAnnotation>().Select(m => m.DimensionId.Value));
            var wit = new List<double>();
            foreach (Dimension d in new FilteredElementCollector(doc, view.Id).OfClass(typeof(Dimension)).Cast<Dimension>())
            {
                if (d.OwnerViewId != view.Id || mraDims.Contains(d.Id.Value) || !(d.Curve is Line l) || f.Local(l.Origin).Y <= top) continue;
                if (d.Segments != null && d.Segments.Size > 0)
                    foreach (DimensionSegment sg in d.Segments) { double o = f.Local(sg.Origin).X, h = (sg.Value ?? 0) / 2; wit.Add(o - h); wit.Add(o + h); }
                else { double o = f.Local(d.Origin).X, h = (d.Value ?? 0) / 2; wit.Add(o - h); wit.Add(o + h); }
            }
            if (wit.Count == 0) return 0;
            var tags = new List<KeyValuePair<IndependentTag, double[]>>();   // [x0, x1, headU]
            foreach (IndependentTag t in new FilteredElementCollector(doc, view.Id).OfClass(typeof(IndependentTag)).Cast<IndependentTag>())
            {
                if (t.OwnerViewId != view.Id || !t.HasLeader || t.LeaderEndCondition != LeaderEndCondition.Free) continue;
                BoundingBoxXYZ bb;
                try { bb = t.get_BoundingBox(view); } catch { continue; }
                if (bb == null) continue;
                f.Extent(bb, out XYZ a, out XYZ b);
                double hu = f.Local(t.TagHeadPosition).Y;
                if (hu <= top || hu > top + ft(9)) continue;
                tags.Add(new KeyValuePair<IndependentTag, double[]>(t, new[] { a.X, b.X, hu }));
            }
            Func<double, double, bool> crossed = (x0, x1) => wit.Any(w => w > x0 + gap && w < x1 - gap);
            int n = 0;
            foreach (var kv in tags)
            {
                double x0 = kv.Value[0], x1 = kv.Value[1];
                if (!crossed(x0, x1)) continue;
                IndependentTag t = kv.Key;
                Rebar rb = t.GetTaggedLocalElementIds().Select(id => doc.GetElement(id)).OfType<Rebar>().FirstOrDefault();
                Reference rf = t.GetTaggedReferences().FirstOrDefault();
                if (rb == null || rf == null || !MainLine(c, rb, out RfV2 ma, out RfV2 mb)) continue;
                double lo = f.Local(c.Model(Math.Min(ma.X, mb.X), 0)).X, hi = f.Local(c.Model(Math.Max(ma.X, mb.X), 0)).X;
                if (lo > hi) { double tmp = lo; lo = hi; hi = tmp; }
                XYZ end = t.GetLeaderEnd(rf);
                double ex = f.Local(end).X;
                Func<double, bool> ok = dx => ex + dx > lo && ex + dx < hi && !crossed(x0 + dx, x1 + dx)
                    && !tags.Any(o => o.Key.Id != t.Id && Math.Abs(o.Value[2] - kv.Value[2]) < ft(1) && x0 + dx < o.Value[1] + gap && x1 + dx > o.Value[0] - gap);
                // Туслах шугамын хоёр талд шахах шилжилтүүдээс хамгийн богино нь.
                var cands = new List<double>();
                foreach (double w in wit) { cands.Add(w - gap * 2 - x1); cands.Add(w + gap * 2 - x0); }
                double? best = cands.Where(ok).OrderBy(Math.Abs).Cast<double?>().FirstOrDefault();
                if (best == null) continue;
                XYZ mv = f.R * best.Value;
                try
                {
                    XYZ elbow = t.GetLeaderElbow(rf);
                    t.TagHeadPosition = t.TagHeadPosition + mv;
                    t.SetLeaderEnd(rf, end + mv);
                    doc.Regenerate();
                    t.SetLeaderElbow(rf, elbow + mv);
                    kv.Value[0] += best.Value; kv.Value[1] += best.Value;
                    n++;
                }
                catch { }
            }
            if (n > 0) doc.Regenerate();
            return n;
        }

        /// <summary>Арматурын хамгийн урт шулуун хэсэг (гишүүний frame).</summary>
        private static bool MainLine(RfElevContext c, Rebar rb, out RfV2 a, out RfV2 b)
        {
            a = b = default(RfV2);
            Line best = null;
            try
            {
                foreach (Curve cv in rb.GetTransformedCenterlineCurves(false, true, true, MultiplanarOption.IncludeOnlyPlanarCurves, 0))
                    if (cv is Line l && (best == null || l.Length > best.Length)) best = l;
            }
            catch { }
            if (best == null) return false;
            a = c.Frame.ToView(RfConv.V(best.GetEndPoint(0)));
            b = c.Frame.ToView(RfConv.V(best.GetEndPoint(1)));
            return true;
        }
    }
}
