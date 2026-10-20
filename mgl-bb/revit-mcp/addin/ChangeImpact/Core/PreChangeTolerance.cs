using System;

namespace RevitMcpAddin.ChangeImpact.Core
{
    /// <summary>
    /// «Өөрчлөхөөс өмнө шалгах» (Change Impact Radar)-ын ХАРЬЦУУЛАЛТЫН ХҮЛЦЭЛ — ГАНЦ газар.
    ///
    /// ⚠️ Snapshot-ын бүх тоо SI (мм, м², м) — Revit-ийн дотоод нэгж (фут) руу ЭНД хөрвүүлэхгүй: хөрвүүлэлтийг Revit-тэй давхарга
    /// `UnitUtils.ConvertFromInternalUnits(..., UnitTypeId.*)`-ээр хийж snapshot-д SI-аар хадгална.  Тиймээс цэвэр Core нь
    /// «0.3048» гэх мэт хөрвүүлэх тогтмол ХЭЗЭЭ Ч хэрэглэхгүй.
    ///
    /// Яагаад хүлцэл: 1) Revit-ийн геометр нь хөвөгч таслалтай — өөрчлөлтгүй утгыг «өөрчлөгдсөн» гэж мэдээлж болохгүй;
    /// 2) хүнд харагдах «+0.0000001 м²» гэх мэт утгагүй дельта гаргахгүй (`PreChangeText` үүгээр дугуйлна).
    /// </summary>
    public static class PreChangeTolerance
    {
        /// <summary>Урт, байрлал, хэмжээсийн утга (мм).  0.5 мм = Revit-ийн богино шугамын хүлцэл (~1/64" ≈ 0.4 мм)-ээс бага.</summary>
        public const double LengthMm = 0.5;

        /// <summary>Талбай (м²).  0.005 м² = 50 см² — өрөөний талбайн 2 орны нарийвчлал.</summary>
        public const double AreaM2 = 0.005;

        /// <summary>Гарцын замын урт (м).  0.01 м = 1 см.</summary>
        public const double RouteM = 0.01;

        /// <summary>Эзлэхүүн (см³) — clash-ийн өөрчлөлт «шинэчлэгдсэн» гэж үзэх зөрүү.</summary>
        public const double VolumeCm3 = 1.0;

        /// <summary>Preview ба бодит гүйцэтгэлийн харьцуулалтад: Revit хоёр удаа ИЖИЛ үйлдлийг ижил дүн гаргах ёстой тул хатуу байлгана.</summary>
        public const double VerifyLengthMm = 1.0;
        public const double VerifyAreaM2 = 0.01;
        public const double VerifyRouteM = 0.02;

        public static bool SameMm(double a, double b) { return Math.Abs(a - b) <= LengthMm; }
        public static bool SameM2(double a, double b) { return Math.Abs(a - b) <= AreaM2; }
        public static bool SameRouteM(double a, double b) { return Math.Abs(a - b) <= RouteM; }

        /// <summary>
        /// Хөдөлгөөний хоёр вектор (мм) ижил эсэх — «хаалга ханатайгаа ХАМТ хөдөлсөн» эсэхийг шийднэ.
        /// Хүлцэл нь `LengthMm`-ийн хоёр дахин (хоёр байрлалын зөрүү).
        /// </summary>
        public static bool SameVectorMm(double[] a, double[] b)
        {
            if (a == null || b == null || a.Length < 3 || b.Length < 3) return false;
            double tol = LengthMm * 2;
            return Math.Abs(a[0] - b[0]) <= tol && Math.Abs(a[1] - b[1]) <= tol && Math.Abs(a[2] - b[2]) <= tol;
        }

        public static double[] DiffMm(double[] from, double[] to)
        {
            if (from == null || to == null || from.Length < 3 || to.Length < 3) return null;
            return new[] { to[0] - from[0], to[1] - from[1], to[2] - from[2] };
        }

        public static double LengthOfMm(double[] v)
        {
            return v == null || v.Length < 3 ? 0 : Math.Sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
        }

        /// <summary>Тоог хүлцлийн нарийвчлалд дугуйлна (хурууны хээ, хэшэд тогтвортой байхын тулд).</summary>
        public static double Quantize(double value, double step)
        {
            if (step <= 0 || double.IsNaN(value) || double.IsInfinity(value)) return value;
            return Math.Round(value / step) * step;
        }
    }
}
