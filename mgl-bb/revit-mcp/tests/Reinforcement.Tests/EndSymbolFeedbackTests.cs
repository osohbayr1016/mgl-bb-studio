using System;
using System.Collections.Generic;
using System.Linq;
using RevitMcpAddin.Reinforcement.Core;

namespace RevitMcpAddin.Reinforcement.Tests
{
    /// <summary>
    /// Инженерийн санал (2026-10-02): «Эхний ширхэг» горим, Эхлэл/Төгсгөлийн БИЕ ДААСАН эргэлт.
    /// </summary>
    public static class EndSymbolFeedbackTests
    {
        private static List<int> Range(int from, int to)
        {
            var l = new List<int>();
            for (int i = from; i <= to; i++) l.Add(i);
            return l;
        }

        // ── Олонлогийн ширхэг сонгох ───────────────────────────────────

        [Test]
        public static void BarSet_20_bars_all_first_firstlast()
        {
            List<int> idx = Range(0, 19);
            Assert.Eq(20, RfEndSymbolMath.SelectBars(idx, RfPresentation.All, RfBarSetMode.All).Count, "Бүх ширхэг");
            Assert.SeqEq(new[] { 0 }, RfEndSymbolMath.SelectBars(idx, RfPresentation.All, RfBarSetMode.First));
            Assert.SeqEq(new[] { 0, 19 }, RfEndSymbolMath.SelectBars(idx, RfPresentation.All, RfBarSetMode.FirstLast));
        }

        [Test]
        public static void BarSet_single_bar_every_mode_gives_one_bar()
        {
            foreach (RfBarSetMode m in new[] { RfBarSetMode.All, RfBarSetMode.First, RfBarSetMode.FirstLast, RfBarSetMode.Nearest })
                Assert.SeqEq(new[] { 0 }, RfEndSymbolMath.SelectBars(new[] { 0 }, RfPresentation.All, m), m.ToString());
        }

        [Test]
        public static void BarSet_only_one_valid_position_firstlast_never_duplicates()
        {
            // 20 байрлалтай олонлогийн ЗӨВХӨН 5-р ширхэг бодитоор байгаа: «Эхний ба сүүлийн» нэг ширхэгт хоёр тэмдэг (давхар) тавихгүй.
            int[] only = { 5 };
            Assert.SeqEq(new[] { 5 }, RfEndSymbolMath.SelectBars(only, RfPresentation.All, RfBarSetMode.FirstLast));
            Assert.SeqEq(new[] { 5 }, RfEndSymbolMath.SelectBars(only, RfPresentation.All, RfBarSetMode.First));
        }

        [Test]
        public static void BarSet_first_is_first_EXISTING_position_when_leading_positions_are_excluded()
        {
            // 0 ба 1-р байрлал хасагдсан (DoesBarExistAtPosition = false) — «эхний» нь 2, «0 индекс» гэж таамаглахгүй.
            List<int> existing = Range(2, 19);
            Assert.SeqEq(new[] { 2 }, RfEndSymbolMath.SelectBars(existing, RfPresentation.All, RfBarSetMode.First));
            Assert.SeqEq(new[] { 2, 19 }, RfEndSymbolMath.SelectBars(existing, RfPresentation.All, RfBarSetMode.FirstLast));
            // Дундаас хасагдсан ч эхний нь өөрчлөгдөхгүй; сүүлийнх нь бодит сүүлийнх.
            var gap = new List<int> { 0, 1, 2, 7, 8 };
            Assert.SeqEq(new[] { 0 }, RfEndSymbolMath.SelectBars(gap, RfPresentation.All, RfBarSetMode.First));
            Assert.SeqEq(new[] { 0, 8 }, RfEndSymbolMath.SelectBars(gap, RfPresentation.All, RfBarSetMode.FirstLast));
        }

        [Test]
        public static void BarSet_first_is_not_the_lowest_id_or_nearest_it_is_native_order()
        {
            // Индексүүд нь Revit-ийн тархалтын дарааллаар (өсөх) ирнэ; «эхний» = тэр дарааллын эхний (хамгийн бага индекс), дарсан цэгээс үл хамаарна.
            Assert.SeqEq(new[] { 3 }, RfEndSymbolMath.SelectBars(new[] { 3, 4, 5, 9 }, RfPresentation.All, RfBarSetMode.First));
        }

        [Test]
        public static void BarSet_first_composes_with_presentation_mode_only_visible_pool()
        {
            List<int> idx = Range(0, 9);
            // Presentation «Эхний/Сүүлийн» (0, 9 харагдана) + «Эхний ширхэг» ⇒ 0.
            Assert.SeqEq(new[] { 0 }, RfEndSymbolMath.SelectBars(idx, RfPresentation.FirstLast, RfBarSetMode.First));
            // Presentation «Дунд» (зөвхөн 5 харагдана) ⇒ тэр нэг ширхэг.
            Assert.SeqEq(new[] { 5 }, RfEndSymbolMath.SelectBars(idx, RfPresentation.Middle, RfBarSetMode.First));
        }

        [Test]
        public static void BarSet_empty_set_gives_nothing()
        {
            foreach (RfBarSetMode m in new[] { RfBarSetMode.All, RfBarSetMode.First, RfBarSetMode.FirstLast })
                Assert.Eq(0, RfEndSymbolMath.SelectBars(new int[0], RfPresentation.All, m).Count, m.ToString());
        }

        [Test]
        public static void BarSet_modes_are_distinct_values_for_persistence()
        {
            Assert.Eq(4, Enum.GetValues(typeof(RfBarSetMode)).Length);
            Assert.True(RfBarSetMode.First != RfBarSetMode.FirstLast && RfBarSetMode.First != RfBarSetMode.All && RfBarSetMode.First != RfBarSetMode.Nearest);
        }

        // ── Эргэлт ─────────────────────────────────────────────────────

        private static double Deg(double rad) { return rad * 180.0 / Math.PI; }

        [Test]
        public static void Rotation_normalizes_arbitrary_angles()
        {
            Assert.Near(0, RfEndSymbolMath.NormalizeDegrees(0), 1e-9);
            Assert.Near(30, RfEndSymbolMath.NormalizeDegrees(30), 1e-9);
            Assert.Near(45, RfEndSymbolMath.NormalizeDegrees(45), 1e-9);
            Assert.Near(90, RfEndSymbolMath.NormalizeDegrees(90), 1e-9);
            Assert.Near(-45, RfEndSymbolMath.NormalizeDegrees(-45), 1e-9);
            Assert.Near(135, RfEndSymbolMath.NormalizeDegrees(135), 1e-9);
            Assert.Near(0, RfEndSymbolMath.NormalizeDegrees(360), 1e-9);
            Assert.Near(90, RfEndSymbolMath.NormalizeDegrees(450), 1e-9);
            Assert.Near(180, RfEndSymbolMath.NormalizeDegrees(-180), 1e-9);
            Assert.Near(180, RfEndSymbolMath.NormalizeDegrees(180), 1e-9);
            Assert.Near(-170, RfEndSymbolMath.NormalizeDegrees(190), 1e-9);
            Assert.Near(22.5, RfEndSymbolMath.NormalizeDegrees(22.5), 1e-9, "аравтын бутархай");
            Assert.Near(22.5, RfEndSymbolMath.NormalizeDegrees(382.5), 1e-9);
            Assert.Near(0, RfEndSymbolMath.NormalizeDegrees(double.NaN), 1e-9, "NaN → 0");
            Assert.Near(0, RfEndSymbolMath.NormalizeDegrees(double.PositiveInfinity), 1e-9);
        }

        [Test]
        public static void Rotation_start_and_end_use_independent_values()
        {
            Assert.Near(10, RfEndSymbolMath.UserRotationDeg(RfEndKind.Start, 10, 20), 1e-12);
            Assert.Near(20, RfEndSymbolMath.UserRotationDeg(RfEndKind.End, 10, 20), 1e-12);
        }

        [Test]
        public static void Rotation_auto_mode_adds_independent_offsets_start_0_end_90()
        {
            double auto = 0.3; // арматурын автомат чиглэл (радиан)
            double s = RfEndSymbolMath.TargetAngle(true, false, auto, RfEndKind.Start, 0, 90);
            double e = RfEndSymbolMath.TargetAngle(true, false, auto, RfEndKind.End, 0, 90);
            Assert.Near(auto, s, 1e-12, "Эхлэл 0° ⇒ автомат чиглэл хэвээр");
            Assert.Near(auto + Math.PI / 2, e, 1e-12, "Төгсгөл +90°");
            Assert.Near(90, Deg(e - s), 1e-9, "хоёр төгсгөлийн зөрүү = 90° (бие даасан)");
        }

        [Test]
        public static void Rotation_auto_mode_negative_and_over_180_start_minus45_end_135()
        {
            double auto = 0.0;
            double s = RfEndSymbolMath.RotationToApply(RfEndSymbolMath.TargetAngle(true, false, auto, RfEndKind.Start, -45, 135), 0);
            double e = RfEndSymbolMath.RotationToApply(RfEndSymbolMath.TargetAngle(true, false, auto, RfEndKind.End, -45, 135), 0);
            Assert.Near(-45, Deg(s), 1e-9);
            Assert.Near(135, Deg(e), 1e-9);
        }

        [Test]
        public static void Rotation_fixed_mode_is_absolute_per_end_and_ignores_the_bar_direction()
        {
            double s = RfEndSymbolMath.TargetAngle(false, false, 1.234, RfEndKind.Start, 0, 90);
            double e = RfEndSymbolMath.TargetAngle(false, false, 1.234, RfEndKind.End, 0, 90);
            Assert.Near(0, Deg(s), 1e-9);
            Assert.Near(90, Deg(e), 1e-9);
            // Автомат чиглэл өөрчлөгдсөн ч тогтмол өнцөг өөрчлөгдөхгүй.
            Assert.Near(90, Deg(RfEndSymbolMath.TargetAngle(false, true, -2.0, RfEndKind.End, 0, 90)), 1e-9);
        }

        [Test]
        public static void Rotation_end_on_bar_uses_zero_base_plus_user_offset_in_auto_mode()
        {
            // Харагдацын нормаль дагуух арматур: автомат өнцөг тодорхойгүй ⇒ 0 + хэрэглэгчийн эргэлт (тойрогт эргэлт харагдахгүй ч утга хүчинтэй).
            Assert.Near(45, Deg(RfEndSymbolMath.TargetAngle(true, true, 99.0, RfEndKind.Start, 45, 0)), 1e-9);
            Assert.Near(0, Deg(RfEndSymbolMath.TargetAngle(true, true, 99.0, RfEndKind.End, 45, 0)), 1e-9);
        }

        [Test]
        public static void Rotation_450_deg_is_the_same_rotation_as_90_deg()
        {
            double a = RfEndSymbolMath.RotationToApply(RfEndSymbolMath.TargetAngle(true, false, 0.1, RfEndKind.End, 0, 450), 0);
            double b = RfEndSymbolMath.RotationToApply(RfEndSymbolMath.TargetAngle(true, false, 0.1, RfEndKind.End, 0, 90), 0);
            Assert.Near(b, a, 1e-9);
            double c = RfEndSymbolMath.RotationToApply(RfEndSymbolMath.TargetAngle(true, false, 0.1, RfEndKind.Start, 360, 0), 0);
            Assert.Near(RfEndSymbolMath.RotationToApply(0.1, 0), c, 1e-9, "360° = 0°");
        }

        [Test]
        public static void Rotation_family_natural_direction_is_subtracted_after_the_user_offset()
        {
            // Family өөрөө 30° заадаг; автомат 0, эхлэл +40° ⇒ тавих эргэлт = 0 + 40 − 30 = 10°.
            double t = RfEndSymbolMath.TargetAngle(true, false, 0, RfEndKind.Start, 40, 0);
            Assert.Near(10, Deg(RfEndSymbolMath.RotationToApply(t, 30 * Math.PI / 180)), 1e-9);
        }

        [Test]
        public static void Rotation_refresh_keeps_the_user_offset_through_the_stored_natural_angle()
        {
            // Тавихдаа: natural = 10°, хэрэглэгч = +40° ⇒ ES-д хадгалах «natural» = 10 − 40 = −30°.  Refresh: шинэ автомат чиглэл a2 ⇒
            // RotationToApply(a2, stored) = a2 + 40 − 10 — ӨМНӨХ тавилтын томьёотой ЯГ ИЖИЛ (schema өөрчлөгдөөгүй).
            double natural = 10 * Math.PI / 180, user = 40 * Math.PI / 180;
            double stored = RfEndSymbolMath.StoredNatural(natural, user);
            Assert.Near(-30, Deg(stored), 1e-9);
            foreach (double a2deg in new[] { 0.0, 25, -90, 170 })
            {
                double a2 = a2deg * Math.PI / 180;
                double placeRot = RfEndSymbolMath.RotationToApply(RfEndSymbolMath.TargetAngle(true, false, a2, RfEndKind.Start, 40, 0), natural);
                double refreshRot = RfEndSymbolMath.RotationToApply(a2, stored);
                Assert.Near(RfEndSymbolMath.NormalizeAngle(placeRot), RfEndSymbolMath.NormalizeAngle(refreshRot), 1e-9, a2deg + "°");
            }
        }

        // ── Код-оор зурсан (family-гүй) тэмдэг: эргэлт ───────────────────────

        [Test]
        public static void Marker_rotation_pivots_about_the_markers_own_centre_never_the_project_origin()
        {
            var c = new RfV2(123.4, -56.7); // төслийн эхлэлээс хол
            foreach (double deg in new[] { 0.0, 30, 45, 90, -45, 135, 450 })
            {
                foreach (RfMarkerStyle style in new[] { RfMarkerStyle.Cross, RfMarkerStyle.Slash, RfMarkerStyle.Circle })
                {
                    List<RfMarkerPrim> prims = RfMarkerGeometry.Build(style, c, 0.01, deg * Math.PI / 180);
                    RfV2 centre = RfMarkerGeometry.CenterOf(prims.Select(p => p.Mid).ToList());
                    // Тойрог/загалмай: элементүүдийн дунд цэгийн дундаж = төв; налуу зураас: зураасын дунд нь төв.
                    Assert.Near(c.X, centre.X, 1e-9, style + " " + deg + "° X");
                    Assert.Near(c.Y, centre.Y, 1e-9, style + " " + deg + "° Y");
                }
            }
        }

        [Test]
        public static void Marker_geometry_stays_on_a_circle_around_its_own_centre_for_any_rotation()
        {
            // Эргэлт НЬ тэмдгийн төвийн эргэн тойронд (төслийн эхлэл биш): бүх үзүүр төвөөс яг радиусын зайд — «эхлэлийн эргэн тойронд» эргүүлбэл зай өөрчлөгдөнө.
            var c = new RfV2(500, -300);
            double r = 0.02;
            foreach (double deg in new[] { 0.0, 17, 45, 90, -45, 135, 450 })
            {
                foreach (RfMarkerPrim p in RfMarkerGeometry.Build(RfMarkerStyle.Cross, c, r, deg * Math.PI / 180)
                    .Concat(RfMarkerGeometry.Build(RfMarkerStyle.Slash, c, r, deg * Math.PI / 180)))
                {
                    Assert.Near(r, (p.A - c).Length, 1e-9, deg + "° A");
                    Assert.Near(r, (p.B - c).Length, 1e-9, deg + "° B");
                }
            }
        }

        [Test]
        public static void Stored_natural_is_what_Place_writes_so_Refresh_reproduces_the_user_offset()
        {
            // Place-ийн ГАНЦ эх сурвалж: NaturalToStore.  Автомат горимд Эхлэл/Төгсгөл тус тусдаа offset шингэнэ; тогтмол горимд family-ийн өнцөг хэвээр.
            double natural = 10 * Math.PI / 180;
            double sStored = RfEndSymbolMath.NaturalToStore(true, natural, RfEndKind.Start, 40, 100);
            double eStored = RfEndSymbolMath.NaturalToStore(true, natural, RfEndKind.End, 40, 100);
            Assert.Near(-30, Deg(sStored), 1e-9, "Эхлэл 40°");
            Assert.Near(-90, Deg(eStored), 1e-9, "Төгсгөл 100° — тусдаа");
            Assert.Near(10, Deg(RfEndSymbolMath.NaturalToStore(false, natural, RfEndKind.End, 40, 100)), 1e-9, "тогтмол горим өөрчлөхгүй");
            // Refresh (RotationToApply(auto, stored)) = Place (RotationToApply(TargetAngle, natural)) бүх автомат өнцөгт, хоёр төгсгөлд.
            foreach (RfEndKind k in new[] { RfEndKind.Start, RfEndKind.End })
            {
                foreach (double a in new[] { -2.5, 0.0, 0.7, 3.0 })
                {
                    double place = RfEndSymbolMath.RotationToApply(RfEndSymbolMath.TargetAngle(true, false, a, k, 40, 100), natural);
                    double refresh = RfEndSymbolMath.RotationToApply(a, RfEndSymbolMath.NaturalToStore(true, natural, k, 40, 100));
                    Assert.Near(RfEndSymbolMath.NormalizeAngle(place), RfEndSymbolMath.NormalizeAngle(refresh), 1e-9, k + " " + a);
                }
            }
        }

        // ── Тоо унших (диалогийн талбар) ────────────────────────────────

        [Test]
        public static void Number_parse_accepts_comma_unicode_minus_and_rejects_non_finite()
        {
            double v;
            Assert.True(RfNumber.TryParse("22,5", out v) && Math.Abs(v - 22.5) < 1e-12, "таслал");
            Assert.True(RfNumber.TryParse("  -45 ", out v) && Math.Abs(v + 45) < 1e-12);
            Assert.True(RfNumber.TryParse("−45", out v) && Math.Abs(v + 45) < 1e-12, "Unicode хасах тэмдэг (тайлбараас хуулсан)");
            Assert.True(RfNumber.TryParse("–90", out v) && Math.Abs(v + 90) < 1e-12, "урт зураас");
            Assert.True(RfNumber.TryParse("450", out v) && Math.Abs(v - 450) < 1e-12);
            foreach (string bad in new[] { "NaN", "Infinity", "-Infinity", "∞", "", "  ", "abc", "1e999", null })
                Assert.False(RfNumber.TryParse(bad, out v), "«" + bad + "» хүлээн авагдах ёсгүй");
        }

        [Test]
        public static void Marker_slash_and_cross_visibly_rotate_with_start_0_end_90()
        {
            var c = new RfV2(0, 0);
            double auto = 0.2;
            // Эхлэл 0°, Төгсгөл 90° (автомат горим): «/» зураасын чиглэл 90°-аар ЗӨРНӨ.
            double rotStart = RfEndSymbolMath.RotationToApply(RfEndSymbolMath.TargetAngle(true, false, auto, RfEndKind.Start, 0, 90), 0);
            double rotEnd = RfEndSymbolMath.RotationToApply(RfEndSymbolMath.TargetAngle(true, false, auto, RfEndKind.End, 0, 90), 0);
            RfMarkerPrim s = RfMarkerGeometry.Build(RfMarkerStyle.Slash, c, 1, rotStart)[0];
            RfMarkerPrim e = RfMarkerGeometry.Build(RfMarkerStyle.Slash, c, 1, rotEnd)[0];
            double sa = Math.Atan2((s.B - s.A).Y, (s.B - s.A).X), ea = Math.Atan2((e.B - e.A).Y, (e.B - e.A).X);
            Assert.Near(90, RfEndSymbolMath.NormalizeDegrees((ea - sa) * 180 / Math.PI), 1e-9, "Төгсгөлийн «/» нь Эхлэлийнхээс 90°-аар эргэсэн");
            // «×» ч мөн: хоёр шугамын чиглэлийн олонлог 90°-аар шилжсэн (45° ба −45° → 135° ба 45°).
            List<RfMarkerPrim> xs = RfMarkerGeometry.Build(RfMarkerStyle.Cross, c, 1, 0);
            List<RfMarkerPrim> xe = RfMarkerGeometry.Build(RfMarkerStyle.Cross, c, 1, Math.PI / 2);
            Assert.Near(45, Math.Atan2((xs[0].B - xs[0].A).Y, (xs[0].B - xs[0].A).X) * 180 / Math.PI, 1e-9);
            Assert.Near(135, Math.Atan2((xe[0].B - xe[0].A).Y, (xe[0].B - xe[0].A).X) * 180 / Math.PI, 1e-9);
        }

        // ── Тохиргооны шилжилт (хуучин нэг өнцөг → Эхлэл/Төгсгөл) ───────────

        [Test]
        public static void Prefs_migration_old_fixed_angle_is_copied_to_both_ends()
        {
            double s, e;
            RfEndSymbolMath.MigrateRotation("fixed", 30, null, null, out s, out e);
            Assert.Near(30, s, 1e-12);
            Assert.Near(30, e, 1e-12);
        }

        [Test]
        public static void Prefs_migration_old_auto_orientation_keeps_the_previous_look_zero_offset()
        {
            double s, e;
            // «Арматур дагуу» байсан: хуучин FixedAngleDeg ашиглагдаагүй (нэгэн цагт 45 байсан ч) ⇒ offset 0 — харагдац өөрчлөгдөхгүй.
            RfEndSymbolMath.MigrateRotation("auto", 45, null, null, out s, out e);
            Assert.Near(0, s, 1e-12);
            Assert.Near(0, e, 1e-12);
        }

        [Test]
        public static void Prefs_migration_never_overwrites_the_new_independent_values()
        {
            double s, e;
            RfEndSymbolMath.MigrateRotation("fixed", 30, -45.0, 135.0, out s, out e);
            Assert.Near(-45, s, 1e-12);
            Assert.Near(135, e, 1e-12);
            RfEndSymbolMath.MigrateRotation("auto", 30, 10.0, null, out s, out e);
            Assert.Near(10, s, 1e-12);
            Assert.Near(0, e, 1e-12, "дутууг 0");
        }

        [Test]
        public static void Rotation_start_minus45_end_135_through_the_full_chain_for_both_ends()
        {
            // Эхлэл −45°, Төгсгөл 135° (автомат 20°): тавих эргэлтүүд тус тусдаа.
            double auto = 20 * Math.PI / 180;
            double rs = RfEndSymbolMath.RotationToApply(RfEndSymbolMath.TargetAngle(true, false, auto, RfEndKind.Start, -45, 135), 0);
            double re = RfEndSymbolMath.RotationToApply(RfEndSymbolMath.TargetAngle(true, false, auto, RfEndKind.End, -45, 135), 0);
            Assert.Near(-25, Deg(rs), 1e-9);
            Assert.Near(155, Deg(re), 1e-9);
        }
    }
}
