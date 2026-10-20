using System;
using System.Collections.Generic;
using System.Linq;
using RevitMcpAddin.ChangeImpact.Core;
using RevitMcpAddin.ClashCheck.Core;
using static RevitMcpAddin.Smart.Tests.PreChangeFixtures;

namespace RevitMcpAddin.Smart.Tests
{
    /// <summary>CEO харагдац: нэг шийдвэр, тэргүүн 3 үр дагавар, 5 карт, талбайн шилжилт, MEP, гарц — UI дүрэм ЦЭВЭР давхаргад.</summary>
    public static class PreChangeViewTests
    {
        private static PreChangeView View_(PreChangeReport r, FreshnessState f = FreshnessState.Fresh) { return PreChangeView.Build(r, f, false); }

        private static PreChangeReport TransferReport()
        {
            StateSnapshot b = Snap().WithRoom(Room(1, 24.8, true)).WithRoom(Room(2, 18.1, true, "101", "Коридор")).WithDim(Dim(10, 4200)).WithDim(Dim(11, 3000));
            StateSnapshot a = Snap().WithRoom(Room(1, 22.9)).WithRoom(Room(2, 20.0, false, "101", "Коридор")).WithDim(Dim(10, 3900)).WithDim(Dim(11, 2700));
            PreChangeDependencies deps = Deps(); deps.DimensionIds.AddRange(new long[] { 10, 11 });
            deps.Views.Add(View(20, "FloorPlan", 31)); deps.Sheets.Add(Sheet(31, "A-102")); deps.Sheets.Add(Sheet(32, "A-203")); deps.Sheets.Add(Sheet(33, "A-501"));
            return Run(b, a, deps);
        }

        /* ============================== ТЭРГҮҮН 3 ============================ */

        [Test]
        public static void TopConsequences_AreAtMostThree_AndReadableWithoutExpanding()
        {
            PreChangeView v = View_(TransferReport());
            Assert.True(v.Top.Count >= 1 && v.Top.Count <= 3);
            ConsequenceRow room = v.Top.First(x => x.Category == PreChangeCategory.Room);
            Assert.True(room.Before.Contains("м²") && room.After.Contains("м²") && room.Delta.Contains("м²"));
            Assert.True(v.Top.Any(x => x.Key == "dims" && x.After.StartsWith("2")));
        }

        [Test]
        public static void TopConsequences_BlockingFirst_ThenRoomsByLargestChange()
        {
            StateSnapshot b = Snap().WithRoom(Room(1, 24.8, true)).WithRoom(Room(2, 18.1, true, "101", "Коридор"));
            StateSnapshot a = Snap().WithRoom(Room(1, 22.9)).WithRoom(Room(2, 20.0, false, "101", "Коридор")).WithPair(Pair("D-03", ClashVerdict.ConfirmedClash));
            PreChangeView v = View_(Run(b, a));
            Assert.Eq(MoveVerdict.DoNotMove, v.Decision.Verdict);
            Assert.Eq(0, v.Top[0].Tier);
            Assert.Eq("MEP", v.Top[0].Label);
            Assert.Eq("+1 шинэ clash", v.Top[0].After);
            Assert.Eq(3, v.Top.Count);
        }

        [Test]
        public static void TopConsequences_Deterministic()
        {
            PreChangeReport r = TransferReport();
            string a = string.Join("|", View_(r).Top.Select(x => x.Label + x.After));
            r.Items.Reverse();
            Assert.Eq(a, string.Join("|", View_(r).Top.Select(x => x.Label + x.After)));
        }

        /* ============================== ТАЛБАЙН ШИЛЖИЛТ ===================== */

        [Test]
        public static void AreaRedistribution_Transfer_ShowsBothRows_NoTotal()
        {
            PreChangeAreaSummary s = View_(TransferReport()).Area;
            Assert.True(s.IsTransfer);
            Assert.Eq("Талбайн шилжилт", s.Title);
            Assert.Eq(2, s.Rows.Count);
            Assert.True(s.Rows[0].DeltaM2 > 0 && s.Rows[1].DeltaM2 < 0, "нэмэгдэж буй нь эхэнд");
            Assert.False(s.ShowTotal);
        }

        [Test]
        public static void AreaTotal_ExternalWall_ShowsEnclosedTotal_NeverSellable()
        {
            StateSnapshot b = Snap().WithRoom(Room(1, 24.8, true));
            StateSnapshot a = Snap().WithRoom(Room(1, 27.0));
            PreChangeAreaSummary s = View_(Run(b, a)).Area;
            Assert.True(s.ShowTotal);
            Assert.True(s.TotalText.StartsWith("Нийт хаалттай талбай: +2.20 м²"), s.TotalText);
            Assert.False(s.TotalText.ToLowerInvariant().Contains("борлуул"));
            Assert.False(s.IsTransfer);
        }

        [Test]
        public static void AreaTotal_OnlyFromSuccessfullyEvaluatedRooms()
        {
            RoomSnap bad = Room(2, 10); bad.Readable = false;
            StateSnapshot b = Snap().WithRoom(Room(1, 24.8, true)).WithRoom(bad);
            StateSnapshot a = Snap().WithRoom(Room(1, 27.0)).WithRoom(bad);
            PreChangeAreaSummary s = View_(Run(b, a)).Area;
            Assert.Eq(1, s.EvaluatedRooms);
            Assert.Eq(1, s.ExcludedRooms);
            Assert.Near(2.2, s.TotalDeltaM2, 0.001);
            Assert.True(s.TotalText.Contains("1 өрөө тооцоонд ороогүй"));
        }

        [Test]
        public static void AreaSummary_EnclosureLossRoom_IsExcludedFromTheTotal()
        {
            RoomSnap open = Room(2, 0); open.Enclosed = false;
            StateSnapshot b = Snap().WithRoom(Room(1, 24.8, true)).WithRoom(Room(2, 10));
            StateSnapshot a = Snap().WithRoom(Room(1, 27.0)).WithRoom(open);
            PreChangeAreaSummary s = View_(Run(b, a)).Area;
            Assert.Eq(1, s.EvaluatedRooms);
            Assert.Eq(1, s.ExcludedRooms);
        }

        [Test]
        public static void AreaSummary_NoChange_HasNoContent()
        {
            Assert.False(View_(Run(Snap().WithRoom(Room(1, 10)), Snap().WithRoom(Room(1, 10)))).Area.HasContent);
        }

        [Test]
        public static void AreaSummary_BlockedReport_IsEmpty()
        {
            var inp = Input(); inp.Outcome = SandboxOutcome.Blocked; inp.BlockReasons.Add("x");
            Assert.False(View_(PreChangeDiff.Compute(inp)).Area.HasContent);
        }

        /* ============================== 5 КАРТ, ЧИП, НОРМ =================== */

        [Test]
        public static void Cards_AreTheFiveSimpleOnes_InOrder()
        {
            PreChangeView v = View_(TransferReport());
            Assert.SeqEq(new[] { "rooms", "dimensions", "mep", "egress", "sheets" }, v.Cards.Select(c => c.Key));
        }

        [Test]
        public static void EgressCard_NeverConfigured_SaysNotConfigured_NotAFailure()
        {
            SummaryCard c = View_(Run()).Cards.First(x => x.Key == "egress");
            Assert.Eq("тохируулаагүй", c.Value);
            Assert.Eq(TruthState.NotEvaluated, c.Truth);
        }

        [Test]
        public static void QuickView_ShowsMepAndEgressAsPending()
        {
            PreChangeInput inp = Input(Snap().WithEgress(Route(1, 10)), Snap().WithEgress(Route(1, 10)));
            inp.Stage = AnalysisStage.Quick;
            PreChangeView v = View_(PreChangeDiff.Compute(inp));
            Assert.Eq("…", v.Cards.First(c => c.Key == "mep").Value);
            Assert.Eq("…", v.Cards.First(c => c.Key == "egress").Value);
            Assert.Eq(PreChangeView.StageProvisional, v.StageLabel);
        }

        [Test]
        public static void FinalView_StageLabelIsFinalTechnicalConclusion()
        {
            Assert.Eq("Эцсийн техникийн дүгнэлт", View_(Run()).StageLabel);
        }

        [Test]
        public static void NormIsAlwaysSeparate_AndNeverCountedAsAModelCheck()
        {
            PreChangeView v = View_(Run());
            Assert.True(v.Decision.NormLine.Contains("автомат шалгалт хийгдээгүй"));
            Assert.True(v.Decision.ModelLine.StartsWith("Моделийн нөлөөлөл"));
            Assert.True(v.Decision.Checks.Single(c => c.Separate).Key == "norm");
            Assert.Eq(1, v.Decision.Checks.Count(c => c.Separate));
            Assert.True(v.ModelOnlyNote.Contains("норм"));
        }

        /* ============================== MEP ================================= */

        [Test]
        public static void Mep_NewAndExistingAreStrictlySeparate_WithOnlyRealMetrics()
        {
            StateSnapshot b = Snap().WithPair(Pair("OLD", ClashVerdict.ConfirmedClash, 5));
            StateSnapshot a = Snap().WithPair(Pair("OLD", ClashVerdict.ConfirmedClash, 5)).WithPair(Pair("NEW", ClashVerdict.ConfirmedClash, 2400));
            PreChangeView v = View_(Run(b, a));
            Assert.Eq(1, v.MepNew.Count);
            Assert.Eq(1, v.MepExisting.Count);
            Assert.True(v.MepNew[0].IsNew && !v.MepExisting[0].IsNew);
            Assert.Eq("ШИНЭ CLASH", v.MepNew[0].Headline);
            Assert.True(v.MepNew[0].Metric.Contains("2400") && v.MepNew[0].Metric.Contains("см³"), v.MepNew[0].Metric);
            Assert.Eq("Хана", v.MepNew[0].Wall);
            Assert.True(v.MepNew[0].Other.Contains("NEW"));
            Assert.Null(v.MepExisting[0].Metric, "хуучин clash-д «шинэ» хэмжүүр үгүй");
        }

        [Test]
        public static void Mep_VolumeMissing_NoMetricInvented()
        {
            StateSnapshot a = Snap().WithPair(Pair("NEW", ClashVerdict.ConfirmedClash, 0));
            PreChangeView v = View_(Run(after: a));
            Assert.Null(v.MepNew[0].Metric);
            Assert.False(v.MepNew[0].VolumeCm3.HasValue);
        }

        /* ============================== ГАРЦ ================================ */

        [Test]
        public static void Egress_Configured_ShowsLengthAndDelta_WithExplanation()
        {
            PreChangeView v = View_(Run(Snap().WithEgress(Route(1, 28.4)), Snap().WithEgress(Route(1, 28.7))));
            EgressLine l = v.Egress.Single();
            Assert.Eq("28.40 м", l.Before); Assert.Eq("28.70 м", l.After); Assert.Eq("+0.30 м", l.Delta);
            Assert.Eq("Сонгосон гарц хүртэлх Revit Path of Travel. Нормын дээд зайтай тулгаагүй.", v.EgressNote);
        }

        [Test]
        public static void Egress_Lost_IsExplicit()
        {
            PreChangeView v = View_(Run(Snap().WithEgress(Route(1, 28.4)), Snap().WithEgress(Route(1, null))));
            Assert.True(v.Egress.Single().Lost);
            Assert.Eq("Гарцаас хүрэх зам тасарна", v.Egress.Single().Headline);
        }

        [Test]
        public static void Egress_NotConfigured_HasNoLinesAndNoExplanation()
        {
            PreChangeView v = View_(Run());
            Assert.Eq(0, v.Egress.Count);
            Assert.Null(v.EgressNote);
        }

        /* ============================== ЯАГААД? ============================= */

        [Test]
        public static void Why_ListsAllReasonsInDecisionOrder()
        {
            PreChangeView v = View_(TransferReport());
            Assert.SeqEq(v.Decision.ReviewReasons.Select(x => x.Text), v.Why.Select(x => x.Text));
        }

        [Test]
        public static void StaleView_DisablesApply_EvenWhenGreen()
        {
            Assert.False(View_(Run(), FreshnessState.Stale).Gate.PrimaryEnabled);
            Assert.False(View_(Run(), FreshnessState.Unknown).Gate.PrimaryEnabled);
            Assert.True(View_(Run(), FreshnessState.Fresh).Gate.PrimaryEnabled);
        }

        [Test]
        public static void BlockedReport_HasNoCardsButHasWhy()
        {
            var inp = Input(); inp.Outcome = SandboxOutcome.Blocked; inp.BlockReasons.Add("Locked dimension");
            PreChangeView v = View_(PreChangeDiff.Compute(inp));
            Assert.Eq(0, v.Cards.Count);
            Assert.Eq(1, v.Why.Count);
            Assert.True(v.Why[0].Text.Contains("Locked dimension"));
        }
    }
}
