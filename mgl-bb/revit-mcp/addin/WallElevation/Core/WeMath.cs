using System;
using System.Globalization;

namespace RevitMcpAddin.WallElevation.Core
{
    /// <summary>
    /// «Ханын дэлгээс»-ийн ЦЭВЭР вектор (Revit-гүй — `tests/WallElevation.Tests` шууд эмхэтгэнэ).
    /// Бүх урт нь Revit-ийн ДОТООД нэгж (фут); мм ↔ фут хөрвүүлэлтийг Revit давхарга `UnitUtils`-аар хийнэ
    /// (<see cref="IWeUnits"/>).
    /// </summary>
    public struct WeV3
    {
        public readonly double X;
        public readonly double Y;
        public readonly double Z;

        public WeV3(double x, double y, double z) { X = x; Y = y; Z = z; }

        public static readonly WeV3 Zero = new WeV3(0, 0, 0);
        public static readonly WeV3 UnitZ = new WeV3(0, 0, 1);

        public static WeV3 operator +(WeV3 a, WeV3 b) { return new WeV3(a.X + b.X, a.Y + b.Y, a.Z + b.Z); }
        public static WeV3 operator -(WeV3 a, WeV3 b) { return new WeV3(a.X - b.X, a.Y - b.Y, a.Z - b.Z); }
        public static WeV3 operator -(WeV3 a) { return new WeV3(-a.X, -a.Y, -a.Z); }
        public static WeV3 operator *(WeV3 a, double k) { return new WeV3(a.X * k, a.Y * k, a.Z * k); }
        public static WeV3 operator *(double k, WeV3 a) { return new WeV3(a.X * k, a.Y * k, a.Z * k); }

        public double Dot(WeV3 o) { return X * o.X + Y * o.Y + Z * o.Z; }

        public WeV3 Cross(WeV3 o)
        {
            return new WeV3(Y * o.Z - Z * o.Y, Z * o.X - X * o.Z, X * o.Y - Y * o.X);
        }

        public double Length { get { return Math.Sqrt(X * X + Y * Y + Z * Z); } }

        /// <summary>Хэвтээ хавтгайд буулгана (Z = 0).</summary>
        public WeV3 Flat() { return new WeV3(X, Y, 0); }

        /// <summary>Нэгж вектор; уртгүй бол <see cref="Zero"/> (дуудагч <see cref="IsZero"/>-оор шалгана).</summary>
        public WeV3 Normalized()
        {
            double l = Length;
            return l < WeTol.Tiny ? Zero : new WeV3(X / l, Y / l, Z / l);
        }

        public bool IsZero { get { return Length < WeTol.Tiny; } }

        public bool AlmostEquals(WeV3 o, double tol) { return (this - o).Length <= tol; }

        public override string ToString()
        {
            return "(" + X.ToString("0.######", CultureInfo.InvariantCulture) + ", "
                + Y.ToString("0.######", CultureInfo.InvariantCulture) + ", "
                + Z.ToString("0.######", CultureInfo.InvariantCulture) + ")";
        }
    }

    /// <summary>Хүлцэл — бүгд фут (Revit-ийн дотоод нэгж) эсвэл нэгжгүй (чиглэл).</summary>
    public static class WeTol
    {
        /// <summary>Тэгтэй тэнцүү гэж үзэх урт.</summary>
        public const double Tiny = 1e-9;
        /// <summary>Байрлалын хүлцэл ≈ 0.3 мм.</summary>
        public const double Length = 0.001;
        /// <summary>Чиглэлийн хүлцэл (нэгж векторын бүрэлдэхүүн) ≈ 0.006°.</summary>
        public const double Direction = 1e-4;
        /// <summary>Revit-ийн ханын хамгийн богино урт (~ 1/32") — үүнээс богино хана үүсдэггүй.</summary>
        public const double MinWallLength = 0.0026;
    }

    /// <summary>
    /// Нэгж хөрвүүлэлт.  Revit давхарга `UnitUtils.ConvertToInternalUnits(x, UnitTypeId.Millimeters)`-аар хэрэгжүүлнэ;
    /// тест <see cref="WeFixedUnits"/>-ийг ашиглана.  Цөм ХЭЗЭЭ Ч 304.8-ыг өөрөө бичиж хэрэглэхгүй.
    /// </summary>
    public interface IWeUnits
    {
        double MmToInternal(double mm);
        double InternalToMeters(double ft);
    }

    /// <summary>Тестийн нэгж: 1 фут = 304.8 мм (Revit-ийн тодорхойлолттой ижил).</summary>
    public sealed class WeFixedUnits : IWeUnits
    {
        public const double MmPerFoot = 304.8;
        public double MmToInternal(double mm) { return mm / MmPerFoot; }
        public double InternalToMeters(double ft) { return ft * MmPerFoot / 1000.0; }
    }
}
