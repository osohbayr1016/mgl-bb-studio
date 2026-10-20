using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text;

namespace RevitMcpAddin.Ventilation.Core
{
    /// <summary>
    /// Intentionally simple, strict duct graph interchange:
    /// id,parent_id,terminal_ls,length_m,roughness_mm,loss_k
    /// IDs must not contain delimiters/quotes/newlines. The airflow is terminal
    /// demand on that branch, not its accumulated duct flow (computed by solver).
    /// </summary>
    public static class DuctNetworkCsv
    {
        private const string Header = "id,parent_id,terminal_ls,length_m,roughness_mm,loss_k";

        public static List<DuctBranchInput> Parse(string csv)
        {
            if (csv == null) throw new ArgumentNullException(nameof(csv));
            if (csv.Length > 1024 * 1024) throw new FormatException("Duct CSV exceeds 1 MiB.");
            var lines = csv.TrimStart('\uFEFF').Split(new[] { "\r\n", "\n" }, StringSplitOptions.None);
            if (lines.Length < 2 || lines[0].Trim() != Header)
                throw new FormatException("Expected header: " + Header);
            var branches = new List<DuctBranchInput>();
            for (int i = 1; i < lines.Length; i++)
            {
                if (string.IsNullOrWhiteSpace(lines[i])) continue;
                if (branches.Count >= 2000)
                    throw new FormatException("Maximum 2000 branches.");
                var fields = lines[i].Split(',');
                if (fields.Length != 6 || fields.Any(f => f.Contains("\"")))
                    throw new FormatException("Line " + (i + 1) + ": expected six plain unquoted columns.");
                for (int j = 0; j < 6; j++) fields[j] = fields[j].Trim();
                if (fields[0].Length == 0 || fields[0].Length > 64 ||
                    fields[1].Length > 64 || !ValidId(fields[0]) ||
                    (fields[1].Length != 0 && !ValidId(fields[1])))
                    throw new FormatException("Line " + (i + 1) + ": invalid branch id/parent id.");
                branches.Add(new DuctBranchInput {
                    Id = fields[0], ParentId = fields[1],
                    TerminalFlowLs = Number(fields[2], "terminal_ls", i + 1),
                    LengthM = Number(fields[3], "length_m", i + 1),
                    RoughnessMm = Number(fields[4], "roughness_mm", i + 1),
                    LocalLossK = Number(fields[5], "loss_k", i + 1)
                });
            }
            if (branches.Count == 0) throw new FormatException("No branches.");
            return branches;
        }

        public static string Report(DuctNetworkResult result)
        {
            if (result == null || !result.Valid) throw new InvalidOperationException("Valid result required.");
            var s = new StringBuilder();
            s.AppendLine("BranchId,ParentId,Flow_Ls,Diameter_mm,Velocity_m_s,Re,Darcy_f,BranchLoss_Pa,PathLoss_Pa");
            foreach (var x in result.Branches)
                s.AppendLine(string.Join(",", new[] {
                    x.Id, x.ParentId,
                    N(x.FlowLs), x.DiameterMm.ToString(CultureInfo.InvariantCulture),
                    N(x.VelocityMs), N(x.ReynoldsNumber),
                    N(x.DarcyFrictionFactor), N(x.PressureDropPa), N(x.PathPressurePa)
                }));
            s.AppendLine("Total_Ls," + N(result.HeaderFlowLs.Value));
            s.AppendLine("CriticalPath_Pa," + N(result.CriticalPathPressurePa.Value));
            s.AppendLine("PreliminaryFanPressure_Pa," + N(result.PreliminaryFanPressurePa.Value));
            s.AppendLine("EstimatedElectricPower_W," +
                         (result.EstimatedElectricPowerW.HasValue ? N(result.EstimatedElectricPowerW.Value) : ""));
            s.AppendLine("CriticalPathIds," + string.Join(" > ", result.CriticalPathIds));
            s.AppendLine("NOTICE,PRELIMINARY: no Revit connector verification, acoustic/fan-curve/code approval.");
            return s.ToString();
        }

        private static bool ValidId(string value)
        {
            foreach (char c in value)
                if (!((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') ||
                      (c >= '0' && c <= '9') || c == '_' || c == '-' || c == '.'))
                    return false;
            return true;
        }

        private static double Number(string field, string name, int line)
        {
            if (!double.TryParse(field, NumberStyles.Float, CultureInfo.InvariantCulture, out double n) ||
                double.IsNaN(n) || double.IsInfinity(n) || n < 0)
                throw new FormatException("Line " + line + ": invalid nonnegative " + name + ".");
            return n;
        }

        private static string N(double x)
        {
            return x.ToString("0.######", CultureInfo.InvariantCulture);
        }
    }
}
