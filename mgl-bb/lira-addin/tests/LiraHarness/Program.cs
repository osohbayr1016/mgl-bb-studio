using System;
using System.Collections.Generic;
using System.Data;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Text.RegularExpressions;
using FEModel;
using LiraAPI;
using MglLiraReport;
using MglLiraReport.Docx;
using MglLiraReport.Model;
using MglLiraReport.Results;

namespace LiraHarness
{
    /// <summary>
    ///   LiraHarness.exe &lt;model.txt&gt; &lt;outDir&gt;
    /// LIRA-ийн текст загвараас тор уншиж, хуурамч IResultLiraAPI-аар LiraSource-ийг (бодит код) ажиллуулна:
    /// ListCases → GetMesh → GetDisplacement → зураг → хуудас → .mglrep + .docx.
    /// </summary>
    static class Program
    {
        const string LiraBin = @"C:\Program Files\Lira Soft\Lira10.12\bin64";

        [STAThread]
        static int Main(string[] args)
        {
            AppDomain.CurrentDomain.AssemblyResolve += (s, e) =>
            {
                string p = Path.Combine(LiraBin, new AssemblyName(e.Name).Name + ".dll");
                return File.Exists(p) ? Assembly.LoadFrom(p) : null;
            };
            return Run(args);
        }

        static System.Windows.Forms.Button FindButton(System.Windows.Forms.Control root, string text)
        {
            foreach (System.Windows.Forms.Control c in root.Controls)
            {
                if (c is System.Windows.Forms.Button b && b.Text == text) return b;
                var inner = FindButton(c, text);
                if (inner != null) return inner;
            }
            return null;
        }

        static LiraSource FakeSource(string txt, out FakeLira fake)
        {
            fake = FakeLira.FromText(txt);
            var cases = new List<List<Results_Key>>
            {
                Enumerable.Range(0, 8).Select(i => new Results_Key(i, 0, 0)).ToList(),
                new List<Results_Key>(), new List<Results_Key>(),
                Enumerable.Range(0, 6).Select(i => new Results_Key(i, 0, 0)).ToList(),
                new List<Results_Key>(),
            };
            return new LiraSource(fake, fake.NodeCount, fake.ElementCount, cases, cases[0][0]);
        }

        static int Run(string[] args)
        {
            if (args[0] == "--formtest")
            {
                // DisplacementPageForm-ыг нээж «Хуудас үүсгэх»-ийг програмаар дарна → Spec → хуудас → docx.
                System.Windows.Forms.Application.EnableVisualStyles();
                var src2 = FakeSource(args[1], out _);
                var form = new MglLiraReport.UI.DisplacementPageForm(src2);
                form.Shown += (s, e) => form.BeginInvoke((Action)(() =>
                {
                    using (var bmp = new System.Drawing.Bitmap(form.Width, form.Height))
                    {
                        form.DrawToBitmap(bmp, new System.Drawing.Rectangle(0, 0, form.Width, form.Height));
                        Directory.CreateDirectory(args[2]);
                        bmp.Save(Path.Combine(args[2], "form.png"));
                    }
                    var ok = FindButton(form, "Хуудас үүсгэх");
                    Console.WriteLine("button found: " + (ok != null));
                    ok?.PerformClick();
                }));
                var result = form.ShowDialog();
                Console.WriteLine("dialog result: " + result);
                var formSpec = form.Spec;
                if (formSpec == null) { Console.WriteLine("NO SPEC"); return 1; }
                foreach (var r in formSpec.Rows) Console.WriteLine($"  row: {r.Title} | {r.Case.Label} | {r.Component} | {r.View}");
                var doc2 = ReportDocument.CreateNew(ReportDocument.KindConcrete);
                var file2 = new ReportFile(doc2);
                doc2.Pages.Add(DisplacementPageBuilder.Build(file2, src2, formSpec));
                Directory.CreateDirectory(args[2]);
                new DocxBuilder(file2).Save(Path.Combine(args[2], "formtest.docx"));
                Console.WriteLine("formtest OK");
                return 0;
            }
            if (args[0] == "--ui")
            {
                // Засварлагчийг дуурайлгасан LIRA-тай нээнэ («LIRA → Шилжилтийн хуудас»-ыг гараар шалгах).
                System.Windows.Forms.Application.EnableVisualStyles();
                var ui = FakeSource(args[1], out _);
                System.Windows.Forms.Application.Run(new MglLiraReport.UI.ReportEditorForm(ui));
                return 0;
            }
            string txt = args[0], outDir = args[1];
            Directory.CreateDirectory(outDir);
            var sw = System.Diagnostics.Stopwatch.StartNew();
            var fake = FakeLira.FromText(txt);
            Console.WriteLine($"model: nodes={fake.NodeCount} elements={fake.ElementCount} parse={sw.ElapsedMilliseconds}ms");

            var cases = new List<List<Results_Key>>
            {
                Enumerable.Range(0, 8).Select(i => new Results_Key(i, 0, 0)).ToList(),
                new List<Results_Key>(), new List<Results_Key>(),
                Enumerable.Range(0, 6).Select(i => new Results_Key(i, 0, 0)).ToList(),
                new List<Results_Key>(),
            };
            var src = new LiraSource(fake, fake.NodeCount, fake.ElementCount, cases, cases[0][0]);

            var rsn = src.ListCases(CaseSource.RsnCalc);
            Console.WriteLine("RSN cases: " + string.Join(" | ", rsn.Select(c => c.Label)));
            var loads = src.ListCases(CaseSource.Loading);
            Console.WriteLine("Loadings: " + string.Join(" | ", loads.Select(c => c.Label)));

            sw.Restart();
            var mesh = src.GetMesh();
            Console.WriteLine($"mesh: nodes={mesh.NodeCount} elements={mesh.Elements.Count} {sw.ElapsedMilliseconds}ms");

            var spec = new DisplacementPageBuilder.Spec
            {
                Description = "Тооцооны модел БНБД 22-01-21-ИЙН ХАРИУ СПЕКТРИЙН АРГААР ТООЦОХ (260921_C_BLOCK_SE_2)",
                Rows =
                {
                    new DisplacementPageBuilder.Row { Title = "X чиглэлд", Case = rsn.First(c => c.Label.Contains("+X")), Component = MoveComponent.X, View = ViewKind.ElevationX },
                    new DisplacementPageBuilder.Row { Title = "Y чиглэлд", Case = rsn.First(c => c.Label.Contains("+Y")), Component = MoveComponent.Y, View = ViewKind.ElevationY },
                    new DisplacementPageBuilder.Row { Title = "XY чиглэлд", Case = rsn.First(c => c.Label.Contains("XY")), Component = MoveComponent.XY, View = ViewKind.Plan },
                },
            };

            var doc = ReportDocument.CreateNew(ReportDocument.KindConcrete);
            doc.Project.Name = "C БЛОК (туршилт)";
            doc.Project.Shifr = "МЕС-26/09";
            doc.Project.Engineer = "Туршилт";
            doc.Project.Date = "2026.10.08";
            doc.Project.Year = "2026";
            var file = new ReportFile(doc);
            sw.Restart();
            var page = DisplacementPageBuilder.Build(file, src, spec, m => Console.WriteLine("  " + m));
            Console.WriteLine($"page built {sw.ElapsedMilliseconds}ms, blocks={page.Blocks.Count}");
            foreach (var b in page.Blocks.Where(b => b.Kind == ReportBlock.KindImage))
            {
                var r = b.Images[0];
                Console.WriteLine($"  image {r.Title}: note={r.Note} source={r.Source}");
                File.WriteAllBytes(Path.Combine(outDir, r.Title.Replace(' ', '_') + ".png"), file.Images[r.ImageId]);
            }
            doc.Pages.Add(page);
            file.Save(Path.Combine(outDir, "harness.mglrep"));
            new DocxBuilder(file).Save(Path.Combine(outDir, "harness.docx"));
            Console.WriteLine("OK");
            return 0;
        }
    }

    /// <summary>
    /// Хуурамч LIRA: тор нь бодит загвараас, шилжилт нь зохиомол (өндрөөс хамаарсан) — зурагч ба уншигчийн шалгалтад.
    /// Баганын төрөл/нэр/өгөгдлийн төрөл нь LiraAPIHelp.pdf-тэй ижил (RCT_NUMBER_NODE = String гэх мэт).
    /// </summary>
    sealed class FakeLira : IResultLiraAPI
    {
        readonly List<double[]> _xyz = new List<double[]>();
        readonly List<int[]> _elems = new List<int[]>();
        public int NodeCount => _xyz.Count;
        public int ElementCount => _elems.Count;
        double _zMin, _zMax;

        static readonly string[] RsnNames = { "ХОСЛОЛ-1", "ХОСЛОЛ-2 (SE+X)", "ХОСЛОЛ-2 (SE+Y)", "ХОСЛОЛ-2 (SE-X)", "ХОСЛОЛ-2 (SE-Y)", "ХОСЛОЛ-3 (SE XY)" };

        public static FakeLira FromText(string path)
        {
            var f = new FakeLira();
            string doc = null;
            foreach (var raw in File.ReadLines(path))
            {
                var line = raw.Trim();
                var m = Regex.Match(line, @"^\(\s*(\d+)/");
                if (m.Success) { doc = m.Groups[1].Value; continue; }
                if (line.StartsWith(")")) { doc = null; continue; }
                if (doc != "1" && doc != "4") continue;
                int cut = line.IndexOf("/*", StringComparison.Ordinal);
                if (cut < 0) cut = line.IndexOf('/');
                if (cut < 0) continue;
                var parts = line.Substring(0, cut).Split(new[] { ' ', '\t' }, StringSplitOptions.RemoveEmptyEntries);
                if (doc == "4" && parts.Length >= 3)
                    f._xyz.Add(parts.Take(3).Select(p => double.Parse(p, CultureInfo.InvariantCulture)).ToArray());
                else if (doc == "1" && parts.Length >= 3)
                    f._elems.Add(parts.Skip(2).Select(p => int.Parse(p, CultureInfo.InvariantCulture)).ToArray());
            }
            f._zMin = f._xyz.Min(p => p[2]); f._zMax = f._xyz.Max(p => p[2]);
            return f;
        }

        public int getLiraApiVersion() => 1;

        public DataTable get_TableResult(e_Results_TableType rtt, List<int> objs, List<Results_Key> keys,
            ref e_Results_ColumnType[] types, ref string[] names)
        {
            var t = new DataTable();
            switch (rtt)
            {
                case e_Results_TableType.RTT_NODES:
                    Cols(t, ref types, ref names, (e_Results_ColumnType.RCT_NUMBER, "Номер", typeof(int)),
                        (e_Results_ColumnType.RCT_COORDINATE_X, "Координата X (м)", typeof(double)),
                        (e_Results_ColumnType.RCT_COORDINATE_Y, "Координата Y (м)", typeof(double)),
                        (e_Results_ColumnType.RCT_COORDINATE_Z, "Координата Z (м)", typeof(double)));
                    foreach (int i in objs) t.Rows.Add(i + 1, _xyz[i][0], _xyz[i][1], _xyz[i][2]);
                    return t;
                case e_Results_TableType.RTT_ELEMENTS:
                    Cols(t, ref types, ref names, (e_Results_ColumnType.RCT_NUMBER, "Номер", typeof(int)),
                        (e_Results_ColumnType.RCT_FE_TYPE, "Тип КЭ", typeof(short)),
                        (e_Results_ColumnType.RCT_NUMBER_NODE, "№№ узлов", typeof(string)));
                    foreach (int i in objs) t.Rows.Add(i + 1, (short)(_elems[i].Length == 2 ? 10 : 44), string.Join(" ", _elems[i]));
                    return t;
                case e_Results_TableType.RTT_LOADINGS_INFO:
                    Cols(t, ref types, ref names, (e_Results_ColumnType.RCT_LOADING_CASE, "Загружение", typeof(short)),
                        (e_Results_ColumnType.RCT_NAME, "Имя", typeof(string)));
                    string[] ln = { "SELF LOAD", "SOIL", "CONSTANT", "LIVE LOAD", "SNOW LOAD", "SEISMIC-X", "SEISMIC-Y", "SEISMIC-XY" };
                    for (int i = 0; i < ln.Length; i++) t.Rows.Add((short)(i + 1), ln[i]);
                    return t;
                case e_Results_TableType.RTT_LOADING_RSN_KOEF:
                    Cols(t, ref types, ref names, (e_Results_ColumnType.RCT_RSN_CASE, "Сочетание", typeof(int)),
                        (e_Results_ColumnType.RCT_LOADING_CASE_NAME, "Имя загружения", typeof(string)),
                        (e_Results_ColumnType.RCT_COMMENT, "Комментарий", typeof(string)));
                    for (int i = 0; i < RsnNames.Length; i++) { t.Rows.Add(i + 1, "SELF LOAD", RsnNames[i]); t.Rows.Add(i + 1, "LIVE LOAD", RsnNames[i]); }
                    return t;
                case e_Results_TableType.RTT_NODES_MOVE_DEKART:
                case e_Results_TableType.RTT_NODES_MOVE_DEKART_RSN_C:
                case e_Results_TableType.RTT_NODES_MOVE_DEKART_RSN_N:
                    Cols(t, ref types, ref names, (e_Results_ColumnType.RCT_NUMBER, "Номер", typeof(int)),
                        (e_Results_ColumnType.RCT_MOVE_X, "X (мм)", typeof(double)),
                        (e_Results_ColumnType.RCT_MOVE_Y, "Y (мм)", typeof(double)),
                        (e_Results_ColumnType.RCT_MOVE_Z, "Z (мм)", typeof(double)));
                    int rsn = keys.Count > 0 ? keys[0].m_IndexLoadingCase : 0;
                    double ax = rsn == 1 ? -172.43 : rsn == 3 ? 165 : rsn == 5 ? -120 : 3;
                    double ay = rsn == 2 ? 130.73 : rsn == 4 ? -128 : rsn == 5 ? 95 : -0.5;
                    foreach (int i in objs)
                    {
                        var p = _xyz[i];
                        double h = (p[2] - _zMin) / (_zMax - _zMin);
                        double shape = Math.Pow(h, 1.4);
                        // жижиг эсрэг тэмдэгтэй хэсэг (LIRA-ийн зурагт min≈-0.5, max≈3.4 шиг)
                        double wob = 0.002 * Math.Sin(p[0] * 0.7 + p[1] * 0.3);
                        t.Rows.Add(i + 1, ax * shape + wob * Math.Abs(ax) * (1 - h), ay * shape + wob * Math.Abs(ay) * (1 - h), -2 * h);
                    }
                    return t;
            }
            types = new e_Results_ColumnType[0];
            names = new string[0];
            return t;
        }

        static void Cols(DataTable t, ref e_Results_ColumnType[] types, ref string[] names,
            params (e_Results_ColumnType type, string name, Type clr)[] cols)
        {
            types = cols.Select(c => c.type).ToArray();
            names = cols.Select(c => c.name).ToArray();
            foreach (var c in cols) t.Columns.Add(c.type.ToString(), c.clr);
        }
    }
}
