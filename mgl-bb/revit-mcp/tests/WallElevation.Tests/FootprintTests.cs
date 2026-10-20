using System;
using RevitMcpAddin.WallElevation.Core;

namespace RevitMcpAddin.WallElevation.Tests
{
    public static class FootprintTests
    {
        private static WeFootprint Box(double cx, double cy, double angleDeg, double halfU, double halfW, double cz = 5, double halfH = 5)
        {
            double r = angleDeg * Math.PI / 180;
            var right = new WeV3(Math.Cos(r), Math.Sin(r), 0);
            var view = new WeV3(-Math.Sin(r), Math.Cos(r), 0);
            return WeFootprint.Of(new WeV3(cx, cy, cz), right, view, new WeV3(halfU, halfH, halfW));
        }

        [Test]
        public static void Perpendicular_elevations_of_one_room_overlap()
        {
            // Өрөөний урд ханын дэлгээс (хэвтээ, урт) ба зүүн ханын дэлгээс (босоо) — буланд огтлолцоно.
            WeFootprint south = Box(10, 0, 0, 10, 1);
            WeFootprint east = Box(20, 8, 90, 8, 1);
            Assert.True(south.Overlaps(east, 0.01));
            Assert.True(east.Overlaps(south, 0.01));
        }

        [Test]
        public static void Far_apart_or_vertically_separated_do_not_overlap()
        {
            Assert.False(Box(0, 0, 0, 5, 1).Overlaps(Box(30, 0, 0, 5, 1), 0.01));
            Assert.False(Box(0, 0, 0, 5, 1, cz: 5).Overlaps(Box(0, 0, 0, 5, 1, cz: 50), 0.01), "өөр давхар");
        }

        [Test]
        public static void Rotated_boxes_use_separating_axes_not_bounding_boxes()
        {
            // 45° эргүүлсэн нарийн хайрцгийн AABB нь нөгөөтэйгээ давхцах ч бодитоор огтлолцохгүй.
            WeFootprint a = Box(0, 0, 45, 10, 0.5);
            WeFootprint b = Box(6, -6, 45, 3, 0.5);
            Assert.False(a.Overlaps(b, 0.01));
            Assert.True(a.Overlaps(Box(3, 3, 0, 1, 1), 0.01));
        }
    }
}
