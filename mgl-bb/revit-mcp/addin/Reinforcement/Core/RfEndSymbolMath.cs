using System;
using System.Collections.Generic;

namespace RevitMcpAddin.Reinforcement.Core
{
    public enum RfEndKind
    {
        Start = 0,
        End = 1,
    }

    public enum RfPlaceMode
    {
        Both = 0,
        StartOnly = 1,
        EndOnly = 2,
    }

    public enum RfBarSetMode
    {
        /// <summary>Олонлогийн бүх ширхэг.</summary>
        All = 0,
        /// <summary>Эхний ба сүүлийн ширхэг.</summary>
        FirstLast = 1,
        /// <summary>
        /// Хэрэглэгчийн ДАРСАН цэгт хамгийн ойр ЯГ НЭГ ширхэг (олонлог/bar set).  Дарсан цэг мэдэгдэхгүй (өмнө нь
        /// сонгосон арматур) үед <see cref="All"/>-тай адил.
        /// </summary>
        Nearest = 2,
        /// <summary>
        /// ЗӨВХӨН ЭХНИЙ ширхэг: олонлогийн (bar set) тархалтын өөрийнх нь дарааллаар БОДИТООР БАЙГАА (<c>DoesBarExistAtPosition</c>) хамгийн эхний байрлал —
        /// «0 индекс байх ёстой» гэж таамаглахгүй (хасагдсан/байхгүй байрлалыг алгасна).  Дарсан цэгт ойр, ElementId, геометрийн дарааллаар БИШ.
        /// </summary>
        First = 3,
    }

    /// <summary>Revit-ийн RebarPresentationMode-ийн толь (Core Revit-ийг мэдэхгүй).</summary>
    public enum RfPresentation
    {
        All = 0,
        FirstLast = 1,
        Middle = 2,
        Select = 3,
    }

    /// <summary>Арматурын нэг ширхгийн нэг ТӨГСГӨЛ — загварын координатаар.</summary>
    public sealed class RfBarEnd
    {
        public RfEndKind Kind;
        public int BarIndex;

        /// <summary>Төгсгөлийн цэг (тэнхлэгийн шугамын төгсгөл).</summary>
        public RfV3 Position;

        /// <summary>Нэгж чиглэл — арматурын БИЕЭС ГАДАГШ (эхэнд: −шүргэгч, төгсгөлд: +шүргэгч).</summary>
        public RfV3 OutwardTangent;
    }

    /// <summary>
    /// «Арматурын төгсгөлийн тэмдэг»-ийн цэвэр математик.  ⚠️ БҮХ тооцоо ИДЭВХТЭЙ ХАРАГДАЦЫН координатад
    /// (<see cref="RfViewFrame"/>) — «world X = хэвтээ» гэж ХЭЗЭЭ Ч таамаглахгүй.
    /// </summary>
    public static class RfEndSymbolMath
    {
        /// <summary>
        /// Шүргэгчийн харагдацын хавтгай дээрх уртаас доош бол «end-on» (арматур харагдацын нормальтай параллель —
        /// ж: огтлол дээр цэг болж харагдах).  Тэр үед өнцөг тодорхойгүй.
        /// </summary>
        public const double EndOnMinProjected = 0.1;

        /// <summary>Шүргэгчээс «гадагш» чиглэл: эхэнд −t, төгсгөлд +t (нэгж).</summary>
        public static RfV3 OutwardTangent(RfV3 curveTangent, RfEndKind kind)
        {
            RfV3 t = curveTangent.Normalized();
            return kind == RfEndKind.Start ? -t : t;
        }

        /// <summary>
        /// Гадагш чиглэлийн харагдац дээрх өнцөг (CCW, радиан).  Харагдацын хавтгайд тусах урт
        /// <see cref="EndOnMinProjected"/>-аас бага бол false (end-on).
        /// </summary>
        public static bool TryViewAngle(RfViewFrame frame, RfV3 outward, out double angleRad)
        {
            RfV2 v = frame.ToViewVec(outward.Normalized());
            if (v.Length < EndOnMinProjected)
            {
                angleRad = 0;
                return false;
            }
            angleRad = v.Angle();
            return true;
        }

        /// <summary>
        /// Тэмдгийн байрлал: төгсгөлөөс ГАДАГШ <paramref name="offsetFt"/> зөөгөөд харагдацын хавтгай руу тусгана.
        /// </summary>
        public static RfV3 PlacementPoint(RfViewFrame frame, RfV3 position, RfV3 outward, double offsetFt)
        {
            RfV3 p = Math.Abs(offsetFt) > 1e-12 ? position + outward.Normalized() * offsetFt : position;
            return frame.Project(p);
        }

        /// <summary>Өнцгийг (−π, π] завсарт.</summary>
        public static double NormalizeAngle(double a)
        {
            double twoPi = 2 * Math.PI;
            a = a % twoPi;
            if (a <= -Math.PI) a += twoPi;
            else if (a > Math.PI) a -= twoPi;
            return a;
        }

        /// <summary>
        /// Family-д ТАВИХ эргэлт: зорилтот чиглэл − family-ийн ӨӨРИЙН «заах» чиглэл (X тэнхлэгээс CCW).
        /// Семантик: family X+ чиглэлд заадаг бол naturalAngle = 0.
        /// </summary>
        public static double RotationToApply(double targetAngleRad, double symbolNaturalAngleRad)
        {
            return NormalizeAngle(targetAngleRad - symbolNaturalAngleRad);
        }

        // ── Эхлэл / төгсгөлийн тэмдгийн БИЕ ДААСАН эргэлт ───────────────────

        /// <summary>
        /// Тэмдгийн эргэлтийн өнцгийг градусаар (−180, 180] завсарт хэвийжүүлнэ: 360° → 0, 450° → 90°, −45° → −45°, 135° → 135°, −180° → 180°.
        /// Хэрэглэгч ямар ч практик утга (аравтын бутархайтай ч) бичиж болно — хавчихгүй, хэвийжүүлнэ.  NaN/∞ → 0.
        /// </summary>
        public static double NormalizeDegrees(double deg)
        {
            if (!RfTol.IsFiniteNumber(deg)) return 0;
            double d = deg % 360.0;
            if (d <= -180.0) d += 360.0;
            else if (d > 180.0) d -= 360.0;
            return d;
        }

        /// <summary>
        /// Тохиргооны ШИЛЖИЛТ (Revit-гүй, тестлэгдсэн): шинэ Эхлэл/Төгсгөлийн эргэлт байхгүй (хуучин файл) бол хуучин «Тогтмол» ганц өнцгийг хоёуланд (хуучин нь хоёр
        /// төгсгөлд ижил байсан) — «Арматур дагуу» байсан бол 0 (offset байхгүй = өмнөх харагдац).  Аль нэг нь л байвал дутууг 0.  Хэрэглэгчийн сонголтыг чимээгүй АЛДАХГҮЙ.
        /// </summary>
        public static void MigrateRotation(string orientation, double legacyFixedDeg, double? start, double? end, out double startDeg, out double endDeg)
        {
            if (!start.HasValue && !end.HasValue)
            {
                double legacy = orientation == "fixed" ? legacyFixedDeg : 0.0;
                startDeg = legacy;
                endDeg = legacy;
                return;
            }
            startDeg = start ?? 0.0;
            endDeg = end ?? 0.0;
        }

        /// <summary>Тухайн төгсгөлд хамаарах хэрэглэгчийн эргэлт (градус): Эхлэл / Төгсгөл НЭГ БИШ, тус тусдаа.</summary>
        public static double UserRotationDeg(RfEndKind kind, double startDeg, double endDeg)
        {
            return kind == RfEndKind.Start ? startDeg : endDeg;
        }

        /// <summary>
        /// Тэмдэг ТАВИХ ЗОРИЛТОТ чиглэл (харагдацын хавтгайд, X тэнхлэгээс CCW, радиан; хэвийжүүлээгүй).
        /// <list type="bullet">
        /// <item><b>Арматур дагуу</b> (<paramref name="autoOrient"/>): автомат чиглэл (end-on бол 0) <b>+ хэрэглэгчийн эргэлт</b> — эргэлт нь автомат чиглэл ДЭЭР нэмэгдэнэ (offset).</item>
        /// <item><b>Тогтмол</b>: хэрэглэгчийн өнцөг өөрөө харагдацын хавтгай дахь АБСОЛЮТ чиглэл.</item>
        /// </list>
        /// Эхлэл, Төгсгөл тус бүрийн өнцөг ӨӨРӨӨ (<see cref="UserRotationDeg"/>).
        /// </summary>
        public static double TargetAngle(bool autoOrient, bool endOn, double autoAngleRad, RfEndKind kind, double startDeg, double endDeg)
        {
            double user = NormalizeDegrees(UserRotationDeg(kind, startDeg, endDeg)) * Math.PI / 180.0;
            if (!autoOrient) return user;
            return (endOn ? 0.0 : autoAngleRad) + user;
        }

        /// <summary>
        /// «Шинэчлэх» (Refresh) дахин тооцоход хэрэглэгчийн эргэлт алдагдахгүйн тулд хадгалах «байгалийн» өнцөг: <c>natural − user</c>.
        /// Ингэснээр <see cref="RotationToApply"/>(auto, storedNatural) = auto + user − natural — Extensible Storage-ийн схемд ШИНЭ талбар НЭМЭХГҮЙ
        /// (schema өөрчлөгдөхгүй).  Зөвхөн «Арматур дагуу» горимд хамаарна (тогтмол горимыг Refresh хөдөлгөхгүй).
        /// </summary>
        public static double StoredNatural(double naturalRad, double userRad)
        {
            return naturalRad - userRad;
        }

        /// <summary>
        /// Extensible Storage-д БИЧИХ «байгалийн» өнцөг (Place болон тестийн ГАНЦ эх сурвалж): «Арматур дагуу» горимд хэрэглэгчийн эргэлтийг (хэвийжүүлсэн) шингээнэ,
        /// «Тогтмол» горимд family-ийн өөрийн өнцөг хэвээр (Refresh тогтмол тэмдгийг хөдөлгөхгүй).
        /// </summary>
        public static double NaturalToStore(bool autoOrient, double naturalRad, RfEndKind kind, double startDeg, double endDeg)
        {
            if (!autoOrient) return naturalRad;
            double userRad = NormalizeDegrees(UserRotationDeg(kind, startDeg, endDeg)) * Math.PI / 180.0;
            return StoredNatural(naturalRad, userRad);
        }

        public static bool Wants(RfPlaceMode mode, RfEndKind kind)
        {
            switch (mode)
            {
                case RfPlaceMode.StartOnly: return kind == RfEndKind.Start;
                case RfPlaceMode.EndOnly: return kind == RfEndKind.End;
                default: return true;
            }
        }

        /// <summary>
        /// Харагдах ширхгийг сонгоно.  <paramref name="existing"/> = олонлогт БОДИТ байгаа ширхгийн индекс
        /// (өсөх дарааллаар).  Presentation горим (Revit-ийн «Эхний/Сүүлийн», «Дунд») ба хэрэглэгчийн
        /// <see cref="RfBarSetMode"/> хоёуланг нь тооцно (давхцал).
        /// </summary>
        public static List<int> SelectBars(IList<int> existing, RfPresentation presentation, RfBarSetMode mode)
        {
            var result = new List<int>();
            if (existing == null || existing.Count == 0) return result;

            var pool = new List<int>(existing);
            switch (presentation)
            {
                case RfPresentation.FirstLast:
                    pool = Distinct(pool[0], pool[pool.Count - 1]);
                    break;
                case RfPresentation.Middle:
                    pool = new List<int> { pool[pool.Count / 2] };
                    break;
            }

            if (mode == RfBarSetMode.FirstLast && pool.Count > 2)
                pool = Distinct(pool[0], pool[pool.Count - 1]);
            // Эхний ширхэг: бодитоор байгаа (existing) хамгийн эхний байрлал; Presentation горим (Эхний/Сүүлийн, Дунд) нуусан бол тэр горимоос үлдсэн эхний ширхэг.
            else if (mode == RfBarSetMode.First && pool.Count > 1)
                pool = new List<int> { pool[0] };
            return pool;
        }

        private static List<int> Distinct(int a, int b)
        {
            return a == b ? new List<int> { a } : new List<int> { a, b };
        }

        /// <summary>
        /// Цэгээс олон хэрчимт шугам (polyline) хүртэлх хамгийн бага зай (харагдацын 2D).  Нэг цэгтэй бол цэг хүртэл; хоосон бол NaN.
        /// Дарсан цэгт хамгийн ойр арматурын ширхгийг олоход (ширхгийн голын шугам = tessellated polyline).
        /// </summary>
        public static double DistanceToPolyline(RfV2 p, IList<RfV2> pts)
        {
            if (pts == null || pts.Count == 0) return double.NaN;
            if (pts.Count == 1) return (p - pts[0]).Length;
            double best = double.MaxValue;
            for (int i = 0; i + 1 < pts.Count; i++)
            {
                RfV2 a = pts[i], b = pts[i + 1];
                RfV2 ab = b - a;
                double len2 = ab.Dot(ab);
                double t = len2 < 1e-18 ? 0 : RfTol.Clamp((p - a).Dot(ab) / len2, 0, 1);
                double d = (p - (a + ab * t)).Length;
                if (d < best) best = d;
            }
            return best;
        }

        /// <summary>
        /// Дарсан цэгт хамгийн ойр ширхгийн индекс.  <paramref name="distances"/>[i] = <paramref name="indices"/>[i]
        /// ширхгийн голын шугамаас дарсан цэг хүртэлх зай; хэмжигдээгүй (NaN/∞/сөрөг) нь тооцогдохгүй.  Тэнцүү бол
        /// БАГА индекс (тогтвортой, «эхнийх нь» гэж сохроор биш — зөвхөн тэнцүү үед).  Нэг ч хэмжигдсэн зай байхгүй бол −1.
        /// </summary>
        public static int NearestBar(IList<int> indices, IList<double> distances)
        {
            if (indices == null || distances == null) return -1;
            int n = Math.Min(indices.Count, distances.Count);
            int best = -1;
            double bestD = double.MaxValue;
            for (int i = 0; i < n; i++)
            {
                double d = distances[i];
                if (!RfTol.IsFiniteNumber(d) || d < 0) continue;
                if (d < bestD - 1e-12 || (Math.Abs(d - bestD) <= 1e-12 && best >= 0 && indices[i] < best))
                {
                    bestD = d;
                    best = indices[i];
                }
            }
            return best;
        }

        /// <summary>
        /// Давхар тавилтаас хамгаалах түлхүүр: арматур + төгсгөл + ширхэг + дэгээний горим (ХАРАГДАЦ тус бүрд тусдаа).
        /// ⚠️ Дэгээний горим түлхүүрт орно: «дэгээг тооцох»-ыг солиход төгсгөл өөр цэг болдог тул өмнөх тэмдгийг
        /// «аль хэдийн тавигдсан» гэж үзэж БОЛОХГҮЙ.
        /// </summary>
        public static string DupKey(string rebarUid, RfEndKind kind, int barIndex, bool hooks)
        {
            return rebarUid + "|" + (kind == RfEndKind.Start ? "S" : "E") + "|"
                + barIndex.ToString(System.Globalization.CultureInfo.InvariantCulture) + "|" + (hooks ? "h" : "n");
        }

        /// <summary>
        /// «Энэ төгсгөлд тэмдэг аль хэдийн тавигдсан уу».  Энгийн (end-on БИШ) үед зөвхөн ЯГ ТЭР төгсгөлийн түлхүүр.
        /// ⚠️ <b>end-on</b> (арматур харагдацын нормаль дагуу — зүсэлт/баганын план дээр цэг болж харагдана) үед Эхлэл, Төгсгөл хоёр НЭГ цэгт
        /// давхцдаг тул нэг ширхэгт НЭГ л тэмдэг: хоёр төгсгөлийн АЛЬ НЭГ нь тавигдсан бол тавигдсан гэж тооцно.  Үгүй бол эхний ажиллуулалт
        /// Эхлэлд, хоёр дахь нь (Эхлэл «байгаа» тул алгасаад) Төгсгөлд ДАХИН тавьж, нэг цэгт хоёр тэмдэг давхарлана.
        /// </summary>
        /// <param name="has">Түлхүүр (<see cref="DupKey"/>) аль хэдийн бүртгэлтэй эсэх.</param>
        public static bool AlreadyPlaced(Func<string, bool> has, string rebarUid, RfEndKind kind, int barIndex, bool hooks, bool endOn)
        {
            if (has(DupKey(rebarUid, kind, barIndex, hooks))) return true;
            if (!endOn) return false;
            RfEndKind other = kind == RfEndKind.Start ? RfEndKind.End : RfEndKind.Start;
            return has(DupKey(rebarUid, other, barIndex, hooks));
        }

        /// <summary>
        /// Хэмжээсийг (график) хайрцагт орсон эсэх: харагдацын (u, v) цэг crop хайрцагт [min, max] багтах уу.
        /// </summary>
        public static bool InsideRect(RfV2 p, RfV2 min, RfV2 max)
        {
            return p.X >= min.X - RfTol.PointFt && p.X <= max.X + RfTol.PointFt
                && p.Y >= min.Y - RfTol.PointFt && p.Y <= max.Y + RfTol.PointFt;
        }
    }
}
