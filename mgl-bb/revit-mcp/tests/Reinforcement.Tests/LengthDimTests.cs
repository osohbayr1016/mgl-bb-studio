using System;
using System.Collections.Generic;
using System.Linq;
using RevitMcpAddin.Reinforcement.Core;

namespace RevitMcpAddin.Reinforcement.Tests
{
    /// <summary>«Арматурын урт хэмжих»: сонгосон арматуруудын төгсгөлүүдээр үргэлжилсэн хэмжээс, шугам нь дарсан цэгээр.</summary>
    public static class LengthDimTests
    {
        private const double Mm = 1.0 / 304.8;

        /// <summary>Шулуун арматур (мм): (x0, y0) → (x1, y1), үзүүрийн шүргэгч нь арматурын чиглэлээр.</summary>
        private static RfLenBar Straight(long id, double x0, double y0, double x1, double y1, double dia = 20)
        {
            var a = new RfV2(x0 * Mm, y0 * Mm);
            var b = new RfV2(x1 * Mm, y1 * Mm);
            RfV2 d = (b - a).Normalized();
            return new RfLenBar { Id = id, A = a, B = b, OutA = -d, OutB = d, Diameter = dia * Mm };
        }

        private static List<double> PosMm(RfLenChain c)
        {
            return c.Positions.Select(p => Math.Round(p / Mm, 3)).ToList();
        }

        [Test]
        public static void Single_bar_gives_its_length_on_a_line_through_the_click()
        {
            RfLenPlan p = RfLengthDimPlanner.Build(new[] { Straight(1, 0, 0, 3000, 0) }, new RfV2(1500 * Mm, -400 * Mm));
            Assert.Eq(1, p.Chains.Count);
            RfLenChain c = p.Chains[0];
            Assert.Eq(2, c.Refs.Count);
            Assert.Near(3000, (c.Refs[1].S - c.Refs[0].S) / Mm, 1e-6);
            // Шугам дарсан цэгийн перпендикуляр байрлалаар (y = −400), арматурын хоёр үзүүрийн хооронд.
            Assert.Near(-400, c.LineStart.Y / Mm, 1e-6);
            Assert.Near(-400, c.LineEnd.Y / Mm, 1e-6);
            Assert.Near(0, c.LineStart.X / Mm, 1e-6);
            Assert.Near(3000, c.LineEnd.X / Mm, 1e-6);
        }

        [Test]
        public static void Lapped_column_bars_chain_length_lap_length()
        {
            // Багана: доод арматур 0…3500, дээд 3000…6500 (давхцал 500) — босоо, дэлгээсэд.
            var bars = new[] { Straight(1, 0, 0, 0, 3500), Straight(2, 40, 3000, 40, 6500) };
            RfLenPlan p = RfLengthDimPlanner.Build(bars, new RfV2(-300 * Mm, 1000 * Mm));
            Assert.Eq(1, p.Chains.Count);
            RfLenChain c = p.Chains[0];
            Assert.True(PosMm(c).SequenceEqual(new double[] { 0, 3000, 3500, 6500 }), string.Join(",", PosMm(c)));
            Assert.Eq(2, c.BarIds.Count);
            Assert.True(c.Refs[1].BarId == 2 && c.Refs[1].IsStart, "3000 = дээд арматурын эхлэл");
            Assert.True(c.Refs[2].BarId == 1 && !c.Refs[2].IsStart, "3500 = доод арматурын төгсгөл");
            Assert.Near(-300, c.LineStart.X / Mm, 1e-6);
        }

        [Test]
        public static void Butt_joined_bars_merge_the_shared_end_so_each_bar_reads_its_own_length()
        {
            var bars = new[] { Straight(1, 0, 0, 2000, 0), Straight(2, 2000.2, 0, 5000, 0) };
            RfLenPlan p = RfLengthDimPlanner.Build(bars, new RfV2(0, 200 * Mm));
            RfLenChain c = p.Chains[0];
            Assert.Eq(3, c.Refs.Count);
            Assert.Eq(1, c.Merged);
        }

        [Test]
        public static void Opposite_direction_bars_are_one_group_and_order_is_by_position()
        {
            // Эсрэг чиглэлтэй зурсан зэрэгцээ арматур — нэг хэмжээс.
            var bars = new[] { Straight(1, 4000, 0, 1000, 0), Straight(2, 0, 150, 2500, 150) };
            RfLenPlan p = RfLengthDimPlanner.Build(bars, new RfV2(0, 500 * Mm));
            Assert.Eq(1, p.Chains.Count);
            Assert.True(PosMm(p.Chains[0]).SequenceEqual(new double[] { 0, 1000, 2500, 4000 }), string.Join(",", PosMm(p.Chains[0])));
        }

        [Test]
        public static void Perpendicular_groups_get_separate_chains()
        {
            // Хучилт: X ба Y чиглэлийн арматур нэг дор сонгосон.
            var bars = new[] { Straight(1, 0, 0, 6000, 0), Straight(2, 0, 0, 0, 4500), Straight(3, 0, 200, 6000, 200) };
            RfLenPlan p = RfLengthDimPlanner.Build(bars, new RfV2(-500 * Mm, -500 * Mm));
            Assert.Eq(2, p.Chains.Count);
            RfLenChain x = p.Chains.Single(c => Math.Abs(c.Dir.X) > 0.9);
            RfLenChain y = p.Chains.Single(c => Math.Abs(c.Dir.Y) > 0.9);
            Assert.Eq(2, x.BarIds.Count);
            Assert.Eq(2, x.Refs.Count);      // ижил үзүүртэй хоёр арматур — давхцсан төгсгөл нэг болно
            Assert.Eq(2, x.Merged);
            Assert.Near(4500, (y.Refs[1].S - y.Refs[0].S) / Mm, 1e-6);
        }

        [Test]
        public static void Bar_seen_end_on_is_skipped_with_a_reason()
        {
            var dot = new RfLenBar { Id = 7, A = new RfV2(0, 0), B = new RfV2(0.5 * Mm, 0), OutA = new RfV2(0, 0), OutB = new RfV2(0, 0) };
            RfLenPlan p = RfLengthDimPlanner.Build(new[] { dot, Straight(1, 0, 0, 1000, 0) }, new RfV2(0, -100 * Mm));
            Assert.Eq(1, p.Chains.Count);
            Assert.Eq(1, p.Skipped.Count);
            Assert.Eq(RfLenSkipReason.SeenEndOn, p.Skipped[0].Reason);
        }

        [Test]
        public static void L_and_U_shaped_bars_are_not_measured_as_a_straight_length()
        {
            // L: эхлэл X тийш, төгсгөл Y тийш.
            var l = new RfLenBar { Id = 1, A = new RfV2(0, 0), B = new RfV2(1000 * Mm, 500 * Mm), OutA = new RfV2(-1, 0), OutB = new RfV2(0, 1) };
            // U: хоёр үзүүр ижил тийш.
            var u = new RfLenBar { Id = 2, A = new RfV2(0, 0), B = new RfV2(0, 300 * Mm), OutA = new RfV2(1, 0), OutB = new RfV2(1, 0) };
            RfLenPlan p = RfLengthDimPlanner.Build(new[] { l, u }, new RfV2(0, 0));
            Assert.Eq(0, p.Chains.Count);
            Assert.Eq(2, p.Skipped.Count);
            Assert.True(p.Skipped.All(s => s.Reason == RfLenSkipReason.EndsNotAligned));
        }

        [Test]
        public static void Slightly_cranked_bar_still_measures_along_its_end_tangents()
        {
            // Нугалсан (cranked) баганын арматур: үзүүрүүд босоо, дунд нь 40 мм хажуу тийш — эхлэл/төгсгөлийн шулуун 0.7°-аар хазайна.
            var b = new RfLenBar { Id = 1, A = new RfV2(0, 0), B = new RfV2(40 * Mm, 3300 * Mm), OutA = new RfV2(0, -1), OutB = new RfV2(0, 1) };
            RfLenPlan p = RfLengthDimPlanner.Build(new[] { b }, new RfV2(-300 * Mm, 0));
            Assert.Eq(1, p.Chains.Count);
            Assert.Near(0, p.Chains[0].Dir.X, 1e-9);
            Assert.Near(3300, (p.Chains[0].Refs[1].S - p.Chains[0].Refs[0].S) / Mm, 1e-6);
        }

        [Test]
        public static void Rotated_view_direction_is_handled()
        {
            // 30° эргэсэн арматур (налуу хана, эргэсэн план).
            double a = 30 * Math.PI / 180;
            var bar = Straight(1, 0, 0, 2000 * Math.Cos(a), 2000 * Math.Sin(a));
            RfLenPlan p = RfLengthDimPlanner.Build(new[] { bar }, new RfV2(0, 300 * Mm));
            Assert.Near(2000, (p.Chains[0].Refs[1].S - p.Chains[0].Refs[0].S) / Mm, 1e-6);
            // Шугам арматуртай зэрэгцээ, дарсан цэгээр дайрна.
            RfV2 n = p.Chains[0].Dir.Perp();
            Assert.Near(new RfV2(0, 300 * Mm).Dot(n), p.Chains[0].LineStart.Dot(n), 1e-9);
            Assert.Near(new RfV2(0, 300 * Mm).Dot(n), p.Chains[0].LineEnd.Dot(n), 1e-9);
        }
    }
}
