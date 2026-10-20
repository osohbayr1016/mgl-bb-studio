using System;

namespace RevitMcpAddin.ChangeImpact.Core
{
    public struct SimRay
    {
        public SimVec Origin;
        public SimVec Dir;

        public SimVec At(double t) { return Origin + Dir * t; }
    }

    /// <summary>
    /// 3D харагдацын камер (орбит/pan/zoom) ба цэгээс цацраг — Revit/WPF-гүй.  WPF-ийн `PerspectiveCamera`/`OrthographicCamera` ЯГ ЭНЭ утгуудыг (Position, LookDirection, UpDirection,
    /// FieldOfView) авч зурна, харин хулганы цацрагийг (pick/drag) ЭНЭ класс тооцно — тиймээс хоёулаа ХЭЗЭЭ Ч зөрөхгүй.
    ///
    /// Z дээш; yaw = Z тэнхлэгийн эргэлт (X→Y), pitch = тэнгэрийн хаяанаас дээш өнцөг.  FieldOfView нь WPF-тэй ижил — ХЭВТЭЭ өнцөг.
    /// </summary>
    public sealed class SimCamera
    {
        public const double MinDistanceMm = 200;
        public const double MaxDistanceMm = 2000000;
        private const double MaxPitch = Math.PI / 2 - 0.0175;      // ~89°

        public SimVec Target { get; set; }
        public double Distance { get; set; } = 8000;
        public double Yaw { get; set; } = -Math.PI * 0.75;
        public double Pitch { get; set; } = 0.55;
        /// <summary>true = орто (дээрээс/хажуугаас тодорхой хэмжээ харахад).</summary>
        public bool Ortho { get; set; }
        /// <summary>Хэвтээ харах өнцөг (градус) — WPF-ийн `FieldOfView`.</summary>
        public double FovDeg { get; set; } = 45;

        public SimVec Position { get; private set; }
        public SimVec Forward { get; private set; }
        public SimVec Right { get; private set; }
        public SimVec Up { get; private set; }

        public SimCamera() { Recompute(); }

        public double HalfTan { get { return Math.Tan(FovDeg * Math.PI / 360.0); } }

        /// <summary>Ортод харагдах ХЭВТЭЭ өргөн (мм) — перспективтэй ижил хүрээг (Target-д) хадгална.</summary>
        public double OrthoWidth { get { return 2 * Distance * HalfTan; } }

        public double Near { get { return Math.Max(5, Distance * 0.01); } }
        public double Far { get { return Distance * 40 + 1000000; } }

        public void Recompute()
        {
            Pitch = Math.Max(-MaxPitch, Math.Min(MaxPitch, Pitch));
            Distance = Math.Max(MinDistanceMm, Math.Min(MaxDistanceMm, Distance));
            double cp = Math.Cos(Pitch), sp = Math.Sin(Pitch);
            var dirFromTarget = new SimVec(cp * Math.Cos(Yaw), cp * Math.Sin(Yaw), sp);
            Position = Target + dirFromTarget * Distance;
            Forward = (-dirFromTarget).Normalized();
            var worldUp = new SimVec(0, 0, 1);
            Right = Forward.Cross(worldUp).Normalized();
            if (Right.LengthSq < 1e-12) Right = new SimVec(1, 0, 0);
            Up = Right.Cross(Forward).Normalized();
        }

        /* ============================== ЦАЦРАГ / ТӨСӨӨЛӨЛ =================== */

        /// <summary>Дэлгэцийн (px,py) цэгээс гарах цацраг; w×h = харагдах хэсгийн хэмжээ (пиксел).</summary>
        public SimRay Ray(double px, double py, double w, double h)
        {
            if (w < 1) w = 1;
            if (h < 1) h = 1;
            double nx = 2.0 * px / w - 1.0, ny = 1.0 - 2.0 * py / h;
            double aspect = h / w;
            if (Ortho)
            {
                double half = OrthoWidth / 2;
                SimVec o = Position + Right * (nx * half) + Up * (ny * half * aspect);
                return new SimRay { Origin = o, Dir = Forward };
            }
            double ht = HalfTan;
            SimVec d = Forward + Right * (nx * ht) + Up * (ny * ht * aspect);
            return new SimRay { Origin = Position, Dir = d.Normalized() };
        }

        /// <summary>Дэлхийн цэгийг дэлгэцийн пикселд (хайрцаг/шошго байрлуулахад).  false = камерын ард.</summary>
        public bool Project(SimVec p, double w, double h, out double sx, out double sy)
        {
            sx = sy = 0;
            if (w < 1) w = 1;
            if (h < 1) h = 1;
            SimVec rel = p - Position;
            double z = rel.Dot(Forward);
            double aspect = h / w;
            double nx, ny;
            if (Ortho)
            {
                double half = OrthoWidth / 2;
                nx = rel.Dot(Right) / half;
                ny = rel.Dot(Up) / (half * aspect);
            }
            else
            {
                if (z <= 1e-6) return false;
                double ht = HalfTan;
                nx = rel.Dot(Right) / (z * ht);
                ny = rel.Dot(Up) / (z * ht * aspect);
            }
            sx = (nx + 1.0) * 0.5 * w;
            sy = (1.0 - ny) * 0.5 * h;
            return true;
        }

        /// <summary>1 пикселд ногдох дэлхийн урт (мм) — `Target`-ийн гүнд.</summary>
        public double MmPerPixel(double w)
        {
            if (w < 1) w = 1;
            return OrthoWidth / w;
        }

        /* ============================== ХӨДӨЛГӨӨН =========================== */

        /// <summary>Орбит: зүүн/баруун → yaw, дээш/доош → pitch (хулганын пикселийн зөрүү).</summary>
        public void Orbit(double dxPx, double dyPx)
        {
            Yaw -= dxPx * 0.0087;
            Pitch += dyPx * 0.0087;
            Recompute();
        }

        /// <summary>Pan: сцен хулганыг дагана.</summary>
        public void Pan(double dxPx, double dyPx, double w)
        {
            double k = MmPerPixel(w);
            Target = Target - Right * (dxPx * k) + Up * (dyPx * k);
            Recompute();
        }

        /// <summary>Дугуй: steps &gt; 0 ойртоно.  Хулганы цэг рүү (px,py) ойртуулна — зөөх элемент рүү хурдан хүрэхэд.</summary>
        public void Zoom(double steps, double px, double py, double w, double h)
        {
            if (Math.Abs(steps) < 1e-9) return;
            SimRay before = Ray(px, py, w, h);
            // Хулганы цацрагийн Target-ийн гүн дэх цэг — zoom-ын дараа ч тэр цэг хулганы доор байхаар Target-ийг зөөнө.
            double tPlane = Intersect(before, Target, Forward);
            SimVec anchor = double.IsNaN(tPlane) ? Target : before.At(tPlane);
            Distance *= Math.Pow(0.86, steps);
            Recompute();
            SimRay after = Ray(px, py, w, h);
            double t2 = Intersect(after, Target, Forward);
            if (!double.IsNaN(t2))
            {
                SimVec anchor2 = after.At(t2);
                Target = Target + (anchor - anchor2);
            }
            Recompute();
        }

        /// <summary>Хайрцгийг бүхлээр харуулна (одоогийн чиглэлээр).</summary>
        public void Fit(SimBox box, double w = 1000, double h = 700)
        {
            if (box.IsEmpty) return;
            Target = box.Center;
            SimVec sz = box.Size;
            double radius = Math.Max(500, 0.5 * Math.Sqrt(sz.X * sz.X + sz.Y * sz.Y + sz.Z * sz.Z));
            double aspect = h / Math.Max(1, w);
            double ht = HalfTan;
            double vt = ht * Math.Min(1, aspect);      // босоо харах өнцөг жижиг үед
            Distance = radius / Math.Max(0.15, Math.Min(ht, vt)) * 1.15;
            Recompute();
        }

        public void SetTopView()
        {
            Pitch = Math.PI / 2 - 0.0175;
            Yaw = -Math.PI / 2;
            Recompute();
        }

        public void SetIsoView()
        {
            Pitch = 0.55;
            Yaw = -Math.PI * 0.75;
            Recompute();
        }

        public bool IsTopDown { get { return Pitch > Math.PI / 2 - 0.05; } }

        /// <summary>Цацраг ба хавтгайн огтлолцол (t).  Зэрэгцээ бол NaN.</summary>
        public static double Intersect(SimRay ray, SimVec planePoint, SimVec planeNormal)
        {
            double denom = ray.Dir.Dot(planeNormal);
            if (Math.Abs(denom) < 1e-9) return double.NaN;
            return (planePoint - ray.Origin).Dot(planeNormal) / denom;
        }
    }
}
