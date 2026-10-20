using System;
using System.Collections.Generic;
using System.Linq;
using RevitMcpAddin.Reinforcement.Core;

namespace RevitMcpAddin.Reinforcement.Tests
{
    /// <summary>
    /// Хоёр дахь шатны аудит (2026-10-02): огтлолын тэмдэглэгээний «буруу хэмжээс тавихгүй» хамгаалалтууд —
    /// огтлолыг хөвөөгүй нүүр, хоёрдмол нүүр (T/L), нээлттэй хомут (U/ромб), tag-ийн Partition түлхүүр.
    /// </summary>
    public static class SectionAuditTests
    {
        private const double Mm = 1.0 / 304.8;

        private static RfViewFrame PlanView()
        {
            return new RfViewFrame(new RfV3(0, 0, 0), new RfV3(1, 0, 0), new RfV3(0, 1, 0), new RfV3(0, 0, 1));
        }

        /// <summary>300×500 тэгш өнцөгт дам нурууны нүүр: 1 Зүүн, 2 Баруун, 3 Доод, 4 Дээд — төв (0,0).</summary>
        private static List<RfFaceSample> BeamFaces()
        {
            double hw = 150 * Mm, hh = 250 * Mm, len = 3000 * Mm;
            return new List<RfFaceSample>
            {
                new RfFaceSample { Id = 1, Origin = new RfV2(-hw, 0), Normal = new RfV2(-1, 0), Area = 2 * hh * len },
                new RfFaceSample { Id = 2, Origin = new RfV2(hw, 0), Normal = new RfV2(1, 0), Area = 2 * hh * len },
                new RfFaceSample { Id = 3, Origin = new RfV2(0, -hh), Normal = new RfV2(0, -1), Area = 2 * hw * len },
                new RfFaceSample { Id = 4, Origin = new RfV2(0, hh), Normal = new RfV2(0, 1), Area = 2 * hw * len },
            };
        }

        private static RfBarSample Points(long id, double dia, params double[][] ptsMm)
        {
            var s = new RfBarSample { Id = id, BarIndex = 0, Diameter = dia * Mm };
            foreach (double[] p in ptsMm) s.Points.Add(new RfV3(p[0] * Mm, p[1] * Mm, 0));
            return s;
        }

        /// <summary>Хаалттай тэгш өнцөгт хомут (голын шугам ±hw × ±hh).</summary>
        private static RfBarSample ClosedStirrup(long id, double hwMm, double hhMm)
        {
            return Points(id, 10,
                new[] { -hwMm, -hhMm }, new[] { hwMm, -hhMm }, new[] { hwMm, hhMm }, new[] { -hwMm, hhMm }, new[] { -hwMm, -hhMm });
        }

        private static RfSectionPlan Plan(IEnumerable<RfFaceSample> faces, params RfBarSample[] stirrups)
        {
            var input = new RfSectionInput { View = PlanView() };
            input.Faces.AddRange(faces);
            input.Stirrups.AddRange(stirrups);
            input.Options.Ref = RfStirrupRef.Center;
            input.Options.DimOffsetFt = 100 * Mm;
            input.Options.TagLongitudinal = false;
            input.Options.TagStirrups = false;
            return RfSectionPlanner.Build(input);
        }

        private static bool Warned(RfSectionPlan p, RfSectionWarn code, string arg)
        {
            return p.Warnings.Any(w => w.Code == code && w.Arg == arg);
        }

        // ── Огтлолыг хөвөөгүй нүүр ─────────────────────────────────────

        [Test]
        public static void Face_off_the_cut_plane_is_not_the_concrete_boundary()
        {
            // Дам нуруу огтлолын хавтгайд 300 өргөнтэй; 2 м цаана 400 өргөн болж тэлсэн (haunch) — тэр станцын нүүр хавтгайг ХӨВӨӨГҮЙ.
            List<RfFaceSample> faces = BeamFaces();
            faces.Add(new RfFaceSample
            {
                Id = 9, Origin = new RfV2(200 * Mm, 0), Normal = new RfV2(1, 0), Area = 500 * Mm * 1000 * Mm,
                DepthMin = 2000 * Mm, DepthMax = 3000 * Mm,
            });
            RfSectionRect r = RfSectionGeometry.Outline(faces, RfSectionFrame.Identity);
            Assert.Near(150 * Mm, r.MaxU, 1e-9, "хамгийн гадна нь тэлсэн станцын нүүр биш");
            Assert.Eq(2, r.FaceRight);
            Assert.False(r.AmbiguousRight, "хөвөөгүй нүүр хоёрдмол байдал үүсгэхгүй");
        }

        [Test]
        public static void Faces_with_unknown_depth_behave_as_before()
        {
            RfSectionRect r = RfSectionGeometry.Outline(BeamFaces(), RfSectionFrame.Identity);
            Assert.Near(300 * Mm, r.Width, 1e-9);
            Assert.False(r.AmbiguousLeft || r.AmbiguousRight || r.AmbiguousTop || r.AmbiguousBottom);
        }

        [Test]
        public static void Face_that_straddles_the_cut_is_used()
        {
            List<RfFaceSample> faces = BeamFaces();
            foreach (RfFaceSample f in faces) { f.DepthMin = -1500 * Mm; f.DepthMax = 1500 * Mm; }
            Assert.True(faces.All(f => f.StraddlesCutPlane));
            RfSectionRect r = RfSectionGeometry.Outline(faces, RfSectionFrame.Identity);
            Assert.Eq(1, r.FaceLeft);
            Assert.Eq(2, r.FaceRight);
        }

        [Test]
        public static void Face_ending_exactly_at_the_plane_within_1mm_still_counts()
        {
            var f = new RfFaceSample { DepthMin = 0.5 * Mm, DepthMax = 800 * Mm };
            Assert.True(f.StraddlesCutPlane, "0.5 мм хүртэл хүлцэнэ");
            f.DepthMin = 5 * Mm;
            Assert.False(f.StraddlesCutPlane);
        }

        // ── Хоёрдмол (T/L) нүүр ────────────────────────────────────────

        [Test]
        public static void T_shape_two_right_faces_across_the_cut_is_ambiguous_and_skipped()
        {
            List<RfFaceSample> faces = BeamFaces();
            // Хөвөө (flange) нь баруун тийш 300 мм гарсан: огтлолыг хөвсөн хоёр баруун нүүр (150 ба 300).
            faces.Add(new RfFaceSample { Id = 8, Origin = new RfV2(300 * Mm, 150 * Mm), Normal = new RfV2(1, 0), Area = 100 * Mm * 3000 * Mm });
            RfSectionRect r = RfSectionGeometry.Outline(faces, RfSectionFrame.Identity);
            Assert.True(r.AmbiguousRight);
            Assert.False(r.AmbiguousLeft);

            RfSectionPlan plan = Plan(faces, ClosedStirrup(1, 110, 210));
            Assert.True(Warned(plan, RfSectionWarn.HostFaceAmbiguous, "Right"), "Баруун тал ХОЁРДМОЛ гэж анхааруулна");
            Assert.False(plan.Dims.Any(d => d.Side == RfSide.Right), "хоёрдмол талд хэмжээс тавихгүй");
            Assert.True(plan.Dims.Any(d => d.Side == RfSide.Left), "бусад тал хэвийн");
        }

        [Test]
        public static void Rebate_on_the_top_is_ambiguous_but_clean_sides_still_dimension()
        {
            List<RfFaceSample> faces = BeamFaces();
            faces.Add(new RfFaceSample { Id = 8, Origin = new RfV2(0, 200 * Mm), Normal = new RfV2(0, 1), Area = 50 * Mm * 3000 * Mm });
            RfSectionPlan plan = Plan(faces, ClosedStirrup(1, 110, 210));
            Assert.True(Warned(plan, RfSectionWarn.HostFaceAmbiguous, "Top"));
            Assert.Eq(3, plan.Dims.Count);
        }

        // ── Нээлттэй хомут ─────────────────────────────────────────────

        [Test]
        public static void Closed_rectangle_has_full_coverage_on_every_side()
        {
            RfStirrupLoop l = RfSectionGeometry.LoopOf(ClosedStirrup(1, 110, 210), PlanView(), RfSectionFrame.Identity);
            foreach (RfSide s in new[] { RfSide.Left, RfSide.Right, RfSide.Top, RfSide.Bottom })
                Assert.Near(1.0, l.CoverOf(s), 1e-6, s.ToString());
        }

        [Test]
        public static void U_stirrup_open_side_has_zero_coverage_and_gets_no_dimension()
        {
            // U хэлбэр, зүүн тал нээлттэй: (-110,210) → (110,210) → (110,-210) → (-110,-210)  (Зүүн босоо хэрчим БАЙХГҮЙ).
            RfBarSample u = Points(1, 10, new[] { -110.0, 210 }, new[] { 110.0, 210 }, new[] { 110.0, -210 }, new[] { -110.0, -210 });
            RfStirrupLoop l = RfSectionGeometry.LoopOf(u, PlanView(), RfSectionFrame.Identity);
            Assert.Near(0.0, l.CoverLeft, 1e-6, "нээлттэй тал");
            Assert.Near(1.0, l.CoverRight, 1e-6);
            Assert.Near(1.0, l.CoverTop, 1e-6);
            Assert.Near(1.0, l.CoverBottom, 1e-6);

            RfSectionPlan plan = Plan(BeamFaces(), u);
            Assert.False(plan.Dims.Any(d => d.Side == RfSide.Left), "хүрээний хайрцгаар ХУДАЛ ирмэг зохиохгүй");
            Assert.True(Warned(plan, RfSectionWarn.StirrupSideOpen, "Left"));
            Assert.Eq(3, plan.Dims.Count);
        }

        [Test]
        public static void Diamond_stirrup_gets_no_dimension_on_any_side()
        {
            RfBarSample d = Points(1, 10, new[] { 0.0, 200 }, new[] { 100.0, 0 }, new[] { 0.0, -200 }, new[] { -100.0, 0 }, new[] { 0.0, 200 });
            RfSectionPlan plan = Plan(BeamFaces(), d);
            Assert.Eq(0, plan.Dims.Count);
            Assert.Eq(4, plan.Warnings.Count(w => w.Code == RfSectionWarn.StirrupSideOpen));
        }

        [Test]
        public static void Rounded_corner_stirrup_still_counts_as_closed()
        {
            // Булангууд нум (tessellated): шулуун хэсгийн хоёр төгсгөл нь хилийн шугамд; нумын цэгүүд хилд ОРООГҮЙ.
            double hw = 110, hh = 210, r = 25;
            var pts = new List<double[]>
            {
                new[] { -hw + r, -hh }, new[] { hw - r, -hh },
                new[] { hw - r * 0.3, -hh + r * 0.3 }, new[] { hw, -hh + r },
                new[] { hw, hh - r },
                new[] { hw - r * 0.3, hh - r * 0.3 }, new[] { hw - r, hh },
                new[] { -hw + r, hh },
                new[] { -hw + r * 0.3, hh - r * 0.3 }, new[] { -hw, hh - r },
                new[] { -hw, -hh + r },
                new[] { -hw + r * 0.3, -hh + r * 0.3 }, new[] { -hw + r, -hh },
            };
            RfStirrupLoop l = RfSectionGeometry.LoopOf(Points(1, 10, pts.ToArray()), PlanView(), RfSectionFrame.Identity);
            foreach (RfSide s in new[] { RfSide.Left, RfSide.Right, RfSide.Top, RfSide.Bottom })
                Assert.True(l.CoverOf(s) >= RfSectionGeometry.MinSideCoverage, s + " " + l.CoverOf(s));
        }

        [Test]
        public static void Inner_closed_stirrup_is_used_when_the_outer_one_is_open_on_that_side()
        {
            RfBarSample outerU = Points(1, 10, new[] { -120.0, 220 }, new[] { 120.0, 220 }, new[] { 120.0, -220 }, new[] { -120.0, -220 });
            RfBarSample innerClosed = ClosedStirrup(2, 100, 190);
            RfSectionPlan plan = Plan(BeamFaces(), outerU, innerClosed);
            RfDimPlan left = plan.Dims.First(d => d.Side == RfSide.Left);
            Assert.Eq(2L, left.StirrupId, "нээлттэй гаднах хомутын оронд хаалттай дотор нь");
            RfDimPlan right = plan.Dims.First(d => d.Side == RfSide.Right);
            Assert.Eq(1L, right.StirrupId, "хаалттай тал дээр гаднах нь");
        }

        // ── «Өмнөхийг солих»: өгөгдөл алдахгүй ────────────────────────

        [Test]
        public static void Replace_never_deletes_a_kind_that_was_not_fully_recreated()
        {
            // (a) Энэ удаа хэмжээс төлөвлөөгүй (хомут олдоогүй / хэмжээсийг унтраасан): өмнөх сайн хэмжээс ҮЛДЭНЭ.
            Assert.False(RfReplacePolicy.DimsReplaceable(planned: 0, made: 0, failed: 0), "төлөвлөөгүй төрлийн өмнөхийг УСТГАХГҮЙ");
            // (b) 4-өөс 1 нь л үүссэн: өмнөх 4-ийг устгавал 3 тал алдагдана.
            Assert.False(RfReplacePolicy.DimsReplaceable(planned: 4, made: 1, failed: 3));
            Assert.False(RfReplacePolicy.DimsReplaceable(planned: 4, made: 4, failed: 1), "алдаатай бол үлдээнэ");
            // Бүрэн үүссэн: устгаж болно.
            Assert.True(RfReplacePolicy.DimsReplaceable(planned: 4, made: 4, failed: 0));
            Assert.True(RfReplacePolicy.DimsReplaceable(planned: 1, made: 1, failed: 0));
        }

        [Test]
        public static void Replace_tags_follow_the_same_rule()
        {
            Assert.False(RfReplacePolicy.TagsReplaceable(0, 0));
            Assert.False(RfReplacePolicy.TagsReplaceable(5, 3));
            Assert.True(RfReplacePolicy.TagsReplaceable(5, 5));
        }

        // ── Tag-ийн нэгтгэлийн түлхүүр ─────────────────────────────────

        [Test]
        public static void Tag_group_key_includes_partition_so_same_number_in_two_partitions_is_not_merged()
        {
            string baseKey = RfSectionGeometry.BarGroupKey(7, 16 * Mm, 33);
            string a = RfSectionGeometry.NumberedGroupKey(baseKey, "1", "ДН-1");
            string b = RfSectionGeometry.NumberedGroupKey(baseKey, "1", "ДН-2");
            string c = RfSectionGeometry.NumberedGroupKey(baseKey, "1", "ДН-1");
            Assert.True(a != b, "ӨӨР Partition-ий №1 нь ӨӨР арматур");
            Assert.Eq(a, c, "ижил Partition + ижил дугаар = нэг бүлэг");
            Assert.True(a != RfSectionGeometry.NumberedGroupKey(baseKey, "2", "ДН-1"));
        }

        [Test]
        public static void Tag_group_key_blank_number_never_groups()
        {
            string baseKey = RfSectionGeometry.BarGroupKey(7, 16 * Mm, 33);
            Assert.Eq(string.Empty, RfSectionGeometry.NumberedGroupKey(baseKey, null, "ДН-1"));
            Assert.Eq(string.Empty, RfSectionGeometry.NumberedGroupKey(baseKey, "  ", "ДН-1"));
            // Хоосон Partition + дугаар: хуучин «Partition ашигладаггүй» төсөл — нэгтгэнэ.
            Assert.True(RfSectionGeometry.NumberedGroupKey(baseKey, "3", null).Length > 0);
            Assert.Eq(RfSectionGeometry.NumberedGroupKey(baseKey, "3", null), RfSectionGeometry.NumberedGroupKey(baseKey, "3", "  "));
        }

        // ── 135° дэгээний давхцалтай булан (бодит Revit, 2026-10-05) ──────

        /// <summary>
        /// «ДН-1-1» дам нурууны Ø8 хомутын дэгээг хассан голын шугам (Revit-ээс уншсан, төвд шилжүүлсэн мм): зүүн хөл дээд хэсгээс 4 мм дээш (v = 228),
        /// дээд хэсэг зүүн хөлөөс 4 мм цааш (u = −128) гардаг.
        /// </summary>
        private static RfBarSample HookOverlapStirrup()
        {
            return Points(1, 8,
                new[] { -124.0, 228 }, new[] { -124.0, -210 },
                new[] { -110.0, -224 }, new[] { 110.0, -224 },
                new[] { 124.0, -210 }, new[] { 124.0, 210 },
                new[] { 110.0, 224 }, new[] { -128.0, 224 });
        }

        [Test]
        public static void Hook_overlap_corner_is_closed_and_the_real_leg_is_the_extent()
        {
            RfStirrupLoop l = RfSectionGeometry.LoopOf(HookOverlapStirrup(), PlanView(), RfSectionFrame.Identity);
            foreach (RfSide s in new[] { RfSide.Left, RfSide.Right, RfSide.Top, RfSide.Bottom })
                Assert.True(l.CoverOf(s) >= RfSectionGeometry.MinSideCoverage, s + " " + l.CoverOf(s));
            Assert.Near(-124 * Mm, l.Extent(RfSide.Left), 1e-9, "дэгээний үзүүр (−128) биш, хөл (−124)");
            Assert.Near(224 * Mm, l.Extent(RfSide.Top), 1e-9, "хөлийн үзүүр (228) биш, дээд хэсэг (224)");
            Assert.Near(124 * Mm, l.Extent(RfSide.Right), 1e-9);
            Assert.Near(-224 * Mm, l.Extent(RfSide.Bottom), 1e-9);
            Assert.Near(-128 * Mm, l.MinU, 1e-9, "хүрээ өөрөө өөрчлөгдөхгүй");
        }

        [Test]
        public static void Hook_overlap_stirrup_gets_all_four_inner_dimensions_of_30()
        {
            var input = new RfSectionInput { View = PlanView() };
            input.Faces.AddRange(BeamFaces()); // 300×500: ±150 × ±250
            input.Stirrups.Add(HookOverlapStirrup());
            input.Options.Ref = RfStirrupRef.Inner;
            input.Options.DimOffsetFt = 100 * Mm;
            input.Options.TagLongitudinal = false;
            input.Options.TagStirrups = false;
            RfSectionPlan plan = RfSectionPlanner.Build(input);
            Assert.Eq(4, plan.Dims.Count, string.Join(",", plan.Warnings.Select(w => w.Code + ":" + w.Arg)));
            foreach (RfDimPlan d in plan.Dims)
                Assert.Near(30 * Mm, d.Distance, 1e-9, d.Side + ": нүүр 150, хөл 124, дотор ирмэг = хөл ∓ 4 мм → 30 (Revit-ийн гар хэмжээстэй ижил)");
        }

        [Test]
        public static void Interior_leg_beyond_the_band_is_not_taken_as_the_open_side()
        {
            // U (зүүн тал нээлттэй) + 50 мм дотор босоо хөл (4 хөлт хомутын дотор хэсэг г.м.) — band (1.5 × 10 мм) -ээс хол тул тал БИШ.
            RfBarSample u = Points(1, 10, new[] { -110.0, 210 }, new[] { 110.0, 210 }, new[] { 110.0, -210 }, new[] { -110.0, -210 },
                new[] { -60.0, -210 }, new[] { -60.0, 210 });
            RfStirrupLoop l = RfSectionGeometry.LoopOf(u, PlanView(), RfSectionFrame.Identity);
            Assert.Near(0.0, l.CoverLeft, 1e-6, "нээлттэй тал хэвээр");
            Assert.True(double.IsNaN(l.LegLeft));
            Assert.Near(-110 * Mm, l.Extent(RfSide.Left), 1e-9);
        }

        [Test]
        public static void SideCoverage_counts_only_consecutive_points_on_the_line()
        {
            var pts = new List<RfV2> { new RfV2(0, 0), new RfV2(0, 100), new RfV2(50, 100), new RfV2(0, 50), new RfV2(0, 0) };
            // u = 0 дээрх зэргэлдээ хос: (0,0)-(0,100) нийт 100; (0,50)-(0,0) нийт 50  → 150 / span 100 → 1 (хязгаарлана).
            Assert.Near(1.0, RfSectionGeometry.SideCoverage(pts, true, 0, 100), 1e-9);
            // Огт хөндөөгүй шугам.
            Assert.Near(0.0, RfSectionGeometry.SideCoverage(pts, true, 70, 100), 1e-9);
            // Хоосон/хүчингүй span.
            Assert.Near(0.0, RfSectionGeometry.SideCoverage(pts, true, 0, 0), 1e-9);
            Assert.Near(0.0, RfSectionGeometry.SideCoverage(null, true, 0, 100), 1e-9);
        }
    }
}
