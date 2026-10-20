using System;
using System.Globalization;

namespace RevitMcpAddin.SheetNumerator.Core
{
    /// <summary>
    /// Дугаарын тоон хэсгийг форматлах.  Дүрэм (эзний тодорхойлолт):
    ///   4,  өргөн 3 → «004»      -4, өргөн 3 → «-004»      1234, өргөн 3 → «1234».
    /// Өргөн нь ДООД ТАЛЫН цифрийн тоо — ХЭЗЭЭ Ч таслахгүй, хасах тэмдгийг цифр гэж тоолохгүй.
    /// </summary>
    public static class NumberFormatting
    {
        /// <summary>
        /// Тоон утгын дээд хязгаар (15 орон).  `long` хангалттай том ч, тооцоолол (эхлэх + алхам × n) чимээгүй
        /// халих ёсгүй тул ХЯЗГААРЫГ тохиргооны шалгалтаар ил барина.
        /// </summary>
        public const long MaxAbsValue = 999999999999999L;

        public const int MaxWidth = 18;

        public static string Format(long value, int width)
        {
            bool negative = value < 0;
            // long.MinValue-ийн абсолют утга long-д багтахгүй → ulong-оор.
            string digits = negative
                ? (((ulong)(-(value + 1))) + 1UL).ToString(CultureInfo.InvariantCulture)
                : value.ToString(CultureInfo.InvariantCulture);
            if (width > 0 && digits.Length < width)
                digits = digits.PadLeft(width, '0');
            return negative ? "-" + digits : digits;
        }

        public static bool InRange(long value)
        {
            return value >= -MaxAbsValue && value <= MaxAbsValue;
        }

        /// <summary>a + b, хязгаарт багтвал true.  Чимээгүй халилт БАЙХГҮЙ (checked).</summary>
        public static bool TryAdd(long a, long b, out long result)
        {
            result = 0;
            try
            {
                long r = checked(a + b);
                if (!InRange(r))
                    return false;
                result = r;
                return true;
            }
            catch (OverflowException)
            {
                return false;
            }
        }

        /// <summary>a + b × n.</summary>
        public static bool TryAddScaled(long a, long b, long n, out long result)
        {
            result = 0;
            try
            {
                long r = checked(a + checked(b * n));
                if (!InRange(r))
                    return false;
                result = r;
                return true;
            }
            catch (OverflowException)
            {
                return false;
            }
        }

        public static int ClampWidth(int width)
        {
            if (width < 0)
                return 0;
            return width > MaxWidth ? MaxWidth : width;
        }

        /// <summary>
        /// Хэрэглэгчийн бичсэн тоог уншина: хоосон зайг тайрна, «+5» зөвшөөрнө, ASCII цифр л.
        /// Хязгаараас хэтэрсэн бол false.
        /// </summary>
        public static bool TryParse(string text, out long value)
        {
            value = 0;
            if (string.IsNullOrWhiteSpace(text))
                return false;
            string t = text.Trim();
            if (t.Length > 1 && (t[0] == '+' || t[0] == '-'))
            {
                // Тэмдгийн дараа цифр л байх ёстой.
                for (int i = 1; i < t.Length; i++)
                {
                    if (t[i] < '0' || t[i] > '9')
                        return false;
                }
            }
            else
            {
                foreach (char c in t)
                {
                    if (c < '0' || c > '9')
                        return false;
                }
            }
            long v;
            if (!long.TryParse(t, NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture, out v))
                return false;
            if (!InRange(v))
                return false;
            value = v;
            return true;
        }
    }
}
