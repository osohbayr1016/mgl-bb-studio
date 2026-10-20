using System;
using System.Collections.Generic;
using System.Linq;
using RevitMcpAddin.Reinforcement.Core;

namespace RevitMcpAddin.Reinforcement.Tests
{
    /// <summary>
    /// Хомутын ирмэгийн семантик (бетон нүүр → дотогш = гишүүний цөм):
    /// <c>outer = centerline − inward·r</c>, <c>inner = centerline + inward·r</c>, r = голч/2.
    /// Жишээ: нүүр → тэнхлэг 30 мм, Ø8 ⇒ гадна 26, дотор 34 (дотор − гадна = 8).
    /// </summary>
    public static class StirrupSpecTests
    {
        private const double Mm = 1.0 / 304.8;
        private const double Eps = 1e-9;

        // ── ЭНЭ тест заавал өнгөрөх ёстой ───────────────────────────────

        [Test]
        public static void Surface_to_centerline_30_dia8_outer26_inner34_on_all_four_sides()
        {
            foreach (RfSide side in new[] { RfSide.Left, RfSide.Right, RfSide.Top, RfSide.Bottom })
            {
                bool positive = side == RfSide.Right || side == RfSide.Top;
                double face = positive ? 150 * Mm : -150 * Mm;
                // Бетон нүүрнээс ДОТОГШ 30 мм дахь хомутын тэнхлэг.
                double center = positive ? face - 30 * Mm : face + 30 * Mm;

                double outer = RfSectionGeometry.EdgePos(side, RfStirrupRef.Outer, center, 8 * Mm);
                double inner = RfSectionGeometry.EdgePos(side, RfStirrupRef.Inner, center, 8 * Mm);
                double outerCover = RfSectionGeometry.Cover(side, face, outer) / Mm;
                double innerCover = RfSectionGeometry.Cover(side, face, inner) / Mm;

                Assert.Near(26, outerCover, Eps, side + " гадна");
                Assert.Near(34, innerCover, Eps, side + " дотор");
                Assert.Near(8, innerCover - outerCover, Eps, side + " дотор − гадна = голч");
                Assert.Near(30, RfSectionGeometry.Cover(side, face, center) / Mm, Eps, side + " тэнхлэг");
            }
        }

        [Test]
        public static void Dia10_centerline25_gives_outer20_inner30()
        {
            double face = 100 * Mm, center = face - 25 * Mm;
            Assert.Near(20, RfSectionGeometry.Cover(RfSide.Right, face, RfSectionGeometry.EdgePos(RfSide.Right, RfStirrupRef.Outer, center, 10 * Mm)) / Mm, Eps);
            Assert.Near(30, RfSectionGeometry.Cover(RfSide.Right, face, RfSectionGeometry.EdgePos(RfSide.Right, RfStirrupRef.Inner, center, 10 * Mm)) / Mm, Eps);
        }

        /// <summary>Эргэсэн гишүүнд ч ижил (гишүүний локал тэнхлэгээр) — planner-ээр бүтнээр нь.</summary>
        [Test]
        public static void Planner_30_dia8_gives_26_and_34_for_any_member_rotation()
        {
            foreach (double deg in new[] { 0.0, 30, 45, 90, 135 })
            {
                foreach (var kv in new[] { new KeyValuePair<RfStirrupRef, double>(RfStirrupRef.Outer, 26), new KeyValuePair<RfStirrupRef, double>(RfStirrupRef.Inner, 34) })
                {
                    RfSectionPlan plan = RfSectionPlanner.Build(Beam(deg * Math.PI / 180, kv.Key, 30, 8));
                    Assert.Eq(4, plan.Dims.Count, deg + "° хэмжээсийн тоо");
                    foreach (RfDimPlan d in plan.Dims)
                        Assert.Near(kv.Value, d.Distance / Mm, 1e-6, deg + "° " + kv.Key + " " + d.Side);
                }
            }
        }

        [Test]
        public static void Planner_unknown_stirrup_diameter_skips_outer_inner_but_allows_centerline()
        {
            foreach (double dia in new[] { 0.0, -5.0, double.NaN })
            {
                RfSectionPlan outer = RfSectionPlanner.Build(Beam(0, RfStirrupRef.Outer, 30, dia));
                Assert.Eq(0, outer.Dims.Count, "dia=" + dia + " гадна → алгасна");
                Assert.True(outer.Warnings.Any(w => w.Code == RfSectionWarn.StirrupDiameterUnknown), "анхааруулга");
                Assert.Eq(1, outer.Warnings.Count(w => w.Code == RfSectionWarn.StirrupDiameterUnknown), "нэг л удаа");

                RfSectionPlan inner = RfSectionPlanner.Build(Beam(0, RfStirrupRef.Inner, 30, dia));
                Assert.Eq(0, inner.Dims.Count);

                RfSectionPlan center = RfSectionPlanner.Build(Beam(0, RfStirrupRef.Center, 30, dia));
                Assert.Eq(4, center.Dims.Count, "тэнхлэг голчоос хамаарахгүй");
                foreach (RfDimPlan d in center.Dims) Assert.Near(30, d.Distance / Mm, 1e-6);
            }
        }

        // ── RebarStyle эхэлж, геометр баталгаажуулна ────────────────────

        [Test]
        public static void Resolve_style_first_geometry_confirms()
        {
            RfClassBasis b;
            Assert.Eq(RfBarClass.Transverse, RfSectionGeometry.Resolve(RfRebarStyle.StirrupTie, RfBarClass.Transverse, out b));
            Assert.Eq(RfClassBasis.Style, b);
            Assert.Eq(RfBarClass.Longitudinal, RfSectionGeometry.Resolve(RfRebarStyle.Standard, RfBarClass.Longitudinal, out b));
            Assert.Eq(RfClassBasis.Style, b);
        }

        [Test]
        public static void Resolve_unknown_style_falls_back_to_geometry()
        {
            RfClassBasis b;
            foreach (RfBarClass g in new[] { RfBarClass.Other, RfBarClass.Transverse, RfBarClass.Longitudinal })
            {
                Assert.Eq(g, RfSectionGeometry.Resolve(RfRebarStyle.Unknown, g, out b));
                Assert.Eq(RfClassBasis.Geometry, b);
            }
        }

        [Test]
        public static void Resolve_standard_style_loop_is_tag_only_stirrup_tie_longitudinal_is_skipped()
        {
            RfClassBasis b;
            // Standard боловч хомут шиг хавтгай гогцоо (бөгж Standard shape-ээр) ⇒ гогцоо хэвээр, гэхдээ ЗӨВХӨН tag (StandardLoop).
            Assert.Eq(RfBarClass.Transverse, RfSectionGeometry.Resolve(RfRebarStyle.Standard, RfBarClass.Transverse, out b));
            Assert.Eq(RfClassBasis.StandardLoop, b);
            // Stirrup/Tie боловч огтлолын нормалиар урсах (уртааш) ⇒ таамаглахгүй, алгасна.
            Assert.Eq(RfBarClass.Other, RfSectionGeometry.Resolve(RfRebarStyle.StirrupTie, RfBarClass.Longitudinal, out b));
            Assert.Eq(RfClassBasis.Mismatch, b);
        }

        [Test]
        public static void Tag_only_loop_is_tagged_but_never_dimensioned()
        {
            RfSectionInput input = Beam(0, RfStirrupRef.Outer, 30, 8);
            input.Stirrups[0].TagOnly = true;
            input.Options.TagStirrups = true;
            RfSectionPlan plan = RfSectionPlanner.Build(input);
            Assert.Eq(0, plan.Dims.Count, "Standard style ⇒ хэмжээс ХЭЗЭЭ Ч үгүй");
            Assert.Eq(1, plan.Tags.Count(t => t.IsStirrup), "гэхдээ tag-лана");
            Assert.True(plan.Warnings.Any(w => w.Code == RfSectionWarn.NoStirrup), "хэмжээс тавигдахгүй гэж анхааруулна");
        }

        [Test]
        public static void Tag_only_loop_does_not_hide_a_real_stirrup_from_dimensions()
        {
            // Нэг Standard гогцоо (бөгж) + нэг StirrupTie хомут (гаднах). Хэмжээс зөвхөн StirrupTie-ээс.
            RfSectionInput input = Beam(0, RfStirrupRef.Outer, 30, 8);
            RfSectionInput inner = Beam(0, RfStirrupRef.Outer, 80, 8);
            RfBarSample ring = inner.Stirrups[0];
            ring.Id = 78;
            ring.TagOnly = true;
            input.Stirrups.Add(ring);
            RfSectionPlan plan = RfSectionPlanner.Build(input);
            Assert.Eq(4, plan.Dims.Count);
            Assert.True(plan.Dims.All(d => d.StirrupId == 77), "хэмжээс бүгд StirrupTie (id 77)-д");
            foreach (RfDimPlan d in plan.Dims) Assert.Near(26, d.Distance / Mm, 1e-6);
        }

        [Test]
        public static void Empty_group_key_never_merges_distinct_rebar_elements()
        {
            // Rebar Number байхгүй (түлхүүр хоосон) ⇒ ижил төрөл/голчтой ч элемент бүр өөрийн tag-тай: tag тоо дутуу харуулахгүй.
            RfSectionInput input = Beam(0, RfStirrupRef.Outer, 30, 8);
            input.Options.TagLongitudinal = true;
            input.Longitudinal.Add(new RfLongBar { Id = 11, Pos = new RfV2(-80 * Mm, -200 * Mm), Diameter = 20 * Mm, Group = "" });
            input.Longitudinal.Add(new RfLongBar { Id = 12, Pos = new RfV2(0, -200 * Mm), Diameter = 20 * Mm, Group = "" });
            input.Longitudinal.Add(new RfLongBar { Id = 13, Pos = new RfV2(80 * Mm, -200 * Mm), Diameter = 20 * Mm, Group = "" });
            input.Options.GroupTags = true;
            RfSectionPlan plan = RfSectionPlanner.Build(input);
            Assert.Eq(3, plan.Tags.Count(t => !t.IsStirrup));
        }

        [Test]
        public static void Resolve_geometry_other_stays_other_for_any_style()
        {
            RfClassBasis b;
            foreach (RfRebarStyle s in new[] { RfRebarStyle.Standard, RfRebarStyle.StirrupTie })
            {
                Assert.Eq(RfBarClass.Other, RfSectionGeometry.Resolve(s, RfBarClass.Other, out b));
                Assert.Eq(RfClassBasis.Style, b, "огтлолд хамаагүй (өөр чиглэлийн хомут) — зөрүү биш");
            }
        }

        // ── Tag бүлэглэл ────────────────────────────────────────────────

        [Test]
        public static void Tag_group_key_rounds_diameter_and_is_deterministic()
        {
            string a = RfSectionGeometry.BarGroupKey(12, 16 * Mm, 5);
            Assert.Eq(a, RfSectionGeometry.BarGroupKey(12, 16.0000001 * Mm, 5), "хөвөгч цэгийн шуугиан");
            Assert.Eq(a, RfSectionGeometry.BarGroupKey(12, 15.9999999 * Mm, 5));
            Assert.True(a != RfSectionGeometry.BarGroupKey(12, 18 * Mm, 5), "өөр голч");
            Assert.True(a != RfSectionGeometry.BarGroupKey(13, 16 * Mm, 5), "өөр төрөл");
            Assert.True(a != RfSectionGeometry.BarGroupKey(12, 16 * Mm, 6), "өөр shape");
            Assert.Eq("12|1600|5", a);
        }

        [Test]
        public static void NearestSide_prefers_fixed_order_on_ties()
        {
            var rect = new RfSectionRect { MinU = -100 * Mm, MaxU = 100 * Mm, MinV = -100 * Mm, MaxV = 100 * Mm };
            Assert.Eq(RfSide.Bottom, RfSectionGeometry.NearestSide(new RfV2(0, -90 * Mm), rect));
            Assert.Eq(RfSide.Top, RfSectionGeometry.NearestSide(new RfV2(0, 90 * Mm), rect));
            Assert.Eq(RfSide.Left, RfSectionGeometry.NearestSide(new RfV2(-90 * Mm, 0), rect));
            Assert.Eq(RfSide.Right, RfSectionGeometry.NearestSide(new RfV2(90 * Mm, 0), rect));
            // Булан (хоёр талд тэнцүү): Доод > Дээд > Зүүн > Баруун
            Assert.Eq(RfSide.Bottom, RfSectionGeometry.NearestSide(new RfV2(-90 * Mm, -90 * Mm), rect));
            Assert.Eq(RfSide.Bottom, RfSectionGeometry.NearestSide(new RfV2(90 * Mm, -90 * Mm), rect));
            Assert.Eq(RfSide.Top, RfSectionGeometry.NearestSide(new RfV2(-90 * Mm, 90 * Mm), rect));
            Assert.Eq(RfSide.Top, RfSectionGeometry.NearestSide(new RfV2(90 * Mm, 90 * Mm), rect));
        }

        [Test]
        public static void Grouped_tags_one_per_type_diameter_side_group()
        {
            RfSectionInput input = BeamWithBars();
            input.Options.GroupTags = true;
            RfSectionPlan plan = RfSectionPlanner.Build(input);
            List<RfTagPlan> longTags = plan.Tags.Where(t => !t.IsStirrup).ToList();
            // Доод Ø20 ×3, дээд Ø16 ×2, зүүн талын Ø12 ×1 ⇒ гурван бүлэг.
            Assert.Eq(3, longTags.Count, "бүлэг бүрд нэг tag");
            Assert.Eq(6, longTags.Sum(t => t.GroupCount), "бүх 6 арматур тоологдсон");
            Assert.True(longTags.Any(t => t.GroupCount == 3) && longTags.Any(t => t.GroupCount == 2) && longTags.Any(t => t.GroupCount == 1));
        }

        [Test]
        public static void Ungrouped_tags_one_per_rebar_element()
        {
            RfSectionInput input = BeamWithBars();
            input.Options.GroupTags = false;
            RfSectionPlan plan = RfSectionPlanner.Build(input);
            Assert.Eq(6, plan.Tags.Count(t => !t.IsStirrup), "элемент бүр өөрийн tag");
            Assert.True(plan.Tags.Where(t => !t.IsStirrup).All(t => t.GroupCount == 1));
        }

        [Test]
        public static void Grouped_layout_is_deterministic_regardless_of_input_order()
        {
            RfSectionInput a = BeamWithBars();
            RfSectionInput b = BeamWithBars();
            b.Longitudinal.Reverse();
            RfSectionPlan pa = RfSectionPlanner.Build(a), pb = RfSectionPlanner.Build(b);
            Func<RfSectionPlan, string> sig = p => string.Join(";", p.Tags.Where(t => !t.IsStirrup)
                .OrderBy(t => t.Id).ThenBy(t => t.BarIndex)
                .Select(t => t.Id + "/" + t.BarIndex + "/" + t.GroupCount + "@" + Math.Round(t.Head.X / Mm, 3) + "," + Math.Round(t.Head.Y / Mm, 3)));
            Assert.Eq(sig(pa), sig(pb), "тогтмол layout");
            RfSectionPlan again = RfSectionPlanner.Build(BeamWithBars());
            Assert.Eq(sig(pa), sig(again), "дахин ажиллуулахад ижил");
        }

        [Test]
        public static void Grouped_tag_representative_is_bar_nearest_group_centroid()
        {
            RfSectionInput input = BeamWithBars();
            RfSectionPlan plan = RfSectionPlanner.Build(input);
            // Доод Ø20: u = −80, 0, +80 ⇒ төвд ойр нь дунд (id 12).
            RfTagPlan bottom = plan.Tags.First(t => !t.IsStirrup && t.GroupCount == 3);
            Assert.Eq(12L, bottom.Id);
        }

        // ── Туслах ──────────────────────────────────────────────────────

        private static RfV2 Rot(double theta, double x, double y)
        {
            return new RfV2(x * Math.Cos(theta) - y * Math.Sin(theta), x * Math.Sin(theta) + y * Math.Cos(theta));
        }

        private static RfViewFrame PlanView()
        {
            return new RfViewFrame(new RfV3(0, 0, 0), new RfV3(1, 0, 0), new RfV3(0, 1, 0), new RfV3(0, 0, 1));
        }

        private static List<RfFaceSample> Faces(double wMm, double hMm, double theta)
        {
            RfV2 u = Rot(theta, 1, 0), v = Rot(theta, 0, 1);
            double w = wMm * Mm, h = hMm * Mm, len = 3000 * Mm;
            RfV2 c = new RfV2(0, 0);
            return new List<RfFaceSample>
            {
                new RfFaceSample { Id = 1, Origin = c - u * (w / 2), Normal = -u, Area = h * len },
                new RfFaceSample { Id = 2, Origin = c + u * (w / 2), Normal = u, Area = h * len },
                new RfFaceSample { Id = 3, Origin = c - v * (h / 2), Normal = -v, Area = w * len },
                new RfFaceSample { Id = 4, Origin = c + v * (h / 2), Normal = v, Area = w * len },
            };
        }

        /// <summary>300×500 дам нуруу (θ-ээр эргэсэн), хомутын тэнхлэг нүүрнээс <paramref name="centerlineMm"/> дотогш.</summary>
        private static RfSectionInput Beam(double theta, RfStirrupRef r, double centerlineMm, double diaMm)
        {
            var input = new RfSectionInput { View = PlanView() };
            input.Faces.AddRange(Faces(300, 500, theta));
            var s = new RfBarSample { Id = 77, BarIndex = 0, Diameter = diaMm * Mm };
            double hw = (300.0 / 2 - centerlineMm) * Mm, hh = (500.0 / 2 - centerlineMm) * Mm;
            double[][] k = { new[] { -hw, -hh }, new[] { hw, -hh }, new[] { hw, hh }, new[] { -hw, hh }, new[] { -hw, -hh } };
            foreach (double[] q in k)
            {
                RfV2 p = Rot(theta, q[0], q[1]);
                s.Points.Add(new RfV3(p.X, p.Y, 0));
            }
            input.Stirrups.Add(s);
            input.Options.Ref = r;
            input.Options.DimOffsetFt = 100 * Mm;
            input.Options.TagLongitudinal = false;
            input.Options.TagStirrups = false;
            return input;
        }

        private static RfSectionInput BeamWithBars()
        {
            RfSectionInput input = Beam(0, RfStirrupRef.Outer, 30, 8);
            input.Options.TagLongitudinal = true;
            string g20 = RfSectionGeometry.BarGroupKey(1, 20 * Mm, 5);
            string g16 = RfSectionGeometry.BarGroupKey(2, 16 * Mm, 5);
            string g12 = RfSectionGeometry.BarGroupKey(3, 12 * Mm, 5);
            input.Longitudinal.Add(new RfLongBar { Id = 11, Pos = new RfV2(-80 * Mm, -200 * Mm), Diameter = 20 * Mm, Group = g20 });
            input.Longitudinal.Add(new RfLongBar { Id = 12, Pos = new RfV2(0, -200 * Mm), Diameter = 20 * Mm, Group = g20 });
            input.Longitudinal.Add(new RfLongBar { Id = 13, Pos = new RfV2(80 * Mm, -200 * Mm), Diameter = 20 * Mm, Group = g20 });
            input.Longitudinal.Add(new RfLongBar { Id = 21, Pos = new RfV2(-80 * Mm, 200 * Mm), Diameter = 16 * Mm, Group = g16 });
            input.Longitudinal.Add(new RfLongBar { Id = 22, Pos = new RfV2(80 * Mm, 200 * Mm), Diameter = 16 * Mm, Group = g16 });
            input.Longitudinal.Add(new RfLongBar { Id = 31, Pos = new RfV2(-120 * Mm, 0), Diameter = 12 * Mm, Group = g12 });
            return input;
        }
    }
}
