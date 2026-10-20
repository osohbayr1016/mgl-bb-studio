using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;
using RevitMcpAddin.ChangeImpact.Core;
using RevitMcpAddin.ClashCheck;
using RevitMcpAddin.Smart;
using RevitMcpAddin.Smart.Core;

namespace RevitMcpAddin.ChangeImpact
{
    /// <summary>
    /// «Revit-д ШУУД зөөсөн» зөөлтийг (Revit-ийн Move, чирэлт) ДАРАА нь шалгана — загварт ЮУ Ч бичихгүй, гүйлгээ нээхгүй (Revit аль хэдийн тооцсон тул sandbox хэрэггүй, хурдан):
    ///   • ОДООГИЙН байрлалд: зөөгдсөн элемент ↔ орчин (host + линк) — Revit-ийн solid boolean (`GeometryVerifier`, simulation-тай ИЖИЛ);
    ///   • ӨМНӨХ байрлалд: мөргөлдсөн хос бүрд зөөгдсөн элементийн солидыг −шилжилтээр ХӨРВҮҮЛЖ огтлолцлыг дахин бодно → аль хэдийн байсан (багана шалан дундуур)
    ///     мөргөлдөөнийг «шинэ» гэж хэлэхгүй;
    ///   • Revit-ийн тэр гүйлгээнд ӨӨРӨӨ өөрчилсөн бие (баганыг дагах дам нуруу) — `DocumentChanged`-ийн modified-аас;
    ///   • тайлан = simulation-ийн ИЖИЛ `SimNarrative` (нэг дүрэм), сүүдэр = хуучин/шинэ хүрээ + улаан мөргөлдөөн.
    /// Өрөө, Revit-ийн анхааруулгыг энд шалгахгүй (Revit өөрөө анхааруулгаа харуулсан) — тайлан ил хэлнэ.
    /// </summary>
    internal static class PostMoveAnalyzer
    {
        internal static NativeMoveResult Run(UIApplication app, DocumentKey key, IList<long> ids, SimVec deltaMm, ICollection<long> modifiedIds, out List<LinkSlot> slots)
        {
            var sw = Stopwatch.StartNew();
            slots = new List<LinkSlot>();
            UIDocument ui = app.ActiveUIDocument;
            Document doc = ui != null ? ui.Document : null;
            if (doc == null || !key.Equals(RevitDocumentKeys.Of(doc))) return null;
            var live = ids.Where(i => { Element e = doc.GetElement(new ElementId(i)); return e != null && e.IsValidObject; }).ToList();
            if (live.Count == 0) return null;

            SimMoveCheck check = SimElementRules.Check(doc, live.Select(i => new ElementId(i)).ToList());
            if (check == null || check.SelectedIds.Count == 0) return null;

            // Одоогийн хүрээ (фут) → origin (мм, simulation-тай ижил дүрэм).
            double minX = double.MaxValue, minY = double.MaxValue, minZ = double.MaxValue, maxX = double.MinValue, maxY = double.MinValue, maxZ = double.MinValue;
            foreach (long id in check.AllMovingIds.Distinct())
            {
                Element e = doc.GetElement(new ElementId(id));
                BoundingBoxXYZ bb = e != null ? e.get_BoundingBox(null) : null;
                if (bb == null) continue;
                minX = Math.Min(minX, bb.Min.X); minY = Math.Min(minY, bb.Min.Y); minZ = Math.Min(minZ, bb.Min.Z);
                maxX = Math.Max(maxX, bb.Max.X); maxY = Math.Max(maxY, bb.Max.Y); maxZ = Math.Max(maxZ, bb.Max.Z);
            }
            if (minX == double.MaxValue) return null;
            double mmPerFoot = PcUnits.Mm(1.0);
            var origin = new[] { (minX + maxX) / 2 * mmPerFoot, (minY + maxY) / 2 * mmPerFoot, minZ * mmPerFoot };

            var res = new SimExactResult { Generation = 0, OffsetMm = new[] { deltaMm.X, deltaMm.Y, deltaMm.Z }, Outcome = SandboxOutcome.Simulated, Stamp = ModelChangeCounter.Stamp(doc) };
            double pad = PcUnits.ToInternalMm(50);
            var region = new Outline(new XYZ(minX - pad, minY - pad, minZ - pad), new XYZ(maxX + pad, maxY + pad, maxZ + pad));
            XYZ center = new XYZ((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2);
            var stage = Stopwatch.StartNew();
            SimCandidates.Plan plan = SimCandidates.Collect(doc, region, new HashSet<long>(check.AllMovingIds), center, SimExactAnalyzer.MaxClashCandidates);
            res.StageMs["plan"] = stage.ElapsedMilliseconds; stage.Restart();

            var clashes = new List<SimExactClash>();
            bool complete = SimExactAnalyzer.VerifyClashes(doc, null, check, plan, origin, clashes, res);
            res.StageMs["clash_after"] = stage.ElapsedMilliseconds; stage.Restart();
            MarkBefore(doc, check, plan, clashes, deltaMm);
            res.StageMs["clash_before"] = stage.ElapsedMilliseconds; stage.Restart();

            res.Clashes = clashes;
            res.ClashesEvaluated = true;
            res.ClashesComplete = complete;
            SimExactAnalyzer.ReadAffected(doc, check, (modifiedIds ?? new List<long>()).ToList(), res);
            res.ModifiedCount = (modifiedIds ?? new List<long>()).Count;
            foreach (string a in plan.Advisory) res.AdvisoryReasons.Add(a);
            foreach (string a in plan.Incomplete) { res.IncompleteReasons.Add(a); res.ClashesComplete = false; }
            res.ElapsedMs = sw.Elapsed.TotalMilliseconds;

            var scene = new SimScene { MovingName = check.Name, PrimaryId = check.PrimaryId, PrimaryKind = check.Kind.ToString(), OriginMm = origin };
            foreach (long id in check.AllMovingIds.Distinct())
                scene.Moving.Add(new SimMesh { Key = "h:" + id, Id = id, Slot = -1, Role = SimRole.Moving, Hosted = !check.SelectedIds.Contains(id) });

            SimReport report = SimNarrative.Build(scene, deltaMm, new SimConflictResult { Offset = deltaMm }, res, SimPhase.Idle);
            report.Headline = SimNativeMove.Headline(check.Name, deltaMm);
            report.Title = SimNativeMove.Title(report.Verdict);
            report.Coverage.Insert(0, "Revit-ийн өөрийн зөөлтийг ДАРАА нь шалгав — өрөөний талбай, Revit-ийн анхааруулгыг энд шалгаагүй (Revit өөрөө харуулсан).");

            var boxes = report.Lines.Where(l => l.Severity != SimSeverity.Info && l.BoxMm != null).Select(l => l.BoxMm).ToList();
            var movedLocal = new SimBox
            {
                MinX = minX * mmPerFoot - origin[0], MinY = minY * mmPerFoot - origin[1], MinZ = minZ * mmPerFoot - origin[2],
                MaxX = maxX * mmPerFoot - origin[0], MaxY = maxY * mmPerFoot - origin[1], MaxZ = maxZ * mmPerFoot - origin[2],
            };
            GhostScene ghost = SimGhostScene.ForNativeMove(movedLocal, deltaMm, origin, report.Verdict, boxes, PcUnits.ToInternalMm(1.0));

            SmartLog.Info("sim", "native_checked", new { ids = live.Count, clashes = clashes.Count(c => c.State == SimClashState.Confirmed), affected = res.Affected.Count, ms = (long)res.ElapsedMs });
            slots = plan.Slots;
            return new NativeMoveResult { Key = key, DocTitle = doc.Title, Ids = live, DeltaMm = deltaMm, Scene = scene, Exact = res, Report = report, Ghost = ghost, ElapsedMs = res.ElapsedMs };
        }

        /* ============================== ӨМНӨХ БАЙРЛАЛ ======================== */

        /// <summary>
        /// Одоо мөргөлдөж буй хос бүрд: зөөгдсөн элементийн солидыг −шилжилтээр хөрвүүлж (өмнөх байрлал) огтлолцлын эзлэхүүнийг бодно.
        /// Гүйлгээгүй — `SolidUtils.CreateTransformed` + `BooleanOperationsUtils`.  Бодож чадаагүй бол (алдаа) «шинэ» гэж үлдээнэ (худал тайвшруулахгүй).
        /// </summary>
        private static void MarkBefore(Document doc, SimMoveCheck check, SimCandidates.Plan plan, List<SimExactClash> clashes, SimVec deltaMm)
        {
            List<SimExactClash> hits = clashes.Where(c => c.State == SimClashState.Confirmed).ToList();
            if (hits.Count == 0) return;
            try
            {
                Transform back = Transform.CreateTranslation(new XYZ(-PcUnits.ToInternalMm(deltaMm.X), -PcUnits.ToInternalMm(deltaMm.Y), -PcUnits.ToInternalMm(deltaMm.Z)));
                var moving = new List<Solid>();
                foreach (long id in check.AllMovingIds.Distinct())
                {
                    Element e = doc.GetElement(new ElementId(id));
                    if (e == null) continue;
                    foreach (Solid s in Solids(e, null)) { try { moving.Add(SolidUtils.CreateTransformed(s, back)); } catch (Exception) { } }
                }
                if (moving.Count == 0) return;
                foreach (SimExactClash c in hits)
                {
                    Element e; Transform t = null;
                    if (c.Slot < 0) e = doc.GetElement(new ElementId(c.Id));
                    else
                    {
                        ClashLinks.Resolved link = c.Slot < plan.Slots.Count ? ClashLinks.Resolve(doc, plan.Slots[c.Slot]) : null;
                        if (link == null) continue;
                        e = link.Doc.GetElement(new ElementId(c.Id)); t = link.Transform;
                    }
                    if (e == null) continue;
                    double vol = 0;
                    foreach (Solid other in Solids(e, t))
                        foreach (Solid m in moving)
                        {
                            try
                            {
                                Solid x = BooleanOperationsUtils.ExecuteBooleanOperation(m, other, BooleanOperationsType.Intersect);
                                if (x != null && x.Volume > 0) vol += x.Volume;
                            }
                            catch (Exception) { /* boolean бүтэлгүй — тэр хосыг «шинэ» гэж үлдээнэ */ }
                        }
                    double cm3 = UnitUtils.ConvertFromInternalUnits(vol, UnitTypeId.CubicCentimeters);
                    if (cm3 >= SimExactAnalyzer.MinClashVolumeCm3) { c.PreExisting = true; c.BeforeVolumeCm3 = cm3; }
                }
            }
            catch (Exception ex) { SmartLog.Warn("sim", "native_before_failed", new { ex = ex.GetType().Name }); }
        }

        private static List<Solid> Solids(Element e, Transform t)
        {
            var list = new List<Solid>();
            try
            {
                using (var opt = new Options { DetailLevel = ViewDetailLevel.Fine, ComputeReferences = false, IncludeNonVisibleObjects = false })
                {
                    GeometryElement ge = e.get_Geometry(opt);
                    if (ge != null) Walk(ge, list, 0);
                }
            }
            catch (Exception) { }
            if (t != null && !t.IsIdentity)
                return list.Select(s => { try { return SolidUtils.CreateTransformed(s, t); } catch (Exception) { return null; } }).Where(s => s != null).ToList();
            return list;
        }

        private static void Walk(GeometryElement ge, List<Solid> list, int depth)
        {
            if (depth > 4) return;
            foreach (GeometryObject go in ge)
            {
                var s = go as Solid;
                if (s != null) { if (s.Volume > 1e-9) list.Add(s); continue; }
                var inst = go as GeometryInstance;
                if (inst != null) { GeometryElement inner = inst.GetInstanceGeometry(); if (inner != null) Walk(inner, list, depth + 1); }
            }
        }
    }
}
