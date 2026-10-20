using System;
using System.Collections.Generic;
using System.Linq;

namespace RevitMcpAddin.Reinforcement.Core
{
    /// <summary>
    /// «Арматурын урт хэмжих» хэрэгслийн нэг арматурын харагдацын 2D өгөгдөл (Revit-гүй).  Нэг арматур = ЯГ нэг ширхэг (олонлогоос дарсан цэгт хамгийн
    /// ойр харагдаж буй ширхэг) — олонлогийн бүх ширхэг ижил урттай тул нэг нь хангалттай.
    /// </summary>
    public sealed class RfLenBar
    {
        public long Id;
        public int BarIndex;

        /// <summary>Логик эхлэл ба төгсгөлийн цэг (харагдацын u, v).</summary>
        public RfV2 A, B;

        /// <summary>
        /// Эхлэл/төгсгөл дээрх БИЕЭС ГАДАГШ шүргэгчийн харагдацын тусгал (нэгжгүй байж болно — харагдацад налуу бол богино).  Эхэнд: −шүргэгч, төгсгөлд: +шүргэгч.
        /// </summary>
        public RfV2 OutA, OutB;

        /// <summary>Голч (фут) — төгсгөлийн хэрчмийн лавлагааг танихад.</summary>
        public double Diameter;
    }

    /// <summary>Хэмжээсийн нэг лавлах цэг: аль арматурын аль төгсгөл, хэмжээсийн чиглэлийн дагуух байрлал.</summary>
    public sealed class RfLenRef
    {
        public long BarId;
        public bool IsStart;

        /// <summary>Хэмжээсийн чиглэлийн дагуух байрлал (фут).</summary>
        public double S;

        /// <summary>Чиглэлд перпендикуляр байрлал (фут) — олонлогийн ижил урттай ширхгүүдээс ЭНЭ ширхгийн хэрчмийг ялгахад.</summary>
        public double N;
    }

    /// <summary>Нэг ҮРГЭЛЖИЛСЭН хэмжээс: ижил чиглэлтэй арматуруудын бүх төгсгөл, эрэмбэлсэн.</summary>
    public sealed class RfLenChain
    {
        /// <summary>Хэмжээсийн чиглэл (нэгж, харагдацын u, v).</summary>
        public RfV2 Dir;

        /// <summary>Хэмжээсийн шугамын перпендикуляр байрлал (= дарсан цэгийн <c>Dir.Perp()</c> координат).</summary>
        public double LineN;

        /// <summary>Эрэмбэлсэн лавлах цэгүүд (давхцсан ≤ <see cref="RfLengthDimPlanner.MergeTolFt"/> нь нэг болсон).</summary>
        public readonly List<RfLenRef> Refs = new List<RfLenRef>();

        /// <summary>Энэ хэмжээст орсон арматурууд (сонгосон дарааллаар).</summary>
        public readonly List<long> BarIds = new List<long>();

        /// <summary>Яг давхцаж нэг болсон төгсгөлийн тоо (ж: үзүүр үзүүрээрээ залгагдсан хоёр арматур).</summary>
        public int Merged;

        public List<double> Positions { get { return Refs.Select(r => r.S).ToList(); } }

        /// <summary>Хэмжээсийн шугамын хоёр үзүүр (харагдацын u, v).</summary>
        public RfV2 LineStart { get { return Dir * Refs[0].S + Dir.Perp() * LineN; } }
        public RfV2 LineEnd { get { return Dir * Refs[Refs.Count - 1].S + Dir.Perp() * LineN; } }
    }

    public enum RfLenSkipReason
    {
        /// <summary>Арматур харагдацад цэг болж харагдана (харагдацад перпендикуляр) — урт нь энэ харагдацад хэмжигдэхгүй.</summary>
        SeenEndOn,

        /// <summary>Хоёр үзүүр нь нэг шулууны дагуу биш (L, U, налуу дэгээ) — төгсгөлийн хэрчим хэмжээсийн чиглэлд перпендикуляр биш.</summary>
        EndsNotAligned,
    }

    public sealed class RfLenSkip
    {
        public long BarId;
        public RfLenSkipReason Reason;
    }

    public sealed class RfLenPlan
    {
        public readonly List<RfLenChain> Chains = new List<RfLenChain>();
        public readonly List<RfLenSkip> Skipped = new List<RfLenSkip>();
    }

    /// <summary>
    /// «Арматурын урт хэмжих»: сонгосон арматуруудыг ЧИГЛЭЛЭЭР нь бүлэглэж (зэрэгцээ = нэг бүлэг), бүлэг бүрт НЭГ үргэлжилсэн хэмжээс — бүх
    /// арматурын хоёр төгсгөл, чиглэлийн дагуу эрэмбэлсэн.  Ганц арматурт = түүний урт; давхцалтай (lap) арматуруудад = «урт | давхцал | урт».
    /// Хэмжээсийн шугам хэрэглэгчийн ДАРСАН цэгээр дайрна.  Revit-гүй, тесттэй (tests/Reinforcement.Tests/LengthDimTests.cs).
    /// </summary>
    public static class RfLengthDimPlanner
    {
        /// <summary>Хоёр төгсгөл энэ зайнаас ойр бол НЭГ лавлах цэг (0 урттай сегмент Revit-д алдаа).</summary>
        public const double MergeTolFt = 0.5 / RfTol.MmPerFoot;

        /// <summary>Харагдацад үүнээс богино харагдах арматур = цэг болж харагдаж байна.</summary>
        public const double MinVisibleLengthFt = 5.0 / RfTol.MmPerFoot;

        /// <summary>Үзүүрийн шүргэгч ба арматурын чиглэлийн зөвшөөрөгдөх өнцөг (3° — нугалсан/cranked багана ч өнгөрнө, L/U үгүй).</summary>
        private static readonly double AlignCos = Math.Cos(3.0 * Math.PI / 180.0);

        /// <summary>Хоёр арматур нэг бүлэгт орох чиглэлийн өнцөг (1°).</summary>
        private static readonly double GroupCos = Math.Cos(1.0 * Math.PI / 180.0);

        public static RfLenPlan Build(IList<RfLenBar> bars, RfV2 pick)
        {
            var plan = new RfLenPlan();
            if (bars == null) return plan;

            var groups = new List<KeyValuePair<RfV2, List<RfLenBar>>>();
            foreach (RfLenBar b in bars)
            {
                if (b == null) continue;
                RfV2 dir;
                RfLenSkipReason why;
                if (!AxisOf(b, out dir, out why))
                {
                    plan.Skipped.Add(new RfLenSkip { BarId = b.Id, Reason = why });
                    continue;
                }
                dir = Canonical(dir);
                int gi = groups.FindIndex(g => Math.Abs(g.Key.Dot(dir)) >= GroupCos);
                if (gi < 0) groups.Add(new KeyValuePair<RfV2, List<RfLenBar>>(dir, new List<RfLenBar> { b }));
                else groups[gi].Value.Add(b);
            }

            foreach (KeyValuePair<RfV2, List<RfLenBar>> g in groups)
            {
                RfV2 d = g.Key, n = d.Perp();
                var chain = new RfLenChain { Dir = d, LineN = pick.Dot(n) };
                var all = new List<RfLenRef>();
                foreach (RfLenBar b in g.Value)
                {
                    if (!chain.BarIds.Contains(b.Id)) chain.BarIds.Add(b.Id);
                    all.Add(new RfLenRef { BarId = b.Id, IsStart = true, S = b.A.Dot(d), N = b.A.Dot(n) });
                    all.Add(new RfLenRef { BarId = b.Id, IsStart = false, S = b.B.Dot(d), N = b.B.Dot(n) });
                }
                foreach (RfLenRef r in all.OrderBy(r => r.S).ThenBy(r => r.BarId).ThenBy(r => r.IsStart ? 0 : 1))
                {
                    if (chain.Refs.Count > 0 && r.S - chain.Refs[chain.Refs.Count - 1].S <= MergeTolFt)
                    {
                        chain.Merged++;
                        continue;
                    }
                    chain.Refs.Add(r);
                }
                // Бүлэг бүр дор хаяж нэг арматуртай, арматур бүр ≥ MinVisibleLength тул ≥ 2 цэг байна.
                if (chain.Refs.Count >= 2) plan.Chains.Add(chain);
            }
            return plan;
        }

        /// <summary>
        /// Арматурын тэнхлэгийн чиглэл = төгсгөлийн гадагш шүргэгч ба эхлэлийн дотогш шүргэгчийн дундаж.  Хоёр үзүүр нь энэ чиглэлтэй ≤ 3° байх ёстой
        /// (тэгэхгүй бол төгсгөлийн хэрчим хэмжээсийн чиглэлд перпендикуляр биш — Revit хэмжээс тавьж чадахгүй / буруу утга).
        /// </summary>
        internal static bool AxisOf(RfLenBar b, out RfV2 dir, out RfLenSkipReason why)
        {
            dir = new RfV2(0, 0);
            why = RfLenSkipReason.SeenEndOn;
            if ((b.B - b.A).Length < MinVisibleLengthFt) return false;
            RfV2 oa = b.OutA.Normalized(), ob = b.OutB.Normalized();
            // Шүргэгч харагдацын хавтгайд бараг перпендикуляр (тусгал нь богино) бол үзүүрийн хэрчим харагдацад хэвтэхгүй.
            if (b.OutA.Length < 0.5 || b.OutB.Length < 0.5)
            {
                why = RfLenSkipReason.EndsNotAligned;
                return false;
            }
            RfV2 axis = (ob - oa).Normalized();
            if (axis.Length < 0.5 || ob.Dot(axis) < AlignCos || -oa.Dot(axis) < AlignCos)
            {
                why = RfLenSkipReason.EndsNotAligned;
                return false;
            }
            // Эхлэлээс төгсгөл рүү ахих ёстой (U хэлбэр биш).
            if ((b.B - b.A).Dot(axis) < MinVisibleLengthFt)
            {
                why = RfLenSkipReason.EndsNotAligned;
                return false;
            }
            dir = axis;
            return true;
        }

        /// <summary>Чиглэлийн тэмдгийг тогтооно (u эерэг, u ≈ 0 бол v эерэг) — эсрэг чиглэлтэй зэрэгцээ арматур нэг бүлэгт орно, бичвэр уншигдах талд.</summary>
        internal static RfV2 Canonical(RfV2 d)
        {
            if (d.X < -1e-9 || (Math.Abs(d.X) <= 1e-9 && d.Y < 0)) return -d;
            return d;
        }
    }
}
