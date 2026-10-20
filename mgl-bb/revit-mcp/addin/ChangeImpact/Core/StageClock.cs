using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;

namespace RevitMcpAddin.ChangeImpact.Core
{
    /// <summary>
    /// Шатны ҮНЭН хугацаа (мс) — ЦЭВЭР.  Өмнө нь `StageMs[...] = sw.ElapsedMilliseconds` гэж НАРИЙВЧЛАЛ БУС (хуримтлагдсан) утгыг шатны
    /// хугацаа мэт хадгалдаг байв: `move` нь before+move, `rollback` нь before+move+rollback болж хэмжилт оновчлолд ашиглагдахгүй байв.
    ///
    ///   Measure("before_capture", () => …)  — яг тэр шат дахь хугацааг л нэмнэ (нэг шат давтагдвал нийлбэр).
    ///   Mark("first_result")                — ЭХЭЛСЭНЭЭС хойших хугацааны ТЭМДЭГ (шат БИШ; «эхний хариу хүртэл» гэх мэт).
    ///
    /// ЛОКАЛ ЛОГ ЗӨВХӨН — гадагш юу ч явуулахгүй.
    /// </summary>
    public sealed class StageClock
    {
        private readonly Stopwatch _total = Stopwatch.StartNew();
        private readonly Dictionary<string, long> _stages = new Dictionary<string, long>(StringComparer.Ordinal);
        private readonly Dictionary<string, long> _marks = new Dictionary<string, long>(StringComparer.Ordinal);
        private readonly object _gate = new object();

        /// <summary>Шатны хугацааг ЭНЭ дуудлагын хугацаагаар хэмжиж нэмнэ.  Алдаа шидвэл ч хугацааг бүртгэнэ.</summary>
        public T Measure<T>(string stage, Func<T> work)
        {
            var sw = Stopwatch.StartNew();
            try { return work(); }
            finally { Add(stage, sw.ElapsedMilliseconds); }
        }

        public void Measure(string stage, Action work)
        {
            var sw = Stopwatch.StartNew();
            try { work(); }
            finally { Add(stage, sw.ElapsedMilliseconds); }
        }

        /// <summary>Гаднаас хэмжсэн (жишээ нь Stopwatch-ийн ялгаа) шатны хугацаа нэмнэ.</summary>
        public void Add(string stage, long ms)
        {
            if (string.IsNullOrEmpty(stage) || ms < 0) return;
            lock (_gate)
            {
                long cur;
                _stages.TryGetValue(stage, out cur);
                _stages[stage] = cur + ms;
            }
        }

        /// <summary>Эхэлснээс хойшхи хугацааны тэмдэг (нэг нэрээр ЭХНИЙ тэмдэг л хадгалагдана — «эхний хариу»).</summary>
        public void Mark(string mark)
        {
            if (string.IsNullOrEmpty(mark)) return;
            lock (_gate)
            {
                if (!_marks.ContainsKey(mark)) _marks[mark] = _total.ElapsedMilliseconds;
            }
        }

        public long TotalMs { get { return _total.ElapsedMilliseconds; } }

        /// <summary>Шатууд (нэмэгдэх нийлбэр) + тэмдгүүд + `total` — нэг толь.  Шатны нийлбэр ≤ total (завсар хүлээлт тусдаа).</summary>
        public Dictionary<string, long> Snapshot()
        {
            lock (_gate)
            {
                var d = new Dictionary<string, long>(_stages, StringComparer.Ordinal);
                foreach (var kv in _marks) d[kv.Key] = kv.Value;
                d["total"] = _total.ElapsedMilliseconds;
                return d;
            }
        }

        /// <summary>Шатуудын (тэмдэг, `total`-гүй) нийлбэр.</summary>
        public long StagesSumMs()
        {
            lock (_gate) return _stages.Values.Sum();
        }

        /// <summary>Нэг толийг нөгөөд нэгтгэх (нэр давхцвал нэмнэ) — job ба sandbox-ийн хугацааг нэг тайланд.</summary>
        public static Dictionary<string, long> Merge(IEnumerable<Dictionary<string, long>> parts)
        {
            var res = new Dictionary<string, long>(StringComparer.Ordinal);
            foreach (var p in parts)
            {
                if (p == null) continue;
                foreach (var kv in p)
                {
                    long cur;
                    res.TryGetValue(kv.Key, out cur);
                    res[kv.Key] = cur + kv.Value;
                }
            }
            return res;
        }
    }
}
