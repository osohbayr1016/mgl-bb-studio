using System.Collections.Generic;
using MglBb.Core;

namespace MglBb.Tests
{
    public static class ParamFilterTests
    {
        [Test]
        public static void TextAndNumberOperators()
        {
            Assert.True(BbParamFilter.Match("ДН-11", BbParamFilter.Eq, "дн-11"), "том/жижиг үсэг");
            Assert.True(BbParamFilter.Match("300 mm", BbParamFilter.Eq, "300"), "нэгжгүй тоо");
            Assert.False(BbParamFilter.Match("B30", BbParamFilter.Eq, "C30"));
            Assert.True(BbParamFilter.Match("Рамын арматурчлал", BbParamFilter.Contains, "арматур"));
            Assert.True(BbParamFilter.Match("⌀28", BbParamFilter.Ge, "25"));
            Assert.False(BbParamFilter.Match("⌀12", BbParamFilter.Gt, "16"));
            Assert.True(BbParamFilter.Match("1,5 m", BbParamFilter.Lt, "2"));
            Assert.True(BbParamFilter.Match("", BbParamFilter.Empty, null));
            Assert.True(BbParamFilter.Match(null, BbParamFilter.Empty, null), "параметр байхгүй = хоосон");
            Assert.False(BbParamFilter.Match("abc", BbParamFilter.Gt, "1"), "тоогүй утга тоон үйлдэлд таарахгүй");
        }

        [Test]
        public static void AllRulesMustMatch()
        {
            var v = new Dictionary<string, string> { ["Mark"] = "ДН-11", ["Bar Diameter (төрөл)"] = "28 mm", ["Quantity"] = "6" };
            var rules = new[]
            {
                new BbParamRule { Param = "Bar Diameter (төрөл)", Op = BbParamFilter.Ge, Value = "25" },
                new BbParamRule { Param = "Quantity", Op = BbParamFilter.Gt, Value = "4" },
                new BbParamRule(),   // хоосон нөхцөл — алгасна
            };
            Assert.True(BbParamFilter.MatchAll(v, rules));
            rules[1].Value = "6";
            Assert.False(BbParamFilter.MatchAll(v, rules));
        }
    }
}
