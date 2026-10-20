using System;
using System.Collections.Generic;
using System.Linq;
using Autodesk.Revit.DB;
using RevitMcpAddin.CloneDrawings.Core;

namespace RevitMcpAddin.CloneDrawings
{
    public enum CdFrameKind { Curve, Point, Box }

    /// <summary>
    /// Элементийн орон нутгийн координатын систем + хэмжээ.  Загвар ба зорилт хоёрын
    /// хүрээг тулгаж харагдац, tag, хэмжээсийн байрлалыг буулгана:
    ///   • Шугаман элемент (дам нуруу, хана, налуу багана) — тэнхлэг нь X (босоо бол Z).
    ///   • Цэгэн family (багана, суурь …) — family-ийн өөрийн хувиргалт (эргэлт, толин).
    ///   • Бусад — ертөнцийн тэнхлэгт хайрцаг (эргэлтгүй).
    /// Хэмжээ (Min/Max) нь бодит геометрийн цэгүүдээс — bounding box-оос биш
    /// (эргэсэн элементийн ертөнцийн хайрцаг хэтэрхий том гардаг).
    /// </summary>
    public sealed class CdFrame
    {
        public Transform T;
        /// <summary>
        /// Буулгалтын хэмжээ.  Шугаман элементэд урт нь ТЭНХЛЭГИЙН шугамаас (0…L) — геометрээс
        /// биш: дам нурууны геометр баганын холболтоор үзүүрээ тасалдаг ба тэр нь дам нуруу
        /// бүрт өөр тул тэнхлэг (grid) хүртэлх зай «зөрөөд» тэнхлэг олдохгүй болдог байв
        /// (Snowdon Towers дээр хэмжсэн, 2026-09-30).
        /// </summary>
        public XYZ Min, Max;
        /// <summary>Бодит геометрийн хэмжээ — зөвхөн «хэмжээ яг ижил үү» шалгалтад.</summary>
        public XYZ GeoMin, GeoMax;
        public double NominalLength;
        public CdFrameKind Kind;
        /// <summary>Шугаман элементийн тэнхлэг (ертөнцөд).  Бусдад null.</summary>
        public XYZ Axis;
        public bool VerticalAxis;

        public XYZ Size => Max - Min;
        public XYZ GeoSize => GeoMax - GeoMin;
        public bool Mirrored => T.Determinant < 0;

        /// <summary>
        /// <paramref name="align"/> өгвөл (загварын хүрээ) шугаман элементийн чиглэлийг
        /// түүнтэй ойр байхаар (&lt; 90°) сонгоно: баруунаас зүүн тийш зурсан дам нуруу
        /// загвартай ижил талаас харагдана, 180° эргэсэн зураг гарахгүй.
        /// </summary>
        public static CdFrame Of(Element e, CdFrame align = null)
        {
            List<XYZ> pts = SamplePoints(e);
            var f = new CdFrame();

            Curve curve = (e.Location as LocationCurve)?.Curve;
            if (curve != null && curve.IsBound)
            {
                XYZ p0 = curve.GetEndPoint(0), p1 = curve.GetEndPoint(1);
                XYZ axis = p1 - p0;
                if (axis.GetLength() > 1e-6)
                {
                    axis = axis.Normalize();
                    if (align != null && align.Kind == CdFrameKind.Curve && align.Axis != null
                        && axis.DotProduct(align.Axis) < -1e-6)
                    {
                        XYZ tmp = p0; p0 = p1; p1 = tmp;
                        axis = axis.Negate();
                    }
                    f.Kind = CdFrameKind.Curve;
                    f.Axis = axis;
                    f.NominalLength = p0.DistanceTo(p1);
                    f.T = CurveBasis(p0, axis, out f.VerticalAxis);
                }
            }

            if (f.T == null && e is FamilyInstance fi && e.Location is LocationPoint)
            {
                try
                {
                    Transform t = fi.GetTransform();
                    f.T = Orthonormal(t);
                    f.Kind = CdFrameKind.Point;
                }
                catch
                {
                    f.T = null;
                }
            }

            if (f.T == null)
            {
                BoundingBoxXYZ b = e.get_BoundingBox(null);
                Transform t = Transform.Identity;
                t.Origin = b?.Min ?? XYZ.Zero;
                f.T = t;
                f.Kind = CdFrameKind.Box;
            }

            f.SetExtents(pts, e);
            return f;
        }

        private static Transform CurveBasis(XYZ origin, XYZ axis, out bool vertical)
        {
            Transform t = Transform.Identity;
            t.Origin = origin;
            if (Math.Abs(axis.Z) < 0.985)
            {
                XYZ z = (XYZ.BasisZ - axis * axis.Z).Normalize();
                t.BasisX = axis;
                t.BasisY = z.CrossProduct(axis);
                t.BasisZ = z;
                vertical = false;
            }
            else
            {
                XYZ x = (XYZ.BasisX - axis * axis.X).Normalize();
                t.BasisX = x;
                t.BasisY = axis.CrossProduct(x);
                t.BasisZ = axis;
                vertical = true;
            }
            return t;
        }

        /// <summary>Family-ийн хувиргалтыг нэгж урттай тэнхлэгтэй болгоно (масштабгүй).</summary>
        private static Transform Orthonormal(Transform t)
        {
            Transform r = Transform.Identity;
            r.Origin = t.Origin;
            r.BasisX = t.BasisX.Normalize();
            r.BasisY = t.BasisY.Normalize();
            r.BasisZ = t.BasisZ.Normalize();
            return r;
        }

        private void SetExtents(List<XYZ> pts, Element e)
        {
            if (pts.Count == 0)
            {
                BoundingBoxXYZ b = e.get_BoundingBox(null);
                if (b != null)
                    pts = Corners(b.Min, b.Max).ToList();
            }
            Transform inv = T.Inverse;
            double[] lo = { double.MaxValue, double.MaxValue, double.MaxValue };
            double[] hi = { double.MinValue, double.MinValue, double.MinValue };
            foreach (XYZ p in pts)
            {
                XYZ q = inv.OfPoint(p);
                lo[0] = Math.Min(lo[0], q.X); hi[0] = Math.Max(hi[0], q.X);
                lo[1] = Math.Min(lo[1], q.Y); hi[1] = Math.Max(hi[1], q.Y);
                lo[2] = Math.Min(lo[2], q.Z); hi[2] = Math.Max(hi[2], q.Z);
            }
            if (lo[0] > hi[0])
            {
                lo = new double[3];
                hi = new double[3];
            }
            GeoMin = new XYZ(lo[0], lo[1], lo[2]);
            GeoMax = new XYZ(hi[0], hi[1], hi[2]);
            if (Kind == CdFrameKind.Curve && NominalLength > 1e-6)
            {
                int a = VerticalAxis ? 2 : 0;
                lo[a] = 0;
                hi[a] = NominalLength;
            }
            else if (Kind == CdFrameKind.Point && ColumnSpan(e, out double baseZ, out double topZ)
                     && Math.Abs(T.BasisZ.Z) > 0.999)
            {
                // Багана: өндөр нь ТҮВШИН + offset-оос (хавтан, дам нуруутай холбогдож геометр
                // тасардаг тул геометрээр бол ижил 14 фут багана 11.5 гэж гардаг — хэмжсэн).
                double oz = T.Origin.Z;
                double s = T.BasisZ.Z;
                lo[2] = Math.Min((baseZ - oz) * s, (topZ - oz) * s);
                hi[2] = Math.Max((baseZ - oz) * s, (topZ - oz) * s);
                NominalLength = topZ - baseZ;
            }
            Min = new XYZ(lo[0], lo[1], lo[2]);
            Max = new XYZ(hi[0], hi[1], hi[2]);
        }

        /// <summary>Баганын доод, дээд тэмдэгт (түвшин + offset).  Багана биш бол false.</summary>
        private static bool ColumnSpan(Element e, out double baseZ, out double topZ)
        {
            baseZ = topZ = 0;
            if (!(e is FamilyInstance fi))
                return false;
            long cat = e.Category?.Id.Value ?? 0;
            bool column = fi.StructuralType == Autodesk.Revit.DB.Structure.StructuralType.Column
                          || cat == (long)BuiltInCategory.OST_StructuralColumns || cat == (long)BuiltInCategory.OST_Columns;
            if (!column)
                return false;
            try
            {
                Document doc = e.Document;
                var bl = doc.GetElement(e.get_Parameter(BuiltInParameter.FAMILY_BASE_LEVEL_PARAM)?.AsElementId() ?? ElementId.InvalidElementId) as Level;
                var tl = doc.GetElement(e.get_Parameter(BuiltInParameter.FAMILY_TOP_LEVEL_PARAM)?.AsElementId() ?? ElementId.InvalidElementId) as Level;
                if (bl == null || tl == null)
                    return false;
                baseZ = bl.ProjectElevation + (e.get_Parameter(BuiltInParameter.FAMILY_BASE_LEVEL_OFFSET_PARAM)?.AsDouble() ?? 0);
                topZ = tl.ProjectElevation + (e.get_Parameter(BuiltInParameter.FAMILY_TOP_LEVEL_OFFSET_PARAM)?.AsDouble() ?? 0);
                return topZ - baseZ > 1e-3;
            }
            catch
            {
                return false;
            }
        }

        /// <summary>Хүрээний 8 булан ертөнцөд.</summary>
        public IEnumerable<XYZ> WorldCorners() => Corners(Min, Max).Select(T.OfPoint);

        public XYZ WorldCenter => T.OfPoint((Min + Max) / 2);

        internal static IEnumerable<XYZ> Corners(XYZ a, XYZ b)
        {
            foreach (double x in new[] { a.X, b.X })
            foreach (double y in new[] { a.Y, b.Y })
            foreach (double z in new[] { a.Z, b.Z })
                yield return new XYZ(x, y, z);
        }

        /// <summary>Геометрийн ирмэгийн цэгүүд (ертөнцөд).  Олон ирмэгтэй family-д дээд тал 20k.</summary>
        internal static List<XYZ> SamplePoints(Element e)
        {
            var pts = new List<XYZ>();
            try
            {
                GeometryElement ge = e.get_Geometry(new Options { DetailLevel = ViewDetailLevel.Fine });
                if (ge != null)
                    Collect(ge, pts);
            }
            catch
            {
                // Геометргүй элемент — bounding box руу шилжинэ.
            }
            return pts;
        }

        private static void Collect(GeometryElement ge, List<XYZ> pts)
        {
            foreach (GeometryObject go in ge)
            {
                if (pts.Count > 20000)
                    return;
                if (go is Solid s && s.Volume > 1e-9)
                {
                    foreach (Edge ed in s.Edges)
                    {
                        try { pts.AddRange(ed.Tessellate()); }
                        catch { }
                    }
                }
                else if (go is Mesh m)
                {
                    for (int i = 0; i < m.Vertices.Count; i++)
                        pts.Add(m.Vertices[i]);
                }
                else if (go is GeometryInstance gi)
                {
                    GeometryElement inner = gi.GetInstanceGeometry();
                    if (inner != null)
                        Collect(inner, pts);
                }
            }
        }
    }

    /// <summary>
    /// Загварын хүрээ (A) → зорилтын хүрээ (B) буулгалт.  Цэгийг орон нутгийн
    /// координатаар дамжуулж тэнхлэг бүрт <see cref="Stretch.Axis"/>-аар сунгана;
    /// чиглэлийг зөвхөн эргүүлнэ (сунгахгүй).
    /// </summary>
    public sealed class CdMap
    {
        public readonly CdFrame A, B;
        private readonly Transform _aInv;

        public CdMap(CdFrame a, CdFrame b)
        {
            A = a;
            B = b;
            _aInv = a.T.Inverse;
        }

        public XYZ Point(XYZ p)
        {
            XYZ q = _aInv.OfPoint(p);
            var r = new XYZ(
                Stretch.Axis(q.X, A.Min.X, A.Max.X, B.Min.X, B.Max.X),
                Stretch.Axis(q.Y, A.Min.Y, A.Max.Y, B.Min.Y, B.Max.Y),
                Stretch.Axis(q.Z, A.Min.Z, A.Max.Z, B.Min.Z, B.Max.Z));
            return B.T.OfPoint(r);
        }

        public XYZ Vector(XYZ v) => B.T.OfVector(_aInv.OfVector(v));

        /// <summary>Хатуу (эргэлт + шилжилт) — толин биш.</summary>
        public bool IsRigid => A.T.Determinant * B.T.Determinant > 0;

        /// <summary>Бодит ГЕОМЕТРИЙН хэмжээ бүх тэнхлэгт ижил (≈6 мм) — хэмжээсийн утгыг яг тулгаж болох эсэх.</summary>
        public bool SameSize
        {
            get
            {
                XYZ a = A.GeoSize, b = B.GeoSize;
                return Math.Abs(a.X - b.X) <= TargetGrouping.SizeTol && Math.Abs(a.Y - b.Y) <= TargetGrouping.SizeTol
                    && Math.Abs(a.Z - b.Z) <= TargetGrouping.SizeTol;
            }
        }

        /// <summary>Хэвтээ эргэлт (радиан): A-гийн хэвтээ тэнхлэг B-д хаашаа эргэснийг.</summary>
        public double PlanAngle
        {
            get
            {
                XYZ r = Horizontal(A.T);
                if (r == null)
                    return 0;
                XYZ m = Vector(r);
                m = new XYZ(m.X, m.Y, 0);
                if (m.GetLength() < 1e-9)
                    return 0;
                return Math.Atan2(r.X * m.Y - r.Y * m.X, r.X * m.X + r.Y * m.Y);
            }
        }

        private static XYZ Horizontal(Transform t)
        {
            foreach (XYZ v in new[] { t.BasisX, t.BasisY })
            {
                var h = new XYZ(v.X, v.Y, 0);
                if (h.GetLength() > 0.5)
                    return h.Normalize();
            }
            return null;
        }
    }
}
