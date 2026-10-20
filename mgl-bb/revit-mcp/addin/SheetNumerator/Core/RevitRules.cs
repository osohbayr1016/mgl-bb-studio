using System;
using System.Collections.Generic;
using System.Text;

namespace RevitMcpAddin.SheetNumerator.Core
{
    /// <summary>
    /// Revit-ийн ХУДАЛДААНЫ ХУУДСЫН дугаар / нэрийн дүрмүүд — ЗӨВХӨН УРЬД шалгалт.
    ///
    /// ⚠️ ЭНЭ НЬ ХҮЧИН ТӨГӨЛДӨР БИШ.  Эцсийн шийдвэр нь Revit-ийн `ViewSheet.SheetNumber` setter
    /// (ArgumentException).  Манай жагсаалт дутуу байж болно — тэр үед apply нь TransactionGroup-ийг
    /// бүхэлд нь буцаана (хагас дугаарлалт үлдэхгүй).
    ///
    /// Бүх утга Revit 2027.2 дээр БОДИТООР хэмжсэн (2026-10-01, `docs/SHEET_NUMERATOR.md`):
    ///  • хориглосон тэмдэгт: `\ : { } [ ] | ; &lt; &gt; ? ` ~` ба TAB / мөр шилжүүлэлт.
    ///    ⚠️ Revit-ийн албан ёсны баримт `\` ба `:`-г дурдаагүй ч setter хоёуланг нь ХОРИГЛОДОГ.
    ///  • давхардал нь ТОМ/ЖИЖИГ ҮСГИЙГ ҮЛ ЯЛГАНА («A-01» ба «a-01» давхардал).
    ///  • захын хоосон зай (space, NBSP U+00A0, U+2003, U+202F, U+180E) setter-т ТАЙРАГДАНА.
    ///  • U+200B, U+2060, U+200C, U+200D, U+FEFF, U+00AD, U+034F … тэмдэгт ХАДГАЛАГДАНА.
    /// </summary>
    public static class RevitSheetRules
    {
        /// <summary>Хуудасны дугаар/нэрэнд Revit-ийн хориглодог тэмдэгтүүд.</summary>
        public static readonly char[] ProhibitedChars =
        {
            '\\', ':', '{', '}', '[', ']', '|', ';', '<', '>', '?', '`', '~',
        };

        /// <summary>
        /// Дугаарын давхардлыг шалгах харьцуулагч.  Revit том/жижиг үсгийг ялгадаггүй
        /// (хэмжсэн: «a-01» → ArgumentException «Sheet number is already in use»).
        /// Unicode нормчлол ХЭЗЭЭ Ч хийхгүй — хоёр өөр дугаар санамсаргүй давхцаж болохгүй.
        /// </summary>
        public static readonly StringComparer NumberComparer = StringComparer.OrdinalIgnoreCase;

        /// <summary>Хориглосон тэмдэгтийг (давхардалгүй, олдсон дарааллаар) буцаана.  Хяналтын тэмдэгтийг ч.</summary>
        public static IReadOnlyList<char> FindProhibited(string s)
        {
            var found = new List<char>();
            if (string.IsNullOrEmpty(s))
                return found;
            foreach (char c in s)
            {
                if ((Array.IndexOf(ProhibitedChars, c) >= 0 || char.IsControl(c)) && !found.Contains(c))
                    found.Add(c);
            }
            return found;
        }

        /// <summary>Хориглосон тэмдэгтүүдийг хүнд уншигдахуйцаар: «: ? \u0009».</summary>
        public static string DescribeChars(IEnumerable<char> chars)
        {
            var sb = new StringBuilder();
            foreach (char c in chars)
            {
                if (sb.Length > 0)
                    sb.Append(' ');
                if (char.IsControl(c))
                    sb.Append("U+" + ((int)c).ToString("X4"));
                else
                    sb.Append(c);
            }
            return sb.ToString();
        }

        /// <summary>Revit-ийн setter тайрдаг захын тэмдэгт эсэх (хэмжсэн: space, NBSP, U+2003, U+202F, U+180E).</summary>
        public static bool IsTrimChar(char c)
        {
            return char.IsWhiteSpace(c) || c == '\u180E';
        }

        /// <summary>
        /// Revit-ийн setter-ийн хадгалах ХЭЛБЭР: захын хоосон зайг тайрна.  Урьдчилсан харалт, давхардлын
        /// шалгалт хоёулаа ЭНИЙГ ашиглана — эс бөгөөс «A-01 » ба «A-01» хоёрыг өөр гэж андуурна.
        /// </summary>
        public static string Normalize(string number)
        {
            if (number == null)
                return string.Empty;
            int start = 0;
            int end = number.Length;
            while (start < end && IsTrimChar(number[start]))
                start++;
            while (end > start && IsTrimChar(number[end - 1]))
                end--;
            return start == 0 && end == number.Length ? number : number.Substring(start, end - start);
        }

        /// <summary>Хоосон / зөвхөн хоосон зайгаас бүрдсэн эсэх (Revit ArgumentException).</summary>
        public static bool IsBlank(string number)
        {
            return string.IsNullOrEmpty(Normalize(number));
        }

        /// <summary>
        /// Apply-ийн ТҮР дугаар: `MGLTMP_&lt;guid&gt;_&lt;index&gt;`.  Энгийн харагдах тэмдэгт л (үл үзэгдэх Unicode
        /// БИШ), Revit-ийн бүх хувилбарт хууль ёсны, давхцахгүй.
        /// </summary>
        public static string TempNumber(string token, int index)
        {
            return "MGLTMP_" + token + "_" + index.ToString(System.Globalization.CultureInfo.InvariantCulture);
        }

        public const string TempPrefix = "MGLTMP_";
    }
}
