using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;

namespace MglBb.Core
{
    /// <summary>
    /// Сурсан стандартаас ҮЛ ХАМААРАН үргэлж мөрдөх компанийн дүрэм (ББ инженерийн шаардлага, 2026-10-21).
    /// Тэмдэг «ДН-» = дамнуруу, «ТДН-» = туслах дамнуруу (<c>BbGeom.IsAuxMark</c>) — харагдацын төрөл (Detail View type) нь доорх нэрээр;
    /// огтлолын хомутын хэмжээс дотор ирмэгээс.  Төсөлд тэр төрөл алга бол сурсан нэр нь нөөц.
    /// </summary>
    public static class BbCompanyRules
    {
        public const string BeamElev = "5.2 Рамын арматурчлал + Дамнуруу";
        public const string BeamSec = "5.2.1 Рамын арматурчлал + Дамнуруу Огтлол";
        public const string BeamAuxElev = "5.3 Рамын арматурчлал + Туслах Дамнуруу";
        public const string BeamAuxSec = "5.3.1 Рамын арматурчлал + Туслах Дамнуруу ОГТЛОЛ";
        public const string ColumnSec = "4.2.1 Рамын арматурчлал + Багана + ОГТЛОЛ";

        /// <summary>Дэлгээсийн төрлийн нэрс — эрэмбээрээ (компанийн дүрэм → сурсан).</summary>
        public static List<string> ElevViewTypes(BbMemberKind kind, BbMemberStandard ms)
        {
            return Candidates(kind == BbMemberKind.Beam ? BeamElev : kind == BbMemberKind.BeamAux ? BeamAuxElev : null, ms?.ElevViewType);
        }

        /// <summary>Огтлолын төрлийн нэрс — эрэмбээрээ (компанийн дүрэм → сурсан).</summary>
        public static List<string> SecViewTypes(BbMemberKind kind, BbMemberStandard ms)
        {
            return Candidates(kind == BbMemberKind.Beam ? BeamSec : kind == BbMemberKind.BeamAux ? BeamAuxSec : ColumnSec, ms?.SecViewType);
        }

        /// <summary>
        /// Сурсан/хадгалсан стандарт дээр тогтмол дүрмийг давхарлана (хуучин standard.json-ий «outer»-ыг дарна): огтлолын хомутын хэмжээс
        /// «нүүр | хомутын ДОТОР ирмэг | хомутын ДОТОР ирмэг | нүүр» (30 | 440 | 30) — ажлын арматур бүрийн төв гинжинд орохгүй.
        /// </summary>
        public static BbStandard Apply(BbStandard std)
        {
            if (std == null) return null;
            foreach (BbMemberStandard ms in new[] { std.Beam, std.BeamAux, std.Column })
            {
                if (ms == null) continue;
                ms.StirrupRef = "inner";
                ms.SecBarChain = false;
                ms.SecTagsLeft = true;
            }
            // Дамнурууны огтлолын crop: дээд/доод нүүрнээс ХАЖУУГИЙН зайтай ижил (ББ инженерийн шаардлага 2026-10-21) — plugin-ий үүсгэсэн огтлолоос
            // сурахад томорсон crop (≈ 500 мм) буцаж сурагдах давталтыг таслана.
            foreach (BbMemberStandard ms in new[] { std.Beam, std.BeamAux })
            {
                if (ms == null) continue;
                ms.SecCropBelowMm = ms.SecCropSideMm;
                ms.SecCropAboveMm = ms.SecCropSideMm;
            }
            // Багана: дэлгээс, огтлолд арматурын шошго (IndependentTag) тавихгүй — хэмжээс ба MRA (multi-rebar tag) л (ББ инженерийн шаардлага 2026-10-21).
            if (std.Column != null)
            {
                std.Column.ElevTagBars = false;
                std.Column.SecTagLong = false;
                std.Column.SecTagStirrups = false;
            }
            return std;
        }

        /// <summary>Гишүүн бүрд ЗААВАЛ үүсгэх түүврийн нэрийн үгс: арматур, бетон, арматурын нэгдсэн түүвэр, хэсгийн тодорхойлолт.</summary>
        public static readonly string[] RequiredScheduleWords = { "АРМАТУР", "БЕТОН", "НЭГДСЭН", "ТОДОРХОЙЛОЛТ" };

        /// <summary>Түүврийн загвар («205.ББ.РАМ. ХЭСГИЙН ТОДОРХОЙЛОЛТ {mark}») заавал үүсгэх төрлийнх эсэх (том/жижиг үсэг хамаарахгүй).</summary>
        public static bool IsRequiredSchedule(string pattern)
        {
            string p = (pattern ?? "").Replace("{mark}", "").ToUpperInvariant();
            return RequiredScheduleWords.Any(w => p.Contains(w));
        }

        /// <summary>
        /// <paramref name="available"/>-ээс <paramref name="candidates"/>-ийн эхний таарсныг буцаана: яг ижил → <see cref="Norm"/>-оор ижил.
        /// Олдохгүй бол null.
        /// </summary>
        public static string Pick(IEnumerable<string> available, IEnumerable<string> candidates)
        {
            List<string> names = available.Where(n => n != null).ToList();
            List<string> cands = candidates.Where(c => !string.IsNullOrWhiteSpace(c)).ToList();
            // Нэр бүрийг БҮХ түвшинд шалгаад л дараагийнх руу — компанийн дүрэм сурсан утгаас (ЖИШЭЭ-2-оос хучилтын «4.4.» сурагдсан) үргэлж түрүүлнэ.
            foreach (string c in cands)
            {
                string exact = names.FirstOrDefault(n => string.Equals(n, c, StringComparison.Ordinal));
                if (exact != null) return exact;
                string key = Norm(c);
                string loose = names.FirstOrDefault(n => Norm(n) == key);
                if (loose != null) return loose;
                // Нэрний хувилбар (ЖИШЭЭ-2: «2.4. Рамын арматурчлал + Дамнуруу ОГТЛОЛ» — дугаар өөр): эхлээд дугаараар (ганцхан бол), дараа нь үгээр —
                // хүссэн нэрний бүх үгийг агуулсан ХАМГИЙН БОГИНО нэр («Туслах Дамнуруу ОГТЛОЛ»-ыг дамнуруунд сонгохгүй).
                string code = Code(c);
                if (code.Length > 0)
                {
                    List<string> byCode = names.Where(n => Code(n) == code).ToList();
                    if (byCode.Count == 1) return byCode[0];
                }
                List<string> words = Words(c);
                if (words.Count >= 2)
                {
                    // Хүссэн нэрэнд БАЙХГҮЙ ялгах үгтэй төрлийг (дэлгээсэд «… Огтлол», дамнуруунд «Туслах …») сонгохгүй.
                    string ck = Norm(c);
                    string[] extra = Distinct.Where(d => !ck.Contains(d)).ToArray();
                    string best = names.Where(n => { string k = Norm(n); return words.All(w => k.Contains(w)) && !extra.Any(d => k.Contains(d)); })
                        .OrderBy(n => Norm(n).Length).FirstOrDefault();
                    if (best != null) return best;
                }
            }
            return null;
        }

        /// <summary>Харагдацын төрлийг ялгадаг үгс (Norm-оор) — үгээр хайхад хүссэн нэрэнд байхгүй бол тэр төрлийг хасна.</summary>
        private static readonly string[] Distinct = { "огтлол", "туслах", "багана", "хучилт", "хана" };

        /// <summary>Нэрний эхний дугаар («5.2.1 Рамын…» → «521», «2.4. …» → «24»), байхгүй бол хоосон.</summary>
        public static string Code(string s)
        {
            var sb = new StringBuilder();
            foreach (char ch in (s ?? "").TrimStart())
            {
                if (char.IsDigit(ch)) sb.Append(ch);
                else if (ch == '.') continue;
                else break;
            }
            return sb.ToString();
        }

        /// <summary>Дугаараас бусад үгс (≥ 3 тэмдэгт, Norm-оор): «5.2.1 Рамын арматурчлал + Дамнуруу Огтлол» → рамын, арматурчлал, дамнуруу, огтлол.</summary>
        private static List<string> Words(string s)
        {
            return (s ?? "").Split(new[] { ' ', '+', '-', '_', '(', ')', ',' }, StringSplitOptions.RemoveEmptyEntries)
                .Select(Norm).Where(w => w.Length >= 3 && !w.All(char.IsDigit)).Distinct().ToList();
        }

        /// <summary>Харьцуулах түлхүүр: жижиг үсэг, хоосон зай ба цэггүй («5.2. Рамын … +Туслах» = «5.2 рамын … + туслах»).</summary>
        public static string Norm(string s)
        {
            var sb = new StringBuilder(s.Length);
            foreach (char ch in s)
                if (!char.IsWhiteSpace(ch) && ch != '.') sb.Append(char.ToLowerInvariant(ch));
            return sb.ToString();
        }

        private static List<string> Candidates(string rule, string learned)
        {
            var list = new List<string>();
            if (!string.IsNullOrWhiteSpace(rule)) list.Add(rule);
            if (!string.IsNullOrWhiteSpace(learned) && !list.Any(x => Norm(x) == Norm(learned))) list.Add(learned);
            return list;
        }
    }
}
