double FT(double m) => UnitUtils.ConvertToInternalUnits(m, UnitTypeId.Meters);
double H = 9.0;
var l1 = new FilteredElementCollector(Doc).OfClass(typeof(Level)).Cast<Level>().First(l=>l.Name=="Level 1");
var basics = new FilteredElementCollector(Doc).OfClass(typeof(WallType)).Cast<WallType>()
    .Where(w=>w.Kind==WallKind.Basic).ToList();
var inter = basics.FirstOrDefault(w=>w.Name=="Interior - 4 7/8\" Partition (1-hr)")
          ?? basics.First(w=>w.Name.StartsWith("Interior"));
Wall MkWall(double x1,double y1,double x2,double y2){
    var ln = Line.CreateBound(new XYZ(FT(x1),FT(y1),0), new XYZ(FT(x2),FT(y2),0));
    return Wall.Create(Doc, ln, inter.Id, l1.Id, FT(H), 0.0, false, false);
}
MkWall(0,12, 64,12);  // S band / middle divider (full width)
MkWall(0,52, 64,52);  // N band / middle divider (full width)
MkWall(12,12, 12,52); // W band / central divider
MkWall(52,12, 52,52); // E band / central divider
Print($"Interior wall type = '{inter.Name}'");
return "Zone walls: 4 created";
