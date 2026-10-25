using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.Linq;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;
using MglBb.Infra;

namespace MglBb.BeamRebar
{
    /// <summary>
    /// Арматур үүсгэх АРЫН горим (<see cref="Generate.GenJobHost"/>-ийн адил): гишүүн бүр = нэг ExternalEvent + өөрийн transaction (нэг Ctrl+Z).
    /// Revit-д саваа бүр ≈0.2–0.5 с (CreateFromCurves + commit) тул бүх загвар хэдэн цаг үргэлжилж болно — гишүүн хооронд Revit чөлөөлөгдөж,
    /// явц modeless <see cref="BbProgressWindow"/>-д, «Зогсоох»-оор одоогийн гишүүн дуусмагц зогсоно.
    /// </summary>
    internal sealed class RebarJobHost : IExternalEventHandler
    {
        /// <summary>Нэг гишүүн: цонхны текст, гүйцэтгэл (бүртгэлийн мөр буцаана; transaction-оо өөрөө хийнэ).</summary>
        internal sealed class Step
        {
            public string Text;
            public Func<string> Run;
        }

        private static RebarJobHost _current;

        private readonly Document _doc;
        private readonly string _title;
        private readonly List<Step> _steps;
        private readonly Func<int, int, string> _instruction;
        private readonly Func<List<string>> _lines;
        private ExternalEvent _ev;
        private BbProgressWindow _win;
        private int _next;
        private bool _finished;

        public static bool Busy { get { return _current != null && !_current._finished; } }

        private RebarJobHost(Document doc, string title, List<Step> steps, Func<int, int, string> instruction, Func<List<string>> lines)
        {
            _doc = doc; _title = title; _steps = steps; _instruction = instruction; _lines = lines;
        }

        /// <summary>API контекст дотор (командаас) дуудна.  <paramref name="instruction"/>(хийсэн, нийт) — дүгнэлтийн гарчиг.</summary>
        public static void Start(UIDocument uidoc, string title, List<Step> steps, Func<int, int, string> instruction, Func<List<string>> lines)
        {
            var h = new RebarJobHost(uidoc.Document, title, steps, instruction, lines);
            h._ev = ExternalEvent.Create(h);
            h._win = new BbProgressWindow(title + " (" + uidoc.Document.Title + ")", steps.Count, "Дууссаны дараа анхааруулгын жагсаалт энд гарна.");
            _current = h;
            h._win.Show(uidoc.Application.MainWindowHandle);
            if (steps.Count > 0) h._win.Working(0, steps.Count, steps[0].Text);
            h._ev.Raise();
        }

        public string GetName() { return "MGL ББ: арматур (арын горим)"; }

        public void Execute(UIApplication app)
        {
            if (_finished) return;
            int n = _steps.Count;
            if (!_doc.IsValidObject) { Finish("Төсөл хаагдсан тул зогслоо."); return; }
            if (_win.StopRequested || _next >= n) { Finish(null); return; }
            Step st = _steps[_next];
            var sw = Stopwatch.StartNew();
            string line;
            try { line = st.Run(); }
            catch (Exception ex) { line = "✗ " + st.Text + " — алдаа: " + (ex.Message ?? "").Split('\n')[0]; }
            if (!string.IsNullOrEmpty(line)) _win.Line(line + " · " + (sw.ElapsedMilliseconds / 1000.0).ToString("0.0", CultureInfo.InvariantCulture) + " с");
            _next++;
            if (_next < n && !_win.StopRequested)
            {
                _win.Working(_next, n, _steps[_next].Text);
                _ev.Raise();
            }
            else Finish(null);
        }

        private void Finish(string reason)
        {
            _finished = true;
            int n = _steps.Count;
            string instruction = reason ?? (_next < n ? "Зогсоосон — " + _next + " / " + n + ".  " : "") + _instruction(_next, n);
            List<string> lines = _lines();
            if (_win.IsOpen) _win.Complete(instruction, lines, false, false);
            else TaskDialog.Show(_title, instruction + Environment.NewLine + Environment.NewLine + string.Join(Environment.NewLine, lines.Take(12)));
        }
    }
}
