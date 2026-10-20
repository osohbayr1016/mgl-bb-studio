using System;
using System.Collections.Generic;

namespace RevitMcpAddin.WallElevation.Core
{
    // ══════════════════════════════════════════════════════════════════════════
    //  «Ханын дэлгээс» — Revit-ээс ЦУГЛУУЛСАН өгөгдөл (оролт) ба ТӨЛӨВЛӨГӨӨ (гаралт).
    //  Revit давхарга (`ElevationTargetResolver`) нэг удаа уншиж эдгээрийг бөглөнө; бүх шийдвэр
    //  (тал, хүрээ, нэр, үйлдэл) нь `WallElevationPlanner`-т Revit-гүйгээр гарна — тиймээс тесттэй.
    // ══════════════════════════════════════════════════════════════════════════

    /// <summary>Дэлгээс бүрийн төлөв (хэрэглэгчид харагдана).</summary>
    public enum WeStatus
    {
        /// <summary>Шулуун энгийн хана — бүрэн дэмжигдэнэ.</summary>
        Ready = 0,
        /// <summary>Үүснэ, гэхдээ тайлбар уншина уу (хөшиг хана, давхарласан хана г.м.).</summary>
        Warning = 1,
        /// <summary>Үүсгэхгүй — хүн шалгах ёстой (налуу хана, хоёрдмол тал, давхардсан харагдац).</summary>
        RequiresReview = 2,
        /// <summary>Үүсгэхгүй — дэмжигдэхгүй геометр (муруй хана, холбоосын хана).</summary>
        Unsupported = 3,
        /// <summary>Алдаа гарсан (өгөгдөл буруу эсвэл үүсгэсний дараах шалгалт унасан).</summary>
        Failed = 4,
    }

    /// <summary>Загварт юу хийх.</summary>
    public enum WeAction
    {
        Create = 0,
        Update = 1,
        Keep = 2,
        Skip = 3,
    }

    public enum WeSourceKind
    {
        Room = 0,
        Wall = 1,
    }

    public enum WeWallKind
    {
        Basic = 0,
        Curtain = 1,
        Stacked = 2,
        Unknown = 3,
    }

    /// <summary>Хана сонгосон үед аль талаас нь харах.</summary>
    public enum WeWallSidePick
    {
        Exterior = 0,
        Interior = 1,
        Both = 2,
    }

    public enum WeOutputMode
    {
        ViewsOnly = 0,
        ViewsAndSheets = 1,
    }

    /// <summary>Харах гүн (зүсэх хавтгай гадаргуугаас хэр өмнө).</summary>
    public enum WeDepthMode
    {
        /// <summary>Өрөөний ДУНД хүртэл (Revit-ийн дотоод дэлгээсийн тэмдэгтэй ижил: өрөөнд байгаа тавилга харагдана).</summary>
        HalfRoom = 0,
        /// <summary>Гадаргуунаас тогтмол зай (<see cref="WeSettings.NearOffsetMm"/>).</summary>
        Fixed = 1,
    }

    /// <summary>Дэлгээсийн харагдацын ТӨРӨЛ.</summary>
    public enum WeViewKind
    {
        /// <summary>
        /// Revit-ийн Elevation (View → Elevation): өрөөнд ElevationMarker, тэгш өнцөгт өрөөнд НЭГ маркер 4 сумтай.  Огтлохгүй
        /// (тавилга зүсэгдэхгүй), Project Browser «Elevations», план дээрх тэмдэг нь viewport-ийн дугаар/хуудсыг өөрөө харуулна.
        /// </summary>
        Elevation = 0,
        /// <summary>Зүсэлт (ViewSection.CreateSection) — 2026-10-06 хүртэлх хувилбар.</summary>
        Section = 1,
    }

    /// <summary>Хэвтээ (доорх) хэмжээсийн эгнээ.</summary>
    public enum WeDimGrouping
    {
        /// <summary>Ангиллаар ТУСДАА эгнээ: тоноглол · хаалга, цонх · хана, тэнхлэг · нийт урт (гаднаас нь).</summary>
        Separated = 0,
        /// <summary>Нэг холимог гинж + нийт урт (2026-10-06-ны хувилбар).</summary>
        Combined = 1,
    }

    /// <summary>
    /// Дэлгээсийн ТОД / БҮДЭГ хэсэг (2026-10-14, интерьерийн баг 3-р тойрог: «аль хэсгийг тодруулж, аль хэсгийн opacity-г 20 болгохыг
    /// үүсгэх цонхноос сонгоно»).  Тод хэсэг нь үргэлж шалнаас эхэлнэ; дээд хил нь горимоор, түүнээс дээш хүрээний орой хүртэл бүдэг.
    /// </summary>
    public enum WeFadeMode
    {
        /// <summary>Бүдэгрүүлэхгүй — бүх дэлгээс тод.</summary>
        None = 0,
        /// <summary>Тод: шалнаас таазны дээд нүүр хүртэл; бүдэг: таазнаас дээд хучилт (хүрээний орой) хүртэл — жишээ хуудас 232.</summary>
        AboveCeiling = 1,
        /// <summary>Тод: шалнаас <see cref="WeSettings.FadeHeightMm"/> хүртэл; бүдэг: түүнээс дээш.</summary>
        AboveHeight = 2,
    }

    /// <summary>Дэлгээсийн тэмдгийн {Side} хэсэг (W05, 2026-10-16): A, B, C … эсвэл 1, 2, 3 ….</summary>
    public enum WeLabelMode
    {
        /// <summary>Үсгээр — өрөөнд компасаар (A = баруун хана …), өгөгдмөл.</summary>
        Letters = 0,
        /// <summary>Тоогоор — <see cref="WeSettings.LabelStart"/>-аас, оронгийн тоо <see cref="WeSettings.LabelDigits"/>.</summary>
        Numbers = 1,
    }

    /// <summary>Шинэ хуудасны дугаар (W05, 2026-10-16).</summary>
    public enum WeSheetNumberMode
    {
        /// <summary>Загвараар (<see cref="WeSettings.SheetNumberPattern"/>) эсвэл төслийн цуваагаар — давхардвал «-2».</summary>
        Pattern = 0,
        /// <summary>Мужаар: угтвар + [эхлэх … дуусах] доторх СУЛ дугаар; хүрэлцэхгүй бол үүсгэхээс ӨМНӨ засуулна (хэзээ ч хэтрэхгүй).</summary>
        Range = 1,
    }

    /// <summary>Перспектив / рендер зургийн БАЙР хуудсанд хаана (2026-10-14, интерьерийн баг 3-р тойрог).</summary>
    public enum WeRenderPlacement
    {
        /// <summary>Сүүлийн хуудасны доод мөрөнд; багтахгүй бол сүүлээсээ 2 дахь хуудсанд; тэнд ч үгүй бол хоёуланд хувааж; эцэст нь шинэ хуудсанд.  ХЭЗЭЭ Ч хаягдахгүй.</summary>
        LastSheet = 0,
        /// <summary>Хуудас БҮРИЙН доод мөрөнд (хуудас бүр өөрийн «ХАРАГДАХ БАЙДАЛ 01…»).</summary>
        AllSheets = 1,
    }

    /// <summary>Харагч ханын аль талд зогсож байгаа (ханын гадна тал = <c>Wall.Orientation</c>-ий тал).</summary>
    public static class WeSide
    {
        public const string Exterior = "ext";
        public const string Interior = "int";
    }

    /// <summary>Нэг хана — Revit-ээс хямд өгөгдлөөр (LocationCurve, bbox, параметр) уншсан.</summary>
    public sealed class WeWallInfo
    {
        public string UniqueId;
        public long Id;
        public string Mark;
        public string TypeName;
        public string LevelName;
        public WeWallKind Kind;
        /// <summary>LocationCurve байхгүй (in-place хана г.м.).</summary>
        public bool HasLocationLine;
        /// <summary>LocationCurve нь шулуун биш (Arc, Ellipse, Spline …).</summary>
        public bool IsCurved;
        /// <summary>Налуу / нарийссан хөндлөн огтлол (Revit 2022+ `Wall.CrossSection`).</summary>
        public bool IsSlanted;
        /// <summary>Location line нь ханын тэнхлэг (WALL_KEY_REF_PARAM = 0).  Үгүй бол гүнийг ХОЛЫН нөөцтэй бодно.</summary>
        public bool LocationIsCenterline;
        public WeV3 Start;
        public WeV3 End;
        /// <summary>Нийт зузаан (фут).  Хөшиг хананд 0 байж болно.</summary>
        public double Width;
        public double BottomZ;
        public double TopZ;
        /// <summary><c>Wall.Orientation</c> — зөвхөн ТАЛЫН ТЭМДЭГ авахад (чиглэлийг шугамаас бодно).</summary>
        public WeV3 OrientationHint;
        /// <summary>Холбосон (link) загварын хана — координат host руу хөрвүүлсэн, <see cref="Id"/> = 0 (host элемент биш).</summary>
        public bool IsLinked;
    }

    public enum WeBoundaryHost
    {
        Wall = 0,
        /// <summary>Холбосон (link) загварын хана.</summary>
        LinkedWall = 1,
        /// <summary>Өрөө тусгаарлах шугам, багана, in-place элемент …</summary>
        Other = 2,
    }

    public sealed class WeBoundarySegment
    {
        public WeBoundaryHost Host;
        public string WallUniqueId;
        public bool IsStraight;
        /// <summary>Сегментийн эхлэл ба төгсгөл (ӨРӨӨНИЙ хил дээр — Finish байрлал).  Хэвтээ.</summary>
        public WeV3 A;
        public WeV3 B;
        /// <summary>
        /// Revit-ийн `Room.IsPointInRoom` шалгалт: геометрээр олсон «өрөөний дотор тал» дээрх цэг өрөөнд байна уу.
        /// null = шалгаагүй / шалгаж чадаагүй.
        /// </summary>
        public bool? InteriorProbe;
    }

    public sealed class WeRoomLoop
    {
        public List<WeBoundarySegment> Segments = new List<WeBoundarySegment>();
    }

    public sealed class WeRoomInfo
    {
        public string UniqueId;
        public long Id;
        public string Number;
        public string Name;
        public string LevelName;
        /// <summary>Түвшний ElementId (түлхүүр план үүсгэхэд).  0 = мэдэгдэхгүй.</summary>
        public long LevelId;
        public double LevelElevation;
        public double BottomZ;
        public double TopZ;
        /// <summary>Өрөөний цэг (LocationPoint) — түлхүүр план дээр өрөөний шошго.  Байршаагүй бол Zero.</summary>
        public WeV3 Location;
        /// <summary>Байршуулсан (Location-тай) эсэх.</summary>
        public bool IsPlaced;
        /// <summary>Хүрээлэгдсэн (талбай &gt; 0) эсэх.</summary>
        public bool IsEnclosed;
        public List<WeRoomLoop> Loops = new List<WeRoomLoop>();
    }

    /// <summary>Өмнө нь ЭНЭ хэрэгслээр үүсгэсэн харагдац (Extensible Storage-оос).</summary>
    public sealed class WeExistingView
    {
        public long ViewId;
        public string Key;
        public string Signature;
        public string Name;
        /// <summary>Хэрэгсэл энэ харагдацад сүүлд өгсөн нэр.  Одоогийн нэр ≠ энэ бол хэрэглэгч солисон — ХӨНДӨХГҮЙ.</summary>
        public string GeneratedName;
        public string WallUid;
        public string RoomUid;
        public int GeneratorVersion;
        public bool SourceWallExists;
        public bool SourceRoomExists;
        /// <summary>Өөр хэрэглэгч эзэмшсэн (workshared) — засах боломжгүй.</summary>
        public bool OwnedByOtherUser;
        /// <summary>Зүсэлт (Section) — 2026-10-06 хүртэлх хувилбар үүсгэсэн; Elevation горимд ч зүсэлтээр шинэчлэгдэнэ.</summary>
        public bool IsSection;
        /// <summary>Хэрэглэгчийн тохируулсан байрлал (<see cref="WeSideOverride.Serialize"/>) — хоосон = хэрэгслийн өөрийн байрлал.</summary>
        public string Override;
        /// <summary>W07: харагдац дээр хадгалсан босоо хүрээний доод/дээд хил (мм, <see cref="WeViewState"/>); NaN = авто.</summary>
        public double CropLowerMm = double.NaN;
        public double CropUpperMm = double.NaN;
        /// <summary>W09: харагдац дээр хадгалсан өрөөний зориулалт (<see cref="WePresetId"/>); хоосон = мэдэгдэхгүй.</summary>
        public string Preset = string.Empty;
    }

    /// <summary>Төлөвлөгчийн бүх оролт.</summary>
    public sealed class WeRequest
    {
        public List<WeRoomInfo> Rooms = new List<WeRoomInfo>();
        /// <summary>Хэрэглэгчийн ШУУД сонгосон хана.</summary>
        public List<WeWallInfo> Walls = new List<WeWallInfo>();
        /// <summary>Өрөөний хилийн сегментийн ханыг UniqueId-аар (нэг удаа уншсан).</summary>
        public Dictionary<string, WeWallInfo> WallLookup = new Dictionary<string, WeWallInfo>(StringComparer.Ordinal);
        public List<WeExistingView> Existing = new List<WeExistingView>();
        /// <summary>Баримтын БҮХ харагдацын нэр (давхардал шалгах).</summary>
        public HashSet<string> ExistingViewNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        /// <summary>Сонголтоос алгассан элементийн тайлбар (өрөө/хана биш г.м.).</summary>
        public List<string> SelectionNotes = new List<string>();
        /// <summary>Тэмдэглэгээний эх өгөгдөл (түвшин, шал/тааз, нүх, шошголох элемент) — сонголтын орчмоос.</summary>
        public WeAnnoSources Sources = new WeAnnoSources();
    }

    /// <summary>Нэг дэлгээсний бүрэн төлөвлөгөө.</summary>
    public sealed class WePlannedElevation
    {
        public string Key;
        public WeSourceKind Kind;
        /// <summary>Урьдчилсан харагдацын бүлэг (өрөө тус бүр / ханын түвшин).</summary>
        public string GroupKey;
        public string GroupLabel;
        public string RoomUid;
        public string RoomNumber;
        public string RoomName;
        /// <summary>«Зангуу» хана (тал нь нэг шулуун дээрх хэд хэдэн ханаас бүрдвэл ХАМГИЙН урт нь) — түлхүүр, шалгалт.</summary>
        public string WallUid;
        public long WallId;
        /// <summary>Энэ талыг бүрдүүлэх БҮХ хана (зангуу эхэнд).  Нүх (хаалга, цонх) эдгээрийн аль нэгэнд суусан бол дэлгээст орно.</summary>
        public List<string> WallUids = new List<string>();
        public List<long> WallIds = new List<long>();
        /// <summary>Тал дотор хана биш хил (багана, тусгаарлах шугам) орсон.</summary>
        public bool HasNonWallBoundary;
        public string WallLabel;
        public string LevelName;
        /// <summary><see cref="WeSide"/>.</summary>
        public string Side;
        /// <summary>A, B, C … (өрөөнд компасаар, хананд A = гадна, B = дотор).</summary>
        public string SideLetter;
        /// <summary>
        /// Тэмдэг, гарчиг, нэрийн {Side} утга (W05): үсгийн горимд = <see cref="SideLetter"/>, тоон горимд «1», «01» …; тасралтгүй горимд багц даяар.
        /// Харагдацыг таних нь үүнээс ҮЛ ХАМААРНА (<see cref="Key"/>).
        /// </summary>
        public string SideToken;
        /// <summary>Бүлэг доторх дугаар (1-ээс, үсгийн дарааллаар) — {WallIndex}.</summary>
        public int SideIndex;
        /// <summary>Хуудас / түлхүүр план дээрх тэмдэг (жишээ «205A») — <see cref="WeSettings.LabelPattern"/>.</summary>
        public string Label;
        /// <summary>Viewport-ийн гарчиг («Title on Sheet») — <see cref="WeSettings.TitlePattern"/>; хоосон = тавихгүй.</summary>
        public string Title;

        public WeStatus Status;
        public string Message;
        public WeAction Action;
        public string ActionNote;

        public WeFrame Frame;
        public WeBox Box;
        /// <summary>Шалгалтын цэгүүд: харах гадаргуугийн эхлэл, дунд, төгсгөл (өндрийн дунд) ба ханын ар тал.</summary>
        public WeV3[] ProbePoints = new WeV3[0];
        public double FaceLength;
        public double FaceHeight;
        /// <summary>Харах чиглэл (хэвтээ) — хүрээгүй (муруй) мөрөнд ч байж болно: компас, жижиг план.</summary>
        public WeV3 PlanLook;
        /// <summary>Гадаргуугийн план дахь хоёр үзүүр (жижиг план зурахад) — хүрээгүй мөрөнд ч.</summary>
        public WeV3 PlanA;
        public WeV3 PlanB;

        public string Name;
        public long ExistingViewId;
        public string ExistingName;
        /// <summary>Байгаа харагдац нь зүсэлт (Section) — Elevation горимд ч хэвээр шинэчлэгдэнэ.</summary>
        public bool ExistingIsSection;
        public string Signature;
        /// <summary>Нэр солих эсэх (Update/Keep үед).</summary>
        public bool Rename;
        /// <summary>Тэмдэглэгээний төлөвлөгөө (spot level, хэмжээс, шошго) — хоосон байж болно.</summary>
        public WeAnnotationPlan Annotation = new WeAnnotationPlan();
        /// <summary>Elevation горимд ШИНЭ харагдацын маркер (байршил, эргэлт, индекс); бусад үед null.</summary>
        public WeMarkerPlacement Marker;
        /// <summary>Хэрэглэгчийн тохируулсан байрлал (хэрэглэгдсэн) — null = хэрэгслийн байрлал.  Харагдац дээр хадгалагдана.</summary>
        public WeSideOverride Override;
        /// <summary>Хэрэгслийн өөрийн (анхны) гадаргуу — урьдчилсан план дээр «буцаах», сүүдэр.</summary>
        public WeV3 OrigA;
        public WeV3 OrigB;
        public WeV3 OrigLook;
        /// <summary>Хадгалсан тохируулгыг арилгах (харагдац дээрх бичлэг хоосорно).</summary>
        public bool ClearStoredOverride;
        /// <summary>
        /// Автоматаар үүсэхгүй («шалгах» / «дэмжигдэхгүй») боловч хүрээ гаргах боломжтой — хэрэглэгч чагтлаж хүчээр үүсгэж болно (2026-10-14).
        /// Алдаатай (Failed), хүрээгүй, давхардсан харагдацтай мөрөнд false.
        /// </summary>
        public bool CanForce;
        /// <summary>Хэрэглэгчийн сонголтоор хүчээр үүсгэнэ (<see cref="WeSettings.Forced"/>) — төлөв «анхааруулга» болж үүснэ.</summary>
        public bool Forced;
        /// <summary>Хүчлэхээс ӨМНӨХ шалтгаан (тайлан, цонхонд).</summary>
        public string ForcedReason;
        /// <summary>
        /// W10: муруй хана — хүчилбэл ХӨВЧӨӨР харсан ХАВТГАЙ харагдац үүснэ (нумын уртаар дэлгэсэн / unwrapped зураг БИШ).  Муруй ханын
        /// жинхэнэ дүрслэлийг архитекторууд сонгох хүртэл хойшлуулсан — энэ туг нь зөвхөн бичвэрийг шударга байлгана (цонх, тайлан).
        /// </summary>
        public bool ChordView;
        /// <summary>
        /// Өрөөний хилээс БИШ — хэрэглэгч цонхны «+ Хана нэмэх»-ээр нэмж план дээр байрлуулсан НЭМЭЛТ тал (2026-10-14, <see cref="WeExtraSides"/>).
        /// Үсэг нь өрөөний бусад талын ДАРАА (E, F …), бусад нь өрөөний тал шиг (хуудас, түлхүүр план, маркер, тэмдэглэгээ).
        /// </summary>
        public bool Manual;
        /// <summary>
        /// W07: хэрэглэгчийн ТОГТООСОН босоо хүрээ (мм, дэлгээсийн суурь = өрөөний шал / ханын суурь); NaN = тэр тал авто.  Хүрээ ЯГ энэ
        /// (<see cref="WeVerticalCrop"/>); харагдац дээр хадгалагдаж дахин ажиллуулахад сэргэнэ.
        /// </summary>
        public double CropLowerMm = double.NaN;
        public double CropUpperMm = double.NaN;
        /// <summary>Тогтоосон хил харагдац дээр хадгалснаас (цонхонд энэ удаа өөрчлөөгүй).</summary>
        public bool CropFromView;
        /// <summary>W09: өрөөний зориулалт (<see cref="WePresetId"/>; хана горимд өгөгдмөл).</summary>
        public string PresetId = WePresetId.Custom;
        public WePresetSource PresetSource = WePresetSource.Default;
        /// <summary>Санал болгосон / хадгалсан шалтгаан («нэрэнд «WC» байна»).</summary>
        public string PresetReason;
        /// <summary>Санал (хэрэглэгдээгүй ч — «Тусгай» өгөгдмөл үед харуулах): id, шалтгаан.  null = санал алга.</summary>
        public string SuggestedPreset;
        public string SuggestedReason;

        /// <summary>Босоо хүрээг хэрэглэгч тогтоосон (аль нэг тал).</summary>
        public bool HasDeclaredCrop { get { return !double.IsNaN(CropLowerMm) || !double.IsNaN(CropUpperMm); } }
    }

    public sealed class WeOrphan
    {
        public long ViewId;
        public string Name;
        public string Reason;
    }

    /// <summary>
    /// Нэг бүлэг (өрөө) — хуудасны «нэмэлт» блокууд: түлхүүр план, 3D axon.  Хуудас горимд, өрөө горимд л.
    /// </summary>
    public sealed class WeGroupInfo
    {
        public string GroupKey;
        public string GroupLabel;
        public string RoomUid;
        public long RoomId;
        public string RoomNumber;
        public string RoomName;
        public string LevelName;
        public long LevelId;
        /// <summary>Бүлгийн үүсэх дэлгээсийн үсгийн муж («A-F»).</summary>
        public string SideRange;
        /// <summary>Түлхүүр план, хуудасны тэмдэг («205A-F»).</summary>
        public string Label;
        public WeKeyPlan KeyPlan;
        public WeAxonPlan Axon;
        /// <summary>W09: өрөөний зориулалт — хуудасны рендерийн байр, тогтмол параметр, загвар үүгээр.</summary>
        public string PresetId = WePresetId.Custom;
    }

    public sealed class WePlan
    {
        public List<WePlannedElevation> Items = new List<WePlannedElevation>();
        public List<WeOrphan> Orphans = new List<WeOrphan>();
        public List<string> Notes = new List<string>();
        /// <summary>Хуудасны нэмэлт блок (түлхүүр план, 3D) — бүлэг тус бүр.  Хоосон = нэмэлтгүй.</summary>
        public List<WeGroupInfo> Groups = new List<WeGroupInfo>();
        /// <summary>Өрөөний хил (бүлгийн түлхүүр → контурууд, план XY) — урьдчилсан план засварлагчид.</summary>
        public Dictionary<string, List<List<WeV3>>> Outlines = new Dictionary<string, List<List<WeV3>>>(StringComparer.Ordinal);
        /// <summary>
        /// W05: шинэ хуудасны дугаар (бүлгийн түлхүүр → дугаар) — <see cref="WeNumbering.Evaluate"/> урьдчилан хуваарилна; хуудасны үйлчилгээ ЭНЭ дугаарыг
        /// хэрэглэнэ (мужаас хэзээ ч гарахгүй).  Хоосон = хуучин зам (загвар / төслийн цуваа).
        /// </summary>
        public Dictionary<string, string> SheetNumbers = new Dictionary<string, string>(StringComparer.Ordinal);

        public int Count(WeStatus s)
        {
            int n = 0;
            foreach (WePlannedElevation i in Items) if (i.Status == s) n++;
            return n;
        }

        public int Count(WeAction a)
        {
            int n = 0;
            foreach (WePlannedElevation i in Items) if (i.Action == a) n++;
            return n;
        }

        /// <summary>Загвар өөрчлөх ажил байгаа эсэх.</summary>
        public bool HasWork
        {
            get
            {
                foreach (WePlannedElevation i in Items)
                    if (i.Action == WeAction.Create || i.Action == WeAction.Update) return true;
                return false;
            }
        }
    }
}
