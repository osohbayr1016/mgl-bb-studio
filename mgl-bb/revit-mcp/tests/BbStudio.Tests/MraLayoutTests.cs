using System.Collections.Generic;
using System.Linq;
using MglBb.Core;

namespace MglBb.Tests
{
    /// <summary>
    /// Компанийн (ЖИШЭЭ-1) хомутын MRA-ийн байрлал — ДН-1-ийн нэг хэсгийг (урт бүс | туслах дам нурууны 2 богино бүс | урт бүс) загварчилна.
    /// Нэгж = «цаасны мм» (функц нэгжээс хамааралгүй).
    /// </summary>
    public static class MraLayoutTests
    {
        private static BbMraRules Rules()
        {
            return new BbMraRules { ShortMaxBars = 3, MidMaxBars = 7, GapFt = 4, PitchFt = 7, NearHeadFt = 5.4, FarHeadFt = 4.0, MidHeadFt = 6.7, ShortGapFt = 1.5, PairFt = 30, MinTagGapFt = 1.5, LongRel = 0.7, MidRel = 0.4 };
        }

        private static BbMraZone Z(long id, double u0, double u1, int n)
        {
            return new BbMraZone { Id = id, U0 = u0, U1 = u1, Count = n, DL = -2, DR = 6, DB = -1.2, DT = 1.3 };
        }

        [Test]
        public static void ShortNearRowLongFarRow()
        {
            var zs = new List<BbMraZone> { Z(1, 0, 36, 20), Z(2, 38.5, 39.5, 3), Z(3, 48.5, 49.5, 3), Z(4, 53, 61, 6), Z(5, 70, 106, 20) };
            BbMraLayout.Plan(zs, 0, Rules());
            BbMraZone l1 = zs[0], s1 = zs[1], s2 = zs[2], m = zs[3];
            Assert.True(s1.NearRow && s2.NearRow, "богино = ойр эгнээ");
            Assert.False(l1.NearRow || m.NearRow, "урт/дунд = хол эгнээ");
            Assert.Near(s1.LineV - 7, l1.LineV, 1e-9, "хол эгнээ = ойр − алхам");
            Assert.True(s1.LineV < 0 && s1.HeadV + s1.DT <= -4 + 1e-9, "ойр эгнээний бичвэр сүүлийн эгнээнээс gap-аар доор");
            Assert.True(l1.HeadV > l1.LineV && s1.HeadV > s1.LineV, "толгой шугамаас гишүүн рүү (шугам хамгийн гадна)");
            Assert.True(l1.HeadV + l1.DT < s1.LineV, "урт бүсийн бичвэр ойр эгнээний шугамаас доор");
        }

        [Test]
        public static void ShortPairGoesApartAndLongRelative()
        {
            var zs = new List<BbMraZone> { Z(1, 0, 36, 20), Z(2, 38.5, 39.5, 3), Z(3, 48.5, 49.5, 3), Z(5, 70, 106, 20) };
            BbMraLayout.Plan(zs, 0, Rules());
            Assert.True(zs[1].TextR <= zs[1].U0 - 1.5 + 1e-9, "хосын зүүн нь зүүн тийш");
            Assert.True(zs[2].TextL >= zs[2].U1 + 1.5 - 1e-9, "хосын баруун нь баруун тийш");
            Assert.Near(0 + 36 * 0.7, zs[0].HeadU, 1e-9, "урт бүс: толгой 0.7 (хэмжээсийн бичвэрийн баруун талд)");
        }

        [Test]
        public static void LoneShortLeansToLong()
        {
            var zs = new List<BbMraZone> { Z(1, 0, 36, 20), Z(2, 60, 61, 3), Z(5, 70, 106, 20) };
            BbMraLayout.Plan(zs, 0, Rules());
            Assert.True(zs[1].TextL > zs[1].U1, "ганц богино бүс хамгийн ойр урт бүс рүү (баруун)");
        }

        [Test]
        public static void SingleRowWhenOnlyLong()
        {
            var zs = new List<BbMraZone> { Z(1, 0, 36, 20), Z(5, 70, 106, 20) };
            BbMraLayout.Plan(zs, -10, Rules());
            Assert.Near(zs[0].LineV, zs[1].LineV, 1e-9);
            Assert.Near(-10 - 4 - 4.0 - 1.3, zs[0].LineV, 1e-9);
        }

        [Test]
        public static void RareNamePatternIsNotLearned()
        {
            // ЖИШЭЭ-1 багана: 40 дэлгээсийн 7-д л «{mark} DA» — өгөгдмөл «БАГАНА {mark} АРМАТУРЧЛАЛ» хэвээр үлдэх ёстой.
            var s = new BbSamples();
            for (int i = 0; i < 40; i++) s.Num("column.ElevScale", 50);
            for (int i = 0; i < 7; i++) s.Str("column.ElevNamePattern", "{mark} DA");
            var std = new BbStandard();
            string before = std.Column.ElevNamePattern;
            s.ApplyTo(std, 3);
            Assert.Eq(before, std.Column.ElevNamePattern);
            for (int i = 0; i < 30; i++) s.Str("column.ElevNamePattern", "БАГАНА {mark} АРМАТУРЧЛАЛ");
            s.ApplyTo(std, 3);
            Assert.Eq("БАГАНА {mark} АРМАТУРЧЛАЛ", std.Column.ElevNamePattern);
        }

        [Test]
        public static void RowTextsNeverOverlap()
        {
            // Нягт богино бүсүүд — бичвэр давхцахгүй, хамгийн бага зай 1.5.
            var zs = new List<BbMraZone>();
            for (int i = 0; i < 8; i++) zs.Add(Z(i, i * 4, i * 4 + 1, 3));
            zs.Add(Z(99, 60, 100, 20));
            BbMraLayout.Plan(zs, 0, Rules());
            var near = zs.Where(z => z.NearRow).OrderBy(z => z.TextL).ToList();
            for (int i = 1; i < near.Count; i++) Assert.True(near[i].TextL >= near[i - 1].TextR + 1.5 - 1e-9, "давхцал " + i);
        }
    }
}
