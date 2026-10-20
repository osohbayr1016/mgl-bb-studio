using System;
using System.Collections.Generic;
using System.Linq;

namespace RevitMcpAddin.WallElevation.Core
{
    /// <summary>Байрлуулах нэг тэмдэглэл: заагчийн X (дэлгээсний дотоод X) ба бичвэрийн өргөн (заагчийн зайг оруулаад).</summary>
    public sealed class WeNoteItem
    {
        public string Key;
        public double LeaderX;
        public double Width;
    }

    /// <summary>Тэмдэглэлийн байр: мөр (0 = хүрээнд хамгийн ойр), бичвэр заагчийн БАРУУН талд эсэх, бичвэрийн зах.</summary>
    public sealed class WeNotePlace
    {
        public WeNoteItem Item;
        public int Row;
        public bool TextOnRight;
        public double TextLeft;
        public double TextRight;
        public double OccLeft { get { return Math.Min(Item.LeaderX, TextLeft); } }
        public double OccRight { get { return Math.Max(Item.LeaderX, TextRight); } }
    }

    /// <summary>
    /// Материалын тэмдэглэлийг дэлгээсний ДЭЭД зурваст мөрөөр байрлуулна (жишээ хуудас 205A-F: бичвэр зургийн дээр, заагч БОСОО доош,
    /// бичвэр заагчийн хажууд богино мөртэй).  ХЭМЖСЭН гажиг (GATEWAY 310G, 2026-10-07): хоёр тэмдэглэл бие биен дээрээ давхарлаж, ташуу
    /// заагчууд огтлолцсон.  Дүрэм: (1) нэг мөрийн бичвэрүүд давхцахгүй; (2) ДЭЭД мөрийн босоо заагч доод мөрийн бичвэрийг огтлохгүй;
    /// (3) бичвэр нь хүрээний хагаст — зүүн хагаст заагчийн баруун талд, баруун хагаст зүүн талд (хүрээнээс хальж level-ийн тэмдэгтэй
    /// мөргөлдөхгүй); тэр нь багтахгүй бол нөгөө тал; (4) хамгийн доод боломжит мөр.  Revit-гүй, тесттэй.
    /// </summary>
    public static class WeNoteLayout
    {
        public static List<WeNotePlace> Place(IList<WeNoteItem> items, double minX, double maxX, double shoulder, double gap, double overflow, int maxRows = 6)
        {
            List<WeNotePlace> greedy = Greedy(items, minX, maxX, shoulder, gap, overflow, maxRows);
            return greedy ?? Staircase(items, minX, maxX, shoulder);
        }

        /// <summary>
        /// Үндсэн арга: бичвэр бүр заагчийнхаа хажууд (тал нь хүрээний хагасаар).  Бичвэрийн доор өөр тэмдэглэлийн заагч орж байвал тэр
        /// тэмдэглэл ДООД мөрөнд байх ёстой — тиймээс тэднийг түрүүлж байрлуулна (топологийн дараалал).  Аль нэг нь багтахгүй бол null.
        /// </summary>
        private static List<WeNotePlace> Greedy(IList<WeNoteItem> items, double minX, double maxX, double shoulder, double gap, double overflow, int maxRows)
        {
            double mid = (minX + maxX) / 2;
            var first = new Dictionary<WeNoteItem, WeNotePlace>();
            var second = new Dictionary<WeNoteItem, WeNotePlace>();
            foreach (WeNoteItem it in items)
            {
                WeNotePlace right = Make(it, true, shoulder), left = Make(it, false, shoulder);
                double overR = Over(right, minX, maxX), overL = Over(left, minX, maxX);
                bool prefRight = it.LeaderX <= mid;
                if (prefRight && overR > overflow && overL < overR) prefRight = false;
                else if (!prefRight && overL > overflow && overR < overL) prefRight = true;
                // Хоёр тал хоёулаа хальвал (нарийн дэлгээс) ЗҮҮН тийш — баруун талд босоо хэмжээс, давхрын тэмдэг («8,00 Давхар 3») байна.
                // ХЭМЖСЭН (MITIC 218F/218H, 2026-10-08): 480 мм-ийн дэлгээст «БОР МОДОН ХУЛСАН ХАВТАН» «8,00»-ийг дарсан.
                if (overR > overflow && overL > overflow) prefRight = false;
                first[it] = prefRight ? right : left;
                WeNotePlace other = prefRight ? left : right;
                second[it] = Over(other, minX, maxX) <= overflow ? other : null;
            }
            var placed = new List<WeNotePlace>();
            var todo = items.OrderBy(i => i.LeaderX).ToList();
            while (todo.Count > 0)
            {
                // Бичвэрийнх нь доор байрлаагүй тэмдэглэлийн заагч хамгийн цөөн нь.
                WeNoteItem next = todo.OrderBy(i => todo.Count(k => k != i && Under(k.LeaderX, first[i], gap))).ThenBy(i => i.LeaderX).First();
                todo.Remove(next);
                WeNotePlace chosen = null;
                for (int r = 0; r < maxRows && chosen == null; r++)
                {
                    if (Fits(first[next], r, placed, gap)) chosen = first[next];
                    else if (second[next] != null && Fits(second[next], r, placed, gap)) chosen = second[next];
                    if (chosen != null) chosen.Row = r;
                }
                if (chosen == null) return null;
                placed.Add(chosen);
            }
            return placed;
        }

        /// <summary>
        /// Нөөц арга (нарийн хананд олон материал): бичвэрүүд НЭГ баганад, мөр бүрд нэг, бүх заагчийн нэг талд.  Баруун багана бол заагч нь
        /// хамгийн баруун тэмдэглэл хамгийн доод мөрөнд — дээд мөрийн заагч доод мөрийн мөр/бичвэрийг хэзээ ч огтлохгүй.  Аль тал нь хүрээнээс
        /// бага хальж байна тэр тал.
        /// </summary>
        private static List<WeNotePlace> Staircase(IList<WeNoteItem> items, double minX, double maxX, double shoulder)
        {
            double maxW = items.Max(i => i.Width);
            double xR = items.Max(i => i.LeaderX) + shoulder, xL = items.Min(i => i.LeaderX) - shoulder;
            double overR = Math.Max(0, xR + maxW - maxX), overL = Math.Max(0, minX - (xL - maxW));
            bool right = overR <= overL;
            var res = new List<WeNotePlace>();
            List<WeNoteItem> order = right ? items.OrderByDescending(i => i.LeaderX).ToList() : items.OrderBy(i => i.LeaderX).ToList();
            for (int r = 0; r < order.Count; r++)
            {
                WeNoteItem it = order[r];
                var p = new WeNotePlace { Item = it, Row = r, TextOnRight = right };
                if (right) { p.TextLeft = xR; p.TextRight = xR + it.Width; }
                else { p.TextRight = xL; p.TextLeft = xL - it.Width; }
                res.Add(p);
            }
            return res;
        }

        private static bool Under(double x, WeNotePlace p, double gap) { return x > p.OccLeft - gap && x < p.OccRight + gap; }

        private static WeNotePlace Make(WeNoteItem it, bool textRight, double shoulder)
        {
            var p = new WeNotePlace { Item = it, TextOnRight = textRight };
            if (textRight) { p.TextLeft = it.LeaderX + shoulder; p.TextRight = p.TextLeft + it.Width; }
            else { p.TextRight = it.LeaderX - shoulder; p.TextLeft = p.TextRight - it.Width; }
            return p;
        }

        private static double Over(WeNotePlace p, double minX, double maxX)
        {
            return Math.Max(0, minX - p.TextLeft) + Math.Max(0, p.TextRight - maxX);
        }

        private static bool Fits(WeNotePlace c, int row, List<WeNotePlace> placed, double gap)
        {
            double cl = c.OccLeft, cr = c.OccRight, x = c.Item.LeaderX;
            foreach (WeNotePlace p in placed)
            {
                if (p.Row == row)
                {
                    if (cl < p.OccRight + gap && cr > p.OccLeft - gap) return false;
                }
                else if (p.Row < row)
                {
                    // Миний заагч доод мөрийн бичвэр / мөрийг огтлохгүй.
                    if (x > p.OccLeft - gap && x < p.OccRight + gap) return false;
                }
                else
                {
                    // Дээд мөрийн заагч миний бичвэр / мөрийг огтлохгүй.
                    double px = p.Item.LeaderX;
                    if (px > c.OccLeft - gap && px < c.OccRight + gap) return false;
                }
            }
            return true;
        }
    }
}
