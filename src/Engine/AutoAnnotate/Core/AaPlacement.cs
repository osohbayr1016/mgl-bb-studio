using System;
using System.Globalization;

namespace RevitMcpAddin.AutoAnnotate.Core
{
    /// <summary>
    /// Арматурын тэмдэглэгээний БАЙРЛАЛЫН тохиргоо (Revit-гүй, тестлэгдсэн) — дам нуруу, багана хоёуланд ИЖИЛ.  Бүх утга ЦААСАН дээрх мм
    /// (хэрэгсэл өөрөөсөө зай нэмэхгүй); загварын фут руу хөрвүүлэх нь <see cref="ToFt"/> ганц газар.
    ///
    /// ⚠️ Энэ хавтас (`AutoAnnotate/Core`) Revit, WPF-ийг ХЭЗЭЭ Ч ашиглахгүй — net48-д ч эмхэтгэгдэнэ (Math.Clamp, double.IsFinite ХЭРЭГЛЭХГҮЙ).
    /// </summary>
    public sealed class AaPlacement
    {
        /// <summary>Элементээс (дам нуруу/багана) шошгоны ЭХНИЙ эгнээ хүртэл.</summary>
        public double HostOffsetMm;

        /// <summary>Хөрш шошгоны ХАРАГДАХ зай.</summary>
        public double TagGapMm;

        /// <summary>Хэмжээсийн эгнээ хоорондын зай.</summary>
        public double DimPitchMm;

        /// <summary>Огтлолын хэмжээс гишүүнээс.</summary>
        public double SectionDimOffsetMm;

        /// <summary>Элементээс хомутын MRA-ийн хэмжээсийн шугам хүртэл.  0 = автомат.</summary>
        public double StirrupDimOffsetMm;

        /// <summary>Шошгоны leader-ийн 3→2 (шошгоны ирмэгээс elbow хүртэл хэвтээ) ба 2→1 (elbow-оос арматур хүртэлх налуу хэсгийн хэвтээ зай).  0 = Revit-ийн автомат.</summary>
        public double LeaderLandingMm, LeaderRunMm;

        public const double HostOffsetMax = 60, TagGapMax = 40, DimPitchMin = 2, DimPitchMax = 40,
            SectionDimOffsetMin = 3, SectionDimOffsetMax = 40, StirrupDimOffsetMax = 100, LeaderMax = 100;

        /// <summary>
        /// «Цаасан мм»-ийг (оруулсан бичвэр) уншина: «,» нь аравтын таслал, NaN/Infinity/сөрөг/хэт том утга ТАТГАЛЗАНА — хэмжээсийг км-ийн цаана
        /// тавьчихгүй, цонх унахгүй.
        /// </summary>
        public static bool TryParseMm(string text, double min, double max, out double value)
        {
            value = 0;
            string s = (text ?? string.Empty).Trim().Replace(',', '.').Replace('−', '-');
            double v;
            if (!double.TryParse(s, NumberStyles.Float, CultureInfo.InvariantCulture, out v)) return false;
            if (double.IsNaN(v) || double.IsInfinity(v)) return false;
            if (v < min || v > max) return false;
            value = v;
            return true;
        }

        /// <summary>Цаасан мм → загварын фут (харагдацын масштабаар).  Нэгжийн хөрвүүлэлтийн ГАНЦ газар: 1 фут = 304.8 мм.</summary>
        public static double ToFt(double paperMm, int scale)
        {
            return paperMm * (scale > 0 ? scale : 100) / 304.8;
        }

        /// <summary>
        /// Шалгалт: null = зөв, үгүй бол Монгол алдааны мессеж.  <paramref name="hostWord"/> = «Дам нуруунаас» / «Баганаас» / «Элементээс».
        /// </summary>
        public string Validate(string hostWord, bool needSection)
        {
            string w = string.IsNullOrEmpty(hostWord) ? "Элементээс" : hostWord;
            if (!InRange(HostOffsetMm, 0, HostOffsetMax)) return w + " шошго хүртэлх зай 0–" + HostOffsetMax + " мм байна.";
            if (!InRange(TagGapMm, 0, TagGapMax)) return "Шошго хоорондын зай 0–" + TagGapMax + " мм байна.";
            if (!InRange(DimPitchMm, DimPitchMin, DimPitchMax)) return "Хэмжээсийн эгнээ хоорондын зай " + DimPitchMin + "–" + DimPitchMax + " мм байна.";
            if (needSection && !InRange(SectionDimOffsetMm, SectionDimOffsetMin, SectionDimOffsetMax))
                return "Огтлолын хэмжээсийн зай " + SectionDimOffsetMin + "–" + SectionDimOffsetMax + " мм байна.";
            if (!InRange(StirrupDimOffsetMm, 0, StirrupDimOffsetMax))
                return w + " хомутын хэмжээс хүртэлх зай 0–" + StirrupDimOffsetMax + " мм байна (0 = автомат).";
            if (!InRange(LeaderLandingMm, 0, LeaderMax)) return "Leader-ийн 3→2 зай 0–" + LeaderMax + " мм байна (0 = автомат).";
            if (!InRange(LeaderRunMm, 0, LeaderMax)) return "Leader-ийн 2→1 зай 0–" + LeaderMax + " мм байна (0 = автомат).";
            return null;
        }

        private static bool InRange(double v, double lo, double hi)
        {
            return !double.IsNaN(v) && !double.IsInfinity(v) && v >= lo && v <= hi;
        }

        /// <summary>
        /// Гишүүний төрлөөс хамаарсан шошгын үг: зөвхөн дам нуруу → «Дам нуруунаас», зөвхөн багана → «Баганаас», холимог/тодорхойгүй → «Элементээс».
        /// </summary>
        public static string HostWord(int beams, int columns)
        {
            if (beams > 0 && columns == 0) return "Дам нуруунаас";
            if (columns > 0 && beams == 0) return "Баганаас";
            return "Элементээс";
        }
    }
}
