using System;
using System.Collections.Generic;
using System.Linq;

namespace RevitMcpAddin.ChangeImpact.Core
{
    /// <summary>
    /// Хаалганы ХӨДӨЛГӨӨНИЙ ЗАМ (swept envelope) — хостын координат (s, n, z) дахь тэгш өнцөгт хайрцаг.
    ///
    ///   ЭХЛЭЛ  |D|  ═══════ зам ═══════►  |D|  ТӨГСГӨЛ
    ///
    /// ХОЁР ӨӨР АСУУЛТ:
    ///   A. ЗАМЫН нөлөө — «одоогийн ба шинэ байрлалын ХООРОНД юу байна?»  (path)
    ///   B. ЭЦСИЙН БАЙРЛАЛЫН нөлөө — «хаалга үнэхээр тэнд очвол юу болох вэ?»  (final)
    /// Эдгээр нь ӨӨР: зам дээрх элемент эцсийн байрлалд огтлолцохгүй байж болно.
    ///
    /// ⚠️ ЭНЭ НЬ ӨРГӨН ШАТ (broad phase): bounding box-ын давхцал нь ХЭЗЭЭ Ч ганцаараа «батлагдсан clash» БИШ.  Зөвхөн «нэр дэвшигч».
    /// Эцсийн дүгнэлтийг sandbox-ын БОДИТ геометр (GeometryVerifier) шийднэ.
    /// </summary>
    public sealed class SweepEnvelope
    {
        public double S0 { get; set; }
        public double S1 { get; set; }
        public double HalfWidthMm { get; set; }
        public double NMin { get; set; }
        public double NMax { get; set; }
        public double ZMin { get; set; }
        public double ZMax { get; set; }

        public double StartLo { get { return S0 - HalfWidthMm; } }
        public double StartHi { get { return S0 + HalfWidthMm; } }
        public double FinalLo { get { return S1 - HalfWidthMm; } }
        public double FinalHi { get { return S1 + HalfWidthMm; } }
        public double PathLo { get { return Math.Min(S0, S1) - HalfWidthMm; } }
        public double PathHi { get { return Math.Max(S0, S1) + HalfWidthMm; } }
    }

    public sealed class SweepHit
    {
        public ObstacleBox Obstacle { get; set; }
        /// <summary>Хаалга ОДООГИЙН байрлалдаа аль хэдийн энэ элементтэй хайрцгаар давхцаж байна (өмнө нь ч байсан).</summary>
        public bool AtStart { get; set; }
        /// <summary>Шинэ (эцсийн) байрлалд хайрцгаар давхцана.</summary>
        public bool AtFinal { get; set; }
        /// <summary>Зам (эхлэл ∪ төгсгөл ∪ хоорондох) хүрээнд.</summary>
        public bool InPath { get; set; }
        /// <summary>Эцсийн байрлалд хост дагуух давхцлын урт (мм).</summary>
        public double FinalOverlapMm { get; set; }

        /// <summary>ШИНЭ нэр дэвшигч: өмнө нь давхцаагүй, эцсийн байрлалд давхцана.</summary>
        public bool IsNewFinal { get { return AtFinal && !AtStart; } }
        /// <summary>Зөвхөн замд (эцсийн байрлалд биш, одоо ч биш).</summary>
        public bool IsPathOnly { get { return InPath && !AtFinal && !AtStart; } }
    }

    public static class DoorSweep
    {
        /// <summary>Хаалганы (өмнөх ба шинэ) хайрцаг — хостын координатад.  `ctx.Door` бөглөгдсөн байх ёстой.</summary>
        public static SweepEnvelope Envelope(DoorMoveContext ctx, double offsetMm)
        {
            DoorBody d = ctx.Door;
            double depth = d.DepthMm > 0 ? d.DepthMm : ctx.Host.ThicknessMm;
            double half = DoorHostMath.HalfWidth(d);
            double zMin = d.ZMinMm, zMax = d.ZMaxMm;
            if (zMax <= zMin) { zMin = ctx.Host.ZMinMm; zMax = ctx.Host.ZMaxMm; }
            return new SweepEnvelope
            {
                S0 = d.CenterParamMm,
                S1 = d.CenterParamMm + offsetMm,
                HalfWidthMm = half,
                NMin = d.CenterNormalMm - depth / 2.0,
                NMax = d.CenterNormalMm + depth / 2.0,
                ZMin = zMin,
                ZMax = zMax,
            };
        }

        /// <summary>Хайрцгийг (мм, AABB) хостын координат руу: [sMin, nMin, zMin, sMax, nMax, zMax] — эргэсэн хайрцгийн ХАМГААЛАХ (conservative) AABB.</summary>
        public static double[] LocalBox(HostGeometry h, double[] box)
        {
            if (box == null || box.Length < 6) return null;
            double sMin = double.MaxValue, sMax = double.MinValue, nMin = double.MaxValue, nMax = double.MinValue;
            for (int i = 0; i < 4; i++)
            {
                double x = (i & 1) == 0 ? box[0] : box[3];
                double y = (i & 2) == 0 ? box[1] : box[4];
                double s, n;
                DoorHostMath.Local(h, x, y, out s, out n);
                if (s < sMin) sMin = s;
                if (s > sMax) sMax = s;
                if (n < nMin) nMin = n;
                if (n > nMax) nMax = n;
            }
            return new[] { sMin, nMin, Math.Min(box[2], box[5]), sMax, nMax, Math.Max(box[2], box[5]) };
        }

        private static bool Hits(SweepEnvelope e, double sLo, double sHi, double[] lb, out double sOverlap)
        {
            double tol = PreChangeTolerance.LengthMm;
            sOverlap = DoorHostMath.Overlap(sLo, sHi, lb[0], lb[3]);
            if (sOverlap <= tol) return false;
            if (DoorHostMath.Overlap(e.NMin, e.NMax, lb[1], lb[4]) <= tol) return false;
            if (DoorHostMath.Overlap(e.ZMin, e.ZMax, lb[2], lb[5]) <= tol) return false;
            return true;
        }

        /// <summary>
        /// Бүх нэр дэвшигчийг (хайрцгаар) шалгана.  Хост өөрөө, хаалга өөрөө хасагдсан гэж үзнэ (context-д орохгүй).
        /// Эрэмбэ тодорхойлогдсон (түлхүүрээр).  Хурдан: нэр дэвшигч бүрт 8 тоон үйлдэл.
        /// </summary>
        public static List<SweepHit> Scan(DoorMoveContext ctx, double offsetMm)
        {
            var hits = new List<SweepHit>();
            if (ctx == null || ctx.Host == null || ctx.Door == null) return hits;
            SweepEnvelope env = Envelope(ctx, offsetMm);
            var seen = new HashSet<string>(StringComparer.Ordinal);
            foreach (ObstacleBox o in ctx.Obstacles)
            {
                if (o == null || o.BoxMm == null) continue;
                if (!seen.Add(o.Key)) continue;       // ижил элемент хоёр удаа (давхардсан нэр дэвшигч) нэг л мөр өгнө
                if (o.Id == ctx.Host.Id && o.LinkInstanceId == 0) continue;
                if (o.Id == ctx.Door.Id && o.LinkInstanceId == 0) continue;
                double[] lb = LocalBox(ctx.Host, o.BoxMm);
                if (lb == null) continue;

                double ovStart, ovFinal, ovPath;
                bool atStart = Hits(env, env.StartLo, env.StartHi, lb, out ovStart);
                bool atFinal = Hits(env, env.FinalLo, env.FinalHi, lb, out ovFinal);
                bool inPath = Hits(env, env.PathLo, env.PathHi, lb, out ovPath);
                if (!atStart && !atFinal && !inPath) continue;
                hits.Add(new SweepHit { Obstacle = o, AtStart = atStart, AtFinal = atFinal, InPath = inPath, FinalOverlapMm = atFinal ? ovFinal : 0 });
            }
            return hits.OrderBy(h => h.Obstacle.Key, StringComparer.Ordinal).ToList();
        }
    }
}
