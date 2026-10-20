# Теннисний ордон floor plan — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Revit-д ~64×64м дөрвөлжин теннисний ордны 1-р давхрын план — 2 теннисний талбай, нийт 150 суудалтай 2 арц, 77 өрөөтэйгөөр загварчлах.

**Architecture:** Бүх элементийг `mcp__revit__run_revit_code` (Roslyn C#)-оор идэвхтэй Revit document дээр үе шаттай үүсгэнэ. Геометр нь параметрик: грид → гадна хана → бүсийн хана → ribbon-packing-ээр өрөө → талбайн зураас → арц → хаалга → шошго. Хэмжээ метрээр оруулж feet рүү хөрвүүлнэ.

**Tech Stack:** Revit 2027 API, Roslyn C# script (run_revit_code), MCP revit server (port 5005).

## TDD адаптаци (унших!)

Энэ нь императив модель бүтээх ажил тул классик red-green TDD биш. Үүний оронд **build → verify-query** загвар ашиглана:
- Бүр task-ийн төгсгөлд **шалгах асуулга** (FilteredElementCollector count / координат)-ыг `run_revit_code`-оор ажиллуулж, `Print`-ээр PASS/FAIL гаргана.
- Алдаа гарвал тухайн transaction автоматаар rollback болно (MCP-ийн дүрэм) — кодоо засаад дахин ажиллуулна.
- "Commit" = Revit-д тус бүр run нь нэг undoable transaction. Эцэст нь Doc-ийг SaveAs хийж хадгална (Task 9).

## Global Constraints

- Нэгж: метр оролт → `UnitUtils.ConvertToInternalUnits(m, UnitTypeId.Meters)` (доор `FT(m)` helper).
- Барилга: 64м × 64м дөрвөлжин, origin (0,0) = SW булан, X→зүүн, Y→хойд.
- Грид алхам: 8м (X1–X9, Y1–Y9 at 0,8,…,64).
- Бүсийн гүн: 12м. Төв заал X[12,52] × Y[12,52] = 40×40.
- Хана өндөр: 9м. Level: "Level 1".
- Талбай: тоглоомын зураас 23.77м × 10.97м; нийт талбай (runoff-той) 32м(X дотор 16/талбай) × 36м(Y).
- Арц: 2 ширхэг × 75 = нийт 150 суудал, заалын зүүн/баруун (X[12,16], X[48,52]) талд.
- Бүх 77 өрөө (100–176) нэр/дугаартай. Илүүдсэн арц (158,160,165,170,172) → агуулах/коридор.
- Транзакц өөрөө бүү нээ (MCP нэгэнт нээсэн). Шинэ document дотор л ажиллана.

## File Structure

run_revit_code код inline ажилладаг ч **дахин ажиллуулах / баримтжуулах** үүднээс script бүрийг диск дээр хадгална:

- Create: `scripts/revit/01_setup_gate.cs` — идэвхтэй document шалгах gate
- Create: `scripts/revit/02_grids.cs` — 18 grid line
- Create: `scripts/revit/03_exterior_shell.cs` — 64×64 периметр хана
- Create: `scripts/revit/04_zone_walls.cs` — 4 бүсийн хана (5 муж)
- Create: `scripts/revit/05_room_packer.cs` — ribbon-packing генератор + 4 бүсийн өрөө
- Create: `scripts/revit/06_central_rooms.cs` — төв заалын room separation + 2 талбай + тусгах + 2 арц муж
- Create: `scripts/revit/07_court_lines.cs` — 2 талбайн зураас (model line)
- Create: `scripts/revit/08_stands.cs` — 2 арцны платформ + суудлын марк
- Create: `scripts/revit/09_doors_tags_save.cs` — гол хаалга + room tag + SaveAs
- Create: `scripts/revit/_shared.md` — нийтлэг helper код (FT, MakeWall, координат) лавлагаа

---

### Task 1: Setup gate — зөв document идэвхтэй эсэхийг баталгаажуулах

**Files:**
- Create: `scripts/revit/01_setup_gate.cs`

**Interfaces:**
- Consumes: идэвхтэй Revit Doc
- Produces: баталгаажсан хоосон metric project (Snowdon Towers БИШ, Walls==0, "Level 1" байгаа)

- [ ] **Step 1: Хэрэглэгчид заавар өгөх**

Хэрэглэгчээс Revit дотор **File ▸ New ▸ Project ▸ (metric template, ж: "Architectural Template")** үүсгэж идэвхтэй болгохыг хүс. Учир: run_revit_code идэвхтэй Doc дээр нэгэнт нээгдсэн transaction дотор ажилладаг тул шинэ document-ийг API-аар үүсгэвэл transaction зөрчилдөнө. Идэвхтэй Doc нь шинэ хоосон project байх ёстой.

- [ ] **Step 2: Gate асуулга бичих/ажиллуулах**

`scripts/revit/01_setup_gate.cs`:

```csharp
var title = Doc.Title;
int walls = new FilteredElementCollector(Doc).OfClass(typeof(Wall)).GetElementCount();
var levels = new FilteredElementCollector(Doc).OfClass(typeof(Level)).Cast<Level>().ToList();
bool hasL1 = levels.Any(l => l.Name == "Level 1");
bool isSnowdon = title.IndexOf("Snowdon", StringComparison.OrdinalIgnoreCase) >= 0;
Print($"Title='{title}'  Walls={walls}  Levels={levels.Count}  hasLevel1={hasL1}");
foreach (var l in levels) Print($"  Level '{l.Name}' @ {UnitUtils.ConvertFromInternalUnits(l.Elevation, UnitTypeId.Meters):F2} m");
if (isSnowdon || walls > 0) return "GATE-FAIL: идэвхтэй document зөв биш (Snowdon эсвэл хоосон биш). Шинэ metric project нээнэ үү.";
return hasL1 ? "GATE-PASS" : "GATE-WARN: 'Level 1' алга — Task 1.5-д үүсгэнэ";
```

Run: `mcp__revit__run_revit_code` (дээрх код)
Expected: `GATE-PASS` буцаана. Хэрэв `GATE-FAIL` бол зогсож, хэрэглэгчид шинэ project нээхийг сануул. Хэрэв `GATE-WARN` бол:

- [ ] **Step 3: (Шаардвал) Level 1 баталгаажуулах**

```csharp
var lvls = new FilteredElementCollector(Doc).OfClass(typeof(Level)).Cast<Level>().ToList();
var l1 = lvls.FirstOrDefault(l => l.Name == "Level 1");
if (l1 == null) { l1 = Level.Create(Doc, 0.0); l1.Name = "Level 1"; }
return "Level 1 id=" + l1.Id;
```

Expected: `Level 1 id=...`

---

### Task 2: Грид (X1–X9, Y1–Y9)

**Files:**
- Create: `scripts/revit/02_grids.cs`

**Interfaces:**
- Consumes: идэвхтэй хоосон project
- Produces: 18 Grid (нэр "X1".."X9", "Y1".."Y9"), X/Y = 0,8,…,64 м

- [ ] **Step 1: Grid үүсгэх код бичих/ажиллуулах**

`scripts/revit/02_grids.cs`:

```csharp
double FT(double m) => UnitUtils.ConvertToInternalUnits(m, UnitTypeId.Meters);
double over = 4.0; // grid line барилгаас цааш сунгах (м)
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
```

Expected: `Grids created: 18`

- [ ] **Step 2: Шалгах асуулга**

```csharp
var gs = new FilteredElementCollector(Doc).OfClass(typeof(Grid)).Cast<Grid>().Select(g=>g.Name).OrderBy(n=>n).ToList();
Print(string.Join(",", gs));
return gs.Count == 18 ? "PASS 18 grids" : "FAIL count=" + gs.Count;
```

Expected: `PASS 18 grids`

---

### Task 3: Гадна периметр хана (64×64)

**Files:**
- Create: `scripts/revit/03_exterior_shell.cs`

**Interfaces:**
- Consumes: Level 1
- Produces: 4 гадна хана (хаалттай дөрвөлжин), `EXT_WT` wall type id (later tasks ижил type ашиглана)

- [ ] **Step 1: Wall type сонгох + 4 хана үүсгэх**

`scripts/revit/03_exterior_shell.cs`:

```csharp
double FT(double m) => UnitUtils.ConvertToInternalUnits(m, UnitTypeId.Meters);
double H = 9.0;
var l1 = new FilteredElementCollector(Doc).OfClass(typeof(Level)).Cast<Level>().First(l=>l.Name=="Level 1");
var basics = new FilteredElementCollector(Doc).OfClass(typeof(WallType)).Cast<WallType>()
    .Where(w=>w.Kind==WallKind.Basic).ToList();
var ext = basics.FirstOrDefault(w=>w.Name=="Exterior - Brick on Mtl. Stud")
        ?? basics.First(w=>w.Name.StartsWith("Exterior") && !w.Name.Contains("Foundation"));

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
```

Expected: `Exterior walls: <4 id>` + ашигласан type нэр.

- [ ] **Step 2: Шалгах асуулга**

```csharp
int n = new FilteredElementCollector(Doc).OfClass(typeof(Wall)).GetElementCount();
return n == 4 ? "PASS 4 exterior walls" : "FAIL walls=" + n;
```

Expected: `PASS 4 exterior walls`

---

### Task 4: Бүсийн хана (5 муж)

**Files:**
- Create: `scripts/revit/04_zone_walls.cs`

**Interfaces:**
- Consumes: Level 1, гадна хана
- Produces: 4 бүсийн хана → S band Y[0,12], N band Y[52,64] (бүтэн өргөн), W band X[0,12] & E band X[52,64] (Y[12,52]), төв заал X[12,52]×Y[12,52]

- [ ] **Step 1: 4 бүсийн хана үүсгэх**

`scripts/revit/04_zone_walls.cs`:

```csharp
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
```

Expected: `Zone walls: 4 created`

- [ ] **Step 2: Шалгах асуулга**

```csharp
int n = new FilteredElementCollector(Doc).OfClass(typeof(Wall)).GetElementCount();
return n == 8 ? "PASS 8 walls (4 ext + 4 zone)" : "FAIL walls=" + n;
```

Expected: `PASS 8 walls (4 ext + 4 zone)`

---

### Task 5: Ribbon-packing генератор + 4 бүсийн өрөө

**Files:**
- Create: `scripts/revit/05_room_packer.cs`

**Interfaces:**
- Consumes: Level 1, бүсийн хана
- Produces: 4 бүсэд нийт **68 өрөө** (S:5, N:12, W:24, E:27) — Room + Number + Name; партишн хана perpendicular

- [ ] **Step 1: Генератор + бүсийн өгөгдөл бичих/ажиллуулах**

`scripts/revit/05_room_packer.cs`:

```csharp
double FT(double m) => UnitUtils.ConvertToInternalUnits(m, UnitTypeId.Meters);
double H = 9.0;
var l1 = new FilteredElementCollector(Doc).OfClass(typeof(Level)).Cast<Level>().First(l=>l.Name=="Level 1");
var basics = new FilteredElementCollector(Doc).OfClass(typeof(WallType)).Cast<WallType>()
    .Where(w=>w.Kind==WallKind.Basic).ToList();
var inter = basics.FirstOrDefault(w=>w.Name=="Interior - 4 7/8\" Partition (1-hr)")
          ?? basics.First(w=>w.Name.StartsWith("Interior"));

void Partition(double x1,double y1,double x2,double y2){
    var ln = Line.CreateBound(new XYZ(FT(x1),FT(y1),0), new XYZ(FT(x2),FT(y2),0));
    Wall.Create(Doc, ln, inter.Id, l1.Id, FT(H), 0.0, false, false);
}
int placed = 0;
void Pack(double bx0,double by0,double bx1,double by1, char axis, int rows,
          List<(string num,string name,double w)> rooms){
    var sub = new List<(string,string,double)>[rows];
    for(int i=0;i<rows;i++) sub[i]=new List<(string,string,double)>();
    for(int i=0;i<rooms.Count;i++) sub[i%rows].Add(rooms[i]);
    for(int r=0; r<rows; r++){
        double dStart, dEnd; // depth band for this row
        if(axis=='X'){ double d=(by1-by0)/rows; dStart=by0+r*d; dEnd=dStart+d; }
        else         { double d=(bx1-bx0)/rows; dStart=bx0+r*d; dEnd=dStart+d; }
        // row divider wall (between rows)
        if(rows>1 && r>0){
            if(axis=='X') Partition(bx0,dStart,bx1,dStart);
            else          Partition(dStart,by0,dStart,by1);
        }
        double len   = (axis=='X') ? (bx1-bx0) : (by1-by0);
        double start = (axis=='X') ? bx0 : by0;
        double tot = sub[r].Sum(t=>t.Item3);
        double cur = start;
        for(int k=0;k<sub[r].Count;k++){
            var rm = sub[r][k];
            double seg = len * rm.Item3/tot;
            double a=cur, b=cur+seg;
            double X0,Y0,X1,Y1;
            if(axis=='X'){ X0=a;X1=b;Y0=dStart;Y1=dEnd; } else { Y0=a;Y1=b;X0=dStart;X1=dEnd; }
            // partition at the END boundary (skip last - that edge is exterior/zone)
            if(k < sub[r].Count-1){
                if(axis=='X') Partition(b,dStart, b,dEnd);
                else          Partition(dStart,b, dEnd,b);
            }
            var room = Doc.Create.NewRoom(l1, new UV(FT((X0+X1)/2), FT((Y0+Y1)/2)));
            if(room!=null){ room.Number = rm.Item1; room.Name = rm.Item2; placed++; }
            cur=b;
        }
    }
}

// SOUTH band (Y[0,12], full width, axis X, 1 row) — public
Pack(0,0,64,12,'X',1, new List<(string,string,double)>{
    ("105","Шатны хонгил-1",30.86),("104","Спорт хэрэгслийн худалдааны хэсэг",43.89),
    ("101","Лоби",327.86),("102","Тасалбар түгээх цэг",62.12),("103","Тасалбарын касс",11.71)
});
// NORTH band (Y[52,64], full width, axis X, 2 rows) — café/kitchen
Pack(0,52,64,64,'X',2, new List<(string,string,double)>{
    ("112","Хоолны хэсэг",156.90),("113","Гал тогоо",31.42),("114","Угаалгын хэсэг",6.13),
    ("115","Ногоо бэлтгэх хэсэг",5.71),("116","Мах бэлтгэх хэсэг",5.50),("117","Хүйтэн агуулах-1",2.37),
    ("118","Хүйтэн агуулах-2",2.75),("119","Гал тогоо /Орц/",7.55),("120","Ажилчдын хувцас солих /гал тогоо/",3.83),
    ("121","Угаалгын хэсэг /гал тогоо/",2.89),("122","АЦБ /гал тогоо/",1.82),("123","Шүршүүр /гал тогоо/",2.07)
});
// WEST band (X[0,12], Y[12,52], axis Y, 2 rows) — locker/АЦВ
Pack(0,12,12,52,'Y',2, new List<(string,string,double)>{
    ("106","Хувцасны хэсэг-1",14.02),("107","Хувцасны хэсэг-2",16.99),("108","Хувцасны хэсэг-3",12.72),
    ("109","Агуулах-1",4.80),("110","Агуулах-2",4.09),("111","Агуулах-3",3.40),
    ("140","Ажилчин хувцас солих /эм/",3.62),("141","Ажилчин хувцас солих /эр/",3.63),("142","Коридор-W",8.08),
    ("143","АЦВ /эмэгтэй/",13.05),("144","АЦВ /эрэгтэй/",12.00),("145","АЦВ /тусгай хэрэгцээт/",4.00),
    ("146","Үйлчлэгчийн өрөө",2.43),("147","Шатны хонгил-3",22.90),("155","Хувцасны өлгүүр-1",21.49),
    ("156","АЦВ /эмэгтэй/-2",21.18),("162","АЦВ /эрэгтэй/-2",21.78),("163","Хувцасны өлгүүр-2",21.13),
    ("167","Хувцасны өлгүүр-3",21.29),("168","АЦВ /эмэгтэй/-3",21.09),("173","АЦВ /эрэгтэй/-3",21.79),
    ("174","Хувцасны өлгүүр-4",21.40),("175","Цэвэрлэгээний машины өрөө-1",15.89),
    ("176","Цэвэрлэгээний машины өрөө-2",16.36)
});
// EAST band (X[52,64], Y[12,52], axis Y, 2 rows) — technical/medical/storage
Pack(52,12,64,52,'Y',2, new List<(string,string,double)>{
    ("124","Эмчийн өрөө",9.20),("125","Дотик шинжилгээний өрөө",8.00),("126","АЦВ-E",3.71),
    ("127","Шүгүүлийн өрөө",18.78),("128","Гонх /Техникийн өрөө/",3.00),("129","Техникийн өрөө /ЦАХ/",11.19),
    ("130","Техникийн өрөө /ХД/",4.05),("131","Техникийн өрөө /ХАС,ЦБУ/",58.34),("133","Шатны хонгил-2",14.53),
    ("134","Холбоо/коммуникацийн өрөө",9.09),("135","АЦБ /хяналтын өрөө/",2.26),("136","Гонх",2.63),
    ("137","Коридор-E1",4.26),("138","Амралтын өрөө",13.17),("139","Коридор-E2",2.08),
    ("150","Сүүдлэн агуулах хэсэг-1",26.95),("151","Сүүдлэн агуулах хэсэг-2",42.33),("152","Сүүдлэн агуулах хэсэг-3",27.04),
    ("153","Сүүдлэн агуулах хэсэг-4",41.10),("154","Коридор-E3",35.49),("157","Агуулах-4",4.89),
    ("159","Коридор-E4",34.63),("161","Агуулах-5",16.00),("164","Агуулах-6",16.22),
    ("166","Коридор-E5",36.24),("169","Агуулах-7",4.89),("171","Коридор-E6",35.15)
});

return "Rooms placed in bands: " + placed;
```

Expected: `Rooms placed in bands: 68`

- [ ] **Step 2: Шалгах асуулга**

```csharp
var rooms = new FilteredElementCollector(Doc).OfCategory(BuiltInCategory.OST_Rooms)
    .WhereElementIsNotElementType().Cast<Autodesk.Revit.DB.Architecture.Room>().ToList();
int unplaced = rooms.Count(r=>r.Area<=0);
Print($"Rooms total={rooms.Count}  unplaced(area<=0)={unplaced}");
return rooms.Count==68 && unplaced==0 ? "PASS 68 bounded rooms" : "CHECK counts above";
```

Expected: `PASS 68 bounded rooms` (хэрэв unplaced>0 бол тухайн муж хаалттай биш — Task 4 хана дутуу. Засаад дахин ажиллуул.)

---

### Task 6: Төв заалын room separation + 5 муж (2 талбай, тусгах, 2 арц)

**Files:**
- Create: `scripts/revit/06_central_rooms.cs`

**Interfaces:**
- Consumes: Level 1, төв заал (зөвхөн зон хана бүхий нэг хаалттай муж)
- Produces: room separation lines + 5 Room → 149a/149b талбай, 148 Тусгах өрөө, 100/132 Арц муж

Төв заал X[12,52]×Y[12,52]. Хуваарь: W арц X[12,16]; Талбай-1 X[16,32]; Талбай-2 X[32,48]; E арц X[48,52]. Y хувьд: тусгах өрөө дээд зурвас Y[50,52], талбай/арц Y[12,50].

- [ ] **Step 1: Sketch plane + separation lines + rooms**

`scripts/revit/06_central_rooms.cs`:

```csharp
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
// vertical separators inside central
Sep(16,12,16,50); // W stand | court1 (зөвхөн Y[12,50] — тусгах зурвас руу нэвтрэхгүй)
Sep(32,12,32,50); // court1 | court2
Sep(48,12,48,50); // court2 | E stand
// horizontal separator for тусгах strip (top) — бүтэн өргөн, нэг өрөө
Sep(12,50,52,50); // central | тусгах strip

Autodesk.Revit.DB.Architecture.Room R(double cx,double cy,string num,string name){
    var rm = Doc.Create.NewRoom(l1, new UV(FT(cx),FT(cy)));
    rm.Number=num; rm.Name=name; return rm;
}
R(14, 31, "100", "Арц-1 (75 суудал)");      // W stand X[12,16] Y[12,50]
R(24, 31, "149a","Теннисний талбай-1");      // X[16,32] Y[12,50]
R(40, 31, "149b","Теннисний талбай-2");      // X[32,48] Y[12,50]
R(50, 31, "132", "Арц-2 (75 суудал)");       // E stand X[48,52] Y[12,50]
R(32, 51, "148", "Тусгах өрөө");             // strip Y[50,52]

return "Central rooms placed (expect 5)";
```

Expected: `Central rooms placed (expect 5)`

- [ ] **Step 2: Шалгах асуулга**

```csharp
var rooms = new FilteredElementCollector(Doc).OfCategory(BuiltInCategory.OST_Rooms)
    .WhereElementIsNotElementType().Cast<Autodesk.Revit.DB.Architecture.Room>().ToList();
int unplaced = rooms.Count(r=>r.Area<=0);
var nums = rooms.Select(r=>r.Number).OrderBy(n=>n).ToList();
bool has = new[]{"100","132","148","149a","149b"}.All(n=>nums.Contains(n));
Print($"total={rooms.Count} unplaced={unplaced} hasCentral={has}");
return rooms.Count==73 && unplaced==0 && has ? "PASS 73 rooms total" : "CHECK above";
```

Expected: `PASS 73 rooms total` (68 + 5). Лавлагааны 77 дугаараас 5 арц (158,160,165,170,172) нь "up to 150 суудал" дүрмийн дагуу 2 арц болж нэгтгэгдсэн; үлдсэн 72 дугаар placed (149 нь 149a/149b болж хуваагдсан тул нийт 73 room).

---

### Task 7: 2 теннисний талбайн зураас (model line)

**Files:**
- Create: `scripts/revit/07_court_lines.cs`

**Interfaces:**
- Consumes: Level 1, талбай мужууд (149a center X24, 149b center X32-48 → center X40)
- Produces: тус талбайд тоглоомын зураас (perimeter 23.77×10.97 + net line) model curve-ээр

Талбай-1 төв (24,31), Талбай-2 төв (40,31). Зураасыг талбайн төвд төвлүүлж байрлуулна: урт 23.77 (Y дагуу), өргөн 10.97 (X дагуу).

- [ ] **Step 1: Зураас үүсгэх**

`scripts/revit/07_court_lines.cs`:

```csharp
double FT(double m) => UnitUtils.ConvertToInternalUnits(m, UnitTypeId.Meters);
var l1 = new FilteredElementCollector(Doc).OfClass(typeof(Level)).Cast<Level>().First(l=>l.Name=="Level 1");
var sp = SketchPlane.Create(Doc, Plane.CreateByNormalAndOrigin(XYZ.BasisZ, new XYZ(0,0,FT(0))));
double CL = 23.77, CW = 10.97;
int n=0;
void Seg(double x1,double y1,double x2,double y2){
    var mc = Doc.Create.NewModelCurve(
        Line.CreateBound(new XYZ(FT(x1),FT(y1),0), new XYZ(FT(x2),FT(y2),0)), sp);
    n++;
}
void Court(double cx,double cy){
    double x0=cx-CW/2, x1=cx+CW/2, y0=cy-CL/2, y1=cy+CL/2;
    Seg(x0,y0,x1,y0); Seg(x1,y0,x1,y1); Seg(x1,y1,x0,y1); Seg(x0,y1,x0,y0); // perimeter
    Seg(x0,cy,x1,cy); // net line (center)
    Seg(x0,cy-6.4,x1,cy-6.4); Seg(x0,cy+6.4,x1,cy+6.4); // service lines (~6.4m from net)
}
Court(24,31); // Талбай-1
Court(40,31); // Талбай-2
return "Court line segments: " + n;
```

Expected: `Court line segments: 14` (тус талбайд 7).

- [ ] **Step 2: Шалгах асуулга**

```csharp
int mc = new FilteredElementCollector(Doc).OfClass(typeof(CurveElement)).GetElementCount();
return mc >= 18 ? "PASS court+sep lines present ("+mc+")" : "CHECK lines="+mc;
```

Expected: `PASS court+sep lines present (...)` (14 court + 4 separation = ≥18).

---

### Task 8: 2 арцны платформ + суудлын марк (2 × 75 = 150)

**Files:**
- Create: `scripts/revit/08_stands.cs`

**Interfaces:**
- Consumes: Level 1, арц мужууд (W X[12,16], E X[48,52], Y[12,50])
- Produces: тус арцанд floor платформ + 75 суудлын марк (5 эгнээ × 15) model line-аар; нийт 150

Тус арц: 5 эгнээ × 15 суудал. Эгнээ Y дагуу, 15 суудал Y дээр (0.5м тус бүр = 7.5м), 5 эгнээ X дээр (0.7м тус бүр). W арц X[12.5,16] руу, E арц X[48,51.5] руу нүүлгэнэ. Суудлыг богино model line зураасаар тэмдэглэнэ.

- [ ] **Step 1: Платформ (Floor) + суудлын марк**

`scripts/revit/08_stands.cs`:

```csharp
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
void Stand(double xStart,double rowDir){ // rowDir +1 (rows go +X) for W; -1 for E
    double y0 = 31 - 7.5/2; // center seats around y=31, 15 seats *0.5 =7.5
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
Stand(12.2, +1); // W: rows go inward (+X)
Stand(51.8, -1); // E: rows go inward (-X)
return "Stands done. Seat marks: " + seats;
```

Expected: `Stands done. Seat marks: 150`

- [ ] **Step 2: Шалгах асуулга**

```csharp
int fl = new FilteredElementCollector(Doc).OfClass(typeof(Floor)).GetElementCount();
return fl>=2 ? "PASS 2 stand platforms ("+fl+")" : "FAIL floors="+fl;
```

Expected: `PASS 2 stand platforms (2)` (нийт 150 суудлын марк Step 1-д баталгаажсан).

---

### Task 9: Гол хаалга + room tag + SaveAs

**Files:**
- Create: `scripts/revit/09_doors_tags_save.cs`

**Interfaces:**
- Consumes: бүх өмнөх элемент
- Produces: гол орцны болон бүс хоорондын хаалга, бүх өрөөнд room tag, хадгалсан .rvt файл

- [ ] **Step 1: Гол хаалга байрлуулах**

`scripts/revit/09_doors_tags_save.cs` (part A):

```csharp
double FT(double m) => UnitUtils.ConvertToInternalUnits(m, UnitTypeId.Meters);
var l1 = new FilteredElementCollector(Doc).OfClass(typeof(Level)).Cast<Level>().First(l=>l.Name=="Level 1");
var dsym = new FilteredElementCollector(Doc).OfClass(typeof(FamilySymbol))
    .OfCategory(BuiltInCategory.OST_Doors).Cast<FamilySymbol>().FirstOrDefault();
int doors=0;
if(dsym!=null){
    if(!dsym.IsActive){ dsym.Activate(); Doc.Regenerate(); }
    // host: гадна өмнө хана (south) дээр гол орц
    var southWall = new FilteredElementCollector(Doc).OfClass(typeof(Wall)).Cast<Wall>()
        .FirstOrDefault(w=>{
            var lc=w.Location as LocationCurve; if(lc==null) return false;
            var ln=lc.Curve as Line; if(ln==null) return false;
            return Math.Abs(ln.GetEndPoint(0).Y)<FT(0.5) && Math.Abs(ln.GetEndPoint(1).Y)<FT(0.5);
        });
    if(southWall!=null){
        var p = new XYZ(FT(32),FT(0),FT(0));
        var d = Doc.Create.NewFamilyInstance(p, dsym, southWall, l1,
            Autodesk.Revit.DB.Structure.StructuralType.NonStructural);
        doors++;
    }
}
Print("Doors placed: " + doors + (dsym==null?" (no door family loaded — skip)":""));
```

Expected: `Doors placed: 1` (хэрэв door family ачаалаагүй бол `0 (no door family loaded — skip)` — энэ нь OK, шошго руу үргэлжил).

- [ ] **Step 2: Бүх өрөөнд room tag**

`scripts/revit/09_doors_tags_save.cs` (part B):

```csharp
var view = new FilteredElementCollector(Doc).OfClass(typeof(ViewPlan)).Cast<ViewPlan>()
    .First(v=>!v.IsTemplate && v.GenLevel!=null && v.GenLevel.Id==l1.Id);
var rooms = new FilteredElementCollector(Doc).OfCategory(BuiltInCategory.OST_Rooms)
    .WhereElementIsNotElementType().Cast<Autodesk.Revit.DB.Architecture.Room>()
    .Where(r=>r.Area>0).ToList();
int tags=0;
foreach(var r in rooms){
    var lp = r.Location as LocationPoint; if(lp==null) continue;
    var uv = new UV(lp.Point.X, lp.Point.Y);
    Doc.Create.NewRoomTag(new LinkElementId(r.Id), uv, view.Id); tags++;
}
return "Room tags: " + tags;
```

Expected: `Room tags: 73`

- [ ] **Step 3: SaveAs (.rvt)**

`scripts/revit/09_doors_tags_save.cs` (part C):

```csharp
var path = @"C:\Users\US\projects\revit-mcp\output\Tennis_Hall_Floor1.rvt";
System.IO.Directory.CreateDirectory(System.IO.Path.GetDirectoryName(path));
var opt = new SaveAsOptions(); opt.OverwriteExistingFile = true;
Doc.SaveAs(path, opt);
return "Saved: " + path;
```

Expected: `Saved: C:\Users\US\projects\revit-mcp\output\Tennis_Hall_Floor1.rvt`

- [ ] **Step 4: Эцсийн шалгах асуулга**

```csharp
int walls = new FilteredElementCollector(Doc).OfClass(typeof(Wall)).GetElementCount();
int rooms = new FilteredElementCollector(Doc).OfCategory(BuiltInCategory.OST_Rooms)
    .WhereElementIsNotElementType().Cast<Autodesk.Revit.DB.Architecture.Room>().Count(r=>r.Area>0);
int grids = new FilteredElementCollector(Doc).OfClass(typeof(Grid)).GetElementCount();
int floors = new FilteredElementCollector(Doc).OfClass(typeof(Floor)).GetElementCount();
Print($"walls={walls} rooms(placed)={rooms} grids={grids} stands(floors)={floors}");
return (rooms==73 && grids==18 && floors>=2) ? "ALL PASS" : "REVIEW counts";
```

Expected: `ALL PASS`

---

## Self-Review

**1. Spec coverage:**
- §3 ерөнхий тохиргоо → Task 1 (gate), Global Constraints ✓
- §4 грид/гадна хана → Task 2, 3 ✓
- §5 цагираг + 77 өрөө → Task 4 (бүс), 5 (68 өрөө), 6 (5 төв) = 73 placed; 5 арц (158,160,165,170,172) нэгтгэгдсэн (спекийн §5 тэмдэглэлийн дагуу) ✓
- §6 2 талбай → Task 6 (муж) + Task 7 (зураас) ✓
- §7 2×75 суудал → Task 6 (арц муж) + Task 8 (платформ+150 марк) ✓
- §8 modeling дараалал → Task 2–9 дараалал тохирч байна ✓
- §9 document setup → Task 1 gate (хүний оролцоотой fallback) ✓
- §11 success criteria → Task 9 Step 4 эцсийн шалгалт ✓

**2. Placeholder scan:** TBD/TODO алга. Бүх step бодит код/командтай ✓

**3. Type consistency:** `FT(m)` helper бүх script-д давтан тодорхойлогдсон (script тус бүр тусдаа ажилладаг тул зөв). Wall type сонголт (`inter`/`ext`) Task 3,4,5-д ижил логик. Room Number/Name тууштай. ✓

**Тэмдэглэл (нийт өрөө 77 → 73 placed):** Спекийн §5-д тодорхойлсноор "up to 150 суудал" шаардлагыг хангахын тулд лавлагааны 7 арц (100,132,158,160,165,170,172) → 2 арц (100,132) болгон нэгтгэв. Тиймээс 158,160,165,170,172 (5 дугаар) placed хийгдээгүй. Үлдсэн 72 дугаар бүгд placed (149 → 149a/149b болж хуваагдсан тул нийт 73 room). Pre-flight-д 166,169,171,176 дутуу байсныг нэмж зассан.
