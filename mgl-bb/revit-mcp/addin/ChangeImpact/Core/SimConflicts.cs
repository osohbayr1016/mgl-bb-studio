using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;

namespace RevitMcpAddin.ChangeImpact.Core
{
    public sealed class SimConflictOptions
    {
        /// <summary>Хоёр тал руу ЭНЭ хэмжээнээс илүү нэвтэрсэн (мм) гурвалжин л огтлолцол — шүргэлт, бага зэргийн давхцал мөргөлдөөн БИШ.</summary>
        public double PenetrationMm { get; set; } = 6;
        /// <summary>Нэг элементтэй хоёр гурвалжингийн хос олдсоны дараа зогсоох тоо (бүх хосыг цуглуулах нь зөвхөн ХҮРЭЭ харуулахад шаардлагагүй).</summary>
        public int MaxPairsPerContext { get; set; } = 48;
        /// <summary>Нэг шалгалтад хураах мөргөлдөөнтэй элементийн дээд тоо.</summary>
        public int MaxHits { get; set; } = 400;
        /// <summary>Гадаргуу огтлолцохгүй ч нэг нь нөгөөгийнхөө ДОТОР байгааг (хаалттай биед) шалгах.</summary>
        public bool CheckContainment { get; set; } = true;
    }

    /// <summary>Нэг орчны элементтэй (зөөгдөж буй элемент(үүд) шилжсэний дараа) илрүүлсэн огтлолцол.</summary>
    public sealed class SimHit
    {
        public string Key { get; set; }
        public long Id { get; set; }
        public int Slot { get; set; }
        public string Label { get; set; }
        public string CategoryName { get; set; }
        public string LinkName { get; set; }
        public SimKind Kind { get; set; }
        /// <summary>Revit энэ элементийг автоматаар засна (нэгдсэн хана, join) — мэдээллийн шинжтэй, шийдвэрийг хүндрүүлэхгүй.</summary>
        public bool Reactive { get; set; }
        /// <summary>Огтлолцсон гурвалжингийн хосын тоо (<see cref="Capped"/> бол хамгийн багадаа).</summary>
        public int CrossingPairs { get; set; }
        public bool Capped { get; set; }
        /// <summary>Нэвтрэлтийн ойролцоо гүн (мм) — хос бүрийн хоёр талын нэвтрэлтийн бага нь, хамгийн их нь.  Жижиг гурвалжин олон тул ТААМАГЛАЛ.</summary>
        public double DepthMm { get; set; }
        /// <summary>
        /// ЭЗЛЭХҮҮН давхцсан боловч гадаргуу огтлолцоогүй: нэг нь нөгөөгийнхөө ДОТОР, эсвэл хоёр бие нэг хавтгайд зэрэгцээд (шугамын дагуу хана хана руу орсон) давхцсан.
        /// </summary>
        public bool Volumetric { get; set; }
        /// <summary>Огтлолцлын шугамуудын хүрээ (local мм, шилжсэний ДАРААХ байрлал) — дэлгэц дээр улаан хайрцаг болгож харуулна.</summary>
        public SimBox Region { get; set; }
        /// <summary>Хоёр элементийн хүрээний огтлолцол (шилжсэний дараа).  Region нь шугам байхад ч харагдах хэмжээтэй.</summary>
        public SimBox OverlapBox { get; set; }
        /// <summary>Хөдөлгөөнгүй (offset = 0) үед аль хэдийн давхцсан — шинэ мөргөлдөөн БИШ.</summary>
        public bool PreExisting { get; set; }
        /// <summary>Хөдөлгөөнгүй үеийнхээс ҮНЭХЭЭР их нэвтэрсэн (<see cref="SimConflicts.WorsenedMm"/>-ээс дээш).</summary>
        public bool Worsened { get; set; }
        public bool IsNew { get { return !PreExisting || Worsened; } }
    }

    public sealed class SimConflictResult
    {
        public SimVec Offset { get; set; }
        public List<SimHit> Hits { get; set; } = new List<SimHit>();
        public int CandidatesTested { get; set; }
        public long TrianglePairsTested { get; set; }
        public double Ms { get; set; }
        /// <summary>MaxHits-д хүрсэн — үлдсэн нь шалгагдаагүй.</summary>
        public bool Capped { get; set; }

        /// <summary>ШИНЭ мөргөлдөөн (хөдөлгөөнгүй үеийн давхцлыг оруулахгүй).</summary>
        public IEnumerable<SimHit> NewHits { get { return Hits.Where(h => h.IsNew); } }
        public int NewCount { get { return Hits.Count(h => h.IsNew); } }
    }

    /// <summary>
    /// Зөөгдөх элемент(үүд)-ийг `offset` (мм)-ээр шилжүүлбэл орчны элементүүдтэй хаана ОГТЛОЛЦОХЫГ хэдэн миллисекундэд тооцно — хулганаар чирэх бүрт.
    ///
    ///   1) хайрцгийн (AABB) шүүлт — зөвхөн шилжсэн хайрцагтай давхцсан орчин;
    ///   2) хоёр BVH-ийн хос ба зөвхөн ҮНЭХЭЭР нэвтэрсэн гурвалжингийн огтлолцол (<see cref="SimTri"/>);
    ///   3) гадаргуу огтлолцоогүй боловч нэг нь нөгөөгийнхөө ДОТОР (хаалттай биед) байгаа эсэх.
    ///
    /// ⚠️ Энэ нь ТҮР (урьдчилсан) дүн — Revit-ийн бодит геометр биш, зөөлттэй (coarse) тессел.  Эцсийн дүн нь Revit sandbox (`SimExact`).
    /// </summary>
    public static class SimConflicts
    {
        /// <summary>Хөдөлгөөнгүй үеийнхээс ЭНЭ хэмжээнээс (мм) илүү гүн нэвтэрсэн бол «улам дордсон».</summary>
        public const double WorsenedMm = 15;

        public static SimConflictResult Evaluate(SimScene scene, SimVec offset, SimConflictOptions opts = null, SimConflictResult baseline = null)
        {
            var sw = Stopwatch.StartNew();
            if (opts == null) opts = new SimConflictOptions();
            var res = new SimConflictResult { Offset = offset };
            if (scene == null || scene.Moving.Count == 0) return res;

            var baseByKey = new Dictionary<string, SimHit>(StringComparer.Ordinal);
            if (baseline != null) foreach (SimHit h in baseline.Hits) baseByKey[h.Key] = h;

            double eps = opts.PenetrationMm;
            var movedBoxes = new List<SimBox>();
            foreach (SimMesh m in scene.Moving) movedBoxes.Add(m.Bounds.Translated(offset));
            SimBox movedAll = SimBox.Empty();
            foreach (SimBox b in movedBoxes) movedAll.Add(b);

            foreach (SimMesh ctx in scene.Context)
            {
                if (res.Hits.Count >= opts.MaxHits) { res.Capped = true; break; }
                if (ctx.IgnoreConflicts) continue;
                SimBox cb = ctx.Bounds;
                if (!cb.Overlaps(movedAll, 0)) continue;
                res.CandidatesTested++;

                var hit = new SimHit
                {
                    Key = ctx.Key, Id = ctx.Id, Slot = ctx.Slot, Label = ctx.Label, CategoryName = ctx.CategoryName, LinkName = ctx.LinkName, Kind = ctx.Kind,
                    Reactive = ctx.Reactive,
                };
                SimBox region = SimBox.Empty();
                SimBox overlap = SimBox.Empty();
                int pairs = 0;
                double depth = 0;
                bool contained = false;

                for (int mi = 0; mi < scene.Moving.Count; mi++)
                {
                    SimMesh mv = scene.Moving[mi];
                    SimBox mb = movedBoxes[mi];
                    if (!mb.Overlaps(cb, 0)) continue;
                    overlap.Add(mb.Intersection(cb));

                    SimMesh mvLocal = mv;
                    SimBvh.OverlapPairs(mv.Bvh, offset, ctx.Bvh, eps, (ta, tb) =>
                    {
                        res.TrianglePairsTested++;
                        double d; SimVec p0, p1;
                        if (!SimTri.Crossing(mvLocal.Xyz, mvLocal.Tri, ta, offset, ctx.Xyz, ctx.Tri, tb, eps, out d, out p0, out p1)) return true;
                        pairs++;
                        if (d > depth) depth = d;
                        region.Add(p0.X, p0.Y, p0.Z);
                        region.Add(p1.X, p1.Y, p1.Z);
                        return pairs < opts.MaxPairsPerContext;
                    });
                    if (pairs >= opts.MaxPairsPerContext) break;
                }

                if (pairs == 0 && opts.CheckContainment)
                {
                    for (int mi = 0; mi < scene.Moving.Count && !contained; mi++)
                    {
                        SimMesh mv = scene.Moving[mi];
                        SimBox mb = movedBoxes[mi];
                        SimBox ov = mb.Intersection(cb);
                        if (ov.IsEmpty) continue;
                        // ЭЗЛЭХҮҮНИЙ давхцал: нэг биеийн ДОТООД дээж цэг нөгөөгийнхөө дотор (гадаргуу огтлолцохгүй ч — нэг шугамын хана, нэг нь нөгөөдөө шургасан).
                        if (VolumeOverlap(mv, offset, ctx, new SimVec(0, 0, 0), eps, ov) || VolumeOverlap(ctx, new SimVec(0, 0, 0), mv, offset, eps, ov))
                        {
                            contained = true;
                            region.Add(ov);
                            overlap.Add(ov);
                        }
                    }
                }

                if (pairs == 0 && !contained) continue;

                hit.CrossingPairs = pairs;
                hit.Capped = pairs >= opts.MaxPairsPerContext;
                // Гадаргуу огтлолцоогүй (зөвхөн эзлэхүүн) бол гүн = хоёр хүрээний давхцлын хамгийн жижиг хэмжээс (ойролцоо).
                if (pairs == 0 && contained && !overlap.IsEmpty) { SimVec sz = overlap.Size; depth = Math.Min(sz.X, Math.Min(sz.Y, sz.Z)); }
                hit.DepthMm = depth;
                hit.Volumetric = contained;
                hit.Region = region;
                hit.OverlapBox = overlap;

                SimHit b0;
                if (baseByKey.TryGetValue(ctx.Key, out b0))
                {
                    hit.PreExisting = true;
                    hit.Worsened = hit.DepthMm > b0.DepthMm + WorsenedMm;
                }
                res.Hits.Add(hit);
            }

            res.Hits = res.Hits
                .OrderByDescending(h => h.IsNew).ThenBy(h => h.Reactive).ThenByDescending(h => h.DepthMm).ThenByDescending(h => h.CrossingPairs)
                .ToList();
            res.Ms = sw.Elapsed.TotalMilliseconds;
            return res;
        }

        /// <summary>
        /// `a`-ийн (`aPos`-оор шилжсэн) ДОТООД цэг — гадаргуунаас `eps`-ээр дотогш — `b` (`bPos`-оор шилжсэн)-ийн дотор уу.
        /// `ov` = хоёр хайрцгийн давхцал (дэлхийн/орчны координатад) — зөвхөн тэнд байгаа дээжийг шалгана.
        /// ⚠️ Хоёулаа ХААЛТТАЙ сүлжээнд л; нээлттэй бол юу ч таамаглахгүй (false).
        /// </summary>
        private static bool VolumeOverlap(SimMesh a, SimVec aPos, SimMesh b, SimVec bPos, double eps, SimBox ov)
        {
            if (!a.IsClosed || !b.IsClosed) return false;
            SimBox padded = ov.Expanded(eps + 1);
            int tested = 0;
            foreach (SimSample sm in a.Samples)
            {
                SimVec cw = sm.Center + aPos;
                if (cw.X < padded.MinX || cw.X > padded.MaxX || cw.Y < padded.MinY || cw.Y > padded.MaxY || cw.Z < padded.MinZ || cw.Z > padded.MaxZ) continue;
                if (++tested > 24) break;
                SimVec n = sm.Normal;
                SimVec pick;
                if (a.IsOriented) pick = cw - n * (a.OutwardSign * eps);        // биеийн дотогш
                else
                {
                    // Эргэлт тодорхойгүй — аль тал нь a-ийн ДОТОР болохыг цацрагаар шийднэ.
                    SimVec p1 = cw + n * eps, p2 = cw - n * eps;
                    if (SimConflicts.Inside(a, p1 - aPos)) pick = p1;
                    else if (SimConflicts.Inside(a, p2 - aPos)) pick = p2;
                    else continue;
                }
                if (SimConflicts.Inside(b, pick - bPos)) return true;
            }
            return false;
        }

        /// <summary>Цэг хаалттай сүлжээний дотор уу — 3 чиглэлийн цацрагийн тэгш/сондгой тоо, олонхи.</summary>
        public static bool Inside(SimMesh mesh, SimVec p)
        {
            if (!mesh.IsClosed) return false;
            SimBox b = mesh.Bounds;
            if (p.X < b.MinX || p.X > b.MaxX || p.Y < b.MinY || p.Y > b.MaxY || p.Z < b.MinZ || p.Z > b.MaxZ) return false;
            // Ирмэг, оройгоор яг дайрахаас сэргийлж «ер бусын» чиглэлүүд.
            SimVec[] dirs =
            {
                new SimVec(0.57735, 0.37190, 0.72870).Normalized(),
                new SimVec(-0.41230, 0.80330, 0.43190).Normalized(),
                new SimVec(0.29340, -0.51870, 0.80250).Normalized(),
            };
            int odd = 0;
            foreach (SimVec d in dirs) if ((mesh.Bvh.RayCount(p, d) & 1) == 1) odd++;
            return odd >= 2;
        }
    }
}
