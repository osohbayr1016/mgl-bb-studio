using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using MglBb.Core;

namespace MglBb.Tests
{
    public static class IoTests
    {
        private static string Tmp(string name)
        {
            string d = Path.Combine(Path.GetTempPath(), "mglbb-tests");
            Directory.CreateDirectory(d);
            return Path.Combine(d, name);
        }

        [Test]
        public static void JsonRoundTrip()
        {
            var o = new Dictionary<string, object>
            {
                ["name"] = "ДН-1 «S1»\n\"x\"",
                ["n"] = 12.5,
                ["b"] = true,
                ["list"] = new List<object> { 1.0, "a", null, new Dictionary<string, object> { ["k"] = -3.0 } },
            };
            string s = BbJson.Write(o);
            object back = BbJson.Parse(s);
            Assert.Eq("ДН-1 «S1»\n\"x\"", BbJson.Str(back, "name"));
            Assert.Near(12.5, BbJson.Num(back, "n", 0), 1e-9);
            Assert.True(BbJson.Bool(back, "b", false));
            var list = BbJson.Arr(back, "list");
            Assert.Eq(4, list.Count);
            Assert.Near(-3, BbJson.Num(list[3], "k", 0), 1e-9);
            Assert.Eq("{\"a\":[1, 2]}", BbJson.Write(new Dictionary<string, object> { ["a"] = new List<object> { 1.0, 2.0 } }, false).Replace(", ", ", "));
        }

        [Test]
        public static void JsonParsesUnicodeEscapes()
        {
            object v = BbJson.Parse("{\"t\":\"\\u0414\\u041d-1\",\"e\":1e3,\"z\":[]}");
            Assert.Eq("ДН-1", BbJson.Str(v, "t"));
            Assert.Near(1000, BbJson.Num(v, "e", 0), 1e-9);
            Assert.Eq(0, BbJson.Arr(v, "z").Count);
        }

        [Test]
        public static void XlsxRoundTrip()
        {
            string p = Tmp("rt.xlsx");
            var sh = new BbXlsx.Sheet { Name = "Асуудал/Шийдэл" };
            sh.Header.AddRange(new[] { "A", "B", "C" });
            sh.Rows.Add(new List<string> { "1", "ДН-2 <tag> & \"x\"", "" });
            sh.Rows.Add(new List<string> { "2", "мөр1\nмөр2", "z" });
            sh.Choices[2] = new[] { "Шийдэх", "Шийдсэн" };
            BbXlsx.Write(p, new List<BbXlsx.Sheet> { sh });
            var back = BbXlsx.Read(p);
            Assert.Eq(1, back.Count);
            Assert.Eq("Асуудал_Шийдэл", back[0].Key);
            var rows = back[0].Value;
            Assert.Eq(3, rows.Count);
            Assert.Eq("ДН-2 <tag> & \"x\"", rows[1][1]);
            Assert.Eq("мөр1\nмөр2", rows[2][1]);
            Assert.Eq("z", rows[2][2]);
        }

        [Test]
        public static void ColumnNames()
        {
            Assert.Eq("A", BbXlsx.ColName(0));
            Assert.Eq("Z", BbXlsx.ColName(25));
            Assert.Eq("AA", BbXlsx.ColName(26));
            Assert.Eq(27, BbXlsx.ColIndex("AB12", -1));
            Assert.Eq(5, BbXlsx.ColIndex(null, 5));
        }

        [Test]
        public static void IssueBookKeepsEngineerColumns()
        {
            string p = Tmp("issues.xlsx");
            if (File.Exists(p)) File.Delete(p);
            var t0 = new DateTime(2026, 10, 19, 10, 0, 0);
            BbIssueBook.Merge(p, new[]
            {
                new BbIssue { Tool = "Ажлын зураг", Member = "ДН-1", Problem = "S3 огтлол үүссэнгүй", Key = "gen|ДН-1|S3", Severity = BbSeverity.Error },
                new BbIssue { Tool = "Ажлын зураг", Member = "ДН-2", Problem = "OK", Key = "gen|ДН-2|ok", Severity = BbSeverity.Info },
            }, t0);
            // Инженер бөглөнө.
            var rows = BbIssueBook.Load(p);
            Assert.Eq(2, rows.Count);
            Assert.Eq("Шийдэх", rows[0].Value.Status);
            Assert.Eq("", rows[1].Value.Status);
            rows[0].Value.Decision = "S3 хэрэггүй";
            rows[0].Value.Status = "Хамаагүй";
            BbIssueBook.Save(p, rows);
            // Дахин ажиллуулахад ижил түлхүүр — инженерийн багана хадгалагдана, шинэ асуудал нэмэгдэнэ.
            int n = BbIssueBook.Merge(p, new[]
            {
                new BbIssue { Tool = "Ажлын зураг", Member = "ДН-1", Problem = "S3 огтлол дахин үүссэнгүй", Key = "gen|ДН-1|S3", Severity = BbSeverity.Error },
                new BbIssue { Tool = "Ажлын зураг", Member = "ДН-3", Problem = "Шинэ", Key = "gen|ДН-3|x", Severity = BbSeverity.Warning },
            }, t0.AddHours(1));
            Assert.Eq(3, n);
            rows = BbIssueBook.Load(p);
            BbIssue first = rows[0].Value;
            Assert.Eq("S3 огтлол дахин үүссэнгүй", first.Problem);
            Assert.Eq("S3 хэрэггүй", first.Decision);
            Assert.Eq("Хамаагүй", first.Status);
            Assert.Eq("2026-10-19 11:00", rows[0].Key);
            Assert.Eq(BbSeverity.Warning, rows[2].Value.Severity);
        }
    }
}
