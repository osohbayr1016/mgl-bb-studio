using System;
using System.Collections.Generic;
using System.Text.Json.Serialization;

namespace RevitMcpAddin
{
    // Бүлэглэх дүрэм: элемент олон материалтай үед материал бүр өөрийн
    // volume/area/mass-тай тусдаа мөр болно, харин count ба length_m зөвхөн
    // ҮНДСЭН (эзэлхүүнээрээ хамгийн том) материалын мөрөнд бичигдэнэ —
    // ингэснээр SUM(count) нь элементийн тоотой яг тэнцэнэ.
    public class QtoRow
    {
        [JsonPropertyName("category")]
        public string Category { get; set; }

        [JsonPropertyName("family")]
        public string Family { get; set; }

        [JsonPropertyName("type_name")]
        public string TypeName { get; set; }

        [JsonPropertyName("level")]
        public string Level { get; set; }

        [JsonPropertyName("material")]
        public string Material { get; set; }

        [JsonPropertyName("count")]
        public int Count { get; set; }

        [JsonPropertyName("length_m")]
        public double? LengthM { get; set; }

        [JsonPropertyName("area_m2")]
        public double? AreaM2 { get; set; }

        [JsonPropertyName("volume_m3")]
        public double? VolumeM3 { get; set; }

        [JsonPropertyName("mass_kg")]
        public double? MassKg { get; set; }

        /// <summary>Төрлийн марк (Type Mark) — ж: "Хн3.6", "ХБ-21х29".</summary>
        [JsonPropertyName("type_mark")]
        public string TypeMark { get; set; }

        /// <summary>Instance марк-уудын түүвэр — "МХ-12, ХБ-21 +7" хэлбэр.</summary>
        [JsonPropertyName("marks")]
        public string Marks { get; set; }

        /// <summary>Тухайн материалын давхаргын зузаан (CompoundStructure-ээс), мм.</summary>
        [JsonPropertyName("thickness_mm")]
        public double? ThicknessMm { get; set; }

        [JsonPropertyName("assembly_code")]
        public string AssemblyCode { get; set; }

        [JsonPropertyName("keynote")]
        public string Keynote { get; set; }
    }

    /// <summary>Өрөөний ведомостын нэг мөр — талбайтай өрөөнүүд л илгээгдэнэ.</summary>
    public class QtoRoom
    {
        [JsonPropertyName("number")]
        public string Number { get; set; }

        [JsonPropertyName("name")]
        public string Name { get; set; }

        [JsonPropertyName("level")]
        public string Level { get; set; }

        [JsonPropertyName("area_m2")]
        public double? AreaM2 { get; set; }
    }

    public class QtoPayload
    {
        [JsonPropertyName("project_id")]
        public int ProjectId { get; set; }

        [JsonPropertyName("file_name")]
        public string FileName { get; set; }

        [JsonPropertyName("revit_version")]
        public string RevitVersion { get; set; }

        [JsonPropertyName("push_id")]
        public string PushId { get; set; }

        /// <summary>
        /// Илгээгч add-in-ы хувилбар (`BuildInfo.Version`).
        ///
        /// ⚠️ ЗӨВХӨН АЖИГЛАЛТ.  Сервер тал `qto_runs.summary_json`-д тэмдэглэнэ;
        /// `schema_version` багана нь ХАТУУ `revit-2027` ХЭВЭЭР — түүнийг
        /// өөрчлөх нь түүхэн бүх run-ыг харьцуулах боломжгүй болгоно.
        ///
        /// ⚠️ ЯАГААД ХЭРЭГТЭЙ ВЭ: QTO push бол add-in-ы ХАМГИЙН ИХ УРСГАЛТАЙ
        /// зам мөртлөө хувилбарын мэдээлэл нь ТЭГ байсан — зөвхөн «Тоо хэмжээ»
        /// ажиллуулдаг инженер сервер талд БҮРЭН ҮЛ ҮЗЭГДЭХ байв.
        [JsonPropertyName("addin_version")]
        public string AddinVersion { get; set; } = BuildInfo.Version;

        [JsonPropertyName("rows")]
        public List<QtoRow> Rows { get; set; } = new List<QtoRow>();

        /// <summary>Өрөөний ведомость (0120) — гол төлөв BA host файлд л байдаг.</summary>
        [JsonPropertyName("rooms")]
        public List<QtoRoom> Rooms { get; set; } = new List<QtoRoom>();
    }

    /// <summary>201 body of POST /api/qto/revit-runs.</summary>
    public class QtoPushResult
    {
        [JsonPropertyName("run_id")]
        public int RunId { get; set; }

        [JsonPropertyName("facts")]
        public int Facts { get; set; }

        [JsonPropertyName("mapped")]
        public int Mapped { get; set; }

        [JsonPropertyName("unmapped")]
        public int Unmapped { get; set; }
    }

    public class LoginUser
    {
        [JsonPropertyName("role")]
        public string Role { get; set; }
    }

    public class LoginResponse
    {
        [JsonPropertyName("token")]
        public string Token { get; set; }

        [JsonPropertyName("user")]
        public LoginUser User { get; set; }
    }

    public class McpTokenResponse
    {
        [JsonPropertyName("token")]
        public string Token { get; set; }
    }

    public class ProjectInfo
    {
        [JsonPropertyName("id")]
        public int Id { get; set; }

        [JsonPropertyName("name")]
        public string Name { get; set; }
    }

    public class ProjectListResponse
    {
        [JsonPropertyName("projects")]
        public List<ProjectInfo> Projects { get; set; }
    }

    /// <summary>Нэг хүснэгт (Revit ViewSchedule) — эсийн текстээр.</summary>
    public class SchedulePushItem
    {
        [JsonPropertyName("name")]
        public string Name { get; set; }

        [JsonPropertyName("category")]
        public string Category { get; set; }

        [JsonPropertyName("columns")]
        public List<string> Columns { get; set; } = new List<string>();

        [JsonPropertyName("rows")]
        public List<List<string>> Rows { get; set; } = new List<List<string>>();
    }

    /// <summary>POST /api/qto/schedules бие.</summary>
    public class SchedulePushPayload
    {
        [JsonPropertyName("project_id")]
        public int ProjectId { get; set; }

        [JsonPropertyName("file_name")]
        public string FileName { get; set; }

        [JsonPropertyName("schedules")]
        public List<SchedulePushItem> Schedules { get; set; } = new List<SchedulePushItem>();
    }

    /// <summary>POST /api/qto/schedules → 201 {saved, rows}.</summary>
    public class SchedulePushResult
    {
        [JsonPropertyName("saved")]
        public int Saved { get; set; }

        [JsonPropertyName("rows")]
        public int Rows { get; set; }
    }

    /// <summary>POST /api/upload?bucket=media → {url:'/media/<key>', key}.</summary>
    public class MediaUploadResult
    {
        [JsonPropertyName("url")]
        public string Url { get; set; }

        [JsonPropertyName("key")]
        public string Key { get; set; }
    }

    /// <summary>POST /api/qto/view-exports бие.</summary>
    public class ViewExportPayload
    {
        [JsonPropertyName("project_id")]
        public int ProjectId { get; set; }

        [JsonPropertyName("view_name")]
        public string ViewName { get; set; }

        [JsonPropertyName("file_name")]
        public string FileName { get; set; }

        [JsonPropertyName("media_url")]
        public string MediaUrl { get; set; }
    }

    /// <summary>POST /api/qto/view-exports → 201 {id}.</summary>
    public class ViewExportResult
    {
        [JsonPropertyName("id")]
        public int Id { get; set; }
    }

    /// <summary>
    /// %APPDATA%\RevitMcpAddin\settings.json дотор хадгалагдана. Нууц үг
    /// хэзээ ч хадгалагдахгүй — зөвхөн урт хугацааны токен үлдэнэ.
    /// </summary>
    public class AddinSettings
    {
        /// <summary>
        /// Тохиргооны файл ч, орчны хувьсагч ч байхгүй үеийн ЭЦСИЙН fallback.
        ///
        /// ⚠️ Урьд нь энэ нь `const` байсан тул өөр компанид add-in-ийг ДАХИН
        ///    BUILD хийхээс өөр аргагүй байв.  Одоо гурван давхарга:
        ///      1. %APPDATA%\RevitMcpAddin\settings.json дахь `api_host`
        ///      2. `MGL_API_HOST` орчны хувьсагч (IT-ийн бүлгэн суулгацад тохиромжтой)
        ///      3. доорх өгөгдмөл утга
        ///    Тэгэхээр шинэ компанид зөвхөн орчны хувьсагч тавихад л хангалттай —
        ///    C# кодыг дахин хөрвүүлэх шаардлагагүй.
        /// </summary>
        public const string FallbackApiHost = "https://mgl-progress-api.mglenc-design.workers.dev";

        /// <summary>Орчны хувьсагчийн нэр — бүлгэн суулгацад дарж бичих гарц.</summary>
        public const string ApiHostEnvVar = "MGL_API_HOST";

        /// <summary>
        /// Орчны хувьсагч → өгөгдмөл гэсэн дарааллаар шийдэгдсэн үндсэн хаяг.
        /// `settings.json` дотор `api_host` байвал түүнийг `SettingsStore` тавина.
        /// </summary>
        public static string DefaultApiHost
        {
            get
            {
                string fromEnv = Environment.GetEnvironmentVariable(ApiHostEnvVar);
                if (!string.IsNullOrWhiteSpace(fromEnv))
                {
                    return fromEnv.Trim().TrimEnd('/');
                }
                return FallbackApiHost;
            }
        }

        /// <summary>
        /// ГҮЕХЭН хуулбар — `SettingsStore.Load()` кэшээ хамгаалахад.
        ///
        /// ⚠️ ЯАГААД ХЭРЭГТЭЙ ВЭ: `Load()` нь одоо КЭШЛЭГДДЭГ бөгөөд хэд хэдэн
        /// дуудагч буцаж ирсэн объектыг ӨӨРЧИЛДӨГ (`SettingsDialog` нь
        /// `ApiHost`/`Token`/`ProjectId`-г, `ScheduleExportCommand` нь
        /// `SelectedSchedules`-ыг, `BatchSheetCommand` нь `SheetGen`-ийг).
        /// Хуулбар буцаахгүй бол нэг дуудагчийн засвар БҮХ дуудагчид тархана.
        ///
        /// ⚠️ ГҮЕХЭН гэдгийг санах: жагсаалт/дэд объектын ССЫЛКА хуваалцагдана.
        /// Дээрх гурван дуудагч бүгд ШИНЭ объект ОНООДОГ (`= prefs`,
        /// `= ...ToList()`) тул аюулгүй.  Хэрэв хэн нэгэн `SelectedSchedules
        /// .Add(...)` гэж АГУУЛГЫГ нь өөрчилвөл кэш бохирдоно — тэр үед
        /// гүнзгий хуулбар руу шилжинэ.
        /// </summary>
        public AddinSettings ShallowCopy()
        {
            return (AddinSettings)MemberwiseClone();
        }

        [JsonPropertyName("api_host")]
        public string ApiHost { get; set; } = DefaultApiHost;

        [JsonPropertyName("token")]
        public string Token { get; set; }

        /// <summary>
        /// DPAPI-аар шифрлэгдсэн токен (base64).  `SettingsStore` дискэнд
        /// ЗӨВХӨН үүнийг бичдэг; `Token` нь санах ойд л амьдарна.
        /// Хуучин settings.json-д ил `token` байвал нэг удаа хөрвүүлж,
        /// ил хувилбарыг устгана.
        /// </summary>
        [JsonPropertyName("token_enc")]
        public string TokenEnc { get; set; }

        [JsonPropertyName("username")]
        public string Username { get; set; }

        [JsonPropertyName("project_id")]
        public int? ProjectId { get; set; }

        [JsonPropertyName("project_name")]
        public string ProjectName { get; set; }

        /// <summary>
        /// Илгээхдээ ачаалагдсан RVT link файлуудыг хамруулах эсэх — файл тус бүр
        /// ТУСДАА run болж явна (Decision #2). Хуучин settings.json-д талбар
        /// байхгүй бол default true хэвээр үлдэнэ.
        /// </summary>
        [JsonPropertyName("include_links")]
        public bool IncludeLinks { get; set; } = true;

        /// <summary>«Хүснэгт илгээх»-ийн сонгогдсон schedule нэрс (session хооронд санана).</summary>
        [JsonPropertyName("selected_schedules")]
        public List<string> SelectedSchedules { get; set; } = new List<string>();

        /// <summary>«Хуудас үүсгэх»-ийн сүүлд хэрэглэсэн тохиргоо (session хооронд санана).</summary>
        [JsonPropertyName("sheet_gen")]
        public SheetGenPrefs SheetGen { get; set; } = new SheetGenPrefs();

        /// <summary>«Хуулж тавих»-ын сүүлд хэрэглэсэн сонголт (session хооронд санана).</summary>
        [JsonPropertyName("copy_to_other")]
        public CopyToOtherPrefs CopyToOther { get; set; } = new CopyToOtherPrefs();

        /// <summary>«Зураг клонлох»-ын сүүлд хэрэглэсэн сонголт (session хооронд санана).</summary>
        [JsonPropertyName("clone_drawings")]
        public CloneDrawingsPrefs CloneDrawings { get; set; } = new CloneDrawingsPrefs();

        /// <summary>
        /// Хэрэглэгчийн сонгосон баг — ⚠️ ЗӨВЛӨМЖ (hint), ЗАРЛАЛ БИШ.
        ///
        /// Сервер рүү `hint_team_code` гэж илгээгдэнэ.  Сервер түүнийг
        /// `user_teams` (аль ч харьяалал) эсвэл `isManager`-ээр
        /// БАТАЛГААЖУУЛНА; эс бөгөөс 403.  Энэ файлыг тухайн Windows
        /// хэрэглэгч ГАРААР засаж чадах тул ХЭЗЭЭ Ч эрхийн эх сурвалж
        /// БОЛОХГҮЙ (§82-ийн 4-р шалгуур: тэг хөндлөн-багийн алдагдал).
        ///
        /// ⚠️ `GET /team-context` нь үүнийг ЗӨВХӨН эхо хийдэг — шийдвэрт
        /// ОГТ нөлөөлөхгүй.  Хүлээн зөвшөөрөх цорын ганц зам нь
        /// `POST /team-context/verify`.
        /// </summary>
        [JsonPropertyName("team_override")]
        public string TeamOverride { get; set; }

        /// <summary>
        /// НИЙЦЛИЙН ЭРХИЙН ТҮВШИН — «0».. «5», СЕРВЕРИЙН ТОЛЬ (v2 §80, 0230).
        ///
        /// ⚠️ ЭНЭ БОЛ КЭШ, ТОХИРГОО БИШ.  Цорын ганц эх сурвалж нь
        /// `app_settings['bim.compliance.authority_level']`, түүнийг
        /// `GET /api/learning/settings`-ийн `compliance.authority_level`
        /// зөөнө.  Хэрэглэгч энэ файлыг гараар засаж болох тул үүнийг
        /// ХЭЗЭЭ Ч эрх нээх шийдвэрт хэрэглэхгүй — зөвхөн
        /// `POST /api/revit/health`-д «энэ суулгац ямар түвшин мэдэж байна»
        /// гэж ТАЙЛАГНАНА (`addin_installs.authority_level`).
        ///
        /// ⚠️ ХООСОН = хараахан нэг ч удаа серверээс аваагүй.  Тэр үед
        /// `authority_level` нь `null` болж явна — сервер түүнийг хүлээж
        /// авдаг (2-8 §9 №14: «суваг хараахан байхгүй бол null илгээнэ»).
        ///
        /// ⚠️ ТООН МӨР, НЭР БИШ.  Сервер `str(b.authority_level, 8)`-аар
        /// таслана — «RECOMMEND» (9 тэмдэгт) тасарч «RECOMMEN» болно.
        /// </summary>
        [JsonPropertyName("authority_level")]
        public string AuthorityLevel { get; set; }
    }

    /// <summary>«Зураг клонлох» цонхны сүүлийн сонголт.  «Дахин үүсгэх»-ийг ЗОРИУД хадгалахгүй (устгадаг үйлдэл).</summary>
    public class CloneDrawingsPrefs
    {
        [JsonPropertyName("tags")]
        public bool Tags { get; set; } = true;

        [JsonPropertyName("dimensions")]
        public bool Dimensions { get; set; } = true;

        [JsonPropertyName("spots")]
        public bool Spots { get; set; } = true;

        [JsonPropertyName("details")]
        public bool Details { get; set; } = true;

        [JsonPropertyName("sheets")]
        public bool Sheets { get; set; } = true;

        [JsonPropertyName("rebar")]
        public bool Rebar { get; set; } = true;

        [JsonPropertyName("replace_mark")]
        public bool ReplaceMark { get; set; } = true;

        /// <summary>
        /// Загварын төрөл («Дам нуруу») → нэмж клонлох бусад төрлийн tag/хэмжээс («Ферм», «Багана»).
        /// Байхгүй бол зөвхөн загварын төрөл.
        /// </summary>
        [JsonPropertyName("annotation_kinds")]
        public Dictionary<string, List<string>> AnnotationKinds { get; set; } = new Dictionary<string, List<string>>();

        /// <summary>
        /// 2026-10-01: өгөгдмөлөөр СОНГОГДООГҮЙ ч хэрэглэгч сонгосон харагдацууд (UniqueId — файлд давтагдашгүй).
        /// Сүүлийнх ард, дээд тал 400 (<c>Core.RecentSet</c>).
        /// </summary>
        [JsonPropertyName("views_on")]
        public List<string> ViewsOn { get; set; } = new List<string>();

        /// <summary>Өгөгдмөлөөр СОНГОГДСОН ч хэрэглэгч хассан харагдацууд (UniqueId).</summary>
        [JsonPropertyName("views_off")]
        public List<string> ViewsOff { get; set; } = new List<string>();

        /// <summary>Загварын төрөл («Дам нуруу») → шүүлтэд унтраасан харагдацын төрөл («3D», «План» …).</summary>
        [JsonPropertyName("view_types_off")]
        public Dictionary<string, List<string>> ViewTypesOff { get; set; } = new Dictionary<string, List<string>>();
    }

    /// <summary>«Хуулж тавих» цонхны сүүлийн сонголт.  Хуучин settings.json-д байхгүй бол default.</summary>
    public class CopyToOtherPrefs
    {
        /// <summary>"move" | "rotate" | "mirror".</summary>
        [JsonPropertyName("mode")]
        public string Mode { get; set; } = "move";

        [JsonPropertyName("tags")]
        public bool Tags { get; set; } = true;

        [JsonPropertyName("room_tags")]
        public bool RoomTags { get; set; } = true;

        [JsonPropertyName("dimensions")]
        public bool Dimensions { get; set; } = true;

        [JsonPropertyName("details")]
        public bool Details { get; set; } = true;

        [JsonPropertyName("clone_views")]
        public bool CloneViews { get; set; } = true;

        [JsonPropertyName("clone_sheets")]
        public bool CloneSheets { get; set; } = true;
    }

    /// <summary>
    /// «Хуудас үүсгэх» командын сүүлд хэрэглэсэн тохиргоо. Параметрийн утга/дугаарт
    /// оруулах эсэх нь параметрийн нэрээр индексжинэ (загвар өөр байсан ч аюулгүй —
    /// байхгүй нэр нь зүгээр л сэргэхгүй). Хуучин settings.json-д талбар байхгүй
    /// бол default-оор ирнэ.
    /// </summary>
    public class SheetGenPrefs
    {
        [JsonPropertyName("separator")]
        public string Separator { get; set; } = "-";

        [JsonPropertyName("pad_width")]
        public int PadWidth { get; set; } = 3;

        [JsonPropertyName("title_block_name")]
        public string TitleBlockName { get; set; }

        [JsonPropertyName("name_template")]
        public string NameTemplate { get; set; } = "Хуудас <n>";

        /// <summary>Параметрийн нэр → сүүлд хэрэглэсэн утга.</summary>
        [JsonPropertyName("values")]
        public Dictionary<string, string> Values { get; set; } = new Dictionary<string, string>();

        /// <summary>Параметрийн нэр → дугаарт оруулах эсэх.</summary>
        [JsonPropertyName("include_in_number")]
        public Dictionary<string, bool> IncludeInNumber { get; set; } = new Dictionary<string, bool>();
    }

    /// <summary>
    /// `GET /api/learning/settings`-ийн хариунаас ЗӨВХӨН эрхийн түвшин.
    ///
    /// ⚠️ ЗОРИУД ХАГАС.  Хариу нь 10 талбартай `compliance` объект +
    /// цуглуулгын 10 талбар агуулдаг; add-in эдгээрийн үлдсэнийг
    /// `2-4`-ийн `BimEmitter` дотор өөрөө уншина.  Энд ЗӨВХӨН
    /// `addin_installs.authority_level`-д хэрэгтэй нэг тоог авна —
    /// илүү талбар нэмэх нь хоёр уншигч, хоёр гэрээ болно.
    /// </summary>
    public class LearningSettingsReply
    {
        [JsonPropertyName("compliance")]
        public ComplianceSettingsDto Compliance { get; set; }
    }

    /// <summary>`compliance` объектын ЗӨВХӨН эрхийн түвшин (v2 §80, 0230).</summary>
    public class ComplianceSettingsDto
    {
        /// <summary>0 OBSERVE · 1 EXPLAIN · 2 RECOMMEND · 3 PREVIEW · 4/5 EXECUTE.</summary>
        [JsonPropertyName("authority_level")]
        public int? AuthorityLevel { get; set; }
    }

    /// <summary>
    /// `POST /api/revit/health`-ийн хариу (v2 §74).
    ///
    /// ⚠️ ЭНЭ ХАРИУНЫ ЯМАР Ч ТАЛБАР АЖЛЫГ ЗОГСООХГҮЙ.  `UpgradeRequired` нь
    /// ЗӨВЛӨМЖ — самбарын толгойд нэг мөр текст болно, тэгээд л болоо.
    /// Сервер энэ route дээр ХЭЗЭЭ Ч 4xx буцаадаггүй (нийцгүй хувилбар нь
    /// «fail gracefully», алдаа БИШ).
    /// </summary>
    public class HealthReply
    {
        [JsonPropertyName("ok")]
        public bool Ok { get; set; }

        /// <summary>false = сервер энэ багцыг ТАНИХГҮЙ — албан ёсны бус build.</summary>
        [JsonPropertyName("recognised")]
        public bool Recognised { get; set; }

        [JsonPropertyName("revoked")]
        public bool Revoked { get; set; }

        [JsonPropertyName("latest_version")]
        public string LatestVersion { get; set; }

        [JsonPropertyName("upgrade_required")]
        public bool UpgradeRequired { get; set; }
    }
}
