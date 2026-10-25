using System;
using System.Collections.Generic;

namespace MglBb.Core
{
    /// <summary>
    /// Дэлгээс дээрх огтлол / хэсэглэлийн тэмдэг «энэ гишүүнийх үү» гэдгийг нэрээр шийднэ (Revit-гүй).  Тэмдгийн (Viewer) нэр = түүний харагдацын нэр.
    /// </summary>
    public static class BbMarkNames
    {
        /// <summary>
        /// Харагдацын нэрийг «ДАМНУРУУ {mark} АРМАТУРЧЛАЛ» мэт загвартай тулгаж тэмдгийг гаргана («ДАМНУРУУ ДН-1 АРМАТУРЧЛАЛ (2)» → «ДН-1»).
        /// Аль ч загварт таарахгүй бол null.
        /// </summary>
        public static string MarkOf(string viewName, IEnumerable<string> patterns)
        {
            if (string.IsNullOrEmpty(viewName)) return null;
            foreach (string p in patterns)
            {
                int k = string.IsNullOrEmpty(p) ? -1 : p.IndexOf("{mark}", StringComparison.Ordinal);
                if (k < 0) continue;
                string prefix = p.Substring(0, k), suffix = p.Substring(k + "{mark}".Length);
                if (!viewName.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)) continue;
                string rest = viewName.Substring(prefix.Length);
                string mark;
                if (suffix.Trim().Length == 0) mark = rest.Trim();
                else
                {
                    int s = rest.IndexOf(suffix, StringComparison.OrdinalIgnoreCase);
                    if (s <= 0) continue;
                    mark = rest.Substring(0, s).Trim();
                }
                if (mark.Length > 0) return mark;
            }
            return null;
        }

        /// <summary>
        /// Тэмдэг энэ гишүүнийх: гишүүний өөрийн харагдац (<paramref name="ownNames"/> — үүсгэсэн, эсвэл ижил хуудсанд байгаа), эсвэл нэрэнд нь
        /// гишүүний тэмдэг бүтэн үгээр байгаа («ДН-1 S2» нь ДН-1-ийнх, ДН-12-ийнх биш).
        /// </summary>
        public static bool IsOwn(string viewerName, string mark, ICollection<string> ownNames)
        {
            string n = viewerName ?? "";
            if (ownNames != null && ownNames.Contains(n)) return true;
            return !string.IsNullOrEmpty(mark) && BbNames.IndexOfMark(n, mark) >= 0;
        }
    }
}
