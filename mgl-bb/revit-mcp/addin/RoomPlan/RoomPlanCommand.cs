using System;
using System.Collections.Generic;
using System.Linq;
using Autodesk.Revit.Attributes;
using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Architecture;
using Autodesk.Revit.DB.Structure;
using Autodesk.Revit.UI;
using Autodesk.Revit.UI.Selection;
using RevitMcpAddin.RoomPlan.Core;

namespace RevitMcpAddin.RoomPlan
{
    /// <summary>
    /// Manual-only, offline, non-destructive MVP. Plan preview is pure WPF.
    /// All native Revit elements are created in ONE transaction after approval.
    /// </summary>
    [Transaction(TransactionMode.Manual)]
    [Regeneration(RegenerationOption.Manual)]
    public sealed class RoomPlanCommand : IExternalCommand
    {
        private const string Title = "MGL — Өрөөний план үүсгэх";

        public Result Execute(ExternalCommandData commandData, ref string message, ElementSet elements)
        {
            if (!Licensing.LicenseGate.Ensure()) return Result.Cancelled;
            UIDocument ui = commandData.Application.ActiveUIDocument;
            Document doc = ui == null ? null : ui.Document;
            if (doc == null || doc.IsFamilyDocument || doc.IsReadOnly ||
                !(ui.ActiveView is ViewPlan view) || view.IsTemplate || view.ViewType != ViewType.FloorPlan)
            {
                TaskDialog.Show(Title, "Төслийн засварлах боломжтой Floor Plan харагдац нээгээд дахин оролдоно уу.");
                return Result.Cancelled;
            }
            Level level = view.GenLevel;
            if (level == null)
            {
                TaskDialog.Show(Title, "Энэ Floor Plan-тай холбогдсон Level байхгүй.");
                return Result.Cancelled;
            }

            // Use a real existing floor + its four enclosing room-bounding walls.
            // The earlier two-click empty-rectangle shortcut was not the requested workflow.
            ExistingFloorBoundary boundary;
            try { boundary = ExistingFloorBoundary.Pick(ui, level); }
            catch (Autodesk.Revit.Exceptions.OperationCanceledException) { return Result.Cancelled; }
            catch (ArgumentException ex)
            {
                TaskDialog.Show(Title, ex.Message);
                return Result.Cancelled;
            }

            double minX = boundary.MinX, minY = boundary.MinY;
            double maxX = boundary.MaxX, maxY = boundary.MaxY;
            double width = boundary.WidthMeters, height = boundary.HeightMeters;
            if (IsOccupied(doc, level, minX, minY, maxX, maxY, boundary))
            {
                TaskDialog.Show(Title, "Энэ шалны дотор нэмэлт хана, өрөө, багана, хаалга эсвэл тавилга байна. " +
                    "Зөвхөн гадна дөрвөн ханатай цэвэр эх загварыг сонгоно уу. Байгаа элементийг устгахгүй.");
                return Result.Cancelled;
            }

            PlanEntrySide entry;
            try { entry = boundary.PickEntrance(ui); }
            catch (Autodesk.Revit.Exceptions.OperationCanceledException) { return Result.Cancelled; }

            var preview = new RoomPlanPreview(width, height, entry);
            if (App.ShowOwned(preview, commandData.Application.MainWindowHandle) != true ||
                preview.SelectedPlan == null)
                return Result.Cancelled;
            GeneratedPlan generated = preview.SelectedPlan;

            // Recheck model state (including modifications by other add-ins while preview was open).
            // Re-read the same floor and wall coordinates after the modal preview.
            ExistingFloorBoundary latest;
            try { latest = ExistingFloorBoundary.Read(doc, boundary.Floor, level); }
            catch (ArgumentException ex)
            {
                TaskDialog.Show(Title, "Шал/хана өөрчлөгдсөн тул дахин шалгана уу: " + ex.Message);
                return Result.Cancelled;
            }
            bool changed = Math.Abs(latest.MinX - minX) > 0.01 ||
                Math.Abs(latest.MinY - minY) > 0.01 ||
                Math.Abs(latest.MaxX - maxX) > 0.01 ||
                Math.Abs(latest.MaxY - maxY) > 0.01 ||
                boundary.Perimeter.Any(kv => latest.Perimeter[kv.Key].Id != kv.Value.Id);
            if (doc.IsReadOnly || changed || IsOccupied(doc, level, minX, minY, maxX, maxY, latest))
            {
                TaskDialog.Show(Title, "Урьдчилан харснаас хойш талбай өөрчлөгдсөн. Дахин сонгоно уу.");
                return Result.Cancelled;
            }

            WallType wallType = new FilteredElementCollector(doc).OfClass(typeof(WallType))
                .Cast<WallType>().FirstOrDefault(w => w.Kind == WallKind.Basic);
            if (wallType == null)
            {
                TaskDialog.Show(Title, "Basic Wall төрлийн хана олдсонгүй. Project template-д Wall Type нэмнэ үү.");
                return Result.Cancelled;
            }
            // Do not guess Door or Furniture types. They must be explicitly
            // mapped by the architect from loaded Revit FamilySymbols.
            FamilySymbol doorType;
            var tagType = new FilteredElementCollector(doc)
                .OfCategory(BuiltInCategory.OST_RoomTags).WhereElementIsElementType().FirstOrDefault();
            if (tagType == null)
            {
                TaskDialog.Show(Title, "Room Tag Type олдсонгүй. Room Tag Family load хийгээд дахин оролдоно уу. Өөрчлөлт хийгдээгүй.");
                return Result.Cancelled;
            }

            var familyPicker = new RoomPlanFamilyPicker(doc);
            if (App.ShowOwned(familyPicker, commandData.Application.MainWindowHandle) != true ||
                familyPicker.Selected == null)
                return Result.Cancelled;
            doorType = doc.GetElement(familyPicker.DoorSymbolId) as FamilySymbol;
            if (doorType == null || doorType.Family == null ||
                doorType.Family.FamilyPlacementType != FamilyPlacementType.OneLevelBasedHosted)
            {
                TaskDialog.Show(Title, "Hosted Door Family сонголт хүчингүй байна.");
                return Result.Cancelled;
            }
            int createdDoors = 0, createdTags = 0, createdFurniture = 0;
            try
            {
                using (var tx = new Transaction(doc, "MGL — Өрөөний план үүсгэх"))
                {
                    if (tx.Start() != TransactionStatus.Started)
                        throw new InvalidOperationException("Revit transaction эхэлсэнгүй.");

                    // Never delete, move or edit any existing model element.
                    var walls = new Dictionary<string, Wall>(boundary.Perimeter, StringComparer.Ordinal);
                    foreach (PlanWall segment in generated.Walls.Where(w => !boundary.Perimeter.ContainsKey(w.Id)))
                    {
                        Line line = Line.CreateBound(At(minX, minY, level.Elevation, segment.Start),
                            At(minX, minY, level.Elevation, segment.End));
                        Wall wall = Wall.Create(doc, line, wallType.Id, level.Id, Metres(2.8), 0, false, false);
                        Parameter roomBounding = wall.get_Parameter(BuiltInParameter.WALL_ATTR_ROOM_BOUNDING);
                        if (roomBounding != null && !roomBounding.IsReadOnly) roomBounding.Set(1);
                        walls.Add(segment.Id, wall);
                    }
                    doc.Regenerate();

                    if (!doorType.IsActive) { doorType.Activate(); doc.Regenerate(); }
                    foreach (PlanDoor opening in generated.Doors)
                    {
                        // A single failed door cancels the ENTIRE plan. No incomplete BIM.
                        XYZ position = At(minX, minY, level.Elevation, opening.Center);
                        FamilyInstance door = doc.Create.NewFamilyInstance(position, doorType,
                            walls[opening.HostWall], level, StructuralType.NonStructural);
                        if (door == null) throw new InvalidOperationException("Хаалга үүссэнгүй: " + opening.HostWall);
                        createdDoors++;
                    }
                    doc.Regenerate();

                    var rooms = new List<Room>();
                    foreach (PlanRoom spec in generated.Rooms)
                    {
                        XYZ pt = At(minX, minY, level.Elevation, spec.Center);
                        Room room = doc.Create.NewRoom(level, new UV(pt.X, pt.Y));
                        if (room == null) throw new InvalidOperationException("Өрөө үүссэнгүй: " + spec.Name);
                        room.Name = spec.Name;
                        rooms.Add(room);
                    }
                    doc.Regenerate();
                    for (int i = 0; i < rooms.Count; i++)
                    {
                        if (rooms[i].Area <= 0)
                            throw new InvalidOperationException("Өрөө битүү хүрээлэгдсэнгүй: " + generated.Rooms[i].Name +
                                ". Бүх өөрчлөлтийг буцаана.");
                    }
                    foreach (Room room in rooms)
                    {
                        LocationPoint location = room.Location as LocationPoint;
                        if (location == null)
                            throw new InvalidOperationException("Room байрлал олдсонгүй: " + room.Name);
                        RoomTag tag = doc.Create.NewRoomTag(new LinkElementId(room.Id),
                            new UV(location.Point.X, location.Point.Y), view.Id);
                        if (tag == null) throw new InvalidOperationException("Room Tag үүссэнгүй: " + room.Name);
                        createdTags++;
                    }
                    // Includes Beds, Sofa, Kitchen Casework, WC and Basin.
                    // After native placement, Revit bounding boxes are checked
                    // against rooms, doors and one another BEFORE committing.
                    createdFurniture = RoomPlanFurnitureRevit.Create(doc, level,
                        minX, minY, generated, familyPicker.Selected);
                    if (tx.Commit() != TransactionStatus.Committed)
                        throw new InvalidOperationException("Revit transaction баталгаажаагүй.");
                }
            }
            catch (Exception ex)
            {
                message = ex.Message;
                TaskDialog.Show(Title, "План үүсгэсэнгүй. Алдаатай transaction буцаагдсан.\n\n" + ex.Message);
                return Result.Failed;
            }

            TaskDialog.Show(Title, generated.Rooms.Count + " Room, " +
                (generated.Walls.Count - 4) + " шинээр үүсгэсэн Wall (4 гадна ханыг ашигласан), " +
                createdDoors + " Door, " + createdTags + " Room Tag, " + createdFurniture + " Family.\n\n" +
                "Энэ нь тавилга, цонх болон БНбД/MNS-н эцсийн зөвшөөрлийн шалгалт биш. " +
                "Нэг Ctrl+Z-ээр буцаана.");
            return Result.Succeeded;
        }

        private static XYZ At(double x, double y, double z, PlanPoint p)
        {
            return new XYZ(x + Metres(p.X), y + Metres(p.Y), z);
        }

        private static double Metres(double value)
        {
            return UnitUtils.ConvertToInternalUnits(value, UnitTypeId.Meters);
        }

        private static bool IsOccupied(Document doc, Level level,
            double minX, double minY, double maxX, double maxY,
            ExistingFloorBoundary boundary)
        {
            var permitted = new HashSet<ElementId>(boundary.Perimeter.Values.Select(w => w.Id));
            foreach (Wall wall in new FilteredElementCollector(doc).OfClass(typeof(Wall)))
            {
                if (wall.LevelId != level.Id || permitted.Contains(wall.Id)) continue;
                BoundingBoxXYZ b = wall.get_BoundingBox(null);
                if (b == null || Overlap(b.Min.X, b.Min.Y, b.Max.X, b.Max.Y,
                    minX, minY, maxX, maxY)) return true;
            }
            foreach (Room room in new FilteredElementCollector(doc)
                .OfCategory(BuiltInCategory.OST_Rooms).WhereElementIsNotElementType())
            {
                if (room.LevelId != level.Id || room.Area <= 0) continue;
                BoundingBoxXYZ b = room.get_BoundingBox(null);
                if (b == null || Overlap(b.Min.X, b.Min.Y, b.Max.X, b.Max.Y,
                    minX, minY, maxX, maxY)) return true;
            }
            // Fail closed on existing hosted openings, interior elements, MEP fixtures,
            // or columns. Linked model elements are not supported in this phase.
            var categories = new[]
            {
                BuiltInCategory.OST_Doors, BuiltInCategory.OST_Windows,
                BuiltInCategory.OST_Furniture, BuiltInCategory.OST_Casework,
                BuiltInCategory.OST_PlumbingFixtures, BuiltInCategory.OST_Columns,
                BuiltInCategory.OST_StructuralColumns
            };
            foreach (BuiltInCategory category in categories)
                foreach (Element element in new FilteredElementCollector(doc)
                    .OfCategory(category).WhereElementIsNotElementType())
                {
                    BoundingBoxXYZ b = element.get_BoundingBox(null);
                    if (b != null && Overlap(b.Min.X, b.Min.Y, b.Max.X, b.Max.Y,
                        minX, minY, maxX, maxY)) return true;
                }
            return false;
        }

        private static bool Overlap(double ax1, double ay1, double ax2, double ay2,
            double bx1, double by1, double bx2, double by2)
        {
            const double gap = 0.02;
            return ax1 <= bx2 + gap && ax2 >= bx1 - gap &&
                   ay1 <= by2 + gap && ay2 >= by1 - gap;
        }
    }
}
