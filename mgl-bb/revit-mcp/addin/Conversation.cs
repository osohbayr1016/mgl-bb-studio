using System;
using System.Collections.Generic;
using System.Text.RegularExpressions;

namespace RevitMcpAddin
{
    /// <summary>
    /// ЯРИА ХЭЛЦЛИЙН ТӨЛӨВ — чиглүүлэгчийг агент болгох суурь.
    ///
    /// ⚠️ ЯАГААД ХЭРЭГТЭЙ ВЭ: одоогийн туслах мессеж бүрийг БИЕ ДААСАН гэж
    /// үздэг.  Тиймээс хоёр ердийн зүйл ажиллахгүй:
    ///
    ///   «хуудсуудаа харуул»  →  «эхнийхийг нь ялга»     ← юуг гэдгийг мэдэхгүй
    ///   «хуудас ялга»        →  «Олдсонгүй» (мухар зам)  ← асуух ёстой байсан
    ///
    /// Хоёулаа НЭГ зүйл дутсанаас болдог: өмнөх ээлжийн санах ой.
    ///
    /// ⚠️ LLM ХЭРЭГГҮЙ.  Агент шинж чанар нь ерөнхий төлөвлөлтөөс биш,
    /// ТӨЛӨВӨӨС ирдэг.  Энэ анги нь төлөвийн машин — 60 мөр, магадлалгүй,
    /// бүрэн тестлэгдэх боломжтой.
    ///
    /// ⚠️ ХАМГИЙН ЧУХАЛ ДҮРЭМ — ХЭРЭГЛЭГЧИЙГ БҮҮ БАРЬ.  Муу зохиосон слот
    /// бөглөгч нь хүнийг гацаанд оруулдаг: «Аль хуудсыг?» гэж асуугаад,
    /// хүн «за яахав, явцаа илгээе» гэхэд «Тийм хуудас олдсонгүй» гэж
    /// хариулдаг.  Тиймээс ШИНЭ САНАА ҮРГЭЛЖ ЯЛНА (`ShouldYieldTo`), мөн
    /// хүлээлт нь ээлж болон цагаар ХУГАЦАА ДУУСНА.
    /// </summary>
    internal static class Conversation
    {
        /// <summary>Хариу хүлээх дээд ээлж.  Түүнээс хойш өөрөө мартана.</summary>
        private const int MaxTurns = 3;

        /// <summary>Хариу хүлээх дээд хугацаа.  Хүн цайндаа явсан байж болно.</summary>
        private static readonly TimeSpan MaxAge = TimeSpan.FromMinutes(5);

        /// <summary>Хүлээгдэж буй асуулт — юу хийх гэж байсан, юу дутуу вэ.</summary>
        internal sealed class PendingAsk
        {
            public string Intent;      // «isolate_sheet»
            public string Slot;        // «sheet»
            public DateTime AskedAt;
            public int TurnsWaited;
        }

        private static PendingAsk _pending;

        /// <summary>Сүүлд жагсаасан хуудсууд — «эхнийх», «сүүлийнх» гэх заалтад.</summary>
        private static List<Slots.SheetRef> _lastSheets = new List<Slots.SheetRef>();

        /* ============================================================== */
        /*  Хүлээлт                                                        */
        /* ============================================================== */

        /// <summary>
        /// Слот дутуу — хэрэглэгчээс асууна.
        ///
        /// Буцах утга: ДАХИН асуух эсэх.  `false` бол хязгаарт хүрсэн тул
        /// дуудагч эцсийн алдаа харуулж, хүлээхээ болих ёстой.
        ///
        /// ⚠️ ТООЛУУРЫГ ЭНД БАРИНА.  Хэрэглэгчийн хариу дахин таарахгүй бол
        /// `Ask` дахин дуудагдана; тоолуурыг тэглэвэл «Аль хуудсыг?» гэж
        /// МӨНХӨД асуух гогцоо үүснэ.  Ижил санаа+слот дээр үргэлжлүүлж
        /// тоолно.
        /// </summary>
        public static bool Ask(string intent, string slot)
        {
            int waited = 0;
            if (_pending != null &&
                string.Equals(_pending.Intent, intent, StringComparison.Ordinal) &&
                string.Equals(_pending.Slot, slot, StringComparison.Ordinal))
            {
                waited = _pending.TurnsWaited + 1;
            }

            if (waited >= MaxTurns)
            {
                _pending = null;
                return false;
            }

            _pending = new PendingAsk
            {
                Intent = intent,
                Slot = slot,
                AskedAt = DateTime.UtcNow,
                TurnsWaited = waited,
            };
            return true;
        }

        public static void Clear() => _pending = null;

        /// <summary>Хугацаа дуусаагүй хүлээлт байвал буцаана.</summary>
        public static PendingAsk Peek()
        {
            PendingAsk p = _pending;
            if (p == null) return null;
            if (p.TurnsWaited >= MaxTurns || DateTime.UtcNow - p.AskedAt > MaxAge)
            {
                _pending = null;
                return null;
            }
            return p;
        }

        /// <summary>
        /// Хүлээлт байгаа үед ШИНЭ САНАА ялах ёстой юу.
        ///
        /// ⚠️ Загвар ӨӨР санааг ИТГЭЛТЭЙ таньсан бол хүн сэдэв сольсон гэсэн
        /// үг — хүлээлтийг хаяна.  Үүнгүйгээр хүн гацаанд орно.
        /// </summary>
        public static bool ShouldYieldTo(RouteResult route)
        {
            if (route == null) return false;
            if (route.By == DecidedBy.Fallback) return false;   // танигдаагүй — хариу байж болно
            PendingAsk p = Peek();
            if (p == null) return true;
            return !string.Equals(route.Intent, p.Intent, StringComparison.Ordinal);
        }

        /// <summary>Хариу ирээгүй — нэг ээлж тоолно.</summary>
        public static void Tick()
        {
            if (_pending != null) _pending.TurnsWaited++;
        }

        /* ============================================================== */
        /*  Контекст — сүүлийн үр дүн                                      */
        /* ============================================================== */

        public static void RememberSheets(List<Slots.SheetRef> sheets)
        {
            _lastSheets = sheets ?? new List<Slots.SheetRef>();
        }

        public static IReadOnlyList<Slots.SheetRef> LastSheets => _lastSheets;

        // ⚠️ ЭВХСЭН хэлбэрээр тааруулна тул кирилл, латин, алдаатай бичлэг
        // бүгд НЭГ дүрмээр баригдана.  Бодит эвхэлтүүд (хэмжсэн):
        //
        //     эхний / эхнийх / эхнийхийг  →  ehni · ehnih · ehnihig
        //     сүүлийн / сүүлийнхийг       →  sulin · sulinhig
        //     suuliihiig (латинаар)       →  sulihig     ← «н» алга!
        //     сүүлчийн · эцсийн           →  sulchin · ecsin
        //     3 дахийг · 2 дугаар · 2 р   →  3 dahig · 2 dugar · 2 r
        //
        // ⚠️ ТӨГСГӨЛИЙН `\b`-Г АШИГЛАЖ БОЛОХГҮЙ.  Монгол хэл ЗАЛГАМАЛ тул
        // залгавар нь үгэнд наалддаг: «эхний» + «хийг» = «ehnihig» гэсэн
        // НЭГ үг.  `\behni\b` нь түүнийг олохгүй.  Тиймээс УГТВАРААР
        // тааруулна — эхлэлийн `\b` л хангалттай.
        private static readonly Regex FirstWord =
            new Regex(@"\b(ehni|negduger|neg deh|first)", RegexOptions.Compiled);

        private static readonly Regex LastWord =
            new Regex(@"\b(sulin|sulih|sulch|ecsin|last)", RegexOptions.Compiled);

        // ⚠️ Ганц `r`-д ТӨГСГӨЛИЙН хил ХЭРЭГТЭЙ: үгүй бол «БА-02 руу оч»
        // (эвхэхэд «ba 02 ru och») нь «2 дахь» гэж уншигдана.  Урт
        // хэлбэрүүд (dah/dugar) нь өөрсдөө хангалттай ялгаатай.
        private static readonly Regex OrdinalNum =
            new Regex(@"\b(\d{1,2})\s*(r\b|dah|deh|dugar|duger)", RegexOptions.Compiled);

        /// <summary>
        /// «эхнийхийг», «3 дахийг», «сүүлийнхийг» гэх мэт ЗААЛТААР хуудас олно.
        /// Сүүлд жагсаасан хуудас байхгүй бол null.
        ///
        /// ⚠️ Энэ нь `Slots.MatchSheet` АМЖИЛТГҮЙ болсны ДАРАА л ажиллана —
        /// шифр эсвэл нэр байвал тэр нь үргэлж давуу эрхтэй.
        /// </summary>
        public static Slots.SheetRef ResolveOrdinal(string raw)
        {
            if (_lastSheets.Count == 0 || string.IsNullOrWhiteSpace(raw)) return null;

            string t = " " + TextFold.Fold(raw) + " ";

            if (FirstWord.IsMatch(t)) return _lastSheets[0];
            if (LastWord.IsMatch(t)) return _lastSheets[_lastSheets.Count - 1];

            Match m = OrdinalNum.Match(t);
            if (m.Success && int.TryParse(m.Groups[1].Value, out int n) &&
                n >= 1 && n <= _lastSheets.Count)
            {
                return _lastSheets[n - 1];
            }
            return null;
        }
    }
}
