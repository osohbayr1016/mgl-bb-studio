double FT(double m) => UnitUtils.ConvertToInternalUnits(m, UnitTypeId.Meters);
double H = 9.0;
var l1 = new FilteredElementCollector(Doc).OfClass(typeof(Level)).Cast<Level>().First(l=>l.Name=="Level 1");
var basics = new FilteredElementCollector(Doc).OfClass(typeof(WallType)).Cast<WallType>()
    .Where(w=>w.Kind==WallKind.Basic).ToList();
var ext = basics.FirstOrDefault(w=>w.Name.IndexOf("Generic",StringComparison.OrdinalIgnoreCase)>=0
                                 && w.Name.Contains("300"))
        ?? basics.OrderByDescending(w=>{double x=0;try{x=w.Width;}catch{}return x;}).First();

Wall MkWall(double x1,double y1,double x2,double y2){
    var ln = Line.CreateBound(new XYZ(FT(x1),FT(y1),0), new XYZ(FT(x2),FT(y2),0));
    return Wall.Create(Doc, ln, ext.Id, l1.Id, FT(H), 0.0, false, false);
}
var w1 = MkWall(0,0, 64,0);   // south
var w2 = MkWall(64,0, 64,64); // east
var w3 = MkWall(64,64, 0,64); // north
var w4 = MkWall(0,64, 0,0);   // west
Print($"Exterior wall type = '{ext.Name}'");
return $"Exterior walls: {w1.Id},{w2.Id},{w3.Id},{w4.Id}";
