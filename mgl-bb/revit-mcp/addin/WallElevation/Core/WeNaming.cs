using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;

namespace RevitMcpAddin.WallElevation.Core
{
    /// <summary>
    /// Харагдац / хуудасны нэр.  ⚠️ Нэр нь ЗӨВХӨН харуулах зориулалттай — харагдацыг таних нь
    /// <see cref="WeIdentity"/> (Extensible Storage-ийн түлхүүр).  Хэрэглэгч нэрийг солиход хэрэгсэл ДАХИН
    /// нэрлэхгүй (`GeneratedName`-ээр мэднэ).
    /// </summary>
    public static class WeNaming
    {
        /// <summary>Project Browser-т олдоход хялбар («ДЭЛГЭЭС-205A (L2)») — оффисын «ДЭЛГЭЭС-2А» хэлбэр + давхар (ижил өрөөний дугаар өөр давхарт).</summary>
        public const string DefaultViewPattern = "ДЭЛГЭЭС-{Room}{Side} ({Level})";
        public const string DefaultSheetPattern = "WE-{Level}-{Room}";
        /// <summary>Хуудас, түлхүүр план дээрх тэмдэг — жишээ зургийн «205A».</summary>
        public const string DefaultLabelPattern = "{Room}{Side}";
        /// <summary>Viewport-ийн гарчиг («Title on Sheet»).</summary>
        public const string DefaultTitlePattern = "ХАНЫН ДЭЛГЭЭС {Room}{Side}";
        /// <summary>Хуудасны нэр (өрөө горим) — жишээ хуудас «206-ЭМЭГТЭЙ … ӨРӨӨ ХАНЫН ДЭЛГЭЭС / A BLOCK 2-Р ДАВХАР/ /206A-G/» (том үсгээр).</summary>
        public const string DefaultSheetNamePattern = "{Room}-{RoomName} ХАНЫН ДЭЛГЭЭС / {Level}/ /{Room}{SideRange}/";

        /// <summary>
        /// Төслийн өөрийн өрөөний хуудасны нэрнээс сурсан загвар (MITIC ИЗД1_A2_41: «219-АЦӨ/ ЭРЭГТЭЙ/ӨРӨӨ ХАНЫН ДЭЛГЭЭС /A BLOCK 2-Р ДАВХАР/ /219A-I/»,
        /// сүүлийнх нь «218 АЦӨ /ЭМЭГТЭЙ/ ӨРӨӨ …») — дугаарын дараах тусгаарлагч (зай эсвэл «-») ба {Level}-ийн оронд төслийн бүсийн бичвэр.
        /// </summary>
        public static string LearnedSheetNamePattern(string roomSeparator)
        {
            return "{Room}" + (roomSeparator == "-" ? "-" : " ") + "{RoomName} ХАНЫН ДЭЛГЭЭС /{Level}/ /{Room}{SideRange}/";
        }

        private static readonly Regex RoomSheetRe = new Regex(
            @"^\s*(?<num>\d[\w.]*(?:\s*,\s*\d[\w.]*)*)\s*(?<sep>-|\s)\s*(?<rest>.*?)ХАНЫН\s+ДЭЛГЭЭС\s*/(?<zone>[^/]*)/",
            RegexOptions.CultureInvariant | RegexOptions.IgnoreCase);

        /// <summary>
        /// Өрөөний дэлгээсийн хуудасны нэрийг задлана: «205-… ХАНЫН ДЭЛГЭЭС /A BLOCK 2-Р ДАВХАР/ /205A-F/» → тусгаарлагч «-», бүс «A BLOCK 2-Р ДАВХАР».
        /// Бүс нь өрөөний дугаараар эхэлбэл («/205O-Q, 204A-D/») — үсгийн муж, бүс биш (false).  Зай давхардлыг нэгтгэнэ.
        /// </summary>
        public static bool TryParseRoomSheetName(string name, out string separator, out string zone)
        {
            separator = null; zone = null;
            if (string.IsNullOrWhiteSpace(name)) return false;
            Match m = RoomSheetRe.Match(name);
            if (!m.Success) return false;
            string z = Regex.Replace(m.Groups["zone"].Value, @"\s+", " ").Trim();
            string first = m.Groups["num"].Value.Split(',')[0].Trim();
            if (z.Length == 0 || z.StartsWith(first, StringComparison.OrdinalIgnoreCase)) return false;
            separator = m.Groups["sep"].Value == "-" ? "-" : " ";
            zone = z;
            return true;
        }

        /// <summary>
        /// Хуудасны дугаарыг угтвар + тоо болгоно: «БА413» → («БА», 413, 3), «ИЗД1_A2_39» → («ИЗД1_A2_», 39, 2).  Угтвар дотор тоо байвал
        /// зөвхөн «_»-аар төгссөн үед (MITIC «ИЗД1_A2_»); «БА107.1» (дэд хуудас) цуваа биш.
        /// </summary>
        public static bool SplitSheetNumber(string s, out string prefix, out int n, out int digits)
        {
            prefix = null; n = 0; digits = 0;
            if (string.IsNullOrEmpty(s)) return false;
            int i = s.Length;
            while (i > 0 && char.IsDigit(s[i - 1])) i--;
            if (i == s.Length || i == 0) return false;
            digits = s.Length - i;
            prefix = s.Substring(0, i);
            bool hasDigit = false;
            foreach (char c in prefix) if (char.IsDigit(c)) { hasDigit = true; break; }
            if (hasDigit && prefix[prefix.Length - 1] != '_') return false;
            return int.TryParse(s.Substring(i), NumberStyles.None, CultureInfo.InvariantCulture, out n);
        }

        /// <summary>
        /// Танигдах хэсгүүд.  {RoomNumber} = {Room}; {WallIndex} = бүлэг доторх дугаар (1, 2 …); {SideRange} = бүлгийн үсгийн муж («A-F»).
        /// </summary>
        public static readonly string[] Tokens = { "{Level}", "{Room}", "{RoomNumber}", "{RoomName}", "{Side}", "{Wall}", "{WallIndex}", "{Type}", "{SideRange}" };

        private static readonly Regex TokenRe = new Regex(@"\{[^{}]*\}", RegexOptions.CultureInvariant);

        /// <summary>Revit-ийн харагдац/хуудасны нэрэнд хориотой тэмдэгт.</summary>
        private const string Forbidden = "\\:{}[]|;<>?`~";

        public static List<string> UnknownTokens(string pattern)
        {
            var r = new List<string>();
            if (string.IsNullOrEmpty(pattern)) return r;
            foreach (Match m in TokenRe.Matches(pattern))
            {
                bool known = false;
                foreach (string t in Tokens)
                    if (string.Equals(t, m.Value, StringComparison.OrdinalIgnoreCase)) { known = true; break; }
                if (!known && !r.Contains(m.Value)) r.Add(m.Value);
            }
            return r;
        }

        /// <summary>
        /// Бүх танигдах хэсгийн утга — <see cref="Expand"/>-д ҮРГЭЛЖ бүтнээр өгнө (өгөөгүй хэсэг «{…}» хэвээр үлдэж Revit-ийн нэрэнд
        /// хориотой тэмдэгт болно).
        /// </summary>
        public static Dictionary<string, string> Values(string level, string room, string roomName, string side, string wall,
                                                        int wallIndex, string type, string sideRange)
        {
            return new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
            {
                { "{Level}", level ?? string.Empty },
                { "{Room}", room ?? string.Empty },
                { "{RoomNumber}", room ?? string.Empty },
                { "{RoomName}", roomName ?? string.Empty },
                { "{Side}", side ?? string.Empty },
                { "{Wall}", wall ?? string.Empty },
                { "{WallIndex}", wallIndex > 0 ? wallIndex.ToString(CultureInfo.InvariantCulture) : string.Empty },
                { "{Type}", type ?? string.Empty },
                { "{SideRange}", sideRange ?? string.Empty },
            };
        }

        /// <summary>Загварыг утгаар орлуулж, хориотой тэмдэгтийг цэвэрлэнэ.  Хоосон хэсгээс үүсэх «--»-ийг нэгтгэнэ.</summary>
        public static string Expand(string pattern, IDictionary<string, string> values)
        {
            string p = string.IsNullOrWhiteSpace(pattern) ? DefaultViewPattern : pattern;
            string expanded = TokenRe.Replace(p, m =>
            {
                foreach (KeyValuePair<string, string> kv in values)
                    if (string.Equals(kv.Key, m.Value, StringComparison.OrdinalIgnoreCase))
                        return Clean(kv.Value);
                return m.Value;   // Validate-ээр барина; энд таамаглахгүй
            });
            return Tidy(expanded);
        }

        /// <summary>
        /// Энэ утга хэрэгслийн <paramref name="pattern"/>-оор бичигдсэн үү — тал/хана/дугаар шилжсэн ч: {Side}, {SideRange}, {Wall},
        /// {WallIndex}, {Type} — дурын (1–40 тэмдэгт), бусад токен — <paramref name="values"/>-ийн утга (өрөөний дугаар, түвшин …).
        /// Тогтмол хэсэг огт үлдэхгүй загварт (жишээ «{Side}») false — хэрэглэгчийн бичсэн утгыг таахгүй.  Үсэг шилжихэд хуудсан дээрх
        /// viewport-ийн дугаар/гарчгийг шинэчлэх эсэхийг шийднэ (аудит: түлхүүр план «205B», хуудас «205C» болж зөрдөг байв).
        /// </summary>
        public static bool LooksGenerated(string pattern, string actual, IDictionary<string, string> values)
        {
            if (string.IsNullOrWhiteSpace(pattern) || string.IsNullOrWhiteSpace(actual)) return false;
            var wild = new HashSet<string>(new[] { "{Side}", "{SideRange}", "{Wall}", "{WallIndex}", "{Type}" }, StringComparer.OrdinalIgnoreCase);
            var sb = new StringBuilder("^");
            int last = 0;
            bool hasFixed = false;
            foreach (Match m in TokenRe.Matches(pattern))
            {
                string lit = pattern.Substring(last, m.Index - last);
                if (lit.Trim().Length > 0) hasFixed = true;
                sb.Append(Regex.Escape(lit));
                if (wild.Contains(m.Value)) sb.Append(".{1,40}?");
                else
                {
                    string v = null;
                    if (values != null)
                        foreach (KeyValuePair<string, string> kv in values)
                            if (string.Equals(kv.Key, m.Value, StringComparison.OrdinalIgnoreCase)) { v = Clean(kv.Value); break; }
                    if (!string.IsNullOrEmpty(v)) hasFixed = true;
                    sb.Append(Regex.Escape(v ?? string.Empty));
                }
                last = m.Index + m.Length;
            }
            string tail = pattern.Substring(last);
            if (tail.Trim().Length > 0) hasFixed = true;
            sb.Append(Regex.Escape(tail)).Append('$');
            if (!hasFixed) return false;
            return Regex.IsMatch(actual.Trim(), sb.ToString(), RegexOptions.CultureInvariant | RegexOptions.IgnoreCase);
        }

        /// <summary>Нэг утгыг цэвэрлэнэ: хориотой тэмдэгт → «-», мөр таслал → зай.</summary>
        public static string Clean(string value)
        {
            if (string.IsNullOrEmpty(value)) return string.Empty;
            var sb = new StringBuilder(value.Length);
            foreach (char c in value)
            {
                if (c == '\r' || c == '\n' || c == '\t') sb.Append(' ');
                else if (Forbidden.IndexOf(c) >= 0) sb.Append('-');
                else sb.Append(c);
            }
            return sb.ToString().Trim();
        }

        /// <summary>Хоосон утгаас үүссэн давхар тусгаарлагч, эхэн/төгсгөлийн тусгаарлагчийг арилгана.</summary>
        public static string Tidy(string s)
        {
            if (string.IsNullOrEmpty(s)) return string.Empty;
            // «WE-L01--A» (өрөөний дугааргүй) → «WE-L01-A»; «- -» ч мөн.
            string t = Regex.Replace(s, @"-(\s*-)+", "-", RegexOptions.CultureInvariant);
            t = Regex.Replace(t, @"_{2,}", "_", RegexOptions.CultureInvariant);
            t = Regex.Replace(t, @" {2,}", " ", RegexOptions.CultureInvariant);
            return t.Trim(' ', '-', '_');
        }

        /// <summary>Давхардвал « (2)», « (3)» … — тодорхой дараалалтай (deterministic).</summary>
        public static string Unique(string desired, ICollection<string> taken)
        {
            string baseName = string.IsNullOrWhiteSpace(desired) ? "WE" : desired;
            if (!taken.Contains(baseName)) return baseName;
            for (int i = 2; i < 10000; i++)
            {
                string n = baseName + " (" + i.ToString(CultureInfo.InvariantCulture) + ")";
                if (!taken.Contains(n)) return n;
            }
            return baseName + " (" + Guid.NewGuid().ToString("N").Substring(0, 6) + ")";
        }

        /// <summary>Хуудасны дугаарт зай хэрэглэхгүй: «-2», «-3» залгавар.</summary>
        public static string UniqueNumber(string desired, ICollection<string> taken)
        {
            string baseNo = string.IsNullOrWhiteSpace(desired) ? "WE" : desired;
            if (!taken.Contains(baseNo)) return baseNo;
            for (int i = 2; i < 10000; i++)
            {
                string n = baseNo + "-" + i.ToString(CultureInfo.InvariantCulture);
                if (!taken.Contains(n)) return n;
            }
            return baseNo + "-" + Guid.NewGuid().ToString("N").Substring(0, 6);
        }

        private static readonly string[] Compass8 = { "Хойд", "Зүүн хойд", "Зүүн", "Зүүн урд", "Урд", "Баруун урд", "Баруун", "Баруун хойд" };

        /// <summary>
        /// Харах чиглэлээр (өрөөнөөс хана руу) ханын байрлалыг үгээр: хойш харвал «Хойд хана».  Зүүн = east, баруун = west
        /// (монгол уламжлал).  Проектын хойд биш, загварын +Y-ийг хойд гэж үзнэ.
        /// </summary>
        public static string CompassName(WeV3 look)
        {
            double az = RoomBoundaryAnalyzer.Azimuth(look.Flat());
            int i = (int)Math.Floor((az + 22.5) / 45.0) % 8;
            return Compass8[i];
        }

        /// <summary>
        /// Бүлгийн үсгийн муж: A, B, C, D → «A-D»; ганц → «A»; дараалалгүй (A, C) → «A-C» (хамгийн бага — их).  «?» тоологдохгүй.
        /// </summary>
        public static string SideRange(IEnumerable<string> letters)
        {
            var list = new List<string>();
            foreach (string l in letters)
                if (!string.IsNullOrEmpty(l) && l != "?" && !list.Contains(l)) list.Add(l);
            if (list.Count == 0) return string.Empty;
            list.Sort((a, b) => a.Length != b.Length ? a.Length.CompareTo(b.Length) : string.CompareOrdinal(a, b));
            return list.Count == 1 ? list[0] : list[0] + "-" + list[list.Count - 1];
        }

        /// <summary>
        /// Хэрэгслийн өөрийн нэр/гарчгийн ҮСГИЙН МУЖЫГ шинэчлэх (2026-10-14, «+ Хана нэмэх»: өрөөнд E нэмэгдэхэд өмнөх хуудас «/101A-D/», түлхүүр
        /// план «Түлхүүр байгуулалт — 101A-D» хэвээр үлддэг байв).  <paramref name="current"/> нь <paramref name="expected"/>-ээс ЗӨВХӨН муж
        /// (expected доторх СҮҮЛЧИЙН <paramref name="range"/>-ийн байранд өөр «A», «A-D», «AA-AC») ялгаатай бол <paramref name="expected"/>;
        /// ижил эсвэл хэрэглэгч өөр хэсгийг өөрчилсөн бол null (хөндөхгүй).
        /// </summary>
        public static string Rerange(string current, string expected, string range)
        {
            if (string.IsNullOrEmpty(current) || string.IsNullOrEmpty(expected) || string.IsNullOrEmpty(range)) return null;
            if (string.Equals(current, expected, StringComparison.Ordinal)) return null;
            int i = expected.LastIndexOf(range, StringComparison.Ordinal);
            if (i < 0) return null;
            string re = "^" + Regex.Escape(expected.Substring(0, i)) + RangeRe + Regex.Escape(expected.Substring(i + range.Length)) + "$";
            return Regex.IsMatch(current, re, RegexOptions.CultureInvariant) ? expected : null;
        }

        /// <summary>Үсгийн муж: «A», «A-D», «AA-AC» (<see cref="Letter"/>-ийн хэлбэр); W05-аас тоон муж «1-4», «01-12» ч.</summary>
        private const string RangeRe = "[A-Z0-9]{1,4}(?:-[A-Z0-9]{1,4})?";

        /// <summary>0 → A, 25 → Z, 26 → AA …</summary>
        public static string Letter(int index)
        {
            if (index < 0) index = 0;
            var sb = new StringBuilder();
            int n = index;
            do
            {
                sb.Insert(0, (char)('A' + n % 26));
                n = n / 26 - 1;
            } while (n >= 0);
            return sb.ToString();
        }
    }

    /// <summary>
    /// Үүсгэсэн харагдацын ТАНИЛТ — Extensible Storage-д хадгалагдана.  Нэр биш.
    /// Түлхүүр = эх ханын UniqueId + (өрөөний UniqueId) + харагчийн тал.  Тал нь ханын ГАДНА/ДОТОР талаар
    /// илэрхийлэгдэх тул хана эргэсэн, сунасан ч түлхүүр тогтвортой.
    /// </summary>
    public static class WeIdentity
    {
        /// <summary>Генераторын хувилбар — хадгалсан бичлэгт.  Логик эрс өөрчлөгдвөл өсгөж, хуучныг шинэчилнэ.</summary>
        public const int GeneratorVersion = 1;

        public static string Key(string roomUid, string wallUid, string side)
        {
            return "v1|room:" + (roomUid ?? string.Empty) + "|wall:" + (wallUid ?? string.Empty) + "|side:" + (side ?? string.Empty);
        }

        /// <summary>
        /// Геометр + харагдацын тохиргооны хураангуй (≈ 0.3 мм / 0.0006° нарийвчлал).  Хадгалсантай ижил бол
        /// «өөрчлөгдөөгүй» → харагдацад хүрэхгүй.
        /// </summary>
        public static string Signature(WeFrame f, WeBox b, string viewSetupToken)
        {
            if (f == null || b == null) return string.Empty;
            var sb = new StringBuilder();
            sb.Append("o:").Append(Q(f.Origin.X)).Append(',').Append(Q(f.Origin.Y)).Append(',').Append(Q(f.Origin.Z));
            sb.Append("|l:").Append(QD(f.Look.X)).Append(',').Append(QD(f.Look.Y));
            sb.Append("|b:").Append(Q(b.MinX)).Append(',').Append(Q(b.MaxX)).Append(',').Append(Q(b.MinY)).Append(',')
              .Append(Q(b.MaxY)).Append(',').Append(Q(b.Near)).Append(',').Append(Q(b.Far));
            sb.Append("|s:").Append(viewSetupToken ?? string.Empty);
            return sb.ToString();
        }

        /// <summary>Тэмдэглэгээний хураангуйг тэмдэгт залгах тэмдэглэгээ.</summary>
        public const string AnnotationMarker = "|a:";

        /// <summary>Геометр + харагдацын тохиргооны хэсэг (тэмдэглэгээгүй) — харагдацыг зөөх эсэхийг үүгээр шийднэ.</summary>
        public static string GeometryPart(string signature)
        {
            if (string.IsNullOrEmpty(signature)) return string.Empty;
            int i = signature.IndexOf(AnnotationMarker, StringComparison.Ordinal);
            return i < 0 ? signature : signature.Substring(0, i);
        }

        /// <summary>Тэмдэглэгээний хэсэг (байхгүй бол хоосон).</summary>
        public static string AnnotationPart(string signature)
        {
            if (string.IsNullOrEmpty(signature)) return string.Empty;
            int i = signature.IndexOf(AnnotationMarker, StringComparison.Ordinal);
            return i < 0 ? string.Empty : signature.Substring(i + AnnotationMarker.Length);
        }

        /// <summary>Хэрэглэгчийн тогтоосон босоо хүрээний тэмдэглэгээ (W07) — геометрийн хэсэгт (тэмдэглэгээний <see cref="AnnotationMarker"/>-ээс ӨМНӨ).</summary>
        public const string CropMarker = "|c:";

        /// <summary>
        /// Геометрийн тэмдэгт хэрэглэгчийн ТОГТООСОН босоо хүрээг залгана (W07): авто ↔ тогтоосон солигдоход хайрцаг ижил байсан ч харагдац
        /// «шинэчлэгдэж» төлөв (<see cref="WeViewState"/>) дахин бичигдэнэ.  Хоёр тал авто бол тэмдэг ХУУЧИН хэлбэрээрээ (дахин ажиллуулахад
        /// өөрчлөгдөөгүй харагдац «Keep» хэвээр).
        /// </summary>
        public static string WithCrop(string geometrySignature, double lowerMm, double upperMm)
        {
            if (double.IsNaN(lowerMm) && double.IsNaN(upperMm)) return geometrySignature ?? string.Empty;
            Func<double, string> mm = v => double.IsNaN(v) ? "a" : ((long)Math.Round(v, MidpointRounding.AwayFromZero)).ToString(CultureInfo.InvariantCulture);
            return (geometrySignature ?? string.Empty) + CropMarker + mm(lowerMm) + "," + mm(upperMm);
        }

        /// <summary>
        /// W01 (2026-10-16): харагдацыг үүсгэх/зөөх үед бичих тэмдэг — тэмдэглэгээний хэсэггүй («тэмдэглэгээ хүлээгдэж байна»).  Тэмдэглэгээ
        /// амжилттай commit болсны ДАРАА бүтэн тэмдэг бичигдэнэ.  Ажил дундаас зогссон/цуцалсан/дахин төлөвлөсөн бол дараагийн ажиллуулалт
        /// харагдацыг «зөвхөн тэмдэглэгээ шинэчлэгдэнэ» гэж танина — тэмдэглэгээгүй харагдац «өөрчлөлтгүй» мэт ҮЛДЭХГҮЙ.
        /// </summary>
        public static string Pending(string signature)
        {
            return GeometryPart(signature);
        }

        public static string WithAnnotation(string geometrySignature, string digest)
        {
            return string.IsNullOrEmpty(digest) ? geometrySignature ?? string.Empty : (geometrySignature ?? string.Empty) + AnnotationMarker + digest;
        }

        private static string Q(double ft)
        {
            long v = (long)Math.Round(ft * 1000.0, MidpointRounding.AwayFromZero);
            return v.ToString(CultureInfo.InvariantCulture);
        }

        private static string QD(double d)
        {
            long v = (long)Math.Round(d * 100000.0, MidpointRounding.AwayFromZero);
            return v.ToString(CultureInfo.InvariantCulture);
        }
    }
}
