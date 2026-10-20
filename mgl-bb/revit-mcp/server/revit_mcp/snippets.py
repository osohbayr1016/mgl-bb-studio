"""Pre-baked C# snippets used by the read-only convenience tools.

These run through the same /execute path as user code, so the add-in stays a
pure code executor (it only knows how to run C#).
"""

MODEL_INFO = r"""
Print("Title: " + Doc.Title);
Print("PathName: " + (string.IsNullOrEmpty(Doc.PathName) ? "(unsaved)" : Doc.PathName));
var av = Doc.ActiveView;
Print("ActiveView: " + (av != null ? av.Name + " (" + av.ViewType + ")" : "none"));

var levels = new FilteredElementCollector(Doc)
    .OfClass(typeof(Level)).Cast<Level>()
    .OrderBy(l => l.Elevation).ToList();
Print("Levels (" + levels.Count + "):");
foreach (var l in levels)
    Print("  - " + l.Name + " @ " + l.Elevation.ToString("0.##") + " ft (Id " + l.Id + ")");

int walls = new FilteredElementCollector(Doc).OfCategory(BuiltInCategory.OST_Walls).WhereElementIsNotElementType().GetElementCount();
int doors = new FilteredElementCollector(Doc).OfCategory(BuiltInCategory.OST_Doors).WhereElementIsNotElementType().GetElementCount();
int rooms = new FilteredElementCollector(Doc).OfCategory(BuiltInCategory.OST_Rooms).GetElementCount();
int grids = new FilteredElementCollector(Doc).OfCategory(BuiltInCategory.OST_Grids).WhereElementIsNotElementType().GetElementCount();
Print("Counts -> Walls: " + walls + ", Doors: " + doors + ", Rooms: " + rooms + ", Grids: " + grids);
return "ok";
"""

SELECTION = r"""
var ids = UiDoc.Selection.GetElementIds();
Print("Selected elements: " + ids.Count);
foreach (var id in ids)
{
    var e = Doc.GetElement(id);
    string cat = (e != null && e.Category != null) ? e.Category.Name : "?";
    string name = e != null ? e.Name : "?";
    Print("  - Id " + id + ": " + cat + " / " + name);
}
return ids.Count + " element(s) selected";
"""
