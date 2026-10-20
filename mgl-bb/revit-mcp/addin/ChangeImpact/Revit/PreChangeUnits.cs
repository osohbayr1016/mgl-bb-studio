using System;
using Autodesk.Revit.DB;

namespace RevitMcpAddin.ChangeImpact
{
    /// <summary>
    /// Revit-ийн дотоод нэгж (фут) ↔ SI (мм, м², м).  ⚠️ Хөрвүүлэлтийг Revit-ийн ӨӨРИЙН `UnitUtils`-ээр л хийнэ — гараар «304.8» бичихгүй.
    /// Snapshot (Core) нь SI-аар хадгалагддаг тул энэ бол дотоод нэгж ба Core-ийн хоорондох ГАНЦ хаалга.
    /// </summary>
    internal static class PcUnits
    {
        internal static double ToInternalMm(double mm)
        {
            return UnitUtils.ConvertToInternalUnits(mm, UnitTypeId.Millimeters);
        }

        internal static double Mm(double internalLength)
        {
            return UnitUtils.ConvertFromInternalUnits(internalLength, UnitTypeId.Millimeters);
        }

        internal static double M(double internalLength)
        {
            return UnitUtils.ConvertFromInternalUnits(internalLength, UnitTypeId.Meters);
        }

        internal static double M2(double internalArea)
        {
            return UnitUtils.ConvertFromInternalUnits(internalArea, UnitTypeId.SquareMeters);
        }

        internal static double[] PointMm(XYZ p)
        {
            return p == null ? null : new[] { Mm(p.X), Mm(p.Y), Mm(p.Z) };
        }

        /// <summary>Шугамын эхлэл/төгсгөл (мм): [x1,y1,z1,x2,y2,z2].  Шугам биш (муруй) бол null.</summary>
        internal static double[] LineMm(Curve c)
        {
            if (c == null || !c.IsBound) return null;
            XYZ a = c.GetEndPoint(0), b = c.GetEndPoint(1);
            return new[] { Mm(a.X), Mm(a.Y), Mm(a.Z), Mm(b.X), Mm(b.Y), Mm(b.Z) };
        }

        internal static XYZ VectorFromMm(double[] mm)
        {
            return new XYZ(ToInternalMm(mm[0]), ToInternalMm(mm[1]), ToInternalMm(mm[2]));
        }
    }
}
