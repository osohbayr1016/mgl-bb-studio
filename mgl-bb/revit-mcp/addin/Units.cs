using System;

namespace RevitMcpAddin
{
    /// <summary>
    /// Хэмжигдэхүүний ЭХ ҮҮСВЭР — v2 §62.
    ///
    /// ⚠️ ЯАГААД ЗӨВХӨН НЭГЖ ХҮРЭЛЦЭХГҮЙ ВЭ:
    ///   Монгол төслийн темплейт дээр «Өргөн» нэртэй project parameter нь нэг
    ///   family дээр LENGTH spec-тэй (дотоод 3.937 фут → 1200 мм зөв хөрвөнө),
    ///   өөр family дээр NUMBER spec-тэй, шууд 1200 гэсэн тоо агуулна.  Хоёулаа
    ///   `MM` гэж зарлана.  Хоёр дахийг фут гэж хөрвүүлбэл 365 760 мм болж бүх
    ///   зүйл PASS; хөрвүүлэхгүй бол эхнийх 3.9 мм болж бүх зүйл VIOLATION.
    ///   Нэгж ГАНЦААРАА ялгаж ЧАДАХГҮЙ — тиймээс эх үүсвэрийг АВЧ ЯВНА.
    ///
    /// ⚠️ Утасны токен нь snake_case (Хавсралт §4.2).  Enum-ийн ТООН утгыг
    ///    утсаар ХЭЗЭЭ Ч илгээхгүй — дараалал өөрчлөгдвөл чимээгүй буруу.
    /// </summary>
    internal enum QuantitySource
    {
        BuiltinGeometry = 0,
        TypedParam = 1,
        UntypedParam = 2,
        Computed = 3,
    }

    /// <summary>
    /// Нэгжийн аюулгүй байдал.  ⚠️ ЭНЭ ФАЙЛ Revit-ийн API-гийн ямар ч төрөл
    /// ХЭРЭГЛЭХГҮЙ — `RuleEngine` шиг Revit-гүйгээр тестлэгдэнэ
    /// (`revit-mcp/training/check_rules.py` нь энэ файлыг ГАНЦААР нь compile хийнэ).
    ///
    /// ⚠️ `QtoExtractor`-ийн тэг-нь-NULL дугуйруулагчийг (`:528-534`) ЭНЭ ЗАМ
    ///    ДЭЭР ДАХИН АШИГЛАХГҮЙ: тэр нь ЖИНХЭНЭ ТЭГийг NULL болгодог,
    ///    гэтэл v2 §63 нь `zero` ба `missing_input`-ыг ТУСДАА заавал ёстой
    ///    тестийн тохиолдол гэж жагсаадаг.
    /// </summary>
    internal struct Quantity
    {
        public double Value;
        /// <summary>MM | M | M2 | M3 | DEG | PCT | COUNT | KG_M3 | H | NONE</summary>
        public string Unit;
        public bool Missing;
        public QuantitySource Source;
        /// <summary>`GetUnitTypeId()`/`GetTypeId()`-ийн мөр, эсвэл null.</summary>
        public string SpecId;

        internal static Quantity Absent()
        {
            Quantity q = new Quantity();
            q.Missing = true;
            q.Unit = Units.None;
            q.Source = QuantitySource.Computed;
            return q;
        }

        internal static Quantity Of(double value, string unit, QuantitySource source, string specId)
        {
            Quantity q = new Quantity();
            q.Value = value;
            q.Unit = unit;
            q.Missing = false;
            q.Source = source;
            q.SpecId = specId;
            return q;
        }

        /// <summary>
        /// ⚠️ ХӨРВҮҮЛЭЛТ ЗӨВШӨӨРӨГДӨХ НӨХЦӨЛ: `BuiltinGeometry` / `Computed`,
        /// эсвэл spec-тэй `TypedParam`.  `UntypedParam` (Integer / Number /
        /// Text) нь ҮРГЭЛЖ таамаг — таамаглах эрхгүй, `mixed_provenance`.
        /// </summary>
        internal static bool ConversionAllowed(QuantitySource s, string specId)
        {
            if (s == QuantitySource.UntypedParam) return false;
            if (s == QuantitySource.TypedParam) return !string.IsNullOrEmpty(specId);
            return true;
        }

        /// <summary>
        /// ⚠️ ЗӨРВӨЛ ШИДНЭ, ХӨРВҮҮЛЭХГҮЙ.  Тэр шидэлт нь §63-ын `mixed_units`
        /// кейс; `RuleEngine.Evaluate` барьж аваад `UNCERTAIN` болгоно.
        /// </summary>
        internal static void RequireSame(string expectedUnit, string actualUnit)
        {
            if (!string.Equals(expectedUnit, actualUnit, StringComparison.Ordinal))
            {
                throw new UnitMismatchException(expectedUnit, actualUnit);
            }
        }
    }

    internal sealed class UnitMismatchException : Exception
    {
        internal UnitMismatchException(string expected, string actual)
            : base("mixed_units: " + expected + " != " + actual)
        {
        }
    }

    /// <summary>
    /// НЭГЖИЙН ТОЛЬ ба нэрнээс нэгж гаргах алгоритм (Хавсралт §1.2).
    ///
    /// ⚠️ ХОС ФАЙЛ: `backend/src/lib/complianceModel.ts` -ийн `unitForFactName`.
    /// Хамгийн УРТ таарах суффиксийг ав; аль нь ч таарахгүй бол `NONE`.
    ///   `element.ceiling_h_mm` → MM  (`_h` БИШ — терминал суффикс ялна)
    ///   `project.stories_above_grade` → NONE  (суффиксгүй тоо, COUNT БИШ)
    /// </summary>
    internal static class Units
    {
        internal const string Mm = "MM";
        internal const string M = "M";
        internal const string M2 = "M2";
        internal const string M3 = "M3";
        internal const string Deg = "DEG";
        internal const string Pct = "PCT";
        internal const string Count = "COUNT";
        internal const string KgM3 = "KG_M3";
        internal const string H = "H";
        internal const string None = "NONE";

        private static readonly string[] SuffixKeys =
        {
            "_mm", "_m", "_m2", "_m3", "_deg", "_pct", "_count", "_kgm3", "_h",
        };

        private static readonly string[] SuffixUnits =
        {
            Mm, M, M2, M3, Deg, Pct, Count, KgM3, H,
        };

        internal static string LocalName(string factName)
        {
            if (string.IsNullOrEmpty(factName)) return "";
            int dot = factName.IndexOf('.');
            return dot < 0 ? factName : factName.Substring(dot + 1);
        }

        internal static string ForFactName(string factName)
        {
            string local = LocalName(factName);
            string best = None;
            int bestLen = 0;
            for (int i = 0; i < SuffixKeys.Length; i++)
            {
                string sfx = SuffixKeys[i];
                if (sfx.Length > bestLen && local.EndsWith(sfx, StringComparison.Ordinal))
                {
                    best = SuffixUnits[i];
                    bestLen = sfx.Length;
                }
            }
            return best;
        }

        internal static bool IsKnown(string unit)
        {
            if (string.IsNullOrEmpty(unit)) return false;
            for (int i = 0; i < SuffixUnits.Length; i++)
            {
                if (string.Equals(SuffixUnits[i], unit, StringComparison.Ordinal)) return true;
            }
            return string.Equals(unit, None, StringComparison.Ordinal);
        }
    }
}
