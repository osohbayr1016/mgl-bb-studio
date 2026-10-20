using System;
using System.Collections.Generic;
using System.Linq;
using Autodesk.Revit.DB;
using Autodesk.Revit.DB.DirectContext3D;
using Autodesk.Revit.DB.ExternalService;
using Autodesk.Revit.UI;
using RevitMcpAddin.WallElevation.Core;

namespace RevitMcpAddin.WallElevation.Revit
{
    /// <summary>
    /// Өрөөний ТОДРУУЛГА — Revit-ийн DirectContext3D (`IDirectContext3DServer`): курсор доорх өрөө (улбар шар), сонгосон / шалгаж буй
    /// өрөөнүүд (цэнхэр).  ⚠️ ЗАГВАРТ ЮУ Ч БИЧИХГҮЙ — транзакц, элемент, сонголт, Undo үгүй; зөвхөн дэлгэцийн зураглал.
    /// Зөвхөн нэг харагдацад (<see cref="Show"/>-ийн viewId) зурна.  Зураглалыг солих (<see cref="Swap"/>) нь Revit API-гүй — курсор
    /// дагах таймер үүнийг дуудна; бүртгэх/хасах нь API-ийн орчинд.
    /// </summary>
    internal sealed class WeRoomOverlay : IDirectContext3DServer
    {
        private static readonly Guid ServerId = new Guid("3c7e9a51-8d42-4f1b-a6e0-5b2f9c1d7e84");
        private static readonly object Gate = new object();
        private static WeRoomOverlay _server;
        private static MultiServerService _service;

        private sealed class Scene
        {
            public string DocKey;
            public long ViewId;
            public List<WeOverlayLayer> Layers;
            public Outline Bounds;
        }

        private sealed class Buffers
        {
            public VertexBuffer Vertices; public int VertexCount;
            public IndexBuffer Tris; public int TriCount;
            public IndexBuffer Lines; public int LineCount;
            public EffectInstance TriFx, LineFx;
        }

        private volatile Scene _scene;
        private Scene _builtFor;
        private List<Buffers> _buffers;
        private VertexFormat _format;

        internal static string DocKey(Document d)
        {
            try { return (d.PathName ?? string.Empty) + "|" + d.Title; } catch { return string.Empty; }
        }

        /// <summary>Бүртгэнэ (шаардлагатай бол) + зураглал тавина.  API-ийн орчинд.  false = DirectContext3D боломжгүй (тодруулгагүй үргэлжилнэ).</summary>
        internal static bool Show(Document doc, ElementId viewId, List<WeOverlayLayer> layers)
        {
            try
            {
                lock (Gate)
                {
                    Register();
                    _server._scene = Make(DocKey(doc), viewId.Value, layers);
                }
                return true;
            }
            catch (Exception ex)
            {
                WeLog.Info("hover", "DirectContext3D бүртгэл — " + ex.Message);
                return false;
            }
        }

        /// <summary>Зураглалыг шууд солино (Revit API-гүй).  Бүртгээгүй бол юу ч хийхгүй.</summary>
        internal static void Swap(string docKey, long viewId, List<WeOverlayLayer> layers)
        {
            lock (Gate)
            {
                if (_server == null) return;
                _server._scene = Make(docKey, viewId, layers);
            }
        }

        /// <summary>Зураглалыг нууна (API-гүй).</summary>
        internal static void Hide()
        {
            lock (Gate) { if (_server != null) _server._scene = null; }
        }

        /// <summary>Серверийг бүрэн хасна (API-ийн орчинд, идемпотент).</summary>
        internal static void Shutdown()
        {
            lock (Gate)
            {
                WeRoomOverlay s = _server;
                MultiServerService svc = _service;
                _server = null;
                _service = null;
                if (s != null) { s._scene = null; s.Release(); }
                if (svc == null) return;
                try { IList<Guid> ids = svc.GetActiveServerIds(); if (ids.Remove(ServerId)) svc.SetActiveServers(ids); } catch { }
                try { svc.RemoveServer(ServerId); } catch { }
            }
        }

        /// <summary>Идэвхтэй харагдацыг дахин зурна (API-ийн орчинд; унавал чимээгүй — зөвхөн дэлгэц).</summary>
        internal static bool Refresh(UIDocument uidoc)
        {
            try { if (uidoc != null) uidoc.RefreshActiveView(); return true; }
            catch { return false; }
        }

        private static Scene Make(string docKey, long viewId, List<WeOverlayLayer> layers)
        {
            List<WeOverlayLayer> ok = (layers ?? new List<WeOverlayLayer>()).Where(l => l != null && !l.IsEmpty && l.VertexCount < 65000).ToList();
            if (ok.Count == 0) return null;
            double x0 = double.MaxValue, y0 = double.MaxValue, z0 = double.MaxValue, x1 = double.MinValue, y1 = double.MinValue, z1 = double.MinValue;
            foreach (WeOverlayLayer l in ok)
                for (int i = 0; i + 2 < l.Xyz.Count; i += 3)
                {
                    x0 = Math.Min(x0, l.Xyz[i]); x1 = Math.Max(x1, l.Xyz[i]);
                    y0 = Math.Min(y0, l.Xyz[i + 1]); y1 = Math.Max(y1, l.Xyz[i + 1]);
                    z0 = Math.Min(z0, l.Xyz[i + 2]); z1 = Math.Max(z1, l.Xyz[i + 2]);
                }
            return new Scene { DocKey = docKey, ViewId = viewId, Layers = ok, Bounds = new Outline(new XYZ(x0, y0, z0 - 0.01), new XYZ(x1, y1, z1 + 0.01)) };
        }

        private static void Register()
        {
            if (_server != null) return;
            ExternalService svc = ExternalServiceRegistry.GetService(ExternalServices.BuiltInExternalServices.DirectContext3DService);
            var multi = svc as MultiServerService;
            if (multi == null) throw new InvalidOperationException("DirectContext3D үйлчилгээ олдсонгүй");
            try { multi.RemoveServer(ServerId); } catch { }
            var server = new WeRoomOverlay();
            multi.AddServer(server);
            try
            {
                IList<Guid> ids = multi.GetActiveServerIds();
                if (!ids.Contains(ServerId)) ids.Add(ServerId);
                multi.SetActiveServers(ids);
            }
            catch
            {
                try { multi.RemoveServer(ServerId); } catch { }
                throw;
            }
            _server = server;
            _service = multi;
        }

        private void Release()
        {
            List<Buffers> list = _buffers;
            _buffers = null;
            _builtFor = null;
            if (list != null)
                foreach (Buffers b in list)
                    foreach (object o in new object[] { b.Vertices, b.Tris, b.Lines, b.TriFx, b.LineFx })
                    { var d = o as IDisposable; if (d != null) try { d.Dispose(); } catch { } }
            var f = _format as IDisposable;
            _format = null;
            if (f != null) try { f.Dispose(); } catch { }
        }

        // ── IExternalServer / IDirectContext3DServer ─────────────────────

        public Guid GetServerId() { return ServerId; }
        public ExternalServiceId GetServiceId() { return ExternalServices.BuiltInExternalServices.DirectContext3DService; }
        public string GetName() { return "MGL — Ханын дэлгээс: өрөөний тодруулга"; }
        public string GetVendorId() { return "MGL"; }
        public string GetDescription() { return "Курсор доорх / сонгосон өрөөний хилийг дэлгэцэнд тодруулна (загварт бичихгүй)."; }
        public string GetApplicationId() { return string.Empty; }
        public string GetSourceId() { return string.Empty; }
        public bool UsesHandles() { return false; }
        public bool UseInTransparentPass(View dBView) { return true; }

        public bool CanExecute(View dBView)
        {
            try
            {
                Scene s = _scene;
                return s != null && dBView != null && dBView.Id.Value == s.ViewId && DocKey(dBView.Document) == s.DocKey;
            }
            catch { return false; }
        }

        public Outline GetBoundingBox(View dBView)
        {
            Scene s = _scene;
            return s != null ? s.Bounds : null;
        }

        public void RenderScene(View view, DisplayStyle displayStyle)
        {
            try
            {
                Scene s = _scene;
                if (s == null || !DrawContext.IsAvailable()) return;
                if (!ReferenceEquals(s, _builtFor)) Build(s);
                List<Buffers> list = _buffers;
                if (list == null) return;
                bool transparent = DrawContext.IsTransparentPass();
                foreach (Buffers b in list)
                {
                    if (transparent)
                    {
                        if (b.TriCount > 0) DrawContext.FlushBuffer(b.Vertices, b.VertexCount, b.Tris, b.TriCount * 3, _format, b.TriFx, PrimitiveType.TriangleList, 0, b.TriCount);
                    }
                    else if (b.LineCount > 0)
                        DrawContext.FlushBuffer(b.Vertices, b.VertexCount, b.Lines, b.LineCount * 2, _format, b.LineFx, PrimitiveType.LineList, 0, b.LineCount);
                }
            }
            catch { /* зөвхөн дэлгэц — унавал зураглалгүй */ }
        }

        private void Build(Scene s)
        {
            Release();
            var list = new List<Buffers>();
            var fmt = new VertexFormat(VertexFormatBits.Position);
            foreach (WeOverlayLayer l in s.Layers)
            {
                int n = l.VertexCount;
                var b = new Buffers { VertexCount = n };
                int floats = n * VertexPosition.GetSizeInFloats();
                b.Vertices = new VertexBuffer(floats);
                b.Vertices.Map(floats);
                VertexStreamPosition vs = b.Vertices.GetVertexStreamPosition();
                for (int i = 0; i < n; i++) vs.AddVertex(new VertexPosition(new XYZ(l.Xyz[i * 3], l.Xyz[i * 3 + 1], l.Xyz[i * 3 + 2])));
                b.Vertices.Unmap();
                var color = new Color(l.R, l.G, l.B);
                if (l.Triangles.Count >= 3)
                {
                    b.TriCount = l.Triangles.Count / 3;
                    int shorts = b.TriCount * IndexTriangle.GetSizeInShortInts();
                    b.Tris = new IndexBuffer(shorts);
                    b.Tris.Map(shorts);
                    IndexStreamTriangle ts = b.Tris.GetIndexStreamTriangle();
                    for (int i = 0; i < b.TriCount; i++) ts.AddTriangle(new IndexTriangle(l.Triangles[i * 3], l.Triangles[i * 3 + 1], l.Triangles[i * 3 + 2]));
                    b.Tris.Unmap();
                    b.TriFx = new EffectInstance(VertexFormatBits.Position);
                    b.TriFx.SetColor(color);
                    b.TriFx.SetTransparency(l.Transparency);
                }
                if (l.Lines.Count >= 2)
                {
                    b.LineCount = l.Lines.Count / 2;
                    int shorts = b.LineCount * IndexLine.GetSizeInShortInts();
                    b.Lines = new IndexBuffer(shorts);
                    b.Lines.Map(shorts);
                    IndexStreamLine ls = b.Lines.GetIndexStreamLine();
                    for (int i = 0; i < b.LineCount; i++) ls.AddLine(new IndexLine(l.Lines[i * 2], l.Lines[i * 2 + 1]));
                    b.Lines.Unmap();
                    b.LineFx = new EffectInstance(VertexFormatBits.Position);
                    b.LineFx.SetColor(color);
                }
                list.Add(b);
            }
            _format = fmt;
            _buffers = list;
            _builtFor = s;
        }
    }
}
