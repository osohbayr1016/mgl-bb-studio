using System;
using System.Collections.Generic;
using System.Linq;
using Autodesk.Revit.Attributes;
using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Architecture;
using Autodesk.Revit.DB.Mechanical;
using Autodesk.Revit.UI;
using RevitMcpAddin.Ventilation.Core;

namespace RevitMcpAddin.Ventilation.Revit
{
    /// <summary>
    /// Reads host MEP Spaces first to avoid double-counting their underlying Rooms.
    /// When there are no placed Spaces, reads host + loaded linked architectural
    /// Rooms as preview-only; linked documents are never modified.
    /// </summary>
    public static class VentilationReader
    {
        public static List<VentilationRow> Read(Document doc)
        {
            var rows = new List<VentilationRow>();
            var spaces = new FilteredElementCollector(doc)
                .OfClass(typeof(Space)).Cast<Space>().ToList();

            if (spaces.Count > 0)
            {
                foreach (Space s in spaces)
                {
                    var row = Create(s, doc, "MEP Space", true);
                    var p = s.get_Parameter(BuiltInParameter.ROOM_DESIGN_SUPPLY_AIRFLOW_PARAM);
                    if (p != null && p.HasValue && p.StorageType == StorageType.Double)
                    {
                        double current = UnitUtils.ConvertFromInternalUnits(p.AsDouble(), UnitTypeId.LitersPerSecond);
                        if (current > 0) row.ExistingSupplyLs = current;
                    }
                    // Existing Space parameters are model-authored inputs,
                    // not invented BNbD values. All remain editable in the UI.
                    var people = s.get_Parameter(BuiltInParameter.SPACE_NUMBER_OF_PEOPLE);
                    if (people != null && people.HasValue && people.StorageType == StorageType.Double)
                    {
                        double count = people.AsDouble();
                        if (count > 0) row.Occupants = count;
                    }
                    var ach = s.get_Parameter(BuiltInParameter.SPACE_AIR_CHANGES_PER_HOUR);
                    if (ach != null && ach.HasValue && ach.StorageType == StorageType.Double)
                    {
                        double rate = ach.AsDouble();
                        if (rate > 0) row.Ach = rate;
                    }
                    var exhaust = s.get_Parameter(BuiltInParameter.ROOM_DESIGN_EXHAUST_AIRFLOW_PARAM);
                    if (exhaust != null && exhaust.HasValue && exhaust.StorageType == StorageType.Double)
                    {
                        double ls = UnitUtils.ConvertFromInternalUnits(exhaust.AsDouble(), UnitTypeId.LitersPerSecond);
                        if (ls > 0) row.ExhaustLs = ls;
                    }
                    try
                    {
                        // Revit computes this from placed air terminals; zero is
                        // meaningful and must not be silently treated as unknown.
                        double actual = UnitUtils.ConvertFromInternalUnits(
                            s.ActualSupplyAirflow, UnitTypeId.LitersPerSecond);
                        if (!double.IsNaN(actual) && !double.IsInfinity(actual) && actual >= 0)
                            row.ActualSupplyLs = actual;
                    }
                    catch { /* Unavailable in model state: preserve unknown. */ }
                    rows.Add(row);
                }
            }
            else
            {
                foreach (Room room in new FilteredElementCollector(doc).OfClass(typeof(SpatialElement))
                    .OfType<Room>())
                    rows.Add(Create(room, doc, "Architecture Room", false));

                // Fallback to linked Rooms only if the host itself has no placed
                // Rooms. Mixing both sources can double count the same room.
                if (rows.Count == 0)
                {
                    foreach (RevitLinkInstance link in new FilteredElementCollector(doc)
                        .OfClass(typeof(RevitLinkInstance)).Cast<RevitLinkInstance>())
                    {
                        Document linked = link.GetLinkDocument();
                        if (linked == null) continue;
                        foreach (Room room in new FilteredElementCollector(linked).OfClass(typeof(SpatialElement))
                            .OfType<Room>())
                            rows.Add(Create(room, linked, "Linked Room: " + link.Name, false));
                    }
                }
            }
            return rows.OrderBy(r => r.Level).ThenBy(r => r.Number).ThenBy(r => r.Name).ToList();
        }

        private static VentilationRow Create(SpatialElement e, Document source, string sourceType, bool writable)
        {
            double area = SafeArea(e);
            double volume = 0;
            try
            {
                if (e is Space s) volume = s.Volume;
                else if (e is Room r) volume = r.Volume;
            }
            catch { } // No volume calculations enabled: explicitly invalid for ACH.
            Level level = source.GetElement(e.LevelId) as Level;
            string number = "", name = "";
            if (e is Space sp) { number = sp.Number; name = sp.Name; }
            if (e is Room rm) { number = rm.Number; name = rm.Name; }
            return new VentilationRow
            {
                UniqueId = e.UniqueId,
                Number = number ?? "",
                Name = name ?? "",
                Level = level == null ? "—" : level.Name,
                Source = sourceType,
                Writable = writable,
                AreaM2 = UnitUtils.ConvertFromInternalUnits(area, UnitTypeId.SquareMeters),
                VolumeM3 = UnitUtils.ConvertFromInternalUnits(volume, UnitTypeId.CubicMeters)
            };
        }

        private static double SafeArea(SpatialElement e)
        {
            try { return e.Area; } catch { return 0; }
        }
    }

    public sealed class VentilationRow
    {
        // Identity/source are read-only; editable calculation assumptions are
        // deliberately NOT taken from guessed room-type codes or default rates.
        public string UniqueId { get; set; }
        public string Number { get; set; }
        public string Name { get; set; }
        public string Level { get; set; }
        public string Source { get; set; }
        public bool Writable { get; set; }
        public double AreaM2 { get; set; }
        public double VolumeM3 { get; set; }
        public double? Occupants { get; set; }
        public double? Ach { get; set; }
        public double? Rp { get; set; }
        public double? Ra { get; set; }
        public double? Ez { get; set; }
        public double? ExhaustLs { get; set; }
        public double? VelocityMs { get; set; }
        public double? ExistingSupplyLs { get; set; }
        public double? ActualSupplyLs { get; set; }
        // Provenance is retained only while the reviewed rate inputs are unchanged.
        public string RuleReference { get; private set; } = "";
        private VentilationRateProfile _appliedProfile;
        public VentilationResult Result { get; private set; }

        public void ApplyProfile(VentilationRateProfile p)
        {
            if (p == null) throw new ArgumentNullException(nameof(p));
            Ach = p.Ach;
            Rp = p.Rp;
            Ra = p.Ra;
            Ez = p.Ez;
            ExhaustLs = p.ExhaustLs;
            RuleReference = p.Reference;
            _appliedProfile = p;
        }

        public VentilationAssumption Assumptions()
        {
            return new VentilationAssumption {
                UniqueId = UniqueId, Source = Source, Occupants = Occupants,
                Ach = Ach, Rp = Rp, Ra = Ra, Ez = Ez,
                ExhaustLs = ExhaustLs, VelocityMs = VelocityMs
            };
        }

        public void ApplyAssumptions(VentilationAssumption x)
        {
            if (x == null) throw new ArgumentNullException(nameof(x));
            if (x.UniqueId != UniqueId || x.Source != Source)
                throw new InvalidOperationException("Model/source mismatch on assumptions import.");
            Occupants = x.Occupants;
            Ach = x.Ach; Rp = x.Rp; Ra = x.Ra; Ez = x.Ez;
            ExhaustLs = x.ExhaustLs; VelocityMs = x.VelocityMs;
            _appliedProfile = null;
            RuleReference = "CSV-с сэргээсэн — нормын баталгааг дахин шалгана";
        }

        public double? OutdoorLs { get { return Result?.OutdoorAirLs; } }
        public double? SupplyLs { get { return Result?.SchematicSupplyLs; } }
        public double? BalanceLs { get { return Result?.SupplyMinusExhaustLs; } }
        public double? ActualVsRequiredLs { get { return Result?.ActualMinusRequiredLs; } }
        public int? RoundDuctMm { get { return Result?.SuggestedRoundDuctDiameterMm; } }
        public string Status
        {
            get
            {
                if (Result == null) return "Тооцоогүй";
                if (!Result.Valid) return "Дутуу/алдаатай: " + string.Join("; ", Result.Errors);
                if (Result.Warnings.Count > 0) return "Анхаар: " + string.Join("; ", Result.Warnings);
                return "Тооцсон (инженер шалгана)";
            }
        }

        public void Calculate()
        {
            if (_appliedProfile != null &&
                (Ach != _appliedProfile.Ach || Rp != _appliedProfile.Rp ||
                 Ra != _appliedProfile.Ra || Ez != _appliedProfile.Ez ||
                 ExhaustLs != _appliedProfile.ExhaustLs))
            {
                RuleReference = "Хэрэглэгчийн өөрчилсөн утга — анхны нормын заалт баталгаагүй";
                _appliedProfile = null;
            }
            Result = VentilationCalculator.Calculate(new VentilationInput
            {
                AreaM2 = AreaM2, VolumeM3 = VolumeM3,
                Occupants = Occupants, Ach = Ach,
                OutdoorPerPersonLs = Rp, OutdoorPerAreaLs = Ra,
                DistributionEffectiveness = Ez,
                ExhaustLs = ExhaustLs, DuctVelocityMs = VelocityMs,
                ExistingSupplyLs = ExistingSupplyLs, ActualSupplyLs = ActualSupplyLs
            });
        }
    }

    [Transaction(TransactionMode.Manual)]
    [Regeneration(RegenerationOption.Manual)]
    public sealed class VentilationCommand : IExternalCommand
    {
        public Result Execute(ExternalCommandData commandData, ref string message, ElementSet elements)
        {
            if (!Licensing.LicenseGate.Ensure()) return Result.Cancelled;
            var ui = commandData.Application.ActiveUIDocument;
            if (ui?.Document == null || ui.Document.IsFamilyDocument) return Result.Cancelled;
            try
            {
                List<VentilationRow> rows = VentilationReader.Read(ui.Document);
                if (rows.Count == 0)
                {
                    TaskDialog.Show("MGL — Агааржуулалт",
                        "Байршсан MEP Space эсвэл Room олдсонгүй. Revit MEP-д Space үүсгэж, " +
                        "Volume Calculations-г идэвхжүүлнэ үү. Агааржуулалтын нормын утгууд автоматаар таамаглагдахгүй.");
                    return Result.Cancelled;
                }
                var w = new VentilationWindow(ui.Document, rows);
                App.ShowOwned(w, commandData.Application.MainWindowHandle);
                return Result.Succeeded;
            }
            catch (Exception ex)
            {
                message = ex.Message;
                TaskDialog.Show("MGL — Агааржуулалт", "Тооцооны хэрэгсэл нээгдсэнгүй: " + ex.Message);
                return Result.Failed;
            }
        }
    }
}
