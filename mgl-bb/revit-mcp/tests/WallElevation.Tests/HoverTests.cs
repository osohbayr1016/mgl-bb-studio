using System;
using System.Collections.Generic;
using System.Linq;
using RevitMcpAddin.WallElevation.Core;

namespace RevitMcpAddin.WallElevation.Tests
{
    /// <summary>Курсор доорх өрөөний тодруулга (2026-10-14) — цэвэр геометр.</summary>
    public static class HoverTests
    {
        private static WeHoverRoom Room(string key, double area, bool host, params double[][] loops)
        {
            var r = new WeHoverRoom { Candidate = new WePickCandidate { Key = key, Label = key, IsRoom = true, IsHost = host, Area = area } };
            foreach (double[] l in loops)
            {
                var pts = new List<WeV3>();
                for (int i = 0; i + 1 < l.Length; i += 2) pts.Add(new WeV3(l[i], l[i + 1], 0));
                r.Loops.Add(pts);
            }
            r.Grow();
            return r;
        }

        [Test]
        public static void Point_inside_outer_loop_but_in_a_column_hole_is_not_in_the_room()
        {
            WeHoverRoom r = Room("101", 20, true, new double[] { 0, 0, 5, 0, 5, 4, 0, 4 }, new double[] { 2, 2, 3, 2, 3, 3, 2, 3 });
            Assert.True(WeHoverGeometry.Contains(r, 1, 1), "өрөөн дотор");
            Assert.False(WeHoverGeometry.Contains(r, 2.5, 2.5), "баганын нүхэнд — өрөө биш");
            Assert.False(WeHoverGeometry.Contains(r, 6, 1), "гадна");
        }

        [Test]
        public static void Hover_choice_uses_the_same_rule_as_the_click()
        {
            // Хоёр өрөө давхцсан (link-ийн давхар өрөө): дарахад сонгогдох нь (жижиг) тодорно.
            WeHoverRoom big = Room("big", 20, false, new double[] { 0, 0, 5, 0, 5, 4, 0, 4 });
            WeHoverRoom small = Room("small", 4, false, new double[] { 1, 1, 3, 1, 3, 3, 1, 3 });
            var rooms = new List<WeHoverRoom> { big, small };
            string expected = WePickRules.Choose(rooms.Select(r => r.Candidate)).Key;
            Assert.Eq(expected, WeHoverGeometry.At(rooms, 2, 2).Candidate.Key);
            Assert.Eq("big", WeHoverGeometry.At(rooms, 4.5, 3.5).Candidate.Key);
            Assert.True(WeHoverGeometry.At(rooms, 9, 9) == null, "өрөөгүй цэг — тодруулгагүй");
        }

        [Test]
        public static void L_room_fill_triangulates_into_n_minus_2_triangles_with_the_full_area()
        {
            WeHoverRoom l = Room("L", 0, true, new double[] { 0, 0, 6, 0, 6, 2, 2, 2, 2, 5, 0, 5 });
            var layer = new WeOverlayLayer();
            WeHoverGeometry.Fill(l, layer);
            Assert.Eq(4, layer.Triangles.Count / 3, "6 оройтой — 4 гурвалжин");
            double area = 0;
            for (int t = 0; t < layer.Triangles.Count; t += 3)
            {
                Func<int, double> x = i => layer.Xyz[layer.Triangles[t + i] * 3], y = i => layer.Xyz[layer.Triangles[t + i] * 3 + 1];
                area += Math.Abs((x(1) - x(0)) * (y(2) - y(0)) - (x(2) - x(0)) * (y(1) - y(0))) / 2;
            }
            Assert.True(Math.Abs(area - (6 * 2 + 2 * 3)) < 1e-9, "дүүргэлтийн талбай = өрөөний талбай: " + area);
            Assert.Eq(12, layer.Lines.Count, "хилийн 6 шугам");
        }

        [Test]
        public static void Band_draws_two_quads_per_edge()
        {
            WeHoverRoom r = Room("r", 0, true, new double[] { 0, 0, 4, 0, 4, 3, 0, 3 });
            var layer = new WeOverlayLayer();
            WeHoverGeometry.Band(r, 0.1, layer);
            Assert.Eq(4 * 2 * 2, layer.Triangles.Count / 3, "4 ирмэг × (зурвас + булан) × 2 гурвалжин");
        }

        [Test]
        public static void Screen_point_maps_into_a_rotated_plan()
        {
            // Цонх 1000×500 px; харагдац 90° эргэсэн (баруун = +Y, дээш = −X), харагдах муж X −10…0, Y 0…20.
            WeV3 right = new WeV3(0, 1, 0), up = new WeV3(-1, 0, 0);
            WeV3? p = WeHoverGeometry.ScreenToView(750, 125, 0, 0, 1000, 500, new WeV3(0, 0, 0), new WeV3(-10, 20, 0), right, up);
            Assert.True(p.HasValue);
            Assert.True(Math.Abs(p.Value.Y - 15) < 1e-9 && Math.Abs(p.Value.X - -7.5) < 1e-9, "(" + p.Value.X + "," + p.Value.Y + ")");
            Assert.False(WeHoverGeometry.ScreenToView(1200, 125, 0, 0, 1000, 500, new WeV3(0, 0, 0), new WeV3(-10, 20, 0), right, up).HasValue, "цонхноос гадна");
        }
    }
}
