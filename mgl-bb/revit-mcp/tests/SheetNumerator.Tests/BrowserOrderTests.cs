using System;
using System.Collections.Generic;
using System.Linq;
using RevitMcpAddin.SheetNumerator.Core;

namespace RevitMcpAddin.SheetNumerator.Tests
{
    /// <summary>
    /// Project Browser-ийн эрэмбийг БОДИТ Revit дээр хэмжсэн өгөгдлөөр барьсан тест.
    ///
    /// Арга (Revit 2027.2, build 27.2.0.39, 2026-10-01): scratch document-д хуудсыг ЗААСАН ДАРААЛЛААР үүсгээд, Project
    /// Browser-ийн «Sheets (all)»-ийг UI Automation-аар (Chromium-ийн accessibility tree) уншиж, Revit-ийн ӨӨРИЙН
    /// харуулсан дарааллыг авсан.  <c>Creation</c> = үүсгэсэн дараалал (= ElementId, DocumentIndex), <c>Revit</c> = Browser-т
    /// харагдсан дугаарын дараалал.  Нэр нь «T&lt;n&gt;» (үүсгэсний дарааллаар) эсвэл тэнцүү дугаарын нэр шийдэх туршилтад заасан.
    ///
    /// Тест нь оролтыг ХОЛИЖ (тогтмол seed) <see cref="SheetGroupingService.OrderByBrowser"/>-д өгч, Revit-ийн дарааллыг
    /// ЯГ давтана гэж шалгана.  ⚠️ Хэмжээгүй: ², ٣, １ зэрэг цифр шиг ASCII БИШ тэмдэгт агуулсан жагсаалтад Revit-ийн
    /// үр дүн тогтворгүй харагдсан (тэнд дүрэм тайлагдаагүй) — бодит дугаарт ховор тул тестэд ОРООГҮЙ.
    /// </summary>
    public static class BrowserOrderTests
    {
        private static IEnumerable<SheetSnapshot> Build(string[] creation, Func<int, string, string> nameOf = null)
        {
            var list = new List<SheetSnapshot>();
            for (int i = 0; i < creation.Length; i++)
            {
                string name = nameOf != null ? nameOf(i, creation[i]) : "T" + (i + 1);
                list.Add(Fx.Sheet(1000 + i, creation[i], name));
            }
            return list;
        }

        private static string[] Order(IEnumerable<SheetSnapshot> sheets)
        {
            // Тогтмол «холилт»: оролтын дараалал үр дүнд нөлөөлөхгүйг шалгана.
            var rnd = new Random(20261001);
            List<SheetSnapshot> shuffled = sheets.OrderBy(_ => rnd.Next()).ToList();
            return SheetGroupingService.OrderByBrowser(shuffled, false).Select(s => s.Number).ToArray();
        }

        private static void Check(string[] creation, string[] revit, Func<int, string, string> nameOf = null)
        {
            Assert.Eq(creation.Length, revit.Length, "хэмжсэн дарааллын урт үүсгэснээс ялгаатай (тестийн өгөгдөл)");
            Assert.SeqEq(revit, Order(Build(creation, nameOf)));
        }

        // ── 1. Анхны хэмжилт: тоо, угтвар, том/жижиг, ASCII/латин-1/кирилл ──
        [Test]
        public static void Measured_FirstBattery()
        {
            Check(
                new[] { "1", "2", "10", "20", "01", "001", "A-1", "A-2", "A-10", "A-20", "A-02", "A-002", "a-3", "B-1", "A1", "A2", "A10", "Z", "_x", "A 3",
                    "A-3a", "A-3B", "ä1", "Б-1", "Ж2", "A-1.5", "A-1.10", "A.1", "A_1" },
                new[] { "1", "01", "001", "2", "10", "20", "_x", "A1", "A2", "A10", "A 3", "A-1", "A-1.5", "A-1.10", "A-2", "A-02", "A-002", "a-3",
                    "A-3a", "A-3B", "A-10", "A-20", "A.1", "A_1", "B-1", "Z", "ä1", "Б-1", "Ж2" },
                (i, n) => "T " + n);
        }

        // ── 2. «A» + тэмдэгт + «1»: угтвар болох богино бичвэр түрүүлнэ ─────
        [Test]
        public static void Measured_SecondPositionPunctuation()
        {
            Check(
                new[] { "A 1", "A!1", "A\"1", "A#1", "A$1", "A%1", "A&1", "A'1", "A(1", "A)1", "A*1", "A+1", "A,1", "A-1", "A.1", "A/1", "A=1", "A@1", "A^1", "A_1",
                    "A1", "AA1", "Aa2", "AB1", "Ab2" },
                new[] { "A1", "A 1", "A!1", "A\"1", "A#1", "A$1", "A%1", "A&1", "A'1", "A(1", "A)1", "A*1", "A+1", "A,1", "A-1", "A.1", "A/1", "A=1", "A@1", "A^1", "A_1",
                    "AA1", "Aa2", "AB1", "Ab2" });
        }

        // ── 3. Эхний байрлалд тэмдэгт ба тоо: код байрлалаар («/» < «1» < «=») ──
        [Test]
        public static void Measured_FirstPositionPunctuation()
        {
            Check(
                new[] { "!1", "#1", "$1", "%1", "&1", "'1", "(1", ")1", "*1", "+1", ",1", "-1", ".1", "/1", "=1", "@1", "^1", "_1", "a1", "B1", "1", "1a", "z1",
                    "É1", "é1", "Ä1", "\"1" },
                new[] { "!1", "\"1", "#1", "$1", "%1", "&1", "'1", "(1", ")1", "*1", "+1", ",1", "-1", ".1", "/1", "1", "1a", "=1", "@1", "^1", "_1", "a1", "B1", "z1",
                    "Ä1", "É1", "é1" });
        }

        // ── 4. Тоон хязгаарууд: тэргүүлэх тэг, олон түвшин, 20+ оронтой тоо ──
        [Test]
        public static void Measured_NumericEdgeCases()
        {
            Check(
                new[] { "A-02b", "A-2c", "A-2a", "A-02a", "A-2", "A-02", "A-002", "A-1.01", "A-1.1", "A-1.001", "A-09", "A-9", "A-9a", "A-10", "A-100", "A1b2", "A1b10", "A01b2",
                    "A-0", "A-00", "A-000", "A-99999999999999999999", "A-100000000000000000000", "A-18446744073709551615", "A-18446744073709551616",
                    "A-9223372036854775807", "A-9223372036854775808", "A-5-5", "A-5-10", "A-05-9" },
                new[] { "A1b2", "A01b2", "A1b10", "A-0", "A-00", "A-000", "A-1.01", "A-1.1", "A-1.001", "A-2", "A-02", "A-002", "A-2a", "A-02a", "A-02b", "A-2c",
                    "A-5-5", "A-05-9", "A-5-10", "A-09", "A-9", "A-9a", "A-10", "A-100", "A-9223372036854775807", "A-9223372036854775808",
                    "A-18446744073709551615", "A-18446744073709551616", "A-99999999999999999999", "A-100000000000000000000" });
        }

        // ── 5. Тэнцүү дугаарыг НЭР шийднэ (ElementId биш), 20+ оронтой тоо яг ──
        [Test]
        public static void Measured_EqualNumbers_AreOrderedByName_NotByCreation()
        {
            string[] numbers = { "A-002", "A-02", "A-2", "B-5", "B-05", "C-100000000000000000002", "C-100000000000000000001",
                "C-123456789012345678901234567891", "C-123456789012345678901234567890", "D-1", "d-01" };
            string[] names = { "Zeta", "Alpha", "Mid", "Zzz", "Aaa", "N1", "N2", "N3", "N4", "Second", "First" };
            Check(numbers,
                new[] { "A-02", "A-2", "A-002", "B-05", "B-5", "C-100000000000000000001", "C-100000000000000000002",
                    "C-123456789012345678901234567890", "C-123456789012345678901234567891", "d-01", "D-1" },
                (i, n) => names[i]);
        }

        // ── 6. Нэрийн тэнцүү шийдэл: «байгалийн», том/жижиг үл ялгана, бүр тэнцүү бол үүсгэсэн дараалал ──
        [Test]
        public static void Measured_NameTieBreak_IsNaturalCaseInsensitive_ThenCreationOrder()
        {
            string[] numbers = { "E-1", "E-01", "F-1", "F-01", "G-1", "G-01", "H-1", "H-01", "H-001" };
            string[] names = { "T10", "T2", "alpha", "Beta", "x", "X", "same", "same", "same" };
            Check(numbers,
                new[] { "E-01", "E-1", "F-1", "F-01", "G-1", "G-01", "H-1", "H-01", "H-001" },
                (i, n) => names[i]);
        }

        // ── 7. ASCII + кирилл (Монгол хэрэглээ): тоо түрүүлнэ, дараа нь ASCII, дараа нь кирилл том, кирилл жижиг ──
        [Test]
        public static void Measured_AsciiAndCyrillic()
        {
            Check(
                new[] { "9", "10", "A-1", "a-2", "B-1", "АР-01", "АР-2", "ар-3", "Б-1", "Я1", "А1", "1-А", "Z9" },
                new[] { "1-А", "9", "10", "A-1", "a-2", "B-1", "Z9", "А1", "АР-01", "АР-2", "Б-1", "Я1", "ар-3" });
        }

        [Test]
        public static void Measured_NumbersBeforeLetters_WhenOnlyAscii()
        {
            Check(new[] { "ae6", "i1", "I2", "9", "10" }, new[] { "9", "10", "ae6", "i1", "I2" });
        }

        // ── Descending: ДАРААЛАЛ эргэнэ (Browser-ийн «Descending»), тэнцүүг дахин нэр, ElementId шийднэ ──
        [Test]
        public static void Descending_ReversesTheKeyOrder()
        {
            List<SheetSnapshot> sheets = Build(new[] { "A-1", "A-2", "A-10" }).ToList();
            string[] desc = SheetGroupingService.OrderByBrowser(sheets, true).Select(s => s.Number).ToArray();
            Assert.SeqEq(new[] { "A-10", "A-2", "A-1" }, desc);
        }
    }
}
