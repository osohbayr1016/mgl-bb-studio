using System;
using System.Collections.Generic;

namespace RevitMcpAddin.Ventilation.Core
{
    /// <summary>
    /// Explicit, user-approved design inputs. Rates are NOT built-in code minima.
    /// All quantities use SI units. An unset value is null, never silently zero.
    /// </summary>
    public sealed class VentilationInput
    {
        public double AreaM2 { get; set; }
        public double VolumeM3 { get; set; }
        public double? Occupants { get; set; }
        public double? Ach { get; set; }
        public double? OutdoorPerPersonLs { get; set; }
        public double? OutdoorPerAreaLs { get; set; }
        public double? DistributionEffectiveness { get; set; }
        public double? ExhaustLs { get; set; }
        public double? DuctVelocityMs { get; set; }
        public double? ExistingSupplyLs { get; set; }
        public double? ActualSupplyLs { get; set; }
    }

    public sealed class VentilationResult
    {
        public bool Valid { get; internal set; }
        public double? AirChangesSupplyLs { get; internal set; }
        public double? OutdoorAirLs { get; internal set; }
        /// <summary>
        /// Schematic lower bound on supply; NOT heating/cooling load sizing and
        /// NOT a complete multi-zone outdoor-air-intake calculation.
        /// </summary>
        public double? SchematicSupplyLs { get; internal set; }
        public double? SupplyMinusExhaustLs { get; internal set; }
        public double? ActualMinusRequiredLs { get; internal set; }
        public double? IdealRoundDuctDiameterMm { get; internal set; }
        public int? SuggestedRoundDuctDiameterMm { get; internal set; }
        public List<string> Errors { get; } = new List<string>();
        public List<string> Warnings { get; } = new List<string>();
    }

    public static class VentilationCalculator
    {
        // Illustrative rounding candidates only; NOT an approved duct catalogue.
        private static readonly int[] RoundMm =
            { 80, 100, 125, 160, 200, 250, 315, 355, 400, 450, 500, 560, 630, 710, 800, 900, 1000, 1120, 1250, 1400, 1600, 1800, 2000 };

        public static VentilationResult Calculate(VentilationInput x)
        {
            if (x == null) throw new ArgumentNullException(nameof(x));
            var r = new VentilationResult();
            CheckNonnegative(r, "Талбай", x.AreaM2);
            CheckNonnegative(r, "Эзлэхүүн", x.VolumeM3);
            CheckOptional(r, "Хүн", x.Occupants);
            CheckOptional(r, "ACH", x.Ach);
            CheckOptional(r, "Rp", x.OutdoorPerPersonLs);
            CheckOptional(r, "Ra", x.OutdoorPerAreaLs);
            CheckOptional(r, "Exhaust", x.ExhaustLs);
            CheckOptional(r, "Velocity", x.DuctVelocityMs);
            CheckOptional(r, "Existing supply", x.ExistingSupplyLs);
            CheckOptional(r, "Actual supply", x.ActualSupplyLs);
            if (x.DistributionEffectiveness.HasValue &&
                (!Finite(x.DistributionEffectiveness.Value) || x.DistributionEffectiveness.Value <= 0))
                r.Errors.Add("Ez нь 0-ээс их, бодит тоо байх ёстой.");

            bool useAch = x.Ach.HasValue;
            bool useOutdoor = x.OutdoorPerPersonLs.HasValue || x.OutdoorPerAreaLs.HasValue;
            if (!useAch && !useOutdoor)
                r.Errors.Add("ACH эсвэл Rp/Ra-н баталгаажсан утга оруулна уу.");
            if (x.AreaM2 <= 0) r.Errors.Add("Өрөөний талбай 0 буюу байршуулаагүй байна.");
            if (useAch && x.VolumeM3 <= 0)
                r.Errors.Add("ACH-д эзлэхүүн шаардлагатай (Revit-ийн Volume Calculations-г шалгана уу).");
            if (useOutdoor && !x.DistributionEffectiveness.HasValue)
                r.Errors.Add("Rp/Ra арга хэрэглэхэд Ez-г инженер заавал заах ёстой (өгөгдмөл 1 гэж таамаглахгүй).");
            if (useOutdoor && x.OutdoorPerPersonLs.GetValueOrDefault() > 0 && !x.Occupants.HasValue)
                r.Errors.Add("Rp хэрэглэсэн тул хүний тоо заавал шаардлагатай.");
            if (useOutdoor &&
                x.OutdoorPerPersonLs.GetValueOrDefault() == 0 &&
                x.OutdoorPerAreaLs.GetValueOrDefault() == 0)
                r.Errors.Add("Rp/Ra хоёулаа 0 бол бодит агааржуулалтын арга биш.");
            if (x.DuctVelocityMs.HasValue && x.DuctVelocityMs.Value <= 0)
                r.Errors.Add("Сувгийн хурд 0-ээс их байх ёстой.");
            if (r.Errors.Count > 0) return r;

            if (useAch)
                r.AirChangesSupplyLs = x.VolumeM3 * x.Ach.Value * 1000.0 / 3600.0;
            if (useOutdoor)
            {
                double vz = (x.Occupants.GetValueOrDefault() * x.OutdoorPerPersonLs.GetValueOrDefault()) +
                            (x.AreaM2 * x.OutdoorPerAreaLs.GetValueOrDefault());
                r.OutdoorAirLs = vz / x.DistributionEffectiveness.Value;
            }
            double supply = Math.Max(r.AirChangesSupplyLs.GetValueOrDefault(), r.OutdoorAirLs.GetValueOrDefault());
            if (!Finite(supply) || supply <= 0)
            {
                r.Errors.Add("Тооцооны өгөлт эерэг бодит утга гарах ёстой.");
                return r;
            }
            r.SchematicSupplyLs = supply;
            if (x.ExhaustLs.HasValue)
            {
                r.SupplyMinusExhaustLs = supply - x.ExhaustLs.Value;
                if (r.SupplyMinusExhaustLs.Value < -1e-6)
                    r.Warnings.Add("Сорох агаар өгөлтөөс их байна: makeup/transfer air ба даралтын тэнцвэрийг инженер шалгана.");
            }
            if (x.ExistingSupplyLs.HasValue && x.ExistingSupplyLs.Value + 1e-6 < supply)
                r.Warnings.Add("Revit-ийн одоогийн specified supply нь тооцоолсон урьдчилсан өгөлтөөс бага.");
            if (x.ActualSupplyLs.HasValue)
            {
                r.ActualMinusRequiredLs = x.ActualSupplyLs.Value - supply;
                // Diagnostic comparison threshold ONLY, not a regulatory tolerance.
                if (Math.Abs(r.ActualMinusRequiredLs.Value) > Math.Max(5.0, supply * 0.05))
                    r.Warnings.Add("Revit Actual Supply Airflow нь тооцооны урьдчилсан өгөлтөөс " +
                        "5% / 5 L/s шалгах босгоор зөрүүтэй. Терминал ба системийг шалгана.");
            }
            if (x.DuctVelocityMs.HasValue)
            {
                double diameterM = Math.Sqrt((4.0 * supply / 1000.0) / (Math.PI * x.DuctVelocityMs.Value));
                double diameterMm = diameterM * 1000.0;
                r.IdealRoundDuctDiameterMm = diameterMm;
                foreach (int size in RoundMm)
                {
                    if (size >= diameterMm)
                    {
                        r.SuggestedRoundDuctDiameterMm = size;
                        break;
                    }
                }
                if (!r.SuggestedRoundDuctDiameterMm.HasValue)
                    r.Warnings.Add("Сувгийн тооцоолсон диаметр нь жишиг жагсаалтын дээд хэмжээнээс их.");
            }
            r.Valid = true;
            return r;
        }

        private static void CheckOptional(VentilationResult r, string name, double? value)
        {
            if (value.HasValue) CheckNonnegative(r, name, value.Value);
        }

        private static void CheckNonnegative(VentilationResult r, string name, double value)
        {
            if (!Finite(value) || value < 0)
                r.Errors.Add(name + ": сөрөг, NaN эсвэл Infinity утга зөвшөөрөхгүй.");
        }

        private static bool Finite(double d)
        {
            return !double.IsNaN(d) && !double.IsInfinity(d);
        }
    }
}
