using System;
using System.Collections.Generic;
using RevitMcpAddin.ChangeImpact.Core;
using static RevitMcpAddin.Smart.Tests.PreChangeFixtures;

namespace RevitMcpAddin.Smart.Tests
{
    /// <summary>Цонхны ажлын урсгалын цэвэр дүрэм: зайн товч, сүүдрийн өнгө, төлөвийн мөр, сонголт өөрчлөгдсөн эсэх.</summary>
    public static class PreChangeWorkflowTests
    {
        private static MoveDecision Dec(MoveVerdict v, AnalysisStage st = AnalysisStage.Full, bool pending = false)
        {
            return new MoveDecision { Verdict = v, Stage = st, IsPending = pending };
        }

        [Test]
        public static void ChipDistances_AreTheFiveAgreedValues_AndDefaultIsAChip()
        {
            Assert.Eq(5, PreChangeWorkflow.ChipDistances.Length);
            Assert.Eq(100, PreChangeWorkflow.ChipDistances[0]);
            Assert.Eq(1000, PreChangeWorkflow.ChipDistances[4]);
            Assert.True(PreChangeWorkflow.ChipIndexOf(PreChangeWorkflow.DefaultDistanceMm) >= 0);
        }

        [Test]
        public static void ChipIndexOf_MatchesOnlyExactChipValues()
        {
            Assert.Eq(2, PreChangeWorkflow.ChipIndexOf(300));
            Assert.Eq(-1, PreChangeWorkflow.ChipIndexOf(250));
            Assert.Eq(-1, PreChangeWorkflow.ChipIndexOf(null));
            Assert.Eq(0, PreChangeWorkflow.ChipIndexOf(PreChangeRequestRules.ParseDistanceMm("0,1 м")));
        }

        [Test]
        public static void ToneFor_FollowsVerdict_OnlyWhenFinal()
        {
            Assert.Eq(ApplyTone.Green, PreChangeWorkflow.ToneFor(Dec(MoveVerdict.MoveOk)));
            Assert.Eq(ApplyTone.Amber, PreChangeWorkflow.ToneFor(Dec(MoveVerdict.MoveWithReview)));
            Assert.Eq(ApplyTone.Red, PreChangeWorkflow.ToneFor(Dec(MoveVerdict.DoNotMove)));
            Assert.Eq(ApplyTone.Gray, PreChangeWorkflow.ToneFor(Dec(MoveVerdict.Unknown)));
        }

        [Test]
        public static void ToneFor_QuickOrPendingOrMissing_IsGray_NeverGreen()
        {
            Assert.Eq(ApplyTone.Gray, PreChangeWorkflow.ToneFor(Dec(MoveVerdict.MoveOk, AnalysisStage.Quick, true)));
            Assert.Eq(ApplyTone.Gray, PreChangeWorkflow.ToneFor(Dec(MoveVerdict.MoveOk, AnalysisStage.Full, true)));
            Assert.Eq(ApplyTone.Gray, PreChangeWorkflow.ToneFor(Dec(MoveVerdict.MoveOk, AnalysisStage.Quick, false)));
            Assert.Eq(ApplyTone.Gray, PreChangeWorkflow.ToneFor(null));
        }

        [Test]
        public static void StatusLine_JoinsChipTexts_AndKeepsNormSeparateWording()
        {
            var d = new MoveDecision
            {
                Checks = new List<CheckChip>
                {
                    new CheckChip { Key = "rooms", Text = "Өрөө ✓" },
                    new CheckChip { Key = "dimensions", Text = "Хэмжээс ✓" },
                    new CheckChip { Key = "mep", Text = "MEP ✓" },
                    new CheckChip { Key = "egress", Text = "Гарц — тохируулаагүй" },
                    new CheckChip { Key = "sheets", Text = "Хуудас 2" },
                    new CheckChip { Key = "norm", Text = "Норм — шалгаагүй", Separate = true },
                },
            };
            Assert.Eq("Өрөө ✓ Хэмжээс ✓ MEP ✓ Гарц — тохируулаагүй Норм — шалгаагүй", PreChangeWorkflow.StatusLine(d));
            Assert.Eq("", PreChangeWorkflow.StatusLine(null));
            Assert.Eq("", PreChangeWorkflow.StatusLine(new MoveDecision()));
        }

        [Test]
        public static void StatusLine_ForARealReport_HasRoomsDimensionsMepEgressSheetsAndSeparateNorm()
        {
            StateSnapshot b = Snap().WithRoom(Room(1, 24.8, true));
            StateSnapshot a = Snap().WithRoom(Room(1, 24.8));
            PreChangeReport r = Run(b, a);
            string line = PreChangeWorkflow.StatusLine(PreChangeDecisionEngine.Decide(r));
            Assert.True(line.Contains("Өрөө") && line.Contains("Хэмжээс") && line.Contains("MEP") && line.Contains("Гарц") && line.Contains("Норм"), line);
            Assert.True(line.Contains("Гарц — тохируулаагүй"), "гарц тохируулаагүй нь алдаа биш — ил хэлнэ: " + line);
            Assert.True(line.EndsWith("Норм — шалгаагүй"), "норм ТУСДАА, эцэст: " + line);
            Assert.Eq("Өрөө ✓ Хэмжээс ✓ MEP ✓ Гарц — тохируулаагүй Норм — шалгаагүй", line);
        }

        [Test]
        public static void StatusLine_WithoutAReport_IsEmpty()
        {
            Assert.Eq("", PreChangeWorkflow.StatusLine(PreChangeDecisionEngine.Decide(null)));
        }

        [Test]
        public static void SelectionChanged_OnlyForADifferentValidWall()
        {
            var a = new PreChangeSelection { Valid = true, SourceId = 1, SourceUid = "u1" };
            var a2 = new PreChangeSelection { Valid = true, SourceId = 1, SourceUid = "u1" };
            var b = new PreChangeSelection { Valid = true, SourceId = 2, SourceUid = "u2" };
            var bad = PreChangeSelection.Invalid("хана биш");
            Assert.False(PreChangeWorkflow.SelectionChanged(a, a2), "ижил хана");
            Assert.True(PreChangeWorkflow.SelectionChanged(a, b), "өөр хана");
            Assert.False(PreChangeWorkflow.SelectionChanged(a, bad), "хүчингүй сонголт preview-г алдуулахгүй");
            Assert.False(PreChangeWorkflow.SelectionChanged(a, null));
            Assert.True(PreChangeWorkflow.SelectionChanged(null, b), "анхны сонголт");
            Assert.True(PreChangeWorkflow.SelectionChanged(bad, b));
        }
    }
}
