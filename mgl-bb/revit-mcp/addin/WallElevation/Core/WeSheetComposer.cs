using System;
using System.Collections.Generic;
using System.Linq;

namespace RevitMcpAddin.WallElevation.Core
{
    /// <summary>Хуудасны блокийн төрөл.</summary>
    public static class WeComposeKind
    {
        public const string KeyPlan = "key";
        public const string Axon = "axon";
        public const string Legend = "legend";
        public const string Elevation = "elev";
        /// <summary>Перспектив / рендер зургийн байр (тэгш өнцөгт + бичвэр).</summary>
        public const string Placeholder = "ph";
    }

    /// <summary>Нэг блок: хэмжээ (хуудасны дотоод нэгж) — viewport-ийн бодит outline (гарчиг орсон).</summary>
    public sealed class WeComposeItem
    {
        public string Kind;
        public double W;
        public double H;
        /// <summary>
        /// Тэгшлэх шугам (давхрын шал) блокийн ДЭЭД захаас доош хэр зайд (0..H); NaN = тэгшлэхгүй.  Жишээ хуудас 206A-G: нэг эгнээний
        /// дэлгээсүүдийн «4,00 Давхар 2» ба «8,00 Давхар 3» ЯГ нэг шулуун дээр — дээд захаар тэгшилбэл материалын бичвэр, гарчгийн
        /// өндрөөс хамаарч шал шатлан зөрдөг (ХЭМЖСЭН GATEWAY 310C/310D: 4 мм).
        /// </summary>
        public double Base = double.NaN;

        public WeComposeItem() { }
        public WeComposeItem(string kind, double w, double h) { Kind = kind; W = w; H = h; }

        public bool Aligned { get { return !double.IsNaN(Base) && Base >= 0 && Base <= H + 1e-9; } }
    }

    /// <summary>
    /// Title block-ийн ЗУРАХ талбай: хүрээний шугам ба мэдээллийн зурвасын (баруун багана — лого, компани, хувилбарын хүснэгт;
    /// доод тууз) хилээр.  ХЭМЖСЭН (Revit 2027, «E1 30 x 42 Horizontal»): bbox-оор л байрлуулахад 6 дахь дэлгээс баруун зурвасын
    /// лого дээр суусан.  Дүрэм: хуудасны өндрийн/өргөний ≥55 %-ийг хамарсан (нэг шулуун дээрх тасархай хэсгүүдийг нэгтгэнэ)
    /// босоо/хэвтээ шугам бол хүрээ эсвэл зурвасын хил; хуудасны ТӨВӨӨС хамгийн ойрыг тал бүрт авна.  Үр дүнгийн өргөн/өндөр
    /// хуудасны 50 %-иас бага бол тэр тэнхлэгт хил тооцохгүй (дунд нь зурсан ганц шугам талбайг хоёр хуваахгүй).
    /// </summary>
    public static class WeSheetFrame
    {
        /// <param name="segments">Шулуун хэрчмүүд {x1, y1, x2, y2} — хуудасны координатаар.</param>
        /// <returns>{minX, minY, maxX, maxY}</returns>
        public static double[] Drawable(IList<double[]> segments, double minX, double minY, double maxX, double maxY)
        {
            List<double[]> partial;
            return Drawable(segments, minX, minY, maxX, maxY, out partial, false);
        }

        /// <summary>
        /// W02 (2026-10-16, «доод хэсгийн ашиглах талбайг шаардлагагүй хасахгүй»): доод талын хэвтээ шугам хуудасны өргөний 55–90 %-ийг л
        /// хамарвал (баруун доод булангийн том хүснэгтийн ДЭЭД шугам) тэр нь БҮТЭН өргөний хил биш — доорх хэсгийг <paramref name="partialBands"/>-д
        /// саад {from, minY, to, y} болгож буцаана; <see cref="AvoidObstacles"/> + <see cref="Notch"/> хүснэгтийн зүүн талын зайг сэргээнэ.
        /// Өмнө нь ийм шугам бүх өргөнөөр доод хил болж зүүн доод хоосон зай алга болдог байв.
        /// </summary>
        /// <param name="splitPartial">false = хуучин зан төлөв (55 %-иас урт бүх шугам хил).</param>
        public static double[] Drawable(IList<double[]> segments, double minX, double minY, double maxX, double maxY, out List<double[]> partialBands,
                                        bool splitPartial = true)
        {
            partialBands = new List<double[]>();
            double w = maxX - minX, h = maxY - minY;
            var r = new[] { minX, minY, maxX, maxY };
            if (segments == null || w <= 0 || h <= 0) return r;
            double tol = Math.Max(w, h) * 1e-3;
            List<double> vert = LongLines(segments, true, tol, h * 0.55);
            List<double[]> horSpans = LongLineSpans(segments, false, tol, w * 0.55);
            double cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
            var hor = new List<double>();
            foreach (double[] sp in horSpans)
            {
                bool bottomPartial = splitPartial && sp[0] < cy - tol && sp[2] - sp[1] < w * 0.9;
                if (bottomPartial) partialBands.Add(new[] { sp[1], minY, sp[2], sp[0] });
                else hor.Add(sp[0]);
            }
            double l = Max(vert.Where(x => x < cx - tol), minX), rr = Min(vert.Where(x => x > cx + tol), maxX);
            double b = Max(hor.Where(y => y < cy - tol), minY), t = Min(hor.Where(y => y > cy + tol), maxY);
            if (rr - l >= w * 0.5) { r[0] = Math.Max(l, minX); r[2] = Math.Min(rr, maxX); }
            if (t - b >= h * 0.5) { r[1] = Math.Max(b, minY); r[3] = Math.Min(t, maxY); }
            // Бүтэн өргөний хилээс ДООРХ хэсэгчилсэн шугам — аль хэдийн хасагдсан хэсэгт, саад биш.
            partialBands = partialBands.Where(p => p[3] > r[1] + tol).Select(p => new[] { Math.Max(p[0], r[0]), r[1], Math.Min(p[2], r[2]), p[3] }).ToList();
            return r;
        }

        /// <summary>
        /// Зурах талбайгаас title block-ийн саадыг (nested family-д зурсан бичээс, тайлбарын хүснэгт, лого, текст) хасна: саад бүрт
        /// талбайг хамгийн БАГА алдагдалтай талаас нь (доор / дээр / зүүн / баруун) тайрна.  ХЭМЖСЭН (GATEWAY «Булангын_хүснэгт»): доод
        /// бүтэн зурвасын шугам nested family-д тул шугамаар танигдаагүй.  Талбайн тал хувиас том саад (бүтэн хүрээний дүүргэлт г.м.)
        /// болон 1 мм-ээс жижиг саадыг үл тооно.
        /// </summary>
        /// <param name="rect">{minX, minY, maxX, maxY}</param>
        /// <param name="obstacles">Саад бүр {minX, minY, maxX, maxY}</param>
        public static double[] AvoidObstacles(double[] rect, IList<double[]> obstacles, double minSize)
        {
            var r = (double[])rect.Clone();
            if (obstacles == null || obstacles.Count == 0) return r;
            double area0 = (r[2] - r[0]) * (r[3] - r[1]), W = r[2] - r[0], H = r[3] - r[1];
            // ХЭМЖСЭН (GATEWAY): хүрээний бүсийн тэмдэглэгээний (1…12, A…H) зураасны бүлэг хуудсыг бүтэн дайрсан 3 мм-ийн тууз bbox-той —
            // саад биш.  Бүтэн урттай (> 60 %) НИМГЭН (< 3 %) туузыг үл тооно; бүтэн өргөнтэй ЗУЗААН зурвас (доод тайлбар) — саад.
            Func<double[], bool> strip = o =>
            {
                double w = o[2] - o[0], h = o[3] - o[1];
                bool span = w > W * 0.6 || h > H * 0.6;
                return span && Math.Min(w / W, h / H) < 0.03;
            };
            var list = obstacles.Where(o => o != null && o.Length >= 4 && o[2] - o[0] > minSize && o[3] - o[1] > minSize
                                            && (o[2] - o[0]) * (o[3] - o[1]) < area0 * 0.5 && !strip(o)).ToList();
            for (int iter = 0; iter < 200; iter++)
            {
                double[] hit = list.FirstOrDefault(o => o[0] < r[2] - 1e-9 && o[2] > r[0] + 1e-9 && o[1] < r[3] - 1e-9 && o[3] > r[1] + 1e-9);
                if (hit == null) break;
                var cands = new List<double[]>
                {
                    new[] { r[0], hit[3], r[2], r[3] },   // доороос
                    new[] { r[0], r[1], r[2], hit[1] },   // дээрээс
                    new[] { hit[2], r[1], r[2], r[3] },   // зүүнээс
                    new[] { r[0], r[1], hit[0], r[3] },   // баруунаас
                };
                double[] best = cands.Where(c => c[2] - c[0] > 1e-9 && c[3] - c[1] > 1e-9)
                                     .OrderByDescending(c => (c[2] - c[0]) * (c[3] - c[1])).FirstOrDefault();
                if (best == null || (best[2] - best[0]) * (best[3] - best[1]) < area0 * 0.3) { list.Remove(hit); continue; }   // хэт их алдагдал — үл тооно
                r = best;
            }
            return r;
        }

        /// <summary>
        /// <see cref="AvoidObstacles"/> доод зурвасыг БҮТЭН өргөнөөр хассан бол (саад нь зөвхөн баруун доод буланд — «Булангын хүснэгт») тэр
        /// саадын ЗҮҮН талын хоосон зай: {notchMaxX, notchMinY} — x ≤ notchMaxX хэсэгт зураг notchMinY хүртэл доош орж болно.  ХЭМЖСЭН (GATEWAY
        /// БА429, 2026-10-07): хүснэгт хуудасны баруун 30 %-д, 40 мм өндөр — зүүн 400 мм-ийн доод зурвас хоосон байхад 310H «багтахгүй» гэж
        /// үргэлжлэлийн хуудас руу шилжсэн.  Зурвас огт хасагдаагүй, эсвэл саад зүүн талын ≥ 70 %-ийг эзэлсэн бол null.
        /// </summary>
        public static double[] Notch(double[] rect, double[] avoided, IList<double[]> obstacles, double minSize)
        {
            if (rect == null || avoided == null || obstacles == null) return null;
            const double eps = 1e-9;
            double W = rect[2] - rect[0], H = rect[3] - rect[1];
            // Доод зурвас хасагдсан, бусад тал бараг хэвээр (ХЭМЖСЭН GATEWAY: баруун хил 1 мм-ээр тайрагдсан — хүснэгтийн хүрээний шугам).
            bool onlyBottom = avoided[1] > rect[1] + eps && avoided[0] - rect[0] < W * 0.02 && rect[2] - avoided[2] < W * 0.02
                              && rect[3] - avoided[3] < H * 0.02;
            if (!onlyBottom) return null;
            // Доод зурвасанд орсон саад — <see cref="AvoidObstacles"/>-ийн ИЖИЛ шүүлтээр (ХЭМЖСЭН GATEWAY: хүрээний бүсийн 11 босоо зураас бүтэн
            // өндөртэй нимгэн тууз, бүтэн хуудасны дүүргэлт — саад биш), мөн зүүн хил дээрх (≤ 3 %) бүсийн үсгийн хайрцаг.
            double area0 = W * H;
            Func<double[], bool> strip = o =>
            {
                double w = o[2] - o[0], h = o[3] - o[1];
                bool span = w > W * 0.6 || h > H * 0.6;
                return span && Math.Min(w / W, h / H) < 0.03;
            };
            var band = obstacles.Where(o => o != null && o.Length >= 4 && o[2] - o[0] > minSize && o[3] - o[1] > minSize && (o[2] - o[0]) * (o[3] - o[1]) < area0 * 0.5
                                            && !strip(o) && o[0] < rect[2] - eps && o[2] > rect[0] + W * 0.03 && o[1] < avoided[1] - eps && o[3] > rect[1] + eps).ToList();
            if (band.Count == 0) return null;
            double cut = band.Min(o => o[0]);
            if (cut - rect[0] < W * 0.3) return null;
            return new[] { cut, rect[1] };
        }

        private static double Max(IEnumerable<double> xs, double fallback) { double m = fallback; bool any = false; foreach (double x in xs) { if (!any || x > m) m = x; any = true; } return any ? m : fallback; }
        private static double Min(IEnumerable<double> xs, double fallback) { double m = fallback; bool any = false; foreach (double x in xs) { if (!any || x < m) m = x; any = true; } return any ? m : fallback; }

        /// <summary>Нэг шулуун дээрх хэрчмүүдийн нэгдэл ≥ minLen бол {байрлал, хамгийн бага, хамгийн их} (нэгдлийн хүрээ).</summary>
        private static List<double[]> LongLineSpans(IList<double[]> segs, bool vertical, double tol, double minLen)
        {
            var spans = new List<double[]>();
            foreach (double[] s in segs)
            {
                if (s == null || s.Length < 4) continue;
                double d0 = vertical ? s[0] - s[2] : s[1] - s[3];
                if (Math.Abs(d0) > tol) continue;
                double pos = vertical ? (s[0] + s[2]) / 2 : (s[1] + s[3]) / 2;
                double a = vertical ? s[1] : s[0], c = vertical ? s[3] : s[2];
                if (Math.Abs(c - a) <= tol) continue;
                spans.Add(new[] { pos, Math.Min(a, c), Math.Max(a, c) });
            }
            var result = new List<double[]>();
            foreach (IGrouping<long, double[]> g in spans.GroupBy(x => (long)Math.Round(x[0] / (tol * 2))))
            {
                double len = 0, end = double.NegativeInfinity, lo = double.PositiveInfinity, hi = double.NegativeInfinity;
                foreach (double[] sp in g.OrderBy(x => x[1]))
                {
                    double from = Math.Max(sp[1], end);
                    if (sp[2] > from) len += sp[2] - from;
                    end = Math.Max(end, sp[2]);
                    lo = Math.Min(lo, sp[1]); hi = Math.Max(hi, sp[2]);
                }
                if (len >= minLen - 1e-9) result.Add(new[] { g.Average(x => x[0]), lo, hi });
            }
            return result;
        }

        /// <summary>Нэг шулуун (босоо бол x, хэвтээ бол y) дээрх хэрчмүүдийн НЭГДЛИЙН урт ≥ minLen бол тэр шулууны байрлал.</summary>
        private static List<double> LongLines(IList<double[]> segs, bool vertical, double tol, double minLen)
        {
            var spans = new List<double[]>();   // {pos, from, to}
            foreach (double[] s in segs)
            {
                if (s == null || s.Length < 4) continue;
                double d0 = vertical ? s[0] - s[2] : s[1] - s[3];
                if (Math.Abs(d0) > tol) continue;
                double pos = vertical ? (s[0] + s[2]) / 2 : (s[1] + s[3]) / 2;
                double a = vertical ? s[1] : s[0], c = vertical ? s[3] : s[2];
                if (Math.Abs(c - a) <= tol) continue;
                spans.Add(new[] { pos, Math.Min(a, c), Math.Max(a, c) });
            }
            var result = new List<double>();
            foreach (IGrouping<long, double[]> g in spans.GroupBy(x => (long)Math.Round(x[0] / (tol * 2))))
            {
                double len = 0, end = double.NegativeInfinity;
                foreach (double[] sp in g.OrderBy(x => x[1]))
                {
                    double from = Math.Max(sp[1], end);
                    if (sp[2] > from) len += sp[2] - from;
                    end = Math.Max(end, sp[2]);
                }
                if (len >= minLen - 1e-9) result.Add(g.Average(x => x[0]));
            }
            return result;
        }
    }

    /// <summary>
    /// Баримт бичгийн хуудасны ЗОХИОМЖ (жишээ зургийн бүтэц) — ЦЭВЭР тооцоо, давхцалгүй:
    ///   • зүүн багана: дээр нь түлхүүр план, доор нь 3D (багтвал), дараа нь legend (багтвал);
    ///   • баруун талд дэлгээсүүд — мөрөөр (зүүнээс баруун, дээрээс доош), дарааллаа хадгална;
    ///   • перспективын байр — сүүлийн хуудасны ДООД мөрөнд (жишээ хуудас; сул зайд багтвал), эс бөгөөс дэлгээсүүдийн дараа;
    ///   • эхний хуудсанд багтахгүйг үргэлжлэлийн хуудсанд (бүтэн өргөнөөр); хуудаснаас том блок — өөрийн хуудсанд (Oversize).
    /// Зүүн багана хуудасны 45 %-иас өргөн бол багана хэрэглэхгүй (түлхүүр план нь ердийн блок болно).
    /// </summary>
    public static class WeSheetComposer
    {
        private sealed class Region
        {
            public int Page;
            public double MinX, MinY, MaxX, MaxY;
        }

        /// <param name="minRenderH">Рендерийн байрыг доод мөрөнд багтаахдаа жижигрүүлэх доод өндөр (0 = жижигрүүлэхгүй).</param>
        /// <param name="notchMaxX">Доод зурвасын саадын зүүн зах (<see cref="WeSheetFrame.Notch"/>); NaN = байхгүй.  Мөрийн бүх блок үүнээс зүүн
        /// талд бол мөр <paramref name="notchMinY"/> хүртэл доош орно.</param>
        /// <param name="axonInColumn">3D-г түлхүүр планы доор зүүн баганад (жишиг хуудас).  false — 3D урсгалд (дэлгээсүүдийн дараа): том өрөөнд
        /// 3D нь баганыг түлхүүр планаас 2 дахин өргөн болгож дэлгээсийн зайг шахдаг (ХЭМЖСЭН MITIC 211: эхний хуудсанд 4/10 дэлгээс).</param>
        /// <param name="renderPlacement">Рендерийн байр (2026-10-14, интерьерийн баг 3-р тойрог): сүүлийн хуудас (→ сүүлээсээ 2 дахь → хоёуланд хувааж →
        /// шинэ хуудас) эсвэл хуудас БҮРТ.  Ямар ч тохиолдолд байр ХАЯГДАХГҮЙ (өмнө нь сүүлийн хуудсанд багтахгүй бол чимээгүй алга болдог байв).
        /// <see cref="WeRenderPlacement.AllSheets"/>-д нэг рендер хэд хэдэн хуудсанд тус бүр слоттой (ижил Index, өөр Page).</param>
        public static List<WeSheetSlot> Compose(IList<WeComposeItem> items, double minX, double minY, double maxX, double maxY, double gap, double minRenderH = 0,
                                                double notchMaxX = double.NaN, double notchMinY = double.NaN, bool axonInColumn = true,
                                                WeRenderPlacement renderPlacement = WeRenderPlacement.LastSheet)
        {
            var slots = new List<WeSheetSlot>();
            if (items == null || items.Count == 0) return slots;
            double areaW = maxX - minX, areaH = maxY - minY;
            if (areaW <= 0 || areaH <= 0) throw new ArgumentException("Хуудасны ажлын талбай хоосон");
            var placed = new WeSheetSlot[items.Count];

            // ── Зүүн багана ──────────────────────────────────────────
            int key = Index(items, WeComposeKind.KeyPlan);
            var column = new List<int>();
            double colW = 0, colBottom = maxY;
            if (key >= 0 && items[key].W <= areaW * 0.45 + 1e-9 && items[key].H <= areaH + 1e-9)
            {
                column.Add(key);
                colW = items[key].W;
                colBottom = maxY - items[key].H;
                // 3D, дараа нь legend БҮР (2026-10-14: олон legend) — багтсан нь баганад, бусад нь урсгалд.
                var colCands = new List<int>();
                int axIdx = Index(items, WeComposeKind.Axon);
                if (axIdx >= 0 && axonInColumn) colCands.Add(axIdx);
                for (int li = 0; li < items.Count; li++) if (items[li] != null && items[li].Kind == WeComposeKind.Legend) colCands.Add(li);
                foreach (int i in colCands)
                {
                    WeComposeItem it = items[i];
                    double w = Math.Max(colW, it.W);
                    if (w > areaW * 0.45 + 1e-9 || colBottom - gap - it.H < minY - 1e-9) continue;
                    column.Add(i);
                    colW = w;
                    colBottom = colBottom - gap - it.H;
                }
                double y = maxY;
                foreach (int i in column)
                {
                    placed[i] = new WeSheetSlot { Index = i, Page = 0, CenterX = minX + items[i].W / 2, CenterY = y - items[i].H / 2 };
                    y = y - items[i].H - gap;
                }
            }

            // ── Урсгал: дэлгээс (дарааллаар), 3D/legend (баганад ороогүй бол), перспективын байр ──
            var flow = new List<int>();
            if (key >= 0 && !column.Contains(key)) flow.Add(key);
            for (int i = 0; i < items.Count; i++) if (items[i].Kind == WeComposeKind.Elevation) flow.Add(i);
            for (int i = 0; i < items.Count; i++)
                if (!column.Contains(i) && !flow.Contains(i) && items[i].Kind != WeComposeKind.Placeholder) flow.Add(i);
            for (int i = 0; i < items.Count; i++) if (items[i].Kind == WeComposeKind.Placeholder) flow.Add(i);

            var regions = new List<Region>();
            if (column.Count > 0)
            {
                regions.Add(new Region { Page = 0, MinX = minX + colW + gap, MinY = minY, MaxX = maxX, MaxY = maxY });
                if (colBottom - gap - minY > 1e-9) regions.Add(new Region { Page = 0, MinX = minX, MinY = minY, MaxX = minX + colW, MaxY = colBottom - gap });
            }
            else regions.Add(new Region { Page = 0, MinX = minX, MinY = minY, MaxX = maxX, MaxY = maxY });

            int ri = 0;
            Region r = regions[0];
            double x = r.MinX, top = r.MaxY;
            // Мөрийн өндөр: тэгшилсэн блокууд — шугамаас дээш (above) + доош (below); тэгшлээгүй — дээд захаар (plainH).
            double above = 0, below = 0, plainH = 0;
            var shelf = new List<int>();
            int rowId = 0;
            bool shelfEmpty = true, pageUsed = column.Count > 0;
            Func<double> rowHeight = () => Math.Max(above + below, plainH);
            Action resetShelf = () => { if (!shelfEmpty) rowId++; above = 0; below = 0; plainH = 0; shelf.Clear(); shelfEmpty = true; };
            Action next = () =>
            {
                ri++;
                if (ri >= regions.Count)
                {
                    int page = regions[regions.Count - 1].Page + 1;
                    regions.Add(new Region { Page = page, MinX = minX, MinY = minY, MaxX = maxX, MaxY = maxY });
                    pageUsed = false;
                }
                r = regions[ri];
                x = r.MinX; top = r.MaxY; resetShelf();
            };

            Action<int> place = i =>
            {
                double w = Math.Max(0, items[i].W), h = Math.Max(0, items[i].H);
                if (w > areaW + 1e-9 || h > areaH + 1e-9)
                {
                    // Хуудаснаас том: хоосон хуудсанд ганцаараа, дараагийнх нь шинэ хуудаснаас.
                    int pg = pageUsed ? regions.Max(z => z.Page) + 1 : r.Page;
                    placed[i] = new WeSheetSlot { Index = i, Page = pg, CenterX = minX + w / 2, CenterY = maxY - h / 2, Oversize = true };
                    regions.Add(new Region { Page = pg + 1, MinX = minX, MinY = minY, MaxX = maxX, MaxY = maxY });
                    ri = regions.Count - 1;
                    r = regions[ri];
                    x = r.MinX; top = r.MaxY; resetShelf(); pageUsed = false;
                    return;
                }
                bool aligned = items[i].Aligned;
                double bs = aligned ? items[i].Base : 0;
                for (int guard = 0; guard < 100000; guard++)
                {
                    double na = aligned ? Math.Max(above, bs) : above, nb = aligned ? Math.Max(below, h - bs) : below;
                    double np = aligned ? plainH : Math.Max(plainH, h);
                    // Доод хил БЛОК тус бүрээр: зурвасын саадын (title block-ийн хүснэгт) зүүн талын блок доош орж болно.  Шал тэгшлэх шугам
                    // доошилбол өмнөх тэгшилсэн блокууд ч доошилно — тэдгээрийг ч шалгана.
                    bool fits = x + w <= r.MaxX + 1e-9;
                    if (fits)
                    {
                        double line = top - na;
                        double bi = aligned ? line - (h - bs) : top - h;
                        if (bi < FloorAt(r, x + w, minY, notchMaxX, notchMinY) - 1e-9) fits = false;
                        foreach (int j in shelf)
                        {
                            if (!fits) break;
                            if (!items[j].Aligned) continue;
                            double bj = line - (Math.Max(0, items[j].H) - items[j].Base), rj = placed[j].CenterX + Math.Max(0, items[j].W) / 2;
                            if (bj < FloorAt(r, rj, minY, notchMaxX, notchMinY) - 1e-9) fits = false;
                        }
                    }
                    if (fits)
                    {
                        bool lineMoved = aligned && na > above + 1e-12;
                        above = na; below = nb; plainH = np;
                        double cy = aligned ? top - above + bs - h / 2 : top - h / 2;
                        placed[i] = new WeSheetSlot { Index = i, Page = r.Page, CenterX = x + w / 2, CenterY = cy, Row = rowId };
                        // Шугам доошилсон — өмнөх тэгшилсэн блокуудыг шинэ шугам руу.
                        if (lineMoved)
                            foreach (int j in shelf)
                                if (items[j].Aligned) placed[j].CenterY = top - above + items[j].Base - Math.Max(0, items[j].H) / 2;
                        shelf.Add(i);
                        x += w + gap;
                        shelfEmpty = false;
                        pageUsed = true;
                        break;
                    }
                    if (!shelfEmpty)
                    {
                        // Шинэ мөр (энэ бүсэд).
                        top = top - rowHeight() - gap;
                        x = r.MinX;
                        resetShelf();
                        continue;
                    }
                    next();   // хоосон мөрөнд ч багтахгүй — дараагийн бүс / хуудас
                }
            };

            List<int> renders = flow.Where(i => items[i].Kind == WeComposeKind.Placeholder).ToList();
            foreach (int i in flow) if (items[i].Kind != WeComposeKind.Placeholder) place(i);
            // Перспективын байр — жишээ хуудас шиг ХУУДАСНЫ ДООД мөрөнд (зүүнээс), шаардлагатай бол жижигрүүлж (≥ minRenderH).
            // ⚠️ 2026-10-14 (интерьерийн баг: «render-ийн хэсэг заримдаа олдохгүй»): өмнө нь сүүлийн хуудсанд багтахгүй бол байр ЧИМЭЭГҮЙ
            // хаягддаг байв (ХЭМЖСЭН: SheetTests-ийн A3 хувилбарт 2 рендерийн 2 нь алга).  Одоо хэзээ ч хаягдахгүй — <see cref="PlaceRenders"/>.
            var extra = new List<WeSheetSlot>();
            if (renders.Count > 0)
            {
                double colRight = column.Count > 0 ? minX + colW + gap : minX;
                Func<List<int>, int, List<WeSheetSlot>> row = (list, page) =>
                    RowOnPage(items, list, Occupied(items, placed, extra, page, gap), page, minX, minY, maxX, maxY, gap, colRight, minRenderH);
                if (!PlaceRenders(items, renders, placed, extra, row, renderPlacement))
                    foreach (int i in renders) place(i);   // маш жижиг хуудас — ердийн урсгалаар (хаяхгүй)
            }

            for (int i = 0; i < placed.Length; i++)
                if (placed[i] != null) slots.Add(placed[i]);
            slots.AddRange(extra);
            return slots.OrderBy(s => s.Index).ThenBy(s => s.Page).ToList();
        }

        /// <summary>
        /// Рендерийн байрын дараалал.  <see cref="WeRenderPlacement.LastSheet"/>: сүүлийн хуудас → сүүлээсээ 2 дахь → хоёуланд хувааж (эхний хэсэг нь
        /// өмнөх хуудсанд — дугаар хуудасны дарааллаар) → дараагийн ХООСОН хуудас (зөвхөн тэр үед шинэ хуудас).  <see cref="WeRenderPlacement.AllSheets"/>:
        /// хуудас бүрийн доод мөрөнд багтах хэдийг ч (01, 02 … дарааллаар); нэг ч хуудсанд багтахгүй бол LastSheet-ийн дараалал.  true = байрлав.
        /// </summary>
        private static bool PlaceRenders(IList<WeComposeItem> items, List<int> renders, WeSheetSlot[] placed, List<WeSheetSlot> extra,
                                         Func<List<int>, int, List<WeSheetSlot>> row, WeRenderPlacement mode)
        {
            bool any = false;
            int lastPage = 0;
            for (int i = 0; i < placed.Length; i++)
                if (placed[i] != null) { any = true; lastPage = Math.Max(lastPage, placed[i].Page); }
            if (mode == WeRenderPlacement.AllSheets && any)
            {
                for (int p = 0; p <= lastPage; p++)
                {
                    if (!placed.Any(s => s != null && s.Page == p)) continue;
                    List<WeSheetSlot> got = null;
                    for (int n = renders.Count; n >= 1 && got == null; n--) got = row(renders.Take(n).ToList(), p);
                    if (got != null) extra.AddRange(got);
                }
                if (extra.Count > 0) return true;
            }
            List<WeSheetSlot> res = row(renders, lastPage);
            if (res == null && lastPage >= 1) res = row(renders, lastPage - 1);
            if (res == null && lastPage >= 1)
                for (int n = renders.Count - 1; n >= 1 && res == null; n--)
                {
                    List<WeSheetSlot> a = row(renders.Take(n).ToList(), lastPage - 1);
                    List<WeSheetSlot> b = a != null ? row(renders.Skip(n).ToList(), lastPage) : null;
                    if (b != null) res = a.Concat(b).ToList();
                }
            if (res == null) res = row(renders, any ? lastPage + 1 : lastPage);
            if (res == null) return false;
            foreach (WeSheetSlot sl in res) placed[sl.Index] = sl;
            return true;
        }

        /// <summary>Хуудсан дээр эзлэгдсэн тэгш өнцөгтүүд (завсартай) — байрлуулсан блок + рендер (жижигрүүлсэн бол бодит хэмжээ).</summary>
        private static List<double[]> Occupied(IList<WeComposeItem> items, WeSheetSlot[] placed, List<WeSheetSlot> extra, int page, double gap)
        {
            var occ = new List<double[]>();
            foreach (WeSheetSlot p in placed.Concat(extra))
            {
                if (p == null || p.Page != page) continue;
                double w = p.W > 0 ? p.W : Math.Max(0, items[p.Index].W), h = p.H > 0 ? p.H : Math.Max(0, items[p.Index].H);
                occ.Add(new[] { p.CenterX - w / 2 - gap, p.CenterY - h / 2 - gap, p.CenterX + w / 2 + gap, p.CenterY + h / 2 + gap });
            }
            return occ;
        }

        /// <summary>
        /// <paramref name="row"/>-ыг <paramref name="page"/> хуудасны ДООД мөрөнд (зүүн захаас, баганын баруунаас эсвэл блок бүрийн баруунаас) нэг
        /// мөрөөр — шаардлагатай бол жижигрүүлж (≥ <paramref name="minRenderH"/>).  Бичихгүй; багтахгүй бол null.
        /// </summary>
        private static List<WeSheetSlot> RowOnPage(IList<WeComposeItem> items, List<int> row, List<double[]> occ, int page, double minX, double minY,
                                                   double maxX, double maxY, double gap, double rightOfColumn, double minRenderH)
        {
            if (row.Count == 0) return new List<WeSheetSlot>();
            double rowW0 = row.Sum(i => Math.Max(0, items[i].W)), rowH0 = row.Max(i => Math.Max(0, items[i].H));
            // Зүүн захаас эсвэл баганын баруунаас; эс бөгөөс хуудсан дээрх блок бүрийн баруун талаас (ХЭМЖСЭН БА429: 310H доод мөрийн зүүн
            // хэсгийг эзэлсэн тул перспективын байр огт тавигдаагүй).
            foreach (double x0 in new[] { minX, rightOfColumn }.Concat(occ.Select(o => o[2]).OrderBy(v => v)).Distinct())
            {
                // Масштаб: 1 (бүтэн хэмжээ) эсвэл доод сул зайд багтах хэмжээгээр (≥ minRenderH өндөр).
                double k = Math.Min(1, (maxX - x0 - gap * (row.Count - 1)) / Math.Max(1e-9, rowW0));
                for (int iter = 0; iter < 3 && k > 0; iter++)
                {
                    double x1t = x0 + rowW0 * k + gap * (row.Count - 1);
                    double free = maxY - minY;
                    foreach (double[] o in occ)
                        if (x0 < o[2] - 1e-9 && o[0] < x1t - 1e-9) free = Math.Min(free, o[1] - minY);
                    k = Math.Min(k, free / Math.Max(1e-9, rowH0));
                }
                if (k <= 0 || (k < 1 - 1e-9 && (minRenderH <= 0 || rowH0 * k < minRenderH - 1e-9))) continue;
                double rowW = rowW0 * k + gap * (row.Count - 1), rowH = rowH0 * k;
                double x1 = x0 + rowW, y0 = minY, y1 = minY + rowH;
                if (x1 > maxX + 1e-9 || y1 > maxY + 1e-9) continue;
                if (occ.Any(o => x0 < o[2] - 1e-9 && o[0] < x1 - 1e-9 && y0 < o[3] - 1e-9 && o[1] < y1 - 1e-9)) continue;
                double x = x0;
                var res = new List<WeSheetSlot>();
                foreach (int i in row)
                {
                    double w = Math.Max(0, items[i].W) * k, h = Math.Max(0, items[i].H) * k;
                    res.Add(new WeSheetSlot { Index = i, Page = page, CenterX = x + w / 2, CenterY = y0 + h / 2, W = k < 1 - 1e-9 ? w : 0, H = k < 1 - 1e-9 ? h : 0 });
                    x += w + gap;
                }
                return res;
            }
            return null;
        }

        private static double FloorAt(Region r, double right, double minY, double notchMaxX, double notchMinY)
        {
            return !double.IsNaN(notchMaxX) && !double.IsNaN(notchMinY) && r.MinY <= minY + 1e-9 && right <= notchMaxX + 1e-9 ? Math.Min(r.MinY, notchMinY) : r.MinY;
        }

        private static int Index(IList<WeComposeItem> items, string kind)
        {
            for (int i = 0; i < items.Count; i++) if (items[i] != null && items[i].Kind == kind) return i;
            return -1;
        }
    }
}
