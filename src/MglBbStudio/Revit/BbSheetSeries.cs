using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text.RegularExpressions;
using Autodesk.Revit.DB;

namespace MglBb.RevitSide
{
    /// <summary>
    /// Хуудасны дугаарын ЦУВРАЛ ба Project Browser-ийн бүлэглэлт (ЖИШЭЭ-1: 4- багана, 5- дамнуруу, 6- хана, 7- хучилт; «* Classification»,
    /// «* Sub-Discipline», «* Type Designator»).  Шинэ хуудас = цувралын хамгийн их дугаар + 1; параметрийг ЭНЭ төслийн тэр цувралын сүүлийн
    /// хуудаснаас (зохиогч/шалгагч ч) хуулна, тийм хуудас байхгүй бол стандартад сурсан утгаар.
    /// </summary>
    internal static class BbSheetSeries
    {
        private static readonly Regex Tail = new Regex(@"^(.*?)(\d+)$", RegexOptions.CultureInvariant);

        /// <summary>«5-12» → «5-», «A3-2» → «A3-»; цувралгүй («999», «5-30*») → "".</summary>
        public static string Prefix(string number)
        {
            Match m = Tail.Match(number ?? "");
            if (!m.Success || m.Groups[1].Value.Length == 0) return "";
            return m.Groups[1].Value;
        }

        /// <summary>«* …» нэртэй бичвэр параметрүүд, «нэр=утга|нэр=утга» (нэрээр эрэмбэлсэн).</summary>
        public static string BrowserParams(ViewSheet sh)
        {
            var kv = new SortedDictionary<string, string>(StringComparer.Ordinal);
            foreach (Parameter p in sh.Parameters)
            {
                string n = p.Definition?.Name ?? "";
                if (!n.StartsWith("* ", StringComparison.Ordinal) || p.StorageType != StorageType.String) continue;
                string v = p.AsString();
                if (string.IsNullOrWhiteSpace(v) || v.IndexOf('|') >= 0 || v.IndexOf('=') >= 0) continue;
                kv[n] = v;
            }
            return string.Join("|", kv.Select(x => x.Key + "=" + x.Value));
        }

        /// <summary>Цувралын дараагийн чөлөөт дугаар («5-» → «5-125»).</summary>
        public static string Next(Document doc, string prefix, ICollection<string> reserved, ElementId self = null)
        {
            if (string.IsNullOrEmpty(prefix)) return null;
            var used = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            int max = 0;
            foreach (ViewSheet s in new FilteredElementCollector(doc).OfClass(typeof(ViewSheet)).Cast<ViewSheet>())
            {
                // Шинэ хуудсанд Revit өөрөө «сүүлийн дугаар + 1» өгдөг — түүнийг тооцвол дугаар нэгээр алгасна (6-58, 6-60 …, хэмжсэн).
                if (self != null && s.Id == self) continue;
                string num = s.SheetNumber ?? "";
                used.Add(num);
                if (!num.StartsWith(prefix, StringComparison.Ordinal)) continue;
                if (int.TryParse(num.Substring(prefix.Length), NumberStyles.None, CultureInfo.InvariantCulture, out int k)) max = Math.Max(max, k);
            }
            if (reserved != null) foreach (string r in reserved) used.Add(r);
            for (int k = max + 1; k < max + 1000; k++)
            {
                string cand = prefix + k.ToString(CultureInfo.InvariantCulture);
                if (!used.Contains(cand)) return cand;
            }
            return null;
        }

        private static readonly string[] People = { "Designed By", "Checked By", "Drawn By", "Approved By" };

        /// <summary>
        /// Шинэ хуудсанд цувралын параметр: төслийн тэр цувралын хамгийн их дугаартай хуудаснаас «* …» + зохиогч/шалгагч; байхгүй бол
        /// <paramref name="learned"/> («нэр=утга|…»).  Хуулсан параметрийн тоо.
        /// </summary>
        public static int ApplyParams(Document doc, ViewSheet target, string prefix, string learned)
        {
            ViewSheet src = null;
            int best = -1;
            if (!string.IsNullOrEmpty(prefix))
                foreach (ViewSheet s in new FilteredElementCollector(doc).OfClass(typeof(ViewSheet)).Cast<ViewSheet>())
                {
                    if (s.Id == target.Id) continue;
                    string num = s.SheetNumber ?? "";
                    if (!num.StartsWith(prefix, StringComparison.Ordinal)) continue;
                    if (!int.TryParse(num.Substring(prefix.Length), NumberStyles.None, CultureInfo.InvariantCulture, out int k)) continue;
                    if (k > best) { best = k; src = s; }
                }
            int n = 0;
            if (src != null)
            {
                foreach (Parameter p in src.Parameters)
                {
                    string name = p.Definition?.Name ?? "";
                    if (p.StorageType != StorageType.String) continue;
                    if (!name.StartsWith("* ", StringComparison.Ordinal) && Array.IndexOf(People, name) < 0) continue;
                    string v = p.AsString();
                    if (string.IsNullOrEmpty(v)) continue;
                    if (Set(target, name, v)) n++;
                }
                if (n > 0) return n;
            }
            foreach (string pair in (learned ?? "").Split(new[] { '|' }, StringSplitOptions.RemoveEmptyEntries))
            {
                int i = pair.IndexOf('=');
                if (i <= 0) continue;
                if (Set(target, pair.Substring(0, i), pair.Substring(i + 1))) n++;
            }
            return n;
        }

        private static bool Set(ViewSheet sh, string name, string value)
        {
            try
            {
                Parameter p = sh.LookupParameter(name);
                if (p == null || p.IsReadOnly || p.StorageType != StorageType.String) return false;
                if (p.AsString() == value) return true;
                return p.Set(value);
            }
            catch { return false; }
        }
    }
}
