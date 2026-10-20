using System;
using System.Collections.Generic;
using System.Linq;
using RevitMcpAddin.Reinforcement.Core;

namespace RevitMcpAddin.Reinforcement.Tests
{
    /// <summary>
    /// 2026-10-08 эзний 4 хүсэлтийн цөм: (1) огтлолын гишүүний хэмжээс тэнхлэг/хучилт/ханатай (Зураг 2 — «150 | 150», «170 | 330»),
    /// (2) дэлгээсийн давхцалтай арматурын үргэлжилсэн хэмжээс + MRA-ийн зай ЯГ, (3) хана/хучилтын шошго ба үргэлжилсэн хэмжээс.
    /// </summary>
    public static class Oct08FeedbackTests
    {
        private const double Mm = 1.0 / 304.8;

        // ══ 1. Гишүүний гадна гинж ═══════════════════════════════════════

        /// <summary>Зураг 2-ын дам нуруу: 300 × 500, огтлолд u ∈ [−150, 150], v ∈ [−500, 0] (дээд нүүр = 3.50 түвшин = 0).</summary>
        private static RfSectionRect Beam300x500()
        {
            return new RfSectionRect
            {
                MinU = -150 * Mm, MaxU = 150 * Mm, MinV = -500 * Mm, MaxV = 0,
                FaceLeft = 1, FaceRight = 2, FaceBottom = 3, FaceTop = 4,
            };
        }

        private static RfSectionOptions Opt()
        {
            return new RfSectionOptions { MemberDims = true, DimOffsetFt = 500 * Mm, MemberPitchFt = 400 * Mm, MemberReachFt = 1000 * Mm };
        }

        private static RfAuxSample Grid(int id, double uMm)
        {
            return new RfAuxSample { Id = id, Kind = RfAuxKind.Grid, Origin = new RfV2(uMm * Mm, 0), Normal = new RfV2(1, 0) };
        }

        private static RfAuxSample SlabFace(int id, double vMm)
        {
            return new RfAuxSample { Id = id, Kind = RfAuxKind.Slab, Origin = new RfV2(2000 * Mm, vMm * Mm), Normal = new RfV2(0, vMm < -1 ? -1 : 1) };
        }

        private static List<RfDimChain> StirrupChains(bool u, bool v)
        {
            var list = new List<RfDimChain>();
            foreach (bool along in new[] { true, false })
            {
                if (along ? !u : !v) continue;
                var c = new RfDimChain { AlongU = along };
                c.Refs.Add(new RfChainRef { Kind = RfChainRefKind.Face, Side = along ? RfSide.Left : RfSide.Bottom, Pos = 0 });
                c.Refs.Add(new RfChainRef { Kind = RfChainRefKind.Stirrup, Side = along ? RfSide.Left : RfSide.Bottom, Pos = 30 * Mm });
                list.Add(c);
            }
            return list;
        }

        [Test]
        public static void Figure2_beam_gets_face_grid_face_and_top_slabbottom_bottom_outside_the_stirrup_chains()
        {
            var aux = new List<RfAuxSample> { Grid(10, 0), SlabFace(11, 0), SlabFace(12, -170) };
            List<RfMemberChain> chains = RfMemberDims.Build(Beam300x500(), RfSectionFrame.Identity, aux, StirrupChains(true, true), Opt(), null);
            Assert.Eq(2, chains.Count);
            RfMemberChain h = chains.Single(c => c.AlongU), v = chains.Single(c => !c.AlongU);
            Assert.SeqEq(new[] { -150.0, 0.0, 150.0 }, h.Positions().Select(p => Math.Round(p / Mm, 3)), "нүүр | тэнхлэг | нүүр = 150 | 150");
            Assert.Eq(RfMemberRefKind.Grid, h.Refs[1].Kind);
            Assert.SeqEq(new[] { -500.0, -170.0, 0.0 }, v.Positions().Select(p => Math.Round(p / Mm, 3)), "доод нүүр | хучилтын доод | дээд нүүр = 330 | 170");
            Assert.Eq(RfMemberRefKind.HostFace, v.Refs[2].Kind, "хучилтын дээд нь гишүүний дээд нүүртэй давхцсан — нүүр үлдэнэ");
            Assert.Near(0 + 500 * Mm + 400 * Mm, h.LinePos, 1e-9, "хэвтээ: дээд талд, хомутын гинжээс нэг эгнээ цааш");
            Assert.Near(150 * Mm + 500 * Mm + 400 * Mm, v.LinePos, 1e-9, "босоо: баруун талд, хомутын гинжээс нэг эгнээ цааш");
        }

        [Test]
        public static void Outer_chain_follows_the_chosen_bottom_and_left_sides()
        {
            var aux = new List<RfAuxSample> { Grid(10, 0), SlabFace(11, 0), SlabFace(12, -170) };
            RfSectionOptions o = Opt();
            o.HorizontalDimSide = RfSide.Bottom;
            o.VerticalDimSide = RfSide.Left;
            List<RfMemberChain> chains = RfMemberDims.Build(Beam300x500(), RfSectionFrame.Identity, aux, StirrupChains(true, true), o, null);
            RfMemberChain h = chains.Single(c => c.AlongU), v = chains.Single(c => !c.AlongU);
            Assert.Near(-500 * Mm - 500 * Mm - 400 * Mm, h.LinePos, 1e-9, "хэвтээ: доод талд, хомутын гинжээс нэг эгнээ цааш");
            Assert.Near(-150 * Mm - 500 * Mm - 400 * Mm, v.LinePos, 1e-9, "босоо: зүүн талд, хомутын гинжээс нэг эгнээ цааш");
        }

        [Test]
        public static void Outer_chain_on_all_four_sides_when_chosen()
        {
            var aux = new List<RfAuxSample> { Grid(10, 0), SlabFace(11, 0), SlabFace(12, -170) };
            RfSectionOptions o = Opt();
            o.HorizontalDimSide = RfSide.Bottom;
            o.VerticalDimSide = RfSide.Left;
            o.DimAllSides = true;
            List<RfMemberChain> chains = RfMemberDims.Build(Beam300x500(), RfSectionFrame.Identity, aux, StirrupChains(true, true), o, null);
            Assert.Eq(4, chains.Count);
            Assert.SeqEq(new[] { -1400.0, 900.0 }, chains.Where(c => c.AlongU).Select(c => Math.Round(c.LinePos / Mm, 3)).OrderBy(x => x), "хэвтээ доор/дээр");
            Assert.SeqEq(new[] { -1050.0, 1050.0 }, chains.Where(c => !c.AlongU).Select(c => Math.Round(c.LinePos / Mm, 3)).OrderBy(x => x), "босоо зүүн/баруун");
        }

        [Test]
        public static void Wall_slab_overall_line_is_first_from_host_or_step_beyond_annotations()
        {
            double inf = double.PositiveInfinity;
            // Тэмдэглэгээгүй: ирмэгээс яг «эхний гинж».
            Assert.Near(-10, RfSetMraPlanner.OverallLine(0, inf, false, 10, 8), 1e-12);
            Assert.Near(110, RfSetMraPlanner.OverallLine(100, double.NegativeInfinity, true, 10, 8), 1e-12);
            // Тэмдэглэгээ ирмэгээс 30 цухуйсан: түүнээс «гинж хооронд» цааш.
            Assert.Near(-38, RfSetMraPlanner.OverallLine(0, -30, false, 10, 8), 1e-12);
            Assert.Near(138, RfSetMraPlanner.OverallLine(100, 130, true, 10, 8), 1e-12);
            // Бага цухуйсан (≤ эхний гинж − гинж хооронд): ирмэгээс «эхний гинж» хэвээр.
            Assert.Near(-10, RfSetMraPlanner.OverallLine(0, -1, false, 10, 8), 1e-12);
            // Тэмдэглэгээ хостын дотор (цухуйгаагүй) — нөлөөгүй.
            Assert.Near(-10, RfSetMraPlanner.OverallLine(0, 5, false, 10, 8), 1e-12);
        }

        [Test]
        public static void Without_a_stirrup_chain_the_outer_chain_takes_the_first_row()
        {
            var aux = new List<RfAuxSample> { Grid(10, 0) };
            List<RfMemberChain> chains = RfMemberDims.Build(Beam300x500(), RfSectionFrame.Identity, aux, new List<RfDimChain>(), Opt(), null);
            RfMemberChain h = chains.Single(c => c.AlongU);
            Assert.Near(500 * Mm, h.LinePos, 1e-9);
            // Босоо тэнхлэгт хөрш алга, хомутын гинж алга → гишүүний өндөр (нүүр–нүүр) ганцаараа ч хэрэгтэй.
            RfMemberChain v = chains.Single(c => !c.AlongU);
            Assert.Eq(2, v.Refs.Count);
        }

        [Test]
        public static void With_a_stirrup_chain_a_bare_face_to_face_chain_is_not_repeated()
        {
            List<RfMemberChain> chains = RfMemberDims.Build(Beam300x500(), RfSectionFrame.Identity, new List<RfAuxSample>(), StirrupChains(true, true), Opt(), null);
            Assert.Eq(0, chains.Count, "хомутын гинжний нийлбэр аль хэдийн нүүр–нүүр — давхардуулахгүй");
        }

        [Test]
        public static void Far_grids_are_left_out_and_a_grid_on_a_face_keeps_the_face_reference()
        {
            var aux = new List<RfAuxSample> { Grid(10, 150), Grid(11, 1300), Grid(12, -900) };
            RfMemberChain h = RfMemberDims.Build(Beam300x500(), RfSectionFrame.Identity, aux, new List<RfDimChain>(), Opt(), null).Single(c => c.AlongU);
            Assert.SeqEq(new[] { -900.0, -150.0, 150.0 }, h.Positions().Select(p => Math.Round(p / Mm, 3)), "1300 нь 1 м-ээс хол; 150 нь нүүртэй давхцсан");
            Assert.Eq(RfMemberRefKind.HostFace, h.Refs[2].Kind);
        }

        [Test]
        public static void Wall_faces_under_the_beam_join_the_horizontal_chain_and_skew_lines_are_ignored()
        {
            var aux = new List<RfAuxSample>
            {
                new RfAuxSample { Id = 20, Kind = RfAuxKind.Wall, Origin = new RfV2(-100 * Mm, -900 * Mm), Normal = new RfV2(-1, 0) },
                new RfAuxSample { Id = 21, Kind = RfAuxKind.Wall, Origin = new RfV2(100 * Mm, -900 * Mm), Normal = new RfV2(1, 0) },
                new RfAuxSample { Id = 22, Kind = RfAuxKind.Grid, Origin = new RfV2(0, 0), Normal = new RfV2(0.7071, 0.7071) },
            };
            RfMemberChain h = RfMemberDims.Build(Beam300x500(), RfSectionFrame.Identity, aux, StirrupChains(true, false), Opt(), null).Single(c => c.AlongU);
            Assert.SeqEq(new[] { -150.0, -100.0, 100.0, 150.0 }, h.Positions().Select(p => Math.Round(p / Mm, 3)));
            Assert.Eq(2, h.Neighbors);
            Assert.Eq(0, h.Grids, "налуу шугам орохгүй");
        }

        [Test]
        public static void Ambiguous_side_skips_that_axis_with_a_warning()
        {
            RfSectionRect r = Beam300x500();
            r.AmbiguousTop = true;
            var warnings = new List<RfSectionWarning>();
            List<RfMemberChain> chains = RfMemberDims.Build(r, RfSectionFrame.Identity, new List<RfAuxSample> { Grid(1, 0), SlabFace(2, -170) }, new List<RfDimChain>(), Opt(), warnings);
            Assert.False(chains.Any(c => !c.AlongU), "босоо тэнхлэг алгасагдана");
            Assert.True(chains.Any(c => c.AlongU));
            Assert.True(warnings.Any(w => w.Code == RfSectionWarn.HostFaceAmbiguous));
        }

        [Test]
        public static void Rotated_member_frame_measures_along_its_own_axes()
        {
            // 30° эргэсэн багана (план): тэнхлэг нь мөн 30° — локал U-д перпендикуляр.
            double a = 30 * Math.PI / 180;
            var frame = new RfSectionFrame(new RfV2(Math.Cos(a), Math.Sin(a)), new RfV2(-Math.Sin(a), Math.Cos(a)));
            var aux = new List<RfAuxSample> { new RfAuxSample { Id = 1, Kind = RfAuxKind.Grid, Origin = new RfV2(0, 0), Normal = frame.U } };
            RfSectionRect r = Beam300x500();
            RfMemberChain h = RfMemberDims.Build(r, frame, aux, StirrupChains(true, false), Opt(), null).Single(c => c.AlongU);
            Assert.Eq(3, h.Refs.Count);
            Assert.Near(0, h.Refs[1].Pos, 1e-9);
        }

        [Test]
        public static void Planner_pushes_top_and_right_tags_beyond_the_outer_chain()
        {
            // Тэгш өнцөгт 300×500 нүүр + тэнхлэг + хучилт → гадна гинж; дээд талын шошгоны толгой хамгийн гадна шугамаас цааш.
            var input = new RfSectionInput { View = new RfViewFrame(new RfV3(0, 0, 0), new RfV3(1, 0, 0), new RfV3(0, 0, 1), new RfV3(0, -1, 0)) };
            input.Faces.Add(new RfFaceSample { Id = 1, Origin = new RfV2(-150 * Mm, -250 * Mm), Normal = new RfV2(-1, 0), Area = 1 });
            input.Faces.Add(new RfFaceSample { Id = 2, Origin = new RfV2(150 * Mm, -250 * Mm), Normal = new RfV2(1, 0), Area = 1 });
            input.Faces.Add(new RfFaceSample { Id = 3, Origin = new RfV2(0, -500 * Mm), Normal = new RfV2(0, -1), Area = 0.5 });
            input.Faces.Add(new RfFaceSample { Id = 4, Origin = new RfV2(0, 0), Normal = new RfV2(0, 1), Area = 0.5 });
            input.Aux.Add(Grid(10, 0));
            input.Aux.Add(SlabFace(11, -170));
            input.Longitudinal.Add(new RfLongBar { Id = 7, BarIndex = 0, Pos = new RfV2(0, -40 * Mm), Diameter = 22 * Mm });
            RfSectionOptions o = Opt();
            o.DoDimensions = false;
            o.TagStirrups = false;
            o.TagOutFt = 100 * Mm;
            o.TagGapFt = 50 * Mm;
            o.TagWidthFt = 300 * Mm;
            o.TagHeightFt = 120 * Mm;
            input.Options = o;
            RfSectionPlan plan = RfSectionPlanner.Build(input);
            Assert.Eq(2, plan.MemberChains.Count);
            Assert.True(plan.HasContent);
            double topLine = plan.MemberChains.Single(c => c.AlongU).LinePos;
            foreach (RfTagPlan t in plan.Tags.Where(t => t.Side == RfSide.Top))
                Assert.True(t.Head.Y - t.LocalHeight / 2 >= topLine + o.TagGapFt - 1e-9, "дээд шошго гадна гинжнээс цааш");
        }

        // ══ 2. Дэлгээс: үргэлжилсэн хэмжээс ══════════════════════════════

        private static RfElevInput Beam()
        {
            var i = new RfElevInput { BeamU0 = 0, BeamU1 = 18000 * Mm, BeamV0 = 0, BeamV1 = 500 * Mm };
            i.Options.TagOffsetFt = 100 * Mm;
            i.Options.TagGapFt = 40 * Mm;
            i.Options.DimPitchFt = 150 * Mm;
            i.Options.DefaultTagWidthFt = 300 * Mm;
            i.Options.DefaultTagHeightFt = 120 * Mm;
            i.Options.TagBars = false;
            i.Options.StirrupMra = false;
            i.Options.SpanDims = false;
            return i;
        }

        private static RfElevBar Bar(long id, double u0Mm, double u1Mm, double vMm, double dia = 22)
        {
            return new RfElevBar { Id = id, Diameter = dia * Mm, U0 = u0Mm * Mm, U1 = u1Mm * Mm, AnchorV = vMm * Mm, MeanV = vMm * Mm, Straight = true, HasEndRefs = true };
        }

        [Test]
        public static void Lap_chain_runs_through_every_bar_end_of_the_lapped_row()
        {
            RfElevInput i = Beam();
            i.Options.LapChain = true;
            i.Bars.Add(Bar(1, 0, 6000, 40));
            i.Bars.Add(Bar(2, 5500, 12000, 40));
            i.Bars.Add(Bar(3, 11400, 18000, 40));
            RfElevPlan p = RfElevPlanner.Build(i, null);
            Assert.Eq(2, p.Laps.Count, "«500», «600» хэвээр");
            RfElevLapChainPlan c = p.LapChains.Single();
            Assert.SeqEq(new[] { 0.0, 5500.0, 6000.0, 11400.0, 12000.0, 18000.0 }, c.U.Select(u => Math.Round(u / Mm, 3)));
            Assert.SeqEq(new[] { true, true, false, true, false, false }, c.IsLeft);
            Assert.SeqEq(new long[] { 1, 2, 1, 3, 2, 3 }, c.Bar);
            Assert.Eq(RfElevSide.Bottom, c.Side);
            Assert.True(c.LineV < p.Laps[0].LineV - 1e-9, "давхцлын эгнээнээс гадагш");
            Assert.Near(p.Laps[0].LineV - 150 * Mm, c.LineV, 1e-9);
        }

        [Test]
        public static void Lap_chain_is_optional_and_independent_of_the_lap_dimension()
        {
            RfElevInput off = Beam();
            off.Bars.Add(Bar(1, 0, 6000, 40));
            off.Bars.Add(Bar(2, 5500, 12000, 40));
            Assert.Eq(0, RfElevPlanner.Build(off, null).LapChains.Count, "чагтгүй бол үгүй");

            RfElevInput only = Beam();
            only.Options.LapDims = false;
            only.Options.LapChain = true;
            only.Bars.Add(Bar(1, 0, 6000, 40));
            only.Bars.Add(Bar(2, 5500, 12000, 40));
            RfElevPlan p = RfElevPlanner.Build(only, null);
            Assert.Eq(0, p.Laps.Count, "давхцлын «500» унтраалттай");
            Assert.Eq(1, p.LapChains.Count);
            Assert.Near(0 - 100 * Mm - 150 * Mm, p.LapChains[0].LineV, 1e-9, "шошгогүй: эхний эгнээ");
        }

        [Test]
        public static void Unlapped_bars_get_no_chain_and_two_overlapping_rows_stack()
        {
            RfElevInput i = Beam();
            i.Options.LapChain = true;
            i.Bars.Add(Bar(1, 0, 6000, 40));           // ганц (давхцалгүй)
            i.Bars.Add(Bar(5, 0, 6000, 460));          // дээд, давхцалгүй
            i.Bars.Add(Bar(2, 0, 6000, 150));          // 2-р давхарга: доод (40-өөс 110 мм — өөр эгнээ)
            i.Bars.Add(Bar(3, 5500, 12000, 150));
            i.Bars.Add(Bar(4, 5600, 12000, 40));
            RfElevPlan p = RfElevPlanner.Build(i, null);
            Assert.True(p.LapChains.All(c => c.Side == RfElevSide.Bottom));
            Assert.Eq(2, p.LapChains.Count, "доод хоёр эгнээ (150 ба 40) тусдаа");
            Assert.Eq(2, p.LapChains.Select(c => c.Row).Distinct().Count(), "u-муж давхцсан тул өөр мөр");
            Assert.True(Math.Abs(p.LapChains[0].LineV - p.LapChains[1].LineV) >= 150 * Mm - 1e-9);
        }

        [Test]
        public static void Mra_pinned_beyond_all_rows_stays_after_them_without_a_warning()
        {
            RfElevInput i = Beam();
            i.Options.TagBars = true;
            i.Options.StirrupMra = true;
            i.Options.StirrupDimOffsetFt = 900 * Mm;
            i.Bars.Add(Bar(1, 0, 6000, 40));
            i.Stirrups.Add(new RfElevStirrup { Id = 9, U0 = 100 * Mm, U1 = 5900 * Mm, Count = 20 });
            RfElevPlan p = RfElevPlanner.Build(i, null);
            Assert.False(p.MraFirst);
            Assert.Near(-900 * Mm, p.Mras[0].LineV, 1e-9);
            Assert.Near(-100 * Mm, p.Tags.Single().Head.Y, 1e-9, "шошго хэрэглэгчийн зайд хэвээр");
            Assert.False(p.Warnings.Any(w => w.Code == RfElevWarn.StirrupOffsetOverlap));
        }

        [Test]
        public static void Mra_first_also_pushes_laps_and_the_lap_chain_outside_the_mra()
        {
            RfElevInput i = Beam();
            i.Options.StirrupMra = true;
            i.Options.LapChain = true;
            i.Options.StirrupDimOffsetFt = 50 * Mm;
            i.Bars.Add(Bar(1, 0, 6000, 40));
            i.Bars.Add(Bar(2, 5500, 12000, 40));
            i.Stirrups.Add(new RfElevStirrup { Id = 9, U0 = 100 * Mm, U1 = 11900 * Mm, Count = 40 });
            RfElevPlan p = RfElevPlanner.Build(i, null);
            Assert.True(p.MraFirst);
            Assert.Near(-50 * Mm, p.Mras[0].LineV, 1e-9);
            double mraBottom = p.Mras[0].Head.Y - 60 * Mm;
            Assert.True(p.Laps[0].LineV < mraBottom - 1e-9, "давхцал MRA-ийн гадна");
            Assert.True(p.LapChains[0].LineV < p.Laps[0].LineV - 1e-9, "үргэлжилсэн нь давхцлаас гадна");
        }

        // ══ 3. Хана/хучилт: шошго, үргэлжилсэн хэмжээс ══════════════════

        /// <summary>X-ийн дагуу [x0, x1] урттай 6 ширхэг, y = y0 … y0+1000 (200 алхам); гүн = depth.</summary>
        private static RfSetSample Set(long id, double x0, double x1, double y0, double depthMm = 0, double dia = 12)
        {
            var s = new RfSetSample { Id = id, Diameter = dia * Mm, Depth = depthMm * Mm };
            for (int k = 0; k < 6; k++)
            {
                double y = y0 + k * 200;
                s.Points.Add(new RfV2(x0 * Mm, y * Mm));
                s.Points.Add(new RfV2(x1 * Mm, y * Mm));
                s.Centres.Add(new RfV2((x0 + x1) / 2 * Mm, y * Mm));
                s.BarIndices.Add(k);
            }
            return s;
        }

        private static RfSetMraOptions SetOpt()
        {
            return new RfSetMraOptions
            {
                OffsetFt = 100 * Mm, TagGapFt = 40 * Mm, TagWidthFt = 300 * Mm, TagHeightFt = 120 * Mm,
                ChainOffsetFt = 100 * Mm, LapChain = true,
            };
        }

        [Test]
        public static void Lapped_slab_sets_get_one_chain_along_the_bars_beside_the_set()
        {
            RfSetMraResult r = RfSetMraPlanner.Build(new[] { Set(1, 0, 6000, 0), Set(2, 5400, 12000, 100) }, SetOpt());
            RfSetLapChainPlan c = r.LapChains.Single();
            Assert.SeqEq(new[] { 0.0, 5400.0, 6000.0, 12000.0 }, c.Pos.Select(p => Math.Round(p / Mm, 3)), "6000 | 600 (давхцал) | 6000");
            Assert.Near(1, Math.Abs(c.Dir.X), 1e-9, "ширхгийн чиглэлд");
            // Шугам тархалтын доод захаас (y = 0) 100 мм гадагш — y = −100.
            Assert.Near(-100 * Mm, (c.LineOrigin + c.Dir * c.Pos[0]).Y, 1e-9);
            Assert.SeqEq(new long[] { 1, 2, 1, 2 }, c.SetId);
        }

        [Test]
        public static void Different_layers_or_separate_regions_are_not_laps()
        {
            Assert.Eq(0, RfSetMraPlanner.Build(new[] { Set(1, 0, 6000, 0, 0), Set(2, 5400, 12000, 0, 150) }, SetOpt()).LapChains.Count, "өөр давхарга (дээд/доод тор)");
            Assert.Eq(0, RfSetMraPlanner.Build(new[] { Set(1, 0, 6000, 0), Set(2, 5400, 12000, 5000) }, SetOpt()).LapChains.Count, "тархалт давхцаагүй");
            Assert.Eq(0, RfSetMraPlanner.Build(new[] { Set(1, 0, 6000, 0), Set(2, 6000, 12000, 0) }, SetOpt()).LapChains.Count, "төгсгөл төгсгөлөөрөө (давхцалгүй)");
            RfSetMraOptions o = SetOpt();
            o.LapChain = false;
            Assert.Eq(0, RfSetMraPlanner.Build(new[] { Set(1, 0, 6000, 0), Set(2, 5400, 12000, 100) }, o).LapChains.Count, "чагтгүй");
        }

        [Test]
        public static void Mra_and_tag_are_separate_choices_and_the_tag_goes_opposite_the_mra()
        {
            RfSetMraOptions both = SetOpt();
            both.Tags = true;
            RfSetMraResult r = RfSetMraPlanner.Build(new[] { Set(1, 0, 4000, 0) }, both);
            Assert.Eq(1, r.Plans.Count);
            Assert.Eq(1, r.Tags.Count);
            RfSetMraPlan m = r.Plans[0];
            RfSetTagPlan t = r.Tags[0];
            Assert.True((t.Head - m.LineOrigin).Dot(m.Outward) < 0, "шошго MRA-ийн эсрэг талд");
            Assert.True(t.Target.X > 0 && t.Target.X < 4000 * Mm, "leader ширхэг дээр");

            RfSetMraOptions tagOnly = SetOpt();
            tagOnly.Mra = false;
            tagOnly.Tags = true;
            RfSetMraResult r2 = RfSetMraPlanner.Build(new[] { Set(1, 0, 4000, 0) }, tagOnly);
            Assert.Eq(0, r2.Plans.Count, "MRA унтраалттай");
            Assert.Eq(1, r2.Tags.Count);
            Assert.True(r2.Tags[0].Head.X > 4000 * Mm, "MRA-гүй бол шошго MRA-ийн өгөгдмөл талд (+)");
        }
    }
}
