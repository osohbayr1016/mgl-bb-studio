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
    internal struct SimCand
    {
        public long Id;
        public int Slot;
        public double DistFt;
    }

    /// <summary>Simulation-д ачаалсан бүх зүйл (Revit-ийн амьд обьектгүй — id, тоо, сүлжээ).</summary>
    internal sealed class SimLoaded
    {
        public SimScene Scene;
        public SimMoveCheck Check;
        public DocumentKey Key;
        public List<LinkSlot> Slots = new List<LinkSlot>();
        /// <summary>Зөөгдөх элемент(үүд)-ийн bbox (фут) [minX,minY,minZ,maxX,maxY,maxZ] — шалгалтын хүрээг тооцоход.</summary>
        public double[] MovingBoxFt;
        public string Stamp;
        public string Problem;
        public bool Refused;
        public bool NeedsAck;
        public double LoadMs;
        public int ContextCount;
    }

    /// <summary>Хөдөлгөөний орчны нэр дэвшигчдийг (host + ачаалагдсан линк) хайрцгаар шүүж, зайгаар эрэмбэлэн цуглуулна.</summary>
    internal static class SimCandidates
    {
        internal sealed class Plan
        {
            public List<SimCand> Cands = new List<SimCand>();
            public List<LinkSlot> Slots = new List<LinkSlot>();
            public List<string> Incomplete = new List<string>();
            public List<string> Advisory = new List<string>();
        }

        /// <summary>
        /// `region` (host координат, фут) дотор хүрээтэй 3D элементүүд.  `excludeHost` = зөөгдөж буй (өөрсдийг нь) хасна.
        /// Зайгаар (`centerFt`-ээс) эрэмбэлж `cap`-аас илүүг тайрна (тайрсныг ИЛ хэлнэ).
        /// </summary>
        internal static Plan Collect(Document doc, Outline region, ISet<long> excludeHost, XYZ centerFt, int cap)
        {
            var plan = new Plan();
            var all = new List<SimCand>();

            try
            {
                foreach (ElementId id in new FilteredElementCollector(doc).WhereElementIsNotElementType()
                    .WherePasses(new BoundingBoxIntersectsFilter(region)).ToElementIds())
                {
                    if (excludeHost != null && excludeHost.Contains(id.Value)) continue;
                    Element e = doc.GetElement(id);
                    if (!SimKinds.IsModelBody(e)) continue;
                    all.Add(new SimCand { Id = id.Value, Slot = -1, DistFt = DistanceTo(e, null, centerFt) });
                }
                WorksetNote(doc, "Энэ файл", plan);
            }
            catch (Exception ex)
            {
                plan.Incomplete.Add("Энэ файлын орчны элементийг олж чадсангүй (" + ex.GetType().Name + ").");
            }

            int unloaded = 0;
            try
            {
                foreach (RevitLinkInstance inst in new FilteredElementCollector(doc).OfClass(typeof(RevitLinkInstance)).Cast<RevitLinkInstance>())
                {
                    Document ld = null;
                    try { ld = inst.GetLinkDocument(); } catch (Exception) { }
                    if (ld == null) { unloaded++; continue; }
                    try
                    {
                        Transform t = inst.GetTotalTransform();
                        Outline lr = PreChangeClashProbe.TransformOutline(region, t.Inverse);
                        var slot = new LinkSlot { InstanceId = inst.Id.Value, InstanceUid = inst.UniqueId, Name = ClashLinks.DisplayName(inst), LinkDocId = RevitDocumentKeys.Of(ld).Id };
                        plan.Slots.Add(slot);
                        int si = plan.Slots.Count - 1;
                        foreach (ElementId id in new FilteredElementCollector(ld).WhereElementIsNotElementType()
                            .WherePasses(new BoundingBoxIntersectsFilter(lr)).ToElementIds())
                        {
                            Element e = ld.GetElement(id);
                            if (!SimKinds.IsModelBody(e)) continue;
                            all.Add(new SimCand { Id = id.Value, Slot = si, DistFt = DistanceTo(e, t, centerFt) });
                        }
                        WorksetNote(ld, "Линк «" + slot.Name + "»", plan);
                    }
                    catch (Exception ex)
                    {
                        plan.Incomplete.Add("Линкийн орчны элементийг олж чадсангүй (" + ex.GetType().Name + ").");
                    }
                }
            }
            catch (Exception ex)
            {
                plan.Incomplete.Add("Линкүүдийг уншиж чадсангүй (" + ex.GetType().Name + ").");
            }
            if (unloaded > 0)
                plan.Advisory.Add(unloaded + " линк unload хийгдсэн — тэдгээртэй мөргөлдөөнийг шалгаагүй (илрээгүй ≠ байхгүй).");

            all.Sort((a, b) => a.DistFt.CompareTo(b.DistFt));
            if (all.Count > cap)
            {
                plan.Incomplete.Add("Орчинд " + all.Count + " элемент байна — хамгийн ойрын " + cap + "-г л шалгав.");
                all = all.Take(cap).ToList();
            }
            plan.Cands = all;
            return plan;
        }

        private static double DistanceTo(Element e, Transform linkT, XYZ center)
        {
            try
            {
                BoundingBoxXYZ bb = e.get_BoundingBox(null);
                if (bb == null) return double.MaxValue;
                XYZ c = (bb.Min + bb.Max) * 0.5;
                if (linkT != null) c = linkT.OfPoint(c);
                return c.DistanceTo(center);
            }
            catch (Exception) { return double.MaxValue; }
        }

        private static void WorksetNote(Document d, string what, Plan plan)
        {
            try
            {
                if (!d.IsWorkshared) return;
                int closed = new FilteredWorksetCollector(d).OfKind(WorksetKind.UserWorkset).Cast<Workset>().Count(w => !w.IsOpen);
                if (closed > 0) plan.Advisory.Add(what + ": " + closed + " хаалттай workset — тэдгээрийн элементийг шалгаагүй.");
            }
            catch (Exception) { }
        }
    }

    /// <summary>
    /// Simulation-ийн 3D сцен ачаалах (хэсэглэсэн job — Revit-ийн UI-г гацаахгүй).
    ///   Init: сонголтыг шалгана → зөөгдөх элемент(үүд) + хостлогдсоныг НАРИЙН тессел → орчны нэр дэвшигч (зайгаар эрэмбэлсэн).
    ///   Read: ~120 мс тутамд хэдэн арван элементийн бүдүүн сүлжээ (хамгийн ойрыг түрүүлж).  Төсөв дүүрвэл ИЛ тэмдэглэнэ.
    /// ⚠️ Step хооронд зөвхөн id/сүлжээ (амьд Revit обьект ҮГҮЙ).
    /// </summary>
    internal sealed class SimSceneLoader : ISmartJob
    {
        internal const int MaxCandidates = 3500;
        internal const int MaxContextTrianglesTotal = 450000;
        internal const int MaxTrianglesPerContext = 6000;
        internal const int MaxTrianglesMoving = 40000;
        private const int SliceMs = 110;

        private readonly DocumentKey _key;
        private readonly IList<long> _ids;
        private readonly bool _ackGiven;
        private readonly Action<int, int> _progress;
        private readonly Stopwatch _clock = Stopwatch.StartNew();

        private int _stage;                   // 0 = init, 1 = read, 2 = done
        private SimLoaded _res;
        private SimCandidates.Plan _plan;
        private int _next;
        private long _tris;
        private int _skipped, _noSolid;
        private HashSet<long> _reactive, _hosts;
        private SimGeometryReader _reader;
        private readonly Dictionary<int, ClashLinks.Resolved> _links = new Dictionary<int, ClashLinks.Resolved>();

        public SimLoaded Result { get { return _res; } }
        public string Name { get { return "sim.load"; } }

        internal SimSceneLoader(DocumentKey key, IList<long> selectedIds, bool ackGiven, Action<int, int> progress)
        {
            _key = key;
            _ids = selectedIds;
            _ackGiven = ackGiven;
            _progress = progress;
        }

        public void OnCancelled() { Cleanup(); }

        private void Cleanup()
        {
            try { if (_reader != null) _reader.Dispose(); } catch (Exception) { }
            _reader = null;
        }

        public bool Step(UIApplication app)
        {
            try
            {
                Document doc = Active(app);
                if (_stage == 0) { Init(doc); return _stage == 2; }
                if (_stage == 1) { ReadSome(doc); return _stage == 2; }
                return true;
            }
            catch (Exception ex)
            {
                Cleanup();
                SmartLog.Error("sim", "load_failed", ex);
                _res = _res ?? new SimLoaded { Key = _key };
                _res.Problem = "Орчныг уншиж чадсангүй (" + ex.GetType().Name + "): " + SmartLog.Scrub(ex.Message);
                _res.Scene = null;
                _stage = 2;
                return true;
            }
        }

        private Document Active(UIApplication app)
        {
            UIDocument ui = app.ActiveUIDocument;
            Document doc = ui != null ? ui.Document : null;
            if (doc == null) throw new InvalidOperationException("Идэвхтэй баримт алга.");
            if (!_key.Equals(RevitDocumentKeys.Of(doc)))
                throw new InvalidOperationException("Идэвхтэй файл «" + doc.Title + "» — энэ цонх «" + _key.Display + "» файлынх. Тэр файл руугаа шилжинэ үү.");
            return doc;
        }

        private void Init(Document doc)
        {
            _res = new SimLoaded { Key = _key, Stamp = ModelChangeCounter.Stamp(doc) };
            var eids = _ids.Select(i => new ElementId(i)).ToList();
            SimMoveCheck check = SimElementRules.Check(doc, eids);
            _res.Check = check;
            _res.NeedsAck = check.NeedsAck && !_ackGiven;
            if (!check.Ok)
            {
                _res.Problem = check.Problem;
                _res.Refused = check.Refused;
                _stage = 2;
                return;
            }

            // Зөөгдөх элемент(үүд) + хостлогдсон — bbox, origin.
            var moving = check.AllMovingIds.Distinct().ToList();
            double minX = double.MaxValue, minY = double.MaxValue, minZ = double.MaxValue, maxX = double.MinValue, maxY = double.MinValue, maxZ = double.MinValue;
            foreach (long id in moving)
            {
                Element e = doc.GetElement(new ElementId(id));
                BoundingBoxXYZ bb = e != null ? e.get_BoundingBox(null) : null;
                if (bb == null) continue;
                minX = Math.Min(minX, bb.Min.X); minY = Math.Min(minY, bb.Min.Y); minZ = Math.Min(minZ, bb.Min.Z);
                maxX = Math.Max(maxX, bb.Max.X); maxY = Math.Max(maxY, bb.Max.Y); maxZ = Math.Max(maxZ, bb.Max.Z);
            }
            if (minX == double.MaxValue) { _res.Problem = "Элементийн хэмжээ (bounding box) уншигдсангүй."; _stage = 2; return; }
            _res.MovingBoxFt = new[] { minX, minY, minZ, maxX, maxY, maxZ };

            double mmPerFoot = PcUnits.Mm(1.0);
            var origin = new[] { (minX + maxX) / 2 * mmPerFoot, (minY + maxY) / 2 * mmPerFoot, minZ * mmPerFoot };
            var scene = new SimScene
            {
                OriginMm = origin, MovingName = check.Name, PrimaryId = check.PrimaryId, PrimaryKind = check.Kind.ToString(),
                LineConstraintXY = check.LineXY, LineConstraintReason = check.LineReason,
            };
            scene.IncompleteReasons.AddRange(check.Notes);
            _res.Scene = scene;

            _reader = new SimGeometryReader(origin, true);
            int budget = MaxTrianglesMoving;
            foreach (long id in moving)
            {
                Element e = doc.GetElement(new ElementId(id));
                if (e == null) continue;
                bool hosted = !check.SelectedIds.Contains(id);
                string problem;
                SimMesh m = _reader.Read(e, null, Math.Max(500, budget), out problem);
                if (m == null)
                {
                    if (!hosted) { _res.Problem = "«" + SimKinds.LabelOf(e) + "» — " + (problem ?? "геометр уншигдсангүй") + " Simulation-д харуулах боломжгүй."; Cleanup(); _stage = 2; return; }
                    continue;
                }
                budget -= m.TriangleCount;
                m.Key = "h:" + id; m.Id = id; m.Slot = -1; m.Role = SimRole.Moving; m.Hosted = hosted;
                m.Label = SimKinds.LabelOf(e); m.CategoryName = SimKinds.CategoryName(e); m.Kind = SimKinds.Of(e);
                scene.Moving.Add(m);
                if (m.Truncated) scene.IncompleteReasons.Add("«" + m.Label + "» геометр хэт нарийн — харуулахдаа хэсэгчлэн тайрав.");
            }
            _reader.Dispose();
            _reader = new SimGeometryReader(origin, false);

            // Орчны нэр дэвшигч.
            double padMm = Math.Max(6000, Math.Min(18000, 1.2 * Math.Max((maxX - minX) * mmPerFoot, Math.Max((maxY - minY) * mmPerFoot, (maxZ - minZ) * mmPerFoot))));
            double pad = PcUnits.ToInternalMm(padMm);
            double padZ = PcUnits.ToInternalMm(Math.Min(padMm, 6000));
            var outline = new Outline(new XYZ(minX - pad, minY - pad, minZ - padZ), new XYZ(maxX + pad, maxY + pad, maxZ + padZ));
            XYZ center = new XYZ((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2);
            _plan = SimCandidates.Collect(doc, outline, new HashSet<long>(moving), center, MaxCandidates);
            _res.Slots = _plan.Slots;
            scene.IncompleteReasons.AddRange(_plan.Incomplete);
            _reactive = new HashSet<long>(check.ReactiveIds);
            _hosts = new HashSet<long>(check.HostIds);
            scene.ContextBounds = new[] { (minX - pad) * mmPerFoot - origin[0], (minY - pad) * mmPerFoot - origin[1], (minZ - padZ) * mmPerFoot - origin[2],
                (maxX + pad) * mmPerFoot - origin[0], (maxY + pad) * mmPerFoot - origin[1], (maxZ + padZ) * mmPerFoot - origin[2] };
            _stage = 1;
            if (_progress != null) _progress(0, _plan.Cands.Count);
        }

        private void ReadSome(Document doc)
        {
            var sw = Stopwatch.StartNew();
            SimScene scene = _res.Scene;
            _links.Clear();
            while (_next < _plan.Cands.Count && sw.ElapsedMilliseconds < SliceMs)
            {
                if (_tris >= MaxContextTrianglesTotal)
                {
                    scene.IncompleteReasons.Add("Орчны геометр хэт их (" + MaxContextTrianglesTotal / 1000 + "k гурвалжин) — үлдсэн " + (_plan.Cands.Count - _next) + " элементийг харуулсангүй.");
                    _next = _plan.Cands.Count;
                    break;
                }
                SimCand c = _plan.Cands[_next++];
                try { ReadOne(doc, c, scene); }
                catch (Exception) { _skipped++; }
            }
            if (_progress != null) _progress(_next, _plan.Cands.Count);
            if (_next >= _plan.Cands.Count) Finish();
        }

        private void ReadOne(Document doc, SimCand c, SimScene scene)
        {
            Document d = doc;
            Transform t = null;
            string linkName = null;
            if (c.Slot >= 0)
            {
                ClashLinks.Resolved link;
                if (!_links.TryGetValue(c.Slot, out link)) { link = ClashLinks.Resolve(doc, _plan.Slots[c.Slot]); _links[c.Slot] = link; }
                if (link == null) { _skipped++; return; }
                d = link.Doc; t = link.Transform; linkName = _plan.Slots[c.Slot].Name;
            }
            Element e = d.GetElement(new ElementId(c.Id));
            if (e == null) return;
            string problem;
            SimMesh m = _reader.Read(e, t, MaxTrianglesPerContext, out problem);
            if (m == null) { _noSolid++; return; }
            _tris += m.TriangleCount;
            m.Key = c.Slot < 0 ? "h:" + c.Id : "l" + c.Slot + ":" + c.Id;
            m.Id = c.Id; m.Slot = c.Slot; m.Role = SimRole.Context;
            m.Label = SimKinds.LabelOf(e, linkName); m.CategoryName = SimKinds.CategoryName(e); m.LinkName = linkName; m.Kind = SimKinds.Of(e);
            if (c.Slot < 0)
            {
                m.Reactive = _reactive.Contains(c.Id);
                m.IgnoreConflicts = _hosts.Contains(c.Id);
            }
            scene.Context.Add(m);
        }

        private void Finish()
        {
            Cleanup();
            SimScene scene = _res.Scene;
            if (_skipped > 0) scene.IncompleteReasons.Add(_skipped + " элементийг уншиж чадсангүй (линк unload, алдаа).");
            _res.ContextCount = scene.Context.Count;
            _res.LoadMs = _clock.Elapsed.TotalMilliseconds;
            foreach (string a in _plan.Advisory) scene.IncompleteReasons.Add(a);
            _stage = 2;
            SmartLog.Info("sim", "loaded", new { moving = scene.Moving.Count, context = scene.Context.Count, tris = scene.TotalTriangles, noSolid = _noSolid, skipped = _skipped, ms = (long)_res.LoadMs });
        }
    }
}
