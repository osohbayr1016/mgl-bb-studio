using System;

namespace RevitMcpAddin.WallElevation.Core
{
    /// <summary>
    /// Харагдацын эзлэхүүний ПЛАН дахь мөр (эргэлттэй тэгш өнцөгт) + өндрийн муж.  Хоёр дэлгээсийн эзлэхүүн огтлолцох уу
    /// гэдгийг Revit-ийн харагдацын collector-гүйгээр (харагдац бүрийг тооцоолуулахгүй) шийднэ — бусад дэлгээсийн
    /// тэмдгийг нуухад зөвхөн хөршүүдийг авна.  ⚠️ Хэмжсэн: харагдац бүрт collector ажиллуулах нь 192 дэлгээст 5 с байв.
    /// </summary>
    public struct WeFootprint
    {
        public double Cx, Cy;
        /// <summary>Нэгж тэнхлэгүүд (хэвтээ): U = харагдацын баруун, W = харах чиглэл.</summary>
        public double Ux, Uy, Wx, Wy;
        public double HalfU, HalfW;
        public double MinZ, MaxZ;

        public static WeFootprint Of(WeV3 center, WeV3 right, WeV3 viewDirection, WeV3 half)
        {
            WeV3 u = right.Flat().Normalized();
            WeV3 w = viewDirection.Flat().Normalized();
            return new WeFootprint
            {
                Cx = center.X, Cy = center.Y,
                Ux = u.X, Uy = u.Y, Wx = w.X, Wy = w.Y,
                HalfU = Math.Abs(half.X), HalfW = Math.Abs(half.Z),
                MinZ = center.Z - Math.Abs(half.Y), MaxZ = center.Z + Math.Abs(half.Y),
            };
        }

        /// <summary>Тусгаарлах тэнхлэгийн теорем (2D, 4 тэнхлэг) + өндрийн муж.  Хүлцэл = хил шүргэлтийг огтлолцол гэж тооцно.</summary>
        public bool Overlaps(WeFootprint o, double tol)
        {
            if (MaxZ < o.MinZ - tol || o.MaxZ < MinZ - tol) return false;
            double dx = o.Cx - Cx, dy = o.Cy - Cy;
            return !Separated(Ux, Uy, dx, dy, o, tol) && !Separated(Wx, Wy, dx, dy, o, tol)
                && !Separated(o.Ux, o.Uy, dx, dy, o, tol) && !Separated(o.Wx, o.Wy, dx, dy, o, tol);
        }

        private bool Separated(double ax, double ay, double dx, double dy, WeFootprint o, double tol)
        {
            double dist = Math.Abs(dx * ax + dy * ay);
            double ra = HalfU * Math.Abs(Ux * ax + Uy * ay) + HalfW * Math.Abs(Wx * ax + Wy * ay);
            double rb = o.HalfU * Math.Abs(o.Ux * ax + o.Uy * ay) + o.HalfW * Math.Abs(o.Wx * ax + o.Wy * ay);
            return dist > ra + rb + tol;
        }
    }
}
