using System;
using System.Collections.Generic;
using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Structure;
using RevitMcpAddin.Reinforcement.Core;

namespace RevitMcpAddin.Reinforcement
{
    /// <summary>Нэг арматурын төгсгөлүүдийг тооцсон үр дүн.</summary>
    internal sealed class RfRebarEndsResult
    {
        public readonly List<RfBarEnd> Ends = new List<RfBarEnd>();

        /// <summary>Энэ харагдацад нуугдсан ширхгийн тоо.</summary>
        public int HiddenBars;

        /// <summary>Геометр (centerline) гарсангүй — freeform гэх мэт.</summary>
        public bool NoGeometry;

        /// <summary>Freeform арматур (Revit-ийн RebarFreeForm) — centerline гэсэн ойлголт дэмжигдэхгүй.</summary>
        public bool FreeForm;

        /// <summary>
        /// «Сонгосон ширхэг» горимд дарсан цэг мэдэгдэж байсан ч хамгийн ойр ширхгийг тодорхойлж чадсангүй (геометр уншигдаагүй) —
        /// ХАРААХАН таамаглахгүй, бүх ширхэгт тавина; дуудагч тайланд ИЛ хэлнэ.
        /// </summary>
        public bool NearestFallback;
    }

    /// <summary>
    /// Арматурын ЛОГИК эхлэл/төгсгөлийг БОДИТ геометрээс олно.
    ///
    /// «Логик эхлэл» = `GetTransformedCenterlineCurves` гинжийн ЭХНИЙ муруйн эхлэл, «логик төгсгөл» = СҮҮЛИЙН
    /// муруйн төгсгөл (Revit-ийн hook start/end индекс 0/1-тэй ижил дараалал).  Шулуун арматур гэж ТААМАГЛАХГҮЙ:
    /// L, U, дэгээтэй, multi-segment, шигтгэсэн (shape-driven) бүгд гинжээр уншигдана.
    ///
    /// Олонлог (bar set)-ийн ширхэг бүрийн өөрийн муруй: `GetTransformedCenterlineCurves(.., barIndex)` нь
    /// BarPositionTransform + MovedBarTransform-ыг хэрэглэсэн ЭЦСИЙН байрлалыг өгнө (2022+).
    /// </summary>
    internal static class RfRebarEnds
    {
        public static RfRebarEndsResult Compute(Rebar rebar, View view, bool includeHooks, RfBarSetMode setMode)
        {
            return Compute(rebar, view, includeHooks, setMode, null);
        }

        /// <param name="pickPoint">
        /// Хэрэглэгчийн дарсан цэг (загварын координат).  <see cref="RfBarSetMode.Nearest"/> горимд олонлогоос ЭНЭ цэгт хамгийн ойр
        /// ЯГ НЭГ ширхгийг (харагдацын хавтгай дээрх зайгаар) сонгоно — «эхний ширхэг» гэж сохроор авахгүй.
        /// </param>
        public static RfRebarEndsResult Compute(Rebar rebar, View view, bool includeHooks, RfBarSetMode setMode, RfV3? pickPoint)
        {
            var res = new RfRebarEndsResult();

            try { res.FreeForm = rebar.IsRebarFreeForm(); }
            catch { res.FreeForm = false; }

            int n = 1;
            try { n = Math.Max(1, rebar.NumberOfBarPositions); }
            catch { n = 1; }

            var existing = new List<int>();
            for (int i = 0; i < n; i++)
            {
                try
                {
                    if (rebar.DoesBarExistAtPosition(i)) existing.Add(i);
                }
                catch
                {
                    // Энэ индекс байхгүй.
                }
            }
            if (existing.Count == 0)
            {
                res.NoGeometry = true;
                return res;
            }

            RfPresentation pres = RfPresentation.All;
            try
            {
                if (view != null && rebar.CanApplyPresentationMode(view))
                    pres = Map(rebar.GetPresentationMode(view));
            }
            catch
            {
                pres = RfPresentation.All;
            }

            List<int> indices = RfEndSymbolMath.SelectBars(existing, pres, setMode);

            // Голын шугам ширхэг тус бүрд НЭГ л удаа уншигдана (сонгох ба төгсгөл олох хоёуланд).
            var curveCache = new Dictionary<int, IList<Curve>>();
            Func<int, IList<Curve>> curvesOf = i =>
            {
                IList<Curve> got;
                if (curveCache.TryGetValue(i, out got)) return got;
                try
                {
                    got = rebar.GetTransformedCenterlineCurves(
                        false,              // adjustForSelfIntersection — төгсгөлийн чиглэлд нөлөөгүй
                        !includeHooks,      // suppressHooks: true = дэгээ (hook) ба crank-ыг ХАСНА
                        false,              // suppressBendRadius: false = жинхэнэ (дугуйлсан) гинж
                        MultiplanarOption.IncludeOnlyPlanarCurves,
                        i);
                }
                catch
                {
                    got = null;
                }
                curveCache[i] = got;
                return got;
            };

            if (setMode == RfBarSetMode.Nearest && indices.Count > 1 && (!pickPoint.HasValue || view == null))
            {
                // Дарсан цэг мэдэгдэхгүй (арматурыг ӨМНӨ нь сонгосон) олонлог — ширхгийг таамаглахгүй: бүх ширхэгт тавина, тайланд ИЛ хэлнэ.
                res.NearestFallback = true;
            }
            else if (setMode == RfBarSetMode.Nearest && indices.Count > 1)
            {
                RfViewFrame frame = RfView.Frame(view);
                RfV2 pick = frame.ToView(pickPoint.Value);
                var cand = new List<int>();
                var dist = new List<double>();
                foreach (int i in indices)
                {
                    bool hid = false;
                    try { hid = rebar.IsBarHidden(view, i); }
                    catch { hid = false; }
                    if (hid) continue; // нуугдсан ширхгийг дарж болохгүй
                    cand.Add(i);
                    dist.Add(DistanceToCurves(curvesOf(i), frame, pick, frame.DepthOf(pickPoint.Value)));
                }
                int best = RfEndSymbolMath.NearestBar(cand, dist);
                if (best >= 0) indices = new List<int> { best };
                else res.NearestFallback = true;
            }

            foreach (int idx in indices)
            {
                bool hidden = false;
                try { hidden = view != null && rebar.IsBarHidden(view, idx); }
                catch { hidden = false; }
                if (hidden)
                {
                    res.HiddenBars++;
                    continue;
                }

                IList<Curve> curves = curvesOf(idx);
                if (curves == null || curves.Count == 0)
                {
                    res.NoGeometry = true;
                    continue;
                }

                // ⚠️ Гинжийн үзүүрийг муруйн ЧИГЛЭЛЭЭС («curves[0]-ийн эхлэл») биш ХОЛБОЛТООР олно: Revit-ийн баримт
                // зөвхөн «chain of curves» гэдэг, муруй бүр залгагдсан чиглэлтэй гэж баталгаажуулдаггүй (RfChain).
                var segs = new List<RfSeg>(curves.Count);
                bool segsOk = true;
                foreach (Curve cv in curves)
                {
                    RfV3 ta, tb;
                    if (!TryTangent(cv, 0.0, out ta) || !TryTangent(cv, 1.0, out tb))
                    {
                        segsOk = false;
                        break;
                    }
                    segs.Add(new RfSeg(RfConv.V(cv.GetEndPoint(0)), RfConv.V(cv.GetEndPoint(1)), ta, tb));
                }
                RfChainEnd cs, ce;
                if (!segsOk || !RfChain.FindEnds(segs, out cs, out ce))
                {
                    res.NoGeometry = true;
                    continue;
                }
                res.Ends.Add(new RfBarEnd { Kind = RfEndKind.Start, BarIndex = idx, Position = cs.Position, OutwardTangent = cs.Outward });
                res.Ends.Add(new RfBarEnd { Kind = RfEndKind.End, BarIndex = idx, Position = ce.Position, OutwardTangent = ce.Outward });
            }
            return res;
        }

        /// <summary>
        /// Дарсан цэгээс ширхгийн голын шугам хүртэлх зай — ХАРАГДАЦЫН хавтгай дээр (гүнийг үл тооно: план дээр GlobalPoint-ийн Z утгагүй).
        /// Муруй бүрийг tessellate хийж Core-ийн polyline зайгаар.  Уншигдаагүй бол NaN.
        /// </summary>
        internal static double DistanceToCurves(IList<Curve> curves, RfViewFrame frame, RfV2 pick, double pickDepth)
        {
            if (curves == null || curves.Count == 0) return double.NaN;
            double best = double.NaN;
            foreach (Curve cv in curves)
            {
                IList<XYZ> pts;
                try { pts = cv.Tessellate(); }
                catch { continue; }
                var poly = new List<RfV2>(pts.Count);
                foreach (XYZ p in pts) poly.Add(frame.ToView(RfConv.V(p)));
                double d = RfEndSymbolMath.DistanceToPolyline(pick, poly);
                // Харагдацын хавтгай дээр тэнцүү (зүсэлтэд харагдацын нормаль дагуу зайтай хомутын олонлог) үед ХАМГИЙН ОЙР ГҮНТЭЙ ширхгийг
                // сонгохын тулд гүнгийн зөрүүг маш бага жинтэй нэмнэ (план дээр GlobalPoint-ийн Z утгагүй ч 1e-6 жин нь 2D зайг хэзээ ч давахгүй).
                if (RfTol.IsFiniteNumber(d) && poly.Count > 0) d += 1e-6 * Math.Abs(frame.DepthOf(RfConv.V(pts[0])) - pickDepth);
                if (RfTol.IsFiniteNumber(d) && (double.IsNaN(best) || d < best)) best = d;
            }
            return best;
        }

        /// <summary>Муруйн нормчилсон параметр (0 = эхлэл, 1 = төгсгөл) дээрх шүргэгч.  Хэт богино муруйг хаяна.</summary>
        private static bool TryTangent(Curve c, double normalizedParam, out RfV3 tangent)
        {
            tangent = new RfV3(0, 0, 0);
            try
            {
                Transform d = c.ComputeDerivatives(normalizedParam, true);
                RfV3 t = RfConv.V(d.BasisX);
                if (t.Length < 1e-9) return false;
                tangent = t.Normalized();
                return RfTol.IsFiniteNumber(tangent.X) && RfTol.IsFiniteNumber(tangent.Y) && RfTol.IsFiniteNumber(tangent.Z);
            }
            catch
            {
                return false;
            }
        }

        private static RfPresentation Map(RebarPresentationMode m)
        {
            switch (m)
            {
                case RebarPresentationMode.FirstLast: return RfPresentation.FirstLast;
                case RebarPresentationMode.Middle: return RfPresentation.Middle;
                case RebarPresentationMode.Select: return RfPresentation.Select;
                default: return RfPresentation.All;
            }
        }
    }

    /// <summary>
    /// Сонгосон элементүүдээс ЗӨВХӨН арматур (<see cref="Rebar"/>)-ыг авна.  Эзэн (дам нуруу, багана…), Area/Path Reinforcement-ийн
    /// арматур, бусад элемент нь арматур биш тул <c>unsupported</c>-д тоологдож алгасагдана — «Сонгосон элемент арматур биш байна.»
    /// </summary>
    internal static class RfRebarCollect
    {
        public static List<Rebar> Resolve(IEnumerable<Element> picked, out int unsupported)
        {
            unsupported = 0;
            var result = new List<Rebar>();
            var seen = new HashSet<long>();
            foreach (Element e in picked)
            {
                if (e == null) continue;
                Rebar r = e as Rebar;
                if (r == null)
                {
                    unsupported++;
                    continue;
                }
                if (seen.Add(r.Id.Value)) result.Add(r);
            }
            return result;
        }
    }
}
