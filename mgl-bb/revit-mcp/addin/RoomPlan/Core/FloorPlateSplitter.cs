using System;
using System.Collections.Generic;
using System.Linq;

namespace RevitMcpAddin.RoomPlan.Core
{
    // ══════════════════════════════════════════════════════════════════════════
    //  ДАВХРЫН ПЛАН — нэг давхрын контурыг айлууд болгон хуваах (Finch маяг, 2026-10-14).
    //
    //  «Олон өрөөний план» нь айл БҮРИЙН шал + 4 ханыг архитектор урьдчилж зурахыг шаарддаг байв.
    //  Finch 3D барилгын контураас эхэлж, коридор / шатны хонгил / айлын харьцаагаар давхрыг
    //  айлууд болгон хуваагаад, айл бүрийн дотор төлөвлөлтийг үүсгэдэг.  Энэ файл тэр эхний алхам:
    //  тэгш өнцөгт давхар → коридор, шатны хонгил, айлуудын тэгш өнцөгт + үүсгэх хананууд.
    //  Айл бүрийн дотор төлөвлөлт хэвээр Python хөдөлгүүрээр.
    //
    //  Координат: давхрын ГАДНА ХАНЫН ТЭНХЛЭГИЙН тэгш өнцөгтийн зүүн доод булангаас (м).
    //  ⚠️ Revit/WPF-гүй ЦЭВЭР — `tests/RoomPlan.Tests` шалгана.
    // ══════════════════════════════════════════════════════════════════════════

    internal enum CorridorScheme { Auto, Double, Single }
    internal enum CorePosition { Center, End, None }

    internal sealed class FloorPlateInput
    {
        /// <summary>X ба Y хэмжээ (м), гадна ханын тэнхлэгээр.</summary>
        public double Width, Height;
        /// <summary>Коридорын ЦЭВЭР өргөн (м).</summary>
        public double CorridorWidth = 1.6;
        /// <summary>Коридор ба айл хоорондын ханын зузаан (м).</summary>
        public double WallThickness = 0.2;
        /// <summary>Гадна ханын зузаан (м) — нэг талын коридорын цэвэр өргөнд.</summary>
        public double ExteriorThickness = 0.3;
        public CorridorScheme Scheme = CorridorScheme.Auto;
        /// <summary>Нэг талын (галерей) коридор аль урт талд: false = хойд/зүүн (өндөр v), true = урд/баруун (бага v).</summary>
        public bool SingleOnLowSide;
        public CorePosition Core = CorePosition.Center;
        /// <summary>Шат, лифтийн хонгилын өргөн коридорын дагуу (тэнхлэгээр, м).</summary>
        public double CoreWidth = 6.0;
        /// <summary>Хонгил аль эгнээнд (хоёр талын коридорт): false = өндөр v (хойд/зүүн), true = бага v.</summary>
        public bool CoreOnLowRow;
        /// <summary>Төгсгөлийн хонгил (CorePosition.End) аль үзүүрт: false = их u (зүүн доод булангаас хол), true = u = 0 талд.</summary>
        public bool CoreAtLowEnd;
        /// <summary>1..4 унтлагын айлын харьцаа (жин, нийлбэр нь 1 байх албагүй).</summary>
        public double[] Mix = { 0.0, 0.4, 0.4, 0.2 };
        public string Tier = "standard";
    }

    internal sealed class FloorUnit
    {
        public string Id;
        public double X1, Y1, X2, Y2;
        /// <summary>Коридор руу харсан тал: south/north/west/east.</summary>
        public string Entry;
        /// <summary>Гадна ханатай (цонх гаргаж болох) талууд.</summary>
        public List<string> Facades = new List<string>();
        public int Bedrooms, Bathrooms;
        public string Tier;
        public double Width { get { return X2 - X1; } }
        public double Depth { get { return Y2 - Y1; } }
        public double Area { get { return (X2 - X1) * (Y2 - Y1); } }
    }

    internal sealed class FloorWall
    {
        public double X1, Y1, X2, Y2;
        /// <summary>corridor | party</summary>
        public string Kind;
        public double Length { get { return Math.Abs(X2 - X1) + Math.Abs(Y2 - Y1); } }
    }

    internal sealed class FloorRect
    {
        public double X1, Y1, X2, Y2;
        public double Area { get { return (X2 - X1) * (Y2 - Y1); } }
        public double Cx { get { return (X1 + X2) / 2; } }
        public double Cy { get { return (Y1 + Y2) / 2; } }
    }

    internal sealed class FloorPlateLayout
    {
        public CorridorScheme Scheme;
        public double Width, Height, RowDepth;
        public FloorRect Corridor;
        public FloorRect Core;
        public readonly List<FloorUnit> Units = new List<FloorUnit>();
        public readonly List<FloorWall> Walls = new List<FloorWall>();
        public readonly List<string> Notes = new List<string>();
        public string Error;
        /// <summary>
        /// Айл бүр БҮХ амьдрах өрөөндөө (унтлагын, зочны) цонх хүрэх өргөнтэй (`FloorPlateSplitter.LitWidth`).  False = харьцаа
        /// давхарт тийм өргөнөөр багтсангүй, Python-ы доод өргөнөөр хуваасан — зарим айлд цонхгүй өрөө гарч болно.
        /// </summary>
        public bool AllLit;
        public double Gfa { get { return Width * Height; } }
        public double Nfa { get { return Units.Sum(u => u.Area); } }
        public double Efficiency { get { return Gfa <= 0 ? 0 : Nfa / Gfa; } }
        public int Count(int bedrooms) { return Units.Count(u => u.Bedrooms == bedrooms); }
    }

    internal static class FloorPlateSplitter
    {
        /// <summary>Python хөдөлгүүрийн доод хэмжээ (roomplan_cli `width_m`/`height_m` ≥ 7.8).</summary>
        public const double MinSide = 7.8;
        /// <summary>Python нэг удаад 24 нэгж хүртэл (roomplan_cli MAX_UNITS).</summary>
        public const int MaxUnits = 24;

        /// <summary>
        /// Унтлагын тоо, айлын гүнээр хамгийн бага өргөн.  Хэмжсэн 2026-10-14 (py-rp-12, орц коридор талд,
        /// цонх эсрэг талд): 1–2 унтлагын 7.8 м-ээс; 3 унтлагын гүн 8.4-өөс бага бол 9.0, 9-өөс бага бол 8.4;
        /// 4 унтлагын гүн 9-өөс бага бол 10.0, 10.5-аас бага бол 9.0.
        /// </summary>
        public static double MinWidth(int bedrooms, double depth)
        {
            if (bedrooms <= 2) return MinSide;
            if (bedrooms == 3) return depth < 8.4 ? 9.0 : depth < 9.0 ? 8.4 : MinSide;
            return depth < 9.0 ? 10.0 : depth < 10.5 ? 9.0 : 8.4;
        }

        /// <summary>
        /// Айлын БҮХ амьдрах өрөө (унтлагын + зочны) цонхтой байх хамгийн бага өргөн.  Хэмжсэн 2026-10-14 (py-rp-12, орц
        /// коридор талд; гүн 7.8 / 8.1 / 8.4 / 9.0 / 10.15 м × өргөн 7.8–15.3 м, 0.3 м алхам): «дунд» айл нэг л урт гадна
        /// ханатай — 2 ӨА 8.4 (гүн 8.1-ээс бага бол 8.7), 3 ӨА 10.8–11.4, 4 ӨА 13.5–13.8 м; «булангийн» айл (эгнээний гадна
        /// үзүүрт, хоёр талдаа цонхтой) хамаагүй нарийн байж болно — 3 ӨА 7.8–9.0, 4 ӨА 9.0–11.4 м.  Өмнө нь хуваагч
        /// зөвхөн `MinWidth`-ээр хуваадаг байсан тул 40×18 давхрын дунд айлуудад унтлагын өрөө цонхгүй гарч байв (☀3/4).
        /// </summary>
        public static double LitWidth(int bedrooms, double depth, bool corner)
        {
            if (corner)
            {
                if (bedrooms <= 2) return MinSide;
                if (bedrooms == 3) return depth < 8.4 ? 9.0 : depth < 9.0 ? 8.4 : MinSide;
                return depth < 8.1 ? 11.4 : depth < 8.4 ? 10.5 : depth < 9.0 ? 10.2 : depth < 10.15 ? 9.6 : 9.0;
            }
            if (bedrooms <= 1) return MinSide;
            if (bedrooms == 2) return depth < 8.1 ? 8.7 : 8.4;
            if (bedrooms == 3) return depth < 8.1 ? 11.4 : depth < 8.4 ? 11.1 : 10.8;
            return depth < 8.4 ? 13.8 : 13.5;
        }

        /// <summary>Айлын шаардлагатай доод өргөн: Python-ы доод хэмжээ, <paramref name="lit"/> бол бүх өрөө цонхтой байх өргөн.</summary>
        public static double NeedWidth(int bedrooms, double depth, bool lit, bool corner)
        {
            return lit ? Math.Max(MinWidth(bedrooms, depth), LitWidth(bedrooms, depth, corner)) : MinWidth(bedrooms, depth);
        }

        /// <summary>Зэрэглэлээр айлын зорилтот талбай (м²), унтлагын 1..4.</summary>
        public static double TargetArea(string tier, int bedrooms)
        {
            double[] a = tier == "economy" ? new[] { 48.0, 62, 80, 98 }
                       : tier == "luxury" ? new[] { 70.0, 100, 135, 165 }
                       : new[] { 55.0, 72, 95, 118 };
            return a[Math.Max(1, Math.Min(4, bedrooms)) - 1];
        }

        public static FloorPlateLayout Split(FloorPlateInput input)
        {
            var layout = new FloorPlateLayout { Width = input.Width, Height = input.Height };
            string bad = Validate(input);
            if (bad != null) { layout.Error = bad; return layout; }

            bool xLong = input.Width >= input.Height;
            double L = xLong ? input.Width : input.Height;      // коридорын дагуу
            double D = xLong ? input.Height : input.Width;      // гүн
            double band = input.CorridorWidth + input.WallThickness;   // коридорын хоёр тэнхлэгийн хооронд
            double doubleDepth = (D - band) / 2;
            double singleDepth = D - (input.CorridorWidth + input.WallThickness / 2 + input.ExteriorThickness / 2);

            CorridorScheme scheme = input.Scheme;
            if (scheme == CorridorScheme.Auto)
                scheme = doubleDepth >= MinSide ? CorridorScheme.Double : CorridorScheme.Single;
            if (scheme == CorridorScheme.Double && doubleDepth < MinSide)
            {
                layout.Error = "Барилга хоёр талдаа айлтай байхад хэт нарийн: айлын гүн " + F(doubleDepth) +
                    " м (≥ " + F(MinSide) + " м хэрэгтэй, давхрын гүн ≥ " + F(2 * MinSide + band) + " м).  " +
                    "«Нэг талдаа айлтай» схем сонгоно уу.";
                return layout;
            }
            if (scheme == CorridorScheme.Single && singleDepth < MinSide)
            {
                layout.Error = "Давхрын гүн " + F(D) + " м — коридор (" + F(input.CorridorWidth) +
                    " м) хассаны дараа айлын гүн " + F(singleDepth) + " м; ≥ " + F(MinSide) + " м хэрэгтэй.";
                return layout;
            }
            layout.Scheme = scheme;

            // v-ийн мужууд: эгнээ (row) ба коридор.
            var rows = new List<(double v1, double v2, bool low)>();
            double c1, c2;
            if (scheme == CorridorScheme.Double)
            {
                c1 = doubleDepth; c2 = doubleDepth + band;
                rows.Add((0, c1, true));
                rows.Add((c2, D, false));
                layout.RowDepth = doubleDepth;
            }
            else if (input.SingleOnLowSide)
            {
                c1 = 0; c2 = D - singleDepth;
                rows.Add((c2, D, false));
                layout.RowDepth = singleDepth;
            }
            else
            {
                c1 = singleDepth; c2 = D;
                rows.Add((0, c1, true));
                layout.RowDepth = singleDepth;
            }
            double depth = layout.RowDepth;

            // Шатны хонгил (эгнээн доторх нэг хэсэг).
            int coreRow = -1;
            CorePosition corePos = input.Core;
            double cw = input.CoreWidth;
            if (corePos != CorePosition.None)
            {
                coreRow = rows.Count == 1 ? 0 : (input.CoreOnLowRow ? 0 : 1);
                if (corePos == CorePosition.Center && (L - cw) / 2 < MinSide) corePos = CorePosition.End;
                if (corePos == CorePosition.End && L - cw < MinSide)
                {
                    layout.Error = "Давхар " + F(L) + " м урт — шатны хонгил (" + F(cw) + " м) тавихад айл багтахгүй.";
                    return layout;
                }
                if (corePos != input.Core)
                    layout.Notes.Add("Шатны хонгилыг төгсгөлд шилжүүлэв — төвд тавихад хоёр тал нь айлд хэт богино.");
            }

            // Эгнээ бүрийг хэсгүүдэд (segment) хуваана: [u1, u2], аль үзүүр нь гадна хана вэ.
            List<Segment> SegmentsFor(CorePosition pos, out double k1, out double k2)
            {
                if (pos == CorePosition.Center) { k1 = (L - cw) / 2; k2 = k1 + cw; }
                else if (input.CoreAtLowEnd) { k1 = 0; k2 = cw; }
                else { k1 = L - cw; k2 = L; }
                var list = new List<Segment>();
                for (int r = 0; r < rows.Count; r++)
                {
                    if (r == coreRow)
                    {
                        if (k1 > 0.01) list.Add(new Segment { Row = r, U1 = 0, U2 = k1, OuterLow = true, OuterHigh = false });
                        if (k2 < L - 0.01) list.Add(new Segment { Row = r, U1 = k2, U2 = L, OuterLow = false, OuterHigh = true });
                    }
                    else list.Add(new Segment { Row = r, U1 = 0, U2 = L, OuterLow = true, OuterHigh = true });
                }
                return list;
            }

            // Айлын харьцаа нь ЗОРИЛТ (Finch шиг): тоо, хослолыг хайж, харьцаанаас хазайлт + уртад багтах
            // хазайлтын нийлбэр хамгийн бага хувилбарыг авна.  Эхлээд айл БҮРИЙН БҮХ өрөө цонхтой байх өргөнөөр
            // (`LitWidth`); төвийн хонгилтой багтахгүй бол хонгилыг төгсгөлд; тэгээд ч багтахгүй бол л Python-ы доод
            // өргөнөөр — тэр үед зарим өрөө цонхгүй гарч болохыг ИЛ хэлнэ (`AllLit = false`).
            double[] mix = Normalize(input.Mix);
            bool canMoveCore = corePos == CorePosition.Center && L - cw >= MinSide;
            var attempts = new List<(CorePosition pos, bool lit)> { (corePos, true) };
            if (canMoveCore) attempts.Add((CorePosition.End, true));
            attempts.Add((corePos, false));
            if (canMoveCore) attempts.Add((CorePosition.End, false));
            List<Segment> segments = null;
            List<int>[] best = null;
            bool lit = false;
            double core1 = 0, core2 = 0;
            foreach (var (pos, withLight) in attempts)
            {
                List<Segment> segs = SegmentsFor(pos, out double k1, out double k2);
                best = Search(mix, segs, input.Tier, depth, withLight);
                if (best == null) continue;
                segments = segs; lit = withLight; core1 = k1; core2 = k2;
                if (pos != corePos)
                    layout.Notes.Add("Шатны хонгилыг төгсгөлд шилжүүлэв — төвд тавихад хоёр талд нь айл " +
                        (withLight ? "бүх өрөөгөө цонхтой байхаар " : "") + "багтахгүй байв.");
                corePos = pos;
                break;
            }
            if (best == null)
            {
                double total = rows.Count * L - (coreRow >= 0 ? cw : 0);
                layout.Error = total / MinSide > MaxUnits
                    ? "Давхар хэт урт: " + MaxUnits + "-аас олон айл болно.  Давхрыг хэсэгчлэн (хоёр удаа) төлөвлөнө үү."
                    : "Энэ айлын харьцаагаар давхарт айл багтсангүй — харьцааг өөрчилж (жишээ нь том айлын хувийг багасгаж) дахин оролдоно уу.";
                return layout;
            }
            layout.AllLit = lit;
            if (!lit)
                layout.Notes.Add("⚠ Энэ харьцаагаар давхарт айл бүрийн БҮХ өрөө цонхтой байх өргөн хүрэлцсэнгүй — зарим айлд цонхгүй " +
                    "унтлагын өрөө гарч болно.  3–4 өрөөтэй айлын хувийг багасгах (тэд эгнээний үзүүрт, хоёр талдаа цонхтой бол " +
                    "нарийн байж болно) эсвэл хонгилыг төгсгөлд тавина уу.");

            // Айл бүрийн өргөнийг хэсгийн уртад тааруулж, гадна булангийн байрлалд томыг нь тавина.
            for (int s = 0; s < segments.Count; s++)
            {
                Segment seg = segments[s];
                var beds = OrderForSegment(best[s], seg);
                if (beds.Count == 0) continue;
                double[] widths = beds.Select((b, i) =>
                    Wanted(input.Tier, b, depth, NeedWidth(b, depth, lit, IsCorner(seg, i, beds.Count)))).ToArray();
                double scale = seg.Length / widths.Sum();
                // Дотоод хилүүдийг 5 см-ийн торонд дугуйлна (хил бүр ±2.5 см-ээс илүү хөдлөхгүй).
                var edges = new double[beds.Count + 1];
                edges[0] = seg.U1; edges[beds.Count] = seg.U2;
                double cum = 0;
                for (int i = 1; i < beds.Count; i++)
                {
                    cum += widths[i - 1] * scale;
                    edges[i] = seg.U1 + Math.Round(cum / 0.05) * 0.05;
                }
                for (int i = 0; i < beds.Count; i++)
                {
                    double u = edges[i], w = edges[i + 1] - edges[i];
                    var (v1, v2, low) = rows[seg.Row];
                    var unit = new FloorUnit
                    {
                        Bedrooms = beds[i], Tier = input.Tier,
                    };
                    MapRect(xLong, u, v1, u + w, v2, out unit.X1, out unit.Y1, out unit.X2, out unit.Y2);
                    // Орц = коридор руу харсан урт тал; цонх = гадна урт тал + гадна ханын үзүүр.
                    string vLow = xLong ? "south" : "west", vHigh = xLong ? "north" : "east";
                    string uLow = xLong ? "west" : "south", uHigh = xLong ? "east" : "north";
                    unit.Entry = low ? vHigh : vLow;
                    unit.Facades.Add(low ? vLow : vHigh);
                    if (u <= 0.01) unit.Facades.Add(uLow);
                    if (u + w >= L - 0.01) unit.Facades.Add(uHigh);
                    unit.Bathrooms = unit.Bedrooms >= 3 || unit.Area >= 85 ? 2 : 1;
                    layout.Units.Add(unit);
                }
            }
            // Дугаарлалт: эгнээ, дараа нь u-ээр.
            int order = 0;
            foreach (FloorUnit unit in layout.Units
                .OrderBy(x => xLong ? x.Y1 : x.X1).ThenBy(x => xLong ? x.X1 : x.Y1))
                unit.Id = "U" + (++order).ToString("00");
            layout.Units.Sort((a, b) => string.CompareOrdinal(a.Id, b.Id));

            // Коридор, хонгил, хананууд.
            double cv1 = scheme == CorridorScheme.Single && input.SingleOnLowSide ? 0 : c1;
            double cv2 = scheme == CorridorScheme.Single && !input.SingleOnLowSide ? D : c2;
            var corridor = new FloorRect();
            MapRect(xLong, 0, cv1, L, cv2, out corridor.X1, out corridor.Y1, out corridor.X2, out corridor.Y2);
            layout.Corridor = corridor;
            if (coreRow >= 0)
            {
                var (v1, v2, _) = rows[coreRow];
                var core = new FloorRect();
                MapRect(xLong, core1, v1, core2, v2, out core.X1, out core.Y1, out core.X2, out core.Y2);
                layout.Core = core;
            }
            // Коридорын хана: эгнээ бүрийн коридор талын тэнхлэг, хонгилын хэсгийг алгасна (хонгил коридор руу нээлттэй).
            for (int r = 0; r < rows.Count; r++)
            {
                var (v1, v2, low) = rows[r];
                double v = low ? v2 : v1;
                if (r == coreRow)
                {
                    if (core1 > 0.01) AddWall(layout, xLong, 0, v, core1, v, "corridor");
                    if (core2 < L - 0.01) AddWall(layout, xLong, core2, v, L, v, "corridor");
                }
                else AddWall(layout, xLong, 0, v, L, v, "corridor");
            }
            // Айл хоорондын / хонгилын хана: эгнээ доторх дотоод хил бүр.
            for (int r = 0; r < rows.Count; r++)
            {
                var (v1, v2, _) = rows[r];
                var cuts = new SortedSet<double>();
                foreach (FloorUnit unit in layout.Units)
                {
                    double a = xLong ? unit.X1 : unit.Y1, b = xLong ? unit.X2 : unit.Y2;
                    double uv = xLong ? unit.Y1 : unit.X1;
                    if (Math.Abs(uv - v1) > 0.01) continue;
                    if (a > 0.01) cuts.Add(Math.Round(a, 4));
                    if (b < L - 0.01) cuts.Add(Math.Round(b, 4));
                }
                foreach (double cut in cuts) AddWall(layout, xLong, cut, v1, cut, v2, "party");
            }
            if (corePos != CorePosition.None && layout.Core != null)
                layout.Notes.Add("Шат, лифтийн хонгил коридор руу нээлттэй (нэг Room) — шат, лифтийн family-г архитектор тавина.");
            return layout;
        }

        /// <summary>Тоо n ба хослол бүрийг (харьцаанд 0-ээс их төрлүүдээр) туршиж хамгийн сайныг сонгоно.</summary>
        private static List<int>[] Search(double[] mix, List<Segment> segments, string tier, double depth, bool lit)
        {
            double total = segments.Sum(sg => sg.Length);
            double avg = Enumerable.Range(1, 4).Sum(b => mix[b - 1] * Wanted(tier, b, depth, NeedWidth(b, depth, lit, false)));
            int n0 = Math.Max(1, (int)Math.Round(total / Math.Max(1, avg)));
            int[] allowed = Enumerable.Range(0, 4).Where(k => mix[k] > 0).ToArray();
            List<int>[] best = null;
            double bestScore = double.MaxValue;
            var memo = new Dictionary<long, double>();   // хэсэг × найрлага → Fit (найрлага хоорондоо давтагддаг)
            for (int n = Math.Max(segments.Count, n0 - 3); n <= Math.Min(MaxUnits, n0 + 3); n++)
                foreach (int[] counts in Compositions(n, allowed))
                {
                    double dev = 0;
                    for (int k = 0; k < 4; k++) dev += Math.Abs((double)counts[k] / n - mix[k]);
                    dev /= 2;
                    if (dev > 0.5 || dev >= bestScore) continue;
                    var plan = Pack(counts, segments, tier, depth, lit, memo, out double fit);
                    if (plan == null) continue;
                    double score = dev + 0.5 * fit;
                    if (score < bestScore - 1e-12) { bestScore = score; best = plan; }
                }
            return best;
        }

        /// <summary>n-ийг зөвшөөрөгдсөн төрлүүдэд хуваах бүх хослол (index 0 = 1 унтлагын).</summary>
        private static IEnumerable<int[]> Compositions(int n, int[] allowed)
        {
            var counts = new int[4];
            IEnumerable<int[]> Rec(int i, int left)
            {
                if (i == allowed.Length - 1)
                {
                    counts[allowed[i]] = left;
                    yield return (int[])counts.Clone();
                    counts[allowed[i]] = 0;
                    yield break;
                }
                for (int c = 0; c <= left; c++)
                {
                    counts[allowed[i]] = c;
                    foreach (int[] r in Rec(i + 1, left - c)) yield return r;
                }
                counts[allowed[i]] = 0;
            }
            return allowed.Length == 0 ? Enumerable.Empty<int[]>() : Rec(0, n);
        }

        private sealed class Segment
        {
            public int Row;
            public double U1, U2;
            public bool OuterLow, OuterHigh;
            public double Length { get { return U2 - U1; } }
        }

        private static string Validate(FloorPlateInput i)
        {
            if (!(i.Width >= 8 && i.Width <= 200 && i.Height >= 8 && i.Height <= 200))
                return "Давхрын хэмжээ 8–200 м байх ёстой.";
            if (!(i.CorridorWidth >= 1.2 && i.CorridorWidth <= 3.0)) return "Коридорын өргөн 1.2–3.0 м.";
            if (!(i.WallThickness >= 0.08 && i.WallThickness <= 0.6)) return "Ханын зузаан 0.08–0.6 м.";
            if (!(i.ExteriorThickness >= 0 && i.ExteriorThickness <= 0.8)) return "Гадна ханын зузаан 0–0.8 м.";
            if (!(i.CoreWidth >= 3 && i.CoreWidth <= 15)) return "Шатны хонгилын өргөн 3–15 м.";
            if (i.Mix == null || i.Mix.Length != 4 || i.Mix.Any(x => !(x >= 0)) || i.Mix.Sum() <= 0)
                return "Айлын харьцаанаас дор хаяж нэг нь 0-ээс их байх ёстой.";
            return null;
        }

        /// <summary>Айлын хүссэн өргөн (м): зорилтот талбай ÷ гүн, доод хязгаараас (<paramref name="need"/>) багагүй.</summary>
        private static double Wanted(string tier, int bedrooms, double depth, double need)
        {
            // +5 см: хил 5 см-ийн торонд дугуйлагдахад айл доод хэмжээнээсээ доош орохгүй.
            return Math.Max(need + 0.05, TargetArea(tier, bedrooms) / depth);
        }

        /// <summary>`OrderForSegment`-ийн дараалалд i-р айл эгнээний гадна үзүүрт (хоёр талдаа цонхтой) байх уу.</summary>
        private static bool IsCorner(Segment seg, int i, int count)
        {
            return (i == 0 && seg.OuterLow) || (i == count - 1 && seg.OuterHigh);
        }

        private static double[] Normalize(double[] mix)
        {
            double s = mix.Sum();
            return mix.Select(x => x / s).ToArray();
        }

        /// <summary>n айлыг харьцаагаар хамгийн их үлдэгдлийн аргаар хуваана (index 0 = 1 унтлагын).</summary>
        internal static int[] Apportion(double[] mix, int n)
        {
            double[] exact = mix.Select(x => x * n).ToArray();
            int[] counts = exact.Select(x => (int)Math.Floor(x)).ToArray();
            int left = n - counts.Sum();
            foreach (int i in Enumerable.Range(0, mix.Length)
                .Where(i => mix[i] > 0).OrderByDescending(i => exact[i] - counts[i]).ThenBy(i => i))
            {
                if (left <= 0) break;
                counts[i]++; left--;
            }
            return counts;
        }

        /// <summary>
        /// Айлуудыг хэсгүүдэд хуваарилна: хэсэг бүрт төрөл тус бүрээс хэдийг авах вэ гэдгийг бүрэн хайна (хэсэг ≤ 3,
        /// айл ≤ 24).  Хэсгийн уртад айлын хүссэн өргөнийг сунгах/шахах коэффициент [0.85, 1.35] дотор, айл бүр
        /// доод өргөнөөсөө багагүй.  Оноо = коэффициент 1-ээс хамгийн их хазайлт (бага нь сайн).
        /// </summary>
        private static List<int>[] Pack(int[] counts, List<Segment> segments, string tier, double depth, bool lit,
            Dictionary<long, double> memo, out double score)
        {
            score = double.MaxValue;
            if (counts.Sum() < segments.Count) return null;
            int[][] best = null;
            double bestScore = double.MaxValue;
            var chosen = new int[segments.Count][];

            // Хэсэг дэх айлуудын байрлал нь `OrderForSegment` (том нь гадна үзүүрт) — булангийн айл хоёр талдаа цонхтой
            // тул дунд айлаас нарийн байж болно, тиймээс доод өргөн байрлалаас хамаарна.
            double Fit(int[] v, int si)
            {
                long key = (((si * 32L + v[0]) * 32 + v[1]) * 32 + v[2]) * 32 + v[3];
                if (memo.TryGetValue(key, out double cached)) return cached;
                var beds = new List<int>();
                for (int k = 3; k >= 0; k--) for (int i = 0; i < v[k]; i++) beds.Add(k + 1);
                double result = double.NaN;
                if (beds.Count > 0)
                {
                    Segment seg = segments[si];
                    List<int> order = OrderForSegment(beds, seg);
                    var need = new double[order.Count];
                    var want = new double[order.Count];
                    double used = 0;
                    for (int i = 0; i < order.Count; i++)
                    {
                        need[i] = NeedWidth(order[i], depth, lit, IsCorner(seg, i, order.Count));
                        want[i] = Wanted(tier, order[i], depth, need[i]);
                        used += want[i];
                    }
                    double f = seg.Length / used;
                    bool ok = f >= 0.85 && f <= 1.35;
                    for (int i = 0; ok && i < order.Count; i++)
                        if (want[i] * f < need[i] + 0.05) ok = false;
                    if (ok) result = Math.Abs(Math.Log(f));
                }
                memo[key] = result;
                return result;
            }

            void Rec(int s, int[] left, double worst)
            {
                if (worst >= bestScore) return;
                if (s == segments.Count - 1)
                {
                    double last = Fit(left, s);
                    if (double.IsNaN(last)) return;
                    chosen[s] = (int[])left.Clone();
                    double total = Math.Max(worst, last);
                    if (total < bestScore - 1e-12) { bestScore = total; best = chosen.Select(x => (int[])x.Clone()).ToArray(); }
                    return;
                }
                var v = new int[4];
                for (v[3] = 0; v[3] <= left[3]; v[3]++)
                for (v[2] = 0; v[2] <= left[2]; v[2]++)
                for (v[1] = 0; v[1] <= left[1]; v[1]++)
                for (v[0] = 0; v[0] <= left[0]; v[0]++)
                {
                    double fit = Fit(v, s);
                    if (double.IsNaN(fit)) continue;
                    chosen[s] = (int[])v.Clone();
                    Rec(s + 1, new[] { left[0] - v[0], left[1] - v[1], left[2] - v[2], left[3] - v[3] }, Math.Max(worst, fit));
                }
            }
            Rec(0, (int[])counts.Clone(), 0);
            if (best == null) return null;
            score = bestScore;
            return best.Select(v =>
            {
                var list = new List<int>();
                for (int k = 3; k >= 0; k--) for (int i = 0; i < v[k]; i++) list.Add(k + 1);
                return list;
            }).ToArray();
        }

        /// <summary>Том айлыг гадна булан (хоёр талдаа цонхтой) руу, жижгийг дунд руу.</summary>
        private static List<int> OrderForSegment(List<int> beds, Segment seg)
        {
            var sorted = beds.OrderByDescending(b => b).ToList();
            var result = new List<int>(new int[sorted.Count]);
            int lo = 0, hi = sorted.Count - 1;
            bool toLow = seg.OuterLow || !seg.OuterHigh;
            foreach (int b in sorted)
            {
                if (seg.OuterLow && seg.OuterHigh)
                {
                    if (toLow) result[lo++] = b; else result[hi--] = b;
                    toLow = !toLow;
                }
                else if (seg.OuterLow) result[lo++] = b;
                else result[hi--] = b;
            }
            return result;
        }

        private static void AddWall(FloorPlateLayout layout, bool xLong, double u1, double v1, double u2, double v2, string kind)
        {
            var w = new FloorWall { Kind = kind };
            MapRect(xLong, u1, v1, u2, v2, out w.X1, out w.Y1, out w.X2, out w.Y2);
            if (w.Length > 0.05) layout.Walls.Add(w);
        }

        private static void MapRect(bool xLong, double u1, double v1, double u2, double v2,
            out double x1, out double y1, out double x2, out double y2)
        {
            if (xLong) { x1 = u1; y1 = v1; x2 = u2; y2 = v2; }
            else { x1 = v1; y1 = u1; x2 = v2; y2 = u2; }
        }

        private static string F(double x) { return x.ToString("0.0#", System.Globalization.CultureInfo.InvariantCulture); }
    }
}
