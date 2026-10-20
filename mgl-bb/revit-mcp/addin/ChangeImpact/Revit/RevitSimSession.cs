using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;
using RevitMcpAddin.ChangeImpact.Core;
using RevitMcpAddin.Smart;
using RevitMcpAddin.Smart.Core;

namespace RevitMcpAddin.ChangeImpact
{
    /// <summary>
    /// `ISimSession`-ий Revit-тэй хэрэгжүүлэлт.  Цонх (модальгүй) Revit API-д ЗӨВХӨН `SmartExecutor`-оор хүрнэ; session нь `Document`-ийг ХАДГАЛАХГҮЙ (түлхүүр + тоолуурын барих хэрэгсэл).
    /// Энэ нь «Өөрчлөхөөс өмнө» хэрэгслийн ШИНЭ (ямар ч элемент, хулганаар чирэх) сессийн давхарга: хуучин ханын/хаалганы `RevitPreChangeSession`-ыг ХӨНДӨӨГҮЙ.
    /// </summary>
    internal sealed class RevitSimSession : ISimSession
    {
        private readonly DocumentKey _key;
        private readonly ChangeStamp _changes;
        private IList<long> _ids;
        private readonly double _unitPerMm;
        private readonly object _gate = new object();
        private SimLoaded _loaded;
        private bool _ack;

        public string DocumentTitle { get { return _key.Display; } }

        internal RevitSimSession(Document doc, IList<long> selectedIds)
        {
            _key = RevitDocumentKeys.Of(doc);
            _changes = ModelChangeCounter.HandleFor(doc);
            _ids = selectedIds.ToList();
            _unitPerMm = PcUnits.ToInternalMm(1.0);
        }

        internal DocumentKey Key { get { return _key; } }

        private Document Active(UIApplication app)
        {
            UIDocument ui = app.ActiveUIDocument;
            Document doc = ui != null ? ui.Document : null;
            if (doc == null) throw new InvalidOperationException("Идэвхтэй баримт алга.");
            if (!_key.Equals(RevitDocumentKeys.Of(doc)))
                throw new InvalidOperationException("Идэвхтэй файл «" + doc.Title + "» — энэ цонх «" + _key.Display + "» файлынх. Тэр файл руугаа шилжинэ үү.");
            return doc;
        }

        private SimLoaded Loaded()
        {
            lock (_gate) return _loaded;
        }

        public bool OwnershipAcknowledged
        {
            get { lock (_gate) return _ack || _loaded == null || _loaded.Check == null || !_loaded.Check.NeedsAck; }
        }

        public void AcknowledgeOwnership()
        {
            lock (_gate) _ack = true;
        }

        /* ============================== АЧААЛАЛТ ============================ */

        public async Task<SimLoadOutcome> LoadAsync(IProgress<SimLoadProgress> progress, CancellationToken ct)
        {
            bool ack;
            lock (_gate) ack = _ack;
            IList<long> ids;
            lock (_gate) ids = _ids.ToList();
            var job = new SimSceneLoader(_key, ids, ack, (done, total) =>
            {
                if (progress != null) progress.Report(new SimLoadProgress { Done = done, Total = total });
            });
            await SmartExecutor.RunSteps(job, ct);
            SimLoaded r = job.Result;
            if (r == null) return new SimLoadOutcome { Ok = false, Problem = "Сцен ачаалагдсангүй." };
            if (r.Scene == null || !string.IsNullOrEmpty(r.Problem))
                return new SimLoadOutcome { Ok = false, Problem = r.Problem ?? "Сцен ачаалагдсангүй.", Refused = r.Refused, DocumentTitle = _key.Display };
            lock (_gate) _loaded = r;
            return new SimLoadOutcome
            {
                Ok = true, Scene = r.Scene, LoadMs = r.LoadMs, DocumentTitle = _key.Display, Stamp = r.Stamp,
                NeedsOwnershipAck = r.Check != null && r.Check.NeedsAck && !ack,
            };
        }

        /* ============================== ШИНЖИЛГЭЭ / ЗӨӨЛТ ==================== */

        public Task<SimExactResult> AnalyzeAsync(SimVec offsetMm, int generation, CancellationToken ct)
        {
            SimLoaded loaded = Loaded();
            return SmartExecutor.Run(app =>
            {
                Active(app);
                return SimExactAnalyzer.Run(app, _key, loaded, offsetMm, generation);
            }, ct, "sim.exact");
        }

        public async Task<ApplyOutcome> ApplyAsync(SimVec offsetMm, SimExactResult preview, CancellationToken ct)
        {
            SimLoaded loaded = Loaded();
            ApplyOutcome outcome = await SmartExecutor.Run(app => SimApply.Run(app, _key, loaded, preview, offsetMm), ct, "sim.apply");
            if (outcome != null && (outcome.Moved || outcome.ModelMayBeModified))
            {
                try { ClearGhost(); } catch (Exception) { }
            }
            return outcome;
        }

        public bool ModelChangedSince(string stamp)
        {
            try
            {
                string cur = _changes != null ? _changes.Current : null;
                return cur == null || string.IsNullOrEmpty(stamp) || !string.Equals(cur, stamp, StringComparison.Ordinal);
            }
            catch (Exception) { return true; }
        }

        public double InternalUnitsPerMm { get { return _unitPerMm; } }

        public void SetSelection(IList<long> ids)
        {
            if (ids == null || ids.Count == 0) return;
            lock (_gate) { _ids = ids.ToList(); _loaded = null; }
        }

        /// <summary>
        /// Revit-д зөөх элемент сонгуулна.  Revit-д аль хэдийн сонгосон элемент (өөр) байвал ТЭДГЭЭРИЙГ авна; үгүй бол зураг дээр дарна (PickObject, Esc = цуцлах).
        /// ⚠️ Хулганы глобал hook, Win32 БАЙХГҮЙ — Revit-ийн албан ёсны PickObject.
        /// </summary>
        public Task<IList<long>> PickAsync(CancellationToken ct)
        {
            return SmartExecutor.Run(app =>
            {
                Document doc = Active(app);
                UIDocument ui = app.ActiveUIDocument;
                IList<long> result = new List<long>();
                ICollection<ElementId> sel = ui.Selection.GetElementIds();
                List<long> current = _ids.ToList();
                if (sel.Count > 0 && !sel.Select(i => i.Value).OrderBy(x => x).SequenceEqual(current.OrderBy(x => x)))
                    return (IList<long>)sel.Select(i => i.Value).Take(SimElementRules.MaxSelected + 1).ToList();
                try
                {
                    Reference r = ui.Selection.PickObject(Autodesk.Revit.UI.Selection.ObjectType.Element, new BodyFilter(), "Зөөх элементээ сонгоно уу (Esc = цуцлах)");
                    if (r != null) result.Add(r.ElementId.Value);
                }
                catch (Autodesk.Revit.Exceptions.OperationCanceledException) { }
                return result;
            }, ct, "sim.pick");
        }

        /// <summary>Зөөж болох 3D элементийг л сонгуулна (тайлбар, түвшин, тор, өрөө, линк instance биш).</summary>
        private sealed class BodyFilter : Autodesk.Revit.UI.Selection.ISelectionFilter
        {
            public bool AllowElement(Element e) { return !(e is RevitLinkInstance) && SimKinds.IsModelBody(e); }
            public bool AllowReference(Reference reference, XYZ position) { return false; }
        }

        public Task ShowElementAsync(long id, int slot, CancellationToken ct)
        {
            SimLoaded loaded = Loaded();
            return SmartExecutor.Run(app =>
            {
                Document doc = Active(app);
                long target = id;
                // Линкийн элементийг ШУУД сонгох боломжгүй — линкийн instance-ийг харуулна.
                if (slot >= 0)
                {
                    if (loaded == null || slot >= loaded.Slots.Count) return false;
                    target = loaded.Slots[slot].InstanceId;
                }
                Element e = doc.GetElement(new ElementId(target));
                if (e == null || !e.IsValidObject) return false;
                var set = new List<ElementId> { e.Id };
                try { app.ActiveUIDocument.Selection.SetElementIds(set); } catch (Exception) { }
                try { app.ActiveUIDocument.ShowElements(set); } catch (Exception) { /* энэ харагдац дээр харуулах боломжгүй — сонголт хэвээр */ }
                return true;
            }, ct, "sim.show");
        }

        /* ============================== ЗУРАГ ДЭЭРХ СҮҮДЭР =================== */

        private readonly object _pumpGate = new object();
        private GhostScene _pendingScene;
        private bool _pendingClear;
        private bool _pumpActive;

        /// <summary>
        /// Сүүдрийг ШУУД шинэчилнэ: сервер бүртгэгдсэн бол зураглалыг ТЭР ДОР орлуулна; нэг ExternalEvent л (нэгтгэсэн, хамгийн сүүлийнх) серверийг бүртгэж, redraw хийнэ.
        /// Хулганаар чирэх үед ЭНЭ ДУУДАГДАХГҮЙ — зөвхөн Revit-ийн шинжилгээ дууссаны дараа.
        /// </summary>
        public void ShowGhost(GhostScene scene)
        {
            if (scene == null || scene.IsEmpty) { ClearGhost(); return; }
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

        public void ClearGhost()
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
                lock (_pumpGate) { _pumpActive = false; _pendingScene = null; _pendingClear = false; }
                return;
            }
            Task t = SmartExecutor.Run(app => { RunPump(app); return true; }, CancellationToken.None, "sim.ghost");
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
    }
}
