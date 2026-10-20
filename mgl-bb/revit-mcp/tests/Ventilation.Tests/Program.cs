using System;
using RevitMcpAddin.Ventilation.Core;

internal static class Program
{
    private static int _count;
    private static void Eq(double expected, double? actual, string name)
    {
        if (!actual.HasValue || Math.Abs(actual.Value - expected) > 1e-6)
            throw new Exception(name + ": expected " + expected + ", got " + actual);
        _count++;
    }

    private static void Must(bool condition, string name)
    {
        if (!condition) throw new Exception("FAILED " + name);
        _count++;
    }

    private static void Main()
    {
        var ach = VentilationCalculator.Calculate(new VentilationInput { AreaM2 = 20, VolumeM3 = 60, Ach = 3 });
        Must(ach.Valid, "ACH only valid");
        Eq(50, ach.SchematicSupplyLs, "ACH: 60m3 * 3 / h => 50 L/s");
        Must(!ach.OutdoorAirLs.HasValue, "ACH must not imply outdoor air");

        var rp = VentilationCalculator.Calculate(new VentilationInput {
            AreaM2 = 100, VolumeM3 = 300, Occupants = 10,
            OutdoorPerPersonLs = 5, OutdoorPerAreaLs = 0.3,
            DistributionEffectiveness = 0.8
        });
        Must(rp.Valid, "outdoor valid");
        Eq(100, rp.OutdoorAirLs, "(10*5 + 100*.3)/.8 = 100 L/s");
        Eq(100, rp.SchematicSupplyLs, "VRP supply");

        var both = VentilationCalculator.Calculate(new VentilationInput {
            AreaM2 = 20, VolumeM3 = 60, Ach = 3,
            Occupants = 2, OutdoorPerPersonLs = 5, OutdoorPerAreaLs = 0.5, DistributionEffectiveness = 1,
            ExhaustLs = 20, DuctVelocityMs = 4, ExistingSupplyLs = 30
        });
        Must(both.Valid, "both methods");
        Eq(20, both.OutdoorAirLs, "Vbz outdoor");
        Eq(50, both.SchematicSupplyLs, "max(ACH, outdoor)");
        Eq(30, both.SupplyMinusExhaustLs, "exhaust return arithmetic");
        Must(both.SuggestedRoundDuctDiameterMm == 125 || both.SuggestedRoundDuctDiameterMm == 160,
            "round duct diameter plausible");
        Must(both.Warnings.Count == 1, "existing less than proposed warning");

        var missing = VentilationCalculator.Calculate(new VentilationInput { AreaM2 = 20, VolumeM3 = 60 });
        Must(!missing.Valid && !missing.SchematicSupplyLs.HasValue, "no fabricated default");

        var rpMissingPeople = VentilationCalculator.Calculate(new VentilationInput {
            AreaM2 = 10, VolumeM3 = 30, OutdoorPerPersonLs = 5
        });
        Must(!rpMissingPeople.Valid, "no inferred people");

        Must(!VentilationCalculator.Calculate(new VentilationInput {
            AreaM2 = 30, VolumeM3 = 90, Occupants = 3, OutdoorPerPersonLs = 5
        }).Valid, "no silently defaulted Ez");
        var missingVolume = VentilationCalculator.Calculate(new VentilationInput {
            AreaM2 = 20, VolumeM3 = 0, Ach = 2
        });
        Must(!missingVolume.Valid, "do not invent volume");
        var invalidEz = VentilationCalculator.Calculate(new VentilationInput {
            AreaM2 = 20, VolumeM3 = 60, Ach = 2, DistributionEffectiveness = 0
        });
        Must(!invalidEz.Valid, "invalid Ez");
        Must(!VentilationCalculator.Calculate(new VentilationInput {
            AreaM2 = 20, VolumeM3 = 60, Ach = double.NaN
        }).Valid, "NaN");
        Must(!VentilationCalculator.Calculate(new VentilationInput {
            AreaM2 = -20, VolumeM3 = 60, Ach = 1
        }).Valid, "negative area");
        Must(!VentilationCalculator.Calculate(new VentilationInput {
            AreaM2 = 20, VolumeM3 = 60, Ach = 1, DuctVelocityMs = 0
        }).Valid, "zero duct velocity");
        var negativeBalance = VentilationCalculator.Calculate(new VentilationInput {
            AreaM2 = 20, VolumeM3 = 60, Ach = 1, ExhaustLs = 90
        });
        Must(negativeBalance.Valid && negativeBalance.Warnings.Count > 0, "makeup air warning");
        var matchedActual = VentilationCalculator.Calculate(new VentilationInput {
            AreaM2 = 20, VolumeM3 = 60, Ach = 3, ActualSupplyLs = 50
        });
        Must(matchedActual.Valid, "actual supply diagnostics valid");
        Eq(0, matchedActual.ActualMinusRequiredLs, "matching terminal supply");
        Must(matchedActual.Warnings.Count == 0, "no warning when actual matches");
        var insufficientActual = VentilationCalculator.Calculate(new VentilationInput {
            AreaM2 = 20, VolumeM3 = 60, Ach = 3, ActualSupplyLs = 20
        });
        Eq(-30, insufficientActual.ActualMinusRequiredLs, "terminal supply below required");
        Must(insufficientActual.Warnings.Count > 0, "actual below required flagged");
        Must(!VentilationCalculator.Calculate(new VentilationInput {
            AreaM2 = 20, VolumeM3 = 60, Ach = 3, ActualSupplyLs = double.PositiveInfinity
        }).Valid, "nonfinite actual flow blocked");
        // Rulepacks are strictly imported engineer inputs, never inferred legal norms.
        string header = "id,code,edition,clause,room_type,reviewed_by,review_date,ach,rp,ra,ez,exhaust_ls\\n";
        string profile = "office,TEST-NOT-CODE,draft,TEST-1,Office,QA engineer,2026-10-15,3,5,0.3,1,15\\n";
        var profiles = VentilationRateProfiles.ParseCsv(header.Replace("\\n", "\n") + profile.Replace("\\n", "\n"));
        Must(profiles.Count == 1 && profiles[0].Id == "office", "approved profile import");
        Eq(3, profiles[0].Ach, "profile ACH");
        Eq(1, profiles[0].Ez, "explicit distribution effectiveness");
        Must(profiles[0].Reference.Contains("TEST-NOT-CODE"), "source is traceable");
        bool rejected = false;
        try { VentilationRateProfiles.ParseCsv(header.Replace("\\n", "\n") + profile.Replace("\\n", "\n").Replace("QA engineer", "")); }
        catch (FormatException) { rejected = true; }
        Must(rejected, "reviewer mandatory");
        rejected = false;
        try { VentilationRateProfiles.ParseCsv(header.Replace("\\n", "\n") + profile.Replace("\\n", "\n").Replace(",1,15", ",,15")); }
        catch (FormatException) { rejected = true; }
        Must(rejected, "Ez is mandatory for outdoor air");
        rejected = false;
        try { VentilationRateProfiles.ParseCsv(header.Replace("\\n", "\n") + profile.Replace("\\n", "\n") + profile.Replace("\\n", "\n")); }
        catch (FormatException) { rejected = true; }
        Must(rejected, "duplicate profile ids blocked");
        rejected = false;
        try { VentilationRateProfiles.ParseCsv(header.Replace("\\n", "\n") + profile.Replace("\\n", "\n").Replace(",3,5", ",NaN,5")); }
        catch (FormatException) { rejected = true; }
        Must(rejected, "nonfinite profile rate blocked");
        // Radial network flow sums, diameter sizing and pressure drop.
        var network = new DuctNetworkInput {
            DensityKgM3 = 1.2, DynamicViscosityPaS = 0.000018,
            MaxDesignVelocityMs = 6, ExplicitFanReservePa = 50,
            FanTotalEfficiency = 0.6,
            Branches = new System.Collections.Generic.List<DuctBranchInput> {
                new DuctBranchInput { Id = "trunk", ParentId = "", TerminalFlowLs = 0, LengthM = 10, RoughnessMm = 0.1, LocalLossK = 1 },
                new DuctBranchInput { Id = "room1", ParentId = "trunk", TerminalFlowLs = 40, LengthM = 5, RoughnessMm = 0.1, LocalLossK = 1 },
                new DuctBranchInput { Id = "room2", ParentId = "trunk", TerminalFlowLs = 60, LengthM = 7, RoughnessMm = 0.1, LocalLossK = 2 }
            }
        };
        var n = DuctNetworkCalculator.Calculate(network);
        Must(n.Valid, "radial network valid");
        Eq(100, n.HeaderFlowLs, "all terminal demands reach fan");
        Eq(100, n.Branches[0].FlowLs, "trunk carries both zones");
        Eq(40, n.Branches[1].FlowLs, "child1 airflow");
        Eq(60, n.Branches[2].FlowLs, "child2 airflow");
        Must(n.Branches[0].DiameterMm >= n.Branches[1].DiameterMm, "trunk not smaller than branch");
        Must(n.CriticalPathIds.Count == 2 && n.CriticalPathIds[0] == "trunk",
             "critical pressure path traces from fan");
        Must(n.CriticalPathPressurePa.Value > 0, "friction and fittings consume pressure");
        Must(n.PreliminaryFanPressurePa.Value > n.CriticalPathPressurePa.Value, "explicit reserve included");
        Must(n.EstimatedElectricPowerW.Value > 0, "fan estimated electrical duty requires efficiency");
        network.Branches[0].ParentId = "room1";
        Must(!DuctNetworkCalculator.Calculate(network).Valid, "radial graph cycle rejected");
        network.Branches[0].ParentId = "";
        network.Branches[0].LocalLossK = null;
        Must(!DuctNetworkCalculator.Calculate(network).Valid, "unknown fitting losses fail closed");
        network.Branches[0].LocalLossK = 1;
        network.Branches[2].ParentId = "missing";
        Must(!DuctNetworkCalculator.Calculate(network).Valid, "orphan parent rejected");
        network.Branches[2].ParentId = "trunk";
        network.DynamicViscosityPaS = null;
        Must(!DuctNetworkCalculator.Calculate(network).Valid, "fluid properties must be explicitly provided");
        // Round-trip simple declared duct branches and report.
        string ductCsv = "id,parent_id,terminal_ls,length_m,roughness_mm,loss_k\\n" +
                         "trunk,,0,10,0.1,1\\n" +
                         "room1,trunk,40,5,0.1,1\\n" +
                         "room2,trunk,60,7,0.1,2\\n";
        var parsedDucts = DuctNetworkCsv.Parse(ductCsv.Replace("\\n", "\n"));
        Must(parsedDucts.Count == 3 && parsedDucts[0].Id == "trunk", "network CSV parse");
        network.DynamicViscosityPaS = 0.000018;
        network.Branches = parsedDucts;
        var parsedResult = DuctNetworkCalculator.Calculate(network);
        Must(parsedResult.Valid, "imported duct branch network calculates");
        Must(DuctNetworkCsv.Report(parsedResult).Contains("CriticalPath_Pa"),
             "network CSV engineering report includes critical path");
        rejected = false;
        try { DuctNetworkCsv.Parse(ductCsv.Replace("\\n", "\n").Replace("trunk,40,5", "trunk,NaN,5")); }
        catch (FormatException) { rejected = true; }
        Must(rejected, "nonfinite duct CSV input blocked");
        rejected = false;
        try { DuctNetworkCsv.Parse("bad,columns\ntrunk,0"); }
        catch (FormatException) { rejected = true; }
        Must(rejected, "invalid duct CSV schema blocked");
        var saved = new System.Collections.Generic.List<VentilationAssumption> {
            new VentilationAssumption {
                UniqueId = "room-001", Source = "MEP Space",
                Occupants = 3, Ach = 2.5, Rp = 5, Ra = 0.3,
                Ez = 0.8, ExhaustLs = 20, VelocityMs = 4
            },
            new VentilationAssumption {
                UniqueId = "room-002", Source = "Linked Room: A, B",
                Occupants = 0, Ach = null, Rp = null, Ra = null
            }
        };
        var savedCsv = VentilationAssumptionsCsv.Export(saved);
        var restored = VentilationAssumptionsCsv.Parse(savedCsv);
        Must(restored.Count == 2, "assumption import count");
        Must(restored[1].Source == "Linked Room: A, B", "quoted CSV model source round trip");
        Eq(2.5, restored[0].Ach, "assumption ACH saved exactly");
        Must(!restored[1].Ach.HasValue, "unknown ventilation rate remains unknown");
        Must(restored[0].UniqueId == saved[0].UniqueId, "stable Revit unique identifier");
        rejected = false;
        try { VentilationAssumptionsCsv.Parse(
            VentilationAssumptionsCsv.Export(new[] { saved[0], saved[0] })); }
        catch (FormatException) { rejected = true; }
        Must(rejected, "duplicate room/source assumptions blocked");
        rejected = false;
        try { VentilationAssumptionsCsv.Parse(savedCsv.Replace(",2.5,", ",NaN,")); }
        catch (FormatException) { rejected = true; }
        Must(rejected, "invalid imported assumption blocked");
        Console.WriteLine("PASS " + _count + " ventilation logic assertions");
    }
}
