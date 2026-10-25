using System.Collections.Generic;
using MglBb.Core;

namespace MglBb.Tests
{
    public static class MarkNamesTests
    {
        private static readonly string[] Patterns = { "ДАМНУРУУ {mark} АРМАТУРЧЛАЛ", "ТУСЛАХ ДАМНУРУУ {mark} АРМАТУРЧЛАЛ", "БАГАНА {mark} АРМАТУРЧЛАЛ", "ЦУТГАМАЛ ХАНА {mark} ХЭВ" };

        [Test]
        public static void ElevationNameGivesItsMark()
        {
            Assert.Eq("ДН-1", BbMarkNames.MarkOf("ДАМНУРУУ ДН-1 АРМАТУРЧЛАЛ", Patterns));
            Assert.Eq("ДН-1", BbMarkNames.MarkOf("ДАМНУРУУ ДН-1 АРМАТУРЧЛАЛ (2)", Patterns), "хэсгийн дагавар");
            Assert.Eq("ТД-3", BbMarkNames.MarkOf("ТУСЛАХ ДАМНУРУУ ТД-3 АРМАТУРЧЛАЛ", Patterns));
            Assert.Eq("ЦХ-1", BbMarkNames.MarkOf("ЦУТГАМАЛ ХАНА ЦХ-1 ХЭВ", Patterns));
            Assert.Eq(null, BbMarkNames.MarkOf("ДН-1 S1", Patterns), "огтлол дэлгээс биш");
            Assert.Eq(null, BbMarkNames.MarkOf("ДАМНУРУУ  АРМАТУРЧЛАЛ", Patterns), "тэмдэггүй");
            Assert.Eq("Б-5", BbMarkNames.MarkOf("Б-5 дэлгээс", new[] { "{mark} дэлгээс" }));
        }

        [Test]
        public static void OwnMarksByNameOrSheet()
        {
            var own = new HashSet<string> { "1-1" };
            Assert.True(BbMarkNames.IsOwn("ДН-1 S2", "ДН-1", own));
            Assert.False(BbMarkNames.IsOwn("ДН-12 S1", "ДН-1", own), "ДН-12 нь ДН-1 биш");
            Assert.False(BbMarkNames.IsOwn("Б-5 S1", "ДН-1", own), "баганын огтлол");
            Assert.True(BbMarkNames.IsOwn("1-1", "ДН-1", own), "ижил хуудсан дахь нэргүй огтлол");
            Assert.False(BbMarkNames.IsOwn("ДН-1 S2", "", null), "тэмдэггүй гишүүнд нэрээр тааруулахгүй");
        }
    }
}
