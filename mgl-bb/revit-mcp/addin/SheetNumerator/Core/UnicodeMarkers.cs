using System;
using System.Collections.Generic;
using System.Text;

namespace RevitMcpAddin.SheetNumerator.Core
{
    /// <summary>Хэвлэгддэггүй (үл үзэгдэх) Unicode тэмдэгтийн нэр дэвшигч.</summary>
    public sealed class MarkerCandidate
    {
        public MarkerCandidate(char ch, string name)
        {
            Char = ch;
            Name = name;
        }

        public char Char { get; }
        public string Name { get; }

        /// <summary>«U+200B».</summary>
        public string CodeText => "U+" + ((int)Char).ToString("X4");

        public override string ToString()
        {
            return CodeText + " " + Name;
        }
    }

    /// <summary>
    /// Мэдэгдэж буй үл үзэгдэх тэмдэгтийн ЖАГСААЛТ.
    ///
    /// ⚠️ ЭНЭ ЖАГСААЛТ = «нэр дэвшигч», БАТАЛГАА БИШ.  Хэдэн ч тэмдэгт «Unicode-д байдаг» гэдэг нь Revit-д
    /// хадгалагдана гэсэн үг биш.  Revit 2027.2 дээр хэмжсэн: U+200B, U+2060, U+200C, U+200D, U+FEFF, U+00AD,
    /// U+034F … хадгалагддаг; харин U+180E (Монгол эгшиг тусгаарлагч), U+00A0, U+2003, U+202F нь ЗАХАД
    /// тайрагдаж арилдаг.  Тиймээс хэрэглэхээс өмнө `UnicodeProbe` (Revit дотор, буцаагддаг Transaction)
    /// бодитоор шалгаж, зөвхөн хүлээн авсныг л идэвхжүүлнэ.
    /// </summary>
    public static class UnicodeMarkerCatalog
    {
        public static readonly IReadOnlyList<MarkerCandidate> Candidates = new[]
        {
            new MarkerCandidate('\u200B', "ZERO WIDTH SPACE"),
            new MarkerCandidate('\u2060', "WORD JOINER"),
            new MarkerCandidate('\u200C', "ZERO WIDTH NON-JOINER"),
            new MarkerCandidate('\u200D', "ZERO WIDTH JOINER"),
            new MarkerCandidate('\uFEFF', "ZERO WIDTH NO-BREAK SPACE"),
            new MarkerCandidate('\u2063', "INVISIBLE SEPARATOR"),
            new MarkerCandidate('\u2062', "INVISIBLE TIMES"),
            new MarkerCandidate('\u2061', "FUNCTION APPLICATION"),
            new MarkerCandidate('\u034F', "COMBINING GRAPHEME JOINER"),
            new MarkerCandidate('\u00AD', "SOFT HYPHEN"),
            new MarkerCandidate('\u200E', "LEFT-TO-RIGHT MARK"),
            new MarkerCandidate('\u200F', "RIGHT-TO-LEFT MARK"),
            // Монгол хэрэглэгчдэд хамааралтай, гэвч Revit захад ТАЙРДАГ — probe татгалзана.
            new MarkerCandidate('\u180E', "MONGOLIAN VOWEL SEPARATOR"),
        };

        public static MarkerCandidate Find(char c)
        {
            foreach (MarkerCandidate m in Candidates)
            {
                if (m.Char == c)
                    return m;
            }
            return null;
        }

        public static bool IsKnownMarker(char c)
        {
            return Find(c) != null;
        }
    }

    /// <summary>
    /// Revit-ийн одоогийн орчинд ямар тэмдэгт ХАДГАЛАГДАХЫГ probe-оор баталгаажуулсан үр дүн.
    /// <see cref="IsProbed"/> = false үед функц ИДЭВХГҮЙ (таамаглахгүй).
    /// </summary>
    public sealed class MarkerCapabilities
    {
        private readonly Dictionary<char, string> _rejected = new Dictionary<char, string>();
        private readonly List<char> _accepted = new List<char>();

        public bool IsProbed { get; set; }

        /// <summary>Probe хийх боломжгүй болсон шалтгаан (хуудас үүсгэж чадсангүй г.м.).</summary>
        public string ProbeError { get; set; }

        public IReadOnlyList<char> Accepted => _accepted;
        public IReadOnlyDictionary<char, string> Rejected => _rejected;

        public void Accept(char c)
        {
            if (!_accepted.Contains(c))
                _accepted.Add(c);
        }

        public void Reject(char c, string reason)
        {
            _rejected[c] = reason ?? string.Empty;
        }

        public bool IsAccepted(char c)
        {
            return _accepted.Contains(c);
        }

        public bool AnyAvailable => IsProbed && _accepted.Count > 0;

        /// <summary>Хэрэглэгчийн сонголтыг хүчингүй бол эхний хүлээн авсан тэмдэг (өгөгдмөл U+200B).</summary>
        public char Preferred(char wanted)
        {
            if (IsAccepted(wanted))
                return wanted;
            return _accepted.Count > 0 ? _accepted[0] : wanted;
        }
    }

    /// <summary>Нэг төрлийн үл үзэгдэх тэмдэгтийн залгаа.</summary>
    public sealed class MarkerRun
    {
        public int Index { get; set; }
        public char Marker { get; set; }
        public int Count { get; set; }
    }

    /// <summary>
    /// UnicodeMarkerService-ийн ЦЭВЭР хэсэг: оруулах, илрүүлэх, оношилгооны хэлбэрт хөрвүүлэх, цэвэрлэх,
    /// давхцахгүй дараалал үүсгэх.  Revit-тэй харьцдаг хэсэг нь `Revit/UnicodeProbe.cs`.
    ///
    /// ⚠️ Дугаарыг НОРМЧЛОХГҮЙ: энд ямар ч Unicode normalization (NFC/NFKC) байхгүй, учир нь хоёр өөр дугаар
    /// санамсаргүй давхцах ёсгүй.  Одоо байгаа үл үзэгдэх тэмдгийг чимээгүй хаяхгүй (зөвхөн ил цэвэрлэх
    /// командаар л <see cref="RemoveKnownMarkers"/>).
    /// </summary>
    public static class UnicodeMarkers
    {
        public static bool ContainsMarker(string s)
        {
            if (string.IsNullOrEmpty(s))
                return false;
            foreach (char c in s)
            {
                if (UnicodeMarkerCatalog.IsKnownMarker(c))
                    return true;
            }
            return false;
        }

        public static int CountMarkers(string s)
        {
            int n = 0;
            if (string.IsNullOrEmpty(s))
                return 0;
            foreach (char c in s)
            {
                if (UnicodeMarkerCatalog.IsKnownMarker(c))
                    n++;
            }
            return n;
        }

        public static IReadOnlyList<MarkerRun> FindRuns(string s)
        {
            var runs = new List<MarkerRun>();
            if (string.IsNullOrEmpty(s))
                return runs;
            int i = 0;
            while (i < s.Length)
            {
                char c = s[i];
                if (!UnicodeMarkerCatalog.IsKnownMarker(c))
                {
                    i++;
                    continue;
                }
                int j = i;
                while (j < s.Length && s[j] == c)
                    j++;
                runs.Add(new MarkerRun { Index = i, Marker = c, Count = j - i });
                i = j;
            }
            return runs;
        }

        /// <summary>
        /// Оношилгооны хэлбэр.  Тэмдэг бүрийн залгааг ⟦U+200B × 2⟧ гэж, байрлалд нь тавина:
        /// «A-01» + 2×U+200B → «A-01⟦U+200B × 2⟧».
        /// </summary>
        public static string Escape(string s)
        {
            if (string.IsNullOrEmpty(s))
                return s ?? string.Empty;
            var sb = new StringBuilder();
            int i = 0;
            while (i < s.Length)
            {
                char c = s[i];
                if (!UnicodeMarkerCatalog.IsKnownMarker(c))
                {
                    sb.Append(c);
                    i++;
                    continue;
                }
                int j = i;
                while (j < s.Length && s[j] == c)
                    j++;
                int count = j - i;
                sb.Append("⟦U+").Append(((int)c).ToString("X4"));
                if (count > 1)
                    sb.Append(" × ").Append(count);
                sb.Append('⟧');
                i = j;
            }
            return sb.ToString();
        }

        public static string Append(string s, char marker, int count)
        {
            if (count <= 0)
                return s ?? string.Empty;
            return (s ?? string.Empty) + new string(marker, count);
        }

        /// <summary>Мэдэгдэж буй БҮХ үл үзэгдэх тэмдгийг хасна — зөвхөн ил цэвэрлэх командаар.</summary>
        public static string RemoveKnownMarkers(string s)
        {
            if (string.IsNullOrEmpty(s))
                return s ?? string.Empty;
            var sb = new StringBuilder(s.Length);
            foreach (char c in s)
            {
                if (!UnicodeMarkerCatalog.IsKnownMarker(c))
                    sb.Append(c);
            }
            return sb.ToString();
        }

        /// <summary>
        /// Давхцахгүй дараалал: `baseNumber` + marker × k (k = 0, 1, 2…) — `isTaken` false болох эхний утга.
        /// k = 0 нь тэмдэггүй (өөрөө).  <paramref name="maxCount"/> дотор олдохгүй бол null.
        /// </summary>
        public static string MakeUnique(string baseNumber, char marker, Func<string, bool> isTaken, int maxCount, out int used)
        {
            used = 0;
            string candidate = baseNumber;
            for (int k = 0; k <= maxCount; k++)
            {
                candidate = k == 0 ? baseNumber : baseNumber + new string(marker, k);
                if (!isTaken(candidate))
                {
                    used = k;
                    return candidate;
                }
            }
            return null;
        }
    }
}
