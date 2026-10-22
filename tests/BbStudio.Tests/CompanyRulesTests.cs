using System.Collections.Generic;
using MglBb.Core;

namespace MglBb.Tests
{
    public static class CompanyRulesTests
    {
        // Хэрэглэгчийн төсөлд байдаг Detail төрлүүд (эхнийх нь «7.6» — өмнө нь буруугаар сонгогддог байсан).
        private static readonly string[] Project =
        {
            "7.6 Хучилтын арматурчлал",
            "4.2 Рамын арматурчлал + Багана",
            "4.2.1 Рамын арматурчлал + Багана + ОГТЛОЛ",
            "5.2 Рамын арматурчлал + Дамнуруу",
            "5.2.1 Рамын арматурчлал + Дамнуруу Огтлол",
            "5.3 Рамын арматурчлал + Туслах Дамнуруу",
            "5.3.1 Рамын арматурчлал + Туслах Дамнуруу ОГТЛОЛ",
        };

        [Test]
        public static void ViewTypeByMemberKind()
        {
            BbStandard std = BbCompanyRules.Apply(new BbStandard());
            Assert.Eq("5.2 Рамын арматурчлал + Дамнуруу", BbCompanyRules.Pick(Project, BbCompanyRules.ElevViewTypes(BbMemberKind.Beam, std.Beam)));
            Assert.Eq("5.2.1 Рамын арматурчлал + Дамнуруу Огтлол", BbCompanyRules.Pick(Project, BbCompanyRules.SecViewTypes(BbMemberKind.Beam, std.Beam)));
            Assert.Eq("5.3 Рамын арматурчлал + Туслах Дамнуруу", BbCompanyRules.Pick(Project, BbCompanyRules.ElevViewTypes(BbMemberKind.BeamAux, std.BeamAux)));
            Assert.Eq("5.3.1 Рамын арматурчлал + Туслах Дамнуруу ОГТЛОЛ", BbCompanyRules.Pick(Project, BbCompanyRules.SecViewTypes(BbMemberKind.BeamAux, std.BeamAux)));
            Assert.Eq("4.2.1 Рамын арматурчлал + Багана + ОГТЛОЛ", BbCompanyRules.Pick(Project, BbCompanyRules.SecViewTypes(BbMemberKind.Column, std.Column)));
        }

        [Test]
        public static void RuleBeatsLearnedAndLearnedIsFallback()
        {
            var ms = new BbMemberStandard { ElevViewType = "2.4. Рамын арматурчлал + Дамнуруу" };
            List<string> want = BbCompanyRules.ElevViewTypes(BbMemberKind.Beam, ms);
            Assert.Eq("5.2 Рамын арматурчлал + Дамнуруу", BbCompanyRules.Pick(Project, want));
            // Компанийн нэр төсөлд алга — сурсан нэр (ЖИШЭЭ-1) нөөц.
            Assert.Eq("2.4. Рамын арматурчлал + Дамнуруу", BbCompanyRules.Pick(new[] { "7.6 Хучилтын арматурчлал", "2.4. Рамын арматурчлал + Дамнуруу" }, want));
            // Аль нь ч алга — null (дуудагч Асуудалд бичнэ, «7.6»-г чимээгүй авахгүй).
            Assert.Eq(null, BbCompanyRules.Pick(new[] { "7.6 Хучилтын арматурчлал" }, want));
        }

        [Test]
        public static void OtherNumberingFoundByWords()
        {
            // ЖИШЭЭ-2-ийн дугаарлалт (2.4. …) — «5.2.1 …» алга; үгээр олно, туслах дамнуруутай андуурахгүй, хучилтын «7.6»-г авахгүй.
            var ex2 = new[]
            {
                "7.6 Хучилтын арматурчлал",
                "4.4. Хучилтын арматурчлал",
                "2.4. Рамын арматурчлал + Дамнуруу",
                "2.4. Рамын арматурчлал + Дамнуруу ОГТЛОЛ",
                "2.4. Рамын арматурчлал + Туслах Дамнуруу ОГТЛОЛ",
            };
            Assert.Eq("2.4. Рамын арматурчлал + Дамнуруу ОГТЛОЛ",
                BbCompanyRules.Pick(ex2, BbCompanyRules.SecViewTypes(BbMemberKind.Beam, new BbMemberStandard { SecViewType = "4.4. Хучилтын арматурчлал" })));
            Assert.Eq("2.4. Рамын арматурчлал + Туслах Дамнуруу ОГТЛОЛ", BbCompanyRules.Pick(ex2, new[] { BbCompanyRules.BeamAuxSec }));
            Assert.Eq("2.4. Рамын арматурчлал + Дамнуруу", BbCompanyRules.Pick(ex2, new[] { BbCompanyRules.BeamElev }));
            Assert.Eq("521", BbCompanyRules.Code("5.2.1 Рамын арматурчлал"));
        }

        [Test]
        public static void LooseNameMatch()
        {
            // Том/жижиг үсэг, зай, цэг: «5.2.1. … +Дамнуруу ОГТЛОЛ» = «5.2.1 … + Дамнуруу Огтлол».
            Assert.Eq("5.2.1. Рамын арматурчлал +Дамнуруу ОГТЛОЛ",
                BbCompanyRules.Pick(new[] { "5.2.1. Рамын арматурчлал +Дамнуруу ОГТЛОЛ" }, new[] { BbCompanyRules.BeamSec }));
            // «5.2» нь «5.2.1»-тэй андуурагдахгүй.
            Assert.Eq(null, BbCompanyRules.Pick(new[] { "5.2.1 Рамын арматурчлал + Дамнуруу Огтлол" }, new[] { BbCompanyRules.BeamElev }));
        }

        [Test]
        public static void ColumnsGetDimsAndMraButNoRebarTags()
        {
            BbStandard std = BbCompanyRules.Apply(new BbStandard());
            Assert.False(std.Column.ElevTagBars);
            Assert.False(std.Column.SecTagLong);
            Assert.False(std.Column.SecTagStirrups);
            Assert.True(std.Column.ElevMra, "MRA хэвээр");
            Assert.True(std.Column.SecDims, "огтлолын хэмжээс хэвээр");
            Assert.True(std.Beam.ElevTagBars, "дамнуруунд шошго хэвээр");
            Assert.True(std.Beam.SecTagLong);
        }

        [Test]
        public static void BeamSectionCropTopBottomEqualsSides()
        {
            var std = new BbStandard();
            std.Beam.SecCropSideMm = 194.5; std.Beam.SecCropBelowMm = 502; std.Beam.SecCropAboveMm = 500;   // ЖИШЭЭ-2-оос сурсан (давталт)
            BbCompanyRules.Apply(std);
            Assert.Near(194.5, std.Beam.SecCropBelowMm, 1e-9);
            Assert.Near(194.5, std.Beam.SecCropAboveMm, 1e-9);
            Assert.Near(std.BeamAux.SecCropSideMm, std.BeamAux.SecCropAboveMm, 1e-9);
        }

        [Test]
        public static void RequiredSchedules()
        {
            Assert.True(BbCompanyRules.IsRequiredSchedule("201.ББ.РАМ.АРМАТУР {mark}"));
            Assert.True(BbCompanyRules.IsRequiredSchedule("204.ББ.РАМ.БЕТОН {mark}"));
            Assert.True(BbCompanyRules.IsRequiredSchedule("202.ББ.РАМ.Арматурын нэгдсэн түүвэр {mark}"));
            Assert.True(BbCompanyRules.IsRequiredSchedule("205.ББ.РАМ. ХЭСГИЙН ТОДОРХОЙЛОЛТ {mark}"));
            Assert.False(BbCompanyRules.IsRequiredSchedule("210.ББ.ХУДАЛДАН АВАЛТ {mark}"));
        }

        [Test]
        public static void StirrupDimsFromInnerEdgeEvenIfLearnedOuter()
        {
            var std = new BbStandard();
            std.Beam.StirrupRef = "outer"; std.Beam.SecBarChain = true;
            std.Column.StirrupRef = "center";
            BbCompanyRules.Apply(std);
            foreach (BbMemberStandard ms in new[] { std.Beam, std.BeamAux, std.Column })
            {
                Assert.Eq("inner", ms.StirrupRef);
                Assert.False(ms.SecBarChain);
                Assert.True(ms.SecTagsLeft);
            }
        }
    }
}
