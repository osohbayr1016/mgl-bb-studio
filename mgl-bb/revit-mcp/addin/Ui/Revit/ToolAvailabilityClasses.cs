using System;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;

namespace RevitMcpAddin.Ui.Revit
{
    // ══════════════════════════════════════════════════════════════════════════
    //  ВIEW-ийг МЭДДЭГ товчны идэвхжилт.
    //
    //  Өмнө нь «Хуулж тавих», «Зураг клонлох», «Огтлолын тэмдэглэгээ» нь `QtoCommandAvailability`
    //  (= зөвхөн project баримт) ашигладаг тул товч ИДЭВХТЭЙ харагдаад, дарахад команд өөрөө диалогоор
    //  татгалздаг байв.  Одоо tooltip-д бичсэн «Идэвхгүй: …» нөхцөл ҮНЭНЧЛЭН товчийг бүдгэрүүлнэ
    //  (бүдгэрсэн товчны зөвлөмж Revit-д гардаг тул яагаад гэдгийг уншина).
    //
    //  ⚠️ Revit энэ callback-ийг ribbon шинэчлэгдэх бүрд дууддаг — ЗӨВХӨН хямд шинж чанар (ViewType,
    //  IsTemplate, төрлийн шалгалт).  Collector, сүлжээ, диск ХЭЗЭЭ Ч байхгүй.  Алдаа → false.
    //  Командууд өөрсдийн шалгалтаа ХЭВЭЭР хийнэ — энэ нь зөвхөн UX.
    // ══════════════════════════════════════════════════════════════════════════

    /// <summary>Каталог товч: ҮРГЭЛЖ идэвхтэй — файл нээгээгүй ч нээнэ.</summary>
    public class ToolCatalogAvailability : IExternalCommandAvailability
    {
        public bool IsCommandAvailable(UIApplication applicationData, CategorySet selectedCategories)
        {
            return true;
        }
    }

    /// <summary>«Элемент хуулах»: project файлд, ЗАГВАР БИШ план (ViewPlan) идэвхтэй үед.</summary>
    public class CopyToOtherAvailability : IExternalCommandAvailability
    {
        public bool IsCommandAvailable(UIApplication applicationData, CategorySet selectedCategories)
        {
            try
            {
                UIDocument uidoc = applicationData == null ? null : applicationData.ActiveUIDocument;
                if (uidoc == null || uidoc.Document == null || uidoc.Document.IsFamilyDocument) return false;
                View v = uidoc.ActiveView;
                return v is ViewPlan && !v.IsTemplate;
            }
            catch
            {
                return false;
            }
        }
    }

    /// <summary>«Зураг хувилах»: project файлд, ЗАГВАР БИШ план / зүсэлт-фасад-detail / 3D идэвхтэй үед.</summary>
    public class CloneDrawingsAvailability : IExternalCommandAvailability
    {
        public bool IsCommandAvailable(UIApplication applicationData, CategorySet selectedCategories)
        {
            try
            {
                UIDocument uidoc = applicationData == null ? null : applicationData.ActiveUIDocument;
                if (uidoc == null || uidoc.Document == null || uidoc.Document.IsFamilyDocument) return false;
                View v = uidoc.ActiveView;
                if (v == null || v.IsTemplate) return false;
                return v is ViewPlan || v is ViewSection || v is View3D;
            }
            catch
            {
                return false;
            }
        }
    }

    /// <summary>
    /// «Хуулбарлаж зурах» (хуучин «Огтлолын тэмдэглэгээ»): `RfViewAvailability`-тай ИЖИЛ боловч ФАСАД-ыг гаргана — «Хуулбарлаж зурах» таб нь
    /// фасадад ажилладаггүй (<c>RfTemplatePanel</c> «боломжгүй» гэж хэлнэ), харин ерөнхий `RfViewAvailability` фасадыг зөвшөөрдөг.
    /// </summary>
    public class SectionAnnotationAvailability : IExternalCommandAvailability
    {
        public bool IsCommandAvailable(UIApplication applicationData, CategorySet selectedCategories)
        {
            try
            {
                UIDocument uidoc = applicationData == null ? null : applicationData.ActiveUIDocument;
                if (uidoc == null || uidoc.Document == null || uidoc.Document.IsFamilyDocument) return false;
                View v = uidoc.ActiveView;
                if (v == null || v.IsTemplate) return false;
                if (Reinforcement.RfView.Use(v) == Reinforcement.RfViewUse.Unsupported) return false;
                return v.ViewType != ViewType.Elevation;
            }
            catch
            {
                return false;
            }
        }
    }
}
