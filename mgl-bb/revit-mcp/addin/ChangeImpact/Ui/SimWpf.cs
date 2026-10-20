using System;
using System.Collections.Generic;
using System.Windows.Media;
using System.Windows.Media.Media3D;
using RevitMcpAddin.ChangeImpact.Core;

namespace RevitMcpAddin.ChangeImpact.Ui
{
    /// <summary>
    /// `SimMesh` → WPF 3D геометр (зөвхөн ХАРУУЛАХ; мөргөлдөөн, барилт нь Core-д).  Бүх геометр FROZEN — арын thread-д бүтээж UI thread-д ашиглаж болно.
    ///
    /// ЯАГААД flat (гурвалжин бүрт өөрийн орой, нормаль): Revit-ийн геометр хурц ирмэгтэй (хана, шал, багана) — WPF-ийн автомат (smooth) нормаль ирмэгийг бүдгэрүүлж «зөөлөн» болгодог.
    /// ЯАГААД normalOffset: улаан тодруулга нь үндсэн геометртэй ИЖИЛ гурвалжинг дахин зурна — z-fighting гарахгүйн тулд нормалийн дагуу хэдэн мм түлхэнэ.
    /// </summary>
    internal static class SimWpf
    {
        internal const int MaxTrianglesPerMesh = 30000;

        /// <summary>Гурвалжин бүрт (дээд тал `maxTriangles`) тусдаа орой + нормальтай, frozen.  Хоосон бол null.</summary>
        internal static MeshGeometry3D FlatMesh(IEnumerable<SimMesh> meshes, double normalOffsetMm, int maxTriangles, out int used)
        {
            int total = 0;
            foreach (SimMesh m in meshes) total += m.TriangleCount;
            total = Math.Min(total, maxTriangles);
            used = 0;
            if (total <= 0) return null;

            var pos = new Point3DCollection(total * 3);
            var nrm = new Vector3DCollection(total * 3);
            var idx = new Int32Collection(total * 3);
            int n = 0;
            foreach (SimMesh m in meshes)
            {
                double[] v = m.Xyz;
                int[] t = m.Tri;
                for (int i = 0; i + 2 < t.Length && n < total; i += 3)
                {
                    int a = t[i] * 3, b = t[i + 1] * 3, c = t[i + 2] * 3;
                    double ax = v[a], ay = v[a + 1], az = v[a + 2];
                    double ux = v[b] - ax, uy = v[b + 1] - ay, uz = v[b + 2] - az;
                    double wx = v[c] - ax, wy = v[c + 1] - ay, wz = v[c + 2] - az;
                    double nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
                    double len = Math.Sqrt(nx * nx + ny * ny + nz * nz);
                    if (len < 1e-9) continue;
                    nx /= len; ny /= len; nz /= len;
                    double ox = nx * normalOffsetMm, oy = ny * normalOffsetMm, oz = nz * normalOffsetMm;
                    pos.Add(new Point3D(ax + ox, ay + oy, az + oz));
                    pos.Add(new Point3D(v[b] + ox, v[b + 1] + oy, v[b + 2] + oz));
                    pos.Add(new Point3D(v[c] + ox, v[c + 1] + oy, v[c + 2] + oz));
                    var nv = new Vector3D(nx, ny, nz);
                    nrm.Add(nv); nrm.Add(nv); nrm.Add(nv);
                    idx.Add(n * 3); idx.Add(n * 3 + 1); idx.Add(n * 3 + 2);
                    n++;
                }
            }
            used = n;
            if (n == 0) return null;
            var g = new MeshGeometry3D { Positions = pos, Normals = nrm, TriangleIndices = idx };
            g.Freeze();
            return g;
        }

        /// <summary>Хайрцгууд (local мм) — тэнхлэгт зэрэгцээ, нүүр бүрт нормальтай.  Хоосон бол null.</summary>
        internal static MeshGeometry3D BoxesMesh(IEnumerable<double[]> boxes)
        {
            var pos = new Point3DCollection();
            var nrm = new Vector3DCollection();
            var idx = new Int32Collection();
            int faces = 0;
            foreach (double[] b in boxes)
            {
                if (b == null || b.Length < 6) continue;
                double x0 = b[0], y0 = b[1], z0 = b[2], x1 = b[3], y1 = b[4], z1 = b[5];
                if (x1 < x0 || y1 < y0 || z1 < z0) continue;
                // Нимгэн хайрцаг ч харагдахын тулд хамгийн багадаа 30 мм.
                if (x1 - x0 < 30) { double c = (x0 + x1) / 2; x0 = c - 15; x1 = c + 15; }
                if (y1 - y0 < 30) { double c = (y0 + y1) / 2; y0 = c - 15; y1 = c + 15; }
                if (z1 - z0 < 30) { double c = (z0 + z1) / 2; z0 = c - 15; z1 = c + 15; }
                AddQuad(pos, nrm, idx, new Point3D(x0, y0, z0), new Point3D(x0, y1, z0), new Point3D(x1, y1, z0), new Point3D(x1, y0, z0), new Vector3D(0, 0, -1));
                AddQuad(pos, nrm, idx, new Point3D(x0, y0, z1), new Point3D(x1, y0, z1), new Point3D(x1, y1, z1), new Point3D(x0, y1, z1), new Vector3D(0, 0, 1));
                AddQuad(pos, nrm, idx, new Point3D(x0, y0, z0), new Point3D(x1, y0, z0), new Point3D(x1, y0, z1), new Point3D(x0, y0, z1), new Vector3D(0, -1, 0));
                AddQuad(pos, nrm, idx, new Point3D(x1, y0, z0), new Point3D(x1, y1, z0), new Point3D(x1, y1, z1), new Point3D(x1, y0, z1), new Vector3D(1, 0, 0));
                AddQuad(pos, nrm, idx, new Point3D(x1, y1, z0), new Point3D(x0, y1, z0), new Point3D(x0, y1, z1), new Point3D(x1, y1, z1), new Vector3D(0, 1, 0));
                AddQuad(pos, nrm, idx, new Point3D(x0, y1, z0), new Point3D(x0, y0, z0), new Point3D(x0, y0, z1), new Point3D(x0, y1, z1), new Vector3D(-1, 0, 0));
                faces += 6;
            }
            if (faces == 0) return null;
            var g = new MeshGeometry3D { Positions = pos, Normals = nrm, TriangleIndices = idx };
            g.Freeze();
            return g;
        }

        private static void AddQuad(Point3DCollection pos, Vector3DCollection nrm, Int32Collection idx, Point3D a, Point3D b, Point3D c, Point3D d, Vector3D n)
        {
            int i = pos.Count;
            pos.Add(a); pos.Add(b); pos.Add(c); pos.Add(d);
            nrm.Add(n); nrm.Add(n); nrm.Add(n); nrm.Add(n);
            idx.Add(i); idx.Add(i + 1); idx.Add(i + 2); idx.Add(i); idx.Add(i + 2); idx.Add(i + 3);
        }

        /// <summary>Ангилалын өнгө — Revit-ийн «Shaded» харагдацтай төстэй, зөөлөн.</summary>
        internal static Color KindColor(SimKind k)
        {
            switch (k)
            {
                case SimKind.Wall: return Color.FromRgb(214, 210, 200);
                case SimKind.Floor: return Color.FromRgb(196, 196, 190);
                case SimKind.Roof: return Color.FromRgb(188, 168, 160);
                case SimKind.Ceiling: return Color.FromRgb(226, 226, 222);
                case SimKind.Door: return Color.FromRgb(172, 134, 98);
                case SimKind.Window: return Color.FromRgb(160, 198, 224);
                case SimKind.Column: return Color.FromRgb(180, 180, 186);
                case SimKind.Framing: return Color.FromRgb(160, 170, 186);
                case SimKind.Foundation: return Color.FromRgb(160, 158, 152);
                case SimKind.Stair: return Color.FromRgb(200, 196, 186);
                case SimKind.Railing: return Color.FromRgb(150, 150, 156);
                case SimKind.Furniture: return Color.FromRgb(206, 178, 140);
                case SimKind.Equipment: return Color.FromRgb(176, 156, 200);
                case SimKind.Duct: return Color.FromRgb(120, 186, 224);
                case SimKind.Pipe: return Color.FromRgb(86, 176, 124);
                case SimKind.Conduit: return Color.FromRgb(232, 186, 84);
                case SimKind.CableTray: return Color.FromRgb(214, 156, 90);
                case SimKind.Fitting: return Color.FromRgb(150, 190, 170);
                case SimKind.Lighting: return Color.FromRgb(240, 220, 130);
                case SimKind.Topography: return Color.FromRgb(176, 190, 150);
                default: return Color.FromRgb(196, 198, 202);
            }
        }

        internal static readonly Color MovingColor = Color.FromRgb(36, 118, 236);
        internal static readonly Color HitColor = Color.FromRgb(226, 30, 30);
        internal static readonly Color AffectedColor = Color.FromRgb(240, 150, 30);

        /// <summary>Диффуз + бага зэргийн өөрийн гэрэл (сүүдэрт талууд хэт харанхуй болохгүй).  `alpha` &lt; 1 бол тунгалаг.</summary>
        internal static Material Solid(Color c, double alpha = 1.0, int glow = 22)
        {
            byte a = (byte)Math.Max(0, Math.Min(255, (int)Math.Round(alpha * 255)));
            var mg = new MaterialGroup();
            mg.Children.Add(new DiffuseMaterial(new SolidColorBrush(Color.FromArgb(a, c.R, c.G, c.B))));
            if (glow > 0) mg.Children.Add(new EmissiveMaterial(new SolidColorBrush(Color.FromArgb(a, (byte)(c.R * glow / 255), (byte)(c.G * glow / 255), (byte)(c.B * glow / 255)))));
            mg.Freeze();
            return mg;
        }

        internal static GeometryModel3D Model(MeshGeometry3D geo, Material m)
        {
            var gm = new GeometryModel3D(geo, m) { BackMaterial = m };
            return gm;
        }

        internal static Point3D P(SimVec v) { return new Point3D(v.X, v.Y, v.Z); }
        internal static Vector3D V(SimVec v) { return new Vector3D(v.X, v.Y, v.Z); }
    }
}
