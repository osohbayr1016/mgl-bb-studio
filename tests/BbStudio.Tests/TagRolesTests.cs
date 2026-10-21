using MglBb.Core;

namespace MglBb.Tests
{
    public static class TagRolesTests
    {
        // ЖИШЭЭ-2 «ОГТЛОЛ 2-2»: дамнуруу 500 × 720 (r 0…500, u 0…720); ажлын арматур эгнээ 670 (9 ⌀28), 600 (11 ⌀28), бөөр 470 / 250 (14 ⌀12), доод 50 (6 ⌀28).
        private const double R0 = 0, R1 = 500, U0 = 0, U1 = 720, Tol = 40;

        [Test]
        public static void RolesByOutermostLayers()
        {
            Assert.Eq(BbBarRole.Top, BbTagRoles.Classify(false, 670, 670, 50, U0, U1, Tol));
            Assert.Eq(BbBarRole.Side, BbTagRoles.Classify(false, 600, 670, 50, U0, U1, Tol), "дээд 2-р эгнээ = бөөрний дүрмээр");
            Assert.Eq(BbBarRole.Side, BbTagRoles.Classify(false, 470, 670, 50, U0, U1, Tol));
            Assert.Eq(BbBarRole.Bottom, BbTagRoles.Classify(false, 50, 670, 50, U0, U1, Tol));
            Assert.Eq(BbBarRole.Stirrup, BbTagRoles.Classify(true, 360, 670, 50, U0, U1, Tol));
            // Зөвхөн доод арматурт шошготой огтлол: хамгийн «дээд» нь доод хагаст — дээд биш.
            Assert.Eq(BbBarRole.Bottom, BbTagRoles.Classify(false, 50, 50, 50, U0, U1, Tol));
        }

        [Test]
        public static void MeasureThenTargetReturnsSameHead()
        {
            BbTagRoles.Measure(-170, 900, 670, R0, R1, out string side, out double dx, out double dy);
            Assert.Eq(BbTagRoles.Left, side);
            Assert.Near(170, dx, 1e-9);
            Assert.Near(230, dy, 1e-9);
            BbTagRoles.Target(side, dx, dy, 670, R0, R1, out double hr, out double hu);
            Assert.Near(-170, hr, 1e-9);
            Assert.Near(900, hu, 1e-9);
            BbTagRoles.Measure(700, 480, 470, R0, R1, out side, out dx, out dy);
            Assert.Eq(BbTagRoles.Right, side);
            Assert.Near(200, dx, 1e-9);
        }

        [Test]
        public static void SeparatePushesOverlapsDown()
        {
            // Бөөр 480 ба хомут 470 давхцана (зай 90) — хомут доош; хамгийн дээд хөдлөхгүй.
            double[] r = BbTagRoles.Separate(new[] { 470.0, 900, 480, 60 }, 90);
            Assert.Near(900, r[1], 1e-9);
            Assert.Near(480, r[2], 1e-9);
            Assert.Near(390, r[0], 1e-9);
            Assert.Near(60, r[3], 1e-9);
        }

        [Test]
        public static void MinGapBetweenHeads()
        {
            Assert.Near(27, BbTagRoles.MinGap(new[] { 452.0, 425, 380, 353, 313, 217 }).Value, 1e-9);
            Assert.True(BbTagRoles.MinGap(new[] { 1.0 }) == null);
        }

        [Test]
        public static void ElbowGoesTowardMember()
        {
            Assert.Near(600, BbTagRoles.ElbowR(BbTagRoles.Right, 700, 100), 1e-9);
            Assert.Near(-20, BbTagRoles.ElbowR(BbTagRoles.Left, -120, 100), 1e-9);
        }

        [Test]
        public static void UnlearnedRoleIsEmpty()
        {
            var ms = new BbMemberStandard();
            ms.RoleTag(BbBarRole.Stirrup, out string side, out double _, out double __);
            Assert.Eq("", side);
            ms.SecStirrupTagSide = "right"; ms.SecStirrupTagDxPaperMm = 10;
            ms.RoleTag(BbBarRole.Stirrup, out side, out double dx, out double ___);
            Assert.Eq("right", side);
            Assert.Near(10, dx, 1e-9);
        }
    }
}
