using System;

namespace RevitMcpAddin.Reinforcement.Core
{
    /// <summary>Дэлгээсийн хост: харагдацад ХЭВТЭЭ (дам нуруу) эсвэл БОСОО (багана) харагдаж буй уртааш гишүүн.</summary>
    public enum RfElevAxisKind
    {
        None = 0,

        /// <summary>Гишүүний тэнхлэг харагдацын «баруун» чигтэй параллель (дам нуруу).</summary>
        AlongRight,

        /// <summary>Гишүүний тэнхлэг харагдацын «дээш» чигтэй параллель (багана).</summary>
        AlongUp,
    }

    /// <summary>
    /// Дэлгээсийн ХОСТ-ТЭНХЛЭГИЙН frame.  Дэлгээсийн planner (<see cref="RfElevPlanner"/>) нь гишүүнийг u тэнхлэгийн дагуу хэвтээ гэж үздэг; багана
    /// босоо тул харагдацын frame-ийг 90° эргүүлж (u' = Up, v' = −Right) ХОСТ-ТЭНХЛЭГИЙН frame болгоно.  Тэгснээр planner, шошго/MRA/давхцал/зайлуулалт
    /// ЯГ ИЖИЛ кодоор багананд ажиллана (u' = өндрийн дагуу, v' = хажуу тийш) — баганын тусгай копи ҮГҮЙ.
    ///
    /// Хэмжээс ХЭЗЭЭ Ч «world X/Y» гэж таамаглахгүй: харагдацын Right/Up/Normal л ашиглана.  Эргэсэн (план дээр) баганын дэлгээсэд хүрээ нь тэр
    /// харагдацад проекцлогдсон геометрээс (Revit талд) уншигдана — энд зөвхөн тэнхлэг, frame.
    /// </summary>
    public static class RfElevHostFrame
    {
        /// <summary>Тэнхлэг харагдацын Right/Up чигтэй «параллель» гэж үзэх доод |cos| (≈ 5.7°).</summary>
        public const double AlongCos = 0.995;

        /// <summary>
        /// Гишүүний тэнхлэг (нэгж вектор) харагдацад хэвтээ/босоо харагдаж байна уу.  <paramref name="hostFrame"/> = planner-ийн ашиглах frame.
        /// Налуу (ни хэвтээ, ни босоо) эсвэл харагдацын хавтгайд перпендикуляр (огтлол) бол <see cref="RfElevAxisKind.None"/>.
        /// </summary>
        public static RfElevAxisKind Resolve(RfViewFrame view, RfV3 axis, double inPlaneMaxDot, out RfViewFrame hostFrame)
        {
            hostFrame = view;
            RfV3 a = axis.Normalized();
            if (a.Length < 0.5) return RfElevAxisKind.None;
            if (Math.Abs(a.Dot(view.Normal)) > inPlaneMaxDot) return RfElevAxisKind.None;
            if (Math.Abs(a.Dot(view.Right)) >= AlongCos) return RfElevAxisKind.AlongRight;
            if (Math.Abs(a.Dot(view.Up)) >= AlongCos)
            {
                hostFrame = Rotated(view);
                return RfElevAxisKind.AlongUp;
            }
            return RfElevAxisKind.None;
        }

        /// <summary>Харагдацын frame-ийг 90° эргүүлсэн: Right' = Up, Up' = −Right (Normal хэвээр — гар чиглэл хадгалагдана).</summary>
        public static RfViewFrame Rotated(RfViewFrame view)
        {
            return new RfViewFrame(view.Origin, view.Up, -view.Right, view.Normal);
        }

        /// <summary>
        /// Нөгөө чиглэлд 90° эргүүлсэн: Right' = −Up, Up' = Right (гар чиглэл хадгалагдана).  Planner-ийн «доод» тал (MRA, давхцал, түвшний гинж) =
        /// харагдацын ЗҮҮН тал — <see cref="Rotated"/>-д баруун тал.  «Байрлал — Зөвхөн зүүн ба доод талд» (2026-10-12, эзний t1.pdf).
        /// </summary>
        public static RfViewFrame RotatedLeft(RfViewFrame view)
        {
            return new RfViewFrame(view.Origin, -view.Up, view.Right, view.Normal);
        }
    }
}
