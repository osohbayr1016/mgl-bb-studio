using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text;

namespace RevitMcpAddin.WallElevation.Core
{
    /// <summary>Нэг legend харагдац: нэр + доторх бичвэр (таних тэмдэг «ЗХ-01-С», тайлбар, төрлийн тэмдэг …).</summary>
    public sealed class WeLegendInfo
    {
        public string Name;
        /// <summary>Legend доторх бүх бичвэр (хайлтад) — давхардалгүй.</summary>
        public List<string> Texts = new List<string>();
        /// <summary>Тэмдэг маягийн хэсгүүд (үсэг + цифр, «ЗХ-01-С») — жагсаалтад харуулна.</summary>
        public List<string> Codes = new List<string>();

        public WeLegendInfo() { }
        public WeLegendInfo(string name) { Name = name; }
    }

    /// <summary>
    /// Legend-ийг НЭР эсвэл ТАНИХ ТЭМДГЭЭР хайх (2026-10-14, интерьерийн баг 3-р тойрог).  ЦЭВЭР дүрэм:
    ///   • том/жижиг үсэг, зай, зураас, цэг үл тоогдоно («зх01с» ≡ «ЗХ-01-С»);
    ///   • ижил дүрстэй кирилл/латин үсэг нэг («ЗХ-01-С»-ийг латин X, C-ээр бичсэн ч, «З»-г 3-аар бичсэн ч олдоно) — оффисын файлд хоёулаа
    ///     холилддог;
    ///   • хайлтын үг бүр (зайгаар) нэр эсвэл аль нэг бичвэрт агуулагдах ёстой.
    /// </summary>
    public static class WeLegendSearch
    {
        /// <summary>Кирилл → ижил дүрстэй латин (том үсгээр).  Монгол «Ө», «Ү» — өөрийн үсэг (дүрс ижил латин алга) хэвээр.</summary>
        private static readonly Dictionary<char, char> Homoglyph = new Dictionary<char, char>
        {
            { 'А', 'A' }, { 'В', 'B' }, { 'Е', 'E' }, { 'Ё', 'E' }, { 'К', 'K' }, { 'М', 'M' }, { 'Н', 'H' }, { 'О', 'O' },
            { 'Р', 'P' }, { 'С', 'C' }, { 'Т', 'T' }, { 'У', 'Y' }, { 'Х', 'X' }, { 'З', '3' }, { 'І', 'I' },
        };

        /// <summary>Тулгах хэлбэр: зөвхөн үсэг, цифр, том үсгээр, ижил дүрстэй үсэг нэгтгэсэн.</summary>
        public static string Fold(string s)
        {
            if (string.IsNullOrEmpty(s)) return string.Empty;
            var sb = new StringBuilder(s.Length);
            foreach (char ch in s)
            {
                if (!char.IsLetterOrDigit(ch)) continue;
                char u = char.ToUpper(ch, CultureInfo.InvariantCulture);
                char h;
                sb.Append(Homoglyph.TryGetValue(u, out h) ? h : u);
            }
            return sb.ToString();
        }

        /// <summary>Хоосон хайлт — бүгд таарна.</summary>
        public static bool Matches(WeLegendInfo info, string query)
        {
            if (info == null) return false;
            string[] tokens = (query ?? string.Empty).Split(new[] { ' ', '\t', ',', ';' }, StringSplitOptions.RemoveEmptyEntries);
            if (tokens.Length == 0) return true;
            var hay = new List<string> { Fold(info.Name) };
            if (info.Texts != null) hay.AddRange(info.Texts.Select(Fold));
            if (info.Codes != null) hay.AddRange(info.Codes.Select(Fold));
            foreach (string t in tokens)
            {
                string f = Fold(t);
                if (f.Length == 0) continue;
                if (!hay.Any(h => h.IndexOf(f, StringComparison.Ordinal) >= 0)) return false;
            }
            return true;
        }

        /// <summary>
        /// Бичвэрүүдээс тэмдэг маягийн хэсэг: үсэг/цифр-ийг «-», «.», «_», «/»-ээр холбосон, ДОР ХАЯЖ нэг үсэг ба нэг цифртэй, 2–24 тэмдэгт
        /// («ЗХ-01-С», «W-01», «A1.2»).  Дарааллаа хадгална, давхардалгүй.
        /// </summary>
        public static List<string> Codes(IEnumerable<string> texts)
        {
            var list = new List<string>();
            var seen = new HashSet<string>(StringComparer.Ordinal);
            if (texts == null) return list;
            foreach (string text in texts)
            {
                if (string.IsNullOrEmpty(text)) continue;
                var cur = new StringBuilder();
                foreach (char ch in text + " ")
                {
                    if (char.IsLetterOrDigit(ch) || ch == '-' || ch == '.' || ch == '_' || ch == '/' || ch == '‐' || ch == '–')
                    {
                        cur.Append(ch);
                        continue;
                    }
                    Flush(cur, list, seen);
                }
            }
            return list;
        }

        private static void Flush(StringBuilder cur, List<string> list, HashSet<string> seen)
        {
            if (cur.Length == 0) return;
            string t = cur.ToString().Trim('-', '.', '_', '/', '‐', '–');
            cur.Clear();
            if (t.Length < 2 || t.Length > 24) return;
            bool letter = t.Any(char.IsLetter), digit = t.Any(char.IsDigit);
            if (!letter || !digit) return;
            if (seen.Add(Fold(t))) list.Add(t);
        }

        /// <summary>Жагсаалтад: «Нэр» + эхний хэдэн тэмдэг.</summary>
        public static string CodesLabel(WeLegendInfo info, int max)
        {
            if (info == null || info.Codes == null || info.Codes.Count == 0) return string.Empty;
            IEnumerable<string> shown = info.Codes.Take(Math.Max(1, max));
            return string.Join(", ", shown) + (info.Codes.Count > max ? " … (" + info.Codes.Count + ")" : string.Empty);
        }
    }
}
