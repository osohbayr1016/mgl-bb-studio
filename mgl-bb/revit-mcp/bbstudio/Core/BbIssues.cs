using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;

namespace MglBb.Core
{
    /// <summary>Асуудлын ноцтой байдал — инженер Excel-ээс шүүх.</summary>
    public enum BbSeverity
    {
        /// <summary>Хийгдсэнгүй (харагдац/хэмжээс үүсээгүй) — заавал шийдэх.</summary>
        Error,

        /// <summary>Хийгдсэн, гэхдээ стандартаас зөрсөн / шалгах хэрэгтэй.</summary>
        Warning,

        /// <summary>Мэдээлэл (юу хийснийг).</summary>
        Info,
    }

    /// <summary>«Асуудал – Шийдэл» Excel-ийн нэг мөр.</summary>
    public sealed class BbIssue
    {
        public string Tool = "";
        public BbSeverity Severity = BbSeverity.Warning;
        public string Member = "";      // ДН-2, Б-1 …
        public string View = "";        // харагдацын нэр
        public string Sheet = "";       // хуудасны дугаар
        public string Problem = "";     // юу болсон
        public string Proposal = "";    // хэрэгслийн санал болгох шийдэл
        public string Decision = "";    // инженерийн шийдэл (Excel-д бөглөнө)
        public string Status = "";      // Шийдэх / Шийдсэн / Хамаагүй
        public string Note = "";        // инженерийн тайлбар, зургийн нэр
        public long ElementId = -1;
        public long ViewId = -1;
        public string Key = "";         // давхардлыг танихад (хэрэгсэл|гишүүн|асуудлын код)
    }

    /// <summary>
    /// «Асуудал – Шийдэл» файл: хэрэгсэл ажиллах бүрд илэрсэн асуудлыг Excel-д бичнэ, инженер «Шийдэл / Төлөв / Тайлбар»-ыг бөглөж
    /// буцаана (хөгжүүлэгчид илгээнэ эсвэл plugin-д дахин уншуулж харагдац руу шууд очно).  Хуучин файл байвал инженерийн бөглөсөн
    /// баганыг ХАДГАЛЖ (Key-ээр тулгаж) шинэ мөрүүдийг нэмнэ — нэг төсөлд нэг файл ургана.
    /// </summary>
    public static class BbIssueBook
    {
        public static readonly string[] Header =
        {
            "№", "Огноо", "Хэрэгсэл", "Ноцтой", "Гишүүн", "Харагдац", "Хуудас", "Асуудал", "Хэрэгслийн санал", "Инженерийн шийдэл",
            "Төлөв", "Тайлбар / зураг", "ElementId", "ViewId", "Түлхүүр",
        };

        public static readonly string[] Statuses = { "Шийдэх", "Шийдсэн", "Хамаагүй", "Хөгжүүлэгчид" };

        private static readonly double[] Widths = { 5, 16, 18, 10, 12, 30, 9, 48, 40, 40, 13, 30, 11, 11, 30 };

        public static string SeverityText(BbSeverity s)
        {
            switch (s)
            {
                case BbSeverity.Error: return "Алдаа";
                case BbSeverity.Warning: return "Анхаар";
                default: return "Мэдээлэл";
            }
        }

        public static BbSeverity ParseSeverity(string s)
        {
            if (string.Equals(s, "Алдаа", StringComparison.OrdinalIgnoreCase)) return BbSeverity.Error;
            if (string.Equals(s, "Мэдээлэл", StringComparison.OrdinalIgnoreCase)) return BbSeverity.Info;
            return BbSeverity.Warning;
        }

        /// <summary>
        /// <paramref name="path"/>-д нэгтгэж бичнэ: хуучин мөрүүд (инженерийн бөглөсөн шийдэл/төлөв/тайлбартай) хэвээр, ижил түлхүүртэй шинэ
        /// асуудал хуучин мөрийг ШИНЭЧИЛНЭ (асуудлын бичвэр, огноо) харин инженерийн баганыг ХӨНДӨХГҮЙ.  Буцаах: нийт мөр.
        /// </summary>
        public static int Merge(string path, IEnumerable<BbIssue> fresh, DateTime now)
        {
            var rows = File.Exists(path) ? Load(path) : new List<KeyValuePair<string, BbIssue>>();
            var byKey = new Dictionary<string, int>(StringComparer.Ordinal);
            for (int i = 0; i < rows.Count; i++) if (!string.IsNullOrEmpty(rows[i].Value.Key) && !byKey.ContainsKey(rows[i].Value.Key)) byKey[rows[i].Value.Key] = i;
            string stamp = now.ToString("yyyy-MM-dd HH:mm", CultureInfo.InvariantCulture);
            foreach (BbIssue f in fresh)
            {
                if (f == null) continue;
                if (!string.IsNullOrEmpty(f.Key) && byKey.TryGetValue(f.Key, out int at))
                {
                    BbIssue old = rows[at].Value;
                    f.Decision = old.Decision;
                    f.Status = string.IsNullOrEmpty(old.Status) ? f.Status : old.Status;
                    f.Note = old.Note;
                    rows[at] = new KeyValuePair<string, BbIssue>(stamp, f);
                }
                else
                {
                    if (string.IsNullOrEmpty(f.Status)) f.Status = f.Severity == BbSeverity.Info ? "" : "Шийдэх";
                    rows.Add(new KeyValuePair<string, BbIssue>(stamp, f));
                    if (!string.IsNullOrEmpty(f.Key)) byKey[f.Key] = rows.Count - 1;
                }
            }
            Save(path, rows);
            return rows.Count;
        }

        public static void Save(string path, IList<KeyValuePair<string, BbIssue>> rows)
        {
            var sh = new BbXlsx.Sheet { Name = "Асуудал - Шийдэл" };
            sh.Header.AddRange(Header);
            sh.Widths.AddRange(Widths);
            sh.Choices[Array.IndexOf(Header, "Төлөв")] = Statuses;
            sh.Choices[Array.IndexOf(Header, "Ноцтой")] = new[] { "Алдаа", "Анхаар", "Мэдээлэл" };
            int n = 1;
            foreach (var kv in rows)
            {
                BbIssue x = kv.Value;
                sh.Rows.Add(new List<string>
                {
                    (n++).ToString(CultureInfo.InvariantCulture), kv.Key, x.Tool, SeverityText(x.Severity), x.Member, x.View, x.Sheet, x.Problem, x.Proposal,
                    x.Decision, x.Status, x.Note, x.ElementId >= 0 ? x.ElementId.ToString(CultureInfo.InvariantCulture) : "",
                    x.ViewId >= 0 ? x.ViewId.ToString(CultureInfo.InvariantCulture) : "", x.Key,
                });
            }
            var help = new BbXlsx.Sheet { Name = "Заавар" };
            help.Header.Add("Энэ файлыг хэрхэн бөглөх");
            help.Widths.Add(120);
            foreach (string line in new[]
            {
                "1. «MGL ББ» хэрэгсэл ажиллах бүрд илэрсэн асуудлыг энэ файлд нэмнэ (нэг төсөлд нэг файл).",
                "2. «Инженерийн шийдэл» баганад зөв байх ёстой байдлыг бичнэ (жишээ нь «хэмжээс дамнуруунаас 8 мм зайд», «S3 огтлол шаардлагагүй»).",
                "3. «Төлөв»: Шийдэх — засах хэрэгтэй; Шийдсэн — засагдсан; Хамаагүй — асуудал биш; Хөгжүүлэгчид — програмыг засах хэрэгтэй.",
                "4. Зураг хавсаргах бол файлын нэрийг «Тайлбар / зураг» баганад бичээд энэ файлтай хамт илгээнэ.",
                "5. ElementId / ViewId / Түлхүүр баганыг ӨӨРЧЛӨХГҮЙ — plugin мөрийг эдгээрээр танина.",
                "6. Excel-ээр солилцох боломжгүй бол өмнөх шигээ PDF дээр тайлбар зураг хавсаргаж илгээнэ.",
            }) help.Rows.Add(new List<string> { line });
            BbXlsx.Write(path, new List<BbXlsx.Sheet> { sh, help });
        }

        /// <summary>Файлаас мөрүүдийг уншина (огноо → асуудал).  Баганыг толгойн НЭРЭЭР олно — инженер багана нэмсэн/зөөсөн ч болно.</summary>
        public static List<KeyValuePair<string, BbIssue>> Load(string path)
        {
            var res = new List<KeyValuePair<string, BbIssue>>();
            var sheets = BbXlsx.Read(path);
            if (sheets.Count == 0) return res;
            List<List<string>> rows = sheets[0].Value;
            if (rows.Count == 0) return res;
            List<string> head = rows[0];
            int Col(string name) => head.FindIndex(h => string.Equals((h ?? "").Trim(), name, StringComparison.OrdinalIgnoreCase));
            string At(List<string> r, int i) => i >= 0 && i < r.Count ? (r[i] ?? "").Trim() : "";
            int cDate = Col("Огноо"), cTool = Col("Хэрэгсэл"), cSev = Col("Ноцтой"), cMem = Col("Гишүүн"), cView = Col("Харагдац"), cSheet = Col("Хуудас");
            int cProb = Col("Асуудал"), cProp = Col("Хэрэгслийн санал"), cDec = Col("Инженерийн шийдэл"), cStat = Col("Төлөв"), cNote = Col("Тайлбар / зураг");
            int cEl = Col("ElementId"), cVw = Col("ViewId"), cKey = Col("Түлхүүр");
            for (int i = 1; i < rows.Count; i++)
            {
                List<string> r = rows[i];
                if (r.All(string.IsNullOrWhiteSpace)) continue;
                var x = new BbIssue
                {
                    Tool = At(r, cTool), Severity = ParseSeverity(At(r, cSev)), Member = At(r, cMem), View = At(r, cView), Sheet = At(r, cSheet),
                    Problem = At(r, cProb), Proposal = At(r, cProp), Decision = At(r, cDec), Status = At(r, cStat), Note = At(r, cNote), Key = At(r, cKey),
                };
                if (long.TryParse(At(r, cEl), NumberStyles.Integer, CultureInfo.InvariantCulture, out long el)) x.ElementId = el;
                if (long.TryParse(At(r, cVw), NumberStyles.Integer, CultureInfo.InvariantCulture, out long vw)) x.ViewId = vw;
                res.Add(new KeyValuePair<string, BbIssue>(At(r, cDate), x));
            }
            return res;
        }
    }
}
