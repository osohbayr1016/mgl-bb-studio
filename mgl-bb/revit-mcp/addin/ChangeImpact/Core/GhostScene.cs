using System;
using System.Collections.Generic;
using System.Linq;

namespace RevitMcpAddin.ChangeImpact.Core
{
    /// <summary>
    /// Дэлгэцийн ШИНЭ зураглалын нэг давхарга: оройнууд (x,y,z, дотоод нэгж), гурвалжин (тунгалаг дүүргэлт), шугам (ирмэг), өнгө.
    /// DirectContext3D серверт ЯГ ИЖИЛ хэлбэрээр дамжина — Revit-гүй, тестлэгдэнэ.
    /// </summary>
    public sealed class GhostLayer
    {
        public string Name { get; set; }
        public double[] Xyz { get; set; }
        /// <summary>Тунгалаг дүүргэлтийн гурвалжин (индекс гурвалсан).  Хоосон бол дүүргэлтгүй.</summary>
        public int[] Triangles { get; set; } = new int[0];
        /// <summary>Ирмэг (индекс хосоор).  Хоосон бол шугамгүй.</summary>
        public int[] Lines { get; set; } = new int[0];
        public byte[] Rgb { get; set; }
        /// <summary>0 = бүрэн харагдана, 1 = харагдахгүй.</summary>
        public double Transparency { get; set; }

        public int VertexCount { get { return Xyz == null ? 0 : Xyz.Length / 3; } }
    }

    /// <summary>Нэг агшны бүтэн зураглал.  `Generation` — аль зорилтынх (хуучин нь шинийг дарахгүй).</summary>
    public sealed class GhostScene
    {
        public List<GhostLayer> Layers { get; set; } = new List<GhostLayer>();
        /// <summary>[minX,minY,minZ,maxX,maxY,maxZ] (дотоод нэгж).  Хоосон бол null.</summary>
        public double[] Bounds { get; set; }
        public int Generation { get; set; }

        public bool IsEmpty { get { return Layers.Count == 0; } }
    }

    public static class GhostScenes
    {
        public const double GhostFaceTransparency = 0.6;
        /// <summary>Эцсийн дүнгээс гарсан тодруулга.</summary>
        public const double ExactOverlayTransparency = 0.7;
        /// <summary>Урьдчилсан (fast scan) тодруулга — бүдэгхэн: эцсийн дүн биш гэдгийг нүдэнд ойлгуулна.</summary>
        public const double PredictiveOverlayTransparency = 0.88;
        private static readonly byte[] OldRgb = { 110, 110, 110 };

        /// <summary>Хананы «сүүдэр» — өмнөх хувилбартай ЯГ ИЖИЛ давхарга (шинэ байрлалын тунгалаг хүрээ, контур + сум, хуучин байрлалын саарал контур).</summary>
        public static GhostScene ForWall(GhostMesh m, byte[] rgb)
        {
            var scene = new GhostScene();
            if (m == null) return scene;
            AddPrism(scene, m, rgb);
            scene.Bounds = BoundsOf(scene);
            return scene;
        }

        private static void AddPrism(GhostScene scene, GhostMesh m, byte[] rgb)
        {
            // 1) Шинэ байрлал: 8 орой, 12 гурвалжин (тунгалаг).
            scene.Layers.Add(new GhostLayer { Name = "ghost.faces", Xyz = (double[])m.NewCorners.Clone(), Triangles = (int[])m.Triangles.Clone(), Rgb = rgb, Transparency = GhostFaceTransparency });

            // 2) Шинэ байрлалын контур + сум: 8 орой (призм) + сумын оройнууд.
            int arrowPts = m.ArrowLines.Length / 3;
            var xyz = new double[(8 + arrowPts) * 3];
            Array.Copy(m.NewCorners, xyz, 24);
            Array.Copy(m.ArrowLines, 0, xyz, 24, m.ArrowLines.Length);
            var lines = new List<int>(m.Edges);
            for (int i = 0; i + 1 < arrowPts; i += 2) { lines.Add(8 + i); lines.Add(8 + i + 1); }
            scene.Layers.Add(new GhostLayer { Name = "ghost.outline", Xyz = xyz, Lines = lines.ToArray(), Rgb = rgb, Transparency = 0 });

            // 3) Хуучин байрлалын контур (саарал).
            scene.Layers.Add(new GhostLayer { Name = "ghost.old", Xyz = (double[])m.OldCorners.Clone(), Lines = (int[])m.Edges.Clone(), Rgb = OldRgb, Transparency = 0.35 });
        }

        /// <summary>
        /// Хаалганы «сүүдэр» (ШИНЭ байрлал + хуучин контур + сум) + замын нөлөөллийн тодруулга (улаан/улбар шар/шар/цэнхэр хайрцаг, зүү).
        /// `unitPerMm` — Revit-ийн дотоод нэгж / мм (дуудагч `UnitUtils`-ээр өгнө; ЭНД гараар тогтмол БИЧИХГҮЙ).
        /// </summary>
        public static GhostScene ForDoor(DoorVisualState v, double unitPerMm)
        {
            var scene = new GhostScene { Generation = v != null ? v.Generation : 0 };
            if (v == null || unitPerMm <= 0 || double.IsNaN(unitPerMm) || double.IsInfinity(unitPerMm)) return scene;

            DoorGhostSpec g = v.Ghost;
            if (g != null && v.VectorMm != null && v.VectorMm.Length >= 2)
            {
                GhostMesh m = PreChangeGhostGeometry.Build(
                    g.CenterX * unitPerMm, g.CenterY * unitPerMm, g.DirX, g.DirY, g.WidthMm * unitPerMm, g.DepthMm * unitPerMm,
                    g.ZMinMm * unitPerMm, g.ZMaxMm * unitPerMm, v.VectorMm[0] * unitPerMm, v.VectorMm[1] * unitPerMm);
                if (m != null) AddPrism(scene, m, PreChangeGhostGeometry.ToneRgb(v.Tone));
            }

            double transparency = v.Exact ? ExactOverlayTransparency : PredictiveOverlayTransparency;
            foreach (OverlayMesh om in DoorOverlayMesh.Build(v.Overlay, unitPerMm))
            {
                scene.Layers.Add(new GhostLayer
                {
                    Name = "overlay." + om.Group, Xyz = om.Vertices, Triangles = om.Triangles, Lines = om.Edges,
                    Rgb = DoorOverlayMesh.Rgb(om.Group), Transparency = transparency,
                });
            }
            scene.Bounds = BoundsOf(scene);
            return scene;
        }

        public static double[] BoundsOf(GhostScene scene)
        {
            double minX = double.MaxValue, minY = double.MaxValue, minZ = double.MaxValue, maxX = double.MinValue, maxY = double.MinValue, maxZ = double.MinValue;
            bool any = false;
            foreach (GhostLayer l in scene.Layers)
            {
                if (l.Xyz == null) continue;
                for (int i = 0; i + 2 < l.Xyz.Length; i += 3)
                {
                    any = true;
                    minX = Math.Min(minX, l.Xyz[i]); maxX = Math.Max(maxX, l.Xyz[i]);
                    minY = Math.Min(minY, l.Xyz[i + 1]); maxY = Math.Max(maxY, l.Xyz[i + 1]);
                    minZ = Math.Min(minZ, l.Xyz[i + 2]); maxZ = Math.Max(maxZ, l.Xyz[i + 2]);
                }
            }
            return any ? new[] { minX, minY, minZ, maxX, maxY, maxZ } : null;
        }
    }
}
