// TASK 6: Subdivide central hall X[12,52]×Y[12,52] into 5 rooms using Room Separation Lines
// Layout:
//   West stand (100):      X[12,16], Y[12,50]
//   Tennis court 1 (149a): X[16,32], Y[12,50]
//   Tennis court 2 (149b): X[32,48], Y[12,50]
//   East stand (132):      X[48,52], Y[12,50]
//   Warm-up strip (148):   X[12,52], Y[50,52]
//
// 3 vertical separators span only Y[12,50] to avoid fragmenting warm-up strip
// 1 horizontal separator at Y=50 spans full width X[12,52]

double FT(double m) => UnitUtils.ConvertToInternalUnits(m, UnitTypeId.Meters);
var l1 = new FilteredElementCollector(Doc).OfClass(typeof(Level)).Cast<Level>().First(l=>l.Name=="Level 1");
var view = new FilteredElementCollector(Doc).OfClass(typeof(ViewPlan)).Cast<ViewPlan>()
    .FirstOrDefault(v=>!v.IsTemplate && v.GenLevel!=null && v.GenLevel.Id==l1.Id);
var sp = SketchPlane.Create(Doc, Plane.CreateByNormalAndOrigin(XYZ.BasisZ, new XYZ(0,0,FT(0))));

void Sep(double x1,double y1,double x2,double y2){
    var ca = new CurveArray();
    ca.Append(Line.CreateBound(new XYZ(FT(x1),FT(y1),0), new XYZ(FT(x2),FT(y2),0)));
    Doc.Create.NewRoomBoundaryLines(sp, ca, view);
}
Sep(16,12,16,50); // W stand | court1 (only up to Y50)
Sep(32,12,32,50); // court1 | court2
Sep(48,12,48,50); // court2 | E stand
Sep(12,50,52,50); // central | warm-up strip (full width)
Doc.Regenerate();

Autodesk.Revit.DB.Architecture.Room R(double cx,double cy,string num,string name){
    var rm = Doc.Create.NewRoom(l1, new UV(FT(cx),FT(cy)));
    if(rm!=null){ rm.Number=num; rm.Name=name; }
    return rm;
}
R(14, 31, "100", "Арц-1 (75 суудал)");      // W stand X[12,16] Y[12,50]
R(24, 31, "149a","Теннисний талбай-1");      // X[16,32] Y[12,50]
R(40, 31, "149b","Теннисний талбай-2");      // X[32,48] Y[12,50]
R(50, 31, "132", "Арц-2 (75 суудал)");       // E stand X[48,52] Y[12,50]
R(32, 51, "148", "Тусгах өрөө");             // strip X[12,52] Y[50,52]

return "Central rooms placed (expect 5)";
