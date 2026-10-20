using System;
using System.Threading;
using System.Threading.Tasks;

namespace RevitMcpAddin
{
    /// <summary>
    /// Суулгалтын эрүүл мэндийн тайлан (v2 §74 SELF-CHECK + REPORT HEALTH) — СЕСС ТУТАМ НЭГ УДАА.
    ///
    /// ⚠️ 2026-10-16: «MGL туслах» самбар анхдагчаар НУУГДСАН (W10).  Урьд нь тайлан ЗӨВХӨН самбар ачаалагдахад явдаг байсан тул
    ///    самбар нээгдэхгүй бол ~20 ПК-ийн «аль машин ямар хувилбартай» гэх ЦОРЫН ГАНЦ суваг тасрах байв.  Одоо App эхэлснээс
    ///    90 с дараа (Revit-ийн ачаалалтын замаас гадуур, арын thread, Revit API-гүй) ЭНЭ класс илгээнэ; самбар нээгдвэл
    ///    кэшлэгдсэн хариуг (албан бус багц / шинэчлэл / цуцлагдсан) чатад харуулна.
    /// ⚠️ ЧИМЭЭГҮЙ: сүлжээгүй / токенгүй / сервер унтарсан — бүгд хэвийн, ажлыг зогсоохгүй.  Токенгүй бол дараа нь (самбар
    ///    нээгдэх / нэвтрэх) дахин оролдох боломжтой.  Тогтмол давтахгүй (телеметр хяналт болохгүй).
    /// </summary>
    internal static class HealthReporter
    {
        private static int _state;   // 0 = хараахан, 1 = явж байна / илгээсэн
        private static Timer _timer;

        /// <summary>Серверийн сүүлийн хариу (null = хараахан ирээгүй).</summary>
        public static HealthReply LastReply { get; private set; }

        /// <summary>Хариу ирэхэд (арын thread-ээс).</summary>
        public static event Action<HealthReply> Replied;

        /// <summary>App.OnStartup — <paramref name="delay"/>-ийн дараа нэг удаа (Revit API-гүй: он/build-ийг одоо барина).</summary>
        public static void ScheduleAfterStartup(string revitYear, string revitBuild, TimeSpan delay)
        {
            if (_timer != null) return;
            _timer = new Timer(_ =>
            {
                try { _timer?.Dispose(); } catch (Exception) { }
                ReportOnce(revitYear, revitBuild);
            }, null, delay, Timeout.InfiniteTimeSpan);
        }

        /// <summary>Сесст нэг л удаа (зэрэг дуудлага давхардахгүй).  Токенгүй бол илгээхгүй, дараа дахин дуудаж болно.</summary>
        public static void ReportOnce(string revitYear, string revitBuild)
        {
            AddinSettings st;
            try { st = SettingsStore.Load(); } catch (Exception) { return; }
            if (string.IsNullOrEmpty(st.Token)) return;
            if (Interlocked.CompareExchange(ref _state, 1, 0) != 0) return;
            Task.Run(async () =>
            {
                try
                {
                    // Эрхийн түвшинг эхлээд сэргээнэ (`PostHealthAsync` кэшээс уншдаг) — амжилтгүй бол хуучин кэш.
                    await ApiClient.RefreshAuthorityLevelAsync(st.ApiHost, st.Token).ConfigureAwait(false);
                    SelfCheckResult sc = InstallCheck.Run(revitYear, revitBuild);
                    HealthReply reply = await ApiClient.PostHealthAsync(st.ApiHost, st.Token, sc).ConfigureAwait(false);
                    LastReply = reply;
                    if (reply != null) Replied?.Invoke(reply);
                }
                catch (Exception)
                {
                    // Тайлан илгээгдээгүй нь ажлыг зогсоох ЁСГҮЙ.  Дараагийн сесст дахин.
                }
            });
        }
    }
}
