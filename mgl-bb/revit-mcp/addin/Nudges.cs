using System;
using System.Collections.Generic;

namespace RevitMcpAddin
{
    /// <summary>
    /// ИДЭВХТЭЙ САНААЧЛАГА — туслах ӨӨРӨӨ ярьж эхэлнэ.
    ///
    /// Захиалагчийн хүсэлт: «зөвхөн асуултад хариулаад байхгүй, хүмүүсийн
    /// хүссэн зүйлийг ХИЙДЭГ болго».  Энэ бол түүний хамгийн хямд хэлбэр.
    ///
    /// ⚠️ NLU ОГТ ШААРДАХГҮЙ.  Санаа таних загвар энд огт оролцохгүй тул
    /// ангилагчийн алдаа энэ боломжид нөлөөлөхгүй — эрсдэл ТЭГ.
    /// ⚠️ REVIT-ИЙН API-Д ОГТ ХҮРЭХГҮЙ.  Бүх дохио аль хэдийн санах ойд
    /// байгаа (`ChangeTracker.TryGetByKey`, кэшлэгдсэн контекст) тул
    /// `ExternalEvent` хэрэггүй, гацах эрсдэл ТЭГ.
    ///
    /// ⚠️ ЭНЭ ФАЙЛ `Autodesk.Revit.*`-д ХАМААРАХГҮЙ БАЙХ ЁСТОЙ.  `Pick()` нь
    /// ЦЭВЭР ФУНКЦ — ижил оролт ижил гаралт өгнө.  Тиймээс `check_nudge.py`
    /// нь Revit ачаалахгүйгээр бүх дүрэм, бүх төсвийн нөхцөлийг шалгана.
    /// Хэрэв энд Revit-ийн төрөл оруулбал тэр шалгалт БОЛОМЖГҮЙ болно.
    ///
    /// ⚠️ ХАМГИЙН ЧУХАЛ НЬ ДҮРЭМ БИШ, ТӨСӨВ.  Ямар ч ухаалаг сануулга өдөрт
    /// 8 удаа гарвал хүн add-in-ыг унтраана.  Тиймээс дүрэм ердөө ГУРАВ,
    /// нийт хязгаар нь ӨДӨРТ ХОЁР, хоорондоо 90 минут.
    /// </summary>
    internal static class Nudges
    {
        /* ============================================================== */
        /*  Төсөв                                                          */
        /* ============================================================== */

        /// <summary>НИЙТ хязгаар — дүрэм тус бүрд БИШ.</summary>
        public const int MaxPerDay = 2;

        // ⚠️ ЭНЭ ТООГ НОРМЫН ДҮГНЭЛТИЙН ТӨЛӨӨ БҮҮ НЭМ (Track 2-5, 2026-08-30).
        //    Энэ файлын толгойд «өдөрт 8 удаа гарвал хүн add-in-ыг унтраана»
        //    гэж бичсэн нь эзний R7 («огт тасалдал байхгүй») ҮГ ЧАНД.  Норм
        //    шалгалт нь релиз N-д ТАТАХ загвараар (ribbon-ы бичээс + самбарын
        //    хумигдсан хэсэг) хүрнэ, ТҮЛХЭХ мэдэгдэл ОГТ гаргахгүй.
        //
        // ⚠️ РЕЛИЗ N+1-д сануулга холбох УРЬДЧИЛСАН НӨХЦӨЛ: доорх `Ctx`-ийн
        //    `Busy` / `AwaitingAnswer` / `Suppressed` / `SecondsSinceTyping`
        //    нь бүгд WPF САМБАРЫН төлөв.  Арын урсгал тэднийг аюулгүй уншиж
        //    ЧАДАХГҮЙ, харин `ChangeTracker.Gate` барих боломжтой урсгалаас
        //    UI руу СИНХРОН маршаллах нь deadlock.  Тиймээс самбар нь UI
        //    үйл явдал бүрд ХӨДӨЛГӨШГҮЙ `Ctx` агшныг `volatile` талбарт
        //    нийтэлсний ДАРАА л жолоодогч бичигдэнэ.  Энэ нөхцөлгүйгээр
        //    холбох нь эсвэл залгидаг catch руу cross-thread онцгой шидэж
        //    (төсөв ЧИМЭЭГҮЙ утгагүй болно), эсвэл Revit-ийг гацаана.

        public static readonly TimeSpan MinGap = TimeSpan.FromMinutes(90);

        /// <summary>
        /// Хүн бичиж байхад таслах нь ХАМГИЙН МУУ.  Сүүлийн товшилтоос хойш
        /// энэ хугацаа өнгөрөөгүй бол чимээгүй байна.
        /// </summary>
        public static readonly TimeSpan QuietAfterTyping = TimeSpan.FromSeconds(90);

        /* ============================================================== */
        /*  Оролт / гаралт                                                 */
        /* ============================================================== */

        /// <summary>Шийдвэр гаргахад хэрэгтэй БҮХ зүйл — өөр эх сурвалж алга.</summary>
        internal sealed class Ctx
        {
            public DateTime NowLocal;
            public bool IsWorkday;

            /// <summary>Суурь авснаас хойшхи өөрчлөлтийн тоо.</summary>
            public int ChangeCount;
            public bool HasBaseline;
            public double BaselineAgeHours;

            /// <summary>ERP-д өнөөдөр явц бүртгэсэн эсэх.</summary>
            public bool ReportedToday;

            /// <summary>Ажилтай холбогдоогүй хуудасны тоо.</summary>
            public int UnboundSheets;

            /// <summary>Файл нээгдээд хэдэн минут болсон.</summary>
            public double MinutesSinceOpen;

            // --- чимээгүй байх нөхцөлүүд ---
            public bool Busy;              // хэрэгсэл ажиллаж байна
            public bool AwaitingAnswer;    // хүнээс асуулт хүлээж байна
            public bool Suppressed;        // sync / reload-latest явж байна
            public bool WebConnected;      // вэб уншигдсан эсэх
            public double SecondsSinceTyping;
        }

        internal sealed class Result
        {
            public string Id;
            public string TextMn, TextEn;
            public string OfferMn, OfferEn;
            /// <summary>«intent:set_baseline» · «ui:bind_sheets» · null.</summary>
            public string Action;
        }

        /// <summary>Өдрийн туршид хуримтлагдах төлөв.  Дуудагч эзэмшинэ.</summary>
        internal sealed class State
        {
            public DateTime Day;                 // орон нутгийн огноо
            public int SentToday;
            public DateTime LastSentUtc;
            public readonly HashSet<string> FiredToday =
                new HashSet<string>(StringComparer.Ordinal);

            /// <summary>Өдөр солигдвол тэглэнэ.</summary>
            public void RollOver(DateTime nowLocal)
            {
                if (Day.Date == nowLocal.Date) return;
                Day = nowLocal.Date;
                SentToday = 0;
                FiredToday.Clear();
            }
        }

        /* ============================================================== */

        /// <summary>
        /// Одоо сануулга явуулах уу — тийм бол алийг нь.  ЦЭВЭР ФУНКЦ.
        /// `null` = чимээгүй бай.
        ///
        /// ⚠️ Дуудагч нь `state`-ийг ЗӨВХӨН сануулга БОДИТООР харуулсан үед
        /// `MarkSent`-ээр шинэчилнэ — эс бөгөөс төсөв худал зарцуулагдана.
        /// </summary>
        public static Result Pick(Ctx c, State s)
        {
            if (c == null || s == null) return null;
            s.RollOver(c.NowLocal);

            // --- ЧИМЭЭГҮЙ БАЙХ НӨХЦӨЛҮҮД (дараалал нь хямдаас үнэтэй рүү) ---
            if (s.SentToday >= MaxPerDay) return null;
            if (c.Busy || c.AwaitingAnswer || c.Suppressed) return null;
            if (c.SecondsSinceTyping < QuietAfterTyping.TotalSeconds) return null;
            if (s.SentToday > 0 && (DateTime.UtcNow - s.LastSentUtc) < MinGap) return null;

            // ⚠️ Ажлын өдрөөс гадуур бүү сануул.  Амралтын өдөр ажиллаж
            // байгаа хүнийг «явц бүртгээгүй байна» гэж зэмлэх нь хамгийн
            // муу мэдрэмж төрүүлнэ.
            if (!c.IsWorkday) return null;

            int hour = c.NowLocal.Hour;
            if (hour < 9 || hour >= 19) return null;

            // --- ДҮРЭМ 1: өдөр дуусч байна, ажил хийсэн, бүртгээгүй ---
            // Хамгийн үнэ цэнтэй нь — ERP-ийн явцын бүртгэл бол
            // бүтээгдэхүүний гол зорилго.
            if (!s.FiredToday.Contains("no_progress_today") &&
                c.WebConnected && !c.ReportedToday &&
                c.ChangeCount >= 30 &&
                hour >= 16 && hour < 19)
            {
                return new Result
                {
                    Id = "no_progress_today",
                    TextMn = "Өнөөдөр " + c.ChangeCount + " өөрчлөлт хийжээ. " +
                             "Явцаа бүртгээгүй байна.",
                    TextEn = "You made " + c.ChangeCount + " changes today. " +
                             "Your progress is not recorded yet.",
                    OfferMn = "Одоо бүртгэх",
                    OfferEn = "Record now",
                    Action = "intent:submit_progress",
                };
            }

            // --- ДҮРЭМ 2: их ажил хийсэн ч суурьгүй тул тоологдохгүй ---
            // ⚠️ Энэ нь ЧИМЭЭГҮЙ ӨГӨГДӨЛ АЛДАХ тохиолдол: хүн ажиллаж
            // байгаа ч систем түүнийг харахгүй байна.  Эрт хэлэх ёстой.
            if (!s.FiredToday.Contains("no_baseline") &&
                !c.HasBaseline && c.ChangeCount >= 200)
            {
                return new Result
                {
                    Id = "no_baseline",
                    TextMn = "Суурь тэмдэглээгүй тул өнөөдрийн ажлыг тоолж чадахгүй байна.",
                    TextEn = "No baseline is set, so today's work is not being counted.",
                    OfferMn = "Одоо тэмдэглэх",
                    OfferEn = "Set it now",
                    Action = "intent:set_baseline",
                };
            }

            // --- ДҮРЭМ 3: хуудсууд ажилтай холбогдоогүй ---
            // Файл нээгдмэгц хэлэхгүй — хүн эхлээд ажлаа эхлүүлэг.
            if (!s.FiredToday.Contains("unbound_sheets") &&
                c.WebConnected && c.UnboundSheets > 0 &&
                c.MinutesSinceOpen >= 10)
            {
                return new Result
                {
                    Id = "unbound_sheets",
                    TextMn = c.UnboundSheets + " хуудас ажилтай холбогдоогүй байна — " +
                             "холбовол явц өөрөө тоологдоно.",
                    TextEn = c.UnboundSheets + " sheets are not linked to a task — " +
                             "linking them makes progress count automatically.",
                    OfferMn = "Холбох",
                    OfferEn = "Link them",
                    Action = "ui:bind_sheets",
                };
            }

            // ⚠️ «Суурь хуучирсан» нь ЭНД БАЙХГҮЙ — тэр нь ТУСДАА таслалт
            // болох ёсгүй.  `WhatsChangedAsync` түүнийг хэрэглэгчийн ӨӨРИЙН
            // асуултын хариуны АРД нэмдэг (piggyback).  Байгаа хариунд
            // наалдах нь тэг уйтгартай — шинэ таслалт бүү үүсгэ.

            return null;
        }

        /// <summary>Сануулга БОДИТООР харагдсаны дараа дуудна.</summary>
        public static void MarkSent(State s, Result r)
        {
            if (s == null || r == null) return;
            s.SentToday++;
            s.LastSentUtc = DateTime.UtcNow;
            s.FiredToday.Add(r.Id);
        }

        /// <summary>
        /// Хэрэглэгч «Дараа» гэвэл — тэр дүрмийг ӨНӨӨДРИЙН ТУРШ дахин
        /// гаргахгүй, гэхдээ төсвөөс хасахгүй (хүн үгүйсгэсэн нь
        /// сануулга «зарцуулагдсан» гэсэн үг биш).
        /// </summary>
        public static void Dismiss(State s, string id)
        {
            if (s == null || string.IsNullOrEmpty(id)) return;
            s.FiredToday.Add(id);
        }
    }
}
