using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace RevitMcpAddin.WallElevation.Core
{
    /// <summary>
    /// Үүсгэсэн харагдацын ТӨЛӨВ (2026-10-16, W03/W07) — харагдац дээр ШИНЭ хувилбартай схемд (<c>MglWallElevationState</c>, Revit давхарга
    /// <c>WeViewStateStore</c>).  Хуучин схемүүд (<c>MglWallElevation</c>, <c>MglWallElevationOverride</c>) ХӨНДӨГДӨХГҮЙ — тэдгээрийн GUID-д
    /// талбар нэмэх боломжгүй.  Бичлэг нь «түлхүүр=утга;…» мөр (хувилбар <see cref="Version"/>): танихгүй түлхүүрийг ХАДГАЛЖ дахин бичнэ
    /// (ирээдүйн хувилбарын утгыг хуучин хувилбар устгахгүй), буруу утга → өгөгдмөл.
    /// </summary>
    public sealed class WeViewState
    {
        public const int CurrentVersion = 1;

        /// <summary>Энэ хэрэгслийн СҮҮЛД тавьсан масштаб (0 = мэдэгдэхгүй — хуучин харагдац).  Гараар сольсныг ялгахад (<see cref="WeScaleRule"/>).</summary>
        public int Scale;
        /// <summary>Босоо хүрээний доод хил — өрөөний шалны дээд нүүрнээс, загварын мм (NaN = Авто).  W07.</summary>
        public double CropLowerMm = double.NaN;
        /// <summary>Босоо хүрээний дээд хил — өрөөний шалны дээд нүүрнээс, загварын мм (NaN = Авто).  W07.</summary>
        public double CropUpperMm = double.NaN;
        /// <summary>Өрөөний зориулалт (W09, <see cref="WePresetId"/>) — дахин ажиллуулахад сэргэнэ; хоосон = мэдэгдэхгүй (өмнөх хувилбар).</summary>
        public string Preset = string.Empty;
        /// <summary>Танихгүй (ирээдүйн хувилбарын) түлхүүр — дахин бичихэд хадгална.</summary>
        public readonly Dictionary<string, string> Unknown = new Dictionary<string, string>(StringComparer.Ordinal);

        public bool HasCropOverride { get { return !double.IsNaN(CropLowerMm) || !double.IsNaN(CropUpperMm); } }

        public WeViewState Clone()
        {
            var c = new WeViewState { Scale = Scale, CropLowerMm = CropLowerMm, CropUpperMm = CropUpperMm, Preset = Preset };
            foreach (KeyValuePair<string, string> kv in Unknown) c.Unknown[kv.Key] = kv.Value;
            return c;
        }

        public string Serialize()
        {
            var sb = new StringBuilder();
            sb.Append("v=").Append(CurrentVersion.ToString(CultureInfo.InvariantCulture));
            if (Scale > 0) sb.Append(";scale=").Append(Scale.ToString(CultureInfo.InvariantCulture));
            if (!double.IsNaN(CropLowerMm)) sb.Append(";lo=").Append(CropLowerMm.ToString("R", CultureInfo.InvariantCulture));
            if (!double.IsNaN(CropUpperMm)) sb.Append(";up=").Append(CropUpperMm.ToString("R", CultureInfo.InvariantCulture));
            if (WePresetId.IsKnown(Preset)) sb.Append(";preset=").Append(Preset);
            foreach (KeyValuePair<string, string> kv in Unknown)
                if (kv.Key.Length > 0 && kv.Key.IndexOfAny(new[] { ';', '=' }) < 0 && (kv.Value ?? string.Empty).IndexOf(';') < 0)
                    sb.Append(';').Append(kv.Key).Append('=').Append(kv.Value ?? string.Empty);
            return sb.ToString();
        }

        /// <summary>Хэзээ ч шидэхгүй: null/хоосон/буруу → өгөгдмөл төлөв.</summary>
        public static WeViewState Parse(string text)
        {
            var s = new WeViewState();
            if (string.IsNullOrEmpty(text)) return s;
            foreach (string part in text.Split(';'))
            {
                int eq = part.IndexOf('=');
                if (eq <= 0) continue;
                string k = part.Substring(0, eq).Trim(), v = part.Substring(eq + 1).Trim();
                switch (k)
                {
                    case "v": break;
                    case "scale":
                        int sc;
                        if (int.TryParse(v, NumberStyles.Integer, CultureInfo.InvariantCulture, out sc) && sc >= 1 && sc <= 5000) s.Scale = sc;
                        break;
                    case "lo": s.CropLowerMm = ParseMm(v); break;
                    case "up": s.CropUpperMm = ParseMm(v); break;
                    case "preset": s.Preset = WePresetId.IsKnown(v) ? v : string.Empty; break;
                    default: s.Unknown[k] = v; break;
                }
            }
            return s;
        }

        private static double ParseMm(string v)
        {
            double d;
            return double.TryParse(v, NumberStyles.Float, CultureInfo.InvariantCulture, out d) && !double.IsInfinity(d) && Math.Abs(d) <= 100000 ? d : double.NaN;
        }
    }

    /// <summary>
    /// Масштабын шийдвэр (W03, 2026-10-16): хэрэглэгчийн СОНГОСОН масштаб үүсгэх, дахин ажиллуулахад ЯГ хэвээр; хэрэгсэл хуудсанд багтаахаар ХЭЗЭЭ Ч
    /// өөрчлөхгүй.  Хэрэглэгч Revit-д гараар сольсон масштабыг дахин ажиллуулахад хадгална — тохиргоо нь сүүлд үүсгэснээс өөрчлөгдсөн үед л
    /// шинэ тохиргоо давамгайлна (хэрэглэгчийн ИЛ шийдвэр).
    /// </summary>
    public static class WeScaleRule
    {
        /// <summary>
        /// Шийдвэр: <see cref="Apply"/> = харагдацын масштаб байх ёстой утга; <see cref="KeptManual"/> = хэрэглэгчийн гараар сольсныг (эсвэл хуучин
        /// хувилбарын тохируулсныг) үлдээв; <see cref="Record"/> = төлөвт бичих «хэрэгслийн зорьсон» масштаб (үргэлж тохиргоо).
        /// </summary>
        public struct Decision
        {
            public int Apply;
            public bool KeptManual;
            public int Record;
        }

        /// <param name="current">Харагдацын одоогийн масштаб.</param>
        /// <param name="generated">Хэрэгслийн сүүлд тавьсан масштаб (<see cref="WeViewState.Scale"/>; 0 = мэдэгдэхгүй — төлөвгүй хуучин харагдац).</param>
        /// <param name="setting">Тохиргооны масштаб (энэ удаагийн).</param>
        /// <param name="created">Энэ ажиллагаанд шинээр үүссэн харагдац.</param>
        /// <param name="legacyApply">Төлөвгүй хуучин харагдацад тохиргоог хэрэглэх эсэх: дэлгээс — тийм (өмнөх хувилбар үргэлж хэрэглэдэг байсан); түлхүүр
        /// план, 3D — үгүй (өмнөх хувилбар хуудсанд багтаахаар томруулсан байж болно — дахин ажиллуулахад хуудсыг эвдэхгүй).</param>
        public static Decision Decide(int current, int generated, int setting, bool created, bool legacyApply = true)
        {
            if (setting < 1) return new Decision { Apply = current, Record = generated };
            if (created || current < 1) return new Decision { Apply = setting, Record = setting };
            if (generated < 1)
                return legacyApply ? new Decision { Apply = setting, Record = setting }
                                   : new Decision { Apply = current, KeptManual = current != setting, Record = setting };
            bool manual = current != generated;
            if (manual && setting == generated) return new Decision { Apply = current, KeptManual = true, Record = setting };
            return new Decision { Apply = setting, Record = setting };
        }
    }
}
