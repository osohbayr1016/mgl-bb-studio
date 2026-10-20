using System;
using System.Collections.Generic;

namespace RevitMcpAddin.AutoAnnotate.Core
{
    /// <summary>
    /// «Автомат хэмжээс»-ийн Revit-гүй 2D геометр.  План дээр бүх тооцоо XY хавтгайд,
    /// зүсэлт/фасад дээр харагдацын (Right, Up) хавтгайд явна — хоёуланд нь энэ төрөл.
    ///
    /// ⚠️ Энэ хавтас (`AutoAnnotate/Core`) Revit, WPF-ийг ХЭЗЭЭ Ч ашиглахгүй:
    /// `tests/AutoAnnotate.Tests` шууд эмхэтгэдэг, мөн net48 (Revit 2024)-д орно —
    /// `Math.Clamp`, `GetValueOrDefault`, `init`, record, range ХЭРЭГЛЭХГҮЙ.
    /// </summary>
    public struct V2
    {
        public readonly double X, Y;

        public V2(double x, double y) { X = x; Y = y; }

        public static V2 operator +(V2 a, V2 b) => new V2(a.X + b.X, a.Y + b.Y);
        public static V2 operator -(V2 a, V2 b) => new V2(a.X - b.X, a.Y - b.Y);
        public static V2 operator -(V2 a) => new V2(-a.X, -a.Y);
        public static V2 operator *(V2 a, double k) => new V2(a.X * k, a.Y * k);
        public static V2 operator *(double k, V2 a) => new V2(a.X * k, a.Y * k);

        public double Dot(V2 o) => X * o.X + Y * o.Y;
        public double Cross(V2 o) => X * o.Y - Y * o.X;
        public double Length => Math.Sqrt(X * X + Y * Y);

        /// <summary>Зүүн тийш 90° эргүүлсэн (−Y, X).</summary>
        public V2 Perp() => new V2(-Y, X);

        public V2 Normalized()
        {
            double l = Length;
            return l < 1e-12 ? new V2(0, 0) : new V2(X / l, Y / l);
        }

        public override string ToString() => "(" + X.ToString("0.###") + ", " + Y.ToString("0.###") + ")";
    }

    /// <summary>Хоёр чиглэл параллель (эсрэг ч байж болно) эсэх.</summary>
    public static class Dir
    {
        /// <summary>cos(≈2.6°) — Revit-д «параллель» гэж үзэх хүлцэл.  Гараар зурсан хана 0.5° хүртэл хазайдаг.</summary>
        public const double ParallelCos = 0.999;

        public static bool Parallel(V2 a, V2 b) => Math.Abs(a.Normalized().Dot(b.Normalized())) >= ParallelCos;

        public static bool Perpendicular(V2 a, V2 b) => Math.Abs(a.Normalized().Dot(b.Normalized())) <= 1 - ParallelCos;

        /// <summary>
        /// Чиглэлийг тэмдгээр нь нормчилно — d ба −d нэг бүлэг болно.  X эерэг (X ≈ 0 бол Y эерэг).
        /// </summary>
        public static V2 Canonical(V2 d)
        {
            d = d.Normalized();
            if (d.X < -1e-9 || (Math.Abs(d.X) <= 1e-9 && d.Y < 0))
                d = -d;
            return d;
        }
    }

    /// <summary>
    /// Цаасан дээрх миллиметр ↔ загварын фут.  1:100 масштабт 10 мм цаас = 1 м загвар.
    /// Хэмжээсийн шугам хоорондын зайг ЦААСААР (ГОСТ 2.307: контураас ≥10 мм, хооронд ≥7 мм)
    /// тогтоодог тул масштаб өөрчлөгдөхөд зураг ижил харагдана.
    /// </summary>
    public static class Paper
    {
        public const double MmPerFoot = 304.8;

        public static double ToFeet(double paperMm, int viewScale)
        {
            int s = viewScale > 0 ? viewScale : 100;
            return paperMm * s / MmPerFoot;
        }

        public static double FeetToMm(double feet) => feet * MmPerFoot;
    }

    /// <summary>Шулуун хэрчим (хананы тэнхлэг, тэнхлэгийн шугам).</summary>
    public struct Seg
    {
        public readonly V2 A, B;

        public Seg(V2 a, V2 b) { A = a; B = b; }

        public V2 Vector => B - A;
        public double Length => (B - A).Length;
        public V2 Dir => (B - A).Normalized();
        public V2 At(double t) => A + (B - A) * t;

        /// <summary>Цэгээс хэрчим хүртэлх хамгийн ойр зай.</summary>
        public double DistanceTo(V2 p)
        {
            V2 e = B - A;
            double len2 = e.Dot(e);
            if (len2 < 1e-18)
                return (p - A).Length;
            double t = (p - A).Dot(e) / len2;
            if (t < 0) t = 0;
            else if (t > 1) t = 1;
            return (p - At(t)).Length;
        }

        /// <summary>
        /// Туяа (o + n·s, s &gt; 0) энэ хэрчмийг огтлох уу.  Огтолбол s-ийг буцаана, үгүй бол null.
        /// Параллель туяа огтлохгүй гэж үзнэ (хананы тэнхлэгтэй давхцах тохиолдол ховор ба аюулгүй).
        /// </summary>
        public double? Ray(V2 o, V2 n)
        {
            V2 e = B - A;
            double den = n.Cross(e);
            if (Math.Abs(den) < 1e-12)
                return null;
            V2 ao = A - o;
            double s = ao.Cross(e) / den;
            double u = ao.Cross(n) / den;
            if (s <= 1e-9 || u < -1e-9 || u > 1 + 1e-9)
                return null;
            return s;
        }
    }

    /// <summary>Хэмжээс тавих тал — тэнхлэгийн (эсвэл харагдацын) хүрээтэй харьцангуй.</summary>
    public enum Side
    {
        Bottom = 0,
        Right = 1,
        Top = 2,
        Left = 3,
    }

    /// <summary>
    /// Барилгын гол тэнхлэгүүдийн хүрээ: U = «баруун», V = «дээш».  Тэнхлэг (grid) байвал
    /// харагдацын баруун чиглэлд хамгийн ойр тэнхлэгийн чиглэлээр — 45° эргэсэн барилгад ч
    /// «доод тал» нь барилгынхаа доод фасад болно.
    /// </summary>
    public sealed class AaFrame
    {
        public readonly V2 U, V;

        public AaFrame(V2 u)
        {
            U = u.Normalized();
            V = U.Perp();
        }

        public static AaFrame Axis => new AaFrame(new V2(1, 0));

        /// <summary>
        /// Тэнхлэгийн чиглэлүүдээс хүрээ сонгоно.  Тэнхлэгийн ШУГАМЫН чиглэл d-ийн аль нь ч
        /// хүрээний тэнхлэг байж болно (босоо тэнхлэгүүд → U = перпендикуляр нь).
        /// </summary>
        public static AaFrame FromDirections(IEnumerable<V2> gridDirections, V2 viewRight)
        {
            V2 right = viewRight.Normalized();
            if (right.Length < 0.5)
                right = new V2(1, 0);
            V2 best = right;
            double bestCos = -1;
            if (gridDirections != null)
            {
                foreach (V2 d0 in gridDirections)
                {
                    V2 d = d0.Normalized();
                    if (d.Length < 0.5)
                        continue;
                    foreach (V2 cand in new[] { d, -d, d.Perp(), -d.Perp() })
                    {
                        double c = cand.Dot(right);
                        if (c > bestCos + 1e-9)
                        {
                            bestCos = c;
                            best = cand;
                        }
                    }
                }
            }
            return new AaFrame(best);
        }

        /// <summary>Тухайн талын гадагш чиглэл.</summary>
        public V2 Outward(Side s)
        {
            switch (s)
            {
                case Side.Bottom: return -V;
                case Side.Right: return U;
                case Side.Top: return V;
                default: return -U;
            }
        }

        /// <summary>Тухайн талын хэмжээсийн шугамын чиглэл (доод/дээд → U, зүүн/баруун → V).</summary>
        public V2 Along(Side s) => s == Side.Bottom || s == Side.Top ? U : V;

        /// <summary>Гадагш нормаль аль талд харьяалагдах вэ (хүлцлээс гадуур бол null — налуу хана).</summary>
        public Side? SideOf(V2 outward)
        {
            V2 n = outward.Normalized();
            foreach (Side s in AllSides)
            {
                if (n.Dot(Outward(s)) >= Dir.ParallelCos)
                    return s;
            }
            return null;
        }

        public static readonly Side[] AllSides = { Side.Bottom, Side.Right, Side.Top, Side.Left };
    }

    /// <summary>Хүрээний тэнхлэгүүдээр зэрэгцүүлсэн тэгш өнцөгт (U, V координатаар).</summary>
    public sealed class Box
    {
        public double MinU = double.MaxValue, MaxU = double.MinValue, MinV = double.MaxValue, MaxV = double.MinValue;

        public bool IsEmpty => MinU > MaxU || MinV > MaxV;

        public void Add(AaFrame f, V2 p)
        {
            double u = p.Dot(f.U), v = p.Dot(f.V);
            if (u < MinU) MinU = u;
            if (u > MaxU) MaxU = u;
            if (v < MinV) MinV = v;
            if (v > MaxV) MaxV = v;
        }

        /// <summary>Тухайн талын гадна ирмэгийн координат — тухайн талын гадагш чиглэлээр хэмжсэн.</summary>
        public double Edge(Side s)
        {
            switch (s)
            {
                case Side.Bottom: return -MinV;
                case Side.Right: return MaxU;
                case Side.Top: return MaxV;
                default: return -MinU;
            }
        }
    }
}
