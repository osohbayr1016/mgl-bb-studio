using System;
using System.Collections.Generic;
using System.Linq;

namespace RevitMcpAddin.WallElevation.Core
{
    /// <summary>
    /// Курсор доорх / сонгосон өрөөний тодруулга (2026-10-14, эзэн: «хэрэгслээ сонгоод өрөөнд ойртуулахад тэр өрөө бүх хүрээгээрээ
    /// тодорч, аль хүрээгээр дуудагдаж байгааг танидаг болго»).  Өрөө = харуулах координатад (план — загварын XY, хуудас — хуудасны XY)
    /// хувиргасан хилийн контурууд.  Revit-гүй.
    /// </summary>
    public sealed class WeHoverRoom
    {
        public WePickCandidate Candidate;
        /// <summary>Курсорын хажуугийн шошгоны мөр (жишээ «157 Бэлтгэх өрөө · Давхар 1 · link «…»»).</summary>
        public string Caption;
        /// <summary>Контурууд (эхнийх нь гадна хил); харуулах координатад, Z = зурах өндөр.</summary>
        public List<List<WeV3>> Loops = new List<List<WeV3>>();
        public double MinX = double.MaxValue, MinY = double.MaxValue, MaxX = double.MinValue, MaxY = double.MinValue;

        public void Grow()
        {
            foreach (List<WeV3> l in Loops)
                foreach (WeV3 p in l)
                {
                    MinX = Math.Min(MinX, p.X); MaxX = Math.Max(MaxX, p.X);
                    MinY = Math.Min(MinY, p.Y); MaxY = Math.Max(MaxY, p.Y);
                }
        }
    }

    /// <summary>Нэг өнгөт давхаргын гурвалжин + шугам (DirectContext3D-ийн буфер).</summary>
    public sealed class WeOverlayLayer
    {
        public byte R, G, B;
        /// <summary>0 = бүрэн, 1 = харагдахгүй.</summary>
        public double Transparency;
        public List<double> Xyz = new List<double>();
        public List<int> Triangles = new List<int>();
        public List<int> Lines = new List<int>();
        public int VertexCount { get { return Xyz.Count / 3; } }
        public bool IsEmpty { get { return VertexCount < 2 || (Triangles.Count < 3 && Lines.Count < 2); } }
    }

    public static class WeHoverGeometry
    {
        /// <summary>Цэг контуруудын (even-odd — арал/нүх хасагдана) дотор эсэх.</summary>
        public static bool Contains(WeHoverRoom r, double x, double y)
        {
            if (r == null || x < r.MinX || x > r.MaxX || y < r.MinY || y > r.MaxY) return false;
            bool inside = false;
            foreach (List<WeV3> loop in r.Loops)
                for (int i = 0, j = loop.Count - 1; i < loop.Count; j = i++)
                {
                    WeV3 a = loop[i], b = loop[j];
                    if ((a.Y > y) != (b.Y > y) && x < (b.X - a.X) * (y - a.Y) / (b.Y - a.Y) + a.X) inside = !inside;
                }
            return inside;
        }

        /// <summary>Цэгийг агуулсан өрөөнүүдээс дарахад сонгогдох нь (<see cref="WePickRules.Choose"/> — дарахтай ИЖИЛ дүрэм).</summary>
        public static WeHoverRoom At(IEnumerable<WeHoverRoom> rooms, double x, double y)
        {
            List<WeHoverRoom> hits = (rooms ?? Enumerable.Empty<WeHoverRoom>()).Where(r => Contains(r, x, y)).ToList();
            if (hits.Count == 0) return null;
            WePickCandidate best = WePickRules.Choose(hits.Select(h => h.Candidate));
            return hits.FirstOrDefault(h => ReferenceEquals(h.Candidate, best)) ?? hits[0];
        }

        /// <summary>
        /// Хилийн БҮДҮҮН зурвас: сегмент бүр контурын дагуу <paramref name="width"/> өргөнтэй тэгш өнцөгт (дотор тал руу), булангуудад
        /// дөрвөлжин нөхөөс — Revit-ийн DirectContext3D-ийн шугам 1 пиксел тул өргөнтэй харагдахын тулд гурвалжингаар.
        /// </summary>
        public static void Band(WeHoverRoom r, double width, WeOverlayLayer layer)
        {
            if (r == null || layer == null || width <= 0) return;
            foreach (List<WeV3> loop in r.Loops)
            {
                int n = loop.Count;
                if (n < 2) continue;
                double area = SignedArea(loop);
                for (int i = 0; i < n; i++)
                {
                    WeV3 a = loop[i], b = loop[(i + 1) % n];
                    double dx = b.X - a.X, dy = b.Y - a.Y, len = Math.Sqrt(dx * dx + dy * dy);
                    if (len < 1e-9) continue;
                    // Зурвас контурын ТӨВД (хагас нь дотор, хагас нь гадна) — өрөөний хил шугамтай давхцана.
                    double nx = -dy / len * width / 2 * Math.Sign(area == 0 ? 1 : area), ny = dx / len * width / 2 * Math.Sign(area == 0 ? 1 : area);
                    Quad(layer, a.X - nx, a.Y - ny, b.X - nx, b.Y - ny, b.X + nx, b.Y + ny, a.X + nx, a.Y + ny, a.Z);
                    double h = width / 2;
                    Quad(layer, b.X - h, b.Y - h, b.X + h, b.Y - h, b.X + h, b.Y + h, b.X - h, b.Y + h, a.Z);
                }
            }
        }

        /// <summary>Гадна хилийн тунгалаг дүүргэлт (ear clipping; нүх тооцохгүй — тодруулгад хангалттай) + хилийн 1 пикселийн шугам.</summary>
        public static void Fill(WeHoverRoom r, WeOverlayLayer layer)
        {
            if (r == null || layer == null || r.Loops.Count == 0) return;
            List<WeV3> outer = r.Loops.OrderByDescending(l => Math.Abs(SignedArea(l))).First();
            List<WeV3> pts = Dedupe(outer);
            if (pts.Count < 3) return;
            int baseIndex = layer.VertexCount;
            foreach (WeV3 p in pts) { layer.Xyz.Add(p.X); layer.Xyz.Add(p.Y); layer.Xyz.Add(p.Z); }
            foreach (int[] t in EarClip(pts)) { layer.Triangles.Add(baseIndex + t[0]); layer.Triangles.Add(baseIndex + t[1]); layer.Triangles.Add(baseIndex + t[2]); }
            for (int i = 0; i < pts.Count; i++) { layer.Lines.Add(baseIndex + i); layer.Lines.Add(baseIndex + (i + 1) % pts.Count); }
        }

        public static double SignedArea(List<WeV3> loop)
        {
            double s = 0;
            for (int i = 0, j = loop.Count - 1; i < loop.Count; j = i++) s += (loop[j].X * loop[i].Y) - (loop[i].X * loop[j].Y);
            return s / 2;
        }

        private static List<WeV3> Dedupe(List<WeV3> loop)
        {
            var r = new List<WeV3>();
            foreach (WeV3 p in loop)
                if (r.Count == 0 || Math.Abs(r[r.Count - 1].X - p.X) + Math.Abs(r[r.Count - 1].Y - p.Y) > 1e-7) r.Add(p);
            if (r.Count > 1 && Math.Abs(r[0].X - r[r.Count - 1].X) + Math.Abs(r[0].Y - r[r.Count - 1].Y) <= 1e-7) r.RemoveAt(r.Count - 1);
            return r;
        }

        /// <summary>Энгийн олон өнцөгтийн ear clipping (CCW руу хөрвүүлнэ).  Унавал (өөрийгөө огтолсон) — эзэнгүй үлдсэнийг fan.</summary>
        internal static List<int[]> EarClip(List<WeV3> pts)
        {
            var tris = new List<int[]>();
            var idx = Enumerable.Range(0, pts.Count).ToList();
            if (SignedArea(pts) < 0) idx.Reverse();
            int guard = 0;
            while (idx.Count > 3 && guard++ < 10000)
            {
                bool cut = false;
                for (int i = 0; i < idx.Count; i++)
                {
                    int ia = idx[(i + idx.Count - 1) % idx.Count], ib = idx[i], ic = idx[(i + 1) % idx.Count];
                    WeV3 a = pts[ia], b = pts[ib], c = pts[ic];
                    double cross = (b.X - a.X) * (c.Y - a.Y) - (b.Y - a.Y) * (c.X - a.X);
                    if (cross <= 1e-12) continue;   // хонхор орой
                    bool any = false;
                    foreach (int k in idx)
                    {
                        if (k == ia || k == ib || k == ic) continue;
                        if (InTri(pts[k], a, b, c)) { any = true; break; }
                    }
                    if (any) continue;
                    tris.Add(new[] { ia, ib, ic });
                    idx.RemoveAt(i);
                    cut = true;
                    break;
                }
                if (!cut) break;
            }
            if (idx.Count == 3) tris.Add(new[] { idx[0], idx[1], idx[2] });
            else for (int i = 1; i + 1 < idx.Count; i++) tris.Add(new[] { idx[0], idx[i], idx[i + 1] });
            return tris;
        }

        private static bool InTri(WeV3 p, WeV3 a, WeV3 b, WeV3 c)
        {
            double d1 = (p.X - b.X) * (a.Y - b.Y) - (a.X - b.X) * (p.Y - b.Y);
            double d2 = (p.X - c.X) * (b.Y - c.Y) - (b.X - c.X) * (p.Y - c.Y);
            double d3 = (p.X - a.X) * (c.Y - a.Y) - (c.X - a.X) * (p.Y - a.Y);
            bool neg = d1 < 0 || d2 < 0 || d3 < 0, pos = d1 > 0 || d2 > 0 || d3 > 0;
            return !(neg && pos);
        }

        private static void Quad(WeOverlayLayer l, double x0, double y0, double x1, double y1, double x2, double y2, double x3, double y3, double z)
        {
            int b = l.VertexCount;
            l.Xyz.AddRange(new[] { x0, y0, z, x1, y1, z, x2, y2, z, x3, y3, z });
            l.Triangles.AddRange(new[] { b, b + 1, b + 2, b, b + 2, b + 3 });
        }

        /// <summary>Дэлгэцийн цэг → харуулах координат (харагдацын баруун/дээш тэнхлэгээр, эргэсэн планд ч).  null = цонхноос гадна.</summary>
        public static WeV3? ScreenToView(double sx, double sy, double left, double top, double right, double bottom,
                                         WeV3 corner0, WeV3 corner1, WeV3 rightDir, WeV3 upDir)
        {
            if (right - left < 1 || bottom - top < 1 || sx < left || sx > right || sy < top || sy > bottom) return null;
            double r0 = corner0.Dot(rightDir), r1 = corner1.Dot(rightDir), u0 = corner0.Dot(upDir), u1 = corner1.Dot(upDir);
            double fx = (sx - left) / (right - left), fy = (bottom - sy) / (bottom - top);
            double r = Math.Min(r0, r1) + fx * Math.Abs(r1 - r0), u = Math.Min(u0, u1) + fy * Math.Abs(u1 - u0);
            return rightDir * r + upDir * u;
        }
    }
}
