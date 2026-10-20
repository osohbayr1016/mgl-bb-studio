using System;
using System.Collections.Generic;
using System.Linq;

namespace RevitMcpAddin
{
    public enum Intent
    {
        Unknown,
        DraftSubmit,   // «хийснээ илгээ»
        Refresh,       // «шинэчил»
        Isolate,       // «БА-01-ийг харуул»
        ResetView,     // «буцаа»
        Baseline,      // «эхлэл тэмдэглэ»
        Help,
    }

    public sealed class ParsedIntent
    {
        public Intent Intent { get; set; } = Intent.Unknown;
        /// <summary>`Isolate`-д хэрэглэгчийн хэлсэн хуудасны дугаар.</summary>
        public string SheetHint { get; set; }
    }

    /// <summary>
    /// Хэрэглэгчийн монгол өгүүлбэрээс САНААГ таних — ЖИЖИГ ТҮЛХҮҮР ҮГИЙН
    /// таарамж, LLM БИШ.
    ///
    /// ⚠️ Яагаад LLM биш вэ:
    ///   • Энэ бол хаалттай, зургаан үйлдэлтэй багц.  Түлхүүр үг 100%
    ///     урьдчилан таамаглах боломжтой, LLM нь таамаглах боломжгүй.
    ///   • Офлайн үед ч ажиллана.
    ///   • Сүлжээний дуудлага, өртөг, хүлээлт байхгүй — товч дарсан мэт хурдан.
    ///   • Буруу таньсан ч аюулгүй: юу ч бичихгүй, зөвхөн ноорог гарна.
    /// LLM нь ЖИНХЭНЭ ХЭРЭГТЭЙ газраа ажиллана — монгол тэмдэглэл бичихэд,
    /// сервер талд (`lib/revitNoteAi.ts`).
    ///
    /// Кирилл/латин хоёуланг нь хүлээж авна: хүмүүс «iluu tsag» маягаар
    /// латинаар ч бичдэг.
    /// </summary>
    public static class IntentParser
    {
        private static readonly string[] SubmitWords =
        {
            "илгээ", "явц", "тайлагна", "тайлан", "хийсн", "дуусга", "бүртгэ",
            "ilgee", "yavts", "tailan", "push", "submit", "report",
        };

        private static readonly string[] RefreshWords =
        {
            "шинэчил", "дахин ач", "сэргээ", "shinechil", "refresh", "reload",
        };

        private static readonly string[] IsolateWords =
        {
            "тусгаарла", "харуул", "ялга", "tusgaarla", "haruul", "isolate", "show",
        };

        private static readonly string[] ResetWords =
        {
            "буцаа", "цуцал", "болиул", "butsaa", "tsutsal", "reset", "clear",
        };

        private static readonly string[] BaselineWords =
        {
            "эхлэл", "суурь", "baseline", "ehlel", "suuri", "snapshot",
        };

        // ⚠️ "?" ЭНД БАЙЖ БОЛОХГҮЙ.  Урьд нь байсан — үр дүнд нь АСУУЛТ БҮР
        // (ж: «r u working?») тусламжийн текст рүү унаж, AI руу хэзээ ч
        // хүрдэггүй байв.  Асуултыг доорх `Parse` тусад нь боловсруулна.
        private static readonly string[] HelpWords =
        {
            "тусламж", "тусалж", "юу хийж", "юу чадах", "tuslamj", "help",
        };

        public static ParsedIntent Parse(string raw)
        {
            var result = new ParsedIntent();
            if (string.IsNullOrWhiteSpace(raw)) return result;

            string t = raw.Trim();

            // ⚠️ АСУУЛТ бол ХЭЗЭЭ Ч тушаал БИШ.  «Хуудас хэд байна?» гэдэг нь
            // «хуудас» гэсэн үг агуулсан ч тусгаарлах тушаал биш — асуулт.
            // Асуултыг ҮРГЭЛЖ AI руу явуулна.
            if (t.EndsWith("?", StringComparison.Ordinal) ||
                t.EndsWith("？", StringComparison.Ordinal))
                return result;

            // Урт өгүүлбэр бол чөлөөт яриа, товч тушаал биш.  Тушаалууд нь
            // «хийснээ илгээ», «буцаа» гэх мэт БОГИНО байдаг.
            if (t.Length > 48) return result;

            t = t.ToLowerInvariant();

            // ⚠️ Дараалал НЬ ЧУХАЛ.  «буцаа» нь «илгээ»-ээс ӨМНӨ шалгагдана,
            // эс бөгөөс «илгээснээ буцаа» гэсэн өгүүлбэр илгээх гэж ойлгогдоно.
            if (HasAny(t, ResetWords)) { result.Intent = Intent.ResetView; return result; }
            if (HasAny(t, HelpWords)) { result.Intent = Intent.Help; return result; }
            if (HasAny(t, BaselineWords)) { result.Intent = Intent.Baseline; return result; }
            if (HasAny(t, RefreshWords)) { result.Intent = Intent.Refresh; return result; }

            // «илгээх» нь «тусгаарлах»-аас ӨМНӨ шалгагдана.  «харуул» гэдэг үг
            // хэт ерөнхий тул «явцаа харуул» гэсэн өдөр тутмын өгүүлбэр урьд нь
            // 3D тусгаарлалт болж хувирдаг байв — хүн явцаа илгээх гэсэн байтал
            // загвар нь шүүгддэг.  Илгээх түлхүүр үг (явц, хийсн, тайлан…)
            // байхгүй бол «харуул» хэвээрээ тусгаарлана.
            if (HasAny(t, SubmitWords)) { result.Intent = Intent.DraftSubmit; return result; }

            if (HasAny(t, IsolateWords))
            {
                result.Intent = Intent.Isolate;
                result.SheetHint = ExtractSheetHint(raw);
                return result;
            }

            return result;
        }

        /// <summary>
        /// ҮГИЙН ЭХЛЭЛЭЭР таарна, дэд мөрөөр БИШ.
        ///
        /// ⚠️ Урьд нь `text.Contains(w)` байсан тул үг дундуур ч таардаг байв —
        /// ж: «явц» нь «баянцагаан» дотор олдоно.  Одоо үгийн эхэнд байх ёстой:
        /// «илгээ» нь «илгээх», «илгээнэ»-тэй таарна, гэхдээ өөр үгийн дунд үгүй.
        /// </summary>
        private static bool HasAny(string text, IEnumerable<string> words)
        {
            foreach (string w in words)
            {
                var m = System.Text.RegularExpressions.Regex.Match(
                    text,
                    @"(^|[^\p{L}\p{N}])" + System.Text.RegularExpressions.Regex.Escape(w));
                if (m.Success) return true;
            }
            return false;
        }

        /// <summary>
        /// «БА-01-ийг харуул» → «БА-01».  Үсэг+зураас+цифр хэлбэрийг хайна;
        /// олдохгүй бол null (панель сонгосон хуудсаа хэрэглэнэ).
        /// </summary>
        /// <summary>
        /// Хуудасны шифрийн ТААМАГ (бүртгэл, дибагт).  Бодит хуудсыг олохын
        /// тулд `Slots.MatchSheet`-ийг жагсаалттай нь дуудна.
        ///
        /// ⚠️ Өмнө нь энд `([\p{L}]{1,6})\s*[-_\s]\s*(\d{1,4})` гэсэн шууд
        /// regex байсан бөгөөд ЗУРААС ЗААВАЛ шаарддаг тул «БА01» олдохгүй,
        /// мөн бичлэгийг эвхдэггүй тул «BA-01» ба «БА-01» өөр гардаг байв.
        /// Одоо `Slots` руу шилжүүлэв — тэнд эвхэлт, зураасгүй хэлбэр,
        /// эхний тэггүй хэлбэр, харагдацын холимог бүгд баригдана.
        /// </summary>
        public static string ExtractSheetHint(string raw)
        {
            return Slots.SheetHint(raw);
        }

        /// <summary>Панельд харуулах тусламжийн текст.</summary>
        private const string HelpMn =
            "Юу бичиж болох вэ:\n" +
            "  • «хийснээ илгээ»    — өдрийн явцын ноорог гаргана\n" +
            "  • «хуудсуудаа харуул» — энэ файлын бүх хуудсыг жагсаана\n" +
            "  • «БА-01-ийг харуул»  — тэр хуудасны элементийг тусгаарлана\n" +
            "  • «буцаа»            — тусгаарлалтыг цуцална\n" +
            "  • «юу өөрчлөгдсөн»   — суурь авснаас хойшхи өөрчлөлт\n" +
            "  • «эхлэл тэмдэглэ»   — өнөөдрийн загварыг суурь болгоно\n" +
            "  • «явц хэд вэ»       — миний ажлын хувийг хэлнэ\n\n" +
            "Кирилл, латин, англи — аль ч хэлээр, товчилж, алдаатай бичсэн ч ойлгоно.";

        private const string HelpEn =
            "What you can type:\n" +
            "  • \"submit my progress\"  — drafts today's progress entry\n" +
            "  • \"show all sheets\"     — lists every sheet in this file\n" +
            "  • \"show only BA-01\"     — isolates that sheet's elements\n" +
            "  • \"reset\"               — clears the isolation\n" +
            "  • \"what changed\"        — diff since the baseline\n" +
            "  • \"set baseline\"        — marks the current model as the base\n" +
            "  • \"what percent am i at\" — tells you your task progress\n\n" +
            "Mongolian (Cyrillic or Latin) and English both work — typos are fine.";

        /// <summary>
        /// Тусламжийн текст — хэрэглэгчийн бичсэн хэлээр.
        /// ⚠️ `const` БАЙЖ БОЛОХГҮЙ: хэл нь ажиллах үед л мэдэгддэг.
        /// </summary>
        public static string HelpText
        {
            get { return Lang.T(HelpMn, HelpEn); }
        }
    }
}
