using System;
using System.Collections.Generic;

namespace RevitMcpAddin.Ui.Core
{
    // ══════════════════════════════════════════════════════════════════════════
    //  MGL ХЭРЭГСЛИЙН МЕТАДАТА — НЭГ эх сурвалж.
    //
    //  Ribbon-ы текст, tooltip, дэлгэрэнгүй заавар, «Хэрэгсэл хайх» каталог бүгд ЭНЭ хүснэгтээс
    //  уншина (`ToolCatalogData`).  Энэ нь Revit/WPF-гүй ЦЭВЭР өгөгдөл тул `MglUi.Tests` шалгана.
    //
    //  ⚠️ `Name` нь `PushButtonData.Name` — Quick Access Toolbar, гарын товчлуурт хадгалагддаг
    //  тогтвортой танигч.  ХЭЗЭЭ Ч БҮҮ ӨӨРЧЛӨ.  (Revit команд ID-г tab/panel/pulldown + Name-ээс
    //  гаргадаг тул самбар солих нь ID-г өөрчилж болзошгүй — docs/MGL_UI_UX_REDESIGN.md §5.3.)
    //
    //  ⚠️ Энэ файл ГҮЙЦЭТГЭХ логик агуулахгүй: хэрэгслийг ажиллуулах нь Revit команд өөрөө
    //  (өөрийн лиценз/шалгалттай).  Каталогт харагдах нь эрх олгох ГЭСЭН ҮГ БИШ.
    // ══════════════════════════════════════════════════════════════════════════

    /// <summary>
    /// Ribbon-ы самбар.  Харагдах ДАРААЛАЛ нь `RibbonPlan.PanelOrder` (энэ enum-ын тоо биш).
    ///
    /// ⚠️ 2026-10-13-аас ХОЁР төрлийн самбар:
    ///  • ҮЙЛ АЖИЛЛАГААНЫ (Work … Library) — нийтлэг хэрэгсэл (`Disciplines == All`).  `ToolMeta.Panel` нь энэ утгыг
    ///    заана; САЛБАРЫН хэрэгсэлд ч заана, гэхдээ тэнд зөвхөн салбарын самбар доторх БҮЛЭГ/дараалал (арматур → түүвэр).
    ///  • САЛБАРЫН (Architecture … Mep) — `ToolMeta.Panel`-д ХЭЗЭЭ Ч бичигдэхгүй; `RibbonPlan` салбарын хэрэгслийг
    ///    `Disciplines`-ийн туг бүрийн самбарт автоматаар байрлуулна (олон туг → олон товч).
    ///  Rebar/Schedule нь одоо үйл ажиллагааны бүлэг л — арматурын бүх хэрэгсэл ББ-ийн тул «Бүтээц» самбарт очно.
    /// </summary>
    public enum ToolPanelId
    {
        Work = 0,       // Ажил
        Drawing = 1,    // Зураг
        Rebar = 2,      // Арматур (бүлэг)
        Schedule = 3,   // Түүвэр (бүлэг)
        Check = 4,      // Шалгалт
        Export = 5,     // Экспорт
        Library = 6,    // Сан ба тохиргоо
        Architecture = 7,   // Салбар: Архитектур (БА)
        Interior = 8,       // Салбар: Интерьер
        Structure = 9,      // Салбар: Бүтээц (ББ)
        Mep = 10,           // Салбар: Инженерийн шугам
    }

    /// <summary>Хэрэгсэл аль Revit build-д орсон.  R25–R27 = Net8Plus.</summary>
    public enum ToolBuild
    {
        /// <summary>Бүх Revit хувилбар (2024–2027).</summary>
        All = 0,
        /// <summary>Зөвхөн Revit 2025+ (net8/net10): Smart*, FamilyHub, WorkPane.</summary>
        Net8Plus = 1,
    }

    [Flags]
    public enum ToolEffects
    {
        None = 0,
        ReadsModel = 1,
        ChangesModel = 2,
        CreatesFiles = 4,
        SendsToErp = 8,
        UpdatesLocalState = 16,
        /// <summary>Загварт түр өөрчлөлт хийж, дараа нь буцаадаг (PDF-ийн түр хэмжээс, IFC-ийн түр transaction).</summary>
        TemporaryModelChanges = 32,
    }

    [Flags]
    public enum ToolViews
    {
        None = 0,
        Plan = 1,
        Section = 2,
        Elevation = 4,
        Detail = 8,
        ThreeD = 16,
        Sheet = 32,
        Schedule = 64,
        Drafting = 128,
        Other = 256,
        Any = 0x7FFFFFFF,
    }

    /// <summary>Идэвхтэй харагдацын төрөл (Revit ViewType-аас бодит probe-д буулгана).</summary>
    public enum ToolViewKind
    {
        None = 0,
        Plan = 1,
        Section = 2,
        Elevation = 3,
        Detail = 4,
        ThreeD = 5,
        Sheet = 6,
        Schedule = 7,
        Drafting = 8,
        Other = 9,
    }

    public enum ToolLicenseState
    {
        /// <summary>Уншиж чадаагүй — тааж зохиохгүй.</summary>
        Unknown = 0,
        Valid = 1,
        SignInRequired = 2,
        /// <summary>Admin зөвшөөрөл хүлээж байна (DEVICE_PENDING).</summary>
        Pending = 3,
    }

    public enum ToolPresentation
    {
        Large = 0,
        /// <summary>`AddStackedItems` дотор (жижиг).</summary>
        Stacked = 1,
        /// <summary>«ERP-д илгээх» pulldown-ийн гишүүн.</summary>
        Pulldown = 2,
    }

    public sealed class ToolMeta
    {
        // ── Танилт ────────────────────────────────────────────────
        /// <summary>PushButtonData.Name — тогтвортой танигч, ХЭЗЭЭ Ч өөрчлөхгүй.</summary>
        public string Name { get; set; }
        /// <summary>Ribbon-ы богино шошго; `\n` нь мөр таслах (хоёр мөрөөс илүүгүй).</summary>
        public string Label { get; set; }
        /// <summary>Каталог / цонхны гарчиг / tooltip-ийн эхний мөр.</summary>
        public string FullName { get; set; }
        /// <summary>Нэг өгүүлбэрээр зорилго.</summary>
        public string Purpose { get; set; }

        // ── Ribbon-д байрлах ──────────────────────────────────────
        public ToolPanelId Panel { get; set; }
        public ToolPresentation Presentation { get; set; }
        /// <summary>Самбар доторх дараалал.</summary>
        public int Order { get; set; }
        public ToolBuild Build { get; set; }
        /// <summary>Дүрсний түлхүүр (`GlyphIcons`-д буулгана); ribbon болон каталог хоёулаа ашиглана.</summary>
        public string IconKey { get; set; }
        /// <summary>
        /// Аль салбарынхан ашиглах вэ (flags; нэг хэрэгсэл олон салбарт хамаарч болно).  Өгөгдмөл `All` = нийтлэг —
        /// бүх ажилтанд харагдана.  Туузан цэс ажилтны салбараар шүүнэ (`ToolDisciplines`).
        /// </summary>
        public ToolDiscipline Disciplines { get; set; } = ToolDiscipline.All;
        /// <summary>
        /// Салбар бүр ӨӨР логиктой болох (эсвэл болсон) хэрэгсэл — ж: «Ханын дэлгээс»: БА ба Интерьер өөр template,
        /// Интерьерийнх render зургийн хэсэгтэй болно (эзэн, 2026-10-13).  Ribbon дээр салбар бүрт ТУСДАА товч гарч,
        /// товч бүр өөрийн салбарыг тээнэ (`RibbonPlan.ButtonName`, `RibbonBuilder` салбарын командын холбоос).
        /// ⚠️ Одоогоор зөвхөн ТЭМДЭГЛЭГЭЭ — хэрэгслийн логик хараахан салбараас хамаарахгүй.
        /// </summary>
        public bool VariesByDiscipline { get; set; }

        // ── Заавар / tooltip ──────────────────────────────────────
        /// <summary>Богино tooltip: юу болох · юу сонгох/нээх · юу өөрчлөгдөх/илгээгдэх · яагаад идэвхгүй болох.</summary>
        public string ToolTip { get; set; }
        /// <summary>Өргөтгөсөн tooltip: алхмууд + ЯГ ҮНЭНИЙ буцаах (Undo/Esc) тайлбар.</summary>
        public string LongDescription { get; set; }
        /// <summary>«Хэрхэн ашиглах» — 3–5 богино алхам.</summary>
        public string[] HowTo { get; set; }
        /// <summary>Нэмэлт жишээ / андуурагдах хэрэгслийн ялгаа (хоосон байж болно).</summary>
        public string Confusable { get; set; }
        /// <summary>Буцаах (Undo) нь ЯГ ҮНЭНЭЭР — нэг Ctrl+Z / алхам тус бүр / байхгүй.</summary>
        public string Undo { get; set; }
        /// <summary>Үр дүн хаашаа очих: «ERP-ийн сонгосон төсөл» / «Таны сонгосон хавтас» / «Зөвхөн энэ компьютер».</summary>
        public string Destination { get; set; }

        // ── Нөхцөл ────────────────────────────────────────────────
        public ToolEffects Effects { get; set; }
        /// <summary>Нээлттэй төслийн (Family биш) баримт шаардлагатай эсэх.</summary>
        public bool RequiresProjectDocument { get; set; }
        public ToolViews AllowedViews { get; set; } = ToolViews.Any;
        /// <summary>Харагдацын загвар (view template) байвал татгалзах уу.</summary>
        public bool RejectTemplateView { get; set; }
        /// <summary>ERP төсөл сонгосон байх шаардлагатай (хэрэгсэл өөрөө тохиргооны цонх нээнэ — зөөлөн).</summary>
        public bool RequiresErpProject { get; set; }
        /// <summary>Лиценз/нэвтрэлт шаарддаг (ихэнх нь; Бүртгэл/Тохиргоо/Каталог/Миний ажил биш).</summary>
        public bool NeedsLicense { get; set; } = true;

        // ── Хайлт ─────────────────────────────────────────────────
        /// <summary>Хуучин шошго, англи нэр, латин/монглиш хэлбэр: «clash», «huudas dugaar», «armat»…</summary>
        public string[] Aliases { get; set; } = new string[0];

        // Хайлтын кэш (ToolSearch бөглөнө; тэг-хүчин чармайлт).
        internal string FoldedHaystack;
        internal string[] FoldedAliases;
        internal string FoldedLabel;

        public string LabelOneLine
        {
            get { return string.IsNullOrEmpty(Label) ? string.Empty : Label.Replace("\r\n", " ").Replace('\n', ' '); }
        }

        public override string ToString() { return Name; }
    }

    /// <summary>Ribbon дээрх «ERP-д илгээх» pulldown-ийн тогтмол мэдээлэл.</summary>
    public static class ToolPulldowns
    {
        /// <summary>Pulldown-ийн PushButtonData-тэй төстэй тогтвортой нэр (ID-д орно).</summary>
        public const string ErpSendName = "MglErpSendMenu";
        public const string ErpSendLabel = "ERP-д\nилгээх";
        public const string ErpSendFullName = "ERP-д илгээх";
        public const string ErpSendToolTip =
            "ERP-ийн сонгосон төсөл рүү илгээх хэрэгслүүд: тоо хэмжээ, идэвхтэй харагдацын PDF, түүврийн хүснэгт. "
            + "Файлыг хавтсанд гаргах нь «Файл гаргах».";
        public const string ErpSendIconKey = "erp-send";
    }
}
