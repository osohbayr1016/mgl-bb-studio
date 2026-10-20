using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;

namespace RevitMcpAddin.WallElevation.Core
{
    /// <summary>
    /// Материалын тэмдэглэлийн БИЧВЭР (жишээ хуудас 205A-F / 206A-G: «МОДОН ӨНГӨЛГӨӨТЭЙ ГОЁЛЫН ХУЛСАН ХАВТАН», «ШИЛЭН ХАНА») —
    /// материалын нэр, тайлбар, ангиллаас ТОДОРХОЙ дарааллаар, том үсгээр.  ХЭМЖСЭН (GATEWAY, 2026-10-07): материалын нэр BIMon
    /// загварын «Ангилал+Тодотгол» («Хавтан+гипсэн», «Бетон+B35», «Плита+Ерөнхий_600x600»), Keynote хоосон (1056-аас 2 нь л, англиар),
    /// link-ийн бүтцийн загвар англиар («Concrete, Cast-in-Place, Gray») — тэр нь хуудсанд «CONCRETE, CAST-IN-PLACE, GRAY» гэж гарч байв.
    /// Дараалал: кирилл НЭР → кирилл ТАЙЛБАР → кирилл АНГИЛАЛ → англи түлхүүр үгийн толь → (сүүлийн арга) нэр өөрөө.
    /// Утгагүй орлуулагч материал («BIMon - Үндсэн+Хана», «Default», «&lt;By Category&gt;») → null (тэмдэглэл тавихгүй).
    /// </summary>
    public static class WeMaterialLabel
    {
        public const string GlassWall = "ШИЛЭН ХАНА";

        public static string Label(string name, string description, string materialClass)
        {
            string n = Clean(name);
            if (IsPlaceholder(n)) return null;
            if (HasCyrillic(n)) return Format(n);
            string d = Clean(description);
            if (HasCyrillic(d) && !IsPlaceholder(d)) return Format(d);
            string c = Clean(materialClass);
            if (HasCyrillic(c) && !IsPlaceholder(c) && !c.StartsWith("<", StringComparison.Ordinal)) return Format(c);
            string en = English((n ?? "") + " | " + (d ?? "") + " | " + (c ?? ""));
            if (en != null) return en;
            return string.IsNullOrEmpty(n) ? null : Upper(n);
        }

        /// <summary>Тэмдэглэлд утгагүй (загварын өгөгдмөл, ангилалгүй) материал.</summary>
        public static bool IsPlaceholder(string s)
        {
            if (string.IsNullOrWhiteSpace(s)) return true;
            string t = s.Trim();
            string l = t.ToLowerInvariant();
            return l.StartsWith("bimon", StringComparison.Ordinal) || l.StartsWith("default", StringComparison.Ordinal)
                   || l.StartsWith("<", StringComparison.Ordinal) || l == "generic" || l == "unassigned" || l == "miscellaneous"
                   || l.StartsWith("үе шат", StringComparison.Ordinal) || l.StartsWith("render material", StringComparison.Ordinal);
        }

        public static bool HasCyrillic(string s)
        {
            if (string.IsNullOrEmpty(s)) return false;
            foreach (char ch in s) if (ch >= 'Ѐ' && ch <= 'ӿ') return true;
            return false;
        }

        private static string Clean(string s)
        {
            if (s == null) return null;
            string t = s.Trim();
            t = Regex.Replace(t, @"\(\d+\)\s*$", "").Trim();   // «Плита+Ерөнхий_600x600(2)» — Revit-ийн хувилбарын дугаар
            return t.Length == 0 ? null : t;
        }

        // Монгол тэмдэг нэрийн дагавар («гипсэн», «хүчитгэсэн», «цагаан», «модон», «өнгөлгөөтэй») — «Нэр үг+Тэмдэг» дарааллыг
        // монгол жам ёсоор «ТЭМДЭГ НЭР» болгоход («Хавтан+гипсэн» → «ГИПСЭН ХАВТАН», «Будаг - Цагаан» → «ЦАГААН БУДАГ»).
        private static readonly string[] AdjEndings = { "сэн", "сан", "сон", "сөн", "эн", "ан", "он", "өн", "тэй", "тай", "той", "ийн", "ын", "ий" };
        private static readonly HashSet<string> Filler = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "ерөнхий", "generic", "default" };

        /// <summary>«Ангилал+Тодотгол» нэрийг уншигдахуйц бичвэр болгоно (том үсгээр).</summary>
        public static string Format(string raw)
        {
            if (string.IsNullOrWhiteSpace(raw)) return null;
            string s = raw.Replace('_', ' ');
            string[] parts = Regex.Split(s, @"\s*\+\s*|\s+-\s+").Select(p => p.Trim()).Where(p => p.Length > 0).ToArray();
            var cleaned = new List<string>();
            foreach (string p in parts)
            {
                string q = string.Join(" ", p.Split(new[] { ' ' }, StringSplitOptions.RemoveEmptyEntries).Where(w => !Filler.Contains(w)));
                if (q.Length > 0) cleaned.Add(q);
            }
            if (cleaned.Count == 0) return null;
            // Эхэнд зөвхөн латин үгс (компанийн угтвар «MGL E&C ПАРКЕТ») — кирилл үлдэх бол хасна.
            if (cleaned.Count == 1)
            {
                string[] words = cleaned[0].Split(' ');
                int k = 0;
                while (k < words.Length - 1 && !HasCyrillic(words[k]) && !words[k].Any(char.IsDigit)) k++;
                if (k > 0 && words.Skip(k).Any(HasCyrillic)) cleaned[0] = string.Join(" ", words.Skip(k));
            }
            string text;
            if (cleaned.Count == 2 && IsSingleWord(cleaned[0]) && IsSingleWord(cleaned[1]) && HasCyrillic(cleaned[1]) && IsAdjective(cleaned[1]))
                text = cleaned[1] + " " + cleaned[0];
            else
                text = string.Join(" ", cleaned);
            return Upper(text);
        }

        private static bool IsSingleWord(string s) { return s.IndexOf(' ') < 0; }

        private static bool IsAdjective(string w)
        {
            string l = w.ToLowerInvariant();
            return l.Length >= 4 && AdjEndings.Any(e => l.EndsWith(e, StringComparison.Ordinal));
        }

        /// <summary>Үсгийг том болгоно; тоо агуулсан үг («600x600», «h=100мм») хэвээр.</summary>
        public static string Upper(string s)
        {
            var sb = new StringBuilder();
            foreach (string w in s.Split(' '))
            {
                if (sb.Length > 0) sb.Append(' ');
                sb.Append(w.Any(char.IsDigit) ? w : w.ToUpper(CultureInfo.InvariantCulture));
            }
            return sb.ToString();
        }

        // Англи материалын түлхүүр үг → монгол (дарааллаар: тодорхой нь эхэнд).
        private static readonly KeyValuePair<string, string>[] Dictionary =
        {
            new KeyValuePair<string, string>("cast-in-place", "ЦУТГАМАЛ БЕТОН"),
            new KeyValuePair<string, string>("cast in place", "ЦУТГАМАЛ БЕТОН"),
            new KeyValuePair<string, string>("precast", "УГСАРМАЛ БЕТОН"),
            new KeyValuePair<string, string>("lightweight concrete", "ХӨНГӨН БЕТОН"),
            new KeyValuePair<string, string>("concrete masonry", "БЕТОН БЛОК ӨРЛӨГ"),
            new KeyValuePair<string, string>("concrete", "БЕТОН"),
            new KeyValuePair<string, string>("gypsum", "ГИПСЭН ХАВТАН"),
            new KeyValuePair<string, string>("plasterboard", "ГИПСЭН ХАВТАН"),
            new KeyValuePair<string, string>("drywall", "ГИПСЭН ХАВТАН"),
            new KeyValuePair<string, string>("plaster", "ШАВАРДЛАГА"),
            new KeyValuePair<string, string>("paint", "БУДАГ"),
            new KeyValuePair<string, string>("brick", "ТООСГОН ӨРЛӨГ"),
            new KeyValuePair<string, string>("masonry", "ӨРЛӨГ"),
            new KeyValuePair<string, string>("glazing", "ШИЛ"),
            new KeyValuePair<string, string>("glass", "ШИЛ"),
            new KeyValuePair<string, string>("porcelain", "КЕРАМИК ХАВТАН"),
            new KeyValuePair<string, string>("ceramic", "КЕРАМИК ХАВТАН"),
            new KeyValuePair<string, string>("tile", "КЕРАМИК ХАВТАН"),
            new KeyValuePair<string, string>("marble", "ГАНТИГ"),
            new KeyValuePair<string, string>("granite", "БОРЖИН ЧУЛУУ"),
            new KeyValuePair<string, string>("stone", "ЧУЛУУ"),
            new KeyValuePair<string, string>("plywood", "ФАНЕР"),
            new KeyValuePair<string, string>("veneer", "МОДОН ӨНГӨЛГӨӨ"),
            new KeyValuePair<string, string>("oak", "ЦАРС МОД"),
            new KeyValuePair<string, string>("wood", "МОД"),
            new KeyValuePair<string, string>("timber", "МОД"),
            new KeyValuePair<string, string>("aluminium", "ХӨНГӨН ЦАГААН"),
            new KeyValuePair<string, string>("aluminum", "ХӨНГӨН ЦАГААН"),
            new KeyValuePair<string, string>("steel", "ГАН"),
            new KeyValuePair<string, string>("metal", "МЕТАЛЛ"),
            new KeyValuePair<string, string>("insulation", "ДУЛААЛГА"),
            new KeyValuePair<string, string>("carpet", "ХИВС"),
        };

        private static string English(string all)
        {
            string l = all.ToLowerInvariant();
            foreach (KeyValuePair<string, string> kv in Dictionary)
                if (l.Contains(kv.Key)) return kv.Value;
            return null;
        }
    }
}
