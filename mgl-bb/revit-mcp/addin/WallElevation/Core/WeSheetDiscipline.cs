using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace RevitMcpAddin.WallElevation.Core
{
    /// <summary>
    /// Салбарын хэрэгслийн хуудасны ТОГТМОЛ параметр (2026-10-14, интерьерийн баг): «Интерьер» туузан цэсний «Ханын дэлгээс»-ээр үүсгэсэн
    /// хуудсанд «* Classification» = «Интерьер», «* Sub-Discipline» = «Барилга архитектур» ҮРГЭЛЖ бичигдэнэ.  Параметрийг НЭРЭЭР тулгана
    /// («*», зай, зураас, том жижиг үсэг үл тоогдоно — «* Sub-Discipline» ≡ «Sub Discipline» ≡ «subdiscipline»): оффисын shared/project
    /// параметрийн id төсөл бүрд өөр.
    /// </summary>
    public static class WeSheetDiscipline
    {
        public const string ClassificationParam = "* Classification";
        public const string SubDisciplineParam = "* Sub-Discipline";
        public const string InteriorClassification = "Интерьер";
        public const string InteriorSubDiscipline = "Барилга архитектур";
        /// <summary>
        /// Оффисын хуудасны «* Type Designator» (2026-10-14, интерьерийн баг 3-р тойрог) — цонхноос сонгоно (тогтмол биш).  Утгын жагсаалт =
        /// төслийн хуудсуудад аль хэдийн бичигдсэн утгууд (<c>WeSheetParamReader</c>).
        /// </summary>
        public const string TypeDesignatorParam = "* Type Designator";

        /// <summary>Интерьерийн хэрэгслийн тогтмол параметр (харагдах нэр → утга).</summary>
        public static Dictionary<string, string> Interior()
        {
            return new Dictionary<string, string>(StringComparer.Ordinal)
            {
                { ClassificationParam, InteriorClassification },
                { SubDisciplineParam, InteriorSubDiscipline },
            };
        }

        /// <summary>Тулгах түлхүүр: зөвхөн үсэг, цифр, жижиг үсгээр («* Sub-Discipline» → «subdiscipline»).</summary>
        public static string NormalizeName(string name)
        {
            if (string.IsNullOrEmpty(name)) return string.Empty;
            var sb = new StringBuilder(name.Length);
            foreach (char ch in name)
                if (char.IsLetterOrDigit(ch)) sb.Append(char.ToLower(ch, CultureInfo.InvariantCulture));
            return sb.ToString();
        }

        /// <summary><paramref name="paramName"/>-д тогтоосон утга (нэрээр тулгаж); байхгүй бол null.</summary>
        public static string ValueFor(IDictionary<string, string> fixedParams, string paramName)
        {
            if (fixedParams == null || fixedParams.Count == 0) return null;
            string want = NormalizeName(paramName);
            if (want.Length == 0) return null;
            foreach (KeyValuePair<string, string> kv in fixedParams)
                if (NormalizeName(kv.Key) == want) return kv.Value;
            return null;
        }

        /// <summary>«* Classification = Интерьер, * Sub-Discipline = Барилга архитектур» — цонх, тайланд.</summary>
        public static string Describe(IDictionary<string, string> fixedParams)
        {
            if (fixedParams == null || fixedParams.Count == 0) return string.Empty;
            var parts = new List<string>();
            foreach (KeyValuePair<string, string> kv in fixedParams) parts.Add("«" + kv.Key + "» = «" + kv.Value + "»");
            return string.Join(", ", parts);
        }
    }
}
