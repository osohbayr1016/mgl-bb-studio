using System;
using System.Collections.Generic;

namespace RevitMcpAddin.ChangeImpact.Core
{
    /// <summary>
    /// «Simulation» (хулганаар чирж зөөх 3D харагдац)-ийн ЦЭВЭР геометр — Revit/WPF-гүй, тестлэгдэнэ.
    /// Бүх урт ММ-ээр, баруун гарын Z-дээш координатад (Revit-тэй ижил).  Revit-ийн feet → мм хөрвүүлэлтийг Revit давхарга хийнэ.
    /// </summary>
    public struct SimVec
    {
        public double X, Y, Z;

        public SimVec(double x, double y, double z) { X = x; Y = y; Z = z; }

        public static SimVec operator +(SimVec a, SimVec b) { return new SimVec(a.X + b.X, a.Y + b.Y, a.Z + b.Z); }
        public static SimVec operator -(SimVec a, SimVec b) { return new SimVec(a.X - b.X, a.Y - b.Y, a.Z - b.Z); }
        public static SimVec operator *(SimVec a, double s) { return new SimVec(a.X * s, a.Y * s, a.Z * s); }
        public static SimVec operator -(SimVec a) { return new SimVec(-a.X, -a.Y, -a.Z); }

        public double Dot(SimVec b) { return X * b.X + Y * b.Y + Z * b.Z; }
        public SimVec Cross(SimVec b) { return new SimVec(Y * b.Z - Z * b.Y, Z * b.X - X * b.Z, X * b.Y - Y * b.X); }
        public double LengthSq { get { return X * X + Y * Y + Z * Z; } }
        public double Length { get { return Math.Sqrt(LengthSq); } }

        public SimVec Normalized()
        {
            double l = Length;
            return l < 1e-12 ? new SimVec(0, 0, 0) : new SimVec(X / l, Y / l, Z / l);
        }

        public bool IsFinite { get { return !(double.IsNaN(X) || double.IsNaN(Y) || double.IsNaN(Z) || double.IsInfinity(X) || double.IsInfinity(Y) || double.IsInfinity(Z)); } }

        public override string ToString() { return "(" + X.ToString("0.##") + ", " + Y.ToString("0.##") + ", " + Z.ToString("0.##") + ")"; }
    }

    /// <summary>Тэнхлэгт зэрэгцээ хайрцаг (мм).  `Empty` үед `IsEmpty`.</summary>
    public struct SimBox
    {
        public double MinX, MinY, MinZ, MaxX, MaxY, MaxZ;

        public static SimBox Empty()
        {
            return new SimBox
            {
                MinX = double.MaxValue, MinY = double.MaxValue, MinZ = double.MaxValue,
                MaxX = double.MinValue, MaxY = double.MinValue, MaxZ = double.MinValue,
            };
        }

        public bool IsEmpty { get { return MinX > MaxX || MinY > MaxY || MinZ > MaxZ; } }

        public void Add(double x, double y, double z)
        {
            if (x < MinX) MinX = x; if (x > MaxX) MaxX = x;
            if (y < MinY) MinY = y; if (y > MaxY) MaxY = y;
            if (z < MinZ) MinZ = z; if (z > MaxZ) MaxZ = z;
        }

        public void Add(SimBox b)
        {
            if (b.IsEmpty) return;
            Add(b.MinX, b.MinY, b.MinZ);
            Add(b.MaxX, b.MaxY, b.MaxZ);
        }

        public SimBox Translated(SimVec d)
        {
            if (IsEmpty) return this;
            return new SimBox { MinX = MinX + d.X, MinY = MinY + d.Y, MinZ = MinZ + d.Z, MaxX = MaxX + d.X, MaxY = MaxY + d.Y, MaxZ = MaxZ + d.Z };
        }

        public SimBox Expanded(double e)
        {
            if (IsEmpty) return this;
            return new SimBox { MinX = MinX - e, MinY = MinY - e, MinZ = MinZ - e, MaxX = MaxX + e, MaxY = MaxY + e, MaxZ = MaxZ + e };
        }

        public bool Overlaps(SimBox o, double eps)
        {
            if (IsEmpty || o.IsEmpty) return false;
            return MinX <= o.MaxX + eps && MaxX >= o.MinX - eps
                && MinY <= o.MaxY + eps && MaxY >= o.MinY - eps
                && MinZ <= o.MaxZ + eps && MaxZ >= o.MinZ - eps;
        }

        /// <summary>`inner` бүхлээрээ энэ хайрцгийн дотор (margin-ээр багасгасан) байна уу.</summary>
        public bool Contains(SimBox inner, double margin)
        {
            if (IsEmpty || inner.IsEmpty) return false;
            return inner.MinX >= MinX + margin && inner.MaxX <= MaxX - margin
                && inner.MinY >= MinY + margin && inner.MaxY <= MaxY - margin
                && inner.MinZ >= MinZ + margin && inner.MaxZ <= MaxZ - margin;
        }

        public SimVec Center { get { return new SimVec((MinX + MaxX) / 2, (MinY + MaxY) / 2, (MinZ + MaxZ) / 2); } }
        public SimVec Size { get { return IsEmpty ? new SimVec(0, 0, 0) : new SimVec(MaxX - MinX, MaxY - MinY, MaxZ - MinZ); } }

        /// <summary>Хоёр хайрцгийн огтлолцол (хоосон байж болно).</summary>
        public SimBox Intersection(SimBox o)
        {
            if (IsEmpty || o.IsEmpty) return Empty();
            var r = new SimBox
            {
                MinX = Math.Max(MinX, o.MinX), MinY = Math.Max(MinY, o.MinY), MinZ = Math.Max(MinZ, o.MinZ),
                MaxX = Math.Min(MaxX, o.MaxX), MaxY = Math.Min(MaxY, o.MaxY), MaxZ = Math.Min(MaxZ, o.MaxZ),
            };
            return r.IsEmpty ? Empty() : r;
        }

        public double[] ToArray() { return new[] { MinX, MinY, MinZ, MaxX, MaxY, MaxZ }; }
    }

    /// <summary>Элементийн ангилал — өнгө, ярианы бичвэр (юуг дахин хийх) сонгоход.  Revit давхарга `BuiltInCategory`-оос хөрвүүлнэ.</summary>
    public enum SimKind
    {
        Other = 0,
        Wall,
        Floor,
        Roof,
        Ceiling,
        Door,
        Window,
        Column,
        Framing,
        Foundation,
        Stair,
        Railing,
        Furniture,
        Equipment,
        Duct,
        Pipe,
        Conduit,
        CableTray,
        Fitting,
        Lighting,
        Topography,
    }

    public enum SimRole
    {
        /// <summary>Зөөгдөж буй (хэрэглэгчийн сонгосон) элемент.</summary>
        Moving = 0,
        /// <summary>Орчны, хөдөлгөөнгүй элемент.</summary>
        Context,
    }

    /// <summary>
    /// Нэг элементийн (эсвэл түүний нэг хэсгийн) гурвалжин сүлжээ.  Оройнууд НЭГЭН ЗЭРЭГ нийлүүлэгдсэн (weld) тул хаалттай эсэхийг (`IsClosed`) шалгаж болно.
    /// Сүлжээ бичигдсэний дараа өөрчлөгдөхгүй гэж үзнэ (BVH-г нэг удаа бүтээж кэшлэнэ).
    /// </summary>
    public sealed class SimMesh
    {
        /// <summary>Тогтвортой түлхүүр: «h:123» (энэ файл) / «l2:456» (линк №2).</summary>
        public string Key { get; set; }
        public long Id { get; set; }
        /// <summary>-1 = энэ файл; ≥0 = линкийн дугаар.</summary>
        public int Slot { get; set; } = -1;
        public string Label { get; set; }
        public string CategoryName { get; set; }
        public string LinkName { get; set; }
        public SimKind Kind { get; set; }
        public SimRole Role { get; set; }
        /// <summary>Оройн координат (x,y,z) × n — ДОТООД (local) мм.</summary>
        public double[] Xyz { get; set; } = new double[0];
        /// <summary>Гурвалжин (индекс гурвалсан).</summary>
        public int[] Tri { get; set; } = new int[0];
        /// <summary>Гурвалжингийн төсвөөс болж зарим нь хасагдсан.</summary>
        public bool Truncated { get; set; }
        /// <summary>Revit энэ элементийг хөдөлгөөний үед АВТОМАТААР засна (нэгдсэн хана, join) — мөргөлдөөн нь мэдээллийн шинжтэй.</summary>
        public bool Reactive { get; set; }
        /// <summary>Зөвхөн ХАРУУЛАХ (хөдөлгөөний хост хана г.м. — нүх нь хамт хөдөлдөг тул статик геометрийн мөргөлдөөн худал) — мөргөлдөөнд оролцохгүй.</summary>
        public bool IgnoreConflicts { get; set; }
        /// <summary>Зөөгдөж буй элементэд хостлогдсон (хана дээрх хаалга г.м.) — хамт хөдөлнө.</summary>
        public bool Hosted { get; set; }

        private SimBox _bounds;
        private bool _boundsSet;
        private SimBvh _bvh;
        private bool? _closed;
        private bool _oriented;
        private int _outward = 1;
        private SimSample[] _samples;
        private readonly object _gate = new object();

        public int TriangleCount { get { return Tri.Length / 3; } }
        public int VertexCount { get { return Xyz.Length / 3; } }

        public SimBox Bounds
        {
            get
            {
                lock (_gate)
                {
                    if (!_boundsSet)
                    {
                        SimBox b = SimBox.Empty();
                        for (int i = 0; i + 2 < Xyz.Length; i += 3) b.Add(Xyz[i], Xyz[i + 1], Xyz[i + 2]);
                        _bounds = b;
                        _boundsSet = true;
                    }
                    return _bounds;
                }
            }
        }

        public SimBvh Bvh
        {
            get
            {
                lock (_gate)
                {
                    if (_bvh == null) _bvh = SimBvh.Build(Xyz, Tri);
                    return _bvh;
                }
            }
        }

        /// <summary>Хаалттай (манифолд) бие эсэх — ИРМЭГ бүр ЯГ хоёр гурвалжинд хуваалцагдсан.  Нээлттэй бол «дотор нь байна» гэж шалгахгүй.</summary>
        public bool IsClosed
        {
            get
            {
                lock (_gate)
                {
                    if (!_closed.HasValue) ComputeClosed();
                    return _closed.Value;
                }
            }
        }

        /// <summary>Гурвалжингийн эргэлт нэг чиглэлтэй (ирмэг бүр эсрэг чиглэлд ХОЁР гурвалжинд) — хаалттай биед л утгатай.</summary>
        public bool IsOriented
        {
            get
            {
                lock (_gate)
                {
                    if (!_closed.HasValue) ComputeClosed();
                    return _oriented;
                }
            }
        }

        /// <summary>+1 бол гурвалжингийн нормаль (CCW) биеийн ГАДАГШ харна, −1 бол дотогш (хаалттай, чиглэсэн биед).</summary>
        public int OutwardSign
        {
            get
            {
                lock (_gate)
                {
                    if (!_closed.HasValue) ComputeClosed();
                    return _outward;
                }
            }
        }

        private void ComputeClosed()
        {
            _closed = false; _oriented = false; _outward = 1;
            if (Tri.Length < 12 || Truncated) return;
            var und = new Dictionary<long, int>();
            var dir = new Dictionary<long, int>();
            for (int t = 0; t + 2 < Tri.Length; t += 3)
            {
                for (int k = 0; k < 3; k++)
                {
                    long a = Tri[t + k], b = Tri[t + (k + 1) % 3];
                    if (a == b) continue;
                    long lo = Math.Min(a, b), hi = Math.Max(a, b);
                    long ukey = lo * 4294967296L + hi;
                    int c;
                    und.TryGetValue(ukey, out c);
                    und[ukey] = c + 1;
                    long dkey = a * 4294967296L + b;
                    dir.TryGetValue(dkey, out c);
                    dir[dkey] = c + 1;
                }
            }
            foreach (int c in und.Values) if (c != 2) return;
            if (und.Count == 0) return;
            _closed = true;
            bool ok = true;
            foreach (int c in dir.Values) if (c != 1) { ok = false; break; }
            _oriented = ok;
            if (ok)
            {
                double vol = 0;
                for (int t = 0; t + 2 < Tri.Length; t += 3)
                {
                    int ia = Tri[t] * 3, ib = Tri[t + 1] * 3, ic = Tri[t + 2] * 3;
                    var a = new SimVec(Xyz[ia], Xyz[ia + 1], Xyz[ia + 2]);
                    var b = new SimVec(Xyz[ib], Xyz[ib + 1], Xyz[ib + 2]);
                    var c = new SimVec(Xyz[ic], Xyz[ic + 1], Xyz[ic + 2]);
                    vol += a.Dot(b.Cross(c));
                }
                _outward = vol >= 0 ? 1 : -1;
            }
        }

        /// <summary>
        /// Гурвалжингийн «дээж» — ДОТООД цэг авахад (гадаргуу огтлолцохгүй ч эзлэхүүн давхцаж байгааг олох: хоёр хана нэг шугамд, нэг нүүрэндээ зэрэгцсэн).
        /// Хамгийн том 256 гурвалжин + мөр тэнцүү алхмаар 256 хүртэл (нэг удаа бүтээнэ).
        /// </summary>
        public SimSample[] Samples
        {
            get
            {
                lock (_gate)
                {
                    if (_samples == null) _samples = BuildSamples();
                    return _samples;
                }
            }
        }

        private SimSample[] BuildSamples()
        {
            int n = TriangleCount;
            if (n == 0) return new SimSample[0];
            var all = new SimSample[n];
            var area = new double[n];
            for (int t = 0; t < n; t++)
            {
                int ia = Tri[t * 3] * 3, ib = Tri[t * 3 + 1] * 3, ic = Tri[t * 3 + 2] * 3;
                var a = new SimVec(Xyz[ia], Xyz[ia + 1], Xyz[ia + 2]);
                var b = new SimVec(Xyz[ib], Xyz[ib + 1], Xyz[ib + 2]);
                var c = new SimVec(Xyz[ic], Xyz[ic + 1], Xyz[ic + 2]);
                SimVec nrm = (b - a).Cross(c - a);
                double len = nrm.Length;
                area[t] = len;
                all[t] = new SimSample { Center = (a + b + c) * (1.0 / 3.0), Normal = len < 1e-9 ? new SimVec(0, 0, 0) : nrm * (1.0 / len) };
            }
            var chosen = new List<SimSample>();
            var order = new int[n];
            for (int i = 0; i < n; i++) order[i] = i;
            Array.Sort(order, (x, y) => area[y].CompareTo(area[x]));
            int top = Math.Min(n, 256);
            var taken = new HashSet<int>();
            for (int i = 0; i < top; i++) { taken.Add(order[i]); chosen.Add(all[order[i]]); }
            int stride = Math.Max(1, n / 256);
            for (int t = 0; t < n && chosen.Count < 512; t += stride)
                if (taken.Add(t)) chosen.Add(all[t]);
            chosen.RemoveAll(sm => sm.Normal.LengthSq < 0.5);
            return chosen.ToArray();
        }
    }

    public struct SimSample
    {
        public SimVec Center;
        public SimVec Normal;
    }

    /// <summary>
    /// Нэг простран — зөөгдөх элемент(үүд) + орчин.  Бүх координат «local» мм: <see cref="OriginMm"/> нь local (0,0,0)-ийн ДЭЛХИЙН (Revit) мм.
    /// Float-ийн нарийвчлал алдагдахгүйн тулд зөөгдөх элементийн төвд төвлөрүүлсэн.
    /// </summary>
    public sealed class SimScene
    {
        public List<SimMesh> Moving { get; set; } = new List<SimMesh>();
        public List<SimMesh> Context { get; set; } = new List<SimMesh>();
        public double[] OriginMm { get; set; } = new double[3];
        /// <summary>Хүн уншихаар: «Хаалга · Single-Flush · #123» эсвэл «3 элемент».</summary>
        public string MovingName { get; set; }
        public long PrimaryId { get; set; }
        public string PrimaryKind { get; set; }
        /// <summary>
        /// Хөдөлгөөнийг ШУГАМЫН дагуу хязгаарлах (хананд суурилсан хаалга/цонх): нэгж вектор (x,y).  null = хязгаарлалтгүй (хавтгайд чөлөөтэй).
        /// </summary>
        public double[] LineConstraintXY { get; set; }
        public string LineConstraintReason { get; set; }
        /// <summary>Орчны элемент уншигдсан хүрээ [minX..maxZ] (local мм) — энэ хүрээнээс гадуур зөөвөл «орчин уншигдаагүй» гэж сануулна.</summary>
        public double[] ContextBounds { get; set; }
        /// <summary>Хэсэг уншигдаагүй / тайрагдсан шалтгаанууд (ИЛ хэлнэ — «clash илрээгүй» ≠ «clash байхгүй»).</summary>
        public List<string> IncompleteReasons { get; set; } = new List<string>();

        public int TotalTriangles
        {
            get
            {
                int n = 0;
                foreach (SimMesh m in Moving) n += m.TriangleCount;
                foreach (SimMesh m in Context) n += m.TriangleCount;
                return n;
            }
        }

        public SimBox MovingBounds
        {
            get
            {
                SimBox b = SimBox.Empty();
                foreach (SimMesh m in Moving) b.Add(m.Bounds);
                return b;
            }
        }

        public SimBox AllBounds
        {
            get
            {
                SimBox b = MovingBounds;
                foreach (SimMesh m in Context) b.Add(m.Bounds);
                return b;
            }
        }

        public SimMesh FindContext(string key)
        {
            foreach (SimMesh m in Context) if (m.Key == key) return m;
            return null;
        }
    }

    /// <summary>
    /// Гурвалжин сүлжээ барьж оройг НЭГТГЭНЭ (weld) — тессел хийсэн нүүр бүр өөрийн оройтой гарах тул давхцсан оройг нэг болгоно.
    /// `weldMm` = нэгтгэх торын алхам (0.01 мм гэх мэт).  Гурвалжингийн төсвөөс (`maxTriangles`) хэтэрвэл `Truncated`.
    /// </summary>
    public sealed class SimMeshBuilder
    {
        private readonly List<double> _xyz = new List<double>();
        private readonly List<int> _tri = new List<int>();
        private readonly Dictionary<(long, long, long), int> _weld = new Dictionary<(long, long, long), int>();
        private readonly double _inv;
        private readonly int _maxTriangles;
        public bool Truncated { get; private set; }

        public SimMeshBuilder(double weldMm = 0.05, int maxTriangles = int.MaxValue)
        {
            _inv = weldMm > 0 ? 1.0 / weldMm : 20;
            _maxTriangles = maxTriangles;
        }

        public int TriangleCount { get { return _tri.Count / 3; } }

        private (long, long, long) Key(double x, double y, double z)
        {
            return ((long)Math.Round(x * _inv), (long)Math.Round(y * _inv), (long)Math.Round(z * _inv));
        }

        private int Vertex(double x, double y, double z)
        {
            var key = Key(x, y, z);
            int idx;
            if (_weld.TryGetValue(key, out idx)) return idx;
            idx = _xyz.Count / 3;
            _xyz.Add(x); _xyz.Add(y); _xyz.Add(z);
            _weld[key] = idx;
            return idx;
        }

        /// <summary>Нэг гурвалжин нэмнэ.  Доройтсон (талбай ≈ 0 / давхцсан орой) гурвалжинг алгасна.  false = төсөв дүүрсэн.</summary>
        public bool AddTriangle(double ax, double ay, double az, double bx, double by, double bz, double cx, double cy, double cz)
        {
            if (TriangleCount >= _maxTriangles) { Truncated = true; return false; }
            // Доройтсон (давхцсан орой) гурвалжинг ОРОЙ НЭМЭХЭЭС ӨМНӨ алгасна — өнчин орой үлдээхгүй.
            var ka = Key(ax, ay, az); var kb = Key(bx, by, bz); var kc = Key(cx, cy, cz);
            if (ka.Equals(kb) || kb.Equals(kc) || ka.Equals(kc)) return true;
            int a = Vertex(ax, ay, az), b = Vertex(bx, by, bz), c = Vertex(cx, cy, cz);
            _tri.Add(a); _tri.Add(b); _tri.Add(c);
            return true;
        }

        public void Fill(SimMesh mesh)
        {
            mesh.Xyz = _xyz.ToArray();
            mesh.Tri = _tri.ToArray();
            mesh.Truncated = Truncated;
        }

        /// <summary>Хайрцаг (12 гурвалжин) — туршилт, түр орлуулагчид.</summary>
        public static SimMesh Box(string key, double minX, double minY, double minZ, double maxX, double maxY, double maxZ, SimRole role = SimRole.Context, SimKind kind = SimKind.Other)
        {
            var b = new SimMeshBuilder(0.001);
            double[][] v =
            {
                new[] { minX, minY, minZ }, new[] { maxX, minY, minZ }, new[] { maxX, maxY, minZ }, new[] { minX, maxY, minZ },
                new[] { minX, minY, maxZ }, new[] { maxX, minY, maxZ }, new[] { maxX, maxY, maxZ }, new[] { minX, maxY, maxZ },
            };
            // Гадагш харсан (CCW) нүүр бүр 2 гурвалжин.
            int[][] quads = { new[] { 0, 3, 2, 1 }, new[] { 4, 5, 6, 7 }, new[] { 0, 1, 5, 4 }, new[] { 1, 2, 6, 5 }, new[] { 2, 3, 7, 6 }, new[] { 3, 0, 4, 7 } };
            foreach (int[] q in quads)
            {
                double[] p0 = v[q[0]], p1 = v[q[1]], p2 = v[q[2]], p3 = v[q[3]];
                b.AddTriangle(p0[0], p0[1], p0[2], p1[0], p1[1], p1[2], p2[0], p2[1], p2[2]);
                b.AddTriangle(p0[0], p0[1], p0[2], p2[0], p2[1], p2[2], p3[0], p3[1], p3[2]);
            }
            var m = new SimMesh { Key = key, Role = role, Kind = kind, Label = key };
            b.Fill(m);
            return m;
        }
    }
}
