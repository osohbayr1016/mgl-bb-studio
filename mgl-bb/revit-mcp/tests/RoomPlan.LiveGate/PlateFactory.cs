using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Autodesk.Revit.ApplicationServices;
using Autodesk.Revit.DB;
using RevitMcpAddin.RoomPlan.Core;

namespace MglRpGate
{
    /// <summary>
    /// Туршилтын «plate» — нэг давхрын эгнээ байр (8.5 м гүн), гурван тусдаа орон сууцны нэгж, нэг урт урд ба хойд гадна хана,
    /// нэгжүүдийн хооронд хуваалцсан хана.  Нэгж бүр өөрийн тэгш өнцөгт Floor-той — production-ий «Олон өрөөний план» яг
    /// ийм оролт хүлээдэг.  U03-ийн орц зүүн (east) талд — урд талын бус орцыг (код дотор «south» гэж хатуу бичсэн газрууд)
    /// бодитоор шалгахын тулд.
    ///
    ///   x: 0 ─ U01 (11.0 м) ─ 11 000 ─ U02 (9.0 м) ─ 20 000 ─ U03 (8.0 м) ─ 28 000,   y: 0 … 8 500  (хананы тэнхлэг, мм)
    /// </summary>
    internal static class Plate
    {
        public const double DepthMm = 8500, LengthMm = 28000, ExteriorMm = 200, InteriorMm = 100, WallHeightMm = 3000;

        /// <summary>One apartment and the program the architect sets in «Нэгж бүрийн хөтөлбөр»
        /// (0 / null = keep the production suggestion).  The three cover the three furniture classes.</summary>
        public sealed class Unit
        {
            public string Id;
            public double X0, X1;
            public PlanEntrySide Entry;
            public int Bedrooms, Bathrooms;
            public string Tier;
        }

        public static readonly Unit[] Units =
        {
            new Unit { Id = "U01", X0 = 0, X1 = 11000, Entry = PlanEntrySide.South, Bedrooms = 2, Bathrooms = 2, Tier = "luxury" },
            new Unit { Id = "U02", X0 = 11000, X1 = 20000, Entry = PlanEntrySide.South, Bedrooms = 3, Bathrooms = 2, Tier = "standard" },
            new Unit { Id = "U03", X0 = 20000, X1 = 28000, Entry = PlanEntrySide.East, Bedrooms = 2, Bathrooms = 1, Tier = "economy" },
        };

        public const string ExteriorType = "MGL plate exterior 200";
        /// <summary>Архитектор «Дотор ханын төрөл»-д сонгох төрөл.</summary>
        public const string InteriorType = "MGL plate interior 100";
        public const string SlabType = "MGL plate slab 200";

        /// <summary>Family-ийн сан (2024-ийн metric сан — Revit 2027-ийн локал сан бараг хоосон, ачаалахад upgrade хийгдэнэ).</summary>
        public static readonly Dictionary<string, string[]> Families = new Dictionary<string, string[]>(StringComparer.Ordinal)
        {
            { "door", new[] { "Doors", "Commercial", "M_Door-Passage-Single-Flush.rfa" } },
            { "Bed", new[] { "Furniture", "Beds", "M_Bed-Standard.rfa" } },
            { "Sofa", new[] { "Furniture", "Seating", "M_Sofa.rfa" } },
            { "Kitchen", new[] { "Casework", "Counter Tops", "M_Counter Top.rfa" } },
            { "Toilet", new[] { "Plumbing", "Architectural", "Fixtures", "Water Closets", "M_Toilet-Domestic-3D.rfa" } },
            { "Basin", new[] { "Plumbing", "Architectural", "Fixtures", "Sinks", "M_Sink Vanity-Square.rfa" } },
            { "Nightstand", new[] { "Furniture", "Tables", "M_Table-Night Stand.rfa" } },
            { "Wardrobe", new[] { "Furniture", "Storage", "M_Dresser.rfa" } },
            { "Desk", new[] { "Furniture", "Tables", "M_Desk.rfa" } },
            { "CoffeeTable", new[] { "Furniture", "Tables", "M_Table-Coffee.rfa" } },
            { "TvUnit", new[] { "Furniture", "M_TV Stand.rfa" } },
            { "DiningTable", new[] { "Furniture", "Tables", "M_Table-Dining.rfa" } },
            { "Bathtub", new[] { "Plumbing", "MEP", "Fixtures", "Bathtubs", "M_Bath Tub - Maestro.rfa" } },
            { "Shower", new[] { "Plumbing", "Architectural", "Fixtures", "Showers", "M_Shower Stall-2D.rfa" } },
            { "Washer", new[] { "Specialty Equipment", "Domestic", "Mid-Range", "M_Washer-Front_Load.rfa" } },
            { "roomtag", new[] { "Annotations", "M_Room Tag.rfa" } },
        };
    }

    /// <summary>
    /// «Давхрын план»-ы туршилтын давхар: 40 × 18 м (өгөгдмөл, `floor_size`) хоосон тэгш өнцөгт давхар — нэг Floor + 4 гадна хана (300 мм), дотор юу ч
    /// байхгүй.  Production «Давхрын план» яг ийм оролт хүлээдэг (барилгын контур, хоосон давхар).  18 м гүн = төв коридор
    /// (эгнээ бүр (18 − 1.6 − 0.2) / 2 ≈ 8.1 м ≥ 7.8).
    /// </summary>
    internal static class FloorPlate
    {
        public const double ExteriorMm = 300, PartitionMm = 200, WallHeightMm = 3000;

        /// <summary>`job.ini` `floor_size=40x18` (м, урт × гүн) — өгөгдмөл 40 × 18 (төв коридор); 12 м гүн = галерей.</summary>
        public static void Size(GateJob job, out double lengthMm, out double depthMm)
        {
            string[] p = job.Get("floor_size", "40x18").ToLowerInvariant().Split('x');
            lengthMm = double.Parse(p[0], System.Globalization.CultureInfo.InvariantCulture) * 1000;
            depthMm = double.Parse(p[1], System.Globalization.CultureInfo.InvariantCulture) * 1000;
        }
        public const string ExteriorType = "MGL floor exterior 300";
        /// <summary>Архитектор «Коридор, айл хоорондын хана»-д сонгох төрөл.</summary>
        public const string PartitionType = "MGL floor partition 200";
    }

    internal static class PlateFactory
    {
        /// <summary>Шинэ төсөл (template-ээс) → plate → family → `models\RoomPlan_Plate.rvt`.  Баримтыг хаана (нээх нь тусдаа алхам).</summary>
        public static string Build(Application app, GateJob job, Dictionary<string, object> facts)
        {
            Directory.CreateDirectory(job.ModelsDir);
            string path = Path.Combine(job.ModelsDir, "RoomPlan_Plate.rvt");
            Document doc = app.NewProjectDocument(job.Template);
            try
            {
                using (var t = new Transaction(doc, "MGL gate: plate"))
                {
                    t.Start();
                    Level level = new FilteredElementCollector(doc).OfClass(typeof(Level)).Cast<Level>().OrderBy(l => l.Elevation).First();
                    ViewPlan plan = PlanOf(doc, level);
                    if (plan == null)
                    {
                        ViewFamilyType fp = new FilteredElementCollector(doc).OfClass(typeof(ViewFamilyType)).Cast<ViewFamilyType>()
                            .First(v => v.ViewFamily == ViewFamily.FloorPlan);
                        plan = ViewPlan.Create(doc, fp.Id, level.Id);
                    }
                    WallType ext = WallTypeOf(doc, Plate.ExteriorType, Plate.ExteriorMm);
                    WallTypeOf(doc, Plate.InteriorType, Plate.InteriorMm);
                    var walls = new List<Wall>
                    {
                        MakeWall(doc, ext, level, 0, 0, Plate.LengthMm, 0),                          // урд (бүх нэгжид нэг хана)
                        MakeWall(doc, ext, level, 0, Plate.DepthMm, Plate.LengthMm, Plate.DepthMm),  // хойд
                    };
                    foreach (double x in new[] { 0, 11000, 20000, Plate.LengthMm })
                        walls.Add(MakeWall(doc, ext, level, x, 0, x, Plate.DepthMm));
                    FloorType slab = FloorTypeOf(doc, Plate.SlabType, 200);
                    var floors = new List<string>();
                    foreach (Plate.Unit u in Plate.Units)
                    {
                        Floor f = Floor.Create(doc, new List<CurveLoop> { Rect(u.X0, 0, u.X1, Plate.DepthMm) }, slab.Id, level.Id);
                        floors.Add(u.Id + "=" + f.Id.Value);
                    }
                    SetupPlan(plan, Plate.LengthMm, Plate.DepthMm);
                    t.Commit();
                    facts["plate.level"] = level.Name;
                    facts["plate.view"] = plan.Name;
                    facts["plate.walls"] = string.Join(",", walls.Select(w => w.Id.Value));
                    facts["plate.floors"] = string.Join(";", floors);
                    GateLog.Info("plate: " + walls.Count + " гадна хана, " + floors.Count + " floor, level " + level.Name + ", view " + plan.Name);
                }
                LoadFamilies(doc, job, facts);
                doc.SaveAs(path, new SaveAsOptions { OverwriteExistingFile = true });
                GateLog.Info("saved " + path);
            }
            finally { doc.Close(false); }
            return path;
        }

        /// <summary>Шинэ төсөл → 40 × 18 м ХООСОН давхар (нэг Floor + 4 гадна хана) → family → `models\RoomPlan_FloorPlate.rvt`.</summary>
        public static string BuildFloor(Application app, GateJob job, Dictionary<string, object> facts)
        {
            Directory.CreateDirectory(job.ModelsDir);
            string path = Path.Combine(job.ModelsDir, "RoomPlan_FloorPlate.rvt");
            Document doc = app.NewProjectDocument(job.Template);
            try
            {
                using (var t = new Transaction(doc, "MGL gate: floor plate"))
                {
                    t.Start();
                    Level level = new FilteredElementCollector(doc).OfClass(typeof(Level)).Cast<Level>().OrderBy(l => l.Elevation).First();
                    ViewPlan plan = PlanOf(doc, level);
                    if (plan == null)
                    {
                        ViewFamilyType fp = new FilteredElementCollector(doc).OfClass(typeof(ViewFamilyType)).Cast<ViewFamilyType>()
                            .First(v => v.ViewFamily == ViewFamily.FloorPlan);
                        plan = ViewPlan.Create(doc, fp.Id, level.Id);
                    }
                    WallType ext = WallTypeOf(doc, FloorPlate.ExteriorType, FloorPlate.ExteriorMm);
                    WallTypeOf(doc, FloorPlate.PartitionType, FloorPlate.PartitionMm);
                    WallTypeOf(doc, Plate.InteriorType, Plate.InteriorMm);
                    FloorPlate.Size(job, out double L, out double D);
                    double h = FloorPlate.WallHeightMm;
                    var walls = new List<Wall>
                    {
                        Wall.Create(doc, Line.CreateBound(U.P(0, 0), U.P(L, 0)), ext.Id, level.Id, U.Mm(h), 0, false, false),
                        Wall.Create(doc, Line.CreateBound(U.P(L, 0), U.P(L, D)), ext.Id, level.Id, U.Mm(h), 0, false, false),
                        Wall.Create(doc, Line.CreateBound(U.P(L, D), U.P(0, D)), ext.Id, level.Id, U.Mm(h), 0, false, false),
                        Wall.Create(doc, Line.CreateBound(U.P(0, D), U.P(0, 0)), ext.Id, level.Id, U.Mm(h), 0, false, false),
                    };
                    FloorType slab = FloorTypeOf(doc, Plate.SlabType, 200);
                    Floor f = Floor.Create(doc, new List<CurveLoop> { Rect(0, 0, L, D) }, slab.Id, level.Id);
                    SetupPlan(plan, L, D);
                    t.Commit();
                    facts["plate.level"] = level.Name;
                    facts["plate.view"] = plan.Name;
                    facts["plate.walls"] = string.Join(",", walls.Select(w => w.Id.Value));
                    facts["plate.floor"] = f.Id.Value + " · " + U.F(L / 1000) + " × " + U.F(D / 1000) + " м";
                    GateLog.Info("floor plate: 4 гадна хана, 1 floor " + U.F(L / 1000) + "×" + U.F(D / 1000) + " м, level " + level.Name);
                }
                LoadFamilies(doc, job, facts);
                doc.SaveAs(path, new SaveAsOptions { OverwriteExistingFile = true });
                GateLog.Info("saved " + path);
            }
            finally { doc.Close(false); }
            return path;
        }

        private static void SetupPlan(ViewPlan plan, double lengthMm, double depthMm)
        {
            plan.DetailLevel = ViewDetailLevel.Fine;
            plan.Scale = 100;
            plan.CropBoxActive = true;
            plan.CropBoxVisible = false;
            BoundingBoxXYZ crop = plan.CropBox;
            crop.Min = new XYZ(U.Mm(-2500), U.Mm(-3000), crop.Min.Z);
            crop.Max = new XYZ(U.Mm(lengthMm + 2500), U.Mm(depthMm + 2500), crop.Max.Z);
            plan.CropBox = crop;
        }

        private static void LoadFamilies(Document doc, GateJob job, Dictionary<string, object> facts)
        {
            using (var t = new Transaction(doc, "MGL gate: families"))
            {
                t.Start();
                foreach (KeyValuePair<string, string[]> kv in Plate.Families)
                {
                    string lib = string.IsNullOrEmpty(job.Library) ? null : Path.Combine(new[] { job.Library }.Concat(kv.Value).ToArray());
                    if (lib == null || !File.Exists(lib)) { facts["family." + kv.Key] = "MISSING " + lib; GateLog.Warn("family алга: " + lib); continue; }
                    Family family;
                    if (!doc.LoadFamily(lib, out family))
                        family = new FilteredElementCollector(doc).OfClass(typeof(Family)).Cast<Family>()
                            .FirstOrDefault(x => x.Name == Path.GetFileNameWithoutExtension(lib));
                    facts["family." + kv.Key] = family == null ? "LOAD FAILED" :
                        family.Name + " · " + family.FamilyPlacementType + " · " + family.GetFamilySymbolIds().Count + " төрөл";
                    GateLog.Info("family " + kv.Key + ": " + facts["family." + kv.Key]);
                }
                t.Commit();
            }
        }

        internal static ViewPlan PlanOf(Document doc, Level lv)
        {
            return new FilteredElementCollector(doc).OfClass(typeof(ViewPlan)).Cast<ViewPlan>()
                .FirstOrDefault(v => !v.IsTemplate && v.ViewType == ViewType.FloorPlan && v.GenLevel != null && v.GenLevel.Id == lv.Id);
        }

        private static Wall MakeWall(Document doc, WallType type, Level lv, double x0, double y0, double x1, double y1)
        {
            return Wall.Create(doc, Line.CreateBound(U.P(x0, y0), U.P(x1, y1)), type.Id, lv.Id, U.Mm(Plate.WallHeightMm), 0, false, false);
        }

        private static CurveLoop Rect(double x0, double y0, double x1, double y1)
        {
            var pts = new[] { U.P(x0, y0), U.P(x1, y0), U.P(x1, y1), U.P(x0, y1) };
            var loop = new CurveLoop();
            for (int i = 0; i < 4; i++) loop.Append(Line.CreateBound(pts[i], pts[(i + 1) % 4]));
            return loop;
        }

        // Төрлийн туслахууд — WallElevation gate-ийн ModelFactory-гаас (ХЭМЖСЭН: шинэ CreateSingleLayerCompoundStructure-ийг ханын
        // төрөл «wrong EndCap condition»-оор татгалздаг тул байгаа нэг давхаргатай бүтцийн зузааныг л солино).

        private static WallType WallTypeOf(Document doc, string name, double widthMm)
        {
            WallType found = new FilteredElementCollector(doc).OfClass(typeof(WallType)).Cast<WallType>().FirstOrDefault(t => t.Name == name);
            if (found != null) return found;
            WallType basic = OneLayerFirst(new FilteredElementCollector(doc).OfClass(typeof(WallType)).Cast<WallType>().Where(t => t.Kind == WallKind.Basic));
            var wt = (WallType)basic.Duplicate(name);
            SetSingleLayer(wt, U.Mm(widthMm));
            return wt;
        }

        private static FloorType FloorTypeOf(Document doc, string name, double thicknessMm)
        {
            FloorType ft = new FilteredElementCollector(doc).OfClass(typeof(FloorType)).Cast<FloorType>().FirstOrDefault(t => t.Name == name);
            if (ft != null) return ft;
            FloorType basic = OneLayerFirst(new FilteredElementCollector(doc).OfClass(typeof(FloorType)).Cast<FloorType>().Where(t => !t.IsFoundationSlab));
            ft = (FloorType)basic.Duplicate(name);
            SetSingleLayer(ft, U.Mm(thicknessMm));
            return ft;
        }

        private static T OneLayerFirst<T>(IEnumerable<T> types) where T : HostObjAttributes
        {
            List<T> list = types.ToList();
            return list.FirstOrDefault(t => { CompoundStructure c = t.GetCompoundStructure(); return c != null && c.LayerCount == 1; }) ?? list.First();
        }

        private static void SetSingleLayer(HostObjAttributes type, double widthFt)
        {
            CompoundStructure cs = type.GetCompoundStructure();
            if (cs.LayerCount == 1) cs.SetLayerWidth(0, widthFt);
            else
            {
                int si = cs.StructuralMaterialIndex >= 0 ? cs.StructuralMaterialIndex : 0;
                ElementId mat = cs.GetMaterialId(si);
                cs.SetNumberOfShellLayers(ShellLayerType.Exterior, 0);
                cs.SetNumberOfShellLayers(ShellLayerType.Interior, 0);
                cs.SetLayers(new List<CompoundStructureLayer> { new CompoundStructureLayer(widthFt, MaterialFunctionAssignment.Structure, mat) });
                cs.StructuralMaterialIndex = 0;
            }
            type.SetCompoundStructure(cs);
        }
    }
}
