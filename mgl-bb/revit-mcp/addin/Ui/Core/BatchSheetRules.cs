using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text.RegularExpressions;

namespace RevitMcpAddin.Ui.Core
{
    // ══════════════════════════════════════════════════════════════════════════
    //  «Хуудас үүсгэх» цонхны ЦЭВЭР дүрэм (Revit/WPF-гүй, `tests/MglUi.Tests`).
    //
    //  Яагаад: хуучин цонх буруу утгыг «Үүсгэх» дарсны ДАРАА MessageBox-оор хэлдэг, «Үүсгэх» үргэлж идэвхтэй, «давхцсан»
    //  хуудсыг зөвхөн эхний 8 мөрөнд тэмдэглэдэг (нийт хэдийг алгасахыг хэлдэггүй), `<n>` нь БҮРЭН дугаар биш
    //  нөхсөн ТООГ л орлодгийг хаана ч бичдэггүй, «Урт»-ын нэгжийг хэлдэггүй байв.
    //  `PadNumber`/`ComposeNumber`/`ResolveName` нь урьд нь `BatchSheetCommand` (Revit) дотор — одоо ЭНД, команд дуудна.
    // ══════════════════════════════════════════════════════════════════════════

    public struct BatchInput
    {
        public int Start;
        public int Count;
        public int Pad;
        /// <summary>Талбар бүрийн алдаа (null = зөв).  UI талбарын ДООР шууд харуулна.</summary>
        public string StartError, CountError, PadError;

        public bool Valid { get { return StartError == null && CountError == null && PadError == null; } }
    }

    public static class BatchSheetRules
    {
        public const int MaxCount = 500;
        public const int MaxPad = 10;
        public const int PreviewRows = 8;

        public static BatchInput Parse(string start, string count, string pad)
        {
            var r = new BatchInput();
            int v;
            if (!int.TryParse((start ?? string.Empty).Trim(), NumberStyles.Integer, CultureInfo.InvariantCulture, out v) || v < 0)
                r.StartError = "Эхлэх дугаар нь 0 буюу эерэг бүхэл тоо байх ёстой.";
            else r.Start = v;

            if (!int.TryParse((count ?? string.Empty).Trim(), NumberStyles.Integer, CultureInfo.InvariantCulture, out v) || v < 1 || v > MaxCount)
                r.CountError = "Тоо ширхэг нь 1–" + MaxCount + " хооронд байх ёстой.";
            else r.Count = v;

            if (!int.TryParse((pad ?? string.Empty).Trim(), NumberStyles.Integer, CultureInfo.InvariantCulture, out v) || v < 0 || v > MaxPad)
                r.PadError = "Тооны урт нь 0–" + MaxPad + " хооронд байх ёстой.";
            else r.Pad = v;
            return r;
        }

        /// <summary>Дугаарыг pad урттай нулиар гүйцээнэ (pad ≤ 0 бол хэвээр).</summary>
        public static string PadNumber(int num, int pad)
        {
            string s = num.ToString(CultureInfo.InvariantCulture);
            return pad > 0 && s.Length < pad ? s.PadLeft(pad, '0') : s;
        }

        /// <summary>Сонгосон параметрийн утгууд + дугаарыг тусгаарлагчаар угсарна.</summary>
        public static string ComposeNumber(IList<string> parts, string padded, string sep)
        {
            string s = sep ?? string.Empty;
            if (parts == null || parts.Count == 0) return padded;
            return string.Join(s, parts) + s + padded;
        }

        /// <summary>Нэрийн загварын &lt;n&gt; token-ийг нөхсөн ТООГООР солино (token байхгүй бол хэвээр).</summary>
        public static string ResolveName(string template, string padded)
        {
            if (string.IsNullOrWhiteSpace(template)) return null;
            return Regex.Replace(template, Regex.Escape("<n>"), padded.Replace("$", "$$"), RegexOptions.IgnoreCase);
        }

        /// <summary>Нэг дугаарын бүтэн хуудасны дугаар + нэр (UI-н урьдчилан харах ба команд ИЖИЛ функцээр).</summary>
        public static string Compose(IList<string> includedValues, int number, int pad, string sep)
        {
            return ComposeNumber(includedValues, PadNumber(number, pad), sep);
        }

        /// <summary>Урьдчилан харах: нийт хэд, шинэ хэд, давхцаж алгасагдах хэд — БҮХ тооны дунд (зөвхөн харагдах 8 биш).</summary>
        public static BatchPreviewCounts Count(IList<string> includedValues, BatchInput input, string sep, ISet<string> existing)
        {
            var c = new BatchPreviewCounts { Total = input.Count };
            if (!input.Valid) return c;
            var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            for (int i = 0; i < input.Count; i++)
            {
                string composed = Compose(includedValues, input.Start + i, input.Pad, sep);
                // Хуудас үүсгэхэд мөн ижил: байгаа дугаар БА энэ ажиллагаанд аль хэдийн үүссэн дугаар давхцвал алгасна.
                if ((existing != null && existing.Contains(composed)) || !seen.Add(composed)) { c.Duplicates++; continue; }
                c.New++;
                if (c.First == null) c.First = composed;   // ЖИНХЭНЭ шинэ хуудасны эхний/сүүлийн дугаар
                c.Last = composed;
            }
            return c;
        }

        public static string CountsText(BatchPreviewCounts c)
        {
            if (c.Total == 0) return "Үүсэх хуудас: —";
            string s = "Үүсэх шинэ хуудас: " + c.New + " / " + c.Total;
            if (c.Duplicates > 0) s += "  ·  давхцсан тул алгасах: " + c.Duplicates;
            return s;
        }

        /// <summary>Үүсгэхийг хориглох шалтгаан (null = боломжтой).  Хэрэглэгч «яагаад дарагдахгүй» гэж таамаглахгүй.</summary>
        public static string BlockReason(BatchInput input, BatchPreviewCounts c)
        {
            if (!input.Valid) return "Дээрх улаан тайлбартай талбарыг засна уу.";
            if (c.New == 0) return "Бүх дугаар давхцсан тул шинэ хуудас үүсэхгүй — эхлэх дугаар эсвэл параметрийн утгыг солино уу.";
            return null;
        }

        public const string NameTemplateHelp =
            "«<n>» нь хуудасны БҮРЭН дугаар биш, зөвхөн нөхсөн ТОО (жишээ нь 007).";
        public const string PadHelp =
            "Тооны урт: тоог хэдэн оронтой болтол урд нь 0-ээр нөхөх (3 бол 7 → 007). 0 = нөхөхгүй.";
        public const string NoTitleBlockWarning =
            "Гарчгийн хүснэгтгүй хоосон хуудас үүснэ — рамк, штамп байхгүй.";
    }

    public struct BatchPreviewCounts
    {
        public int Total;
        public int New;
        public int Duplicates;
        public string First;
        public string Last;
    }
}
