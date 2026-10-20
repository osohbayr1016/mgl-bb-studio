double FT(double m)=>UnitUtils.ConvertToInternalUnits(m,UnitTypeId.Meters);
var lvls=new FilteredElementCollector(Doc).OfClass(typeof(Level)).Cast<Level>().ToList();
Level Ensure(string nm,double m){ var ex=lvls.FirstOrDefault(l=>l.Name==nm); if(ex!=null)return ex; var l=Level.Create(Doc,FT(m)); l.Name=nm; return l; }
var rp=Ensure("Roof-Perimeter",9.0);
var rh=Ensure("Roof-Hall",12.2);
return $"Levels: {rp.Name}@9.0, {rh.Name}@12.2";
