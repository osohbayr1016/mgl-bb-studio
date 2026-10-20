using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;
using RevitMcpAddin.RoomPlan.Core;

namespace RevitMcpAddin.RoomPlan
{
    /// <summary>«Давхрын план»-ы давхар — API контекстод (`Capture`) уншина, арын урсгал зөвхөн тоонуудыг хэрэглэнэ.</summary>
    internal sealed class StudioStorey
    {
        internal Document Doc;
        internal ElementId LevelId, ViewId, FloorId;
        internal string Title;
        internal double WidthM, HeightM, ExteriorM, PartitionM;
        /// <summary>Үүсгэх боломжгүй шалтгаан (null = болно).</summary>
        internal string Problem;
    }

    /// <summary>Студийн айлын хувилбарын Revit тал: Python-ы анхны санал + багц (суралцах санд «applied» бичихэд).</summary>
    internal sealed class StudioOptionRef
    {
        internal PythonOption Option;
        internal PythonBatch Batch;
        internal PythonUnitResult Unit;
    }

    internal sealed class StudioGeneration
    {
        internal StudioStorey Storey;
        internal List<StudioSplit> Splits = new List<StudioSplit>();
        internal List<StudioCandidate> Pool = new List<StudioCandidate>();
        internal int UnitRequests, PythonBatches, FailedUnits;
        internal double Seconds;
        internal string Error;
    }

    internal sealed class StudioApplyOutcome
    {
        internal bool Ok;
        internal string Message;
        internal StudioCandidate Candidate;
        internal bool Furnished;
        internal RoomPlanApplyResult Made;
        internal List<ElementId> Shell = new List<ElementId>();
        internal ElementId CommonRoom;
        internal PythonBatch Batch;
        internal Dictionary<string, PythonOption> Selected;
        internal readonly List<string> Notes = new List<string>();
        internal int Replaced;
        internal double Seconds;
    }

    internal sealed class StudioFamilies
    {
        internal WallType Interior, Partition;
        internal FamilySymbol Door;
        internal readonly Dictionary<FurnitureKind, ElementId> Furniture = new Dictionary<FurnitureKind, ElementId>();
        internal readonly List<string> Notes = new List<string>();
        internal string Problem;
    }

    /// <summary>
    /// «Давхрын план» (Finch маяг, 2026-10-14) — цонх, асуултгүй.  Командаас давхрыг уншина (`Capture`), арын урсгалд олон
    /// зуун бүтэн давхрын хувилбар бэлдэнэ (`Generate`: хуваалт → айл бүрийн өрөөний план Python-оор, зэрэгцээ процесс →
    /// `FloorStudio.Compose`), сонгосныг НЭГ TransactionGroup-оор Revit-д тавина (`Apply`; өмнөх үүсгэснээ солино), тавилгыг
    /// нэг товчоор (`Furnish`).  Family-г автоматаар сонгоно (`PickFamilies`).  Энд UI БАЙХГҮЙ — самбар (`FloorStudioPane`)
    /// ба live gate хоёулаа энэ кодыг дуудна.
    /// </summary>
    internal static class FloorStudioEngine
    {
        internal const string ReplaceTransactionName = "MGL — Өмнөх давхрын планыг солих";
        internal const int OptionsPerUnit = 12;
        internal const int BatchSize = 24;
        internal const int Parallelism = 4;

        // ── 1. Давхрыг унших (API контекст) ─────────────────────────────

        internal static StudioStorey Capture(UIDocument ui)
        {
            var s = new StudioStorey();
            Document doc = ui == null ? null : ui.Document;
            ViewPlan view = ui == null ? null : ui.ActiveView as ViewPlan;
            if (doc == null || view == null || view.ViewType != ViewType.FloorPlan || view.IsTemplate || doc.IsFamilyDocument ||
                doc.IsReadOnly || view.GenLevel == null)
            {
                s.Problem = "Засварлаж болох Revit-ийн Floor Plan (давхрын план) нээгээд «Давхрын план»-ыг дахин дарна уу.";
                return s;
            }
            Level level = view.GenLevel;
            s.Doc = doc; s.LevelId = level.Id; s.ViewId = view.Id;

            Floor floor = ui.Selection.GetElementIds().Select(id => doc.GetElement(id)).OfType<Floor>()
                .FirstOrDefault(f => f.LevelId == level.Id);
            if (floor == null)
                floor = new FilteredElementCollector(doc).OfClass(typeof(Floor)).Cast<Floor>()
                    .Where(f => f.LevelId == level.Id)
                    .OrderByDescending(f => { BoundingBoxXYZ b = f.get_BoundingBox(null); return b == null ? 0 : (b.Max.X - b.Min.X) * (b.Max.Y - b.Min.Y); })
                    .FirstOrDefault();
            if (floor == null)
            {
                s.Problem = "«" + level.Name + "» давхарт шал (Floor) алга.  Барилгын контурын тэгш өнцөгт шал + 4 гадна хана хэрэгтэй.";
                return s;
            }
            s.FloorId = floor.Id;
            ExistingFloorBoundary storey;
            try { storey = ExistingFloorBoundary.Read(doc, floor, level); }
            catch (ArgumentException ex)
            {
                s.Problem = "Давхрын шал таних алдаа: " + ex.Message + "  Одоохондоо 4 шулуун гадна ханатай тэгш өнцөгт давхрыг дэмжинэ.";
                return s;
            }
            s.WidthM = storey.WidthMeters;
            s.HeightM = storey.HeightMeters;
            s.ExteriorM = RoomPlanBatchApply.ExteriorThickness(storey);
            WallType partition = PickWallType(doc, 0.2, 0.15, 0.3);
            s.PartitionM = partition == null ? 0.2 : UnitUtils.ConvertFromInternalUnits(partition.Width, UnitTypeId.Meters);
            s.Title = level.Name + " · " + F(s.WidthM) + " × " + F(s.HeightM) + " м · " + F(s.WidthM * s.HeightM) + " м²";
            if (ValidGenerated(doc, level.Id).Count == 0 &&
                RoomPlanBatchApply.HasOccupied(doc, level, new[] { new PythonUnitRequest { Id = "FLOOR", Boundary = storey } }))
                s.Problem = "«" + level.Name + "» давхарт гадна ханаас гадна дотор хана, Room, хаалга эсвэл тавилга байна.  " +
                            "Давхрын планыг ХООСОН давхарт (эсвэл өмнө нь энэ хэрэгслээр үүсгэсэн давхарт) үүсгэнэ.";
            return s;
        }

        // ── 2. Олон хувилбар (арын урсгалд аюулгүй — Revit API дуудахгүй) ──

        internal static StudioGeneration Generate(StudioStorey s, Action<string, double> progress, CancellationToken ct)
        {
            var g = new StudioGeneration { Storey = s };
            var sw = Stopwatch.StartNew();
            progress?.Invoke("Давхрыг айлуудад хувааж байна…", 0.02);
            g.Splits = FloorStudio.EnumerateSplits(s.WidthM, s.HeightM, s.ExteriorM, s.PartitionM);
            if (g.Splits.Count == 0)
            {
                g.Error = "Энэ давхарт айл багтах хуваалт олдсонгүй — давхрын гүн 12 м-ээс бага эсвэл давхар хэт богино байна.";
                return g;
            }
            ct.ThrowIfCancellationRequested();

            // Ижил хэмжээ, орц, цонх, зэрэглэлтэй айлд Python-ыг нэг л удаа.
            var specs = new Dictionary<string, PythonUnitRequest>(StringComparer.Ordinal);
            foreach (StudioSplit split in g.Splits)
                foreach (FloorUnit u in split.Layout.Units)
                {
                    string key = FloorStudio.UnitKey(u, s.ExteriorM);
                    if (specs.ContainsKey(key)) continue;
                    specs[key] = new PythonUnitRequest
                    {
                        Id = "S" + (specs.Count + 1).ToString("000", CultureInfo.InvariantCulture),
                        WidthM = u.X2 - u.X1, HeightM = u.Y2 - u.Y1,
                        Entry = (PlanEntrySide)Enum.Parse(typeof(PlanEntrySide), char.ToUpperInvariant(u.Entry[0]) + u.Entry.Substring(1)),
                        Bedrooms = u.Bedrooms, Bathrooms = u.Bathrooms, Tier = u.Tier,
                        Facades = u.Facades.ToList(), ExteriorWallThickness = s.ExteriorM,
                    };
                }
            g.UnitRequests = specs.Count;
            var keyOf = specs.ToDictionary(kv => kv.Value.Id, kv => kv.Key, StringComparer.Ordinal);
            List<List<PythonUnitRequest>> batches = specs.Values.Select((r, i) => new { r, i }).GroupBy(x => x.i / BatchSize)
                .Select(b => b.Select(x => x.r).ToList()).ToList();
            g.PythonBatches = batches.Count;
            var options = new ConcurrentDictionary<string, List<StudioUnitOption>>(StringComparer.Ordinal);
            int done = 0;
            string firstError = null;
            progress?.Invoke("Айл бүрийн өрөөний план… 0/" + specs.Count, 0.05);
            Parallel.ForEach(batches, new ParallelOptions { MaxDegreeOfParallelism = Parallelism, CancellationToken = ct }, batch =>
            {
                try
                {
                    PythonBatch result = RoomPlanPythonBridge.Generate(batch, OptionsPerUnit);
                    foreach (PythonUnitResult u in result.Units)
                        options[keyOf[u.Id]] = u.Options.Select(o => new StudioUnitOption
                        {
                            OptionId = o.OptionId, Topology = o.Topology, Score = o.Score,
                            Daylit = o.DaylitRooms, Habitable = o.HabitableRooms, Plan = o.Plan,
                            Source = new StudioOptionRef { Option = o, Batch = result, Unit = u },
                        }).ToList();
                }
                catch (Exception ex) { Interlocked.CompareExchange(ref firstError, ex.Message, null); }
                int n = Interlocked.Add(ref done, batch.Count);
                progress?.Invoke("Айл бүрийн өрөөний план… " + n + "/" + specs.Count, 0.05 + 0.85 * n / specs.Count);
            });
            ct.ThrowIfCancellationRequested();
            g.FailedUnits = specs.Keys.Count(k => !options.TryGetValue(k, out List<StudioUnitOption> l) || l.Count == 0);
            if (options.IsEmpty)
            {
                g.Error = "Python хөдөлгүүр ажилласангүй" + (firstError == null ? "." : ": " + firstError);
                return g;
            }

            progress?.Invoke("Бүтэн давхрын хувилбаруудыг бүрдүүлж, үнэлж байна…", 0.93);
            g.Pool = FloorStudio.Compose(g.Splits, (split, u) =>
                options.TryGetValue(FloorStudio.UnitKey(u, s.ExteriorM), out List<StudioUnitOption> l) ? l : null);
            g.Seconds = sw.Elapsed.TotalSeconds;
            if (g.Pool.Count == 0)
                g.Error = "Хувилбар бүрдсэнгүй — айлуудад өрөөний план олдсонгүй" + (firstError == null ? "." : " (" + firstError + ").");
            progress?.Invoke(g.Pool.Count + " хувилбар бэлэн", 1.0);
            return g;
        }

        // ── 3. Family (API контекст, цонхгүй) ───────────────────────────

        /// <summary>Basic ханын төрөл: [min, max] м-ийн дотроос хүссэн зузаанд хамгийн ойр (нэрэнд interior/partition/дотор бол түрүүлнэ).</summary>
        internal static WallType PickWallType(Document doc, double targetM, double minM, double maxM)
        {
            List<WallType> types = new FilteredElementCollector(doc).OfClass(typeof(WallType)).Cast<WallType>()
                .Where(t => t.Kind == WallKind.Basic && t.Width > 0).ToList();
            double W(WallType t) { return UnitUtils.ConvertFromInternalUnits(t.Width, UnitTypeId.Meters); }
            bool Named(WallType t)
            {
                string n = (t.Name ?? "").ToLowerInvariant();
                return n.Contains("interior") || n.Contains("partition") || n.Contains("дотор") || n.Contains("хуваах");
            }
            return types.Where(t => W(t) >= minM - 1e-6 && W(t) <= maxM + 1e-6)
                       .OrderBy(t => Math.Round(Math.Abs(W(t) - targetM), 3)).ThenBy(t => Named(t) ? 0 : 1).ThenBy(t => t.Name, StringComparer.OrdinalIgnoreCase)
                       .FirstOrDefault()
                   ?? types.OrderBy(t => Math.Abs(W(t) - targetM)).ThenBy(t => t.Name, StringComparer.OrdinalIgnoreCase).FirstOrDefault();
        }

        private static readonly Dictionary<string, ElementId> DoorCache = new Dictionary<string, ElementId>(StringComparer.Ordinal);

        internal static StudioFamilies PickFamilies(Document doc, Level level, ExistingFloorBoundary storey,
            IEnumerable<FurnitureTarget> furnishings, bool furnish)
        {
            var f = new StudioFamilies
            {
                Partition = PickWallType(doc, 0.2, 0.15, 0.3),
                Interior = PickWallType(doc, 0.1, 0.07, 0.16),
            };
            if (f.Partition == null || f.Interior == null) { f.Problem = "Төсөлд Basic Wall төрөл алга — ханын төрөл ачаална уу."; return f; }
            if (new FilteredElementCollector(doc).OfCategory(BuiltInCategory.OST_RoomTags).WhereElementIsElementType().FirstOrDefault() == null)
            {
                f.Problem = "Room Tag family ачаалагдаагүй (Insert → Load Family → Annotations → Room Tag).";
                return f;
            }

            // Хаалга: 0.9 м-д ойр, сонгосон бүх хананд Revit бүтээж чаддаг эхнийх (preflight үргэлж буцаана).  Баримт бүрт нэг удаа.
            var hostTypes = new List<WallType> { f.Interior, f.Partition };
            hostTypes.AddRange(storey.Perimeter.Values.Select(w => w.WallType));
            string cacheKey = DocKey(doc) + "|" + string.Join(",", hostTypes.Select(t => t.Id.Value).Distinct().OrderBy(x => x));
            if (DoorCache.TryGetValue(cacheKey, out ElementId cached) && doc.GetElement(cached) is FamilySymbol cachedDoor)
                f.Door = cachedDoor;
            else
            {
                List<FamilySymbol> doors = new FilteredElementCollector(doc).OfClass(typeof(FamilySymbol)).OfCategory(BuiltInCategory.OST_Doors)
                    .Cast<FamilySymbol>()
                    .Where(d => d.Family != null && d.Family.FamilyPlacementType == FamilyPlacementType.OneLevelBasedHosted)
                    .OrderBy(d => Math.Abs(DoorWidthM(d) - 0.9) > 0.15 ? 1 : 0)
                    .ThenBy(d => (d.Family.Name + " " + d.Name).IndexOf("double", StringComparison.OrdinalIgnoreCase) >= 0 ? 1 : 0)
                    .ThenBy(d => Math.Abs(DoorWidthM(d) - 0.9)).ThenBy(d => d.Family.Name, StringComparer.OrdinalIgnoreCase)
                    .ThenBy(d => d.Name, StringComparer.OrdinalIgnoreCase).ToList();
                if (doors.Count == 0) { f.Problem = "Хананд суурилдаг хаалганы family ачаалагдаагүй (Insert → Load Family → Doors)."; return f; }
                string firstProblem = null;
                foreach (FamilySymbol d in doors.Take(8))
                {
                    string problem = RoomPlanBatchApply.DoorHostProblem(doc, level, hostTypes, d);
                    if (problem == null) { f.Door = d; break; }
                    if (firstProblem == null) firstProblem = problem;
                }
                if (f.Door == null) { f.Problem = firstProblem ?? "Ямар ч хаалга эдгээр хананд үүсэхгүй."; return f; }
                DoorCache[cacheKey] = f.Door.Id;
            }

            if (furnish)
            {
                List<FurnitureTarget> targets = furnishings.ToList();
                foreach (FurnitureKind kind in targets.Select(t => t.Kind).Distinct())
                {
                    FamilySymbol pick = RoomPlanFurnitureRevit.Suggest(kind, RoomPlanFurnitureRevit.Candidates(doc, kind), targets);
                    if (pick != null) f.Furniture[kind] = pick.Id;
                    else f.Notes.Add(KindLabel(kind) + "-ийн family ачаалагдаагүй — байрлуулсангүй");
                }
            }
            return f;
        }

        private static double DoorWidthM(FamilySymbol d)
        {
            Parameter p = d.get_Parameter(BuiltInParameter.DOOR_WIDTH) ?? d.get_Parameter(BuiltInParameter.FAMILY_WIDTH_PARAM) ?? d.LookupParameter("Width");
            return p != null && p.StorageType == StorageType.Double ? UnitUtils.ConvertFromInternalUnits(p.AsDouble(), UnitTypeId.Meters) : 0;
        }

        internal static string KindLabel(FurnitureKind k)
        {
            switch (k)
            {
                case FurnitureKind.Bed: return "Ор";
                case FurnitureKind.BedSingle: return "Нэг хүний ор";
                case FurnitureKind.Sofa: return "Буйдан";
                case FurnitureKind.Kitchen: return "Гал тогоо";
                case FurnitureKind.Toilet: return "Суултуур";
                case FurnitureKind.Basin: return "Угаалтуур";
                case FurnitureKind.Nightstand: return "Шөнийн ширээ";
                case FurnitureKind.Wardrobe: return "Хувцасны шүүгээ";
                case FurnitureKind.Desk: return "Бичгийн ширээ";
                case FurnitureKind.CoffeeTable: return "Кофены ширээ";
                case FurnitureKind.TvUnit: return "ТВ тавиур";
                case FurnitureKind.DiningTable: return "Хоолны ширээ";
                case FurnitureKind.Bathtub: return "Ванн";
                case FurnitureKind.Shower: return "Шүршүүр";
                case FurnitureKind.Washer: return "Угаалгын машин";
                default: return k.ToString();
            }
        }

        // ── 4. Revit-д тавих (API контекст, нэг Ctrl+Z) ────────────────

        /// <summary>
        /// Сонгосон хувилбарыг НЭГ TransactionGroup-оор: энэ давхарт өмнө нь энэ хэрэгслээр үүсгэсэн бүхнийг устгаж (солих),
        /// коридор / айл хоорондын хана → айл бүрийн өрөө, хаалга (+ <paramref name="furnish"/> бол тавилга) → нийтийн коридор.
        /// Аль нэг алхам унавал юу ч өөрчлөгдөхгүй.
        /// </summary>
        internal static StudioApplyOutcome Apply(StudioStorey s, StudioCandidate c, bool furnish)
        {
            var o = new StudioApplyOutcome { Candidate = c, Furnished = furnish };
            var sw = Stopwatch.StartNew();
            Document doc = s == null ? null : s.Doc;
            if (doc == null || !doc.IsValidObject) return Fail(o, "Баримт хаагдсан — «Давхрын план»-ыг дахин дарна уу.");
            if (s.LevelId == null || s.ViewId == null || s.FloorId == null) return Fail(o, s.Problem ?? "Давхар олдсонгүй.");
            if (c == null) return Fail(o, "Хувилбар сонгоогүй байна.");
            if (doc.IsReadOnly || doc.IsModifiable) return Fail(o, "Revit өөр ажил хийж байна (засварлах горим) — дуусгаад дахин дарна уу.");
            Level level = doc.GetElement(s.LevelId) as Level;
            ViewPlan view = doc.GetElement(s.ViewId) as ViewPlan;
            Floor floor = doc.GetElement(s.FloorId) as Floor;
            if (level == null || view == null || floor == null) return Fail(o, "Давхар, план эсвэл шал устсан — «Давхрын план»-ыг дахин дарна уу.");
            ExistingFloorBoundary storey;
            try { storey = ExistingFloorBoundary.Read(doc, floor, level); }
            catch (ArgumentException ex) { return Fail(o, "Давхрын шал өөрчлөгдсөн: " + ex.Message); }
            if (Math.Abs(storey.WidthMeters - s.WidthM) > 0.01 || Math.Abs(storey.HeightMeters - s.HeightM) > 0.01)
                return Fail(o, "Давхрын хэмжээ өөрчлөгдсөн — «Давхрын план»-ыг дахин дарж шинэ хувилбар үүсгэнэ үү.");

            List<ElementId> previous = ValidGenerated(doc, s.LevelId);
            StudioFamilies fam = PickFamilies(doc, level, storey, c.Choice.Values.SelectMany(x => x.Plan.Furnishings), furnish);
            if (fam.Problem != null) return Fail(o, fam.Problem);
            o.Notes.AddRange(fam.Notes);

            using (var group = new TransactionGroup(doc, FloorPlateShell.GroupName))
            {
                if (group.Start() != TransactionStatus.Started) return Fail(o, "Revit transaction эхэлсэнгүй.");
                try
                {
                    if (previous.Count > 0)
                    {
                        using (var tx = new Transaction(doc, ReplaceTransactionName))
                        {
                            tx.Start();
                            doc.Delete(previous);
                            if (tx.Commit() != TransactionStatus.Committed) throw new InvalidOperationException("Өмнөх планыг устгаж чадсангүй.");
                        }
                        o.Replaced = previous.Count;
                    }
                    if (RoomPlanBatchApply.HasOccupied(doc, level, new[] { new PythonUnitRequest { Id = "FLOOR", Boundary = storey } }))
                    {
                        group.RollBack();
                        return Fail(o, "Давхарт энэ хэрэгслээр үүсгээгүй хана, Room, хаалга эсвэл тавилга байна — эхлээд түүнийг устгана уу.");
                    }

                    List<PythonUnitRequest> requests = FloorPlateShell.BuildShell(doc, level, storey, c.Split.Layout, fam.Partition, out List<ElementId> shell);
                    o.Shell = shell;
                    var batch = new PythonBatch { BatchId = "studio" };
                    var selected = new Dictionary<string, PythonOption>(StringComparer.Ordinal);
                    foreach (PythonUnitRequest r in requests)
                    {
                        if (!c.Choice.TryGetValue(r.Id, out StudioUnitOption choice) || !(choice.Source is StudioOptionRef src))
                            throw new InvalidOperationException(r.Id + " — айлын план алга.");
                        PythonOption po = src.Option;
                        if (Math.Abs(po.Plan.Width - r.Boundary.WidthMeters) > 0.01 || Math.Abs(po.Plan.Height - r.Boundary.HeightMeters) > 0.01)
                            throw new InvalidOperationException(r.Id + " — айлын хэмжээ планаас зөрсөн.");
                        var unit = new PythonUnitResult
                        {
                            Id = r.Id, Boundary = r.Boundary, Entry = r.Entry, Bedrooms = r.Bedrooms, Bathrooms = r.Bathrooms,
                            Facades = r.Facades.ToList(),
                        };
                        unit.Options.Add(po);
                        batch.Units.Add(unit);
                        selected[r.Id] = po;
                    }
                    string cross = RoomPlanBatchApply.CheckSharedBoundaryDoorConflicts(batch, selected);
                    if (cross != null) throw new InvalidOperationException(cross);
                    o.Made = RoomPlanBatchApply.Apply(doc, level, view, batch, selected, fam.Interior, fam.Door,
                        furnish ? (IDictionary<FurnitureKind, ElementId>)fam.Furniture : new Dictionary<FurnitureKind, ElementId>(),
                        skipMissingFamilies: true);
                    FloorPlateShell.AddCommonRoom(doc, level, view, storey, c.Split.Layout, o.Made);
                    o.CommonRoom = o.Made.Rooms.Last();
                    o.Batch = batch;
                    o.Selected = selected;
                    if (group.Assimilate() != TransactionStatus.Committed) return Fail(o, "Давхрын план хадгалагдсангүй.");
                }
                catch (Exception ex)
                {
                    if (group.HasStarted()) group.RollBack();
                    return Fail(o, "Revit-д тавьж чадсангүй — юу ч өөрчлөгдөөгүй.  " + ex.Message);
                }
            }

            Remember(doc, s.LevelId, c, furnish, o);
            // Суралцах сан: архитектор энэ айлын планыг сонгосон (Python процесс — Revit-ийг хүлээлгэхгүй).
            List<StudioOptionRef> refs = c.Choice.Values.Select(x => x.Source as StudioOptionRef).Where(x => x != null).Distinct().ToList();
            Task.Run(() =>
            {
                foreach (StudioOptionRef r in refs)
                    RoomPlanPythonBridge.TryEvent(r.Batch, r.Unit, r.Option, "applied", null, out string ignored);
            });

            o.Ok = true;
            o.Seconds = sw.Elapsed.TotalSeconds;
            FloorPlateLayout l = c.Split.Layout;
            o.Message = (furnish ? "Тавилга байрлалаа: " : "Давхрын план Revit-д тавигдлаа: ") +
                l.Units.Count + " айл (" + FloorStudio.MixText(l) + ") · " + o.Made.Rooms.Count + " Room · " + o.Made.Doors.Count + " хаалга" +
                (furnish ? " · " + o.Made.Furniture.Count + " тавилга" : "") +
                (o.Replaced > 0 ? " · өмнөх план солигдов" : "") + ".  Нэг Ctrl+Z буцаана.";
            if (o.Made.FurnitureDropped.Count > 0) o.Notes.Add("Багтаагүй тул орхисон: " + string.Join("; ", o.Made.FurnitureDropped));
            return o;
        }

        /// <summary>Сүүлд тавьсан хувилбарт тавилга (хана, өрөөг ижилхэн дахин тавьж, тавилгатай).  Гараар өөрчилсөн бол татгалзана.</summary>
        internal static StudioApplyOutcome Furnish(StudioStorey s)
        {
            var o = new StudioApplyOutcome { Furnished = true };
            Document doc = s == null ? null : s.Doc;
            if (doc == null || !doc.IsValidObject) return Fail(o, "Баримт хаагдсан.");
            Record rec = Current(doc, s.LevelId);
            if (rec == null) return Fail(o, "Эхлээд давхрын хувилбараа сонгож Revit-д тавина уу.");
            if (rec.Furnished) return Fail(o, "Энэ давхарт тавилга аль хэдийн байрласан.");
            foreach (var (id, a, b) in rec.Shell)
            {
                var wall = doc.GetElement(id) as Wall;
                var line = wall == null ? null : (wall.Location as LocationCurve)?.Curve as Line;
                bool same = line != null &&
                    ((line.GetEndPoint(0).DistanceTo(a) < 0.01 && line.GetEndPoint(1).DistanceTo(b) < 0.01) ||
                     (line.GetEndPoint(0).DistanceTo(b) < 0.01 && line.GetEndPoint(1).DistanceTo(a) < 0.01));
                if (!same)
                    return Fail(o, "Тавьсны дараа коридор / айл хоорондын ханыг гараар өөрчилсөн байна — тавилгыг байрлуулбал тэр өөрчлөлт " +
                                   "арилна.  Хувилбараа дахин тавиад тавилгаа байрлуулна уу.");
            }
            return Apply(s, rec.Candidate, true);
        }

        /// <summary>Энэ давхарт тавьсан, тавилгагүй хувилбар байгаа юу (туузан цэсний «Олон өрөөний план» шууд тавилга байрлуулахад).</summary>
        internal static bool HasUnfurnished(Document doc, ElementId levelId)
        {
            Record rec = doc == null || levelId == null ? null : Current(doc, levelId);
            return rec != null && !rec.Furnished;
        }

        internal static StudioCandidate Applied(Document doc, ElementId levelId, out bool furnished)
        {
            Record rec = doc == null || levelId == null ? null : Current(doc, levelId);
            furnished = rec != null && rec.Furnished;
            return rec == null ? null : rec.Candidate;
        }

        // ── Үүсгэсэн элементийн бүртгэл (санах ойд, баримт × давхар) ──

        private sealed class Record
        {
            internal StudioCandidate Candidate;
            internal bool Furnished;
            internal List<ElementId> Ids;
            internal List<(ElementId id, XYZ a, XYZ b)> Shell;
        }

        private static readonly Dictionary<string, List<Record>> Records = new Dictionary<string, List<Record>>(StringComparer.Ordinal);

        /// <summary>
        /// Баримтын тогтмол түлхүүр: <c>CreationGUID</c> «Save As», анхны хадгалалтаар өөрчлөгдөхгүй (замаар түлхүүрлэхэд хадгалсны дараа
        /// өмнө үүсгэснээ танихаа больж «давхарт өөр элемент байна» гэж солихыг хориглодог байв — live gate 2026-10-14).
        /// </summary>
        private static string DocKey(Document doc) { return doc.CreationGUID.ToString("N"); }
        private static string StoreyKey(Document doc, ElementId level) { return DocKey(doc) + "|" + level.Value.ToString(CultureInfo.InvariantCulture); }

        private static void Remember(Document doc, ElementId level, StudioCandidate c, bool furnish, StudioApplyOutcome o)
        {
            var ids = new List<ElementId>(o.Shell);
            RoomPlanApplyResult m = o.Made;
            ids.AddRange(m.Walls); ids.AddRange(m.Doors); ids.AddRange(m.Rooms); ids.AddRange(m.Tags); ids.AddRange(m.Furniture);
            var shell = new List<(ElementId, XYZ, XYZ)>();
            foreach (ElementId id in o.Shell)
                if ((doc.GetElement(id) as Wall)?.Location is LocationCurve lc && lc.Curve is Line line)
                    shell.Add((id, line.GetEndPoint(0), line.GetEndPoint(1)));
            string key = StoreyKey(doc, level);
            if (!Records.TryGetValue(key, out List<Record> list)) Records[key] = list = new List<Record>();
            list.Add(new Record { Candidate = c, Furnished = furnish, Ids = ids, Shell = shell });
        }

        /// <summary>Энэ давхарт энэ хэрэгслийн үүсгэсэн, одоо моделд байгаа бүх элемент (Undo-гийн дараа ч зөв).</summary>
        internal static List<ElementId> ValidGenerated(Document doc, ElementId level)
        {
            if (!Records.TryGetValue(StoreyKey(doc, level), out List<Record> list)) return new List<ElementId>();
            return list.SelectMany(r => r.Ids).Distinct().Where(id => doc.GetElement(id) != null).ToList();
        }

        /// <summary>Моделд бүтэн байгаа хамгийн сүүлийн бичлэг (Ctrl+Z хийвэл өмнөх нь буцаж ирнэ).</summary>
        private static Record Current(Document doc, ElementId level)
        {
            if (!Records.TryGetValue(StoreyKey(doc, level), out List<Record> list)) return null;
            for (int i = list.Count - 1; i >= 0; i--)
                if (list[i].Ids.Count > 0 && list[i].Ids.All(id => doc.GetElement(id) != null)) return list[i];
            return null;
        }

        private static StudioApplyOutcome Fail(StudioApplyOutcome o, string message)
        {
            o.Ok = false;
            o.Message = message;
            return o;
        }

        private static string F(double v) { return v.ToString("0.#", CultureInfo.InvariantCulture); }
    }
}
