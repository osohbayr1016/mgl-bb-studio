using System;
using System.Collections.Generic;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Shapes;
using MglBb.Core;
using WLine = System.Windows.Shapes.Line;
using WRect = System.Windows.Shapes.Rectangle;
using WPolyline = System.Windows.Shapes.Polyline;
using WEllipse = System.Windows.Shapes.Ellipse;

namespace MglBb.BeamRebar
{
    /// <summary>
    /// Цонхны урьдчилсан зураг (Revit-гүй, зөвхөн Core-ийн төлөвлөгөөнөөс): дамнурууны фасад (тулгуур, туслах, ажлын / нэмэлт / голын арматур,
    /// хомут) + тулгуур дээрх огтлол; баганы огтлол + босоо зам.  Масштаб автоматаар.
    /// </summary>
    internal sealed class RebarPreview : Canvas
    {
        static readonly Brush Concrete = new SolidColorBrush(Color.FromRgb(0xEE, 0xEE, 0xEE)), Support = new SolidColorBrush(Color.FromRgb(0xC8, 0xC8, 0xC8));
        static readonly Brush TopBar = Brushes.Firebrick, BotBar = Brushes.RoyalBlue, Minor = Brushes.DarkOrange, Tie = Brushes.SeaGreen, Bent = Brushes.Purple;

        public RebarPreview()
        {
            Background = Brushes.White;
            ClipToBounds = true;
            Height = 230;
        }

        public void Clear(string text)
        {
            Children.Clear();
            Add(new TextBlock { Text = text, Foreground = Brushes.Gray }, 8, 8);
        }

        void Add(UIElement e, double x, double y) { SetLeft(e, x); SetTop(e, y); Children.Add(e); }

        void Line(double x0, double y0, double x1, double y1, Brush b, double w = 1)
        {
            Children.Add(new WLine { X1 = x0, Y1 = y0, X2 = x1, Y2 = y1, Stroke = b, StrokeThickness = w });
        }

        void Box(double x0, double y0, double x1, double y1, Brush fill, Brush stroke)
        {
            Add(new WRect { Width = Math.Max(1, x1 - x0), Height = Math.Max(1, y1 - y0), Fill = fill, Stroke = stroke, StrokeThickness = 0.8 }, x0, y0);
        }

        void Dot(double x, double y, double r, Brush b) { Add(new WEllipse { Width = 2 * r, Height = 2 * r, Fill = b }, x - r, y - r); }

        void Label(string t, double x, double y, Brush b = null, double size = 11)
        {
            Add(new TextBlock { Text = t, FontSize = size, Foreground = b ?? Brushes.Black }, x, y);
        }

        /// <summary>Дамнуруу: фасад зүүн ⅔-т, огтлол (эхний дунд тулгуур эсвэл 1-р алгаслын төв) баруун ⅓-т.</summary>
        public void ShowBeam(BbBeamInput beam, BbBeamPreset p, string title, bool[] enabled = null)
        {
            Children.Clear();
            // Унтраасан алгасалтай бол асаалттай хэсгүүдийг тус тусд нь (үүсгэхтэй адил) тооцоод нэг зурагт нэгтгэнэ.
            var parts = BbBeamRebarPlan.SplitBySpans(beam, enabled);
            BbBeamRebar r = new BbBeamRebar();
            foreach (var pt in parts)
            {
                BbBeamRebar q = BbBeamRebarPlan.Plan(pt.Item2, p);
                double dx = pt.Item1;
                foreach (BbBarRun b in q.Bars) { b.X0 += dx; b.X1 += dx; r.Bars.Add(b); }
                foreach (BbStirrupSet s in q.Stirrups) { s.X0 += dx; r.Stirrups.Add(s); }
                foreach (BbBentBar b in q.Bent) { b.X += dx; r.Bent.Add(b); }
                foreach (BbSupport s in q.Spans) r.Spans.Add(new BbSupport(s.Lo + dx, s.Hi + dx));
                r.Warnings.AddRange(q.Warnings);
                if (r.StirrupShapes.Count == 0) { r.StirrupShapes.AddRange(q.StirrupShapes); r.StirrupWidths.AddRange(q.StirrupWidths); r.StirrupD = q.StirrupD; r.S1 = q.S1; r.S2 = q.S2; r.CoverTop = q.CoverTop; r.CoverBottom = q.CoverBottom; r.TieZ = q.TieZ; }
            }
            double W = Math.Max(400, ActualWidth > 0 ? ActualWidth : 1100), H = Height;
            double elevW = W * 0.72 - 20, pad = 12;
            List<BbSupport> sup = BbBeamRebarPlan.MergeSupports(beam.Supports);
            double s0 = Math.Min(0, sup.Count > 0 ? sup.Min(s => s.Lo) : 0), s1 = Math.Max(beam.Length, sup.Count > 0 ? sup.Max(s => s.Hi) : beam.Length);
            double kx = (elevW - 2 * pad) / Math.Max(1, s1 - s0);
            double kz = Math.Min((H - 70) / Math.Max(1, beam.H), kx * 6);   // босоо хэмжээг томруулна (харагдахуйц)
            double ox = pad, oy = 36 + beam.H * kz;   // доод нүүр
            Func<double, double> X = s => ox + (s - s0) * kx;
            Func<double, double> Z = z => oy - z * kz;

            Label(title + " — " + Math.Round(beam.B) + "×" + Math.Round(beam.H) + ", алгасал " + Math.Max(0, sup.Count - 1) + ", хомут Ø" + r.StirrupD
                + " @" + r.S1 + "/" + r.S2 + (r.Warnings.Count > 0 ? "   ⚠ " + r.Warnings.Count : ""), 8, 4, null, 12);
            foreach (BbSupport s in sup) Box(X(s.Lo), Z(beam.H) - 10, X(s.Hi), Z(0) + 14, Support, null);
            Box(X(0), Z(beam.H), X(beam.Length), Z(0), Concrete, Brushes.Gray);
            foreach (BbLoadPoint lp in beam.LoadPoints) Box(X(lp.Lo), Z(beam.H), X(lp.Hi), Z(beam.H - lp.SoffitDepth), Support, Brushes.Gray);

            foreach (BbStirrupSet st in r.Stirrups)
                for (int i = 0; i < st.Count; i++)
                {
                    double x = st.X0 + i * st.Spacing;
                    Line(X(x), Z(beam.H - r.CoverTop), X(x), Z(r.CoverBottom), Tie, 0.6);
                }
            foreach (BbBarRun b in r.Bars)
            {
                bool top = b.Role == BbRunRole.Top || b.Role == BbRunRole.AddTop || b.Role == BbRunRole.SpanTop;
                Brush br = b.Role == BbRunRole.SpanTop || b.Role == BbRunRole.Side ? Minor : top ? TopBar : BotBar;
                double sg = top ? -1 : 1;
                var pl = new WPolyline { Stroke = br, StrokeThickness = b.Role == BbRunRole.Side ? 1 : 1.8 };
                if (b.Role == BbRunRole.Side) pl.StrokeDashArray = new DoubleCollection { 4, 3 };
                if (b.HookStart > 0) pl.Points.Add(new Point(X(b.X0), Z(b.Z + sg * b.HookStart)));
                pl.Points.Add(new Point(X(b.X0), Z(b.Z)));
                pl.Points.Add(new Point(X(b.X1), Z(b.Z)));
                if (b.HookEnd > 0) pl.Points.Add(new Point(X(b.X1), Z(b.Z + sg * b.HookEnd)));
                Children.Add(pl);
            }
            foreach (BbBentBar bb in r.Bent)
            {
                var pl = new WPolyline { Stroke = Bent, StrokeThickness = 1.5 };
                foreach (double[] q in new[]
                {
                    new[] { bb.X0, bb.ZHigh }, new[] { bb.X - bb.Flat / 2 - bb.Run, bb.ZHigh }, new[] { bb.X - bb.Flat / 2, bb.ZLow },
                    new[] { bb.X + bb.Flat / 2, bb.ZLow }, new[] { bb.X + bb.Flat / 2 + bb.Run, bb.ZHigh }, new[] { bb.X1, bb.ZHigh },
                })
                    pl.Points.Add(new Point(X(q[0]), Z(q[1])));
                Children.Add(pl);
            }

            // Унтраасан алгасал — саарал, «үүсгэхгүй».
            List<BbSupport> inner = BbBeamRebarPlan.InteriorSpans(beam);
            for (int i = 0; enabled != null && i < inner.Count && i < enabled.Length; i++)
                if (!enabled[i])
                {
                    Box(X(inner[i].Lo), Z(beam.H) - 6, X(inner[i].Hi), Z(0) + 6, new SolidColorBrush(Color.FromArgb(150, 0xFF, 0xFF, 0xFF)), Brushes.Silver);
                    Label("үүсгэхгүй", (X(inner[i].Lo) + X(inner[i].Hi)) / 2 - 24, Z(beam.H / 2) - 7, Brushes.Gray, 11);
                }

            // Огтлол: эхний дунд тулгуурын нүүрнээс 100 (эсвэл 1-р алгаслын төв).
            double xs = sup.Count > 2 ? sup[1].Hi + 100 : r.Spans.Count > 0 ? r.Spans[0].Mid : beam.Length / 2;
            Line(X(xs), Z(beam.H) - 14, X(xs), Z(0) + 14, Brushes.Black, 0.8);
            Label("1", X(xs) + 2, Z(beam.H) - 16, null, 10);
            DrawBeamSection(r, beam, p, xs, W * 0.72, W - 10, H);
        }

        void DrawBeamSection(BbBeamRebar r, BbBeamInput beam, BbBeamPreset p, double xs, double left, double right, double H)
        {
            double k = Math.Min((right - left - 20) / beam.B, (H - 50) / beam.H);
            double ox = left + (right - left - beam.B * k) / 2, oy = 30 + beam.H * k;
            Func<double, double> Y = y => ox + y * k;
            Func<double, double> Z = z => oy - z * k;
            Label("1–1", left + 4, 4, null, 12);
            Box(Y(0), Z(beam.H), Y(beam.B), Z(0), Concrete, Brushes.Gray);
            foreach (BbTieShape s in r.StirrupShapes)
            {
                if (s.Closed) Box(Y(s.X0), Z(s.Y1), Y(s.X1), Z(s.Y0), null, Tie);
                else Line(Y(s.X0), Z(s.Y1), Y(s.X1), Z(s.Y0), Tie, 1.2);
            }
            foreach (double z in r.TieZ) Line(Y(r.StirrupShapes.Count > 0 ? r.StirrupShapes[0].X0 : 0), Z(z), Y(r.StirrupShapes.Count > 0 ? r.StirrupShapes[0].X1 : beam.B), Z(z), Tie, 0.8);
            foreach (BbBarRun b in r.Bars.Where(b => b.X0 <= xs && b.X1 >= xs))
            {
                bool top = b.Role == BbRunRole.Top || b.Role == BbRunRole.AddTop || b.Role == BbRunRole.SpanTop;
                Brush br = b.Role == BbRunRole.SpanTop || b.Role == BbRunRole.Side ? Minor : top ? TopBar : BotBar;
                foreach (double y in b.Y) Dot(Y(y), Z(b.Z), Math.Max(2, b.D / 2.0 * k), br);
            }
            var tops = r.Bars.Where(b => b.X0 <= xs && b.X1 >= xs && (b.Role == BbRunRole.Top || b.Role == BbRunRole.AddTop)).ToList();
            var bots = r.Bars.Where(b => b.X0 <= xs && b.X1 >= xs && (b.Role == BbRunRole.Bottom || b.Role == BbRunRole.AddBottom)).ToList();
            Label(string.Join(" + ", tops.Select(b => b.N + "Ø" + b.D)), Y(beam.B) + 4, Z(beam.H) - 2, TopBar, 10);
            Label(string.Join(" + ", bots.Select(b => b.N + "Ø" + b.D)), Y(beam.B) + 4, Z(0) - 12, BotBar, 10);
        }

        /// <summary>Багана: огтлол (зүүн) + нэг булангийн ширхгийн босоо зам ба хомутын бүс (баруун).</summary>
        public void ShowColumn(BbColumnInput c, BbColumnPreset p, string title)
        {
            Children.Clear();
            BbColumnRebar r = BbColumnRebarPlan.Plan(c, p);
            double W = Math.Max(400, ActualWidth > 0 ? ActualWidth : 900), H = Height;
            Label(title + " — " + Math.Round(c.B) + "×" + Math.Round(c.H) + ", " + r.Bars.Count + "Ø" + r.D + ", хомут Ø" + r.TieD + " @" + r.S
                + (r.Warnings.Count > 0 ? "   ⚠ " + r.Warnings.Count : ""), 8, 4, null, 12);
            double k = Math.Min((W * 0.4 - 30) / c.B, (H - 50) / c.H);
            double ox = 20, oy = 30;
            Box(ox, oy, ox + c.B * k, oy + c.H * k, Concrete, Brushes.Gray);
            foreach (BbTieShape s in r.Shapes)
            {
                if (s.Closed) Box(ox + s.X0 * k, oy + s.Y0 * k, ox + s.X1 * k, oy + s.Y1 * k, null, Tie);
                else Line(ox + s.X0 * k, oy + s.Y0 * k, ox + s.X1 * k, oy + s.Y1 * k, Tie, 1.2);
            }
            foreach (BbColumnBar b in r.Bars) Dot(ox + b.X * k, oy + b.Y * k, Math.Max(2, p.D / 2.0 * k), b.Group == 0 ? TopBar : BotBar);

            // Босоо: 0…Height + дээш; бүлэг тус бүрийн нэг ширхэг.
            double zmin = Math.Min(0, r.Bars.Min(b => b.Path.Min(q => q[2]))), zmax = Math.Max(c.Height, r.Bars.Max(b => b.Path.Max(q => q[2])));
            double left = W * 0.45, kz = (H - 40) / (zmax - zmin), kxy = Math.Min(kz, (W * 0.5) / Math.Max(c.B, c.H));
            Func<double, double> Zp = z => 26 + (zmax - z) * kz;
            Box(left, Zp(c.Height), left + c.B * kxy, Zp(0), Concrete, Brushes.Gray);
            Line(left - 20, Zp(0), left + c.B * kxy + 20, Zp(0), Brushes.Gray, 1);
            Line(left - 20, Zp(c.Height), left + c.B * kxy + 20, Zp(c.Height), Brushes.Gray, 1);
            foreach (BbTieSet t in r.Ties)
                for (int i = 0; i < t.Count; i++)
                {
                    double z = t.Z0 + i * t.Spacing;
                    Line(left + p.Cover * kxy, Zp(z), left + (c.B - p.Cover) * kxy, Zp(z), Tie, 0.5);
                }
            foreach (int g in r.Bars.Select(b => b.Group).Distinct())
                foreach (BbColumnBar b in r.Bars.Where(x => x.Group == g && x.Y == r.Bars.Min(y => y.Y)).Take(2))
                {
                    var pl = new WPolyline { Stroke = g == 0 ? TopBar : BotBar, StrokeThickness = 1.6 };
                    foreach (double[] q in b.Path) pl.Points.Add(new Point(left + q[0] * kxy, Zp(q[2])));
                    Children.Add(pl);
                }
        }
    }
}
