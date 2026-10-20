using System;
using System.Collections.Generic;
using System.Text.Json.Serialization;
using RevitMcpAddin.Smart.Core;

namespace RevitMcpAddin.SmartPublish.Core
{
    /* ====================================================================== */
    /*  SMART PUBLISH — домэйн загвар (Revit-гүй, JSON-д хадгалагдана)         */
    /*                                                                        */
    /*  ⚠️ Хадгалагддаг enum бүрийн 0 утга нь АЮУЛГҮЙ `Unknown` — шинэ хувилбар */
    /*  утга нэмээд хуучин add-in уншихад (TolerantEnumConverter) буруу        */
    /*  утга руу чимээгүй унахгүй.                                            */
    /* ====================================================================== */

    public enum PublishFormat { Unknown = 0, Pdf, Dwg, Ifc }

    public enum PublishItemKind { Unknown = 0, Sheet, View, Model }

    /// <summary>Гаргах файл аль хэдийн байвал яах вэ.</summary>
    public enum OverwriteMode
    {
        Unknown = 0,
        /// <summary>Дарж бичнэ (түгжигдсэн бол алдаа — `OutputLocked`).</summary>
        Overwrite,
        /// <summary>Байгаа файлыг алгасна (тэр хэсгийг дахин гаргахгүй).</summary>
        Skip,
        /// <summary>Хуучныг хадгалж `_v2`, `_v3` дугаар нэмнэ.</summary>
        Version,
        /// <summary>Файл байвал preflight БЛОКЛОНО.</summary>
        Fail,
    }

    /// <summary>Нэрийн токен хоосон байвал яах вэ.</summary>
    public enum MissingTokenPolicy
    {
        Unknown = 0,
        /// <summary>Preflight БЛОКЛОНО (хоосон нэртэй/дутуу нэртэй файл гаргахгүй).</summary>
        Error,
        /// <summary>Хоосноор орлуулна (Info тэмдэглэл).</summary>
        Empty,
        /// <summary>`MissingText` (анхдагч «NA») оруулна.</summary>
        Placeholder,
    }

    /// <summary>Давхардсан файлын нэр.</summary>
    public enum DuplicateNamePolicy
    {
        Unknown = 0,
        /// <summary>Preflight БЛОКЛОНО — нэрлэлтийн алдаа байж болзошгүй.</summary>
        Block,
        /// <summary>Хоёр дахь нь `_2`, `_3` дагавартай болно.</summary>
        Suffix,
    }

    /// <summary>Preflight-ийн ноцтой байдал.  0 = Info (мэдэгдэхгүй утга ирвэл хамгийн аюулгүй нь).</summary>
    public enum PreflightSeverity { Info = 0, Warning, Blocking }

    public enum PlanAction
    {
        Unknown = 0,
        Export,
        /// <summary>`OverwriteMode.Skip` ба файл байгаа.</summary>
        SkipExisting,
        /// <summary>`OverwriteMode.Overwrite` ба файл байгаа — дарж бичнэ.</summary>
        Overwrite,
        /// <summary>`OverwriteMode.Version` — шинэ дугаартай нэрээр.</summary>
        Versioned,
    }

    /// <summary>Нэг файлын дүн.</summary>
    public enum ArtifactStatus
    {
        Pending = 0,
        Succeeded,
        Failed,
        Skipped,
        Cancelled,
    }

    public enum PublishFailureCode
    {
        Unknown = 0,
        /// <summary>Экспортоос ӨМНӨ preflight-аас гарсан (блоклосон).</summary>
        PreflightBlocked,
        NotPrintable,
        PlaceholderSheet,
        DestinationMissing,
        DestinationNotWritable,
        /// <summary>Файл өөр програмд нээлттэй / түгжигдсэн.</summary>
        OutputLocked,
        DwgSetupInvalid,
        FormatModuleUnavailable,
        /// <summary>Revit экспортыг `false` гэж буцаасан (зарим файл үүссэн байж болно).</summary>
        ExportRejected,
        ExportException,
        /// <summary>Экспорт «амжилттай» гэсэн ч хүлээгдсэн файл олдсонгүй.</summary>
        MissingArtifact,
        /// <summary>Файл байгаа ч хоосон (0 байт).</summary>
        EmptyArtifact,
        Cancelled,
        ModelNotEditable,
        /// <summary>Сонгосон хуудас/харагдац гаргалтын үед загварт олдсонгүй (устсан).</summary>
        ItemNotFound,
        /// <summary>
        /// Төлөвлөгөө гарснаас хойш зорилтот файл ҮҮССЭН (өөр хэрэглэгч/процесс/урт гаргалт) — чимээгүй дарж бичихгүй.
        /// Дахин оролдвол профайлын «байгаа файл» дүрэм (шинэ дугаар / алгасах / дарах) тэр файлд ШИНЭЭР хэрэглэгдэнэ.
        /// </summary>
        TargetChanged,
    }

    /* ---------------------------------------------------------------------- */
    /*  Профайл                                                                */
    /* ---------------------------------------------------------------------- */

    /// <summary>
    /// ДАХИН ХЭРЭГЛЭГДЭХ гаргалтын профайл.  «Client Issue», «Authority Submission» зэрэг нь
    /// ЗОРИУДААР хатуу бичигдсэн ажлын урсгал БИШ — `PublishStarters` нь эхний удаа л
    /// ЗАСАХ/УСТГАХ боломжтой жишээ профайл болгон суулгадаг.
    /// </summary>
    public sealed class PublishProfile
    {
        public string Id { get; set; } = SmartHash.NewId();
        public string Name { get; set; } = "Шинэ профайл";
        public string Description { get; set; }
        /// <summary>Засвар бүрд өсдөг — гаргалтын түүх ямар хувилбарын профайлаар гарсныг хадгална.</summary>
        public int Version { get; set; } = 1;
        /// <summary>Эхний суулгацын жишээ профайл (бүх талаар ердийн профайлтай адил).</summary>
        public bool Starter { get; set; }

        public List<PublishFormat> Formats { get; set; } = new List<PublishFormat> { PublishFormat.Pdf };
        public SelectionRule Selection { get; set; } = new SelectionRule();
        public NamingSettings Naming { get; set; } = new NamingSettings();
        public DestinationRule Destination { get; set; } = new DestinationRule();
        public PdfSettings Pdf { get; set; } = new PdfSettings();
        public DwgSettings Dwg { get; set; } = new DwgSettings();
        public IfcSettings Ifc { get; set; } = new IfcSettings();
        public RevisionRule Revision { get; set; } = new RevisionRule();
        /// <summary>Хуудасны эдгээр параметр хоосон байвал preflight блоклоно.</summary>
        public List<string> RequiredParameters { get; set; } = new List<string>();
        public OverwriteMode Overwrite { get; set; } = OverwriteMode.Version;
        /// <summary>Дүрмийн ноцтой байдлыг профайл тус бүрээр өөрчлөх (`ruleId` → severity).</summary>
        public Dictionary<string, PreflightSeverity> SeverityOverrides { get; set; } = new Dictionary<string, PreflightSeverity>();

        public PublishProfile Clone()
        {
            return SmartJson.Deserialize<PublishProfile>(SmartJson.Serialize(this));
        }
    }

    /// <summary>
    /// Анхдагч сонголтын дүрэм: хуудас бүр бүх нөхцөлийг (AND) хангавал тэмдэглэгдэнэ.
    /// Тэмдэглэгээг хэрэглэгч гараар өөрчилж болно — энэ нь зөвхөн ЭХНИЙ сонголт.
    /// </summary>
    public sealed class SelectionRule
    {
        public List<ItemCondition> Conditions { get; set; } = new List<ItemCondition>();
        public bool IncludePlaceholders { get; set; }
        /// <summary>Хуудсаас гадна харагдац (план, 3D...) жагсаалтад оруулах.</summary>
        public bool IncludeViews { get; set; }
    }

    public enum ConditionOp { Unknown = 0, Equals, NotEquals, Contains, StartsWith, EndsWith, NotEmpty, IsEmpty }

    public sealed class ItemCondition
    {
        /// <summary>`SheetNumber` | `SheetName` | `Revision` | `Param:&lt;нэр&gt;`.</summary>
        public string Field { get; set; }
        public ConditionOp Op { get; set; }
        public string Value { get; set; }
    }

    public sealed class NamingSettings
    {
        /// <summary>Хуудас/харагдац тутмын файлын нэр.  `[...]` = токен хоосон бол бүлэг алгасагдана.</summary>
        public string SheetTemplate { get; set; } = "{ProjectNumber}_{SheetNumber}_{SheetName}[_{Revision}]";
        /// <summary>PDF-ийг НЭГ файлд нэгтгэх үеийн нэр.</summary>
        public string CombinedTemplate { get; set; } = "{ProjectNumber}_{Date:yyyyMMdd}_Set";
        /// <summary>IFC (загварын түвшин)-ийн нэр — хуудасны токен БАЙХГҮЙ.</summary>
        public string ModelTemplate { get; set; } = "{ProjectNumber}_{Date:yyyyMMdd}_Model";
        public MissingTokenPolicy OnMissing { get; set; } = MissingTokenPolicy.Error;
        public string MissingText { get; set; } = "NA";
        /// <summary>Хориотой тэмдэгтийг орлуулах тэмдэгт.</summary>
        public string InvalidCharReplacement { get; set; } = "_";
        public int MaxLength { get; set; } = 120;
        public DuplicateNamePolicy Duplicates { get; set; } = DuplicateNamePolicy.Block;
    }

    public sealed class DestinationRule
    {
        /// <summary>Үндсэн хавтас (хоосон бол preflight блоклоно).</summary>
        public string BaseFolder { get; set; }
        /// <summary>Дэд хавтас (нэршлийн токен ашиглана): `{Format}`, `{Date:yyyy-MM-dd}`, `{ProjectNumber}`.</summary>
        public string SubfolderTemplate { get; set; } = "{Format}";
        public bool CreateMissing { get; set; } = true;
    }

    /// <summary>
    /// PDF-ийн тохиргоо.  Enum-ууд нь Revit-ийн enum-ын НЭРЭЭР (мөр) хадгалагдана
    /// (`ExportPaperFormat`, `PageOrientationType`...) — хувилбар хооронд enum өөрчлөгдөхөд
    /// профайлын файл эвдрэхгүй; танигдахгүй нэр → Revit-ийн анхдагч + preflight сануулга.
    /// </summary>
    public sealed class PdfSettings
    {
        /// <summary>true = бүх сонгосон хуудсыг НЭГ PDF-д (хуудас тутмын алдаа тусгаарлалт алдагдана).</summary>
        public bool Combine { get; set; }
        /// <summary>`Default` = хуудасны хэмжээгээр (Use Sheet Size).</summary>
        public string PaperFormat { get; set; } = "Default";
        public string Orientation { get; set; } = "Auto";
        public string Placement { get; set; } = "Center";
        public string ZoomType { get; set; } = "FitToPage";
        public int ZoomPercent { get; set; } = 100;
        public string ColorDepth { get; set; } = "Color";
        /// <summary>`PDFExportQualityType` (DPI300 г.м.).  Хоосон = Revit-ийн анхдагч.</summary>
        public string ExportQuality { get; set; }
        public string RasterQuality { get; set; } = "High";
        public bool AlwaysUseRaster { get; set; }
        public bool StopOnError { get; set; }
        public bool HideScopeBoxes { get; set; } = true;
        public bool HideCropBoundaries { get; set; } = true;
        public bool HideReferencePlanes { get; set; } = true;
        public bool HideUnreferencedViewTags { get; set; } = true;
        public bool ViewLinksInBlue { get; set; }
        public bool ReplaceHalftoneWithThinLines { get; set; }
        public bool MaskCoincidentLines { get; set; }
    }

    public sealed class DwgSettings
    {
        /// <summary>Загвар доторх ӨМНӨ ТОДОРХОЙЛОГДСОН DWG экспортын тохиргооны нэр.  Хоосон = Revit-ийн анхдагч (санал болгохгүй).</summary>
        public string SetupName { get; set; }
        /// <summary>Бүх харагдацыг нэг файлд (XRef-ээр).</summary>
        public bool MergedViews { get; set; }
    }

    public sealed class IfcSettings
    {
        /// <summary>`IFCVersion` enum-ын нэр: `IFC2x3`, `IFC4`, `IFC4RV`...</summary>
        public string Version { get; set; } = "IFC4";
        public bool ExportBaseQuantities { get; set; }
        public int SpaceBoundaryLevel { get; set; } = 1;
        public bool SplitWallsAndColumns { get; set; }
        /// <summary>IFC-ийн агуулгыг тодорхойлох (харагдах байдлаар шүүх) 3D харагдацын нэр.  Хоосон = шүүхгүй.</summary>
        public string FilterViewName { get; set; }
        /// <summary>`IFCExportOptions.AddOption(name, value)`-д дамжих нэмэлт тохиргоо.</summary>
        public Dictionary<string, string> ExtraOptions { get; set; } = new Dictionary<string, string>();
    }

    public sealed class RevisionRule
    {
        /// <summary>true = хуудас бүр хамгийн багадаа нэг ревизтэй байх ёстой.</summary>
        public bool Required { get; set; }
    }

    /* ---------------------------------------------------------------------- */
    /*  Revit-ээс ХУУЛСАН элемент (detached)                                   */
    /* ---------------------------------------------------------------------- */

    /// <summary>Гаргах нэгж: хуудас, харагдац, эсвэл (IFC-д) загвар.</summary>
    public sealed class PublishItem
    {
        /// <summary>`Element.UniqueId` — session хооронд тогтвортой.</summary>
        public string Id { get; set; }
        public PublishItemKind Kind { get; set; }
        /// <summary>Хуудасны дугаар; харагдацын хувьд харагдацын нэр.</summary>
        public string Number { get; set; }
        public string Name { get; set; }
        public string RevisionNumber { get; set; }
        public string RevisionDescription { get; set; }
        public string RevisionDate { get; set; }
        public string ViewType { get; set; }
        public bool CanBePrinted { get; set; } = true;
        public bool IsPlaceholder { get; set; }
        /// <summary>Параметрийн нэр → харагдах утга (хоосон биш ЗӨВХӨН).</summary>
        public Dictionary<string, string> Values { get; set; } = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

        /// <summary>Энэ session-д л (ElementId.Value).  ХАДГАЛАГДАХГҮЙ.</summary>
        [JsonIgnore]
        public long ElementIdValue { get; set; }

        public string Label
        {
            get { return (Number ?? "") + (string.IsNullOrEmpty(Name) ? "" : " — " + Name); }
        }
    }

    /// <summary>Нэршил/preflight-д хэрэгтэй төслийн мэдээлэл (Project Information) ба цаг.</summary>
    public sealed class PublishContext
    {
        public string DocumentTitle { get; set; }
        public string ProjectName { get; set; }
        public string ProjectNumber { get; set; }
        public string ProjectClient { get; set; }
        public string ProjectAddress { get; set; }
        public string ProjectStatus { get; set; }
        /// <summary>Project Information-ий параметрийн нэр → утга.</summary>
        public Dictionary<string, string> ProjectValues { get; set; } = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        public DateTime Now { get; set; } = DateTime.Now;
    }

    /* ---------------------------------------------------------------------- */
    /*  Төлөвлөгөө                                                             */
    /* ---------------------------------------------------------------------- */

    /// <summary>Нэг гарах файл (нэг PDF/DWG/IFC).</summary>
    public sealed class PlannedArtifact
    {
        /// <summary>Хуудас/харагдацын id; нэгтгэсэн PDF, IFC-д `"*"`.</summary>
        public string ItemId { get; set; }
        public PublishItemKind ItemKind { get; set; }
        public PublishFormat Format { get; set; }
        public string ItemLabel { get; set; }
        /// <summary>Өргөтгөлгүй, цэвэрлэгдсэн, давхардал шийдэгдсэн нэр.</summary>
        public string FileBaseName { get; set; }
        public string Folder { get; set; }
        public string Extension { get; set; }
        public PlanAction Action { get; set; }
        /// <summary>Төлөвлөх үед зорилтот файл байсан эсэх.</summary>
        public bool TargetExists { get; set; }
        /// <summary>Нэгтгэсэн PDF-ийн гишүүд (id-ууд, дарааллаар).</summary>
        public List<string> MemberIds { get; set; } = new List<string>();
        public List<string> Notes { get; set; } = new List<string>();

        public string FileName { get { return FileBaseName + Extension; } }
        public string FullPath
        {
            get { return string.IsNullOrEmpty(Folder) ? FileName : System.IO.Path.Combine(Folder, FileName); }
        }
    }

    public sealed class PublishPlan
    {
        public List<PlannedArtifact> Artifacts { get; set; } = new List<PlannedArtifact>();
        /// <summary>Нэршлийн үед гарсан асуудал (preflight-д ашиглана).</summary>
        public List<NameIssue> NameIssues { get; set; } = new List<NameIssue>();
    }

    public enum NameIssueKind
    {
        Unknown = 0,
        /// <summary>Токен хоосон (policy = Error).</summary>
        MissingToken,
        /// <summary>Загварын синтакс алдаа / танигдаагүй токен.</summary>
        TemplateError,
        /// <summary>Нэр цэвэрлэсний дараа хоосон.</summary>
        EmptyName,
        /// <summary>Хориотой тэмдэгт солигдсон.</summary>
        CharsReplaced,
        /// <summary>Хэт урт тул тайрсан.</summary>
        Truncated,
        /// <summary>Давхардсан нэр (policy = Block).</summary>
        Duplicate,
        /// <summary>Давхардсан нэр дагавараар шийдэгдсэн.</summary>
        DuplicateResolved,
        /// <summary>Замын нийт урт хэт урт.</summary>
        PathTooLong,
    }

    public sealed class NameIssue
    {
        public NameIssueKind Kind { get; set; }
        public string ItemId { get; set; }
        public PublishFormat Format { get; set; }
        public string Detail { get; set; }
    }

    /* ---------------------------------------------------------------------- */
    /*  Гүйцэтгэл ба түүх                                                      */
    /* ---------------------------------------------------------------------- */

    public sealed class PublishArtifact
    {
        public string ItemId { get; set; }
        public string ItemLabel { get; set; }
        public PublishFormat Format { get; set; }
        public ArtifactStatus Status { get; set; }
        /// <summary>Локал түүхэд л хадгалагдана (лог руу ОРООГҮЙ).</summary>
        public string Path { get; set; }
        public long SizeBytes { get; set; }
        public DateTime? CreatedUtc { get; set; }
        /// <summary>Файлын БАЙДАЛ (байгаа, 0-ээс их) шалгагдсан.  Агуулгын зөв байдлыг БАТАЛДАГГҮЙ.</summary>
        public bool Validated { get; set; }
        public long DurationMs { get; set; }
        public List<string> Notes { get; set; } = new List<string>();
        /// <summary>Нэгтгэсэн PDF-д ЯГ ОРСОН хуудсууд (загварт олдоогүй нь хасагдсан).</summary>
        public List<string> MemberIds { get; set; } = new List<string>();
        /// <summary>
        /// Бүтэлгүйтсэн артифактын хувьд: ЭНЭ гүйлт ӨӨРӨӨ үүсгэсэн/шинэчилсэн (бүрэн бус байж болзошгүй) файлын зам.  Дахин оролдлого ЗӨВХӨН
        /// энэ замыг «байхгүй» мэт үзэж дарж бичнэ.  ⚠️ Бүтэлгүйтсэн артифактын `Path` нь ЗӨВХӨН төлөвлөсөн зам — тэнд өөр хүний/хуучин файл
        /// байж болох тул дарж бичихэд ҮҮГЭЭР ТОГТООЖ БОЛОХГҮЙ (`TargetChanged`-ийн өөр хүний файл г.м.).  null = энэ гүйлт файл үлдээгээгүй.
        /// </summary>
        public string PartialPath { get; set; }
    }

    public sealed class PublishFailure
    {
        public string ItemId { get; set; }
        public string ItemLabel { get; set; }
        public PublishFormat Format { get; set; }
        public PublishFailureCode Code { get; set; }
        public string Message { get; set; }
        /// <summary>Алдааны төрөл (ex.GetType().Name) — мессежид зам/нэр орсон байж болох тул тусад нь.</summary>
        public string ExceptionType { get; set; }
        public bool Retryable { get; set; }
    }

    public sealed class PublishRun
    {
        public string Id { get; set; } = SmartHash.NewId();
        public string DocKey { get; set; }
        public string DocTitle { get; set; }
        public string ProfileId { get; set; }
        public string ProfileName { get; set; }
        public int ProfileVersion { get; set; }
        public DateTime StartedUtc { get; set; }
        public DateTime? EndedUtc { get; set; }
        public RunStatus Status { get; set; }
        public List<PublishFormat> Formats { get; set; } = new List<PublishFormat>();
        public string Destination { get; set; }
        /// <summary>Сонгосон хуудсуудын id (дарааллаар).</summary>
        public List<string> ItemIds { get; set; } = new List<string>();
        public List<PublishArtifact> Artifacts { get; set; } = new List<PublishArtifact>();
        public List<PublishFailure> Failures { get; set; } = new List<PublishFailure>();
        public long DurationMs { get; set; }
        /// <summary>Дахин оролдлогын эх гүйлт (анхных нь түүх ХӨНДӨГДӨХГҮЙ).</summary>
        public string ParentRunId { get; set; }
        public int PreflightWarnings { get; set; }
        /// <summary>Хэдэн файл төлөвлөгдсөн (дүгнэлтэд).</summary>
        public int PlannedCount { get; set; }
        /// <summary>Загварын өөрчлөлтийн дугаар (Change Impact-тэй холбох) — гаргалтын ЭХЭНД.</summary>
        public long? ChangeSeqAtStart { get; set; }
        public string DocVersionGuidAtStart { get; set; }
        /// <summary>
        /// Төлөвлөгөөг үүсгэхэд ашигласан «одоо» (`{Date}` токен) — UTC.  Дахин оролдлого ТЭР ЦАГААР дахин төлөвлөнө (өөр өдөр/сессид
        /// «{Date}» өөр гарч нэр өөрчлөгдөхөөс сэргийлнэ).  null = хуучин түүх.
        /// </summary>
        public DateTime? PlanNowUtc { get; set; }

        /// <summary>
        /// ЗӨВХӨН энэ session-д (диск рүү бичигдэхгүй): түүх/checkpoint хадгалж чадаагүй гэх мэт хэрэглэгчид ИЛ хэлэх анхааруулга.
        /// Хадгалагдаагүй бол «дахин гаргах хэрэгтэй» тэмдэг (checkpoint) ахисангүй гэсэн үг.
        /// </summary>
        [System.Text.Json.Serialization.JsonIgnore]
        public List<string> PersistWarnings { get; set; } = new List<string>();
    }

    /// <summary>Файл (баримт) тутмын түүх.</summary>
    public sealed class PublishHistory
    {
        public List<PublishRun> Runs { get; set; } = new List<PublishRun>();
    }

    /// <summary>
    /// Хуудас тутмын «хамгийн сүүлд АМЖИЛТТАЙ гаргасан» тэмдэг.  Цуцлагдсан/бүтэлгүйтсэн
    /// гаргалт тэмдгийг ӨГСӨХГҮЙ — тиймээс хүлээгдэж буй өөрчлөлт алдагдахгүй.
    /// </summary>
    public sealed class PublishCheckpoints
    {
        /// <summary>profileId → (itemId → тэмдэг).</summary>
        public Dictionary<string, Dictionary<string, SheetCheckpoint>> Profiles { get; set; }
            = new Dictionary<string, Dictionary<string, SheetCheckpoint>>();
    }

    /// <summary>Нэг форматын (PDF/DWG/IFC) сүүлийн АМЖИЛТТАЙ гаргалтын тэмдэг.</summary>
    public sealed class FormatStamp
    {
        public string RunId { get; set; }
        public DateTime Utc { get; set; }
        public long ChangeSeq { get; set; }
        public string DocVersionGuid { get; set; }
    }

    public sealed class SheetCheckpoint
    {
        public string RunId { get; set; }
        public DateTime PublishedUtc { get; set; }
        /// <summary>
        /// Гаргалтын ЭХЛЭХЭД байсан өөрчлөлтийн дугаар (Change Impact capture).  ⚠️ Профайлын БҮХ форматын ХАМГИЙН ЭРТ тэмдэг
        /// (min): хуудасны PDF шинэ, DWG хуучин бол хуучнаараа — хойшхи өөрчлөлт DWG-д ороогүй байж болох тул (аюулгүй тал).
        /// </summary>
        public long ChangeSeq { get; set; }
        public string DocVersionGuid { get; set; }
        public string RevisionNumber { get; set; }
        /// <summary>
        /// Формат тутмын сүүлийн АМЖИЛТТАЙ гаргалтын тэмдэг (түлхүүр = формат, жижиг үсгээр).  null = хуучин checkpoint — тэр үеийн БҮХ формат
        /// нэг тэмдэгтэй гэж үзнэ.
        /// </summary>
        public Dictionary<string, FormatStamp> Formats { get; set; }
        /// <summary>Профайлын зарим формат (жишээ нь DWG) хараахан АМЖИЛТТАЙ гараагүй — хуудас «бүрэн гараагүй», «хараахан гаргаагүй»-тэй адил.</summary>
        public bool Partial { get; set; }
    }
}
