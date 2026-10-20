using System;
using System.Collections.Generic;
using RevitMcpAddin.Intelligence.Contracts;

namespace RevitMcpAddin.Intelligence.Core
{
    /// <summary>
    /// SCENE GRAPH-ИЙН ХАДГАЛАЛТ — ЦЭВЭР (Revit-гүй), thread-safe, хувилбартай.
    ///
    /// ⚠️ Энэ анги Revit-ээс ЮУ Ч уншдаггүй.  `SceneGraphExtractor` (Revit/)
    ///    нь Revit-ийн API контекст дотор зангилаа/ирмэг үүсгээд ЭНД
    ///    `Upsert`-ээр өгнө; арын thread-үүд `Snapshot()`/`Query()`-оор
    ///    ХУУЛБАР авна.  Амьд `Element` энд ХЭЗЭЭ Ч хадгалагдахгүй (§15).
    ///
    /// ⚠️ УСТГАЛТ (§53): `DocumentChanged` устгагдсан id-г объект АЛГА
    ///    болсны ДАРАА мэдэгддэг.  `MarkDeleted` нь зангилааг dereference
    ///    хийхгүй — зөвхөн тугладаг, ирмэгийг нь хасдаг.
    ///
    /// ⚠️ ХУВИЛБАР монотон — олдвор бүр `scene_version`-оо тэмдэглэдэг (§62).
    /// </summary>
    public sealed class SceneGraphStore
    {
        private readonly object _gate = new object();
        private readonly Dictionary<long, SceneNode> _nodes = new Dictionary<long, SceneNode>();
        private readonly Dictionary<string, SceneEdge> _edges = new Dictionary<string, SceneEdge>(StringComparer.Ordinal);
        /// <summary>Зангилаа → түүнд хамаарах ирмэгийн түлхүүрүүд (устгахад O(deg)).</summary>
        private readonly Dictionary<long, HashSet<string>> _incidence = new Dictionary<long, HashSet<string>>();
        private readonly HashSet<long> _dirty = new HashSet<long>();
        private long _version;
        private readonly SceneGraphTiming _timing = new SceneGraphTiming();

        public string DocKey { get; }
        public string BuiltAt { get; private set; }

        public SceneGraphStore(string docKey)
        {
            DocKey = docKey ?? "";
            BuiltAt = DateTime.UtcNow.ToString("o");
        }

        public long Version { get { lock (_gate) return _version; } }
        public int NodeCount { get { lock (_gate) return _nodes.Count; } }
        public int EdgeCount { get { lock (_gate) return _edges.Count; } }
        public int DirtyCount { get { lock (_gate) return _dirty.Count; } }

        /* ============================================================== */
        /*  БИЧИЛТ                                                         */
        /* ============================================================== */

        /// <summary>Зангилаа нэмэх/шинэчлэх.  Дээд `Detail` хэвээр үлдэнэ (INDEX нь GEOMETRY-г ДАРАХГҮЙ).</summary>
        public long Upsert(SceneNode node)
        {
            if (node == null) throw new ArgumentNullException(nameof(node));
            lock (_gate)
            {
                _version++;
                SceneNode existing;
                if (_nodes.TryGetValue(node.ElementId, out existing) && existing.Detail > node.Detail && !existing.Deleted)
                {
                    // Хямд индексийн мөр ирж баялаг зангилааг дарахгүй — зөвхөн
                    // таних талбарыг шинэчилнэ.
                    existing.Category = node.Category ?? existing.Category;
                    existing.Kind = node.Kind;
                    existing.Family = node.Family ?? existing.Family;
                    existing.TypeName = node.TypeName ?? existing.TypeName;
                    existing.Name = node.Name ?? existing.Name;
                    existing.LevelId = node.LevelId ?? existing.LevelId;
                    existing.LevelName = node.LevelName ?? existing.LevelName;
                    existing.HostId = node.HostId ?? existing.HostId;
                    existing.Version = _version;
                    existing.Deleted = false;
                }
                else
                {
                    node.Version = _version;
                    node.Deleted = false;
                    _nodes[node.ElementId] = node;
                }
                _dirty.Remove(node.ElementId);
                return _version;
            }
        }

        public long UpsertMany(IEnumerable<SceneNode> nodes)
        {
            long v = 0;
            foreach (SceneNode n in nodes) v = Upsert(n);
            return v;
        }

        /// <summary>Ирмэг нэмэх.  Ижил (from,to,relation) байвал ӨНДӨР итгэлтэй нь ялна — ойролцоолол эрх бүхийг дарахгүй (R-5).</summary>
        public bool AddEdge(SceneEdge edge)
        {
            if (edge == null) throw new ArgumentNullException(nameof(edge));
            lock (_gate)
            {
                string key = edge.Key();
                SceneEdge prev;
                if (_edges.TryGetValue(key, out prev) && prev.Confidence < edge.Confidence)
                {
                    return false; // AUTHORITATIVE(0) < DERIVED(1) < APPROXIMATE(2): бага тоо = өндөр итгэл
                }
                _version++;
                edge.Version = _version;
                _edges[key] = edge;
                Incident(edge.From).Add(key);
                Incident(edge.To).Add(key);
                return true;
            }
        }

        /// <summary>Зангилааны ТОДОРХОЙ харилцааны ирмэгүүдийг ХАСНА — дахин уншихаас өмнө (хуучин `HOSTED_BY` үлдэхгүй).</summary>
        public int RemoveEdges(long elementId, EdgeRelation? relation)
        {
            lock (_gate)
            {
                HashSet<string> keys;
                if (!_incidence.TryGetValue(elementId, out keys)) return 0;
                var toRemove = new List<string>();
                foreach (string k in keys)
                {
                    SceneEdge e;
                    if (!_edges.TryGetValue(k, out e)) { toRemove.Add(k); continue; }
                    if (relation == null || e.Relation == relation.Value) toRemove.Add(k);
                }
                foreach (string k in toRemove) RemoveEdgeKey(k);
                if (toRemove.Count > 0) _version++;
                return toRemove.Count;
            }
        }

        /// <summary>Устгагдсан гэж тэмдэглэнэ; ирмэгийг хасна; зангилааг ҮЛДЭЭНЭ (тайланд «устгагдсан» гэж хэлэхэд нэр нь хэрэгтэй).</summary>
        public bool MarkDeleted(long elementId)
        {
            lock (_gate)
            {
                SceneNode n;
                _dirty.Remove(elementId);
                if (!_nodes.TryGetValue(elementId, out n)) return false;
                _version++;
                n.Deleted = true;
                n.Version = _version;
                RemoveEdges(elementId, null);
                return true;
            }
        }

        /// <summary>Бүрэн арилгах (устгагдсан зангилааны хог цэвэрлэлт).</summary>
        public bool Remove(long elementId)
        {
            lock (_gate)
            {
                RemoveEdges(elementId, null);
                _incidence.Remove(elementId);
                _dirty.Remove(elementId);
                bool ok = _nodes.Remove(elementId);
                if (ok) _version++;
                return ok;
            }
        }

        /// <summary>
        /// Өөрчлөлтийн олонлогийг буулгана (§23 incremental):
        ///   deleted → `MarkDeleted`;  added/modified/unclassified → БОХИРДСОН (Revit-ээс дахин унших ёстой).
        /// Буцаах утга = дахин унших id-ууд.  Revit-д ХҮРЭХГҮЙ — тэр нь дуудагчийн ажил.
        /// </summary>
        public List<long> ApplyChangeSet(RevitChangeSet set)
        {
            if (set == null) throw new ArgumentNullException(nameof(set));
            var dirty = new List<long>();
            var deleted = new HashSet<long>(set.Deleted);
            var seen = new HashSet<long>();
            lock (_gate)
            {
                foreach (long id in deleted) MarkDeleted(id);
                foreach (long id in set.DirtyIds())
                {
                    // Устгагдсан id нь «бохирдсон» БИШ — Revit-ээс дахин уншвал null ирнэ (§53).
                    if (deleted.Contains(id) || !seen.Add(id)) continue;
                    _dirty.Add(id);
                    dirty.Add(id);
                }
                _version++;
            }
            return dirty;
        }

        public void ClearDirty(IEnumerable<long> ids)
        {
            lock (_gate) foreach (long id in ids) _dirty.Remove(id);
        }

        public List<long> DirtyIds()
        {
            lock (_gate) return new List<long>(_dirty);
        }

        public void RecordTiming(Action<SceneGraphTiming> update)
        {
            lock (_gate) update(_timing);
        }

        /* ============================================================== */
        /*  УНШИЛТ — бүгд ХУУЛБАР буцаана                                  */
        /* ============================================================== */

        public SceneNode Get(long elementId)
        {
            lock (_gate)
            {
                SceneNode n;
                return _nodes.TryGetValue(elementId, out n) ? Clone(n) : null;
            }
        }

        public bool Contains(long elementId)
        {
            lock (_gate) return _nodes.ContainsKey(elementId);
        }

        public bool IsDirty(long elementId)
        {
            lock (_gate) return _dirty.Contains(elementId);
        }

        public List<SceneEdge> EdgesOf(long elementId, EdgeRelation? relation = null, bool authoritativeOnly = false)
        {
            var list = new List<SceneEdge>();
            lock (_gate)
            {
                HashSet<string> keys;
                if (!_incidence.TryGetValue(elementId, out keys)) return list;
                foreach (string k in keys)
                {
                    SceneEdge e;
                    if (!_edges.TryGetValue(k, out e)) continue;
                    if (relation != null && e.Relation != relation.Value) continue;
                    if (authoritativeOnly && !e.IsAuthoritative()) continue;
                    list.Add(CloneEdge(e));
                }
            }
            list.Sort((a, b) => a.Key().CompareTo(b.Key()));
            return list;
        }

        /// <summary>`from == elementId` ирмэгүүдийн `to` — жишээ нь хананы BOUNDS_ROOM → өрөөнүүд.</summary>
        public List<long> Neighbors(long elementId, EdgeRelation relation, bool authoritativeOnly = false)
        {
            var ids = new List<long>();
            foreach (SceneEdge e in EdgesOf(elementId, relation, authoritativeOnly))
            {
                if (e.From == elementId) ids.Add(e.To);
            }
            return ids;
        }

        /// <summary>`to == elementId` ирмэгүүдийн `from` — жишээ нь өрөөг хүрээлдэг ханууд.</summary>
        public List<long> Incoming(long elementId, EdgeRelation relation, bool authoritativeOnly = false)
        {
            var ids = new List<long>();
            foreach (SceneEdge e in EdgesOf(elementId, relation, authoritativeOnly))
            {
                if (e.To == elementId) ids.Add(e.From);
            }
            return ids;
        }

        /// <summary>Typed хайлт (§60).  Устгагдсан зангилаа ХЭЗЭЭ Ч буцахгүй.</summary>
        public List<SceneNode> Query(ElementQuery q)
        {
            if (q == null) q = new ElementQuery();
            var wantKinds = new HashSet<SceneNodeKind>(q.Kinds);
            var wantCats = new HashSet<string>(q.Categories, StringComparer.OrdinalIgnoreCase);
            var wantLevelNames = new HashSet<string>(q.LevelNames, StringComparer.OrdinalIgnoreCase);
            var wantLevelIds = new HashSet<long>(q.LevelIds);
            var wantIds = new HashSet<long>(q.ElementIds);
            var roomMembers = new HashSet<long>();
            foreach (long roomId in q.RoomIds)
            {
                foreach (long id in Incoming(roomId, EdgeRelation.BOUNDS_ROOM)) roomMembers.Add(id);
                foreach (long id in Incoming(roomId, EdgeRelation.INSIDE)) roomMembers.Add(id);
                foreach (long id in Incoming(roomId, EdgeRelation.FROM_ROOM)) roomMembers.Add(id);
                foreach (long id in Incoming(roomId, EdgeRelation.TO_ROOM)) roomMembers.Add(id);
            }
            string needle = string.IsNullOrWhiteSpace(q.NameContains) ? null : q.NameContains.Trim();
            int limit = q.Limit <= 0 ? 500 : q.Limit;

            var result = new List<SceneNode>();
            lock (_gate)
            {
                var ordered = new List<SceneNode>(_nodes.Values);
                ordered.Sort((a, b) => a.ElementId.CompareTo(b.ElementId));
                foreach (SceneNode n in ordered)
                {
                    if (n.Deleted) continue;
                    if (!q.IncludeLinked && n.Scope == ElementScope.LINKED_DOCUMENT) continue;
                    if (wantIds.Count > 0 && !wantIds.Contains(n.ElementId)) continue;
                    bool kindOk = wantKinds.Count == 0 || wantKinds.Contains(n.Kind);
                    bool catOk = wantCats.Count == 0 || (n.Category != null && wantCats.Contains(n.Category));
                    if (wantKinds.Count > 0 && wantCats.Count > 0) { if (!kindOk && !catOk) continue; }
                    else if (!kindOk || !catOk) continue;
                    if (wantLevelIds.Count > 0 && (n.LevelId == null || !wantLevelIds.Contains(n.LevelId.Value))) continue;
                    if (wantLevelNames.Count > 0 && (n.LevelName == null || !wantLevelNames.Contains(n.LevelName))) continue;
                    if (q.RoomIds.Count > 0 && !roomMembers.Contains(n.ElementId)) continue;
                    if (needle != null)
                    {
                        string hay = (n.Name ?? "") + " " + (n.TypeName ?? "") + " " + (n.Family ?? "");
                        if (hay.IndexOf(needle, StringComparison.OrdinalIgnoreCase) < 0) continue;
                    }
                    result.Add(Clone(n));
                    if (result.Count >= limit) break;
                }
            }
            return result;
        }

        public List<SceneNode> NodesOfKind(SceneNodeKind kind)
        {
            var q = new ElementQuery { Limit = int.MaxValue };
            q.Kinds.Add(kind);
            return Query(q);
        }

        public SceneGraphSnapshot Snapshot()
        {
            var s = new SceneGraphSnapshot { DocKey = DocKey, BuiltAt = BuiltAt };
            lock (_gate)
            {
                s.Version = _version;
                var nodes = new List<SceneNode>(_nodes.Values);
                nodes.Sort((a, b) => a.ElementId.CompareTo(b.ElementId));
                foreach (SceneNode n in nodes) s.Nodes.Add(Clone(n));
                var edges = new List<SceneEdge>(_edges.Values);
                edges.Sort((a, b) => a.Key().CompareTo(b.Key()));
                foreach (SceneEdge e in edges) s.Edges.Add(CloneEdge(e));
                s.Timing = new SceneGraphTiming
                {
                    IndexMs = _timing.IndexMs, IndexNodes = _timing.IndexNodes,
                    RelationsMs = _timing.RelationsMs, RelationsNodes = _timing.RelationsNodes,
                    GeometryMs = _timing.GeometryMs, GeometryNodes = _timing.GeometryNodes,
                    BudgetExhausted = _timing.BudgetExhausted,
                };
            }
            return s;
        }

        /* ============================================================== */
        /*  Дотоод                                                         */
        /* ============================================================== */

        private HashSet<string> Incident(long id)
        {
            HashSet<string> set;
            if (!_incidence.TryGetValue(id, out set))
            {
                set = new HashSet<string>(StringComparer.Ordinal);
                _incidence[id] = set;
            }
            return set;
        }

        private void RemoveEdgeKey(string key)
        {
            SceneEdge e;
            if (!_edges.TryGetValue(key, out e)) return;
            _edges.Remove(key);
            HashSet<string> s;
            if (_incidence.TryGetValue(e.From, out s)) s.Remove(key);
            if (_incidence.TryGetValue(e.To, out s)) s.Remove(key);
        }

        internal static SceneNode Clone(SceneNode n)
        {
            var c = new SceneNode
            {
                ElementId = n.ElementId, UniqueId = n.UniqueId, Kind = n.Kind, Category = n.Category,
                Family = n.Family, TypeName = n.TypeName, Name = n.Name, LevelId = n.LevelId,
                LevelName = n.LevelName, HostId = n.HostId, Scope = n.Scope, Detail = n.Detail,
                BoundingBox = n.BoundingBox, Worksharing = n.Worksharing, Version = n.Version, Deleted = n.Deleted,
            };
            if (n.Measures != null) c.Measures = new List<Measure>(n.Measures);
            if (n.Flags != null) c.Flags = new List<string>(n.Flags);
            return c;
        }

        private static SceneEdge CloneEdge(SceneEdge e)
        {
            return new SceneEdge
            {
                From = e.From, To = e.To, Relation = e.Relation, Source = e.Source,
                Confidence = e.Confidence, Version = e.Version,
            };
        }
    }
}
