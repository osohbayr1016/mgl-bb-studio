using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text;

namespace RevitMcpAddin.WallElevation.Core
{
    /// <summary>Нэг дэлгээсний тэмдэглэгээ төлөвлөх оролт (хүрээ, хайрцаг нь <see cref="Item"/>-д).</summary>
    public sealed class WeAnnoInput
    {
        public WePlannedElevation Item;
        /// <summary>Харах гадаргуугийн урт (хүрээгүй) — гадаргуу дотоод x-д [-L/2, L/2].</summary>
        public double FaceLength;
        public double FaceHeight;
        /// <summary>Тухайн өрөө/ханын түвшний өндөр (дэлхийн z).</summary>
        public double LevelZ;
        /// <summary>Хана сонгосон горим (гадаргуугийн зах ±хагас зузаанаар тодорхойгүй).</summary>
        public bool WallMode;
        public double WallWidth;
        /// <summary>Ханын биеийн дундах гүн (дотоод z) — нүхний дээд/доод ирмэгийн цэг.</summary>
        public double WallMidDepth;
        /// <summary>
        /// Хүрээний дээд хилийн ДЭЭД хязгаар (дотоод y = z − frame.Origin.Z); NaN = хязгааргүй.  Өрөөний дэлгээст = өрөөний орой дээрх
        /// эхний түвшин (<see cref="WePlanner"/>) — WE-BUG-001: дээд давхрын лавлагааг багтаах гэж хүрээг тэр түвшнээс ДЭЭШ сунгахгүй.
        /// </summary>
        public double CropTopCap = double.NaN;
        /// <summary>
        /// W07: хэрэглэгчийн ТОГТООСОН босоо хүрээ (дотоод y); NaN = тэр тал авто.  Тогтоосон хил ЯГ — лавлагааг багтаах гэж томрохгүй, таазаар
        /// таслах автомат хязгаар үйлчлэхгүй; хилээс гадуурх хэмжээс, spot, шошго хасагдана (Revit харагдахгүй геометрийг хэмжиж чадахгүй).
        /// </summary>
        public double FixedMinY = double.NaN;
        public double FixedMaxY = double.NaN;
    }

    /// <summary>
    /// Дэлгээс бүрийн ТЭМДЭГЛЭГЭЭ — ЮУГ, ХААНА.  Revit-гүй, загварт хүрэхгүй.
    ///
    /// Эзний дүрэм (2026-10-06):
    ///   • Spot level: таазны доод ирмэг; хаалганд ЗӨВХӨН дээд ирмэг; цонхонд доод ба дээд ирмэг.
    ///   • Босоо 1-р эгнээ (баруун талд, нэг гинж): шалны доод (зузаан) · шалны дээд · таазны доод · дээд хучилтын доод.
    ///   • Босоо 2-р эгнээ: давхар хоорондын өндөр (энэ түвшнээс дээд түвшин хүртэл).
    ///   • Хэвтээ (доор): ханын зах + хаалга, цонхны ирмэгийн гинж; нүхтэй бол 2-р эгнээнд нийт урт.
    ///   • Шошго, keynote — хэрэглэгчийн сонгосон элементүүд дээр.
    /// Интерьерийн жишээ (2026-10-08, 205A-F · 205G-N · 206A-G):
    ///   • Өнгөлгөөний бүсийн хил (шалны хүрээ, хавтангийн дээд) нь 1-р эгнээнд; тэгвэл гадна нь «шалнаас тааз · таазаас хучилт».
    ///   • Розетк/унтраалга/хананы гэрэл: шалнаас төв хүртэл (босоо), ойрын ханын захаас төв хүртэл (хэвтээ гинж) — дэлгээсийн ДОТОР;
    ///     шошго цэгийн дээр.
    /// Шал/таазыг зөвхөн харах гадаргууны ӨМНӨХ (харагчийн тал) бүсээс авна — ханын цаадах хөрш өрөөний тааз орохгүй.
    /// </summary>
    public static class WeAnnotationPlanner
    {
        /// <summary>Дүрмийн босго (мм).</summary>
        private const double FloorWindowMm = 600;
        private const double MinRoomHeightMm = 1800;
        private const double MinCeilingAboveFloorMm = 1000;
        private const double MinStoreyMm = 1500;
        /// <summary>Таазаар таслахад таазны дээд нүүрнээс дээш үлдээх зай (мм).</summary>
        internal const double CeilingCutMarginMm = 50;
        private const double MaxStoreyMm = 10000;
        /// <summary>Хэвтээ гинжийн хамгийн богино сегмент (цаасны мм) — <see cref="SimplifyChain"/>.</summary>
        internal const double MinChainSegPaperMm = 0.7;

        public static WeAnnotationPlan Plan(WeAnnoInput input, WeAnnoSources src, WeSettings s, IWeUnits u,
                                           out double needMinY, out double needMaxY)
        {
            var plan = new WeAnnotationPlan();
            WePlannedElevation item = input != null ? input.Item : null;
            needMinY = item != null && item.Box != null ? item.Box.MinY : 0;
            needMaxY = item != null && item.Box != null ? item.Box.MaxY : 0;
            HashSet<string> on = WeAnno.Parse(s != null ? s.Annotations : null);
            // Тэмдэглэгээ огт сонгоогүй ч ангиллын тоо (census) гарна — тэмдэглэгээ хэсэг бүр has(..)-аар хамгаалагдсан.
            if (item == null || item.Frame == null || item.Box == null || src == null || s == null)
                return plan;
            if (u == null) u = new WeFixedUnits();
            // Энэ талыг бүрдүүлэх хана (нэгтгэсэн талд хэд хэдэн) — нүх эдгээрт суусан бол орно; дундах ханаас хасна.
            var sideWalls = new HashSet<string>(item.WallUids != null && item.WallUids.Count > 0 ? item.WallUids : new List<string> { item.WallUid ?? string.Empty }, StringComparer.Ordinal);
            var sideWallIds = new HashSet<long>(item.WallIds != null && item.WallIds.Count > 0 ? item.WallIds : new List<long> { item.WallId });
            var census = new Dictionary<string, HashSet<long>>(StringComparer.Ordinal);
            Action<string, long> seen = (k, id) =>
            {
                HashSet<long> set;
                if (!census.TryGetValue(k, out set)) { set = new HashSet<long>(); census[k] = set; }
                set.Add(id);
            };
            foreach (long wid in sideWallIds) if (wid != 0) seen(WeAnno.Walls, wid);

            WeFrame f = item.Frame;
            WeBox b = item.Box;
            double oz = f.Origin.Z;
            double scale = Math.Max(1, s.Scale);
            Func<double, double> mm = v => u.MmToInternal(v);
            Func<double, double> paper = v => u.MmToInternal(v * scale);
            Func<string, string, bool> has = (row, col) => on.Contains(WeAnno.Cell(row, col));
            double half = Math.Max(0, input.FaceLength) / 2;
            double faceLo = -half, faceHi = half;

            // ── Түвшин ───────────────────────────────────────────────
            WeLevelInfo cur = src.Levels.Where(l => l.Z <= input.LevelZ + mm(300)).OrderByDescending(l => l.Z).ThenBy(l => l.Id).FirstOrDefault();
            WeLevelInfo next = cur == null ? null : src.Levels
                .Where(l => l.Z > cur.Z + mm(MinStoreyMm) && l.Z <= cur.Z + mm(MaxStoreyMm))
                .OrderBy(l => l.Z).ThenBy(l => l.Id).FirstOrDefault();
            double floorRef = cur != null ? cur.Z : input.LevelZ;
            // Spot level-ийн «Relative Base» (2026-10-14): өрөөний давхрын host түвшин — шал «0,00», тааз шалнаас.
            if (cur != null)
            {
                plan.BaseLevelId = cur.Id;
                plan.BaseLevelName = cur.Name;
                if (Math.Abs(cur.Z - input.LevelZ) > mm(300))
                    plan.Notes.Add("Өрөөний давхрын өндөрт host загварт түвшин алга — spot level «" + cur.Name + "»-ээс тоологдоно");
            }

            // ── Харагчийн талын бүс (гадаргуунаас cut plane хүртэл) — шал, тааз эндээс ──
            double inset = mm(50);
            double xLo = faceLo + inset, xHi = faceHi - inset;
            if (xHi <= xLo) { xLo = faceLo; xHi = faceHi; }
            double depth = Math.Max(Math.Abs(b.Near), mm(1));
            WeFootprint front = WeFootprint.Of(f.ToWorld((xLo + xHi) / 2, 0, -depth / 2), f.Right, f.ViewDirection,
                                               new WeV3((xHi - xLo) / 2, 1e6, depth / 2));
            Func<WeSlabInfo, bool> inFront = sl =>
            {
                // Контуртай: гадаргуугийн өмнөх зурваст нүүр нь БОДИТООР байгаа эсэх (L хэлбэрийн таазны хайрцаг өрөөг хамардаг).
                if (sl.Faces != null && sl.Faces.Count > 0) return CoveredSpans(f, sl, xLo, xHi, u, depth / 2).Count > 0;
                var c = new WeV3((sl.Min.X + sl.Max.X) / 2, (sl.Min.Y + sl.Max.Y) / 2, 0);
                var h = new WeV3((sl.Max.X - sl.Min.X) / 2, 1e6, (sl.Max.Y - sl.Min.Y) / 2);
                return WeFootprint.Of(c, new WeV3(1, 0, 0), new WeV3(0, 1, 0), h).Overlaps(front, 0);
            };

            List<WeSlabInfo> floors = src.Slabs.Where(sl => sl.Kind == WeSlabKind.Floor && inFront(sl)).ToList();
            List<WeSlabInfo> floorCands = floors.Where(sl => Math.Abs(sl.Max.Z - floorRef) <= mm(FloorWindowMm)).ToList();
            WeSlabInfo top = floorCands.OrderByDescending(sl => sl.Max.Z).ThenBy(sl => sl.Id).FirstOrDefault();
            // W08 (2026-10-16): гадаргуугийн дагуух БОДИТ шал (300 мм-т) — хамгийн өндөр нь биш, ихэнх хэсэгт харагдах нь гол шал.  Өрөөний
            // хэсгийг эзэлсэн тавцан (+150) өмнө нь «гол шал» болж «0,00» өндөр алдагддаг байсан; одоо тэр нь АЛХАМ (тусдаа spot level).
            double floorDepth = Math.Max(b.Near, -mm(300));
            List<WeSurfaceRun> floorRuns = WeSurfaceProfile.Along(f, floorCands, WeSlabKind.Floor, xLo, xHi, floorDepth,
                                                                  floorRef - mm(FloorWindowMm) - mm(1), floorRef + mm(FloorWindowMm) + mm(1), u);
            if (floorRuns.Count > 0)
                top = floorCands.OrderByDescending(sl => Math.Round(WeSurfaceProfile.VisibleLength(floorRuns, sl.Id) / mm(10)))
                                .ThenByDescending(sl => sl.Max.Z).ThenBy(sl => sl.Id).FirstOrDefault();
            double floorTopZ = top != null ? top.Max.Z : floorRef;
            double upperLimit = next != null ? next.Z + mm(FloorWindowMm) : oz + b.MaxY + mm(2000);
            WeSlabInfo slab = floors.Where(sl => sl.Min.Z > floorTopZ + mm(MinRoomHeightMm) && sl.Min.Z <= upperLimit)
                                    .OrderBy(sl => sl.Min.Z).ThenBy(sl => sl.Id).FirstOrDefault();
            double ceilLimit = slab != null ? slab.Min.Z - mm(5) : upperLimit;
            var ceilings = new List<WeSlabInfo>();
            List<WeSlabInfo> ceilCands = src.Slabs.Where(sl => sl.Kind == WeSlabKind.Ceiling && inFront(sl)
                                                               && sl.Min.Z > floorTopZ + mm(MinCeilingAboveFloorMm) && sl.Min.Z < ceilLimit)
                                                  .OrderBy(sl => sl.Min.Z).ThenBy(sl => sl.Id).ToList();
            foreach (WeSlabInfo c in ceilCands) seen(WeAnno.Ceilings, c.Id);
            if (s.DimGrouping == WeDimGrouping.Combined)
            {
                // 2026-10-06-ны зан төлөв (legacy): ялгаатай өндөр бүр.
                foreach (WeSlabInfo c in ceilCands)
                    if (!ceilings.Any(x => Math.Abs(x.Min.Z - c.Min.Z) < mm(5))) ceilings.Add(c);
            }
            else ceilings = MainCeilings(f, ceilCands, faceLo, faceHi, u);
            // W08: таазны бодит доод нүүр гадаргуугийн дагуу (олон өндөр, налуу) + spot level бүрийг ӨӨРИЙН нүүр дээр (өмнө нь бүгд нэг x дээр
            // төлөвлөгдөж Revit тал нүүрээ хайж байрлуулдаг байсан).
            List<WeSurfaceRun> ceilRuns = WeSurfaceProfile.Along(f, ceilCands, WeSlabKind.Ceiling, xLo, xHi, Math.Max(b.Near, -mm(300)),
                                                                 floorTopZ + mm(MinCeilingAboveFloorMm), ceilLimit, u);
            var ceilSpotAt = new Dictionary<long, double[]>();
            {
                double prefX = Math.Min(faceLo + mm(250), (faceLo + faceHi) / 2);
                var depths = new List<double> { b.Near / 2 };
                foreach (double dmm in new[] { 50.0, 300.0, 600.0 }) if (-mm(dmm) >= b.Near) depths.Add(-mm(dmm));
                foreach (WeSlabInfo c in ceilings)
                {
                    double sx, sy, sd;
                    if (WeSurfaceProfile.PlaceOn(f, c, xLo, xHi, depths, prefX, mm(250), u, out sx, out sy, out sd)) ceilSpotAt[c.Id] = new[] { sx, sy, sd };
                }
            }
            Func<WeSlabInfo, bool> slopedCeiling = c => WeSurfaceProfile.AllSloped(ceilRuns, c.Id);
            if (top != null) seen(WeAnno.Floors, top.Id);
            if (slab != null) seen(WeAnno.Floors, slab.Id);

            // ── Таазны ДЭЭР трибун/шат (эзний шийдвэр 2026-10-14) → хүрээ таазаар тасарна ──
            // ХЭМЖСЭН (MAX ӨРГӨӨ 153 АЦӨ): тааз 1.20–1.82 м, хүрээ дээд давхар (4.0 м) хүртэл тул таазны дээрх трибун, 28 суудал дэлгээст
            // харагдаж байв; оффисын жишиг таазаар тасалдаг.  Энгийн өрөөнд (таазны дээр зөвхөн дээд давхрын хучилт) хэвээр — давхар хоорондын
            // хэмжээс, түвшин харагдсаар.  Таслахад дээд түвшин хүрээнээс гарах тул «давхар хоорондын» эгнээ, дээд түвшний лавлагаа хасагдана.
            double cutY = double.NaN;
            if (ceilCands.Count > 0 && next != null && double.IsNaN(input.FixedMaxY))
            {
                double ceilTop = ceilCands.Max(c => c.Max.Z), ceilBot = ceilCands.Max(c => c.Min.Z);
                Func<WeV3, WeV3, bool> boxInFront = (mn, mx) => WeFootprint.Of(new WeV3((mn.X + mx.X) / 2, (mn.Y + mx.Y) / 2, 0), new WeV3(1, 0, 0),
                                                                               new WeV3(0, 1, 0), new WeV3((mx.X - mn.X) / 2, 1e6, (mx.Y - mn.Y) / 2))
                                                                     .Overlaps(front, 0);
                string why = OverheadAbove(src, floors, boxInFront, ceilTop, ceilBot, next.Z, mm);
                if (why != null)
                {
                    cutY = ceilTop + mm(CeilingCutMarginMm) - oz;
                    plan.CeilingCutY = cutY;
                    plan.Notes.Add("Таазны дээр " + why + " — хүрээг таазаар таслав (давхар хоорондын хэмжээсгүй)");
                    next = null;
                    if (slab != null && slab.Min.Z - oz > cutY) slab = null;
                }
            }

            // ── Өнгөлгөөний бүс (шалны хүрээ, хавтан) — гадаргуу ДЭЭРХ нимгэн элементийн хэвтээ ирмэг ──
            double floorTopY = floorTopZ - oz;
            double ceilY = ceilings.Count > 0 ? ceilings[0].Min.Z - oz : slab != null ? slab.Min.Z - oz : b.MaxY;

            // ── Тод / бүдэг хэсэг (2026-10-14, интерьерийн баг 3-р тойрог; жишээ хуудас 232) ──
            // Тод = шалнаас таазны ДЭЭД нүүр хүртэл (тааз өөрөө тод), бүдэг = түүнээс дээш хүрээний орой (дээд хучилт / дээд давхрын түвшин) хүртэл.
            // Хүрээ таазаар тасарсан бол (трибун) бүдэг хэсэг алга.
            if (s.FadeMode == WeFadeMode.AboveCeiling)
            {
                if (!double.IsNaN(cutY)) { }
                else if (ceilings.Count > 0) plan.FadeFromY = ceilings.Max(c => c.Max.Z) - oz;
                else if (!input.WallMode)
                    plan.Notes.Add("Тааз олдсонгүй — дэлгээсийн дээд хэсгийг бүдэгрүүлээгүй (цонхны «Тод хэсэг» → «Шалнаас … мм хүртэл» сонгож болно)");
            }
            else if (s.FadeMode == WeFadeMode.AboveHeight)
                plan.FadeFromY = floorTopY + mm(s.FadeHeightMm);
            var bandEdges = new List<WeAnnoRef>();
            foreach (WeTaggable t in src.Taggables.OrderBy(t => t.Id))
            {
                double x0, x1, y0, y1, z0, z1;
                if (!IsFinishBand(f, t, sideWallIds, u, out x0, out x1, out y0, out y1, out z0, out z1)) continue;
                double overlap = Math.Min(x1, faceHi) - Math.Max(x0, faceLo);
                if (overlap < Math.Min(mm(300), 0.2 * (faceHi - faceLo))) continue;
                bool any = false;
                foreach (double y in new[] { y0, y1 })
                {
                    if (y <= floorTopY + mm(20) || y >= ceilY - mm(20)) continue;
                    if (bandEdges.Any(e => Math.Abs(e.Pos - y) < mm(15))) { any = true; continue; }
                    bandEdges.Add(Ref(y == y0 ? WeRefKind.ElementBottom : WeRefKind.ElementTop, t.Id, y, mm(5)));
                    any = true;
                }
                if (any) seen(WeAnno.Finishes, t.Id);
            }
            bool bands = has(WeAnno.Finishes, WeAnno.Dim) && bandEdges.Count > 0;

            // ── Босоо 1-р эгнээ: шал · (өнгөлгөөний бүс) · тааз · дээд хучилт ─────────────
            var r1 = new List<WeAnnoRef>();
            // Жишиг (MITIC ИЗД1_A2_41/42, 2026-10-08): «80 · 50 · 2670 · 1200» — давхрын түвшнээс шалны дээд, (хүрээ), гол тааз, дээд давхрын
            // түвшин хүртэл; шалны өнгөлгөөний доод ирмэг, хоёрдогч тааз гинжинд ОРОХГҮЙ (тэдгээр spot level-ээр).  Legacy (Combined) хэвээр.
            bool refChain = s.DimGrouping != WeDimGrouping.Combined;
            bool levelEnds = refChain && has(WeAnno.Levels, WeAnno.Dim) && cur != null;
            bool topSloped = top != null && WeSurfaceProfile.AllSloped(floorRuns, top.Id);
            if (topSloped) plan.Notes.Add("Налуу шал — босоо хэмжээсэнд ороогүй (хэвтээ түвшинтэй зэрэгцээ биш); өндрийг spot level-ээр шалгана уу");
            if (has(WeAnno.Floors, WeAnno.Dim))
            {
                if (top != null && !topSloped)
                {
                    // Шалны дээд нүүр түвшнээс ДЭЭР (MITIC: −20…+80 мм-ийн өнгөлгөөний шал, жишиг «0,00 · 0,08 · 80») — түвшнээс; дээд нүүр нь
                    // түвшин дээр (GATEWAY: хавтангийн зузаан харагдана, эзний 2026-10-06-ны дүрэм) — шалны доод ирмэгээс хэвээр.
                    if (levelEnds && top.Max.Z > cur.Z + mm(5) && top.Max.Z - cur.Z <= mm(FloorWindowMm)) r1.Add(Ref(WeRefKind.Level, cur.Id, cur.Z - oz, 0));
                    else r1.Add(Ref(WeRefKind.FloorBottom, top.Id, top.Min.Z - oz, mm(5)));
                    r1.Add(Ref(WeRefKind.FloorTop, top.Id, top.Max.Z - oz, mm(5)));
                }
                if (slab != null) r1.Add(Ref(WeRefKind.SlabBottom, slab.Id, slab.Min.Z - oz, mm(5)));
            }
            if (ceilings.Any(slopedCeiling))
                plan.Notes.Add("Налуу тааз — босоо хэмжээсэнд ороогүй (хэвтээ түвшинтэй зэрэгцээ биш); өндрийг spot level-ээр (налуу нүүр дээрх цэг)");
            if (has(WeAnno.Ceilings, WeAnno.Dim))
                foreach (WeSlabInfo c in refChain ? ceilings.Where(c0 => !slopedCeiling(c0)).Take(1) : ceilings.Where(c0 => !slopedCeiling(c0)))
                    r1.Add(Ref(WeRefKind.CeilingBottom, c.Id, c.Min.Z - oz, mm(5)));
            // Дээд хучилт олдоогүй (link-д) бол таазаас дээд давхрын түвшин хүртэл — жишигийн «1200».
            if (levelEnds && next != null && slab == null && r1.Count > 0 && next.Z - oz > r1.Max(x => x.Pos) + mm(50))
                r1.Add(Ref(WeRefKind.Level, next.Id, next.Z - oz, 0));
            if (bands)
            {
                // Шал/таазны ирмэгтэй давхцсан бүсийн ирмэг (≤ 15 мм) хасагдана — 0 урттай сегмент Revit-д алдаа.
                foreach (WeAnnoRef e in bandEdges)
                    if (!r1.Any(x => Math.Abs(x.Pos - e.Pos) < mm(15))) r1.Add(e);
            }
            r1 = Distinct(r1, mm(1));
            // ХЭМЖСЭН (MITIC 202A): шалны өнгөлгөө 5 мм, хүрээний доод 45 мм — «5 · 450» давхцсан бичвэр.
            if (s.DimGrouping != WeDimGrouping.Combined) r1 = SimplifyChain(r1, paper(MinChainSegPaperMm), true);

            double vx = b.MaxX + mm(s.DimOffsetMm);
            bool r1Placed = false;
            if (r1.Count >= 2)
            {
                plan.Rows.Add(new WeDimRow { Vertical = true, Group = WeDimGroup.Vertical1, At = vx, Refs = r1,
                                             What = bands ? "Босоо: шал, өнгөлгөөний бүс, тааз, хучилт" : "Босоо: шал, тааз, хучилт" });
                r1Placed = true;
                plan.OuterVerticalX = vx;
            }
            else if (has(WeAnno.Floors, WeAnno.Dim) || has(WeAnno.Ceilings, WeAnno.Dim) || bands)
                plan.Notes.Add("Босоо 1-р эгнээ: шал, тааз, хучилтаас хэмжих хоёр ирмэг олдсонгүй");

            // ── Өнгөлгөөний бүстэй үед: шалнаас тааз хүртэл нийт (+ таазаас хучилт) — жишээ хуудасны «2700 · 1200» ──
            // Зөвхөн давхар хоорондын эгнээ БАЙХГҮЙ үед (MAX ӨРГӨӨ 206A-G-ийн гадна гинж).  Давхар хоорондын «4000» байвал (MITIC 215A-D, 2026-10-08)
            // жишиг хоёр л эгнээтэй — нарийн гинж + 4000; гурав дахь эгнээ дэлгээсийг 7 мм өргөсгөж 4 дэлгээс нэг хуудсанд багтахгүй болгосон.
            bool levelsRow = has(WeAnno.Levels, WeAnno.Dim) && cur != null && next != null;
            WeSlabInfo flatCeiling = ceilings.FirstOrDefault(c0 => !slopedCeiling(c0));
            if (bands && r1Placed && top != null && !topSloped && flatCeiling != null && !levelsRow)
            {
                var clear = new List<WeAnnoRef> { Ref(WeRefKind.FloorTop, top.Id, floorTopY, mm(5)), Ref(WeRefKind.CeilingBottom, flatCeiling.Id, flatCeiling.Min.Z - oz, mm(5)) };
                if (slab != null) clear.Add(Ref(WeRefKind.SlabBottom, slab.Id, slab.Min.Z - oz, mm(5)));
                clear = Distinct(clear, mm(1));
                if (clear.Count >= 2)
                {
                    vx += mm(s.DimStepMm);
                    plan.Rows.Add(new WeDimRow { Vertical = true, Group = WeDimGroup.ClearHeight, At = vx, Refs = clear, What = "Босоо: шалнаас тааз хүртэл" });
                    plan.OuterVerticalX = vx;
                }
            }

            // ── Босоо 2-р эгнээ: давхар хоорондын ─────────────────────
            var r2 = new List<WeAnnoRef>();
            if (has(WeAnno.Levels, WeAnno.Dim))
            {
                if (cur != null && next != null)
                {
                    r2.Add(Ref(WeRefKind.Level, cur.Id, cur.Z - oz, 0));
                    r2.Add(Ref(WeRefKind.Level, next.Id, next.Z - oz, 0));
                    double x2 = vx + (r1Placed ? mm(s.DimStepMm) : 0);
                    plan.Rows.Add(new WeDimRow { Vertical = true, Group = WeDimGroup.Vertical2, At = x2, Refs = r2, What = "Давхар хоорондын" });
                    plan.OuterVerticalX = x2;
                }
                else if (double.IsNaN(cutY))
                    plan.Notes.Add(cur == null ? "Энэ давхрын түвшин олдсонгүй — давхар хоорондын хэмжээсгүй"
                                               : "Дээд давхрын түвшин олдсонгүй — давхар хоорондын хэмжээсгүй");
            }

            // ── Хүрээг босоо лавлагаануудыг багтаах хэмжээгээр томруулна (харагдахгүй нүүрийг Revit хэмжихгүй) ──
            var ys = new List<double>();
            foreach (WeDimRow r in plan.Rows) ys.AddRange(r.Refs.Select(x => x.Pos));
            if (has(WeAnno.Ceilings, WeAnno.Spot))
            {
                ys.AddRange(ceilings.Select(c => c.Min.Z - oz));
                ys.AddRange(ceilSpotAt.Values.Select(v => v[1]));
            }
            if (slab != null && r1.Any(x => x.Kind == WeRefKind.SlabBottom)) ys.Add(slab.Max.Z - oz);
            if (ys.Count > 0)
            {
                needMinY = Math.Min(b.MinY, ys.Min() - mm(100));
                needMaxY = Math.Max(b.MaxY, ys.Max() + mm(100));
            }
            // WE-BUG-001 (release gate, 2026-10-13): дээд түвшний лавлагаа + 100 мм нь дээд айлын шал, тавилга, хананы ёроолыг дэлгээст
            // оруулдаг байв.  Хүрээ дээд түвшин дээр ЯГ зогсоход түвшин харагдсаар, «давхар хоорондын» хэмжээс зурагдсаар (Revit 2024/2027
            // live хэмжилт DIAG-CROP-AT-LEVEL-101: түвшин 4/4 дэлгээст, хэмжээс 4/4, дээд давхрын элемент 31 → 4 — үлдсэн нь түвшнээс 30 мм ДООШ цухуйсан дам нуруу, бодитоор доод давхарт байгаа).
            if (!double.IsNaN(input.CropTopCap)) needMaxY = Math.Min(needMaxY, input.CropTopCap);
            if (!double.IsNaN(cutY)) needMaxY = Math.Min(needMaxY, cutY);
            // W07: хэрэглэгчийн тогтоосон хил ЯГ (гадуурх лавлагааг доор хасна).
            if (!double.IsNaN(input.FixedMinY)) needMinY = input.FixedMinY;
            if (!double.IsNaN(input.FixedMaxY)) needMaxY = input.FixedMaxY;

            // ── Нүх (хаалга, цонх) — энэ талын ХАНАНУУДАД суусан, гадаргуун дотор ─
            var openings = new List<Opening>();
            foreach (WeInsertInfo ins in src.Inserts)
            {
                if (!sideWalls.Contains(ins.HostWallUid ?? string.Empty)) continue;
                WeV3 lc = f.ToLocal(ins.Center);
                if (lc.X < faceLo - mm(1) || lc.X > faceHi + mm(1)) continue;
                // W07: тогтоосон босоо хүрээнээс бүхэлдээ гадуур — харагдахгүй (ирмэгийг нь хэмжиж/шошголж чадахгүй).
                if (!InFixedBand(input, ins.BottomZ - oz, ins.TopZ - oz, mm(1))) continue;
                openings.Add(new Opening { Info = ins, X = lc.X, Half = Math.Max(0, ins.HalfWidth), Bottom = ins.BottomZ - oz, Top = ins.TopZ - oz });
                seen(ins.Kind == WeInsertKind.Door ? WeAnno.Doors : WeAnno.Windows, ins.Id);
            }
            openings = openings.OrderBy(o => o.X).ThenBy(o => o.Info.Id).ToList();

            // ── Хэвтээ лавлагаа ангиллаар ────────────────────────────
            double endTol = input.WallMode ? Math.Max(0, input.WallWidth) / 2 + mm(60) : mm(60);
            bool walls = has(WeAnno.Walls, WeAnno.Dim);
            var hOpen = new List<WeAnnoRef>();
            var hRefr = new List<WeAnnoRef>();
            var hElem = new List<WeAnnoRef>();
            foreach (Opening o in openings)
            {
                bool want = o.Info.Kind == WeInsertKind.Door ? has(WeAnno.Doors, WeAnno.Dim) : has(WeAnno.Windows, WeAnno.Dim);
                if (!want || o.Half <= 0) continue;
                hOpen.Add(Ref(WeRefKind.InsertLeft, o.Info.Id, o.X - o.Half, mm(5)));
                hOpen.Add(Ref(WeRefKind.InsertRight, o.Info.Id, o.X + o.Half, mm(5)));
            }
            // Тэнхлэг: дэлгээсийн баруун чиглэлд перпендикуляр (харах чиглэлтэй параллель), зүсэх хавтгайг огтолсон.
            // Байрлалыг үргэлж тооцно — keynote-ийн leader тэнхлэгийн шугамтай давхцахгүйн тулд.
            var gridXs = new List<double>();
            foreach (WeGridInfo g in src.Grids.OrderBy(g => g.Id))
            {
                WeV3 dir = (g.B - g.A).Flat().Normalized();
                if (dir.IsZero || Math.Abs(dir.Dot(f.Right)) > 0.02) continue;
                WeV3 la = f.ToLocal(g.A), lb = f.ToLocal(g.B);
                if (Math.Min(la.Z, lb.Z) > b.Near + mm(1) || Math.Max(la.Z, lb.Z) < b.Near - mm(1)) continue;
                double gx = (la.X + lb.X) / 2;
                if (gx < faceLo - mm(1) || gx > faceHi + mm(1)) continue;
                gridXs.Add(gx);
                seen(WeAnno.Grids, g.Id);
                if (has(WeAnno.Grids, WeAnno.Dim)) hRefr.Add(Ref(WeRefKind.Grid, g.Id, gx, 0));
            }
            // Ангиллын элемент (дундах хана, сантехник, тавилга …) — хоёр зах.  Танилтыг (census) хэмжээсээс үл хамааран бүртгэнэ.
            foreach (WeTaggable t in src.Taggables.OrderBy(t => t.Id))
            {
                string key = t.CategoryKey ?? string.Empty;
                if (key == WeAnno.Doors || key == WeAnno.Windows) continue;
                // Цахилгаан цэг, өнгөлгөөний бүс — өөрийн хэмжээстэй (доор), доод гинжинд орохгүй.
                if (key == WeAnno.Electrical || key == WeAnno.Finishes) continue;
                // Шал/таазны зах ТУСДАА эгнээнд утгагүй (өрөөний хана хүртэл — нийт урттай давхардана).  Нэг холимог гинж (Combined) нь
                // 2026-10-06-ны хувилбартай БАЙТ-ИЖИЛ байх ёстой тул тэнд хэвээр орно (аудит: дахин ажиллуулахад бүх дэлгээс «шинэчлэгдэнэ»).
                if ((key == WeAnno.Floors || key == WeAnno.Ceilings) && s.DimGrouping != WeDimGrouping.Combined) continue;
                double x0, x1, y0, y1, z0, z1;
                if (!LocalRange(f, t, out x0, out x1, out y0, out y1, out z0, out z1)) continue;
                if (y1 < b.MinY || y0 > b.MaxY) continue;
                bool isWall = key == WeAnno.Walls;
                if (isWall)
                {
                    // Харах хана өөрөө (талын бүх хана), зах дээрх хөрш хана (= гадаргуугийн зах) орохгүй; зөвхөн гадаргуун өмнөх, дундах хана.
                    if (sideWallIds.Contains(t.Id) || x0 < faceLo + mm(20) || x1 > faceHi - mm(20)) continue;
                    if (z1 < b.Near || z0 > -mm(1)) continue;
                }
                bool clipLo = false, clipHi = false;
                if (!isWall)
                {
                    if (x1 < faceLo || x0 > faceHi || z1 < b.Near || z0 > b.Far) continue;
                    clipLo = x0 < faceLo;
                    clipHi = x1 > faceHi;
                    x0 = Math.Max(x0, faceLo);
                    x1 = Math.Min(x1, faceHi);
                }
                seen(key, t.Id);
                if (!has(key, WeAnno.Dim)) continue;
                // 2026-10-14: тавилгын бодит геометрийн бүрхүүлтэй бол байрлал ЯГ — Revit тал ≤ 3 мм-т таарсныг л авна (эс бөгөөс туслах шугам).
                bool exact = !isWall && t.HasHull;
                double tol = isWall ? mm(60) : exact ? mm(3) : mm(30);
                List<WeAnnoRef> target = isWall ? hRefr : hElem;
                WeAnnoRef left = Ref(WeRefKind.ElementLeft, t.Id, x0, tol), right = Ref(WeRefKind.ElementRight, t.Id, x1, tol);
                left.Exact = exact && !clipLo;
                right.Exact = exact && !clipHi;
                target.Add(left);
                target.Add(right);
            }

            // ── Хэвтээ эгнээ (доор) ──────────────────────────────────
            double hy = needMinY - mm(s.DimOffsetMm);
            WeAnnoRef endA = Ref(WeRefKind.FaceStart, item.WallId, faceLo, endTol), endB = Ref(WeRefKind.FaceEnd, item.WallId, faceHi, endTol);
            if (s.DimGrouping == WeDimGrouping.Combined)
            {
                // 2026-10-06-ны зан төлөв: нэг холимог гинж + (нүх/элемент байвал) нийт урт.
                var h = new List<WeAnnoRef>();
                if (walls) { h.Add(endA); h.Add(endB); }
                h.AddRange(hOpen);
                h.AddRange(hRefr);
                h.AddRange(hElem);
                h = Distinct(h, mm(1));
                if (h.Count >= 2)
                {
                    plan.Rows.Add(new WeDimRow { Vertical = false, Group = WeDimGroup.Combined, At = hy, Refs = h, What = "Хэвтээ гинж" });
                    if (walls && s.OverallRow && h.Count > 2)
                        plan.Rows.Add(new WeDimRow
                        {
                            Vertical = false, Group = WeDimGroup.Overall, At = hy - mm(s.DimStepMm),
                            Refs = new List<WeAnnoRef> { Ref(WeRefKind.FaceStart, item.WallId, faceLo, endTol), Ref(WeRefKind.FaceEnd, item.WallId, faceHi, endTol) },
                            What = "Хэвтээ нийт",
                        });
                }
            }
            else
            {
                // Эзний дүрэм (2026-10-06): ангиллыг ХОЛИХГҮЙ — дэлгээснээс гадагш: тоноглол · хаалга, цонх · хана, тэнхлэг · нийт урт.
                // Эгнээ бүр харах ханын хоёр захаар (хэмжээс сонгосон бол) хаагдана; хэрэггүй (хоосон) эгнээг алгасна.
                int rowIndex = 0;
                Action<List<WeAnnoRef>, string, string> addRow = (refs, group, what) =>
                {
                    if (refs.Count == 0) return;
                    var list = new List<WeAnnoRef>();
                    if (walls) { list.Add(Ref(WeRefKind.FaceStart, item.WallId, faceLo, endTol)); list.Add(Ref(WeRefKind.FaceEnd, item.WallId, faceHi, endTol)); }
                    list.AddRange(refs);
                    list = Distinct(list, mm(1));
                    // Цаасан дээр 0.7 мм-ээс (1:50-д 35 мм) богино сегмент — уншигдахгүй, бичвэр давхцана.
                    list = SimplifyChain(list, paper(MinChainSegPaperMm));
                    if (list.Count < 2 || (walls && list.Count == 2)) return;   // зөвхөн хоёр зах = нийт урттай давхардана
                    plan.Rows.Add(new WeDimRow { Vertical = false, Group = group, At = hy - rowIndex * mm(s.DimStepMm), Refs = list, What = what });
                    rowIndex++;
                };
                addRow(hElem, WeDimGroup.Elements, "Хэвтээ: тоноглол, тавилга");
                addRow(hOpen, WeDimGroup.Openings, "Хэвтээ: хаалга, цонх");
                addRow(hRefr, WeDimGroup.Reference, "Хэвтээ: хана, тэнхлэг");
                if (walls && (s.OverallRow || rowIndex == 0))
                    plan.Rows.Add(new WeDimRow
                    {
                        Vertical = false, Group = WeDimGroup.Overall, At = hy - rowIndex * mm(s.DimStepMm),
                        Refs = new List<WeAnnoRef> { endA, endB }, What = "Хэвтээ нийт",
                    });
            }

            // ── Spot level ───────────────────────────────────────────
            foreach (Opening o in openings)
            {
                if (o.Info.Kind == WeInsertKind.Door && has(WeAnno.Doors, WeAnno.Spot))
                    plan.Spots.Add(Spot(WeRefKind.InsertTop, o.Info.Id, o.X, o.Top, input.WallMidDepth, "Хаалганы дээд ирмэг"));
                if (o.Info.Kind == WeInsertKind.Window && has(WeAnno.Windows, WeAnno.Spot))
                {
                    plan.Spots.Add(Spot(WeRefKind.InsertBottom, o.Info.Id, o.X, o.Bottom, input.WallMidDepth, "Цонхны доод ирмэг"));
                    plan.Spots.Add(Spot(WeRefKind.InsertTop, o.Info.Id, o.X, o.Top, input.WallMidDepth, "Цонхны дээд ирмэг"));
                }
            }
            if (has(WeAnno.Floors, WeAnno.Spot) && top != null)
            {
                // Жишээ хуудас 206A-G: зүүн талд «0,00» — шалны дээд (давхраас харьцангуй spot төрлөөр, Revit давхарга).
                WeSpot sp = Spot(WeRefKind.FloorTop, top.Id, Math.Min(faceLo + mm(150), (faceLo + faceHi) / 2), top.Max.Z - oz, b.Near / 2, "Шалны дээд ирмэг");
                sp.Leader = true;
                sp.EndX = b.MinX - mm(s.DimOffsetMm);
                sp.Mirrored = true;   // «0,10 ▽———» — бичвэр тэмдгийн гадна (жишээ хуудас 232A)
                plan.Spots.Add(sp);
            }
            if (has(WeAnno.Floors, WeAnno.Spot) && top != null)
            {
                // W08: алхам (тавцан, нүхэн шал) — гол шалаас ≥ 10 мм өөр, ≥ 300 мм урт хэвтээ хэсэг бүрийн өндөрт нэг spot (тэр хэсэг дээр,
                // заагчгүй).  Налуу хэсэгт spot тавихгүй (цэгээс хамаарна) — тайлбарт.
                double mainY = top.Max.Z - oz;
                var done = new List<double>();
                foreach (WeSurfaceRun r in floorRuns.Where(r => !r.Sloped && r.Length >= mm(300)).OrderBy(r => r.X0))
                {
                    if (Math.Abs(r.Y0 - mainY) < mm(10) || done.Any(y => Math.Abs(y - r.Y0) < mm(10))) continue;
                    done.Add(r.Y0);
                    double sx = r.X0 + Math.Min(mm(150), r.Length / 2);
                    plan.Spots.Add(Spot(WeRefKind.FloorTop, r.SlabId, sx, r.Y0, floorDepth, "Шалны алхам"));
                    seen(WeAnno.Floors, r.SlabId);
                }
            }
            string floorNote = WeSurfaceProfile.Describe("Шал", floorRuns, floorRef - oz, u);
            if (floorNote != null) plan.Notes.Add((item.Label ?? item.SideLetter ?? "?") + ": " + floorNote + " (загварын нүүрээр)");
            string ceilNote = WeSurfaceProfile.Describe("Тааз", ceilRuns, floorTopY, u);
            if (ceilNote != null) plan.Notes.Add((item.Label ?? item.SideLetter ?? "?") + ": " + ceilNote + " шалнаас (загварын нүүрээр)");
            if (has(WeAnno.Ceilings, WeAnno.Spot))
                foreach (WeSlabInfo c in ceilings)
                {
                    double[] at;
                    WeSpot sp = ceilSpotAt.TryGetValue(c.Id, out at)
                        ? Spot(WeRefKind.CeilingBottom, c.Id, at[0], at[1], at[2], "Таазны доод ирмэг")
                        : Spot(WeRefKind.CeilingBottom, c.Id, Math.Min(faceLo + mm(250), (faceLo + faceHi) / 2), c.Min.Z - oz, b.Near / 2, "Таазны доод ирмэг");
                    // Тэмдгийг хүрээний гадна, зүүн талд (жишээ зургийн хэлбэр) — leader-ээр, бичвэр тэмдгийн гадна талд (толин).
                    sp.Leader = true;
                    sp.EndX = b.MinX - mm(s.DimOffsetMm);
                    sp.Mirrored = true;
                    plan.Spots.Add(sp);
                }

            // ── Цахилгаан цэг (розетк, унтраалга, хананы гэрэл) — гадаргуу дээр, шал–таазны хооронд ─────
            var points = new List<Point>();
            foreach (WeTaggable t in src.Taggables.Where(t => t.CategoryKey == WeAnno.Electrical).OrderBy(t => t.Id))
            {
                double x0, x1, y0, y1, z0, z1;
                if (!LocalRange(f, t, out x0, out x1, out y0, out y1, out z0, out z1)) continue;
                double cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
                if (cx < faceLo || cx > faceHi) continue;
                // Таазны гэрэл (тааз дээр/дотор), шалан дээрх тоноглол орохгүй; хананд суусан (ар тал нь гадаргуунаас ≤ 400 мм).
                if (cy < floorTopY + mm(20) || cy > ceilY - mm(50)) continue;
                if (z1 < -mm(400) || z0 > mm(150)) continue;
                // Гэрэл: зөвхөн хананы (2.4 м-ээс доош, таазнаас ≥ 250 мм) — ХЭМЖСЭН (MITIC 202D): таазны гэрэлд «L-8» шошго, хэмжээс тавигдсан;
                // жишигт гэрлийн шошго 545 keynote-ийн дунд ердөө 2.
                if (t.Lighting && (cy - floorTopY > mm(2400) || y1 > ceilY - mm(250))) continue;
                points.Add(new Point { Id = t.Id, X = cx, Y = cy, HalfW = Math.Max(0, (x1 - x0) / 2), HalfH = Math.Max(0, (y1 - y0) / 2) });
                seen(WeAnno.Electrical, t.Id);
            }
            // Хэмжих «цэг» = розетк, унтраалга, хананы гэрэл (≤ 400 мм).  ХЭМЖСЭН (MITIC 219D, 2026-10-08): 4 м-ийн толины гэрлийн тууз «цэг» болж
            // босоо хэмжээс нь туузын зүүн захад (дэлгээсийн нөгөө талд) очиж хоёр хэмжээсийн бичвэр «759 83» давхцсан.  Том тоноглол шошготой хэвээр.
            List<Point> dimPoints = points.Where(pt => pt.HalfW <= mm(200) && pt.HalfH <= mm(200)).ToList();
            if (has(WeAnno.Electrical, WeAnno.Dim) && dimPoints.Count > 0)
            {
                // Ижил өндрийн (≤ 100 мм) цэгүүд нэг бүлэг: нэг босоо хэмжээс (шалнаас төв хүртэл, бүлгийн зүүн цэгийн хажууд) +
                // нэг хэвтээ гинж (ойрын ханын захаас цэг бүрийн төв хүртэл, цэгүүдийн дээгүүр).  Жишээ: «1000» босоо, «1280» хэвтээ.
                WeAnnoRef floorRef0 = top != null ? Ref(WeRefKind.FloorTop, top.Id, floorTopY, mm(5))
                                    : cur != null ? Ref(WeRefKind.Level, cur.Id, cur.Z - oz, 0) : null;
                foreach (List<Point> grp in GroupByHeight(dimPoints, mm(100)))
                {
                    Point first = grp[0];
                    if (floorRef0 != null && first.Y - floorRef0.Pos > mm(30))
                    {
                        double at = Math.Max(faceLo + paper(2), first.X - first.HalfW - paper(3));
                        plan.Rows.Add(new WeDimRow
                        {
                            Vertical = true, Group = WeDimGroup.PointHeight, At = at,
                            Refs = new List<WeAnnoRef> { floorRef0, Ref(WeRefKind.ElementCenterY, first.Id, first.Y, mm(5)) },
                            What = "Цахилгаан цэгийн өндөр",
                        });
                    }
                    double xm = grp.Average(p => p.X);
                    bool fromStart = xm - faceLo <= faceHi - xm;
                    var h = new List<WeAnnoRef> { fromStart ? Ref(WeRefKind.FaceStart, item.WallId, faceLo, endTol) : Ref(WeRefKind.FaceEnd, item.WallId, faceHi, endTol) };
                    foreach (Point pt in grp) h.Add(Ref(WeRefKind.ElementCenterX, pt.Id, pt.X, mm(5)));
                    h = Distinct(h, mm(10));
                    if (h.Count >= 2)
                        plan.Rows.Add(new WeDimRow
                        {
                            Vertical = false, Group = WeDimGroup.PointPosition, At = grp.Max(p => p.Y + p.HalfH) + paper(4),
                            Refs = h, What = "Цахилгаан цэгийн байрлал",
                        });
                }
            }
            var pointIds = new HashSet<long>(points.Select(p => p.Id));

            // ── Шошго, keynote ───────────────────────────────────────
            var anchors = new List<KeyValuePair<string, Anchor>>();
            double faceH = Math.Max(input.FaceHeight, mm(100));
            double gapX = LargestGapCenter(faceLo, faceHi, openings, gridXs, paper(6));
            Func<string, bool> wants = k => has(k, WeAnno.Tag) || has(k, WeAnno.Keynote);
            if (wants(WeAnno.Walls) && item.WallId != 0)
            {
                if (sideWallIds.Count <= 1)
                    anchors.Add(Pair(WeAnno.Walls, item.WallId, gapX, faceH * 0.6));
                else
                    // Нэгтгэсэн тал: хана БҮРД өөрийн хэсгийн нүхгүй хамгийн том завсарт (аудит: зөвхөн зангуу шошголж, тэр нь өөр хананы
                    // дээр буудаг байв — танилт «Хана 2» гэж хэлсээр).
                    foreach (long wid in sideWallIds.OrderBy(w => w == item.WallId ? 0 : 1).ThenBy(w => w))
                    {
                        WeTaggable wt = src.Taggables.FirstOrDefault(t => t.Id == wid && t.CategoryKey == WeAnno.Walls);
                        double lo = faceLo, hi = faceHi, x0, x1, y0, y1, z0, z1;
                        if (wt != null && LocalRange(f, wt, out x0, out x1, out y0, out y1, out z0, out z1)) { lo = Math.Max(faceLo, x0); hi = Math.Min(faceHi, x1); }
                        else if (wid != item.WallId) continue;
                        if (hi - lo < mm(100)) continue;
                        List<Opening> mine = openings.Where(o => o.X + o.Half > lo && o.X - o.Half < hi).ToList();
                        List<double> grids = gridXs.Where(g => g > lo && g < hi).ToList();
                        anchors.Add(Pair(WeAnno.Walls, wid, Math.Max(lo, Math.Min(hi, LargestGapCenter(lo, hi, mine, grids, paper(6)))), faceH * 0.6));
                    }
            }
            foreach (Opening o in openings)
            {
                string k = o.Info.Kind == WeInsertKind.Door ? WeAnno.Doors : WeAnno.Windows;
                if (wants(k)) anchors.Add(Pair(k, o.Info.Id, o.X, (o.Bottom + o.Top) / 2));
            }
            // Харах ханад биш, гадаргуун ӨМНӨХ хаалга (АЦӨ-ний тусгаарлах хана, урд талын хана) — нүүрээрээ харагдвал шошго төвд (жишиг 218D,
            // 227D «Х-6»; жишиг дэлгээсүүдэд хаалганы шошго 71).  Ирмэгээрээ харагдах (перпендикуляр хананы) хаалга орохгүй.
            if (wants(WeAnno.Doors) && s.DimGrouping != WeDimGrouping.Combined)
                foreach (WeInsertInfo ins in src.Inserts.Where(i => i.Kind == WeInsertKind.Door && !sideWalls.Contains(i.HostWallUid ?? string.Empty)).OrderBy(i => i.Id))
                {
                    WeTaggable dt = src.Taggables.FirstOrDefault(t => t.Id == ins.Id && t.CategoryKey == WeAnno.Doors);
                    double x0, x1, y0, y1, z0, z1;
                    if (dt == null || !LocalRange(f, dt, out x0, out x1, out y0, out y1, out z0, out z1)) continue;
                    double cx = (x0 + x1) / 2;
                    if (cx < faceLo || cx > faceHi || z1 < b.Near || z0 > -mm(1)) continue;
                    if (x1 - x0 < 1.2 * Math.Max(ins.HalfWidth, mm(300))) continue;
                    if (anchors.Any(a => a.Value.Id == ins.Id)) continue;
                    seen(WeAnno.Doors, ins.Id);
                    anchors.Add(Pair(WeAnno.Doors, ins.Id, cx, (ins.BottomZ + ins.TopZ) / 2 - oz));
                }
            if (wants(WeAnno.Ceilings))
                foreach (WeSlabInfo c in ceilings) anchors.Add(Pair(WeAnno.Ceilings, c.Id, faceLo + 0.75 * (faceHi - faceLo), c.Min.Z - oz));
            if (wants(WeAnno.Floors) && top != null)
                anchors.Add(Pair(WeAnno.Floors, top.Id, faceLo + 0.25 * (faceHi - faceLo), (top.Min.Z + top.Max.Z) / 2 - oz));
            var core = new HashSet<string>(new[] { WeAnno.Walls, WeAnno.Doors, WeAnno.Windows, WeAnno.Ceilings, WeAnno.Floors, WeAnno.Levels, WeAnno.Grids }, StringComparer.Ordinal);
            // Таазны ДЭЭРХ элемент өрөөнд биш (ХЭМЖСЭН MAX ӨРГӨӨ 153, 2026-10-13): трибуны доорх АЦӨ — тааз 1.20–1.82 м, хүрээ дээд давхар
            // (4.0 м) хүртэл тул трибун дээрх 28 суудал (2.05–3.49 м) «ЗТ-8» шошготой эгнэж байв; интерьерийн жишиг 153B-д байхгүй.  Доод нь
            // харагчийн өмнөх ХАМГИЙН ӨНДӨР таазны доод нүүрнээс дээш (тааз алга бол дээд хучилтын доод) элементийг шошголохгүй.
            double aboveY = ceilCands.Count > 0 ? ceilCands.Max(c => c.Min.Z) - oz : slab != null ? slab.Min.Z - oz : double.NaN;
            foreach (WeTaggable t in src.Taggables.OrderBy(t => t.Id))
            {
                if (core.Contains(t.CategoryKey ?? string.Empty) || !wants(t.CategoryKey ?? string.Empty)) continue;
                if (t.CategoryKey == WeAnno.Finishes) continue;
                if (!double.IsNaN(aboveY) && t.Min.Z - oz >= aboveY + mm(10)) continue;
                if (t.CategoryKey == WeAnno.Electrical)
                {
                    // Зөвхөн гадаргуу дээрх цэг (таазны гэрэл биш).  Шошго цэгийн ДЭЭР (жишээ: «Роз-1» тэмдгийн дээр) — тэмдгийг далдлахгүй.
                    Point pt = points.FirstOrDefault(p => p.Id == t.Id);
                    if (pt == null) continue;
                    anchors.Add(Pair(t.CategoryKey, t.Id, pt.X, pt.Y, pt.Y + pt.HalfH + paper(2.5)));
                    continue;
                }
                WeV3 lc = f.ToLocal((t.Min + t.Max) * 0.5);
                if (lc.X < faceLo || lc.X > faceHi || lc.Y < b.MinY || lc.Y > b.MaxY || lc.Z < b.Near || lc.Z > b.Far) continue;
                anchors.Add(Pair(t.CategoryKey, t.Id, lc.X, lc.Y));
            }

            // Шошго — элемент дээрээ (leader-гүй).  Загварт ДАВХАР орсон ижил төрлийн элемент (ХЭМЖСЭН MITIC 227F, 211A: нэг хаалга хоёр
            // instance → «X-6» хоёр удаа) — ижил ангилал, төрөл, ≤ 150 мм зайтай бол нэг шошго.
            var typeOf = new Dictionary<long, long>();
            foreach (WeTaggable t in src.Taggables) if (!typeOf.ContainsKey(t.Id)) typeOf[t.Id] = t.TypeId;
            var tagged = new List<KeyValuePair<string, Anchor>>();
            foreach (KeyValuePair<string, Anchor> a in anchors.Where(a => has(a.Key, WeAnno.Tag)))
            {
                long ty;
                bool opening = a.Key == WeAnno.Doors || a.Key == WeAnno.Windows;
                // Хаалга/цонх: ижил байрлалд (≤ 100 мм) хоёр instance — төрөл нь өөр ч ижил тэмдэгтэй (227F: зүүн/баруун хувилбар) — нэг шошго.
                if (opening && tagged.Any(o => o.Key == a.Key && o.Value.Id != a.Value.Id && Math.Abs(o.Value.X - a.Value.X) <= mm(100)))
                    continue;
                if (typeOf.TryGetValue(a.Value.Id, out ty) && ty != 0
                    && tagged.Any(o => o.Key == a.Key && o.Value.Id != a.Value.Id && typeOf.ContainsKey(o.Value.Id) && typeOf[o.Value.Id] == ty
                                       && Math.Abs(o.Value.X - a.Value.X) <= mm(150)
                                       && (opening || Math.Abs(o.Value.Y - a.Value.Y) <= mm(150))))
                    continue;
                tagged.Add(a);
                double hy2 = a.Key == WeAnno.Ceilings ? a.Value.Y - mm(250) : !double.IsNaN(a.Value.HeadY) ? a.Value.HeadY : a.Value.Y;
                plan.Tags.Add(new WeTagItem { ElementId = a.Value.Id, CategoryKey = a.Key, HeadX = a.Value.X, HeadY = hy2, AnchorX = a.Value.X, AnchorY = a.Value.Y });
            }
            // Өнгөлгөөний keynote (интерьер, жишээ 215A-D): гадаргуу дээрх нимгэн өнгөлгөөний хана → ДЭЭР («ЦАГААН ЭМУЛЬС»), шалны хүрээ
            // (wall sweep) → ДООР («МЕТАЛЛ ХАР ШАЛНЫ ХҮРЭЭ»).  Төрөл бүрээс НЭГ — харагдах хэсэг нь хамгийн өргөн элемент, нүх/тэнхлэгээс
            // чөлөөт хамгийн том завсрын төвд.  Keynote утга хоосон бол Revit давхарга алгасаж материалын тэмдэглэлд үлдээнэ.
            var finishTop = new List<KeyValuePair<string, Anchor>>();
            var finishBottom = new List<KeyValuePair<string, Anchor>>();
            if (has(WeAnno.Finishes, WeAnno.Keynote))
            {
                var best = new Dictionary<string, FinishPick>(StringComparer.Ordinal);
                foreach (WeTaggable t in src.Taggables.OrderBy(t => t.Id))
                {
                    bool sweep = t.CategoryKey == WeAnno.Finishes;
                    if (!sweep && t.CategoryKey != WeAnno.Walls) continue;   // хавтан, тавилга — өөрийн шошготой
                    double x0, x1, y0, y1, z0, z1;
                    if (!IsFinishBand(f, t, sideWallIds, u, out x0, out x1, out y0, out y1, out z0, out z1)) continue;
                    double lo = Math.Max(x0, faceLo), hi = Math.Min(x1, faceHi);
                    if (hi - lo < Math.Min(mm(300), 0.2 * (faceHi - faceLo))) continue;
                    double ylo = Math.Max(y0, floorTopY - mm(5)), yhi = Math.Min(y1, ceilY);
                    if (yhi - ylo < mm(sweep ? 10 : 100)) continue;
                    // Шалны хүрээ = доод зурвас (шалнаас ≤ 400 мм); дээд гоёлын бүс (карниз) — дээр.
                    bool below = sweep && ylo <= floorTopY + mm(400);
                    string key = (below ? "b:" : "t:") + (t.TypeId != 0 ? "t" + t.TypeId : "e" + t.Id);
                    FinishPick cur2;
                    if (best.TryGetValue(key, out cur2) && cur2.Hi - cur2.Lo >= hi - lo) continue;
                    best[key] = new FinishPick
                    {
                        Id = t.Id, Lo = lo, Hi = hi, Y = sweep ? (ylo + yhi) / 2 : ylo + 0.85 * (yhi - ylo), Below = below,
                        Blocked = openings.Where(o => o.X + o.Half > lo && o.X - o.Half < hi && o.Bottom < yhi && o.Top > ylo)
                                          .Select(o => new[] { o.X - o.Half, o.X + o.Half }).ToList(),
                    };
                }
                // Заагчийг бие биеэсээ, нүх/тэнхлэгээс хамгийн хол цэгт — нэг өндрийн бүх өргөнийг хамарсан хэд хэдэн өнгөлгөө (215D: 4 давхар
                // хавтан) нэг x дээр давхарласан заагчтай байв.  Нарийнаас нь (сонголт цөөн) эхэлнэ.
                var chosen = new List<double>();
                double clear = paper(6), step = paper(2);
                foreach (FinishPick fp in best.Values.OrderBy(v => v.Hi - v.Lo).ThenBy(v => v.Id))
                {
                    double pad = Math.Min(paper(4), (fp.Hi - fp.Lo) / 4);
                    double bestX = (fp.Lo + fp.Hi) / 2, bestScore = double.MinValue;
                    for (double x = fp.Lo + pad; x <= fp.Hi - pad + 1e-9; x += step)
                    {
                        double sc = double.MaxValue;
                        foreach (double[] o in fp.Blocked) sc = Math.Min(sc, x < o[0] ? o[0] - x : x > o[1] ? x - o[1] : -1);
                        foreach (double g in gridXs) sc = Math.Min(sc, Math.Abs(x - g) - clear);
                        foreach (double c in chosen) sc = Math.Min(sc, Math.Abs(x - c));
                        sc = Math.Min(sc, Math.Min(x - fp.Lo, fp.Hi - x));
                        if (sc > bestScore + 1e-9) { bestScore = sc; bestX = x; }
                    }
                    chosen.Add(bestX);
                    (fp.Below ? finishBottom : finishTop).Add(new KeyValuePair<string, Anchor>(WeAnno.Finishes, new Anchor { Id = fp.Id, X = bestX, Y = fp.Y }));
                }
            }

            // Keynote — хүрээний ДЭЭР, leader-ээр; ойрхон хоёрыг шатлан (давхцахгүй).
            double kBase = needMaxY + mm(s.DimOffsetMm);
            double minGap = paper(35);
            var rowLast = new List<double>();
            foreach (KeyValuePair<string, Anchor> a in anchors.Where(a => has(a.Key, WeAnno.Keynote)).Concat(finishTop)
                                                              .OrderBy(a => a.Value.X).ThenBy(a => a.Value.Id))
            {
                int row = 0;
                while (row < rowLast.Count && a.Value.X - rowLast[row] < minGap) row++;
                if (row >= 3) row = 0;
                if (row < rowLast.Count) rowLast[row] = a.Value.X; else rowLast.Add(a.Value.X);
                plan.Tags.Add(new WeTagItem
                {
                    ElementId = a.Value.Id, CategoryKey = a.Key, Keynote = true, Leader = true,
                    HeadX = a.Value.X, HeadY = kBase + row * paper(5), AnchorX = a.Value.X, AnchorY = a.Value.Y,
                });
            }
            // Шалны хүрээний keynote — хүрээний ДООР, хамгийн доод хэвтээ хэмжээсийн гадна.
            if (finishBottom.Count > 0)
            {
                double low = plan.Rows.Where(r => !r.Vertical && r.At < b.MinY).Select(r => r.At).DefaultIfEmpty(needMinY).Min();
                double bBase = Math.Min(low, needMinY) - mm(s.DimStepMm);
                var rowLastB = new List<double>();
                foreach (KeyValuePair<string, Anchor> a in finishBottom.OrderBy(a => a.Value.X).ThenBy(a => a.Value.Id))
                {
                    int row = 0;
                    while (row < rowLastB.Count && a.Value.X - rowLastB[row] < minGap) row++;
                    if (row >= 3) row = 0;
                    if (row < rowLastB.Count) rowLastB[row] = a.Value.X; else rowLastB.Add(a.Value.X);
                    plan.Tags.Add(new WeTagItem
                    {
                        ElementId = a.Value.Id, CategoryKey = a.Key, Keynote = true, Leader = true,
                        HeadX = a.Value.X, HeadY = bBase - row * paper(5), AnchorX = a.Value.X, AnchorY = a.Value.Y,
                    });
                }
            }

            if (!double.IsNaN(input.FixedMinY) || !double.IsNaN(input.FixedMaxY)) ClipToFixed(plan, input, mm(1));

            // ── Танилт (census) — ангиллын хүснэгтийн дарааллаар ─────
            foreach (WeAnno.Row r in WeAnno.Rows)
            {
                HashSet<long> ids;
                if (!census.TryGetValue(r.Key, out ids) || ids.Count == 0) continue;
                plan.Census.Add(new WeCensusEntry
                {
                    CategoryKey = r.Key, Label = r.Label, Count = ids.Count,
                    Dimensioned = has(r.Key, WeAnno.Dim), Spotted = has(r.Key, WeAnno.Spot),
                    Tagged = has(r.Key, WeAnno.Tag) || has(r.Key, WeAnno.Keynote),
                });
            }

            // Бүдэг хэсэг, улаан хүрээ (2026-10-14) нь тэмдэглэгээгүй дэлгээст ч зурагдана — тэдгээр солигдоход дэлгээс шинэчлэгдэнэ.
            plan.Digest = plan.IsEmpty && !Decorated(plan, s) ? string.Empty : Digest(plan, s);
            return plan;
        }

        // ══════════════════════════════════════════════════════════════

        /// <summary>W07: [y0, y1] хэрэглэгчийн тогтоосон босоо хүрээтэй огтлолцох уу (тогтоогоогүй тал — хязгааргүй).</summary>
        internal static bool InFixedBand(WeAnnoInput input, double y0, double y1, double tol)
        {
            if (input == null) return true;
            if (!double.IsNaN(input.FixedMinY) && Math.Max(y0, y1) < input.FixedMinY - tol) return false;
            if (!double.IsNaN(input.FixedMaxY) && Math.Min(y0, y1) > input.FixedMaxY + tol) return false;
            return true;
        }

        /// <summary>
        /// W07: тогтоосон босоо хүрээнээс гадуурх босоо лавлагаа, spot, шошгоны зангууг хасна (хоёроос цөөн лавлагаатай эгнээ бүхэлдээ); бүдэг
        /// хэсэг хүрээний дээрээс эхэлбэл арилна.  Хассан зүйлийг тэмдэглэлд — чимээгүй алдагдахгүй.
        /// </summary>
        private static void ClipToFixed(WeAnnotationPlan plan, WeAnnoInput input, double tol)
        {
            double lo = double.IsNaN(input.FixedMinY) ? double.NegativeInfinity : input.FixedMinY - tol;
            double hi = double.IsNaN(input.FixedMaxY) ? double.PositiveInfinity : input.FixedMaxY + tol;
            Func<double, bool> outside = y => y < lo || y > hi;
            int refs = 0, rows = 0;
            foreach (WeDimRow r in plan.Rows.Where(r => r.Vertical).ToList())
            {
                refs += r.Refs.RemoveAll(x => outside(x.Pos));
                if (r.Refs.Count >= 2) continue;
                plan.Rows.Remove(r);
                rows++;
            }
            int spots = plan.Spots.RemoveAll(sp => outside(sp.Y));
            int tags = plan.Tags.RemoveAll(t => outside(t.AnchorY));
            if (rows > 0 || refs > 0)
            {
                List<double> xs = plan.Rows.Where(r => r.Vertical && r.Group != WeDimGroup.PointHeight).Select(r => r.At).ToList();
                plan.OuterVerticalX = xs.Count > 0 ? xs.Max() : double.NaN;
            }
            if (!double.IsNaN(plan.FadeFromY) && plan.FadeFromY >= hi - tol) plan.FadeFromY = double.NaN;
            var parts = new List<string>();
            if (rows > 0) parts.Add(rows.ToString(CultureInfo.InvariantCulture) + " хэмжээсийн эгнээ");
            if (refs > 0 && rows == 0) parts.Add(refs.ToString(CultureInfo.InvariantCulture) + " хэмжээсийн цэг");
            if (spots > 0) parts.Add(spots.ToString(CultureInfo.InvariantCulture) + " spot level");
            if (tags > 0) parts.Add(tags.ToString(CultureInfo.InvariantCulture) + " шошго");
            if (parts.Count > 0)
                plan.Notes.Add("Таны тохируулсан босоо хүрээнээс гадуур тул хасав: " + string.Join(", ", parts));
        }

        private sealed class Opening
        {
            public WeInsertInfo Info;
            public double X;
            public double Half;
            public double Bottom;
            public double Top;
        }

        private sealed class FinishPick
        {
            public long Id;
            public double Lo, Hi, Y;
            public bool Below;
            public List<double[]> Blocked;
        }

        private sealed class Anchor
        {
            public long Id;
            public double X;
            public double Y;
            /// <summary>Шошгоны толгойн өндөр (NaN = элемент дээрээ).</summary>
            public double HeadY = double.NaN;
        }

        private sealed class Point
        {
            public long Id;
            public double X;
            public double Y;
            public double HalfW;
            public double HalfH;
        }

        private static KeyValuePair<string, Anchor> Pair(string key, long id, double x, double y, double headY = double.NaN)
        {
            return new KeyValuePair<string, Anchor>(key, new Anchor { Id = id, X = x, Y = y, HeadY = headY });
        }

        /// <summary>Өндрөөр (дараалсан зөрүү ≤ <paramref name="tol"/>) бүлэглэнэ; бүлэг дотор x-ээр, бүлгүүд доороос дээш.</summary>
        private static List<List<Point>> GroupByHeight(List<Point> pts, double tol)
        {
            var groups = new List<List<Point>>();
            foreach (Point p in pts.OrderBy(p => p.Y).ThenBy(p => p.X).ThenBy(p => p.Id))
            {
                List<Point> last = groups.Count > 0 ? groups[groups.Count - 1] : null;
                if (last != null && p.Y - last[last.Count - 1].Y <= tol) last.Add(p);
                else groups.Add(new List<Point> { p });
            }
            foreach (List<Point> g in groups) g.Sort((a, c) => a.X != c.X ? a.X.CompareTo(c.X) : a.Id.CompareTo(c.Id));
            return groups;
        }

        /// <summary>
        /// Харах гадаргуун ДЭЭРХ нимгэн өнгөлгөөний элемент эсэх: шалны хүрээ (wall sweep); гадаргуун өмнө зэрэгцээ нимгэн хана
        /// (≤ 120 мм — гоёлын хавтан, доод бүс); хананд наалдсан нимгэн ерөнхий модел/тогтмол тавилга/тоног (≤ 150 мм гүн).
        /// Ар тал нь гадаргуунаас ≤ 60 мм (харагч тал руу), урд тал нь ≤ 250 мм.
        /// </summary>
        private static bool IsFinishBand(WeFrame f, WeTaggable t, HashSet<long> sideWallIds, IWeUnits u,
                                         out double x0, out double x1, out double y0, out double y1, out double z0, out double z1)
        {
            x0 = x1 = y0 = y1 = z0 = z1 = 0;
            string key = t.CategoryKey ?? string.Empty;
            bool sweep = key == WeAnno.Finishes;
            bool wall = key == WeAnno.Walls;
            bool panel = key == "generic" || key == "casework" || key == "specialty";
            if (!sweep && !wall && !panel) return false;
            if (wall)
            {
                if (sideWallIds.Contains(t.Id) || !t.HasLine || t.Width > u.MmToInternal(120)) return false;
                WeV3 dir = (t.LineB - t.LineA).Flat().Normalized();
                if (dir.IsZero || Math.Abs(dir.Dot(f.Right)) < 0.98) return false;
            }
            if (!LocalRange(f, t, out x0, out x1, out y0, out y1, out z0, out z1)) return false;
            if (z1 < -u.MmToInternal(60) || z0 < -u.MmToInternal(250) || z0 > u.MmToInternal(10)) return false;
            if (panel && z1 - z0 > u.MmToInternal(150)) return false;
            return y1 > y0;
        }

        private static WeAnnoRef Ref(WeRefKind k, long id, double pos, double tol)
        {
            return new WeAnnoRef { Kind = k, ElementId = id, Pos = pos, Tol = tol };
        }

        private static WeSpot Spot(WeRefKind k, long id, double x, double y, double depth, string what)
        {
            return new WeSpot { Target = Ref(k, id, y, 0), X = x, Y = y, Depth = depth, What = what };
        }

        /// <summary>
        /// Дэлгээст ХАРАГДАХ гол тааз(ууд): ижил өндрийн (≤ 5 мм) таазуудыг бүлэглэж, гадаргуугийн дагуух хамралтаар (гадаргуунаас ≤ 600 мм-т хүрсэн
        /// хэсэг) — гадаргуугийн ≥ 25 %-ийг (≥ 400 мм) хамарсан бүлэг, хамгийн ихдээ 3; аль нь ч хүрэхгүй бол хамгийн их хамралттай нэг.  Өндрөөр
        /// эрэмбэлсэн.  ХЭМЖСЭН (MITIC 202A, 2026-10-08): өрөөний гүн дэх гэрлийн суваг, хөрш хэсгийн тааз — 4 өөр өндөр (2170 · 2780 · 3000 ·
        /// 3080) босоо гинж, spot level-ийг бөөгнүүлж, ихэнх нь «лавлагаа олдсонгүй» болсон; жишигт 1–2 тааз.
        /// </summary>
        /// <summary>
        /// Таазны ДЭЭР, энэ давхарт (дээд түвшнээс доош) трибун/шат байгаа эсэх — байвал тайлбар, үгүй бол null.  Дохио (харах гадаргуугийн
        /// өмнөх бүсэд, дэлхийн координат):
        ///   • шал (host эсвэл link) — доод нүүр нь таазны дээд нүүрнээс дээш, дээд нүүр нь дээд түвшнээс ≥ 400 мм доош (трибуны тавцан; дээд
        ///     давхрын хучилт ба 150–300 мм-ээр доошлуулсан нойтон өрөөний хавтан энд орохгүй);
        ///   • шат, хашлага, налуу зам — таазны дээд нүүрнээс ≥ 300 мм дээш гарсан, дээд түвшнээс доош эхэлсэн;
        ///   • тавилга, ерөнхий модел, сантехник, тусгай тоног — доод нь таазны доод нүүрнээс дээш, дээд нь таазнаас ≥ 300 мм дээш (трибуны
        ///     суудал; таазны дээрх нимгэн гэрлийн хайрцаг энд орохгүй), дээд түвшнээс доош.
        /// </summary>
        internal static string OverheadAbove(WeAnnoSources src, List<WeSlabInfo> floorsInFront, Func<WeV3, WeV3, bool> inFront,
                                             double ceilTop, double ceilBot, double nextZ, Func<double, double> mm)
        {
            Func<WeV3, WeV3, bool> deck = (mn, mx) => mn.Z >= ceilTop - mm(10) && mx.Z <= nextZ - mm(400);
            if (floorsInFront.Any(sl => deck(sl.Min, sl.Max))) return "шал/тавцан (трибун)";
            var skip = new HashSet<string>(new[] { WeAnno.Walls, WeAnno.Doors, WeAnno.Windows, WeAnno.Ceilings, WeAnno.Floors, WeAnno.Finishes,
                                                   WeAnno.Electrical, "curtainpanels" }, StringComparer.Ordinal);
            Func<WeV3, WeV3, bool> thing = (mn, mx) => mn.Z >= ceilBot + mm(10) && mx.Z >= ceilTop + mm(300) && mn.Z < nextZ - mm(50);
            int things = src.Taggables.Count(t => !t.Lighting && !skip.Contains(t.CategoryKey ?? string.Empty) && thing(t.Min, t.Max) && inFront(t.Min, t.Max));
            foreach (WeTaggable o in src.Overheads ?? new List<WeTaggable>())
            {
                if (!inFront(o.Min, o.Max)) continue;
                if (o.CategoryKey == "stairs" && o.Max.Z >= ceilTop + mm(300) && o.Min.Z < nextZ - mm(300)) return "шат, хашлага";
                if (o.CategoryKey == "floors" && deck(o.Min, o.Max)) return "шал/тавцан (трибун)";
                if (o.CategoryKey == "other" && thing(o.Min, o.Max)) things++;
            }
            return things > 0 ? things + " элемент (трибуны суудал …)" : null;
        }

        internal static List<WeSlabInfo> MainCeilings(WeFrame f, List<WeSlabInfo> cands, double faceLo, double faceHi, IWeUnits u)
        {
            var result = new List<WeSlabInfo>();
            if (cands == null || cands.Count == 0) return result;
            double len = Math.Max(1e-9, faceHi - faceLo);
            var groups = new List<KeyValuePair<WeSlabInfo, double>>();   // төлөөлөгч, хамралт
            foreach (List<WeSlabInfo> g in GroupByZ(cands, u.MmToInternal(5)))
            {
                var spans = new List<double[]>();
                WeSlabInfo best = null;
                double bestCov = -1;
                foreach (WeSlabInfo c in g)
                {
                    if (c.Faces != null && c.Faces.Count > 0)
                    {
                        List<double[]> cov = CoveredSpans(f, c, faceLo, faceHi, u, -1);
                        if (cov.Count == 0) continue;
                        spans.AddRange(cov);
                        double sum = Union(cov);
                        if (sum > bestCov) { bestCov = sum; best = c; }
                        continue;
                    }
                    double x0 = double.MaxValue, x1 = double.MinValue, z1 = double.MinValue;
                    foreach (WeV3 p in new[] { new WeV3(c.Min.X, c.Min.Y, c.Min.Z), new WeV3(c.Max.X, c.Min.Y, c.Min.Z), new WeV3(c.Min.X, c.Max.Y, c.Min.Z), new WeV3(c.Max.X, c.Max.Y, c.Min.Z) })
                    {
                        WeV3 l = f.ToLocal(p);
                        x0 = Math.Min(x0, l.X); x1 = Math.Max(x1, l.X); z1 = Math.Max(z1, l.Z);
                    }
                    if (z1 < -u.MmToInternal(600)) continue;   // гадаргууд хүрээгүй (өрөөний гүнд)
                    double lo = Math.Max(x0, faceLo), hi = Math.Min(x1, faceHi);
                    if (hi <= lo) continue;
                    spans.Add(new[] { lo, hi });
                    if (hi - lo > bestCov) { bestCov = hi - lo; best = c; }
                }
                if (best == null) continue;
                groups.Add(new KeyValuePair<WeSlabInfo, double>(best, Union(spans)));
            }
            if (groups.Count == 0) return result;
            double need = Math.Max(0.25 * len, Math.Min(u.MmToInternal(400), 0.5 * len));
            result.AddRange(groups.Where(g => g.Value >= need - 1e-9).OrderByDescending(g => g.Value).Take(3).Select(g => g.Key));
            if (result.Count == 0) result.Add(groups.OrderByDescending(g => g.Value).First().Key);
            return result.OrderBy(c => c.Min.Z).ThenBy(c => c.Id).ToList();
        }

        /// <summary>
        /// Гадаргуугийн дагуух (faceLo..faceHi) хэсгүүд — тэдгээрийн урд (өрөө рүү 50 / 300 / 600 мм, <paramref name="extraDepth"/> &gt; 0 бол
        /// мөн тэр гүнд) хавтангийн хэмжих нүүр байна.  ≤ 80 түүвэр (≥ 50 мм алхам).
        /// </summary>
        internal static List<double[]> CoveredSpans(WeFrame f, WeSlabInfo c, double faceLo, double faceHi, IWeUnits u, double extraDepth)
        {
            var spans = new List<double[]>();
            double len = faceHi - faceLo;
            if (len <= 0) return spans;
            int n = (int)Math.Min(80, Math.Max(4, Math.Ceiling(len / u.MmToInternal(50))));
            double step = len / n;
            var depths = new List<double> { u.MmToInternal(50), u.MmToInternal(300), u.MmToInternal(600) };
            if (extraDepth > 0) depths.Add(extraDepth);
            double[] open = null;
            for (int i = 0; i < n; i++)
            {
                double x = faceLo + (i + 0.5) * step;
                bool on = depths.Any(d => c.Covers(f.ToWorld(x, 0, -d)));
                if (on)
                {
                    if (open == null) { open = new[] { x - step / 2, x + step / 2 }; spans.Add(open); }
                    else open[1] = x + step / 2;
                }
                else open = null;
            }
            return spans;
        }

        private static List<List<WeSlabInfo>> GroupByZ(List<WeSlabInfo> cands, double tol)
        {
            var groups = new List<List<WeSlabInfo>>();
            foreach (WeSlabInfo c in cands.OrderBy(c => c.Min.Z).ThenBy(c => c.Id))
            {
                List<WeSlabInfo> last = groups.Count > 0 ? groups[groups.Count - 1] : null;
                if (last != null && c.Min.Z - last[0].Min.Z <= tol) last.Add(c);
                else groups.Add(new List<WeSlabInfo> { c });
            }
            return groups;
        }

        private static double Union(List<double[]> spans)
        {
            double len = 0, end = double.NegativeInfinity;
            foreach (double[] sp in spans.OrderBy(s => s[0]))
            {
                double from = Math.Max(sp[0], end);
                if (sp[1] > from) len += sp[1] - from;
                end = Math.Max(end, sp[1]);
            }
            return len;
        }

        /// <summary>
        /// Хэвтээ гинжийн ойрхон лавлагааг (&lt; <paramref name="minSeg"/>) нэг болгоно — ач холбогдлоор: гадаргуугийн зах › тэнхлэг › нүх (хаалга,
        /// цонх) › бусад.  ХЭМЖСЭН (MITIC 202A, 2026-10-08): гоёлын хавтангийн буланд эргэх 10 мм-ийн нимгэн ханууд, 20 мм тусгаарлах хавтан
        /// «30 · 2150 · 250 · 20 · 775 · 10 · 790 · 10 …» гэж уншигдахгүй гинж үүсгэсэн; жишиг «110 · 50 · 1200 · 1200 …».
        /// Ойрхон хоёроос ач холбогдол ихийг үлдээнэ (байрлал нь өөрөө — хуурамч цэг үүсгэхгүй); солих нь өмнөх үлдсэнээс хол байвал л.
        /// </summary>
        internal static List<WeAnnoRef> SimplifyChain(List<WeAnnoRef> refs, double minSeg, bool vertical = false)
        {
            Func<WeRefKind, int> rank = vertical ? (Func<WeRefKind, int>)VRank : Rank;
            var kept = new List<WeAnnoRef>();
            foreach (WeAnnoRef x in refs.OrderBy(r => r.Pos).ThenBy(r => rank(r.Kind)).ThenBy(r => r.ElementId))
            {
                if (kept.Count == 0 || x.Pos - kept[kept.Count - 1].Pos >= minSeg - 1e-9) { kept.Add(x); continue; }
                WeAnnoRef last = kept[kept.Count - 1];
                if (rank(x.Kind) >= rank(last.Kind)) continue;
                if (kept.Count >= 2 && x.Pos - kept[kept.Count - 2].Pos < minSeg - 1e-9) continue;
                kept[kept.Count - 1] = x;
            }
            return kept;
        }

        /// <summary>Босоо гинжийн ач холбогдол: шалны дээд › тааз, хучилт, түвшин › өнгөлгөөний ирмэг › шалны доод (өнгөлгөөний зузаан).</summary>
        private static int VRank(WeRefKind k)
        {
            switch (k)
            {
                case WeRefKind.FloorTop: return 0;
                case WeRefKind.CeilingBottom:
                case WeRefKind.SlabBottom:
                case WeRefKind.Level: return 1;
                case WeRefKind.FloorBottom: return 3;
                default: return 2;
            }
        }

        private static int Rank(WeRefKind k)
        {
            switch (k)
            {
                case WeRefKind.FaceStart:
                case WeRefKind.FaceEnd: return 0;
                case WeRefKind.Grid: return 1;
                case WeRefKind.InsertLeft:
                case WeRefKind.InsertRight: return 2;
                default: return 3;
            }
        }

        /// <summary>Байрлалаар эрэмбэлж ижил байрлалынхыг нэг болгоно (0 урттай сегмент Revit-д алдаа).</summary>
        private static List<WeAnnoRef> Distinct(List<WeAnnoRef> refs, double tol)
        {
            var r = new List<WeAnnoRef>();
            foreach (WeAnnoRef x in refs.OrderBy(x => x.Pos).ThenBy(x => (int)x.Kind).ThenBy(x => x.ElementId))
                if (r.Count == 0 || x.Pos - r[r.Count - 1].Pos > tol) r.Add(x);
            return r;
        }

        /// <summary>
        /// Элементийн дотоод муж.  Хана: location line ± хагас зузаан (харах чиглэлд перпендикуляр бүрэлдэхүүнээр) — эргэлттэй
        /// ханын тэнхлэгт зэрэгцсэн хайрцаг хэт өргөн.  Бусад: хайрцгийн 8 оройг тусгана.
        /// </summary>
        private static bool LocalRange(WeFrame f, WeTaggable t, out double x0, out double x1, out double y0, out double y1, out double z0, out double z1)
        {
            x0 = y0 = z0 = double.MaxValue;
            x1 = y1 = z1 = double.MinValue;
            if (t.HasHull)
            {
                // Харагдах геометрийн бүрхүүл: босоо хавтгайд проекц нь эргүүлсэн тавилгад ч ЯГ (хайрцаг шиг томсохгүй).
                foreach (WeV3 h in t.Hull)
                {
                    WeV3 l = f.ToLocal(new WeV3(h.X, h.Y, t.HullBottomZ));
                    x0 = Math.Min(x0, l.X); x1 = Math.Max(x1, l.X);
                    z0 = Math.Min(z0, l.Z); z1 = Math.Max(z1, l.Z);
                }
                y0 = t.HullBottomZ - f.Origin.Z;
                y1 = t.HullTopZ - f.Origin.Z;
                return x1 > x0 && y1 >= y0;
            }
            if (t.HasLine)
            {
                WeV3 a = f.ToLocal(t.LineA), c = f.ToLocal(t.LineB);
                WeV3 dir = (t.LineB - t.LineA).Flat().Normalized();
                if (dir.IsZero) return false;
                WeV3 n = WeV3.UnitZ.Cross(dir).Normalized();
                double hw = Math.Max(0, t.Width) / 2;
                double ex = Math.Abs(n.Dot(f.Right)) * hw, ez = Math.Abs(n.Dot(f.Look)) * hw;
                x0 = Math.Min(a.X, c.X) - ex; x1 = Math.Max(a.X, c.X) + ex;
                z0 = Math.Min(a.Z, c.Z) - ez; z1 = Math.Max(a.Z, c.Z) + ez;
                y0 = t.Min.Z - f.Origin.Z; y1 = t.Max.Z - f.Origin.Z;
                return true;
            }
            for (int i = 0; i < 8; i++)
            {
                var p = new WeV3((i & 1) == 0 ? t.Min.X : t.Max.X, (i & 2) == 0 ? t.Min.Y : t.Max.Y, (i & 4) == 0 ? t.Min.Z : t.Max.Z);
                WeV3 l = f.ToLocal(p);
                x0 = Math.Min(x0, l.X); x1 = Math.Max(x1, l.X);
                y0 = Math.Min(y0, l.Y); y1 = Math.Max(y1, l.Y);
                z0 = Math.Min(z0, l.Z); z1 = Math.Max(z1, l.Z);
            }
            return x1 > x0;
        }

        /// <summary>Нүхгүй хамгийн урт хэсгийн төв — ханын шошгыг хаалга/цонхон дээр биш.</summary>
        /// <summary>
        /// Гадаргуун хамгийн урт чөлөөт хэсгийн төв — нүх (хаалга, цонх) ба тэнхлэгийн шугамыг (± <paramref name="gridClear"/>)
        /// тойрно.  Ханын keynote/шошго энд — нүхэн дээр биш, leader нь тэнхлэгийн шугамтай давхцахгүй.
        /// </summary>
        private static double LargestGapCenter(double lo, double hi, List<Opening> openings, List<double> gridXs, double gridClear)
        {
            var blocks = openings.Select(o => new KeyValuePair<double, double>(o.X - o.Half, o.X + o.Half))
                                 .Concat(gridXs.Select(g => new KeyValuePair<double, double>(g - gridClear, g + gridClear)))
                                 .OrderBy(kv => kv.Key);
            double bestLen = -1, best = (lo + hi) / 2, cursor = lo;
            foreach (KeyValuePair<double, double> kv in blocks)
            {
                double a = kv.Key;
                if (a - cursor > bestLen) { bestLen = a - cursor; best = (cursor + a) / 2; }
                cursor = Math.Max(cursor, kv.Value);
            }
            if (hi - cursor > bestLen) best = (cursor + hi) / 2;
            return best;
        }

        // ── Тэмдэг ───────────────────────────────────────────────────

        private static string Digest(WeAnnotationPlan p, WeSettings s)
        {
            var sb = new StringBuilder();
            // «a2» (2026-10-07): тэмдэглэгээний Revit давхарга өөрчлөгдсөн (түвшний тэмдэг, давхраас харьцангуй spot, захын туслах лавлагаа,
            // annotation crop) — өмнөх дэлгээсүүд дахин ажиллуулахад тэмдэглэгээгээ ШИНЭЧИЛНЭ (харагдац хөдлөхгүй).
            // «a3» (2026-10-07): материалын тэмдэглэл — монгол бичвэр, босоо сумтай заагч, мөрөөр байрлал, шилэн хана (WeMaterialLabel, WeNoteLayout).
            // «a4» (2026-10-08): интерьер — өнгөлгөөний бүс, шалнаас тааз хүртэл, цахилгаан цэгийн байрлал/шошго, multi-category шошго.
            sb.Append("a4|").Append(s.MaterialNotes ? "m1|" : "m0|").Append(s.DimTypeName ?? string.Empty).Append('|').Append(s.SpotTypeName ?? string.Empty)
              .Append('|').Append(s.KeynoteTypeName ?? string.Empty);
            foreach (WeDimRow r in p.Rows)
            {
                sb.Append("|R").Append(r.Vertical ? 'V' : 'H').Append(Q(r.At));
                foreach (WeAnnoRef x in r.Refs)
                {
                    sb.Append(';').Append((int)x.Kind).Append(',').Append(x.ElementId).Append(',').Append(Q(x.Pos));
                    // «ЯГ» лавлагаа (2026-10-14, тавилгын бүрхүүл) — Revit тал өөрөөр шийддэг тул хуучин дэлгээсийг шинэчилнэ.  Бүрхүүлгүй бол
                    // өмнөхтэй БАЙТ-ИЖИЛ.
                    if (x.Exact) sb.Append(",x");
                }
            }
            // Spot level-ийн суурь (2026-10-14: давхраас ±0.00) — суурь солигдвол spot-ууд шинэчлэгдэнэ.
            if (p.Spots.Count > 0) sb.Append("|SB").Append(p.BaseLevelId);
            foreach (WeSpot sp in p.Spots)
                sb.Append("|S").Append((int)sp.Target.Kind).Append(',').Append(sp.Target.ElementId).Append(',').Append(Q(sp.X)).Append(',')
                  .Append(Q(sp.Y)).Append(sp.Leader ? ",L" + Q(sp.EndX) : string.Empty)
                  // Толин spot (2026-10-14) — өмнөх дэлгээсүүд дахин ажиллуулахад шинэ хэлбэрээр ШИНЭЧЛЭГДЭНЭ.
                  .Append(sp.Mirrored ? ",M" : string.Empty);
            foreach (WeTagItem t in p.Tags)
                sb.Append("|T").Append(t.Keynote ? 'K' : 't').Append(t.ElementId).Append(',').Append(Q(t.HeadX)).Append(',').Append(Q(t.HeadY));
            // Тод/бүдэг хэсэг, улаан хүрээ (2026-10-14) — тохиргоо солигдвол өмнөх дэлгээсүүд дахин ажиллуулахад ШИНЭЧЛЭГДЭНЭ.
            if (!double.IsNaN(p.FadeFromY)) sb.Append("|F").Append(Q(p.FadeFromY)).Append(',').Append(s.FadeOpacity.ToString(CultureInfo.InvariantCulture));
            if (s.RedFrame) sb.Append("|RF");
            return Fnv64(sb.ToString());
        }

        /// <summary>Тэмдэглэгээнээс гадна дэлгээст зурагдах зүйл (бүдэг давхарга, улаан хүрээ) бий юу.</summary>
        internal static bool Decorated(WeAnnotationPlan p, WeSettings s)
        {
            return p != null && s != null && (!double.IsNaN(p.FadeFromY) || s.RedFrame);
        }

        /// <summary>Хувилбар бүрт ижил (string.GetHashCode биш).</summary>
        private static string Fnv64(string text)
        {
            ulong hash = 14695981039346656037UL;
            foreach (char c in text)
            {
                hash ^= c;
                hash *= 1099511628211UL;
            }
            return hash.ToString("x16", CultureInfo.InvariantCulture);
        }

        private static string Q(double ft)
        {
            return ((long)Math.Round(ft * 1000.0, MidpointRounding.AwayFromZero)).ToString(CultureInfo.InvariantCulture);
        }
    }
}
