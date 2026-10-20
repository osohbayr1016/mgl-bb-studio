using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using RevitMcpAddin.Smart.Core;

namespace RevitMcpAddin.ChangeImpact.Core
{
    /// <summary>Revit-д шууд зөөсний дараах шинжилгээний дүн (цонх + мэдэгдэлд) — Revit-гүй өгөгдөл.</summary>
    public sealed class NativeMoveResult
    {
        public DocumentKey Key { get; set; }
        public string DocTitle { get; set; }
        public List<long> Ids { get; set; } = new List<long>();
        public SimVec DeltaMm { get; set; }
        public SimScene Scene { get; set; }
        public SimExactResult Exact { get; set; }
        public SimReport Report { get; set; }
        public GhostScene Ghost { get; set; }
        public double ElapsedMs { get; set; }
    }

    /// <summary>«Шууд зөөлтийн» цонхны Revit-тэй харилцах гэрээ (цонх Revit API-г МЭДЭХГҮЙ).</summary>
    public interface INativeMoveSession
    {
        NativeMoveResult Result { get; }
        /// <summary>Яг −шилжилтээр буцааж зөөнө (нэг Undo).  null = амжилттай; эс бөгөөс шалтгаан.</summary>
        Task<string> RevertAsync();
        Task ShowElementAsync(long id, int slot);
        void ClearGhost();
        /// <summary>Шийдвэр гарсан — энэ зөөлтийн дараалал дууссан.</summary>
        void Settle();
        /// <summary>Энэ Revit-ийн сессэд шууд зөөлтийг шалгахаа болино / сэргээнэ.</summary>
        void SetWatchEnabled(bool enabled);
    }

    /// <summary>
    /// «Revit-д ШУУД зөөсөн» (Revit-ийн өөрийн Move, чирэлт, сумтай товч) — эзэн 2026-10-06: «3D модель дотор шууд зөөхөд шалгах».
    /// Revit-ийн API зөөлтийн ҮЙЛ ЯВДЛЫГ өгдөггүй тул: сонголт өөрчлөгдөхөд сонгосон элементүүдийн байрлалыг санаж, гүйлгээ commit болоход шинэ байрлалтай
    /// харьцуулна.  Энэ файл нь ЗӨВХӨН шилжилтийг тодорхойлох цэвэр дүрэм (Revit-гүй, тестлэгдэнэ).
    ///
    ///   • Байрлал = мм-ийн массив: цэг [x,y,z], шугам [x0,y0,z0,x1,y1,z1], эсвэл хүрээ [minX..maxZ] (`SimExactAnalyzer.LocOrBox`).
    ///   • Бүх элемент ИЖИЛ вектороор шилжсэн (≤1 мм зөрүү) бөгөөд шугам/хүрээний хоёр үзүүр ижил шилжсэн = ЦЭВЭР зөөлт.
    ///   • Эргүүлэлт, сунгалт (ханын үзүүр чирэх), өөр элемент өөр хэмжээгээр = зөөлт БИШ — шалгахгүй (хуурамч дүгнэлт гаргахгүй).
    /// </summary>
    public static class SimNativeMove
    {
        public const double ToleranceMm = 1.0;
        public const double MinMoveMm = 1.0;
        public const int MaxElements = 40;

        /// <summary>Нэг элементийн шилжилт.  null = байрлал уншигдаагүй / хэлбэр зөрсөн / цэвэр шилжилт биш (шугамын үзүүрүүд өөр).</summary>
        public static SimVec? DeltaOf(double[] before, double[] after)
        {
            if (before == null || after == null || before.Length != after.Length || (before.Length != 3 && before.Length != 6)) return null;
            var d = new SimVec(after[0] - before[0], after[1] - before[1], after[2] - before[2]);
            if (before.Length == 6)
            {
                var d2 = new SimVec(after[3] - before[3], after[4] - before[4], after[5] - before[5]);
                if ((d2 - d).Length <= ToleranceMm) return d;
                // Revit холбоотой (join) төгсгөлийг тайрч/сунгадаг: ханыг хөндлөн зөөхөд нэг үзүүр нь урт дагуугаа өөр шилждэг (Revit 2027-д хэмжсэн:
                // 800 мм хөндлөн зөөхөд нэг үзүүр 105 мм тайрагдсан).  Тиймээс урт ДАГУУХ хэсгийг тэвчиж, ХӨНДЛӨН хэсэг ижил бол зөөлт гэж үзнэ.
                var dir = new SimVec(before[3] - before[0], before[4] - before[1], before[5] - before[2]);
                double len = dir.Length;
                if (len < 1e-6) return null;
                dir = dir * (1.0 / len);
                double a1 = d.X * dir.X + d.Y * dir.Y + d.Z * dir.Z, a2 = d2.X * dir.X + d2.Y * dir.Y + d2.Z * dir.Z;
                SimVec p1 = d - dir * a1, p2 = d2 - dir * a2;
                if ((p1 - p2).Length > ToleranceMm) return null;                 // эргүүлсэн
                return p1 + dir * (Math.Abs(a1) <= Math.Abs(a2) ? a1 : a2);       // урт дагуу: бага өөрчлөгдсөн үзүүр (тайралт биш)
            }
            return d;
        }

        /// <summary>
        /// Хамтдаа зөөгдсөн элементүүдийн НИЙТ шилжилт.  `before`-д байгаа, `after`-д байгаа элементийг л харна.
        /// false = цэвэр зөөлт биш (эргүүлсэн, сунгасан, өөр өөр хэмжээгээр) эсвэл 1 мм-ээс бага.
        /// </summary>
        public static bool TryTranslation(IDictionary<long, double[]> before, IDictionary<long, double[]> after, out SimVec delta, out List<long> moved)
        {
            delta = new SimVec(0, 0, 0);
            moved = new List<long>();
            if (before == null || after == null) return false;
            SimVec? first = null;
            foreach (KeyValuePair<long, double[]> kv in before)
            {
                double[] a;
                if (!after.TryGetValue(kv.Key, out a)) continue;
                SimVec? d = DeltaOf(kv.Value, a);
                if (!d.HasValue) return false;                       // эргүүлсэн / сунгасан — бүхэлд нь шалгахгүй
                if (d.Value.Length < MinMoveMm) continue;           // энэ элемент хөдлөөгүй (өөр шалтгаанаар өөрчлөгдсөн)
                if (first.HasValue && (d.Value - first.Value).Length > ToleranceMm) return false;
                if (!first.HasValue) first = d;
                moved.Add(kv.Key);
            }
            if (!first.HasValue || moved.Count == 0 || moved.Count > MaxElements) { moved.Clear(); return false; }
            delta = first.Value;
            return true;
        }

        /// <summary>Тэмдэглэх эсэх: ямар нэг шинэ мөргөлдөөн, дагаж өөрчлөгдөх бие, өрөө/устах — өөрөөр хэлбэл хэн нэгний ажил хөндөгдсөн.</summary>
        public static bool WorthShowing(SimReport report)
        {
            if (report == null || !report.IsFinal) return false;
            return report.Lines.Any(l => l.Severity != SimSeverity.Info);
        }

        /// <summary>Зөөлт АЛЬ ХЭДИЙН хийгдсэн тул simulation-ийн «ХЯНААД ЗӨӨ» гэх мэт гарчиг тохирохгүй — шууд зөөлтийн гарчиг.</summary>
        public static string Title(MoveVerdict v)
        {
            switch (v)
            {
                case MoveVerdict.MoveOk: return "АСУУДАЛ ИЛРЭЭГҮЙ";
                case MoveVerdict.MoveWithReview: return "ХЯНАХ ШААРДЛАГАТАЙ";
                case MoveVerdict.DoNotMove: return "НОЦТОЙ ҮР ДАГАВАРТАЙ";
                default: return "БҮРЭН ШАЛГАЖ ЧАДСАНГҮЙ";
            }
        }

        /// <summary>«Та «X»-г X +1500 мм зөөлөө — Revit-ийн загвар дээр шалгав:».</summary>
        public static string Headline(string elementName, SimVec delta)
        {
            return "Та «" + (string.IsNullOrEmpty(elementName) ? "элемент" : elementName) + "»-г Revit-д " + SimNarrative.FormatOffset(delta) + " зөөлөө — загвар дээр шалгасан үр дүн:";
        }
    }
}
