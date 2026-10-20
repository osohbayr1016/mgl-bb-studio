using System;
using System.Collections.Generic;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Events;
using Autodesk.Revit.UI;
using Autodesk.Revit.UI.Events;
using RevitMcpAddin.Intelligence.Ai;
using RevitMcpAddin.Intelligence.Contracts;
using RevitMcpAddin.Intelligence.Core;
using RevitMcpAddin.Intelligence.Erp;

namespace RevitMcpAddin.Intelligence.Revit
{
    /// <summary>
    /// SESSION R-ИЙН ХОСТ — Revit-ийн үйл явдал → DTO → арын шинжилгээ → самбар.
    ///
    /// ДҮРЭМ (§15, §24, R-15):
    ///   · Revit-ийн үйл явдлын гар дотор ЗӨВХӨН хямд уншилт (нэр, id) + дохио.
    ///   · Revit-ээс уншихдаа ҮРГЭЛЖ `RevitToolBus` (ГАНЦ ExternalEvent, R-2),
    ///     ҮРГЭЛЖ арын thread-ээс (`Task.Run`) — үндсэн/UI thread-ээс `Call`
    ///     хийвэл гацна (урхи №9, №10).
    ///   · HTTP, AI, геометр — үйл явдлын дотор ХЭЗЭЭ Ч.
    ///   · `BimEmitter.ComplianceHook`-д `+=`-ээр ЗАЛГАНА (multicast) —
    ///     `ComplianceScheduler`-ийн бүртгэлийг дарахгүй; тэр нь `=`-ээр
    ///     оноодог тул энэ Init нь ТҮҮНИЙ ДАРАА байх ёстой (`App.cs`).
    ///
    /// Бүх нийтийн гишүүн thread-safe; үйл явдлууд АРЫН thread дээр
    /// гарна — WPF тал өөрөө `Dispatcher` руу marshal хийнэ.
    /// </summary>
    internal sealed class RevitIntelligenceHost
    {
        public static RevitIntelligenceHost Instance { get; private set; }

        private readonly object _gate = new object();
        private readonly Dictionary<string, SceneGraphStore> _graphs = new Dictionary<string, SceneGraphStore>(StringComparer.Ordinal);
        private readonly Dictionary<string, IssueStore> _issues = new Dictionary<string, IssueStore>(StringComparer.Ordinal);
        private readonly Dictionary<string, TaskCandidateSet> _candidates = new Dictionary<string, TaskCandidateSet>(StringComparer.Ordinal);
        private readonly HashSet<string> _indexed = new HashSet<string>(StringComparer.Ordinal);
        private readonly Debouncer _contextDebounce;
        private readonly SemaphoreSlim _refreshLock = new SemaphoreSlim(1, 1);
        private readonly List<RevitChangeSet> _pendingSets = new List<RevitChangeSet>();
        private int _refreshScheduled;
        private volatile string _currentDocKey;
        private bool _selectionHooked;
        private UIControlledApplication _uic;

        public readonly ActivityJournal Journal;
        public readonly ProjectLinkStore Links;
        public readonly IBimRuleProvider RuleProvider;
        public readonly ErpTaskContextProvider Tasks = new ErpTaskContextProvider();
        public readonly ErpProjectsProvider Projects = new ErpProjectsProvider();
        public IMglAiRevitClient Ai { get; private set; }
        public IMglAiLocalAuthProvider LocalAuth { get; private set; }

        private RuleProviderResult _rules;
        private RuleProviderResult _testRules;
        /// <summary>MGL-AI-TEST тэмдэгтэй баримтууд — синтетик дүрэм ЗӨВХӨН эдгээрт (§12).</summary>
        private readonly HashSet<string> _testDocs = new HashSet<string>(StringComparer.Ordinal);
        private RevitContextSnapshot _current;
        private RevitProjectLink _currentLink;
        private RevitTaskContext _currentTasks;
        private MglAiRuntimeStatus _runtime;
        public string LastError { get; private set; }

        /* ── R4.1 CONFIRM_WRITE ─────────────────────────────────────── */
        private long _changeSeq;
        /// <summary>Баримтын өөрчлөлтийн тоолуур (DocumentChanged) — preview-ийн хурууны хээнд.</summary>
        public long ChangeSeq { get { return System.Threading.Interlocked.Read(ref _changeSeq); } }
        public ActionStore Actions { get; } = new ActionStore();
        public ActionAudit Audit { get; private set; }
        public event Action ActionChanged;

        private void OnDocumentChangedCounter(object sender, Autodesk.Revit.DB.Events.DocumentChangedEventArgs e)
        {
            if (global::RevitMcpAddin.ImpactSimulationScope.Suppressed) return;     // sandbox-ийн түр өөрчлөлт / хойшлогдсон commit preview-г хуучруулахгүй
            System.Threading.Interlocked.Increment(ref _changeSeq);
        }

        /// <summary>Apply-ийн баталгаажсан (хойшлуулсан) commit-ийг нэг удаа тоолно.</summary>
        private void OnReplayedCounter(global::RevitMcpAddin.DetachedDocChange c)
        {
            System.Threading.Interlocked.Increment(ref _changeSeq);
        }

        internal void RegisterReplay()
        {
            global::RevitMcpAddin.ImpactObservationSinks.Register("intelligence-host", OnReplayedCounter);
        }

        /// <summary>Commit-ийн дараа графикийг шинэчилж, детерминист асуудлыг ШУУД дахин үнэлнэ (API thread). Нээлттэй асуудлын тоог буцаана.</summary>
        internal int ReevaluateNow(Document doc, List<long> ids)
        {
            SceneGraphStore g = GraphFor(doc);
            SceneGraphExtractor.Refresh(doc, g, ids, true);
            Evaluate(g, ids);
            int n = 0;
            IssueStore store; lock (_gate) store = IssuesFor(g.DocKey);
            foreach (RevitComplianceIssue i in store.All(false)) foreach (long id in ids) if (i.ElementIds != null && i.ElementIds.Contains(id)) { n++; break; }
            Raise(GraphChanged); Raise(IssuesChanged);
            return n;
        }

        /// <summary>
        /// Хэрэглэгчийн ИЛ зорилттой (сонгосон элемент) SET_PARAMETER санал — UI-ээс (§13: explicit user-selected target).
        /// LLM оролцохгүй; envelope typed.  Preview-г RevitToolBus-аар (API thread) үүсгэнэ.
        /// </summary>
        public Task<ActionPreview> ProposeSetParameterAsync(string paramName, string value, string reasonMn)
        {
            return ProposeFromUiAsync(RevitActionKind.SET_PARAMETER, new Dictionary<string, string> { { "name", paramName ?? "" }, { "value", value ?? "" } }, reasonMn);
        }

        /// <summary>Хэрэглэгчийн ИЛ зорилттой (сонгосон элемент) typed санал — UI-ээс (§13); SET_PARAMETER · MOVE_ELEMENT · CHANGE_TYPE.</summary>
        public async Task<ActionPreview> ProposeFromUiAsync(RevitActionKind kind, Dictionary<string, string> parameters, string reasonMn)
        {
            await Task.Run(() => RefreshContext()).ConfigureAwait(false);
            RevitContextSnapshot snap = Current;
            if (snap == null || snap.Selection == null || snap.Selection.Count != 1) return null;
            RevitElementSummary e = snap.Selection[0];
            var a = new RevitActionEnvelope
            {
                ActionId = "act_" + Guid.NewGuid().ToString("N").Substring(0, 10),
                Action = kind,
                DocKey = _currentDocKey,
                TargetElementIds = { e.ElementId },
                TargetUniqueIds = { e.UniqueId },
                Parameters = new Dictionary<string, string>(parameters ?? new Dictionary<string, string>(), StringComparer.Ordinal),
                Reason = new ActionReason { SummaryMn = string.IsNullOrWhiteSpace(reasonMn) ? "Хэрэглэгчийн хүсэлт" : reasonMn.Trim() },
                RequestedBy = new ActionRequester { Kind = "USER_UI" },
                SafetyLevel = ActionSafetyLevel.CONFIRM_WRITE,
                RiskLevel = kind == RevitActionKind.SET_PARAMETER ? ActionRiskLevel.LOW : ActionRiskLevel.MEDIUM,
                ProposalSource = ProposalSource.USER_UI,
                CreatedAt = DateTime.UtcNow.ToString("o"),
            };
            a.Evidence.Add(new ActionEvidence { Kind = "SELECTION", Ref = e.ElementId.ToString(), TextMn = "Сонгосон элемент: " + e.Category + " " + e.Name });
            a.Evidence.Add(new ActionEvidence { Kind = "USER_INPUT", Ref = kind.ToString(), TextMn = "Хэрэглэгчийн оруулсан утга" });
            return await PreviewAsync(a).ConfigureAwait(false);
        }

        public Task<ActionPreview> PreviewAsync(RevitActionEnvelope a)
        {
            return Task.Run(() =>
            {
                ToolCall c = RevitToolBus.Call("action_preview", IntelligenceJson.Serialize(new { action = a }), 30);
                if (!c.Success) { SetError("action_preview: " + (c.TimedOut ? "REVIT_BUSY" : c.Error)); return null; }
                ActionPreview pv = ExtractData<ActionPreview>(c.ResultJson);
                Raise(ActionChanged);
                return pv;
            });
        }

        /// <summary>
        /// ЗӨВХӨН хэрэглэгчийн UI үйлдлээс дуудагдана (§20) — Apply товч.  Баталгаа ЭНД үүснэ (USER_UI) ба
        /// preview-ийн binding hash-тай хамт API thread рүү явна; тэнд ДАХИН тулгана.
        /// </summary>
        public Task<ActionExecution> ApplyFromUiAsync(ActionPreview pv)
        {
            if (pv == null) return Task.FromResult<ActionExecution>(null);
            var c = new ActionConfirmation { PreviewId = pv.PreviewId, BindingHash = pv.BindingHash, ConfirmedBy = "USER_UI", ConfirmedAt = DateTime.UtcNow.ToString("o") };
            return Task.Run(() =>
            {
                ToolCall call = RevitToolBus.Call("action_apply", IntelligenceJson.Serialize(new { confirmation = c }), 60);
                if (!call.Success) { SetError("action_apply: " + (call.TimedOut ? "REVIT_BUSY" : call.Error)); return null; }
                ActionExecution ex = ExtractData<ActionExecution>(call.ResultJson);
                _contextDebounce.Trigger();
                Raise(ActionChanged);
                return ex;
            });
        }

        private static T ExtractData<T>(string toolResultJson) where T : class
        {
            try
            {
                using (JsonDocument d = JsonDocument.Parse(toolResultJson))
                {
                    JsonElement data;
                    if (d.RootElement.TryGetProperty("data", out data)) return IntelligenceJson.Deserialize<T>(data.GetRawText());
                }
            }
            catch { }
            return null;
        }

        /// <summary>Хэмжилт (§54) — Context табд харагдана.</summary>
        public double LastSnapshotMs { get; private set; }
        public double LastSnapshotRoundTripMs { get; private set; }
        public double LastRefreshMs { get; private set; }
        public double LastEvaluateMs { get; private set; }

        public event Action ContextChanged;
        public event Action TasksChanged;
        public event Action IssuesChanged;
        public event Action GraphChanged;
        public event Action<string> Status;

        private RevitIntelligenceHost()
        {
            var paths = new AppDataStoragePaths();
            Journal = new ActivityJournal(paths, null, System.Diagnostics.Process.GetCurrentProcess().Id.ToString());
            Links = new ProjectLinkStore(paths);
            Audit = new ActionAudit(paths, System.Diagnostics.Process.GetCurrentProcess().Id.ToString());
            RuleProvider = new CompositeRuleProvider(new ProductionBimRuleProvider(), new ModelQualityRuleProvider());
            // Phase 5 — ЖИНХЭНЭ холболт: ажилтны PC-ийн runtime дээрх хуваалцсан `/turn`
            // (хөтөчтэй ижил хөдөлгүүр).  Runtime суулгаагүй/нууцгүй бол клиент өөрөө
            // AUTH_REQUIRED / MGL_AI_OFFLINE гэж ил хэлнэ — самбар унахгүй.
            LocalAuth = new LocalAppDataAuthProvider();
            // ⚠️ MGLAI_TURN_BASE_URL — ЗӨВХӨН DEV/TEST (R3.5 хүлээн авалтын gateway :39307).  Продакшнд
            //    тавигдахгүй → null → runtime-ийн өгөгдмөл 127.0.0.1:39217.  Зөвхөн loopback зөвшөөрнө.
            string turnBase = Environment.GetEnvironmentVariable("MGLAI_TURN_BASE_URL");
            if (!string.IsNullOrEmpty(turnBase) && !turnBase.StartsWith("http://127.0.0.1:", StringComparison.Ordinal)) turnBase = null;
            Ai = new MglAiTurnClient(LocalAuth, () => SettingsStore.Load().Token, turnBase);
            _contextDebounce = new Debouncer(150, () => Task.Run(RefreshContext));
        }

        /* ============================================================== */
        /*  ЭХЛҮҮЛЭЛТ                                                      */
        /* ============================================================== */

        public static void Init(UIControlledApplication app)
        {
            if (Instance != null) return;
            var h = new RevitIntelligenceHost();
            h._uic = app;
            Instance = h;
            try { h._rules = h.RuleProvider.Load(); } catch (Exception ex) { h._rules = new RuleProviderResult { Status = RuleProviderStatus.ERROR, Note = ex.Message }; }
            try { h._testRules = new TestFixtureRuleProvider().Load(); } catch { h._testRules = null; }
            h.Journal.Log(JournalEventKind.SESSION_STARTED, null);

            app.ViewActivated += h.OnViewActivated;
            app.ControlledApplication.DocumentOpened += h.OnDocumentOpened;
            app.ControlledApplication.DocumentClosing += h.OnDocumentClosing;
            // R4.1: баримтын ӨӨРЧЛӨЛТИЙН тоолуур — preview-ийн хурууны хээ (§14): preview-ээс хойш ямар ч
            //    өөрчлөлт → STALE_ACTION_PREVIEW.  Хямд (тоолуур л), Revit-ийн event thread дээр.
            app.ControlledApplication.DocumentChanged += h.OnDocumentChangedCounter;
            h.RegisterReplay();
            // `SelectionChanged` нь `UIApplication` дээр л байдаг — эхний Idling-ээс авна.
            app.Idling += h.OnFirstIdling;
            // ⚠️ MULTICAST — `ComplianceScheduler.Init` энэ мөрөөс ӨМНӨ `=`-ээр оноосон байх ёстой.
            BimEmitter.ComplianceHook += h.OnLogicalChangeSet;
        }

        public static void Shutdown()
        {
            RevitIntelligenceHost h = Instance;
            if (h == null) return;
            try { BimEmitter.ComplianceHook -= h.OnLogicalChangeSet; } catch { }
            try { if (h._uic != null) h._uic.ControlledApplication.DocumentChanged -= h.OnDocumentChangedCounter; } catch { }
            try { h.Journal.Log(JournalEventKind.SESSION_ENDED, h._currentDocKey); } catch { }
            try { h._contextDebounce.Dispose(); } catch { }
        }

        /// <summary>Самбарын «Шинэчлэх» — debounce-оор, Revit-ийн үндсэн thread-д хүрэхгүй.</summary>
        public void RequestContextRefresh() { _contextDebounce.Trigger(); }

        /// <summary>Session D холбогдоход ГАНЦ цэг — самбар өөрчлөгдөхгүй.</summary>
        public void BindAi(IMglAiRevitClient client, IMglAiLocalAuthProvider auth)
        {
            if (client != null) Ai = client;
            if (auth != null) LocalAuth = auth;
        }

        /* ============================================================== */
        /*  ТӨЛӨВ УНШИХ                                                    */
        /* ============================================================== */

        public RevitContextSnapshot Current { get { lock (_gate) return _current; } }
        public RevitProjectLink CurrentLink { get { lock (_gate) return _currentLink; } }
        public RevitTaskContext CurrentTasks { get { lock (_gate) return _currentTasks; } }
        public RuleProviderResult Rules { get { lock (_gate) return _rules; } }

        public bool IsTestDoc(string docKey) { lock (_gate) return docKey != null && _testDocs.Contains(docKey); }

        /// <summary>Баримтын дүрмийн багц: продакшн (хоосон) + загварын чанар + (ЗӨВХӨН тест баримтад) синтетик.</summary>
        private List<BimExecutableRule> RulesFor(string docKey)
        {
            var list = new List<BimExecutableRule>();
            lock (_gate)
            {
                if (_rules != null && _rules.Status == RuleProviderStatus.OK) list.AddRange(_rules.Rules);
                if (_testRules != null && docKey != null && _testDocs.Contains(docKey)) list.AddRange(_testRules.Rules);
            }
            return list;
        }
        public MglAiRuntimeStatus Runtime { get { lock (_gate) return _runtime; } }
        public string CurrentDocKey { get { return _currentDocKey; } }

        public SceneGraphStore CurrentGraph
        {
            get
            {
                string k = _currentDocKey;
                if (k == null) return null;
                lock (_gate) { SceneGraphStore g; return _graphs.TryGetValue(k, out g) ? g : null; }
            }
        }

        public IssueStore CurrentIssues
        {
            get
            {
                string k = _currentDocKey;
                if (k == null) return null;
                lock (_gate) return IssuesFor(k);
            }
        }

        /// <summary>⚠️ Revit-ийн API контекстоос (хэрэгслийн дотроос) л дуудагдана.</summary>
        internal SceneGraphStore GraphFor(Document doc)
        {
            string key = DocKeys.Normalize(RevitTools.DocUid(doc));
            lock (_gate)
            {
                SceneGraphStore g;
                if (!_graphs.TryGetValue(key, out g)) { g = new SceneGraphStore(key); _graphs[key] = g; }
                return g;
            }
        }

        private IssueStore IssuesFor(string key)
        {
            IssueStore s;
            if (!_issues.TryGetValue(key, out s)) { s = new IssueStore(); _issues[key] = s; }
            return s;
        }

        /* ============================================================== */
        /*  REVIT-ИЙН ҮЙЛ ЯВДАЛ — зөвхөн дохио                              */
        /* ============================================================== */

        private void OnFirstIdling(object sender, IdlingEventArgs e)
        {
            var app = sender as UIApplication;
            if (app == null) return;
            try
            {
                if (!_selectionHooked)
                {
                    app.SelectionChanged += OnSelectionChanged;
                    _selectionHooked = true;
                }
                // Аль хэдийн нээлттэй баримт (add-in-ээс өмнө нээгдсэн) — нэг удаа.
                UIDocument uidoc = app.ActiveUIDocument;
                if (uidoc != null && _currentDocKey == null) OnDocumentBecameCurrent(uidoc.Document);
            }
            catch { }
            finally
            {
                // Нэг удаагийн залгаас — бүртгэсэн ЯГ тэр объектоос салгана.
                try { if (_uic != null) _uic.Idling -= OnFirstIdling; } catch { }
            }
        }

        private void OnSelectionChanged(object sender, SelectionChangedEventArgs e)
        {
            // ХЯМД: зөвхөн дохио.  Хураангуйлалт `RevitToolBus`-аар арын thread дээр.
            _contextDebounce.Trigger();
        }

        private void OnViewActivated(object sender, ViewActivatedEventArgs e)
        {
            try
            {
                Document doc = e.Document;
                if (doc == null) return;
                string key = DocKeys.Normalize(RevitTools.DocUid(doc));
                if (!string.Equals(key, _currentDocKey, StringComparison.Ordinal)) OnDocumentBecameCurrent(doc);
                View v = e.CurrentActiveView;
                string vn = v != null ? v.Name : null;
                string ln = null;
                try { Level gl = v != null ? v.GenLevel : null; ln = gl != null ? gl.Name : null; } catch { }
                Journal.Log(JournalEventKind.VIEW_CHANGED, key, ev => { ev.ViewName = vn; ev.LevelName = ln; });
            }
            catch { }
            _contextDebounce.Trigger();
        }

        private void OnDocumentOpened(object sender, DocumentOpenedEventArgs e)
        {
            try { if (e.Document != null && !e.Document.IsFamilyDocument) OnDocumentBecameCurrent(e.Document); } catch { }
        }

        private void OnDocumentClosing(object sender, DocumentClosingEventArgs e)
        {
            try
            {
                string key = DocKeys.Normalize(RevitTools.DocUid(e.Document));
                Journal.Log(JournalEventKind.DOCUMENT_CLOSED, key);
                lock (_gate) { _graphs.Remove(key); _issues.Remove(key); _indexed.Remove(key); }
                if (string.Equals(key, _currentDocKey, StringComparison.Ordinal))
                {
                    _currentDocKey = null;
                    lock (_gate) { _current = null; _currentLink = null; _currentTasks = null; }
                    Raise(ContextChanged); Raise(IssuesChanged); Raise(TasksChanged);
                }
            }
            catch { }
        }

        /// <summary>Хямд уншилт (нэр, uid) л — Revit-ийн үйл явдлын дотор.</summary>
        private void OnDocumentBecameCurrent(Document doc)
        {
            string key = DocKeys.Normalize(RevitTools.DocUid(doc));
            _currentDocKey = key;
            string title = null;
            try { title = doc.Title; } catch { }
            Journal.Log(JournalEventKind.DOCUMENT_OPENED, key, ev => ev.Note = title);
            bool needIndex;
            lock (_gate) needIndex = _indexed.Add(key);
            _contextDebounce.Trigger();
            if (needIndex) Task.Run(() => IndexDocument(key));
        }

        /* ============================================================== */
        /*  КОНТЕКСТ (R1)                                                  */
        /* ============================================================== */

        private void RefreshContext()
        {
            try
            {
                var sw = System.Diagnostics.Stopwatch.StartNew();
                ToolCall call = RevitToolBus.Call("get_context_snapshot", "{}", 15);
                LastSnapshotRoundTripMs = Math.Round(sw.Elapsed.TotalMilliseconds, 1);
                if (!call.Success)
                {
                    SetError(call.TimedOut ? "REVIT_BUSY" : ("REVIT_API_ERROR: " + call.Error));
                    lock (_gate)
                    {
                        _current = new RevitContextSnapshot { State = call.TimedOut ? RevitErrorState.REVIT_BUSY : RevitErrorState.REVIT_API_ERROR, CapturedAt = DateTime.UtcNow.ToString("o") };
                    }
                    Raise(ContextChanged);
                    return;
                }
                ToolResult<RevitContextSnapshot> r = IntelligenceJson.Deserialize<ToolResult<RevitContextSnapshot>>(call.ResultJson);
                RevitContextSnapshot snap = r.Data ?? new RevitContextSnapshot { State = r.Status };
                LastSnapshotMs = snap.CaptureMs;
                if (snap.Document != null) _currentDocKey = snap.Document.DocKey;

                if (snap.Document != null)
                {
                    bool newlyMarked;
                    lock (_gate)
                    {
                        if (snap.Document.IsTestFixture) newlyMarked = _testDocs.Add(snap.Document.DocKey);
                        else { _testDocs.Remove(snap.Document.DocKey); newlyMarked = false; }
                    }
                    // ⚠️ Хадгалсан fixture-ийг нээхэд анхны скан тэмдэглэгдэхээс ӨМНӨ ажилладаг
                    //    (хэмжсэн 2026-09-14: зөвхөн MODEL_QUALITY гарч, синтетик дүрэм алгасагдсан) —
                    //    шинээр тэмдэглэгдмэгц бүгдийг дахин үнэлнэ.
                    if (newlyMarked) Task.Run(EvaluateAllCurrent);
                }
                RevitProjectLink link = ResolveLink(snap.Document);
                snap.ProjectLink = link;
                lock (_gate) { _current = snap; _currentLink = link; }
                SetError(null);
                Raise(ContextChanged);

                if (snap.SelectionTotal > 0)
                {
                    var cats = new Dictionary<string, int>(StringComparer.Ordinal);
                    foreach (RevitElementSummary e in snap.Selection) { int n; string c = e.Category ?? "?"; cats[c] = cats.TryGetValue(c, out n) ? n + 1 : 1; }
                    Journal.Log(JournalEventKind.SELECTION_CHANGED, snap.Document != null ? snap.Document.DocKey : null, ev =>
                    {
                        ev.Note = snap.SelectionTotal + " элемент";
                        ev.CategoryCounts = new Dictionary<string, int[]>();
                        foreach (KeyValuePair<string, int> kv in cats) ev.CategoryCounts[kv.Key] = new[] { 0, kv.Value, 0 };
                    });
                    // Сонгосон элементийг графт ГЕОМЕТРтэй болгоно (lazy enrichment, R-4).
                    EnrichNodesFromSummaries(snap);
                }
                // Даалгавар: холбоос өөрчлөгдсөн бол дахин татна.
                if (link.State == ProjectLinkState.CONFIRMED)
                {
                    RevitTaskContext t = CurrentTasks;
                    if (t == null || t.ProjectId != link.ProjectId) Task.Run(RefreshTasks);
                }
                else
                {
                    lock (_gate) _currentTasks = new RevitTaskContext { Status = TaskContextStatus.PROJECT_NOT_LINKED, FetchedAt = DateTime.UtcNow.ToString("o") };
                    Raise(TasksChanged);
                }
            }
            catch (Exception ex)
            {
                SetError("RefreshContext: " + ex.GetType().Name + " " + ex.Message);
            }
        }

        private void EnrichNodesFromSummaries(RevitContextSnapshot snap)
        {
            SceneGraphStore g = CurrentGraph;
            if (g == null) return;
            foreach (RevitElementSummary s in snap.Selection)
            {
                SceneNode n = g.Get(s.ElementId) ?? new SceneNode { ElementId = s.ElementId, UniqueId = s.UniqueId };
                n.Kind = s.Kind; n.Category = s.Category ?? n.Category; n.Family = s.Family ?? n.Family; n.TypeName = s.Type ?? n.TypeName; n.Name = s.Name ?? n.Name;
                n.LevelId = s.LevelId ?? n.LevelId; n.LevelName = s.Level ?? n.LevelName;
                n.HostId = s.Host != null ? (long?)s.Host.ElementId : n.HostId;
                n.Detail = SceneDetailLevel.GEOMETRY;
                n.Measures = s.Dimensions; n.BoundingBox = s.BoundingBox; n.Worksharing = s.Worksharing; n.Scope = s.Scope;
                g.Upsert(n);
                if (n.LevelId != null) g.AddEdge(new SceneEdge { From = n.ElementId, To = n.LevelId.Value, Relation = EdgeRelation.ON_LEVEL, Source = EdgeSource.LEVEL_PARAMETER, Confidence = EdgeConfidence.AUTHORITATIVE });
                if (s.Rooms != null)
                {
                    if (s.Rooms.FromRoom != null) g.AddEdge(new SceneEdge { From = n.ElementId, To = s.Rooms.FromRoom.ElementId, Relation = EdgeRelation.FROM_ROOM, Source = EdgeSource.FROM_TO_ROOM, Confidence = EdgeConfidence.AUTHORITATIVE });
                    if (s.Rooms.ToRoom != null) g.AddEdge(new SceneEdge { From = n.ElementId, To = s.Rooms.ToRoom.ElementId, Relation = EdgeRelation.TO_ROOM, Source = EdgeSource.FROM_TO_ROOM, Confidence = EdgeConfidence.AUTHORITATIVE });
                    if (s.Rooms.InRoom != null) g.AddEdge(new SceneEdge { From = n.ElementId, To = s.Rooms.InRoom.ElementId, Relation = EdgeRelation.INSIDE, Source = EdgeSource.REVIT_SPATIAL_API, Confidence = EdgeConfidence.AUTHORITATIVE });
                }
            }
            Raise(GraphChanged);
        }

        /* ============================================================== */
        /*  ТӨСЛИЙН ХОЛБООС (R-10)                                          */
        /* ============================================================== */

        private RevitProjectLink ResolveLink(RevitDocumentContext doc)
        {
            if (doc == null) return new RevitProjectLink { State = ProjectLinkState.UNKNOWN };
            AddinSettings st = SettingsStore.Load();
            List<ErpProjectRef> projects = null;
            bool reachable = false;
            try
            {
                projects = Projects.ListAsync(CancellationToken.None).GetAwaiter().GetResult();
                reachable = projects != null;
            }
            catch { }
            return ProjectLinkPolicy.Resolve(
                doc.DocKey, doc.Title, doc.ProjectName,
                Links.Get(doc.DocKey),
                null, null,
                st.ProjectId, st.ProjectName,
                projects, reachable);
        }

        /// <summary>Хэрэглэгчийн ИЛ баталгаа — ЦОРЫН ГАНЦ `USER_CONFIRMED` үүсгэгч.</summary>
        public void ConfirmProjectLink(int projectId, string projectName)
        {
            string key = _currentDocKey;
            if (key == null) return;
            Links.Put(ProjectLinkPolicy.Confirm(key, projectId, projectName));
            Journal.Log(JournalEventKind.PROJECT_LINK_CONFIRMED, key, ev => { ev.ProjectId = projectId; ev.Note = projectName; });
            Task.Run(RefreshContext);
        }

        public void UnlinkProject()
        {
            string key = _currentDocKey;
            if (key == null) return;
            Links.Remove(key);
            Task.Run(RefreshContext);
        }

        /* ============================================================== */
        /*  ДААЛГАВАР (R2)                                                 */
        /* ============================================================== */

        public void RefreshTasks()
        {
            try
            {
                RevitProjectLink link = CurrentLink;
                string key = _currentDocKey;
                RevitTaskContext t = Tasks.GetAsync(key, link != null && link.State == ProjectLinkState.CONFIRMED ? link.ProjectId : null, CancellationToken.None).GetAwaiter().GetResult();
                lock (_gate) _currentTasks = t;
                Raise(TasksChanged);
            }
            catch (Exception ex) { SetError("RefreshTasks: " + ex.Message); }
        }

        public TaskCandidateSet SelectTask(RevitTaskItem task, out RevitTaskInterpretation interp)
        {
            interp = TaskInterpreter.Interpret(task.TaskId, task.Title, task.DrawingName, task.BlockName);
            SceneGraphStore g = CurrentGraph;
            TaskCandidateSet set = g != null
                ? TaskCandidateResolver.Resolve(interp, g, ReviewedFor(task.TaskId), CurrentIssues != null ? CurrentIssues.OpenCount : 0)
                : new TaskCandidateSet { TaskId = task.TaskId };
            lock (_gate) _candidates[_currentDocKey + "|" + task.TaskId] = set;
            Journal.Log(JournalEventKind.TASK_SELECTED, _currentDocKey, ev => { ev.TaskId = task.TaskId; ev.Note = task.Title; });
            return set;
        }

        private readonly Dictionary<int, HashSet<long>> _reviewed = new Dictionary<int, HashSet<long>>();
        private HashSet<long> ReviewedFor(int taskId)
        {
            lock (_gate) { HashSet<long> s; if (!_reviewed.TryGetValue(taskId, out s)) { s = new HashSet<long>(); _reviewed[taskId] = s; } return s; }
        }

        /// <summary>Ажилтан «шалгасан» гэж ИЛ тэмдэглэв — R-9: явц биш, зөвхөн тоо.</summary>
        public void MarkReviewed(int taskId, long elementId)
        {
            lock (_gate) ReviewedFor(taskId).Add(elementId);
            Journal.Log(JournalEventKind.TASK_ELEMENT_REVIEWED, _currentDocKey, ev => { ev.TaskId = taskId; ev.ElementIds = new List<long> { elementId }; });
        }

        public List<TaskCandidateSet> CandidateSetsForCurrentDoc()
        {
            var list = new List<TaskCandidateSet>();
            string prefix = (_currentDocKey ?? "") + "|";
            lock (_gate) foreach (KeyValuePair<string, TaskCandidateSet> kv in _candidates) if (kv.Key.StartsWith(prefix, StringComparison.Ordinal)) list.Add(kv.Value);
            return list;
        }

        /* ============================================================== */
        /*  ГРАФ + НИЙЦЭЛ (R3)                                              */
        /* ============================================================== */

        private void IndexDocument(string key)
        {
            try
            {
                Raise(Status, "Загварын индекс уншиж байна…");
                ToolCall c = RevitToolBus.Call("scene_index", "{}", 30);
                if (!c.Success) { SetError("scene_index: " + (c.TimedOut ? "REVIT_BUSY" : c.Error)); return; }
                int cursor = 0;
                for (int i = 0; i < 200; i++)
                {
                    ToolCall rc = RevitToolBus.TryCall("scene_relations", "{\"cursor\":" + cursor + "}", 10);
                    if (rc.Skipped) { Thread.Sleep(300); continue; }
                    if (!rc.Success) break;
                    using (JsonDocument d = JsonDocument.Parse(rc.ResultJson))
                    {
                        JsonElement data = d.RootElement.GetProperty("data");
                        cursor = data.GetProperty("cursor").GetInt32();
                        if (data.GetProperty("done").GetBoolean()) break;
                    }
                }
                Raise(GraphChanged);
                // Анхны загварын чанарын скан — БҮХ зангилаа дээр (flag/exists дүрэм ХЯМД).
                SceneGraphStore g = CurrentGraph;
                if (g != null && string.Equals(g.DocKey, key, StringComparison.Ordinal))
                {
                    var ids = new List<long>();
                    foreach (SceneNode n in g.Query(new ElementQuery { Limit = int.MaxValue })) ids.Add(n.ElementId);
                    Evaluate(g, ids);
                }
                Raise(Status, null);
            }
            catch (Exception ex) { SetError("IndexDocument: " + ex.Message); }
        }

        /// <summary>`BimEmitter._pump` thread — Revit-ийн үндсэн thread БИШ; энд Revit-д хүрэхгүй.</summary>
        private void OnLogicalChangeSet(LogicalChangeSet set)
        {
            if (set == null || set.ElementIds == null || set.ElementIds.Length == 0) return;
            // ⚠️ Нэгтгэгч ТҮҮХИЙ `DocUid`-ээр ирдэг; Intelligence-ийн бүх түлхүүр нормчилсон (§11).
            ChangeTracker.Change change;
            ChangeTracker.TryGetByKey(set.DocKey, out change);
            string docKey = DocKeys.Normalize(set.DocKey);
            RevitChangeSet cs = ChangeSetAdapter.FromLogical(set,
                change != null ? change.Added : null, change != null ? change.Modified : null, change != null ? change.Deleted : null,
                change != null ? change.Ops : null);

            cs.DocKey = docKey;
            SceneGraphStore g;
            lock (_gate) _graphs.TryGetValue(docKey, out g);
            var cats = new Dictionary<string, int[]>(StringComparer.Ordinal);
            if (g != null)
            {
                Count(g, cs.Added, cats, 0); Count(g, cs.Modified, cats, 1); Count(g, cs.Deleted, cats, 2); Count(g, cs.Unclassified, cats, 1);
            }
            Journal.Log(JournalEventKind.CHANGESET, docKey, ev =>
            {
                ev.Added = cs.Added.Count; ev.Modified = cs.Modified.Count + cs.Unclassified.Count; ev.Deleted = cs.Deleted.Count;
                ev.CategoryCounts = cats; ev.Note = string.Join(", ", cs.TransactionNames);
            });
            if (g == null) return;
            g.ApplyChangeSet(cs);
            IssueStore issues; lock (_gate) issues = IssuesFor(docKey);
            List<RevitComplianceIssue> resolved = issues.ResolveForDeleted(cs.Deleted);
            foreach (RevitComplianceIssue i in resolved) Journal.Log(JournalEventKind.ISSUE_RESOLVED, docKey, ev => { ev.IssueId = i.IssueId; ev.IssueClass = i.Class; });
            if (resolved.Count > 0) Raise(IssuesChanged);
            lock (_pendingSets) _pendingSets.Add(cs);
            if (Interlocked.Exchange(ref _refreshScheduled, 1) == 0) Task.Run(RefreshDirty);
        }

        private static void Count(SceneGraphStore g, List<long> ids, Dictionary<string, int[]> cats, int slot)
        {
            foreach (long id in ids)
            {
                SceneNode n = g.Get(id);
                string c = n != null && n.Category != null ? n.Category : "Бусад";
                int[] acc; if (!cats.TryGetValue(c, out acc)) { acc = new int[3]; cats[c] = acc; }
                acc[slot]++;
            }
        }

        /// <summary>Бохирдсон id → `scene_refresh` (TryCall, завгүй бол дараа) → үнэлгээ.</summary>
        private void RefreshDirty()
        {
            _refreshLock.Wait();
            try
            {
                for (int round = 0; round < 50; round++)
                {
                    RevitChangeSet merged;
                    lock (_pendingSets)
                    {
                        if (_pendingSets.Count == 0) { Interlocked.Exchange(ref _refreshScheduled, 0); return; }
                        merged = ChangeSetAdapter.Merge(new List<RevitChangeSet>(_pendingSets));
                        _pendingSets.Clear();
                    }
                    SceneGraphStore g; lock (_gate) _graphs.TryGetValue(merged.DocKey, out g);
                    if (g == null) continue;
                    var dirty = new List<long>(merged.DirtyIds());
                    var touched = new List<long>();
                    var sw = System.Diagnostics.Stopwatch.StartNew();
                    while (dirty.Count > 0)
                    {
                        var batch = dirty.Count > 150 ? dirty.GetRange(0, 150) : new List<long>(dirty);
                        ToolCall c = RevitToolBus.TryCall("scene_refresh", "{\"ids\":[" + string.Join(",", batch) + "],\"geometry\":true}", 10);
                        if (c.Skipped) { Thread.Sleep(400); continue; }
                        if (!c.Success) { SetError("scene_refresh: " + c.Error); break; }
                        var remaining = new List<long>();
                        using (JsonDocument d = JsonDocument.Parse(c.ResultJson))
                        {
                            JsonElement data = d.RootElement.GetProperty("data");
                            foreach (JsonElement r in data.GetProperty("remaining").EnumerateArray()) remaining.Add(r.GetInt64());
                        }
                        foreach (long id in batch) if (!remaining.Contains(id)) touched.Add(id);
                        dirty.RemoveRange(0, batch.Count);
                        dirty.InsertRange(0, remaining);
                        if (remaining.Count == batch.Count) Thread.Sleep(200);
                    }
                    LastRefreshMs = Math.Round(sw.Elapsed.TotalMilliseconds, 1);
                    Journal.Log(JournalEventKind.SCENE_REFRESHED, merged.DocKey, ev => { ev.Modified = touched.Count; ev.Note = LastRefreshMs + " ms"; });
                    // ⚠️ Нэгтгэгчийн `Deleted` нь baseline-ээс ХОЙШ үүссэн элементэд хоосон байж болно
                    //    (хэмжсэн 2026-09-14) — устгалыг `GetElement == null` замаар ГРАФ мэддэг тул
                    //    тэр элементийн олдворыг ЭНД хаана.
                    var nowDeleted = new List<long>();
                    foreach (long id in touched) { SceneNode dn = g.Get(id); if (dn != null && dn.Deleted) nowDeleted.Add(id); }
                    if (nowDeleted.Count > 0)
                    {
                        IssueStore st2; lock (_gate) st2 = IssuesFor(merged.DocKey);
                        foreach (RevitComplianceIssue i in st2.ResolveForDeleted(nowDeleted))
                            Journal.Log(JournalEventKind.ISSUE_RESOLVED, merged.DocKey, ev => { ev.IssueId = i.IssueId; ev.IssueClass = i.Class; ev.Note = "element_deleted"; });
                        Raise(IssuesChanged);
                    }
                    Raise(GraphChanged);
                    // Хана өөрчлөгдвөл хүрээлдэг өрөө ч дахин үнэлэгдэнэ.
                    var toEval = new HashSet<long>(touched);
                    foreach (long id in touched) foreach (long r in g.Neighbors(id, EdgeRelation.BOUNDS_ROOM)) toEval.Add(r);
                    Evaluate(g, new List<long>(toEval));
                }
            }
            finally
            {
                Interlocked.Exchange(ref _refreshScheduled, 0);
                _refreshLock.Release();
                bool more; lock (_pendingSets) more = _pendingSets.Count > 0;
                if (more && Interlocked.Exchange(ref _refreshScheduled, 1) == 0) Task.Run(RefreshDirty);
            }
        }

        /// <summary>
        /// Тест загвар үүссэний ДАРАА — Revit-ийн API контекст дотор (хэрэгслээс дуудагдана):
        /// индексийг бүтнээр дахин барьж, харилцааг гүйцээж, бүх зангилааг үнэлнэ.
        /// Жижиг fixture тул нэг дуудлагад багтана; том загварт ЭНЭ ЗАМ ХЭРЭГЛЭГДЭХГҮЙ.
        /// </summary>
        internal void AfterTestModelCreated(Document doc)
        {
            if (doc == null) return;
            string key = DocKeys.Normalize(RevitTools.DocUid(doc));
            lock (_gate) { _testDocs.Add(key); _indexed.Add(key); }
            _currentDocKey = key;
            SceneGraphStore g = GraphFor(doc);
            SceneGraphExtractor.BuildIndex(doc, g);
            int cursor = 0;
            for (int i = 0; i < 20; i++)
            {
                SceneGraphExtractor.RelationsResult r = SceneGraphExtractor.BuildRoomRelations(doc, g, cursor);
                cursor = r.NextCursor;
                if (r.Done) break;
            }
            var ids = new List<long>();
            foreach (SceneNode n in g.Query(new ElementQuery { Limit = int.MaxValue })) ids.Add(n.ElementId);
            Evaluate(g, ids);
            Raise(GraphChanged);
            _contextDebounce.Trigger();
        }

        /// <summary>Баримтын олдворууд (шийдэгдсэнийг оруулаад) — унших хэрэгсэлд.</summary>
        public List<RevitComplianceIssue> IssuesOf(string docKey, bool includeResolved)
        {
            IssueStore s; lock (_gate) s = IssuesFor(docKey);
            return s.All(includeResolved);
        }

        /// <summary>Одоогийн баримтын БҮХ зангилааг дахин үнэлнэ (самбарын товч).</summary>
        public void EvaluateAllCurrent()
        {
            SceneGraphStore g = CurrentGraph;
            if (g == null) return;
            var ids = new List<long>();
            foreach (SceneNode n in g.Query(new ElementQuery { Limit = int.MaxValue })) ids.Add(n.ElementId);
            Evaluate(g, ids);
        }

        private void Evaluate(SceneGraphStore g, List<long> ids)
        {
            List<BimExecutableRule> ruleList = RulesFor(g.DocKey);
            if (ruleList.Count == 0 || ids.Count == 0) return;
            var sw = System.Diagnostics.Stopwatch.StartNew();
            EvaluationResult res = ComplianceEvaluator.Evaluate(g, ids, ruleList);
            IssueStore store; lock (_gate) store = IssuesFor(g.DocKey);
            IssueDelta delta = store.Apply(res);
            LastEvaluateMs = Math.Round(sw.Elapsed.TotalMilliseconds, 1);
            foreach (RevitComplianceIssue i in delta.Detected)
                Journal.Log(JournalEventKind.ISSUE_DETECTED, g.DocKey, ev => { ev.IssueId = i.IssueId; ev.IssueClass = i.Class; ev.ElementIds = new List<long>(i.ElementIds); ev.Note = i.IssueType; });
            foreach (RevitComplianceIssue i in delta.Resolved)
                Journal.Log(JournalEventKind.ISSUE_RESOLVED, g.DocKey, ev => { ev.IssueId = i.IssueId; ev.IssueClass = i.Class; });
            if (delta.Detected.Count > 0 || delta.Resolved.Count > 0) Raise(IssuesChanged);
        }

        /* ============================================================== */
        /*  НАВИГАЦИ (§45) — RevitToolBus-аар, бичихгүй                     */
        /* ============================================================== */

        public Task<bool> ShowElementAsync(long elementId)
        {
            return Task.Run(() =>
            {
                ToolCall c = RevitToolBus.Call("show_element", "{\"element_id\":" + elementId + "}", 15);
                if (!c.Success) SetError("show_element: " + (c.TimedOut ? "REVIT_BUSY" : c.Error));
                return c.Success;
            });
        }

        public Task<bool> SelectElementsAsync(IList<long> ids)
        {
            return Task.Run(() =>
            {
                ToolCall c = RevitToolBus.Call("select_elements", "{\"ids\":[" + string.Join(",", ids) + "]}", 15);
                if (!c.Success) SetError("select_elements: " + (c.TimedOut ? "REVIT_BUSY" : c.Error));
                return c.Success;
            });
        }

        /* ============================================================== */
        /*  DEV / TEST — синтетик загвар (тест даалгаврын §3–§14)             */
        /* ============================================================== */

        /// <summary>Хэрэгслийг АРЫН thread дээр дуудна; хариу JSON (эсвэл алдаа).  UI thread-ээс ХЭЗЭЭ Ч шууд Call хийхгүй.</summary>
        public Task<ToolCall> CallToolAsync(string tool, string argsJson, int timeoutSeconds = 60)
        {
            return Task.Run(() =>
            {
                ToolCall c = RevitToolBus.Call(tool, argsJson ?? "{}", timeoutSeconds);
                if (!c.Success) SetError(tool + ": " + (c.TimedOut ? "REVIT_BUSY" : c.Error));
                else _contextDebounce.Trigger();
                return c;
            });
        }

        /* ============================================================== */
        /*  ТАЙЛАН (R2)                                                    */
        /* ============================================================== */

        public RevitReport BuildReport(ReportPeriodKind period, ReportAudience audience, int? taskId = null)
        {
            DateTime now = DateTime.UtcNow;
            DateTime start = period == ReportPeriodKind.TODAY ? DateTime.UtcNow.Date : Journal.SessionStartedUtc;
            RevitContextSnapshot snap = Current;
            IssueStore issues = CurrentIssues;
            RevitReportEvidence ev = ReportEvidenceBuilder.Build(
                period, start, now,
                Journal.Read(start, now, _currentDocKey),
                snap != null ? snap.Document : null,
                CurrentLink, CurrentTasks, CandidateSetsForCurrentDoc(),
                issues != null ? issues.All(includeResolved: true) : null,
                taskId);
            RevitReport r = ReportRenderer.Render(ev, audience);
            Journal.Log(JournalEventKind.REPORT_GENERATED, _currentDocKey, e => { e.Note = period + "/" + audience; e.TaskId = taskId; });
            return r;
        }

        /* ============================================================== */
        /*  MGL AI (R-6)                                                   */
        /* ============================================================== */

        /* ── Ярианы төлөв (хөтчийн MglAiPage-тэй ижил дүрэм): seq = мессежийн тоо, түүх сүүлийн 10,
              conv_state = өмнөх ээлжийн convStateNext хөндөлгүй; ХҮЧИНГҮЙ хариулт (repetition/timeout/
              interrupted/алдаа) түүхэнд ОРОХГҮЙ (§7).  Баримт солигдоход яриа ШИНЭЭР. ── */
        private readonly object _convGate = new object();
        private readonly List<RevitChatTurnWire> _convHistory = new List<RevitChatTurnWire>();
        private JsonElement? _convState;
        private int _convSeq;
        private string _convDocKey;
        private const int ConvHistoryMax = 10;

        /// <summary>Тайлангийн асуулт эсэх — детерминист нотолгоог утсанд хавсаргах хаалга (журнал уншилт үнэтэй тул зөвхөн энд).</summary>
        internal static bool LooksLikeReportQuestion(string q)
        {
            if (string.IsNullOrEmpty(q)) return false;
            string f = TextFold.Fold(q);
            return f.Contains("tailan") || f.Contains("report") || f.Contains("tailag");
        }

        public async Task<RevitTurnResult> AskAsync(string question, CancellationToken ct)
        {
            // ⚠️ ШИНЭ SNAPSHOT — кэшлэсэн `Current` нь сонголт солигдсоны дараа debounce дуустал ХУУЧИН байж болно
            //    (R3.5 smoke: эхний асуултад сонголт ХООСОН явж, хөдөлгүүр GENERAL_HELP/free болж байв).
            //    RevitToolBus-ыг Revit-ийн thread дээр ХҮЛЭЭХГҮЙ — Task.Run (R-14).
            await Task.Run(() => RefreshContext()).ConfigureAwait(false);
            RevitContextSnapshot snap = Current;
            MglAiReportWire reportWire = null;
            if (LooksLikeReportQuestion(question) && _currentDocKey != null)
            {
                try { reportWire = MglAiWire.ReportToWire(BuildReport(ReportPeriodKind.TODAY, ReportAudience.TECHNICAL_SELF_REPORT)); }
                catch { reportWire = null; }
            }
            RevitTurnRequest req;
            lock (_convGate)
            {
                if (!string.Equals(_convDocKey, _currentDocKey, StringComparison.Ordinal))
                {
                    _convHistory.Clear(); _convState = null; _convSeq = 0; _convDocKey = _currentDocKey;
                }
                req = new RevitTurnRequest
                {
                    Question = question,
                    ConvUid = "revit-" + Journal.SessionId + "-" + (_currentDocKey ?? "nodoc").GetHashCode().ToString("x"),
                    Seq = _convSeq,
                    RevitContext = MglAiWire.FromSnapshot(snap, _currentDocKey != null ? IssuesOf(_currentDocKey, false) : null),
                    History = new List<RevitChatTurnWire>(_convHistory),
                    ConvState = _convState,
                };
            }
            if (reportWire != null && req.RevitContext != null) req.RevitContext.Report = reportWire;
            RevitTurnResult r = await Ai.AskAsync(req, ct).ConfigureAwait(false);
            lock (_convGate)
            {
                bool valid = r.State == RevitErrorState.OK && !string.IsNullOrEmpty(r.AnswerMn)
                    && (r.StopReason == null || r.StopReason == "stop" || r.StopReason == "length");
                if (valid)
                {
                    _convHistory.Add(new RevitChatTurnWire { Role = "user", Content = question });
                    _convHistory.Add(new RevitChatTurnWire { Role = "assistant", Content = r.AnswerMn });
                    while (_convHistory.Count > ConvHistoryMax) _convHistory.RemoveAt(0);
                    _convSeq += 2;
                    if (r.ConvStateNext.HasValue) _convState = r.ConvStateNext;
                }
            }
            Journal.Log(JournalEventKind.MGL_AI_TURN, _currentDocKey, e => e.Note = r.Source + "/" + r.Binding);
            // R4.2 — загварын санал → детерминист binder (шинэ snapshot) → preview.  Загвар ХЭЗЭЭ Ч гүйцэтгэхгүй.
            if (r.ActionCandidate != null)
            {
                try
                {
                    await Task.Run(() => RefreshContext()).ConfigureAwait(false);
                    RevitActionBinder.BindResult b = RevitActionBinder.Bind(r.ActionCandidate, Current, question, _currentDocKey, _currentDocKey != null ? IssuesOf(_currentDocKey, false) : null);
                    foreach (ActionValidationCode c in b.Codes) r.ActionBindCodes.Add(c.ToString());
                    r.ActionBindNote = b.NoteMn;
                    if (b.Ok)
                    {
                        r.ActionPreview = await PreviewAsync(b.Envelope).ConfigureAwait(false);
                        if (r.ActionPreview != null && r.ActionPreview.Validation != null && !r.ActionPreview.Validation.Ok)
                            foreach (ActionValidationCode c in r.ActionPreview.Validation.Codes) if (c != ActionValidationCode.OK) r.ActionBindCodes.Add(c.ToString());
                    }
                    Audit.Write(new ActionAuditRecord { Stage = "candidate", Action = b.Envelope != null ? b.Envelope.Action : RevitActionKind.SHOW_ELEMENT, ActionId = b.Envelope != null ? b.Envelope.ActionId : null, RequestedBy = "MODEL", Result = b.Ok ? "BOUND" : "BIND_REJECTED", Codes = new List<string>(r.ActionBindCodes), Proposed = r.ActionCandidate.ActionType + " " + IntelligenceJson.Serialize(r.ActionCandidate.Arguments) });
                }
                catch (Exception ex) { r.ActionBindCodes.Add("BIND_ERROR:" + ex.GetType().Name); }
            }
            else if (!string.IsNullOrEmpty(r.ActionCandidateRejected))
            {
                r.ActionBindCodes.Add("CANDIDATE_SCHEMA_REJECTED:" + r.ActionCandidateRejected);
            }
            return r;
        }

        /* ── DEV: тасалбартай асуулт — bridge-ийн хэрэгсэл Revit-ийн API thread дээр ажилладаг тул
              HTTP/AI-г тэнд ХҮЛЭЭХГҮЙ (R-14): ai_ask → тасалбар, ai_poll → үр дүн. ── */
        private readonly System.Collections.Concurrent.ConcurrentDictionary<string, RevitTurnResult> _tickets = new System.Collections.Concurrent.ConcurrentDictionary<string, RevitTurnResult>();

        public string AskTicket(string question)
        {
            string id = "t" + Guid.NewGuid().ToString("N").Substring(0, 10);
            _tickets[id] = null;
            Task.Run(async () =>
            {
                RevitTurnResult r;
                try { r = await AskAsync(question, CancellationToken.None).ConfigureAwait(false); }
                catch (Exception ex) { r = new RevitTurnResult { State = RevitErrorState.MGL_AI_OFFLINE, Source = TurnAnswerSource.ERROR, AnswerMn = "Алдаа: " + ex.GetType().Name }; }
                _tickets[id] = r;
            });
            return id;
        }

        public bool TryGetTicket(string id, out RevitTurnResult result)
        {
            return _tickets.TryGetValue(id, out result);
        }

        public async Task ProbeRuntimeAsync()
        {
            MglAiRuntimeStatus st = await MglAiRuntimeProbe.ProbeAsync().ConfigureAwait(false);
            lock (_gate) _runtime = st;
            Raise(ContextChanged);
        }

        /* ============================================================== */

        private void SetError(string msg)
        {
            LastError = msg;
            if (msg != null) Raise(Status, msg);
        }

        private static void Raise(Action a)
        {
            if (a == null) return;
            try { a(); } catch { }
        }

        private static void Raise(Action<string> a, string s)
        {
            if (a == null) return;
            try { a(s); } catch { }
        }
    }
}
