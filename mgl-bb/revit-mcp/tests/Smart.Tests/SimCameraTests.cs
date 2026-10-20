using System;
using System.Collections.Generic;
using System.Linq;
using RevitMcpAddin.ChangeImpact.Core;

namespace RevitMcpAddin.Smart.Tests
{
    /// <summary>Simulation-ийн камер, цацраг, хулганаар барьж чирэх математик, сонголт — ЦЭВЭР.</summary>
    public static class SimCameraTests
    {
        private const double W = 1000, H = 700;

        private static SimCamera Cam(bool ortho = false)
        {
            var c = new SimCamera { Target = new SimVec(1000, 2000, 500), Distance = 9000, Yaw = -2.0, Pitch = 0.6, Ortho = ortho };
            c.Recompute();
            return c;
        }

        [Test]
        public static void CenterRay_GoesThroughTarget_ForBothProjections()
        {
            foreach (bool ortho in new[] { false, true })
            {
                SimCamera c = Cam(ortho);
                SimRay r = c.Ray(W / 2, H / 2, W, H);
                SimVec p = r.At((c.Target - r.Origin).Dot(r.Dir));
                Assert.Near(0, (p - c.Target).Length, 1e-6, "ortho=" + ortho);
            }
        }

        [Test]
        public static void ProjectThenRay_RoundTrips_ThroughTheSamePoint()
        {
            var rnd = new Random(3);
            foreach (bool ortho in new[] { false, true })
            {
                SimCamera c = Cam(ortho);
                for (int i = 0; i < 60; i++)
                {
                    SimVec p = c.Target + new SimVec((rnd.NextDouble() - 0.5) * 6000, (rnd.NextDouble() - 0.5) * 6000, (rnd.NextDouble() - 0.5) * 3000);
                    double sx, sy;
                    Assert.True(c.Project(p, W, H, out sx, out sy));
                    SimRay r = c.Ray(sx, sy, W, H);
                    // p-ийн цацраг дээрх проекц руу зай.
                    double t = (p - r.Origin).Dot(r.Dir);
                    Assert.Near(0, (r.At(t) - p).Length, 1e-4, "ortho=" + ortho + " i=" + i);
                }
            }
        }

        [Test]
        public static void TopView_HasXRight_YUp_AndPixelDragMapsToWorldMm()
        {
            var c = new SimCamera { Target = new SimVec(0, 0, 0), Distance = 10000 };
            c.SetTopView();
            Assert.True(c.Right.X > 0.999, "X баруун");
            Assert.True(c.Up.Y > 0.99, "Y дээш");

            // Элементийг (0,0,0)-д барьж, хулганыг 100 px баруун, 50 px дээш чирнэ.
            SimDragSession d = SimDragSession.Begin(c, new SimVec(0, 0, 0), new SimVec(0, 0, 0), SimDragMode.Plane, null, 0);
            double mmPerPx = c.OrthoWidth / W;          // перспективт Target-ийн гүнд
            SimRay r = c.Ray(W / 2 + 100, H / 2 - 50, W, H);
            Assert.True(d.Update(r));
            Assert.Near(100 * mmPerPx, d.Offset.X, 1.5);
            Assert.Near(50 * mmPerPx, d.Offset.Y, 1.5);
            Assert.Near(0, d.Offset.Z, 1e-9);
        }

        [Test]
        public static void Drag_AccumulatesFromStartOffset_AndSnaps()
        {
            SimCamera c = Cam();
            var grab = new SimVec(2000, 2000, 0);
            SimDragSession d = SimDragSession.Begin(c, grab, new SimVec(300, 0, 0), SimDragMode.Plane, null, 50);
            double sx, sy;
            Assert.True(c.Project(grab + new SimVec(137, -212, 0), W, H, out sx, out sy));
            Assert.True(d.Update(c.Ray(sx, sy, W, H)));
            Assert.Near(450, d.Offset.X, 1e-9, "300 + 137 → 50-ийн алхамд 450");
            Assert.Near(-200, d.Offset.Y, 1e-9, "−212 → −200");
            Assert.True(d.Moved);
        }

        [Test]
        public static void LineConstraint_ProjectsOntoTheHostDirection()
        {
            SimCamera c = Cam();
            var grab = new SimVec(0, 0, 1000);
            double r2 = Math.Sqrt(0.5);
            SimDragSession d = SimDragSession.Begin(c, grab, new SimVec(0, 0, 0), SimDragMode.Plane, new[] { r2, r2 }, 0);
            double sx, sy;
            c.Project(grab + new SimVec(100, 0, 0), W, H, out sx, out sy);
            Assert.True(d.Update(c.Ray(sx, sy, W, H)));
            Assert.Near(50, d.Offset.X, 1e-6);
            Assert.Near(50, d.Offset.Y, 1e-6);
            Assert.Near(0, d.Offset.Z, 1e-9);
            // Шугамд хөндлөн чирсэн нь тэг.
            c.Project(grab + new SimVec(100, -100, 0), W, H, out sx, out sy);
            Assert.True(d.Update(c.Ray(sx, sy, W, H)));
            Assert.Near(0, d.Offset.Length, 1e-6, "хөндлөн чирэлт хаалгыг хананаас гаргахгүй");
        }

        [Test]
        public static void AxisMode_LatchesToTheDominantAxis()
        {
            SimCamera c = Cam();
            var grab = new SimVec(0, 0, 0);
            SimDragSession d = SimDragSession.Begin(c, grab, new SimVec(0, 0, 0), SimDragMode.Axis, null, 0);
            double sx, sy;
            c.Project(grab + new SimVec(300, 60, 0), W, H, out sx, out sy);
            d.Update(c.Ray(sx, sy, W, H));
            Assert.Near(300, d.Offset.X, 1e-6);
            Assert.Near(0, d.Offset.Y, 1e-9);
            // Түгжигдсэний дараа Y-ийн хөдөлгөөн X-ийг эргүүлэхгүй.
            c.Project(grab + new SimVec(120, 500, 0), W, H, out sx, out sy);
            d.Update(c.Ray(sx, sy, W, H));
            Assert.Near(120, d.Offset.X, 1e-6);
            Assert.Near(0, d.Offset.Y, 1e-9);
        }

        [Test]
        public static void Vertical_MovesOnlyZ_AndIsRefusedFromTopView()
        {
            SimCamera c = Cam();
            var grab = new SimVec(500, 500, 1000);
            SimDragSession d = SimDragSession.Begin(c, grab, new SimVec(0, 0, 0), SimDragMode.Vertical, null, 0);
            Assert.NotNull(d);
            double sx, sy;
            c.Project(grab + new SimVec(0, 0, 400), W, H, out sx, out sy);
            Assert.True(d.Update(c.Ray(sx, sy, W, H)));
            Assert.Near(0, d.Offset.X, 1e-9);
            Assert.Near(0, d.Offset.Y, 1e-9);
            Assert.Near(400, d.Offset.Z, 1e-3);

            var top = new SimCamera { Target = new SimVec(0, 0, 0), Distance = 8000 };
            top.SetTopView();
            Assert.Null(SimDragSession.Begin(top, grab, new SimVec(0, 0, 0), SimDragMode.Vertical, null, 0), "дээрээс харахад босоо чирэх чиглэл алга");
        }

        [Test]
        public static void Drag_NearHorizonRay_IsIgnored_NotAHugeJump()
        {
            var c = new SimCamera { Target = new SimVec(0, 0, 0), Distance = 8000, Pitch = 0.01 };
            c.Recompute();
            SimDragSession d = SimDragSession.Begin(c, new SimVec(0, 0, 0), new SimVec(0, 0, 0), SimDragMode.Plane, null, 0);
            // Тэнгэр рүү чиглэсэн цацраг хавтгайг огтлохгүй (t < 0).
            Assert.False(d.Update(c.Ray(W / 2, 0, W, H)));
            Assert.Near(0, d.Offset.Length, 1e-9);
        }

        [Test]
        public static void Zoom_KeepsThePointUnderTheCursorFixed()
        {
            SimCamera c = Cam();
            double px = W * 0.75, py = H * 0.35;
            SimRay r0 = c.Ray(px, py, W, H);
            double t0 = SimCamera.Intersect(r0, c.Target, c.Forward);
            SimVec before = r0.At(t0);
            c.Zoom(3, px, py, W, H);
            SimRay r1 = c.Ray(px, py, W, H);
            double t1 = SimCamera.Intersect(r1, c.Target, c.Forward);
            SimVec after = r1.At(t1);
            Assert.Near(0, (before - after).Length, 1e-3);
            Assert.True(c.Distance < 9000);
        }

        [Test]
        public static void Fit_PutsEveryCornerInsideTheViewport()
        {
            var box = new SimBox { MinX = -3000, MinY = -1500, MinZ = 0, MaxX = 4000, MaxY = 2500, MaxZ = 3000 };
            foreach (bool top in new[] { false, true })
            {
                var c = new SimCamera();
                if (top) c.SetTopView(); else c.SetIsoView();
                c.Fit(box, W, H);
                for (int i = 0; i < 8; i++)
                {
                    var p = new SimVec((i & 1) == 0 ? box.MinX : box.MaxX, (i & 2) == 0 ? box.MinY : box.MaxY, (i & 4) == 0 ? box.MinZ : box.MaxZ);
                    double sx, sy;
                    Assert.True(c.Project(p, W, H, out sx, out sy));
                    Assert.True(sx >= 0 && sx <= W && sy >= 0 && sy <= H, "top=" + top + " corner " + i + " → " + sx + "," + sy);
                }
            }
        }

        [Test]
        public static void OrbitPanZoom_AreBoundedAndKeepTheTarget()
        {
            SimCamera c = Cam();
            c.Orbit(100000, 100000);
            Assert.True(c.Pitch <= Math.PI / 2, "pitch хязгаартай");
            c.Orbit(-100000, -100000);
            Assert.True(c.Pitch >= -Math.PI / 2);
            SimVec t0 = c.Target;
            c.Orbit(40, 10);
            Assert.Near(0, (c.Target - t0).Length, 1e-9, "орбит Target-ийг хөдөлгөхгүй");
            Assert.Near(c.Distance, (c.Position - c.Target).Length, 1e-6);
            c.Pan(100, 0, W);
            Assert.True((c.Target - t0).Length > 1);
            c.Zoom(500, W / 2, H / 2, W, H);
            Assert.True(c.Distance >= SimCamera.MinDistanceMm - 1e-9, "хэт ойртохгүй");
            c.Zoom(-5000, W / 2, H / 2, W, H);
            Assert.True(c.Distance <= SimCamera.MaxDistanceMm + 1e-6, "хэт холдохгүй");
        }

        [Test]
        public static void Pick_FindsMovingAtItsShiftedPosition_AndTheNearestContext()
        {
            SimMesh moving = SimMeshBuilder.Box("h:1", 0, 0, 0, 500, 500, 500, SimRole.Moving);
            SimMesh near = SimMeshBuilder.Box("h:2", 2000, -100, -100, 2200, 600, 600);
            SimMesh far = SimMeshBuilder.Box("h:3", 3000, -100, -100, 3200, 600, 600);
            var scene = new SimScene();
            scene.Moving.Add(moving);
            scene.Context.Add(far); scene.Context.Add(near);

            var ray = new SimRay { Origin = new SimVec(-1000, 250, 250), Dir = new SimVec(1, 0, 0) };
            SimPick.Result r0 = SimPick.Nearest(scene, new SimVec(0, 0, 0), ray);
            Assert.True(r0.IsMoving);
            Assert.Near(1000, r0.T, 1e-6);

            // 1000 мм зөөсний дараа тэр байранд элемент алга; ойр орчин нь түрүүлж цохигдоно.
            SimPick.Result r1 = SimPick.Nearest(scene, new SimVec(1000, 0, 0), ray);
            Assert.True(r1.IsMoving, "шилжсэн moving (1000..1500) түрүүлж");
            Assert.Near(2000, r1.T, 1e-6);

            SimPick.Result r2 = SimPick.Nearest(scene, new SimVec(0, 5000, 0), ray);       // moving ердөө хажуугаар
            Assert.False(r2.IsMoving);
            Assert.Eq("h:2", r2.Key);
            Assert.Null(SimPick.Moving(scene, new SimVec(0, 5000, 0), ray));
        }
    }
}
