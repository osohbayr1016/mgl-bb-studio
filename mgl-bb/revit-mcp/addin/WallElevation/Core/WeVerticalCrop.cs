using System;
using System.Collections.Generic;
using System.Globalization;

namespace RevitMcpAddin.WallElevation.Core
{
    /// <summary>
    /// Дэлгээс тус бүрийн БОСОО ХҮРЭЭНИЙ тохируулга (W07, 2026-10-16) — хэрэглэгчийн ИЛ тогтоосон доод/дээд хил, загварын мм.
    /// Лавлагаа: дэлгээсийн суурь = өрөөний шал (Room-ийн доод хил: түвшин + Base Offset); хана горимд ханын суурь.  NaN = тэр тал Авто.
    /// </summary>
    public sealed class WeCropOverride
    {
        public double LowerMm = double.NaN;
        public double UpperMm = double.NaN;

        public bool IsAuto { get { return double.IsNaN(LowerMm) && double.IsNaN(UpperMm); } }

        public WeCropOverride Clone() { return new WeCropOverride { LowerMm = LowerMm, UpperMm = UpperMm }; }
    }

    /// <summary>Түлхүүр (<see cref="WePlannedElevation.Key"/>) → тохируулга.  Энэ ажиллуулалтын (цонхны) шийдвэр — файлд ХАДГАЛАГДАХГҮЙ.</summary>
    public sealed class WeCropOverrides : Dictionary<string, WeCropOverride>
    {
        public WeCropOverrides() : base(StringComparer.Ordinal) { }

        public WeCropOverrides Copy()
        {
            var c = new WeCropOverrides();
            foreach (KeyValuePair<string, WeCropOverride> kv in this) if (kv.Value != null) c[kv.Key] = kv.Value.Clone();
            return c;
        }
    }

    /// <summary>
    /// Босоо хүрээний ДҮРЭМ (Revit-гүй).  Хэрэглэгчийн тогтоосон хил:
    ///   • цонхонд энэ удаа өгсөн утга › үүсгэсэн харагдац дээр хадгалсан (<see cref="WeViewState"/>) › авто;
    ///   • хүрээ ЯГ тэр хил — тэмдэглэгээний лавлагааг багтаах гэж ч, «таазаар таслах», «дээд давхрын түвшин» хязгаараар ч өөрчлөгдөхгүй;
    ///   • хэсэгчилсэн хүрээ (ханын бүх өндрийг хамрахгүй) нь ЗОРИУД — «Босоо хүрээ ханын өндрөөс бага» алдаа БИШ, харин тогтоосон хилтэй
    ///     таарч байгаа эсэх шалгагдана (<see cref="WallElevationValidator"/>);
    ///   • дээд хил дээд давхрын түвшнээс ДЭЭШ бол дээд давхрын элемент харагдана — анхааруулга (хаахгүй, нуухгүй).
    /// </summary>
    public static class WeVerticalCrop
    {
        /// <summary>Хүрээний хамгийн бага өндөр (мм).</summary>
        public const double MinSpanMm = 100;
        /// <summary>|утга| дээд хязгаар (мм).</summary>
        public const double LimitMm = 50000;
        /// <summary>Доод хил шалнаас үүнээс доош бол доод давхрын элемент харагдаж болзошгүй (мм) — анхааруулга.</summary>
        public const double BelowFloorWarnMm = 600;

        /// <summary>Хүчингүй бол тайлбар, зөв бол null.  NaN = авто (зөв).</summary>
        public static string Problem(double lowerMm, double upperMm)
        {
            if (!double.IsNaN(lowerMm) && (double.IsInfinity(lowerMm) || Math.Abs(lowerMm) > LimitMm)) return "Доод хил ±50000 мм дотор байна";
            if (!double.IsNaN(upperMm) && (double.IsInfinity(upperMm) || Math.Abs(upperMm) > LimitMm)) return "Дээд хил ±50000 мм дотор байна";
            if (!double.IsNaN(lowerMm) && !double.IsNaN(upperMm) && upperMm - lowerMm < MinSpanMm)
                return "Дээд хил доод хилээс ядаж " + MinSpanMm.ToString("0", CultureInfo.InvariantCulture) + " мм дээр байна";
            return null;
        }

        public struct Resolved
        {
            /// <summary>Тогтоосон доод хил (мм); NaN = авто.</summary>
            public double LowerMm;
            public double UpperMm;
            /// <summary>Утга нь харагдац дээр хадгалснаас (цонхонд энэ удаа өөрчлөөгүй).</summary>
            public bool FromView;
            /// <summary>Хадгалсан/өгсөн утга хүчингүй — авто болгосон шалтгаан.</summary>
            public string Error;

            public bool Declared { get { return !double.IsNaN(LowerMm) || !double.IsNaN(UpperMm); } }
        }

        /// <param name="mine">Цонхонд энэ удаа өгсөн (null = өөрчлөөгүй).  Хоёр тал NaN = «Авто» (хадгалсныг арилгана).</param>
        /// <param name="storedLowerMm">Харагдац дээр хадгалсан доод хил (NaN = байхгүй).</param>
        /// <param name="storedUpperMm">Харагдац дээр хадгалсан дээд хил.</param>
        public static Resolved Resolve(WeCropOverride mine, double storedLowerMm, double storedUpperMm)
        {
            if (mine != null)
            {
                string p = Problem(mine.LowerMm, mine.UpperMm);
                if (p != null) return new Resolved { LowerMm = double.NaN, UpperMm = double.NaN, Error = p };
                return new Resolved { LowerMm = mine.LowerMm, UpperMm = mine.UpperMm };
            }
            string sp = Problem(storedLowerMm, storedUpperMm);
            if (sp != null)
                return new Resolved { LowerMm = double.NaN, UpperMm = double.NaN, Error = "Харагдац дээр хадгалсан босоо хүрээ хүчингүй (" + sp + ") — авто" };
            var r = new Resolved { LowerMm = storedLowerMm, UpperMm = storedUpperMm };
            r.FromView = r.Declared;
            return r;
        }

        /// <summary>
        /// Хайрцгийн босоо хилийг тогтоосон утгаар (дотоод y = z − frame.Origin.Z; суурь = frame.Origin.Z).  NaN тал хөндөгдөхгүй.
        /// false = үр дүн хүчингүй (дээд ≤ доод) — хайрцаг хөндөгдөхгүй.
        /// </summary>
        public static bool Apply(WeBox box, double lowerMm, double upperMm, IWeUnits u)
        {
            if (box == null) return false;
            if (u == null) u = new WeFixedUnits();
            double lo = double.IsNaN(lowerMm) ? box.MinY : u.MmToInternal(lowerMm);
            double hi = double.IsNaN(upperMm) ? box.MaxY : u.MmToInternal(upperMm);
            if (!(hi - lo > WeTol.Length)) return false;
            box.MinY = lo;
            box.MaxY = hi;
            return true;
        }

        /// <summary>
        /// Харах гадаргуугийн (дотоод y ∈ [0, faceHeight]) хүрээнд харагдах хэсэг.  Огтлолцолгүй бол false.
        /// </summary>
        public static bool VisiblePart(double boxMinY, double boxMaxY, double faceHeight, out double lo, out double hi)
        {
            lo = Math.Max(boxMinY, 0);
            hi = Math.Min(boxMaxY, Math.Max(0, faceHeight));
            return hi - lo > WeTol.Length;
        }

        /// <summary>Тайланд: «доод −150 · дээд 2400 мм» (авто тал — «авто»).</summary>
        public static string Describe(double lowerMm, double upperMm)
        {
            return "доод " + Mm(lowerMm) + " · дээд " + Mm(upperMm) + (double.IsNaN(lowerMm) && double.IsNaN(upperMm) ? string.Empty : " мм");
        }

        public static string Mm(double v)
        {
            return double.IsNaN(v) ? "авто" : Math.Round(v).ToString("0", CultureInfo.InvariantCulture);
        }

        /// <summary>Цонхны талбарын бичвэр → мм (хоосон / «авто» = NaN).  Буруу бол false.</summary>
        public static bool TryParseField(string text, out double mm)
        {
            mm = double.NaN;
            string t = (text ?? string.Empty).Trim();
            if (t.Length == 0 || string.Equals(t, "авто", StringComparison.OrdinalIgnoreCase) || string.Equals(t, "auto", StringComparison.OrdinalIgnoreCase)) return true;
            t = t.Replace(',', '.').Replace(" ", string.Empty).Replace("мм", string.Empty).Replace("mm", string.Empty).Replace('−', '-');
            double d;
            if (!double.TryParse(t, NumberStyles.Float, CultureInfo.InvariantCulture, out d) || double.IsNaN(d) || double.IsInfinity(d)) return false;
            mm = d;
            return true;
        }
    }
}
