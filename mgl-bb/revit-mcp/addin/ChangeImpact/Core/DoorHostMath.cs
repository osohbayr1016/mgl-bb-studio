using System;
using System.Collections.Generic;

namespace RevitMcpAddin.ChangeImpact.Core
{
    /// <summary>
    /// Хаалганы ХОСТЫН дагуух скаляр геометр — ЦЭВЭР, тестлэгдэнэ.
    ///
    ///   Хостын координат:  s = (P − эхлэл) · чиглэл   (дагуу, мм)
    ///                      n = (P − эхлэл) · зүүн нормаль   (хөндлөн, мм)
    ///   Хаалганы төв = s₀.  offset-тэй зөөхөд шинэ төв s₁ = s₀ + offset, нүх [s₁ − w/2, s₁ + w/2].
    ///
    /// ⚠️ Нүхний өргөн мэдэгдэхгүй (`WidthSource.Unknown`) бол 0 гэж БОДОХГҮЙ — тэр үед ЗӨВХӨН төвийг хостын дотор эсэхийг л шалгана.
    /// ⚠️ Хууль/нормын хамгийн бага зай ЭНД ХЭЗЭЭ Ч БИЧИГДЭХГҮЙ — зөвхөн геометрийн (нүх хостоос хэтрэх эсэх).
    /// </summary>
    public static class DoorHostMath
    {
        /// <summary>Хостын координат руу.</summary>
        public static void Local(HostGeometry h, double x, double y, out double s, out double n)
        {
            double dx = x - h.StartX, dy = y - h.StartY;
            s = dx * h.TangentX + dy * h.TangentY;
            n = dx * h.NormalX + dy * h.NormalY;
        }

        public static double ParamOf(HostGeometry h, double x, double y)
        {
            double s, n;
            Local(h, x, y, out s, out n);
            return s;
        }

        /// <summary>Хостын координатаас дэлхийн (хост загварын) XY руу.</summary>
        public static void PointAt(HostGeometry h, double s, double n, out double x, out double y)
        {
            x = h.StartX + h.TangentX * s + h.NormalX * n;
            y = h.StartY + h.TangentY * s + h.NormalY * n;
        }

        /// <summary>Нүхний хагас өргөн; мэдэгдэхгүй бол 0 (дуудагч `WidthKnown`-оор ялгана).</summary>
        public static double HalfWidth(DoorBody d)
        {
            return d != null && d.WidthKnown ? d.WidthMm / 2.0 : 0;
        }

        /// <summary>Хоёр интервалын (хост дагуух) давхцах УРТ.  Эерэг = давхцана; ≤ 0 = завсартай (эсвэл шүргэнэ).</summary>
        public static double Overlap(double aLo, double aHi, double bLo, double bHi)
        {
            return Math.Min(aHi, bHi) - Math.Max(aLo, bLo);
        }

        /// <summary>Тэмдэгтэй offset-ийг (мм) хөдөлгөөний векторт (мм): [tx·offset, ty·offset, 0].</summary>
        public static double[] Vector(HostGeometry h, double offsetMm)
        {
            return new[] { h.TangentX * offsetMm, h.TangentY * offsetMm, 0.0 };
        }

        /// <summary>
        /// Нүх хостын дотор үлдэх offset-ийн хүрээ [min, max] (мм).  Өргөн мэдэгдэхгүй бол зөвхөн төв.
        /// Хүрээ хоосон (нүх хостоос өргөн) бол min &gt; max.
        /// </summary>
        public static void OffsetRange(DoorMoveContext ctx, out double min, out double max)
        {
            double half = HalfWidth(ctx.Door);
            min = half - ctx.Door.CenterParamMm;
            max = ctx.Host.LengthMm - half - ctx.Door.CenterParamMm;
        }

        /// <summary>Зорилтот байрлал хостын ДОТОР эсэх.  Revit-ийн хүссэн гол нөхцөл: хаалга ӨӨРИЙН хост дээрээ үлдэнэ.</summary>
        public static DoorTargetCheck Check(DoorMoveContext ctx, double offsetMm)
        {
            var r = new DoorTargetCheck();
            if (ctx == null || ctx.Host == null || ctx.Door == null)
            {
                r.Code = "bad.input";
                r.Problem = "Хаалганы мэдээлэл бэлэн болоогүй байна.";
                return r;
            }
            if (double.IsNaN(offsetMm) || double.IsInfinity(offsetMm))
            {
                r.Code = "bad.input";
                r.Problem = "Зайн утга буруу.";
                return r;
            }
            double len = ctx.Host.LengthMm;
            if (len <= 1e-6)
            {
                r.Code = "bad.input";
                r.Problem = "Хост ханын урт 0 байна.";
                return r;
            }

            double s0 = ctx.Door.CenterParamMm;
            double s1 = s0 + offsetMm;
            double half = HalfWidth(ctx.Door);
            r.TargetParamMm = s1;
            r.IntervalStartMm = s1 - half;
            r.IntervalEndMm = s1 + half;
            r.GapToStartMm = r.IntervalStartMm;
            r.GapToEndMm = len - r.IntervalEndMm;

            if (Math.Abs(offsetMm) <= PreChangeTolerance.LengthMm)
            {
                r.Code = "no.move";
                r.Problem = "Хаалга одоогийн байрлалдаа байна.";
                return r;
            }

            double tol = PreChangeTolerance.LengthMm;
            if (s1 < -tol || s1 > len + tol)
            {
                r.Code = "outside.host";
                r.Refused = true;
                double over = s1 < 0 ? -s1 : s1 - len;
                r.Problem = "Шинэ байрлал хост ханын гадна байна — хаалганы төв ханаас " + PreChangeText.Mm(over) + " хэтэрнэ (ханын урт " + PreChangeText.Mm(len) + ").";
                return r;
            }
            if (r.GapToStartMm < -tol || r.GapToEndMm < -tol)
            {
                double over = Math.Max(-r.GapToStartMm, -r.GapToEndMm);
                r.Code = "outside.host";
                r.Refused = true;
                r.Problem = "Хаалганы нүх ханын " + (r.GapToStartMm < -tol ? "эхлэлээс" : "төгсгөлөөс") + " " + PreChangeText.Mm(over) + " хэтэрнэ — хост ханан дээр багтахгүй.";
                return r;
            }

            r.Ok = true;
            r.Code = "ok";
            return r;
        }
    }
}
