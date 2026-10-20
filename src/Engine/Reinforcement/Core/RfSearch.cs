using System;
using System.Collections.Generic;
using System.Text;

namespace RevitMcpAddin.Reinforcement.Core
{
    /// <summary>
    /// Жагсаалтын «шууд хайлт» (live search) — тэмдгийн (Family / Type) сонгогч ба эх түүврийн сонгогч ХОЁУЛАНД ЯГ ИЖИЛ дүрэм.
    /// Revit-гүй цэвэр логик; жагсаалтыг Revit-ээс НЭГ удаа цуглуулж, дараа нь энд санах ойд шүүнэ (товчлуур бүрд collector дахин ажиллуулахгүй).
    ///
    /// Дүрэм: том/жижиг үсэг үл хамаарна (кирилл, латин хоёулаа — `ToLowerInvariant`: Ө→ө, Ү→ү, Ж→ж); хайлтын үгсийг (хоосон зайгаар)
    /// БҮГД нь агуулсан мөр тохирно (AND); хоосон хайлт = бүгд.
    /// </summary>
    public static class RfSearch
    {
        /// <summary>Хайлтад зориулан хэвийжүүлнэ: захын зай тайрч, олон зайг нэг болгож, жижиг үсэг.</summary>
        public static string Normalize(string s)
        {
            if (string.IsNullOrEmpty(s)) return string.Empty;
            var sb = new StringBuilder(s.Length);
            bool space = false;
            foreach (char ch in s)
            {
                if (char.IsWhiteSpace(ch))
                {
                    space = sb.Length > 0;
                    continue;
                }
                if (space)
                {
                    sb.Append(' ');
                    space = false;
                }
                sb.Append(char.ToLowerInvariant(ch));
            }
            return sb.ToString();
        }

        /// <summary>Хайлтын үгс (хэвийжүүлсэн).</summary>
        public static string[] Tokens(string query)
        {
            string n = Normalize(query);
            if (n.Length == 0) return new string[0];
            return n.Split(new[] { ' ' }, StringSplitOptions.RemoveEmptyEntries);
        }

        /// <summary>Хайлтын БҮХ үг <paramref name="haystack"/>-д орсон эсэх.  Хоосон хайлт = үргэлж true.</summary>
        public static bool Matches(string haystack, string query)
        {
            string[] tokens = Tokens(query);
            if (tokens.Length == 0) return true;
            string h = Normalize(haystack);
            foreach (string t in tokens)
            {
                if (h.IndexOf(t, StringComparison.Ordinal) < 0) return false;
            }
            return true;
        }

        /// <summary>Хайлтад тохирсон зүйлс (анхны дарааллаар).</summary>
        public static List<T> Filter<T>(IEnumerable<T> items, Func<T, string> text, string query)
        {
            var result = new List<T>();
            if (items == null) return result;
            string[] tokens = Tokens(query);
            foreach (T item in items)
            {
                if (tokens.Length == 0 || Matches(text(item), query)) result.Add(item);
            }
            return result;
        }

        /// <summary>
        /// Тэмдгийн хайлтын текст: Family + Type + «Family : Type» — аль нэгээр нь (эсвэл хослуулан) хайж болно.
        /// </summary>
        public static string SymbolHaystack(string family, string type)
        {
            return (family ?? string.Empty) + " " + (type ?? string.Empty) + " " + (family ?? string.Empty) + " : " + (type ?? string.Empty);
        }
    }

    /// <summary>
    /// Шүүгддэг жагсаалтын төлөв (ЦЭВЭР): бүтэн жагсаалт, хайлт, харагдаж буй хэсэг, СОНГОСОН зүйл.
    /// ⚠️ Сонголт хайлтаар НУУГДСАН ч ӨӨРЧЛӨГДӨХГҮЙ — зөвхөн хэрэглэгч өөр зүйл сонгосон үед л солигдоно (хадгалсан тохиргоог чимээгүй өөрчлөхгүй).
    /// </summary>
    public sealed class RfFilteredList<T> where T : class
    {
        private readonly List<T> _all;
        private readonly Func<T, string> _text;

        public RfFilteredList(IEnumerable<T> all, Func<T, string> text)
        {
            _all = new List<T>(all ?? new T[0]);
            _text = text;
            Query = string.Empty;
            Items = new List<T>(_all);
        }

        public string Query { get; private set; }

        /// <summary>Хайлтад тохирсон (харагдаж буй) зүйлс.</summary>
        public List<T> Items { get; private set; }

        public int TotalCount { get { return _all.Count; } }

        /// <summary>Сонгосон зүйл (хайлтаар нуугдсан ч хэвээр).</summary>
        public T Selected { get; private set; }

        /// <summary>Хайлт байгаа атлаа юу ч тохироогүй («Илэрц олдсонгүй»).</summary>
        public bool NoMatch { get { return RfSearch.Tokens(Query).Length > 0 && Items.Count == 0; } }

        public bool SelectedVisible { get { return Selected != null && Items.Contains(Selected); } }

        public void SetQuery(string query)
        {
            Query = query ?? string.Empty;
            Items = RfSearch.Filter(_all, _text, Query);
        }

        /// <summary>Хэрэглэгчийн ИЛ сонголт (өөрчлөхгүй бол <see cref="SetQuery"/> сонголтыг хөндөхгүй).</summary>
        public void Select(T item)
        {
            Selected = item;
        }
    }
}
