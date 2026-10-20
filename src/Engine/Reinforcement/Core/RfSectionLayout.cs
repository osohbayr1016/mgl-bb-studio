using System;
using System.Collections.Generic;
using System.Linq;

namespace RevitMcpAddin.Reinforcement.Core
{
    /// <summary>Тэнхлэгт зэрэгцээ хайрцаг (tag, хэмжээсийн бичвэр) — давхцал шалгахад.</summary>
    public struct RfBox
    {
        public double MinX, MinY, MaxX, MaxY;

        public RfBox(double minX, double minY, double maxX, double maxY)
        {
            MinX = minX; MinY = minY; MaxX = maxX; MaxY = maxY;
        }

        public static RfBox Around(RfV2 center, double w, double h)
        {
            return new RfBox(center.X - w / 2, center.Y - h / 2, center.X + w / 2, center.Y + h / 2);
        }

        /// <summary>Хоёр хайрцаг <paramref name="gap"/>-аас бага зайтай (эсвэл давхцсан).</summary>
        public bool Overlaps(RfBox o, double gap)
        {
            return MinX < o.MaxX + gap && o.MinX < MaxX + gap && MinY < o.MaxY + gap && o.MinY < MaxY + gap;
        }
    }

    /// <summary>
    /// Tag-ийн ЗАРЧМЫН (rule-based) байрлуулалт — AI биш, урьдчилан таамаглах боломжтой:
    /// тал сонгох → талын дагуу эрэмбэлэх → слот өгөх → хамгийн бага зай → давхцахыг гадагш түлхэх.
    /// Бүгд Revit-гүй (локал координатад), тест хийх боломжтой.
    /// </summary>
    public static class RfSectionLayout
    {
        /// <summary>
        /// Нэг тэнхлэг дээр хайрцгуудыг хоорондын зайтай болгож тарааж өгнө (label spreading): хүссэн байрлалуудаас
        /// хамгийн бага нийт хазайлтаар, дараалал хадгалагдана, зай нь хамгийн багадаа <paramref name="gap"/>.
        /// </summary>
        /// <param name="desired">Хүссэн төвийн байрлал (дур зоргын дараалалтай).</param>
        /// <param name="size">Тэнхлэгийн дагуух хайрцгийн хэмжээ.</param>
        public static double[] Spread(double[] desired, double[] size, double gap)
        {
            int n = desired.Length;
            var result = new double[n];
            if (n == 0) return result;

            int[] order = Enumerable.Range(0, n).OrderBy(i => desired[i]).ToArray();
            var clusters = new List<Cluster>();
            for (int k = 0; k < n; k++)
            {
                var c = new Cluster { First = k, Last = k };
                c.Fit(order, desired, size, gap);
                clusters.Add(c);
                while (clusters.Count > 1)
                {
                    Cluster a = clusters[clusters.Count - 2];
                    Cluster b = clusters[clusters.Count - 1];
                    if (b.Low >= a.High + gap - 1e-12) break;
                    a.Last = b.Last;
                    a.Fit(order, desired, size, gap);
                    clusters.RemoveAt(clusters.Count - 1);
                }
            }

            foreach (Cluster c in clusters)
            {
                double off = 0;
                for (int k = c.First; k <= c.Last; k++)
                {
                    int i = order[k];
                    if (k > c.First) off += size[order[k - 1]] / 2 + gap + size[i] / 2;
                    result[i] = c.Center + off;
                }
            }
            return result;
        }

        private sealed class Cluster
        {
            public int First, Last;
            public double Center;
            public double Low, High;

            public void Fit(int[] order, double[] desired, double[] size, double gap)
            {
                double off = 0, sum = 0;
                int count = 0;
                double lastOff = 0;
                for (int k = First; k <= Last; k++)
                {
                    int i = order[k];
                    if (k > First) off += size[order[k - 1]] / 2 + gap + size[i] / 2;
                    sum += desired[i] - off;
                    count++;
                    lastOff = off;
                }
                Center = sum / count;
                Low = Center - size[order[First]] / 2;
                High = Center + lastOff + size[order[Last]] / 2;
            }
        }

        /// <summary>
        /// Сумны (tag-ийн зорилтот цэгийн) тал: гишүүний төвөөс хамгийн «гадагш» хазайсан тэнхлэгээр
        /// (хагас өргөн/өндрөөр нормчилсон).
        /// </summary>
        public static RfSide SideOf(RfSectionRect rect, RfV2 target)
        {
            double hu = Math.Max(rect.Width / 2, 1e-9);
            double hv = Math.Max(rect.Height / 2, 1e-9);
            double nu = (target.X - rect.Center.X) / hu;
            double nv = (target.Y - rect.Center.Y) / hv;
            if (Math.Abs(nu) >= Math.Abs(nv)) return nu < 0 ? RfSide.Left : RfSide.Right;
            return nv < 0 ? RfSide.Bottom : RfSide.Top;
        }

        /// <summary>
        /// Tag-уудын толгойн байрлал.  <paramref name="seeds"/>-д Id, Target, IsStirrup, BarIndex бөглөгдсөн байна.
        /// </summary>
        /// <param name="topExtra">Дээд талд нэмэлт гадагш зай (Зүүн/Баруун хэмжээсийн шугам дээр байгаа бол).</param>
        /// <param name="rightExtra">Баруун талд нэмэлт гадагш зай (Дээд/Доод хэмжээсийн шугам баруун талд бол).</param>
        /// <param name="overlapRemains">Давхцлыг бүрэн арилгаж чадаагүй эсэх.</param>
        public static List<RfTagPlan> LayoutTags(RfSectionRect rect, RfSectionFrame frame, IList<RfTagPlan> seeds, RfSectionOptions o,
            double topExtra, double rightExtra, out bool overlapRemains)
        {
            return LayoutTags(rect, frame, seeds, o, topExtra, rightExtra, 0, 0, out overlapRemains);
        }

        /// <summary>4 талын нэмэлт гадагш зайтай хувилбар — хэмжээсийн шугам хэрэглэгчийн сонгосон (Доод/Зүүн ч) талд байж болно (2026-10-09).</summary>
        public static List<RfTagPlan> LayoutTags(RfSectionRect rect, RfSectionFrame frame, IList<RfTagPlan> seeds, RfSectionOptions o,
            double topExtra, double rightExtra, double bottomExtra, double leftExtra, out bool overlapRemains)
        {
            overlapRemains = false;
            var plans = new List<RfTagPlan>();

            // ⚠️ Tag-ийн бичвэр ХЭВТЭЭ (харагдацад), харин байрлуулалт гишүүний ЛОКАЛ тэнхлэгт.  Эргэсэн гишүүнд
            // хэвтээ W×H хайрцаг локал тэнхлэгт илүү том (эргэсэн хайрцгийн bounding) хэмжээтэй харагдана — үүнийг
            // консерватив (давхцахгүй) хэмжээ болгож ашиглана.
            double lw = LocalExtentU(frame, o.TagWidthFt, o.TagHeightFt);
            double lh = LocalExtentV(frame, o.TagWidthFt, o.TagHeightFt);
            foreach (RfTagPlan s in seeds)
            {
                var p = new RfTagPlan
                {
                    Id = s.Id,
                    IsStirrup = s.IsStirrup,
                    BarIndex = s.BarIndex,
                    GroupCount = s.GroupCount,
                    BarIndices = s.BarIndices,
                    BarTargets = s.BarTargets,
                    Target = s.Target,
                    Side = SideOf(rect, s.Target),
                    Width = o.TagWidthFt,
                    Height = o.TagHeightFt,
                    LocalWidth = lw,
                    LocalHeight = lh,
                };
                plans.Add(p);
            }

            foreach (RfSide side in new[] { RfSide.Left, RfSide.Right, RfSide.Top, RfSide.Bottom })
            {
                List<RfTagPlan> group = plans.Where(p => p.Side == side).ToList();
                if (group.Count == 0) continue;

                bool vertical = side == RfSide.Left || side == RfSide.Right; // тал босоо → tag-ууд v дагуу эгнэнэ
                double[] desired = group.Select(p => vertical ? p.Target.Y : p.Target.X).ToArray();
                // Эгнэх чиглэл (локал U/V) харагдацад хэрхэн харагдахаар хэвтээ хайрцгууд ЯГ давхцахгүй төвийн зай.
                double pitch = StackPitch(o.TagWidthFt, o.TagHeightFt, vertical ? frame.V : frame.U);
                double[] size = group.Select(p => pitch).ToArray();
                double[] pos = Spread(desired, size, o.TagGapFt);

                for (int i = 0; i < group.Count; i++)
                {
                    RfTagPlan p = group[i];
                    double across;
                    switch (side)
                    {
                        case RfSide.Left: across = rect.MinU - o.TagOutFt - leftExtra - p.LocalWidth / 2; break;
                        case RfSide.Right: across = rect.MaxU + o.TagOutFt + rightExtra + p.LocalWidth / 2; break;
                        case RfSide.Top: across = rect.MaxV + o.TagOutFt + topExtra + p.LocalHeight / 2; break;
                        default: across = rect.MinV - o.TagOutFt - bottomExtra - p.LocalHeight / 2; break;
                    }
                    p.Head = vertical ? new RfV2(across, pos[i]) : new RfV2(pos[i], across);
                }
            }

            overlapRemains = !ResolveCollisions(rect, frame, plans, o);
            return plans;
        }

        /// <summary>
        /// Ижил хэмжээтэй хоёр ХЭВТЭЭ (харагдацад) w×h хайрцгийг <paramref name="axisInView"/> чиглэлийн дагуу яг
        /// давхцахгүй байлгах хамгийн бага ТӨВИЙН зай: |dx| ≥ w эсвэл |dy| ≥ h ⇒ d ≥ min(w/|ax|, h/|ay|).
        /// Тэнхлэг хэвтээ бол w, босоо бол h; 45° дээр хоёр хайрцаг диагоналаар шаталж, bounding-оос ХОЁР дахин нягт.
        /// </summary>
        public static double StackPitch(double w, double h, RfV2 axisInView)
        {
            double ax = Math.Abs(axisInView.X), ay = Math.Abs(axisInView.Y);
            double bx = ax < 1e-9 ? double.PositiveInfinity : w / ax;
            double by = ay < 1e-9 ? double.PositiveInfinity : h / ay;
            return Math.Min(bx, by);
        }

        /// <summary>Хэвтээ w×h хайрцгийн гишүүний U тэнхлэгийн дагуух хэмжээ (консерватив bounding).</summary>
        public static double LocalExtentU(RfSectionFrame f, double w, double h)
        {
            return w * Math.Abs(f.U.X) + h * Math.Abs(f.U.Y);
        }

        /// <summary>Хэвтээ w×h хайрцгийн гишүүний V тэнхлэгийн дагуух хэмжээ (консерватив bounding).</summary>
        public static double LocalExtentV(RfSectionFrame f, double w, double h)
        {
            return w * Math.Abs(f.V.X) + h * Math.Abs(f.V.Y);
        }

        /// <summary>
        /// Өөр талын tag-ууд (булан дээр) болон бетон хүрээтэй давхцсаныг гадагш түлхэж арилгана.  Давхцлыг ХАРАГДАЦЫН
        /// координатад ЯГ шалгана: tag хэвтээ W×H, бетон гишүүний тэнхлэгээр эргэсэн тэгш өнцөгт (SAT).  Бүх давхцал
        /// арилбал true.
        ///
        /// ⚠️ Локал тэнхлэгт «bounding» хайрцгаар шалгаж БОЛОХГҮЙ: эргэсэн гишүүнд хэвтээ хайрцгууд диагоналаар шаталж
        /// давхцахгүй байж болох бөгөөд bounding-аар түлхэх нь тэр шатлалыг эвдэж ЭСРЭГЭЭР давхцуулдаг (тестээр барьсан).
        /// </summary>
        public static bool ResolveCollisions(RfSectionRect rect, RfSectionFrame frame, IList<RfTagPlan> plans, RfSectionOptions o)
        {
            RfV2 rc = frame.ToView(rect.Center);
            double a = rect.Width / 2, b = rect.Height / 2;
            double step = Math.Max(o.TagGapFt, 0.005);
            for (int iter = 0; iter < 60; iter++)
            {
                bool moved = false;
                for (int i = 0; i < plans.Count; i++)
                {
                    RfV2 hi = frame.ToView(plans[i].Head);
                    if (BoxHitsRect(hi, plans[i].Width, plans[i].Height, rc, frame.U, frame.V, a, b))
                    {
                        Push(plans[i], rect, step);
                        moved = true;
                        continue;
                    }
                    for (int j = i + 1; j < plans.Count; j++)
                    {
                        RfV2 hj = frame.ToView(plans[j].Head);
                        bool overlap = Math.Abs(hi.X - hj.X) < (plans[i].Width + plans[j].Width) / 2 - 1e-9
                                    && Math.Abs(hi.Y - hj.Y) < (plans[i].Height + plans[j].Height) / 2 - 1e-9;
                        if (!overlap) continue;
                        Push(plans[j], rect, step);
                        moved = true;
                    }
                }
                if (!moved) return true;
            }
            return false;
        }

        /// <summary>Хэвтээ (харагдацад) bw×bh хайрцаг, u/v тэнхлэгтэй a×b хагас хэмжээт эргэсэн тэгш өнцөгттэй давхцах уу (SAT).</summary>
        public static bool BoxHitsRect(RfV2 boxCenter, double bw, double bh, RfV2 rc, RfV2 u, RfV2 v, double a, double b)
        {
            RfV2[] axes = { new RfV2(1, 0), new RfV2(0, 1), u, v };
            foreach (RfV2 ax in axes)
            {
                double c1 = boxCenter.Dot(ax), r1 = bw / 2 * Math.Abs(ax.X) + bh / 2 * Math.Abs(ax.Y);
                double c2 = rc.Dot(ax), r2 = a * Math.Abs(u.Dot(ax)) + b * Math.Abs(v.Dot(ax));
                if (Math.Abs(c1 - c2) >= r1 + r2) return false; // тусгаарлах тэнхлэг олдлоо
            }
            return true;
        }

        private static void Push(RfTagPlan p, RfSectionRect rect, double step)
        {
            double d = Math.Max(step, 0.01);
            switch (p.Side)
            {
                case RfSide.Left: p.Head = new RfV2(p.Head.X - d, p.Head.Y); break;
                case RfSide.Right: p.Head = new RfV2(p.Head.X + d, p.Head.Y); break;
                case RfSide.Top: p.Head = new RfV2(p.Head.X, p.Head.Y + d); break;
                default: p.Head = new RfV2(p.Head.X, p.Head.Y - d); break;
            }
        }
    }
}
