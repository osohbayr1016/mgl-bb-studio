using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Reflection;
using System.Text.RegularExpressions;

namespace MglBb.Core
{
    /// <summary>
    /// «Стандарт сурах»-ын цэвэр статистик: жишээ бүрээс (харагдац, хэмжээс, шошго…) утга цуглуулж, медиан (тоо), хамгийн түгээмэл (бичвэр),
    /// олонх (тийм/үгүй)-оор <see cref="BbStandard"/>-ийн талбарыг бөглөнө.  Түлхүүр = "beam.ElevScale" (төрөл.талбарын нэр) — reflection-оор
    /// <see cref="BbMemberStandard"/> / <see cref="BbSheetStandard"/>-ийн ЯГ ТЭР талбар.  Хангалттай жишээгүй (min) утга өгөгдмөлөөрөө үлдэнэ.
    /// </summary>
    public sealed class BbSamples
    {
        private readonly Dictionary<string, List<double>> _num = new Dictionary<string, List<double>>(StringComparer.Ordinal);
        private readonly Dictionary<string, Dictionary<string, int>> _str = new Dictionary<string, Dictionary<string, int>>(StringComparer.Ordinal);

        public void Num(string key, double v)
        {
            if (double.IsNaN(v) || double.IsInfinity(v)) return;
            if (!_num.TryGetValue(key, out var l)) _num[key] = l = new List<double>();
            l.Add(v);
        }

        public void Str(string key, string v)
        {
            if (string.IsNullOrEmpty(v)) return;
            if (!_str.TryGetValue(key, out var d)) _str[key] = d = new Dictionary<string, int>(StringComparer.Ordinal);
            d[v] = d.TryGetValue(v, out int n) ? n + 1 : 1;
        }

        public void Bool(string key, bool v) { Str(key, v ? "true" : "false"); }

        public int Count(string key)
        {
            if (_num.TryGetValue(key, out var l)) return l.Count;
            if (_str.TryGetValue(key, out var d)) return d.Values.Sum();
            return 0;
        }

        public double? Median(string key)
        {
            if (!_num.TryGetValue(key, out var l) || l.Count == 0) return null;
            return Percentile(l, 0.5);
        }

        public double? Pct(string key, double p)
        {
            if (!_num.TryGetValue(key, out var l) || l.Count == 0) return null;
            return Percentile(l, p);
        }

        public static double Percentile(IList<double> xs, double p)
        {
            var s = xs.OrderBy(x => x).ToList();
            if (s.Count == 1) return s[0];
            double idx = p * (s.Count - 1);
            int lo = (int)Math.Floor(idx), hi = (int)Math.Ceiling(idx);
            return s[lo] + (s[hi] - s[lo]) * (idx - lo);
        }

        public string Mode(string key)
        {
            if (!_str.TryGetValue(key, out var d) || d.Count == 0) return null;
            return d.OrderByDescending(kv => kv.Value).ThenBy(kv => kv.Key, StringComparer.Ordinal).First().Key;
        }

        public IEnumerable<KeyValuePair<string, int>> Histogram(string key)
        {
            if (!_str.TryGetValue(key, out var d)) return Enumerable.Empty<KeyValuePair<string, int>>();
            return d.OrderByDescending(kv => kv.Value);
        }

        public IEnumerable<string> Keys { get { return _num.Keys.Concat(_str.Keys).Distinct().OrderBy(k => k, StringComparer.Ordinal); } }

        /// <summary>
        /// Талбар бүрд (хангалттай жишээтэй бол) стандартад бичнэ: тоо — медиан (<paramref name="round"/> алхмаар бөөрөнхийлнө), бичвэр — mode,
        /// bool — олонх.  Буцаах: бичигдсэн талбарын тоо.
        /// </summary>
        public int ApplyTo(BbStandard std, int minSamples = 3, double round = 0.5)
        {
            int n = 0;
            foreach (string key in Keys)
            {
                int dot = key.IndexOf('.');
                if (dot <= 0) continue;
                string scope = key.Substring(0, dot), field = key.Substring(dot + 1);
                object target = scope == "beam" ? std.Beam : scope == "beamAux" ? std.BeamAux : scope == "column" ? (object)std.Column : scope == "sheet" ? std.Sheet : scope == "plate" ? (object)std.Plate : null;
                if (target == null) continue;
                FieldInfo f = target.GetType().GetField(field);
                if (f == null) continue;
                int count = Count(key);
                if (count < minSamples) continue;
                if (f.FieldType == typeof(double))
                {
                    // Хэсгийн ДЭЭД урт: медиан биш 90-р хувь (ихэнх дэлгээс богино — урт дамнуруу л хуваагдах ёстой).
                    double? m = field == "ElevMaxPartPaperMm" ? Pct(key, 0.9) : Median(key);
                    if (m == null) continue;
                    double v = round > 0 ? Math.Round(m.Value / round) * round : m.Value;
                    f.SetValue(target, v);
                }
                else if (f.FieldType == typeof(int))
                {
                    double? m = Median(key);
                    string mode = Mode(key);
                    int v;
                    if (mode != null && int.TryParse(mode, NumberStyles.Integer, CultureInfo.InvariantCulture, out int mi)) v = mi;
                    else if (m != null) v = (int)Math.Round(m.Value);
                    else continue;
                    f.SetValue(target, v);
                }
                else if (f.FieldType == typeof(bool))
                {
                    string mode = Mode(key);
                    if (mode == null) continue;
                    f.SetValue(target, mode == "true");
                }
                else if (f.FieldType == typeof(string))
                {
                    string mode = Mode(key);
                    if (mode == null) continue;
                    // Нэрийн загвар: тэмдэг нэрэнд олдсон харагдац цөөн бол (ЖИШЭЭ-1 багана: 40-өөс 7 нь «{mark} DA») өгөгдмөл хэвээр —
                    // хамгийн түгээмэл загвар тэр төрлийн харагдацын ≥ 30 %-д байх ёстой.
                    if (field.EndsWith("NamePattern", StringComparison.Ordinal))
                    {
                        int modeN = Histogram(key).First().Value;
                        int kindN = Math.Max(Count(scope + "." + (field.StartsWith("Sec", StringComparison.Ordinal) ? "SecScale" : "ElevScale")), count);
                        if (modeN < 0.3 * kindN) continue;
                    }
                    f.SetValue(target, mode);
                }
                else continue;
                std.Evidence[key] = count;
                n++;
            }
            return n;
        }
    }

    public static class BbNames
    {
        private static readonly Regex Ws = new Regex(@"\s+", RegexOptions.CultureInvariant);

        /// <summary>Харагдацын нэрээс тэмдгийг «{mark}» болгоно («ДАМНУРУУ ДН-1 АРМАТУРЧЛАЛ» → «ДАМНУРУУ {mark} АРМАТУРЧЛАЛ»).  Тэмдэггүй бол null.</summary>
        public static string Pattern(string viewName, string mark)
        {
            if (string.IsNullOrEmpty(viewName) || string.IsNullOrEmpty(mark)) return null;
            int i = IndexOfMark(viewName, mark);
            if (i < 0) return null;
            string p = viewName.Substring(0, i) + "{mark}" + viewName.Substring(i + mark.Length);
            return Ws.Replace(p, " ").Trim();
        }

        /// <summary>Огтлолын нэрийн загвар: «ДН-1 S3» → «{mark} S{n}», «Б-5 S 12» → «{mark} S {n}».  Дугааргүй бол null.</summary>
        public static string SectionPattern(string viewName, string mark)
        {
            string p = Pattern(viewName, mark);
            if (p == null) return null;
            var m = Regex.Match(p, @"(\d+)\s*$");
            if (!m.Success) return null;
            return p.Substring(0, m.Index) + "{n}";
        }

        /// <summary>Хэсгийн дагавар: «… Copy 1» → « Copy {n}».  Үндсэн нэрээс ялгаатай хэсгийг л буцаана.</summary>
        public static string PartSuffix(string partName, string baseName)
        {
            if (string.IsNullOrEmpty(partName) || string.IsNullOrEmpty(baseName) || !partName.StartsWith(baseName, StringComparison.Ordinal)) return null;
            string rest = partName.Substring(baseName.Length);
            var m = Regex.Match(rest, @"(\d+)\s*$");
            if (!m.Success || rest.Length == 0) return null;
            return rest.Substring(0, m.Index) + "{n}";
        }

        /// <summary>Тэмдгийг бүтэн үгээр хайна: «ДН-1» нь «ДН-12», «ДН-1-1»-д ТААРАХГҮЙ.</summary>
        public static int IndexOfMark(string text, string mark)
        {
            int from = 0;
            while (true)
            {
                int i = text.IndexOf(mark, from, StringComparison.Ordinal);
                if (i < 0) return -1;
                int end = i + mark.Length;
                bool leftOk = i == 0 || !char.IsLetterOrDigit(text[i - 1]);
                bool rightOk = end >= text.Length || !(char.IsLetterOrDigit(text[end]) || ((text[end] == '-' || text[end] == '.') && end + 1 < text.Length && char.IsDigit(text[end + 1])));
                if (leftOk && rightOk) return i;
                from = i + 1;
            }
        }
    }
}
