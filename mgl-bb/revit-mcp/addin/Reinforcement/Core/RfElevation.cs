using System;
using System.Collections.Generic;
using System.Linq;

namespace RevitMcpAddin.Reinforcement.Core
{
    // ══════════════════════════════════════════════════════════════════════
    // АРМАТУРЫН ДЭЛГЭЭС (elevation) — шошго, хомутын MRA, давхцлын хэмжээс, тэнхлэгийн гинж.
    //
    // Revit-гүй ЦЭВЭР цөм (net48-д ч эмхэтгэгдэнэ — Math.Clamp, double.IsFinite, range/index ХЭРЭГЛЭХГҮЙ).  Бүх координат нь харагдацын
    // (u = баруун, v = дээш) хавтгайд, фут.  Revit талын уншилт/үүсгэлт: Revit/RfElevationService.cs.
    //
    // Эзний шийдвэр (2026-10-05): шошгоны зай = ЗӨВХӨН «Үндсэн шошго» хэсэгт хэрэглэгчийн оруулсан мм.  Хэрэгсэл өөрөөсөө зай нэмэхгүй:
    // хөрш шошгоны ХАРАГДАХ ХАЖУУГИЙН ЗАЙ = TagGapFt (шошго бүрийн бодит өргөнийг Revit-ээс хэмжиж, төвүүдийн зайг (w1+w2)/2 + gap болгоно).
    // ══════════════════════════════════════════════════════════════════════

    /// <summary>Дэлгээс дээрх нэг арматур (олонлог) — шулуун/бөгтөр ажлын арматур.</summary>
    public sealed class RfElevBar
    {
        public long Id;

        /// <summary>Шошгоны бүлэглэлтийн түлхүүр (ижил дугаар/төрөл/голч).  Хоосон = элемент бүр өөрийн шошготой.</summary>
        public string Group = string.Empty;

        public double Diameter;

        /// <summary>Голын шугамын u-муж (ширхгүүдийн нийлбэр).</summary>
        public double U0, U1;

        /// <summary>
        /// Шошгоны зангуу v: гишүүний ТАЛД ХАМГИЙН ОЙР ширхгийн голын шугамын v (дээд талын арматурт хамгийн их, доод талынд хамгийн бага).
        /// </summary>
        public double AnchorV;

        /// <summary>Шошгоны зангуу болсон ширхгийн индекс (олонлог доторх) — шошгоны дэд-элементийн лавлагаа энэ ширхгээс.</summary>
        public int TagBarIndex;

        /// <summary>Бүх ширхгийн v-ийн дундаж — тал (дээд/доод) тодорхойлоход.</summary>
        public double MeanV;

        /// <summary>true = нэг шулуун сегмент (давхцлын хэмжээс зөвхөн шулуун арматурт).</summary>
        public bool Straight;

        /// <summary>Хоёр төгсгөлийн (зүүн/баруун) лавлагаа олдсон эсэх — Revit тал.</summary>
        public bool HasEndRefs;
    }

    /// <summary>Хомутын олонлог (нэг MRA).</summary>
    public sealed class RfElevStirrup
    {
        public long Id;
        public double U0, U1;
        public int Count;
    }

    public enum RfElevSide
    {
        Top = 0,
        Bottom = 1,
    }

    public sealed class RfElevOptions
    {
        public bool TagBars = true;
        public bool StirrupMra = true;
        public bool SpanDims = true;
        public bool LapDims = true;

        /// <summary>
        /// Давхцалтай (зөрүүлсэн) арматурын эгнээнд ҮРГЭЛЖИЛСЭН (гинжин) хэмжээс: эгнээний арматур БҮРИЙН хоёр төгсгөл → «A-ийн урт | давхцал | B-ийн урт…»
        /// (2026-10-08, эзний хүсэлт — арматурын нийт уртыг мэдрэх).  Зөвхөн давхцалтай эгнээнд; давхцлын «500» хэмжээсээс ТУСДАА.
        /// </summary>
        public bool LapChain = false;

        /// <summary>Гишүүний ирмэгээс шошгоны ЭХНИЙ эгнээ хүртэл (хэрэглэгчийн «Дам нуруунаас дээш/доош зай»).</summary>
        public double TagOffsetFt;

        /// <summary>Хөрш шошгоны ХАРАГДАХ хажуугийн зай (хэрэглэгчийн «Шошго хоорондын зай»).  Өөр зай ХЭЗЭЭ Ч нэмэхгүй.</summary>
        public double TagGapFt;

        /// <summary>Хэмжээсийн эгнээ хоорондын зай (хэрэглэгчийн «Хэмжээсийн зай»).</summary>
        public double DimPitchFt;

        /// <summary>
        /// Гишүүний (дам нуруу/багана) ирмэгээс хомутын MRA-ийн ХЭМЖЭЭСИЙН ШУГАМ хүртэлх зай (хэрэглэгчийн «Хомутын хэмжээсийн зай»).
        /// 0 = автомат (бусад эгнээний ДАРАА давхарлаж тавина — өмнөх зан төлөв); &gt; 0 = ирмэгээс ЯГ энэ зайд, шошго нь шугамаас гадагш.
        /// </summary>
        public double StirrupDimOffsetFt;

        /// <summary>
        /// «Байрлал»-ын «эхний гинж» (2026-10-12, эзний t1.pdf — нэг зай хэрэгслийн БҮХ хэмжээсэд): ямар ч хэмжээсийн шугам (давхцал, автомат MRA, тэнхлэг/түвшний
        /// гинж) гишүүний ирмэгээс үүнээс ОЙР тавигдахгүй — шошго түүнээс цааш байвал шошгоны ард (давхцахгүй).  0 = хязгааргүй (өмнөх зан төлөв).
        /// Хэрэглэгчийн ЗААСАН MRA-ийн зай (<see cref="StirrupDimOffsetFt"/>) энэ дүрмээс чөлөөтэй.
        /// </summary>
        public double DimFirstFt;

        /// <summary>Шошгоны leader: 3→2 (шошгоны ирмэгээс elbow хүртэл хэвтээ) ба 2→1 (elbow-оос арматур хүртэлх налуу хэсгийн хэвтээ зай).  0 = Revit-ийн автомат.</summary>
        public double LeaderLandingFt, LeaderRunFt;

        /// <summary>Шошгоны хэмжээ мэдэгдээгүй (хэмжээгүй) үеийн таамаг — хэмжсэн утга ирмэгц солигдоно.</summary>
        public double DefaultTagWidthFt, DefaultTagHeightFt;

        /// <summary>Давхцал гэж үзэх дээд урт (цаашх нь «бэхэлгээ» биш, өөр зүйл).</summary>
        public double MaxLapFt = 6.0;

        /// <summary>Давхцал: ижил эгнээнд байх v-ийн зөрүү = голч × энэ.</summary>
        public double LapRowDiameters = 2.5;

        /// <summary>Давхцал: хамгийн багадаа голч × энэ (хэт богинийг алгасна).</summary>
        public double LapMinDiameters = 4.0;
    }

    public sealed class RfElevInput
    {
        public double BeamU0, BeamU1, BeamV0, BeamV1;
        public readonly List<RfElevBar> Bars = new List<RfElevBar>();
        public readonly List<RfElevStirrup> Stirrups = new List<RfElevStirrup>();

        /// <summary>Гишүүний уртыг дайрсан тэнхлэгүүдийн u (харагдацад босоо).</summary>
        public readonly List<double> GridU = new List<double>();

        public RfElevOptions Options = new RfElevOptions();
    }

    /// <summary>Нэг tag (бүлэг бүрт нэг).</summary>
    public sealed class RfElevTagPlan
    {
        /// <summary>Tag-лах (төлөөлөх) арматур.</summary>
        public long BarId;

        /// <summary>Бүлэгт хэдэн элемент орсон (мэдэгдэл).</summary>
        public int GroupCount = 1;

        public RfElevSide Side;

        /// <summary>Leader-ийн төгсгөл — арматур дээрх цэг.</summary>
        public RfV2 Anchor;

        /// <summary>Tag-ийн толгой.</summary>
        public RfV2 Head;

        /// <summary>Хэмжсэн/таамагласан хэмжээ (шошгоны хоорондын зайг тооцоход).</summary>
        public double Width, Height;
    }

    public sealed class RfElevMraPlan
    {
        public long RebarId;
        public double U0, U1;

        /// <summary>Хэмжээсийн шугамын v.</summary>
        public double LineV;

        public RfV2 Head;
        public double Width, Height;
    }

    public sealed class RfElevLapPlan
    {
        /// <summary>A = зүүн арматур (баруун үзүүр нь давхцал төгсөх), B = баруун арматур (зүүн үзүүр нь давхцал эхлэх).</summary>
        public long BarA, BarB;

        /// <summary>Давхцлын u-муж: [B.U0, A.U1].</summary>
        public double U0, U1;

        public RfElevSide Side;
        public double LineV;
        public double Length { get { return U1 - U0; } }
    }

    /// <summary>
    /// Давхцалтай арматурын эгнээний ҮРГЭЛЖИЛСЭН хэмжээс: эгнээний арматур бүрийн зүүн/баруун төгсгөл u-ээр эрэмбэлсэн (давхардалгүй).
    /// «6000 | 500 | 5500» = A-ийн давхцаагүй хэсэг | давхцал | B-ийн үлдэгдэл — нийлбэр = эгнээний нийт урт.
    /// </summary>
    public sealed class RfElevLapChainPlan
    {
        public RfElevSide Side;
        public double LineV;

        /// <summary>Нэг талд u-муж нь давхцсан эгнээ (2 давхар арматур г.м.) бол дараагийн мөр (0 = гишүүнд хамгийн ойр).</summary>
        public int Row;

        /// <summary>Лавлагааны u (өсөх), тэдгээрийн арматур, зүүн (true) / баруун (false) төгсгөл.</summary>
        public readonly List<double> U = new List<double>();
        public readonly List<long> Bar = new List<long>();
        public readonly List<bool> IsLeft = new List<bool>();

        public double U0 { get { return U.Count == 0 ? 0 : U[0]; } }
        public double U1 { get { return U.Count == 0 ? 0 : U[U.Count - 1]; } }
    }

    public sealed class RfElevSpanPlan
    {
        public bool Overall;
        public readonly List<double> GridU = new List<double>();
        public double LineV;
    }

    public enum RfElevWarn
    {
        NoBeamExtent = 0,
        NoBars,
        NoStirrups,
        StirrupSingle,
        FewGrids,
        LapNoRefs,

        /// <summary>Хомутын хэмжээсийн зай хэт бага — шугам нь арматурын шошго/давхцлын эгнээнд давхцана.</summary>
        StirrupOffsetOverlap,
    }

    public sealed class RfElevWarning
    {
        public readonly RfElevWarn Code;
        public readonly string Arg;

        public RfElevWarning(RfElevWarn code, string arg)
        {
            Code = code;
            Arg = arg;
        }
    }

    public sealed class RfElevPlan
    {
        public readonly List<RfElevTagPlan> Tags = new List<RfElevTagPlan>();
        public readonly List<RfElevMraPlan> Mras = new List<RfElevMraPlan>();
        public readonly List<RfElevLapPlan> Laps = new List<RfElevLapPlan>();
        public readonly List<RfElevLapChainPlan> LapChains = new List<RfElevLapChainPlan>();
        public readonly List<RfElevSpanPlan> Spans = new List<RfElevSpanPlan>();
        public readonly List<RfElevWarning> Warnings = new List<RfElevWarning>();

        /// <summary>
        /// Хомутын MRA-ийн зай хэрэглэгчийн утгаар ЯГ тогтсон бөгөөд доод талын шошго/давхцлын эгнээ түүний ДОТОР (гишүүнд ойр) байсан тул тэдгээрийг MRA-ийн
        /// гадна (доош) зөөсөн — MRA гишүүнд хамгийн ойр эгнээ болсон.
        /// </summary>
        public bool MraFirst;

        public void Warn(RfElevWarn code, string arg = null) { Warnings.Add(new RfElevWarning(code, arg)); }
    }

    /// <summary>Хэмжсэн шошгоны хэмжээ (түлхүүр: tag-д BarId, MRA-д RebarId).</summary>
    public sealed class RfElevSizes
    {
        public readonly Dictionary<long, double[]> Tag = new Dictionary<long, double[]>();
        public readonly Dictionary<long, double[]> Mra = new Dictionary<long, double[]>();
    }

    public static class RfElevPlanner
    {
        /// <summary>
        /// ПЛАН.  <paramref name="sizes"/> = Revit-ээс хэмжсэн шошгоны хэмжээ (null бол options-ийн таамаг).  Хоёр удаа дуудаж болно:
        /// эхний удаа таамгаар (шошгыг түр тавихад), дараа нь хэмжсэн хэмжээгээр (эцсийн байрлал).
        /// </summary>
        public static RfElevPlan Build(RfElevInput input, RfElevSizes sizes)
        {
            var plan = new RfElevPlan();
            RfElevOptions o = input.Options;
            if (!(input.BeamU1 - input.BeamU0 > RfTol.PointFt) || !(input.BeamV1 - input.BeamV0 > RfTol.PointFt))
            {
                plan.Warn(RfElevWarn.NoBeamExtent);
                return plan;
            }
            double mid = (input.BeamV0 + input.BeamV1) / 2;

            // ── Давхцлын хэмжээс (эгнээний v-г тооцохын өмнө — Top/Bottom талыг эхлээд мэдэх).  Үргэлжилсэн хэмжээс ч давхцлаас үүснэ.
            var laps = new List<RfElevLapPlan>();
            if (o.LapDims || o.LapChain)
                laps = FindLaps(input, mid);
            List<RfElevLapChainPlan> lapChains = o.LapChain ? BuildLapChains(input, laps) : new List<RfElevLapChainPlan>();
            if (!o.LapDims)
                laps = new List<RfElevLapPlan>();

            // ── Шошгоны эгнээ: тал бүрээр бүлэглэнэ
            var seeds = new List<RfElevTagPlan>();
            if (o.TagBars)
            {
                if (input.Bars.Count == 0) plan.Warn(RfElevWarn.NoBars);
                foreach (IGrouping<string, RfElevBar> g in input.Bars
                    .GroupBy(b => b.Group.Length == 0 ? "#" + b.Id : b.Group)
                    .OrderBy(x => x.Key, StringComparer.Ordinal))
                {
                    // Төлөөлөгч: хамгийн урт (тэнцүү бол id).
                    RfElevBar rep = g.OrderByDescending(b => b.U1 - b.U0).ThenBy(b => b.Id).First();
                    RfElevSide side = rep.MeanV >= mid ? RfElevSide.Top : RfElevSide.Bottom;
                    double u = RfTol.Clamp((rep.U0 + rep.U1) / 2, input.BeamU0, input.BeamU1);
                    double w = DefaultOr(sizes == null ? null : sizes.Tag, rep.Id, 0, o.DefaultTagWidthFt);
                    double h = DefaultOr(sizes == null ? null : sizes.Tag, rep.Id, 1, o.DefaultTagHeightFt);
                    seeds.Add(new RfElevTagPlan
                    {
                        BarId = rep.Id,
                        GroupCount = g.Count(),
                        Side = side,
                        Anchor = new RfV2(u, rep.AnchorV),
                        Width = w,
                        Height = h,
                    });
                }
            }

            // ── Хомутын MRA
            var mras = new List<RfElevMraPlan>();
            if (o.StirrupMra)
            {
                if (input.Stirrups.Count == 0) plan.Warn(RfElevWarn.NoStirrups);
                foreach (RfElevStirrup s in input.Stirrups.OrderBy(x => x.U0).ThenBy(x => x.Id))
                {
                    if (s.Count < 2)
                    {
                        plan.Warn(RfElevWarn.StirrupSingle, s.Id.ToString());
                        continue;
                    }
                    mras.Add(new RfElevMraPlan
                    {
                        RebarId = s.Id,
                        U0 = s.U0,
                        U1 = s.U1,
                        Width = DefaultOr(sizes == null ? null : sizes.Mra, s.Id, 0, o.DefaultTagWidthFt),
                        Height = DefaultOr(sizes == null ? null : sizes.Mra, s.Id, 1, o.DefaultTagHeightFt),
                    });
                }
            }

            // ── Тэнхлэгийн гинж
            var gridsInside = new List<double>();
            if (o.SpanDims)
            {
                double slack = RfTol.MmToFt(600); // дам нуруу тулгуурын нүүрээр дуусдаг (тэнхлэгээс ≈ 200–300 мм)
                foreach (double g in input.GridU.OrderBy(x => x))
                {
                    if (g < input.BeamU0 - slack || g > input.BeamU1 + slack) continue;
                    if (gridsInside.Count > 0 && Math.Abs(gridsInside[gridsInside.Count - 1] - g) < RfTol.MmToFt(1)) continue;
                    gridsInside.Add(g);
                }
                if (gridsInside.Count < 2) plan.Warn(RfElevWarn.FewGrids, gridsInside.Count.ToString());
            }

            // ══ ЭГНЭЭНИЙ ДАРААЛАЛ (гишүүнээс гадагш) ══
            //  Дээд: [арматурын шошго] → [давхцлын хэмжээс]
            //  Доод: [арматурын шошго] → [давхцлын хэмжээс] → [хомутын шошго] → [хомутын хэмжээс] → [тэнхлэгийн гинж] → [нийт]
            double topEdge = input.BeamV1, botEdge = input.BeamV0;
            // «Эхний гинж»: хэмжээсийн шугам ирмэгээс үүнээс ойр биш (0 = хязгааргүй → min/max нь өөрчлөхгүй).
            bool hasFirst = o.DimFirstFt > RfTol.PointFt;
            double topFirst = hasFirst ? topEdge + o.DimFirstFt : double.NegativeInfinity;
            double botFirst = hasFirst ? botEdge - o.DimFirstFt : double.PositiveInfinity;

            // Дээд тал
            double topV = topEdge + o.TagOffsetFt;
            List<RfElevTagPlan> topTags = seeds.Where(t => t.Side == RfElevSide.Top).ToList();
            double topTagH = topTags.Count == 0 ? 0 : topTags.Max(t => t.Height);
            if (topTags.Count > 0)
            {
                Place(topTags, input, topV);
                plan.Tags.AddRange(topTags);
            }
            double cursorTop = topV + (topTags.Count == 0 ? 0 : topTagH / 2);
            List<RfElevLapPlan> topLaps = laps.Where(l => l.Side == RfElevSide.Top).ToList();
            if (topLaps.Count > 0)
            {
                double lineV = Math.Max(cursorTop + o.DimPitchFt, topFirst);
                foreach (RfElevLapPlan l in topLaps) l.LineV = lineV;
                plan.Laps.AddRange(topLaps);
                cursorTop = lineV;
            }
            List<RfElevLapChainPlan> topChains = lapChains.Where(c => c.Side == RfElevSide.Top).ToList();
            if (topChains.Count > 0)
            {
                int rows = AssignChainRows(topChains);
                double baseTop = Math.Max(cursorTop, topFirst - o.DimPitchFt);
                foreach (RfElevLapChainPlan c in topChains) c.LineV = baseTop + o.DimPitchFt * (c.Row + 1);
                plan.LapChains.AddRange(topChains);
                cursorTop = baseTop + o.DimPitchFt * rows;
            }

            // Доод тал: [шошго] → [давхцал] → [үргэлжилсэн] (гишүүнээс гадагш), дараа нь хомутын MRA, тэнхлэг.
            // Хомутын MRA-ийн зайг хэрэглэгч ЗААСАН (> 0) бөгөөд шугам нь эдгээр эгнээний ДОТОР (гишүүнд ойр) таарвал MRA-г яг тэр зайд үлдээгээд
            // эгнээнүүдийг MRA-ийн гадна (доош) зөөнө — давхцахгүй, MRA-ийн зай хэрэглэгчийнхээр ЯГ.
            List<RfElevTagPlan> botTags = seeds.Where(t => t.Side == RfElevSide.Bottom).ToList();
            double botTagH = botTags.Count == 0 ? 0 : botTags.Max(t => t.Height);
            List<RfElevLapPlan> botLaps = laps.Where(l => l.Side == RfElevSide.Bottom).ToList();
            List<RfElevLapChainPlan> botChains = lapChains.Where(c => c.Side == RfElevSide.Bottom).ToList();
            int botChainRows = botChains.Count == 0 ? 0 : AssignChainRows(botChains);
            double mraTagH = mras.Count == 0 ? 0 : mras.Max(m => m.Height);
            bool pinned = mras.Count > 0 && o.StirrupDimOffsetFt > RfTol.PointFt;
            double pinLine = botEdge - o.StirrupDimOffsetFt;
            double pinBottom = pinLine - o.TagGapFt - mraTagH;

            double botV = botEdge - o.TagOffsetFt;
            double cursor = StackBottom(botV, botTags.Count > 0, botTagH, botLaps.Count > 0, botChainRows, o.DimPitchFt, botFirst);
            if (pinned && pinLine > cursor - RfTol.PointFt)
            {
                plan.MraFirst = true;
                botV = botTags.Count > 0 ? pinBottom - o.TagGapFt - botTagH / 2 : pinBottom;
                cursor = StackBottom(botV, botTags.Count > 0, botTagH, botLaps.Count > 0, botChainRows, o.DimPitchFt, botFirst);
            }
            if (botTags.Count > 0)
            {
                Place(botTags, input, botV);
                plan.Tags.AddRange(botTags);
            }
            double rowCursor = botV - (botTags.Count == 0 ? 0 : botTagH / 2);
            if (botLaps.Count > 0)
            {
                double lineV = Math.Min(rowCursor - o.DimPitchFt, botFirst);
                foreach (RfElevLapPlan l in botLaps) l.LineV = lineV;
                plan.Laps.AddRange(botLaps);
                rowCursor = lineV;
            }
            if (botChains.Count > 0)
            {
                double baseBot = Math.Min(rowCursor, botFirst + o.DimPitchFt);
                foreach (RfElevLapChainPlan c in botChains) c.LineV = baseBot - o.DimPitchFt * (c.Row + 1);
                plan.LapChains.AddRange(botChains);
            }

            if (mras.Count > 0)
            {
                double headV, lineV;
                if (pinned)
                {
                    // Хэрэглэгчийн заасан зай: хэмжээсийн шугам гишүүний ирмэгээс ЯГ энэ зайд, шошго шугамаас гадагш.
                    lineV = pinLine;
                    headV = lineV - o.TagGapFt - mraTagH / 2;
                    if (!plan.MraFirst && lineV > cursor - o.DimPitchFt * 0.5) plan.Warn(RfElevWarn.StirrupOffsetOverlap);
                }
                else
                {
                    headV = cursor - o.TagGapFt - mraTagH / 2;
                    lineV = headV - mraTagH / 2 - o.DimPitchFt;
                    if (lineV > botFirst)
                    {
                        // «Эхний гинж»: шугамыг ирмэгээс тэр зайд, шошго нь шугамтайгаа хамт гадагш.
                        lineV = botFirst;
                        headV = lineV + o.DimPitchFt + mraTagH / 2;
                    }
                }
                // Толгойнууд: дундаж u дээр, хөрш шошгоны зай = хэрэглэгчийн зай.
                var anchors = mras.Select(m => (m.U0 + m.U1) / 2).ToArray();
                var widths = mras.Select(m => m.Width).ToArray();
                double[] xs = Dodge(anchors, widths, o.TagGapFt);
                for (int i = 0; i < mras.Count; i++)
                {
                    mras[i].Head = new RfV2(xs[i], headV);
                    mras[i].LineV = lineV;
                }
                plan.Mras.AddRange(mras);
                cursor = Math.Min(cursor, Math.Min(lineV, headV - mraTagH / 2));
            }

            if (gridsInside.Count >= 2)
            {
                cursor = Math.Min(cursor - o.DimPitchFt, botFirst);
                var chain = new RfElevSpanPlan { LineV = cursor };
                chain.GridU.AddRange(gridsInside);
                plan.Spans.Add(chain);
                if (gridsInside.Count >= 3)
                {
                    cursor -= o.DimPitchFt;
                    var total = new RfElevSpanPlan { Overall = true, LineV = cursor };
                    total.GridU.Add(gridsInside[0]);
                    total.GridU.Add(gridsInside[gridsInside.Count - 1]);
                    plan.Spans.Add(total);
                }
            }
            return plan;
        }

        /// <summary>
        /// Доод талын эгнээнүүдийн (шошго → давхцал → үргэлжилсэн мөрүүд) хамгийн доод цэг.  <paramref name="tagsCenter"/> = шошгоны эгнээний төв
        /// (шошгогүй бол эхний хэмжээсийн шугам үүнээс нэг алхам доош).
        /// </summary>
        private static double StackBottom(double tagsCenter, bool tags, double tagH, bool laps, int chainRows, double pitch, double firstLine)
        {
            // Байрлуулалттай ЯГ ижил: давхцлын шугам ба үргэлжилсэн гинжийн эхний мөр «эхний гинж»-ээс (firstLine) ойр биш.
            double c = tagsCenter - (tags ? tagH / 2 : 0);
            if (laps) c = Math.Min(c - pitch, firstLine);
            if (chainRows > 0) c = Math.Min(c, firstLine + pitch) - pitch * chainRows;
            return c;
        }

        /// <summary>Нэг талын үргэлжилсэн хэмжээсүүдэд мөр оноох: u-муж нь давхцахгүй бол нэг мөрөнд, давхцвал дараагийн мөрөнд.  Мөрийн тоо.</summary>
        internal static int AssignChainRows(List<RfElevLapChainPlan> chains)
        {
            var rowEnds = new List<double>();
            double gap = RfTol.MmToFt(1);
            foreach (RfElevLapChainPlan c in chains.OrderBy(x => x.U0).ThenBy(x => x.U1))
            {
                int row = -1;
                for (int r = 0; r < rowEnds.Count; r++)
                {
                    if (c.U0 > rowEnds[r] + gap) { row = r; break; }
                }
                if (row < 0)
                {
                    rowEnds.Add(c.U1);
                    row = rowEnds.Count - 1;
                }
                else
                {
                    rowEnds[row] = c.U1;
                }
                c.Row = row;
            }
            return rowEnds.Count;
        }

        /// <summary>
        /// ҮРГЭЛЖИЛСЭН хэмжээс: давхцлаар холбогдсон арматурууд нэг эгнээ (бүлэг).  Бүлэг бүрийн арматурын хоёр төгсгөлийг u-ээр эрэмбэлж,
        /// 1 мм-ээс ойр давхардлыг хасна (эхнийх үлдэнэ).  3-аас цөөн лавлагаатай бүлэг үгүй (давхцалтай 2 арматур = 4 лавлагаа).
        /// </summary>
        internal static List<RfElevLapChainPlan> BuildLapChains(RfElevInput input, List<RfElevLapPlan> laps)
        {
            var res = new List<RfElevLapChainPlan>();
            if (laps == null || laps.Count == 0) return res;
            var parent = new Dictionary<long, long>();
            Func<long, long> find = null;
            find = x =>
            {
                long p;
                if (!parent.TryGetValue(x, out p)) { parent[x] = x; return x; }
                if (p == x) return x;
                long r = find(p);
                parent[x] = r;
                return r;
            };
            var side = new Dictionary<long, RfElevSide>();
            foreach (RfElevLapPlan l in laps)
            {
                long a = find(l.BarA), b = find(l.BarB);
                if (a != b) parent[Math.Max(a, b)] = Math.Min(a, b);
                side[l.BarA] = l.Side;
                side[l.BarB] = l.Side;
            }
            var byId = new Dictionary<long, RfElevBar>();
            foreach (RfElevBar b in input.Bars) byId[b.Id] = b;
            double tol = RfTol.MmToFt(1);
            foreach (IGrouping<long, long> g in parent.Keys.ToList().GroupBy(id => find(id)).OrderBy(x => x.Key))
            {
                var pts = new List<Tuple<double, long, bool>>();
                foreach (long id in g.OrderBy(x => x))
                {
                    RfElevBar b;
                    if (!byId.TryGetValue(id, out b)) continue;
                    pts.Add(Tuple.Create(b.U0, id, true));
                    pts.Add(Tuple.Create(b.U1, id, false));
                }
                var chain = new RfElevLapChainPlan { Side = side[g.Key] };
                foreach (Tuple<double, long, bool> p in pts.OrderBy(x => x.Item1).ThenBy(x => x.Item2))
                {
                    if (chain.U.Count > 0 && p.Item1 - chain.U[chain.U.Count - 1] < tol) continue;
                    chain.U.Add(p.Item1);
                    chain.Bar.Add(p.Item2);
                    chain.IsLeft.Add(p.Item3);
                }
                if (chain.U.Count >= 3) res.Add(chain);
            }
            return res.OrderBy(c => c.Side).ThenBy(c => c.U0).ToList();
        }

        private static double DefaultOr(Dictionary<long, double[]> d, long id, int idx, double fallback)
        {
            double[] v;
            if (d != null && d.TryGetValue(id, out v) && v.Length > idx && v[idx] > RfTol.PointFt) return v[idx];
            return fallback;
        }

        /// <summary>Нэг эгнээний толгойнуудыг (u дарааллаар) зайтай болгож байрлуулна.</summary>
        private static void Place(List<RfElevTagPlan> tags, RfElevInput input, double v)
        {
            tags.Sort((a, b) =>
            {
                int c = a.Anchor.X.CompareTo(b.Anchor.X);
                return c != 0 ? c : a.BarId.CompareTo(b.BarId);
            });
            double[] xs = Dodge(tags.Select(t => t.Anchor.X).ToArray(), tags.Select(t => t.Width).ToArray(), input.Options.TagGapFt);
            for (int i = 0; i < tags.Count; i++) tags[i].Head = new RfV2(xs[i], v);
        }

        /// <summary>
        /// 1D «шошго зайлуулах»: <paramref name="anchors"/> (өсөхөөр) тус бүрийн хүссэн төвийг хамгийн бага квадрат хазайлтаар, хөрш хоёрын ХАРАГДАХ зай
        /// ≥ <paramref name="gap"/> байхаар шилжүүлнэ.  Төвүүдийн хамгийн бага зай p_i = (w_i + w_{i+1})/2 + gap.  Pool-Adjacent-Violators:
        /// y_i = x_i − c_i (c = p-гийн хуримтлал) нь буурахгүй байх ёстой.
        /// </summary>
        public static double[] Dodge(double[] anchors, double[] widths, double gap)
        {
            int n = anchors.Length;
            var res = new double[n];
            if (n == 0) return res;
            var c = new double[n];
            for (int i = 1; i < n; i++) c[i] = c[i - 1] + (widths[i - 1] + widths[i]) / 2 + gap;
            // Блок бүр: нийлбэр, тоо
            var sum = new List<double>();
            var cnt = new List<int>();
            for (int i = 0; i < n; i++)
            {
                sum.Add(anchors[i] - c[i]);
                cnt.Add(1);
                while (sum.Count > 1 && sum[sum.Count - 2] / cnt[cnt.Count - 2] > sum[sum.Count - 1] / cnt[cnt.Count - 1])
                {
                    int last = sum.Count - 1;
                    sum[last - 1] += sum[last];
                    cnt[last - 1] += cnt[last];
                    sum.RemoveAt(last);
                    cnt.RemoveAt(last);
                }
            }
            int k = 0;
            for (int b = 0; b < sum.Count; b++)
            {
                double y = sum[b] / cnt[b];
                for (int j = 0; j < cnt[b]; j++, k++) res[k] = y + c[k];
            }
            return res;
        }

        /// <summary>
        /// Давхцал: шулуун арматур хос (голч ӨӨР байж болно — Ø22 тулгуурын арматур ↔ Ø12 мөрийн арматур, бодит гар хэмжээс), ижил талд (дээд/доод), ижил эгнээнд (v ойр), A.U0 &lt; B.U0 &lt; A.U1 &lt; B.U1.
        /// Лавлагаа нь Revit талд (төгсгөлийн хэрчим) — олдохгүй бол энэ хос Revit талд алгасагдана.
        /// </summary>
        private static List<RfElevLapPlan> FindLaps(RfElevInput input, double mid)
        {
            RfElevOptions o = input.Options;
            var res = new List<RfElevLapPlan>();
            List<RfElevBar> bars = input.Bars.Where(b => b.Straight && b.Diameter > RfTol.PointFt).OrderBy(b => b.U0).ThenBy(b => b.Id).ToList();
            for (int i = 0; i < bars.Count; i++)
            {
                for (int j = 0; j < bars.Count; j++)
                {
                    if (i == j) continue;
                    RfElevBar a = bars[i], b = bars[j];
                    bool aTop = a.MeanV >= mid, bTop = b.MeanV >= mid;
                    if (aTop != bTop) continue;
                    if (Math.Abs(a.AnchorV - b.AnchorV) > Math.Max(a.Diameter, b.Diameter) * o.LapRowDiameters) continue;
                    // A зүүн, B баруун, хэсэгчлэн давхарласан
                    if (!(a.U0 < b.U0 - RfTol.PointFt && b.U0 < a.U1 - RfTol.PointFt && a.U1 < b.U1 - RfTol.PointFt)) continue;
                    double len = a.U1 - b.U0;
                    if (len > o.MaxLapFt || len < Math.Min(a.Diameter, b.Diameter) * o.LapMinDiameters) continue;
                    res.Add(new RfElevLapPlan { BarA = a.Id, BarB = b.Id, U0 = b.U0, U1 = a.U1, Side = aTop ? RfElevSide.Top : RfElevSide.Bottom });
                }
            }
            return res.OrderBy(l => l.U0).ThenBy(l => l.BarA).ToList();
        }
    }
}
