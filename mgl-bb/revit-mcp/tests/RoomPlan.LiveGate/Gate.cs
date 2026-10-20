using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;
using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Events;
using Autodesk.Revit.UI;
using Autodesk.Revit.UI.Events;

namespace MglRpGate
{
    /// <summary>
    /// Тестийн add-in-ий орох цэг.  `MGL_RP_GATE_JOB` орчны хувьсагчгүй процесст ЮУ Ч ХИЙХГҮЙ (ribbon, event байхгүй) —
    /// хэрэглэгч Revit-ээ энгийнээр нээхэд энэ add-in мэдэгдэхгүй.  Хувьсагчтай үед (run-live.ps1 асаасан тусдаа Revit)
    /// алхмуудыг ExternalEvent-ээр нэг нэгээр гүйцэтгэнэ.
    /// </summary>
    public sealed class GateApp : IExternalApplication
    {
        internal static GateRunner Runner;

        public Result OnStartup(UIControlledApplication app)
        {
            string jobPath = Environment.GetEnvironmentVariable("MGL_RP_GATE_JOB");
            if (string.IsNullOrEmpty(jobPath) || !File.Exists(jobPath)) return Result.Succeeded;
            GateJob job = GateJob.Load(jobPath);
            GateLog.Init(job.RunDir);
            GateLog.Info("OnStartup — Revit " + app.ControlledApplication.VersionNumber + " build " +
                         app.ControlledApplication.VersionBuild + ", job " + jobPath);
            Runner = new GateRunner(job);
            Runner.Event = ExternalEvent.Create(Runner);
            app.ControlledApplication.ApplicationInitialized += Runner.OnInitialized;
            app.Idling += Runner.OnIdling;
            app.DialogBoxShowing += Runner.OnDialog;
            app.ControlledApplication.FailuresProcessing += Runner.OnFailures;
            app.ControlledApplication.DocumentChanged += Runner.OnDocumentChanged;
            return Result.Succeeded;
        }

        public Result OnShutdown(UIControlledApplication app) { return Result.Succeeded; }
    }

    internal enum StepState { Done, Wait, Failed }

    internal sealed class Step
    {
        public string Name;
        public Func<UIApplication, StepState> Run;
        public TimeSpan Timeout;
        /// <summary>Унавал үлдсэн алхмуудыг алгасна (дараагийнх нь түүнээс хамаарна).</summary>
        public bool Critical;
        public DateTime Started;
        public string Error;
    }

    /// <summary>
    /// Алхмууд ExternalEvent дотор (API контекст — баримт үүсгэх/нээх, PostCommand зөвшөөрөгдөнө).  `Wait` = нөхцөл хүлээж
    /// буй (жишээ нь PostCommand-оор явуулсан Undo) — Idling 0.5 с тутам дахин шалгана.  Алхам бүр `steps.jsonl`-д.
    /// </summary>
    internal sealed class GateRunner : IExternalEventHandler
    {
        public ExternalEvent Event;
        public readonly GateJob Job;
        private readonly Queue<Step> _steps = new Queue<Step>();
        private Step _cur;
        private bool _ready, _raised, _finished;
        private string _abort;
        private DateTime _nextPoll = DateTime.MinValue, _beat = DateTime.MinValue;
        public readonly List<string> Dialogs = new List<string>();
        public readonly Dictionary<string, object> Facts = new Dictionary<string, object>(StringComparer.Ordinal);
        public readonly List<string> Failed = new List<string>();
        /// <summary>DocumentChanged-ийг сонсож буй алхам (null = сонсохгүй).</summary>
        public Action<DocumentChangedEventArgs> ChangeListener;

        public GateRunner(GateJob job) { Job = job; }

        public string GetName() { return "MGL Room Plan live gate"; }

        public void OnInitialized(object sender, ApplicationInitializedEventArgs e)
        {
            try
            {
                string mode = Job.Get("mode", "units");
                if (mode == "floor") FloorScenario.Build(this);
                else if (mode == "studio") StudioScenario.Build(this);
                else Scenario.Build(this);
                GateLog.Info("ApplicationInitialized — " + _steps.Count + " алхам");
            }
            catch (Exception ex) { GateLog.Error("plan", ex); _abort = "plan failed: " + ex.Message; _steps.Clear(); }
            _ready = true;
        }

        public void Enqueue(string name, Func<UIApplication, StepState> run, int timeoutMin = 10, bool critical = false)
        {
            _steps.Enqueue(new Step { Name = name, Run = run, Timeout = TimeSpan.FromMinutes(timeoutMin), Critical = critical });
        }

        public void OnIdling(object sender, IdlingEventArgs e)
        {
            if (!_ready || _finished) return;
            e.SetRaiseWithoutDelay();
            if (_raised || DateTime.Now < _nextPoll) return;
            _raised = true;
            if (Event.Raise() != ExternalEventRequest.Accepted) { _raised = false; _nextPoll = DateTime.Now.AddMilliseconds(500); }
        }

        public void Execute(UIApplication app)
        {
            _raised = false;
            if ((DateTime.Now - _beat).TotalSeconds > 2)
            {
                _beat = DateTime.Now;
                try { File.WriteAllText(Path.Combine(Job.RunDir, "heartbeat"), _beat.ToString("o")); } catch { }
            }
            if (_finished) return;
            if (_cur == null)
            {
                if (_steps.Count == 0) { Finish(app); return; }
                _cur = _steps.Dequeue();
                _cur.Started = DateTime.Now;
                GateLog.Info("▶ " + _cur.Name);
            }
            StepState st;
            try { st = _cur.Run(app); }
            catch (Exception ex) { _cur.Error = ex.GetType().Name + ": " + ex.Message; GateLog.Error(_cur.Name, ex); st = StepState.Failed; }
            if (st == StepState.Wait && DateTime.Now - _cur.Started > _cur.Timeout)
            {
                _cur.Error = (_cur.Error ?? "") + " timeout " + _cur.Timeout.TotalMinutes + " мин";
                st = StepState.Failed;
            }
            if (st == StepState.Wait) { _nextPoll = DateTime.Now.AddMilliseconds(500); return; }
            Record(_cur, st);
            if (st == StepState.Failed)
            {
                Failed.Add(_cur.Name);
                if (_cur.Critical)
                {
                    GateLog.Error("critical алхам унав — үлдсэн " + _steps.Count + " алхмыг алгасна");
                    _steps.Clear();
                    _abort = _cur.Name + ": " + _cur.Error;
                }
            }
            _cur = null;
        }

        /// <summary>Алхмын дотроос: алдааны шалтгааныг тайланд бичээд Failed буцаана.</summary>
        public StepState Fail(string why)
        {
            if (_cur != null) _cur.Error = why;
            GateLog.Error(why);
            return StepState.Failed;
        }

        private void Record(Step s, StepState st)
        {
            double sec = (DateTime.Now - s.Started).TotalSeconds;
            GateLog.Info((st == StepState.Done ? "✔ " : "✖ ") + s.Name + " (" + U.F(sec) + " с)" + (s.Error != null ? " — " + s.Error : ""));
            var j = new Json().Obj().Prop("step", s.Name).Prop("state", st.ToString()).Prop("seconds", sec).Prop("error", s.Error).EndObj();
            File.AppendAllText(Path.Combine(Job.RunDir, "steps.jsonl"), j + Environment.NewLine, new UTF8Encoding(false));
        }

        private void Finish(UIApplication app)
        {
            _finished = true;
            string verdict = _abort != null ? "ABORTED" : Failed.Count == 0 ? "PASS" : "FAIL";
            var j = new Json().Obj().Prop("schema", "mgl-roomplan-live-run-v1").Prop("verdict", verdict)
                .Prop("year", Job.Year).Prop("revit_version", app.Application.VersionNumber)
                .Prop("revit_build", app.Application.VersionBuild).Prop("finished_at", DateTime.Now.ToString("o"))
                .Prop("abort", _abort);
            j.Key("failed_steps").Arr();
            foreach (string f in Failed) j.Str(f);
            j.EndArr();
            j.Key("facts").Obj();
            foreach (KeyValuePair<string, object> kv in Facts) Write(j, kv.Key, kv.Value);
            j.EndObj();
            j.Key("dialogs").Arr();
            foreach (string d in Dialogs) j.Str(d);
            j.EndArr();
            j.EndObj();
            j.Save(Path.Combine(Job.RunDir, "run.json"));
            File.WriteAllText(Path.Combine(Job.RunDir, "DONE"), verdict);
            GateLog.Info("■ дууслаа — " + verdict + (_abort != null ? " (" + _abort + ")" : ""));
            if (Job.ExitWhenDone)
            {
                try { app.PostCommand(RevitCommandId.LookupPostableCommandId(PostableCommand.ExitRevit)); }
                catch (Exception ex) { GateLog.Error("exit", ex); }
            }
        }

        private static void Write(Json j, string key, object v)
        {
            if (v == null) j.Key(key).Null();
            else if (v is string) j.Prop(key, (string)v);
            else if (v is bool) j.Prop(key, (bool)v);
            else if (v is int || v is long) j.Prop(key, Convert.ToInt64(v));
            else if (v is double) j.Prop(key, (double)v);
            else j.Prop(key, v.ToString());
        }

        // ── Цонх, алдаа, өөрчлөлт ──────────────────────────────────

        public void OnDialog(object sender, DialogBoxShowingEventArgs e)
        {
            string msg = (e as TaskDialogShowingEventArgs)?.Message ?? (e as MessageBoxShowingEventArgs)?.Message ?? "";
            string answer = null;
            // Тестийн модел түр зуурынх: «хадгалах уу?» → Үгүй.  Бусад цонхыг зөвхөн логлоно (хэрэглэгч хараад хариулна).
            if ((e.DialogId ?? "").IndexOf("Save", StringComparison.OrdinalIgnoreCase) >= 0)
            {
                try { e.OverrideResult((int)TaskDialogResult.No); answer = "No"; } catch { }
            }
            // Анхааруулгын жагсаалт (алдаа биш — алдааг transaction бүр өөрийн preprocessor-оор буцаана): OK, эс бөгөөс gate гацна.
            // Үүсгэсэн элементийн анхааруулгыг Verifier doc.GetWarnings()-ээс тусад нь тоолно.
            else if (e.DialogId == "Dialog_Revit_DocWarnDialog")
            {
                try { e.OverrideResult((int)TaskDialogResult.Ok); answer = "OK"; } catch { }
            }
            string line = DateTime.Now.ToString("HH:mm:ss") + " «" + e.DialogId + "» " + msg.Replace("\n", " ") + (answer != null ? " ⇒ " + answer : "");
            Dialogs.Add(line);
            GateLog.Info("dialog " + line);
        }

        public void OnFailures(object sender, FailuresProcessingEventArgs e)
        {
            FailuresAccessor fa = e.GetFailuresAccessor();
            foreach (FailureMessageAccessor m in fa.GetFailureMessages())
                GateLog.Info("failure " + m.GetSeverity() + ": " + m.GetDescriptionText() + " [" + fa.GetTransactionName() + "]");
        }

        public void OnDocumentChanged(object sender, DocumentChangedEventArgs e)
        {
            Action<DocumentChangedEventArgs> l = ChangeListener;
            if (l != null) { try { l(e); } catch (Exception ex) { GateLog.Error("DocumentChanged", ex); } }
        }
    }

    /// <summary>run-live.ps1-ийн бичсэн ажлын файл (`job.ini`, `key=value` мөрүүд).</summary>
    internal sealed class GateJob
    {
        public string RunDir, Template, Library, ModelsDir;
        public int Year;
        public bool ExitWhenDone;
        private readonly Dictionary<string, string> _raw = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

        public static GateJob Load(string path)
        {
            var j = new GateJob();
            foreach (string line in File.ReadAllLines(path, Encoding.UTF8))
            {
                string l = line.Trim();
                int eq = l.IndexOf('=');
                if (l.Length == 0 || l.StartsWith("#") || eq <= 0) continue;
                j._raw[l.Substring(0, eq).Trim()] = l.Substring(eq + 1).Trim();
            }
            j.RunDir = j.Get("run_dir", Path.GetDirectoryName(path));
            j.Year = int.Parse(j.Get("year", "0"), CultureInfo.InvariantCulture);
            j.Template = j.Get("template", null);
            j.Library = j.Get("library", null);
            j.ModelsDir = j.Get("models_dir", Path.Combine(j.RunDir, "models"));
            j.ExitWhenDone = j.Get("exit", "0") == "1";
            return j;
        }

        public string Get(string key, string def)
        {
            string v;
            return _raw.TryGetValue(key, out v) && v.Length > 0 ? v : def;
        }
    }

    internal static class GateLog
    {
        private static string _path;
        private static readonly object Lock = new object();

        public static void Init(string runDir) { Directory.CreateDirectory(runDir); _path = Path.Combine(runDir, "gate.log"); }
        public static void Info(string msg) { Write("INFO", msg); }
        public static void Warn(string msg) { Write("WARN", msg); }
        public static void Error(string msg, Exception ex = null)
        {
            Write("ERROR", msg + (ex != null ? " — " + ex.GetType().Name + ": " + ex.Message + "\n" + ex.StackTrace : ""));
        }

        private static void Write(string level, string msg)
        {
            if (_path == null) return;
            lock (Lock)
            {
                try
                {
                    File.AppendAllText(_path, DateTime.Now.ToString("HH:mm:ss.fff", CultureInfo.InvariantCulture) + " " + level + " " + msg +
                                              Environment.NewLine, new UTF8Encoding(false));
                }
                catch { }
            }
        }
    }

    /// <summary>Хамааралгүй, жижиг JSON бичигч (тайлан) — net48 ба net10 хоёуланд ижил.</summary>
    internal sealed class Json
    {
        private readonly StringBuilder _sb = new StringBuilder();
        private readonly Stack<bool> _first = new Stack<bool>();
        private bool _afterKey;

        private void BeforeValue()
        {
            if (_afterKey) { _afterKey = false; return; }
            if (_first.Count == 0) return;
            if (_first.Peek()) { _first.Pop(); _first.Push(false); }
            else _sb.Append(',');
        }

        public Json Obj() { BeforeValue(); _sb.Append('{'); _first.Push(true); return this; }
        public Json EndObj() { _first.Pop(); _sb.Append('}'); return this; }
        public Json Arr() { BeforeValue(); _sb.Append('['); _first.Push(true); return this; }
        public Json EndArr() { _first.Pop(); _sb.Append(']'); return this; }
        public Json Key(string k) { BeforeValue(); _sb.Append(Q(k)).Append(':'); _afterKey = true; return this; }
        public Json Str(string v) { BeforeValue(); _sb.Append(v == null ? "null" : Q(v)); return this; }
        public Json Num(double v) { BeforeValue(); _sb.Append(double.IsNaN(v) || double.IsInfinity(v) ? "null" : v.ToString("R", CultureInfo.InvariantCulture)); return this; }
        public Json Num(long v) { BeforeValue(); _sb.Append(v.ToString(CultureInfo.InvariantCulture)); return this; }
        public Json Bool(bool v) { BeforeValue(); _sb.Append(v ? "true" : "false"); return this; }
        public Json Null() { BeforeValue(); _sb.Append("null"); return this; }
        public Json Prop(string k, string v) { return Key(k).Str(v); }
        public Json Prop(string k, double v) { return Key(k).Num(v); }
        public Json Prop(string k, long v) { return Key(k).Num(v); }
        public Json Prop(string k, bool v) { return Key(k).Bool(v); }
        public override string ToString() { return _sb.ToString(); }

        public static string Q(string s)
        {
            var sb = new StringBuilder("\"");
            foreach (char c in s ?? string.Empty)
            {
                switch (c)
                {
                    case '"': sb.Append("\\\""); break;
                    case '\\': sb.Append("\\\\"); break;
                    case '\n': sb.Append("\\n"); break;
                    case '\r': sb.Append("\\r"); break;
                    case '\t': sb.Append("\\t"); break;
                    default:
                        if (c < 32) sb.Append("\\u" + ((int)c).ToString("X4", CultureInfo.InvariantCulture));
                        else sb.Append(c);
                        break;
                }
            }
            return sb.Append('"').ToString();
        }

        public void Save(string path) { File.WriteAllText(path, ToString(), new UTF8Encoding(false)); }
    }

    internal static class U
    {
        public static double Mm(double mm) { return mm / 304.8; }
        public static double ToMm(double ft) { return ft * 304.8; }
        public static XYZ P(double xMm, double yMm, double zMm = 0) { return new XYZ(Mm(xMm), Mm(yMm), Mm(zMm)); }
        public static string F(double v) { return v.ToString("0.###", CultureInfo.InvariantCulture); }
        public static double M2(double sqft) { return sqft * 0.09290304; }
    }
}
