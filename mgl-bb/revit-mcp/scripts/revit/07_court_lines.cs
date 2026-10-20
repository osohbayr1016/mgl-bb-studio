double FT(double m) => UnitUtils.ConvertToInternalUnits(m, UnitTypeId.Meters);
var sp = SketchPlane.Create(Doc, Plane.CreateByNormalAndOrigin(XYZ.BasisZ, new XYZ(0,0,FT(0))));
double CL = 23.77, CW = 10.97;
int n=0;
void Seg(double x1,double y1,double x2,double y2){
    Doc.Create.NewModelCurve(
        Line.CreateBound(new XYZ(FT(x1),FT(y1),0), new XYZ(FT(x2),FT(y2),0)), sp);
    n++;
}
void Court(double cx,double cy){
    double x0=cx-CW/2, x1=cx+CW/2, y0=cy-CL/2, y1=cy+CL/2;
    Seg(x0,y0,x1,y0); Seg(x1,y0,x1,y1); Seg(x1,y1,x0,y1); Seg(x0,y1,x0,y0); // perimeter (4)
    Seg(x0,cy,x1,cy); // net line (center)
    Seg(x0,cy-6.4,x1,cy-6.4); Seg(x0,cy+6.4,x1,cy+6.4); // service lines (2)
}
Court(24,31); // Court-1
Court(40,31); // Court-2
return "Court line segments: " + n;
