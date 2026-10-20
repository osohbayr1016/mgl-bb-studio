using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;
using Autodesk.Revit.DB;

namespace MglWeGate
{
    /// <summary>
    /// run-live.ps1-ийн бичсэн ажлын файл (`job.ini`, `key=value` мөрүүд).  JSON сан ашиглахгүй — net48 ба net10 хоёуланд ижил,
    /// хамааралгүй.
    /// </summary>
    internal sealed class GateJob
    {
        public string Path;
        public string RunDir;
        public int Year;
        public string Template;
        public string Library;
        public string ModelsDir;
        public string Phase = "models";             // models | scenarios | all
        public string Scenarios = "*";
        public string ProductDll;                   // тест хийж буй суусан RevitMcpAddin.dll (sha тулгалтад)
        public bool ExitWhenDone = true;
        public readonly Dictionary<string, string> Raw = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

        public static GateJob Load(string path)
        {
            var j = new GateJob { Path = path };
            foreach (string line in File.ReadAllLines(path, Encoding.UTF8))
            {
                string l = line.Trim();
                if (l.Length == 0 || l.StartsWith("#")) continue;
                int eq = l.IndexOf('=');
                if (eq <= 0) continue;
                j.Raw[l.Substring(0, eq).Trim()] = l.Substring(eq + 1).Trim();
            }
            j.RunDir = j.Get("run_dir", System.IO.Path.GetDirectoryName(path));
            j.Year = int.Parse(j.Get("year", "0"), CultureInfo.InvariantCulture);
            j.Template = j.Get("template", null);
            j.Library = j.Get("library", null);
            j.ModelsDir = j.Get("models_dir", System.IO.Path.Combine(j.RunDir, "models"));
            j.Phase = j.Get("phase", "models");
            j.Scenarios = j.Get("scenarios", "*");
            j.ProductDll = j.Get("product_dll", null);
            j.ExitWhenDone = j.Get("exit", "1") == "1";
            return j;
        }

        public string Get(string key, string def)
        {
            string v;
            return Raw.TryGetValue(key, out v) && v.Length > 0 ? v : def;
        }
    }

    /// <summary>Gate-ийн лог (`gate.log`) — мөр бүр цагтай; Revit гацвал launcher энд хүртэлх явцыг харна.</summary>
    internal static class GateLog
    {
        private static string _path;
        private static readonly object Lock = new object();

        public static void Init(string runDir)
        {
            Directory.CreateDirectory(runDir);
            _path = System.IO.Path.Combine(runDir, "gate.log");
        }

        public static void Info(string msg) { Write("INFO", msg); }
        public static void Warn(string msg) { Write("WARN", msg); }
        public static void Error(string msg, Exception ex = null) { Write("ERROR", msg + (ex != null ? " — " + ex.GetType().Name + ": " + ex.Message + "\n" + ex.StackTrace : "")); }

        private static void Write(string level, string msg)
        {
            if (_path == null) return;
            lock (Lock)
            {
                try { File.AppendAllText(_path, DateTime.Now.ToString("HH:mm:ss.fff", CultureInfo.InvariantCulture) + " " + level + " " + msg + Environment.NewLine, new UTF8Encoding(false)); }
                catch { }
            }
        }
    }

    /// <summary>Хамааралгүй, жижиг JSON бичигч (тайлан).</summary>
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
        public static long Id(ElementId id) { return id == null ? -1 : id.Value; }
        public static string F(double v) { return v.ToString("0.###", CultureInfo.InvariantCulture); }
    }

    /// <summary>Загвар үүсгэх үеийн анхааруулгыг (давхардсан хана, хаалттай биш өрөө г.м.) залгиж ЛОГЛОНО — алдааг биш.</summary>
    internal sealed class WarningSwallower : IFailuresPreprocessor
    {
        public readonly List<string> Seen = new List<string>();

        public FailureProcessingResult PreprocessFailures(FailuresAccessor fa)
        {
            foreach (FailureMessageAccessor m in fa.GetFailureMessages())
            {
                string d = m.GetDescriptionText();
                Seen.Add(m.GetSeverity() + ": " + d);
                if (m.GetSeverity() == FailureSeverity.Warning) fa.DeleteWarning(m);
            }
            return FailureProcessingResult.Continue;
        }

        public static Transaction Start(Document doc, string name, WarningSwallower sw)
        {
            var t = new Transaction(doc, name);
            FailureHandlingOptions o = t.GetFailureHandlingOptions();
            o.SetFailuresPreprocessor(sw);
            t.SetFailureHandlingOptions(o);
            t.Start();
            return t;
        }
    }
}
