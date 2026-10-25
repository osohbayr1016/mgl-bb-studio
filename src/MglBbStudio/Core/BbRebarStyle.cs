using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;

namespace MglBb.Core
{
    /// <summary>
    /// Төслийн арматурчлалын ХЭВ МАЯГ — загварт гараар тавьсан арматураас сурсан (<see cref="BbRebarStyleSamples"/>): хомут / C-хомут / хажуугийн Ø,
    /// хамгаалах үе (дээд нь гинжийн чиглэлээр — огтлолцолд нэг чиглэлийн дээд арматур нөгөөгийнхөөс доогуур), муруй арматурын тоо (өргөнөөр),
    /// @150 шилжилтийн бүс, bar type-ийн нэр (үүрэг + Ø).  ЖИШЭЭ-1: Ø8, 32/52; ЖИШЭЭ 3: Ø10, C Ø8, 30 / дээд 30 эсвэл 50 (чиглэлээр), шилжилтгүй.
    /// Компанийн горимд <see cref="Apply"/> preset-ийн анхдагчийг солино (мөрийн гар утга, элементийн cover үүнээс хойш).
    /// </summary>
    public sealed class BbRebarStyle
    {
        /// <summary>Хомутын Ø: огтлол «600x1150» → Ø; <see cref="StirrupD"/> = нийтлэг.</summary>
        public int StirrupD, TieD, SideD;
        /// <summary>C-хомутын тэнхлэгийн үзүүр нүүрээс (ЖИШЭЭ-1: 42, ЖИШЭЭ 3: 50).</summary>
        public double TieInset;
        public readonly Dictionary<string, int> StirrupDBySize = new Dictionary<string, int>();
        public double CoverSide, CoverBottom, CoverTop;
        /// <summary>Гинжийн чиглэл (0…179°, 15°-аар бүхэлчилсэн) → дээд хамгаалах үе.</summary>
        public readonly Dictionary<int, double> CoverTopByDir = new Dictionary<int, double>();
        /// <summary>Дамнурууны өргөн (мм) → муруй арматурын тоо; <see cref="BentD"/>.</summary>
        public readonly Dictionary<int, int> BentNByWidth = new Dictionary<int, int>();
        public int BentD;
        /// <summary>null = мэдэгдэхгүй; true = 100 → 150 → 200 (ЖИШЭЭ-1), false = шууд 100 → 200 (ЖИШЭЭ 3).</summary>
        public bool? Transition;
        /// <summary>Туслахын 3@50 бүлгийн хажуугийн @100 зурвас (мм; null = мэдэгдэхгүй) — ЖИШЭЭ-1: 700, ЖИШЭЭ 3: 0.</summary>
        public double? LoadPointBand;
        /// <summary>«stirrup:10» / «main:25» / «minor:12» / «bent:16» / «tie:8» → bar type-ийн нэр.</summary>
        public readonly Dictionary<string, string> TypeNames = new Dictionary<string, string>();
        /// <summary>Хэдэн гинжээс сурсан (0 = хоосон).</summary>
        public int Chains;

        public bool Empty { get { return Chains == 0; } }

        public static int Dir(double angleDeg)
        {
            double a = ((angleDeg % 180) + 180) % 180;
            int k = (int)Math.Round(a / 15) * 15;
            return k >= 180 ? 0 : k;
        }

        public static string SizeKey(double b, double h) { return Math.Round(b) + "x" + Math.Round(h); }

        /// <summary>Preset-д: компанийн анхдагчийн оронд сурсан утга (тодорхойгүй нь хэвээр).  <paramref name="dirDeg"/> = гинжийн чиглэл.</summary>
        public void Apply(BbBeamPreset p, double b, double h, double dirDeg)
        {
            if (Empty) return;
            int sd;
            if (StirrupDBySize.TryGetValue(SizeKey(b, h), out sd) || (sd = StirrupD) > 0) p.StirrupD = sd;
            if (TieD > 0) p.TieD = TieD;
            if (TieInset > 0) p.TieInset = TieInset;
            if (SideD > 0) p.SideD = SideD;
            if (CoverSide > 0) p.Cover = CoverSide;
            if (CoverBottom > 0) p.CoverBottom = CoverBottom;
            double ct;
            if (CoverTopByDir.TryGetValue(Dir(dirDeg), out ct) || (ct = CoverTop) > 0) p.CoverTop = ct;
            if (Transition.HasValue) p.AverageTransition = Transition.Value;
            if (LoadPointBand.HasValue) p.LoadPointBand = LoadPointBand.Value;
            if (p.Bent.Any)
            {
                int n;
                if (BentNByWidth.TryGetValue((int)(Math.Round(b / 50) * 50), out n) && n > 0) p.Bent = new BbBarSpec(n, BentD > 0 ? BentD : p.Bent.D);
                else if (BentD > 0) p.Bent = new BbBarSpec(p.Bent.N, BentD);
            }
            foreach (var kv in TypeNames) p.TypeNames[kv.Key] = kv.Value;
        }

        public string Describe()
        {
            if (Empty) return "Загварт гараар тавьсан арматур алга — компанийн анхдагч.";
            var parts = new List<string> { Chains + " гинжээс сурсан" };
            if (StirrupD > 0) parts.Add("хомут Ø" + StirrupD + (StirrupDBySize.Values.Any(v => v != StirrupD) ? " (" + string.Join(", ", StirrupDBySize.Where(kv => kv.Value != StirrupD).Select(kv => kv.Key + " → Ø" + kv.Value)) + ")" : ""));
            if (TieD > 0) parts.Add("C-хомут Ø" + TieD + (TieInset > 0 ? " (нүүрээс " + F(TieInset) + ")" : ""));
            if (SideD > 0) parts.Add("хажуугийн Ø" + SideD);
            if (CoverSide > 0) parts.Add("хамгаалах " + F(CoverSide) + "/" + F(CoverBottom) + ", дээд " + (CoverTopByDir.Values.Distinct().Count() > 1
                ? string.Join(" / ", CoverTopByDir.OrderBy(kv => kv.Key).Select(kv => F(kv.Value) + " (" + kv.Key + "°)")) : F(CoverTop)));
            if (BentNByWidth.Count > 0) parts.Add("муруй " + string.Join(", ", BentNByWidth.OrderBy(kv => kv.Key).Select(kv => "b" + kv.Key + " → " + kv.Value + "Ø" + BentD)));
            if (Transition.HasValue) parts.Add(Transition.Value ? "100 → 150 → 200" : "100 → 200 (шилжилтгүй)");
            if (LoadPointBand.HasValue) parts.Add(LoadPointBand.Value > 0 ? "туслахын хажууд @100 зурвас " + F(LoadPointBand.Value) : "туслахын хажууд зурвасгүй");
            return string.Join("; ", parts) + ".";
        }

        static string F(double v) { return v.ToString("0", CultureInfo.InvariantCulture); }

        public Dictionary<string, object> ToJson()
        {
            return new Dictionary<string, object>
            {
                { "chains", Chains }, { "stirrupD", StirrupD }, { "tieD", TieD }, { "tieInset", TieInset }, { "sideD", SideD }, { "bentD", BentD },
                { "coverSide", CoverSide }, { "coverBottom", CoverBottom }, { "coverTop", CoverTop },
                { "transition", Transition.HasValue ? (object)Transition.Value : null },
                { "lpBand", LoadPointBand.HasValue ? (object)LoadPointBand.Value : null },
                { "stirrupBySize", StirrupDBySize.ToDictionary(kv => kv.Key, kv => (object)kv.Value) },
                { "coverTopByDir", CoverTopByDir.ToDictionary(kv => kv.Key.ToString(CultureInfo.InvariantCulture), kv => (object)kv.Value) },
                { "bentByWidth", BentNByWidth.ToDictionary(kv => kv.Key.ToString(CultureInfo.InvariantCulture), kv => (object)kv.Value) },
                { "types", TypeNames.ToDictionary(kv => kv.Key, kv => (object)kv.Value) },
            };
        }

        public static BbRebarStyle FromJson(object o)
        {
            var s = new BbRebarStyle();
            if (o == null) return s;
            s.Chains = (int)BbJson.Num(o, "chains", 0);
            s.StirrupD = (int)BbJson.Num(o, "stirrupD", 0);
            s.TieD = (int)BbJson.Num(o, "tieD", 0);
            s.TieInset = BbJson.Num(o, "tieInset", 0);
            s.SideD = (int)BbJson.Num(o, "sideD", 0);
            s.BentD = (int)BbJson.Num(o, "bentD", 0);
            s.CoverSide = BbJson.Num(o, "coverSide", 0);
            s.CoverBottom = BbJson.Num(o, "coverBottom", 0);
            s.CoverTop = BbJson.Num(o, "coverTop", 0);
            var d = o as Dictionary<string, object>;
            object tr;
            if (d != null && d.TryGetValue("transition", out tr) && tr is bool) s.Transition = (bool)tr;
            object lb;
            if (d != null && d.TryGetValue("lpBand", out lb) && lb is double) s.LoadPointBand = (double)lb;
            foreach (var kv in BbJson.Obj(o, "stirrupBySize") ?? new Dictionary<string, object>()) s.StirrupDBySize[kv.Key] = (int)Convert.ToDouble(kv.Value, CultureInfo.InvariantCulture);
            foreach (var kv in BbJson.Obj(o, "coverTopByDir") ?? new Dictionary<string, object>())
                s.CoverTopByDir[int.Parse(kv.Key, CultureInfo.InvariantCulture)] = Convert.ToDouble(kv.Value, CultureInfo.InvariantCulture);
            foreach (var kv in BbJson.Obj(o, "bentByWidth") ?? new Dictionary<string, object>())
                s.BentNByWidth[int.Parse(kv.Key, CultureInfo.InvariantCulture)] = (int)Convert.ToDouble(kv.Value, CultureInfo.InvariantCulture);
            foreach (var kv in BbJson.Obj(o, "types") ?? new Dictionary<string, object>()) if (kv.Value is string) s.TypeNames[kv.Key] = (string)kv.Value;
            return s;
        }
    }

    /// <summary>
    /// Гар арматурын түүвэр (Revit тал бөглөнө: гинж бүрийн хомут, C-хомут, ажлын / хажуугийн / муруй арматур) → <see cref="Build"/> = моод (хамгийн
    /// олон давтагдсан) утгууд.  Хамгаалах үе = хомутын гадна ирмэгээс нүүр хүртэл (5 мм-ээр бүхэлчилсэн).
    /// </summary>
    public sealed class BbRebarStyleSamples
    {
        readonly List<int> stirD = new List<int>(), tieD = new List<int>(), sideD = new List<int>(), bentD = new List<int>();
        readonly List<double> tieInset = new List<double>();
        readonly Dictionary<string, List<int>> stirBySize = new Dictionary<string, List<int>>();
        readonly List<double> covSide = new List<double>(), covBot = new List<double>(), covTop = new List<double>();
        readonly Dictionary<int, List<double>> covTopByDir = new Dictionary<int, List<double>>();
        readonly Dictionary<int, List<int>> bentByW = new Dictionary<int, List<int>>();
        readonly List<double> spacings = new List<double>();
        /// <summary>Жишээний хомуттай таарсан тоо: [0] = шилжилтгүй, [1] = @150 шилжилттэй (<see cref="Transition"/>).</summary>
        readonly double[] transitionScore = new double[2];

        /// <summary>Нэг гинжийн жишээ хомутад хоёр хувилбарын таарц (Revit тал төлөвлөгөөг хоёуланг хийж тоолно).</summary>
        public void Transition(double withoutTransition, double withTransition) { transitionScore[0] += withoutTransition; transitionScore[1] += withTransition; }

        readonly double[] bandScore = new double[2];

        /// <summary>Туслахтай гинжид: зурвасгүй / 700 зурвастай төлөвлөгөөний жишээтэй таарсан тоо.</summary>
        public void Band(double without, double with700) { bandScore[0] += without; bandScore[1] += with700; }
        readonly Dictionary<string, List<string>> types = new Dictionary<string, List<string>>();
        readonly HashSet<string> chains = new HashSet<string>();

        static void Add<TK, TV>(Dictionary<TK, List<TV>> d, TK k, TV v)
        {
            List<TV> l;
            if (!d.TryGetValue(k, out l)) d[k] = l = new List<TV>();
            l.Add(v);
        }

        static double R5(double v) { return Math.Round(v / 5) * 5; }

        /// <summary>Битүү хомут: огтлол, чиглэл, Ø, гадна ирмэгийн хамгаалах үе (тал / доод / дээд; ≤ 0 = хэмжээгүй), алхам.</summary>
        public void Stirrup(string chain, double b, double h, double dirDeg, int d, string typeName, double side, double bottom, double top, double spacing)
        {
            chains.Add(chain);
            stirD.Add(d);
            Add(stirBySize, BbRebarStyle.SizeKey(b, h), d);
            // 1 мм-ээр (ЖИШЭЭ-1: 32 / 52 — 5-аар бүхэлчилбэл 30 / 50 болж байв), моод нь хэмжилтийн ±1–2-ыг шүүнэ.
            if (side > 5 && side < 100) covSide.Add(Math.Round(side));
            if (bottom > 5 && bottom < 100) covBot.Add(Math.Round(bottom));
            if (top > 5 && top < 120) { covTop.Add(Math.Round(top)); Add(covTopByDir, BbRebarStyle.Dir(dirDeg), Math.Round(top)); }
            if (spacing > 0) spacings.Add(Math.Round(spacing));
            Type("stirrup", d, typeName);
        }

        /// <param name="inset">Тэнхлэгийн үзүүр нүүрээс (мм; ≤ 0 = хэмжээгүй).</param>
        public void Tie(string chain, int d, string typeName, double inset = 0)
        {
            chains.Add(chain);
            tieD.Add(d);
            if (inset > 5 && inset < 120) tieInset.Add(Math.Round(inset));
            Type("tie", d, typeName);
        }

        public void Side(string chain, int d, string typeName) { chains.Add(chain); sideD.Add(d); Type("minor", d, typeName); }

        /// <summary>Ажлын арматур (дээд / доод): «main» эсвэл (Ø ≤ 12, голын дээд) «minor».</summary>
        public void Main(string chain, int d, string typeName, bool minor) { chains.Add(chain); Type(minor ? "minor" : "main", d, typeName); }

        public void Bent(string chain, double b, int n, int d, string typeName)
        {
            chains.Add(chain);
            Add(bentByW, (int)(Math.Round(b / 50) * 50), n);
            bentD.Add(d);
            Type("bent", d, typeName);
        }

        void Type(string role, int d, string name)
        {
            if (!string.IsNullOrEmpty(name)) Add(types, role + ":" + d, name);
        }

        static T Mode<T>(IEnumerable<T> v) { return v.GroupBy(x => x).OrderByDescending(g => g.Count()).Select(g => g.Key).FirstOrDefault(); }

        public BbRebarStyle Build()
        {
            var s = new BbRebarStyle { Chains = chains.Count };
            if (s.Chains == 0) return s;
            s.StirrupD = Mode(stirD);
            foreach (var kv in stirBySize) s.StirrupDBySize[kv.Key] = Mode(kv.Value);
            s.TieD = Mode(tieD);
            s.TieInset = Mode(tieInset);
            s.SideD = Mode(sideD);
            s.BentD = Mode(bentD);
            s.CoverSide = Mode(covSide);
            s.CoverBottom = Mode(covBot);
            s.CoverTop = Mode(covTop);
            foreach (var kv in covTopByDir) s.CoverTopByDir[kv.Key] = Mode(kv.Value);
            foreach (var kv in bentByW) s.BentNByWidth[kv.Key] = Mode(kv.Value);
            if (transitionScore[0] + transitionScore[1] > 0) s.Transition = transitionScore[1] > transitionScore[0];
            if (bandScore[0] + bandScore[1] > 0) s.LoadPointBand = bandScore[1] > bandScore[0] ? 700 : 0;
            foreach (var kv in types) s.TypeNames[kv.Key] = Mode(kv.Value);
            return s;
        }
    }
}

namespace MglBb.Core
{
    /// <summary>
    /// Баганын хэв маяг (гар арматураас): хомутын хамгаалах үе, саваа нүүрээс, хомут Ø / алхам, эхний хомут шалнаас, сүүлийн оройгоос, залгаасын
    /// бүлгийн өндөр (давхрын өндрөөр), тал дахь ширхгийн тоогоор дотоод хосын тоо.  ЖИШЭЭ-1: 30 / 70 / 230, H4700 → 1250, n8 → 2 хос;
    /// ЖИШЭЭ 3: 40 / 50 / 250, H4700 → 1500, n8 → 3 хос.
    /// </summary>
    public sealed class BbColumnStyle
    {
        public double Cover, BarInset, S, FirstTie, LastTieFromTop;
        public int TieD, Columns;
        /// <summary>Давхрын өндөр (50-аар) → залгаасын эхний бүлгийн өндөр шалнаас.</summary>
        public readonly Dictionary<int, double> StaggerByH = new Dictionary<int, double>();
        /// <summary>Тал дахь ширхэг → нэг чиглэлийн дотоод хосын тэгш өнцөгт.</summary>
        public readonly Dictionary<int, int> PairsByN = new Dictionary<int, int>();

        public bool Empty { get { return Columns == 0; } }

        public void Apply(BbColumnPreset p)
        {
            if (Empty) return;
            if (Cover > 0) p.Cover = Cover;
            if (BarInset > 0) p.BarInset = BarInset;
            if (TieD > 0) p.TieD = TieD;
            if (S > 0) { p.S = S; p.SDense = S; }
            if (FirstTie > 0) p.FirstTie = FirstTie;
            if (LastTieFromTop > 0) p.LastTieFromTop = LastTieFromTop;
            foreach (var kv in StaggerByH) p.StaggerByH[kv.Key] = kv.Value;
            foreach (var kv in PairsByN) p.PairsByN[kv.Key] = kv.Value;
        }

        public string Describe()
        {
            if (Empty) return "Багананд гар арматур алга — компанийн анхдагч.";
            var parts = new List<string> { Columns + " баганаас сурсан" };
            if (Cover > 0) parts.Add("хамгаалах " + F(Cover) + ", саваа нүүрээс " + F(BarInset));
            if (TieD > 0) parts.Add("хомут Ø" + TieD + " @" + F(S) + ", шалнаас " + F(FirstTie) + ", оройгоос " + F(LastTieFromTop));
            if (StaggerByH.Count > 0) parts.Add("залгаас " + string.Join(", ", StaggerByH.OrderBy(kv => kv.Key).Select(kv => "H" + kv.Key + " → " + F(kv.Value))));
            if (PairsByN.Count > 0) parts.Add("дотоод хос " + string.Join(", ", PairsByN.OrderBy(kv => kv.Key).Select(kv => kv.Key + " ширхэгт " + kv.Value)));
            return string.Join("; ", parts) + ".";
        }

        static string F(double v) { return v.ToString("0", CultureInfo.InvariantCulture); }

        public Dictionary<string, object> ToJson()
        {
            return new Dictionary<string, object>
            {
                { "columns", Columns }, { "cover", Cover }, { "inset", BarInset }, { "tieD", TieD }, { "s", S }, { "first", FirstTie }, { "last", LastTieFromTop },
                { "stagger", StaggerByH.ToDictionary(kv => kv.Key.ToString(CultureInfo.InvariantCulture), kv => (object)kv.Value) },
                { "pairs", PairsByN.ToDictionary(kv => kv.Key.ToString(CultureInfo.InvariantCulture), kv => (object)kv.Value) },
            };
        }

        public static BbColumnStyle FromJson(object o)
        {
            var s = new BbColumnStyle();
            if (o == null) return s;
            s.Columns = (int)BbJson.Num(o, "columns", 0);
            s.Cover = BbJson.Num(o, "cover", 0);
            s.BarInset = BbJson.Num(o, "inset", 0);
            s.TieD = (int)BbJson.Num(o, "tieD", 0);
            s.S = BbJson.Num(o, "s", 0);
            s.FirstTie = BbJson.Num(o, "first", 0);
            s.LastTieFromTop = BbJson.Num(o, "last", 0);
            foreach (var kv in BbJson.Obj(o, "stagger") ?? new Dictionary<string, object>())
                s.StaggerByH[int.Parse(kv.Key, CultureInfo.InvariantCulture)] = Convert.ToDouble(kv.Value, CultureInfo.InvariantCulture);
            foreach (var kv in BbJson.Obj(o, "pairs") ?? new Dictionary<string, object>())
                s.PairsByN[int.Parse(kv.Key, CultureInfo.InvariantCulture)] = (int)Convert.ToDouble(kv.Value, CultureInfo.InvariantCulture);
            return s;
        }
    }

    /// <summary>Баганын түүвэр → моод (<see cref="BbColumnStyle"/>).</summary>
    public sealed class BbColumnStyleSamples
    {
        readonly List<double> cover = new List<double>(), inset = new List<double>(), s = new List<double>(), first = new List<double>(), last = new List<double>();
        readonly List<int> tieD = new List<int>();
        readonly Dictionary<int, List<double>> stagger = new Dictionary<int, List<double>>();
        readonly Dictionary<int, List<int>> pairs = new Dictionary<int, List<int>>();
        readonly HashSet<string> cols = new HashSet<string>();

        static double R5(double v) { return Math.Round(v / 5) * 5; }

        /// <summary>Гадна битүү хомут: хамгаалах үе (гадна ирмэг), Ø, алхам, эхний / сүүлийн хомут (шалнаас / оройгоос).</summary>
        public void Ties(string col, double cov, int d, double spacing, double firstZ, double lastFromTop)
        {
            cols.Add(col);
            if (cov > 5 && cov < 100) cover.Add(Math.Round(cov));   // 1 мм-ээр (ЖИШЭЭ-4: 22 — 5-аар 20 болж байв)
            tieD.Add(d);
            if (spacing > 0) s.Add(Math.Round(spacing));
            if (firstZ > 0 && firstZ < 300) first.Add(R5(firstZ));
            if (lastFromTop > 0 && lastFromTop < 600) last.Add(R5(lastFromTop));
        }

        public void Bars(string col, double insetMin, int perSide, int pairsOneDir)
        {
            cols.Add(col);
            if (insetMin > 20 && insetMin < 150) inset.Add(Math.Round(insetMin));
            if (perSide >= 4 && pairsOneDir >= 0)
            {
                List<int> l;
                if (!pairs.TryGetValue(perSide, out l)) pairs[perSide] = l = new List<int>();
                l.Add(pairsOneDir);
            }
        }

        /// <summary>Залгаасын доод бүлгийн өндөр шалнаас (давхрын <paramref name="height"/>).</summary>
        public void Stagger(string col, double height, double z)
        {
            cols.Add(col);
            int k = (int)(Math.Round(height / 50) * 50);
            List<double> l;
            if (!stagger.TryGetValue(k, out l)) stagger[k] = l = new List<double>();
            l.Add(Math.Round(z / 50) * 50);
        }

        static T Mode<T>(IEnumerable<T> v) { return v.GroupBy(x => x).OrderByDescending(g => g.Count()).Select(g => g.Key).FirstOrDefault(); }

        public BbColumnStyle Build()
        {
            var st = new BbColumnStyle { Columns = cols.Count };
            if (st.Empty) return st;
            st.Cover = Mode(cover);
            st.BarInset = Mode(inset);
            st.TieD = Mode(tieD);
            st.S = Mode(s);
            st.FirstTie = Mode(first);
            st.LastTieFromTop = Mode(last);
            foreach (var kv in stagger) if (kv.Value.Count >= 2) st.StaggerByH[kv.Key] = Mode(kv.Value);
            foreach (var kv in pairs) st.PairsByN[kv.Key] = Mode(kv.Value);
            return st;
        }
    }
}
