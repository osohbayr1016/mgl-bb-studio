using System;
using System.Collections.Generic;
using System.Linq;
using RevitMcpAddin.Reinforcement.Core;

namespace RevitMcpAddin.Reinforcement.Tests
{
    /// <summary>Хана, хучилтын арматурын олонлогийн MRA: хэмжээсийн шугам ХАМГИЙН ГАДНА арматураас хэрэглэгчийн зайд (хост биш).</summary>
    public static class SetMraTests
    {
        private const double Mm = 1.0 / 304.8;

        /// <summary>X-ийн дагуух 4000 мм урттай 10 ширхэг, y = 0…1800 (200 алхам) — хучилтын план эсвэл ханын дэлгээс дээрх зэрэгцээ арматур.</summary>
        private static RfSetSample Parallel(long id, double rotDeg = 0)
        {
            var s = new RfSetSample { Id = id };
            double a = rotDeg * Math.PI / 180, ca = Math.Cos(a), sa = Math.Sin(a);
            Func<double, double, RfV2> rot = (x, y) => new RfV2((x * ca - y * sa) * Mm, (x * sa + y * ca) * Mm);
            for (int i = 0; i < 10; i++)
            {
                double y = i * 200;
                s.Centres.Add(rot(2000, y));
                s.Points.Add(rot(0, y));
                s.Points.Add(rot(4000, y));
            }
            return s;
        }

        private static RfSetMraOptions Opt(double offsetMm = 100)
        {
            return new RfSetMraOptions { OffsetFt = offsetMm * Mm, TagGapFt = 40 * Mm, TagWidthFt = 300 * Mm, TagHeightFt = 120 * Mm };
        }

        [Test]
        public static void Line_sits_exactly_the_user_distance_beyond_the_outermost_bar_end()
        {
            RfSetMraResult r = RfSetMraPlanner.Build(new[] { Parallel(1) }, Opt(100));
            Assert.Eq(1, r.Plans.Count);
            RfSetMraPlan p = r.Plans[0];
            // Тархалт Y-ийн дагуу → шугам босоо, гадагш = +X; хамгийн гадна цэг x = 4000 → шугам x = 4100.
            Assert.Near(0, p.LineDir.X, 1e-9);
            Assert.Near(1, p.Outward.X, 1e-9);
            Assert.Near(4100 * Mm, p.LineOrigin.X, 1e-9, "шугам = арматурын төгсгөл + 100 мм");
            Assert.Near(900 * Mm, p.LineOrigin.Y, 1e-9, "шугам олонлогийн дундаас");
            Assert.Near(100 * Mm, p.DistanceFromRebar, 1e-9);
            Assert.Near(1800 * Mm, p.Spread, 1e-9);
        }

        [Test]
        public static void The_distance_changes_with_the_user_value_and_only_depends_on_the_rebar()
        {
            double a = RfSetMraPlanner.Build(new[] { Parallel(1) }, Opt(50)).Plans[0].LineOrigin.X;
            double b = RfSetMraPlanner.Build(new[] { Parallel(1) }, Opt(250)).Plans[0].LineOrigin.X;
            Assert.Near(200 * Mm, b - a, 1e-9);
        }

        [Test]
        public static void Distance_from_every_rebar_point_to_the_line_is_at_least_the_user_value_for_any_rotation()
        {
            foreach (double rot in new[] { 0.0, 30.0, 90.0, 137.0, -60.0 })
            {
                RfSetSample s = Parallel(1, rot);
                RfSetMraPlan p = RfSetMraPlanner.Build(new[] { s }, Opt(80)).Plans[0];
                double minDist = s.Points.Min(q => Math.Abs((q - p.LineOrigin).Dot(p.Outward)));
                Assert.Near(80 * Mm, minDist, 1e-9, "эргэлт " + rot);
                Assert.True(s.Points.All(q => (q - p.LineOrigin).Dot(p.Outward) <= 1e-9), "бүх арматур шугамын нэг талд, эргэлт " + rot);
            }
        }

        [Test]
        public static void Flip_puts_the_line_on_the_opposite_side()
        {
            RfSetMraOptions o = Opt(100);
            o.Flip = true;
            RfSetMraPlan p = RfSetMraPlanner.Build(new[] { Parallel(1) }, o).Plans[0];
            Assert.Near(-1, p.Outward.X, 1e-9);
            Assert.Near(-100 * Mm, p.LineOrigin.X, 1e-9, "хамгийн гадна цэг (энэ талд) x = 0 → шугам x = −100");
        }

        [Test]
        public static void End_on_dots_are_dimensioned_along_their_row_with_the_offset_from_the_dots()
        {
            // Огтлолд харагдсан цэгүүд (арматур харагдацад перпендикуляр): ширхгийн төгсгөл байхгүй, зөвхөн цэг.
            var s = new RfSetSample { Id = 7 };
            for (int i = 0; i < 6; i++) { s.Centres.Add(new RfV2(i * 150 * Mm, 40 * Mm)); s.Points.Add(new RfV2(i * 150 * Mm, 40 * Mm)); }
            RfSetMraPlan p = RfSetMraPlanner.Build(new[] { s }, Opt(60)).Plans[0];
            Assert.Near(1, p.LineDir.X, 1e-9);
            Assert.Near(100 * Mm, p.LineOrigin.Y, 1e-9, "цэгийн v (40) + 60");
            Assert.True(p.Head.Y > p.LineOrigin.Y, "шошго шугамаас гадагш");
        }

        [Test]
        public static void Head_clears_the_line_by_the_tag_gap_plus_half_the_box_along_the_outward_axis()
        {
            RfSetMraPlan p = RfSetMraPlanner.Build(new[] { Parallel(1) }, Opt(100)).Plans[0];
            // гадагш = +X → хайрцгийн өргөн (300) хагас = 150; зай 40.
            Assert.Near(190 * Mm, p.Head.X - p.LineOrigin.X, 1e-9);
        }

        [Test]
        public static void Single_position_and_zero_spread_sets_are_skipped_with_a_reason()
        {
            var one = new RfSetSample { Id = 1 };
            one.Centres.Add(new RfV2(0, 0));
            var same = new RfSetSample { Id = 2 };
            same.Centres.Add(new RfV2(0, 0)); same.Centres.Add(new RfV2(0, 0));
            RfSetMraResult r = RfSetMraPlanner.Build(new[] { one, same }, Opt());
            Assert.Eq(0, r.Plans.Count);
            Assert.Eq(2, r.Warnings.Count);
            Assert.True(r.Warnings.Any(w => w.Code == RfSetMraWarn.SinglePosition));
            Assert.True(r.Warnings.Any(w => w.Code == RfSetMraWarn.NoSpread));
        }

        [Test]
        public static void Plans_are_deterministic_and_ordered_by_rebar_id()
        {
            RfSetSample a = Parallel(5), b = Parallel(2);
            RfSetMraResult r1 = RfSetMraPlanner.Build(new[] { a, b }, Opt());
            RfSetMraResult r2 = RfSetMraPlanner.Build(new[] { b, a }, Opt());
            Assert.SeqEq(new long[] { 2, 5 }, r1.Plans.Select(p => p.RebarId));
            Assert.SeqEq(r1.Plans.Select(p => p.LineOrigin.ToString()), r2.Plans.Select(p => p.LineOrigin.ToString()));
        }

        // ── Multi-leader (огтлол) ───────────────────────────────────

        [Test]
        public static void Multi_leader_collects_every_position_of_a_single_set_and_is_off_by_default()
        {
            var input = new RfSectionInput { View = new RfViewFrame(new RfV3(0, 0, 0), new RfV3(1, 0, 0), new RfV3(0, 1, 0), new RfV3(0, 0, 1)) };
            double w = 300 * Mm, h = 500 * Mm, len = 3000 * Mm;
            input.Faces.Add(new RfFaceSample { Id = 1, Origin = new RfV2(-w / 2, 0), Normal = new RfV2(-1, 0), Area = h * len });
            input.Faces.Add(new RfFaceSample { Id = 2, Origin = new RfV2(w / 2, 0), Normal = new RfV2(1, 0), Area = h * len });
            input.Faces.Add(new RfFaceSample { Id = 3, Origin = new RfV2(0, -h / 2), Normal = new RfV2(0, -1), Area = w * len });
            input.Faces.Add(new RfFaceSample { Id = 4, Origin = new RfV2(0, h / 2), Normal = new RfV2(0, 1), Area = w * len });
            input.Options.DoDimensions = false;
            input.Options.TagStirrups = false;
            for (int i = 0; i < 4; i++)
                input.Longitudinal.Add(new RfLongBar { Id = 10, BarIndex = i, Pos = new RfV2((-140 + i * 93) * Mm, -210 * Mm), Diameter = 16 * Mm, Group = "g|#1" });
            input.Options.SingleTagPerSet = true;

            RfSectionPlan off = RfSectionPlanner.Build(input);
            Assert.Eq(1, off.Tags.Count);
            Assert.Eq(0, off.Tags[0].BarIndices.Count, "multi-leader унтраалттай үед ердийн нэг leader");

            input.Options.MultiLeaderPerSet = true;
            input.Options.MergeLeaders = true;
            RfSectionPlan on = RfSectionPlanner.Build(input);
            Assert.Eq(1, on.Tags.Count);
            Assert.SeqEq(new[] { 0, 1, 2, 3 }, on.Tags[0].BarIndices, "бүх ширхэг, индексийн дарааллаар");
            Assert.Eq(4, on.Tags[0].BarTargets.Count);
        }

        [Test]
        public static void Multi_leader_is_skipped_when_several_elements_share_one_tag()
        {
            var input = new RfSectionInput { View = new RfViewFrame(new RfV3(0, 0, 0), new RfV3(1, 0, 0), new RfV3(0, 1, 0), new RfV3(0, 0, 1)) };
            double w = 300 * Mm, h = 500 * Mm, len = 3000 * Mm;
            input.Faces.Add(new RfFaceSample { Id = 1, Origin = new RfV2(-w / 2, 0), Normal = new RfV2(-1, 0), Area = h * len });
            input.Faces.Add(new RfFaceSample { Id = 2, Origin = new RfV2(w / 2, 0), Normal = new RfV2(1, 0), Area = h * len });
            input.Faces.Add(new RfFaceSample { Id = 3, Origin = new RfV2(0, -h / 2), Normal = new RfV2(0, -1), Area = w * len });
            input.Faces.Add(new RfFaceSample { Id = 4, Origin = new RfV2(0, h / 2), Normal = new RfV2(0, 1), Area = w * len });
            input.Options.DoDimensions = false;
            input.Options.TagStirrups = false;
            // Ижил дугаартай (Group) ХОЁР элемент → нэг шошго нэгтгэгдэнэ → multi-leader үгүй (шошго ганц элементийн мэдээллийг л уншина).
            input.Longitudinal.Add(new RfLongBar { Id = 10, BarIndex = 0, Pos = new RfV2(-100 * Mm, -210 * Mm), Diameter = 16 * Mm, Group = "same" });
            input.Longitudinal.Add(new RfLongBar { Id = 11, BarIndex = 0, Pos = new RfV2(100 * Mm, -210 * Mm), Diameter = 16 * Mm, Group = "same" });
            input.Options.SingleTagPerSet = true;
            input.Options.MultiLeaderPerSet = true;
            RfSectionPlan plan = RfSectionPlanner.Build(input);
            Assert.Eq(1, plan.Tags.Count);
            Assert.Eq(2, plan.Tags[0].GroupCount);
            Assert.Eq(0, plan.Tags[0].BarIndices.Count);
        }

        /// <summary>
        /// 2026-10-09: «First/Last» дүрслэлтэй олонлог (харагдацад 2 захын ширхэг л зурагдана) — MRA олонлогийг бүхэлд нь хэмжинэ (тархалт 1800),
        /// тусдаа шошгоны leader-ийг харин ЗУРАГДСАН ширхэг рүү (голын нуугдсан ширхэг рүү биш).
        /// </summary>
        [Test]
        public static void Presentation_limited_set_still_gets_mra_and_the_tag_points_at_a_drawn_bar()
        {
            RfSetSample s = Parallel(1);
            for (int i = 0; i < s.Centres.Count; i++)
            {
                s.BarIndices.Add(i);
                s.Shown.Add(i == 0 || i == s.Centres.Count - 1);
            }
            RfSetMraOptions o = Opt(100);
            o.Tags = true;
            RfSetMraResult r = RfSetMraPlanner.Build(new[] { s }, o);
            Assert.Eq(1, r.Plans.Count, "MRA тавигдана");
            Assert.Near(1800 * Mm, r.Plans[0].Spread, 1e-9, "тархалт = бүх ширхэг");
            Assert.Eq(1, r.Tags.Count);
            Assert.True(r.Tags[0].BarIndex == 0 || r.Tags[0].BarIndex == 9, "шошго зурагдсан ширхэг рүү, гарсан: " + r.Tags[0].BarIndex);
        }
    }
}
