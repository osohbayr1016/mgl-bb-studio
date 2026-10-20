using System;
using System.Collections.Generic;
using System.Linq;
using RevitMcpAddin.Reinforcement.Core;

namespace RevitMcpAddin.Reinforcement.Tests
{
    /// <summary>
    /// 2026-10-05 «Хэмжээс, тэмдэглэгээ»-ний нэгтгэл: (1) арматурын олонлог бүрд ЯГ НЭГ tag, (2) баганын дэлгээс — хост-тэнхлэгийн frame (дам нуруу хэвтээ,
    /// багана босоо), (3) хомутын хэмжээсийн зай, (4) цаасан мм → фут нэгжийн нэг хөрвүүлэлт.  Бүгд Revit-гүй.
    /// </summary>
    public static class ColumnAndSetTests
    {
        private const double Mm = 1.0 / 304.8;

        // ══ 1. Арматурын олонлог (Rebar set) бүрд нэг tag ═════════════════════

        private static RfSectionInput Section300x500()
        {
            var input = new RfSectionInput { View = new RfViewFrame(new RfV3(0, 0, 0), new RfV3(1, 0, 0), new RfV3(0, 1, 0), new RfV3(0, 0, 1)) };
            double w = 300 * Mm, h = 500 * Mm, len = 3000 * Mm;
            input.Faces.Add(new RfFaceSample { Id = 1, Origin = new RfV2(-w / 2, 0), Normal = new RfV2(-1, 0), Area = h * len });
            input.Faces.Add(new RfFaceSample { Id = 2, Origin = new RfV2(w / 2, 0), Normal = new RfV2(1, 0), Area = h * len });
            input.Faces.Add(new RfFaceSample { Id = 3, Origin = new RfV2(0, -h / 2), Normal = new RfV2(0, -1), Area = w * len });
            input.Faces.Add(new RfFaceSample { Id = 4, Origin = new RfV2(0, h / 2), Normal = new RfV2(0, 1), Area = w * len });
            input.Options.DoDimensions = false;
            input.Options.TagStirrups = false;
            input.Options.TagLongitudinal = true;
            input.Options.GroupTags = true;
            return input;
        }

        private static RfLongBar Bar(long id, int idx, double xMm, double yMm, string group)
        {
            return new RfLongBar { Id = id, BarIndex = idx, Pos = new RfV2(xMm * Mm, yMm * Mm), Diameter = 16 * Mm, Group = group };
        }

        /// <summary>Доод эгнээнд тархсан НЭГ олонлог: захын ширхгүүд (x = ±140, y = −210) гишүүний Зүүн/Баруун нүүрт Доод нүүрээс ойр.</summary>
        private static void AddBottomRowSet(RfSectionInput input, long id, string group)
        {
            input.Longitudinal.Add(Bar(id, 0, -140, -210, group));
            input.Longitudinal.Add(Bar(id, 1, -47, -210, group));
            input.Longitudinal.Add(Bar(id, 2, 47, -210, group));
            input.Longitudinal.Add(Bar(id, 3, 140, -210, group));
        }

        [Test]
        public static void Without_single_tag_a_numbered_set_spread_along_the_member_splits_into_several_tags()
        {
            // Хуучин зан төлөв (өөрчлөхгүй): ширхэг бүрийн ОЙР талаар бүлэглэнэ → захын ширхгүүд өөр бүлэгт орж ижил олонлог олон tag болно.
            RfSectionInput input = Section300x500();
            AddBottomRowSet(input, 10, "t|16|1|#1|p:");
            input.Options.SingleTagPerSet = false;
            RfSectionPlan plan = RfSectionPlanner.Build(input);
            Assert.True(plan.Tags.Count > 1, "хуучин зан төлөв: олонлог " + plan.Tags.Count + " tag");
        }

        [Test]
        public static void Single_tag_per_set_gives_exactly_one_tag_for_the_whole_set()
        {
            RfSectionInput input = Section300x500();
            AddBottomRowSet(input, 10, "t|16|1|#1|p:");
            input.Options.SingleTagPerSet = true;
            RfSectionPlan plan = RfSectionPlanner.Build(input);
            Assert.Eq(1, plan.Tags.Count, "олонлог = 1 tag");
            Assert.Eq(10L, plan.Tags[0].Id);
        }

        [Test]
        public static void Single_tag_per_set_keeps_two_different_sets_apart()
        {
            RfSectionInput input = Section300x500();
            AddBottomRowSet(input, 10, "t|16|1|#1|p:");
            input.Longitudinal.Add(Bar(20, 0, -140, 210, "t|20|1|#2|p:"));
            input.Longitudinal.Add(Bar(20, 1, 0, 210, "t|20|1|#2|p:"));
            input.Longitudinal.Add(Bar(20, 2, 140, 210, "t|20|1|#2|p:"));
            input.Options.SingleTagPerSet = true;
            RfSectionPlan plan = RfSectionPlanner.Build(input);
            Assert.Eq(2, plan.Tags.Count);
            Assert.SeqEq(new long[] { 10, 20 }, plan.Tags.Select(t => t.Id).OrderBy(x => x));
        }

        [Test]
        public static void Single_tag_per_set_single_bar_is_one_tag_and_is_idempotent()
        {
            RfSectionInput input = Section300x500();
            input.Longitudinal.Add(Bar(5, 0, 0, -210, "t|16|1|#1|p:"));
            input.Options.SingleTagPerSet = true;
            RfSectionPlan a = RfSectionPlanner.Build(input);
            RfSectionPlan b = RfSectionPlanner.Build(input);
            Assert.Eq(1, a.Tags.Count);
            Assert.Eq(a.Tags[0].Id, b.Tags[0].Id);
            Assert.Near(a.Tags[0].Head.X, b.Tags[0].Head.X, 1e-12, "хоёр удаа ижил байрлал");
        }

        [Test]
        public static void Single_tag_per_set_never_tags_individual_positions_when_grouping_is_off()
        {
            RfSectionInput input = Section300x500();
            input.Options.GroupTags = false;
            AddBottomRowSet(input, 10, "t|16|1|#1|p:");
            input.Options.SingleTagPerSet = true;
            Assert.Eq(1, RfSectionPlanner.Build(input).Tags.Count);
            input.Options.SingleTagPerSet = false;
            Assert.Eq(1, RfSectionPlanner.Build(input).Tags.Count, "элемент бүр өөрийн tag-тай — олонлог аль хэдийн нэг tag");
        }

        // ══ 2. Хост-тэнхлэгийн frame (дам нуруу хэвтээ / багана босоо) ═══════════

        private static RfViewFrame Elevation(double rotZDeg = 0, bool mirrored = false)
        {
            double a = rotZDeg * Math.PI / 180;
            RfV3 right = new RfV3(Math.Cos(a), Math.Sin(a), 0);
            if (mirrored) right = -right;
            RfV3 up = new RfV3(0, 0, 1);
            return new RfViewFrame(new RfV3(0, 0, 0), right, up, right.Cross(up));
        }

        [Test]
        public static void Beam_axis_along_view_right_keeps_the_view_frame()
        {
            RfViewFrame v = Elevation();
            RfViewFrame host;
            Assert.Eq(RfElevAxisKind.AlongRight, RfElevHostFrame.Resolve(v, new RfV3(1, 0, 0), 0.1, out host));
            Assert.Near(1, host.Right.X, 1e-12);
        }

        [Test]
        public static void Column_axis_is_vertical_in_the_view_and_becomes_u_in_the_host_frame()
        {
            RfViewFrame v = Elevation();
            RfViewFrame host;
            Assert.Eq(RfElevAxisKind.AlongUp, RfElevHostFrame.Resolve(v, new RfV3(0, 0, 1), 0.1, out host));
            // Колоннын өндөр (z) нь planner-ийн u болно; хажуу (view Right) нь −v.
            RfV2 p = host.ToView(new RfV3(2.5, 0, 7.0));
            Assert.Near(7.0, p.X, 1e-12, "u = өндөр");
            Assert.Near(-2.5, p.Y, 1e-12, "v = −Right");
            RfV3 back = host.ToModel(p);
            Assert.Near(7.0, back.Z, 1e-12);
            Assert.Near(2.5, back.X, 1e-12);
        }

        [Test]
        public static void Host_frame_works_for_rotated_and_mirrored_views_without_world_axes()
        {
            foreach (double rot in new[] { 0.0, 30.0, 135.0, -60.0 })
            {
                foreach (bool mirror in new[] { false, true })
                {
                    RfViewFrame v = Elevation(rot, mirror);
                    RfViewFrame host;
                    Assert.Eq(RfElevAxisKind.AlongUp, RfElevHostFrame.Resolve(v, new RfV3(0, 0, 1), 0.1, out host), "колонн rot=" + rot + " mirror=" + mirror);
                    RfV3 beamAxis = v.Right; // харагдацын «баруун»-д параллель хэвтээ дам нуруу
                    Assert.Eq(RfElevAxisKind.AlongRight, RfElevHostFrame.Resolve(v, beamAxis, 0.1, out host), "дам нуруу rot=" + rot + " mirror=" + mirror);
                }
            }
        }

        [Test]
        public static void Host_frame_rotation_keeps_the_handedness()
        {
            RfViewFrame v = Elevation(20, false);
            RfViewFrame host = RfElevHostFrame.Rotated(v);
            RfV3 n = host.Right.Cross(host.Up);
            Assert.Near(v.Normal.X, n.X, 1e-12);
            Assert.Near(v.Normal.Y, n.Y, 1e-12);
            Assert.Near(v.Normal.Z, n.Z, 1e-12);
        }

        [Test]
        public static void Section_slanted_and_out_of_plane_members_are_not_elevation_hosts()
        {
            RfViewFrame v = Elevation();
            RfViewFrame host;
            Assert.Eq(RfElevAxisKind.None, RfElevHostFrame.Resolve(v, v.Normal, 0.1, out host), "огтлол (тэнхлэг нормалиар)");
            Assert.Eq(RfElevAxisKind.None, RfElevHostFrame.Resolve(v, new RfV3(1, 0, 1), 0.1, out host), "налуу");
            Assert.Eq(RfElevAxisKind.None, RfElevHostFrame.Resolve(v, new RfV3(0, 0, 0), 0.1, out host), "хоосон тэнхлэг");
        }

        [Test]
        public static void Column_elevation_plans_exactly_like_a_beam_in_the_host_frame()
        {
            // Баганын дэлгээс = дам нууруунтай ИЖИЛ planner, зөвхөн frame эргэсэн: босоо арматур → u дагуу, хомут → u дагуу алхамтай.
            var input = new RfElevInput { BeamU0 = 0, BeamU1 = 3000 * Mm, BeamV0 = -200 * Mm, BeamV1 = 200 * Mm };
            input.Options.TagOffsetFt = 100 * Mm;
            input.Options.TagGapFt = 40 * Mm;
            input.Options.DimPitchFt = 150 * Mm;
            input.Options.DefaultTagWidthFt = 300 * Mm;
            input.Options.DefaultTagHeightFt = 120 * Mm;
            input.Bars.Add(new RfElevBar { Id = 1, Diameter = 20 * Mm, U0 = 0, U1 = 3000 * Mm, AnchorV = 150 * Mm, MeanV = 150 * Mm, Straight = true });
            input.Bars.Add(new RfElevBar { Id = 2, Diameter = 20 * Mm, U0 = 0, U1 = 3000 * Mm, AnchorV = -150 * Mm, MeanV = -150 * Mm, Straight = true });
            input.Stirrups.Add(new RfElevStirrup { Id = 9, U0 = 100 * Mm, U1 = 2900 * Mm, Count = 15 });
            RfElevPlan plan = RfElevPlanner.Build(input, null);
            Assert.Eq(2, plan.Tags.Count);
            Assert.Eq(1, plan.Mras.Count);
            Assert.True(plan.Tags.Any(t => t.Side == RfElevSide.Top && t.Head.Y > 200 * Mm), "дээд тал — хостоос гадуур");
            Assert.True(plan.Tags.Any(t => t.Side == RfElevSide.Bottom && t.Head.Y < -200 * Mm), "доод тал — хостоос гадуур");
        }

        // ══ 3. Хомутын хэмжээсийн зай ═════════════════════════════════════

        private static RfElevInput WithMra(double stirrupOffsetMm)
        {
            var i = new RfElevInput { BeamU0 = 0, BeamU1 = 6000 * Mm, BeamV0 = 0, BeamV1 = 500 * Mm };
            i.Options.TagOffsetFt = 100 * Mm;
            i.Options.TagGapFt = 40 * Mm;
            i.Options.DimPitchFt = 150 * Mm;
            i.Options.DefaultTagWidthFt = 300 * Mm;
            i.Options.DefaultTagHeightFt = 120 * Mm;
            i.Options.StirrupDimOffsetFt = stirrupOffsetMm * Mm;
            i.Options.TagBars = false;
            i.Options.LapDims = false;
            i.Options.SpanDims = false;
            i.Stirrups.Add(new RfElevStirrup { Id = 9, U0 = 100 * Mm, U1 = 5900 * Mm, Count = 20 });
            return i;
        }

        [Test]
        public static void Stirrup_dim_offset_puts_the_dimension_line_exactly_at_the_requested_distance_from_the_host_edge()
        {
            foreach (double off in new[] { 150.0, 400.0, 900.0 })
            {
                RfElevPlan plan = RfElevPlanner.Build(WithMra(off), null);
                Assert.Eq(1, plan.Mras.Count);
                Assert.Near(0 - off * Mm, plan.Mras[0].LineV, 1e-9, "шугам = доод ирмэг − " + off);
                Assert.True(plan.Mras[0].Head.Y < plan.Mras[0].LineV, "шошго шугамаас гадагш");
            }
        }

        [Test]
        public static void Stirrup_dim_offset_changes_the_geometry_when_the_value_changes()
        {
            double a = RfElevPlanner.Build(WithMra(200), null).Mras[0].LineV;
            double b = RfElevPlanner.Build(WithMra(450), null).Mras[0].LineV;
            Assert.Near(250 * Mm, a - b, 1e-9, "250 мм нэмэхэд шугам 250 мм холдоно");
        }

        [Test]
        public static void Stirrup_dim_offset_zero_keeps_the_automatic_stacking()
        {
            RfElevPlan auto = RfElevPlanner.Build(WithMra(0), null);
            Assert.Eq(1, auto.Mras.Count);
            // Хуучин дүрэм: эгнээний эхлэл = ирмэг − гишүүнээс шошго хүртэл (100); head = эхлэл − tagGap − h/2; line = head − h/2 − pitch.
            double head = 0 - 100 * Mm - 40 * Mm - 60 * Mm;
            double line = head - 60 * Mm - 150 * Mm;
            Assert.Near(head, auto.Mras[0].Head.Y, 1e-9);
            Assert.Near(line, auto.Mras[0].LineV, 1e-9);
        }

        [Test]
        public static void Stirrup_dim_offset_smaller_than_the_tag_stack_puts_the_mra_first_and_moves_the_tags_outside_it()
        {
            // 2026-10-08: өмнө нь анхааруулга л гаргаж MRA шошгон дээгүүр давхцдаг байв.  Одоо MRA яг заасан зайд (гишүүнд хамгийн ойр), шошго түүний гадна.
            var i = WithMra(30);
            i.Options.TagBars = true;
            i.Bars.Add(new RfElevBar { Id = 1, Diameter = 20 * Mm, U0 = 0, U1 = 6000 * Mm, AnchorV = 30 * Mm, MeanV = 30 * Mm, Straight = true });
            RfElevPlan plan = RfElevPlanner.Build(i, null);
            Assert.True(plan.MraFirst, "MRA гишүүнд хамгийн ойр эгнээ");
            Assert.Near(-30 * Mm, plan.Mras[0].LineV, 1e-9, "MRA-ийн шугам ЯГ хэрэглэгчийн зайд");
            double mraBottom = plan.Mras[0].Head.Y - 60 * Mm;
            RfElevTagPlan tag = plan.Tags.Single();
            Assert.Near(mraBottom - 40 * Mm, tag.Head.Y + 60 * Mm, 1e-9, "шошгоны эгнээ MRA-ийн доод захаас шошгоны зайгаар доош");
            Assert.False(plan.Warnings.Any(w => w.Code == RfElevWarn.StirrupOffsetOverlap), "давхцал үгүй тул анхааруулгагүй");
        }

        // ══ 4. Нэгж ═════════════════════════════════════════════════════

        [Test]
        public static void Paper_mm_to_model_feet_is_the_single_conversion()
        {
            Assert.Near(10.0 * 100 / 304.8, RfTol.PaperMmToModelFt(10, 100), 1e-12);
            Assert.Near(0, RfTol.PaperMmToModelFt(0, 50), 1e-12);
            Assert.Near(3.5 * 20 / 304.8, RfTol.PaperMmToModelFt(3.5, 20), 1e-12, "аравтын бутархай");
            Assert.Near(RfTol.PaperMmToModelFt(5, 100), RfTol.PaperMmToModelFt(5, 0), 1e-12, "масштаб ≤ 0 → 1:100");
        }
    }
}
