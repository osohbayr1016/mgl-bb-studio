using System;
using System.Collections.Generic;

namespace RevitMcpAddin
{
    /// <summary>Туслахын хариултын хэл.</summary>
    internal enum UiLang { Mn, En }

    /// <summary>
    /// ХАРИУЛТЫН ХЭЛ — хэрэглэгч ямар хэлээр бичсэн, тэр хэлээр нь хариулна.
    ///
    /// ⚠️ ЯАГААД ХЭРЭГТЭЙ ВЭ: 2026-08-25-нд ангилагч англи хэлийг таньдаг
    /// болсон — «unhide everything again» гэхэд зөв ажиллана.  ГЭВЧ хариулт
    /// нь «Тусгаарлалтыг цуцаллаа» гэж МОНГОЛООР гардаг байв.  Санааг нь
    /// ойлгоод хариултаа ойлгуулахгүй байх нь хагас ажилласантай адил.
    ///
    /// ⚠️ ЛАТИНААР БИЧСЭН МОНГОЛ нь МОНГОЛ хариулт авна.  Ажилтнууд кирилл
    /// УНШИНА, зөвхөн БИЧИХ нь хэцүү (гарын байрлал, утас).  «hiisnee ilgee»
    /// гэж бичсэн хүнд англиар хариулбал буруу таасан болно.
    ///
    /// ⚠️ ХЭЛ НААЛДАМХАЙ.  «БА-01» гэх мэт дохиогүй мөр өмнөх хэлийг
    /// хэвээр үлдээнэ — эс бөгөөс яриа дунд хэл нь үсэрч, эвгүй болно.
    /// </summary>
    internal static class Lang
    {
        /// <summary>Одоогийн хариултын хэл.  Анхдагч нь монгол.</summary>
        public static UiLang Current { get; set; } = UiLang.Mn;

        // ⚠️ ЗӨВХӨН англид түгээмэл, латин-монголд БАРАГ ТААРАХГҮЙ үгс.
        // «progress», «sheet», «isolate», «push» зэргийг ЗОРИУД ОРУУЛААГҮЙ:
        // монголчууд эдгээрийг өдөр тутам холимог бичдэг («progress оо push
        // хий») тул тэднийг дохио болговол монгол мөрийг англи гэж алдана.
        private static readonly HashSet<string> EnglishWords =
            new HashSet<string>(StringComparer.OrdinalIgnoreCase)
            {
                "the", "is", "are", "was", "were", "be", "been", "am",
                "my", "me", "i", "you", "your", "we", "our", "it", "its",
                "this", "that", "these", "those", "there", "here",
                "what", "which", "who", "when", "where", "why", "how",
                "can", "could", "would", "should", "will", "shall", "may",
                "do", "does", "did", "done", "have", "has", "had",
                "please", "thanks", "thank", "sorry", "hello", "hi",
                "and", "or", "but", "not", "no", "yes",
                "to", "for", "from", "with", "without", "of", "on", "in",
                "at", "by", "about", "since", "before", "after", "again",
                "all", "every", "only", "just", "everything", "anything",
                "now", "today", "yesterday", "tomorrow",
                "want", "need", "let", "give", "tell", "make", "get",
                "much", "many", "far", "long",
            };

        /// <summary>Кирилл үсэг агуулсан эсэх.</summary>
        private static bool HasCyrillic(string text)
        {
            for (int i = 0; i < text.Length; i++)
            {
                char c = text[i];
                if ((c >= 'Ѐ' && c <= 'ӿ') || (c >= 'Ԁ' && c <= 'ԯ'))
                    return true;
            }
            return false;
        }

        /// <summary>
        /// Хэлийг тодорхойлно.  Дохио байхгүй бол `null` (өмнөхийг хадгална).
        ///
        /// Дараалал:
        ///   1. кирилл байвал  → монгол   (хамгийн тодорхой дохио)
        ///   2. англи туслах үг байвал → англи
        ///   3. дохиогүй       → null     («BA-01», «ok», «70%»)
        /// </summary>
        public static UiLang? Detect(string text)
        {
            if (string.IsNullOrWhiteSpace(text)) return null;
            if (HasCyrillic(text)) return UiLang.Mn;

            // ⚠️ Эвхэлт хийхгүй — эвхэлт нь «y»→«i» гэх мэт хувиргалт хийдэг
            // тул «you» → «iou» болж англи үг таних чадвар алдагдана.
            foreach (string w in text.Split(
                         new[] { ' ', '\t', '\n', '\r', ',', '.', '!', '?', ';', ':',
                                 '(', ')', '"', '\'', '/' },
                         StringSplitOptions.RemoveEmptyEntries))
            {
                if (EnglishWords.Contains(w)) return UiLang.En;
            }

            // ⚠️ Латинаар бичсэн монгол ЭНД УНАНА — null буцаана, өөрөөр
            // хэлбэл ӨМНӨХ хэлийг хэвээр үлдээнэ.  Анхдагч нь монгол тул
            // «hiisnee ilgee» гэсэн хүн монгол хариулт авна.  Харин өмнө нь
            // англиар яриад дараа нь «haruul» гэвэл англи хэвээр үлдэнэ —
            // энэ нь ЗӨВ: хэл нь яриа дунд үсрэхээс наалдамхай байх нь дээр.
            return null;
        }

        /// <summary>Хэрэглэгчийн мөрөөс хэлийг шинэчилнэ (дохио байвал).</summary>
        public static void Observe(string userText)
        {
            UiLang? got = Detect(userText);
            if (got.HasValue) Current = got.Value;
        }

        /// <summary>
        /// Хоёр хэлний хос — одоогийн хэлээр нэгийг нь буцаана.
        ///
        /// ⚠️ Түлхүүрийн ХҮСНЭГТ БИШ, ШУУД хос байдгийн шалтгаан: монгол
        /// текст нь эх кодод УНШИГДАХУЙЦ хэвээр үлдэнэ.  Түлхүүр (`msg.isolated`)
        /// ашиглавал уншиж байгаа хүн юу бичигдэхийг нь мэдэхгүй болж,
        /// орчуулгын файл нь кодоос салж хоцордог.
        /// </summary>
        public static string T(string mn, string en)
        {
            return Current == UiLang.En ? en : mn;
        }
    }
}
