using System;
using System.Collections.Generic;
using System.Globalization;
using MglLiraReport.Model;

namespace MglLiraReport.Results
{
    /// <summary>
    /// Жишээ тайлангийн «5.2. ГАЗАР ЧИЧИРХИЙЛЛИЙН АЧААЛЛЫН ХЭВТЭЭ ШИЛЖИЛТҮҮД» хуудсыг LIRA-аас автоматаар:
    /// гарчиг → «Тооцооны модел … (ЗАГВАР)» → мөр бүрд «X чиглэлд» + өнгөт зураг + «min=220.41mm».
    /// UI-гүй — DisplacementPageForm болон туршилт хоёулаа үүнийг дуудна.
    /// </summary>
    public static class DisplacementPageBuilder
    {
        public sealed class Row
        {
            public bool Include = true;
            public string Title = "";
            public LiraCase Case;
            public MoveComponent Component = MoveComponent.X;
            public ViewKind View = ViewKind.ElevationX;
        }

        public sealed class Spec
        {
            public string Heading = "5.2. ГАЗАР ЧИЧИРХИЙЛЛИЙН АЧААЛЛЫН ХЭВТЭЭ ШИЛЖИЛТҮҮД";
            public string Description = "";
            /// <summary>LIRA-ийн утгыг мм болгох үржвэр (мм = 1, см = 10, м = 1000).</summary>
            public double ToMm = 1;
            public int WidthPercent = 85;
            public List<Row> Rows = new List<Row>();
        }

        public static ReportPage Build(ReportFile file, ILiraSource src, Spec spec, Action<string> progress = null)
        {
            var page = new ReportPage { Kind = ReportPage.KindContent, Title = FirstLine(spec.Heading) };
            if (spec.Heading.Trim().Length > 0)
                page.Blocks.Add(new ReportBlock { Kind = ReportBlock.KindHeading, Level = 2, Text = spec.Heading.Trim(), Align = "center" });
            if (spec.Description.Trim().Length > 0)
                page.Blocks.Add(new ReportBlock { Kind = ReportBlock.KindText, Text = spec.Description.Trim(), Align = "center" });

            progress?.Invoke("LIRA-аас тор уншиж байна…");
            var mesh = src.GetMesh();

            foreach (var row in spec.Rows)
            {
                if (!row.Include || row.Case == null) continue;
                progress?.Invoke(row.Title + ": " + row.Case.Label + " уншиж байна…");
                var field = src.GetDisplacement(row.Case, row.Component);
                var values = (double[])field.Values.Clone();
                for (int i = 0; i < values.Length; i++) values[i] *= spec.ToMm;
                var stats = FieldStats.Of(values, mesh.NodeNumbers);

                progress?.Invoke(row.Title + ": зураг зурж байна…");
                var opts = new MosaicRenderer.Options
                {
                    View = row.View,
                    LegendTitle = LegendTitle(row.Component),
                    InfoLines = new[]
                    {
                        row.Case.Label,
                        "min=" + MosaicRenderer.Num(stats.Min) + " (" + stats.MinNode + ");  max=" + MosaicRenderer.Num(stats.Max) + " (" + stats.MaxNode + ")",
                    },
                };
                byte[] png = MosaicRenderer.RenderPng(mesh, values, opts, out _);
                string id = file.AddImage(png);

                page.Blocks.Add(new ReportBlock
                {
                    Kind = ReportBlock.KindImage,
                    WidthPercent = spec.WidthPercent,
                    Images =
                    {
                        new ImageRef
                        {
                            ImageId = id,
                            Title = row.Title,
                            Note = NoteText(stats),
                            Source = "lira|" + src.ModelName + "|" + row.Case.Key + "|" + row.Component + "|" + row.View,
                        },
                    },
                });
            }
            return page;
        }

        /// <summary>Жишээ тайлан шиг: абсолют хамгийн их утга, «min=220.41mm» / «max=130.7mm».</summary>
        public static string NoteText(FieldStats s) =>
            (s.ExtremeIsMin ? "min=" : "max=") + Math.Abs(s.Extreme).ToString("0.00", CultureInfo.InvariantCulture) + "mm";

        public static string LegendTitle(MoveComponent c)
        {
            switch (c)
            {
                case MoveComponent.X: return "X тэнхлэгийн дагуух шилжилт (мм)";
                case MoveComponent.Y: return "Y тэнхлэгийн дагуух шилжилт (мм)";
                case MoveComponent.Z: return "Z тэнхлэгийн дагуух шилжилт (мм)";
                default: return "Хэвтээ шилжилт √(X² + Y²) (мм)";
            }
        }

        static string FirstLine(string s)
        {
            s = (s ?? "").Trim();
            int i = s.IndexOf('\n');
            return i < 0 ? s : s.Substring(0, i);
        }
    }
}
