using System;
using System.Linq;
using RevitMcpAddin.ChangeImpact.Core;

namespace RevitMcpAddin.Smart.Tests
{
    /// <summary>Ханын «сүүдэр» (ghost) геометр: ЦЭВЭР тооцоо — өнцөг, хөдөлгөөн, гурвалжин/ирмэгийн бүрэн байдал, сум, өнгө.</summary>
    public static class PreChangeGhostGeometryTests
    {
        private static GhostMesh Wall(double cx = 10, double cy = 20, double dx = 1, double dy = 0, double len = 4, double th = 0.5, double z0 = 0, double z1 = 9, double mx = 0, double my = 1)
        {
            return PreChangeGhostGeometry.Build(cx, cy, dx, dy, len, th, z0, z1, mx, my);
        }

        private static double Min(double[] c, int axis) { double m = double.MaxValue; for (int i = axis; i < c.Length; i += 3) m = Math.Min(m, c[i]); return m; }
        private static double Max(double[] c, int axis) { double m = double.MinValue; for (int i = axis; i < c.Length; i += 3) m = Math.Max(m, c[i]); return m; }

        [Test]
        public static void BadInput_ReturnsNull()
        {
            Assert.Null(Wall(len: 0));
            Assert.Null(Wall(th: 0));
            Assert.Null(Wall(dx: 0, dy: 0));
            Assert.Null(Wall(z0: 5, z1: 5));
            Assert.Null(Wall(cx: double.NaN));
            Assert.Null(Wall(mx: double.PositiveInfinity));
        }

        [Test]
        public static void AxisAlignedWall_HasExpectedExtents()
        {
            GhostMesh m = Wall();
            Assert.True(Math.Abs(Min(m.OldCorners, 0) - 8) < 1e-9 && Math.Abs(Max(m.OldCorners, 0) - 12) < 1e-9, "x ±2 (урт 4)");
            Assert.True(Math.Abs(Min(m.OldCorners, 1) - 19.75) < 1e-9 && Math.Abs(Max(m.OldCorners, 1) - 20.25) < 1e-9, "y ±0.25 (зузаан 0.5)");
            Assert.True(Math.Abs(Min(m.OldCorners, 2) - 0) < 1e-9 && Math.Abs(Max(m.OldCorners, 2) - 9) < 1e-9, "z");
        }

        [Test]
        public static void RotatedWall_SwapsExtents_DirectionIsNormalized()
        {
            GhostMesh m = Wall(dx: 0, dy: 5);       // нэгж биш чиглэл
            Assert.True(Math.Abs(Min(m.OldCorners, 1) - 18) < 1e-9 && Math.Abs(Max(m.OldCorners, 1) - 22) < 1e-9, "y ±2");
            Assert.True(Math.Abs(Min(m.OldCorners, 0) - 9.75) < 1e-9 && Math.Abs(Max(m.OldCorners, 0) - 10.25) < 1e-9, "x ±0.25");
        }

        [Test]
        public static void NewCorners_AreOldPlusMove_ZUnchanged()
        {
            GhostMesh m = Wall(mx: 3, my: -2);
            for (int i = 0; i < 8; i++)
            {
                Assert.True(Math.Abs(m.NewCorners[i * 3] - (m.OldCorners[i * 3] + 3)) < 1e-9);
                Assert.True(Math.Abs(m.NewCorners[i * 3 + 1] - (m.OldCorners[i * 3 + 1] - 2)) < 1e-9);
                Assert.True(Math.Abs(m.NewCorners[i * 3 + 2] - m.OldCorners[i * 3 + 2]) < 1e-9);
            }
        }

        [Test]
        public static void Triangles_CoverSixFaces_EachTriangleLiesOnOneFace()
        {
            GhostMesh m = Wall();
            Assert.Eq(36, m.Triangles.Length);
            Assert.True(m.Triangles.All(i => i >= 0 && i < 8));
            var faces = new System.Collections.Generic.HashSet<string>();
            for (int t = 0; t < 12; t++)
            {
                int a = m.Triangles[t * 3], b = m.Triangles[t * 3 + 1], c = m.Triangles[t * 3 + 2];
                Assert.True(a != b && b != c && a != c, "гурвалжин ялгаатай 3 өнцөгтэй");
                // нэг тэнхлэгийн bit гурван өнцөгт ижил = нэг талд оршино
                int common = -1;
                for (int bit = 0; bit < 3; bit++)
                {
                    int va = (a >> bit) & 1, vb = (b >> bit) & 1, vc = (c >> bit) & 1;
                    if (va == vb && vb == vc) { common = bit * 2 + va; break; }
                }
                Assert.True(common >= 0, "гурвалжин нэг талд байх ёстой");
                faces.Add(common.ToString());
            }
            Assert.Eq(6, faces.Count);
        }

        [Test]
        public static void Edges_AreTwelveAndDifferByExactlyOneBit()
        {
            GhostMesh m = Wall();
            Assert.Eq(24, m.Edges.Length);
            for (int e = 0; e < 12; e++)
            {
                int x = m.Edges[e * 2] ^ m.Edges[e * 2 + 1];
                Assert.True(x == 1 || x == 2 || x == 4, "ирмэг нэг тэнхлэгийн дагуу");
            }
            Assert.Eq(12, Enumerable.Range(0, 12).Select(e => Math.Min(m.Edges[e * 2], m.Edges[e * 2 + 1]) * 8 + Math.Max(m.Edges[e * 2], m.Edges[e * 2 + 1])).Distinct().Count());
        }

        [Test]
        public static void Arrow_StartsAtOldCenter_EndsAtNewCenter_WithTwoHeadStrokes()
        {
            GhostMesh m = Wall(mx: 0, my: 2);
            Assert.Eq(18, m.ArrowLines.Length);
            Assert.True(Math.Abs(m.ArrowLines[0] - 10) < 1e-9 && Math.Abs(m.ArrowLines[1] - 20) < 1e-9, "эхлэл = хуучин төв");
            Assert.True(Math.Abs(m.ArrowLines[3] - 10) < 1e-9 && Math.Abs(m.ArrowLines[4] - 22) < 1e-9, "төгсгөл = шинэ төв");
            Assert.True(Math.Abs(m.ArrowLines[2] - 4.5) < 1e-9, "хананы өндрийн дундаж");
            // хошуу нь төгсгөлөөс эхэлнэ
            Assert.True(Math.Abs(m.ArrowLines[6] - 10) < 1e-9 && Math.Abs(m.ArrowLines[7] - 22) < 1e-9);
            Assert.True(Math.Abs(m.ArrowLines[12] - 10) < 1e-9 && Math.Abs(m.ArrowLines[13] - 22) < 1e-9);
        }

        [Test]
        public static void ZeroMove_HasNoArrowHead_AndSameCorners()
        {
            GhostMesh m = Wall(mx: 0, my: 0);
            Assert.Eq(6, m.ArrowLines.Length);
            for (int i = 0; i < 24; i++) Assert.True(Math.Abs(m.OldCorners[i] - m.NewCorners[i]) < 1e-9);
        }

        [Test]
        public static void Bounds_ContainEveryPoint()
        {
            GhostMesh m = Wall(mx: 5, my: 7);
            foreach (double[] pts in new[] { m.OldCorners, m.NewCorners, m.ArrowLines })
                for (int i = 0; i + 2 < pts.Length; i += 3)
                {
                    Assert.True(pts[i] >= m.Bounds[0] - 1e-9 && pts[i] <= m.Bounds[3] + 1e-9);
                    Assert.True(pts[i + 1] >= m.Bounds[1] - 1e-9 && pts[i + 1] <= m.Bounds[4] + 1e-9);
                    Assert.True(pts[i + 2] >= m.Bounds[2] - 1e-9 && pts[i + 2] <= m.Bounds[5] + 1e-9);
                }
        }

        [Test]
        public static void ToneColors_AreDistinct_AndGrayIsTheDefault()
        {
            var seen = new System.Collections.Generic.HashSet<string>();
            foreach (ApplyTone t in new[] { ApplyTone.Green, ApplyTone.Amber, ApplyTone.Red, ApplyTone.Gray })
            {
                byte[] c = PreChangeGhostGeometry.ToneRgb(t);
                Assert.Eq(3, c.Length);
                seen.Add(c[0] + "," + c[1] + "," + c[2]);
            }
            Assert.Eq(4, seen.Count);
            Assert.True(PreChangeGhostGeometry.ToneRgb(ApplyTone.None).SequenceEqual(PreChangeGhostGeometry.ToneRgb(ApplyTone.Gray)));
        }
    }
}
