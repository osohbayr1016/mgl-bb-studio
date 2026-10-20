using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;
using RevitMcpAddin.SheetNumerator.Core;
using RevitMcpAddin.SheetNumerator.Revit;

namespace SnLive
{
    /// <summary>Тайлан: тест бүрийн үр дүн файлд ШУУД бичигдэнэ (Revit гацсан ч тэр хүртэлх мэдээлэл үлдэнэ).</summary>
    public sealed class Report
    {
        private readonly string _path;
        public int Pass, Fail;
        public readonly List<string> Failures = new List<string>();

        public Report(string path)
        {
            _path = path;
        }

        public void Line(string s)
        {
            try { File.AppendAllText(_path, s + Environment.NewLine, new UTF8Encoding(false)); } catch (Exception) { }
        }

        public void Info(string s) { Line("      " + s); }
        public void Ok(string name) { Pass++; Line("  ok   " + name); }

        public void Bad(string name, string why)
        {
            Fail++;
            Failures.Add(name + ": " + why);
            Line("  FAIL " + name + " — " + why);
        }
    }

    public sealed class Check : Exception
    {
        public Check(string m) : base(m) { }
    }

    /// <summary>Harness-ийн transaction-д Revit-ийн МОДАЛЬ алдааны цонх гарахаас сэргийлж, мессежийг бүртгээд буцаана.</summary>
    public sealed class QuietFailures : IFailuresPreprocessor
    {
        public static readonly List<string> Log = new List<string>();

        public FailureProcessingResult PreprocessFailures(FailuresAccessor fa)
        {
            bool error = false;
            foreach (FailureMessageAccessor m in fa.GetFailureMessages())
            {
                Log.Add(m.GetSeverity() + ": " + m.GetDescriptionText());
                if (m.GetSeverity() == FailureSeverity.Warning)
                    fa.DeleteWarning(m);
                else
                    error = true;
            }
            return error ? FailureProcessingResult.ProceedWithRollBack : FailureProcessingResult.Continue;
        }
    }

    /// <summary>Нэг шалгалтын орчин: Revit, scratch document-ууд, туслахууд.</summary>
    public sealed class Ctx
    {
        public UIApplication App;
        public string Template;
        public string OutDir;
        public Report R;
        public readonly List<Document> Open = new List<Document>();

        public string Version { get { return App.Application.VersionNumber; } }

        public Document NewDoc()
        {
            Document d = App.Application.NewProjectDocument(Template);
            Open.Add(d);
            return d;
        }

        public void CloseAll()
        {
            foreach (Document d in Open)
            {
                try { if (d.IsValidObject) d.Close(false); }
                catch (Exception ex) { R.Line("      [cleanup] document хаахад алдаа: " + ex.Message); }
            }
            Open.Clear();
        }

        public void Tx(Document d, string name, Action a)
        {
            QuietFailures.Log.Clear();
            using (var t = new Transaction(d, name))
            {
                t.Start();
                FailureHandlingOptions fo = t.GetFailureHandlingOptions();
                fo.SetFailuresPreprocessor(new QuietFailures());
                t.SetFailureHandlingOptions(fo);
                try
                {
                    a();
                }
                catch (Exception)
                {
                    t.RollBack();
                    throw;
                }
                TransactionStatus st = t.Commit();
                if (st != TransactionStatus.Committed)
                    throw new Check("Transaction «" + name + "» commit хийгдсэнгүй (" + st + "): " + string.Join(" || ", QuietFailures.Log));
            }
        }

        public DocumentSnapshot Snap(Document d)
        {
            SnapshotResult r = SheetSnapshotService.Capture(d, Version, 0);
            if (!r.Success)
                throw new Check("Capture амжилтгүй: " + r.Error);
            return r.Snapshot;
        }

        public static void Require(bool ok, string msg)
        {
            if (!ok)
                throw new Check(msg);
        }

        public static void Eq<T>(T expected, T actual, string what)
        {
            if (!EqualityComparer<T>.Default.Equals(expected, actual))
                throw new Check(what + ": хүлээсэн «" + expected + "», бодит «" + actual + "»");
        }

        public static void EqSeq(IEnumerable<string> expected, IEnumerable<string> actual, string what)
        {
            string e = string.Join(" | ", expected.Select(Show));
            string a = string.Join(" | ", actual.Select(Show));
            if (e != a)
                throw new Check(what + ":\n        хүлээсэн  " + e + "\n        бодит     " + a);
        }

        /// <summary>Үл үзэгдэх тэмдгийг ил харуулна.</summary>
        public static string Show(string s)
        {
            return UnicodeMarkers.ContainsMarker(s) ? UnicodeMarkers.Escape(s) : s;
        }

        // ── Хуудас үүсгэх ──────────────────────────────────────────
        public static ViewSheet Sheet(Document d, string number, string name)
        {
            ViewSheet s = ViewSheet.Create(d, ElementId.InvalidElementId);
            s.SheetNumber = number;
            s.Name = name;
            return s;
        }

        public static Dictionary<string, string> NumbersByName(DocumentSnapshot snap)
        {
            var m = new Dictionary<string, string>(StringComparer.Ordinal);
            foreach (SheetSnapshot s in snap.Sheets)
                m[s.Name] = s.Number;
            return m;
        }

        /// <summary>Бүх хуудсыг «Бүгдийг нэг бүлэгт» горимд нэг бүлэг болгоно (Browser-ийн эрэмбээр).</summary>
        public static SheetGroup AllGroup(DocumentSnapshot snap)
        {
            return SheetGroupingService.Build(snap, DisplayMode.AllInOne, false).Groups[0];
        }

        public static RenumberPlan Plan(DocumentSnapshot snap, SheetGroup group, RenumberSettings settings, IReadOnlyList<SheetSnapshot> working = null,
            MarkerCapabilities markers = null, int selected = -1)
        {
            return NumberingEngine.Compute(new NumberingInput
            {
                Document = snap,
                Group = group,
                WorkingOrder = working ?? group.Sheets,
                SelectedIndex = selected,
                Settings = settings,
                Markers = markers,
            });
        }
    }

    public static class Runner
    {
        /// <summary>Тестийн нэрс (давхардалгүй бүртгэл) — `only` нь нэрний хэсгээр шүүнэ.</summary>
        public static string Run(UIApplication uiapp, string outDir, string templatePath, string only)
        {
            Directory.CreateDirectory(outDir);
            string path = Path.Combine(outDir, "live-report.txt");
            var rep = new Report(path);
            rep.Line("═══ " + DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + " · Revit " + uiapp.Application.VersionNumber + " build "
                + uiapp.Application.VersionBuild + " · filter=" + (only ?? "(бүгд)"));
            SheetNumeratorLog.PathOverride = Path.Combine(outDir, "live-sheet-numerator.log");

            var ctx = new Ctx { App = uiapp, Template = templatePath, OutDir = outDir, R = rep };
            var tests = DocTests.All();
            var sw = Stopwatch.StartNew();

            // Revit-ийн МОДАЛЬ алдааны цонх (Revit-ийн дотоод transaction-д ч) гарч Revit-ийг гацаахаас сэргийлнэ —
            // ЗӨВХӨН манай scratch document-уудад.  Бусад document (хэрэглэгчийн, бусад агентын) хөндөгдөхгүй.
            EventHandler<Autodesk.Revit.DB.Events.FailuresProcessingEventArgs> onFail = (s, e) =>
            {
                FailuresAccessor fa = e.GetFailuresAccessor();
                if (!ctx.Open.Contains(fa.GetDocument()))
                    return;
                bool error = false;
                foreach (FailureMessageAccessor m in fa.GetFailureMessages())
                {
                    QuietFailures.Log.Add(m.GetSeverity() + ": " + m.GetDescriptionText());
                    rep.Line("      [failure] " + m.GetSeverity() + ": " + m.GetDescriptionText());
                    if (m.GetSeverity() == FailureSeverity.Warning)
                        fa.DeleteWarning(m);
                    else
                        error = true;
                }
                e.SetProcessingResult(error ? FailureProcessingResult.ProceedWithRollBack : FailureProcessingResult.Continue);
            };
            uiapp.Application.FailuresProcessing += onFail;
            foreach (KeyValuePair<string, Action<Ctx>> t in tests)
            {
                if (only != null && t.Key.IndexOf(only, StringComparison.OrdinalIgnoreCase) < 0)
                    continue;
                var one = Stopwatch.StartNew();
                try
                {
                    t.Value(ctx);
                    rep.Ok(t.Key + "  (" + one.ElapsedMilliseconds + " ms)");
                }
                catch (Check ex)
                {
                    rep.Bad(t.Key, ex.Message);
                }
                catch (Exception ex)
                {
                    rep.Bad(t.Key, ex.GetType().Name + ": " + ex.Message + "\n" + FirstLines(ex.StackTrace, 6));
                }
                finally
                {
                    SheetNumerator_ResetSeams();
                    ctx.CloseAll();
                }
            }
            uiapp.Application.FailuresProcessing -= onFail;
            string summary = (rep.Fail == 0 ? "PASS " : "FAIL ") + rep.Pass + "/" + (rep.Pass + rep.Fail) + " in " + sw.ElapsedMilliseconds + " ms";
            rep.Line(summary);
            foreach (string f in rep.Failures)
                rep.Line("  ! " + f);
            return summary + "  → " + path;
        }

        private static void SheetNumerator_ResetSeams()
        {
            RenumberApplyService.FailAtStage = null;
        }

        private static string FirstLines(string s, int n)
        {
            if (s == null)
                return string.Empty;
            return string.Join("\n", s.Split('\n').Take(n).Select(l => "        " + l.TrimEnd()));
        }
    }
}
