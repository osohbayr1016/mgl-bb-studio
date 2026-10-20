using System;
using System.Collections.Generic;
using RevitMcpAddin.Intelligence.Contracts;
using RevitMcpAddin.Intelligence.Core;

namespace RevitMcpAddin.Intelligence.Tests
{
    /* ================================================================== */
    /*  R4.1 — CONFIRM_WRITE дамжлагын ЦЭВЭР тест (§18): envelope · хаалттай */
    /*  үйлдэл · хуучирсан preview · read-only · linked · pinned · буруу    */
    /*  төрөл · зорилтгүй · засварлах эрх · postcondition · rollback ·      */
    /*  аудитын серилиз.                                                    */
    /* ================================================================== */
    public static class ActionPipelineTests
    {
        private static RevitActionEnvelope Set(string name, string value, long id = 2786)
        {
            return new RevitActionEnvelope
            {
                ActionId = "act_set1", DocKey = "doc1", Action = RevitActionKind.SET_PARAMETER,
                TargetElementIds = { id }, TargetUniqueIds = { "uid-" + id },
                Parameters = { { "name", name }, { "value", value } },
                Reason = new ActionReason { SummaryMn = "тест" }, RequestedBy = new ActionRequester { Kind = "USER" },
                Evidence = { new ActionEvidence { Kind = "SELECTION", Ref = id.ToString(), TextMn = "сонгосон хана" } },
                SafetyLevel = ActionSafetyLevel.CONFIRM_WRITE,
            };
        }

        private static RevitActionEnvelope Move(double dx, double dy = 0, double dz = 0)
        {
            var a = Set("Comments", "x");
            a.ActionId = "act_move1"; a.Action = RevitActionKind.MOVE_ELEMENT;
            a.Parameters.Clear();
            a.Parameters["dx_mm"] = dx.ToString(System.Globalization.CultureInfo.InvariantCulture);
            a.Parameters["dy_mm"] = dy.ToString(System.Globalization.CultureInfo.InvariantCulture);
            a.Parameters["dz_mm"] = dz.ToString(System.Globalization.CultureInfo.InvariantCulture);
            return a;
        }

        private static RevitActionEnvelope ChangeType(long typeId)
        {
            var a = Set("Comments", "x");
            a.ActionId = "act_type1"; a.Action = RevitActionKind.CHANGE_TYPE;
            a.Parameters.Clear(); a.Parameters["type_id"] = typeId.ToString();
            return a;
        }

        private static DocumentFacts Doc(bool writable = true)
        {
            return new DocumentFacts { DocKey = "doc1", Title = "fixture", IsReadOnly = !writable, IsModifiable = writable, Fingerprint = "docfp-1", IsTestFixture = true };
        }

        private static ElementFacts Wall(string comments = "")
        {
            var e = new ElementFacts
            {
                Exists = true, ElementId = 2786, UniqueId = "uid-2786", Category = "Walls", Family = "Basic Wall", Type = "Wall 1", TypeId = 900,
                LocationMm = new[] { 5000.0, 8000.0, 0.0 }, HasPointOrCurveLocation = true,
            };
            e.Params["Comments"] = new ParamFacts { Name = "Comments", Storage = ParamStorage.STRING, ReadOnly = false, Value = comments };
            e.Params["Mark"] = new ParamFacts { Name = "Mark", Storage = ParamStorage.STRING, ReadOnly = false, Value = "" };
            e.Params["Area"] = new ParamFacts { Name = "Area", Storage = ParamStorage.DOUBLE, ReadOnly = true, Value = "322.9" };
            e.ValidTypes.Add(new TypeFacts { TypeId = 900, Name = "Wall 1", Family = "Basic Wall", Category = "Walls" });
            e.ValidTypes.Add(new TypeFacts { TypeId = 901, Name = "Generic - 200mm", Family = "Basic Wall", Category = "Walls" });
            return e;
        }

        private static readonly DateTime T0 = new DateTime(2026, 9, 15, 3, 0, 0, DateTimeKind.Utc);

        [Test] public static void Envelope_SetParameter_OK()
        {
            List<ActionValidationCode> codes = ActionPreconditions.Check(Set("Comments", "MGL-AI тест"), Doc(), Wall(), null);
            Assert.Eq(0, codes.Count, string.Join(",", codes));
            Assert.True(RevitActionValidator.Validate(Set("Comments", "x")).Ok);
        }

        [Test] public static void UnsupportedAction_Rejected()
        {
            var a = Set("Comments", "x"); a.Action = RevitActionKind.DELETE_ELEMENT;
            Assert.Contains(ActionPreconditions.Check(a, Doc(), Wall(), null), ActionValidationCode.WRITE_ACTION_DISABLED_IN_THIS_RELEASE);
            a.Action = RevitActionKind.CREATE_WALL;
            Assert.Contains(ActionPreconditions.Check(a, Doc(), Wall(), null), ActionValidationCode.WRITE_ACTION_DISABLED_IN_THIS_RELEASE);
        }

        [Test] public static void MissingTarget_And_Ungrounded_Rejected()
        {
            var a = Set("Comments", "x"); a.TargetElementIds.Clear();
            Assert.Contains(ActionPreconditions.Check(a, Doc(), Wall(), null), ActionValidationCode.NO_TARGETS);
            var b = Set("Comments", "x"); b.Evidence.Clear();
            Assert.Contains(ActionPreconditions.Check(b, Doc(), Wall(), null), ActionValidationCode.TARGET_NOT_GROUNDED);
            var c = Set("Comments", "x"); c.TargetElementIds.Add(2787);
            Assert.Contains(ActionPreconditions.Check(c, Doc(), Wall(), null), ActionValidationCode.TARGET_AMBIGUOUS);
            var gone = new ElementFacts { Exists = false };
            Assert.Contains(ActionPreconditions.Check(Set("Comments", "x"), Doc(), gone, null), ActionValidationCode.ELEMENT_NOT_FOUND);
        }

        [Test] public static void ReadOnlyParameter_And_TypeMismatch_And_Allowlist()
        {
            Assert.Contains(ActionPreconditions.Check(Set("Area", "5"), Doc(), Wall(), null), ActionValidationCode.PARAMETER_NOT_FOUND); // цагаан жагсаалтад байхгүй
            ElementFacts w = Wall();
            w.Params["Comments"].ReadOnly = true;
            Assert.Contains(ActionPreconditions.Check(Set("Comments", "x"), Doc(), w, null), ActionValidationCode.PARAMETER_READ_ONLY);
            ElementFacts w2 = Wall();
            w2.Params["Mark"].Storage = ParamStorage.INTEGER;
            Assert.Contains(ActionPreconditions.Check(Set("Mark", "abc"), Doc(), w2, null), ActionValidationCode.STORAGE_TYPE_MISMATCH);
            Assert.Eq(0, ActionPreconditions.Check(Set("Mark", "42"), Doc(), w2, null).Count);
            Assert.Contains(ActionPreconditions.Check(Set("Comments", new string('x', 600)), Doc(), Wall(), null), ActionValidationCode.VALUE_SCHEMA_INVALID);
            Assert.Contains(ActionPreconditions.Check(Set("Nope", "x"), Doc(), Wall(), null), ActionValidationCode.PARAMETER_NOT_FOUND);
        }

        [Test] public static void LinkedElement_ReadOnlyDoc_Worksharing_Prohibited()
        {
            ElementFacts l = Wall(); l.IsLinked = true;
            Assert.Contains(ActionPreconditions.Check(Set("Comments", "x"), Doc(), l, null), ActionValidationCode.LINKED_ELEMENT_NOT_WRITABLE);
            Assert.Contains(ActionPreconditions.Check(Set("Comments", "x"), Doc(false), Wall(), null), ActionValidationCode.DOCUMENT_NOT_WRITABLE);
            ElementFacts ws = Wall(); ws.Editable = false; ws.EditableReason = "OwnedByOtherUser";
            Assert.Contains(ActionPreconditions.Check(Set("Comments", "x"), Doc(), ws, null), ActionValidationCode.WORKSHARING_BLOCKED);
            ElementFacts lvl = Wall(); lvl.Category = "Levels";
            Assert.Contains(ActionPreconditions.Check(Set("Comments", "x"), Doc(), lvl, null), ActionValidationCode.PROHIBITED_CATEGORY);
            ElementFacts reused = Wall(); reused.UniqueId = "uid-OTHER";
            Assert.Contains(ActionPreconditions.Check(Set("Comments", "x"), Doc(), reused, null), ActionValidationCode.STALE_ACTION_PREVIEW);
        }

        [Test] public static void PinnedMove_Bounds_Zero()
        {
            Assert.Eq(0, ActionPreconditions.Check(Move(100), Doc(), Wall(), null).Count);
            ElementFacts p = Wall(); p.IsPinned = true;
            Assert.Contains(ActionPreconditions.Check(Move(100), Doc(), p, null), ActionValidationCode.ELEMENT_PINNED);
            Assert.Contains(ActionPreconditions.Check(Move(5000), Doc(), Wall(), null), ActionValidationCode.DELTA_OUT_OF_BOUNDS);
            Assert.Contains(ActionPreconditions.Check(Move(0), Doc(), Wall(), null), ActionValidationCode.VALUE_SCHEMA_INVALID);
            ElementFacts noLoc = Wall(); noLoc.HasPointOrCurveLocation = false;
            Assert.Contains(ActionPreconditions.Check(Move(100), Doc(), noLoc, null), ActionValidationCode.ELEMENT_NOT_EDITABLE);
        }

        [Test] public static void InvalidType_Incompatible_Same()
        {
            Assert.Eq(0, ActionPreconditions.Check(ChangeType(901), Doc(), Wall(), null).Count);
            Assert.Contains(ActionPreconditions.Check(ChangeType(555), Doc(), Wall(), null), ActionValidationCode.TYPE_INCOMPATIBLE);
            Assert.Contains(ActionPreconditions.Check(ChangeType(900), Doc(), Wall(), null), ActionValidationCode.VALUE_SCHEMA_INVALID);
            var bad = ChangeType(901); bad.Parameters["type_id"] = "abc";
            Assert.Contains(ActionPreconditions.Check(bad, Doc(), Wall(), null), ActionValidationCode.TYPE_NOT_FOUND);
        }

        [Test] public static void NormAuthorization_ReviewCandidateCannotAuthorize()
        {
            var issues = new List<RevitComplianceIssue>
            {
                new RevitComplianceIssue { IssueId = "i-rc", Class = IssueClass.REVIEW_CANDIDATE, Source = new IssueSource { Kind = RuleSourceKind.SYNTHETIC } },
                new RevitComplianceIssue { IssueId = "i-mq", Class = IssueClass.MODEL_QUALITY, Source = new IssueSource { Kind = RuleSourceKind.MODEL_QUALITY } },
                new RevitComplianceIssue { IssueId = "i-vn", Class = IssueClass.VERIFIED_NORM, Authoritative = true, Source = new IssueSource { Kind = RuleSourceKind.VERIFIED_NORM } },
            };
            var a = Set("Comments", "x"); a.Reason.IssueId = "i-rc";
            Assert.Contains(ActionPreconditions.Check(a, Doc(), Wall(), issues), ActionValidationCode.NORM_AUTHORIZATION_INSUFFICIENT);
            var b = Set("Comments", "x"); b.Reason.IssueId = "i-mq";
            Assert.Eq(0, ActionPreconditions.Check(b, Doc(), Wall(), issues).Count, "MODEL_QUALITY дэмжинэ (баталгаа хэвээр)");
            var c = Set("Comments", "x"); c.Reason.IssueId = "i-vn";
            Assert.Eq(0, ActionPreconditions.Check(c, Doc(), Wall(), issues).Count);
        }

        [Test] public static void Preview_Binds_And_StaleDetection()
        {
            RevitActionEnvelope a = Set("Comments", "MGL-AI тест");
            ElementFacts w = Wall("");
            ActionPreview pv = ActionPreviewBuilder.Build(a, Doc(), w, ActionPreconditions.Check(a, Doc(), w, null), T0);
            Assert.True(pv.Validation.Ok);
            Assert.NotNull(pv.BindingHash);
            Assert.Eq("Comments", pv.ParameterName);
            Assert.Eq("MGL-AI тест", pv.AfterValue);
            Assert.True(pv.LinesMn.Exists(l => l.StartsWith("Өмнө: «»")) && pv.LinesMn.Exists(l => l.StartsWith("Дараа: «MGL-AI тест»")));

            var ok = new ActionConfirmation { PreviewId = pv.PreviewId, BindingHash = pv.BindingHash, ConfirmedBy = "USER_UI" };
            Assert.Eq(0, ActionPreviewBuilder.VerifyConfirmation(pv, ok, Doc(), Wall(""), a, T0.AddMinutes(1)).Count);

            // 1. загварын хариу/хэрэгсэл баталгаа гэж тооцогдохгүй (§20)
            var notUser = new ActionConfirmation { PreviewId = pv.PreviewId, BindingHash = pv.BindingHash, ConfirmedBy = "MODEL" };
            Assert.Contains(ActionPreviewBuilder.VerifyConfirmation(pv, notUser, Doc(), Wall(""), a, T0.AddMinutes(1)), ActionValidationCode.NOT_CONFIRMED);
            // 2. буруу binding
            var wrong = new ActionConfirmation { PreviewId = pv.PreviewId, BindingHash = "deadbeef", ConfirmedBy = "USER_UI" };
            Assert.Contains(ActionPreviewBuilder.VerifyConfirmation(pv, wrong, Doc(), Wall(""), a, T0.AddMinutes(1)), ActionValidationCode.STALE_ACTION_PREVIEW);
            // 3. элемент preview-ийн дараа өөрчлөгдсөн (Comments өөр болсон)
            Assert.Contains(ActionPreviewBuilder.VerifyConfirmation(pv, ok, Doc(), Wall("хэн нэгэн зассан"), a, T0.AddMinutes(1)), ActionValidationCode.STALE_ACTION_PREVIEW);
            // 4. баримт өөрчлөгдсөн
            DocumentFacts d2 = Doc(); d2.Fingerprint = "docfp-2";
            Assert.Contains(ActionPreviewBuilder.VerifyConfirmation(pv, ok, d2, Wall(""), a, T0.AddMinutes(1)), ActionValidationCode.STALE_ACTION_PREVIEW);
            // 5. санал өөрчлөгдсөн (өөр утга)
            RevitActionEnvelope a2 = Set("Comments", "ӨӨР");
            Assert.Contains(ActionPreviewBuilder.VerifyConfirmation(pv, ok, Doc(), Wall(""), a2, T0.AddMinutes(1)), ActionValidationCode.STALE_ACTION_PREVIEW);
            // 6. хугацаа дууссан
            Assert.Contains(ActionPreviewBuilder.VerifyConfirmation(pv, ok, Doc(), Wall(""), a, T0.AddMinutes(11)), ActionValidationCode.PREVIEW_EXPIRED);
            // 7. элемент устсан
            Assert.Contains(ActionPreviewBuilder.VerifyConfirmation(pv, ok, Doc(), new ElementFacts { Exists = false }, a, T0.AddMinutes(1)), ActionValidationCode.ELEMENT_NOT_FOUND);
            // 8. шалгалт унасан preview-г батлах боломжгүй
            RevitActionEnvelope bad = Set("Area", "5");
            ActionPreview pvBad = ActionPreviewBuilder.Build(bad, Doc(), w, ActionPreconditions.Check(bad, Doc(), w, null), T0);
            Assert.False(pvBad.Validation.Ok);
            var okBad = new ActionConfirmation { PreviewId = pvBad.PreviewId, BindingHash = pvBad.BindingHash, ConfirmedBy = "USER_UI" };
            Assert.Contains(ActionPreviewBuilder.VerifyConfirmation(pvBad, okBad, Doc(), Wall(""), bad, T0.AddMinutes(1)), ActionValidationCode.PRECONDITION_FAILED);
        }

        [Test] public static void Postcondition_Mismatch_And_Match()
        {
            RevitActionEnvelope a = Set("Comments", "MGL-AI тест");
            ActionPreview pv = ActionPreviewBuilder.Build(a, Doc(), Wall(""), new List<ActionValidationCode>(), T0);
            string why;
            Assert.True(ActionPreviewBuilder.Postcondition(a, pv, Wall("MGL-AI тест"), out why));
            Assert.False(ActionPreviewBuilder.Postcondition(a, pv, Wall("өөр"), out why));
            Assert.True(why.Contains("таарсангүй"));

            RevitActionEnvelope m = Move(100);
            ActionPreview pm = ActionPreviewBuilder.Build(m, Doc(), Wall(), new List<ActionValidationCode>(), T0);
            Assert.Eq(5100.0, pm.AfterLocationMm[0]);
            ElementFacts moved = Wall(); moved.LocationMm = new[] { 5100.0, 8000.0, 0.0 };
            Assert.True(ActionPreviewBuilder.Postcondition(m, pm, moved, out why));
            ElementFacts notMoved = Wall();
            Assert.False(ActionPreviewBuilder.Postcondition(m, pm, notMoved, out why));

            RevitActionEnvelope t = ChangeType(901);
            ActionPreview pt = ActionPreviewBuilder.Build(t, Doc(), Wall(), new List<ActionValidationCode>(), T0);
            Assert.Eq("Generic - 200mm", pt.AfterTypeName);
            ElementFacts retyped = Wall(); retyped.TypeId = 901;
            Assert.True(ActionPreviewBuilder.Postcondition(t, pt, retyped, out why));
            Assert.False(ActionPreviewBuilder.Postcondition(t, pt, Wall(), out why));
        }

        [Test] public static void Audit_Serialization_SafeAndOrdered()
        {
            var audit = new ActionAudit(new NoDiskStoragePaths(), "test");
            ActionAuditRecord r1 = audit.Write(new ActionAuditRecord { Stage = "preview", ActionId = "act_set1", Action = RevitActionKind.SET_PARAMETER, ElementUniqueId = "uid-2786", Before = "", Proposed = "MGL-AI тест", RequestedBy = "USER" }, T0);
            ActionAuditRecord r2 = audit.Write(new ActionAuditRecord { Stage = "execute", ActionId = "act_set1", Executed = true, Result = "ROLLED_BACK", RollbackReason = "утга таарсангүй", PostValidation = "FAILED" }, T0.AddSeconds(3));
            Assert.Eq(1L, r1.Seq); Assert.Eq(2L, r2.Seq);
            string json = ActionAudit.Serialize(r2);
            Assert.True(json.Contains("\"result\":\"ROLLED_BACK\"") && json.Contains("\"rollback_reason\""));
            Assert.True(ActionAudit.LooksSafe(json));
            Assert.False(ActionAudit.LooksSafe("{\"x\":\"Bearer eyJabc\"}"));
            Assert.Null(audit.Path_);
        }

        [Test] public static void RollbackResult_Shape()
        {
            var ex = new ActionExecution { ActionId = "act_set1", PreviewId = "pv_x", Action = RevitActionKind.SET_PARAMETER, Status = ActionExecutionStatus.ROLLED_BACK, Verified = false, RollbackReason = "postcondition" };
            ex.Codes.Add(ActionValidationCode.POSTCONDITION_FAILED);
            string json = IntelligenceJson.Serialize(ex);
            Assert.True(json.Contains("\"status\":\"ROLLED_BACK\"") && json.Contains("POSTCONDITION_FAILED"));
        }
    }
}
