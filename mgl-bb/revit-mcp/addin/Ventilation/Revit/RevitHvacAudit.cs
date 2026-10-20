using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text;
using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Mechanical;

namespace RevitMcpAddin.Ventilation.Revit
{
    /// <summary>
    /// Read-only Revit host audit. Revit native MEP system calculations are
    /// reported only when available; unconnected system calculations stay
    /// unknown, never zero. This does not orient or size a duct network.
    /// </summary>
    public static class RevitHvacAudit
    {
        public static string ReadCsv(Document document)
        {
            if (document == null || document.IsFamilyDocument)
                throw new InvalidOperationException("Active Revit project document required.");
            var s = new StringBuilder();
            s.AppendLine("Kind,Id,NameOrSystem,WellConnected,Flow_Ls,CriticalPressure_Pa,OpenHvacEnds,Length_m,Notes");
            int systems = 0, ducts = 0, openEnds = 0, unwell = 0;
            foreach (MechanicalSystem system in new FilteredElementCollector(document)
                .OfClass(typeof(MechanicalSystem)).Cast<MechanicalSystem>())
            {
                systems++;
                bool well = false;
                string flow = "", critical = "", notes = "";
                try { well = system.IsWellConnected; }
                catch (Exception ex) { notes = "Connectivity unavailable: " + ex.Message; }
                if (!well)
                {
                    unwell++;
                    notes += " Model not well-connected; Revit hydraulic results withheld.";
                }
                else
                {
                    try
                    {
                        double q = UnitUtils.ConvertFromInternalUnits(
                            system.GetFlow(), UnitTypeId.LitersPerSecond);
                        if (FiniteNonnegative(q)) flow = N(q);
                    }
                    catch (Exception ex) { notes += " Flow unavailable: " + ex.Message; }
                    try
                    {
                        double p = UnitUtils.ConvertFromInternalUnits(
                            system.PressureLossOfCriticalPath, UnitTypeId.Pascals);
                        if (FiniteNonnegative(p)) critical = N(p);
                    }
                    catch (Exception ex) { notes += " Critical pressure unavailable: " + ex.Message; }
                }
                s.AppendLine(string.Join(",", new[] {
                    "MechanicalSystem", Q(system.Id.ToString()), Q(system.Name), well ? "yes" : "no",
                    flow, critical, "", "", Q(notes)
                }));
            }

            foreach (Duct duct in new FilteredElementCollector(document)
                .OfClass(typeof(Duct)).Cast<Duct>())
            {
                ducts++;
                int unconnected = 0;
                int hvacEnds = 0;
                string notes = "", systemName = "";
                try { systemName = duct.MEPSystem == null ? "" : duct.MEPSystem.Name; }
                catch (Exception ex) { notes += " System name unavailable: " + ex.Message; }
                try
                {
                    foreach (Connector c in duct.ConnectorManager.Connectors)
                    {
                        if (c.ConnectorType != ConnectorType.End ||
                            c.Domain != Domain.DomainHvac) continue;
                        hvacEnds++;
                        if (!c.IsConnected) unconnected++;
                    }
                    openEnds += unconnected;
                }
                catch (Exception ex)
                {
                    notes += " Connector audit unavailable: " + ex.Message;
                }
                double lengthM = 0;
                try
                {
                    var location = duct.Location as LocationCurve;
                    if (location != null && location.Curve != null)
                        lengthM = UnitUtils.ConvertFromInternalUnits(
                            location.Curve.Length, UnitTypeId.Meters);
                }
                catch (Exception ex) { notes += " Length unavailable: " + ex.Message; }
                if (unconnected > 0)
                    notes += " Unconnected HVAC ends may include intentional openings; engineer review required.";
                if (hvacEnds == 0) notes += " No HVAC end connectors were inspected.";
                s.AppendLine(string.Join(",", new[] {
                    "Duct", Q(duct.Id.ToString()), Q(systemName), "", "", "",
                    unconnected.ToString(CultureInfo.InvariantCulture),
                    lengthM > 0 ? N(lengthM) : "", Q(notes)
                }));
            }
            s.AppendLine(string.Join(",", new[] {
                "Summary", "", "",
                "", "", "",
                openEnds.ToString(CultureInfo.InvariantCulture), "",
                Q(systems + " mechanical systems (" + unwell + " not well-connected); " +
                  ducts + " duct segments; unconnected duct end count may include intentional openings")
            }));
            s.AppendLine("NOTICE,,,,,,,,\"Read-only source audit. Does not infer flow direction, fitting losses, branch sizing, fan selection or code approval.\"");
            return s.ToString();
        }

        private static bool FiniteNonnegative(double n)
        {
            return !double.IsNaN(n) && !double.IsInfinity(n) && n >= 0;
        }
        private static string N(double n)
        {
            return n.ToString("0.######", CultureInfo.InvariantCulture);
        }
        private static string Q(string input)
        {
            string x = input ?? "";
            if (x.TrimStart().Length > 0 && "=+-@".IndexOf(x.TrimStart()[0]) >= 0)
                x = "'" + x;
            return "\"" + x.Replace("\"", "\"\"") + "\"";
        }
    }
}
