using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.Linq;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;
using MglBb.Core;
using MglBb.Flows;
using MglBb.Infra;

namespace MglBb.Generate
{
    /// <summary>
    /// «Ажлын зураг гаргах»-ын АРЫН горим: гишүүн бүр = нэг ExternalEvent + нэг TransactionGroup (нэг Ctrl+Z).  Гишүүн хооронд Revit хэрэглэгчид
    /// чөлөөлөгдөнө (харагдац нээх, загвар засах), явц modeless <see cref="BbProgressWindow"/>-д.  Нэг гишүүн унавал ЗӨВХӨН тэр буцна, бусад нь
    /// үргэлжилнэ.  Нэг удаад нэг ажил (<see cref="Busy"/>).
    /// </summary>
    internal sealed class GenJobHost : IExternalEventHandler
    {
        private static GenJobHost _current;

        private readonly GenerateFlow.GenJob _job;
        private ExternalEvent _ev;
        private BbProgressWindow _win;
        private int _next, _failed;
        private bool _finished, _openFirst;
        private string _excel;
        private ElementId _firstId = ElementId.InvalidElementId;

        public static bool Busy { get { return _current != null && !_current._finished; } }

        private GenJobHost(GenerateFlow.GenJob job) { _job = job; }

        /// <summary>API контекст дотор (командаас) дуудна: цонх нээж эхний гишүүнийг дараалалд тавина.</summary>
        public static void Start(UIDocument uidoc, GenerateFlow.GenJob job, string source)
        {
            var h = new GenJobHost(job);
            h._ev = ExternalEvent.Create(h);
            h._win = new BbProgressWindow("MGL ББ — Ажлын зураг гаргах (" + job.Doc.Title + ")", job.Items.Count, "Стандарт: " + source);
            h._win.OpenFirst += (s, e) => { h._openFirst = true; h._ev.Raise(); };
            h._win.OpenExcel += (s, e) => { if (h._excel != null) FlowCommon.Open(h._excel); };
            _current = h;
            h._win.Show(uidoc.Application.MainWindowHandle);
            if (job.Items.Count > 0) h._win.Working(0, job.Items.Count, job.Items[0].Text);
            h._ev.Raise();
        }

        public string GetName() { return "MGL ББ: ажлын зураг (арын горим)"; }

        public void Execute(UIApplication app)
        {
            if (_openFirst)
            {
                _openFirst = false;
                OpenFirstView();
                if (_finished) return;
            }
            if (_finished) return;
            Document doc = _job.Doc;
            int n = _job.Items.Count;
            if (!doc.IsValidObject) { Finish("Төсөл хаагдсан тул зогслоо."); return; }
            if (_win.StopRequested || _next >= n) { Finish(null); return; }

            GenerateFlow.Item it = _job.Items[_next];
            GenerateFlow.GenRun g = _job.Progress;
            int e0 = g.Elevs, s0 = g.Secs, k0 = g.Skipped, h0 = g.Sheets, t0 = g.Schedules, c0 = g.CreatedSheets.Count;
            View f0 = g.First;
            var sw = Stopwatch.StartNew();
            string line;
            using (var tg = new TransactionGroup(doc, "MGL ББ: ажлын зураг " + (string.IsNullOrEmpty(it.Mark) ? "?" : it.Mark)))
            {
                tg.Start();
                try
                {
                    _job.RunItem(it);
                    tg.Assimilate();
                    line = "✓ " + Short(it) + " — дэлгээс " + (g.Elevs - e0) + ", огтлол " + (g.Secs - s0)
                        + (_job.OnSheet ? ", хуудас " + (g.Sheets - h0) + (g.Schedules > t0 ? ", түүвэр " + (g.Schedules - t0) : "") : "")
                        + " · " + Sec(sw);
                }
                catch (Exception ex)
                {
                    if (tg.HasStarted() && !tg.HasEnded()) tg.RollBack();
                    // Буцсан гишүүний тоолуурыг сэргээнэ (устсан харагдац/хуудсыг тоолохгүй).
                    g.Elevs = e0; g.Secs = s0; g.Skipped = k0; g.Sheets = h0; g.Schedules = t0; g.First = f0;
                    if (g.CreatedSheets.Count > c0) g.CreatedSheets.RemoveRange(c0, g.CreatedSheets.Count - c0);
                    _failed++;
                    g.Issues.Add(new BbIssue
                    {
                        Tool = "Ажлын зураг гаргах", Severity = BbSeverity.Error, Member = it.Mark ?? "",
                        Problem = Short(it) + ": алдаатай зогслоо — энэ гишүүний өөрчлөлт буцаагдсан: " + (ex.Message ?? "").Split('\n')[0],
                        Proposal = "Гишүүн (эсвэл түүний арматур) ажлын явцад өөрчлөгдсөн/устсан эсэхийг шалгаад дахин ажиллуулах.",
                        Key = "gen-failed|" + (it.Mark ?? ""),
                    });
                    line = "✗ " + Short(it) + " — алдаа (буцаагдсан): " + (ex.Message ?? "").Split('\n')[0];
                }
            }
            _win.Line(line);
            _next++;
            if (_next < n && !_win.StopRequested)
            {
                _win.Working(_next, n, _job.Items[_next].Text);
                _ev.Raise();
            }
            else Finish(null);
        }

        private void Finish(string reason)
        {
            _finished = true;
            GenerateFlow.GenRun g = _job.Finish();
            Document doc = _job.Doc;
            int n = _job.Items.Count, done = _next;
            var lines = GenerateFlow.SummaryLines(g, _job.Annotate, _job.OnSheet);
            string instruction = reason ?? (done < n ? "Зогсоосон — " + done + " / " + n + " гишүүн хийгдсэн." : "Дууслаа — " + (g.Elevs + g.Secs) + " харагдац үүслээ.");
            if (_failed > 0) instruction += "  Алдаатай гишүүн " + _failed + " (буцаагдсан).";
            string err = null;
            if (doc.IsValidObject)
            {
                _excel = BbStore.WriteIssues(doc, g.Issues, out err);
                if (g.First != null && g.First.IsValidObject) _firstId = g.First.Id;
            }
            int open = g.Issues.Count(i => i.Severity != BbSeverity.Info);
            if (_excel != null) lines.Add((open > 0 ? "Шийдэх асуудал " + open + " — " : "") + "«Асуудал – Шийдэл»: " + _excel + (err != null ? " (" + err + ")" : ""));
            else if (err != null) lines.Add("Excel бичигдсэнгүй: " + err);

            if (_win.IsOpen) _win.Complete(instruction, lines, _firstId != ElementId.InvalidElementId, _excel != null);
            else
            {
                // Хэрэглэгч цонхыг хаасан (зогсоох хүсэлт) — дүгнэлтийг товч харуулна.
                TaskDialog.Show("MGL ББ — Ажлын зураг гаргах", instruction + Environment.NewLine + Environment.NewLine + string.Join(Environment.NewLine, lines.Take(12)));
            }
        }

        private void OpenFirstView()
        {
            try
            {
                Document doc = _job.Doc;
                if (!doc.IsValidObject || !(doc.GetElement(_firstId) is View v)) return;
                new UIDocument(doc).ActiveView = v;
            }
            catch (Exception ex)
            {
                TaskDialog.Show("MGL ББ", "Зургийг нээж чадсангүй (төслийг идэвхтэй болгоод дахин оролдоно уу): " + ex.Message);
            }
        }

        private static string Short(GenerateFlow.Item it)
        {
            return (string.IsNullOrEmpty(it.Mark) ? "(тэмдэггүй)" : it.Mark) + " " + BbStandard.KindName(it.Kind).ToLowerInvariant();
        }

        private static string Sec(Stopwatch sw) { return (sw.ElapsedMilliseconds / 1000.0).ToString("0.0", CultureInfo.InvariantCulture) + " с"; }
    }
}
