// TASK 4: Place 56 perimeter steel columns on the 8m grid
// Grid: x,y in {0,8,16,24,32,40,48,56,64}
// Exclude hall interior: x>12 & x<52 & y>14 & y<52 (i.e. x in {16..48} & y in {16..48} = 25 points)
// Columns from Level 1 (0) to Roof-Perimeter (9.0m)
// Transaction is already open — do NOT create one

double FT(double m)=>UnitUtils.ConvertToInternalUnits(m,UnitTypeId.Meters);
var l1=new FilteredElementCollector(Doc).OfClass(typeof(Level)).Cast<Level>().First(l=>l.Name=="Level 1");
var rp=new FilteredElementCollector(Doc).OfClass(typeof(Level)).Cast<Level>().First(l=>l.Name=="Roof-Perimeter");
var sym=new FilteredElementCollector(Doc).OfCategory(BuiltInCategory.OST_StructuralColumns).OfClass(typeof(FamilySymbol)).Cast<FamilySymbol>()
    .FirstOrDefault(s=>s.Name=="W10X49"&&s.FamilyName.Contains("W Shapes"))
    ?? new FilteredElementCollector(Doc).OfCategory(BuiltInCategory.OST_StructuralColumns).OfClass(typeof(FamilySymbol)).Cast<FamilySymbol>().First(s=>s.FamilyName.Contains("W Shapes"));
if(!sym.IsActive){sym.Activate();Doc.Regenerate();}
double[] g={0,8,16,24,32,40,48,56,64}; int n=0;
foreach(var x in g) foreach(var y in g){
    bool hall=(x>12&&x<52&&y>14&&y<52);
    if(hall) continue;
    var c=Doc.Create.NewFamilyInstance(new XYZ(FT(x),FT(y),0), sym, l1, Autodesk.Revit.DB.Structure.StructuralType.Column);
    c.get_Parameter(BuiltInParameter.FAMILY_BASE_LEVEL_PARAM).Set(l1.Id);
    c.get_Parameter(BuiltInParameter.FAMILY_TOP_LEVEL_PARAM).Set(rp.Id);
    c.get_Parameter(BuiltInParameter.FAMILY_BASE_LEVEL_OFFSET_PARAM).Set(0.0);
    c.get_Parameter(BuiltInParameter.FAMILY_TOP_LEVEL_OFFSET_PARAM).Set(0.0);
    n++;
}
return "Perimeter columns: "+n;
