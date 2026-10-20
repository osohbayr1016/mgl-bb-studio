using System;
using System.Linq;
using RevitMcpAddin.ChangeImpact.Core;
using static RevitMcpAddin.Smart.Tests.PreChangeFixtures;

namespace RevitMcpAddin.Smart.Tests
{
    /// <summary>Харагдах текст, нэгж, хүлцэл, хүсэлтийн шалгалт.  «Тооцоогүй» нь ХЭЗЭЭ Ч «0» гэж харагдахгүй.</summary>
    public static class PreChangeTextTests
    {
        /* ------------------------------ PreChangeText ------------------------------ */

        [Test]
        public static void Format_NullOrNonFinite_IsDash_NeverZero()
        {
            Assert.Eq("—", PreChangeText.Mm(null));
            Assert.Eq("—", PreChangeText.M2(null));
            Assert.Eq("—", PreChangeText.M(null));
            Assert.Eq("—", PreChangeText.Mm(double.NaN));
            Assert.Eq("—", PreChangeText.M2(double.PositiveInfinity));
            Assert.Eq("—", PreChangeText.M(double.NegativeInfinity));
            Assert.Eq("—", PreChangeText.DeltaMm(null));
            Assert.Eq("—", PreChangeText.DeltaM2(null));
            Assert.Eq("—", PreChangeText.DeltaM(null));
            Assert.Eq("—", PreChangeText.DeltaMm(double.NaN));
            Assert.Eq(PreChangeText.Unknown, PreChangeText.Mm(null));
        }

        [Test]
        public static void Format_Values_UseInvariantCultureAndUnits()
        {
            Assert.Eq("4200 мм", PreChangeText.Mm(4200.0));
            Assert.Eq("300 мм", PreChangeText.Mm(300.4));
            Assert.Eq("34.82 м²", PreChangeText.M2(34.8249));
            Assert.Eq("10.50 м", PreChangeText.M(10.5));
            Assert.Eq("0 мм", PreChangeText.Mm(0.0), "бодит 0 утга нь 0 — «тооцоогүй» биш null");
        }

        [Test]
        public static void DeltaMm_BelowToleranceIsUnchanged_AboveHasSign()
        {
            Assert.Eq("өөрчлөгдөөгүй", PreChangeText.DeltaMm(0.0));
            Assert.Eq("өөрчлөгдөөгүй", PreChangeText.DeltaMm(0.5));
            Assert.Eq("өөрчлөгдөөгүй", PreChangeText.DeltaMm(-0.5));
            Assert.Eq("+1 мм", PreChangeText.DeltaMm(0.51 + 0.4));
            Assert.Eq("+300 мм", PreChangeText.DeltaMm(300.0));
            Assert.Eq("−300 мм", PreChangeText.DeltaMm(-300.0));
        }

        [Test]
        public static void DeltaM2_UsesU2212Minus_AndTolerance()
        {
            Assert.Eq("−0.51 м²", PreChangeText.DeltaM2(-0.51));
            Assert.Eq("−", PreChangeText.Minus);
            Assert.Eq(0x2212, (int)PreChangeText.Minus[0]);
            Assert.False(PreChangeText.DeltaM2(-0.51).Contains("-"));
            Assert.Eq("+0.51 м²", PreChangeText.DeltaM2(0.51));
            Assert.Eq("өөрчлөгдөөгүй", PreChangeText.DeltaM2(0.004));
            Assert.Eq("өөрчлөгдөөгүй", PreChangeText.DeltaM2(-0.005));
            Assert.Eq("+0.01 м²", PreChangeText.DeltaM2(0.0051 + 0.0001 + 0.0048 - 0.0048 + 0.0));
        }

        [Test]
        public static void DeltaM_RouteTolerance_AndSigns()
        {
            Assert.Eq("+1.24 м", PreChangeText.DeltaM(1.24));
            Assert.Eq("−0.50 м", PreChangeText.DeltaM(-0.5));
            Assert.Eq("өөрчлөгдөөгүй", PreChangeText.DeltaM(0.01));
            Assert.Eq("өөрчлөгдөөгүй", PreChangeText.DeltaM(-0.004));
        }

        [Test]
        public static void Headline_UsesDistanceAndSide()
        {
            Assert.Eq("Энэ ханыг 300 мм Оффис 203 тал руу зөөвөл", PreChangeText.Headline(Req(300, 1, 0, "Оффис 203 тал руу")));
            Assert.Eq("Энэ ханыг 300 мм зөөвөл", PreChangeText.Headline(Req(300, 1, 0, null)));
            Assert.Eq("Энэ ханыг 300 мм зөөвөл", PreChangeText.Headline(Req(300, 1, 0, "  ")));
            Assert.Eq(PreChangeText.WindowTitle, PreChangeText.Headline(null));
        }

        [Test]
        public static void ViewBreakdown_GroupsByTypeMostFirst()
        {
            Assert.Eq("2 план, 1 зүсэлт", PreChangeText.ViewBreakdown(new[] { "Section", "FloorPlan", "FloorPlan" }));
            Assert.Eq("", PreChangeText.ViewBreakdown(new string[0]));
            Assert.Eq("1 харагдац", PreChangeText.ViewBreakdown(new string[] { "Whatever" }));
            Assert.Eq("1 харагдац", PreChangeText.ViewBreakdown(new string[] { null }));
            Assert.Eq("2 план", PreChangeText.ViewBreakdown(new[] { "EngineeringPlan", "AreaPlan" }));
            Assert.Eq("1 3D, 1 план", PreChangeText.ViewBreakdown(new[] { "ThreeD", "FloorPlan" }), "тэнцүү бол нэрээр");
        }

        [Test]
        public static void ViewGroup_KnownTypes()
        {
            Assert.Eq("таазны план", PreChangeText.ViewGroup("CeilingPlan"));
            Assert.Eq("фасад", PreChangeText.ViewGroup("Elevation"));
            Assert.Eq("дэлгэрэнгүй", PreChangeText.ViewGroup("Detail"));
            Assert.Eq("3D", PreChangeText.ViewGroup("ThreeD"));
        }

        [Test]
        public static void Labels_AllLevelsAndSeveritiesHaveWordsNotOnlyColour()
        {
            foreach (AttentionLevel l in Enum.GetValues(typeof(AttentionLevel)).Cast<AttentionLevel>())
            {
                Assert.True(PreChangeText.LevelLabel(l).Length > 0);
                Assert.True(PreChangeText.LevelExplain(l, false).Length > 0);
            }
            foreach (ItemSeverity s in Enum.GetValues(typeof(ItemSeverity)).Cast<ItemSeverity>())
            {
                Assert.True(PreChangeText.SeverityWord(s).Length > 0);
                Assert.True(PreChangeText.SeverityMark(s).Length > 0);
            }
            Assert.Eq("ЦЭВЭР", PreChangeText.LevelLabel(AttentionLevel.Clean));
            Assert.Eq("БОЛОМЖГҮЙ", PreChangeText.LevelLabel(AttentionLevel.Blocked));
        }

        [Test]
        public static void Constants_AreStableUserFacingStrings()
        {
            Assert.Eq("Загварт одоогоор ямар ч өөрчлөлт хийгдээгүй.", PreChangeText.ModelUntouched);
            Assert.True(PreChangeText.StalePreview.Contains("дахин шалгана"));
            Assert.True(PreChangeText.EgressNotConfigured.Contains("тооцоолоогүй"));
            Assert.True(PreChangeText.NormNotEvaluated.Contains("баталгаажсан локал дүрэм алга"));
        }

        /* ------------------------------ PreChangeTolerance ------------------------------ */

        [Test]
        public static void Tolerance_SameMm_Edges()
        {
            Assert.True(PreChangeTolerance.SameMm(100, 100));
            Assert.True(PreChangeTolerance.SameMm(100, 100.5));
            Assert.True(PreChangeTolerance.SameMm(100.5, 100));
            Assert.False(PreChangeTolerance.SameMm(100, 100.5001));
            Assert.False(PreChangeTolerance.SameMm(100, double.NaN));
        }

        [Test]
        public static void Tolerance_SameM2_Edges()
        {
            Assert.True(PreChangeTolerance.SameM2(0, 0.005));
            Assert.True(PreChangeTolerance.SameM2(10, 10.004));
            Assert.False(PreChangeTolerance.SameM2(10, 10.0051));
            Assert.True(PreChangeTolerance.SameRouteM(0, 0.01));
            Assert.True(PreChangeTolerance.SameRouteM(10, 10.009));
            Assert.False(PreChangeTolerance.SameRouteM(10, 10.011));
        }

        [Test]
        public static void Tolerance_SameVectorMm_Edges()
        {
            double[] v = { 300, 0, 0 };
            Assert.True(PreChangeTolerance.SameVectorMm(v, new[] { 300.0, 0, 0 }));
            Assert.True(PreChangeTolerance.SameVectorMm(v, new[] { 301.0, -1.0, 1.0 }), "хоёр байрлалын зөрүү = 2×0.5 мм");
            Assert.False(PreChangeTolerance.SameVectorMm(v, new[] { 301.1, 0, 0 }));
            Assert.False(PreChangeTolerance.SameVectorMm(v, new[] { 300.0, 0, 1.5 }));
            Assert.False(PreChangeTolerance.SameVectorMm(null, v));
            Assert.False(PreChangeTolerance.SameVectorMm(v, null));
            Assert.False(PreChangeTolerance.SameVectorMm(new[] { 300.0, 0 }, v));
        }

        [Test]
        public static void Tolerance_DiffMm_AndLengthOfMm()
        {
            double[] d = PreChangeTolerance.DiffMm(new[] { 1.0, 2, 3 }, new[] { 4.0, 6, 3 });
            Assert.SeqEq(new[] { 3.0, 4.0, 0.0 }, d);
            Assert.Near(5.0, PreChangeTolerance.LengthOfMm(d), 1e-12);
            Assert.Null(PreChangeTolerance.DiffMm(null, new[] { 1.0, 2, 3 }));
            Assert.Null(PreChangeTolerance.DiffMm(new[] { 1.0, 2 }, new[] { 1.0, 2, 3 }));
            Assert.Near(0, PreChangeTolerance.LengthOfMm(null), 0);
            Assert.Near(0, PreChangeTolerance.LengthOfMm(new[] { 1.0 }), 0);
        }

        [Test]
        public static void Tolerance_Quantize()
        {
            Assert.Near(1.5, PreChangeTolerance.Quantize(1.3, 0.5), 1e-12);
            Assert.Near(0.0, PreChangeTolerance.Quantize(0.2, 0.5), 1e-12);
            Assert.Near(1000.0, PreChangeTolerance.Quantize(1000.1, 0.5), 1e-12);
            Assert.Near(7.3, PreChangeTolerance.Quantize(7.3, 0), 0, "step<=0 → утга хэвээр");
            Assert.Near(7.3, PreChangeTolerance.Quantize(7.3, -1), 0);
            Assert.True(double.IsNaN(PreChangeTolerance.Quantize(double.NaN, 0.5)));
            Assert.True(double.IsPositiveInfinity(PreChangeTolerance.Quantize(double.PositiveInfinity, 0.5)));
        }

        /* ------------------------------ ParseDistanceMm ------------------------------ */

        private static void P(string input, double? expected)
        {
            double? got = PreChangeRequestRules.ParseDistanceMm(input);
            if (expected == null) Assert.Null(got, "«" + input + "» → null байх ёстой");
            else
            {
                Assert.True(got.HasValue, "«" + input + "» → " + expected + " байх ёстой, null гарсан");
                Assert.Near(expected.Value, got.Value, 1e-9, "«" + input + "»");
            }
        }

        [Test]
        public static void ParseDistanceMm_Millimetres()
        {
            P("300", 300);
            P("300 мм", 300);
            P("300мм", 300);
            P("300mm", 300);
            P("  300 MM ", 300);
            P("300.5", 300.5);
            P("300,5", 300.5);
        }

        [Test]
        public static void ParseDistanceMm_MetresAndCentimetres()
        {
            P("0,3 м", 300);
            P("0.3m", 300);
            P("0.3 M", 300);
            P("1 м", 1000);
            P("30 см", 300);
            P("30cm", 300);
            P("0,5 см", 5);
        }

        [Test]
        public static void ParseDistanceMm_InvalidEmptyNegativeZero_AreNull()
        {
            P("", null);
            P("   ", null);
            P(null, null);
            P("abc", null);
            P("-5", null);
            P("-5 мм", null);
            P("0", null);
            P("0 мм", null);
            P("0 м", null);
            P("мм", null);
            P("м", null);
            P("1,2,3", null);
            P("NaN", null);
            P("Infinity", null);
            P("300 foo", null);
        }

        /* ------------------------------ Validate ------------------------------ */

        [Test]
        public static void Validate_ValidRequest_IsNull()
        {
            Assert.Null(PreChangeRequestRules.Validate(Req(300, 1, 0)));
            Assert.Null(PreChangeRequestRules.Validate(Req(300, 0.6, 0.8)));
            Assert.Null(PreChangeRequestRules.Validate(Req(PreChangeRequestRules.MaxDistanceMm, 1, 0)));
        }

        [Test]
        public static void Validate_NullRequest_IsRejected()
        {
            Assert.NotNull(PreChangeRequestRules.Validate(null));
        }

        [Test]
        public static void Validate_NoSource_IsRejected()
        {
            PreChangeRequest r = Req(); r.SourceId = 0;
            Assert.NotNull(PreChangeRequestRules.Validate(r));
            r.SourceId = -4;
            Assert.NotNull(PreChangeRequestRules.Validate(r));
        }

        [Test]
        public static void Validate_ZeroNegativeNaNInfiniteTooLargeDistance_AreRejected()
        {
            foreach (double d in new[] { 0.0, -300.0, double.NaN, double.PositiveInfinity, double.NegativeInfinity, PreChangeTolerance.LengthMm, PreChangeRequestRules.MaxDistanceMm + 1, 1e9 })
                Assert.NotNull(PreChangeRequestRules.Validate(Req(d, 1, 0)), "зай " + d + " татгалзагдах ёстой");
        }

        [Test]
        public static void Validate_JustAboveToleranceDistance_IsAccepted()
        {
            Assert.Null(PreChangeRequestRules.Validate(Req(PreChangeTolerance.LengthMm + 0.01, 1, 0)));
        }

        [Test]
        public static void Validate_ZeroOrTinyOrNaNDirection_IsRejected()
        {
            Assert.NotNull(PreChangeRequestRules.Validate(Req(300, 0, 0)));
            Assert.NotNull(PreChangeRequestRules.Validate(Req(300, 0.1, 0.1)));
            Assert.NotNull(PreChangeRequestRules.Validate(Req(300, double.NaN, 0)));
        }

        [Test]
        public static void Request_VectorMm_IsDirectionTimesDistance_WithZeroZ()
        {
            double[] v = Req(300, 0.6, -0.8).VectorMm;
            Assert.Near(180, v[0], 1e-9);
            Assert.Near(-240, v[1], 1e-9);
            Assert.Near(0, v[2], 0);
        }

        /* ------------------------------ Бусад жижиг загвар ------------------------------ */

        [Test]
        public static void Truth_Labels_AreDistinctPerState()
        {
            var labels = new[] { TruthState.Confirmed, TruthState.Review, TruthState.NotEvaluated, TruthState.Incomplete }.Select(Truth.Label).ToList();
            Assert.Eq(4, labels.Distinct().Count());
        }

        [Test]
        public static void PreChangeItem_CanShow_OnlyForRealNonGlobalElements()
        {
            Assert.True(new PreChangeItem { Id = 5, Kind = ImpactNodeKind.Room }.CanShow);
            Assert.False(new PreChangeItem { Id = 0, Kind = ImpactNodeKind.Room }.CanShow);
            Assert.False(new PreChangeItem { Id = 5, Kind = ImpactNodeKind.Global }.CanShow);
        }

        [Test]
        public static void RoomSnap_Label_FallsBackToId()
        {
            Assert.Eq("203 Оффис", new RoomSnap { Id = 1, Number = "203", Name = "Оффис" }.Label);
            Assert.Eq("Өрөө #7", new RoomSnap { Id = 7 }.Label);
        }
    }
}
