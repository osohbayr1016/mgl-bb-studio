using System;
using System.Globalization;
using System.IO;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace RevitMcpAddin
{
    /// <summary>
    /// Багийн контекстийн КЭШ ба ТӨЛӨВ.  ЦЭВЭР — `Autodesk.Revit.*` төрөл
    /// НЭГ Ч БАЙХГҮЙ.
    ///
    /// ⚠️ ЯАГААД REVIT-ГҮЙ ВЭ:
    ///   (1) net48 (Revit 2024) build дээр ч хөрвөх ёстой,
    ///   (2) `check_team_context.py` нь `dotnet run`-аар ЭНЭ ГАНЦ ФАЙЛЫГ
    ///       Revit суулгацгүйгээр хөрвүүлж тестэлнэ — `Nudges.cs`,
    ///       `Timing.cs`, `Percentiles.cs`-ийн ижил загвар.  Add-in-д C#
    ///       тест ТЭГ байгаа тул энэ бол цорын ганц хамрах боломж.
    ///
    /// ⚠️ ЭНЭ АНГИ БАГ ШИЙДДЭГГҮЙ.  Шат нь СЕРВЕР дээр
    /// (`backend/src/lib/teamContext.ts`).  Энд зөвхөн: кэш унших/бичих,
    /// шинэчлэх хугацаа, chip-ийн текст.
    ///
    /// ⚠️ КЛИЕНТ ДҮРМИЙН БАГЦТАЙ БАГУУДЫН ЖАГСААЛТЫГ ХЭЗЭЭ Ч ХАДГАЛАХГҮЙ.
    /// Зөвхөн серверийн `scopes`-оос гаргасан НЭГ туг (`HasRulePack`).  Найм
    /// гэдэг нь ТӨЛӨВЛӨЛТИЙН тоо, эмхэтгэх литерал БИШ.
    /// </summary>
    public static class TeamContext
    {
        /* ============================================================== */
        /*  Тогтмолууд                                                     */
        /* ============================================================== */

        /// <summary>Сервер дахин асуухаас өмнөх хамгийн бага завсар.</summary>
        public const int RefreshIntervalSec = 900;   // 15 мин

        /// <summary>Сүлжээгүй үед кэш хүчинтэй байх дээд хугацаа.</summary>
        public const int StaleAfterSec = 86400;      // 24 цаг

        /// <summary>
        /// Багийн контекст авах HTTP хүлээлтийн дээд хугацаа.
        ///
        /// ⚠️ `ApiClient.Http`-ийн 180 секундыг ХЭРЭГЛЭЖ БОЛОХГҮЙ: тэр нь
        /// 20k мөрийн QTO push-д зориулагдсан (`ApiClient.cs:56`).  Нэг
        /// chip гурван минут «дүүжлэгдэх» нь R7-ийн зөрчил.
        /// </summary>
        public const int RequestTimeoutSec = 5;

        /// <summary>%APPDATA%\RevitMcpAddin\team-context.json</summary>
        public static string CachePath
        {
            get
            {
                return Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
                    "RevitMcpAddin",
                    "team-context.json");
            }
        }

        /* ============================================================== */
        /*  Төлөв                                                          */
        /* ============================================================== */

        /// <summary>
        /// ⚠️ БИЧИГДСЭНИЙ ДАРАА ХЭЗЭЭ Ч ӨӨРЧЛӨГДӨХГҮЙ (immutable-аар
        /// хэрэглэнэ).  Тиймээс `Current`-ыг солиход түгжээ ШААРДЛАГАГҮЙ —
        /// нэг лавлагаа солих нь атом.
        /// </summary>
        public sealed class State
        {
            /// <summary>null = UNCERTAIN (илрүүлэлт УНАСАН).</summary>
            [JsonPropertyName("team_code")] public string TeamCode { get; set; }

            [JsonPropertyName("confidence")] public double Confidence { get; set; }

            /// <summary>`TEAM_SOURCES`-ийн нэг утга.</summary>
            [JsonPropertyName("source")] public string Source { get; set; }

            [JsonPropertyName("last_verified")] public string LastVerified { get; set; }

            /// <summary>null = зөрчилгүй.</summary>
            [JsonPropertyName("conflict")] public string[] Conflict { get; set; }

            /// <summary>Сонгогчийг урьдчилан тэмдэглэхэд.</summary>
            [JsonPropertyName("candidates")] public string[] Candidates { get; set; }

            /// <summary>
            /// Серверийн `scopes`-д "TEAM" байсан эсэх.
            /// ⚠️ `false` + `TeamCode != null` = ДҮРМИЙН БАГЦГҮЙ БАГ
            /// (MGMT / EZ / GT — эзэн баталсан 2026-08-30).  Энэ нь
            /// UNCERTAIN БИШ.
            /// </summary>
            [JsonPropertyName("has_rule_pack")] public bool HasRulePack { get; set; }

            [JsonPropertyName("fetched_at")] public long FetchedAtUnix { get; set; }
        }

        /// <summary>
        /// СҮҮЛД хэрэглэгдсэн төлөв.  `LoadCache()` ба
        /// `RefreshTeamContextSoon` хоёулаа энд бичнэ.
        ///
        /// ⚠️ `volatile` — арын thread бичиж, UI thread уншина.
        /// </summary>
        public static volatile State Current;

        /* ============================================================== */
        /*  Цэвэр шийдвэрүүд — `check_team_context.py` эдгээрийг барина      */
        /* ============================================================== */

        /// <summary>
        /// UNCERTAIN эсэх — `TeamCode == null`, өөрөөр хэлбэл ИЛРҮҮЛЭЛТ
        /// УНАСАН.
        ///
        /// ⚠️ Энэ нь `!HasRulePack`-тай ИЖИЛ БИШ (эзэн баталсан 2026-08-30):
        /// багцгүй баг нь МЭДЭГДЭЖ байгаа баг — chip түүнийг НЭРЛЭНЭ,
        /// «тодорхойгүй» гэж ХЭЛЭХГҮЙ, хэрэглэгчээс залруулга ч ШААРДАХГҮЙ.
        /// </summary>
        public static bool IsUncertain(State s)
        {
            return s == null || string.IsNullOrEmpty(s.TeamCode);
        }

        /// <summary>
        /// Дахин асуух эсэх (цэвэр, тестлэгдэх).
        ///
        /// ⚠️ `s == null` (кэш байхгүй / уншилт унасан) бол ҮРГЭЛЖ `true` —
        /// эс бөгөөс эхний ажиллуулалтад ХЭЗЭЭ Ч асуулга явахгүй ба chip
        /// мөнхөд хоосон үлдэнэ.
        /// </summary>
        public static bool ShouldRefresh(State s, long nowUnix)
        {
            if (s == null) return true;
            if (s.FetchedAtUnix <= 0) return true;
            // Ирээдүйн тамга (машины цаг буруу) — дахин асуу.
            if (s.FetchedAtUnix > nowUnix) return true;
            return nowUnix - s.FetchedAtUnix >= RefreshIntervalSec;
        }

        /// <summary>Кэш хэтэрхий хуучирсан эсэх — chip дээр «(хуучин)» нэмнэ.</summary>
        public static bool IsStale(State s, long nowUnix)
        {
            if (s == null) return true;
            if (s.FetchedAtUnix <= 0) return true;
            if (s.FetchedAtUnix > nowUnix) return false;
            return nowUnix - s.FetchedAtUnix >= StaleAfterSec;
        }

        /// <summary>
        /// Серверийн хариуг кэшийн төлөв болгоно.
        ///
        /// ⚠️ ЭНЭ ФАЙЛ `TeamContextResult`-ыг МЭДЭХГҮЙ (тэр нь `RevitApi.cs`-д,
        /// net48 тестийн хамрах хүрээнээс ГАДНА) тул талбаруудыг ЗАДЛАЖ
        /// өгнө.  ЦЭВЭР ХӨРВҮҮЛЭГЧ — `Current`-ыг ӨӨРЧЛӨХГҮЙ; утга оноох нь
        /// ЗӨВХӨН дуудагчийн үүрэг.
        /// </summary>
        public static State FromResult(string teamCode, double conf, string source,
                                       string lastVerified, string[] conflict,
                                       string[] candidates, bool hasRulePack,
                                       long nowUnix)
        {
            return new State
            {
                TeamCode = string.IsNullOrEmpty(teamCode) ? null : teamCode,
                Confidence = conf,
                Source = string.IsNullOrEmpty(source) ? "uncertain" : source,
                LastVerified = string.IsNullOrEmpty(lastVerified) ? null : lastVerified,
                Conflict = (conflict != null && conflict.Length > 0) ? conflict : null,
                Candidates = candidates ?? new string[0],
                HasRulePack = hasRulePack,
                FetchedAtUnix = nowUnix
            };
        }

        /* ============================================================== */
        /*  Chip-ийн текст                                                 */
        /* ============================================================== */

        /// <summary>
        /// Chip-ийн текст.  mn/en — `Lang.T`-ийн ижил дүрэм.
        ///
        /// ⚠️ ХЭЗЭЭ Ч ХООСОН МӨР БУЦААХГҮЙ: хоосон chip нь «add-in
        /// ажиллахгүй байна» гэж уншигдана.
        /// </summary>
        public static string ChipText(State s, bool mongolian)
        {
            string teamWord = mongolian ? "Баг" : "Team";

            if (IsUncertain(s))
            {
                string unknown = mongolian ? "тодорхойгүй" : "unknown";
                if (s != null && s.Conflict != null && s.Conflict.Length > 0)
                {
                    return teamWord + ": " + unknown + " (" + string.Join("/", s.Conflict) + ")";
                }
                return teamWord + ": " + unknown;
            }

            // ⚠️ БАГЦГҮЙ БАГ — «тодорхойгүй» ГЭЖ ХЭЛЭХГҮЙ.  Баг зөв
            //    илрүүлэгдсэн, зөвхөн нийцлийн шалгалт алгасагдсан.
            if (!s.HasRulePack)
            {
                string noPack = mongolian ? "дүрмийн багцгүй" : "no rule pack";
                return teamWord + ": " + s.TeamCode + " (" + noPack + ")";
            }

            if (s.Source == "manual")
            {
                return teamWord + ": " + s.TeamCode + " ✔";
            }

            return teamWord + ": " + s.TeamCode + " (" + SourceLabel(s.Source, mongolian) + ")";
        }

        /// <summary>Шатны нэрийн хүнд ойлгомжтой хэлбэр.</summary>
        public static string SourceLabel(string source, bool mongolian)
        {
            switch (source)
            {
                case "binding": return mongolian ? "холбоосоор" : "binding";
                case "document": return mongolian ? "файлаас" : "document";
                case "project_shares": return mongolian ? "төслөөс" : "project";
                case "user_primary": return mongolian ? "профайлаас" : "profile";
                case "sheet_prefix": return mongolian ? "хуудсаар" : "sheets";
                case "behavior": return mongolian ? "ажлаар" : "activity";
                case "manual": return mongolian ? "гараар" : "manual";
                case "uncertain": return mongolian ? "тодорхойгүй" : "unknown";
                default: return mongolian ? "тодорхойгүй" : "unknown";
            }
        }

        /* ============================================================== */
        /*  Диск                                                           */
        /* ============================================================== */

        private static readonly JsonSerializerOptions WriteOptions =
            new JsonSerializerOptions { WriteIndented = true };

        /// <summary>
        /// Дискнээс уншина.  Уншилт унавал `null` — ХЭЗЭЭ Ч шидэхгүй.
        /// </summary>
        public static State LoadCache()
        {
            try
            {
                string path = CachePath;
                if (!File.Exists(path)) return null;
                string text = File.ReadAllText(path, Encoding.UTF8);
                if (string.IsNullOrWhiteSpace(text)) return null;
                return JsonSerializer.Deserialize<State>(text);
            }
            catch
            {
                // Эвдэрсэн кэш = кэшгүй.  Баг «тодорхойгүй» болно, add-in
                // бүхэлдээ унахаас ХАМААГҮЙ дээр.
                return null;
            }
        }

        /// <summary>
        /// Диск рүү атомоор бичнэ.
        ///
        /// ⚠️ Хоёр Revit нэг %APPDATA%-г ХУВААЛЦАЖ БОЛНО тул түр файл нь
        /// process-id дагаварт (`ChangeTracker.cs:577-581`-ийн загвар), дараа
        /// нь `File.Move`.  Ингэхгүй бол хоёр процесс нэг түр файл руу зэрэг
        /// бичиж, хагас JSON үлдээнэ.
        /// </summary>
        public static void SaveCache(State s)
        {
            if (s == null) return;
            try
            {
                string path = CachePath;
                string dir = Path.GetDirectoryName(path);
                if (!string.IsNullOrEmpty(dir) && !Directory.Exists(dir)) Directory.CreateDirectory(dir);

                int pid = System.Diagnostics.Process.GetCurrentProcess().Id;
                string tmp = path + "." + pid.ToString(CultureInfo.InvariantCulture) + ".tmp";
                File.WriteAllText(tmp, JsonSerializer.Serialize(s, WriteOptions), Encoding.UTF8);
                if (File.Exists(path)) File.Delete(path);
                File.Move(tmp, path);
            }
            catch
            {
                // Диск бичилт унах нь ажлыг блоклох ЁСГҮЙ (§75-ын доройтол).
            }
        }
    }
}
