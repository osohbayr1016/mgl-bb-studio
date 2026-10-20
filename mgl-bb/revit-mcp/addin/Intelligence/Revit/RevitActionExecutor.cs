using System;
using System.Collections.Generic;
using System.Globalization;
using Autodesk.Revit.DB;
using RevitMcpAddin.Intelligence.Contracts;
using RevitMcpAddin.Intelligence.Core;

namespace RevitMcpAddin.Intelligence.Revit
{
    /* ================================================================== */
    /*  R4.1 — CONFIRM_WRITE ГҮЙЦЭТГЭГЧ (Revit API thread дээр, RevitToolBus  */
    /*  → ExternalEvent → энд).  Шалгалтын логик ЦЭВЭР давхаргад            */
    /*  (Core/ActionPipeline.cs); энд Revit-ээс БАРИМТ уншиж, ЯГ НЭГ         */
    /*  мутаци хийж, regenerate → дахин уншиж → postcondition → commit |     */
    /*  rollback.                                                            */
    /*                                                                       */
    /*  ⚠️ Preview-ийн үеийн төлөвт ИТГЭХГҮЙ (§9): гүйцэтгэхдээ элементийг    */
    /*     ДАХИН авч, урьдчилсан нөхцөл + баталгааны холбоосыг ДАХИН шалгана. */
    /*  ⚠️ LLM-ийн C# ХЭЗЭЭ Ч — зөвхөн typed envelope.                       */
    /* ================================================================== */
    internal static class RevitActionExecutor
    {
        private const double FtToMm = 304.8;

        /* ---------------- баримт унших ---------------- */

        internal static DocumentFacts DocFacts(Document doc, string docKey, long changeSeq)
        {
            var d = new DocumentFacts
            {
                DocKey = docKey,
                Title = doc.Title,
                IsReadOnly = doc.IsReadOnly,
                IsLinked = doc.IsLinked,
                IsFamily = doc.IsFamilyDocument,
                // ⚠️ Document.IsModifiable нь ЗӨВХӨН нээлттэй Transaction дотор true — preview үед false (хэмжсэн, R4.1 Test A).
                //    Бичих боломж = read-only биш + холбоос биш + family биш.
                IsModifiable = !doc.IsReadOnly && !doc.IsLinked && !doc.IsFamilyDocument,
                IsWorkshared = doc.IsWorkshared,
                IsTestFixture = TestModelFixture.IsTestMarked(doc),
            };
            // Хурууны хээ: баримт + өөрчлөлтийн тоолуур — preview-ийн дараа ЯМАР Ч өөрчлөлт → STALE (§14).
            d.Fingerprint = ActionHash.Short(ActionHash.Sha256(docKey + "|" + doc.Title + "|" + changeSeq.ToString(CultureInfo.InvariantCulture)));
            return d;
        }

        internal static ElementFacts ElementFactsOf(Document doc, long id)
        {
            var f = new ElementFacts { ElementId = id };
            Element e = null;
            try { e = doc.GetElement(new ElementId(id)); } catch { e = null; }
            if (e == null) { f.Exists = false; return f; }
            f.Exists = true;
            f.UniqueId = e.UniqueId;
            f.Category = e.Category != null ? e.Category.Name : null;
            f.IsLinked = doc.IsLinked;
            f.IsPinned = Safe(() => e.Pinned);
            f.IsElementType = e is ElementType;
            try
            {
                ElementId tid = e.GetTypeId();
                if (tid != null && tid != ElementId.InvalidElementId)
                {
                    f.TypeId = tid.Value;
                    var t = doc.GetElement(tid) as ElementType;
                    if (t != null) { f.Type = t.Name; f.Family = Safe(() => t.FamilyName); }
                }
            }
            catch { }
            // Worksharing: зөвхөн энэ хэрэглэгч эсвэл хэн ч эзэмшээгүй бол засварлана.
            if (doc.IsWorkshared)
            {
                try
                {
                    CheckoutStatus st = WorksharingUtils.GetCheckoutStatus(doc, e.Id);
                    f.Editable = st == CheckoutStatus.OwnedByCurrentUser || st == CheckoutStatus.NotOwned;
                    f.EditableReason = st.ToString();
                }
                catch (Exception ex) { f.Editable = false; f.EditableReason = ex.GetType().Name; }
            }
            // Байршил — LocationPoint эсвэл LocationCurve-ийн ЭХЛЭЛ (мм)
            try
            {
                var lp = e.Location as LocationPoint;
                var lc = e.Location as LocationCurve;
                if (lp != null) { f.LocationMm = Mm(lp.Point); f.HasPointOrCurveLocation = true; }
                else if (lc != null && lc.Curve != null) { f.LocationMm = Mm(lc.Curve.GetEndPoint(0)); f.HasPointOrCurveLocation = true; }
            }
            catch { }
            // Параметр — ЗӨВХӨН цагаан жагсаалт (Comments/Mark/Description)
            foreach (string name in ActionPreconditions.WritableParameterAllowlist)
            {
                try
                {
                    Parameter p = e.LookupParameter(name);
                    if (p == null) continue;
                    var pf = new ParamFacts { Name = name, ReadOnly = p.IsReadOnly, IsTypeParam = false };
                    switch (p.StorageType)
                    {
                        case StorageType.String: pf.Storage = ParamStorage.STRING; pf.Value = p.AsString() ?? ""; break;
                        case StorageType.Integer: pf.Storage = ParamStorage.INTEGER; pf.Value = p.AsInteger().ToString(CultureInfo.InvariantCulture); break;
                        case StorageType.Double: pf.Storage = ParamStorage.DOUBLE; pf.Value = p.AsDouble().ToString("R", CultureInfo.InvariantCulture); break;
                        case StorageType.ElementId: pf.Storage = ParamStorage.ELEMENT_ID; pf.Value = p.AsElementId().Value.ToString(CultureInfo.InvariantCulture); break;
                        default: pf.Storage = ParamStorage.NONE; break;
                    }
                    f.Params[name] = pf;
                }
                catch { }
            }
            // CHANGE_TYPE: Revit-ийн ӨӨРИЙН зөвшөөрөгдөх төрлүүд (ижил категори)
            try
            {
                foreach (ElementId tid in e.GetValidTypes())
                {
                    var t = doc.GetElement(tid) as ElementType;
                    if (t == null) continue;
                    f.ValidTypes.Add(new TypeFacts { TypeId = tid.Value, Name = t.Name, Family = Safe(() => t.FamilyName), Category = t.Category != null ? t.Category.Name : f.Category });
                    if (f.ValidTypes.Count >= 200) break;
                }
            }
            catch { }
            return f;
        }

        /* ---------------- preview ---------------- */

        internal static ActionPreview Preview(Document doc, RevitIntelligenceHost host, RevitActionEnvelope a)
        {
            string docKey = host.CurrentDocKey ?? DocKeys.Normalize(RevitTools.DocUid(doc));
            // doc_key өгөгдөөгүй бол ОДООГИЙН баримт (зорилт нь UniqueId-аар холбогдоно); өөр баримт заасан бол шалгалт унана.
            if (string.IsNullOrWhiteSpace(a.DocKey)) a.DocKey = docKey;
            DocumentFacts df = DocFacts(doc, docKey, host.ChangeSeq);
            ActionValidation schema = RevitActionValidator.Validate(a);
            var codes = new List<ActionValidationCode>();
            foreach (ActionValidationCode c in schema.Codes) if (c != ActionValidationCode.OK) codes.Add(c);
            ElementFacts el = a.TargetElementIds != null && a.TargetElementIds.Count > 0 ? ElementFactsOf(doc, a.TargetElementIds[0]) : new ElementFacts { Exists = false };
            // CHANGE_TYPE: type_name → type_id (детерминист канончлол, Revit-ийн ValidTypes-оос) — proposal hash үүнээс ХОЙШ тооцогдоно.
            ActionValidationCode? canon = ActionPreconditions.CanonicalizeChangeType(a, el);
            if (canon.HasValue && !codes.Contains(canon.Value)) codes.Add(canon.Value);
            foreach (ActionValidationCode c in ActionPreconditions.Check(a, df, el, host.IssuesOf(docKey, false))) if (!codes.Contains(c)) codes.Add(c);
            ActionPreview pv = ActionPreviewBuilder.Build(a, df, el, codes, DateTime.UtcNow);
            host.Actions.Remember(a, pv);
            host.Audit.Write(new ActionAuditRecord
            {
                Stage = "preview", ActionId = a.ActionId, PreviewId = pv.PreviewId, Action = a.Action, DocFingerprint = df.Fingerprint,
                ElementUniqueId = el.UniqueId, ElementId = el.Exists ? el.ElementId : (long?)null,
                Before = pv.Before != null ? pv.Before.Value : null, Proposed = ProposedText(pv),
                RequestedBy = a.RequestedBy != null ? a.RequestedBy.Kind : null, Result = pv.Validation.Ok ? "PREVIEW_OK" : "PREVIEW_REJECTED",
                Codes = Names(codes),
            });
            return pv;
        }

        /* ---------------- гүйцэтгэл ---------------- */

        internal static ActionExecution Apply(Document doc, RevitIntelligenceHost host, ActionConfirmation c, bool testForcePostconditionFail)
        {
            var sw = System.Diagnostics.Stopwatch.StartNew();
            var ex = new ActionExecution { PreviewId = c != null ? c.PreviewId : null, Status = ActionExecutionStatus.REJECTED };
            RevitActionEnvelope a; ActionPreview pv;
            if (c == null || !host.Actions.TryGet(c.PreviewId, out a, out pv))
            {
                ex.Codes.Add(ActionValidationCode.STALE_ACTION_PREVIEW);
                ex.MessageMn = "Preview олдсонгүй — шинээр preview хий.";
                return Finish(host, ex, sw, null, null);
            }
            ex.ActionId = a.ActionId; ex.Action = a.Action; ex.Before = pv.Before;

            // 1–2. Элементийг ДАХИН авч, урьдчилсан нөхцөл + холбоосыг ДАХИН шалгана (preview-д итгэхгүй).
            string docKey = host.CurrentDocKey ?? DocKeys.Normalize(RevitTools.DocUid(doc));
            DocumentFacts df = DocFacts(doc, docKey, host.ChangeSeq);
            ElementFacts now = a.TargetElementIds.Count > 0 ? ElementFactsOf(doc, a.TargetElementIds[0]) : new ElementFacts { Exists = false };
            List<ActionValidationCode> codes = ActionPreviewBuilder.VerifyConfirmation(pv, c, df, now, a, DateTime.UtcNow);
            foreach (ActionValidationCode k in ActionPreconditions.Check(a, df, now, host.IssuesOf(docKey, false))) if (!codes.Contains(k)) codes.Add(k);
            if (codes.Count > 0)
            {
                ex.Codes.AddRange(codes);
                ex.Status = codes.Contains(ActionValidationCode.STALE_ACTION_PREVIEW) || codes.Contains(ActionValidationCode.PREVIEW_EXPIRED) ? ActionExecutionStatus.STALE : ActionExecutionStatus.REJECTED;
                ex.MessageMn = ex.Status == ActionExecutionStatus.STALE ? "Загвар preview-ээс хойш өөрчлөгдсөн — шинэ preview хэрэгтэй (STALE_ACTION_PREVIEW)." : "Урьдчилсан нөхцөл хангагдсангүй: " + string.Join(", ", codes);
                return Finish(host, ex, sw, a, pv, c);
            }
            if (testForcePostconditionFail && !df.IsTestFixture)
            {
                ex.Codes.Add(ActionValidationCode.PRECONDITION_FAILED);
                ex.MessageMn = "test_force_postcondition_fail нь ЗӨВХӨН синтетик тест баримтад.";
                return Finish(host, ex, sw, a, pv, c);
            }

            // 3–11. Transaction: ЯГ НЭГ мутаци → regenerate → дахин унших → postcondition → commit | rollback
            Element e = doc.GetElement(new ElementId(a.TargetElementIds[0]));
            using (var t = new Transaction(doc, "MGL AI · " + a.Action))
            {
                try
                {
                    if (t.Start() != TransactionStatus.Started) { ex.Codes.Add(ActionValidationCode.TRANSACTION_FAILED); ex.Status = ActionExecutionStatus.FAILED; ex.MessageMn = "Transaction эхэлсэнгүй."; return Finish(host, ex, sw, a, pv, c); }
                    Mutate(doc, e, a, pv);
                    doc.Regenerate();
                    ElementFacts after = ElementFactsOf(doc, a.TargetElementIds[0]);
                    if (testForcePostconditionFail)
                    {
                        // DEV/ТЕСТ (§19 Test D): postcondition-ийг ЗОРИУД унагааж rollback-ийг батална — синтетик баримтад л.
                        after = new ElementFacts { Exists = true, ElementId = after.ElementId, UniqueId = after.UniqueId, Category = after.Category, TypeId = -1, LocationMm = new[] { -1e9, -1e9, -1e9 } };
                        after.Params["Comments"] = new ParamFacts { Name = "Comments", Storage = ParamStorage.STRING, Value = "<forced-mismatch>" };
                    }
                    string why;
                    bool ok = ActionPreviewBuilder.Postcondition(a, pv, after, out why);
                    if (!ok)
                    {
                        t.RollBack();
                        ex.Status = ActionExecutionStatus.ROLLED_BACK; ex.Verified = false; ex.RollbackReason = why;
                        ex.Codes.Add(ActionValidationCode.POSTCONDITION_FAILED);
                        ex.After = ActionPreviewBuilder.StateOf(ElementFactsOf(doc, a.TargetElementIds[0]), ActionPreviewBuilder.BeforeValue(a, ElementFactsOf(doc, a.TargetElementIds[0])));
                        ex.MessageMn = "✗ Буцаалаа — postcondition унав: " + why;
                        return Finish(host, ex, sw, a, pv, c);
                    }
                    if (t.Commit() != TransactionStatus.Committed) { ex.Codes.Add(ActionValidationCode.TRANSACTION_FAILED); ex.Status = ActionExecutionStatus.FAILED; ex.MessageMn = "Commit амжилтгүй."; return Finish(host, ex, sw, a, pv, c); }
                    ex.After = ActionPreviewBuilder.StateOf(after, ActionPreviewBuilder.BeforeValue(a, after));
                    ex.Verified = true; ex.Status = ActionExecutionStatus.APPLIED;
                }
                catch (Exception err)
                {
                    try { if (t.GetStatus() == TransactionStatus.Started) t.RollBack(); } catch { }
                    ex.Status = ActionExecutionStatus.ROLLED_BACK; ex.Verified = false; ex.RollbackReason = err.GetType().Name + ": " + err.Message;
                    ex.Codes.Add(ActionValidationCode.TRANSACTION_FAILED);
                    ex.MessageMn = "✗ Буцаалаа — алдаа: " + err.GetType().Name;
                    return Finish(host, ex, sw, a, pv, c);
                }
            }
            // Commit-ийн ДАРАА: график + детерминист асуудлыг ШУУД дахин үнэлнэ (change tracker-ийн coalescer-ийг хүлээхгүй)
            try { ex.IssuesAfter = host.ReevaluateNow(doc, new List<long> { a.TargetElementIds[0] }); } catch { }
            ex.MessageMn = "✓ Хэрэглэж, баталгаажууллаа.";
            return Finish(host, ex, sw, a, pv, c);
        }

        private static void Mutate(Document doc, Element e, RevitActionEnvelope a, ActionPreview pv)
        {
            switch (a.Action)
            {
                case RevitActionKind.SET_PARAMETER:
                    {
                        Parameter p = e.LookupParameter(pv.ParameterName);
                        if (p == null) throw new InvalidOperationException("параметр алга");
                        switch (p.StorageType)
                        {
                            case StorageType.String: p.Set(pv.AfterValue ?? ""); break;
                            case StorageType.Integer: p.Set(int.Parse(pv.AfterValue, CultureInfo.InvariantCulture)); break;
                            case StorageType.Double: p.Set(double.Parse(pv.AfterValue, CultureInfo.InvariantCulture)); break;
                            default: throw new InvalidOperationException("storage дэмжигдэхгүй");
                        }
                        break;
                    }
                case RevitActionKind.MOVE_ELEMENT:
                    {
                        double[] d = ActionPreconditions.MoveDelta(a);
                        ElementTransformUtils.MoveElement(doc, e.Id, new XYZ(d[0] / FtToMm, d[1] / FtToMm, d[2] / FtToMm));
                        break;
                    }
                case RevitActionKind.CHANGE_TYPE:
                    e.ChangeTypeId(new ElementId(pv.AfterTypeId.Value));
                    break;
                default:
                    throw new InvalidOperationException("WRITE_ACTION_DISABLED_IN_THIS_RELEASE");
            }
        }

        private static ActionExecution Finish(RevitIntelligenceHost host, ActionExecution ex, System.Diagnostics.Stopwatch sw, RevitActionEnvelope a, ActionPreview pv, ActionConfirmation c = null)
        {
            ex.ElapsedMs = Math.Round(sw.Elapsed.TotalMilliseconds, 1);
            ActionAuditRecord rec = host.Audit.Write(new ActionAuditRecord
            {
                Stage = "execute", ActionId = ex.ActionId, PreviewId = ex.PreviewId, Action = ex.Action,
                DocFingerprint = pv != null ? pv.DocFingerprint : null,
                ElementUniqueId = pv != null && pv.Before != null ? pv.Before.UniqueId : null, ElementId = pv != null && pv.Before != null ? pv.Before.ElementId : (long?)null,
                Before = ex.Before != null ? ex.Before.Value : null, Proposed = pv != null ? ProposedText(pv) : null,
                ConfirmedBy = c != null ? c.ConfirmedBy : null, Executed = ex.Status == ActionExecutionStatus.APPLIED || ex.Status == ActionExecutionStatus.ROLLED_BACK,
                Result = ex.Status.ToString(), PostValidation = ex.Verified ? "PASSED" : (ex.Status == ActionExecutionStatus.ROLLED_BACK ? "FAILED" : "NOT_RUN"),
                RollbackReason = ex.RollbackReason, Codes = Names(ex.Codes), RequestedBy = a != null && a.RequestedBy != null ? a.RequestedBy.Kind : null,
            });
            ex.AuditSeq = rec.Seq;
            if (pv != null) host.Actions.Consume(pv.PreviewId, ex);
            return ex;
        }

        private static string ProposedText(ActionPreview pv)
        {
            switch (pv.Action)
            {
                case RevitActionKind.SET_PARAMETER: return pv.ParameterName + "=" + pv.AfterValue;
                case RevitActionKind.MOVE_ELEMENT: return pv.AfterLocationMm == null ? null : "→(" + string.Join(",", Array.ConvertAll(pv.AfterLocationMm, v => Math.Round(v, 1).ToString(CultureInfo.InvariantCulture))) + ")";
                case RevitActionKind.CHANGE_TYPE: return "type→" + pv.AfterTypeId;
            }
            return null;
        }

        private static List<string> Names(List<ActionValidationCode> codes)
        {
            var l = new List<string>();
            foreach (ActionValidationCode c in codes) l.Add(c.ToString());
            return l;
        }

        private static double[] Mm(XYZ p) { return new[] { p.X * FtToMm, p.Y * FtToMm, p.Z * FtToMm }; }

        private static T Safe<T>(Func<T> f) { try { return f(); } catch { return default(T); } }
    }

    /// <summary>Preview-ийн санах ойн дэлгүүр — preview_id → (envelope, preview); гүйцэтгэсний дараа ХЭРЭГЛЭГДСЭН (дахин ашиглахгүй).</summary>
    public sealed class ActionStore
    {
        private readonly object _gate = new object();
        private readonly Dictionary<string, KeyValuePair<RevitActionEnvelope, ActionPreview>> _open = new Dictionary<string, KeyValuePair<RevitActionEnvelope, ActionPreview>>(StringComparer.Ordinal);
        public ActionPreview Current { get; private set; }
        public ActionExecution LastResult { get; private set; }

        public void Remember(RevitActionEnvelope a, ActionPreview pv)
        {
            lock (_gate) { _open[pv.PreviewId] = new KeyValuePair<RevitActionEnvelope, ActionPreview>(a, pv); Current = pv; LastResult = null; }
        }

        public bool TryGet(string previewId, out RevitActionEnvelope a, out ActionPreview pv)
        {
            lock (_gate)
            {
                KeyValuePair<RevitActionEnvelope, ActionPreview> kv;
                if (previewId != null && _open.TryGetValue(previewId, out kv)) { a = kv.Key; pv = kv.Value; return true; }
                a = null; pv = null; return false;
            }
        }

        /// <summary>Гүйцэтгэсэн (эсвэл хуучирсан) preview ДАХИН баталгаажуулагдахгүй — нэг удаагийн.</summary>
        public void Consume(string previewId, ActionExecution result)
        {
            lock (_gate) { _open.Remove(previewId); LastResult = result; if (Current != null && Current.PreviewId == previewId && result.Status != ActionExecutionStatus.REJECTED) Current = null; }
        }
    }
}
