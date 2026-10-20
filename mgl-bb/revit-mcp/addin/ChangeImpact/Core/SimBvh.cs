using System;
using System.Collections.Generic;

namespace RevitMcpAddin.ChangeImpact.Core
{
    /// <summary>
    /// Гурвалжин сүлжээний BVH (давхаргат хайрцаг) — хоёр сүлжээний огтлолцол, цацрагийн (ray) шалгалтад.  Бүтээгдсэний дараа өөрчлөгдөхгүй
    /// (thread-д аюулгүй унших).  Revit/WPF-гүй, тестлэгдэнэ.
    /// </summary>
    public sealed class SimBvh
    {
        private const int LeafSize = 4;

        private readonly double[] _xyz;
        private readonly int[] _tri;
        private readonly int[] _order;           // гурвалжингийн дугаарын сэлгэлт (leaf нь завсар)
        private double[] _min = new double[0];   // node бүрт 3
        private double[] _max = new double[0];
        private int[] _left = new int[0], _right = new int[0], _start = new int[0], _count = new int[0];
        private int _nodes;

        public int TriangleCount { get { return _tri.Length / 3; } }
        public int NodeCount { get { return _nodes; } }
        public double[] Xyz { get { return _xyz; } }
        public int[] Tri { get { return _tri; } }

        private SimBvh(double[] xyz, int[] tri)
        {
            _xyz = xyz;
            _tri = tri;
            _order = new int[tri.Length / 3];
            for (int i = 0; i < _order.Length; i++) _order[i] = i;
        }

        public SimBox RootBox
        {
            get
            {
                if (_nodes == 0) return SimBox.Empty();
                return new SimBox { MinX = _min[0], MinY = _min[1], MinZ = _min[2], MaxX = _max[0], MaxY = _max[1], MaxZ = _max[2] };
            }
        }

        public static SimBvh Build(double[] xyz, int[] tri)
        {
            var b = new SimBvh(xyz ?? new double[0], tri ?? new int[0]);
            int n = b._order.Length;
            if (n == 0) return b;

            int cap = Math.Max(1, 2 * n / LeafSize + 8);
            b._min = new double[cap * 3]; b._max = new double[cap * 3];
            b._left = new int[cap]; b._right = new int[cap]; b._start = new int[cap]; b._count = new int[cap];

            // Гурвалжин бүрийн төв (сэлгэлтийн хэмжээсээр) — хуваалтад.
            var cx = new double[n]; var cy = new double[n]; var cz = new double[n];
            for (int i = 0; i < n; i++)
            {
                int a = tri[i * 3] * 3, c = tri[i * 3 + 1] * 3, d = tri[i * 3 + 2] * 3;
                cx[i] = (xyz[a] + xyz[c] + xyz[d]) / 3.0;
                cy[i] = (xyz[a + 1] + xyz[c + 1] + xyz[d + 1]) / 3.0;
                cz[i] = (xyz[a + 2] + xyz[c + 2] + xyz[d + 2]) / 3.0;
            }
            b.BuildNode(0, n, cx, cy, cz);
            return b;
        }

        private int BuildNode(int start, int count, double[] cx, double[] cy, double[] cz)
        {
            int node = _nodes++;
            if (node >= _left.Length) Grow();

            // Хайрцаг.
            double minX = double.MaxValue, minY = double.MaxValue, minZ = double.MaxValue, maxX = double.MinValue, maxY = double.MinValue, maxZ = double.MinValue;
            double cMinX = double.MaxValue, cMinY = double.MaxValue, cMinZ = double.MaxValue, cMaxX = double.MinValue, cMaxY = double.MinValue, cMaxZ = double.MinValue;
            for (int i = start; i < start + count; i++)
            {
                int t = _order[i];
                for (int k = 0; k < 3; k++)
                {
                    int v = _tri[t * 3 + k] * 3;
                    double x = _xyz[v], y = _xyz[v + 1], z = _xyz[v + 2];
                    if (x < minX) minX = x; if (x > maxX) maxX = x;
                    if (y < minY) minY = y; if (y > maxY) maxY = y;
                    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
                }
                if (cx[t] < cMinX) cMinX = cx[t]; if (cx[t] > cMaxX) cMaxX = cx[t];
                if (cy[t] < cMinY) cMinY = cy[t]; if (cy[t] > cMaxY) cMaxY = cy[t];
                if (cz[t] < cMinZ) cMinZ = cz[t]; if (cz[t] > cMaxZ) cMaxZ = cz[t];
            }
            _min[node * 3] = minX; _min[node * 3 + 1] = minY; _min[node * 3 + 2] = minZ;
            _max[node * 3] = maxX; _max[node * 3 + 1] = maxY; _max[node * 3 + 2] = maxZ;

            double ex = cMaxX - cMinX, ey = cMaxY - cMinY, ez = cMaxZ - cMinZ;
            if (count <= LeafSize || (ex <= 0 && ey <= 0 && ez <= 0))
            {
                _left[node] = -1; _right[node] = -1; _start[node] = start; _count[node] = count;
                return node;
            }

            int axis = ex >= ey && ex >= ez ? 0 : (ey >= ez ? 1 : 2);
            double[] key = axis == 0 ? cx : (axis == 1 ? cy : cz);
            // Дундаж (median) — сэлгэлтийн хэсгийг эрэмбэлнэ (n log n; сүлжээ бүрт НЭГ удаа).
            Array.Sort(_order, start, count, new KeyComparer(key));
            int half = count / 2;

            int l = BuildNode(start, half, cx, cy, cz);
            int r = BuildNode(start + half, count - half, cx, cy, cz);
            _left[node] = l; _right[node] = r; _start[node] = 0; _count[node] = 0;
            return node;
        }

        private sealed class KeyComparer : IComparer<int>
        {
            private readonly double[] _k;
            public KeyComparer(double[] k) { _k = k; }
            public int Compare(int a, int b) { return _k[a].CompareTo(_k[b]); }
        }

        private void Grow()
        {
            int cap = _left.Length * 2;
            Array.Resize(ref _min, cap * 3); Array.Resize(ref _max, cap * 3);
            Array.Resize(ref _left, cap); Array.Resize(ref _right, cap); Array.Resize(ref _start, cap); Array.Resize(ref _count, cap);
        }

        /* ============================== ХОЁР BVH-ИЙН ХОС ==================== */

        /// <summary>Хос (a-ийн гурвалжин, b-ийн гурвалжин) бүрт дуудагдана.  false буцаавал үлдсэнийг ШАЛГАХГҮЙ.</summary>
        public delegate bool PairVisitor(int triA, int triB);

        /// <summary>
        /// `a`-г `offA`-аар шилжүүлсэн үед `b`-тэй хайрцаг нь давхцах (eps-ээр тэлсэн) гурвалжингийн хосуудыг гүйнэ.  Нарийн огтлолцлыг `visit` шалгана.
        /// </summary>
        public static void OverlapPairs(SimBvh a, SimVec offA, SimBvh b, double eps, PairVisitor visit)
        {
            if (a == null || b == null || a._nodes == 0 || b._nodes == 0) return;
            var stack = new Stack<long>();
            stack.Push(0L);       // (0,0)
            while (stack.Count > 0)
            {
                long pk = stack.Pop();
                int na = (int)(pk >> 32), nb = (int)(pk & 0xFFFFFFFFL);
                if (!BoxesOverlap(a, na, offA, b, nb, eps)) continue;

                bool leafA = a._left[na] < 0, leafB = b._left[nb] < 0;
                if (leafA && leafB)
                {
                    for (int i = a._start[na]; i < a._start[na] + a._count[na]; i++)
                    {
                        int ta = a._order[i];
                        for (int j = b._start[nb]; j < b._start[nb] + b._count[nb]; j++)
                        {
                            if (!visit(ta, b._order[j])) return;
                        }
                    }
                    continue;
                }

                // Том (эсвэл навч биш) талыг задлана.
                bool splitA;
                if (leafA) splitA = false;
                else if (leafB) splitA = true;
                else splitA = Volume(a, na) >= Volume(b, nb);

                if (splitA)
                {
                    stack.Push(((long)a._left[na] << 32) | (uint)nb);
                    stack.Push(((long)a._right[na] << 32) | (uint)nb);
                }
                else
                {
                    stack.Push(((long)na << 32) | (uint)b._left[nb]);
                    stack.Push(((long)na << 32) | (uint)b._right[nb]);
                }
            }
        }

        private static double Volume(SimBvh t, int n)
        {
            double dx = t._max[n * 3] - t._min[n * 3], dy = t._max[n * 3 + 1] - t._min[n * 3 + 1], dz = t._max[n * 3 + 2] - t._min[n * 3 + 2];
            return dx * dy * dz + (dx + dy + dz);       // нимгэн (хавтгай) хайрцагт ч эерэг
        }

        private static bool BoxesOverlap(SimBvh a, int na, SimVec off, SimBvh b, int nb, double eps)
        {
            return a._min[na * 3] + off.X <= b._max[nb * 3] + eps && a._max[na * 3] + off.X >= b._min[nb * 3] - eps
                && a._min[na * 3 + 1] + off.Y <= b._max[nb * 3 + 1] + eps && a._max[na * 3 + 1] + off.Y >= b._min[nb * 3 + 1] - eps
                && a._min[na * 3 + 2] + off.Z <= b._max[nb * 3 + 2] + eps && a._max[na * 3 + 2] + off.Z >= b._min[nb * 3 + 2] - eps;
        }

        /* ============================== ЦАЦРАГ ============================== */

        /// <summary>Цацраг (`origin`+`dir`·t, t ≥ 0)-ын ХАМГИЙН ОЙР огтлолцол.  Хоёр талт гурвалжин.</summary>
        public bool RayFirst(SimVec origin, SimVec dir, out double tHit, out int triHit)
        {
            tHit = double.MaxValue; triHit = -1;
            if (_nodes == 0) return false;
            var stack = new Stack<int>();
            stack.Push(0);
            while (stack.Count > 0)
            {
                int n = stack.Pop();
                double tBox;
                if (!RayBox(origin, dir, n, tHit, out tBox)) continue;
                if (_left[n] < 0)
                {
                    for (int i = _start[n]; i < _start[n] + _count[n]; i++)
                    {
                        int t = _order[i];
                        double tt;
                        if (RayTri(origin, dir, t, out tt) && tt < tHit) { tHit = tt; triHit = t; }
                    }
                }
                else { stack.Push(_left[n]); stack.Push(_right[n]); }
            }
            return triHit >= 0;
        }

        /// <summary>Цацрагтай огтлолцсон гурвалжингийн ТОО (t &gt; 0) — «дотор нь байна» (parity) шалгалтад.  Ижил t (±eps)-ийн давхардлыг нэгтгэнэ.</summary>
        public int RayCount(SimVec origin, SimVec dir)
        {
            if (_nodes == 0) return 0;
            var ts = new List<double>();
            var stack = new Stack<int>();
            stack.Push(0);
            while (stack.Count > 0)
            {
                int n = stack.Pop();
                double tBox;
                if (!RayBox(origin, dir, n, double.MaxValue, out tBox)) continue;
                if (_left[n] < 0)
                {
                    for (int i = _start[n]; i < _start[n] + _count[n]; i++)
                    {
                        double tt;
                        if (RayTri(origin, dir, _order[i], out tt) && tt > 1e-9) ts.Add(tt);
                    }
                }
                else { stack.Push(_left[n]); stack.Push(_right[n]); }
            }
            if (ts.Count < 2) return ts.Count;
            ts.Sort();
            int count = 1;
            for (int i = 1; i < ts.Count; i++) if (ts[i] - ts[i - 1] > 1e-6) count++;      // ирмэгт тусаж хоёр гурвалжинд давхар тоологдсоныг нэг гэж үзнэ
            return count;
        }

        private bool RayBox(SimVec o, SimVec d, int n, double tMax, out double tNear)
        {
            double t0 = 0, t1 = tMax;
            tNear = 0;
            for (int ax = 0; ax < 3; ax++)
            {
                double oo = ax == 0 ? o.X : (ax == 1 ? o.Y : o.Z);
                double dd = ax == 0 ? d.X : (ax == 1 ? d.Y : d.Z);
                double lo = _min[n * 3 + ax], hi = _max[n * 3 + ax];
                if (Math.Abs(dd) < 1e-15)
                {
                    if (oo < lo || oo > hi) return false;
                    continue;
                }
                double inv = 1.0 / dd;
                double ta = (lo - oo) * inv, tb = (hi - oo) * inv;
                if (ta > tb) { double s = ta; ta = tb; tb = s; }
                if (ta > t0) t0 = ta;
                if (tb < t1) t1 = tb;
                if (t0 > t1) return false;
            }
            tNear = t0;
            return true;
        }

        private bool RayTri(SimVec o, SimVec d, int tri, out double t)
        {
            t = 0;
            int ia = _tri[tri * 3] * 3, ib = _tri[tri * 3 + 1] * 3, ic = _tri[tri * 3 + 2] * 3;
            var a = new SimVec(_xyz[ia], _xyz[ia + 1], _xyz[ia + 2]);
            SimVec e1 = new SimVec(_xyz[ib] - a.X, _xyz[ib + 1] - a.Y, _xyz[ib + 2] - a.Z);
            SimVec e2 = new SimVec(_xyz[ic] - a.X, _xyz[ic + 1] - a.Y, _xyz[ic + 2] - a.Z);
            SimVec p = d.Cross(e2);
            double det = e1.Dot(p);
            if (Math.Abs(det) < 1e-14) return false;
            double inv = 1.0 / det;
            SimVec s = o - a;
            double u = s.Dot(p) * inv;
            // Ирмэг дээр яг тусах цацраг (хоёр гурвалжны диагональ) хоёуланд нь алдагдахгүйн тулд бага зэргийн хүлцэл — хоёр гурвалжин ижил t өгөх тул RayCount нь давхардлыг нэгтгэнэ.
            const double Eps = 1e-9;
            if (u < -Eps || u > 1 + Eps) return false;
            SimVec q = s.Cross(e1);
            double v = d.Dot(q) * inv;
            if (v < -Eps || u + v > 1 + Eps) return false;
            double tt = e2.Dot(q) * inv;
            if (tt < 0) return false;
            t = tt;
            return true;
        }
    }

    /// <summary>
    /// Хоёр гурвалжингийн ЗӨВХӨН ҮНЭХЭЭР огтлолцох (хоёр тал руу `eps`-ээс илүү нэвтэрсэн) эсэх — хавтгай зэрэгцэн/ирмэгээр шүргэсэн нь огтлолцол БИШ.
    ///
    /// ЯАГААД: Revit-д хаалга нь хананы нүхэнд, хана нь шалан дээр ЦОГЦОЛСОН (шүргэсэн) байдаг — тэрийг «мөргөлдөөн» гэж гаргавал тохиолдол бүр худал дохио.
    /// Тиймээс нэг гурвалжингийн бүх орой нөгөөгийнхөө хавтгайн нэг талд (eps дотор) байвал ҮГҮЙ.
    /// </summary>
    public static class SimTri
    {
        public static bool Crossing(double[] xa, int[] ta, int ia, SimVec offA, double[] xb, int[] tb, int ib, double eps,
            out double depthMm, out SimVec p0, out SimVec p1)
        {
            depthMm = 0; p0 = default(SimVec); p1 = default(SimVec);
            SimVec a0 = V(xa, ta[ia * 3], offA), a1 = V(xa, ta[ia * 3 + 1], offA), a2 = V(xa, ta[ia * 3 + 2], offA);
            SimVec b0 = V(xb, tb[ib * 3], default(SimVec)), b1 = V(xb, tb[ib * 3 + 1], default(SimVec)), b2 = V(xb, tb[ib * 3 + 2], default(SimVec));

            SimVec n2 = (b1 - b0).Cross(b2 - b0);
            double l2 = n2.Length;
            if (l2 < 1e-9) return false;
            n2 = n2 * (1.0 / l2);
            double da0 = n2.Dot(a0 - b0), da1 = n2.Dot(a1 - b0), da2 = n2.Dot(a2 - b0);
            if (AllOneSide(da0, da1, da2, eps)) return false;

            SimVec n1 = (a1 - a0).Cross(a2 - a0);
            double l1 = n1.Length;
            if (l1 < 1e-9) return false;
            n1 = n1 * (1.0 / l1);
            double db0 = n1.Dot(b0 - a0), db1 = n1.Dot(b1 - a0), db2 = n1.Dot(b2 - a0);
            if (AllOneSide(db0, db1, db2, eps)) return false;

            SimVec dir = n1.Cross(n2);
            double dl = dir.Length;
            if (dl < 1e-4) return false;               // бараг зэрэгцээ хавтгай — шүргэлт
            dir = dir * (1.0 / dl);

            SimVec pa0, pa1, pb0, pb1;
            double sa0, sa1, sb0, sb1;
            if (!Interval(a0, a1, a2, da0, da1, da2, dir, out pa0, out pa1, out sa0, out sa1)) return false;
            if (!Interval(b0, b1, b2, db0, db1, db2, dir, out pb0, out pb1, out sb0, out sb1)) return false;

            double lo = Math.Max(sa0, sb0), hi = Math.Min(sa1, sb1);
            if (hi - lo <= 1e-3) return false;

            p0 = sa0 >= sb0 ? pa0 : pb0;
            p1 = sa1 <= sb1 ? pa1 : pb1;

            double depthA = Math.Min(MaxPos(da0, da1, da2), MaxNeg(da0, da1, da2));
            double depthB = Math.Min(MaxPos(db0, db1, db2), MaxNeg(db0, db1, db2));
            depthMm = Math.Min(depthA, depthB);
            return true;
        }

        private static SimVec V(double[] xyz, int vi, SimVec off)
        {
            int i = vi * 3;
            return new SimVec(xyz[i] + off.X, xyz[i + 1] + off.Y, xyz[i + 2] + off.Z);
        }

        private static bool AllOneSide(double d0, double d1, double d2, double eps)
        {
            if (d0 >= -eps && d1 >= -eps && d2 >= -eps) return true;
            if (d0 <= eps && d1 <= eps && d2 <= eps) return true;
            return false;
        }

        private static double MaxPos(double a, double b, double c) { return Math.Max(0, Math.Max(a, Math.Max(b, c))); }
        private static double MaxNeg(double a, double b, double c) { return Math.Max(0, Math.Max(-a, Math.Max(-b, -c))); }

        /// <summary>Гурвалжингийн хавтгайтай (нөгөө гурвалжингийн) огтлолцох ХОЁР цэг ба тэдгээрийн `dir` дагуух скаляр.</summary>
        private static bool Interval(SimVec v0, SimVec v1, SimVec v2, double d0, double d1, double d2, SimVec dir,
            out SimVec pMin, out SimVec pMax, out double sMin, out double sMax)
        {
            pMin = default(SimVec); pMax = default(SimVec); sMin = double.MaxValue; sMax = double.MinValue;
            var pts = new SimVec[3];
            int n = 0;
            Edge(v0, v1, d0, d1, pts, ref n);
            Edge(v1, v2, d1, d2, pts, ref n);
            Edge(v2, v0, d2, d0, pts, ref n);
            if (n < 2) return false;
            bool any = false;
            for (int i = 0; i < n; i++)
            {
                double s = pts[i].Dot(dir);
                if (!any || s < sMin) { sMin = s; pMin = pts[i]; }
                if (!any || s > sMax) { sMax = s; pMax = pts[i]; }
                any = true;
            }
            return true;
        }

        private static void Edge(SimVec a, SimVec b, double da, double db, SimVec[] pts, ref int n)
        {
            if (n >= 3) return;
            if (da == 0) { pts[n++] = a; return; }          // орой нь хавтгай дээр — ЗӨВХӨН энэ (орой бүр нэг л ирмэгт `a` болдог тул давхардахгүй)
            if ((da < 0 && db > 0) || (da > 0 && db < 0))
            {
                double t = da / (da - db);
                pts[n++] = a + (b - a) * t;
            }
        }
    }
}
