using System;
using System.Collections.Generic;
using RevitMcpAddin.Reinforcement.Core;

namespace RevitMcpAddin.Reinforcement.Tests
{
    public static class ChainTests
    {
        private const double Eps = 1e-9;

        private static RfSeg Line(double x0, double y0, double x1, double y1)
        {
            RfV3 a = new RfV3(x0, y0, 0), b = new RfV3(x1, y1, 0);
            RfV3 d = (b - a).Normalized();
            return new RfSeg(a, b, d, d);
        }

        [Test]
        public static void Chain_single_straight_bar()
        {
            RfChainEnd s, e;
            Assert.True(RfChain.FindEnds(new List<RfSeg> { Line(0, 0, 10, 0) }, out s, out e));
            Assert.Near(0, s.Position.X, Eps);
            Assert.Near(-1, s.Outward.X, Eps, "эхэнд гадагш = −шүргэгч");
            Assert.Near(10, e.Position.X, Eps);
            Assert.Near(1, e.Outward.X, Eps);
        }

        [Test]
        public static void Chain_L_shape_ordered()
        {
            var segs = new List<RfSeg> { Line(0, 0, 10, 0), Line(10, 0, 10, 5) };
            RfChainEnd s, e;
            RfChain.FindEnds(segs, out s, out e);
            Assert.Near(0, s.Position.X, Eps);
            Assert.Near(10, e.Position.X, Eps);
            Assert.Near(5, e.Position.Y, Eps);
            Assert.Near(1, e.Outward.Y, Eps, "төгсгөлийн чиглэл дагуу (+Y)");
        }

        [Test]
        public static void Chain_with_a_reversed_middle_curve_still_finds_true_ends()
        {
            // Дундах муруй эсрэг чиглэлд (B→A) өгөгдсөн: A=(10,5), B=(10,0).  Гинжийн үзүүр (0,0) ба (10,5) хэвээр.
            RfV3 a = new RfV3(10, 5, 0), b = new RfV3(10, 0, 0);
            RfV3 d = (b - a).Normalized();
            var segs = new List<RfSeg> { Line(0, 0, 10, 0), new RfSeg(a, b, d, d), Line(10, 5, 20, 5) };
            RfChainEnd s, e;
            RfChain.FindEnds(segs, out s, out e);
            Assert.Near(0, s.Position.X, Eps);
            Assert.Near(0, s.Position.Y, Eps);
            Assert.Near(20, e.Position.X, Eps);
            Assert.Near(5, e.Position.Y, Eps);
        }

        [Test]
        public static void Chain_given_in_reverse_order_keeps_revit_start_as_lowest_index_free_end()
        {
            // Муруйнууд цаанаасаа: curves[0] = (20,5)→(10,5)… энэ нь «эхлэл» (индекс бага) = (20,5).
            var segs = new List<RfSeg> { Line(20, 5, 10, 5), Line(10, 5, 10, 0), Line(10, 0, 0, 0) };
            RfChainEnd s, e;
            RfChain.FindEnds(segs, out s, out e);
            Assert.Near(20, s.Position.X, Eps);
            Assert.Near(1, s.Outward.X, Eps, "эхлэл (20,5): муруйн дотроос гадагш = +X");
            Assert.Near(0, e.Position.X, Eps);
            Assert.Near(-1, e.Outward.X, Eps);
        }

        [Test]
        public static void Chain_end_outward_when_last_curve_is_stored_reversed()
        {
            // Сүүлийн муруй (10,0)→(20,0) биш, (20,0)→(10,0) гэж хадгалагдсан: чөлөөт үзүүр нь A (20,0) → гадагш = −TA.
            RfV3 a = new RfV3(20, 0, 0), b = new RfV3(10, 0, 0);
            RfV3 d = (b - a).Normalized();
            var segs = new List<RfSeg> { Line(0, 0, 10, 0), new RfSeg(a, b, d, d) };
            RfChainEnd s, e;
            RfChain.FindEnds(segs, out s, out e);
            Assert.Near(20, e.Position.X, Eps);
            Assert.Near(1, e.Outward.X, Eps, "хамгийн төгсгөл (20,0) — гадагш +X");
        }

        [Test]
        public static void Chain_closed_loop_falls_back_to_revit_order()
        {
            var segs = new List<RfSeg> { Line(0, 0, 10, 0), Line(10, 0, 10, 10), Line(10, 10, 0, 10), Line(0, 10, 0, 0) };
            RfChainEnd s, e;
            Assert.True(RfChain.FindEnds(segs, out s, out e));
            Assert.Near(0, s.Position.X, Eps);
            Assert.Near(0, e.Position.X, Eps);
        }

        [Test]
        public static void Chain_empty_returns_false()
        {
            RfChainEnd s, e;
            Assert.False(RfChain.FindEnds(new List<RfSeg>(), out s, out e));
        }

        [Test]
        public static void DupKey_includes_hook_flag()
        {
            string a = RfEndSymbolMath.DupKey("u", RfEndKind.End, 0, true);
            string b = RfEndSymbolMath.DupKey("u", RfEndKind.End, 0, false);
            Assert.True(a != b, "дэгээг солиход өөр байрлал — «аль хэдийн тавигдсан» гэж үзэж болохгүй");
        }
    }
}
