using System;
using System.Collections.Generic;
using RevitMcpAddin.CloneDrawings.Core;

namespace RevitMcpAddin.CloneDrawings.Tests
{
    public static class StretchTests
    {
        [Test]
        public static void SameSize_IsPureShift()
        {
            // Загвар [0, 10], зорилт [5, 15] — ижил урт: бүх цэг +5.
            Assert.Near(5, Stretch.Axis(0, 0, 10, 5, 15), 1e-9);
            Assert.Near(12, Stretch.Axis(7, 0, 10, 5, 15), 1e-9);
            Assert.Near(3, Stretch.Axis(-2, 0, 10, 5, 15), 1e-9);
            Assert.Near(18, Stretch.Axis(13, 0, 10, 5, 15), 1e-9);
        }

        [Test]
        public static void Outside_KeepsOffsetFromNearestFace()
        {
            // 300 мм (≈1 фут) доор байсан хэмжээсийн шугам урт өөр элемент дээр ч 1 фут доор.
            Assert.Near(-1, Stretch.Axis(-1, 0, 10, 0, 24), 1e-9);
            Assert.Near(25, Stretch.Axis(11, 0, 10, 0, 24), 1e-9);
        }

        [Test]
        public static void Inside_IsProportional()
        {
            // 45%-д байсан зүсэлт 45%-д.
            Assert.Near(0.45 * 24, Stretch.Axis(4.5, 0, 10, 0, 24), 1e-9);
            Assert.Near(10 + 0.5 * 6, Stretch.Axis(5, 0, 10, 10, 16), 1e-9);
        }

        [Test]
        public static void Boundaries_MapToBoundaries()
        {
            Assert.Near(2, Stretch.Axis(0, 0, 10, 2, 9), 1e-9);
            Assert.Near(9, Stretch.Axis(10, 0, 10, 2, 9), 1e-9);
        }

        [Test]
        public static void DegenerateTemplateAxis_DoesNotDivideByZero()
        {
            double v = Stretch.Axis(0, 0, 0, 3, 3);
            Assert.Near(3, v, 1e-9);
            Assert.False(double.IsNaN(v));
        }
    }

    public static class DedicatedRuleTests
    {
        [Test]
        public static void BeamCrossSection_IsDedicated()
        {
            // 0.3 × 0.6 м дам нуруу, 1.5 × 1.2 м хүрээ.
            Assert.True(DedicatedRule.IsDedicated(4.9, 3.9, 1.0, 2.0));
        }

        [Test]
        public static void BeamElevation_IsDedicated()
        {
            // 8 м дам нурууны фасад: 9 × 3 м хүрээ.
            Assert.True(DedicatedRule.IsDedicated(29.5, 9.8, 26.2, 2.0));
        }

        [Test]
        public static void ColumnCallout_IsDedicated()
        {
            Assert.True(DedicatedRule.IsDedicated(10, 10, 1.6, 1.6));
        }

        [Test]
        public static void WholeFloorPlan_IsGeneral()
        {
            // 60 × 40 м план, 8 м дам нуруу.
            Assert.False(DedicatedRule.IsDedicated(197, 131, 26.2, 1.0));
        }

        [Test]
        public static void BuildingSection_IsGeneral()
        {
            Assert.False(DedicatedRule.IsDedicated(197, 40, 1.0, 2.0));
        }

        [Test]
        public static void NoCrop_IsGeneral()
        {
            Assert.False(DedicatedRule.IsDedicated(0, 0, 1, 1));
            Assert.False(DedicatedRule.IsDedicated(double.NaN, 5, 1, 1));
        }

        [Test]
        public static void SectionBox3D()
        {
            Assert.True(DedicatedRule.IsDedicated3(30, 5, 5, 26, 1, 2));
            Assert.False(DedicatedRule.IsDedicated3(200, 150, 60, 26, 1, 2));
        }
    }

    public static class NamingTests
    {
        [Test]
        public static void ReplaceableMark()
        {
            Assert.True(CloneNaming.IsReplaceableMark("B1"));
            Assert.True(CloneNaming.IsReplaceableMark("C-12"));
            Assert.True(CloneNaming.IsReplaceableMark("Б3"));
            Assert.False(CloneNaming.IsReplaceableMark("1"));
            Assert.False(CloneNaming.IsReplaceableMark("12"));
            Assert.False(CloneNaming.IsReplaceableMark("B"));
            Assert.False(CloneNaming.IsReplaceableMark("B 1"));
            Assert.False(CloneNaming.IsReplaceableMark(null));
        }

        [Test]
        public static void ReplaceWholeTokenOnly()
        {
            Assert.True(CloneNaming.TryReplaceMark("B1 - Зүсэлт 1", "B1", "B2", out string r1));
            Assert.Eq("B2 - Зүсэлт 1", r1);
            // B12-ийн дотор солихгүй.
            Assert.False(CloneNaming.TryReplaceMark("B12 - Зүсэлт", "B1", "B2", out string r2));
            Assert.Eq("B12 - Зүсэлт", r2);
            // Олон удаа.
            Assert.True(CloneNaming.TryReplaceMark("B1/B1a/(B1)", "B1", "B7", out string r3));
            Assert.Eq("B7/B1a/(B7)", r3);
        }

        [Test]
        public static void NumericMarkIsNeverReplaced()
        {
            Assert.False(CloneNaming.TryReplaceMark("Level 1 - Section 1", "1", "2", out string r));
            Assert.Eq("Level 1 - Section 1", r);
            Assert.Eq("Level 1 - Section 1 - 2", CloneNaming.ViewName("Level 1 - Section 1", "1", "2", "2"));
        }

        [Test]
        public static void ViewName_FallsBackToSuffix()
        {
            Assert.Eq("Beam section - B2", CloneNaming.ViewName("Beam section", "B1", "B2", "B2"));
            Assert.Eq("Beam section - ID 123", CloneNaming.ViewName("Beam section", null, null, "ID 123"));
            Assert.Eq("B2 detail", CloneNaming.ViewName("B1 detail", "B1", "B2", "B2"));
        }

        [Test]
        public static void SheetNumberAndName()
        {
            Assert.Eq("S-201-B2", CloneNaming.SheetNumber("S-201-B1", "B1", "B2", "B2"));
            Assert.Eq("S-201-ID123", CloneNaming.SheetNumber("S-201", "B1", null, "ID 123"));
            Assert.Eq("Beams (B2)", CloneNaming.SheetName("Beams", "B1", "B2", "B2"));
            Assert.Eq("B2 дам нуруу", CloneNaming.SheetName("B1 дам нуруу", "B1", "B2", "B2"));
        }

        [Test]
        public static void MakeUnique()
        {
            var have = new HashSet<string> { "A", "A 2" };
            Assert.Eq("A 3", CloneNaming.MakeUnique("A", have.Contains));
            Assert.Eq("B", CloneNaming.MakeUnique("B", have.Contains));
            var nums = new HashSet<string> { "S-1-B2" };
            Assert.Eq("S-1-B2.2", CloneNaming.MakeUnique("S-1-B2", nums.Contains, "."));
        }

        [Test]
        public static void TargetLabel()
        {
            Assert.Eq("B2", CloneNaming.TargetLabel(" B2 ", 5));
            Assert.Eq("ID 5", CloneNaming.TargetLabel("", 5));
            Assert.Eq("ID 5", CloneNaming.TargetLabel(null, 5));
        }

        [Test]
        public static void Compact()
        {
            Assert.Eq("ID123", CloneNaming.Compact("ID 123"));
            Assert.Eq("C-12", CloneNaming.Compact("C-12"));
            Assert.Eq("X", CloneNaming.Compact("  "));
        }
    }

    public static class GroupingTests
    {
        private static TargetFacts Beam(double lenA, double lenB, double angle = 0, bool sameType = true, bool mirrored = false, bool sameLevel = true)
        {
            return new TargetFacts
            {
                SameType = sameType,
                TypeName = "W12x26",
                SizeA = new[] { lenA, 1.0, 2.0 },
                SizeB = new[] { lenB, 1.0, 2.0 },
                PlanAngleDeg = angle,
                Mirrored = mirrored,
                SameLevel = sameLevel,
                FrameKind = "curve",
            };
        }

        [Test]
        public static void SameSizeSameOrientation()
        {
            TargetFacts f = Beam(20, 20.005);
            Assert.False(TargetGrouping.SizeDiffers(f));
            Assert.Eq("W12x26 — ижил хэмжээ, ижил чиг", TargetGrouping.GroupLabel(f));
        }

        [Test]
        public static void LengthDiffers_SaysLength()
        {
            TargetFacts f = Beam(20, 24);
            Assert.True(TargetGrouping.SizeDiffers(f));
            Assert.Eq("урт", TargetGrouping.SizeWord(f));
            Assert.Eq("W12x26 — урт өөр", TargetGrouping.GroupLabel(f));
        }

        [Test]
        public static void RotatedAndOtherLevel()
        {
            TargetFacts f = Beam(20, 20, 90.2, sameLevel: false);
            Assert.Eq("W12x26 — 90° эргэсэн · өөр давхарт", TargetGrouping.GroupLabel(f));
        }

        [Test]
        public static void OtherTypeGoesToOwnGroup()
        {
            TargetFacts a = Beam(20, 20), b = Beam(20, 20, sameType: false);
            Assert.True(TargetGrouping.GroupKey(a) != TargetGrouping.GroupKey(b));
            Assert.True(TargetGrouping.GroupLabel(b).Contains("(өөр төрөл)"));
        }

        [Test]
        public static void AngleBucket()
        {
            Assert.Eq(0, TargetGrouping.AngleBucket(0.3));
            Assert.Eq(90, TargetGrouping.AngleBucket(89.7));
            Assert.Eq(180, TargetGrouping.AngleBucket(-180));
            Assert.Eq(180, TargetGrouping.AngleBucket(179.8));
            Assert.Eq(-90, TargetGrouping.AngleBucket(270));
        }

        [Test]
        public static void ColumnHeight()
        {
            var f = new TargetFacts
            {
                SameType = true,
                TypeName = "C 400x400",
                SizeA = new[] { 1.3, 1.3, 10 },
                SizeB = new[] { 1.3, 1.3, 13 },
                FrameKind = "point",
            };
            Assert.Eq("өндөр", TargetGrouping.SizeWord(f));
            Assert.Eq("H = 3 962 мм", TargetGrouping.Details(f, null));
        }

        [Test]
        public static void Details()
        {
            TargetFacts f = Beam(20, 23.622, 90);
            Assert.Eq("L = 7 200 мм · 90° · Level 2", TargetGrouping.Details(f, "Level 2"));
        }
    }
}
