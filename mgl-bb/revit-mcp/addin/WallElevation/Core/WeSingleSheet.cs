using System;
using System.Collections.Generic;
using System.Linq;

namespace RevitMcpAddin.WallElevation.Core
{
    /// <summary>
    /// Хуудасны зурах талбай (хуудасны дотоод нэгж): тэгш өнцөгт + title block-ийн булангийн хүснэгтийн ЗҮҮН талын доод зай
    /// (<see cref="WeSheetFrame.Notch"/>) + title block-ийн гадна хүрээ (хальсан блокийг хуудасны БАРУУН талд — хүрээний бичээсийг дарахгүй).
    /// </summary>
    public sealed class WeSheetArea
    {
        public double MinX, MinY, MaxX, MaxY;
        /// <summary>x ≤ NotchMaxX хэсэгт зураг NotchMinY хүртэл доош орж болно; NaN = байхгүй.</summary>
        public double NotchMaxX = double.NaN, NotchMinY = double.NaN;
        /// <summary>Title block-ийн гадна хүрээ (хуудасны ирмэг); NaN = зурах талбайн хил.</summary>
        public double OuterMaxX = double.NaN, OuterMaxY = double.NaN;

        public double Width { get { return MaxX - MinX; } }
        public double Height { get { return MaxY - MinY; } }

        /// <summary>Тэгш өнцөгт зурах талбайд (хүснэгтийн зүүн талын зайг оруулаад) багтах уу.</summary>
        public bool Contains(double x0, double y0, double x1, double y1, double tol)
        {
            if (x0 < MinX - tol || x1 > MaxX + tol || y1 > MaxY + tol) return false;
            if (y0 >= MinY - tol) return true;
            return !double.IsNaN(NotchMaxX) && !double.IsNaN(NotchMinY) && x1 <= NotchMaxX + tol && y0 >= NotchMinY - tol;
        }

        /// <summary>Хальсан блокийн баганын зүүн хил — title block-ийн гадна хүрээнээс баруун.</summary>
        public double SpillX(double gap)
        {
            return (double.IsNaN(OuterMaxX) ? MaxX : Math.Max(MaxX, OuterMaxX)) + gap * 3;
        }

        public double SpillTop { get { return double.IsNaN(OuterMaxY) ? MaxY : Math.Max(MaxY, OuterMaxY); } }
    }

    /// <summary>Нэг хуудсан дээрх байршлын дүгнэлт — тайланд «байрлуулж цэгцлэх» эсэх.</summary>
    public sealed class WeSheetFitReport
    {
        public int Stacked, Spilled, OutOfFrame, Overlaps;
        public bool NeedsArrangement { get { return Stacked + Spilled + OutOfFrame + Overlaps > 0; } }

        public string Describe()
        {
            var parts = new List<string>();
            if (Stacked > 0) parts.Add(Stacked + " дэлгээс овоолж (шилжүүлж) тавьсан");
            if (Overlaps > 0) parts.Add(Overlaps + " давхцал");
            if (OutOfFrame > 0) parts.Add(OutOfFrame + " хүрээнээс гарсан");
            if (Spilled > 0) parts.Add(Spilled + " хуудасны баруун талд (хүрээнээс гадна)");
            return string.Join(", ", parts);
        }
    }

    /// <summary>
    /// «Бүх дэлгээс НЭГ хуудсанд» зохиомж (W02, 2026-10-16 — архитекторуудын хүсэлт): өрөө бүрийн дэлгээс, түлхүүр план, 3D, legend, рендерийн байр
    /// бүгд ЭНЭ хуудсанд — багтахгүй ч гэсэн.  Хэрэглэгч дараа нь өөр хуудас үүсгэж сонгосон зургаа гараар зөөнө.  Энэ нь бүгдийг ХЭВЛЭГДЭХЭЭР
    /// багасгах шаардлага БИШ: масштаб хэвээр, ямар ч зураг хаягдахгүй, үргэлжлэлийн хуудас ҮҮСЭХГҮЙ.
    ///   • зүүн баганад түлхүүр план (дээд булан), доор нь 3D, legend — багтвал;
    ///   • үлдсэн талбай ДӨРВӨН бүс: зүүн дээд, баруун дээд, зүүн доод, баруун доод.  Дэлгээс k (үсгийн дарааллаар) → бүс k mod 4
    ///     (A→зүүн дээд, B→баруун дээд, C→зүүн доод, D→баруун доод, E→зүүн дээд …).  Дээд/доод мөрийн эхний дэлгээсүүд шалаар тэгшлэгдэнэ;
    ///   • бүсдээ багтах дараагийн дэлгээс тэр бүсэд мөрөөр; бүсдээ багтахгүй бол хуудасны СУЛ ЗАЙД (live gate 2026-10-16: 5–6 талтай өрөөнд
    ///     A1 хуудас хангалттай байхад E/F шууд овоолгод орж давхцдаг байв); тэнд ч багтахгүй бол бүсийн эхний зургаас <c>stackStep</c>-ээр
    ///     ШИЛЖҮҮЛСЭН ОВООЛГО (гарчиг нь харагдаж, дарж сонгогдохоор — хэзээ ч яг ижил цэгт биш);
    ///   • баганад багтаагүй туслах блок, рендерийн байр — хуудасны сул зайд, эс бөгөөс хуудасны БАРУУН талд (title block-ийн гадна, бичээсийг
    ///     дарахгүй) босоо баганаар.  Хаягдахгүй.
    /// Зураг эргүүлэхгүй.  Давхцал, хүрээнээс гарах нь энэ горимд ЗӨВШӨӨРӨГДСӨН төлөв — тайланд «байрлуулж цэгцлэх» гэж хэлнэ.
    /// </summary>
    public static class WeSingleSheet
    {
        private const double Eps = 1e-9;
        /// <summary>Туслах багана хуудасны өргөний хэдээс илүүгүй (өргөн бол түлхүүр план сул зайнд).</summary>
        public const double ColumnMaxFraction = 0.45;

        private sealed class Region
        {
            public double MinX, MinY, MaxX, MaxY;
            public int First = -1;
            public double CursorX, RowTop, RowBottom;
            public int Stack;
            public int Row = -1;
        }

        /// <param name="items">Блокууд (дэлгээс — үсгийн дарааллаар).  Хэмжээ нь гарчиг орсон бүтэн outline.</param>
        /// <param name="area">Зурах талбай.</param>
        /// <param name="gap">Блок хоорондын зай.</param>
        /// <param name="stackStep">Овоолгын шилжилт (баруун, доош) — гарчиг харагдахаар (≈ 12 мм цаас).</param>
        /// <param name="minRenderH">Рендерийн байрыг сул зайд багтаахдаа жижигрүүлэх доод өндөр (0 = жижигрүүлэхгүй).</param>
        public static List<WeSheetSlot> Compose(IList<WeComposeItem> items, WeSheetArea area, double gap, double stackStep, double minRenderH = 0)
        {
            var slots = new List<WeSheetSlot>();
            if (items == null || items.Count == 0) return slots;
            if (area == null || area.Width <= 0 || area.Height <= 0) throw new ArgumentException("Хуудасны ажлын талбай хоосон");
            var placed = new WeSheetSlot[items.Count];

            // ── 1. Туслах багана ─────────────────────────────────────
            int key = IndexOf(items, WeComposeKind.KeyPlan);
            var helperOrder = new List<int>();
            if (key >= 0) helperOrder.Add(key);
            int ax = IndexOf(items, WeComposeKind.Axon);
            if (ax >= 0) helperOrder.Add(ax);
            for (int i = 0; i < items.Count; i++) if (items[i] != null && items[i].Kind == WeComposeKind.Legend) helperOrder.Add(i);
            var overflow = new List<int>();
            double colW = 0, y = area.MaxY;
            bool column = key >= 0 && W(items[key]) <= area.Width * ColumnMaxFraction + Eps;
            foreach (int i in helperOrder)
            {
                double w = W(items[i]), h = H(items[i]);
                bool fits = column && Math.Max(colW, w) <= area.Width * ColumnMaxFraction + Eps
                            && (i == key || area.Contains(area.MinX, y - h, area.MinX + w, y, Eps));
                if (!fits) { overflow.Add(i); continue; }
                placed[i] = new WeSheetSlot { Index = i, Page = 0, CenterX = area.MinX + w / 2, CenterY = y - h / 2, Region = -1 };
                colW = Math.Max(colW, w);
                y -= h + gap;
            }

            // ── 2. Дөрвөн бүс ────────────────────────────────────────
            List<int> elevs = Enumerable.Range(0, items.Count).Where(i => items[i] != null && items[i].Kind == WeComposeKind.Elevation).ToList();
            double ex0 = colW > 0 ? area.MinX + colW + gap : area.MinX, ex1 = area.MaxX, ey0 = area.MinY, ey1 = area.MaxY;
            if (ex1 - ex0 < gap) ex1 = ex0 + Math.Max(gap, elevs.Count > 0 ? elevs.Max(i => W(items[i])) : gap);   // туслах багана бүх өргөнийг эзэлсэн — хальна
            Func<int, int> first = r => r < elevs.Count ? elevs[r] : -1;
            double leftW = Math.Max(Wi(items, first(0)), Wi(items, first(2))), rightW = Math.Max(Wi(items, first(1)), Wi(items, first(3)));
            double availW = ex1 - ex0;
            double col1;
            if (rightW <= 0) col1 = ex1;
            else if (leftW + gap + rightW <= availW + Eps) col1 = ex0 + leftW + gap;
            else col1 = ex0 + Math.Max(0, availW - gap) * leftW / Math.Max(Eps, leftW + rightW) + gap;   // багтахгүй — давхцана (зөвшөөрөгдсөн)

            // Дээд мөр: шалаар тэгшилнэ (тэгшлэх шугамгүй нь дээд захаар).
            double[] topRow = RowTops(items, new[] { first(0), first(1) }, ey1);
            double topBottom = ey1;
            for (int k = 0; k < 2; k++) if (first(k) >= 0) topBottom = Math.Min(topBottom, topRow[k] - H(items[first(k)]));
            bool bottomRowExists = first(2) >= 0 || first(3) >= 0;
            double row1Top = bottomRowExists ? topBottom - gap : ey0;
            double[] botRow = RowTops(items, new[] { first(2), first(3) }, row1Top);

            double splitX = rightW > 0 ? col1 - gap / 2 : ex1;
            double splitY = bottomRowExists ? row1Top + gap / 2 : ey0;
            var regions = new[]
            {
                new Region { MinX = ex0, MinY = Math.Min(splitY + gap / 2, ey1), MaxX = Math.Max(ex0, splitX - gap / 2), MaxY = ey1, Row = 0 },
                new Region { MinX = Math.Min(splitX + gap / 2, ex1), MinY = Math.Min(splitY + gap / 2, ey1), MaxX = ex1, MaxY = ey1, Row = 0 },
                new Region { MinX = ex0, MinY = ey0, MaxX = Math.Max(ex0, splitX - gap / 2), MaxY = Math.Max(ey0, splitY - gap / 2), Row = 1 },
                new Region { MinX = Math.Min(splitX + gap / 2, ex1), MinY = ey0, MaxX = ex1, MaxY = Math.Max(ey0, splitY - gap / 2), Row = 1 },
            };
            for (int r = 0; r < 4; r++)
            {
                int i = first(r);
                if (i < 0) continue;
                double x0 = r == 0 || r == 2 ? ex0 : col1;
                double top = r < 2 ? topRow[r] : botRow[r - 2];
                double w = W(items[i]), h = H(items[i]);
                placed[i] = new WeSheetSlot { Index = i, Page = 0, CenterX = x0 + w / 2, CenterY = top - h / 2, Region = r, Row = regions[r].Row };
                Region rg = regions[r];
                rg.First = i;
                rg.CursorX = x0 + w + gap;
                rg.RowTop = top;
                rg.RowBottom = top - h;
            }

            // ── 3. Дараагийн дэлгээс: бүсдээ мөрөөр, багтахгүй бол хуудасны сул зайд, тэнд ч үгүй бол шилжүүлсэн овоолго ──
            var occ = new List<double[]>();
            for (int i = 0; i < placed.Length; i++)
                if (placed[i] != null) occ.Add(Grow(RectOf(placed[i], items[i]), gap));
            for (int k = 4; k < elevs.Count; k++)
            {
                int i = elevs[k];
                Region rg = regions[k % 4];
                double w = W(items[i]), h = H(items[i]);
                double sx = rg.CursorX, st = rg.RowTop;
                // Бүсийн мөр сул зайд орсон (өөр бүсийн) блоктой мөргөлдвөл энэ байр хүчингүй.
                Func<double, double, bool> clear = (x, top) => !occ.Any(o => Intersects(o, new[] { x, top - h, x + w, top }));
                bool fits = rg.First >= 0 && sx + w <= rg.MaxX + Eps && FitsRegion(area, rg, sx, st - h, sx + w, st) && clear(sx, st);
                int row = rg.Row;
                if (!fits && rg.First >= 0)
                {
                    // Шинэ мөр (бүсийн дотор).
                    sx = rg.MinX;
                    st = rg.RowBottom - gap;
                    fits = sx + w <= rg.MaxX + Eps && FitsRegion(area, rg, sx, st - h, sx + w, st) && clear(sx, st);
                    row = -1;
                    if (fits) { rg.RowTop = st; rg.RowBottom = st; }
                }
                if (fits)
                {
                    placed[i] = new WeSheetSlot { Index = i, Page = 0, CenterX = sx + w / 2, CenterY = st - h / 2, Region = k % 4, Row = row };
                    rg.CursorX = sx + w + gap;
                    rg.RowBottom = Math.Min(rg.RowBottom, st - h);
                    occ.Add(Grow(RectOf(placed[i], items[i]), gap));
                    continue;
                }
                double[] free = FindFree(w, h, area, occ, gap);
                if (free != null)
                {
                    placed[i] = new WeSheetSlot { Index = i, Page = 0, CenterX = free[0] + w / 2, CenterY = free[1] - h / 2, Region = k % 4 };
                    occ.Add(Grow(RectOf(placed[i], items[i]), gap));
                    continue;
                }
                // Овоолго: бүсийн эхний зургийн зүүн дээд булангаас (байхгүй бол бүсийн булангаас) баруун-доош шилжүүлж.
                rg.Stack++;
                double ax0, atop;
                if (rg.First >= 0)
                {
                    WeSheetSlot f = placed[rg.First];
                    ax0 = f.CenterX - W(items[rg.First]) / 2;
                    atop = f.CenterY + H(items[rg.First]) / 2;
                }
                else { ax0 = rg.MinX; atop = rg.MaxY; }
                double ox = ax0 + rg.Stack * stackStep, otop = atop - rg.Stack * stackStep;
                placed[i] = new WeSheetSlot { Index = i, Page = 0, CenterX = ox + w / 2, CenterY = otop - h / 2, Region = k % 4, Stacked = true };
            }

            // ── 4. Баганад ороогүй туслах блок, рендерийн байр — сул зайд, эс бөгөөс хуудасны баруун талд ──
            var occupied = new List<double[]>();
            for (int i = 0; i < placed.Length; i++)
                if (placed[i] != null) occupied.Add(Grow(RectOf(placed[i], items[i]), gap));
            double spillTop = area.SpillTop;
            var rest = new List<int>(overflow);
            for (int i = 0; i < items.Count; i++)
                if (placed[i] == null && !rest.Contains(i) && items[i] != null && items[i].Kind != WeComposeKind.Elevation) rest.Add(i);
            foreach (int i in rest.OrderBy(i => items[i].Kind == WeComposeKind.Placeholder ? 1 : 0).ThenBy(i => i))
            {
                double w = W(items[i]), h = H(items[i]);
                WeSheetSlot sl = null;
                double[] scales = items[i].Kind == WeComposeKind.Placeholder && minRenderH > 0 ? new[] { 1.0, 0.75, 0.5, 0.35 } : new[] { 1.0 };
                foreach (double k in scales)
                {
                    if (k < 1 - Eps && h * k < minRenderH - Eps) break;
                    double[] at = FindFree(w * k, h * k, area, occupied, gap);
                    if (at == null) continue;
                    sl = new WeSheetSlot { Index = i, Page = 0, CenterX = at[0] + w * k / 2, CenterY = at[1] - h * k / 2, Region = -1,
                                           W = k < 1 - Eps ? w * k : 0, H = k < 1 - Eps ? h * k : 0 };
                    break;
                }
                if (sl == null)
                {
                    double sx = area.SpillX(gap);
                    sl = new WeSheetSlot { Index = i, Page = 0, CenterX = sx + w / 2, CenterY = spillTop - h / 2, Region = -1, Spill = true };
                    spillTop -= h + gap;
                }
                placed[i] = sl;
                occupied.Add(Grow(RectOf(sl, items[i]), gap));
            }

            for (int i = 0; i < placed.Length; i++) if (placed[i] != null) slots.Add(placed[i]);
            return slots;
        }

        /// <summary>
        /// Өмнө үүссэн хуудсанд (дахин ажиллуулахад) ШИНЭ блок нэмэх: эзлэгдсэн хэсгийг (хэрэглэгчийн зөөсөн viewport) ХӨНДӨХГҮЙ — сул зайд
        /// (дээрээс доош, зүүнээс баруун), эс бөгөөс хуудасны баруун талд (title block-ийн гадна) өмнө хальсан блокуудын доор.  Хэзээ ч өөр
        /// хуудас үүсгэхгүй.  <paramref name="occupied"/>-д шинэ блок нэмэгдэнэ (дараалсан дуудлагад).
        /// </summary>
        public static WeSheetSlot PlaceInFree(WeComposeItem item, int index, WeSheetArea area, List<double[]> occupied, double gap)
        {
            double w = W(item), h = H(item);
            double[] at = FindFree(w, h, area, occupied, gap);
            WeSheetSlot sl;
            if (at != null) sl = new WeSheetSlot { Index = index, Page = 0, CenterX = at[0] + w / 2, CenterY = at[1] - h / 2, Region = -1 };
            else
            {
                // Хуудасны баруун талын багана — өмнө хальсан блокуудын доор.
                double sx = area.SpillX(gap), top = area.SpillTop;
                for (int guard = 0; guard < 1000; guard++)
                {
                    double[] r = { sx, top - h, sx + w, top };
                    double[] hit = occupied.FirstOrDefault(o => Intersects(o, r));
                    if (hit == null) break;
                    top = hit[1] - gap;
                }
                sl = new WeSheetSlot { Index = index, Page = 0, CenterX = sx + w / 2, CenterY = top - h / 2, Region = -1, Spill = true };
            }
            occupied.Add(Grow(RectOf(sl, item), gap));
            return sl;
        }

        /// <summary>
        /// Хуудасны дүгнэлт: овоолсон, хальсан, хүрээнээс гарсан, давхцсан блокийн тоо (хальсан блок давхцал/хүрээнд тооцогдохгүй — зориуд гадна).
        /// </summary>
        public static WeSheetFitReport Assess(IList<WeSheetSlot> slots, IList<WeComposeItem> items, WeSheetArea area, double tol)
        {
            var rep = new WeSheetFitReport();
            if (slots == null) return rep;
            var rects = new List<double[]>();
            foreach (WeSheetSlot s in slots)
            {
                if (s.Stacked) rep.Stacked++;
                if (s.Spill) { rep.Spilled++; continue; }
                double[] r = RectOf(s, items[s.Index]);
                if (area != null && !area.Contains(r[0], r[1], r[2], r[3], tol)) rep.OutOfFrame++;
                rects.Add(r);
            }
            for (int a = 0; a < rects.Count; a++)
                for (int b = a + 1; b < rects.Count; b++)
                    if (Math.Min(rects[a][2], rects[b][2]) - Math.Max(rects[a][0], rects[b][0]) > tol
                        && Math.Min(rects[a][3], rects[b][3]) - Math.Max(rects[a][1], rects[b][1]) > tol) rep.Overlaps++;
            return rep;
        }

        /// <summary>Байршсан блокийн тэгш өнцөгт {x0, y0, x1, y1} (жижигрүүлсэн рендерийн байрын бодит хэмжээгээр).</summary>
        public static double[] RectOf(WeSheetSlot s, WeComposeItem it)
        {
            double w = s.W > 0 ? s.W : W(it), h = s.H > 0 ? s.H : H(it);
            return new[] { s.CenterX - w / 2, s.CenterY - h / 2, s.CenterX + w / 2, s.CenterY + h / 2 };
        }

        /// <summary>
        /// w × h блокийн зүүн ДЭЭД булан (x, top) — зурах талбайд багтах, эзлэгдсэнтэй давхцахгүй.  Нэр дэвшигч: талбайн зүүн хил ба блок бүрийн баруун
        /// захын х, талбайн дээд хил ба блок бүрийн доод захын y; хамгийн дээд, дараа нь хамгийн зүүн.  Олдохгүй бол null.
        /// </summary>
        public static double[] FindFree(double w, double h, WeSheetArea area, IList<double[]> occupied, double gap)
        {
            var xs = new List<double> { area.MinX };
            var tops = new List<double> { area.MaxY };
            foreach (double[] o in occupied) { xs.Add(o[2]); tops.Add(o[1]); }
            foreach (double top in tops.Distinct().OrderByDescending(t => t))
                foreach (double x in xs.Distinct().OrderBy(v => v))
                {
                    double[] r = { x, top - h, x + w, top };
                    if (!area.Contains(r[0], r[1], r[2], r[3], Eps)) continue;
                    if (occupied.Any(o => Intersects(o, r))) continue;
                    return new[] { x, top };
                }
            return null;
        }

        private static bool FitsRegion(WeSheetArea area, Region rg, double x0, double y0, double x1, double y1)
        {
            if (y0 >= rg.MinY - Eps) return true;
            // Доод мөрийн бүс: title block-ийн хүснэгтийн зүүн талын зай руу доош.
            return rg.MinY <= area.MinY + Eps && area.Contains(x0, y0, x1, y1, Eps);
        }

        /// <summary>Мөрийн блокуудын дээд захын Y — тэгшлэх шугамтай блокуудыг шалаар нэг шулуун дээр (хамгийн өндөр шугамаар).</summary>
        private static double[] RowTops(IList<WeComposeItem> items, int[] idx, double top)
        {
            double maxBase = 0;
            foreach (int i in idx) if (i >= 0 && items[i].Aligned) maxBase = Math.Max(maxBase, items[i].Base);
            var r = new double[idx.Length];
            for (int k = 0; k < idx.Length; k++)
            {
                int i = idx[k];
                r[k] = i < 0 ? top : items[i].Aligned ? top - maxBase + items[i].Base : top;
            }
            return r;
        }

        private static double[] Grow(double[] r, double g) { return new[] { r[0] - g, r[1] - g, r[2] + g, r[3] + g }; }

        private static bool Intersects(double[] a, double[] b)
        {
            return Math.Min(a[2], b[2]) - Math.Max(a[0], b[0]) > Eps && Math.Min(a[3], b[3]) - Math.Max(a[1], b[1]) > Eps;
        }

        private static double W(WeComposeItem it) { return it == null ? 0 : Math.Max(0, it.W); }
        private static double H(WeComposeItem it) { return it == null ? 0 : Math.Max(0, it.H); }
        private static double Wi(IList<WeComposeItem> items, int i) { return i < 0 ? 0 : W(items[i]); }

        private static int IndexOf(IList<WeComposeItem> items, string kind)
        {
            for (int i = 0; i < items.Count; i++) if (items[i] != null && items[i].Kind == kind) return i;
            return -1;
        }
    }
}
