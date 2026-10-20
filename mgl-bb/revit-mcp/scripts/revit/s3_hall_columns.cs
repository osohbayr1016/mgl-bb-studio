// TASK 3: Place 14 steel hall columns at X∈{12,52} and Y∈{14,16,24,32,40,48,52}
// From Level 1 (0m) to Roof-Hall (12.2m)
double FT(double m)=>UnitUtils.ConvertToInternalUnits(m,UnitTypeId.Meters);
var l1=new FilteredElementCollector(Doc).OfClass(typeof(Level)).Cast<Level>().First(l=>l.Name=="Level 1");
var rh=new FilteredElementCollector(Doc).OfClass(typeof(Level)).Cast<Level>().First(l=>l.Name=="Roof-Hall");
var sym=new FilteredElementCollector(Doc).OfCategory(BuiltInCategory.OST_StructuralColumns).OfClass(typeof(FamilySymbol)).Cast<FamilySymbol>()
    .FirstOrDefault(s=>s.Name=="W14X109"&&s.FamilyName.Contains("W Shapes"))
    ?? new FilteredElementCollector(Doc).OfCategory(BuiltInCategory.OST_StructuralColumns).OfClass(typeof(FamilySymbol)).Cast<FamilySymbol>().First(s=>s.FamilyName.Contains("W Shapes"));
if(!sym.IsActive){sym.Activate();Doc.Regenerate();}
double[] hy={14,16,24,32,40,48,52}; int n=0;
foreach(var x in new[]{12.0,52.0}) foreach(var y in hy){
    var c=Doc.Create.NewFamilyInstance(new XYZ(FT(x),FT(y),0), sym, l1, Autodesk.Revit.DB.Structure.StructuralType.Column);
    c.get_Parameter(BuiltInParameter.FAMILY_BASE_LEVEL_PARAM).Set(l1.Id);
    c.get_Parameter(BuiltInParameter.FAMILY_TOP_LEVEL_PARAM).Set(rh.Id);
    c.get_Parameter(BuiltInParameter.FAMILY_BASE_LEVEL_OFFSET_PARAM).Set(0.0);
    c.get_Parameter(BuiltInParameter.FAMILY_TOP_LEVEL_OFFSET_PARAM).Set(0.0);
    n++;
}
return "Hall columns: "+n;
