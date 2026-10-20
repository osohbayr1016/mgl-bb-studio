using System;
using System.Collections.Generic;
using Autodesk.Revit.DB;
using RevitMcpAddin.ChangeImpact.Core;
using RevitMcpAddin.Smart;

namespace RevitMcpAddin.ChangeImpact
{
    /// <summary>
    /// Revit элементийн ЖИНХЭНЭ геометрийг (solid-ийн нүүр бүрийг тессел хийж) simulation-ийн гурвалжин сүлжээ (`SimMesh`) болгоно.
    ///
    ///   • Координат: Revit-ийн дотоод (фут) → мм (`UnitUtils`, нэг удаа) − `OriginMm` (local) — float-ийн нарийвчлал алдагдахгүй.
    ///   • Линк загварын элемент: `linkTransform`-оор host координат руу.
    ///   • Төсөв: элемент тутамд гурвалжингийн дээд тоо (`maxTriangles`) — хэтэрвэл `Truncated` (дэлгэц дээр харагдана, мөргөлдөөнд «хаалттай» гэж тооцогдохгүй).
    ///   • Нөөц: `GeometryElement` бүрийг БҮРЭН dispose (олон мянган элемент дээр native санах ой хуримтлагдахгүй).
    ///
    /// ⚠️ Revit API — үндсэн thread.  Загварыг ӨӨРЧЛӨХГҮЙ.
    /// </summary>
    internal sealed class SimGeometryReader : IDisposable
    {
        private readonly Options _options;
        /// <summary>
        /// Coarse-д бодисгүй (зураасаар) зурагддаг элементийн нөөц: Revit бүтцийн дам нуруу/баганын stick, суваг/хоолойн нэг шугамыг Coarse-д л өгнө.
        /// Revit 2027 дээр хэмжсэн (2026-10-06, Snowdon Towers): Coarse-оор орчны 66 дам нуруунаас 0 нь уншигдаж, мөргөлдөөнд ОГТ ороогүй.
        /// </summary>
        private readonly Options _fallback;
        private readonly double _mmPerFoot;
        private readonly double[] _origin;

        internal SimGeometryReader(double[] originMm, bool fine)
        {
            _origin = originMm ?? new double[3];
            _mmPerFoot = PcUnits.Mm(1.0);
            _options = new Options
            {
                DetailLevel = fine ? ViewDetailLevel.Medium : ViewDetailLevel.Coarse,
                ComputeReferences = false,
                IncludeNonVisibleObjects = false,
            };
            Lod = fine ? 0.5 : 0.2;
            if (!fine) _fallback = new Options { DetailLevel = ViewDetailLevel.Medium, ComputeReferences = false, IncludeNonVisibleObjects = false };
        }

        /// <summary>`Face.Triangulate` нарийвчлал (0 = бүдүүн, 1 = нарийн).</summary>
        internal double Lod { get; private set; }

        public void Dispose()
        {
            try { _options.Dispose(); } catch (Exception) { }
            try { if (_fallback != null) _fallback.Dispose(); } catch (Exception) { }
        }

        /// <summary>
        /// Нэг элементийн сүлжээ.  null = бодис геометр байхгүй (арматур, 2D…) эсвэл унших алдаа (`problem`-д шалтгаан).
        /// `local` = энэ мм-ийн origin-той төстэй: x_local = x_world_mm − origin.
        /// </summary>
        internal SimMesh Read(Element e, Transform linkTransform, int maxTriangles, out string problem)
        {
            problem = null;
            GeometryElement ge = null;
            try
            {
                ge = e.get_Geometry(_options);
                var builder = new SimMeshBuilder(0.05, maxTriangles);
                if (ge != null) Walk(ge, linkTransform, builder, 0);
                if (builder.TriangleCount == 0 && _fallback != null)
                {
                    if (ge != null) { try { ge.Dispose(); } catch (Exception) { } }
                    ge = e.get_Geometry(_fallback);
                    builder = new SimMeshBuilder(0.05, maxTriangles);
                    if (ge != null) Walk(ge, linkTransform, builder, 0);
                }
                if (ge == null) { problem = "Геометргүй элемент."; return null; }
                if (builder.TriangleCount == 0) { problem = "Бодис (solid) геометр байхгүй."; return null; }
                var mesh = new SimMesh();
                builder.Fill(mesh);
                return mesh;
            }
            catch (Exception ex)
            {
                problem = "Геометр унших алдаа (" + ex.GetType().Name + ").";
                return null;
            }
            finally
            {
                if (ge != null) { try { ge.Dispose(); } catch (Exception) { } }
            }
        }

        private void Walk(GeometryElement ge, Transform link, SimMeshBuilder b, int depth)
        {
            if (depth > 4) return;
            foreach (GeometryObject go in ge)
            {
                if (b.Truncated) return;
                var solid = go as Solid;
                if (solid != null) { AddSolid(solid, link, b); continue; }

                var inst = go as GeometryInstance;
                if (inst != null)
                {
                    GeometryElement inner = null;
                    try
                    {
                        inner = inst.GetInstanceGeometry();       // загварын координатад (transform хэрэглэсэн)
                        if (inner != null) Walk(inner, link, b, depth + 1);
                    }
                    finally { if (inner != null) { try { inner.Dispose(); } catch (Exception) { } } }
                    continue;
                }

                var mesh = go as Mesh;
                if (mesh != null) AddMesh(mesh, link, b);
            }
        }

        private void AddSolid(Solid s, Transform link, SimMeshBuilder b)
        {
            try
            {
                if (s == null || s.Faces.Size == 0 || Math.Abs(s.Volume) < 1e-9) return;
            }
            catch (Exception) { return; }

            foreach (Face f in s.Faces)
            {
                if (b.Truncated) return;
                Mesh m = null;
                try
                {
                    m = f.Triangulate(Lod);
                    if (m != null) AddMesh(m, link, b);
                }
                catch (Exception) { /* нэг нүүр тессел болсонгүй — бусдыг үргэлжлүүлнэ (сүлжээ нээлттэй болж «дотор»-ыг таамаглахгүй) */ }
                finally { if (m != null) { try { m.Dispose(); } catch (Exception) { } } }
            }
        }

        private void AddMesh(Mesh m, Transform link, SimMeshBuilder b)
        {
            int n = m.NumTriangles;
            for (int i = 0; i < n; i++)
            {
                MeshTriangle t = m.get_Triangle(i);
                XYZ a = t.get_Vertex(0), c = t.get_Vertex(1), d = t.get_Vertex(2);
                if (link != null && !link.IsIdentity) { a = link.OfPoint(a); c = link.OfPoint(c); d = link.OfPoint(d); }
                if (!b.AddTriangle(
                    a.X * _mmPerFoot - _origin[0], a.Y * _mmPerFoot - _origin[1], a.Z * _mmPerFoot - _origin[2],
                    c.X * _mmPerFoot - _origin[0], c.Y * _mmPerFoot - _origin[1], c.Z * _mmPerFoot - _origin[2],
                    d.X * _mmPerFoot - _origin[0], d.Y * _mmPerFoot - _origin[1], d.Z * _mmPerFoot - _origin[2])) return;
            }
        }
    }
}
