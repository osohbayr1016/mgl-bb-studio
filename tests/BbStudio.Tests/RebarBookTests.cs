using System;
using System.Collections.Generic;
using System.IO;
using MglBb.Core;

namespace MglBb.Tests
{
    public static class RebarBookTests
    {
        [Test]
        public static void SpecTextVariants()
        {
            BbBarSpec s;
            Assert.True(BbBarSpecs.TryParse("6Ø25", out s));
            Assert.Eq("6Ø25", s.ToString());
            Assert.True(BbBarSpecs.TryParse(" 4ф16 ", out s));
            Assert.Eq(16, s.D);
            Assert.True(BbBarSpecs.TryParse("2x12", out s));
            Assert.True(BbBarSpecs.TryParse("—", out s));
            Assert.False(s.Any);
            Assert.False(BbBarSpecs.TryParse("6Ø23", out s), "стандарт биш диаметр");
            Assert.False(BbBarSpecs.TryParse("зургаа", out s));
        }

        [Test]
        public static void RowOverridesCompanyDefaults()
        {
            var book = new BbRebarBook { Concrete = "B30" };
            BbRebarRow row = book.Row("ДН-8");
            row.Top = "6Ø28";
            row.AddTop = "2Ø28";
            row.Bottom = "буруу";
            row.S2 = 150;
            var errors = new List<string>();
            BbBeamPreset p = book.Preset(row, 600, errors);
            Assert.Eq("6Ø28", p.Top.ToString());
            Assert.Eq("2Ø28", p.AddTop.ToString());
            Assert.Eq("6Ø25", p.Bottom.ToString(), "буруу бичвэр → анхдагч");
            Assert.Near(150, p.S2, 1e-9);
            Assert.Near(52, p.CoverTop, 1e-9);
            Assert.Eq("B30", p.Concrete);
            Assert.Eq(1, errors.Count);

            // «Энгийн каркас» = ЖИШЭЭ-4: тулгуурын дээд + голын Ø12 (давхцал голынх талд), компанийн 52 биш.
            book.Company = false;
            BbBeamPreset o = book.Preset(row, 600);
            Assert.True(o.SupportTop && o.SpanTopLapInside);
            Assert.Eq("6Ø28", o.Top.ToString());
            Assert.Near(0, o.CoverTop, 1e-9);
        }

        [Test]
        public static void BookRoundTrips()
        {
            var book = new BbRebarBook { Company = false, Steel = BbSteel.A400, ReplaceForeign = true };
            BbRebarRow r = book.Row("ДН-1");
            r.Top = "4Ø20";
            r.Enabled = false;
            r.AsTop = 1234;
            string path = Path.Combine(Path.GetTempPath(), "mglbb-tests", "rebar-book.json");
            book.Save(path);
            BbRebarBook b2 = BbRebarBook.Load(path);
            Assert.False(b2.Company);
            Assert.Eq(BbSteel.A400, b2.Steel);
            Assert.True(b2.ReplaceForeign);
            Assert.Eq("4Ø20", b2.Row("ДН-1").Top);
            Assert.False(b2.Row("ДН-1").Enabled);
            Assert.Near(1234, b2.Row("ДН-1").AsTop, 1e-9);
            Assert.Eq("a_b", BbRebarBook.SafeName("a/b"));
        }

        [Test]
        public static void ColumnRowsParseAndRoundTrip()
        {
            int nb, nh, d;
            Assert.True(BbColumnRow.TryParse("4×4Ø20", out nb, out nh, out d));
            Assert.Eq(20, d);
            Assert.True(BbColumnRow.TryParse("5x3ф25", out nb, out nh, out d));
            Assert.Eq(5, nb);
            Assert.Eq(3, nh);
            Assert.False(BbColumnRow.TryParse("1×4Ø20", out nb, out nh, out d));

            var book = new BbRebarBook();
            book.Col("Б-5").Bars = "6×6Ø28";
            book.Col("Б-5").S = 150;
            BbColumnPreset p = book.ColumnPreset(book.Col("Б-5"), 600, 600);
            Assert.Eq(6, p.Nb);
            Assert.Eq(28, p.D);
            Assert.Near(150, p.S, 1e-9);
            // Анхдагч компани (ЖИШЭЭ-1): 600 тал, нүүрээс 60 → 480 / 150 → 5 ширхэг.
            Assert.Eq(5, book.ColumnPreset(null, 600, 600).Nb);
            string path = Path.Combine(Path.GetTempPath(), "mglbb-tests", "rebar-book-col.json");
            book.Save(path);
            Assert.Eq("6×6Ø28", BbRebarBook.Load(path).Col("Б-5").Bars);
        }

        [Test]
        public static void LiraCsvAndSuggestion()
        {
            var errors = new List<string>();
            Dictionary<string, double[]> m = BbRebarBook.ParseLiraCsv("Марк;As дээд;As доод\nДН-8;29,4;18.2\nДН-8;31.0;12\nДН-9\tx\t1\n", errors);
            Assert.Near(3100, m["ДН-8"][0], 1e-6);
            Assert.Near(1820, m["ДН-8"][1], 1e-6);
            Assert.False(m.ContainsKey("ДН-9"));
            Assert.Eq(1, errors.Count);
            // b600, хамгаалах 32 + Ø8 → w = 520; As 3100: хязгааргүй бол 10Ø20 (хамгийн бага талбай), ≤ 6 ширхэг бол 4Ø32 (3217).
            Assert.Eq("10Ø20", BbRebarBook.Suggest(3100, 520, true));
            Assert.Eq("4Ø32", BbRebarBook.Suggest(3100, 520, true, 6));
            Assert.Eq("10Ø20", BbRebarBook.Suggest(3100, 520, true, 2), "хязгаарт багтахгүй → хязгааргүй");
            Assert.Eq("", BbRebarBook.Suggest(0, 520, true));
        }
    }
}
