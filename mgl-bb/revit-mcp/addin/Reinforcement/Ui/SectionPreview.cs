using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Windows;
using System.Windows.Media;
using RevitMcpAddin.Reinforcement.Core;

namespace RevitMcpAddin.Reinforcement.Ui
{
    /// <summary>
    /// Төлөвлөгөөний (<see cref="RfSectionPlan"/>) схем зураг: бетон хүрээ, хомут, арматурын цэгүүд, хэмжээс (утгатай),
    /// tag хайрцаг + leader.  Зөвхөн Core-ийн өгөгдлөөс зурна — Revit-д хүрэхгүй, тиймээс сонголт өөрчлөгдөх бүрд
    /// шууд шинэчлэгдэнэ.  Энэ нь ЖИНХЭНЭ зургийн урьдчилсан харагдац (байрлал, зай) — Revit дээрх tag-ийн бодит
    /// хэмжээ family-аас хамаарна.
    /// </summary>
    internal sealed class SectionPreview : FrameworkElement
    {
        private RfSectionPlan _plan;
        private string _unitLabel = "mm";

        private static readonly Brush Concrete = Frozen(Color.FromRgb(0xEE, 0xEE, 0xEE));
        private static readonly Pen ConcretePen = FrozenPen(Color.FromRgb(0x40, 0x40, 0x40), 1.6);
        private static readonly Pen StirrupPen = FrozenPen(Color.FromRgb(0x2E, 0x9E, 0x6B), 1.4);
        private static readonly Brush BarBrush = Frozen(Color.FromRgb(0x4A, 0x7F, 0xA5));
        private static readonly Pen DimPen = FrozenPen(Color.FromRgb(0xB8, 0x73, 0x33), 1.0);
        private static readonly Brush DimText = Frozen(Color.FromRgb(0xB8, 0x73, 0x33));
        private static readonly Pen TagPen = FrozenPen(Color.FromRgb(0x8E, 0x6F, 0xD8), 1.0);
        private static readonly Brush TagFill = Frozen(Color.FromArgb(40, 0x8E, 0x6F, 0xD8));

        public SectionPreview()
        {
            MinHeight = 260;
            ClipToBounds = true;
        }

        public void SetPlan(RfSectionPlan plan, string unitLabel)
        {
            _plan = plan;
            _unitLabel = unitLabel ?? "mm";
            InvalidateVisual();
        }

        private static Brush Frozen(Color c)
        {
            var b = new SolidColorBrush(c);
            b.Freeze();
            return b;
        }

        private static Pen FrozenPen(Color c, double w)
        {
            var p = new Pen(new SolidColorBrush(c), w);
            p.Freeze();
            return p;
        }

        protected override void OnRender(DrawingContext dc)
        {
            base.OnRender(dc);
            var bg = new Rect(0, 0, ActualWidth, ActualHeight);
            dc.DrawRectangle(Brushes.White, new Pen(Brushes.LightGray, 1), bg);
            if (_plan == null || !_plan.Rect.Valid || ActualWidth < 20 || ActualHeight < 20) return;

            RfSectionRect r = _plan.Rect;
            RfSectionFrame fr = _plan.Frame;

            // ⚠️ ХАРАГДАЦЫН координатад зурна (Revit дээр харагдахтай ЯГ ИЖИЛ): эргэсэн гишүүн эргэсэн хэвээр, хэмжээс
            // гишүүний тэнхлэгийн дагуу, харин tag-ийн хайрцаг ХЭВТЭЭ.
            Func<double, double, RfV2> V = (a, b) => fr.ToView(new RfV2(a, b));

            // Бүх зүйлийн хүрээ (харагдацын u, v, фут)
            double minU = double.MaxValue, minV = double.MaxValue, maxU = double.MinValue, maxV = double.MinValue;
            Action<RfV2> grow = p =>
            {
                if (p.X < minU) minU = p.X;
                if (p.X > maxU) maxU = p.X;
                if (p.Y < minV) minV = p.Y;
                if (p.Y > maxV) maxV = p.Y;
            };
            foreach (double a in new[] { r.MinU, r.MaxU })
                foreach (double b in new[] { r.MinV, r.MaxV }) grow(V(a, b));
            foreach (RfDimChain ch in _plan.Chains)
            {
                foreach (RfChainRef cr in ch.Refs)
                    grow(ch.AlongU ? V(cr.Pos, ch.LinePos) : V(ch.LinePos, cr.Pos));
            }
            foreach (RfTagPlan t in _plan.Tags)
            {
                RfV2 h = fr.ToView(t.Head);
                grow(new RfV2(h.X - t.Width / 2, h.Y - t.Height / 2));
                grow(new RfV2(h.X + t.Width / 2, h.Y + t.Height / 2));
            }
            double w = Math.Max(maxU - minU, 1e-6), hgt = Math.Max(maxV - minV, 1e-6);
            double pad = 26;
            double s = Math.Min((ActualWidth - 2 * pad) / w, (ActualHeight - 2 * pad) / hgt);
            double ox = (ActualWidth - w * s) / 2 - minU * s;
            double oy = (ActualHeight - hgt * s) / 2 + maxV * s; // v дээш → дэлгэц доош
            Func<RfV2, Point> P = v => new Point(ox + v.X * s, oy - v.Y * s);

            Func<double, double, double, double, StreamGeometry> poly = (a0, b0, a1, b1) =>
            {
                var g = new StreamGeometry();
                using (StreamGeometryContext c = g.Open())
                {
                    c.BeginFigure(P(V(a0, b0)), true, true);
                    c.LineTo(P(V(a1, b0)), true, false);
                    c.LineTo(P(V(a1, b1)), true, false);
                    c.LineTo(P(V(a0, b1)), true, false);
                }
                g.Freeze();
                return g;
            };

            // Бетон
            dc.DrawGeometry(Concrete, ConcretePen, poly(r.MinU, r.MinV, r.MaxU, r.MaxV));

            // Хомутууд
            foreach (RfStirrupLoop l in _plan.Loops)
                dc.DrawGeometry(null, StirrupPen, poly(l.MinU, l.MinV, l.MaxU, l.MaxV));

            // Ажлын арматур
            foreach (RfLongBar b in _plan.Bars)
            {
                double rad = Math.Max(2.5, b.Diameter * s / 2);
                dc.DrawEllipse(BarBrush, null, P(V(b.Pos.X, b.Pos.Y)), rad, rad);
            }

            // Хэмжээс: тэнхлэг бүрт НЭГ ГИНЖ — нэг шугам, лавлагаа бүрд хөндлөн тэмдэг, сегмент бүрд утга (ж. | 26 | 248 | 26 |).
            foreach (RfDimChain ch in _plan.Chains)
            {
                if (ch.Refs.Count < 2) continue;
                Func<RfChainRef, Point> at = cr => P(fr.ToView(ch.AlongU ? new RfV2(cr.Pos, ch.LinePos) : new RfV2(ch.LinePos, cr.Pos)));
                Point first = at(ch.Refs[0]), last = at(ch.Refs[ch.Refs.Count - 1]);
                dc.DrawLine(DimPen, first, last);
                Vector axis = last - first;
                Vector n = axis.Length > 1e-6 ? new Vector(-axis.Y, axis.X) / axis.Length * 5 : new Vector(0, 5);

                for (int i = 0; i < ch.Refs.Count; i++)
                {
                    RfChainRef cr = ch.Refs[i];
                    Point p = at(cr);
                    dc.DrawLine(DimPen, p - n, p + n);

                    // Бетон нүүр / хомутын ирмэгээс хэмжээсийн шугам хүртэл туслах шугам
                    RfV2 near = ch.AlongU
                        ? new RfV2(cr.Pos, cr.Kind == RfChainRefKind.Face ? r.MaxV : _plan.Loops.Count > 0 ? _plan.Loops.Max(l => l.MaxV) : r.MaxV)
                        : new RfV2(cr.Kind == RfChainRefKind.Face ? r.MaxU : _plan.Loops.Count > 0 ? _plan.Loops.Max(l => l.MaxU) : r.MaxU, cr.Pos);
                    dc.DrawLine(DimPen, P(fr.ToView(near)), p);

                    if (i + 1 >= ch.Refs.Count) continue;
                    Point q = at(ch.Refs[i + 1]);
                    double mm = (ch.Refs[i + 1].Pos - cr.Pos) * RfTol.MmPerFoot;
                    string txt = mm.ToString("0.#", CultureInfo.InvariantCulture);
                    var ft = new FormattedText(txt, CultureInfo.InvariantCulture, FlowDirection.LeftToRight,
                        new Typeface("Segoe UI"), 11, DimText, 1.0);
                    Point mid = new Point((p.X + q.X) / 2, (p.Y + q.Y) / 2);
                    Vector dir = q - p;
                    Vector off = dir.Length > 1e-6 ? new Vector(dir.Y, -dir.X) / dir.Length * 12 : new Vector(0, -12);
                    if (off.Y > 0) off = -off; // бичвэр дандаа дээш
                    dc.DrawText(ft, new Point(mid.X + off.X - ft.Width / 2, mid.Y + off.Y - ft.Height / 2));
                }
            }

            // Tag: хэвтээ хайрцаг + leader
            foreach (RfTagPlan t in _plan.Tags)
            {
                Point head = P(fr.ToView(t.Head));
                Point tgt = P(fr.ToView(t.Target));
                var box = new Rect(head.X - t.Width * s / 2, head.Y - t.Height * s / 2, t.Width * s, t.Height * s);
                dc.DrawLine(TagPen, head, tgt);
                dc.DrawRectangle(TagFill, TagPen, box);
                var ft = new FormattedText(t.IsStirrup ? "Ø" : "Ø", CultureInfo.InvariantCulture, FlowDirection.LeftToRight,
                    new Typeface("Segoe UI"), 9, Brushes.Black, 1.0);
                dc.DrawText(ft, new Point(box.X + box.Width / 2 - ft.Width / 2, box.Y + box.Height / 2 - ft.Height / 2));
            }
        }
    }
}
