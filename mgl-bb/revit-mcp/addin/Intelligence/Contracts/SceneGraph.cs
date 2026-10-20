using System;
using System.Collections.Generic;
using System.Text.Json.Serialization;

namespace RevitMcpAddin.Intelligence.Contracts
{
    /* ================================================================== */
    /*  SCENE GRAPH (§20–23, R-4, R-5)                                     */
    /*                                                                    */
    /*  Гурван давхарга:                                                  */
    /*    INDEX     — id/uid/категори/төрөл/давхар/хост (хямд, бүхэлд)     */
    /*    RELATIONS — ирмэгүүд (хэрэгтэй үед)                             */
    /*    GEOMETRY  — хэмжээс, bbox, байршил (сонголт/даалгавар/дүрэм/    */
    /*                бохирдсон зангилаа дээр Л)                          */
    /*                                                                    */
    /*  ⚠️ Ирмэг бүр ЭХ СУРВАЛЖ + ИТГЭЛТЭЙ.  `BOUNDING_BOX_APPROXIMATION`  */
    /*  нь `ROOM_BOUNDARY`-тай ХЭЗЭЭ Ч тэнцэхгүй; нийцлийн хөдөлгүүр      */
    /*  `IsAuthoritative()`-оор шүүнэ (R-5).                              */
    /* ================================================================== */

    public enum SceneNodeKind
    {
        LEVEL, ROOM, SPACE, WALL, FLOOR, DOOR, WINDOW, ROOF, STAIR, COLUMN, BEAM,
        CEILING, VIEW, GRID, LINK, OTHER,
    }

    public enum SceneDetailLevel { INDEX = 0, RELATIONS = 1, GEOMETRY = 2 }

    public enum EdgeRelation
    {
        ON_LEVEL, BOUNDS_ROOM, HOSTS, HOSTED_BY, FROM_ROOM, TO_ROOM,
        ADJACENT_TO, INTERSECTS, CONNECTED_TO, INSIDE, BELONGS_TO_VIEW, LINKED_FROM,
    }

    /// <summary>Ирмэгийг ЮУ гаргасан бэ — детерминист эх сурвалжууд.  LLM ЭНД ХЭЗЭЭ Ч БАЙХГҮЙ (§22).</summary>
    public enum EdgeSource
    {
        REVIT_HOST,
        ROOM_BOUNDARY,
        FROM_TO_ROOM,
        LEVEL_PARAMETER,
        REVIT_SPATIAL_API,
        GEOMETRY_INTERSECTION,
        BOUNDING_BOX_APPROXIMATION,
        LINK_INSTANCE,
        SYNTHETIC_FIXTURE,
    }

    public enum EdgeConfidence { AUTHORITATIVE, DERIVED, APPROXIMATE }

    public sealed class SceneNode
    {
        [JsonPropertyName("element_id")] public long ElementId { get; set; }
        [JsonPropertyName("unique_id")] public string UniqueId { get; set; }
        [JsonPropertyName("kind")] public SceneNodeKind Kind { get; set; }
        [JsonPropertyName("category")] public string Category { get; set; }
        [JsonPropertyName("family")] public string Family { get; set; }
        [JsonPropertyName("type_name")] public string TypeName { get; set; }
        [JsonPropertyName("name")] public string Name { get; set; }
        [JsonPropertyName("level_id")] public long? LevelId { get; set; }
        [JsonPropertyName("level_name")] public string LevelName { get; set; }
        [JsonPropertyName("host_id")] public long? HostId { get; set; }
        [JsonPropertyName("scope")] public ElementScope Scope { get; set; } = ElementScope.HOST_DOCUMENT;
        [JsonPropertyName("detail")] public SceneDetailLevel Detail { get; set; } = SceneDetailLevel.INDEX;
        /// <summary>Давхрын өндөр (LEVEL), талбай (ROOM/FLOOR), урт (WALL) … — GEOMETRY давхаргад л.</summary>
        [JsonPropertyName("measures")] public List<Measure> Measures { get; set; }
        [JsonPropertyName("bounding_box")] public RevitBoundingBoxMm BoundingBox { get; set; }
        [JsonPropertyName("worksharing")] public RevitWorksharingState Worksharing { get; set; }
        /// <summary>Өрөөнд: `Room.Area > 0` — хаалттай эсэх.  MODEL_QUALITY шалгалтын оролт.</summary>
        [JsonPropertyName("flags")] public List<string> Flags { get; set; }
        /// <summary>Графийн аль хувилбарт сүүлд шинэчлэгдсэн.</summary>
        [JsonPropertyName("version")] public long Version { get; set; }
        /// <summary>Устгагдсан гэж тэмдэглэгдсэн (Revit-ээс уншиж чадахгүй, §53).</summary>
        [JsonPropertyName("deleted")] public bool Deleted { get; set; }
    }

    public sealed class SceneEdge
    {
        [JsonPropertyName("from")] public long From { get; set; }
        [JsonPropertyName("to")] public long To { get; set; }
        [JsonPropertyName("relation")] public EdgeRelation Relation { get; set; }
        [JsonPropertyName("source")] public EdgeSource Source { get; set; }
        [JsonPropertyName("confidence")] public EdgeConfidence Confidence { get; set; }
        [JsonPropertyName("version")] public long Version { get; set; }

        /// <summary>Нийцлийн шийдвэрт хэрэглэж БОЛОХ эсэх (R-5).</summary>
        public bool IsAuthoritative()
        {
            return Confidence == EdgeConfidence.AUTHORITATIVE;
        }

        public string Key()
        {
            return From.ToString() + ">" + To.ToString() + ":" + Relation.ToString();
        }
    }

    /// <summary>Сериалчлагдах агшин зураг — `SceneGraphStore`-ийн экспорт.</summary>
    public sealed class SceneGraphSnapshot
    {
        [JsonPropertyName("schema_version")] public int SchemaVersion { get; set; } = Schema.Version;
        [JsonPropertyName("doc_key")] public string DocKey { get; set; }
        [JsonPropertyName("version")] public long Version { get; set; }
        [JsonPropertyName("built_at")] public string BuiltAt { get; set; }
        [JsonPropertyName("nodes")] public List<SceneNode> Nodes { get; set; } = new List<SceneNode>();
        [JsonPropertyName("edges")] public List<SceneEdge> Edges { get; set; } = new List<SceneEdge>();
        [JsonPropertyName("timing")] public SceneGraphTiming Timing { get; set; }
    }

    /// <summary>Хэмжилт (§23, §54) — Revit-ийн үндсэн thread дээрх мс.</summary>
    public sealed class SceneGraphTiming
    {
        [JsonPropertyName("index_ms")] public double IndexMs { get; set; }
        [JsonPropertyName("index_nodes")] public int IndexNodes { get; set; }
        [JsonPropertyName("relations_ms")] public double RelationsMs { get; set; }
        [JsonPropertyName("relations_nodes")] public int RelationsNodes { get; set; }
        [JsonPropertyName("geometry_ms")] public double GeometryMs { get; set; }
        [JsonPropertyName("geometry_nodes")] public int GeometryNodes { get; set; }
        [JsonPropertyName("budget_exhausted")] public bool BudgetExhausted { get; set; }
    }

    /* ================================================================== */
    /*  ӨӨРЧЛӨЛТИЙН ОЛОНЛОГ (§24–25, R-14)                                 */
    /* ================================================================== */

    /// <summary>
    /// `LogicalChangeSet` (Track 2-ийн нэгтгэгч) + `ChangeTracker.Change`
    /// (нэмсэн/зассан/устгасан олонлог) → нэг гэрээ.  Гүйлгээний нэр нь
    /// ЗӨВХӨН мэдээлэл — семантикийн эх сурвалж БИШ (§25).
    /// </summary>
    public sealed class RevitChangeSet
    {
        [JsonPropertyName("schema_version")] public int SchemaVersion { get; set; } = Schema.Version;
        [JsonPropertyName("doc_key")] public string DocKey { get; set; }
        [JsonPropertyName("added")] public List<long> Added { get; set; } = new List<long>();
        [JsonPropertyName("modified")] public List<long> Modified { get; set; } = new List<long>();
        [JsonPropertyName("deleted")] public List<long> Deleted { get; set; } = new List<long>();
        /// <summary>Нэгтгэгч ангилалгүй өгсөн id — `resolve`-ээр Revit шийднэ.</summary>
        [JsonPropertyName("unclassified")] public List<long> Unclassified { get; set; } = new List<long>();
        [JsonPropertyName("transaction_names")] public List<string> TransactionNames { get; set; } = new List<string>();
        [JsonPropertyName("first_seq")] public long FirstSeq { get; set; }
        [JsonPropertyName("last_seq")] public long LastSeq { get; set; }
        [JsonPropertyName("opened_ms")] public long OpenedMs { get; set; }
        [JsonPropertyName("closed_ms")] public long ClosedMs { get; set; }
        /// <summary>settle | size | defer | flush — нэгтгэгчийн хаалтын шалтгаан.</summary>
        [JsonPropertyName("close_reason")] public string CloseReason { get; set; }
        [JsonPropertyName("may_collect")] public bool MayCollect { get; set; }
        [JsonPropertyName("coarse")] public bool Coarse { get; set; }
        [JsonPropertyName("undo_burst")] public int UndoBurst { get; set; }
        [JsonPropertyName("txn_count")] public int TxnCount { get; set; }
        [JsonPropertyName("captured_at")] public string CapturedAt { get; set; }

        [JsonIgnore]
        public int Total
        {
            get { return Added.Count + Modified.Count + Deleted.Count + Unclassified.Count; }
        }

        /// <summary>Графийг шинэчлэхэд Revit-ээс ДАХИН УНШИХ ёстой id-ууд (устгагдсаныг оруулахгүй).</summary>
        public IEnumerable<long> DirtyIds()
        {
            foreach (long id in Added) yield return id;
            foreach (long id in Modified) yield return id;
            foreach (long id in Unclassified) yield return id;
        }
    }

    /* ================================================================== */
    /*  TYPED ХАЙЛТ (§60) — LLM-ээс дурын хэл ХЭЗЭЭ Ч ирэхгүй               */
    /* ================================================================== */

    /// <summary>Хаалттай шүүлтүүр.  Категори/төрөл/давхар/өрөө — өөр юу ч биш.</summary>
    public sealed class ElementQuery
    {
        [JsonPropertyName("kinds")] public List<SceneNodeKind> Kinds { get; set; } = new List<SceneNodeKind>();
        /// <summary>Revit-ийн категорийн нэр (Walls, Doors …) — `Kinds`-ийн нэмэлт.</summary>
        [JsonPropertyName("categories")] public List<string> Categories { get; set; } = new List<string>();
        [JsonPropertyName("level_names")] public List<string> LevelNames { get; set; } = new List<string>();
        [JsonPropertyName("level_ids")] public List<long> LevelIds { get; set; } = new List<long>();
        [JsonPropertyName("room_ids")] public List<long> RoomIds { get; set; } = new List<long>();
        [JsonPropertyName("element_ids")] public List<long> ElementIds { get; set; } = new List<long>();
        /// <summary>Төрлийн/гэр бүлийн нэрэнд агуулагдах мөр (case-insensitive).</summary>
        [JsonPropertyName("name_contains")] public string NameContains { get; set; }
        [JsonPropertyName("include_linked")] public bool IncludeLinked { get; set; }
        [JsonPropertyName("limit")] public int Limit { get; set; } = 500;
    }

    /* ================================================================== */
    /*  TYPED ХЭРЭГСЛИЙН ХАРИУ (§59)                                       */
    /* ================================================================== */

    public enum ToolSourceType { REVIT_MODEL, NORM, ERP, MODEL_INFERENCE, SCENE_GRAPH, ACTIVITY_JOURNAL }

    /// <summary>Хэрэгсэл бүрийн хариу — статус + өгөгдөл + анхааруулга + эх сурвалж + цаг.</summary>
    public sealed class ToolResult<T>
    {
        [JsonPropertyName("status")] public RevitErrorState Status { get; set; } = RevitErrorState.OK;
        [JsonPropertyName("data")] public T Data { get; set; }
        [JsonPropertyName("warnings")] public List<string> Warnings { get; set; } = new List<string>();
        [JsonPropertyName("source_type")] public ToolSourceType SourceType { get; set; } = ToolSourceType.REVIT_MODEL;
        [JsonPropertyName("captured_at")] public string CapturedAt { get; set; }
        [JsonPropertyName("elapsed_ms")] public double ElapsedMs { get; set; }

        public static ToolResult<T> Ok(T data, ToolSourceType source, double elapsedMs)
        {
            return new ToolResult<T>
            {
                Data = data,
                SourceType = source,
                ElapsedMs = elapsedMs,
                CapturedAt = DateTime.UtcNow.ToString("o"),
            };
        }

        public static ToolResult<T> Fail(RevitErrorState state, string warning)
        {
            var r = new ToolResult<T> { Status = state, CapturedAt = DateTime.UtcNow.ToString("o") };
            if (!string.IsNullOrEmpty(warning)) r.Warnings.Add(warning);
            return r;
        }
    }
}
