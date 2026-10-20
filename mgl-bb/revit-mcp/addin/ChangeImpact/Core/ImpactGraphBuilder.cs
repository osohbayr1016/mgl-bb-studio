using System;
using System.Collections.Generic;
using System.Linq;

namespace RevitMcpAddin.ChangeImpact.Core
{
    /// <summary>
    /// Нөлөөллийн графыг ХЯЗГААРТАЙ, ХЭСЭГЛЭН байгуулна — Revit-гүй ЦЭВЭР алгоритм.
    ///
    ///   • Эх сурвалж (өөрчлөгдсөн элемент) бүр A итгэлтэй эхэлнэ.
    ///   • Зангилаа бүрийг ЗӨВХӨН НЭГ удаа дэлгэнэ (`expand` → холбоо).  Дараалал нь «хамгийн хүчтэй итгэл эхэнд»
    ///     (bottleneck / widest-path): зангилааг анх гаргасан үед аль хэдийн хамгийн хүчтэй замаар ирсэн байна.
    ///   • Замын итгэл = холбоосуудын ХАМГИЙН СУЛ нь (`ImpactConf.Weaker`) — итгэл ХЭЗЭЭ Ч дээшлэхгүй.
    ///   • Давталт (cycle), давхардал: `_best` толь — нэг зангилаа дахин илүү сул/урт замаар орохгүй.
    ///   • Тэсрэлтээс хамгаалалт: `MaxDepth`, `MaxNodes`, `MaxEdgesPerNode`, `MaxExpansions` — ХЭТРЭХЭД чимээгүй
    ///     таслахгүй, `Notes`-д ИЛ тэмдэглэж `Complete = false` болгоно.
    ///   • `expand` алдаа шидвэл тэр зангилаа алгасагдаж тэмдэглэгдэнэ — бүх шинжилгээ унахгүй.
    ///
    /// Алхмууд (`Step`) нь дуудагчид Revit-ийн хугацааны хэсэгт тааруулан цуцлах боломж олгоно.
    /// </summary>
    public sealed class ImpactGraphBuilder
    {
        private sealed class Best
        {
            public long Id;
            public ImpactConfidence Conf;
            public int Depth;
            public long ParentId = -1;
            public ImpactEdge Edge;
            public long Source;
            public int Paths = 1;
            public bool Expanded;
        }

        private readonly Func<long, IReadOnlyList<ImpactEdge>> _expand;
        private readonly ImpactLimits _limits;
        private readonly Dictionary<long, Best> _best = new Dictionary<long, Best>();
        private readonly PriorityQueue<long, (int rank, int depth, long order)> _queue = new PriorityQueue<long, (int, int, long)>();
        private readonly HashSet<long> _sources = new HashSet<long>();
        private readonly List<string> _notes = new List<string>();
        private long _order;
        private int _expanded, _edgesSeen;
        private bool _nodeLimitHit, _expansionLimitHit, _depthLimited, _fanoutTruncated, _expandFailed;
        private int _fanoutDropped, _failures, _depthStopped;

        public ImpactGraphBuilder(IEnumerable<SourceChange> sources, Func<long, IReadOnlyList<ImpactEdge>> expand, ImpactLimits limits = null)
        {
            _expand = expand ?? throw new ArgumentNullException("expand");
            _limits = limits ?? new ImpactLimits();
            foreach (SourceChange s in sources ?? new SourceChange[0])
            {
                if (_best.ContainsKey(s.Id)) continue;
                _sources.Add(s.Id);
                _best[s.Id] = new Best { Id = s.Id, Conf = ImpactConfidence.A, Depth = 0, Source = s.Id };
                Enqueue(s.Id, ImpactConfidence.A, 0);
            }
        }

        private void Enqueue(long id, ImpactConfidence conf, int depth)
        {
            _queue.Enqueue(id, (ImpactConf.Rank(conf), depth, _order++));
        }

        public int Expanded { get { return _expanded; } }
        public bool IsDone { get { return _queue.Count == 0 || _expansionLimitHit; } }

        /// <summary>Хамгийн ихдээ `maxExpansions` зангилааг дэлгэнэ.  true = ДУУССАН.</summary>
        public bool Step(int maxExpansions)
        {
            int n = 0;
            while (n < Math.Max(1, maxExpansions) && !_expansionLimitHit && _queue.TryDequeue(out long id, out (int rank, int depth, long order) pri))
            {
                Best b = _best[id];
                if (b.Expanded || ImpactConf.Rank(b.Conf) != pri.rank || b.Depth != pri.depth) continue;     // хуучирсан бичлэг
                if (_expanded >= _limits.MaxExpansions) { _expansionLimitHit = true; break; }

                b.Expanded = true;
                _expanded++;
                n++;

                if (b.Depth >= _limits.MaxDepth) { _depthLimited = true; _depthStopped++; continue; }

                IReadOnlyList<ImpactEdge> edges;
                try { edges = _expand(id) ?? new ImpactEdge[0]; }
                catch (Exception)
                {
                    _expandFailed = true;
                    _failures++;
                    continue;
                }

                if (edges.Count > _limits.MaxEdgesPerNode)
                {
                    _fanoutTruncated = true;
                    _fanoutDropped += edges.Count - _limits.MaxEdgesPerNode;
                    edges = edges.OrderBy(e => ImpactConf.Rank(e.Confidence)).ThenBy(e => e.To).Take(_limits.MaxEdgesPerNode).ToList();
                }

                foreach (ImpactEdge e in edges)
                {
                    _edgesSeen++;
                    if (e.To == id) continue;
                    ImpactConfidence conf = ImpactConf.Weaker(b.Conf, e.Confidence);
                    int depth = b.Depth + 1;

                    Best existing;
                    if (!_best.TryGetValue(e.To, out existing))
                    {
                        if (_best.Count >= _limits.MaxNodes) { _nodeLimitHit = true; continue; }
                        _best[e.To] = new Best { Id = e.To, Conf = conf, Depth = depth, ParentId = id, Edge = e, Source = b.Source };
                        Enqueue(e.To, conf, depth);
                    }
                    else
                    {
                        if (existing.Paths < 8) existing.Paths++;
                        bool stronger = ImpactConf.IsStronger(conf, existing.Conf)
                            || (ImpactConf.Rank(conf) == ImpactConf.Rank(existing.Conf) && depth < existing.Depth);
                        if (stronger && !existing.Expanded && !_sources.Contains(e.To))
                        {
                            existing.Conf = conf;
                            existing.Depth = depth;
                            existing.ParentId = id;
                            existing.Edge = e;
                            existing.Source = b.Source;
                            Enqueue(e.To, conf, depth);
                        }
                    }
                }
            }
            return IsDone;
        }

        /// <summary>Бүгдийг нэг дуудлагаар (тест, жижиг граф).</summary>
        public ImpactGraph RunAll()
        {
            while (!Step(1 << 20)) { }
            return Build();
        }

        public ImpactGraph Build()
        {
            var g = new ImpactGraph { SourceCount = _sources.Count, Expanded = _expanded, EdgesSeen = _edgesSeen };
            foreach (Best b in _best.Values)
            {
                if (_sources.Contains(b.Id)) continue;
                var t = new ImpactTarget { Id = b.Id, Confidence = b.Conf, Depth = b.Depth, SourceId = b.Source, PathCount = b.Paths };
                t.Path = PathOf(b);
                g.Targets[b.Id] = t;
            }

            if (_nodeLimitHit) _notes.Add("Зангилааны хязгаар (" + _limits.MaxNodes + ") хэтэрсэн — нөлөөлөл бүрэн биш.");
            if (_expansionLimitHit) _notes.Add("Дэлгэх хязгаар (" + _limits.MaxExpansions + ") хэтэрсэн — нөлөөлөл бүрэн биш.");
            if (_fanoutTruncated) _notes.Add("Хэт олон холбоотой зангилаа (>" + _limits.MaxEdgesPerNode + ") байсан — нийт " + _fanoutDropped + " сул холбоо орхигдсон, зөвхөн хамгийн хүчтэйг нь авлаа.");
            if (_expandFailed) _notes.Add(_failures + " зангилааны холбоог уншиж чадсангүй (алгассан) — нөлөөлөл бүрэн биш.");
            if (_depthLimited) _notes.Add(_depthStopped + " зангилаа " + _limits.MaxDepth + "-н гүнээс цааш дэлгэгдээгүй.");
            g.Notes.AddRange(_notes);

            // ⚠️ Дэлгээгүй үлдсэн бүх шалтгаан «бүрэн БИШ» — гүн, холбооны тооны хязгаар ч (сул холбоо орхигдсон, цааш дэлгэгдээгүй).
            if (_nodeLimitHit) g.IncompleteReasons.Add("зангилааны хязгаар (" + _limits.MaxNodes + ")");
            if (_expansionLimitHit) g.IncompleteReasons.Add("дэлгэх хязгаар (" + _limits.MaxExpansions + ")");
            if (_expandFailed) g.IncompleteReasons.Add(_failures + " зангилааны холбоо уншигдаагүй");
            if (_fanoutTruncated) g.IncompleteReasons.Add("хэт олон холбоотой зангилаа (>" + _limits.MaxEdgesPerNode + ", " + _fanoutDropped + " сул холбоо орхигдсон)");
            if (_depthLimited) g.IncompleteReasons.Add(_depthStopped + " зангилаа " + _limits.MaxDepth + "-н гүнээс цааш дэлгэгдээгүй");
            g.Complete = IsDone && g.IncompleteReasons.Count == 0;
            return g;
        }

        private List<ImpactEdge> PathOf(Best b)
        {
            var edges = new List<ImpactEdge>();
            Best cur = b;
            int guard = 0;
            while (cur != null && cur.Edge != null && guard++ < 64)
            {
                edges.Add(cur.Edge);
                Best parent;
                if (!_best.TryGetValue(cur.ParentId, out parent)) break;
                cur = parent;
            }
            edges.Reverse();
            return edges;
        }
    }

    /// <summary>
    /// Нөлөөллийн ТАЙЛБАР — «яагаад?».  Шууд (A) алхмыг таамагласан алхмаас ЯЛГАЖ харуулна; нийт итгэл нь
    /// хамгийн сул холбоосоор тодорхойлогдохыг хэлнэ.
    /// </summary>
    public static class ImpactExplainer
    {
        /// <summary>Тайлангийн мөрийн ТАЙЛБАР (шошго нь хуулсан тул элемент устсан ч харагдана).</summary>
        public static List<string> Describe(ImpactItem item)
        {
            var lines = new List<string>();
            string verb = item.SourceChange == ChangeKind.Deleted ? "устсан" : item.SourceChange == ChangeKind.Added ? "нэмэгдсэн" : "өөрчлөгдсөн";
            lines.Add("«" + (item.SourceLabel ?? ("#" + item.SourceId)) + "» " + verb + ".");
            foreach (ImpactPathStepView s in item.Path)
            {
                string kind = ImpactConf.Normalize(s.Confidence) == ImpactConfidence.A ? "шууд" : "таамаг";
                lines.Add("  → [" + ImpactConf.Letter(s.Confidence) + " " + kind + "] «" + s.ToLabel + "» — " + (s.Reason ?? s.Relationship));
            }
            if (item.Path.Count > 1)
            {
                ImpactPathStepView weakest = item.Path.OrderByDescending(p => ImpactConf.Rank(p.Confidence)).First();
                lines.Add("Нийт итгэл: " + ImpactConf.Letter(item.Confidence) + " · " + ImpactConf.Label(item.Confidence)
                    + " (хамгийн сул холбоо: «" + (weakest.Reason ?? weakest.Relationship) + "»).");
            }
            else lines.Add("Нийт итгэл: " + ImpactConf.Letter(item.Confidence) + " · " + ImpactConf.Label(item.Confidence) + ".");
            lines.Add(ImpactConf.Meaning(item.Confidence));
            if (item.PathCount > 1) lines.Add("Бусад " + (item.PathCount - 1) + " зам ч энэ зүйлд хүрнэ (хамгийн хүчтэйг нь харуулав).");
            return lines;
        }

        public static List<string> Describe(ImpactTarget t, Func<long, string> label, ChangeKind sourceKind = ChangeKind.Modified)
        {
            var lines = new List<string>();
            string verb = sourceKind == ChangeKind.Deleted ? "устсан" : sourceKind == ChangeKind.Added ? "нэмэгдсэн" : "өөрчлөгдсөн";
            lines.Add("«" + label(t.SourceId) + "» " + verb + ".");
            foreach (ImpactEdge e in t.Path)
            {
                string kind = ImpactConf.Normalize(e.Confidence) == ImpactConfidence.A ? "шууд" : "таамаг";
                lines.Add("  → [" + ImpactConf.Letter(e.Confidence) + " " + kind + "] «" + label(e.To) + "» — " + (e.Reason ?? e.Relationship));
            }
            if (t.Path.Count > 1)
            {
                ImpactEdge weakest = t.Path.OrderByDescending(e => ImpactConf.Rank(e.Confidence)).First();
                lines.Add("Нийт итгэл: " + ImpactConf.Letter(t.Confidence) + " · " + ImpactConf.Label(t.Confidence)
                    + " (хамгийн сул холбоо: «" + (weakest.Reason ?? weakest.Relationship) + "»).");
            }
            else lines.Add("Нийт итгэл: " + ImpactConf.Letter(t.Confidence) + " · " + ImpactConf.Label(t.Confidence) + ".");
            if (t.PathCount > 1) lines.Add("Бусад " + (t.PathCount - 1) + " зам ч энэ зүйлд хүрнэ (хамгийн хүчтэйг нь харуулав).");
            return lines;
        }
    }
}
