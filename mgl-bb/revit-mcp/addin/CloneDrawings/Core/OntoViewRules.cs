using System;
using System.Collections.Generic;
using System.Linq;

namespace RevitMcpAddin.CloneDrawings.Core
{
    /// <summary>
    /// «Загвар харагдацаас ИДЭВХТЭЙ харагдац руу хуулах» (2026-10-02) — Revit-гүй цэвэр дүрэм.  Инженер гараар зурсан төстэй
    /// харагдацаа НЭРЭЭР нь сонгоно; түүний хэмжээс, tag-ийг идэвхтэй харагдацын элемент дээр ИЖИЛ байдлаар (шинэ харагдац
    /// үүсгэхгүй) тавина.  Энд зөвхөн шийдвэр: хаанаас хуулах, харагдац эсрэг талаас харж байна уу, аль элемент загвар вэ.
    /// </summary>
    public static class OntoViewRules
    {
        /// <summary>Харагдац элементийн тэнхлэгийн ДАГУУ харж байна (огтлол) гэж үзэх хамгийн бага |cos|.</summary>
        public const double EndOnMin = 0.5;

        public static bool IsEndOn(double dot)
        {
            return Math.Abs(dot) >= EndOnMin;
        }

        /// <summary>
        /// Идэвхтэй харагдац дам нурууг загварын харагдацаас ЭСРЭГ талаас (нэг нь тэнхлэгийн + чиглэлд, нөгөө нь − чиглэлд) харж
        /// байвал зорилтын хүрээг 180° эргүүлнэ — эс бөгөөс хуулсан хэмжээс, tag зүүн-баруун толин тусгал болж харагдана.
        /// Аль нэг нь тэнхлэгийн дагуу биш (дагуу огтлол, план) бол шийдвэр гаргахгүй (false) — тэнд ердийн (загварын чиглэлд
        /// ойртуулсан) хүрээ хэвээр.
        /// </summary>
        /// <param name="templateDot">загварын харагдацын ViewDirection · загварын тэнхлэг</param>
        /// <param name="targetDot">идэвхтэй харагдацын ViewDirection · зорилтын тэнхлэг (эргүүлээгүй)</param>
        public static bool NeedsFlip(double templateDot, double targetDot)
        {
            if (!IsEndOn(templateDot) || !IsEndOn(targetDot)) return false;
            return (templateDot > 0) != (targetDot > 0);
        }

        /// <summary>Загвар харагдацын нэр дэвшигч — жагсаалтын нэг мөр.</summary>
        public sealed class ViewRow
        {
            public long Id;
            public string Name = string.Empty;
            public string TypeLabel = string.Empty;
            public int Dims, Tags, Notes;
            /// <summary>Идэвхтэй харагдацтай ижил төрлийн (огтлол ↔ огтлол, план ↔ план).</summary>
            public bool SameKind;

            public int Annotations { get { return Dims + Tags; } }
        }

        /// <summary>Нэр дэвшигчийн дараалал: ижил төрөл эхэнд → тэмдэглэгээ ихтэй → нэрээр.</summary>
        public static List<ViewRow> OrderViews(IEnumerable<ViewRow> rows)
        {
            return rows
                .OrderBy(r => r.SameKind ? 0 : 1)
                .ThenByDescending(r => r.Annotations)
                .ThenBy(r => r.Name, StringComparer.CurrentCultureIgnoreCase)
                .ToList();
        }

        /// <summary>Хайлтын текст: нэр + төрөл (нэрний хэсгээр, хэмжээсгүйгээр).</summary>
        public static string Haystack(ViewRow r)
        {
            return (r.Name ?? string.Empty) + " " + (r.TypeLabel ?? string.Empty);
        }

        /// <summary>
        /// Загварын харагдацын элемент (дам нуруу/багана)-ийг тодорхойлох: тэмдэглэгээнүүдийн лавлагаа хамгийн олонтой нь эхэнд.
        /// <paramref name="ambiguous"/> — дээд хоёр нь ижил тоотой (хэрэглэгч сонгоно).  Лавлагаагүй (0) элемент орохгүй.
        /// </summary>
        public static List<long> OrderHosts(IEnumerable<KeyValuePair<long, int>> refCounts, out bool ambiguous)
        {
            List<KeyValuePair<long, int>> list = refCounts
                .Where(k => k.Value > 0)
                .OrderByDescending(k => k.Value)
                .ThenBy(k => k.Key)
                .ToList();
            ambiguous = list.Count > 1 && list[0].Value == list[1].Value;
            return list.Select(k => k.Key).ToList();
        }
    }
}
