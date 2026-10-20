using System;
using System.Collections.Generic;
using System.Diagnostics;

namespace RevitMcpAddin.Smart.Core
{
    /// <summary>
    /// Урт ажлын ЕРӨНХИЙ төлөв — Publish run, Clash run, Impact analysis бүгд ижил.
    /// 0 = Pending (хадгалагдсан файлд мэдэгдэхгүй утга ирвэл хамгийн аюулгүй нь).
    /// </summary>
    public enum RunStatus
    {
        Pending = 0,
        Running,
        Succeeded,
        /// <summary>Зарим нь болсон, зарим нь бүтэлгүйтсэн.</summary>
        Partial,
        Failed,
        /// <summary>Хэрэглэгч зогсоосон — Failed-ээс ЯЛГААТАЙ.</summary>
        Cancelled,
    }

    /// <summary>
    /// Ажлын ЯВЦ — «Цуглуулж байна → Нэр дэвшигч → Геометр шалгаж байна 340/1200 → Хадгалж байна».
    /// `Total` &lt;= 0 = тодорхойгүй (indeterminate).
    /// </summary>
    public sealed class JobProgress
    {
        public string Stage { get; set; }
        public int Done { get; set; }
        public int Total { get; set; }
        public string Message { get; set; }

        public double? Fraction
        {
            get { return Total > 0 ? Math.Min(1.0, Math.Max(0.0, (double)Done / Total)) : (double?)null; }
        }

        public static JobProgress Of(string stage, int done, int total, string message = null)
        {
            return new JobProgress { Stage = stage, Done = done, Total = total, Message = message };
        }
    }

    /// <summary>
    /// Шат тус бүрийн хугацааг хэмжинэ (clash: collect / candidates / geometry / save).
    /// Үр дүн нь дүрмийн «A тоо, B тоо, нэр дэвшигч, баталгаажсан, шат тутмын мс» хэмжилтэд орно.
    /// ⚠️ ЗӨВХӨН ХЭМЖИНЭ — зан төлөв өөрчлөхгүй.
    /// </summary>
    public sealed class StageTimer
    {
        private readonly Stopwatch _sw = new Stopwatch();
        private readonly Dictionary<string, long> _ms = new Dictionary<string, long>(StringComparer.Ordinal);
        private string _current;

        public void Begin(string stage)
        {
            End();
            _current = stage;
            _sw.Restart();
        }

        public void End()
        {
            if (_current == null) return;
            _sw.Stop();
            long prev;
            _ms.TryGetValue(_current, out prev);
            _ms[_current] = prev + _sw.ElapsedMilliseconds;
            _current = null;
        }

        public Dictionary<string, long> Snapshot()
        {
            End();
            return new Dictionary<string, long>(_ms, StringComparer.Ordinal);
        }
    }

    /// <summary>Тестэд цаг солих боломжтой цагийн эх сурвалж.</summary>
    public static class SmartClock
    {
        private static Func<DateTime> _now;

        public static DateTime UtcNow
        {
            get { return _now != null ? _now() : DateTime.UtcNow; }
        }

        public static void Override(Func<DateTime> now) { _now = now; }
    }
}
