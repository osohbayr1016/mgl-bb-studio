using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Events;
using Autodesk.Revit.UI;
using Autodesk.Revit.UI.Events;
using RevitMcpAddin.ChangeImpact.Core;
using RevitMcpAddin.ChangeImpact.Ui;
using RevitMcpAddin.ClashCheck;
using RevitMcpAddin.Smart;
using RevitMcpAddin.Smart.Core;

namespace RevitMcpAddin.ChangeImpact
{
    /// <summary>
    /// «3D модель дотор ШУУД зөөхөд шалгах» (эзэн 2026-10-06).  Архитектор Revit-ийн өөрийн Move / чирэлт / сумтай товчоор элементийг зөөмөгц:
    ///   1. `SelectionChanged` — сонгосон (≤40) элементийн байрлалыг санана (хямд, зөвхөн уншина);
    ///   2. `DocumentChanged` — гүйлгээ commit болоход сонгосон элементүүд ЦЭВЭР шилжсэн эсэхийг (`SimNativeMove`) тулгана; MGL-ийн өөрийн гүйлгээ, sandbox, Undo/Redo-г алгасна;
    ///   3. 0.7 с тайван болсны ДАРАА (дараалсан нудалт нэг шинжилгээ) `PostMoveAnalyzer` → мөргөлдөөн / дагаж өөрчлөгдөх зүйл байвал жижиг цонх
    ///      (`PostMoveWindow`, фокус авахгүй) «Зөвшөөрөх (мэдэгдэх) / Буцаах» гэж асууна; Revit-ийн зураг дээр улаан хайрцаг.
    /// ⚠️ `DocumentChanged` дотор ЗӨВХӨН байрлал уншина (гүйлгээ, диск, сүлжээ ҮГҮЙ).  Шинжилгээ `SmartExecutor`-оор (ExternalEvent) — Revit-ийн ажлыг саатуулахгүй.
    /// </summary>
    internal static class PostMoveWatch
    {
        internal const int QuietMs = 700;

        private static readonly object Gate = new object();
        private static bool _wired;
        private static volatile bool _enabled = true;
        private static DocumentKey _selDoc;
        private static Dictionary<long, double[]> _selLocs = new Dictionary<long, double[]>();
        private static Pending _pending;
        private static Timer _timer;

        private sealed class Pending
        {
            public DocumentKey Key;
            public Dictionary<long, double[]> Origin = new Dictionary<long, double[]>();
            public Dictionary<long, double[]> Now = new Dictionary<long, double[]>();
            public HashSet<long> Modified = new HashSet<long>();
            public int Seq;
        }

        /// <summary>Энэ Revit-ийн сессэд шууд зөөлтийг шалгах эсэх (цонхны чагтаар унтраана).</summary>
        internal static bool Enabled
        {
            get { return _enabled; }
            set { _enabled = value; if (!value) lock (Gate) { _pending = null; } }
        }

        internal static void Init(UIControlledApplication app)
        {
            if (_wired || app == null) return;
            _wired = true;
            app.SelectionChanged += OnSelection;
            app.ControlledApplication.DocumentChanged += OnChanged;
            _timer = new Timer(_ => Guard(Fire), null, Timeout.Infinite, Timeout.Infinite);
        }

        private static void Guard(Action a)
        {
            try { a(); }
            catch (Exception ex) { SmartLog.Error("native", "watch", ex); }
        }

        /* ============================== СОНГОЛТ ============================= */

        private static void OnSelection(object sender, SelectionChangedEventArgs e)
        {
            if (!_enabled) return;
            Guard(() =>
            {
                Document doc = e.GetDocument();
                if (doc == null || doc.IsFamilyDocument || doc.IsLinked) return;
                ICollection<ElementId> sel = e.GetSelectedElements();
                var locs = new Dictionary<long, double[]>();
                if (sel != null && sel.Count > 0 && sel.Count <= SimNativeMove.MaxElements)
                    foreach (ElementId id in sel)
                    {
                        Element el = doc.GetElement(id);
                        if (el == null || el is ElementType || !SimKinds.IsModelBody(el)) continue;
                        double[] loc = SimExactAnalyzer.LocOrBox(el);
                        if (loc != null) locs[id.Value] = loc;
                    }
                lock (Gate)
                {
                    _selDoc = RevitDocumentKeys.Of(doc);
                    _selLocs = locs;
                }
            });
        }

        /* ============================== ЗӨӨЛТ ИЛРҮҮЛЭХ ====================== */

        private static void OnChanged(object sender, DocumentChangedEventArgs e)
        {
            if (!_enabled) return;
            if (ImpactSimulationScope.IsActive || ImpactSimulationScope.IsDeferring) return;     // MGL-ийн sandbox / Apply
            Guard(() =>
            {
                if (e.Operation != UndoOperation.TransactionCommitted) return;                 // Undo/Redo — хэрэглэгч аль хэдийн шийдсэн
                ICollection<string> names = e.GetTransactionNames();
                if (names != null && names.Any(n => n != null && n.StartsWith("MGL", StringComparison.OrdinalIgnoreCase))) return;
                Document doc = e.GetDocument();
                if (doc == null || doc.IsFamilyDocument) return;
                DocumentKey key = RevitDocumentKeys.Of(doc);
                ICollection<ElementId> modified = e.GetModifiedElementIds();
                if (modified == null || modified.Count == 0) return;

                Dictionary<long, double[]> before;
                Pending p;
                lock (Gate)
                {
                    p = _pending != null && _pending.Key.Equals(key) ? _pending : null;
                    if (_selDoc == null || !_selDoc.Equals(key)) before = p != null ? new Dictionary<long, double[]>(p.Now) : null;
                    else
                    {
                        before = new Dictionary<long, double[]>(_selLocs);
                        if (p != null) foreach (KeyValuePair<long, double[]> kv in p.Now) before[kv.Key] = kv.Value;
                    }
                }
                if (before == null || before.Count == 0) return;

                var touched = new HashSet<long>(modified.Select(i => i.Value));
                var after = new Dictionary<long, double[]>();
                foreach (long id in before.Keys.Where(touched.Contains))
                {
                    Element el = doc.GetElement(new ElementId(id));
                    double[] loc = el != null && el.IsValidObject ? SimExactAnalyzer.LocOrBox(el) : null;
                    if (loc != null) after[id] = loc;
                }
                if (after.Count == 0) return;
                SimVec step; List<long> moved;
                if (!SimNativeMove.TryTranslation(before, after, out step, out moved)) return;

                lock (Gate)
                {
                    if (_pending == null || !_pending.Key.Equals(key) || !moved.All(m => _pending.Origin.ContainsKey(m)))
                    {
                        _pending = new Pending { Key = key };
                        foreach (long id in moved) _pending.Origin[id] = before[id];
                    }
                    foreach (long id in moved) { _pending.Now[id] = after[id]; _selLocs[id] = after[id]; }
                    foreach (long id in touched) _pending.Modified.Add(id);
                    _pending.Seq++;
                    _timer.Change(QuietMs, Timeout.Infinite);
                }
            });
        }

        /* ============================== ШИНЖИЛГЭЭ =========================== */

        private static void Fire()
        {
            Pending p;
            lock (Gate) p = _pending;
            if (p == null || !_enabled || !SmartExecutor.IsReady) return;
            SimVec total; List<long> moved;
            int seq;
            List<long> modified;
            lock (Gate)
            {
                seq = p.Seq;
                modified = p.Modified.ToList();
                if (!SimNativeMove.TryTranslation(p.Origin, p.Now, out total, out moved))
                {
                    // Буцааж анхны байрлалд нь тавьсан (эсвэл цэвэр зөөлт биш болсон) — цонх/сүүдрийг арилгана.
                    if (ReferenceEquals(_pending, p)) _pending = null;
                    moved = null;
                }
            }
            if (moved == null) { PostMoveWindow.CloseIfFor(p.Key); return; }

            SmartExecutor.Run(app =>
            {
                lock (Gate) { if (!ReferenceEquals(_pending, p) || p.Seq != seq) return false; }       // дахин хөдөлсөн — дараагийн Fire
                List<LinkSlot> slots;
                NativeMoveResult r = PostMoveAnalyzer.Run(app, p.Key, moved, total, modified, out slots);
                if (r == null) return false;
                if (!SimNativeMove.WorthShowing(r.Report))
                {
                    // Хэнийг ч хөндөөгүй (шинэ мөргөлдөөн, дагах зүйлгүй) — цонх гаргахгүй, өмнөхийг хаана.
                    PostMoveWindow.CloseIfFor(p.Key);
                    try { PreChangeGhost.Clear(app); } catch (Exception) { }
                    return false;
                }
                try { if (r.Ghost != null && !r.Ghost.IsEmpty) PreChangeGhost.ShowScene(app, app.ActiveUIDocument.Document, r.Ghost); } catch (Exception) { }
                PostMoveWindow.ShowOrUpdate(new PostMoveSession(r, slots));
                return true;
            }, CancellationToken.None, "native.check").ContinueWith(t => { var _ = t.Exception; }, TaskContinuationOptions.OnlyOnFaulted);
        }

        /// <summary>Шийдвэр гарсан (зөвшөөрсөн / буцаасан / хаасан) — тэр зөөлтийн дараалал дууссан.</summary>
        internal static void Settle(DocumentKey key)
        {
            lock (Gate) { if (_pending != null && _pending.Key.Equals(key)) _pending = null; }
        }

        /// <summary>Буцаасны дараа санасан байрлалыг шинэчилнэ (дараагийн зөөлтийг зөв хэмжихэд).</summary>
        internal static void Remember(long id, double[] loc)
        {
            if (loc == null) return;
            lock (Gate) { _selLocs[id] = loc; }
        }
    }

    /// <summary>`PostMoveWindow`-ийн Revit-тэй харилцах давхарга (зохиогч унших, буцаах, элемент харуулах, сүүдэр арилгах).</summary>
    internal sealed class PostMoveSession : INativeMoveSession
    {
        private readonly NativeMoveResult _r;
        private readonly List<LinkSlot> _slots;

        internal PostMoveSession(NativeMoveResult r, List<LinkSlot> slots) { _r = r; _slots = slots ?? new List<LinkSlot>(); }

        public NativeMoveResult Result { get { return _r; } }
        public void Settle() { PostMoveWatch.Settle(_r.Key); }
        public void SetWatchEnabled(bool enabled) { PostMoveWatch.Enabled = enabled; }

        /// <summary>«Буцаах» — элементүүдийг яг −шилжилтээр буцааж зөөнө (нэг Undo «MGL — Зөөлтийг буцаах»).  Revit-ийн Ctrl+Z-тэй адил үр дүн.</summary>
        public Task<string> RevertAsync()
        {
            NativeMoveResult r = Result;
            return SmartExecutor.Run(app =>
            {
                UIDocument ui = app.ActiveUIDocument;
                Document doc = ui != null ? ui.Document : null;
                if (doc == null || !r.Key.Equals(RevitDocumentKeys.Of(doc))) return "Идэвхтэй файл солигдсон — тэр файл руугаа шилжээд Ctrl+Z ашиглана уу.";
                var ids = r.Ids.Select(i => new ElementId(i)).Where(i => doc.GetElement(i) != null).ToList();
                if (ids.Count == 0) return "Элемент олдсонгүй.";
                return PostMoveRevert.Run(doc, ids, r.DeltaMm);
            }, CancellationToken.None, "native.revert");
        }

        public Task ShowElementAsync(long id, int slot)
        {
            NativeMoveResult r = Result;
            List<LinkSlot> slots = _slots;
            return SmartExecutor.Run(app =>
            {
                UIDocument ui = app.ActiveUIDocument;
                if (ui == null || !r.Key.Equals(RevitDocumentKeys.Of(ui.Document))) return false;
                long target = id;
                if (slot >= 0) { if (slot >= slots.Count) return false; target = slots[slot].InstanceId; }
                var set = new List<ElementId> { new ElementId(target) };
                try { ui.Selection.SetElementIds(set); } catch (Exception) { }
                try { ui.ShowElements(set); } catch (Exception) { }
                return true;
            }, CancellationToken.None, "native.show");
        }

        public void ClearGhost()
        {
            PreChangeGhost.TryHide();
            if (!SmartExecutor.IsReady) return;
            SmartExecutor.Run(app => { PreChangeGhost.Clear(app); return true; }, CancellationToken.None, "native.ghost.clear")
                .ContinueWith(t => { var _ = t.Exception; }, TaskContinuationOptions.OnlyOnFaulted);
        }
    }
}
