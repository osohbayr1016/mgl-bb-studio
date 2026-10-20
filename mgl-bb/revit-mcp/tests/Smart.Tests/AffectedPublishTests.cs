using System;
using System.Collections.Generic;
using System.Linq;
using RevitMcpAddin.ChangeImpact.Core;
using RevitMcpAddin.Smart.Core;
using RevitMcpAddin.SmartPublish.Core;

namespace RevitMcpAddin.Smart.Tests
{
    public static class AffectedPublishTests
    {
        private const string G = "guid-1";

        private static PublishItem Sheet(string uid, long id, string number)
        {
            return new PublishItem { Id = uid, ElementIdValue = id, Kind = PublishItemKind.Sheet, Number = number, Name = "Sheet " + number };
        }

        private static ImpactItem Hit(long id, string uid, ImpactConfidence c, string reason = "шалтгаан")
        {
            return new ImpactItem { Id = id, Uid = uid, Kind = ImpactNodeKind.Sheet, Name = "S", Confidence = c, Reason = reason, SourceLabel = "Хана #1", Relationship = "rel" };
        }

        private static WatermarkAnalysis Analysis(long watermark, params ImpactItem[] items)
        {
            var r = new ImpactReport { SourceCount = 5, Status = RunStatus.Succeeded };
            r.Items.AddRange(items);
            return new WatermarkAnalysis { Watermark = watermark, Report = r };
        }

        private static Dictionary<string, SheetCheckpoint> Cps(params KeyValuePair<string, SheetCheckpoint>[] kv)
        {
            return kv.ToDictionary(x => x.Key, x => x.Value);
        }

        private static KeyValuePair<string, SheetCheckpoint> Cp(string uid, long seq, string guid = G, bool partial = false)
        {
            return new KeyValuePair<string, SheetCheckpoint>(uid, new SheetCheckpoint { ChangeSeq = seq, DocVersionGuid = guid, PublishedUtc = DateTime.UtcNow, Partial = partial });
        }

        /* --------------------------- WATERMARK PLAN ----------------------- */

        [Test]
        public static void Watermarks_FewDistinctValues_AreAllKept_Sorted()
        {
            Assert.SeqEq(new long[] { 0, 5, 9 }, AffectedPublishResolver.PlanWatermarks(new long[] { 9, 0, 5, 5, 9 }));
            Assert.Eq(0, AffectedPublishResolver.PlanWatermarks(new long[0]).Count);
        }

        [Test]
        public static void Watermarks_ManyValues_AreBucketed_WithoutLosingOldestBound()
        {
            var wm = Enumerable.Range(1, 40).Select(i => (long)i * 10).ToList();
            List<long> groups = AffectedPublishResolver.PlanWatermarks(wm, 3);
            Assert.Eq(3, groups.Count);
            Assert.Eq(10L, groups.First(), "хамгийн эртний watermark үргэлж орно");
            // Хуудас бүр ӨӨРИЙН watermark-аас эртний (≤) эхлэлтэй шинжилгээнд хамрагдана — алдагдах өөрчлөлт БАЙХГҮЙ.
            foreach (long w in wm) Assert.True(groups.Any(g => g <= w), "watermark " + w + " хамрагдаагүй");
            Assert.Eq(1, AffectedPublishResolver.PlanWatermarks(wm, 1).Count);
        }

        [Test]
        public static void Buckets_CarryTheVersionGuidOfTheirCheckpoint_ForBaselineDiff()
        {
            var cps = new[]
            {
                Cp("a", 100, "guid-A").Value, Cp("b", 100, null).Value, Cp("c", 300, "guid-C").Value, Cp("d", 200, "guid-D").Value,
            };
            List<WatermarkBucket> b = AffectedPublishResolver.PlanBuckets(cps, 3);
            Assert.SeqEq(new long[] { 100, 200, 300 }, b.Select(x => x.Seq));
            Assert.Eq("guid-A", b[0].VersionGuid, "ижил дугаартай checkpoint-ийн мэдэгдэж буй GUID");
            Assert.Eq("guid-D", b[1].VersionGuid);

            // Хэт олон бол хамгийн эртний нь үргэлж орно ба GUID нь тэр checkpoint-ийнх.
            var many = Enumerable.Range(1, 30).Select(i => Cp("s" + i, i * 10, "g" + i).Value).ToList();
            List<WatermarkBucket> few = AffectedPublishResolver.PlanBuckets(many, 2);
            Assert.Eq(2, few.Count);
            Assert.Eq(10L, few[0].Seq);
            Assert.Eq("g1", few[0].VersionGuid);
            Assert.Eq(0, AffectedPublishResolver.PlanBuckets(null).Count);
        }

        /* ------------------------------ ANGILAL --------------------------- */

        [Test]
        public static void Resolve_NeverPublishedSheet_IsFlagged_NotAssumedUpToDate()
        {
            var items = new List<PublishItem> { Sheet("u1", 1, "A-101") };
            AffectedPublishSet set = AffectedPublishResolver.Resolve(items, Cps(), new List<WatermarkAnalysis>(), null);
            Assert.Eq(AffectState.NeverPublished, set.Get("u1").State);
            Assert.True(set.AffectedIds().Contains("u1"), "«нөлөөлөгдсөн» сонголтод орно (суурь байхгүй)");
        }

        [Test]
        public static void Resolve_PartiallyPublishedSheet_IsTreatedLikeNeverPublished()
        {
            // Профайлын DWG хараахан гараагүй — PDF-ийн checkpoint «бүрэн гарсан» гэсэн үг БИШ.
            var items = new List<PublishItem> { Sheet("u1", 1, "A-101") };
            AffectedPublishSet set = AffectedPublishResolver.Resolve(items, Cps(Cp("u1", 50, G, partial: true)), new[] { Analysis(50) }, G);
            Assert.Eq(AffectState.NeverPublished, set.Get("u1").State);
            Assert.True(set.Get("u1").Reasons[0].Contains("формат"));
            Assert.True(set.AffectedIds().Contains("u1"));
        }

        [Test]
        public static void Resolve_DirectHit_IsAffected_AndWeakHit_IsOnlySuggested()
        {
            var items = new List<PublishItem> { Sheet("u1", 1, "A-101"), Sheet("u2", 2, "A-201"), Sheet("u3", 3, "A-301") };
            var cps = Cps(Cp("u1", 100), Cp("u2", 100), Cp("u3", 100));
            WatermarkAnalysis an = Analysis(100, Hit(1, "u1", ImpactConfidence.A, "view-specific"), Hit(2, "u2", ImpactConfidence.C, "магадгүй харагдана"));
            AffectedPublishSet set = AffectedPublishResolver.Resolve(items, cps, new[] { an }, G);

            Assert.Eq(AffectState.Affected, set.Get("u1").State);
            Assert.Eq(AffectState.Suggested, set.Get("u2").State, "C нь автоматаар «нөлөөлөгдсөн» БОЛОХГҮЙ");
            Assert.Eq(ImpactConfidence.C, set.Get("u2").Confidence);
            Assert.False(set.AffectedIds().Contains("u2"));
            Assert.True(set.SuggestedIds().Contains("u2"), "гэхдээ чимээгүй хасагдахгүй — санал болгоно");
            Assert.True(set.Get("u1").Reasons[0].Contains("view-specific"));
            Assert.Eq(AffectState.NoImpactFound, set.Get("u3").State);
            Assert.False(set.AffectedIds().Contains("u3") || set.SuggestedIds().Contains("u3"));
        }

        [Test]
        public static void Resolve_StrongestOfSeveralHits_Wins_AndMatchesByUidWhenIdUnknown()
        {
            var items = new List<PublishItem> { Sheet("u1", 0, "A-101") };            // ElementIdValue тодорхойгүй
            var an = Analysis(0, Hit(99, "u1", ImpactConfidence.D), Hit(98, "u1", ImpactConfidence.B), Hit(97, "u1", ImpactConfidence.C));
            AffectedPublishSet set = AffectedPublishResolver.Resolve(items, Cps(Cp("u1", 5)), new[] { an }, G);
            Assert.Eq(AffectState.Suggested, set.Get("u1").State);
            Assert.Eq(ImpactConfidence.B, set.Get("u1").Confidence, "хамгийн хүчтэй нь");
            Assert.True(set.Get("u1").Reasons.Count <= 3);
        }

        [Test]
        public static void Resolve_NoImpact_ButCaveats_IsNeverClaimedUnchanged()
        {
            var items = new List<PublishItem> { Sheet("u1", 1, "A-101") };
            var cps = Cps(Cp("u1", 10));

            // «БҮРЭН БИШ» (шалтгаантай) — хязгаар, цоорхой, шалгаагүй хэсэг гээд ямар ч шалтгаан
            WatermarkAnalysis incomplete = Analysis(10);
            incomplete.Report.Incomplete = true;
            incomplete.Report.IncompleteReasons.Add("Нөлөөллийн граф хязгаарт хүрсэн");
            AffectedPublishSet inc = AffectedPublishResolver.Resolve(items, cps, new[] { incomplete }, G);
            Assert.Eq(AffectState.Suggested, inc.Get("u1").State);
            Assert.True(inc.Get("u1").Reasons[0].Contains("граф хязгаарт"), inc.Get("u1").Reasons[0]);

            // Төслийн ерөнхий тохиргоо өөрчлөгдсөн
            WatermarkAnalysis global = Analysis(10);
            global.Report.HasGlobalChange = true;
            AffectedPublishSet g = AffectedPublishResolver.Resolve(items, cps, new[] { global }, G);
            Assert.Eq(AffectState.Suggested, g.Get("u1").State);
            Assert.Eq(ImpactConfidence.D, g.Get("u1").Confidence);
            Assert.True(g.Get("u1").Reasons[0].Contains("батлах боломжгүй"));

            // Мэдээлэлгүй устгал, мэдэгдэж буй загварын элементийн устгал
            WatermarkAnalysis unresolved = Analysis(10);
            unresolved.Report.UnresolvedDeleted = 2;
            Assert.Eq(AffectState.Suggested, AffectedPublishResolver.Resolve(items, cps, new[] { unresolved }, G).Get("u1").State);
            WatermarkAnalysis underivable = Analysis(10);
            underivable.Report.DeletedUnderivable = 1;
            Assert.Eq(AffectState.Suggested, AffectedPublishResolver.Resolve(items, cps, new[] { underivable }, G).Get("u1").State);

            // Бүртгэлийн цоорхой (Job `Incomplete`-ээр ИЛ хэлнэ)
            WatermarkAnalysis gap = Analysis(10);
            gap.Report.LogGap = true;
            gap.Report.Incomplete = true;
            gap.Report.IncompleteReasons.Add("Бүртгэл энэ мужид бүрэн БИШ");
            Assert.Eq(AffectState.Suggested, AffectedPublishResolver.Resolve(items, cps, new[] { gap }, G).Get("u1").State);

            // Хуримтлагдсан (cumulative) `DroppedBatches` ӨӨРӨӨ нэг хуучин цоорхойн улмаас БҮХ шинжилгээг үүрд сэжигтэй болгох ёсгүй.
            WatermarkAnalysis oldDrop = Analysis(10);
            oldDrop.Report.DroppedBatches = 4;
            Assert.Eq(AffectState.NoImpactFound, AffectedPublishResolver.Resolve(items, cps, new[] { oldDrop }, G).Get("u1").State);

            // Baseline хүссэн ч уншигдаагүй (Job үүнийг `Incomplete` болгоно)
            WatermarkAnalysis baselineFailed = Analysis(10);
            baselineFailed.Report.BaselineFailed = true;
            baselineFailed.Report.Incomplete = true;
            baselineFailed.Report.IncompleteReasons.Add("Revit-ийн хувилбарын түүхийг (baseline) уншиж чадсангүй");
            Assert.Eq(AffectState.Suggested, AffectedPublishResolver.Resolve(items, cps, new[] { baselineFailed }, G).Get("u1").State);

            // Цэвэр: нөлөөлөл олдсонгүй
            Assert.Eq(AffectState.NoImpactFound, AffectedPublishResolver.Resolve(items, cps, new[] { Analysis(10) }, G).Get("u1").State);
        }

        [Test]
        public static void Resolve_VersionGuid_OnlyMattersWhenTheVersionHistoryWasNotConsulted()
        {
            var items = new List<PublishItem> { Sheet("u1", 1, "A-101") };
            var cps = Cps(Cp("u1", 10, "guid-at-publish"));

            // Хувилбарын түүхээр ШАЛГААГҮЙ + хувилбар өөрчлөгдсөн → сэжигтэй.
            AffectedPublishSet changed = AffectedPublishResolver.Resolve(items, cps, new[] { Analysis(10) }, "guid-now");
            Assert.Eq(AffectState.Suggested, changed.Get("u1").State);
            Assert.True(changed.Get("u1").Reasons[0].Contains("хувилбар"), changed.Get("u1").Reasons[0]);

            // Хувилбарын түүхээр АМЖИЛТТАЙ шалгасан бол өөр session/хэрэглэгчийн өөрчлөлт аль хэдийн шинжилгээнд орсон — GUID зөрүү дангаараа сэжиг БИШ
            // (GUID нь элемент ҮҮСЭХЭД шинэчлэгддэг тул ихэнх засварын дараа зөрдөг).
            WatermarkAnalysis used = Analysis(10);
            used.Report.BaselineUsed = true;
            Assert.Eq(AffectState.NoImpactFound, AffectedPublishResolver.Resolve(items, cps, new[] { used }, "guid-now").Get("u1").State);

            // GUID таарвал бүртгэлд найдна.
            Assert.Eq(AffectState.NoImpactFound, AffectedPublishResolver.Resolve(items, cps, new[] { Analysis(10) }, "GUID-AT-PUBLISH").Get("u1").State);

            // Гаргалтын үеийн GUID ТОДОРХОЙГҮЙ (хуучин checkpoint, API унасан) + түүхээр шалгаагүй → бүртгэлд ороогүй өөрчлөлтийг шалгах боломжгүй.
            AffectedPublishSet unknown = AffectedPublishResolver.Resolve(items, Cps(Cp("u1", 10, null)), new[] { Analysis(10) }, "guid-now");
            Assert.Eq(AffectState.Suggested, unknown.Get("u1").State);
            Assert.True(unknown.Get("u1").Reasons[0].Contains("тодорхойгүй"), unknown.Get("u1").Reasons[0]);
        }

        [Test]
        public static void Resolve_FailedOrMissingAnalysis_IsUnknown_NotUnchanged()
        {
            var items = new List<PublishItem> { Sheet("u1", 1, "A-101") };
            var cps = Cps(Cp("u1", 10));
            Assert.Eq(AffectState.Unknown, AffectedPublishResolver.Resolve(items, cps, new List<WatermarkAnalysis>(), null).Get("u1").State);
            var failed = new WatermarkAnalysis { Watermark = 10, Failed = true, Error = "boom" };
            AffectedPublishSet set = AffectedPublishResolver.Resolve(items, cps, new[] { failed }, null);
            Assert.Eq(AffectState.Unknown, set.Get("u1").State);
            Assert.True(set.Incomplete);
            Assert.True(set.SuggestedIds().Contains("u1"), "Unknown нь санал болгосон жагсаалтад");
            Assert.True(set.Notes.Any(n => n.Contains("boom")));
        }

        [Test]
        public static void Resolve_UsesAnalysisWithLargestBoundNotAfterTheSheetWatermark()
        {
            // Хуудас watermark 70-тай: 50-аас эхэлсэн шинжилгээ хамрагдана (100-аас эхэлсэн нь түүнээс ХОЙШ — алдагдуулна!).
            var items = new List<PublishItem> { Sheet("u1", 1, "A-101") };
            var cps = Cps(Cp("u1", 70));
            WatermarkAnalysis a50 = Analysis(50, Hit(1, "u1", ImpactConfidence.A));
            WatermarkAnalysis a100 = Analysis(100);             // хуудсыг нөлөөлөхгүй гэж үзэх шинжилгээ
            AffectedPublishSet set = AffectedPublishResolver.Resolve(items, cps, new[] { a100, a50 }, G);
            Assert.Eq(AffectState.Affected, set.Get("u1").State, "эрт эхэлсэн шинжилгээ ашиглагдсан");
        }

        [Test]
        public static void Resolve_NonSheetItems_AreNotApplicable()
        {
            var items = new List<PublishItem> { new PublishItem { Id = "v1", Kind = PublishItemKind.View, Number = "Plan" } };
            AffectedPublishSet set = AffectedPublishResolver.Resolve(items, Cps(), new List<WatermarkAnalysis>(), null);
            Assert.Eq(AffectState.NotApplicable, set.Get("v1").State);
            Assert.False(set.AffectedIds().Contains("v1") || set.SuggestedIds().Contains("v1"));
        }

        [Test]
        public static void StateText_DistinguishesDirectFromSuggested()
        {
            var direct = new SheetAffect { State = AffectState.Affected, Confidence = ImpactConfidence.A };
            var sug = new SheetAffect { State = AffectState.Suggested, Confidence = ImpactConfidence.C };
            Assert.True(AffectedPublishSet.StateText(direct).Contains("Нөлөөлөгдсөн") && AffectedPublishSet.StateText(direct).Contains("Шууд"));
            Assert.True(AffectedPublishSet.StateText(sug).StartsWith("Санал") && AffectedPublishSet.StateText(sug).Contains("Боломжтой"));
            Assert.True(AffectedPublishSet.StateText(new SheetAffect { State = AffectState.NoImpactFound }).Contains("Нөлөөлөл олдсонгүй"));
        }

        [Test]
        public static void Resolve_MixedProject_CountsAddUp()
        {
            var items = Enumerable.Range(1, 6).Select(i => Sheet("u" + i, i, "S" + i)).ToList();
            var cps = Cps(Cp("u1", 10), Cp("u2", 10), Cp("u3", 10), Cp("u4", 10), Cp("u5", 10));      // u6 — хараахан гаргаагүй
            WatermarkAnalysis an = Analysis(10, Hit(1, "u1", ImpactConfidence.A), Hit(2, "u2", ImpactConfidence.B), Hit(3, "u3", ImpactConfidence.D));
            AffectedPublishSet set = AffectedPublishResolver.Resolve(items, cps, new[] { an }, G);
            Assert.Eq(1, set.Count(AffectState.Affected));
            Assert.Eq(2, set.Count(AffectState.Suggested));
            Assert.Eq(2, set.Count(AffectState.NoImpactFound));
            Assert.Eq(1, set.Count(AffectState.NeverPublished));
            Assert.Eq(6, set.BySheet.Count);
            Assert.SeqEq(new[] { "u1", "u6" }.OrderBy(x => x), set.AffectedIds().OrderBy(x => x));
            Assert.SeqEq(new[] { "u2", "u3" }.OrderBy(x => x), set.SuggestedIds().OrderBy(x => x));
        }
    }
}
