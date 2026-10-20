double FT(double m) => UnitUtils.ConvertToInternalUnits(m, UnitTypeId.Meters);
var l1 = new FilteredElementCollector(Doc).OfClass(typeof(Level)).Cast<Level>().First(l=>l.Name=="Level 1");
var sp = SketchPlane.Create(Doc, Plane.CreateByNormalAndOrigin(XYZ.BasisZ, new XYZ(0,0,FT(0))));
var ft = new FilteredElementCollector(Doc).OfClass(typeof(FloorType)).Cast<FloorType>().First();

void Platform(double x0,double y0,double x1,double y1){
    var loop = new CurveLoop();
    loop.Append(Line.CreateBound(new XYZ(FT(x0),FT(y0),0), new XYZ(FT(x1),FT(y0),0)));
    loop.Append(Line.CreateBound(new XYZ(FT(x1),FT(y0),0), new XYZ(FT(x1),FT(y1),0)));
    loop.Append(Line.CreateBound(new XYZ(FT(x1),FT(y1),0), new XYZ(FT(x0),FT(y1),0)));
    loop.Append(Line.CreateBound(new XYZ(FT(x0),FT(y1),0), new XYZ(FT(x0),FT(y0),0)));
    Floor.Create(Doc, new List<CurveLoop>{loop}, ft.Id, l1.Id);
}
int seats=0;
void SeatMark(double cx,double cy){
    Doc.Create.NewModelCurve(Line.CreateBound(
        new XYZ(FT(cx-0.2),FT(cy),0), new XYZ(FT(cx+0.2),FT(cy),0)), sp);
    seats++;
}
void Stand(double xStart,double rowDir){ // rowDir +1 rows go +X (W); -1 rows go -X (E)
    double y0 = 31 - 7.5/2; // 15 seats * 0.5m = 7.5m, centered on y=31
    for(int row=0; row<5; row++){
        double cx = xStart + rowDir*(0.35 + row*0.7);
        for(int s=0;s<15;s++){
            double cy = y0 + 0.25 + s*0.5;
            SeatMark(cx, cy);
        }
    }
}
Platform(12.2,19, 15.8,43); // W stand platform
Platform(48.2,19, 51.8,43); // E stand platform
Stand(12.2, +1); // W: rows inward (+X)
Stand(51.8, -1); // E: rows inward (-X)
return "Stands done. Seat marks: " + seats;
