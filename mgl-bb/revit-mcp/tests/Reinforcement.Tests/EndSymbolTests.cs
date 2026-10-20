using System;
using System.Collections.Generic;
using System.Linq;
using RevitMcpAddin.Reinforcement.Core;

namespace RevitMcpAddin.Reinforcement.Tests
{
    public static class EndSymbolTests
    {
        private const double Eps = 1e-9;

        private static RfViewFrame Plan()
        {
            // Давхрын план: Right=X, Up=Y, Normal(харагчийн зүг)=Z.
            return new RfViewFrame(new RfV3(0, 0, 0), new RfV3(1, 0, 0), new RfV3(0, 1, 0), new RfV3(0, 0, 1));
        }

        /// <summary>Босоо тэнхлэгийн (Z) эргэн тойронд θ-ээр эргэсэн зүсэлтийн харагдац (Right зэрэгцээ, Up = Z).</summary>
        private static RfViewFrame RotatedSection(double thetaRad)
        {
            var right = new RfV3(Math.Cos(thetaRad), Math.Sin(thetaRad), 0);
            var up = new RfV3(0, 0, 1);
            RfV3 normal = right.Cross(up); // Right × Up = ViewDirection
            return new RfViewFrame(new RfV3(0, 0, 0), right, up, normal);
        }

        [Test]
        public static void Outward_start_is_minus_tangent_end_is_plus()
        {
            RfV3 t = new RfV3(2, 0, 0);
            RfV3 s = RfEndSymbolMath.OutwardTangent(t, RfEndKind.Start);
            RfV3 e = RfEndSymbolMath.OutwardTangent(t, RfEndKind.End);
            Assert.Near(-1, s.X, Eps);
            Assert.Near(1, e.X, Eps);
            Assert.Near(1, s.Length, Eps);
        }

        [Test]
        public static void Reversed_bar_swaps_which_end_points_where()
        {
            // Нэг шулуун: чиглэл буцсан арматур → эхлэл/төгсгөл солигдоно, «гадагш» чиглэл нь ЯГ ЭСРЭГ.
            RfV3 forward = new RfV3(1, 0, 0);
            RfV3 reversed = new RfV3(-1, 0, 0);
            RfV3 sA = RfEndSymbolMath.OutwardTangent(forward, RfEndKind.Start);
            RfV3 sB = RfEndSymbolMath.OutwardTangent(reversed, RfEndKind.Start);
            Assert.Near(0, (sA + sB).Length, Eps);
        }

        [Test]
        public static void Angle_plan_horizontal_and_vertical()
        {
            double a;
            Assert.True(RfEndSymbolMath.TryViewAngle(Plan(), new RfV3(1, 0, 0), out a));
            Assert.Near(0, a, Eps);
            Assert.True(RfEndSymbolMath.TryViewAngle(Plan(), new RfV3(0, 1, 0), out a));
            Assert.Near(Math.PI / 2, a, Eps);
            Assert.True(RfEndSymbolMath.TryViewAngle(Plan(), new RfV3(-1, 0, 0), out a));
            Assert.Near(Math.PI, Math.Abs(a), Eps);
        }

        [Test]
        public static void Angle_in_rotated_section_does_not_assume_world_xy()
        {
            // Зүсэлтийн харагдац 30°-аар эргэсэн.  Дэлхийн X дагуух арматур харагдац дээр 0° БИШ харин ±30° харагдана:
            // харагдацын Right нь (cos30, sin30, 0) тул X-ийн Right дээрх буулт cos30, Up дээр 0 → өнцөг 0.
            RfViewFrame f = RotatedSection(30 * Math.PI / 180);
            double a;
            Assert.True(RfEndSymbolMath.TryViewAngle(f, new RfV3(1, 0, 0), out a));
            Assert.Near(0, a, Eps, "X дагуух арматур Up-д перпендикуляр");

            // Харагдацын Right-тай параллель арматур (30° дэлхийн чиглэл) → яг 0°.
            Assert.True(RfEndSymbolMath.TryViewAngle(f, new RfV3(Math.Cos(Math.PI / 6), Math.Sin(Math.PI / 6), 0), out a));
            Assert.Near(0, a, Eps);

            // Босоо арматур → 90°.
            Assert.True(RfEndSymbolMath.TryViewAngle(f, new RfV3(0, 0, 1), out a));
            Assert.Near(Math.PI / 2, a, Eps);

            // Харагдацын нормальтай параллель (чиг нь харагдац руу заана) → end-on.
            RfV3 n = f.Normal;
            Assert.False(RfEndSymbolMath.TryViewAngle(f, n, out a), "end-on");
        }

        [Test]
        public static void Angle_45_degree_bar_in_rotated_view()
        {
            RfViewFrame f = RotatedSection(90 * Math.PI / 180); // Right = +Y
            double a;
            // Дэлхийн +Y дагуу, +Z-тэй 45°: (0, 1, 1)/√2 → Right дээр 0.707, Up дээр 0.707 → 45°
            Assert.True(RfEndSymbolMath.TryViewAngle(f, new RfV3(0, 1, 1), out a));
            Assert.Near(Math.PI / 4, a, 1e-9);
        }

        [Test]
        public static void Placement_projects_onto_view_plane_and_applies_offset_outward()
        {
            RfViewFrame f = Plan();
            RfV3 p = RfEndSymbolMath.PlacementPoint(f, new RfV3(10, 5, 7), new RfV3(1, 0, 0), 2);
            Assert.Near(12, p.X, Eps);
            Assert.Near(5, p.Y, Eps);
            Assert.Near(0, p.Z, Eps, "харагдацын хавтгай руу тусгана");

            RfV3 q = RfEndSymbolMath.PlacementPoint(f, new RfV3(10, 5, 7), new RfV3(0, 0, 1), 3);
            Assert.Near(10, q.X, Eps);
            Assert.Near(5, q.Y, Eps, "харагдацын нормаль дагуух оффсет нь тусгалд нөлөөлөхгүй");
        }

        [Test]
        public static void Rotation_to_apply_subtracts_family_natural_direction()
        {
            Assert.Near(0, RfEndSymbolMath.RotationToApply(Math.PI / 2, Math.PI / 2), Eps);
            Assert.Near(Math.PI / 2, RfEndSymbolMath.RotationToApply(Math.PI / 2, 0), Eps);
            // 170° - (-170°) = 340° → -20°
            double r = RfEndSymbolMath.RotationToApply(170 * Math.PI / 180, -170 * Math.PI / 180);
            Assert.Near(-20 * Math.PI / 180, r, 1e-9);
        }

        [Test]
        public static void NormalizeAngle_range()
        {
            Assert.Near(Math.PI, RfEndSymbolMath.NormalizeAngle(-Math.PI), Eps);
            Assert.Near(0, RfEndSymbolMath.NormalizeAngle(4 * Math.PI), Eps);
            Assert.Near(-Math.PI / 2, RfEndSymbolMath.NormalizeAngle(3 * Math.PI / 2), Eps);
        }

        [Test]
        public static void Wants_place_modes()
        {
            Assert.True(RfEndSymbolMath.Wants(RfPlaceMode.Both, RfEndKind.Start));
            Assert.True(RfEndSymbolMath.Wants(RfPlaceMode.Both, RfEndKind.End));
            Assert.True(RfEndSymbolMath.Wants(RfPlaceMode.StartOnly, RfEndKind.Start));
            Assert.False(RfEndSymbolMath.Wants(RfPlaceMode.StartOnly, RfEndKind.End));
            Assert.False(RfEndSymbolMath.Wants(RfPlaceMode.EndOnly, RfEndKind.Start));
        }

        [Test]
        public static void SelectBars_single_bar_set_all_and_firstlast()
        {
            Assert.SeqEq(new[] { 0 }, RfEndSymbolMath.SelectBars(new[] { 0 }, RfPresentation.All, RfBarSetMode.All));
            Assert.SeqEq(new[] { 0 }, RfEndSymbolMath.SelectBars(new[] { 0 }, RfPresentation.All, RfBarSetMode.FirstLast));
        }

        [Test]
        public static void SelectBars_modes_and_gaps()
        {
            var idx = new[] { 0, 1, 2, 4, 5 }; // 3-р ширхэг оролцоогүй (SetBarIncluded=false)
            Assert.SeqEq(idx, RfEndSymbolMath.SelectBars(idx, RfPresentation.All, RfBarSetMode.All));
            Assert.SeqEq(new[] { 0, 5 }, RfEndSymbolMath.SelectBars(idx, RfPresentation.All, RfBarSetMode.FirstLast));
            Assert.SeqEq(new[] { 0, 5 }, RfEndSymbolMath.SelectBars(idx, RfPresentation.FirstLast, RfBarSetMode.All));
            Assert.SeqEq(new[] { 2 }, RfEndSymbolMath.SelectBars(idx, RfPresentation.Middle, RfBarSetMode.All));
            Assert.SeqEq(idx, RfEndSymbolMath.SelectBars(idx, RfPresentation.Select, RfBarSetMode.All));
            Assert.Eq(0, RfEndSymbolMath.SelectBars(new int[0], RfPresentation.All, RfBarSetMode.All).Count);
        }

        [Test]
        public static void DupKey_distinguishes_rebar_end_and_bar()
        {
            string a = RfEndSymbolMath.DupKey("uid1", RfEndKind.Start, 0, true);
            Assert.True(a != RfEndSymbolMath.DupKey("uid1", RfEndKind.End, 0, true));
            Assert.True(a != RfEndSymbolMath.DupKey("uid1", RfEndKind.Start, 1, true));
            Assert.True(a != RfEndSymbolMath.DupKey("uid2", RfEndKind.Start, 0, true));
            Assert.Eq(a, RfEndSymbolMath.DupKey("uid1", RfEndKind.Start, 0, true));
        }

        [Test]
        public static void InsideRect_with_tolerance()
        {
            Assert.True(RfEndSymbolMath.InsideRect(new RfV2(1, 1), new RfV2(0, 0), new RfV2(2, 2)));
            Assert.True(RfEndSymbolMath.InsideRect(new RfV2(2, 2), new RfV2(0, 0), new RfV2(2, 2)));
            Assert.False(RfEndSymbolMath.InsideRect(new RfV2(2.1, 1), new RfV2(0, 0), new RfV2(2, 2)));
        }

        [Test]
        public static void ViewFrame_roundtrip_in_rotated_view()
        {
            RfViewFrame f = RotatedSection(37 * Math.PI / 180);
            var p = new RfV3(3.2, -1.1, 4.4);
            RfV2 uv = f.ToView(p);
            RfV3 back = f.ToModel(uv);
            // ToModel нь зөвхөн хавтгай дээрх цэг буцаана: p-ийн хавтгайд тусгалтай тэнцүү.
            RfV3 proj = f.Project(p);
            Assert.Near(0, (back - proj).Length, 1e-9);
            Assert.Near(0, f.DepthOf(back), 1e-9);
        }
    }
}
