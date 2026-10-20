using System;

namespace RevitMcpAddin.Reinforcement.Core
{
    /// <summary>
    /// Revit-гүй 2D вектор (харагдацын Right/Up хавтгай).  `AutoAnnotate/Core/V2`-аас ТУСДАА: модуль бүр өөрийн
    /// Core-той, хоорондоо хамаарахгүй (нэг нь өөрчлөгдөхөд нөгөө эвдрэхгүй).
    /// </summary>
    public struct RfV2
    {
        public readonly double X, Y;

        public RfV2(double x, double y) { X = x; Y = y; }

        public static RfV2 operator +(RfV2 a, RfV2 b) { return new RfV2(a.X + b.X, a.Y + b.Y); }
        public static RfV2 operator -(RfV2 a, RfV2 b) { return new RfV2(a.X - b.X, a.Y - b.Y); }
        public static RfV2 operator -(RfV2 a) { return new RfV2(-a.X, -a.Y); }
        public static RfV2 operator *(RfV2 a, double k) { return new RfV2(a.X * k, a.Y * k); }
        public static RfV2 operator *(double k, RfV2 a) { return new RfV2(a.X * k, a.Y * k); }

        public double Dot(RfV2 o) { return X * o.X + Y * o.Y; }
        public double Cross(RfV2 o) { return X * o.Y - Y * o.X; }
        public double Length { get { return Math.Sqrt(X * X + Y * Y); } }

        /// <summary>Зүүн тийш 90° эргүүлсэн (−Y, X).</summary>
        public RfV2 Perp() { return new RfV2(-Y, X); }

        public RfV2 Normalized()
        {
            double l = Length;
            return l < 1e-12 ? new RfV2(0, 0) : new RfV2(X / l, Y / l);
        }

        /// <summary>Эерэг X тэнхлэгээс CCW өнцөг (радиан, −π…π).</summary>
        public double Angle() { return Math.Atan2(Y, X); }

        public override string ToString()
        {
            return "(" + X.ToString("0.####", System.Globalization.CultureInfo.InvariantCulture) + ", "
                + Y.ToString("0.####", System.Globalization.CultureInfo.InvariantCulture) + ")";
        }
    }

    /// <summary>Revit-гүй 3D вектор / цэг (модель координат, фут).</summary>
    public struct RfV3
    {
        public readonly double X, Y, Z;

        public RfV3(double x, double y, double z) { X = x; Y = y; Z = z; }

        public static RfV3 operator +(RfV3 a, RfV3 b) { return new RfV3(a.X + b.X, a.Y + b.Y, a.Z + b.Z); }
        public static RfV3 operator -(RfV3 a, RfV3 b) { return new RfV3(a.X - b.X, a.Y - b.Y, a.Z - b.Z); }
        public static RfV3 operator -(RfV3 a) { return new RfV3(-a.X, -a.Y, -a.Z); }
        public static RfV3 operator *(RfV3 a, double k) { return new RfV3(a.X * k, a.Y * k, a.Z * k); }
        public static RfV3 operator *(double k, RfV3 a) { return new RfV3(a.X * k, a.Y * k, a.Z * k); }

        public double Dot(RfV3 o) { return X * o.X + Y * o.Y + Z * o.Z; }

        public RfV3 Cross(RfV3 o)
        {
            return new RfV3(Y * o.Z - Z * o.Y, Z * o.X - X * o.Z, X * o.Y - Y * o.X);
        }

        public double Length { get { return Math.Sqrt(X * X + Y * Y + Z * Z); } }

        public RfV3 Normalized()
        {
            double l = Length;
            return l < 1e-12 ? new RfV3(0, 0, 0) : new RfV3(X / l, Y / l, Z / l);
        }

        public double DistanceTo(RfV3 o) { return (this - o).Length; }

        public override string ToString()
        {
            return "(" + X.ToString("0.####", System.Globalization.CultureInfo.InvariantCulture) + ", "
                + Y.ToString("0.####", System.Globalization.CultureInfo.InvariantCulture) + ", "
                + Z.ToString("0.####", System.Globalization.CultureInfo.InvariantCulture) + ")";
        }
    }

    /// <summary>
    /// ХАРАГДАЦЫН координатын систем — «world X = хэвтээ, Z = дээш» гэж ХЭЗЭЭ Ч таамаглахгүй.  Revit-ийн
    /// `View.RightDirection / UpDirection / ViewDirection`-ыг (ViewDirection = харагчийн зүг рүү заана,
    /// Right × Up = ViewDirection) ХЭВЭЭР дамжуулж, бүх цэг/чиглэлийг (u, v) 2D болгон буулгана.
    ///
    /// Эерэг эргэлт: ViewDirection тэнхлэгийн дагуу баруун гарын дүрмээр = харагчид CCW (Right → Up).
    /// </summary>
    public struct RfViewFrame
    {
        public readonly RfV3 Origin;
        public readonly RfV3 Right;
        public readonly RfV3 Up;
        public readonly RfV3 Normal;

        public RfViewFrame(RfV3 origin, RfV3 right, RfV3 up, RfV3 normal)
        {
            Origin = origin;
            Right = right.Normalized();
            Up = up.Normalized();
            Normal = normal.Normalized();
        }

        /// <summary>Модель цэгийг харагдацын 2D (u, v) болгоно (гүн алдагдана).</summary>
        public RfV2 ToView(RfV3 p)
        {
            RfV3 d = p - Origin;
            return new RfV2(d.Dot(Right), d.Dot(Up));
        }

        /// <summary>Модель чиглэлийг харагдацын 2D чиглэл болгоно (хэмжээ хадгалагдана, гүн алдагдана).</summary>
        public RfV2 ToViewVec(RfV3 v)
        {
            return new RfV2(v.Dot(Right), v.Dot(Up));
        }

        /// <summary>Харагдацын (u, v)-ээс хавтгай дээрх модель цэг.</summary>
        public RfV3 ToModel(RfV2 p)
        {
            return Origin + Right * p.X + Up * p.Y;
        }

        /// <summary>Модель цэгийг харагдацын хавтгай руу (гүнгээр нь) тусгана.</summary>
        public RfV3 Project(RfV3 p)
        {
            double depth = (p - Origin).Dot(Normal);
            return p - Normal * depth;
        }

        /// <summary>Цэгийн харагдацын хавтгайгаас зай (тэмдэгтэй).</summary>
        public double DepthOf(RfV3 p) { return (p - Origin).Dot(Normal); }
    }
}
