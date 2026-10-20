using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;

namespace RevitMcpAddin.WallElevation.Core
{
    /// <summary>W08: дэлгээсийн гадаргуугийн дагуух харагдах шалны дээд / таазны доод нүүрийн нэг тасралтгүй хэсэг (нэг шал/тааз, нэг нүүр).</summary>
    public sealed class WeSurfaceRun
    {
        public long SlabId;
        /// <summary>Нүүрийн индекс (<see cref="WeSlabInfo.Faces"/>); −1 = хайрцгаар.</summary>
        public int Face;
        /// <summary>Гадаргуугийн дагуух дотоод x муж.</summary>
        public double X0;
        public double X1;
        /// <summary>Дотоод өндөр (y = z − frame.Origin.Z) <see cref="X0"/>, <see cref="X1"/> дээр (налуу биш бол тэнцүү).</summary>
        public double Y0;
        public double Y1;
        public bool Sloped;

        public double Length { get { return X1 - X0; } }

        public double YAt(double x)
        {
            return X1 - X0 < 1e-12 ? Y0 : Y0 + (Y1 - Y0) * (x - X0) / (X1 - X0);
        }
    }

    /// <summary>
    /// W08 (2026-10-16): шал/таазны БОДИТ гадаргуу дэлгээсийн дагуу — олон өндрийн тааз, алхамтай шал, налуу шал/тааз.  Өмнө нь шал/таазыг
    /// нэг хайрцгийн өндрөөр (шал — дээд, тааз — доод) авдаг байсан тул: (1) хоёр өөр өндрийн таазны spot level ижил x дээр төлөвлөгдөж Revit
    /// тал нүүрээ «хайж» байрлуулдаг; (2) өрөөний хэсгийг эзэлсэн тавцан (+150) «гол шал» болж шалны «0,00» өндөр алдагддаг; (3) налуу нүүрийг
    /// огт уншдаггүй (хайрцгийн хамгийн нам/өндөр цэгээр).  Энд нүүрийн хавтгайгаар (<see cref="WeSlabPlane"/>) өндрийг цэг бүрт бодно —
    /// загварт байгаа нүүрийг л; заадас, алхам ЗОХИОХГҮЙ.
    /// </summary>
    public static class WeSurfaceProfile
    {
        /// <summary>Дээжийн алхам (мм).</summary>
        public const double StepMm = 50;
        public const int MaxSamples = 400;

        /// <summary>
        /// Гадаргуугийн дагуу (дотоод x ∈ [faceLo, faceHi]) <paramref name="depth"/> гүнд (сөрөг = өрөө рүү) дээж бүрийн харагдах нүүр: тааз —
        /// хамгийн НАМ, шал — хамгийн ӨНДӨР (дэлхийн өндөр <paramref name="zMin"/>..<paramref name="zMax"/> мужид).  Нэг шал/тааз · нэг нүүрийн
        /// дараалсан дээж нэг хэсэг.
        /// </summary>
        public static List<WeSurfaceRun> Along(WeFrame f, IEnumerable<WeSlabInfo> slabs, WeSlabKind kind, double faceLo, double faceHi, double depth,
                                               double zMin, double zMax, IWeUnits u)
        {
            var runs = new List<WeSurfaceRun>();
            List<WeSlabInfo> list = slabs == null ? new List<WeSlabInfo>() : slabs.Where(s => s != null && s.Kind == kind).ToList();
            double len = faceHi - faceLo;
            if (f == null || list.Count == 0 || !(len > 0)) return runs;
            if (u == null) u = new WeFixedUnits();
            int n = (int)Math.Min(MaxSamples, Math.Max(2, Math.Ceiling(len / u.MmToInternal(StepMm))));
            double step = len / n;
            WeSurfaceRun cur = null;
            for (int i = 0; i < n; i++)
            {
                double x = faceLo + (i + 0.5) * step;
                WeV3 w = f.ToWorld(x, 0, depth);
                WeSlabInfo best = null;
                double bestZ = 0;
                int bestFace = -1;
                foreach (WeSlabInfo s in list)
                {
                    double z;
                    int face;
                    if (!s.HeightAt(w, out z, out face)) continue;
                    if (z <= zMin || z >= zMax) continue;
                    bool better = best == null
                                  || (kind == WeSlabKind.Ceiling ? z < bestZ - 1e-9 : z > bestZ + 1e-9)
                                  || (Math.Abs(z - bestZ) <= 1e-9 && s.Id < best.Id);
                    if (better) { best = s; bestZ = z; bestFace = face; }
                }
                if (best == null) { cur = null; continue; }
                double y = bestZ - f.Origin.Z;
                if (cur != null && cur.SlabId == best.Id && cur.Face == bestFace) { cur.X1 = x + step / 2; cur.Y1 = y; }
                else
                {
                    cur = new WeSurfaceRun { SlabId = best.Id, Face = bestFace, X0 = x - step / 2, X1 = x + step / 2, Y0 = y, Y1 = y };
                    runs.Add(cur);
                }
            }
            // Захын өндрийг хавтгайгаас ЯГ (дээжийн төв нь хагас алхам дотор) — налуу нүүрт; хэвтээ нүүр/хайрцаг тогтмол.
            foreach (WeSurfaceRun r in runs)
            {
                WeSlabPlane pl = list.First(s => s.Id == r.SlabId).PlaneOf(r.Face);
                r.Sloped = pl != null && pl.Sloped;
                if (r.Sloped)
                {
                    WeV3 a = f.ToWorld(r.X0, 0, depth), b = f.ToWorld(r.X1, 0, depth);
                    r.Y0 = pl.ZAt(a.X, a.Y) - f.Origin.Z;
                    r.Y1 = pl.ZAt(b.X, b.Y) - f.Origin.Z;
                }
                else r.Y1 = r.Y0;
            }
            return runs;
        }

        /// <summary>Нэг шал/таазны харагдах нийт урт.</summary>
        public static double VisibleLength(IEnumerable<WeSurfaceRun> runs, long slabId)
        {
            return runs == null ? 0 : runs.Where(r => r.SlabId == slabId).Sum(r => Math.Max(0, r.Length));
        }

        /// <summary>Энэ шал/таазны харагдах бүх хэсэг налуу (босоо хэмжээсийн лавлагаа болохгүй — хэвтээ түвшинтэй зэрэгцээ биш).</summary>
        public static bool AllSloped(IEnumerable<WeSurfaceRun> runs, long slabId)
        {
            List<WeSurfaceRun> mine = runs == null ? new List<WeSurfaceRun>() : runs.Where(r => r.SlabId == slabId).ToList();
            return mine.Count > 0 && mine.All(r => r.Sloped);
        }

        /// <summary>Хэвтээ хэсгүүдийн ялгаатай өндөр (дотоод y), өсөхөөр; <paramref name="tol"/> дотор нэг.  Налуу хэсэг орохгүй.</summary>
        public static List<double> FlatHeights(IEnumerable<WeSurfaceRun> runs, double tol)
        {
            var hs = new List<double>();
            if (runs == null) return hs;
            foreach (double y in runs.Where(r => !r.Sloped).Select(r => r.Y0).OrderBy(y => y))
                if (hs.Count == 0 || y - hs[hs.Count - 1] > tol) hs.Add(y);
            return hs;
        }

        /// <summary>
        /// Spot level-ийн байрлал: энэ шал/таазны нүүр ДЭЭРХ цэг — <paramref name="preferX"/> тэр нүүр дээр байвал тэнд (өмнөх байрлал хэвээр),
        /// үгүй бол харагдах хамгийн урт хэсгийн эхнээс <paramref name="inset"/> (хэсгийн хагасаас ихгүй).  Гүнүүдийг дарааллаар оролдоно.
        /// Олдохгүй бол false (дуудагч өмнөх байрлалаараа).
        /// </summary>
        public static bool PlaceOn(WeFrame f, WeSlabInfo s, double faceLo, double faceHi, IList<double> depths, double preferX, double inset, IWeUnits u,
                                   out double x, out double y, out double depth)
        {
            x = preferX;
            y = 0;
            depth = depths != null && depths.Count > 0 ? depths[0] : 0;
            if (s == null || depths == null) return false;
            foreach (double d in depths)
            {
                List<WeSurfaceRun> runs = Along(f, new[] { s }, s.Kind, faceLo, faceHi, d, double.NegativeInfinity, double.PositiveInfinity, u);
                if (runs.Count == 0) continue;
                WeSurfaceRun at = runs.FirstOrDefault(r => preferX >= r.X0 - 1e-9 && preferX <= r.X1 + 1e-9);
                if (at != null)
                {
                    x = preferX;
                    y = at.YAt(preferX);
                }
                else
                {
                    WeSurfaceRun longest = runs.OrderByDescending(r => r.Length).ThenBy(r => r.X0).First();
                    x = longest.X0 + Math.Min(inset, longest.Length / 2);
                    y = longest.YAt(x);
                }
                depth = d;
                return true;
            }
            return false;
        }

        /// <summary>
        /// Хүнд ойлгомжтой хураангуй (мм, <paramref name="refY"/>-ээс): «Тааз 2 өөр өндөртэй: 2400 / 2700 мм», «налуу 2400 → 2900 мм».  Нэг хэвтээ
        /// өндөр бол null.
        /// </summary>
        public static string Describe(string what, IEnumerable<WeSurfaceRun> runs, double refY, IWeUnits u)
        {
            List<WeSurfaceRun> list = runs == null ? new List<WeSurfaceRun>() : runs.ToList();
            if (list.Count == 0) return null;
            if (u == null) u = new WeFixedUnits();
            Func<double, string> mm = ft => Math.Round(u.InternalToMeters(ft - refY) * 1000).ToString(CultureInfo.InvariantCulture);
            double tol = u.MmToInternal(5);
            // Налуу хавтгай боловч ЭНЭ дэлгээсийн дагуу тогтмол өндөртэй (налуу нь харах чиглэлд) хэсэг — энэ дэлгээст хэвтээ мэт (тэр өндрөөр).
            List<WeSurfaceRun> sloped = list.Where(r => r.Sloped && Math.Abs(r.Y1 - r.Y0) > tol).ToList();
            List<double> flat = FlatHeights(list.Where(r => !r.Sloped || Math.Abs(r.Y1 - r.Y0) <= tol)
                                                .Select(r => r.Sloped ? new WeSurfaceRun { Y0 = (r.Y0 + r.Y1) / 2, Y1 = (r.Y0 + r.Y1) / 2 } : r), tol);
            if (sloped.Count == 0 && flat.Count <= 1) return null;
            var parts = new List<string>();
            if (flat.Count > 1) parts.Add(flat.Count.ToString(CultureInfo.InvariantCulture) + " өөр өндөртэй: " + string.Join(" / ", flat.Select(mm)) + " мм");
            foreach (WeSurfaceRun r in sloped.Take(2)) parts.Add("налуу " + mm(r.Y0) + " → " + mm(r.Y1) + " мм");
            return what + " " + string.Join("; ", parts);
        }
    }
}
