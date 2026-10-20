// TASK 9 — Part A: Place main entrance door in south exterior wall (best-effort)
// ============================================================================
// PART A
double FT(double m) => UnitUtils.ConvertToInternalUnits(m, UnitTypeId.Meters);
var l1 = new FilteredElementCollector(Doc).OfClass(typeof(Level)).Cast<Level>().First(l=>l.Name=="Level 1");
var dsym = new FilteredElementCollector(Doc).OfClass(typeof(FamilySymbol))
    .OfCategory(BuiltInCategory.OST_Doors).Cast<FamilySymbol>().FirstOrDefault();
int doors=0;
if(dsym!=null){
    if(!dsym.IsActive){ dsym.Activate(); Doc.Regenerate(); }
    var southWall = new FilteredElementCollector(Doc).OfClass(typeof(Wall)).Cast<Wall>()
        .FirstOrDefault(w=>{
            var lc=w.Location as LocationCurve; if(lc==null) return false;
            var ln=lc.Curve as Line; if(ln==null) return false;
            return Math.Abs(ln.GetEndPoint(0).Y)<FT(0.5) && Math.Abs(ln.GetEndPoint(1).Y)<FT(0.5);
        });
    if(southWall!=null){
        var p = new XYZ(FT(32),FT(0),FT(0));
        Doc.Create.NewFamilyInstance(p, dsym, southWall, l1,
            Autodesk.Revit.DB.Structure.StructuralType.NonStructural);
        doors++;
    }
}
return "Doors placed: " + doors + (dsym==null?" (no door family loaded — skipped, OK)":"");

// ============================================================================
// PART B — Tag all placed rooms
// ============================================================================
var l1 = new FilteredElementCollector(Doc).OfClass(typeof(Level)).Cast<Level>().First(l=>l.Name=="Level 1");
var view = new FilteredElementCollector(Doc).OfClass(typeof(ViewPlan)).Cast<ViewPlan>()
    .First(v=>!v.IsTemplate && v.GenLevel!=null && v.GenLevel.Id==l1.Id);
var rooms = new FilteredElementCollector(Doc).OfCategory(BuiltInCategory.OST_Rooms)
    .WhereElementIsNotElementType().Cast<Autodesk.Revit.DB.Architecture.Room>()
    .Where(r=>r.Area>0).ToList();
int tags=0, fail=0;
foreach(var r in rooms){
    var lp = r.Location as LocationPoint; if(lp==null) continue;
    try {
        var uv = new UV(lp.Point.X, lp.Point.Y);
        Doc.Create.NewRoomTag(new LinkElementId(r.Id), uv, view.Id); tags++;
    } catch(Exception ex){ fail++; if(fail<=2) Print("tag fail: "+ex.Message); }
}
Print($"rooms={rooms.Count} tagFail={fail}");
return "Room tags: " + tags;

// ============================================================================
// PART C — SaveAs to disk
// ============================================================================
var path = @"C:\Users\US\projects\revit-mcp\output\Tennis_Hall_Floor1.rvt";
System.IO.Directory.CreateDirectory(System.IO.Path.GetDirectoryName(path));
var opt = new SaveAsOptions(); opt.OverwriteExistingFile = true;
Doc.SaveAs(path, opt);
return "Saved: " + path;
