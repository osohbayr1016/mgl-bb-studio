using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Architecture;
using Autodesk.Revit.UI;
using RevitMcpAddin.RoomPlan;
using RevitMcpAddin.RoomPlan.Core;

namespace MglRpGate
{
    /// <summary>
    /// Нэг run = plate үүсгэх → нээх → Python-оор олон нэгжийн хувилбар → (2-р нэгжид зориуд алдаа оруулж) бүхэлд нь буцаагдаж
    /// буйг шалгах → жинхэнэ apply → Revit-ийн бодит геометрээр шалгах → зураг → Ctrl+Z / Ctrl+Y → хадгалах.
    /// Архитекторын сонголтыг (орох хана, хамгийн өндөр оноотой хувилбар, family) gate өөрөө хийж, бүгдийг `run.json`-д бичнэ.
    /// </summary>
    internal static class Scenario
    {
        internal sealed class State
        {
            public string PlatePath, ResultPath;
            public Document Doc;
            public Level Level;
            public ViewPlan View;
            public List<PythonUnitRequest> Requests;
            public PythonBatch Batch;
            public Dictionary<string, PythonOption> Selected;
            public WallType Interior;
            public FamilySymbol Door;
            public Dictionary<FurnitureKind, ElementId> Furniture;
            public HashSet<long> BeforeApply;
            public RoomPlanApplyResult Made;
            // «Давхрын план» горим (FloorScenario): бүтэн давхрын шал, хуваалт, коридор/айл хоорондын хана, нийтийн коридор.
            public ExistingFloorBoundary Storey;
            public FloorPlateLayout Layout;
            public WallType Partition;
            public List<ElementId> ShellWalls = new List<ElementId>();
            public ElementId CommonRoom;
        }

        public static void Build(GateRunner r)
        {
            var s = new State();
            r.Enqueue("plate.build", app => { s.PlatePath = PlateFactory.Build(app.Application, r.Job, r.Facts); return StepState.Done; }, 15, true);
            r.Enqueue("plate.open", app => Open(r, s, app), 10, true);
            r.Enqueue("roomplan.generate", app => Generate(r, s), 10, true);
            r.Enqueue("roomplan.families", app => PickFamilies(r, s), 5, true);
            r.Enqueue("roomplan.door-probe", app => DoorProbe(r, s));
            r.Enqueue("roomplan.partial-failure-rollback", app => PartialFailure(r, s));
            r.Enqueue("roomplan.apply", app => Apply(r, s), 10, true);
            r.Enqueue("roomplan.verify", app => Verify(r, s));
            r.Enqueue("roomplan.export", app => Export(r, s, app));
            r.Enqueue("roomplan.undo", app => PostEdit(r, app, true));
            r.Enqueue("roomplan.undo-check", app => AfterUndo(r, s), 2);
            r.Enqueue("roomplan.redo", app => PostEdit(r, app, false));
            r.Enqueue("roomplan.redo-check", app => AfterRedo(r, s), 2);
            r.Enqueue("roomplan.save", app => Save(r, s, app));
        }

        // ── Нээх ────────────────────────────────────────────────────

        internal static StepState Open(GateRunner r, State s, UIApplication app)
        {
            UIDocument ui = app.OpenAndActivateDocument(s.PlatePath);
            s.Doc = ui.Document;
            s.Level = new FilteredElementCollector(s.Doc).OfClass(typeof(Level)).Cast<Level>().OrderBy(l => l.Elevation).First();
            s.View = PlateFactory.PlanOf(s.Doc, s.Level);
            if (s.View == null) return r.Fail("Floor Plan олдсонгүй");
            ui.ActiveView = s.View;
            r.Facts["open.active_view"] = ui.ActiveView.Name;
            return StepState.Done;
        }

        // ── Python хувилбар ────────────────────────────────────────

        private static StepState Generate(GateRunner r, State s)
        {
            Document doc = s.Doc;
            List<Floor> floors = new FilteredElementCollector(doc).OfClass(typeof(Floor)).Cast<Floor>()
                .Where(f => f.LevelId == s.Level.Id).OrderBy(f => f.get_BoundingBox(null).Min.X).ToList();
            if (floors.Count != Plate.Units.Length) return r.Fail("plate дээр " + floors.Count + " floor (" + Plate.Units.Length + " байх ёстой)");

            s.Requests = new List<PythonUnitRequest>();
            for (int i = 0; i < floors.Count; i++)
            {
                ExistingFloorBoundary b = ExistingFloorBoundary.Read(doc, floors[i], s.Level);
                s.Requests.Add(new PythonUnitRequest { Id = Plate.Units[i].Id, Boundary = b, Entry = Plate.Units[i].Entry });
            }
            for (int i = 0; i < s.Requests.Count; i++)
                for (int j = i + 1; j < s.Requests.Count; j++)
                    if (RoomPlanBatchApply.FootprintsOverlap(s.Requests[i].Boundary, s.Requests[j].Boundary))
                        return r.Fail("давхацсан нэгж: " + s.Requests[i].Id + "/" + s.Requests[j].Id);
            if (RoomPlanBatchApply.HasOccupied(doc, s.Level, s.Requests)) return r.Fail("хоосон plate-ийг «эзэлсэн» гэж үзэв");
            for (int i = 0; i < s.Requests.Count; i++)
            {
                PythonUnitRequest q = s.Requests[i];
                q.Facades = RoomPlanBatchApply.DetectFacades(q, s.Requests);
                RoomPlanBatchApply.SuggestProgram(q);
                r.Facts["unit." + q.Id + ".suggested"] = q.Bedrooms + " унтлагын, " + q.Bathrooms + " АЦӨ, " + q.Tier;
                // The architect's choices in «Нэгж бүрийн хөтөлбөр» (one unit per furniture class).
                Plate.Unit spec = Plate.Units[i];
                if (spec.Bedrooms > 0) q.Bedrooms = spec.Bedrooms;
                if (spec.Bathrooms > 0) q.Bathrooms = spec.Bathrooms;
                if (spec.Tier != null) q.Tier = spec.Tier;
                q.ExteriorWallThickness = RoomPlanBatchApply.ExteriorThickness(q.Boundary);
                r.Facts["unit." + q.Id + ".program"] = U.F(q.Boundary.WidthMeters) + "×" + U.F(q.Boundary.HeightMeters) + " м, " +
                    q.Bedrooms + " унтлагын, " + q.Bathrooms + " АЦӨ, " + q.Tier + ", орц " + q.Entry + ", цонх " +
                    string.Join("/", q.Facades) + ", гадна хана " + U.F(q.ExteriorWallThickness) + " м";
            }

            var sw = Stopwatch.StartNew();
            s.Batch = RoomPlanPythonBridge.Generate(s.Requests);
            // Хувилбаргүй нэгжид архитектор өрөөний тоог багасгадаг — gate ч мөн адил (ил тэмдэглэнэ).
            for (int round = 0; round < 3 && s.Batch.Units.Any(u => u.Options.Count == 0); round++)
            {
                foreach (PythonUnitResult u in s.Batch.Units.Where(x => x.Options.Count == 0))
                {
                    PythonUnitRequest q = s.Requests.First(x => x.Id == u.Id);
                    if (q.Bedrooms <= 1) return r.Fail(u.Id + ": 1 унтлагын өрөөтэй ч хувилбар алга (" + u.Error + ")");
                    r.Facts["unit." + q.Id + ".program_reduced"] = q.Bedrooms + " → " + (q.Bedrooms - 1) + " (" + u.Error + ")";
                    q.Bedrooms--;
                }
                s.Batch = RoomPlanPythonBridge.Generate(s.Requests);
            }
            sw.Stop();
            r.Facts["generate.seconds"] = sw.Elapsed.TotalSeconds;
            if (s.Batch.Units.Count != s.Requests.Count) return r.Fail("Python нэгжийн тоо таарахгүй");

            string selectError = SelectBest(r, s);
            return selectError == null ? StepState.Done : r.Fail(selectError);
        }

        /// <summary>
        /// Нэгж бүрд хамгийн өндөр оноотойг; орох хаалга хуваалцсан хананд давхцвал дараагийнхыг (production шалгалтаар) —
        /// архитекторын «Бүгдэд шилдгийг сонгох».  Null = OK, эс бөгөөс алдааны мессеж.
        /// </summary>
        internal static string SelectBest(GateRunner r, State s)
        {
            s.Selected = new Dictionary<string, PythonOption>(StringComparer.Ordinal);
            var partial = new PythonBatch { BatchId = s.Batch.BatchId };
            foreach (PythonUnitResult u in s.Batch.Units)
            {
                if (u.Options.Count == 0) return u.Id + ": хувилбар алга (" + u.Error + ")";
                partial.Units.Add(u);
                PythonOption chosen = null;
                // Production «Бүгдэд шилдгийг сонгох»-той ижил дараалал: бүх өрөө нь цонхтой хувилбар түрүүлнэ.
                foreach (PythonOption o in RoomPlanBatchApply.BestFirst(u.Options))
                {
                    s.Selected[u.Id] = o;
                    if (RoomPlanBatchApply.CheckSharedBoundaryDoorConflicts(partial, s.Selected) == null) { chosen = o; break; }
                }
                if (chosen == null) return u.Id + ": хуваалцсан хананд давхцахгүй хувилбар алга";
                int rank = u.Options.IndexOf(chosen) + 1;
                GeneratedPlan p = chosen.Plan;
                r.Facts["unit." + u.Id + ".options"] = u.Options.Count + " (нийт хүчинтэй " + u.TotalValid + ")";
                r.Facts["unit." + u.Id + ".chosen"] = "#" + rank + " · " + chosen.ToString() + " · " + chosen.Template +
                    " · бүх өрөө цонхтой хувилбар " + u.Options.Count(RoomPlanBatchApply.FullyLit) + "/" + u.Options.Count;
                r.Facts["unit." + u.Id + ".rooms"] = string.Join(", ", p.Rooms.Select(x => x.Name));
                r.Facts["unit." + u.Id + ".counts"] = p.Walls.Count(w => !u.Boundary.Perimeter.ContainsKey(w.Id)) + " дотор хана, " +
                    p.Doors.Count + " хаалга, " + p.Furnishings.Count + " тавилга";
                r.Facts["unit." + u.Id + ".furniture"] = string.Join(", ", p.Furnishings.GroupBy(f => f.Kind)
                    .Select(g => g.Key + (g.Count() > 1 ? "×" + g.Count() : "")));
                RoomPlanPythonBridge.TryEvent(s.Batch, u, chosen, "selected", null, out string err);
                if (err != null) GateLog.Warn("selected event: " + err);
            }
            return null;
        }

        // ── Family (архитекторын «Дотор хана · Хаалга · Тавилга» цонх) ──

        internal static StepState PickFamilies(GateRunner r, State s)
        {
            Document doc = s.Doc;
            if (new FilteredElementCollector(doc).OfCategory(BuiltInCategory.OST_RoomTags).WhereElementIsElementType().FirstOrDefault() == null)
                return r.Fail("Room Tag Family байхгүй (production энд зогсоно)");
            s.Interior = new FilteredElementCollector(doc).OfClass(typeof(WallType)).Cast<WallType>().FirstOrDefault(t => t.Name == Plate.InteriorType);
            if (s.Interior == null || s.Interior.Kind != WallKind.Basic) return r.Fail("дотор ханын төрөл алга");

            List<FamilySymbol> doors = new FilteredElementCollector(doc).OfClass(typeof(FamilySymbol)).OfCategory(BuiltInCategory.OST_Doors)
                .Cast<FamilySymbol>().Where(x => x.Family != null && x.Family.FamilyPlacementType == FamilyPlacementType.OneLevelBasedHosted).ToList();
            // Архитекторын эхний сонголт = gate-ийн ачаалсан хаалга (0.9 м-д ойр); production-ий preflight татгалзвал
            // мессежийг тэмдэглээд дараагийнхыг (өргөн нь 0.9 м-д ойроор) сонгоно — хүн ч яг ингэнэ.
            var hostTypes = new[] { s.Interior }.Concat(s.Requests.SelectMany(q => q.Boundary.Perimeter.Values).Select(w => w.WallType)).ToList();
            var order = doors.OrderBy(d => d.Family.Name == "M_Door-Passage-Single-Flush" ? 0 : 1)
                .ThenBy(d => Math.Abs(DoorWidthM(d) - 0.9)).ThenBy(d => d.Family.Name).ThenBy(d => d.Name).ToList();
            int rejected = 0;
            foreach (FamilySymbol d in order)
            {
                string problem = RoomPlanBatchApply.DoorHostProblem(doc, s.Level, hostTypes, d);
                if (problem == null) { s.Door = d; break; }
                rejected++;
                if (rejected <= 3) r.Facts["family.door.rejected." + rejected] = problem.Replace("\n", " | ");
            }
            r.Facts["family.door.rejected_count"] = rejected;
            if (s.Door == null) return r.Fail("аль ч hosted хаалга " + string.Join("/", hostTypes.Select(t => t.Name).Distinct()) + " хананд үүсэхгүй");
            r.Facts["family.door.choice"] = s.Door.Family.Name + " / " + s.Door.Name + " (" + U.F(DoorWidthM(s.Door)) + " м) · сонголт " + doors.Count;

            // The architect accepts the picker's defaults (production RoomPlanFurnitureRevit.Suggest).
            s.Furniture = new Dictionary<FurnitureKind, ElementId>();
            foreach (FurnitureKind kind in Enum.GetValues(typeof(FurnitureKind)))
            {
                IList<FamilySymbol> candidates = RoomPlanFurnitureRevit.Candidates(doc, kind);
                FamilySymbol pick = RoomPlanFurnitureRevit.Suggest(kind, candidates, s.Selected.Values.SelectMany(o => o.Plan.Furnishings));
                if (pick == null)
                {
                    if (FurniturePlanner.Required(kind))
                        return r.Fail(kind + ": OneLevelBased family алга — production цонх «Load Family шаардлагатай» гэнэ");
                    r.Facts["family." + kind + ".choice"] = "— ашиглахгүй — (санал болгох Family алга, сонголт " + candidates.Count + ")";
                    continue;
                }
                s.Furniture[kind] = pick.Id;
                r.Facts["family." + kind + ".choice"] = pick.Family.Name + " / " + pick.Name + " · сонголт " + candidates.Count;
                // Every type of the chosen family with the plan size production reads (SizedType).
                r.Facts["family." + kind + ".types"] = string.Join(" · ", pick.Family.GetFamilySymbolIds()
                    .Select(id => doc.GetElement(id) as FamilySymbol).Where(x => x != null)
                    .Select(x => { double[] z = RoomPlanFurnitureRevit.PlanSize(x);
                                   return x.Name + " = " + (z == null ? "?" : string.Join("×", z.Select(v => U.F(v)))); }));
            }
            return StepState.Done;
        }

        private static double DoorWidthM(FamilySymbol d)
        {
            Parameter p = d.get_Parameter(BuiltInParameter.DOOR_WIDTH) ?? d.get_Parameter(BuiltInParameter.FAMILY_WIDTH_PARAM) ?? d.LookupParameter("Width");
            return p != null && p.StorageType == StorageType.Double ? p.AsDouble() * 0.3048 : 0;
        }

        // ── Хаалга бүрийг Revit бүтээж чадах уу (оношилгоо — эцэст нь бүгд rollback) ──

        /// <summary>
        /// Apply-ийн нэг transaction нэг ч хаалгыг Revit бүтээж чадахгүй бол БҮГДИЙГ буцаадаг (зөв) — гэвч аль хаалга гэдгийг хэлдэггүй.
        /// Энд нэгж бүрийн дотор ханыг, дараа нь хаалгыг НЭГ НЭГЭЭР нь (өмнөхүүд хэвээр) тусдаа transaction-оор тавьж, Revit-ийн
        /// алдааг хаалга бүрд оноогоод TransactionGroup-ийг бүхэлд нь буцаана.  Модел өөрчлөгдөхгүй.
        /// </summary>
        private static StepState DoorProbe(GateRunner r, State s)
        {
            Document doc = s.Doc;
            var bad = new List<string>();
            int tried = 0;
            HashSet<long> before = Snapshot(doc);
            using (var g = new TransactionGroup(doc, "MGL gate: door probe"))
            {
                g.Start();
                foreach (PythonUnitResult u in s.Batch.Units)
                {
                    GeneratedPlan plan = s.Selected[u.Id].Plan;
                    ExistingFloorBoundary b = u.Boundary;
                    var walls = new Dictionary<string, Wall>(b.Perimeter, StringComparer.Ordinal);
                    using (var t = new Transaction(doc, "probe walls " + u.Id))
                    {
                        t.Start();
                        foreach (PlanWall w in plan.Walls.Where(x => !b.Perimeter.ContainsKey(x.Id)))
                            walls[w.Id] = Wall.Create(doc, Line.CreateBound(At(b, s.Level, w.Start), At(b, s.Level, w.End)),
                                s.Interior.Id, s.Level.Id, U.Mm(2800), 0, false, false);
                        t.Commit();
                    }
                    if (!s.Door.IsActive) using (var t = new Transaction(doc, "probe activate")) { t.Start(); s.Door.Activate(); t.Commit(); }
                    for (int i = 0; i < plan.Doors.Count; i++)
                    {
                        PlanDoor d = plan.Doors[i];
                        tried++;
                        var errors = new List<string>();
                        using (var t = new Transaction(doc, "probe door"))
                        {
                            FailureHandlingOptions o = t.GetFailureHandlingOptions();
                            o.SetFailuresPreprocessor(new Collect(errors));
                            t.SetFailureHandlingOptions(o);
                            t.Start();
                            doc.Create.NewFamilyInstance(At(b, s.Level, d.Center), s.Door, walls[d.HostWall], s.Level,
                                Autodesk.Revit.DB.Structure.StructuralType.NonStructural);
                            t.Commit();
                        }
                        foreach (string w in errors.Where(e => e.StartsWith("warning:"))) GateLog.Info("door-probe " + u.Id + " #" + (i + 1) + " " + w);
                        if (errors.Any(e => !e.StartsWith("warning:")))
                            bad.Add(u.Id + " хаалга " + (i + 1) + " (" + d.HostWall + " @ " + U.F(d.Center.X) + "," + U.F(d.Center.Y) + " м; " +
                                    Along(plan, b, d) + "): " + string.Join("; ", errors.Where(e => !e.StartsWith("warning:")).Distinct()));
                    }
                }
                g.RollBack();
            }
            r.Facts["door_probe.tried"] = tried;
            r.Facts["door_probe.failed"] = bad.Count;
            for (int i = 0; i < bad.Count; i++) r.Facts["door_probe.fail." + (i + 1)] = bad[i];
            foreach (string x in bad) GateLog.Warn("door-probe: " + x);
            if (!Snapshot(doc).SetEquals(before)) return r.Fail("probe-ийн дараа модел өөрчлөгдсөн");
            return bad.Count == 0 ? StepState.Done : r.Fail(bad.Count + "/" + tried + " хаалгыг Revit бүтээж чадахгүй");
        }

        /// <summary>Хаалганы төв ба host хананы төлөвлөгөөн дэх урт, ойрын төгсгөл/уулзвар хүртэлх зай (м).</summary>
        private static string Along(GeneratedPlan plan, ExistingFloorBoundary b, PlanDoor d)
        {
            PlanWall host = plan.Walls.FirstOrDefault(w => w.Id == d.HostWall);
            if (host == null) return "host төлөвлөгөөнд алга";
            double hx = host.End.X - host.Start.X, hy = host.End.Y - host.Start.Y, len = Math.Sqrt(hx * hx + hy * hy);
            double t = ((d.Center.X - host.Start.X) * hx + (d.Center.Y - host.Start.Y) * hy) / len;
            double near = Math.Min(t, len - t);
            foreach (PlanWall w in plan.Walls.Where(w => w.Id != host.Id))
                foreach (PlanPoint p in new[] { w.Start, w.End })
                {
                    double tp = ((p.X - host.Start.X) * hx + (p.Y - host.Start.Y) * hy) / len;
                    double side = Math.Abs((p.X - host.Start.X) * hy - (p.Y - host.Start.Y) * hx) / len;
                    if (side < 0.02 && tp > 0.01 && tp < len - 0.01) near = Math.Min(near, Math.Abs(t - tp));
                }
            return "хана " + U.F(Math.Round(len, 2)) + " м, ойрын төгсгөл/уулзвар " + U.F(Math.Round(near, 2)) + " м";
        }

        private static XYZ At(ExistingFloorBoundary b, Level level, PlanPoint p)
        {
            return new XYZ(b.MinX + p.X / 0.3048, b.MinY + p.Y / 0.3048, level.Elevation);
        }

        private sealed class Collect : IFailuresPreprocessor
        {
            private readonly List<string> _errors;
            public Collect(List<string> errors) { _errors = errors; }

            public FailureProcessingResult PreprocessFailures(FailuresAccessor fa)
            {
                bool error = false;
                foreach (FailureMessageAccessor m in fa.GetFailureMessages())
                {
                    if (m.GetSeverity() == FailureSeverity.Warning) { _errors.Add("warning: " + m.GetDescriptionText()); fa.DeleteWarning(m); continue; }
                    error = true;
                    _errors.Add(m.GetDescriptionText());
                }
                if (!error) return FailureProcessingResult.Continue;
                FailureHandlingOptions o = fa.GetFailureHandlingOptions();
                o.SetClearAfterRollback(true);   // эс бөгөөс Revit буцаасны дараа алдааны цонх гаргана
                fa.SetFailureHandlingOptions(o);
                return FailureProcessingResult.ProceedWithRollBack;
            }
        }

        // ── Хагас бүтэлгүйтэл: U01 бүрэн бичигдсэний дараа U02 унавал ЮУ Ч үлдэхгүй ──

        private static StepState PartialFailure(GateRunner r, State s)
        {
            HashSet<long> before = Snapshot(s.Doc);
            PythonUnitResult second = s.Batch.Units[1];
            PythonOption orig = s.Selected[second.Id];
            GeneratedPlan broken = Clone(orig.Plan);
            broken.Doors.Add(new PlanDoor("gate-missing-wall", 1.0, 1.0));   // host хана байхгүй хаалга — U02-ын хаалганы шатанд унана
            var injected = new Dictionary<string, PythonOption>(s.Selected, StringComparer.Ordinal)
            {
                [second.Id] = new PythonOption { OptionId = orig.OptionId + "-gate-broken", Template = orig.Template, Plan = broken }
            };
            int changes = 0;
            r.ChangeListener = e => changes++;
            string error = null;
            try { RoomPlanBatchApply.Apply(s.Doc, s.Level, s.View, s.Batch, injected, s.Interior, s.Door, s.Furniture); }
            catch (Exception ex) { error = ex.GetType().Name + ": " + ex.Message; }
            finally { r.ChangeListener = null; }
            HashSet<long> after = Snapshot(s.Doc);
            r.Facts["partial.error"] = error;
            r.Facts["partial.document_changed_events"] = changes;
            r.Facts["partial.leftover_elements"] = after.Except(before).Count();
            if (error == null) return r.Fail("эвдэрсэн U02 хүлээн авагдсан — алдаа гарах ёстой байсан");
            if (error.IndexOf("gate-missing-wall", StringComparison.Ordinal) < 0) return r.Fail("хүлээгээгүй алдаа: " + error);
            if (!after.SetEquals(before)) return r.Fail("rollback-ийн дараа " + after.Except(before).Count() + " элемент үлдэв");
            return StepState.Done;
        }

        private static GeneratedPlan Clone(GeneratedPlan p)
        {
            var c = new GeneratedPlan { Width = p.Width, Height = p.Height, Bedrooms = p.Bedrooms, Variant = p.Variant, PythonGenerated = p.PythonGenerated };
            c.Walls.AddRange(p.Walls); c.Rooms.AddRange(p.Rooms); c.Doors.AddRange(p.Doors); c.Furnishings.AddRange(p.Furnishings);
            return c;
        }

        private static readonly BuiltInCategory[] Tracked =
        {
            BuiltInCategory.OST_Walls, BuiltInCategory.OST_Doors, BuiltInCategory.OST_Rooms, BuiltInCategory.OST_RoomTags,
            BuiltInCategory.OST_Furniture, BuiltInCategory.OST_Casework, BuiltInCategory.OST_PlumbingFixtures,
        };

        internal static HashSet<long> Snapshot(Document doc)
        {
            var ids = new HashSet<long>();
            foreach (BuiltInCategory c in Tracked)
                foreach (ElementId id in new FilteredElementCollector(doc).OfCategory(c).WhereElementIsNotElementType().ToElementIds())
                    ids.Add(id.Value);
            return ids;
        }

        // ── Жинхэнэ apply ─────────────────────────────────────────

        private static StepState Apply(GateRunner r, State s)
        {
            s.BeforeApply = Snapshot(s.Doc);
            var names = new List<string>();
            var added = new HashSet<long>();
            r.ChangeListener = e =>
            {
                names.AddRange(e.GetTransactionNames());
                foreach (ElementId id in e.GetAddedElementIds()) added.Add(id.Value);
            };
            var sw = Stopwatch.StartNew();
            try { s.Made = RoomPlanBatchApply.Apply(s.Doc, s.Level, s.View, s.Batch, s.Selected, s.Interior, s.Door, s.Furniture); }
            finally { r.ChangeListener = null; }
            sw.Stop();
            r.Facts["apply.seconds"] = sw.Elapsed.TotalSeconds;
            r.Facts["apply.created"] = s.Made.Walls.Count + " хана · " + s.Made.Doors.Count + " хаалга · " + s.Made.Rooms.Count + " room · " +
                                       s.Made.Tags.Count + " tag · " + s.Made.Furniture.Count + " тавилга";
            r.Facts["apply.transactions"] = string.Join(" | ", names);
            r.Facts["apply.doors_swing_flipped"] = s.Made.FlippedDoors.Count + "/" + s.Made.Doors.Count;
            r.Facts["apply.furniture_dropped"] = s.Made.FurnitureDropped.Count == 0 ? "—" : string.Join(" | ", s.Made.FurnitureDropped);
            foreach (PythonUnitResult u in s.Batch.Units)
                if (!RoomPlanPythonBridge.TryEvent(s.Batch, u, s.Selected[u.Id], "applied", null, out string err))
                    r.Facts["apply.feedback_error." + u.Id] = err;

            int walls = s.Batch.Units.Sum(u => s.Selected[u.Id].Plan.Walls.Count(w => !u.Boundary.Perimeter.ContainsKey(w.Id)));
            int doors = s.Batch.Units.Sum(u => s.Selected[u.Id].Plan.Doors.Count);
            int furniture = s.Batch.Units.Sum(u => s.Selected[u.Id].Plan.Furnishings.Count(f => s.Furniture.ContainsKey(f.Kind)))
                            - s.Made.FurnitureDropped.Count;
            var problems = new List<string>();
            if (s.Made.Walls.Count != walls) problems.Add("хана " + s.Made.Walls.Count + "/" + walls);
            if (s.Made.Doors.Count != doors) problems.Add("хаалга " + s.Made.Doors.Count + "/" + doors);
            if (s.Made.Furniture.Count != furniture) problems.Add("тавилга " + s.Made.Furniture.Count + "/" + furniture);
            if (s.Made.Tags.Count != s.Made.Rooms.Count) problems.Add("tag " + s.Made.Tags.Count + " ≠ room " + s.Made.Rooms.Count);
            // Нэг Ctrl+Z = нэг transaction: бүх нэгжийг ганц DocumentChanged (нэг нэртэй transaction) авчирсан байх ёстой.
            if (names.Count != 1 || names[0] != RoomPlanBatchApply.TransactionName) problems.Add("transaction: " + string.Join(" | ", names));
            int missing = AllMade(s).Count(id => !added.Contains(id.Value));
            if (missing > 0) problems.Add(missing + " элемент тэр transaction-д нэмэгдээгүй");
            return problems.Count == 0 ? StepState.Done : r.Fail(string.Join("; ", problems));
        }

        internal static IEnumerable<ElementId> AllMade(State s)
        {
            return s.ShellWalls.Concat(s.Made.Walls).Concat(s.Made.Doors).Concat(s.Made.Rooms).Concat(s.Made.Tags).Concat(s.Made.Furniture);
        }

        // ── Бодит Revit геометрээр шалгах ─────────────────────────

        internal static StepState Verify(GateRunner r, State s)
        {
            var v = new Verifier(s.Doc, s.Level, s.View, s.Batch, s.Selected, s.Made, s.CommonRoom, s.ShellWalls);
            v.Run();
            r.Facts["verify.hard"] = v.Hard.Count;
            r.Facts["verify.soft"] = v.Soft.Count;
            foreach (KeyValuePair<string, object> kv in v.Facts) r.Facts["verify." + kv.Key] = kv.Value;
            var j = new Json().Obj();
            j.Key("hard").Arr(); foreach (string h in v.Hard) j.Str(h); j.EndArr();
            j.Key("soft").Arr(); foreach (string h in v.Soft) j.Str(h); j.EndArr();
            j.EndObj().Save(Path.Combine(r.Job.RunDir, "verify.json"));
            foreach (string h in v.Hard) GateLog.Error("verify: " + h);
            foreach (string h in v.Soft) GateLog.Warn("verify: " + h);
            return v.Hard.Count == 0 ? StepState.Done : r.Fail(v.Hard.Count + " асуудал — verify.json");
        }

        // ── Зураг + хадгалах ──────────────────────────────────────

        internal static StepState Export(GateRunner r, State s, UIApplication app)
        {
            ZoomFit(app, s);
            string prefix = Path.Combine(r.Job.RunDir, "plan");
            var opt = new ImageExportOptions
            {
                ExportRange = ExportRange.SetOfViews,
                FilePath = prefix,
                ZoomType = ZoomFitType.FitToPage,
                PixelSize = 2600,
                FitDirection = FitDirectionType.Horizontal,
                ImageResolution = ImageResolution.DPI_150,
                HLRandWFViewsFileType = ImageFileType.PNG,
                ShadowViewsFileType = ImageFileType.PNG,
            };
            opt.SetViewsAndSheets(new List<ElementId> { s.View.Id });
            s.Doc.ExportImage(opt);
            string png = Directory.GetFiles(r.Job.RunDir, "plan*.png").OrderByDescending(File.GetLastWriteTime).FirstOrDefault();
            if (png == null) return r.Fail("PNG үүссэнгүй");
            string target = Path.Combine(r.Job.RunDir, "plan-generated.png");
            if (!string.Equals(png, target, StringComparison.OrdinalIgnoreCase)) { File.Copy(png, target, true); File.Delete(png); }
            r.Facts["export.png"] = target;
            s.ResultPath = Path.Combine(r.Job.ModelsDir, "RoomPlan_Generated.rvt");
            s.Doc.SaveAs(s.ResultPath, new SaveAsOptions { OverwriteExistingFile = true });
            r.Facts["export.rvt"] = s.ResultPath;
            return StepState.Done;
        }

        private static void ZoomFit(UIApplication app, State s)
        {
            UIDocument ui = app.ActiveUIDocument;
            if (ui == null) return;
            foreach (UIView v in ui.GetOpenUIViews())
                if (v.ViewId == s.View.Id) { try { v.ZoomToFit(); } catch { } }
        }

        // ── Ctrl+Z / Ctrl+Y (хэрэглэгчийнхтэй ижил Revit команд) ──

        internal static StepState PostEdit(GateRunner r, UIApplication app, bool undo)
        {
            RevitCommandId id;
            PostableCommand pc;
            if (Enum.TryParse(undo ? "Undo" : "Redo", out pc)) id = RevitCommandId.LookupPostableCommandId(pc);
            else id = RevitCommandId.LookupCommandId(undo ? "ID_EDIT_UNDO" : "ID_EDIT_REDO");
            if (id == null || !app.CanPostCommand(id)) return r.Fail((undo ? "Undo" : "Redo") + " командыг post хийх боломжгүй");
            app.PostCommand(id);
            r.Facts[(undo ? "undo" : "redo") + ".command"] = id.Name;
            return StepState.Done;
        }

        internal static StepState AfterUndo(GateRunner r, State s)
        {
            List<ElementId> made = AllMade(s).ToList();
            int alive = made.Count(id => s.Doc.GetElement(id) != null);
            if (alive > 0) return StepState.Wait;   // Revit post хийсэн командаа ExternalEvent-ийн дараа ажиллуулна
            HashSet<long> now = Snapshot(s.Doc);
            r.Facts["undo.removed"] = made.Count;
            r.Facts["undo.model_equals_plate"] = now.SetEquals(s.BeforeApply);
            return now.SetEquals(s.BeforeApply) ? StepState.Done : r.Fail("Undo-ийн дараа модел plate-тэй ижил биш (" + now.Count + " / " + s.BeforeApply.Count + ")");
        }

        internal static StepState AfterRedo(GateRunner r, State s)
        {
            List<ElementId> made = AllMade(s).ToList();
            int back = made.Count(id => s.Doc.GetElement(id) != null);
            if (back < made.Count) return StepState.Wait;
            int open = s.Made.Rooms.Count(id => !(s.Doc.GetElement(id) is Room room) || room.Area <= 0);
            r.Facts["redo.restored"] = back;
            return open == 0 ? StepState.Done : r.Fail("Redo-ийн дараа " + open + " room битүү биш");
        }

        internal static StepState Save(GateRunner r, State s, UIApplication app)
        {
            s.Doc.Save();
            ZoomFit(app, s);
            r.Facts["final.rvt"] = s.Doc.PathName;
            return StepState.Done;
        }
    }
}
