using System;
using System.Diagnostics;

namespace RevitMcpAddin.WorkTracking.Core
{
    /// <summary>
    /// АВТОМАТ ЦАГ БҮРТГЭЛИЙН ДҮРЭМ — босго бүр ЗӨВХӨН энд (эзний шаардлага:
    /// «magic number-ийг тарааж бичихгүй»).
    ///
    /// Хэмжиж буй зүйл: «ажилтны ОДООГИЙН ERP таск дээр Revit-д ИДЭВХТЭЙ
    /// ажилласан хугацаа».  Хүний бүх бүтээмж БИШ; Revit-ээс гадуурх ажил БИШ.
    ///
    /// ⚠️ Тестүүд өөрийн утгатай `new TrackingPolicy { ... }` үүсгэдэг — тиймээс
    ///    property нь set-тэй.  Продакшн ЗӨВХӨН `Default`-ыг хэрэглэнэ.
    /// </summary>
    public sealed class TrackingPolicy
    {
        public static readonly TrackingPolicy Default = new TrackingPolicy();

        /// <summary>
        /// OS-ийн дохиог (Revit урд байгаа эсэх, сүүлийн оролтоос хойшхи хугацаа)
        /// хэр ойр уншихыг.  2 с — шилжилтийн нарийвчлал ≤ 2 с; дуудлага нь
        /// микросекундын өртөгтэй (Revit API хөндөхгүй).
        /// </summary>
        public TimeSpan SampleInterval { get; set; } = TimeSpan.FromSeconds(2);

        /// <summary>Сервер рүү heartbeat + хуримтлагдсан цаг илгээх давтамж.</summary>
        public TimeSpan SyncInterval { get; set; } = TimeSpan.FromSeconds(10);

        /// <summary>
        /// ИДЭВХГҮЙ БОСГО.  Сүүлийн оролтоос хойш ийм удаан юу ч дараагүй бол
        /// IDLE.  Босго хүртэлх хугацаа (бодох зуур) ИДЭВХТЭЙ гэж тоологдоно —
        /// 10:00-д зогссон хүн 10:05-д IDLE болж, 10:00–10:05 нь ажил.
        /// </summary>
        public TimeSpan IdleThreshold { get; set; } = TimeSpan.FromMinutes(5);

        /// <summary>
        /// Revit урд талаас түр алдагдахад (Windows-ийн цонх, Explorer-т файл
        /// хайх) шууд «ажиллахгүй» болгохгүй байх хүлцэл.  Үүнээс удаан бол
        /// Revit-ийн идэвхтэй цаг гэж ТООЛОХГҮЙ.
        /// </summary>
        public TimeSpan ForegroundGrace { get; set; } = TimeSpan.FromSeconds(30);

        /// <summary>
        /// Хоёр уншилтын хооронд ийм их монотон/ханын цаг өнгөрвөл (унтах горим,
        /// процесс зогссон, цаг гараар сольсон) тэр завсарт ЮУ Ч болсныг мэдэхгүй
        /// тул ТООЛОХГҮЙ.
        /// </summary>
        public TimeSpan MaxSampleGap { get; set; } = TimeSpan.FromSeconds(60);

        /// <summary>Сервер хүрэхгүй үед дахин оролдох хамгийн урт завсар.</summary>
        public TimeSpan SyncBackoffMax { get; set; } = TimeSpan.FromMinutes(2);

        /// <summary>Нэг HTTP хүсэлтийн хугацаа.  Revit-ийн UI thread хэзээ ч хүлээхгүй.</summary>
        public TimeSpan HttpTimeout { get; set; } = TimeSpan.FromSeconds(8);

        /// <summary>Revit хаагдахад сүүлийн илгээлтийг хүлээх дээд хугацаа.</summary>
        public TimeSpan ShutdownFlushTimeout { get; set; } = TimeSpan.FromSeconds(1.5);

        /// <summary>Нэг хүсэлтэд илгээх сегментийн дээд тоо.</summary>
        public int MaxSegmentsPerSync { get; set; } = 200;

        /// <summary>Нэг хүсэлтэд илгээх тайлангийн дээд тоо (тайлан бүр тусдаа POST).</summary>
        public int MaxReportsPerSync { get; set; } = 5;

        /// <summary>
        /// Офлайн дараалал хэзээ ч хязгааргүй өсөхгүй.  Сегмент нь ХУРИМТЛАЛ
        /// (нэг таск/баримт/өдөрт нэг мөр) тул энэ тоо бодит хэрэглээнд хүрэхгүй.
        /// </summary>
        public int MaxQueuedSegments { get; set; } = 5000;

        /// <summary>Сервер ийм хуучин өдрийг хүлээж авахгүй тул дараалалд ч хадгалахгүй.</summary>
        public TimeSpan MaxQueueAge { get; set; } = TimeSpan.FromDays(30);

        /// <summary>
        /// Ажлын өдрийн хил — компанийн цагийн бүс (УБ, UTC+8, зуны цаггүй).
        /// Серверийн `todayInUB()`-тэй ижил өдөр гаргах ёстой.
        /// </summary>
        public string TimeZoneId { get; set; } = "Ulaanbaatar Standard Time";
        public TimeSpan TimeZoneFallbackOffset { get; set; } = TimeSpan.FromHours(8);

        private TimeZoneInfo _tz;
        private bool _tzResolved;

        /// <summary>UTC агшны ажлын өдөр (yyyy-MM-dd).</summary>
        public string WorkDateOf(DateTime utc)
        {
            if (utc.Kind != DateTimeKind.Utc) utc = DateTime.SpecifyKind(utc, DateTimeKind.Utc);
            DateTime local;
            TimeZoneInfo tz = ResolveTz();
            local = tz != null ? TimeZoneInfo.ConvertTimeFromUtc(utc, tz) : utc + TimeZoneFallbackOffset;
            return local.ToString("yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture);
        }

        private TimeZoneInfo ResolveTz()
        {
            if (_tzResolved) return _tz;
            try { _tz = TimeZoneInfo.FindSystemTimeZoneById(TimeZoneId); }
            catch { _tz = null; }
            _tzResolved = true;
            return _tz;
        }

        public long SampleIntervalMs => (long)SampleInterval.TotalMilliseconds;
        public long IdleThresholdMs => (long)IdleThreshold.TotalMilliseconds;
        public long ForegroundGraceMs => (long)ForegroundGrace.TotalMilliseconds;
        public long MaxSampleGapMs => (long)MaxSampleGap.TotalMilliseconds;
    }

    /// <summary>
    /// МОНОТОН ЦАГ.  Үргэлжлэх хугацааг ЗӨВХӨН үүгээр хэмжинэ — Windows-ийн
    /// ханын цагийг хэрэглэгч/NTP сольж болох тул хасаж хугацаа гаргахгүй.
    /// Ханын цаг нь зөвхөн аудит, өдрийн хил, дэлгэцэнд.
    /// </summary>
    public interface ITrackingClock
    {
        /// <summary>Монотон миллисекунд (эхлэл нь ач холбогдолгүй).</summary>
        long MonotonicMs { get; }
        DateTime UtcNow { get; }
    }

    public sealed class SystemTrackingClock : ITrackingClock
    {
        public static readonly SystemTrackingClock Instance = new SystemTrackingClock();

        public long MonotonicMs
        {
            get
            {
                long ts = Stopwatch.GetTimestamp();
                // Давхар урсгалаас хамгаалж хуваахаас өмнө секунд/үлдэгдэл болгож задлана.
                long f = Stopwatch.Frequency;
                return (ts / f) * 1000 + (ts % f) * 1000 / f;
            }
        }

        public DateTime UtcNow => DateTime.UtcNow;
    }
}
