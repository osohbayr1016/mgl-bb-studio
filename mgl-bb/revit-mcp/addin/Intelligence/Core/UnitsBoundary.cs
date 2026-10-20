using System;
using RevitMcpAddin.Intelligence.Contracts;

namespace RevitMcpAddin.Intelligence.Core
{
    /// <summary>
    /// НЭГЖИЙН ХИЛ (§14, R-3) — `Units.cs`-ийн `Quantity`-ийн АДАПТЕР, хоёр
    /// дахь үнэн БИШ.
    ///
    /// Revit-ийн дотоод нэгж нь ФУТ (урт), фут² (талбай), фут³ (эзлэхүүн),
    /// радиан (өнцөг).  Тэдгээр нь хүний хариултад мм/м² мэт ХЭЗЭЭ Ч
    /// «зүгээр» гарч болохгүй.  Энэ анги нь ЯГ ТЭР хөрвүүлэлтийг ГАНЦ газарт
    /// хийж, үр дүнг `Units.cs`-ийн нэгжийн толиор (`MM`, `M2` …) нэрлэнэ.
    ///
    /// ⚠️ ХӨРВҮҮЛЭХ ЭРХ нь `Quantity.ConversionAllowed`-оос ирнэ:
    ///    `UntypedParam` (Number/Integer/Text параметр) ХЭЗЭЭ Ч хөрвөхгүй —
    ///    тэр нь фут ч байж болно, мм ч байж болно; таамаглах эрхгүй.
    ///    Тийм утга `Measure`-д `unit = NONE` гэж ил гарна.
    ///
    /// ⚠️ Тогтмолууд нь ЯГ (Revit-ийн тодорхойлолт: 1 ft = 304.8 mm).
    ///    `UnitUtils.ConvertFromInternalUnits`-тэй ижил тоо гарна; Revit-гүй
    ///    тестэд энэ тогтмолоор шалгана.
    /// </summary>
    public static class UnitsBoundary
    {
        public const double MmPerFoot = 304.8;
        public const double M2PerSqFoot = 0.09290304;          // 0.3048²
        public const double M3PerCuFoot = 0.028316846592;       // 0.3048³
        public const double DegPerRad = 180.0 / Math.PI;

        /// <summary>Дотоод фут → мм.</summary>
        public static double FeetToMm(double feet) => feet * MmPerFoot;
        /// <summary>Дотоод фут → м.</summary>
        public static double FeetToM(double feet) => feet * MmPerFoot / 1000.0;
        /// <summary>Дотоод фут² → м².</summary>
        public static double SqFeetToM2(double sqFeet) => sqFeet * M2PerSqFoot;
        /// <summary>Дотоод фут³ → м³.</summary>
        public static double CuFeetToM3(double cuFeet) => cuFeet * M3PerCuFoot;
        /// <summary>Радиан → градус.</summary>
        public static double RadToDeg(double rad) => rad * DegPerRad;

        public static double MmToFeet(double mm) => mm / MmPerFoot;

        /// <summary>Гурван координат (фут) → мм, дугуйруулсан (0.1 мм).</summary>
        public static double[] PointFeetToMm(double x, double y, double z)
        {
            return new[] { Round1(FeetToMm(x)), Round1(FeetToMm(y)), Round1(FeetToMm(z)) };
        }

        public static double Round1(double v) => Math.Round(v, 1, MidpointRounding.AwayFromZero);

        /* ============================================================== */
        /*  Quantity ↔ Measure                                            */
        /* ============================================================== */

        /// <summary>`Units.cs`-ийн `Quantity` → гэрээний `Measure`.  Provenance ХАДГАЛАГДАНА.</summary>
        internal static Measure FromQuantity(string name, Quantity q)
        {
            var m = new Measure { Name = name, Missing = q.Missing };
            if (q.Missing)
            {
                m.Unit = Units.None;
                m.Source = MeasureSource.COMPUTED;
                return m;
            }
            m.Value = q.Value;
            m.Unit = q.Unit;
            m.SpecId = q.SpecId;
            m.Source = ToMeasureSource(q.Source);
            return m;
        }

        internal static MeasureSource ToMeasureSource(QuantitySource s)
        {
            switch (s)
            {
                case QuantitySource.BuiltinGeometry: return MeasureSource.BUILTIN_GEOMETRY;
                case QuantitySource.TypedParam: return MeasureSource.TYPED_PARAM;
                case QuantitySource.UntypedParam: return MeasureSource.UNTYPED_PARAM;
                default: return MeasureSource.COMPUTED;
            }
        }

        /// <summary>
        /// Дотоод УРТ (фут, Revit-ийн built-in геометр эсвэл LENGTH spec-тэй
        /// параметр) → мм `Measure`.  ⚠️ `UntypedParam`-д ХЭЗЭЭ Ч дуудахгүй —
        /// дуудвал `ArgumentException` (чимээгүй буруу тоо гаргахаас шидэх нь дээр).
        /// </summary>
        internal static Measure LengthMm(string name, double internalFeet, QuantitySource source, string specId)
        {
            Guard(source, specId);
            return FromQuantity(name, Quantity.Of(Round1(FeetToMm(internalFeet)), Units.Mm, source, specId));
        }

        internal static Measure AreaM2(string name, double internalSqFeet, QuantitySource source, string specId)
        {
            Guard(source, specId);
            return FromQuantity(name, Quantity.Of(Math.Round(SqFeetToM2(internalSqFeet), 3), Units.M2, source, specId));
        }

        internal static Measure VolumeM3(string name, double internalCuFeet, QuantitySource source, string specId)
        {
            Guard(source, specId);
            return FromQuantity(name, Quantity.Of(Math.Round(CuFeetToM3(internalCuFeet), 3), Units.M3, source, specId));
        }

        internal static Measure AngleDeg(string name, double rad, QuantitySource source, string specId)
        {
            Guard(source, specId);
            return FromQuantity(name, Quantity.Of(Math.Round(RadToDeg(rad), 2), Units.Deg, source, specId));
        }

        /// <summary>Нэгжгүй тоо (Integer/Number/Text параметр) — `NONE`, хөрвүүлэлтгүй.</summary>
        internal static Measure Raw(string name, double value, string specId)
        {
            return FromQuantity(name, Quantity.Of(value, Units.None, QuantitySource.UntypedParam, specId));
        }

        internal static Measure Count(string name, double value)
        {
            return FromQuantity(name, Quantity.Of(value, Units.Count, QuantitySource.Computed, null));
        }

        internal static Measure Absent(string name)
        {
            return FromQuantity(name, Quantity.Absent());
        }

        private static void Guard(QuantitySource source, string specId)
        {
            if (!Quantity.ConversionAllowed(source, specId))
            {
                throw new ArgumentException(
                    "mixed_provenance: " + source + " (spec " + (specId ?? "null") + ") нь нэгжийн хөрвүүлэлтийн эрхгүй");
            }
        }

        /// <summary>Нэгж ижил үү — дүрмийн босготой харьцуулахын өмнө.  Зөрвөл `UnitMismatchException`.</summary>
        public static void RequireSameUnit(Measure measured, string requiredUnit)
        {
            if (measured == null) throw new ArgumentNullException(nameof(measured));
            Quantity.RequireSame(requiredUnit ?? Units.None, measured.Unit ?? Units.None);
        }

        /// <summary>Хүнд харуулах мөр — «1 200 мм», «12.5 м²».</summary>
        public static string Format(Measure m)
        {
            if (m == null || m.Missing) return "—";
            string v;
            switch (m.Unit)
            {
                case Units.Mm: v = Math.Round(m.Value).ToString("N0", System.Globalization.CultureInfo.InvariantCulture) + " мм"; break;
                case Units.M: v = m.Value.ToString("0.##", System.Globalization.CultureInfo.InvariantCulture) + " м"; break;
                case Units.M2: v = m.Value.ToString("0.##", System.Globalization.CultureInfo.InvariantCulture) + " м²"; break;
                case Units.M3: v = m.Value.ToString("0.###", System.Globalization.CultureInfo.InvariantCulture) + " м³"; break;
                case Units.Deg: v = m.Value.ToString("0.#", System.Globalization.CultureInfo.InvariantCulture) + "°"; break;
                case Units.Pct: v = m.Value.ToString("0.#", System.Globalization.CultureInfo.InvariantCulture) + " %"; break;
                case Units.Count: v = m.Value.ToString("0", System.Globalization.CultureInfo.InvariantCulture); break;
                default: v = m.Value.ToString("0.###", System.Globalization.CultureInfo.InvariantCulture) + " (нэгжгүй)"; break;
            }
            if (m.Source == MeasureSource.UNTYPED_PARAM) v += " ⚠";
            return v;
        }
    }
}
