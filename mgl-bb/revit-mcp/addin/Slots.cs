using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text.RegularExpressions;

namespace RevitMcpAddin
{
    /// <summary>
    /// СЛОТ ГАРГАХ — санаа таньсны дараа «юун дээр» ба «хэдэн хувь» гэдгийг олох.
    ///
    /// Санаа зөв таних нь хагас нь.  «БА-01 ыг ялга» гэхэд аль хуудсыг гэдгийг
    /// олж чадахгүй бол туслах ажиллахгүй.  Энэ файл нь тэр хоёр слотыг гаргана.
    ///
    /// ⚠️ ЯАГААД ЗАСАГДСАН БЭ (2026-08-25):
    /// Өмнөх код нь `num.Replace(" ","")`-ийг мөрөөр нь харьцуулдаг байсан тул
    ///   • «BA-01» гэж ЛАТИНААР бичихэд кирилл «БА-01» хуудас ОЛДОХГҮЙ
    ///   • «БА01» гэж зураасгүй бичихэд «БА-01» ОЛДОХГҮЙ
    ///   • «ба 1» гэж тэггүй бичихэд «БА-01» ОЛДОХГҮЙ
    /// Гурвуулаа бодит хэрэглээнд байнга тохиолддог.  Одоо `TextFold.FoldCode`
    /// дээр тулгуурлаж гурвууланг нь барина.
    ///
    /// ⚠️ ХОЁРДМОЛ БОЛ NULL БУЦААНА.  Хоёр хуудас адилхан сайн таарвал таамаглаж
    /// сонгохгүй — буруу хуудас тусгаарлахаас асуусан нь дээр.
    /// </summary>
    internal static class Slots
    {
        /// <summary>Revit-ээс ирсэн хуудасны мөр.</summary>
        internal sealed class SheetRef
        {
            public string Number { get; set; }
            public string Name { get; set; }
            public string Uid { get; set; }
        }

        // Эвхсэн текст дэх «үсэг + тоо» хослол.  Эвхэлт нь зураас/доогуур
        // зураасыг ЗАЙ болгодог тул «ба 01» ба «ба01» хоёул энд таарна.
        private static readonly Regex CodeLike =
            new Regex(@"([a-z]{1,6})\s*(\d{1,4})", RegexOptions.Compiled);

        // Хувь: «70%», «70 хувь», «70 huvi», «70 percent».
        // ⚠️ ТҮҮХИЙ текст дээр ажиллана — эвхэлт «%»-ийг устгадаг.
        private static readonly Regex PercentSign =
            new Regex(@"(\d{1,3})\s*%", RegexOptions.Compiled);

        private static readonly Regex PercentWord = new Regex(
            @"(\d{1,3})\s*(хувь|хувийн|хувьтай|хувиар|huvi|huv|huviar|percent|pct)",
            RegexOptions.Compiled | RegexOptions.IgnoreCase);

        /// <summary>
        /// «Хэдэн хувь» гэснийг гаргана.  Олдохгүй бол null.
        /// 0–100 хооронд хязгаарлана; түүнээс гадуур бол ҮГҮЙСГЭНЭ (буруу
        /// уншсан гэсэн үг — «БА-150» доторх 150-г хувь гэж бодохгүй).
        /// </summary>
        public static double? Percent(string raw)
        {
            if (string.IsNullOrWhiteSpace(raw)) return null;

            Match m = PercentSign.Match(raw);
            if (!m.Success) m = PercentWord.Match(raw);
            if (!m.Success) return null;

            int v;
            if (!int.TryParse(m.Groups[1].Value, NumberStyles.None,
                              CultureInfo.InvariantCulture, out v)) return null;
            if (v < 0 || v > 100) return null;
            return v;
        }

        /// <summary>
        /// Текстээс хуудасны шифр байж болох нэр дэвшигчүүд («ba01» хэлбэрээр).
        /// Бодит жагсаалттай тулгахгүйгээр ЭНЭ НЬ ЗӨВХӨН ТААМАГ.
        /// </summary>
        public static List<string> Candidates(string raw)
        {
            var found = new List<string>();
            if (string.IsNullOrWhiteSpace(raw)) return found;

            string folded = TextFold.Fold(raw);
            Collect(folded, found);

            // ⚠️ «0» ба «o», «1» ба «l» нь ХАРАГДАЦААР ижил тул «БА-01»-ийг
            // «ba-o1» гэж бичих нь бий.  Гэхдээ бүх «o»-г «0» болговол
            // «харуул» → «har001» болж бүхэлдээ эвдэрнэ — тиймээс ЗӨВХӨН
            // АЛЬ ХЭДИЙН ТОО АГУУЛСАН үг дотор солино.  «o1» → «01» болох
            // ч «haruul» хөндөгдөхгүй.
            string fixedUp = FixDigitLookalikes(folded);
            if (!string.Equals(fixedUp, folded, StringComparison.Ordinal))
                Collect(fixedUp, found);

            return found;
        }

        private static void Collect(string text, List<string> into)
        {
            foreach (Match m in CodeLike.Matches(text))
            {
                string c = m.Groups[1].Value + m.Groups[2].Value;
                if (!into.Contains(c)) into.Add(c);
            }
        }

        private static string FixDigitLookalikes(string folded)
        {
            string[] parts = folded.Split(' ');
            bool changed = false;

            for (int i = 0; i < parts.Length; i++)
            {
                string p = parts[i];
                bool hasDigit = false;
                for (int j = 0; j < p.Length; j++)
                {
                    if (p[j] >= '0' && p[j] <= '9') { hasDigit = true; break; }
                }
                if (!hasDigit) continue;

                string swapped = p.Replace('o', '0').Replace('l', '1');
                if (!string.Equals(swapped, p, StringComparison.Ordinal))
                {
                    parts[i] = swapped;
                    changed = true;
                }
            }

            return changed ? string.Join(" ", parts) : folded;
        }

        /// <summary>Хүнд харуулах/бүртгэх зориулалттай шифр. Олдохгүй бол null.</summary>
        public static string SheetHint(string raw)
        {
            string folded = TextFold.Fold(raw);
            Match m = CodeLike.Match(folded);
            return m.Success ? m.Groups[1].Value.ToUpperInvariant() + "-" + m.Groups[2].Value : null;
        }

        /// <summary>Тооны эхний тэгүүдийг хасна: «ba01» → «ba1».</summary>
        private static string Loose(string code)
        {
            return Regex.Replace(code, @"0+(\d)", "$1");
        }

        /// <summary>
        /// Бодит хуудасны жагсаалттай тулгаж ХАМГИЙН САЙН таарцыг олно.
        ///
        /// Дараалал (эхнийх нь ялна):
        ///   1. шифр ЯГ таарах            «ba01» = «ba01»
        ///   2. шифр тэггүй таарах        «ba1»  = «ba01»
        ///   3. хуудасны НЭР бүтнээрээ орсон  («фасад харуул» → «Фасад»)
        ///
        /// Түвшин бүрд ХОЁР ба түүнээс дээш хуудас таарвал null буцаана —
        /// таамаглахаас асуусан нь дээр.
        /// </summary>
        public static SheetRef MatchSheet(IReadOnlyList<SheetRef> sheets, string raw)
        {
            if (sheets == null || sheets.Count == 0 || string.IsNullOrWhiteSpace(raw))
                return null;

            List<string> cands = Candidates(raw);

            // --- 1-р түвшин: шифр яг таарах ---
            SheetRef hit = Unique(sheets, s =>
            {
                string code = TextFold.FoldCode(s.Number);
                return code.Length > 0 && cands.Contains(code);
            });
            if (hit != null) return hit;

            // --- 2-р түвшин: тэггүй хэлбэрээр таарах ---
            if (cands.Count > 0)
            {
                var loose = new List<string>();
                foreach (string c in cands) loose.Add(Loose(c));
                hit = Unique(sheets, s =>
                {
                    string code = TextFold.FoldCode(s.Number);
                    return code.Length > 0 && loose.Contains(Loose(code));
                });
                if (hit != null) return hit;
            }

            // --- 3-р түвшин: шифрийн ОЙРЫН таарц (засварын зай ≤ 1) ---
            // ⚠️ Кирилл «с» ба латин «c» нь ХАРАГДАЦААР ижил тул хүмүүс
            // «ХАС-03»-ыг «hac-03» гэж бичдэг (дуудлагаар «has» байхад).
            // Мөн «о/0», «l/1» солигддог.
            //
            // ⚠️ ЭНЭ ЗАСВАРЫГ ЕРӨНХИЙ ЭВХЭЛТЭД ХИЙЖ БОЛОХГҮЙ: латин «c»-г
            // «s» болговол «ц»→"ts"→"c"→"s" болж «цаг»/«саг» нийлнэ, мөн
            // англи «cat»→«sat» болно.  Шифр нь ХААЛТТАЙ, БОГИНО олонлог
            // тул зөвхөн энд ойролцоо таарцыг зөвшөөрч болно.
            //
            // Хамгийн ойрхон ЯГ НЭГ шифр байвал л авна.  «ba03» гэвэл
            // «ba01» ба «ba02» хоёул 1 зайд байх тул тэнцээд NULL болно.
            if (cands.Count > 0)
            {
                SheetRef near = null;
                int bestDist = int.MaxValue;
                bool nearTie = false;

                for (int i = 0; i < sheets.Count; i++)
                {
                    SheetRef s = sheets[i];
                    if (s == null || string.IsNullOrWhiteSpace(s.Uid)) continue;

                    string code = TextFold.FoldCode(s.Number);
                    if (code.Length < 3) continue;

                    for (int c = 0; c < cands.Count; c++)
                    {
                        if (cands[c].Length < 3) continue;
                        int dist = Distance(cands[c], code, 1);
                        if (dist > 1) continue;

                        if (dist < bestDist) { bestDist = dist; near = s; nearTie = false; }
                        else if (dist == bestDist && !ReferenceEquals(near, s)) nearTie = true;
                    }
                }
                if (near != null && !nearTie) return near;
            }

            // --- 4-р түвшин: хуудасны НЭРЭЭР ---
            // ⚠️ Хүмүүс дугаараар нь биш нэрээр нь дууддаг: «фасад харуул».
            // Бүтэн нэр таарахыг шаардвал ажиллахгүй («Нүүр фасад» ≠ «фасад»),
            // тиймээс ҮГ ТУТМЫН давхцлыг тоолж, хамгийн олон таарсныг авна.
            // 4 тэмдэгтээс богино үгийг тоохгүй — «1», «ба» гэх мэт нь
            // хэт олон хуудсанд таарч, санамсаргүй ялагч гаргана.
            string text = " " + TextFold.Fold(raw) + " ";
            SheetRef best = null;
            int bestScore = 0;
            bool tie = false;

            for (int i = 0; i < sheets.Count; i++)
            {
                SheetRef s = sheets[i];
                if (s == null || string.IsNullOrWhiteSpace(s.Uid)) continue;

                string nm = TextFold.Fold(s.Name);
                if (nm.Length == 0) continue;

                int score = 0;
                foreach (string w in nm.Split(' '))
                {
                    if (w.Length < 4) continue;
                    if (text.IndexOf(" " + w + " ", StringComparison.Ordinal) >= 0) score++;
                }
                if (score == 0) continue;

                if (score > bestScore) { bestScore = score; best = s; tie = false; }
                else if (score == bestScore) tie = true;
            }

            return tie ? null : best;
        }

        /// <summary>
        /// Левенштейн зай, `max`-аас хэтэрвэл эрт зогсоно.
        /// Шифр нь 3–8 тэмдэгт тул хялбар хувилбар хангалттай.
        /// </summary>
        private static int Distance(string a, string b, int max)
        {
            if (a == b) return 0;
            if (Math.Abs(a.Length - b.Length) > max) return max + 1;

            int[] prev = new int[b.Length + 1];
            int[] cur = new int[b.Length + 1];
            for (int j = 0; j <= b.Length; j++) prev[j] = j;

            for (int i = 1; i <= a.Length; i++)
            {
                cur[0] = i;
                int rowMin = cur[0];
                for (int j = 1; j <= b.Length; j++)
                {
                    int cost = a[i - 1] == b[j - 1] ? 0 : 1;
                    int v = Math.Min(Math.Min(cur[j - 1] + 1, prev[j] + 1), prev[j - 1] + cost);
                    cur[j] = v;
                    if (v < rowMin) rowMin = v;
                }
                // Мөр бүхэлдээ хязгаараас хэтэрсэн бол цааш үзэх утгагүй.
                if (rowMin > max) return max + 1;

                int[] swap = prev; prev = cur; cur = swap;
            }
            return prev[b.Length];
        }

        /// <summary>Нөхцөлд таарах ЯГ НЭГ мөр байвал буцаана, эс тэгвээс null.</summary>
        private static SheetRef Unique(IReadOnlyList<SheetRef> sheets, Func<SheetRef, bool> pred)
        {
            SheetRef found = null;
            for (int i = 0; i < sheets.Count; i++)
            {
                SheetRef s = sheets[i];
                if (s == null || string.IsNullOrWhiteSpace(s.Uid)) continue;
                if (!pred(s)) continue;
                if (found != null) return null;   // хоёрдмол
                found = s;
            }
            return found;
        }
    }
}
