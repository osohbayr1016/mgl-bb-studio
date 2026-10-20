using System;
using System.Collections.Generic;
using System.Linq;
using RevitMcpAddin.ClashCheck.Core;
using RevitMcpAddin.Smart.Core;

namespace RevitMcpAddin.ChangeImpact.Core
{
    /* ====================================================================== */
    /*  CHANGE IMPACT RADAR — «ӨӨРЧЛӨХӨӨС ӨМНӨ ШАЛГАХ» домэйн загвар              */
    /*  (Revit-гүй ЦЭВЭР; тестлэгдэнэ.  Revit обьект ХЭЗЭЭ Ч хадгалахгүй.)         */
    /*                                                                        */
    /*  Үнэний ДӨРВӨН төлөв — «мэдэхгүй» нь ХЭЗЭЭ Ч итгэлтэй дүн болохгүй:        */
    /*    Confirmed    Revit-ээс ӨМНӨ/ДАРАА ялгааг ХЭМЖСЭН                       */
    /*    Review       Бодит хамаарал бий, гэхдээ «эвдэрсэн» гэж хэлэх нотолгоо алга */
    /*    NotEvaluated Одоогийн шинжилгээ энэ ангиллыг тооцоолж чадахгүй          */
    /*    Incomplete   Шинжилгээ хэсэгчлэн унасан/таслагдсан/линк ачаалаагүй       */
    /* ====================================================================== */

    public enum TruthState
    {
        /// <summary>Мэдэгдэхгүй утга → хамгийн аюулгүй нь `Incomplete` гэж ойлгогдоно (хэзээ ч «батлагдсан» биш).</summary>
        Unknown = 0,
        Confirmed,
        Review,
        NotEvaluated,
        Incomplete,
    }

    public static class Truth
    {
        public static TruthState Normalize(TruthState t)
        {
            return t == TruthState.Unknown ? TruthState.Incomplete : t;
        }

        public static string Label(TruthState t)
        {
            switch (Normalize(t))
            {
                case TruthState.Confirmed: return "Батлагдсан";
                case TruthState.Review: return "Хянах";
                case TruthState.NotEvaluated: return "Тооцоолоогүй";
                default: return "Бүрэн биш";
            }
        }
    }

    public enum PreChangeCategory
    {
        Unknown = 0,
        Failure,
        Room,
        Dimension,
        Hosted,
        Clearance,
        View,
        Sheet,
        Schedule,
        Clash,
        Egress,
        Norm,
        Model,
        /// <summary>Хаалга зөөх: хаалганы эргэн тойрны физик саад (багана, бүтэц, тавилга).</summary>
        Obstacle,
        /// <summary>Хаалга зөөх: хост ханан дээрх бусад нүх (хаалга, цонх) ба ханын төгсгөл.</summary>
        Opening,
    }

    /// <summary>Мөрийн ноцтой байдал — өнгөөр ГАНЦААРАА биш: UI-д тэмдэг + үг хамт.</summary>
    public enum ItemSeverity
    {
        /// <summary>🟢 Сайн мэдээ / өөрчлөлтгүй.</summary>
        Ok = 0,
        /// <summary>🟡 Анхаарах.</summary>
        Notice,
        /// <summary>🟠 Нөлөөлөл бодит.</summary>
        Warning,
        /// <summary>🔴 Ноцтой: хаалттай орон зай алга, шинэ clash, гарц боломжгүй, устах элемент.</summary>
        Critical,
    }

    /// <summary>
    /// Толгой дүгнэлт — ТОДОРХОЙЛОГДСОН (deterministic).  `Clean` нь ЗӨВХӨН идэвхтэй бүх шалгалт бүрэн дууссан, ямар ч
    /// дельта/хянах зүйл олдоогүй үед; бүрэн бус бол ХЭЗЭЭ Ч `Clean` биш.
    /// </summary>
    public enum AttentionLevel
    {
        /// <summary>Simulation унасан / Revit «боломжгүй» гэсэн / загвар сэргээгдээгүй.</summary>
        Blocked = 0,
        Critical,
        Review,
        Clean,
    }

    /// <summary>Sandbox-ийн дүн.</summary>
    public enum SandboxOutcome
    {
        Unknown = 0,
        /// <summary>Хөдөлгөөн Revit-д хүлээн зөвшөөрөгдсөн, загвар буцаагдсан.</summary>
        Simulated,
        /// <summary>Revit хөдөлгөөнийг (failure/exception) зөвшөөрөөгүй — загвар буцаагдсан.</summary>
        Blocked,
        /// <summary>Хөдөлгөөн эхлэхээс өмнө эх элемент хүчингүй (устсан, түгжигдсэн...) — юу ч хийгээгүй.</summary>
        Rejected,
        /// <summary>⚠️ Sandbox-ийн дараа загвар анхны төлөвт буцсан эсэхийг БАТЛАЖ ЧАДААГҮЙ.</summary>
        NotRestored,
        /// <summary>
        /// Хэрэгслийн ӨӨРИЙН алдаа (Revit хөдөлгөөнийг татгалзсан БИШ) — загвар буцаагдсан гэж батлагдсан, гэхдээ дүн гарсангүй.
        /// «Revit зөвшөөрөөгүй» (`Blocked`)-аас ЯЛГАХ ЁСТОЙ: нэгдүгээрт «зөөхгүй», хоёрдугаарт «дүгнэх боломжгүй».
        /// </summary>
        Faulted,
    }

    /// <summary>Preview эхлэхээс ӨМНӨ татгалзсан шалтгааны төрөл (`SandboxOutcome.Rejected`) — шийдвэр үүгээр ялгагдана.</summary>
    public enum RejectionKind
    {
        None = 0,
        /// <summary>Энэ ханыг шалгах чадваргүй (муруй, Stacked, налуу, группийн гишүүн...) → «дүгнэх боломжгүй».</summary>
        Unsupported,
        /// <summary>Revit энэ хөдөлгөөнийг ХИЙЛГЭХГҮЙ нь тодорхой (Pin, өөр хэрэглэгчийн эзэмшил, зөвхөн унших) → «зөөхгүй».</summary>
        Refused,
    }

    /// <summary>Шинжилгээний шат: `Quick` = түр дүн (гүн шалгалт хүлээгдэж байна), `Full` = эцсийн техникийн дүгнэлт.</summary>
    public enum AnalysisStage
    {
        Full = 0,
        Quick,
    }

    /* ============================== REQUEST / FINGERPRINT =================== */

    /// <summary>Хөдөлгөөний хүсэлт.  Вектор нь SI (мм) — Revit-ийн давхарга `UnitUtils`-ээр дотоод нэгж руу хөрвүүлнэ.</summary>
    public sealed class PreChangeRequest
    {
        public long SourceId { get; set; }
        public string SourceUid { get; set; }
        public string SourceLabel { get; set; }
        /// <summary>Хөдөлгөөний ЗАЙ (мм) — эерэг.</summary>
        public double DistanceMm { get; set; }
        /// <summary>Хөдөлгөөний чиглэлийн нэгж вектор (XY, хавтгай).  Z = 0.</summary>
        public double DirX { get; set; }
        public double DirY { get; set; }
        /// <summary>«Коридор тал руу» / «A тал руу» — хүнд харагдах чиглэл.</summary>
        public string SideLabel { get; set; }
        /// <summary>Сонгосон тал (0 = A, 1 = B) — preview хийсэн тал баталгаажихын тулд.</summary>
        public int SideIndex { get; set; }

        /// <summary>Үйлдлийн төрөл.  Анхдагч = хана зөөх (өмнөх бүх код хэвээр).</summary>
        public PreChangeOperationKind Operation { get; set; }

        /* ---- DoorMove: ЗӨВХӨН хаалганы үйлдэлд.  `SourceId` = хаалга; `DirX/DirY` = (хостын чиглэл × offset-ийн тэмдэг), `DistanceMm` = |offset|. ---- */
        /// <summary>Хаалганы хост хана (preview хийх үед) — Apply-д хост солигдоогүй эсэхийг шалгана.</summary>
        public long HostId { get; set; }
        public string HostUid { get; set; }
        /// <summary>Хостын чиглэл (нэгж вектор, XY).  `OffsetMm` нь энэ тэнхлэгийн дагуух ТЭМДЭГТЭЙ зай.</summary>
        public double TangentX { get; set; }
        public double TangentY { get; set; }
        /// <summary>Хаалганы төвийг хостын дагуу зөөх ТЭМДЭГТЭЙ зай (мм).  Эерэг = хостын чиглэлд.</summary>
        public double OffsetMm { get; set; }

        /// <summary>Хөдөлгөөний вектор (мм) = чиглэл × зай.</summary>
        public double[] VectorMm
        {
            get { return new[] { DirX * DistanceMm, DirY * DistanceMm, 0.0 }; }
        }
    }

    /// <summary>Хүсэлтийг шалгах — буруу/хоосон/хэт өндөр утгыг цэвэр логикоор татгалзана.</summary>
    public static class PreChangeRequestRules
    {
        /// <summary>Хөдөлгөөний дээд зай (мм) — тайлбарлах боломжтой хязгаар; 100 м-ээс дээш нь утгагүй (бичлэгийн алдаа).</summary>
        public const double MaxDistanceMm = 100000;

        public static string Validate(PreChangeRequest r)
        {
            if (r == null) return "Хүсэлт хоосон.";
            if (r.SourceId <= 0) return r.Operation == PreChangeOperationKind.DoorMove ? "Хаалга сонгоогүй байна." : "Хана сонгоогүй байна.";
            if (r.Operation == PreChangeOperationKind.DoorMove)
            {
                if (r.HostId <= 0) return "Хаалганы хост хана тодорхойгүй байна.";
                if (double.IsNaN(r.OffsetMm) || double.IsInfinity(r.OffsetMm)) return "Зайн утга буруу.";
                if (Math.Abs(r.OffsetMm) <= PreChangeTolerance.LengthMm) return "Хаалга одоогийн байрлалдаа байна — зөөх зайг оруулна уу.";
                if (Math.Abs(r.OffsetMm) > MaxDistanceMm) return "Зөөх зай хэт их (" + (int)MaxDistanceMm + " мм-ээс бага байх ёстой).";
                double tn = Math.Sqrt(r.TangentX * r.TangentX + r.TangentY * r.TangentY);
                if (tn < 0.5 || double.IsNaN(tn)) return "Хостын чиглэл тодорхойгүй.";
                // Вектор (чиглэл × зай) нь тэмдэгтэй offset × хостын чиглэлтэй таарах ёстой — таарахгүй бол хүсэлт дотроо зөрсөн.
                double vx = r.DirX * r.DistanceMm, vy = r.DirY * r.DistanceMm, ex = r.TangentX / tn * r.OffsetMm, ey = r.TangentY / tn * r.OffsetMm;
                if (Math.Abs(vx - ex) > 2 * PreChangeTolerance.LengthMm || Math.Abs(vy - ey) > 2 * PreChangeTolerance.LengthMm) return "Хөдөлгөөний чиглэл хостын дагуу биш байна.";
                return null;
            }
            if (double.IsNaN(r.DistanceMm) || double.IsInfinity(r.DistanceMm)) return "Зайн утга буруу.";
            if (r.DistanceMm <= PreChangeTolerance.LengthMm) return "Зөөх зай 0-ээс их байх ёстой (мм-ээр бичнэ үү).";
            if (r.DistanceMm > MaxDistanceMm) return "Зөөх зай хэт их (" + (int)MaxDistanceMm + " мм-ээс бага байх ёстой).";
            double n = Math.Sqrt(r.DirX * r.DirX + r.DirY * r.DirY);
            if (n < 0.5 || double.IsNaN(n)) return "Хөдөлгөөний чиглэл тодорхойгүй — хананы талыг сонгоно уу.";
            return null;
        }

        /// <summary>
        /// Хэрэглэгчийн бичсэн зайг (мм) уншина: «300», «300 мм», «300mm», «0,3 м», «0.3 m».  Хоосон/сөрөг/тэг/буруу → null.
        /// «м»/«m» дагавартай бол метр (мм-д хөрвүүлнэ).  Таслал аравтын таслал гэж ойлгогдоно.
        /// </summary>
        public static double? ParseDistanceMm(string text)
        {
            if (string.IsNullOrWhiteSpace(text)) return null;
            string s = text.Trim().ToLowerInvariant().Replace(',', '.').Replace(" ", "");
            double factor = 1.0;
            if (s.EndsWith("мм") || s.EndsWith("mm")) s = s.Substring(0, s.Length - 2);
            else if (s.EndsWith("см") || s.EndsWith("cm")) { s = s.Substring(0, s.Length - 2); factor = 10.0; }
            else if (s.EndsWith("м") || s.EndsWith("m")) { s = s.Substring(0, s.Length - 1); factor = 1000.0; }
            double v;
            if (!double.TryParse(s, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out v)) return null;
            if (double.IsNaN(v) || double.IsInfinity(v) || v <= 0) return null;
            return v * factor;
        }
    }

    /// <summary>
    /// Preview-ийн «хурууны хээ» — Apply дарах мөчид preview хуучирсан эсэхийг шийдэхэд.  Зөвхөн энгийн утга.
    /// </summary>
    public sealed class PreChangeFingerprint
    {
        public string DocumentId { get; set; }
        public string SourceUid { get; set; }
        public long SourceId { get; set; }
        /// <summary>Эх элементийн байрлал (мм): [x1,y1,z1,x2,y2,z2] (шугаман хана) — хүлцэлд квантлагдсан.</summary>
        public double[] Location { get; set; }
        public long TypeId { get; set; }
        /// <summary>`ModelChangeCounter.Stamp` — загварт ЯМАР Ч бодит өөрчлөлт орсон эсэх.</summary>
        public string ModelStamp { get; set; }
        /// <summary>Хөдөлгөөний вектор (мм).</summary>
        public double[] VectorMm { get; set; }
        /// <summary>Хамаарлын (хост, хавсаргасан, нэр дэвшигч өрөө) хэш — эх сурвалжийн ойролцоох бүтэц өөрчлөгдсөн эсэх.</summary>
        public string DependencyHash { get; set; }
        /// <summary>Линкийн ачаалагдсан байдал + transform + файлын хугацааны хэш (`DocumentChanged`-д ордоггүй тул `ModelStamp` ганцаараа барьж чадахгүй).</summary>
        public string LinkSignature { get; set; }
        /// <summary>Гарцын тохиргооны хэш — хэрэглэгч гарц өөрчилбөл preview хуучирна.</summary>
        public string ConfigSignature { get; set; }
        /// <summary>Хана одоо ч байгаа эсэх, засах боломжтой эсэх (Apply-ийн үед шинэчилнэ).</summary>
        public bool SourceExists { get; set; } = true;
    }

    /* ============================== SNAPSHOTS =============================== */

    public sealed class ElementPlace
    {
        public long Id { get; set; }
        public string Uid { get; set; }
        public string Name { get; set; }
        public string Category { get; set; }
        /// <summary>Байрлал (мм) — цэг: [x,y,z]; шугам: [x1,y1,z1,x2,y2,z2].  null = байрлалгүй/уншигдаагүй.</summary>
        public double[] Location { get; set; }
    }

    public sealed class RoomSnap
    {
        public long Id { get; set; }
        public string Uid { get; set; }
        public string Number { get; set; }
        public string Name { get; set; }
        public string Phase { get; set; }
        public string Level { get; set; }
        /// <summary>Хуваарилагдсан (Location != null).  false = «Not Placed» (өрөө хуваарилагдаагүй).</summary>
        public bool Placed { get; set; }
        /// <summary>Хаалттай орон зай (Area &gt; 0).  Placed &amp;&amp; !Enclosed = «Not Enclosed».</summary>
        public bool Enclosed { get; set; }
        public double AreaM2 { get; set; }
        public double? PerimeterM { get; set; }
        /// <summary>Уншигдсан эсэх.  false бол талбай нь «0» БИШ, мэдэгдэхгүй.</summary>
        public bool Readable { get; set; } = true;
        /// <summary>Эх сурвалж (хана) өрөөний хилийг үүсгэж байгаа (GetBoundarySegments).</summary>
        public bool BoundedBySource { get; set; }

        public string Label
        {
            get
            {
                string n = ((Number ?? "") + " " + (Name ?? "")).Trim();
                return string.IsNullOrEmpty(n) ? "Өрөө #" + Id : n;
            }
        }
    }

    public sealed class DimSnap
    {
        public long Id { get; set; }
        public string Uid { get; set; }
        public string Name { get; set; }
        public long OwnerViewId { get; set; }
        public string ViewName { get; set; }
        /// <summary>Сегмент бүрийн утга (мм).  Ганц сегменттэй хэмжээсэд нэг утга.</summary>
        public List<double> SegmentsMm { get; set; } = new List<double>();
        /// <summary>Тоон утга уншигдсан эсэх (spot/дуртай хэмжээс, null `Value` → false).</summary>
        public bool Readable { get; set; }
        public string UnreadableReason { get; set; }

        public string Label
        {
            get
            {
                string n = string.IsNullOrEmpty(Name) ? "Хэмжээс" : Name;
                return n + (string.IsNullOrEmpty(ViewName) ? "" : " · " + ViewName) + " · #" + Id;
            }
        }
    }

    public sealed class HostedSnap
    {
        public long Id { get; set; }
        public string Uid { get; set; }
        public string Name { get; set; }
        public string Category { get; set; }
        public bool Exists { get; set; } = true;
        /// <summary>Хостын id (`FamilyInstance.Host`).  `HostKnown=false` бол уншигдаагүй — «хостоо алдсан» гэж ТООЦОХГҮЙ.</summary>
        public long HostId { get; set; }
        public bool HostKnown { get; set; }
        /// <summary>[x,y,z] мм.  null = байрлалгүй.</summary>
        public double[] LocationMm { get; set; }
        public long FromRoomId { get; set; }
        public long ToRoomId { get; set; }
        public string FromRoomName { get; set; }
        public string ToRoomName { get; set; }
        public bool RoomsReadable { get; set; }
        /// <summary>Хаалганы орчны зай (мм) — хамгийн ойрын саад хүртэл (3D харагдацын ray-аар).  null = тооцоогүй.</summary>
        public double? ClearanceMm { get; set; }
        public bool ClearanceEvaluated { get; set; }
        public string ClearanceNote { get; set; }
        /// <summary>Хаалганы эргэлт (`FacingFlipped`/`HandFlipped`) уншигдсан эсэх — `false` бол «өөрчлөгдөөгүй» гэж ТООЦОХГҮЙ.</summary>
        public bool FlipKnown { get; set; }
        public bool FacingFlipped { get; set; }
        public bool HandFlipped { get; set; }
        /// <summary>Хаалганы тэмдэглэгээ (Mark) — «D-120».  Хоосон бол төрлийн нэр хэрэглэгдэнэ.</summary>
        public string Mark { get; set; }

        public string Label
        {
            get { return (string.IsNullOrEmpty(Name) ? (Category ?? "Элемент") : Name) + " · #" + Id; }
        }
    }

    public sealed class ScheduleSnap
    {
        public long Id { get; set; }
        public string Name { get; set; }
        /// <summary>Хүснэгтийн мөрийг (элементээр) шалгаж чадсан.  false = «мэдэхгүй», «хоосон» БИШ.</summary>
        public bool Evaluated { get; set; }
        public HashSet<long> Members { get; set; } = new HashSet<long>();
    }

    public sealed class ClashPairState
    {
        public string Key { get; set; }
        public long OtherId { get; set; }
        public string OtherLabel { get; set; }
        public string OtherLink { get; set; }
        /// <summary>Нөгөө элемент линк загвар доторх бол линкийн instance-ийн id (host-ын).  «Харуулах» нь линкийг сонгоно — линк доторх элементийг Revit-д шууд сонгох боломжгүй.</summary>
        public long OtherLinkInstanceId { get; set; }
        public ClashVerdict Verdict { get; set; }
        public double VolumeCm3 { get; set; }
        public string Reason { get; set; }
        /// <summary>Нөгөө элементийн ТӨРӨЛ (Revit-ийн BuiltInCategory-аас Revit давхарга тодорхойлсон) — хаалганы шийдвэр (багана → ноцтой, тавилга → хянах) үүгээр ялгана.</summary>
        public ObstacleKind OtherKind { get; set; }
    }

    public sealed class ClashSnap
    {
        /// <summary>Clash шалгалтыг ЭНЭ snapshot-д хийсэн (MEP нэр дэвшигч, геометр).</summary>
        public bool Evaluated { get; set; }
        /// <summary>Шалгалт бүрэн (линк бүгд ачаалагдсан, геометр алдаагүй, хязгаар хэтрээгүй).</summary>
        public bool Complete { get; set; }
        public List<string> IncompleteReasons { get; set; } = new List<string>();
        public string NotEvaluatedReason { get; set; }
        public Dictionary<string, ClashPairState> Pairs { get; set; } = new Dictionary<string, ClashPairState>(StringComparer.Ordinal);
    }

    public sealed class EgressRoute
    {
        public long RoomId { get; set; }
        public string RoomName { get; set; }
        /// <summary>Хамгийн ойрын гарц хүртэлх зам (м).  null = зам ОЛДСОНГҮЙ (боломжгүй).</summary>
        public double? LengthM { get; set; }
        /// <summary>Замыг тооцоолсон (эхлэх цэг олдсон, Revit сервис хариулсан).  false → «тооцоогүй», 0 БИШ.</summary>
        public bool Evaluated { get; set; }
        public string Note { get; set; }
    }

    public sealed class EgressSnap
    {
        public bool Configured { get; set; }
        public bool Evaluated { get; set; }
        public string NotEvaluatedReason { get; set; }
        public List<string> IncompleteReasons { get; set; } = new List<string>();
        public Dictionary<long, EgressRoute> Routes { get; set; } = new Dictionary<long, EgressRoute>();
    }

    /// <summary>Revit-ийн failure/анхааруулга (preprocessor-оор цуглуулсан).</summary>
    public sealed class FailureNote
    {
        public bool IsError { get; set; }
        public string Text { get; set; }
        public List<long> ElementIds { get; set; } = new List<long>();
    }

    /// <summary>Нэг төлөвийн (ӨМНӨ эсвэл ДАРАА) ХУУЛСАН хуурамчгүй snapshot — Revit обьектгүй.</summary>
    public sealed class StateSnapshot
    {
        public bool Captured { get; set; }
        /// <summary>Эх хана (`CaptureSpec.WallId`) энэ төлөвт загварт ОЛДСОНГҮЙ.  ДАРАА төлөвт = «хана өөрөө алга болно» (батлагдсан ноцтой).</summary>
        public bool SourceDeleted { get; set; }
        public ElementPlace Source { get; set; }
        public Dictionary<long, RoomSnap> Rooms { get; set; } = new Dictionary<long, RoomSnap>();
        public Dictionary<long, DimSnap> Dimensions { get; set; } = new Dictionary<long, DimSnap>();
        public Dictionary<long, HostedSnap> Hosted { get; set; } = new Dictionary<long, HostedSnap>();
        /// <summary>Холбогдсон (join) хөрш ханууд — location өөрчлөгдсөн эсэх.</summary>
        public Dictionary<long, ElementPlace> Joined { get; set; } = new Dictionary<long, ElementPlace>();
        public Dictionary<long, ScheduleSnap> Schedules { get; set; } = new Dictionary<long, ScheduleSnap>();
        public ClashSnap Clash { get; set; } = new ClashSnap();
        public EgressSnap Egress { get; set; } = new EgressSnap();
        public List<string> CaptureNotes { get; set; } = new List<string>();
        /// <summary>Capture-ийн явцад алдаа/хязгаар (чимээгүй алгасалгүй) — тайланд «бүрэн биш» шалтгаан болно.</summary>
        public List<string> IncompleteReasons { get; set; } = new List<string>();
        /// <summary>Шийдвэрт НӨЛӨӨЛӨХГҮЙ дутуу байдал (хүснэгтийн шүүлт зэрэг) — «ЗӨӨЖ БОЛНО»-г «ХЯНААД ЗӨӨ» болгоно, «ДҮГНЭХ БОЛОМЖГҮЙ» болгохгүй.</summary>
        public List<string> AdvisoryReasons { get; set; } = new List<string>();
        /// <summary>Revit хөдөлгөөний үед УСТГАСАН элементийн id (DocumentChanged).</summary>
        public List<long> DeletedIds { get; set; } = new List<long>();
        public int ModifiedCount { get; set; }
    }

    /* ============================== DEPENDENCIES (view/sheet/schedule) ====== */

    public sealed class DepNode
    {
        public long Id { get; set; }
        public string Uid { get; set; }
        public string Name { get; set; }
        public string Detail { get; set; }
        public ImpactNodeKind Kind { get; set; }
        public ImpactConfidence Confidence { get; set; }
        /// <summary>Яагаад холбоотой вэ — ХАМГИЙН СУЛ холбоосын шалтгаан (ImpactExplainer-ийн хэв маяг).</summary>
        public string Reason { get; set; }
        public int PathCount { get; set; } = 1;
        public string SheetNumber { get; set; }
        /// <summary>Харагдацын төрөл (`ViewType` нэр) — «section», «plan» гэж тоолоход.</summary>
        public string ViewType { get; set; }
        /// <summary>Энэ харагдац/хүснэгт/placement ямар хуудсанд байрласан.</summary>
        public List<long> SheetIds { get; set; } = new List<long>();
    }

    /// <summary>
    /// Эх сурвалжаас БОДИТ холбоогоор (ImpactGraph) хүрсэн харагдац, хуудас, хүснэгт, tag, хэмжээс.
    /// «Хянах» (REVIEW) мөрүүдийн эх — «эвдэрсэн» гэж ХЭЗЭЭ Ч хэлэхгүй.
    /// </summary>
    public sealed class PreChangeDependencies
    {
        public List<DepNode> Views { get; set; } = new List<DepNode>();
        public List<DepNode> Sheets { get; set; } = new List<DepNode>();
        public List<DepNode> Schedules { get; set; } = new List<DepNode>();
        public List<DepNode> Tags { get; set; } = new List<DepNode>();
        /// <summary>Хэмжээсийн нэр дэвшигч id (graph-аас).</summary>
        public List<long> DimensionIds { get; set; } = new List<long>();
        /// <summary>Графын бүрэн БИШ шалтгаан (хязгаар, резольвер уналт, уншигдаагүй холбоос) — ШААРДЛАГАТАЙ шалгалтын дутагдал.</summary>
        public List<string> IncompleteReasons { get; set; } = new List<string>();
        /// <summary>Шийдвэрт нөлөөлөхгүй, зөвхөн «хянах»-ыг шаарддаг дутагдал (харагдалтын хязгаар).</summary>
        public List<string> AdvisoryReasons { get; set; } = new List<string>();
        public List<string> Notes { get; set; } = new List<string>();
        /// <summary>Харагдалтыг (C) шалгасан эсэх.  false = «хуудас/харагдац олдсонгүй» гэж ТООЦОХГҮЙ.</summary>
        public bool VisibilityChecked { get; set; }
        /// <summary>Эх сурвалж ДАРААХ төлөвт (хөдөлсний дараа) шинээр харагдах харагдацыг ч шалгасан.</summary>
        public bool AfterVisibilityChecked { get; set; }
    }

    /* ============================== REPORT ================================== */

    public sealed class PreChangeItem
    {
        public string Key { get; set; }
        /// <summary>Машин уншигдах код (`ItemCodes`) — шийдвэрийн хөдөлгүүр ТЕКСТЭЭР БИШ кодоор шийднэ.</summary>
        public string Code { get; set; }
        /// <summary>Хүнд харагдах нэг хэллэг: өрөөний нэр, clash-ийн нөгөө элемент, хаалганы нэр...</summary>
        public string Subject { get; set; }
        public PreChangeCategory Category { get; set; }
        public TruthState Truth { get; set; }
        public ItemSeverity Severity { get; set; }
        public string Title { get; set; }
        public string Before { get; set; }
        public string After { get; set; }
        public string Delta { get; set; }
        /// <summary>Яагаад — хүнд ойлгомжтой нэг-хоёр өгүүлбэр.</summary>
        public string Why { get; set; }
        public long Id { get; set; }
        public string Uid { get; set; }
        public ImpactNodeKind Kind { get; set; }
        /// <summary>Хянах (Review) мөрийн холбоосын итгэл (A–D).  Батлагдсан мөрөнд Unknown.</summary>
        public ImpactConfidence Confidence { get; set; }
        public string SheetNumber { get; set; }
        /// <summary>Машин уншигдах утгууд (тест, apply-ийн баталгаажуулалт).</summary>
        public double? BeforeValue { get; set; }
        public double? AfterValue { get; set; }
        public double? DeltaValue { get; set; }
        public string ViewType { get; set; }
        /// <summary>Хаалга зөөх: дэлгэцийн тодруулгад (хайрцаг) холбох түлхүүр (`ObstacleBox.Key` = `линк:id`).  null = хайрцаггүй.</summary>
        public string TargetKey { get; set; }
        /// <summary>«Харуулах» боломжтой (Revit-д нээж/сонгож болох).</summary>
        public bool CanShow { get { return Id > 0 && Kind != ImpactNodeKind.Global; } }
    }

    /// <summary>Аль шалгалт ҮНЭХЭЭР хийгдэж дууссан бэ — карт «0» гэж үнэмлэхгүй, «тооцоогүй» гэж хэлэхэд.</summary>
    public sealed class PreChangeCoverage
    {
        public bool RoomsChecked { get; set; }
        public bool DimensionsChecked { get; set; }
        public bool ViewsChecked { get; set; }
        public bool SchedulesChecked { get; set; }
        public bool ClashEvaluated { get; set; }
        public bool ClashComplete { get; set; }
        public bool EgressConfigured { get; set; }
        public bool EgressEvaluated { get; set; }
    }

    public sealed class PreChangeReport
    {
        public PreChangeCoverage Coverage { get; set; } = new PreChangeCoverage();
        /// <summary>`Quick` = түр дүн (гүн шалгалт дуусаагүй) — ХЭЗЭЭ Ч ногоон эцсийн дүгнэлт биш.</summary>
        public AnalysisStage Stage { get; set; }
        /// <summary>Quick шатанд хараахан тооцоогүй гүн шалгалтууд («MEP», «Гарц», «Хуудас»...).</summary>
        public List<string> PendingChecks { get; set; } = new List<string>();
        public RejectionKind Rejection { get; set; }
        /// <summary>Шийдвэрийг «ДҮГНЭХ БОЛОМЖГҮЙ» болгох ШААРДЛАГАТАЙ шалгалтуудын дутагдал.</summary>
        public List<string> RequiredIncomplete { get; set; } = new List<string>();
        /// <summary>Зөвхөн «хянах» шаарддаг дутагдал.</summary>
        public List<string> AdvisoryIncomplete { get; set; } = new List<string>();
        /// <summary>Нөлөөлөгдөх ДАВХАРДАЛГҮЙ хуудасны тоо (харагдац, хүснэгтээр дамжин хүрсэн хуудас нэгдсэн).</summary>
        public int DistinctSheetCount { get; set; }
        public string Id { get; set; } = SmartHash.NewId();
        public DateTime Utc { get; set; }
        public string DocumentTitle { get; set; }
        public PreChangeRequest Request { get; set; }
        public SandboxOutcome Outcome { get; set; }
        public AttentionLevel Level { get; set; }
        public List<string> BlockReasons { get; set; } = new List<string>();
        public List<PreChangeItem> Items { get; set; } = new List<PreChangeItem>();
        public List<string> IncompleteReasons { get; set; } = new List<string>();
        public List<string> Notes { get; set; } = new List<string>();
        public Dictionary<string, long> StageMs { get; set; } = new Dictionary<string, long>();
        public PreChangeFingerprint Fingerprint { get; set; }
        /// <summary>Sandbox-ийн ДАРАА snapshot — Apply-ийн бодит үр дүнтэй харьцуулахад.</summary>
        public StateSnapshot After { get; set; }
        public StateSnapshot Before { get; set; }

        public bool Incomplete { get { return IncompleteReasons.Count > 0; } }
        public bool IsBlocked { get { return Level == AttentionLevel.Blocked; } }
        public bool CanApply { get { return Outcome == SandboxOutcome.Simulated && Level != AttentionLevel.Blocked; } }

        public IEnumerable<PreChangeItem> Of(PreChangeCategory c)
        {
            return Items.Where(i => i.Category == c);
        }
    }

    /// <summary>Apply-ийн дүн.</summary>
    public enum ApplyStatus
    {
        Unknown = 0,
        /// <summary>Хэрэгжсэн, preview-тэй таарсан (баталгаажсан).</summary>
        AppliedVerified,
        /// <summary>Хэрэгжсэн, гэхдээ preview-тэй харьцуулах боломжгүй/хэсэгчлэн (баталгаажуулж чадаагүй).</summary>
        AppliedUnverified,
        /// <summary>Preview хуучирсан — Apply хийгээгүй, дахин шалгах хэрэгтэй.</summary>
        Stale,
        /// <summary>Бодит үр дүн preview-ээс МАТЕРИАЛЛАГ ялгаатай — буцаасан (commit хийгээгүй).</summary>
        RolledBackMismatch,
        /// <summary>Revit хөдөлгөөнийг зөвшөөрөөгүй / алдаа — загвар өөрчлөгдөөгүй.</summary>
        Failed,
        Cancelled,
    }

    public sealed class ApplyOutcome
    {
        public ApplyStatus Status { get; set; }
        public string Message { get; set; }
        public List<string> Details { get; set; } = new List<string>();
        /// <summary>Баталгаажуулалтад тулгасан хэсгүүд («өрөө», «хэмжээс»...).</summary>
        public List<string> Compared { get; set; } = new List<string>();
        public List<string> NotCompared { get; set; } = new List<string>();
        /// <summary>⚠️ Буцаалтын дараа загвар анхны төлөвт буцсаныг БАТЛАЖ ЧАДААГҮЙ — хэрэглэгч Revit-д Ctrl+Z-ээр шалгах ёстой.</summary>
        public bool ModelMayBeModified { get; set; }
        public bool Moved
        {
            get { return Status == ApplyStatus.AppliedVerified || Status == ApplyStatus.AppliedUnverified; }
        }
    }
}
