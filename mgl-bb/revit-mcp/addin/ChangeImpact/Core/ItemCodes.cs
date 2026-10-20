namespace RevitMcpAddin.ChangeImpact.Core
{
    /// <summary>
    /// `PreChangeItem.Code` — МАШИН уншигдах мөрийн төрөл.  Шийдвэрийн хөдөлгүүр (`PreChangeDecisionEngine`) мөрийг ГАРЫН ТЕКСТЭЭР (`Title`, `Why`)
    /// биш ЭНЭ кодоор ялгана — Монгол хэллэгийг засахад шийдвэр чимээгүй өөрчлөгдөхгүй.
    /// </summary>
    public static class ItemCodes
    {
        public const string Blocked = "blocked";
        public const string FailureError = "failure.error";
        public const string FailureWarning = "failure.warning";
        public const string ModelDeleted = "model.deleted";
        public const string SourceMissing = "source.missing";

        public const string RoomRemoved = "room.removed";
        public const string RoomCreated = "room.created";
        public const string RoomUnenclosed = "room.unenclosed";
        public const string RoomEnclosed = "room.enclosed";
        public const string RoomArea = "room.area";

        public const string DimDeleted = "dim.deleted";
        public const string DimReview = "dim.review";
        public const string DimChanged = "dim.changed";
        public const string DimUnchanged = "dim.unchanged";

        public const string HostDeleted = "host.deleted";
        public const string HostLost = "host.lost";
        public const string HostMoved = "host.moved";
        public const string HostDisplaced = "host.displaced";
        public const string HostRooms = "host.rooms";
        public const string JoinedMoved = "joined.moved";

        public const string ClearanceChanged = "clearance.changed";
        public const string ClearanceNe = "clearance.ne";

        public const string View = "view";
        public const string Sheet = "sheet";
        public const string Tags = "tags";
        public const string ScheduleChanged = "schedule.changed";
        public const string ScheduleReview = "schedule.review";
        public const string ScheduleNe = "schedule.ne";

        public const string ClashNew = "clash.new";
        public const string ClashOld = "clash.old";
        public const string ClashUnknown = "clash.unknown";
        public const string ClashResolved = "clash.resolved";
        public const string ClashNone = "clash.none";
        public const string ClashIncomplete = "clash.incomplete";
        public const string ClashNe = "clash.ne";

        public const string EgressNotConfigured = "egress.notconfigured";
        public const string EgressNe = "egress.ne";
        public const string EgressLost = "egress.lost";
        public const string EgressGained = "egress.gained";
        public const string EgressUnreachable = "egress.unreachable";
        public const string EgressChanged = "egress.changed";

        public const string NormNe = "norm.ne";

        /* ---- Хаалга зөөх (DoorMove) ---- */
        /// <summary>Хаалга өөрөө загварт алга болно (🔴).</summary>
        public const string DoorLost = "door.lost";
        /// <summary>Хаалга хүссэн байрлалдаа очно (хэвийн).</summary>
        public const string DoorMoved = "door.moved";
        /// <summary>Revit хаалгыг хүссэнээс ӨӨР хэмжээгээр зөөнө (хянах).</summary>
        public const string DoorDeviated = "door.deviated";
        public const string DoorFlip = "door.flip";
        public const string DoorOutsideHost = "door.outside";
        /// <summary>Өөр хаалга/цонх/нүхний нүхтэй давхцана (🔴, өргөн мэдэгдсэн үед).</summary>
        public const string DoorOpeningOverlap = "door.opening.overlap";
        public const string DoorOpeningUnverified = "door.opening.unverified";
        public const string DoorWallEnd = "door.wallend";
        public const string DoorPathCrossing = "door.path.crossing";
        public const string DoorPathCandidate = "door.path.candidate";
        public const string DoorObstacleCandidate = "door.obstacle.candidate";
        /// <summary>Багана/бүтэц/өөр хана — хаалганы геометртэй БАТЛАГДСАН огтлолцол (🔴).</summary>
        public const string DoorStructureClash = "door.structure.clash";
        /// <summary>Тавилга/төхөөрөмж — хаалганы геометртэй БАТЛАГДСАН огтлолцол (🟠 хянах).</summary>
        public const string DoorFurnitureClash = "door.furnishing.clash";
        /// <summary>Хайрцгаар ойр боловч геометрээр огтлолцохгүй нь шалгагдсан (хэвийн).</summary>
        public const string DoorNearbyClear = "door.nearby.clear";
        public const string DoorRoomsChanged = "door.rooms";
        public const string DoorRoomAffected = "door.room.affected";
        /// <summary>Хаалганы дүүжин (swing) тооцоолоогүй — найдвартай геометр байхгүй тул зохиохгүй.</summary>
        public const string DoorSwingNe = "door.swing.ne";
    }
}
