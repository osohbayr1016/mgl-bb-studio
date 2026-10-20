using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Autodesk.Revit.ApplicationServices;
using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Events;
using Autodesk.Revit.UI;
using Autodesk.Revit.UI.Events;

namespace MglWeGate
{
    /// <summary>
    /// Тестийн add-in-ий орох цэг.  `MGL_WE_GATE_JOB` орчны хувьсагчгүй процесст ЮУ Ч ХИЙХГҮЙ (ribbon, event байхгүй) — хэрэглэгч Revit-ээ
    /// энгийнээр нээхэд энэ add-in мэдэгдэхгүй.  Хувьсагчтай үед (run-live.ps1 асаасан тусдаа Revit) алхмуудыг дараалан гүйцэтгэнэ.
    /// </summary>
    public sealed class GateApp : IExternalApplication
    {
        internal static GateRunner Runner;

        public Result OnStartup(UIControlledApplication app)
        {
            string jobPath = Environment.GetEnvironmentVariable("MGL_WE_GATE_JOB");
            if (string.IsNullOrEmpty(jobPath) || !File.Exists(jobPath)) return Result.Succeeded;
            GateJob job = GateJob.Load(jobPath);
            GateLog.Init(job.RunDir);
            GateLog.Info("OnStartup — Revit " + app.ControlledApplication.VersionNumber + " build " + app.ControlledApplication.VersionBuild
                         + ", job " + jobPath + ", phase " + job.Phase);
            Runner = new GateRunner(job, app);
            Runner.Event = ExternalEvent.Create(Runner);
            app.ControlledApplication.ApplicationInitialized += Runner.OnInitialized;
            app.Idling += Runner.OnIdling;
            app.DialogBoxShowing += Runner.OnDialog;
            app.ControlledApplication.FailuresProcessing += Runner.OnFailures;
            app.ControlledApplication.DocumentChanged += (s, e) => { if (Runner.Live != null) Runner.Live.OnDocChanged(s, e); };
            return Result.Succeeded;
        }

        public Result OnShutdown(UIControlledApplication app) { return Result.Succeeded; }
    }

    internal enum StepState { Done, Wait, Failed }

    internal sealed class Step
    {
        public string Name;
        public Func<UIApplication, StepState> Run;
        public TimeSpan Timeout = TimeSpan.FromMinutes(15);
        /// <summary>Унавал үлдсэн алхмуудыг алгасна (жишээ нь загвар үүсгэх — дараагийнх нь түүнээс хамаарна).</summary>
        public bool Critical;
        public DateTime Started;
        public string Error;
    }

    /// <summary>
    /// Алхмуудыг ExternalEvent-ээр (API контекст — баримт нээх, PostCommand зөвшөөрөгдөнө) нэг нэгээр гүйцэтгэнэ.  `Wait` = нөхцөл
    /// хүлээж буй (жишээ нь production-ийн арын ажил) — Idling 0.5 с тутам дахин шалгана.  Алхам бүрийн үр дүн `steps.jsonl`-д.
    /// </summary>
    internal sealed class GateRunner : IExternalEventHandler
    {
        public ExternalEvent Event;
        public readonly GateJob Job;
        private readonly UIControlledApplication _ui;
        private readonly Queue<Step> _steps = new Queue<Step>();
        private readonly List<string> _results = new List<string>();
        private Step _cur;
        private bool _ready, _raised, _finished;
        private string _abort;
        private DateTime _nextPoll = DateTime.MinValue;
        public readonly List<DialogRecord> Dialogs = new List<DialogRecord>();
        /// <summary>Сценари одоо хүлээж буй цонхны хариулт (DialogId эсвэл мессежийн хэсэг → TaskDialogResult).</summary>
        public readonly List<DialogRule> Rules = new List<DialogRule>();
        public readonly Dictionary<string, object> Facts = new Dictionary<string, object>(StringComparer.Ordinal);
        public LiveContext Live;

        public GateRunner(GateJob job, UIControlledApplication ui) { Job = job; _ui = ui; }

        public string GetName() { return "MGL Wall Elevation release gate"; }

        public void OnInitialized(object sender, ApplicationInitializedEventArgs e)
        {
            try
            {
                Plan.Build(this);
                GateLog.Info("ApplicationInitialized — " + _steps.Count + " алхам");
                _ready = true;
            }
            catch (Exception ex) { GateLog.Error("plan", ex); _ready = true; Enqueue("finish", app => { Finish(app, "plan failed"); return StepState.Done; }); }
        }

        public void Enqueue(string name, Func<UIApplication, StepState> run, int timeoutMin = 15, bool critical = false)
        {
            _steps.Enqueue(new Step { Name = name, Run = run, Timeout = TimeSpan.FromMinutes(timeoutMin), Critical = critical });
        }

        public int Pending { get { return _steps.Count; } }

        public void OnIdling(object sender, IdlingEventArgs e)
        {
            if (!_ready || _finished) return;
            e.SetRaiseWithoutDelay();
            if (_raised || DateTime.Now < _nextPoll) return;
            _raised = true;
            ExternalEventRequest r = Event.Raise();
            if (r != ExternalEventRequest.Accepted) { _raised = false; _nextPoll = DateTime.Now.AddMilliseconds(500); }
        }

        private DateTime _beat = DateTime.MinValue;

        public void Execute(UIApplication app)
        {
            _raised = false;
            if ((DateTime.Now - _beat).TotalSeconds > 2)
            {
                // Launcher энэ файлаар gate амьд эсэхийг харна (Revit хэрэгслийн горимд гацвал ExternalEvent ажиллахгүй → heartbeat зогсоно).
                _beat = DateTime.Now;
                try { File.WriteAllText(Path.Combine(Job.RunDir, "heartbeat"), _beat.ToString("o")); } catch { }
            }
            if (_finished) return;
            if (_cur == null)
            {
                if (_steps.Count == 0) { Finish(app, _abort); return; }
                _cur = _steps.Dequeue();
                _cur.Started = DateTime.Now;
                GateLog.Info("▶ " + _cur.Name);
            }
            StepState st;
            try { st = _cur.Run(app); }
            catch (Exception ex) { _cur.Error = ex.GetType().Name + ": " + ex.Message; GateLog.Error(_cur.Name, ex); st = StepState.Failed; }
            if (st == StepState.Wait && DateTime.Now - _cur.Started > _cur.Timeout)
            {
                _cur.Error = "timeout " + _cur.Timeout.TotalMinutes + " мин";
                st = StepState.Failed;
            }
            if (st == StepState.Wait) { _nextPoll = DateTime.Now.AddMilliseconds(500); return; }
            Record(_cur, st);
            if (st == StepState.Failed && _cur.Critical)
            {
                GateLog.Error("critical алхам унав — үлдсэн " + _steps.Count + " алхмыг алгасна");
                _steps.Clear();
                _abort = _cur.Name + ": " + _cur.Error;
            }
            _cur = null;
        }

        private void Record(Step s, StepState st)
        {
            double sec = (DateTime.Now - s.Started).TotalSeconds;
            GateLog.Info((st == StepState.Done ? "✔ " : "✖ ") + s.Name + " (" + U.F(sec) + " с)" + (s.Error != null ? " — " + s.Error : ""));
            var j = new Json().Obj().Prop("step", s.Name).Prop("state", st.ToString()).Prop("seconds", sec).Prop("error", s.Error).EndObj();
            _results.Add(j.ToString());
            File.AppendAllText(Path.Combine(Job.RunDir, "steps.jsonl"), j + Environment.NewLine);
        }

        private void Finish(UIApplication app, string why)
        {
            _finished = true;
            var j = new Json().Obj().Prop("schema", "mgl-we-live-run-v1").Prop("year", Job.Year)
                .Prop("revit_version", app.Application.VersionNumber).Prop("revit_build", app.Application.VersionBuild)
                .Prop("finished_at", DateTime.Now.ToString("o")).Prop("abort", why);
            j.Key("facts").Obj();
            foreach (KeyValuePair<string, object> kv in Facts) Write(j, kv.Key, kv.Value);
            j.EndObj();
            j.Key("dialogs").Arr();
            foreach (DialogRecord d in Dialogs) j.Obj().Prop("at", d.At.ToString("HH:mm:ss")).Prop("id", d.Id).Prop("message", d.Message).Prop("answer", d.Answer).EndObj();
            j.EndArr();
            j.EndObj();
            j.Save(Path.Combine(Job.RunDir, "run.json"));
            File.WriteAllText(Path.Combine(Job.RunDir, "DONE"), why ?? "ok");
            GateLog.Info("■ дууслаа" + (why != null ? " — " + why : ""));
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

        // ── Цонх, алдаа ────────────────────────────────────────────

        public void OnDialog(object sender, DialogBoxShowingEventArgs e)
        {
            var rec = new DialogRecord { At = DateTime.Now, Id = e.DialogId };
            var td = e as TaskDialogShowingEventArgs;
            var mb = e as MessageBoxShowingEventArgs;
            if (td != null) rec.Message = td.Message;
            else if (mb != null) rec.Message = mb.Message;
            DialogRule hit = Rules.FirstOrDefault(r => r.Matches(e.DialogId, rec.Message));
            if (hit != null)
            {
                rec.Answer = hit.Name + " → " + hit.Result;
                try { e.OverrideResult(hit.Result); } catch (Exception ex) { rec.Answer += " (override алдаа: " + ex.Message + ")"; }
                if (hit.Once) Rules.Remove(hit);
            }
            Dialogs.Add(rec);
            GateLog.Info("dialog «" + e.DialogId + "» " + (rec.Message ?? "").Replace("\n", " ") + (rec.Answer != null ? " ⇒ " + rec.Answer : " (хариулаагүй)"));
        }

        public void OnFailures(object sender, FailuresProcessingEventArgs e)
        {
            FailuresAccessor fa = e.GetFailuresAccessor();
            foreach (FailureMessageAccessor m in fa.GetFailureMessages())
                GateLog.Info("failure " + m.GetSeverity() + ": " + m.GetDescriptionText() + " [" + fa.GetTransactionName() + "]");
        }
    }

    internal sealed class DialogRecord
    {
        public DateTime At;
        public string Id, Message, Answer;
    }

    internal sealed class DialogRule
    {
        public string Name;
        public string IdContains;
        public string MessageContains;
        public int Result;
        public bool Once = true;

        public bool Matches(string id, string message)
        {
            if (IdContains != null && (id ?? "").IndexOf(IdContains, StringComparison.OrdinalIgnoreCase) < 0) return false;
            if (MessageContains != null && (message ?? "").IndexOf(MessageContains, StringComparison.OrdinalIgnoreCase) < 0) return false;
            return IdContains != null || MessageContains != null;
        }
    }
}
