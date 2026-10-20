using System;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;
using RevitMcpAddin.Intelligence.Contracts;
using RevitMcpAddin.Intelligence.Core;

namespace RevitMcpAddin.Intelligence.Tests
{
    /// <summary>
    /// §65 — санах ойн синтетик загвар:
    ///   Level 1 (100) · Room A (201, 12 м²) · Room B (202, 0 м² — хаалттай биш)
    ///   Wall 1 (301, 6000 мм, A-г хүрээлнэ) · Wall 2 (302, 800 мм, A ба B-г хүрээлнэ)
    ///   Door 1 (401, 850 мм, хост Wall 2, from A → to B) · Floor 1 (501)
    ///   Door 2 (402, хостгүй, 1000 мм) — MODEL_QUALITY туршилтад
    /// Бүх ирмэг детерминист эх сурвалжтай; нэг нь ЗОРИУД ойролцоолсон.
    /// </summary>
    public static class SyntheticModel
    {
        public const string DocKey = "synthetic-doc-1";
        public const long Level1 = 100, RoomA = 201, RoomB = 202, Wall1 = 301, Wall2 = 302, Door1 = 401, Door2 = 402, Floor1 = 501;
        public const string LengthSpec = "autodesk.spec.aec:length-2.0.0";
        public const string AreaSpec = "autodesk.spec.aec:area-2.0.0";

        public static SceneGraphStore Build(bool withGeometry = true)
        {
            var g = new SceneGraphStore(DocKey);
            g.Upsert(new SceneNode { ElementId = Level1, UniqueId = "u-level1", Kind = SceneNodeKind.LEVEL, Category = "Levels", Name = "Level 1", Detail = SceneDetailLevel.INDEX });
            g.Upsert(new SceneNode { ElementId = RoomA, UniqueId = "u-roomA", Kind = SceneNodeKind.ROOM, Category = "Rooms", Name = "Room A", LevelId = Level1, LevelName = "Level 1", Detail = SceneDetailLevel.INDEX, Flags = new List<string>() });
            g.Upsert(new SceneNode { ElementId = RoomB, UniqueId = "u-roomB", Kind = SceneNodeKind.ROOM, Category = "Rooms", Name = "Room B", LevelId = Level1, LevelName = "Level 1", Detail = SceneDetailLevel.INDEX, Flags = new List<string> { "not_enclosed" } });
            g.Upsert(new SceneNode { ElementId = Wall1, UniqueId = "u-wall1", Kind = SceneNodeKind.WALL, Category = "Walls", TypeName = "Generic 200mm", LevelId = Level1, LevelName = "Level 1", Detail = SceneDetailLevel.INDEX });
            g.Upsert(new SceneNode { ElementId = Wall2, UniqueId = "u-wall2", Kind = SceneNodeKind.WALL, Category = "Walls", TypeName = "Generic 200mm", LevelId = Level1, LevelName = "Level 1", Detail = SceneDetailLevel.INDEX });
            g.Upsert(new SceneNode { ElementId = Door1, UniqueId = "u-door1", Kind = SceneNodeKind.DOOR, Category = "Doors", Family = "Single-Flush", TypeName = "850 x 2100", LevelId = Level1, LevelName = "Level 1", HostId = Wall2, Detail = SceneDetailLevel.INDEX });
            g.Upsert(new SceneNode { ElementId = Door2, UniqueId = "u-door2", Kind = SceneNodeKind.DOOR, Category = "Doors", Family = "Single-Flush", TypeName = "1000 x 2100", LevelId = Level1, LevelName = "Level 1", HostId = null, Detail = SceneDetailLevel.INDEX });
            g.Upsert(new SceneNode { ElementId = Floor1, UniqueId = "u-floor1", Kind = SceneNodeKind.FLOOR, Category = "Floors", TypeName = "Concrete 200", LevelId = Level1, LevelName = "Level 1", Detail = SceneDetailLevel.INDEX });

            foreach (long id in new[] { RoomA, RoomB, Wall1, Wall2, Door1, Door2, Floor1 })
                g.AddEdge(new SceneEdge { From = id, To = Level1, Relation = EdgeRelation.ON_LEVEL, Source = EdgeSource.LEVEL_PARAMETER, Confidence = EdgeConfidence.AUTHORITATIVE });
            g.AddEdge(new SceneEdge { From = Wall1, To = RoomA, Relation = EdgeRelation.BOUNDS_ROOM, Source = EdgeSource.ROOM_BOUNDARY, Confidence = EdgeConfidence.AUTHORITATIVE });
            g.AddEdge(new SceneEdge { From = Wall2, To = RoomA, Relation = EdgeRelation.BOUNDS_ROOM, Source = EdgeSource.ROOM_BOUNDARY, Confidence = EdgeConfidence.AUTHORITATIVE });
            // Room B хаалттай биш → хилийн сегмент байхгүй → ЗӨВХӨН bbox ойролцоолол.
            g.AddEdge(new SceneEdge { From = Wall2, To = RoomB, Relation = EdgeRelation.BOUNDS_ROOM, Source = EdgeSource.BOUNDING_BOX_APPROXIMATION, Confidence = EdgeConfidence.APPROXIMATE });
            g.AddEdge(new SceneEdge { From = Wall2, To = Door1, Relation = EdgeRelation.HOSTS, Source = EdgeSource.REVIT_HOST, Confidence = EdgeConfidence.AUTHORITATIVE });
            g.AddEdge(new SceneEdge { From = Door1, To = Wall2, Relation = EdgeRelation.HOSTED_BY, Source = EdgeSource.REVIT_HOST, Confidence = EdgeConfidence.AUTHORITATIVE });
            g.AddEdge(new SceneEdge { From = Door1, To = RoomA, Relation = EdgeRelation.FROM_ROOM, Source = EdgeSource.FROM_TO_ROOM, Confidence = EdgeConfidence.AUTHORITATIVE });
            g.AddEdge(new SceneEdge { From = Door1, To = RoomB, Relation = EdgeRelation.TO_ROOM, Source = EdgeSource.FROM_TO_ROOM, Confidence = EdgeConfidence.AUTHORITATIVE });
            g.AddEdge(new SceneEdge { From = Floor1, To = RoomA, Relation = EdgeRelation.INSIDE, Source = EdgeSource.BOUNDING_BOX_APPROXIMATION, Confidence = EdgeConfidence.APPROXIMATE });

            if (withGeometry)
            {
                Enrich(g, Wall1, new[] { UnitsBoundary.LengthMm("length_mm", 6000 / UnitsBoundary.MmPerFoot, QuantitySource.BuiltinGeometry, LengthSpec) });
                Enrich(g, Wall2, new[] { UnitsBoundary.LengthMm("length_mm", 800 / UnitsBoundary.MmPerFoot, QuantitySource.BuiltinGeometry, LengthSpec) });
                Enrich(g, Door1, new[] { UnitsBoundary.LengthMm("width_mm", 850 / UnitsBoundary.MmPerFoot, QuantitySource.TypedParam, LengthSpec) });
                Enrich(g, Door2, new[] { UnitsBoundary.LengthMm("width_mm", 1000 / UnitsBoundary.MmPerFoot, QuantitySource.TypedParam, LengthSpec) });
                Enrich(g, RoomA, new[] { UnitsBoundary.AreaM2("area_m2", 12 / UnitsBoundary.M2PerSqFoot, QuantitySource.BuiltinGeometry, AreaSpec) });
                Enrich(g, Floor1, new[] { UnitsBoundary.AreaM2("area_m2", 12 / UnitsBoundary.M2PerSqFoot, QuantitySource.BuiltinGeometry, AreaSpec) });
            }
            return g;
        }

        public static void Enrich(SceneGraphStore g, long id, Measure[] measures)
        {
            SceneNode n = g.Get(id);
            n.Detail = SceneDetailLevel.GEOMETRY;
            n.Measures = new List<Measure>(measures);
            g.Upsert(n);
        }
    }

    /// <summary>Синтетик дүрмийн нийлүүлэгч — ЗӨВХӨН тестэд.  Provenance нь SYNTHETIC/NON_REGULATORY.</summary>
    public sealed class SyntheticFixtureRuleProvider : IBimRuleProvider
    {
        public string Name { get { return "SYNTHETIC_FIXTURE"; } }
        public bool IncludeFakeVerified;

        public RuleProviderResult Load()
        {
            string path = Path.Combine(AppContext.BaseDirectory, "fixtures", "synthetic-rules.json");
            using (JsonDocument doc = JsonDocument.Parse(File.ReadAllText(path)))
            {
                var r = new RuleProviderResult { Status = RuleProviderStatus.OK, Provider = Name, Note = doc.RootElement.GetProperty("note").GetString() };
                foreach (JsonElement e in doc.RootElement.GetProperty("rules").EnumerateArray())
                {
                    BimExecutableRule rule = IntelligenceJson.Deserialize<BimExecutableRule>(e.GetRawText());
                    if (rule.Source.Kind == RuleSourceKind.VERIFIED_NORM && !IncludeFakeVerified) continue;
                    r.Rules.Add(rule);
                }
                return r;
            }
        }
    }
}
