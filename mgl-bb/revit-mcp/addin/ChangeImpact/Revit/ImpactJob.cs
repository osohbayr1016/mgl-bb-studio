using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;
using RevitMcpAddin.ChangeImpact.Core;
using RevitMcpAddin.Smart;
using RevitMcpAddin.Smart.Core;

namespace RevitMcpAddin.ChangeImpact
{
    /// <summary>
    /// Өөрчлөлтийн нөлөөллийн ХЭСЭГЛЭСЭН шинжилгээ (`SmartExecutor`).
    ///
    ///   Prepare → Sources → Indexes → Graph1 → PostPlan → Post → Graph2 → Report
    ///
    ///   Prepare   хүлээгдэж буй өөрчлөлтийн идентитиг уншина
    ///   Sources   сонгосон муж дахь өөрчлөлтийг НЭГТГЭНЭ (нэг элемент → сүүлийн төлөв; нэмэгдээд устсан = цэвэр 0)
    ///   Indexes   бүтцийн индекс (хуудас/viewport, харагдац, tag, хэмжээс) — Step бүрд нэг
    ///   Graph1    ТОДОРХОЙ холбоогоор (A, B) граф — харагдалт ҮГҮЙ
    ///   PostPlan  хүрсэн элементүүдээс «магадгүй харагдах» нэр дэвшигчдийг сонгоно
    ///   Post      өрөөний хил, харагдалт (харагдац бүрээр), хүснэгтийн мөр — ХУРДАН БИШ, цуцлах боломжтой
    ///   Graph2    бүх холбоотой (C, D нэмэгдсэн) граф — бүтцийн холбоо кэштэй тул хурдан
    ///   Report    зорилт бүрийг шалтгаан, замтай нь тайлан болгож хадгална
    ///
    /// ГЭРЭЭ: Step бүр Revit-ийн амьд обьект ХАДГАЛАХГҮЙ (id л); загварыг ӨӨРЧИЛӨХГҮЙ; цуцлалт Step-ийн хооронд;
    /// Step бүр ≤ ~100 мс (харагдац бүр ганц удаа удаан байж болно).
    /// </summary>
    internal sealed class ImpactJob : ISmartJob
    {
        private enum Phase { Prepare, Sources, SourceNodes, Indexes, Graph1, PostPlan, Post, Graph2, Report, Done }

        private const int StepMs = 100;
        private const int MaxSources = 20000;
        private const int MaxCandidates = 5000;

        private readonly ImpactRequest _req;
        private readonly DocumentKey _key;
        private readonly IProgress<JobProgress> _progress;
        private readonly StageTimer _timer = new StageTimer();
        private readonly List<string> _notes = new List<string>();

        private Phase _phase = Phase.Prepare;
        private Document _doc;
        private ResolverHub _hub;
        private string _stamp;
        private List<SourceChange> _sources = new List<SourceChange>();
        private Dictionary<long, ChangeKind> _kindById = new Dictionary<long, ChangeKind>();
        /// <summary>Бүртгэлийн мөрүүд (идентити нь өөрчлөлтийн үед авсан) — элемент одоо уншигдахгүй үед нөөц эх сурвалж.</summary>
        private Dictionary<long, ChangeEntry> _entries = new Dictionary<long, ChangeEntry>();
        private int _srcCursor, _unknownSources;
        private int _added, _modified, _deleted, _unresolvedDeleted, _droppedBatches;
        private int _truncatedBatches, _deletedUnderivable;
        private bool _sourcesTruncated, _hasGlobal;
        private bool _logGap, _trackingDisabled, _baselineUsed, _baselineFailed;
        private string _logGapReason, _baselineFailedReason;
        private ImpactGraphBuilder _builder;
        private ImpactGraph _graph1, _graph2;
        private long _fromSeq, _toSeq;

        public ImpactReport Result { get; private set; }
        public string Name { get { return "Change Impact"; } }

        internal ImpactJob(ImpactRequest req, DocumentKey key, IProgress<JobProgress> progress)
        {
            _req = req;
            _key = key;
            _progress = progress;
        }

        public bool Step(UIApplication app)
        {
            Document doc = ActiveDocument(app);
            var sw = Stopwatch.StartNew();
            switch (_phase)
            {
                case Phase.Prepare: Prepare(doc); break;
                case Phase.Sources: BuildSources(doc); break;
                case Phase.SourceNodes: SourceNodesStep(sw); break;
                case Phase.Indexes: IndexStep(); break;
                case Phase.Graph1: GraphStep(sw, false); break;
                case Phase.PostPlan: PostPlan(); break;
                case Phase.Post: PostStep(); break;
                case Phase.Graph2: GraphStep(sw, true); break;
                case Phase.Report: BuildReport(doc); break;
            }
            return _phase == Phase.Done;
        }

        public void OnCancelled()
        {
            // Хадгалагдсан зүйл байхгүй (тайлан эцэст нь л хадгалагдана) — цэвэрлэх юм алга.
        }

        private Document ActiveDocument(UIApplication app)
        {
            UIDocument ui = app.ActiveUIDocument;
            Document doc = ui != null ? ui.Document : null;
            if (doc == null) throw new InvalidOperationException("Идэвхтэй баримт алга.");
            if (!_key.Equals(RevitDocumentKeys.Of(doc)))
                throw new InvalidOperationException("Идэвхтэй файл солигдсон — шинжилгээ эхэлсэн файл руугаа буцна уу.");
            if (_doc == null) _doc = doc;
            else if (!SmartDocs.IsAlive(_doc) || !SmartDocs.Same(_doc, doc))      // хаагдсан wrapper-ийн `Equals`-д найдахгүй (undocumented)
                throw new InvalidOperationException("Баримт хаагдаж дахин нээгдсэн — шинжилгээг дахин эхлүүлнэ үү.");
            else _doc = doc;
            return doc;
        }

        private void Report(string stage, string message, int done = 0, int total = 0)
        {
            if (_progress != null) _progress.Report(JobProgress.Of(stage, done, total, message));
        }

        /* ============================== PREPARE ============================ */

        private void Prepare(Document doc)
        {
            _timer.Begin("capture");
            _stamp = ModelChangeCounter.Stamp(doc);
            if (_hub == null) _hub = new ResolverHub(doc);

            ImpactCapture.DocTracker t = ImpactCapture.TrackerFor(doc);
            int left = ImpactCapture.ResolveSome(t, doc, 1500);
            Report("capture", "Өөрчлөлтийн идентитиг уншиж байна", 0, left);
            if (left > 0) return;                  // дараагийн Step-д үргэлжилнэ
            _phase = Phase.Sources;
        }

        /* ============================== SOURCES ============================ */

        private void BuildSources(Document doc)
        {
            _timer.Begin("sources");
            int dropped;
            List<ChangeBatch> all = ImpactCapture.Snapshot(doc, out dropped);
            _droppedBatches = dropped;

            List<ExtraChange> extra = !string.IsNullOrEmpty(_req.BaselineVersionGuid) ? VersionDiff(doc) : null;
            AggregatedChanges agg = ChangeAggregator.Aggregate(all, _req.FromSeqExclusive, _req.ToSeqInclusive, _req.OnlyBatchSeqs, MaxSources, extra);

            _fromSeq = agg.FromSeq;
            _toSeq = agg.ToSeq;
            _sources = agg.Sources;
            _added = agg.Added;
            _modified = agg.Modified;
            _deleted = agg.Deleted;
            _unresolvedDeleted = agg.UnresolvedDeleted;
            _sourcesTruncated = agg.Truncated;
            _truncatedBatches = agg.TruncatedBatches;
            _deletedUnderivable = agg.DeletedUnderivable;
            _notes.AddRange(agg.Notes);

            // ЦООРХОЙ: сонгосон мужид бүртгэл бүрэн эсэх (trim / цэвэрлэсэн / унтраасан / handler алдсан / хаалтын үеийн хадгалалт амжилтгүй / файл
            // уншигдаагүй / тохиргоо уншигдаагүй) — чимээгүй «олдсонгүй» БИШ.
            long lostThrough, trackingGapThrough;
            bool enabled, logUnreadable, settingsUnreadable;
            ImpactCapture.GapInfo(doc, out lostThrough, out trackingGapThrough, out enabled, out logUnreadable, out settingsUnreadable);
            string gapReason;
            _logGap = ImpactCompleteness.HasLogGap(_req.FromSeqExclusive, lostThrough, trackingGapThrough, logUnreadable, out gapReason, settingsUnreadable);
            _logGapReason = gapReason;
            _trackingDisabled = !enabled;
            foreach (SourceChange s in _sources) _kindById[s.Id] = s.Kind;
            _entries = agg.Entries ?? new Dictionary<long, ChangeEntry>();

            // Устсан элементийн мэдээлэл (бүртгэлийн мөрөөс) — резольверууд амьд элементгүйгээр ч ажиллахын тулд.
            foreach (SourceChange s in _sources)
            {
                ChangeEntry ce;
                if (s.Kind == ChangeKind.Deleted && _entries.TryGetValue(s.Id, out ce) && ce.Known)
                    _hub.Seed(ImpactSnapshotter.FromEntry(ce));
            }

            // Эх сурвалж бүрийн зангилааг (Revit-ээс уншина) дараагийн `SourceNodes` алхмуудад ХЭСЭГЛЭН уншина — 20 000 элементийг нэг Step-д уншвал Revit гацна.
            _srcCursor = 0;
            Report("sources", _sources.Count + " өөрчилсөн элемент шинжилнэ");
            _phase = _sources.Count == 0 ? Phase.Report : Phase.SourceNodes;
        }

        /// <summary>
        /// Эх сурвалж бүрийн зангилааг (идентити) хугацаатай хэсгээр уншина (≤ `StepMs`).  Уншигдахгүй (хаалттай workset, линк, дараа нь устсан) эх сурвалжийг
        /// бүртгэлийн мөрөөс (өөрчлөлтийн үед авсан идентити) сэргээнэ; тэр ч байхгүй бол ТООЛЖ «бүрэн БИШ» гэж ИЛ хэлнэ (чимээгүй алгасахгүй).
        /// </summary>
        private void SourceNodesStep(Stopwatch sw)
        {
            _timer.Begin("sources");
            while (_srcCursor < _sources.Count && sw.ElapsedMilliseconds < StepMs)
            {
                SourceChange s = _sources[_srcCursor++];
                ImpactNode n = _hub.Node(s.Id);
                if (n.Unknown)
                {
                    ChangeEntry ce;
                    if (_entries.TryGetValue(s.Id, out ce) && ce.Known)
                    {
                        _hub.Seed(ImpactSnapshotter.FromEntry(ce));
                        n = _hub.Node(s.Id);
                    }
                }
                // Устсан + мэдээлэлгүй нь `UnresolvedDeleted`-д тусдаа тоологдоно (давхар тайлбар өгөхгүй).
                if (n.Unknown) { if (s.Kind != ChangeKind.Deleted) _unknownSources++; }
                else if (n.Kind == ImpactNodeKind.Global) _hasGlobal = true;
            }
            Report("sources", "Өөрчилсөн элементийг уншиж байна", _srcCursor, _sources.Count);
            if (_srcCursor >= _sources.Count) _phase = Phase.Indexes;
        }

        /// <summary>Revit-ийн хувилбарын түүхээс (бидний бүртгэлд ОРООГҮЙ) өөрчлөлт.  Бүх алдаа — тэмдэглэл.</summary>
        private List<ExtraChange> VersionDiff(Document doc)
        {
            var extra = new List<ExtraChange>();
            try
            {
                Guid g;
                if (!Guid.TryParse(_req.BaselineVersionGuid, out g))
                {
                    _notes.Add("Revit-ийн хувилбарын GUID буруу — алгасав.");
                    _baselineFailed = true;
                    _baselineFailedReason = "GUID буруу";
                    return extra;
                }
                long seq = ImpactSeq.Mark();
                using (DocumentDifference diff = doc.GetChangedElements(g))
                {
                    Action<IEnumerable<ElementId>, ChangeKind> take = (ids, kind) =>
                    {
                        foreach (ElementId id in ids) extra.Add(new ExtraChange { Id = id.Value, Kind = kind, Seq = seq });
                    };
                    take(diff.GetCreatedElementIds(), ChangeKind.Added);
                    take(diff.GetModifiedElementIds(), ChangeKind.Modified);

                    // ⚠️ Revit-ийн баримтжуулалт: workshare-гүй загварт УСТГАСАН элементийг DocumentDifference ХӨТЛӨДӨГГҮЙ
                    // (устгасан id-ийн жагсаалт үргэлж хоосон).  «Устгал олдсонгүй» гэж ХЭЗЭЭ Ч дүгнэхгүй.
                    if (diff.AreDeletedElementIdsAvailable) take(diff.GetDeletedElementIds(), ChangeKind.Deleted);
                    if (!doc.IsWorkshared || !diff.AreDeletedElementIdsAvailable)
                        _notes.Add("⚠ Revit-ийн хувилбарын түүх энэ загварт УСТГАСАН элементийг хөтөлдөггүй (workshare-гүй) — устгал зөвхөн манай бүртгэлээс; «устгал алга» гэж дүгнэх БОЛОМЖГҮЙ.");
                }
                _baselineUsed = true;
                _notes.Add("Revit-ийн хувилбарын түүхээс " + extra.Count + " өөрчлөлт авлаа (бидний бүртгэлд байгаа нь давхардахгүй) — ⚠ Revit-ийн version GUID бүх өөрчлөлтөд шинэчлэгддэггүй тул энэ нь нэмэлт нотолгоо л.");
            }
            catch (Autodesk.Revit.Exceptions.ArgumentException)
            {
                _notes.Add("Revit-ийн хувилбарын түүх олдсонгүй (GUID энэ баримтад хүчингүй) — зөвхөн манай бүртгэлийг ашиглав.");
                _baselineFailed = true;
                _baselineFailedReason = "GUID энэ баримтад хүчингүй";
            }
            catch (Exception ex)
            {
                _notes.Add("Revit-ийн хувилбарын түүхийг уншиж чадсангүй (" + ex.GetType().Name + ").");
                _baselineFailed = true;
                _baselineFailedReason = ex.GetType().Name;
            }
            return extra;
        }

        /* ============================== INDEXES ============================ */

        private void IndexStep()
        {
            _timer.Begin("indexes");
            string built = _hub.NextStructuralIndex();
            if (built != null) { Report("indexes", "Индекс бэлдэж байна: " + built); return; }
            _builder = new ImpactGraphBuilder(_sources, id => _hub.Combined(id, false), _req.Limits);
            _phase = Phase.Graph1;
        }

        /* ============================== GRAPH ============================== */

        private void GraphStep(Stopwatch sw, bool second)
        {
            _timer.Begin(second ? "graph2" : "graph1");
            bool done = false;
            // Нэг зангилаа дэлгэх нь Revit-ийн олон дуудлага болж болох тул хугацааг зангилаа бүрийн дараа шалгана.
            while (!done && sw.ElapsedMilliseconds < StepMs) done = _builder.Step(1);
            Report(second ? "graph2" : "graph1", "Нөлөөллийн граф (" + _builder.Expanded + " зангилаа)");
            if (!done) return;

            if (!second)
            {
                _graph1 = _builder.Build();
                _phase = Phase.PostPlan;
            }
            else
            {
                _graph2 = _builder.Build();
                _phase = Phase.Report;
            }
        }

        /* ============================== POST =============================== */

        private void PostPlan()
        {
            _timer.Begin("post_plan");
            bool wantAny = _req.IncludeVisibility || _req.IncludeSchedules || _req.IncludeRooms;
            if (!wantAny || _sources.Count == 0)
            {
                _graph2 = _graph1;
                _phase = Phase.Report;
                return;
            }

            // Нэр дэвшигч = амьд, view-specific БИШ загварын элемент (эх сурвалж + граф хүрсэн).  Эх сурвалж + хүчтэй нь эхэнд.
            var ordered = new List<long>();
            foreach (SourceChange s in _sources) ordered.Add(s.Id);
            foreach (ImpactTarget t in _graph1.Targets.Values.OrderBy(x => ImpactConf.Rank(x.Confidence)).ThenBy(x => x.Depth)) ordered.Add(t.Id);

            var cands = new List<long>();
            var seen = new HashSet<long>();
            foreach (long id in ordered)
            {
                if (!seen.Add(id)) continue;
                ImpactNode n = _hub.Node(id);
                if (n.Unknown || n.ViewSpecific) continue;
                if (n.Kind != ImpactNodeKind.Element && n.Kind != ImpactNodeKind.Room && n.Kind != ImpactNodeKind.Link && n.Kind != ImpactNodeKind.Group) continue;
                if (_hub.Live(id) == null) continue;               // устсан элемент харагдацад харагдахгүй
                cands.Add(id);
            }

            _hub.BeginPost(cands, _req.IncludeRooms, _req.IncludeVisibility, _req.IncludeSchedules, MaxCandidates);
            _phase = Phase.Post;
        }

        private void PostStep()
        {
            _timer.Begin("post");
            bool done = _hub.PostStep(80);
            Report("post", (_hub.PostStage ?? "Харагдалт") + " шалгаж байна", _hub.PostDone, _hub.PostTotal);
            if (!done) return;
            _builder = new ImpactGraphBuilder(_sources, id => _hub.Combined(id, true), _req.Limits);
            _phase = Phase.Graph2;
        }

        /* ============================== REPORT ============================= */

        private void BuildReport(Document doc)
        {
            _timer.Begin("report");
            // Эх сурвалж 0 = дэлгэх зүйл байхгүй → граф «бүрэн» (хоосон).  Цоорхойг тусад нь (`LogGap`) шалгана.
            ImpactGraph g = _graph2 ?? _graph1 ?? new ImpactGraph { Complete = true };

            var report = new ImpactReport
            {
                Utc = SmartClock.UtcNow, FromSeq = _fromSeq, ToSeq = _toSeq, Status = RunStatus.Succeeded,
                SourceCount = _sources.Count, Added = _added, Modified = _modified, Deleted = _deleted,
                ModelStamp = _stamp, HasGlobalChange = _hasGlobal, UnresolvedDeleted = _unresolvedDeleted, DroppedBatches = _droppedBatches,
                LogGap = _logGap, TruncatedBatches = _truncatedBatches, DeletedUnderivable = _deletedUnderivable,
                BaselineUsed = _baselineUsed, BaselineFailed = _baselineFailed,
            };

            int unknownTargets = 0;
            foreach (ImpactTarget t in g.Targets.Values)
            {
                ImpactNode n = _hub.Node(t.Id);
                if (n.Unknown) { unknownTargets++; continue; }         // мэдээлэлгүй зорилтыг харуулахгүй — гэхдээ ТООЛЖ «бүрэн биш» гэж ИЛ хэлнэ
                report.Items.Add(ToItem(t, n));
            }

            // ШУУД өөрчлөгдсөн хуудас/харагдац/хүснэгт нь өөрөө «нөлөөлөгдсөн» (A): тэд графын ЭХ СУРВАЛЖ тул зорилтод ордоггүй —
            // тусад нь нэмэхгүй бол хуудасны өөрийнх нь өөрчлөлт (title block, нэр) Smart Publish-д ХЭЗЭЭ Ч харагдахгүй.
            foreach (SourceChange src in _sources)
            {
                ImpactNode n = _hub.Node(src.Id);
                if (n.Unknown) continue;
                if (n.Kind != ImpactNodeKind.Sheet && n.Kind != ImpactNodeKind.View && n.Kind != ImpactNodeKind.Schedule) continue;
                report.Items.Add(SelfItem(src, n));
            }
            report.Items = report.Items
                .OrderBy(i => ImpactConf.Rank(i.Confidence))
                .ThenBy(i => KindOrder(i.Kind))
                .ThenBy(i => i.SheetNumber ?? i.Name ?? "", StringComparer.CurrentCultureIgnoreCase)
                .ToList();

            report.Notes.AddRange(_notes);
            report.Notes.AddRange(_hub.Notes);
            report.Notes.AddRange(g.Notes);
            report.Notes.Add("Линк загварын ДОТОРХ өөрчлөлт бүртгэгдэхгүй (зөвхөн энэ баримтын өөрчлөлт).");
            if (_hasGlobal)
                report.Notes.Add("Төслийн ерөнхий тохиргоо өөрчлөгдсөн — олон харагдац/хуудсанд нөлөөлж болно (нарийвчлан тооцоолоогүй).");

            // «БҮРЭН БИШ»-ийн ГАНЦ эх сурвалж — `ImpactCompleteness` (бүх хязгаар, цоорхой, шалгаагүй хэсэг).
            var skipped = new List<string>();
            if (_sources.Count > 0)
            {
                if (!_req.IncludeVisibility) skipped.Add("Харагдалтын шинжилгээг сонгоогүй — «магадгүй харагдах» (C) нөлөөлөл тооцогдоогүй.");
                if (!_req.IncludeSchedules) skipped.Add("Хүснэгтийн шинжилгээг сонгоогүй — хүснэгтэд орсон элементийн (C, D) нөлөөлөл тооцогдоогүй.");
                if (!_req.IncludeRooms) skipped.Add("Өрөөний хилийн шинжилгээг сонгоогүй — өрөөний хилийн (B) нөлөөлөл тооцогдоогүй.");
            }
            List<string> reasons = ImpactCompleteness.Reasons(new CompletenessInputs
            {
                GraphComplete = g.Complete,
                GraphReasons = g.IncompleteReasons,
                ResolverFailures = _hub.ResolverFailures,
                ResolverTruncations = _hub.Truncations,
                TruncationReasons = _hub.TruncationReasons,
                GlobalUnenumerated = _hub.GlobalUnenumerated,
                SourcesTruncated = _sourcesTruncated,
                TruncatedBatches = _truncatedBatches,
                UnresolvedDeleted = _unresolvedDeleted,
                DeletedUnderivable = _deletedUnderivable,
                LogGap = _logGap,
                LogGapReason = _logGapReason,
                TrackingDisabled = _trackingDisabled,
                SkippedAnalyses = skipped,
                BaselineFailed = _baselineFailed,
                BaselineFailedReason = _baselineFailedReason,
                UnknownTargets = unknownTargets,
                UnknownSources = _unknownSources,
                UnreadableLinks = _hub.UnreadableLinks,
            });
            report.IncompleteReasons = reasons;
            report.Incomplete = reasons.Count > 0;
            foreach (string reason in reasons) report.Notes.Add("⚠ " + reason);
            report.StageMs = _timer.Snapshot();
            report.Notes = report.Notes.Distinct().ToList();

            string err;
            if (!ImpactReportStore.Save(_key, report, out err))
            {
                report.Notes.Add("⚠ Тайланг хадгалж чадсангүй: " + SmartLog.Scrub(err));
                SmartLog.Warn("impact", "report_save_failed", new { err = SmartLog.Scrub(err) });
            }

            SmartLog.Info("impact", "analysis_finished", new
            {
                sources = report.SourceCount, items = report.Items.Count, sheets = report.Items.Count(i => i.Kind == ImpactNodeKind.Sheet),
                incomplete = report.Incomplete, ms = report.StageMs.Values.Sum(),
            });
            Result = report;
            _phase = Phase.Done;
        }

        private static int KindOrder(ImpactNodeKind k)
        {
            switch (k)
            {
                case ImpactNodeKind.Sheet: return 0;
                case ImpactNodeKind.View: return 1;
                case ImpactNodeKind.Schedule: return 2;
                case ImpactNodeKind.Room: return 3;
                case ImpactNodeKind.Placement: return 4;
                case ImpactNodeKind.Tag: return 5;
                case ImpactNodeKind.Dimension: return 6;
                default: return 7;
            }
        }

        /// <summary>Өөрөө өөрчлөгдсөн хуудас/харагдац/хүснэгт — ШУУД (A), зам байхгүй.</summary>
        private ImpactItem SelfItem(SourceChange src, ImpactNode n)
        {
            string verb = src.Kind == ChangeKind.Deleted ? "устсан" : src.Kind == ChangeKind.Added ? "нэмэгдсэн" : "өөрчлөгдсөн";
            string name = !string.IsNullOrEmpty(n.Name) ? n.Name : n.Category;
            var item = new ImpactItem
            {
                Id = n.Id, Uid = n.Uid, Kind = n.Kind, Name = name, Detail = n.Detail ?? n.Category,
                Confidence = ImpactConfidence.A, Depth = 0, SourceId = n.Id, SourceLabel = n.Label, SourceChange = src.Kind, PathCount = 1,
                Relationship = "changed", Reason = "«" + name + "» өөрөө " + verb, Resolver = "source",
            };
            if (n.Kind == ImpactNodeKind.Sheet)
            {
                var sheet = _hub.Live(n.Id) as ViewSheet;
                if (sheet != null) item.SheetNumber = sheet.SheetNumber;
            }
            return item;
        }

        private ImpactItem ToItem(ImpactTarget t, ImpactNode n)
        {
            ImpactEdge last = t.Path.LastOrDefault();
            ChangeKind srcKind;
            _kindById.TryGetValue(t.SourceId, out srcKind);

            var item = new ImpactItem
            {
                Id = n.Id, Uid = n.Uid, Kind = n.Kind, Name = !string.IsNullOrEmpty(n.Name) ? n.Name : n.Category,
                Detail = n.Detail ?? n.Category, Confidence = t.Confidence, Depth = t.Depth, SourceId = t.SourceId,
                SourceLabel = _hub.Label(t.SourceId), SourceChange = srcKind, PathCount = t.PathCount,
                Relationship = last != null ? last.Relationship : null, Reason = last != null ? last.Reason : null,
                Resolver = last != null ? last.Resolver : null,
            };
            foreach (ImpactEdge e in t.Path)
                item.Path.Add(new ImpactPathStepView
                {
                    FromLabel = _hub.Label(e.From), ToLabel = _hub.Label(e.To), Relationship = e.Relationship,
                    Confidence = e.Confidence, Reason = e.Reason, Resolver = e.Resolver,
                });

            if (n.Kind == ImpactNodeKind.Sheet)
            {
                var sheet = _hub.Live(n.Id) as ViewSheet;
                if (sheet != null) item.SheetNumber = sheet.SheetNumber;
            }
            return item;
        }
    }
}
