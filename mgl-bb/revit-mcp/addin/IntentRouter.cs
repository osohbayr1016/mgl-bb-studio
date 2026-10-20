using System;
using System.Collections.Generic;

namespace RevitMcpAddin
{
    /// <summary>Аль давхарга шийдсэн бэ.</summary>
    public enum DecidedBy
    {
        /// <summary>Тодорхой түлхүүр үг — сүлжээ, загвар хэрэггүй.</summary>
        Keyword,
        /// <summary>Сургасан ангилагч.</summary>
        Model,
        /// <summary>Хэн ч итгэлтэй биш — хэрэглэгчээс асууна.</summary>
        Fallback,
    }

    public sealed class RouteResult
    {
        /// <summary>`IntentModel`-ийн нэршил (submit_progress …).  Fallback үед null.</summary>
        public string Intent { get; set; }
        public double Confidence { get; set; }
        public DecidedBy By { get; set; }
        /// <summary>«БА-01» гэх мэт хуудасны дугаар, эсвэл null.</summary>
        public string SheetHint { get; set; }
        /// <summary>Fallback үед хэрэглэгчид санал болгох дараалал.</summary>
        public List<string> Suggestions { get; set; } = new List<string>();
        /// <summary>Дибагт — «submit 0.71 · help 0.12 …».</summary>
        public string Debug { get; set; }
    }

    /// <summary>
    /// САНАА ЧИГЛҮҮЛЭГЧ — гурван давхарга, дарааллаар.
    ///
    ///   1. ТОДОРХОЙ ТҮЛХҮҮР ҮГ (`IntentParser`)   0 мс, офлайн, 100% тодорхой
    ///   2. СУРГАСАН АНГИЛАГЧ (`IntentModel`)      ~1 мс, офлайн, ҮНЭГҮЙ
    ///   3. СОНГОЛТ ХАРУУЛАХ                        хэрэглэгчээс асууна
    ///
    /// ⚠️ 3-Р ДАВХАРГА БОЛ ЗӨВХӨН НӨӨЦ БИШ — тэр бол ХАМГИЙН САЙН
    /// СУРГАЛТЫН ӨГӨГДЛИЙН ЭХ СУРВАЛЖ.  Хэрэглэгч жагсаалтаас сонгох бүрд
    /// бид «энэ текст → энэ санаа» гэсэн ЯГ ЗӨВ шошготой мөр авдаг.  Тиймээс
    /// fallback-ийг «алдаа» гэж бүү үз — түүнийг ХЯЛБАР, ХУРДАН бол.
    ///
    /// ⚠️ LLM ЭНД ОРООГҮЙ.  Энэ бүхэн офлайн, үнэгүй, ажилтан бүрд ижил
    /// ажиллана — бүтээгдэхүүнийг бусад компанид зарахад суудал тутмын
    /// AI өртөг гарахгүй байх нь ЦӨМ шаардлага.
    /// </summary>
    public static class IntentRouter
    {
        /// <summary>
        /// Загварын итгэлцлийн доод босго.  Үүнээс доош бол асууна.
        ///
        /// ⚠️ 2026-08-25-нд 0.55-аас 0.45 БОЛГОВ — таамаглаар биш, 2392 мөрийн
        /// хөндлөн шалгалт дээр ХЭМЖИЖ:
        ///
        ///     босго   үйлдэл хийсэн   ҮЙЛДЛИЙН ЗӨВ   буруу үйлдэл
        ///     0.60        85.6%          98.4%           28
        ///     0.55        88.2%          98.1%           35
        ///     0.45        91.9%          97.1%           55
        ///     0.40        93.1%          96.6%           65
        ///
        /// 0.55 → 0.45 нь хамрах хүрээг 3.7 нэгжээр өргөсгөж, нарийвчлалыг
        /// 1 нэгжээр л бууруулна.  Босгоос доогуур унаад «асуух» болсон
        /// ажиллагаатай мөр 163 байна — тэднийг үйлдэл болгох цорын ганц
        /// зөв арга нь ӨГӨГДӨЛ нэмэх, босго буулгах БИШ.
        ///
        /// Энэ солилцоо ЗӨВ, учир нь буруу үйлдлийн ЗАРДАЛ БАГА:
        ///   • `submit_progress` нь НООРОГ гаргадаг — баталгаажуулах нүд ба
        ///     товч дарж байж л сервер рүү бичнэ.  Автомат бичилт БАЙХГҮЙ.
        ///   • `isolate_sheet` нь «буцаа» гэхэд цуцлагдана.
        ///   • бусад нь зөвхөн УНШИНА.
        /// Тиймээс буруу таамаглалын үнэ = нэг товшилт, харин илүү асуух нь
        /// хүн бүрийн, өдөр бүрийн саад.
        ///
        /// ⚠️ Хэрэв ирээдүйд БИЧИХ үйлдэл (баталгаажуулалтгүй) нэмэгдвэл
        /// ЭНЭ ТООГ ДАХИН ХЭМЖИЖ ӨНДӨРСГӨ.  Тэр үед зардлын тэнцвэр өөр.
        /// ⚠️ `app_settings['assistant.min_confidence']` мөр БАЙГАА ч ТҮҮНИЙГ
        /// УНШИХ КОД БИЧИГДЭЭГҮЙ.  Одоогоор энэ утгыг өөрчлөх цорын ганц арга
        /// нь ЭНД засаад add-in-ыг дахин барих.  Серверээс татдаг болговол
        /// migration 0195-ын тайлбарыг мөн засна.
        /// </summary>
        public static double MinConfidence { get; set; } = 0.45;

        /// <summary>
        /// Хамгийн өндөр ба хоёрдугаарын ЗӨРҮҮ энэ хэмжээнээс бага бол
        /// итгэлцэл хангалттай ч гэсэн асууна.  «Хоёулаа 0.5» гэдэг нь
        /// «мэдэхгүй» гэсэн үг.
        ///
        /// ⚠️ 2026-08-25-ны хэмжилтээр энэ нь одоогийн өгөгдөл дээр БАРАГ
        /// НӨЛӨӨГҮЙ (0.45 босгонд 468 vs 467 үйлдэл) — 9 ангилалтай үед
        /// тэргүүлэгч 0.45-аас давбал хоёрдугаар нь ойрхон байх нь ховор.
        /// ГЭХДЭЭ ХЭВЭЭР ҮЛДЭЭВ: англи мөрүүд нэмэгдэхэд ойрхон утгатай
        /// хос (жишээ нь «show sheets» ↔ «show all») үүсэх магадлал өснө,
        /// тэр үед энэ нь цорын ганц хамгаалалт болно.  Үнэ нь тэг.
        /// </summary>
        public static double MinMargin { get; set; } = 0.15;

        /// <summary>Fallback-д хэдэн сонголт харуулах вэ.</summary>
        private const int SuggestCount = 3;

        /// <summary>`IntentParser.Intent` → загварын нэршил.</summary>
        public static string NameOf(Intent i)
        {
            switch (i)
            {
                case Intent.DraftSubmit: return "submit_progress";
                case Intent.Isolate: return "isolate_sheet";
                case Intent.ResetView: return "reset_view";
                case Intent.Baseline: return "set_baseline";
                case Intent.Refresh: return "whats_changed";
                case Intent.Help: return "help";
                default: return null;
            }
        }

        /// <summary>Загварын нэршил → гүйцэтгэх `Intent`.</summary>
        public static Intent ToIntent(string name)
        {
            switch (name)
            {
                case "submit_progress": return Intent.DraftSubmit;
                case "isolate_sheet": return Intent.Isolate;
                case "reset_view": return Intent.ResetView;
                case "set_baseline": return Intent.Baseline;
                case "whats_changed": return Intent.Refresh;
                case "help": return Intent.Help;
                default: return Intent.Unknown;
            }
        }

        /// <summary>Хэрэглэгчид харуулах бүх сонголт (тогтмол дараалал).</summary>
        public static readonly string[] AllIntents =
        {
            "submit_progress",
            "list_sheets",
            "isolate_sheet",
            "whats_changed",
            "progress_status",
            "reset_view",
            "set_baseline",
            "help",
        };

        /// <summary>Текстийг чиглүүлнэ.  ХЭЗЭЭ Ч алдаа шидэхгүй.</summary>
        public static RouteResult Route(string text)
        {
            var r = new RouteResult();
            if (string.IsNullOrWhiteSpace(text))
            {
                r.By = DecidedBy.Fallback;
                r.Suggestions = DefaultSuggestions();
                return r;
            }

            // --- 1. Тодорхой түлхүүр үг --------------------------------
            ParsedIntent kw = IntentParser.Parse(text);
            if (kw.Intent != Intent.Unknown)
            {
                r.Intent = NameOf(kw.Intent);
                r.Confidence = 1.0;
                r.By = DecidedBy.Keyword;
                r.SheetHint = kw.SheetHint;
                r.Debug = "keyword";
                return r;
            }

            // --- 2. Сургасан ангилагч ----------------------------------
            IntentPrediction p = IntentModel.Predict(text);
            r.Debug = IntentModel.Explain(p);

            if (p?.Intent != null)
            {
                double margin = p.Ranked.Count > 1
                    ? p.Ranked[0].Value - p.Ranked[1].Value
                    : p.Ranked[0].Value;

                bool confident = p.Confidence >= MinConfidence && margin >= MinMargin;
                // ⚠️ `unknown` нь ЖИНХЭНЭ ангилал — загвар «энэ бол миний
                // ажил биш» гэж СУРСАН.  Түүнийг үйлдэл болгож болохгүй.
                bool actionable = p.Intent != IntentModel.UnknownIntent;

                if (confident && actionable)
                {
                    r.Intent = p.Intent;
                    r.Confidence = p.Confidence;
                    r.By = DecidedBy.Model;
                    r.SheetHint = IntentParser.ExtractSheetHint(text);
                    return r;
                }
            }

            // --- 3. Асууна ----------------------------------------------
            r.By = DecidedBy.Fallback;
            r.Confidence = p?.Confidence ?? 0;
            r.SheetHint = IntentParser.ExtractSheetHint(text);
            r.Suggestions = SuggestFrom(p);
            return r;
        }

        /// <summary>Загварын эрэмбээс хамгийн магадлалтай гурвыг санал болгоно.</summary>
        private static List<string> SuggestFrom(IntentPrediction p)
        {
            var outList = new List<string>();
            if (p?.Ranked != null)
            {
                foreach (KeyValuePair<string, double> kv in p.Ranked)
                {
                    if (kv.Key == IntentModel.UnknownIntent) continue;
                    outList.Add(kv.Key);
                    if (outList.Count >= SuggestCount) break;
                }
            }
            if (outList.Count == 0) return DefaultSuggestions();
            return outList;
        }

        /// <summary>Загваргүй үед — өдөр тутам хамгийн их хэрэглэгддэг гурав.</summary>
        private static List<string> DefaultSuggestions() =>
            new List<string> { "submit_progress", "list_sheets", "whats_changed" };

        /// <summary>Бүртгэлд бичих товч тэмдэглэгээ.</summary>
        public static string DecidedByTag(DecidedBy by)
        {
            switch (by)
            {
                case DecidedBy.Keyword: return "keyword";
                case DecidedBy.Model: return "model";
                default: return "fallback";
            }
        }
    }
}
