using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using Autodesk.Revit.ApplicationServices;
using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Events;
using Autodesk.Revit.UI;
using RevitMcpAddin.ChangeImpact.Core;
using RevitMcpAddin.Smart;
using RevitMcpAddin.Smart.Core;

namespace RevitMcpAddin.ChangeImpact
{
    /// <summary>Sandbox-ийн дамжлага: `Quick` = Core (өрөө, хэмжээс, хаалга/цонх, хөрш хана) → түр дүн; `Deep` = хүснэгт, MEP, гарц, орчны зай, шинээр харагдах харагдац.</summary>
    internal enum SandboxPass
    {
        Quick = 0,
        Deep,
    }

    internal sealed class SandboxResult
    {
        public SandboxOutcome Outcome;
        public List<string> BlockReasons = new List<string>();
        public List<FailureNote> Failures = new List<FailureNote>();
        /// <summary>Хөдөлгөөн commit хийгдсэний ДАРАА (settled) уншсан төлөв — группийг буцаахаас ӨМНӨ.  Quick = Core, Deep = Deep хэсгүүд.</summary>
        public StateSnapshot After;
        /// <summary>commit-ийн дараах байрлалын хурууны хээ — хоёр дамжлагын тогтвортой байдлыг тулгахад.</summary>
        public RestoreProbe Settled;
        /// <summary>Хөдөлсний ДАРАА шинээр харагдах харагдацууд (өмнө нь харагдаагүй).</summary>
        public List<long> NewVisibleViews = new List<long>();
        public bool AfterVisibilityChecked;
        public List<string> Notes = new List<string>();
        public List<string> IncompleteReasons = new List<string>();
        public List<string> AdvisoryReasons = new List<string>();
    }

    /// <summary>
    /// «TRANSACTION SANDBOX» — preview-ийн зүрх.
    ///
    ///   [ГАДНА]  ӨМНӨХ төлөв (job шатаар уншсан, кэштэй)  →  restore probe (байрлалын хурууны хээ)
    ///   TransactionGroup (түр) {
    ///       Transaction { MoveElement → Regenerate → Commit }              ← failure processing ЭНД
    ///       ДАРАА (SETTLED) snapshot — commit-ийн ДАРАА, группийг ДАХИН нээлттэй барьж байхад
    ///   }
    ///   TransactionGroup.RollBack() — ҮРГЭЛЖ (`finally`).  Assimilate ХЭЗЭЭ Ч үгүй (Undo-д орохгүй).
    ///   → ЗОРИУЛАЛТТАЙ restore fingerprint-ээр загвар анхныхаараа буцсаныг БАТЛАНА (бүх элементийн тоо БИШ).
    ///
    /// ЯАГААД КОММИТ ХИЙГЭЭД ДАРАА УНШИХ: Revit locked dimension, pin, join, align-ийн алдааг ЗӨВХӨН коммитын failure processing-д мэдэгддэг, мөн хязгаарлалт/join/хост
    /// элементүүд commit-ийн дараа л эцсийн (settled) төлөвт хүрдэг.  Коммитын ӨМНӨ уншвал Apply-ийн бодит үр дүнгээс зөрнө.  Preview ба Apply ЯГ ИЖИЛ цэг (commit-ийн дараа,
    /// бүлэг нээлттэй) дээр уншдаг.
    ///
    /// ГЭРЭЭ:
    ///   • `ImpactSimulationScope` — MGL-ийн ажиглагчдыг хаана (SimulationScope.cs).  Гуравдагч талын add-in `DocumentChanged` харна.
    ///   • ХАМГИЙН ДОРДЫГ ХҮЛЭЭНЭ: Revit татгалзвал `Blocked`; хэрэгслийн алдаа `Faulted` (загвар буцаагдсан); буцаалтыг батлаж чадаагүй бол `NotRestored`
    ///     (ХЭЗЭЭ Ч «өөрчлөгдөөгүй» гэж хэлэхгүй).
    ///   • Ганц `Step` дотор, БҮТЭН: транзакц Step-ийн гадуур хэзээ ч нээлттэй үлдэхгүй (`SmartExecutor`-ийн гэрээ).
    ///   • Нээлттэй группийн хугацааг МИНИМУМ болгох: ӨМНӨХ уншилт, нэр дэвшигч бэлтгэл, индекс ГАДНА; group дотор зөвхөн хөдөлгөөн + ДАРАА уншилт.
    /// </summary>
    internal static class PreChangeSandbox
    {
        internal const int ClashBudgetMs = 3000;
        /// <summary>Шинээр харагдах харагдацын шалгалтад зарцуулах хугацаа (мс).</summary>
        internal const int AfterVisibilityBudgetMs = 1500;
        private const string GroupName = "MGL — Өөрчлөхөөс өмнө шалгах (түр)";
        private const string TxName = "MGL — түр хөдөлгөөн";

        /// <summary>STRICT горим: `MGL_PRECHANGE_STRICT_RESTORE=1` үед буцаалтыг бүх элементийн тоогоор ЦААШ шалгана (хэмжилт, оношилгоо; өгөгдмөл ХААЛТТАЙ).</summary>
        internal static bool StrictRestore
        {
            get { return Environment.GetEnvironmentVariable("MGL_PRECHANGE_STRICT_RESTORE") == "1"; }
        }

        internal static SandboxResult Run(UIApplication uiapp, Document doc, CaptureSpec spec, XYZ moveFt, SandboxPass pass, StageClock clock)
        {
            string tag = pass == SandboxPass.Quick ? "quick" : "deep";
            var res = new SandboxResult { Outcome = SandboxOutcome.Unknown };
            Element source = doc.GetElement(new ElementId(spec.SourceId));
            if (source == null || !source.IsValidObject)
            {
                res.Outcome = SandboxOutcome.Rejected;
                res.BlockReasons.Add(PreChangeOperations.NounCap(spec.Operation) + " загварт олдсонгүй (устсан байж болзошгүй).");
                return res;
            }

            bool strict = StrictRestore;
            RestoreProbe probeBefore = Probe(doc, spec, strict, null, null);
            string stampBefore = ModelChangeCounter.Stamp(doc);

            var handler = new PreChangeFailureHandler(true);
            var deleted = new List<long>();
            var added = new List<long>();
            int modified = 0;
            EventHandler<DocumentChangedEventArgs> onChanged = (s, e) =>
            {
                try
                {
                    Document d = e.GetDocument();
                    if (d == null || !SmartDocs.Same(d, doc)) return;
                    // ЗӨВХӨН commit-ийн үйл явдал: буцаалтын (`TransactionGroupRolledBack`) үйл явдал урвуу мэдээлэл тээх тул тоолохгүй.
                    if (e.Operation != UndoOperation.TransactionCommitted) return;
                    foreach (ElementId id in e.GetDeletedElementIds()) deleted.Add(id.Value);
                    foreach (ElementId id in e.GetAddedElementIds()) added.Add(id.Value);
                    modified += e.GetModifiedElementIds().Count;
                }
                catch (Exception) { /* зөвхөн нэмэлт нотолгоо — алдвал «устах элемент» мэдээлэл дутна, гол шалгалт хэвээр */ }
            };

            bool committed = false;
            TransactionGroup tg = null;
            bool groupStarted = false;
            bool rolledBackOk = false;
            var swRollback = new Stopwatch();

            using (ImpactSimulationScope.Begin())
            {
                try
                {
                    uiapp.Application.DocumentChanged += onChanged;
                    tg = new TransactionGroup(doc, GroupName);
                    TransactionStatus gs = tg.Start();
                    if (gs != TransactionStatus.Started)
                    {
                        res.Outcome = SandboxOutcome.Rejected;
                        res.BlockReasons.Add("Revit түр транзакц нээхийг зөвшөөрсөнгүй (баримт засварлах горимд байж магадгүй).");
                    }
                    else
                    {
                        groupStarted = true;
                        committed = SimulateMove(doc, spec, moveFt, handler, res, clock, tag);
                        if (committed)
                        {
                            // ⚠️ SETTLED: commit АМЖИЛТТАЙ болсны ДАРАА, группийг нээлттэй барьж байхад.
                            CaptureStages stages = pass == SandboxPass.Quick ? CaptureStages.Core : CaptureStages.Deep;
                            Stopwatch swAfter = Stopwatch.StartNew();
                            res.After = PreChangeCapture.Read(doc, spec, stages, ClashBudgetMs, clock, "after.", null);
                            Rec(clock, "after_capture_ms", tag, swAfter.ElapsedMilliseconds);
                            res.Settled = Probe(doc, spec, false, null, null);
                            if (pass == SandboxPass.Deep)
                            {
                                Stopwatch swVis = Stopwatch.StartNew();
                                CheckAfterVisibility(doc, spec, res);
                                Rec(clock, "visibility_ms", tag, swVis.ElapsedMilliseconds);
                            }
                        }
                    }
                }
                catch (Exception ex)
                {
                    committed = false;
                    if (!groupStarted)
                    {
                        // Бүлэг НЭЭГДЭЭГҮЙ (Revit түр транзакц нээхийг хаасан) — хөдөлгөөнийг оролдоогүй тул «Revit зөвшөөрөөгүй» (🔴) гэж ХЭЛЭХГҮЙ: дүгнэх боломжгүй (⚪).
                        res.Outcome = SandboxOutcome.Rejected;
                        res.BlockReasons.Add("Revit түр транзакц нээхийг зөвшөөрсөнгүй (" + ex.GetType().Name + "): " + SmartLog.Scrub(ex.Message) + " Баримт засварлах горимд байж магадгүй.");
                    }
                    else
                    {
                        res.Outcome = IsRevitException(ex) ? SandboxOutcome.Blocked : SandboxOutcome.Faulted;
                        res.BlockReasons.Add(res.Outcome == SandboxOutcome.Blocked
                            ? "Revit энэ хөдөлгөөнийг зөвшөөрөөгүй (" + ex.GetType().Name + "): " + SmartLog.Scrub(ex.Message)
                            : "Шалгалт дуусаагүй — хэрэгслийн алдаа (" + ex.GetType().Name + "): " + SmartLog.Scrub(ex.Message) + " Загвар өөрчлөгдөөгүй.");
                    }
                    SmartLog.Error("prechange", "sandbox_failed", ex);
                }
                finally
                {
                    try { uiapp.Application.DocumentChanged -= onChanged; } catch (Exception) { }
                    // ⚠️ ҮРГЭЛЖ буцаана.  Нээлттэй транзакц үлдсэн бол (exception) бүлгийн RollBack түүнийг ч буцаана.
                    if (tg != null && groupStarted)
                    {
                        swRollback.Start();
                        try { rolledBackOk = tg.RollBack() == TransactionStatus.RolledBack; }
                        catch (Exception ex)
                        {
                            rolledBackOk = false;
                            SmartLog.Error("prechange", "group_rollback_failed", ex);
                        }
                        swRollback.Stop();
                    }
                    else rolledBackOk = true;          // группийг эхлүүлээгүй — буцаах юм алга
                }
            }
            Rec(clock, "rollback_ms", tag, swRollback.ElapsedMilliseconds);

            // ---------- БУЦААЛТЫГ БАТЛАХ (зориулалттай хурууны хээ — fail-closed) ----------
            Stopwatch swRestore = Stopwatch.StartNew();
            string restoreProblem = null;
            if (!rolledBackOk) restoreProblem = "Түр транзакцийг буцаах нь амжилтгүй.";
            else if (groupStarted)
            {
                try
                {
                    RestoreProbe probeAfter = Probe(doc, spec, strict, added, deleted);
                    RestoreResult rr = PreChangeRestoreCheck.Compare(probeBefore, probeAfter);
                    if (!rr.Restored) restoreProblem = string.Join(" ", rr.Problems);
                    res.Notes.AddRange(rr.Notes);
                }
                catch (Exception ex) { restoreProblem = "Буцаалтыг шалгаж чадсангүй (" + ex.GetType().Name + ")."; }
            }
            Rec(clock, "restore_check_ms", tag, swRestore.ElapsedMilliseconds);

            if (restoreProblem != null)
            {
                res.Outcome = SandboxOutcome.NotRestored;
                res.BlockReasons.Add(restoreProblem + " Ctrl+Z-ээр шалгаж, загварыг гараар хянана уу.");
                SmartLog.Error("prechange", "not_restored", null, new { problem = restoreProblem, pass = tag });
                return res;
            }

            if (!committed)
            {
                if (res.Outcome == SandboxOutcome.Unknown) res.Outcome = SandboxOutcome.Blocked;
                if (res.BlockReasons.Count == 0) res.BlockReasons.Add("Энэ хөдөлгөөнийг хийх боломжгүй.");
                res.Failures.AddRange(handler.Notes);
                return res;
            }

            res.Outcome = SandboxOutcome.Simulated;
            res.Failures.AddRange(handler.Notes.Where(n => !n.IsError));
            if (res.After != null)
            {
                res.After.DeletedIds = deleted.Distinct().ToList();
                res.After.ModifiedCount = modified;
            }
            return res;
        }

        private static void Rec(StageClock clock, string name, string tag, long ms)
        {
            if (clock == null) return;
            clock.Add(name, ms);
            clock.Add(tag + "." + name, ms);
        }

        private static bool IsRevitException(Exception ex)
        {
            return ex != null && string.Equals(ex.GetType().Namespace, "Autodesk.Revit.Exceptions", StringComparison.Ordinal);
        }

        /// <summary>Хөдөлгөөн + Regenerate + COMMIT (failure цуглуулах).  true = Revit хүлээн зөвшөөрсөн, commit хийгдсэн.  ДАРАА төлвийг ЭНД уншихгүй.</summary>
        private static bool SimulateMove(Document doc, CaptureSpec spec, XYZ moveFt, PreChangeFailureHandler handler, SandboxResult res, StageClock clock, string tag)
        {
            using (var t = new Transaction(doc, TxName))
            {
                PreChangeFailureHandler.Attach(t, handler);
                if (t.Start() != TransactionStatus.Started)
                {
                    res.Outcome = SandboxOutcome.Rejected;
                    res.BlockReasons.Add("Revit түр транзакц нээхийг зөвшөөрсөнгүй.");
                    return false;
                }

                var sw = Stopwatch.StartNew();
                try
                {
                    ElementTransformUtils.MoveElement(doc, new ElementId(spec.SourceId), moveFt);
                    doc.Regenerate();
                }
                catch (Exception ex)
                {
                    t.RollBack();
                    Rec(clock, "move_regenerate_ms", tag, sw.ElapsedMilliseconds);
                    res.Outcome = IsRevitException(ex) ? SandboxOutcome.Blocked : SandboxOutcome.Faulted;
                    res.BlockReasons.Add(res.Outcome == SandboxOutcome.Blocked ? ExplainMoveFailure(ex, spec.Operation)
                        : "Шалгалт дуусаагүй — хэрэгслийн алдаа (" + ex.GetType().Name + "): " + SmartLog.Scrub(ex.Message) + " Загвар өөрчлөгдөөгүй.");
                    return false;
                }
                Rec(clock, "move_regenerate_ms", tag, sw.ElapsedMilliseconds);

                sw.Restart();
                TransactionStatus cs;
                try { cs = t.Commit(); }
                catch (Exception ex)
                {
                    if (t.GetStatus() == TransactionStatus.Started) t.RollBack();
                    Rec(clock, "commit_ms", tag, sw.ElapsedMilliseconds);
                    res.Outcome = IsRevitException(ex) ? SandboxOutcome.Blocked : SandboxOutcome.Faulted;
                    res.BlockReasons.Add(res.Outcome == SandboxOutcome.Blocked ? ExplainMoveFailure(ex, spec.Operation)
                        : "Шалгалт дуусаагүй — хэрэгслийн алдаа (" + ex.GetType().Name + "): " + SmartLog.Scrub(ex.Message) + " Загвар өөрчлөгдөөгүй.");
                    return false;
                }
                Rec(clock, "commit_ms", tag, sw.ElapsedMilliseconds);

                if (cs != TransactionStatus.Committed)
                {
                    res.Outcome = SandboxOutcome.Blocked;
                    var errors = handler.Notes.Where(n => n.IsError).Select(n => n.Text).Distinct().ToList();
                    res.BlockReasons.Add(errors.Count > 0
                        ? "Revit энэ хөдөлгөөнийг зөвшөөрөөгүй: " + string.Join("; ", errors)
                        : "Revit энэ хөдөлгөөнийг зөвшөөрөөгүй (түгжигдсэн хэмжээс/холбоос байж болно).");
                    return false;
                }
                return true;
            }
        }

        /// <summary>
        /// Хөдөлсний ДАРАА хана (болон хаалга, цонх) өмнө нь харагдаагүй харагдацад шинээр харагдах эсэх.  Нэр дэвшигчийг job-ийн «crop-ийн хүрээгээс гадуурхыг
        /// ХАСАХ» (батлагдсан-аюулгүй) шүүлт аль хэдийн багасгасан.  Хугацааны хязгаартай — дутуу бол `AfterVisibilityChecked=false` (тайлан «бүрэн биш» гэж ИЛ хэлнэ).
        /// </summary>
        private static void CheckAfterVisibility(Document doc, CaptureSpec spec, SandboxResult res)
        {
            if (spec.AfterVisibilityViews.Count == 0) { res.AfterVisibilityChecked = true; return; }
            var sw = Stopwatch.StartNew();
            try
            {
                var ids = new List<ElementId> { new ElementId(spec.SourceId) };
                foreach (long h in spec.HostedIds) ids.Add(new ElementId(h));
                var filter = new ElementIdSetFilter(ids);
                int done = 0;
                foreach (long vid in spec.AfterVisibilityViews)
                {
                    if (sw.ElapsedMilliseconds > AfterVisibilityBudgetMs) break;
                    done++;
                    try
                    {
                        bool any = new FilteredElementCollector(doc, new ElementId(vid)).WherePasses(filter).ToElementIds().Count > 0;
                        if (any) res.NewVisibleViews.Add(vid);
                    }
                    catch (Exception) { done--; res.AdvisoryReasons.Add("Зарим харагдацын харагдалтыг (хөдөлсний дараа) шалгаж чадсангүй."); }
                }
                res.AfterVisibilityChecked = done >= spec.AfterVisibilityViews.Count;
            }
            catch (Exception ex)
            {
                res.AfterVisibilityChecked = false;
                res.AdvisoryReasons.Add("Хөдөлсний дараах харагдалтыг шалгаж чадсангүй (" + ex.GetType().Name + ").");
            }
        }

        private static string ExplainMoveFailure(Exception ex, PreChangeOperationKind op)
        {
            string msg = SmartLog.Scrub(ex.Message ?? "");
            if (ex is Autodesk.Revit.Exceptions.InvalidOperationException || ex is Autodesk.Revit.Exceptions.ArgumentException)
                return "Revit " + PreChangeOperations.Accusative(op) + " зөөхийг зөвшөөрсөнгүй (" + ex.GetType().Name + "): " + msg;
            return "Хөдөлгөөнийг хийж чадсангүй (" + ex.GetType().Name + "): " + msg;
        }

        /* ============================== RESTORE PROBE ======================== */

        /// <summary>
        /// Байрлалын хурууны хээ (ЗОРИУЛАЛТТАЙ): эх хана, хост, холбогдсон хөрш хана.  `added`/`deleted` өгвөл (ДАРАА probe) симуляцийн үеэр нэмэгдсэн/устсан id-ууд
        /// буцаалтын дараа зөв эсэхийг ч тоолно.  `strict` = бүх элементийн тоо (оношилгоо).
        /// </summary>
        internal static RestoreProbe Probe(Document doc, CaptureSpec spec, bool strict, List<long> added, List<long> deleted)
        {
            var p = new RestoreProbe { Readable = true };
            try
            {
                Element wall = doc.GetElement(new ElementId(spec.SourceId));
                p.WallExists = wall != null && wall.IsValidObject;
                if (p.WallExists)
                {
                    p.WallLocation = PreChangeCapture.ReadLocation(wall);
                    try { p.WallTypeId = wall.GetTypeId().Value; } catch (Exception) { }
                }
                foreach (long id in spec.HostedIds.Concat(spec.JoinedIds).Distinct())
                {
                    Element e = null;
                    try { e = doc.GetElement(new ElementId(id)); } catch (Exception) { }
                    if (e == null || !e.IsValidObject) continue;
                    p.OthersPresent.Add(id);
                    p.Others[id] = PreChangeCapture.ReadLocation(e);
                }
                p.Stamp = ModelChangeCounter.Stamp(doc);
                p.DocumentModifiable = doc.IsModifiable;
                if (added != null)
                    foreach (long id in added.Distinct().Take(5000))
                    {
                        Element e = null;
                        try { e = doc.GetElement(new ElementId(id)); } catch (Exception) { }
                        if (e != null && e.IsValidObject) p.AddedStillPresent++;
                    }
                if (deleted != null)
                    foreach (long id in deleted.Distinct().Take(5000))
                    {
                        Element e = null;
                        try { e = doc.GetElement(new ElementId(id)); } catch (Exception) { }
                        if (e == null || !e.IsValidObject) p.DeletedStillMissing++;
                    }
                if (strict) p.ElementCount = new FilteredElementCollector(doc).WhereElementIsNotElementType().GetElementCount();
            }
            catch (Exception) { p.Readable = false; }
            return p;
        }
    }
}
