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
    /// «Өөрчлөхөөс өмнө шалгах» preview-ийн ХЭСЭГЛЭСЭН ажил (`SmartExecutor`) — ДАМЖЛАГАТАЙ (түр дүн → эцсийн дүгнэлт), КЭШТЭЙ.
    ///
    ///   Validate
    ///     ├─ кэш байхгүй: Indexes → Graph1 → PostPlan → Post → Graph2 → Deps          (зайнаас ХАМААРАХГҮЙ хамаарлын бэлтгэл — `PreChangePlan`)
    ///     └─ кэш таарсан: (дээрхийг ДАХИН БАРИХГҮЙ)
    ///   Plan          зайнаас ХАМААРАХ нэр дэвшигч (өрөө, MEP, гарц, харагдац) + хурууны хээ
    ///   BeforeCore    ӨМНӨХ төлөв: хана, өрөө, хэмжээс, хаалга/цонх, хөрш хана       (sandbox-оос ГАДНА, memo-той)
    ///   SandboxQuick  түр группэд хөдөлгөөн → commit → SETTLED унших → БҮГДИЙГ буцаах → ТҮР ДҮН (🟢 хэзээ ч биш) нийтлэнэ
    ///   BeforeDeep    ӨМНӨХ төлөв: хүснэгт, MEP, гарц, хаалганы орчны зай               (memo-той)
    ///   SandboxDeep   ИЖИЛ хөдөлгөөн дахин, гүн шалгалтууд → ЭЦСИЙН ТЕХНИКИЙН ДҮГНЭЛТ
    ///   Report        хоёр дамжлагын settled байрлал ИЖИЛ эсэх → нэгтгэх → `PreChangeDiff.Compute`
    ///
    /// ЯАГААД ХОЁР ДАМЖЛАГА: Step хоорондоо л UI өөрчлөлт зурагддаг.  Эхний хариу (өрөө, хэмжээс, хаалга) цаг хугацаа багатай; MEP/гарц/хүснэгт/орчны зай удаан.
    /// Түр дүн нь `Quick` гэж тэмдэглэгдэнэ — шийдвэрийн хөдөлгүүр түүнийг ХЭЗЭЭ Ч «зөөж болно» (🟢) гэж үзэхгүй, Apply хаалттай.
    ///
    /// ГЭРЭЭ: Sandbox-оос бусад Step загварыг ХЭЗЭЭ Ч өөрчлөхгүй (транзакцгүй).  Транзакц Step-ийн гадуур нээлттэй үлдэхгүй.
    /// Step бүр Revit обьект хадгалахгүй (id л).  Загвар Step хооронд өөрчлөгдвөл Sandbox ЭХЛЭХГҮЙ: НЭГ удаа автоматаар дахин эхэлнэ, дахин өөрчлөгдвөл унана.
    /// ⚠️ SmartExecutor нэг Execute-д ~150 мс-ийн дотор олон Step гүйцэтгэдэг тул түр дүн ЗӨВХӨН Step-үүд удаан үед (том загвар) UI-д зурагдана; хурдан үед
    ///    эцсийн дүн шууд гарна.
    /// </summary>
    internal sealed class PreChangeJob : ISmartJob
    {
        private enum Phase { Validate, Indexes, Graph1, PostPlan, Post, Graph2, Deps, Plan, BeforeCore, SandboxQuick, BeforeDeep, SandboxDeep, Report, Done }

        private const int StepMs = 100;
        private const int MaxVisibilityViews = 400;
        private const int MaxRestarts = 1;

        private readonly PreChangeRequest _req;
        private readonly IPreChangeOperation _op;
        private readonly DocumentKey _key;
        private readonly IProgress<JobProgress> _progress;
        private readonly Action<PreChangeReport> _onProvisional;
        private readonly bool _ownershipAck;
        private readonly StageClock _clock = new StageClock();

        private Phase _phase = Phase.Validate;
        private Document _doc;
        private PreChangePlan _plan;
        private bool _fromCache;
        private ImpactGraphBuilder _builder;
        private ImpactGraph _graph1, _graph2;
        private CaptureSpec _spec;
        private XYZ _moveFt;
        private string _stamp;
        private PreChangeCacheKey _cacheKey;
        private PreChangeFingerprint _fingerprint;
        private PreChangeDependencies _deps;
        private StateSnapshot _beforeCore, _beforeDeep;
        private SandboxResult _quick, _deep;
        private string _earlyBlock;
        private RejectionKind _rejection;
        private List<string> _warnings = new List<string>();
        private int _restarts;
        private bool _restartedNote;

        public PreChangeReport Result { get; private set; }
        /// <summary>Apply-д ӨМНӨ/ДАРАА ИЖИЛ нэр дэвшигчээр дахин унших спец.</summary>
        internal CaptureSpec Spec { get { return _spec; } }
        public string Name { get { return "Pre-change impact"; } }

        internal PreChangeJob(PreChangeRequest req, DocumentKey key, IProgress<JobProgress> progress, Action<PreChangeReport> onProvisional, bool ownershipAcknowledged)
        {
            _req = req;
            _op = PreChangeOperationRegistry.For(req);
            _key = key;
            _progress = progress;
            _onProvisional = onProvisional;
            _ownershipAck = ownershipAcknowledged;
        }

        public bool Step(UIApplication app)
        {
            Document doc = ActiveDocument(app);
            // Кэшийн hub-ийг Step бүрт ЭНЭ Step-ийн амьд Document-д холбоно (өмнөх цуцлагдсан job-ийн `Detach` хойно ирсэн ч аюулгүй).
            if (_plan != null && _plan.Hub != null) _plan.Hub.Attach(doc);
            var sw = Stopwatch.StartNew();
            switch (_phase)
            {
                case Phase.Validate: _clock.Measure("validate_ms", () => Validate(doc)); break;
                case Phase.Indexes: _clock.Measure("indexes_ms", () => IndexStep()); break;
                case Phase.Graph1: _clock.Measure("graph1_ms", () => GraphStep(sw, false)); break;
                case Phase.PostPlan: _clock.Measure("post_plan_ms", () => PostPlan()); break;
                case Phase.Post: _clock.Measure("post_ms", () => PostStep()); break;
                case Phase.Graph2: _clock.Measure("graph2_ms", () => GraphStep(sw, true)); break;
                case Phase.Deps: _clock.Measure("deps_ms", () => BuildDeps(doc)); break;
                case Phase.Plan: _clock.Measure("plan_ms", () => PlanStep(doc)); break;
                case Phase.BeforeCore: BeforeCore(doc); break;
                case Phase.SandboxQuick: SandboxQuick(app, doc); break;
                case Phase.BeforeDeep: BeforeDeep(doc); break;
                case Phase.SandboxDeep: SandboxDeep(app, doc); break;
                case Phase.Report: _clock.Measure("report_ms", () => BuildFinalReport()); break;
            }
            return _phase == Phase.Done;
        }

        public void OnCancelled()
        {
            // Sandbox нэг Step дотор бүрэн дуусдаг (цуцлалт Step-ийн хооронд л).  Кэшийн hub-ийг Document-ээс салгана; дутуу баригдсан plan-ийг ХАЯНА.
            DetachHub();
            _plan = null;
        }

        private void DetachHub()
        {
            try { if (_plan != null && _plan.Hub != null) _plan.Hub.Detach(); } catch (Exception) { }
        }

        private Document ActiveDocument(UIApplication app)
        {
            UIDocument ui = app.ActiveUIDocument;
            Document doc = ui != null ? ui.Document : null;
            if (doc == null) throw new InvalidOperationException("Идэвхтэй баримт алга.");
            if (!_key.Equals(RevitDocumentKeys.Of(doc)))
                throw new InvalidOperationException("Идэвхтэй файл солигдсон — шинжилгээ эхэлсэн файл руугаа буцна уу.");
            if (_doc == null) _doc = doc;
            else if (!SmartDocs.IsAlive(_doc) || !SmartDocs.Same(_doc, doc))
                throw new InvalidOperationException("Баримт хаагдаж дахин нээгдсэн — шинжилгээг дахин эхлүүлнэ үү.");
            else _doc = doc;
            return doc;
        }

        private void Report(string stage, string message, int done = 0, int total = 0)
        {
            if (_progress != null) _progress.Report(JobProgress.Of(stage, done, total, message));
        }

        /* ============================== VALIDATE ============================ */

        private void Validate(Document doc)
        {
            Report("prepare", "Хамаарлыг бэлдэж байна");

            string bad = PreChangeRequestRules.Validate(_req);
            if (bad != null) { Block(bad, RejectionKind.Unsupported); return; }

            OpCheck oc = _op.Check(doc, _req.SourceId);
            if (!oc.Ok) { Block(oc.Problem, oc.Refused ? RejectionKind.Refused : RejectionKind.Unsupported); return; }
            if (!string.Equals(oc.SourceUid, _req.SourceUid ?? oc.SourceUid, StringComparison.Ordinal))
            { Block(_op.SourceChangedText, RejectionKind.Unsupported); return; }
            // Хэн ч эзэмшээгүй элемент: preview түр эзэмшил (checkout) үүсгэж болзошгүй.  Цонх эхлэхээс ӨМНӨ асуусан байх ёстой — энд хамгаалалт.
            if (oc.NeedsCheckoutAck && !_ownershipAck) { Block(AckText(), RejectionKind.Unsupported); return; }

            _warnings = oc.Warnings.ToList();
            _moveFt = PcUnits.VectorFromMm(_req.VectorMm);
            _stamp = ModelChangeCounter.Stamp(doc);
            _cacheKey = PreChangePlanCache.KeyOf(doc, _key, oc.SourceUid, _stamp);

            PreChangePlan hit;
            if (PreChangePlanCache.Cache.TryGet(_cacheKey, out hit) && hit.Hub != null && hit.Deps != null)
            {
                _plan = hit;
                _fromCache = true;
                _plan.Hub.Attach(doc);
            }
            else
            {
                _fromCache = false;
                _plan = new PreChangePlan { Key = _cacheKey, Stamp = _stamp, Hub = new ResolverHub(doc) };
                _op.BuildPlanBase(doc, _key, oc, _plan, _stamp, _clock);
            }

            // Хамаарах элементийн эзэмшил (workshare) — checkout-ийн төлөв DocumentChanged-д ордоггүй тул кэшээс хамааралгүй БҮР шалгана.
            int notOwned;
            string foreign = _op.DependentOwnership(doc, _plan, out notOwned);
            if (foreign != null) { Block(foreign, RejectionKind.Refused); return; }
            if (notOwned > 0)
            {
                if (!_ownershipAck && !oc.NeedsCheckoutAck) { Block(AckText(), RejectionKind.Unsupported); return; }
                _warnings.Add(notOwned + " хамаарах элемент хэнд ч эзэмшигдээгүй — Revit түр эзэмшил үүсгэж магадгүй.");
            }

            _phase = _fromCache ? Phase.Plan : Phase.Indexes;
        }

        private string AckText()
        {
            return _req.Operation == PreChangeOperationKind.DoorMove ? PreChangeText.OwnershipAckDoor : PreChangeWallRules.CheckoutAckText;
        }

        private void Block(string reason, RejectionKind kind)
        {
            _earlyBlock = reason;
            _rejection = kind;
            _phase = Phase.Report;
        }

        /* ============================== INDEXES / GRAPH ====================== */

        private void IndexStep()
        {
            string built = _plan.Hub.NextStructuralIndex();
            if (built != null) { Report("indexes", "Индекс бэлдэж байна: " + built); return; }
            _builder = new ImpactGraphBuilder(SourcesOf(), id => _plan.Hub.Combined(id, false));
            _phase = Phase.Graph1;
        }

        private List<SourceChange> SourcesOf()
        {
            return _plan.SourceIds.Select(id => new SourceChange { Id = id, Kind = ChangeKind.Modified }).ToList();
        }

        private void GraphStep(Stopwatch sw, bool second)
        {
            bool done = false;
            while (!done && sw.ElapsedMilliseconds < StepMs) done = _builder.Step(1);
            Report(second ? "graph2" : "graph1", "Хамаарлын граф (" + _builder.Expanded + " зангилаа)");
            if (!done) return;
            if (!second) { _graph1 = _builder.Build(); _phase = Phase.PostPlan; }
            else { _graph2 = _builder.Build(); _phase = Phase.Deps; }
        }

        private void PostPlan()
        {
            var cands = _plan.SourceIds.Where(id => _plan.Hub.Live(id) != null).ToList();
            // Өрөөг энд шалгахгүй (rooms:false) — өрөөг өөрсдөө, нэр дэвшигчээр (bbox) уншдаг.  Харагдалт ба хүснэгт: Change Impact-ийн хэвээр.
            _plan.Hub.BeginPost(cands, false, true, true, 5000);
            _phase = Phase.Post;
        }

        private void PostStep()
        {
            bool done = _plan.Hub.PostStep(80);
            Report("post", (_plan.Hub.PostStage ?? "Харагдалт") + " шалгаж байна", _plan.Hub.PostDone, _plan.Hub.PostTotal);
            if (!done) return;
            _builder = new ImpactGraphBuilder(SourcesOf(), id => _plan.Hub.Combined(id, true));
            _phase = Phase.Graph2;
        }

        /* ============================== DEPS (кэшийн мөрийг дуусгана) ======= */

        private void BuildDeps(Document doc)
        {
            ImpactGraph g = _graph2 ?? _graph1 ?? new ImpactGraph { Complete = true };
            PreChangeDependencies deps = PreChangeDeps.Build(_plan.Hub, g, true);
            _plan.Deps = deps;
            _plan.DimIds = deps.DimensionIds.Distinct().ToList();
            _plan.Schedules = deps.Schedules.GroupBy(s => s.Id).Select(x => new ScheduleRef { Id = x.Key, Name = x.First().Name }).ToList();

            // Өмнө нь харагдаж байсан харагдац → үлдсэн модель харагдацаас хөдөлсний дараа шинээр харагдах нэр дэвшигч.
            foreach (long id in _plan.SourceIds)
            {
                List<long> views;
                if (_plan.Hub.VisibleViews.TryGetValue(id, out views)) foreach (long v in views) _plan.VisibleBeforeViews.Add(v);
            }
            _plan.PlacedCandidateViews = _plan.Hub.PlacedModelViews().Where(v => !_plan.VisibleBeforeViews.Contains(v)).ToList();
            Report("deps", "Нөлөөлөх харагдац, хуудсыг нэгтгэв");
            _phase = Phase.Plan;
        }

        /* ============================== PLAN (зайнаас хамаарах) ============= */

        private void PlanStep(Document doc)
        {
            Element source = doc.GetElement(new ElementId(_req.SourceId));
            if (source == null || !source.IsValidObject)
            {
                Block(PreChangeOperations.NounCap(_req.Operation) + " загварт олдсонгүй (устсан байж болзошгүй).", RejectionKind.Unsupported);
                return;
            }

            var spec = new CaptureSpec { Operation = _req.Operation, SourceId = source.Id.Value, SourceUid = source.UniqueId, VectorMm = _req.VectorMm };
            spec.Notes.AddRange(_warnings);
            spec.HostedIds = _plan.HostedIds;
            spec.JoinedIds = _plan.JoinedIds;
            spec.DimIds = _plan.DimIds;
            spec.Schedules = _plan.Schedules;
            spec.ScheduleCandidateIds = _plan.ScheduleCandidateIds;
            spec.Clearance3dViewId = _plan.Clearance3dViewId;
            spec.ClearanceProblem = _plan.Clearance3dProblem;
            spec.VisibleBeforeViews = _plan.VisibleBeforeViews;
            spec.IncompleteReasons.AddRange(_plan.RequiredReasons);
            spec.AdvisoryReasons.AddRange(_plan.AdvisoryReasons);

            // Зайнаас ХАМААРАХ нэр дэвшигч (өрөө, клэш, гарц) — үйлдэл тус бүрийн өөрийн логик.
            _op.PlanCandidates(doc, _key, _req, _moveFt, source, _plan, spec, _clock);

            // Нэр дэвшигчийн slot индекс өөр болбол memo-ийн clash хэсэг утгагүй — хүчингүй болгоно.
            string sig = PreChangePlanCache.SlotSignature(spec.Clash);
            if (!string.Equals(sig, _plan.ClashSlotSignature, StringComparison.Ordinal))
            {
                _plan.Memo.ClashPairs.Clear();
                _plan.Memo.ClashCandidatesRead.Clear();
                _plan.ClashSlotSignature = sig;
            }

            // Хөдөлсний дараа шинээр харагдах харагдац: батлагдсан-аюулгүй (crop-ийн хүрээнээс гадуур) нэр дэвшигчийг ХАСНА.
            _deps = _plan.Deps.Clone();
            int excluded, unreadable;
            var swReduce = Stopwatch.StartNew();
            List<long> reduced = _op.ReduceVisibility(doc, _plan.PlacedCandidateViews, source, _moveFt, out excluded, out unreadable);
            _clock.Add("visibility_reduce_ms", swReduce.ElapsedMilliseconds);
            if (excluded > 0) spec.Notes.Add(excluded + " харагдац crop-ийн хүрээнээс гадуур тул хөдөлсний дараах харагдалтад шалгах шаардлагагүй (батлагдсан).");
            if (reduced.Count > MaxVisibilityViews)
            {
                _deps.AdvisoryReasons.Add("Хуудсанд байрласан " + reduced.Count + " харагдацаас хөдөлсний дараах харагдалтыг эхний " + MaxVisibilityViews + "-д л шалгав.");
                reduced = reduced.Take(MaxVisibilityViews).ToList();
            }
            spec.AfterVisibilityViews = reduced;

            _spec = spec;
            _fingerprint = _op.FingerprintFrom(doc, _key, _req, _stamp, spec);
            _phase = Phase.BeforeCore;
        }

        /* ============================== ӨМНӨХ ТӨЛӨВ + SANDBOX ================ */

        private bool StampUnchanged(Document doc)
        {
            return string.Equals(ModelChangeCounter.Stamp(doc), _stamp, StringComparison.Ordinal);
        }

        /// <summary>Загвар шинжилгээний явцад өөрчлөгдсөн: НЭГ удаа эхнээс (кэшгүй), дахин өөрчлөгдвөл унана.  true = дахин эхэлсэн (дуудагч шууд буцна).</summary>
        private bool RestartIfStampChanged(Document doc)
        {
            if (StampUnchanged(doc)) return false;
            if (_restarts >= MaxRestarts)
                throw new InvalidOperationException("Загвар шинжилгээний явцад дахин өөрчлөгдлөө — preview-г дахин ажиллуулна уу.");
            _restarts++;
            _restartedNote = true;
            DetachHub();
            _plan = null; _fromCache = false; _builder = null; _graph1 = _graph2 = null; _spec = null; _deps = null; _fingerprint = null;
            _beforeCore = _beforeDeep = null; _quick = _deep = null; _earlyBlock = null; _rejection = RejectionKind.None;
            _phase = Phase.Validate;
            Report("prepare", "Загвар өөрчлөгдсөн — дахин шалгаж байна");
            return true;
        }

        private void BeforeCore(Document doc)
        {
            Report("before", "Өмнөх төлвийг уншиж байна");
            _beforeCore = PreChangeCapture.Read(doc, _spec, CaptureStages.Core, PreChangeSandbox.ClashBudgetMs, _clock, "before.", _plan.Memo);
            _phase = Phase.SandboxQuick;
        }

        private void SandboxQuick(UIApplication app, Document doc)
        {
            if (RestartIfStampChanged(doc)) return;
            Report("sandbox", "Хөдөлгөөнийг түр турших (загварт өөрчлөлт хийхгүй)");
            _quick = _clock.Measure("sandbox_quick_ms", () => PreChangeSandbox.Run(app, doc, _spec, _moveFt, SandboxPass.Quick, _clock));

            if (_quick.Outcome != SandboxOutcome.Simulated) { _phase = Phase.Report; return; }

            // ТҮР ДҮН — гүн шалгалт хүлээгдэж байна.  (Шийдвэр: Quick шат хэзээ ч 🟢 биш, Apply хаалттай.)
            _clock.Mark("first_result");
            if (_onProvisional != null)
            {
                try { _onProvisional(MakeReport(true)); }
                catch (Exception ex) { SmartLog.Warn("prechange", "provisional_failed", new { ex = ex.GetType().Name }); }
            }
            Report("deep", "Түр дүн бэлэн — MEP, гарц, хүснэгтийг шалгаж байна");
            _phase = Phase.BeforeDeep;
        }

        private void BeforeDeep(Document doc)
        {
            _beforeDeep = PreChangeCapture.Read(doc, _spec, CaptureStages.Deep, PreChangeSandbox.ClashBudgetMs, _clock, "before.", _plan.Memo);
            _phase = Phase.SandboxDeep;
        }

        private void SandboxDeep(UIApplication app, Document doc)
        {
            if (RestartIfStampChanged(doc)) return;
            _deep = _clock.Measure("sandbox_deep_ms", () => PreChangeSandbox.Run(app, doc, _spec, _moveFt, SandboxPass.Deep, _clock));
            _phase = Phase.Report;
        }

        /* ============================== REPORT ============================== */

        private static readonly string[] QuickPending = { "MEP clash", "Гарцын зам", "Хүснэгт", "Хаалганы орчны зай", "Шинээр харагдах хуудас" };

        /// <summary>Түр (`quick`) эсвэл эцсийн тайланг угсарна.  Түр тайлан нь `_deps`-ийн ХУУЛБАР дээр — эцсийн дүн `_deps`-ийг цааш мутаци хийнэ.</summary>
        private PreChangeReport MakeReport(bool quick)
        {
            PreChangeInput input;
            if (_earlyBlock != null)
            {
                input = new PreChangeInput
                {
                    Request = _req, DocumentTitle = _key.Display, Utc = SmartClock.UtcNow, Outcome = SandboxOutcome.Rejected, Rejection = _rejection,
                    BlockReasons = { _earlyBlock },
                };
            }
            else
            {
                SandboxResult failed = _quick != null && _quick.Outcome != SandboxOutcome.Simulated ? _quick
                    : (_deep != null && _deep.Outcome != SandboxOutcome.Simulated ? _deep : null);
                if (failed != null)
                {
                    input = new PreChangeInput
                    {
                        Request = _req, DocumentTitle = _key.Display, Utc = SmartClock.UtcNow, Outcome = failed.Outcome,
                        BlockReasons = failed.BlockReasons, Failures = failed.Failures, Fingerprint = _fingerprint,
                    };
                    input.ExtraIncompleteReasons.AddRange(_spec.IncompleteReasons);
                    input.Rejection = failed.Outcome == SandboxOutcome.Rejected ? RejectionKind.Unsupported : RejectionKind.None;
                }
                else if (quick)
                {
                    input = new PreChangeInput
                    {
                        Request = _req, DocumentTitle = _key.Display, Utc = SmartClock.UtcNow, Outcome = SandboxOutcome.Simulated,
                        Failures = _quick.Failures, Before = _beforeCore, After = _quick.After, Deps = _deps.Clone(), Fingerprint = _fingerprint,
                        Stage = AnalysisStage.Quick,
                    };
                    input.PendingChecks.AddRange(QuickPending);
                    input.Notes.AddRange(_spec.Notes);
                    input.Notes.AddRange(_quick.Notes);
                    input.ExtraIncompleteReasons.AddRange(_spec.IncompleteReasons);
                    input.ExtraIncompleteReasons.AddRange(_quick.IncompleteReasons);
                    input.ExtraAdvisoryReasons.AddRange(_quick.AdvisoryReasons);
                }
                else
                {
                    StateSnapshot before = PreChangeSnapshots.Merge(_beforeCore, _beforeDeep);
                    StateSnapshot after = PreChangeSnapshots.Merge(_quick.After, _deep.After);
                    PreChangeCapture.FinalizeSchedules(before, after);

                    PreChangeDeps.AddNewlyVisible(_deps, _plan.Hub, _deep.NewVisibleViews);
                    _deps.AfterVisibilityChecked = _deep.AfterVisibilityChecked;

                    input = new PreChangeInput
                    {
                        Request = _req, DocumentTitle = _key.Display, Utc = SmartClock.UtcNow, Outcome = SandboxOutcome.Simulated,
                        Failures = _deep.Failures, Before = before, After = after, Deps = _deps, Fingerprint = _fingerprint,
                        Stage = AnalysisStage.Full,
                    };
                    input.Notes.AddRange(_spec.Notes);
                    input.Notes.AddRange(_quick.Notes);
                    input.Notes.AddRange(_deep.Notes);
                    if (_deps != null) input.Notes.AddRange(_deps.Notes);
                    input.ExtraIncompleteReasons.AddRange(_spec.IncompleteReasons);
                    input.ExtraIncompleteReasons.AddRange(_quick.IncompleteReasons);
                    input.ExtraIncompleteReasons.AddRange(_deep.IncompleteReasons);
                    input.ExtraAdvisoryReasons.AddRange(_spec.AdvisoryReasons);
                    input.ExtraAdvisoryReasons.AddRange(_quick.AdvisoryReasons);
                    input.ExtraAdvisoryReasons.AddRange(_deep.AdvisoryReasons);

                    // Хоёр дамжлага ИЖИЛ хөдөлгөөнийг турших тул settled байрлал ижил байх ёстой.  Зөрвөл нэг тайланд нийлүүлэх нь худал.
                    foreach (string diff in PreChangeRestoreCheck.SettledDifferences(_quick.Settled, _deep.Settled))
                        input.ExtraIncompleteReasons.Add(diff);
                }
                input.Notes.Add(_op.LinkNote);
                _op.FillInput(input, _plan);
                if (_restartedNote) input.Notes.Add("Шинжилгээний явцад загвар өөрчлөгдсөн тул нэг удаа дахин эхэлсэн.");
            }
            input.StageMs = _clock.Snapshot();
            input.Notes = input.Notes.Distinct(StringComparer.Ordinal).ToList();

            PreChangeReport r = PreChangeDiff.Compute(input);
            if (r.Fingerprint == null) r.Fingerprint = _fingerprint;
            return r;
        }

        private void BuildFinalReport()
        {
            // Эцсийн шалгалт: загвар шинжилгээний үеэр өөрчлөгдсөн бол preview-ийн дүн хуучирсан — НЭГ удаа дахин эхэлнэ.
            if (_earlyBlock == null && _doc != null && _plan != null && !StampUnchanged(_doc))
            {
                if (RestartIfStampChanged(_doc)) return;
            }

            Result = MakeReport(false);
            _clock.Mark("full_result");
            Result.StageMs = _clock.Snapshot();

            // Буцаалтыг баталж чадаагүй / хэрэгслийн алдаа: кэшийг ХЭЗЭЭ Ч итгэхгүй.  Буцаалт баталгаагүй бол загвар өөрчлөгдсөн байж магадгүй, харин
            // sandbox-ийн commit ажиглагчдад харагдаагүй (дарангуйлсан) тул тэмдгийг ХҮЧЭЭР урагшлуулна — өмнөх preview «хуучраагүй» гэж үлдэхгүй.
            if (Result.Outcome == SandboxOutcome.NotRestored || Result.Outcome == SandboxOutcome.Faulted)
            {
                PreChangePlanCache.Purge(_key.Id);
                if (Result.Outcome == SandboxOutcome.NotRestored) ModelChangeCounter.ForceBump(_doc);
            }

            // Кэш: ЗӨВХӨН амжилттай, тэмдэг өөрчлөгдөөгүй, бүрэн баригдсан plan-ийг.  Hub-ийг Document-ээс ТАСЛАНА.
            if (_plan != null && _plan.Deps != null && _earlyBlock == null)
            {
                bool completed = Result.Outcome != SandboxOutcome.NotRestored && Result.Outcome != SandboxOutcome.Faulted;
                DetachHub();
                if (completed) PreChangePlanCache.Cache.Put(_cacheKey, _plan);
            }
            else DetachHub();

            SmartLog.Info("prechange", "preview_finished", new
            {
                outcome = Result.Outcome.ToString(), level = Result.Level.ToString(), items = Result.Items.Count, incomplete = Result.Incomplete,
                cache = _fromCache ? "hit" : "miss", restarts = _restarts,
                rooms = _spec != null ? _spec.RoomIds.Count : 0, hosted = _spec != null ? _spec.HostedIds.Count : 0,
                mepCandidates = _spec != null && _spec.Clash != null ? _spec.Clash.Cands.Count : 0,
                visibilityCandidates = _spec != null ? _spec.AfterVisibilityViews.Count : 0,
                firstResultMs = Get("first_result"), fullResultMs = Get("full_result"), totalMs = _clock.TotalMs, stages = Result.StageMs,
            });
            _phase = Phase.Done;
        }

        private long Get(string k)
        {
            long v;
            return _clock.Snapshot().TryGetValue(k, out v) ? v : -1;
        }
    }
}
