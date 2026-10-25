using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;

namespace MglBb.Core
{
    /// <summary>Дамнурууны тэнхлэгийн дагуух тулгуур (багана / дамнуруу): <see cref="Lo"/>…<see cref="Hi"/> = нүүр хооронд, мм.</summary>
    public struct BbSupport
    {
        public double Lo, Hi;
        public BbSupport(double lo, double hi) { Lo = Math.Min(lo, hi); Hi = Math.Max(lo, hi); }
        public double Mid { get { return (Lo + Hi) / 2; } }
    }

    /// <summary>Дамнурууны геометр: тэнхлэг 0…<see cref="Length"/> (төгсгөлийн нүүр хүртэл), огтлол <see cref="B"/>×<see cref="H"/>, мм.</summary>
    public sealed class BbBeamInput
    {
        public double Length, B, H;
        public List<BbSupport> Supports = new List<BbSupport>();
        /// <summary>Энэ дамнуруунд тулсан туслах дамнуруу (ачааллын цэг).</summary>
        public List<BbLoadPoint> LoadPoints = new List<BbLoadPoint>();
        /// <summary>
        /// Төгсгөл нь өөр огтлолтой хэсэгтэй тулгуургүй залгагдана (Alpha BIM маягийн хувьсах огтлол): арматур хөрш хэсэг рүү анкерлах уртаар
        /// шулуун үргэлжилнэ, хомут төгсгөл хүртэл.
        /// </summary>
        public bool JoinStart, JoinEnd;
        /// <summary>
        /// Өргөн ба дээд нүүр ижил, өндөр нь өөр хөрш хэсэгтэй тулгуур (багана) дээр залгагдана — дээд арматур тасралтгүй (ЖИШЭЭ-4 ДН-4 400×600 /
        /// 400×500): <see cref="ContinueTopEnd"/> &gt; 0 = эцсийн тулгуурын дээд арматурыг ЭНЭ хэсэг тавьж хөршийн алгаслын (мм) ⅓ хүртэл цааш
        /// үргэлжлүүлнэ (хөрш нь консол бол — <see cref="ContinueTopEndTip"/>, үзүүр хүртэл, хөл нь консолын өндөр <see cref="ContinueTopEndH"/>-аар);
        /// <see cref="ContinueTopStart"/> = эхний тулгуурын дээд арматурыг өмнөх хэсэг тавьсан — энд тавихгүй.
        /// </summary>
        public double ContinueTopEnd;
        public bool ContinueTopStart, ContinueTopEndTip;
        public double ContinueTopEndH;
        /// <summary>Тэр тулгуурын цаана ижил өргөнтэй ГҮН хэсэг: доод арматур хөлгүй, баганыг дайрч гүн хэсэгт шулуун зоогдоно (ЖИШЭЭ-4 FX2–FX3).</summary>
        public bool StraightBottomStart, StraightBottomEnd;
        /// <summary>
        /// Консолын үзүүрийг хөндлөн (хаалтын) дамнуруу дайрна: ажлын / хажуугийн арматур түүний алс нүүр хүртэл энэ хэмжээгээр (мм) цааш
        /// (ЖИШЭЭ-4 ДН-4: консол ТДН-3-ын тэнхлэгт дуусна, арматур ТДН-3-ын алс нүүрээс 30 / 50 дотор).
        /// </summary>
        public double TipExtStart, TipExtEnd;
    }

    /// <summary>Туслах дамнурууны тэнхлэгийн дагуух өргөн <see cref="Lo"/>…<see cref="Hi"/>, доод нүүр нь дамнурууны дээд нүүрээс доош <see cref="SoffitDepth"/>.</summary>
    public struct BbLoadPoint
    {
        public double Lo, Hi, SoffitDepth;
        public BbLoadPoint(double lo, double hi, double soffitDepth) { Lo = Math.Min(lo, hi); Hi = Math.Max(lo, hi); SoffitDepth = soffitDepth; }
        public double Mid { get { return (Lo + Hi) / 2; } }
    }

    /// <summary>
    /// Нэг төрөл / маркийн дамнурууны тохиргоо (preset).  0 = нормоос автоматаар.  <see cref="AddTopBySupport"/> /
    /// <see cref="AddBottomBySpan"/> = LIRA-ийн санал эсвэл инженерийн засвар (null мөр = <see cref="AddTop"/> / <see cref="AddBottom"/>).
    /// </summary>
    public sealed class BbBeamPreset
    {
        public string Concrete = "B25";
        public BbSteel Steel = BbSteel.A500;
        public BbExposure Exposure = BbExposure.Indoor;

        /// <summary>Нүүрээс хомутын гадна ирмэг хүртэл.</summary>
        public double Cover = 25;

        public BbBarSpec Top = new BbBarSpec(2, 16);
        public BbBarSpec Bottom = new BbBarSpec(2, 16);
        public BbBarSpec AddTop, AddBottom;
        public BbBarSpec?[] AddTopBySupport, AddBottomBySpan;

        public int StirrupD;
        /// <summary>Тулгуурын бүс / голын алхам.</summary>
        public double S1, S2;
        /// <summary>1 = жигд (<see cref="S1"/>), 3 = тулгуурын хоёр бүс (алгаслын ¼) + гол.</summary>
        public int Zones = 3;
        /// <summary>Гараар: «4*200+5*300» — тулгуурын нүүрээс; үлдсэнийг баруун нүүрт нэг хомутаар хаана.</summary>
        public string StirrupPattern;

        public double FirstStirrup = 50;
        public double SpacingStep = 50;
        public double MaxBarLength = 11700;

        /// <summary>Дунд тулгуурын нэмэлт дээд арматур нүүрээс (том алгаслын) ⅓, захын тулгуураас ¼.</summary>
        public double AddTopInner = 1.0 / 3, AddTopEnd = 0.25;
        /// <summary>Нэмэлт доод арматур нүүр бүрээс алгаслын 0.1-д тасарна.</summary>
        public double AddBottomCut = 0.1;
        /// <summary>Хэрэглэгч: нэмэлт доод арматур үргэлж 2-р эгнээнд, үндсэн доодоос дээш энэ цэвэр зайтай (0 = нормын хамгийн бага / нэг эгнээ).</summary>
        public double AddBottomRowGap = 60;

        /// <summary>Дээд нүүрийн хамгаалах үе (0 = <see cref="Cover"/>).</summary>
        public double CoverTop;
        /// <summary>Тулгуурын бүсийн урт = цэвэр алгаслын хувь (норм ¼).</summary>
        public double ZoneFrac = 0.25;
        /// <summary>Бүс солигдох завсар = (s1 + s2)/2 (ЖИШЭЭ-1: 100 → 150 → 200).</summary>
        public bool AverageTransition;
        /// <summary>Шилжилтгүй бүсийг жишээний тоолох дүрмээр (<see cref="ThreeZones"/>; компани).</summary>
        public bool ExampleZones;
        /// <summary>Дээд / голын арматурын төгсгөлийг тулгуурын нүүрээс энэ алхмаар бүхэлдэнэ (0 = үгүй; компани 50).</summary>
        public double EndStep;
        /// <summary>Туслах дамнурууны 3@50 бүлгийн хажууд s1-ийн зурвас (мм; ЖИШЭЭ-1 ≈ 700, ЖИШЭЭ 3 — 0).</summary>
        public double LoadPointBand;

        /// <summary>
        /// Компанийн дээд арматур: <see cref="Top"/> = тулгуурын дээд (нүүрээс <see cref="SupportTopFrac"/>·l + <see cref="SpanTopLap"/>),
        /// алгаслын голд <see cref="SpanTop"/> (⅓…⅔) доор нь, <see cref="SpanTopLap"/>-аар давхцана.  false = <see cref="Top"/> тасралтгүй.
        /// </summary>
        public bool SupportTop;
        public BbBarSpec SpanTop;
        public double SpanTopLap = 550, SupportTopFrac = 1.0 / 3;
        /// <summary>
        /// Давхцал голын арматурын талд (ЖИШЭЭ-4): тулгуурын дээд нүүрээс ⅓l хүртэл, голын нь ⅓l − <see cref="SpanTopLap"/>-аас (false = ЖИШЭЭ-1:
        /// тулгуурынх ⅓l + давхцал, голынх ⅓l-аас).
        /// </summary>
        public bool SpanTopLapInside;
        /// <summary>Консолын үзүүрийн дээд хөл доод эгнээнээс энэ хэмжээгээр дээш дуусна (ЖИШЭЭ-4: 30; 0 = доод эгнээ хүртэл).</summary>
        public double TipHookClear;
        /// <summary>Консолын доод арматур үзүүрт дээш хөлтэй, тулгуурт шулуун (ЖИШЭЭ-4 ДН-4-1; false = эсрэгээр).</summary>
        public bool CantileverBottomTipHook;
        /// <summary>C-хомутын үзүүр (тэнхлэг) хажуугийн хамгаалах үеийн шугамд — хоёр хажуугийн арматурыг тэврэнэ (ЖИШЭЭ-4, B = 360).</summary>
        public bool TieAtCover;
        /// <summary>Голын тулгуур дээр доод арматур алгаслаар тасарч баганын алс нүүрээс энэ хэмжээгээр (мм) гарна (0 = тасралтгүй; энгийн каркас 100).</summary>
        public double BottomThroughSupport;
        /// <summary>
        /// Хэрэглэгч (ЖИШЭЭ-4 ДН-4-2, ДН-3): маталтын (хөл, муруйн хэрчим) Revit-ийн харуулдаг урт = тэнхлэг + d/2 БҮХЭЛ — ≥ 200 бол 50-ийн, бага бол
        /// 10-ын ойрын үржвэр (480 → 500, 380 → 400, 315 → 300); багтахгүй бол доош.
        /// </summary>
        public bool NiceLengths;
        /// <summary>Гүн хөрш рүү шулуун доод арматур нормын анкерлах уртаар биш, зөвхөн алс нүүрээс <c>100</c> (хэрэглэгч: энгийн каркаст хангалттай).</summary>
        public bool StraightBottomShort;
        /// <summary>Захын тулгуурын дээд хөл дамнуруунаас доош баганад орж болно (ЖИШЭЭ-4 ДН-3: хөл 500, дамнурууны доод нүүрээс доош).</summary>
        public bool TopHookIntoColumn;
        /// <summary>Хажуугийн арматур огтлолын өндрөөр: 1 бол яг голд, n бол H/(n+1) алхмаар, дээд / доод ирмэгээс бүхэл (хэрэглэгч).</summary>
        public bool SideByHeight;
        /// <summary>Муруй арматурын доод хэвтээ туслахын доод нүүрт (тэнхлэг − d/2), дээд хэвтээ дээд эгнээний доор шууд (ЖИШЭЭ-4 ДН-3).</summary>
        public bool BentOnSoffit;
        /// <summary><see cref="EndStep"/>-ийн хамгийн ойрын үржвэрээр (ЖИШЭЭ-4: 6500/3 → 2150), false = дээш (ЖИШЭЭ-1 / 3).</summary>
        public bool EndRoundNearest;
        public BbBarSpec?[] TopBySupport;

        /// <summary>Захын тулгуурт үргэлж 90° хөлтэй, баганын алс нүүрээс <see cref="EndOffsetTop"/> / <see cref="EndOffsetBottom"/> (төв).</summary>
        public bool BendEnds;
        public double EndOffsetTop = 66, EndOffsetBottom = 110;
        /// <summary>Доод арматурын хөл (0 = 15d, 50-аар дээш).</summary>
        public double BottomLeg;
        /// <summary>Диаметр → давхцуулах урт (компанийн хүснэгт); байхгүй бол норм.</summary>
        public Dictionary<int, double> LapByD;
        /// <summary>Доод арматурын холбоосын төв тулгуурын нүүрээс l·хувь (0 = тулгуур дээр).</summary>
        public double BottomSpliceFrac;
        /// <summary>Нэмэлт дээд арматур тал бүрдээ өөрийн алгаслаар (false = хоёр алгаслын ихээр).</summary>
        public bool AddPerSide;
        /// <summary>Нэмэлт арматур үргэлж 2-р эгнээнд.</summary>
        public bool AddSecondRow;

        /// <summary>Хажуугийн арматур (0 = байхгүй): h ≥ <see cref="SideMinH"/>, эгнээ = (дээд…доод зай) / <see cref="SidePitch"/>.</summary>
        public int SideD;
        /// <summary>C-хомутын Ø (0 = хомутынхтой адил; ЖИШЭЭ 3: хомут Ø10, C Ø8).</summary>
        public int TieD;
        /// <summary>C-хомутын тэнхлэгийн үзүүр нүүрээс (0 = хомутын дотор, хомутын Ø + C-ийн Ø/2).</summary>
        public double TieInset;
        /// <summary>Загвараас сурсан bar type-ийн нэр («stirrup:10» → «⌀10_A240»; <see cref="BbRebarStyle"/>), Revit тал эхэлж үүнийг хайна.</summary>
        public Dictionary<string, string> TypeNames = new Dictionary<string, string>();
        public double SideMinH = 500, SidePitch = 250;
        /// <summary>C-хомутын алхам = <see cref="TieFactor"/>·s2.</summary>
        public double TieFactor = 2;

        /// <summary>Туслах дамнурууны хоёр талд нүүрээс <see cref="FirstStirrup"/>-ээр эхэлж <see cref="LoadPointStirrups"/> хомут @<see cref="LoadPointPitch"/>.</summary>
        public int LoadPointStirrups = 3;
        public double LoadPointPitch = 50;
        /// <summary>Туслах дамнуруун доорх муруй арматур (0 = байхгүй): дээд хэвтээ <see cref="BentTop"/>, налуу <see cref="BentAngle"/>°, доод хэвтээ = өргөн + <see cref="BentFlatExtra"/>.</summary>
        public BbBarSpec Bent;
        public double BentTop = 480, BentAngle = 45, BentBelow = 50, BentFlatExtra = 60, BentInset = 60;

        /// <summary>Хомутын салаа: 2 = нэг битүү, 4 = давхардсан хоёр битүү (<see cref="Layout"/> = Auto үед).</summary>
        public int Legs = 2;
        /// <summary>Хомутын хэлбэр (Auto = <see cref="Legs"/>-аар).</summary>
        public BbStirrupLayout Layout = BbStirrupLayout.Auto;

        /// <summary>Доод нүүрийн хамгаалах үе (0 = <see cref="Cover"/>).</summary>
        public double CoverBottom;
        /// <summary>
        /// Норм зөрчихгүй: хамгаалах үе &lt; нормын → нормын хэмжээ; давхцал = max(хүснэгт, норм); хомутын алхам &gt; нормын дээд → дээд хязгаар.
        /// Өөрчилсөн бүрд анхааруулга.
        /// </summary>
        public bool EnforceCode = true;
        /// <summary>Хажуугийн арматурын эгнээ (0 = <see cref="SidePitch"/>-аар автомат), C-хомуттай эсэх.</summary>
        public int SideRows;
        public bool SideTies = true;
        /// <summary>Алгаслын дугаараар хомутын алхам (null мөр = <see cref="S1"/> / <see cref="S2"/>).</summary>
        public double?[] S1BySpan, S2BySpan;

        /// <summary>
        /// ЖИШЭЭ-1-ээс хэмжсэн компанийн хэв маяг (80 дамнуруу): хамгаалах 32 (дээд 52), хомут Ø8 A240 4 салаа @100 / @200, эхний 50, тулгуурын
        /// дээд арматур ⅓l + 550, голд 6Ø12 (b &lt; 450 — 4), захын тулгуурт үргэлж L, доод холбоос l/3 орчим, хажуугийн Ø12 + C-хомут @400, туслах
        /// дамнуруунд 3@50 + 4Ø16 муруй.
        /// </summary>
        /// <summary>
        /// «Энгийн каркас» — ЖИШЭЭ-4-өөс хэмжсэн (ДН-1…9, ТДН): хомут Ø8 @100 тулгуураас ¼l (бүхэл алхмаар), гол @200 төвд; тулгуурын дээд нүүрээс
        /// ⅓l (50-ийн ойрын үржвэр), голын дээд Ø12 түүнтэй 500 давхцана; хажуугийн Ø12 h ≥ 500-д; 400 өргөнд 4, 300-д 3 ширхэг.  Нормын хязгаар
        /// (<see cref="EnforceCode"/>) хэвээр.
        /// </summary>
        public static BbBeamPreset Ordinary(double b)
        {
            int n = b < 350 ? 3 : b < 450 ? 4 : 6;
            return new BbBeamPreset
            {
                StirrupD = 8, S1 = 100, S2 = 200, Zones = 3, ZoneFrac = 0.25, ExampleZones = true, EndStep = 50, EndRoundNearest = true, FirstStirrup = 50,
                Top = new BbBarSpec(n, 16), Bottom = new BbBarSpec(n, 16), SupportTop = true, SupportTopFrac = 1.0 / 3, SpanTop = new BbBarSpec(n, 12),
                SpanTopLap = 500, SpanTopLapInside = true, Legs = 4, SideD = 12, SideMinH = 500, SidePitch = 300,
                TipHookClear = 30, CantileverBottomTipHook = true, TieAtCover = true, BottomThroughSupport = 100,
                NiceLengths = true, StraightBottomShort = true, TopHookIntoColumn = true, SideByHeight = true, BentOnSoffit = true,
                BentTop = 500, BentFlatExtra = 150,
                // Туслах дамнуруу тулсан газарт ЖИШЭЭ 3 шиг муруй арматур (+ 3@50 хомут); загвараас сурсан бол түүний тоо / Ø.
                Bent = new BbBarSpec(b < 450 ? 3 : 5, 16),
            };
        }

        public static BbBeamPreset Company(double b)
        {
            int n = b < 450 ? 4 : 6;
            return new BbBeamPreset
            {
                Cover = 32, CoverTop = 52, Steel = BbSteel.A500, StirrupD = 8, S1 = 100, S2 = 200, Zones = 3, ZoneFrac = 1.0 / 3,
                AverageTransition = true, ExampleZones = true, EndStep = 50, LoadPointBand = 700, FirstStirrup = 50, SpacingStep = 50, MaxBarLength = 12000, Legs = 4,
                Top = new BbBarSpec(n, 25), Bottom = new BbBarSpec(n, 25), SupportTop = true, SpanTop = new BbBarSpec(n, 12), SpanTopLap = 550,
                BendEnds = true, LapByD = new Dictionary<int, double> { { 18, 1100 }, { 20, 1100 }, { 22, 1100 }, { 28, 1500 } },
                BottomSpliceFrac = 1.0 / 3, AddPerSide = true, AddSecondRow = true, AddTopInner = 0.25, AddTopEnd = 0.25, AddBottomCut = 0.2,
                SideD = 12, Bent = new BbBarSpec(4, 16),
            };
        }
    }

    /// <summary>
    /// Туслах дамнуруун доорх муруй арматур (46 хэлбэр): төв <see cref="X"/>, доод хэвтээ <see cref="Flat"/> (<see cref="ZLow"/> өндөрт), налуу
    /// <see cref="Angle"/>°, дээд хэвтээ <see cref="TopLen"/> (<see cref="ZHigh"/>).
    /// </summary>
    public sealed class BbBentBar
    {
        public int D;
        public double X, Flat, TopLen, ZLow, ZHigh, Angle;
        public double[] Y;
        public double Run { get { return (ZHigh - ZLow) / Math.Tan(Angle * Math.PI / 180); } }
        public double X0 { get { return X - Flat / 2 - Run - TopLen; } }
        public double X1 { get { return X + Flat / 2 + Run + TopLen; } }
    }

    public enum BbRunRole { Top, Bottom, AddTop, AddBottom, SpanTop, Side }

    /// <summary>
    /// Дамнурууны хомутын хэлбэр (ЖИШЭЭ-1 / ЖИШЭЭ 3 ба CADS-ийн төрлүүд): нэг битүү (2 салаа), давхардсан хоёр битүү (4 салаа, ЖИШЭЭ-1), гадна +
    /// дотоод битүү (дотоод нь голын ширхгүүдийг), гадна + босоо C (завсрын ширхгүүдэд).
    /// </summary>
    public enum BbStirrupLayout { Auto, Single, Pair, OuterInner, OuterC }

    /// <summary>
    /// Нэг хэсэг шулуун арматурын бүлэг (N ширхэг, огтлолд <see cref="Y"/> байрлалтай, <see cref="Z"/> өндөрт): тэнхлэгийн дагуу
    /// <see cref="X0"/>…<see cref="X1"/>; <see cref="HookStart"/> / <see cref="HookEnd"/> = 90° хөлийн урт (дээд — доош, доод — дээш), 0 = шулуун.
    /// </summary>
    public sealed class BbBarRun
    {
        public BbRunRole Role;
        public int D;
        public double X0, X1, HookStart, HookEnd, Z;
        /// <summary>Огтлолын өргөний дагуу (зүүн нүүрээс) төвүүд.</summary>
        public double[] Y;
        public int Layer = 1;
        public int N { get { return Y.Length; } }
        public double Length { get { return X1 - X0 + HookStart + HookEnd; } }
    }

    /// <summary>Нэг алхамтай хомутын бүлэг: эхний хомут <see cref="X0"/>, <see cref="Count"/> ширхэг, <see cref="Spacing"/> алхам.</summary>
    public sealed class BbStirrupSet
    {
        public int Span, Count, D;
        public double X0, Spacing;
        public double X1 { get { return X0 + (Count - 1) * Spacing; } }
    }

    public sealed class BbBeamRebar
    {
        public List<BbBarRun> Bars = new List<BbBarRun>();
        public List<BbStirrupSet> Stirrups = new List<BbStirrupSet>();
        /// <summary>Хажуугийн арматурын C-хомут (эгнээ бүрд, <see cref="TieZ"/> өндрүүдэд).</summary>
        public List<BbStirrupSet> Ties = new List<BbStirrupSet>();
        public double[] TieZ = new double[0];
        public List<BbBentBar> Bent = new List<BbBentBar>();
        /// <summary>Хомут бүрийн гадна ирмэгийн өргөн (огтлолын Y): 2 салаа — нэг, 4 салаа — давхардсан хоёр.</summary>
        public List<double[]> StirrupWidths = new List<double[]>();
        /// <summary>Хомутын огтлол дахь хэлбэрүүд (X = огтлолын Y, Y = өндөр Z): битүү = гадна ирмэг, C = төв шугам.</summary>
        public List<BbTieShape> StirrupShapes = new List<BbTieShape>();
        public double CoverBottom, CoverTop;
        public List<string> Warnings = new List<string>();
        /// <summary>Тулгуур хоорондох цэвэр алгаслууд (консол орно).</summary>
        public List<BbSupport> Spans = new List<BbSupport>();
        public int StirrupD;
        public double H0, S1, S2, LapTop, LapBottom;
    }

    /// <summary>
    /// Олон алгаслын дамнурууны арматурын төлөвлөгөө (CADS / Naviate-ийн хэв маяг, БНбД 52-01 / СП 52-101): үндсэн дээд, доод арматур бүтэн
    /// уртаар (стандарт уртаас урт бол давхцуулна — дээдийг алгаслын голд, доодыг тулгуур дээр), захын тулгуурт анкерлана (шулуун багтахгүй бол
    /// 90° хөл); нэмэлт дээд арматур тулгуур дээр, нэмэлт доод арматур алгасалд; хомут алгасал бүрд 1 / 3 бүсээр эсвэл «4*200+5*300».
    /// </summary>
    public static class BbBeamRebarPlan
    {
        const double Tol = 1;

        public static BbBeamRebar Plan(BbBeamInput beam, BbBeamPreset p)
        {
            var r = new BbBeamRebar();
            List<BbSupport> sup = (beam.Supports ?? new List<BbSupport>())
                .Where(s => s.Hi > -Tol && s.Lo < beam.Length + Tol).OrderBy(s => s.Lo).ToList();
            sup = MergeSupports(sup);
            // Хувьсах огтлолын залгаас: төгсгөлд тэг өргөнтэй «тулгуур» — алгасал тэнд дуусна, арматур цааш шулуун.
            bool joinL = beam.JoinStart && (sup.Count == 0 || sup[0].Lo > Tol), joinR = beam.JoinEnd && (sup.Count == 0 || sup[sup.Count - 1].Hi < beam.Length - Tol);
            if (joinL) sup.Insert(0, new BbSupport(0, 0));
            if (joinR) sup.Add(new BbSupport(beam.Length, beam.Length));
            if (sup.Count < 2 && (joinL || joinR) || sup.Count == 0) { r.Warnings.Add("Тулгуур олдсонгүй."); return r; }

            int maxD = new[] { p.Top, p.Bottom, p.AddTop, p.AddBottom }
                .Concat(p.AddTopBySupport?.Where(x => x.HasValue).Select(x => x.Value) ?? Enumerable.Empty<BbBarSpec>())
                .Concat(p.AddBottomBySpan?.Where(x => x.HasValue).Select(x => x.Value) ?? Enumerable.Empty<BbBarSpec>())
                .Where(x => x.Any).Select(x => x.D).DefaultIfEmpty(12).Max();
            int ds = p.StirrupD > 0 ? p.StirrupD : BbRebarCode.MinStirrupDiameter(maxD, beam.H);
            r.StirrupD = ds;
            if (ds < BbRebarCode.MinStirrupDiameter(maxD, beam.H))
                r.Warnings.Add("Хомут Ø" + ds + " < нормын Ø" + BbRebarCode.MinStirrupDiameter(maxD, beam.H) + ".");
            double minCov = Math.Max(BbRebarCode.MinCover(ds, p.Exposure), BbRebarCode.MinCover(maxD, p.Exposure) - ds);
            double covSide = p.Cover, covTop = p.CoverTop > 0 ? p.CoverTop : p.Cover, covBot = p.CoverBottom > 0 ? p.CoverBottom : p.Cover;
            if (Math.Min(covSide, Math.Min(covTop, covBot)) + 1e-6 < minCov)
            {
                if (p.EnforceCode)
                {
                    r.Warnings.Add("Хамгаалах үе (" + covSide + "/" + covTop + "/" + covBot + ") нормоос бага — " + minCov + " болгов.");
                    covSide = Math.Max(covSide, minCov); covTop = Math.Max(covTop, minCov); covBot = Math.Max(covBot, minCov);
                }
                else r.Warnings.Add("Хамгаалах үе " + Math.Min(covSide, Math.Min(covTop, covBot)) + " мм нормоос бага.");
            }

            double c = covSide + ds, cTop = covTop + ds, cb = covBot + ds;
            r.CoverTop = cTop - ds;
            r.CoverBottom = cb - ds;
            r.H0 = beam.H - cb - p.Bottom.D / 2.0;
            r.S1 = p.S1 > 0 ? p.S1 : BbRebarCode.FloorTo(BbRebarCode.MaxStirrupSupport(r.H0), p.SpacingStep);
            r.S2 = p.S2 > 0 ? p.S2 : BbRebarCode.FloorTo(BbRebarCode.MaxStirrupMid(r.H0), p.SpacingStep);
            double s1Max = BbRebarCode.FloorTo(BbRebarCode.MaxStirrupSupport(r.H0), p.SpacingStep), s2Max = BbRebarCode.FloorTo(BbRebarCode.MaxStirrupMid(r.H0), p.SpacingStep);
            if (r.S1 > BbRebarCode.MaxStirrupSupport(r.H0) + 1e-6)
            {
                r.Warnings.Add("Тулгуурын бүсийн алхам " + r.S1 + " > 0.5·h0 / 300" + (p.EnforceCode ? " — " + s1Max + " болгов." : "."));
                if (p.EnforceCode) r.S1 = s1Max;
            }
            if (r.S2 > BbRebarCode.MaxStirrupMid(r.H0) + 1e-6)
            {
                r.Warnings.Add("Голын алхам " + r.S2 + " > 0.75·h0 / 500" + (p.EnforceCode ? " — " + s2Max + " болгов." : "."));
                if (p.EnforceCode) r.S2 = s2Max;
            }

            bool cantL = sup[0].Lo > Tol, cantR = sup[sup.Count - 1].Hi < beam.Length - Tol;
            if (cantL) r.Spans.Add(new BbSupport(0, sup[0].Lo));
            for (int i = 0; i + 1 < sup.Count; i++) r.Spans.Add(new BbSupport(sup[i].Hi, sup[i + 1].Lo));
            if (cantR) r.Spans.Add(new BbSupport(sup[sup.Count - 1].Hi, beam.Length));
            int spanOffset = cantL ? 1 : 0;   // r.Spans[i + spanOffset] = sup[i]…sup[i+1]

            double w = beam.B - 2 * c;
            double zTop = beam.H - cTop - p.Top.D / 2.0, zBot = cb + p.Bottom.D / 2.0;
            double legMax = zTop - zBot;   // дээд ба доод эгнээний төв хооронд
            int last = sup.Count - 1;
            // Арматурын төгсгөл: консолд үзүүрээс хамгаалах үе; тулгуурт — баганын алс нүүрээс (BendEnds) эсвэл хамгаалах үе; залгаасанд —
            // хөрш хэсэг рүү анкерлах уртаар.
            double lanJ = BbRebarCode.Anchorage(Math.Max(p.Top.D, p.Bottom.D), p.Steel, p.Concrete);
            // Үзүүрийн тэнхлэг нүүрээс хамгаалах үе + d/2 (тэнхлэгийг хамгаалах үеийн шугамд тавивал гадна тал нь d/2-оор хэтэрнэ).
            double eT = p.Cover + p.Top.D / 2.0, eB = p.Cover + p.Bottom.D / 2.0;
            double tipS = cantL ? Math.Max(0, beam.TipExtStart) : 0, tipE = cantR ? Math.Max(0, beam.TipExtEnd) : 0;
            double xsT = joinL ? -lanJ : cantL ? eT - tipS : sup[0].Lo + (p.BendEnds ? p.EndOffsetTop : eT);
            double xeT = joinR ? beam.Length + lanJ : cantR ? beam.Length + tipE - eT : sup[last].Hi - (p.BendEnds ? p.EndOffsetTop : eT);
            double xsB = joinL ? -lanJ : cantL ? eB - tipS : sup[0].Lo + (p.BendEnds ? p.EndOffsetBottom : eB);
            double xeB = joinR ? beam.Length + lanJ : cantR ? beam.Length + tipE - eB : sup[last].Hi - (p.BendEnds ? p.EndOffsetBottom : eB);
            double xsS = xsB, xeS = xeB;   // хажуугийн арматур — тулгуурын дотор
            // Хөрш хэсэг нь гүн (ЖИШЭЭ-4 ДН-4 FX2–FX3): доод арматур хөлгүй, баганыг дайрч алс нүүрээс 100 (анкерлах уртаас багагүй) — гүн хэсэгт зоогдоно.
            bool sbS = beam.StraightBottomStart && !joinL && !cantL, sbE = beam.StraightBottomEnd && !joinR && !cantR;
            double lanB = BbRebarCode.Anchorage(p.Bottom.D, p.Steel, p.Concrete);
            if (sbS) xsB = p.StraightBottomShort ? sup[0].Lo - 100 : Math.Min(sup[0].Lo - 100, sup[0].Hi - lanB);
            if (sbE) xeB = p.StraightBottomShort ? sup[last].Hi + 100 : Math.Max(sup[last].Hi + 100, sup[last].Lo + lanB);
            bool cantOnly = sup.Count == 1 && (cantL || cantR);
            var lapNoted = new HashSet<int>();
            Func<int, double> lap = d =>
            {
                double code = BbRebarCode.Lap(d, p.Steel, p.Concrete);
                if (p.LapByD == null || !p.LapByD.ContainsKey(d)) return code;
                double t = p.LapByD[d];
                if (t + 1e-6 >= code || !p.EnforceCode) return t;
                if (lapNoted.Add(d)) r.Warnings.Add("Ø" + d + " давхцал " + t + " < нормын " + code + " — нормынхыг авлаа.");
                return code;
            };
            // Төгсгөлийн хөл: end 0 = зүүн, 1 = баруун; залгаасанд хөлгүй, консолын үзүүрт дээд нь бүтэн, доод нь шулуун.
            var anchNoted = new HashSet<string>();
            // BendEnds (L үргэлж): шулуун + хөл ≥ анкерлах урт эсэхийг шалгана (геометрийг өөрчилж чадахгүй — анхааруулна).
            Func<double, double, int, string, double> checkL = (leg, straight, d, what) =>
            {
                double lan = BbRebarCode.Anchorage(d, p.Steel, p.Concrete);
                if (straight + leg + 1e-6 < lan && anchNoted.Add(what + d))
                    r.Warnings.Add(what + " Ø" + d + ": захын тулгуурт анкерлах урт хүрэхгүй (" + Math.Round(straight + leg) + " < " + lan + ") — тулгуурын өргөн / хөлийг шалгана уу.");
                return leg;
            };
            // Хөрш (өөр өндөртэй) хэсэг рүү дээд арматур тасралтгүй: эцэст нь энэ хэсэг үргэлжлүүлнэ, эхэнд нь өмнөх хэсэг тавьсан.
            bool contE = beam.ContinueTopEnd > 0 && !joinR && !cantR, contS = beam.ContinueTopStart && !joinL && !cantL;
            // Хэрэглэгч: маталтын харагдах урт (тэнхлэг + d/2) бүхэл; багтах дээд хэмжээ cap.
            Func<double, int, double, double> nice = (leg, d, cap) =>
            {
                if (!p.NiceLengths || leg <= 0) return leg;
                double l = NiceRound(leg + d / 2.0) - d / 2.0;
                if (l > cap + 1e-6) l = NiceFloor(cap + d / 2.0) - d / 2.0;
                return Math.Max(0, l);
            };
            double topCol = p.TopHookIntoColumn ? legMax + 600 : legMax;   // баганад орох хөлийн дээд хязгаар
            Func<int, double, int, string, double> topHookRaw = (end, straight, d, what) =>
                end == 1 && contE ? (beam.ContinueTopEndTip ? Math.Max(0, legMax - (beam.ContinueTopEndH > 0 ? beam.H - beam.ContinueTopEndH : 0) - p.TipHookClear) : 0) : end == 0 && contS ? 0
                : (end == 0 ? joinL : joinR) ? 0 : (end == 0 ? cantL : cantR) ? Math.Max(0, legMax - p.TipHookClear) : p.BendEnds ? checkL(legMax, straight, d, what) : EndHook(straight, d, p, topCol, what, r);
            Func<int, double, int, string, double> topHook = (end, straight, d, what) =>
            {
                double h = topHookRaw(end, straight, d, what);
                bool tip = (end == 0 ? cantL : cantR) || (end == 1 && contE && beam.ContinueTopEndTip);
                return nice(h, d, tip ? h + 5 : topCol);
            };
            // Консол (ЖИШЭЭ-4 ДН-4-1, хэрэглэгчийн засвар): доод нь үзүүрт дээш хөлтэй, тулгуурт шулуун.
            double tipLeg = Math.Min(legMax, p.BottomLeg > 0 ? p.BottomLeg : BbRebarCode.CeilTo(15 * p.Bottom.D, 50));
            Func<int, double, int, string, double> botHookRaw = (end, straight, d, what) =>
                (end == 0 ? joinL : joinR) ? 0
                : (end == 0 ? cantL : cantR) ? (p.CantileverBottomTipHook && cantOnly ? tipLeg : 0)
                : (end == 0 ? sbS : sbE) || (p.CantileverBottomTipHook && cantOnly) ? 0
                : p.BendEnds ? checkL(Math.Min(legMax, p.BottomLeg > 0 ? p.BottomLeg : BbRebarCode.CeilTo(15 * d, 50)), straight, d, what) : EndHook(straight, d, p, legMax, what, r);
            Func<int, double, int, string, double> botHook = (end, straight, d, what) => nice(botHookRaw(end, straight, d, what), d, legMax);
            r.LapTop = p.Top.Any ? lap(p.Top.D) : 0;
            r.LapBottom = p.Bottom.Any ? lap(p.Bottom.D) : 0;
            if (contE)
            {
                // ЖИШЭЭ-4: тулгуурын алс нүүрээс хөршийн ⅓l (тасралтгүй дээд арматурт давхцлаас багагүй); консол бол үзүүрээс хамгаалах үе хүртэл.
                double ext = beam.ContinueTopEndTip ? beam.ContinueTopEnd - eT : EndRound(p.SupportTopFrac * beam.ContinueTopEnd, p);
                if (!p.SupportTop && !beam.ContinueTopEndTip) ext = Math.Max(ext, r.LapTop);
                xeT = sup[last].Hi + ext;
            }
            // Эхэнд: тулгуурын дээд арматурыг өмнөх хэсэг тавьсан — тасралтгүй дээд нь тулгуурын ойр нүүрээс эхэлж түүнтэй давхцана.
            if (contS) xsT = sup[0].Lo;
            bool topOwned = contS && last == 0 && cantR;   // зөвхөн консол — дээдийг өмнөх хэсэг үзүүр хүртэл тавьсан
            // Доод (ба хажуугийн) арматурын холбоосын төвүүд.
            List<double> botCenters = p.BottomSpliceFrac > 0
                ? r.Spans.Skip(spanOffset).Take(last).SelectMany(s => new[] { s.Lo + p.BottomSpliceFrac * Len(s), s.Hi - p.BottomSpliceFrac * Len(s) }).ToList()
                : sup.Skip(1).Take(sup.Count - 2).Select(s => s.Mid).ToList();

            // Нэмэлт арматур тулгуур / алгаслаар.
            var addTop = new BbBarSpec[sup.Count];
            for (int i = 0; i < sup.Count; i++)
                addTop[i] = p.AddTopBySupport != null && i < p.AddTopBySupport.Length && p.AddTopBySupport[i].HasValue ? p.AddTopBySupport[i].Value : p.AddTop;
            var addBot = new BbBarSpec[Math.Max(0, sup.Count - 1)];
            for (int i = 0; i < addBot.Length; i++)
                addBot[i] = p.AddBottomBySpan != null && i < p.AddBottomBySpan.Length && p.AddBottomBySpan[i].HasValue ? p.AddBottomBySpan[i].Value : p.AddBottom;

            // Огтлолын эгнээ: нэмэлт нь үндсэнтэй нэг эгнээнд багтвал завсарт нь, үгүй бол 2-р эгнээ.
            Row top = MakeRow(p.Top, addTop, w, c, true, p.AddSecondRow, r);
            Row bot = MakeRow(p.Bottom, addBot, w, c, false, p.AddSecondRow || p.AddBottomRowGap > 0, r);

            // Үндсэн арматур.
            if (p.Top.Any && !p.SupportTop && !topOwned)
            {
                double h0 = topHook(0, sup[0].Hi - xsT, p.Top.D, "Дээд");
                double h1 = topHook(1, xeT - sup[last].Lo, p.Top.D, "Дээд");
                var centers = r.Spans.Skip(spanOffset).Take(last).Select(s => s.Mid).ToList();
                AddPieces(r, BbRunRole.Top, p.Top.D, xsT, xeT, h0, h1, zTop, top.Main, 1, r.LapTop, p.MaxBarLength, centers);
            }
            if (p.Top.Any && p.SupportTop) SupportTopBars(r, sup, spanOffset, cantL, cantR, xsT, xeT, zTop, w, c, top, p, topHook, contS);
            if (p.Bottom.Any)
            {
                double h0 = botHook(0, sup[0].Hi - xsB, p.Bottom.D, "Доод");
                double h1 = botHook(1, xeB - sup[last].Lo, p.Bottom.D, "Доод");
                if (p.BottomThroughSupport > 0 && last >= 2)
                {
                    // Энгийн каркас (хэрэглэгч, ЖИШЭЭ-4 ДН-7): голын тулгуур дээр алгасал бүрийн доод арматур баганыг дайрч алс нүүрээс
                    // BottomThroughSupport-аар гарна (хөрш алгаслынхтай баганад давхцана), хөлгүй.
                    for (int j = 0; j < last; j++)
                    {
                        double a0 = j == 0 ? xsB : sup[j].Lo - p.BottomThroughSupport, a1 = j == last - 1 ? xeB : sup[j + 1].Hi + p.BottomThroughSupport;
                        BbSupport sj = r.Spans[j + spanOffset];
                        AddPieces(r, BbRunRole.Bottom, p.Bottom.D, a0, a1, j == 0 ? h0 : 0, j == last - 1 ? h1 : 0, zBot, bot.Main, 1, r.LapBottom, p.MaxBarLength,
                            new List<double> { sj.Mid });
                    }
                }
                else AddPieces(r, BbRunRole.Bottom, p.Bottom.D, xsB, xeB, h0, h1, zBot, bot.Main, 1, r.LapBottom, p.MaxBarLength, botCenters);
            }

            // Хажуугийн арматур: дээд ба доод эгнээний хооронд жигд, доод арматуртай адил уртаар.  h > 700 бол нормоор заавал (≤ 400 алхам).
            int sideD = p.SideD, sideRows = p.SideRows;
            if (beam.H > 700 + 1e-6 && (sideD <= 0 || (sideRows > 0 && legMax / (sideRows + 1) > 400 + 1e-6)))
            {
                int need = Math.Max(1, (int)Math.Ceiling(legMax / 400 - 1e-9) - 1);
                if (p.EnforceCode)
                {
                    r.Warnings.Add("h > 700: хажуугийн конструктив арматур ≤ 400 алхамтай заавал — " + need + " эгнээ Ø" + (sideD > 0 ? sideD : 12) + " нэмэв.");
                    if (sideD <= 0) sideD = 12;
                    sideRows = Math.Max(sideRows, need);
                }
                else r.Warnings.Add("h > 700: хажуугийн конструктив арматур (≤ 400 алхам) дутуу.");
            }
            if (sideD > 0 && (beam.H >= p.SideMinH - 1e-6 || p.SideRows > 0 || sideRows > 0))
            {
                int rows = sideRows > 0 ? sideRows : (int)Math.Floor(legMax / p.SidePitch + 1e-9);
                r.TieZ = Enumerable.Range(1, rows).Select(k => zTop - k * legMax / (rows + 1)).ToArray();
                if (p.SideByHeight)
                {
                    // Хэрэглэгч: огтлолын өндрийг тэнцүү хувааж — 1 бол яг голд; олон бол доод хагас нь доод ирмэгээс, дээд хагас нь дээд ирмэгээс бүхэл.
                    double hh = beam.H;
                    r.TieZ = Enumerable.Range(1, rows).Select(k =>
                    {
                        if (2 * k == rows + 1) return hh / 2;
                        return 2 * k < rows + 1 ? NiceRound(k * hh / (rows + 1)) : hh - NiceRound((rows + 1 - k) * hh / (rows + 1));
                    }).OrderByDescending(z => z).ToArray();
                }
                double[] y = { c + sideD / 2.0, beam.B - c - sideD / 2.0 };
                foreach (double z in r.TieZ)
                    AddPieces(r, BbRunRole.Side, sideD, xsS, xeS, 0, 0, z, y, 1, lap(sideD), p.MaxBarLength, botCenters);
            }

            // Нэмэлт дээд — тулгуур бүр дээр.
            for (int i = 0; i < sup.Count; i++)
            {
                BbBarSpec a = addTop[i];
                if (!a.Any || (i == 0 && contS)) continue;
                double z = top.SecondLayer ? zTop - p.Top.D / 2.0 - BbRebarCode.MinClear(Math.Max(p.Top.D, a.D), true) - a.D / 2.0 : beam.H - cTop - a.D / 2.0;
                // Тулгуурын хоёр талын алгасал (тулгуур хоорондох); захын тулгуур — нэг тал нь консол эсвэл төгсгөл.
                double lL = i > 0 ? Len(r.Spans[i - 1 + spanOffset]) : 0;
                double lR = i + 1 < sup.Count ? Len(r.Spans[i + spanOffset]) : 0;
                bool endL = i == 0 && !cantL, endR = i == sup.Count - 1 && !cantR;
                double frac = endL || endR ? p.AddTopEnd : p.AddTopInner;
                double extL = frac * (p.AddPerSide ? lL : Math.Max(lL, lR)), extR = frac * (p.AddPerSide ? lR : Math.Max(lL, lR));
                double x0, x1, k0 = 0, k1 = 0;
                if (i == 0) { x0 = xsT; k0 = topHook(0, sup[0].Hi - xsT, a.D, "Нэмэлт дээд"); }
                else x0 = sup[i].Lo - extL;
                if (i == last) { x1 = xeT; k1 = topHook(1, xeT - sup[i].Lo, a.D, "Нэмэлт дээд"); }
                else x1 = sup[i].Hi + extR;
                r.Bars.Add(new BbBarRun
                {
                    Role = BbRunRole.AddTop, D = a.D, X0 = Math.Max(xsT, x0), X1 = Math.Min(xeT, x1), HookStart = k0, HookEnd = k1, Z = z,
                    Y = top.Add.Take(a.N).ToArray(), Layer = top.SecondLayer ? 2 : 1,
                });
            }

            // Нэмэлт доод — алгасал бүрд.
            for (int i = 0; i < addBot.Length; i++)
            {
                BbBarSpec a = addBot[i];
                if (!a.Any) continue;
                BbSupport s = r.Spans[i + spanOffset];
                double cut = p.AddBottomCut * Len(s);
                double gap = p.AddBottomRowGap > 0 ? p.AddBottomRowGap : BbRebarCode.MinClear(Math.Max(p.Bottom.D, a.D), false);
                double z = bot.SecondLayer ? zBot + p.Bottom.D / 2.0 + gap + a.D / 2.0 : cb + a.D / 2.0;
                r.Bars.Add(new BbBarRun
                {
                    Role = BbRunRole.AddBottom, D = a.D, X0 = s.Lo + cut, X1 = s.Hi - cut, Z = z,
                    Y = bot.Add.Take(a.N).ToArray(), Layer = bot.SecondLayer ? 2 : 1,
                });
            }

            // Хомут.
            for (int i = 0; i < r.Spans.Count; i++)
            {
                BbSupport s = r.Spans[i];
                bool cant = (cantL && i == 0) || (cantR && i == r.Spans.Count - 1);
                double x0 = s.Lo + (cantL && i == 0 ? p.Cover : p.FirstStirrup);
                double x1 = s.Hi - (cantR && i == r.Spans.Count - 1 ? p.Cover : p.FirstStirrup);
                if (x1 - x0 < Tol) { r.Warnings.Add("Алгасал " + (i + 1) + " хомут багтахгүй."); continue; }
                List<BbLoadPoint> lps = (beam.LoadPoints ?? new List<BbLoadPoint>())
                    .Where(lp => lp.Lo > x0 && lp.Hi < x1).OrderBy(lp => lp.Lo).ToList();
                // Алгаслын дугаар (тулгуур хоорондын, консолгүй) — алгасал бүрийн алхам.
                int si = i - spanOffset;
                double s1 = p.S1BySpan != null && si >= 0 && si < p.S1BySpan.Length && p.S1BySpan[si].HasValue ? p.S1BySpan[si].Value : r.S1;
                double s2 = p.S2BySpan != null && si >= 0 && si < p.S2BySpan.Length && p.S2BySpan[si].HasValue ? p.S2BySpan[si].Value : r.S2;
                List<BbStirrupSet> sets = !string.IsNullOrWhiteSpace(p.StirrupPattern) ? Pattern(x0, x1, p.StirrupPattern, r, i)
                    : lps.Count > 0 && p.ExampleZones && p.Zones == 3 && !cant ? LoadPointZones(x0, x1, s, lps, p, s1, s2)
                    : lps.Count > 0 ? AroundLoadPoints(x0, x1, lps, p, s1)
                    : p.Zones == 3 && !cant && p.AverageTransition ? Zoned(x0, x1, s, s1, s2, p.ZoneFrac)
                    : p.Zones == 3 && !cant ? ThreeZones(x0, x1, s, s1, s2, p.ZoneFrac, p.ExampleZones)
                    : Uniform(x0, x1, s1);
                foreach (BbStirrupSet st in sets) { st.Span = i; st.D = ds; r.Stirrups.Add(st); }
                if (r.TieZ.Length > 0 && p.SideTies)
                    foreach (BbStirrupSet st in Uniform(x0, x1, p.TieFactor * s2)) { st.Span = i; st.D = p.TieD > 0 ? p.TieD : ds; r.Ties.Add(st); }
            }

            // Туслах дамнуруун доорх муруй арматур.
            if (p.Bent.Any)
                foreach (BbLoadPoint lp in beam.LoadPoints ?? new List<BbLoadPoint>())
                {
                    double zl = beam.H - lp.SoffitDepth - (p.BentOnSoffit ? p.Bent.D / 2.0 : p.BentBelow);
                    if (zl < zBot)
                    {
                        // Доод эгнээний түвшинд хүртэл (ЖИШЭЭ 3 ДН-1-12: h500, туслах 400 → доод эгнээнд) — их зөрвөл л анхааруулна.
                        if (zBot - zl > p.Bent.D) r.Warnings.Add("Туслах дамнуруу x=" + Math.Round(lp.Mid) + ": муруй арматурын доод хэвтээ доод эгнээнээс доош.");
                        zl = zBot;
                    }
                    // ЖИШЭЭ-4 ДН-3: дээд хэвтээ дээд эгнээний доор шууд; харагдах урт бүхэл (дээд 500, налуу 400, доод 400).
                    double zh = p.BentOnSoffit ? zTop - (p.Top.D + p.Bent.D) / 2.0 : zTop;
                    double flat = lp.Hi - lp.Lo + p.BentFlatExtra, topLen = p.BentTop, ang = p.BentAngle;
                    if (p.NiceLengths)
                    {
                        double hb = p.Bent.D / 2.0;
                        flat = NiceRound(flat + hb) - hb;
                        topLen = NiceRound(topLen) - hb;
                        double dy = zh - zl, ls = NiceRound(dy / Math.Sin(ang * Math.PI / 180));
                        if (dy > 1 && ls > dy + 1) ang = Math.Asin(dy / ls) * 180 / Math.PI;
                    }
                    r.Bent.Add(new BbBentBar
                    {
                        D = p.Bent.D, X = lp.Mid, Flat = flat, TopLen = topLen, Angle = ang, ZLow = zl, ZHigh = zh,
                        Y = Spread(p.Bent.N, w - 2 * p.BentInset + p.Bent.D, c + p.BentInset - p.Bent.D / 2.0, p.Bent.D),
                    });
                }

            // Хомутын өргөн: 4 салаа = хоёр битүү, тус бүр n/2 + 1 арматурыг хүрээлнэ (ЖИШЭЭ-1: b600 → 2 × 340, b400 → 2 × 240).
            double[] ys = (bot.Main.Length >= top.Main.Length ? bot.Main : top.Main);
            int dm = bot.Main.Length >= top.Main.Length ? p.Bottom.D : p.Top.D;
            BbStirrupLayout lay = p.Layout != BbStirrupLayout.Auto ? p.Layout : p.Legs == 4 ? BbStirrupLayout.Pair : BbStirrupLayout.Single;
            double zs0 = r.CoverBottom, zs1 = beam.H - r.CoverTop;
            Action<double, double> closed = (y0, y1) =>
            {
                r.StirrupWidths.Add(new[] { y0, y1 });
                r.StirrupShapes.Add(new BbTieShape { Closed = true, X0 = y0, X1 = y1, Y0 = zs0, Y1 = zs1 });
            };
            closed(p.Cover, beam.B - p.Cover);
            if (lay == BbStirrupLayout.Pair && ys.Length >= 4)
            {
                // ЖИШЭЭ-1: давхардсан хоёр битүү, тус бүр n/2 + 1 арматурыг хүрээлнэ (b600 → 2 × 340, b400 → 2 × 240).
                r.StirrupWidths.Clear(); r.StirrupShapes.Clear();
                int k = ys.Length / 2 + 1;
                closed(p.Cover, ys[k - 1] + dm / 2.0 + ds);
                closed(ys[ys.Length - k] - dm / 2.0 - ds, beam.B - p.Cover);
            }
            else if (lay == BbStirrupLayout.OuterInner && ys.Length >= 4)
            {
                // Гадна + дотоод битүү: дотоод нь голын хагас ширхгүүдийг (n/4 … n − 1 − n/4).
                int a = Math.Max(1, (int)Math.Round(ys.Length / 4.0)), b = ys.Length - 1 - a;
                closed(ys[a] - dm / 2.0 - ds, ys[b] + dm / 2.0 + ds);
            }
            else if (lay == BbStirrupLayout.OuterC && ys.Length >= 3)
            {
                // Гадна + босоо C: завсрын ширхгүүдэд захаас нь ээлжлэн тэгш хэмтэй (≤ 2 бол бүгд).
                var idx = new SortedSet<int>();
                int m = ys.Length - 2;
                for (int i = 1, j = ys.Length - 2; i <= j; i += m <= 2 ? 1 : 2, j -= m <= 2 ? 1 : 2) { idx.Add(i); idx.Add(j); }
                foreach (int i in idx)
                    r.StirrupShapes.Add(new BbTieShape { X0 = ys[i], X1 = ys[i], Y0 = zs0 + ds / 2.0, Y1 = zs1 - ds / 2.0 });
            }

            if (p.Bottom.Any && (p.Bottom.Area) / (beam.B * r.H0) < BbRebarCode.MinRatio)
                r.Warnings.Add("Доод арматур μ < " + (BbRebarCode.MinRatio * 100).ToString(CultureInfo.InvariantCulture) + " %.");
            return r;
        }

        static double Len(BbSupport s) { return s.Hi - s.Lo; }

        /// <summary>Тулгуур хоорондын алгаслууд (нүүр хооронд, консол оруулахгүй, залгаасыг тооцно) — <see cref="SplitBySpans"/>-ийн дугаартай нийцнэ.</summary>
        public static List<BbSupport> InteriorSpans(BbBeamInput beam)
        {
            List<BbSupport> sup = MergeSupports((beam.Supports ?? new List<BbSupport>()).Where(s => s.Hi > -Tol && s.Lo < beam.Length + Tol));
            if (beam.JoinStart && (sup.Count == 0 || sup[0].Lo > Tol)) sup.Insert(0, new BbSupport(0, 0));
            if (beam.JoinEnd && (sup.Count == 0 || sup[sup.Count - 1].Hi < beam.Length - Tol)) sup.Add(new BbSupport(beam.Length, beam.Length));
            var res = new List<BbSupport>();
            for (int i = 0; i + 1 < sup.Count; i++) res.Add(new BbSupport(sup[i].Hi, sup[i + 1].Lo));
            return res;
        }

        /// <summary>Тулгуур хоорондын алгаслын тоо (консол оруулахгүй).</summary>
        public static int SpanCount(BbBeamInput beam)
        {
            return Math.Max(0, MergeSupports((beam.Supports ?? new List<BbSupport>()).Where(s => s.Hi > -Tol && s.Lo < beam.Length + Tol)).Count - 1
                + (beam.JoinStart ? 1 : 0) + (beam.JoinEnd ? 1 : 0));
        }

        /// <summary>
        /// Зөвхөн асаалттай алгаслууд (<paramref name="enabled"/>[i], тулгуур хоорондын, 0-ээс): дараалсан асаалттай алгаслыг нэг бие даасан
        /// оролт болгоно — эхлэл нь эхний тулгуурын Lo (эхний алгасал бол 0, консол / залгаасыг дагуулна), төгсгөл нь сүүлийн тулгуурын Hi.
        /// Буцаана: (тэнхлэгийн шилжилт мм, оролт, эхний алгаслын дугаар, алгаслын тоо).
        /// </summary>
        public static List<Tuple<double, BbBeamInput, int, int>> SplitBySpans(BbBeamInput beam, bool[] enabled)
        {
            var res = new List<Tuple<double, BbBeamInput, int, int>>();
            List<BbSupport> sup = MergeSupports((beam.Supports ?? new List<BbSupport>()).Where(s => s.Hi > -Tol && s.Lo < beam.Length + Tol));
            if (beam.JoinStart && (sup.Count == 0 || sup[0].Lo > Tol)) sup.Insert(0, new BbSupport(0, 0));
            if (beam.JoinEnd && (sup.Count == 0 || sup[sup.Count - 1].Hi < beam.Length - Tol)) sup.Add(new BbSupport(beam.Length, beam.Length));
            int n = Math.Max(0, sup.Count - 1);
            if (enabled == null || enabled.Length < n || enabled.Take(n).All(x => x))
            {
                res.Add(Tuple.Create(0.0, beam, 0, n));
                return res;
            }
            for (int a = 0; a < n; a++)
            {
                if (!enabled[a]) continue;
                int b = a;
                while (b + 1 < n && enabled[b + 1]) b++;
                double x0 = a == 0 ? 0 : sup[a].Lo, x1 = b == n - 1 ? beam.Length : sup[b + 1].Hi;
                var sub = new BbBeamInput
                {
                    Length = x1 - x0, B = beam.B, H = beam.H,
                    JoinStart = a == 0 && beam.JoinStart, JoinEnd = b == n - 1 && beam.JoinEnd,
                    Supports = sup.Skip(a).Take(b - a + 2).Where(s => s.Hi - s.Lo > Tol || (s.Lo > Tol && s.Lo < beam.Length - Tol))
                        .Select(s => new BbSupport(s.Lo - x0, s.Hi - x0)).ToList(),
                    LoadPoints = (beam.LoadPoints ?? new List<BbLoadPoint>()).Where(l => l.Lo > x0 && l.Hi < x1)
                        .Select(l => new BbLoadPoint(l.Lo - x0, l.Hi - x0, l.SoffitDepth)).ToList(),
                };
                res.Add(Tuple.Create(x0, sub, a, b - a + 1));
                a = b;
            }
            return res;
        }

        /// <summary>Давхцсан тулгуурыг нэгтгэнэ (дээд / доод давхрын багана, багана + хөндлөн дамнуруу).</summary>
        public static List<BbSupport> MergeSupports(IEnumerable<BbSupport> supports)
        {
            var res = new List<BbSupport>();
            foreach (BbSupport s in supports.OrderBy(x => x.Lo))
            {
                if (res.Count > 0 && s.Lo <= res[res.Count - 1].Hi + Tol)
                    res[res.Count - 1] = new BbSupport(res[res.Count - 1].Lo, Math.Max(res[res.Count - 1].Hi, s.Hi));
                else res.Add(s);
            }
            return res;
        }

        sealed class Row
        {
            public double[] Main = new double[0], Add = new double[0];
            public bool SecondLayer;
        }

        /// <summary>
        /// Үндсэн N ба нэмэлтийн хамгийн их тоог нэг эгнээнд (цэвэр зай, хамгийн их диаметрээр) багтаана: үндсэн нь булан + жигд, нэмэлт завсарт.
        /// Багтахгүй бол нэмэлт 2-р эгнээнд, өөрийн жигд байрлалаар.
        /// </summary>
        static Row MakeRow(BbBarSpec main, BbBarSpec[] adds, double w, double c, bool top, bool forceSecond, BbBeamRebar r)
        {
            var row = new Row();
            if (!main.Any) return row;
            int nAdd = adds.Where(a => a.Any).Select(a => a.N).DefaultIfEmpty(0).Max();
            int dAdd = adds.Where(a => a.Any).Select(a => a.D).DefaultIfEmpty(0).Max();
            string side = top ? "Дээд" : "Доод";
            if (!BbRebarCode.Fits(main.N, main.D, w, top)) r.Warnings.Add(side + " " + main + " нэг эгнээнд багтахгүй.");
            // Үндсэн арматур нэмэлтээс үл хамааран өөрийн жигд байрлалтай (хэрэглэгч: нэмэлт доод үндсэний дунд орж эвдэж байсан).
            row.Main = Spread(main.N, w, c, main.D);
            if (nAdd == 0) return row;
            // Нэмэлт нь үндсэний завсруудад (голын завсраас эхлэн тэгш хуваарилж, завсар дотроо жигд) — цэвэр зай хүрэлцвэл; үгүй бол 2-р эгнээ.
            double[] inGaps = forceSecond ? null : AddInGaps(row.Main, nAdd, main.D, dAdd, BbRebarCode.MinClear(Math.Max(main.D, dAdd), top));
            if (inGaps != null)
            {
                row.Add = MiddleFirst(inGaps);
                return row;
            }
            row.Add = MiddleFirst(Spread(nAdd, w, c, dAdd));
            row.SecondLayer = true;
            if (!BbRebarCode.Fits(nAdd, dAdd, w, top)) r.Warnings.Add(side + " нэмэлт " + nAdd + "Ø" + dAdd + " 2-р эгнээнд ч багтахгүй.");
            return row;
        }

        /// <summary>Хомутын дотор талд n ширхгийн төвүүд, захынх хомутад шүргэнэ.</summary>
        static double[] Spread(int n, double w, double c, int d)
        {
            if (n <= 0) return new double[0];
            double a = c + d / 2.0, b = c + w - d / 2.0;
            if (n == 1) return new[] { (a + b) / 2 };
            return Enumerable.Range(0, n).Select(i => a + (b - a) * i / (n - 1)).ToArray();
        }

        /// <summary>
        /// Үндсэний <paramref name="main"/> байрлалыг хөдөлгөхгүйгээр <paramref name="nAdd"/> нэмэлтийг завсруудад: тэгш хуваарилж, илүүг нь голын
        /// завсраас; завсар дотроо жигд.  Цэвэр зай (<paramref name="clear"/>) хүрэхгүй бол null.
        /// </summary>
        static double[] AddInGaps(double[] main, int nAdd, int dMain, int dAdd, double clear)
        {
            int g = main.Length - 1;
            if (g < 1) return null;
            var count = new int[g];
            for (int i = 0; i < g; i++) count[i] = nAdd / g;
            foreach (int i in Enumerable.Range(0, g).OrderBy(i => Math.Abs(i - (g - 1) / 2.0)).ThenBy(i => i).Take(nAdd % g)) count[i]++;
            var res = new List<double>();
            for (int i = 0; i < g; i++)
            {
                int k = count[i];
                if (k == 0) continue;
                double step = (main[i + 1] - main[i]) / (k + 1);
                if (step - (dMain + dAdd) / 2.0 < clear - 1e-6 || (k > 1 && step - dAdd < clear - 1e-6)) return null;
                for (int j = 1; j <= k; j++) res.Add(main[i] + j * step);
            }
            return res.ToArray();
        }

        /// <summary>Нэмэлт арматур цөөн тулгуур дээр голоосоо эхэлж эзэлнэ.</summary>
        static double[] MiddleFirst(double[] ys)
        {
            if (ys.Length == 0) return ys;
            double mid = (ys.Min() + ys.Max()) / 2;
            return ys.OrderBy(y => Math.Abs(y - mid)).ThenBy(y => y).ToArray();
        }

        /// <summary>Захын тулгуурт шулуун <paramref name="straight"/> хангалтгүй бол 90° хөл (≥ 10d, ≤ <paramref name="legMax"/>).</summary>
        static double EndHook(double straight, int d, BbBeamPreset p, double legMax, string what, BbBeamRebar r)
        {
            double lan = BbRebarCode.Anchorage(d, p.Steel, p.Concrete);
            if (straight >= lan - 1e-6) return 0;
            double leg = BbRebarCode.CeilTo(Math.Max(lan - straight, 10 * d), BbRebarCode.Round);
            if (leg > legMax + 1e-6)
            {
                r.Warnings.Add(what + " Ø" + d + " захын тулгуурт анкерлахгүй (" + Math.Round(straight + legMax) + " < " + lan + ").");
                return BbRebarCode.FloorTo(legMax, BbRebarCode.Round);
            }
            return leg;
        }

        /// <summary>
        /// <paramref name="x0"/>…<paramref name="x1"/>-ийг <paramref name="maxLen"/>-оос урт бол хэсэглэнэ: холбоосын төв = боломжит хамгийн
        /// холын <paramref name="centers"/>, тийм байхгүй бол хүч ихтэй бүсэд (2.0 коэффициенттэй урт) — анхааруулгатай.
        /// </summary>
        static void AddPieces(BbBeamRebar r, BbRunRole role, int d, double x0, double x1, double hook0, double hook1, double z, double[] y,
            int layer, double lap, double maxLen, List<double> centers)
        {
            foreach (double[] seg in Split(x0, x1, hook0, hook1, lap, maxLen, centers, r, role == BbRunRole.Top ? "Дээд" : "Доод"))
                r.Bars.Add(new BbBarRun
                {
                    Role = role, D = d, X0 = seg[0], X1 = seg[1], Z = z, Y = y, Layer = layer,
                    HookStart = Math.Abs(seg[0] - x0) < 1e-6 ? hook0 : 0, HookEnd = Math.Abs(seg[1] - x1) < 1e-6 ? hook1 : 0,
                });
        }

        public static List<double[]> Split(double x0, double x1, double hook0, double hook1, double lap, double maxLen,
            IList<double> centers, BbBeamRebar r = null, string what = "")
        {
            var res = new List<double[]>();
            if (maxLen <= 2 * lap) { res.Add(new[] { x0, x1 }); r?.Warnings.Add(what + ": стандарт урт холбоосоос богино."); return res; }
            double a = x0;
            while (true)
            {
                double h = res.Count == 0 ? hook0 : 0;
                if (x1 - a + h + hook1 <= maxLen + 1e-6) { res.Add(new[] { a, x1 }); break; }
                double limit = a + maxLen - h;   // хэсгийн төгсгөл ≤ limit
                double best = double.NaN;
                foreach (double cc in centers)
                    if (cc - lap / 2 > a + lap && cc + lap / 2 <= limit + 1e-6 && cc + lap / 2 < x1 && (double.IsNaN(best) || cc > best)) best = cc;
                if (double.IsNaN(best))
                {
                    best = limit - lap / 2;
                    if (best - lap / 2 <= a + Tol) { res.Add(new[] { a, x1 }); r?.Warnings.Add(what + ": хэсэглэж чадсангүй."); break; }
                    r?.Warnings.Add(what + " арматурын холбоос x=" + Math.Round(best) + " тохиромжгүй бүсэд.");
                }
                res.Add(new[] { a, best + lap / 2 });
                a = best - lap / 2;
            }
            return res;
        }

        static List<BbStirrupSet> Uniform(double x0, double x1, double s)
        {
            int m = Math.Max(1, (int)Math.Ceiling((x1 - x0) / s - 1e-9));
            return new List<BbStirrupSet> { new BbStirrupSet { X0 = x0, Count = m + 1, Spacing = (x1 - x0) / m } };
        }

        /// <summary>
        /// Тулгуурын хоёр бүс (нүүрээс алгаслын ¼) <paramref name="s1"/>-ээр, гол <paramref name="s2"/>-оор голлуулж; голын эхний/сүүлийн
        /// завсар s2/2…s2.  Алгасал богино бол жигд s1.
        /// </summary>
        /// <summary>
        /// Компанийн дээд арматур: тулгуур бүр дээр (захынх нь алс нүүрээс L хөлтэй) нүүрээс тал бүрийн алгаслын ⅓ + давхцал хүртэл; алгаслын голд
        /// <see cref="BbBeamPreset.SpanTop"/> ⅓…⅔, доор нь.  Богино алгасалд хоёр тулгуурынх давхцвал нэгтгэнэ (голын арматургүй).
        /// </summary>
        /// <summary>Нүүрээс хэмжсэн уртыг <see cref="BbBeamPreset.EndStep"/>-ээр дээш (ЖИШЭЭ-1: 196/196, ЖИШЭЭ 3: 175/228 төгсгөл 50-ийн үржвэр).</summary>
        /// <summary>Бүхэл урт: ≥ 200 бол 50-ийн, бага бол 10-ын ойрын үржвэр (хэрэглэгч: 330 → 350, 220 → 200, 185 → 190).</summary>
        public static double NiceRound(double v)
        {
            double s = v >= 200 - 1e-9 ? 50 : 10;
            return Math.Round(v / s, MidpointRounding.AwayFromZero) * s;
        }

        /// <summary>Бүхэл урт доош (багтахгүй үед).</summary>
        public static double NiceFloor(double v)
        {
            double s = v >= 200 - 1e-9 ? 50 : 10;
            return Math.Floor(v / s + 1e-9) * s;
        }

        static double EndRound(double len, BbBeamPreset p)
        {
            if (p.EndStep <= 0) return len;
            return (p.EndRoundNearest ? Math.Round(len / p.EndStep, MidpointRounding.AwayFromZero) : Math.Ceiling(len / p.EndStep - 1e-9)) * p.EndStep;
        }

        static void SupportTopBars(BbBeamRebar r, List<BbSupport> sup, int spanOffset, bool cantL, bool cantR, double xsT, double xeT, double zTop,
            double w, double c, Row top, BbBeamPreset p, Func<int, double, int, string, double> topHook, bool skipFirst = false)
        {
            int last = sup.Count - 1;
            var runs = new List<BbBarRun>();
            double lapOut = p.SpanTopLapInside ? 0 : p.SpanTopLap, lapIn = p.SpanTopLapInside ? p.SpanTopLap : 0;
            for (int i = 0; i < sup.Count; i++)
            {
                if (i == 0 && skipFirst) continue;   // өмнөх хэсэг тавьсан (ContinueTopStart)
                BbBarSpec a = p.TopBySupport != null && i < p.TopBySupport.Length && p.TopBySupport[i].HasValue ? p.TopBySupport[i].Value : p.Top;
                if (!a.Any) continue;
                double lL = i > 0 ? Len(r.Spans[i - 1 + spanOffset]) : 0;
                double lR = i < last ? Len(r.Spans[i + spanOffset]) : 0;
                var run = new BbBarRun
                {
                    Role = BbRunRole.Top, D = a.D, Z = zTop + (p.Top.D - a.D) / 2.0, Layer = 1,
                    Y = a.N == p.Top.N ? top.Main : Spread(a.N, w, c, a.D),
                    X0 = i == 0 ? xsT : sup[i].Lo - EndRound(p.SupportTopFrac * lL + lapOut, p),
                    X1 = i == last ? xeT : sup[i].Hi + EndRound(p.SupportTopFrac * lR + lapOut, p),
                };
                if (i == 0) run.HookStart = topHook(0, sup[0].Hi - xsT, a.D, "Дээд");
                if (i == last) run.HookEnd = topHook(1, xeT - sup[last].Lo, a.D, "Дээд");
                BbBarRun prev = runs.LastOrDefault();
                if (prev != null && run.X0 <= prev.X1 && prev.D == run.D && prev.N == run.N)
                {
                    prev.X1 = run.X1;
                    prev.HookEnd = run.HookEnd;
                }
                else runs.Add(run);
            }
            foreach (BbBarRun run in runs)
            {
                if (run.Length > p.MaxBarLength + 1e-6) r.Warnings.Add("Дээд Ø" + run.D + " " + Math.Round(run.Length) + " мм > " + p.MaxBarLength + ".");
                r.Bars.Add(run);
            }
            if (!p.SpanTop.Any) return;
            double z = zTop - (p.Top.D + p.SpanTop.D) / 2.0;
            for (int j = 0; j < last; j++)
            {
                BbSupport s = r.Spans[j + spanOffset];
                double x0 = s.Lo + EndRound(p.SupportTopFrac * Len(s), p) - lapIn, x1 = s.Hi - EndRound(p.SupportTopFrac * Len(s), p) + lapIn;
                if (runs.Any(u => u.X0 < x0 && u.X1 > x1)) continue;   // нэгтгэсэн
                r.Bars.Add(new BbBarRun { Role = BbRunRole.SpanTop, D = p.SpanTop.D, X0 = x0, X1 = x1, Z = z, Y = Spread(p.SpanTop.N, w, c, p.SpanTop.D) });
            }
        }

        /// <summary>
        /// ЖИШЭЭ-1-ийн бүс: тулгуурын нягт бүс (нүүрээс <paramref name="frac"/>·l хүртэл, дээш бүхэлдэнэ) <paramref name="s1"/>, гол
        /// <paramref name="s2"/>, солигдох завсар (s1 + s2)/2; үлдэгдлийг нягт бүсэд нэмж, &lt; s1-ийг хоёр завсарт хуваана.
        /// </summary>
        static List<BbStirrupSet> Zoned(double x0, double x1, BbSupport span, double s1, double s2, double frac)
        {
            double g = (s1 + s2) / 2;
            int n1 = (int)Math.Ceiling((span.Lo + frac * Len(span) - x0) / s1 - 1e-9);
            double rest = (x1 - x0) - 2 * n1 * s1 - 2 * g;
            if (n1 < 1 || rest < 0) return Uniform(x0, x1, s1);
            int m = (int)Math.Floor(rest / s2 + 1e-9);
            double rem = rest - m * s2;
            int extra = (int)Math.Floor(rem / s1 + 1e-9);
            rem -= extra * s1;
            int nl = n1 + (extra + 1) / 2, nr = n1 + extra / 2;
            double a = x0 + nl * s1;
            return new List<BbStirrupSet>
            {
                new BbStirrupSet { X0 = x0, Count = nl + 1, Spacing = s1 },
                new BbStirrupSet { X0 = a + g + rem / 2, Count = m + 1, Spacing = s2 },
                new BbStirrupSet { X0 = x1 - nr * s1, Count = nr + 1, Spacing = s1 },
            };
        }

        /// <summary>
        /// Туслах дамнуруутай алгасал: туслахын нүүр бүрээс <see cref="BbBeamPreset.FirstStirrup"/>-ээр эхэлж
        /// <see cref="BbBeamPreset.LoadPointStirrups"/> @<see cref="BbBeamPreset.LoadPointPitch"/>, туслахын өргөнд хомутгүй, бусад нь жигд ≤ s1.
        /// </summary>
        /// <summary>
        /// Туслах дамнуруутай алгасал (компани, ЖИШЭЭ-1 / 3-аас): тулгуурын нүүрээс frac·l нь s1, гол нь s2 (<see cref="ThreeZones"/>-ийн адил);
        /// туслах бүрийн нүүрээс гадагш <see cref="BbBeamPreset.LoadPointStirrups"/> @<see cref="BbBeamPreset.LoadPointPitch"/>, туслахын өргөнд
        /// хомутгүй; бүлгийн хажууд <see cref="BbBeamPreset.LoadPointBand"/> s1.  Хоорондох хэсгийг бүсийн алхмаар дүүргэнэ: дараагийн бүлгээс ≥ 50,
        /// ≤ s1 + 50 завсрыг хоосон үлдээнэ (ЖИШЭЭ 3 ДН-1-8: 17@100, 3@50, туслах, 3@50, 2300…4300 @200, …).
        /// </summary>
        static List<BbStirrupSet> LoadPointZones(double x0, double x1, BbSupport span, List<BbLoadPoint> lps, BbBeamPreset p, double s1, double s2)
        {
            double zl = span.Lo + p.ZoneFrac * Len(span), zr = span.Hi - p.ZoneFrac * Len(span);
            int n = Math.Max(1, p.LoadPointStirrups);
            var fixedX = new List<double> { x0, x1 };
            var lpX = new List<double>();
            var bands = new List<double[]>();
            foreach (BbLoadPoint lp in lps)
            {
                double lo = lp.Lo - p.FirstStirrup - (n - 1) * p.LoadPointPitch, hi = lp.Hi + p.FirstStirrup + (n - 1) * p.LoadPointPitch;
                for (int k = 0; k < n; k++)
                {
                    lpX.Add(lp.Lo - p.FirstStirrup - k * p.LoadPointPitch);
                    lpX.Add(lp.Hi + p.FirstStirrup + k * p.LoadPointPitch);
                }
                if (p.LoadPointBand > 0) { bands.Add(new[] { lo - p.LoadPointBand, lo }); bands.Add(new[] { hi, hi + p.LoadPointBand }); }
            }
            // Туслахын өргөн доторх ба алгаслаас гадуурх байрлалыг хасна.
            fixedX.AddRange(lpX);
            Func<double, bool> isLp = x => lpX.Any(v => Math.Abs(v - x) < 0.5);
            List<double> pos = fixedX.Where(x => x >= x0 - Tol && x <= x1 + Tol && !lps.Any(lp => x > lp.Lo - Tol && x < lp.Hi + Tol))
                .OrderBy(x => x).Aggregate(new List<double>(), (acc, x) => { if (acc.Count == 0 || x - acc[acc.Count - 1] > 1) acc.Add(x); return acc; });
            Func<double, bool> dense = x => x <= zl + Tol || x >= zr - Tol || bands.Any(b => x >= b[0] - Tol && x <= b[1] + Tol);
            var all = new List<double>(pos);
            for (int i = 0; i + 1 < pos.Count; i++)
            {
                double a = pos[i], b = pos[i + 1];
                if (lps.Any(lp => a < lp.Lo && b > lp.Hi)) continue;   // туслахын өргөн
                if (b - a <= s1 + 50 + Tol) continue;
                if (p.LoadPointBand <= 0) { FillCentered(all, a, b, x0, x1, zl, zr, s1, s2, dense); continue; }
                // Баруун тулгуурт тулсан хэсгийг тулгуураас (ЖИШЭЭ-1 ДН-2: 6750 → 5150 @100, туслахын бүлгийн хажууд 50 үлдэнэ), бусдыг зүүнээс.
                bool back = Math.Abs(b - x1) < Tol && Math.Abs(a - x0) > Tol;
                double x = back ? b : a, end = back ? a : b;
                int dirn = back ? -1 : 1;
                while (true)
                {
                    double st = dense(x + dirn * s1) ? s1 : s2;
                    if (dirn * (end - (x + dirn * st)) < 50 - Tol) break;
                    x += dirn * st;
                    all.Add(x);
                }
                // Үлдсэн завсар алхмаас их бол голд нь нэг (норм: алхам хэтрэхгүй).
                if (Math.Abs(end - x) > s2 + Tol) all.Add((x + end) / 2);
            }
            all.Sort();
            // Ижил алхамтай дараалсныг нэг бүлэг болгоно.
            var res = new List<BbStirrupSet>();
            int j = 0;
            while (j < all.Count)
            {
                int k = j;
                double step = j + 1 < all.Count && isLp(all[j + 1]) == isLp(all[j]) ? all[j + 1] - all[j] : 0;
                // Туслахын 3@50 бүлэг тусдаа set (дүүргэлттэй нийлүүлэхгүй).
                while (k + 1 < all.Count && Math.Abs(all[k + 1] - all[k] - step) < 0.5 && !lps.Any(lp => all[k] < lp.Lo && all[k + 1] > lp.Hi)
                    && isLp(all[k + 1]) == isLp(all[j])) k++;
                if (k == j) res.Add(new BbStirrupSet { X0 = all[j], Count = 1 });
                else res.Add(new BbStirrupSet { X0 = all[j], Count = k - j + 1, Spacing = step });
                j = k + 1;
            }
            return res;
        }

        /// <summary>
        /// Зурвасгүй (ЖИШЭЭ 3) дүүргэлт: тулгуурт тулсан хэсэгт тулгуураас s1-ээр (завсрын тоо = round((frac·l − эхний) / s1), туслахын бүлгээс ≥ 50);
        /// үлдсэн хэсэг ихэнхдээ нягт бүсэд бол s1-ээр зүүнээс, эс бол s2-оор ГОЛД ТӨВЛӨРҮҮЛЖ (хоёр захад ≥ 50; ДДН-1: 3049…5449, 2025 / 2225 / 2425).
        /// </summary>
        static void FillCentered(List<double> all, double a, double b, double x0, double x1, double zl, double zr, double s1, double s2, Func<double, bool> dense)
        {
            if (Math.Abs(a - x0) < Tol)
            {
                int k = (int)Math.Round((zl - x0) / s1, MidpointRounding.AwayFromZero);
                int i = 1;
                for (; i <= k && x0 + i * s1 <= b - 50 + Tol; i++) all.Add(x0 + i * s1);
                a = x0 + (i - 1) * s1;
            }
            if (Math.Abs(b - x1) < Tol)
            {
                int k = (int)Math.Round((x1 - zr) / s1, MidpointRounding.AwayFromZero);
                int i = 1;
                for (; i <= k && x1 - i * s1 >= a + 50 - Tol; i++) all.Add(x1 - i * s1);
                b = x1 - (i - 1) * s1;
            }
            double len = b - a;
            if (len <= s1 + 50 + Tol) return;
            double denseLen = Math.Max(0, Math.Min(b, zl) - a) + Math.Max(0, b - Math.Max(a, zr));
            if (denseLen > len / 2)
            {
                for (double x = a + s1; x <= b - 50 + Tol; x += s1) all.Add(x);
                return;
            }
            int n = Math.Max(0, (int)Math.Floor((len - 100) / s2 + 1e-9));
            double g = (len - n * s2) / 2;
            for (int i = 0; i <= n; i++) all.Add(a + g + i * s2);
        }

        static List<BbStirrupSet> AroundLoadPoints(double x0, double x1, List<BbLoadPoint> lps, BbBeamPreset p, double s1)
        {
            var res = new List<BbStirrupSet>();
            int n = Math.Max(1, p.LoadPointStirrups);
            double dense = (n - 1) * p.LoadPointPitch;
            double a = x0;
            for (int k = 0; k <= lps.Count; k++)
            {
                double b = k < lps.Count ? lps[k].Lo - p.FirstStirrup - dense : x1;
                if (k > 0 && n > 1) res.Add(new BbStirrupSet { X0 = a - dense, Count = n - 1, Spacing = p.LoadPointPitch });
                if (b > a + Tol) res.AddRange(Uniform(a, b, s1));
                else res.Add(new BbStirrupSet { X0 = a, Count = 1 });
                if (k < lps.Count && n > 1) res.Add(new BbStirrupSet { X0 = b + p.LoadPointPitch, Count = n - 1, Spacing = p.LoadPointPitch });
                if (k < lps.Count) a = lps[k].Hi + p.FirstStirrup + dense;
            }
            return res;
        }

        /// <summary>
        /// Шилжилтгүй гурван бүс.  <paramref name="example"/> (компани, ЖИШЭЭ 3-аас хэмжсэн — 5 алгасал бүгд таарсан): нягт бүсийн завсар = round((frac·l −
        /// эхний) / s1), голынх floor(frac·l / s2) + 1 хомут төвд; эс бол (норм) нягт бүс frac·l-ээс богиносохгүй.
        /// </summary>
        static List<BbStirrupSet> ThreeZones(double x0, double x1, BbSupport span, double s1, double s2, double frac, bool example = false)
        {
            double z = Len(span) * frac;
            if (example)
            {
                int k = (int)Math.Round((span.Lo + z - x0) / s1, MidpointRounding.AwayFromZero);
                double ea = x0 + k * s1, eb = x1 - k * s1;
                int cnt = (int)Math.Floor(z / s2 + 1e-9);
                Func<double> gap = () => ((eb - ea) - (cnt - 1) * s2) / 2;
                while (cnt > 1 && gap() < s1 / 2 - 1e-9) cnt--;
                while (gap() > s2 + 1e-9) cnt++;
                if (k >= 1 && cnt >= 1 && gap() >= s1 / 2 - 1e-9)
                    return new List<BbStirrupSet>
                    {
                        new BbStirrupSet { X0 = x0, Count = k + 1, Spacing = s1 },
                        new BbStirrupSet { X0 = ea + gap(), Count = cnt, Spacing = s2 },
                        new BbStirrupSet { X0 = eb, Count = k + 1, Spacing = s1 },
                    };
            }
            int n1 = (int)Math.Floor((span.Lo + z - x0) / s1 + 1e-9);
            double a = x0 + n1 * s1, b = x1 - n1 * s1;
            if (n1 < 1 || b - a < s2 + s1) return Uniform(x0, x1, s1);
            int m = (int)Math.Floor((b - a) / s2 + 1e-9);
            double off = ((b - a) - m * s2) / 2;
            if (off < s2 / 2 - 1e-9) { m--; off = ((b - a) - m * s2) / 2; }
            var res = new List<BbStirrupSet> { new BbStirrupSet { X0 = x0, Count = n1 + 1, Spacing = s1 } };
            if (m >= 0) res.Add(new BbStirrupSet { X0 = a + off, Count = m + 1, Spacing = s2 });
            res.Add(new BbStirrupSet { X0 = b, Count = n1 + 1, Spacing = s1 });
            return res;
        }

        static List<BbStirrupSet> Pattern(double x0, double x1, string pattern, BbBeamRebar r, int span)
        {
            var res = new List<BbStirrupSet>();
            double x = x0;
            bool first = true;
            foreach (string part in pattern.Split(new[] { '+' }, StringSplitOptions.RemoveEmptyEntries))
            {
                string[] kv = part.Split('*', '×', 'x');
                int n;
                double s;
                if (kv.Length != 2 || !int.TryParse(kv[0].Trim(), out n) || !double.TryParse(kv[1].Trim(), NumberStyles.Float, CultureInfo.InvariantCulture, out s)
                    || n < 1 || s <= 0)
                {
                    r.Warnings.Add("Хомутын загвар буруу: " + pattern);
                    return Uniform(x0, x1, r.S1);
                }
                // «4*200» = 200 алхамтай 4 завсар: эхнийх нь өмнөх бүлгийн сүүлийн хомутаас.
                double start = first ? x : x + s;
                int count = first ? n + 1 : n;
                if (start + (count - 1) * s > x1 + 1e-6)
                {
                    r.Warnings.Add("Алгасал " + (span + 1) + ": «" + pattern + "» алгаслаас урт.");
                    count = Math.Max(0, (int)Math.Floor((x1 - start) / s + 1e-9) + 1);
                    if (count > 0) res.Add(new BbStirrupSet { X0 = start, Count = count, Spacing = s });
                    return res;
                }
                res.Add(new BbStirrupSet { X0 = start, Count = count, Spacing = s });
                x = start + (count - 1) * s;
                first = false;
            }
            if (x1 - x > 1)
            {
                if (res.Count > 0 && x1 - x > res[res.Count - 1].Spacing + 1e-6)
                    r.Warnings.Add("Алгасал " + (span + 1) + ": «" + pattern + "»-ийн сүүлийн завсар " + Math.Round(x1 - x) + " мм.");
                res.Add(new BbStirrupSet { X0 = x1, Count = 1, Spacing = 0 });
            }
            return res;
        }
    }
}
