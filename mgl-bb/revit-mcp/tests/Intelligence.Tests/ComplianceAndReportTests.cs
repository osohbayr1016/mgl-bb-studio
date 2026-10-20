using System;
using System.Collections.Generic;
using System.Linq;
using RevitMcpAddin.Intelligence.Contracts;
using RevitMcpAddin.Intelligence.Core;

namespace RevitMcpAddin.Intelligence.Tests
{
    /* ================================================================== */
    /*  НИЙЦЭЛ (§37–43, R-11, R-12, R-13)                                  */
    /* ================================================================== */
    public static class ComplianceTests
    {
        private static readonly DateTime T0 = new DateTime(2026, 9, 14, 8, 0, 0, DateTimeKind.Utc);

        [Test] public static void ProductionProvider_IsEmpty()
        {
            RuleProviderResult r = new ProductionBimRuleProvider().Load();
            Assert.Eq(RuleProviderStatus.NO_EXECUTABLE_BIM_RULES, r.Status);
            Assert.Eq(0, r.Rules.Count);
        }

        [Test] public static void ModelQuality_FindsUnenclosedRoomAndHostlessDoor()
        {
            SceneGraphStore g = SyntheticModel.Build(withGeometry: false);
            var rules = new ModelQualityRuleProvider().Load().Rules;
            EvaluationResult r = ComplianceEvaluator.Evaluate(g, g.Snapshot().Nodes.Select(n => n.ElementId), rules, T0);
            Assert.Eq(2, r.Issues.Count, string.Join(",", r.Issues.Select(i => i.IssueType)));
            foreach (RevitComplianceIssue i in r.Issues)
            {
                Assert.Eq(IssueClass.MODEL_QUALITY, i.Class);
                Assert.False(i.Authoritative);
                Assert.Eq(IssueStatus.OPEN, i.Status);
                Assert.Eq(RuleSourceKind.MODEL_QUALITY, i.Source.Kind);
            }
            Assert.True(r.Issues.Any(i => i.IssueType == "mq.room_not_enclosed" && i.ElementIds[0] == SyntheticModel.RoomB));
            Assert.True(r.Issues.Any(i => i.IssueType == "mq.opening_without_host" && i.ElementIds[0] == SyntheticModel.Door2));
            Assert.True(r.Passed.Count > 0);
        }

        [Test] public static void Synthetic_NumericRule_NeedsGeometryThenFails()
        {
            SceneGraphStore g = SyntheticModel.Build(withGeometry: false);
            var rules = new SyntheticFixtureRuleProvider().Load().Rules;
            EvaluationResult r1 = ComplianceEvaluator.Evaluate(g, new[] { SyntheticModel.Door1 }, rules, T0);
            Assert.Eq(0, r1.Issues.Count);
            Assert.True(r1.Skipped.Any(s => s.Reason == "needs_geometry"), "геометргүй бол шийдэхгүй");

            SyntheticModel.Enrich(g, SyntheticModel.Door1, new[] { UnitsBoundary.LengthMm("width_mm", 850 / UnitsBoundary.MmPerFoot, QuantitySource.TypedParam, SyntheticModel.LengthSpec) });
            EvaluationResult r2 = ComplianceEvaluator.Evaluate(g, new[] { SyntheticModel.Door1 }, rules, T0);
            Assert.Eq(1, r2.Issues.Count);
            RevitComplianceIssue i = r2.Issues[0];
            Assert.Eq(IssueClass.REVIEW_CANDIDATE, i.Class, "SYNTHETIC нь ХЭЗЭЭ Ч VERIFIED_NORM биш");
            Assert.Eq(IssueStatus.HUMAN_REVIEW_REQUIRED, i.Status);
            Assert.False(i.Authoritative);
            Assert.True(i.Source.ProvenanceNote.Contains("SYNTHETIC"));
            Assert.Near(850, i.Measured.Value, 0.01);
            Assert.Near(900, i.Required.Value, 0.01);
            Assert.True(i.DetailMn.Contains("850") && i.DetailMn.Contains("900"), i.DetailMn);
        }

        [Test] public static void RequiredRelation_ApproximateEdgeDoesNotCount()
        {
            SceneGraphStore g = SyntheticModel.Build();
            var rules = new SyntheticFixtureRuleProvider().Load().Rules.Where(r => r.RuleId == "synthetic.wall_bounds_room_min_length").ToList();
            // Wall2 (800 мм) нь Room A-г ЭРХ БҮХИЙ ирмэгээр хүрээлдэг → FAIL.
            EvaluationResult r = ComplianceEvaluator.Evaluate(g, new[] { SyntheticModel.Wall1, SyntheticModel.Wall2 }, rules, T0);
            Assert.Eq(1, r.Issues.Count);
            Assert.Eq(SyntheticModel.Wall2, r.Issues[0].ElementIds[0]);
            Assert.True(r.Issues[0].EvidenceEdges.All(k => k.Contains("ROOM_BOUNDARY")), "ойролцоолсон ирмэг нотолгоонд орохгүй");
            // Зөвхөн ойролцоолсон ирмэгтэй хана → үнэлэхгүй.
            g.RemoveEdges(SyntheticModel.Wall2, EdgeRelation.BOUNDS_ROOM);
            g.AddEdge(new SceneEdge { From = SyntheticModel.Wall2, To = SyntheticModel.RoomA, Relation = EdgeRelation.BOUNDS_ROOM, Source = EdgeSource.BOUNDING_BOX_APPROXIMATION, Confidence = EdgeConfidence.APPROXIMATE });
            EvaluationResult r2 = ComplianceEvaluator.Evaluate(g, new[] { SyntheticModel.Wall2 }, rules, T0);
            Assert.Eq(0, r2.Issues.Count);
            Assert.True(r2.Skipped.Any(s => s.Reason == "no_authoritative_relation"));
        }

        [Test] public static void VerifiedNorm_AuthoritativeOnlyWithAuthoritativeEdges()
        {
            SceneGraphStore g = SyntheticModel.Build();
            SyntheticModel.Enrich(g, SyntheticModel.Door1, new[] { UnitsBoundary.LengthMm("width_mm", 700 / UnitsBoundary.MmPerFoot, QuantitySource.TypedParam, SyntheticModel.LengthSpec) });
            var rules = new SyntheticFixtureRuleProvider { IncludeFakeVerified = true }.Load().Rules.Where(r => r.RuleId == "synthetic.fake_verified_norm").ToList();
            EvaluationResult r = ComplianceEvaluator.Evaluate(g, new[] { SyntheticModel.Door1 }, rules, T0);
            Assert.Eq(1, r.Issues.Count);
            Assert.Eq(IssueClass.VERIFIED_NORM, r.Issues[0].Class);
            Assert.True(r.Issues[0].Authoritative);
            Assert.Eq(IssueStatus.OPEN, r.Issues[0].Status);
            Assert.Eq("TEST-00-00", r.Issues[0].Source.DocumentCode);
        }

        [Test] public static void MixedUnits_BecomesReviewCandidate()
        {
            SceneGraphStore g = SyntheticModel.Build();
            SyntheticModel.Enrich(g, SyntheticModel.Door1, new[] { UnitsBoundary.FromQuantity("width_mm", Quantity.Of(0.85, "M", QuantitySource.BuiltinGeometry, null)) });
            var rules = new SyntheticFixtureRuleProvider().Load().Rules.Where(r => r.RuleId == "synthetic.door_min_width").ToList();
            EvaluationResult r = ComplianceEvaluator.Evaluate(g, new[] { SyntheticModel.Door1 }, rules, T0);
            Assert.Eq(1, r.Issues.Count);
            Assert.Eq(IssueStatus.HUMAN_REVIEW_REQUIRED, r.Issues[0].Status);
            Assert.True(r.Issues[0].IssueType.EndsWith(":mixed_units"));
            Assert.True(r.Skipped.Any(s => s.Reason == "mixed_units"));
        }

        [Test] public static void UntypedParam_NeverPassOrFail()
        {
            SceneGraphStore g = SyntheticModel.Build();
            SyntheticModel.Enrich(g, SyntheticModel.Door1, new[] { UnitsBoundary.Raw("width_mm", 850, null) });
            var rules = new SyntheticFixtureRuleProvider().Load().Rules.Where(r => r.RuleId == "synthetic.door_min_width").ToList();
            EvaluationResult r = ComplianceEvaluator.Evaluate(g, new[] { SyntheticModel.Door1 }, rules, T0);
            Assert.Eq(0, r.Passed.Count);
            Assert.True(r.Skipped.Any(s => s.Reason == "mixed_provenance"));
        }

        [Test] public static void IssueStore_ResolvesOnPassAndDelete()
        {
            SceneGraphStore g = SyntheticModel.Build(withGeometry: false);
            var rules = new ModelQualityRuleProvider().Load().Rules;
            var store = new IssueStore();
            IssueDelta d1 = store.Apply(ComplianceEvaluator.Evaluate(g, new[] { SyntheticModel.RoomB, SyntheticModel.Door2 }, rules, T0), T0);
            Assert.Eq(2, d1.Detected.Count);
            Assert.Eq(2, store.OpenCount);

            // Дахин үнэлэх — өөрчлөлтгүй → шинэ олдвор гарахгүй.
            IssueDelta d2 = store.Apply(ComplianceEvaluator.Evaluate(g, new[] { SyntheticModel.RoomB, SyntheticModel.Door2 }, rules, T0.AddMinutes(1)), T0.AddMinutes(1));
            Assert.Eq(0, d2.Detected.Count); Assert.Eq(2, d2.Unchanged);

            // Өрөө хаагдав → PASS → RESOLVED.
            SceneNode rb = g.Get(SyntheticModel.RoomB); rb.Flags = new List<string>(); g.Upsert(rb);
            IssueDelta d3 = store.Apply(ComplianceEvaluator.Evaluate(g, new[] { SyntheticModel.RoomB }, rules, T0.AddMinutes(2)), T0.AddMinutes(2));
            Assert.Eq(1, d3.Resolved.Count);
            Assert.Eq(IssueStatus.RESOLVED, d3.Resolved[0].Status);
            Assert.Eq(1, store.OpenCount);

            // Хаалга устгагдав → RESOLVED (dereference хийхгүй).
            var deleted = store.ResolveForDeleted(new[] { SyntheticModel.Door2 }, T0.AddMinutes(3));
            Assert.Eq(1, deleted.Count);
            Assert.Eq(0, store.OpenCount);
            Assert.Eq(2, store.All(includeResolved: true).Count);
        }

        [Test] public static void Pipeline_ChangeSetToIssue()
        {
            // R-13: ChangeSet → граф → дүрэм → олдвор — LLM-гүй.
            SceneGraphStore g = SyntheticModel.Build(withGeometry: false);
            var rules = new ModelQualityRuleProvider().Load().Rules;
            var store = new IssueStore();
            var cs = new RevitChangeSet { DocKey = SyntheticModel.DocKey };
            cs.Modified.Add(SyntheticModel.Door1);
            List<long> dirty = g.ApplyChangeSet(cs);
            // «Revit-ээс дахин уншив»: хаалганы хост алга болжээ.
            SceneNode d = g.Get(SyntheticModel.Door1); d.HostId = null; g.Upsert(d);
            g.RemoveEdges(SyntheticModel.Door1, EdgeRelation.HOSTED_BY);
            IssueDelta delta = store.Apply(ComplianceEvaluator.Evaluate(g, dirty, rules, T0), T0);
            Assert.Eq(1, delta.Detected.Count);
            Assert.Eq("mq.opening_without_host", delta.Detected[0].IssueType);
            Assert.Eq(SyntheticModel.Door1, delta.Detected[0].ElementIds[0]);
            Assert.True(delta.Detected[0].SceneVersion > 0);
            Assert.Eq(0, g.DirtyCount, "ApplyChangeSet-ийн дараа Upsert нь бохирдлыг арилгана");
        }

        [Test] public static void IssueJson_ClassIsExplicit()
        {
            SceneGraphStore g = SyntheticModel.Build(withGeometry: false);
            var rules = new ModelQualityRuleProvider().Load().Rules;
            RevitComplianceIssue i = ComplianceEvaluator.Evaluate(g, new[] { SyntheticModel.RoomB }, rules, T0).Issues[0];
            string json = IntelligenceJson.Serialize(i);
            Assert.True(json.Contains("\"issue_class\":\"MODEL_QUALITY\""));
            Assert.True(json.Contains("\"authoritative\":false"));
            Assert.True(json.Contains("\"schema_version\":1"));
        }
    }

    /* ================================================================== */
    /*  ТАЙЛАН (§33–36, R-8, R-18, R-19)                                    */
    /* ================================================================== */
    public static class ReportTests
    {
        private static readonly DateTime T0 = new DateTime(2026, 9, 14, 8, 0, 0, DateTimeKind.Utc);

        private static ActivityJournal Journal()
        {
            var j = new ActivityJournal(new NoDiskStoragePaths(), "sess1", null, T0);
            j.Log(JournalEventKind.SESSION_STARTED, "doc1", null, T0);
            j.Log(JournalEventKind.VIEW_CHANGED, "doc1", e => { e.ViewName = "Level 1 - Plan"; e.LevelName = "Level 1"; }, T0.AddMinutes(1));
            j.Log(JournalEventKind.CHANGESET, "doc1", e =>
            {
                e.Added = 3; e.Modified = 174; e.Deleted = 1;
                e.CategoryCounts = new Dictionary<string, int[]> { { "Walls", new[] { 0, 174, 0 } }, { "Doors", new[] { 3, 0, 1 } } };
            }, T0.AddMinutes(20));
            j.Log(JournalEventKind.TASK_SELECTED, "doc1", e => e.TaskId = 7, T0.AddMinutes(25));
            j.Log(JournalEventKind.ISSUE_DETECTED, "doc1", e => { e.IssueId = "i1"; e.IssueClass = IssueClass.MODEL_QUALITY; }, T0.AddMinutes(30));
            return j;
        }

        private static RevitReportEvidence Evidence(ActivityJournal j)
        {
            var tasks = new RevitTaskContext { Status = TaskContextStatus.OK, FetchedAt = T0.ToString("o") };
            tasks.Tasks.Add(new RevitTaskItem { TaskId = 7, Title = "1-р давхрын хаалгануудыг шалгах", ChecklistDone = 2, ChecklistTotal = 5 });
            var cands = new List<TaskCandidateSet> { new TaskCandidateSet { TaskId = 7, ElementIds = { 1, 2, 3 }, ReviewedIds = { 1 } } };
            var issues = new List<RevitComplianceIssue>
            {
                new RevitComplianceIssue { IssueId = "i1", Class = IssueClass.MODEL_QUALITY, TitleMn = "Хаалга хостгүй", Status = IssueStatus.OPEN, DetectedAt = T0.AddMinutes(30).ToString("o") },
            };
            return ReportEvidenceBuilder.Build(ReportPeriodKind.THIS_SESSION, T0, T0.AddHours(1), j.Read(),
                new RevitDocumentContext { DocKey = "doc1", Title = "Хүй 7.rvt" },
                new RevitProjectLink { State = ProjectLinkState.CONFIRMED, ProjectId = 30, ProjectName = "Хүй 7 сургууль", ConfirmedAt = T0.ToString("o") },
                tasks, cands, issues);
        }

        [Test] public static void Evidence_EveryFactHasSource()
        {
            RevitReportEvidence ev = Evidence(Journal());
            Assert.True(ev.Facts.Count >= 10, "facts " + ev.Facts.Count);
            foreach (ReportFact f in ev.Facts) Assert.NotNull(f.ObservedAt, f.Kind.ToString());
            Assert.True(ev.Facts.Any(f => f.Kind == ReportFactKind.SESSION_DURATION_MIN && f.Number == 60));
            Assert.True(ev.Facts.Any(f => f.Kind == ReportFactKind.ELEMENTS_MODIFIED && f.Number == 174 && f.IsElementCount));
            Assert.True(ev.Facts.Any(f => f.Kind == ReportFactKind.PROGRESS_ESTIMATE && f.Value == "PROGRESS_ESTIMATE_UNAVAILABLE"));
            Assert.Eq(0, ev.Gaps.Count);
        }

        [Test] public static void ManagerReport_HasNoElementCounts()
        {
            RevitReport r = ReportRenderer.Render(Evidence(Journal()), ReportAudience.MANAGER_REPORT);
            string text = string.Join("\n", r.LinesMn);
            Assert.False(text.Contains("174"), text);
            Assert.False(text.Contains("Нэмсэн элемент"), text);
            Assert.True(text.Contains("Ажилласан хэсэг: Walls, Doors"), text);
            Assert.True(text.Contains("Даалгавар: 1-р давхрын"), text);
            Assert.True(text.Contains("явц: тооцоолоогүй"), "R-9");
            Assert.False(text.Contains("боломжит элементээс"), "менежерт кандидатын тоо ч орохгүй");
            // Мөр бүр баримттай (алдааны мөрөөс бусад).
            Assert.Eq(r.LinesMn.Count, r.LineFacts.Count);
            for (int i = 0; i < r.LinesMn.Count; i++)
                Assert.True(r.LineFacts[i].Count > 0 || r.LinesMn[i].StartsWith("⚠"), r.LinesMn[i]);
        }

        [Test] public static void SelfReport_HasCountsAndReview()
        {
            RevitReport r = ReportRenderer.Render(Evidence(Journal()), ReportAudience.TECHNICAL_SELF_REPORT);
            string text = string.Join("\n", r.LinesMn);
            Assert.True(text.Contains("Зассан элемент: 174"), text);
            Assert.True(text.Contains("3 боломжит элементээс 1-г шалгасан"), text);
            Assert.True(text.Contains("Илэрсэн: Хаалга хостгүй [загварын чанар]"), text);
            Assert.True(text.Contains("Нээлттэй асуудал: 1"), text);
            Assert.Eq("DETERMINISTIC", r.Rendering);
            Assert.True(r.PreviewOnly);
        }

        [Test] public static void Gaps_AreExplicitNotSilent()
        {
            var j = new ActivityJournal(new NoDiskStoragePaths(), "s", null, T0);
            RevitReportEvidence ev = ReportEvidenceBuilder.Build(ReportPeriodKind.TODAY, T0, T0.AddHours(1), j.Read(), null, null, null, null, null);
            Assert.Contains(ev.Gaps, "PROJECT_NOT_LINKED");
            Assert.Contains(ev.Gaps, "NO_CHANGESETS");
            Assert.Contains(ev.Gaps, "ERP_OFFLINE");
            RevitReport r = ReportRenderer.Render(ev, ReportAudience.MANAGER_REPORT);
            Assert.True(r.LinesMn.Any(l => l.StartsWith("⚠") && l.Contains("ERP хүрэхгүй")));
            Assert.False(string.Join("\n", r.LinesMn).Contains("асуудал олдсонгүй"));
        }

        [Test] public static void WordingInstruction_ForbidsNewFacts()
        {
            RevitReport r = ReportRenderer.Render(Evidence(Journal()), ReportAudience.TEAM_TASK_REPORT);
            string ins = ReportRenderer.WordingInstructionMn(r);
            Assert.True(ins.Contains("Шинэ тоо, шинэ баримт"));
            Assert.True(ins.Split('\n').Count(l => l.StartsWith("- ")) == r.LinesMn.Count);
        }

        [Test] public static void Journal_TruncatesIdsAndFilters()
        {
            var j = new ActivityJournal(new NoDiskStoragePaths(), "s", null, T0);
            j.Log(JournalEventKind.ISSUE_DETECTED, "doc1", e => e.ElementIds = Enumerable.Range(0, 200).Select(i => (long)i).ToList(), T0);
            j.Log(JournalEventKind.VIEW_CHANGED, "doc2", null, T0.AddMinutes(5));
            Assert.Eq(50, j.Read()[0].ElementIds.Count);
            Assert.Eq(1, j.Read(docKey: "doc2").Count);
            Assert.Eq(1, j.Read(fromUtc: T0.AddMinutes(1)).Count);
            Assert.Eq(1L, j.Read()[0].Seq);
        }
    }

    /* ================================================================== */
    /*  ИРЭЭДҮЙН ҮЙЛДЭЛ (§46–49)                                           */
    /* ================================================================== */
    public static class ActionEnvelopeTests
    {
        private static RevitActionEnvelope Env(RevitActionKind k)
        {
            return new RevitActionEnvelope
            {
                ActionId = "a1", DocKey = "doc1", Action = k, TargetElementIds = { 301 },
                Reason = new ActionReason { SummaryMn = "тест" }, RequestedBy = new ActionRequester { Kind = "USER" },
            };
        }

        [Test] public static void WriteActions_EnabledKindsNeedConfirmation_OthersDisabled()
        {
            // R4.1: MOVE/SET_PARAMETER/CHANGE_TYPE нь схемийн хувьд OK, гэвч ХЭЗЭЭ Ч «одоо гүйцэтгэх» биш (preview + баталгаа).
            ActionValidation v = RevitActionValidator.Validate(Env(RevitActionKind.MOVE_ELEMENT));
            Assert.True(v.Ok);
            Assert.False(v.ExecutableNow);
            Assert.False(v.Codes.Contains(ActionValidationCode.WRITE_ACTION_DISABLED_IN_THIS_RELEASE));
            // DELETE / CREATE_WALL хаалттай ХЭВЭЭР (§12).
            foreach (RevitActionKind k in new[] { RevitActionKind.DELETE_ELEMENT, RevitActionKind.CREATE_WALL, RevitActionKind.CREATE_FLOOR, RevitActionKind.PLACE_DOOR, RevitActionKind.PLACE_WINDOW })
            {
                ActionValidation d = RevitActionValidator.Validate(Env(k));
                Assert.Contains(d.Codes, ActionValidationCode.WRITE_ACTION_DISABLED_IN_THIS_RELEASE, k.ToString());
                Assert.False(d.ExecutableNow);
            }
        }

        [Test] public static void Navigation_IsExecutable()
        {
            ActionValidation v = RevitActionValidator.Validate(Env(RevitActionKind.SHOW_ELEMENT));
            Assert.True(v.Ok && v.ExecutableNow);
            Assert.Eq(ActionValidationCode.OK, v.Codes[0]);
        }

        [Test] public static void CodeLikeParameter_Rejected()
        {
            RevitActionEnvelope e = Env(RevitActionKind.SET_PARAMETER);
            e.Parameters["value"] = "new Transaction(doc); doc.Delete(id);";
            ActionValidation v = RevitActionValidator.Validate(e);
            Assert.Contains(v.Codes, ActionValidationCode.PARAMETER_VALUE_LOOKS_LIKE_CODE);
            Assert.False(v.Ok);
            RevitActionEnvelope e2 = Env(RevitActionKind.SET_PARAMETER);
            e2.Parameters["bogus"] = "1";
            Assert.Contains(RevitActionValidator.Validate(e2).Codes, ActionValidationCode.UNKNOWN_PARAMETER_FOR_ACTION);
        }

        [Test] public static void SafetyLevel_CappedAtConfirmWrite()
        {
            RevitActionEnvelope e = Env(RevitActionKind.SHOW_ELEMENT);
            e.SafetyLevel = ActionSafetyLevel.SAFE_AUTOFIX;
            Assert.Contains(RevitActionValidator.Validate(e).Codes, ActionValidationCode.SAFETY_LEVEL_EXCEEDS_SESSION_MAX);
            e.SafetyLevel = ActionSafetyLevel.AUTONOMOUS_SANDBOX;
            Assert.Contains(RevitActionValidator.Validate(e).Codes, ActionValidationCode.SAFETY_LEVEL_EXCEEDS_SESSION_MAX);
            Assert.Eq(ActionSafetyLevel.CONFIRM_WRITE, ActionSafety.MaxLevel);
        }

        [Test] public static void LinkedElement_NotWritable()
        {
            var known = new Dictionary<long, SceneNode> { { 301, new SceneNode { ElementId = 301, Scope = ElementScope.LINKED_DOCUMENT } } };
            Assert.Contains(RevitActionValidator.Validate(Env(RevitActionKind.MOVE_ELEMENT), known).Codes, ActionValidationCode.LINKED_ELEMENT_NOT_WRITABLE);
            Assert.False(RevitActionValidator.Validate(Env(RevitActionKind.SHOW_ELEMENT), known).Codes.Contains(ActionValidationCode.LINKED_ELEMENT_NOT_WRITABLE));
        }

        [Test] public static void MissingFields_Reported()
        {
            var v = RevitActionValidator.Validate(new RevitActionEnvelope { Action = RevitActionKind.MOVE_ELEMENT });
            Assert.Contains(v.Codes, ActionValidationCode.MISSING_ACTION_ID);
            Assert.Contains(v.Codes, ActionValidationCode.MISSING_DOC_KEY);
            Assert.Contains(v.Codes, ActionValidationCode.TARGETS_REQUIRED_FOR_MOVE);
            Assert.Contains(v.Codes, ActionValidationCode.MISSING_REASON);
            Assert.Contains(v.Codes, ActionValidationCode.MISSING_REQUESTER);
        }
    }
}
