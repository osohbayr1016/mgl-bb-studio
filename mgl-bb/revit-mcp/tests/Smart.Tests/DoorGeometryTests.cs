using System;
using System.Collections.Generic;
using System.Linq;
using RevitMcpAddin.ChangeImpact.Core;
using static RevitMcpAddin.Smart.Tests.DoorFixtures;

namespace RevitMcpAddin.Smart.Tests
{
    /// <summary>
    /// Хаалганы ХОСТЫН дагуух геометр, нүхний давхцал, ханын төгсгөл, хөдөлгөөний зам (swept envelope) — ЦЭВЭР.
    /// Хаалгыг ЖИНХЭНЭ хөдөлгөхгүйгээр зорилтот байрлал хүчинтэй эсэхийг шийднэ.
    /// </summary>
    public static class DoorGeometryTests
    {
        /* ============================== ХОСТЫН ПАРАМЕТР ===================== */

        [Test]
        public static void ParamOf_ProjectsOntoHostTangent_ForDiagonalHost()
        {
            var h = new HostGeometry { StartX = 100, StartY = 100, EndX = 100 + 3000, EndY = 100 + 4000 };     // урт 5000, чиглэл (0.6, 0.8)
            Assert.Near(5000, h.LengthMm, 1e-9);
            double s = DoorHostMath.ParamOf(h, 100 + 600, 100 + 800);                                          // 1000 мм дагуу
            Assert.Near(1000, s, 1e-9);
            double x, y;
            DoorHostMath.PointAt(h, 1000, 0, out x, out y);
            Assert.Near(700, x, 1e-9);
            Assert.Near(900, y, 1e-9);
            // зүүн нормаль (−0.8, 0.6): n=100 → (700−80, 900+60)
            DoorHostMath.PointAt(h, 1000, 100, out x, out y);
            Assert.Near(620, x, 1e-9);
            Assert.Near(960, y, 1e-9);
        }

        [Test]
        public static void SameTarget_IsNoMovement_NotAnError()
        {
            DoorTargetCheck c = DoorHostMath.Check(Ctx(), 0);
            Assert.False(c.Ok);
            Assert.Eq("no.move", c.Code);
            Assert.False(c.Refused, "хөдөлгөөнгүй нь Revit-ийн татгалзал биш");
            Assert.Eq("no.move", DoorHostMath.Check(Ctx(), 0.3).Code);       // хүлцлийн дотор
        }

        [Test]
        public static void ValidSameHostMovement_IsOk_AndReportsTheNewInterval()
        {
            DoorTargetCheck c = DoorHostMath.Check(Ctx(1500, 900), 600);
            Assert.True(c.Ok, c.Problem);
            Assert.Near(2100, c.TargetParamMm, 1e-9);
            Assert.Near(1650, c.IntervalStartMm, 1e-9);
            Assert.Near(2550, c.IntervalEndMm, 1e-9);
            Assert.Near(1650, c.GapToStartMm, 1e-9);
            Assert.Near(6000 - 2550, c.GapToEndMm, 1e-9);
        }

        [Test]
        public static void TargetCentreOutsideTheWall_IsRefused_WithExactReason()
        {
            DoorTargetCheck c = DoorHostMath.Check(Ctx(1500, 900), 5000);       // 6500 > 6000
            Assert.False(c.Ok);
            Assert.Eq("outside.host", c.Code);
            Assert.True(c.Refused);
            Assert.True(c.Problem.Contains("гадна"), c.Problem);
            Assert.True(c.Problem.Contains("500 мм"), c.Problem);               // 6500 − 6000 хэтэрнэ
            Assert.Eq("outside.host", DoorHostMath.Check(Ctx(1500, 900), -2000).Code);     // −500 < 0
        }

        [Test]
        public static void OpeningThatWouldOverhangTheWallEnd_IsRefused_EvenWhenTheCentreIsInside()
        {
            // Төв 5800 (дотор), гэхдээ нүх 5350..6250 — 250 мм хэтэрнэ.
            DoorTargetCheck c = DoorHostMath.Check(Ctx(1500, 900), 4300);
            Assert.Eq("outside.host", c.Code);
            Assert.True(c.Problem.Contains("250 мм"), c.Problem);
            Assert.True(c.Problem.Contains("төгсгөл"), c.Problem);
        }

        [Test]
        public static void UnknownWidth_ChecksOnlyTheCentre_NeverAssumesZeroWidthIsKnown()
        {
            DoorMoveContext ctx = Ctx(1500, 900, WidthSource.Unknown);
            Assert.False(ctx.Door.WidthKnown);
            DoorTargetCheck ok = DoorHostMath.Check(ctx, 4400);                // төв 5900 — дотор
            Assert.True(ok.Ok, "өргөн мэдэгдэхгүй үед зөвхөн төвийг шалгана");
            Assert.Eq("outside.host", DoorHostMath.Check(ctx, 4600).Code);     // төв 6100 — гадна
        }

        [Test]
        public static void OffsetRange_KeepsTheWholeOpeningInsideTheHost()
        {
            double min, max;
            DoorHostMath.OffsetRange(Ctx(1500, 900), out min, out max);
            Assert.Near(450 - 1500, min, 1e-9);
            Assert.Near(6000 - 450 - 1500, max, 1e-9);
            Assert.True(DoorHostMath.Check(Ctx(1500, 900), max).Ok);
            Assert.False(DoorHostMath.Check(Ctx(1500, 900), max + 1).Ok);
        }

        [Test]
        public static void MissingContext_IsBadInput_NotACrash()
        {
            Assert.Eq("bad.input", DoorHostMath.Check(null, 100).Code);
            Assert.Eq("bad.input", DoorHostMath.Check(Ctx(), double.NaN).Code);
            Assert.Eq("bad.input", DoorHostMath.Check(new DoorMoveContext(), 100).Code);
        }

        [Test]
        public static void Request_VectorEqualsTangentTimesSignedOffset_AndValidates()
        {
            PreChangeRequest r = Req(-620);
            Assert.Near(-620, r.VectorMm[0], 1e-9);
            Assert.Near(0, r.VectorMm[1], 1e-9);
            Assert.Eq(620.0, r.DistanceMm);
            Assert.Null(PreChangeRequestRules.Validate(r));
            Assert.True(PreChangeRequestRules.Validate(Req(0)) != null, "0 offset татгалзагдана");
            PreChangeRequest bad = Req(300);
            bad.DirX = -1;      // вектор offset-тэй зөрсөн
            Assert.True(PreChangeRequestRules.Validate(bad) != null, "чиглэл хостын дагуу биш");
            PreChangeRequest noHost = Req(300);
            noHost.HostId = 0;
            Assert.True(PreChangeRequestRules.Validate(noHost) != null);
            // Хана зөөхийн хуучин дүрэм хэвээр
            Assert.Null(PreChangeRequestRules.Validate(new PreChangeRequest { SourceId = 5, DistanceMm = 300, DirX = 1, DirY = 0 }));
        }

        /* ============================== НҮХНИЙ ДАВХЦАЛ ====================== */

        private static FastFinding Find(DoorFastResult r, FastFindingKind k) { return r.Findings.FirstOrDefault(f => f.Kind == k); }

        [Test]
        public static void OverlapWithAnotherDoorsOpening_IsCriticalAndConfirmed_WithTheOverlapLength()
        {
            DoorMoveContext ctx = Ctx(1500, 900);
            ctx.Openings.Add(Opening(121, 3000, 900, label: "D-121"));          // нүх 2550..3450
            DoorFastResult r = DoorFastScan.Run(ctx, 1200);                      // 2700 → нүх 2250..3150 → давхцал 600
            FastFinding f = Find(r, FastFindingKind.OpeningOverlap);
            Assert.NotNull(f, "нүхний давхцал илрээгүй");
            Assert.Eq(ItemSeverity.Critical, f.Severity);
            Assert.Eq(TruthState.Confirmed, f.Truth);
            Assert.Near(600, f.Mm.Value, 1e-9);
            Assert.True(f.Text.Contains("D-121") && f.Text.Contains("600 мм"), f.Text);
            Assert.Eq(ApplyTone.Red, r.Tone);
        }

        [Test]
        public static void TwoAdjacentDoors_ThatJustTouch_DoNotOverlap_ButOneMillimetreMoreDoes()
        {
            DoorMoveContext ctx = Ctx(1500, 900);
            ctx.Openings.Add(Opening(121, 3000, 900));                           // 2550..3450
            Assert.Null(Find(DoorFastScan.Run(ctx, 600), FastFindingKind.OpeningOverlap), "2100 → 1650..2550: шүргэнэ, давхцахгүй");
            Assert.NotNull(Find(DoorFastScan.Run(ctx, 601), FastFindingKind.OpeningOverlap), "1 мм давхцана");
        }

        [Test]
        public static void AdjacentDoorWithAGap_IsClean()
        {
            DoorMoveContext ctx = Ctx(1500, 900);
            ctx.Openings.Add(Opening(121, 4000, 900));
            DoorFastResult r = DoorFastScan.Run(ctx, 800);
            Assert.Eq(0, r.CriticalCount);
        }

        [Test]
        public static void OverlapWhereAWidthIsUnknown_IsReviewNotCritical()
        {
            DoorMoveContext ctx = Ctx(1500, 900);
            ctx.Openings.Add(Opening(121, 3000, 900, known: false, label: "W-9"));       // өргөн мэдэгдэхгүй
            DoorFastResult r = DoorFastScan.Run(ctx, 1500);                              // төв 3000 = нөгөөгийн төв
            FastFinding f = Find(r, FastFindingKind.OpeningOverlapUnverified);
            Assert.NotNull(f);
            Assert.Eq(ItemSeverity.Warning, f.Severity);
            Assert.Eq(TruthState.Review, f.Truth);
            Assert.Null(Find(r, FastFindingKind.OpeningOverlap), "өргөн мэдэгдэхгүй бол «батлагдсан давхцал» гэж хэлэхгүй");
            Assert.Eq(0, r.CriticalCount);
        }

        [Test]
        public static void MovingPastAnotherOpening_IsAPathCrossing_AndNotAnOverlap()
        {
            DoorMoveContext ctx = Ctx(1500, 900);
            ctx.Openings.Add(Opening(121, 3000, 400));                                   // нарийн нүх 2800..3200
            DoorFastResult r = DoorFastScan.Run(ctx, 3000);                              // төв 4500, нүх 4050..4950 — давхцахгүй, гэхдээ 3000-ыг дайрна
            Assert.Null(Find(r, FastFindingKind.OpeningOverlap));
            FastFinding f = Find(r, FastFindingKind.PathCrossesOpening);
            Assert.NotNull(f);
            Assert.True(f.IsPath);
            Assert.Eq(0, r.CriticalCount);
        }

        [Test]
        public static void AnOverlapThatAlreadyExistedAtTheCurrentPosition_IsNotANewCritical()
        {
            DoorMoveContext ctx = Ctx(1500, 900);
            ctx.Openings.Add(Opening(121, 1700, 900));                                   // одоо ч давхцаж байна
            DoorFastResult r = DoorFastScan.Run(ctx, -100);                              // давхцал 700 → 650: багасна, шинэ биш
            Assert.Null(Find(r, FastFindingKind.OpeningOverlap));
            Assert.NotNull(Find(r, FastFindingKind.StartOverlap));
            Assert.Eq(0, r.CriticalCount);
            // Харин давхцлыг ӨСГӨХ зөөлт (700 → 800) шинэ ноцтой.
            Assert.NotNull(Find(DoorFastScan.Run(ctx, 100), FastFindingKind.OpeningOverlap));
        }

        /* ============================== ХАНЫН ТӨГСГӨЛ / JOIN ================ */

        [Test]
        public static void DoorTouchingTheWallEnd_IsReview_AndOutsideIsCritical()
        {
            DoorMoveContext ctx = Ctx(1500, 900);
            DoorFastResult touching = DoorFastScan.Run(ctx, 4050);                       // 5550 → нүх 5100..6000: төгсгөлтэй шүргэнэ
            Assert.True(touching.Check.Ok);
            FastFinding f = Find(touching, FastFindingKind.WallEnd);
            Assert.NotNull(f);
            Assert.Eq(TruthState.Review, f.Truth);
            Assert.Eq(0, touching.CriticalCount, "шүргэх нь ноцтой биш — хянах");

            DoorFastResult outside = DoorFastScan.Run(ctx, 4200);                        // 5700 → нүх 5250..6150 — гадна
            Assert.False(outside.Check.Ok);
            FastFinding o = Find(outside, FastFindingKind.OutsideHost);
            Assert.NotNull(o);
            Assert.Eq(ItemSeverity.Critical, o.Severity);
            Assert.Eq(ApplyTone.Red, outside.Tone);
        }

        [Test]
        public static void OpeningReachingIntoAJoinedWall_IsReview_OnlyWhenTheEndIsActuallyJoined()
        {
            DoorMoveContext joined = Ctx(1500, 900);
            joined.Host.EndJoinThicknessMm = 300;                                        // төгсгөлд 300 мм зузаантай хана холбогдсон → 150 мм
            DoorFastResult r = DoorFastScan.Run(joined, 3900);                           // 5400 → нүх 4950..5850 → зах 150... 6000−5850=150 (= 300/2, хүрэхгүй)
            Assert.Null(Find(r, FastFindingKind.WallEnd), "яг хагас зузаантай тэнцүү: хананд ороогүй");
            r = DoorFastScan.Run(joined, 3950);                                          // зах 100 < 150
            Assert.NotNull(Find(r, FastFindingKind.WallEnd));

            DoorMoveContext free = Ctx(1500, 900);                                       // чөлөөт төгсгөл
            Assert.Null(Find(DoorFastScan.Run(free, 3950), FastFindingKind.WallEnd), "холбоогүй төгсгөлд 100 мм зах нь геометрийн зөрчил биш");
        }

        /* ============================== SWEPT ENVELOPE ====================== */

        [Test]
        public static void NoCandidates_MeansNoFindings_AndAGrayPredictiveTone()
        {
            DoorFastResult r = DoorFastScan.Run(Ctx(), 400);
            Assert.Eq(0, r.Findings.Count);
            Assert.Eq(ApplyTone.Gray, r.Tone, "урьдчилсан дүн ХЭЗЭЭ Ч ногоон биш");
            Assert.True(r.CanSimulate);
        }

        [Test]
        public static void ObstacleInsideTheFinalOpening_IsAReviewCandidate_NeverCritical()
        {
            DoorMoveContext ctx = Ctx(1500, 900);
            ctx.Obstacles.Add(Box(900, ObstacleKind.Column, 2400, 2800, -200, 200, 0, 3000, "Column C12"));
            DoorFastResult r = DoorFastScan.Run(ctx, 1000);                               // 2500 → 2050..2950 — багана 2400..2800 дотор
            FastFinding f = Find(r, FastFindingKind.FinalCandidate);
            Assert.NotNull(f);
            Assert.Eq(ItemSeverity.Warning, f.Severity);
            Assert.Eq(TruthState.Review, f.Truth);
            Assert.Eq(0, r.CriticalCount, "bounding box-ийн давхцал ганцаараа 🔴 биш");
            Assert.Eq(ApplyTone.Amber, r.Tone);
        }

        [Test]
        public static void ObstacleOnThePathOnly_IsAPathCandidate_AndDoesNotChangeTheTone()
        {
            DoorMoveContext ctx = Ctx(1500, 900);
            ctx.Obstacles.Add(Box(901, ObstacleKind.Furniture, 3000, 3300, -150, 150, 0, 900, "Cabinet F44"));
            DoorFastResult r = DoorFastScan.Run(ctx, 3000);                               // 4500 → 4050..4950; шкаф 3000..3300 замд
            Assert.Null(Find(r, FastFindingKind.FinalCandidate));
            FastFinding f = Find(r, FastFindingKind.PathCandidate);
            Assert.NotNull(f);
            Assert.Eq(ItemSeverity.Notice, f.Severity);
            Assert.True(f.IsPath && !f.IsFinal);
        }

        [Test]
        public static void ObstacleAcrossTheWall_OutsideTheDoorDepth_IsIgnored()
        {
            DoorMoveContext ctx = Ctx(1500, 900);
            ctx.Obstacles.Add(Box(902, ObstacleKind.Column, 2000, 2400, 300, 700, 0, 3000));   // ханын нөгөө талд (n 300..700 > 100)
            ctx.Obstacles.Add(Box(903, ObstacleKind.Furniture, 2000, 2400, -150, 150, 2500, 3000));   // хаалганы дээр (z > 2100)
            Assert.Eq(0, DoorFastScan.Run(ctx, 800).Findings.Count);
        }

        [Test]
        public static void DuplicateCandidates_AreReportedOnce()
        {
            DoorMoveContext ctx = Ctx(1500, 900);
            ctx.Obstacles.Add(Box(900, ObstacleKind.Column, 2400, 2800));
            ctx.Obstacles.Add(Box(900, ObstacleKind.Column, 2400, 2800));
            Assert.Eq(1, DoorFastScan.Run(ctx, 1000).Findings.Count(f => f.Kind == FastFindingKind.FinalCandidate));
        }

        [Test]
        public static void LinkedCandidate_IsDistinctFromAHostElementWithTheSameId()
        {
            DoorMoveContext ctx = Ctx(1500, 900);
            ctx.Obstacles.Add(Box(900, ObstacleKind.Column, 2400, 2800, label: "Host column"));
            ctx.Obstacles.Add(Box(900, ObstacleKind.Structure, 2400, 2800, label: "Linked beam", link: 77));
            List<SweepHit> hits = DoorSweep.Scan(ctx, 1000);
            Assert.Eq(2, hits.Count, "линкийн элемент host-ын ижил id-тай элементтэй давхардахгүй");
            Assert.Eq("0:900", ctx.FindByKey("0:900").Key);
            Assert.Eq("77:900", ctx.FindByKey("77:900").Key);
            Assert.Eq("Linked beam", ctx.FindByKey("77:900").Label);
            Assert.Null(ctx.FindByKey("garbage"));
        }

        [Test]
        public static void HostAndDoorThemselves_AreNeverObstacles()
        {
            DoorMoveContext ctx = Ctx(1500, 900);
            ctx.Obstacles.Add(Box(HostId, ObstacleKind.Wall, 0, 6000));
            ctx.Obstacles.Add(Box(DoorId, ObstacleKind.Door, 1050, 1950));
            Assert.Eq(0, DoorSweep.Scan(ctx, 500).Count);
        }

        [Test]
        public static void SweepEnvelope_CoversStartPathAndFinal()
        {
            SweepEnvelope e = DoorSweep.Envelope(Ctx(1500, 900), 1000);
            Assert.Near(1050, e.StartLo, 1e-9);
            Assert.Near(1950, e.StartHi, 1e-9);
            Assert.Near(2050, e.FinalLo, 1e-9);
            Assert.Near(2950, e.FinalHi, 1e-9);
            Assert.Near(1050, e.PathLo, 1e-9);
            Assert.Near(2950, e.PathHi, 1e-9);
            SweepEnvelope back = DoorSweep.Envelope(Ctx(1500, 900), -1000);
            Assert.Near(50, back.PathLo, 1e-9);
            Assert.Near(1950, back.PathHi, 1e-9);
        }

        [Test]
        public static void DiagonalHost_LocalBoxIsAConservativeAabb()
        {
            var h = new HostGeometry { StartX = 0, StartY = 0, EndX = 3000, EndY = 4000, ThicknessMm = 200 };     // (0.6, 0.8)
            double[] lb = DoorSweep.LocalBox(h, new[] { 1000.0, 1000.0, 0, 2000.0, 2000.0, 500 });
            Assert.True(lb[0] <= 1000 * 0.6 + 1000 * 0.8 + 1e-6 && lb[3] >= 2000 * 0.6 + 2000 * 0.8 - 1e-6, "s хүрээ хайрцгийн бүх өнцгийг хамруулна");
            Assert.Eq(0.0, lb[2]);
            Assert.Eq(500.0, lb[5]);
        }

        [Test]
        public static void FastScan_IsDeterministic_AndOrdersCriticalFirst()
        {
            DoorMoveContext ctx = Ctx(1500, 900);
            ctx.Openings.Add(Opening(121, 3000, 900));
            ctx.Obstacles.Add(Box(900, ObstacleKind.Furniture, 2000, 2400, -150, 150, 0, 900));
            DoorFastResult a = DoorFastScan.Run(ctx, 1200), b = DoorFastScan.Run(ctx, 1200);
            Assert.SeqEq(a.Findings.Select(f => f.Kind), b.Findings.Select(f => f.Kind));
            Assert.Eq(ItemSeverity.Critical, a.Findings[0].Severity);
        }

        [Test]
        public static void FastScan_With600Obstacles_IsFarBelowTheLiveBudget()
        {
            DoorMoveContext ctx = Ctx(3000, 900);
            var rnd = new Random(7);
            for (int i = 0; i < 600; i++)
            {
                double x = rnd.NextDouble() * 6000, y = (rnd.NextDouble() - 0.5) * 3000;
                ctx.Obstacles.Add(Box(1000 + i, ObstacleKind.Furniture, x, x + 400, y, y + 400, 0, 900));
            }
            DoorFastScan.Run(ctx, 100);          // JIT
            var sw = System.Diagnostics.Stopwatch.StartNew();
            const int runs = 50;
            for (int i = 0; i < runs; i++) DoorFastScan.Run(ctx, 100 + i * 20);
            double perRun = sw.Elapsed.TotalMilliseconds / runs;
            Console.WriteLine("       [perf] fast_scan 600 obstacles: " + perRun.ToString("0.000") + " ms/run");
            Assert.True(perRun < 50, "fast scan " + perRun + " мс — 50 мс-ийн зорилтоос удаан");
        }

        [Test]
        public static void TransomWindowAboveTheDoor_IsNotAnOpeningOverlap_ButTheSameHeightWindowIs()
        {
            DoorMoveContext ctx = Ctx(1500, 900);
            OpeningSpan transom = Opening(131, 2100, 900, kind: ObstacleKind.Window, label: "W-131");
            transom.BoxMm = new[] { 1650.0, -100, 2200, 2550, 100, 2700 };           // хаалганы (0..2100) дээгүүр
            ctx.Openings.Add(transom);
            DoorFastResult fast = DoorFastScan.Run(ctx, 500);
            Assert.Eq(0, fast.CriticalCount, "өөр түвшний нүх огтлолцохгүй");
            Assert.False(fast.Findings.Any(f => f.Kind == FastFindingKind.OpeningOverlap));

            OpeningSpan sameLevel = Opening(132, 2100, 900, kind: ObstacleKind.Window, label: "W-132");
            sameLevel.BoxMm = new[] { 1650.0, -100, 900, 2550, 100, 2100 };           // хаалгатай ижил өндөр
            DoorMoveContext ctx2 = Ctx(1500, 900);
            ctx2.Openings.Add(sameLevel);
            Assert.Eq(1, DoorFastScan.Run(ctx2, 500).CriticalCount, "ижил өндөрт давхцвал 🔴");
        }

        [Test]
        public static void OpeningWithUnreadableHeight_CannotBeConfirmed_SoItIsOnlyAReview()
        {
            DoorMoveContext ctx = Ctx(1500, 900);
            OpeningSpan o = Opening(133, 2100, 900, label: "W-133");
            o.BoxMm = null;
            ctx.Openings.Add(o);
            DoorFastResult fast = DoorFastScan.Run(ctx, 500);
            Assert.Eq(0, fast.CriticalCount, "Z мэдэгдэхгүй бол батлах боломжгүй");
            Assert.True(fast.Findings.Any(f => f.Kind == FastFindingKind.OpeningOverlapUnverified));
        }
    }
}
