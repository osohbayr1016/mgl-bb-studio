using System.Collections.Generic;
using System.Linq;
using MglBb.Core;

namespace MglBb.Tests
{
    public static class DimLinesTests
    {
        private static BbDimCand F(string owner, string cat, double at) { return new BbDimCand { Owner = owner, Cat = cat, Kind = BbDimCand.Face, At = at }; }

        private static string Positions(List<BbDimCand> xs) { return string.Join(" ", xs.Select(x => x.At.ToString(System.Globalization.CultureInfo.InvariantCulture))); }

        [Test]
        public static void PickHonoursEdgesAndCenterPerCategory()
        {
            const string col = "OST_StructuralColumns", wall = "OST_Walls";
            var cands = new List<BbDimCand>
            {
                F("c1", col, 1), F("c1", col, 1.5), F("c1", col, 3),
                new BbDimCand { Owner = "c1", Cat = col, Kind = BbDimCand.Center, At = 2 },
                F("w1", wall, 10), F("w1", wall, 10.2), F("w1", wall, 10.5),
                new BbDimCand { Owner = "g1", Cat = "OST_Grids", Kind = BbDimCand.Single, At = 2.0005 },
            };
            var cfg = new BbDimConfig { Cats = { new BbDimCat { Key = col, Edges = true }, new BbDimCat { Key = wall } } };
            Assert.Eq("1 2.0005 3 10 10.2 10.5", Positions(BbDimLines.Pick(cands, cfg, 0.003)), "баганын захын нүүр, ханын бүх нүүр, тэнхлэг");

            cfg.Cats[0].Center = true;
            List<BbDimCand> r = BbDimLines.Pick(cands, cfg, 0.003);
            Assert.Eq("1 2.0005 3 10 10.2 10.5", Positions(r), "төв ба тэнхлэг давхцвал нэг");
            Assert.Eq(BbDimCand.Single, r[1].Kind, "давхцалд тэнхлэг давуу");

            cfg.Cats[0].Edges = false;
            Assert.Eq("2.0005 10 10.2 10.5", Positions(BbDimLines.Pick(cands, cfg, 0.003)), "зөвхөн төв");

            cands.RemoveAll(c => c.Kind == BbDimCand.Center);
            Assert.Eq("1 2.0005 3 10 10.2 10.5", Positions(BbDimLines.Pick(cands, cfg, 0.003)), "төв олдоогүй бол захын нүүр");
        }

        [Test]
        public static void DimLinesRoundTripAndDropUnknownCategories()
        {
            BbDimLines b = BbDimLines.Default();
            Assert.Eq("Багана", b.Current);
            Assert.Eq("«тэнхлэг + багана» нэртэй тохиргоо аль хэдийн бий.", b.NameProblem("тэнхлэг + багана"));
            b.Configs.Add(new BbDimConfig
            {
                Name = "Тест",
                Cats = { new BbDimCat { Key = "OST_Grids", Edges = true, Center = true }, new BbDimCat { Key = "OST_Nothing" }, new BbDimCat { Key = "OST_Walls", Center = true } },
            });
            b.Preview = true;
            b.WorkCycle = false;
            b.DimType = "Арматур хэмжээ - 2.5";

            BbDimLines back = BbDimLines.FromJson(BbJson.Parse(BbJson.Write(b.ToJson())));
            Assert.Eq(3, back.Configs.Count);
            Assert.True(back.Preview && !back.WorkCycle && back.Snap);
            Assert.Eq("Арматур хэмжээ - 2.5", back.DimType);
            BbDimConfig t = back.Find("ТЕСТ");
            Assert.Eq(2, t.Cats.Count, "мэдэгдэхгүй ангилал хаягдана");
            Assert.False(t.Find("OST_Grids").Edges || t.Find("OST_Grids").Center, "тэнхлэгт сонголт байхгүй");
            Assert.False(t.Find("OST_Walls").Center, "хананд «төвөөр» байхгүй");
            Assert.True(back.Find("Тэнхлэг + багана").Find("OST_StructuralColumns").Center);
            Assert.True(BbDimLines.Catalog.Select(c => c.Key).Distinct().Count() == BbDimLines.Catalog.Length, "каталогт давхардал алга");
        }
    }
}
