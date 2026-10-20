using System;
using System.Collections.Generic;

namespace RevitMcpAddin.SheetNumerator.Core
{
    /// <summary>Дугаар доторх нэг «тоон хэсэг» (ASCII цифрийн залгаа).</summary>
    public sealed class NumericToken
    {
        /// <summary>Хэсгийн эхний тэмдэгтийн индекс (хасах тэмдэгтэй бол тэр тэмдэг).</summary>
        public int Index { get; set; }

        /// <summary>Хасах тэмдэг (байвал) ба цифрүүдийн нийт урт.</summary>
        public int Length { get; set; }

        public int DigitStart { get; set; }
        public int DigitLength { get; set; }

        /// <summary>«-» нь сөрөг тэмдэг гэж тооцогдсон.</summary>
        public bool HasSign { get; set; }

        /// <summary>«001» шиг тэргүүлэх тэгтэй (урт &gt; 1, эхний цифр 0).  Ийм үед өргөн хадгалагдана.</summary>
        public bool HasLeadingZeros { get; set; }

        /// <summary>Тэмдэгтэй утга.  <see cref="TooLong"/> үед утга БУС.</summary>
        public long Value { get; set; }

        /// <summary>Цифр 17-оос урт — long-д найдвартай багтахгүй.</summary>
        public bool TooLong { get; set; }
    }

    public static class NumericTokenParser
    {
        public const int MaxDigits = 17;

        /// <summary>
        /// Дугаарын БҮХ тоон хэсгийг зүүнээс баруун тийш олно.
        ///
        /// ⚠️ ХАСАХ ТЭМДЭГ: «A-01» дахь «-» нь тусгаарлагч, сөрөг тэмдэг БИШ.  Дүрэм: «-» нь цифрийн яг өмнө,
        /// ба (мөрийн эхэнд эсвэл өмнөх тэмдэгт нь үсэг/цифр БИШ) үед л сөрөг тэмдэг.
        ///   «A-01»   → [01]           «01-02» → [01][02]       «-001» → [-001]
        ///   «A--004» → [-004] (гурав дахь «-» нь тусгаарлагч, хоёр дахь нь тэмдэг — ShiftOut-тай ЯГ эргэлттэй)
        /// </summary>
        public static IReadOnlyList<NumericToken> Parse(string s)
        {
            var list = new List<NumericToken>();
            if (string.IsNullOrEmpty(s))
                return list;

            int i = 0;
            int n = s.Length;
            while (i < n)
            {
                if (!IsDigit(s[i]))
                {
                    i++;
                    continue;
                }

                int j = i;
                while (j < n && IsDigit(s[j]))
                    j++;

                int digitLen = j - i;
                bool negative = i > 0 && s[i - 1] == '-' && (i - 1 == 0 || !char.IsLetterOrDigit(s[i - 2]));

                var tok = new NumericToken
                {
                    DigitStart = i,
                    DigitLength = digitLen,
                    HasSign = negative,
                    Index = negative ? i - 1 : i,
                    Length = digitLen + (negative ? 1 : 0),
                    HasLeadingZeros = digitLen > 1 && s[i] == '0',
                    TooLong = digitLen > MaxDigits,
                };
                if (!tok.TooLong)
                {
                    long v = 0;
                    for (int k = i; k < j; k++)
                        v = v * 10 + (s[k] - '0');
                    tok.Value = negative ? -v : v;
                }
                list.Add(tok);
                i = j;
            }
            return list;
        }

        private static bool IsDigit(char c)
        {
            return c >= '0' && c <= '9';
        }
    }

    public enum ShiftError
    {
        None = 0,
        NoNumericToken,
        TokenIndexOutOfRange,
        TokenTooLong,
        Overflow,
    }

    public sealed class ShiftResult
    {
        public bool Success { get; set; }
        public string Result { get; set; }
        public ShiftError Error { get; set; }

        /// <summary>Дугаарт олдсон тоон хэсгийн тоо.</summary>
        public int TokenCount { get; set; }

        /// <summary>Ашигласан хэсгийн индекс (0-ээс).</summary>
        public int UsedTokenIndex { get; set; }

        /// <summary>Нэгээс олон хэсэгтэй — аль хэсгийг ашигласныг ИЛ харуулах ёстой.</summary>
        public bool MultipleTokens { get; set; }

        /// <summary>Хэсэг эерэг байснаа сөрөг болсон (тэгийг давсан).</summary>
        public bool BecameNegative { get; set; }
    }

    /// <summary>
    /// «Одоогийн дугаарын тоон хэсгийг өөрчлөх» (Өсгөх / Бууруулах): тоон хэсгийн өмнөх, хойшхи бичвэрийг
    /// ХЭЗЭЭ Ч хөндөхгүй, зөвхөн сонгосон тоон хэсгийг ± delta-аар солино.
    /// </summary>
    public static class ExistingNumberShift
    {
        /// <summary>«Сүүлийн хэсэг» (өгөгдмөл).</summary>
        public const int LastToken = -1;

        /// <param name="existing">Одоогийн дугаар.</param>
        /// <param name="delta">Тэмдэгтэй өөрчлөлт (+2, -3).</param>
        /// <param name="tokenIndex">-1 = сүүлийн хэсэг, 0.. = зүүнээс тоолсон хэсэг.</param>
        public static ShiftResult Shift(string existing, long delta, int tokenIndex)
        {
            IReadOnlyList<NumericToken> tokens = NumericTokenParser.Parse(existing);
            var res = new ShiftResult { TokenCount = tokens.Count, MultipleTokens = tokens.Count > 1 };

            if (tokens.Count == 0)
            {
                res.Error = ShiftError.NoNumericToken;
                return res;
            }

            int idx = tokenIndex < 0 ? tokens.Count - 1 : tokenIndex;
            if (idx >= tokens.Count)
            {
                res.Error = ShiftError.TokenIndexOutOfRange;
                res.UsedTokenIndex = idx;
                return res;
            }
            res.UsedTokenIndex = idx;

            NumericToken t = tokens[idx];
            if (t.TooLong)
            {
                res.Error = ShiftError.TokenTooLong;
                return res;
            }

            long next;
            if (!NumberFormatting.TryAdd(t.Value, delta, out next))
            {
                res.Error = ShiftError.Overflow;
                return res;
            }

            // Тэргүүлэх тэгтэй байсан бол өргөнийг хадгална (001 → 003), үгүй бол байгалийн (9 → 10, 10 → 9).
            // Цифр нэмэгдэх бол ТАСЛАХГҮЙ (999 + 1 → 1000).
            int width = t.HasLeadingZeros ? t.DigitLength : 1;
            string text = NumberFormatting.Format(next, width);

            res.BecameNegative = next < 0 && t.Value >= 0;
            res.Result = existing.Substring(0, t.Index) + text + existing.Substring(t.Index + t.Length);
            res.Success = true;
            return res;
        }
    }
}
