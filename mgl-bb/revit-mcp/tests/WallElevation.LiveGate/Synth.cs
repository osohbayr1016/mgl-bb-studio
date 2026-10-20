using System;
using System.Collections.Generic;
using System.Linq;
using Autodesk.Revit.DB;

namespace MglWeGate
{
    /// <summary>
    /// Synthetic golden model-ийн ТОДОРХОЙЛОЛТ (мм, барилгын дотоод координат).  ModelFactory үүнээс загвар барьж, сценари/шалгалт
    /// ИЖИЛ тодорхойлолтоос хүлээгдэж буй үр дүнг гаргана — хоёр газар тоо давтагдахгүй.
    ///
    ///   Architecture_Test.rvt  (A): 2 давхар (L1 0, L2 3300, L3 6600).  L1 өрөө: 101 тэгш өнцөгт · 102 L хэлбэр · 103 олон жижиг
    ///                               сегмент (шат, пилястр) · 104 30° эргэсэн павильон · 105 давхцлын тест · 106 коридор · 107 агуулах;
    ///                               L2: 201A/201B (101-ийн яг дээрх айл, дундаа хаалттай).  101-ийн Upper Limit = L2 (WE-BUG-001-ийн
    ///                               хоёр дахь механизм).
    ///   Architecture_B_Test.rvt (B): 6000×5000 павильон, B101 + B102.
    ///   Interior_Test.rvt: Өрөө 0.  A (XY шилжилттэй), B (30° + шилжилт), B2 = B-ийн 2 дахь хуулбар — A-ийн 105-тай давхцана.
    /// </summary>
    internal static class Synth
    {
        public const double L1 = 0, L2 = 3300, L3 = 6600;
        public const double ExtW = 300, PartW = 120, FinishW = 20;

        public sealed class WallDef
        {
            public double X0, Y0, X1, Y1;
            public double Width;
            public string Level;           // "L1" | "L2"
            public string Tag;             // хүний уншихад
            public WallDef(double x0, double y0, double x1, double y1, double w, string level, string tag)
            { X0 = x0; Y0 = y0; X1 = x1; Y1 = y1; Width = w; Level = level; Tag = tag; }
        }

        public sealed class InsertDef
        {
            public string Kind;            // door | window
            public string WallTag;
            public double X, Y;            // ханын тэнхлэг дээрх цэг
        }

        public sealed class RoomDef
        {
            public string Number, Name, Level;
            public double X, Y;            // өрөөн доторх цэг (NewRoom)
            public double[] Poly;          // доторх нүүрний хил (мм), шалгалтад: x0,y0,x1,y1…
            public bool UpperLimitL2;      // Upper Limit = L2, offset 0
            public double LimitOffset = 3000;
        }

        public sealed class Building
        {
            public string Name;
            public double RotDeg;          // павильоныг барилга дотор эргүүлэх (104)
            public List<WallDef> Walls = new List<WallDef>();
            public List<InsertDef> Inserts = new List<InsertDef>();
            public List<RoomDef> Rooms = new List<RoomDef>();
        }

        /// <summary>Link байршил: host = R(angle) · (p + pre) + post.</summary>
        public sealed class Placement
        {
            public string Name, File;
            public double AngleDeg;
            public double PreX, PreY, PostX, PostY;

            public XYZ ToHost(double xMm, double yMm, double zMm = 0)
            {
                double x = xMm + PreX, y = yMm + PreY;
                double a = AngleDeg * Math.PI / 180;
                double hx = x * Math.Cos(a) - y * Math.Sin(a) + PostX;
                double hy = x * Math.Sin(a) + y * Math.Cos(a) + PostY;
                return U.P(hx, hy, zMm);
            }
        }

        public static readonly Placement LinkA = new Placement { Name = "A", File = "Architecture_Test.rvt", AngleDeg = 0, PostX = 5000, PostY = 3000 };
        public static readonly Placement LinkB = new Placement { Name = "B", File = "Architecture_B_Test.rvt", AngleDeg = 30, PostX = 60000, PostY = 5000 };
        public static readonly Placement LinkB2 = new Placement { Name = "B2", File = "Architecture_B_Test.rvt", AngleDeg = 0, PreX = 40000, PreY = -500, PostX = 5000, PostY = 3000 };

        private static void Rect(List<WallDef> list, double x0, double y0, double x1, double y1, double w, string level, string tag)
        {
            list.Add(new WallDef(x0, y0, x1, y0, w, level, tag + "-S"));
            list.Add(new WallDef(x1, y0, x1, y1, w, level, tag + "-E"));
            list.Add(new WallDef(x1, y1, x0, y1, w, level, tag + "-N"));
            list.Add(new WallDef(x0, y1, x0, y0, w, level, tag + "-W"));
        }

        /// <summary>Павильон 104: 5000×4000, 30° эргэсэн, төв барилгаас баруун тийш.</summary>
        public static XYZ Pav104(double xMm, double yMm, double zMm = 0)
        {
            const double a = 30 * Math.PI / 180;
            double x = xMm * Math.Cos(a) - yMm * Math.Sin(a) + 30000;
            double y = xMm * Math.Sin(a) + yMm * Math.Cos(a) + 2000;
            return U.P(x, y, zMm);
        }

        public static Building ArchitectureA()
        {
            var b = new Building { Name = "A" };
            List<WallDef> w = b.Walls;
            // L1 гадна хана
            Rect(w, 0, 0, 24000, 12000, ExtW, "L1", "EXT1");
            // 101: x 0–6000, y 0–5000
            w.Add(new WallDef(6000, 0, 6000, 8000, PartW, "L1", "P1"));
            w.Add(new WallDef(0, 5000, 6000, 5000, PartW, "L1", "P2"));
            // 102: L хэлбэр
            w.Add(new WallDef(14000, 0, 14000, 6000, PartW, "L1", "P3"));
            w.Add(new WallDef(10000, 5000, 14000, 5000, PartW, "L1", "P4"));
            w.Add(new WallDef(10000, 5000, 10000, 8000, PartW, "L1", "P5"));
            w.Add(new WallDef(6000, 8000, 10000, 8000, PartW, "L1", "P6"));
            // 107: x 0–6000, y 5000–8000
            w.Add(new WallDef(0, 8000, 6000, 8000, PartW, "L1", "P7"));
            // 103: олон жижиг сегменттэй хойд хана (шат 300 мм) + пилястр
            w.Add(new WallDef(14000, 6000, 16000, 6000, PartW, "L1", "Z1"));
            w.Add(new WallDef(16000, 6000, 16000, 6300, PartW, "L1", "Z2"));
            w.Add(new WallDef(16000, 6300, 18000, 6300, PartW, "L1", "Z3"));
            w.Add(new WallDef(18000, 6300, 18000, 6000, PartW, "L1", "Z4"));
            w.Add(new WallDef(18000, 6000, 24000, 6000, PartW, "L1", "Z5"));
            w.Add(new WallDef(21000, 6000, 21000, 5600, 300, "L1", "PIL"));
            // L2 гадна хана + 101-ийн дээрх айл (201A | 201B)
            Rect(w, 0, 0, 24000, 12000, ExtW, "L2", "EXT2");
            w.Add(new WallDef(6000, 0, 6000, 5000, PartW, "L2", "U1"));
            w.Add(new WallDef(0, 5000, 6000, 5000, PartW, "L2", "U2"));
            w.Add(new WallDef(3000, 0, 3000, 5000, PartW, "L2", "U3"));
            // 104: 30° эргэсэн павильон (ханыг Pav104-өөр байрлуулна — Tag "PAV")
            b.Inserts.Add(new InsertDef { Kind = "window", WallTag = "EXT1-S", X = 3000, Y = 0 });
            b.Inserts.Add(new InsertDef { Kind = "door", WallTag = "P1", X = 6000, Y = 2500 });
            b.Inserts.Add(new InsertDef { Kind = "window", WallTag = "EXT1-S", X = 10000, Y = 0 });
            b.Inserts.Add(new InsertDef { Kind = "door", WallTag = "P6", X = 8000, Y = 8000 });
            b.Inserts.Add(new InsertDef { Kind = "door", WallTag = "P3", X = 14000, Y = 2500 });
            b.Inserts.Add(new InsertDef { Kind = "window", WallTag = "EXT1-E", X = 24000, Y = 3000 });
            b.Inserts.Add(new InsertDef { Kind = "window", WallTag = "EXT2-S", X = 1500, Y = 0 });
            // 105: давхцлын павильон
            Rect(w, 40000, 0, 44000, 4000, 200, "L1", "OV");
            b.Inserts.Add(new InsertDef { Kind = "door", WallTag = "OV-S", X = 42000, Y = 0 });

            b.Rooms.Add(new RoomDef { Number = "101", Name = "ОФФИС", Level = "L1", X = 3000, Y = 2500, UpperLimitL2 = true, Poly = new double[] { 150, 150, 5940, 150, 5940, 4940, 150, 4940 } });
            b.Rooms.Add(new RoomDef { Number = "102", Name = "ХУРЛЫН ӨРӨӨ", Level = "L1", X = 8000, Y = 2500 });
            b.Rooms.Add(new RoomDef { Number = "103", Name = "ЗААЛ", Level = "L1", X = 19000, Y = 3000 });
            b.Rooms.Add(new RoomDef { Number = "104", Name = "ЭРГЭСЭН ӨРӨӨ", Level = "L1" });
            b.Rooms.Add(new RoomDef { Number = "105", Name = "ДАВХЦАХ ӨРӨӨ", Level = "L1", X = 42000, Y = 2000 });
            b.Rooms.Add(new RoomDef { Number = "106", Name = "КОРИДОР", Level = "L1", X = 12000, Y = 10000 });
            b.Rooms.Add(new RoomDef { Number = "107", Name = "АГУУЛАХ", Level = "L1", X = 3000, Y = 6500 });
            b.Rooms.Add(new RoomDef { Number = "201A", Name = "АЙЛ А", Level = "L2", X = 1500, Y = 2500 });
            b.Rooms.Add(new RoomDef { Number = "201B", Name = "АЙЛ Б", Level = "L2", X = 4500, Y = 2500 });
            return b;
        }

        public static Building ArchitectureB()
        {
            var b = new Building { Name = "B" };
            Rect(b.Walls, 0, 0, 6000, 5000, 200, "L1", "BX");
            b.Walls.Add(new WallDef(3000, 0, 3000, 5000, PartW, "L1", "BP"));
            b.Inserts.Add(new InsertDef { Kind = "door", WallTag = "BP", X = 3000, Y = 2500 });
            b.Inserts.Add(new InsertDef { Kind = "window", WallTag = "BX-S", X = 1500, Y = 0 });
            b.Rooms.Add(new RoomDef { Number = "B101", Name = "Б ӨРӨӨ 1", Level = "L1", X = 1500, Y = 2500 });
            b.Rooms.Add(new RoomDef { Number = "B102", Name = "Б ӨРӨӨ 2", Level = "L1", X = 4500, Y = 2500 });
            return b;
        }
    }
}
