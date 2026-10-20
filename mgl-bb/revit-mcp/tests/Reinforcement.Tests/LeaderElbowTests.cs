using RevitMcpAddin.Reinforcement.Core;

namespace RevitMcpAddin.Reinforcement.Tests
{
    /// <summary>Шошгоны leader-ийн 3 цэг: 3→2 (хэвтээ), 2→1 (налуу хэсгийн хэвтээ зай).  Цэвэр цөм.</summary>
    public static class LeaderElbowTests
    {
        private const double Mm = 1.0 / 304.8;

        [Test]
        public static void Auto_when_both_zero_changes_nothing()
        {
            RfLeaderShape s = RfLeaderElbow.Shape(new RfV2(0, 0), new RfV2(-500 * Mm, 300 * Mm), 160 * Mm, 0, 0, -1);
            Assert.False(s.Applied);
            Assert.Near(-500 * Mm, s.Head.X, 1e-12);
        }

        [Test]
        public static void Both_set_places_elbow_by_run_and_moves_head_by_landing_left_side()
        {
            // Шошго арматурын зүүн талд (зурагтай адил).  2→1 = 40 мм, 3→2 = 90 мм, шошго 160 мм өргөн.
            var target = new RfV2(0, 0);
            RfLeaderShape s = RfLeaderElbow.Shape(target, new RfV2(-700 * Mm, 300 * Mm), 160 * Mm, 90 * Mm, 40 * Mm, -1);
            Assert.True(s.Applied);
            Assert.Near(-40 * Mm, s.Elbow.X, 1e-9, "elbow арматураас 40 мм зүүн");
            Assert.Near(300 * Mm, s.Elbow.Y, 1e-9, "elbow шошгоны түвшинд (хэвтээ landing)");
            // Шошгоны БАРУУН ирмэг = төв + хагас өргөн; elbow-оос 90 мм зайтай байх ёстой.
            double rightEdge = s.Head.X + 80 * Mm;
            Assert.Near(90 * Mm, s.Elbow.X - rightEdge, 1e-9, "3→2 = 90 мм");
            Assert.Near(300 * Mm, s.Head.Y, 1e-9, "босоо чиглэлд шошго зөөгдөхгүй");
        }

        [Test]
        public static void Both_set_mirrors_on_the_right_side()
        {
            RfLeaderShape s = RfLeaderElbow.Shape(new RfV2(0, 0), new RfV2(900 * Mm, -200 * Mm), 160 * Mm, 90 * Mm, 40 * Mm, -1);
            Assert.Near(40 * Mm, s.Elbow.X, 1e-9);
            double leftEdge = s.Head.X - 80 * Mm;
            Assert.Near(90 * Mm, leftEdge - s.Elbow.X, 1e-9);
        }

        [Test]
        public static void Landing_only_keeps_head_and_measures_from_tag_edge()
        {
            var head = new RfV2(-700 * Mm, 300 * Mm);
            RfLeaderShape s = RfLeaderElbow.Shape(new RfV2(0, 0), head, 160 * Mm, 100 * Mm, 0, -1);
            Assert.True(s.Applied);
            Assert.Near(head.X, s.Head.X, 1e-12, "шошго зөөгдөхгүй");
            Assert.Near(100 * Mm, s.Elbow.X - (head.X + 80 * Mm), 1e-9);
            Assert.True(s.Note == null, "бүрэн биелсэн");
        }

        [Test]
        public static void Landing_only_longer_than_gap_clamps_elbow_on_the_bar_and_says_so()
        {
            RfLeaderShape s = RfLeaderElbow.Shape(new RfV2(0, 0), new RfV2(-200 * Mm, 300 * Mm), 160 * Mm, 500 * Mm, 0, -1);
            Assert.Near(0, s.Elbow.X, 1e-12, "арматурыг гатлахгүй");
            Assert.True(s.Note != null, "ил мэдэгдэнэ");
        }

        [Test]
        public static void Run_only_keeps_head_and_clamps_inside_tag()
        {
            var head = new RfV2(-700 * Mm, 300 * Mm);
            RfLeaderShape s = RfLeaderElbow.Shape(new RfV2(0, 0), head, 160 * Mm, 0, 60 * Mm, -1);
            Assert.Near(-60 * Mm, s.Elbow.X, 1e-9);
            Assert.Near(head.X, s.Head.X, 1e-12);
            Assert.True(s.Note == null);

            RfLeaderShape t = RfLeaderElbow.Shape(new RfV2(0, 0), new RfV2(-100 * Mm, 300 * Mm), 160 * Mm, 0, 500 * Mm, -1);
            Assert.Near(-100 * Mm + 80 * Mm, t.Elbow.X, 1e-9, "шошгоны ирмэгт");
            Assert.True(t.Note != null);
        }

        [Test]
        public static void Directly_above_uses_the_fallback_side()
        {
            Assert.Eq(-1, RfLeaderElbow.SideSign(1.0, 1.0, -1));
            Assert.Eq(1, RfLeaderElbow.SideSign(1.0, 1.0, 1));
            Assert.Eq(1, RfLeaderElbow.SideSign(2.0, 1.0, -1), "тод зөрүүтэй бол fallback үл хамаарна");
            RfLeaderShape s = RfLeaderElbow.Shape(new RfV2(0, 0), new RfV2(0, 300 * Mm), 160 * Mm, 90 * Mm, 40 * Mm, -1);
            Assert.True(s.Head.X < 0, "fallback −1 → шошго арматурын зүүн тал руу зөөгдөнө");
        }
    }
}
