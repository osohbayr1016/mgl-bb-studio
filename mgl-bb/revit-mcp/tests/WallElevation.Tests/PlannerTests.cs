using System;
using System.Collections.Generic;
using System.Linq;
using RevitMcpAddin.WallElevation.Core;

namespace RevitMcpAddin.WallElevation.Tests
{
    public static class PlannerTests
    {
        private const double E = 1e-9;

        private static WeRequest OneWall(out WeWallInfo w, double lenMm = 4000, double heightMm = 3000)
        {
            w = Fx.Wall(Fx.P(0, 0), Fx.P(lenMm, 0), new WeV3(0, -1, 0), heightMm: heightMm, id: 42);
            var req = new WeRequest();
            req.Walls.Add(w);
            return req;
        }

        [Test]
        public static void Crop_is_tight_wall_extent_plus_padding_and_depth_covers_the_wall()
        {
            WeWallInfo w;
            WePlannedElevation p = Fx.Only(WallElevationPlanner.Plan(OneWall(out w), Fx.Ctx()));
            WeBox b = p.Box;
            // Урт 4000 + зузаан 200 (хоёр үзүүрт ½) + 2×300 хүрээ.
            Assert.True(Math.Abs(b.Width - Fx.Mm(4000 + 200 + 600)) < 1e-9, "өргөн " + b.Width);
            Assert.True(Math.Abs(b.MinY - Fx.Mm(-300)) < 1e-9 && Math.Abs(b.MaxY - Fx.Mm(3300)) < 1e-9, "босоо");
            // Тэнхлэгийн шугамаас: урд гадаргуу 100, зүсэх хавтгай +600 → −700; ар тал 100 + 300 → 400.
            Assert.True(Math.Abs(b.Near - Fx.Mm(-700)) < 1e-9, "near " + b.Near);
            Assert.True(Math.Abs(b.Far - Fx.Mm(400)) < 1e-9, "far " + b.Far);
            foreach (WeV3 pt in p.ProbePoints)
                Assert.True(b.ContainsLocal(p.Frame.ToLocal(pt), 1e-9), "шалгалтын цэг хайрцагт");
        }

        [Test]
        public static void Non_centerline_location_line_gets_the_conservative_depth()
        {
            WeWallInfo w;
            WeRequest req = OneWall(out w);
            w.LocationIsCenterline = false;
            WePlannedElevation p = Fx.Only(WallElevationPlanner.Plan(req, Fx.Ctx()));
            Assert.True(Math.Abs(p.Box.Near - Fx.Mm(-800)) < 1e-9, "гадаргуу 200 хүртэл урд байж болно");
            Assert.True(Math.Abs(p.Box.Far - Fx.Mm(500)) < 1e-9);
        }

        [Test]
        public static void Room_crop_uses_room_height_and_face_length()
        {
            // Тогтмол гүний горим (өрөөний дунд хүртэлх горимыг SideTests шалгана).
            WePlan plan = WallElevationPlanner.Plan(Fx.SquareRoom(5000, 4000), Fx.Ctx(s => { s.PaddingMm = 100; s.DepthMode = WeDepthMode.Fixed; }));
            WePlannedElevation south = plan.Items.Single(i => i.Frame.Look.AlmostEquals(new WeV3(0, -1, 0), E));
            Assert.True(Math.Abs(south.Box.Width - Fx.Mm(5200)) < 1e-9);
            Assert.True(Math.Abs(south.Box.Height - Fx.Mm(3000)) < 1e-9, "2800 + 2×100");
            Assert.True(Math.Abs(south.Box.Near - Fx.Mm(-600)) < 1e-9, "гадаргуу = өрөөний хил");
            Assert.True(Math.Abs(south.Box.Far - Fx.Mm(500)) < 1e-9, "зузаан 200 + 300");
        }

        [Test]
        public static void Unit_conversion_goes_through_the_supplied_converter()
        {
            Assert.True(Math.Abs(Fx.Units.MmToInternal(304.8) - 1) < 1e-12);
            Assert.True(Math.Abs(Fx.Units.InternalToMeters(1) - 0.3048) < 1e-12);

            // Хоёр дахин том «нэгж» → хүрээний зай ч хоёр дахин (цөм өөрөө 304.8 бичихгүй гэдгийг батална).
            WeWallInfo w;
            WeRequest req = OneWall(out w);
            WePlanContext ctx = Fx.Ctx(s => { s.PaddingMm = 300; });
            WePlannedElevation a = Fx.Only(WallElevationPlanner.Plan(req, ctx));
            ctx.Units = new DoubleUnits();
            WePlannedElevation b = Fx.Only(WallElevationPlanner.Plan(req, ctx));
            double padA = a.Box.MaxX - Fx.Mm(2100);
            double padB = b.Box.MaxX - Fx.Mm(2100);
            Assert.True(Math.Abs(padB - 2 * padA) < 1e-9, padA + " / " + padB);
        }

        private sealed class DoubleUnits : IWeUnits
        {
            public double MmToInternal(double mm) { return 2 * mm / 304.8; }
            public double InternalToMeters(double ft) { return ft * 0.3048; }
        }

        [Test]
        public static void Wall_mode_both_sides_creates_two_elevations_with_A_and_B()
        {
            WeWallInfo w;
            WePlan plan = WallElevationPlanner.Plan(OneWall(out w), Fx.Ctx(s => s.WallSide = WeWallSidePick.Both));
            Assert.Eq(2, plan.Items.Count);
            WePlannedElevation ext = plan.Items.Single(i => i.Side == WeSide.Exterior);
            WePlannedElevation inn = plan.Items.Single(i => i.Side == WeSide.Interior);
            Assert.Eq("ДЭЛГЭЭС-W42A (L01)", ext.Name);
            Assert.Eq("ДЭЛГЭЭС-W42B (L01)", inn.Name);
            Assert.True(ext.Frame.Look.AlmostEquals(-inn.Frame.Look, E), "эсрэг талаас");
            Assert.False(ext.Key == inn.Key);
        }

        [Test]
        public static void Selecting_the_same_wall_twice_creates_one_elevation()
        {
            WeWallInfo w;
            WeRequest req = OneWall(out w);
            req.Walls.Add(w);
            WePlan plan = WallElevationPlanner.Plan(req, Fx.Ctx());
            Assert.Eq(1, plan.Items.Count);
            Assert.True(plan.Notes.Any(n => n.Contains("давхар")));
        }

        [Test]
        public static void Rerun_unchanged_keeps_every_view_and_creates_nothing()
        {
            WeRequest req = Fx.SquareRoom(5000, 4000);
            WePlan first = WallElevationPlanner.Plan(req, Fx.Ctx());
            Assert.Eq(4, first.Count(WeAction.Create));

            req.Existing = Fx.AsExisting(first);
            foreach (WeExistingView e in req.Existing) req.ExistingViewNames.Add(e.Name);
            WePlan second = WallElevationPlanner.Plan(req, Fx.Ctx());
            Assert.Eq(0, second.Count(WeAction.Create), "давхардал үүсэхгүй");
            Assert.Eq(4, second.Count(WeAction.Keep));
            Assert.False(second.HasWork);
            Assert.SeqEq(first.Items.Select(i => i.Name), second.Items.Select(i => i.Name));
        }

        [Test]
        public static void Changed_wall_length_or_height_updates_in_place()
        {
            WeWallInfo w;
            WeRequest req = OneWall(out w);
            WePlan first = WallElevationPlanner.Plan(req, Fx.Ctx());
            req.Existing = Fx.AsExisting(first);
            req.ExistingViewNames.Add(first.Items[0].Name);

            w.End = Fx.P(5500, 0);
            WePlannedElevation longer = Fx.Only(WallElevationPlanner.Plan(req, Fx.Ctx()));
            Assert.Eq(WeAction.Update, longer.Action);
            Assert.Eq(req.Existing[0].ViewId, longer.ExistingViewId);
            Assert.Eq(first.Items[0].Name, longer.Name, "нэр хэвээр");

            w.End = Fx.P(4000, 0);
            w.TopZ = Fx.Mm(3600);
            WePlannedElevation taller = Fx.Only(WallElevationPlanner.Plan(req, Fx.Ctx()));
            Assert.Eq(WeAction.Update, taller.Action);
        }

        [Test]
        public static void Update_switch_off_reports_change_but_keeps_the_view()
        {
            WeWallInfo w;
            WeRequest req = OneWall(out w);
            req.Existing = Fx.AsExisting(WallElevationPlanner.Plan(req, Fx.Ctx()));
            w.End = Fx.P(4500, 0);
            WePlannedElevation p = Fx.Only(WallElevationPlanner.Plan(req, Fx.Ctx(s => s.UpdateExisting = false)));
            Assert.Eq(WeAction.Keep, p.Action);
            Assert.True(p.ActionNote.Contains("унтраалттай"));
        }

        [Test]
        public static void Settings_change_like_scale_marks_views_for_update()
        {
            WeWallInfo w;
            WeRequest req = OneWall(out w);
            req.Existing = Fx.AsExisting(WallElevationPlanner.Plan(req, Fx.Ctx()));
            WePlannedElevation p = Fx.Only(WallElevationPlanner.Plan(req, Fx.Ctx(s => s.Scale = 20)));
            Assert.Eq(WeAction.Update, p.Action);
        }

        [Test]
        public static void Missing_source_is_reported_as_orphan_and_never_deleted()
        {
            WeWallInfo w;
            WeRequest req = OneWall(out w);
            req.Existing = Fx.AsExisting(WallElevationPlanner.Plan(req, Fx.Ctx()));
            req.Existing[0].SourceWallExists = false;
            req.Walls.Clear();
            WePlan plan = WallElevationPlanner.Plan(req, Fx.Ctx());
            Assert.Eq(0, plan.Items.Count);
            Assert.Eq(1, plan.Orphans.Count);
            Assert.True(plan.Orphans[0].Reason.Contains("устгаагүй"));
        }

        [Test]
        public static void Wall_no_longer_bounding_the_selected_room_is_an_orphan()
        {
            WeRequest req = Fx.SquareRoom(5000, 4000);
            req.Existing = Fx.AsExisting(WallElevationPlanner.Plan(req, Fx.Ctx()));
            req.Rooms[0].Loops[0].Segments.RemoveAt(0);           // урд хана хилээс гарсан
            WePlan plan = WallElevationPlanner.Plan(req, Fx.Ctx());
            Assert.Eq(3, plan.Items.Count);
            Assert.Eq(1, plan.Orphans.Count);
        }

        [Test]
        public static void Two_views_with_one_key_are_flagged_and_left_alone()
        {
            WeWallInfo w;
            WeRequest req = OneWall(out w);
            List<WeExistingView> ex = Fx.AsExisting(WallElevationPlanner.Plan(req, Fx.Ctx()));
            WeExistingView copy = new WeExistingView
            {
                ViewId = ex[0].ViewId + 1, Key = ex[0].Key, Signature = ex[0].Signature, Name = ex[0].Name + " Copy 1",
                GeneratedName = ex[0].Name, WallUid = ex[0].WallUid, GeneratorVersion = 1, SourceWallExists = true, SourceRoomExists = true,
            };
            ex.Add(copy);
            req.Existing = ex;
            WePlannedElevation p = Fx.Only(WallElevationPlanner.Plan(req, Fx.Ctx()));
            Assert.Eq(WeStatus.RequiresReview, p.Status);
            Assert.Eq(WeAction.Skip, p.Action);
        }

        [Test]
        public static void User_renamed_view_is_not_renamed_back()
        {
            WeWallInfo w;
            WeRequest req = OneWall(out w);
            req.Existing = Fx.AsExisting(WallElevationPlanner.Plan(req, Fx.Ctx()));
            req.Existing[0].Name = "Миний нэр";
            WePlannedElevation p = Fx.Only(WallElevationPlanner.Plan(req, Fx.Ctx(s => s.NamePattern = "X-{Room}-{Side}")));
            Assert.Eq("Миний нэр", p.Name);
            Assert.False(p.Rename);
            Assert.Eq(WeAction.Keep, p.Action);
        }

        [Test]
        public static void Generated_name_follows_a_changed_pattern()
        {
            WeWallInfo w;
            WeRequest req = OneWall(out w);
            req.Existing = Fx.AsExisting(WallElevationPlanner.Plan(req, Fx.Ctx()));
            WePlannedElevation p = Fx.Only(WallElevationPlanner.Plan(req, Fx.Ctx(s => s.NamePattern = "X-{Room}-{Side}")));
            Assert.Eq("X-W42-A", p.Name);
            Assert.True(p.Rename);
            Assert.Eq(WeAction.Update, p.Action);
        }

        [Test]
        public static void New_name_never_collides_with_an_existing_view()
        {
            WeWallInfo w;
            WeRequest req = OneWall(out w);
            req.ExistingViewNames.Add("ДЭЛГЭЭС-W42A (L01)");
            WePlannedElevation p = Fx.Only(WallElevationPlanner.Plan(req, Fx.Ctx()));
            Assert.Eq("ДЭЛГЭЭС-W42A (L01) (2)", p.Name);
        }

        [Test]
        public static void Curved_wall_is_unsupported_and_not_created()
        {
            WeWallInfo w;
            WeRequest req = OneWall(out w);
            w.IsCurved = true;
            WePlannedElevation p = Fx.Only(WallElevationPlanner.Plan(req, Fx.Ctx()));
            Assert.Eq(WeStatus.Unsupported, p.Status);
            Assert.Eq(WeAction.Skip, p.Action);
            Assert.True(p.Message.Contains("Муруй"));
        }

        [Test]
        public static void Curved_room_boundary_is_unsupported()
        {
            WeRequest req = Fx.SquareRoom(5000, 4000);
            req.Rooms[0].Loops[0].Segments[2].IsStraight = false;
            WePlan plan = WallElevationPlanner.Plan(req, Fx.Ctx());
            Assert.Eq(1, plan.Count(WeStatus.Unsupported));
            Assert.Eq(3, plan.Count(WeAction.Create));
        }

        [Test]
        public static void Slanted_wall_requires_review_and_curtain_or_stacked_warn()
        {
            WeWallInfo w;
            WeRequest req = OneWall(out w);
            w.IsSlanted = true;
            Assert.Eq(WeStatus.RequiresReview, Fx.Only(WallElevationPlanner.Plan(req, Fx.Ctx())).Status);

            w.IsSlanted = false;
            w.Kind = WeWallKind.Curtain;
            w.Width = 0;
            WePlannedElevation c = Fx.Only(WallElevationPlanner.Plan(req, Fx.Ctx()));
            Assert.Eq(WeStatus.Warning, c.Status);
            Assert.Eq(WeAction.Create, c.Action, "хөшиг хана үүснэ (анхааруулгатай)");
            Assert.True(c.Box.Depth > 0);

            w.Kind = WeWallKind.Stacked;
            w.Width = Fx.Mm(300);
            Assert.Eq(WeStatus.Warning, Fx.Only(WallElevationPlanner.Plan(req, Fx.Ctx())).Status);
        }

        [Test]
        public static void Invalid_walls_are_unsupported_not_guessed()
        {
            WeWallInfo w;
            WeRequest req = OneWall(out w);
            w.HasLocationLine = false;
            Assert.Eq(WeStatus.Unsupported, Fx.Only(WallElevationPlanner.Plan(req, Fx.Ctx())).Status);
            w.HasLocationLine = true;
            w.End = w.Start;
            Assert.Eq(WeStatus.Unsupported, Fx.Only(WallElevationPlanner.Plan(req, Fx.Ctx())).Status);
            w.End = Fx.P(4000, 0);
            w.TopZ = w.BottomZ;
            Assert.Eq(WeStatus.Unsupported, Fx.Only(WallElevationPlanner.Plan(req, Fx.Ctx())).Status);
        }

        [Test]
        public static void Unplaced_or_open_room_is_reported()
        {
            WeRequest req = Fx.SquareRoom(5000, 4000);
            req.Rooms[0].IsEnclosed = false;
            WePlannedElevation p = Fx.Only(WallElevationPlanner.Plan(req, Fx.Ctx()));
            Assert.Eq(WeStatus.Unsupported, p.Status);
        }

        [Test]
        public static void Workshared_view_owned_by_another_user_is_not_touched()
        {
            WeWallInfo w;
            WeRequest req = OneWall(out w);
            req.Existing = Fx.AsExisting(WallElevationPlanner.Plan(req, Fx.Ctx()));
            req.Existing[0].OwnedByOtherUser = true;
            w.End = Fx.P(4500, 0);
            WePlannedElevation p = Fx.Only(WallElevationPlanner.Plan(req, Fx.Ctx()));
            Assert.Eq(WeAction.Skip, p.Action);
            Assert.Eq(WeStatus.RequiresReview, p.Status);
        }

        [Test]
        public static void Plan_is_deterministic()
        {
            WeRequest req = Fx.SquareRoom(5000, 4000);
            string a = string.Join("\n", WallElevationPlanner.Plan(req, Fx.Ctx()).Items.Select(i => i.Key + "|" + i.Name + "|" + i.Signature));
            string b = string.Join("\n", WallElevationPlanner.Plan(req, Fx.Ctx()).Items.Select(i => i.Key + "|" + i.Name + "|" + i.Signature));
            Assert.Eq(a, b);
        }
    }
}
