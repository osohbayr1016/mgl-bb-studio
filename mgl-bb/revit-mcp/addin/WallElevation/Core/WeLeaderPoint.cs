using System;
using System.Collections.Generic;

namespace RevitMcpAddin.WallElevation.Core
{
    /// <summary>
    /// Материалын тэмдэглэлийн заагчийн ТӨГСГӨЛ: ханын харагдах НҮҮРЭН дээр (нүүрний хүрээ — нүх, завсар хасагдсан), өмнө нь харагдах
    /// элементүүдээс (хаалга, тавилга …) зайтай.  ХЭМЖСЭН (GATEWAY 310F, 2026-10-07): гипсэн ханын заагч хажуугийн шилэн ханын хаалганы
    /// нүхэн дээр буусан — хана тэнд байхгүй (хоёр ханын завсар), хаалга нь тэр ханын insert биш.  Revit-гүй, тесттэй.
    /// </summary>
    public static class WeLeaderPoint
    {
        /// <param name="obstacles">Саад {x0, y0, x1, y1, …}.</param>
        /// <param name="loops">Ханын нүүрний хүрээнүүд — тус бүр {x0, y0, x1, y1, …} олон өнцөгт; дотор = тэгш-сондгой дүрмээр.  Хоосон = хязгааргүй.</param>
        /// <returns>Зай (want хүртэл); 0 = тохирох цэг олдсонгүй (хүссэн цэгийг буцаана).</returns>
        public static double Find(double x0, double x1, double y0, double y1, double px, double py, IList<double[]> obstacles, IList<double[]> loops,
                                  double want, out double ex, out double ey)
        {
            ex = px; ey = py;
            bool surface = loops != null && loops.Count > 0;
            Func<double, double, double> score = (x, y) =>
            {
                if (surface && !Inside(loops, x, y)) return -1;
                double m = want;
                if (obstacles != null)
                    foreach (double[] o in obstacles)
                    {
                        bool inside = x > o[0] && x < o[2] && y > o[1] && y < o[3];
                        double dx = Math.Max(Math.Max(o[0] - x, x - o[2]), 0), dy = Math.Max(Math.Max(o[1] - y, y - o[3]), 0);
                        m = Math.Min(m, inside ? 0 : Math.Sqrt(dx * dx + dy * dy));
                    }
                if (surface) m = Math.Min(m, EdgeDistance(loops, x, y));
                return m;
            };
            double best = score(px, py), bestD = 0;
            if (best >= want - 1e-9) return best;
            double ya = y0 + (y1 - y0) * 0.05, yb = y1 - (y1 - y0) * 0.05;
            const int NX = 24, NY = 16;
            for (int i = 0; i <= NX; i++)
                for (int j = 0; j <= NY; j++)
                {
                    double x = x0 + (x1 - x0) * i / NX, y = ya + (yb - ya) * j / NY;
                    double c = score(x, y), d = Math.Abs(x - px) + Math.Abs(y - py) * 0.5;
                    if (c > best + 1e-9 || Math.Abs(c - best) <= 1e-9 && c >= 0 && d < bestD - 1e-9) { best = c; bestD = d; ex = x; ey = y; }
                }
            if (best < 0) { ex = px; ey = py; return 0; }
            return best;
        }

        /// <summary>Тэгш-сондгой дүрмээр: цэг хэдэн хүрээний дотор (сондгой = нүүрэн дээр).</summary>
        public static bool Inside(IList<double[]> loops, double x, double y)
        {
            bool inside = false;
            foreach (double[] p in loops)
            {
                int n = p.Length / 2;
                for (int i = 0, j = n - 1; i < n; j = i++)
                {
                    double xi = p[2 * i], yi = p[2 * i + 1], xj = p[2 * j], yj = p[2 * j + 1];
                    if ((yi > y) != (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
                }
            }
            return inside;
        }

        /// <summary>Хүрээний хамгийн ойр ирмэг хүртэлх зай.</summary>
        public static double EdgeDistance(IList<double[]> loops, double x, double y)
        {
            double m = double.MaxValue;
            foreach (double[] p in loops)
            {
                int n = p.Length / 2;
                for (int i = 0, j = n - 1; i < n; j = i++)
                {
                    double ax = p[2 * j], ay = p[2 * j + 1], bx = p[2 * i], by = p[2 * i + 1];
                    double vx = bx - ax, vy = by - ay, l2 = vx * vx + vy * vy;
                    double t = l2 > 1e-18 ? Math.Max(0, Math.Min(1, ((x - ax) * vx + (y - ay) * vy) / l2)) : 0;
                    double dx = ax + vx * t - x, dy = ay + vy * t - y;
                    m = Math.Min(m, Math.Sqrt(dx * dx + dy * dy));
                }
            }
            return m;
        }
    }
}
