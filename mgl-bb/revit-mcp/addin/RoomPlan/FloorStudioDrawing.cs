using System;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using RevitMcpAddin.RoomPlan.Core;
using WpfColor = System.Windows.Media.Color;
using WpfEllipse = System.Windows.Shapes.Ellipse;
using WpfLine = System.Windows.Shapes.Line;
using WpfRect = System.Windows.Shapes.Rectangle;

namespace RevitMcpAddin.RoomPlan
{
    /// <summary>Хувилбарын план: давхар, коридор, хонгил, айл бүрийн өрөө (төрлөөр өнгө), орц, цонхтой тал.  Цаасан дээрх шиг цайвар.</summary>
    internal static class FloorStudioDrawing
    {
        private static readonly Brush Paper = Frozen(0xFF, 0xFF, 0xFF);
        private static readonly Brush Ink = Frozen(0x2B, 0x2F, 0x33);
        private static readonly Brush Thin = Frozen(0x9A, 0xA4, 0xAE);
        private static readonly Brush Corridor = Frozen(0xE6, 0xE6, 0xE6);
        private static readonly Brush Core = Frozen(0xC9, 0xC9, 0xC9);
        private static readonly Brush Bed = Frozen(0xDC, 0xE9, 0xF7);
        private static readonly Brush Living = Frozen(0xFC, 0xEF, 0xD2);
        private static readonly Brush Wet = Frozen(0xD5, 0xF0, 0xEC);
        private static readonly Brush Hall = Frozen(0xF4, 0xF4, 0xF4);
        private static readonly Brush Store = Frozen(0xEC, 0xE6, 0xF5);
        private static readonly Brush Window = Frozen(0x2E, 0x86, 0xC1);
        private static readonly Brush Door = Frozen(0xC0, 0x39, 0x2B);

        /// <summary>Масштаб: 1 м = <paramref name="scale"/> px (Viewbox дараа нь самбарын өргөнд тааруулна).</summary>
        internal static Canvas Build(StudioCandidate c, double scale = 8)
        {
            FloorPlateLayout l = c.Split.Layout;
            double pad = 6;
            var canvas = new Canvas { Width = l.Width * scale + 2 * pad, Height = l.Height * scale + 2 * pad, Background = Paper };
            double X(double x) { return pad + x * scale; }
            double Y(double y) { return pad + (l.Height - y) * scale; }   // Revit Y дээш
            void Rect(double x1, double y1, double x2, double y2, Brush fill, Brush stroke, double t)
            {
                var r = new WpfRect { Width = Math.Max(0, (x2 - x1) * scale), Height = Math.Max(0, (y2 - y1) * scale), Fill = fill, Stroke = stroke, StrokeThickness = t };
                Canvas.SetLeft(r, X(x1));
                Canvas.SetTop(r, Y(y2));
                canvas.Children.Add(r);
            }
            void Seg(double x1, double y1, double x2, double y2, Brush b, double t)
            {
                canvas.Children.Add(new WpfLine { X1 = X(x1), Y1 = Y(y1), X2 = X(x2), Y2 = Y(y2), Stroke = b, StrokeThickness = t });
            }

            Rect(l.Corridor.X1, l.Corridor.Y1, l.Corridor.X2, l.Corridor.Y2, Corridor, null, 0);
            if (l.Core != null)
            {
                Rect(l.Core.X1, l.Core.Y1, l.Core.X2, l.Core.Y2, Core, null, 0);
                // Шат: хэдэн хөндлөн зураас.
                bool xLong = l.Width >= l.Height;
                for (int i = 1; i < 8; i++)
                {
                    if (xLong) { double x = l.Core.X1 + (l.Core.X2 - l.Core.X1) * i / 8; Seg(x, l.Core.Y1 + 0.4, x, l.Core.Y2 - 0.4, Thin, 0.6); }
                    else { double y = l.Core.Y1 + (l.Core.Y2 - l.Core.Y1) * i / 8; Seg(l.Core.X1 + 0.4, y, l.Core.X2 - 0.4, y, Thin, 0.6); }
                }
            }
            foreach (FloorUnit u in l.Units)
            {
                if (!c.Choice.TryGetValue(u.Id, out StudioUnitOption o) || o.Plan == null) { Rect(u.X1, u.Y1, u.X2, u.Y2, Hall, Ink, 1.2); continue; }
                foreach (PlanRoom r in o.Plan.Rooms)
                    Rect(u.X1 + r.X1, u.Y1 + r.Y1, u.X1 + r.X2, u.Y1 + r.Y2, RoomFill(r.Name), Thin, 0.6);
                foreach (PlanDoor d in o.Plan.Doors)
                {
                    bool entry = d.HostWall == "south" || d.HostWall == "north" || d.HostWall == "west" || d.HostWall == "east";
                    double size = entry ? 4 : 2.6;
                    var dot = new WpfEllipse { Width = size, Height = size, Fill = entry ? Door : Ink };
                    Canvas.SetLeft(dot, X(u.X1 + d.Center.X) - size / 2);
                    Canvas.SetTop(dot, Y(u.Y1 + d.Center.Y) - size / 2);
                    canvas.Children.Add(dot);
                }
                Rect(u.X1, u.Y1, u.X2, u.Y2, null, Ink, 1.2);
                // Цонхтой тал (гадна хана) — цэнхэр.
                foreach (string f in u.Facades)
                {
                    double o2 = 0.25;
                    switch (f)
                    {
                        case "south": Seg(u.X1 + o2, u.Y1, u.X2 - o2, u.Y1, Window, 2.2); break;
                        case "north": Seg(u.X1 + o2, u.Y2, u.X2 - o2, u.Y2, Window, 2.2); break;
                        case "west": Seg(u.X1, u.Y1 + o2, u.X1, u.Y2 - o2, Window, 2.2); break;
                        case "east": Seg(u.X2, u.Y1 + o2, u.X2, u.Y2 - o2, Window, 2.2); break;
                    }
                }
                var label = new TextBlock
                {
                    Text = u.Bedrooms + "ӨА", FontSize = Math.Max(7, Math.Min(11, scale * 1.1)), Foreground = Ink, FontWeight = FontWeights.SemiBold,
                };
                Canvas.SetLeft(label, X((u.X1 + u.X2) / 2) - 9);
                Canvas.SetTop(label, Y((u.Y1 + u.Y2) / 2) - 7);
                canvas.Children.Add(label);
            }
            Rect(0, 0, l.Width, l.Height, null, Ink, 2.2);
            return canvas;
        }

        private static Brush RoomFill(string name)
        {
            name = name ?? "";
            if (name.StartsWith("Унтлагын", StringComparison.Ordinal)) return Bed;
            if (name.StartsWith("Зочны", StringComparison.Ordinal) || name.StartsWith("Гал тогоо", StringComparison.Ordinal)) return Living;
            if (name.StartsWith("Ариун", StringComparison.Ordinal) || name.StartsWith("Угаал", StringComparison.Ordinal)) return Wet;
            if (name.StartsWith("Агуулах", StringComparison.Ordinal)) return Store;
            return Hall;
        }

        private static Brush Frozen(byte r, byte g, byte b)
        {
            var brush = new SolidColorBrush(WpfColor.FromRgb(r, g, b));
            brush.Freeze();
            return brush;
        }
    }
}
