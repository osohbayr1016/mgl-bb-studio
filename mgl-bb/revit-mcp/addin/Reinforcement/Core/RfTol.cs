using System;

namespace RevitMcpAddin.Reinforcement.Core
{
    /// <summary>
    /// «Арматур» хэрэгслүүдийн БҮХ хүлцэл НЭГ ГАЗАР.  Тооцоо бүр энэ тогтмолоор шалгана — «magic number»
    /// кодын дунд тархахгүй.
    ///
    /// ⚠️ Энэ хавтас (`Reinforcement/Core`) Revit, WPF-ийг ХЭЗЭЭ Ч ашиглахгүй: `tests/Reinforcement.Tests`
    /// шууд эмхэтгэдэг, мөн net48 (Revit 2024)-д орно — `Math.Clamp`, `double.IsFinite`,
    /// `Dictionary.TryAdd`, `string.Split(char)`, `GetValueOrDefault`, range/index ХЭРЭГЛЭХГҮЙ.
    /// </summary>
    public static class RfTol
    {
        /// <summary>Revit-ийн дотоод урт фут; 1 фут = 304.8 мм.</summary>
        public const double MmPerFoot = 304.8;

        /// <summary>Хоёр цэгийг «нэг» гэж үзэх зай (фут) — ≈ 0.003 мм.  Revit-ийн вертексийн нарийвчлалаас доогуур.</summary>
        public const double PointFt = 1e-5;

        /// <summary>
        /// Хэмжээсийн утгыг тооцоолсон зайтай тулгах хүлцэл (фут) = 0.5 мм.  Рантайм баталгаажуулалт: native
        /// хэмжээс үүсгээд `dim.Value`-г хүлээсэн зайтай харьцуулна; зөрүү энэ хэмжээнээс их бол хэмжээсийг
        /// ХҮЛЭЭН АВАХГҮЙ (буруу лавлагаа сонгосон гэсэн үг).
        /// </summary>
        public const double DimMatchFt = 0.5 / MmPerFoot;

        /// <summary>Хоёр чиглэл параллель: cos(≈1.15°).  Гараар зурсан хэлбэр 0.5° хүртэл хазайдаг.</summary>
        public const double ParallelCos = 0.9998;

        /// <summary>Хоёр чиглэл перпендикуляр: |cos| ≤ энэ (≈ 1.15°).</summary>
        public const double PerpendicularCos = 0.02;

        /// <summary>
        /// Хомутын хавтгайн нормаль харагдацын нормальтай «параллель» гэж үзэх доод cos = cos(15°).
        /// Огтлол нь гишүүний тэнхлэгт яг перпендикуляр биш (налуу огтлол) байж болох тул чөлөөтэй.
        /// </summary>
        public const double StirrupPlaneCos = 0.9659;

        /// <summary>
        /// Ажлын (уртааш) арматурын чиглэл харагдацын нормальтай «параллель» гэж үзэх доод cos = cos(25°).
        /// Зарим арматур бага зэрэг налуу (crank, taper) байдаг.
        /// </summary>
        public const double LongitudinalCos = 0.9063;

        /// <summary>Мм → фут.</summary>
        public static double MmToFt(double mm) { return mm / MmPerFoot; }

        /// <summary>Фут → мм.</summary>
        public static double FtToMm(double ft) { return ft * MmPerFoot; }

        /// <summary>
        /// ЦААСАН дээрх мм → загварын фут (харагдацын масштабаар үржсэн).  Хэмжээсийн зай, шошгоны зай зэрэг «цаасан мм»-ийг загварын
        /// координат руу хөрвүүлэх ГАНЦ газар — зураг ямар масштабтай ч цаасан дээр адилхан харагдана.  Масштаб ≤ 0 бол 1:100.
        /// </summary>
        public static double PaperMmToModelFt(double paperMm, int scale)
        {
            return paperMm * (scale > 0 ? scale : 100) / MmPerFoot;
        }

        /// <summary>Хоёр тоо хүлцэл дотор тэнцүү.</summary>
        public static bool Near(double a, double b, double tol) { return Math.Abs(a - b) <= tol; }

        /// <summary>NaN/Infinity биш (`double.IsFinite` нь net48-д байхгүй).</summary>
        public static bool IsFiniteNumber(double v) { return !double.IsNaN(v) && !double.IsInfinity(v); }

        /// <summary>[lo, hi] хооронд хавчина (`Math.Clamp` нь net48-д байхгүй).</summary>
        public static double Clamp(double v, double lo, double hi)
        {
            if (v < lo) return lo;
            if (v > hi) return hi;
            return v;
        }
    }
}
