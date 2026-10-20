using System;
using System.Collections.Generic;
using System.Linq;

namespace RevitMcpAddin.ChangeImpact.Core
{
    /// <summary>
    /// Simulation-ийн Revit-ийн ЗУРАГ ДЭЭРХ (DirectContext3D) сүүдэр — Revit/WPF-гүй, тестлэгдэнэ.
    /// Зөөгдсөн элементийн ШИНЭ байрлал (тунгалаг, шийдвэрийн өнгө), хуучин хүрээ (саарал), сум, мөргөлдөөний улаан эзлэхүүн.
    /// Бүх оройг Revit-ийн дотоод нэгж (фут) дэлхийн координатад: (local мм + origin + offset) × `unitPerMm`.
    /// </summary>
    public static class SimGhostScene
    {
        public const int MaxVerticesPerLayer = 60000;
        public const int MaxGhostTriangles = 30000;
        public const double FaceTransparency = 0.55;
        public const double HitTransparency = 0.45;

        public static readonly byte[] OkRgb = { 60, 170, 90 };
        public static readonly byte[] ReviewRgb = { 238, 150, 40 };
        public static readonly byte[] BlockedRgb = { 215, 55, 55 };
        public static readonly byte[] UnknownRgb = { 120, 130, 145 };
        public static readonly byte[] HitRgb = { 232, 35, 35 };
        private static readonly byte[] OldRgb = { 110, 110, 110 };

        public static byte[] ToneOf(MoveVerdict v)
        {
            switch (v)
            {
                case MoveVerdict.MoveOk: return OkRgb;
                case MoveVerdict.MoveWithReview: return ReviewRgb;
                case MoveVerdict.DoNotMove: return BlockedRgb;
                default: return UnknownRgb;
            }
        }

        /// <param name="hitBoxesLocalMm">Улаанаар тодруулах хайрцгууд (local мм).</param>
        public static GhostScene Build(SimScene scene, SimVec offset, MoveVerdict verdict, IList<double[]> hitBoxesLocalMm, double unitPerMm)
        {
            var gs = new GhostScene();
            if (scene == null || scene.Moving.Count == 0 || unitPerMm <= 0 || double.IsNaN(unitPerMm) || double.IsInfinity(unitPerMm)) return gs;
            double ox = scene.OriginMm[0], oy = scene.OriginMm[1], oz = scene.OriginMm[2];
            byte[] tone = ToneOf(verdict);

            // 1) Шинэ байрлалын тунгалаг нүүр (давхарга бүр < MaxVerticesPerLayer орой).
            int triBudget = MaxGhostTriangles;
            var xyz = new List<double>();
            var tri = new List<int>();
            int layerNo = 0;
            foreach (SimMesh m in scene.Moving)
            {
                if (triBudget <= 0) break;
                int nv = m.VertexCount;
                if (nv == 0 || m.TriangleCount == 0) continue;
                if (nv >= MaxVerticesPerLayer) continue;
                if (xyz.Count / 3 + nv >= MaxVerticesPerLayer) { Flush(gs, "sim.ghost." + (layerNo++), xyz, tri, tone, FaceTransparency); }
                int baseIdx = xyz.Count / 3;
                for (int i = 0; i + 2 < m.Xyz.Length; i += 3)
                {
                    xyz.Add((m.Xyz[i] + ox + offset.X) * unitPerMm);
                    xyz.Add((m.Xyz[i + 1] + oy + offset.Y) * unitPerMm);
                    xyz.Add((m.Xyz[i + 2] + oz + offset.Z) * unitPerMm);
                }
                int take = Math.Min(m.TriangleCount, triBudget);
                for (int t = 0; t < take * 3; t++) tri.Add(baseIdx + m.Tri[t]);
                triBudget -= take;
            }
            Flush(gs, "sim.ghost." + (layerNo++), xyz, tri, tone, FaceTransparency);

            // 2) Хүрээ: шинэ (шийдвэрийн өнгө) + хуучин (саарал) + сум.
            SimBox box = scene.MovingBounds;
            if (!box.IsEmpty)
            {
                var newBox = box.Translated(offset);
                gs.Layers.Add(BoxEdges("sim.new", newBox, ox, oy, oz, unitPerMm, tone, 0, true));
                gs.Layers.Add(BoxEdges("sim.old", box, ox, oy, oz, unitPerMm, OldRgb, 0.35, false));
                SimVec c0 = box.Center, c1 = newBox.Center;
                gs.Layers.Add(Arrow("sim.arrow", c0, c1, ox, oy, oz, unitPerMm, tone));
            }

            // 3) Мөргөлдөөн: улаан эзлэхүүн.
            if (hitBoxesLocalMm != null && hitBoxesLocalMm.Count > 0)
            {
                var hx = new List<double>();
                var ht = new List<int>();
                var hl = new List<int>();
                foreach (double[] b in hitBoxesLocalMm.Where(b => b != null && b.Length >= 6).Take(60))
                {
                    var hb = new SimBox { MinX = b[0], MinY = b[1], MinZ = b[2], MaxX = b[3], MaxY = b[4], MaxZ = b[5] };
                    if (hb.IsEmpty) continue;
                    // Нимгэн (шугам, хавтгай) хэсэг ч харагдахын тулд хамгийн багадаа 40 мм.
                    SimVec sz = hb.Size;
                    double padX = sz.X < 40 ? (40 - sz.X) / 2 : 0, padY = sz.Y < 40 ? (40 - sz.Y) / 2 : 0, padZ = sz.Z < 40 ? (40 - sz.Z) / 2 : 0;
                    hb = new SimBox { MinX = hb.MinX - padX, MinY = hb.MinY - padY, MinZ = hb.MinZ - padZ, MaxX = hb.MaxX + padX, MaxY = hb.MaxY + padY, MaxZ = hb.MaxZ + padZ };
                    AddBox(hx, ht, hl, hb, ox, oy, oz, unitPerMm);
                }
                if (hx.Count > 0 && hx.Count / 3 < MaxVerticesPerLayer)
                    gs.Layers.Add(new GhostLayer { Name = "sim.hits", Xyz = hx.ToArray(), Triangles = ht.ToArray(), Lines = hl.ToArray(), Rgb = HitRgb, Transparency = HitTransparency });
            }

            gs.Bounds = GhostScenes.BoundsOf(gs);
            return gs;
        }

        /// <summary>
        /// Revit-д ШУУД зөөсний дараах тодруулга: хуучин байрлал (саарал хүрээ), шинэ байрлал (дүгнэлтийн өнгө), сум, мөргөлдөөн (улаан эзлэхүүн).
        /// Элементийн сүүдэр хэрэггүй — элемент өөрөө аль хэдийн шинэ байрлалдаа.  `movedLocal` = ОДООГИЙН (зөөсний дараах) хүрээ, local мм.
        /// </summary>
        public static GhostScene ForNativeMove(SimBox movedLocal, SimVec offset, double[] originMm, MoveVerdict verdict, IList<double[]> hitBoxesLocalMm, double unitPerMm)
        {
            var gs = new GhostScene();
            if (movedLocal.IsEmpty || originMm == null || originMm.Length < 3 || unitPerMm <= 0) return gs;
            double ox = originMm[0], oy = originMm[1], oz = originMm[2];
            byte[] tone = ToneOf(verdict);
            SimBox before = movedLocal.Translated(new SimVec(-offset.X, -offset.Y, -offset.Z));
            gs.Layers.Add(BoxEdges("sim.new", movedLocal, ox, oy, oz, unitPerMm, tone, 0, true));
            gs.Layers.Add(BoxEdges("sim.old", before, ox, oy, oz, unitPerMm, OldRgb, 0.35, false));
            gs.Layers.Add(Arrow("sim.arrow", before.Center, movedLocal.Center, ox, oy, oz, unitPerMm, tone));
            if (hitBoxesLocalMm != null)
            {
                var hx = new List<double>(); var ht = new List<int>(); var hl = new List<int>();
                foreach (double[] b in hitBoxesLocalMm.Where(b => b != null && b.Length >= 6).Take(60))
                {
                    var hb = new SimBox { MinX = b[0] - 20, MinY = b[1] - 20, MinZ = b[2] - 20, MaxX = b[3] + 20, MaxY = b[4] + 20, MaxZ = b[5] + 20 };
                    if (!hb.IsEmpty) AddBox(hx, ht, hl, hb, ox, oy, oz, unitPerMm);
                }
                if (hx.Count > 0 && hx.Count / 3 < MaxVerticesPerLayer)
                    gs.Layers.Add(new GhostLayer { Name = "sim.hits", Xyz = hx.ToArray(), Triangles = ht.ToArray(), Lines = hl.ToArray(), Rgb = HitRgb, Transparency = HitTransparency });
            }
            gs.Bounds = GhostScenes.BoundsOf(gs);
            return gs;
        }

        private static void Flush(GhostScene gs, string name, List<double> xyz, List<int> tri, byte[] rgb, double transparency)
        {
            if (xyz.Count >= 9 && tri.Count >= 3)
                gs.Layers.Add(new GhostLayer { Name = name, Xyz = xyz.ToArray(), Triangles = tri.ToArray(), Rgb = rgb, Transparency = transparency });
            xyz.Clear(); tri.Clear();
        }

        private static readonly int[] BoxEdgeIdx = { 0, 1, 1, 2, 2, 3, 3, 0, 4, 5, 5, 6, 6, 7, 7, 4, 0, 4, 1, 5, 2, 6, 3, 7 };
        private static readonly int[] BoxTriIdx =
        {
            0, 2, 1, 0, 3, 2,  4, 5, 6, 4, 6, 7,  0, 1, 5, 0, 5, 4,  1, 2, 6, 1, 6, 5,  2, 3, 7, 2, 7, 6,  3, 0, 4, 3, 4, 7,
        };

        private static double[] Corners(SimBox b, double ox, double oy, double oz, double u)
        {
            double[] x = { b.MinX, b.MaxX, b.MaxX, b.MinX, b.MinX, b.MaxX, b.MaxX, b.MinX };
            double[] y = { b.MinY, b.MinY, b.MaxY, b.MaxY, b.MinY, b.MinY, b.MaxY, b.MaxY };
            double[] z = { b.MinZ, b.MinZ, b.MinZ, b.MinZ, b.MaxZ, b.MaxZ, b.MaxZ, b.MaxZ };
            var r = new double[24];
            for (int i = 0; i < 8; i++) { r[i * 3] = (x[i] + ox) * u; r[i * 3 + 1] = (y[i] + oy) * u; r[i * 3 + 2] = (z[i] + oz) * u; }
            return r;
        }

        private static GhostLayer BoxEdges(string name, SimBox b, double ox, double oy, double oz, double u, byte[] rgb, double transparency, bool thick)
        {
            return new GhostLayer { Name = name, Xyz = Corners(b, ox, oy, oz, u), Lines = (int[])BoxEdgeIdx.Clone(), Rgb = rgb, Transparency = transparency };
        }

        private static void AddBox(List<double> xyz, List<int> tri, List<int> lines, SimBox b, double ox, double oy, double oz, double u)
        {
            int baseIdx = xyz.Count / 3;
            xyz.AddRange(Corners(b, ox, oy, oz, u));
            foreach (int i in BoxTriIdx) tri.Add(baseIdx + i);
            foreach (int i in BoxEdgeIdx) lines.Add(baseIdx + i);
        }

        private static GhostLayer Arrow(string name, SimVec from, SimVec to, double ox, double oy, double oz, double u, byte[] rgb)
        {
            SimVec d = to - from;
            double len = d.Length;
            var pts = new List<double>();
            var lines = new List<int>();
            Action<SimVec> add = p => { pts.Add((p.X + ox) * u); pts.Add((p.Y + oy) * u); pts.Add((p.Z + oz) * u); };
            add(from); add(to);
            lines.Add(0); lines.Add(1);
            if (len > 1)
            {
                SimVec dir = d * (1.0 / len);
                SimVec side = new SimVec(-dir.Y, dir.X, 0);
                if (side.LengthSq < 1e-9) side = new SimVec(1, 0, 0);
                side = side.Normalized();
                double head = Math.Min(400, len * 0.25);
                add(to - dir * head + side * (head * 0.5));
                add(to - dir * head - side * (head * 0.5));
                lines.Add(1); lines.Add(2); lines.Add(1); lines.Add(3);
            }
            return new GhostLayer { Name = name, Xyz = pts.ToArray(), Lines = lines.ToArray(), Rgb = rgb, Transparency = 0 };
        }
    }
}
