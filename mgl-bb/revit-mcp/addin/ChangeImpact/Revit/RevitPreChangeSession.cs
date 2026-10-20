using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;
using Autodesk.Revit.UI.Selection;
using RevitMcpAddin.ChangeImpact.Core;
using RevitMcpAddin.Smart;
using RevitMcpAddin.Smart.Core;

namespace RevitMcpAddin.ChangeImpact
{
    /// <summary>
    /// `IPreChangeSession`-ий Revit-тэй хэрэгжүүлэлт.  Цонх (модальгүй) Revit API-д ЗӨВХӨН `SmartExecutor`-оор хүрнэ; session нь `Document`-ийг
    /// ХАДГАЛАХГҮЙ (түлхүүр + тоолуурын barьц).
    ///
    /// ⚠️ Preview-ийн `CaptureSpec` (id-ууд) энд хадгалагдана — Apply ӨМНӨ/ДАРАА ИЖИЛ нэр дэвшигчээр дахин уншихын тулд.  Зөвхөн ХАМГИЙН СҮҮЛИЙН preview.
    /// </summary>
    internal sealed class RevitPreChangeSession : IPreChangeSession, IDoorMoveSession
    {
        private readonly DocumentKey _key;
        private readonly ChangeStamp _changes;
        private readonly RevitImpactSession _impact;
        private readonly object _gate = new object();
        // Preview тус бүрийн CaptureSpec — хуучин (удаан) preview дараа нь дуусаад ШИНИЙГ дарахгүйн тулд report id-аар (сүүлийн 6).
        private readonly Dictionary<string, CaptureSpec> _specs = new Dictionary<string, CaptureSpec>(StringComparer.Ordinal);
        private readonly Queue<string> _specOrder = new Queue<string>();
        private const int MaxSpecs = 6;
        private readonly HashSet<string> _ownershipAck = new HashSet<string>(StringComparer.Ordinal);

        public string DocumentTitle { get { return _key.Display; } }

        internal RevitPreChangeSession(Document doc)
        {
            _key = RevitDocumentKeys.Of(doc);
            _changes = ModelChangeCounter.HandleFor(doc);
            _impact = new RevitImpactSession(doc);
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

        /* ============================== СОНГОЛТ ============================= */

        public Task<PreChangeSelection> GetSelectionAsync(CancellationToken ct)
        {
            return SmartExecutor.Run(app =>
            {
                Document doc = Active(app);
                ICollection<ElementId> ids = app.ActiveUIDocument.Selection.GetElementIds();
                if (ids.Count == 0) return PreChangeSelection.Invalid(null);
                var walls = ids.Select(i => doc.GetElement(i)).OfType<Wall>().ToList();
                if (walls.Count == 1) return Describe(doc, walls[0]);
                if (walls.Count > 1) return PreChangeSelection.Invalid("Нэг ханыг сонгоно уу (одоо " + walls.Count + " хана сонгогдсон).");
                // Хана биш элемент (линк, хаалга...) — шалтгааныг ИЛ хэлнэ.
                return Describe(doc, doc.GetElement(ids.First()));
            }, ct, "prechange.selection");
        }

        public Task<string> PeekSelectedWallAsync(CancellationToken ct)
        {
            return SmartExecutor.Run(app =>
            {
                Document doc = Active(app);
                ICollection<ElementId> ids = app.ActiveUIDocument.Selection.GetElementIds();
                if (ids.Count != 1) return (string)null;
                var wall = doc.GetElement(ids.First()) as Wall;
                return wall != null ? wall.UniqueId : null;
            }, ct, "prechange.peek");
        }

        public Task<PreChangeSelection> PickWallAsync(CancellationToken ct)
        {
            return SmartExecutor.Run(app =>
            {
                Document doc = Active(app);
                try
                {
                    Reference r = app.ActiveUIDocument.Selection.PickObject(ObjectType.Element, new WallOrLinkFilter(), "Зөөх ханаа сонгоно уу (Esc = цуцлах)");
                    return Describe(doc, doc.GetElement(r.ElementId));
                }
                catch (Autodesk.Revit.Exceptions.OperationCanceledException)
                {
                    return PreChangeSelection.Invalid(null);
                }
            }, ct, "prechange.pick");
        }

        /// <summary>
        /// Зураг дээр цэг сонгуулж, хананы ямар тал руу зөөхийг тодорхойлно: (сонгосон цэг − ханын төв) · зүүн нормаль &gt; 0 бол 0-р тал, үгүй бол 1-р тал.
        /// Нормаль = (−dy, dx) — `PreChangeWallRules.Sides`-ийн `Index 0`-тэй ИЖИЛ.  Цэг ханын шугам дээр яг (|скаляр үржвэр| ≈ 0) бол сонголт тодорхойгүй.
        /// </summary>
        public Task<SidePickResult> PickSideAsync(PreChangeSelection wall, CancellationToken ct)
        {
            if (wall == null || !wall.Valid) return Task.FromResult(SidePickResult.Fail("Эхлээд хана сонгоно уу."));
            long wallId = wall.SourceId;
            return SmartExecutor.Run(app =>
            {
                Document doc = Active(app);
                var w = doc.GetElement(new ElementId(wallId)) as Wall;
                var lc = w != null ? w.Location as LocationCurve : null;
                var line = lc != null ? lc.Curve as Line : null;
                if (line == null) return SidePickResult.Fail("Хананы байрлалын шугам олдсонгүй.");
                try
                {
                    XYZ p = app.ActiveUIDocument.Selection.PickPoint("Ханыг ямар тал руу зөөх вэ? Тэр талд дарна уу (Esc = цуцлах)");
                    XYZ a = line.GetEndPoint(0), b = line.GetEndPoint(1);
                    XYZ d = (b - a).Normalize();
                    XYZ nrm = new XYZ(-d.Y, d.X, 0);
                    XYZ mid = (a + b) / 2.0;
                    double side = (p.X - mid.X) * nrm.X + (p.Y - mid.Y) * nrm.Y;
                    if (Math.Abs(side) < PcUnits.ToInternalMm(5)) return SidePickResult.Fail("Цэг ханын шугам дээр байна — талын аль нэг рүү дахин дарна уу.");
                    return SidePickResult.Of(side > 0 ? 0 : 1);
                }
                catch (Autodesk.Revit.Exceptions.OperationCanceledException) { return SidePickResult.Cancel(); }
                catch (Autodesk.Revit.Exceptions.InvalidOperationException) { return SidePickResult.Fail("Энэ харагдац дээр цэг сонгох боломжгүй — план харагдац руу шилжээд дахин оролдоно уу."); }
            }, ct, "prechange.pickside");
        }

        private sealed class WallOrLinkFilter : ISelectionFilter
        {
            public bool AllowElement(Element e) { return e is Wall || e is RevitLinkInstance; }
            public bool AllowReference(Reference reference, XYZ position) { return false; }
        }

        private PreChangeSelection Describe(Document doc, Element e)
        {
            WallCheck wc = PreChangeWallRules.Check(doc, e);
            if (!wc.Ok) return PreChangeSelection.Invalid(wc.Problem);

            Wall wall = wc.Wall;
            var sel = new PreChangeSelection { Valid = true, SourceId = wall.Id.Value, SourceUid = wall.UniqueId };
            try { WallType t = wall.WallType; sel.TypeName = t != null ? t.Name : null; } catch (Exception) { }
            try { Level lv = doc.GetElement(wall.LevelId) as Level; sel.LevelName = lv != null ? lv.Name : null; } catch (Exception) { }
            sel.LengthMm = PcUnits.Mm(wc.Line.Length);
            sel.ThicknessMm = PcUnits.Mm(wc.ThicknessFt);
            sel.Label = (sel.TypeName ?? "Хана") + " · #" + wall.Id.Value;
            sel.Warnings.AddRange(wc.Warnings);
            sel.Sides = PreChangeWallRules.Sides(doc, wall, wc.Line, wc.ThicknessFt);
            int total; bool trunc;
            List<long> hosted = PreChangeWallRules.InsertIds(wall, out total, out trunc);
            sel.HostedCount = Math.Max(0, total);

            // Workshare: хана ба хамаарах элемент (хост, хөрш хана) хэнд ч эзэмшигдээгүй бол preview түр эзэмшил үүсгэж болзошгүй — эхлэхээс ӨМНӨ асууна.
            // Өөр хэрэглэгчид эзэмшигдсэн хамаарах элемент: preview-д хүлээхгүй, шууд хэлнэ (зөөх боломжгүй).
            sel.NeedsCheckoutAck = wc.NeedsCheckoutAck;
            try
            {
                var joined = PreChangeCapture.PlanJoined(doc, wall, new List<string>());
                int notOwned;
                string foreign = PreChangeWallRules.DependentOwnership(doc, hosted.Concat(joined), out notOwned);
                if (foreign != null) { sel.Valid = false; sel.Problem = foreign; return sel; }
                if (notOwned > 0) sel.NeedsCheckoutAck = true;
            }
            catch (Exception) { /* эзэмшлийг уншиж чадсангүй — Job-д дахин шалгана */ }
            return sel;
        }

        /* ============================== PREVIEW / APPLY ===================== */

        public async Task<PreChangeReport> PreviewAsync(PreChangeRequest request, IProgress<JobProgress> progress, Action<PreChangeReport> onProvisional, CancellationToken ct)
        {
            bool ack;
            lock (_gate) ack = request != null && request.SourceUid != null && _ownershipAck.Contains(request.SourceUid);
            var job = new PreChangeJob(request, _key, progress, onProvisional, ack);
            await SmartExecutor.RunSteps(job, ct);
            if (job.Result == null) throw new InvalidOperationException("Шинжилгээний дүн гарсангүй.");
            lock (_gate)
            {
                if (job.Spec != null && !string.IsNullOrEmpty(job.Result.Id))
                {
                    _specs[job.Result.Id] = job.Spec;
                    _specOrder.Enqueue(job.Result.Id);
                    while (_specOrder.Count > MaxSpecs) _specs.Remove(_specOrder.Dequeue());
                }
            }
            return job.Result;
        }

        public async Task<ApplyOutcome> ApplyAsync(PreChangeReport preview, PreChangeRequest currentRequest, IProgress<JobProgress> progress, CancellationToken ct)
        {
            CaptureSpec spec = null;
            lock (_gate) { if (preview != null && preview.Id != null) _specs.TryGetValue(preview.Id, out spec); }
            if (progress != null) progress.Report(JobProgress.Of("apply", 0, 0, "Хөдөлгөөнийг хэрэгжүүлж, preview-тэй тулгаж байна"));
            ApplyOutcome outcome = await SmartExecutor.Run(app => PreChangeApply.Run(app, _key, preview, spec, currentRequest), ct, "prechange.apply");
            // Хэрэгжсэн бол загвар өөрчлөгдсөн — хуучин сүүдэр, кэш хэрэггүй.  Буцсан/амжилтгүй бол сүүдрийг цонх өөрөө шийднэ.
            // «Магадгүй өөрчлөгдсөн» (буцаалт баталгаагүй) ч мөн хуучин — кэшийг хэзээ ч итгэж болохгүй.
            if (outcome != null && (outcome.Moved || outcome.ModelMayBeModified))
            {
                PreChangePlanCache.Purge(_key.Id);
                PreChangeDoorContext.Cache.PurgeDocument(_key.Id);
                try { await ClearGhostAsync(); } catch (Exception) { }
            }
            return outcome;
        }

        /// <summary>
        /// Fail-closed: тэмдэг уншигдаагүй (`_changes` байхгүй, preview-д тэмдэг алга, шидсэн) = Unknown — `Fresh` БИШ.
        /// Линк / гарцын тохиргооны өөрчлөлтийг ЭНД (Revit API-гүй) шалгаж чадахгүй — Apply-ийн мөчид бүтэн хурууны хээгээр шалгана (`PreChangeStale`).
        /// </summary>
        public FreshnessState CheckFreshness(PreChangeReport report)
        {
            return PreChangeFreshness.Of(report, () => _changes != null ? _changes.Current : null);
        }

        public bool OwnershipAcknowledged(PreChangeSelection wall)
        {
            if (wall == null || !wall.NeedsCheckoutAck) return true;
            lock (_gate) return wall.SourceUid != null && _ownershipAck.Contains(wall.SourceUid);
        }

        public void AcknowledgeOwnership(PreChangeSelection wall)
        {
            if (wall == null || wall.SourceUid == null) return;
            lock (_gate) _ownershipAck.Add(wall.SourceUid);
        }

        public Task SetGhostAsync(PreChangeGhostRequest ghost, CancellationToken ct)
        {
            if (ghost == null || ghost.VectorMm == null) return ClearGhostAsync();
            return SmartExecutor.Run(app =>
            {
                Document doc = Active(app);
                PreChangeGhost.Show(app, doc, _key, ghost.WallId, ghost.VectorMm, ghost.Tone);
                return true;
            }, ct, "prechange.ghost");
        }

        public Task ClearGhostAsync()
        {
            // Revit-ийн thread-д; ExternalEvent бэлэн биш (Revit унтарч байна) бол чимээгүй.
            if (!SmartExecutor.IsReady) return Task.FromResult(true);
            return SmartExecutor.Run(app => { PreChangeGhost.Clear(app); return true; }, CancellationToken.None, "prechange.ghost.clear");
        }

        public Task<SelectOutcome> ShowAsync(PreChangeItem item, CancellationToken ct)
        {
            var impactItem = new ImpactItem { Id = item.Id, Uid = item.Uid, Kind = item.Kind, Name = item.Title };
            return _impact.ShowAsync(impactItem, ct);
        }

        /* ============================== ХААЛГА: СОНГОЛТ ===================== */

        private static bool IsDoorElement(Element e)
        {
            var fi = e as FamilyInstance;
            return fi != null && fi.Category != null && fi.Category.Id.Value == (long)BuiltInCategory.OST_Doors;
        }

        public Task<PreChangeSelection> GetDoorSelectionAsync(CancellationToken ct)
        {
            return SmartExecutor.Run(app =>
            {
                Document doc = Active(app);
                ICollection<ElementId> ids = app.ActiveUIDocument.Selection.GetElementIds();
                if (ids.Count == 0) return PreChangeSelection.Invalid(null);
                var elems = ids.Select(i => doc.GetElement(i)).Where(e => e != null).ToList();
                var doors = elems.Where(IsDoorElement).ToList();
                if (doors.Count == 1) return DescribeDoor(doc, doors[0]);
                if (doors.Count > 1) return PreChangeSelection.Invalid("Нэг хаалгыг сонгоно уу (одоо " + doors.Count + " хаалга сонгогдсон).");
                // Хаалга биш ЯГ НЭГ элемент сонгосон бол шалтгааныг ИЛ хэлнэ (линк, хана...).  Олон/хоосон бол чимээгүй (хана зөөх цонхтой зэрэг ажиллана).
                return elems.Count == 1 ? DescribeDoor(doc, elems[0]) : PreChangeSelection.Invalid(null);
            }, ct, "prechange.door.selection");
        }

        public Task<string> PeekSelectedDoorAsync(CancellationToken ct)
        {
            return SmartExecutor.Run(app =>
            {
                Document doc = Active(app);
                ICollection<ElementId> ids = app.ActiveUIDocument.Selection.GetElementIds();
                if (ids.Count != 1) return (string)null;
                Element e = doc.GetElement(ids.First());
                return IsDoorElement(e) ? e.UniqueId : null;
            }, ct, "prechange.door.peek");
        }

        public Task<PreChangeSelection> PickDoorAsync(CancellationToken ct)
        {
            return SmartExecutor.Run(app =>
            {
                Document doc = Active(app);
                try
                {
                    Reference r = app.ActiveUIDocument.Selection.PickObject(ObjectType.Element, new DoorOrLinkFilter(), "Зөөх хаалгаа сонгоно уу (Esc = цуцлах)");
                    return DescribeDoor(doc, doc.GetElement(r.ElementId));
                }
                catch (Autodesk.Revit.Exceptions.OperationCanceledException)
                {
                    return PreChangeSelection.Invalid(null);
                }
            }, ct, "prechange.door.pick");
        }

        private sealed class DoorOrLinkFilter : ISelectionFilter
        {
            public bool AllowElement(Element e) { return IsDoorElement(e) || e is RevitLinkInstance; }
            public bool AllowReference(Reference reference, XYZ position) { return false; }
        }

        private PreChangeSelection DescribeDoor(Document doc, Element e)
        {
            DoorCheck dc = PreChangeDoorRules.Check(doc, e);
            if (!dc.Ok) return PreChangeSelection.Invalid(dc.Problem);

            FamilyInstance door = dc.Door;
            Wall host = dc.Host;
            var sel = new PreChangeSelection
            {
                Valid = true, Operation = PreChangeOperationKind.DoorMove, SourceId = door.Id.Value, SourceUid = door.UniqueId,
                Label = PreChangeDoorRules.LabelOf(door), Mark = PreChangeDoorRules.MarkOf(door), TypeName = PreChangeDoorRules.TypeNameOf(door),
                HostId = host.Id.Value, HostUid = host.UniqueId,
                LengthMm = PcUnits.Mm(dc.HostLine.Length), ThicknessMm = PcUnits.Mm(dc.HostThicknessFt),
                NeedsCheckoutAck = dc.NeedsCheckoutAck,
            };
            sel.Warnings.AddRange(dc.Warnings);
            XYZ d = dc.HostLine.Direction;
            sel.TangentX = d.X;
            sel.TangentY = d.Y;
            try { WallType wt = host.WallType; sel.HostLabel = (wt != null ? wt.Name : "Хана"); } catch (Exception) { sel.HostLabel = "Хана"; }
            try { Level lv = doc.GetElement(door.LevelId) as Level; sel.LevelName = lv != null ? lv.Name : null; } catch (Exception) { }
            sel.DoorWidthMm = PreChangeDoorRules.ParamMm(door, BuiltInParameter.FAMILY_ROUGH_WIDTH_PARAM, BuiltInParameter.DOOR_WIDTH, BuiltInParameter.FAMILY_WIDTH_PARAM) ?? 0;
            sel.DoorHeightMm = PreChangeDoorRules.ReadHeightMm(door);
            long fromId, toId; string fromName, toName; bool readable;
            PreChangeDoorRules.ReadRooms(door, out fromId, out toId, out fromName, out toName, out readable);
            if (readable) { sel.FromRoom = fromName; sel.ToRoom = toName; }
            return sel;
        }

        /* ============================== ХААЛГА: КОНТЕКСТ, ЗОРИЛТ ============ */

        public Task<DoorContextLoad> LoadContextAsync(PreChangeSelection door, CancellationToken ct)
        {
            if (door == null || !door.Valid || door.Operation != PreChangeOperationKind.DoorMove)
                return Task.FromResult(DoorContextLoad.Fail("Эхлээд хаалгаа сонгоно уу."));
            long id = door.SourceId;
            string uid = door.SourceUid;
            bool acknowledged = OwnershipAcknowledged(door);
            return SmartExecutor.Run(app =>
            {
                Document doc = Active(app);
                DoorCheck dc = PreChangeDoorRules.Check(doc, doc.GetElement(new ElementId(id)));
                if (!dc.Ok) return DoorContextLoad.Fail(dc.Problem, dc.Refused);
                if (!string.Equals(dc.Door.UniqueId, uid ?? dc.Door.UniqueId, StringComparison.Ordinal))
                    return DoorContextLoad.Fail("Хаалга солигдсон байна — дахин сонгоно уу.");
                if (dc.NeedsCheckoutAck && !acknowledged) return DoorContextLoad.Fail(PreChangeText.OwnershipAckDoor);
                string stamp = ModelChangeCounter.Stamp(doc);
                bool fromCache;
                DoorContextData data = PreChangeDoorContext.GetOrBuild(doc, _key, dc, stamp, out fromCache);
                var load = new DoorContextLoad { Ok = true, Context = data.Ctx };
                load.Warnings.AddRange(dc.Warnings);
                if (fromCache) SmartLog.Info("prechange", "door_context_cache_hit", new { openings = data.Ctx.Openings.Count, obstacles = data.Ctx.Obstacles.Count });
                return load;
            }, ct, "prechange.door.context");
        }

        public bool IsContextCurrent(DoorMoveContext ctx)
        {
            try
            {
                string cur = _changes != null ? _changes.Current : null;
                return ctx != null && cur != null && !string.IsNullOrEmpty(ctx.ModelStamp) && string.Equals(cur, ctx.ModelStamp, StringComparison.Ordinal);
            }
            catch (Exception) { return false; }
        }

        /// <summary>
        /// Revit-ийн PickPoint (snap-тай): хэрэглэгч зураг дээр шинэ байрлал дээр дарна, цэг ХОСТЫН ТӨВ ШУГАМ дээр проекц хийгдэж, хаалганы одоогийн төвөөс
        /// хостын дагуух ТЭМДЭГТЭЙ зай болно.  ⚠️ Хулганы глобал hook, Win32, reflection БАЙХГҮЙ — зөвхөн Revit-ийн албан ёсны PickPoint.
        /// </summary>
        public Task<DoorTargetPick> PickTargetAsync(DoorMoveContext ctx, CancellationToken ct)
        {
            if (ctx == null || ctx.Host == null || ctx.Door == null) return Task.FromResult(DoorTargetPick.Fail("Хаалганы мэдээлэл бэлэн болоогүй байна."));
            return SmartExecutor.Run(app =>
            {
                Active(app);
                try
                {
                    ObjectSnapTypes snaps = ObjectSnapTypes.Endpoints | ObjectSnapTypes.Midpoints | ObjectSnapTypes.Centers | ObjectSnapTypes.Intersections | ObjectSnapTypes.Nearest | ObjectSnapTypes.Perpendicular;
                    XYZ p = app.ActiveUIDocument.Selection.PickPoint(snaps, "Хаалганы шинэ байрлал дээр дарна уу — хананы дагуу шахагдана (Esc = цуцлах)");
                    double s = DoorHostMath.ParamOf(ctx.Host, PcUnits.Mm(p.X), PcUnits.Mm(p.Y));
                    return DoorTargetPick.Of(s - ctx.Door.CenterParamMm);
                }
                catch (Autodesk.Revit.Exceptions.OperationCanceledException) { return DoorTargetPick.Cancel(); }
                catch (Autodesk.Revit.Exceptions.InvalidOperationException) { return DoorTargetPick.Fail("Энэ харагдац дээр цэг сонгох боломжгүй — план харагдац руу шилжээд дахин оролдоно уу."); }
            }, ct, "prechange.door.pickpoint");
        }

        /* ============================== ХААЛГА: ЗУРАГЛАЛ (ghost + тодруулга) = */

        private readonly object _pumpGate = new object();
        private GhostScene _pendingScene;
        private bool _pendingClear;
        private bool _pumpActive;

        /// <summary>
        /// Ghost + тодруулгыг ШУУД шинэчилнэ: (1) зураглалыг Revit API-гүйгээр угсарч, сервер бүртгэгдсэн бол ТЭР ДОР орлуулна; (2) нэг ExternalEvent л (нэгтгэсэн, хамгийн
        /// сүүлийнх) серверийг бүртгэж, redraw хийнэ — хулгана/товчны дарааллаар олон event дараалалд орохгүй.
        /// </summary>
        public void ShowVisual(DoorVisualState visual)
        {
            GhostScene scene = GhostScenes.ForDoor(visual, PcUnits.ToInternalMm(1));
            if (scene.IsEmpty) { ClearVisual(); return; }
            PreChangeGhost.TrySwapScene(scene);
            lock (_pumpGate)
            {
                _pendingScene = scene;
                _pendingClear = false;
                if (_pumpActive) return;
                _pumpActive = true;
            }
            SchedulePump();
        }

        public void ClearVisual()
        {
            PreChangeGhost.TryHide();
            lock (_pumpGate)
            {
                _pendingScene = null;
                _pendingClear = true;
                if (_pumpActive) return;
                _pumpActive = true;
            }
            SchedulePump();
        }

        private void SchedulePump()
        {
            if (!SmartExecutor.IsReady)
            {
                // Revit унтарч байна — серверийг `PreChangeGhost.Shutdown` хаана.  Төлөвийг л цэвэрлэнэ.
                lock (_pumpGate) { _pumpActive = false; _pendingScene = null; _pendingClear = false; }
                return;
            }
            Task t = SmartExecutor.Run(app => { RunPump(app); return true; }, CancellationToken.None, "prechange.door.visual");
            t.ContinueWith(x =>
            {
                var _ = x.Exception;
                lock (_pumpGate) { _pumpActive = false; }
            }, TaskContinuationOptions.OnlyOnFaulted);
        }

        private void RunPump(UIApplication app)
        {
            try
            {
                while (true)
                {
                    GhostScene scene;
                    bool clear;
                    lock (_pumpGate)
                    {
                        scene = _pendingScene;
                        clear = _pendingClear;
                        _pendingScene = null;
                        _pendingClear = false;
                        if (scene == null && !clear) { _pumpActive = false; return; }
                    }
                    if (clear) PreChangeGhost.Clear(app);
                    else
                    {
                        Document doc = app.ActiveUIDocument != null ? app.ActiveUIDocument.Document : null;
                        // Идэвхтэй файл энэ цонхных биш бол ХАРУУЛАХГҮЙ (өөр файл дээр хуурамч ghost зурахгүй).
                        if (doc == null || !_key.Equals(RevitDocumentKeys.Of(doc))) PreChangeGhost.Clear(app);
                        else PreChangeGhost.ShowScene(app, doc, scene);
                    }
                }
            }
            catch (Exception)
            {
                lock (_pumpGate) { _pumpActive = false; _pendingScene = null; _pendingClear = false; }
                throw;
            }
        }

        /* ============================== ГАРЦ ================================ */

        public IReadOnlyList<ExitInfo> Exits()
        {
            return PreChangeExitStore.Load(_key);
        }

        public Task<ExitConfigResult> SetExitsFromSelectionAsync(CancellationToken ct)
        {
            return SmartExecutor.Run(app =>
            {
                Document doc = Active(app);
                var exits = new List<ExitInfo>();
                foreach (ElementId id in app.ActiveUIDocument.Selection.GetElementIds())
                {
                    var fi = doc.GetElement(id) as FamilyInstance;
                    if (fi == null || fi.Category == null || fi.Category.Id.Value != (long)BuiltInCategory.OST_Doors) continue;
                    string lvl = null;
                    try { Level lv = doc.GetElement(fi.LevelId) as Level; lvl = lv != null ? lv.Name : null; } catch (Exception) { }
                    exits.Add(new ExitInfo { Id = fi.Id.Value, Uid = fi.UniqueId, Name = fi.Symbol != null ? fi.Symbol.FamilyName + " : " + fi.Symbol.Name : fi.Name, Level = lvl });
                }
                if (exits.Count == 0)
                    return new ExitConfigResult { Ok = false, Message = "Revit-д гарц болгох ХААЛГАА сонгоод дахин дарна уу (хаалганы нэрээр таамаглахгүй)." };
                if (exits.Count > PreChangeExitStore.MaxExits)
                    return new ExitConfigResult { Ok = false, Message = "Гарц " + exits.Count + " байна — хамгийн ихдээ " + PreChangeExitStore.MaxExits + " хаалга." };
                string err;
                if (!PreChangeExitStore.Save(_key, exits, out err))
                    return new ExitConfigResult { Ok = false, Message = "Гарцыг хадгалж чадсангүй: " + SmartLog.Scrub(err) };
                return new ExitConfigResult { Ok = true, Exits = exits, Message = exits.Count + " хаалгыг гарц болгон хадгаллаа (зөвхөн энэ компьютерт)." };
            }, ct, "prechange.exits");
        }

        public Task<ExitConfigResult> ClearExitsAsync(CancellationToken ct)
        {
            string err;
            bool ok = PreChangeExitStore.Save(_key, new List<ExitInfo>(), out err);
            return Task.FromResult(new ExitConfigResult
            {
                Ok = ok,
                Message = ok ? "Гарцын тохиргоо цэвэрлэгдлээ." : "Гарцыг цэвэрлэж чадсангүй: " + SmartLog.Scrub(err),
            });
        }
    }
}
