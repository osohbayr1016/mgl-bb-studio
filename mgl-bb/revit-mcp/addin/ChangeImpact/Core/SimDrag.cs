using System;

namespace RevitMcpAddin.ChangeImpact.Core
{
    public enum SimDragMode
    {
        /// <summary>Хавтгайд (X,Y) чөлөөтэй.</summary>
        Plane = 0,
        /// <summary>Нэг тэнхлэгийн дагуу (X эсвэл Y — хулганыг аль руу нь илүү хөдөлгөснөөр).</summary>
        Axis,
        /// <summary>Зөвхөн босоо (Z).</summary>
        Vertical,
    }

    /// <summary>
    /// Хулганаар элемент барьж зөөх — ЦЭВЭР математик.  Элементийн барьсан цэгийг (grab) дайрсан хавтгайг камерын цацрагаар огтолж, хулганы шилжилтийг дэлхийн мм болгоно.
    /// Хязгаарлалт: хавтгай / нэг тэнхлэг / босоо / ШУГАМЫН дагуу (хананд суурилсан хаалга, цонх).  Алхамд (grid) тохируулна.
    /// Элементийг ХЭЗЭЭ Ч Revit-д зөөхгүй — зөвхөн шинэ `Offset` буцаана (мм, анхны байрлалаас).
    /// </summary>
    public sealed class SimDragSession
    {
        /// <summary>Тэнхлэг түгжих босго (мм): хулганыг энэ хэмжээнээс их хөдөлгөсний дараа аль тэнхлэг дундаж болохыг түгжинэ.</summary>
        public const double AxisLatchMm = 40;
        /// <summary>Нэг барилтын дээд зай (мм) — камер бараг хэвтээ үед цацраг хавтгайг хол огтолж «үсрэхээс» хамгаална.</summary>
        public const double MaxReachMm = 200000;

        private readonly SimVec _grab;
        private readonly SimVec _start;
        private readonly SimVec _planeNormal;
        private readonly SimDragMode _mode;
        private readonly double[] _line;
        private readonly double _step;
        private int _latched;            // 0 = үгүй, 1 = X, 2 = Y

        public SimVec Offset { get; private set; }
        public bool Moved { get; private set; }

        private SimDragSession(SimVec grab, SimVec startOffset, SimVec planeNormal, SimDragMode mode, double[] lineXY, double stepMm)
        {
            _grab = grab; _start = startOffset; _planeNormal = planeNormal; _mode = mode;
            _line = lineXY; _step = stepMm;
            Offset = startOffset;
        }

        /// <summary>
        /// Барилт эхлүүлнэ.  `grab` = хулганы цацраг зөөгдөж буй элементийг цохисон ДЭЛХИЙН цэг (одоогийн, шилжсэн байрлалд).
        /// `lineXY` != null бол ЗӨВХӨН энэ нэгж чиглэлийн (x,y) дагуу.  null буцаавал барих боломжгүй (босоо чирэлт дээрээс харах камер).
        /// </summary>
        public static SimDragSession Begin(SimCamera cam, SimVec grab, SimVec currentOffset, SimDragMode mode, double[] lineXY, double stepMm)
        {
            SimVec normal;
            if (mode == SimDragMode.Vertical)
            {
                // Камерыг харсан босоо хавтгай.
                var h = new SimVec(-cam.Forward.X, -cam.Forward.Y, 0);
                if (h.LengthSq < 0.01) return null;            // (бараг) дээрээс харж байна (~84° ба түүнээс дээш) — босоо чирэх чиглэл найдваргүй
                normal = h.Normalized();
            }
            else normal = new SimVec(0, 0, 1);

            double[] line = null;
            if (lineXY != null && lineXY.Length >= 2)
            {
                double l = Math.Sqrt(lineXY[0] * lineXY[0] + lineXY[1] * lineXY[1]);
                if (l > 1e-9) line = new[] { lineXY[0] / l, lineXY[1] / l };
            }
            return new SimDragSession(grab, currentOffset, normal, mode, line, stepMm);
        }

        /// <summary>Хулганы шинэ цацрагаар шинэ шилжилт.  false = цацраг хавтгайг огтолсонгүй (өмнөх утга хэвээр).</summary>
        public bool Update(SimRay ray)
        {
            double t = SimCamera.Intersect(ray, _grab, _planeNormal);
            if (double.IsNaN(t) || t < 0) return false;
            SimVec p = ray.At(t);
            SimVec delta = p - _grab;
            if (delta.Length > MaxReachMm) return false;

            SimVec d;
            if (_mode == SimDragMode.Vertical) d = new SimVec(0, 0, delta.Z);
            else if (_line != null)
            {
                double along = delta.X * _line[0] + delta.Y * _line[1];
                d = new SimVec(_line[0] * along, _line[1] * along, 0);
            }
            else if (_mode == SimDragMode.Axis)
            {
                if (_latched == 0)
                {
                    if (Math.Abs(delta.X) >= AxisLatchMm || Math.Abs(delta.Y) >= AxisLatchMm) _latched = Math.Abs(delta.X) >= Math.Abs(delta.Y) ? 1 : 2;
                }
                int axis = _latched != 0 ? _latched : (Math.Abs(delta.X) >= Math.Abs(delta.Y) ? 1 : 2);
                d = axis == 1 ? new SimVec(delta.X, 0, 0) : new SimVec(0, delta.Y, 0);
            }
            else d = new SimVec(delta.X, delta.Y, 0);

            SimVec next = Snap(_start + d, _step);
            if (!next.IsFinite) return false;
            if (next.X != Offset.X || next.Y != Offset.Y || next.Z != Offset.Z) Moved = true;
            Offset = next;
            return true;
        }

        public static SimVec Snap(SimVec v, double stepMm)
        {
            if (stepMm <= 0) return v;
            return new SimVec(Math.Round(v.X / stepMm) * stepMm, Math.Round(v.Y / stepMm) * stepMm, Math.Round(v.Z / stepMm) * stepMm);
        }
    }

    /// <summary>Хулганы цацрагаар зөөгдөж буй / орчны элементийг сонгох.</summary>
    public static class SimPick
    {
        public sealed class Result
        {
            public bool IsMoving;
            public string Key;
            public double T;
            public SimVec Point;
        }

        /// <summary>Хамгийн ойр цохисон элемент.  Зөөгдөж буй нь `offset`-оор шилжсэн байрлалд.</summary>
        public static Result Nearest(SimScene scene, SimVec offset, SimRay ray, bool includeContext = true)
        {
            Result best = null;
            if (scene == null) return null;
            foreach (SimMesh m in scene.Moving)
            {
                double t; int tri;
                var local = new SimRay { Origin = ray.Origin - offset, Dir = ray.Dir };
                if (m.Bvh.RayFirst(local.Origin, local.Dir, out t, out tri) && (best == null || t < best.T))
                    best = new Result { IsMoving = true, Key = m.Key, T = t, Point = ray.At(t) };
            }
            if (!includeContext) return best;
            foreach (SimMesh m in scene.Context)
            {
                double t; int tri;
                if (m.Bvh.RayFirst(ray.Origin, ray.Dir, out t, out tri) && (best == null || t < best.T))
                    best = new Result { IsMoving = false, Key = m.Key, T = t, Point = ray.At(t) };
            }
            return best;
        }

        public static Result Moving(SimScene scene, SimVec offset, SimRay ray)
        {
            return Nearest(scene, offset, ray, false);
        }
    }
}
