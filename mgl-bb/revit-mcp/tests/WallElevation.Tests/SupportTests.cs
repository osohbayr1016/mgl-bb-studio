using System;
using System.Collections.Generic;
using System.Linq;
using RevitMcpAddin.WallElevation.Core;

namespace RevitMcpAddin.WallElevation.Tests
{
    public static class NamingTests
    {
        [Test]
        public static void Empty_tokens_do_not_leave_double_separators()
        {
            var v = new Dictionary<string, string> { { "{Level}", "L01" }, { "{Room}", "" }, { "{Side}", "A" } };
            Assert.Eq("WE-L01-A", WeNaming.Expand("WE-{Level}-{Room}-{Side}", v));
            Assert.Eq("WE-L01", WeNaming.Expand("WE-{Level}-{Room}", v));
        }

        [Test]
        public static void Forbidden_revit_characters_are_replaced()
        {
            var v = new Dictionary<string, string> { { "{Room}", "A:1[2]" } };
            Assert.Eq("R-A-1-2", WeNaming.Expand("R-{Room}", v));
        }

        [Test]
        public static void Unknown_tokens_are_detected()
        {
            Assert.SeqEq(new[] { "{Foo}" }, WeNaming.UnknownTokens("WE-{Level}-{Foo}"));
            Assert.Eq(0, WeNaming.UnknownTokens(WeNaming.DefaultViewPattern).Count);
            Assert.Eq(0, WeNaming.UnknownTokens("{level}-{ROOM}").Count, "том жижиг үсэг хамаарахгүй");
        }

        [Test]
        public static void Unique_names_and_sheet_numbers_are_deterministic()
        {
            var taken = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "WE-1", "we-1 (2)" };
            Assert.Eq("WE-1 (3)", WeNaming.Unique("WE-1", taken));
            var nums = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "WE-L01-101" };
            Assert.Eq("WE-L01-101-2", WeNaming.UniqueNumber("WE-L01-101", nums));
        }

        [Test]
        public static void Letters()
        {
            Assert.SeqEq(new[] { "A", "B", "Z", "AA", "AB" }, new[] { 0, 1, 25, 26, 27 }.Select(WeNaming.Letter));
        }

        [Test]
        public static void Identity_key_is_independent_of_the_name()
        {
            Assert.Eq("v1|room:R|wall:W|side:int", WeIdentity.Key("R", "W", WeSide.Interior));
            Assert.Eq("v1|room:|wall:W|side:ext", WeIdentity.Key(null, "W", WeSide.Exterior));
        }
    }

    public static class SettingsTests
    {
        [Test]
        public static void Settings_round_trip()
        {
            var s = new WeSettings
            {
                ViewTypeName = "Interior Elevation", TemplateName = WeSettings.TemplateNone, Scale = 25, PaddingMm = 150.5,
                NearOffsetMm = 900, FarDepthMm = 50, NamePattern = "IE-{Room}-{Side}", WallSide = WeWallSidePick.Both,
                Output = WeOutputMode.ViewsAndSheets, TitleBlockName = "A1 : MGL", SheetNumberPattern = "IE-{Room}", SheetMarginMm = 20,
                UpdateExisting = false,
            };
            WeSettings r = WeSettings.Deserialize(s.Serialize());
            Assert.Eq(s.Serialize(), r.Serialize());
        }

        [Test]
        public static void Bad_values_fall_back_to_defaults_and_never_throw()
        {
            WeSettings r = WeSettings.Deserialize("scale=-5\npaddingMm=abc\nwallSide=99\noutput=Sideways\nnamePattern=\n=x\ngarbage");
            var d = new WeSettings();
            Assert.Eq(d.Scale, r.Scale);
            Assert.Eq(d.PaddingMm, r.PaddingMm);
            Assert.Eq(d.WallSide, r.WallSide);
            Assert.Eq(d.Output, r.Output);
            Assert.Eq(d.NamePattern, r.NamePattern);
            Assert.Eq(0, WeSettings.Deserialize(null).Validate().Count);
        }

        [Test]
        public static void Validation_reports_bad_patterns_and_ranges()
        {
            var s = new WeSettings { NamePattern = "WE-{Nope}", Scale = 0 };
            List<string> e = s.Validate();
            Assert.Eq(2, e.Count, string.Join(" | ", e));
        }
    }

    public static class ValidatorTests
    {
        private static WePlannedElevation Planned()
        {
            WeWallInfo w = Fx.Wall(Fx.P(0, 0), Fx.P(4000, 0), new WeV3(0, -1, 0), id: 77);
            var req = new WeRequest(); req.Walls.Add(w);
            return Fx.Only(WallElevationPlanner.Plan(req, Fx.Ctx()));
        }

        [Test]
        public static void Correct_view_passes()
        {
            WePlannedElevation p = Planned();
            List<WeValidationIssue> issues = WallElevationValidator.Check(p, Fx.SnapshotOf(p), true);
            Assert.Eq(0, issues.Count, string.Join(" | ", issues.Select(i => i.Message)));
        }

        [Test]
        public static void View_facing_the_wrong_side_fails()
        {
            WePlannedElevation p = Planned();
            WeViewSnapshot v = Fx.SnapshotOf(p);
            v.ViewDirection = -v.ViewDirection;
            v.Right = -v.Right;
            Assert.Eq(WeStatus.Failed, WallElevationValidator.Worst(WallElevationValidator.Check(p, v, true), WeStatus.Ready));
        }

        [Test]
        public static void Wall_outside_crop_or_too_shallow_fails()
        {
            WePlannedElevation p = Planned();
            WeViewSnapshot v = Fx.SnapshotOf(p);
            v.Half = new WeV3(Fx.Mm(500), v.Half.Y, v.Half.Z);
            Assert.Eq(WeStatus.Failed, WallElevationValidator.Worst(WallElevationValidator.Check(p, v, true), WeStatus.Ready));

            v = Fx.SnapshotOf(p);
            v.Half = new WeV3(v.Half.X, v.Half.Y, Fx.Mm(10));      // ханын ар тал гүнээс гадна
            Assert.Eq(WeStatus.Failed, WallElevationValidator.Worst(WallElevationValidator.Check(p, v, true), WeStatus.Ready));
        }

        [Test]
        public static void Missing_identity_or_source_fails_and_duplicates_need_review()
        {
            WePlannedElevation p = Planned();
            WeViewSnapshot v = Fx.SnapshotOf(p);
            v.IdentityKey = null;
            Assert.Eq(WeStatus.Failed, WallElevationValidator.Worst(WallElevationValidator.Check(p, v, true), WeStatus.Ready));
            Assert.Eq(WeStatus.Failed, WallElevationValidator.Worst(WallElevationValidator.Check(p, Fx.SnapshotOf(p), false), WeStatus.Ready));
            v = Fx.SnapshotOf(p);
            v.SameKeyCount = 2;
            Assert.Eq(WeStatus.RequiresReview, WallElevationValidator.Worst(WallElevationValidator.Check(p, v, true), WeStatus.Ready));
        }

        [Test]
        public static void Huge_far_clip_is_flagged()
        {
            // Хэмжсэн: CreateSection-ийн дараа far clip 1100 фут үлддэг байв — ханын нүхээр цаадах бүх юм харагдана.
            WePlannedElevation p = Planned();
            WeViewSnapshot v = Fx.SnapshotOf(p);
            v.FarClipDepth = 1100;
            Assert.Eq(WeStatus.Warning, WallElevationValidator.Worst(WallElevationValidator.Check(p, v, true), WeStatus.Ready));
        }

        [Test]
        public static void Template_not_applied_is_a_warning()
        {
            WePlannedElevation p = Planned();
            WeViewSnapshot v = Fx.SnapshotOf(p);
            v.WantedTemplateId = 555;
            v.TemplateId = -1;
            Assert.Eq(WeStatus.Warning, WallElevationValidator.Worst(WallElevationValidator.Check(p, v, true), WeStatus.Ready));
        }
    }

    public static class SheetLayoutTests
    {
        private static List<WeV3> Sizes(params double[] wh)
        {
            var r = new List<WeV3>();
            for (int i = 0; i < wh.Length; i += 2) r.Add(new WeV3(wh[i], wh[i + 1], 0));
            return r;
        }

        [Test]
        public static void Viewports_never_overlap_and_stay_inside_the_area()
        {
            List<WeV3> sizes = Sizes(3, 2, 4, 2.5, 2, 1, 5, 3, 3, 3, 1, 1, 2, 2);
            List<WeSheetSlot> slots = WeSheetLayout.Pack(sizes, 0, 0, 10, 7, 0.2, 7);
            Assert.Eq(sizes.Count, slots.Count);
            for (int i = 0; i < slots.Count; i++)
            {
                WeSheetSlot s = slots[i];
                Assert.True(s.CenterX - sizes[i].X / 2 >= -1e-9 && s.CenterX + sizes[i].X / 2 <= 10 + 1e-9, "x " + i);
                Assert.True(s.CenterY - sizes[i].Y / 2 >= -1e-9 && s.CenterY + sizes[i].Y / 2 <= 7 + 1e-9, "y " + i);
                for (int j = i + 1; j < slots.Count; j++)
                    Assert.False(WeSheetLayout.Overlaps(s, sizes[i], slots[j], sizes[j]), "давхцал " + i + "/" + j);
            }
            Assert.True(slots.Max(s => s.Page) >= 1, "дүүрвэл дараагийн хуудас");
        }

        [Test]
        public static void Occupied_top_of_a_reused_sheet_is_respected()
        {
            List<WeSheetSlot> slots = WeSheetLayout.Pack(Sizes(2, 2), 0, 0, 10, 7, 0.2, 4);
            Assert.True(slots[0].CenterY + 1 <= 4 + 1e-9);
            List<WeSheetSlot> next = WeSheetLayout.Pack(Sizes(2, 5), 0, 0, 10, 7, 0.2, 4);
            Assert.Eq(1, next[0].Page, "үлдсэн зайд багтахгүй → шинэ хуудас");
        }

        [Test]
        public static void Oversize_view_gets_its_own_sheet()
        {
            List<WeSheetSlot> slots = WeSheetLayout.Pack(Sizes(2, 2, 20, 3, 2, 2), 0, 0, 10, 7, 0.2, 7);
            Assert.True(slots[1].Oversize);
            Assert.True(slots[0].Page != slots[1].Page && slots[1].Page != slots[2].Page);
        }
    }
}
