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
    /// «Хэрэгжүүлэх» — preview-ийг ДАХИН ТОГЛУУЛАХГҮЙ, ХУУЧИРСАН ЭСЭХИЙГ ЭХЛЭЭД ШАЛГААД ЯГ ИЖИЛ хөдөлгөөнийг хийж, commit-ийн ДАРАА (settled) төлвийг preview-ийн
    /// settled төлөвтэй тулгана.
    ///
    ///   1. Идэвхтэй файл, хана, дэмжлэг (`PreChangeWallRules`), preview-ийн шийдвэр (🟢/🟠 ЗӨВХӨН) шалгана.
    ///   2. Хурууны хээ — хуучирсан ЭСВЭЛ шалгаж чадаагүй бол ХЭРЭГЖҮҮЛЭХГҮЙ (fail-closed).
    ///   3. TransactionGroup «MGL — Нөлөө шалгаж зөөх» {
    ///          Transaction { MoveElement → Regenerate → Commit }                  ← failure processing ЭНД
    ///          SETTLED snapshot (commit-ийн ДАРАА, бүлэг нээлттэй)
    ///          `PreChangePostCommitGate` — preview.After ↔ бодит settled:  таарвал `Assimilate()` (НЭГ Undo), үгүй бол `RollBack()` (БҮГДИЙГ буцаана)
    ///      }
    ///   4. MGL-ийн ажиглагчид (ChangeTracker, ImpactCapture, ModelChangeCounter, …) дотоод commit-ийг ХОЙШЛУУЛНА (`ObservationDeferral`): Assimilate АМЖИЛТТАЙ
    ///      болсны ДАРАА НЭГ УДАА дахин тоглуулна; буцвал хаяна — «хэзээ ч болоогүй өөрчлөлт» түүхэнд үлдэхгүй, бодит өөрчлөлт алдагдахгүй.
    ///
    /// ⚠️ «Preview ба бодит таарсан» гэж ЗӨВХӨН commit-ийн дараа уншсан төлөвтэй тулгасан үед хэлнэ.  Тулгаж чадахгүй бол буцаана.
    /// ⚠️ Гуравдагч талын add-in дотоод commit/rollback-ийн `DocumentChanged`-ийг харна (Revit-ийн хязгаар — баримтжуулсан).
    /// </summary>
    internal static class PreChangeApply
    {
        // Revit-ийн Undo жагсаалтад харагдах нэр — үйлдэл тус бүрээр (`PreChangeOperations.UndoName`).

        internal static ApplyOutcome Run(UIApplication app, DocumentKey key, PreChangeReport preview, CaptureSpec spec, PreChangeRequest current)
        {
            var outcome = new ApplyOutcome();
            var total = Stopwatch.StartNew();
            try
            {
                UIDocument ui = app.ActiveUIDocument;
                Document doc = ui != null ? ui.Document : null;
                if (doc == null) return Fail(outcome, "Идэвхтэй баримт алга.");
                if (!key.Equals(RevitDocumentKeys.Of(doc)))
                    return Fail(outcome, "Идэвхтэй файл солигдсон — preview хийсэн файл руугаа буцна уу.");
                if (preview == null) return Fail(outcome, "Preview алга.");

                // Хамгаалалтын давхар шалгалт: UI-ийн товчоос ГАДНА ч «зөөхгүй/дүгнэх боломжгүй/түр дүн»-г хэрэгжүүлэхгүй.
                MoveDecision decision = PreChangeDecisionEngine.Decide(preview);
                if (!decision.CanBeApplied)
                    return Fail(outcome, "Энэ preview-ийн дүгнэлт «" + decision.Title + "» — хэрэгжүүлэх боломжгүй.");
                if (spec == null || !string.Equals(spec.SourceUid, preview.Fingerprint != null ? preview.Fingerprint.SourceUid : null, StringComparison.Ordinal))
                    return Stale(outcome, "Preview-ийн хамаарлын өгөгдөл олдсонгүй");

                IPreChangeOperation op = PreChangeOperationRegistry.For(preview.Request);
                PreChangeOperationKind kind = preview.Request != null ? preview.Request.Operation : PreChangeOperationKind.WallMove;
                string txName = PreChangeOperations.UndoName(kind);
                OpCheck oc = op.Check(doc, spec.SourceId);
                if (!oc.Ok) return Fail(outcome, oc.Problem);

                // ХУУЧИРСАН ЭСЭХИЙГ ШАЛГАХ — fail-closed: хурууны хээг уншиж чадаагүй (exception) = «хуучраагүй» БИШ.
                PreChangeRequest req = current ?? preview.Request;
                StaleVerdict sv;
                try
                {
                    PreChangeFingerprint now = op.FingerprintNow(doc, key, req);
                    sv = PreChangeStale.Evaluate(preview.Fingerprint, now, req);
                }
                catch (Exception ex)
                {
                    SmartLog.Error("prechange", "stale_check_failed", ex);
                    outcome.Status = ApplyStatus.Stale;
                    outcome.Message = PreChangeFreshness.UnknownNotice;
                    return outcome;
                }
                if (sv.IsStale)
                {
                    outcome.Status = ApplyStatus.Stale;
                    outcome.Message = sv.Message;
                    return outcome;
                }

                XYZ move = PcUnits.VectorFromMm(preview.Request.VectorMm);
                var handler = new PreChangeFailureHandler(false);
                PostCommitVerdict verdict;
                string stampBefore = ModelChangeCounter.Stamp(doc);
                ObservationDeferral deferral = ObservationDeferral.Begin(app, doc);
                TransactionGroup tg = null;
                bool groupOpen = false;
                try
                {
                    tg = new TransactionGroup(doc, txName);
                    if (tg.Start() != TransactionStatus.Started)
                    {
                        deferral.Discard();
                        return Fail(outcome, "Revit транзакц нээхийг зөвшөөрсөнгүй.");
                    }
                    groupOpen = true;

                    // ---- 1. дотоод транзакц: зөөх + Regenerate + COMMIT
                    bool committed;
                    string txError = null;
                    using (var t = new Transaction(doc, txName))
                    {
                        PreChangeFailureHandler.Attach(t, handler);
                        if (t.Start() != TransactionStatus.Started)
                        {
                            groupOpen = false;
                            RollBackGroup(tg, deferral, doc, outcome);
                            return Fail(outcome, "Revit транзакц нээхийг зөвшөөрсөнгүй.");
                        }
                        try
                        {
                            ElementTransformUtils.MoveElement(doc, new ElementId(spec.SourceId), move);
                            doc.Regenerate();
                            committed = t.Commit() == TransactionStatus.Committed;
                            if (!committed)
                            {
                                string errs = string.Join("; ", handler.Notes.Where(n => n.IsError).Select(n => n.Text).Distinct());
                                txError = "Revit хөдөлгөөнийг зөвшөөрөөгүй" + (errs.Length > 0 ? ": " + errs : "") + ".";
                            }
                        }
                        catch (Exception ex)
                        {
                            committed = false;
                            txError = "Revit " + PreChangeOperations.Accusative(kind) + " зөөхийг зөвшөөрсөнгүй (" + ex.GetType().Name + "): " + SmartLog.Scrub(ex.Message) + ".";
                            if (t.GetStatus() == TransactionStatus.Started) { try { t.RollBack(); } catch (Exception) { } }
                        }
                    }
                    if (!committed)
                    {
                        groupOpen = false;
                        RollBackGroup(tg, deferral, doc, outcome);
                        return Fail(outcome, txError ?? "Revit хөдөлгөөнийг зөвшөөрөөгүй.");
                    }

                    // ---- 2. SETTLED: commit-ийн ДАРАА бүлэг нээлттэй байхад бодит төлвийг уншина
                    StateSnapshot actual = PreChangeCapture.Read(doc, spec, CaptureStages.All, PreChangeSandbox.ClashBudgetMs, null, "apply.", null);

                    // ---- 3. preview.After (settled) ↔ бодит settled
                    verdict = PreChangePostCommitGate.Decide(preview.Request, preview.After, actual, true);
                    outcome.Compared.AddRange(verdict.Compared);
                    outcome.NotCompared.AddRange(verdict.NotCompared);
                    outcome.Details.AddRange(verdict.Details);

                    if (verdict.Action == PostCommitAction.RollBack)
                    {
                        groupOpen = false;
                        RestoreProbe baseline = RestoreBaseline(preview);
                        bool restored = RollBackGroup(tg, deferral, doc, outcome);
                        outcome.Status = verdict.Status;
                        outcome.Message = verdict.Message;
                        if (!restored || !LooksRestored(doc, spec, baseline))
                        {
                            outcome.Message += " ⚠ Загвар анхны төлөвт буцсаныг баталгаажуулж чадсангүй — Revit-д Ctrl+Z-ээр шалгана уу.";
                            outcome.ModelMayBeModified = true;
                            ModelChangeCounter.ForceBump(doc);   // загвар өөрчлөгдсөн байж магадгүй — өмнөх preview/кэш хуучирсан
                        }
                        return outcome;
                    }

                    // ---- 4. баталгаажсан: НЭГ Undo болгон нэгтгэнэ.  `Assimilate` шидэж/`Committed` биш буцааж болно — БҮЛГИЙН ҮНЭН төлвөөр шийднэ.
                    TransactionStatus ast = TransactionStatus.Uninitialized;
                    try { ast = tg.Assimilate(); }
                    catch (Exception aex) { SmartLog.Error("prechange", "assimilate_failed", aex); }
                    groupOpen = false;
                    TransactionStatus gst = SafeStatus(tg);
                    if (ast == TransactionStatus.Committed || gst == TransactionStatus.Committed)
                    {
                        int replayed = deferral.Publish();
                        ModelChangeCounter.EnsureAdvanced(doc, stampBefore);   // ажиглагч тоглуулалт дутсан ч тэмдэг заавал урагшилна
                        outcome.Status = ApplyStatus.AppliedVerified;
                        outcome.Message = PreChangeText.AppliedVerified(preview.Request, PreChangeSummary.CountsLine(preview));
                        SmartLog.Info("prechange", "applied", new { status = outcome.Status.ToString(), compared = verdict.Compared.Count, replayed, lost = deferral.Lost, ms = total.ElapsedMilliseconds });
                        return outcome;
                    }

                    // Revit өөрөө бүлгийг буцаасан (failure processing) — загвар ӨӨРЧЛӨГДӨӨГҮЙ: хойшлуулсныг хаяна.
                    if (ast == TransactionStatus.RolledBack || gst == TransactionStatus.RolledBack)
                    {
                        deferral.Discard();
                        return Fail(outcome, "Хөдөлгөөнийг нэг Undo болгон хадгалж чадсангүй — Revit буцаалаа.");
                    }

                    // Төлөв тодорхойгүй — бүлгийг буцааж үзнэ; буцахгүй бол өөрчлөлт БОДИТ байгаа тул ажиглагчдад ҮНЭН өөрчлөлтийг хэлнэ.
                    if (RollBackGroup(tg, deferral, doc, outcome))
                        return Fail(outcome, "Хөдөлгөөнийг нэг Undo болгон хадгалж чадсангүй — буцаалаа.");
                    outcome.Status = ApplyStatus.AppliedUnverified;
                    outcome.ModelMayBeModified = true;
                    ModelChangeCounter.ForceBump(doc);
                    outcome.Message = PreChangeOperations.NounCap(kind) + " " + Math.Round(preview.Request.DistanceMm).ToString("0") + " мм зөөгдсөн байж магадгүй боловч нэг Undo болгож чадсангүй — Revit-ийн Undo жагсаалтыг шалгана уу. Preview-тэй тулгасан.";
                    return outcome;
                }
                catch (Exception ex)
                {
                    SmartLog.Error("prechange", "apply_failed", ex);
                    if (groupOpen && tg != null) RollBackGroup(tg, deferral, doc, outcome);
                    return Fail(outcome, "Хэрэгжүүлэх үед алдаа гарлаа (" + ex.GetType().Name + "): " + SmartLog.Scrub(ex.Message));
                }
                finally
                {
                    deferral.Dispose();       // Publish/Discard дуудагдаагүй бол ХАЯНА
                }
            }
            catch (Exception ex)
            {
                SmartLog.Error("prechange", "apply_failed", ex);
                return Fail(outcome, "Хэрэгжүүлэх үед алдаа гарлаа (" + ex.GetType().Name + "): " + SmartLog.Scrub(ex.Message));
            }
        }

        /// <summary>
        /// Бүлгийг буцаана (БҮГД, committed транзакцтай нь) + хойшлуулсныг ХАЯНА.  true = Revit бүлэг `RolledBack` болсныг БАТАЛСАН.
        /// Баталгаагүй бол загвар өөрчлөгдсөн байж магадгүй: `ModelMayBeModified` + ажиглагчийн тэмдэг хүчээр урагшилж, өөрчлөлтийн бүртгэлд «цоорхой» тэмдэглэнэ.
        /// </summary>
        private static bool RollBackGroup(TransactionGroup tg, ObservationDeferral deferral, Document doc, ApplyOutcome outcome)
        {
            bool ok = false;
            try { ok = tg.RollBack() == TransactionStatus.RolledBack; }
            catch (Exception ex) { SmartLog.Error("prechange", "apply_rollback_failed", ex); }
            if (!ok) ok = SafeStatus(tg) == TransactionStatus.RolledBack;     // шидсэн ч Revit аль хэдийн буцаасан байж болно
            deferral.Discard();
            if (!ok)
            {
                if (outcome != null) outcome.ModelMayBeModified = true;
                ModelChangeCounter.ForceBump(doc);
                try { ImpactCapture.ReportLostObservation(); } catch (Exception) { }
            }
            return ok;
        }

        private static TransactionStatus SafeStatus(TransactionGroup tg)
        {
            try { return tg == null ? TransactionStatus.Uninitialized : tg.GetStatus(); }
            catch (Exception) { return TransactionStatus.Uninitialized; }
        }

        /// <summary>Preview-ийн ӨМНӨХ (хөдөлгөөнгүй) төлөвөөс байрлалын хурууны хээ — Apply буцсаны дараа шалгахад.</summary>
        private static RestoreProbe RestoreBaseline(PreChangeReport preview)
        {
            var p = new RestoreProbe { Readable = false };
            if (preview == null || preview.Before == null || preview.Before.Source == null) return p;
            p.Readable = true;
            p.WallExists = true;
            p.WallLocation = preview.Before.Source.Location;
            p.WallTypeId = -1;     // Apply-д төрлийг дахин шалгахгүй (preview-ийн хурууны хээгээр аль хэдийн тулгасан)
            foreach (KeyValuePair<long, HostedSnap> kv in preview.Before.Hosted) { p.Others[kv.Key] = kv.Value.LocationMm; p.OthersPresent.Add(kv.Key); }
            foreach (KeyValuePair<long, ElementPlace> kv in preview.Before.Joined) { p.Others[kv.Key] = kv.Value.Location; p.OthersPresent.Add(kv.Key); }
            return p;
        }

        /// <summary>Буцаалтын дараа хана, хост, хөрш ханууд preview-ийн ӨМНӨХ байрлалдаа буцсан эсэх (Apply буцаасны дараах fail-closed шалгалт).</summary>
        private static bool LooksRestored(Document doc, CaptureSpec spec, RestoreProbe baseline)
        {
            try
            {
                if (baseline == null || !baseline.Readable) return false;
                RestoreProbe now = PreChangeSandbox.Probe(doc, spec, false, null, null);
                now.WallTypeId = -1;
                RestoreProbe b = baseline;
                RestoreResult r = PreChangeRestoreCheck.Compare(b, now);
                return r.Restored;
            }
            catch (Exception) { return false; }
        }

        private static ApplyOutcome Fail(ApplyOutcome o, string msg)
        {
            o.Status = ApplyStatus.Failed;
            o.Message = msg + " Загварт өөрчлөлт хийгдээгүй.";
            return o;
        }

        private static ApplyOutcome Stale(ApplyOutcome o, string detail)
        {
            o.Status = ApplyStatus.Stale;
            o.Message = PreChangeText.StalePreview + " (" + detail + ")";
            return o;
        }
    }
}
