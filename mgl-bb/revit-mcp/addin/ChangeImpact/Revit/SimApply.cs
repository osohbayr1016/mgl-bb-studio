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
    /// <summary>
    /// «Зөвшөөрөх (зөөх)» — simulation-д харсан ЯГ ИЖИЛ зөөлтийг загварт БОДИТООР хийнэ.  Хулганаар чирч байхад загвар ХЭЗЭЭ Ч хөдлөөгүй; энэ нь л нэг бодит өөрчлөлт.
    ///
    ///   1. Идэвхтэй файл, шинжилгээ (offset-д таарсан, Simulated), ХУУЧИРСАН эсэх (загварын өөрчлөлтийн тэмдэг), элементийн дэмжлэгийг шалгана — fail-closed.
    ///   2. TransactionGroup «MGL — Элемент зөөх» { Transaction{ MoveElement(s) → Regenerate → Commit } → SETTLED тулгалт → `Assimilate()` (НЭГ Undo) | `RollBack()` }.
    ///   3. SETTLED тулгалт: зөөгдсөн элемент бүрийн байрлал, устсан элементүүд, алдаа — шинжилгээний settled төлөвтэй ТААРАХ ёстой.  Зөрвөл буцаана.
    ///   4. MGL-ийн ажиглагчид дотоод commit-ийг хойшлуулж (`ObservationDeferral`), Assimilate АМЖИЛТТАЙ болсны ДАРАА нэг удаа тоглуулна; буцвал хаяна.
    /// ⚠️ «Шинжилгээтэй таарсан» гэж ЗӨВХӨН commit-ийн дараа уншсан төлөвтэй тулгасан үед хэлнэ.
    /// </summary>
    internal static class SimApply
    {
        internal const string UndoName = "MGL — Элемент зөөх";

        internal static ApplyOutcome Run(UIApplication app, DocumentKey key, SimLoaded loaded, SimExactResult preview, SimVec offsetMm)
        {
            var outcome = new ApplyOutcome();
            var total = Stopwatch.StartNew();
            try
            {
                UIDocument ui = app.ActiveUIDocument;
                Document doc = ui != null ? ui.Document : null;
                if (doc == null) return Fail(outcome, "Идэвхтэй баримт алга.");
                if (!key.Equals(RevitDocumentKeys.Of(doc))) return Fail(outcome, "Идэвхтэй файл солигдсон — simulation хийсэн файл руугаа буцна уу.");
                if (loaded == null || loaded.Check == null) return Fail(outcome, "Сцен алга.");
                if (preview == null || preview.Outcome != SandboxOutcome.Simulated) return Fail(outcome, "Revit-ийн шинжилгээ дуусаагүй эсвэл зөөлтийг зөвшөөрөөгүй байна.");
                if (!preview.Matches(offsetMm)) return Stale(outcome, "Шинжилгээ өөр байрлалынх — дахин шалгана уу.");

                // Хуучирсан эсэх (fail-closed): тэмдэг уншигдаагүй = «хуучраагүй» БИШ.
                string now = null;
                try { now = ModelChangeCounter.Stamp(doc); } catch (Exception) { }
                if (now == null || preview.Stamp == null || !string.Equals(now, preview.Stamp, StringComparison.Ordinal))
                {
                    outcome.Status = ApplyStatus.Stale;
                    outcome.Message = "Загвар шинжилгээнээс хойш өөрчлөгдсөн (эсвэл тэмдэг уншигдсангүй) — зөөлтийг дахин шалгаад зөвшөөрнө үү. Загварт өөрчлөлт хийгдээгүй.";
                    return outcome;
                }

                SimMoveCheck check = SimElementRules.Check(doc, loaded.Check.SelectedIds.Select(i => new ElementId(i)).ToList());
                if (!check.Ok) return Fail(outcome, check.Problem);

                var selected = check.SelectedIds.ToList();
                XYZ move = new XYZ(PcUnits.ToInternalMm(offsetMm.X), PcUnits.ToInternalMm(offsetMm.Y), PcUnits.ToInternalMm(offsetMm.Z));
                var handler = new PreChangeFailureHandler(false);
                var deleted = new List<long>();
                string stampBefore = now;
                ObservationDeferral deferral = ObservationDeferral.Begin(app, doc);
                EventHandler<DocumentChangedEventArgs> onChanged = (s, e) =>
                {
                    try
                    {
                        Document d = e.GetDocument();
                        if (d == null || !SmartDocs.Same(d, doc)) return;
                        if (e.Operation != UndoOperation.TransactionCommitted) return;
                        foreach (ElementId id in e.GetDeletedElementIds()) deleted.Add(id.Value);
                    }
                    catch (Exception) { }
                };
                TransactionGroup tg = null;
                bool groupOpen = false;
                try
                {
                    app.Application.DocumentChanged += onChanged;
                    tg = new TransactionGroup(doc, UndoName);
                    if (tg.Start() != TransactionStatus.Started)
                    {
                        deferral.Discard();
                        return Fail(outcome, "Revit транзакц нээхийг зөвшөөрсөнгүй.");
                    }
                    groupOpen = true;

                    // ---- 1. дотоод транзакц: зөөх + Regenerate + COMMIT
                    bool committed;
                    string txError = null;
                    using (var t = new Transaction(doc, UndoName))
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
                            if (selected.Count == 1) ElementTransformUtils.MoveElement(doc, new ElementId(selected[0]), move);
                            else ElementTransformUtils.MoveElements(doc, selected.Select(i => new ElementId(i)).ToList(), move);
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
                            txError = "Revit зөөхийг зөвшөөрсөнгүй (" + ex.GetType().Name + "): " + SmartLog.Scrub(ex.Message) + ".";
                            if (t.GetStatus() == TransactionStatus.Started) { try { t.RollBack(); } catch (Exception) { } }
                        }
                    }
                    if (!committed)
                    {
                        groupOpen = false;
                        RollBackGroup(tg, deferral, doc, outcome);
                        return Fail(outcome, txError ?? "Revit хөдөлгөөнийг зөвшөөрөөгүй.");
                    }

                    // ---- 2. SETTLED тулгалт: commit-ийн ДАРАА, бүлэг нээлттэй байхад
                    List<string> mismatches = Compare(doc, preview, deleted);
                    outcome.Compared.Add("зөөгдсөн элементийн байрлал");
                    outcome.Compared.Add("устах элемент");
                    outcome.NotCompared.Add("харагдац, хуудас, хүснэгт, гарц (энэ simulation-д шалгагддаггүй)");
                    if (mismatches.Count > 0)
                    {
                        groupOpen = false;
                        bool restored = RollBackGroup(tg, deferral, doc, outcome);
                        outcome.Status = ApplyStatus.RolledBackMismatch;
                        outcome.Message = "Бодит үр дүн шинжилгээнээс ялгаатай тул буцаалаа: " + string.Join(" ", mismatches);
                        outcome.Details.AddRange(mismatches);
                        if (!restored)
                        {
                            outcome.Message += " ⚠ Загвар анхны төлөвт буцсаныг баталгаажуулж чадсангүй — Revit-д Ctrl+Z-ээр шалгана уу.";
                            outcome.ModelMayBeModified = true;
                            ModelChangeCounter.ForceBump(doc);
                        }
                        return outcome;
                    }

                    // ---- 3. баталгаажсан: НЭГ Undo болгон нэгтгэнэ
                    TransactionStatus ast = TransactionStatus.Uninitialized;
                    try { ast = tg.Assimilate(); }
                    catch (Exception aex) { SmartLog.Error("sim", "assimilate_failed", aex); }
                    groupOpen = false;
                    TransactionStatus gst = SafeStatus(tg);
                    if (ast == TransactionStatus.Committed || gst == TransactionStatus.Committed)
                    {
                        int replayed = deferral.Publish();
                        ModelChangeCounter.EnsureAdvanced(doc, stampBefore);
                        outcome.Status = ApplyStatus.AppliedVerified;
                        outcome.Message = "«" + loaded.Scene.MovingName + "» зөөгдлөө (" + SimNarrative.FormatOffset(offsetMm) + "). Шинжилгээтэй таарсан. Буцаах: Ctrl+Z (нэг алхам, «" + UndoName + "»).";
                        SmartLog.Info("sim", "applied", new { replayed, lost = deferral.Lost, ms = total.ElapsedMilliseconds });
                        return outcome;
                    }
                    if (ast == TransactionStatus.RolledBack || gst == TransactionStatus.RolledBack)
                    {
                        deferral.Discard();
                        return Fail(outcome, "Хөдөлгөөнийг нэг Undo болгон хадгалж чадсангүй — Revit буцаалаа.");
                    }
                    if (RollBackGroup(tg, deferral, doc, outcome))
                        return Fail(outcome, "Хөдөлгөөнийг нэг Undo болгон хадгалж чадсангүй — буцаалаа.");
                    outcome.Status = ApplyStatus.AppliedUnverified;
                    outcome.ModelMayBeModified = true;
                    ModelChangeCounter.ForceBump(doc);
                    outcome.Message = "Элемент зөөгдсөн байж магадгүй боловч нэг Undo болгож чадсангүй — Revit-ийн Undo жагсаалтыг шалгана уу.";
                    return outcome;
                }
                catch (Exception ex)
                {
                    SmartLog.Error("sim", "apply_failed", ex);
                    if (groupOpen && tg != null) RollBackGroup(tg, deferral, doc, outcome);
                    return Fail(outcome, "Хэрэгжүүлэх үед алдаа гарлаа (" + ex.GetType().Name + "): " + SmartLog.Scrub(ex.Message));
                }
                finally
                {
                    try { app.Application.DocumentChanged -= onChanged; } catch (Exception) { }
                    deferral.Dispose();
                }
            }
            catch (Exception ex)
            {
                SmartLog.Error("sim", "apply_failed", ex);
                return Fail(outcome, "Хэрэгжүүлэх үед алдаа гарлаа (" + ex.GetType().Name + "): " + SmartLog.Scrub(ex.Message));
            }
        }

        /// <summary>Бодит settled төлөв ↔ шинжилгээний settled төлөв.  Хоосон = таарсан.</summary>
        private static List<string> Compare(Document doc, SimExactResult preview, List<long> deletedNow)
        {
            var problems = new List<string>();
            int moved = 0, missing = 0;
            foreach (KeyValuePair<long, double[]> kv in preview.SettledLocations)
            {
                Element e = null;
                try { e = doc.GetElement(new ElementId(kv.Key)); } catch (Exception) { }
                if (e == null || !e.IsValidObject) { missing++; continue; }
                double[] now = SimExactAnalyzer.LocOrBox(e);
                if (kv.Value == null || now == null) continue;
                if (kv.Value.Length != now.Length) { moved++; continue; }
                for (int i = 0; i < now.Length; i++)
                    if (Math.Abs(now[i] - kv.Value[i]) > PreChangeTolerance.VerifyLengthMm) { moved++; break; }
            }
            if (missing > 0) problems.Add(missing + " элемент зөөлтийн дараа олдсонгүй.");
            if (moved > 0) problems.Add(moved + " элементийн эцсийн байрлал шинжилгээнээс зөрсөн.");

            var expected = new HashSet<long>(preview.DeletedIds);
            var actual = new HashSet<long>(deletedNow);
            if (!expected.SetEquals(actual))
                problems.Add("Устсан элементийн жагсаалт шинжилгээнээс ялгаатай (" + expected.Count + " → " + actual.Count + ").");
            return problems;
        }

        private static bool RollBackGroup(TransactionGroup tg, ObservationDeferral deferral, Document doc, ApplyOutcome outcome)
        {
            bool ok = false;
            try { ok = tg.RollBack() == TransactionStatus.RolledBack; }
            catch (Exception ex) { SmartLog.Error("sim", "apply_rollback_failed", ex); }
            if (!ok) ok = SafeStatus(tg) == TransactionStatus.RolledBack;
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

        private static ApplyOutcome Fail(ApplyOutcome o, string msg)
        {
            o.Status = ApplyStatus.Failed;
            o.Message = msg + " Загварт өөрчлөлт хийгдээгүй.";
            return o;
        }

        private static ApplyOutcome Stale(ApplyOutcome o, string detail)
        {
            o.Status = ApplyStatus.Stale;
            o.Message = detail + " Загварт өөрчлөлт хийгдээгүй.";
            return o;
        }
    }
}
