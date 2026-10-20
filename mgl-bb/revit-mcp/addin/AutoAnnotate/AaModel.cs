using System;
using System.Collections.Generic;
using System.Linq;
using System.IO;
using System.Text.Json;
using Autodesk.Revit.DB;

namespace RevitMcpAddin.AutoAnnotate
{
    /// <summary>Хэрэглэгчийн сонголт — цонхноос, эсвэл тест харness-аас шууд.</summary>
    public sealed class AaOptions
    {
        // ── План
        /// <summary>Тэнхлэг хоорондын гинж + хамгийн захын тэнхлэг хоорондын нийт хэмжээ.</summary>
        public bool GridDims { get; set; } = true;
        /// <summary>
        /// <see cref="GridDims"/> асаалттай үед тэнхлэг БҮРИЙН хоорондын гинжийг тавих эсэх.  false = зөвхөн хамгийн захын тэнхлэг хоорондын НИЙТ хэмжээ.
        /// Хуучин auto-annotate.json-д байхгүй ⇒ true (өмнөх зан төлөв).
        /// </summary>
        public bool GridChain { get; set; } = true;
        /// <summary>Гадна хана: булан, цонх/хаалганы нүх, тэнхлэгийн холболт (1-р гинж).</summary>
        public bool FacadeDims { get; set; } = true;
        /// <summary>Дотор: тэнхлэг хоорондын дундаар хана, өрөөний хэмжээ, хананы зузаан.</summary>
        public bool InteriorDims { get; set; } = true;
        /// <summary>Дотор хананы хаалга/цонхны нүх ба ойрын ханаас холболт.</summary>
        public bool DoorDims { get; set; } = true;
        /// <summary>Багана бүрийг ойрын тэнхлэгт холбох (нүүр — тэнхлэг — нүүр).  Ажиллах үеийн утга.</summary>
        public bool ColumnTies { get; set; } = true;
        /// <summary>Хадгалах: бүтээцийн (Structural) план дээр анхдагч асаалттай.</summary>
        public bool ColumnTiesStructural { get; set; } = true;
        /// <summary>Хадгалах: архитектурын план дээр анхдагч УНТРААЛТТАЙ — багана ханан дотор бөөгнөрдөг.</summary>
        public bool ColumnTiesArchitectural { get; set; } = false;

        // ── Зүсэлт / фасад
        /// <summary>Түвшин хоорондын (давхрын өндөр) гинж + нийт өндөр.</summary>
        public bool LevelDims { get; set; } = true;
        /// <summary>Цонх, хаалганы доод/дээд ирмэгийг түвшнээс хэмжих (фасад, зүсэлт).</summary>
        public bool OpeningHeights { get; set; } = true;

        // ── Байрлал
        /// <summary>true = 4 тал; false = зөвхөн доод ба зүүн (<see cref="RightSide"/> бол доод ба баруун).</summary>
        public bool AllSides { get; set; } = true;
        /// <summary>
        /// «Зөвхөн баруун ба доод талд» (2026-10-12, эзний TRET21.pdf): <see cref="AllSides"/> = false үед босоо гинжийг зүүн биш БАРУУН талд.
        /// 4 талд үед үл тоогдоно.  Хуучин JSON-д байхгүй → false = өмнөх зан төлөв.
        /// </summary>
        public bool RightSide { get; set; } = false;
        /// <summary>Тэнхлэгийн бөмбөлгийг хамгийн гадна гинжээс цааш гаргах (зөвхөн энэ харагдацад).</summary>
        public bool ExtendGrids { get; set; } = true;
        /// <summary>Барилгын ирмэгээс эхний гинж хүртэл, цаасан дээр (мм).</summary>
        public double FirstMm { get; set; } = 12;
        /// <summary>Гинж хоорондын зай, цаасан дээр (мм).  ГОСТ 2.307: ≥ 7.</summary>
        public double StepMm { get; set; } = 8;
        /// <summary>
        /// Хэмжээсийн төрөл — НЭГ сонголт, БҮХ хэмжээсэд (ерөнхий, огтлолын гинж, дэлгээсийн давхцал/тэнхлэг, MRA-ийн хэмжээс).  Хоосон = файлын өгөгдмөл.
        /// UniqueId (ElementId биш — ElementId төсөл бүрд өөр, өөр төслийн ӨӨР элементийг заадаг байв); харуулах нэрээр БИШ.
        /// </summary>
        public string DimensionTypeUid { get; set; } = "";

        // ── Tag
        public bool TagDoors { get; set; } = true;
        public bool TagWindows { get; set; } = true;
        public bool TagRooms { get; set; } = true;
        public bool TagWalls { get; set; } = false;
        public bool TagColumns { get; set; } = true;
        public bool TagFraming { get; set; } = true;

        // ── Хүрээ
        /// <summary>Өмнө нь энэ хэрэгслээр тавьсан хэмжээс/tag-ийг устгаад дахин тавих.</summary>
        public bool ReplacePrevious { get; set; } = true;
        /// <summary>Зөвхөн сонгосон элементүүд (хадгалагдахгүй — ээлж бүрд).</summary>
        public bool OnlySelection { get; set; } = false;

        /// <summary>Арматурын горим (дам нурууны огтлол/дэлгээс) — <see cref="AaRebar"/>.</summary>
        public AaRebarOptions Rebar { get; set; } = new AaRebarOptions();

        /// <summary>Хана, хучилтын арматурын олонлогийн MRA (тусдаа цэс) — <see cref="AaWallSlab"/>.</summary>
        public AaWallSlabOptions WallSlab { get; set; } = new AaWallSlabOptions();

        public AaOptions Clone()
        {
            var c = (AaOptions)MemberwiseClone();
            c.Rebar = (Rebar ?? new AaRebarOptions()).Clone();
            c.WallSlab = (WallSlab ?? new AaWallSlabOptions()).Clone();
            return c;
        }

        /// <summary>
        /// НЭГ «Байрлал» хэрэгслийн БҮХ хэмжээсэд (2026-10-12, эзний t1.pdf: «эхний гинж» зай бүх хэмжээсэд нөлөөлдөг, «баруун ба доод» арматурын хэмжээсэд ч).
        /// Энэ (ерөнхий) тохиргоо <see cref="AllSides"/>/<see cref="RightSide"/>/<see cref="FirstMm"/>/<see cref="StepMm"/> нь эх сурвалж — огтлолын хомутын/гадна гинж,
        /// хана-хучилтын ерөнхий хэмжээс, дэлгээсийн хэмжээсийн эхний зай ба баганын тал руу хуулагдана.  Цонх ба ажиллуулагч ХОЁУЛАА дуудна (давхар үнэн ҮГҮЙ).
        /// </summary>
        public void ApplyPlacement()
        {
            if (Rebar == null) Rebar = new AaRebarOptions();
            if (WallSlab == null) WallSlab = new AaWallSlabOptions();
            bool right = !AllSides && RightSide;
            Rebar.SecAllSides = AllSides;
            Rebar.SecRightSide = right;
            Rebar.SecDimOffsetMm = FirstMm;
            Rebar.SecStepMm = StepMm;
            Rebar.ElevDimFirstMm = FirstMm;
            // Баганын дэлгээсэд хэмжээс нэг л талд: «зүүн ба доод» = зүүн, «баруун ба доод» ба «4 талд» = баруун (өмнөх зан төлөв).
            Rebar.ElevColumnLeft = !AllSides && !RightSide;
            WallSlab.OverallAllSides = AllSides;
            WallSlab.OverallRightSide = right;
            WallSlab.OverallOffsetMm = FirstMm;
            WallSlab.OverallStepMm = StepMm;
        }
    }

    /// <summary>Нэг ажиллагааны үр дүн.</summary>
    public sealed class AaReport
    {
        public int DimsGrid, DimsOverall, DimsFacade, DimsInterior, DimsDoor, DimsColumn, DimsLevel, DimsOpening;
        public int DimsFailed;
        public int Tags, RoomTags, TagsExisting, TagsFailed;
        public int PreviousRemoved, GridsExtended, WarningsHidden, InvalidRemoved;
        public readonly List<string> Notes = new List<string>();
        public readonly List<string> Errors = new List<string>();
        public readonly List<ElementId> Created = new List<ElementId>();
        /// <summary>Үүсгэсэн хэмжээсүүд (бичвэр зөөхөд).</summary>
        public readonly List<ElementId> DimIds = new List<ElementId>();
        /// <summary>Хэмжээс бүрийн төрөл (Commit-ийн дараа Revit хассаныг зөв тоолохын тулд).</summary>
        public readonly Dictionary<long, string> DimWhat = new Dictionary<long, string>();

        /// <summary>Арматурын горим: огтлол (гишүүн, хэмжээс, сегмент, tag) ба дэлгээс (гишүүн, шошго, MRA, давхцал, тэнхлэгийн гинж).</summary>
        public int RebarSections, RebarSecDims, RebarSecDimSegments, RebarSecTags;

        /// <summary>Огтлол: гишүүний хэмжээс тэнхлэг, хучилт, ханатай уялдсан гадна гинж (2026-10-08).</summary>
        public int RebarSecMemberDims;
        public int ElevHosts, ElevTags, ElevMras, ElevLaps, ElevSpans;

        /// <summary>Дэлгээс: давхцалтай эгнээний үргэлжилсэн (гинжин) хэмжээс.</summary>
        public int ElevLapChains;
        /// <summary>Хана/хучилтын арматурын олонлогийн MRA: хост, үүссэн MRA, амжилтгүй.</summary>
        public int WsHosts, WsMras, WsFailed;

        /// <summary>Хана/хучилт: олонлогийн тусдаа шошго, давхцалтай олонлогийн үргэлжилсэн хэмжээс, хана/хучилтын ерөнхий хэмжээс.</summary>
        public int WsTags, WsLapChains, WsOverall;

        /// <summary>Хана/хучилт: нэг арматурт нэг MRA — аль хэдийн MRA-тай тул алгассан олонлог, давхардсан тул устгасан MRA (2026-10-09).</summary>
        public int WsMraExisting, WsMraDupRemoved;
        /// <summary>Арматурын горим ямар нэг зүйл өөрчилсөн (Created-д орохгүй огтлолын үр дүн ч) — TransactionGroup assimilate хийхэд.</summary>
        public bool RebarChanged;

        public int Dims => DimsGrid + DimsOverall + DimsFacade + DimsInterior + DimsDoor + DimsColumn + DimsLevel + DimsOpening;

        public void Note(string s)
        {
            if (!string.IsNullOrEmpty(s) && !Notes.Contains(s) && Notes.Count < 40)
                Notes.Add(s);
        }

        public void Error(string s)
        {
            if (!string.IsNullOrEmpty(s) && Errors.Count < 40 && !Errors.Contains(s))
                Errors.Add(s);
        }
    }

    /// <summary>Харагдацын төрөл — алгоритм сонгоно.</summary>
    public enum AaViewKind
    {
        Unsupported = 0,
        Plan = 1,
        Section = 2,
        Elevation = 3,
    }

    /// <summary>Tag-ийн ангилал бүрийн мэдээлэл (цонхонд).</summary>
    public sealed class AaTagInfo
    {
        public string Key;
        public string Label;
        public int Count;
        public int AlreadyTagged;
        public ElementId TagTypeId = ElementId.InvalidElementId;
        public string TagTypeName;
    }

    /// <summary>Шинжилгээ — цонх нээхээс ӨМНӨ (юу олдсон, юу тавих боломжтой).</summary>
    public sealed class AaViewInfo
    {
        public AaViewKind Kind;
        public string ViewName;
        public int Scale;
        public bool Structural;
        public int Walls, WallsExterior, Doors, Windows, Columns, Beams, Rooms, Grids, Levels;
        public int CurtainWalls, CurvedWalls;
        /// <summary>Харагдацад харагдаж буй, ачаалагдсан link; тэдгээрээс уншсан элемент.</summary>
        public int Links, LinkedElements;
        /// <summary>План: огтлолын шүүлтээс өмнөх хана (хост + link).</summary>
        public int RawWalls;
        /// <summary>План: Cut plane-д нэг ч хана таараагүй тул өөр өндрөөр огтолсон.</summary>
        public bool CutFallback;
        public readonly List<string> LinkNames = new List<string>();
        public readonly List<string> LinksUnloaded = new List<string>();
        /// <summary>Хэмжих юм олдоогүй бол — яагаад (хэрэглэгчид), эс бөгөөс null.</summary>
        public string EmptyReason;
        public int SelectionCount;
        public int PreviousCount;
        public readonly List<AaTagInfo> Tags = new List<AaTagInfo>();
        /// <summary>Хэмжээсийн (Linear) төрлүүд: UniqueId → нэр.</summary>
        public readonly List<KeyValuePair<string, string>> DimensionTypes = new List<KeyValuePair<string, string>>();
        public string DefaultDimensionUid = "";

        /// <summary>Арматурын дам нуруу (огтлол/дэлгээс) олдсон эсэх ба тохиргооны төрлүүд.</summary>
        public AaRebarInfo Rebar = new AaRebarInfo();

        /// <summary>Хана, хучилтын арматурын олонлог олдсон эсэх.</summary>
        public AaWallSlabInfo WallSlab = new AaWallSlabInfo();

        public AaTagInfo Tag(string key) => Tags.Find(t => t.Key == key);
    }

    /// <summary>Тохиргоог %APPDATA%\RevitMcpAddin\auto-annotate.json-д (settings.json-оос тусдаа).</summary>
    public static class AaPrefs
    {
        private static string PathOf => System.IO.Path.Combine(SettingsStore.Dir, "auto-annotate.json");

        public static AaOptions Load()
        {
            try
            {
                if (File.Exists(PathOf))
                {
                    AaOptions o = JsonSerializer.Deserialize<AaOptions>(File.ReadAllText(PathOf));
                    if (o != null)
                    {
                        o.OnlySelection = false;
                        if (o.Rebar == null) o.Rebar = new AaRebarOptions();
                        o.Rebar.OnlySelectedHosts = false;
                        // Хуучин «Арматур» табын тусдаа хэмжээсийн төрөл → НЭГ сонголт руу шилжүүлнэ (шинийг хэрэглэгч сонгоогүй бол).
                        if (string.IsNullOrEmpty(o.DimensionTypeUid) && !string.IsNullOrEmpty(o.Rebar.DimTypeUid))
                            o.DimensionTypeUid = o.Rebar.DimTypeUid;
                        o.Rebar.DimTypeUid = "";
                        // Эвдэрсэн/гараар засагдсан хэт утга цонх нээхэд унагахгүй — өгөгдмөл руу.
                        AaRebarOptions defaults = new AaRebarOptions();
                        if (o.Rebar.Placement().Validate(null, true) != null)
                        {
                            o.Rebar.TagOffsetMm = defaults.TagOffsetMm;
                            o.Rebar.TagGapMm = defaults.TagGapMm;
                            o.Rebar.DimPitchMm = defaults.DimPitchMm;
                            o.Rebar.SecDimOffsetMm = defaults.SecDimOffsetMm;
                            o.Rebar.StirrupDimOffsetMm = defaults.StirrupDimOffsetMm;
                            o.Rebar.LeaderLandingMm = defaults.LeaderLandingMm;
                            o.Rebar.LeaderRunMm = defaults.LeaderRunMm;
                        }
                        if (double.IsNaN(o.Rebar.SecStepMm) || o.Rebar.SecStepMm < 2 || o.Rebar.SecStepMm > 40) o.Rebar.SecStepMm = defaults.SecStepMm;
                        if (o.WallSlab == null) o.WallSlab = new AaWallSlabOptions();
                        o.WallSlab.OnlySelectedHosts = false;
                        if (o.WallSlab.Validate() != null)
                        {
                            var wd = new AaWallSlabOptions();
                            o.WallSlab.OffsetMm = wd.OffsetMm;
                            o.WallSlab.TagGapMm = wd.TagGapMm;
                            o.WallSlab.OverallOffsetMm = wd.OverallOffsetMm;
                            o.WallSlab.OverallStepMm = wd.OverallStepMm;
                        }
                        if (o.FirstMm < 3 || o.FirstMm > 40) o.FirstMm = 12;
                        if (o.StepMm < 4 || o.StepMm > 30) o.StepMm = 8;
                        return o;
                    }
                }
            }
            catch
            {
                // Эвдэрсэн файл — өгөгдмөл.
            }
            return new AaOptions();
        }

        public static void Save(AaOptions o)
        {
            try
            {
                Directory.CreateDirectory(SettingsStore.Dir);
                File.WriteAllText(PathOf, JsonSerializer.Serialize(o, new JsonSerializerOptions { WriteIndented = true }));
            }
            catch
            {
                // Хадгалж чадаагүй нь ажиллагаанд саад биш.
            }
        }
    }

    /// <summary>
    /// Revit-ийн анхааруулгыг (хэмжээс давхцах г.м.) харуулахгүй, алдаатай элементийг
    /// (жишээ нь лавлагаа нь хүчингүй болсон хэмжээс) устгаж үргэлжлүүлнэ — бусдыг унагахгүй.
    ///
    /// ⚠️ 1.7.1 (2026-10-01, хэмжсэн):
    ///  • «The References of the highlighted Dimension are no longer parallel» алдаа нь DeleteElements
    ///    шийдэлгүй («Remove Reference» л) — 1.7.0 үүнийг шийдэлгүй үлдээж Revit-ийн алдааны цонх
    ///    гаргадаг байв.  Одоо алдаатай элемент НЬ ЭНЭ ажиллагаагаар үүссэн бол (rep.Created) шууд устгана.
    ///  • Хэрэглэгчийн элемент (хана, тэнхлэг) алдаанд орсон бол ХЭЗЭЭ Ч устгахгүй — Revit-д үлдээнэ.
    ///  • Transaction буцаагдаж байх үед ProceedWithCommit буцаавал Revit УНАДАГ — Continue л.
    /// </summary>
    internal sealed class AaFailureHandler : IFailuresPreprocessor
    {
        private readonly AaReport _rep;

        public AaFailureHandler(AaReport rep) { _rep = rep; }

        public FailureProcessingResult PreprocessFailures(FailuresAccessor accessor)
        {
            try
            {
                if (!accessor.IsTransactionBeingCommitted())
                    return FailureProcessingResult.Continue;
            }
            catch
            {
                return FailureProcessingResult.Continue;
            }
            var created = new HashSet<long>(_rep.Created.Select(id => id.Value));
            var delete = new List<ElementId>();
            foreach (FailureMessageAccessor f in accessor.GetFailureMessages())
            {
                FailureSeverity sev = f.GetSeverity();
                if (sev == FailureSeverity.Warning)
                {
                    accessor.DeleteWarning(f);
                    _rep.WarningsHidden++;
                    continue;
                }
                if (sev != FailureSeverity.Error)
                    continue;
                ICollection<ElementId> ids = f.GetFailingElementIds();
                if (ids == null || ids.Count == 0 || !ids.All(id => created.Contains(id.Value)))
                    continue; // хэрэглэгчийн элемент — Revit өөрөө асууна
                foreach (ElementId id in ids)
                {
                    if (!delete.Contains(id))
                    {
                        delete.Add(id);
                        _rep.InvalidRemoved++;
                    }
                }
            }
            if (delete.Count == 0)
                return FailureProcessingResult.Continue;
            try
            {
                accessor.DeleteElements(delete);
            }
            catch
            {
                return FailureProcessingResult.Continue;
            }
            return FailureProcessingResult.ProceedWithCommit;
        }
    }
}
