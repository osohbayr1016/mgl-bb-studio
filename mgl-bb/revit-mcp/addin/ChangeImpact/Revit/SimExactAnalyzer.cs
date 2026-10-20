using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using Autodesk.Revit.ApplicationServices;
using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Events;
using Autodesk.Revit.UI;
using RevitMcpAddin.ChangeImpact.Core;
using RevitMcpAddin.ClashCheck;
using RevitMcpAddin.ClashCheck.Core;
using RevitMcpAddin.Smart;
using RevitMcpAddin.Smart.Core;

namespace RevitMcpAddin.ChangeImpact
{
    /// <summary>
    /// «Revit-ийн бодит тооцоо» — хулганаар тавьсан offset-д ЯГ зөөлтийг Revit-ийн түр бүлэгт (TransactionGroup, ҮРГЭЛЖ RollBack) хийж, SETTLED төлвийг уншина:
    ///   • Revit зөвшөөрөх үү (failure: алдаа/анхааруулга), устах элемент, автоматаар засагдах хөрш;
    ///   • зөөгдсөн элемент ↔ орчин (host + линк, БҮХ ангилал) — Revit-ийн solid boolean (`GeometryVerifier`) → ЖИНХЭНЭ мөргөлдөөн, эзлэхүүн, хүрээ;
    ///   • өрөөний талбай/хаагдалт;  хамт өөрчлөгдөх (хостлогдсон, хэмжээс, шошго);
    ///   • зөөлтийн ДАРАА геометр (зөөгдсөн + өөрчлөгдсөн хөрш) — дэлгэц дээр «Revit-ийн бодит үр дүн» болгож харуулна.
    /// Ингэж мөргөлдөөн ӨМНӨХ (хөдөлгөөнгүй) төлөвт аль хэдийн байсныг (хаалга нүхэндээ…) ялгана.
    ///
    /// ГЭРЭЭ (`PreChangeSandbox`-тэй ИЖИЛ): ганц `Step` дотор БҮТЭН; MGL-ийн ажиглагч хаалттай (`ImpactSimulationScope`); буцаалтыг ЗОРИУЛАЛТТАЙ хурууны хээгээр БАТЛАНА —
    /// батлаж чадаагүй бол `NotRestored` (ХЭЗЭЭ Ч «өөрчлөгдөөгүй» гэж хэлэхгүй).
    /// </summary>
    internal static class SimExactAnalyzer
    {
        internal const int ClashBudgetMs = 2500;
        internal const int MaxClashCandidates = 300;
        internal const int MaxMovingVerifyItems = 12;
        internal const int MaxAffectedMeshes = 10;
        internal const double MinClashVolumeCm3 = 25;
        private const string GroupName = "MGL — Simulation (түр)";
        private const string TxName = "MGL — түр хөдөлгөөн";

        private sealed class RoomBefore
        {
            public long Id; public string Name; public double AreaM2;
        }

        internal static SimExactResult Run(UIApplication uiapp, DocumentKey key, SimLoaded loaded, SimVec offsetMm, int generation)
        {
            var sw = Stopwatch.StartNew();
            var res = new SimExactResult { Generation = generation, OffsetMm = new[] { offsetMm.X, offsetMm.Y, offsetMm.Z }, Outcome = SandboxOutcome.Unknown };
            try
            {
                UIDocument ui = uiapp.ActiveUIDocument;
                Document doc = ui != null ? ui.Document : null;
                if (doc == null) return Reject(res, "Идэвхтэй баримт алга.");
                if (!key.Equals(RevitDocumentKeys.Of(doc))) return Reject(res, "Идэвхтэй файл солигдсон — simulation хийсэн файл руугаа буцна уу.");
                if (loaded == null || loaded.Scene == null || loaded.Check == null) return Reject(res, "Сцен ачаалагдаагүй байна.");

                // Элемент одоо ч зөөгдөх боломжтой эсэх (хэрэглэгч Pin хийсэн, өөр хүн эзэмшсэн, устгасан…).
                SimMoveCheck check = SimElementRules.Check(doc, loaded.Check.SelectedIds.Select(i => new ElementId(i)).ToList());
                if (!check.Ok) return Reject(res, check.Problem);

                res.Stamp = ModelChangeCounter.Stamp(doc);
                XYZ move = new XYZ(PcUnits.ToInternalMm(offsetMm.X), PcUnits.ToInternalMm(offsetMm.Y), PcUnits.ToInternalMm(offsetMm.Z));
                double[] origin = loaded.Scene.OriginMm;
                var selected = check.SelectedIds.ToList();
                var movingAll = check.AllMovingIds.Distinct().ToList();

                // ---- ГАДНА (бүлгээс ӨМНӨ): нэр дэвшигч, өрөө, хамаарал, хурууны хээ ----
                var stage = Stopwatch.StartNew();
                Outline region = MovedRegion(loaded.MovingBoxFt, move);
                XYZ center = new XYZ((region.MinimumPoint.X + region.MaximumPoint.X) / 2, (region.MinimumPoint.Y + region.MaximumPoint.Y) / 2, (region.MinimumPoint.Z + region.MaximumPoint.Z) / 2);
                SimCandidates.Plan plan = SimCandidates.Collect(doc, region, new HashSet<long>(movingAll), center, MaxClashCandidates);
                res.StageMs["plan"] = stage.ElapsedMilliseconds; stage.Restart();

                Dictionary<long, string[]> depInfo = CollectDependents(doc, selected, movingAll);
                List<RoomBefore> roomsBefore = ReadRooms(doc, UnionRegion(loaded.MovingBoxFt, move));
                res.StageMs["before"] = stage.ElapsedMilliseconds; stage.Restart();

                RestoreProbe probeBefore = Probe(doc, check, null, null);

                // ---- БҮЛЭГ: зөөх → Regenerate → COMMIT → SETTLED унших → ҮРГЭЛЖ RollBack ----
                var handler = new PreChangeFailureHandler(true);
                var deleted = new List<long>();
                var added = new List<long>();
                var modifiedIds = new List<long>();
                EventHandler<DocumentChangedEventArgs> onChanged = (s, e) =>
                {
                    try
                    {
                        Document d = e.GetDocument();
                        if (d == null || !SmartDocs.Same(d, doc)) return;
                        if (e.Operation != UndoOperation.TransactionCommitted) return;
                        foreach (ElementId id in e.GetDeletedElementIds()) deleted.Add(id.Value);
                        foreach (ElementId id in e.GetAddedElementIds()) added.Add(id.Value);
                        foreach (ElementId id in e.GetModifiedElementIds()) modifiedIds.Add(id.Value);
                    }
                    catch (Exception) { /* зөвхөн нэмэлт нотолгоо */ }
                };

                List<SimExactClash> clashesAfter = new List<SimExactClash>();
                bool clashComplete = true;
                var settledLocs = new Dictionary<long, double[]>();
                var roomsAfter = new Dictionary<long, RoomBefore>();
                var settledMoving = new List<SimMesh>();
                var settledAffected = new List<SimMesh>();
                bool committed = false, groupStarted = false, rolledBackOk = false;
                TransactionGroup tg = null;

                using (ImpactSimulationScope.Begin())
                {
                    try
                    {
                        uiapp.Application.DocumentChanged += onChanged;
                        tg = new TransactionGroup(doc, GroupName);
                        if (tg.Start() != TransactionStatus.Started)
                        {
                            res.Outcome = SandboxOutcome.Rejected;
                            res.BlockReasons.Add("Revit түр транзакц нээхийг зөвшөөрсөнгүй (баримт засварлах горимд байж магадгүй).");
                        }
                        else
                        {
                            groupStarted = true;
                            committed = MoveInTx(doc, selected, move, handler, res);
                            res.StageMs["move_commit"] = stage.ElapsedMilliseconds; stage.Restart();
                            if (committed)
                            {
                                // ⚠️ SETTLED: commit АМЖИЛТТАЙ болсны ДАРАА, бүлэг нээлттэй байхад.
                                foreach (long id in selected.Concat(check.HostedIds))
                                {
                                    Element el = doc.GetElement(new ElementId(id));
                                    if (el != null && el.IsValidObject) settledLocs[id] = LocOrBox(el);
                                }
                                foreach (RoomBefore rb in roomsBefore)
                                {
                                    var room = doc.GetElement(new ElementId(rb.Id)) as Autodesk.Revit.DB.Architecture.Room;
                                    if (room == null || !room.IsValidObject) { roomsAfter[rb.Id] = null; continue; }
                                    roomsAfter[rb.Id] = new RoomBefore { Id = rb.Id, Name = rb.Name, AreaM2 = PcUnits.M2(room.Area) };
                                }
                                res.StageMs["rooms_after"] = stage.ElapsedMilliseconds; stage.Restart();

                                clashComplete = VerifyClashes(doc, loaded, check, plan, origin, clashesAfter, res);
                                res.StageMs["clash_after"] = stage.ElapsedMilliseconds; stage.Restart();

                                ReadAffected(doc, check, modifiedIds, res);
                                ReadSettledGeometry(doc, origin, check, res.Affected.Select(a => a.Id).ToList(), settledMoving, settledAffected);
                                res.StageMs["settled_geometry"] = stage.ElapsedMilliseconds; stage.Restart();
                            }
                        }
                    }
                    catch (Exception ex)
                    {
                        committed = false;
                        if (!groupStarted)
                        {
                            res.Outcome = SandboxOutcome.Rejected;
                            res.BlockReasons.Add("Revit түр транзакц нээхийг зөвшөөрсөнгүй (" + ex.GetType().Name + "): " + SmartLog.Scrub(ex.Message));
                        }
                        else
                        {
                            res.Outcome = IsRevitException(ex) ? SandboxOutcome.Blocked : SandboxOutcome.Faulted;
                            res.BlockReasons.Add(res.Outcome == SandboxOutcome.Blocked
                                ? "Revit энэ хөдөлгөөнийг зөвшөөрөөгүй (" + ex.GetType().Name + "): " + SmartLog.Scrub(ex.Message)
                                : "Шалгалт дуусаагүй — хэрэгслийн алдаа (" + ex.GetType().Name + "): " + SmartLog.Scrub(ex.Message) + " Загвар өөрчлөгдөөгүй.");
                        }
                        SmartLog.Error("sim", "exact_failed", ex);
                    }
                    finally
                    {
                        try { uiapp.Application.DocumentChanged -= onChanged; } catch (Exception) { }
                        if (tg != null && groupStarted)
                        {
                            try { rolledBackOk = tg.RollBack() == TransactionStatus.RolledBack; }
                            catch (Exception ex) { rolledBackOk = false; SmartLog.Error("sim", "group_rollback_failed", ex); }
                        }
                        else rolledBackOk = true;
                    }
                }
                res.StageMs["rollback"] = stage.ElapsedMilliseconds; stage.Restart();

                // Дагаж өөрчлөгдөх бие: буцаалтын ДАРАА (анхны төлөв) байрлалыг шинжилгээний үеийнхтэй тулгана — үнэхээр шилжсэн/сунасан уу,
                // эсвэл зөвхөн холболт/нэгдэл шинэчлэгдсэн үү (Revit «modified» гэж тэмдэглэдэг ч байрлал нь хөдлөөгүй байж болно).
                foreach (SimAffected a in res.Affected)
                {
                    try
                    {
                        Element e = doc.GetElement(new ElementId(a.Id));
                        double[] orig = e != null && e.IsValidObject ? LocOrBox(e) : null;
                        if (orig == null || a.SettledLoc == null || orig.Length != a.SettledLoc.Length) continue;
                        double max = 0;
                        for (int i = 0; i < orig.Length; i++) max = Math.Max(max, Math.Abs(orig[i] - a.SettledLoc[i]));
                        a.LocationChanged = max >= 1.0;
                    }
                    catch (Exception) { }
                }

                // ---- БУЦААЛТЫГ БАТЛАХ (fail-closed) ----
                string restoreProblem = null;
                if (!rolledBackOk) restoreProblem = "Түр транзакцийг буцаах нь амжилтгүй.";
                else if (groupStarted)
                {
                    try
                    {
                        RestoreProbe after = Probe(doc, check, added, deleted);
                        RestoreResult rr = PreChangeRestoreCheck.Compare(probeBefore, after);
                        if (!rr.Restored) restoreProblem = string.Join(" ", rr.Problems);
                    }
                    catch (Exception ex) { restoreProblem = "Буцаалтыг шалгаж чадсангүй (" + ex.GetType().Name + ")."; }
                }
                res.StageMs["restore_check"] = stage.ElapsedMilliseconds; stage.Restart();

                if (restoreProblem != null)
                {
                    res.Outcome = SandboxOutcome.NotRestored;
                    res.BlockReasons.Add(restoreProblem + " Ctrl+Z-ээр шалгаж, загварыг гараар хянана уу.");
                    SmartLog.Error("sim", "not_restored", null, new { problem = restoreProblem });
                    ModelChangeCounter.ForceBump(doc);
                    return Finish(res, sw);
                }

                if (!committed)
                {
                    if (res.Outcome == SandboxOutcome.Unknown) res.Outcome = SandboxOutcome.Blocked;
                    if (res.BlockReasons.Count == 0) res.BlockReasons.Add("Энэ хөдөлгөөнийг хийх боломжгүй.");
                    res.Failures.AddRange(handler.Notes);
                    return Finish(res, sw);
                }

                // ---- ӨМНӨХ төлөвт аль хэдийн давхцсан (хаалга нүхэндээ, нэгдсэн хана) — шинэ мөргөлдөөн БИШ ----
                Stopwatch swPre = Stopwatch.StartNew();
                MarkPreExisting(doc, loaded, check, plan, origin, clashesAfter);
                res.StageMs["clash_before"] = swPre.ElapsedMilliseconds;

                res.Outcome = SandboxOutcome.Simulated;
                res.Failures.AddRange(handler.Notes.Where(n => !n.IsError));
                res.Clashes = clashesAfter;
                res.ClashesEvaluated = true;
                res.ClashesComplete = clashComplete;
                res.RoomsEvaluated = true;
                res.ModifiedCount = modifiedIds.Distinct().Count();
                res.SettledMoving = settledMoving;
                res.SettledAffected = settledAffected;
                res.SettledLocations = settledLocs;

                foreach (RoomBefore rb in roomsBefore)
                {
                    RoomBefore a;
                    if (!roomsAfter.TryGetValue(rb.Id, out a)) continue;
                    if (a == null) { res.Rooms.Add(new SimRoomChange { Id = rb.Id, Name = rb.Name, BeforeM2 = rb.AreaM2, AfterM2 = 0, Deleted = true }); continue; }
                    bool open = rb.AreaM2 > 0.01 && a.AreaM2 <= 0.01;
                    if (open || Math.Abs(a.AreaM2 - rb.AreaM2) >= SimNarrative.RoomAreaEpsM2)
                        res.Rooms.Add(new SimRoomChange { Id = rb.Id, Name = rb.Name, BeforeM2 = rb.AreaM2, AfterM2 = a.AreaM2, NotEnclosed = open });
                }

                // Хамт өөрчлөгдөх (хост дагагч, хэмжээс, шошго) — ӨМНӨХ хамаарал (зөөгдсөн элементийн GetDependentElements).
                var movingSet = new HashSet<long>(movingAll);
                foreach (KeyValuePair<long, string[]> kv in depInfo)
                {
                    if (movingSet.Contains(kv.Key) && !check.HostedIds.Contains(kv.Key)) continue;
                    res.Dependents.Add(new SimDependent { Id = kv.Key, Label = kv.Value[0], Category = kv.Value[1], Kind = (SimKind)int.Parse(kv.Value[2]) });
                }
                foreach (long id in check.HostedIds.Where(h => !depInfo.ContainsKey(h)))
                    res.Dependents.Add(new SimDependent { Id = id, Label = "#" + id, Category = "Хостлогдсон элемент" });

                // Устсан: таниж болох (нэр дэвшигч/хамаарал/хостлогдсон) нь «Known».
                var knownLabels = new Dictionary<long, string[]>(depInfo);
                foreach (long id in deleted.Distinct())
                {
                    if (movingSet.Contains(id)) continue;
                    string[] info;
                    bool known = knownLabels.TryGetValue(id, out info);
                    res.Deleted.Add(new SimDeletedElement { Id = id, Label = known ? info[0] : "Элемент #" + id, Kind = known ? (SimKind)int.Parse(info[2]) : SimKind.Other, Known = known && !IsInternalCategory(info[1]) });
                }
                res.DeletedIds = deleted.Distinct().ToList();

                foreach (string a in plan.Advisory) res.AdvisoryReasons.Add(a);
                foreach (string a in plan.Incomplete) { res.IncompleteReasons.Add(a); clashComplete = false; res.ClashesComplete = false; }
                return Finish(res, sw);
            }
            catch (Exception ex)
            {
                SmartLog.Error("sim", "exact_run_failed", ex);
                res.Outcome = SandboxOutcome.Faulted;
                res.BlockReasons.Add("Шалгалт дуусаагүй — хэрэгслийн алдаа (" + ex.GetType().Name + "): " + SmartLog.Scrub(ex.Message) + " Загвар өөрчлөгдөөгүй.");
                return Finish(res, sw);
            }
        }

        private static SimExactResult Reject(SimExactResult res, string why)
        {
            res.Outcome = SandboxOutcome.Rejected;
            res.BlockReasons.Add(why);
            return res;
        }

        private static SimExactResult Finish(SimExactResult res, Stopwatch sw)
        {
            res.ElapsedMs = sw.Elapsed.TotalMilliseconds;
            SmartLog.Info("sim", "exact_done", new { outcome = res.Outcome.ToString(), clashes = res.Clashes.Count(c => c.State == SimClashState.Confirmed), ms = (long)res.ElapsedMs });
            return res;
        }

        private static bool IsRevitException(Exception ex)
        {
            return ex != null && string.Equals(ex.GetType().Namespace, "Autodesk.Revit.Exceptions", StringComparison.Ordinal);
        }

        private static bool IsInternalCategory(string category)
        {
            return string.IsNullOrEmpty(category);
        }

        /* ============================== ТӨЛӨВ УНШИЛТ ======================== */

        /// <summary>Зөөгдсөн bbox (host координат) + 50 мм.</summary>
        private static Outline MovedRegion(double[] boxFt, XYZ move)
        {
            double pad = PcUnits.ToInternalMm(50);
            return new Outline(
                new XYZ(boxFt[0] + move.X - pad, boxFt[1] + move.Y - pad, boxFt[2] + move.Z - pad),
                new XYZ(boxFt[3] + move.X + pad, boxFt[4] + move.Y + pad, boxFt[5] + move.Z + pad));
        }

        /// <summary>Өмнөх ∪ дараах bbox + 1 м — өөрчлөгдөх өрөөг олох.</summary>
        private static Outline UnionRegion(double[] boxFt, XYZ move)
        {
            double pad = PcUnits.ToInternalMm(1000);
            return new Outline(
                new XYZ(Math.Min(boxFt[0], boxFt[0] + move.X) - pad, Math.Min(boxFt[1], boxFt[1] + move.Y) - pad, Math.Min(boxFt[2], boxFt[2] + move.Z) - pad),
                new XYZ(Math.Max(boxFt[3], boxFt[3] + move.X) + pad, Math.Max(boxFt[4], boxFt[4] + move.Y) + pad, Math.Max(boxFt[5], boxFt[5] + move.Z) + pad));
        }

        private static List<RoomBefore> ReadRooms(Document doc, Outline region)
        {
            var rooms = new List<RoomBefore>();
            try
            {
                foreach (Element e in new FilteredElementCollector(doc).OfCategory(BuiltInCategory.OST_Rooms).WhereElementIsNotElementType()
                    .WherePasses(new BoundingBoxIntersectsFilter(region)))
                {
                    var r = e as Autodesk.Revit.DB.Architecture.Room;
                    if (r == null || r.Location == null) continue;            // байрлуулаагүй өрөө талбайгүй
                    rooms.Add(new RoomBefore { Id = r.Id.Value, Name = PreChangeWallRules.RoomLabel(r), AreaM2 = PcUnits.M2(r.Area) });
                    if (rooms.Count >= 60) break;
                }
            }
            catch (Exception) { /* өрөөг уншиж чадсангүй — өрөөний шалгалт «хийгдээгүй» (RoomsEvaluated дараа нь true боловч жагсаалт хоосон) */ }
            return rooms;
        }

        /// <summary>Зөөгдөх элементүүдээс хамаарах (хостлогдсон, хэмжээс, шошго…) элементүүд: id → [label, category, kind].  Ангилалгүй (дотоод sketch г.м.) нь орохгүй.</summary>
        private static Dictionary<long, string[]> CollectDependents(Document doc, IList<long> selected, IList<long> all)
        {
            var map = new Dictionary<long, string[]>();
            try
            {
                foreach (long sid in selected)
                {
                    Element e = doc.GetElement(new ElementId(sid));
                    if (e == null) continue;
                    ICollection<ElementId> deps = e.GetDependentElements(null);
                    if (deps == null) continue;
                    foreach (ElementId id in deps)
                    {
                        if (map.Count >= 400) return map;
                        if (id == e.Id) continue;
                        Element d = doc.GetElement(id);
                        if (d == null || d.Category == null) continue;
                        if (!map.ContainsKey(id.Value))
                            map[id.Value] = new[] { SimKinds.LabelOf(d), SimKinds.CategoryName(d), ((int)SimKinds.Of(d)).ToString() };
                    }
                }
            }
            catch (Exception) { /* хамаарлыг уншиж чадсангүй — «хамт өөрчлөгдөх» мэдээлэл дутна, гол шалгалт хэвээр */ }
            return map;
        }

        /// <summary>Байрлал (мм): шугам/цэг, эсвэл (талбай, шал…) bbox-ын хоёр булан.  Буцаалтыг батлахад.</summary>
        internal static double[] LocOrBox(Element e)
        {
            double[] loc = PreChangeCapture.ReadLocation(e);
            if (loc != null) return loc;
            try
            {
                BoundingBoxXYZ bb = e.get_BoundingBox(null);
                if (bb != null) return new[] { PcUnits.Mm(bb.Min.X), PcUnits.Mm(bb.Min.Y), PcUnits.Mm(bb.Min.Z), PcUnits.Mm(bb.Max.X), PcUnits.Mm(bb.Max.Y), PcUnits.Mm(bb.Max.Z) };
            }
            catch (Exception) { }
            return null;
        }

        /// <summary>Буцаалтыг шалгах хурууны хээ — `PreChangeRestoreCheck`-ийн ИЖИЛ бүтэц.  Эх элемент = «Wall*» талбарууд (нэр нь хуучин, утга ерөнхий).</summary>
        private static RestoreProbe Probe(Document doc, SimMoveCheck check, List<long> added, List<long> deleted)
        {
            var p = new RestoreProbe { Readable = true };
            try
            {
                Element primary = doc.GetElement(new ElementId(check.PrimaryId));
                p.WallExists = primary != null && primary.IsValidObject;
                if (p.WallExists)
                {
                    p.WallLocation = LocOrBox(primary);
                    try { p.WallTypeId = primary.GetTypeId().Value; } catch (Exception) { }
                }
                foreach (long id in check.SelectedIds.Skip(1).Concat(check.HostedIds).Concat(check.ReactiveIds).Distinct())
                {
                    Element e = null;
                    try { e = doc.GetElement(new ElementId(id)); } catch (Exception) { }
                    if (e == null || !e.IsValidObject) continue;
                    p.OthersPresent.Add(id);
                    p.Others[id] = LocOrBox(e);
                }
                p.Stamp = ModelChangeCounter.Stamp(doc);
                p.DocumentModifiable = doc.IsModifiable;
                if (added != null)
                    foreach (long id in added.Distinct().Take(5000))
                    {
                        Element e = null;
                        try { e = doc.GetElement(new ElementId(id)); } catch (Exception) { }
                        if (e != null && e.IsValidObject) p.AddedStillPresent++;
                    }
                if (deleted != null)
                    foreach (long id in deleted.Distinct().Take(5000))
                    {
                        Element e = null;
                        try { e = doc.GetElement(new ElementId(id)); } catch (Exception) { }
                        if (e == null || !e.IsValidObject) p.DeletedStillMissing++;
                    }
            }
            catch (Exception) { p.Readable = false; }
            return p;
        }

        /* ============================== ЗӨӨЛТ =============================== */

        private static bool MoveInTx(Document doc, IList<long> ids, XYZ move, PreChangeFailureHandler handler, SimExactResult res)
        {
            using (var t = new Transaction(doc, TxName))
            {
                PreChangeFailureHandler.Attach(t, handler);
                if (t.Start() != TransactionStatus.Started)
                {
                    res.Outcome = SandboxOutcome.Rejected;
                    res.BlockReasons.Add("Revit түр транзакц нээхийг зөвшөөрсөнгүй.");
                    return false;
                }
                try
                {
                    if (ids.Count == 1) ElementTransformUtils.MoveElement(doc, new ElementId(ids[0]), move);
                    else ElementTransformUtils.MoveElements(doc, ids.Select(i => new ElementId(i)).ToList(), move);
                    doc.Regenerate();
                }
                catch (Exception ex)
                {
                    try { t.RollBack(); } catch (Exception) { }
                    res.Outcome = IsRevitException(ex) ? SandboxOutcome.Blocked : SandboxOutcome.Faulted;
                    res.BlockReasons.Add(res.Outcome == SandboxOutcome.Blocked
                        ? "Revit зөөхийг зөвшөөрсөнгүй (" + ex.GetType().Name + "): " + SmartLog.Scrub(ex.Message)
                        : "Шалгалт дуусаагүй — хэрэгслийн алдаа (" + ex.GetType().Name + "): " + SmartLog.Scrub(ex.Message) + " Загвар өөрчлөгдөөгүй.");
                    return false;
                }

                TransactionStatus cs;
                try { cs = t.Commit(); }
                catch (Exception ex)
                {
                    if (t.GetStatus() == TransactionStatus.Started) { try { t.RollBack(); } catch (Exception) { } }
                    res.Outcome = IsRevitException(ex) ? SandboxOutcome.Blocked : SandboxOutcome.Faulted;
                    res.BlockReasons.Add(res.Outcome == SandboxOutcome.Blocked
                        ? "Revit зөөхийг зөвшөөрсөнгүй (" + ex.GetType().Name + "): " + SmartLog.Scrub(ex.Message)
                        : "Шалгалт дуусаагүй — хэрэгслийн алдаа (" + ex.GetType().Name + "): " + SmartLog.Scrub(ex.Message) + " Загвар өөрчлөгдөөгүй.");
                    return false;
                }
                if (cs != TransactionStatus.Committed)
                {
                    res.Outcome = SandboxOutcome.Blocked;
                    var errors = handler.Notes.Where(n => n.IsError).Select(n => n.Text).Distinct().ToList();
                    res.BlockReasons.Add(errors.Count > 0 ? "Revit энэ хөдөлгөөнийг зөвшөөрөөгүй: " + string.Join("; ", errors)
                        : "Revit энэ хөдөлгөөнийг зөвшөөрөөгүй (түгжигдсэн хэмжээс/холбоос байж болно).");
                    return false;
                }
                return true;
            }
        }

        /* ============================== МӨРГӨЛДӨӨН ========================== */

        private static ClashRule Rule()
        {
            return new ClashRule { Mode = ClashMode.HardIntersection, MinVolumeCm3 = MinClashVolumeCm3, IgnoreJoined = false, IgnoreHosted = false, IgnoreConnected = false };
        }

        private static List<SideItem> MovingItems(Document doc, RevitKeyScope scope, SimMoveCheck check, out int skipped)
        {
            var items = new List<SideItem>();
            skipped = 0;
            foreach (long id in check.SelectedIds.Concat(check.HostedIds))
            {
                if (items.Count >= MaxMovingVerifyItems) { skipped++; continue; }
                Element e = doc.GetElement(new ElementId(id));
                if (e == null || !e.IsValidObject) continue;
                items.Add(new SideItem { Key = scope.Host(e), IdValue = id, Slot = -1 });
            }
            return items;
        }

        /// <summary>Зөөгдсөн (settled) элемент ↔ нэр дэвшигч бүр: Revit-ийн boolean.  true = host-ийн шалгалт БҮРЭН (cap/цаг/алдаа биш).</summary>
        internal static bool VerifyClashes(Document doc, SimLoaded loaded, SimMoveCheck check, SimCandidates.Plan plan, double[] origin, List<SimExactClash> outClashes, SimExactResult res)
        {
            bool complete = true;
            var sw = Stopwatch.StartNew();
            var scope = new RevitKeyScope(doc);
            int skippedMoving;
            List<SideItem> moving = MovingItems(doc, scope, check, out skippedMoving);
            if (skippedMoving > 0) res.AdvisoryReasons.Add("Хостлогдсон " + skippedMoving + " элементийг мөргөлдөөнд шалгаагүй (хамгийн ихдээ " + MaxMovingVerifyItems + " элемент).");
            if (moving.Count == 0) { res.IncompleteReasons.Add("Зөөгдсөн элементийг мөргөлдөөнд шалгаж чадсангүй."); return false; }

            ClashRule rule = Rule();
            int skipped = 0, errors = 0, unsupported = 0;
            var reactive = new HashSet<long>(check.ReactiveIds);
            using (var gv = new GeometryVerifier(doc, plan.Slots))
            {
                gv.BeginStep();
                for (int i = 0; i < plan.Cands.Count; i++)
                {
                    if (sw.ElapsedMilliseconds > ClashBudgetMs) { skipped = plan.Cands.Count - i; break; }
                    SimCand c = plan.Cands[i];
                    try
                    {
                        Element e; ElementKey key; string linkName = null;
                        if (c.Slot < 0)
                        {
                            e = doc.GetElement(new ElementId(c.Id));
                            if (e == null) continue;
                            key = scope.Host(e);
                        }
                        else
                        {
                            ClashLinks.Resolved link = ClashLinks.Resolve(doc, plan.Slots[c.Slot]);
                            if (link == null) { res.AdvisoryReasons.Add("Линк «" + plan.Slots[c.Slot].Name + "» шалгалтын явцад unload хийгдсэн."); continue; }
                            e = link.Doc.GetElement(new ElementId(c.Id));
                            if (e == null) continue;
                            key = scope.Linked(link.Instance, link.Doc, e);
                            linkName = plan.Slots[c.Slot].Name;
                        }
                        var cand = new SideItem { Key = key, IdValue = c.Id, Slot = c.Slot };

                        double volume = 0; double[] box = null; ClashVerdict worst = ClashVerdict.NoClash; string reason = null;
                        foreach (SideItem mv in moving)
                        {
                            PairResult pr = gv.Verify(mv, cand, rule, 0, i);
                            if (pr.Verdict == ClashVerdict.ConfirmedClash)
                            {
                                volume += pr.VolumeCm3;
                                worst = ClashVerdict.ConfirmedClash;
                                if (pr.Box != null && pr.Box.Length >= 6) box = Union(box, pr.Box);
                            }
                            else if (worst != ClashVerdict.ConfirmedClash && (pr.Verdict == ClashVerdict.GeometryError || pr.Verdict == ClashVerdict.Unsupported))
                            {
                                if (worst != ClashVerdict.GeometryError) worst = pr.Verdict;
                                reason = pr.Reason;
                            }
                        }

                        SimClashState st = worst == ClashVerdict.ConfirmedClash ? SimClashState.Confirmed
                            : worst == ClashVerdict.GeometryError ? SimClashState.Error
                            : worst == ClashVerdict.Unsupported ? SimClashState.Unsupported : SimClashState.NoClash;
                        if (st == SimClashState.Error) errors++;
                        if (st == SimClashState.Unsupported) unsupported++;

                        outClashes.Add(new SimExactClash
                        {
                            Key = c.Slot < 0 ? "h:" + c.Id : "l" + c.Slot + ":" + c.Id,
                            Id = c.Id, Slot = c.Slot, Label = SimKinds.LabelOf(e, linkName), CategoryName = SimKinds.CategoryName(e), LinkName = linkName, Kind = SimKinds.Of(e),
                            State = st, VolumeCm3 = volume, Reason = reason,
                            BoxMm = box == null ? null : new[] { box[0] - origin[0], box[1] - origin[1], box[2] - origin[2], box[3] - origin[0], box[4] - origin[1], box[5] - origin[2] },
                            Reactive = c.Slot < 0 && reactive.Contains(c.Id),
                        });
                    }
                    catch (Exception)
                    {
                        errors++;
                    }
                }
            }

            if (skipped > 0)
            {
                complete = false;
                res.IncompleteReasons.Add(skipped + " орчны элементийг цагийн хязгаараас (" + ClashBudgetMs / 1000.0 + " с) болж шалгаагүй.");
            }
            if (errors > 0) res.AdvisoryReasons.Add(errors + " хосыг Revit-ийн boolean шалгаж чадсангүй (геометрийн алдаа) — гурвалжингийн урьдчилсан шалгалт бие даасан хэвээр.");
            if (unsupported > 0) res.Notes.Add(unsupported + " элемент бодисгүй (2D, шугам…) тул мөргөлдөөнд шалгагдаагүй.");
            return complete;
        }

        private static double[] Union(double[] a, double[] b)
        {
            if (a == null) return (double[])b.Clone();
            return new[] { Math.Min(a[0], b[0]), Math.Min(a[1], b[1]), Math.Min(a[2], b[2]), Math.Max(a[3], b[3]), Math.Max(a[4], b[4]), Math.Max(a[5], b[5]) };
        }

        /// <summary>Буцаалтын ДАРАА (анхны төлөвт): батлагдсан мөргөлдөөн ӨМНӨ нь ч давхцаж байсан уу.</summary>
        private static void MarkPreExisting(Document doc, SimLoaded loaded, SimMoveCheck check, SimCandidates.Plan plan, double[] origin, List<SimExactClash> clashes)
        {
            var confirmed = clashes.Where(c => c.State == SimClashState.Confirmed).ToList();
            if (confirmed.Count == 0) return;
            try
            {
                var scope = new RevitKeyScope(doc);
                int skip;
                List<SideItem> moving = MovingItems(doc, scope, check, out skip);
                if (moving.Count == 0) return;
                ClashRule rule = Rule();
                var sw = Stopwatch.StartNew();
                using (var gv = new GeometryVerifier(doc, plan.Slots))
                {
                    gv.BeginStep();
                    foreach (SimExactClash c in confirmed)
                    {
                        if (sw.ElapsedMilliseconds > ClashBudgetMs) break;
                        Element e; ElementKey key;
                        if (c.Slot < 0) { e = doc.GetElement(new ElementId(c.Id)); if (e == null) continue; key = scope.Host(e); }
                        else
                        {
                            ClashLinks.Resolved link = ClashLinks.Resolve(doc, plan.Slots[c.Slot]);
                            if (link == null) continue;
                            e = link.Doc.GetElement(new ElementId(c.Id));
                            if (e == null) continue;
                            key = scope.Linked(link.Instance, link.Doc, e);
                        }
                        var cand = new SideItem { Key = key, IdValue = c.Id, Slot = c.Slot };
                        double before = 0;
                        foreach (SideItem mv in moving)
                        {
                            PairResult pr = gv.Verify(mv, cand, rule, 0, 0);
                            if (pr.Verdict == ClashVerdict.ConfirmedClash) before += pr.VolumeCm3;
                        }
                        if (before > 0) { c.PreExisting = true; c.BeforeVolumeCm3 = before; }
                    }
                }
            }
            catch (Exception ex)
            {
                SmartLog.Warn("sim", "preexisting_failed", new { ex = ex.GetType().Name });
            }
        }

        /* ============================== ДАГАЖ ӨӨРЧЛӨГДӨХ БИЕ ================ */

        internal const int MaxAffected = 80;

        /// <summary>
        /// Commit-ийн ДАРАА (бүлэг нээлттэй): Revit өөрөө өөрчилсөн загварын биеийг ангилж (зөөгдсөн / хостлогдсон / шошго-хэмжээс биш), ач холбогдлоор эрэмбэлнэ —
        /// бүтэц, MEP, хана эхэнд; шал/дээвэр (нүх, зүсэлт шинэчлэгдэнэ) сүүлд.  Тайлан ба мэдэгдэл эндээс «хэний ажил хөндөгдөх»-ийг мэднэ.
        /// </summary>
        internal static void ReadAffected(Document doc, SimMoveCheck check, List<long> modifiedIds, SimExactResult res)
        {
            try
            {
                var skip = new HashSet<long>(check.SelectedIds.Concat(check.HostedIds));
                var list = new List<SimAffected>();
                foreach (long id in modifiedIds.Distinct())
                {
                    if (skip.Contains(id)) continue;
                    Element e = doc.GetElement(new ElementId(id));
                    if (!SimKinds.IsModelBody(e)) continue;
                    list.Add(new SimAffected { Id = id, Label = SimKinds.LabelOf(e), Category = SimKinds.CategoryName(e), Kind = SimKinds.Of(e), SettledLoc = LocOrBox(e) });
                    if (list.Count >= MaxAffected * 3) break;
                }
                res.Affected = list.OrderBy(a => SimNarrative.AffectedRank(a.Kind)).ThenBy(a => a.Id).Take(MaxAffected).ToList();
            }
            catch (Exception ex) { SmartLog.Warn("sim", "affected_failed", new { ex = ex.GetType().Name }); }
        }

        /* ============================== SETTLED ГЕОМЕТР ===================== */

        private static void ReadSettledGeometry(Document doc, double[] origin, SimMoveCheck check, List<long> modifiedIds, List<SimMesh> moving, List<SimMesh> affected)
        {
            try
            {
                using (var fine = new SimGeometryReader(origin, true))
                {
                    int budget = 40000;
                    foreach (long id in check.SelectedIds.Concat(check.HostedIds))
                    {
                        Element e = doc.GetElement(new ElementId(id));
                        if (e == null || !e.IsValidObject) continue;
                        string problem;
                        SimMesh m = fine.Read(e, null, Math.Max(500, budget), out problem);
                        if (m == null) continue;
                        budget -= m.TriangleCount;
                        m.Key = "h:" + id; m.Id = id; m.Role = SimRole.Moving; m.Hosted = !check.SelectedIds.Contains(id);
                        m.Label = SimKinds.LabelOf(e); m.CategoryName = SimKinds.CategoryName(e); m.Kind = SimKinds.Of(e);
                        moving.Add(m);
                    }
                }
                using (var coarse = new SimGeometryReader(origin, false))
                {
                    var skip = new HashSet<long>(check.SelectedIds.Concat(check.HostedIds));
                    foreach (long id in modifiedIds.Distinct())
                    {
                        if (affected.Count >= MaxAffectedMeshes) break;
                        if (skip.Contains(id)) continue;
                        Element e = doc.GetElement(new ElementId(id));
                        if (!SimKinds.IsModelBody(e)) continue;
                        string problem;
                        SimMesh m = coarse.Read(e, null, 6000, out problem);
                        if (m == null) continue;
                        m.Key = "h:" + id; m.Id = id; m.Role = SimRole.Context;
                        m.Label = SimKinds.LabelOf(e); m.CategoryName = SimKinds.CategoryName(e); m.Kind = SimKinds.Of(e);
                        affected.Add(m);
                    }
                }
            }
            catch (Exception ex)
            {
                SmartLog.Warn("sim", "settled_geometry_failed", new { ex = ex.GetType().Name });
            }
        }
    }
}
