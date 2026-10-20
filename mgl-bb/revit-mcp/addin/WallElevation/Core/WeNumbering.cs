using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;

namespace RevitMcpAddin.WallElevation.Core
{
    /// <summary>Хуудасны дугаар хуваарилах орчин (Revit давхарга бөглөнө): төслийн бүх хуудасны дугаар, өмнө хуудастай бүлэг, төслийн цуваа.</summary>
    public sealed class WeSheetNumberContext
    {
        /// <summary>Төслийн БҮХ хуудасны дугаар (эзлэгдсэн).</summary>
        public ICollection<string> Taken = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        /// <summary>Энэ хэрэгслийн өмнө үүсгэсэн хуудастай бүлэг (тэдэнд шинэ дугаар хэрэггүй).</summary>
        public ICollection<string> GroupsWithSheet = new HashSet<string>(StringComparer.Ordinal);
        /// <summary>Төслийн дотор дэлгээсийн хуудасны цуваа («БА427» → «БА428»); null = цуваа олдоогүй.  Аргумент = эзлэгдсэн дугаарууд.</summary>
        public Func<ICollection<string>, string> LearnedNext;
    }

    /// <summary>Дугаарлалтын урьдчилсан дүн: хуудасны дугаар, тэмдгийн хураангуй, зөрчил (зөрчилтэй бол ҮҮСГЭХГҮЙ).</summary>
    public sealed class WeNumberingResult
    {
        public Dictionary<string, string> SheetNumbers = new Dictionary<string, string>(StringComparer.Ordinal);
        /// <summary>Засахгүй бол үүсгэхгүй: муж хүрэлцэхгүй, нэг хуудсан дээр давхардсан тэмдэг.</summary>
        public List<string> Errors = new List<string>();
        /// <summary>Мэдээлэл: «WE-L1-205» эзлэгдсэн → «WE-L1-205-2» г.м.</summary>
        public List<string> Notes = new List<string>();
        /// <summary>Нэг мөр: «Хуудас: ИЗД1-41 (205), ИЗД1-42 (206) · тэмдэг 205A–D, 206A–C».</summary>
        public string Preview = string.Empty;
        public bool Ok { get { return Errors.Count == 0; } }
    }

    /// <summary>
    /// Хуудас ба дэлгээсийн тэмдгийн ДУГААРЛАЛТ (W05, 2026-10-16): угтвар, эхлэх/дуусах муж, оронгийн тоо; үсэг эсвэл тоо; өрөө тус бүр дахин
    /// эхлэх (өгөгдмөл, өрөөний дугаар тэмдэгт орно) эсвэл багц даяар тасралтгүй.  Үүсгэхээс ӨМНӨ тоо, дараагийн дугаар, зөрчлийг харуулна.  Муж нь
    /// ХЯЗГААР — хоосон хуудас эсвэл хуурамч дэлгээс үүсгэх шалтгаан биш; хүрэлцэхгүй бол засуулна (хэтрүүлэхгүй, бусдын хуудсыг дугаарлахгүй).
    /// Харагдацыг таних нь тэмдгээс ҮЛ ХАМААРНА (Extensible Storage-ийн түлхүүр).
    /// </summary>
    public static class WeNumbering
    {
        public static string Pad(int n, int digits)
        {
            return digits > 0 ? n.ToString("D" + Math.Min(9, digits).ToString(CultureInfo.InvariantCulture), CultureInfo.InvariantCulture) : n.ToString(CultureInfo.InvariantCulture);
        }

        public static string SheetNumber(string prefix, int n, int digits) { return (prefix ?? string.Empty) + Pad(n, digits); }

        /// <summary>
        /// {Side}-ийн утга (<see cref="WePlannedElevation.SideToken"/>) — <paramref name="ordered"/> нь төлөвлөгөөний дараалал (бүлгээр, бүлэг доторх
        /// үсгийн дарааллаар).  Үсэг + өрөө тус бүр = <see cref="WePlannedElevation.SideLetter"/> ЯГ (өмнөх зан төлөв).  «?» (геометргүй) мөр — «?».
        /// </summary>
        public static void AssignTokens(IList<WePlannedElevation> ordered, WeSettings s)
        {
            int global = 0;
            foreach (WePlannedElevation i in ordered)
            {
                if (i.SideLetter == null || i.SideLetter == "?") { i.SideToken = i.SideLetter; continue; }
                int idx = s.LabelContinuous ? global : Math.Max(0, i.SideIndex - 1);
                global++;
                if (s.LabelMode == WeLabelMode.Numbers) i.SideToken = Pad(Math.Max(0, s.LabelStart) + idx, s.LabelDigits);
                else i.SideToken = s.LabelContinuous ? WeNaming.Letter(idx) : i.SideLetter;
            }
        }

        /// <summary>Тоон тэмдгийн утга (тоо биш бол −1).</summary>
        public static int TokenNumber(string token)
        {
            int n;
            return !string.IsNullOrEmpty(token) && int.TryParse(token, NumberStyles.None, CultureInfo.InvariantCulture, out n) ? n : -1;
        }

        private static bool Placed(WePlannedElevation i, ICollection<string> excluded)
        {
            return i.Frame != null && i.Status <= WeStatus.Warning && (excluded == null || !excluded.Contains(i.Key))
                   && i.Action != WeAction.Skip;
        }

        /// <summary>
        /// Урьдчилсан дүн + зөрчил: тэмдгийн муж (тоон горимд дуусах хязгаар), нэг хуудсан дээрх давхардсан тэмдэг (сонгосон бэлэн хуудсанд олон
        /// өрөө — {Room}-гүй загвар), шинэ хуудасны дугаар (мужаар — сул дугаар, хүрэлцэхгүй бол алдаа; загвараар — давхардвал «-2», тэмдэглэл).
        /// </summary>
        public static WeNumberingResult Evaluate(WePlan plan, WeSettings s, ICollection<string> excluded, WeSheetNumberContext ctx)
        {
            var r = new WeNumberingResult();
            if (plan == null || s == null) return r;
            List<WePlannedElevation> placed = plan.Items.Where(i => Placed(i, excluded)).ToList();

            // ── Тэмдгийн муж ─────────────────────────────────────────
            if (s.LabelMode == WeLabelMode.Numbers && s.LabelEnd > 0)
            {
                List<WePlannedElevation> over = placed.Where(i => TokenNumber(i.SideToken) > s.LabelEnd).ToList();
                if (over.Count > 0)
                {
                    int need = placed.Select(i => TokenNumber(i.SideToken)).DefaultIfEmpty(0).Max();
                    r.Errors.Add("Тэмдгийн дугаарын муж хүрэлцэхгүй: " + Pad(s.LabelStart, s.LabelDigits) + "–" + Pad(s.LabelEnd, s.LabelDigits)
                                 + " мужид " + over.Count + " дэлгээс багтахгүй (хамгийн их нь " + need.ToString(CultureInfo.InvariantCulture)
                                 + ") — «Дуусах»-ыг " + need.ToString(CultureInfo.InvariantCulture) + " болгох, эсвэл дэлгээс хасна уу.");
                }
            }

            // ── Нэг хуудсан дээрх тэмдгийн давхардал ─────────────────
            bool shared = s.Output == WeOutputMode.ViewsAndSheets && !string.IsNullOrWhiteSpace(s.TargetSheetNumber);
            foreach (IGrouping<string, WePlannedElevation> sheet in placed.Where(i => !string.IsNullOrEmpty(i.Label))
                                                                          .GroupBy(i => shared ? "*" : i.GroupKey ?? string.Empty))
            {
                List<string> dup = sheet.GroupBy(i => i.Label, StringComparer.OrdinalIgnoreCase).Where(g => g.Count() > 1).Select(g => g.Key).ToList();
                if (dup.Count == 0) continue;
                r.Errors.Add((shared ? "«" + s.TargetSheetNumber.Trim() + "» хуудсанд" : "Нэг хуудсанд") + " тэмдэг давхардана: " + string.Join(", ", dup.Take(6))
                             + (dup.Count > 6 ? " …" : string.Empty) + " — тэмдгийн загварт {Room} нэмэх эсвэл «Багц даяар тасралтгүй» сонгоно уу.");
            }

            // ── Шинэ хуудасны дугаар ─────────────────────────────────
            var labels = new List<string>();
            foreach (IGrouping<string, WePlannedElevation> g in placed.GroupBy(i => i.GroupKey ?? string.Empty))
            {
                List<string> tokens = g.Select(i => i.Label).Where(l => !string.IsNullOrEmpty(l)).ToList();
                if (tokens.Count > 0) labels.Add(tokens.Count == 1 ? tokens[0] : tokens.First() + "–" + tokens.Last());
            }
            var sheets = new List<string>();
            if (s.Output == WeOutputMode.ViewsAndSheets && string.IsNullOrWhiteSpace(s.TargetSheetNumber) && ctx != null)
            {
                var taken = new HashSet<string>(ctx.Taken ?? new List<string>(), StringComparer.OrdinalIgnoreCase);
                List<string> needing = placed.Select(i => i.GroupKey ?? string.Empty).Distinct()
                                             .Where(g => ctx.GroupsWithSheet == null || !ctx.GroupsWithSheet.Contains(g)).ToList();
                if (s.SheetNumberMode == WeSheetNumberMode.Range)
                {
                    int lo = Math.Max(0, s.SheetRangeStart), hi = Math.Max(lo, s.SheetRangeEnd);
                    var free = new List<string>();
                    for (int n = lo; n <= hi && free.Count < needing.Count; n++)
                    {
                        string num = SheetNumber(s.SheetRangePrefix, n, s.SheetRangeDigits);
                        if (!taken.Contains(num)) free.Add(num);
                    }
                    for (int k = 0; k < needing.Count && k < free.Count; k++) r.SheetNumbers[needing[k]] = free[k];
                    if (free.Count < needing.Count)
                        r.Errors.Add("Хуудасны дугаарын муж хүрэлцэхгүй: " + needing.Count + " шинэ хуудас хэрэгтэй, «" + SheetNumber(s.SheetRangePrefix, lo, s.SheetRangeDigits)
                                     + "–" + SheetNumber(s.SheetRangePrefix, hi, s.SheetRangeDigits) + "» мужид " + free.Count + " сул"
                                     + (free.Count > 0 ? " (" + string.Join(", ", free.Take(6)) + ")" : string.Empty)
                                     + " — мужийг өргөтгөх эсвэл өрөө хасна уу (бусдын хуудсыг дугаарлахгүй, мужаас хэтрэхгүй).");
                }
                else
                {
                    var assigned = new HashSet<string>(taken, StringComparer.OrdinalIgnoreCase);
                    bool learned = ctx.LearnedNext != null && string.Equals(s.SheetNumberPattern, WeNaming.DefaultSheetPattern, StringComparison.Ordinal);
                    foreach (string g in needing)
                    {
                        WePlannedElevation p = placed.First(i => (i.GroupKey ?? string.Empty) == g);
                        string want = learned ? ctx.LearnedNext(assigned) : null;
                        if (string.IsNullOrEmpty(want))
                        {
                            string range = WeNaming.SideRange(placed.Where(i => (i.GroupKey ?? string.Empty) == g).Select(i => i.SideToken));
                            string room = p.Kind == WeSourceKind.Room ? (p.RoomNumber ?? string.Empty) : "W";
                            want = WeNaming.Expand(s.SheetNumberPattern, WeNaming.Values(p.LevelName, room, p.RoomName, string.Empty, string.Empty, 0, string.Empty, range));
                        }
                        string num = WeNaming.UniqueNumber(want, assigned);
                        if (!string.Equals(num, want, StringComparison.OrdinalIgnoreCase))
                            r.Notes.Add("Хуудасны дугаар «" + want + "» эзлэгдсэн → «" + num + "».");
                        assigned.Add(num);
                        r.SheetNumbers[g] = num;
                    }
                }
                foreach (string g in needing)
                {
                    string num;
                    if (!r.SheetNumbers.TryGetValue(g, out num)) continue;
                    WePlannedElevation p = placed.First(i => (i.GroupKey ?? string.Empty) == g);
                    sheets.Add(num + " (" + (p.Kind == WeSourceKind.Room ? p.RoomNumber : p.LevelName) + ")");
                }
                int reused = placed.Select(i => i.GroupKey ?? string.Empty).Distinct().Count() - needing.Count;
                if (reused > 0) sheets.Add(reused + " өмнөх хуудас");
            }
            var parts = new List<string>();
            if (sheets.Count > 0) parts.Add("Хуудас: " + string.Join(", ", sheets.Take(8)) + (sheets.Count > 8 ? " …" : string.Empty));
            if (labels.Count > 0) parts.Add("тэмдэг " + string.Join(", ", labels.Take(8)) + (labels.Count > 8 ? " …" : string.Empty));
            r.Preview = string.Join(" · ", parts);
            return r;
        }

        /// <summary>
        /// Мужаас дараагийн СУЛ дугаар (үүсгэх үед хуваарилсан дугаар хооронд нь эзлэгдсэн бол).  null = мужид сул алга (мужаас ХЭТРЭХГҮЙ).
        /// </summary>
        public static string NextFree(WeSettings s, ICollection<string> taken)
        {
            int lo = Math.Max(0, s.SheetRangeStart), hi = Math.Max(lo, s.SheetRangeEnd);
            for (int n = lo; n <= hi; n++)
            {
                string num = SheetNumber(s.SheetRangePrefix, n, s.SheetRangeDigits);
                if (taken == null || !taken.Contains(num)) return num;
            }
            return null;
        }
    }
}
