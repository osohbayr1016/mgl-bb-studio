using System.Collections.Generic;
using MglBb.Core;

namespace MglBb.Tests
{
    public static class GridOrderTests
    {
        private static List<KeyValuePair<double, string>> L(params object[] x)
        {
            var r = new List<KeyValuePair<double, string>>();
            for (int i = 0; i < x.Length; i += 2) r.Add(new KeyValuePair<double, string>((double)x[i], (string)x[i + 1]));
            return r;
        }

        [Test]
        public static void DescendingGridsFlipTheElevation()
        {
            // Зураг-1: FY3-ын дагуух дамнуруу баруунаас зүүн тийш зурсан → станц өсөхөд FX4, FX3, FX2, FX1.
            Assert.True(BbGridOrder.Reversed(L(0.0, "FX4", 6.0, "FX3", 12.0, "FX2", 18.0, "FX1")));
            Assert.False(BbGridOrder.Reversed(L(0.0, "FX1", 6.0, "FX2", 12.0, "FX3", 18.0, "FX4")));
        }

        [Test]
        public static void NaturalNamesAndCyrillicLetters()
        {
            Assert.True(BbGridOrder.Compare("FX2", "FX10") < 0);
            Assert.True(BbGridOrder.Compare("Y3'", "Y3") > 0, "Y3' нь Y3-ын дараа");
            Assert.True(BbGridOrder.Compare("А", "Б") < 0);
            Assert.False(BbGridOrder.Reversed(L(0.0, "А", 5.0, "Б", 9.0, "В")));
            Assert.True(BbGridOrder.Reversed(L(0.0, "10", 5.0, "9", 9.0, "2")));
        }

        [Test]
        public static void UserPicksAscendingOrDescending()
        {
            var drawnDesc = L(0.0, "FX4", 6.0, "FX3", 12.0, "FX1");
            Assert.True(BbGridOrder.Flip(drawnDesc, 1), "өсөх сонгосон → эргүүлнэ");
            Assert.False(BbGridOrder.Flip(drawnDesc, -1), "буурах сонгосон → хэвээр");
            Assert.True(BbGridOrder.Flip(L(0.0, "FX1", 6.0, "FX2"), -1));
            Assert.False(BbGridOrder.Flip(drawnDesc, 0), "0 = зурсан чиглэлээр");
            Assert.False(BbGridOrder.Flip(L(3.0, "FX2"), -1), "нэг тэнхлэг → тодорхойгүй");
        }

        [Test]
        public static void OneOrNoGridKeepsDrawnDirection()
        {
            Assert.False(BbGridOrder.Reversed(L(3.0, "FX2")));
            Assert.False(BbGridOrder.Reversed(L()));
        }
    }
}
