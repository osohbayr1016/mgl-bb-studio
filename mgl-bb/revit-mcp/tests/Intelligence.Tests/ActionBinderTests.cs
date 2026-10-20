using System.Collections.Generic;
using RevitMcpAddin.Intelligence.Contracts;
using RevitMcpAddin.Intelligence.Core;

namespace RevitMcpAddin.Intelligence.Tests
{
    /* ================================================================== */
    /*  R4.2 — RevitActionBinder: загварын ИТГЭМЖЛЭГДЭЭГҮЙ санал → envelope  */
    /*  ЗӨВХӨН хэрэглэгчийн хүсэлт + шинэ snapshot-оор үндэслэгдэнэ.         */
    /* ================================================================== */
    public static class ActionBinderTests
    {
        private static RevitContextSnapshot Snap(int selected = 1)
        {
            var s = new RevitContextSnapshot();
            for (int i = 0; i < selected; i++)
                s.Selection.Add(new RevitElementSummary { ElementId = 2786 + i, UniqueId = "uid-" + (2786 + i), Category = "Walls", Name = "Wall 1", Type = "Wall 1" });
            return s;
        }

        private static RevitActionCandidate Cand(string type, Dictionary<string, string> args, string reason = "загварын санал")
        {
            return new RevitActionCandidate { SchemaVersion = 1, ActionType = type, Target = new RevitActionCandidateTarget { Reference = "CURRENT_SELECTION" }, Arguments = args, ReasonMn = reason, Confidence = "high" };
        }

        [Test] public static void SetParameter_GroundedInRequest_Binds()
        {
            var c = Cand("SET_PARAMETER", new Dictionary<string, string> { { "parameter", "Comments" }, { "value", "AI санал тест" } });
            RevitActionBinder.BindResult r = RevitActionBinder.Bind(c, Snap(), "Энэ хананы Comments-ийг 'AI санал тест' болгож өөрчлөх санал гарга.", "doc1", null);
            Assert.True(r.Ok, string.Join(",", r.Codes));
            Assert.Eq(RevitActionKind.SET_PARAMETER, r.Envelope.Action);
            Assert.Eq(2786L, r.Envelope.TargetElementIds[0]);
            Assert.Eq("uid-2786", r.Envelope.TargetUniqueIds[0]);
            Assert.Eq("AI санал тест", r.Envelope.Parameters["value"]);
            Assert.Eq("MODEL", r.Envelope.RequestedBy.Kind);
            Assert.Eq(ProposalSource.MODEL, r.Envelope.ProposalSource);
            Assert.Eq(ActionSafetyLevel.CONFIRM_WRITE, r.Envelope.SafetyLevel);
            Assert.True(r.Envelope.Evidence.Exists(e => e.Kind == "SELECTION") && r.Envelope.Evidence.Exists(e => e.Kind == "USER_INPUT"));
        }

        [Test] public static void SetParameter_ValueNotInRequest_Rejected()
        {
            var c = Cand("SET_PARAMETER", new Dictionary<string, string> { { "parameter", "Comments" }, { "value", "Reviewed by AI" } });
            RevitActionBinder.BindResult r = RevitActionBinder.Bind(c, Snap(), "Энэ хананы Comments-ийг 'AI санал тест' болго.", "doc1", null);
            Assert.False(r.Ok);
            Assert.Contains(r.Codes, ActionValidationCode.CANDIDATE_NOT_GROUNDED_IN_REQUEST);
            var bad = Cand("SET_PARAMETER", new Dictionary<string, string> { { "parameter", "Area" }, { "value", "5" } });
            Assert.Contains(RevitActionBinder.Bind(bad, Snap(), "Area-г 5 болго", "doc1", null).Codes, ActionValidationCode.PARAMETER_NOT_FOUND);
            var extra = Cand("SET_PARAMETER", new Dictionary<string, string> { { "parameter", "Comments" }, { "value", "x" }, { "element_id", "2786" } });
            Assert.Contains(RevitActionBinder.Bind(extra, Snap(), "Comments-ийг x болго", "doc1", null).Codes, ActionValidationCode.UNKNOWN_PARAMETER_FOR_ACTION);
        }

        [Test] public static void Move_RequiresExplicitDistanceAndAxis()
        {
            var ok = Cand("MOVE_ELEMENT", new Dictionary<string, string> { { "dx_mm", "0" }, { "dy_mm", "100" }, { "dz_mm", "0" } });
            RevitActionBinder.BindResult r = RevitActionBinder.Bind(ok, Snap(), "Энэ ханыг Y чиглэлд 100 мм зөөх санал гарга.", "doc1", null);
            Assert.True(r.Ok, string.Join(",", r.Codes));
            Assert.Eq("100", r.Envelope.Parameters["dy_mm"]);
            Assert.Eq(ActionRiskLevel.MEDIUM, r.Envelope.RiskLevel);
            // «жаахан зөө» — тоо ч, чиглэл ч алга: загвар 100 гэж таамагласан ч ХАЯГДАНА
            var guess = Cand("MOVE_ELEMENT", new Dictionary<string, string> { { "dy_mm", "100" } });
            Assert.Contains(RevitActionBinder.Bind(guess, Snap(), "Энэ ханыг жаахан зөө.", "doc1", null).Codes, ActionValidationCode.INSUFFICIENT_ACTION_PARAMETERS);
            // чиглэл өөр (X гэсэн, санал Y)
            Assert.Contains(RevitActionBinder.Bind(ok, Snap(), "Энэ ханыг X чиглэлд 100 мм зөө.", "doc1", null).Codes, ActionValidationCode.INSUFFICIENT_ACTION_PARAMETERS);
            // хоёр тэнхлэг
            var two = Cand("MOVE_ELEMENT", new Dictionary<string, string> { { "dx_mm", "50" }, { "dy_mm", "100" } });
            Assert.Contains(RevitActionBinder.Bind(two, Snap(), "Y чиглэлд 100 мм", "doc1", null).Codes, ActionValidationCode.INSUFFICIENT_ACTION_PARAMETERS);
            // хязгаар
            var big = Cand("MOVE_ELEMENT", new Dictionary<string, string> { { "dy_mm", "5000" } });
            Assert.Contains(RevitActionBinder.Bind(big, Snap(), "Y чиглэлд 5000 мм зөө", "doc1", null).Codes, ActionValidationCode.DELTA_OUT_OF_BOUNDS);
        }

        [Test] public static void ChangeType_NameMustBeInRequest()
        {
            var c = Cand("CHANGE_TYPE", new Dictionary<string, string> { { "type_name", "MGL-AI-TEST Wall 1 Test Alt" } });
            Assert.True(RevitActionBinder.Bind(c, Snap(), "Энэ хананы төрлийг MGL-AI-TEST Wall 1 Test Alt болгож солино уу.", "doc1", null).Ok);
            Assert.Contains(RevitActionBinder.Bind(c, Snap(), "Энэ хананы төрлийг өөр болго.", "doc1", null).Codes, ActionValidationCode.CANDIDATE_NOT_GROUNDED_IN_REQUEST);
        }

        [Test] public static void Target_MustBeSingleCurrentSelection()
        {
            var c = Cand("SET_PARAMETER", new Dictionary<string, string> { { "parameter", "Comments" }, { "value", "x" } });
            Assert.Contains(RevitActionBinder.Bind(c, Snap(0), "Comments-ийг x болго", "doc1", null).Codes, ActionValidationCode.NO_TARGETS);
            Assert.Contains(RevitActionBinder.Bind(c, Snap(2), "Comments-ийг x болго", "doc1", null).Codes, ActionValidationCode.TARGET_AMBIGUOUS);
            c.Target.Reference = "wall 123";
            Assert.Contains(RevitActionBinder.Bind(c, Snap(), "Comments-ийг x болго", "doc1", null).Codes, ActionValidationCode.TARGET_NOT_GROUNDED);
        }

        [Test] public static void DisabledKinds_And_ModelCannotRaiseAuthority()
        {
            var del = Cand("DELETE_ELEMENT", new Dictionary<string, string>());
            Assert.Contains(RevitActionBinder.Bind(del, Snap(), "устга", "doc1", null).Codes, ActionValidationCode.WRITE_ACTION_DISABLED_IN_THIS_RELEASE);
            var c = Cand("SET_PARAMETER", new Dictionary<string, string> { { "parameter", "Comments" }, { "value", "x" } });
            RevitActionBinder.BindResult r = RevitActionBinder.Bind(c, Snap(), "Comments-ийг x болго", "doc1", null);
            // Загвар юу ч хэлсэн: safety_level CONFIRM_WRITE, requester MODEL, баталгаа ХЭЗЭЭ Ч энд байхгүй
            Assert.Eq(ActionSafetyLevel.CONFIRM_WRITE, r.Envelope.SafetyLevel);
            Assert.Eq(ProposalSource.MODEL, r.Envelope.ProposalSource);
            Assert.True(RevitActionValidator.Validate(r.Envelope).Ok && !RevitActionValidator.Validate(r.Envelope).ExecutableNow);
        }

        [Test] public static void NormFix_RequiresVerifiedNormIssue()
        {
            var c = Cand("SET_PARAMETER", new Dictionary<string, string> { { "parameter", "Comments" }, { "value", "зассан" } });
            var rc = new List<RevitComplianceIssue> { new RevitComplianceIssue { IssueId = "i1", Class = IssueClass.REVIEW_CANDIDATE, ElementIds = { 2786 }, Source = new IssueSource { Kind = RuleSourceKind.SYNTHETIC } } };
            RevitActionBinder.BindResult r = RevitActionBinder.Bind(c, Snap(), "Нормд тааруулж автоматаар зассан гэж тэмдэглэ.", "doc1", rc);
            Assert.Contains(r.Codes, ActionValidationCode.NORM_AUTHORIZATION_INSUFFICIENT);
            Assert.Null(r.Envelope);
            var vn = new List<RevitComplianceIssue> { new RevitComplianceIssue { IssueId = "i2", Class = IssueClass.VERIFIED_NORM, Authoritative = true, ElementIds = { 2786 }, Source = new IssueSource { Kind = RuleSourceKind.VERIFIED_NORM } } };
            Assert.True(RevitActionBinder.Bind(c, Snap(), "Нормд тааруулж зассан гэж тэмдэглэ.", "doc1", vn).Ok);
        }

        [Test] public static void Helpers_AxisAndMm()
        {
            Assert.True(RevitActionBinder.QuestionHasMm("Y чиглэлд 100 мм зөө", 100));
            Assert.False(RevitActionBinder.QuestionHasMm("жаахан зөө", 100));
            Assert.True(RevitActionBinder.QuestionHasAxis("Энэ ханыг Y чиглэлд 100 мм зөө", "y"));
            Assert.True(RevitActionBinder.QuestionHasAxis("move it 100 mm along Y", "y"));
            Assert.False(RevitActionBinder.QuestionHasAxis("Энэ ханыг 100 мм зөө", "y"));
            // кирилл «У»/«Х» ижил дүрстэй үсэг — тэнхлэг гэж танина; «у» гэсэн үгийн эхлэл биш
            Assert.True(RevitActionBinder.QuestionHasAxis("Энэ ханыг У чиглэлд 100 мм зөө", "y"));
            Assert.True(RevitActionBinder.QuestionHasAxis("Х тэнхлэгээр 50 мм", "x"));
            Assert.False(RevitActionBinder.QuestionHasAxis("Энэ ханыг урагш 100 мм зөө", "y"));
        }
    }
}
