using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text.RegularExpressions;

namespace MglBb.Core
{
    /// <summary>Параметрийн нэг нөхцөл: параметрийн нэр, үйлдэл, утга (бичвэрээр — харагдацад харагдах утга).</summary>
    public sealed class BbParamRule
    {
        public string Param = "";
        public string Op = BbParamFilter.Eq;
        public string Value = "";
    }

    /// <summary>
    /// «Параметрээр шүүх»-ийн цэвэр логик: Revit-ийн параметрийн ХАРАГДАХ утгыг (AsValueString — «300 mm», «B30», «ДН-11») нөхцөлтэй тулгана.
    /// Тоон үйлдэл (&gt;, ≥, &lt;, ≤) утгын эхний тоогоор (нэгж, таслалыг үл тооно); бусад нь том/жижиг үсэг ялгахгүй бичвэрээр.
    /// </summary>
    public static class BbParamFilter
    {
        public const string Eq = "=", Ne = "≠", Contains = "агуулсан", NotContains = "агуулаагүй",
            Gt = ">", Ge = "≥", Lt = "<", Le = "≤", Empty = "хоосон", NotEmpty = "хоосон биш";

        public static readonly string[] Ops = { Eq, Ne, Contains, NotContains, Gt, Ge, Lt, Le, Empty, NotEmpty };

        /// <summary>Утга шаарддаггүй үйлдэл.</summary>
        public static bool Unary(string op) { return op == Empty || op == NotEmpty; }

        private static readonly Regex Num = new Regex(@"[-+]?\d+(?:[.,]\d+)?", RegexOptions.CultureInvariant);

        /// <summary>Бичвэрийн эхний тоо («300 mm» → 300, «1,5 m» → 1.5, «B30» → 30).  Тоогүй бол null.</summary>
        public static double? Number(string s)
        {
            if (string.IsNullOrWhiteSpace(s)) return null;
            Match m = Num.Match(s);
            if (!m.Success) return null;
            return double.TryParse(m.Value.Replace(',', '.'), NumberStyles.Float, CultureInfo.InvariantCulture, out double d) ? d : (double?)null;
        }

        /// <param name="value">Элементийн параметрийн утга (null = параметр байхгүй).</param>
        public static bool Match(string value, string op, string target)
        {
            string v = (value ?? "").Trim(), t = (target ?? "").Trim();
            switch (op)
            {
                case Empty: return v.Length == 0;
                case NotEmpty: return v.Length > 0;
                case Eq: return string.Equals(v, t, StringComparison.CurrentCultureIgnoreCase) || NumEq(v, t);
                case Ne: return !(string.Equals(v, t, StringComparison.CurrentCultureIgnoreCase) || NumEq(v, t));
                case Contains: return v.IndexOf(t, StringComparison.CurrentCultureIgnoreCase) >= 0;
                case NotContains: return v.IndexOf(t, StringComparison.CurrentCultureIgnoreCase) < 0;
            }
            double? a = Number(v), b = Number(t);
            if (a == null || b == null) return false;
            switch (op)
            {
                case Gt: return a > b;
                case Ge: return a >= b - 1e-9;
                case Lt: return a < b;
                case Le: return a <= b + 1e-9;
                default: return false;
            }
        }

        /// <summary>«300» = «300 mm» (хоёулаа ганцхан тоо, нэгжээс бусад нь ижил) — хэрэглэгч нэгжгүй бичихэд.</summary>
        private static bool NumEq(string v, string t)
        {
            double? a = Number(v), b = Number(t);
            if (a == null || b == null || Math.Abs(a.Value - b.Value) > 1e-9) return false;
            // Зөвхөн тоо бичсэн бол («300») тоогоор тэнцэнэ; «B30» ≠ «C30».
            return Num.Replace(t, "").Trim().Length == 0 || string.Equals(Num.Replace(v, "").Trim(), Num.Replace(t, "").Trim(), StringComparison.CurrentCultureIgnoreCase);
        }

        /// <summary>Бүх нөхцөл (БА).  <paramref name="values"/> = параметрийн нэр → утга (элементэд байхгүй бол түлхүүр алга).  Хоосон нөхцөлийг алгасна.</summary>
        public static bool MatchAll(IDictionary<string, string> values, IEnumerable<BbParamRule> rules)
        {
            foreach (BbParamRule r in rules ?? Enumerable.Empty<BbParamRule>())
            {
                if (string.IsNullOrWhiteSpace(r.Param)) continue;
                values.TryGetValue(r.Param, out string v);
                if (!Match(v, r.Op, r.Value)) return false;
            }
            return true;
        }
    }
}
