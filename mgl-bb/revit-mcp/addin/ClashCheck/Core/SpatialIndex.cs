using System;
using System.Collections.Generic;
using System.Linq;

namespace RevitMcpAddin.ClashCheck.Core
{
    /// <summary>
    /// Тэнхлэгтэй зэрэгцээ хайрцаг (AABB), ММ-ЭЭР, host координатад.  Revit-гүй ЦЭВЭР өгөгдөл:
    /// Revit-ээс bbox-ийг нэг удаа хуулсны дараа бүх нэр дэвшигч бодит (O(n²)-гүй) тооцоо энд.
    /// </summary>
    public struct Aabb
    {
        public double MinX, MinY, MinZ, MaxX, MaxY, MaxZ;

        public Aabb(double minX, double minY, double minZ, double maxX, double maxY, double maxZ)
        {
            MinX = minX; MinY = minY; MinZ = minZ; MaxX = maxX; MaxY = maxY; MaxZ = maxZ;
        }

        public bool IsValid
        {
            get
            {
                return MaxX >= MinX && MaxY >= MinY && MaxZ >= MinZ
                    && !double.IsNaN(MinX + MinY + MinZ + MaxX + MaxY + MaxZ)
                    && !double.IsInfinity(MinX + MinY + MinZ + MaxX + MaxY + MaxZ);
            }
        }

        public double MaxExtent
        {
            get { return Math.Max(MaxX - MinX, Math.Max(MaxY - MinY, MaxZ - MinZ)); }
        }

        /// <summary>`inflate` (мм) нэмж тэлээд давхцаж байна уу.  Хил хүрэлцсэн (тэнцүү) = давхцсан.</summary>
        public bool Overlaps(ref Aabb o, double inflate)
        {
            return MinX - inflate <= o.MaxX && MaxX + inflate >= o.MinX
                && MinY - inflate <= o.MaxY && MaxY + inflate >= o.MinY
                && MinZ - inflate <= o.MaxZ && MaxZ + inflate >= o.MinZ;
        }

        public static Aabb Union(Aabb a, Aabb b)
        {
            return new Aabb(Math.Min(a.MinX, b.MinX), Math.Min(a.MinY, b.MinY), Math.Min(a.MinZ, b.MinZ),
                            Math.Max(a.MaxX, b.MaxX), Math.Max(a.MaxY, b.MaxY), Math.Max(a.MaxZ, b.MaxZ));
        }

        /// <summary>Хоёр хайрцагийн ХУРААЛТ (огтлолцол).  Давхцахгүй бол `IsValid == false`.</summary>
        public static Aabb Intersection(Aabb a, Aabb b)
        {
            return new Aabb(Math.Max(a.MinX, b.MinX), Math.Max(a.MinY, b.MinY), Math.Max(a.MinZ, b.MinZ),
                            Math.Min(a.MaxX, b.MaxX), Math.Min(a.MaxY, b.MaxY), Math.Min(a.MaxZ, b.MaxZ));
        }

        public double[] ToArray() { return new[] { MinX, MinY, MinZ, MaxX, MaxY, MaxZ }; }

        public double[] Center() { return new[] { (MinX + MaxX) / 2, (MinY + MaxY) / 2, (MinZ + MaxZ) / 2 }; }
    }

    /// <summary>
    /// A ба B жагсаалтын БОЛОМЖИТ огтлолцох хосыг (bbox давхцал) олно — O(n·m) БИШ, ТОР (spatial hash)-оор.
    ///
    /// Алгоритм:
    ///   1. B-г тор (cell) руу хэвтүүлнэ.  Нүдний хэмжээ = B-ийн хамгийн урт хэмжээсийн медианыг 2-оор
    ///      үржүүлсэн (0.5 м ... 20 м) — хэвийн элемент 1–8 нүдэнд л орно.
    ///   2. A бүрийн (тэлсэн) хайрцагтай давхцах нүднүүдийн B-г л шалгана, `stamp`-аар давхардлыг хасна.
    ///   3. ӨНДӨР УРТ элемент (хэт олон нүд хамарсан, жишээ нь 80 м хоолой) тусдаа `big` жагсаалтад:
    ///      A бүр тэднийг шугаман шалгана; өөрөө big байсан A нь бүх B-тэй шууд харьцуулагдана.
    ///   4. Хос нь багц болгон гарна (`Step`) — дуудагч Revit-ийн хугацааны хэсэгт тааруулж цуцлах боломжтой.
    ///
    /// Хамгаалалт: хос `maxPairs`-аас хэтэрвэл `Overflow` (дүрэм хэт өргөн — бүх зүйл бүх зүйлтэй давхцаж байна);
    /// санах ой тэсрэхгүй.
    ///
    /// `symmetric` үед A ба B нь ИЖИЛ жагсаалт: хос нэг л удаа (b &gt; a), өөртэйгөө биш.
    /// </summary>
    public sealed class CandidateGenerator
    {
        /// <summary>
        /// Нэг элемент хамгийн ихдээ хэдэн нүдэнд бүртгэгдэх (6×6×6).  Хэтэрвэл `big` жагсаалт (шугаман шалгана).  Өмнө нь 1024 (10×10×10)
        /// байсан нь том, урт элементтэй загварт 400k элемент × 1000 нүд = олон зуун сая бичлэг (санах ой тэсрэх) болох эрсдэлтэй байв.
        /// </summary>
        public const int MaxCellsPerItem = 216;
        /// <summary>Торд нийт бичлэгийн дээд хязгаар — хэтэрвэл үлдсэн элементүүд `big` руу (санах ойг хязгаарлана).</summary>
        public const long MaxGridEntries = 8000000;
        private const int Offset = 1 << 20;

        private readonly Aabb[] _a;
        private readonly Aabb[] _b;
        private readonly bool _symmetric;
        private readonly double _inflate;
        private readonly int _maxPairs;
        private readonly long _maxGridEntries;

        private Dictionary<long, List<int>> _grid;
        private List<int> _big;
        private double _cell;
        private int[] _stamp;
        private int _gen;
        private bool _built;
        private long _entries;

        public List<long> Pairs { get; private set; }
        public bool Overflow { get; private set; }
        /// <summary>Дараагийн боловсруулах A-ийн индекс.</summary>
        public int NextA { get; private set; }
        public int BigCount { get { return _big == null ? 0 : _big.Count; } }
        public double CellSize { get { return _cell; } }
        public bool IsDone { get { return Overflow || NextA >= _a.Length; } }

        /// <param name="maxGridEntries">Торд нийт бичлэгийн дээд хязгаар (өгөгдмөл `MaxGridEntries`; тестэд бага тавьж `big` руу унах замыг шалгана).</param>
        public CandidateGenerator(IReadOnlyList<Aabb> a, IReadOnlyList<Aabb> b, bool symmetric, double inflateMm, int maxPairs, long maxGridEntries = MaxGridEntries)
        {
            _a = a.ToArray();
            _b = symmetric ? _a : b.ToArray();
            _symmetric = symmetric;
            _inflate = Math.Max(0, inflateMm);
            _maxPairs = Math.Max(1, maxPairs);
            _maxGridEntries = Math.Max(0, maxGridEntries);
            Pairs = new List<long>();
        }

        public static int PairA(long packed) { return (int)(packed >> 32); }
        public static int PairB(long packed) { return (int)(packed & 0xFFFFFFFFL); }
        private static long Pack(int a, int b) { return ((long)a << 32) | (uint)b; }

        public void BuildIndex()
        {
            if (_built) return;
            _built = true;
            _grid = new Dictionary<long, List<int>>();
            _big = new List<int>();
            _stamp = new int[_b.Length];
            _cell = ChooseCell();

            for (int i = 0; i < _b.Length; i++)
            {
                if (!_b[i].IsValid) continue;
                int x0, x1, y0, y1, z0, z1;
                if (!CellRange(ref _b[i], 0, out x0, out x1, out y0, out y1, out z0, out z1)) { _big.Add(i); continue; }
                long cells = (long)(x1 - x0 + 1) * (y1 - y0 + 1) * (z1 - z0 + 1);
                if (_entries + cells > _maxGridEntries) { _big.Add(i); continue; }     // санах ойн төсөв дууссан
                _entries += cells;
                for (int x = x0; x <= x1; x++)
                    for (int y = y0; y <= y1; y++)
                        for (int z = z0; z <= z1; z++)
                        {
                            long key = Key(x, y, z);
                            List<int> list;
                            if (!_grid.TryGetValue(key, out list)) { list = new List<int>(4); _grid[key] = list; }
                            list.Add(i);
                        }
            }
        }

        private double ChooseCell()
        {
            if (_b.Length == 0) return 1000;
            int n = _b.Length;
            int step = Math.Max(1, n / 20000);
            var ext = new List<double>(Math.Min(n, 20000));
            for (int i = 0; i < n; i += step)
                if (_b[i].IsValid) ext.Add(_b[i].MaxExtent);
            if (ext.Count == 0) return 1000;
            ext.Sort();
            double median = ext[ext.Count / 2];
            return Math.Min(20000, Math.Max(500, median * 2 + _inflate));
        }

        private bool CellRange(ref Aabb box, double inflate, out int x0, out int x1, out int y0, out int y1, out int z0, out int z1)
        {
            x0 = Cell(box.MinX - inflate); x1 = Cell(box.MaxX + inflate);
            y0 = Cell(box.MinY - inflate); y1 = Cell(box.MaxY + inflate);
            z0 = Cell(box.MinZ - inflate); z1 = Cell(box.MaxZ + inflate);
            long count = (long)(x1 - x0 + 1) * (y1 - y0 + 1) * (z1 - z0 + 1);
            if (count > MaxCellsPerItem || count <= 0) return false;
            if (Math.Abs(x0) >= Offset || Math.Abs(x1) >= Offset || Math.Abs(y0) >= Offset || Math.Abs(y1) >= Offset || Math.Abs(z0) >= Offset || Math.Abs(z1) >= Offset) return false;
            return true;
        }

        private int Cell(double v)
        {
            double c = Math.Floor(v / _cell);
            if (c > int.MaxValue / 2) return int.MaxValue / 2;
            if (c < int.MinValue / 2) return int.MinValue / 2;
            return (int)c;
        }

        private static long Key(int x, int y, int z)
        {
            return ((long)(x + Offset) << 42) | ((long)(y + Offset) << 21) | (long)(z + Offset);
        }

        /// <summary>
        /// A-ийн дараагийн `maxItems` элементийг боловсруулна.  true = ДУУССАН (эсвэл `Overflow`).
        /// </summary>
        public bool Step(int maxItems)
        {
            if (!_built) BuildIndex();
            int end = (int)Math.Min((long)_a.Length, (long)NextA + Math.Max(1, maxItems));
            for (; NextA < end; NextA++)
            {
                if (Overflow) return true;
                QueryOne(NextA);
            }
            return IsDone;
        }

        private void QueryOne(int ai)
        {
            if (!_a[ai].IsValid) return;
            _gen++;
            int x0, x1, y0, y1, z0, z1;
            if (!CellRange(ref _a[ai], _inflate, out x0, out x1, out y0, out y1, out z0, out z1))
            {
                // A өөрөө хэт том — бүх B-тэй шууд (цөөн л ийм элемент байх ёстой).
                for (int b = 0; b < _b.Length; b++) Consider(ai, b);
                return;
            }

            for (int x = x0; x <= x1; x++)
                for (int y = y0; y <= y1; y++)
                    for (int z = z0; z <= z1; z++)
                    {
                        List<int> list;
                        if (!_grid.TryGetValue(Key(x, y, z), out list)) continue;
                        for (int k = 0; k < list.Count; k++) Consider(ai, list[k]);
                        if (Overflow) return;
                    }
            for (int k = 0; k < _big.Count; k++) Consider(ai, _big[k]);
        }

        private void Consider(int ai, int bi)
        {
            if (_stamp[bi] == _gen) return;
            _stamp[bi] = _gen;
            if (_symmetric && bi <= ai) return;
            if (!_b[bi].IsValid) return;
            if (!_a[ai].Overlaps(ref _b[bi], _inflate)) return;
            if (Pairs.Count >= _maxPairs) { Overflow = true; return; }
            Pairs.Add(Pack(ai, bi));
        }

        /// <summary>Бүгдийг нэг дуудлагаар (тест, жижиг багц).</summary>
        public List<long> RunAll()
        {
            BuildIndex();
            while (!Step(1 << 20)) { }
            return Pairs;
        }
    }
}
