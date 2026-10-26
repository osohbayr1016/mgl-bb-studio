using System;
using System.Collections.Generic;

namespace MglBb.Core
{
    /// <summary>
    /// Дэлгээсийн чиглэл: гинжийг дайрсан тэнхлэгүүд зүүнээс баруун тийш өсөх (FX1, FX2 … / А, Б …, анхдагч) эсвэл буурах эрэмбээр —
    /// хэрэглэгч «Ажлын зураг үүсгэх» цонхонд сонгоно (2026-10-26; өмнө нь эхний гишүүний зурсан чиглэлээр).  Revit-гүй.
    /// </summary>
    public static class BbGridOrder
    {
        /// <summary>Станцаар (гинжийн тэнхлэгийн дагуу) эрэмбэлсэн тэнхлэгийн нэр буурах эрэмбэтэй бол true — тэнхлэгийг эргүүлэх.</summary>
        public static bool Reversed(IList<KeyValuePair<double, string>> stationNames) { return Direction(stationNames) < 0; }

        /// <summary>Станц өсөхөд тэнхлэгийн нэр: +1 өсөх, −1 буурах, 0 тодорхойгүй (2-оос цөөн тэнхлэг / тэнцүү).</summary>
        public static int Direction(IList<KeyValuePair<double, string>> stationNames)
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
            return agree > disagree ? 1 : disagree > agree ? -1 : 0;
        }

        /// <summary>
        /// Хэрэглэгчийн сонгосон чиглэлд (<paramref name="want"/>: +1 өсөх, −1 буурах, 0 зурсан чиглэлээр) хүрэхийн тулд тэнхлэгийг эргүүлэх эсэх.
        /// </summary>
        public static bool Flip(IList<KeyValuePair<double, string>> stationNames, int want)
        {
            if (want == 0) return false;
            int d = Direction(stationNames);
            return d != 0 && d != Math.Sign(want);
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
