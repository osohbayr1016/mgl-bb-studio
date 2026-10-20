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
