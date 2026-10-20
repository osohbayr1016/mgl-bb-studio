using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Serialization;
using RevitMcpAddin.Smart.Core;

namespace RevitMcpAddin.ClashCheck.Core
{
    /* ====================================================================== */
    /*  CLASH CHECKER — домэйн загвар (Revit-гүй, JSON-д хадгалагдана)          */
    /*                                                                        */
    /*  ⚠️ Хадгалагддаг enum-ын 0 утга нь АЮУЛГҮЙ `Unknown`.                    */
    /* ====================================================================== */

    public enum ClashMode
    {
        Unknown = 0,
        /// <summary>Хатуу огтлолцол — гурван хэмжээст бодис давхцана (boolean intersect-ийн эзлэхүүн &gt; босго).</summary>
        HardIntersection,
        /// <summary>
        /// ЗАЙ (clearance) — ирээдүйн өргөтгөл: загвар (`ClearanceMm`, нэр дэвшигчийг тэлэх `Inflate`) бэлэн,
        /// гэвч геометрийн шалгагч БАЙХГҮЙ.  Validator ийм дүрмийг ЯВУУЛАХГҮЙ — «зай шалгасан» гэж хуурч
        /// зөвхөн bbox-оор таамаглахгүй.
        /// </summary>
        Clearance,
    }

    public enum ClashSource { Host = 0, Links, Both }

    public enum ClashSeverity { Info = 0, Warning, Critical }

    /// <summary>
    /// Clash-ийн ЖИНХЭНЭ амьдралын мөчлөг.  `Resolved` нь ЗӨВХӨН систем (дахин шалгалт баталсан) — хэрэглэгч
    /// гараар `Resolved` болгохгүй.  0 = Unknown → ачаалахад `New` болно (хамгийн аюулгүй: хэрэглэгчид харагдана).
    /// </summary>
    public enum ClashStatus { Unknown = 0, New, Reviewed, Accepted, Resolved }

    /// <summary>
    /// Нэг хос элементийн ШАЛГАЛТЫН ДҮН.  `Unsupported` ба `GeometryError` нь ХЭЗЭЭ Ч `NoClash` болохгүй —
    /// «шалгаж чадаагүй» нь «clash байхгүй» БИШ.
    /// </summary>
    public enum ClashVerdict
    {
        Unknown = 0,
        ConfirmedClash,
        NoClash,
        /// <summary>Геометр шалгах боломжгүй (бодисгүй: арматур, 2D, тэмдэглэгээ г.м.).</summary>
        Unsupported,
        /// <summary>Boolean үйлдэл/геометр унших алдаа.</summary>
        GeometryError,
    }

    public sealed class ClashSelector
    {
        /// <summary>`OST_PipeCurves` гэх мэт BuiltInCategory нэрс.</summary>
        public List<string> Categories { get; set; } = new List<string>();
        public ClashSource Source { get; set; }
        /// <summary>Гэр бүл эсвэл төрлийн нэр ЭНЭ бичвэрийг агуулсан (хоосон = бүгд).</summary>
        public string NameContains { get; set; }
        /// <summary>Линкийн нэр ЭНЭ бичвэрийг агуулсан (Source ≠ Host үед; хоосон = бүх линк).</summary>
        public string LinkContains { get; set; }
    }

    public sealed class ClashRule
    {
        /// <summary>ТОГТВОРТОЙ таних тэмдэг — нэр, тохиргоо солигдсон ч өөрчлөгдөхгүй.</summary>
        public string Id { get; set; } = SmartHash.NewId();
        public string Name { get; set; } = "Шинэ дүрэм";
        public bool Enabled { get; set; } = true;
        public ClashSelector A { get; set; } = new ClashSelector();
        public ClashSelector B { get; set; } = new ClashSelector();
        public ClashMode Mode { get; set; } = ClashMode.HardIntersection;
        /// <summary>Огтлолцлын эзлэхүүн (см³) энэ босгоос БАГА бол clash биш (хэт жижиг давхцал, тооцооны алдаа).</summary>
        public double MinVolumeCm3 { get; set; } = 1.0;
        public double ClearanceMm { get; set; }
        public ClashSeverity Severity { get; set; } = ClashSeverity.Warning;
        /// <summary>Нэг файлын доторх JOIN хийсэн (Join Geometry) хос — зориудаар давхцсан, clash биш.</summary>
        public bool IgnoreJoined { get; set; } = true;
        /// <summary>Хост ба түүнд суурилсан элемент (хананд хаалга) — зориудын давхцал.</summary>
        public bool IgnoreHosted { get; set; } = true;
        /// <summary>Шууд холбогдсон MEP (хоолой ↔ холбох хэрэгсэл) — холболтын цэг дээрх давхцал.</summary>
        public bool IgnoreConnected { get; set; } = true;
        /// <summary>Хоёр тал ИЖИЛ жагсаалт (жишээ нь хоолой ↔ хоолой) — хос нэг л удаа, өөртэйгээ биш.</summary>
        [JsonIgnore]
        public bool Symmetric { get { return ClashRuleLogic.SelectorsEqual(A, B); } }

        public ClashRule Clone()
        {
            return SmartJson.Deserialize<ClashRule>(SmartJson.Serialize(this));
        }
    }

    public sealed class ClashRulesFile
    {
        public List<ClashRule> Rules { get; set; } = new List<ClashRule>();
        public bool StartersSeeded { get; set; }
        public string LastRuleId { get; set; }
    }

    public sealed class ClashHistoryEntry
    {
        public DateTime Utc { get; set; }
        public ClashStatus From { get; set; }
        public ClashStatus To { get; set; }
        /// <summary>`user` | `rerun` | `reappeared` | `deleted` | `moved_apart` ...</summary>
        public string Reason { get; set; }
        public string Note { get; set; }
    }

    /// <summary>Нэг элементийн ХУУЛСАН товч тайлбар (элемент устсан ч жагсаалтад харагдахын тулд).  Урт агуулга ОРООГҮЙ.</summary>
    public sealed class ClashElementInfo
    {
        public string Key { get; set; }
        public string Category { get; set; }
        public string Family { get; set; }
        public string Type { get; set; }
        public string Level { get; set; }
        /// <summary>`UniqueId` биш, харагдах ID (`ElementId.Value`) — зөвхөн энэ session-д (хадгалагдах нь лавлах).</summary>
        public long IdValue { get; set; }
        public string LinkName { get; set; }

        [JsonIgnore]
        public ElementKey ElementKey
        {
            get
            {
                ElementKey k;
                return ElementKey.TryParse(Key, out k) ? k : default(ElementKey);
            }
        }

        public string Label
        {
            get
            {
                string t = !string.IsNullOrEmpty(Type) ? Type : Family;
                return (Category ?? "?") + (string.IsNullOrEmpty(t) ? "" : " · " + t) + (IdValue != 0 ? " · " + IdValue : "")
                    + (string.IsNullOrEmpty(LinkName) ? "" : "  [" + LinkName + "]");
            }
        }
    }

    public sealed class ClashIssue
    {
        public string Fingerprint { get; set; }
        public string RuleId { get; set; }
        /// <summary>Дүрмийн ТОХИРГООНЫ хэш — өөр хэштэй issue нь одоогийн дүрмийн үр дүн БИШ (түүх).</summary>
        public string RuleHash { get; set; }
        public string RuleName { get; set; }
        public ClashElementInfo A { get; set; } = new ClashElementInfo();
        public ClashElementInfo B { get; set; } = new ClashElementInfo();
        public ClashStatus Status { get; set; } = ClashStatus.New;
        public DateTime FirstSeenUtc { get; set; }
        public DateTime LastSeenUtc { get; set; }
        public DateTime? ResolvedUtc { get; set; }
        public int TimesSeen { get; set; } = 1;
        public double VolumeCm3 { get; set; }
        /// <summary>Огтлолцлын төв (host координат, мм).</summary>
        public double[] Point { get; set; }
        /// <summary>Огтлолцлын хайрцаг [minX,minY,minZ,maxX,maxY,maxZ] (host, мм) — харуулахад.</summary>
        public double[] Box { get; set; }
        public string Level { get; set; }
        public string Note { get; set; }
        /// <summary>Хамгийн сүүлийн шалгалтаар баталгаажуулж чадаагүй (дэмжигдээгүй/алдаа) — төлөв хэвээр, гэхдээ «Resolved» гэж үзэхгүй.</summary>
        public bool Unverified { get; set; }
        public ClashSeverity Severity { get; set; }
        public List<ClashHistoryEntry> History { get; set; } = new List<ClashHistoryEntry>();

        [JsonIgnore]
        public bool IsActive { get { return Status != ClashStatus.Resolved; } }
    }

    public sealed class ClashRunRecord
    {
        public string Id { get; set; } = SmartHash.NewId();
        public string RuleId { get; set; }
        public string RuleName { get; set; }
        public string RuleHash { get; set; }
        public DateTime StartedUtc { get; set; }
        public DateTime? EndedUtc { get; set; }
        public RunStatus Status { get; set; }
        public int ACount { get; set; }
        public int BCount { get; set; }
        public int Candidates { get; set; }
        public int Confirmed { get; set; }
        public int NoClash { get; set; }
        public int Unsupported { get; set; }
        public int GeometryErrors { get; set; }
        public int SkippedByDesign { get; set; }
        public int New { get; set; }
        public int Resolved { get; set; }
        public int Reappeared { get; set; }
        public int ElementsWithoutBounds { get; set; }
        public int LinksUnloaded { get; set; }
        public Dictionary<string, long> StageMs { get; set; } = new Dictionary<string, long>();
        public List<string> Notes { get; set; } = new List<string>();
        public string ModelStamp { get; set; }
    }

    public sealed class ClashState
    {
        public List<ClashIssue> Issues { get; set; } = new List<ClashIssue>();
        public List<ClashRunRecord> Runs { get; set; } = new List<ClashRunRecord>();
    }

    /// <summary>Нэг хос элементийн шалгалтын ДҮН (Revit-ээс).</summary>
    public sealed class PairResult
    {
        public int A { get; set; }
        public int B { get; set; }
        public ClashVerdict Verdict { get; set; }
        public double VolumeCm3 { get; set; }
        public double[] Point { get; set; }
        public double[] Box { get; set; }
        public string Reason { get; set; }
    }
}
