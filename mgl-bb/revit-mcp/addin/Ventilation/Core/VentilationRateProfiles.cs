using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text;

namespace RevitMcpAddin.Ventilation.Core
{
    /// <summary>
    /// Engineer-reviewed rate profile. NOT a bundled code table or declaration
    /// of legal compliance: actual adoption, applicability and amendments must
    /// be checked outside this parser before a pack is distributed.
    /// </summary>
    public sealed class VentilationRateProfile
    {
        public string Id { get; internal set; }
        public string Code { get; internal set; }
        public string Edition { get; internal set; }
        public string Clause { get; internal set; }
        public string RoomType { get; internal set; }
        public string ReviewedBy { get; internal set; }
        public DateTime ReviewDate { get; internal set; }
        public double? Ach { get; internal set; }
        public double? Rp { get; internal set; }
        public double? Ra { get; internal set; }
        public double? Ez { get; internal set; }
        public double? ExhaustLs { get; internal set; }

        public string Reference
        {
            get { return Code + " [" + Edition + "] §" + Clause + " — " + RoomType +
                " (хянасан: " + ReviewedBy + ", " +
                ReviewDate.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) + ")"; }
        }
    }

    /// <summary>
    /// Strict, auditable CSV rate import. Never downloads norms or assumes
    /// inferred occupancy mappings. No unreviewed rows are partially imported.
    /// Multiline CSV cells are intentionally not supported.
    /// </summary>
    public static class VentilationRateProfiles
    {
        private static readonly string[] Header = {
            "id", "code", "edition", "clause", "room_type", "reviewed_by",
            "review_date", "ach", "rp", "ra", "ez", "exhaust_ls"
        };

        public static List<VentilationRateProfile> ParseCsv(string csv)
        {
            if (csv == null) throw new ArgumentNullException(nameof(csv));
            if (csv.Length > 1024 * 1024) throw new FormatException("Profile CSV is larger than 1 MiB.");
            var lines = csv.TrimStart('\uFEFF').Split(new[] { "\r\n", "\n" }, StringSplitOptions.None);
            if (lines.Length < 2) throw new FormatException("CSV must contain a header and profiles.");
            var header = SplitLine(lines[0]).Select(s => s.Trim()).ToArray();
            if (!header.SequenceEqual(Header, StringComparer.OrdinalIgnoreCase))
                throw new FormatException("CSV columns must be: " + string.Join(",", Header));

            var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            var result = new List<VentilationRateProfile>();
            for (int i = 1; i < lines.Length; i++)
            {
                if (string.IsNullOrWhiteSpace(lines[i])) continue;
                if (result.Count >= 500) throw new FormatException("Maximum 500 profiles per file.");
                var c = SplitLine(lines[i]);
                if (c.Count != Header.Length)
                    throw new FormatException("CSV line " + (i + 1) + ": expected 12 columns.");
                for (int j = 0; j < c.Count; j++) c[j] = c[j].Trim();
                for (int j = 0; j < 7; j++)
                    if (string.IsNullOrWhiteSpace(c[j]))
                        throw new FormatException("CSV line " + (i + 1) + ": mandatory " + Header[j] + " is empty.");
                if (!seen.Add(c[0]))
                    throw new FormatException("CSV line " + (i + 1) + ": duplicate profile id " + c[0]);
                if (!DateTime.TryParseExact(c[6], "yyyy-MM-dd", CultureInfo.InvariantCulture,
                        DateTimeStyles.None, out DateTime reviewed))
                    throw new FormatException("CSV line " + (i + 1) + ": expected review_date yyyy-MM-dd.");
                var p = new VentilationRateProfile {
                    Id = c[0], Code = c[1], Edition = c[2], Clause = c[3],
                    RoomType = c[4], ReviewedBy = c[5], ReviewDate = reviewed,
                    Ach = Number(c[7], "ach", i + 1),
                    Rp = Number(c[8], "rp", i + 1),
                    Ra = Number(c[9], "ra", i + 1),
                    Ez = Number(c[10], "ez", i + 1),
                    ExhaustLs = Number(c[11], "exhaust_ls", i + 1)
                };
                bool hasAch = p.Ach.GetValueOrDefault() > 0;
                bool hasOutdoor = p.Rp.GetValueOrDefault() > 0 || p.Ra.GetValueOrDefault() > 0;
                if (!hasAch && !hasOutdoor)
                    throw new FormatException("CSV line " + (i + 1) + ": ACH or outdoor-air rates are required.");
                if (hasOutdoor && (!p.Ez.HasValue || p.Ez.Value <= 0))
                    throw new FormatException("CSV line " + (i + 1) + ": outdoor-air profile requires positive Ez.");
                if (p.Ez.HasValue && p.Ez.Value <= 0)
                    throw new FormatException("CSV line " + (i + 1) + ": Ez must be positive.");
                result.Add(p);
            }
            if (result.Count == 0) throw new FormatException("No profiles in CSV.");
            return result;
        }

        private static double? Number(string field, string name, int line)
        {
            if (field.Length == 0) return null;
            if (!double.TryParse(field, NumberStyles.Float, CultureInfo.InvariantCulture, out double value) ||
                double.IsNaN(value) || double.IsInfinity(value) || value < 0)
                throw new FormatException("CSV line " + line + ": invalid nonnegative " + name + ".");
            return value;
        }

        private static List<string> SplitLine(string line)
        {
            var fields = new List<string>();
            var current = new StringBuilder();
            bool quoted = false;
            bool closed = false;
            for (int i = 0; i < line.Length; i++)
            {
                char ch = line[i];
                if (ch == '"')
                {
                    if (quoted && i + 1 < line.Length && line[i + 1] == '"')
                    {
                        current.Append('"'); i++;
                    }
                    else if (quoted) { quoted = false; closed = true; }
                    else if (current.Length == 0 && !closed) quoted = true;
                    else throw new FormatException("Malformed CSV quoting.");
                }
                else if (ch == ',' && !quoted)
                {
                    fields.Add(current.ToString()); current.Clear(); closed = false;
                }
                else
                {
                    if (closed) throw new FormatException("Characters after quoted CSV field.");
                    current.Append(ch);
                }
            }
            if (quoted) throw new FormatException("Unclosed quoted CSV field.");
            fields.Add(current.ToString());
            return fields;
        }
    }
}
