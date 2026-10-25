using System;
using System.Collections.Generic;
using System.Linq;

namespace MglBb.Core
{
    /// <summary>Доод талын нөхцөл: суурь, ижил огтлол, бага зэрэг өөр (доод нь тахийсан), огцом өөр.</summary>
    public enum BbBelow { Foundation, Same, Cranked, Different }

    /// <summary>
    /// Баганын хомутын хэлбэр: зөвхөн гадна битүү; хосын тэгш өнцөгт (ЖИШЭЭ-1); завсрын ширхэг бүрд C; ээлжлэн C; гадна + дотоод битүү (нэг
    /// ширхгээр дотогш).  Auto = <see cref="BbColumnPreset.PairTies"/> / <see cref="BbColumnPreset.TieEveryBar"/>-аар.
    /// </summary>
    public enum BbColumnTieLayout { Auto, Outer, Pairs, CEvery, CAlternate, OuterInner }

    /// <summary>
    /// Нэг давхрын тэгш өнцөгт баганы геометр (мм): огтлол <see cref="B"/> (локал x) × <see cref="H"/> (локал y), өндөр 0…<see cref="Height"/>
    /// (доод нүүр = доод хучилтын дээд нүүр).  <see cref="Joint"/> = дээд талын хамгийн гүн дамнуруу / хучилтын зузаан (зангилаа).
    /// </summary>
    public sealed class BbColumnInput
    {
        public double B, H, Height, Joint;
        /// <summary>Дээд давхарт багана үргэлжилнэ: огтлол <see cref="AboveB"/>×<see cref="AboveH"/> (0 = ижил), доод булан нь энэ баганы
        /// локалд (<see cref="AboveX0"/>, <see cref="AboveY0"/>), өндөр <see cref="AboveHeight"/>.</summary>
        public bool ContinuesAbove;
        public double AboveB, AboveH, AboveX0, AboveY0, AboveHeight;
        public BbBelow Below = BbBelow.Same;
        /// <summary>Хуучин нэр: доор багана байхгүй.</summary>
        public bool OnFoundation { get { return Below == BbBelow.Foundation; } set { if (value) Below = BbBelow.Foundation; else if (Below == BbBelow.Foundation) Below = BbBelow.Same; } }
    }

    public sealed class BbColumnPreset
    {
        public string Concrete = "B25";
        public BbSteel Steel = BbSteel.A500;
        public BbExposure Exposure = BbExposure.Indoor;
        /// <summary>Нүүрээс хомутын гадна ирмэг хүртэл.</summary>
        public double Cover = 25;
        /// <summary>Нүүрээс ажлын арматурын төв (0 = хамгаалах + хомут + d/2).</summary>
        public double BarInset;
        /// <summary>B тал (x) ба H тал (y)-ын дагуух ширхэг (булан орно), диаметр.</summary>
        public int Nb = 2, Nh = 2, D = 16;
        public int TieD;
        /// <summary>Энгийн / нягт алхам (0 = нормоор: ≤ 15d, ≤ 500; нягт — холбоосын бүсэд ≤ 10d).</summary>
        public double S, SDense;
        /// <summary>Доод / дээд нягт бүсийн урт (0 = max(H, B, цэвэр өндрийн ⅙, 450) — сейсмийн хэв маяг); &lt; 0 = нягт бүсгүй.</summary>
        public double DenseLen;
        public double FirstTie = 50;
        /// <summary>Сүүлийн хомут дээд нүүрээс доош (0 = <see cref="TiesInJoint"/> / зангилаагаар).</summary>
        public double LastTieFromTop;
        public double SpacingStep = 50;
        /// <summary>Зангилаанд (дамнурууны өндөрт) хомут үргэлжлүүлэх.</summary>
        public bool TiesInJoint = true;
        /// <summary>Дээд давхартай давхцуулах урт (0 = норм; суналтын 1.2).</summary>
        public double Lap;
        /// <summary>Дотоод C-хомут: завсрын ширхэг бүрийг (true) эсвэл ээлжлэн (false).</summary>
        public bool TieEveryBar = true;

        /// <summary>
        /// Механик залгаас (ЖИШЭЭ-1): давхцалгүй, ширхгүүд ээлжлэн хоёр бүлэг — шалнаас <see cref="BbColumnPresets.StaggerZ"/> ба 2×; дотоод хомут
        /// = хөрш хоёр савааг тэврэх тэгш өнцөгт (<see cref="PairTies"/>).
        /// </summary>
        public bool Couplers;
        public bool PairTies;
        public BbColumnTieLayout TieLayout = BbColumnTieLayout.Auto;
        /// <summary>Норм зөрчихгүй: хамгаалах үе, хомутын алхам (≤ 15d, ≤ 500), давхцал = max(өгсөн, норм).</summary>
        public bool EnforceCode = true;

        public BbColumnPreset Clone()
        {
            var c = (BbColumnPreset)MemberwiseClone();
            c.StaggerByH = new Dictionary<int, double>(StaggerByH);
            c.PairsByN = new Dictionary<int, int>(PairsByN);
            return c;
        }
        /// <summary>Дээд огтлол тал бүрдээ ≤ <see cref="CrankMax"/> багасвал дээд <see cref="CrankLen"/>-д тахийлгана; их бол L хөл.</summary>
        public double CrankMax = 50, CrankLen = 800;
        /// <summary>Загвараас сурсан (<see cref="BbColumnStyle"/>): давхрын өндөр (50-аар) → залгаасын бүлгийн өндөр; тал дахь ширхэг → дотоод хос.</summary>
        public Dictionary<int, double> StaggerByH = new Dictionary<int, double>();
        public Dictionary<int, int> PairsByN = new Dictionary<int, int>();
        /// <summary>Орой / огцом өөрчлөлт: дээд нүүрээс <see cref="TopEndDrop"/> доош, дотогш <see cref="TopLeg"/> (0 = нормоор) хөл.</summary>
        public double TopEndDrop, TopLeg;
        /// <summary>Доод багана огцом өөр бол шинэ ширхэг доош суулгах (d-ээр, 0 = анкерлах урт).</summary>
        public double EmbedD;
    }

    public static class BbColumnPresets
    {
        /// <summary>Тал бүрийн ширхэг: төв хоорондын алхам ≤ <paramref name="pitch"/> (булан орно, ≥ 2).</summary>
        public static int PerSide(double side, double cc, double pitch)
        {
            return Math.Max(2, (int)Math.Ceiling((side - 2 * cc) / pitch - 1e-9) + 1);
        }

        /// <summary>Норм: Ø20, тал бүр ≤ 200 алхам, хамгаалах 25, хомут нормоор, давхцалтай.</summary>
        public static BbColumnPreset Code(double b, double h)
        {
            var p = new BbColumnPreset { D = 20 };
            double cc = p.Cover + 6 + p.D / 2.0;
            p.Nb = PerSide(b, cc, 200);
            p.Nh = PerSide(h, cc, 200);
            return p;
        }

        /// <summary>
        /// ЖИШЭЭ-1-ээс хэмжсэн (60 багана): хамгаалах 30, саваа нүүрээс 60, Ø28 (≥ 900) / Ø25, тал бүр ≤ 150 алхам; механик залгаас 2 бүлэг;
        /// хомут Ø10 A240 135° @100 бүх өндөрт, шалнаас +70, оройгоос −230; хосоор тэврэх дотоод хомут; тахир ≤ 50 / 800; орой −50, хөл 290;
        /// огцом өөрчлөлтөд доош 66d.
        /// </summary>
        public static BbColumnPreset Company(double b, double h)
        {
            var p = new BbColumnPreset
            {
                Cover = 30, BarInset = 60, D = Math.Min(b, h) >= 900 ? 28 : 25, TieD = 10, S = 100, SDense = 100, DenseLen = -1, FirstTie = 70, LastTieFromTop = 230,
                Couplers = true, PairTies = true, TieEveryBar = false, CrankMax = 50, CrankLen = 800, TopEndDrop = 50, TopLeg = 290, EmbedD = 66,
            };
            p.Nb = PerSide(b, p.BarInset, 150);
            p.Nh = PerSide(h, p.BarInset, 150);
            return p;
        }

        /// <summary>Залгаасын эхний бүлгийн өндөр шалнаас (ЖИШЭЭ-1: H 4000 → 1200, 4500 → 1250, ≈5000 → 1500, 8800 → 3200).</summary>
        /// <summary>Сурсан (<paramref name="learned"/>: ойрын давхрын өндөр ±300 дотор, өндрийн харьцаагаар) эсвэл <see cref="StaggerZ(double)"/>.</summary>
        public static double StaggerZ(double height, IDictionary<int, double> learned)
        {
            if (learned != null && learned.Count > 0)
            {
                var best = learned.OrderBy(kv => Math.Abs(kv.Key - height)).First();
                if (Math.Abs(best.Key - height) <= 300) return BbRebarCode.FloorTo(best.Value * height / best.Key + 1e-6, 50);
            }
            return StaggerZ(height);
        }

        public static double StaggerZ(double height)
        {
            if (height <= 4200) return 1200;
            if (height <= 4700) return 1250;
            if (height <= 6000) return 1500;
            return BbRebarCode.FloorTo(height / 2.75, 50);
        }
    }

    public struct BbColumnBar
    {
        public double X, Y;
        public bool Corner;
        /// <summary>Залгаасын бүлэг (0 / 1, периметрээр ээлжлэн).</summary>
        public int Group;
        /// <summary>Тэнхлэгийн шугамын цэгүүд (x, y, z), доороос дээш.</summary>
        public List<double[]> Path;
    }

    /// <summary>Хомутын бүлэг: эхний хомут <see cref="Z0"/>, <see cref="Count"/>, <see cref="Spacing"/>.</summary>
    public sealed class BbTieSet
    {
        public double Z0, Spacing;
        public int Count;
        public double Z1 { get { return Z0 + (Count - 1) * Spacing; } }
    }

    /// <summary>Огтлол дахь нэг хомут: битүү (<see cref="Closed"/>, X0…X1 × Y0…Y1 гадна ирмэг) эсвэл C (шулуун, (X0,Y0) → (X1,Y1) төв шугам).</summary>
    public sealed class BbTieShape
    {
        public bool Closed;
        public double X0, Y0, X1, Y1;
    }

    public sealed class BbColumnRebar
    {
        public List<BbColumnBar> Bars = new List<BbColumnBar>();
        /// <summary>Бүлэг 0-ийн ажлын арматурын доод / дээд өндөр (Z0 = 0 = доод нүүр), дээд хөл (зангилаанд дотогш, 0 = шулуун).</summary>
        public double BarZ0, BarZ1, TopHook;
        public int D, TieD;
        public double Lap, S, SDense;
        public List<BbTieSet> Ties = new List<BbTieSet>();
        public List<BbTieShape> Shapes = new List<BbTieShape>();
        public List<string> Warnings = new List<string>();
    }

    /// <summary>
    /// Баганы арматур (СП 52-101 + ЖИШЭЭ-1): ажлын арматур nb×nh периметрээр.  Давхцалтай горим — дээд давхар ижил бол дээд нүүрээс дээш давхцал,
    /// эс бол зангилаанд L.  Механик залгаасын горим — хоёр бүлэг ээлжлэн (шалнаас z ба 2z), дээд давхрын адил өндөр хүртэл; бага зэрэг
    /// багасвал тахир, их бол L, доод нь огцом өөр бол доош суулгана.  Хомут гадна битүү + C эсвэл хосоор тэврэх тэгш өнцөгт.
    /// </summary>
    public static class BbColumnRebarPlan
    {
        public static BbColumnRebar Plan(BbColumnInput c, BbColumnPreset p)
        {
            var r = new BbColumnRebar { D = p.D };
            int td = p.TieD > 0 ? p.TieD : BbRebarCode.MinStirrupDiameter(p.D, 0);
            r.TieD = td;
            if (td < BbRebarCode.MinStirrupDiameter(p.D, 0)) r.Warnings.Add("Хомут Ø" + td + " < 0.25·Ø" + p.D + ".");
            double minCov = Math.Max(BbRebarCode.MinCover(td, p.Exposure), BbRebarCode.MinCover(p.D, p.Exposure) - td);
            double cover = p.Cover;
            if (cover + 1e-6 < minCov)
            {
                r.Warnings.Add("Хамгаалах үе " + cover + " мм нормоос бага" + (p.EnforceCode ? " — " + minCov + " болгов." : "."));
                if (p.EnforceCode) cover = minCov;
            }
            p = p.Clone();
            p.Cover = cover;
            int nb = Math.Max(2, p.Nb), nh = Math.Max(2, p.Nh);
            double cc = p.BarInset > 0 ? p.BarInset : p.Cover + td + p.D / 2.0;   // нүүрээс ажлын арматурын төв
            // Ажлын арматурын төв хоорондын алхам ≤ 400 (СП 52-101) — хэтэрвэл ширхэг нэмнэ.
            int nb0 = nb, nh0 = nh;
            if (p.EnforceCode)
            {
                while ((c.B - 2 * cc) / (nb - 1) > 400 + 1e-6) nb++;
                while ((c.H - 2 * cc) / (nh - 1) > 400 + 1e-6) nh++;
                if (nb != nb0 || nh != nh0) r.Warnings.Add("Ажлын арматурын алхам > 400 — " + nb0 + "×" + nh0 + " → " + nb + "×" + nh + " болгов.");
            }
            if (cc < p.Cover + td + p.D / 2.0 - 1e-6) r.Warnings.Add("Саваа хомутын гадна гарна (нүүрээс " + cc + ").");
            double x0 = cc, x1 = c.B - cc, y0 = cc, y1 = c.H - cc;
            double clearX = (x1 - x0) / (nb - 1) - p.D, clearY = (y1 - y0) / (nh - 1) - p.D;
            double minClear = BbRebarCode.MinClear(p.D, false);
            if (clearX < minClear - 1e-6 || clearY < minClear - 1e-6) r.Warnings.Add(nb + "×" + nh + "Ø" + p.D + " багтахгүй (цэвэр зай < " + minClear + ").");
            if (Math.Max(clearX, clearY) + p.D > 400 + 1e-6) r.Warnings.Add("Ажлын арматурын алхам 400-аас их (≤ 400).");

            // Периметрийн дарааллаар (бүлэг ээлжлэх): доод тал зүүнээс баруун, баруун тал дээш, дээд тал баруунаас зүүн, зүүн тал доош.
            var ring = new List<double[]>();
            for (int i = 0; i < nb; i++) ring.Add(new[] { Lerp(x0, x1, i, nb), y0 });
            for (int j = 1; j < nh; j++) ring.Add(new[] { x1, Lerp(y0, y1, j, nh) });
            for (int i = nb - 2; i >= 0; i--) ring.Add(new[] { Lerp(x0, x1, i, nb), y1 });
            for (int j = nh - 2; j >= 1; j--) ring.Add(new[] { x0, Lerp(y0, y1, j, nh) });
            double area = ring.Count * BbRebarCode.Area(p.D), ratio = area / (c.B * c.H);
            if (ratio < 0.001) r.Warnings.Add("μ = " + (ratio * 100).ToString("0.00") + " % < 0.1 %.");
            if (ratio > 0.04) r.Warnings.Add("μ = " + (ratio * 100).ToString("0.00") + " % > 4 %.");

            double codeLap = BbRebarCode.Lap(p.D, p.Steel, p.Concrete);
            r.Lap = p.Couplers ? 0 : p.Lap > 0 ? (p.EnforceCode ? Math.Max(p.Lap, codeLap) : p.Lap) : codeLap;
            if (!p.Couplers && p.Lap > 0 && p.Lap < codeLap - 1e-6) r.Warnings.Add("Давхцал " + p.Lap + " < нормын " + codeLap + (p.EnforceCode ? " — нормынхыг авлаа." : "."));
            double lan = BbRebarCode.Anchorage(p.D, p.Steel, p.Concrete, tension: true);
            bool same = c.ContinuesAbove && (c.AboveB <= 0 || Math.Abs(c.AboveB - c.B) < 1) && (c.AboveH <= 0 || Math.Abs(c.AboveH - c.H) < 1)
                && Math.Abs(c.AboveX0) < 1 && Math.Abs(c.AboveY0) < 1;
            double topEnd = c.Height - (p.TopEndDrop > 0 ? p.TopEndDrop : p.Cover + td + p.D / 2.0);
            double straight = Math.Max(0, c.Joint - (c.Height - topEnd));
            double leg = p.TopLeg > 0 ? p.TopLeg : straight >= lan ? 0 : BbRebarCode.CeilTo(Math.Max(12 * p.D, lan - straight), BbRebarCode.Round);
            double zFloor = p.Couplers ? BbColumnPresets.StaggerZ(c.Height, p.StaggerByH) : 0;
            double zUp = p.Couplers ? BbColumnPresets.StaggerZ(c.AboveHeight > 0 ? c.AboveHeight : c.Height, p.StaggerByH) : 0;
            double embed = p.EmbedD > 0 ? p.EmbedD * p.D : lan;
            bool anyStop = false, anyCrank = false;

            for (int k = 0; k < ring.Count; k++)
            {
                double x = ring[k][0], y = ring[k][1];
                int g = p.Couplers ? k % 2 : 0;
                var bar = new BbColumnBar
                {
                    X = x, Y = y, Group = g, Path = new List<double[]>(),
                    Corner = (Math.Abs(x - x0) < 1e-6 || Math.Abs(x - x1) < 1e-6) && (Math.Abs(y - y0) < 1e-6 || Math.Abs(y - y1) < 1e-6),
                };
                // Доод төгсгөл.
                double zs = c.Below == BbBelow.Different ? -embed : c.Below == BbBelow.Cranked || !p.Couplers ? 0 : zFloor * (g + 1);
                bar.Path.Add(new[] { x, y, zs });
                // Дээд төгсгөл.
                double ux = x, uy = y;
                bool crank = false, stop = !c.ContinuesAbove;
                if (c.ContinuesAbove && !same)
                {
                    double ab = c.AboveB > 0 ? c.AboveB : c.B, ah = c.AboveH > 0 ? c.AboveH : c.H;
                    ux = Clamp(x, c.AboveX0 + cc, c.AboveX0 + ab - cc);
                    uy = Clamp(y, c.AboveY0 + cc, c.AboveY0 + ah - cc);
                    double off = Math.Max(Math.Abs(ux - x), Math.Abs(uy - y));
                    if (off <= 1e-6) { }
                    else if (off <= p.CrankMax + 1e-6) crank = true;
                    else stop = true;
                }
                if (stop)
                {
                    anyStop = true;
                    bar.Path.Add(new[] { x, y, topEnd });
                    if (leg > 0)
                    {
                        // Хөл баганын төв рүү: голоос хол тэнхлэгийн дагуу.
                        bool alongX = Math.Abs(x - c.B / 2) / c.B >= Math.Abs(y - c.H / 2) / c.H;
                        double hx = alongX ? (x < c.B / 2 ? leg : -leg) : 0, hy = alongX ? 0 : (y < c.H / 2 ? leg : -leg);
                        bar.Path.Add(new[] { x + hx, y + hy, topEnd });
                    }
                }
                else if (crank)
                {
                    anyCrank = true;
                    bar.Path.Add(new[] { x, y, c.Height - p.CrankLen });
                    bar.Path.Add(new[] { ux, uy, c.Height });
                    if (!p.Couplers) bar.Path.Add(new[] { ux, uy, c.Height + r.Lap });
                }
                else bar.Path.Add(new[] { x, y, c.Height + (p.Couplers ? zUp * (g + 1) : r.Lap) });
                r.Bars.Add(bar);
            }
            BbColumnBar b0 = r.Bars[0];
            r.BarZ0 = b0.Path[0][2];
            r.BarZ1 = b0.Path.Count > 1 ? b0.Path[anyStop ? 1 : b0.Path.Count - 1][2] : 0;
            r.TopHook = anyStop ? leg : 0;
            if (anyStop && c.ContinuesAbove) r.Warnings.Add("Дээд давхрын огтлол өөр — дээд баганы шинэ арматур энэ баганад доош суулгана (dowel).");
            if (anyCrank && p.CrankLen < 6 * p.CrankMax) r.Warnings.Add("Тахирын налуу 1:6-аас эгц.");
            if (c.Below == BbBelow.Foundation) r.Warnings.Add("Суурь дээр — сууриас гарц арматур тавигдсан байх ёстой (энэ хэрэгсэл суурийг арматурлахгүй).");

            // Хомутын алхам.
            r.S = p.S > 0 ? p.S : BbRebarCode.FloorTo(Math.Min(15 * p.D, 500), p.SpacingStep);
            r.SDense = p.SDense > 0 ? p.SDense : BbRebarCode.FloorTo(Math.Min(10 * p.D, r.S), p.SpacingStep);
            double sMax = BbRebarCode.FloorTo(Math.Min(15 * p.D, 500), p.SpacingStep);
            if (r.S > Math.Min(15 * p.D, 500) + 1e-6)
            {
                r.Warnings.Add("Хомутын алхам " + r.S + " > 15d / 500" + (p.EnforceCode ? " — " + sMax + " болгов." : "."));
                if (p.EnforceCode) r.S = sMax;
            }
            if (r.SDense > r.S) r.SDense = r.S;
            double top = p.LastTieFromTop > 0 ? c.Height - p.LastTieFromTop : (p.TiesInJoint ? c.Height : c.Height - c.Joint) - p.FirstTie;
            double bot = p.FirstTie;
            double clearH = c.Height - c.Joint;
            double dense = p.DenseLen < 0 ? 0 : p.DenseLen > 0 ? p.DenseLen : BbRebarCode.CeilTo(Math.Max(Math.Max(c.H, c.B), Math.Max(clearH / 6, 450)), p.SpacingStep);
            // Доод нягт бүс ≥ давхцал (доод давхрын арматуртай холбогдох бүс).
            double denseBot = dense > 0 ? Math.Max(dense, c.OnFoundation ? 0 : r.Lap) : 0;
            r.Ties = Zones(bot, top, denseBot, dense, r.SDense, r.S);

            // Хомутын хэлбэр: гадна битүү + дотоод.
            r.Shapes.Add(new BbTieShape { Closed = true, X0 = p.Cover, Y0 = p.Cover, X1 = c.B - p.Cover, Y1 = c.H - p.Cover });
            BbColumnTieLayout lay = p.TieLayout != BbColumnTieLayout.Auto ? p.TieLayout
                : p.PairTies ? BbColumnTieLayout.Pairs : p.TieEveryBar ? BbColumnTieLayout.CEvery : BbColumnTieLayout.CAlternate;
            if (lay == BbColumnTieLayout.Outer) { }
            else if (lay == BbColumnTieLayout.OuterInner)
            {
                // Дотоод битүү: тал бүрээс нэг ширхгээр дотогш (≥ 4 ширхэгтэй талд), эс бол тэр чиглэлд бүтэн.
                double ix0 = nb >= 4 ? Lerp(x0, x1, 1, nb) - p.D / 2.0 - td : p.Cover, ix1 = nb >= 4 ? Lerp(x0, x1, nb - 2, nb) + p.D / 2.0 + td : c.B - p.Cover;
                double iy0 = nh >= 4 ? Lerp(y0, y1, 1, nh) - p.D / 2.0 - td : p.Cover, iy1 = nh >= 4 ? Lerp(y0, y1, nh - 2, nh) + p.D / 2.0 + td : c.H - p.Cover;
                if (nb >= 4 || nh >= 4) r.Shapes.Add(new BbTieShape { Closed = true, X0 = ix0, X1 = ix1, Y0 = iy0, Y1 = iy1 });
            }
            else if (lay == BbColumnTieLayout.Pairs)
            {
                InnerPairs(r, nb, x0, x1, true, c, p, td);
                InnerPairs(r, nh, y0, y1, false, c, p, td);
            }
            else
            {
                for (int i = 1; i < nb - 1; i++)
                    if (lay == BbColumnTieLayout.CEvery || i % 2 == 0 || i == nb - 2 && nb % 2 == 1)
                    {
                        double x = Lerp(x0, x1, i, nb);
                        r.Shapes.Add(new BbTieShape { X0 = x, Y0 = p.Cover + td / 2.0, X1 = x, Y1 = c.H - p.Cover - td / 2.0 });
                    }
                for (int j = 1; j < nh - 1; j++)
                    if (lay == BbColumnTieLayout.CEvery || j % 2 == 0 || j == nh - 2 && nh % 2 == 1)
                    {
                        double y = Lerp(y0, y1, j, nh);
                        r.Shapes.Add(new BbTieShape { X0 = p.Cover + td / 2.0, Y0 = y, X1 = c.B - p.Cover - td / 2.0, Y1 = y });
                    }
            }
            return r;
        }

        /// <summary>
        /// ЖИШЭЭ-1: завсрын савааг хосоор тэврэх тэгш өнцөгт (нөгөө чиглэлд бүтэн өргөнтэй) — n ≤ 5: 1, 6…10: 2, ≥ 11: 3, жигд тархсан; завсрын
        /// тоо сондгой ба n ≤ 9 бол голын саваа C-хомуттай.
        /// </summary>
        static void InnerPairs(BbColumnRebar r, int n, double a0, double a1, bool alongX, BbColumnInput c, BbColumnPreset p, int td)
        {
            int m = n - 2;
            if (m < 2) return;
            int k = n <= 5 ? 1 : n <= 10 ? 2 : 3;
            int learnedK;
            if (p.PairsByN != null && p.PairsByN.TryGetValue(n, out learnedK) && learnedK > 0) k = learnedK;   // ЖИШЭЭ 3: 8 ширхэгт 3 хос
            k = Math.Min(k, m / 2);
            var enclosed = new HashSet<int>();
            for (int j = 0; j < k; j++)
            {
                int s = k == 1 ? 1 + (m - 2) / 2 : 1 + (int)Math.Round((double)j * (m - 2) / (k - 1));
                enclosed.Add(s); enclosed.Add(s + 1);
                double lo = Lerp(a0, a1, s, n) - p.D / 2.0 - td, hi = Lerp(a0, a1, s + 1, n) + p.D / 2.0 + td;
                r.Shapes.Add(alongX
                    ? new BbTieShape { Closed = true, X0 = lo, X1 = hi, Y0 = p.Cover, Y1 = c.H - p.Cover }
                    : new BbTieShape { Closed = true, Y0 = lo, Y1 = hi, X0 = p.Cover, X1 = c.B - p.Cover });
            }
            int mid = n / 2;
            if (m % 2 == 1 && n <= 9 && !enclosed.Contains(mid))
            {
                double v = Lerp(a0, a1, mid, n);
                r.Shapes.Add(alongX
                    ? new BbTieShape { X0 = v, X1 = v, Y0 = p.Cover + td / 2.0, Y1 = c.H - p.Cover - td / 2.0 }
                    : new BbTieShape { Y0 = v, Y1 = v, X0 = p.Cover + td / 2.0, X1 = c.B - p.Cover - td / 2.0 });
            }
        }

        static double Lerp(double a, double b, int i, int n) { return a + (b - a) * i / (n - 1); }
        static double Clamp(double v, double lo, double hi) { return v < lo ? lo : v > hi ? hi : v; }

        /// <summary>
        /// <paramref name="z0"/>…<paramref name="z1"/>: доор <paramref name="lenBot"/>, дээр <paramref name="lenTop"/> урт нягт (<paramref name="sd"/>),
        /// дунд нь <paramref name="s"/> (жигд, ≤ s).  Нягт бүсүүд давхцвал бүхэлдээ нягт.
        /// </summary>
        public static List<BbTieSet> Zones(double z0, double z1, double lenBot, double lenTop, double sd, double s)
        {
            var res = new List<BbTieSet>();
            if (z1 - z0 < 1) return res;
            if (lenBot + lenTop >= z1 - z0 - s || lenBot + lenTop <= 0)
            {
                double step = lenBot + lenTop > 0 ? sd : s;
                int m = Math.Max(1, (int)Math.Ceiling((z1 - z0) / step - 1e-9));
                res.Add(new BbTieSet { Z0 = z0, Count = m + 1, Spacing = (z1 - z0) / m });
                return res;
            }
            int nb = lenBot > 0 ? (int)Math.Ceiling(lenBot / sd - 1e-9) : 0, nt = lenTop > 0 ? (int)Math.Ceiling(lenTop / sd - 1e-9) : 0;
            double a = z0 + nb * sd, b = z1 - nt * sd;
            if (nb > 0) res.Add(new BbTieSet { Z0 = z0, Count = nb + 1, Spacing = sd });
            int mm = Math.Max(1, (int)Math.Ceiling((b - a) / s - 1e-9));
            double sp = (b - a) / mm;
            // Нягт бүсийн сүүлийн хомут = голын эхний; давхардуулахгүй.
            int first = nb > 0 ? 1 : 0, last = nt > 0 ? mm - 1 : mm;
            if (last >= first) res.Add(new BbTieSet { Z0 = a + first * sp, Count = last - first + 1, Spacing = sp });
            if (nt > 0) res.Add(new BbTieSet { Z0 = b, Count = nt + 1, Spacing = sd });
            return res;
        }
    }
}
