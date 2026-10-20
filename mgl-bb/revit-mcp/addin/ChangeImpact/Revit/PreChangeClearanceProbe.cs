using System;
using System.Collections.Generic;
using System.Linq;
using Autodesk.Revit.DB;

namespace RevitMcpAddin.ChangeImpact
{
    /// <summary>
    /// Хаалганы ОРЧНЫ ЗАЙ — хаалганы хоёр талаас хамгийн ойрын саад (хана, багана) хүртэлх зай, 3D харагдацын ray-аар
    /// (`ReferenceIntersector`).  ⚠️ Энэ нь НОРМЫН шалгалт БИШ — геометрийн хэмжилт.
    ///
    /// Найдваргүй үед (3D харагдац алга, section box, хана нуугдсан, саад олдохгүй) `null` → «тооцоолоогүй» (ХЭЗЭЭ Ч 0/зохиомол тоо биш).
    /// Хоёр талын хамгийн бага; нэг тал нь саадгүй (нээлттэй) бол нөгөө тал; хоёулаа саадгүй бол тооцоолохгүй.
    /// </summary>
    internal static class PreChangeClearanceProbe
    {
        /// <summary>Хананд суусан хаалганы хост ханын гадаргуунаас хэдэн мм-ийн дараа ray эхлэх.</summary>
        internal const double StartOffsetMm = 20;
        /// <summary>Ray-ийн өндөр (хаалганы суурийн цэгээс дээш, мм).</summary>
        internal const double RayHeightMm = 1000;

        private static readonly BuiltInCategory[] Obstacles =
        {
            BuiltInCategory.OST_Walls, BuiltInCategory.OST_Columns, BuiltInCategory.OST_StructuralColumns, BuiltInCategory.OST_CurtainWallPanels,
        };

        /// <summary>Ашиглах боломжтой 3D харагдац.  Олдохгүй бол null + `problem`.</summary>
        internal static View3D FindView(Document doc, out string problem)
        {
            problem = "Хаалганы орчны зай хэмжих 3D харагдац олдсонгүй (перспектив биш, section box-гүй, хана нуугдаагүй).";
            View3D best = null;
            foreach (View3D v in new FilteredElementCollector(doc).OfClass(typeof(View3D)).Cast<View3D>())
            {
                try
                {
                    if (v.IsTemplate || v.IsPerspective || v.IsSectionBoxActive) continue;
                    ElementId walls = new ElementId(BuiltInCategory.OST_Walls);
                    if (v.CanCategoryBeHidden(walls) && v.GetCategoryHidden(walls)) continue;
                    if (best == null || string.Equals(v.Name, "{3D}", StringComparison.Ordinal)) best = v;
                }
                catch (Exception) { }
            }
            if (best != null) problem = null;
            return best;
        }

        /// <summary>
        /// Хаалганы орчны зай (мм).  null = тооцоолоогүй (`note`-д шалтгаан).  `view` нь ӨМНӨ/ДАРАА ИЖИЛ харагдац байх ёстой.
        /// </summary>
        internal static double? Measure(Document doc, View3D view, FamilyInstance door, out string note)
        {
            note = null;
            try
            {
                var lp = door.Location as LocationPoint;
                if (lp == null) { note = "Хаалганы байрлалын цэг алга."; return null; }
                XYZ facing = door.FacingOrientation;
                if (facing == null || facing.GetLength() < 1e-6) { note = "Хаалганы чиглэл тодорхойгүй."; return null; }
                facing = new XYZ(facing.X, facing.Y, 0);
                if (facing.GetLength() < 1e-6) { note = "Хаалганы чиглэл хэвтээ биш."; return null; }
                facing = facing.Normalize();

                double half = 0;
                var host = door.Host as Wall;
                if (host != null) half = host.Width / 2;
                double start = half + PcUnits.ToInternalMm(StartOffsetMm);
                XYZ origin = new XYZ(lp.Point.X, lp.Point.Y, lp.Point.Z + PcUnits.ToInternalMm(RayHeightMm));

                var filter = new ElementMulticategoryFilter(Obstacles.ToList());
                var ri = new ReferenceIntersector(filter, FindReferenceTarget.Element, view);
                ri.FindReferencesInRevitLinks = false;

                double? best = null;
                foreach (double sign in new[] { 1.0, -1.0 })
                {
                    XYZ dir = facing * sign;
                    XYZ from = origin + dir * start;
                    ReferenceWithContext hit = ri.FindNearest(from, dir);
                    if (hit == null) continue;                    // энэ тал нээлттэй (саадгүй)
                    double mm = PcUnits.Mm(hit.Proximity);
                    if (!best.HasValue || mm < best.Value) best = mm;
                }
                if (!best.HasValue) note = "Хоёр талд нь саад (хана, багана) олдсонгүй — зай хэмжих боломжгүй.";
                return best;
            }
            catch (Exception ex)
            {
                note = "Хаалганы орчны зай хэмжиж чадсангүй (" + ex.GetType().Name + ").";
                return null;
            }
        }
    }
}
