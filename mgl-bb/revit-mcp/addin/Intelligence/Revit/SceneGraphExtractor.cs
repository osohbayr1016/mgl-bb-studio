using System;
using System.Collections.Generic;
using System.Diagnostics;
using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Architecture;
using RevitMcpAddin.Intelligence.Contracts;
using RevitMcpAddin.Intelligence.Core;

namespace RevitMcpAddin.Intelligence.Revit
{
    /// <summary>
    /// REVIT → SCENE GRAPH (§20–23, R-4, R-5).  ГУРВАН ДАВХАРГА, тус бүр
    /// өөрийн төсөвтэй; бүгд `RevitToolBus`-аар Revit-ийн үндсэн thread дээр.
    ///
    ///   Index     — `FilteredElementCollector` категориор (элементийн төрөл
    ///               БИШ, харагдацын хамрах хүрээ ХЭЗЭЭ Ч БИШ — 120 секундын
    ///               гацааны сургамж `ChangeTracker.cs`).
    ///   Relations — хост (REVIT_HOST), from/to өрөө (FROM_TO_ROOM), өрөөний
    ///               хилийн сегмент (ROOM_BOUNDARY), давхар (LEVEL_PARAMETER).
    ///               Өрөө тутамд `GetBoundarySegments` — курсортой, багцаар.
    ///   Geometry  — `RevitContextExtractor.Summarize(Full)` → хэмжээс/bbox.
    ///               ЗӨВХӨН хүссэн id-д (сонголт, даалгавар, дүрэм, бохирдсон).
    ///
    /// ⚠️ Ойролцоолсон ирмэг (`BOUNDING_BOX_APPROXIMATION`) энэ релизэд
    ///    ҮҮСГЭДЭГГҮЙ — детерминист эх сурвалж байхгүй харилцааг зохиохоос
    ///    «байхгүй» гэж хэлэх нь дээр.  Гэрээ нь түүнийг дэмждэг (тестлэгдсэн).
    /// </summary>
    internal static class SceneGraphExtractor
    {
        internal const int IndexBudgetMs = 1500;
        internal const int RelationsBudgetMs = 400;
        internal const int GeometryBudgetMs = 600;
        internal const int RoomsPerRelationCall = 40;
        internal const int MaxIndexNodes = 60000;

        private static readonly BuiltInCategory[] IndexCategories =
        {
            BuiltInCategory.OST_Levels, BuiltInCategory.OST_Rooms, BuiltInCategory.OST_Walls,
            BuiltInCategory.OST_Floors, BuiltInCategory.OST_Doors, BuiltInCategory.OST_Windows,
            BuiltInCategory.OST_Roofs, BuiltInCategory.OST_Stairs, BuiltInCategory.OST_Columns,
            BuiltInCategory.OST_StructuralColumns, BuiltInCategory.OST_StructuralFraming, BuiltInCategory.OST_Ceilings,
            BuiltInCategory.OST_RvtLinks,
        };

        internal sealed class IndexResult
        {
            public int Nodes;
            public int Edges;
            public double Ms;
            public bool BudgetExhausted;
            public bool Truncated;
        }

        /* ============================================================== */
        /*  ДАВХАРГА 1 — ИНДЕКС                                            */
        /* ============================================================== */

        internal static IndexResult BuildIndex(Document doc, SceneGraphStore g)
        {
            var sw = Stopwatch.StartNew();
            var res = new IndexResult();
            var nodes = new List<SceneNode>();
            var edges = new List<SceneEdge>();
            foreach (BuiltInCategory bic in IndexCategories)
            {
                if (sw.ElapsedMilliseconds > IndexBudgetMs) { res.BudgetExhausted = true; break; }
                FilteredElementCollector col;
                try { col = new FilteredElementCollector(doc).OfCategory(bic).WhereElementIsNotElementType(); }
                catch { continue; }
                foreach (Element e in col)
                {
                    if (nodes.Count >= MaxIndexNodes) { res.Truncated = true; break; }
                    SceneNode n = IndexNode(doc, e);
                    if (n == null) continue;
                    nodes.Add(n);
                    if (n.LevelId != null)
                        edges.Add(new SceneEdge { From = n.ElementId, To = n.LevelId.Value, Relation = EdgeRelation.ON_LEVEL, Source = EdgeSource.LEVEL_PARAMETER, Confidence = EdgeConfidence.AUTHORITATIVE });
                    if (n.HostId != null)
                    {
                        edges.Add(new SceneEdge { From = n.HostId.Value, To = n.ElementId, Relation = EdgeRelation.HOSTS, Source = EdgeSource.REVIT_HOST, Confidence = EdgeConfidence.AUTHORITATIVE });
                        edges.Add(new SceneEdge { From = n.ElementId, To = n.HostId.Value, Relation = EdgeRelation.HOSTED_BY, Source = EdgeSource.REVIT_HOST, Confidence = EdgeConfidence.AUTHORITATIVE });
                    }
                }
                if (res.Truncated) break;
            }
            // Store-д НЭГ дор — уншигчид хагас индекс харахгүй.
            g.UpsertMany(nodes);
            foreach (SceneEdge e in edges) g.AddEdge(e);
            res.Nodes = nodes.Count;
            res.Edges = edges.Count;
            res.Ms = Math.Round(sw.Elapsed.TotalMilliseconds, 1);
            g.RecordTiming(t => { t.IndexMs = res.Ms; t.IndexNodes = res.Nodes; t.BudgetExhausted |= res.BudgetExhausted; });
            return res;
        }

        /// <summary>Хямд индексийн зангилаа — категори/төрөл/давхар/хост/туг.  Геометр БАЙХГҮЙ.</summary>
        internal static SceneNode IndexNode(Document doc, Element e)
        {
            if (e == null) return null;
            var n = new SceneNode
            {
                ElementId = e.Id.Value,
                UniqueId = RevitContextExtractor.Safe(() => e.UniqueId),
                Kind = RevitContextExtractor.KindOf(e),
                Category = e.Category != null ? e.Category.Name : null,
                Name = RevitContextExtractor.Trim(RevitContextExtractor.Safe(() => e.Name)),
                Detail = SceneDetailLevel.INDEX,
                Scope = doc.IsLinked ? ElementScope.LINKED_DOCUMENT : ElementScope.HOST_DOCUMENT,
            };
            try
            {
                ElementId tid = e.GetTypeId();
                if (tid != null && tid != ElementId.InvalidElementId)
                {
                    ElementType t = doc.GetElement(tid) as ElementType;
                    if (t != null) { n.TypeName = RevitContextExtractor.Trim(t.Name); n.Family = RevitContextExtractor.Trim(RevitContextExtractor.Safe(() => t.FamilyName)); }
                }
            }
            catch { }
            var tmp = new RevitElementSummary();
            RevitContextExtractor.LevelOf(doc, e, tmp);
            n.LevelId = tmp.LevelId; n.LevelName = tmp.Level;
            RevitContextExtractor.HostOf(doc, e, tmp);
            if (tmp.Host != null) n.HostId = tmp.Host.ElementId;

            Room room = e as Room;
            if (room != null)
            {
                n.Flags = new List<string>();
                try
                {
                    if (room.Location == null) n.Flags.Add("unplaced");
                    else if (room.Area <= 1e-9) n.Flags.Add("not_enclosed");
                }
                catch { }
                // Тест fixture-ийн MODEL_QUALITY туг (§8): Department хоосон.  Хямд параметр.
                try
                {
                    Parameter dp = room.get_Parameter(BuiltInParameter.ROOM_DEPARTMENT);
                    if (dp == null || !dp.HasValue || string.IsNullOrWhiteSpace(dp.AsString())) n.Flags.Add("no_department");
                }
                catch { }
            }
            if (n.Kind == SceneNodeKind.WALL)
            {
                // Синтетик тэмдэг (`TestModel.ElementMarker`) — зөвхөн тест fixture-д утгатай.
                try
                {
                    Parameter cm = e.get_Parameter(BuiltInParameter.ALL_MODEL_INSTANCE_COMMENTS);
                    string v = cm != null && cm.HasValue ? cm.AsString() : null;
                    if (v != null && v.StartsWith("MGL-AI-TEST", StringComparison.Ordinal))
                    {
                        if (n.Flags == null) n.Flags = new List<string>();
                        n.Flags.Add("test_marker");
                    }
                }
                catch { }
            }
            return n;
        }

        /* ============================================================== */
        /*  ДАВХАРГА 2 — ХАРИЛЦАА                                          */
        /* ============================================================== */

        internal sealed class RelationsResult
        {
            public int RoomsProcessed;
            public int Edges;
            public int NextCursor;
            public bool Done;
            public double Ms;
        }

        /// <summary>
        /// Өрөөний хил → BOUNDS_ROOM (ROOM_BOUNDARY, AUTHORITATIVE); хаалга/цонхны
        /// from/to → FROM_ROOM/TO_ROOM (FROM_TO_ROOM).  `cursor`-оос эхлэн
        /// `RoomsPerRelationCall` өрөө, эсвэл төсөв дуустал.
        /// </summary>
        internal static RelationsResult BuildRoomRelations(Document doc, SceneGraphStore g, int cursor)
        {
            var sw = Stopwatch.StartNew();
            var res = new RelationsResult { NextCursor = cursor };
            List<SceneNode> rooms = g.NodesOfKind(SceneNodeKind.ROOM);
            rooms.Sort((a, b) => a.ElementId.CompareTo(b.ElementId));
            var opts = new SpatialElementBoundaryOptions { SpatialElementBoundaryLocation = SpatialElementBoundaryLocation.Finish };
            int i = cursor;
            for (; i < rooms.Count; i++)
            {
                if (res.RoomsProcessed >= RoomsPerRelationCall || sw.ElapsedMilliseconds > RelationsBudgetMs) break;
                SceneNode rn = rooms[i];
                if (rn.Deleted) { res.RoomsProcessed++; continue; }
                Room room = doc.GetElement(new ElementId(rn.ElementId)) as Room;
                res.RoomsProcessed++;
                if (room == null) continue;
                g.RemoveEdges(rn.ElementId, EdgeRelation.BOUNDS_ROOM);
                res.Edges += RoomBoundaryEdges(room, g);
                if (rn.Detail < SceneDetailLevel.RELATIONS) { rn.Detail = SceneDetailLevel.RELATIONS; g.Upsert(rn); }
            }
            res.NextCursor = i;
            res.Done = i >= rooms.Count;
            if (res.Done)
            {
                // Хаалга/цонх — from/to өрөө нь Revit-ийн өөрийн шинж (хямд).
                foreach (SceneNodeKind k in new[] { SceneNodeKind.DOOR, SceneNodeKind.WINDOW })
                {
                    foreach (SceneNode on in g.NodesOfKind(k))
                    {
                        if (sw.ElapsedMilliseconds > RelationsBudgetMs * 2) break;
                        FamilyInstance fi = doc.GetElement(new ElementId(on.ElementId)) as FamilyInstance;
                        if (fi == null) continue;
                        res.Edges += FromToEdges(fi, g);
                    }
                }
            }
            res.Ms = Math.Round(sw.Elapsed.TotalMilliseconds, 1);
            g.RecordTiming(t => { t.RelationsMs += res.Ms; t.RelationsNodes += res.RoomsProcessed; });
            return res;
        }

        internal static int RoomBoundaryEdges(Room room, SceneGraphStore g)
        {
            int n = 0;
            try
            {
                var opts = new SpatialElementBoundaryOptions { SpatialElementBoundaryLocation = SpatialElementBoundaryLocation.Finish };
                IList<IList<BoundarySegment>> loops = room.GetBoundarySegments(opts);
                if (loops == null) return 0;
                var seen = new HashSet<long>();
                foreach (IList<BoundarySegment> loop in loops)
                {
                    foreach (BoundarySegment seg in loop)
                    {
                        ElementId eid = seg.ElementId;
                        if (eid == null || eid == ElementId.InvalidElementId) continue;
                        long id = eid.Value;
                        if (!seen.Add(id)) continue;
                        if (!g.Contains(id)) continue; // өрөөний тусгаарлах шугам г.м. — графт байхгүй
                        if (g.AddEdge(new SceneEdge { From = id, To = room.Id.Value, Relation = EdgeRelation.BOUNDS_ROOM, Source = EdgeSource.ROOM_BOUNDARY, Confidence = EdgeConfidence.AUTHORITATIVE })) n++;
                    }
                }
            }
            catch { }
            return n;
        }

        internal static int FromToEdges(FamilyInstance fi, SceneGraphStore g)
        {
            int n = 0;
            long id = fi.Id.Value;
            g.RemoveEdges(id, EdgeRelation.FROM_ROOM);
            g.RemoveEdges(id, EdgeRelation.TO_ROOM);
            try { Room fr = fi.FromRoom; if (fr != null && g.AddEdge(new SceneEdge { From = id, To = fr.Id.Value, Relation = EdgeRelation.FROM_ROOM, Source = EdgeSource.FROM_TO_ROOM, Confidence = EdgeConfidence.AUTHORITATIVE })) n++; } catch { }
            try { Room tr = fi.ToRoom; if (tr != null && g.AddEdge(new SceneEdge { From = id, To = tr.Id.Value, Relation = EdgeRelation.TO_ROOM, Source = EdgeSource.FROM_TO_ROOM, Confidence = EdgeConfidence.AUTHORITATIVE })) n++; } catch { }
            try { Room rr = fi.Room; if (rr != null && g.AddEdge(new SceneEdge { From = id, To = rr.Id.Value, Relation = EdgeRelation.INSIDE, Source = EdgeSource.REVIT_SPATIAL_API, Confidence = EdgeConfidence.AUTHORITATIVE })) n++; } catch { }
            return n;
        }

        /* ============================================================== */
        /*  ДАВХАРГА 3 — ГЕОМЕТР / ШИНЭЧЛЭЛ                                 */
        /* ============================================================== */

        internal sealed class RefreshResult
        {
            public int Refreshed;
            public int Deleted;
            public int Enriched;
            public double Ms;
            public bool BudgetExhausted;
            public readonly List<long> Remaining = new List<long>();
        }

        /// <summary>
        /// Бохирдсон id-г Revit-ээс ДАХИН уншина: байхгүй → `MarkDeleted` (§53);
        /// байгаа → индекс + харилцаа + (`geometry` бол) хэмжээс.  Төсөв дуусвал
        /// үлдсэн id-г `Remaining`-д буцаана — дуудагч дараагийн мөчлөгт үргэлжлүүлнэ.
        /// </summary>
        internal static RefreshResult Refresh(Document doc, SceneGraphStore g, IList<long> ids, bool geometry)
        {
            var sw = Stopwatch.StartNew();
            var res = new RefreshResult();
            int budget = geometry ? GeometryBudgetMs : RelationsBudgetMs;
            var done = new List<long>();
            foreach (long id in ids)
            {
                if (sw.ElapsedMilliseconds > budget) { res.BudgetExhausted = true; res.Remaining.Add(id); continue; }
                Element e = null;
                try { e = doc.GetElement(new ElementId(id)); } catch { }
                if (e == null)
                {
                    g.MarkDeleted(id);
                    res.Deleted++;
                    done.Add(id);
                    continue;
                }
                SceneNode n = IndexNode(doc, e);
                if (n == null) { done.Add(id); continue; }
                g.RemoveEdges(id, EdgeRelation.HOSTED_BY);
                g.RemoveEdges(id, EdgeRelation.ON_LEVEL);
                if (geometry)
                {
                    RevitElementSummary s = RevitContextExtractor.Summarize(doc, e, RevitContextExtractor.SummaryDepth.Full);
                    n.Detail = SceneDetailLevel.GEOMETRY;
                    n.Measures = s.Dimensions;
                    n.BoundingBox = s.BoundingBox;
                    n.Worksharing = s.Worksharing;
                    res.Enriched++;
                }
                g.Upsert(n);
                if (n.LevelId != null)
                    g.AddEdge(new SceneEdge { From = id, To = n.LevelId.Value, Relation = EdgeRelation.ON_LEVEL, Source = EdgeSource.LEVEL_PARAMETER, Confidence = EdgeConfidence.AUTHORITATIVE });
                if (n.HostId != null)
                {
                    g.AddEdge(new SceneEdge { From = n.HostId.Value, To = id, Relation = EdgeRelation.HOSTS, Source = EdgeSource.REVIT_HOST, Confidence = EdgeConfidence.AUTHORITATIVE });
                    g.AddEdge(new SceneEdge { From = id, To = n.HostId.Value, Relation = EdgeRelation.HOSTED_BY, Source = EdgeSource.REVIT_HOST, Confidence = EdgeConfidence.AUTHORITATIVE });
                }
                Room room = e as Room;
                if (room != null) { g.RemoveEdges(id, EdgeRelation.BOUNDS_ROOM); RoomBoundaryEdges(room, g); }
                FamilyInstance fi = e as FamilyInstance;
                if (fi != null && (n.Kind == SceneNodeKind.DOOR || n.Kind == SceneNodeKind.WINDOW)) FromToEdges(fi, g);
                // Хана зассан бол түүний хүрээлдэг өрөөнүүдийн хил өөрчлөгдсөн байж болно —
                // тэдгээр өрөөг ДАХИН унших (хямд: өрөө бүрт нэг GetBoundarySegments).
                if (n.Kind == SceneNodeKind.WALL)
                {
                    foreach (long roomId in g.Neighbors(id, EdgeRelation.BOUNDS_ROOM))
                    {
                        Room r2 = doc.GetElement(new ElementId(roomId)) as Room;
                        if (r2 == null) continue;
                        SceneNode rn = IndexNode(doc, r2);
                        if (rn != null) g.Upsert(rn);
                        g.RemoveEdges(roomId, EdgeRelation.BOUNDS_ROOM);
                        RoomBoundaryEdges(r2, g);
                    }
                }
                res.Refreshed++;
                done.Add(id);
            }
            g.ClearDirty(done);
            res.Ms = Math.Round(sw.Elapsed.TotalMilliseconds, 1);
            g.RecordTiming(t => { if (geometry) { t.GeometryMs += res.Ms; t.GeometryNodes += res.Enriched; } t.BudgetExhausted |= res.BudgetExhausted; });
            return res;
        }
    }
}
