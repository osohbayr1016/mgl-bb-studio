using System;
using System.Collections.Generic;
using System.Linq;

namespace MglBb.Core
{
    /// <summary>Огтлол дээрх арматурын үүрэг: дээд / доод үеийн ажлын арматур, бөөрний (завсрын эгнээ ба хажуугийн) арматур, хомут.</summary>
    public enum BbBarRole { Top, Bottom, Side, Stirrup }

    /// <summary>
    /// Дамнурууны огтлолын шошгыг ҮҮРГЭЭР байрлуулах цэвэр математик (харагдацын хүрээ r = баруун, u = дээш; ямар ч нэгж).  ЖИШЭЭ-2 «ОГТЛОЛ 2-2»:
    /// бүх шошго зүүн талд нэг баганад, шошго бүр ӨӨРИЙН арматурын өндрийн орчимд («9 ⌀28» дээд эгнээнээс дээш, «11 ⌀28» дээд 2-р эгнээ, «14 ⌀12» × 2
    /// бөөр, «21 ⌀8x100» хомут, «6 ⌀28» доод эгнээ).  Толгой = тал + <c>dx</c> (гишүүний хажуу нүүрнээс гадагш) + <c>dy</c> (арматурын өндрөөс дээш).
    /// </summary>
    public static class BbTagRoles
    {
        public const string Left = "left", Right = "right";

        /// <summary>
        /// Эгнээгээр: хомут — хэлбэрийн төрлөөр; харагдацын ажлын арматурын ХАМГИЙН ДЭЭД эгнээ (<paramref name="uTop"/> ± <paramref name="tol"/>,
        /// гишүүний дээд хагаст) → дээд, ХАМГИЙН ДООД эгнээ (доод хагаст) → доод, бусад (дээд 2-р эгнээ, бөөр) → бөөр.
        /// </summary>
        public static BbBarRole Classify(bool stirrup, double u, double uTop, double uBottom, double u0, double u1, double tol)
        {
            if (stirrup) return BbBarRole.Stirrup;
            double mid = (u0 + u1) / 2;
            if (Math.Abs(u - uTop) <= tol && uTop >= mid) return BbBarRole.Top;
            if (Math.Abs(u - uBottom) <= tol && uBottom <= mid) return BbBarRole.Bottom;
            return BbBarRole.Side;
        }

        /// <summary>Стандартын талбарын нэрний хэсэг: «SecTopTagSide», «SecTopTagDxPaperMm» …</summary>
        public static string Key(BbBarRole r)
        {
            switch (r)
            {
                case BbBarRole.Top: return "Top";
                case BbBarRole.Bottom: return "Bottom";
                case BbBarRole.Side: return "Side";
                default: return "Stirrup";
            }
        }

        public static string Name(BbBarRole r)
        {
            switch (r)
            {
                case BbBarRole.Top: return "дээд үеийн ажлын арматур";
                case BbBarRole.Bottom: return "доод үеийн ажлын арматур";
                case BbBarRole.Side: return "бөөрний арматур";
                default: return "хомут";
            }
        }

        /// <summary>Инженерийн тавьсан шошгоны толгойг хэмжинэ: тал, гаднах зай, арматурын өндрөөс босоо зай.</summary>
        public static void Measure(double headR, double headU, double barU, double r0, double r1, out string side, out double dx, out double dy)
        {
            bool right = headR > (r0 + r1) / 2;
            side = right ? Right : Left;
            dx = right ? headR - r1 : r0 - headR;
            dy = headU - barU;
        }

        /// <summary>Шошгоны толгойн байрлал (давхцалыг <see cref="Separate"/> засна).</summary>
        public static void Target(string side, double dx, double dy, double barU, double r0, double r1, out double hr, out double hu)
        {
            bool right = string.Equals(side, Right, StringComparison.OrdinalIgnoreCase);
            hr = right ? r1 + dx : r0 - dx;
            hu = barU + dy;
        }

        /// <summary>
        /// Нэг талын шошгоны толгойг хоорондоо ≥ <paramref name="gap"/> зайтай болгоно: дээрээс доош, давхцсаныг доош түлхэнэ (хамгийн дээд нь хөдлөхгүй).
        /// Оролтын дарааллаар (индекс) буцаана.
        /// </summary>
        public static double[] Separate(IList<double> hu, double gap)
        {
            var res = hu.ToArray();
            if (gap <= 0) return res;
            int[] order = Enumerable.Range(0, res.Length).OrderByDescending(i => res[i]).ToArray();
            for (int k = 1; k < order.Length; k++)
            {
                double limit = res[order[k - 1]] - gap;
                if (res[order[k]] > limit) res[order[k]] = limit;
            }
            return res;
        }

        /// <summary>Нэг талын толгойнуудын хоорондох ХАМГИЙН БАГА босоо зай (сурахад); 2-оос цөөн бол null.</summary>
        public static double? MinGap(IEnumerable<double> hu)
        {
            var s = hu.OrderBy(x => x).ToList();
            double? best = null;
            for (int i = 1; i < s.Count; i++)
            {
                double d = s[i] - s[i - 1];
                if (d > 1e-9 && (best == null || d < best)) best = d;
            }
            return best;
        }

        /// <summary>Leader-ийн хугарал толгойноос гишүүн рүү <paramref name="landing"/>-ээр (хэвтээ), толгойн өндөрт.</summary>
        public static double ElbowR(string side, double hr, double landing)
        {
            return string.Equals(side, Right, StringComparison.OrdinalIgnoreCase) ? hr - landing : hr + landing;
        }

        /// <summary>Хугарлын (elbow) лавлах цэг: «axis» = гишүүний тэнхлэг (ажлын арматур — ЖИШЭЭ-2 засвар), «end» = leader-ийн төгсгөл (хомутын хөл).</summary>
        public const string ElbowAxis = "axis", ElbowEnd = "end";

        /// <summary>Үүргийн өгөгдмөл лавлах цэг: хомут — leader-ийн төгсгөл (хөл бүр өөр), бусад — тэнхлэг.</summary>
        public static string ElbowRef(BbBarRole r) { return r == BbBarRole.Stirrup ? ElbowEnd : ElbowAxis; }

        /// <summary>
        /// Инженерийн хугарлыг хэмжинэ: лавлах цэгээс (<paramref name="refR"/>) шошгоны тал руу хэвтээ зай (≥ 0 бол шошго тийш; ямар ч нэгж).
        /// </summary>
        public static double MeasureElbow(string side, double elbowR, double refR)
        {
            return string.Equals(side, Right, StringComparison.OrdinalIgnoreCase) ? elbowR - refR : refR - elbowR;
        }

        /// <summary>Сурсан зайгаар хугарлын r: лавлах цэгээс шошгоны тал руу <paramref name="d"/>.</summary>
        public static double ElbowFrom(string side, double refR, double d)
        {
            return string.Equals(side, Right, StringComparison.OrdinalIgnoreCase) ? refR + d : refR - d;
        }
    }
}
