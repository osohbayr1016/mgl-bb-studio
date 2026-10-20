using System;
using System.Collections.Generic;

namespace RevitMcpAddin.Smart.Core
{
    /// <summary>
    /// «Байгалийн» эрэмбэ: `A-2` &lt; `A-10` (тоон хэсгийг тоогоор, үсгийг үсгийн том/жижгийг үл хамааран).
    /// Хуудасны дугаар, давхрын нэр зэргийг хүнд ойлгомжтой эрэмбэлэхэд.
    /// </summary>
    public sealed class NaturalComparer : IComparer<string>
    {
        public static readonly NaturalComparer Instance = new NaturalComparer();

        public int Compare(string x, string y)
        {
            if (ReferenceEquals(x, y)) return 0;
            if (x == null) return -1;
            if (y == null) return 1;

            int i = 0, j = 0;
            while (i < x.Length && j < y.Length)
            {
                if (char.IsDigit(x[i]) && char.IsDigit(y[j]))
                {
                    int si = i, sj = j;
                    while (i < x.Length && char.IsDigit(x[i])) i++;
                    while (j < y.Length && char.IsDigit(y[j])) j++;
                    string a = x.Substring(si, i - si).TrimStart('0');
                    string b = y.Substring(sj, j - sj).TrimStart('0');
                    if (a.Length != b.Length) return a.Length < b.Length ? -1 : 1;
                    int c = string.CompareOrdinal(a, b);
                    if (c != 0) return c;
                }
                else
                {
                    int c = char.ToUpperInvariant(x[i]).CompareTo(char.ToUpperInvariant(y[j]));
                    if (c != 0) return c;
                    i++;
                    j++;
                }
            }
            if (i < x.Length) return 1;
            if (j < y.Length) return -1;
            return string.CompareOrdinal(x, y);
        }
    }
}
