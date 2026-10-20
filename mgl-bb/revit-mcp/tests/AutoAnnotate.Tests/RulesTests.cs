using System;
using System.Collections.Generic;
using System.Linq;
using RevitMcpAddin.AutoAnnotate.Core;

namespace RevitMcpAddin.AutoAnnotate.Tests
{
    public static class RulesTests
    {
        private const double T = 1.0; // 1 фут зузаан хана

        private static WallSeg W(int key, double ax, double ay, double bx, double by, double t = T)
            => new WallSeg(key, new Seg(new V2(ax, ay), new V2(bx, by)), t);

        private static List<Blocker> Blockers(IEnumerable<WallSeg> walls)
            => walls.Select(w => new Blocker(w.Key, w.Line)).ToList();

        /// <summary>10×8 тэгш өнцөгт (цагийн зүүний эсрэг зурсан) + нэг дотор хана.</summary>
        private static List<WallSeg> Box()
        {
            return new List<WallSeg>
            {
                W(1, 0, 0, 10, 0),   // доод — зүүн тал нь (+Y) дотогшоо
                W(2, 10, 0, 10, 8),  // баруун
                W(3, 10, 8, 0, 8),   // дээд
                W(4, 0, 8, 0, 0),    // зүүн
                W(5, 5, 0, 5, 8),    // дотор хана
            };
        }

        [Test]
        public static void Rectangle_outer_walls_exposed_outward_only()
        {
            List<WallSeg> walls = Box();
            List<Blocker> b = Blockers(walls);
            foreach (WallSeg w in walls.Take(4))
            {
                Exposure e = Exterior.Classify(w, b);
                // CCW зурсан тул гадна нь БАРУУН тал.
                Assert.Eq(Exposure.Right, e, "wall " + w.Key);
                Assert.True(w.Normal(e).Dot(w.Line.At(0.5) - new V2(5, 4)) > 0, "normal points out " + w.Key);
            }
            Assert.Eq(Exposure.None, Exterior.Classify(walls[4], b), "interior wall");
        }

        [Test]
        public static void Freestanding_wall_is_exposed_both_sides()
        {
            var walls = new List<WallSeg> { W(1, 0, 0, 10, 0) };
            Assert.Eq(Exposure.Both, Exterior.Classify(walls[0], Blockers(walls)));
        }

        [Test]
        public static void Courtyard_walls_are_not_exterior()
        {
            var walls = Box().Take(4).ToList();
            // хаалттай дотоод хашаа 3..7 × 3..5
            walls.Add(W(11, 3, 3, 7, 3));
            walls.Add(W(12, 7, 3, 7, 5));
            walls.Add(W(13, 7, 5, 3, 5));
            walls.Add(W(14, 3, 5, 3, 3));
            List<Blocker> b = Blockers(walls);
            for (int i = 4; i < 8; i++)
                Assert.Eq(Exposure.None, Exterior.Classify(walls[i], b), "courtyard " + walls[i].Key);
            Assert.Eq(Exposure.Right, Exterior.Classify(walls[0], b));
        }

        [Test]
        public static void Stepped_facade_corner_uses_recess_face()
        {
            // Доод фасад шаталсан: W1 y=0 (x 0..10), P x=10 (y 0..-4), W2 y=-4 (x 10..20)
            var walls = new List<WallSeg>
            {
                W(1, 0, 0, 10, 0),
                W(2, 10, 0, 10, -4),
                W(3, 10, -4, 20, -4),
                W(4, 20, -4, 20, 8),
                W(5, 20, 8, 0, 8),
                W(6, 0, 8, 0, 0),
            };
            List<Blocker> b = Blockers(walls);
            var exp = walls.ToDictionary(w => w.Key, w => Exterior.Classify(w, b));
            // P-ийн гадна нь −X тал (W1-ийн доорх хонхорт харсан)
            WallSeg p = walls[1];
            Assert.True(p.Normal(exp[2]).Dot(new V2(-1, 0)) > 0.99, "P faces -X");

            WallSeg w1 = walls[0];
            List<Touch> touching = Walls.Touching(w1, walls);
            Tuple<WallSeg, Exposure> right = Walls.ExteriorCorner(w1, Walls.AtEnd(w1, touching, 1), k => exp[k], 1);
            Assert.True(right != null, "corner found");
            Assert.Eq(2, right.Item1.Key);
            Assert.Eq(exp[2], right.Item2, "W1 right corner = P's exterior (recess) face");

            Tuple<WallSeg, Exposure> left = Walls.ExteriorCorner(w1, Walls.AtEnd(w1, touching, 0), k => exp[k], 0);
            Assert.True(left != null && left.Item1.Key == 6, "W1 left corner = left wall");
            Assert.True(left.Item1.Normal(left.Item2).Dot(new V2(-1, 0)) > 0.99, "outer face of left wall");
        }

        [Test]
        public static void Collinear_continuation_is_not_a_corner()
        {
            // Фасад хоёр хэсэг (x 0..5, 5..10), 5 дээр дотор хана дээш
            var walls = new List<WallSeg>
            {
                W(1, 0, 0, 5, 0), W(7, 5, 0, 10, 0), W(2, 10, 0, 10, 8), W(3, 10, 8, 0, 8), W(4, 0, 8, 0, 0), W(5, 5, 0, 5, 8),
            };
            List<Blocker> b = Blockers(walls);
            var exp = walls.ToDictionary(w => w.Key, w => Exterior.Classify(w, b));
            Assert.Eq(Exposure.None, exp[5]);
            List<Touch> touching = Walls.Touching(walls[0], walls);
            Assert.True(Walls.ExteriorCorner(walls[0], Walls.AtEnd(walls[0], touching, 1), k => exp[k], 1) == null);
        }

        [Test]
        public static void Touching_finds_T_and_L_with_positions()
        {
            List<WallSeg> walls = Box();
            List<Touch> t = Walls.Touching(walls[0], walls);
            Assert.Eq(3, t.Count, "left, interior, right");
            Assert.Near(0, t[0].Pos, 1e-9);
            Assert.Near(5, t[1].Pos, 1e-9);
            Assert.Near(10, t[2].Pos, 1e-9);
            Assert.Eq(5, t[1].Wall.Key);
            // дотор хана W1-ээс 3 фут зайтай бол хүрэхгүй
            var far = new List<WallSeg> { walls[0], W(9, 5, 3, 5, 8) };
            Assert.Eq(0, Walls.Touching(walls[0], far).Count);
        }

        [Test]
        public static void FaceToward_and_FaceAway()
        {
            WallSeg w = W(1, 0, 0, 10, 0);
            WallSeg p = W(2, 5, 0, 5, 8); // зүүн нормаль нь −X
            Assert.Eq(Exposure.Left, Walls.FaceToward(w, p, 5, 2), "door at x=2 → face −X");
            Assert.Eq(Exposure.Right, Walls.FaceToward(w, p, 5, 8), "door at x=8 → face +X");
            WallSeg end = W(3, 10, 0, 10, 8); // зүүн нормаль −X
            Assert.Eq(Exposure.Right, Walls.FaceAway(w, end, 1), "W end B → outward +X");
        }

        [Test]
        public static void Chain_normalize_sorts_merges_keeps_grid()
        {
            var items = new List<ChainItem>
            {
                new ChainItem(5.0, Chain.PriorityFace, "jamb", "jamb"),
                new ChainItem(0.0, Chain.PriorityCorner, "corner", "corner"),
                new ChainItem(5.002, Chain.PriorityGrid, "grid", "grid"),
                new ChainItem(9.0, Chain.PriorityFace, "j2", "jamb"),
                new ChainItem(double.NaN, 1, "nan", "x"),
            };
            List<ChainItem> n = Chain.Normalize(items, 0.01);
            Assert.Eq(3, n.Count);
            Assert.Eq("corner", (string)n[0].Ref);
            Assert.Eq("grid", (string)n[1].Ref, "grid wins at the same spot");
            Assert.Eq("j2", (string)n[2].Ref);
            List<ChainItem> o = Chain.Overall(n);
            Assert.Eq(2, o.Count);
            Assert.Eq("j2", (string)o[1].Ref);
            Assert.Eq(0, Chain.Overall(n.Take(1).ToList()).Count);
        }

        [Test]
        public static void KeepParallel_drops_slightly_skewed_references()
        {
            // 1° эргэсэн хана Dir.Parallel-д «параллель» боловч Revit-д биш → гинжээс хасна.
            double a = Math.PI / 180;
            var items = new List<ChainItem>
            {
                new ChainItem(0, Chain.PriorityFace, "f1", "face").WithNormal(new V2(1, 0)),
                new ChainItem(2, Chain.PriorityFace, "f2", "face").WithNormal(new V2(-1, 0)),
                new ChainItem(4, Chain.PriorityGrid, "g", "grid").WithNormal(new V2(1, 0)),
                new ChainItem(6, Chain.PriorityFace, "skew", "face").WithNormal(new V2(Math.Cos(a), Math.Sin(a))),
                new ChainItem(8, Chain.PriorityFace, "nonormal", "jamb"),
            };
            Assert.True(Dir.Parallel(new V2(1, 0), new V2(Math.Cos(a), Math.Sin(a))), "loose rule calls 1° parallel");
            List<ChainItem> k = Chain.KeepParallel(items);
            Assert.Eq("f1,f2,g,nonormal", string.Join(",", k.Select(i => (string)i.Ref)));

            // Тэнцвэл тэнхлэгтэй бүлэг үлдэнэ.
            var tie = new List<ChainItem>
            {
                new ChainItem(0, Chain.PriorityFace, "a", "face").WithNormal(new V2(Math.Cos(a), Math.Sin(a))),
                new ChainItem(1, Chain.PriorityGrid, "g", "grid").WithNormal(new V2(1, 0)),
            };
            Assert.Eq("g", string.Join(",", Chain.KeepParallel(tie).Select(i => (string)i.Ref)));
            Assert.Eq(1, Chain.KeepParallel(new List<ChainItem> { items[0] }).Count, "single item untouched");
        }

        [Test]
        public static void Chain_signature_matches_same_positions()
        {
            var a = new List<ChainItem> { new ChainItem(0, 1, null, ""), new ChainItem(3.3333, 1, null, "") };
            var b = new List<ChainItem> { new ChainItem(0.0004, 3, null, ""), new ChainItem(3.3331, 1, null, "") };
            Assert.Eq(Chain.Signature(a, 0.003), Chain.Signature(b, 0.003));
            var c = new List<ChainItem> { new ChainItem(0, 1, null, ""), new ChainItem(3.5, 1, null, "") };
            Assert.True(Chain.Signature(a, 0.003) != Chain.Signature(c, 0.003));
        }

        [Test]
        public static void Frame_follows_grid_closest_to_view_right()
        {
            // 30° эргэсэн барилга: тэнхлэгүүд 30° ба 120°
            double a = Math.PI / 6;
            var dirs = new[] { new V2(Math.Cos(a), Math.Sin(a)), new V2(-Math.Sin(a), Math.Cos(a)) };
            AaFrame f = AaFrame.FromDirections(dirs, new V2(1, 0));
            Assert.Near(Math.Cos(a), f.U.X, 1e-9);
            Assert.Near(Math.Sin(a), f.U.Y, 1e-9);
            Assert.Near(0, f.U.Dot(f.V), 1e-12);
            Assert.True(f.SideOf(-f.V) == Side.Bottom);
            Assert.True(f.SideOf(f.U) == Side.Right);
            Assert.True(f.SideOf(new V2(1, 1)) == null, "45° off-frame → no side");

            AaFrame axis = AaFrame.FromDirections(new V2[0], new V2(1, 0));
            Assert.Near(1, axis.U.X, 1e-12);
            // зөвхөн босоо тэнхлэг → U нь хэвтээ хэвээр
            AaFrame vert = AaFrame.FromDirections(new[] { new V2(0, -1) }, new V2(1, 0));
            Assert.Near(1, vert.U.X, 1e-12);
        }

        [Test]
        public static void Box_edges_are_outward_coordinates()
        {
            AaFrame f = AaFrame.Axis;
            var b = new Box();
            b.Add(f, new V2(-2, 1));
            b.Add(f, new V2(8, 5));
            Assert.Near(-1, b.Edge(Side.Bottom), 1e-12, "−minV");
            Assert.Near(5, b.Edge(Side.Top), 1e-12);
            Assert.Near(8, b.Edge(Side.Right), 1e-12);
            Assert.Near(2, b.Edge(Side.Left), 1e-12, "−minU");
            // гадагш координат: доод талын ирмэгээс 3 фут гадна цэг
            V2 p = new V2(0, 1 - 3);
            Assert.Near(b.Edge(Side.Bottom) + 3, p.Dot(f.Outward(Side.Bottom)), 1e-12);
        }

        [Test]
        public static void Paper_mm_to_feet()
        {
            Assert.Near(1000 / 304.8, Paper.ToFeet(10, 100), 1e-12, "10 мм @1:100 = 1 м");
            Assert.Near(500 / 304.8, Paper.ToFeet(10, 50), 1e-12);
            Assert.Near(1000 / 304.8, Paper.ToFeet(10, 0), 1e-12, "0 масштаб → 1:100");
        }

        [Test]
        public static void ScanLines_bay_mids_and_avoid()
        {
            List<double> mids = ScanLines.BayMids(new[] { 20.0, 0, 10, 10.5 }, 3);
            Assert.Eq(2, mids.Count, "0.5 алхам алгасна");
            Assert.Near(5, mids[0], 1e-12);
            Assert.Near(15.25, mids[1], 1e-12);

            double? y = ScanLines.Avoid(5, 0, 10, new[] { 5.1 }, 0.5, 0.6, 1);
            Assert.True(y.HasValue);
            Assert.True(Math.Abs(y.Value - 5.1) >= 0.5, "cleared the tag");
            Assert.Near(5.6, y.Value, 1e-9, "first step up");
            Assert.True(ScanLines.Avoid(5, 4.5, 5.5, new[] { 5.0 }, 2, 0.1, 0.2) == null, "no room");
        }

        [Test]
        public static void Nearest_index_with_limit()
        {
            var c = new List<double> { 0, 10, 20 };
            Assert.Eq(1, Nearest.Index(c, 11, 5));
            Assert.Eq(-1, Nearest.Index(c, 15.5, 4));
        }

        [Test]
        public static void Ray_hits_segment_ahead_only()
        {
            var s = new Seg(new V2(-1, 5), new V2(1, 5));
            Assert.Near(5, s.Ray(new V2(0, 0), new V2(0, 1)).Value, 1e-12);
            Assert.True(s.Ray(new V2(0, 0), new V2(0, -1)) == null, "behind");
            Assert.True(s.Ray(new V2(3, 0), new V2(0, 1)) == null, "misses");
            Assert.True(s.Ray(new V2(0, 5), new V2(1, 0)) == null, "parallel");
        }

        [Test]
        public static void TextLayout_moves_end_texts_out_and_staggers_middle()
        {
            // 5 сегмент: [бага, том, бага, бага, бага] — бичвэр 8 мм
            var len = new[] { 3.0, 40, 3, 3, 3 };
            var w = new[] { 8.0, 8, 8, 8, 8 };
            TextPlace[] p = TextLayout.Plan(len, w, 1);
            Assert.Eq(TextPlace.Before, p[0]);
            Assert.Eq(TextPlace.Default, p[1]);
            Assert.Eq(TextPlace.Default, p[2], "first small in a middle run stays");
            Assert.Eq(TextPlace.Raised, p[3], "second small is raised");
            Assert.Eq(TextPlace.After, p[4]);
            // бүгд багтана → өөрчлөлтгүй
            Assert.True(TextLayout.Plan(new[] { 20.0, 20 }, new[] { 8.0, 8 }, 1).All(x => x == TextPlace.Default));
            // эхнийх гадагш гарсан бол дараагийнх нь дунд нь үлдэнэ
            TextPlace[] q = TextLayout.Plan(new[] { 3.0, 3, 30 }, new[] { 8.0, 8, 8 }, 1);
            Assert.Eq(TextPlace.Before, q[0]);
            Assert.Eq(TextPlace.Default, q[1]);
        }
    }
}
