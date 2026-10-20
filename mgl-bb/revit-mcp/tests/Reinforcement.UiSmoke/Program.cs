using System;
using System.Collections.Generic;
using System.IO;
using System.Windows;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using RevitMcpAddin.Reinforcement.Core;
using RevitMcpAddin.Reinforcement.Ui;

namespace RevitMcpAddin.Reinforcement.UiSmoke
{
    public static class Program
    {
        private const double Mm = 1.0 / 304.8;

        private static RfV2 Rot(double th, double x, double y)
        {
            return new RfV2(x * Math.Cos(th) - y * Math.Sin(th), x * Math.Sin(th) + y * Math.Cos(th));
        }

        private static RfSectionInput Member(double wMm, double hMm, double thetaDeg, int barsBottom, int barsTop, RfStirrupRef r, int scale)
        {
            double th = thetaDeg * Math.PI / 180;
            var input = new RfSectionInput
            {
                View = new RfViewFrame(new RfV3(0, 0, 0), new RfV3(1, 0, 0), new RfV3(0, 1, 0), new RfV3(0, 0, 1)),
            };
            RfV2 c = new RfV2(2000 * Mm, 1000 * Mm);
            RfV2 u = Rot(th, 1, 0), v = Rot(th, 0, 1);
            double w = wMm * Mm, h = hMm * Mm, len = 3000 * Mm;
            input.Faces.Add(new RfFaceSample { Id = 1, Origin = c - u * (w / 2), Normal = -u, Area = h * len });
            input.Faces.Add(new RfFaceSample { Id = 2, Origin = c + u * (w / 2), Normal = u, Area = h * len });
            input.Faces.Add(new RfFaceSample { Id = 3, Origin = c - v * (h / 2), Normal = -v, Area = w * len });
            input.Faces.Add(new RfFaceSample { Id = 4, Origin = c + v * (h / 2), Normal = v, Area = w * len });

            double cover = 40, d = 10;
            var s = new RfBarSample { Id = 77, Diameter = d * Mm };
            double hw = (wMm / 2 - cover - d / 2) * Mm, hh = (hMm / 2 - cover - d / 2) * Mm;
            foreach (double[] k in new[] { new[] { -hw, -hh }, new[] { hw, -hh }, new[] { hw, hh }, new[] { -hw, hh }, new[] { -hw, -hh } })
            {
                RfV2 p = Rot(th, k[0], k[1]) + c;
                s.Points.Add(new RfV3(p.X, p.Y, 0));
            }
            input.Stirrups.Add(s);

            long id = 100;
            double ox = (wMm / 2 - cover - d - 10) * Mm, oy = (hMm / 2 - cover - d - 10) * Mm;
            for (int i = 0; i < barsBottom; i++)
            {
                double x = barsBottom == 1 ? 0 : -ox + i * (2 * ox / (barsBottom - 1));
                RfV2 p = Rot(th, x, -oy) + c;
                input.Longitudinal.Add(new RfLongBar { Id = (i == 0 || i == barsBottom - 1) ? id++ : 500, BarIndex = i, Pos = p, Diameter = 20 * Mm });
            }
            for (int i = 0; i < barsTop; i++)
            {
                double x = barsTop == 1 ? 0 : -ox + i * (2 * ox / (barsTop - 1));
                RfV2 p = Rot(th, x, oy) + c;
                input.Longitudinal.Add(new RfLongBar { Id = (i == 0 || i == barsTop - 1) ? id++ : 600, BarIndex = i, Pos = p, Diameter = 16 * Mm });
            }
            double sc = scale / 304.8;
            input.Options.Ref = r;
            input.Options.DimOffsetFt = 10 * sc;
            input.Options.TagOutFt = 6 * sc;
            input.Options.TagGapFt = 6 * sc;
            input.Options.TagWidthFt = 16 * sc;
            input.Options.TagHeightFt = 5 * sc;
            return input;
        }

        [STAThread]
        public static int Main(string[] args)
        {
            string outDir = args.Length > 0 ? args[0] : Path.Combine(Path.GetTempPath(), "rf-ui-smoke");
            Directory.CreateDirectory(outDir);
            var cases = new List<KeyValuePair<string, RfSectionInput>>
            {
                new KeyValuePair<string, RfSectionInput>("beam300x500_outer", Member(300, 500, 0, 4, 2, RfStirrupRef.Outer, 20)),
                new KeyValuePair<string, RfSectionInput>("beam300x500_inner_rot30", Member(300, 500, 30, 4, 2, RfStirrupRef.Inner, 20)),
                new KeyValuePair<string, RfSectionInput>("column400_rot45", Member(400, 400, 45, 3, 3, RfStirrupRef.Outer, 20)),
                new KeyValuePair<string, RfSectionInput>("wide1200x300", Member(1200, 300, 0, 7, 3, RfStirrupRef.Center, 20)),
            };
            foreach (var kv in cases)
            {
                RfSectionPlan plan = RfSectionPlanner.Build(kv.Value);
                var preview = new SectionPreview { Width = 760, Height = 520 };
                preview.SetPlan(plan, "mm");
                preview.Measure(new Size(760, 520));
                preview.Arrange(new Rect(0, 0, 760, 520));
                var bmp = new RenderTargetBitmap(760, 520, 96, 96, PixelFormats.Pbgra32);
                bmp.Render(preview);
                var enc = new PngBitmapEncoder();
                enc.Frames.Add(BitmapFrame.Create(bmp));
                string path = Path.Combine(outDir, kv.Key + ".png");
                using (FileStream fs = File.Create(path)) enc.Save(fs);
                Console.WriteLine(kv.Key + ": dims=" + plan.Dims.Count + " tags=" + plan.Tags.Count + " warnings=" + plan.Warnings.Count + " -> " + path);
                foreach (RfDimPlan d in plan.Dims) Console.WriteLine("   dim " + d.Side + " " + d.Ref + " = " + (d.Distance * 304.8).ToString("0.##") + " mm");
            }
            return 0;
        }
    }
}
