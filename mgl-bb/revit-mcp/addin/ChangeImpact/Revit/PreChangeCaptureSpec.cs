using System;
using System.Collections.Generic;
using RevitMcpAddin.ChangeImpact.Core;
using RevitMcpAddin.ClashCheck;

namespace RevitMcpAddin.ChangeImpact
{
    internal sealed class ScheduleRef
    {
        public long Id;
        public string Name;
    }

    internal sealed class ClashCand
    {
        public long ElementId;
        /// <summary>-1 = host; бусад нь `ClashSpec.Slots` индекс.</summary>
        public int Slot = -1;
        /// <summary>Нэр дэвшигчийн төрөл — «Хаалга зөөх» дээр шийдвэрийн ангилал (бүтэц 🔴, тавилга 🟠, MEP 🔴).  Хана зөөхөд `Mep`.</summary>
        public ObstacleKind Kind = ObstacleKind.Mep;
    }

    /// <summary>MEP clash-ийн нэр дэвшигчид (хөдөлгөөний ХАМГИЙН ӨРГӨН хүрээнд — өмнөх ∪ дараах) — ӨМНӨ/ДАРАА ИЖИЛ хос.</summary>
    internal sealed class ClashSpec
    {
        public List<ClashCand> Cands = new List<ClashCand>();
        public List<LinkSlot> Slots = new List<LinkSlot>();
        public List<string> IncompleteReasons = new List<string>();
        public string NotEvaluatedReason;
    }

    internal sealed class ExitRef
    {
        public long Id;
        public string Uid;
        public string Name;
        public long LevelId;
    }

    internal sealed class EgressRoomRef
    {
        public long RoomId;
        public long LevelId;
        public string Name;
    }

    internal sealed class EgressLevelPlan
    {
        public long LevelId;
        public string LevelName;
        public long ViewId;
        public string Problem;
    }

    internal sealed class EgressSpec
    {
        public bool Configured;
        public string NotEvaluatedReason;
        public List<ExitRef> Exits = new List<ExitRef>();
        public List<EgressRoomRef> Rooms = new List<EgressRoomRef>();
        public List<EgressLevelPlan> Levels = new List<EgressLevelPlan>();
        public List<string> IncompleteReasons = new List<string>();
    }

    /// <summary>
    /// Нэг preview/apply-д ӨМНӨ ба ДАРАА snapshot АДИЛХАН нэр дэвшигчээр уншигдахын тулд ГАНЦ удаа (Step хооронд) бэлдсэн ХУУЛСАН id-ууд.
    /// ⚠️ Revit обьект ХАДГАЛАХГҮЙ.
    /// </summary>
    internal sealed class CaptureSpec
    {
        /// <summary>Үйлдэл: хана зөөх эсвэл хаалга зөөх.  Захиалсан элемент (`SourceId`) хана эсвэл хаалга.</summary>
        public PreChangeOperationKind Operation;
        /// <summary>ЗӨӨГДӨХ элемент (хана эсвэл хаалга).</summary>
        public long SourceId;
        public string SourceUid;
        /// <summary>Өрөөний хил (`GetBoundarySegments`) дотор хайх элемент: хана зөөхөд хана өөрөө, хаалга зөөхөд ХОСТ хана.</summary>
        public long BoundaryId;
        public double[] VectorMm;
        public List<long> RoomIds = new List<long>();
        public List<long> DimIds = new List<long>();
        public List<long> HostedIds = new List<long>();
        public List<long> JoinedIds = new List<long>();
        public List<ScheduleRef> Schedules = new List<ScheduleRef>();
        public List<long> ScheduleCandidateIds = new List<long>();
        public ClashSpec Clash;
        public EgressSpec Egress;
        /// <summary>Хаалганы орчны зай хэмжих 3D харагдац (0 = олдсонгүй).</summary>
        public long Clearance3dViewId;
        public string ClearanceProblem;
        /// <summary>Хөдөлсний дараа шинээр харагдах харагдацыг шалгах нэр дэвшигч харагдацууд (өмнө нь харагдаагүй).</summary>
        public List<long> AfterVisibilityViews = new List<long>();
        public HashSet<long> VisibleBeforeViews = new HashSet<long>();
        /// <summary>Capture-ийн явцад цуглуулсан ШААРДЛАГАТАЙ шалгалтын дутагдал (өрөө, хаалга/цонх, MEP, гарц) — шийдвэрийг «ДҮГНЭХ БОЛОМЖГҮЙ» болгоно.</summary>
        public List<string> IncompleteReasons = new List<string>();
        /// <summary>Шийдвэрийг «ХЯНААД ЗӨӨ» хүртэл л бууруулах дутагдал (холбогдсон хөрш ханын хязгаар...).</summary>
        public List<string> AdvisoryReasons = new List<string>();
        public List<string> Notes = new List<string>();
    }

    /// <summary>Зайнаас ХАМААРАХГҮЙ хөдөлгөөнгүй байрлал — хаалттай биш өрөөний индекс (бүх өрөөг дахин скан хийхгүйн тулд кэшлэгдэнэ).</summary>
    internal sealed class UnenclosedRoomIndex
    {
        public List<long> Ids = new List<long>();
        /// <summary>Өрөөний байрлалын цэг (дотоод нэгж, фут): [x, y].</summary>
        public List<double[]> Points = new List<double[]>();
        public List<string> Notes = new List<string>();
    }
}
