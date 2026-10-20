using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;
using RevitMcpAddin.ClashCheck.Core;
using RevitMcpAddin.Smart;
using RevitMcpAddin.Smart.Core;

namespace RevitMcpAddin.ClashCheck
{
    /// <summary>
    /// Clash шалгалтын ХЭСЭГЛЭСЭН ажил (`SmartExecutor`).
    ///
    ///   Prepare → CollectA → CollectB → Index → Candidates → Verify → Evidence → Finish
    ///
    /// КОНВЕЙЕР:  дүрэм → A/B цуглуулах (host ба/эсвэл линк) → ХУРДАН шүүлт: ангилал (collector) →
    ///   bbox → ТОР (spatial hash)-аар нэр дэвшигч хос → ЗӨВХӨН тэдэнд нарийн геометр → ангилал → fingerprint →
    ///   lifecycle-тэй нэгтгэх.  O(n²) БАЙХГҮЙ: A×B бүх хосыг ХЭЗЭЭ Ч геометрээр шалгахгүй.
    ///
    /// ГЭРЭЭ:
    ///   • Revit-ийн амьд обьектыг Step хооронд ХАДГАЛАХГҮЙ (зөвхөн ХУУЛСАН `SideItem` + ElementId).  Линкийн
    ///     instance, transform, Document-ийг Step бүрт дахин авна (`ClashLinks.Resolve`).
    ///   • Step бүрийн эхэнд идэвхтэй баримт ЯГ ЭНЭ баримт эсэх, загвар өөрчлөгдсөн эсэхийг шалгана
    ///     (өөрчлөгдсөн бол солидын кэш цэвэрлэгдэж, үр дүнд тэмдэглэнэ).
    ///   • Цуцлалт Step-ийн хооронд; цуцлагдсан гүйлт `Cancelled` — ТҮҮНЭЭС «Resolved» болгохгүй (бүрэн биш).
    ///   • Алдаа → гүйлт `Failed` гэж түүхэд бичигдэж, алдаа дээш шидэгдэнэ.
    /// </summary>
    internal sealed class ClashJob : ISmartJob
    {
        private enum Phase { Prepare, CollectA, CollectB, Index, Candidates, Verify, Evidence, Finish, Done }

        private const int CollectBatch = 400;
        private const int CandidateBatch = 1500;
        private const int VerifySliceMs = 100;
        private const int MaxSideItems = 400000;
        private const int MaxCandidatePairs = 2000000;
        private const int MaxConfirmed = 50000;

        private sealed class SourceBatch
        {
            public int Slot;
            public List<ElementId> Ids;
            public int Pos;
        }

        private sealed class Side
        {
            public readonly List<SideItem> Items = new List<SideItem>();
            public readonly Queue<SourceBatch> Batches = new Queue<SourceBatch>();
            public int Total;
            public int Done;
            public int WithoutBounds;
            public int Excluded;
        }

        private readonly ClashRule _rule;
        private readonly DocumentKey _key;
        private readonly IProgress<JobProgress> _progress;
        private readonly StageTimer _timer = new StageTimer();
        private readonly string _ruleHash;
        private readonly bool _symmetric;

        private Phase _phase = Phase.Prepare;
        private Side _a, _b;
        private readonly List<LinkSlot> _slots = new List<LinkSlot>();
        private RevitKeyScope _scope;
        private Document _hostDoc;
        private GeometryVerifier _verifier;
        private CandidateGenerator _gen;
        private int _verifyPos;
        private List<long> _pairs;
        private string _stamp, _lastStamp;
        private bool _modelChanged;
        private int _linksUnloaded;
        private readonly Dictionary<string, bool> _nameCache = new Dictionary<string, bool>(StringComparer.Ordinal);
        private readonly Dictionary<string, HashSet<long>> _connectedCache = new Dictionary<string, HashSet<long>>(StringComparer.Ordinal);
        private readonly Dictionary<int, ClashLinks.Resolved> _stepLinks = new Dictionary<int, ClashLinks.Resolved>();

        // «Resolved»-ийн нотолгоо: өмнөх issue-ийн элемент одоо байгаа эсэхийг Finish-ээс ӨМНӨ, хэсэг хэсгээр (UI царцаахгүй) цуглуулна.
        private Queue<ElementKey> _evidenceKeys;
        private int _evidenceTotal, _evidenceDone;
        private readonly Dictionary<string, bool?> _existence = new Dictionary<string, bool?>(StringComparer.Ordinal);
        private readonly Dictionary<int, bool> _hidesCache = new Dictionary<int, bool>();
        /// <summary>Prepare үеийн орчны хурууны хээ (`EnvironmentSignature`) — нотолгоо цуглуулахын өмнө ба дуусгахад харьцуулна.</summary>
        private string _envSig;

        private readonly List<DetectedClash> _detected = new List<DetectedClash>();
        private readonly HashSet<string> _seenFps = new HashSet<string>(StringComparer.Ordinal);
        private readonly bool _mayOverlapSets;
        private HashSet<string> _prevFps;
        private readonly Dictionary<string, ClashVerdict> _verdictByFp = new Dictionary<string, ClashVerdict>(StringComparer.Ordinal);
        private readonly HashSet<string> _ignoredFps = new HashSet<string>(StringComparer.Ordinal);
        private int _skippedByDesign, _noClash, _unsupported, _geoErrors;
        private bool _confirmedCapped;
        private readonly ClashRunRecord _run;
        private readonly List<string> _notes = new List<string>();
        private bool _finalized;

        public ClashRunOutcome Result { get; private set; }
        public string Name { get { return "Clash Checker"; } }

        internal ClashJob(ClashRule rule, DocumentKey key, IProgress<JobProgress> progress)
        {
            _rule = rule.Clone();
            _key = key;
            _progress = progress;
            _ruleHash = ClashRuleLogic.SemanticHash(_rule);
            _symmetric = _rule.Symmetric;
            _mayOverlapSets = !_symmetric && CategoriesOverlap(_rule.A, _rule.B);
            _run = new ClashRunRecord
            {
                RuleId = _rule.Id,
                RuleName = _rule.Name,
                RuleHash = _ruleHash,
                StartedUtc = SmartClock.UtcNow,
                Status = RunStatus.Running,
            };
        }

        private static bool CategoriesOverlap(ClashSelector a, ClashSelector b)
        {
            var sa = new HashSet<string>(a.Categories.Select(c => c.Trim().ToUpperInvariant()));
            return b.Categories.Any(c => sa.Contains(c.Trim().ToUpperInvariant()));
        }

        /* ============================== STEP =============================== */

        public bool Step(UIApplication app)
        {
            try
            {
                Document doc = ActiveDocument(app);
                CheckModelChange(doc);
                _stepLinks.Clear();

                switch (_phase)
                {
                    case Phase.Prepare: Prepare(doc); break;
                    case Phase.CollectA: CollectStep(doc, _a, _rule.A, "A"); break;
                    case Phase.CollectB: CollectStep(doc, _b, _rule.B, "B"); break;
                    case Phase.Index: BuildIndex(); break;
                    case Phase.Candidates: CandidateStep(); break;
                    case Phase.Verify: VerifyStep(doc); break;
                    case Phase.Evidence: EvidenceStep(doc); break;
                    case Phase.Finish: Finish(doc); break;
                }
                return _phase == Phase.Done;
            }
            catch (Exception ex)
            {
                RecordFailure(ex);
                throw;
            }
        }

        public void OnCancelled()
        {
            if (_finalized) return;
            if (_phase == Phase.Prepare)
            {
                // Юу ч эхлээгүй — түүхэд хоосон «цуцлагдсан» мөр нэмэхгүй.
                _finalized = true;
                return;
            }
            // Цуцлагдсан: илэрсэн хэсгээ «шинэ/шинэчлэгдсэн» гэж хадгална, ЮУГ Ч «Resolved» болгохгүй.
            FinalizeRun(RunStatus.Cancelled, false, null);
        }

        private Document ActiveDocument(UIApplication app)
        {
            UIDocument ui = app.ActiveUIDocument;
            Document doc = ui != null ? ui.Document : null;
            if (doc == null) throw new InvalidOperationException("Идэвхтэй баримт алга.");
            if (!_key.Equals(RevitDocumentKeys.Of(doc)))
                throw new InvalidOperationException("Идэвхтэй файл солигдсон — шалгалт эхэлсэн файл руугаа буцна уу.");
            if (_hostDoc == null) _hostDoc = doc;
            else if (!SmartDocs.IsAlive(_hostDoc) || !SmartDocs.Same(_hostDoc, doc))      // хаагдсан wrapper-ийн `Equals`-д найдахгүй (undocumented)
                throw new InvalidOperationException("Баримт хаагдаж дахин нээгдсэн — шалгалтыг дахин эхлүүлнэ үү.");
            else _hostDoc = doc;               // ижил баримтын шинэ wrapper байж болно — хамгийн сүүлийнхийг ашиглана
            return doc;
        }

        private void CheckModelChange(Document doc)
        {
            string now = ModelChangeCounter.Stamp(doc);
            if (_stamp == null) { _stamp = now; _lastStamp = now; return; }
            if (now != _lastStamp)
            {
                _lastStamp = now;
                _modelChanged = true;
                if (_verifier != null) _verifier.Invalidate();   // хуучин solid-оор хариулахгүй
            }
        }

        /* ============================== PREPARE ============================ */

        private void Prepare(Document doc)
        {
            _timer.Begin("collect");
            List<RuleIssue> issues = ClashRuleLogic.Validate(_rule);
            if (!ClashRuleLogic.IsRunnable(issues))
                throw new InvalidOperationException(string.Join("\n", issues.Where(i => i.IsError).Select(i => i.Message)));

            _scope = new RevitKeyScope(doc);
            int closedWorksetDocs = 0;
            foreach (RevitLinkInstance inst in new FilteredElementCollector(doc).OfClass(typeof(RevitLinkInstance)).Cast<RevitLinkInstance>())
            {
                Document ld = null;
                try { ld = inst.GetLinkDocument(); } catch (Exception) { }
                if (ld == null) { _linksUnloaded++; continue; }
                _slots.Add(new LinkSlot
                {
                    InstanceId = inst.Id.Value,
                    InstanceUid = inst.UniqueId,
                    Name = ClashLinks.DisplayName(inst),
                    LinkDocId = RevitDocumentKeys.Of(ld).Id,
                });
                if (HidesElements(ld, _slots.Count - 1)) closedWorksetDocs++;
            }
            if (HidesElements(doc, -1)) closedWorksetDocs++;
            // Хаалттай workset-ийн элементийг Revit ачаалдаггүй тул collector тэдгээрийг БУЦААХГҮЙ — шалгагдаагүйг ИЛ хэлнэ.
            if (closedWorksetDocs > 0)
                _notes.Add("⚠ " + closedWorksetDocs + " баримтад хаалттай workset байна — тэдгээрийн элементийг шалгаагүй (clash илрээгүй ≠ clash байхгүй).");
            if (_linksUnloaded > 0) _notes.Add("⚠ " + _linksUnloaded + " линк unload хийгдсэн тул алгасагдлаа — тэдгээрийн элементийг шалгаагүй.");

            _envSig = EnvironmentSignature(doc);

            _a = new Side();
            _b = _symmetric ? _a : new Side();
            PlanSide(doc, _a, _rule.A);
            if (!_symmetric) PlanSide(doc, _b, _rule.B);

            // Өмнөх идэвхтэй issue-уудын fingerprint (энэ дүрэм + энэ хэш) — зөвхөн тэдний дүнг хадгална.
            ClashState state = ClashStateStore.Load(_key);
            _prevFps = new HashSet<string>(state.Issues
                .Where(i => i.RuleId == _rule.Id && i.RuleHash == _ruleHash && i.Status != ClashStatus.Resolved && !string.IsNullOrEmpty(i.Fingerprint))
                .Select(i => i.Fingerprint), StringComparer.Ordinal);

            _phase = Phase.CollectA;
            Report("Элемент цуглуулж байна (A)", 0, _a.Total);
        }

        /// <summary>Эх сурвалж (host / линк) бүрийн элементийн id-г ХУРДАН шүүлтүүрээр (ангилал) авна.</summary>
        private void PlanSide(Document host, Side side, ClashSelector sel)
        {
            var cats = new List<BuiltInCategory>();
            foreach (string name in sel.Categories)
            {
                BuiltInCategory bic;
                if (Enum.TryParse(name.Trim(), true, out bic) && Enum.IsDefined(typeof(BuiltInCategory), bic)) cats.Add(bic);
                else _notes.Add("Ангилал «" + name + "» танигдсангүй — алгассан.");
            }
            if (cats.Count == 0) return;
            ElementFilter filter = cats.Count == 1 ? (ElementFilter)new ElementCategoryFilter(cats[0]) : new ElementMulticategoryFilter(cats);

            if (sel.Source == ClashSource.Host || sel.Source == ClashSource.Both)
                AddBatch(side, -1, new FilteredElementCollector(host).WherePasses(filter).WhereElementIsNotElementType().ToElementIds().ToList());

            if (sel.Source == ClashSource.Links || sel.Source == ClashSource.Both)
            {
                for (int s = 0; s < _slots.Count; s++)
                {
                    if (!string.IsNullOrWhiteSpace(sel.LinkContains) && _slots[s].Name.IndexOf(sel.LinkContains.Trim(), StringComparison.OrdinalIgnoreCase) < 0) continue;
                    ClashLinks.Resolved link = ClashLinks.Resolve(host, _slots[s]);
                    if (link == null) { _linksUnloaded++; continue; }
                    AddBatch(side, s, new FilteredElementCollector(link.Doc).WherePasses(filter).WhereElementIsNotElementType().ToElementIds().ToList());
                }
            }
        }

        private static void AddBatch(Side side, int slot, List<ElementId> ids)
        {
            if (ids.Count == 0) return;
            side.Batches.Enqueue(new SourceBatch { Slot = slot, Ids = ids });
            side.Total += ids.Count;
        }

        /* ============================== COLLECT ============================ */

        private void CollectStep(Document host, Side side, ClashSelector sel, string label)
        {
            _timer.Begin("collect");
            int budget = CollectBatch;
            while (budget > 0 && side.Batches.Count > 0)
            {
                SourceBatch b = side.Batches.Peek();
                Document doc = host;
                Transform toHost = null;
                RevitLinkInstance via = null;
                if (b.Slot >= 0)
                {
                    ClashLinks.Resolved link = StepLink(host, b.Slot);
                    if (link == null) { side.Batches.Dequeue(); _notes.Add("Линк «" + _slots[b.Slot].Name + "» цуглуулах үед unload болсон."); continue; }
                    doc = link.Doc; toHost = link.Transform; via = link.Instance;
                }

                int end = Math.Min(b.Ids.Count, b.Pos + budget);
                for (; b.Pos < end; b.Pos++)
                {
                    side.Done++;
                    budget--;
                    Element e;
                    try { e = doc.GetElement(b.Ids[b.Pos]); } catch (Exception) { continue; }
                    if (e == null) continue;
                    if (!PassesName(doc, e, sel.NameContains, b.Slot))
                    {
                        side.Excluded++;
                        continue;
                    }

                    Aabb box;
                    if (!TryBox(e, toHost, out box)) { side.WithoutBounds++; continue; }
                    if (side.Items.Count >= MaxSideItems)
                    {
                        _notes.Add(label + " талд " + MaxSideItems + "-аас олон элемент — үлдсэнийг алгасав. Дүрмийг нарийсгана уу.");
                        side.Batches.Clear();
                        break;
                    }
                    side.Items.Add(new SideItem
                    {
                        Key = via == null ? _scope.Host(e) : _scope.Linked(via, doc, e),
                        IdValue = e.Id.Value,
                        Slot = b.Slot,
                        Box = box,
                    });
                }
                if (b.Pos >= b.Ids.Count) side.Batches.Dequeue();
            }

            Report("Элемент цуглуулж байна (" + label + ")", side.Done, side.Total);
            if (side.Batches.Count > 0) return;

            if (_phase == Phase.CollectA)
            {
                _phase = _symmetric ? Phase.Index : Phase.CollectB;
                if (!_symmetric) Report("Элемент цуглуулж байна (B)", 0, _b.Total);
            }
            else _phase = Phase.Index;
        }

        private ClashLinks.Resolved StepLink(Document host, int slot)
        {
            ClashLinks.Resolved r;
            if (_stepLinks.TryGetValue(slot, out r)) return r;
            r = ClashLinks.Resolve(host, _slots[slot]);
            _stepLinks[slot] = r;
            return r;
        }

        private bool PassesName(Document doc, Element e, string needle, int slot)
        {
            if (string.IsNullOrWhiteSpace(needle)) return true;
            ElementId tid;
            try { tid = e.GetTypeId(); } catch (Exception) { return false; }
            string ck = slot + "|" + (tid != null ? tid.Value : -1) + "|" + needle;
            bool ok;
            if (_nameCache.TryGetValue(ck, out ok)) return ok;
            var t = tid != null ? doc.GetElement(tid) as ElementType : null;
            string n = needle.Trim();
            ok = t != null
                && ((t.Name ?? "").IndexOf(n, StringComparison.OrdinalIgnoreCase) >= 0 || (t.FamilyName ?? "").IndexOf(n, StringComparison.OrdinalIgnoreCase) >= 0);
            _nameCache[ck] = ok;
            return ok;
        }

        /// <summary>Элементийн bbox → host координатын AABB (мм).  `bb.Transform` ба линкийн transform-ыг хоёуланг нь хэрэглэнэ.</summary>
        private static bool TryBox(Element e, Transform toHost, out Aabb box)
        {
            box = default(Aabb);
            BoundingBoxXYZ bb;
            try { bb = e.get_BoundingBox(null); } catch (Exception) { return false; }
            if (bb == null) return false;

            Transform own = bb.Transform;
            double minX = double.MaxValue, minY = double.MaxValue, minZ = double.MaxValue;
            double maxX = double.MinValue, maxY = double.MinValue, maxZ = double.MinValue;
            for (int i = 0; i < 8; i++)
            {
                var c = new XYZ((i & 1) == 0 ? bb.Min.X : bb.Max.X, (i & 2) == 0 ? bb.Min.Y : bb.Max.Y, (i & 4) == 0 ? bb.Min.Z : bb.Max.Z);
                XYZ w = own != null ? own.OfPoint(c) : c;
                if (toHost != null) w = toHost.OfPoint(w);
                if (w.X < minX) minX = w.X; if (w.X > maxX) maxX = w.X;
                if (w.Y < minY) minY = w.Y; if (w.Y > maxY) maxY = w.Y;
                if (w.Z < minZ) minZ = w.Z; if (w.Z > maxZ) maxZ = w.Z;
            }
            box = ClashUnits.ToMm(new XYZ(minX, minY, minZ), new XYZ(maxX, maxY, maxZ));
            return box.IsValid;
        }

        /* ============================== INDEX / CANDIDATES ================= */

        private void BuildIndex()
        {
            _timer.Begin("candidates");
            _run.ACount = _a.Items.Count;
            _run.BCount = _symmetric ? _a.Items.Count : _b.Items.Count;
            _run.ElementsWithoutBounds = _a.WithoutBounds + (_symmetric ? 0 : _b.WithoutBounds);

            if (_a.Items.Count == 0 || _b.Items.Count == 0)
            {
                _notes.Add("Шалгах элемент олдсонгүй (A: " + _a.Items.Count + ", B: " + _b.Items.Count + ").");
                _pairs = new List<long>();
                _phase = Phase.Evidence;
                return;
            }

            var aBoxes = _a.Items.Select(i => i.Box).ToList();
            var bBoxes = _symmetric ? aBoxes : _b.Items.Select(i => i.Box).ToList();
            _gen = new CandidateGenerator(aBoxes, bBoxes, _symmetric, 0, MaxCandidatePairs);
            _gen.BuildIndex();
            _phase = Phase.Candidates;
            Report("Нэр дэвшигч хос хайж байна", 0, _a.Items.Count);
        }

        private void CandidateStep()
        {
            _timer.Begin("candidates");
            // Нэг Step-д хугацааны хязгаар: нягт геометрт элемент бүр олон мянган хостой давхцаж болох тул тогтмол 1500 элемент нь Revit-ийн UI-г
            // секундээр гацаана.  Жижиг багцаар ажиллаад `VerifySliceMs` хүрмэгц буцна.
            var sw = Stopwatch.StartNew();
            bool done;
            do { done = _gen.Step(CandidateBatch / 15); }
            while (!done && sw.ElapsedMilliseconds < VerifySliceMs);
            Report("Нэр дэвшигч хос хайж байна (" + _gen.Pairs.Count + " хос)", _gen.NextA, _a.Items.Count);
            if (!done) return;

            if (_gen.Overflow)
                throw new InvalidOperationException("Нэр дэвшигч хос хэт олон (>" + MaxCandidatePairs + ") — дүрэм хэт өргөн. A/B ангилал, нэрийн шүүлтүүрийг нарийсгана уу.");

            _pairs = _gen.Pairs;
            _run.Candidates = _pairs.Count;
            _phase = Phase.Verify;
            Report("Геометр шалгаж байна", 0, _pairs.Count);
        }

        /* ============================== VERIFY ============================= */

        private void VerifyStep(Document doc)
        {
            _timer.Begin("verify");
            if (_verifier == null) _verifier = new GeometryVerifier(doc, _slots);
            else _verifier.BeginStep();
            var sw = Stopwatch.StartNew();
            List<SideItem> bItems = _symmetric ? _a.Items : _b.Items;

            while (_verifyPos < _pairs.Count && sw.ElapsedMilliseconds < VerifySliceMs)
            {
                long packed = _pairs[_verifyPos++];
                int ai = CandidateGenerator.PairA(packed), bi = CandidateGenerator.PairB(packed);
                SideItem a = _a.Items[ai], b = bItems[bi];
                if (a.Key.Equals(b.Key)) continue;

                string fp = ClashRuleLogic.Fingerprint(_rule.Id, _ruleHash, a.Key, b.Key);
                if (_mayOverlapSets && !_seenFps.Add(fp)) continue;     // ижил хос хоёр жагсаалтад

                if (IgnoredByDesign(doc, a, b))
                {
                    _skippedByDesign++;
                    if (_prevFps.Contains(fp)) _ignoredFps.Add(fp);   // өмнө clash байсан хос одоо join/hosted/холбогдсон
                    continue;
                }

                PairResult pr = _verifier.Verify(a, b, _rule, ai, bi);
                if (_prevFps.Contains(fp)) _verdictByFp[fp] = pr.Verdict;

                switch (pr.Verdict)
                {
                    case ClashVerdict.ConfirmedClash:
                        if (_detected.Count >= MaxConfirmed) { _confirmedCapped = true; break; }
                        _detected.Add(MakeDetected(doc, a, b, pr, fp));
                        break;
                    case ClashVerdict.NoClash: _noClash++; break;
                    case ClashVerdict.Unsupported: _unsupported++; break;
                    default: _geoErrors++; break;
                }
            }

            Report("Геометр шалгаж байна (" + _detected.Count + " clash)", _verifyPos, _pairs.Count);
            if (_verifyPos >= _pairs.Count) _phase = Phase.Evidence;
        }

        /* ============================== EVIDENCE =========================== */

        /// <summary>
        /// Өмнө идэвхтэй, энэ удаа ИЛЭРЭЭГҮЙ clash бүрийн хоёр элемент одоо загварт байгаа эсэхийг цуглуулна.  Тусдаа,
        /// хугацаагаар хэсэглэсэн шат — олон мянган issue-тэй түүхийг НЭГ Step дотор шалгаж Revit-ийг царцаахгүйн тулд.
        /// Загвар шалгалтын явцад өөрчлөгдсөн бол нотолгоо хуучирсан тул цуглуулахгүй (гүйлт «бүрэн БИШ» болж, юу ч Resolved болохгүй).
        /// </summary>
        private void EvidenceStep(Document doc)
        {
            _timer.Begin("evidence");
            if (_evidenceKeys == null)
            {
                CheckEnvironment(doc);        // нотолгоо цуглуулахын ӨМНӨ: орчин (линк/workset) өөрчлөгдсөн бол нотолгоо цуглуулахгүй (`_modelChanged`)
                _evidenceKeys = new Queue<ElementKey>();
                if (!_modelChanged && !_confirmedCapped)
                {
                    var detectedFps = new HashSet<string>(_detected.Select(d => d.Fingerprint), StringComparer.Ordinal);
                    var queued = new HashSet<string>(StringComparer.Ordinal);
                    ClashState st = ClashStateStore.Load(_key);
                    foreach (ClashIssue p in st.Issues)
                    {
                        if (p.RuleId != _rule.Id || p.RuleHash != _ruleHash || p.Status == ClashStatus.Resolved) continue;
                        string fp = p.Fingerprint;
                        if (string.IsNullOrEmpty(fp) || detectedFps.Contains(fp) || _ignoredFps.Contains(fp) || _verdictByFp.ContainsKey(fp)) continue;
                        foreach (ElementKey ek in new[] { p.A.ElementKey, p.B.ElementKey })
                            if (ek.IsValid && queued.Add(ek.ToString())) _evidenceKeys.Enqueue(ek);
                    }
                }
                _evidenceTotal = _evidenceKeys.Count;
                _evidenceDone = 0;
            }

            var sw = Stopwatch.StartNew();
            while (_evidenceKeys.Count > 0 && sw.ElapsedMilliseconds < VerifySliceMs)
            {
                ElementKey k = _evidenceKeys.Dequeue();
                _existence[k.ToString()] = ExistsLive(doc, k);
                _evidenceDone++;
            }

            if (_evidenceTotal > 0) Report("Өмнөх clash-ийн нотолгоо цуглуулж байна", _evidenceDone, _evidenceTotal);
            if (_evidenceKeys.Count == 0) _phase = Phase.Finish;
        }

        /// <summary>true = байна, false = БАЙХГҮЙ (устсан гэдэг нь батлагдсан), null = мэдэгдэхгүй (линк unload / workset хаалттай байж болно).</summary>
        private bool? ExistsLive(Document host, ElementKey k)
        {
            try
            {
                Document d = host;
                int slot = -1;
                if (k.IsLinked)
                {
                    slot = _slots.FindIndex(s => s.InstanceUid == k.Via);
                    if (slot < 0) return null;
                    // Линкийн instance ӨӨР файл руу заавал дахин заагдсан (Reload From) бол өмнөх clash-ийн элемент тэр ӨӨР файлынх — энэ файлд
                    // «олдсонгүй» нь «устсан» гэсэн үг БИШ (хоёр нөхцөлд хоёуланд нь «мэдэгдэхгүй»).
                    if (!string.Equals(_slots[slot].LinkDocId, k.Doc, StringComparison.Ordinal)) return null;
                    ClashLinks.Resolved link = StepLink(host, slot);
                    if (link == null) return null;
                    d = link.Doc;
                }
                if (d.GetElement(k.Uid) != null) return true;
                // GetElement==null нь «устсан» гэсэн үг БИШ байж болно: хаалттай workset-ийн элементийг Revit ачаалдаггүй.
                return HidesElements(d, slot) ? (bool?)null : false;
            }
            catch (Exception) { return null; }
        }

        /// <summary>
        /// ОРЧНЫ «хурууны хээ»: хаалттай workset-үүд (host + линк бүр), линк бүрийн одоогийн баримт (файл) ба transform.  Workset нээх/хаах, линкийг дахин
        /// ачаалах/хөдөлгөх нь `DocumentChanged` БИШ — `ModelChangeCounter` үүнийг мэдэхгүй.  Гэвч ингэсэн бол элемент цуглуулалт, «байхгүй» нотолгоо
        /// (`_hidesCache`), линкийн координат бүгд хуучирна → гүйлт «бүрэн БИШ».  Уншиж чадахгүй бол «?» (ЭНЭ нь өмнөхөөс ялгаатай гэж тооцогдож аюулгүй талд).
        /// </summary>
        private string EnvironmentSignature(Document host)
        {
            try
            {
                var sb = new System.Text.StringBuilder();
                sb.Append("H:").Append(ClosedWorksetNames(host));
                for (int i = 0; i < _slots.Count; i++)
                {
                    // `StepLink` кэш БИШ — шинээр (Step хооронд линк өөрчлөгдсөнийг барих).
                    ClashLinks.Resolved r = ClashLinks.Resolve(host, _slots[i]);
                    sb.Append("|L").Append(_slots[i].InstanceId).Append(':');
                    if (r == null) { sb.Append("unloaded"); continue; }
                    sb.Append(RevitDocumentKeys.Of(r.Doc).Id).Append(':').Append(TransformSignature(r.Transform)).Append(':').Append(ClosedWorksetNames(r.Doc));
                }
                return sb.ToString();
            }
            catch (Exception) { return "?"; }
        }

        private static string ClosedWorksetNames(Document d)
        {
            try
            {
                if (!d.IsWorkshared) return "";
                var names = new List<string>();
                foreach (Workset w in new FilteredWorksetCollector(d).OfKind(WorksetKind.UserWorkset))
                    if (!w.IsOpen) names.Add(w.Id.IntegerValue + "=" + w.Name);
                names.Sort(StringComparer.Ordinal);
                return string.Join(",", names);
            }
            catch (Exception) { return "?"; }
        }

        private static string TransformSignature(Transform t)
        {
            if (t == null) return "null";
            Func<XYZ, string> p = v => v.X.ToString("0.######", System.Globalization.CultureInfo.InvariantCulture) + "," + v.Y.ToString("0.######", System.Globalization.CultureInfo.InvariantCulture)
                + "," + v.Z.ToString("0.######", System.Globalization.CultureInfo.InvariantCulture);
            return p(t.Origin) + "/" + p(t.BasisX) + "/" + p(t.BasisY) + "/" + p(t.BasisZ);
        }

        /// <summary>
        /// Орчин (линк / workset) шалгалтын явцад өөрчлөгдсөн эсэх — өөрчлөгдсөн бол нотолгоо (`_hidesCache`, «байхгүй») хуучирсан тул дүн «бүрэн БИШ».
        /// Нотолгоо цуглуулахын ӨМНӨ болон дуусгахын өмнө дуудна.
        /// </summary>
        private void CheckEnvironment(Document host)
        {
            if (_envSig == null) return;
            string now = EnvironmentSignature(host);
            if (string.Equals(now, _envSig, StringComparison.Ordinal)) return;
            _envSig = now;
            _modelChanged = true;
            _hidesCache.Clear();
            if (_verifier != null) _verifier.Invalidate();
            _notes.Add("⚠ Шалгалтын явцад линк (дахин ачаалсан/хөдөлсөн) эсвэл workset (нээсэн/хаасан) өөрчлөгдсөн — үр дүн бүрэн биш, юуг ч «шийдэгдсэн» болгоогүй.");
        }

        /// <summary>Баримтад хаалттай хэрэглэгчийн workset байна уу (тэгвэл тэнд элемент «байхгүй» гэж батлах боломжгүй).</summary>
        private bool HidesElements(Document d, int slot)
        {
            bool v;
            if (_hidesCache.TryGetValue(slot, out v)) return v;
            v = false;
            try
            {
                if (d.IsWorkshared)
                    foreach (Workset w in new FilteredWorksetCollector(d).OfKind(WorksetKind.UserWorkset))
                        if (!w.IsOpen) { v = true; break; }
            }
            catch (Exception) { v = true; }          // тодорхойгүй бол «байж болно» гэж үзнэ — худал «устсан» гаргахгүй
            _hidesCache[slot] = v;
            return v;
        }

        /* ---------------- зориудын давхцал: join / hosted / connected --------------- */

        private bool IgnoredByDesign(Document host, SideItem a, SideItem b)
        {
            if (a.Slot != b.Slot) return false;      // өөр баримтын (host ↔ линк) хос — зориудын давхцал гэж тооцохгүй
            if (!_rule.IgnoreJoined && !_rule.IgnoreHosted && !_rule.IgnoreConnected) return false;

            Document doc = host;
            if (a.Slot >= 0)
            {
                ClashLinks.Resolved link = StepLink(host, a.Slot);
                if (link == null) return false;
                doc = link.Doc;
            }

            Element ea, eb;
            try
            {
                ea = doc.GetElement(new ElementId(a.IdValue));
                eb = doc.GetElement(new ElementId(b.IdValue));
            }
            catch (Exception) { return false; }
            if (ea == null || eb == null) return false;

            try
            {
                if (_rule.IgnoreJoined && JoinGeometryUtils.AreElementsJoined(doc, ea, eb)) return true;
            }
            catch (Exception) { /* join мэдээлэл олдсонгүй — алгасахгүй */ }

            if (_rule.IgnoreHosted)
            {
                var fa = ea as FamilyInstance;
                var fb = eb as FamilyInstance;
                try
                {
                    if (fa != null && fa.Host != null && fa.Host.Id == eb.Id) return true;
                    if (fb != null && fb.Host != null && fb.Host.Id == ea.Id) return true;
                }
                catch (Exception) { }
            }

            if (_rule.IgnoreConnected)
            {
                HashSet<long> ca = ConnectedOwners(ea, a.Key.ToString());
                if (ca.Contains(eb.Id.Value)) return true;
                HashSet<long> cb = ConnectedOwners(eb, b.Key.ToString());
                if (cb.Contains(ea.Id.Value)) return true;
            }
            return false;
        }

        /// <summary>Элементийн MEP холбогч (connector)-оор шууд холбогдсон элементүүдийн id.  Кэштэй.</summary>
        private HashSet<long> ConnectedOwners(Element e, string cacheKey)
        {
            HashSet<long> set;
            if (_connectedCache.TryGetValue(cacheKey, out set)) return set;
            set = new HashSet<long>();
            try
            {
                ConnectorManager cm = null;
                var curve = e as MEPCurve;
                if (curve != null) cm = curve.ConnectorManager;
                else
                {
                    var fi = e as FamilyInstance;
                    if (fi != null && fi.MEPModel != null) cm = fi.MEPModel.ConnectorManager;
                }
                if (cm != null)
                    foreach (Connector c in cm.Connectors)
                        foreach (Connector other in c.AllRefs)
                            if (other.Owner != null && other.Owner.Id != e.Id) set.Add(other.Owner.Id.Value);
            }
            catch (Exception) { /* холболт уншигдсангүй — алгасахгүй */ }
            if (_connectedCache.Count > 50000) _connectedCache.Clear();    // санах ойн хязгаар (кэш нь зөвхөн хурдасгана)
            _connectedCache[cacheKey] = set;
            return set;
        }

        /* ============================== DETECTED INFO ====================== */

        private DetectedClash MakeDetected(Document host, SideItem a, SideItem b, PairResult pr, string fp)
        {
            ClashElementInfo ia = Info(host, a);
            ClashElementInfo ib = Info(host, b);
            return new DetectedClash
            {
                Fingerprint = fp,
                A = ia,
                B = ib,
                VolumeCm3 = pr.VolumeCm3,
                Point = pr.Point,
                Box = pr.Box,
                Level = !string.IsNullOrEmpty(ia.Level) ? ia.Level : ib.Level,
            };
        }

        private ClashElementInfo Info(Document host, SideItem item)
        {
            var info = new ClashElementInfo { Key = item.Key.ToString(), IdValue = item.IdValue };
            try
            {
                Document doc = host;
                if (item.Slot >= 0)
                {
                    info.LinkName = _slots[item.Slot].Name;
                    ClashLinks.Resolved link = StepLink(host, item.Slot);
                    if (link == null) return info;
                    doc = link.Doc;
                }
                Element e = doc.GetElement(new ElementId(item.IdValue));
                if (e == null) return info;

                info.Category = e.Category != null ? e.Category.Name : null;
                var t = doc.GetElement(e.GetTypeId()) as ElementType;
                if (t != null) { info.Family = t.FamilyName; info.Type = t.Name; }
                ElementId lid = e.LevelId;
                if (lid != null && lid != ElementId.InvalidElementId)
                {
                    Element lv = doc.GetElement(lid);
                    if (lv != null) info.Level = lv.Name;
                }
            }
            catch (Exception) { /* тайлбар дутуу ч clash хадгалагдана */ }
            return info;
        }

        /* ============================== FINISH ============================= */

        private void Finish(Document doc)
        {
            _timer.Begin("finish");
            CheckEnvironment(doc);            // нотолгоо цуглуулсны ДАРАА орчин өөрчлөгдсөн бол (урт гүйлт) ч «бүрэн» гэж зарлахгүй
            if (_confirmedCapped) _notes.Add("⚠ Clash " + MaxConfirmed + "-аас олон — зөвхөн эхнийг хадгаллаа. Дүрмийг нарийсгана уу. Өмнөх clash-уудыг «шийдэгдсэн» болгоогүй.");
            if (_modelChanged) _notes.Add("⚠ Шалгалтын явцад загвар өөрчлөгдсөн — үр дүн бүрэн биш, өмнөх clash-уудыг «шийдэгдсэн» болгоогүй. Дахин шалгана уу.");

            var stateInfo = new StateResolver(this, doc);
            // Бүрэн дүн: бүх нэр дэвшигч шалгагдсан, хязгаар хэтрээгүй, загвар шалгалтын явцад ӨӨРЧЛӨГДӨӨГҮЙ (өөрчлөгдсөн бол
            // цуглуулсан bbox/нотолгоо хуучирсан — «холдсон/устсан» гэж дүгнэх үндэсгүй).  Геометрийн алдаатай хос байвал
            // гүйлт «хэсэгчилсэн» (зарим хосыг баталгаажуулж чадаагүй) — гэхдээ лавлагааны нотолгоо нь хос бүрээр.
            bool complete = !_confirmedCapped && !_modelChanged;
            RunStatus status = !complete || _geoErrors > 0 ? RunStatus.Partial : RunStatus.Succeeded;
            FinalizeRun(status, complete, stateInfo);
            _phase = Phase.Done;
        }

        /// <summary>Өмнөх идэвхтэй issue бүрийн энэ удаагийн байдлыг (нотолгоотой) тодорхойлно.</summary>
        private sealed class StateResolver
        {
            private readonly ClashJob _j;
            private readonly Document _host;
            private Dictionary<string, SideItem> _items;

            public StateResolver(ClashJob j, Document host) { _j = j; _host = host; }

            public PairState Resolve(ClashIssue issue)
            {
                if (_j._ignoredFps.Contains(issue.Fingerprint)) return PairState.IgnoredByDesign;

                ClashVerdict v;
                if (_j._verdictByFp.TryGetValue(issue.Fingerprint, out v))
                {
                    if (v == ClashVerdict.NoClash) return PairState.NoClash;
                    if (v == ClashVerdict.Unsupported || v == ClashVerdict.GeometryError) return PairState.Unverified;
                }

                ElementKey ka = issue.A.ElementKey, kb = issue.B.ElementKey;
                if (!ka.IsValid || !kb.IsValid) return PairState.NotEvaluated;

                bool? ea = Exists(ka), eb = Exists(kb);
                if (ea == false || eb == false) return PairState.ElementMissing;
                if (ea != true || eb != true) return PairState.NotEvaluated;     // шалгах боломжгүй (линк unload г.м.)

                // Хоёулаа байгаа.  Одоогийн A/B жагсаалтад орсон бол bbox давхцалаар «холдсон» эсэхийг шийднэ.
                EnsureItems();
                SideItem ia, ib;
                if (_items.TryGetValue(ka.ToString(), out ia) && _items.TryGetValue(kb.ToString(), out ib))
                {
                    Aabb ba = ia.Box, bb = ib.Box;
                    if (!ba.Overlaps(ref bb, 0)) return PairState.NoLongerOverlapping;
                }
                return PairState.NotEvaluated;
            }

            private void EnsureItems()
            {
                if (_items != null) return;
                _items = new Dictionary<string, SideItem>(StringComparer.Ordinal);
                foreach (SideItem i in _j._a.Items) _items[i.Key.ToString()] = i;
                if (!_j._symmetric) foreach (SideItem i in _j._b.Items) _items[i.Key.ToString()] = i;
            }

            /// <summary>true = байна, false = БАЙХГҮЙ (устсан), null = мэдэгдэхгүй (линк unload / хаалттай workset).</summary>
            private bool? Exists(ElementKey k)
            {
                bool? known;
                if (_j._existence.TryGetValue(k.ToString(), out known)) return known;     // Evidence шатанд цуглуулсан
                return _j.ExistsLive(_host, k);                                            // шалгалтын явцад төлөв өөрчлөгдсөн (ховор)
            }
        }

        /// <summary>
        /// Дүнг (lifecycle-тэй нэгтгэж) хадгалж, гүйлтийн бүртгэлийг гаргана.  `resolver` null = нотолгоо
        /// цуглуулах боломжгүй (цуцлагдсан/алдаатай) — юуг ч «Resolved» болгохгүй.
        /// </summary>
        private void FinalizeRun(RunStatus status, bool runComplete, StateResolver resolver)
        {
            if (_finalized) return;
            _finalized = true;
            try
            {
                _timer.End();
                DateTime now = SmartClock.UtcNow;
                ReconcileResult rec = null;
                string err;

                // ⚠️ Хадгалсан төлөвийг НЭГ түгжээнд (шинээр уншиж → нэгтгэж → бичиж): хэрэглэгч шалгалтын үед
                // төлөв солисон байж болно — хуучирсан хуулбараар дарахгүй.
                bool saved = ClashStateStore.Update(_key, state =>
                {
                    var input = new ReconcileInput
                    {
                        RuleId = _rule.Id,
                        RuleName = _rule.Name,
                        RuleHash = _ruleHash,
                        Severity = _rule.Severity,
                        Detected = _detected,
                        RunComplete = runComplete && resolver != null,
                        StateOf = resolver != null ? (Func<ClashIssue, PairState>)resolver.Resolve : null,
                    };
                    rec = ClashReconciler.Reconcile(state.Issues, input, now);
                    state.Issues = rec.Issues;
                    FillRun(status, now, rec);
                    state.Runs.Insert(0, _run);
                }, out err);

                if (!saved)
                {
                    // Хадгалагдаагүй дүн дараагийн нээлтэд алга болно — «амжилттай» гэж ХАРУУЛАХГҮЙ (Failed + тэргүүн тэмдэглэл).
                    _run.Status = RunStatus.Failed;
                    _run.Notes.Insert(0, "⚠ Дүнг ХАДГАЛЖ ЧАДСАНГҮЙ — энэ дүн Revit-ийг хаавал/файлыг дахин нээвэл алга болно: " + SmartLog.Scrub(err));
                    SmartLog.Warn("clash", "state_save_failed", new { err = SmartLog.Scrub(err) });
                }

                Result = new ClashRunOutcome { Run = _run, New = rec.New, Resolved = rec.Resolved, Reappeared = rec.Reappeared, Unverified = rec.Unverified };
                SmartLog.Info("clash", "run_finished", new
                {
                    status = status.ToString(), a = _run.ACount, b = _run.BCount, cand = _run.Candidates, confirmed = _run.Confirmed,
                    unsupported = _unsupported, errors = _geoErrors, ms = _run.StageMs.Values.Sum(),
                });
            }
            catch (Exception ex)
            {
                // Нэгтгэх/хадгалахад алдаа — дүнг UI-д ИЛ гаргана (хадгалагдаагүй гэдгийг хэлнэ).
                SmartLog.Error("clash", "finalize_failed", ex);
                _run.Status = RunStatus.Failed;
                _run.EndedUtc = SmartClock.UtcNow;
                _run.Notes.Add("⚠ Дүнг нэгтгэж/хадгалж чадсангүй: " + SmartLog.Scrub(ex.Message));
                Result = new ClashRunOutcome { Run = _run };
            }
            finally
            {
                // Кэшлэсэн Solid/GeometryElement-ийн native санах ойг чөлөөлнө (гүйлт дууссан/цуцлагдсан/унасан бүрд).
                if (_verifier != null)
                {
                    try { _verifier.Dispose(); } catch (Exception) { }
                    _verifier = null;
                }
            }
        }

        private void FillRun(RunStatus status, DateTime now, ReconcileResult rec)
        {
            _run.Status = status;
            _run.EndedUtc = now;
            _run.Confirmed = _detected.Count;
            _run.NoClash = _noClash;
            _run.Unsupported = _unsupported;
            _run.GeometryErrors = _geoErrors;
            _run.SkippedByDesign = _skippedByDesign;
            _run.New = rec.New;
            _run.Resolved = rec.Resolved;
            _run.Reappeared = rec.Reappeared;
            _run.LinksUnloaded = _linksUnloaded;
            _run.StageMs = _timer.Snapshot();
            _run.Notes.AddRange(_notes);
            if (_unsupported > 0) _run.Notes.Add("⚠ " + _unsupported + " хосыг шалгах боломжгүй (бодисгүй геометр) — «clash биш» гэж ТООЦООГҮЙ.");
            if (_geoErrors > 0) _run.Notes.Add("⚠ " + _geoErrors + " хосын геометр/boolean үйлдэл алдаатай — «clash биш» гэж ТООЦООГҮЙ.");
            if (rec.Unverified > 0) _run.Notes.Add("⚠ " + rec.Unverified + " өмнөх clash баталгаажаагүй (шалгагдсангүй) — «шийдэгдсэн» гэж ТЭМДЭГЛЭЭГҮЙ.");
            if (_verifier != null)
                _run.Notes.Add("Boolean үйлдэл " + _verifier.BooleanOps + " (алдаа " + _verifier.BooleanFailures + ").");
            _run.ModelStamp = _stamp;
        }

        private void RecordFailure(Exception ex)
        {
            if (_finalized) return;
            _notes.Add("Алдаа: " + SmartLog.Scrub(ex.Message));
            FinalizeRun(RunStatus.Failed, false, null);
        }

        private void Report(string message, int done, int total)
        {
            if (_progress != null) _progress.Report(JobProgress.Of(_phase.ToString().ToLowerInvariant(), done, total, message));
        }
    }
}
