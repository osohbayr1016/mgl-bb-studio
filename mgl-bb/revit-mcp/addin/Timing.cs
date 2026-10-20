using System;
using System.Collections.Generic;
using System.Diagnostics;

namespace RevitMcpAddin
{
    /// <summary>
    /// ЛАТЕНТЫН ХЭМЖИЛТ.
    ///
    /// ⚠️ ЯАГААД p95 ГАНЦААРАА ХАНГАЛТГҮЙ ВЭ: p95 нь «20 удаагийн 1-д ямар
    /// байсан» гэдгийг л хэлнэ.  p50 нь ердийн туршлага, p99 ба max нь
    /// хэрэглэгч «хөлдлөө» гэж гомдох мөч, алдааны хувь нь «хэмжилт огт
    /// дуусаагүй» тохиолдол.  Тавуулаа хэрэггүй бол дүгнэлт худал гарна.
    ///
    /// ⚠️ ЭНЭ НЬ ХЭМЖИНЭ, ХЯЗГААРЛАХГҮЙ.  ChangeReport.cs-ийн Stopwatch-ууд
    /// нь төсвийн ХЯЗГААРЛАГЧ — тэдний утга хаягддаг.  Энд эсрэгээрээ:
    /// утга нь ЦОРЫН ГАНЦ бүтээгдэхүүн.
    ///
    /// ⚠️ Загварын геометр, элементийн нэр, файлын агуулга ОРОХГҮЙ —
    /// AssistantLog-ийн нууцлалын хилтэй ижил.
    /// ⚠️ Autodesk.Revit-ийн ямар ч төрөл ХЭРЭГЛЭХГҮЙ — net48 (R24) build
    /// дээр ч эмхэтгэгдэх ёстой.
    ///
    /// ⚠️ THREAD: нэг Timing объект = НЭГ урсгалын (нэг мессежийн) хэмжилт.
    /// Mark нь UI thread дээр, Set нь await-ийн дараа мөн UI thread дээр
    /// (WPF-ийн SynchronizationContext) ажиллана.  Хэд хэдэн thread-ээс
    /// ЗЭРЭГ бичихээр төлөвлөөгүй.
    /// </summary>
    internal sealed class Timing
    {
        private readonly Stopwatch _sw = Stopwatch.StartNew();
        private long _last;
        private readonly Dictionary<string, double> _marks =
            new Dictionary<string, double>(StringComparer.Ordinal);

        /// <summary>Эхнээс өнөөг хүртэлх мс.</summary>
        public double TotalMs => _sw.Elapsed.TotalMilliseconds;

        /// <summary>Өмнөх тэмдгээс хойшхи мс-ийг нэрлэж бичнэ (сегмент).</summary>
        public void Mark(string name)
        {
            long now = _sw.ElapsedTicks;
            _marks[name] = (now - _last) * 1000.0 / Stopwatch.Frequency;
            _last = now;
        }

        /// <summary>Үнэмлэхүй утга шууд бичнэ.</summary>
        public void Set(string name, double ms) { _marks[name] = ms; }

        public double? Get(string name)
        {
            double v;
            return _marks.TryGetValue(name, out v) ? (double?)v : null;
        }

        /// <summary>
        /// Бүхэл мс болгож дугуйлна — JSON жижиг байх, нарийвчлал хангалттай.
        /// null нь null хэвээр (талбар огт илгээгдэхгүй).
        /// </summary>
        public static double? Round(double? ms)
        {
            return ms.HasValue ? (double?)Math.Round(ms.Value) : null;
        }
    }
}
