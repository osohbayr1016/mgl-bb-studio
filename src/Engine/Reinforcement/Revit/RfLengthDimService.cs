using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Structure;
using RevitMcpAddin.Reinforcement.Core;

namespace RevitMcpAddin.Reinforcement
{
    internal sealed class RfLenReport
    {
        public int Rebars, ChainsPlanned, ChainsMade, Segments, Merged;
        public string TypeName;
        public long ElapsedMs;
        public readonly List<ElementId> Created = new List<ElementId>();
        public readonly List<string> Failures = new List<string>();
        public readonly List<string> Notes = new List<string>();
    }

    /// <summary>
    /// «Арматурын урт хэмжих»: сонгосон арматуруудын төгсгөлийн хэрчмийн лавлагаанд (харагдацын далд «Highlight» шугам — гараар хэмжээс тавихад Revit-ийн
    /// өөрийн ашигладаг <c>…:1003000</c>/<c>…:1004000</c>) ҮРГЭЛЖИЛСЭН хэмжээс тавина.  Шугам нь хэрэглэгчийн дарсан цэгээр, төрөл нь хэрэглэгчийн ОДОО
    /// хэрэглэж буй (Revit-ийн Dimension хэрэгслийн өгөгдмөл) шугаман хэмжээсийн төрөл.  Байрлалын дүрэм <see cref="RfLengthDimPlanner"/> (цэвэр, тесттэй).
    ///
    /// Хэмжээс бүрийн сегментийн утгыг Revit-ээс уншиж хүлээсэнтэй (0.5 мм) тулгана — таарахгүй бол тэр хэмжээсийг буцаана (буруу утгатай хэмжээс ҮЛДЭЭХГҮЙ).
    /// </summary>
    internal static class RfLengthDimService
    {
        public const string Title = "Арматурын урт хэмжих";

        private static readonly System.Text.RegularExpressions.Regex EndCapCode = new System.Text.RegularExpressions.Regex(@":100[34]000(:|$)");

        /// <summary>
        /// Хэрэглэгчийн ОДОО хэрэглэж буй шугаман хэмжээсийн төрөл = Revit-ийн Annotate → Aligned/Linear хэрэгслийн өгөгдмөл (сүүлд сонгосон) төрөл.
        /// Олдохгүй / шугаман биш бол null (Revit өөрийн өгөгдмөлөөр үүсгэнэ).
        /// </summary>
        public static DimensionType CurrentType(Document doc)
        {
            try
            {
                ElementId id = doc.GetDefaultElementTypeId(ElementTypeGroup.LinearDimensionType);
                DimensionType dt = id == null || id == ElementId.InvalidElementId ? null : doc.GetElement(id) as DimensionType;
                if (dt != null && dt.StyleType == DimensionStyleType.Linear) return dt;
            }
            catch
            {
                // Өгөгдмөл уншигдахгүй — Revit-ийн өөрийнх.
            }
            return null;
        }

        /// <summary>⚠️ Transaction-ийг ӨӨРӨӨ нээнэ (нэг Ctrl+Z).  Хэмжээс нэг ч үүсээгүй бол юу ч үлдээхгүй.</summary>
        public static RfLenReport Place(Document doc, View view, IList<Rebar> rebars, XYZ pick)
        {
            var sw = Stopwatch.StartNew();
            var rep = new RfLenReport();
            DimensionType type = CurrentType(doc);
            rep.TypeName = type == null ? "Revit-ийн өгөгдмөл" : Safe(type);

            RfViewFrame frame = RfView.Frame(view);
            RfV3 pk = RfConv.V(pick);
            var bars = new List<RfLenBar>();
            var byId = new Dictionary<long, Rebar>();
            foreach (Rebar r in rebars)
            {
                if (r == null || byId.ContainsKey(r.Id.Value)) continue;
                byId[r.Id.Value] = r;
                rep.Rebars++;
                string why;
                RfLenBar b = Read(doc, view, frame, r, pk, out why);
                if (b == null) rep.Failures.Add(Who(doc, r) + ": " + why + ".");
                else bars.Add(b);
            }

            RfLenPlan plan = RfLengthDimPlanner.Build(bars, frame.ToView(pk));
            foreach (RfLenSkip s in plan.Skipped)
            {
                Rebar r;
                byId.TryGetValue(s.BarId, out r);
                rep.Failures.Add(Who(doc, r) + ": " + (s.Reason == RfLenSkipReason.SeenEndOn
                    ? "энэ харагдацад цэг болж харагдана (харагдацад перпендикуляр) — уртыг нь хажуугаас харсан харагдацад хэмжинэ"
                    : "хоёр үзүүр нь нэг шулууны дагуу биш (L, U хэлбэр эсвэл налуу дэгээ) — үргэлжилсэн уртаар хэмжигдэхгүй") + ".");
            }
            rep.ChainsPlanned = plan.Chains.Count;
            if (plan.Chains.Count == 0)
            {
                rep.ElapsedMs = sw.ElapsedMilliseconds;
                return rep;
            }

            var barsById = bars.ToDictionary(b => b.Id);
            using (var t = new Transaction(doc, "MGL — " + Title))
            {
                t.Start();
                FailureHandlingOptions fho = t.GetFailureHandlingOptions();
                fho.SetFailuresPreprocessor(new RfWarningSwallower());
                t.SetFailureHandlingOptions(fho);
                try
                {
                    foreach (RfLenChain c in plan.Chains) Create(doc, view, frame, c, byId, barsById, type, rep);
                }
                catch (Exception ex)
                {
                    rep.Failures.Add(ex.Message.Split('\n')[0].Trim().TrimEnd('.') + ".");
                }
                if (rep.ChainsMade > 0) t.Commit();
                else
                {
                    t.RollBack();
                    rep.Created.Clear();
                }
            }
            rep.ElapsedMs = sw.ElapsedMilliseconds;
            return rep;
        }

        /// <summary>
        /// Нэг арматурын харагдацын өгөгдөл: олонлогоос дарсан цэгт хамгийн ойр ХАРАГДАЖ БУЙ ширхэг.  Эхлээд дэгээтэйгээр (бодит үзүүр); үзүүрүүд нэг
        /// шулууны дагуу биш бол (дэгээтэй шулуун арматур) дэгээгүйгээр дахин — төгсгөлийн хэрчмийн лавлагаа олдохгүй бол <see cref="Create"/> ил хэлнэ.
        /// </summary>
        private static RfLenBar Read(Document doc, View view, RfViewFrame frame, Rebar r, RfV3 pick, out string why)
        {
            why = null;
            bool freeForm = false;
            try { freeForm = r.IsRebarFreeForm(); } catch { freeForm = false; }
            if (freeForm)
            {
                why = "чөлөөт хэлбэрийн (Free Form) арматур дэмжигдэхгүй";
                return null;
            }
            double dia = RfSectionAnalyzer.Diameter(doc, r);
            RfLenBar first = null;
            foreach (bool hooks in new[] { true, false })
            {
                RfRebarEndsResult er = RfRebarEnds.Compute(r, view, hooks, RfBarSetMode.Nearest, pick);
                RfBarEnd s = null, e = null;
                foreach (IGrouping<int, RfBarEnd> g in er.Ends.GroupBy(x => x.BarIndex))
                {
                    s = g.FirstOrDefault(x => x.Kind == RfEndKind.Start);
                    e = g.FirstOrDefault(x => x.Kind == RfEndKind.End);
                    if (s != null && e != null) break;
                }
                if (s == null || e == null)
                {
                    if (first == null && why == null)
                        why = er.HiddenBars > 0 && er.Ends.Count == 0 ? "энэ харагдацад харагдахгүй (нуугдсан ширхэг)" : "геометр уншигдсангүй";
                    continue;
                }
                var b = new RfLenBar
                {
                    Id = r.Id.Value,
                    BarIndex = s.BarIndex,
                    A = frame.ToView(s.Position),
                    B = frame.ToView(e.Position),
                    OutA = frame.ToViewVec(s.OutwardTangent),
                    OutB = frame.ToViewVec(e.OutwardTangent),
                    Diameter = dia,
                };
                RfV2 dir;
                RfLenSkipReason skip;
                if (RfLengthDimPlanner.AxisOf(b, out dir, out skip)) return b;
                if (first == null) first = b;   // дэгээгүй хувилбар ч тэнцэхгүй бол ЭНЭ шалтгаанаар planner тайланд хэлнэ
            }
            if (first != null) why = null;
            return first;
        }

        private static void Create(Document doc, View view, RfViewFrame frame, RfLenChain c, Dictionary<long, Rebar> rebars,
            Dictionary<long, RfLenBar> bars, DimensionType type, RfLenReport rep)
        {
            string who = c.BarIds.Count == 1 ? Who(doc, rebars[c.BarIds[0]]) : "Үргэлжилсэн хэмжээс (" + c.BarIds.Count + " арматур)";
            var ra = new ReferenceArray();
            foreach (RfLenRef r in c.Refs)
            {
                Reference cap = FindCap(doc, view, frame, rebars[r.BarId], c.Dir, r, bars[r.BarId].Diameter);
                if (cap == null)
                {
                    rep.Failures.Add(who + ": " + Who(doc, rebars[r.BarId]) + "-ийн " + (r.IsStart ? "эхлэлийн" : "төгсгөлийн")
                        + " лавлагаа олдсонгүй (дэгээтэй/нугалсан үзүүр, эсвэл харагдацад тасарсан) — тавигдсангүй.");
                    return;
                }
                ra.Append(cap);
            }
            using (var st = new SubTransaction(doc))
            {
                st.Start();
                try
                {
                    Line line = Line.CreateBound(RfConv.X(frame.ToModel(c.LineStart)), RfConv.X(frame.ToModel(c.LineEnd)));
                    Dimension d = type != null ? doc.Create.NewDimension(view, line, ra, type) : doc.Create.NewDimension(view, line, ra);
                    if (d == null) throw new InvalidOperationException("NewDimension → null");
                    string typeWhy;
                    if (!global::RevitMcpAddin.AutoAnnotate.AaDimType.Enforce(d, type, out typeWhy))
                    {
                        st.RollBack();
                        rep.Failures.Add(who + ": " + typeWhy + " — тавигдсангүй.");
                        return;
                    }
                    doc.Regenerate();
                    string bad = RfElevationService.VerifySegments(d, c.Positions);
                    if (bad != null)
                    {
                        st.RollBack();
                        rep.Failures.Add(who + ": " + bad + " — тавигдсангүй.");
                        return;
                    }
                    st.Commit();
                    rep.Created.Add(d.Id);
                    rep.ChainsMade++;
                    rep.Segments += c.Refs.Count - 1;
                    rep.Merged += c.Merged;
                }
                catch (Exception ex)
                {
                    if (st.HasStarted() && !st.HasEnded()) st.RollBack();
                    rep.Failures.Add(who + ": " + ex.Message.Split('\n')[0].Trim().TrimEnd('.') + ".");
                }
            }
        }

        /// <summary>
        /// Төгсгөлийн хэрчмийн лавлагаа (<c>RfSetMraService.FindCap</c>-ийн ижил дүрэм — хучилтын план дээр бодитоор шалгагдсан): харагдацын геометрийн далд
        /// шугам, урт ≈ голч, хэмжээсийн чиглэлд перпендикуляр, чиглэлийн координат нь төгсгөлд (≤ 2 мм).  Олонлогийн ижил урттай ширхгүүдээс ЭНЭ ширхгийнхийг
        /// (перпендикуляр байрлалаар) илүүд үзнэ, дараа нь <c>:1003000</c>/<c>:1004000</c> кодтойг.  Олдохгүй бол null.
        /// </summary>
        private static Reference FindCap(Document doc, View view, RfViewFrame frame, Rebar rebar, RfV2 dir, RfLenRef end, double dia)
        {
            GeometryElement ge = RfRebarRefs.ViewGeometry(rebar, view);
            if (ge == null) return null;
            double tol = RfTol.MmToFt(2);
            double nTol = Math.Max(dia, 0) * 0.75 + tol;
            RfV2 n = dir.Perp();
            Reference best = null;
            int bestRank = -1;
            double bestDn = double.MaxValue;
            var stack = new Stack<GeometryElement>();
            stack.Push(ge);
            while (stack.Count > 0)
            {
                foreach (GeometryObject go in stack.Pop())
                {
                    GeometryInstance gi = go as GeometryInstance;
                    if (gi != null)
                    {
                        GeometryElement sub = null;
                        try { sub = gi.GetSymbolGeometry(); } catch { sub = null; }
                        if (sub != null) stack.Push(sub);
                        continue;
                    }
                    Line l = go as Line;
                    if (l == null) continue;
                    Reference rf;
                    try { rf = l.Reference; } catch { continue; }
                    if (rf == null) continue;
                    RfV2 pa = frame.ToView(RfConv.V(l.GetEndPoint(0))), pb = frame.ToView(RfConv.V(l.GetEndPoint(1)));
                    RfV2 d = pb - pa;
                    double len = d.Length;
                    if (len < 1e-9) continue;
                    if (dia > 0 && (len < dia * 0.5 || len > dia * 1.6)) continue;
                    if (Math.Abs(d.Dot(dir)) > 0.05 * len) continue;
                    RfV2 mid = (pa + pb) * 0.5;
                    if (Math.Abs(mid.Dot(dir) - end.S) > tol) continue;
                    double dn = Math.Abs(mid.Dot(n) - end.N);
                    bool code = false;
                    try { code = EndCapCode.IsMatch(rf.ConvertToStableRepresentation(doc)); } catch { code = false; }
                    int rank = (dn <= nTol ? 2 : 0) + (code ? 1 : 0);
                    if (rank > bestRank || (rank == bestRank && dn < bestDn))
                    {
                        best = rf;
                        bestRank = rank;
                        bestDn = dn;
                    }
                }
            }
            return best;
        }

        internal static string Who(Document doc, Rebar r)
        {
            if (r == null) return "Арматур";
            string mark = null;
            try { mark = r.get_Parameter(BuiltInParameter.ALL_MODEL_MARK)?.AsString(); } catch { mark = null; }
            return "Арматур " + r.Id.Value + (string.IsNullOrWhiteSpace(mark) ? string.Empty : " («" + mark.Trim() + "»)");
        }

        private static string Safe(Element e)
        {
            try { return e.Name; } catch { return "?"; }
        }
    }
}
