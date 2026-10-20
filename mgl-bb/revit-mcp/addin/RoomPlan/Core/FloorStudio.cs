using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;

namespace RevitMcpAddin.RoomPlan.Core
{
    // ══════════════════════════════════════════════════════════════════════════
    //  ДАВХРЫН ПЛАНЫ СТУДИ (Finch маяг, 2026-10-14) — нэг товчоор олон зуун бүтэн давхрын хувилбар.
    //
    //  Эзний хүсэлт: «Давхрын план» дарахад ямар ч цонх, асуултгүйгээр 100–500 давхардалгүй хувилбар
    //  (айл хуваалт + айл бүрийн өрөөний план) үүсч, хамгийн зөв, хамгийн тухтай 20-ыг санал болгоно;
    //  архитектор нүдээрээ хараад сонгоно.
    //
    //   1. EnumerateSplits — коридорын схем × шат-лифтийн хонгилын байрлал × айлын харьцаа × зэрэглэл-ээр
    //      `FloorPlateSplitter`-ийг олон удаа дуудаж, геометрээрээ давхардалгүй хуваалтуудыг авна.
    //   2. (Revit тал) айл бүрийн дотор планыг Python хөдөлгүүрээр — ижил хэмжээтэй айл нэг удаа.
    //   3. Compose — хуваалт бүрд айлуудын дотор планыг хэд хэдэн «загвар»-аар (шилдэг, нэг төрлийн коридор,
    //      хоёр дахь сонголт …) хослуулж бүтэн давхрын хувилбар болгоно; нэг хананд давхцах орц хориотой.
    //   4. Score — өдрийн гэрэл, агаар сэлгэлт (хоёр талдаа цонхтой айл), тав тух (Python-ы оноо), үр ашиг,
    //      айлын харьцаа, хэмжээ, ойлгомжтой байдал (нэг төрлийн зохион байгуулалт).
    //   5. Recommend — шилдэг N-ийг нэг хуваалтаас хэт олныг авахгүйгээр (олон янз) сонгоно.
    //
    //  ⚠️ Revit/WPF-гүй ЦЭВЭР — `tests/RoomPlan.Tests` шалгана.  Монгол нормын (БНбД) шалгалт БИШ: оноо нь
    //  хөдөлгүүрийн өрөөний хэмжээ, гэрлийн дүрэм дээр тулгуурласан харьцуулалт.
    // ══════════════════════════════════════════════════════════════════════════

    /// <summary>Айлын харьцааны бэлэн хувилбар (1..4 өрөөний жин).</summary>
    internal sealed class MixPreset
    {
        public string Key, Label;
        public double[] Mix;
    }

    /// <summary>Нэг айлын дотор планы хувилбар — Python-ы саналын цэвэр хуулбар.</summary>
    internal sealed class StudioUnitOption
    {
        public string OptionId, Topology;
        /// <summary>Python-ы оноо 0–100 (талбай, хэлбэр, гэрэл, хөдөлгөөн …).</summary>
        public double Score;
        public int Daylit, Habitable;
        public GeneratedPlan Plan;
        /// <summary>Revit тал (Python-ы анхны санал, багц) — энд ашиглахгүй.</summary>
        public object Source;
        public bool FullyLit { get { return Daylit >= Habitable; } }
    }

    /// <summary>Давхрын нэг айл хуваалт (айлын дотор плангүй).</summary>
    internal sealed class StudioSplit
    {
        public FloorPlateInput Input;
        public FloorPlateLayout Layout;
        public MixPreset Preset;
        /// <summary>Геометрийн гарын үсэг — давхардал хасахад.</summary>
        public string Signature;
        public string Tier { get { return Input.Tier; } }
    }

    /// <summary>Бүтэн давхрын нэг хувилбар: хуваалт + айл бүрийн сонгосон дотор план.</summary>
    internal sealed class StudioCandidate
    {
        public StudioSplit Split;
        public readonly Dictionary<string, StudioUnitOption> Choice = new Dictionary<string, StudioUnitOption>(StringComparer.Ordinal);
        /// <summary>best | style:&lt;topology&gt; | alt1 | alt2 …</summary>
        public string Style;
        public string Signature;
        /// <summary>0–100.</summary>
        public double Score;
        public readonly Dictionary<string, double> Parts = new Dictionary<string, double>(StringComparer.Ordinal);
        public int LitUnits, DualAspectUnits;
        public int Rank;
    }

    internal static class FloorStudio
    {
        public static readonly MixPreset[] Presets =
        {
            new MixPreset { Key = "balanced", Label = "Тэнцвэртэй", Mix = new[] { 0.0, 0.4, 0.4, 0.2 } },
            new MixPreset { Key = "compact", Label = "Жижиг айл", Mix = new[] { 0.3, 0.5, 0.2, 0.0 } },
            new MixPreset { Key = "starter", Label = "1–2 өрөө", Mix = new[] { 0.5, 0.5, 0.0, 0.0 } },
            new MixPreset { Key = "two-three", Label = "2–3 өрөө", Mix = new[] { 0.0, 0.5, 0.5, 0.0 } },
            new MixPreset { Key = "family", Label = "Гэр бүл", Mix = new[] { 0.0, 0.2, 0.5, 0.3 } },
            new MixPreset { Key = "large", Label = "Том айл", Mix = new[] { 0.0, 0.0, 0.5, 0.5 } },
        };

        public static readonly string[] Tiers = { "economy", "standard", "luxury" };

        /// <summary>Айлын гүнээс (м) цааш бол хуваалтыг авахгүй — хэт гүн айлд гэрэл, агаар хүрэхгүй.</summary>
        public const double MaxRowDepth = 12.6;
        /// <summary>Нэг хуваалтаас хэдэн дотор планы хослол хүртэл.</summary>
        public const int MaxPerSplit = 8;
        /// <summary>Нийт хувилбарын дээд хэмжээ.</summary>
        public const int MaxPool = 500;
        /// <summary>Орох хаалга хоорондын доод зай нэг хананд (м) — `RoomPlanBatchApply.CheckSharedBoundaryDoorConflicts`-тэй ижил.</summary>
        public const double DoorSpacing = 1.0;

        public static readonly string[] PartKeys = { "comfort", "daylight", "ventilation", "efficiency", "mix", "size", "clarity" };
        private static readonly Dictionary<string, double> Weights = new Dictionary<string, double>(StringComparer.Ordinal)
        {
            { "comfort", 0.28 }, { "daylight", 0.22 }, { "ventilation", 0.12 }, { "efficiency", 0.16 },
            { "mix", 0.10 }, { "size", 0.07 }, { "clarity", 0.05 },
        };

        public static string TierLabel(string tier)
        {
            return tier == "economy" ? "Энгийн" : tier == "luxury" ? "Тансаг" : "Дунд";
        }

        // ── 1. Хуваалтууд ──────────────────────────────────────────────

        /// <summary>
        /// Давхрын хэмжээнээс бүх утга учиртай хуваалтыг: схем (төв коридор / хоёр талын галерей) × хонгил (төвд,
        /// хоёр үзүүрийн аль нэгэнд; төв коридорт хоёр эгнээний аль нэгэнд) × харьцаа × зэрэглэл.  Геометр нь ижил хуваалт
        /// нэг л удаа — зэрэглэл нь айлын талбайд хамгийн тохирсонгоор (ижил айлыг «энгийн» ба «дунд» гэж хоёр тоолохгүй).
        /// </summary>
        public static List<StudioSplit> EnumerateSplits(double width, double height, double exteriorThickness, double wallThickness)
        {
            var bySignature = new Dictionary<string, StudioSplit>(StringComparer.Ordinal);
            var order = new List<string>();
            var deep = new List<StudioSplit>();
            var schemes = new[] { (CorridorScheme.Double, false), (CorridorScheme.Single, false), (CorridorScheme.Single, true) };
            var cores = new[] { (CorePosition.Center, false), (CorePosition.End, false), (CorePosition.End, true) };
            foreach (string tier in Tiers)
            foreach (MixPreset preset in Presets)
            foreach (var (scheme, lowSide) in schemes)
            foreach (var (core, lowEnd) in cores)
            foreach (bool lowRow in scheme == CorridorScheme.Double ? new[] { false, true } : new[] { false })
            {
                var input = new FloorPlateInput
                {
                    Width = width, Height = height, ExteriorThickness = exteriorThickness, WallThickness = wallThickness,
                    Scheme = scheme, SingleOnLowSide = lowSide, Core = core, CoreAtLowEnd = lowEnd, CoreOnLowRow = lowRow,
                    Mix = (double[])preset.Mix.Clone(), Tier = tier, CorridorWidth = tier == "luxury" ? 1.8 : 1.6,
                };
                FloorPlateLayout layout = FloorPlateSplitter.Split(input);
                if (layout.Error != null || layout.Units.Count == 0) continue;
                var split = new StudioSplit { Input = input, Layout = layout, Preset = preset, Signature = Signature(layout) };
                if (layout.RowDepth > MaxRowDepth) { deep.Add(split); continue; }
                if (bySignature.TryGetValue(split.Signature, out StudioSplit seen))
                {
                    if (SizeFit(split) > SizeFit(seen) + 1e-9) bySignature[split.Signature] = split;
                    continue;
                }
                bySignature[split.Signature] = split;
                order.Add(split.Signature);
            }
            if (order.Count == 0)
            {
                // Хэт гүн давхар: өөр хувилбар байхгүй үед л гүн айлтай хуваалтыг үзүүлнэ.
                foreach (StudioSplit split in deep)
                    if (!bySignature.ContainsKey(split.Signature)) { bySignature[split.Signature] = split; order.Add(split.Signature); }
            }
            return order.Select(k => bySignature[k]).ToList();
        }

        /// <summary>Хуваалтын геометрийн гарын үсэг: айлуудын тэгш өнцөгт + унтлагын тоо, коридор, хонгил (мм).</summary>
        public static string Signature(FloorPlateLayout layout)
        {
            string R(double v) { return Math.Round(v * 1000).ToString(CultureInfo.InvariantCulture); }
            var parts = layout.Units
                .Select(u => R(u.X1) + "," + R(u.Y1) + "," + R(u.X2) + "," + R(u.Y2) + ":" + u.Bedrooms)
                .OrderBy(x => x, StringComparer.Ordinal).ToList();
            parts.Add("c" + R(layout.Corridor.X1) + "," + R(layout.Corridor.Y1) + "," + R(layout.Corridor.X2) + "," + R(layout.Corridor.Y2));
            if (layout.Core != null) parts.Add("k" + R(layout.Core.X1) + "," + R(layout.Core.Y1) + "," + R(layout.Core.X2) + "," + R(layout.Core.Y2));
            return string.Join("|", parts);
        }

        /// <summary>Айлын хүсэлтийн түлхүүр — ижил түлхүүртэй айлд Python-ыг нэг л удаа дуудна (мм нарийвчлал).</summary>
        public static string UnitKey(FloorUnit u, double exteriorThickness)
        {
            string R(double v) { return Math.Round(v * 1000).ToString(CultureInfo.InvariantCulture); }
            return R(u.X2 - u.X1) + "x" + R(u.Y2 - u.Y1) + "|" + u.Bedrooms + "b" + u.Bathrooms + "|" + u.Entry + "|" +
                   string.Join("+", u.Facades.OrderBy(f => f, StringComparer.Ordinal)) + "|" + u.Tier + "|" + R(exteriorThickness);
        }

        // ── 3. Хослуулах ───────────────────────────────────────────────

        /// <summary>
        /// Хуваалт бүрд айлуудын дотор планыг хэд хэдэн загвараар хослуулна.  <paramref name="optionsOf"/> айлын бүх
        /// хувилбарыг (Python-ы эрэмбээр) өгнө; хоосон бол тэр хуваалт бүхэлдээ хасагдана (айлгүй өрөө байж болохгүй).
        /// </summary>
        public static List<StudioCandidate> Compose(IEnumerable<StudioSplit> splits, Func<StudioSplit, FloorUnit, IReadOnlyList<StudioUnitOption>> optionsOf)
        {
            var pool = new List<StudioCandidate>();
            var seen = new HashSet<string>(StringComparer.Ordinal);
            foreach (StudioSplit split in splits)
            {
                List<FloorUnit> units = split.Layout.Units.OrderBy(u => u.Id, StringComparer.Ordinal).ToList();
                var lists = new Dictionary<string, List<StudioUnitOption>>(StringComparer.Ordinal);
                bool missing = false;
                foreach (FloorUnit u in units)
                {
                    List<StudioUnitOption> list = LitFirst(optionsOf(split, u) ?? new StudioUnitOption[0]);
                    if (list.Count == 0) { missing = true; break; }
                    lists[u.Id] = list;
                }
                if (missing) continue;

                var styles = new List<(string name, Func<List<StudioUnitOption>, IEnumerable<StudioUnitOption>> pref)>
                {
                    ("best", l => l),
                };
                // Айлууд ижил төрлийн коридортой бол давхар ойлгомжтой: түгээмэл топологи бүрээр нэг хослол.
                foreach (string topology in lists.Values.SelectMany(l => l.Where(o => o.FullyLit).Take(4)).Select(o => o.Topology)
                             .Where(t => !string.IsNullOrEmpty(t)).GroupBy(t => t).OrderByDescending(g => g.Count()).ThenBy(g => g.Key, StringComparer.Ordinal)
                             .Select(g => g.Key).Take(4))
                {
                    string t = topology;
                    styles.Add(("style:" + t, l => l.Where(o => o.Topology == t && o.FullyLit).Concat(l)));
                }
                styles.Add(("alt1", l => l.Skip(1).Concat(l.Take(1))));
                styles.Add(("alt2", l => l.Skip(2).Concat(l.Take(2))));
                styles.Add(("alt3", l => l.Skip(3).Concat(l.Take(3))));

                int made = 0;
                foreach (var (name, pref) in styles)
                {
                    if (made >= MaxPerSplit) break;
                    var cand = new StudioCandidate { Split = split, Style = name };
                    bool ok = true;
                    foreach (FloorUnit u in units)
                    {
                        StudioUnitOption pick = null;
                        foreach (StudioUnitOption o in pref(lists[u.Id]))
                            if (DoorConflict(split.Layout, cand.Choice, u, o) == null) { pick = o; break; }
                        if (pick == null) { ok = false; break; }
                        cand.Choice[u.Id] = pick;
                    }
                    if (!ok) continue;
                    cand.Signature = split.Signature + "|" + split.Tier + "|" + string.Join(",", units.Select(u => cand.Choice[u.Id].OptionId));
                    if (!seen.Add(cand.Signature)) continue;
                    ScoreCandidate(cand);
                    pool.Add(cand);
                    made++;
                }
            }
            return pool.OrderByDescending(c => c.Score).ThenBy(c => c.Signature, StringComparer.Ordinal).Take(MaxPool).ToList();
        }

        /// <summary>Бүх өрөө цонхтой хувилбар түрүүлнэ (Python-ы оноогоор), дараа нь бусад — `RoomPlanBatchApply.BestFirst`-тэй ижил дүрэм.</summary>
        public static List<StudioUnitOption> LitFirst(IEnumerable<StudioUnitOption> options)
        {
            List<StudioUnitOption> list = options.Where(o => o != null && o.Plan != null).OrderByDescending(o => o.Score).ToList();
            return list.Where(o => o.FullyLit).Concat(list.Where(o => !o.FullyLit)).ToList();
        }

        /// <summary>
        /// Шинэ айлын орох хаалга аль хэдийн сонгосон айлын хаалгатай нэг шугамын хананд (коридорын хана эгнээний бүх
        /// орцыг тээнэ) <see cref="DoorSpacing"/>-ээс ойр байвал мессеж, эс бөгөөс null.
        /// </summary>
        public static string DoorConflict(FloorPlateLayout layout, IReadOnlyDictionary<string, StudioUnitOption> chosen, FloorUnit unit, StudioUnitOption option)
        {
            var units = layout.Units.ToDictionary(u => u.Id, StringComparer.Ordinal);
            foreach (var (line, horizontal, x, y) in PerimeterDoors(unit, option))
                foreach (var pair in chosen)
                {
                    if (!units.TryGetValue(pair.Key, out FloorUnit other)) continue;
                    foreach (var (oline, ohorizontal, ox, oy) in PerimeterDoors(other, pair.Value))
                        if (horizontal == ohorizontal && Math.Abs(line - oline) < 0.01 &&
                            Math.Sqrt((x - ox) * (x - ox) + (y - oy) * (y - oy)) < DoorSpacing)
                            return "Нэг хананд давхцах орох хаалга: " + other.Id + " ба " + unit.Id;
                }
            return null;
        }

        private static IEnumerable<(double line, bool horizontal, double x, double y)> PerimeterDoors(FloorUnit u, StudioUnitOption o)
        {
            foreach (PlanDoor d in o.Plan.Doors)
            {
                double x = u.X1 + d.Center.X, y = u.Y1 + d.Center.Y;
                switch (d.HostWall)
                {
                    case "south": yield return (u.Y1, true, x, y); break;
                    case "north": yield return (u.Y2, true, x, y); break;
                    case "west": yield return (u.X1, false, x, y); break;
                    case "east": yield return (u.X2, false, x, y); break;
                }
            }
        }

        // ── 4. Оноо ─────────────────────────────────────────────────────

        /// <summary>
        /// 0–100.  Хэсэг бүр 0–1: тав тух (айлын Python оноо, талбайгаар жинлэсэн), өдрийн гэрэл (бүх өрөө цонхтой айлын
        /// талбайн хувь; дутуу айлд (гэрэлтэй/амьдрах)²), агаар сэлгэлт (хоёр талдаа цонхтой айлын хувь — Finch-ийн
        /// «dual aspect»), үр ашиг (айлын талбай / давхрын талбай, 65 % → 0, 88 % → 1), харьцаа (зорилтот харьцаанаас
        /// хазайлт), хэмжээ (зэрэглэлийн зорилтот талбайгаас хазайлт), ойлгомжтой байдал (хамгийн түгээмэл коридорын
        /// төрөлтэй айлын хувь).
        /// </summary>
        public static void ScoreCandidate(StudioCandidate c)
        {
            FloorPlateLayout l = c.Split.Layout;
            double area = Math.Max(1e-9, l.Units.Sum(u => u.Area));
            double comfort = 0, daylight = 0;
            int lit = 0;
            foreach (FloorUnit u in l.Units)
            {
                StudioUnitOption o = c.Choice[u.Id];
                comfort += u.Area * Math.Max(0, Math.Min(100, o.Score)) / 100;
                double ratio = o.Habitable <= 0 ? 1 : Math.Min(1.0, (double)o.Daylit / o.Habitable);
                daylight += u.Area * (o.FullyLit ? 1 : ratio * ratio);
                if (o.FullyLit) lit++;
            }
            int dual = l.Units.Count(u => u.Facades.Count >= 2);
            double ventilation = (double)dual / l.Units.Count;
            double efficiency = Clamp01((l.Efficiency - 0.65) / (0.88 - 0.65));
            double mix = 1 - MixDeviation(l, c.Split.Preset.Mix);
            double size = SizeFit(c.Split);
            string common = c.Choice.Values.GroupBy(o => o.Topology ?? "").OrderByDescending(g => g.Count()).First().Key;
            double clarity = (double)c.Choice.Values.Count(o => (o.Topology ?? "") == common) / c.Choice.Count;

            c.Parts["comfort"] = comfort / area;
            c.Parts["daylight"] = daylight / area;
            c.Parts["ventilation"] = ventilation;
            c.Parts["efficiency"] = efficiency;
            c.Parts["mix"] = mix;
            c.Parts["size"] = size;
            c.Parts["clarity"] = clarity;
            c.LitUnits = lit;
            c.DualAspectUnits = dual;
            c.Score = Math.Round(100 * PartKeys.Sum(k => Weights[k] * c.Parts[k]), 2);
        }

        /// <summary>Айлын тоон харьцааны зорилтоос хазайлт (0 = яг таарсан, 1 = огт таараагүй).</summary>
        public static double MixDeviation(FloorPlateLayout l, double[] mix)
        {
            double sum = mix.Sum();
            if (sum <= 0 || l.Units.Count == 0) return 1;
            double dev = 0;
            for (int b = 1; b <= 4; b++) dev += Math.Abs((double)l.Count(b) / l.Units.Count - mix[b - 1] / sum);
            return Clamp01(dev / 2);
        }

        /// <summary>Айлын талбай зэрэглэлийн зорилтот талбайд хэр ойр: 1 = яг, 0 = дунджаар ±65 %-иас их зөрүү.</summary>
        public static double SizeFit(StudioSplit split)
        {
            FloorPlateLayout l = split.Layout;
            if (l.Units.Count == 0) return 0;
            double dev = l.Units.Average(u => Math.Abs(Math.Log(u.Area / FloorPlateSplitter.TargetArea(split.Tier, u.Bedrooms))));
            return Clamp01(1 - dev / 0.5);
        }

        // ── 5. Санал болгох ────────────────────────────────────────────

        /// <summary>
        /// Шилдэг <paramref name="count"/>: оноогоор, гэхдээ олон янз — эхний ээлжинд нэг хуваалтаас 2, нэг «гэр бүл»-ээс (схем,
        /// хонгил, харьцаа, зэрэглэл) 2, нэг зэрэглэлээс 45 %, нэг харьцаанаас 30 %-иас олныг авахгүй; дутвал хязгаарыг сулруулна.
        /// <paramref name="tier"/>/<paramref name="preset"/> нь шүүлтүүр (null = бүгд).
        /// </summary>
        public static List<StudioCandidate> Recommend(IEnumerable<StudioCandidate> pool, int count, string tier = null, string preset = null)
        {
            List<StudioCandidate> ranked = pool
                .Where(c => (tier == null || c.Split.Tier == tier) && (preset == null || c.Split.Preset.Key == preset))
                .OrderByDescending(c => c.Score).ThenBy(c => c.Signature, StringComparer.Ordinal).ToList();
            var picked = new List<StudioCandidate>();
            var used = new HashSet<StudioCandidate>();
            // Эхний ээлж: зэрэглэл бүрээс ≤ 45 %, харьцаа бүрээс ≤ 30 % — цөөн том айлтай «тансаг» давхар (бүх айл булан → агаар
            // сэлгэлт 100 %) жагсаалтыг бүхэлд нь эзлэхгүй (2026-10-14-ний run: шилдэг 20-ын 17 нь тансаг байв).  Дараа нь сулруулна.
            int Share(double f) { return Math.Max(1, (int)Math.Ceiling(count * f)); }
            var passes = new[]
            {
                (split: 2, family: 2, tier: Share(0.45), mix: Share(0.30)),
                (split: 3, family: 4, tier: Share(0.65), mix: Share(0.45)),
                (split: int.MaxValue, family: int.MaxValue, tier: int.MaxValue, mix: int.MaxValue),
            };
            foreach (var pass in passes)
            {
                var splitCount = new Dictionary<string, int>(StringComparer.Ordinal);
                var familyCount = new Dictionary<string, int>(StringComparer.Ordinal);
                var tierCount = new Dictionary<string, int>(StringComparer.Ordinal);
                var mixCount = new Dictionary<string, int>(StringComparer.Ordinal);
                void Take(StudioCandidate c)
                {
                    Bump(splitCount, c.Split.Signature);
                    Bump(familyCount, Family(c));
                    Bump(tierCount, c.Split.Tier);
                    Bump(mixCount, c.Split.Preset.Key);
                }
                foreach (StudioCandidate c in picked) Take(c);
                foreach (StudioCandidate c in ranked)
                {
                    if (picked.Count >= count) break;
                    if (used.Contains(c)) continue;
                    if (Count(splitCount, c.Split.Signature) >= pass.split || Count(familyCount, Family(c)) >= pass.family ||
                        Count(tierCount, c.Split.Tier) >= pass.tier || Count(mixCount, c.Split.Preset.Key) >= pass.mix) continue;
                    picked.Add(c); used.Add(c);
                    Take(c);
                }
                if (picked.Count >= count) break;
            }
            picked = picked.OrderByDescending(c => c.Score).ThenBy(c => c.Signature, StringComparer.Ordinal).ToList();
            for (int i = 0; i < picked.Count; i++) picked[i].Rank = i + 1;
            return picked;
        }

        private static string Family(StudioCandidate c)
        {
            FloorPlateInput i = c.Split.Input;
            return c.Split.Layout.Scheme + "|" + i.SingleOnLowSide + "|" + i.Core + "|" + i.CoreAtLowEnd + "|" + c.Split.Preset.Key + "|" + i.Tier;
        }

        private static void Bump(Dictionary<string, int> d, string k) { d[k] = Count(d, k) + 1; }
        private static int Count(Dictionary<string, int> d, string k) { return d.TryGetValue(k, out int n) ? n : 0; }

        /// <summary>Хувилбарын товч тайлбар: «Төв коридор · хонгил төвд · Тэнцвэртэй · Дунд».</summary>
        public static string Describe(StudioSplit s)
        {
            FloorPlateLayout l = s.Layout;
            string scheme = l.Scheme == CorridorScheme.Double ? "Төв коридор" : "Галерей коридор";
            string core = "хонгилгүй";
            if (l.Core != null)
            {
                // Коридорын дагуух тэнхлэгээр хонгилын төв давхрын голд уу (хуваагч төвийнхийг төгсгөлд шилжүүлж болно).
                bool xLong = l.Width >= l.Height;
                double mid = xLong ? (l.Core.X1 + l.Core.X2) / 2 : (l.Core.Y1 + l.Core.Y2) / 2;
                double len = xLong ? l.Width : l.Height;
                core = Math.Abs(mid - len / 2) < 0.5 ? "хонгил төвд" : "хонгил төгсгөлд";
            }
            return scheme + " · " + core + " · " + s.Preset.Label + " · " + TierLabel(s.Tier);
        }

        /// <summary>«2ӨА×2 3ӨА×3 4ӨА×1».</summary>
        public static string MixText(FloorPlateLayout l)
        {
            return string.Join(" ", Enumerable.Range(1, 4).Where(b => l.Count(b) > 0).Select(b => b + "ӨА×" + l.Count(b)));
        }

        private static double Clamp01(double x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
    }
}
