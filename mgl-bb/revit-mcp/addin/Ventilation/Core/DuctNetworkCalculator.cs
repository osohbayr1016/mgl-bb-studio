using System;
using System.Collections.Generic;
using System.Linq;

namespace RevitMcpAddin.Ventilation.Core
{
    /// <summary>
    /// Directed radial schematic, not a Revit connector network.
    /// ParentId empty means a branch leaving the fan header; terminal
    /// demands can also exist at intermediate take-off branches.
    /// All numerical inputs must be explicitly supplied by an engineer.
    /// </summary>
    public sealed class DuctBranchInput
    {
        public string Id { get; set; }
        public string ParentId { get; set; }
        public double? TerminalFlowLs { get; set; }
        public double? LengthM { get; set; }
        public double? RoughnessMm { get; set; }
        public double? LocalLossK { get; set; }
    }

    public sealed class DuctNetworkInput
    {
        public double? DensityKgM3 { get; set; }
        public double? DynamicViscosityPaS { get; set; }
        public double? MaxDesignVelocityMs { get; set; }
        public double? ExplicitFanReservePa { get; set; }
        public double? FanTotalEfficiency { get; set; }
        public List<DuctBranchInput> Branches { get; set; } = new List<DuctBranchInput>();
    }

    public sealed class DuctBranchResult
    {
        public string Id { get; internal set; }
        public string ParentId { get; internal set; }
        public double FlowLs { get; internal set; }
        public int DiameterMm { get; internal set; }
        public double VelocityMs { get; internal set; }
        public double ReynoldsNumber { get; internal set; }
        public double DarcyFrictionFactor { get; internal set; }
        public double PressureDropPa { get; internal set; }
        public double PathPressurePa { get; internal set; }
    }

    public sealed class DuctNetworkResult
    {
        public bool Valid { get; internal set; }
        public double? HeaderFlowLs { get; internal set; }
        public double? CriticalPathPressurePa { get; internal set; }
        public double? PreliminaryFanPressurePa { get; internal set; }
        public double? EstimatedElectricPowerW { get; internal set; }
        public List<string> CriticalPathIds { get; } = new List<string>();
        public List<DuctBranchResult> Branches { get; } = new List<DuctBranchResult>();
        public List<string> Errors { get; } = new List<string>();
        public List<string> Warnings { get; } = new List<string>();
    }

    /// <summary>
    /// Deterministic radial duct sizing/pressure worksheet.
    /// Darcy-Weisbach + explicit fitting K + laminar (64/Re) or
    /// Swamee-Jain approximation. No manufacturer, code, fan curve,
    /// acoustic, fire, leakage or automatic balancing verification.
    /// </summary>
    public static class DuctNetworkCalculator
    {
        private static readonly int[] RoundDiametersMm = {
            80, 100, 125, 160, 200, 250, 315, 355, 400, 450, 500,
            560, 630, 710, 800, 900, 1000, 1120, 1250, 1400, 1600, 1800, 2000
        };

        public static DuctNetworkResult Calculate(DuctNetworkInput input)
        {
            if (input == null) throw new ArgumentNullException(nameof(input));
            var r = new DuctNetworkResult();
            RequirePositive(r, "air density kg/m3", input.DensityKgM3);
            RequirePositive(r, "dynamic viscosity Pa.s", input.DynamicViscosityPaS);
            RequirePositive(r, "max design velocity m/s", input.MaxDesignVelocityMs);
            RequireNonnegative(r, "fan reserve Pa", input.ExplicitFanReservePa);
            if (input.FanTotalEfficiency.HasValue &&
                (!Finite(input.FanTotalEfficiency.Value) ||
                 input.FanTotalEfficiency.Value <= 0 || input.FanTotalEfficiency.Value > 1))
                r.Errors.Add("Fan total efficiency must be (0,1].");
            if (input.Branches == null || input.Branches.Count == 0)
                r.Errors.Add("At least one duct branch is required.");
            if (input.Branches != null && input.Branches.Count > 2000)
                r.Errors.Add("Too many branches (limit 2000).");
            if (r.Errors.Count > 0) return r;

            var byId = new Dictionary<string, DuctBranchInput>(StringComparer.Ordinal);
            foreach (var b in input.Branches)
            {
                if (b == null) { r.Errors.Add("Null duct branch."); continue; }
                if (string.IsNullOrWhiteSpace(b.Id) || b.Id.Trim() != b.Id)
                {
                    r.Errors.Add("Branch ID must be nonempty and trimmed.");
                    continue;
                }
                if (byId.ContainsKey(b.Id)) { r.Errors.Add("Duplicate branch ID: " + b.Id); continue; }
                byId.Add(b.Id, b);
                RequireNonnegative(r, b.Id + ": terminal L/s", b.TerminalFlowLs);
                RequireNonnegative(r, b.Id + ": length m", b.LengthM);
                RequireNonnegative(r, b.Id + ": roughness mm", b.RoughnessMm);
                RequireNonnegative(r, b.Id + ": fittings K", b.LocalLossK);
            }
            if (r.Errors.Count > 0) return r;

            var children = new Dictionary<string, List<string>>(StringComparer.Ordinal);
            var roots = new List<string>();
            foreach (var id in byId.Keys) children[id] = new List<string>();
            foreach (var b in byId.Values)
            {
                if (string.IsNullOrEmpty(b.ParentId)) roots.Add(b.Id);
                else if (b.ParentId == b.Id) r.Errors.Add(b.Id + ": branch cannot parent itself.");
                else if (!byId.ContainsKey(b.ParentId))
                    r.Errors.Add(b.Id + ": missing parent " + b.ParentId);
                else children[b.ParentId].Add(b.Id);
            }
            if (roots.Count == 0) r.Errors.Add("No branch connected to the fan header (root).");
            if (r.Errors.Count > 0) return r;

            var visiting = new HashSet<string>(StringComparer.Ordinal);
            var completed = new Dictionary<string, double>(StringComparer.Ordinal);
            Func<string, double> downstreamFlow = null;
            downstreamFlow = id =>
            {
                if (completed.TryGetValue(id, out double cached)) return cached;
                if (!visiting.Add(id))
                {
                    r.Errors.Add("Cycle in duct hierarchy at " + id);
                    return 0;
                }
                double total = byId[id].TerminalFlowLs.Value;
                foreach (var child in children[id]) total += downstreamFlow(child);
                visiting.Remove(id);
                if (!Finite(total)) r.Errors.Add(id + ": overflow in accumulated flow.");
                completed[id] = total;
                return total;
            };
            foreach (var id in byId.Keys) downstreamFlow(id);
            if (r.Errors.Count > 0) return r;

            double sum = roots.Sum(id => completed[id]);
            if (!Finite(sum) || sum <= 0)
            {
                r.Errors.Add("Network must have positive terminal demand.");
                return r;
            }
            r.HeaderFlowLs = sum;
            var computed = new Dictionary<string, DuctBranchResult>(StringComparer.Ordinal);
            foreach (var b in input.Branches)
            {
                double flowLs = completed[b.Id];
                if (flowLs <= 0)
                {
                    r.Errors.Add(b.Id + ": zero-flow duct requires a separate design decision.");
                    continue;
                }
                int diameter = 0;
                double velocity = 0;
                foreach (int candidate in RoundDiametersMm)
                {
                    double d = candidate / 1000.0;
                    double v = (flowLs / 1000.0) / (Math.PI * d * d / 4.0);
                    if (v <= input.MaxDesignVelocityMs.Value)
                    {
                        diameter = candidate;
                        velocity = v;
                        break;
                    }
                }
                if (diameter == 0)
                {
                    r.Errors.Add(b.Id + ": required duct exceeds explicit diameter catalogue.");
                    continue;
                }
                double dm = diameter / 1000.0;
                double reynolds = input.DensityKgM3.Value * velocity * dm /
                                  input.DynamicViscosityPaS.Value;
                double friction;
                if (reynolds < 2300.0) friction = 64.0 / reynolds;
                else
                {
                    double x = ((b.RoughnessMm.Value / 1000.0) / (3.7 * dm)) +
                               5.74 / Math.Pow(reynolds, 0.9);
                    friction = 0.25 / Math.Pow(Math.Log10(x), 2);
                    if (reynolds < 4000)
                        r.Warnings.Add(b.Id + ": transition Reynolds regime; confirm friction factor.");
                }
                double dp = (friction * b.LengthM.Value / dm + b.LocalLossK.Value) *
                            (input.DensityKgM3.Value * velocity * velocity / 2.0);
                if (!Finite(dp) || dp < 0)
                {
                    r.Errors.Add(b.Id + ": invalid pressure result.");
                    continue;
                }
                computed[b.Id] = new DuctBranchResult {
                    Id = b.Id, ParentId = b.ParentId ?? "",
                    FlowLs = flowLs, DiameterMm = diameter, VelocityMs = velocity,
                    ReynoldsNumber = reynolds, DarcyFrictionFactor = friction,
                    PressureDropPa = dp
                };
            }
            if (r.Errors.Count > 0) return r;

            // Since the hierarchy is a radial forest, every terminal has exactly
            // one path to the shared header. The fan sees the most resistive path.
            double critical = -1;
            string criticalLeaf = null;
            Action<string, double> walk = null;
            walk = (id, upstream) =>
            {
                var branch = computed[id];
                branch.PathPressurePa = upstream + branch.PressureDropPa;
                if (byId[id].TerminalFlowLs.Value > 0 && branch.PathPressurePa > critical)
                {
                    critical = branch.PathPressurePa;
                    criticalLeaf = id;
                }
                foreach (var child in children[id])
                    walk(child, branch.PathPressurePa);
            };
            foreach (var root in roots) walk(root, 0);
            if (!Finite(critical) || critical < 0 || criticalLeaf == null)
            {
                r.Errors.Add("Could not locate the critical terminal path.");
                return r;
            }
            for (string current = criticalLeaf; !string.IsNullOrEmpty(current);
                 current = byId[current].ParentId)
                r.CriticalPathIds.Insert(0, current);
            r.CriticalPathPressurePa = critical;
            double pressure = critical + input.ExplicitFanReservePa.Value;
            if (!Finite(pressure))
            {
                r.Errors.Add("Fan pressure overflow.");
                return r;
            }
            r.PreliminaryFanPressurePa = pressure;
            if (input.FanTotalEfficiency.HasValue)
            {
                double power = (sum / 1000.0) * pressure / input.FanTotalEfficiency.Value;
                if (!Finite(power)) { r.Errors.Add("Fan power overflow."); return r; }
                r.EstimatedElectricPowerW = power;
            }
            foreach (var b in input.Branches) r.Branches.Add(computed[b.Id]);
            r.Warnings.Add("Schematic round-duct velocity sizing only: verify fitting K, roughness, " +
                "leakage, noise, manufacturer sizes, fan curves, branch balancing and code limits.");
            r.Valid = true;
            return r;
        }

        private static void RequirePositive(DuctNetworkResult r, string name, double? v)
        {
            if (!v.HasValue || !Finite(v.Value) || v.Value <= 0)
                r.Errors.Add(name + " must be explicitly positive and finite.");
        }
        private static void RequireNonnegative(DuctNetworkResult r, string name, double? v)
        {
            if (!v.HasValue || !Finite(v.Value) || v.Value < 0)
                r.Errors.Add(name + " must be explicitly nonnegative and finite.");
        }
        private static bool Finite(double v)
        {
            return !double.IsNaN(v) && !double.IsInfinity(v);
        }
    }
}
