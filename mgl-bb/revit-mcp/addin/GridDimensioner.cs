using System;
using System.Collections.Generic;
using Autodesk.Revit.DB;

namespace RevitMcpAddin
{
    /// <summary>
    /// View доторх шулуун grid-үүдийг чиглэлээр нь бүлэглэж, бүлэг тус бүрд
    /// дараалсан (continuous) хэмжээсийн шугам тавина. НЭЭЛТТЭЙ Transaction
    /// дотор дуудагдана — PdfViewExportCommand үүсгэсэн хэмжээсээ export-ийн
    /// дараа rollback хийдэг тул моделд юу ч үлдэхгүй.
    ///
    /// v1 хязгаарлалт: зөвхөн Line-grid (Arc skip), хана/бүтээцийн boundary
    /// хэмжээс ороогүй (spec-ийн дагуу).
    /// </summary>
    public static class GridDimensioner
    {
        private const double DirectionEps = 0.001;

        /// <summary>Тавьсан хэмжээсийн тоог буцаана.</summary>
        public static int Run(Document doc, View view)
        {
            var grids = new List<Grid>();
            foreach (Element e in new FilteredElementCollector(doc, view.Id).OfClass(typeof(Grid)))
            {
                var grid = (Grid)e;
                if (grid.Curve is Line)
                    grids.Add(grid);
            }
            if (grids.Count < 2)
                return 0;

            // Чиглэлээр бүлэглэнэ (тэмдэг нормчилж: d ба -d нэг бүлэг).
            var groups = new Dictionary<(double X, double Y), List<Grid>>();
            foreach (Grid grid in grids)
            {
                XYZ d = ((Line)grid.Curve).Direction;
                if (d.X < -DirectionEps || (Math.Abs(d.X) < DirectionEps && d.Y < 0))
                    d = d.Negate();
                var key = (Math.Round(d.X, 3), Math.Round(d.Y, 3));
                if (!groups.TryGetValue(key, out List<Grid> list))
                {
                    list = new List<Grid>();
                    groups[key] = list;
                }
                list.Add(grid);
            }

            double offset = UnitUtils.ConvertToInternalUnits(3.0, UnitTypeId.Meters);
            int created = 0;

            foreach (List<Grid> group in groups.Values)
            {
                if (group.Count < 2)
                    continue;
                try
                {
                    if (CreateGroupDimension(doc, view, group, offset))
                        created++;
                }
                catch
                {
                    // Нэг бүлгийн алдаа бусдыг нь унагахгүй — тухайн чиглэлийн
                    // хэмжээс л тавигдахгүй үлдэнэ.
                }
            }
            return created;
        }

        private static bool CreateGroupDimension(
            Document doc, View view, List<Grid> group, double offset)
        {
            Line firstLine = (Line)group[0].Curve;
            XYZ d = firstLine.Direction; // grid-ийн дагуух чиглэл
            XYZ p = new XYZ(-d.Y, d.X, 0); // хөндлөн (хэмжих) чиглэл

            // Хэмжээсийн шугамыг grid-үүдийн төгсгөлөөс offset зайд, гадна талд нь
            // байрлуулна: d-дагуух хамгийн бага проекцын цэгээс -d тийш offset.
            double minAlongD = double.MaxValue;
            double minAlongP = double.MaxValue;
            double maxAlongP = double.MinValue;
            double z = firstLine.GetEndPoint(0).Z;
            foreach (Grid grid in group)
            {
                Line line = (Line)grid.Curve;
                for (int i = 0; i < 2; i++)
                {
                    XYZ pt = line.GetEndPoint(i);
                    double alongD = pt.X * d.X + pt.Y * d.Y;
                    double alongP = pt.X * p.X + pt.Y * p.Y;
                    if (alongD < minAlongD) minAlongD = alongD;
                    if (alongP < minAlongP) minAlongP = alongP;
                    if (alongP > maxAlongP) maxAlongP = alongP;
                }
            }
            if (maxAlongP - minAlongP < DirectionEps)
                return false; // бүх grid давхцаж байна

            double baseD = minAlongD - offset;
            XYZ a = new XYZ(d.X * baseD + p.X * minAlongP, d.Y * baseD + p.Y * minAlongP, z);
            XYZ b = new XYZ(d.X * baseD + p.X * maxAlongP, d.Y * baseD + p.Y * maxAlongP, z);
            Line dimLine = Line.CreateBound(a, b);

            // Reference-үүдийг хөндлөн проекцоор нь эрэмбэлнэ (дараалсан сегмент).
            group.Sort((g1, g2) =>
            {
                XYZ pt1 = ((Line)g1.Curve).GetEndPoint(0);
                XYZ pt2 = ((Line)g2.Curve).GetEndPoint(0);
                double v1 = pt1.X * p.X + pt1.Y * p.Y;
                double v2 = pt2.X * p.X + pt2.Y * p.Y;
                return v1.CompareTo(v2);
            });

            var refs = new ReferenceArray();
            foreach (Grid grid in group)
                refs.Append(new Reference(grid));

            Dimension dim = doc.Create.NewDimension(view, dimLine, refs);
            return dim != null;
        }
    }
}
