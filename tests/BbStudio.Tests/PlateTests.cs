using MglBb.Core;

namespace MglBb.Tests
{
    /// <summary>Хана/хучилтын стандарт, хуудасны цуврал — JSON ба сурах.</summary>
    public static class PlateTests
    {
        [Test]
        public static void PlateAndSeriesRoundTrip()
        {
            var std = new BbStandard();
            std.Plate.WallMraType = "(Поз)⌀Диаметр-Алхам";
            std.Plate.SlabScale = 100;
            std.Plate.WallElevMaxPaperMm = 300;
            std.Sheet.WallSheetPrefix = "6-";
            std.Sheet.SlabSheetParams = "* Classification=Ажлын зураг|* Type Designator=7 - ХУЧИЛТ";
            var back = BbStandard.FromJson(BbJson.Parse(BbJson.Write(std.ToJson())));
            Assert.Eq("(Поз)⌀Диаметр-Алхам", back.Plate.WallMraType);
            Assert.Eq(100, back.Plate.SlabScale);
            Assert.Near(300, back.Plate.WallElevMaxPaperMm, 1e-9);
            Assert.Eq("6-", back.Sheet.WallSheetPrefix);
            Assert.Eq("* Classification=Ажлын зураг|* Type Designator=7 - ХУЧИЛТ", back.Sheet.SlabSheetParams);
            Assert.Eq("ЦУТГАМАЛ ХАНА ЦХ-2 ОГТЛОЛ 3", back.Plate.WallName(back.Plate.WallSecName, "ЦХ-2", 3));
        }

        [Test]
        public static void OldStandardWithoutPlateKeepsDefaults()
        {
            // 0.1.0-ийн standard.json-д «plate» хэсэг байхгүй — өгөгдмөл (ЖИШЭЭ-1) утга.
            var std = new BbStandard();
            var json = std.ToJson();
            json.Remove("plate");
            var back = BbStandard.FromJson(BbJson.Parse(BbJson.Write(json)));
            Assert.Eq("4.4. Диафрагм ханын арматурчлал", back.Plate.WallRebarViewType);
            Assert.Eq(120, back.Plate.SlabScale);
            Assert.Eq("5-", back.Sheet.BeamSheetPrefix);
        }

        [Test]
        public static void FramePlanDefaultsMatchExample2()
        {
            // ЖИШЭЭ-2 3-1 «БАГАНА, ДАМНУРУУНЫ БАЙГУУЛАЛТ /-5.02/» (2026-10-22) — хуучин standard.json-д «Frame…» талбаргүй ч эдгээр утга.
            var json = new BbStandard().ToJson();
            ((System.Collections.Generic.Dictionary<string, object>)json["plate"]).Remove("FrameViewType");
            var std = BbStandard.FromJson(BbJson.Parse(BbJson.Write(json)));
            Assert.Eq("3.1. Рамын байгуулалт", std.Plate.FrameViewType);
            Assert.Eq("Байгуулалт-ББ Рамын байгуулалт", std.Plate.FrameTemplate);
            Assert.Eq("БАГАНА, ДАМНУРУУНЫ БАЙГУУЛАЛТ /-5.02/", std.Plate.FrameName.Replace("{level}", "-5.02"));
            Assert.Eq(100, std.Plate.FrameScale);
            Assert.Eq("MNS - TAG - COLUMN : Багана марк тэмдэглэгээ 4L", std.Plate.FrameColumnTagType);
            Assert.Eq("MNS - TAG - BEAM : В рамке", std.Plate.FrameBeamTagType);
            Assert.True(std.Plate.FrameBayChains);
            Assert.Eq("3-", std.Sheet.FrameSheetPrefix);
            Assert.Eq("* Classification=Ажлын зураг|* Sub-Discipline=Барилга бүтээц|* Type Designator=3 - РАМ", std.Sheet.FrameSheetParams);
            Assert.Eq("frame", BbStandard.KindKey(BbMemberKind.Frame));
        }

        [Test]
        public static void FrameViewTypeIgnoresNumberingButNeverFallsBackToFoundation()
        {
            // ББ инженер (2026-10-23): төсөлд «2.1.» алга үед «1.1. Суурийн байгуулалт»-аар үүсгэж байв — «3.1. Рамын байгуулалт» байх ёстой.
            var proj = new[] { "1.1. Суурийн байгуулалт", "2.1. Суурийн арматурчлал", "3.1 Рамын байгуулалт", "3.2. Рамын огтлол" };
            Assert.Eq("3.1 Рамын байгуулалт", BbCompanyRules.PickFrameViewType(proj, "2.1. Рамын байгуулалт"));
            // ЖИШЭЭ-2: «2.1.» дугаартай — үгээр олно.
            Assert.Eq("2.1. Рамын байгуулалт", BbCompanyRules.PickFrameViewType(new[] { "1.1. Суурийн байгуулалт", "2.1. Рамын байгуулалт", "2.3. Рамын Огтлол" }, BbCompanyRules.FrameViewType));
            // Сурсан нэр байвал түүнийг.
            Assert.Eq("Рам-Байгуулалт", BbCompanyRules.PickFrameViewType(new[] { "3.1. Рамын байгуулалт", "Рам-Байгуулалт" }, "Рам-Байгуулалт"));
            // Рамын төрөл огт алга — эхний төрлийг авахгүй.
            Assert.True(BbCompanyRules.PickFrameViewType(new[] { "1.1. Суурийн байгуулалт", "4.1.а. Хучилтын байгуулалт" }, "2.1. Рамын байгуулалт") == null);
        }

        [Test]
        public static void FramePlanRoundTripAndLearn()
        {
            var std = new BbStandard();
            std.Plate.FrameBayChains = false;
            std.Plate.FrameColumnDimPaperMm = 9.5;
            std.Sheet.FrameSheetPrefix = "3-";
            var back = BbStandard.FromJson(BbJson.Parse(BbJson.Write(std.ToJson())));
            Assert.False(back.Plate.FrameBayChains);
            Assert.Near(9.5, back.Plate.FrameColumnDimPaperMm, 1e-9);

            // Хэрэглэгчийн сонгосон нэг харагдацаас (minSamples 1) нэр, масштаб, маркийн төрөл.
            var s = new BbSamples();
            s.Str("plate.FrameName", "БАГАНА, ДАМНУРУУНЫ БАЙГУУЛАЛТ /{level}/");
            s.Num("plate.FrameScale", 150);
            s.Str("plate.FrameBeamTagType", "MNS - TAG - BEAM : В рамке 2");
            var learned = new BbStandard();
            s.ApplyTo(learned, 1);
            Assert.Eq(150, learned.Plate.FrameScale);
            Assert.Eq("MNS - TAG - BEAM : В рамке 2", learned.Plate.FrameBeamTagType);
        }

        [Test]
        public static void PlateFieldsAreLearned()
        {
            var s = new BbSamples();
            for (int i = 0; i < 5; i++) s.Str("plate.WallMraType", "(Поз)⌀Диаметр-Алхам");
            s.Str("plate.WallMraType", "(Поз) ⌀Диаметр");
            for (int i = 0; i < 4; i++) s.Num("plate.SlabScale", 100);
            for (int i = 0; i < 4; i++) s.Str("sheet.ColumnSheetPrefix", "4-");
            var std = new BbStandard();
            s.ApplyTo(std, 3);
            Assert.Eq("(Поз)⌀Диаметр-Алхам", std.Plate.WallMraType);
            Assert.Eq(100, std.Plate.SlabScale);
            Assert.Eq("4-", std.Sheet.ColumnSheetPrefix);
        }
    }
}
