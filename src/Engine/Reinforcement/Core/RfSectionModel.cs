using System;
using System.Collections.Generic;

namespace RevitMcpAddin.Reinforcement.Core
{
    /// <summary>Гишүүний ХАГАС (огтлолын) тал.  «Зүүн/Баруун/Дээд/Доод» нь ГИШҮҮНИЙ локал тэнхлэгээр (харагдацад ойр).</summary>
    public enum RfSide
    {
        Left = 0,
        Right = 1,
        Top = 2,
        Bottom = 3,
    }

    /// <summary>Хомутын хэмжээсийн лавлах: гадна ирмэг, дотор ирмэг эсвэл тэнхлэг (centerline).</summary>
    public enum RfStirrupRef
    {
        Outer = 0,
        Inner = 1,
        Center = 2,
    }

    public enum RfBarClass
    {
        /// <summary>Танигдаагүй / огтлолд хамаагүй (ж: хөндлөн дам нурууны хомут, спираль).</summary>
        Other = 0,
        /// <summary>Хомут / боолт (transverse): хавтгай, хавтгайн нормаль нь огтлолын нормальтай параллель.</summary>
        Transverse = 1,
        /// <summary>Ажлын (уртааш) арматур: чиглэл нь огтлолын нормальтай параллель.</summary>
        Longitudinal = 2,
    }

    /// <summary>
    /// Revit-ийн <c>RebarStyle</c> (арматурын shape-ийн төрөл).  Core Revit-ийг мэдэхгүй тул толь.
    /// <see cref="Unknown"/> = shape/free-form accessor-оос уншигдсангүй (геометрээр нөөц ангилна).
    /// </summary>
    public enum RfRebarStyle
    {
        Unknown = 0,
        Standard = 1,
        StirrupTie = 2,
    }

    /// <summary>Ангилал юугаар шийдэгдсэн (тайлан, шалгалтад).</summary>
    public enum RfClassBasis
    {
        /// <summary>Style байхгүй — зөвхөн геометр.</summary>
        Geometry = 0,
        /// <summary>Style ба геометр хоёр зөвшөөрсөн.</summary>
        Style,
        /// <summary>Style ба геометр зөрсөн — алгасна (таамаглахгүй), тайланд тоо.</summary>
        Mismatch,
        /// <summary>
        /// Standard style боловч огтлолд хомут шиг хавтгай гогцоо (бөгж / хөндлөн боолтыг Standard shape-ээр загварчилсан).
        /// «Standard ⇒ ЗӨВХӨН tag» тул гогцоог tag-лана, ХЭМЖЭЭС тавихгүй.
        /// </summary>
        StandardLoop,
    }

    /// <summary>Эзний (бетон) нэг хавтгай нүүр — харагдацын 2D координатад.</summary>
    public sealed class RfFaceSample
    {
        /// <summary>Revit тал дахь Reference-тэй холбох түлхүүр.</summary>
        public int Id;

        /// <summary>Нүүр дээрх цэг (харагдацын u, v).</summary>
        public RfV2 Origin;

        /// <summary>Нүүрний гадагш нормаль (харагдацын хавтгайд, НЭГЖ урттай).</summary>
        public RfV2 Normal;

        public double Area;

        /// <summary>
        /// Нүүрний хилийн цэгүүдийн огтлолын хавтгайгаас (загварын нормаль дагуух) зайны хамгийн бага/их утга, фут.  Нүүр огтлолын хавтгайг
        /// ХӨВЖ байж л (DepthMin ≤ 0 ≤ DepthMax) энэ огтлолын бодит хилийг тодорхойлно: налуу/хазгай/ховилтой гишүүний ӨӨР станцын нүүр
        /// «хамгийн гадна нүүр» болж, ӨӨР цэгийн хомутыг хэмжүүлж БОЛОХГҮЙ.  Уншигдаагүй бол хязгааргүй (= хөвж байна гэж үзнэ).
        /// </summary>
        public double DepthMin = double.NegativeInfinity;
        public double DepthMax = double.PositiveInfinity;

        /// <summary>Нүүр огтлолын хавтгайг (1 мм-ийн хүлцэлтэй) хөвж байна уу.</summary>
        public bool StraddlesCutPlane
        {
            get
            {
                double tol = RfTol.MmToFt(1.0);
                return DepthMin <= tol && DepthMax >= -tol;
            }
        }

        public RfFaceSample Clone(bool flipNormal)
        {
            return new RfFaceSample
            {
                Id = Id, Origin = Origin, Normal = flipNormal ? -Normal : Normal, Area = Area, DepthMin = DepthMin, DepthMax = DepthMax,
            };
        }
    }

    /// <summary>Арматурын нэг ширхгийн голын шугам (tessellated, загварын координатад).</summary>
    public sealed class RfBarSample
    {
        public long Id;
        public int BarIndex;
        public double Diameter;

        /// <summary>true = ЗӨВХӨН tag (Standard style-тай гогцоо) — хомутын хэмжээсийн сонголтод ОРОХГҮЙ.</summary>
        public bool TagOnly;

        public readonly List<RfV3> Points = new List<RfV3>();
    }

    /// <summary>Огтлолыг огтолсон ажлын арматурын нэг ширхэг (харагдацын хавтгай дээрх байрлал).</summary>
    public sealed class RfLongBar
    {
        public long Id;
        public int BarIndex;
        public RfV2 Pos;
        public double Diameter;

        /// <summary>
        /// Tag-ийн бүлэглэлтийн түлхүүр (Revit талаас: арматурын төрөл | голч | shape).  Хоосон бол бүлэглэхгүй (элемент бүр тусдаа).
        /// </summary>
        public string Group = "";
    }

    public sealed class RfSectionOptions
    {
        public bool Left = true, Right = true, Top = true, Bottom = true;
        public RfStirrupRef Ref = RfStirrupRef.Outer;
        public bool DoDimensions = true;
        public bool TagLongitudinal = true;
        public bool TagStirrups = true;

        /// <summary>
        /// true = ижил төрөл/голч/shape-тэй, гишүүний ИЖИЛ талд байгаа ажлын арматурыг НЭГ tag-аар (tag хэсэггүй).
        /// false = арматурын элемент бүр өөрийн tag-тай.
        /// </summary>
        public bool GroupTags = true;

        /// <summary>
        /// true = нэг арматурын ОЛОНЛОГ (Rebar set — олон ширхэгтэй НЭГ элемент) нэг логик объект: ширхэг бүрээр биш, олонлог бүрд ЯГ НЭГ tag.
        /// Олонлогийн ширхгүүд огтлолд гишүүний өөр өөр талд ойр харагдаж болох (хоёр захын ширхэг Зүүн/Баруун талд ойр) тул ширхэг бүрийн ойр талаар
        /// бүлэглэвэл ИЖИЛ олонлог 2–3 tag болдог байсан.  Одоо тал нь олонлогийн ТӨВӨӨР тогтоно.
        /// false = өмнөх зан төлөв (ширхэг бүрийн ойр тал).
        /// </summary>
        public bool SingleTagPerSet = false;

        /// <summary>
        /// <see cref="SingleTagPerSet"/>-тэй хамт: нэг олонлогийн БҮХ харагдаж буй ширхгийг нэг шошгонд (multi-leader) холбоно — шошго нэг, leader ширхэг бүрд.
        /// Хэд хэдэн элемент нэг шошгонд нэгдсэн бүлэгт хэрэглэгдэхгүй (шошго нь ганц элементийн мэдээллийг л уншдаг).
        /// </summary>
        public bool MultiLeaderPerSet = false;

        /// <summary>Multi-leader шошгонд leader-үүдийг нэг ишээр нэгтгэнэ (Revit «Merge Leaders» — <c>IndependentTag.MergeElbows</c>).</summary>
        public bool MergeLeaders = false;

        /// <summary>Нэг шошгонд холбох ширхгийн дээд (хэт олон leader зураг бохирдуулна, Revit удаан) — үлдсэн нь алгасагдаж мэдэгдэнэ.</summary>
        public const int MaxLeadersPerTag = 40;

        /// <summary>Хэмжээсийн шугамыг гишүүний ирмэгээс холдуулах зай (фут, загварын).</summary>
        public double DimOffsetFt = 0.1;

        /// <summary>
        /// Хэвтээ (өргөнийг хэмжих) гинжийг гишүүний АЛЬ талд тавих: <see cref="RfSide.Top"/> (өгөгдмөл) эсвэл <see cref="RfSide.Bottom"/>.
        /// Хомутын гинж ба гишүүний гадна гинж хоёулаа энэ талд; шошго тэдгээрээс цааш гарна (2026-10-09, эзний хүсэлт).
        /// </summary>
        public RfSide HorizontalDimSide = RfSide.Top;

        /// <summary>Босоо (өндрийг хэмжих) гинжийн тал: <see cref="RfSide.Right"/> (өгөгдмөл) эсвэл <see cref="RfSide.Left"/>.</summary>
        public RfSide VerticalDimSide = RfSide.Right;

        /// <summary>
        /// «Байрлал — 4 талд» (ерөнхий хэмжээсийн «Барилгын 4 талд»-тай ИЖИЛ, 2026-10-09 эзний хүсэлт): хэвтээ гинж Дээд БА Доод, босоо гинж Зүүн БА Баруун
        /// талд хоёуланд.  false = зөвхөн <see cref="HorizontalDimSide"/> / <see cref="VerticalDimSide"/> талд.
        /// </summary>
        public bool DimAllSides = false;

        /// <summary>Тэнхлэгийн гинжийг тавих БҮХ тал (эхнийх нь үндсэн тал).</summary>
        public RfSide[] DimSidesFor(bool alongU)
        {
            RfSide s = DimSideFor(alongU);
            return DimAllSides ? new[] { s, Opposite(s) } : new[] { s };
        }

        public static RfSide Opposite(RfSide s)
        {
            switch (s)
            {
                case RfSide.Left: return RfSide.Right;
                case RfSide.Right: return RfSide.Left;
                case RfSide.Top: return RfSide.Bottom;
                default: return RfSide.Top;
            }
        }

        /// <summary>Шугамын хөндлөн координат гишүүний аль талд байгаа (хэвтээ гинж: Дээд/Доод, босоо: Баруун/Зүүн).</summary>
        public static RfSide SideOfLine(RfSectionRect rect, bool alongU, double linePos)
        {
            if (alongU) return linePos >= (rect.MinV + rect.MaxV) / 2 ? RfSide.Top : RfSide.Bottom;
            return linePos >= (rect.MinU + rect.MaxU) / 2 ? RfSide.Right : RfSide.Left;
        }

        /// <summary>Тэнхлэгийн гинжийн тал — буруу утгыг өгөгдмөл болгоно (хэвтээ → Дээд/Доод, босоо → Баруун/Зүүн).</summary>
        public RfSide DimSideFor(bool alongU)
        {
            if (alongU) return HorizontalDimSide == RfSide.Bottom ? RfSide.Bottom : RfSide.Top;
            return VerticalDimSide == RfSide.Left ? RfSide.Left : RfSide.Right;
        }

        /// <summary>
        /// Гишүүний <paramref name="rect"/>-ийн <paramref name="side"/> талын ирмэгээс ГАДАГШ <paramref name="distance"/> зайтай шугамын хөндлөн координат
        /// (Top: MaxV + d, Bottom: MinV − d, Right: MaxU + d, Left: MinU − d).
        /// </summary>
        public static double OutsideLine(RfSectionRect rect, RfSide side, double distance)
        {
            switch (side)
            {
                case RfSide.Bottom: return rect.MinV - distance;
                case RfSide.Left: return rect.MinU - distance;
                case RfSide.Right: return rect.MaxU + distance;
                default: return rect.MaxV + distance;
            }
        }

        /// <summary>
        /// Гишүүний хэмжээсийг тэнхлэг, хучилт, ханатай уялдуулсан ГАДНА гинж (<see cref="RfMemberDims"/>) — «150 | 150», «170 | 330».
        /// Хомутын гинжний гадна <see cref="MemberPitchFt"/>-ээр.
        /// </summary>
        public bool MemberDims = false;
        public double MemberPitchFt = 0.08;

        /// <summary>Гишүүний нүүрнээс энэ зайнаас (загварын фут) холын тэнхлэг/хөршийн нүүрийг гадна гинжид оруулахгүй (≈ 1 м).</summary>
        public double MemberReachFt = 3.2808;

        /// <summary>Tag-ийг гишүүнээс (хэмжээсээс) цааш гаргах зай (фут).</summary>
        public double TagOutFt = 0.1;

        /// <summary>Хоёр tag хоорондын хамгийн бага зай (фут).</summary>
        public double TagGapFt = 0.02;

        /// <summary>Tag хайрцгийн ойролцоо хэмжээ (фут): өргөн, өндөр.</summary>
        public double TagWidthFt = 0.15;
        public double TagHeightFt = 0.06;

        public bool Wants(RfSide s)
        {
            switch (s)
            {
                case RfSide.Left: return Left;
                case RfSide.Right: return Right;
                case RfSide.Top: return Top;
                default: return Bottom;
            }
        }
    }

    /// <summary>Planner-ийн бүх оролт (Revit-ээс уншсан цэвэр өгөгдөл).</summary>
    public sealed class RfSectionInput
    {
        public RfViewFrame View;
        public readonly List<RfFaceSample> Faces = new List<RfFaceSample>();
        public readonly List<RfBarSample> Stirrups = new List<RfBarSample>();
        public readonly List<RfLongBar> Longitudinal = new List<RfLongBar>();

        /// <summary>Гишүүнд шүргэлцсэн хучилт/ханын нүүр ба огтлол дахь тэнхлэгүүд — гадна гинжид (<see cref="RfMemberDims"/>).</summary>
        public readonly List<RfAuxSample> Aux = new List<RfAuxSample>();
        public RfSectionOptions Options = new RfSectionOptions();
    }

    /// <summary>Гишүүний локал тэнхлэгт хавтгай тэгш өнцөгт (бетон огтлол).</summary>
    public struct RfSectionRect
    {
        public double MinU, MaxU, MinV, MaxV;

        /// <summary>Нүүр тус бүрийн Id (олдоогүй бол −1).</summary>
        public int FaceLeft, FaceRight, FaceBottom, FaceTop;

        /// <summary>
        /// Тал дээр огтлолын хавтгайг хөвсөн, ХАРИН ӨӨР байрлалтай (&gt; 1 мм) параллель нүүр хоёр ба түүнээс олон бий (T/L хэлбэр, ховил, ledger) —
        /// аль нүүр нь энэ хомуттай харьцуулах бетоны хил гэдгийг нүүрний хүрээгээр тодорхойлж БОЛОХГҮЙ.  Хэмжээс тавихгүй (шударга алгасалт).
        /// </summary>
        public bool AmbiguousLeft, AmbiguousRight, AmbiguousBottom, AmbiguousTop;

        public bool IsAmbiguous(RfSide s)
        {
            switch (s)
            {
                case RfSide.Left: return AmbiguousLeft;
                case RfSide.Right: return AmbiguousRight;
                case RfSide.Top: return AmbiguousTop;
                default: return AmbiguousBottom;
            }
        }

        public double Width { get { return MaxU - MinU; } }
        public double Height { get { return MaxV - MinV; } }
        public RfV2 Center { get { return new RfV2((MinU + MaxU) / 2, (MinV + MaxV) / 2); } }
        public bool Valid { get { return MaxU > MinU && MaxV > MinV; } }

        public int FaceOf(RfSide s)
        {
            switch (s)
            {
                case RfSide.Left: return FaceLeft;
                case RfSide.Right: return FaceRight;
                case RfSide.Top: return FaceTop;
                default: return FaceBottom;
            }
        }

        /// <summary>Тал дээрх нүүрний ГАДНА чиглэлийн координат (Left: MinU, Right: MaxU, Top: MaxV, Bottom: MinV).</summary>
        public double FacePos(RfSide s)
        {
            switch (s)
            {
                case RfSide.Left: return MinU;
                case RfSide.Right: return MaxU;
                case RfSide.Top: return MaxV;
                default: return MinV;
            }
        }
    }

    /// <summary>Хомутын нэг гогцооны голын шугамын хүрээ (локал координатад).</summary>
    public sealed class RfStirrupLoop
    {
        public long Id;
        public int BarIndex;
        public double Diameter;

        /// <summary>true = ЗӨВХӨН tag; хэмжээс тавихад тооцогдохгүй.</summary>
        public bool TagOnly;

        public double MinU, MaxU, MinV, MaxV;

        /// <summary>
        /// Тал бүрийн хилийн дагуу голын шугамын БОДИТ шулуун хэсэг хэдэн хувийг (0…1) эзэлж байгаа (Left, Right, Top, Bottom дарааллаар).
        /// Хаалттай тэгш өнцөгт хомутын тал ≈ 1; U хэлбэр/ромб/гурвалжны нээлттэй тал ≈ 0 — хүрээний хайрцаг тэнд ХУДАЛ «ирмэг» зохиодог.
        /// Анхны утга 1 (шалгаагүй = хүлээн авна).
        /// </summary>
        public double CoverLeft = 1, CoverRight = 1, CoverTop = 1, CoverBottom = 1;

        public double CoverOf(RfSide s)
        {
            switch (s)
            {
                case RfSide.Left: return CoverLeft;
                case RfSide.Right: return CoverRight;
                case RfSide.Top: return CoverTop;
                default: return CoverBottom;
            }
        }

        /// <summary>Гогцоо огтлолын хавтгайгаас хэр зайтай (загварын нормаль дагуу, фут; тэмдэгтэй).</summary>
        public double Depth;

        /// <summary>
        /// Тал бүрийн БОДИТ хөлийн (хилийн дагуух шулуун хэсгийн) голын шугамын координат; NaN = олдоогүй (хүрээний min/max хэрэглэнэ).
        /// ⚠️ ХЭМЖСЭН (2026-10-05, 135° дэгээтэй хомут): дэгээний буланд эхлэл/төгсгөлийн хэсэг нэг нэгнийхээ хажуугаар d/2 (Ø8 → 4 мм)
        /// гарч давхцдаг — хүрээний min/max нь тэр давхцлын үзүүр болж, хөл нь «хилээс 4 мм дотор» гэж үзэгдэн талыг нээлттэй гэж
        /// хасдаг, ирмэгийн байрлал ч 4 мм зөрдөг байв.  <see cref="RfSectionGeometry.SideLeg"/> хөлийг олно.
        /// </summary>
        public double LegLeft = double.NaN, LegRight = double.NaN, LegTop = double.NaN, LegBottom = double.NaN;

        /// <summary>Тал дээрх голын шугамын хилийн координат: бодит хөл олдсон бол түүний координат, үгүй бол Left/Bottom = min, Right/Top = max.</summary>
        public double Extent(RfSide s)
        {
            switch (s)
            {
                case RfSide.Left: return IsFinite(LegLeft) ? LegLeft : MinU;
                case RfSide.Right: return IsFinite(LegRight) ? LegRight : MaxU;
                case RfSide.Top: return IsFinite(LegTop) ? LegTop : MaxV;
                default: return IsFinite(LegBottom) ? LegBottom : MinV;
            }
        }

        private static bool IsFinite(double v)
        {
            return !double.IsNaN(v) && !double.IsInfinity(v);
        }
    }

    /// <summary>Хомутын нэг хэмжээс (гишүүний бетон нүүр ↔ хомутын сонгосон ирмэг).</summary>
    public sealed class RfDimPlan
    {
        public RfSide Side;
        public RfStirrupRef Ref;

        /// <summary>Хэмжих чиглэл дэх нүүрний координат ба хомутын ирмэгийн координат (локал).</summary>
        public double FacePos;
        public double EdgePos;

        /// <summary>Нүүрээс хомутын ирмэг хүртэлх зай (дотогш эерэг) — Revit хэмжээсийн хүлээгдэж буй утга.</summary>
        public double Distance;

        /// <summary>Хэмжээсийн шугамын хөндлөн координат (Left/Right: v; Top/Bottom: u).</summary>
        public double LinePos;

        /// <summary>Хомутын ирмэгийн гогцооны сунаж буй хүрээ (хөндлөн тэнхлэгт) — proxy шугамын урт.</summary>
        public double EdgeSpanMin, EdgeSpanMax;

        public int FaceId;
        public long StirrupId;
        public int StirrupBarIndex;
        public double StirrupDiameter;

        /// <summary>true = хэмжих чиглэл u (Left/Right); false = v (Top/Bottom).</summary>
        public bool AlongU { get { return Side == RfSide.Left || Side == RfSide.Right; } }
    }

    /// <summary>Tag-ийн төлөвлөгөө (локал координатад).</summary>
    public sealed class RfTagPlan
    {
        public long Id;
        public bool IsStirrup;
        public int BarIndex;
        public RfSide Side;
        public RfV2 Target;

        /// <summary>Tag толгойн төв — ГИШҮҮНИЙ ЛОКАЛ координатад.</summary>
        public RfV2 Head;

        /// <summary>Энэ tag хэдэн арматурын элементийг төлөөлж буй (бүлэглэлттэй үед ≥ 1).</summary>
        public int GroupCount = 1;

        /// <summary>
        /// Multi-leader: энэ шошгонд холбох олонлогийн ширхгүүдийн индекс (<see cref="BarIndex"/> эхнийх нь) ба тэдгээрийн огтлол дахь байрлал
        /// (гишүүний локал).  Хоосон = ердийн (нэг leader).
        /// </summary>
        public List<int> BarIndices = new List<int>();
        public List<RfV2> BarTargets = new List<RfV2>();

        /// <summary>Tag-ийн ХАРАГДАЦ дахь (хэвтээ) хайрцгийн хэмжээ.</summary>
        public double Width, Height;

        /// <summary>Тэр хайрцгийг гишүүний локал тэнхлэгт (эргэлттэй бол bounding) хэмжсэн хэмжээ — layout-д.</summary>
        public double LocalWidth, LocalHeight;
    }

    public enum RfSectionWarn
    {
        /// <summary>Эзний тал дахь нүүр олдсонгүй (Arg = тал).</summary>
        HostFaceMissing,
        /// <summary>Нүүрнүүд тэгш өнцөгт бус — зөвхөн нүүрийн хүрээгээр тооцсон.</summary>
        NotRectangular,
        NoFaces,
        NoStirrup,
        NoLongitudinal,
        /// <summary>Тал дээр хомут олдсонгүй (Arg = тал).</summary>
        StirrupSideMissing,
        /// <summary>Хомутын ирмэг бетоноос гадна байна (Arg = тал) — өгөгдөл буруу.</summary>
        StirrupOutsideConcrete,
        /// <summary>Хэд хэдэн хомут — зөвхөн хамгийн гаднах нь хэмжигдсэн.</summary>
        ManyStirrups,
        /// <summary>Хомутын голч уншигдсангүй (≤ 0) — «Гадна/Дотор ирмэг» хэмжээс тавигдахгүй (зөвхөн «Тэнхлэг» боломжтой).</summary>
        StirrupDiameterUnknown,
        /// <summary>Tag-ууд давхцлаа бүрэн арилгаж чадсангүй.</summary>
        TagOverlapRemains,
        /// <summary>Тал дээр огтлолыг хөвсөн, өөр байрлалтай хоёр ба түүнээс олон параллель нүүр бий (T/L хэлбэр, ховил) — хэмжээс тавигдахгүй (Arg = тал).</summary>
        HostFaceAmbiguous,
        /// <summary>Тал дээрх хомутын хилийн дагуу бодит шулуун хэсэг дутуу (U хэлбэр, ромб, нээлттэй тал) — хэмжээс тавигдахгүй (Arg = тал).</summary>
        StirrupSideOpen,
    }

    public sealed class RfSectionWarning
    {
        public RfSectionWarn Code;
        public string Arg;
        public RfSectionWarning(RfSectionWarn code, string arg = null) { Code = code; Arg = arg; }
    }

    /// <summary>Planner-ийн үр дүн: Revit-д юу үүсгэхийг дүрсэлсэн ЦЭВЭР өгөгдөл (Revit-ийн объектгүй).</summary>
    public sealed class RfSectionPlan
    {
        public RfSectionFrame Frame;
        public RfSectionRect Rect;
        public readonly List<RfStirrupLoop> Loops = new List<RfStirrupLoop>();
        public readonly List<RfLongBar> Bars = new List<RfLongBar>();
        public readonly List<RfDimPlan> Dims = new List<RfDimPlan>();

        /// <summary>
        /// Тэнхлэг тус бүрийн (хэвтээ/босоо) НЭГ ГИНЖИН хэмжээс: нүүр → хомутын ирмэг → хомутын ирмэг → нүүр (<see cref="RfDimChains"/>).
        /// Revit-д үүсэх хэмжээс нь эдгээр (<see cref="Dims"/> нь тал тус бүрийн тооцоолсон зай — preview, анхааруулга, хүлээгдэж буй утгад).
        /// </summary>
        public readonly List<RfDimChain> Chains = new List<RfDimChain>();

        /// <summary>Гишүүний хэмжээсийн гадна гинж (тэнхлэг, хучилт, хана) — <see cref="RfMemberDims"/>.</summary>
        public readonly List<RfMemberChain> MemberChains = new List<RfMemberChain>();
        public readonly List<RfTagPlan> Tags = new List<RfTagPlan>();
        public readonly List<RfSectionWarning> Warnings = new List<RfSectionWarning>();

        public bool HasContent { get { return Dims.Count > 0 || Tags.Count > 0 || MemberChains.Count > 0; } }

        public void Warn(RfSectionWarn code, string arg = null)
        {
            Warnings.Add(new RfSectionWarning(code, arg));
        }
    }
}
