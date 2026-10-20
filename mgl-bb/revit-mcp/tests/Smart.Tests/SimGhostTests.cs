using System;
using System.Collections.Generic;
using System.Linq;
using RevitMcpAddin.ChangeImpact.Core;

namespace RevitMcpAddin.Smart.Tests
{
    /// <summary>Simulation-ийн Revit зураг дээрх сүүдэр (DirectContext3D давхаргууд) — ЦЭВЭР.</summary>
    public static class SimGhostTests
    {
        private const double U = 1.0 / 304.8;

        private static SimScene OneBox()
        {
            var s = new SimScene { OriginMm = new[] { 10000.0, 20000.0, 0.0 } };
            s.Moving.Add(SimMeshBuilder.Box("h:1", -500, -100, 0, 500, 100, 2000, SimRole.Moving, SimKind.Wall));
            return s;
        }

        [Test]
        public static void Ghost_PutsVerticesInWorldFeet_AtOriginPlusOffset()
        {
            SimScene s = OneBox();
            GhostScene g = SimGhostScene.Build(s, new SimVec(1000, 0, 0), MoveVerdict.MoveOk, null, U);
            Assert.False(g.IsEmpty);
            GhostLayer faces = g.Layers.First(l => l.Name.StartsWith("sim.ghost."));
            // Хайрцгийн x: −500..500 → дэлхийн мм: 10000 + 1000 + (−500..500) = 10500..11500.
            double minX = double.MaxValue, maxX = double.MinValue;
            for (int i = 0; i < faces.Xyz.Length; i += 3) { minX = Math.Min(minX, faces.Xyz[i]); maxX = Math.Max(maxX, faces.Xyz[i]); }
            Assert.Near(10500 * U, minX, 1e-9);
            Assert.Near(11500 * U, maxX, 1e-9);
            Assert.Eq(12, faces.Triangles.Length / 3);
            Assert.NotNull(g.Bounds);
        }

        [Test]
        public static void Ghost_ColourFollowsTheVerdict()
        {
            SimScene s = OneBox();
            Assert.SeqEq(SimGhostScene.OkRgb, SimGhostScene.Build(s, new SimVec(100, 0, 0), MoveVerdict.MoveOk, null, U).Layers.First(l => l.Name.StartsWith("sim.ghost.")).Rgb);
            Assert.SeqEq(SimGhostScene.ReviewRgb, SimGhostScene.Build(s, new SimVec(100, 0, 0), MoveVerdict.MoveWithReview, null, U).Layers.First(l => l.Name.StartsWith("sim.ghost.")).Rgb);
            Assert.SeqEq(SimGhostScene.BlockedRgb, SimGhostScene.Build(s, new SimVec(100, 0, 0), MoveVerdict.DoNotMove, null, U).Layers.First(l => l.Name.StartsWith("sim.ghost.")).Rgb);
            Assert.SeqEq(SimGhostScene.UnknownRgb, SimGhostScene.Build(s, new SimVec(100, 0, 0), MoveVerdict.Unknown, null, U).Layers.First(l => l.Name.StartsWith("sim.ghost.")).Rgb);
        }

        [Test]
        public static void Ghost_HasOldOutline_NewOutline_Arrow_AndRedHitVolumes()
        {
            SimScene s = OneBox();
            var hits = new List<double[]> { new[] { 100.0, -100.0, 0.0, 300.0, 100.0, 500.0 }, null, new[] { 0.0, 0.0, 0.0, 0.0, 0.0, 0.0 } };
            GhostScene g = SimGhostScene.Build(s, new SimVec(1000, 0, 0), MoveVerdict.MoveWithReview, hits, U);
            Assert.True(g.Layers.Any(l => l.Name == "sim.old"));
            Assert.True(g.Layers.Any(l => l.Name == "sim.new"));
            Assert.True(g.Layers.Any(l => l.Name == "sim.arrow"));
            GhostLayer hit = g.Layers.Single(l => l.Name == "sim.hits");
            Assert.Eq(2 * 8, hit.VertexCount, "хоёр хайрцаг (null алгасагдана; нимгэн нь 40 мм хүртэл өргөснө)");
            Assert.SeqEq(SimGhostScene.HitRgb, hit.Rgb);
            // Тэг хэмжээст хайрцаг нь харагдахуйц (≥ 40 мм).
            double xs0 = hit.Xyz[8 * 3 + 0], xs1 = hit.Xyz[8 * 3 + 3];
            Assert.True(Math.Abs(xs1 - xs0) >= 40 * U - 1e-9 || Math.Abs(hit.Xyz[8 * 3 + 6] - xs0) >= 40 * U - 1e-9);
        }

        [Test]
        public static void Ghost_LayersStayBelowTheVertexLimit_AndInvalidInputIsEmpty()
        {
            var s = new SimScene { OriginMm = new double[3] };
            for (int i = 0; i < 25000; i++)       // тусдаа 1 гурвалжинтай сүлжээ — 3 орой тус бүр (75 000 орой) → давхаргад хуваагдана
            {
                var b = new SimMeshBuilder(0.001);
                b.AddTriangle(i, 0, 0, i + 0.5, 0, 0, i, 1, 0);
                var m = new SimMesh { Key = "h:" + i, Role = SimRole.Moving };
                b.Fill(m);
                s.Moving.Add(m);
            }
            GhostScene g = SimGhostScene.Build(s, new SimVec(5, 0, 0), MoveVerdict.MoveOk, null, U);
            foreach (GhostLayer l in g.Layers) Assert.True(l.VertexCount < SimGhostScene.MaxVerticesPerLayer, l.Name + " " + l.VertexCount);
            Assert.True(g.Layers.Count(l => l.Name.StartsWith("sim.ghost.")) >= 2, "олон давхаргад хуваагдана");

            Assert.True(SimGhostScene.Build(null, new SimVec(1, 0, 0), MoveVerdict.MoveOk, null, U).IsEmpty);
            Assert.True(SimGhostScene.Build(OneBox(), new SimVec(1, 0, 0), MoveVerdict.MoveOk, null, 0).IsEmpty);
            Assert.True(SimGhostScene.Build(OneBox(), new SimVec(1, 0, 0), MoveVerdict.MoveOk, null, double.NaN).IsEmpty);
            Assert.True(SimGhostScene.Build(new SimScene(), new SimVec(1, 0, 0), MoveVerdict.MoveOk, null, U).IsEmpty);
        }
    }
}
