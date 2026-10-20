using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.Linq;

namespace RevitMcpAddin.WallElevation.Revit
{
    /// <summary>
    /// Нарийн хугацааны хэмжүүр (лог) — бодит загварт аль Revit API дуудлага удаан болохыг ХЭМЖИЖ олохын тулд
    /// (GATEWAY 2026-10-07: «нөөц» 11.5 с-ийн шалтгаан нь <c>Viewport.LabelOffset</c>-ийн уншилт байсныг ингэж олсон).
    /// <c>using (WeProf.T("vp.create")) { … }</c>; <see cref="Flush"/> нийлбэрийг лог руу бичээд тэглэнэ.  Revit-ийн үндсэн thread-д л.
    /// </summary>
    internal static class WeProf
    {
        private static readonly Dictionary<string, long[]> Acc = new Dictionary<string, long[]>(StringComparer.Ordinal);

        internal struct Scope : IDisposable
        {
            private readonly string _key;
            private readonly long _start;

            internal Scope(string key)
            {
                _key = key;
                _start = Stopwatch.GetTimestamp();
            }

            public void Dispose()
            {
                long ms = (Stopwatch.GetTimestamp() - _start) * 1000 / Stopwatch.Frequency;
                long[] a;
                if (!Acc.TryGetValue(_key, out a)) Acc[_key] = a = new long[2];
                a[0] += ms;
                a[1]++;
            }
        }

        internal static Scope T(string key) { return new Scope(key); }

        /// <summary>«vp.create 4100 мс/11 · …» (их нь эхэнд) — хоосон бол null.</summary>
        internal static string Flush(string area)
        {
            if (Acc.Count == 0) return null;
            string s = string.Join(" · ", Acc.OrderByDescending(kv => kv.Value[0])
                .Select(kv => kv.Key + " " + kv.Value[0].ToString(CultureInfo.InvariantCulture) + " мс/" + kv.Value[1].ToString(CultureInfo.InvariantCulture)));
            Acc.Clear();
            WeLog.Info(area, s);
            return s;
        }
    }
}
