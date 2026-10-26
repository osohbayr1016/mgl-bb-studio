using System;
using System.Collections.Generic;

namespace MglBb.Core
{
    /// <summary>
    /// Дэлгээсийн чиглэл: гинжийг дайрсан тэнхлэгүүд зүүнээс баруун тийш ӨСӨХ эрэмбээр (FX1, FX2 … / А, Б …) харагдах ёстой (хэрэглэгч 2026-10-26;
    /// өмнө нь эхний гишүүний зурсан чиглэлээр — FX4 … FX1 гардаг байв).  Revit-гүй.
    /// </summary>
    public static class BbGridOrder
    {
        /// <summary>Станцаар (гинжийн тэнхлэгийн дагуу) эрэмбэлсэн тэнхлэгийн нэр буурах эрэмбэтэй бол true — тэнхлэгийг эргүүлэх.</summary>
        public static bool Reversed(IList<KeyValuePair<double, string>> stationNames)
        {
            int agree = 0, disagree = 0;
            for (int i = 0; i < stationNames.Count; i++)
                for (int j = i + 1; j < stationNames.Count; j++)
                {
                    double ds = stationNames[j].Key - stationNames[i].Key;
                    int dn = Compare(stationNames[j].Value, stationNames[i].Value);
                    if (Math.Abs(ds) < 1e-6 || dn == 0) continue;
                    if ((ds > 0) == (dn > 0)) agree++;
                    else disagree++;
                }
            return disagree > agree;
        }

        /// <summary>Тэнхлэгийн нэрийн «натурал» харьцуулалт: тоо нь тоогоор (FX2 &lt; FX10), бусад нь үсгээр (том жижиг ялгахгүй).</summary>
        public static int Compare(string a, string b)
        {
            a = a ?? ""; b = b ?? "";
            int i = 0, j = 0;
            while (i < a.Length && j < b.Length)
            {
                if (char.IsDigit(a[i]) && char.IsDigit(b[j]))
                {
                    int si = i, sj = j;
                    while (i < a.Length && char.IsDigit(a[i])) i++;
                    while (j < b.Length && char.IsDigit(b[j])) j++;
                    long na = long.Parse(a.Substring(si, Math.Min(18, i - si))), nb = long.Parse(b.Substring(sj, Math.Min(18, j - sj)));
                    if (na != nb) return na < nb ? -1 : 1;
                    continue;
                }
                int c = char.ToUpperInvariant(a[i]).CompareTo(char.ToUpperInvariant(b[j]));
                if (c != 0) return c;
                i++; j++;
            }
            return (a.Length - i).CompareTo(b.Length - j);
        }
    }
}
