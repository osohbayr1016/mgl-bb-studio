using System;
using System.Collections.Generic;
using Autodesk.Revit.ApplicationServices;
using Autodesk.Revit.DB;
using Autodesk.Revit.DB.DirectContext3D;
using Autodesk.Revit.DB.Events;
using Autodesk.Revit.DB.ExternalService;
using Autodesk.Revit.UI;
using RevitMcpAddin.ChangeImpact.Core;
using RevitMcpAddin.Smart;
using RevitMcpAddin.Smart.Core;

namespace RevitMcpAddin.ChangeImpact
{
    /// <summary>
    /// Хана, хаалганы ШИНЭ байрлалын «сүүдэр» (ghost) + нөлөөллийн тодруулга — Revit-ийн DirectContext3D (`IDirectContext3DServer`).
    ///
    ///   ⚠️ ЗАГВАРТ ЮУ Ч БИЧИХГҮЙ: DirectShape, транзакц, Undo, түр элемент, selection, параметр ХЭЗЭЭ Ч үүсгэхгүй.  Зөвхөн дэлгэцийн зураглал.
    ///   Өнгө = шийдвэр (ногоон / шар / улаан / саарал).  Өнгө ганцаараа биш — цонхны тэмдэг + үгтэй хамт.
    ///
    /// ЦЭВЭРЛЭЛТ (бүгд `Clear` / `Shutdown` дуудна, идемпотент):
    ///   • цонх хаагдах, шинжилгээ цуцлагдах, сонголт өөрчлөгдөх, Apply амжилттай болох (цонх дуудна);
    ///   • энд өөрөө: баримт хаагдах (`DocumentClosing`), загварт БОДИТ өөрчлөлт орох (`DocumentChanged` — sandbox/хойшлуулсан commit-ийг тооцохгүй);
    ///   • Revit унтрах (`SmartHost.Shutdown`).
    ///
    /// ⚠️ ХЯЗГААР (баталгаажаагүй, амьд Revit-ийн QA хэрэгтэй): DirectContext3D нь 3D харагдац дээр найдвартай; план/зүсэлт/фасад дээр зурагдах эсэх нь Revit-ийн хувилбараас
    /// хамаарна.  Зурагдахгүй бол ЗӨВХӨН харагдахгүй — алдаа/өөрчлөлт үүсэхгүй, шийдвэрт нөлөөлөхгүй.
    ///
    /// Нэг л сервер: `Show` дахин дуудахад зөвхөн хэлбэрийг соль (дахин бүртгэхгүй).
    /// </summary>
    internal sealed class PreChangeGhost : IDirectContext3DServer
    {
        private static readonly Guid ServerId = new Guid("6f0c1b7e-6b6c-4f53-9b0e-2c1d7a3f9a41");

        private static readonly object Gate = new object();
        private static PreChangeGhost _server;
        private static Application _hooked;
        private static MultiServerService _service;

        private volatile GhostDraw _draw;
        // Баримтыг ЛАВЛАХ (reference/Equals) — `RevitDocumentKeys.Of` нь олон Revit API дууддаг тул кадр бүр, `DocumentChanged` бүрд (халуун зам) дуудахгүй.
        private volatile Document _doc;
        // GPU буфер — зөвхөн RenderScene-ийн дотор үүсгэж (Map-ийн хязгаар), зураглал солигдохоор дахин үүсгэнэ.
        private GhostDraw _builtFor;
        private List<LayerBuffers> _buffers;
        private VertexFormat _format;

        /// <summary>Нэг агшны бүтэн зураглал (давхаргууд + хүрээ).  Хуучин ханын «сүүдэр» ба хаалганы ghost + тодруулга ИЖИЛ.</summary>
        private sealed class GhostDraw
        {
            public GhostScene Scene;
        }

        private sealed class LayerBuffers
        {
            public VertexBuffer Vertices; public int VertexCount;
            public IndexBuffer FaceIndices; public int FaceTriangles;
            public IndexBuffer LineIndices; public int LineCount;
            public EffectInstance FaceEffect, LineEffect;
        }

        internal static bool IsActive
        {
            get { lock (Gate) return _server != null && _server._draw != null; }
        }

        /* ============================== PUBLIC (Revit thread) ================ */

        /// <summary>Ханын сүүдрийг үзүүлнэ / шинэчилнэ.  ЗӨВХӨН Revit-ийн үндсэн thread (SmartExecutor).</summary>
        internal static void Show(UIApplication app, Document doc, DocumentKey key, long wallId, double[] vectorMm, ApplyTone tone)
        {
            try
            {
                Element e = doc.GetElement(new ElementId(wallId));
                Wall wall = e as Wall;
                if (wall == null) { Clear(app); return; }
                var lc = wall.Location as LocationCurve;
                Line line = lc != null ? lc.Curve as Line : null;
                BoundingBoxXYZ bb = wall.get_BoundingBox(null);
                if (line == null || bb == null) { Clear(app); return; }

                // Хананы bbox-ийн төв = чиглүүлсэн тэгш өнцөгтийн төв (эргэсэн тэгш өнцөгтийн AABB-ийн төв нь түүний төвтэй давхцна).
                XYZ d = line.Direction;
                double cx = (bb.Min.X + bb.Max.X) / 2.0, cy = (bb.Min.Y + bb.Max.Y) / 2.0;
                XYZ mv = PcUnits.VectorFromMm(vectorMm);
                GhostMesh mesh = PreChangeGhostGeometry.Build(cx, cy, d.X, d.Y, line.Length, wall.Width, bb.Min.Z, bb.Max.Z, mv.X, mv.Y);
                if (mesh == null) { Clear(app); return; }
                ShowScene(app, doc, GhostScenes.ForWall(mesh, PreChangeGhostGeometry.ToneRgb(tone)));
            }
            catch (Exception ex)
            {
                SmartLog.Warn("prechange", "ghost_show_failed", new { ex = ex.GetType().Name });
                try { Clear(app); } catch (Exception) { }
            }
        }

        /// <summary>
        /// Бэлэн зураглалыг (ханын сүүдэр ЭСВЭЛ хаалганы ghost + тодруулга) үзүүлнэ.  Сервер бүртгээгүй бол бүртгэнэ.  ЗӨВХӨН Revit-ийн үндсэн thread.
        /// Хоосон зураглал = арилгана.
        /// </summary>
        internal static void ShowScene(UIApplication app, Document doc, GhostScene scene)
        {
            try
            {
                if (scene == null || scene.IsEmpty || scene.Bounds == null) { Clear(app); return; }
                lock (Gate)
                {
                    EnsureRegistered(app);
                    _server._doc = doc;
                    _server._draw = new GhostDraw { Scene = scene };
                }
                Redraw(app);
            }
            catch (Exception ex)
            {
                SmartLog.Warn("prechange", "ghost_show_failed", new { ex = ex.GetType().Name });
                try { Clear(app); } catch (Exception) { }
            }
        }

        /// <summary>
        /// ШУУД солих (Revit API-гүй): сервер аль хэдийн бүртгэгдсэн бол зураглалыг тэр дор нь орлуулна — дараагийн кадрт харагдана.  Бүртгээгүй бол false
        /// (дуудагч `ShowScene`-ийг Revit thread-д дуудна).  Зөвхөн ижил баримтад.
        /// </summary>
        internal static bool TrySwapScene(GhostScene scene)
        {
            lock (Gate)
            {
                if (_server == null || _server._doc == null || scene == null || scene.IsEmpty || scene.Bounds == null) return false;
                _server._draw = new GhostDraw { Scene = scene };
                return true;
            }
        }

        /// <summary>ШУУД нууна (Revit API-гүй, идемпотент): зураглал зогсоно; серверийг дараагийн `Clear` бүрэн хасна.</summary>
        internal static void TryHide()
        {
            lock (Gate)
            {
                if (_server != null) _server._draw = null;
            }
        }

        /// <summary>Redraw хүсэлт (ExternalEvent дотор дуудна): бүх нээлттэй харагдацыг шинэчилнэ.</summary>
        internal static void RequestRedraw(UIApplication app)
        {
            Redraw(app);
        }

        /// <summary>Сүүдрийг арилгаж, серверийг БҮРЭН хасна.  Идемпотент; Revit-ийн thread.</summary>
        internal static void Clear(UIApplication app)
        {
            bool had;
            lock (Gate)
            {
                had = _server != null;
                if (_server != null) _server._draw = null;
                Unregister();
            }
            if (had && app != null) Redraw(app);
        }

        /// <summary>Revit унтрах — `app` байхгүй ч найдвартай.</summary>
        internal static void Shutdown()
        {
            try
            {
                lock (Gate)
                {
                    if (_server != null) _server._draw = null;
                    Unregister();
                }
            }
            catch (Exception) { }
        }

        private static void Redraw(UIApplication app)
        {
            try
            {
                UIDocument ui = app != null ? app.ActiveUIDocument : null;
                if (ui != null) ui.UpdateAllOpenViews();
            }
            catch (Exception) { /* дахин зурах нь зөвхөн дэлгэцийн шинэчлэл */ }
        }

        /* ============================== REGISTRATION ======================== */

        private static void EnsureRegistered(UIApplication app)
        {
            if (_server != null) return;
            ExternalService svc = ExternalServiceRegistry.GetService(ExternalServices.BuiltInExternalServices.DirectContext3DService);
            var multi = svc as MultiServerService;
            if (multi == null) throw new InvalidOperationException("DirectContext3D үйлчилгээ олдсонгүй.");

            // Өмнөх (бүрэн цэвэрлэгдээгүй) бүртгэл ижил ServerId-тай үлдсэн бол AddServer «давхар» гэж шидэх тул ЭХЛЭЭД чимээгүй хасна.
            try { multi.RemoveServer(ServerId); } catch (Exception) { }

            var server = new PreChangeGhost();
            bool added = false;
            try
            {
                multi.AddServer(server);
                added = true;
                IList<Guid> ids = multi.GetActiveServerIds();
                if (!ids.Contains(ServerId)) ids.Add(ServerId);
                multi.SetActiveServers(ids);
            }
            catch (Exception)
            {
                // Хагас бүртгэл (AddServer болсон, SetActiveServers унасан) үлдэхгүй — үгүй бол дараагийн оролдлого үргэлж «давхар» гэж унана.
                if (added)
                {
                    try { IList<Guid> ids2 = multi.GetActiveServerIds(); if (ids2.Remove(ServerId)) multi.SetActiveServers(ids2); } catch (Exception) { }
                    try { multi.RemoveServer(ServerId); } catch (Exception) { }
                }
                throw;
            }

            _server = server;
            _service = multi;

            // Баримт хаагдах / бодит өөрчлөлт орох үед сүүдрийг шууд зогсооно (sandbox, хойшлуулсан commit-ийг тооцохгүй).  Бүртгэл бүрэн болсны ДАРАА.
            Application ca = app.Application;
            ca.DocumentClosing += OnClosing;
            ca.DocumentChanged += OnChanged;
            _hooked = ca;
        }

        private static void Unregister()
        {
            try
            {
                if (_hooked != null)
                {
                    _hooked.DocumentClosing -= OnClosing;
                    _hooked.DocumentChanged -= OnChanged;
                }
            }
            catch (Exception) { }
            _hooked = null;

            PreChangeGhost server = _server;
            MultiServerService svc = _service;
            _server = null;
            _service = null;
            if (server != null) server.Release();
            if (svc == null) return;
            try
            {
                IList<Guid> ids = svc.GetActiveServerIds();
                if (ids.Remove(ServerId)) svc.SetActiveServers(ids);
            }
            catch (Exception) { }
            try { svc.RemoveServer(ServerId); }
            catch (Exception) { }
        }

        private static void OnClosing(object sender, DocumentClosingEventArgs e)
        {
            try
            {
                lock (Gate)
                {
                    if (_server == null) return;
                    // ЗӨВХӨН сүүдэр харуулж буй баримт хаагдахад.  Өөр баримт хаагдахад сүүдэр хэвээр (тэр баримт идэвхтэй байж болно).
                    Document closing = e.Document;
                    Document mine = _server._doc;
                    if (closing != null && mine != null && !SmartDocs.Same(closing, mine)) return;
                    _server._draw = null;
                    Unregister();
                }
            }
            catch (Exception) { }
        }

        private static void OnChanged(object sender, DocumentChangedEventArgs e)
        {
            try
            {
                // ⚠️ Preview-ийн sandbox ба Apply-ийн дотоод commit энд ХЭЗЭЭ Ч сүүдрийг арилгахгүй.
                if (ImpactSimulationScope.Suppressed) return;
                lock (Gate)
                {
                    if (_server == null) return;
                    Document d = e.GetDocument();
                    if (d == null || !SmartDocs.Same(d, _server._doc)) return;
                    _server._draw = null;           // зураглал зогсоно; сервер дараагийн Clear/Show/Shutdown-д бүрэн хасагдана
                }
            }
            catch (Exception) { }
        }

        private void Release()
        {
            try { ReleaseBuffers(); } catch (Exception) { }
        }

        private void ReleaseBuffers()
        {
            List<LayerBuffers> list = _buffers;
            VertexFormat fmt = _format;
            _buffers = null;
            _builtFor = null;
            _format = null;
            if (list != null)
                foreach (LayerBuffers b in list)
                    foreach (object o in new object[] { b.Vertices, b.FaceIndices, b.LineIndices, b.FaceEffect, b.LineEffect })
                    {
                        var disp = o as IDisposable;
                        if (disp != null) { try { disp.Dispose(); } catch (Exception) { } }
                    }
            var f = fmt as IDisposable;
            if (f != null) { try { f.Dispose(); } catch (Exception) { } }
        }

        /* ============================== IExternalServer ===================== */

        public Guid GetServerId() { return ServerId; }
        public ExternalServiceId GetServiceId() { return ExternalServices.BuiltInExternalServices.DirectContext3DService; }
        public string GetName() { return "MGL — өөрчлөхөөс өмнө шалгах (сүүдэр)"; }
        public string GetVendorId() { return "MGL"; }
        public string GetDescription() { return "Хана, хаалга зөөхийн өмнөх харагдац: сүүдэр, нөлөөллийн тодруулга (зөвхөн дэлгэц, загварт бичихгүй)."; }

        /* ============================== IDirectContext3DServer ============== */

        public string GetApplicationId() { return string.Empty; }
        public string GetSourceId() { return string.Empty; }
        public bool UsesHandles() { return false; }
        public bool UseInTransparentPass(View dBView) { return true; }

        public bool CanExecute(View dBView)
        {
            try
            {
                GhostDraw d = _draw;
                if (d == null || dBView == null || dBView.IsTemplate) return false;
                switch (dBView.ViewType)
                {
                    case ViewType.ThreeD:
                    case ViewType.FloorPlan:
                    case ViewType.CeilingPlan:
                    case ViewType.EngineeringPlan:
                    case ViewType.Section:
                    case ViewType.Elevation:
                        break;
                    default: return false;
                }
                return SmartDocs.Same(dBView.Document, _doc);
            }
            catch (Exception) { return false; }
        }

        public Outline GetBoundingBox(View dBView)
        {
            try
            {
                GhostDraw d = _draw;
                if (d == null || d.Scene == null || d.Scene.Bounds == null) return null;
                double[] b = d.Scene.Bounds;
                return new Outline(new XYZ(b[0], b[1], b[2]), new XYZ(b[3], b[4], b[5]));
            }
            catch (Exception) { return null; }
        }

        public void RenderScene(View view, DisplayStyle displayStyle)
        {
            try
            {
                GhostDraw d = _draw;
                if (d == null || !DrawContext.IsAvailable()) return;
                if (!ReferenceEquals(d, _builtFor)) Build(d);
                List<LayerBuffers> layers = _buffers;
                if (layers == null) return;

                bool transparent = DrawContext.IsTransparentPass();
                foreach (LayerBuffers b in layers)
                {
                    if (transparent)
                    {
                        // Тунгалаг дүүргэлт (шинэ байрлал, тодруулга).
                        if (b.FaceTriangles > 0)
                            DrawContext.FlushBuffer(b.Vertices, b.VertexCount, b.FaceIndices, b.FaceTriangles * 3, _format, b.FaceEffect, PrimitiveType.TriangleList, 0, b.FaceTriangles);
                    }
                    else if (b.LineCount > 0)
                    {
                        DrawContext.FlushBuffer(b.Vertices, b.VertexCount, b.LineIndices, b.LineCount * 2, _format, b.LineEffect, PrimitiveType.LineList, 0, b.LineCount);
                    }
                }
            }
            catch (Exception)
            {
                // Зураглал унавал чимээгүй — шинжилгээ, шийдвэрт нөлөөлөхгүй.
            }
        }

        /// <summary>`RenderScene`-ийн дотор (Map-ийн хязгаар).  Давхарга бүрт НЭГ орой буфер, дүүргэлт/шугамын индекс буфер, өнгөний effect.</summary>
        private void Build(GhostDraw d)
        {
            ReleaseBuffers();
            var list = new List<LayerBuffers>();
            VertexFormat fmt = new VertexFormat(VertexFormatBits.Position);
            foreach (GhostLayer l in d.Scene.Layers)
            {
                if (l == null || l.Xyz == null || l.VertexCount < 3 || l.VertexCount >= 65000) continue;
                var b = new LayerBuffers { VertexCount = l.VertexCount, Vertices = Vertices(l.Xyz, l.VertexCount) };
                var c = new Color(l.Rgb[0], l.Rgb[1], l.Rgb[2]);
                if (l.Triangles != null && l.Triangles.Length >= 3)
                {
                    b.FaceTriangles = l.Triangles.Length / 3;
                    b.FaceIndices = Triangles(l.Triangles);
                    b.FaceEffect = new EffectInstance(VertexFormatBits.Position);
                    b.FaceEffect.SetColor(c);
                    b.FaceEffect.SetTransparency(l.Transparency);
                }
                if (l.Lines != null && l.Lines.Length >= 2)
                {
                    b.LineCount = l.Lines.Length / 2;
                    b.LineIndices = Lines(l.Lines);
                    b.LineEffect = new EffectInstance(VertexFormatBits.Position);
                    b.LineEffect.SetColor(c);
                    // Дүүргэлттэй давхаргын ирмэг БҮТЭН (тунгалаг биш); зөвхөн шугамтай давхарга (хуучин контур) өөрийн тунгалагийг авна.
                    if (b.FaceTriangles == 0) b.LineEffect.SetTransparency(l.Transparency);
                }
                list.Add(b);
            }
            _format = fmt;
            _buffers = list;
            _builtFor = d;
        }

        private static VertexBuffer Vertices(double[] xyz, int count)
        {
            int floats = count * VertexPosition.GetSizeInFloats();
            var vb = new VertexBuffer(floats);
            vb.Map(floats);
            VertexStreamPosition s = vb.GetVertexStreamPosition();
            for (int i = 0; i < count; i++) s.AddVertex(new VertexPosition(new XYZ(xyz[i * 3], xyz[i * 3 + 1], xyz[i * 3 + 2])));
            vb.Unmap();
            return vb;
        }

        private static IndexBuffer Triangles(int[] idx)
        {
            int n = idx.Length / 3;
            int shorts = n * IndexTriangle.GetSizeInShortInts();
            var ib = new IndexBuffer(shorts);
            ib.Map(shorts);
            IndexStreamTriangle s = ib.GetIndexStreamTriangle();
            for (int i = 0; i < n; i++) s.AddTriangle(new IndexTriangle(idx[i * 3], idx[i * 3 + 1], idx[i * 3 + 2]));
            ib.Unmap();
            return ib;
        }

        private static IndexBuffer Lines(int[] idx)
        {
            int n = idx.Length / 2;
            int shorts = n * IndexLine.GetSizeInShortInts();
            var ib = new IndexBuffer(shorts);
            ib.Map(shorts);
            IndexStreamLine s = ib.GetIndexStreamLine();
            for (int i = 0; i < n; i++) s.AddLine(new IndexLine(idx[i * 2], idx[i * 2 + 1]));
            ib.Unmap();
            return ib;
        }
    }
}
