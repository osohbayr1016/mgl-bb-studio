using System;
using System.Linq;
using RevitMcpAddin.WallElevation.Core;

namespace RevitMcpAddin.WallElevation.Tests
{
    /// <summary>
    /// W07 (2026-10-16): түлхүүр план дээрх БИЧВЭР тэмдгийн лавлагаа «205A / A-301».  Revit-ийн Elevation маркер (Detail Number + Sheet Number)
    /// өөрөө шинэчлэгддэг тул бичвэр тэмдэг (зүсэлт / хуучин харагдац) л хоёр мөртэй — Elevation горимын түлхүүр планы хэмжээ ӨМНӨХТЭЙ ЯГ ижил.
    /// </summary>
    public static class KeyPlanRefTests
    {
        [Test]
        public static void Reference_text_is_label_plus_sheet_on_a_second_line()
        {
            Assert.Eq("205A\rA-301", WeKeyPlanRef.Desired("205A", "A-301"));
            Assert.Eq("205A", WeKeyPlanRef.Desired("205A", null), "хуудсанд байршаагүй — тэмдэг л");
            Assert.Eq("205A", WeKeyPlanRef.Desired("205A", "---"), "Revit-ийн «---» = байршаагүй");
            Assert.Eq("205A", WeKeyPlanRef.Desired(" 205A ", "  "));
            Assert.Eq("205A", WeKeyPlanRef.LabelOf("205A\rA-301"));
            Assert.Eq("205A", WeKeyPlanRef.LabelOf("205A\r\nA-301\r"));
            Assert.Eq("205A", WeKeyPlanRef.LabelOf("205A"));
            Assert.True(WeKeyPlanRef.Same("205A\rA-301\r", "205A\rA-301"), "Revit-ийн төгсгөлийн мөр таслалыг үл тооно");
            Assert.True(WeKeyPlanRef.Same("205A\r\nA-301", "205A\rA-301"));
            Assert.False(WeKeyPlanRef.Same("205A\rA-302", "205A\rA-301"), "дугаар солигдсон — засна");
            Assert.False(WeKeyPlanRef.Same("205A", "205A\rA-301"));
        }

        [Test]
        public static void Expected_sheet_prefers_the_actual_placement_over_plans()
        {
            Assert.Eq("A-305", WeKeyPlanRef.Expected("A-305", "A-900", "A-301", "WE-01"), "гараар зөөсөн харагдацын одоогийн хуудас");
            Assert.Eq("A-900", WeKeyPlanRef.Expected("---", "A-900", "A-301", "WE-01"), "сонгосон хуудас");
            Assert.Eq("A-301", WeKeyPlanRef.Expected(null, "", "A-301", "WE-01"), "өрөөний өмнөх хуудас");
            Assert.Eq("WE-01", WeKeyPlanRef.Expected(null, null, null, "WE-01"), "шинэ хуудасны урьдчилан хуваарилсан дугаар");
            Assert.Null(WeKeyPlanRef.Expected(null, null, null, null));
        }

        private static WePlan PlanWithKeyPlan(WeViewKind kind, WeOutputMode output, bool legacySection = false)
        {
            WeRequest req = Fx.SquareRoom(5000, 4000);
            WePlan first = WallElevationPlanner.Plan(req, Fx.Ctx(s => { s.ViewKind = kind; s.Output = output; s.KeyPlan = true; }));
            if (legacySection)
            {
                foreach (WeExistingView e in Fx.AsExisting(first)) { e.IsSection = true; req.Existing.Add(e); }
            }
            return WallElevationPlanner.Plan(req, Fx.Ctx(s => { s.ViewKind = kind; s.Output = output; s.KeyPlan = true; }));
        }

        [Test]
        public static void Text_markers_reserve_a_second_line_only_where_they_are_drawn()
        {
            WePlan section = PlanWithKeyPlan(WeViewKind.Section, WeOutputMode.ViewsAndSheets);
            WeKeyPlan kpS = section.Groups.Single().KeyPlan;
            Assert.True(kpS.Markers.Count == 4 && kpS.Markers.All(m => m.Lines == 2), "зүсэлт + хуудас: бичвэр тэмдэг хоёр мөр");

            WePlan elevation = PlanWithKeyPlan(WeViewKind.Elevation, WeOutputMode.ViewsAndSheets);
            WeKeyPlan kpE = elevation.Groups.Single().KeyPlan;
            Assert.True(kpE.Markers.All(m => m.Lines == 1), "Elevation маркер — нэг мөр (Revit-ийн тэмдэг лавлагаагаа өөрөө харуулна)");

            WePlan legacy = PlanWithKeyPlan(WeViewKind.Elevation, WeOutputMode.ViewsAndSheets, legacySection: true);
            Assert.True(legacy.Groups.Single().KeyPlan.Markers.All(m => m.Lines == 2), "өмнөх хувилбарын зүсэлт — бичвэр тэмдэг хоёр мөр");
        }

        [Test]
        public static void Two_line_box_is_taller_and_wide_enough_for_a_sheet_number()
        {
            Func<double, double> paper = mm => Fx.Mm(mm * 50);
            WeV3 one = WeKeyPlanner.HalfSize("1A", paper), two = WeKeyPlanner.HalfSize("1A", paper, 2);
            Assert.True(two.Y > one.Y + paper(WeKeyPlanner.LabelLinePaperMm) / 2 - 1e-9, "хоёр дахь мөрийн өндөр");
            Assert.True(two.X >= paper(WeKeyPlanner.SheetRefChars * WeKeyPlanner.LabelCharPaperMm + WeKeyPlanner.LabelPadPaperMm) / 2 - 1e-9, "хуудасны дугаарын өргөн");
            Assert.Eq(one.X, WeKeyPlanner.HalfSize("1A", paper, 1).X, "нэг мөр — өмнөхтэй ЯГ ижил");
        }
    }
}
