using System;
using System.Globalization;

namespace RevitMcpAddin.ChangeImpact.Core
{
    /// <summary>Хаалга зөөхийн ХЭРЭГЛЭГЧИЙН ОРОЛТ — товчны алхам, тэмдэгтэй зайг задлах.  ЦЭВЭР, тестлэгдэнэ.</summary>
    public static class DoorMoveInput
    {
        /// <summary>«±10 ±50 ±100» товч.</summary>
        public static readonly int[] NudgeSteps = { 10, 50, 100 };

        /// <summary>Гарын сумны алхам: Ctrl = нарийн (10), Shift = том (100), үгүй бол 50 мм.</summary>
        public static double KeyStepMm(bool ctrl, bool shift)
        {
            if (ctrl) return 10;
            if (shift) return 100;
            return 50;
        }

        /// <summary>
        /// Хаалганы одоогийн байрлалаас хостын дагуух ТЭМДЭГТЭЙ зай (мм): «+300», «-250», «−250» (Unicode хасах), «300 мм», «0.3 м», «30 см», «0,25м».
        /// Тэмдэггүй = «+».  Хоосон/буруу/NaN/∞ → null.  Хэт том (|x| &gt; 1 000 000 мм) → null.
        /// </summary>
        public static double? ParseSignedOffsetMm(string text)
        {
            if (string.IsNullOrWhiteSpace(text)) return null;
            string s = text.Trim().ToLowerInvariant().Replace(',', '.').Replace(" ", "").Replace('−', '-').Replace('–', '-').Replace('—', '-');
            double sign = 1;
            if (s.StartsWith("+")) s = s.Substring(1);
            else if (s.StartsWith("-")) { sign = -1; s = s.Substring(1); }
            double factor = 1.0;
            if (s.EndsWith("мм") || s.EndsWith("mm")) s = s.Substring(0, s.Length - 2);
            else if (s.EndsWith("см") || s.EndsWith("cm")) { s = s.Substring(0, s.Length - 2); factor = 10.0; }
            else if (s.EndsWith("м") || s.EndsWith("m")) { s = s.Substring(0, s.Length - 1); factor = 1000.0; }
            if (s.Length == 0 || s.StartsWith("+") || s.StartsWith("-")) return null;
            double v;
            if (!double.TryParse(s, NumberStyles.Float, CultureInfo.InvariantCulture, out v)) return null;
            if (double.IsNaN(v) || double.IsInfinity(v)) return null;
            double mm = sign * v * factor;
            return Math.Abs(mm) > 1000000 ? (double?)null : mm;
        }

        /// <summary>Талбарт харуулах (мм, 1 орны нарийвчлал хүртэл): «+300», «−250», «0».</summary>
        public static string FormatSignedOffset(double mm)
        {
            double r = Math.Round(mm, 1);
            if (Math.Abs(r) < 0.05) return "0";
            string t = r.ToString("0.#", CultureInfo.InvariantCulture);
            return r > 0 ? "+" + t : t;
        }
    }
}
