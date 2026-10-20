using System;
using System.Collections.Generic;
using System.Linq;
using RevitMcpAddin.Reinforcement.Core;

namespace RevitMcpAddin.Reinforcement.Tests
{
    /// <summary>Дэлгээсийн шошго / MRA / давхцал / тэнхлэгийн гинжний байрлал (цэвэр цөм).</summary>
    public static class ElevationTests
    {
        private const double Mm = 1.0 / 304.8;

        private static RfElevInput Beam()
        {
            var i = new RfElevInput { BeamU0 = 0, BeamU1 = 18000 * Mm, BeamV0 = 0, BeamV1 = 500 * Mm };
            i.Options.TagOffsetFt = 100 * Mm;
            i.Options.TagGapFt = 40 * Mm;
            i.Options.DimPitchFt = 150 * Mm;
            i.Options.DefaultTagWidthFt = 300 * Mm;
            i.Options.DefaultTagHeightFt = 120 * Mm;
            return i;
        }

        private static RfElevBar Bar(long id, double u0Mm, double u1Mm, double vMm, double dia = 18, string group = "")
        {
            return new RfElevBar
            {
                Id = id, Group = group, Diameter = dia * Mm, U0 = u0Mm * Mm, U1 = u1Mm * Mm,
                AnchorV = vMm * Mm, MeanV = vMm * Mm, Straight = true, HasEndRefs = true,
            };
        }

        // ── Dodge ──────────────────────────────────────────────────────

        [Test]
        public static void Dodge_keeps_visible_gap_exactly_the_user_value()
        {
            // Гурван шошго ижил цэгт хүсэж байна — хөрш хоёрын ХАРАГДАХ зай = gap ЯГ.
            double[] xs = RfElevPlanner.Dodge(new[] { 1000.0, 1000.0, 1000.0 }, new[] { 300.0, 300.0, 300.0 }, 40);
            Assert.Near(340.0, xs[1] - xs[0], 1e-9, "төв хоорондын зай = өргөн + gap");
            Assert.Near(340.0, xs[2] - xs[1], 1e-9);
            Assert.Near(1000.0, xs.Average(), 1e-9, "дундаж хазайлт 0 — аль нэг тийш нүүхгүй");
        }

        [Test]
        public static void Dodge_leaves_far_apart_tags_untouched_and_respects_unequal_widths()
        {
            double[] xs = RfElevPlanner.Dodge(new[] { 0.0, 5000.0 }, new[] { 300.0, 900.0 }, 40);
            Assert.Near(0.0, xs[0], 1e-9);
            Assert.Near(5000.0, xs[1], 1e-9);
            double[] t = RfElevPlanner.Dodge(new[] { 1000.0, 1100.0 }, new[] { 300.0, 900.0 }, 40);
            Assert.Near((300.0 + 900.0) / 2 + 40, t[1] - t[0], 1e-9, "өргөн өөр бол төвийн зай (w1+w2)/2 + gap");
        }

        [Test]
        public static void Dodge_never_reorders_and_handles_empty()
        {
            Assert.Eq(0, RfElevPlanner.Dodge(new double[0], new double[0], 10).Length);
            double[] xs = RfElevPlanner.Dodge(new[] { 100.0, 110.0, 5000.0, 5010.0 }, new[] { 200.0, 200.0, 200.0, 200.0 }, 20);
            for (int i = 1; i < xs.Length; i++) Assert.True(xs[i] > xs[i - 1], "дараалал хадгалагдана");
            Assert.True(xs[3] - xs[2] >= 220 - 1e-9);
        }

        // ── Шошго ──────────────────────────────────────────────────────

        [Test]
        public static void Tags_go_above_for_top_bars_below_for_bottom_bars_at_the_user_offset()
        {
            RfElevInput i = Beam();
            i.Bars.Add(Bar(1, 0, 8000, 460));   // дээд
            i.Bars.Add(Bar(2, 0, 8000, 40));    // доод
            RfElevPlan p = RfElevPlanner.Build(i, null);
            RfElevTagPlan top = p.Tags.First(t => t.BarId == 1), bot = p.Tags.First(t => t.BarId == 2);
            Assert.True(top.Side == RfElevSide.Top && bot.Side == RfElevSide.Bottom);
            Assert.Near(500 * Mm + 100 * Mm, top.Head.Y, 1e-9, "гишүүний дээд ирмэг + хэрэглэгчийн зай");
            Assert.Near(0 - 100 * Mm, bot.Head.Y, 1e-9, "доод ирмэг − хэрэглэгчийн зай");
            Assert.Near(4000 * Mm, top.Anchor.X, 1e-9, "арматурын дундаас");
            Assert.Near(460 * Mm, top.Anchor.Y, 1e-9, "leader арматур дээр");
        }

        [Test]
        public static void Same_group_bars_share_one_tag_and_use_the_longest_as_representative()
        {
            RfElevInput i = Beam();
            i.Bars.Add(Bar(1, 0, 3000, 460, 22, "A"));
            i.Bars.Add(Bar(2, 0, 9000, 460, 22, "A"));
            i.Bars.Add(Bar(3, 0, 5000, 460, 22, ""));
            i.Bars.Add(Bar(4, 0, 5000, 400, 22, ""));
            RfElevPlan p = RfElevPlanner.Build(i, null);
            Assert.Eq(3, p.Tags.Count, "А бүлэг 1 + бүлэггүй хоёр өөрийн tag");
            RfElevTagPlan a = p.Tags.First(t => t.GroupCount == 2);
            Assert.Eq(2L, a.BarId, "хамгийн урт");
        }

        [Test]
        public static void Neighbouring_tag_heads_are_separated_by_exactly_the_user_gap()
        {
            RfElevInput i = Beam();
            i.Bars.Add(Bar(1, 1000, 3000, 460));
            i.Bars.Add(Bar(2, 1200, 3200, 460));
            i.Bars.Add(Bar(3, 1400, 3400, 460));
            var sizes = new RfElevSizes();
            sizes.Tag[1] = new[] { 250 * Mm, 100 * Mm };
            sizes.Tag[2] = new[] { 400 * Mm, 100 * Mm };
            sizes.Tag[3] = new[] { 250 * Mm, 100 * Mm };
            RfElevPlan p = RfElevPlanner.Build(i, sizes);
            List<RfElevTagPlan> t = p.Tags.OrderBy(x => x.Head.X).ToList();
            for (int k = 0; k + 1 < t.Count; k++)
            {
                double visibleGap = (t[k + 1].Head.X - t[k].Head.X) - (t[k].Width + t[k + 1].Width) / 2;
                Assert.Near(40 * Mm, visibleGap, 1e-9, "харагдах зай = хэрэглэгчийн 40 мм (хэрэгсэл өөрөөсөө нэмэхгүй)");
            }
        }

        [Test]
        public static void Tag_anchor_is_clamped_inside_the_beam()
        {
            RfElevInput i = Beam();
            i.Bars.Add(Bar(1, -2000, 1000, 460)); // дам нуруунаас цухуйсан бэхэлгээ
            RfElevPlan p = RfElevPlanner.Build(i, null);
            Assert.True(p.Tags[0].Anchor.X >= 0 - 1e-9);
        }

        // ── Хомутын MRA ────────────────────────────────────────────────

        [Test]
        public static void Stirrup_sets_get_one_mra_each_single_stirrups_are_skipped_with_a_warning()
        {
            RfElevInput i = Beam();
            i.Stirrups.Add(new RfElevStirrup { Id = 10, U0 = 0, U1 = 1500 * Mm, Count = 8 });
            i.Stirrups.Add(new RfElevStirrup { Id = 11, U0 = 1700 * Mm, U1 = 6000 * Mm, Count = 22 });
            i.Stirrups.Add(new RfElevStirrup { Id = 12, U0 = 7000 * Mm, U1 = 7000 * Mm, Count = 1 });
            RfElevPlan p = RfElevPlanner.Build(i, null);
            Assert.Eq(2, p.Mras.Count);
            Assert.True(p.Warnings.Any(w => w.Code == RfElevWarn.StirrupSingle && w.Arg == "12"));
            Assert.True(p.Mras[0].LineV < 0, "хэмжээс дам нурууны доор");
            Assert.True(p.Mras[0].Head.Y > p.Mras[0].LineV, "шошго хэмжээсийн шугамаас дээш");
        }

        [Test]
        public static void Mra_tags_respect_the_user_gap_too()
        {
            RfElevInput i = Beam();
            i.Stirrups.Add(new RfElevStirrup { Id = 10, U0 = 0, U1 = 400 * Mm, Count = 4 });
            i.Stirrups.Add(new RfElevStirrup { Id = 11, U0 = 250 * Mm, U1 = 650 * Mm, Count = 4 });
            RfElevPlan p = RfElevPlanner.Build(i, null);
            double gap = (p.Mras[1].Head.X - p.Mras[0].Head.X) - (p.Mras[0].Width + p.Mras[1].Width) / 2;
            Assert.Near(40 * Mm, gap, 1e-9);
        }

        // ── Давхцал ────────────────────────────────────────────────────

        [Test]
        public static void Lap_pairs_are_found_for_same_row_same_diameter_partial_overlap()
        {
            RfElevInput i = Beam();
            i.Bars.Add(Bar(1, 0, 11000, 460, 12));
            i.Bars.Add(Bar(2, 10500, 13500, 460, 12));   // 500 давхцал
            i.Bars.Add(Bar(3, 20000, 22000, 460, 22));   // давхцахгүй
            i.Bars.Add(Bar(4, 5000, 9000, 40, 12));      // доод тал
            RfElevPlan p = RfElevPlanner.Build(i, null);
            Assert.Eq(1, p.Laps.Count);
            RfElevLapPlan l = p.Laps[0];
            Assert.Eq(1L, l.BarA); Assert.Eq(2L, l.BarB);
            Assert.Near(500 * Mm, l.Length, 1e-9);
            Assert.True(l.Side == RfElevSide.Top);
            Assert.True(l.LineV > 500 * Mm, "дээд лавлагаа гишүүний дээр");
        }

        [Test]
        public static void Lap_between_different_diameters_is_still_a_lap()
        {
            // Бодит дам нуруу: Ø22 тулгуурын арматур (4092…8092) ↔ Ø12 мөрийн арматур (7592…10592) — 500 давхцал.
            RfElevInput i = Beam();
            i.Bars.Add(Bar(1, 4092, 8092, 12380 - 11919, 22));
            i.Bars.Add(Bar(2, 7592, 10592, 12350 - 11919, 12));
            RfElevPlan p = RfElevPlanner.Build(i, null);
            Assert.Eq(1, p.Laps.Count);
            Assert.Near(500 * Mm, p.Laps[0].Length, 1e-9);
        }

        [Test]
        public static void Laps_are_not_made_for_bent_bars_or_when_disabled()
        {
            RfElevInput i = Beam();
            RfElevBar a = Bar(1, 0, 11000, 460, 12), b = Bar(2, 10500, 13500, 460, 12);
            b.Straight = false;
            i.Bars.Add(a); i.Bars.Add(b);
            Assert.Eq(0, RfElevPlanner.Build(i, null).Laps.Count);
            b.Straight = true;
            i.Options.LapDims = false;
            Assert.Eq(0, RfElevPlanner.Build(i, null).Laps.Count);
        }

        [Test]
        public static void Lap_longer_than_the_cap_or_shorter_than_4_diameters_is_not_a_lap()
        {
            RfElevInput i = Beam();
            i.Bars.Add(Bar(1, 0, 11000, 460, 12));
            i.Bars.Add(Bar(2, 4000, 14000, 460, 12));    // 7 м — хэт урт
            i.Bars.Add(Bar(3, 10990, 15000, 460, 12));   // 10 мм — хэт богино
            RfElevPlan p = RfElevPlanner.Build(i, null);
            Assert.Eq(0, p.Laps.Count(l => l.BarA == 1 && l.BarB == 2));
            Assert.Eq(0, p.Laps.Count(l => l.BarA == 1 && l.BarB == 3));
        }

        // ── Тэнхлэг ────────────────────────────────────────────────────

        [Test]
        public static void Span_chain_and_overall_are_stacked_below_everything_else()
        {
            RfElevInput i = Beam();
            foreach (double g in new[] { 0.0, 6000, 12000, 18000 }) i.GridU.Add(g * Mm);
            i.Bars.Add(Bar(2, 0, 8000, 40));
            i.Stirrups.Add(new RfElevStirrup { Id = 10, U0 = 0, U1 = 1500 * Mm, Count = 8 });
            RfElevPlan p = RfElevPlanner.Build(i, null);
            Assert.Eq(2, p.Spans.Count);
            RfElevSpanPlan chain = p.Spans.First(s => !s.Overall), total = p.Spans.First(s => s.Overall);
            Assert.Eq(4, chain.GridU.Count);
            Assert.Eq(2, total.GridU.Count);
            double lowestOther = Math.Min(p.Mras.Min(m => m.LineV), p.Tags.Min(t => t.Head.Y));
            Assert.True(chain.LineV < lowestOther, "тэнхлэгийн гинж хомутын хэмжээсээс доор");
            Assert.True(total.LineV < chain.LineV, "нийт хамгийн доор");
        }

        [Test]
        public static void Grids_outside_the_beam_are_ignored_and_two_grids_give_no_overall()
        {
            RfElevInput i = Beam();
            i.GridU.Add(-5000 * Mm); i.GridU.Add(-300 * Mm); i.GridU.Add(6000 * Mm); i.GridU.Add(50000 * Mm);
            RfElevPlan p = RfElevPlanner.Build(i, null);
            Assert.Eq(1, p.Spans.Count);
            Assert.Eq(2, p.Spans[0].GridU.Count);
            Assert.False(p.Spans[0].Overall);
        }

        [Test]
        public static void Rows_do_not_overlap_below_the_beam()
        {
            RfElevInput i = Beam();
            i.Bars.Add(Bar(1, 0, 11000, 40, 12));
            i.Bars.Add(Bar(2, 10500, 13500, 40, 12));
            i.Stirrups.Add(new RfElevStirrup { Id = 10, U0 = 0, U1 = 1500 * Mm, Count = 8 });
            RfElevPlan p = RfElevPlanner.Build(i, null);
            double barTag = p.Tags.Min(t => t.Head.Y);
            double lap = p.Laps[0].LineV;
            double mraTag = p.Mras[0].Head.Y;
            double mraLine = p.Mras[0].LineV;
            Assert.True(barTag > lap && lap > mraTag && mraTag > mraLine, "шошго → давхцал → хомутын шошго → хомутын хэмжээс");
        }

        [Test]
        public static void Empty_or_degenerate_beam_gives_a_warning_and_nothing_else()
        {
            var i = new RfElevInput { BeamU0 = 0, BeamU1 = 0, BeamV0 = 0, BeamV1 = 0 };
            RfElevPlan p = RfElevPlanner.Build(i, null);
            Assert.True(p.Warnings.Any(w => w.Code == RfElevWarn.NoBeamExtent));
            Assert.Eq(0, p.Tags.Count + p.Mras.Count + p.Laps.Count + p.Spans.Count);
        }

        [Test]
        public static void Switching_features_off_removes_only_those_outputs()
        {
            RfElevInput i = Beam();
            i.Bars.Add(Bar(1, 0, 11000, 460, 12));
            i.Bars.Add(Bar(2, 10500, 13500, 460, 12));
            i.Stirrups.Add(new RfElevStirrup { Id = 10, U0 = 0, U1 = 1500 * Mm, Count = 8 });
            i.GridU.Add(0); i.GridU.Add(6000 * Mm);
            i.Options.TagBars = false;
            RfElevPlan p = RfElevPlanner.Build(i, null);
            Assert.Eq(0, p.Tags.Count);
            Assert.Eq(1, p.Mras.Count); Assert.Eq(1, p.Laps.Count); Assert.Eq(1, p.Spans.Count);
            i.Options.StirrupMra = false; i.Options.LapDims = false; i.Options.SpanDims = false;
            p = RfElevPlanner.Build(i, null);
            Assert.Eq(0, p.Tags.Count + p.Mras.Count + p.Laps.Count + p.Spans.Count);
        }
    }
}
