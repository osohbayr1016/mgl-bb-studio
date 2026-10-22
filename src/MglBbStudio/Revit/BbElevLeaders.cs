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
        }

        public static int Apply(RfElevContext c, RfElevReport r, BbMemberStandard ms)
        {
            if (c.IsColumn || string.IsNullOrEmpty(ms.ElevLeaderSide) || ms.ElevLeaderHeadPaperMm <= 0 || r?.Plan == null) return 0;
            int scale = c.View.Scale > 0 ? c.View.Scale : 50;
            Func<double, double> ft = mm => RfTol.PaperMmToModelFt(mm, scale);
            double headD = ft(ms.ElevLeaderHeadPaperMm), run = ft(Math.Max(0, ms.ElevLeaderRunPaperMm)), gap = ft(Math.Max(0.5, ms.TagGapPaperMm));
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
                moves.Add(new Move { Tag = t, Ref = rf, End = end, HeadV = head.Y, Cx = widths.TryGetValue(rb.Id.Value, out double w) ? w : ft(12) });
            }
            if (moves.Count == 0) return 0;

            // Эгнээ (толгойн өндөр) тус бүрд зүүнээс баруун тийш: илүүд үзэх тал давхцвал эсрэг тал.
            var placed = new List<KeyValuePair<double, double[]>>();   // headV → [x0, x1]
            foreach (Move m in moves.OrderBy(x => x.HeadV).ThenBy(x => x.End.X))
            {
                double w = m.Cx;
                foreach (double dir in new[] { pref, -pref })
                {
                    double elbow = m.End.X + dir * run;
                    double hx = elbow + dir * headD;
                    // Бичвэрийн хүрээ: толгойноос бичвэрийн тал руу w (толгой бичвэрийн хугарал талд — инженерийн шошгонд ≈ 2 мм дотогш).
                    double x0 = dir > 0 ? elbow : hx - w, x1 = dir > 0 ? hx + w : elbow;
                    bool hit = placed.Any(p => Math.Abs(p.Key - m.HeadV) < ft(1) && x0 < p.Value[1] + gap && x1 > p.Value[0] - gap);
                    if (hit && dir == pref) continue;
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
    }
}
