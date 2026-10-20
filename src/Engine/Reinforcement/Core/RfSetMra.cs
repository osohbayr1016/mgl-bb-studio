using System;
using System.Collections.Generic;
using System.Linq;

namespace RevitMcpAddin.Reinforcement.Core
{
    // ══════════════════════════════════════════════════════════════════════
    // ХАНА, ХУЧИЛТ (хавтан) дээрх арматурын ОЛОНЛОГИЙН MRA (Multi-Rebar Annotation: шошго + алхамын хэмжээс).
    //
    // Эзний дүрэм (2026-10-05): MRA-ийг ХАНА/ХУЧИЛТЫН БИШ, АРМАТУРЫН өөрөөс нь тавина — «харагдаж буй арматураас л зайг мэдэрч тавина».
    // Хэмжээсийн шугам = олонлогийн ХАМГИЙН ГАДНА арматурын цэгээс (түүний ширхэгийн төгсгөл) хэрэглэгчийн мм-ээр холдсон шугам.
    // Revit-гүй ЦЭВЭР цөм (net48-д ч эмхэтгэгдэнэ).  Бүх координат харагдацын (u, v) хавтгайд, фут.
    // ══════════════════════════════════════════════════════════════════════

    /// <summary>Харагдацад харагдаж буй нэг олонлог (≥ 2 ширхэг).</summary>
    public sealed class RfSetSample
    {
        public long Id;

        /// <summary>Ширхэг бүрийн голын шугамын төв (харагдацад) — олонлогийн тархалтын чиглэлийг тодорхойлно.</summary>
        public readonly List<RfV2> Centres = new List<RfV2>();

        /// <summary>Бүх ширхгийн голын шугамын цэгүүд (харагдацад) — олонлогийн гадна хязгаарыг тодорхойлно (ширхгийн төгсгөл ч орно).</summary>
        public readonly List<RfV2> Points = new List<RfV2>();

        /// <summary><see cref="Centres"/>-ийн ширхэг бүрийн индекс (олонлог доторх) — шошгоны дэд-элементийн лавлагаанд.  Хоосон бол 0.</summary>
        public readonly List<int> BarIndices = new List<int>();

        /// <summary>
        /// <see cref="Centres"/>-тэй зэрэгцээ: тэр ширхэг харагдацад ДҮРСЛЭГДЭЖ байгаа эсэх.  Хана/хучилтын олонлог ихэвчлэн «Middle»/«First-Last» дүрслэлтэй
        /// (1–2 ширхэг л зурагдана) ч MRA нь олонлогийг бүхэлд нь хэмждэг тул геометрт БҮХ ширхэг орно; шошгоны leader-ийг харин зурагдсан ширхэг рүү.
        /// Хоосон = бүгд харагдана.
        /// </summary>
        public readonly List<bool> Shown = new List<bool>();

        /// <summary>Арматурын голч (фут) ба харагдацын хавтгайгаас дундаж гүн (фут) — давхцал хайхад (ижил давхарга, ижил эгнээ).</summary>
        public double Diameter;
        public double Depth;

        /// <summary>Ширхэг бүр шулуун (нэг хэрчим) — үргэлжилсэн хэмжээс зөвхөн шулуун арматурт.</summary>
        public bool Straight = true;
    }

    /// <summary>Олонлогийн тусдаа шошго (MRA-аас гадна) — олонлог бүрд нэг, leader нь голын ширхэг рүү.</summary>
    public sealed class RfSetTagPlan
    {
        public long RebarId;
        public int BarIndex;
        public RfV2 Target, Head;
    }

    /// <summary>
    /// Давхцалтай (зөрүүлсэн) олонлогуудын ҮРГЭЛЖИЛСЭН хэмжээс: ширхгийн чиглэлд, олонлог бүрийн хоёр төгсгөл («A | давхцал | B»).
    /// <see cref="Pos"/> = ширхгийн чиглэл (<see cref="Dir"/>) дагуух координат; шугам нь <see cref="LineOrigin"/>-ийг дайрч <see cref="Dir"/> чиглэлтэй.
    /// </summary>
    public sealed class RfSetLapChainPlan
    {
        public RfV2 Dir;
        public RfV2 LineOrigin;
        public readonly List<double> Pos = new List<double>();
        public readonly List<long> SetId = new List<long>();

        /// <summary>true = олонлогийн «эхлэл» (Pos бага) төгсгөл, false = «төгсгөл» (Pos их).</summary>
        public readonly List<bool> IsStart = new List<bool>();
    }

    public sealed class RfSetMraOptions
    {
        /// <summary>Олонлогийн ХАМГИЙН ГАДНА арматурын цэгээс хэмжээсийн шугам хүртэл (фут, загварын).</summary>
        public double OffsetFt = 0.1;

        /// <summary>Хэмжээсийн шугамаас шошгоны хайрцаг хүртэлх харагдах зай (фут).</summary>
        public double TagGapFt = 0.02;

        /// <summary>Шошгоны хайрцгийн таамаг хэмжээ (фут) — толгойн байрлалыг шугамаас цааш тавихад.</summary>
        public double TagWidthFt = 0.15, TagHeightFt = 0.06;

        /// <summary>true = эсрэг талд (автомат тал: хэмжээс дээш/баруун тийш).</summary>
        public bool Flip = false;

        /// <summary>Тархалтын урт энэ хэмжээнээс бага олонлогийг алгасна (ширхгүүд бараг нэг цэгт — төгсгөлөөрөө харагдаж буй).</summary>
        public double MinSpreadFt = 0.01;

        /// <summary>MRA (multi rebar tag — алхам + шошго) тавих.  Шошго ба MRA ТУСДАА сонголт (2026-10-08, эзний хүсэлт).</summary>
        public bool Mra = true;

        /// <summary>Олонлог бүрд тусдаа шошго (rebar tag).  MRA-тай хамт бол MRA-ийн ЭСРЭГ талд.</summary>
        public bool Tags = false;

        /// <summary>Давхцалтай олонлогуудын үргэлжилсэн хэмжээс.</summary>
        public bool LapChain = false;

        /// <summary>Үргэлжилсэн хэмжээсийн шугам олонлогийн тархалтын захаас (фут).</summary>
        public double ChainOffsetFt = 0.1;

        /// <summary>Давхцал гэж үзэх: урт голч × [4 …] ба ≤ 6 фут; ижил давхарга = гүний зөрүү ≤ голч × 2.5; тархалтын давхцал ≥ 30 %.</summary>
        public double LapMinDiameters = 4.0, MaxLapFt = 6.0, LayerDiameters = 2.5, MinSpreadOverlap = 0.3;
    }

    public enum RfSetMraWarn
    {
        /// <summary>Олонлогийн ширхгүүд харагдацад нэг цэгт (тархалтгүй) — MRA тавигдахгүй.</summary>
        NoSpread = 0,

        /// <summary>Нэг ширхэг л харагдаж байна.</summary>
        SinglePosition,
    }

    public sealed class RfSetMraPlan
    {
        public long RebarId;

        /// <summary>Хэмжээсийн шугамын нэг цэг ба чиглэл (харагдацад, нэгж вектор) — олонлогийн тархалтын чиглэлд.</summary>
        public RfV2 LineOrigin, LineDir;

        /// <summary>Шугамаас гадагш заасан нэгж вектор (арматураас холдох тал).</summary>
        public RfV2 Outward;

        /// <summary>Шошгоны толгой.</summary>
        public RfV2 Head;

        /// <summary>Тархалтын урт (хамгийн захын хоёр ширхгийн төвийн зай).</summary>
        public double Spread;

        /// <summary>Арматурын хамгийн гадна цэгээс шугам хүртэлх бодит зай — ХЭРЭГЛЭГЧИЙН оруулсан зай (тест, шалгалт).</summary>
        public double DistanceFromRebar;
    }

    public sealed class RfSetMraWarning
    {
        public readonly long Id;
        public readonly RfSetMraWarn Code;

        public RfSetMraWarning(long id, RfSetMraWarn code)
        {
            Id = id;
            Code = code;
        }
    }

    public sealed class RfSetMraResult
    {
        public readonly List<RfSetMraPlan> Plans = new List<RfSetMraPlan>();
        public readonly List<RfSetTagPlan> Tags = new List<RfSetTagPlan>();
        public readonly List<RfSetLapChainPlan> LapChains = new List<RfSetLapChainPlan>();
        public readonly List<RfSetMraWarning> Warnings = new List<RfSetMraWarning>();
    }

    public static class RfSetMraPlanner
    {
        /// <summary>
        /// Хана/хучилтын ерөнхий хэмжээсийн шугамын байрлал (2026-10-09, «Байрлал»): хостын ирмэгээс <paramref name="first"/>; тэр талд тэмдэглэгээ (MRA/шошго)
        /// хостоос цухуйж байвал тэдгээрийн захаас <paramref name="step"/>-ээр цааш — аль гаднахыг нь.  <paramref name="annEdge"/> = тэмдэглэгээний зах
        /// (тэмдэглэгээгүй бол ±∞).  <paramref name="high"/> = дээд/баруун тал (эерэг чиглэл).
        /// </summary>
        public static double OverallLine(double hostEdge, double annEdge, bool high, double first, double step)
        {
            if (high)
            {
                double l = hostEdge + first;
                return !double.IsInfinity(annEdge) && !double.IsNaN(annEdge) && annEdge > hostEdge ? Math.Max(l, annEdge + step) : l;
            }
            double lo = hostEdge - first;
            return !double.IsInfinity(annEdge) && !double.IsNaN(annEdge) && annEdge < hostEdge ? Math.Min(lo, annEdge - step) : lo;
        }

        public static RfSetMraResult Build(IEnumerable<RfSetSample> sets, RfSetMraOptions o)
        {
            var res = new RfSetMraResult();
            foreach (RfSetSample s in sets.OrderBy(x => x.Id))
            {
                if (s.Centres.Count < 2)
                {
                    res.Warnings.Add(new RfSetMraWarning(s.Id, RfSetMraWarn.SinglePosition));
                    continue;
                }

                // Тархалтын чиглэл: хоорондоо хамгийн холын хоёр ширхгийн төв.
                RfV2 a = s.Centres[0], b = s.Centres[0];
                double best = -1;
                for (int i = 0; i < s.Centres.Count; i++)
                {
                    for (int j = i + 1; j < s.Centres.Count; j++)
                    {
                        double d = (s.Centres[j] - s.Centres[i]).Length;
                        if (d > best)
                        {
                            best = d;
                            a = s.Centres[i];
                            b = s.Centres[j];
                        }
                    }
                }
                if (!(best > o.MinSpreadFt))
                {
                    res.Warnings.Add(new RfSetMraWarning(s.Id, RfSetMraWarn.NoSpread));
                    continue;
                }
                RfV2 dir = (b - a).Normalized();
                // Тогтвортой чиглэл (ажиллуулалт бүрд ижил): u нэмэгдэх, тэнцүү бол v нэмэгдэх.
                if (dir.X < -1e-9 || (Math.Abs(dir.X) <= 1e-9 && dir.Y < 0)) dir = -dir;

                // Гадагш тал: тархалтын чиглэлд перпендикуляр, AUTO = дээш (v+), хэвтээ бол баруун (u+); Flip = эсрэг.
                RfV2 n = dir.Perp();
                if (n.Y < -1e-9 || (Math.Abs(n.Y) <= 1e-9 && n.X < 0)) n = -n;
                if (o.Flip) n = -n;

                // Олонлогийн ХАМГИЙН ГАДНА цэг (энэ талд): ширхгийн төгсгөл ч орно.  Шугам тэндээс хэрэглэгчийн зайд.
                double maxN = double.MinValue;
                foreach (RfV2 p in s.Points.Count > 0 ? s.Points : s.Centres) maxN = Math.Max(maxN, p.Dot(n));
                foreach (RfV2 p in s.Centres) maxN = Math.Max(maxN, p.Dot(n));
                double linePos = maxN + o.OffsetFt;

                RfV2 mid = (a + b) * 0.5;
                RfV2 origin = mid + n * (linePos - mid.Dot(n));

                // Шошгоны хайрцгийн n чиглэлийн хагас хэмжээ (хэвтээ хайрцаг).
                double half = Math.Abs(n.X) * o.TagWidthFt / 2 + Math.Abs(n.Y) * o.TagHeightFt / 2;
                RfV2 head = origin + n * (o.TagGapFt + half);

                if (o.Mra)
                {
                    res.Plans.Add(new RfSetMraPlan
                    {
                        RebarId = s.Id,
                        LineOrigin = origin,
                        LineDir = dir,
                        Outward = n,
                        Head = head,
                        Spread = best,
                        DistanceFromRebar = linePos - maxN,
                    });
                }

                if (o.Tags)
                    res.Tags.Add(TagFor(s, dir, o.Mra ? -n : n, mid, o, half));
            }
            if (o.LapChain)
                res.LapChains.AddRange(LapChains(sets, o));
            return res;
        }

        /// <summary>
        /// Олонлогийн тусдаа шошго: leader голын ширхэг рүү (ширхгийн <paramref name="side"/> талын төгсгөлөөс 15 %-иар дотогш), толгой олонлогийн тэр талын
        /// хамгийн гадна цэгээс <see cref="RfSetMraOptions.OffsetFt"/> + шошгоны зайгаар цааш, голын ширхгийн тархалтын координатад.
        /// </summary>
        private static RfSetTagPlan TagFor(RfSetSample s, RfV2 dir, RfV2 side, RfV2 mid, RfSetMraOptions o, double half)
        {
            int k = 0;
            double bestD = double.MaxValue;
            bool onlyShown = s.Shown.Count == s.Centres.Count && s.Shown.Any(x => x);
            for (int i = 0; i < s.Centres.Count; i++)
            {
                if (onlyShown && !s.Shown[i]) continue;
                double d = Math.Abs((s.Centres[i] - mid).Dot(dir));
                if (d < bestD) { bestD = d; k = i; }
            }
            RfV2 c = s.Centres[k];
            double lo = double.MaxValue, hi = double.MinValue;
            foreach (RfV2 p in s.Points.Count > 0 ? s.Points : s.Centres)
            {
                double t = p.Dot(side);
                if (t < lo) lo = t;
                if (t > hi) hi = t;
            }
            double cs = c.Dot(side);
            double targetS = hi - 0.15 * (hi - lo);
            if (targetS < cs) targetS = cs;
            RfV2 target = c + side * (targetS - cs);
            RfV2 head = c + side * (hi + o.OffsetFt + o.TagGapFt + half - cs);
            return new RfSetTagPlan
            {
                RebarId = s.Id,
                BarIndex = k < s.BarIndices.Count ? s.BarIndices[k] : 0,
                Target = target,
                Head = head,
            };
        }

        /// <summary>Олонлогийн ширхгийн чиглэл (нэгж, тогтмол тэмдэгтэй), тархалтын чиглэл, мужууд.</summary>
        private sealed class SetGeom
        {
            public RfSetSample S;
            public RfV2 Bar, Spread;
            public double S0, S1, P0, P1;
        }

        private static SetGeom GeomOf(RfSetSample s)
        {
            if (s.Centres.Count < 2 || !s.Straight || !(s.Diameter > 0)) return null;
            RfV2 a = s.Centres[0], b = s.Centres[0];
            double best = -1;
            for (int i = 0; i < s.Centres.Count; i++)
                for (int j = i + 1; j < s.Centres.Count; j++)
                {
                    double d = (s.Centres[j] - s.Centres[i]).Length;
                    if (d > best) { best = d; a = s.Centres[i]; b = s.Centres[j]; }
                }
            if (!(best > RfTol.PointFt)) return null;
            RfV2 spread = (b - a).Normalized();
            RfV2 bar = spread.Perp();
            if (bar.X < -1e-9 || (Math.Abs(bar.X) <= 1e-9 && bar.Y < 0)) bar = -bar;
            if (spread.Dot(bar.Perp()) < 0) spread = -spread; // (bar, spread) баруун гарын тогтмол хос
            var g = new SetGeom { S = s, Bar = bar, Spread = spread, S0 = double.MaxValue, S1 = double.MinValue, P0 = double.MaxValue, P1 = double.MinValue };
            foreach (RfV2 p in s.Points)
            {
                double t = p.Dot(bar);
                if (t < g.S0) g.S0 = t;
                if (t > g.S1) g.S1 = t;
            }
            foreach (RfV2 p in s.Centres)
            {
                double t = p.Dot(spread);
                if (t < g.P0) g.P0 = t;
                if (t > g.P1) g.P1 = t;
            }
            return g.S1 > g.S0 ? g : null;
        }

        /// <summary>
        /// Давхцал: ширхгийн чиглэл ижил, ижил давхарга (гүн ойр), тархалт давхцсан, ширхгийн чиглэлд хэсэгчлэн давхарласан (A.S0 &lt; B.S0 &lt; A.S1 &lt; B.S1),
        /// давхцлын урт голч × 4 … 6 фут.  Холбогдсон олонлогууд нэг гинж: олонлог бүрийн хоёр төгсгөл, 1 мм-ээс ойр давхардалгүй, ≥ 3 лавлагаа.
        /// Шугам ширхгийн чиглэлд, бүлгийн тархалтын доод захаас <see cref="RfSetMraOptions.ChainOffsetFt"/>-ээр гадагш.
        /// </summary>
        internal static List<RfSetLapChainPlan> LapChains(IEnumerable<RfSetSample> sets, RfSetMraOptions o)
        {
            var res = new List<RfSetLapChainPlan>();
            List<SetGeom> gs = sets.Select(GeomOf).Where(g => g != null).OrderBy(g => g.S.Id).ToList();
            int n = gs.Count;
            var parent = new int[n];
            for (int i = 0; i < n; i++) parent[i] = i;
            Func<int, int> find = null;
            find = x => parent[x] == x ? x : (parent[x] = find(parent[x]));
            var linked = new bool[n];
            for (int i = 0; i < n; i++)
            {
                for (int j = 0; j < n; j++)
                {
                    if (i == j) continue;
                    SetGeom a = gs[i], b = gs[j];
                    if (Math.Abs(a.Bar.Dot(b.Bar)) < 0.999) continue;
                    double dia = Math.Max(a.S.Diameter, b.S.Diameter);
                    if (Math.Abs(a.S.Depth - b.S.Depth) > dia * o.LayerDiameters + RfTol.MmToFt(1)) continue;
                    double ov = Math.Min(a.P1, b.P1) - Math.Max(a.P0, b.P0);
                    double small = Math.Min(a.P1 - a.P0, b.P1 - b.P0);
                    if (ov < o.MinSpreadOverlap * small) continue;
                    if (!(a.S0 < b.S0 - RfTol.PointFt && b.S0 < a.S1 - RfTol.PointFt && a.S1 < b.S1 - RfTol.PointFt)) continue;
                    double len = a.S1 - b.S0;
                    if (len > o.MaxLapFt || len < Math.Min(a.S.Diameter, b.S.Diameter) * o.LapMinDiameters) continue;
                    linked[i] = linked[j] = true;
                    int ra = find(i), rb = find(j);
                    if (ra != rb) parent[Math.Max(ra, rb)] = Math.Min(ra, rb);
                }
            }
            double tol = RfTol.MmToFt(1);
            foreach (IGrouping<int, int> grp in Enumerable.Range(0, n).Where(i => linked[i]).GroupBy(i => find(i)).OrderBy(x => x.Key))
            {
                SetGeom first = gs[grp.Key];
                var pts = new List<Tuple<double, long, bool>>();
                double p0 = double.MaxValue;
                foreach (int i in grp)
                {
                    pts.Add(Tuple.Create(gs[i].S0, gs[i].S.Id, true));
                    pts.Add(Tuple.Create(gs[i].S1, gs[i].S.Id, false));
                    p0 = Math.Min(p0, gs[i].P0);
                }
                var plan = new RfSetLapChainPlan { Dir = first.Bar };
                foreach (Tuple<double, long, bool> p in pts.OrderBy(x => x.Item1).ThenBy(x => x.Item2))
                {
                    if (plan.Pos.Count > 0 && p.Item1 - plan.Pos[plan.Pos.Count - 1] < tol) continue;
                    plan.Pos.Add(p.Item1);
                    plan.SetId.Add(p.Item2);
                    plan.IsStart.Add(p.Item3);
                }
                if (plan.Pos.Count < 3) continue;
                plan.LineOrigin = first.Spread * (p0 - o.ChainOffsetFt);
                res.Add(plan);
            }
            return res;
        }
    }
}
