using System.Linq;
using MglBb.Core;

namespace MglBb.Tests
{
    public static class FilterBookTests
    {
        [Test]
        public static void SavedFilterRoundTripsAndNamesStayUnique()
        {
            var book = new BbFilterBook();
            var f = new BbSavedFilter
            {
                Name = "B30 дамнуруу",
                Categories = { "OST_StructuralFraming", "OST_StructuralColumns" },
                ViewKinds = { BbFilterBook.Section },
                Rules = { new BbParamRule { Param = "Mark", Op = BbParamFilter.Contains, Value = "ДН" }, new BbParamRule() },
            };
            book.Filters.Add(f);
            Assert.Eq("«b30 дамнуруу» нэртэй шүүлтүүр аль хэдийн бий.", book.NameProblem("b30 дамнуруу"));
            Assert.Eq(null, book.NameProblem("B30 дамнуруу", f), "өөрийн нэрээ хадгалахад");
            Assert.Eq("Шүүлтүүр 1", book.FreeName("Шүүлтүүр"));

            BbFilterBook back = BbFilterBook.FromJson(BbJson.Parse(BbJson.Write(book.ToJson())));
            BbSavedFilter g = back.Find("B30 ДАМНУРУУ");
            Assert.Eq(2, g.Categories.Count);
            Assert.Eq(1, g.Rules.Count, "хоосон нөхцөл хадгалагдахгүй");
            Assert.Eq(BbParamFilter.Contains, g.Rules[0].Op);
            Assert.True(g.AppliesTo(BbFilterBook.Section));
            Assert.False(g.AppliesTo(BbFilterBook.Plan));
            Assert.False(g.AppliesTo(null), "загварын бус харагдац");
            Assert.True(new BbSavedFilter().AppliesTo(BbFilterBook.ThreeD), "төрөл заагаагүй = бүх харагдац");
            Assert.Eq("ДН", g.Copy("x").Rules.Single().Value);
        }
    }
}
