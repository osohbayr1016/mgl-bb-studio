using System;
using System.Collections.Generic;
using System.Linq;
using RevitMcpAddin.Reinforcement.Core;

namespace RevitMcpAddin.Reinforcement.Tests
{
    /// <summary>Огтлолын тооцооны тестүүд — бүгд Revit-гүй, синтетик дам нуруу/баганаар (эргэсэн ч).</summary>
    public static class SectionTests
    {
        private const double Mm = 1.0 / 304.8;
        private const double Eps = 1e-6;

        private static RfViewFrame PlanView()
        {
            return new RfViewFrame(new RfV3(0, 0, 0), new RfV3(1, 0, 0), new RfV3(0, 1, 0), new RfV3(0, 0, 1));
        }

        private static RfV2 Rot(double theta, double x, double y)
        {
            return new RfV2(x * Math.Cos(theta) - y * Math.Sin(theta), x * Math.Sin(theta) + y * Math.Cos(theta));
        }

        /// <summary>Тэгш өнцөгт гишүүн (төв, w×h мм) θ-ээр эргэсэн: Id 1=Зүүн 2=Баруун 3=Доод 4=Дээд.</summary>
        private static List<RfFaceSample> Faces(double cxMm, double cyMm, double wMm, double hMm, double theta, double lenMm = 3000)
        {
            RfV2 c = new RfV2(cxMm * Mm, cyMm * Mm);
            RfV2 u = Rot(theta, 1, 0), v = Rot(theta, 0, 1);
            double w = wMm * Mm, h = hMm * Mm, len = lenMm * Mm;
            return new List<RfFaceSample>
            {
                new RfFaceSample { Id = 1, Origin = c - u * (w / 2), Normal = -u, Area = h * len },
                new RfFaceSample { Id = 2, Origin = c + u * (w / 2), Normal = u, Area = h * len },
                new RfFaceSample { Id = 3, Origin = c - v * (h / 2), Normal = -v, Area = w * len },
                new RfFaceSample { Id = 4, Origin = c + v * (h / 2), Normal = v, Area = w * len },
            };
        }

        /// <summary>Хомут (голын шугам wc×hc мм), θ-ээр эргэсэн, огтлолын хавтгайгаас depth зайд.</summary>
        private static RfBarSample Stirrup(double cxMm, double cyMm, double wcMm, double hcMm, double theta, double depthMm,
            double diaMm, long id, int idx = 0)
        {
            var s = new RfBarSample { Id = id, BarIndex = idx, Diameter = diaMm * Mm };
            double hw = wcMm * Mm / 2, hh = hcMm * Mm / 2;
            double[][] corners = { new[] { -hw, -hh }, new[] { hw, -hh }, new[] { hw, hh }, new[] { -hw, hh }, new[] { -hw, -hh } };
            foreach (double[] k in corners)
            {
                RfV2 p = Rot(theta, k[0], k[1]) + new RfV2(cxMm * Mm, cyMm * Mm);
                s.Points.Add(new RfV3(p.X, p.Y, depthMm * Mm));
            }
            return s;
        }

        private static RfSectionInput BeamInput(double theta, RfStirrupRef r, double coverMm = 40, double dia = 10)
        {
            var input = new RfSectionInput { View = PlanView() };
            input.Faces.AddRange(Faces(1000, 2000, 300, 500, theta));
            double wc = 300 - 2 * (coverMm + dia / 2), hc = 500 - 2 * (coverMm + dia / 2);
            input.Stirrups.Add(Stirrup(1000, 2000, wc, hc, theta, 0, dia, 77));
            input.Options.Ref = r;
            input.Options.DimOffsetFt = 100 * Mm;
            return input;
        }

        // ── Локал тэнхлэг ба хүрээ ─────────────────────────────────────

        [Test]
        public static void Frame_axis_aligned_beam()
        {
            bool rect;
            RfSectionFrame f = RfSectionGeometry.DetectFrame(Faces(0, 0, 300, 500, 0), out rect);
            Assert.True(rect);
            Assert.Near(1, f.U.X, Eps);
            Assert.Near(1, f.V.Y, Eps);
        }

        [Test]
        public static void Frame_rotated_30_follows_member_not_world()
        {
            double th = 30 * Math.PI / 180;
            bool rect;
            RfSectionFrame f = RfSectionGeometry.DetectFrame(Faces(0, 0, 300, 500, th), out rect);
            Assert.True(rect);
            Assert.Near(Math.Cos(th), f.U.X, 1e-9);
            Assert.Near(Math.Sin(th), f.U.Y, 1e-9);
            Assert.Near(-Math.Sin(th), f.V.X, 1e-9);
            Assert.Near(Math.Cos(th), f.V.Y, 1e-9);
        }

        [Test]
        public static void Outline_gives_true_width_height_for_any_rotation()
        {
            foreach (double deg in new[] { 0.0, 15, 30, 45, 60, 90, 135, 200 })
            {
                double th = deg * Math.PI / 180;
                var faces = Faces(1234, -567, 300, 500, th);
                bool rectOk;
                RfSectionFrame f = RfSectionGeometry.DetectFrame(faces, out rectOk);
                RfSectionRect r = RfSectionGeometry.Outline(faces, f);
                double a = r.Width / Mm, b = r.Height / Mm;
                bool straight = Math.Abs(a - 300) < 1e-6 && Math.Abs(b - 500) < 1e-6;
                bool swapped = Math.Abs(a - 500) < 1e-6 && Math.Abs(b - 300) < 1e-6;
                Assert.True(straight || swapped, deg + "°: " + a + "×" + b);
                Assert.True(r.FaceLeft > 0 && r.FaceRight > 0 && r.FaceTop > 0 && r.FaceBottom > 0, deg + "° нүүр бүрэн");
            }
        }

        [Test]
        public static void Outline_square_and_rectangular_columns()
        {
            var sq = Faces(0, 0, 400, 400, 0);
            RfSectionRect r = RfSectionGeometry.Outline(sq, RfSectionFrame.Identity);
            Assert.Near(400, r.Width / Mm, 1e-6);
            Assert.Near(400, r.Height / Mm, 1e-6);

            var rc = Faces(0, 0, 300, 700, 45 * Math.PI / 180);
            bool ok;
            RfSectionFrame f = RfSectionGeometry.DetectFrame(rc, out ok);
            RfSectionRect rr = RfSectionGeometry.Outline(rc, f);
            double[] dims = { rr.Width / Mm, rr.Height / Mm };
            Array.Sort(dims);
            Assert.Near(300, dims[0], 1e-6);
            Assert.Near(700, dims[1], 1e-6);
        }

        [Test]
        public static void Outline_ignores_chamfer_faces_and_flags_non_rectangular()
        {
            var faces = Faces(0, 0, 300, 500, 0);
            double s = Math.Sqrt(0.5);
            faces.Add(new RfFaceSample { Id = 9, Origin = new RfV2(150 * Mm, 250 * Mm), Normal = new RfV2(s, s), Area = 0.001 });
            bool rect;
            RfSectionFrame f = RfSectionGeometry.DetectFrame(faces, out rect);
            Assert.False(rect, "налуу нүүртэй хэсгийг тэгш өнцөгт гэж үзэхгүй");
            RfSectionRect r = RfSectionGeometry.Outline(faces, f);
            Assert.Eq(2, r.FaceRight);
        }

        [Test]
        public static void Outline_missing_side_is_filled_and_reported()
        {
            var faces = Faces(0, 0, 300, 500, 0).Where(f => f.Id != 4).ToList(); // Дээд нүүр байхгүй
            RfSectionRect r = RfSectionGeometry.Outline(faces, RfSectionFrame.Identity);
            Assert.Eq(-1, r.FaceTop);
            List<RfSide> missing = RfSectionGeometry.FillMissing(ref r, faces, RfSectionFrame.Identity);
            Assert.Eq(1, missing.Count);
            Assert.Eq(RfSide.Top, missing[0]);
            Assert.False(double.IsNaN(r.MaxV));
        }

        // ── Арматурын ангилал ──────────────────────────────────────────

        private static List<RfV3> Rectangle(double x0, double y0, double x1, double y1, double z)
        {
            return new List<RfV3> { new RfV3(x0, y0, z), new RfV3(x1, y0, z), new RfV3(x1, y1, z), new RfV3(x0, y1, z), new RfV3(x0, y0, z) };
        }

        [Test]
        public static void Classify_stirrup_longitudinal_and_other()
        {
            RfV3 n = new RfV3(0, 0, 1);

            // Хомут: огтлолын хавтгайтай параллель хавтгай гогцоо
            Assert.Eq(RfBarClass.Transverse, RfSectionGeometry.Classify(Rectangle(0, 0, 1, 2, 5), n));

            // Ажлын арматур: огтлолын нормаль дагуух шулуун
            Assert.Eq(RfBarClass.Longitudinal, RfSectionGeometry.Classify(new List<RfV3> { new RfV3(0.2, 0.3, -4), new RfV3(0.2, 0.3, 4) }, n));

            // Дэгээтэй (L хэлбэр, хавтгай нь нормалыг агуулсан): урт хэрчим нь нормаль дагуу
            Assert.Eq(RfBarClass.Longitudinal, RfSectionGeometry.Classify(
                new List<RfV3> { new RfV3(0, 0, -4), new RfV3(0, 0, 4), new RfV3(0.5, 0, 4) }, n));

            // Нормалийг агуулсан хавтгайд хэвтсэн, өргөн нь хөндлөн гогцоо (огтлолд «хажуу тийш» харагдах хомут) — Other
            var elev = new List<RfV3> { new RfV3(0, 0, 0), new RfV3(2, 0, 0), new RfV3(2, 0, 1), new RfV3(0, 0, 1), new RfV3(0, 0, 0) };
            Assert.Eq(RfBarClass.Other, RfSectionGeometry.Classify(elev, n));

            // Харин урт хөл нь тэнхлэг дагуу (нормалийг агуулсан хавтгайн гогцоо) — ажлын арматур гэж үзнэ
            var longLoop = new List<RfV3> { new RfV3(0, 0, 0), new RfV3(1, 0, 0), new RfV3(1, 0, 2), new RfV3(0, 0, 2), new RfV3(0, 0, 0) };
            Assert.Eq(RfBarClass.Longitudinal, RfSectionGeometry.Classify(longLoop, n));

            // Огтлолд хэвтээ шулуун (хажуу тийш) → Other
            Assert.Eq(RfBarClass.Other, RfSectionGeometry.Classify(new List<RfV3> { new RfV3(0, 0, 0), new RfV3(5, 0, 0) }, n));
        }

        [Test]
        public static void Classify_helix_is_not_a_stirrup()
        {
            var helix = new List<RfV3>();
            for (int i = 0; i <= 64; i++)
            {
                double a = i * Math.PI / 8;
                helix.Add(new RfV3(Math.Cos(a), Math.Sin(a), i * 0.05));
            }
            Assert.Eq(RfBarClass.Other, RfSectionGeometry.Classify(helix, new RfV3(0, 0, 1)));
        }

        [Test]
        public static void Classify_section_not_exactly_perpendicular()
        {
            // Харагдацын нормаль гишүүний тэнхлэгээс 8° хазайсан — хомут (хавтгайн нормаль = тэнхлэг) хэвээр танигдана;
            // 20° хазайвал огтлол биш гэж үзэж Other.
            foreach (var c in new[] { new { Deg = 8.0, Expect = RfBarClass.Transverse }, new { Deg = 20.0, Expect = RfBarClass.Other } })
            {
                double a = c.Deg * Math.PI / 180;
                RfV3 viewNormal = new RfV3(Math.Sin(a), 0, Math.Cos(a));
                // Гишүүний тэнхлэг = Z; хомут XY хавтгайд.
                Assert.Eq(c.Expect, RfSectionGeometry.Classify(Rectangle(0, 0, 1, 2, 3), viewNormal), c.Deg + "°");
            }
        }

        [Test]
        public static void CutPoint_bar_along_normal_and_off_plane()
        {
            RfViewFrame v = PlanView();
            RfV2 p;
            Assert.True(RfSectionGeometry.TryCutPoint(new List<RfV3> { new RfV3(1, 2, -3), new RfV3(1, 2, 5) }, v, out p));
            Assert.Near(1, p.X, Eps);
            Assert.Near(2, p.Y, Eps);

            // Налуу арматур: z=-1 → +1 хооронд (0 дээр интерполяци)
            Assert.True(RfSectionGeometry.TryCutPoint(new List<RfV3> { new RfV3(0, 0, -1), new RfV3(2, 4, 1) }, v, out p));
            Assert.Near(1, p.X, Eps);
            Assert.Near(2, p.Y, Eps);

            // Бүхэлдээ нэг талд → огтлоогүй
            Assert.False(RfSectionGeometry.TryCutPoint(new List<RfV3> { new RfV3(0, 0, 1), new RfV3(0, 0, 5) }, v, out p));
            // Төгсгөл нь яг хавтгай дээр
            Assert.True(RfSectionGeometry.TryCutPoint(new List<RfV3> { new RfV3(3, 3, 0), new RfV3(3, 3, 4) }, v, out p));
        }

        // ── Хомутын ирмэг ба хэмжээс ───────────────────────────────────

        [Test]
        public static void StirrupMath_outer_inner_center_all_four_sides()
        {
            // Нүүр 0-д, хомутын голын шугам 45 мм-д (cover 40 + d/2 5), d = 10 мм.
            double d = 10 * Mm;
            foreach (RfSide side in new[] { RfSide.Left, RfSide.Bottom })
            {
                double face = 0, ext = 45 * Mm;
                Assert.Near(40, RfSectionGeometry.Cover(side, face, RfSectionGeometry.EdgePos(side, RfStirrupRef.Outer, ext, d)) / Mm, 1e-6);
                Assert.Near(50, RfSectionGeometry.Cover(side, face, RfSectionGeometry.EdgePos(side, RfStirrupRef.Inner, ext, d)) / Mm, 1e-6);
                Assert.Near(45, RfSectionGeometry.Cover(side, face, RfSectionGeometry.EdgePos(side, RfStirrupRef.Center, ext, d)) / Mm, 1e-6);
            }
            foreach (RfSide side in new[] { RfSide.Right, RfSide.Top })
            {
                double face = 300 * Mm, ext = (300 - 45) * Mm;
                Assert.Near(40, RfSectionGeometry.Cover(side, face, RfSectionGeometry.EdgePos(side, RfStirrupRef.Outer, ext, d)) / Mm, 1e-6);
                Assert.Near(50, RfSectionGeometry.Cover(side, face, RfSectionGeometry.EdgePos(side, RfStirrupRef.Inner, ext, d)) / Mm, 1e-6);
                Assert.Near(45, RfSectionGeometry.Cover(side, face, RfSectionGeometry.EdgePos(side, RfStirrupRef.Center, ext, d)) / Mm, 1e-6);
            }
        }

        [Test]
        public static void Planner_outer_inner_center_dimension_values_in_rotated_sections()
        {
            foreach (double deg in new[] { 0.0, 30, 90, 145 })
            {
                double th = deg * Math.PI / 180;
                var expected = new Dictionary<RfStirrupRef, double>
                {
                    { RfStirrupRef.Outer, 40 }, { RfStirrupRef.Inner, 50 }, { RfStirrupRef.Center, 45 },
                };
                foreach (RfStirrupRef r in expected.Keys)
                {
                    RfSectionPlan plan = RfSectionPlanner.Build(BeamInput(th, r));
                    Assert.Eq(4, plan.Dims.Count, deg + "° " + r);
                    foreach (RfDimPlan d in plan.Dims)
                        Assert.Near(expected[r], d.Distance / Mm, 1e-6, deg + "° " + r + " " + d.Side);
                    Assert.False(plan.Warnings.Any(w => w.Code == RfSectionWarn.StirrupOutsideConcrete));
                }
            }
        }

        [Test]
        public static void Planner_dimension_references_follow_host_faces()
        {
            RfSectionPlan plan = RfSectionPlanner.Build(BeamInput(0, RfStirrupRef.Outer));
            Assert.Eq(1, plan.Dims.First(d => d.Side == RfSide.Left).FaceId);
            Assert.Eq(2, plan.Dims.First(d => d.Side == RfSide.Right).FaceId);
            Assert.Eq(3, plan.Dims.First(d => d.Side == RfSide.Bottom).FaceId);
            Assert.Eq(4, plan.Dims.First(d => d.Side == RfSide.Top).FaceId);
            Assert.True(plan.Dims.All(d => d.StirrupId == 77));
        }

        [Test]
        public static void Planner_respects_side_selection()
        {
            RfSectionInput input = BeamInput(0, RfStirrupRef.Outer);
            input.Options.Right = false;
            input.Options.Top = false;
            RfSectionPlan plan = RfSectionPlanner.Build(input);
            Assert.Eq(2, plan.Dims.Count);
            Assert.True(plan.Dims.All(d => d.Side == RfSide.Left || d.Side == RfSide.Bottom));
        }

        [Test]
        public static void Planner_dimension_lines_sit_outside_and_use_member_axes()
        {
            RfSectionPlan plan = RfSectionPlanner.Build(BeamInput(0, RfStirrupRef.Outer));
            RfSectionRect r = plan.Rect;
            foreach (RfDimPlan d in plan.Dims.Where(x => x.AlongU))
                Assert.True(d.LinePos > r.MaxV, "Зүүн/Баруун хэмжээс дээд ирмэгээс дээш");
            foreach (RfDimPlan d in plan.Dims.Where(x => !x.AlongU))
                Assert.True(d.LinePos > r.MaxU, "Дээд/Доод хэмжээс баруун ирмэгээс баруун");
        }

        [Test]
        public static void Planner_no_stirrup_warns_and_makes_no_dimension()
        {
            RfSectionInput input = BeamInput(0, RfStirrupRef.Outer);
            input.Stirrups.Clear();
            RfSectionPlan plan = RfSectionPlanner.Build(input);
            Assert.Eq(0, plan.Dims.Count);
            Assert.True(plan.Warnings.Any(w => w.Code == RfSectionWarn.NoStirrup));
        }

        [Test]
        public static void Planner_many_stirrups_uses_outermost_per_side()
        {
            RfSectionInput input = BeamInput(0, RfStirrupRef.Outer);
            // Дотор нэмэлт боолт (илүү жижиг гогцоо) — гадна хомут сонгогдоно.
            input.Stirrups.Add(Stirrup(1000, 2000, 120, 300, 0, 0, 10, 88));
            RfSectionPlan plan = RfSectionPlanner.Build(input);
            Assert.True(plan.Warnings.Any(w => w.Code == RfSectionWarn.ManyStirrups));
            Assert.True(plan.Dims.All(d => d.StirrupId == 77));
        }

        [Test]
        public static void Planner_stirrup_outside_concrete_is_rejected_not_dimensioned()
        {
            RfSectionInput input = BeamInput(0, RfStirrupRef.Outer);
            input.Stirrups.Clear();
            input.Stirrups.Add(Stirrup(1000, 2000, 400, 600, 0, 0, 10, 99)); // бетоноос том
            RfSectionPlan plan = RfSectionPlanner.Build(input);
            Assert.Eq(0, plan.Dims.Count);
            Assert.True(plan.Warnings.Any(w => w.Code == RfSectionWarn.StirrupOutsideConcrete));
        }

        [Test]
        public static void Planner_different_stirrup_depth_prefers_nearest_to_plane()
        {
            RfSectionInput input = BeamInput(0, RfStirrupRef.Outer);
            input.Stirrups.Clear();
            // Хоёр адил гогцоо: нэг нь хавтгайд ойр, нөгөө нь хол.
            input.Stirrups.Add(Stirrup(1000, 2000, 205, 405, 0, 150, 10, 11));
            input.Stirrups.Add(Stirrup(1000, 2000, 205, 405, 0, 10, 10, 12));
            RfSectionPlan plan = RfSectionPlanner.Build(input);
            Assert.Eq(4, plan.Dims.Count);
            Assert.True(plan.Dims.All(d => d.StirrupId == 12), "хавтгайд ойр хомут");
        }

        [Test]
        public static void Planner_no_faces_returns_empty_with_warning()
        {
            var input = new RfSectionInput { View = PlanView() };
            RfSectionPlan plan = RfSectionPlanner.Build(input);
            Assert.False(plan.HasContent);
            Assert.True(plan.Warnings.Any(w => w.Code == RfSectionWarn.NoFaces));
        }

        // ── Ажлын арматурын tag ─────────────────────────────────────────

        private static RfSectionInput BeamWithBars()
        {
            RfSectionInput input = BeamInput(0, RfStirrupRef.Outer);
            double cx = 1000 * Mm, cy = 2000 * Mm;
            double ox = 108 * Mm, oy = 208 * Mm; // булангийн арматур
            long id = 100;
            foreach (double[] p in new[] { new[] { -ox, -oy }, new[] { ox, -oy }, new[] { -ox, oy }, new[] { ox, oy } })
                input.Longitudinal.Add(new RfLongBar { Id = id++, Pos = new RfV2(cx + p[0], cy + p[1]), Diameter = 20 * Mm });
            // Доод давхарт 2 нэмэлт (нэг олонлог = нэг Id)
            input.Longitudinal.Add(new RfLongBar { Id = 200, BarIndex = 0, Pos = new RfV2(cx - 35 * Mm, cy - oy), Diameter = 20 * Mm });
            input.Longitudinal.Add(new RfLongBar { Id = 200, BarIndex = 1, Pos = new RfV2(cx + 35 * Mm, cy - oy), Diameter = 20 * Mm });
            return input;
        }

        [Test]
        public static void Tags_are_outside_concrete_and_do_not_overlap()
        {
            RfSectionPlan plan = RfSectionPlanner.Build(BeamWithBars());
            Assert.True(plan.Tags.Count >= 5, "Tag-ууд: " + plan.Tags.Count);
            RfSectionRect r = plan.Rect;
            var concrete = new RfBox(r.MinU, r.MinV, r.MaxU, r.MaxV);
            for (int i = 0; i < plan.Tags.Count; i++)
            {
                RfBox bi = RfBox.Around(plan.Tags[i].Head, plan.Tags[i].Width, plan.Tags[i].Height);
                Assert.False(bi.Overlaps(concrete, 0), "tag бетонтой давхцсан: " + i);
                for (int j = i + 1; j < plan.Tags.Count; j++)
                {
                    RfBox bj = RfBox.Around(plan.Tags[j].Head, plan.Tags[j].Width, plan.Tags[j].Height);
                    Assert.False(bi.Overlaps(bj, 0), "tag давхцсан " + i + "," + j);
                }
            }
            Assert.False(plan.Warnings.Any(w => w.Code == RfSectionWarn.TagOverlapRemains));
        }

        [Test]
        public static void Tags_each_rebar_element_once_and_side_follows_position()
        {
            RfSectionPlan plan = RfSectionPlanner.Build(BeamWithBars());
            var ids = plan.Tags.Where(t => !t.IsStirrup).Select(t => t.Id).ToList();
            Assert.Eq(ids.Count, ids.Distinct().Count());
            Assert.True(ids.Contains(200));
            // 200 олонлог хамгийн доор → Доод тал
            Assert.Eq(RfSide.Bottom, plan.Tags.First(t => t.Id == 200).Side);
        }

        /// <summary>Хэвтээ (view-д) хайрцаг эргэсэн тэгш өнцөгттэй давхцах уу (SAT).</summary>
        private static bool BoxHitsRotatedRect(RfV2 boxCenter, double bw, double bh, RfV2 rc, RfV2 u, RfV2 v, double a, double b)
        {
            RfV2[] axes = { new RfV2(1, 0), new RfV2(0, 1), u, v };
            foreach (RfV2 ax in axes)
            {
                double c1 = boxCenter.Dot(ax), r1 = bw / 2 * Math.Abs(ax.X) + bh / 2 * Math.Abs(ax.Y);
                double c2 = rc.Dot(ax), r2 = a * Math.Abs(u.Dot(ax)) + b * Math.Abs(v.Dot(ax));
                if (Math.Abs(c1 - c2) > r1 + r2) return false; // тусгаарлах тэнхлэг олдлоо
            }
            return true;
        }

        [Test]
        public static void Tags_rotated_member_horizontal_boxes_do_not_overlap_in_VIEW_space()
        {
            // ⚠️ Бичвэр ХЭВТЭЭ (харагдацад), байрлуулалт гишүүний локал тэнхлэгт.  Эргэсэн (30°, 45°, 60°) гишүүнд
            // tag хайрцгууд харагдац дээр бетон ба бие биетэйгээ давхцах ёсгүй.
            foreach (double deg in new[] { 30.0, 45, 60, 135 })
            {
                double th = deg * Math.PI / 180;
                var input = new RfSectionInput { View = PlanView() };
                input.Faces.AddRange(Faces(0, 0, 400, 400, th));
                long id = 1;
                foreach (double[] k in new[] { new[] { -150.0, -150 }, new[] { 150.0, -150 }, new[] { -150.0, 150 }, new[] { 150.0, 150 }, new[] { 0.0, -150 }, new[] { 0.0, 150 } })
                {
                    RfV2 p = Rot(th, k[0] * Mm, k[1] * Mm);
                    input.Longitudinal.Add(new RfLongBar { Id = id++, Pos = p, Diameter = 25 * Mm });
                }
                input.Options.DoDimensions = false;
                input.Options.TagStirrups = false;
                input.Options.TagWidthFt = 160 * Mm;
                input.Options.TagHeightFt = 50 * Mm;
                input.Options.TagOutFt = 60 * Mm;
                input.Options.TagGapFt = 60 * Mm;
                RfSectionPlan plan = RfSectionPlanner.Build(input);
                Assert.Eq(6, plan.Tags.Count, deg + "°");
                Assert.False(plan.Warnings.Any(w => w.Code == RfSectionWarn.TagOverlapRemains), deg + "° overlap warn");

                RfSectionFrame fr = plan.Frame;
                RfSectionRect r = plan.Rect;
                RfV2 rc = fr.ToView(r.Center);
                var heads = plan.Tags.Select(t => fr.ToView(t.Head)).ToList();
                for (int i = 0; i < plan.Tags.Count; i++)
                {
                    Assert.False(BoxHitsRotatedRect(heads[i], plan.Tags[i].Width, plan.Tags[i].Height, rc, fr.U, fr.V, r.Width / 2, r.Height / 2),
                        deg + "° tag " + i + " бетонтой давхцсан");
                    for (int j = i + 1; j < plan.Tags.Count; j++)
                    {
                        bool overlap = Math.Abs(heads[i].X - heads[j].X) < (plan.Tags[i].Width + plan.Tags[j].Width) / 2 &&
                                       Math.Abs(heads[i].Y - heads[j].Y) < (plan.Tags[i].Height + plan.Tags[j].Height) / 2;
                        Assert.False(overlap, deg + "° tag " + i + "," + j + " давхцсан (view)");
                    }
                }
            }
        }

        [Test]
        public static void Tags_tightly_packed_bars_on_one_side_do_not_overlap_in_VIEW_space_when_rotated()
        {
            // 8 арматур ГИШҮҮНИЙ ЗҮҮН ТАЛД 50 мм зайтай нягт эгнэсэн; tag 160×50 мм (хэвтээ).  Эргэсэн (30/45/60°) үед
            // tag-ууд босоо (локал V) дагуу эгнэх тул хэвтээ хайрцгуудын ЯГ давхцахгүй зайг тооцохгүй бол давхцана.
            foreach (double deg in new[] { 0.0, 30, 45, 60, 90 })
            {
                double th = deg * Math.PI / 180;
                var input = new RfSectionInput { View = PlanView() };
                input.Faces.AddRange(Faces(0, 0, 600, 600, th));
                for (int i = 0; i < 8; i++)
                {
                    RfV2 p = Rot(th, -240 * Mm, (-175 + i * 50) * Mm);
                    input.Longitudinal.Add(new RfLongBar { Id = 10 + i, Pos = p, Diameter = 20 * Mm });
                }
                input.Options.DoDimensions = false;
                input.Options.TagStirrups = false;
                input.Options.TagWidthFt = 160 * Mm;
                input.Options.TagHeightFt = 50 * Mm;
                input.Options.TagOutFt = 40 * Mm;
                input.Options.TagGapFt = 5 * Mm;
                RfSectionPlan plan = RfSectionPlanner.Build(input);
                Assert.Eq(8, plan.Tags.Count);

                RfSectionFrame fr = plan.Frame;
                var heads = plan.Tags.Select(t => fr.ToView(t.Head)).ToList();
                double w = input.Options.TagWidthFt, h = input.Options.TagHeightFt;
                for (int i = 0; i < heads.Count; i++)
                {
                    for (int j = i + 1; j < heads.Count; j++)
                    {
                        bool overlap = Math.Abs(heads[i].X - heads[j].X) < w - 1e-9 && Math.Abs(heads[i].Y - heads[j].Y) < h - 1e-9;
                        Assert.False(overlap, deg + "° tag " + i + "," + j + " view-д давхцсан");
                    }
                }
            }
        }

        [Test]
        public static void StackPitch_is_exact_for_horizontal_boxes()
        {
            Assert.Near(0.16, RfSectionLayout.StackPitch(0.16, 0.05, new RfV2(1, 0)), 1e-12);   // хэвтээ эгнээ → өргөн
            Assert.Near(0.05, RfSectionLayout.StackPitch(0.16, 0.05, new RfV2(0, 1)), 1e-12);   // босоо эгнээ → өндөр
            double d45 = RfSectionLayout.StackPitch(0.16, 0.05, new RfV2(Math.Sqrt(0.5), Math.Sqrt(0.5)));
            Assert.Near(0.05 / Math.Sqrt(0.5), d45, 1e-12);                                        // 45° → h/sin
            // Bounding-оос (w+h)·0.707 нягт
            Assert.True(d45 < (0.16 + 0.05) * Math.Sqrt(0.5));
        }

        [Test]
        public static void Planner_recovers_from_inward_pointing_face_normals()
        {
            // Зарим mirror/эргэлттэй family-д нүүрний нормаль дотогш заадаг — planner нормалуудыг эргүүлж дахин оролдоно.
            RfSectionInput input = BeamInput(0, RfStirrupRef.Outer);
            foreach (RfFaceSample f in input.Faces) f.Normal = -f.Normal;
            RfSectionPlan plan = RfSectionPlanner.Build(input);
            Assert.True(plan.Rect.Valid);
            Assert.Eq(4, plan.Dims.Count);
            foreach (RfDimPlan d in plan.Dims) Assert.Near(40, d.Distance / Mm, 1e-6, d.Side.ToString());
        }

        [Test]
        public static void Tags_no_longitudinal_still_tags_stirrup_and_warns()
        {
            RfSectionInput input = BeamInput(0, RfStirrupRef.Outer);
            RfSectionPlan plan = RfSectionPlanner.Build(input);
            Assert.True(plan.Warnings.Any(w => w.Code == RfSectionWarn.NoLongitudinal));
            Assert.Eq(1, plan.Tags.Count(t => t.IsStirrup));
        }

        // ── Spread / layout ─────────────────────────────────────────────

        [Test]
        public static void Spread_keeps_far_apart_items_in_place()
        {
            double[] r = RfSectionLayout.Spread(new[] { 0.0, 10, 20 }, new[] { 1.0, 1, 1 }, 0.5);
            Assert.Near(0, r[0], 1e-9);
            Assert.Near(10, r[1], 1e-9);
            Assert.Near(20, r[2], 1e-9);
        }

        [Test]
        public static void Spread_two_equal_items_split_symmetrically()
        {
            double[] r = RfSectionLayout.Spread(new[] { 5.0, 5.0 }, new[] { 1.0, 1.0 }, 0.5);
            Assert.Near(1.5, Math.Abs(r[0] - r[1]), 1e-9);
            Assert.Near(5, (r[0] + r[1]) / 2, 1e-9);
        }

        [Test]
        public static void Spread_property_min_gap_order_preserved()
        {
            var rnd = new Random(42);
            for (int trial = 0; trial < 200; trial++)
            {
                int n = rnd.Next(1, 25);
                var d = new double[n];
                var s = new double[n];
                for (int i = 0; i < n; i++)
                {
                    d[i] = rnd.NextDouble() * 10;
                    s[i] = 0.2 + rnd.NextDouble();
                }
                double gap = 0.1 + rnd.NextDouble() * 0.5;
                double[] r = RfSectionLayout.Spread(d, s, gap);

                int[] ord = Enumerable.Range(0, n).OrderBy(i => d[i]).ToArray();
                for (int k = 1; k < n; k++)
                {
                    int a = ord[k - 1], b = ord[k];
                    double sep = r[b] - r[a] - (s[a] + s[b]) / 2;
                    Assert.True(sep >= gap - 1e-9, "зай " + sep + " < " + gap + " trial " + trial);
                    Assert.True(r[b] >= r[a], "дараалал");
                }
            }
        }

        [Test]
        public static void Spread_chain_of_clusters_merges()
        {
            double[] r = RfSectionLayout.Spread(new[] { 0.0, 0.2, 0.4, 0.6, 5.0 }, new[] { 1.0, 1, 1, 1, 1 }, 0.1);
            Assert.True(r[4] >= 4.99, "хол зүйл хөдлөөгүй");
            for (int i = 1; i < 4; i++) Assert.True(r[i] - r[i - 1] >= 1.1 - 1e-9);
        }

        [Test]
        public static void SideOf_uses_normalized_offsets()
        {
            var rect = new RfSectionRect { MinU = 0, MaxU = 4, MinV = 0, MaxV = 1 };
            // Өргөн дам нуруу: дээд нүүрний ойролцоох цэг (v хазайлт хагас өндрийн 0.9) — өргөнтэй харьцуулахад бага
            Assert.Eq(RfSide.Top, RfSectionLayout.SideOf(rect, new RfV2(2.2, 0.95)));
            Assert.Eq(RfSide.Left, RfSectionLayout.SideOf(rect, new RfV2(0.1, 0.5)));
            Assert.Eq(RfSide.Right, RfSectionLayout.SideOf(rect, new RfV2(3.9, 0.55)));
            Assert.Eq(RfSide.Bottom, RfSectionLayout.SideOf(rect, new RfV2(2.0, 0.02)));
        }

        [Test]
        public static void Planner_wide_and_deep_beams_produce_clean_layout()
        {
            foreach (var wh in new[] { new[] { 1200.0, 300.0 }, new[] { 250.0, 900.0 } })
            {
                var input = new RfSectionInput { View = PlanView() };
                input.Faces.AddRange(Faces(0, 0, wh[0], wh[1], 0));
                input.Stirrups.Add(Stirrup(0, 0, wh[0] - 90, wh[1] - 90, 0, 0, 10, 1));
                int n = 6;
                for (int i = 0; i < n; i++)
                {
                    double x = (-wh[0] / 2 + 55) + i * ((wh[0] - 110) / (n - 1));
                    input.Longitudinal.Add(new RfLongBar { Id = 10 + i, Pos = new RfV2(x * Mm, (-wh[1] / 2 + 55) * Mm), Diameter = 20 * Mm });
                }
                RfSectionPlan plan = RfSectionPlanner.Build(input);
                Assert.Eq(4, plan.Dims.Count);
                Assert.True(plan.Tags.Count >= n);
                Assert.False(plan.Warnings.Any(w => w.Code == RfSectionWarn.TagOverlapRemains));
            }
        }
    }
}
