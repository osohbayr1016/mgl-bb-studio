using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text.RegularExpressions;

namespace RevitMcpAddin.SmartCount.Core
{
    /// <summary>
    /// Нэгжийн хөрвүүлэлт — ЦЭВЭР.  Revit-ийн параметрийн утгыг каноник нэгжээр (урт → мм, талбай → м²,
    /// эзлэхүүн → м³, өнцөг → °) авсны дараа хэрэглэгчийн оруулсан утгыг ЯГ тэр нэгж рүү хөрвүүлж харьцуулна.
    ///
    /// ⚠️ ЯАГААД: Revit дотоодод урт = ФУТ (1 мм = 0.00328 фут).  Хэрэглэгчийн «3000» мм-ийг дотоод
    /// double-тэй шууд харьцуулбал бүх тоо 304.8 дахин алдаатай болно.  Энэ алдааг бүтцээр хаахын тулд
    /// Revit-тэй хэсэг утгыг ЗААВАЛ каноник нэгжээр хөрвүүлж `ParamValue.Number`-д өгдөг.
    ///
    /// Каноник нэгж: урт = мм, талбай = м², эзлэхүүн = м³, өнцөг = °.  Хүснэгт дэх хүчин зүйл нь
    /// «1 нэгж = X каноник нэгж» (жишээ нь 1 фут = 304.8 мм, 1 фут² = 0.09290304 м²).
    /// </summary>
    public static class UnitCatalog
    {
        public sealed class UnitDef
        {
            public string Key;
            public string Family;
            /// <summary>1 нэгж = `ToCanonical` каноник нэгж.</summary>
            public double ToCanonical;
        }

        // Каноник: length=mm, area=m², volume=m³, angle=deg.
        private static readonly Dictionary<string, UnitDef> Units = Build();

        private static Dictionary<string, UnitDef> Build()
        {
            var d = new Dictionary<string, UnitDef>(StringComparer.OrdinalIgnoreCase);
            Action<string, string, double> add = (key, fam, factor) => d[key] = new UnitDef { Key = key, Family = fam, ToCanonical = factor };

            add("mm", "length", 1.0);
            add("cm", "length", 10.0);
            add("m", "length", 1000.0);
            add("km", "length", 1000000.0);
            add("in", "length", 25.4);
            add("ft", "length", 304.8);

            add("mm2", "area", 1e-6);
            add("cm2", "area", 1e-4);
            add("m2", "area", 1.0);
            add("ft2", "area", 0.09290304);
            add("in2", "area", 0.00064516);

            add("mm3", "volume", 1e-9);
            add("cm3", "volume", 1e-6);
            add("l", "volume", 1e-3);
            add("m3", "volume", 1.0);
            add("ft3", "volume", 0.028316846592);
            add("in3", "volume", 1.6387064e-5);

            add("deg", "angle", 1.0);
            add("rad", "angle", 180.0 / Math.PI);
            return d;
        }

        /// <summary>Каноник нэгжийн түлхүүр (`length` → `mm`).  `count`/`other` → null (хөрвүүлэлтгүй).</summary>
        public static string CanonicalUnit(string family)
        {
            switch ((family ?? "").ToLowerInvariant())
            {
                case "length": return "mm";
                case "area": return "m2";
                case "volume": return "m3";
                case "angle": return "deg";
                default: return null;
            }
        }

        /// <summary>Хэрэглэгчийн бичсэн нэгжийг түлхүүр болгоно: `m²` → `m2`, `°` → `deg`, `мм` → `mm`, `литр` → `l`.</summary>
        public static string Normalize(string unit)
        {
            if (string.IsNullOrWhiteSpace(unit)) return null;
            string u = unit.Trim().ToLowerInvariant()
                .Replace("²", "2").Replace("³", "3").Replace(" ", "").Replace(".", "");
            switch (u)
            {
                case "°": case "degree": case "degrees": case "градус": return "deg";
                case "radian": case "radians": case "рад": return "rad";
                case "мм": case "millimeter": case "millimeters": case "millimetre": case "millimetres": return "mm";
                case "см": case "centimeter": case "centimeters": return "cm";
                case "м": case "meter": case "meters": case "metre": case "metres": return "m";
                case "км": return "km";
                case "inch": case "inches": case "\"": return "in";
                case "foot": case "feet": case "'": return "ft";
                case "м2": case "sqm": return "m2";
                case "мм2": return "mm2";
                case "см2": return "cm2";
                case "м3": return "m3";
                case "мм3": return "mm3";
                case "см3": return "cm3";
                case "л": case "литр": case "liter": case "liters": case "litre": return "l";
                default: return u;
            }
        }

        public static bool TryGet(string unit, out UnitDef def)
        {
            def = null;
            string k = Normalize(unit);
            return k != null && Units.TryGetValue(k, out def);
        }

        /// <summary>
        /// `value` (`unit` нэгжээр)-ийг параметрийн ХЭРЭГЛЭХ `family`-ийн каноник нэгж рүү хөрвүүлнэ.
        /// `unit` хоосон бол утга аль хэдийн каноник гэж үзнэ.  Нэгж өөр гэр бүлийнх (мм-ийг талбайд)
        /// эсвэл танигдаагүй бол `false` — дуудагч «нэгж таарахгүй» гэж мэдээлнэ.
        /// </summary>
        public static bool ToCanonical(double value, string unit, string family, out double canonical)
        {
            canonical = value;
            if (string.IsNullOrWhiteSpace(unit)) return true;
            UnitDef def;
            if (!TryGet(unit, out def)) return false;
            if (!string.Equals(def.Family, family, StringComparison.OrdinalIgnoreCase)) return false;
            canonical = value * def.ToCanonical;
            return true;
        }

        public static double FromCanonical(double canonical, string unit)
        {
            UnitDef def;
            return TryGet(unit, out def) ? canonical / def.ToCanonical : canonical;
        }

        /* ------------------------- ТООНЫ ЗАДЛАЛТ -------------------------- */

        private static readonly Regex NumberWithUnit =
            new Regex(@"^\s*([-+]?\d(?:[\d\s.,]*\d)?)\s*([^\d\s.,][^\s]*)?\s*$", RegexOptions.Compiled | RegexOptions.CultureInvariant);

        /// <summary>
        /// `3000`, `3,5`, `1 200.5`, `3000 мм`, `2.5 m²`-г задлана.  Таслал ба цэг аль нь ч аравтын таслал
        /// байж болно (Монгол/Европ бичлэг); хоёулаа байвал сүүлийнх нь аравтын, өмнөх нь мянгатын тусгаарлагч.
        /// </summary>
        public static bool TryParseNumber(string text, out double value, out string unitSuffix)
        {
            value = 0;
            unitSuffix = null;
            if (string.IsNullOrWhiteSpace(text)) return false;
            Match m = NumberWithUnit.Match(text);
            if (!m.Success) return false;

            string num = m.Groups[1].Value.Replace(" ", "");
            int comma = num.LastIndexOf(',');
            int dot = num.LastIndexOf('.');
            if (comma >= 0 && dot >= 0)
            {
                if (comma > dot) num = num.Replace(".", "").Replace(',', '.');
                else num = num.Replace(",", "");
            }
            else if (comma >= 0)
            {
                num = num.Replace(',', '.');
            }

            if (!double.TryParse(num, NumberStyles.Float, CultureInfo.InvariantCulture, out value)) return false;
            unitSuffix = m.Groups[2].Success && m.Groups[2].Length > 0 ? m.Groups[2].Value : null;
            return !double.IsNaN(value) && !double.IsInfinity(value);
        }
    }
}
