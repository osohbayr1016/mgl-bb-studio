# Теннисний ордон — бүтцийн систем Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Архитектурын Revit загварт бүхэлдээ ган бүтцийн үндсэн систем — 40м цэл татвартай дээврийн ферм, баганы 8м тор, тусгаар суурь — нэмэх.

**Architecture:** Бүх элементийг `mcp__revit__run_revit_code` (Roslyn C#)-оор идэвхтэй документ ("Project1" / Tennis_Hall_Floor1.rvt) дээр үе шаттай үүсгэнэ. Заал баганагүй 40м цэл (ферм X12→X52), периметр 8м грид багана, өрөө дотор таарсан баганад хана snap.

**Tech Stack:** Revit 2027 API (StructuralType.Column/Beam/Footing), W Shapes/Footing-Rectangular family, MCP revit server.

## TDD адаптаци

Императив модель тул build→verify-query загвар: task бүрийн төгсгөлд FilteredElementCollector count/координат асуулгаар PASS/FAIL шалгана. "Commit" = эцэст нь Doc.Save (Application.Idling workaround). Алдаа → тухайн run rollback, кодоо засаад дахин.

## Global Constraints

- Нэгж: метр оролт → `UnitUtils.ConvertToInternalUnits(m, UnitTypeId.Meters)` (`FT(m)`).
- Грид 8м: x,y ∈ {0,8,16,24,32,40,48,56,64}. Origin (0,0)=SW.
- Заал баганагүй муж: X(12..52) × Y(14..52). Грид дотор хасах цэг: x∈{16,24,32,40,48} ба y∈{16,24,32,40,48}.
- Түвшин: Level 1=0; **Roof-Perimeter=+9.0м**; **Roof-Hall=+12.2м**.
- Багана: бүхэлдээ ган W Shapes. Заалын ферм-тулгуур 0→12.2; периметр 0→9.0.
- Ферм: 5 ширхэг, X12→X52 (40м тулгуургүй), Y=16,24,32,40,48, доод хөвч @12.2, дээд @14.7, 5 панел (зангилаа 12,20,28,36,44,52).
- Суурь: Footing-Rectangular тусгаар; периметр '72" x 48" x 18"', заал '96" x 72" x 18"'.
- Хана→багана snap: өрөө дотор таарсан багана бүрд ойрын interior партишн ханыг баганад зөөх (≤4м). Snap дараа бүх өрөө area>0 байх ёстой.
- Транзакц өөрөө бүү нээ (MCP нээсэн). Загвар нэгэнт байгаа (бүү устга).

## File Structure

- Create: `scripts/revit/s1_setup_types.cs` — type сонголт шалгах
- Create: `scripts/revit/s2_levels.cs` — 2 дээвэр түвшин
- Create: `scripts/revit/s3_hall_columns.cs` — 14 ферм-тулгуур багана
- Create: `scripts/revit/s4_perimeter_columns.cs` — 56 периметр багана
- Create: `scripts/revit/s5_wall_snap.cs` — хана→багана snap
- Create: `scripts/revit/s6_trusses.cs` — 5 дээврийн ферм
- Create: `scripts/revit/s7_roof_beams.cs` — периметр дээврийн дам нуруу
- Create: `scripts/revit/s8_footings.cs` — тусгаар суурь
- Create: `scripts/revit/s9_verify_save.cs` — шалгалт + хадгалах

---

### Task 1: Setup — structural type сонголт шалгах

**Files:** Create: `scripts/revit/s1_setup_types.cs`

**Interfaces:**
- Produces: баталгаажсан type нэрс — багана `W Shapes-Column` ('W14X109','W10X49'), framing `W Shapes` ('W14X30','W8x10','W18X40'), footing `Footing-Rectangular` ('72" x 48" x 18"','96" x 72" x 18"')

- [ ] **Step 1: Type байгаа эсэхийг шалгах**

`scripts/revit/s1_setup_types.cs`:

```csharp
string[] need = {"W14X109","W10X49","W14X30","W8x10","W18X40"};
var cols=new FilteredElementCollector(Doc).OfCategory(BuiltInCategory.OST_StructuralColumns).OfClass(typeof(FamilySymbol)).Cast<FamilySymbol>().ToList();
var frm =new FilteredElementCollector(Doc).OfCategory(BuiltInCategory.OST_StructuralFraming).OfClass(typeof(FamilySymbol)).Cast<FamilySymbol>().ToList();
var fnd =new FilteredElementCollector(Doc).OfCategory(BuiltInCategory.OST_StructuralFoundation).OfClass(typeof(FamilySymbol)).Cast<FamilySymbol>().ToList();
bool c1=cols.Any(s=>s.Name=="W14X109"&&s.FamilyName.Contains("W Shapes"));
bool c2=cols.Any(s=>s.Name=="W10X49"&&s.FamilyName.Contains("W Shapes"));
bool f1=frm.Any(s=>s.Name=="W14X30"), f2=frm.Any(s=>s.Name=="W8x10"), f3=frm.Any(s=>s.Name=="W18X40");
bool ft1=fnd.Any(s=>s.Name=="72\" x 48\" x 18\""&&s.FamilyName.Contains("Footing-Rectangular"));
bool ft2=fnd.Any(s=>s.Name=="96\" x 72\" x 18\""&&s.FamilyName.Contains("Footing-Rectangular"));
Print($"colW14X109={c1} colW10X49={c2} frmW14X30={f1} frmW8x10={f2} frmW18X40={f3} foot72={ft1} foot96={ft2}");
return (c1&&c2&&f1&&f2&&f3&&ft1&&ft2) ? "TYPES-OK" : "TYPES-MISSING (fallback to any W Shapes / Footing-Rectangular in later tasks)";
```

Run via `mcp__revit__run_revit_code`. Expected: `TYPES-OK`. Хэрэв MISSING бол дараагийн task-уудын selection нь fallback (FamilyName.Contains) ашиглана — зогсохгүй.

---

### Task 2: Дээвэр түвшин (+9.0, +12.2)

**Files:** Create: `scripts/revit/s2_levels.cs`

**Interfaces:** Produces: Level 'Roof-Perimeter' @9.0м, 'Roof-Hall' @12.2м

- [ ] **Step 1: Түвшин үүсгэх**

`scripts/revit/s2_levels.cs`:

```csharp
double FT(double m)=>UnitUtils.ConvertToInternalUnits(m,UnitTypeId.Meters);
var lvls=new FilteredElementCollector(Doc).OfClass(typeof(Level)).Cast<Level>().ToList();
Level Ensure(string nm,double m){ var ex=lvls.FirstOrDefault(l=>l.Name==nm); if(ex!=null)return ex; var l=Level.Create(Doc,FT(m)); l.Name=nm; return l; }
var rp=Ensure("Roof-Perimeter",9.0);
var rh=Ensure("Roof-Hall",12.2);
return $"Levels: {rp.Name}@9.0, {rh.Name}@12.2";
```

Expected: `Levels: Roof-Perimeter@9.0, Roof-Hall@12.2`

- [ ] **Step 2: Шалгах**

```csharp
var ns=new FilteredElementCollector(Doc).OfClass(typeof(Level)).Cast<Level>().Select(l=>l.Name).ToList();
return (ns.Contains("Roof-Perimeter")&&ns.Contains("Roof-Hall"))?"PASS levels":"FAIL "+string.Join(",",ns);
```

Expected: `PASS levels`

---

### Task 3: Заалын ферм-тулгуур багана (14)

**Files:** Create: `scripts/revit/s3_hall_columns.cs`

**Interfaces:** Consumes: Level 1, Roof-Hall. Produces: 14 steel columns at X∈{12,52}, Y∈{14,16,24,32,40,48,52}, base 0 top 12.2

- [ ] **Step 1: Багана үүсгэх**

`scripts/revit/s3_hall_columns.cs`:

```csharp
using Autodesk.Revit.DB.Structure;
double FT(double m)=>UnitUtils.ConvertToInternalUnits(m,UnitTypeId.Meters);
var l1=new FilteredElementCollector(Doc).OfClass(typeof(Level)).Cast<Level>().First(l=>l.Name=="Level 1");
var rh=new FilteredElementCollector(Doc).OfClass(typeof(Level)).Cast<Level>().First(l=>l.Name=="Roof-Hall");
var sym=new FilteredElementCollector(Doc).OfCategory(BuiltInCategory.OST_StructuralColumns).OfClass(typeof(FamilySymbol)).Cast<FamilySymbol>()
    .FirstOrDefault(s=>s.Name=="W14X109"&&s.FamilyName.Contains("W Shapes"))
    ?? new FilteredElementCollector(Doc).OfCategory(BuiltInCategory.OST_StructuralColumns).OfClass(typeof(FamilySymbol)).Cast<FamilySymbol>().First(s=>s.FamilyName.Contains("W Shapes"));
if(!sym.IsActive){sym.Activate();Doc.Regenerate();}
double[] hy={14,16,24,32,40,48,52}; int n=0;
foreach(var x in new[]{12.0,52.0}) foreach(var y in hy){
    var c=Doc.Create.NewFamilyInstance(new XYZ(FT(x),FT(y),0), sym, l1, StructuralType.Column);
    c.get_Parameter(BuiltInParameter.FAMILY_BASE_LEVEL_PARAM).Set(l1.Id);
    c.get_Parameter(BuiltInParameter.FAMILY_TOP_LEVEL_PARAM).Set(rh.Id);
    c.get_Parameter(BuiltInParameter.FAMILY_BASE_LEVEL_OFFSET_PARAM).Set(0.0);
    c.get_Parameter(BuiltInParameter.FAMILY_TOP_LEVEL_OFFSET_PARAM).Set(0.0);
    n++;
}
return "Hall columns: "+n;
```

Expected: `Hall columns: 14`

- [ ] **Step 2: Шалгах**

```csharp
int n=new FilteredElementCollector(Doc).OfCategory(BuiltInCategory.OST_StructuralColumns).WhereElementIsNotElementType().GetElementCount();
return n==14?"PASS 14 hall columns":"count="+n;
```

Expected: `PASS 14 hall columns`

---

### Task 4: Периметрийн багана (56)

**Files:** Create: `scripts/revit/s4_perimeter_columns.cs`

**Interfaces:** Consumes: Level 1, Roof-Perimeter. Produces: 56 steel columns on 8m grid (hall interior хасч), base 0 top 9.0

- [ ] **Step 1: Багана үүсгэх**

`scripts/revit/s4_perimeter_columns.cs`:

```csharp
using Autodesk.Revit.DB.Structure;
double FT(double m)=>UnitUtils.ConvertToInternalUnits(m,UnitTypeId.Meters);
var l1=new FilteredElementCollector(Doc).OfClass(typeof(Level)).Cast<Level>().First(l=>l.Name=="Level 1");
var rp=new FilteredElementCollector(Doc).OfClass(typeof(Level)).Cast<Level>().First(l=>l.Name=="Roof-Perimeter");
var sym=new FilteredElementCollector(Doc).OfCategory(BuiltInCategory.OST_StructuralColumns).OfClass(typeof(FamilySymbol)).Cast<FamilySymbol>()
    .FirstOrDefault(s=>s.Name=="W10X49"&&s.FamilyName.Contains("W Shapes"))
    ?? new FilteredElementCollector(Doc).OfCategory(BuiltInCategory.OST_StructuralColumns).OfClass(typeof(FamilySymbol)).Cast<FamilySymbol>().First(s=>s.FamilyName.Contains("W Shapes"));
if(!sym.IsActive){sym.Activate();Doc.Regenerate();}
double[] g={0,8,16,24,32,40,48,56,64}; int n=0;
foreach(var x in g) foreach(var y in g){
    bool hall=(x>12&&x<52&&y>14&&y<52); // grid pts inside hall (x16..48,y16..48)
    if(hall) continue;
    var c=Doc.Create.NewFamilyInstance(new XYZ(FT(x),FT(y),0), sym, l1, StructuralType.Column);
    c.get_Parameter(BuiltInParameter.FAMILY_BASE_LEVEL_PARAM).Set(l1.Id);
    c.get_Parameter(BuiltInParameter.FAMILY_TOP_LEVEL_PARAM).Set(rp.Id);
    c.get_Parameter(BuiltInParameter.FAMILY_BASE_LEVEL_OFFSET_PARAM).Set(0.0);
    c.get_Parameter(BuiltInParameter.FAMILY_TOP_LEVEL_OFFSET_PARAM).Set(0.0);
    n++;
}
return "Perimeter columns: "+n;
```

Expected: `Perimeter columns: 56`

- [ ] **Step 2: Шалгах**

```csharp
int n=new FilteredElementCollector(Doc).OfCategory(BuiltInCategory.OST_StructuralColumns).WhereElementIsNotElementType().GetElementCount();
return n==70?"PASS 70 columns total (14 hall + 56 perimeter)":"count="+n;
```

Expected: `PASS 70 columns total (14 hall + 56 perimeter)`

---

### Task 5: Хана→багана snap (дүрэм b)

**Files:** Create: `scripts/revit/s5_wall_snap.cs`

**Interfaces:** Consumes: perimeter columns, rooms, interior walls. Produces: interior партишн хана баганад зөөгдсөн; бүх өрөө area>0

- [ ] **Step 1: Snap код**

`scripts/revit/s5_wall_snap.cs`:

```csharp
double FT(double m)=>UnitUtils.ConvertToInternalUnits(m,UnitTypeId.Meters);
double M(double ft)=>UnitUtils.ConvertFromInternalUnits(ft,UnitTypeId.Meters);
var l1=new FilteredElementCollector(Doc).OfClass(typeof(Level)).Cast<Level>().First(l=>l.Name=="Level 1");
double zTest=l1.Elevation+FT(1.0);
var rooms=new FilteredElementCollector(Doc).OfCategory(BuiltInCategory.OST_Rooms).WhereElementIsNotElementType().Cast<Autodesk.Revit.DB.Architecture.Room>().Where(r=>r.Area>0).ToList();
var cols=new FilteredElementCollector(Doc).OfCategory(BuiltInCategory.OST_StructuralColumns).WhereElementIsNotElementType().Cast<FamilyInstance>().ToList();
int moved=0, inside=0;
var opt=new SpatialElementBoundaryOptions();
foreach(var col in cols){
    var lp=col.Location as LocationPoint; if(lp==null) continue;
    var p=new XYZ(lp.Point.X, lp.Point.Y, zTest);
    var room=rooms.FirstOrDefault(r=>{ try{return r.IsPointInRoom(p);}catch{return false;} });
    if(room==null) continue; // column on a wall / not in a room -> OK
    inside++;
    // find nearest interior partition wall on room boundary
    Wall best=null; double bestD=1e9; XYZ bestOff=null;
    foreach(var loop in room.GetBoundarySegments(opt)) foreach(var seg in loop){
        var e=Doc.GetElement(seg.ElementId) as Wall; if(e==null) continue;
        if(!e.WallType.Name.StartsWith("Interior")) continue; // only interior partitions
        var ln=(e.Location as LocationCurve)?.Curve as Line; if(ln==null) continue;
        var a=ln.GetEndPoint(0); var b=ln.GetEndPoint(1);
        var dir=(b-a).Normalize();
        double t=(p-a).DotProduct(dir);
        var proj=a+dir*t;                       // foot of perpendicular on infinite line
        var off=new XYZ(p.X-proj.X, p.Y-proj.Y, 0); // vector to move wall onto column
        double d=off.GetLength();
        if(d<bestD && d<FT(4.0)){ bestD=d; best=e; bestOff=off; }
    }
    if(best!=null && bestOff.GetLength()>FT(0.05)){
        try{ ElementTransformUtils.MoveElement(Doc, best.Id, bestOff); moved++; }catch{}
    }
}
Doc.Regenerate();
int unplaced=new FilteredElementCollector(Doc).OfCategory(BuiltInCategory.OST_Rooms).WhereElementIsNotElementType().Cast<Autodesk.Revit.DB.Architecture.Room>().Count(r=>r.Area<=0);
Print($"columnsInsideRooms={inside} wallsMoved={moved} unplacedAfter={unplaced}");
return unplaced==0 ? "SNAP-OK (all rooms still enclosed)" : "SNAP-WARN unplaced="+unplaced;
```

Expected: `SNAP-OK (all rooms still enclosed)` (хэрэв SNAP-WARN бол зөөгдсөн хана өрөө задалсан — тухайн ханыг буцааж залруулах эсвэл алгасах; controller-т мэдэгдэнэ).

- [ ] **Step 2: Шалгах**

```csharp
int unplaced=new FilteredElementCollector(Doc).OfCategory(BuiltInCategory.OST_Rooms).WhereElementIsNotElementType().Cast<Autodesk.Revit.DB.Architecture.Room>().Count(r=>r.Area<=0);
return unplaced==0?"PASS no unplaced rooms":"FAIL unplaced="+unplaced;
```

Expected: `PASS no unplaced rooms`

---

### Task 6: Дээврийн ферм (5)

**Files:** Create: `scripts/revit/s6_trusses.cs`

**Interfaces:** Consumes: Roof-Hall, framing types. Produces: 5 Warren ферм (тус бүр 21 framing member), X12→52, Y=16,24,32,40,48

- [ ] **Step 1: Ферм үүсгэх**

`scripts/revit/s6_trusses.cs`:

```csharp
using Autodesk.Revit.DB.Structure;
double FT(double m)=>UnitUtils.ConvertToInternalUnits(m,UnitTypeId.Meters);
var rh=new FilteredElementCollector(Doc).OfClass(typeof(Level)).Cast<Level>().First(l=>l.Name=="Roof-Hall");
FamilySymbol Fr(string nm)=>new FilteredElementCollector(Doc).OfCategory(BuiltInCategory.OST_StructuralFraming).OfClass(typeof(FamilySymbol)).Cast<FamilySymbol>()
    .FirstOrDefault(s=>s.Name==nm) ?? new FilteredElementCollector(Doc).OfCategory(BuiltInCategory.OST_StructuralFraming).OfClass(typeof(FamilySymbol)).Cast<FamilySymbol>().First(s=>s.FamilyName.Contains("W Shapes"));
var chord=Fr("W14X30"); var web=Fr("W8x10");
if(!chord.IsActive){chord.Activate();} if(!web.IsActive){web.Activate();} Doc.Regenerate();
int n=0;
void Bm(double x1,double y1,double z1,double x2,double y2,double z2,FamilySymbol s){
    var c=Line.CreateBound(new XYZ(FT(x1),FT(y1),FT(z1)),new XYZ(FT(x2),FT(y2),FT(z2)));
    Doc.Create.NewFamilyInstance(c, s, rh, StructuralType.Beam); n++;
}
double zB=12.2, zT=14.7; double[] nd={12,20,28,36,44,52};
foreach(var yt in new[]{16.0,24,32,40,48}){
    for(int i=0;i<5;i++){ Bm(nd[i],yt,zB,nd[i+1],yt,zB,chord); Bm(nd[i],yt,zT,nd[i+1],yt,zT,chord); } // chords
    for(int i=0;i<6;i++) Bm(nd[i],yt,zB,nd[i],yt,zT,web);     // verticals
    for(int i=0;i<5;i++) Bm(nd[i],yt,zB,nd[i+1],yt,zT,web);   // diagonals
}
return "Truss members: "+n;
```

Expected: `Truss members: 105` (5 ферм × 21)

- [ ] **Step 2: Шалгах**

```csharp
int n=new FilteredElementCollector(Doc).OfCategory(BuiltInCategory.OST_StructuralFraming).WhereElementIsNotElementType().GetElementCount();
return n>=105?"PASS truss framing ("+n+")":"count="+n;
```

Expected: `PASS truss framing (105)`

---

### Task 7: Периметрийн дээврийн дам нуруу (+9.0)

**Files:** Create: `scripts/revit/s7_roof_beams.cs`

**Interfaces:** Consumes: Roof-Perimeter, framing W18X40. Produces: дам нуруу зэргэлдээ багана хооронд (≤8.01м, X/Y ижил), z=+9.0; заал дээгүүр дам нуруугүй

- [ ] **Step 1: Дам нуруу үүсгэх**

`scripts/revit/s7_roof_beams.cs`:

```csharp
using Autodesk.Revit.DB.Structure;
double FT(double m)=>UnitUtils.ConvertToInternalUnits(m,UnitTypeId.Meters);
var rp=new FilteredElementCollector(Doc).OfClass(typeof(Level)).Cast<Level>().First(l=>l.Name=="Roof-Perimeter");
var sym=new FilteredElementCollector(Doc).OfCategory(BuiltInCategory.OST_StructuralFraming).OfClass(typeof(FamilySymbol)).Cast<FamilySymbol>()
    .FirstOrDefault(s=>s.Name=="W18X40") ?? new FilteredElementCollector(Doc).OfCategory(BuiltInCategory.OST_StructuralFraming).OfClass(typeof(FamilySymbol)).Cast<FamilySymbol>().First(s=>s.FamilyName.Contains("W Shapes"));
if(!sym.IsActive){sym.Activate();Doc.Regenerate();}
// beam nodes = perimeter grid columns (z9) + hall-edge columns (x12/52)
var nodes=new List<(double x,double y)>();
double[] g={0,8,16,24,32,40,48,56,64};
foreach(var x in g) foreach(var y in g){ if(x>12&&x<52&&y>14&&y<52) continue; nodes.Add((x,y)); }
foreach(var x in new[]{12.0,52.0}) foreach(var y in new[]{14.0,16,24,32,40,48,52}) nodes.Add((x,y));
double z=9.0; int n=0; var seen=new HashSet<string>();
for(int i=0;i<nodes.Count;i++) for(int j=i+1;j<nodes.Count;j++){
    var a=nodes[i]; var b=nodes[j];
    bool sameX=Math.Abs(a.x-b.x)<0.01, sameY=Math.Abs(a.y-b.y)<0.01;
    if(!(sameX||sameY)) continue;
    double d=Math.Abs(sameX?(a.y-b.y):(a.x-b.x));
    if(d<0.01 || d>8.01) continue; // only adjacent (<=8m)
    string key=$"{Math.Min(a.x,b.x):F1},{Math.Min(a.y,b.y):F1},{Math.Max(a.x,b.x):F1},{Math.Max(a.y,b.y):F1}";
    if(!seen.Add(key)) continue;
    var c=Line.CreateBound(new XYZ(FT(a.x),FT(a.y),FT(z)),new XYZ(FT(b.x),FT(b.y),FT(z)));
    Doc.Create.NewFamilyInstance(c, sym, rp, StructuralType.Beam); n++;
}
return "Perimeter roof beams: "+n;
```

Expected: `Perimeter roof beams:` (~120–140 дам нуруу; яг тоо адъяценс-аас хамаарна; >0 байх ёстой)

- [ ] **Step 2: Шалгах**

```csharp
int n=new FilteredElementCollector(Doc).OfCategory(BuiltInCategory.OST_StructuralFraming).WhereElementIsNotElementType().GetElementCount();
return n>105?"PASS framing incl beams ("+n+")":"FAIL no beams added n="+n;
```

Expected: `PASS framing incl beams (...)` (105 ферм + дам нуруу)

---

### Task 8: Тусгаар суурь (70)

**Files:** Create: `scripts/revit/s8_footings.cs`

**Interfaces:** Consumes: Level 1, Footing-Rectangular. Produces: багана бүрийн доор суурь — заал 96"x72", периметр 72"x48"

- [ ] **Step 1: Суурь үүсгэх**

`scripts/revit/s8_footings.cs`:

```csharp
using Autodesk.Revit.DB.Structure;
double FT(double m)=>UnitUtils.ConvertToInternalUnits(m,UnitTypeId.Meters);
var l1=new FilteredElementCollector(Doc).OfClass(typeof(Level)).Cast<Level>().First(l=>l.Name=="Level 1");
FamilySymbol Foot(string nm)=>new FilteredElementCollector(Doc).OfCategory(BuiltInCategory.OST_StructuralFoundation).OfClass(typeof(FamilySymbol)).Cast<FamilySymbol>()
    .FirstOrDefault(s=>s.Name==nm&&s.FamilyName.Contains("Footing-Rectangular"))
    ?? new FilteredElementCollector(Doc).OfCategory(BuiltInCategory.OST_StructuralFoundation).OfClass(typeof(FamilySymbol)).Cast<FamilySymbol>().First(s=>s.FamilyName.Contains("Footing-Rectangular"));
var fSmall=Foot("72\" x 48\" x 18\""); var fBig=Foot("96\" x 72\" x 18\"");
if(!fSmall.IsActive){fSmall.Activate();} if(!fBig.IsActive){fBig.Activate();} Doc.Regenerate();
int n=0;
foreach(var col in new FilteredElementCollector(Doc).OfCategory(BuiltInCategory.OST_StructuralColumns).WhereElementIsNotElementType().Cast<FamilyInstance>().ToList()){
    var lp=col.Location as LocationPoint; if(lp==null) continue;
    double x=lp.Point.X, y=lp.Point.Y;
    bool hall = (Math.Abs(UnitUtils.ConvertFromInternalUnits(x,UnitTypeId.Meters)-12)<0.5 || Math.Abs(UnitUtils.ConvertFromInternalUnits(x,UnitTypeId.Meters)-52)<0.5);
    var sym = hall ? fBig : fSmall;
    var f=Doc.Create.NewFamilyInstance(new XYZ(x,y,l1.Elevation), sym, l1, StructuralType.Footing); n++;
}
return "Footings: "+n;
```

Expected: `Footings: 70`

- [ ] **Step 2: Шалгах**

```csharp
int n=new FilteredElementCollector(Doc).OfCategory(BuiltInCategory.OST_StructuralFoundation).WhereElementIsNotElementType().GetElementCount();
return n>=70?"PASS footings ("+n+")":"count="+n;
```

Expected: `PASS footings (70+)` (өмнө байсан 2 + 70)

---

### Task 9: Эцсийн шалгалт + хадгалах

**Files:** Create: `scripts/revit/s9_verify_save.cs`

- [ ] **Step 1: Бүтэц шалгах — заал баганагүй эсэх**

`scripts/revit/s9_verify_save.cs` (part A):

```csharp
double M(double ft)=>UnitUtils.ConvertFromInternalUnits(ft,UnitTypeId.Meters);
int cols=new FilteredElementCollector(Doc).OfCategory(BuiltInCategory.OST_StructuralColumns).WhereElementIsNotElementType().GetElementCount();
int frm=new FilteredElementCollector(Doc).OfCategory(BuiltInCategory.OST_StructuralFraming).WhereElementIsNotElementType().GetElementCount();
int fnd=new FilteredElementCollector(Doc).OfCategory(BuiltInCategory.OST_StructuralFoundation).WhereElementIsNotElementType().GetElementCount();
// no columns strictly inside court area X[16,48] Y[16,48]
int inHall=0;
foreach(var c in new FilteredElementCollector(Doc).OfCategory(BuiltInCategory.OST_StructuralColumns).WhereElementIsNotElementType().Cast<FamilyInstance>()){
    var lp=c.Location as LocationPoint; if(lp==null)continue; double x=M(lp.Point.X),y=M(lp.Point.Y);
    if(x>15.9&&x<48.1&&y>15.9&&y<48.1) inHall++;
}
Print($"columns={cols} framing={frm} foundations={fnd} columnsInCourtArea={inHall}");
return inHall==0 ? "STRUCT-OK court column-free" : "FAIL columns in court="+inHall;
```

Expected: `STRUCT-OK court column-free`

- [ ] **Step 2: Хадгалах (Idling workaround)**

`scripts/revit/s9_verify_save.cs` (part B):

```csharp
var app=UiApp; var doc=Doc;
EventHandler<Autodesk.Revit.UI.Events.IdlingEventArgs> h=null;
h=(s,e)=>{ app.Idling-=h; try{ doc.Save(); }catch{} }; app.Idling+=h;
return "Save scheduled on Idling";
```

Expected: `Save scheduled on Idling` (диск дээрх файл шинэчлэгдэнэ)

---

## Self-Review

**1. Spec coverage:**
- §4 түвшин → Task 2 ✓
- §6.1 заал багана → Task 3 ✓; §6.2 периметр багана → Task 4 ✓; §6.3 snap → Task 5 ✓
- §7 ферм → Task 6 ✓
- §8 периметр дам нуруу → Task 7 ✓
- §9 суурь → Task 8 ✓
- §12 success (заал баганагүй, хадгалах) → Task 9 ✓

**2. Placeholder scan:** TBD/TODO алга. Task 7 дам нурууны яг тоо адъяценс-аас (тооцоолох боломжтой ч >0 шалгуур хангалттай). Snap (Task 5) нь үр дүн model-state-аас хамаарах тул unplaced==0 шалгуураар баталгаажна.

**3. Type consistency:** `FT(m)` helper бүх script-д давтан (script тус тусдаа). Type сонголт (W14X109/W10X49/W14X30/W8x10/W18X40/Footing 72"/96") бүх task-д ижил fallback логиктой. Level нэр ("Level 1","Roof-Perimeter","Roof-Hall") тууштай.

**Эрсдэл:** Task 5 (хана snap) хамгийн тодорхойгүй — Revit-ийн хана зөөлт зэргэлдээ өрөөнд нөлөөлдөг. unplaced==0 шалгуураар хамгаална; асуудал гарвал тухайн ханыг алгасаж controller-т мэдэгдэнэ.
