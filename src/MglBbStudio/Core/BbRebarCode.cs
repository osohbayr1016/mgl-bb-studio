using System;
using System.Linq;

namespace MglBb.Core
{
    /// <summary>Арматурын ган (СП 52-101-2003, хүснэгт 5.8).</summary>
    public enum BbSteel { A240, A400, A500 }

    /// <summary>Хамгаалах үеийн нөхцөл (СП 52-101-2003, 8.3.2).</summary>
    public enum BbExposure
    {
        /// <summary>Хаалттай байр, хэвийн чийгшил — 20 мм.</summary>
        Indoor,
        /// <summary>Хаалттай байр, өндөр чийгшил — 25 мм.</summary>
        Humid,
        /// <summary>Гадна — 30 мм.</summary>
        Outdoor,
        /// <summary>Хөрсөнд — 40 мм.</summary>
        Ground,
    }

    /// <summary>Тоо × диаметр (жишээ нь 3Ø20).  <see cref="N"/> = 0 = арматургүй.</summary>
    public struct BbBarSpec
    {
        public int N, D;
        public BbBarSpec(int n, int d) { N = n; D = d; }
        public double Area { get { return N * BbRebarCode.Area(D); } }
        public bool Any { get { return N > 0 && D > 0; } }
        public override string ToString() { return Any ? N + "Ø" + D : "—"; }
    }

    /// <summary>
    /// БНбД 52-01 / СНиП 52-01-2003 (дэлгэрэнгүй дүрэм — СП 52-101-2003): хамгаалах үе, анкерлах / холбоосын урт, хоорондох зай, хомутын алхам,
    /// диаметрийн цуврал.  Нэгж: мм, МПа.  Бүх урт <see cref="Round"/> мм-ээр дээш бүхэлдэнэ.
    /// </summary>
    public static class BbRebarCode
    {
        /// <summary>ГОСТ 5781 / 34028-ийн стандарт диаметрүүд.</summary>
        public static readonly int[] Diameters = { 6, 8, 10, 12, 14, 16, 18, 20, 22, 25, 28, 32, 36, 40 };

        /// <summary>Бетоны ажлын нөхцлийн коэффициент γb1 (удаан хугацааны ачаалал) — Rbt-д үржинэ (нөөцтэй тал).</summary>
        public const double GammaB1 = 0.9;

        /// <summary>Гулзайлтын элементийн суналтын арматурын хамгийн бага коэффициент μmin (8.3.4).</summary>
        public const double MinRatio = 0.001;

        public const double Round = 10;

        public static double Area(int d) { return Math.PI * d * d / 4; }

        /// <summary>Суналтын тооцооны эсэргүүцэл Rs.</summary>
        public static double Rs(BbSteel s)
        {
            switch (s)
            {
                case BbSteel.A240: return 215;
                case BbSteel.A400: return 355;
                default: return 435;
            }
        }

        /// <summary>Бетоны суналтын тооцооны эсэргүүцэл Rbt (хүснэгт 5.2); «B25», «b25», «В25» (кирилл) гэх мэт.</summary>
        public static double Rbt(string concrete)
        {
            switch (ClassNumber(concrete))
            {
                case 15: return 0.75;
                case 20: return 0.90;
                case 25: return 1.05;
                case 30: return 1.15;
                case 35: return 1.30;
                case 40: return 1.40;
                case 45: return 1.50;
                case 50: return 1.60;
                default: throw new ArgumentException("Бетоны анги танигдсангүй: " + concrete);
            }
        }

        static int ClassNumber(string concrete)
        {
            string digits = new string((concrete ?? "").Where(char.IsDigit).ToArray());
            int n;
            return int.TryParse(digits, out n) ? n : 0;
        }

        /// <summary>η1: гөлгөр (A240) 1.5, халуунаар цувисан хээтэй (A400, A500) 2.5.</summary>
        static double Eta1(BbSteel s) { return s == BbSteel.A240 ? 1.5 : 2.5; }

        /// <summary>η2: d ≤ 32 — 1.0, 36…40 — 0.9.</summary>
        static double Eta2(int d) { return d <= 32 ? 1.0 : 0.9; }

        /// <summary>Анкерлах суурь урт l0,an = Rs·As / (Rbond·us) = Rs·d / (4·η1·η2·Rbt·γb1) (8.3.21).</summary>
        public static double BasicAnchorage(int d, BbSteel s, string concrete)
        {
            return Rs(s) * d / (4 * Eta1(s) * Eta2(d) * Rbt(concrete) * GammaB1);
        }

        /// <summary>
        /// Шаардлагатай анкерлах урт lan = α·l0,an·As,cal/As,ef (8.3.22): α — суналт 1.0, шахалт 0.75; ≥ 0.3·l0,an, ≥ 15d, ≥ 200 мм.
        /// </summary>
        public static double Anchorage(int d, BbSteel s, string concrete, bool tension = true, double asRatio = 1)
        {
            double l0 = BasicAnchorage(d, s, concrete);
            double a = tension ? 1.0 : 0.75;
            return CeilTo(Math.Max(Math.Max(a * l0 * asRatio, 0.3 * l0), Math.Max(15 * d, 200)), Round);
        }

        /// <summary>
        /// Давхцуулсан холбоосын урт ll = α·l0,an·As,cal/As,ef (8.3.27): α — суналт 1.2 (нэг огтлолд ≤ 50 %), 2.0 (100 %), шахалт 0.9;
        /// ≥ 0.4·α·l0,an, ≥ 20d, ≥ 250 мм.
        /// </summary>
        public static double Lap(int d, BbSteel s, string concrete, bool tension = true, bool allInOneSection = false, double asRatio = 1)
        {
            double l0 = BasicAnchorage(d, s, concrete);
            double a = tension ? (allInOneSection ? 2.0 : 1.2) : 0.9;
            return CeilTo(Math.Max(Math.Max(a * l0 * asRatio, 0.4 * a * l0), Math.Max(20 * d, 250)), Round);
        }

        /// <summary>Хамгаалах үеийн доод хэмжээ (8.3.2): ≥ d ба нөхцлийн утга.</summary>
        public static double MinCover(int d, BbExposure e)
        {
            double c = e == BbExposure.Indoor ? 20 : e == BbExposure.Humid ? 25 : e == BbExposure.Outdoor ? 30 : 40;
            return Math.Max(d, c);
        }

        /// <summary>Арматур хоорондын цэвэр зай (8.3.5): доод ≥ d ба 25 мм; дээд (бетон цутгах тал) ≥ 1.5d ба 30 мм.</summary>
        public static double MinClear(int d, bool top)
        {
            return top ? Math.Max(1.5 * d, 30) : Math.Max(d, 25);
        }

        /// <summary>Тулгуурын бүсийн хомутын хамгийн их алхам (8.3.11): ≤ 0.5·h0 ба ≤ 300 мм.</summary>
        public static double MaxStirrupSupport(double h0) { return Math.Min(0.5 * h0, 300); }

        /// <summary>Алгаслын голын хомутын хамгийн их алхам (8.3.11): ≤ 0.75·h0 ба ≤ 500 мм.</summary>
        public static double MaxStirrupMid(double h0) { return Math.Min(0.75 * h0, 500); }

        /// <summary>Холбосон каркасын хомутын хамгийн бага диаметр: ≥ 0.25·dmax, ≥ 6 мм (h &gt; 800 мм — 8 мм).</summary>
        public static int MinStirrupDiameter(int maxMainD, double h)
        {
            double need = Math.Max(maxMainD / 4.0, h > 800 ? 8 : 6);
            return Diameters.First(d => d >= need - 1e-9);
        }

        /// <summary><paramref name="w"/> өргөнд <paramref name="n"/> ширхэг Ø<paramref name="d"/> нэг эгнээнд багтах уу.</summary>
        public static bool Fits(int n, int d, double w, bool top)
        {
            return n <= 1 || n * d + (n - 1) * MinClear(d, top) <= w + 1e-6;
        }

        /// <summary>
        /// Шаардлагатай As (мм²)-д хамгийн бага талбайтай нэг эгнээний сонголт (LIRA-ийн санал): n ≥ <paramref name="minN"/>,
        /// <paramref name="w"/> = хомут доторх цэвэр өргөн.  Ижил талбайд цөөн ширхгийг сонгоно.  Багтахгүй бол N = 0.
        /// </summary>
        public static BbBarSpec PickBars(double asReq, double w, bool top, int minD = 12, int maxD = 32, int minN = 2, int maxN = 99)
        {
            BbBarSpec best = new BbBarSpec(0, 0);
            foreach (int d in Diameters.Where(x => x >= minD && x <= maxD))
            {
                int n = Math.Max(minN, (int)Math.Ceiling(asReq / Area(d) - 1e-9));
                if (n > maxN || !Fits(n, d, w, top)) continue;
                var c = new BbBarSpec(n, d);
                if (!best.Any || c.Area < best.Area - 1e-6 || (Math.Abs(c.Area - best.Area) <= 1e-6 && c.N < best.N)) best = c;
            }
            return best;
        }

        public static double CeilTo(double v, double step) { return Math.Ceiling(v / step - 1e-9) * step; }
        public static double FloorTo(double v, double step) { return Math.Floor(v / step + 1e-9) * step; }
    }
}
