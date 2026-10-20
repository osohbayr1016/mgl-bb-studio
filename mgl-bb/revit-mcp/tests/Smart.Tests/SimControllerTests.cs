using System;
using System.Collections.Generic;
using System.Linq;
using RevitMcpAddin.ChangeImpact.Core;

namespace RevitMcpAddin.Smart.Tests
{
    /// <summary>Simulation цонхны төлөвийн машин: хулганаар барьж чирэх → урьдчилсан мөргөлдөөн → Revit-ийн эцсийн дүн (generation-тэй) — ЦЭВЭР.</summary>
    public static class SimControllerTests
    {
        private const double W = 1000, H = 700;

        /// <summary>Moving: 1×1×2 м багана (0..1000, 0..1000, 0..2000).  Орчин: 3 м зайд 200 мм зузаан хана.</summary>
        private static SimController Ready(bool line = false)
        {
            var scene = new SimScene { MovingName = "Багана · #1", OriginMm = new double[3] };
            scene.Moving.Add(SimMeshBuilder.Box("h:1", 0, 0, 0, 1000, 1000, 2000, SimRole.Moving, SimKind.Column));
            SimMesh wall = SimMeshBuilder.Box("h:2", 3000, -2000, 0, 3200, 4000, 3000, SimRole.Context, SimKind.Wall);
            wall.Id = 2; wall.Label = "Хана · Generic · #2"; wall.CategoryName = "Хана";
            scene.Context.Add(wall);
            if (line) scene.LineConstraintXY = new[] { 1.0, 0.0 };
            var c = new SimController();
            c.Load(scene, W, H);
            c.Camera.SetTopView();
            c.Camera.Target = new SimVec(1500, 500, 0);
            c.Camera.Distance = 9000;
            c.Camera.Recompute();
            c.ComputeBaselineSync();
            return c;
        }

        private static void Px(SimController c, SimVec world, out double x, out double y)
        {
            Assert.True(c.Camera.Project(world, W, H, out x, out y));
        }

        [Test]
        public static void NotReady_WithoutBaseline_RefusesToDrag()
        {
            var c = new SimController();
            var scene = new SimScene();
            scene.Moving.Add(SimMeshBuilder.Box("h:1", 0, 0, 0, 100, 100, 100, SimRole.Moving));
            c.Load(scene, W, H);
            Assert.False(c.IsReady);
            Assert.False(c.BeginDrag(500, 350, W, H));
            c.ComputeBaselineSync();
            Assert.True(c.IsReady);
        }

        [Test]
        public static void DragOnTheElement_MovesItWithTheMouse_AndShowsPreliminaryClash()
        {
            SimController c = Ready();
            double x, y;
            Px(c, new SimVec(500, 500, 2000), out x, out y);              // баганын орой дээрх цэг
            Assert.True(c.BeginDrag(x, y, W, H), "элемент дээр барина");
            Assert.Eq(SimPhase.Dragging, c.Phase);

            // 2300 мм баруун → багана x: 2300..3300 хана (3000..3200)-ыг дайрна.
            double x2, y2;
            Px(c, new SimVec(500 + 2300, 500, 2000), out x2, out y2);
            Assert.True(c.DragTo(x2, y2, W, H));
            Assert.Near(2300, c.Offset.X, 5);          // 10 мм-ийн алхам
            Assert.Near(0, c.Offset.Y, 5);
            Assert.Near(0, c.Offset.Z, 1e-9);
            Assert.Eq(SimPhase.Dragging, c.Phase);
            Assert.Eq(1, c.Report.Lines.Count(l => l.Code == "clash.prelim"), string.Join(" | ", c.Report.Lines.Select(l => l.Text)));
            Assert.True(c.Report.HighlightKeys.Contains("h:2"));
            Assert.False(c.Report.CanApply, "чирж байх үед зөөх боломжгүй");
            Assert.True(c.HitBoxes().Count >= 1, "дэлгэц дээр улаан хайрцаг");
            Assert.True(c.LastLiveMs < 500);

            Assert.True(c.EndDrag(), "тавьсан — Revit-ээр шалгах хэрэгтэй");
            Assert.Eq(SimPhase.Analyzing, c.Phase);
        }

        [Test]
        public static void ClickingEmptySpace_DoesNotStartAnElementDrag()
        {
            SimController c = Ready();
            double x, y;
            Px(c, new SimVec(-3000, 3000, 0), out x, out y);
            Assert.False(c.BeginDrag(x, y, W, H));
            Assert.False(c.Dragging);
        }

        [Test]
        public static void ExactResult_IsAcceptedOnlyForTheCurrentGenerationAndOffset()
        {
            SimController c = Ready();
            c.SetOffset(new SimVec(500, 0, 0));
            int gen = c.BeginAnalysis();
            var e = new SimExactResult { Generation = gen, OffsetMm = new[] { 500.0, 0, 0 }, Outcome = SandboxOutcome.Simulated, ClashesEvaluated = true, ClashesComplete = true, RoomsEvaluated = true };

            // Хэрэглэгч дахин хөдөлгөв → хуучин дүн хүчингүй.
            c.SetOffset(new SimVec(800, 0, 0));
            Assert.False(c.AcceptExact(e), "хуучирсан generation");
            Assert.Null(c.Exact);

            int gen2 = c.BeginAnalysis();
            var stale = new SimExactResult { Generation = gen2, OffsetMm = new[] { 500.0, 0, 0 }, Outcome = SandboxOutcome.Simulated };
            Assert.False(c.AcceptExact(stale), "offset таарахгүй");
            var good = new SimExactResult { Generation = gen2, OffsetMm = new[] { 800.0, 0, 0 }, Outcome = SandboxOutcome.Simulated, ClashesEvaluated = true, ClashesComplete = true, RoomsEvaluated = true };
            Assert.True(c.AcceptExact(good));
            Assert.True(c.Report.IsFinal);
            Assert.Eq(MoveVerdict.MoveOk, c.Report.Verdict);
            Assert.True(c.Report.CanApply);
            Assert.Eq(SimPhase.Idle, c.Phase);

            // Дахин хөдлөхөд эцсийн дүн хүчингүй болж, зөөх товч хаагдана.
            c.SetOffset(new SimVec(810, 0, 0));
            Assert.Null(c.Exact);
            Assert.False(c.Report.CanApply);
        }

        [Test]
        public static void ExactResult_IsRejectedWhileDragging()
        {
            SimController c = Ready();
            double x, y;
            Px(c, new SimVec(500, 500, 2000), out x, out y);
            c.BeginDrag(x, y, W, H);
            double x2, y2;
            Px(c, new SimVec(900, 500, 2000), out x2, out y2);
            c.DragTo(x2, y2, W, H);
            var e = new SimExactResult { Generation = c.Generation, OffsetMm = new[] { c.Offset.X, c.Offset.Y, c.Offset.Z }, Outcome = SandboxOutcome.Simulated };
            Assert.False(c.AcceptExact(e), "чирж байхад хүлээж авахгүй");
        }

        [Test]
        public static void LineLockedElement_MovesOnlyAlongItsHost_ForDragAndNudge()
        {
            SimController c = Ready(line: true);
            Assert.True(c.LineLocked);
            double x, y;
            Px(c, new SimVec(500, 500, 2000), out x, out y);
            Assert.True(c.BeginDrag(x, y, W, H));
            double x2, y2;
            Px(c, new SimVec(500 + 600, 500 + 900, 2000), out x2, out y2);
            c.DragTo(x2, y2, W, H);
            Assert.Near(600, c.Offset.X, 5);
            Assert.Near(0, c.Offset.Y, 1e-6, "хөндлөн чирэлт хаалгыг хананаас гаргахгүй");

            c.EndDrag();
            c.Nudge(new SimVec(0, 100, 0));
            Assert.Near(0, c.Offset.Y, 1e-6, "хөндлөн нудалт үл тоомсорлоно");
            c.Nudge(new SimVec(100, 50, 0));
            Assert.Near(700, c.Offset.X, 1e-6);
            Assert.Near(0, c.Offset.Y, 1e-6);
        }

        [Test]
        public static void CancelDrag_RestoresTheGrabbedPosition_AndResetClearsEverything()
        {
            SimController c = Ready();
            c.SetOffset(new SimVec(400, 0, 0));
            double x, y;
            Px(c, new SimVec(400 + 500, 500, 2000), out x, out y);
            Assert.True(c.BeginDrag(x, y, W, H));
            double x2, y2;
            Px(c, new SimVec(400 + 500 + 700, 500, 2000), out x2, out y2);
            c.DragTo(x2, y2, W, H);
            Assert.Near(1100, c.Offset.X, 5);
            c.CancelDrag();
            Assert.Near(400, c.Offset.X, 1e-6);
            Assert.False(c.Dragging);

            c.Reset();
            Assert.Near(0, c.Offset.Length, 1e-9);
            Assert.False(c.Report.CanApply);
            Assert.True(c.Report.Headline.Contains("хулганаар"));
        }

        [Test]
        public static void MovingFarOutsideTheLoadedArea_WarnsThatThePreliminaryCheckIsBlind()
        {
            SimController c = Ready();
            c.Scene.ContextBounds = new[] { -2000.0, -2000, -500, 5000, 3000, 4000 };
            c.SetOffset(new SimVec(9000, 0, 0));
            Assert.True(c.OutsideLoadedContext);
            Assert.True(c.Report.Coverage.Any(x => x.Contains("ачаалсан орчноос гарлаа")), string.Join(" | ", c.Report.Coverage));
            c.SetOffset(new SimVec(300, 0, 0));
            Assert.False(c.OutsideLoadedContext);
        }

        [Test]
        public static void VerticalMode_MovesZ_WhenCameraIsNotTopDown()
        {
            SimController c = Ready();
            c.Camera.SetIsoView();
            c.Camera.Target = new SimVec(500, 500, 1000);
            c.Camera.Distance = 8000;
            c.Camera.Recompute();
            c.Mode = SimDragMode.Vertical;
            double x, y;
            Px(c, new SimVec(0, 0, 2000), out x, out y);                       // баганын булан
            if (!c.BeginDrag(x, y, W, H)) Px(c, new SimVec(1000, 1000, 2000), out x, out y);
            Assert.True(c.BeginDrag(x, y, W, H) || c.Dragging);
            double x2, y2;
            Px(c, new SimVec(0, 0, 2600), out x2, out y2);
            c.DragTo(x2, y2, W, H);
            Assert.Near(0, c.Offset.X, 1e-6);
            Assert.Near(0, c.Offset.Y, 1e-6);
            Assert.True(c.Offset.Z > 300, "Z=" + c.Offset.Z);
        }
    }
}
