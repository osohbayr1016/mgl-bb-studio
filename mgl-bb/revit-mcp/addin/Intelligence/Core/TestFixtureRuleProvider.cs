using RevitMcpAddin.Intelligence.Contracts;

namespace RevitMcpAddin.Intelligence.Core
{
    /// <summary>
    /// СИНТЕТИК ТЕСТ ДҮРМҮҮД — DEVELOPMENT / TEST ONLY · NON-REGULATORY.
    ///
    /// ⚠️ ЗӨВХӨН `is_test_fixture` (ProjectInformation.Name = MGL-AI-TEST …)
    ///    баримтад холбогдоно (`RevitIntelligenceHost.RulesFor`).  Компанийн
    ///    загварт ХЭЗЭЭ Ч үнэлэгдэхгүй.  Монголын нормын шаардлага БИШ —
    ///    provenance нь SYNTHETIC / NON_REGULATORY, олдвор нь REVIEW_CANDIDATE
    ///    (`BimExecutableRule.IssueClassOf`: SYNTHETIC → хэзээ ч VERIFIED_NORM биш).
    /// </summary>
    public sealed class TestFixtureRuleProvider : IBimRuleProvider
    {
        public string Name { get { return "SYNTHETIC_TEST_FIXTURE"; } }

        private static IssueSource Source(string label)
        {
            return new IssueSource
            {
                Kind = RuleSourceKind.SYNTHETIC,
                LabelMn = label,
                Verification = "SYNTHETIC_NON_REGULATORY",
                ProvenanceNote = "SYNTHETIC — NON_REGULATORY — TEST FIXTURE (" + TestModel.FixtureId + "). Нормын шаардлага БИШ.",
            };
        }

        public RuleProviderResult Load()
        {
            var r = new RuleProviderResult { Status = RuleProviderStatus.OK, Provider = Name, Note = "зөвхөн MGL-AI-TEST баримтад" };
            r.Rules.Add(new BimExecutableRule
            {
                RuleId = "synthetic.room_no_department",
                Source = Source("[СИНТЕТИК] Өрөө Department-гүй"),
                AppliesTo = new RuleApplicability { Kinds = { SceneNodeKind.ROOM } },
                RequiredInputs = { "flag:no_department" },
                Measurement = new RuleMeasurement { Measure = "flag:no_department", RequireAuthoritativeEdge = false },
                Predicate = new RulePredicate { Op = RulePredicateOp.FLAG_NOT_SET, Flag = "no_department" },
                Severity = IssueSeverity.LOW,
                TitleMn = "[СИНТЕТИК ТЕСТ] Өрөөнд Department ангилал алга",
                ExplanationKey = "synthetic.room_no_department",
            });
            r.Rules.Add(new BimExecutableRule
            {
                RuleId = "synthetic.wall_test_marker",
                Source = Source("[СИНТЕТИК] Хана тест тэмдэгтэй"),
                AppliesTo = new RuleApplicability { Kinds = { SceneNodeKind.WALL } },
                RequiredInputs = { "flag:test_marker" },
                Measurement = new RuleMeasurement { Measure = "flag:test_marker", RequireAuthoritativeEdge = false },
                Predicate = new RulePredicate { Op = RulePredicateOp.FLAG_NOT_SET, Flag = "test_marker" },
                Severity = IssueSeverity.INFO,
                TitleMn = "[СИНТЕТИК ТЕСТ] Хананы Comments-д тест тэмдэг байна",
                ExplanationKey = "synthetic.wall_test_marker",
            });
            return r;
        }
    }
}
