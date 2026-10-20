double FT(double m) => UnitUtils.ConvertToInternalUnits(m, UnitTypeId.Meters);
double H = 9.0;
var l1 = new FilteredElementCollector(Doc).OfClass(typeof(Level)).Cast<Level>().First(l=>l.Name=="Level 1");
var basics = new FilteredElementCollector(Doc).OfClass(typeof(WallType)).Cast<WallType>()
    .Where(w=>w.Kind==WallKind.Basic).ToList();
var inter = basics.FirstOrDefault(w=>w.Name=="Interior - 4 7/8\" Partition (1-hr)")
          ?? basics.First(w=>w.Name.StartsWith("Interior"));

var partitions = new List<(double,double,double,double)>();
var cells = new List<(double cx,double cy,string num,string name)>();

void Plan(double bx0,double by0,double bx1,double by1, char axis, int rows,
          List<(string num,string name,double w)> rooms){
    var sub = new List<(string,string,double)>[rows];
    for(int i=0;i<rows;i++) sub[i]=new List<(string,string,double)>();
    for(int i=0;i<rooms.Count;i++) sub[i%rows].Add((rooms[i].num,rooms[i].name,rooms[i].w));
    for(int r=0;r<rows;r++){
        double dStart,dEnd;
        if(axis=='X'){ double d=(by1-by0)/rows; dStart=by0+r*d; dEnd=dStart+d; }
        else         { double d=(bx1-bx0)/rows; dStart=bx0+r*d; dEnd=dStart+d; }
        if(rows>1 && r>0){
            if(axis=='X') partitions.Add((bx0,dStart,bx1,dStart));
            else          partitions.Add((dStart,by0,dStart,by1));
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
            if(k < sub[r].Count-1){
                if(axis=='X') partitions.Add((b,dStart, b,dEnd));
                else          partitions.Add((dStart,b, dEnd,b));
            }
            cells.Add(((X0+X1)/2,(Y0+Y1)/2,rm.Item1,rm.Item2));
            cur=b;
        }
    }
}

// SOUTH band (Y[0,12], full width, axis X, 1 row)
Plan(0,0,64,12,'X',1, new List<(string,string,double)>{
    ("105","Шатны хонгил-1",30.86),("104","Спорт хэрэгслийн худалдааны хэсэг",43.89),
    ("101","Лоби",327.86),("102","Тасалбар түгээх цэг",62.12),("103","Тасалбарын касс",11.71)
});
// NORTH band (Y[52,64], full width, axis X, 2 rows)
Plan(0,52,64,64,'X',2, new List<(string,string,double)>{
    ("112","Хоолны хэсэг",156.90),("113","Гал тогоо",31.42),("114","Угаалгын хэсэг",6.13),
    ("115","Ногоо бэлтгэх хэсэг",5.71),("116","Мах бэлтгэх хэсэг",5.50),("117","Хүйтэн агуулах-1",2.37),
    ("118","Хүйтэн агуулах-2",2.75),("119","Гал тогоо /Орц/",7.55),("120","Ажилчдын хувцас солих /гал тогоо/",3.83),
    ("121","Угаалгын хэсэг /гал тогоо/",2.89),("122","АЦБ /гал тогоо/",1.82),("123","Шүршүүр /гал тогоо/",2.07)
});
// WEST band (X[0,12], Y[12,52], axis Y, 2 rows)
Plan(0,12,12,52,'Y',2, new List<(string,string,double)>{
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
// EAST band (X[52,64], Y[12,52], axis Y, 2 rows)
Plan(52,12,64,52,'Y',2, new List<(string,string,double)>{
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

// 1) create all partition walls
foreach(var p in partitions){
    var ln = Line.CreateBound(new XYZ(FT(p.Item1),FT(p.Item2),0), new XYZ(FT(p.Item3),FT(p.Item4),0));
    Wall.Create(Doc, ln, inter.Id, l1.Id, FT(H), 0.0, false, false);
}
Doc.Regenerate();
// 2) place all rooms
int placed=0, failed=0;
foreach(var c in cells){
    try {
        var room = Doc.Create.NewRoom(l1, new UV(FT(c.cx),FT(c.cy)));
        if(room!=null){ room.Number=c.num; room.Name=c.name; placed++; }
        else failed++;
    } catch(Exception ex){ failed++; Print($"FAIL {c.num}: {ex.Message}"); }
}
Print($"partitions={partitions.Count} cells={cells.Count} failed={failed}");
return "Rooms placed in bands: " + placed;
