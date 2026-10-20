using System;
using System.Collections.Generic;
using System.Linq;
using RevitMcpAddin.Reinforcement.Core;

namespace RevitMcpAddin.Reinforcement.Tests
{
    /// <summary>Код-оор зурагдах тэмдэг (family-гүй fallback) ба «дарсан цэгт хамгийн ойр ширхэг».</summary>
    public static class MarkerTests
    {
        private const double Eps = 1e-9;

        [Test]
        public static void Circle_is_two_half_arcs_around_center()
        {
            var c = new RfV2(3, -2);
            List<RfMarkerPrim> p = RfMarkerGeometry.Build(RfMarkerStyle.Circle, c, 0.5, 0);
            Assert.Eq(2, p.Count);
            Assert.True(p.All(x => x.Kind == RfPrimKind.Arc));
            Assert.Near(Math.PI, p[0].EndAngle - p[0].StartAngle, Eps);
            Assert.Near(Math.PI, p[1].EndAngle - p[1].StartAngle, Eps);
            // Нумууд залгагдана (2π-ийн модулиар) ба нэг нь нөгөөгийн эсрэг талд — хамт бүтэн тойрог.
            double gap = (p[1].StartAngle - p[0].EndAngle) % (2 * Math.PI);
            Assert.True(Math.Abs(gap) < Eps || Math.Abs(Math.Abs(gap) - 2 * Math.PI) < Eps, "нумууд залгагдана");
            foreach (RfMarkerPrim a in p)
                Assert.True(a.StartAngle >= 0 && a.StartAngle < 2 * Math.PI, "нум бүрийн эхлэл [0, 2π) дотор: " + a.StartAngle);
            foreach (RfMarkerPrim a in p)
            {
                Assert.Near(0.5, (a.Mid - c).Length, Eps, "дунд цэг тойрог дээр");
                Assert.Near(0.5, a.Radius, Eps);
            }
        }

        [Test]
        public static void Cross_is_two_lines_at_plus_minus_45_to_bar_direction()
        {
            List<RfMarkerPrim> p = RfMarkerGeometry.Build(RfMarkerStyle.Cross, new RfV2(0, 0), 1.0, 0);
            Assert.Eq(2, p.Count);
            Assert.True(p.All(x => x.Kind == RfPrimKind.Line));
            double a0 = Math.Atan2((p[0].B - p[0].A).Y, (p[0].B - p[0].A).X);
            double a1 = Math.Atan2((p[1].B - p[1].A).Y, (p[1].B - p[1].A).X);
            Assert.Near(Math.PI / 4, a0, Eps);
            Assert.Near(-Math.PI / 4, a1, Eps);
            foreach (RfMarkerPrim l in p) Assert.Near(2.0, (l.B - l.A).Length, Eps, "урт = диаметр");
        }

        [Test]
        public static void Slash_is_one_line_45_to_bar_and_follows_rotation()
        {
            double rot = 30 * Math.PI / 180;
            List<RfMarkerPrim> p = RfMarkerGeometry.Build(RfMarkerStyle.Slash, new RfV2(1, 1), 0.4, rot);
            Assert.Eq(1, p.Count);
            RfV2 d = (p[0].B - p[0].A).Normalized();
            Assert.Near(rot + Math.PI / 4, Math.Atan2(d.Y, d.X), Eps);
            Assert.Near(0, (p[0].Mid - new RfV2(1, 1)).Length, Eps, "төв дундаа");
        }

        [Test]
        public static void Center_is_recoverable_from_part_midpoints_for_every_style_and_rotation()
        {
            var c = new RfV2(12.5, -7.25);
            foreach (RfMarkerStyle st in new[] { RfMarkerStyle.Circle, RfMarkerStyle.Cross, RfMarkerStyle.Slash })
            {
                foreach (double deg in new[] { 0.0, 17, 90, 123, -60 })
                {
                    List<RfMarkerPrim> p = RfMarkerGeometry.Build(st, c, 0.3, deg * Math.PI / 180);
                    RfV2 back = RfMarkerGeometry.CenterOf(p.Select(x => x.Mid).ToList());
                    Assert.Near(0, (back - c).Length, 1e-9, st + " " + deg + "°");
                }
            }
        }

        [Test]
        public static void Invalid_radius_gives_no_geometry()
        {
            foreach (double r in new[] { 0.0, -1.0, double.NaN, double.PositiveInfinity })
                Assert.Eq(0, RfMarkerGeometry.Build(RfMarkerStyle.Cross, new RfV2(0, 0), r, 0).Count, "r=" + r);
        }

        [Test]
        public static void Paper_size_scales_with_view_scale_and_is_clamped()
        {
            // 3 мм цаасан диаметр, 1:100 ⇒ загварт 300 мм диаметр ⇒ радиус 150 мм.
            Assert.Near(150.0 / 304.8, RfMarkerGeometry.RadiusFt(3.0, 100), 1e-12);
            Assert.Near(75.0 / 304.8, RfMarkerGeometry.RadiusFt(3.0, 50), 1e-12);
            Assert.Near(RfMarkerGeometry.RadiusFt(RfMarkerGeometry.MaxSizeMm, 100), RfMarkerGeometry.RadiusFt(500, 100), 1e-12, "дээд хязгаар");
            Assert.Near(RfMarkerGeometry.RadiusFt(RfMarkerGeometry.MinSizeMm, 100), RfMarkerGeometry.RadiusFt(-3, 100), 1e-12, "доод хязгаар");
            Assert.Near(RfMarkerGeometry.RadiusFt(3.0, 100), RfMarkerGeometry.RadiusFt(3.0, 0), 1e-12, "масштаб мэдэгдэхгүй ⇒ 1:100");
        }

        [Test]
        public static void Tag_roundtrip_and_distinguishes_marker_from_family_uid()
        {
            foreach (RfMarkerStyle st in new[] { RfMarkerStyle.Circle, RfMarkerStyle.Cross, RfMarkerStyle.Slash })
            {
                string tag = RfMarkerGeometry.Tag(st);
                RfMarkerStyle back;
                Assert.True(RfMarkerGeometry.TryParseTag(tag, out back), tag);
                Assert.Eq(st, back);
                Assert.True(RfMarkerGeometry.IsTag(tag));
            }
            Assert.False(RfMarkerGeometry.IsTag("a1b2c3d4-0000-1111-2222-333344445555-0001a2b3"), "family symbol UniqueId");
            Assert.False(RfMarkerGeometry.IsTag(""));
            Assert.False(RfMarkerGeometry.IsTag(null));
            RfMarkerStyle junk;
            Assert.False(RfMarkerGeometry.TryParseTag("mk:triangle", out junk));
        }

        // ── Дарсан цэгт хамгийн ойр ширхэг ──────────────────────────────

        [Test]
        public static void NearestBar_picks_smallest_distance_not_first()
        {
            Assert.Eq(7, RfEndSymbolMath.NearestBar(new[] { 3, 7, 9 }, new[] { 5.0, 0.2, 1.0 }));
            Assert.Eq(9, RfEndSymbolMath.NearestBar(new[] { 3, 7, 9 }, new[] { 5.0, 4.0, 0.0 }));
        }

        [Test]
        public static void NearestBar_ties_take_lower_index_and_skip_unmeasured()
        {
            Assert.Eq(2, RfEndSymbolMath.NearestBar(new[] { 5, 2, 8 }, new[] { 1.0, 1.0, 1.0 }));
            Assert.Eq(4, RfEndSymbolMath.NearestBar(new[] { 1, 4, 6 }, new[] { double.NaN, 2.0, double.PositiveInfinity }));
            Assert.Eq(-1, RfEndSymbolMath.NearestBar(new[] { 1, 2 }, new[] { double.NaN, -1.0 }));
            Assert.Eq(-1, RfEndSymbolMath.NearestBar(new int[0], new double[0]));
            Assert.Eq(-1, RfEndSymbolMath.NearestBar(null, null));
        }

        [Test]
        public static void DistanceToPolyline_perpendicular_clamped_and_degenerate_cases()
        {
            var seg = new List<RfV2> { new RfV2(-1, 0), new RfV2(1, 0) };
            Assert.Near(1.0, RfEndSymbolMath.DistanceToPolyline(new RfV2(0, 1), seg), Eps, "перпендикуляр");
            Assert.Near(2.0, RfEndSymbolMath.DistanceToPolyline(new RfV2(3, 0), seg), Eps, "төгсгөлөөс цаашаа ⇒ төгсгөл хүртэл");
            Assert.Near(0.0, RfEndSymbolMath.DistanceToPolyline(new RfV2(0.3, 0), seg), Eps, "шугам дээр");
            Assert.Near(5.0, RfEndSymbolMath.DistanceToPolyline(new RfV2(3, 4), new List<RfV2> { new RfV2(0, 0) }), Eps, "нэг цэг");
            Assert.True(double.IsNaN(RfEndSymbolMath.DistanceToPolyline(new RfV2(0, 0), new List<RfV2>())), "хоосон ⇒ NaN");
            Assert.True(double.IsNaN(RfEndSymbolMath.DistanceToPolyline(new RfV2(0, 0), null)));
            // Урт нь 0 хэрчим.
            Assert.Near(1.0, RfEndSymbolMath.DistanceToPolyline(new RfV2(1, 0), new List<RfV2> { new RfV2(0, 0), new RfV2(0, 0) }), Eps);
        }

        [Test]
        public static void DistanceToPolyline_multi_segment_takes_the_minimum_over_a_bent_bar()
        {
            // L хэлбэр: (0,0)→(10,0)→(10,10).  (10, 5) нь босоо хэсэг дээр.
            var l = new List<RfV2> { new RfV2(0, 0), new RfV2(10, 0), new RfV2(10, 10) };
            Assert.Near(0.0, RfEndSymbolMath.DistanceToPolyline(new RfV2(10, 5), l), Eps);
            Assert.Near(2.0, RfEndSymbolMath.DistanceToPolyline(new RfV2(8, 5), l), Eps);
        }

        /// <summary>
        /// Олонлог: ширхэг бүр 100 мм зайтай босоо шугам (x = 0, 100, 200…).  Дарсан цэг x = 210 ⇒ 200 дахь ширхэг —
        /// «эхний ширхэг» (0) БИШ.
        /// </summary>
        [Test]
        public static void Nearest_bar_in_a_set_is_chosen_by_distance_to_each_bars_centerline()
        {
            var indices = new List<int>();
            var dist = new List<double>();
            RfV2 pick = new RfV2(210, 50);
            for (int i = 0; i < 6; i++)
            {
                double x = i * 100;
                indices.Add(i);
                dist.Add(RfEndSymbolMath.DistanceToPolyline(pick, new List<RfV2> { new RfV2(x, 0), new RfV2(x, 300) }));
            }
            Assert.Eq(2, RfEndSymbolMath.NearestBar(indices, dist));
            // Нуугдсан ширхгийг дуудагч хасч (cand-д оруулахгүй) — ойр ширхэг нуугдсан бол дараагийнх.
            var visible = new List<int> { 0, 1, 3, 4, 5 };
            var d2 = new List<double>();
            foreach (int i in visible) d2.Add(dist[i]);
            Assert.Eq(3, RfEndSymbolMath.NearestBar(visible, d2));
        }

        [Test]
        public static void SelectBars_nearest_mode_keeps_all_candidates_for_the_caller_to_reduce()
        {
            var existing = new List<int> { 0, 1, 2, 3, 4 };
            Assert.SeqEq(existing, RfEndSymbolMath.SelectBars(existing, RfPresentation.All, RfBarSetMode.Nearest));
            // Revit-ийн «Эхний/Сүүлийн» харагдац — зөвхөн харагдаж буй ширхгүүдээс сонгоно.
            Assert.SeqEq(new[] { 0, 4 }, RfEndSymbolMath.SelectBars(existing, RfPresentation.FirstLast, RfBarSetMode.Nearest));
        }
    }
}
