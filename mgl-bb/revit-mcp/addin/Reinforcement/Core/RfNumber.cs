using System;
using System.Globalization;

namespace RevitMcpAddin.Reinforcement.Core
{
    /// <summary>
    /// Хэрэглэгчийн бичсэн тоог (диалогийн талбар) уншина — Revit/WPF-гүй, тестлэгдсэн.
    /// Таслал/цэг хоёуланг, Unicode хасах тэмдэг (U+2212 «−», диалогийн тайлбараас хуулсан) ба урт зураас (U+2013) хүлээн авна;
    /// NaN / Infinity / хэт том утгыг ЗӨВШӨӨРӨХГҮЙ (тохиргооны JSON-д бичигдэхгүй, өнцөг чимээгүй 0 болохоос сэргийлнэ).
    /// </summary>
    public static class RfNumber
    {
        public static bool TryParse(string text, out double value)
        {
            value = 0;
            if (string.IsNullOrWhiteSpace(text)) return false;
            string t = text.Trim().Replace(',', '.').Replace('−', '-').Replace('–', '-');
            double v;
            if (!double.TryParse(t, NumberStyles.Float, CultureInfo.InvariantCulture, out v)) return false;
            if (!RfTol.IsFiniteNumber(v)) return false;
            value = v;
            return true;
        }
    }
}
