using System;
using System.Collections.Generic;
using System.Linq;

namespace RevitMcpAddin.ChangeImpact.Core
{
    /// <summary>Нэг тодруулах элементийн хайрцаг (мм).  `Group` нь өнгийг шийднэ: Critical 🔴, Review 🟠, Changed 🟡, Safe/мэдээлэл 🔵.</summary>
    public sealed class OverlayBox
    {
        public string Key { get; set; }
        public ImpactGroup Group { get; set; }
        public double[] BoxMm { get; set; }
        public string Label { get; set; }
        /// <summary>Дэлгэцэнд нэмэлт тэмдэг (босоо зүү) тавих уу — ЗӨВХӨН Critical/Review, хязгаартай.</summary>
        public bool Marker { get; set; }
        public bool Predictive { get; set; }
    }

    /// <summary>Хаалганы «сүүдэр»-ийн оролт (мм): ӨМНӨХ (одоогийн) байрлал + шилжилт.  Ghost-ийг эндээс угсарна — Revit API хэрэггүй.</summary>
    public sealed class DoorGhostSpec
    {
        /// <summary>Хаалганы хайрцгийн төв (мм), ОДООГИЙН байрлалд.</summary>
        public double CenterX { get; set; }
        public double CenterY { get; set; }
        public double DirX { get; set; }
        public double DirY { get; set; }
        public double WidthMm { get; set; }
        public double DepthMm { get; set; }
        public double ZMinMm { get; set; }
        public double ZMaxMm { get; set; }
    }

    /// <summary>Нэг агшны зураглал: ghost + тодруулга.  `Generation` нь аль зорилтод хамаарахыг заана (хуучин зураглал шинийг дарахгүй).</summary>
    public sealed class DoorVisualState
    {
        public int Generation { get; set; }
        public double OffsetMm { get; set; }
        public double[] VectorMm { get; set; }
        public ApplyTone Tone { get; set; }
        public DoorGhostSpec Ghost { get; set; }
        public List<OverlayBox> Overlay { get; set; } = new List<OverlayBox>();
        public ImpactGroup? Filter { get; set; }
        /// <summary>true = эцсийн (sandbox) дүнгээс; false = урьдчилсан (fast scan).</summary>
        public bool Exact { get; set; }
    }

    public static class DoorOverlayBuilder
    {
        /// <summary>Нэг агшинд зурах хайрцгийн дээд тоо (зураглал хэт ачаалахгүй).</summary>
        public const int MaxBoxes = 40;
        /// <summary>Нэмэлт тэмдгийн (зүү) дээд тоо — Critical түрүүлнэ, дараа нь Review.</summary>
        public const int MaxMarkers = 12;

        public static DoorGhostSpec GhostOf(DoorMoveContext ctx)
        {
            if (ctx == null || ctx.Host == null || ctx.Door == null) return null;
            double x, y;
            DoorHostMath.PointAt(ctx.Host, ctx.Door.CenterParamMm, ctx.Door.CenterNormalMm, out x, out y);
            return new DoorGhostSpec
            {
                CenterX = x, CenterY = y, DirX = ctx.Host.TangentX, DirY = ctx.Host.TangentY,
                WidthMm = ctx.Door.DrawWidthMm,
                DepthMm = ctx.Door.DepthMm > 0 ? ctx.Door.DepthMm : ctx.Host.ThicknessMm,
                ZMinMm = ctx.Door.ZMaxMm > ctx.Door.ZMinMm ? ctx.Door.ZMinMm : ctx.Host.ZMinMm,
                ZMaxMm = ctx.Door.ZMaxMm > ctx.Door.ZMinMm ? ctx.Door.ZMaxMm : ctx.Host.ZMaxMm,
            };
        }

        /// <summary>
        /// Мөрүүдээс (бүлэг ≠ NotEvaluated) тодруулах хайрцгийг ЗӨВХӨН хайрцаг нь мэдэгдэж байгаа үед сонгоно.  `filter` өгвөл зөвхөн тэр бүлэг.
        /// Дараалал: Critical → Review → Changed → Safe.  Давхардсан түлхүүрт хамгийн ноцтой бүлэг хэвээр.  Тоо хязгаартай.
        /// </summary>
        public static List<OverlayBox> Build(DoorMoveContext ctx, IEnumerable<ImpactEntry> entries, ImpactGroup? filter)
        {
            var result = new List<OverlayBox>();
            if (ctx == null || entries == null) return result;
            var best = new Dictionary<string, OverlayBox>(StringComparer.Ordinal);
            foreach (ImpactEntry e in entries)
            {
                if (e.Group == ImpactGroup.NotEvaluated) continue;
                if (filter.HasValue && e.Group != filter.Value) continue;
                if (string.IsNullOrEmpty(e.TargetKey)) continue;
                ObstacleBox box = ctx.FindByKey(e.TargetKey);
                if (box == null || box.BoxMm == null || box.BoxMm.Length < 6) continue;
                OverlayBox cur;
                if (best.TryGetValue(e.TargetKey, out cur) && (int)cur.Group <= (int)e.Group) continue;      // ноцтой нь хэвээр
                best[e.TargetKey] = new OverlayBox { Key = e.TargetKey, Group = e.Group, BoxMm = box.BoxMm, Label = box.Label ?? e.Subject, Predictive = e.Predictive };
            }

            result = best.Values.OrderBy(b => (int)b.Group).ThenBy(b => b.Key, StringComparer.Ordinal).Take(MaxBoxes).ToList();
            int markers = 0;
            foreach (OverlayBox b in result)
                if ((b.Group == ImpactGroup.Critical || b.Group == ImpactGroup.Review) && markers < MaxMarkers) { b.Marker = true; markers++; }
            return result;
        }

        /// <summary>Нэгдсэн зураглалын төлөв.  `exact` = ТӨРӨЛ (эцсийн дүнгээс эсэх).</summary>
        public static DoorVisualState Visual(DoorMoveContext ctx, int generation, double offsetMm, ApplyTone tone, IEnumerable<ImpactEntry> entries, ImpactGroup? filter, bool exact)
        {
            return new DoorVisualState
            {
                Generation = generation, OffsetMm = offsetMm, VectorMm = ctx != null && ctx.Host != null ? DoorHostMath.Vector(ctx.Host, offsetMm) : new[] { 0.0, 0.0, 0.0 },
                Tone = tone, Ghost = GhostOf(ctx), Overlay = Build(ctx, entries, filter), Filter = filter, Exact = exact,
            };
        }
    }

    /// <summary>
    /// Хайрцгийг (мм) дэлгэцийн mesh болгоно — ЦЭВЭР.  `unitPerMm` = Revit-ийн дотоод нэгж (фут) / мм (дуудагч `UnitUtils`-ээр өгнө).
    /// Нэг эффектэд (өнгөнд) нэг mesh: бүх хайрцгийн орой, гурвалжин, ирмэг нэгтгэгдсэн.  Зүү (marker) нь босоо шугам + ромбо толгой.
    /// </summary>
    public sealed class OverlayMesh
    {
        public ImpactGroup Group { get; set; }
        /// <summary>x,y,z (дотоод нэгж).</summary>
        public double[] Vertices { get; set; }
        public int[] Triangles { get; set; }
        public int[] Edges { get; set; }
    }

    public static class DoorOverlayMesh
    {
        private static readonly int[] BoxTriangles =
        {
            0, 1, 3,  0, 3, 2,   4, 7, 5,  4, 6, 7,
            0, 2, 6,  0, 6, 4,   1, 5, 7,  1, 7, 3,
            0, 4, 5,  0, 5, 1,   2, 3, 7,  2, 7, 6,
        };

        private static readonly int[] BoxEdges =
        {
            0, 1,  2, 3,  4, 5,  6, 7,
            0, 2,  1, 3,  4, 6,  5, 7,
            0, 4,  1, 5,  2, 6,  3, 7,
        };

        /// <summary>Хайрцаг бүрийг бүлгээр нь нэгтгэж mesh болгоно.  Хоосон бүлэг орхигдоно.</summary>
        public static List<OverlayMesh> Build(IEnumerable<OverlayBox> boxes, double unitPerMm)
        {
            var meshes = new List<OverlayMesh>();
            if (boxes == null || unitPerMm <= 0 || double.IsNaN(unitPerMm)) return meshes;
            foreach (IGrouping<ImpactGroup, OverlayBox> g in boxes.Where(b => b != null && b.BoxMm != null && b.BoxMm.Length >= 6).GroupBy(b => b.Group).OrderBy(g => (int)g.Key))
            {
                var verts = new List<double>();
                var tris = new List<int>();
                var edges = new List<int>();
                foreach (OverlayBox b in g)
                {
                    double x0 = Math.Min(b.BoxMm[0], b.BoxMm[3]), x1 = Math.Max(b.BoxMm[0], b.BoxMm[3]);
                    double y0 = Math.Min(b.BoxMm[1], b.BoxMm[4]), y1 = Math.Max(b.BoxMm[1], b.BoxMm[4]);
                    double z0 = Math.Min(b.BoxMm[2], b.BoxMm[5]), z1 = Math.Max(b.BoxMm[2], b.BoxMm[5]);
                    if (IsBad(x0) || IsBad(x1) || IsBad(y0) || IsBad(y1) || IsBad(z0) || IsBad(z1)) continue;
                    // Хэт нимгэн хайрцгийг (хавтгай) зурагдахуйц болгоно (≥ 20 мм).
                    const double minThick = 20;
                    if (x1 - x0 < minThick) { double c = (x0 + x1) / 2; x0 = c - minThick / 2; x1 = c + minThick / 2; }
                    if (y1 - y0 < minThick) { double c = (y0 + y1) / 2; y0 = c - minThick / 2; y1 = c + minThick / 2; }
                    if (z1 - z0 < minThick) { double c = (z0 + z1) / 2; z0 = c - minThick / 2; z1 = c + minThick / 2; }
                    int baseIdx = verts.Count / 3;
                    for (int i = 0; i < 8; i++)
                    {
                        verts.Add(((i & 1) == 0 ? x0 : x1) * unitPerMm);
                        verts.Add(((i & 2) == 0 ? y0 : y1) * unitPerMm);
                        verts.Add(((i & 4) == 0 ? z0 : z1) * unitPerMm);
                    }
                    foreach (int t in BoxTriangles) tris.Add(baseIdx + t);
                    foreach (int e in BoxEdges) edges.Add(baseIdx + e);

                    if (b.Marker)
                    {
                        // Зүү: хайрцгийн төвөөс дээш босоо шугам + ромбо (4 ирмэг).  Бүх зүйл шугамаар — гурвалжингүй.
                        double cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
                        double top = z1, pinTop = z1 + 600, head = 120;
                        int m = verts.Count / 3;
                        double[,] pts =
                        {
                            { cx, cy, top }, { cx, cy, pinTop },
                            { cx - head, cy, pinTop }, { cx + head, cy, pinTop }, { cx, cy - head, pinTop }, { cx, cy + head, pinTop }, { cx, cy, pinTop + head * 1.6 },
                        };
                        for (int i = 0; i < pts.GetLength(0); i++) { verts.Add(pts[i, 0] * unitPerMm); verts.Add(pts[i, 1] * unitPerMm); verts.Add(pts[i, 2] * unitPerMm); }
                        edges.AddRange(new[] { m, m + 1, m + 2, m + 6, m + 6, m + 3, m + 3, m + 4, m + 4, m + 2, m + 2, m + 5, m + 5, m + 3 });
                    }
                }
                if (verts.Count == 0) continue;
                meshes.Add(new OverlayMesh { Group = g.Key, Vertices = verts.ToArray(), Triangles = tris.ToArray(), Edges = edges.ToArray() });
            }
            return meshes;
        }

        private static bool IsBad(double v) { return double.IsNaN(v) || double.IsInfinity(v); }

        /// <summary>Бүлгийн өнгө (RGB 0–255): Critical улаан, Review улбар шар, Changed шар, Safe цэнхэр (мэдээлэл).  Өнгө ганцаараа биш — цонхны жагсаалт + үг хамт.</summary>
        public static byte[] Rgb(ImpactGroup g)
        {
            switch (g)
            {
                case ImpactGroup.Critical: return new byte[] { 214, 40, 40 };
                case ImpactGroup.Review: return new byte[] { 232, 150, 0 };
                case ImpactGroup.Changed: return new byte[] { 224, 190, 0 };
                case ImpactGroup.Safe: return new byte[] { 40, 120, 220 };
                default: return new byte[] { 128, 128, 128 };
            }
        }
    }
}
