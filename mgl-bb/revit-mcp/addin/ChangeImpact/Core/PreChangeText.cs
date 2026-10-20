using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;

namespace RevitMcpAddin.ChangeImpact.Core
{
    /// <summary>
    /// «Өөрчлөхөөс өмнө шалгах»-ын БҮХ харагдах текст — ГАНЦ газар (Монгол кирилл).  Цэвэр: Revit-гүй, тестлэгдэнэ.
    ///
    /// ПРИНЦИП: «тооцоогүй» нь ХЭЗЭЭ Ч «0» гэж харагдахгүй.  Тоо форматлагч мэдэгдэхгүй (`null`) утгыг «—» гэж гаргана.
    /// Дельта нь хүлцлээс бага бол «өөрчлөгдөөгүй» (утгагүй «+0.0000001» гаргахгүй).
    /// </summary>
    public static class PreChangeText
    {
        private static readonly CultureInfo Inv = CultureInfo.InvariantCulture;
        public const string Minus = "−";    // U+2212

        public const string Unknown = "—";
        public const string ModelUntouched = "Загварт одоогоор ямар ч өөрчлөлт хийгдээгүй.";
        public const string NormNotEvaluated = "Нормын автомат шалгалт: энэ нөлөөлөлд баталгаажсан локал дүрэм алга.";
        public const string EgressNotConfigured = "Гарцын зам: тооцоолоогүй — гарц сонгоогүй.";
        public const string WindowTitle = "MGL — Өөрчлөхөөс өмнө шалгах";
        public const string StalePreview = "Загвар preview хийснээс хойш өөрчлөгдсөн байна. Нөлөөллийг дахин шалгана.";

        /* ============================== ТОО ================================= */

        /// <summary>Мм-ийг бүхэл болгож «4200 мм».  Мэдэгдэхгүй → «—».</summary>
        public static string Mm(double? v)
        {
            if (!v.HasValue || double.IsNaN(v.Value) || double.IsInfinity(v.Value)) return Unknown;
            return Math.Round(v.Value).ToString("0", Inv) + " мм";
        }

        public static string M2(double? v)
        {
            if (!v.HasValue || double.IsNaN(v.Value) || double.IsInfinity(v.Value)) return Unknown;
            return v.Value.ToString("0.00", Inv) + " м²";
        }

        public static string M(double? v)
        {
            if (!v.HasValue || double.IsNaN(v.Value) || double.IsInfinity(v.Value)) return Unknown;
            return v.Value.ToString("0.00", Inv) + " м";
        }

        /// <summary>Тэмдэгтэй дельта (мм).  Хүлцлээс бага → «өөрчлөгдөөгүй».</summary>
        public static string DeltaMm(double? d)
        {
            if (!d.HasValue || double.IsNaN(d.Value)) return Unknown;
            if (Math.Abs(d.Value) <= PreChangeTolerance.LengthMm) return "өөрчлөгдөөгүй";
            return Signed(Math.Round(d.Value), "0") + " мм";
        }

        public static string DeltaM2(double? d)
        {
            if (!d.HasValue || double.IsNaN(d.Value)) return Unknown;
            if (Math.Abs(d.Value) <= PreChangeTolerance.AreaM2) return "өөрчлөгдөөгүй";
            return Signed(d.Value, "0.00") + " м²";
        }

        public static string DeltaM(double? d)
        {
            if (!d.HasValue || double.IsNaN(d.Value)) return Unknown;
            if (Math.Abs(d.Value) <= PreChangeTolerance.RouteM) return "өөрчлөгдөөгүй";
            return Signed(d.Value, "0.00") + " м";
        }

        private static string Signed(double v, string fmt)
        {
            string body = Math.Abs(v).ToString(fmt, Inv);
            if (v < 0) return Minus + body;
            return "+" + body;
        }

        /* ============================== ТОЛГОЙ ============================== */

        public static string Headline(PreChangeRequest r)
        {
            if (r == null) return WindowTitle;
            string what = string.IsNullOrWhiteSpace(r.SideLabel) ? "" : " " + r.SideLabel;
            return "Энэ ханыг " + Math.Round(r.DistanceMm).ToString("0", Inv) + " мм" + what + " зөөвөл";
        }

        public static string LevelLabel(AttentionLevel l)
        {
            switch (l)
            {
                case AttentionLevel.Blocked: return "БОЛОМЖГҮЙ";
                case AttentionLevel.Critical: return "АНХААРАЛ";
                case AttentionLevel.Review: return "ХЯНАХ";
                default: return "ЦЭВЭР";
            }
        }

        public static string LevelExplain(AttentionLevel l, bool incomplete)
        {
            switch (l)
            {
                case AttentionLevel.Blocked: return "Энэ хөдөлгөөнийг хийх боломжгүй эсвэл шалгалт дуусаагүй.";
                case AttentionLevel.Critical: return "Батлагдсан ноцтой нөлөөлөл байна.";
                case AttentionLevel.Review: return incomplete
                    ? "Батлагдсан/хянах зүйл байна, мөн шалгалт зарим хэсгээрээ бүрэн биш."
                    : "Батлагдсан өөрчлөлт эсвэл хянах зүйл байна.";
                default: return "Идэвхтэй бүх шалгалт дууссан, материаллаг нөлөөлөл олдсонгүй.";
            }
        }

        public static string SeverityMark(ItemSeverity s)
        {
            switch (s)
            {
                case ItemSeverity.Critical: return "🔴";
                case ItemSeverity.Warning: return "🟠";
                case ItemSeverity.Notice: return "🟡";
                default: return "🟢";
            }
        }

        /// <summary>Өнгөөр ГАНЦААРАА хэлэхгүй — үг хамт.</summary>
        public static string SeverityWord(ItemSeverity s)
        {
            switch (s)
            {
                case ItemSeverity.Critical: return "ноцтой";
                case ItemSeverity.Warning: return "анхаар";
                case ItemSeverity.Notice: return "хянах";
                default: return "хэвийн";
            }
        }

        public static string CategoryLabel(PreChangeCategory c)
        {
            switch (c)
            {
                case PreChangeCategory.Failure: return "Revit";
                case PreChangeCategory.Room: return "Өрөө";
                case PreChangeCategory.Dimension: return "Хэмжээс";
                case PreChangeCategory.Hosted: return "Хаалга/цонх";
                case PreChangeCategory.Clearance: return "Орчны зай";
                case PreChangeCategory.View: return "Харагдац";
                case PreChangeCategory.Sheet: return "Хуудас";
                case PreChangeCategory.Schedule: return "Хүснэгт";
                case PreChangeCategory.Clash: return "MEP";
                case PreChangeCategory.Egress: return "Гарц";
                case PreChangeCategory.Norm: return "Норм";
                case PreChangeCategory.Obstacle: return "Саад";
                case PreChangeCategory.Opening: return "Нүх";
                default: return "Загвар";
            }
        }

        /* ============================== ХАРАГДАЦЫН ТӨРӨЛ ===================== */

        /// <summary>`ViewType` нэрийг «план / зүсэлт / фасад / 3D / дэлгэрэнгүй» гэсэн бүлэгт.</summary>
        public static string ViewGroup(string viewType)
        {
            switch (viewType)
            {
                case "FloorPlan":
                case "EngineeringPlan":
                case "AreaPlan": return "план";
                case "CeilingPlan": return "таазны план";
                case "Section": return "зүсэлт";
                case "Elevation": return "фасад";
                case "ThreeD": return "3D";
                case "Detail": return "дэлгэрэнгүй";
                default: return "харагдац";
            }
        }

        /// <summary>«1 зүсэлт, 2 план» — харагдацын тоог төрлөөр.</summary>
        public static string ViewBreakdown(IEnumerable<string> viewTypes)
        {
            var groups = viewTypes.Select(ViewGroup).GroupBy(g => g)
                .OrderByDescending(g => g.Count()).ThenBy(g => g.Key, StringComparer.Ordinal)
                .Select(g => g.Count() + " " + g.Key);
            return string.Join(", ", groups);
        }

        /* ============================== APPLY =============================== */

        public static string AppliedVerified(PreChangeRequest r, string counts)
        {
            if (PreChangeOperations.Of(r) == PreChangeOperationKind.DoorMove)
                return "✓ Хаалга " + Math.Round(r.DistanceMm).ToString("0", Inv) + " мм зөөгдлөө. Preview ба бодит final state таарсан."
                    + (string.IsNullOrEmpty(counts) ? "" : "\n" + counts)
                    + "\nБуцаах: Revit-д Ctrl+Z (нэг алхам).";
            return "✓ Хана " + Math.Round(r.DistanceMm).ToString("0", Inv) + " мм зөөгдлөө. Зөөсний дараах бодит төлөв preview-тэй таарсан."
                + (string.IsNullOrEmpty(counts) ? "" : "\n" + counts)
                + "\nБуцаах: Revit-д Ctrl+Z (нэг алхам).";
        }

        public static string AppliedUnverified(PreChangeRequest r, IEnumerable<string> notCompared)
        {
            string nc = notCompared == null ? "" : string.Join(", ", notCompared);
            return PreChangeOperations.NounCap(PreChangeOperations.Of(r)) + " " + Math.Round(r.DistanceMm).ToString("0", Inv) + " мм зөөгдлөө. Preview-тэй бүрэн тулгаж чадаагүй"
                + (nc.Length > 0 ? " (тулгаагүй: " + nc + ")" : "") + " — баталгаажсан гэж үзэх боломжгүй.";
        }

        public const string Cancelled = "Цуцлагдлаа — загварт өөрчлөлт хийгдээгүй.";
        /// <summary>Хаалга зөөх: DISCARD дарсны дараа.  Бодит хаалга хөдлөөгүй (sandbox аль хэдийн буцсан).</summary>
        public const string SimulationDiscarded = "Simulation цуцлагдлаа. Загварт өөрчлөлт хийгдээгүй.";

        /// <summary>Хуучирсан preview дээр «зөөх» дарсан: зөөгөөгүй, нөлөөллийг автоматаар дахин шалгав — шинэ дүнг хараад ДАХИН дарна.</summary>
        public const string StaleRefreshed = "Загвар өөрчлөгдсөн тул хана зөөгдөөгүй. Нөлөөллийг дахин шалгалаа — шинэ дүнг хараад, зөөх бол дахин дарна уу.";
        /// <summary>Workshare: хэн ч эзэмшээгүй хана — preview түр эзэмшил (checkout) үүсгэж болзошгүй; rollback эзэмшлийг ЧӨЛӨӨЛДӨГГҮЙ.</summary>
        public const string OwnershipAck = "Энэ хана хэн нэгэнд эзэмшигдээгүй байна. Revit preview хийх үед түр эзэмшил үүсгэж магадгүй. Үргэлжлүүлэх үү?";
        public const string OwnershipAckDoor = "Энэ хаалга (эсвэл хост хана) хэн нэгэнд эзэмшигдээгүй байна. Revit preview хийх үед түр эзэмшил үүсгэж магадгүй. Үргэлжлүүлэх үү?";
        public const string SelectionOffer = "Revit-д өөр хана сонгогдсон байна.";
        public const string ChooseSide = "Аль тал руу зөөх вэ?";

        /* ============================== ГАРЦ / MEP ========================== */

        public static string Pluralize(int n, string one) { return n + " " + one; }
    }
}
