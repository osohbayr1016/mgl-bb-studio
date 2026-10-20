using System;
using System.Collections.Generic;
using System.Text.Json.Serialization;

namespace RevitMcpAddin.Intelligence.Contracts
{
    /* ================================================================== */
    /*  R1 — «MGL AI ажилтан ЮУГ харж байгааг яг мэднэ» гэрээ              */
    /*                                                                    */
    /*  ⚠️ Энэ файлд Autodesk.Revit.* НЭГ Ч удаа гарахгүй.  Revit-ийн      */
    /*  амьд объект (`Element`, `Document`, `XYZ`) ЭНД ХЭЗЭЭ Ч орохгүй —   */
    /*  `RevitContextExtractor` (Revit/) нь Revit-ийн API-ийн контекст     */
    /*  дотор эдгээр ХӨДЛӨШГҮЙ DTO-г үүсгээд, тэр контекстоос ГАРНА.       */
    /*  Арын thread, AI, UI бүгд ЗӨВХӨН DTO-той ажиллана (§15).           */
    /* ================================================================== */

    /// <summary>Хөдлөшгүй агшин зураг — баримт · идэвхтэй харагдац · сонголт.</summary>
    public sealed class RevitContextSnapshot
    {
        [JsonPropertyName("schema_version")] public int SchemaVersion { get; set; } = Schema.Version;
        [JsonPropertyName("document")] public RevitDocumentContext Document { get; set; }
        [JsonPropertyName("active_view")] public RevitViewContext ActiveView { get; set; }
        /// <summary>⚠️ ТАСЛАГДСАН жагсаалт — `SelectionTotal`-аас БАГА байж болно.</summary>
        [JsonPropertyName("selection")] public List<RevitElementSummary> Selection { get; set; } = new List<RevitElementSummary>();
        /// <summary>Сонгосон элементийн ЖИНХЭНЭ тоо — таслагдсаныг нуухгүй.</summary>
        [JsonPropertyName("selection_total")] public int SelectionTotal { get; set; }
        /// <summary>Хураангуйд ОРООГҮЙ үлдсэн элементүүд — зөвхөн id + категори (хямд).</summary>
        [JsonPropertyName("selection_rest")] public List<RevitElementRef> SelectionRest { get; set; } = new List<RevitElementRef>();
        [JsonPropertyName("project_link")] public RevitProjectLink ProjectLink { get; set; }
        /// <summary>`Document.GetWarnings().Count` — Revit-ийн өөрийн анхааруулга.</summary>
        [JsonPropertyName("warning_count")] public int? WarningCount { get; set; }
        [JsonPropertyName("transaction_open")] public bool TransactionOpen { get; set; }
        /// <summary>Хэрэв Revit-д хүрч чадаагүй бол — яагаад.</summary>
        [JsonPropertyName("state")] public RevitErrorState State { get; set; } = RevitErrorState.OK;
        [JsonPropertyName("captured_at")] public string CapturedAt { get; set; }
        /// <summary>Агшин зураг авахад Revit-ийн үндсэн thread дээр зарцуулсан мс (§54).</summary>
        [JsonPropertyName("capture_ms")] public double CaptureMs { get; set; }
    }

    /// <summary>
    /// Баримтын контекст.  ⚠️ БҮТЭН ЗАМ ОРОХГҮЙ — `PathClass` л явна (§11).
    /// `DocKey` нь `RevitTools.DocUid(doc)`-той ЯГ ИЖИЛ мөр (Track 2-ийн
    /// `ChangeTracker`, `BimEmitter`, сервер бүгд түүгээр түлхүүрлэдэг —
    /// хоёр дахь таних тэмдэг ЗОХИОХГҮЙ).
    /// </summary>
    public sealed class RevitDocumentContext
    {
        [JsonPropertyName("doc_key")] public string DocKey { get; set; }
        /// <summary>project_info | path — `DocKey` хаанаас гарсан.</summary>
        [JsonPropertyName("doc_key_source")] public string DocKeySource { get; set; }
        [JsonPropertyName("title")] public string Title { get; set; }
        [JsonPropertyName("file_name")] public string FileName { get; set; }
        [JsonPropertyName("path_class")] public DocumentPathClass PathClass { get; set; }
        [JsonPropertyName("revit_version")] public string RevitVersion { get; set; }
        [JsonPropertyName("is_workshared")] public bool IsWorkshared { get; set; }
        [JsonPropertyName("worksharing")] public DocumentWorksharing Worksharing { get; set; }
        [JsonPropertyName("is_family")] public bool IsFamily { get; set; }
        [JsonPropertyName("is_linked")] public bool IsLinked { get; set; }
        [JsonPropertyName("is_read_only")] public bool IsReadOnly { get; set; }
        [JsonPropertyName("project_name")] public string ProjectName { get; set; }
        [JsonPropertyName("project_number")] public string ProjectNumber { get; set; }
        [JsonPropertyName("active_phase")] public string ActivePhase { get; set; }
        [JsonPropertyName("active_design_option")] public string ActiveDesignOption { get; set; }
        /// <summary>Идэвхтэй харагдацаас гаргасан давхар (план/огтлолд); байхгүй бол null.</summary>
        [JsonPropertyName("active_level")] public string ActiveLevel { get; set; }
        /// <summary>Холбосон (RVT link) баримтын тоо — 0 бол линкгүй.</summary>
        [JsonPropertyName("link_count")] public int LinkCount { get; set; }
        /// <summary>`ProjectInformation.Name` нь MGL-AI-TEST тэмдэгтэй — Session R-ийн СИНТЕТИК тест баримт (NON-PRODUCTION).</summary>
        [JsonPropertyName("is_test_fixture")] public bool IsTestFixture { get; set; }
    }

    public enum DocumentPathClass { UNSAVED, LOCAL_FILE, SERVER, CLOUD, UNKNOWN }
    public enum DocumentWorksharing { NOT_WORKSHARED, CENTRAL, LOCAL, DETACHED, UNKNOWN }

    /// <summary>Идэвхтэй харагдац (§12) — геометргүй, зөвхөн таних мэдээлэл.</summary>
    public sealed class RevitViewContext
    {
        [JsonPropertyName("element_id")] public long ElementId { get; set; }
        [JsonPropertyName("unique_id")] public string UniqueId { get; set; }
        /// <summary>Revit `ViewType` нэр — ОРЧУУЛАХГҮЙ (FloorPlan, Section, ThreeD …).</summary>
        [JsonPropertyName("view_type")] public string ViewType { get; set; }
        [JsonPropertyName("name")] public string Name { get; set; }
        [JsonPropertyName("level")] public string Level { get; set; }
        [JsonPropertyName("phase")] public string Phase { get; set; }
        [JsonPropertyName("discipline")] public string Discipline { get; set; }
        [JsonPropertyName("detail_level")] public string DetailLevel { get; set; }
        [JsonPropertyName("scale")] public int? Scale { get; set; }
        [JsonPropertyName("template_name")] public string TemplateName { get; set; }
        [JsonPropertyName("is_cropped")] public bool? IsCropped { get; set; }
        [JsonPropertyName("is_template")] public bool IsTemplate { get; set; }
        /// <summary>Хуудасны харагдац бол тэр хуудасны дугаар.</summary>
        [JsonPropertyName("sheet_number")] public string SheetNumber { get; set; }
    }

    /* ================================================================== */
    /*  ЭЛЕМЕНТИЙН ХУРААНГУЙ (§13, R-16)                                   */
    /* ================================================================== */

    /// <summary>
    /// Нэг элементийн ЗОРИУЛАЛТТАЙ хураангуй.  Бүх параметрийг ХЭЗЭЭ Ч
    /// цувруулахгүй — `Params` нь категорийн цагаан жагсаалтаас
    /// (`ElementParamAllowlist`) сонгогдсон хэдхэн мөр.
    /// </summary>
    public sealed class RevitElementSummary
    {
        [JsonPropertyName("element_id")] public long ElementId { get; set; }
        [JsonPropertyName("unique_id")] public string UniqueId { get; set; }
        /// <summary>Revit-ийн ЭХ категорийн нэр (англи) — орчуулахгүй, Track 2-ийн дүрэм.</summary>
        [JsonPropertyName("category")] public string Category { get; set; }
        [JsonPropertyName("kind")] public SceneNodeKind Kind { get; set; }
        [JsonPropertyName("family")] public string Family { get; set; }
        [JsonPropertyName("type")] public string Type { get; set; }
        [JsonPropertyName("name")] public string Name { get; set; }
        [JsonPropertyName("level")] public string Level { get; set; }
        [JsonPropertyName("level_id")] public long? LevelId { get; set; }
        [JsonPropertyName("phase_created")] public string PhaseCreated { get; set; }
        [JsonPropertyName("phase_demolished")] public string PhaseDemolished { get; set; }
        [JsonPropertyName("host")] public RevitElementRef Host { get; set; }
        [JsonPropertyName("location")] public RevitLocationSummary Location { get; set; }
        [JsonPropertyName("bounding_box")] public RevitBoundingBoxMm BoundingBox { get; set; }
        /// <summary>Нэгжээрээ ТОДОРХОЙ хэмжээс — мм / м² / м³ / град (§14).</summary>
        [JsonPropertyName("dimensions")] public List<Measure> Dimensions { get; set; } = new List<Measure>();
        [JsonPropertyName("params")] public List<RevitParamValue> Params { get; set; } = new List<RevitParamValue>();
        [JsonPropertyName("materials")] public List<string> Materials { get; set; } = new List<string>();
        [JsonPropertyName("rooms")] public RevitRoomRelations Rooms { get; set; }
        [JsonPropertyName("worksharing")] public RevitWorksharingState Worksharing { get; set; }
        /// <summary>HOST_DOCUMENT | LINKED_DOCUMENT (§52).  Линк дээр БИЧИХ ХЭЗЭЭ Ч БОЛОХГҮЙ.</summary>
        [JsonPropertyName("scope")] public ElementScope Scope { get; set; } = ElementScope.HOST_DOCUMENT;
        [JsonPropertyName("link_instance_id")] public long? LinkInstanceId { get; set; }
        [JsonPropertyName("is_type")] public bool IsType { get; set; }
        [JsonPropertyName("is_pinned")] public bool IsPinned { get; set; }
        /// <summary>Хураангуй бүрэн бус бол — яагаад (`REVIT_API_ERROR:…`, `budget`).</summary>
        [JsonPropertyName("warnings")] public List<string> Warnings { get; set; } = new List<string>();
    }

    public enum ElementScope { HOST_DOCUMENT, LINKED_DOCUMENT }

    public sealed class RevitElementRef
    {
        [JsonPropertyName("element_id")] public long ElementId { get; set; }
        [JsonPropertyName("unique_id")] public string UniqueId { get; set; }
        [JsonPropertyName("category")] public string Category { get; set; }
        [JsonPropertyName("name")] public string Name { get; set; }
    }

    /// <summary>Байршлын хураангуй — координат нь ММ-ЭЭР, дотоод фут БИШ.</summary>
    public sealed class RevitLocationSummary
    {
        [JsonPropertyName("kind")] public LocationKind Kind { get; set; }
        [JsonPropertyName("point_mm")] public double[] PointMm { get; set; }
        [JsonPropertyName("start_mm")] public double[] StartMm { get; set; }
        [JsonPropertyName("end_mm")] public double[] EndMm { get; set; }
        /// <summary>Шугаман байршилд — Х тэнхлэгээс градус.</summary>
        [JsonPropertyName("direction_deg")] public double? DirectionDeg { get; set; }
        [JsonPropertyName("is_curved")] public bool? IsCurved { get; set; }
    }

    public enum LocationKind { NONE, POINT, LINE }

    public sealed class RevitBoundingBoxMm
    {
        [JsonPropertyName("min_mm")] public double[] MinMm { get; set; }
        [JsonPropertyName("max_mm")] public double[] MaxMm { get; set; }
        [JsonPropertyName("size_mm")] public double[] SizeMm { get; set; }
    }

    /// <summary>
    /// Нэг хэмжигдэхүүн — `Units.cs`-ийн `Quantity`-ийн ГЭРЭЭНИЙ хэлбэр (R-3).
    /// `Source`/`SpecId` нь provenance: `UNTYPED_PARAM` утгыг ХЭЗЭЭ Ч хөрвүүлж
    /// болохгүй (`Quantity.ConversionAllowed`), тиймээс тэр нь энд ирэхдээ
    /// нэгжээ `NONE` гэж ил зарлана.
    /// </summary>
    public sealed class Measure
    {
        [JsonPropertyName("name")] public string Name { get; set; }
        [JsonPropertyName("value")] public double Value { get; set; }
        /// <summary>MM | M | M2 | M3 | DEG | PCT | COUNT | KG_M3 | H | NONE — `Units.cs`-ийн толь.</summary>
        [JsonPropertyName("unit")] public string Unit { get; set; }
        [JsonPropertyName("source")] public MeasureSource Source { get; set; }
        [JsonPropertyName("spec_id")] public string SpecId { get; set; }
        [JsonPropertyName("missing")] public bool Missing { get; set; }
    }

    /// <summary>`QuantitySource`-ийн НЭРЛЭСЭН хос (тоон утга утсаар явахгүй).</summary>
    public enum MeasureSource { BUILTIN_GEOMETRY, TYPED_PARAM, UNTYPED_PARAM, COMPUTED }

    public sealed class RevitParamValue
    {
        [JsonPropertyName("name")] public string Name { get; set; }
        [JsonPropertyName("value")] public string Value { get; set; }
        /// <summary>Тоон бол хөрвүүлсэн хэмжээс; текст бол null.</summary>
        [JsonPropertyName("measure")] public Measure Measure { get; set; }
        [JsonPropertyName("is_type_param")] public bool IsTypeParam { get; set; }
        [JsonPropertyName("is_read_only")] public bool IsReadOnly { get; set; }
    }

    /// <summary>
    /// Өрөөний харилцаа.  ⚠️ `FromRoom`/`ToRoom` нь Revit-ийн ӨӨРИЙН
    /// (`FamilyInstance.FromRoom`) — эрх бүхий; `BoundsRooms` нь өрөөний
    /// хилийн сегментээс — эрх бүхий; `InRoomApprox` нь bbox төвөөр
    /// ОЙРОЛЦООЛСОН — ЭРХГҮЙ (R-5).  Гурвыг нэг талбарт нийлүүлэхгүй.
    /// </summary>
    public sealed class RevitRoomRelations
    {
        [JsonPropertyName("from_room")] public RevitElementRef FromRoom { get; set; }
        [JsonPropertyName("to_room")] public RevitElementRef ToRoom { get; set; }
        [JsonPropertyName("bounds_rooms")] public List<RevitElementRef> BoundsRooms { get; set; } = new List<RevitElementRef>();
        [JsonPropertyName("in_room")] public RevitElementRef InRoom { get; set; }
        [JsonPropertyName("in_room_approx")] public RevitElementRef InRoomApprox { get; set; }
    }

    /// <summary>
    /// Worksharing төлөв (R-17).  ⚠️ Хүний нэр ЯВАХГҮЙ — зөвхөн төлөв.
    /// `Editable == null` = мэдэхгүй (`REVIT_API_ERROR`), `false` БИШ.
    /// </summary>
    public sealed class RevitWorksharingState
    {
        [JsonPropertyName("editable")] public bool? Editable { get; set; }
        [JsonPropertyName("ownership")] public ElementOwnership Ownership { get; set; } = ElementOwnership.UNKNOWN;
        [JsonPropertyName("pinned")] public bool Pinned { get; set; }
        [JsonPropertyName("read_only_document")] public bool ReadOnlyDocument { get; set; }
        [JsonPropertyName("linked")] public bool Linked { get; set; }
        [JsonPropertyName("workset")] public string Workset { get; set; }
    }

    public enum ElementOwnership { NOT_WORKSHARED, OWNED_BY_CURRENT_USER, OWNED_BY_OTHER_USER, NOT_OWNED, UNKNOWN }

    /* ================================================================== */
    /*  ERP ТӨСЛИЙН ХОЛБООС (§27–28, R-10)                                 */
    /* ================================================================== */

    /// <summary>
    /// Баримт ↔ ERP төсөл.  ⚠️ `CONFIRMED` нь ЗӨВХӨН хэрэглэгчийн ил
    /// баталгаажуулалт эсвэл хадгалсан баталгаажсан холбоосоос гарна.
    /// Файлын нэрийн таарц ХЭЗЭЭ Ч `CONFIRMED` болохгүй — `SUGGESTED` л.
    /// </summary>
    public sealed class RevitProjectLink
    {
        [JsonPropertyName("state")] public ProjectLinkState State { get; set; } = ProjectLinkState.UNKNOWN;
        [JsonPropertyName("doc_key")] public string DocKey { get; set; }
        [JsonPropertyName("project_id")] public int? ProjectId { get; set; }
        [JsonPropertyName("project_name")] public string ProjectName { get; set; }
        /// <summary>SETTINGS | SERVER_HANDSHAKE | USER_CONFIRMED — эх сурвалж.</summary>
        [JsonPropertyName("confirmed_by")] public string ConfirmedBy { get; set; }
        [JsonPropertyName("confirmed_at")] public string ConfirmedAt { get; set; }
        [JsonPropertyName("suggestions")] public List<ProjectLinkSuggestion> Suggestions { get; set; } = new List<ProjectLinkSuggestion>();
    }

    public enum ProjectLinkState { CONFIRMED, SUGGESTED, UNLINKED, ERP_OFFLINE, UNKNOWN }

    public sealed class ProjectLinkSuggestion
    {
        [JsonPropertyName("project_id")] public int ProjectId { get; set; }
        [JsonPropertyName("project_name")] public string ProjectName { get; set; }
        /// <summary>0..1 — зөвхөн ЭРЭМБЭЛЭХЭД; босго давсан ч баталгаа БИШ.</summary>
        [JsonPropertyName("score")] public double Score { get; set; }
        [JsonPropertyName("reason")] public string Reason { get; set; }
    }

    /* ================================================================== */
    /*  АЛДААНЫ ТӨЛӨВ (§73) — «асуудал олдсонгүй»-тэй ХЭЗЭЭ Ч холихгүй     */
    /* ================================================================== */

    public enum RevitErrorState
    {
        OK,
        NO_DOCUMENT,
        NO_SELECTION,
        REVIT_BUSY,
        REVIT_API_ERROR,
        MGL_AI_OFFLINE,
        ERP_OFFLINE,
        AUTH_REQUIRED,
        PROJECT_NOT_LINKED,
        NO_TASKS,
        NO_EXECUTABLE_BIM_RULES,
        HUMAN_REVIEW_REQUIRED,
    }
}
