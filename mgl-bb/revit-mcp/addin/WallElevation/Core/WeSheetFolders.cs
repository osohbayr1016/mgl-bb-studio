using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;

namespace RevitMcpAddin.WallElevation.Core
{
    /// <summary>
    /// Project Browser → Sheets-ийн бүлэглэлтийн нэг түвшин (Browser Organization-ийн «Folders»): тухайн параметрийн утгаар хуудас
    /// бүлэглэгдэнэ («Бүлэг» → «4. ИНТЕРЬЕР», «Хэсэг» → «4.2. Дотор дэлгээс»).
    /// </summary>
    public sealed class WeFolderLevel
    {
        /// <summary>Параметрийн id (built-in нь сөрөг) — тохиргооны түлхүүр.</summary>
        public string Key;
        /// <summary>Параметрийн нэр («Sheet Group», «Бүлэг»).</summary>
        public string Name;
        /// <summary>Шинэ хуудсанд бичиж болох уу: бичвэр параметр, хуудасны дугаар/нэр биш, бүлгийн нэр = параметрийн утга.</summary>
        public bool Settable;
        /// <summary>Бичих боломжгүй шалтгаан (<see cref="Settable"/> = false үед).</summary>
        public string Why;
        /// <summary>Revit 2025+ хуудасны бүрдэл (Sheet Collection): хоосон = бүрдэлгүй (Sheets-ийн шууд доор), «???» биш.</summary>
        public bool IsCollection;
        /// <summary>Хуудасгүй ч сонгож болох утга (хоосон бүрдэл).</summary>
        public readonly List<string> Known = new List<string>();
    }

    /// <summary>
    /// «Ажлын зургийн бүрдэл»: дэлгээсийн хуудсыг Project Browser-ийн аль бүлэг, хэсэгт оруулах (2026-10-14, интерьерийн баг).
    /// Revit хуудсыг ПАРАМЕТРИЙН утгаар бүлэглэдэг тул «бүлэгт оруулах» = шинэ хуудсанд тэр параметрийг бичих.  Энэ анги нь цэвэр:
    /// төслийн хуудсуудын одоогийн бүлгүүдээс сонголт, анхны утга, тайлбарыг гаргана; Revit-ийг <c>WeSheetFolderReader</c> уншина.
    /// </summary>
    public sealed class WeSheetFolders
    {
        /// <summary>Revit хоосон утгатай хуудсыг ингэж нэрлэсэн бүлэгт хийдэг.</summary>
        public const string Unset = "???";
        /// <summary>Бүрдлийн (Sheet Collection) түвшний түлхүүр — параметр биш.</summary>
        public const string CollectionKey = "@collection";

        /// <summary>Browser Organization-ийн нэр («Sheet Group / Sub-Group»).</summary>
        public string Organization;
        public readonly List<WeFolderLevel> Levels = new List<WeFolderLevel>();
        /// <summary>Төслийн хуудас бүрийн бүлгийн нэр, түвшин бүрд ("" = хоосон / «???»).</summary>
        public readonly List<List<string>> Paths = new List<List<string>>();
        /// <summary>Цонхны анхны утга, түвшин бүрд ("" = хоосон).</summary>
        public List<string> Default = new List<string>();
        /// <summary>Анхны утга хаанаас ирсэн («өмнө үүсгэсэн хуудас «БА428»»); null = төслөөс сурсангүй.</summary>
        public string DefaultSource;
        /// <summary>Сонгох зүйлгүй шалтгаан (бүлэглэлтгүй, хуудасгүй, уншиж чадсангүй).</summary>
        public string Problem;

        /// <summary>Ядаж нэг түвшинг хэрэглэгч сонгож болно.</summary>
        public bool Selectable { get { return Levels.Any(l => l.Settable); } }

        /// <summary>«???» ба хоосон зай → "".</summary>
        public static string Normalize(string name)
        {
            string t = (name ?? string.Empty).Trim();
            return t == Unset ? string.Empty : t;
        }

        /// <summary>Нэг хуудасны бүлгийн замыг нэмнэ (дутуу түвшин = хоосон).</summary>
        public void AddPath(IList<string> names)
        {
            var p = new List<string>(Levels.Count);
            for (int i = 0; i < Levels.Count; i++) p.Add(names != null && i < names.Count ? Normalize(names[i]) : string.Empty);
            Paths.Add(p);
        }

        /// <summary>
        /// <paramref name="level"/>-ийн сонголт: дээд түвшнүүдэд СОНГОСОН утгатай хуудсуудын энэ түвшний утга (давхардалгүй, натурал эрэмбээр).
        /// Бичиж болохгүй дээд түвшин (дугаараас гэх мэт) шүүлтэд оролцохгүй — тэр утгыг энэ хэрэгсэл тогтоохгүй.
        /// </summary>
        public List<string> OptionsFor(int level, IList<string> chosen)
        {
            var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            var list = new List<string>();
            if (level < 0 || level >= Levels.Count) return list;
            foreach (List<string> p in Paths)
            {
                bool match = true;
                for (int j = 0; j < level && match; j++)
                {
                    if (!Levels[j].Settable) continue;
                    string want = chosen != null && j < chosen.Count ? Normalize(chosen[j]) : string.Empty;
                    match = string.Equals(p[j], want, StringComparison.OrdinalIgnoreCase);
                }
                if (!match || p[level].Length == 0 || !seen.Add(p[level])) continue;
                list.Add(p[level]);
            }
            foreach (string k in Levels[level].Known)
                if (!string.IsNullOrWhiteSpace(k) && seen.Add(k.Trim())) list.Add(k.Trim());
            list.Sort(NaturalCompare);
            return list;
        }

        /// <summary>Хамгийн олон хуудастай зам (тэнцвэл эхэлж тааралдсан).  Хоосон бол null.</summary>
        public static List<string> CommonPath(IEnumerable<IList<string>> paths)
        {
            var count = new Dictionary<string, int>(StringComparer.Ordinal);
            var first = new Dictionary<string, IList<string>>(StringComparer.Ordinal);
            var order = new List<string>();
            foreach (IList<string> p in paths ?? Enumerable.Empty<IList<string>>())
            {
                if (p == null) continue;
                string k = string.Join("\u001f", p);
                int c;
                count[k] = count.TryGetValue(k, out c) ? c + 1 : 1;
                if (!first.ContainsKey(k)) { first[k] = p; order.Add(k); }
            }
            if (order.Count == 0) return null;
            string best = order.OrderByDescending(k => count[k]).First();   // OrderBy тогтвортой — тэнцвэл эхнийх
            return first[best].ToList();
        }

        /// <summary>Project Browser дахь зам: «Sheets › 4. ИНТЕРЬЕР › 4.2. Дотор дэлгээс».  Бичигдэхгүй түвшин — «‹Нэр›».</summary>
        public string Describe(IList<string> chosen)
        {
            var parts = new List<string> { "Sheets" };
            for (int i = 0; i < Levels.Count; i++)
            {
                if (!Levels[i].Settable) { parts.Add("‹" + Levels[i].Name + "›"); continue; }
                string v = chosen != null && i < chosen.Count ? Normalize(chosen[i]) : string.Empty;
                if (Levels[i].IsCollection && v.Length == 0) continue;   // бүрдэлгүй хуудас Sheets-ийн шууд доор
                parts.Add(v.Length == 0 ? Unset : v);
            }
            return string.Join(" › ", parts);
        }

        /// <summary>Тохиргоонд: бичиж болох түвшин бүрд параметрийн id → утга ("" = хоосон).</summary>
        public Dictionary<string, string> ToSettings(IList<string> chosen)
        {
            var d = new Dictionary<string, string>(StringComparer.Ordinal);
            for (int i = 0; i < Levels.Count; i++)
                if (Levels[i].Settable && !string.IsNullOrEmpty(Levels[i].Key))
                    d[Levels[i].Key] = chosen != null && i < chosen.Count ? Normalize(chosen[i]) : string.Empty;
            return d;
        }

        /// <summary>
        /// Хэрэглэгчийн анхны утгаас ӨӨРЧИЛСӨН түвшин — энэ удаагийн өрөөний өмнө үүсгэсэн хуудсыг ч тэнд шилжүүлнэ (хөндөөгүй түвшнийг
        /// дизайнерын гараар зөөсөн хуудсанд дахин бичихгүй).
        /// </summary>
        public HashSet<string> Changed(IList<string> chosen)
        {
            var set = new HashSet<string>(StringComparer.Ordinal);
            for (int i = 0; i < Levels.Count; i++)
            {
                if (!Levels[i].Settable || string.IsNullOrEmpty(Levels[i].Key)) continue;
                string now = chosen != null && i < chosen.Count ? Normalize(chosen[i]) : string.Empty;
                string was = Default != null && i < Default.Count ? Normalize(Default[i]) : string.Empty;
                if (!string.Equals(now, was, StringComparison.Ordinal)) set.Add(Levels[i].Key);
            }
            return set;
        }

        /// <summary>
        /// Бүлгийн нэр нь параметрийн утга ӨӨРӨӨ юу (бичвэл тэр бүлэгт орно): хуудас бүрийн (бүлгийн нэр, параметрийн утга) хос.
        /// «Эхний N тэмдэгтээр» бүлэглэсэн бол нэр нь утгаас богино — бичиж болохгүй.
        /// </summary>
        public static bool ValueDrivesFolder(IEnumerable<KeyValuePair<string, string>> folderAndValue)
        {
            foreach (KeyValuePair<string, string> kv in folderAndValue ?? Enumerable.Empty<KeyValuePair<string, string>>())
                if (!string.Equals(Normalize(kv.Key), Normalize(kv.Value), StringComparison.Ordinal)) return false;
            return true;
        }

        /// <summary>«4.2» &lt; «4.10» &lt; «10. …» — тоон хэсгийг тоогоор.</summary>
        public static int NaturalCompare(string a, string b)
        {
            a = a ?? string.Empty; b = b ?? string.Empty;
            int i = 0, j = 0;
            while (i < a.Length && j < b.Length)
            {
                if (char.IsDigit(a[i]) && char.IsDigit(b[j]))
                {
                    int si = i, sj = j;
                    while (i < a.Length && char.IsDigit(a[i])) i++;
                    while (j < b.Length && char.IsDigit(b[j])) j++;
                    string na = a.Substring(si, i - si).TrimStart('0'), nb = b.Substring(sj, j - sj).TrimStart('0');
                    if (na.Length != nb.Length) return na.Length.CompareTo(nb.Length);
                    int c = string.CompareOrdinal(na, nb);
                    if (c != 0) return c;
                    continue;
                }
                int d = string.Compare(a[i].ToString(), b[j].ToString(), StringComparison.CurrentCultureIgnoreCase);
                if (d != 0) return d;
                i++; j++;
            }
            return (a.Length - i).CompareTo(b.Length - j);
        }

        public override string ToString()
        {
            return Levels.Count == 0 ? (Problem ?? "бүлэглэлтгүй")
                : string.Join(" / ", Levels.Select(l => l.Name + (l.Settable ? string.Empty : "*"))) + " · " + Paths.Count.ToString(CultureInfo.InvariantCulture) + " хуудас";
        }
    }
}
