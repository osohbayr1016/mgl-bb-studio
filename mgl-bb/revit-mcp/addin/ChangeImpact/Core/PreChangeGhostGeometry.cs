using System;
using System.Collections.Generic;

namespace RevitMcpAddin.ChangeImpact.Core
{
    /// <summary>
    /// Ханын «сүүдэр» (ghost) геометр — ЦЭВЭР (Revit-гүй, тестлэгдэнэ).  Нэгж: дуудагчийн өгсөн (Revit-д дотоод нэгж = фут).
    ///
    /// Хана = чиглүүлсэн (oriented) тэгш өнцөгт призм: төв (XY), чиглэл, урт, зузаан, Z-ийн хүрээ.  Сүүдэр = ШИНЭ байрлал (шилжүүлсэн призм) +
    /// хуучин байрлалын контур + хөдөлгөөний сум.  ⚠️ Энэ нь ТОВЧЛОЛ (хананы bbox-ийн төвийг, байрлалын шугамын чиглэл/урт, зузааныг ашигласан призм) —
    /// join-оор сунасан төгсгөл, давхарга бүхий хана, хаалганы нүхийг зурахгүй.  Тэр нь ЗӨВХӨН харааны чиглүүлэг, шийдвэрийн нотолгоо БИШ.
    /// </summary>
    public sealed class GhostMesh
    {
        /// <summary>8 өнцөг × (x,y,z) — ХУУЧИН байрлал.  Индекс: bit0 = урт тэнхлэг (−/+), bit1 = зузаан (−/+), bit2 = Z (доод/дээд).</summary>
        public double[] OldCorners { get; set; }
        /// <summary>8 өнцөг × (x,y,z) — ШИНЭ байрлал (хуучин + хөдөлгөөн).</summary>
        public double[] NewCorners { get; set; }
        /// <summary>Призмын 12 гурвалжин (36 индекс) — өнцгийн индекс (0..7).</summary>
        public int[] Triangles { get; set; }
        /// <summary>Призмын 12 ирмэг (24 индекс).</summary>
        public int[] Edges { get; set; }
        /// <summary>Хөдөлгөөний сум: [x1,y1,z1, x2,y2,z2] шугамууд (гол шугам + сумын хоёр хошуу = 3 шугам = 18 тоо).</summary>
        public double[] ArrowLines { get; set; }
        /// <summary>Бүх цэгийн хүрээ [minX,minY,minZ,maxX,maxY,maxZ].</summary>
        public double[] Bounds { get; set; }
    }

    public static class PreChangeGhostGeometry
    {
        /// <summary>Призмын 6 талын 12 гурвалжин (өнцгийн bit индексээр).</summary>
        private static readonly int[] BoxTriangles =
        {
            // z доод (bit2=0): 0,1,3,2
            0, 1, 3,  0, 3, 2,
            // z дээд (bit2=1): 4,5,7,6
            4, 7, 5,  4, 6, 7,
            // урт тэнхлэг −: 0,2,6,4
            0, 2, 6,  0, 6, 4,
            // урт тэнхлэг +: 1,5,7,3
            1, 5, 7,  1, 7, 3,
            // зузаан −: 0,4,5,1
            0, 4, 5,  0, 5, 1,
            // зузаан +: 2,3,7,6
            2, 3, 7,  2, 7, 6,
        };

        private static readonly int[] BoxEdges =
        {
            0, 1,  2, 3,  4, 5,  6, 7,       // урт тэнхлэгийн дагуу
            0, 2,  1, 3,  4, 6,  5, 7,       // зузааны дагуу
            0, 4,  1, 5,  2, 6,  3, 7,       // Z-ийн дагуу
        };

        /// <summary>
        /// `dirX,dirY` = хананы урт тэнхлэгийн чиглэл (нэгж биш байж болно — нормчилно).  `moveX,moveY` = хөдөлгөөн.  Буруу оролт (0 урт/зузаан, NaN) → null.
        /// </summary>
        public static GhostMesh Build(double centerX, double centerY, double dirX, double dirY, double length, double thickness, double zMin, double zMax, double moveX, double moveY)
        {
            if (IsBad(centerX) || IsBad(centerY) || IsBad(dirX) || IsBad(dirY) || IsBad(length) || IsBad(thickness) || IsBad(zMin) || IsBad(zMax) || IsBad(moveX) || IsBad(moveY)) return null;
            double n = Math.Sqrt(dirX * dirX + dirY * dirY);
            if (n < 1e-9 || length <= 0 || thickness <= 0 || zMax <= zMin) return null;
            double ux = dirX / n, uy = dirY / n;          // урт тэнхлэг
            double vx = -uy, vy = ux;                      // зүүн нормаль (зузаан)
            double hl = length / 2.0, ht = thickness / 2.0;

            var oldC = new double[24];
            var newC = new double[24];
            for (int i = 0; i < 8; i++)
            {
                double a = (i & 1) == 0 ? -hl : hl;
                double b = (i & 2) == 0 ? -ht : ht;
                double z = (i & 4) == 0 ? zMin : zMax;
                double x = centerX + ux * a + vx * b;
                double y = centerY + uy * a + vy * b;
                oldC[i * 3] = x; oldC[i * 3 + 1] = y; oldC[i * 3 + 2] = z;
                newC[i * 3] = x + moveX; newC[i * 3 + 1] = y + moveY; newC[i * 3 + 2] = z;
            }

            double zMid = (zMin + zMax) / 2.0;
            double sx = centerX, sy = centerY, ex = centerX + moveX, ey = centerY + moveY;
            double dist = Math.Sqrt(moveX * moveX + moveY * moveY);
            var arrow = new List<double> { sx, sy, zMid, ex, ey, zMid };
            if (dist > 1e-9)
            {
                double mx = moveX / dist, my = moveY / dist;
                double head = Math.Min(dist * 0.3, Math.Max(thickness * 2.0, 0.8));
                // сумын хоёр хошуу: чиглэлийн эсрэг ±30°
                const double cos = 0.8660254037844387, sin = 0.5;
                double bx1 = -(mx * cos - my * sin), by1 = -(mx * sin + my * cos);
                double bx2 = -(mx * cos + my * sin), by2 = -(-mx * sin + my * cos);
                arrow.AddRange(new[] { ex, ey, zMid, ex + bx1 * head, ey + by1 * head, zMid });
                arrow.AddRange(new[] { ex, ey, zMid, ex + bx2 * head, ey + by2 * head, zMid });
            }

            double minX = double.MaxValue, minY = double.MaxValue, minZ = double.MaxValue, maxX = double.MinValue, maxY = double.MinValue, maxZ = double.MinValue;
            Action<double[]> grow = pts =>
            {
                for (int i = 0; i + 2 < pts.Length; i += 3)
                {
                    minX = Math.Min(minX, pts[i]); maxX = Math.Max(maxX, pts[i]);
                    minY = Math.Min(minY, pts[i + 1]); maxY = Math.Max(maxY, pts[i + 1]);
                    minZ = Math.Min(minZ, pts[i + 2]); maxZ = Math.Max(maxZ, pts[i + 2]);
                }
            };
            grow(oldC); grow(newC); grow(arrow.ToArray());

            return new GhostMesh
            {
                OldCorners = oldC, NewCorners = newC,
                Triangles = (int[])BoxTriangles.Clone(), Edges = (int[])BoxEdges.Clone(),
                ArrowLines = arrow.ToArray(),
                Bounds = new[] { minX, minY, minZ, maxX, maxY, maxZ },
            };
        }

        private static bool IsBad(double v) { return double.IsNaN(v) || double.IsInfinity(v); }

        /// <summary>Шийдвэрийн өнгө → RGB (0–255) — ногоон / шар / улаан / саарал.  Өнгө ганцаараа биш: цонхны тэмдэг + үгтэй хамт.</summary>
        public static byte[] ToneRgb(ApplyTone tone)
        {
            switch (tone)
            {
                case ApplyTone.Green: return new byte[] { 46, 160, 67 };
                case ApplyTone.Amber: return new byte[] { 232, 150, 0 };
                case ApplyTone.Red: return new byte[] { 214, 40, 40 };
                default: return new byte[] { 128, 128, 128 };
            }
        }
    }
}
