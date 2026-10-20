using System;
using System.Collections.Generic;
using System.Linq;
using RevitMcpAddin.Reinforcement.Core;

namespace RevitMcpAddin.Reinforcement.Tests
{
    /// <summary>
    /// ГИНЖИН хэмжээс (continuous chain): тэнхлэг тус бүрд ЯГ НЭГ — бетон нүүр → хомутын ирмэг → хомутын ирмэг → бетон нүүр.
    /// Лавлагааны дараалал ЛОКАЛ тэнхлэгийн координатаар (ElementId / геометр туулсан дарааллаар БИШ).  Revit-ийн бодит Reference-г энд шалгахгүй
    /// (REQUIRES REVIT QA) — харин ТӨЛӨВЛӨГӨӨ: ямар лавлагаа, ямар дарааллаар, ямар хүлээгдэж буй сегменттэй.
    /// </summary>
    public static class DimChainTests
    {
        private const double Mm = 1.0 / 304.8;

        // ── Туслах (StirrupSpecTests-тэй ижил 300×500 дам нуруу) ──────────

        private static RfV2 Rot(double theta, double x, double y)
        {
            return new RfV2(x * Math.Cos(theta) - y * Math.Sin(theta), x * Math.Sin(theta) + y * Math.Cos(theta));
        }

        private static RfViewFrame PlanView()
        {
            return new RfViewFrame(new RfV3(0, 0, 0), new RfV3(1, 0, 0), new RfV3(0, 1, 0), new RfV3(0, 0, 1));
        }

        private static List<RfFaceSample> Faces(double wMm, double hMm, double theta)
        {
            RfV2 u = Rot(theta, 1, 0), v = Rot(theta, 0, 1);
            double w = wMm * Mm, h = hMm * Mm, len = 3000 * Mm;
            RfV2 c = new RfV2(0, 0);
            return new List<RfFaceSample>
            {
                new RfFaceSample { Id = 1, Origin = c - u * (w / 2), Normal = -u, Area = h * len },
                new RfFaceSample { Id = 2, Origin = c + u * (w / 2), Normal = u, Area = h * len },
                new RfFaceSample { Id = 3, Origin = c - v * (h / 2), Normal = -v, Area = w * len },
                new RfFaceSample { Id = 4, Origin = c + v * (h / 2), Normal = v, Area = w * len },
            };
        }

        private static RfSectionInput Beam(double theta, RfStirrupRef r, double centerlineMm, double diaMm)
        {
            var input = new RfSectionInput { View = PlanView() };
            input.Faces.AddRange(Faces(300, 500, theta));
            var s = new RfBarSample { Id = 77, BarIndex = 0, Diameter = diaMm * Mm };
            double hw = (300.0 / 2 - centerlineMm) * Mm, hh = (500.0 / 2 - centerlineMm) * Mm;
            double[][] k = { new[] { -hw, -hh }, new[] { hw, -hh }, new[] { hw, hh }, new[] { -hw, hh }, new[] { -hw, -hh } };
            foreach (double[] q in k)
            {
                RfV2 p = Rot(theta, q[0], q[1]);
                s.Points.Add(new RfV3(p.X, p.Y, 0));
            }
            input.Stirrups.Add(s);
            input.Options.Ref = r;
            input.Options.DimOffsetFt = 100 * Mm;
            input.Options.TagLongitudinal = false;
            input.Options.TagStirrups = false;
            return input;
        }

        private static RfDimChain Chain(RfSectionPlan plan, bool alongU)
        {
            return plan.Chains.First(c => c.AlongU == alongU);
        }

        private static List<double> Mms(IEnumerable<double> ft)
        {
            return ft.Select(x => Math.Round(x / Mm, 6)).ToList();
        }

        // ── Тэнхлэг бүрд яг нэг гинж, дараалал ──────────────────────────

        [Test]
        public static void Chain_one_per_axis_with_four_ordered_refs_for_any_member_rotation()
        {
            foreach (double deg in new[] { 0.0, 30, 45, 90, 135 })
            {
                RfSectionPlan plan = RfSectionPlanner.Build(Beam(deg * Math.PI / 180, RfStirrupRef.Outer, 30, 8));
                Assert.Eq(2, plan.Chains.Count, deg + "° — тэнхлэг бүрд НЭГ гинж (хэмжээс тус тусдаа БИШ)");
                Assert.Eq(1, plan.Chains.Count(c => c.AlongU));
                Assert.Eq(1, plan.Chains.Count(c => !c.AlongU));
                foreach (RfDimChain c in plan.Chains)
                {
                    Assert.Eq(4, c.Refs.Count, deg + "° лавлагаа");
                    Assert.Eq(3, c.SegmentCount);
                    Assert.True(c.IsValid);
                    Assert.SeqEq(new[] { RfChainRefKind.Face, RfChainRefKind.Stirrup, RfChainRefKind.Stirrup, RfChainRefKind.Face }, c.Refs.Select(r => r.Kind), deg + "° төрлийн дараалал");
                    for (int i = 0; i + 1 < c.Refs.Count; i++)
                        Assert.True(c.Refs[i].Pos < c.Refs[i + 1].Pos, deg + "° байрлал өсөх дарааллаар");
                }
            }
        }

        [Test]
        public static void Chain_segments_for_30_dia8_outer_are_26_inside_26_on_each_axis()
        {
            RfSectionPlan plan = RfSectionPlanner.Build(Beam(0, RfStirrupRef.Outer, 30, 8));
            List<double> h = Mms(Chain(plan, true).ExpectedSegments());
            List<double> v = Mms(Chain(plan, false).ExpectedSegments());
            Assert.Near(26, h[0], 1e-6, "зүүн cover");
            Assert.Near(248, h[1], 1e-6, "хомутын дотор (300 − 2·26 = 248)");
            Assert.Near(26, h[2], 1e-6, "баруун cover");
            Assert.Near(26, v[0], 1e-6, "доод cover");
            Assert.Near(448, v[1], 1e-6, "500 − 2·26");
            Assert.Near(26, v[2], 1e-6, "дээд cover");
        }

        [Test]
        public static void Chain_segments_for_30_dia8_inner_are_34_inside_34_on_each_axis()
        {
            RfSectionPlan plan = RfSectionPlanner.Build(Beam(0, RfStirrupRef.Inner, 30, 8));
            List<double> h = Mms(Chain(plan, true).ExpectedSegments());
            List<double> v = Mms(Chain(plan, false).ExpectedSegments());
            Assert.SeqEq(new[] { 34.0, 232.0, 34.0 }, h);
            Assert.SeqEq(new[] { 34.0, 432.0, 34.0 }, v);
        }

        [Test]
        public static void Chain_keeps_the_critical_30_dia8_outer26_inner34_geometry_for_all_rotations()
        {
            foreach (double deg in new[] { 0.0, 45, 90, 135 })
            {
                foreach (var kv in new[] { new KeyValuePair<RfStirrupRef, double>(RfStirrupRef.Outer, 26), new KeyValuePair<RfStirrupRef, double>(RfStirrupRef.Inner, 34) })
                {
                    RfSectionPlan plan = RfSectionPlanner.Build(Beam(deg * Math.PI / 180, kv.Key, 30, 8));
                    foreach (RfDimChain c in plan.Chains)
                    {
                        List<double> seg = Mms(c.ExpectedSegments());
                        Assert.Near(kv.Value, seg[0], 1e-6, deg + "° " + kv.Key + " эхний cover");
                        Assert.Near(kv.Value, seg[2], 1e-6, deg + "° " + kv.Key + " сүүлийн cover");
                    }
                    foreach (RfDimPlan d in plan.Dims) Assert.Near(kv.Value, d.Distance / Mm, 1e-6);
                }
            }
        }

        [Test]
        public static void Chain_positions_are_projections_onto_the_member_local_axes_not_view_axes()
        {
            foreach (double deg in new[] { 0.0, 45, 90, 135 })
            {
                RfSectionPlan plan = RfSectionPlanner.Build(Beam(deg * Math.PI / 180, RfStirrupRef.Outer, 30, 8));
                RfStirrupLoop loop = plan.Loops[0];
                RfDimChain h = Chain(plan, true), v = Chain(plan, false);
                // Хомутын голын шугамын хүрээ ± d/2 (гадна) нь гинжний дотоод хоёр лавлагаа.
                double half = 4 * Mm;
                Assert.Near(loop.MinU - half, h.Refs[1].Pos, 1e-9, deg + "° зүүн хомутын ирмэг (U)");
                Assert.Near(loop.MaxU + half, h.Refs[2].Pos, 1e-9, deg + "° баруун хомутын ирмэг (U)");
                Assert.Near(loop.MinV - half, v.Refs[1].Pos, 1e-9, deg + "° доод хомутын ирмэг (V)");
                Assert.Near(loop.MaxV + half, v.Refs[2].Pos, 1e-9, deg + "° дээд хомутын ирмэг (V)");
                Assert.Near(plan.Rect.MinU, h.Refs[0].Pos, 1e-9);
                Assert.Near(plan.Rect.MaxU, h.Refs[3].Pos, 1e-9);
                Assert.Near(plan.Rect.MinV, v.Refs[0].Pos, 1e-9);
                Assert.Near(plan.Rect.MaxV, v.Refs[3].Pos, 1e-9);

                // Харагдацын 2D дээр, хэмжих чиглэл (гишүүний U) дагуу ХАТУУ өсөх.
                for (int i = 0; i + 1 < h.Refs.Count; i++)
                {
                    RfV2 a = plan.Frame.ToView(new RfV2(h.Refs[i].Pos, h.LinePos));
                    RfV2 b = plan.Frame.ToView(new RfV2(h.Refs[i + 1].Pos, h.LinePos));
                    Assert.True((b - a).Dot(plan.Frame.U) > 0, deg + "° хэвтээ гинж чиглэлээрээ өсөх");
                }
                for (int i = 0; i + 1 < v.Refs.Count; i++)
                {
                    RfV2 a = plan.Frame.ToView(new RfV2(v.LinePos, v.Refs[i].Pos));
                    RfV2 b = plan.Frame.ToView(new RfV2(v.LinePos, v.Refs[i + 1].Pos));
                    Assert.True((b - a).Dot(plan.Frame.V) > 0, deg + "° босоо гинж чиглэлээрээ өсөх");
                }
            }
        }

        [Test]
        public static void Chain_order_does_not_depend_on_input_order()
        {
            RfSectionInput a = Beam(0.4, RfStirrupRef.Outer, 30, 8);
            RfSectionInput b = Beam(0.4, RfStirrupRef.Outer, 30, 8);
            b.Faces.Reverse();
            b.Stirrups[0].Points.Reverse();
            RfSectionPlan pa = RfSectionPlanner.Build(a), pb = RfSectionPlanner.Build(b);
            Func<RfSectionPlan, string> sig = p => string.Join(";", p.Chains.OrderBy(c => c.AlongU)
                .Select(c => (c.AlongU ? "U" : "V") + ":" + string.Join(",", c.Refs.Select(r => r.Kind + "@" + Math.Round(r.Pos / Mm, 4)))));
            Assert.Eq(sig(pa), sig(pb));
        }

        // ── Давхардал, ElementId-ээс үл хамаарах эрэмбэ ───────────────────

        private static RfChainRef Ref(RfChainRefKind k, RfSide s, double posMm, long stirrupId = 0, int faceId = -1)
        {
            return new RfChainRef { Kind = k, Side = s, Pos = posMm * Mm, StirrupId = stirrupId, FaceId = faceId };
        }

        [Test]
        public static void Chain_order_uses_position_never_element_ids()
        {
            // ElementId-ууд ТОГТМОЛ БИШ дарааллаар (id том нь байрлалаараа эхэнд) — эрэмбэ зөвхөн байрлалаар.
            var raw = new List<RfChainRef>
            {
                Ref(RfChainRefKind.Stirrup, RfSide.Right, 124, stirrupId: 5),
                Ref(RfChainRefKind.Face, RfSide.Right, 150, faceId: 9),
                Ref(RfChainRefKind.Stirrup, RfSide.Left, -124, stirrupId: 999),
                Ref(RfChainRefKind.Face, RfSide.Left, -150, faceId: 2),
            };
            List<RfChainRef> o = RfDimChains.OrderAndDedupe(raw, RfTol.DimMatchFt, null);
            Assert.SeqEq(new[] { -150.0, -124.0, 124.0, 150.0 }, o.Select(r => Math.Round(r.Pos / Mm, 6)));
            Assert.SeqEq(new long[] { -1, 999, 5, -1 }, o.Select(r => r.Kind == RfChainRefKind.Stirrup ? r.StirrupId : -1L));
        }

        [Test]
        public static void Chain_duplicate_coincident_references_are_removed_and_face_wins()
        {
            var raw = new List<RfChainRef>
            {
                Ref(RfChainRefKind.Stirrup, RfSide.Left, -150), // нүүртэй давхцсан (cover = 0)
                Ref(RfChainRefKind.Face, RfSide.Left, -150, faceId: 1),
                Ref(RfChainRefKind.Stirrup, RfSide.Right, 124),
                Ref(RfChainRefKind.Face, RfSide.Right, 150, faceId: 2),
            };
            var dropped = new List<RfSide>();
            List<RfChainRef> o = RfDimChains.OrderAndDedupe(raw, RfTol.DimMatchFt, dropped);
            Assert.Eq(3, o.Count);
            Assert.Eq(RfChainRefKind.Face, o[0].Kind, "давхцсан үед нүүр үлдэнэ");
            Assert.SeqEq(new[] { RfSide.Left }, dropped, "хасагдсан хомутын тал");
        }

        [Test]
        public static void Chain_dedupe_tolerance_boundary_is_half_a_millimetre()
        {
            var near = new List<RfChainRef> { Ref(RfChainRefKind.Face, RfSide.Left, 0, faceId: 1), Ref(RfChainRefKind.Stirrup, RfSide.Left, 0.4) };
            Assert.Eq(1, RfDimChains.OrderAndDedupe(near, RfTol.DimMatchFt, null).Count, "0.4 мм ⇒ нэг лавлагаа");
            var far = new List<RfChainRef> { Ref(RfChainRefKind.Face, RfSide.Left, 0, faceId: 1), Ref(RfChainRefKind.Stirrup, RfSide.Left, 0.6) };
            Assert.Eq(2, RfDimChains.OrderAndDedupe(far, RfTol.DimMatchFt, null).Count, "0.6 мм ⇒ хоёр лавлагаа");
        }

        [Test]
        public static void Chain_with_zero_cover_collapses_to_faces_and_is_not_a_stirrup_dimension()
        {
            // Хомутын гадна ирмэг нүүртэй яг давхцсан (голын шугам = d/2): хомутын лавлагаа алга, зөвхөн бетоны өргөн үлдэх тул гинж хүчингүй.
            RfSectionPlan plan = RfSectionPlanner.Build(Beam(0, RfStirrupRef.Outer, 4, 8));
            RfDimChain h = Chain(plan, true);
            Assert.Eq(2, h.Refs.Count);
            Assert.True(h.Refs.All(r => r.Kind == RfChainRefKind.Face));
            Assert.False(h.IsValid, "хомутын лавлагаагүй гинж = бетоны өргөн л, хомутын хэмжээс БИШ");
            Assert.Eq(2, h.Coincident.Count);
        }

        [Test]
        public static void Chain_with_one_selected_side_is_a_two_reference_chain()
        {
            RfSectionInput input = Beam(0, RfStirrupRef.Outer, 30, 8);
            input.Options.Right = false;
            input.Options.Top = false;
            input.Options.Bottom = false;
            RfSectionPlan plan = RfSectionPlanner.Build(input);
            Assert.Eq(1, plan.Chains.Count, "зөвхөн хэвтээ");
            RfDimChain h = plan.Chains[0];
            Assert.True(h.AlongU);
            Assert.SeqEq(new[] { RfChainRefKind.Face, RfChainRefKind.Stirrup }, h.Refs.Select(r => r.Kind));
            Assert.True(h.IsValid);
            Assert.SeqEq(new[] { 26.0 }, Mms(h.ExpectedSegments()));
        }

        [Test]
        public static void Chain_not_planned_when_dimensions_are_off_or_no_stirrup()
        {
            RfSectionInput off = Beam(0, RfStirrupRef.Outer, 30, 8);
            off.Options.DoDimensions = false;
            Assert.Eq(0, RfSectionPlanner.Build(off).Chains.Count);

            RfSectionInput none = Beam(0, RfStirrupRef.Outer, 30, 8);
            none.Stirrups.Clear();
            Assert.Eq(0, RfSectionPlanner.Build(none).Chains.Count, "хомутгүй ⇒ хэмжээс зохиохгүй");
        }

        [Test]
        public static void Chain_ref_carries_what_the_renderer_needs_to_find_the_real_reference()
        {
            RfSectionPlan plan = RfSectionPlanner.Build(Beam(0, RfStirrupRef.Inner, 30, 8));
            RfDimChain h = Chain(plan, true);
            Assert.Eq(plan.Rect.FaceLeft, h.Refs[0].FaceId, "зүүн нүүрний id");
            Assert.Eq(plan.Rect.FaceRight, h.Refs[3].FaceId);
            Assert.Eq(77L, h.Refs[1].StirrupId);
            Assert.Eq(RfStirrupRef.Inner, h.Refs[1].Ref);
            Assert.Near(8 * Mm, h.Refs[1].StirrupDiameter, 1e-12);
            Assert.True(h.Refs[1].SpanMax > h.Refs[1].SpanMin, "хомутын ирмэгийн хүрээ (бодит ирмэгийн Reference хайхад)");
        }

        [Test]
        public static void Chain_dimension_line_sits_outside_the_member_at_the_offset()
        {
            RfSectionInput input = Beam(0, RfStirrupRef.Outer, 30, 8);
            RfSectionPlan plan = RfSectionPlanner.Build(input);
            Assert.Near(plan.Rect.MaxV + input.Options.DimOffsetFt, Chain(plan, true).LinePos, 1e-9, "хэвтээ гинж дээд талд");
            Assert.Near(plan.Rect.MaxU + input.Options.DimOffsetFt, Chain(plan, false).LinePos, 1e-9, "босоо гинж баруун талд");
        }

        [Test]
        public static void User_can_put_the_chains_below_and_on_the_left_at_their_own_distance()
        {
            foreach (double theta in new[] { 0.0, 30.0 })
            {
                RfSectionInput input = Beam(theta, RfStirrupRef.Outer, 30, 8);
                input.Options.HorizontalDimSide = RfSide.Bottom;
                input.Options.VerticalDimSide = RfSide.Left;
                input.Options.DimOffsetFt = 250 * Mm;
                RfSectionPlan plan = RfSectionPlanner.Build(input);
                RfDimChain h = Chain(plan, true), v = Chain(plan, false);
                Assert.Near(plan.Rect.MinV - 250 * Mm, h.LinePos, 1e-9, "хэвтээ гинж ДООД талд, ирмэгээс яг 250");
                Assert.Near(plan.Rect.MinU - 250 * Mm, v.LinePos, 1e-9, "босоо гинж ЗҮҮН талд, ирмэгээс яг 250");
                // Тэр талын шошго хэмжээсийн шугамаас цааш (давхцахгүй).
                foreach (RfTagPlan t in plan.Tags)
                {
                    if (t.Side == RfSide.Bottom) Assert.True(t.Head.Y < h.LinePos, "доод шошго хэмжээсээс доош");
                    if (t.Side == RfSide.Left) Assert.True(t.Head.X < v.LinePos, "зүүн шошго хэмжээсээс зүүн");
                }
            }
        }

        [Test]
        public static void All_sides_puts_each_chain_on_both_sides_and_tags_beyond_them()
        {
            RfSectionInput input = Beam(0, RfStirrupRef.Outer, 30, 8);
            input.Options.HorizontalDimSide = RfSide.Bottom;
            input.Options.VerticalDimSide = RfSide.Left;
            input.Options.DimAllSides = true;
            RfSectionPlan plan = RfSectionPlanner.Build(input);
            List<RfDimChain> h = plan.Chains.Where(c => c.AlongU).ToList(), v = plan.Chains.Where(c => !c.AlongU).ToList();
            Assert.Eq(2, h.Count);
            Assert.Eq(2, v.Count);
            double off = input.Options.DimOffsetFt;
            Assert.True(h.Any(c => Math.Abs(c.LinePos - (plan.Rect.MinV - off)) < 1e-9) && h.Any(c => Math.Abs(c.LinePos - (plan.Rect.MaxV + off)) < 1e-9), "хэвтээ: доор БА дээр");
            Assert.True(v.Any(c => Math.Abs(c.LinePos - (plan.Rect.MinU - off)) < 1e-9) && v.Any(c => Math.Abs(c.LinePos - (plan.Rect.MaxU + off)) < 1e-9), "босоо: зүүн БА баруун");
            Assert.Eq(h[0].Refs.Count, h[1].Refs.Count, "ижил лавлагаа");
            foreach (RfTagPlan t in plan.Tags)
            {
                if (t.Side == RfSide.Top) Assert.True(t.Head.Y > plan.Rect.MaxV + off, "дээд шошго дээд хэмжээсээс цааш");
                if (t.Side == RfSide.Right) Assert.True(t.Head.X > plan.Rect.MaxU + off, "баруун шошго баруун хэмжээсээс цааш");
            }
        }

        [Test]
        public static void Invalid_side_choice_falls_back_to_top_and_right()
        {
            var o = new RfSectionOptions { HorizontalDimSide = RfSide.Left, VerticalDimSide = RfSide.Top };
            Assert.Eq(RfSide.Top, o.DimSideFor(true));
            Assert.Eq(RfSide.Right, o.DimSideFor(false));
        }
    }
}
