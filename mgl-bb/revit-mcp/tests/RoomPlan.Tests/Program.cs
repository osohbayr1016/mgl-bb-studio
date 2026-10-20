using System;
using System.Collections.Generic;
using System.Linq;
using RevitMcpAddin.RoomPlan.Core;

internal static class Program
{
    private static int _count;
    private static void Check(bool value, string reason)
    {
        _count++;
        if (!value) throw new Exception("FAIL: " + reason);
    }
    private static void Near(double a, double b, string reason)
    {
        Check(Math.Abs(a - b) < 1e-7, reason + ": " + a + " != " + b);
    }
    private static void Throws(Action action, string reason)
    {
        try { action(); }
        catch (ArgumentException) { _count++; return; }
        throw new Exception("Expected argument validation: " + reason);
    }
    private static double Intersection(PlanRoom a, PlanRoom b)
    {
        return Math.Max(0, Math.Min(a.X2, b.X2) - Math.Max(a.X1, b.X1)) *
               Math.Max(0, Math.Min(a.Y2, b.Y2) - Math.Max(a.Y1, b.Y1));
    }
    public static int Main()
    {
        for (int bedrooms = 1; bedrooms <= 3; bedrooms++)
        for (int variant = 0; variant < 27; variant++)
        foreach (var size in new[] { (12.0, 11.0), (18.0, 14.0) })
        {
            var plan = RoomPlanGenerator.Generate(size.Item1, size.Item2, bedrooms, variant);
            Check(plan.Rooms.Count == bedrooms + 3, "living+bath+hall+bedrooms");
            var furniture = FurniturePlanner.Create(plan);
            Check(furniture.Count == bedrooms + 4, "bedrooms + sofa kitchen toilet basin");
            Check(FurniturePlanner.Safe(furniture, plan, out var furnitureProblem),
                "door/furniture collisions: " + furnitureProblem);
            Check(plan.Doors.Count == plan.Rooms.Count, "entry and one door per side room");
            Check(plan.Walls.Count == (bedrooms == 1 ? 7 : bedrooms == 2 ? 8 : 9), "walls count");
            Check(plan.Rooms.Select(r => r.Name).Distinct().Count() == plan.Rooms.Count, "names unique");
            Near(plan.Rooms.Sum(r => r.Area), plan.Width * plan.Height, "complete area cover");
            foreach (PlanRoom room in plan.Rooms)
            {
                Check(room.Area > 3, "no tiny rooms");
                Check(room.X1 >= 0 && room.Y1 >= 0 &&
                    room.X2 <= plan.Width && room.Y2 <= plan.Height, "rooms in footprint");
            }
            for (int i = 0; i < plan.Rooms.Count; i++)
                for (int j = i + 1; j < plan.Rooms.Count; j++)
                    Near(Intersection(plan.Rooms[i], plan.Rooms[j]), 0, "no overlapping rooms");
            foreach (PlanWall wall in plan.Walls)
                Check(Math.Abs(wall.End.X - wall.Start.X) +
                      Math.Abs(wall.End.Y - wall.Start.Y) > 0, "zero length wall");
            foreach (PlanDoor door in plan.Doors)
            {
                var host = plan.Walls.SingleOrDefault(w => w.Id == door.HostWall);
                Check(host != null, "host wall exists");
                bool v = Math.Abs(host.Start.X - host.End.X) < 1e-7;
                Check(v ? Math.Abs(host.Start.X - door.Center.X) < 1e-7 :
                    Math.Abs(host.Start.Y - door.Center.Y) < 1e-7, "door on host axis");
                double position = v ? door.Center.Y : door.Center.X;
                double min = v ? Math.Min(host.Start.Y, host.End.Y) : Math.Min(host.Start.X, host.End.X);
                double max = v ? Math.Max(host.Start.Y, host.End.Y) : Math.Max(host.Start.X, host.End.X);
                Check(position > min + 1 && position < max - 1, "door away from wall ends");
            }
            var again = RoomPlanGenerator.Generate(size.Item1, size.Item2, bedrooms, variant);
            Near(again.Rooms.Sum(x => x.Area), plan.Rooms.Sum(x => x.Area), "repeat deterministic");
        }
        Throws(() => RoomPlanGenerator.Generate(8, 8, 2, 0), "narrow width");
        Throws(() => RoomPlanGenerator.Generate(11.5, 9.9, 3, 0), "short 3br");
        Throws(() => RoomPlanGenerator.Generate(11, 11, 0, 0), "0br");
        Throws(() => RoomPlanGenerator.Generate(11, 11, 2, 27), "invalid variant");
        Throws(() => RoomPlanGenerator.Generate(double.NaN, 10, 2, 0), "NaN");
        Throws(() => RoomPlanGenerator.Generate(double.PositiveInfinity, 10, 2, 0), "infinity");
        Throws(() => RoomPlanGenerator.Generate(31, 10, 2, 0), "oversized");
        foreach (int bedroomCount in new[] { 1, 2, 3 })
        {
            var ranked = RoomPlanRanking.GenerateOptions(12.0, 11.0, bedroomCount);
            Check(ranked.Count >= 15, "many genuinely distinct candidates for " + bedroomCount);
            Check(ranked.Select(x => x.Plan.Variant).Distinct().Count() == ranked.Count,
                "no repeat variant");
            Check(ranked.SequenceEqual(ranked.OrderByDescending(x => x.Score).ThenBy(x => x.Plan.Variant)),
                "ranked descending");
            foreach (var candidate in ranked)
            {
                Check(candidate.Score > 0 && candidate.Score < 100, "score is heuristic not compliance");
                Check(RoomPlanRanking.GeometrySafe(candidate.Plan, out var _), "ranked candidate passes geometry checks");
            }
            // Deterministic recommendation order across repeated generation.
            var repeated = RoomPlanRanking.GenerateOptions(12.0, 11.0, bedroomCount);
            Check(ranked.Select(x => x.Plan.Variant).SequenceEqual(repeated.Select(x => x.Plan.Variant)),
                "ranking deterministic");
        }
        foreach (PlanEntrySide entry in Enum.GetValues(typeof(PlanEntrySide)))
        foreach (int bedrooms in new[] { 1, 2, 3 })
        {
            var options = RoomPlanRanking.GenerateOptions(12, 11, bedrooms, entry);
            if (options.Count == 0)
            {
                for (int v = 0; v < 3; v++)
                {
                    try
                    {
                        bool turn = entry == PlanEntrySide.East || entry == PlanEntrySide.West;
                        var raw = RoomPlanGenerator.Generate(turn ? 11 : 12, turn ? 12 : 11, bedrooms, v);
                        var oriented = RoomPlanTransform.ToEntrySide(raw, entry);
                        if (!RoomPlanRanking.GeometrySafe(oriented, out var why))
                            Console.WriteLine("Diagnostic " + entry + " / " + bedrooms + " / " + v + ": " + why);
                        else
                        {
                            try { FurniturePlanner.Create(oriented); }
                            catch (ArgumentException ex)
                            { Console.WriteLine("Diagnostic furniture " + entry + " / " + bedrooms + " / " + v + ": " + ex.Message); }
                        }
                    }
                    catch (ArgumentException ex) { Console.WriteLine("Diagnostic input: " + ex.Message); }
                }
            }
            Check(options.Count > 0, "entry wall orientation supports candidate " + entry);
            foreach (var option in options)
            {
                var plan = option.Plan;
                Check(plan.Width == 12 && plan.Height == 11, "same footprint after rotate");
                Check(plan.Doors[0].HostWall.Equals(entry.ToString(), StringComparison.OrdinalIgnoreCase),
                    "entrance is on selected wall");
                Check(plan.Walls.Select(w => w.Id).Distinct().Count() == plan.Walls.Count,
                    "wall IDs remain unique");
                Check(RoomPlanRanking.GeometrySafe(plan, out var _), "rotated door geometry valid");
                Check(FurniturePlanner.Safe(FurniturePlanner.Create(plan), plan, out var _),
                    "rotated furniture geometry valid");
            }
        }
        PlanCheckTests();
        FloorPlateTests();
        FloorStudioTests();
        Console.WriteLine("PASS RoomPlan geometry: " + _count + " assertions");
        return 0;
    }

    /// <summary>
    /// FloorPlateSplitter (2026-10-14) — давхрын контурыг коридор, шатны хонгил, айлуудад хуваах.
    /// Айл бүр Python хөдөлгүүрийн доод хэмжээнээс (7.8 м, 3–4 унтлагын өргөн) багагүй, давхцалгүй,
    /// коридор + хонгил + айлууд давхрыг яг бүрхэнэ, орц коридор руу, цонх гадна ханан дээр.
    /// </summary>
    private static void FloorPlateTests()
    {
        void Valid(FloorPlateInput input, string label)
        {
            var layout = FloorPlateSplitter.Split(input);
            Check(layout.Error == null, label + ": " + layout.Error);
            Check(layout.Units.Count >= 1 && layout.Units.Count <= FloorPlateSplitter.MaxUnits, label + ": unit count");
            Check(layout.Units.Select(u => u.Id).Distinct().Count() == layout.Units.Count, label + ": ids unique");
            double covered = layout.Units.Sum(u => u.Area) + layout.Corridor.Area + (layout.Core?.Area ?? 0);
            Check(Math.Abs(covered - input.Width * input.Height) < 1e-6, label + ": units + corridor + core cover the floor (" + covered + ")");
            var all = layout.Units.Select(u => (u.X1, u.Y1, u.X2, u.Y2)).ToList();
            all.Add((layout.Corridor.X1, layout.Corridor.Y1, layout.Corridor.X2, layout.Corridor.Y2));
            if (layout.Core != null) all.Add((layout.Core.X1, layout.Core.Y1, layout.Core.X2, layout.Core.Y2));
            for (int i = 0; i < all.Count; i++)
                for (int j = i + 1; j < all.Count; j++)
                {
                    double ov = Math.Max(0, Math.Min(all[i].X2, all[j].X2) - Math.Max(all[i].X1, all[j].X1)) *
                                Math.Max(0, Math.Min(all[i].Y2, all[j].Y2) - Math.Max(all[i].Y1, all[j].Y1));
                    Check(ov < 1e-6, label + ": no overlap " + i + "/" + j);
                }
            foreach (FloorUnit u in layout.Units)
            {
                Check(u.X1 >= -1e-9 && u.Y1 >= -1e-9 && u.X2 <= input.Width + 1e-9 && u.Y2 <= input.Height + 1e-9, label + ": inside");
                double w = input.Width >= input.Height ? u.Width : u.Depth, d = input.Width >= input.Height ? u.Depth : u.Width;
                Check(Math.Min(u.Width, u.Depth) >= FloorPlateSplitter.MinSide - 1e-9, label + ": " + u.Id + " engine min side");
                Check(w >= FloorPlateSplitter.MinWidth(u.Bedrooms, d) - 1e-9, label + ": " + u.Id + " min width for " + u.Bedrooms + " beds");
                // Бүх өрөө цонхтой байх өргөн: булангийн айл (эгнээний гадна үзүүр) хоёр талдаа цонхтой.
                if (layout.AllLit)
                    Check(w >= FloorPlateSplitter.LitWidth(u.Bedrooms, d, u.Facades.Count >= 2) - 1e-9,
                        label + ": " + u.Id + " " + u.Bedrooms + "BR " + w.ToString("0.00") + " m wide lets every room have a window");
                Check(!u.Facades.Contains(u.Entry), label + ": entry is not a window side");
                Check(u.Facades.Count >= 1, label + ": daylight side");
                // Орц коридор руу: орцны тал коридорын тэгш өнцөгттэй шүргэнэ.
                double line = u.Entry == "south" ? u.Y1 : u.Entry == "north" ? u.Y2 : u.Entry == "west" ? u.X1 : u.X2;
                bool horizontal = u.Entry == "south" || u.Entry == "north";
                double c1 = horizontal ? layout.Corridor.Y1 : layout.Corridor.X1, c2 = horizontal ? layout.Corridor.Y2 : layout.Corridor.X2;
                Check(Math.Abs(line - c1) < 1e-6 || Math.Abs(line - c2) < 1e-6, label + ": " + u.Id + " entry faces the corridor");
                Check(u.Bathrooms == (u.Bedrooms >= 3 || u.Area >= 85 ? 2 : 1), label + ": bathrooms");
            }
            foreach (FloorWall wall in layout.Walls)
                Check(Math.Abs(wall.X1 - wall.X2) < 1e-9 || Math.Abs(wall.Y1 - wall.Y2) < 1e-9, label + ": wall axis-aligned");
        }
        // Хоёр талдаа айлтай (18 м гүн), төвд хонгил.
        var dbl = new FloorPlateInput { Width = 40, Height = 18 };
        Valid(dbl, "40x18");
        var dl = FloorPlateSplitter.Split(dbl);
        Check(dl.Scheme == CorridorScheme.Double, "18 м гүн → төв коридор");
        Check(dl.Core != null && Math.Abs(dl.Core.X2 - dl.Core.X1 - 6.0) < 1e-9, "core 6 m");
        Check(dl.Units.Any(u => u.Facades.Contains("west")) && dl.Units.Any(u => u.Facades.Contains("east")), "corner units get the end facade");
        Check(dl.Walls.Count(w => w.Kind == "corridor") == 3, "corridor wall split around the open core: " + dl.Walls.Count(w => w.Kind == "corridor"));
        // 2026-10-14 live gate: энэ давхрын дунд айлуудад унтлагын өрөө цонхгүй гарч байсан (U02 ☀3/4, U03 ☀2/3).
        Check(dl.AllLit, "40x18 default mix: every room in every apartment can have a window");
        Check(!dl.Notes.Any(n => n.StartsWith("⚠")), "no daylight warning when every room is lit");
        foreach (FloorUnit u in dl.Units.Where(x => x.Facades.Count == 1))
            Check(u.Width >= FloorPlateSplitter.LitWidth(u.Bedrooms, u.Depth, false) - 1e-9,
                "40x18 mid " + u.Id + " " + u.Bedrooms + "BR is " + u.Width.ToString("0.00") + " m (≥ lit width)");
        // Зөвхөн 4 өрөөтэй, 40 м: эгнээнд хоёр айл бол хэт өргөн (f > 1.35), гурав бол дунд айл нь 13.85 м хүрэхгүй →
        // цонхтой хуваалт байхгүй; Python-ы доод өргөнөөр хуваагаад ИЛ анхааруулна.
        var dark = FloorPlateSplitter.Split(new FloorPlateInput { Width = 40, Height = 18, Core = CorePosition.None, Mix = new[] { 0.0, 0, 0, 1 } });
        Check(dark.Error == null && !dark.AllLit, "all-4BR 40 m storey falls back to engine minimum widths");
        Check(dark.Notes.Any(n => n.StartsWith("⚠") && n.Contains("цонх")), "fallback says some rooms may have no window");
        Check(FloorPlateSplitter.LitWidth(3, 8.1, false) > FloorPlateSplitter.LitWidth(3, 8.1, true), "corner 3BR may be narrower than a mid one");
        Check(FloorPlateSplitter.LitWidth(4, 7.8, false) >= FloorPlateSplitter.LitWidth(4, 12, false), "lit width never grows with depth");
        // Нэг талдаа айлтай (12 м гүн).
        var sgl = new FloorPlateInput { Width = 36, Height = 12 };
        Valid(sgl, "36x12");
        Check(FloorPlateSplitter.Split(sgl).Scheme == CorridorScheme.Single, "12 м → галерей");
        Valid(new FloorPlateInput { Width = 36, Height = 12, SingleOnLowSide = true }, "36x12 low gallery");
        // Босоо урт барилга: цонх баруун/зүүн талд.
        var tall = FloorPlateSplitter.Split(new FloorPlateInput { Width = 18, Height = 44 });
        Valid(new FloorPlateInput { Width = 18, Height = 44 }, "18x44");
        Check(tall.Units.All(u => u.Entry == "east" || u.Entry == "west"), "N-S building: entries face the corridor sideways");
        // Хонгилгүй, зөвхөн 1 унтлагын, тансаг, эзний харьцаа.
        Valid(new FloorPlateInput { Width = 60, Height = 18, Core = CorePosition.None, Mix = new[] { 1.0, 0, 0, 0 } }, "60x18 1BR");
        Valid(new FloorPlateInput { Width = 48, Height = 20, Tier = "luxury", Mix = new[] { 0, 0.3, 0.4, 0.3 } }, "48x20 lux");
        Valid(new FloorPlateInput { Width = 30, Height = 18, Core = CorePosition.End, Tier = "economy" }, "30x18 end core");
        var mixed = FloorPlateSplitter.Split(new FloorPlateInput { Width = 54, Height = 18, Mix = new[] { 0.25, 0.25, 0.25, 0.25 } });
        Check(Enumerable.Range(1, 4).All(b => mixed.Count(b) >= 1), "every requested type appears");
        // Хэт нарийн барилга: тодорхой алдаа.
        Check(FloorPlateSplitter.Split(new FloorPlateInput { Width = 30, Height = 9 }).Error != null, "9 m deep is too shallow");
        Check(FloorPlateSplitter.Split(new FloorPlateInput { Width = 30, Height = 12, Scheme = CorridorScheme.Double }).Error != null, "double forced on 12 m");
        Check(FloorPlateSplitter.Split(new FloorPlateInput { Width = 30, Height = 18, Mix = new[] { 0.0, 0, 0, 0 } }).Error != null, "empty mix");
        Check(FloorPlateSplitter.Apportion(new[] { 0.0, 0.5, 0.3, 0.2 }, 10).SequenceEqual(new[] { 0, 5, 3, 2 }), "apportion");
        // Хурд: цонхонд шууд (оролт өөрчлөгдөх бүрд) дуудагдана.
        var watch = System.Diagnostics.Stopwatch.StartNew();
        double slowest = 0; string slowCase = "";
        foreach (var (w, h) in new[] { (90.0, 18.0), (90.0, 26.0), (80.0, 12.0), (60.0, 20.0), (100.0, 24.0) })
            foreach (var mix in new[] { new[] { 0.25, 0.25, 0.25, 0.25 }, new[] { 0.0, 0.4, 0.4, 0.2 }, new[] { 1.0, 0, 0, 0 } })
            {
                var t0 = watch.Elapsed.TotalMilliseconds;
                FloorPlateSplitter.Split(new FloorPlateInput { Width = w, Height = h, Mix = mix });
                double ms = watch.Elapsed.TotalMilliseconds - t0;
                if (ms > slowest) { slowest = ms; slowCase = w + "x" + h + " " + string.Join("/", mix); }
            }
        Console.WriteLine("FloorPlate slowest split: " + slowest.ToString("0.0") + " ms (" + slowCase + ")");
        Check(slowest < 400, "split fast enough for a live preview: " + slowest + " ms");
        // Олон хэмжээ дээр нурахгүй: алдаа эсвэл хүчинтэй хуваалт.
        for (double w = 16; w <= 90; w += 3.7)
            for (double h = 8; h <= 26; h += 1.3)
            {
                var input = new FloorPlateInput { Width = w, Height = h };
                if (FloorPlateSplitter.Split(input).Error == null) Valid(input, "sweep " + w + "x" + h);
            }
    }

    /// <summary>
    /// FloorStudio (2026-10-14) — нэг товчоор олон зуун давхрын хувилбар, шилдэг 20.  Python-ы оронд хиймэл айлын хувилбар:
    /// айл бүрт 4 хувилбар (2 нь бүх өрөө цонхтой, 2 топологи), орц коридор талын төвөөс эсвэл захаас.
    /// </summary>
    private static void FloorStudioTests()
    {
        // Хуваалт: 40 × 18 — төв коридор, хонгил 3 байрлал × 2 эгнээ × 6 харьцаа × 3 зэрэглэл, геометрээр давхардалгүй.
        var splits = FloorStudio.EnumerateSplits(40, 18, 0.3, 0.2);
        Check(splits.Count >= 30, "40x18 gives many distinct splits: " + splits.Count);
        Check(splits.Select(x => x.Signature).Distinct().Count() == splits.Count, "split signatures are unique");
        Check(splits.All(x => x.Layout.Error == null && x.Layout.RowDepth <= FloorStudio.MaxRowDepth), "no over-deep apartments");
        Check(splits.Any(x => x.Input.Core == CorePosition.End && x.Input.CoreAtLowEnd) &&
              splits.Any(x => x.Input.Core == CorePosition.End && !x.Input.CoreAtLowEnd), "core at both ends");
        Check(splits.Select(x => x.Tier).Distinct().Count() == 3, "all three tiers present");
        // Хонгил u = 0 талд: хонгил 0..6 м, түүний хажуугийн айл 6 м-ээс эхэлнэ, эгнээнд нэг коридорын хана (хонгил коридор руу нээлттэй).
        var lowEnd = FloorPlateSplitter.Split(new FloorPlateInput { Width = 40, Height = 18, Core = CorePosition.End, CoreAtLowEnd = true });
        Check(lowEnd.Error == null && lowEnd.Core != null && Math.Abs(lowEnd.Core.X1) < 1e-9 && Math.Abs(lowEnd.Core.X2 - 6) < 1e-9, "core at the low end");
        Check(lowEnd.Walls.Count(w => w.Kind == "corridor") == 2, "low-end core: one corridor wall per row");
        // Гүн давхар (30 м): айл 12.6 м-ээс гүн — өөр хувилбаргүй тул гүн хуваалтыг ч үзүүлнэ.
        var deep = FloorStudio.EnumerateSplits(40, 30, 0.3, 0.2);
        Check(deep.Count > 0, "very deep storey still offers something");
        // Галерей: 36 × 12 — нэг талдаа айлтай хоёр тал.
        var gallery = FloorStudio.EnumerateSplits(36, 12, 0.3, 0.2);
        Check(gallery.Any(x => x.Input.SingleOnLowSide) && gallery.Any(x => !x.Input.SingleOnLowSide), "gallery on both sides");

        IReadOnlyList<StudioUnitOption> Fake(StudioSplit split, FloorUnit u)
        {
            var list = new List<StudioUnitOption>();
            double w = u.X2 - u.X1, d = u.Y2 - u.Y1;
            for (int k = 0; k < 4; k++)
            {
                var plan = new GeneratedPlan { Width = w, Height = d, Bedrooms = u.Bedrooms };
                // Орц: k тэгш бол хананы төвд, сондгой бол зүүн захаас 0.8 м-т.
                double along = k % 2 == 0 ? 0.5 : 0.0;
                PlanPoint at = u.Entry == "north" ? new PlanPoint(k % 2 == 0 ? w / 2 : 0.8, d)
                             : u.Entry == "south" ? new PlanPoint(k % 2 == 0 ? w / 2 : 0.8, 0)
                             : u.Entry == "west" ? new PlanPoint(0, k % 2 == 0 ? d / 2 : 0.8)
                             : new PlanPoint(w, k % 2 == 0 ? d / 2 : 0.8);
                plan.Doors.Add(new PlanDoor(u.Entry, at.X, at.Y));
                list.Add(new StudioUnitOption
                {
                    OptionId = FloorStudio.UnitKey(u, 0.3) + "#" + k + "#" + along, Topology = k < 2 ? "t-hall" : "l-hall",
                    Score = 90 - 5 * k, Daylit = k == 1 ? 2 : 3, Habitable = 3, Plan = plan,
                });
            }
            return list;
        }
        var pool = FloorStudio.Compose(splits, Fake);
        Check(pool.Count >= 100, "at least 100 whole-floor candidates: " + pool.Count);
        Check(pool.Count <= FloorStudio.MaxPool, "pool capped");
        Check(pool.Select(c => c.Signature).Distinct().Count() == pool.Count, "candidates are not duplicated");
        foreach (StudioCandidate c in pool)
        {
            Check(c.Choice.Count == c.Split.Layout.Units.Count, "every apartment has a plan");
            Check(c.Score > 0 && c.Score <= 100, "score in range");
            foreach (string k in FloorStudio.PartKeys) Check(c.Parts[k] >= 0 && c.Parts[k] <= 1, "part " + k + " in 0..1");
            // Хаалга: нэг хананд хоёр айлын орц 1 м-ээс ойр биш.
            var chosen = new Dictionary<string, StudioUnitOption>(StringComparer.Ordinal);
            foreach (FloorUnit u in c.Split.Layout.Units.OrderBy(x => x.Id, StringComparer.Ordinal))
            {
                Check(FloorStudio.DoorConflict(c.Split.Layout, chosen, u, c.Choice[u.Id]) == null, "no entry door clash in " + c.Signature);
                chosen[u.Id] = c.Choice[u.Id];
            }
        }
        Check(pool.SequenceEqual(pool.OrderByDescending(c => c.Score).ThenBy(c => c.Signature, StringComparer.Ordinal)), "pool sorted by score");
        // Бүх өрөө цонхтой хувилбар илүү оноотой: «best» хослол ☀ бүрэн хувилбарыг сонгоно.
        Check(pool.Where(c => c.Style == "best").All(c => c.Choice.Values.All(o => o.FullyLit)), "best style takes fully lit plans first");

        var top = FloorStudio.Recommend(pool, 20);
        Check(top.Count == 20, "20 recommended");
        Check(top.Select(c => c.Signature).Distinct().Count() == 20, "recommended are distinct");
        Check(top.GroupBy(c => c.Split.Signature).All(g => g.Count() <= 2), "at most 2 per split in the top 20");
        Check(top.Select((c, i) => c.Rank == i + 1).All(x => x), "ranks 1..20");
        // Олон янз: нэг зэрэглэл эсвэл нэг харьцаа жагсаалтыг эзлэхгүй (2026-10-14 run: 20-ын 17 нь тансаг байв).
        Check(top.Select(c => c.Split.Tier).Distinct().Count() >= 2, "top 20 spans tiers: " + string.Join(",", top.Select(c => c.Split.Tier).Distinct()));
        Check(top.GroupBy(c => c.Split.Tier).All(g => g.Count() <= 9), "no tier takes more than 45 % of the top 20");
        Check(top.Select(c => c.Split.Preset.Key).Distinct().Count() >= 3, "top 20 spans mixes");
        Check(top[0].Score >= top[19].Score, "ordered by score");
        var lux = FloorStudio.Recommend(pool, 20, tier: "luxury");
        Check(lux.Count > 0 && lux.All(c => c.Split.Tier == "luxury"), "tier filter");
        var fam = FloorStudio.Recommend(pool, 20, preset: "family");
        Check(fam.All(c => c.Split.Preset.Key == "family"), "mix filter");

        // Хаалганы давхцал: хоёр айлын орц нэг хананд 1 м-ээс ойр бол барина.
        var two = FloorPlateSplitter.Split(new FloorPlateInput { Width = 40, Height = 18, Core = CorePosition.None, Mix = new[] { 0.0, 1, 0, 0 } });
        FloorUnit a = two.Units.First(x => x.Entry == "north"), b = two.Units.First(x => x.Entry == "north" && Math.Abs(x.X1 - a.X2) < 1e-6);
        var planA = new GeneratedPlan { Width = a.X2 - a.X1, Height = a.Y2 - a.Y1 };
        planA.Doors.Add(new PlanDoor("north", a.X2 - a.X1 - 0.3, a.Y2 - a.Y1));
        var planB = new GeneratedPlan { Width = b.X2 - b.X1, Height = b.Y2 - b.Y1 };
        planB.Doors.Add(new PlanDoor("north", 0.3, b.Y2 - b.Y1));
        var near = new Dictionary<string, StudioUnitOption>(StringComparer.Ordinal) { [a.Id] = new StudioUnitOption { OptionId = "a", Plan = planA } };
        Check(FloorStudio.DoorConflict(two, near, b, new StudioUnitOption { OptionId = "b", Plan = planB }) != null, "door clash across a party wall is caught");
        planB.Doors[0].Center = new PlanPoint(2.0, b.Y2 - b.Y1);
        Check(FloorStudio.DoorConflict(two, near, b, new StudioUnitOption { OptionId = "b", Plan = planB }) == null, "doors 2 m apart are fine");

        // Хурд: хуваалт + хослол (Python-гүй) хэдэн зуун мс-д.
        var sw = System.Diagnostics.Stopwatch.StartNew();
        var big = FloorStudio.EnumerateSplits(60, 20, 0.3, 0.2);
        var bigPool = FloorStudio.Compose(big, Fake);
        sw.Stop();
        Console.WriteLine("FloorStudio 60x20: " + big.Count + " splits, " + bigPool.Count + " candidates in " + sw.ElapsedMilliseconds + " ms");
        Check(sw.ElapsedMilliseconds < 15000, "studio enumeration fast enough");
    }

    /// <summary>RoomPlanPlanCheck (2026-10-14 аудит P2-d) — Python-ий планыг бие даан шалгах.</summary>
    private static void PlanCheckTests()
    {
        foreach (PlanEntrySide entry in Enum.GetValues(typeof(PlanEntrySide)))
        foreach (var option in RoomPlanRanking.GenerateOptions(12, 11, 2, entry))
        {
            var plan = option.Plan;
            foreach (var f in FurniturePlanner.Create(plan)) plan.Furnishings.Add(f);
            Check(RoomPlanPlanCheck.Consistent(plan, 12, 11, out string why), "valid plan passes: " + why);
        }
        GeneratedPlan Fresh()
        {
            var p = RoomPlanRanking.GenerateOptions(12, 11, 2, PlanEntrySide.South)[0].Plan;
            foreach (var f in FurniturePlanner.Create(p)) p.Furnishings.Add(f);
            return p;
        }
        void Rejects(Action<GeneratedPlan> mutate, double w, double h, string expect)
        {
            var p = Fresh();
            mutate(p);
            Check(!RoomPlanPlanCheck.Consistent(p, w, h, out string why), "must reject: " + expect);
            Check(why != null && why.Contains(expect), "reason '" + why + "' should mention '" + expect + "'");
        }
        Rejects(p => { }, 12.5, 11, "differs from the selected boundary");
        Rejects(p => p.Rooms[0].X2 = double.NaN, 12, 11, "non-finite");
        Rejects(p => p.Rooms[0].X1 = -1, 12, 11, "outside the boundary");
        Rejects(p => { var r = p.Rooms[1]; p.Rooms[0].X1 = r.X1; p.Rooms[0].Y1 = r.Y1; p.Rooms[0].X2 = r.X2; p.Rooms[0].Y2 = r.Y2; }, 12, 11, "overlapping");
        Rejects(p => p.Walls.RemoveAll(x => x.Id == "north"), 12, 11, "perimeter wall missing");
        Rejects(p => { var e = p.Walls.First(x => x.Id == "east"); e.End = new PlanPoint(e.End.X, e.End.Y / 2); }, 12, 11, "full edge");
        Rejects(p => { var d = p.Doors[0]; d.Center = new PlanPoint(d.Center.X, d.Center.Y + 0.3); }, 12, 11, "host wall line");
        Rejects(p => p.Walls.Add(new PlanWall("wd", 0, 0, 12, 11)), 12, 11, "diagonal");
        Rejects(p => p.Furnishings[0].Position = new PlanPoint(100, 100), 12, 11, "furniture outside");
        Check(!RoomPlanPlanCheck.Consistent(null, 12, 11, out string none) && none == "plan missing", "null plan");
    }
}
