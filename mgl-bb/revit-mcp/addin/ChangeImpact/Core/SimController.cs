using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;

namespace RevitMcpAddin.ChangeImpact.Core
{
    /// <summary>
    /// Simulation цонхны ТӨЛӨВИЙН МАШИН — Revit/WPF-гүй, тестлэгдэнэ.  Камер, хулганаар барьж чирэх, нудж зөөх, урьдчилсан мөргөлдөөн, Revit-ийн эцсийн дүн, тайлан (шийдвэр) бүгд ЭНД;
    /// цонх зөвхөн хулганы пикселийг дамжуулж, тайланг ЗУРНА.
    ///
    ///   Offset өөрчлөгдөх бүрд `Generation` өснө.  Revit-ийн эцсийн дүн ЗӨВХӨН ЯГ ОДООГИЙН generation + offset-д таарвал л хүлээн авагдана (хуучин дүн шинийг дарахгүй).
    ///   Чирж байх үед ЮУ Ч Revit руу очихгүй — зөвхөн Core-ийн ~мс-ийн урьдчилсан тооцоо.
    /// </summary>
    public sealed class SimController
    {
        public SimScene Scene { get; private set; }
        public SimCamera Camera { get; private set; }
        public SimVec Offset { get; private set; }
        /// <summary>Хөдөлгөөнгүй (offset = 0) үеийн давхцал — шинэ мөргөлдөөнөөс ялгана.  null = бэлэн биш.</summary>
        public SimConflictResult Baseline { get; private set; }
        public SimConflictResult Live { get; private set; }
        public SimExactResult Exact { get; private set; }
        public SimReport Report { get; private set; }
        public SimPhase Phase { get; private set; }
        public int Generation { get; private set; }
        public SimDragMode Mode { get; set; }
        public double SnapMm { get; set; } = 10;
        public SimConflictOptions Options { get; private set; }
        public double LastLiveMs { get; private set; }
        public bool IsReady { get { return Scene != null && Baseline != null; } }
        public bool Dragging { get { return _drag != null; } }
        /// <summary>Хөдөлгөөн ШУГАМЫН дагуу түгжигдсэн (хананд суурилсан хаалга/цонх).</summary>
        public bool LineLocked { get { return Scene != null && Scene.LineConstraintXY != null; } }

        private SimDragSession _drag;
        private SimVec _dragStartOffset;
        private double _w = 1000, _h = 700;

        public SimController()
        {
            Camera = new SimCamera();
            Options = new SimConflictOptions();
        }

        /* ============================== АЧААЛАЛТ ============================ */

        /// <summary>Сцен тавина (камерыг бүхлээр нь харуулна).  Baseline-г `SetBaseline`-аар (арын thread-д тооцоод) өгнө — тэр болтол чирэх боломжгүй.</summary>
        public void Load(SimScene scene, double viewW, double viewH)
        {
            Scene = scene;
            Offset = new SimVec(0, 0, 0);
            Baseline = null; Live = null; Exact = null; _drag = null;
            Phase = SimPhase.Idle;
            Generation++;
            _w = Math.Max(1, viewW); _h = Math.Max(1, viewH);
            Camera = new SimCamera();
            Camera.SetIsoView();
            if (scene != null) Camera.Fit(FocusBox(scene), _w, _h);
            Rebuild();
        }

        public void SetViewport(double w, double h)
        {
            _w = Math.Max(1, w); _h = Math.Max(1, h);
        }

        /// <summary>Арын thread-д тооцсон хөдөлгөөнгүй үеийн давхцал.  Дараа нь бүх урьдчилсан дүн үүнтэй харьцуулагдана.</summary>
        public void SetBaseline(SimConflictResult baseline)
        {
            Baseline = baseline;
            Rebuild();
        }

        /// <summary>Хөдөлгөөнгүй үеийн давхцлыг ЭНД (синхрон) тооцно — тест, жижиг сцен.</summary>
        public void ComputeBaselineSync()
        {
            if (Scene == null) return;
            SetBaseline(SimConflicts.Evaluate(Scene, new SimVec(0, 0, 0), Options));
        }

        /// <summary>Камерын анхны хүрээ: зөөгдөх элемент + ойр орчин (хэт том орчныг бүтнээр нь биш).</summary>
        public static SimBox FocusBox(SimScene scene)
        {
            SimBox moving = scene.MovingBounds;
            if (moving.IsEmpty) return scene.AllBounds;
            SimVec sz = moving.Size;
            // Хэвтээ хэмжээгээр (өндрөөр БИШ): 17.8 м өндөр баганад өмнө нь 21 м зай нэмж бүх барилгыг харуулж, багана өөрөө харагдахгүй байв (Revit 2027-д хэмжсэн).
            double pad = Math.Max(1800, Math.Min(7000, Math.Max(sz.X, sz.Y) * 1.5));
            SimBox b = moving.Expanded(pad);
            double padZ = Math.Min(pad, 1500);
            b.MinZ = moving.MinZ - padZ; b.MaxZ = moving.MaxZ + padZ;
            return b;
        }

        /* ============================== ХУЛГАНААР ЧИРЭХ ===================== */

        /// <summary>Хулгана (px,py)-д зөөгдөх элементийг барина.  false = элемент цохигдоогүй (дуудагч орбит эхлүүлнэ).</summary>
        public bool BeginDrag(double px, double py, double w, double h)
        {
            if (Scene == null || !IsReady) return false;
            SetViewport(w, h);
            SimRay ray = Camera.Ray(px, py, _w, _h);
            SimPick.Result hit = SimPick.Moving(Scene, Offset, ray);
            if (hit == null) return false;

            SimDragMode mode = Mode;
            double[] line = LineLocked ? Scene.LineConstraintXY : null;
            SimDragSession d = SimDragSession.Begin(Camera, hit.Point, Offset, mode, line, SnapMm);
            if (d == null) return false;          // босоо чирэлт дээрээс харахад
            _drag = d;
            _dragStartOffset = Offset;
            Phase = SimPhase.Dragging;
            Exact = null;                          // чирж эхлэхэд хуучин эцсийн дүн хүчингүй
            Rebuild();
            return true;
        }

        /// <summary>Хулгана хөдөлнө.  true = offset өөрчлөгдсөн.</summary>
        public bool DragTo(double px, double py, double w, double h)
        {
            if (_drag == null) return false;
            SetViewport(w, h);
            SimVec before = Offset;
            if (!_drag.Update(Camera.Ray(px, py, _w, _h))) return false;
            if (Same(_drag.Offset, before)) return false;
            ApplyOffset(_drag.Offset);
            return true;
        }

        /// <summary>Хулгана тавигдлаа.  true = зөөлт анхны (барьсан) байрлалаас өөр — Revit-ээр шалгах хэрэгтэй.</summary>
        public bool EndDrag()
        {
            if (_drag == null) return false;
            _drag = null;
            bool changed = !Same(Offset, _dragStartOffset);
            Phase = changed ? SimPhase.Analyzing : SimPhase.Idle;
            if (!changed) Exact = null;
            Rebuild();
            return changed && !IsZero(Offset);
        }

        /// <summary>Чирэлтийг цуцална (Esc) — барьсан үеийн байрлал руу буцаана.</summary>
        public void CancelDrag()
        {
            if (_drag == null) return;
            _drag = null;
            ApplyOffset(_dragStartOffset);
            Phase = SimPhase.Idle;
            Rebuild();
        }

        /// <summary>Сумаар нудах / «Анхнаас нь» (offset-ийг шууд тавина).  true = өөрчлөгдсөн.</summary>
        public bool SetOffset(SimVec offset)
        {
            if (Scene == null) return false;
            SimVec snapped = SimDragSession.Snap(offset, 0);
            if (Same(snapped, Offset)) return false;
            ApplyOffset(snapped);
            Phase = IsZero(Offset) ? SimPhase.Idle : SimPhase.Analyzing;
            Rebuild();
            return !IsZero(Offset);
        }

        public bool Nudge(SimVec delta)
        {
            // Хананд суурилсан элемент ЗӨВХӨН шугамын дагуу.
            if (LineLocked)
            {
                double[] l = Scene.LineConstraintXY;
                double len = Math.Sqrt(l[0] * l[0] + l[1] * l[1]);
                if (len > 1e-9)
                {
                    double along = (delta.X * l[0] + delta.Y * l[1]) / len;
                    delta = new SimVec(l[0] / len * along, l[1] / len * along, 0);
                }
            }
            return SetOffset(Offset + delta);
        }

        private void ApplyOffset(SimVec o)
        {
            Offset = o;
            Generation++;
            Exact = null;
            Rebuild();
        }

        /* ============================== REVIT-ИЙН ЭЦСИЙН ДҮН ================= */

        /// <summary>Revit-ийн шинжилгээ эхлэх мөчийн generation (дуудагч `AnalyzeAsync`-д дамжуулна).  Phase = Analyzing.</summary>
        public int BeginAnalysis()
        {
            Phase = SimPhase.Analyzing;
            Rebuild();
            return Generation;
        }

        /// <summary>Эцсийн дүнг хүлээн авна — ЗӨВХӨН энэ generation + offset-д таарвал.  false = хуучирсан (хаягдсан).</summary>
        public bool AcceptExact(SimExactResult e)
        {
            if (e == null || e.Generation != Generation || !e.Matches(Offset) || Dragging) return false;
            Exact = e;
            Phase = SimPhase.Idle;
            Rebuild();
            return true;
        }

        /// <summary>Шинжилгээ унасан/цуцлагдсан (generation хэвээр) — «шалгаж байна» төлөвөөс гарна.</summary>
        public void AnalysisAborted(int generation)
        {
            if (generation != Generation || Phase != SimPhase.Analyzing) return;
            Phase = SimPhase.Idle;
            Rebuild();
        }

        public void Reset()
        {
            if (Scene == null) return;
            _drag = null;
            ApplyOffset(new SimVec(0, 0, 0));
            Phase = SimPhase.Idle;
            Rebuild();
        }

        /* ============================== ТАЙЛАН ============================== */

        private void Rebuild()
        {
            if (Scene == null) { Report = null; return; }
            var sw = Stopwatch.StartNew();
            Live = IsReady ? SimConflicts.Evaluate(Scene, Offset, Options, Baseline) : new SimConflictResult { Offset = Offset };
            LastLiveMs = sw.Elapsed.TotalMilliseconds;
            Report = SimNarrative.Build(Scene, Offset, Live, Exact, Phase);
            if (!IsZero(Offset) && Exact == null && OutsideLoadedContext)
                Report.Coverage.Insert(0, "⚠ Элемент ачаалсан орчноос гарлаа — энд урьдчилсан мөргөлдөөнийг шалгаж чадахгүй (Revit-ийн шалгалт орчныг дахин уншина).");
        }

        /// <summary>Дэлгэц дээр улаанаар тодруулах хайрцгууд (local мм): тайлангийн мөр бүрийн хүрээ, үгүй бол урьдчилсан давхцлын хүрээ.</summary>
        public IList<double[]> HitBoxes()
        {
            var boxes = new List<double[]>();
            if (Report == null) return boxes;
            var covered = new HashSet<string>(StringComparer.Ordinal);
            foreach (SimLine l in Report.Lines)
            {
                if (l.Severity == SimSeverity.Info) continue;
                if (l.BoxMm != null) { boxes.Add(l.BoxMm); foreach (string k in l.Keys) covered.Add(k); }
            }
            if (Live != null)
                foreach (SimHit h in Live.Hits)
                {
                    if (!h.IsNew || h.Reactive || covered.Contains(h.Key) || !Report.HighlightKeys.Contains(h.Key)) continue;
                    SimBox b = h.OverlapBox.IsEmpty ? h.Region : h.OverlapBox;
                    if (!b.IsEmpty) boxes.Add(b.ToArray());
                }
            return boxes;
        }

        public SimBox MovedBounds { get { return Scene == null ? SimBox.Empty() : Scene.MovingBounds.Translated(Offset); } }

        /// <summary>Элемент уншсан орчноос гарсан уу (түр шалгалт тэнд бүрэн биш).</summary>
        public bool OutsideLoadedContext
        {
            get
            {
                if (Scene == null || Scene.ContextBounds == null) return false;
                var cb = new SimBox { MinX = Scene.ContextBounds[0], MinY = Scene.ContextBounds[1], MinZ = Scene.ContextBounds[2], MaxX = Scene.ContextBounds[3], MaxY = Scene.ContextBounds[4], MaxZ = Scene.ContextBounds[5] };
                return !cb.Contains(MovedBounds, 0);
            }
        }

        private static bool Same(SimVec a, SimVec b) { return Math.Abs(a.X - b.X) < 1e-9 && Math.Abs(a.Y - b.Y) < 1e-9 && Math.Abs(a.Z - b.Z) < 1e-9; }
        private static bool IsZero(SimVec a) { return a.LengthSq < 0.25; }
    }
}
