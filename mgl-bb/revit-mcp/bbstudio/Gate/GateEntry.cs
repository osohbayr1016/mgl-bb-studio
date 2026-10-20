using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;
using MglBb.Core;
using MglBb.RevitSide;

namespace MglBb.Gate
{
    /// <summary>
    /// UI-гүй (цонхгүй) орох цэг — зөвхөн тест/gate-д: scratch probe harness энэ DLL-ийг ачаалж <c>Run(app, outDir, args)</c>-ийг ExternalEvent
    /// дотор дууддаг.  Хэрэглэгчийн Revit-д ribbon-оос ХЭЗЭЭ Ч дуудагдахгүй.  args = "learn" | "generate:&lt;elementId&gt;[;opts]" | "annotate:&lt;viewId&gt;" …
    /// </summary>
    public static class Entry
    {
        public static string Run(UIApplication app, string outDir, string args)
        {
            Document doc = app.ActiveUIDocument?.Document;
            if (doc == null) return "no active document";
            Directory.CreateDirectory(outDir);
            string cmd = (args ?? "").Trim();
            string op = cmd.Split(':')[0];
            string rest = cmd.Length > op.Length ? cmd.Substring(op.Length + 1) : "";
            var sb = new StringBuilder();
            switch (op)
            {
                case "learn":
                    {
                        BbLearner.SkipNameContains = "(MGL";
                        BbStandard std = BbLearner.Learn(doc, new BbStandard(), maxPerKind: string.IsNullOrEmpty(rest) ? 40 : int.Parse(rest), out BbLearnReport rep);
                        BbLearner.SkipNameContains = null;
                        std.Save(Path.Combine(outDir, "standard-learned.json"));
                        sb.AppendLine("learned fields " + rep.FieldsLearned + " views " + rep.ViewsScanned + " classified " + rep.Classified + " in " + rep.ElapsedMs + " ms");
                        foreach (var kv in rep.PerKind) sb.AppendLine("  " + kv.Key + " " + kv.Value);
                        foreach (string n in rep.Notes.Take(20)) sb.AppendLine("  note " + n);
                        foreach (string key in rep.Samples.Keys)
                        {
                            double? med = rep.Samples.Median(key);
                            string mode = rep.Samples.Mode(key);
                            sb.AppendLine("  " + key + " n=" + rep.Samples.Count(key) + (med != null ? " med=" + med.Value.ToString("0.0") + " p25=" + rep.Samples.Pct(key, 0.25)?.ToString("0.0") + " p75=" + rep.Samples.Pct(key, 0.75)?.ToString("0.0") : "") + (mode != null ? " mode=" + mode + " (" + string.Join(", ", rep.Samples.Histogram(key).Take(3).Select(h => h.Key + "×" + h.Value)) + ")" : ""));
                        }
                        break;
                    }
                default:
                    return GateOps.Run(app, doc, op, rest, outDir);
            }
            File.WriteAllText(Path.Combine(outDir, op + ".txt"), sb.ToString(), new UTF8Encoding(false));
            return sb.ToString();
        }
    }
}
