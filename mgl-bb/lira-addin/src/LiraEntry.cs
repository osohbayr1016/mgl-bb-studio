using System;
using System.Collections.Generic;
using System.Text.RegularExpressions;
using System.Windows.Forms;
using MglLiraReport.Results;
using FEModel;
using LiraAPI;
using MglLiraReport.UI;

namespace MglLiraReport
{
    /// <summary>
    /// LIRA 10.12-ийн цэсний команд «MGL тооцооны тайлан».  LIRA нь DLL доторх ILiraAPI-г
    /// хэрэгжүүлсэн класс бүрийг командын эх болгодог тул энэ ГАНЦ класс байх ёстой.
    /// LIRA нь зөвхөн үр дүн харах горимд дуудна; засварлагчийг modal нээж, хаагдтал API хүчинтэй.
    /// </summary>
    public class LiraEntry : ILiraAPI
    {
        public ReturnCodes ExecuteProgram_Result(IResultLiraAPI api, int nodesNumber, int elementsNumber,
            List<List<Results_Key>> allCases, Results_Key currentCase)
        {
            try
            {
                var source = new LiraSource(api, nodesNumber, elementsNumber, allCases, currentCase);
                using (var form = new ReportEditorForm(source))
                    form.ShowDialog();
                return ReturnCodes.RC_OK;
            }
            catch (Exception ex)
            {
                MessageBox.Show("MGL тайлангийн нэмэлт алдаа гаргалаа:\n\n" + ex, "MGL тооцооны тайлан",
                    MessageBoxButtons.OK, MessageBoxIcon.Error);
                return ReturnCodes.RC_FAILED;
            }
        }
    }

    /// <summary>LIRA-ийн API-г засварлагчид LIRA-ийн төрөлгүйгээр (ILiraSource) өгнө.</summary>
    public sealed class LiraSource : ILiraSource
    {
        readonly IResultLiraAPI _api;
        readonly int _nodes, _elements;
        readonly List<List<Results_Key>> _cases;
        readonly Results_Key _current;
        readonly LiraReader _reader;

        public LiraSource(IResultLiraAPI api, int nodes, int elements, List<List<Results_Key>> cases, Results_Key current)
        {
            _api = api; _nodes = nodes; _elements = elements; _cases = cases; _current = current;
            _reader = new LiraReader(api, nodes, elements, cases);
            ModelName = DetectModelName();
        }

        public string ModelName { get; }

        public string Describe() => "LIRA" + (ModelName.Length > 0 ? " «" + ModelName + "»" : "") + ": " + _nodes + " зангилаа, " + _elements + " элемент";

        public string RunDiagnostics(out string summary) =>
            LiraDiagnostics.Run(_api, _nodes, _elements, _cases, _current, out summary);

        public List<LiraCase> ListCases(CaseSource source) => _reader.ListCases(source);
        public LiraMesh GetMesh() => _reader.GetMesh();
        public NodeField GetDisplacement(LiraCase c, MoveComponent component) => _reader.GetDisplacement(c, component);

        /// <summary>API нь файлын нэр өгдөггүй — LIRA-ийн цонхны гарчгаас «…\NAME.fep» хэсгийг авна.</summary>
        static string DetectModelName()
        {
            try
            {
                string title = System.Diagnostics.Process.GetCurrentProcess().MainWindowTitle ?? "";
                var m = Regex.Match(title, @"([^\\/\[\]]+?)\.(fep|lir)\b", RegexOptions.IgnoreCase);
                return m.Success ? m.Groups[1].Value.Trim() : "";
            }
            catch { return ""; }
        }
    }
}
