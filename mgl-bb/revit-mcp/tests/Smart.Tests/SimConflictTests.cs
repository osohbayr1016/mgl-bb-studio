using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using RevitMcpAddin.ChangeImpact.Core;

namespace RevitMcpAddin.Smart.Tests
{
    /// <summary>
    /// Хулганаар чирэх simulation-ийн ЦЭВЭР огтлолцлын хөдөлгүүр: гурвалжин-гурвалжин (шүргэлт ≠ мөргөлдөөн), BVH, ДОТОР байх, шинэ/хуучин давхцал.
    /// Revit-гүй — синтетик хайрцгууд.
    /// </summary>
    public static class SimConflictTests
    {
        private static SimScene Scene(SimMesh moving, params SimMesh[] ctx)
        {
            moving.Role = SimRole.Moving;
            var s = new SimScene();
            s.Moving.Add(moving);
            s.Context.AddRange(ctx);
            return s;
        }

        /* ============================== ГУРВАЛЖИН ============================ */

        [Test]
        public static void Box_IsClosed_AndOpenBoxIsNot()
        {
            SimMesh m = SimMeshBuilder.Box("h:1", 0, 0, 0, 100, 100, 100);
            Assert.Eq(12, m.TriangleCount);
            Assert.Eq(8, m.VertexCount);
            Assert.True(m.IsClosed, "хайрцаг хаалттай");

            var open = new SimMesh { Key = "h:2", Xyz = m.Xyz, Tri = m.Tri.Take(33).ToArray() };
            Assert.False(open.IsClosed, "нэг гурвалжин хасвал нээлттэй");
        }

        [Test]
        public static void TouchingFaces_AreNotACrossing()
        {
            // Хоёр хайрцаг нүүрээрээ ЯГ шүргэнэ (хаалга нүхэнд, хана шалан дээр).
            SimMesh a = SimMeshBuilder.Box("h:1", 0, 0, 0, 1000, 1000, 1000);
            SimMesh b = SimMeshBuilder.Box("h:2", 1000, 0, 0, 2000, 1000, 1000);
            SimScene s = Scene(a, b);
            SimConflictResult r = SimConflicts.Evaluate(s, new SimVec(0, 0, 0));
            Assert.Eq(0, r.Hits.Count, "шүргэлт = мөргөлдөөн биш");
        }

        [Test]
        public static void SmallOverlap_BelowTolerance_IsIgnored_AboveIsReported()
        {
            SimMesh a = SimMeshBuilder.Box("h:1", 0, 0, 0, 1000, 1000, 1000);
            SimMesh b = SimMeshBuilder.Box("h:2", 1000, 0, 0, 2000, 1000, 1000);
            SimScene s = Scene(a, b);
            Assert.Eq(0, SimConflicts.Evaluate(s, new SimVec(3, 0, 0)).Hits.Count, "3 мм давхцал < 6 мм хүлцэл");
            SimConflictResult r = SimConflicts.Evaluate(s, new SimVec(80, 0, 0));
            Assert.Eq(1, r.Hits.Count, "80 мм давхцал");
            Assert.True(r.Hits[0].DepthMm >= 6, "depth=" + r.Hits[0].DepthMm);
            Assert.True(r.Hits[0].CrossingPairs > 0 || r.Hits[0].Volumetric, "flush хайрцаг: эзлэхүүнээр");
        }

        [Test]
        public static void MovingIntoAnotherBox_FindsIt_AndRegionIsInsideOverlap()
        {
            SimMesh a = SimMeshBuilder.Box("h:1", 0, 0, 0, 1000, 1000, 1000);
            SimMesh b = SimMeshBuilder.Box("h:2", 1500, 0, 0, 2500, 1000, 1000);
            SimScene s = Scene(a, b);
            Assert.Eq(0, SimConflicts.Evaluate(s, new SimVec(0, 0, 0)).Hits.Count);
            SimConflictResult r = SimConflicts.Evaluate(s, new SimVec(1000, 0, 0));      // a: 1000..2000 → b-тэй 500 давхцал
            Assert.Eq(1, r.Hits.Count);
            SimHit h = r.Hits[0];
            Assert.Eq("h:2", h.Key);
            Assert.False(h.Region.IsEmpty);
            Assert.True(h.Region.MinX >= 1500 - 1e-6 && h.Region.MaxX <= 2000 + 1e-6, "region x " + h.Region.MinX + ".." + h.Region.MaxX);
            Assert.Near(500, h.OverlapBox.Size.X, 1e-6);
        }

        [Test]
        public static void ThinWall_CrossedByMovingBox_IsReported()
        {
            SimMesh thin = SimMeshBuilder.Box("h:2", -5000, 600, 0, 5000, 800, 3000, SimRole.Context, SimKind.Wall);
            SimMesh a = SimMeshBuilder.Box("h:1", 0, 0, 0, 500, 500, 500);
            SimScene s = Scene(a, thin);
            Assert.Eq(0, SimConflicts.Evaluate(s, new SimVec(0, 0, 0)).Hits.Count);
            SimConflictResult r = SimConflicts.Evaluate(s, new SimVec(0, 400, 0));      // a: y 400..900 — ханыг дайрна
            Assert.Eq(1, r.Hits.Count);
            Assert.Eq(SimKind.Wall, r.Hits[0].Kind);
            Assert.False(r.Hits[0].Volumetric);
        }

        [Test]
        public static void SmallBoxFullyInsideBigSolid_IsVolumetric_BothDirections()
        {
            SimMesh big = SimMeshBuilder.Box("h:2", 0, 0, 0, 2000, 2000, 2000);
            SimMesh small = SimMeshBuilder.Box("h:1", 800, 800, 800, 1000, 1000, 1000);
            SimConflictResult r = SimConflicts.Evaluate(Scene(small, big), new SimVec(0, 0, 0));
            Assert.Eq(1, r.Hits.Count, "жижиг нь том биеийн дотор");
            Assert.True(r.Hits[0].Volumetric);
            Assert.Eq(0, r.Hits[0].CrossingPairs);

            // Урвуу: том нь зөөгдөж, жижиг орчин нь дотор нь.
            SimMesh bigMoving = SimMeshBuilder.Box("h:3", 0, 0, 0, 2000, 2000, 2000);
            SimMesh smallCtx = SimMeshBuilder.Box("h:4", 800, 800, 800, 1000, 1000, 1000);
            SimConflictResult r2 = SimConflicts.Evaluate(Scene(bigMoving, smallCtx), new SimVec(0, 0, 0));
            Assert.Eq(1, r2.Hits.Count);
            Assert.True(r2.Hits[0].Volumetric);
        }

        [Test]
        public static void OpenMesh_NeverClaimsContainment()
        {
            SimMesh big = SimMeshBuilder.Box("h:2", 0, 0, 0, 2000, 2000, 2000);
            var open = new SimMesh { Key = "h:2", Xyz = big.Xyz, Tri = big.Tri.Take(30).ToArray(), Role = SimRole.Context };
            SimMesh small = SimMeshBuilder.Box("h:1", 800, 800, 800, 1000, 1000, 1000);
            SimConflictResult r = SimConflicts.Evaluate(Scene(small, open), new SimVec(0, 0, 0));
            Assert.Eq(0, r.Hits.Count, "нээлттэй сүлжээний «дотор»-ыг таамаглахгүй");
        }

        [Test]
        public static void PreExistingOverlap_IsNotNew_UntilItWorsens()
        {
            SimMesh a = SimMeshBuilder.Box("h:1", 0, 0, 0, 1000, 1000, 1000);
            SimMesh b = SimMeshBuilder.Box("h:2", 900, 0, 0, 2000, 1000, 1000);          // 100 мм давхцсан
            SimScene s = Scene(a, b);
            SimConflictResult baseline = SimConflicts.Evaluate(s, new SimVec(0, 0, 0));
            Assert.Eq(1, baseline.Hits.Count);

            SimConflictResult same = SimConflicts.Evaluate(s, new SimVec(5, 0, 0), null, baseline);
            Assert.Eq(1, same.Hits.Count);
            Assert.True(same.Hits[0].PreExisting);
            Assert.False(same.Hits[0].IsNew, "бараг ижил давхцал — шинэ биш");
            Assert.Eq(0, same.NewCount);

            SimConflictResult worse = SimConflicts.Evaluate(s, new SimVec(300, 0, 0), null, baseline);
            Assert.True(worse.Hits[0].Worsened, "давхцал 100 → 400: улам дордсон");
            Assert.True(worse.Hits[0].IsNew);
        }

        [Test]
        public static void IgnoredContext_AndMovingOnlyScenes_AreSkipped()
        {
            SimMesh a = SimMeshBuilder.Box("h:1", 0, 0, 0, 1000, 1000, 1000);
            SimMesh host = SimMeshBuilder.Box("h:2", 500, 0, 0, 1500, 1000, 1000);
            host.IgnoreConflicts = true;
            Assert.Eq(0, SimConflicts.Evaluate(Scene(a, host), new SimVec(0, 0, 0)).Hits.Count, "хост хана мөргөлдөөнд оролцохгүй");
            Assert.Eq(0, SimConflicts.Evaluate(new SimScene(), new SimVec(0, 0, 0)).Hits.Count);
            Assert.Eq(0, SimConflicts.Evaluate(null, new SimVec(0, 0, 0)).Hits.Count);
        }

        [Test]
        public static void ReactiveContext_IsFlagged_AndSortedAfterRealOnes()
        {
            SimMesh a = SimMeshBuilder.Box("h:1", 0, 0, 0, 1000, 1000, 1000);
            SimMesh reactive = SimMeshBuilder.Box("h:2", 1500, 0, 0, 2500, 1000, 1000);
            reactive.Reactive = true;
            SimMesh real = SimMeshBuilder.Box("h:3", 1700, 0, 0, 2700, 1000, 1000);
            SimConflictResult r = SimConflicts.Evaluate(Scene(a, reactive, real), new SimVec(1000, 0, 0));
            Assert.Eq(2, r.Hits.Count);
            Assert.False(r.Hits[0].Reactive, "жинхэнэ нь эхэнд");
            Assert.True(r.Hits[1].Reactive);
        }

        [Test]
        public static void MultipleMovingParts_EachIsTested()
        {
            SimMesh a = SimMeshBuilder.Box("h:1", 0, 0, 0, 500, 500, 500);
            SimMesh a2 = SimMeshBuilder.Box("h:9", 0, 2000, 0, 500, 2500, 500);      // хоёр дахь зөөгдөх хэсэг (хост хаалга г.м.)
            a2.Role = SimRole.Moving;
            SimMesh target = SimMeshBuilder.Box("h:2", 1000, 1900, 0, 1500, 2600, 500);
            SimScene s = Scene(a, target);
            s.Moving.Add(a2);
            Assert.Eq(0, SimConflicts.Evaluate(s, new SimVec(0, 0, 0)).Hits.Count);
            SimConflictResult r = SimConflicts.Evaluate(s, new SimVec(700, 0, 0));      // a2 нь target руу орно
            Assert.Eq(1, r.Hits.Count);
        }

        [Test]
        public static void CollinearWalls_SlidIntoEachOther_AreDetected_ByVolume_NotSurfaces()
        {
            // Ижил зузаан, ижил өндөртэй хоёр хана ГАНЦ шугамд: нүүр бүр зэрэгцэн (flush) тул ямар ч гурвалжин огтлолцохгүй — гэхдээ ЭЗЛЭХҮҮН давхцана.
            SimMesh wallA = SimMeshBuilder.Box("h:1", 0, 0, 0, 3000, 200, 3000, SimRole.Moving, SimKind.Wall);
            SimMesh wallB = SimMeshBuilder.Box("h:2", 3200, 0, 0, 6000, 200, 3000, SimRole.Context, SimKind.Wall);
            SimScene s = Scene(wallA, wallB);
            Assert.Eq(0, SimConflicts.Evaluate(s, new SimVec(0, 0, 0)).Hits.Count, "тусдаа");
            Assert.Eq(0, SimConflicts.Evaluate(s, new SimVec(200, 0, 0)).Hits.Count, "яг шүргэсэн");
            Assert.Eq(0, SimConflicts.Evaluate(s, new SimVec(203, 0, 0)).Hits.Count, "3 мм давхцал < хүлцэл");
            SimConflictResult r = SimConflicts.Evaluate(s, new SimVec(500, 0, 0));      // 300 мм давхцал
            Assert.Eq(1, r.Hits.Count, "нэг шугамын ханын давхцал");
            Assert.True(r.Hits[0].Volumetric);
            Assert.Eq(0, r.Hits[0].CrossingPairs);
            Assert.Near(200, r.Hits[0].DepthMm, 1e-6);      // давхцлын ХАМГИЙН ЖИЖИГ хэмжээс = ханын зузаан (бүтэн зузаанаараа давхцсан)
        }

        [Test]
        public static void FlushOverlap_DepthGrowsWhenMovedFurther_SoWorsenedIsReported()
        {
            SimMesh a = SimMeshBuilder.Box("h:1", 0, 0, 0, 1000, 1000, 1000);
            SimMesh b = SimMeshBuilder.Box("h:2", 900, 0, 0, 2000, 1000, 1000);          // 100 мм давхцсан, flush
            SimScene s = Scene(a, b);
            SimConflictResult baseline = SimConflicts.Evaluate(s, new SimVec(0, 0, 0));
            Assert.Eq(1, baseline.Hits.Count);
            Assert.Near(100, baseline.Hits[0].DepthMm, 1e-6);
            Assert.True(SimConflicts.Evaluate(s, new SimVec(5, 0, 0), null, baseline).Hits[0].PreExisting);
            Assert.False(SimConflicts.Evaluate(s, new SimVec(5, 0, 0), null, baseline).Hits[0].IsNew);
            Assert.True(SimConflicts.Evaluate(s, new SimVec(300, 0, 0), null, baseline).Hits[0].Worsened);
        }

        [Test]
        public static void Oriented_Box_HasOutwardSign_AndSamples()
        {
            SimMesh m = SimMeshBuilder.Box("h:1", 0, 0, 0, 100, 100, 100);
            Assert.True(m.IsOriented, "Box() нүүрүүд нэг чиглэлтэй");
            Assert.Eq(1, m.OutwardSign);
            Assert.True(m.Samples.Length >= 12);
            foreach (SimSample sm in m.Samples) Assert.Near(1.0, sm.Normal.Length, 1e-9);
            Assert.False(SimConflicts.Inside(m, new SimVec(500, 50, 50)));
            Assert.True(SimConflicts.Inside(m, new SimVec(50, 50, 50)));
        }

        /* ============================== BVH = БРУТ ФОРС ===================== */

        private static SimMesh RandomSoup(string key, int seed, int triangles, double spread, double size)
        {
            var rnd = new Random(seed);
            var b = new SimMeshBuilder(0.0001);
            for (int i = 0; i < triangles; i++)
            {
                double cx = rnd.NextDouble() * spread, cy = rnd.NextDouble() * spread, cz = rnd.NextDouble() * spread;
                b.AddTriangle(
                    cx + rnd.NextDouble() * size, cy + rnd.NextDouble() * size, cz + rnd.NextDouble() * size,
                    cx + rnd.NextDouble() * size, cy + rnd.NextDouble() * size, cz + rnd.NextDouble() * size,
                    cx + rnd.NextDouble() * size, cy + rnd.NextDouble() * size, cz + rnd.NextDouble() * size);
            }
            var m = new SimMesh { Key = key };
            b.Fill(m);
            return m;
        }

        [Test]
        public static void Bvh_FindsExactlyTheBruteForcePairs()
        {
            SimMesh a = RandomSoup("h:1", 11, 250, 1000, 300);
            SimMesh b = RandomSoup("h:2", 22, 250, 1000, 300);
            var off = new SimVec(37, -21, 9);
            const double eps = 2;

            var brute = new HashSet<long>();
            for (int i = 0; i < a.TriangleCount; i++)
                for (int j = 0; j < b.TriangleCount; j++)
                {
                    double d; SimVec p0, p1;
                    if (SimTri.Crossing(a.Xyz, a.Tri, i, off, b.Xyz, b.Tri, j, eps, out d, out p0, out p1)) brute.Add(i * 100000L + j);
                }

            var viaBvh = new HashSet<long>();
            SimBvh.OverlapPairs(a.Bvh, off, b.Bvh, eps, (i, j) =>
            {
                double d; SimVec p0, p1;
                if (SimTri.Crossing(a.Xyz, a.Tri, i, off, b.Xyz, b.Tri, j, eps, out d, out p0, out p1)) viaBvh.Add(i * 100000L + j);
                return true;
            });

            Assert.True(brute.Count > 20, "туршилтад хангалттай олон огтлолцол бий: " + brute.Count);
            Assert.True(brute.SetEquals(viaBvh), "BVH = брут форс (" + brute.Count + " vs " + viaBvh.Count + ")");
        }

        [Test]
        public static void Triangle_CoplanarAndEdgeTouch_AreNotCrossings()
        {
            // Хоёр хавтгай (z=0) гурвалжин давхцсан.
            var xa = new double[] { 0, 0, 0, 100, 0, 0, 0, 100, 0 };
            var xb = new double[] { 10, 10, 0, 90, 10, 0, 10, 60, 0 };
            var t = new[] { 0, 1, 2 };
            double d; SimVec p0, p1;
            Assert.False(SimTri.Crossing(xa, t, 0, default(SimVec), xb, t, 0, 1, out d, out p0, out p1), "хавтгай давхцал");

            // Босоо гурвалжин нь хавтгай гурвалжны ИРМЭГ дээр л шүргэнэ (оройгоор).
            var xc = new double[] { 50, 0, 0, 50, 0, 100, 60, 0, 100 };
            Assert.False(SimTri.Crossing(xc, t, 0, default(SimVec), xa, t, 0, 1, out d, out p0, out p1), "орой хавтгайд хүрсэн");

            // Харин гүнзгий дайрсан нь огтлолцол.
            var xd = new double[] { 20, 20, -50, 20, 20, 50, 60, 20, 0 };
            Assert.True(SimTri.Crossing(xd, t, 0, default(SimVec), xa, t, 0, 1, out d, out p0, out p1), "дайрсан");
            Assert.True(d >= 1);
        }

        [Test]
        public static void RayFirst_ReturnsNearestHit_AndMissesBeyond()
        {
            SimMesh a = SimMeshBuilder.Box("h:1", 100, -50, -50, 200, 50, 50);
            double t; int tri;
            Assert.True(a.Bvh.RayFirst(new SimVec(0, 0, 0), new SimVec(1, 0, 0), out t, out tri));
            Assert.Near(100, t, 1e-6);
            Assert.False(a.Bvh.RayFirst(new SimVec(0, 0, 0), new SimVec(-1, 0, 0), out t, out tri), "эсрэг чиглэл");
            Assert.False(a.Bvh.RayFirst(new SimVec(0, 500, 0), new SimVec(1, 0, 0), out t, out tri), "дээгүүр өнгөрнө");
            Assert.Eq(2, a.Bvh.RayCount(new SimVec(0, 0, 0), new SimVec(1, 0, 0)), "хайрцаг: орох, гарах");
            Assert.Eq(1, a.Bvh.RayCount(new SimVec(150, 0, 0), new SimVec(1, 0, 0)), "дотроос: гарах");
        }

        [Test]
        public static void RayFirst_FromAbove_HitsTheTopFaceFirst_NotTheBottom()
        {
            SimMesh a = SimMeshBuilder.Box("h:1", 0, 0, 0, 1000, 1000, 2000);
            double t; int tri;
            Assert.True(a.Bvh.RayFirst(new SimVec(870, 482, 9000), new SimVec(0, 0, -1), out t, out tri));
            Assert.Near(7000, t, 1e-6, "дээд нүүр (z=2000) түрүүлж");
            // Налуу цацраг (хулганы цацраг шиг).
            SimVec d = new SimVec(-0.09, 0.02, -1).Normalized();
            Assert.True(a.Bvh.RayFirst(new SimVec(1500, 342.5, 8998.6), d, out t, out tri));
            SimVec p = new SimVec(1500, 342.5, 8998.6) + d * t;
            Assert.Near(2000, p.Z, 1e-3, "налуу цацраг ч дээд нүүрийг түрүүлж цохино: " + p);
        }

        [Test]
        public static void RayThroughTheSharedDiagonal_StillHitsTheNearFace()
        {
            // Хайрцгийн дээд нүүр хоёр гурвалжинд (4,6 диагональ) хуваагдсан; хулганы цацраг ЯГ диагоналиар дайрч болно — ард нүүрийг (z=0) биш ойр нүүрийг цохино.
            SimMesh a = SimMeshBuilder.Box("h:1", 0, 0, 0, 1000, 1000, 2000);
            double t; int tri;
            Assert.True(a.Bvh.RayFirst(new SimVec(500, 500, 9000), new SimVec(0, 0, -1), out t, out tri));
            Assert.Near(7000, t, 1e-6);
            Assert.True(a.Bvh.RayFirst(new SimVec(1500, 342.50803893940156, 8998.62191017054), new SimVec(-0.08539637308923258, 0.022415403775476243, -0.9960948795856682), out t, out tri));
            Assert.True(t < 8000, "ойр нүүр: t=" + t);
            // Диагоналийн хоёр талын параметр: давхар тоологдохгүй.
            Assert.Eq(2, a.Bvh.RayCount(new SimVec(500, 500, 9000), new SimVec(0, 0, -1)), "орох, гарах — диагональд давхардахгүй");
        }

        [Test]
        public static void Weld_MergesCoincidentVertices_AndDropsDegenerates()
        {
            var b = new SimMeshBuilder(0.01);
            b.AddTriangle(0, 0, 0, 10, 0, 0, 0, 10, 0);
            b.AddTriangle(10, 0, 0, 10, 10, 0, 0, 10, 0);
            b.AddTriangle(0, 0, 0, 0, 0, 0, 5, 5, 5);                 // доройтсон
            var m = new SimMesh();
            b.Fill(m);
            Assert.Eq(2, m.TriangleCount);
            Assert.Eq(4, m.VertexCount);
        }

        [Test]
        public static void TriangleBudget_TruncatesAndFlags()
        {
            var b = new SimMeshBuilder(0.01, 3);
            for (int i = 0; i < 10; i++) b.AddTriangle(i, 0, 0, i + 1, 0, 0, i, 1, 0);
            var m = new SimMesh();
            b.Fill(m);
            Assert.Eq(3, m.TriangleCount);
            Assert.True(m.Truncated);
            Assert.False(m.IsClosed, "тайрагдсан сүлжээ хаалттай гэж үзэхгүй");
        }

        [Test]
        public static void LargeScene_StaysInteractive()
        {
            // ~24 000 гурвалжин (орчин) + 6 000 (зөөгдөх) — хулганы нэг хөдөлгөөн секундын хэдэн мянганы нэг.  Хэмжилт: консол руу, босго сул (CI-ийн хурдаас хамаарахгүй).
            SimMesh ctx = RandomSoup("h:2", 5, 24000, 20000, 400);
            SimMesh mv = RandomSoup("h:1", 6, 6000, 3000, 400);
            SimScene s = Scene(mv, ctx);
            SimConflicts.Evaluate(s, new SimVec(0, 0, 0));       // BVH бүтээлт (нэг удаа)
            var sw = Stopwatch.StartNew();
            SimConflictResult r = SimConflicts.Evaluate(s, new SimVec(300, 200, 0));
            sw.Stop();
            Console.WriteLine("      [sim-perf] 6k × 24k тri: " + sw.Elapsed.TotalMilliseconds.ToString("0.0") + " ms, hits=" + r.Hits.Count + ", pairs=" + r.TrianglePairsTested);
            Assert.True(sw.Elapsed.TotalMilliseconds < 2000, "хэт удаан: " + sw.Elapsed.TotalMilliseconds);
        }
    }
}
