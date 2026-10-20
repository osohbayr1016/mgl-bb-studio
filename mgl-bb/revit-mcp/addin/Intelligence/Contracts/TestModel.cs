using System;
using System.Collections.Generic;
using System.Text.Json.Serialization;

namespace RevitMcpAddin.Intelligence.Contracts
{
    /* ================================================================== */
    /*  СИНТЕТИК ТЕСТ ЗАГВАР — DEVELOPMENT / TEST ONLY · NON-PRODUCTION      */
    /*                                                                    */
    /*  Хэрэглэгч архитектор биш, Revit гараар хэрэглэдэггүй.  Session R   */
    /*  өөрөө хоосон метрик төсөлд детерминист жижиг барилга үүсгэж,      */
    /*  контекст · граф · өөрчлөлт · олдворын хоолойг шалгана.            */
    /*  Компанийн ЖИНХЭНЭ загварт ХЭЗЭЭ Ч ажиллахгүй (аюулгүйн хаалт).     */
    /* ================================================================== */

    public static class TestModel
    {
        public const string FixtureId = "mgl-ai-revit-test-v1";
        /// <summary>`ProjectInformation.Name`-д бичигдэх тэмдэг — «энэ баримт Session R-ийн тест» гэсэн ИЛ шошго.</summary>
        public const string ProjectInfoMarker = "MGL-AI-TEST SYNTHETIC (NON-PRODUCTION)";
        /// <summary>`Comments` параметрийн тэмдэг — синтетик хана.</summary>
        public const string ElementMarker = "MGL-AI-TEST: synthetic_marker";
        /// <summary>R4.2: синтетик баримт доторх хуулбар хананы төрөл — CHANGE_TYPE-ийн зорилт (тест л).</summary>
        public const string AltWallTypeName = "MGL-AI-TEST Wall 1 Test Alt";
        /// <summary>Хадгалсан-хоосон-тэмдэггүй баримтад ил зөвшөөрөл.</summary>
        public const string ConfirmToken = "I-UNDERSTAND-TEST-ONLY";
    }

    public enum TestModelGateReason
    {
        ALLOWED_TEST_MARKED,
        ALLOWED_BLANK_UNSAVED,
        ALLOWED_BLANK_CONFIRMED,
        REFUSED_NO_DOCUMENT,
        REFUSED_FAMILY_DOCUMENT,
        REFUSED_LINKED_DOCUMENT,
        REFUSED_HAS_MODEL_CONTENT,
        REFUSED_SAVED_UNMARKED_NO_CONFIRM,
        REFUSED_WORKSHARED,
        REFUSED_READ_ONLY,
    }

    public sealed class TestModelGate
    {
        [JsonPropertyName("allowed")] public bool Allowed { get; set; }
        [JsonPropertyName("reason")] public TestModelGateReason Reason { get; set; }
        [JsonPropertyName("model_element_count")] public int ModelElementCount { get; set; }
        [JsonPropertyName("is_test_marked")] public bool IsTestMarked { get; set; }
        [JsonPropertyName("is_unsaved")] public bool IsUnsaved { get; set; }
        [JsonPropertyName("doc_key")] public string DocKey { get; set; }
    }

    public sealed class TestModelElement
    {
        /// <summary>wall.exterior.north · room.101 · corridor.main … — тогтвортой логик нэр.</summary>
        [JsonPropertyName("logical")] public string Logical { get; set; }
        [JsonPropertyName("element_id")] public long ElementId { get; set; }
        [JsonPropertyName("unique_id")] public string UniqueId { get; set; }
        [JsonPropertyName("category")] public string Category { get; set; }
        [JsonPropertyName("note")] public string Note { get; set; }
    }

    public sealed class TestModelManifest
    {
        [JsonPropertyName("fixture")] public string Fixture { get; set; } = TestModel.FixtureId;
        [JsonPropertyName("synthetic")] public bool Synthetic { get; set; } = true;
        [JsonPropertyName("non_regulatory")] public bool NonRegulatory { get; set; } = true;
        [JsonPropertyName("purpose")] public string Purpose { get; set; } = "DEVELOPMENT / TEST ONLY — NON-PRODUCTION — SYNTHETIC MODEL";
        [JsonPropertyName("document")] public string Document { get; set; }
        [JsonPropertyName("doc_key")] public string DocKey { get; set; }
        [JsonPropertyName("revit_version")] public string RevitVersion { get; set; }
        [JsonPropertyName("created_at")] public string CreatedAt { get; set; }
        [JsonPropertyName("footprint_mm")] public double[] FootprintMm { get; set; } = { 10000, 8000 };
        [JsonPropertyName("level2_mm")] public double Level2Mm { get; set; } = 3000;
        [JsonPropertyName("elements")] public TestModelElements Elements { get; set; } = new TestModelElements();
        /// <summary>DOOR_SKIPPED_NO_FAMILY, FLOOR_SKIPPED_NO_TYPE … — ил тайлбартай.</summary>
        [JsonPropertyName("states")] public List<string> States { get; set; } = new List<string>();
        /// <summary>Зориуд эвдсэн MODEL_QUALITY тохиолдлууд (SYNTHETIC · NON_REGULATORY).</summary>
        [JsonPropertyName("intentional_defects")] public List<string> IntentionalDefects { get; set; } = new List<string>();
        [JsonPropertyName("elapsed_ms")] public double ElapsedMs { get; set; }
        [JsonPropertyName("saved_path")] public string SavedPath { get; set; }
    }

    public sealed class TestModelElements
    {
        [JsonPropertyName("levels")] public List<TestModelElement> Levels { get; set; } = new List<TestModelElement>();
        [JsonPropertyName("walls")] public List<TestModelElement> Walls { get; set; } = new List<TestModelElement>();
        [JsonPropertyName("floors")] public List<TestModelElement> Floors { get; set; } = new List<TestModelElement>();
        [JsonPropertyName("rooms")] public List<TestModelElement> Rooms { get; set; } = new List<TestModelElement>();
        [JsonPropertyName("doors")] public List<TestModelElement> Doors { get; set; } = new List<TestModelElement>();
        [JsonPropertyName("windows")] public List<TestModelElement> Windows { get; set; } = new List<TestModelElement>();
        /// <summary>R4.2: синтетик хананы ТӨРЛҮҮД — `walltype.base` (баримтын өөрийн төрөл), `walltype.alt` (тест-зориулалтын хуулбар, CHANGE_TYPE-ийн зорилт).</summary>
        [JsonPropertyName("wall_types")] public List<TestModelElement> WallTypes { get; set; } = new List<TestModelElement>();

        public IEnumerable<TestModelElement> All()
        {
            foreach (var e in Levels) yield return e;
            foreach (var e in Walls) yield return e;
            foreach (var e in Floors) yield return e;
            foreach (var e in Rooms) yield return e;
            foreach (var e in Doors) yield return e;
            foreach (var e in Windows) yield return e;
        }

        public TestModelElement Find(string logical)
        {
            foreach (var e in All()) if (string.Equals(e.Logical, logical, StringComparison.Ordinal)) return e;
            return null;
        }
    }
}
