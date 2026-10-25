using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Text;
using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Events;
using Autodesk.Revit.UI;
using Autodesk.Revit.UI.Events;

namespace MglBbHarness
{
    /// <summary>
    /// Scratch probe harness — inert without MGL_BB_HARNESS_DIR.  Polls &lt;dir&gt;\cmd\*.cmd, loads the named probe DLL
    /// (from bytes, so it can be rebuilt) and invokes a static string Run(UIApplication, string outDir, string args)
    /// inside an ExternalEvent.  Result → &lt;dir&gt;\out\&lt;id&gt;.result.txt.
    /// </summary>
    public sealed class App : IExternalApplication
    {
        internal static string Dir;
        internal static Runner R;

        public Result OnStartup(UIControlledApplication app)
        {
            Dir = Environment.GetEnvironmentVariable("MGL_BB_HARNESS_DIR");
            if (string.IsNullOrEmpty(Dir) || !Directory.Exists(Dir)) return Result.Succeeded;
            Directory.CreateDirectory(Path.Combine(Dir, "cmd"));
            Directory.CreateDirectory(Path.Combine(Dir, "out"));
            Directory.CreateDirectory(Path.Combine(Dir, "done"));
            Log("OnStartup Revit " + app.ControlledApplication.VersionNumber + " " + app.ControlledApplication.VersionBuild);
            R = new Runner();
            R.Event = ExternalEvent.Create(R);
            app.Idling += R.OnIdling;
            app.DialogBoxShowing += OnDialog;
            app.ControlledApplication.FailuresProcessing += OnFailures;
            return Result.Succeeded;
        }

        public Result OnShutdown(UIControlledApplication app) { return Result.Succeeded; }

        internal static void Log(string m)
        {
            try { File.AppendAllText(Path.Combine(Dir, "harness.log"), DateTime.Now.ToString("HH:mm:ss.fff") + " " + m + Environment.NewLine, Encoding.UTF8); } catch { }
        }

        private static void OnDialog(object sender, DialogBoxShowingEventArgs e)
        {
            try
            {
                string id = e.DialogId;
                string msg = "";
                if (e is TaskDialogShowingEventArgs td) { msg = td.Message; }
                else if (e is MessageBoxShowingEventArgs mb) { msg = mb.Message; }
                Log("DIALOG id=" + id + " msg=" + (msg ?? "").Replace("\n", " | "));
                // UI-урсгалын туршилт: dialogs.manual байвал add-in-ий өөрийн TaskDialog-ийг UIA driver дарна.
                if (File.Exists(Path.Combine(Dir, "dialogs.manual")) && (id == null || id.IndexOf("Unresolved", StringComparison.OrdinalIgnoreCase) < 0)) return;
                if (e is TaskDialogShowingEventArgs t)
                {
                    // Unresolved references → "Ignore and continue" (1002); otherwise close/ok.
                    if (id != null && id.IndexOf("Unresolved", StringComparison.OrdinalIgnoreCase) >= 0) { t.OverrideResult(1002); return; }
                    t.OverrideResult((int)TaskDialogResult.Close);
                    return;
                }
                if (e is MessageBoxShowingEventArgs) { e.OverrideResult(1); return; }
                e.OverrideResult(1);
            }
            catch (Exception ex) { Log("dialog handler error " + ex.Message); }
        }

        private static void OnFailures(object sender, FailuresProcessingEventArgs e)
        {
            try
            {
                FailuresAccessor fa = e.GetFailuresAccessor();
                bool resolved = false;
                foreach (FailureMessageAccessor m in fa.GetFailureMessages())
                {
                    if (m.GetSeverity() == FailureSeverity.Warning) { fa.DeleteWarning(m); continue; }
                    // Хуулбар загварын нээлт / шинэчлэлийн алдаа (ж: «dimension references are invalid») — Revit-ийн шийдлээр (тэр элементийг
                    // устгах) шийднэ; эс бол алдааны цонх «Cancel»-оор хаагдаж нээлт цуцлагддаг (2024 → 2027 шинэчлэл).
                    if (m.GetSeverity() == FailureSeverity.Error && m.HasResolutions())
                    {
                        try { fa.ResolveFailure(m); resolved = true; Log("resolved failure: " + m.GetDescriptionText()); } catch { }
                    }
                }
                if (resolved) e.SetProcessingResult(FailureProcessingResult.ProceedWithCommit);
            }
            catch { }
        }
    }

    internal sealed class Runner : IExternalEventHandler
    {
        public ExternalEvent Event;
        private bool _raised;
        private DateTime _next = DateTime.MinValue, _beat = DateTime.MinValue;

        public string GetName() { return "MGL BB probe harness"; }

        public void OnIdling(object sender, IdlingEventArgs e)
        {
            if (DateTime.Now < _next || _raised) return;
            _next = DateTime.Now.AddMilliseconds(700);
            if ((DateTime.Now - _beat).TotalSeconds > 3)
            {
                _beat = DateTime.Now;
                try { File.WriteAllText(Path.Combine(App.Dir, "heartbeat"), _beat.ToString("o")); } catch { }
            }
            string[] cmds;
            try { cmds = Directory.GetFiles(Path.Combine(App.Dir, "cmd"), "*.cmd"); } catch { return; }
            if (cmds.Length == 0) return;
            _raised = true;
            if (Event.Raise() != ExternalEventRequest.Accepted) _raised = false;
        }

        public void Execute(UIApplication app)
        {
            _raised = false;
            string[] cmds;
            try { cmds = Directory.GetFiles(Path.Combine(App.Dir, "cmd"), "*.cmd").OrderBy(x => x, StringComparer.Ordinal).ToArray(); } catch { return; }
            if (cmds.Length == 0) return;
            string path = cmds[0];
            var kv = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            try
            {
                foreach (string line in File.ReadAllLines(path, Encoding.UTF8))
                {
                    int i = line.IndexOf('=');
                    if (i > 0) kv[line.Substring(0, i).Trim()] = line.Substring(i + 1).Trim();
                }
            }
            catch (IOException) { return; } // still being written
            string id = kv.TryGetValue("id", out var v) ? v : Path.GetFileNameWithoutExtension(path);
            try { File.Move(path, Path.Combine(App.Dir, "done", Path.GetFileName(path) + "." + DateTime.Now.Ticks)); } catch { }
            string outDir = Path.Combine(App.Dir, "out");
            string result;
            var sw = System.Diagnostics.Stopwatch.StartNew();
            try
            {
                if (kv.TryGetValue("op", out var op) && op == "open")
                {
                    UIDocument ud = app.OpenAndActivateDocument(kv["file"]);
                    result = "opened " + ud.Document.Title;
                }
                else
                {
                    byte[] bytes = File.ReadAllBytes(kv["dll"]);
                    Assembly asm = Assembly.Load(bytes);
                    Type t = asm.GetType(kv.TryGetValue("type", out var tn) ? tn : "Probe.Entry", true);
                    MethodInfo m = t.GetMethod(kv.TryGetValue("method", out var mn) ? mn : "Run", BindingFlags.Public | BindingFlags.Static);
                    object r = m.Invoke(null, new object[] { app, outDir, kv.TryGetValue("args", out var a) ? a : "" });
                    result = r == null ? "(null)" : r.ToString();
                }
            }
            catch (Exception ex)
            {
                Exception inner = ex is TargetInvocationException && ex.InnerException != null ? ex.InnerException : ex;
                result = "ERROR " + inner.GetType().FullName + ": " + inner.Message + Environment.NewLine + inner.StackTrace;
            }
            App.Log("cmd " + id + " " + sw.ElapsedMilliseconds + " ms");
            try { File.WriteAllText(Path.Combine(outDir, id + ".result.txt"), result, new UTF8Encoding(false)); } catch { }
        }
    }
}
