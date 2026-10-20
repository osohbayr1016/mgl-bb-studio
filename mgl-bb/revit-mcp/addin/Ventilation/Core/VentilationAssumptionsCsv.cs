using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text;

namespace RevitMcpAddin.Ventilation.Core
{
    public sealed class VentilationAssumption
    {
        public string UniqueId { get; set; }
        public string Source { get; set; }
        public double? Occupants { get; set; }
        public double? Ach { get; set; }
        public double? Rp { get; set; }
        public double? Ra { get; set; }
        public double? Ez { get; set; }
        public double? ExhaustLs { get; set; }
        public double? VelocityMs { get; set; }
    }

    /// <summary>
    /// Re-importable, identity-keyed assumptions ONLY. Room area/volume always
    /// come from current Revit model and are never restored from old CSV.
    /// No rule approval, signature or norm provenance is restored on import.
    /// </summary>
    public static class VentilationAssumptionsCsv
    {
        private const string Header =
            "UniqueId,Source,Occupants,ACH,Rp,Ra,Ez,ExhaustLs,VelocityMs";

        public static string Export(IEnumerable<VentilationAssumption> items)
        {
            if (items == null) throw new ArgumentNullException(nameof(items));
            var s = new StringBuilder();
            s.AppendLine(Header);
            foreach (var v in items)
            {
                if (v == null) throw new ArgumentException("Null assumption.");
                s.AppendLine(string.Join(",", new[] {
                    Q(v.UniqueId), Q(v.Source), N(v.Occupants), N(v.Ach), N(v.Rp),
                    N(v.Ra), N(v.Ez), N(v.ExhaustLs), N(v.VelocityMs)
                }));
            }
            return s.ToString();
        }

        public static List<VentilationAssumption> Parse(string csv)
        {
            if (csv == null) throw new ArgumentNullException(nameof(csv));
            if (csv.Length > 1024 * 1024) throw new FormatException("Assumptions CSV over 1 MiB.");
            var lines = csv.TrimStart('\uFEFF').Split(new[] { "\r\n", "\n" }, StringSplitOptions.None);
            if (lines.Length < 2 || lines[0].Trim() != Header)
                throw new FormatException("Expected header: " + Header);
            var items = new List<VentilationAssumption>();
            var keys = new HashSet<string>(StringComparer.Ordinal);
            for (int i = 1; i < lines.Length; i++)
            {
                if (string.IsNullOrWhiteSpace(lines[i])) continue;
                if (items.Count >= 10000) throw new FormatException("Maximum 10000 room assumptions.");
                var c = SplitLine(lines[i]);
                if (c.Count != 9) throw new FormatException("Line " + (i + 1) + ": expected 9 columns.");
                if (string.IsNullOrWhiteSpace(c[0]) || string.IsNullOrWhiteSpace(c[1]))
                    throw new FormatException("Line " + (i + 1) + ": missing unique ID/source.");
                string key = Key(c[0], c[1]);
                if (!keys.Add(key)) throw new FormatException("Line " + (i + 1) + ": duplicate model key.");
                items.Add(new VentilationAssumption {
                    UniqueId = c[0], Source = c[1],
                    Occupants = N(c[2], "Occupants", i), Ach = N(c[3], "ACH", i),
                    Rp = N(c[4], "Rp", i), Ra = N(c[5], "Ra", i),
                    Ez = N(c[6], "Ez", i), ExhaustLs = N(c[7], "ExhaustLs", i),
                    VelocityMs = N(c[8], "VelocityMs", i)
                });
                var last = items[items.Count - 1];
                if ((last.Ez.HasValue && last.Ez.Value <= 0) ||
                    (last.VelocityMs.HasValue && last.VelocityMs.Value <= 0))
                    throw new FormatException("Line " + (i + 1) + ": Ez and velocity must be positive if supplied.");
            }
            if (items.Count == 0) throw new FormatException("No model assumptions to import.");
            return items;
        }

        public static string Key(string id, string source) { return id + "\u001F" + source; }

        private static double? N(string text, string label, int index)
        {
            if (string.IsNullOrWhiteSpace(text)) return null;
            if (!double.TryParse(text.Trim(), NumberStyles.Float, CultureInfo.InvariantCulture, out double n) ||
                double.IsNaN(n) || double.IsInfinity(n) || n < 0)
                throw new FormatException("Line " + (index + 1) + ": invalid " + label);
            return n;
        }
        private static string N(double? n) {
            return n.HasValue ? n.Value.ToString("R", CultureInfo.InvariantCulture) : "";
        }

        private static string Q(string text)
        {
            string v = text ?? "";
            string trim = v.TrimStart();
            if (trim.Length > 0 && "=+-@".IndexOf(trim[0]) >= 0) v = "'" + v;
            return "\"" + v.Replace("\"", "\"\"") + "\"";
        }

        // RFC4180 quotes/escaped quotes on a single physical line.
        private static List<string> SplitLine(string line)
        {
            var fields = new List<string>();
            var s = new StringBuilder();
            bool inQuote = false, done = false;
            for (int i = 0; i < line.Length; i++)
            {
                char ch = line[i];
                if (ch == '"')
                {
                    if (inQuote && i + 1 < line.Length && line[i + 1] == '"')
                    {
                        s.Append('"'); i++;
                    }
                    else if (inQuote) { inQuote = false; done = true; }
                    else if (s.Length == 0 && !done) inQuote = true;
                    else throw new FormatException("Malformed assumption CSV quotes.");
                }
                else if (ch == ',' && !inQuote)
                {
                    fields.Add(s.ToString()); s.Clear(); done = false;
                }
                else
                {
                    if (done) throw new FormatException("Unexpected text after closing CSV quote.");
                    s.Append(ch);
                }
            }
            if (inQuote) throw new FormatException("Unclosed CSV quote.");
            fields.Add(s.ToString());
            return fields;
        }
    }
}
