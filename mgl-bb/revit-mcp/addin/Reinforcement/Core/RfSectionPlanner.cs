using System;
using System.Collections.Generic;
using System.Linq;

namespace RevitMcpAddin.Reinforcement.Core
{
    /// <summary>
    /// «Огтлолын арматурын тэмдэглэгээ»-ний ТӨЛӨВЛӨГЧ: Model Geometry → Analyze → <b>SectionAnnotationPlan</b> →
    /// Validate → Render.  Энэ нь ЦЭВЭР: Revit-ээс уншсан өгөгдлөөс (нүүр, арматурын цэг, сонголт) юу үүсгэхийг
    /// дүрсэлсэн <see cref="RfSectionPlan"/> гаргана; Revit-д юу ч бичихгүй, Revit-ийн объект ашиглахгүй.
    /// Тиймээс тест хийх, урьдчилан харах (preview), render-ийг солих боломжтой.
    /// </summary>
    public static class RfSectionPlanner
    {
        public static RfSectionPlan Build(RfSectionInput input)
        {
            var plan = new RfSectionPlan();
            RfSectionOptions o = input.Options;

            if (input.Faces.Count == 0)
            {
                plan.Warn(RfSectionWarn.NoFaces);
                return plan;
            }

            // 1. Локал тэнхлэг + бетон хүрээ
            bool rectangular;
            RfSectionFrame frame = RfSectionGeometry.DetectFrame(input.Faces, out rectangular);
            if (!rectangular) plan.Warn(RfSectionWarn.NotRectangular);
            RfSectionRect rect = RfSectionGeometry.Outline(input.Faces, frame);
            List<RfSide> missingSides = RfSectionGeometry.FillMissing(ref rect, input.Faces, frame);
            if (!rect.Valid)
            {
                // Нүүрний нормаль дотогш заасан (зарим mirror/эргэлттэй family) бол Зүүн/Баруун, Дээд/Доод солигдож
                // хүрээ сөрөг болно — нормалуудыг эргүүлж ДАХИН оролдоно.  Дахин ч буруу бол хоосон plan.
                var flipped = input.Faces.Select(f => f.Clone(true)).ToList();
                RfSectionFrame f2 = RfSectionGeometry.DetectFrame(flipped, out rectangular);
                RfSectionRect r2 = RfSectionGeometry.Outline(flipped, f2);
                List<RfSide> m2 = RfSectionGeometry.FillMissing(ref r2, flipped, f2);
                if (r2.Valid)
                {
                    frame = f2;
                    rect = r2;
                    missingSides = m2;
                }
            }
            foreach (RfSide missing in missingSides)
                plan.Warn(RfSectionWarn.HostFaceMissing, missing.ToString());
            plan.Frame = frame;
            plan.Rect = rect;
            if (!rect.Valid) return plan;

            // 2. Хомут
            foreach (RfBarSample s in input.Stirrups)
                plan.Loops.Add(RfSectionGeometry.LoopOf(s, input.View, frame));
            bool needStirrups = o.DoDimensions || o.TagStirrups;
            // Хэмжээс ЗӨВХӨН Stirrup/Tie style-тай хомутод (Standard style-тай гогцоо = зөвхөн tag).
            List<RfStirrupLoop> dimLoops = plan.Loops.Where(l => !l.TagOnly).ToList();
            if (plan.Loops.Count == 0 && needStirrups) plan.Warn(RfSectionWarn.NoStirrup);
            else if (dimLoops.Count == 0 && o.DoDimensions) plan.Warn(RfSectionWarn.NoStirrup);
            else if (DistinctLoops(dimLoops) > 1 && o.DoDimensions) plan.Warn(RfSectionWarn.ManyStirrups);

            // 3. Ажлын арматур (локал координатад)
            foreach (RfLongBar b in input.Longitudinal)
            {
                plan.Bars.Add(new RfLongBar
                {
                    Id = b.Id,
                    BarIndex = b.BarIndex,
                    Pos = frame.ToLocal(b.Pos),
                    Diameter = b.Diameter,
                    Group = b.Group,
                });
            }
            if (plan.Bars.Count == 0 && o.TagLongitudinal) plan.Warn(RfSectionWarn.NoLongitudinal);

            // 4. Хомутын хэмжээс
            if (o.DoDimensions && dimLoops.Count > 0)
            {
                bool diaWarned = false;
                foreach (RfSide side in new[] { RfSide.Left, RfSide.Right, RfSide.Top, RfSide.Bottom })
                {
                    if (!o.Wants(side)) continue;
                    int faceId = rect.FaceOf(side);
                    if (faceId < 0) continue; // нүүр олдоогүй — анхааруулга аль хэдийн гарсан

                    // Энэ талд огтлолыг хөвсөн ӨӨР байрлалтай хоёр параллель нүүр бол (T/L хэлбэр, ховил) аль нь хомуттай харьцуулах бетон гэдэг
                    // тодорхойгүй — буруу «хамгаалалтын давхарга» зурахын оронд алгасна.
                    if (rect.IsAmbiguous(side))
                    {
                        plan.Warn(RfSectionWarn.HostFaceAmbiguous, side.ToString());
                        continue;
                    }

                    // Тал дээр хилийн дагуу бодит шулуун арматур (≥ 50%) байгаа хомутуудаас л сонгоно: U хэлбэр, ромб, нээлттэй тал дээр
                    // хүрээний хайрцаг ХУДАЛ «ирмэг» зохиодог.
                    List<RfStirrupLoop> sideLoops = dimLoops.Where(l => l.CoverOf(side) >= RfSectionGeometry.MinSideCoverage).ToList();
                    RfStirrupLoop loop = RfSectionGeometry.Outermost(sideLoops, side);
                    if (loop == null)
                    {
                        plan.Warn(sideLoops.Count == 0 && RfSectionGeometry.Outermost(dimLoops, side) != null
                            ? RfSectionWarn.StirrupSideOpen : RfSectionWarn.StirrupSideMissing, side.ToString());
                        continue;
                    }

                    // Голч мэдэгдэхгүй (0/сөрөг/NaN) бол «гадна/дотор ирмэг» = тэнхлэг болж ЧИМЭЭГҮЙ буруу хэмжээс гарна — алгасна.
                    if (o.Ref != RfStirrupRef.Center && !(loop.Diameter > 0 && RfTol.IsFiniteNumber(loop.Diameter)))
                    {
                        if (!diaWarned) plan.Warn(RfSectionWarn.StirrupDiameterUnknown);
                        diaWarned = true;
                        continue;
                    }

                    double edge = RfSectionGeometry.EdgePos(side, o.Ref, loop.Extent(side), loop.Diameter);
                    double facePos = rect.FacePos(side);
                    double dist = RfSectionGeometry.Cover(side, facePos, edge);
                    if (dist < -RfTol.DimMatchFt)
                    {
                        plan.Warn(RfSectionWarn.StirrupOutsideConcrete, side.ToString());
                        continue;
                    }

                    var d = new RfDimPlan
                    {
                        Side = side,
                        Ref = o.Ref,
                        FacePos = facePos,
                        EdgePos = edge,
                        Distance = Math.Max(0, dist),
                        FaceId = faceId,
                        StirrupId = loop.Id,
                        StirrupBarIndex = loop.BarIndex,
                        StirrupDiameter = loop.Diameter,
                    };
                    // Шугамын тал = хэрэглэгчийн сонголт (хэвтээ: Дээд/Доод, босоо: Баруун/Зүүн), зай = гишүүний тэр ирмэгээс.
                    d.LinePos = RfSectionOptions.OutsideLine(rect, o.DimSideFor(d.AlongU), o.DimOffsetFt);
                    if (d.AlongU)
                    {
                        d.EdgeSpanMin = loop.MinV;
                        d.EdgeSpanMax = loop.MaxV;
                    }
                    else
                    {
                        d.EdgeSpanMin = loop.MinU;
                        d.EdgeSpanMax = loop.MaxU;
                    }
                    plan.Dims.Add(d);
                }
            }

            // 4b. Гинжин хэмжээс: тэнхлэг бүрт ЯГ НЭГ (нүүр → хомут → хомут → нүүр), лавлагаа байрлалаар эрэмбэлэгдсэн.
            plan.Chains.AddRange(RfDimChains.Build(plan.Dims, RfTol.DimMatchFt));

            // «4 талд»: ижил гинжийг эсрэг талд ч (ижил лавлагаа, ижил зай) — ерөнхий хэмжээсийн «Барилгын 4 талд»-тай адил.
            if (o.DoDimensions && o.DimAllSides)
            {
                foreach (RfDimChain c in plan.Chains.ToList())
                {
                    var mirror = new RfDimChain
                    {
                        AlongU = c.AlongU,
                        LinePos = RfSectionOptions.OutsideLine(rect, RfSectionOptions.Opposite(o.DimSideFor(c.AlongU)), o.DimOffsetFt),
                    };
                    mirror.Refs.AddRange(c.Refs);
                    mirror.Coincident.AddRange(c.Coincident);
                    plan.Chains.Add(mirror);
                }
            }

            // 4c. Гишүүний хэмжээс — тэнхлэг, хучилт, ханатай уялдсан гадна гинж («150 | 150», «170 | 330»).
            if (o.MemberDims)
                plan.MemberChains.AddRange(RfMemberDims.Build(rect, frame, input.Aux, plan.Chains, o, plan.Warnings));

            // 5. Tag
            var seeds = new List<RfTagPlan>();
            if (o.TagLongitudinal)
            {
                // Бүлэг = ижил төрөл/голч/shape + гишүүний ижил тал (GroupTags асаалттай үед), үгүй бол элемент бүр.  Бүлэг бүрд НЭГ tag —
                // «4Ø16» маягийн ижил арматурт tag-ийн үер үүсгэхгүй.  Дараалал ТОГТМОЛ (түлхүүрээр) — ажиллуулалт бүрд ижил layout.
                // SingleTagPerSet: нэг элементийн (олонлогийн) бүх ширхгийн төв — гишүүний тал олонлог бүрд ГАНЦ байхын тулд.
                Dictionary<long, RfV2> setCentre = null;
                if (o.SingleTagPerSet)
                {
                    setCentre = new Dictionary<long, RfV2>();
                    foreach (IGrouping<long, RfLongBar> sg in plan.Bars.GroupBy(b => b.Id))
                        setCentre[sg.Key] = new RfV2(sg.Average(b => b.Pos.X), sg.Average(b => b.Pos.Y));
                }
                foreach (IGrouping<string, RfLongBar> g in plan.Bars
                    .GroupBy(b => RfSectionGeometry.TagGroupKey(b, rect, o.GroupTags, setCentre == null ? (RfV2?)null : setCentre[b.Id]))
                    .OrderBy(x => x.Key, StringComparer.Ordinal))
                {
                    List<RfLongBar> bars = g.ToList();
                    RfV2 centroid = new RfV2(bars.Average(b => b.Pos.X), bars.Average(b => b.Pos.Y));
                    // Leader заах цэг: арматурын жинхэнэ ширхгүүдээс бүлгийн төвд хамгийн ойр нь (тэнцүү бол id, ширхгийн индексээр).
                    RfLongBar pick = bars.OrderBy(b => (b.Pos - centroid).Length).ThenBy(b => b.Id).ThenBy(b => b.BarIndex).First();
                    var seed = new RfTagPlan
                    {
                        Id = pick.Id,
                        BarIndex = pick.BarIndex,
                        Target = pick.Pos,
                        IsStirrup = false,
                        GroupCount = bars.Select(b => b.Id).Distinct().Count(),
                    };
                    // Multi-leader: ГАНЦ элементийн (олонлогийн) бүх ширхгийг нэг шошгонд — ширхгийн индексээр эрэмбэлж, ижил байрлалыг нэгтгэнэ.
                    if (o.SingleTagPerSet && o.MultiLeaderPerSet && seed.GroupCount == 1)
                    {
                        foreach (RfLongBar b in bars.OrderBy(x => x.BarIndex).Take(RfSectionOptions.MaxLeadersPerTag))
                        {
                            seed.BarIndices.Add(b.BarIndex);
                            seed.BarTargets.Add(b.Pos);
                        }
                        if (seed.BarIndices.Count < 2)
                        {
                            seed.BarIndices.Clear();
                            seed.BarTargets.Clear();
                        }
                    }
                    seeds.Add(seed);
                }
            }
            if (o.TagStirrups)
            {
                var seen = new HashSet<long>();
                foreach (RfStirrupLoop l in plan.Loops.OrderByDescending(l => (l.MaxU - l.MinU) * (l.MaxV - l.MinV)))
                {
                    if (!seen.Add(l.Id)) continue;
                    // Хомутыг баруун талын голын шугамын дундаас tag-лана.
                    seeds.Add(new RfTagPlan
                    {
                        Id = l.Id,
                        BarIndex = l.BarIndex,
                        IsStirrup = true,
                        Target = new RfV2(l.MaxU, (l.MinV + l.MaxV) / 2),
                    });
                }
            }

            if (seeds.Count > 0)
            {
                // Хэмжээсийн шугамууд хэрэглэгчийн сонгосон талд (хэвтээ: Дээд/Доод, босоо: Баруун/Зүүн) — тэр талын tag-ийг ХАМГИЙН ГАДНА
                // шугамаас цааш гаргана (хомутын гинж + гишүүний гадна гинж).
                var extra = new Dictionary<RfSide, double>();
                Action<bool, double> take = (alongU, line) =>
                {
                    RfSide s = RfSectionOptions.SideOfLine(rect, alongU, line);
                    double beyond = Math.Abs(line - rect.FacePos(s)) + o.TagGapFt;
                    double cur;
                    if (!extra.TryGetValue(s, out cur) || beyond > cur) extra[s] = beyond;
                };
                foreach (RfDimPlan d in plan.Dims) take(d.AlongU, d.LinePos);
                foreach (RfDimChain dc in plan.Chains) take(dc.AlongU, dc.LinePos);   // «4 талд»-ын эсрэг талын гинж
                foreach (RfMemberChain m in plan.MemberChains) take(m.AlongU, m.LinePos);
                Func<RfSide, double> ex = s => { double v; return extra.TryGetValue(s, out v) ? v : 0; };
                bool overlap;
                plan.Tags.AddRange(RfSectionLayout.LayoutTags(rect, frame, seeds, o, ex(RfSide.Top), ex(RfSide.Right), ex(RfSide.Bottom), ex(RfSide.Left), out overlap));
                if (overlap) plan.Warn(RfSectionWarn.TagOverlapRemains);
            }
            return plan;
        }

        /// <summary>Ялгаатай (хүрээ нь 0.1 мм-ээс их зөрсөн) хомутын гогцооны тоо.</summary>
        public static int DistinctLoops(IList<RfStirrupLoop> loops)
        {
            var kept = new List<RfStirrupLoop>();
            foreach (RfStirrupLoop l in loops)
            {
                bool dup = kept.Any(k =>
                    Math.Abs(k.MinU - l.MinU) < 3e-4 && Math.Abs(k.MaxU - l.MaxU) < 3e-4 &&
                    Math.Abs(k.MinV - l.MinV) < 3e-4 && Math.Abs(k.MaxV - l.MaxV) < 3e-4);
                if (!dup) kept.Add(l);
            }
            return kept.Count;
        }
    }
}
