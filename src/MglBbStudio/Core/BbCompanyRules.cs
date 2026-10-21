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
            foreach (string c in candidates)
            {
                if (string.IsNullOrWhiteSpace(c)) continue;
                string exact = names.FirstOrDefault(n => string.Equals(n, c, StringComparison.Ordinal));
                if (exact != null) return exact;
                string key = Norm(c);
                string loose = names.FirstOrDefault(n => Norm(n) == key);
                if (loose != null) return loose;
            }
            return null;
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
