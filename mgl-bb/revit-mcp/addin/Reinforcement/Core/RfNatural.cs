using System;
using System.Collections.Generic;

namespace RevitMcpAddin.Reinforcement.Core
{
    /// <summary>
    /// «Байгалийн» эрэмбэ: DN-2 нь DN-10-аас ӨМНӨ.  Тоон хэсгийг тоогоор, үсгэн хэсгийг том/жижиг үсэг
    /// үл хамааран (кирилл ч) харьцуулна; бүгд тэнцүү бол ordinal-аар задлан тогтвортой (нийт) эрэмбэ гаргана.
    /// Тоон хэсэг үсгээс ӨМНӨ орно («1» &lt; «A»).
    /// </summary>
    public sealed class RfNaturalComparer : IComparer<string>
    {
        public static readonly RfNaturalComparer Instance = new RfNaturalComparer();

        public int Compare(string x, string y)
        {
            if (ReferenceEquals(x, y)) return 0;
            if (x == null) return -1;
            if (y == null) return 1;

            int i = 0, j = 0;
            while (i < x.Length && j < y.Length)
            {
                bool dx = IsDigit(x[i]), dy = IsDigit(y[j]);
                if (dx && dy)
                {
                    int si = i;
                    while (i < x.Length && IsDigit(x[i])) i++;
                    int sj = j;
                    while (j < y.Length && IsDigit(y[j])) j++;

                    // Тэргүүн тэгийг хасаад (хамгийн багадаа нэг орон үлдээнэ) урт, дараа нь орноор харьцуулна —
                    // 40 оронтой тоо ч overflow-гүй.
                    int zi = si;
                    while (zi < i - 1 && x[zi] == '0') zi++;
                    int zj = sj;
                    while (zj < j - 1 && y[zj] == '0') zj++;
                    int li = i - zi, lj = j - zj;
                    if (li != lj) return li < lj ? -1 : 1;
                    for (int k = 0; k < li; k++)
                    {
                        char a = x[zi + k], b = y[zj + k];
                        if (a != b) return a < b ? -1 : 1;
                    }
                }
                else if (dx != dy)
                {
                    return dx ? -1 : 1;
                }
                else
                {
                    char a = char.ToUpperInvariant(x[i]);
                    char b = char.ToUpperInvariant(y[j]);
                    if (a != b) return a < b ? -1 : 1;
                    i++;
                    j++;
                }
            }
            if (i < x.Length) return 1;
            if (j < y.Length) return -1;
            return string.CompareOrdinal(x, y);
        }

        private static bool IsDigit(char c) { return c >= '0' && c <= '9'; }
    }
}
