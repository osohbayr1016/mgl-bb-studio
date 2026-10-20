using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;

namespace RevitMcpAddin
{
    /// <summary>
    /// Кирилл↔латин НЭГ хэлбэрт буулгах (fold).
    ///
    /// ⚠️ ЭНЭ НЬ ГУРВАН ХОСЛОЛЫН НЭГ.  Гурвуулаа ЗЭРЭГ өөрчлөгдөнө:
    ///     backend/src/lib/textFold.ts          (foldText)      — вэб хайлт
    ///     frontend/src/shared/lib/search/normalize.ts           — вэб хайлт
    ///     revit-mcp/training/textfold.py       (fold_text)     — загвар сургалт
    ///     revit-mcp/addin/TextFold.cs          (энэ файл)      — Revit таамаглал
    /// Зөрвөл вэб дээрх хайлт болон Revit дэх санаа таних ЧИМЭЭГҮЙ зөрнө.
    /// `training/check_fold_parity.py` нь Python↔TypeScript-ийг,
    /// `training/check_parity.py` нь Python↔C#-ийг барина.
    ///
    /// ЯАГААД САНАА ТАНИХАД ХЭРЭГТЭЙ ВЭ (2026-08-25-нд ХЭМЖСЭН):
    ///     кирилл дээр сургаад латин дээр шалгахад  52.8% → 97.8%
    ///     ерөнхий нарийвчлал                       88.5% → 92.3%
    /// Өмнө нь латинаар бичдэг хүн бараг ойлгогдохгүй байсан.  Одоо нэг
    /// жишээ бичихэд кирилл, латин, бүр алдаатай хэлбэр нь хамт сурагдана.
    ///
    ///     «илгээе» «ilgeeye» «ИЛГЭЭЕ»   → бүгд "ilge"
    ///     «хийснээ» «hiisnee» «khiisne» → бүгд "hisne"
    ///     «ХАС-01» «has 01» «HAS_01»    → бүгд "has 01"
    /// </summary>
    internal static class TextFold
    {
        // ⚠️ `textFold.ts`-ийн CYRILLIC_TO_LATIN-тай ЯГ ИЖИЛ.  Мөр нэмэх,
        // хасах, өөрчлөх бүрд дөрвөн хослолыг ЗЭРЭГ засна.
        private static readonly Dictionary<char, string> Map = new Dictionary<char, string>
        {
            { 'а', "a" }, { 'б', "b" }, { 'в', "v" }, { 'г', "g" }, { 'д', "d" },
            { 'е', "e" }, { 'ё', "yo" }, { 'ж', "j" }, { 'з', "z" }, { 'и', "i" },
            { 'й', "i" }, { 'к', "k" }, { 'л', "l" }, { 'м', "m" }, { 'н', "n" },
            { 'о', "o" }, { 'ө', "o" }, { 'п', "p" }, { 'р', "r" }, { 'с', "s" },
            { 'т', "t" }, { 'у', "u" }, { 'ү', "u" }, { 'ф', "f" }, { 'х', "h" },
            { 'ц', "ts" }, { 'ч', "ch" }, { 'ш', "sh" }, { 'щ', "sh" },
            { 'ъ', "" }, { 'ы', "i" }, { 'ь', "" }, { 'э', "e" },
            { 'ю', "yu" }, { 'я', "ya" },
        };

        private static readonly Regex NonAlnum = new Regex("[^a-z0-9]+", RegexOptions.Compiled);

        // ⚠️ ЗӨВХӨН ҮСЭГ.  Тоог хураавал «1200» → «120» болж хуудасны
        // дугаараар хайх боломжгүй болно.
        private static readonly Regex Doubled = new Regex(@"([a-z])\1+", RegexOptions.Compiled);

        /// <summary>Харьцуулалтын хэлбэр — үгсийн хооронд НЭГ зайтай. Хоосон буцаж болно.</summary>
        public static string Fold(string input)
        {
            if (string.IsNullOrEmpty(input)) return string.Empty;

            // 1. жижиг үсэг + латин диакритик арилгах (é → e)
            //    ⚠️ ДАРААЛАЛ нь гэрээний нэг хэсэг: JS нь toLowerCase()-ийг
            //    normalize('NFD')-аас ӨМНӨ хийдэг.  Мөн NFD нь кирилл «й»-г
            //    и + товчлол болгон задалдаг тул дээрх Map-ийн 'й' мөрд
            //    хүрэхгүй — хоёр тал ижилхэн 'i' өгдөг тул зөрөхгүй.
            string lowered = input.ToLowerInvariant();
            try
            {
                lowered = lowered.Normalize(NormalizationForm.FormD);
            }
            catch (ArgumentException)
            {
                // Хосгүй surrogate — задлахгүйгээр үргэлжилнэ.
            }

            var sb = new StringBuilder(lowered.Length + 8);
            foreach (char ch in lowered)
            {
                UnicodeCategory cat = CharUnicodeInfo.GetUnicodeCategory(ch);
                if (cat == UnicodeCategory.NonSpacingMark ||
                    cat == UnicodeCategory.SpacingCombiningMark ||
                    cat == UnicodeCategory.EnclosingMark)
                {
                    continue;   // JS: .replace(/\p{M}/gu, '')
                }

                // 2. кирилл → латин
                string mapped;
                if (Map.TryGetValue(ch, out mapped)) sb.Append(mapped);
                else sb.Append(ch);
            }

            // 3–7.  String.Replace нь БҮХ тохиолдлыг солино = JS-ийн /g.
            string s = sb.ToString();
            s = s.Replace("kh", "h");   // латинаар бичсэн «х»
            s = s.Replace("ts", "c");   // «цаг» ← tsag эсвэл cag
            s = s.Replace("y", "i");    // «й/ы» ← y эсвэл i
            s = NonAlnum.Replace(s, " ");
            s = Doubled.Replace(s, "$1");
            return s.Trim();
        }

        /// <summary>ШИФР-ийн хэлбэр — зайг бүрэн хасна. «БА-01» → «ba01».</summary>
        public static string FoldCode(string input)
        {
            return Fold(input).Replace(" ", string.Empty);
        }
    }
}
