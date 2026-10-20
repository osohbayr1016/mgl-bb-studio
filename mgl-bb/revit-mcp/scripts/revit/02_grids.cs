double FT(double m) => UnitUtils.ConvertToInternalUnits(m, UnitTypeId.Meters);
double over = 4.0; // extend grid lines beyond building (m)
int made = 0;
for (int i = 0; i <= 8; i++)
{
    double x = i * 8.0;
    var lnV = Line.CreateBound(new XYZ(FT(x), FT(-over), 0), new XYZ(FT(x), FT(64 + over), 0));
    var gV = Grid.Create(Doc, lnV); gV.Name = "X" + (i + 1); made++;
    double y = i * 8.0;
    var lnH = Line.CreateBound(new XYZ(FT(-over), FT(y), 0), new XYZ(FT(64 + over), FT(y), 0));
    var gH = Grid.Create(Doc, lnH); gH.Name = "Y" + (i + 1); made++;
}
return "Grids created: " + made;
