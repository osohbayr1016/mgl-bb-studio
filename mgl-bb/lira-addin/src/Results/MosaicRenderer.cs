using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Drawing.Text;
using System.Globalization;
using System.IO;
using System.Linq;

namespace MglLiraReport.Results
{
    /// <summary>
    /// LIRA-ийн «мозайк» шиг өнгөт зураг: элемент бүр өөрийн зангилааны дундаж утгын өнгөөр,
    /// дээр нь өнгөний шкал (LIRA шиг: сөрөг тал 8 өнгө цэнхэр→цайвар, эерэг тал 8 өнгө ногоон→улаан).
    /// LIRA-ийн API зураг өгдөггүй тул тор + утгаас ӨӨРСДӨӨ зурна — LIRA-ийн зурагтай пиксел ижил биш.
    /// </summary>
    public static class MosaicRenderer
    {
        public sealed class Options
        {
            public ViewKind View = ViewKind.ElevationX;
            /// <summary>Шкалын гарчиг, жишээ: «X тэнхлэгийн дагуух шилжилт (мм)».</summary>
            public string LegendTitle = "";
            /// <summary>Шкалын доорх мөрүүд (хослолын нэр, min/max).</summary>
            public string[] InfoLines = Array.Empty<string>();
            public int Width = 2000, Height = 900;
        }

        // LIRA 10.12-ийн шкалаас пикселээр уншсан 16 өнгө (жишиг: «Displacement along X / LCS», 2026-10-08).
        static readonly Color[] Neg =
        {
            Color.FromArgb(50, 50, 255), Color.FromArgb(0, 100, 255), Color.FromArgb(0, 150, 255), Color.FromArgb(0, 200, 255),
            Color.FromArgb(0, 255, 255), Color.FromArgb(0, 255, 205), Color.FromArgb(0, 255, 155), Color.FromArgb(0, 255, 80),
        };
        static readonly Color[] Pos =
        {
            Color.FromArgb(80, 255, 0), Color.FromArgb(155, 255, 0), Color.FromArgb(205, 255, 0), Color.FromArgb(255, 255, 0),
            Color.FromArgb(255, 200, 0), Color.FromArgb(255, 150, 0), Color.FromArgb(255, 100, 0), Color.FromArgb(255, 50, 50),
        };

        /// <summary>Шкал: хил (bins+1 утга) ба өнгө.</summary>
        public sealed class Scale
        {
            public double[] Bounds;
            public Color[] Colors;

            public static Scale For(double min, double max)
            {
                var s = new Scale();
                if (min < 0 && max > 0)
                {
                    var b = new List<double>();
                    for (int i = 0; i <= 8; i++) b.Add(min + (0 - min) * i / 8.0);
                    for (int i = 1; i <= 8; i++) b.Add(max * i / 8.0);
                    s.Bounds = b.ToArray();
                    s.Colors = Neg.Concat(Pos).ToArray();
                }
                else
                {
                    if (max - min < 1e-12) { max = min + 1; }
                    s.Bounds = Enumerable.Range(0, 17).Select(i => min + (max - min) * i / 16.0).ToArray();
                    s.Colors = Neg.Concat(Pos).ToArray();
                }
                return s;
            }

            public Color ColorOf(double v)
            {
                if (double.IsNaN(v)) return Color.Silver;
                for (int i = 0; i < Colors.Length; i++)
                    if (v <= Bounds[i + 1]) return Colors[i];
                return Colors[Colors.Length - 1];
            }
        }

        public static byte[] RenderPng(LiraMesh mesh, double[] values, Options o, out int drawnElements)
        {
            using (var bmp = Render(mesh, values, o, out drawnElements))
            using (var ms = new MemoryStream())
            {
                bmp.Save(ms, ImageFormat.Png);
                return ms.ToArray();
            }
        }

        public static Bitmap Render(LiraMesh mesh, double[] values, Options o, out int drawnElements)
        {
            var stats = FieldStats.Of(values, mesh.NodeNumbers);
            var scale = Scale.For(stats.Min, stats.Max);

            var bmp = new Bitmap(o.Width, o.Height, PixelFormat.Format24bppRgb);
            using (var g = Graphics.FromImage(bmp))
            // Зураг Word-д ~150 мм өргөнтэй гардаг тул 2000 px дээр 20+ px фонт хэрэгтэй (эс бөгөөс ~1 мм үсэг).
            using (var font = new Font("Arial", 24f, GraphicsUnit.Pixel))
            using (var small = new Font("Arial", 21f, GraphicsUnit.Pixel))
            {
                g.Clear(Color.White);
                g.TextRenderingHint = TextRenderingHint.AntiAliasGridFit;

                // ── Шкал ──
                const int left = 24, barTop = 40, barH = 30;
                int barW = o.Width - 2 * left;
                g.DrawString(o.LegendTitle ?? "", font, Brushes.Black, left, 8);
                int n = scale.Colors.Length;
                for (int i = 0; i < n; i++)
                {
                    int x0 = left + barW * i / n, x1 = left + barW * (i + 1) / n;
                    using (var br = new SolidBrush(scale.Colors[i])) g.FillRectangle(br, x0, barTop, x1 - x0, barH);
                }
                g.DrawRectangle(Pens.Gray, left, barTop, barW, barH);
                for (int i = 0; i <= n; i++)
                {
                    string t = Num(scale.Bounds[i]);
                    var sz = g.MeasureString(t, small);
                    float x = left + barW * i / (float)n - sz.Width / 2;
                    x = Math.Max(2, Math.Min(o.Width - sz.Width - 2, x));
                    g.DrawString(t, small, Brushes.Black, x, barTop + barH + 3);
                }
                float y = barTop + barH + 34;
                foreach (var line in o.InfoLines ?? Array.Empty<string>())
                {
                    g.DrawString(line, small, Brushes.Black, left, y);
                    y += 27;
                }

                // ── Тор ──
                var area = new RectangleF(left + 40, y + 12, o.Width - 2 * left - 80, o.Height - (y + 12) - 56);
                drawnElements = DrawMesh(g, mesh, values, scale, o.View, area);

                DrawAxes(g, o.View, new PointF(left + 10, o.Height - 18), small);
            }
            return bmp;
        }

        static int DrawMesh(Graphics g, LiraMesh mesh, double[] values, Scale scale, ViewKind view, RectangleF area)
        {
            int nn = mesh.NodeCount;
            if (nn == 0 || mesh.Elements.Count == 0) return 0;

            // 2D проекц + гүн (ойр нь хамгийн сүүлд зурагдана)
            double[] u = new double[nn], v = new double[nn], d = new double[nn];
            for (int i = 0; i < nn; i++)
            {
                switch (view)
                {
                    case ViewKind.ElevationX: u[i] = mesh.X[i]; v[i] = mesh.Z[i]; d[i] = -mesh.Y[i]; break; // −Y-ээс +Y руу харна
                    case ViewKind.ElevationY: u[i] = mesh.Y[i]; v[i] = mesh.Z[i]; d[i] = mesh.X[i]; break;  // +X-ээс −X руу харна
                    default: u[i] = mesh.X[i]; v[i] = mesh.Y[i]; d[i] = mesh.Z[i]; break;                 // дээрээс
                }
            }

            // Зөвхөн элементэд орсон зангилаагаар хүрээ тогтооно
            double uMin = double.MaxValue, uMax = double.MinValue, vMin = double.MaxValue, vMax = double.MinValue;
            foreach (var e in mesh.Elements)
                foreach (int k in e)
                {
                    if (k < 0 || k >= nn) continue;
                    uMin = Math.Min(uMin, u[k]); uMax = Math.Max(uMax, u[k]);
                    vMin = Math.Min(vMin, v[k]); vMax = Math.Max(vMax, v[k]);
                }
            if (uMin > uMax) return 0;
            double du = Math.Max(uMax - uMin, 1e-9), dv = Math.Max(vMax - vMin, 1e-9);
            double s = Math.Min(area.Width / du, area.Height / dv);
            double ox = area.X + (area.Width - du * s) / 2, oy = area.Y + (area.Height - dv * s) / 2;
            PointF P(int k) => new PointF((float)(ox + (u[k] - uMin) * s), (float)(oy + (vMax - v[k]) * s));

            var order = new List<(double depth, int idx)>(mesh.Elements.Count);
            for (int i = 0; i < mesh.Elements.Count; i++)
            {
                var e = mesh.Elements[i];
                if (e.Length < 2 || e.Length > 4 || e.Any(k => k < 0 || k >= nn)) continue;
                double sum = 0;
                foreach (int k in e) sum += d[k];
                order.Add((sum / e.Length, i));
            }
            order.Sort((a, b) => a.depth.CompareTo(b.depth));

            g.SmoothingMode = SmoothingMode.None;
            var brushes = new Dictionary<int, SolidBrush>();
            var pens = new Dictionary<int, Pen>();
            try
            {
                foreach (var (_, idx) in order)
                {
                    var e = mesh.Elements[idx];
                    double sum = 0; int cnt = 0;
                    foreach (int k in e) if (!double.IsNaN(values[k])) { sum += values[k]; cnt++; }
                    var c = cnt == 0 ? Color.Silver : scale.ColorOf(sum / cnt);
                    int key = c.ToArgb();
                    if (!brushes.TryGetValue(key, out var br)) brushes[key] = br = new SolidBrush(c);
                    if (!pens.TryGetValue(key, out var pen)) pens[key] = pen = new Pen(c, e.Length == 2 ? 2f : 1f);
                    if (e.Length == 2) g.DrawLine(pen, P(e[0]), P(e[1]));
                    else
                    {
                        var pts = e.Select(P).ToArray();
                        g.FillPolygon(br, pts);
                        g.DrawPolygon(pen, pts); // ирмэгээрээ харагдах хавтан (давхрын хучилт фасадаас) алга болохгүй
                    }
                }
            }
            finally
            {
                foreach (var b in brushes.Values) b.Dispose();
                foreach (var p in pens.Values) p.Dispose();
            }
            return order.Count;
        }

        static void DrawAxes(Graphics g, ViewKind view, PointF o, Font f)
        {
            string h = view == ViewKind.ElevationY ? "Y" : "X";
            string vv = view == ViewKind.Plan ? "Y" : "Z";
            using (var pen = new Pen(Color.FromArgb(40, 40, 160), 2f) { EndCap = LineCap.ArrowAnchor })
            {
                g.DrawLine(pen, o.X, o.Y, o.X + 42, o.Y);
                g.DrawLine(pen, o.X, o.Y, o.X, o.Y - 42);
            }
            g.DrawString(h, f, Brushes.DarkBlue, o.X + 46, o.Y - 9);
            g.DrawString(vv, f, Brushes.DarkBlue, o.X - 5, o.Y - 62);
        }

        /// <summary>LIRA-ийн шкал шиг 5 чухал цифр («-220.41», «0.043337»).</summary>
        public static string Num(double x)
        {
            if (Math.Abs(x) < 1e-9) return "0";
            string s = x.ToString("G5", CultureInfo.InvariantCulture);
            if (s.Contains("E")) s = x.ToString("0.#####", CultureInfo.InvariantCulture);
            return s;
        }
    }
}
