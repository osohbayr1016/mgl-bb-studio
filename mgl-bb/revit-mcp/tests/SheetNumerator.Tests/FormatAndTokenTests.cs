using System;
using System.Linq;
using RevitMcpAddin.SheetNumerator.Core;

namespace RevitMcpAddin.SheetNumerator.Tests
{
    /// <summary>Дугаарын формат + тоон хэсгийн задлал/өөрчлөлт.</summary>
    public static class FormatAndTokenTests
    {
        // ── Формат (эзний тодорхойлолт) ─────────────────────────────
        [Test]
        public static void Format_OneDigit_NoPadding()
        {
            Assert.Eq("1", NumberFormatting.Format(1, 1));
            Assert.Eq("1", NumberFormatting.Format(1, 0));
        }

        [Test]
        public static void Format_PadsToMinimumWidth()
        {
            Assert.Eq("01", NumberFormatting.Format(1, 2));
            Assert.Eq("004", NumberFormatting.Format(4, 3));
            Assert.Eq("009", NumberFormatting.Format(9, 3));
        }

        [Test]
        public static void Format_NeverTruncates()
        {
            Assert.Eq("1234", NumberFormatting.Format(1234, 3));
            Assert.Eq("999", NumberFormatting.Format(999, 2));
        }

        [Test]
        public static void Format_NegativeKeepsSignOutsideWidth()
        {
            Assert.Eq("-004", NumberFormatting.Format(-4, 3));
            Assert.Eq("-001", NumberFormatting.Format(-1, 3));
            Assert.Eq("-1234", NumberFormatting.Format(-1234, 3));
        }

        [Test]
        public static void Format_ZeroAndMinValue_DoNotOverflow()
        {
            Assert.Eq("000", NumberFormatting.Format(0, 3));
            Assert.Eq("-9223372036854775808", NumberFormatting.Format(long.MinValue, 1));
        }

        [Test]
        public static void TryAdd_Rejects_Overflow_And_OutOfRange()
        {
            long r;
            Assert.True(NumberFormatting.TryAdd(5, 6, out r));
            Assert.Eq(11L, r);
            Assert.False(NumberFormatting.TryAdd(long.MaxValue, 1, out r));
            Assert.False(NumberFormatting.TryAdd(NumberFormatting.MaxAbsValue, 1, out r));
            Assert.False(NumberFormatting.TryAddScaled(1, long.MaxValue, 5, out r));
        }

        [Test]
        public static void TryParse_AcceptsSign_RejectsGarbage()
        {
            long v;
            Assert.True(NumberFormatting.TryParse("+5", out v)); Assert.Eq(5L, v);
            Assert.True(NumberFormatting.TryParse(" -12 ", out v)); Assert.Eq(-12L, v);
            Assert.False(NumberFormatting.TryParse("1a", out v));
            Assert.False(NumberFormatting.TryParse("", out v));
            Assert.False(NumberFormatting.TryParse("-", out v));
            Assert.False(NumberFormatting.TryParse("9999999999999999", out v), "хязгаараас хэтэрсэн");
        }

        // ── Тоон хэсгийн задлал ─────────────────────────────────────
        [Test]
        public static void Tokens_SeparatorHyphenIsNotANegativeSign()
        {
            var t = NumericTokenParser.Parse("A-01");
            Assert.Eq(1, t.Count);
            Assert.False(t[0].HasSign);
            Assert.Eq(1L, t[0].Value);
            Assert.True(t[0].HasLeadingZeros);
        }

        [Test]
        public static void Tokens_LeadingHyphenAtStartIsNegative()
        {
            var t = NumericTokenParser.Parse("-001");
            Assert.Eq(1, t.Count);
            Assert.True(t[0].HasSign);
            Assert.Eq(-1L, t[0].Value);
            Assert.Eq(0, t[0].Index);
            Assert.Eq(4, t[0].Length);
        }

        [Test]
        public static void Tokens_MultipleTokens()
        {
            var t = NumericTokenParser.Parse("A-01-02");
            Assert.SeqEq(new long[] { 1, 2 }, t.Select(x => x.Value));
            t = NumericTokenParser.Parse("01-A");
            Assert.Eq(1, t.Count);
            t = NumericTokenParser.Parse("COVER");
            Assert.Eq(0, t.Count);
        }

        // ── Одоогийн дугаарын тоон хэсгийг өөрчлөх ───────────────────
        private static string Shift(string s, long delta, int idx = -1)
        {
            ShiftResult r = ExistingNumberShift.Shift(s, delta, idx);
            return r.Success ? r.Result : "ERR:" + r.Error;
        }

        [Test]
        public static void Shift_PreservesTextAroundToken()
        {
            Assert.Eq("A-003-АРХ", Shift("A-001-АРХ", 2));
            Assert.Eq("A-002", Shift("A-001", 1));
            Assert.Eq("A02", Shift("A01", 1));
            Assert.Eq("02-A", Shift("01-A", 1));
        }

        [Test]
        public static void Shift_PreservesLeadingZeroWidth_ExpandsNaturally()
        {
            Assert.Eq("A-1000", Shift("A-999", 1), "тэргүүлэх тэггүй 999 → 1000");
            Assert.Eq("A-99", Shift("A-100", -1), "тэргүүлэх тэггүй 100 → 99 (өргөн хадгалахгүй)");
            Assert.Eq("A-1000", Shift("A-0999", 1), "0999 + 1 = 1000 (өргөн 4 дээр яг багтана)");
            Assert.Eq("A-10000", Shift("A-9999", 1), "цифр нэмэгдэхэд таслахгүй");
            Assert.Eq("A-010", Shift("A-009", 1), "тэргүүлэх тэгтэй бол өргөн хадгална");
        }

        [Test]
        public static void Shift_CrossesZero()
        {
            Assert.Eq("-002", Shift("003", -5));
            Assert.Eq("-002", Shift("-001", -1));
            Assert.Eq("001", Shift("-001", 2));
            Assert.Eq("000", Shift("-001", 1));
            // Тусгаарлагч «-» хэвээр, хасах тэмдэг шинээр орно; эргэж уншихад яг ижил тоо.
            string s = Shift("A-001", -5);
            Assert.Eq("A--004", s);
            Assert.Eq(-4L, NumericTokenParser.Parse(s)[0].Value);
        }

        [Test]
        public static void Shift_ReportsMultipleTokens_UsesLastByDefault()
        {
            ShiftResult r = ExistingNumberShift.Shift("A-01-02", 1, -1);
            Assert.True(r.Success);
            Assert.True(r.MultipleTokens);
            Assert.Eq(2, r.TokenCount);
            Assert.Eq(1, r.UsedTokenIndex);
            Assert.Eq("A-01-03", r.Result);
        }

        [Test]
        public static void Shift_TokenSelection_FirstToken()
        {
            ShiftResult r = ExistingNumberShift.Shift("A-01-02", 1, 0);
            Assert.True(r.Success);
            Assert.Eq("A-02-02", r.Result);
        }

        [Test]
        public static void Shift_NoToken_IsError()
        {
            ShiftResult r = ExistingNumberShift.Shift("COVER", 1, -1);
            Assert.False(r.Success);
            Assert.Eq(ShiftError.NoNumericToken, r.Error);
        }

        [Test]
        public static void Shift_TokenIndexOutOfRange_IsError()
        {
            ShiftResult r = ExistingNumberShift.Shift("A-01", 1, 3);
            Assert.False(r.Success);
            Assert.Eq(ShiftError.TokenIndexOutOfRange, r.Error);
        }

        [Test]
        public static void Shift_TooLongToken_IsError_NotSilent()
        {
            ShiftResult r = ExistingNumberShift.Shift("A-123456789012345678901", 1, -1);
            Assert.False(r.Success);
            Assert.Eq(ShiftError.TokenTooLong, r.Error);
        }

        [Test]
        public static void Shift_Overflow_IsError()
        {
            ShiftResult r = ExistingNumberShift.Shift("A-999999999999999", 1, -1);
            Assert.False(r.Success);
            Assert.Eq(ShiftError.Overflow, r.Error);
        }

        [Test]
        public static void Shift_PreservesInvisibleMarkers()
        {
            Assert.Eq("A-02​", Shift("A-01​", 1));
        }
    }
}
