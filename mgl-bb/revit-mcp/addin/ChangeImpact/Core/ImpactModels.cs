using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Serialization;
using RevitMcpAddin.Smart.Core;

namespace RevitMcpAddin.ChangeImpact.Core
{
    /* ====================================================================== */
    /*  CHANGE IMPACT — домэйн загвар (Revit-гүй, JSON-д хадгалагдана)           */
    /*                                                                        */
    /*  ⚠️ Хадгалагддаг enum-ын 0 утга нь АЮУЛГҮЙ `Unknown`.                    */
    /* ====================================================================== */

    /// <summary>
    /// Нөлөөллийн ИТГЭЛИЙН түвшин — А хамгийн хүчтэй.  Зам дагуу ЗӨВХӨН сулрах (хэзээ ч «дээшлэхгүй»):
    /// зам бүрийн итгэл = түүний хамгийн сул холбоос.
    ///
    ///   A  Шууд       — Revit-ийн тодорхой холбоо, өөрчлөлт нь ЭНЭ зүйлийн өөрийнх нь агуулга дотор
    ///                   (харагдацад хамаарах тэмдэглэгээ; хуудсанд байрласан харагдац/хүснэгт).
    ///   B  Магадлалтай — Revit-ийн өгөгдлийн холбоо байна (tag, хэмжээс, хост, төрөл, өрөөний хил, MEP холболт),
    ///                   гэвч өөрчлөлт нь үүнд ҮНЭХЭЭР нөлөөлсөн эсэх нь тодорхойгүй.
    ///   C  Боломжтой  — «магадгүй харагдаж байна» (харагдацын тохиргоо, шүүлтүүрээр) — crop, нуугдсан, хаагдсан байж болно.
    ///   D  Сул таамаг — ангилал/хамаарлын ерөнхий таарц; шууд нотолгоо алга.
    ///
    /// 0 = Unknown → ачаалахад ХАМГИЙН СУЛ (D) гэж үзнэ — мэдэгдэхгүй итгэлийг хэзээ ч «шууд» болгохгүй.
    /// </summary>
    public enum ImpactConfidence { Unknown = 0, A = 1, B = 2, C = 3, D = 4 }

    public static class ImpactConf
    {
        public static int Rank(ImpactConfidence c)
        {
            return c == ImpactConfidence.Unknown ? 4 : (int)c;
        }

        public static ImpactConfidence Normalize(ImpactConfidence c)
        {
            return c == ImpactConfidence.Unknown ? ImpactConfidence.D : c;
        }

        /// <summary>Хоёр итгэлийн СУЛ нь (замын итгэл = хамгийн сул холбоос).</summary>
        public static ImpactConfidence Weaker(ImpactConfidence a, ImpactConfidence b)
        {
            return Rank(b) > Rank(a) ? Normalize(b) : Normalize(a);
        }

        public static bool IsStronger(ImpactConfidence a, ImpactConfidence b)
        {
            return Rank(a) < Rank(b);
        }

        public static string Letter(ImpactConfidence c)
        {
            switch (Normalize(c))
            {
                case ImpactConfidence.A: return "A";
                case ImpactConfidence.B: return "B";
                case ImpactConfidence.C: return "C";
                default: return "D";
            }
        }

        public static string Label(ImpactConfidence c)
        {
            switch (Normalize(c))
            {
                case ImpactConfidence.A: return "Шууд";
                case ImpactConfidence.B: return "Магадлалтай";
                case ImpactConfidence.C: return "Боломжтой";
                default: return "Сул таамаг";
            }
        }

        public static string Meaning(ImpactConfidence c)
        {
            switch (Normalize(c))
            {
                case ImpactConfidence.A:
                    return "Revit-ийн тодорхой холбоо: өөрчлөлт нь энэ зүйлийн өөрийнх нь агуулга дотор (харагдацад хамаарах тэмдэглэгээ, хуудсанд байрласан харагдац).";
                case ImpactConfidence.B:
                    return "Revit-ийн өгөгдлийн холбоо байна (tag, хэмжээс, хост, төрөл, өрөөний хил, MEP холболт) — гэвч өөрчлөлт үүнд ҮНЭХЭЭР нөлөөлсөн эсэх нь тодорхойгүй.";
                case ImpactConfidence.C:
                    return "Магадгүй харагдаж байна (харагдацын тохиргоо/шүүлтүүрээр) — crop, нуугдсан, хаагдсан байж болно.";
                default:
                    return "Сул таамаг: ангилал/хамаарлын ерөнхий таарц, шууд нотолгоо алга.";
            }
        }
    }

    public enum ImpactNodeKind
    {
        Element = 0,
        View,
        Sheet,
        Schedule,
        /// <summary>Хуудсанд байрласан харагдац (Viewport) эсвэл хүснэгт (ScheduleSheetInstance).</summary>
        Placement,
        Tag,
        Dimension,
        Room,
        Level,
        Type,
        Link,
        Group,
        /// <summary>Төслийн ерөнхий тохиргоо (Project Information, Revision, Phase, шүүлтүүр...) — олон хуудсанд нөлөөлж болно.</summary>
        Global,
    }

    public enum ChangeKind { Unknown = 0, Added, Modified, Deleted }

    /// <summary>Нэг элементийн ХУУЛСАН (detached) тайлбар — устсан ч харагдахын тулд.  Revit обьект ХАДГАЛАХГҮЙ.</summary>
    public sealed class ImpactNode
    {
        public long Id { get; set; }
        public ImpactNodeKind Kind { get; set; }
        public string Uid { get; set; }
        public string Category { get; set; }
        /// <summary>`BuiltInCategory`-ийн утга (хэлнээс үл хамаарна); 0 = мэдэгдэхгүй.</summary>
        public long CategoryId { get; set; }
        public string Name { get; set; }
        /// <summary>Хуудасны дугаар, төрлийн нэр, давхар гэх мэт товч тайлбар.</summary>
        public string Detail { get; set; }
        public long OwnerViewId { get; set; }
        public long HostId { get; set; }
        public long TypeId { get; set; }
        public long LevelId { get; set; }
        public bool ViewSpecific { get; set; }
        /// <summary>Устсан бөгөөд мэдээллийг өмнөөс бүртгээгүй (UniqueId, ангилал, холбоо мэдэгдэхгүй).</summary>
        public bool Unknown { get; set; }

        public string Label
        {
            get
            {
                if (Unknown && string.IsNullOrEmpty(Name)) return "Элемент #" + Id + " (мэдээлэл алга)";
                string n = !string.IsNullOrEmpty(Name) ? Name : (Category ?? "Элемент");
                string cat = !string.IsNullOrEmpty(Category) && !string.Equals(Category, n, StringComparison.Ordinal) ? Category + " · " : "";
                return cat + n + " · #" + Id;
            }
        }
    }

    /// <summary>Нэг элементээс нөгөө рүү «өөрчлөлт дамжих» холбоо — резольвер бүр ЭНЭ хэлбэрээр гаргана.</summary>
    public sealed class ImpactEdge
    {
        public long From { get; set; }
        public long To { get; set; }
        /// <summary>Тогтмол код: `view_owner`, `viewport_sheet`, `type_instances`, `dependent`, `visibility` ...</summary>
        public string Relationship { get; set; }
        public ImpactConfidence Confidence { get; set; }
        public string Reason { get; set; }
        /// <summary>Холбоог олсон резольверын нэр.</summary>
        public string Resolver { get; set; }
    }

    /// <summary>Шинжилгээний ЭХЛЭЛ — өөрчлөгдсөн элемент.</summary>
    public sealed class SourceChange
    {
        public long Id { get; set; }
        public ChangeKind Kind { get; set; }
        /// <summary>Энэ элементийн хамгийн сүүлийн өөрчлөлтийн дугаар.</summary>
        public long Seq { get; set; }
    }

    public sealed class ImpactLimits
    {
        /// <summary>
        /// Эх сурвалжаас хамгийн ихдээ хэдэн алхам (холбоос) гүнд.  6 = «төрөл → хана → өрөө → өрөөний tag → харагдац → хуудас» гэх
        /// хамгийн урт хэвийн гинжийг багтаана; цааш нь хэт таамаглал болно.
        /// </summary>
        public int MaxDepth { get; set; } = 6;
        /// <summary>Нийт зангилааны дээд хязгаар (санах ойн хамгаалалт).</summary>
        public int MaxNodes { get; set; } = 20000;
        /// <summary>Нэг зангилаанаас гарах холбооны дээд тоо — үүнээс олон бол хамгийн хүчтэйг нь л авна, ИЛ тэмдэглэнэ.</summary>
        public int MaxEdgesPerNode { get; set; } = 400;
        /// <summary>Нийт дэлгэх (expand) тоо.</summary>
        public int MaxExpansions { get; set; } = 60000;
    }

    /// <summary>Нэг зорилтод хүрэх ХАМГИЙН ХҮЧТЭЙ зам.</summary>
    public sealed class ImpactTarget
    {
        public long Id { get; set; }
        public ImpactConfidence Confidence { get; set; }
        public int Depth { get; set; }
        /// <summary>Замын эхлэл (өөрчлөгдсөн элемент).</summary>
        public long SourceId { get; set; }
        /// <summary>Эх сурвалжаас → зорилт хүртэл дарааллаар.</summary>
        public List<ImpactEdge> Path { get; set; } = new List<ImpactEdge>();
        /// <summary>Энэ зорилтод хүрэх ӨӨР зам (ялгаатай эх холбоос) хэд олдсон (дээд хязгаартай).</summary>
        public int PathCount { get; set; } = 1;
    }

    public sealed class ImpactGraph
    {
        public Dictionary<long, ImpactTarget> Targets { get; set; } = new Dictionary<long, ImpactTarget>();
        public int SourceCount { get; set; }
        public int Expanded { get; set; }
        public int EdgesSeen { get; set; }
        /// <summary>true = дараалал дууссан ба ямар ч хязгаар (зангилаа, дэлгэх, гүн, холбооны тоо) хэтрээгүй.</summary>
        public bool Complete { get; set; }
        /// <summary>Яагаад бүрэн биш вэ (товч): гүн, холбооны тоо, зангилаа, дэлгэх хязгаар, унасан дэлгэлт.</summary>
        public List<string> IncompleteReasons { get; set; } = new List<string>();
        public List<string> Notes { get; set; } = new List<string>();
    }

    /* ============================ ТАЙЛАН (UI, түүх) ========================= */

    public sealed class ImpactPathStepView
    {
        public string FromLabel { get; set; }
        public string ToLabel { get; set; }
        public string Relationship { get; set; }
        public ImpactConfidence Confidence { get; set; }
        public string Reason { get; set; }
        public string Resolver { get; set; }
    }

    /// <summary>Тайлангийн нэг мөр — нэг нөлөөлөгдсөн зүйл.  Шошго, зам нь ХУУЛСАН тэмдэгт (устсан ч харагдана).</summary>
    public sealed class ImpactItem
    {
        public long Id { get; set; }
        public string Uid { get; set; }
        public ImpactNodeKind Kind { get; set; }
        public string Name { get; set; }
        public string Detail { get; set; }
        public ImpactConfidence Confidence { get; set; }
        /// <summary>Эцсийн холбоо (зорилтод хүргэсэн).</summary>
        public string Relationship { get; set; }
        public string Reason { get; set; }
        public string Resolver { get; set; }
        public int Depth { get; set; }
        public long SourceId { get; set; }
        public string SourceLabel { get; set; }
        public ChangeKind SourceChange { get; set; }
        public int PathCount { get; set; }
        public List<ImpactPathStepView> Path { get; set; } = new List<ImpactPathStepView>();
        /// <summary>Хуудас/харагдац (UI-д нээх): хуудасны дугаар гэх мэт.</summary>
        public string SheetNumber { get; set; }
    }

    /// <summary>Шинжилгээний ДҮН — түүхэд хадгалагдаж, Smart Publish-д дамжина.</summary>
    public sealed class ImpactReport
    {
        public string Id { get; set; } = SmartHash.NewId();
        public DateTime Utc { get; set; }
        /// <summary>Шинжилсэн өөрчлөлтийн дугаарын муж (FromSeq-ээс ХОЙШХИ, ToSeq хүртэл).</summary>
        public long FromSeq { get; set; }
        public long ToSeq { get; set; }
        public RunStatus Status { get; set; }
        public int SourceCount { get; set; }
        public int Added { get; set; }
        public int Modified { get; set; }
        public int Deleted { get; set; }
        public List<ImpactItem> Items { get; set; } = new List<ImpactItem>();
        public List<string> Notes { get; set; } = new List<string>();
        public Dictionary<string, long> StageMs { get; set; } = new Dictionary<string, long>();
        public string ModelStamp { get; set; }
        /// <summary>Төслийн ерөнхий тохиргоо өөрчлөгдсөн (олон хуудсанд нөлөөлж болно).</summary>
        public bool HasGlobalChange { get; set; }
        /// <summary>Бүрэн БИШ (хязгаар хэтэрсэн, резольвер унасан, бүртгэлд цоорхой) — тайланг «бүгд» гэж ТООЦОХГҮЙ.</summary>
        public bool Incomplete { get; set; }
        /// <summary>Яагаад бүрэн биш вэ — `ImpactCompleteness.Reasons`.  `Incomplete == (IncompleteReasons.Count &gt; 0)`.</summary>
        public List<string> IncompleteReasons { get; set; } = new List<string>();
        /// <summary>Энэ мужид бүртгэлд цоорхой байж болзошгүй (trim, цэвэрлэсэн, унтраасан, handler алдсан).</summary>
        public bool LogGap { get; set; }
        /// <summary>Capture хэт олон id-тай багцыг эхний хэсгээр нь л бүртгэсэн багцын тоо (муж доторх).</summary>
        public int TruncatedBatches { get; set; }
        /// <summary>Устсан, мэдэгдэж буй загварын элемент — харагдац/хуудсыг ҮНДЭСЛЭХ боломжгүй.</summary>
        public int DeletedUnderivable { get; set; }
        /// <summary>Revit-ийн хувилбарын түүхээс (baseline GUID) нэмэлт өөрчлөлт амжилттай авсан.</summary>
        public bool BaselineUsed { get; set; }
        /// <summary>Baseline хүссэн ч унших боломжгүй байсан (GUID хүчингүй г.м.).</summary>
        public bool BaselineFailed { get; set; }
        /// <summary>
        /// Устсан бөгөөд мэдээллийг өмнөөс бүртгээгүй элементийн тоо — тэдний нөлөөллийг (аль харагдац, хуудсанд
        /// харагдаж байсныг) ТОДОРХОЙЛЖ ЧАДААГҮЙ.  Smart Publish «бүх хуудас»-ыг санал болгоно.
        /// </summary>
        public int UnresolvedDeleted { get; set; }
        /// <summary>Хэт олон/дараалал дүүрсэн тул бүртгэгдээгүй багцын тоо.</summary>
        public int DroppedBatches { get; set; }

        [JsonIgnore]
        public IEnumerable<ImpactItem> Sheets
        {
            get { return Items.Where(i => i.Kind == ImpactNodeKind.Sheet); }
        }
    }
}
