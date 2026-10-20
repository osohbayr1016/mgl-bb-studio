using System;
using System.Collections.Generic;

namespace RevitMcpAddin.WallElevation.Core
{
    /// <summary>Хуудсан дээрх тэгш өнцөгт (дотоод нэгж, хуудасны координат).</summary>
    public struct WeRect
    {
        public double MinX, MinY, MaxX, MaxY;

        public WeRect(double minX, double minY, double maxX, double maxY)
        {
            MinX = Math.Min(minX, maxX); MaxX = Math.Max(minX, maxX);
            MinY = Math.Min(minY, maxY); MaxY = Math.Max(minY, maxY);
        }

        public static WeRect Around(double cx, double cy, double w, double h)
        {
            return new WeRect(cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2);
        }

        public double W { get { return MaxX - MinX; } }
        public double H { get { return MaxY - MinY; } }
        public double Cx { get { return (MinX + MaxX) / 2; } }
        public double Cy { get { return (MinY + MaxY) / 2; } }
        public double Area { get { return Math.Max(0, W) * Math.Max(0, H); } }

        public double Overlap(WeRect o)
        {
            double w = Math.Min(MaxX, o.MaxX) - Math.Max(MinX, o.MinX), h = Math.Min(MaxY, o.MaxY) - Math.Max(MinY, o.MinY);
            return w > 0 && h > 0 ? w * h : 0;
        }

        public bool Contains(double x, double y, double margin)
        {
            return x >= MinX - margin && x <= MaxX + margin && y >= MinY - margin && y <= MaxY + margin;
        }
    }

    /// <summary>Хуудсан дээрх шулуун (detail line) — хоёр үзүүр.</summary>
    public struct WeSegment2
    {
        public double X0, Y0, X1, Y1;
        public WeSegment2(double x0, double y0, double x1, double y1) { X0 = x0; Y0 = y0; X1 = x1; Y1 = y1; }
    }

    /// <summary>
    /// Перспектив / рендерийн БАЙР руу зураг «Canva шиг» оруулах (2026-10-14, интерьерийн баг: «render зургийг ойртуулахад тухайн хэсэгт
    /// автоматаар fill хийж ордог болго»).  Цэвэр дүрэм: (1) хуудсан дээрх байр = «ХАРАГДАХ БАЙДАЛ NN» бичвэрийг тойрсон 4 шулуун
    /// (<c>WeSheetService.DrawPlaceholder</c>-ийн зурдаг тэгш өнцөгт — хэрэглэгч зөөсөн ч олдоно); (2) аль байранд «ойртуулсан» бэ — зургийн
    /// төв байрны дотор (захаас <c>margin</c>) эсвэл зургийн талбайн 30%+ давхцсан; (3) байрыг бүтэн дүүргэх ТАЙРАЛТ — зургийн төвөөс, байрны
    /// харьцаагаар (cover: хоосон зай үлдэхгүй, зураг байрнаас хальж гарахгүй).
    /// </summary>
    public static class WeImageSlots
    {
        /// <summary>Байрны бичвэрийн эхлэл (<c>DrawPlaceholder</c>-тэй ИЖИЛ).</summary>
        public const string LabelPrefix = "ХАРАГДАХ БАЙДАЛ";

        /// <summary>Зургийн талбайн хэдэн хувь байртай давхцвал «байранд оруулсан» гэж үзэх.</summary>
        public const double OverlapShare = 0.30;

        public static bool IsLabel(string text)
        {
            return !string.IsNullOrEmpty(text) && text.TrimStart().StartsWith(LabelPrefix, StringComparison.Ordinal);
        }

        /// <summary>«ХАРАГДАХ БАЙДАЛ 03 …» → 3; дугааргүй бол 0.</summary>
        public static int LabelNumber(string text)
        {
            if (!IsLabel(text)) return 0;
            string rest = text.TrimStart().Substring(LabelPrefix.Length).TrimStart();
            int n = 0, i = 0;
            while (i < rest.Length && char.IsDigit(rest[i]) && i < 4) { n = n * 10 + (rest[i] - '0'); i++; }
            return n;
        }

        /// <summary>
        /// Бичвэрийн цэгийг (<paramref name="lx"/>, <paramref name="ly"/>) тойрсон ХАМГИЙН ОЙР тэгш өнцөгт: зүүн/баруун босоо, доод/дээд хэвтээ шулуун —
        /// шулуун бүр бичвэрийн координатыг хамарсан, хэвтээ нь зүүнээс баруун хүртэл, босоо нь доороос дээш хүртэл.  Олдохгүй бол null.
        /// </summary>
        public static WeRect? SlotAround(IList<WeSegment2> lines, double lx, double ly, double tol)
        {
            if (lines == null || lines.Count < 4) return null;
            double left = double.NegativeInfinity, right = double.PositiveInfinity, bottom = double.NegativeInfinity, top = double.PositiveInfinity;
            foreach (WeSegment2 s in lines)
            {
                bool horizontal = Math.Abs(s.Y0 - s.Y1) <= tol && Math.Abs(s.X0 - s.X1) > tol;
                bool vertical = Math.Abs(s.X0 - s.X1) <= tol && Math.Abs(s.Y0 - s.Y1) > tol;
                if (horizontal && Math.Min(s.X0, s.X1) <= lx + tol && Math.Max(s.X0, s.X1) >= lx - tol)
                {
                    double y = (s.Y0 + s.Y1) / 2;
                    if (y < ly && y > bottom) bottom = y;
                    if (y > ly && y < top) top = y;
                }
                else if (vertical && Math.Min(s.Y0, s.Y1) <= ly + tol && Math.Max(s.Y0, s.Y1) >= ly - tol)
                {
                    double x = (s.X0 + s.X1) / 2;
                    if (x < lx && x > left) left = x;
                    if (x > lx && x < right) right = x;
                }
            }
            if (double.IsInfinity(left) || double.IsInfinity(right) || double.IsInfinity(bottom) || double.IsInfinity(top)) return null;
            var r = new WeRect(left, bottom, right, top);
            if (r.W <= tol * 4 || r.H <= tol * 4) return null;
            // Тал бүр бүтэн тэгш өнцөгтийн шугам байх ёстой (санамсаргүй шугамаас тойрог тогтоохгүй).
            if (!Spans(lines, r, tol)) return null;
            return r;
        }

        private static bool Spans(IList<WeSegment2> lines, WeRect r, double tol)
        {
            bool b = false, t = false, l = false, rt = false;
            foreach (WeSegment2 s in lines)
            {
                double x0 = Math.Min(s.X0, s.X1), x1 = Math.Max(s.X0, s.X1), y0 = Math.Min(s.Y0, s.Y1), y1 = Math.Max(s.Y0, s.Y1);
                bool hz = Math.Abs(s.Y0 - s.Y1) <= tol, vt = Math.Abs(s.X0 - s.X1) <= tol;
                bool spanX = x0 <= r.MinX + tol && x1 >= r.MaxX - tol, spanY = y0 <= r.MinY + tol && y1 >= r.MaxY - tol;
                if (hz && spanX && Math.Abs(y0 - r.MinY) <= tol) b = true;
                if (hz && spanX && Math.Abs(y0 - r.MaxY) <= tol) t = true;
                if (vt && spanY && Math.Abs(x0 - r.MinX) <= tol) l = true;
                if (vt && spanY && Math.Abs(x0 - r.MaxX) <= tol) rt = true;
            }
            return b && t && l && rt;
        }

        /// <summary>
        /// Зураг аль байранд «орсон» бэ: зургийн төв байрны дотор (захаас <paramref name="margin"/>-аар томруулсан) эсвэл давхцал ≥ зургийн 30%.
        /// Хэд хэдэн тохирвол давхцал ихтэй, дараа нь төв ойр нь.  Аль нь ч биш бол −1.
        /// </summary>
        public static int Target(WeRect image, IList<WeRect> slots, double margin)
        {
            if (slots == null) return -1;
            int best = -1;
            double bestOverlap = -1, bestDist = double.MaxValue;
            for (int i = 0; i < slots.Count; i++)
            {
                WeRect s = slots[i];
                double ov = image.Overlap(s);
                bool centerIn = s.Contains(image.Cx, image.Cy, margin);
                bool enough = image.Area > 0 && ov >= OverlapShare * image.Area;
                if (!centerIn && !enough) continue;
                double dist = Math.Sqrt((image.Cx - s.Cx) * (image.Cx - s.Cx) + (image.Cy - s.Cy) * (image.Cy - s.Cy));
                if (ov > bestOverlap + 1e-12 || (Math.Abs(ov - bestOverlap) <= 1e-12 && dist < bestDist))
                {
                    best = i;
                    bestOverlap = ov;
                    bestDist = dist;
                }
            }
            return best;
        }

        /// <summary>Зураг байрыг аль хэдийн ЯГ дүүргэсэн (төв, өргөн, өндөр — <paramref name="tol"/> дотор).</summary>
        public static bool Fills(WeRect image, WeRect slot, double tol)
        {
            return Math.Abs(image.Cx - slot.Cx) <= tol && Math.Abs(image.Cy - slot.Cy) <= tol
                   && Math.Abs(image.W - slot.W) <= tol && Math.Abs(image.H - slot.H) <= tol;
        }

        /// <summary>Зургийн харьцаа байрныхтай (харьцангуй <paramref name="rel"/> дотор) тэнцүү — тайрах шаардлагагүй.</summary>
        public static bool SameAspect(double w, double h, WeRect slot, double rel)
        {
            if (w <= 0 || h <= 0 || slot.W <= 0 || slot.H <= 0) return false;
            double a = w / h, b = slot.W / slot.H;
            return Math.Abs(a - b) <= rel * b;
        }

        /// <summary>
        /// Байрыг бүтэн дүүргэх ТАЙРАЛТ (пикселээр, зургийн төвөөс): харьцаа нь байрных, аль нэг тал нь зургийн бүтэн тал.
        /// </summary>
        public static void CropFor(int pxW, int pxH, double slotW, double slotH, out int x, out int y, out int w, out int h)
        {
            x = 0; y = 0; w = Math.Max(1, pxW); h = Math.Max(1, pxH);
            if (pxW <= 0 || pxH <= 0 || slotW <= 0 || slotH <= 0) return;
            double aspect = slotW / slotH;
            if ((double)pxW / pxH > aspect)
            {
                w = Math.Max(1, Math.Min(pxW, (int)Math.Round(pxH * aspect)));
                x = (pxW - w) / 2;
            }
            else
            {
                h = Math.Max(1, Math.Min(pxH, (int)Math.Round(pxW / aspect)));
                y = (pxH - h) / 2;
            }
        }
    }
}
